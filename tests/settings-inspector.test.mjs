// 设置形状校验（`src/settingsInspector.ts`）：未知键、类型不符、缺失键与检查器摘要，
// 以及读盘链路的接线（workspaceLifecycle 不再盲合并）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedSettings, normalizeSettingsShape, settingsIssuesSummary, settingsValueMatches } from '../src/settingsInspector.ts'
import { defaultGeneralSettings } from '../src/settingsModel.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('缺失键保持默认；未知键丢弃并记 issue', () => {
  const { value, issues } = normalizeSettingsShape(defaultGeneralSettings, { confirmExit: false, obsoleteFlag: true })
  assert.equal(value.confirmExit, false)
  assert.equal(value.reopenLastProject, true, '缺失键取默认')
  assert.deepEqual(issues.map(issue => issue.kind), ['unknown-key'])
  assert.equal(issues[0].path, 'obsoleteFlag')
  assert.ok(!('obsoleteFlag' in value), '未知键不进结果')
})

test('类型不符回落到默认并记 issue（布尔/数字/数组/对象）', () => {
  const { value, issues } = normalizeSettingsShape(defaultGeneralSettings, {
    confirmExit: 'yes', inactiveTimeout: '15', foldConsoleLines: {}, externalTools: 3, autoShowProcessPopup: 0,
  })
  assert.equal(value.confirmExit, true, '字符串不是布尔')
  assert.equal(value.inactiveTimeout, 15)
  assert.deepEqual(value.foldConsoleLines, [])
  assert.deepEqual(value.externalTools, [])
  assert.equal(value.autoShowProcessPopup, false)
  assert.equal(issues.length, 5)
  assert.ok(issues.every(issue => issue.kind === 'type-mismatch'))
})

test('null 默认只接受 null；数组元素结构不在这里管', () => {
  assert.equal(settingsValueMatches(null, null), true)
  assert.equal(settingsValueMatches(null, 'ask'), false)
  assert.equal(settingsValueMatches([], [{ name: 'x' }]), true, '数组只看是不是数组')
  const { value } = normalizeSettingsShape(defaultGeneralSettings, { confirmOpenNewProject2: null, externalTools: [{ name: 'a', command: 'b' }] })
  assert.equal(value.confirmOpenNewProject2, null)
  assert.equal(value.externalTools.length, 1)
})

test('非对象与空状态：给默认值，不乱抛', () => {
  const bad = normalizeSettingsShape(defaultGeneralSettings, 'nope')
  assert.equal(bad.value.reopenLastProject, true)
  assert.equal(bad.issues[0].kind, 'not-an-object')
  const empty = normalizeSettingsShape(defaultGeneralSettings, undefined)
  assert.deepEqual(empty.issues, [])
  assert.deepEqual(empty.value, defaultGeneralSettings)
  assert.notEqual(empty.value, defaultGeneralSettings, '返回新对象')
})

test('检查器行与摘要：已改动项、类型问题优先计数', () => {
  const rows = changedSettings(defaultGeneralSettings, { ...defaultGeneralSettings, confirmExit: false, foldConsoleLines: ['x'] })
  assert.deepEqual(rows.map(row => row.path).sort(), ['confirmExit', 'foldConsoleLines'])
  assert.equal(rows.find(row => row.path === 'foldConsoleLines').value, '[1 项]')
  const summary = settingsIssuesSummary([
    { path: 'a', kind: 'type-mismatch', detail: '' },
    { path: 'b', kind: 'unknown-key', detail: '' },
    { path: 'c', kind: 'unknown-key', detail: '' },
  ])
  assert.match(summary, /1 项设置值类型不合法/)
  assert.match(summary, /2 个未知设置键/)
  assert.equal(settingsIssuesSummary([]), '')
})

test('接线：读盘处按默认形状收口，不再盲合并', () => {
  const lifecycle = readFileSync(join(root, 'src/workspaceLifecycle.ts'), 'utf8')
  assert.match(lifecycle, /normalizeSettingsShape\(defaultGeneralSettings, state\.general\)/,
    'refreshAppState 没有走形状校验')
  assert.ok(!/\{ \.\.\.defaultGeneralSettings, \.\.\.state\.general \}/.test(lifecycle), '旧的盲合并不能还在')
})
