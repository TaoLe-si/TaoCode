// 判据 · 「Sort Configurations」的纯比较器与可用档（runcfg4 W1）。
//
// 上游 `platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt:1289-1341`：
// 比较器在 `:1292-1307`（文件夹在前且保序 / 普通按名 / 临时在后），可用档在 `:1331-1341`
// （选中的节点里有类型或文件夹才启用）。本判据钉这三条规则与「配置 → 比较器输入」的映射。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canSortRunConfigNodes, compareRunConfigSiblings, runConfigSortSiblingOf, sortRunConfigSiblings,
} from '../src/runConfigTree.ts'

test('文件夹永远在前，且两个文件夹之间保持原有次序', () => {
  const siblings = [
    { folder: false, temporary: false, name: 'beta' },
    { folder: true, temporary: false, name: 'zFolder' },
    { folder: false, temporary: false, name: 'alpha' },
    { folder: true, temporary: false, name: 'aFolder' },
  ]
  assert.deepEqual(sortRunConfigSiblings(siblings).map(item => item.name), ['zFolder', 'aFolder', 'alpha', 'beta'])
})

test('普通配置按名；TEMPORARY_CONFIGURATION 排在其后，同为临时再按名', () => {
  const siblings = [
    { folder: false, temporary: true, name: 'tempB' },
    { folder: false, temporary: false, name: 'normA' },
    { folder: false, temporary: true, name: 'tempA' },
    { folder: false, temporary: false, name: 'normB' },
  ]
  assert.deepEqual(sortRunConfigSiblings(siblings).map(item => item.name), ['normA', 'normB', 'tempA', 'tempB'])
})

test('比较器逐对语义（文件夹 < 普通 < 临时）', () => {
  const folder = { folder: true, temporary: false, name: 'f' }
  const normal = { folder: false, temporary: false, name: 'a' }
  const temporary = { folder: false, temporary: true, name: 'a' }
  assert.ok(compareRunConfigSiblings(folder, normal) < 0, '文件夹在普通配置之前')
  assert.ok(compareRunConfigSiblings(normal, temporary) < 0, '普通配置在临时配置之前')
  assert.equal(compareRunConfigSiblings(folder, { folder: true, temporary: false, name: 'g' }), 0, '两个文件夹保序（稳定排序）')
})

test('可用档：选中类型/文件夹才可点，只选配置不可点', () => {
  assert.equal(canSortRunConfigNodes(['config']), false)
  assert.equal(canSortRunConfigNodes([]), false)
  assert.equal(canSortRunConfigNodes(['type']), true)
  assert.equal(canSortRunConfigNodes(['folder']), true)
  assert.equal(canSortRunConfigNodes(['config', 'folder']), true)
})

test('配置 → 比较器输入：临时位与名字带过去，folder 恒 false', () => {
  assert.deepEqual(runConfigSortSiblingOf({ name: 'X', temporary: true }), { folder: false, temporary: true, name: 'X' })
  assert.deepEqual(runConfigSortSiblingOf({ name: 'Y' }), { folder: false, temporary: false, name: 'Y' })
})
