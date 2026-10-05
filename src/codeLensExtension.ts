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
// `ProjectCodeVisionModelImpl.handleLensExtraAction` 那两条）：渲染这一侧只问两个判据，
// 表本身不在这个文件里。
import { codeVisionContextActions, codeVisionGroupId, codeVisionGroupName, LSP_CODE_VISION_GROUP_ID,
         shouldShowCodeVisionEntry, handleCodeVisionExtraAction, CODE_VISION_POPUP_MAX_ROWS } from './codeLensSettings.ts'
// 按文件的 lens 快照（`src/codeLensCache.ts`，上游 `LspCodeLensCache` + `LspHighlightingCache`）：
// 编辑期间把旧的条目**留着**并跟着文档挪，而不是整行消失等新数据。
import { createCodeLensCache } from './codeLensCache.ts'
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
 * `entry.extraActions` + 「隐藏这一组」+「全部隐藏」+「Lens Settings…」，
 * 由 `ProjectCodeVisionModelImpl.handleLensRightClick`（`:45-48`）弹出）。
 *
 * 本仓的两条收窄，都不是省事：
 *   · 服务端 lens 的 `extraActions` 恒为空 —— 那几条是 Java/Kotlin 插件往
 *     `CodeVisionEntry.extraActions` 上挂的，LSP 协议里没有这个字段；
 *   · 「Lens Settings…」（`:24`）不渲染：本仓没有 Code Vision 设置页（要新建组件 +
 *     `src/settingsTreeMeta.ts` 的树节点，都是别人的文件），放上去就是一枚假按钮。
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
 * `codeLensSettings` 的那份设置，渲染通道下一次建装饰集时生效（`buildDecorations`）。
 */
function openCodeVisionContext(groupId: string, x: number, y: number): void {
  openCodeVisionMenu(x, y, codeVisionContextActions(codeVisionGroupName(groupId)),
    id => { handleCodeVisionExtraAction(id, groupId) })
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

function buildDecorations(state: EditorState, lenses: readonly AnchoredLens[], onCommand: (command: string, args?: unknown[]) => void): DecorationSet {
  if (!lenses.length) return Decoration.none
  const decorations: ReturnType<Decoration['range']>[] = []
  // 同锚点的条目合成一行（见 `CodeLensRowWidget`）；`groupAnchoredLenses` 已按位置稳定排序。
  // 行号越界就跳过（服务端算的时候文档可能已经变了）。
  for (const row of groupAnchoredLenses(lenses)) {
    if (row.line >= state.doc.lines) continue
    const line = state.doc.line(row.line + 1)
    // `block: true` 是 CodeMirror 里唯一能表达"行**上方**"的方式（行内 widget 会挤在代码中间，
    // 那是 inlay hint 的位置，不是 Code Vision 的位置）。
    decorations.push(Decoration.widget({
      widget: new CodeLensRowWidget(row, onCommand, openCodeVisionContext), block: true, side: -1,
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
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(_decorations, transaction) {
      // 行号依赖精确位置，内容一变整份作废（和语义着色/文档链接同理）。
      if (transaction.docChanged) return Decoration.none
      for (const effect of transaction.effects)
        if (effect.is(setCodeLens)) return buildDecorations(transaction.state, effect.value, deps.onCommand)
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
    inFlight = true
    const mine = generation
    try {
      const result = await deps.query()
      const target = deps.view()
      // 期间换过文档（`target !== editor`）或发生过 `reset`（generation 变了）：这次的答案已经过期。
      if (target !== editor || generation !== mine) return
      const local = anchorCodeVisionEntries(readLocalEntries(deps))
      // 服务端没这个能力时 `available` 为 false —— 但那**不代表**没有条目可显示：
      // 本地提供者（上游那组挂在 EP 上的内置 provider）不经过 LSP，所以照样要画。
      const server = result.available ? anchoredLenses(result.items) : []
      target.dispatch({ effects: setCodeLens.of(mergeLensesWithLocal(local, server)) })
    } catch {
      // 服务器没有 codeLens 能力时只清掉服务端那半；本地条目仍要留着（见上面那条注释）。
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
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, codeLensRefreshDelay(trigger, deps.policy))
  }

  // 本地通道抓完一轮后要补刷一拍（`open` 档的去抖是 0ms，`codeLens.ts` 的 `codeLensRefreshDelay`）。
  // 挂在这里而不是宿主那一侧：宿主只给一个通道对象就行，回调顺序不用它操心。
  deps.localChannel?.attach(() => schedule('open'))

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
      deps.view()?.dispatch({ effects: setCodeLens.of([]) })
    },
    dispose() { if (timer !== undefined) clearTimeout(timer) },
  }
}
