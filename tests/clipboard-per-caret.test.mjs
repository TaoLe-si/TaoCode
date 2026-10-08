// 多光标粘贴的**按光标切分** —— `src/clipboardPerCaret.ts`。
//
// 上游依据（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`，逐行核过）：
//   · `platform/platform-impl/src/com/intellij/openapi/editor/ClipboardTextPerCaretSplitter.java:15-52`
//     —— `split(input, caretData, caretCount)` 那张表就是全部语义（光标数必须为正、1 个光标给整段、
//        `caretData == null` 按 `\n` 切且保留尾空段、有 caretData 按偏移切片、源光标数为 1 则整段给每个、
//        目标多于源时空串）；
//   · `platform/platform-impl/src/com/intellij/openapi/editor/CaretStateTransferableData.java:60-64`
//     —— `areEquivalent` 的「两边都不足两个光标即等价」；
//   · `.../impl/EditorCopyPasteHelperImpl.java:84-95` 收偏移、`:127-180` 取回并 `runForEachCaret`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  caretStateFromRanges, caretStatesEquivalent, copiedCaretsForPaste,
  rememberCopiedCarets, splitTextPerCaret,
} from '../src/clipboardPerCaret.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// --- 上游那张表 ---------------------------------------------------------------------------

test('光标数必须为正：0/负数/小数一律抛（ClipboardTextPerCaretSplitter.java:16-18）', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => splitTextPerCaret('x', null, bad), /正整数/)
  }
})

test('单光标：整段给这一个（caretCount == 1 的短路，:19-21）', () => {
  assert.deepEqual(splitTextPerCaret('a\nb\nc', null, 1), ['a\nb\nc'])
  assert.deepEqual(splitTextPerCaret('a\nb', { startOffsets: [0, 2], endOffsets: [1, 3] }, 1), ['a\nb'])
})

test('没有 caretData 时按 \\n 切（保留尾空段，:35-46）', () => {
  assert.deepEqual(splitTextPerCaret('a\nb\nc', null, 3), ['a', 'b', 'c'])
  // 尾空段算「一个源光标」（lines.length == 2 && lines[1].isEmpty() ⇒ 整段给每个光标）
  assert.deepEqual(splitTextPerCaret('a\n', null, 2), ['a', 'a'])
  // 目标多于源：多出来的光标拿空串（不是复用最后一段）
  assert.deepEqual(splitTextPerCaret('a\nb', null, 4), ['a', 'b', '', ''])
})

test('有 caretData 时按偏移切片；源光标数为 1 则整段给每个目标（:48-59）', () => {
  const state = { startOffsets: [0, 2, 4], endOffsets: [1, 3, 5] }
  assert.deepEqual(splitTextPerCaret('a\nb\nc', state, 3), ['a', 'b', 'c'])
  // 目标多于源：空串
  assert.deepEqual(splitTextPerCaret('a\nb\nc', state, 5), ['a', 'b', 'c', '', ''])
  // 目标少于源：只取前 N 段
  assert.deepEqual(splitTextPerCaret('a\nb\nc', state, 2), ['a', 'b'])
  // 源只有一个光标 ⇒ 整段给每个目标光标
  assert.deepEqual(splitTextPerCaret('hello', { startOffsets: [0], endOffsets: [5] }, 3), ['hello', 'hello', 'hello'])
})

// --- 辅助面 -------------------------------------------------------------------------------

test('caretStateFromRanges：逐光标收 from/to（EditorCopyPasteHelperImpl.java:84-95）', () => {
  assert.deepEqual(caretStateFromRanges([{ from: 0, to: 3 }, { from: 5, to: 5 }]),
    { startOffsets: [0, 5], endOffsets: [3, 5] })
  assert.deepEqual(caretStateFromRanges([]), { startOffsets: [], endOffsets: [] })
})

test('areEquivalent：两边都不足两个光标即等价（CaretStateTransferableData.java:60-64）', () => {
  const one = { startOffsets: [0], endOffsets: [1] }
  const two = { startOffsets: [0, 2], endOffsets: [1, 3] }
  assert.equal(caretStatesEquivalent(null, null), true)
  assert.equal(caretStatesEquivalent(null, one), true, '两边都不足两个光标 ⇒ 等价')
  assert.equal(caretStatesEquivalent(one, null), true)
  assert.equal(caretStatesEquivalent(one, one), true)
  // 上游那句是 `(d1 == null || d1.count == 1) && (d2 == null || d2.count == 1) || …` ——
  // **一边是多个**时前半不成立，后半又要求两边都非 null ⇒ 与 null 比较一律 false。
  assert.equal(caretStatesEquivalent(null, two), false, '右边多个光标、左边 null ⇒ 不等价')
  assert.equal(caretStatesEquivalent(two, null), false)
  assert.equal(caretStatesEquivalent(two, { startOffsets: [0, 2], endOffsets: [1, 3] }), true)
  assert.equal(caretStatesEquivalent(two, { startOffsets: [0, 2], endOffsets: [1, 4] }), false, '偏移不同不等价')
  assert.equal(caretStatesEquivalent(two, { startOffsets: [0, 2, 4], endOffsets: [1, 3, 5] }), false, '段数不同不等价')
})

test('本进程内的复制偏移：记住 / 取回（DOM 剪贴板带不了 flavor 的替身）', () => {
  rememberCopiedCarets(null)
  assert.equal(copiedCaretsForPaste(), null)
  const state = caretStateFromRanges([{ from: 1, to: 2 }])
  rememberCopiedCarets(state)
  assert.deepEqual(copiedCaretsForPaste(), state)
  rememberCopiedCarets(null)
})

// --- 接线 ---------------------------------------------------------------------------------

test('粘贴通道走多光标切分（不是仍只插主光标那一段）', () => {
  const source = read('src/editorPaste.ts')
  assert.match(source, /import \{ caretStateFromRanges, copiedCaretsForPaste, rememberCopiedCarets, splitTextPerCaret \} from '\.\/clipboardPerCaret\.ts'/,
    'editorPaste 没有引切分器')
  assert.match(source, /export function insertTextPerCaret/, '缺多光标插入入口')
  assert.match(source, /splitTextPerCaret\(text, copiedCaretsForPaste\(\), ranges\.length\)/, '切分没有按目标光标数走')
  // 接线（2026-10-07 按实现的真实锚点重写）：默认粘贴那一支把切分器的结果**存进 `info`** 再交回宿主。
  // 三条粘贴 EP 接进来之后插入文本取自 `preprocess.text`（预处理器可能改过它），`onPaste` 的载荷也
  // 扩成了 `info` / `text` / `inserted` / `extensions` —— 断言钉住「插入结果出自多光标切分器」这条意图，
  // 而不是旧的字面一行。`info,` 只匹配默认分支：自定义粘贴接管那一支写的是 `info: currentInsertion(...)`。
  assert.match(source, /const info = insertTextPerCaret\(view, preprocess\.text\)/, '粘贴通道没有改用多光标切分')
  assert.match(source, /onPaste\(\{\s*info,/, '切分结果没有交回宿主（onPaste 的载荷里没有 info）')
})

test('复制通道记下各光标偏移（EditorCopyPasteHelperImpl.java:94）', () => {
  const source = read('src/editorClipboard.ts')
  assert.match(source, /import \{ caretStateFromRanges, rememberCopiedCarets \} from '\.\/clipboardPerCaret\.ts'/,
    'editorClipboard 没有引偏移记录')
  assert.match(source, /rememberCopiedCarets\(caretStateFromRanges\(view\.state\.selection\.ranges/,
    '复制通道没有记下逐光标偏移')
})