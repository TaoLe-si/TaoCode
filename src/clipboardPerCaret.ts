// 多光标粘贴时的**按光标切分** —— 上游 `platform/platform-impl/src/com/intellij/openapi/editor/
// ClipboardTextPerCaretSplitter.java` 与它的两个数据来源 `CaretStateTransferableData.java`。
//
// 上游那一套的形状（逐条开过源码）：
//   · 复制时 `EditorCopyPasteHelperImpl.java:94` 把每个光标的 `startOffsets`/`endOffsets` 收进
//     `CaretStateTransferableData`（`:63-95`），作为一个自定义 `DataFlavor` 挂在剪贴板载荷上；
//   · 粘贴时 `:127-150` 取回它、把整段文本按 `ClipboardTextPerCaretSplitter.split(text, caretData, caretCount)`
//     切成每光标一段，再 `caretModel.runForEachCaret` 逐段插入（`:174-180`）。
//   · `ClipboardTextPerCaretSplitter.java:15-52` 的规则（那张表就是它的全部语义）：
//       caretCount <= 0  → 抛 IllegalArgumentException；
//       caretCount == 1  → 整段给这一个光标；
//       caretData == null → 按 `\n` 切（**保留**尾空段，`split("\n", -1)`），
//                           `sourceCaretCount = (lines.length == 2 && lines[1].isEmpty()) ? 1 : lines.length`；
//       有 caretData     → `sourceCaretCount = startOffsets.length`，每段 = `substring(start[i], end[i])`；
//       源光标数 == 1 的那两档都是「整段给每个目标光标」；
//       目标光标数 > 源光标数时，多出来的光标拿**空串**（不是复用最后一段）。
//
// **本仓的如实差异（两处，都在这里写明，不假装一致）**：
//   1. DOM 剪贴板只能带文本，带不了自定义 flavor ⇒ 「按光标切分」的源侧偏移只能在本进程内保留
//      （`rememberCopiedCarets`）。跨应用复制过来的多行文本走 `caretData == null` 那一档
//      （按 `\n` 切），与上游「外部剪贴板没有 flavor」的行为逐字一致。
//   2. 上游 `runForEachCaret` 逐光标插入是编辑器侧的动作；本仓把它落在 `src/editorPaste.ts`
//      的粘贴通道里（CodeMirror 的 `view.state.selection.ranges` 就是全部光标）。
//
// 判据：`tests/clipboard-per-caret.test.mjs`。

/** 上游 `CaretStateTransferableData`：一次复制时各光标的起止偏移。 */
export interface CaretState {
  startOffsets: readonly number[]
  endOffsets: readonly number[]
}

/**
 * 把整段文本按目标光标数切分（`ClipboardTextPerCaretSplitter.split`）。
 *
 * @param input      剪贴板里的整段文本
 * @param caretData  复制侧的逐光标偏移（本进程内保留；外部剪贴板没有 ⇒ null）
 * @param caretCount 目标光标数（编辑器当前有几个光标）
 */
export function splitTextPerCaret(input: string, caretData: CaretState | null, caretCount: number): string[] {
  // `ClipboardTextPerCaretSplitter.java:16-18`：光标数必须为正。
  if (!Number.isInteger(caretCount) || caretCount <= 0) throw new Error('光标数必须是正整数')
  if (caretCount === 1) return [input]
  const result: string[] = []
  if (caretData === null) {
    // `:35-46`：`input.split("\n", -1)` 保留尾空段；只多出一个空尾段时算「一个源光标」。
    const lines = input.split('\n')
    const sourceCaretCount = lines.length === 2 && lines[1] === '' ? 1 : lines.length
    for (let i = 0; i < caretCount; i++) {
      result.push(sourceCaretCount === 1 ? lines[0]! : (i < lines.length ? lines[i]! : ''))
    }
    return result
  }
  // `:48-59`：有逐光标偏移时按偏移切片；源光标数为 1 则整段给每个目标光标。
  const sourceCaretCount = caretData.startOffsets.length
  for (let i = 0; i < caretCount; i++) {
    if (sourceCaretCount === 1) result.push(input)
    else if (i < sourceCaretCount) result.push(input.slice(caretData.startOffsets[i]!, caretData.endOffsets[i]!))
    else result.push('')
  }
  return result
}

/**
 * 本进程内保留的「上一次复制时各光标的偏移」——DOM 剪贴板带不了自定义 flavor，
 * 这是上游那个 `CaretStateTransferableData` flavor 在本仓的替身。
 * 只在**同一个应用实例**内有效；跨应用复制一律走 `caretData == null` 那一档。
 */
let copiedCarets: CaretState | null = null

/** 复制侧记录（上游 `EditorCopyPasteHelperImpl.java:94` 收集 `extraDataCollector`）。 */
export function rememberCopiedCarets(state: CaretState | null): void { copiedCarets = state }

/** 粘贴侧取回（上游 `CaretStateTransferableData.getFrom(content)`，`:144`）。 */
export function copiedCaretsForPaste(): CaretState | null { return copiedCarets }

/**
 * 从一组选区（CodeMirror 的 `selection.ranges` 或任何 `{from,to}` 列表）折出 `CaretState`。
 * 上游 `EditorCopyPasteHelperImpl.java:63-95` 逐光标收 `startOffsets`/`endOffsets`，这里同形。
 */
export function caretStateFromRanges(ranges: readonly { from: number; to: number }[]): CaretState {
  return {
    startOffsets: ranges.map(range => range.from),
    endOffsets: ranges.map(range => range.to),
  }
}

/** 上游 `CaretStateTransferableData.areEquivalent`（`:60-64`）：两边都不足两个光标时视为等价。 */
export function caretStatesEquivalent(left: CaretState | null, right: CaretState | null): boolean {
  const single = (state: CaretState | null) => state === null || state.startOffsets.length === 1
  if (single(left) && single(right)) return true
  if (left === null || right === null) return false
  return left.startOffsets.length === right.startOffsets.length
    && left.endOffsets.length === right.endOffsets.length
    && left.startOffsets.every((value, index) => value === right.startOffsets[index])
    && left.endOffsets.every((value, index) => value === right.endOffsets[index])
}