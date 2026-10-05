// Search Everywhere **每一档自己的筛选器**（上游 `SeTargetsFilterEditor` 一族）与本仓对话框的接线。
// 上游坐标：
//   · `platform/searchEverywhere/frontend/src/tabs/SeTargetsFilterEditor.kt:72-74`（头部动作顺序）
//   · 同文件 `:95`（`SearchEverywhere.PersistedScope.$tabId`）、`:102`（存的是作用域**名字**）
//   · 同文件 `:34-40`（关掉类型漏斗时把状态归到干净档）、`:91`（hiddenTypes = 没开着的那些）
//   · `platform/searchEverywhere/frontend/src/tabs/utils/SeTypeVisibilityStateHolder.kt:13-21`
//   · `platform/searchEverywhere/backend/src/providers/files/SeFilesProvider.kt:69-74`（空集合全拒 / 未设全收）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DIRECTORY_TYPE_NAME,
  FILTER_HEADER_ACTIONS,
  NO_EXTENSION_TYPE_NAME,
  acceptsByHiddenTypes,
  fileTypeNameOf,
  hiddenTypesOf,
  initialTargetsFilter,
  isTypeVisible,
  persistedScopeKey,
  readPersistedPreview,
  readPersistedScope,
  setTypeVisibility,
  typeVisibilityStates,
  writePersistedPreview,
  writePersistedScope,
} from '../src/searchEverywhereFilters.ts'

const dialogSource = () => readFileSync(new URL('../src/components/SearchEverywhereDialog.vue', import.meta.url), 'utf8')

/** 一个最小 localStorage 替身（模块自己做了 `typeof localStorage === 'undefined'` 的守护）。 */
function withStorage(run) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return run(store) } finally { delete globalThis.localStorage }
}

test('头部动作顺序 = [作用域, 预览, 类型]（SeTargetsFilterEditor.kt:72-74）', () => {
  assert.deepEqual([...FILTER_HEADER_ACTIONS], ['scope', 'preview', 'type'])
})

test('hiddenTypesOf 挑的是"没开着"的那些（:91）', () => {
  const states = [
    { name: 'ts', icon: 'File', enabled: true },
    { name: 'md', icon: 'File', enabled: false },
    { name: '目录', icon: 'Folder', enabled: false },
  ]
  assert.deepEqual(hiddenTypesOf(states), ['md', '目录'])
  assert.deepEqual(hiddenTypesOf(null), [], '没有类型表 = 没有任何东西被关掉')
})

test('作用域存档：键名照上游，存的是名字，读回来查不到名字就回落（:95/:102/:106-112）', () => {
  assert.equal(persistedScopeKey('files'), 'SearchEverywhere.PersistedScope.files')
  withStorage(store => {
    writePersistedScope('files', '库外')
    assert.equal(store.get('SearchEverywhere.PersistedScope.files'), '库外')
    assert.equal(readPersistedScope('files'), '库外')
    writePersistedScope('files', null)
    assert.equal(readPersistedScope('files'), null, '写 null 等于清档')
  })
  const caps = {
    tabId: 'files',
    scopesInfo: { selectedScopeId: '项目', everywhereScopeId: '项目', scopeNames: ['项目', '库外'] },
    typeVisibilityStates: null,
    hasPreviewAction: true,
    persistScopeIfAvailable: true,
  }
  assert.equal(initialTargetsFilter({ ...caps, persistedScopeName: '库外' }).scopeId, '库外')
  assert.equal(initialTargetsFilter({ ...caps, persistedScopeName: '不存在的作用域' }).scopeId, '项目',
    '存档里的名字查不到时回落 selectedScopeId，不造一个空作用域')
})

test('autoToggleEnabled = 选的不是"所有位置"（:43）', () => {
  const caps = {
    tabId: 'files',
    scopesInfo: { selectedScopeId: '项目', everywhereScopeId: '所有位置', scopeNames: ['项目', '所有位置'] },
    typeVisibilityStates: [],
    hasPreviewAction: true,
  }
  assert.equal(initialTargetsFilter({ ...caps }).autoToggleEnabled, true)
  assert.equal(initialTargetsFilter({ ...caps, persistedScopeName: '所有位置' }).autoToggleEnabled, false)
})

test('关掉类型漏斗时把状态归到干净档（:34-40 与 SeTabsCustomizer.kt:22-24）', () => {
  const states = [{ name: 'ts', icon: 'File', enabled: false }]
  const caps = { tabId: 'commands', scopesInfo: null, typeVisibilityStates: states, hasPreviewAction: false }
  assert.deepEqual(initialTargetsFilter({ ...caps, typeFilterEnabled: false }).hiddenTypes, [],
    '漏斗不可用时存储里的关档必须被忽略，否则用户没有入口清它')
  assert.deepEqual(initialTargetsFilter({ ...caps, typeFilterEnabled: true }).hiddenTypes, ['ts'])
})

test('setTypeVisibility：按名字找**第一个** isEnabled != value 的项换掉，找不到什么都不做（:13-19）', () => {
  const states = [
    { name: 'ts', icon: 'File', enabled: true },
    { name: 'md', icon: 'File', enabled: true },
  ]
  const next = setTypeVisibility(states, 'md', false)
  assert.deepEqual(next.map(state => state.enabled), [true, false])
  assert.deepEqual(states.map(state => state.enabled), [true, true], '原表不被改动（cloneWithEnabled）')
  assert.deepEqual(setTypeVisibility(states, 'nope', false), states, '查不到这个名字 = 不动')
  assert.deepEqual(setTypeVisibility(states, null, false), states)
})

test('isTypeVisible：查不到这一档就不显示（:21 的默认拒绝）', () => {
  const states = [{ name: 'ts', icon: 'File', enabled: true }]
  assert.equal(isTypeVisible(states, 'ts'), true)
  assert.equal(isTypeVisible(states, 'md'), false, '表里没有的类型默认拒绝，不是默认放行')
  assert.equal(isTypeVisible(states, null), false)
})

test('类型候选只从真实结果里长出来，已关掉的留在表里（否则关完就找不回来）', () => {
  const previous = [{ name: 'log', icon: 'File', enabled: false }]
  const next = typeVisibilityStates(['ts', 'md', 'log'], previous)
  assert.deepEqual(next.map(state => `${state.name}:${state.enabled}`), ['log:false', 'ts:true', 'md:true'])
  assert.deepEqual(typeVisibilityStates([]), [], '一种类型都没有 = 空表 = 漏斗图标整个不出现（:53-56）')
})

test('文件类型取扩展名，目录与无扩展名各占一档', () => {
  assert.equal(fileTypeNameOf('src/main/App.ts'), 'ts')
  assert.equal(fileTypeNameOf('src/main/APP.CPP'), 'cpp', '大小写归一：同一扩展名不能长出一个新类型')
  assert.equal(fileTypeNameOf('Makefile'), NO_EXTENSION_TYPE_NAME)
  assert.equal(fileTypeNameOf('src/main/'), DIRECTORY_TYPE_NAME)
  assert.equal(acceptsByHiddenTypes(['log'], 'ts'), true)
  assert.equal(acceptsByHiddenTypes(['log'], 'log'), false)
})

test('预览开关按档存档（PreviewAction 的状态挂在每一档的 filter 上）', () => {
  withStorage(store => {
    writePersistedPreview('files', false)
    assert.equal(store.get('SearchEverywhere.Preview.files'), '0')
    assert.equal(readPersistedPreview('files', true), false)
    assert.equal(readPersistedPreview('symbols', true), true, '没存过的档用调用方给的默认值')
    assert.equal(readPersistedPreview('symbols', false), false)
  })
})

// ── 生产接线 ─────────────────────────────────────────────────────────────────────
test('对话框按档取筛选器：作用域/预览/类型漏斗都挂在当前 tab 上', () => {
  const source = dialogSource()
  assert.match(source, /const filter = computed\(\(\) => initialTargetsFilter\(\{/,
    '没有走 `initialTargetsFilter`（editor 初值那一段规则就白移植了）')
  assert.match(source, /writePersistedScope\(tab\.value, name\)/, '作用域没有按档写回存档')
  assert.match(source, /writePersistedPreview\(tab\.value, on\)/, '预览开关没有按档写回存档')
  assert.match(source, /readPersistedScope\(tab\.value\)/, '作用域没有读回按档的存档')
  assert.match(source, /readPersistedPreview\(tab\.value, legacyPreviewDefault\)/,
    '预览开关没有读回按档的存档（旧全局键只能当默认值）')
  assert.match(source, /v-for="action in FILTER_HEADER_ACTIONS"/, '头部动作顺序不是上游那一条')
  assert.match(source, /acceptsByHiddenTypes\(hiddenTypes\.value, fileTypeNameOf\(/, '类型漏斗没有真的作用在结果上')
  assert.match(source, /setTypeVisibility\(typeStates\.value, name, value\)/, '勾选没有走 SeTypeVisibilityStateHolder 的等价物')
  assert.match(source, /isTypeFilterEnabled\(tab\.value, tabCustomization\.value\)/, '漏斗可用性没有过定制器')
})

test('对话框没有把类型表画成常开控件（没有类型就没有那一格）', () => {
  const source = dialogSource()
  assert.match(source, /action === 'type' && typeStates\.length/, '空表时漏斗仍然会渲染 = 假控件')
})
