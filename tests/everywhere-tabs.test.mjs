// Search Everywhere 的 **tab 表定制**（上游 `SeTabsCustomizer`）与本仓对话框的接线判据。
// 上游坐标：
//   · `platform/searchEverywhere/frontend/src/SeTabsCustomizer.kt:17`（customizeTabInfo 可返回 null）
//   · 同文件 `:25`（isTypeFilterEnabled 默认 true）、`:29`（SeTabInfo(priority, name)）
//   · `platform/searchEverywhere/frontend/src/SeDefaultTabsCustomizer.kt:8`（默认实现原样返回）
//   · `platform/searchEverywhere/frontend/src/tabs/all/SeAllTab.kt:89`（PRIORITY = Integer.MAX_VALUE）
//   · `platform/searchEverywhere/frontend/src/tabs/text/SeTextTab.kt:56`（PRIORITY = 250）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  customizeTabInfo,
  isTypeFilterEnabled,
  sortTabsByPriority,
  visibleEverywhereTabs,
} from '../src/searchEverywhereTabs.ts'
import { SEARCH_EVERYWHERE_TABS } from '../src/searchEverywhere.ts'
import { SE_TEXT_TAB_PRIORITY } from '../src/searchEverywhereText.ts'

const dialogSource = () => readFileSync(new URL('../src/components/SearchEverywhereDialog.vue', import.meta.url), 'utf8')

test('customizeTabInfo：默认实现原样返回（上游 SeDefaultTabsCustomizer.kt:8）', () => {
  assert.deepEqual(customizeTabInfo('files', { priority: 900, name: 'Files' }), { priority: 900, name: 'Files' })
})

test('customizeTabInfo：改名与改位次各走各的键，没提意见的字段不动', () => {
  const renamed = customizeTabInfo('files', { priority: 900, name: 'Files' }, { rename: { files: '文件' } })
  assert.deepEqual(renamed, { priority: 900, name: '文件' })
  const moved = customizeTabInfo('files', { priority: 900, name: 'Files' }, { reprioritize: { files: 999 } })
  assert.deepEqual(moved, { priority: 999, name: 'Files' })
})

test('customizeTabInfo：返回 null = 这一档不出现（SeTabsCustomizer.kt:17）', () => {
  assert.equal(customizeTabInfo('text', { priority: 250, name: 'Text' }, { hidden: { text: true } }), null)
  assert.notEqual(customizeTabInfo('text', { priority: 250, name: 'Text' }, { hidden: { files: true } }), null)
})

test('isTypeFilterEnabled：缺省为真（:25 的默认值），显式关掉的档为假', () => {
  assert.equal(isTypeFilterEnabled('files'), true)
  assert.equal(isTypeFilterEnabled('files', {}), true)
  assert.equal(isTypeFilterEnabled('files', { typeFilterEnabled: { files: false } }), false)
  assert.equal(isTypeFilterEnabled('commands', { typeFilterEnabled: { commands: false } }), false)
  assert.equal(isTypeFilterEnabled('text', { typeFilterEnabled: { commands: false } }), true)
})

test('priority 降序 = 越大越靠左（SeTab.kt:31-34），同分保持表内原序', () => {
  const sorted = sortTabsByPriority([
    { id: 'a', priority: 250 },
    { id: 'b', priority: 900 },
    { id: 'c', priority: 900 },
    { id: 'd', priority: 950 },
  ])
  assert.deepEqual(sorted.map(entry => entry.id), ['d', 'b', 'c', 'a'])
})

test('visibleEverywhereTabs：摘档 + 改名 + 重排一次做完，输入表不被改动', () => {
  const input = [
    { id: 'all', priority: 900, label: 'All' },
    { id: 'text', priority: 250, label: 'Text' },
    { id: 'files', priority: 900, label: 'Files' },
  ]
  const out = visibleEverywhereTabs(input, { hidden: { text: true }, rename: { files: '文件' } })
  assert.deepEqual(out.map(entry => `${entry.id}:${entry.label}:${entry.priority}`), ['all:All:900', 'files:文件:900'])
  assert.equal(input.length, 3, '定制不改动调用方传进来的表')
})

test('本仓 tab 表的 priority 全部来自上游那一档', () => {
  const byId = Object.fromEntries(SEARCH_EVERYWHERE_TABS.map(entry => [entry.id, entry.priority]))
  assert.ok(byId.all > byId.classes, 'All 在最左（Integer.MAX_VALUE）')
  assert.equal(byId.classes, 950)
  assert.equal(byId.files, 900, 'Files 档取上游 SeFilesTab.kt:52 的位次（2026-10-06 从 Project 合成档拆回）')
  assert.equal(byId.symbols, 850)
  assert.equal(byId.commands, 800)
  assert.equal(byId.runConfigs, 350)
  assert.equal(byId.text, SE_TEXT_TAB_PRIORITY)
})

test('按 priority 降序排完就是表里声明的顺序（数组顺序不再是排序依据）', () => {
  const shuffled = [...SEARCH_EVERYWHERE_TABS].reverse()
  assert.deepEqual(
    visibleEverywhereTabs(shuffled).map(entry => entry.id),
    SEARCH_EVERYWHERE_TABS.map(entry => entry.id),
  )
})

// ── 生产接线：对话框真的用这一份定制过的表 ────────────────────────────────────────
test('对话框过 visibleEverywhereTabs / isTypeFilterEnabled，不再直接渲染常量表', () => {
  const source = dialogSource()
  assert.match(source, /visibleEverywhereTabs\(SEARCH_EVERYWHERE_TABS, tabCustomization\.value\)/,
    'tab 行没有走定制表（SeTabsCustomizer 的等价物被绕开了）')
  assert.match(source, /isTypeFilterEnabled\(tab\.value, tabCustomization\.value\)/,
    '类型漏斗没有过 isTypeFilterEnabled 这一步')
  assert.doesNotMatch(source, /const tabs = SEARCH_EVERYWHERE_TABS/, 'tabs 又变回静态常量了')
})

test('宿主没给 Text 档通道时那一档整档摘掉（不放假 tab）', () => {
  const source = dialogSource()
  assert.match(source, /hidden: props\.textOptions \? \{\} : \{ text: true \}/,
    'Text 档的摘档判据不在定制里')
  assert.match(source, /typeFilterEnabled: \{ commands: false, runConfigs: false, text: false \}/,
    '没有文件行的三档没被关掉类型漏斗')
})
