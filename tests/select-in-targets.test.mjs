// 判据 · **Select In 目标的扩展点宿主**（`src/selectInTargets.ts` +
// `src/extensionPoints.ts`，上游 `com.intellij.ide.SelectInTarget` / EP
// `com.intellij.selectInTarget`，`intellij.platform.ide.xml:40-43`）。
//
// 钉三件事（用户要的「原版插件能跑」口径）：
//   ① EP id 与上游 qualifiedName 逐字一致（不一致插件就挂不上）；
//   ② 六个内置目标是 **bundled 贡献**，仍在表里（本仓功能照常）；
//   ③ 第三方按 EP id 挂的目标能被 `selectInTargetRows`/`selectInTargetById` 看见并派发。
import test from 'node:test'
import assert from 'node:assert/strict'

import { APPLICATION_SCOPE, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  SELECT_IN_TARGET_EP, bundledSelectInTargets, registerSelectInTarget,
  selectInTargetById, selectInTargetRows, selectInTargets, unregisterSelectInTarget,
} from '../src/selectInTargets.ts'

const baseContext = overrides => ({
  hasActiveFile: true, hasPath: true, inTree: true, isDesktop: true,
  hasBreadcrumbs: true, hasChange: true, hasWorkspace: true, ...overrides,
})

test('EP id 与上游逐字一致，且已声明', () => {
  assert.equal(SELECT_IN_TARGET_EP, 'com.intellij.selectInTarget')
  assert.equal(EXTENSIONS.hasExtensionPoint(SELECT_IN_TARGET_EP), true)
})

test('六个内置目标是 bundled 贡献（EP 里看得见），权重升序成行', () => {
  assert.deepEqual(selectInTargets().map(target => target.id),
    ['project', 'structure', 'navbar', 'commit', 'explorer', 'settings'])
  const rows = selectInTargetRows(baseContext())
  assert.deepEqual(rows.map(row => row.number), ['1', '2', '3', '4', '5', '6'])
  assert.deepEqual(rows.map(row => row.id), ['project', 'structure', 'navbar', 'commit', 'explorer', 'settings'])
})

test('置灰由 canSelect 决定，置灰行点了拿不到目标', () => {
  const context = baseContext({ inTree: false, hasChange: false, hasBreadcrumbs: false })
  const rows = selectInTargetRows(context)
  const byId = Object.fromEntries(rows.map(row => [row.id, row.selectable]))
  assert.equal(byId.project, false)
  assert.equal(byId.navbar, false)
  assert.equal(byId.commit, false)
  assert.equal(byId.explorer, false)
  assert.equal(byId.structure, true, '有编辑器就该可选')
  assert.equal(selectInTargetById(context, 'project'), null, '置灰行不该有动作')
  assert.ok(selectInTargetById(context, 'structure'))
})

test('第三方按 EP id 挂的目标被收编、能派发，注销后消失', () => {
  let fired = 0
  const handle = registerSelectInTarget({
    id: 'demo.target', label: '演示目标', weight: 3,
    canSelect: () => true, selectIn: () => { fired++ },
  }, { scope: APPLICATION_SCOPE })
  try {
    const rows = selectInTargetRows(baseContext())
    assert.ok(rows.some(row => row.id === 'demo.target'), '第三方目标没进行')
    // 权重 3 落在 project(0) 与 structure(4) 之间 —— 顺序真的按 getWeight 算。
    assert.deepEqual(rows.map(row => row.id).slice(0, 3), ['project', 'demo.target', 'structure'])
    const target = selectInTargetById(baseContext(), 'demo.target')
    assert.ok(target)
    target.selectIn(baseContext())
    assert.equal(fired, 1, '派发没落到目标的 selectIn')
  } finally {
    handle.dispose()
  }
  assert.equal(selectInTargets().some(target => target.id === 'demo.target'), false)
  assert.equal(unregisterSelectInTarget('demo.target'), false, '已注销再注销返回 false')
})

test('isAvailable 过滤（上游 SelectInTarget.isAvailable）', () => {
  registerSelectInTarget({
    id: 'demo.unavailable', label: '不可用', weight: 11,
    isAvailable: () => false, canSelect: () => true, selectIn: () => {},
  })
  try {
    assert.ok(selectInTargets().some(target => target.id === 'demo.unavailable'),
      'selectInTargets 是 EP 原始列表（上游 SelectInManager 先取全表）')
    assert.equal(selectInTargetRows(baseContext()).some(row => row.id === 'demo.unavailable'), false,
      'isAvailable 为假的目标不该进行')
  } finally {
    unregisterSelectInTarget('demo.unavailable')
  }
})

test('bundledSelectInTargets 的 selectIn 都走宿主回调（没有写死的副作用）', () => {
  const calls = []
  const context = baseContext({
    selectProjectView: () => calls.push('project'),
    showNavBar: () => calls.push('navbar'),
    focusToolWindow: id => calls.push(`tw:${id}`),
    openProjectStructure: () => calls.push('settings'),
    revealInExplorer: () => calls.push('explorer'),
  })
  for (const target of bundledSelectInTargets()) target.selectIn(context)
  assert.deepEqual(calls.sort(), ['explorer', 'navbar', 'project', 'settings', 'tw:git', 'tw:outline'])
})
