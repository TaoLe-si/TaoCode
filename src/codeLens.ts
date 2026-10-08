// LSP `textDocument/codeLens` —— IDEA 的 **Code Vision**（行上方"3 usages / 1 implementation"这类提示）。
//
// IDEA 侧已核实的类与行号：
//   · `CodeVisionProvider`（`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`）
//   · 产生条目 `computeForEditor(editor, uiData): List<Pair<TextRange, CodeVisionEntry>>`（`:62`）
//   · 点击行为 `handleClick(editor, textRange, entry)`（`:76`）
//   · 可用性 `isAvailableFor(project)`（`:35`）；锚点偏好 `defaultAnchor`（`:107`）
//
// 这个模块只管**纯规则**（挂到哪一行、点击要发什么命令）；CodeMirror 的渲染与调度在
// `codeLensExtension.ts`。

// 编辑档的静默窗口复用上游那一族的同一个常量（见 `CODE_LENS_REFRESH` 上面那条注释），
// 不在这里另写一个毫秒数。
import { LOW_PRIORITY_QUIESCENCE_MS } from './lspHighlightingCache.ts'

export interface CodeLensItem {
  /** 显示文字（LSP 把它放在 `command.title` 里）。 */
  title: string
  /** 要执行的命令名 —— 点击时转成 `workspace/executeCommand`。 */
  command: string
  /** 命令参数（可选）。 */
  arguments?: unknown[]
  /** 锚点区间（可选）。 */
  range?: { startLine: number; startChar: number; endLine: number; endChar: number }
  /**
   * 产出这一条的 provider（上游 `CodeVisionEntry.providerId`）。**LSP 协议里没有这一项**，
   * 所以服务端下发的条目这里是 `undefined` —— `src/codeLensSettings.ts` 的 `codeVisionGroupId()`
   * 把它们统一归到 `LSP_CODE_VISION_GROUP_ID`（上游也是同一组：`LspCodeVisionProvider.kt:65`
   * 的 `id = LSP_CODE_VISION_PROVIDER_ID`）。本地提供者（`src/codeVisionProviders.ts`）
   * 走渲染通道时填自己的 id，右键"隐藏这一个 provider"才找得到归属
   * （`ProjectCodeVisionModelImpl.kt:51`）。
   */
  providerId?: string
}

export interface CodeLensResult {
  available: boolean
  items?: CodeLensItem[]
}

/** 一条挂了锚点的 Code Vision 条目。 */
export interface AnchoredLens {
  line: number
  item: CodeLensItem
}

/** 命令名长度上限：LSP 的 `command` 是短标识符，超长的多半是适配器把整段文本塞了进来。 */
export const CODE_LENS_COMMAND_MAX = 256

/**
 * `arguments` 必须是 JSON 值数组（`ExecuteCommandParams.arguments?: LSPAny[]`）：
 * 点击时它要原样过桥（JSON 序列化）发给语言服务，带函数/循环引用/`undefined` 的参数
 * 会在桥接层炸掉或静默变形成 `null` —— 那等于**执行一条和用户看到的不一样的命令**。
 * 这里在最外层判定，返回第一个问题的说明（全部合法返回 null）。
 */
export function codeLensArgumentsProblem(args: unknown): string | null {
  if (args === undefined) return null
  if (!Array.isArray(args)) return '命令参数必须是数组。'
  for (const value of args) {
    const problem = jsonValueProblem(value, 0)
    if (problem) return problem
  }
  return null
}

function jsonValueProblem(value: unknown, depth: number): string | null {
  if (depth > 32) return '命令参数嵌套过深。'
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : '命令参数里有非有限数值。'
  if (Array.isArray(value)) {
    for (const entry of value) {
      const problem = jsonValueProblem(entry, depth + 1)
      if (problem) return problem
    }
    return null
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (entry === undefined) continue   // JSON 序列化会丢掉这个键，不改变语义
      const problem = jsonValueProblem(entry, depth + 1)
      if (problem) return problem
    }
    return null
  }
  return `命令参数里有不能序列化的值（${typeof value}）。`
}

/**
 * 一条条目能不能点：标题/命令非空、`range` 完整、参数是 JSON 值。
 * `anchoredLenses` 与点击路径共用它，免得「渲染时通过、点击时发出坏命令」。
 */
export function codeLensItemProblem(item: CodeLensItem | undefined): string | null {
  if (!item) return '没有条目。'
  if (typeof item.command !== 'string' || !item.command.trim()) return '命令名为空。'
  if (item.command.length > CODE_LENS_COMMAND_MAX) return '命令名过长。'
  return codeLensArgumentsProblem(item.arguments)
}

/**
 * 按行整理成可渲染的列表。
 *
 * **没有 `range` 的条目丢弃**：IDEA 靠 `defaultAnchor` 决定挂在行首还是行尾，而 LSP 用 `range`
 * 表达同一件事 —— 没有它就不知道该挂哪一行，挂到第 0 行是**编造**一个位置。
 * 同一行多条时保持适配器给的顺序（顺序通常带语义）。
 * 命令不合法（空串/超长/参数不能过桥）的条目同样丢弃：`codeLensCommand` 会拒绝执行它。
 */
export function anchoredLenses(items: readonly CodeLensItem[] | undefined): AnchoredLens[] {
  if (!Array.isArray(items)) return []
  const out: AnchoredLens[] = []
  for (const item of items) {
    const range = item?.range
    if (!range) continue
    if (!Number.isInteger(range.startLine) || range.startLine < 0) continue
    if (typeof item.title !== 'string' || item.title === '') continue
    if (codeLensItemProblem(item)) continue
    out.push({ line: range.startLine, item })
  }
  // 稳定排序（同行的保持原顺序），block widget 必须按位置递增添加。
  return out.map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.line - right.entry.line || left.index - right.index)
    .map(({ entry }) => entry)
}

/**
 * 同一锚点上**可见**条目的上限 —— `CodeVisionHost.kt:85` 的 `defaultVisibleLenses = 5`：
 * `CodeVisionListData.updateVisible()`（`CodeVisionListData.kt:45-57`）对同一锚点的条目做
 * `min(count, size)` 截断（设置页只覆盖这个缺省值，本仓没有该设置页）。
 * 「更多…」入口由注册表开关 `editor.codeVision.more.inlay` 控制，缺省 false
 * （`platform/util/resources/misc/registry.properties:1759`），所以被截掉的条目默认不显示入口。
 */
export const CODE_LENS_VISIBLE_MAX = 5

/**
 * 一个锚点上要画的一行。上游把同一 `TextRange` 上多个 provider 的条目放进**同一个 inlay**
 * 的列表里、用间隔逐个画（`CodeVisionListPainter.kt:37-49`），而不是一行一条（本模块此前的形态）。
 * LSP 的锚点就是条目的 `range`：同一符号上多个 provider 的条目共享同一个区间，故按区间身份归并。
 */
export interface CodeLensAnchorRow {
  /** 块装饰挂到的行（0 基）。 */
  line: number
  /** 锚点起始列 —— 同一行的两个不同锚点靠它保持稳定顺序。 */
  startChar: number
  /** 该锚点要渲染的条目（已按上限截断，顺序 = 适配器给的顺序）。 */
  items: CodeLensItem[]
  /** 被上限截掉、不显示的条数（上游缺省没有「更多」入口）。 */
  hidden: number
}

/**
 * 把 `anchoredLenses` 的结果按锚点区间归并成"每锚点一行"。
 * 行序按 `(line, startChar, 首次出现顺序)` 稳定排序，保证 block widget 按位置递增添加。
 */
export function groupAnchoredLenses(lenses: readonly AnchoredLens[], limit = CODE_LENS_VISIBLE_MAX): CodeLensAnchorRow[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : CODE_LENS_VISIBLE_MAX
  const groups = new Map<string, { line: number; startChar: number; order: number; items: CodeLensItem[] }>()
  for (const lens of lenses) {
    const range = lens.item.range
    if (!range) continue   // `anchoredLenses` 已过滤；这里再守一道，函数单独用时也不编造位置
    const key = `${range.startLine}:${range.startChar}:${range.endLine}:${range.endChar}`
    const existing = groups.get(key)
    if (existing) existing.items.push(lens.item)
    else groups.set(key, { line: range.startLine, startChar: range.startChar, order: groups.size, items: [lens.item] })
  }
  return [...groups.values()]
    .sort((left, right) => left.line - right.line || left.startChar - right.startChar || left.order - right.order)
    .map(group => ({
      line: group.line,
      startChar: group.startChar,
      items: group.items.slice(0, cap),
      hidden: Math.max(0, group.items.length - cap),
    }))
}

/** 点击要发什么。缺省 `arguments` 时**不带这个键**（`executeCommand` 里它是可选的）；
 *  条目不合法（`codeLensItemProblem`）时返回 null —— 不发出与用户看到的不一致的命令。 */
export function codeLensCommand(item: CodeLensItem | undefined): { command: string; arguments?: unknown[] } | null {
  if (codeLensItemProblem(item)) return null
  return Array.isArray(item!.arguments) ? { command: item!.command, arguments: item!.arguments } : { command: item!.command }
}

/**
 * 条目标题里的 **codicon 记号**（VS Code 那一套 `$(play) Run tests`）。
 *
 * 上游 `platform/lsp-impl/src/impl/features/codeLens/CodeLensTitle.kt`：
 *   · `parseCodeLensTitle`（`:25-34`）把标题拆成「显示文本 + 可选图标」：
 *     没有 `$(` 就原样返回（`:26`）；否则**每个** codicon 记号都从文本里删掉（`:28-31`、
 *     注释 `:23`），**第一个已知**的记号成为图标（`:29`，未知的会让 `icon` 继续是 null，
 *     所以后面那个已知的仍能顶上）；文本删空且没有图标时回退成原标题（`:32`）。
 *   · 已知记号只有四个（`:13-18`）：`play`/`run` → Execute，`debug`/`debug-alt` → StartDebugger。
 *   · 消费方 `LspCodeVisionProvider.kt:54-55`：`ClickableTextCodeVisionEntry(presentation.text, id, handler, presentation.icon)`。
 *
 * 不做这件事的后果很具体：rust-analyzer / vscode-java 这类服务器发的标题里就带着 `$(play)`，
 * 用户会在编辑器里**原样看到 `$(play) Run test`** —— 记号语法没有被翻译成图标。
 */
export type CodeLensTitleIcon = 'execute' | 'debug'

export interface CodeLensTitleParts {
  /** 画出来的文字（所有 codicon 记号都已删除）。 */
  text: string
  /** 第一个已知记号对应的图标；没有已知记号就是 null。 */
  icon: CodeLensTitleIcon | null
}

export const CODE_LENS_CODICON_ICONS: Record<string, CodeLensTitleIcon> = {
  play: 'execute',
  run: 'execute',
  debug: 'debug',
  'debug-alt': 'debug',
}

export function parseCodeLensTitle(title: string | undefined | null): CodeLensTitleParts {
  if (typeof title !== 'string') return { text: '', icon: null }
  if (!title.includes('$(')) return { text: title, icon: null }
  let icon: CodeLensTitleIcon | null = null
  // 正则带 g 标志（要一次替换掉**所有**记号），而带 g 的正则会带 `lastIndex` 状态 ——
  // 放在函数体里新建，模块级常量会让第二次调用接着上次的偏移继续扫。
  const text = title.replace(/\$\(([\w-]+)\) ?/g, (_whole, name: string) => {
    if (icon === null) icon = CODE_LENS_CODICON_ICONS[name] ?? null
    return ''
  }).trim()
  if (!text && icon === null) return { text: title, icon: null }
  return { text, icon }
}

/** 悬停提示：告诉用户点一下会发生什么（IDEA 的 Code Vision 也有 tooltip）。 */
export function codeLensTooltip(item: CodeLensItem | undefined): string {
  if (!item) return ''
  return `执行 ${item.command}${item.arguments?.length ? `（${item.arguments.length} 个参数）` : ''}`
}

/**
 * 什么时候重新问一次 codeLens —— **刷新时机**：
 *   · `open`：打开文件 / 语言服务刚就绪，立即补一次（此时还没有任何条目）—— 与上游"该文件的首次
 *     拉取绕开静默窗口"同一形状（`platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:146`
 *     的 `!isFirstPullFor(file)`，判断本体在 `:161`）；
 *   · `change`：编辑后的**静默窗口**（document 得先稳定这么久才发拉取），数值 = 上游低优先级那一族的
 *     `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:328`
 *     `LOW_PRIORITY_QUIESCENCE_DELAY = 300.milliseconds`；`:324-327` 把这一族点名成
 *     "Semantic tokens, document links, folding, **code lens**, inlay hints, and colors"，
 *     而 `:52` 的 `quiescenceDelay` 缺省就取它 —— 所以 codeLens 的编辑档与那一族是**同一个数、
 *     同一条上游**（本仓经 `src/lspHighlightingCache.ts` 的 `LOW_PRIORITY_QUIESCENCE_MS` 复用同一份
 *     常量，不复制数字）。行号依赖精确位置，文档一变旧条目就作废。
 *     订正留痕（2026-10-06 hlcache300）：这一条原来写"与其它 LSP 能力**同档**去抖"配的却是
 *     `changeMs: 400`，而本仓那一族其它点数的是 300（上游也是 300）—— 注释与数字互相矛盾，现按
 *     上游 `:328` 对齐；400 没有任何上游出处（参考树里 `LspHighlightingCache.kt` 只有 250/300 两个数）。
 *   · `focus`：编辑器重新获得焦点（用户去别的视图里改名/加引用之后回来）—— 去抖更长，
 *     因为 alt-tab 会连着触发，而这条请求是**整文档**的（见 `native/lsp_session.cpp` 的整形）。
 *     **这一档没有上游对应物**：上游那份缓存只由文档变更驱动，没有"重新获得焦点"这个触发点，
 *     所以 700 是本仓自定的值，不声称与上游同源（无法核实＝上游压根没这条）。
 *
 * 视口滚动**不重查**：请求本来就是整文档的，滚动不会带来新信息；IDEA 按可见区算是因为
 * 它的 provider 按需计算，本仓的通道不是。
 */
export type CodeLensTrigger = 'open' | 'change' | 'focus'

export interface CodeLensRefreshPolicy {
  openMs: number
  changeMs: number
  focusMs: number
}

export const CODE_LENS_REFRESH: CodeLensRefreshPolicy = { openMs: 0, changeMs: LOW_PRIORITY_QUIESCENCE_MS, focusMs: 700 }

export function codeLensRefreshDelay(trigger: CodeLensTrigger, policy: CodeLensRefreshPolicy = CODE_LENS_REFRESH): number {
  if (trigger === 'open') return policy.openMs
  if (trigger === 'focus') return policy.focusMs
  return policy.changeMs
}
