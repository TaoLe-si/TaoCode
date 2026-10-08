// 用法视图「导出到文本文件」的模块侧文本 + 消费链。
// 判据前缀 `USAGEEXPORT`：每条都写清了"哪里改坏它就该红"，并在末尾配了正对照（防止断言恒真 / 夹具空过）。
//
// 上游依据（本机参考树，本轮逐行开过；根 =
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · 形状：platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java
//     `:25-29`（getReportText）、`:31-47`（先打 indent、根不打印、`:35` 子级缩进四个空格）、
//     `:57-63`（组行 = 呈现文本 + `" "` + `" (" + usages.n(递归合计) + ")"`）、
//     `:73-81`（叶子 = chunk 逐个拼、chunk0 之后补一个空格）
//   · 黄金样本（逐空格）：platform/platform-tests/testSrc/com/intellij/usages/impl/UsageViewTest.java:262-270
//   · 计数文案：platform/usageView/resources/messages/UsageViewBundle.properties:8（usages.n）
//   · 可导判据：ExporterToTextFile.java:93-96（!isSearchInProgress && areTargetsValid）
//   · 默认名/记住上次：同文件 `:84-91` + platform/platform-impl/src/com/intellij/ide/util/ExportToFileUtil.java:58-102
//   · chunk0 = 行号：platform/usageView/src/com/intellij/usages/ChunkExtractor.java:361
//
// 判据怎么读：`usageExportText` 只吃**行**（`UsageTreeRow` 的那几格），所以这里绝大多数期望值是**字面文本**；
// 行序、缩进、括号前空格、统计行任一处被改动都会当场红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canExportUsages, usageExportFileName, usageExportGroupLine, usageExportLeafLine, usageExportLeaves,
  usageExportLine, usageExportNameSeed, usageExportSavedNote, usageExportSuggestedName, usageExportText,
  USAGE_EXPORT_INDENT,
} from '../src/usageViewExport.ts'
import { buildUsageTree, flattenUsageTree, usageGroupKey, usagesFoundText } from '../src/usageViewGrouping.ts'
import {
  collapseAllUsageGroups, exportReferencesText, finishReferences, referenceExportRows, referenceExportHeader,
  referenceRows, referencesGroupByDirectory, rememberUsageExportPath, resetReferences, selectReferences, startReferences,
  toggleUsageGroup, usageExportAllowed, usageExportRememberedPath, usageExportSuggestedFileName,
} from '../src/referenceContents.ts'
import { usageTreeRows } from '../src/usageViewTreeModel.ts'

const row = (kind, depth, label, extra = {}) => ({
  kind, depth, label, count: extra.count ?? 0, path: extra.path ?? 'src/x.ts',
  line: extra.line ?? -1, character: extra.character ?? -1,
})

// ——— USAGEEXPORT-1 形状：缩进、组行、叶子、标题、统计 ———

test('USAGEEXPORT-1：导出文本 = 标题 + 每层四个空格 + 组行计数 + 结尾统计（逐字比对）', () => {
  const rows = [
    row('directory', 0, 'src', { count: 3 }),
    row('file', 1, 'x.ts', { count: 3 }),
    row('class', 2, 'Widget', { count: 2 }),
    row('usage', 3, '12:5', { path: 'src/x.ts', line: 11, character: 4 }),
    row('usage', 3, '30:1', { path: 'src/x.ts', line: 29, character: 0 }),
    row('method', 2, 'render()', { count: 1 }),
    row('usage', 3, '7:3', { path: 'src/x.ts', line: 6, character: 2 }),
  ]
  assert.equal(usageExportText(rows, { header: '对「foo」的引用' }), [
    '对「foo」的引用',
    '',
    'src (找到 3 条用法)',
    '    x.ts (找到 3 条用法)',
    '        Widget (找到 2 条用法)',
    '            12:5',
    '            30:1',
    '        render() (找到 1 条用法)',
    '            7:3',
    '',
    '3 处引用 / 1 个文件',
  ].join('\n'), '改缩进量 / 括号前空格 / 统计行措辞 / 标题那一空行任一处都会红在这里')
})

test('USAGEEXPORT-2：缩进量就是上游那一格（四个空格，ExporterToTextFile.java:35）', () => {
  assert.equal(USAGE_EXPORT_INDENT, '    ', '不是四个空格就不是上游的 childIndent')
  assert.equal(usageExportLine(row('usage', 3, '12:5')), '            12:5')
  // depth 为负（外部数据源写坏了）不许吐出控制用的负数 repeat ⇒ 夹到 0
  assert.equal(usageExportLine(row('usage', -2, '12:5')), '12:5')
})

test('USAGEEXPORT-3：组行用子树合计、叶子只给位置文本（`:57-63` 与 `:73-81` 的两格不同形状）', () => {
  assert.equal(usageExportGroupLine(row('file', 0, 'src/x.ts', { count: 4 })), 'src/x.ts (找到 4 条用法)')
  assert.equal(usageExportLeafLine(row('usage', 1, '2:8')), '2:8')
  assert.equal(usageExportGroupLine(row('directory', 0, 'src', { count: 0 })), `src (${usagesFoundText(0)})`,
    '零那一档走 usages.n 的 0#no usages ⇒「没有找到用法」，不是「找到 0 条用法」')
})

test('USAGEEXPORT-4：行序列一条不重排、一条不补（本模块不是第二棵树遍历）', () => {
  const rows = [row('file', 0, 'b.ts', { count: 1 }), row('usage', 1, '9:1'), row('file', 0, 'a.ts', { count: 1 }), row('usage', 1, '3:1')]
  assert.deepEqual(usageExportText(rows, { summary: false }).split('\n'),
    ['b.ts (找到 1 条用法)', '    9:1', 'a.ts (找到 1 条用法)', '    3:1'],
    '顺序 = 面板那一列行的顺序；这里若在导出侧再排一次账就与面板漂开')
  // 正对照：同一份行喂给既有那一条平表导出，顺序是**排过**的 ⇒ 两条路确实不同，本条断言不是恒真
  const tree = buildUsageTree([{ path: 'b.ts', line: 8 }, { path: 'a.ts', line: 2 }], '工作区')
  assert.deepEqual(flattenUsageTree(tree).map(entry => entry.label), ['a.ts', '3:1', 'b.ts', '9:1'])
})

test('USAGEEXPORT-5：空行序列 = 空串（不写标题也不写统计，与既有档一致）', () => {
  assert.equal(usageExportText([], { header: 'H' }), '')
  assert.equal(usageExportText([]), '')
})

test('USAGEEXPORT-6：行分隔符可换（上游 `:27` 传的是 System.lineSeparator()）', () => {
  const rows = [row('file', 0, 'x.ts', { count: 1 }), row('usage', 1, '4:2')]
  assert.equal(usageExportText(rows, { lineSeparator: '\r\n' }), 'x.ts (找到 1 条用法)\r\n    4:2\r\n\r\n1 处引用 / 1 个文件')
})

test('USAGEEXPORT-7：结尾统计只数叶子（组行不参与，措辞复用既有 usageSummary）', () => {
  const rows = [
    row('directory', 0, 'src', { count: 2 }), row('file', 1, 'x.ts', { count: 2 }),
    row('usage', 2, '5:1', { path: 'src/x.ts' }), row('usage', 2, '9:2', { path: 'src/y.ts' }),
  ]
  assert.deepEqual(usageExportLeaves(rows).map(entry => entry.label), ['5:1', '9:2'])
  assert.equal(usageExportText(rows).split('\n').at(-1), '2 处引用 / 2 个文件')
  const three = rows.concat([row('file', 1, 'z.ts', { count: 1 }), row('usage', 2, '1:1', { path: 'src/z.ts' })])
  assert.equal(usageExportText(three, { summary: false }).split('\n').length, 6, '关掉统计就少两行（那条空行 + 统计行）')
  assert.equal(usageExportText(three).split('\n').at(-1), '3 处引用 / 3 个文件')
})

// ——— USAGEEXPORT-8 canExport（`:93-96`） ———

test('USAGEEXPORT-8：还在搜 / 那条内容没了 / 一行都没有 ⇒ 不许导', () => {
  const ok = { searching: false, targetsValid: true, rowCount: 4 }
  assert.equal(canExportUsages(ok), true, '三个条件都满足时必须放行（否则整条判据恒假）')
  assert.equal(canExportUsages({ ...ok, searching: true }), false, 'isSearchInProgress')
  assert.equal(canExportUsages({ ...ok, targetsValid: false }), false, 'areTargetsValid')
  assert.equal(canExportUsages({ ...ok, rowCount: 0 }), false, '本仓多的一档：屏上一行都没有就不写只有标题的文件')
})

// ——— USAGEEXPORT-9/10 默认名（`:84-91` 的 getDefaultFilePath / exportedTo） ———

test('USAGEEXPORT-9：默认文件名 = usages-<查询名>-<yyyymmdd-HHmm>.txt，非法字符不进文件名', () => {
  const date = new Date(2026, 9, 6, 14, 5)
  assert.equal(usageExportFileName('对「foo」的引用 在 项目文件', date), 'usages-对「foo」的引用-在-项目文件-20261006-1405.txt')
  assert.equal(usageExportFileName('a/b\\c:d*e?f"g<h>i|j', date).startsWith('usages-a-b-c-d-e-f-g-h-i-j-2026'), true)
  assert.equal(usageExportFileName('', date).startsWith('usages-usages-20261006-1405.txt'), true, '空名退回 usages')
  assert.equal(usageExportNameSeed('x'.repeat(80)).length, 40, '长名字截到 40，别把整条面板标题塞进文件名')
  assert.equal(usageExportFileName('foo', date).endsWith('.txt'), true, '写盘通道只放行 .html/.htm/.txt')
})

test('USAGEEXPORT-10：记住上一次导出的名字（exportedTo 那一格），没记或不是 .txt 就现造', () => {
  const date = new Date(2026, 9, 6, 14, 5)
  assert.equal(usageExportSuggestedName('D:\\out\\我的用法.txt', 'foo', date), '我的用法.txt')
  assert.equal(usageExportSuggestedName('/tmp/notes.log', 'foo', date), 'usages-foo-20261006-1405.txt',
    '记忆里那条不是 .txt（写坏了/别处存的）⇒ 退回现造的默认名，不跟着写个通道不认的扩展名')
  assert.equal(usageExportSuggestedName('', 'foo', date), 'usages-foo-20261006-1405.txt')
  assert.equal(usageExportSavedNote('D:/out/a.txt', 3), `已导出 ${usagesFoundText(3)}：D:/out/a.txt`)
})

// ——— USAGEEXPORT-11 消费链：文本从**行模型**来，且只有一条路 ———

test('USAGEEXPORT-11：导出侧不许自己再遍历树（静态反向验证 + 正对照）', () => {
  const source = readFileSync(new URL('../src/usageViewExport.ts', import.meta.url), 'utf8')
  const walk = /flattenUsageTree|buildUsageTree|usageFileNodes|\.children\b/
  assert.equal(walk.test(source.replace(/^(\/\/.*$\n?)+/gm, '')), false,
    'USAGEEXPORT：导出模块出现「遍历树」的那几个入口 = 同一份规则写了第二遍，行模型那一层就白立了')
  // 正对照：同一个正则在既有那条树形导出里必须命中（证明上面那条不是恒真）
  assert.match(readFileSync(new URL('../src/usageViewGrouping.ts', import.meta.url), 'utf8'), walk)
})

test('USAGEEXPORT-12：referenceContents 的导出走新模块与行模型（不是那条吃树的旧路）', () => {
  const source = readFileSync(new URL('../src/referenceContents.ts', import.meta.url), 'utf8')
  assert.match(source, /from '\.\/usageViewExport\.ts'/, '没接上新模块 ⇒ 面板导出还是那套两遍账')
  assert.match(source, /usageExportText\(referenceExportRows\.value/, 'exportReferencesText 必须吃装配好的那一列行')
  assert.match(source, /referenceExportRows[\s\S]{0,240}usageTreeRows\(usageRowsForQuery/,
    '导出行必须由行模型那一条链产出（usageRowsForQuery + usageTreeRows）')
  assert.doesNotMatch(source, /import \{[^}]*\bexportUsageTreeText\b/s, '旧那条吃树的导出若还被 import 就是两份实现并存')
})

test('USAGEEXPORT-13：导出的那一列行就是行模型装配的产物（带 id / level 两格）', () => {
  resetReferences()
  const search = startReferences('foo', 'Foo')
  finishReferences(search, [{ path: 'src/x.ts', line: 1, character: 0 }, { path: 'README.md', line: 0, character: 0 }])
  try {
    const rows = referenceExportRows.value
    assert.ok(rows.length > 0, '夹具空过：这一条得在**有行**的时候才谈得上"复用了行模型"')
    assert.ok(rows.every(entry => typeof entry.id === 'string' && entry.id.length > 0 && typeof entry.level === 'string'),
      'USAGEEXPORT：没有 id/level = 这一列行不是 usageTreeRows 装配出来的，导出侧就是第二套遍历')
    assert.deepEqual([...new Set(rows.map(entry => entry.level))].sort(), ['file', 'usage'], '层名取自行模型那四档')
    // 正对照：`flattenUsageTree` 的直接产物**没有**这两格 ⇒ 上面那条不是恒真
    const bare = flattenUsageTree(buildUsageTree([{ path: 'src/x.ts', line: 1, character: 0 }], '工作区'))
    assert.equal(bare[0].id, undefined, '正对照失配：flatten 的产物本该没有 id')
    assert.equal(usageTreeRows(bare)[0].id, bare[0].key, '正对照：装配之后才有 id')
  } finally {
    resetReferences()
  }
})

test('USAGEEXPORT-14：导出的是整棵 model —— 折叠不影响它，但面板行少几行', () => {
  resetReferences()
  const search = startReferences('foo', 'Foo')
  finishReferences(search, [{ path: 'src/x.ts', line: 1, character: 0 }, { path: 'src/x.ts', line: 4, character: 2 }, { path: 'README.md', line: 0, character: 0 }])
  const previousDirectories = referencesGroupByDirectory.value
  try {
    const before = exportReferencesText('H').split('\n')
    toggleUsageGroup(usageGroupKey('file', 'src/x.ts'))
    assert.equal(referenceRows.value.some(entry => entry.label === '2:1'), false, '收起之后屏上那两条引用不画了')
    assert.equal(exportReferencesText('H'), before.join('\n'),
      'USAGEEXPORT：折叠改了导出文本 ⇒ 上游导的是 model（ExporterToTextFile.java:25-29），不是展开态')
    assert.ok(referenceExportRows.value.some(entry => entry.label === '2:1'), '导出用的那一列行仍然带着折叠掉的叶子')
  } finally {
    referencesGroupByDirectory.value = previousDirectories
    resetReferences()
  }
})

test('USAGEEXPORT-15：导出跟着目录那一档走（与面板同一份层序、同一份缩进）', () => {
  resetReferences()
  const search = startReferences('foo', 'Foo')
  finishReferences(search, [{ path: 'src/x.ts', line: 1, character: 0 }, { path: 'src/sub/y.ts', line: 4, character: 0 }])
  const previous = referencesGroupByDirectory.value
  const body = () => exportReferencesText('H').split('\n').slice(2, -2)
  try {
    referencesGroupByDirectory.value = false
    assert.deepEqual(body(), ['src/sub/y.ts (找到 1 条用法)', '    5:1', 'src/x.ts (找到 1 条用法)', '    2:1'],
      '关着目录 ⇒ 文件行给整条相对路径（与面板那一档同一份文本规则）')
    referencesGroupByDirectory.value = true
    assert.deepEqual(body(), ['src (找到 2 条用法)', '    src/sub (找到 1 条用法)', '        y.ts (找到 1 条用法)',
      '            5:1', '    x.ts (找到 1 条用法)', '        2:1'],
      '开目录 ⇒ 每多一层多四个空格；目录行的文本是整条相对路径、文件行退回文件名')
  } finally {
    referencesGroupByDirectory.value = previous
    resetReferences()
  }
})

test('USAGEEXPORT-16：标题行 = 正在看的那条 Content 的面板标题；换一条就跟着换', () => {
  resetReferences()
  const first = startReferences('alpha', 'A#alpha')
  finishReferences(first, [{ path: 'a.ts', line: 0, character: 0 }])
  assert.match(referenceExportHeader(), /A#alpha/, '面板标题里带着那条查询名（上游那一格是根组行 Usages，本仓的根不可见）')
  const second = startReferences('beta', 'B#beta')
  finishReferences(second, [{ path: 'b.ts', line: 3, character: 0 }])
  assert.match(usageExportSuggestedFileName(new Date(2026, 9, 6, 14, 5)), /B#beta|B-beta/, '默认名跟着当前那条走')
  selectReferences(first.id)
  assert.equal(exportReferencesText(referenceExportHeader()).split('\n')[0], referenceExportHeader())
})

test('USAGEEXPORT-17：canExport 的三格在 store 里真的会翻（不是恒真放行）', () => {
  resetReferences()
  assert.equal(usageExportAllowed(), false, '一条内容都没有 ⇒ 不许导')
  const search = startReferences('foo', 'Foo')
  assert.equal(usageExportAllowed(), false, '正在搜索那一拍不许导（上游 !isSearchInProgress）')
  finishReferences(search, [{ path: 'a.ts', line: 0, character: 0 }])
  assert.equal(usageExportAllowed(), true, '结果回来就该放行')
  collapseAllUsageGroups()
  assert.equal(usageExportAllowed(), true, '折叠不关掉导出（导的是 model）')
  assert.equal(referenceExportRows.value.length, 2, '折叠后屏上只剩组行，导出的那一列行还是两条')
  resetReferences()
})

test('USAGEEXPORT-18：记住的导出名会写回（exportedTo），缺键与写坏了都不炸、也不污染默认名', () => {
  const previous = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
  }
  try {
    assert.equal(usageExportRememberedPath(), '', '缺键 = 空串（旧磁盘上的存档不会因为多了一个键被判损坏）')
    assert.match(usageExportSuggestedFileName(new Date(2026, 9, 6, 14, 5)), /^usages-.*\.txt$/, '没记过就按当前查询现造')
    rememberUsageExportPath('D:/out/我的用法.txt')
    assert.equal(usageExportRememberedPath(), 'D:/out/我的用法.txt')
    assert.equal(usageExportSuggestedFileName(new Date(2026, 9, 6, 14, 5)), '我的用法.txt',
      'USAGEEXPORT：下次打开对话框要落在上次那个文件上（getDefaultFilePath 那一格）')
    rememberUsageExportPath('D:/out/notes.log')
    assert.match(usageExportSuggestedFileName(new Date(2026, 9, 6, 14, 5)), /^usages-.*\.txt$/,
      '记忆里那条不是 .txt ⇒ 不能跟着写一个通道不认的扩展名')
  } finally {
    if (previous) globalThis.localStorage = previous
    else delete globalThis.localStorage
  }
})

// ——— USAGEEXPORT-19 UI 出口：有真落盘通道才画那一行 ———

test('USAGEEXPORT-19：面板那一格接的是真落盘通道（dialog.saveFile + app.writeExportFiles）', () => {
  const panel = readFileSync(new URL('../src/components/ReferencePanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /title="导出到文本文件"/, '没有那按钮 = 模块侧文本没人导（R-2 的原状）')
  assert.match(panel, /:disabled="!canExport \|\| exporting"/, '判据没接上 = 搜索期间也点得动（假控件）')
  assert.match(panel, /request<string \| null>\('dialog\.saveFile'/, 'USAGEEXPORT：没有保存对话框这一跳')
  assert.match(panel, /request\('app\.writeExportFiles'/, 'USAGEEXPORT：内容没走宿主写盘通道')
  assert.match(panel, /exportReferencesText\(referenceExportHeader\(\)\)/, '导出的文本必须来自那条消费链，不是面板自己拼')
  assert.match(panel, /rememberUsageExportPath\(target\)/, '写完要记名字（ExporterToTextFile.java:88-91）')
  // 正对照：写盘通道确实放行 .txt（否则上面那条就是画一个存不了文件的按钮）
  const allowed = readFileSync(new URL('../native/export_file.hpp', import.meta.url), 'utf8')
  assert.match(allowed, /kAllowedExtensions\[\] = \{[^}]*"\.txt"/)
})
