// 用折叠标记包围选区（`lp/custom-folding` 判决点名的缺口：`CustomFoldingSurroundDescriptor`）。
//
// 上游坐标（判定基准只有上游源码树）：
//   · `platform/lang-impl/src/com/intellij/lang/folding/CustomFoldingSurroundDescriptor.java`
//     `:43` 这个描述符实现的是**通用**的 `SurroundDescriptor`（就是 Ctrl+Alt+T「Surround With」列表里的一项一族）；
//     `:47` `DEFAULT_DESC_TEXT = "Description"`；
//     `:217-227` `getSurrounders()` = **每个已注册的 provider 一个 surrounder**（顺序 = EP 注册顺序），
//     `:243-246` 列表里那一行的标题就是 provider 的 `getDescription()`；
//     `:229-232` `isExclusive()` 为 false ⇒ 与其它 surround 项并列，不独占。
//   · 能不能包围（`:49-74` `getElementsToSurround`）：选区得**非空**（`:51`），
//     并且这门语言得有注释词法（`:52-56`：有行注释前缀，或者块注释前后缀成对齐全），否则一项都不给。
//     元素再按「跨过换行的最近父节点」吸附到整行（`:153-169`/`:175-188`）⇒ 本仓的等价物是**吸附到整行**。
//   · 落地那一步（`:267-321` `doSurround`）逐条对应下面的实现：
//     `:275-289` 前缀 = 行注释前缀，没有行注释时退到块注释前后缀（`wrapStartEndMarkerTextInLanguageSpecificComment()`
//       默认 true，`platform/core-api/src/com/intellij/lang/folding/CustomFoldingProvider.java:43-45`）；
//     `:292-295` `startIndent` = 开始偏移之前那段行首空白（新起的两行沿用同一份缩进）；
//     `:298-304` 开始标记里的 `?` 换成 `Description`，并把那段文字**选上**让用户改名；
//     `:306-307` 两个字符串的形状（`前缀 + 标记 + 后缀 + 换行 + 缩进` 与 `换行 + 缩进 + 前缀 + 收尾标记 + 后缀`）；
//     `:308-311` **先插尾部再插头部**（否则头部的长度会把尾部偏移推走）；
//     `:313` 选择区间整体右移 `prefixLength`（正好落在标记文字上，跳过注释前缀）。
//   · provider 的适用范围（`:249-260`）要问 `isSupported(language)` 与 `isSupportedBy(FoldingBuilder)`；
//     provider 表 `CustomFoldingProvider.java:60-62` 的 `isSupported` 默认对**所有语言**为真，
//     本仓的自定义折叠对每种语言都是本地扫标记（`src/editorFolding.ts` 的 `localRegionFolds`）
//     ⇒ 两种问法在这里都成立，不再另设语言门槛。
//   · **没搬的一条**：`:316-317` 的 `adjustLineIndent`（插完之后让格式化器把两行标记的缩进调正）
//     —— 本仓没有可独立调用的「按范围调整缩进」的格式化器（格式化走 LSP 的 `textDocument/formatting`，
//     要整篇回包），所以两行标记一律沿用选区首行的缩进，具体卡点记在报告里。
//
// provider 从哪来：`src/customFoldingProviders.ts` 那张表（EP 注册顺序、标记、占位规则、Surround 标题）。
// 这里不重复定义任何标记文本，避免与折叠识别那一处认得不一样。
import { CUSTOM_FOLDING_PROVIDERS, type CustomFoldingProviderInfo } from './customFoldingProviders.ts'
import type { CommentStyle } from './commentToggle.ts'

/** `CustomFoldingSurroundDescriptor.java:47`。 */
export const DEFAULT_DESC_TEXT = 'Description'

export interface SurroundEdit { from: number; insert: string }

export interface SurroundResult {
  /** 两处插入（**尾部在前**，`:308-311`；偏移都是**原文**坐标）。 */
  edits: SurroundEdit[]
  /** 要选上的那段（标记里的说明文字，`:298-304` + `:313`）。 */
  selection: { from: number; to: number }
  /** 落地后的全文（测试与命令都用它，免得两边各拼一次）。 */
  text: string
}

/**
 * 选区吸附到整行：起在首行第一个非空白字符，止在末行行尾（`:153-188` 的文本等价）。
 * 「选区里没有任何实际元素」这一档由 `end <= snappedFrom` 那一条挡住：`body.trimStart()` 把跨行的
 * 空白（含换行）一路剥到底，整段都是空白时 `snappedFrom` 正好落到 `end` ⇒ 返回 null。
 * 上游同一条规矩在 `:56-61`：首尾的 `PsiWhiteSpace` 各挪一个兄弟，挪完首尾是同一个空白 token
 * 就直接返回空数组 —— 一处空白选区不该在文件里插下两条孤零零的标记。
 * （本轮先加过一条「吸附完整段都是空白」的显式判据，实测**不可达**、被前一条完全覆盖 ⇒ 已删；
 * 判据留在 `tests/folding-custom-region-surround.test.mjs` 盯着这条路径。）
 */
function snapToLines(text: string, from: number, to: number): { from: number; to: number } | null {
  if (to <= from) return null                                // `:51` 空选区不给包围
  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  let end = text.indexOf('\n', to - 1)
  if (end < 0) end = text.length                             // 选区伸到最后一行 ⇒ 止于文尾
  const body = text.slice(lineStart, end)
  const shift = body.length - body.trimStart().length
  const snappedFrom = lineStart + shift
  if (end <= snappedFrom) return null                        // 整段都是空白 ⇒ 没有可包围的元素（`:56-61`）
  return { from: snappedFrom, to: end }
}

/** 文档里用得着的换行符（上游 `document.insertString("\n")` 由 Document 按行的分隔符落地）。 */
function lineSeparator(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * 用某个 provider 的标记把 `from`…`to` 那几行包起来。
 * 不适用（空选区 / 这门语言没有注释词法）返回 null。
 */
export function surroundWithRegion(
  text: string, from: number, to: number, provider: CustomFoldingProviderInfo, commenter: CommentStyle,
): SurroundResult | null {
  const range = snapToLines(text, from, to)
  if (!range) return null
  // `:275-289`：先取行注释前缀，取不到再用块注释那一对；两个都没有 ⇒ 不动。
  let prefix = commenter.line ?? ''
  let suffix = ''
  if (!prefix) {
    prefix = commenter.block?.[0] ?? ''
    suffix = commenter.block?.[1] ?? ''
  }
  if (!prefix) return null
  const eol = lineSeparator(text)
  // `:295` 新起的两行沿用首行的缩进。
  const lineStart = text.lastIndexOf('\n', Math.max(0, range.from - 1)) + 1
  const startIndent = text.slice(lineStart, range.from)
  // `:298-304`：`?` 换成 `Description`，那段文字要被选中。
  let startText = provider.startString
  const descPos = startText.indexOf('?')
  if (descPos >= 0) startText = startText.replace('?', DEFAULT_DESC_TEXT)
  const head = `${prefix}${startText}${suffix}${eol}${startIndent}`
  const tail = `${eol}${startIndent}${prefix}${provider.endString}${suffix}`
  // `:308-311` 先插尾部，头部插在更靠前的位置，两处的原文偏移因此都还有效。
  const edits: SurroundEdit[] = [{ from: range.to, insert: tail }, { from: range.from, insert: head }]
  const next = text.slice(0, range.from) + head + text.slice(range.from, range.to) + tail + text.slice(range.to)
  return {
    edits,
    text: next,
    // `:313` `rangeToSelect.shiftRight(prefixLength)`：跳过注释前缀，正好框住标记里的说明文字。
    selection: descPos >= 0
      ? { from: range.from + prefix.length + descPos, to: range.from + prefix.length + descPos + DEFAULT_DESC_TEXT.length }
      : { from: range.from + head.length, to: range.from + head.length },
  }
}

/** 「Surround With」列表里的那几行（`:217-227`：每个 provider 一项，顺序 = EP 注册顺序）。 */
export interface CustomFoldingSurroundItem {
  /** provider 的实现类简名（`//<region>` 那一族没有实现类 ⇒ 空串，见 provider 表）。 */
  id: string
  /** 列表标题 = `CustomFoldingProvider.getDescription()`。 */
  title: string
  provider: CustomFoldingProviderInfo
}

export function customFoldingSurrounders(): CustomFoldingSurroundItem[] {
  return CUSTOM_FOLDING_PROVIDERS.map(provider => ({
    id: provider.id, title: provider.description, provider,
  }))
}

/** 按 id 取一项（`id` 是 provider 表里那个简名；空串 = `//<region>` 那一族）。 */
export function customFoldingSurrounder(id: string): CustomFoldingSurroundItem | null {
  return customFoldingSurrounders().find(item => item.id === id) ?? null
}
