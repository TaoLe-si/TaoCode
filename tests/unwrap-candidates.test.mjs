// Unwrap 多候选（`src/unwrap.ts` 的 `findUnwrapCandidates`）：嵌套包裹逐层可选，
// 最内层在前；被拒的（try/catch、do/while）不进候选。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findUnwrapCandidates, findUnwrapEdit } from '../src/unwrap.ts'

test('嵌套 if/for：两层候选，最内层在前，带关键字标签', () => {
  const text = [
    'void run() {',
    '    for (int i = 0; i < n; ++i) {',
    '        if (ready) {',
    '            work();',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n')
  const cursor = text.indexOf('work()') + 2
  const candidates = findUnwrapCandidates(text, cursor, cursor, 4)
  assert.deepEqual(candidates.map(candidate => candidate.keyword), ['if', 'for'])
  assert.deepEqual(candidates.map(candidate => candidate.label), ['拆掉 if 包裹', '拆掉 for 包裹'])
  // 最内层候选就是原来的 findUnwrapEdit 结果。
  const innermost = findUnwrapEdit(text, cursor, cursor, 4)
  assert.deepEqual(candidates[0].edit, innermost)
  assert.ok(!candidates[0].edit.insert.includes('if (ready)'), '拆掉的文本里没有 if 头')
})

test('被拒的包裹不产生候选：try 后面跟 catch', () => {
  const text = 'try {\n    work();\n} catch (error) {\n    log();\n}\n'
  const cursor = text.indexOf('work()') + 2
  assert.deepEqual(findUnwrapCandidates(text, cursor, cursor, 4), [])
  assert.equal(findUnwrapEdit(text, cursor, cursor, 4), null)
})

test('do/while 也拒绝；找不到包裹返回空数组', () => {
  const doWhile = 'do {\n    work();\n} while (ready);\n'
  const cursor = doWhile.indexOf('work()') + 2
  assert.deepEqual(findUnwrapCandidates(doWhile, cursor, cursor, 4), [])
  assert.deepEqual(findUnwrapCandidates('plain();\n', 3, 3, 4), [])
})

test('单行块也是一条候选（正文 trim）', () => {
  const text = 'if (x) { doWork() }\n'
  const candidates = findUnwrapCandidates(text, 10, 10, 4)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].edit.insert, 'doWork()')
  assert.equal(candidates[0].keyword, 'if')
})
