// 临时文件历史与语言推断（`src/scratchHistory.ts`）：LRU、上限、按名查找、文件名与内容推断。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCRATCH_HISTORY_LIMIT, findScratchByName, inferScratchLanguage, pruneScratchHistory, pushScratchHistory, scratchFileName, scratchSubtitle,
} from '../src/scratchHistory.ts'

const scratch = (path, name, language, usedAt) => ({ path, name, language, usedAt })

test('历史：同路径顶到最前、上限砍尾、返回新数组', () => {
  const history = [scratch('a', 'a', 'java', 1), scratch('b', 'b', 'cpp', 2)]
  const pushed = pushScratchHistory(history, scratch('a', 'a', 'java', 3))
  assert.deepEqual(pushed.map(item => item.path), ['a', 'b'])
  assert.equal(pushed[0].usedAt, 3)
  assert.equal(history[0].usedAt, 1, '不改入参')
  let long = []
  for (let index = 0; index < SCRATCH_HISTORY_LIMIT + 5; ++index) long = pushScratchHistory(long, scratch(`p${index}`, `n${index}`, 'java', index))
  assert.equal(long.length, SCRATCH_HISTORY_LIMIT)
  assert.equal(long[0].path, `p${SCRATCH_HISTORY_LIMIT + 4}`, '最新的在最前')
})

test('按名查找、按存在性清理', () => {
  const history = [scratch('a', 'scratch-1', 'java', 1), scratch('b', 'scratch-2', 'cpp', 2)]
  assert.equal(findScratchByName(history, 'scratch-2')?.path, 'b')
  assert.equal(findScratchByName(history, 'missing'), undefined)
  assert.deepEqual(pruneScratchHistory(history, path => path === 'b').map(item => item.path), ['b'])
})

test('文件名：序号 + 扩展名（扩展名带点也吃）', () => {
  assert.equal(scratchFileName(1, 'java'), 'scratch-1.java')
  assert.equal(scratchFileName(3, '.ts'), 'scratch-3.ts')
  assert.equal(scratchFileName(0, ''), 'scratch-1')
})

test('语言推断：扩展名优先，其次 shebang，再次内容特征；认不出给 null', () => {
  assert.equal(inferScratchLanguage('scratch-1.java', ''), 'java')
  assert.equal(inferScratchLanguage('script', '#!/usr/bin/env ts-node\nconsole.log(1)'), 'typescript')
  assert.equal(inferScratchLanguage('pasted', '#include <vector>'), 'cpp')
  assert.equal(inferScratchLanguage('pasted2', 'import x from "y"\nexport const a = 1'), 'typescript')
  assert.equal(inferScratchLanguage('notes', '随便写点东西'), null)
})

test('副标题：语言 + 本地时间（坏值不炸）', () => {
  const label = scratchSubtitle(scratch('a', 'a', 'java', new Date(2026, 9, 4, 9, 5).getTime()))
  assert.equal(label, 'java · 2026/10/4 9:05')
  assert.equal(scratchSubtitle(scratch('a', 'a', 'cpp', Number.NaN)), 'cpp')
})
