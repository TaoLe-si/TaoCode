// Code Vision（LSP `textDocument/codeLens`）的 **CodeMirror 落点 + 自包含调度**。
//
// 为什么整包导出（`createCodeLens(deps)` 返回 `{ extension, schedule, reset }`）而不是
// "CodeEditor 持状态、这里只渲染"：CodeEditor.vue 已经贴着机检上限（`tests/module-size.test.mjs`），
// 每个能力再往里塞 20 行"去抖 + 请求 + 转换"，它立刻超标。请求、节流、渲染、点击**都属于这一个能力**，
// 一起放在这里最内聚；CodeEditor 只留 3 行组装 + 几个触发点。
//
// 纯规则（挂哪一行、点击发什么、刷新时机）在 `src/codeLens.ts`；IDEA 的依据见那里的模块注释。
//
// 刷新时机的三条（本轮的改动，都在这一个控制器里，不动 CodeEditor）：
//   ① `schedule(trigger)` 按触发点取延迟（`codeLensRefreshDelay`）：打开 0ms / 编辑 400ms / 焦点 700ms；
//   ② 请求在飞时的触发**排队补跑一次**（`queued`）—— 原来是直接吞掉，编辑后条目会一直不刷新；
//   ③ 编辑器重新获得焦点时补刷（`focusChanged` 监听器就在这个扩展里，不需要宿主接线）——
//      用户去别的视图改名/加引用后回来，条目才是新的。
//   `reset()` 会抬一个 `generation`：在飞的那次答案即使回来也不再落盘（切换文件/关 LSP 之后）。

import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { watch } from 'vue'
import { anchoredLenses, codeLensCommand, codeLensRefreshDelay, codeLensTooltip, groupAnchoredLenses, parseCodeLensTitle,
         type AnchoredLens, type CodeLensAnchorRow, type CodeLensRefreshPolicy, type CodeLensResult, type CodeLensTitleIcon, type CodeLensTrigger } from './codeLens.ts'
// 本地 Code Vision 提供者通道（`src/codeVisionProviders.ts`）：上游把内置的那一组
// （usages / inheritors / problems / change.signature / vcs）挂在 EP 上，与 LSP 的
// `textDocument/codeLens` 是**两个来源**。本仓过去只有 LSP 那一个，服务端不下发 lens 时
// 行上方就是空的；这里把本地提供者接进同一条渲染通道。
// 去重与排序规则**只用** `mergeCodeVisionEntries` 一处（同一行同标题本地优先），不在这里重写一遍。
import { anchorCodeVisionEntries, mergeCodeVisionEntries, type CodeVisionEntry, type AnchoredCodeVisionEntry } from './codeVisionProviders.ts'
// 本地通道的**对象**形状（抓取与缓存在那一层，这里只认两个方法：读条目、挂补刷）。
// `import type` 不产生运行时依赖，所以这个文件在 node 直跑测试里仍然不需要 `cvLocalVision.ts`。
import type { CodeVisionLocalChannel } from './cvLocalVision.ts'
// 按 provider 的开关与右键隐藏（`src/codeLensSettings.ts`，上游 `CodeVisionSettings` +
// `ProjectCodeVisionModelImpl.handleLensExtraAction` 那两条）：渲染这一侧只问它三件事
// —— 这条归哪一组（`codeVisionGroupId`）、那一组画不画（`shouldShowCodeVisionEntry`，上游两层闸
// `CodeVisionSettings.kt:55-60` + `:96-101`）、每个锚点画几条（`codeVisionVisibleEntryLimit`，
// 上游 `CodeVisionSettings.kt:38-39` → `CodeVisionListData.kt:45-57`）。表本身不在这个文件里。
import { codeVisionContextActions, codeVisionGroupId, codeVisionGroupName, codeVisionSettings, codeVisionVisibleEntryLimit,
         LSP_CODE_VISION_GROUP_ID, shouldShowCodeVisionEntry, handleCodeVisionExtraAction, CODE_VISION_POPUP_MAX_ROWS } from './codeLensSettings.ts'
// 按文件的 lens 快照（`src/codeLensCache.ts`，上游 `LspCodeLensCache` + `LspHighlightingCache`）：
// 编辑期间把旧的条目**留着**并跟着文档挪，而不是整行消失等新数据。
import { createCodeLensCache } from './codeLensCache.ts'
// 文档修订号：上游那份陈旧判据（`LspHighlightingCache.kt:68-71`/`:92`/`:173`）读的是
// `Document.modificationStamp`（`Document.java:25` "incremented whenever the content changes"），
// CodeMirror 这一侧的等价物是**「`Text` 对象身份 → 稳定整数」**：`Text` 不可变，改一次正文换一个新对象，
// 改选区、派发装饰都不换。仓内已有这一份号源（`src/semanticHighlighting.ts:339-354`，
// 注释原文「与上游 `modificationStamp` 同形」），同一条上游基类的另一条具名缓存已经在用它
// （`src/editorInlayHints.ts:230` 发请求前取号、`:259` 回包时再取一次当接受闸门）。
// 订正留痕（2026-10-06 codelensfix）：这里原来读的是 `editor.state.seq` —— **`EditorState` 上没有 `seq`**
// （`@codemirror/state` 6.7.6 的 `dist/index.d.ts` 全文零命中、实跑恒为 `undefined`、`vue-tsc` 报 TS2339），
// 于是那两个闸门（同版去重 / 回包时正文变过就拒收）实际一直在拿 `undefined` 自己比自己。
// 同一结论仓内写过两次：`src/completionUi.ts:106-108`、`src/docHoverContent.ts:123-130`。
import { semanticRevisionOf } from './semanticHighlighting.ts'
// 服务器主动要求重取（`workspace/codeLens/refresh`）时踢这个编辑器补刷一拍 —— 上游那一条链是
// `LspServerNotificationsHandlerImpl.kt:348-350` → `LspFeaturesRefreshing.refreshCodeLenses`
// （`LspFeaturesRefreshing.kt:31-38`）→ `CodeVisionHost.invalidateProvider(...)`，两件事：
// 作废缓存（`src/lspServerMessages.ts` 的 `handleRefresh` 统一做）+ **当场重新问一次**（就是这里）。
import { addLspRefreshListener } from './lspServerMessages.ts'
import { ICON_SIZE } from './uiIcons.ts'

/**
 * codicon 的**图形**：路径逐条取自上游图标资源（不是我们画的近似形）。
 *   · `execute` = `platform/icons/src/actions/execute_stroke.svg:3`（`AllIcons.Actions.Execute`，
 *     记号映射见 `CodeLensTitle.kt:14-15`）；
 *   · `debug` = `platform/icons/src/actions/startDebugger_stroke.svg:3-11`（`AllIcons.Actions.StartDebugger`，
 *     映射见 `CodeLensTitle.kt:16-17`）。
 * 两处上游是 `stroke="white"` + `fill="white"`，这里换成 `currentColor`：条目文字的颜色由
 * `.cm-code-lens-action` 的 `--muted`/`--bright` 决定（悬停变亮），图标跟着同一条规则走。
 * 尺寸：上游把图标缩到 **0.8 × 行高**（`CodeVisionScaledIconPainter.kt:12` 的 `scaleMultiplier = 0.8`
 * 与 `:23` 的 `scaleFactor(iconHeight, 行高)`），本仓条目文字 11px ⇒ 8.8px，取 `src/uiIcons.ts`
 * 尺寸阶梯里最近的一档 `chip`（10）。SVG 是 16 视口整体缩放，`stroke-width` 留在路径上（1.5）
 * 才与上游几何一致，不要在根上再写一遍。
 */
const CODE_LENS_ICON_PATHS: Record<CodeLensTitleIcon, string> = {
  execute: '<path d="M13.5 7.13397C14.1667 7.51888 14.1667 8.48113 13.5 8.86603L4.5 14.0622C3.83333 14.4471 3 13.966 3 13.1962L3 2.80385C3 2.03405 3.83333 1.55292 4.5 1.93782L13.5 7.13397Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  debug: '<path d="M13.842 13.7496C14.2007 13.9567 14.6594 13.8338 14.8665 13.475C15.0736 13.1163 14.9507 12.6576 14.592 12.4505L13.842 13.7496ZM11.625 12.4696L13.842 13.7496L14.592 12.4505L12.375 11.1705L11.625 12.4696Z" fill="currentColor"/>'
    + '<path d="M14.9004 9.75C15.3146 9.75 15.6504 9.41421 15.6504 9C15.6504 8.58579 15.3146 8.25 14.9004 8.25L14.9004 9.75ZM12.4004 9.75L14.9004 9.75L14.9004 8.25L12.4004 8.25L12.4004 9.75Z" fill="currentColor"/>'
    + '<path d="M14.574 5.45959C14.9383 5.26243 15.0738 4.80729 14.8766 4.44301C14.6794 4.07873 14.2243 3.94326 13.86 4.14043L14.574 5.45959ZM12.357 6.65958L14.574 5.45959L13.86 4.14043L11.643 5.34042L12.357 6.65958Z" fill="currentColor"/>'
    + '<path d="M2.15489 13.7495C1.79617 13.9566 1.33748 13.8337 1.13037 13.475C0.923267 13.1163 1.04617 12.6576 1.40489 12.4505L2.15489 13.7495ZM4.375 12.4678L2.15489 13.7495L1.40489 12.4505L3.625 11.1687L4.375 12.4678Z" fill="currentColor"/>'
    + '<path d="M1.09961 9.74988C0.685396 9.74988 0.349609 9.41409 0.349609 8.99988C0.349609 8.58566 0.685396 8.24988 1.09961 8.24988L1.09961 9.74988ZM3.59961 9.74988L1.09961 9.74988L1.09961 8.24988L3.59961 8.24988L3.59961 9.74988Z" fill="currentColor"/>'
    + '<path d="M1.42328 5.45981C1.05889 5.26285 0.923154 4.80779 1.12011 4.4434C1.31707 4.079 1.77213 3.94327 2.13652 4.14023L1.42328 5.45981ZM3.64338 6.65979L1.42328 5.45981L2.13652 4.14023L4.35662 5.34021L3.64338 6.65979Z" fill="currentColor"/>'
    + '<path d="M10.2434 4.75357C10.3443 4.48836 10.3996 4.20064 10.3996 3.9C10.3996 2.57452 9.32509 1.5 7.99961 1.5C6.67413 1.5 5.59961 2.57452 5.59961 3.9C5.59961 4.22223 5.66311 4.52963 5.77829 4.81036" fill="none" stroke="currentColor" stroke-width="1.5"/>'
    + '<path d="M4 7.5C4 5.84315 5.34315 4.5 7 4.5H9C10.6569 4.5 12 5.84315 12 7.5V10C12 12.2091 10.2091 14 8 14V14C5.79086 14 4 12.2091 4 10V7.5Z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
}

function codeLensIconSvg(icon: CodeLensTitleIcon): string {
  const size = ICON_SIZE.chip
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${CODE_LENS_ICON_PATHS[icon]}</svg>`
}

/** 一条可点击的 Code Vision 条目。 */
/**
 * 右键一条 Code Vision → 那个上下文菜单（上游 `CodeVisionContextPopup.kt:19-35`：
 * `entry.extraActions` + 「隐藏这一组」+「全部隐藏」+「`&Configure…`」（文案键
 * `LensListPopup.tooltip.settings`，原文 `CodeVisionBundle.properties:10`），
 * 由 `ProjectCodeVisionModelImpl.handleLensRightClick`（`:45-48`）弹出）。
 *
 * 本仓的两条收窄，都不是省事：
 *   · 服务端 lens 的 `extraActions` 恒为空 —— 那几条是 Java/Kotlin 插件往
 *     `CodeVisionEntry.extraActions` 上挂的，LSP 协议里没有这个字段；
 *   · 「`&Configure…`」（`:24`）不渲染：页**有**了（`src/components/CodeVisionSettingsPage.vue`，
 *     挂在 `src/components/SettingsDialog.vue:808` 的 `code.vision` 一节，2026-10-06 codelens2 订正
 *     —— 原来这条写的是「本仓没有 Code Vision 设置页」），缺的是**打开它的那只手**：本渲染通道手里没有
 *     `openSettings`，那是宿主（保留文件 `src/components/CodeEditor.vue`）的依赖，
 *     放上去就是一枚点了没反应的条目 ⇒ 接线请求 C-2（`docs/wiring-requests-2026-10-06-codelens2.md`）。
 * 所以这里只有上游那两条 `!Hide` / `!HideAll`，文案逐字取中文包
 * （`localization-zh.jar messages/CodeVisionBundle.properties:13-14`）。
 *
 * 样式全走令牌（`var(--…)`）而不是新写一份 CSS：`src/style.css` 是保留文件，而这个菜单
 * 只服务这一个能力，跟 `EditorView.theme` 那几条同性质。行数组上限 `CODE_VISION_POPUP_MAX_ROWS`
 * 是上游 `setMaxRowCount(15)`（`CodeVisionContextPopup.kt:42`）—— 这里只有两行，取的是同一个上限的意思
 * （"不要把整个屏幕占满"），不是新造的数字。
 */
let openMenu: HTMLElement | null = null
function dismissCodeVisionMenu() {
  if (!openMenu) return
  openMenu.remove()
  openMenu = null
  window.removeEventListener('pointerdown', dismissOnPointer, true)
}
function dismissOnPointer(event: PointerEvent) {
  if (openMenu && !openMenu.contains(event.target as Node)) dismissCodeVisionMenu()
}
function openCodeVisionMenu(x: number, y: number, actions: { id: string; label: string }[], onPick: (id: string) => void) {
  dismissCodeVisionMenu()
  const menu = document.createElement('div')
  menu.className = 'cm-code-lens-menu'
  menu.setAttribute('role', 'menu')
  menu.style.cssText = `position:fixed;left:${String(Math.min(x, window.innerWidth - 260))}px;top:${String(Math.min(y, window.innerHeight - 60))}px;z-index:1000;`
    + 'display:flex;flex-direction:column;min-width:220px;max-height:300px;overflow:auto;'
    + 'padding:2px;border:var(--popup-border);border-radius:var(--popup-radius);background:var(--elevated);box-shadow:var(--popup-shadow);'
  for (const action of actions.slice(0, CODE_VISION_POPUP_MAX_ROWS)) {
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.textContent = action.label
    item.style.cssText = 'display:flex;align-items:center;padding:3px 8px;border:0;border-radius:var(--radius-xs);'
      + 'background:transparent;color:var(--text);font:inherit;font-size:12px;text-align:left;cursor:pointer;'
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--hover)' })
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
    item.addEventListener('mousedown', event => {
      event.preventDefault()
      event.stopPropagation()
      dismissCodeVisionMenu()
      onPick(action.id)
    })
    menu.appendChild(item)
  }
  document.body.appendChild(menu)
  openMenu = menu
  window.addEventListener('pointerdown', dismissOnPointer, true)
}

/**
 * 右键某一组 Code Vision → 上面那个菜单（`onContext` 的实现，上游
 * `ProjectCodeVisionModelImpl.handleLensRightClick` `:45-48`）。两条动作直接写
 * `codeLensSettings` 的那份设置，并把「设置变了」这件事交给 `onGateApplied`：
 * 渲染通道拿它立刻重建装饰集（`buildDecorations`），所以点了就少那一组，不用等下一次刷新。
 */
function openCodeVisionContext(groupId: string, x: number, y: number, onGateApplied: () => void): void {
  openCodeVisionMenu(x, y, codeVisionContextActions(codeVisionGroupName(groupId)),
    id => { if (handleCodeVisionExtraAction(id, groupId)) onGateApplied() })
}

class CodeLensWidget extends WidgetType {
  // 不用构造器参数属性：`node --test` 的类型擦除模式不支持它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
  // 而 `tests/code-lens-refresh.test.mjs` 要直接驱动这个模块的控制器。
  readonly lens: AnchoredLens
  readonly onCommand: (command: string, args?: unknown[]) => void
  readonly onContext: (groupId: string, x: number, y: number) => void
  constructor(lens: AnchoredLens, onCommand: (command: string, args?: unknown[]) => void, onContext: (groupId: string, x: number, y: number) => void) {
    super()
    this.lens = lens
    this.onCommand = onCommand
    this.onContext = onContext
  }
  eq(other: CodeLensWidget) {
    if (other.lens.item.command !== this.lens.item.command) return false
    const mine = parseCodeLensTitle(this.lens.item.title)
    const theirs = parseCodeLensTitle(other.lens.item.title)
    return mine.text === theirs.text && mine.icon === theirs.icon
  }
  toDOM() {
    const host = document.createElement('span')
    host.className = 'cm-code-lens'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-code-lens-action'
    // 标题里的 codicon 记号（`$(play)`）要变成图标并从文字里去掉，见 `parseCodeLensTitle`。
    const title = parseCodeLensTitle(this.lens.item.title)
    if (title.icon) {
      const icon = document.createElement('span')
      icon.className = 'cm-code-lens-icon'
      icon.innerHTML = codeLensIconSvg(title.icon)
      button.appendChild(icon)
    }
    button.appendChild(document.createTextNode(title.text))
    button.title = codeLensTooltip(this.lens.item)
    button.addEventListener('mousedown', event => {
      // 吃掉这次按下：Code Vision 的点击是**执行命令**，不该顺手把光标挪过去。
      if (event.button !== 2) { event.preventDefault(); event.stopPropagation() }
      const payload = codeLensCommand(this.lens.item)
      if (payload) this.onCommand(payload.command, payload.arguments)
    })
    // 右键 → 上下文菜单（`ProjectCodeVisionModelImpl.kt:45-48`）。同样吃掉默认菜单。
    button.addEventListener('contextmenu', event => {
      event.preventDefault()
      event.stopPropagation()
      this.onContext(codeVisionGroupId(this.lens.item), event.clientX, event.clientY)
    })
    host.appendChild(button)
    return host
  }
  // 必须 false：否则 CodeMirror 会把点击当编辑器交互吞掉，按钮永远收不到事件。
  ignoreEvent() { return false }
}

/**
 * 一个锚点一行的容器：同锚点的多个条目在**同一行**里用间隔分隔（上游 `CodeVisionListPainter.kt:37-49`
 * 把同一 inlay 的条目列表画成一行），而不是每个条目占一行 —— 这是本批修的形态差异。
 * 条目本身的渲染/点击复用 `CodeLensWidget`，校验路径（`codeLensCommand`）不变。
 */
class CodeLensRowWidget extends WidgetType {
  readonly row: CodeLensAnchorRow
  readonly onCommand: (command: string, args?: unknown[]) => void
  readonly onContext: (groupId: string, x: number, y: number) => void
  constructor(row: CodeLensAnchorRow, onCommand: (command: string, args?: unknown[]) => void, onContext: (groupId: string, x: number, y: number) => void) {
    super()
    this.row = row
    this.onCommand = onCommand
    this.onContext = onContext
  }
  eq(other: CodeLensRowWidget) {
    if (other.row.line !== this.row.line || other.row.items.length !== this.row.items.length) return false
    return other.row.items.every((item, index) => {
      const mine = this.row.items[index]
      return mine.title === item.title && mine.command === item.command
    })
  }
  toDOM() {
    const host = document.createElement('span')
    host.className = 'cm-code-lens-row'
    this.row.items.forEach((item, index) => {
      if (index) {
        const gap = document.createElement('span')
        gap.className = 'cm-code-lens-delimiter'
        host.appendChild(gap)
      }
      host.appendChild(new CodeLensWidget({ line: this.row.line, item }, this.onCommand, this.onContext).toDOM())
    })
    return host
  }
  ignoreEvent() { return false }
}

export const setCodeLens = StateEffect.define<readonly AnchoredLens[]>()
const onCodeLensCommand = StateEffect.define<null>()   // 占位，保持 effect 类型集中
// 齿轮/右键改了 Code Vision 的设置表 ⇒ 立刻按新闸重画（上游靠
// `CodeVisionSettings.listener.providerAvailabilityChanged` / `globalEnabledChanged`
// （`CodeVisionSettings.kt:120` / `:59`）通知模型重算，本仓没有后台收集线程，就在编辑器这一拍走一遍）。
const codeVisionGateChanged = StateEffect.define<null>()

/**
 * 把一份 lens 列表变成「每锚点一行」的块装饰。
 *
 * 先过闸再归并：上游的组闸在**收集**时就跳过整个 provider
 * （`CodeVisionHost.kt:348-350` `for (provider in providers) { if (!settings.isProviderEnabled(provider.groupId)) continue`），
 * 总闸关掉时整族不收集（`CodeVisionHost.kt:341` 的 `isEnabledWithRegistry`，读的是
 * `CodeVisionSettings.kt:55-56` 的 `codeVisionEnabled`）。所以这里不是「画出来再藏」：
 * 关掉的组一条都不会进装饰集，`groupAnchoredLenses` 的上限与 `hidden` 计数也因此只数可见的那几条。
 *
 * 第二层（每个锚点最多几条）吃的是**设置表里那一个数**，不是常量：
 * `CodeVisionListData.kt:46` 的 `projectModel.maxVisibleLensCount[anchor]` 由
 * `CodeVisionHost.kt:287-288` 从 `CodeVisionSettings.getAnchorLimit(...)`（`CodeVisionSettings.kt:140-147`）灌进来，
 * 出厂 5（`:38-39`）。截断的形状与上游逐字一致 —— 上游 `subList(0, minOf(count, size))`
 * （`CodeVisionListData.kt:55-56`）= 保留前缀、不改序，本仓是 `src/codeLens.ts:165` 的 `slice(0, cap)`。
 * 顺序仍然是**闸在前、上限在后**：反过来会让被关掉的族白占那 5 个槽位。
 */
function buildDecorations(state: EditorState, lenses: readonly AnchoredLens[], onCommand: (command: string, args?: unknown[]) => void,
                          onGateChange: () => void): DecorationSet {
  if (!lenses.length) return Decoration.none
  const visible = lenses.filter(lens => shouldShowCodeVisionEntry(codeVisionGroupId(lens.item)))
  if (!visible.length) return Decoration.none
  const decorations: ReturnType<Decoration['range']>[] = []
  // 同锚点的条目合成一行（见 `CodeLensRowWidget`）；`groupAnchoredLenses` 已按位置稳定排序。
  // 行号越界就跳过（服务端算的时候文档可能已经变了）。
  const onContext = (groupId: string, x: number, y: number) => { openCodeVisionContext(groupId, x, y, onGateChange) }
  for (const row of groupAnchoredLenses(visible, codeVisionVisibleEntryLimit())) {
    if (row.line >= state.doc.lines) continue
    const line = state.doc.line(row.line + 1)
    // `block: true` 是 CodeMirror 里唯一能表达"行**上方**"的方式（行内 widget 会挤在代码中间，
    // 那是 inlay hint 的位置，不是 Code Vision 的位置）。
    decorations.push(Decoration.widget({
      widget: new CodeLensRowWidget(row, onCommand, onContext), block: true, side: -1,
    }).range(line.from))
  }
  return Decoration.set(decorations, true)
}

export interface CodeLensDeps {
  /** 发一次 `lsp.request { kind: 'codeLens' }`。抛错由调用方兜（这里只清空）。 */
  query: () => Promise<CodeLensResult>
  /** 当前是否该问（LSP 开着、不是大文件、有视图）。 */
  enabled: () => boolean
  view: () => EditorView | undefined
  /** 点击一条 Code Vision → 执行它的命令。 */
  onCommand: (command: string, args?: unknown[]) => void
  /**
   * **本地** Code Vision 条目（`src/codeVisionProviders.ts` 的注册表算出来的），与服务端 lens
   * 合流后进同一条渲染通道。缺省 = 没有本地通道（那时行为与接入前逐字相同）。
   * 抛错要自己兜住：本地来源坏掉不该把服务端 lens 一起清空。
   */
  local?: () => readonly CodeVisionEntry[]
  /**
   * 或者直接把**本地通道对象**交给渲染层（`src/cvLocalVision.ts` 的 `createCodeVisionLocalChannel`）。
   * 给了这个就不用给 `local`：这一侧自己读 `entries()`，并把"计数抓完了补刷一拍"挂上 ——
   * 宿主因此只需要一行接线（`localChannel: 通道`），不必再操心回调顺序。
   */
  localChannel?: CodeVisionLocalChannel
  /** 刷新延迟覆盖（测试用；产品路径用 `codeLens.ts` 的默认策略）。 */
  policy?: CodeLensRefreshPolicy
  /**
   * 当前文件路径 —— 快照缓存按它分槽（上游 `LspHighlightingCache` 的
   * `fileToCachedHighlightingsSnapshot` 就是按 `VirtualFile` 分的，`LspHighlightingCache.kt:38-41`）。
   * **可选**：宿主（保留文件 `src/components/CodeEditor.vue`）还没传这一行，没传时退化成
   * "一个控制器一个槽"—— 缓存只用来做**请求侧**的三件事（同版本去重 / 首拍不走去抖 /
   * 在飞期间文档变了就拒收），不用来"回显旧内容"，所以串不了数据：换文件必然换一个 `Text` 对象、
   * 修订号必变，`peek` 一定给 `shouldRequest: true`。代价只是换文件后那一拍仍被当成
   * "不是第一次问"（少一次 0ms 首拍）。接线请求 C-1 给的就是这一行。
   */
  path?: () => string
}

export interface CodeLensController {
  extension: Extension
  /** 触发一次刷新；`trigger` 决定去抖长度（缺省 `change`，与老的调用点兼容）。 */
  schedule(trigger?: CodeLensTrigger): void
  reset(): void
  dispose(): void
}

/**
 * 本地条目与服务端 lens 合流成一份可渲染的列表。
 *
 * 顺序与去重的**规则**只来自 `mergeCodeVisionEntries`（同一行同标题本地优先，再按行升序）；
 * 这里只负责把结果映射回各自的 lens 对象 —— `CodeVisionEntry` 不带 `range`，直接拿它当
 * `AnchoredLens` 用会把服务端的锚点区间（`groupAnchoredLenses` 的归并键）弄丢，所以按
 * `(行, 标题)` 逐个认领回原对象，两侧的区间一个字节都不改。
 */
function mergeLensesWithLocal(local: readonly AnchoredCodeVisionEntry[], server: readonly AnchoredLens[]): AnchoredLens[] {
  if (!local.length) return [...server]
  const byKey = new Map<string, (AnchoredLens | AnchoredCodeVisionEntry)[]>()
  for (const lens of [...local, ...server]) {
    const key = `${lens.line}:${lens.item.title}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(lens)
    else byKey.set(key, [lens])
  }
  const serverEntries: CodeVisionEntry[] = server.map(lens => ({ line: lens.line, title: lens.item.title, command: lens.item.command }))
  const localEntries: CodeVisionEntry[] = local.map(lens => ({ line: lens.line, title: lens.item.title, command: lens.item.command }))
  return mergeCodeVisionEntries(localEntries, serverEntries)
    .map(entry => byKey.get(`${entry.line}:${entry.title}`)?.shift())
    .filter((lens): lens is AnchoredLens | AnchoredCodeVisionEntry => Boolean(lens))
}

/** 取本地条目；本地来源抛错时退化成「没有本地通道」，不牵连服务端 lens。 */
function readLocalEntries(deps: CodeLensDeps): readonly CodeVisionEntry[] {
  const source = deps.localChannel ? () => deps.localChannel!.entries() : deps.local
  if (!source) return []
  try { return source() ?? [] } catch { return [] }
}

export function createCodeLens(deps: CodeLensDeps): CodeLensController {
  // 最近一次送进渲染通道的条目（已过 `anchoredLenses` / 合流，未过闸）。
  // 留着它是因为闸变了要拿同一批条目**原地重画**：上游的监听器触发的也只是「重新收集」，
  // 不是「重新问服务器」（`CodeVisionSettings.kt:120` → `LensInvalidateSignal`）。
  let lastLenses: readonly AnchoredLens[] = []
  // 按文件（宿主没给 path 时 = 按这个控制器）的 lens 快照：只管**请求侧**那三件事
  // —— 同一文档版本已经问过就不再问（`LspHighlightingCache.kt:93-103`）、这个文件第一次问
  // 不走去抖（`:50-51` + `:146` + `:161-163`）、回包时文档版本已经不是发请求那一版就**拒收**
  // （`:170-177`）。理由写在 `src/codeLensCache.ts` 的文件头。
  const cache = createCodeLensCache()
  const cachePath = () => deps.path?.() ?? ''
  const applyGateChange = () => { deps.view()?.dispatch({ effects: codeVisionGateChanged.of(null) }) }
  // 设置表里任何一格变了（总闸 / 某一组 / 每锚点条数）都要按新档重画。上游是三个监听器做同一件事：
  // `CodeVisionSettings.kt:59` 的 `globalEnabledChanged`、`:120` 的 `providerAvailabilityChanged`、
  // `CodeVisionHost.kt:298-300` 的 `visibleMetricsAboveDeclarationCount.advise { invalidateProviderSignal.fire(...) }`
  // —— 都是「按新设置重新走一遍已有的条目」，不是「重新问服务器」。本仓没有后台收集线程，
  // 等价物就是在本编辑器里重跑一次 `buildDecorations`（`codeVisionGateChanged` 那条 effect）。
  // 没有这一拍，设置页改了数字要等下一次刷新才见效（右键那条另有同步的 `onGateApplied`，见上面）。
  const stopSettingsWatch = watch(codeVisionSettings, applyGateChange)
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_decorations, transaction) {
      // 行号依赖精确位置，内容一变整份作废（和语义着色/文档链接同理）。
      if (transaction.docChanged) return Decoration.none
      for (const effect of transaction.effects) {
        if (effect.is(setCodeLens)) {
          lastLenses = effect.value
          return buildDecorations(transaction.state, lastLenses, deps.onCommand, applyGateChange)
        }
        if (effect.is(codeVisionGateChanged)) return buildDecorations(transaction.state, lastLenses, deps.onCommand, applyGateChange)
      }
      return _decorations
    },
    provide: f => EditorView.decorations.from(f),
  })
  let timer: number | undefined
  let inFlight = false
  let queued = false
  let generation = 0

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled() || inFlight) return
    const path = cachePath()
    // 发请求**之前**取号（上游 `LspHighlightingCache.kt:88` 的 `settleRequestStamp`，即
    // `:158` `getDocument(file)?.modificationStamp`）：回包时要拿它现读的那一个比。
    const revision = semanticRevisionOf(editor.state.doc)
    // 上游 `:93-103` 的那道去重闸：同一个文档修订已经问过一次 ⇒ 不再问第二次。
    // 触发点很密（每次编辑、每次焦点、本地通道每一轮计数），而这一条请求是**整文档**的。
    if (!cache.beginRequest(path, revision)) return
    inFlight = true
    const mine = generation
    try {
      const result = await deps.query()
      const target = deps.view()
      // 期间换过文档（`target !== editor`）或发生过 `reset`（generation 变了）：这次的答案已经过期。
      if (target !== editor || generation !== mine) { cache.endRequest(path, revision); return }
      const local = anchorCodeVisionEntries(readLocalEntries(deps))
      // 服务端没这个能力时 `available` 为 false —— 但那**不代表**没有条目可显示：
      // 本地提供者（上游那组挂在 EP 上的内置 provider）不经过 LSP，所以照样要画。
      const server = result.available ? anchoredLenses(result.items) : []
      const merged = mergeLensesWithLocal(local, server)
      // 回包这一拍**再取一次号**：在飞期间用户又打了字 ⇒ 这份答案的**行号是对旧文档算的**，
      // 直接画会把条目挂到别的行上。上游同一句在 `LspHighlightingCache.kt:170-177`
      // （`document.modificationStamp != docModStamp` ⇒ 不收，并且立刻再排一次）；
      // 本仓同一个闸门的另一处消费见 `src/editorInlayHints.ts:259`。
      if (!cache.accept(path, revision, semanticRevisionOf(target.state.doc), merged)) { schedule('change'); return }
      target.dispatch({ effects: setCodeLens.of(merged) })
    } catch {
      // 服务器没有 codeLens 能力时只清掉服务端那半；本地条目仍要留着（见上面那条注释）。
      cache.endRequest(path, revision)
      if (generation === mine) {
        const local = anchorCodeVisionEntries(readLocalEntries(deps))
        deps.view()?.dispatch({ effects: setCodeLens.of(local) })
      }
    } finally {
      inFlight = false
      // ② 在飞期间攒下的触发补跑一次（不丢刷新）；`schedule` 会按 change 档再去抖。
      if (queued) { queued = false; schedule('change') }
    }
  }

  function schedule(trigger: CodeLensTrigger = 'change') {
    if (!deps.enabled()) return
    if (inFlight) { queued = true; return }
    const editor = deps.view()
    // `peek` 只读不写，真正发请求前还要过 `beginRequest` 那道闸，所以这里问一句没有副作用。
    // 没有视图时就没有文档、也就没有修订号可问（产品路径上 `enabled()` 里已经含"有视图"，
    // 这一格为 null 只可能来自判据直接把控制器拎出来跑）。
    const decision = editor ? cache.peek(cachePath(), semanticRevisionOf(editor.state.doc)) : null
    // 「没变不重问」：上游 `LspHighlightingCache.kt:68-71` 的 `getHighlightings` 只在
    // `highlightingsSnapshot?.docModStamp != docModStamp` 时才排重取，`:92` 那一档写得更直白
    // （"a response for the same document version has been applied while this trigger was settling" ⇒ return）。
    // 本仓的编辑触发点是宿主那一句 `codeLens.schedule()`（`src/components/CodeEditor.vue:1010`，
    // 只在 `update.docChanged` 里发）与在飞期间攒下的补跑，所以这一档只压 `change`：
    // `focus`（重新拿到焦点，正文**没**变，别处的引用计数变了）与 `open`（本地通道抓完一轮 /
    // 服务器一句 `workspace/codeLens/refresh`）都不是"这一篇正文又改过"，那些恰恰是要重问的时刻 ——
    // 上游对它们走的是另一条链（`:292-303` 的 `invalidate` 抹掉去重闸 + `CodeVisionHost` 的失效信号）。
    if (decision && trigger === 'change' && !decision.shouldRequest) return
    // 首拍不走去抖（上游 `LspHighlightingCache.kt:50-51` 的 `so the file-open latency is unaffected`
    // 与 `:146` 那个 `!isFirstPullFor(file)` 判据）：宿主在切文件那一拍发的是**无参** `schedule()`
    // （`CodeEditor.vue:1054`/`:1079` ⇒ `change` 档 400ms），这个文件从来没答过一次的时候不该再等
    // 那 400ms。
    const delay = decision?.firstPull ? 0 : codeLensRefreshDelay(trigger, deps.policy)
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, delay)
  }

  // 本地通道抓完一轮后要补刷一拍（`open` 档的去抖是 0ms，`codeLens.ts` 的 `codeLensRefreshDelay`）。
  // 挂在这里而不是宿主那一侧：宿主只给一个通道对象就行，回调顺序不用它操心。
  deps.localChannel?.attach(() => schedule('open'))
  // 服务器一句 `workspace/codeLens/refresh` = "你手里那批 lens 过期了，**现在**重取"。
  // 上游对这一句做两件事：`LspServerNotificationsHandlerImpl.kt:348-350` → `LspFeaturesRefreshing
  // .refreshCodeLenses`（`LspFeaturesRefreshing.kt:31-38`）把失效信号发给 `CodeVisionHost`；而
  // 客户端那头的 `LspClientImpl.kt:222-233` 是"清完缓存 **再当场 scheduleRefresh/refreshCodeLenses**"。
  // 本仓第一件（作废缓存）早已在 `src/lspServerMessages.ts` 的 `handleRefresh` 里做了，这一行补第二件。
  // 先 `invalidate` 再 `schedule('open')`：前者抹掉"这一版已经问过"的闸（上游 `invalidate` 的注释
  // `:294-298` 写得很直白 —— 不抹的话强制重取会被 dedup 掉），后者按 0ms 那一档立刻再问一次。
  const stopRefreshListener = addLspRefreshListener('workspace/codeLens/refresh', () => {
    cache.invalidate(cachePath())
    schedule('open')
  })

  return {
    extension: [
      field,
      // ③ 重新获得焦点就补刷：监听器进扩展，宿主（CodeEditor.vue）不用接线。
      EditorView.updateListener.of(update => {
        if (update.focusChanged && update.view.hasFocus) schedule('focus')
      }),
      // 模块自带样式：它只服务这一个能力，放进 CodeEditor 的 theme 里会让那边的样式表继续膨胀。
      EditorView.theme({
        '.cm-code-lens-row': { display: 'block', lineHeight: '1.2' },
        '.cm-code-lens': { display: 'inline-block' },
        // codicon 图标与文字之间留一个字身位（`iconSize.inline` 的行内记号槽）。
        '.cm-code-lens-icon': { display: 'inline-flex', alignItems: 'center', marginRight: '3px' },
        // 上游 `DelimiterPainter` 不画记号、只占一个字号的宽度（`DelimiterPainter.kt:26-28`）。
        '.cm-code-lens-delimiter': { display: 'inline-block', width: '1em' },
        '.cm-code-lens-action': {
          background: 'transparent', border: 'none', padding: '0 4px', cursor: 'pointer',
          color: 'var(--muted)', font: 'inherit', fontSize: '11px', textAlign: 'left',
        },
        '.cm-code-lens-action:hover': { color: 'var(--bright)', textDecoration: 'underline' },
      }),
    ],
    schedule,
    reset() {
      generation++
      queued = false
      if (timer !== undefined) { clearTimeout(timer); timer = undefined }
      // 换语言服务/关掉这一族：快照整份丢掉（上游客户端换掉时走的是 `clearCache()`，
      // `LspHighlightingCache.kt:263-270` —— 四张 map 全清并取消在飞的那条。本仓的"取消"由
      // 上面的 `generation` 承担：回来的答案 `generation !== mine`，不会再落盘）。
      cache.clear()
      deps.view()?.dispatch({ effects: setCodeLens.of([]) })
    },
    dispose() {
      stopSettingsWatch()
      stopRefreshListener()
      cache.clear()
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
