// 剪贴板历史环 + 系统剪贴板写入通道 —— IDEA `CopyPasteManagerWithHistory` 的对应物。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 环本体 `platform/platform-impl/src/com/intellij/ide/CopyPasteManagerWithHistory.java`
//       - `setContents`（:59-65）→ `addNewContentToStack`（:96-141）→ `addToTheTopOfTheStack`（:143-146）
//       - 去重 `:127-137`：扫**全表**找同文本项，找到就把它删掉再把新项压到表头（这一支不再裁剪）
//       - `getAllContents`（:221-227）：先看系统剪贴板文本是否与表头不同，不同就先压表头
//       - `removeContent`（:229-238）/ `moveContentToStackTop`（:240-252）
//       - 体积估算 `getSize`（:274-289）：字符串项 = `StringUtil.length`（= JS 的 `text.length`，UTF-16 码元数）
//   · 裁剪 `platform/platform-impl/src/com/intellij/ide/CopyPasteManagerEx.java:101-116`
//       （`deleteAfterAllowedMaximum`：先截到上限条数，再从**尾部**向头部把超过
//        `maxMemory/maxCount/10` 的项替换成"已清除"占位符，**下标 0 永不清理**，总内存达标即停）
//   · 上限来自 registry：`platform/util/resources/misc/registry.properties:1881` `clipboard.history.max.items=100`、
//       `:1883` `clipboard.history.max.memory=10000000`
//   · 占位符文案 `platform/platform-api/resources/messages/UIBundle.properties:208`
//       `clipboard.history.purged.item=<purged>`
//
// 与 IDEA 的差异（如实）：IDEA 的项是 `Transferable`，也可能是图片/文件列表；TaoCode 的编辑器只吃文本，
// 所以环里存的是字符串（对应 `StringSelection`），体积也就按字符串长度算 —— 这正是源码 `getSize` 对
// `StringSelection` 的处理分支，不是简化的近似。

/** registry.properties:1881 `clipboard.history.max.items`。 */
export const CLIPBOARD_MAX_ITEMS = 100
/** registry.properties:1883 `clipboard.history.max.memory`（单位=字符数，源码按 `StringUtil.length` 估）。 */
export const CLIPBOARD_MAX_MEMORY = 10_000_000
/** UIBundle.properties:208 `clipboard.history.purged.item`。 */
export const CLIPBOARD_PURGED_TEXT = '<已清除>'

/** 环里的一项。`purged` 为真时文本已被"已清除"占位符替换（源码的 `createPurgedItem()`）。 */
export interface ClipboardEntry { text: string; purged: boolean }

/** 源码 `deleteAfterAllowedMaximum` 的"小项阈值"：`maxMemory / maxCount / 10`。 */
export function smallItemLimit(maxItems = CLIPBOARD_MAX_ITEMS, maxMemory = CLIPBOARD_MAX_MEMORY): number {
  return maxMemory / maxItems / 10
}

function totalSize(ring: readonly ClipboardEntry[]): number {
  let sum = 0
  for (const entry of ring) sum += entry.text.length
  return sum
}

/**
 * `CopyPasteManagerEx.deleteAfterAllowedMaximum`（:101-116）的逐句复刻：
 * 先截到 `maxItems`，再从尾向头把超阈值的项替换成占位符，**下标 0 不清理**，总内存达标即停。
 */
export function trimClipboardHistory(ring: readonly ClipboardEntry[], maxItems = CLIPBOARD_MAX_ITEMS,
                                     maxMemory = CLIPBOARD_MAX_MEMORY): ClipboardEntry[] {
  const limit = smallItemLimit(maxItems, maxMemory)
  // `data.subList(maxCount, data.size()).clear()`
  const next = ring.slice(0, Math.max(0, maxItems)).map(entry => ({ ...entry }))
  // `while (data.getSum() > maxMemory && it.hasPrevious() && it.previousIndex() > 0)`
  for (let index = next.length - 1; index > 0; --index) {
    if (totalSize(next) <= maxMemory) break
    if (next[index]!.text.length > limit) next[index] = { text: CLIPBOARD_PURGED_TEXT, purged: true }
  }
  return next
}

/**
 * `addNewContentToStack` + `addToTheTopOfTheStack`（:96-146）：
 * 同文本项先从表中移除（不再裁剪），然后新项压到表头并裁剪。
 */
export function pushClipboardContent(ring: readonly ClipboardEntry[], text: string,
                                     maxItems = CLIPBOARD_MAX_ITEMS, maxMemory = CLIPBOARD_MAX_MEMORY): ClipboardEntry[] {
  if (!text) return [...ring]
  const existing = ring.findIndex(entry => entry.text === text)
  if (existing >= 0) {
    const rest = ring.filter((_, index) => index !== existing)
    return [{ text, purged: false }, ...rest]
  }
  return trimClipboardHistory([{ text, purged: false }, ...ring], maxItems, maxMemory)
}

/** `getAllContents`（:221-227）的前半步：系统剪贴板文本与表头不同就先压表头。 */
export function syncSystemClipboard(ring: readonly ClipboardEntry[], clipboardText: string | null,
                                    maxItems = CLIPBOARD_MAX_ITEMS, maxMemory = CLIPBOARD_MAX_MEMORY): ClipboardEntry[] {
  if (clipboardText === null || clipboardText === '') return [...ring]
  if (ring.length && ring[0]!.text === clipboardText) return [...ring]
  return pushClipboardContent(ring, clipboardText, maxItems, maxMemory)
}

/** `removeContent`（:229-238）：删掉该项；删的是表头时系统剪贴板要回落到新的表头（空表则写空串）。 */
export function removeClipboardContent(ring: readonly ClipboardEntry[], index: number): ClipboardEntry[] {
  if (index < 0 || index >= ring.length) return [...ring]
  return ring.filter((_, at) => at !== index)
}

/** `moveContentToStackTop`（:240-252）：已在表头就原样返回，否则摘掉它再压表头。 */
export function moveClipboardContentToTop(ring: readonly ClipboardEntry[], index: number): ClipboardEntry[] {
  if (index <= 0 || index >= ring.length) return [...ring]
  const picked = ring[index]!
  return [picked, ...ring.filter((_, at) => at !== index)]
}

// ---------------------------------------------------------------------------
// 选择器（`ContentChooser`）的行渲染规则 —— 纯函数，便于单测
// ---------------------------------------------------------------------------

/** `ContentChooser.RETURN_SYMBOL`（:70）。 */
export const CLIPBOARD_RETURN_SYMBOL = '⏎'
/** `ContentChooser.Item.previewChars`（:389）。 */
export const CLIPBOARD_PREVIEW_CHARS = 80

/**
 * `ContentChooser.Item.getShortText`（:419-441）的逐句复刻（纯函数：源码里那段缓存只影响
 * 后续调用，这里每次从头算，结果一致）。
 *
 * 三个容易看漏的点：
 *   · 判 CR 的是 `StringUtil.indexOf(longText, '\r', 0, min(len, maxChars*2+1)) > 0` ——
 *     **下标 0 的 CR 不算**（`> 0` 不是 `>= 0`），首字符就是 CR 的文本走"无 CR"那一支；
 *   · 两支都是**先截断、后**把换行折成 `⏎`，所以第 80 个字符是换行时输出会短一个可见字符；
 *   · 截断记号是 `StringUtil.first(s, n, true)` 的 `"..."`（三个点，总长 = maxChars + 3，
 *     见 `StringUtil.java:2012-2014`），不是单个 `…`。
 */
export function clipboardPreview(text: string, maxChars = CLIPBOARD_PREVIEW_CHARS): string {
  const hasSlashR = text.slice(0, maxChars * 2 + 1).indexOf('\r') > 0
  if (!hasSlashR) return firstChars(text, maxChars).replace(/\r\n|\r|\n/g, CLIPBOARD_RETURN_SYMBOL)
  const expanded = firstChars(text, maxChars * 2 + 1, false).replace(/\r\n|\r|\n/g, CLIPBOARD_RETURN_SYMBOL)
  return firstChars(expanded, maxChars)
}

/** `StringUtil.first`：超长时取前 n 个字符；`ellipsis` 为真再补 `"..."`（不是把 n 挤成 n-1）。 */
function firstChars(text: string, maxChars: number, ellipsis = true): string {
  return text.length > maxChars ? text.slice(0, maxChars) + (ellipsis ? '...' : '') : text
}

/** `MyListCellRenderer.customizeCellRenderer`（:392-400）：序号右对齐到总位数，后接两个空格。 */
export function clipboardRowPrefix(index: number, total: number): string {
  const label = String(index + 1)
  return label + ' '.repeat(String(total).length - label.length) + '  '
}

/**
 * 数字键直达（:171-181）：`1..9` 选第 1..9 项，`0` 选第 10 项。
 * 返回该项在**完整列表**中的下标（不是过滤后列表的）——源码用的是 `myAllContents.size()` 做边界。
 */
export function clipboardDigitIndex(digit: string): number | null {
  if (!/^[0-9]$/.test(digit)) return null
  return digit === '0' ? 9 : Number(digit) - 1
}
