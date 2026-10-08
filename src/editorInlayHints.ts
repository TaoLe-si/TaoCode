// Inlay hints（IDEA 的 `InlayHintsProvider` 一族在本仓的 LSP 等价物：
// `textDocument/inlayHint`）。服务端给的 (行, 列, label) 变成行内的小字。
//
// 从 `CodeEditor.vue` 拆出（那个文件贴着机检上限）：widget 渲染、渲染前归位、
// 去抖调度都是自包含的；宿主只注入「当前视图 / 当前路径 / 语言服务可用与否 / 开关 / 命令回调」。
//
// 上游在 IDEA 里是 `EditorInlayHintsProvider` 的画层；CodeMirror 没有内建 inlay，
// 等价物是 `Decoration.widget`（`InlayWidget`）。
//
// 这一版接上的是三条**此前只有规则、没有消费链路**的东西：
//   ① 渲染前归位（`layoutInlayHints`）：开关过滤 → 排序 → 同位置去重与优先级（参数名 > 类型）。
//      服务器可能在同一位置同时发参数名与类型提示，原来"先到先得"，两个 widget 会叠在一起。
//   ② 悬停说明（`tooltip`）：宿主转发的是 LSP `InlayHint.tooltip`（字符串或 MarkupContent），
//      上游对应物是 declarative sink 的同一对参数
//      （`platform/lang-api/src/com/intellij/codeInsight/hints/declarative/InlayTreeSink.kt:27-31`
//      的 `tooltip: String?` 与 `payloads`）。
//   ③ 点击动作（`command`）：有命令的提示是可点的，按下即执行 `workspace/executeCommand`；
//      没有命令的仍然是只读 span（`inlayHintCommand` 给 null）。
//   ④ **发之前先查表**（`src/lspPerFileCapabilities.ts`）：这一族按文件登记在"这个文件支持哪些能力"
//      的那张表里，被记成不支持（服务器显式拒过 / 这个文件的高亮级别是「无」）时一次都不发，
//      并把上一拍的提示撤掉 —— 上游同一条链是 `LspInlayHintsCache.kt:18-23` 的 `isSupportedForFile`。
//   ⑤ **结果缓存**（本轮补的缺项）：上游这一族的取用点不是"每次渲染发一趟"，而是
//      `LspInlayHintsCache`（`platform/lsp-impl/src/impl/features/inlayHint/LspInlayHintsCache.kt:17-39`）——
//      它是 `LspHighlightingCache` 的一条具名特性，注册在
//      `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:31`，
//      按文件存快照、快照记「发这条请求时的 `Document.modificationStamp`」（`LspHighlightingCache.kt:31-36`
//      的类注释与 `:68-71` 的判定），戳没变就**不再发**（`:95-102` 那条同一戳只发一次的去重闸），
//      答案回来时戳已经变了就**整份不收**（`:170-177`）。
//      本仓那份状态机早就在 `src/lspHighlightingCache.ts`（`HighlightingSnapshotCache`，诊断那条链在用），
//      这里按同一个形状再建一份给 inlayHint 用：`inlayHintCache`。
//      存的是**服务器原文 + 落到当前文档的锚点**，不是画出来的那份条目 —— 三档开关是渲染期的事
//      （`layoutInlayHints`），把过滤结果存进缓存会让"改了开关但文档没变"这一拍拿到旧开关的画面
//      （判据 `tests/lsp-result-cache.test.mjs` 第 6 条钉住：不发第二次请求，但屏幕按新开关重画）。
//      编辑后的可见差别：提示跟着文档走（`LspClientImpl.kt:215-220` 那条注释点名的正是这一步），
//      而不是停在编辑前的偏移上等新答案。
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { request as bridgeRequest, type LspInlayHint, type LspInlayHintResult } from './bridge.ts'
import { lspPosition } from './editorDiagnosticMarkers.ts'
import { languageOfPath } from './cvLocalVision.ts'
import { lspFileFeatures } from './lspPerFileCapabilities.ts'
import { HighlightingSnapshotCache, LOW_PRIORITY_QUIESCENCE_MS, type LspCachedHighlighting } from './lspHighlightingCache.ts'
import { semanticRevisionOf } from './semanticHighlighting.ts'
import { inlayHintCommand, inlayHintTooltip, DEFAULT_INLAY_HINT_TOGGLES, type InlayHintToggles } from './inlayHints.ts'
// 服务器主动要求重取（`workspace/inlayHint/refresh`）时踢这一族补刷一拍 —— 见 `run()` 下面那一段。
import { addLspRefreshListener } from './lspServerMessages.ts'
import { layoutInlayHints, NO_INLAY_HINT_LINE_LIMIT } from './inlayHintLayout.ts'
import {
  type InlayAuthorLine, type InlayProviderRegistry,
} from './inlayProviderRegistry.ts'

interface HintEntry {
  from: number
  text: string
  padLeft: boolean
  padRight: boolean
  /** 有值的提示可点（`inlayHintCommand` 的结果）；`undefined` = 只读。 */
  command?: { command: string; arguments?: unknown[] }
  /** 悬停说明（`inlayHintTooltip`：有 tooltip 用它，否则说清这是参数名/类型提示）。 */
  tooltip: string
}

class InlayWidget extends WidgetType {
  // 不用构造器参数属性：`node --test` 的类型擦除模式不支持它（`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`），
  // 拦这条的是 `node .tools/find-param-props.mjs` 那道门；这一类的可见行为由
  // `tests/inlay-hints.test.mjs` 的「点击命令」与「悬停说明」两条判据钉（留痕：原写
  // `tests/inlay-hint-interaction.test.mjs` —— 那个文件在本仓不存在）。
  readonly entry: HintEntry
  readonly onCommand: (command: string, args?: unknown[]) => void
  constructor(entry: HintEntry, onCommand: (command: string, args?: unknown[]) => void) {
    super()
    this.entry = entry
    this.onCommand = onCommand
  }
  eq(other: InlayWidget) {
    return other.entry.text === this.entry.text
      && other.entry.padLeft === this.entry.padLeft && other.entry.padRight === this.entry.padRight
      && other.entry.command?.command === this.entry.command?.command
  }
  toDOM() {
    const label = `${this.entry.padLeft ? ' ' : ''}${this.entry.text}${this.entry.padRight ? ' ' : ''}`
    const command = this.entry.command
    if (!command) {
      const span = document.createElement('span')
      span.className = 'cm-lsp-inlay'
      span.textContent = label
      // 悬停说明走原生 title：没有可点的命令时这就是这条提示唯一的交互。
      if (this.entry.tooltip) span.title = this.entry.tooltip
      return span
    }
    // 有命令 ⇒ 画成按钮：提示本身是"点一下会发生某件事"的入口（上游 sink 的 payloads 同一件事）。
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-lsp-inlay cm-lsp-inlay-actionable'
    button.textContent = label
    button.title = this.entry.tooltip
    button.setAttribute('aria-label', this.entry.tooltip)
    button.addEventListener('mousedown', event => {
      // 吃掉这次按下：点击提示是**执行命令**，不该顺手把光标挪到那一列。
      event.preventDefault()
      event.stopPropagation()
      this.onCommand(command.command, command.arguments)
    })
    return button
  }
  // 必须 false：否则 CodeMirror 把点击当编辑器交互吞掉，按钮永远收不到事件（同 codeLensExtension.ts）。
  ignoreEvent() { return false }
}

export const setInlayHints = StateEffect.define<HintEntry[]>()

/**
 * 提示层。`onCommand` 由控制器注入（判据也直接建一层读它，所以这里导出）。
 *
 * `docChanged` 那一条不是装饰：层里存的是**绝对偏移**，CodeMirror 不会替 `StateField` 的值做映射，
 * 所以不显式跟着 `ChangeSet` 走的话，提示会停在编辑前的偏移上（上游 `LspClientImpl.kt:215-220`
 * 的注释原话：「不做这一步，编辑之前应用上的高亮会一直停在旧偏移上，直到下一次 daemon pass」）。
 * 锚点是**零宽**的插入点，所以只平移、不做「被吃掉就丢」：`mapPos(from, +1)` 让紧跟在被输入的
 * 标识符尾巴后面那条提示跟着文本一起走，而不是被留在插入点之前。
 */
export function hintField(onCommand: (command: string, args?: unknown[]) => void): StateField<HintEntry[]> {
  return StateField.define<HintEntry[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(setInlayHints)) return effect.value
      if (transaction.docChanged) {
        const changes = transaction.changes
        return value.map(entry => ({ ...entry, from: changes.mapPos(entry.from, 1) }))
      }
      return value
    },
    provide: f => EditorView.decorations.compute([f], state => {
      const builder = new RangeSetBuilder<Decoration>()
      for (const hint of [...state.field(f)].sort((a, b) => a.from - b.from))
        builder.add(hint.from, hint.from, Decoration.widget({ widget: new InlayWidget(hint, onCommand), side: 1 }))
      return builder.finish()
    }),
  })
}

export interface InlayHintDeps {
  enabled: () => boolean
  path: () => string
  view: () => EditorView | undefined
  /**
   * 三档开关（`src/inlayHints.ts` 的 `InlayHintToggles`）：InlaySettingsConfigurable（`inlay.hints`）
   * 按 provider 勾的那三格，在这里按 LSP `kind` 落地。宿主每次拉取都重新问一遍，
   * 所以设置一改再 `schedule()` 就能生效，不必重建控制器。
   */
  toggles?: () => InlayHintToggles
  /**
   * 点击一条**带命令**的提示 → 执行它（`workspace/executeCommand`）。
   * 没有这个回调时带命令的提示仍然画出来，但点不动（`onCommand` 缺省为 no-op）。
   */
  onCommand?: (command: string, args?: unknown[]) => void
  /**
   * 判据注入的假往返（生产仍用 `src/bridge.ts` 那一个；同一做法的先例见
   * `src/docHoverContent.ts:135` 与 `src/editorSymbolHighlight.ts` 的同名注入点）。
   */
  request?: <T>(method: string, params: Record<string, unknown>) => Promise<T>
  /**
   * **本地提供者注册表**（`src/inlayProviderRegistry.ts`，上游 `InlayHintsProvider` EP 的等价物）。
   * 缺省用一个空的注册表 —— 没注册任何提供者时行为与接线前逐字一致（一条本地提示都不产），
   * 所以 `CodeEditor.vue`（保留文件）不必改就能保持现状；宿主想开本地提示时注入一份
   * `createInlayProviderRegistry()`（内置 urlPath/parameterName/lineAuthor 三个）。
   */
  providers?: InlayProviderRegistry
  /**
   * 逐行作者（`git.blame`），只有 `lineAuthor` 提供者用。没有 git 通道时返回空数组
   * ⇒ 那个提供者不产条目（不写假作者）。
   */
  authors?: () => readonly InlayAuthorLine[]
}

/**
 * inlayHint 的按文件结果缓存（上游 `LspInlayHintsCache.kt:17-39` 那份具名特性，
 * 注册在 `LspHighlightingCacheRegistry.kt:31`）。状态机本体是 `HighlightingSnapshotCache`
 * —— 与诊断那条链共用的一份实现，只是这里管的是提示：
 *   · `pullPlan()` = 上游 `getHighlightings` 的那三档（这一修订已有快照 = `fresh` 不发；
 *     同一修订的请求在飞 = `dedup` 不发，`LspHighlightingCache.kt:95-102`；否则 `request`）；
 *   · `acceptFull()` = 上游 `responseReceived` 的接受闸门（`LspHighlightingCache.kt:170-177`：
 *     文档在飞期间又变了 ⇒ 这份答案的行列不再对应当前内容，整份不收）；
 *   · `acceptFailed()` 释放去重闸，下一拍重新问（`:118-119` 的 `Failed` 保旧值同效）；
 *   · 构造时自登记进 `clearAllLspCaches()`（语言服务重启、服务器 `workspace/inlayHint/refresh`）。
 * 存的是**服务器原文 + 锚点**，开关过滤留给渲染期（理由见文件头 ⑤）。
 */
export const inlayHintCache = new HighlightingSnapshotCache<LspInlayHint>()

/**
 * 服务端答案 → 缓存条目（锚点 = 这一份文档里的偏移）。
 * 落不进文档的条目丢掉（上游 `LspHighlightingCache.kt:215-222` 的 `getRangeInDocument(...) ?: continue`）。
 */
function anchorsOf(state: EditorState, hints: readonly LspInlayHint[] | undefined): Array<LspCachedHighlighting<LspInlayHint>> {
  const items: Array<LspCachedHighlighting<LspInlayHint>> = []
  for (const hint of hints ?? []) {
    try {
      const position = lspPosition(state.doc, hint.line, hint.character)
      items.push({ textRange: { start: position, end: position }, highlightingInfo: hint })
    } catch { /* 越界：丢掉这一条 */ }
  }
  return items
}

/** 上游把这一族归在 `LOW_PRIORITY_QUIESCENCE_DELAY`（300ms）那一档：`LspHighlightingCache.kt:52` + `:328`。 */
const DEBOUNCE_MS = LOW_PRIORITY_QUIESCENCE_MS

export function createInlayHints(deps: InlayHintDeps) {
  const send = deps.request ?? (bridgeRequest as <T>(method: string, params: Record<string, unknown>) => Promise<T>)
  let timer: number | undefined

  /**
   * 把缓存里的那一份画到屏幕上：渲染前归位（开关 → 排序 → 同位置去重/优先级，纯规则在
   * `src/inlayHintLayout.ts`）在这里做，**每次**都做 —— 于是"改了开关但文档没变"这一拍
   * 不发第二次请求也能立刻看到结果变了。
   *
   * **本地提供者**（`src/inlayProviderRegistry.ts`）产出的条目走**同一条归位链**（各自
   * `layoutInlayHints` 一次，于是三档开关与参数名排除清单对它们同样生效），再在**条目层**合流：
   * 同一 `from` + 同一 `text` 的以本地为准（与服务端条目同键去重），本地条目排在前面。
   * 没注入 `providers` 时本地那一半是空数组 ⇒ 画面与接线前逐字相同
   * （判据 `tests/inlay-hints-settings.test.mjs` 与 `tests/inlay-hints-exclude-list.test.mjs`
   * 钉着 `stored` / `layoutInlayHints(stored.map(...))` 这两行，故服务端那条路一行未动）。
   */
  function paint(path: string, toggles: InlayHintToggles): void {
    const editor = deps.view()
    if (!editor) return
    const stored = inlayHintCache.highlightingsFor(path)
    const anchors = new Map<LspInlayHint, number>()
    for (const item of stored) anchors.set(item.highlightingInfo, item.textRange.start)
    // 逐行条数**不设上限**：上游的上限是单条提示自己的 presentation 节点预算，不是"一行几条"，
    // 理由与出处见 `NO_INLAY_HINT_LINE_LIMIT`。
    const layout = layoutInlayHints(stored.map(item => item.highlightingInfo), toggles, { maxPerLine: NO_INLAY_HINT_LINE_LIMIT })
    const entries = layout.hints.flatMap(hint => {
      const from = anchors.get(hint)
      if (from === undefined) return []
      return [{
        from,
        text: hint.label,
        padLeft: !!hint.paddingLeft,
        padRight: !!hint.paddingRight,
        command: inlayHintCommand(hint) ?? undefined,
        tooltip: inlayHintTooltip(hint),
      } satisfies HintEntry]
    })
    // 本地条目：过同一条归位链（开关 + 排除清单），再换算偏移、前置、同键去重。
    const localEntries = localHintEntries(editor, path, toggles)
    const seen = new Set(localEntries.map(entry => `${String(entry.from)}:${entry.text}`))
    const painted = [...localEntries, ...entries.filter(entry => !seen.has(`${String(entry.from)}:${entry.text}`))]
    editor.dispatch({ effects: setInlayHints.of(painted) })
  }

  /**
   * 本地提供者 → 渲染条目：`collectAll` → `layoutInlayHints`（同一份 toggles，所以三档开关与
   * 参数名排除清单照旧生效）→ `lspPosition` 换算偏移。落不进文档的丢掉（与服务端同一条纪律）。
   * 没注入 `providers` 时返回空数组，整段不跑。
   */
  function localHintEntries(editor: EditorView, path: string, toggles: InlayHintToggles): HintEntry[] {
    if (!deps.providers) return []
    const collected = deps.providers.collectAll({
      path, language: languageOfPath(path), text: editor.state.doc.toString(),
      authors: deps.authors?.(),
    })
    if (!collected.length) return []
    const localLayout = layoutInlayHints(collected, toggles, { maxPerLine: NO_INLAY_HINT_LINE_LIMIT })
    const out: HintEntry[] = []
    for (const hint of localLayout.hints) {
      let from: number
      try { from = lspPosition(editor.state.doc, hint.line, hint.character) } catch { continue }
      out.push({
        from,
        text: hint.label,
        padLeft: !!hint.paddingLeft,
        padRight: !!hint.paddingRight,
        command: inlayHintCommand(hint) ?? undefined,
        tooltip: inlayHintTooltip(hint),
      })
    }
    return out
  }

  async function run() {
    const editor = deps.view()
    if (!editor || !deps.enabled()) return
    const path = deps.path()
    // 三档开关先取一次：这一拍里用它过滤（InlaySettingsConfigurable 的逐 provider 勾选）。
    const toggles = deps.toggles?.() ?? DEFAULT_INLAY_HINT_TOGGLES
    const revision = semanticRevisionOf(editor.state.doc)
    // 查表在缓存**之前**：上游 `LspHighlightingCache.kt:62-63` 的 `getHighlightings()` 第一行是
    // `if (!isSupportedForFile(file)) return emptyList()` —— 闸不过就连手里那份结果都不返回。
    // 于是"这个文件被改成不显示任何高亮 / 这条能力被服务器拒过"的那一拍必然撤掉旧提示，
    // 而不是靠缓存继续把旧提示画在屏幕上。
    if (!lspFileFeatures.plan('inlayHint', path).ask) { clear(); return }
    // 再问缓存要不要发（上游 `LspHighlightingCache.kt:62-84` 的 `getHighlightings`：
    // 这一修订已有快照就不重取，同一修订的请求在飞就搭那一次车）。
    const plan = inlayHintCache.pullPlan(path, revision)
    if (plan === 'fresh') { paint(path, toggles); return }
    if (plan === 'dedup') return
    // 每次请求前先查「这个文件支持哪些特性」的表（上游同一条链的闸是 `isSupportedForFile`，
    // 在 `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:62-63`
    // 于发请求之前问；inlayHint 那一条自己查的是 customizer + capability + 逐文件回调）。
    const attempt = await lspFileFeatures.ask<LspInlayHintResult>('inlayHint', path,
      () => send<LspInlayHintResult>('lsp.request', { kind: 'inlayHint', path, line: 0, character: 0 }))
    if (!attempt.asked) { inlayHintCache.acceptFailed(path); clear(); return }   // 这一族以后不会再有权威结果来覆盖：旧的撤干净
    if (!attempt.ok) {
      inlayHintCache.acceptFailed(path)
      // 这一次就是被**确定拒掉**的那一发（宿主回 `LSP_UNSUPPORTED` ⇒ 表里已经记下了）：
      // 画着的提示要撤掉 —— 留着就是一条"这台服务器声明没有"的能力还在屏幕上出东西。
      // 其它失败（超时/服务器在关）照旧留着旧提示，下一拍再问（与接入本缓存之前的吞错口径逐字一致）。
      if (!lspFileFeatures.plan('inlayHint', path).ask) clear()
      return
    }
    const items = anchorsOf(editor.state, attempt.value.hints)
    const target = deps.path() === path ? deps.view() : undefined
    if (!target) { inlayHintCache.acceptFailed(path); return }   // 视图/文件换了：释放去重闸，别让这一族永远不再问
    // 接受闸门：文档在飞期间又变了 ⇒ 整份不收（`acceptFull` 自己把在途标记清掉，下一拍必然重问）。
    if (!inlayHintCache.acceptFull(path, revision, semanticRevisionOf(target.state.doc), items)) return
    paint(path, toggles)
  }

  function schedule() {
    if (!deps.enabled()) return
    if (timer !== undefined) clearTimeout(timer)
    timer = window.setTimeout(() => { timer = undefined; void run() }, DEBOUNCE_MS)
  }

  // 服务器一句 `workspace/inlayHint/refresh` ⇒ **当场重新问一次**，不等下一次编辑。
  // 上游这条链的注释原文就写着这件事（`LspClientImpl.kt:242-252`）：
  //   "Handles a server-forced `workspace/inlayHint/refresh`: re-requests inlay hints for every opened
  //    file even without a document edit, then re-applies out-of-band. Invalidating the cache keeps the
  //    current hints on screen (no flicker)"
  // —— 两件事：`inlayHintsCache.invalidate(file)`（本仓由 `src/lspServerMessages.ts` 的 `handleRefresh`
  // → `clearAllLspCaches()` 统一做，`inlayHintCache` 构造时自登记过）+ `LspInlayApplier.scheduleRefresh(file)`
  // （就是这里的 `schedule()`）。已经画出来的不动：新答案到 `paint()` 那一拍整批换掉。
  const stopRefreshListener = addLspRefreshListener('workspace/inlayHint/refresh', () => schedule())

  function clear() {
    deps.view()?.dispatch({ effects: setInlayHints.of([]) })
  }

  function dispose() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    stopRefreshListener()
  }

  return {
    extension: [
      hintField((command, args) => deps.onCommand?.(command, args)) as Extension,
      // 样式跟这一个能力走：可点的提示是按钮，要去掉浏览器默认的边框/底色/字号，
      // 才和旁边只读的 `.cm-lsp-inlay`（`src/editorTheme.ts`）看起来一样。
      EditorView.theme({
        '.cm-lsp-inlay-actionable': {
          background: 'transparent', border: 'none', padding: '0', margin: '0',
          font: 'inherit', color: 'inherit', cursor: 'pointer',
        },
        '.cm-lsp-inlay-actionable:hover': { textDecoration: 'underline' },
      }),
    ],
    schedule, clear, dispose, run,
  }
}
