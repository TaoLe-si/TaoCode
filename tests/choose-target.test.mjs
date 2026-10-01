// 「转到声明」多目标时的**选择弹层**（IDEA `GotoDeclarationAction` 的 Choose Declaration）。
//
// 两半都测：① 行模型/过滤/移动是纯函数（src/chooseTarget.ts）；② 接线 —— 一个目标直接跳、
// 多个才弹层（`GotoDeclarationOnlyHandler2.kt:60-76` 的两条分支），少接一条就又回到"取第一个
// 目标、其余永远看不到"的老样子。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseTargetLabel, chooseTargetRows, filterChooseTargets, moveChooseTarget, targetRow } from '../src/chooseTarget.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const editor = read('src/components/CodeEditor.vue')

const CONTENT = 'package a;\n\npublic class Sample {\n    int counter;\n}\n'

test('一行 = 目标位置上的名字 + 所在文件 + 1 基行列', () => {
  // 主文本取声明点上的标识符（`wordAt`），灰尾是所在文件，右列是 `行:列`。
  const row = targetRow({ path: 'src/Sample.java', line: 2, character: 13 }, CONTENT)
  assert.equal(row.name, 'Sample')
  assert.equal(row.container, 'src/Sample.java')
  assert.equal(row.position, '3:14')
  assert.equal(row.id, 'src/Sample.java:2:13')
})

test('读不到目标文件时退回文件名，灰尾只留目录（不重复文件名）', () => {
  const row = targetRow({ path: 'lib/Foo.java', line: 0, character: 0 }, null)
  assert.equal(row.name, 'Foo.java')
  assert.equal(row.container, 'lib')
  assert.equal(chooseTargetLabel(row), 'Foo.java lib')
})

test('内容里读不出标识符时退到那一行的原文（上游的 text 兜底）', () => {
  const row = targetRow({ path: 'src/Sample.java', line: 4, character: 0 }, CONTENT)
  assert.equal(row.name, '}')
})

test('同一个位置只留一行（LSP 允许同一位置回两次）', () => {
  const target = { path: 'src/Sample.java', line: 2, character: 13 }
  const rows = chooseTargetRows([target, { ...target }], new Map([['src/Sample.java', CONTENT]]))
  assert.equal(rows.length, 1)
})

test('过滤是速度搜索：大小写不敏感、驼峰按词首、空串放行全部', () => {
  const rows = [
    targetRow({ path: 'src/Sample.java', line: 2, character: 13 }, CONTENT),
    targetRow({ path: 'src/helper.java', line: 0, character: 6 }, 'class helperCount {\n    int count;\n}\n'),
  ]
  assert.equal(filterChooseTargets(rows, '').length, 2)
  assert.deepEqual(filterChooseTargets(rows, 'smp').map(row => row.name), ['Sample'], '大小写不敏感的子序列')
  assert.deepEqual(filterChooseTargets(rows, 'hc').map(row => row.name), ['helperCount'], '驼峰缩写')
  assert.deepEqual(filterChooseTargets(rows, 'HS').map(row => row.name), ['helperCount'], '大写字母按词首命中')
  assert.deepEqual(filterChooseTargets(rows, 'zzz'), [])
})

test('↑↓ 到两端就停住，不回绕', () => {
  assert.equal(moveChooseTarget(3, 0, -1), 0)
  assert.equal(moveChooseTarget(3, 2, 1), 2)
  assert.equal(moveChooseTarget(3, 1, 1), 2)
  assert.equal(moveChooseTarget(0, -1, 1), -1)
})

test('单个目标直接跳，多个才开弹层（上游的两条分支）', () => {
  assert.match(editor, /if \(targets\.length > 1\) \{ await openChooseTarget\(targets, pos\); return \}/,
    '多目标必须走弹层，不能只取第一个')
  assert.match(editor, /const target = targets\[0\]!\s*\n\s*emit\('reveal', \{ path: target\.path, line: target\.line, column: target\.character \+ 1 \}\)/,
    '单目标保持直接跳，并把光标落在声明列上')
})

test('弹层的每一行都带上位置，挑选后按行列跳转', () => {
  assert.match(editor, /function pickChooseTarget\(row: ChooseTargetRow\) \{\s*\n\s*chooseTarget\.value = null\s*\n\s*emit\('reveal', \{ path: row\.path, line: row\.line, column: row\.character \+ 1 \}\)/,
    '选择的结果必须回到 reveal 通道（导航历史/最近位置都挂在它上面）')
})
