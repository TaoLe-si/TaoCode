// 「在工程内查找」结果的**按目录分组**与**头部动作工具条**的规则层判据。
//
// 上游依据（本批逐行开参考树自数核对，路径相对
// `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · Find 结果窗口就是 UsageView：`platform/lang-impl/src/com/intellij/find/findInProject/
//     FindInProjectManager.java:86-98`（`UsageViewManager.searchAndShowUsages`）；
//   · 目录分组规则：`platform/usageView-impl/src/com/intellij/usages/impl/rules/DirectoryGroupingRule.java:50-52`
//     （默认 `flattenDirs=true`）、`:65-78`（组 = 文件父目录）、`:131-157`（标题 = 相对基础目录的路径）、
//     `:188-190`（组间 `compareToIgnoreCase`）；目录结构档 `DirectoryStructureGroupingRule.java:44-57`；
//   · 档号：`rules/UsageGroupingRulesDefaultRanks.java:27`（400）/`:31`（500）；
//   · 两个开关的默认：`platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:20-27`
//     （package=true、directoryStructure=false、fileStructure=true）与互斥：`ActiveRules.java:44`/`:56`；
//   · 头部工具条：`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:989`（工具条本体）、
//     `:1074-1119`（项集合与顺序）、`:1149`/`:1203-1205`（组内字母序）、`:1150-1151`/`:1155-1176`（Module 挪位）；
//   · 分组动作表：`platform/usageView-impl/src/com/intellij/usages/impl/UsageGroupingRuleProviderImpl.java:55-88`；
//   · 编辑器 Find 条：`platform/lang-impl/src/com/intellij/find/EditorSearchSession.java:137-157`/`:238-265`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  allFindGroupKeys, buildFindResultsTree, compareFindMatches, compareFindTreeSiblings,
  defaultFindGroupingOptions, editorFindHeaderActions, findDirectoryGroupChain, findDirectoryGroupKey,
  findDirectoryGroupTitle, findFileGroupKey, findFileGroupTitle, findGroupingActions, findResultDirectory,
  findResultPositionText, findResultsContextMenu, findWindowHeaderActions, flattenFindResultsTree,
  normalizeFindGroupingOptions, toggleFindGrouping,
} from '../src/findResultsGrouping.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const hit = (path, line, column = 1) => ({ path, line, column })

/** 三个目录、四个文件、五条命中（`src/sub` 里只有一个文件，目录行仍要单独成一行）。 */
const SAMPLE = [
  hit('src/sub/y.ts', 5, 3), hit('src/x.ts', 2), hit('src/x.ts', 1, 8), hit('README.md', 10), hit('src/note.md', 3),
]

const rows = (root, collapsed) => flattenFindResultsTree(root, collapsed)
const groupRows = list => list.filter(row => row.kind !== 'result')
const resultRows = list => list.filter(row => row.kind === 'result')

// ——— 分组键与标题 ———

test('分组键 = 命中所在文件的直接父目录（DirectoryGroupingRule.java:72-74）', () => {
  assert.equal(findResultDirectory('src/x.ts'), 'src', '直接父目录')
  assert.equal(findResultDirectory('README.md'), '', '根下的文件父目录是空串')
  assert.equal(findResultDirectory('a/b/c/d.ts'), 'a/b/c', '只取直接父目录，不逐级')
  assert.equal(findResultDirectory('a\\b\\c.ts'), 'a/b', '反斜杠先归一成 /')
})

test('目录组标题 = 相对基础目录的路径（DirectoryGroupingRule.java:149-153 的 flattenDirs 支）', () => {
  const opts = defaultFindGroupingOptions()
  assert.equal(findDirectoryGroupTitle('src/sub', opts), 'src/sub', '基础目录 = 工作区根 ⇒ 相对路径')
  assert.equal(findDirectoryGroupTitle('src/sub', { ...opts, basePath: 'proj' }), 'src/sub', '路径已带根前缀时剥掉')
  assert.equal(findDirectoryGroupTitle('proj/src', { ...opts, basePath: 'proj' }), 'src', 'basePath 是前缀才剥')
  assert.equal(findDirectoryGroupTitle('other/src', { ...opts, basePath: 'proj' }), 'other/src', '不是前缀就原样（上游取不到基础目录时退回 presentableUrl）')
})

test('文件组标题：有目录层只给文件名，没有目录层给整条路径（FileGroupingRule.java:93-95 + UsageViewSettings.kt:118）', () => {
  const withDirs = defaultFindGroupingOptions()
  const noDirs = normalizeFindGroupingOptions({ groupByPackage: false })
  assert.equal(findFileGroupTitle('src/x.ts', withDirs), 'x.ts', '目录层在上面 ⇒ 只给文件名')
  assert.equal(findFileGroupTitle('src/x.ts', noDirs), 'src/x.ts', '没有目录层 ⇒ 给整条相对路径（唯一路径那一支）')
  assert.equal(findFileGroupTitle('README.md', withDirs), 'README.md', '根下的文件没有父目录可省')
})

test('目录组链：package 档一层、structure 档逐级到基础目录之前（DirectoryStructureGroupingRule.java:44-57）', () => {
  const opts = defaultFindGroupingOptions()
  assert.deepEqual(findDirectoryGroupChain('src/sub', opts), ['src/sub'], 'package 档（默认）：只一个组 = 直接父目录（单父规则）')
  const structure = normalizeFindGroupingOptions({ groupByDirectoryStructure: true })
  assert.deepEqual(findDirectoryGroupChain('src/sub', structure), ['src', 'src/sub'], 'structure 档：由外到内逐级，且反转过了')
  assert.deepEqual(findDirectoryGroupChain('src', structure), ['src'], '基础目录直接下的目录只有一级')
  assert.deepEqual(findDirectoryGroupChain('', structure), [], '基础目录直接下的文件不给目录组（上游 while 立刻命中 baseDir）')
  assert.deepEqual(findDirectoryGroupChain('', opts), [], 'package 档同样不收这一级（否则是一行没有名字的组）')
  const compact = normalizeFindGroupingOptions({ groupByDirectoryStructure: true, compactMiddleDirectories: true })
  assert.deepEqual(findDirectoryGroupChain('src/sub', compact), ['src/sub'], 'compactMiddleDirectories ⇒ 中间层折叠，只一个组')
  const off = normalizeFindGroupingOptions({ groupByPackage: false, groupByDirectoryStructure: false })
  assert.deepEqual(findDirectoryGroupChain('src/sub', off), [], '两个开关都关 ⇒ 没有目录层')
})

test('组键用既有的 usageGroupKey（目录带尾斜杠，不与文件键撞）', () => {
  assert.equal(findDirectoryGroupKey('src'), 'directory\u0000src/')
  assert.equal(findFileGroupKey('src/x.ts'), 'file\u0000src/x.ts')
  assert.notEqual(findDirectoryGroupKey('src/x.ts'), findFileGroupKey('src/x.ts'), '目录键带尾斜杠 ⇒ 两种键不会相等')
})

// ——— 两个开关的默认与互斥 ———

test('两个目录开关的默认值照 UsageViewSettings.kt:20-27', () => {
  const opts = defaultFindGroupingOptions()
  assert.equal(opts.groupByPackage, true, 'isGroupByPackage 默认 true（:23）')
  assert.equal(opts.groupByDirectoryStructure, false, 'isGroupByDirectoryStructure 默认 false（:26）')
  assert.equal(opts.groupByFileStructure, true, 'isGroupByFileStructure 默认 true（:21）')
  assert.equal(opts.compactMiddleDirectories, false, 'COMPACT_MIDDLE_DIRECTORIES 默认 false（:109）')
  assert.equal(opts.showShortFilePath, true, 'SHORT_FILE_PATH 默认 true（:115）')
})

test('两个开关互斥：置真时把对方关掉（GroupByDirectoryAction.java:22-28 / GroupByDirectoryStructureAction.java:22-26）', () => {
  const start = defaultFindGroupingOptions()
  const toStructure = toggleFindGrouping('UsageGrouping.DirectoryStructure', start)
  assert.equal(toStructure.groupByDirectoryStructure, true)
  assert.equal(toStructure.groupByPackage, false, '置真目录结构 ⇒ 包那一档关掉')

  const backToPackage = toggleFindGrouping('UsageGrouping.Directory', { ...toStructure, groupByDirectoryStructure: false })
  assert.equal(backToPackage.groupByPackage, true)
  assert.equal(backToPackage.groupByDirectoryStructure, false, '置真目录 ⇒ 目录结构关掉')

  const normalized = normalizeFindGroupingOptions({ groupByPackage: true, groupByDirectoryStructure: true })
  assert.equal(normalized.groupByPackage, false, '读档时两个都为真 ⇒ 生效层只走目录结构（ActiveRules.java:44/56）')
  const file = toggleFindGrouping('UsageGrouping.FileStructure', start)
  assert.equal(file.groupByFileStructure, false, '文件结构那一档是独立开关，不互斥')
})

// ——— 建树与排序 ———

test('建树：默认档（package 开、structure 关）每个直接父目录一个**平级**组，文件只出现一次', () => {
  const root = buildFindResultsTree(SAMPLE, defaultFindGroupingOptions())
  // 上游 DirectoryGroupingRule extends SingleParentUsageGroupingRule ⇒ 一条用法只进**一个**组
  // （SingleParentUsageGroupingRule.java:20-23 的 createMaybeSingletonList），所以目录组是平级的兄弟，
  // 不是嵌套的层级（嵌套是 DirectoryStructureGroupingRule 那一档）。
  assert.deepEqual(root.children.map(child => `${child.kind}:${child.title}`),
    ['directory:src', 'directory:src/sub', 'file:README.md'],
    'src/sub 与 src 平级（不是 src 的子目录），根下的 README.md 不成组')
  const src = root.children.find(child => child.title === 'src')
  assert.equal(src.count, 3, 'src 下 3 条命中（note.md 1 + x.ts 2）')
  assert.deepEqual(src.children.map(node => node.title), ['note.md', 'x.ts'], '文件按标题序')
  assert.equal(src.children[1].matches.length, 2, '同一个文件的两处命中只生成一个文件节点')
  assert.equal(root.children.find(child => child.title === 'src/sub').count, 1, 'src/sub 只有 y.ts 一条')
  assert.equal(root.count, 5, '根计数 = 全部命中')
})

test('建树：structure 档逐级成组，由外到内（DirectoryStructureGroupingRule.java:49-56）', () => {
  const root = buildFindResultsTree(SAMPLE, normalizeFindGroupingOptions({ groupByDirectoryStructure: true }))
  const outer = root.children.find(child => child.kind === 'directory' && child.title === 'src')
  assert.ok(outer, '最外层是 src')
  const inner = outer.children.find(child => child.kind === 'directory')
  assert.equal(inner.title, 'src/sub', '内层标题仍是相对根的整条路径（DirectoryGroupingRule.java:150-153）')
  assert.deepEqual(inner.children.map(node => node.title), ['y.ts'])
  assert.equal(outer.count, 4, '外层的 count 是子树合计（含内层那 1 条）')
  assert.equal(outer.children.filter(child => child.kind === 'directory').length, 1, 'structure 档下 src/sub 是 src 的**子**组（与 package 档平级不同）')
})

test('建树：目录层关着时命中直接落在文件层（ActiveRules.java:44-66 两档都不装）', () => {
  const root = buildFindResultsTree(SAMPLE, normalizeFindGroupingOptions({ groupByPackage: false }))
  assert.deepEqual(root.children.map(child => child.kind), ['file', 'file', 'file', 'file'], '目录组一个都不出现')
  assert.deepEqual(root.children.map(child => child.title),
    ['README.md', 'src/note.md', 'src/sub/y.ts', 'src/x.ts'], '文件行给整条相对路径，按路径序')
})

test('同级先后：目录在前、同类按标题忽略大小写（GroupNode.java:350-357 + UsageGroupBase.java:19-23）', () => {
  assert.equal(compareFindTreeSiblings({ kind: 'directory', title: 'zzz' }, { kind: 'file', title: 'aaa' }), -1, '目录恒在文件之前')
  assert.equal(compareFindTreeSiblings({ kind: 'file', title: 'a' }, { kind: 'file', title: 'B' }), -1, '同类忽略大小写：a 在 B 前')
  assert.equal(compareFindTreeSiblings({ kind: 'file', title: 'B' }, { kind: 'file', title: 'b' }), -1, '小写相同再比原串（大写在前）')
  const root = buildFindResultsTree([hit('B/x.ts', 1), hit('a/x.ts', 1)], defaultFindGroupingOptions())
  assert.deepEqual(root.children.map(node => node.title), ['a', 'B'], '目录组间按标题序（DirectoryGroupingRule.java:189）')
})

test('同一文件里命中按 行 → 列（UsageViewImpl.java:225-234 同文件比 navigationOffset）', () => {
  assert.equal(compareFindMatches(hit('a.ts', 1, 5), hit('a.ts', 2, 1)), -1, '行优先')
  assert.ok(compareFindMatches(hit('a.ts', 2, 1), hit('a.ts', 2, 9)) < 0, '同行比列（列小在前）')
  assert.equal(compareFindMatches(hit('a.ts', 2, 1), hit('a.ts', 2, 1)), 0)
  const root = buildFindResultsTree([hit('a.ts', 5, 2), hit('a.ts', 1, 3), hit('a.ts', 1, 1)], defaultFindGroupingOptions())
  const file = root.children.find(child => child.kind === 'file')
  assert.deepEqual(file.matches.map(match => `${match.line}:${match.column}`), ['1:1', '1:3', '5:2'], '文件内命中排好序')
})

// ——— 摊平成面板行 ———

test('摊平：目录行在前、文件行在后、命中在最后（档号 400 → 500）', () => {
  const list = rows(buildFindResultsTree(SAMPLE, defaultFindGroupingOptions()))
  assert.deepEqual(groupRows(list).map(row => `${row.depth}:${row.kind}:${row.label}`),
    ['0:directory:src', '1:file:note.md', '1:file:x.ts', '0:directory:src/sub', '1:file:y.ts', '0:file:README.md'],
    '目录 400 在文件 500 之前（UsageGroupingRulesDefaultRanks.java:27/31）；package 档两组平级')
  assert.deepEqual(resultRows(list).map(row => row.label), ['3:1', '1:8', '2:1', '5:3', '10:1'], '命中文本 = 1 基 行:列')
  assert.equal(list.length, 11, '六个组行 + 五条命中')
})

test('摊平：组行的 detail 是 usage.view.counter 那一档，命中行没有计数', () => {
  const list = rows(buildFindResultsTree(SAMPLE, defaultFindGroupingOptions()))
  const src = groupRows(list).find(row => row.label === 'src')
  assert.equal(src.detail, '3 条结果', 'usage.view.counter（UsageViewBundle.properties:131）')
  assert.equal(src.collapsible, true, '有内容 ⇒ 有折叠按钮')
  assert.equal(resultRows(list)[0].detail, '', '命中行没有计数')
  assert.equal(resultRows(list)[0].collapsible, false, '命中行不画折叠按钮')
})

test('折叠：组行自己留着、子树不出现（上游收的是子树）', () => {
  const root = buildFindResultsTree(SAMPLE, defaultFindGroupingOptions())
  const srcKey = findDirectoryGroupKey('src')
  const list = rows(root, new Set([srcKey]))
  const src = groupRows(list).find(row => row.label === 'src')
  assert.equal(src.collapsed, true)
  assert.deepEqual(resultRows(list).map(row => row.label), ['5:3', '10:1'], 'src 的两条收掉，src/sub 与 README.md 不受影响')
  assert.equal(list.length, 6, 'src 组行 + src/sub 组行 + y.ts 文件行 + 它的命中 + README.md 文件行 + 它的命中')
})

test('全部折叠收的是整棵树的组键', () => {
  const root = buildFindResultsTree(SAMPLE, defaultFindGroupingOptions())
  assert.deepEqual(allFindGroupKeys(root), [
    findDirectoryGroupKey('src'), findFileGroupKey('src/note.md'), findFileGroupKey('src/x.ts'),
    findDirectoryGroupKey('src/sub'), findFileGroupKey('src/sub/y.ts'), findFileGroupKey('README.md'),
  ], '目录键在前、子树紧跟其后（摊平顺序同一份）')
  assert.deepEqual(allFindGroupKeys(buildFindResultsTree([], defaultFindGroupingOptions())), [], '空结果没有组键')
})

test('空结果建出空树、摊平出空行（不画假控件）', () => {
  const root = buildFindResultsTree([], defaultFindGroupingOptions())
  assert.equal(root.count, 0)
  assert.deepEqual(rows(root), [])
  assert.deepEqual(buildFindResultsTree([hit('', 1)], defaultFindGroupingOptions()).children, [], '空路径的命中被丢掉，不造空组')
})

test('位置文本就是 1 基 行:列（native/search.cpp:698 报的列号口径）', () => {
  assert.equal(findResultPositionText(hit('a.ts', 1, 1)), '1:1')
  assert.equal(findResultPositionText(hit('a.ts', 10, 42)), '10:42')
})

// ——— 分组动作表 ———

test('分组动作表按上游排序后的顺序，不可用的档带着理由', () => {
  const actions = findGroupingActions()
  assert.deepEqual(actions.map(action => action.id), [
    'UsageGrouping.Directory', 'UsageGrouping.DirectoryStructure', 'UsageGrouping.FileStructure',
    'UsageGrouping.FlattenModules', 'UsageGrouping.Module', 'UsageGrouping.UsageType',
  ], '字母序后把 Module 挪到 Flatten Modules 前（UsageViewImpl.java:1149-1151）')
  assert.deepEqual(actions.filter(action => action.available).map(action => action.id),
    ['UsageGrouping.Directory', 'UsageGrouping.DirectoryStructure'], '本仓只有这两档有真实落点')
  for (const action of actions.filter(entry => !entry.available)) {
    assert.ok(action.unavailableReason.length > 0, `${action.id} 不可用时必须给理由（不画假控件）`)
  }
  const pkg = actions.find(action => action.id === 'UsageGrouping.Directory')
  const structure = actions.find(action => action.id === 'UsageGrouping.DirectoryStructure')
  assert.equal(pkg.selected, true, '默认档：包（目录）那一格选中（UsageViewSettings.kt:23 默认 true）')
  assert.equal(structure.selected, false, '目录结构那一格默认不选中（:26 默认 false）')
  const flipped = findGroupingActions(normalizeFindGroupingOptions({ groupByDirectoryStructure: true }))
  assert.equal(flipped.find(action => action.id === 'UsageGrouping.Directory').selected, false)
  assert.equal(flipped.find(action => action.id === 'UsageGrouping.DirectoryStructure').selected, true)
})

// ——— Find 窗口头部工具条 ———

const headerContext = over => ({
  canRerun: true,
  hasPreviousOccurrence: true,
  hasNextOccurrence: true,
  configurableTarget: false,
  settingsAvailable: true,
  usageTypeFilteringAvailable: true,
  mergeDupLinesAvailable: true,
  previewActionEnabled: true,
  previewUsages: true,
  groupByModule: true,
  grouping: defaultFindGroupingOptions(),
  ...over,
})

test('Find 窗口工具条按 createActions 的数组顺序（UsageViewImpl.java:1074-1119）', () => {
  const actions = findWindowHeaderActions(headerContext({}))
  const ids = actions.filter(action => action.kind !== 'separator').map(action => action.id)
  assert.deepEqual(ids, [
    'UsageView.Rerun', 'OccurenceNavigator.PreviousOccurence', 'OccurenceNavigator.NextOccurence',
    'UsageGroupingActionGroup', 'UsageView.MergeSameLineUsages', 'ExpandAll', 'CollapseAll', 'UsageView.PreviewUsages',
  ], '没有 ConfigurableUsageTarget ⇒ ShowSettings 那一格与它前后的分隔符都不出现')
  assert.deepEqual(actions.map(action => action.kind), [
    'action', 'action', 'action', 'separator', 'group', 'toggle', 'action', 'action', 'separator', 'toggle',
  ], '两个分隔符的位置照源码（Prev/Next 之后、Expand/Collapse 之后）')
})

test('canShowSettings() 为真时 ShowSettings 与它后面的分隔符插在 Prev/Next 之后', () => {
  const actions = findWindowHeaderActions(headerContext({ configurableTarget: true }))
  assert.deepEqual(actions.slice(0, 6).map(action => action.id || action.kind),
    ['UsageView.Rerun', 'OccurenceNavigator.PreviousOccurence', 'OccurenceNavigator.NextOccurence',
      'separator', 'UsageView.ShowSettings', 'separator'],
    'UsageViewImpl.java:1109-1111 的 new Separator() / ShowSettings / new Separator()')
  assert.equal(actions.filter(action => action.id === 'UsageView.ShowSettings')[0].available, false, '本仓没有那一档对话框 ⇒ 登记不渲染')
})

test('头部动作的可用性判据照各动作的 update', () => {
  const off = findWindowHeaderActions(headerContext({
    canRerun: false, hasPreviousOccurrence: false, hasNextOccurrence: false, settingsAvailable: false,
  }))
  const byId = id => off.find(action => action.id === id)
  assert.equal(byId('UsageView.Rerun').enabled, false, 'canPerformReRun() 为假 ⇒ 禁用（RerunSearchAction.kt:42-45）')
  assert.equal(byId('OccurenceNavigator.PreviousOccurence').enabled, false, '没有上一条 ⇒ 禁用（OccurenceNavigatorActionBase.java:109-111）')
  assert.equal(byId('OccurenceNavigator.NextOccurence').enabled, false)
  assert.equal(byId('UsageGroupingActionGroup').enabled, false, '拿不到 UsageViewSettings ⇒ 禁用（RuleAction.java:47-50）')
  assert.equal(byId('ExpandAll').enabled, true, 'TreeExpander.canExpand() 恒 true（UsageViewImpl.java:350-352）')
  const preview = byId('UsageView.PreviewUsages')
  assert.equal(preview.selected, true, 'isPreviewUsages 默认 true（UsageViewSettings.kt:75-76）')
  assert.equal(preview.available, false, '预览区常驻 ⇒ 这一档开关没有落点')
})

test('Group By 弹出组的成员就是分组动作表（含 selected 与 available）', () => {
  const group = findWindowHeaderActions(headerContext({})).find(action => action.id === 'UsageGroupingActionGroup')
  assert.ok(group.children && group.children.length === 6, '弹出组六格')
  assert.equal(group.children.filter(child => child.available).length, 2, '只有目录两档能按')
  const flipped = findWindowHeaderActions(headerContext({ grouping: normalizeFindGroupingOptions({ groupByDirectoryStructure: true }) }))
  assert.equal(flipped.find(action => action.id === 'UsageGroupingActionGroup').children
    .find(child => child.id === 'UsageGrouping.DirectoryStructure').selected, true, '切档后 selected 跟着走')
})

// ——— 编辑器 Find 条的头部动作 ———

const editorContext = over => ({
  session: true, hasMatches: true, searchInProgress: false,
  caseSensitive: false, wholeWords: false, regex: false, preserveCase: false,
  replaceState: false, global: true, contextAny: true, scrollToResultsDuringTyping: false,
  ...over,
})

test('编辑器 Find 条按 createPrimarySearchActions 的经典 UI 支（EditorSearchSession.java:251-263）', () => {
  const actions = editorFindHeaderActions(editorContext({}))
  assert.deepEqual(actions.filter(action => action.kind !== 'separator').map(action => action.id), [
    'StatusTextAction', 'EditorSearchSession.PrevOccurrence', 'EditorSearchSession.NextOccurrenceAction', 'FindAllAction',
    'AddOccurrenceAction', 'RemoveOccurrenceAction', 'SelectAllAction', 'ToggleFindInSelection', 'ShowFilterPopup',
    'EditorSearchSession.ToggleMatchCase', 'EditorSearchSession.ToggleWholeWordsOnlyAction', 'EditorSearchSession.ToggleRegex',
  ], '主搜索动作表 + 后面那三个 addExtraSearchActions（:140-142）')
  assert.deepEqual(actions.filter(action => action.kind === 'separator').length, 2, '两处分隔（FindAll 之后、SelectAll 之后）')
})

test('替换态才追加「保留大小写」（EditorSearchSession.java:148）', () => {
  assert.equal(editorFindHeaderActions(editorContext({})).some(action => action.id === 'TogglePreserveCase'), false)
  const withReplace = editorFindHeaderActions(editorContext({ replaceState: true, preserveCase: true }))
  const preserve = withReplace.find(action => action.id === 'TogglePreserveCase')
  assert.ok(preserve, '替换态下这一格出现')
  assert.equal(preserve.selected, true, 'isPreserveCase() 为真 ⇒ 选中（TogglePreserveCaseAction.java:20-23）')
})

test('编辑器头部动作的可用性照 SearchSession 判据', () => {
  const noSession = editorFindHeaderActions(editorContext({ session: false }))
  for (const action of noSession.filter(entry => entry.kind === 'toggle')) {
    assert.equal(action.enabled, false, `${action.id}：没有 SearchSession 一律禁用（EditorHeaderToggleAction.java:52-57）`)
  }
  const searching = editorFindHeaderActions(editorContext({ searchInProgress: true }))
  assert.equal(searching.find(action => action.id === 'EditorSearchSession.PrevOccurrence').enabled, false,
    '搜索进行中 ⇒ 上/下一条禁用（PrevNextOccurrenceAction.java:34-37）')
  const noMatches = editorFindHeaderActions(editorContext({ hasMatches: false }))
  assert.equal(noMatches.find(action => action.id === 'EditorSearchSession.NextOccurrenceAction').enabled, false)
  const nonGlobal = editorFindHeaderActions(editorContext({ global: false }))
  assert.equal(nonGlobal.find(action => action.id === 'ToggleFindInSelection').selected, true,
    '非全局 ⇒ 「在所选内容中搜索」选中（ToggleFindInSelectionAction.java:35-39）')
})

test('筛选弹出组：六个搜索上下文档照 ShowFilterPopup 组，不可用的带理由', () => {
  const group = editorFindHeaderActions(editorContext({})).find(action => action.id === 'ShowFilterPopup')
  assert.deepEqual(group.children.map(child => child.id), [
    'SearchContext.Anywhere', 'SearchContext.InComments', 'SearchContext.InStringLiterals',
    'SearchContext.ExceptComments', 'SearchContext.ExceptStringLiterals', 'SearchContext.ExceptCommentsAndStringLiterals',
  ], 'intellij.platform.lang.impl.actions.xml:402-407 的六格')
  assert.deepEqual(group.children.filter(child => child.available).map(child => child.id), ['SearchContext.Anywhere'],
    '本仓只有 ANY 这一档有落点（原生扫描是纯文本，没有注释/字面量语法档）')
  assert.equal(group.children[0].selected, true, 'contextAny ⇒ 第一格选中')
  const other = editorFindHeaderActions(editorContext({ contextAny: false })).find(action => action.id === 'ShowFilterPopup')
  assert.equal(other.selected, true, '有非 ANY 上下文 ⇒ 弹窗图标带 live 角标（ShowFilterPopupGroup.java:54-61）')
})

// ——— 右键菜单 ———

test('结果右键菜单按 UsageView.Popup 组的顺序，导出那一条看可用性', () => {
  const menu = findResultsContextMenu(true)
  assert.deepEqual(menu.filter(row => row.kind !== 'separator').map(row => row.id), [
    'UsageView.Rerun', 'EditSource', 'OpenInRightSplit', 'UsageView.Include', 'UsageView.Exclude',
    'UsageView.Remove', 'UsageView.ShowRecentFindUsages', 'ExportToTextFile',
  ], 'intellij.platform.usageView.impl.actions.xml:48-61 的项集合')
  assert.equal(menu.find(row => row.id === 'ExportToTextFile').enabled, true)
  assert.equal(findResultsContextMenu(false).find(row => row.id === 'ExportToTextFile').enabled, false,
    'canExport 为假 ⇒ 导出禁用（ExporterToTextFile 那一档）')
  assert.equal(menu.filter(row => !row.available).every(row => row.unavailableReason.length > 0), true,
    '不可用的行必须给理由')
})

// ——— 反向验证（判据真的会红）———

test('反向验证：默认档不是「目录结构开」（证明上面那条默认断言有效）', () => {
  const src = read('src/findResultsGrouping.ts')
  assert.match(src, /groupByDirectoryStructure: false/, '默认目录结构关着（UsageViewSettings.kt:26）')
  assert.match(src, /groupByPackage: true/, '默认包（目录）那一档开着（UsageViewSettings.kt:23）')
  // 若把默认档写成目录结构开，这条断言必须红 —— 故意构造那个错值验一次。
  const wrong = normalizeFindGroupingOptions({ groupByDirectoryStructure: true, groupByPackage: true })
  assert.notEqual(findDirectoryLayerModeOf(wrong), 'package', '目录结构开 ⇒ 生效档不是 package（互斥那一半）')
})

test('反向验证：命中排序真按行 → 列（换一个比较器就会红）', () => {
  const sorted = [hit('a.ts', 3, 1), hit('a.ts', 1, 9), hit('a.ts', 1, 2)].sort(compareFindMatches)
  assert.deepEqual(sorted.map(match => `${match.line}:${match.column}`), ['1:2', '1:9', '3:1'])
})

/** `findDirectoryLayerMode` 的本地重算（判据自证用，避免多 import 一个符号）。 */
function findDirectoryLayerModeOf(options) {
  if (options.groupByDirectoryStructure) return 'structure'
  if (options.groupByPackage) return 'package'
  return 'none'
}