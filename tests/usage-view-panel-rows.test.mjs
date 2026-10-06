// 引用面板（IDEA 的 Find 窗口）的**用法树行**—— 判词 `lp/usage-view` 的
// 「把分组树接进引用面板（面板现状是平表）」那一半的模块侧。
//
// 上游依据（本批逐行开参考树自数核对）：
//   · 层级次序：platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32
//   · 目录行文本（flattenDirs ⇒ 相对根的路径）：同目录 DirectoryGroupingRule.java:50-52 与 :150-153
//   · 文件行文本（文件名 / 短路径两档）：同目录 FileGroupingRule.java:93-95
//     与 platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:115/:118
//   · 两档默认值（文件分组开、目录分组关）：UsageViewSettings.kt:21-26
//   · 组行计数：platform/usageView-impl/src/com/intellij/usages/impl/UsageViewTreeCellRenderer.java:95-98
//     + platform/usageView/resources/messages/UsageViewBundle.properties:131
//   · 展开/折叠动作：platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1081-1082
//     与 :1317-1319（模型重建后 expandTree(2) ⇒ 默认是展开的）
//   · 树形导出：platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java:31-71
//     + UsageViewBundle.properties:8（usages.n）
//   · 目录分组那一档的动作：platform/usageView-impl/src/com/intellij/usages/impl/actions/GroupByDirectoryStructureAction.java:10-26
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allUsageGroupKeys, buildUsageTree, exportUsageTreeText, filterUsageTree, flattenUsageTree, usageCounterText,
  usageGroupKey, usageRowSearchText, usageRowsForQuery, usagesFoundText,
} from '../src/usageViewGrouping.ts'
import {
  closeReferences, collapseAllUsageGroups, expandAllUsageGroups, exportReferencesText, finishReferences,
  provideUsageSymbols, referenceRows, referenceUsageTree, references, referencesGroupByDirectory,
  referencesGroupByFileStructure, referencesInNewTab, referencesSpeedSearch, resetReferences,
  selectReferences, startReferences, toggleUsageGroup, usageSymbolsAvailable,
  USAGE_GROUP_BY_DIRECTORY_TITLE, USAGE_GROUP_BY_FILE_STRUCTURE_TITLE,
} from '../src/referenceContents.ts'
import { usageViewGearRows } from '../src/usageViewGear.ts'

const at = (path, line, character = 0) => ({ path, line, character })

/** 三个目录、四个文件、五条引用（`src/sub` 里只有一个文件，目录行仍要单独成一行）。 */
const SAMPLE = [at('src/sub/y.ts', 4, 2), at('src/x.ts', 1), at('src/x.ts', 0, 7), at('README.md', 9), at('src/note.md', 2)]

const groups = rows => rows.filter(row => row.kind !== 'usage')
const leaves = rows => rows.filter(row => row.kind === 'usage')

// ——— 规则层（flattenUsageTree / 计数 / 导出）———

test('flattenUsageTree：默认只到文件层（上游 GROUP_BY_DIRECTORY_STRUCTURE=false）', () => {
  const rows = flattenUsageTree(buildUsageTree(SAMPLE, '工作区'))
  assert.deepEqual(groups(rows).filter(row => row.kind === 'directory'), [], '目录行整个不出现')
  assert.deepEqual(groups(rows).map(row => `${row.depth}:${row.label}`),
    ['0:README.md', '0:src/note.md', '0:src/sub/y.ts', '0:src/x.ts'],
    '没有目录行 ⇒ 文件行给整条相对路径（UsageViewSettings.kt:118 的 isShortFilePathEnabled 那一支），彼此按路径序')
  assert.deepEqual(leaves(rows).map(row => row.label), ['10:1', '3:1', '5:3', '1:8', '2:1'], '叶子文本 = 1 基的 行:列')
  assert.deepEqual(leaves(rows).map(row => row.depth), [1, 1, 1, 1, 1], '叶子都在自己文件组下面一层')
  assert.deepEqual(groups(rows).map(row => row.collapsed), [false, false, false, false], '默认全展开')
  assert.equal(rows.length, 9, '四个组行 + 五条引用')
})

test('flattenUsageTree：开目录分组后目录行在前、文件行只剩文件名', () => {
  const rows = flattenUsageTree(buildUsageTree(SAMPLE, '工作区'), { showDirectories: true })
  assert.deepEqual(rows.filter(row => row.kind === 'directory').map(row => `${row.depth}:${row.label}:${row.count}`),
    ['0:src:4', '1:src/sub:1'],
    '目录行的文本是**相对根的路径**（DirectoryGroupingRule.java:150-153 的 flattenDirs），count 是子树合计')
  assert.deepEqual(rows.filter(row => row.kind === 'file').map(row => `${row.depth}:${row.label}`),
    ['2:y.ts', '1:note.md', '1:x.ts', '0:README.md'],
    '目录在前、文件在后（400 在 500 之前），有目录行时文件行只给文件名（FileGroupingRule.java:94）')
  assert.equal(groups(rows).length, 6, '两个目录 + 四个文件')
})

test('折叠：组行自己留着、子树不出现；toggleLabel 说的是反过来的那个动作', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  const fileKey = usageGroupKey('file', 'src/x.ts')
  const rows = flattenUsageTree(root, { collapsed: new Set([fileKey]) })
  const collapsedRow = groups(rows).find(row => row.key === fileKey)
  assert.ok(collapsedRow, '折叠掉的组行本身还在（上游收的是子树，不是整行）')
  assert.equal(collapsedRow.collapsed, true)
  assert.equal(collapsedRow.toggleLabel, '展开 src/x.ts')
  assert.equal(collapsedRow.detail, '2 条结果', '计数 = usage.view.counter 那一档')
  assert.equal(leaves(rows).filter(row => row.path === 'src/x.ts').length, 0, '子树不出现')
  assert.equal(leaves(rows).length, 3, '别组不受影响')
})

test('全部折叠收的是整棵树的组键（目录那一档关着时只有文件键）', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  assert.deepEqual(allUsageGroupKeys(root, { showDirectories: true }), [
    usageGroupKey('directory', 'src/'), usageGroupKey('directory', 'src/sub/'),
    usageGroupKey('file', 'src/sub/y.ts'), usageGroupKey('file', 'src/note.md'),
    usageGroupKey('file', 'src/x.ts'), usageGroupKey('file', 'README.md'),
  ], '目录在前、子树紧跟其后、最后才是根下的文件（TreeUtil.collapseAll 收的就是这一整批）')
  assert.deepEqual(allUsageGroupKeys(root), [
    usageGroupKey('file', 'README.md'), usageGroupKey('file', 'src/note.md'),
    usageGroupKey('file', 'src/sub/y.ts'), usageGroupKey('file', 'src/x.ts'),
  ], '目录那一档关着 ⇒ 树里没有目录组，折叠集里也不该有（否则就是一堆永不命中的垃圾键）')
})

test('组行计数与导出计数是上游的两条不同文案', () => {
  assert.equal(usageCounterText(1), '1 条结果', 'usage.view.counter（UsageViewBundle.properties:131）')
  assert.equal(usagesFoundText(0), '没有找到用法', 'usages.n 的 0#no usages 那一档')
  assert.equal(usagesFoundText(4), '找到 4 条用法', 'usages.n 的 N usages found（UsageViewBundle.properties:8）')
})

test('exportUsageTreeText：每层缩进 4 空格、根不写、组行带 (找到 N 条用法)', () => {
  const root = buildUsageTree([at('src/x.ts', 1), at('src/x.ts', 4), at('README.md', 0)], '工作区')
  assert.equal(exportUsageTreeText(root, { header: '对“foo”的引用' }),
    ['对“foo”的引用', '', 'README.md (找到 1 条用法)', '    1:1',
      'src/x.ts (找到 2 条用法)', '    2:1', '    5:1'].join('\n'))
  assert.equal(exportUsageTreeText(root, { showDirectories: true }),
    ['src (找到 2 条用法)', '    x.ts (找到 2 条用法)', '        2:1', '        5:1',
      'README.md (找到 1 条用法)', '    1:1'].join('\n'),
    '开着目录那一档时树里才有目录那层，文件行退回文件名（与面板同一档、同一份文本规则）')
  assert.equal(exportUsageTreeText(buildUsageTree([], '工作区')), '', '空结果导出空串，不写标题')
})

// ——— 面板状态层（referenceContents）———

test('面板行随选中的那条内容走（规则与状态同源，宿主只 v-for 一次）', () => {
  resetReferences()
  const search = startReferences('alpha', 'A#alpha')
  assert.deepEqual(referenceRows.value, [], '还没结果 = 一行都不画（没有假控件）')
  finishReferences(search, SAMPLE)
  assert.equal(referenceRows.value.length, 9)
  assert.deepEqual(leaves(referenceRows.value).map(row => `${row.path}:${row.line}:${row.character}`),
    ['README.md:9:0', 'src/note.md:2:0', 'src/sub/y.ts:4:2', 'src/x.ts:0:7', 'src/x.ts:1:0'],
    '叶子的 path/line/character 就是 LspLocation 本尊 ⇒ 单击导航行为一字不改')
  resetReferences()
})

test('折叠 / 全部折叠 / 全部展开是三个真动作', () => {
  resetReferences()
  const search = startReferences('beta', 'B#beta')
  finishReferences(search, SAMPLE)
  const fileKey = usageGroupKey('file', 'src/x.ts')
  toggleUsageGroup(fileKey)
  assert.equal(leaves(referenceRows.value).some(row => row.path === 'src/x.ts'), false, '收起来了')
  toggleUsageGroup(fileKey)
  assert.equal(leaves(referenceRows.value).filter(row => row.path === 'src/x.ts').length, 2, '再点放开')
  collapseAllUsageGroups()
  assert.equal(leaves(referenceRows.value).length, 0, '全部折叠后一条叶子都不剩')
  assert.equal(referenceRows.value.length, 4, '四个组行还在')
  expandAllUsageGroups()
  assert.equal(leaves(referenceRows.value).length, 5, '全部展开回来')
  resetReferences()
})

test('「目录结构」那一档由齿轮给，切档真的换掉树形（默认关 = 上游默认）', () => {
  resetReferences()
  const previous = referencesGroupByDirectory.value
  try {
    const group = usageViewGearRows('references')['usage.groupBy']
    assert.ok(group, '用法视图要有「分组」这一组')
    assert.deepEqual(group.children.map(child => child.title), [USAGE_GROUP_BY_DIRECTORY_TITLE])
    referencesGroupByDirectory.value = false
    const search = startReferences('gamma', 'C#gamma')
    finishReferences(search, SAMPLE)
    assert.equal(referenceRows.value.some(row => row.kind === 'directory'), false, '默认没有目录层')
    const before = referencesGroupByDirectory.value
    group.children[0].run()
    assert.equal(referencesGroupByDirectory.value, !before, '齿轮那一条切的就是同一份状态')
    assert.ok(referenceRows.value.some(row => row.kind === 'directory'), '切档后目录行出现')
    assert.equal(exportReferencesText('H').split('\n')[2], 'src (找到 4 条用法)', '导出跟着同一档走')
    collapseAllUsageGroups()
    assert.deepEqual(referenceRows.value.map(row => row.kind), ['directory', 'file'],
      '开着目录时"全部折叠"先把 src 整棵收掉 ⇒ 只剩它自己与根下的 README.md')
    group.children[0].run()
    assert.equal(referencesGroupByDirectory.value, before, '再点回来')
  } finally {
    referencesGroupByDirectory.value = previous
    resetReferences()
  }
})

test('不是用法视图就整组不给（含新加的「分组」组），齿轮里不许留点了没用的行', () => {
  assert.deepEqual(usageViewGearRows('output'), {}, '底部不是引用面板 ⇒ 一行都不给')
  assert.deepEqual(Object.keys(usageViewGearRows('references')).sort(), ['usage.groupBy', 'usage.viewOptions'])
})

test('折叠状态按内容分档：收一条不动另一条，关掉那条就把那份丢掉', () => {
  resetReferences()
  const previousNewTab = referencesInNewTab.value
  try {
    referencesInNewTab.value = true
    const first = startReferences('one', 'One')
    finishReferences(first, [at('src/a.ts', 0), at('src/b.ts', 1)])
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/a.ts', 5)])
    const fileKey = usageGroupKey('file', 'src/a.ts')
    selectReferences(second.id)
    toggleUsageGroup(fileKey)
    assert.equal(referenceRows.value.find(row => row.key === fileKey).collapsed, true, '第二条收起了 src/a.ts')
    selectReferences(first.id)
    assert.equal(referenceRows.value.find(row => row.key === fileKey).collapsed, false,
      '换回第一条：它自己的树是全展开的（上游每份 Content 一棵 model 树）')
    closeReferences(first.id)
    assert.equal(referenceUsageTree.value.count, 1, '剩下的就是第二条那一条引用')
    assert.equal(referenceRows.value.find(row => row.key === fileKey).collapsed, true, '第二条那份折叠状态没被牵连')
  } finally {
    referencesInNewTab.value = previousNewTab
    resetReferences()
  }
})

test('接线：references 仍是那张平表（既有导航的数据源没被换掉），树与三个动作都从 referenceContents 出', () => {
  assert.ok(Array.isArray(references.value), 'references 还在（面板的既有数据源）')
  for (const fn of [collapseAllUsageGroups, expandAllUsageGroups, toggleUsageGroup, exportReferencesText]) {
    assert.equal(typeof fn, 'function')
  }
})

// ——— W-3：成员层（文件 → 类 / 方法 → 行）与速度搜索的行归属 ———
//
// 上游依据（本批逐行开参考树自数核对）：
//   · 成员层这一档由 `platform/usageView-impl/src/com/intellij/usages/impl/FileStructureGroupRuleProvider.java:14-22`
//     那一族提供，装载点 = `platform/usageView-impl/src/com/intellij/usages/impl/rules/ActiveRules.java:59-62`
//     （`isGroupByFileStructure()` 为真才装），默认值 = **true**
//     （`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:21`）；
//   · 类在方法之前 = `java/java-backend/resources/META-INF/JavaPlugin.xml:566-567` 的注册序；
//   · 类层文本 = `Outer.Inner` 那种点链（`java/java-impl/src/com/intellij/usages/impl/rules/ClassGroupingRule.java:114-122`）；
//   · 方法层文本 = 名字 + 参数表（同目录 `MethodGroupingRule.java:87-91` 的
//     `PsiFormatUtil.formatMethod(SHOW_NAME | SHOW_PARAMETERS, SHOW_TYPE)`）；
//   · 同级的比较 = `compareToIgnoreCase`（`ClassGroupingRule.java:178`）；
//   · 速度搜索取的是**节点 plain text**（`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:978-983`
//     交给 `UsageViewTreeCellRenderer.java:159-213` 的 `getPlainTextForNode`），组行那份 plain text
//     里跟着一个 ` (子树合计)`（`UsageViewTreeCellRenderer.java:194` 与 `:197`）；
//   · 齿轮里「文件结构」这一行的先后 = `UsageGroupingRuleProviderImpl.java:77-78`
//     （先 Directory Structure 再 File Structure），动作本体
//     `platform/usageView-impl/src/com/intellij/usages/impl/actions/GroupByFileStructureAction.java:12-25`，
//     文本 = `platform/usageView/resources/messages/UsageViewBundle.properties:20` "File Structure"。

/** 一个文件里的两个成员：`Foo`（类，里面有个 `bar` 方法）与顶层 `main` 函数。 */
const SYMBOLS_X = [
  {
    name: 'Foo', kind: 5, startLine: 0, endLine: 20, startChar: 0, endChar: 1,
    children: [{ name: 'bar', kind: 6, startLine: 3, endLine: 8, startChar: 2, endChar: 3, detail: '(n: number)' }],
  },
  { name: 'main', kind: 12, startLine: 25, endLine: 30, startChar: 0, endChar: 1 },
]

/** 五条引用：`bar` 里一条、`Foo` 类体里一条、`main` 里一条，再加别处的两条。 */
const MEMBER_SAMPLE = [at('src/x.ts', 5, 2), at('src/x.ts', 12), at('src/x.ts', 27), at('src/y.ts', 1), at('src/y.ts', 3)]

const withSymbols = symbols => ({ symbolProvider: path => (path === 'src/x.ts' ? symbols : []) })

test('同一个文件的多处引用只生成一个文件节点（成员层同理，同名类/方法也只一个组）', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const rows = flattenUsageTree(root)
  const fileRows = rows.filter(row => row.kind === 'file')
  assert.deepEqual(fileRows.map(row => `${row.path}:${row.count}`), ['src/x.ts:3', 'src/y.ts:2'],
    'src/x.ts 三处引用 = 一行组；src/y.ts 两处 = 一行组')
  assert.equal(new Set(fileRows.map(row => row.key)).size, fileRows.length, '组键不重复 ⇒ 折叠态才有唯一归属')
  const classRows = rows.filter(row => row.kind === 'class')
  assert.deepEqual(classRows.map(row => `${row.label}:${row.count}`), ['Foo:2'], '同一个类里的两处引用（方法里 + 类体里）= 一个类组')
  assert.deepEqual(rows.filter(row => row.kind === 'method').map(row => `${row.label}:${row.count}`),
    ['bar(n: number):1', 'main:1'], '方法行带参数表那一档（MethodGroupingRule.java:87-91）；顶层函数没有 detail 就只给名字')
})

test('成员层的行序与缩进：文件 0 → 类 1 → 方法 2 → 行 3，同级类在方法前', () => {
  const rows = flattenUsageTree(buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X)))
  assert.deepEqual(rows.map(row => `${row.depth}${row.kind.slice(0, 1)}:${row.label}`), [
    '0f:src/x.ts', '1c:Foo', '2u:13:1', '2m:bar(n: number)', '3u:6:3',
    '1m:main', '2u:28:1', '0f:src/y.ts', '1u:2:1', '1u:4:1',
  ], 'Foo 的两个位置：类体那条直接挂类下面，方法里那条缩在方法下面')
  assert.deepEqual(rows.filter(row => row.kind !== 'usage').map(row => row.detail),
    ['3 条结果', '2 条结果', '1 条结果', '1 条结果', '2 条结果'], '每一层的计数都是子树合计（getRecursiveUsageCount）')
  assert.equal(rows.find(row => row.kind === 'class').path, 'src/x.ts', '成员组行的导航路径是那个文件，不是合成键')
})

test('没有符号源就不建成员层（退回文件 → 行），切档只是不画那一层', () => {
  const rows = flattenUsageTree(buildUsageTree(MEMBER_SAMPLE, '工作区', { groupByFileStructure: false }))
  assert.deepEqual(rows.filter(row => row.kind === 'class' || row.kind === 'method'), [], '关掉那一档 ⇒ 一层都不出现')
  const withoutProvider = flattenUsageTree(buildUsageTree(MEMBER_SAMPLE, '工作区', {}))
  assert.deepEqual(withoutProvider.map(row => row.kind), ['file', 'usage', 'usage', 'usage', 'file', 'usage', 'usage'],
    '宿主没交符号 ⇒ 位置直接挂文件组（上游 getParentGroupFor 返回 null 那一条）')
})

test('折叠成员组：类行自己留着、方法行与它的行都不出现；全部折叠把成员键也收进去', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const classKey = usageGroupKey('class', 'src/x.ts#Foo')
  const rows = flattenUsageTree(root, { collapsed: new Set([classKey]) })
  assert.deepEqual(rows.map(row => `${row.kind}:${row.label}`),
    ['file:src/x.ts', 'class:Foo', 'method:main', 'usage:28:1', 'file:src/y.ts', 'usage:2:1', 'usage:4:1'],
    '收的是 Foo 的子树；同文件的兄弟方法 main 不受牵连')
  assert.equal(rows.find(row => row.key === classKey).toggleLabel, '展开 Foo')
  const keys = allUsageGroupKeys(root)
  assert.ok(keys.includes(classKey) && keys.includes(usageGroupKey('method', 'src/x.ts#Foo#bar(n: number)')),
    '全部折叠要连成员层一起收，否则屏上还留着没收的类/方法行')
  assert.equal(keys.length, 5, '两个文件 + 一个类 + 两个方法')
})

test('速度搜索过滤后的行归属：计数按可见行算，没剩一行的组整个消失', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const rows = usageRowsForQuery(root, 'bar')
  assert.deepEqual(rows.map(row => `${row.depth}${row.kind.slice(0, 1)}:${row.label}:${row.count}`), [
    '0f:src/x.ts:1', '1c:Foo:1', '2m:bar(n: number):1', '3u:6:3:0',
  ], '只剩 bar 那一棵：文件行从 3 条改成"看得见的 1 条"，src/y.ts 一条不剩 ⇒ 整行不出现')
  assert.equal(usageCounterText(rows[0].count), '1 条结果')
  assert.deepEqual(usageRowsForQuery(root, 'zzz'), [], '一条都不命中 ⇒ 一行不画（面板那句"没有找到引用"由宿主出）')
  const groupHit = usageRowsForQuery(root, 'Foo')
  assert.deepEqual(groupHit.map(row => row.label), ['src/x.ts', 'Foo', '13:1', 'bar(n: number)', '6:3'],
    '组行自己命中 ⇒ 它那一整棵都算可见（上游 plain text 里组行就是文本 + ` (N)`，UsageViewTreeCellRenderer.java:194/:197）')
  assert.equal(groupHit[1].count, 2)
  assert.equal(groupHit[0].count, 2, '文件行的计数跟着可见行走，不是原始 3')
})

test('搜索文本就是上游那份 plain text（组行带计数、叶子只有位置串）', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const rows = flattenUsageTree(root)
  assert.equal(usageRowSearchText(rows.find(row => row.kind === 'file')), 'src/x.ts (3)')
  assert.equal(usageRowSearchText(rows.find(row => row.kind === 'method')), 'bar(n: number) (1)')
  assert.equal(usageRowSearchText(rows.find(row => row.kind === 'usage')), '13:1', '叶子文本没有括号计数')
})

test('面板：接上符号源才有成员层，切档与清符号源都真的换掉树形', () => {
  resetReferences()
  const previousSymbols = referencesGroupByFileStructure.value
  try {
    const search = startReferences('member', 'M#member')
    finishReferences(search, MEMBER_SAMPLE)
    assert.deepEqual(referenceRows.value.filter(row => row.kind === 'class'), [], '宿主还没交符号 ⇒ 树里不会有类层')
    provideUsageSymbols(path => (path === 'src/x.ts' ? SYMBOLS_X : []))
    assert.equal(usageSymbolsAvailable(), true)
    assert.ok(referenceRows.value.some(row => row.kind === 'class'), '交进来后同一份行模型立刻有那一层')
    const classKey = usageGroupKey('class', 'src/x.ts#Foo')
    assert.equal(referenceRows.value.find(row => row.key === classKey).detail, '2 条结果')
    referencesSpeedSearch.value = 'main'
    assert.deepEqual(referenceRows.value.map(row => row.label), ['src/x.ts', 'main', '28:1'],
      '面板这一份也是按可见行算的（文件行计数被重算）')
    assert.equal(referenceRows.value.find(row => row.kind === 'file').count, 1)
    referencesSpeedSearch.value = ''
    referencesGroupByFileStructure.value = false
    assert.deepEqual(referenceRows.value.filter(row => row.kind !== 'usage').map(row => row.kind),
      ['file', 'file'], '切档真的把那一层收掉')
    referencesGroupByFileStructure.value = true
    provideUsageSymbols(null)
    assert.equal(usageSymbolsAvailable(), false, '拔掉符号源 ⇒ 齿轮那一行也要跟着消失，别留假控件')
    assert.equal(referenceRows.value.find(row => row.kind === 'class'), undefined)
    assert.equal(exportReferencesText('H').split('\n')[2], 'src/x.ts (找到 3 条用法)', '导出与面板同一档：没符号就没有成员层')
  } finally {
    referencesGroupByFileStructure.value = previousSymbols
    provideUsageSymbols(null)
    referencesSpeedSearch.value = ''
    resetReferences()
  }
})

test('齿轮「分组」组：目录结构在前、文件结构在后（有符号源才给第二条）', () => {
  resetReferences()
  const previousSymbols = referencesGroupByFileStructure.value
  try {
    const group = usageViewGearRows('references')['usage.groupBy']
    assert.deepEqual(group.children.map(child => child.title), [USAGE_GROUP_BY_DIRECTORY_TITLE],
      '没有符号源 ⇒ 只给目录结构那一档')
    provideUsageSymbols(() => SYMBOLS_X)
    const withBoth = usageViewGearRows('references')['usage.groupBy']
    assert.deepEqual(withBoth.children.map(child => child.title),
      [USAGE_GROUP_BY_DIRECTORY_TITLE, USAGE_GROUP_BY_FILE_STRUCTURE_TITLE],
      '先后照 UsageGroupingRuleProviderImpl.java:77-78')
    const before = referencesGroupByFileStructure.value
    withBoth.children[1].run()
    assert.equal(referencesGroupByFileStructure.value, !before, '那一条改的就是同一份状态')
    const search = startReferences('gear', 'G#gear')
    finishReferences(search, MEMBER_SAMPLE)
    assert.equal(referenceRows.value.some(row => row.kind === 'class'), !before, '切档真的换掉树形')
  } finally {
    provideUsageSymbols(null)
    referencesGroupByFileStructure.value = previousSymbols
    resetReferences()
  }
})

test('换一份结果看就把过滤串清掉（过滤串属于正在看的这一份，不漏到下一份上）', () => {
  resetReferences()
  try {
    const first = startReferences('one', 'One')
    finishReferences(first, SAMPLE)
    referencesSpeedSearch.value = 'Foo'
    assert.equal(referenceRows.value.length, 0, '这一份里没一条命中')
    const second = startReferences('two', 'Two')
    finishReferences(second, SAMPLE)
    assert.equal(referencesSpeedSearch.value, '', '起新搜索 = 清串')
    assert.equal(referenceRows.value.length, 9, '清完立刻是整棵树')
    referencesSpeedSearch.value = 'zzz'
    closeReferences(second.id)
    assert.equal(referencesSpeedSearch.value, '', '关掉那条也清串')
  } finally {
    referencesSpeedSearch.value = ''
    resetReferences()
  }
})
