// 提交信息 MRU 的判据 —— 上游三条（`VcsConfiguration.java`）逐条：
//   · `saveCommitMessage:169-177`：空白不进 MRU；同一条先删再追加（去重后最新在尾）；
//   · `MAX_STORED_MESSAGES:153` = 25，`addCommitMessage:187-193` 满了先丢 `remove(0)`（最旧）；
//   · `replaceMessage:217-229`：原地替换，找不到才追加；
//   · `getLastNonEmptyCommitMessage:195-197` = 队尾；消费端 `ShowMessageHistoryAction.kt:66`
//     列的是 `reversed()`（新→旧），`:79` 可见行数 7。
// 组件接线在 `src/components/SourceControl.vue`（提交成功时 saveRecentMessage、弹层行预览/点选）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MAX_RECENT_COMMIT_MESSAGES, MESSAGE_HISTORY_VISIBLE_ROWS, lastRecentMessage, loadMessageHistory,
  messageHistoryPreviewLine, messageHistoryRows, replaceRecentMessage, saveRecentMessage,
} from '../src/commitMessageHistory.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('保存：空白/纯空白不进 MRU，也不动原列（saveCommitMessage 早退）', () => {
  const list = ['first']
  assert.deepEqual(saveRecentMessage(list, ''), ['first'])
  assert.deepEqual(saveRecentMessage(list, '   \n '), ['first'])
  assert.deepEqual(saveRecentMessage(list, undefined), ['first'])
})

test('保存：同一条先删再追加 —— 去重且挪到"最近"', () => {
  const list = saveRecentMessage(['a', 'b', 'c'], 'a')
  assert.deepEqual(list, ['b', 'c', 'a'])
  assert.deepEqual(saveRecentMessage(['a', 'b'], 'd'), ['a', 'b', 'd'])
})

test('上限 25：满了先丢最旧那一条（addCommitMessage:187-193）', () => {
  const full = Array.from({ length: MAX_RECENT_COMMIT_MESSAGES }, (_, index) => `m${index}`)
  const next = saveRecentMessage(full, 'newest')
  assert.equal(next.length, MAX_RECENT_COMMIT_MESSAGES)
  assert.equal(next[0], 'm1', '丢的是 index 0（最旧）')
  assert.equal(lastRecentMessage(next), 'newest')
})

test('替换：在列里找到就原位替换；找不到按追加规则补一条（replaceMessage）', () => {
  assert.deepEqual(replaceRecentMessage(['a', 'b', 'c'], 'b', 'B'), ['a', 'B', 'c'])
  assert.deepEqual(replaceRecentMessage(['a'], 'zzz', 'new'), ['a', 'new'])
  assert.deepEqual(replaceRecentMessage(['a'], 'a', '  '), ['a'], '空白的新内容不写进历史')
})

test('弹层列：MRU 新→旧在前、git log 主题去重跟在后（ShowMessageHistoryAction:66）', () => {
  assert.deepEqual(messageHistoryRows(['old', 'new'], ['log1', 'new']), ['new', 'old', 'log1'])
  assert.deepEqual(messageHistoryRows([], ['s1', 's1', 's2']), ['s1', 's2'])
  assert.equal(MESSAGE_HISTORY_VISIBLE_ROWS, 7, 'setVisibleRowCount(7)')
  assert.equal(messageHistoryRows(['a', 'b', 'c'], [], 2).length, 2, '上限截断')
})

test('loadMessageHistory：读不到 git log 时 MRU 照样出来', async () => {
  assert.deepEqual(await loadMessageHistory(async () => { throw new Error('not a git repo') }, ['mine']), ['mine'])
  assert.deepEqual(await loadMessageHistory(async () => ['sub'], ['mine']), ['mine', 'sub'])
})

test('预览行：多行压一行、按右边距截断（:85-88）', () => {
  assert.equal(messageHistoryPreviewLine('sub\n\nbody line', 72), 'sub body line')
  const long = messageHistoryPreviewLine('x'.repeat(100), 10)
  assert.equal(long.length, 10)
  assert.match(long, /…$/)
})

test('面板接线：提交成功存 MRU、弹层行有预览与点选', () => {
  const panel = read('src/components/SourceControl.vue')
  assert.match(panel, /saveRecentMessage\(recentMessages\.value, text\)/, '两条提交路径都要存')
  assert.match(panel, /loadMessageHistory\(/, '弹层数据走模块')
  assert.match(panel, /previewHistory\(subject\)/, '悬停预览（ShowMessageHistoryAction:90-96）')
  assert.match(panel, /pickHistory\(subject\)/, '点选后收起')
})
