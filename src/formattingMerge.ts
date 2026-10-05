// 格式化结果合并 —— 上游 `com.intellij.formatting.service.DocumentMerger` 的接缝语义。
//
// 上游：`AsyncDocumentFormattingSupportImpl.kt:315-325` 在格式化任务回来时比较
// `document.modificationStamp` 与发起时的快照 —— 文档没被动过就直接 `setText(newText)`，
// 被动过就交给 `DocumentMerger` 扩展点逐个尝试 `updateDocument(document, newText)`，
// 全都返回 false 时**保持文档原样**（宁可放弃这一次格式化，也不覆盖用户的编辑）。
//
// 本仓的真实缺陷（这就是要补的东西）：`src/semanticActions.ts` 的 `runFormatting` 把
// 语言服务返回的 textEdits 直接套在**响应时刻**的缓冲文本上 —— 而 edits 的行列坐标是
// 服务端按**请求时刻**的文档算的。格式化期间用户敲了字，坐标就错位，会把文本改花。
//
// 本模块实现同一档保护：格式化改动区间与用户改动区间重叠 ⇒ 拒绝合并（保留用户文本，
// 由调用方提示重跑）；不重叠 ⇒ 按用户编辑造成的位移把格式化结果套上去。
// 与上游的差别：上游是扩展点，具体实现可做更细的多区间合并；本仓先做单区间
// （前后缀 diff）的保守版本，宁可少合并也不产生错乱文本。

export interface MergeInput {
  /** 发起格式化请求时的文档文本（语言服务看到的快照）。 */
  originalText: string
  /** 响应时刻的缓冲文本（可能被用户改过）。 */
  currentText: string
  /** 对 `originalText` 应用格式化编辑后的文本。 */
  formattedText: string
}

export interface MergeResult {
  /** 要写回缓冲的文本；拒绝合并时就是 `currentText`。 */
  text: string
  merged: boolean
  reason: 'unchanged' | 'applied' | 'shifted' | 'no-change' | 'conflict'
}

interface DiffRegion {
  start: number
  end: number
  replacement: string
}

function commonPrefix(a: string, b: string, limit: number): number {
  let i = 0
  const max = Math.min(a.length, b.length, limit)
  while (i < max && a[i] === b[i]) ++i
  return i
}

function commonSuffix(a: string, b: string, limit: number): number {
  let i = 0
  const max = Math.min(a.length, b.length, limit)
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) ++i
  return i
}

/** 单区间 diff：`a` 与 `b` 的公共前后缀之间的那段就是要替换的区间。 */
export function diffRegion(a: string, b: string): DiffRegion {
  const prefix = commonPrefix(a, b, Number.MAX_SAFE_INTEGER)
  const suffix = commonSuffix(a, b, Math.min(a.length, b.length) - prefix)
  return { start: prefix, end: a.length - suffix, replacement: b.slice(prefix, b.length - suffix) }
}

export function mergeFormattingResult({ originalText, currentText, formattedText }: MergeInput): MergeResult {
  if (formattedText === originalText) return { text: currentText, merged: true, reason: 'no-change' }
  if (currentText === originalText) return { text: formattedText, merged: true, reason: 'unchanged' }

  const formatDiff = diffRegion(originalText, formattedText)
  const userDiff = diffRegion(originalText, currentText)
  // 两边都没变出区间（理论上前面两个相等分支已挡住）——保守当作冲突。
  if (formatDiff.start === formatDiff.end && formatDiff.replacement === '') return { text: currentText, merged: true, reason: 'no-change' }

  // 重叠判定含端点：用户的零宽插入恰好落在格式化区间内/边界时也拒绝（
  // 边界处的先后顺序无法从坐标判断，宁可让用户重跑一次）。
  const overlaps = userDiff.start <= formatDiff.end && formatDiff.start <= userDiff.end
  if (overlaps) return { text: currentText, merged: false, reason: 'conflict' }

  // 用户改动在格式化区间之前 ⇒ 格式化区间在 currentText 里整体右移 delta。
  const shifted = userDiff.end <= formatDiff.start
  const at = shifted ? formatDiff.start + (currentText.length - originalText.length) : formatDiff.start
  // 落点处必须仍是原始文本（否则说明 diff 区间估错，拒绝合并）。
  const span = originalText.slice(formatDiff.start, formatDiff.end)
  if (currentText.slice(at, at + span.length) !== span) return { text: currentText, merged: false, reason: 'conflict' }
  const text = currentText.slice(0, at) + formatDiff.replacement + currentText.slice(at + span.length)
  return { text, merged: true, reason: shifted ? 'shifted' : 'applied' }
}
