// lp/completion 的判据：**跨文档**的循环词补全（上游
// `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java:270-278`
// 的 `includeWordsFromOtherFiles` 那一档：当前文档走完就换到**别的已打开文本编辑器**接着找词）。
// 表在 `src/completionOpenEditors.ts`，算法在 `src/cyclicWordCompletion.ts`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clearOpenEditors, openEditorCount, openEditorPaths, otherOpenEditorTexts,
  registerOpenEditor, unregisterOpenEditor,
} from '../src/completionOpenEditors.ts'
import { hippieStep } from '../src/cyclicWordCompletion.ts'

test('登记表按打开顺序给出，且能注销', () => {
  clearOpenEditors()
  registerOpenEditor('a.ts', () => 'alpha')
  registerOpenEditor('b.ts', () => 'bravo')
  assert.deepEqual(openEditorPaths(), ['a.ts', 'b.ts'])
  assert.equal(openEditorCount(), 2)
  // 同一个路径再登记 = 覆盖取文本的方法，**不**改变顺序（上游 `getAllEditors()` 一个文件一个编辑器）。
  registerOpenEditor('a.ts', () => 'alpha2')
  assert.deepEqual(openEditorPaths(), ['a.ts', 'b.ts'])
  unregisterOpenEditor('a.ts')
  assert.deepEqual(openEditorPaths(), ['b.ts'])
  registerOpenEditor('', () => '没有路径不入库')
  assert.equal(openEditorCount(), 1, '空路径不登记')
  clearOpenEditors()
  assert.equal(openEditorCount(), 0)
})

test('「除我以外」按当前正文认自己，只摘第一条命中的；正文为空的条目当死句柄清掉', () => {
  clearOpenEditors()
  registerOpenEditor('a.ts', () => 'same words')
  registerOpenEditor('b.ts', () => 'same words')
  registerOpenEditor('c.ts', () => '')
  registerOpenEditor('d.ts', () => { throw new Error('句柄已失效') })
  const others = otherOpenEditorTexts('same words')
  assert.deepEqual(others.map(item => item.path), ['b.ts'], '第二条同内容的仍是"别的文档"；空正文与抛错的被跳过')
  assert.deepEqual(openEditorPaths(), ['a.ts', 'b.ts'], '死句柄被当场摘掉（生产者只有补全查询这一个装配点，没有关标签的时机）')
  clearOpenEditors()
})

test('跨文档那一档：向前取别的文档候选表的**最后一项**、向后取**第一项**（:166-168、:180-182）', () => {
  const current = 'const alpha = 1\nconst alpine = 2\nal'
  const others = [
    { path: 'b.ts', text: 'the alphabet and an alter' },
    { path: 'c.ts', text: 'alternate' },
  ]
  const forward = hippieStep(current, current.length, null, 1, { otherDocuments: others })
  assert.equal(forward.word, 'alpine', '当前文档先走：离光标最近的前一个词')
  const afterForward = current.slice(0, forward.from) + forward.word
  const second = hippieStep(afterForward, forward.from + forward.word.length, forward.state, 1, { otherDocuments: others })
  assert.equal(second.word, 'alpha')
  const afterSecond = afterForward.slice(0, second.from) + second.word
  const third = hippieStep(afterSecond, second.from + second.word.length, second.state, 1, { otherDocuments: others })
  assert.equal(third.word, 'alternate', '当前文档走完 ⇒ 换到其他文档，取那张表的最后一项')
  assert.equal(third.fromOtherFiles, true, ':109 的 fromOtherFiles 记的是"候选出自别的编辑器"')
  assert.equal(third.exhausted, false)
  const fourth = hippieStep(afterSecond.slice(0, third.from) + third.word, third.from + third.word.length, third.state, 1, { otherDocuments: others })
  assert.equal(fourth.word, 'alter', '换档后在同一张表里继续往前一位走')
  assert.equal(fourth.fromOtherFiles, true)

  const backward = hippieStep(current, current.length, null, -1, { otherDocuments: others })
  assert.equal(backward.word, 'alpha', '向后第一步仍是当前文档的整表第一项')
})

test('没有别的文档时行为退回"只搜当前文档，一轮走完恢复原前缀"（上游只开一个文件时同理）', () => {
  const current = 'const alpha = 1\nconst alpine = 2\nal'
  const first = hippieStep(current, current.length, null, 1, { otherDocuments: [] })
  const after = current.slice(0, first.from) + first.word
  const second = hippieStep(after, first.from + first.word.length, first.state, 1, { otherDocuments: [] })
  const afterSecond = after.slice(0, second.from) + second.word
  const third = hippieStep(afterSecond, second.from + second.word.length, second.state, 1, { otherDocuments: [] })
  assert.equal(third.exhausted, true)
  assert.equal(third.word, 'al')
  assert.equal(third.state, null)
})

test('接线：表的生产者在 lspCompletion，消费者在 completionUi', () => {
  const producer = readFileSync(new URL('../src/lspCompletion.ts', import.meta.url), 'utf8')
  assert.match(producer, /from '\.\/completionOpenEditors\.ts'/)
  assert.match(producer, /registerOpenEditor\(path, \(\) => deps\.view\(\)\?\.state\.sliceDoc\(\) \?\? ''\)/)
  const consumer = readFileSync(new URL('../src/completionUi.ts', import.meta.url), 'utf8')
  assert.match(consumer, /otherOpenEditorTexts\(text\)/)
  const algorithm = readFileSync(new URL('../src/cyclicWordCompletion.ts', import.meta.url), 'utf8')
  assert.match(algorithm, /otherDocuments\?: readonly HippieDocument\[\]/)
})
