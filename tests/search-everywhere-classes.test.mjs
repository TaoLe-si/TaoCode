// Search Everywhere 的 **Classes 档**（上游 `platform/searchEverywhere/frontend/src/tabs/classes/`）：
//   · `SeClassesTab.kt:47` 的标题取 `GotoClassPresentationUpdater.getTabTitlePluralized()`
//     （`go.to.class.kind.text.pluralized` = "Classes"），priority 950 → 在 Files(900)/Symbols(850)/
//     Actions(800) 之前（tab 顺序 = priority 降序）；
//   · `SeClassesTabFactory.kt:34-38` 只喂 `SeProviderIdUtils.CLASSES_ID`（本仓 = LSP `workspace/symbol` 的类）；
//   · `ClassSearchEverywhereNavigationHandler.kt:23-42,77-123`：查 `Foo#bar` 时在类 Foo 的**结构视图**
//     里按匹配度找直接成员 bar，找不到就退回类本身。
//
// 两半都测：① 纯函数（`searchEverywhereClasses.ts` + `searchEverywhere.ts` 的档位过滤）；
// ② 接线 —— 宿主真的给符号项填 kind/path 并在打开时取 `documentSymbol`，对话框真的把查询词交给 open。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classMemberTarget, classSearchPattern, isSearchEverywhereClass } from '../src/searchEverywhereClasses.ts'
import { SEARCH_EVERYWHERE_TABS, availableSearchEverywhereTabs, searchEverywhereResults } from '../src/searchEverywhere.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const item = (id, title, source, extra = {}) => ({ id, title, source, open: () => { }, ...extra })
const symbol = (name, kind, startLine, startChar, endLine, endChar) => ({ name, kind, detail: '', startLine, startChar, endLine, endChar })

test('kind 判定：Class/Interface/Enum/Struct 是类，Variable/Method/Function 不是', () => {
  for (const kind of [5, 11, 10, 23]) assert.equal(isSearchEverywhereClass(kind), true, `kind ${kind} 应当算类`)
  for (const kind of [undefined, 6, 12, 13, 14, 26]) assert.equal(isSearchEverywhereClass(kind), false, `kind ${kind} 不该算类`)
})

test('`Foo#bar` 拆成 owner + member；没有 # 或 # 在开头时不带 member', () => {
  assert.deepEqual(classSearchPattern('Foo#bar'), { owner: 'Foo', member: 'bar' })
  assert.deepEqual(classSearchPattern('  Foo.Bar#baz  '), { owner: 'Foo.Bar', member: 'baz' })
  assert.deepEqual(classSearchPattern('Foo'), { owner: 'Foo', member: null })
  assert.deepEqual(classSearchPattern('Foo#'), { owner: 'Foo', member: null })
  assert.deepEqual(classSearchPattern('#bar'), { owner: '#bar', member: null })
})

const DEMO = symbol('Demo', 5, 0, 0, 20, 1)
const DEMO_SYMBOLS = [
  DEMO,
  symbol('count', 8, 1, 2, 1, 20),
  symbol('parse', 6, 3, 2, 6, 3),
  symbol('Inner', 5, 8, 2, 14, 3),
  symbol('innerMethod', 6, 10, 4, 12, 5),
]
const OWNER = { name: 'Demo', kind: 5, path: 'src/Demo.java', line: 0, character: 0 }

test('`Foo#bar` 在类的直接成员里挑最匹配的；嵌套类的成员不参与', () => {
  const target = classMemberTarget(OWNER, 'Demo#parse', DEMO_SYMBOLS)
  assert.equal(target.name, 'parse')
  assert.equal(target.line, 3, '跳到成员自己的行')
  // `innerMethod` 是 Inner 的成员，不是 Demo 的直接成员 —— 即使名字匹配也不许选中。
  const nested = classMemberTarget(OWNER, 'Demo#innerMethod', DEMO_SYMBOLS)
  assert.notEqual(nested.name, 'innerMethod')
})

test('member 一个都匹配不上时退回类本身（上游 return target as? Navigatable 的 null 分支）', () => {
  const target = classMemberTarget(OWNER, 'Demo#zzz', DEMO_SYMBOLS)
  assert.deepEqual(target, OWNER)
  // 没有 `#member` 时也原样返回类。
  assert.deepEqual(classMemberTarget(OWNER, 'Demo', DEMO_SYMBOLS), OWNER)
})

test('结构视图里找不到这个类时原样返回（宁可不跳，也不跳错）', () => {
  const other = { name: 'Other', kind: 5, path: 'src/Other.java', line: 0, character: 0 }
  assert.deepEqual(classMemberTarget(other, 'Other#parse', DEMO_SYMBOLS), other)
})

test('Classes 档：只列语言服务标成类的符号，其它供给者与 kind 都挡在外面', () => {
  const items = [
    item('file', 'Demo.java', 'project', { fuzzyPath: 'src/Demo.java' }),
    item('cls', 'Demo', 'symbols', { symbolKind: 5 }),
    item('itf', 'Greeter', 'symbols', { symbolKind: 11 }),
    item('mth', 'parse', 'symbols', { symbolKind: 6 }),
    item('var', 'count', 'symbols', { symbolKind: 13 }),
    item('cmd', 'Debug', 'commands'),
  ]
  assert.deepEqual(searchEverywhereResults(items, '', 'classes').map(each => each.id), ['cls', 'itf'])
  // 反向：Project 档仍然收文件与全部符号（Classes 只是多了一个收窄档，不是替掉 Project）。
  assert.deepEqual(searchEverywhereResults(items, '', 'project').map(each => each.id), ['file', 'cls', 'itf', 'mth', 'var'])
})

test('`Foo#member` 用 # 前的类名匹配符号（成员那一段只在打开时用）', () => {
  const items = [
    item('cls', 'Demo', 'symbols', { symbolKind: 5 }),
    item('parse', 'parse', 'symbols', { symbolKind: 6 }),
  ]
  // 方法 `parse` 不该因为 `#parse` 那段而以整个模式去比（否则它反而匹配「parse」）。
  assert.deepEqual(searchEverywhereResults(items, 'Demo#parse', 'classes').map(each => each.id), ['cls'])
  assert.deepEqual(searchEverywhereResults(items, 'Demo#parse', 'project').map(each => each.id), ['cls'])
  // 没有 `#` 时行为不变。
  assert.deepEqual(searchEverywhereResults(items, 'parse', 'classes').map(each => each.id), [])
  assert.deepEqual(searchEverywhereResults(items, 'parse', 'project').map(each => each.id), ['parse'])
})

test('显式 classesOnly 参数与档位定义同义（dialog 不传也不会漏掉这条规则）', () => {
  const items = [item('cls', 'Demo', 'symbols', { symbolKind: 5 }), item('mth', 'parse', 'symbols', { symbolKind: 6 })]
  assert.deepEqual(searchEverywhereResults(items, '', 'project', 50, false, () => true, true).map(each => each.id), ['cls'])
  assert.equal(SEARCH_EVERYWHERE_TABS.find(tab => tab.id === 'classes').classesOnly, true)
})

test('Classes 档走通用空态分支（它不是文本搜索档）', () => {
  const empty = read('src/searchEverywhereEmpty.ts')
  assert.match(empty, /tab === 'all' \|\| tab === 'project'/, 'tabHasTextSearch 只认 all/project；classes 走通用分支')
})

// ── 接线守卫 ────────────────────────────────────────────────────────────────
test('宿主给符号项填 kind 与 path，打开时按 `Foo#bar` 取 documentSymbol 定位成员', () => {
  const host = read('src/searchEverywhereHost.ts')
  assert.match(host, /symbolKind: entry\.kind/, '符号项没有带语言服务的 kind，Classes 档永远空')
  assert.match(host, /path: entry\.path/, '符号项没有真实路径，作用域表达式比不了')
  assert.match(host, /open: \(query\?: string\) => \{ void openSymbolEntry\(entry, query\) \}/, '打开没有把查询词带下去')
  assert.match(host, /kind: 'documentSymbol', path: entry\.path/, '没有取结构视图（成员定位就无从谈起）')
  assert.match(host, /jumpSymbol\(classMemberTarget\(entry, raw, symbols\)\)/, '没有走直接成员定位')
})

test('对话框把查询词交给 open（否则 `Foo#bar` 的成员定位拿不到 bar）', () => {
  const dialog = read('src/components/SearchEverywhereDialog.vue')
  assert.match(dialog, /void item\.open\(query\.value\)/,
    '对话框还在无参调用 item.open()')
  // 作用域过滤要看符号的真实路径（符号不能占 fuzzyPath —— 那会启用文件模糊打分）。
  assert.match(dialog, /item\.fuzzyPath \?\? item\.path \?\? item\.title/, '作用域过滤没有用到符号的 path')
})

test('Classes 档进"有结果的档位"表，Tab 循环真的用它（空档不进循环）', () => {
  const onlyClass = [item('cls', 'Demo', 'symbols', { symbolKind: 5 })]
  // 顺序按上游 tab priority 降序：All(MAX) → Classes(950) → Project(900) → Symbols(850) →
  // Actions(800) → Run Configurations(350)。这一批只有 symbols 供给者，所以命中四档。
  assert.deepEqual(availableSearchEverywhereTabs(onlyClass, ''), ['all', 'classes', 'project', 'symbols'])
  const dialog = read('src/components/SearchEverywhereDialog.vue')
  assert.match(dialog,
    /cycleSearchEverywhereTab\(tab\.value, delta, availableTabs\.value\)/,
    'Tab 循环还在传全量 tab 表 —— 会切进永远空着的档')
  // 循环集合仍然是"有结果的那几档"（不是全量表），并且再交一次定制表的过滤
  // （被 `SeTabsCustomizer` 摘掉的档不能成为循环目标）。
  assert.match(dialog,
    /availableSearchEverywhereTabs\(props\.items, query\.value, props\.fuzzyFiles\)\.filter\(id => visible\.has\(id\)\)/,
    '循环集合没有按结果筛，或者没有按定制表筛')
})
