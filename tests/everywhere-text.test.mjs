// Search Everywhere 的 **Text 档**（上游 `SeTextTab` + `platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt`）
// 与本仓宿主装配的接线判据。上游坐标：
//   · `platform/searchEverywhere/frontend/src/tabs/text/SeTextTab.kt:52`（ID = `TextSearchContributor`）
//   · 同文件 `:56`（PRIORITY = 250）、`:37-43`（筛选器带的是 FindModel 的三个布尔）
//   · 同文件 `:35`（`canBeShownInFindResults() = true`）
//   · `platform/searchEverywhere/frontend/src/tabs/all/SeAllTab.kt:51-53`（All = 除被关掉外的全部供给者）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DEFAULT_TEXT_OPTIONS,
  SE_TEXT_LIMIT,
  SE_TEXT_MIN_QUERY,
  SE_TEXT_TAB_ID,
  SE_TEXT_TAB_PRIORITY,
  TEXT_OPTION_LABELS,
  clipHit,
  loadTextOptions,
  saveTextOptions,
  textHitFragments,
  textHitViews,
  textQueryAllowed,
  textSearchParams,
} from '../src/searchEverywhereText.ts'
import { SEARCH_EVERYWHERE_TABS, searchEverywhereResults, searchEverywhereSourceLabel } from '../src/searchEverywhere.ts'

const hostSource = () => readFileSync(new URL('../src/searchEverywhereHost.ts', import.meta.url), 'utf8')

function withStorage(run) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
  try { return run(store) } finally { delete globalThis.localStorage }
}

const match = (path, line, column, preview, length = 4) => ({ path, line, column, preview, length })
const baseName = path => path.split(/[\\/]/).pop()

test('三个开关默认全关（上游 FindModel 的默认档），存档缺键/坏值都回落默认', () => {
  assert.deepEqual(DEFAULT_TEXT_OPTIONS, { caseSensitive: false, wholeWords: false, regex: false })
  withStorage(() => {
    assert.deepEqual(loadTextOptions(), DEFAULT_TEXT_OPTIONS, '没存过 = 默认档')
    saveTextOptions({ caseSensitive: true, wholeWords: false, regex: true })
    assert.deepEqual(loadTextOptions(), { caseSensitive: true, wholeWords: false, regex: true })
    localStorage.setItem('taocode.searchEverywhere.text.options', '{"caseSensitive":"yes"}')
    assert.deepEqual(loadTextOptions(), { caseSensitive: false, wholeWords: false, regex: false },
      '坏值按缺键处理：不因为存过别的形状就整份判损坏')
    localStorage.setItem('taocode.searchEverywhere.text.options', 'not json')
    assert.deepEqual(loadTextOptions(), DEFAULT_TEXT_OPTIONS)
  })
})

test('开关的中文标题三档齐全，面板不在模板里散着写文案', () => {
  assert.deepEqual(Object.keys(TEXT_OPTION_LABELS).sort(), ['caseSensitive', 'regex', 'wholeWords'])
  assert.equal(TEXT_OPTION_LABELS.caseSensitive, '区分大小写')
})

test('门槛：不足 SE_TEXT_MIN_QUERY 个字符不发全库扫描', () => {
  assert.equal(textQueryAllowed('ab'), false)
  assert.equal(textQueryAllowed('  ab  '), false, '两端空白不算长度')
  assert.equal(textQueryAllowed('abc'), true)
  assert.equal(SE_TEXT_MIN_QUERY, 3)
})

test('三个开关 → 宿主 `search.run` 的入参（字段名是宿主那一套）', () => {
  const params = textSearchParams('  Foo  ', { caseSensitive: true, wholeWords: false, regex: true })
  assert.deepEqual(params, {
    query: 'Foo', regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '',
  })
  const masked = textSearchParams('bar', DEFAULT_TEXT_OPTIONS, { include: '*.ts', exclude: '*.md' })
  assert.equal(masked.include, '*.ts')
  assert.equal(masked.exclude, '*.md')
})

test('命中窗口：以命中为中心前后各一小截，超出前面补省略号', () => {
  const long = 'x'.repeat(200)
  const clipped = clipHit(long, 120)
  assert.ok(clipped.startsWith('…'), '左边被切掉要看得出来')
  assert.ok(clipped.length <= 81)
  assert.equal(clipHit('short line', 1), 'short line')
})

test('宿主命中 → 候选行：去重按「文件+行+列」，条数有上限', () => {
  const views = textHitViews([
    match('src/a.ts', 3, 7, 'const foo = 1', 3),
    match('src/a.ts', 3, 7, 'const foo = 1', 3),
    match('src/b.ts', 9, 1, 'bar()', 3),
  ], baseName)
  assert.equal(views.length, 2, '同一处被两个分块送到过一次时列表不能出现两行')
  assert.deepEqual(views[0], {
    id: 'src/a.ts:3:7', title: 'const foo = 1', subtitle: 'a.ts:3:7',
    path: 'src/a.ts', line: 3, column: 7, preview: 'const foo = 1', fragments: [[6, 9]],
  })
  const many = Array.from({ length: SE_TEXT_LIMIT + 20 }, (_unused, i) => match(`src/f${i}.ts`, 1, 1, `hit ${i}`))
  assert.equal(textHitViews(many, baseName).length, SE_TEXT_LIMIT)
})

test('命中段高亮：区间按宿主的 column+length 落在窗口内（textSearch 一族随命中交出 MyRange）', () => {
  // 行首起的命中：没有省略号偏移。
  assert.deepEqual(textHitFragments('const foo = 1', 7, 3), [[6, 9]])
  // 窗口以命中为中心、前面留 40 个码点，所以那一行前面补了一个省略号，区间整体右移一位。
  const long = `${'z'.repeat(200)}needle here`
  const clipped = clipHit(long, 201)
  assert.match(clipped, /^…z{40}needle/, '窗口以命中为中心，前面切掉 40 个码点')
  assert.deepEqual(textHitFragments(long, 201, 6), [[41, 47]])
  // 命中段右沿越出窗口：夹住，不画出不存在的字符。
  assert.deepEqual(textHitFragments('abc', 3, 99), [[2, 3]])
  // length 由宿主给（native/search.cpp:410），0 或负数一律不画。
  assert.deepEqual(textHitFragments('abc', 1, 0), [])
  assert.deepEqual(textHitFragments('abc', 1, -3), [])
  // 行首空白被 trim 掉了 ⇒ 区间跟着左移（画在 'foo' 上，不是 'foo' 前面的空位上）。
  assert.deepEqual(textHitFragments('    foo bar', 5, 3), [[0, 3]])
  // 命中右沿正好压在窗口右边界上：不越界、也不丢字符（行的起点被左沿切掉 20 个码点）。
  assert.deepEqual(textHitFragments(`${'q'.repeat(60)}needle`, 61, 6), [[41, 47]])
})

test('Text 档进了 tab 表：id 与 priority 都取上游那一档，并排最右', () => {
  const def = SEARCH_EVERYWHERE_TABS.find(entry => entry.id === SE_TEXT_TAB_ID)
  assert.ok(def, 'Text 档不在表里')
  assert.equal(def.priority, SE_TEXT_TAB_PRIORITY)
  assert.equal(def.priority, 250)
  assert.deepEqual([...def.sources], ['text'])
  const lowest = Math.min(...SEARCH_EVERYWHERE_TABS.filter(entry => entry.id !== 'all').map(entry => entry.priority))
  assert.equal(def.priority, lowest, '六档里 Text 的 priority 最低 ⇒ 排在最右（SeTextTab.kt:56）')
})

test('All 档含 text 供给者（上游 All = 除被关掉外的全部供给者，SeAllTab.kt:51-53）', () => {
  assert.ok(SEARCH_EVERYWHERE_TABS[0].sources.includes('text'))
  const item = {
    id: 'text:src/a.ts:3:5', title: 'const foo = 1', source: 'text',
    path: 'src/a.ts', open: () => undefined,
  }
  assert.deepEqual(searchEverywhereResults([item], 'foo', 'all').map(each => each.id), ['text:src/a.ts:3:5'])
  assert.deepEqual(searchEverywhereResults([item], 'foo', 'project'), [], '文本命中不进 Project 档')
  assert.equal(searchEverywhereSourceLabel('text'), 'Text', '标签不能掉回 Run Configuration')
})

// ── 生产接线：宿主真的打 `search.run` ─────────────────────────────────────────────
test('宿主把 Text 档接到 `search.run`，并且只在 All / Text 两档发', () => {
  const source = hostSource()
  assert.match(source, /request<SearchResult>\('search\.run', \{ \.\.\.params \}\)/,
    '没有真的打宿主通道')
  assert.match(source, /textSearchParams\(query, textOptions\.value\)/, '入参不是由三个开关换算的')
  assert.match(source, /textHitViews\(result\.matches \?\? \[\], baseName\)/, '命中没有走映射函数')
  assert.match(source, /activeTab\.value === SE_TEXT_TAB_ID \|\| activeTab\.value === 'all'/,
    '扫描没有按档门控（每一档都扫全库）')
  assert.match(source, /textQueryAllowed\(query\)/, '没有最短查询词门槛')
  assert.match(source, /mergeSearchExclude\(params\.exclude, projectExclusionPatterns\(textExcludedDirs\.value\)\)/,
    '工程排除目录没有并进来（与「在文件中查找」不同口径）')
  assert.match(source, /saveTextOptions\(textOptions\.value\)/, '开关改动没有写回存档')
  assert.match(source, /setSearchEverywhereTab/, '切档没有告诉宿主')
  assert.match(source, /hitRanges: hit\.fragments/, '命中段的高亮没有交给列表行')
})

test('列表行按宿主的命中区间画高亮（Text 档不走模糊匹配那一条路）', () => {
  const source = readFileSync(new URL('../src/components/SearchEverywhereDialog.vue', import.meta.url), 'utf8')
  assert.match(source, /entry\.source === 'text' \? entry\.hitRanges \?\? \[\] : fuzzyTitleFragments\(/,
    'Text 行还在用文件名模糊匹配的那套区间，或者根本没画')
})
