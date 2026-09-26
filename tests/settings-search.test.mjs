import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GROUP_SEPARATOR,
  SETTINGS_PATH_PREFIX,
  contains,
  isNameHit,
  matchesOption,
  optionMatches,
  pathSegments,
  resolveSettingsPath,
  searchWords,
  settingsPath,
} from '../src/settingsSearch.ts'

// WORD_SEPARATOR_CHARS = /[^-\pL\d#+]+/ — SearchableOptionsRegistrarImpl.kt:42.
test('words split on everything that is not a letter, digit, #, + or -', () => {
  assert.deepEqual(searchWords('Editor Font Size'), ['editor', 'font', 'size'])
  assert.deepEqual(searchWords('Editor (Font) 4'), ['editor', 'font', '4'])
  assert.deepEqual(searchWords('c++ #tag a-b'), ['c++', '#tag', 'a-b'])
  assert.deepEqual(searchWords('  '), [])
})

test('a run of CJK characters stays a single word', () => {
  assert.deepEqual(searchWords('缩进宽度'), ['缩进宽度'])
  assert.deepEqual(searchWords('每个编辑器组的标签页上限'), ['每个编辑器组的标签页上限'])
})

test('duplicate words collapse, like the HashSet IDEA collects into', () => {
  assert.deepEqual(searchWords('size SIZE size'), ['size'])
})

// SearchUtil.kt:209-237 — force = every query word as a word of the text.
test('the strict pass requires every query word to be present as a word', () => {
  assert.equal(matchesOption('缩进宽度', '缩进宽度', true), true)
  // Full-width brackets separate words, so the label really does contain 缩进宽度 as a word.
  assert.equal(matchesOption('缩进宽度（像素）', '缩进宽度', true), true)
  // One uninterrupted CJK run: the strict pass sees 缩进宽度设置, not 缩进宽度.
  assert.equal(matchesOption('缩进宽度设置', '缩进宽度', true), false)
  assert.equal(matchesOption('Font size', 'font size', true), true)
  assert.equal(matchesOption('Font family', 'font size', true), false)
})

// SearchUtil.kt:232-235 — the fallback pass accepts a single word or a substring hit.
test('the fallback pass accepts a substring or any single word', () => {
  assert.equal(matchesOption('缩进宽度设置', '缩进宽度', false), true)
  assert.equal(matchesOption('Font family', 'font size', false), true)
  assert.equal(matchesOption('Font family', '缩进', false), false)
})

// SearchUtil.kt:210-224 — no words (a query of separators only) falls back to a substring test.
test('a query without words is matched as a plain substring', () => {
  assert.deepEqual(searchWords('|'), [])
  assert.equal(matchesOption('a | b', '|', true), true)
  assert.equal(matchesOption('a b', '|', true), false)
  assert.equal(contains('Appearance', 'pear'), true)
  assert.equal(contains('Appearance', ''), false)
})

// SearchUtil.kt:82-86 — strict pass over the whole page first, loose pass only if it found nothing.
test('a page matches when any row matches, strict pass first', () => {
  const rows = ['缩进宽度（像素）', '字体大小']
  assert.equal(optionMatches(rows, '缩进宽度'), true)
  assert.equal(optionMatches(rows, '字体'), true)
  assert.equal(optionMatches(rows, '不存在的项'), false)
  assert.equal(optionMatches([], '字体'), false)
})

// SearchableOptionsRegistrarImpl.kt:217-231 — name hits use the whole query against the name.
test('name hits test the whole query against the page name', () => {
  assert.equal(isNameHit('编辑器', '编辑器'), true)
  assert.equal(isNameHit('外观', '编辑器'), false)
  assert.equal(isNameHit('外观', '|'), true) // no words left -> every page counts (:221-225)
})

// SearchableOptionsRegistrar.java:21 + CommonBundle.properties:37 + CopySettingsPathAction.kt:55-65.
test('the copied option path uses IDEA’s separator and prefix', () => {
  assert.equal(GROUP_SEPARATOR, ' | ')
  assert.equal(settingsPath([]), null)
  assert.equal(settingsPath(['外观与行为', '外观']), `${SETTINGS_PATH_PREFIX} | 外观与行为 | 外观`)
  assert.equal(settingsPath(['编辑器']), `${SETTINGS_PATH_PREFIX} | 编辑器`)
})

// parseSettingsPath — SearchableOptionsRegistrarImpl.kt:507-529.
test('only a query containing the separator is parsed as a path', () => {
  assert.equal(pathSegments('缩进'), null)
  assert.deepEqual(pathSegments('文件 | 设置 | 外观与行为 | 外观'), ['外观与行为', '外观'])
  assert.deepEqual(pathSegments('设置 | 编辑器'), ['编辑器'])
  assert.deepEqual(pathSegments('File | Settings | Editor'), ['Editor'])
})

test('prefix stripping is case-insensitive and only from the start', () => {
  assert.deepEqual(pathSegments('file | settings | editor'), ['editor'])
  assert.deepEqual(pathSegments('外观 | 文件 | 设置'), ['外观', '文件', '设置'])
  assert.deepEqual(pathSegments('设置'), null) // no separator at all
})

// findGroupsByPath — SearchableOptionsRegistrarImpl.kt:457-505.
const groups = [
  { key: 'group:appearance', label: '外观与行为' },
  { key: 'group:project', label: '项目' },
]
const nodes = [
  { key: 'appearance', label: '外观', parent: 'group:appearance' },
  { key: 'editor', label: '编辑器', parent: null },
  { key: 'structure', label: '项目结构', parent: 'group:project' },
]

test('a pasted path resolves to the deepest page it names', () => {
  assert.deepEqual(
    resolveSettingsPath('文件 | 设置 | 外观与行为 | 外观', groups, nodes),
    { parent: 'group:appearance', key: 'appearance', spotlight: '' },
  )
  assert.deepEqual(resolveSettingsPath('设置 | 编辑器', groups, nodes), { parent: null, key: 'editor', spotlight: '' })
})

test('the leftover path segments become the spotlight text', () => {
  assert.deepEqual(
    resolveSettingsPath('文件 | 设置 | 编辑器 | 缩进宽度', groups, nodes),
    { parent: null, key: 'editor', spotlight: '缩进宽度' },
  )
})

test('a path that names a group stops at the group and spotlights the rest', () => {
  assert.deepEqual(
    resolveSettingsPath('设置 | 项目 | 项目结构', groups, nodes),
    { parent: 'group:project', key: 'structure', spotlight: '' },
  )
  assert.deepEqual(
    resolveSettingsPath('设置 | 外观与行为 | 外观 | 主题', groups, nodes),
    { parent: 'group:appearance', key: 'appearance', spotlight: '主题' },
  )
})

test('a path that matches nothing, or no path at all, resolves to null', () => {
  assert.equal(resolveSettingsPath('设置 | 不存在的页', groups, nodes), null)
  assert.equal(resolveSettingsPath('缩进宽度', groups, nodes), null)
  assert.equal(resolveSettingsPath('文件 | 设置', groups, nodes), null)
})
