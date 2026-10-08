// 低层项目打开链的判据（上游 `LowLevelProjectOpenProcessor` + `ProjectUtil.guessProjectDir`，
// 实现 `src/projectOpenCheck.ts`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  guessProjectDir,
  isAbsoluteProjectPath,
  projectOpenDecision,
  shouldOpenInNewProcess,
  suggestedProjectName,
} from '../src/projectOpenCheck.ts'

test('绝对路径判定：盘符 / UNC / 前导斜杠算，相对路径不算', () => {
  assert.equal(isAbsoluteProjectPath('D:\\work\\app'), true)
  assert.equal(isAbsoluteProjectPath('d:/work/app'), true)
  assert.equal(isAbsoluteProjectPath('//server/share'), true)
  assert.equal(isAbsoluteProjectPath('/usr/local/app'), true)
  assert.equal(isAbsoluteProjectPath('work/app'), false)
  assert.equal(isAbsoluteProjectPath('./app'), false)
  assert.equal(isAbsoluteProjectPath(''), false)
})

test('shouldOpenInNewProcess：本仓单窗口，恒 false（与上游默认实现一致）', () => {
  assert.equal(shouldOpenInNewProcess(), false)
})

test('打开闸门：空 / 相对 / 不存在 / 不是目录 → cancel，各带一句原因', () => {
  assert.deepEqual(projectOpenDecision({ path: '' }), { result: 'cancel', message: '没有指定项目目录。' })
  const relative = projectOpenDecision({ path: 'work/app' })
  assert.equal(relative.result, 'cancel')
  assert.match(relative.message, /完整路径/)
  const missing = projectOpenDecision({ path: 'D:/gone', exists: false })
  assert.equal(missing.result, 'cancel')
  assert.match(missing.message, /不存在/)
  const file = projectOpenDecision({ path: 'D:/work/a.txt', exists: true, isDirectory: false })
  assert.equal(file.result, 'cancel')
  assert.match(file.message, /必须是一个目录/)
})

test('打开闸门：绝对且是目录 → continue，没有话要说', () => {
  assert.deepEqual(projectOpenDecision({ path: 'D:/work/app', exists: true, isDirectory: true }), { result: 'continue', message: null })
  // 存在性未知（前端对工作区外没有探测通道）时只跑能跑的那几条 —— 绝对路径放行。
  assert.deepEqual(projectOpenDecision({ path: 'D:/work/app' }), { result: 'continue', message: null })
})

test('guessProjectDir：候选是目录就用它，否则退回父目录，都不行给 null', () => {
  const dirs = new Set(['D:/work', 'D:/work/app'])
  const isDir = path => dirs.has(path)
  assert.equal(guessProjectDir('D:/work/app', isDir), 'D:/work/app', '本身是目录 ⇒ 用它')
  assert.equal(guessProjectDir('D:/work/app/src', isDir), 'D:/work/app', '不是目录 ⇒ 退父目录')
  assert.equal(guessProjectDir('D:/nowhere/x', isDir), null, '父目录也不存在 ⇒ null')
  assert.equal(guessProjectDir('', isDir), null)
  // 归一：反斜杠与尾斜杠都吃掉再判。
  assert.equal(guessProjectDir('D:\\work\\app\\', isDir), 'D:/work/app')
})

test('suggestedProjectName：猜出的目录名，猜不出退回路径末段', () => {
  const dirs = new Set(['D:/work/my-app'])
  const isDir = path => dirs.has(path)
  assert.equal(suggestedProjectName('D:/work/my-app', isDir), 'my-app')
  assert.equal(suggestedProjectName('D:/work/my-app/src', isDir), 'my-app')
  // 猜不出（都不存在）时退回候选自己的末段。
  assert.equal(suggestedProjectName('D:/work/ghost', isDir), 'ghost')
})

test('接线：openWorkspace 发请求前先过这道闸门', () => {
  const source = readFileSync(new URL('../src/workspaceLifecycle.ts', import.meta.url), 'utf8')
  assert.match(source, /import \{ projectOpenDecision \} from '\.\/projectOpenCheck\.ts'/)
  assert.match(source, /const decision = projectOpenDecision\(\{ path \}\)/)
  assert.match(source, /if \(decision\.result === 'cancel'\) \{ notify\(decision\.message/)
})