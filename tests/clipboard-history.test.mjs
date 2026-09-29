// 剪贴板历史环 + 粘贴时的缩进/格式化规则 —— 纯函数单测。
//
// 被测实现逐句对照 IDEA 源码（路径见两个模块的头部注释）：
//   · `CopyPasteManagerWithHistory`（去重、压栈、`getAllContents` 的系统剪贴板同步）
//   · `CopyPasteManagerEx.deleteAfterAllowedMaximum:101-116`（条数上限 + 内存清理 + 占位符）
//   · `ContentChooser` 的行渲染（`:392-400` 序号、`:419-441` 前 80 字符 + `⏎`、`:171-181` 数字键）
//   · `CodeInsightSettings.REFORMAT_ON_PASTE` + `PasteHandler.java:247-257` 的档位强制
//   · `DefaultTypingActionsExtension.indentPlainTextBlock:215-236`
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CLIPBOARD_MAX_ITEMS, CLIPBOARD_MAX_MEMORY, CLIPBOARD_PURGED_TEXT, CLIPBOARD_RETURN_SYMBOL,
  clipboardDigitIndex, clipboardPreview, clipboardRowPrefix, moveClipboardContentToTop, pushClipboardContent,
  removeClipboardContent, smallItemLimit, syncSystemClipboard, trimClipboardHistory,
} from '../src/clipboardHistory.ts'
import {
  PASTE_INDENT_BLOCK, PASTE_INDENT_EACH_LINE, PASTE_REFORMAT_BLOCK, PASTE_REFORMAT_DEFAULT,
  PASTE_REFORMAT_MODES, PASTE_REFORMAT_NONE, indentPlainTextBlock, isPasteReformatMode, pasteReformatAction,
  pasteReformatLabel,
} from '../src/pasteOptions.ts'

const entry = (text, purged = false) => ({ text, purged })
const texts = ring => ring.map(item => item.text)

test('环的上限来自 registry 的两个键，小项阈值为 maxMemory/maxCount/10', () => {
  // registry.properties:1881 / :1883
  assert.equal(CLIPBOARD_MAX_ITEMS, 100)
  assert.equal(CLIPBOARD_MAX_MEMORY, 10_000_000)
  // `deleteAfterAllowedMaximum`:104 `int smallItemSizeLimit = maxMemory / maxCount / 10`
  assert.equal(smallItemLimit(100, 10_000_000), 10_000)
  assert.equal(CLIPBOARD_PURGED_TEXT, '<已清除>')
})

test('新内容压到表头；同文本项被摘掉再压表头（去重）', () => {
  let ring = []
  ring = pushClipboardContent(ring, 'a')
  ring = pushClipboardContent(ring, 'b')
  assert.deepEqual(texts(ring), ['b', 'a'])
  // 重复的 'a'：源码 `:127-137` 找到同文本项就 remove 再 add(0)，不是留下两份
  ring = pushClipboardContent(ring, 'a')
  assert.deepEqual(texts(ring), ['a', 'b'])
  assert.equal(ring.length, 2)
  // 空串不入环（`getStringContent` 拿不到内容时直接返回原对象）
  assert.deepEqual(texts(pushClipboardContent(ring, '')), ['a', 'b'])
})

test('去重那一支不裁剪（源码只在 addToTheTopOfTheStack 里裁）', () => {
  const ring = [entry('x'), entry('y'), entry('z')]
  const next = pushClipboardContent(ring, 'z', 2, CLIPBOARD_MAX_MEMORY)
  assert.deepEqual(texts(next), ['z', 'x', 'y'])
})

test('超过条数上限时从尾部截断', () => {
  let ring = []
  for (const text of ['a', 'b', 'c', 'd']) ring = pushClipboardContent(ring, text, 3, CLIPBOARD_MAX_MEMORY)
  assert.deepEqual(texts(ring), ['d', 'c', 'b'])
})

test('总内存超限时从尾部把大项换成占位符，且下标 0 永不清理', () => {
  // 上限 100 条 / 1000 字符 ⇒ 小项阈值 = 1000/100/10 = 1；每项 400 字符，三项合计 1200 > 1000。
  // 源码的循环从尾部往前走，**每轮先看总和**：清掉一项（400 字符 → 占位符 5 字符）后
  // 总和降到 805 ≤ 1000，于是立刻停手 —— 所以只有最尾一项被清除，不是"全清到只剩表头"。
  const ring = [entry('A'.repeat(400)), entry('B'.repeat(400)), entry('C'.repeat(400))]
  const next = trimClipboardHistory(ring, 100, 1000)
  assert.equal(next.length, 3)
  assert.equal(next[0].text, 'A'.repeat(400))
  assert.equal(next[1].text, 'B'.repeat(400))
  assert.equal(next[2].text, CLIPBOARD_PURGED_TEXT)
  assert.equal(next[2].purged, true)
  // 同一个环不动：`trimClipboardHistory` 返回新数组，不改入参
  assert.equal(ring[2].text, 'C'.repeat(400))
})

test('下标 0 永不清理（源码的 `it.previousIndex() > 0`）', () => {
  // maxMemory 设成 1 ⇒ 怎么都不够，但循环走到下标 1 就停了，表头原样保留
  const ring = [entry('A'.repeat(1000)), entry('B'.repeat(1000))]
  const next = trimClipboardHistory(ring, 100, 1)
  assert.equal(next[0].text, 'A'.repeat(1000))
  assert.equal(next[0].purged, false)
  assert.equal(next[1].text, CLIPBOARD_PURGED_TEXT)
})

test('getAllContents 前会先把系统剪贴板同步到表头', () => {
  const ring = [entry('old')]
  assert.deepEqual(texts(syncSystemClipboard(ring, 'new')), ['new', 'old'])
  // 与表头相同 ⇒ 不动
  assert.deepEqual(texts(syncSystemClipboard(ring, 'old')), ['old'])
  // 读不到剪贴板 ⇒ 不动
  assert.deepEqual(texts(syncSystemClipboard(ring, null)), ['old'])
  assert.deepEqual(texts(syncSystemClipboard(ring, '')), ['old'])
})

test('删除与提升：删表头后系统剪贴板要回落到新表头', () => {
  const ring = [entry('a'), entry('b'), entry('c')]
  assert.deepEqual(texts(removeClipboardContent(ring, 0)), ['b', 'c'])
  // 越界不动
  assert.deepEqual(texts(removeClipboardContent(ring, 9)), ['a', 'b', 'c'])
  // 提升：非表头项摘掉再压表头；已在表头或越界则原样
  assert.deepEqual(texts(moveClipboardContentToTop(ring, 2)), ['c', 'a', 'b'])
  assert.deepEqual(texts(moveClipboardContentToTop(ring, 0)), ['a', 'b', 'c'])
  assert.deepEqual(texts(moveClipboardContentToTop(ring, -1)), ['a', 'b', 'c'])
})

test('选择器行文本：前 80 字符、换行折成 ⏎、截断加省略号', () => {
  // `ContentChooser.RETURN_SYMBOL`（:70）
  assert.equal(CLIPBOARD_RETURN_SYMBOL, '⏎')
  assert.equal(clipboardPreview('a\nb'), `a${CLIPBOARD_RETURN_SYMBOL}b`)
  // CRLF 也折成一个符号（源码 :429-437 专门处理含 \r 的情况）
  assert.equal(clipboardPreview('a\r\nb'), `a${CLIPBOARD_RETURN_SYMBOL}b`)
  const long = 'x'.repeat(120)
  const short = clipboardPreview(long)
  assert.equal(short.length, 80)
  assert.ok(short.endsWith('…'))
  assert.equal(short, 'x'.repeat(79) + '…')
  // 正好 80 字符不截断
  assert.equal(clipboardPreview('y'.repeat(80)), 'y'.repeat(80))
})

test('选择器行号右对齐到总位数（源码 :394-398）', () => {
  assert.equal(clipboardRowPrefix(0, 9), '1  ')
  assert.equal(clipboardRowPrefix(8, 9), '9  ')
  // 总数两位数时补一个空格，保证「9  」与「10 」左边界不齐
  assert.equal(clipboardRowPrefix(0, 12), '1   ')
  assert.equal(clipboardRowPrefix(9, 12), '10  ')
})

test('数字键直达：1..9 选第 1..9 项，0 选第 10 项（源码 :171-181）', () => {
  assert.equal(clipboardDigitIndex('1'), 0)
  assert.equal(clipboardDigitIndex('9'), 8)
  assert.equal(clipboardDigitIndex('0'), 9)
  assert.equal(clipboardDigitIndex('a'), null)
  assert.equal(clipboardDigitIndex('12'), null)
})

test('REFORMAT_ON_PASTE 的四档取值与默认值', () => {
  // CodeInsightSettings.java:143-148
  assert.equal(PASTE_REFORMAT_DEFAULT, PASTE_INDENT_EACH_LINE)
  assert.deepEqual([...PASTE_REFORMAT_MODES],
    [PASTE_REFORMAT_NONE, PASTE_INDENT_BLOCK, PASTE_INDENT_EACH_LINE, PASTE_REFORMAT_BLOCK])
  for (const mode of PASTE_REFORMAT_MODES) assert.ok(isPasteReformatMode(mode))
  assert.equal(isPasteReformatMode('indent-blank'), false)
  assert.equal(isPasteReformatMode(2), false)
  for (const mode of PASTE_REFORMAT_MODES) assert.equal(typeof pasteReformatLabel(mode), 'string')
})

test('档位分派：没有格式化器时强制整块缩进（PasteHandler.java:255-257）', () => {
  // 有语言服务 → 一律交给 rangeFormatting
  for (const mode of PASTE_REFORMAT_MODES) {
    assert.equal(pasteReformatAction(mode, true), mode === PASTE_REFORMAT_NONE ? 'none' : 'formatRange')
  }
  // 没有语言服务：除"不重新格式化"外全部强制 INDENT_BLOCK → 纯文本缩进
  assert.equal(pasteReformatAction(PASTE_REFORMAT_NONE, false), 'none')
  assert.equal(pasteReformatAction(PASTE_INDENT_BLOCK, false), 'plainIndent')
  assert.equal(pasteReformatAction(PASTE_INDENT_EACH_LINE, false), 'plainIndent')
  assert.equal(pasteReformatAction(PASTE_REFORMAT_BLOCK, false), 'plainIndent')
})

test('纯文本缩进：首行不动，后续行按光标列补空格（indentPlainTextBlock）', () => {
  // 光标在第 4 列，粘贴两行：第二行补 4 个空格
  assert.equal(indentPlainTextBlock('a\nb', 4, false), 'a\n    b')
  // 结尾换行时最后那个空行不算一行
  assert.equal(indentPlainTextBlock('a\nb\n', 2, false), 'a\n  b\n')
  // 单行 ⇒ 没有"后续行"
  assert.equal(indentPlainTextBlock('a', 4, false), 'a')
  // 光标在第 0 列：源码 `indentLevel <= 0` 直接返回
  assert.equal(indentPlainTextBlock('a\nb', 0, false), 'a\nb')
  // 光标行是文档最后一行：源码 `startLine >= lineCount - 1` 直接返回
  assert.equal(indentPlainTextBlock('a\nb', 4, true), 'a\nb')
  // 粘贴块首行只有空白：源码 `chars.charAt(spaceEnd) == '\n'` 直接返回
  assert.equal(indentPlainTextBlock('  \nb', 4, false), '  \nb')
  // 整段空白：`spaceEnd > endOffset` 直接返回
  assert.equal(indentPlainTextBlock('   ', 4, false), '   ')
})
