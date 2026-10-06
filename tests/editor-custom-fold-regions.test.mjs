// `src/customFoldingRegions.ts` 的判据：`lp/custom-folding` 判决点名的
// `CustomFoldingRegionsPopup` / `GotoCustomRegionAction` 那一层的**列表与导航**规则。
//
// 断言的每一处都对着上游坐标（模块头有逐条出处）：
//   · 顺序与嵌套层数 = `CustomFoldingRegionsPopup.java:62-78` 的 `orderByPosition`（栈算深度）；
//   · 每层三个空格 = 同文件 `:58` 的 `StringUtil.repeat("   ", indent)`；
//   · 占位文字 = `VisualStudioCustomFoldingProvider.java:23-27` 与
//     `NetBeansCustomFoldingProvider.java:24-27`（正则不匹配 ⇒ 原样返回整段元素文本，
//     去空白后**为空**才是 `...`）；
//   · 配对必须同族 = `CustomFoldingBuilder.java:79-92` + `:194-203`（一次构建只问一份 provider）；
//   · 跳到区域 = `GotoCustomRegionAction.java:60-66`（没有区域就返回 null，
//     对应 `:65` 那条提示）+ `CustomFoldingRegionsPopup.java:80-88` 的落点（开始标记的偏移）。
// 标记识别本身由 `src/editorFolding.ts` 的 `regionMarker` 承担，判据在
// `tests/editor-region-folding.test.mjs`，这里只锁本模块新增的那一层。
import test from 'node:test'
import assert from 'node:assert/strict'

import { nextCustomRegion, regionEntries, regionIndent, regionLabel } from '../src/customFoldingRegions.ts'
import { localRegionFolds } from '../src/editorFolding.ts'
import { CUSTOM_FOLDING_PROVIDERS, markersPair, matchingStartIndex } from '../src/customFoldingProviders.ts'

const DIALECT = `// 顶部
//<region 构造>
// setup
//</region>
void f() {
//#region render
// draw
//#endregion
//<region 尾部>
}
//</region>
// 底部
`

// 三条区间互不相交 ⇒ 每次都被出栈，层数都是 0（`CustomFoldingRegionsPopup.java:73`）。
// 真正测「区间包含关系」的是 NESTED 那一份：外层 [0,4] 套住内层 [1,3] ⇒ 内层栈深 1。
const NESTED = `//<region 外层>
//#region 内层
x
//#endregion
//</region>
`

test('区域按位置排序，嵌套层数由区间包含关系算出', () => {
  const regions = regionEntries(DIALECT)
  assert.deepEqual(regions.map(region => [region.label, region.startLine, region.endLine, region.depth]), [
    ['构造', 1, 3, 0],
    ['render', 5, 7, 0],
    ['尾部', 8, 10, 0],
  ])
  assert.deepEqual(regionEntries(NESTED).map(region => [region.label, region.startLine, region.endLine, region.depth]), [
    ['外层', 0, 4, 0],
    ['内层', 1, 3, 1],
  ])
})

test('落点是开始标记那一行的偏移（navigateTo 的目标）', () => {
  const [first] = regionEntries(DIALECT)
  assert.equal(DIALECT.slice(first.from, first.from + 10), '//<region ')
  assert.equal(first.to, DIALECT.indexOf('\n', first.from))
  // `navigateTo` 用的是**元素**（开始标记那一行）的起始偏移：CustomFoldingRegionsPopup.java:81。
  assert.equal(first.depth, 0)
})

test('占位文字取 marker 之后的说明；取不到就是 ...（两个 provider 的空值分支）', () => {
  assert.equal(regionLabel('//<region 构造>'), '构造')
  assert.equal(regionLabel('#pragma region Foo'), 'Foo')
  assert.equal(regionLabel('//<editor-fold desc="状态机">'), '状态机')
  assert.equal(regionLabel('/* region 块 */'), '块')
  // <region> 那一族的 provider 在社区树之外（无法核实），只能退回 `...`。
  assert.equal(regionLabel('//<region>'), '...')
  // **2026-10-06 改判这一条**（原写 `...`）：上游 NetBeans 的实现是
  // `elementText.replaceFirst(".*desc\\s*=\\s*\"([^\"]*)\".*", "$1").trim()`
  // （`NetBeansCustomFoldingProvider.java:25-26`）—— Java 的 replaceFirst 在**正则不匹配时原样返回入参**，
  // 所以没有 `desc` 属性时占位文字就是整段注释 token 本身（`...` 只在**结果去空白后为空**时才出现）。
  // 旧断言把「捕获为空」与「正则不匹配」两档并成了一档，钉的是错的值。
  assert.equal(regionLabel('//<editor-fold>'), '//<editor-fold>')
  assert.equal(regionLabel('  //<editor-fold defaultstate="collapsed">'), '//<editor-fold defaultstate="collapsed">')
  assert.equal(regionLabel('// 跟 region 无关'), '...')
})

test('上/下一个区域按行号走，到头绕回另一端；没有区域返回 null', () => {
  const regions = regionEntries(DIALECT)
  assert.equal(nextCustomRegion(regions, 0, true).label, '构造')
  assert.equal(nextCustomRegion(regions, 1, true).label, 'render')
  assert.equal(nextCustomRegion(regions, 5, true).label, '尾部')
  // 最后一个之后绕回第一个。
  assert.equal(nextCustomRegion(regions, 8, true).label, '构造')
  assert.equal(nextCustomRegion(regions, 10, false).label, '尾部')
  assert.equal(nextCustomRegion(regions, 5, false).label, '构造')
  // 第一个之前绕到最后一个。
  assert.equal(nextCustomRegion(regions, 1, false).label, '尾部')
  assert.equal(nextCustomRegion([], 0, true), null)
})

test('未闭合的开始标记不产生区域（配对规则与 localRegionFolds 同源）', () => {
  assert.deepEqual(regionEntries('//<region a>\nx\n'), [])
  assert.deepEqual(regionEntries('//</region>\n'), [])
})

// 配对必须**同族**：`CustomFoldingBuilder.java:194-203` 把认下来的 provider 缓存成一份，
// `:79-92` 的入栈/出栈都问这同一份 ⇒ 上游的栈里天然只有同族开始标记，
// `//<region>` 与 `#region` 在两族之间不会互相收尾。
test('异族标记不互相收尾：开始与结束必须是同一个 provider 的一对', () => {
  const crossed = [
    '//<region A>',      // 0
    'code',              // 1
    '//endregion',       // 2 —— VS 一族的收尾，关不掉上面的 <region>
    'more',              // 3
    '//</region>',       // 4 —— 关掉 0 那条
  ].join('\n')
  assert.deepEqual(regionEntries(crossed).map(region => [region.startLine, region.endLine]), [[0, 4]],
    '那条 endregion 不是本区域的收尾（上游那一份 provider 也认不出它是 end）')
  assert.deepEqual(localRegionFolds(crossed), [{ startLine: 0, endLine: 4, kind: 'region' }])
  // 交叉嵌套：内层是另一族 ⇒ 外层收尾时把没闭合的异族内层一起丢掉（它没配到结束标记 ⇒ 不产生区域）。
  const nested = ['#region B', '//#region C', 'x', '//#endregion', 'y'].join('\n')
  assert.deepEqual(regionEntries(nested).map(region => [region.startLine, region.endLine]), [[1, 3]])
  assert.deepEqual(localRegionFolds(nested), [{ startLine: 1, endLine: 3, kind: 'region' }])
  // 同族的正常嵌套照旧（栈式配对，未被这条改动影响）。
  const sameFamily = ['//<region A>', '//#region B', 'x', '//#endregion', 'y', '//</region>'].join('\n')
  assert.deepEqual(regionEntries(sameFamily).map(region => [region.startLine, region.endLine]), [[0, 5], [1, 3]],
    '出栈顺序是内层先成对，但列表按**元素起始偏移升序**排（`CustomFoldingRegionsPopup.java:66-67`）')
})

test('provider 表里那两条配对判据（markersPair / matchingStartIndex）', () => {
  const region = CUSTOM_FOLDING_PROVIDERS[2]
  const vs = CUSTOM_FOLDING_PROVIDERS[1]
  assert.equal(markersPair({ provider: region, kind: 'start' }, { provider: region, kind: 'end' }), true)
  assert.equal(markersPair({ provider: region, kind: 'start' }, { provider: vs, kind: 'end' }), false)
  assert.equal(markersPair({ provider: region, kind: 'end' }, { provider: region, kind: 'end' }), false,
    '两条都是 end 也不算一对')
  const start = { provider: region, kind: 'start' }
  const other = { provider: vs, kind: 'start' }
  const end = { provider: vs, kind: 'end' }
  assert.equal(matchingStartIndex([start, other], end), 1, '自顶向下找同族的那一条')
  assert.equal(matchingStartIndex([start], end), -1, '栈里没有同族的开始标记')
  assert.equal(matchingStartIndex([], end), -1)
})

test('列表行按层数缩进三个空格（StringUtil.repeat("   ", indent)）', () => {
  assert.equal(regionIndent('构造', 0), '构造')
  assert.equal(regionIndent('render', 2), '      render')
})
