// 随处搜索的空态文案（B6：`SearchEverywhereEmptyTextProvider` + `SearchEverywhereUI.updateEmptyText`）。
//
// 上游 `SearchEverywhereUI.java:1926-2011` 分两支：有 `SearchEverywhereEmptyTextProvider` 实现者
// 的 tab 用实现者的文案（本树里只有 `TextSearchContributor.kt:281-300`），否则走通用分支。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SE_EMPTY_TEXT, searchEverywhereEmptyText, tabHasTextSearch } from '../src/searchEverywhereEmpty.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// 上游 `SearchEverywhereUI.java:1929`：查询词为空时**不显示空态**（否则一打开就是"找不到"）。
test('an empty query shows no empty state', () => {
  assert.equal(searchEverywhereEmptyText('all', ''), null)
  assert.equal(searchEverywhereEmptyText('all', '   '), null)
  assert.equal(searchEverywhereEmptyText('commands', ''), null)
})

// 有实现者的两档（文字搜索 / 文件名）：主行是"找不到任何内容"。
test('the text-search tabs say nothing was found', () => {
  const all = searchEverywhereEmptyText('all', 'zzz')
  assert.equal(all?.primary, `${SE_EMPTY_TEXT.nothingFound}。`)
  assert.equal(all?.usedOptions, null, '没开选项时上游不显示那一行')
  assert.equal(searchEverywhereEmptyText('project', 'zzz')?.primary, all?.primary)
})

test('which tabs count as text search follows the upstream implementor', () => {
  assert.equal(tabHasTextSearch('all'), true)
  assert.equal(tabHasTextSearch('project'), true)
  assert.equal(tabHasTextSearch('commands'), false)
  assert.equal(tabHasTextSearch('runConfigs'), false)
})

// `TextSearchContributor.updateEmptyStatus:284` 的守卫：**只有用过选项才**加那一行。
test('the used-options line appears only when an option was on', () => {
  assert.equal(searchEverywhereEmptyText('all', 'zzz', { caseSensitive: true })?.usedOptions, `${SE_EMPTY_TEXT.usedOptions}\n${SE_EMPTY_TEXT.caseSensitive}`)
  assert.equal(searchEverywhereEmptyText('all', 'zzz', { wholeWords: true })?.usedOptions, `${SE_EMPTY_TEXT.usedOptions}\n${SE_EMPTY_TEXT.wholeWords}`)
  assert.equal(searchEverywhereEmptyText('all', 'zzz', { regex: true })?.usedOptions, `${SE_EMPTY_TEXT.usedOptions}\n${SE_EMPTY_TEXT.regex}`)
  const both = searchEverywhereEmptyText('all', 'zzz', { caseSensitive: true, regex: true })?.usedOptions
  assert.equal(both, `${SE_EMPTY_TEXT.usedOptions}\n${SE_EMPTY_TEXT.caseSensitive} ${SE_EMPTY_TEXT.regex}`)
})

// 文案逐条取随 IDE 发货的中文语言包，不是自己译的。
test('the strings come from the shipped Chinese bundle', () => {
  assert.equal(SE_EMPTY_TEXT.nothingFound, '找不到任何内容', 'IdeBundle.properties:2330')
  assert.equal(SE_EMPTY_TEXT.findInFiles, '在文件中查找', 'IdeBundle.properties:1136')
  assert.equal(SE_EMPTY_TEXT.useMain, '使用', 'IdeBundle.properties:1137')
  assert.equal(SE_EMPTY_TEXT.caseSensitive, '区分大小写')
  assert.equal(SE_EMPTY_TEXT.wholeWords, '单词')
  assert.equal(SE_EMPTY_TEXT.regex, '正则表达式')
})

// 两个 tab 都留一条"在文件中查找"的出路（上游 `showFindInFilesAction` 那一支）。
test('both branches offer the find-in-files way out', () => {
  for (const tab of ['all', 'project', 'commands', 'runConfigs']) {
    const empty = searchEverywhereEmptyText(tab, 'zzz')
    assert.equal(empty?.action?.label, `${SE_EMPTY_TEXT.useMain} ${SE_EMPTY_TEXT.findInFiles}`)
    assert.equal(empty?.action?.shortcut, 'Ctrl Shift F')
  }
})

// 没有作用域与过滤器 ⇒ 上游通用分支里那两句不出现（本仓不造点了没反应的链接）。
test('no scope/filter links are offered, because neither exists here', () => {
  const empty = searchEverywhereEmptyText('commands', 'zzz')
  assert.equal(empty?.primary, '', '通用分支只有出路，没有正文')
  assert.doesNotMatch(JSON.stringify(empty), /作用域/)
})

// —— 接线 ——

test('the dialog renders the empty state instead of a fixed sentence', () => {
  const dialog = read('src/components/SearchEverywhereDialog.vue')
  assert.match(dialog, /searchEverywhereEmptyText/, '空态要按 tab 与选项算')
  assert.match(dialog, /class="palette-empty se-empty"/)
  assert.match(dialog, /emit\('findInFiles'\)/, '那一条出路要有落点')
  assert.doesNotMatch(dialog, /没有匹配的结果。/, '写死的那一句应已删除')
})

test('the host gives the find-in-files action a real target', () => {
  const app = read('src/App.vue')
  assert.match(app, /@find-in-files="searchEverywhereOpen = false; showView\('search'\)"/, '宿主要接住并打开工程内搜索')
})
