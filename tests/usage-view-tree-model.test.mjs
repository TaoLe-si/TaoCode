// 用法树**行模型**（`src/usageViewTreeModel.ts`）的四条规则：
//   ① 分组顺序与同级排序 ② 行 id 稳定 ③ 展开态沿用的纯函数形状 ④ 每层计数。
//
// 上游依据（本轮逐行开参考树自数核对，全表见 `docs/batch-2026-10-06-refview3.md` §1）：
//   · 种类先、呈现文本后：platform/usageView-impl/src/com/intellij/usages/impl/GroupNode.java:328-339
//     （`NodeComparator`：`:318` 的 `ClassIndex {UNKNOWN, USAGE_TARGET, GROUP, USAGE}` 先比 ordinal）
//     + 同目录 rules/UsageGroupBase.java:19-23（先 `myOrder` 再 `compareToIgnoreCase`）；
//   · 叶子次序：platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:225-234
//     （同文件比 `getNavigationOffset()`）经 UsageNode.java:27-30 接进同一个比较器；
//   · 排序落在**插入那一趟**、命中已有节点就复用：GroupNode.java:99-114、:264-288
//     与 UsageViewImpl.java:767-769（`swingChildren.sort(NODE_COMPARATOR)`）；
//   · 展开态沿用：UsageViewImpl.java:1271-1288（只抓"当前展开的路径"下的用法）、
//     :1291-1302（根下那一层的组一律展开）、:1313-1319（`expandTreeAfterReset() = expandTree(2)`）、
//     :2427-2441（按 `myUsageNodes.get(usage)` 在新树里查到那条、贴回它父组的展开态）；
//   · 每层计数：GroupNode.java:290-299（`incrementUsageCount` 从叶子所在的组一路往上加到根）
//     + UsageViewImpl.java:742/:772（扣与加）+ UsageViewTreeCellRenderer.java:95-98（屏上读递归合计）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUsageTree, flattenUsageTree, usageGroupKey, usageRowsForQuery,
} from '../src/usageViewGrouping.ts'
import {
  USAGE_TREE_LEVELS, carryUsageTreeExpansion, compareUsageLocations,
  compareUsageTreePaths, compareUsageTreeSiblings, sortUsageTreeSiblings, usageTreeDuplicateModelRowIds,
  usageTreeKindRank, usageTreeLevelCounts, usageTreeLevelOf, usageTreeLevelOfRow,
  usageTreeRowIds, usageTreeRows, usageTreeRowsReport, usageTreeToggleLabel,
} from '../src/usageViewTreeModel.ts'
import {
  finishReferences, provideUsageSymbols, referenceRows, referencesGroupByDirectory, referencesSpeedSearch,
  resetReferences, startReferences, toggleUsageGroup,
} from '../src/referenceContents.ts'

const at = (path, line, character = 0) => ({ path, line, character })

/** 手工造一行（模型的输入就是"已经摊平的那一列行"，这里不借建树那条路，好单独测 id/折叠那两族规则）。 */
const groupRow = (key, kind, label, depth, extra = {}) => ({
  key, kind, depth, label, detail: '', path: label, count: 0, line: -1, character: -1,
  collapsible: true, collapsed: false, toggleLabel: usageTreeToggleLabel(false, label), ...extra,
})
const leafRow = (key, path, line, depth, character = 0) => ({
  key, kind: 'usage', depth, label: `${line + 1}:1`, detail: '', path, count: 0,
  line, character, collapsible: false, collapsed: false, toggleLabel: '',
})

// ——— ① 分组顺序与同级排序 ———

test('① 同级先比种类（目录 < 文件 < 类 < 方法 < 用法），再忽略大小写比文本', () => {
  assert.deepEqual(USAGE_TREE_LEVELS, ['group', 'file', 'member', 'usage'], '四个层的先后')
  assert.ok(usageTreeKindRank('directory') < usageTreeKindRank('file'), '目录在文件之前（上游 400 在 500 前）')
  assert.ok(usageTreeKindRank('class') < usageTreeKindRank('method'), '类在方法之前（JavaPlugin.xml:566-567 的注册序）')
  assert.equal(usageTreeKindRank('no-such-kind-here'), USAGE_TREE_LEVELS.length, '认不出的种类排到最后，不抛错')
  assert.deepEqual(
    sortUsageTreeSiblings([
      { kind: 'method', name: 'zeta' }, { kind: 'file', name: 'a.ts' },
      { kind: 'class', name: 'Beta' }, { kind: 'directory', name: 'src/' },
    ]).map(node => node.kind),
    ['directory', 'file', 'class', 'method'],
    '种类档号先决定（文本再大也不许越档）')
  assert.ok(compareUsageTreeSiblings({ kind: 'file', name: 'alpha.ts' }, { kind: 'file', name: 'Zeta.ts' }) < 0,
    '同级忽略大小写：alpha 在 Zeta 之前（UsageGroupBase.java:23 的 compareToIgnoreCase）')
  assert.equal(usageTreeLevelOf('class'), 'member', '类与方法同属成员层（上游四档都是 GROUP 那一种节点）')
  assert.equal(usageTreeLevelOfRow(leafRow('usage', 'src/a.ts', 1, 1)), 'usage')
})

test('① 只差大小写的两个名字也有确定先后（比完小写再比原串）', () => {
  assert.ok(compareUsageTreeSiblings({ kind: 'class', name: 'Foo' }, { kind: 'class', name: 'foo' }) < 0,
    '小写相等 ⇒ 比原串：F(70) 在 f(102) 之前')
  assert.equal(compareUsageTreeSiblings({ kind: 'class', name: 'Foo' }, { kind: 'class', name: 'Foo' }), 0,
    '同一个名字给 0，不许出现"自己大于自己"')
  assert.equal(compareUsageTreePaths('README.md', 'readme.md') < 0, true, '路径同一条规则')
})

test('① 叶子次序 = 行 → 列（上游同一文件比 navigationOffset）', () => {
  assert.ok(compareUsageLocations(at('a', 3), at('a', 5)) < 0, '行小的在前')
  assert.ok(compareUsageLocations(at('a', 3, 9), at('a', 3, 1)) > 0, '同一行比列')
  assert.equal(compareUsageLocations(at('a', 3, 0), at('a', 3)), 0, 'character 缺省 = 0')
})

test('① 到达顺序换了行序不许换：建树那一趟排完，模型不再排第二次', () => {
  const sample = [at('src/sub/y.ts', 4, 2), at('src/x.ts', 1), at('src/x.ts', 0, 7), at('README.md', 9), at('src/note.md', 2)]
  const reversed = [...sample].reverse()
  const rowsOf = list => flattenUsageTree(buildUsageTree(list, '工作区'), { showDirectories: true })
  assert.deepEqual(rowsOf(reversed).map(row => row.key), rowsOf(sample).map(row => row.key),
    '同一批用法倒着进来，行序列一字不差（排序只认比较器，不认到达顺序）')
})

// ——— ② 行 id 稳定 ———

test('② id 不含下标：同一行重排之后还是同一个 id，且整列 id 与行序无关', () => {
  const rows = [groupRow('file\u0000a.ts', 'file', 'a.ts', 0), leafRow('usage\u0000a.ts\u00001:1', 'a.ts', 0, 1),
    groupRow('file\u0000b.ts', 'file', 'b.ts', 0), leafRow('usage\u0000b.ts\u00002:1', 'b.ts', 1, 1)]
  const forward = usageTreeRowIds(rows)
  const backward = usageTreeRowIds([...rows].reverse())
  assert.deepEqual(backward, [...forward].reverse(), '每行的 id 只由内容决定（reverse 之后各自还是那一个）')
  assert.ok(!forward.some(id => /\d+$/.test(id.slice(-1)) && !id.includes(':')), '键里没有序号位')
  const assembled = usageTreeRows(rows)
  assert.deepEqual(usageTreeDuplicateModelRowIds(assembled), [], '这一列行没有撞 id')
  assert.deepEqual(assembled.map(row => row.level), ['file', 'usage', 'file', 'usage'])
})

test('② 内容完全相同的两行也各有各的 id（上游那一格是 identityHashCode）', () => {
  const twin = leafRow('usage\u0000a.ts\u00007:1', 'a.ts', 6, 1)
  const rows = [groupRow('file\u0000a.ts', 'file', 'a.ts', 0), twin, { ...twin }]
  const ids = usageTreeRowIds(rows)
  assert.equal(new Set(ids).size, 3, `三条 id 必须互不相同，实得 ${JSON.stringify(ids)}`)
  assert.equal(ids[1], twin.key, '第一次出现 = 键本身')
  assert.ok(ids[2].startsWith(`${twin.key}\u0000#`), '第二次起追加 occurrence 后缀')
  assert.deepEqual(usageTreeDuplicateModelRowIds(usageTreeRows(rows)), [], '装配后仍然没有撞 id')
})

test('② 报错重跑（半批结果 + 全量结果）之后，同一行的 id 不变', () => {
  const full = [at('src/x.ts', 1), at('src/x.ts', 4), at('README.md', 0)]
  const partial = [at('src/x.ts', 4)]
  const idsOf = list => {
    const rows = usageTreeRows(usageRowsForQuery(buildUsageTree(list, '工作区'), '', {}))
    return new Map(rows.map(row => [row.key, row.id]))
  }
  const before = idsOf(partial)
  const after = idsOf(full)
  assert.equal(after.get([...before.keys()][0]), before.get([...before.keys()][0]),
    '补结果之后原来那一行的 id 一字不变（键与 id 都是内容派生）')
  assert.equal(after.size, 5, '全量那一趟：两个组 + 三条位置')
})

// ——— ③ 展开态沿用 ———

test('③ 上一屏收起、这一屏还在 ⇒ 沿用；消失的 ⇒ 进 dropped（capture 只认还看得见的）', () => {
  const file = groupRow('file\u0000a.ts', 'file', 'a.ts', 0, { collapsed: true, toggleLabel: '展开 a.ts' })
  const gone = groupRow('file\u0000z.ts', 'file', 'z.ts', 0, { collapsed: true, toggleLabel: '展开 z.ts' })
  const previous = [file, gone, leafRow('usage\u0000a.ts\u00001:1', 'a.ts', 0, 1)]
  const next = [file, leafRow('usage\u0000b.ts\u00003:1', 'b.ts', 2, 1)]
  const carry = carryUsageTreeExpansion(previous, next)
  assert.deepEqual(carry.collapsedIds, [file.key], '还在的那一条沿用收起')
  assert.deepEqual(carry.carriedIds, [file.key])
  assert.deepEqual(carry.droppedIds, [gone.key], '这一屏没有的那条不再进账')
  assert.deepEqual(carry.expandedIds, [], '这一屏的组只有那一条，且它是收起的')
})

test('③ 新出现的组按 expandLevels 给默认档：上游 expandTree(2) vs 本仓既有档（全展开）', () => {
  const shallow = groupRow('file\u0000a.ts', 'file', 'a.ts', 0)
  const deep = groupRow('class\u0000a.ts#Foo', 'class', 'Foo', 2)
  const next = [shallow, deep]
  const upstream = carryUsageTreeExpansion([], next, { expandLevels: 2 })
  assert.deepEqual(upstream.collapsedIds, [deep.key], '两层以外新出现的组收起（UsageViewImpl.java:1317-1319）')
  assert.deepEqual(upstream.expandedIds, [shallow.key], '根下那一层一律展开（:1291-1302 那句 always expand）')
  const repo = carryUsageTreeExpansion([], next)
  assert.deepEqual(repo.collapsedIds, [], '本仓既有档 = 重建后全展开（tests/usage-view-panel-rows.test.mjs:51 钉着）')
  assert.deepEqual(repo.expandedIds, [shallow.key, deep.key])
})

test('③ 收不住东西的组不许留在折叠集里（没有箭头按钮的"已收起"是假状态）', () => {
  const shell = groupRow('file\u0000empty.ts', 'file', 'empty.ts', 0, { collapsible: false, collapsed: true, toggleLabel: '展开 empty.ts' })
  const previous = [shell]
  const carry = carryUsageTreeExpansion(previous, previous)
  assert.deepEqual(carry.collapsedIds, [], '折叠集里没有它')
  const [row] = usageTreeRows(previous)
  assert.equal(row.collapsed, false, '装配后这一行的折叠态被就地纠正')
  assert.equal(row.toggleLabel, '', '提示语也撤了（不是新文案，是本来就不该挂着的旧的那串）')
})

test('③ 装配后的折叠态与提示语一致；被纠正之外的那一行一字不动', () => {
  const collapsedFile = groupRow('file\u0000a.ts', 'file', 'a.ts', 0, { collapsed: true, toggleLabel: '展开 a.ts' })
  const openFile = groupRow('file\u0000b.ts', 'file', 'b.ts', 0)
  const rows = usageTreeRows([collapsedFile, openFile, leafRow('usage\u0000b.ts\u00001:1', 'b.ts', 0, 1)])
  assert.deepEqual(rows.map(row => `${row.id}:${row.collapsed}:${row.toggleLabel}`), [
    `${collapsedFile.key}:true:展开 a.ts`, `${openFile.key}:false:收起 b.ts`,
    'usage\u0000b.ts\u00001:1:false:',
  ], '组行沿用原状（提示语与实际折叠态同一份），叶子不动')
  assert.equal(rows[1].collapsed, false)
  assert.equal(usageTreeToggleLabel(true, 'X'), '展开 X')
  assert.equal(usageTreeToggleLabel(false, 'X'), '收起 X')
})

// ——— ④ 每层计数 ———

test('④ 每层的账：行数 + 直接挂着的用法 + 各节点子树合计（两格各有上游出处）', () => {
  const root = buildUsageTree([at('src/x.ts', 1), at('src/x.ts', 4), at('README.md', 0)], '工作区')
  const rows = flattenUsageTree(root, { showDirectories: true })
  const levels = usageTreeLevelCounts(rows)
  assert.deepEqual(levels.map(entry => entry.level), ['group', 'file', 'usage'], '这一棵只有三层（没有成员层）')
  const [group, file, usage] = levels
  assert.deepEqual([group.rows, group.usages, group.subtreeUsages], [1, 0, 2],
    '目录行自己没直接挂用法；子树合计 = 2（README.md 不在它下面）')
  assert.deepEqual([file.rows, file.usages, file.subtreeUsages], [2, 3, 3],
    '直接挂在文件层的用法 = 全部 3 条（getUsageNodes 那一格）')
  assert.deepEqual([usage.rows, usage.usages, usage.subtreeUsages], [3, 3, 3])
  const groupLevels = levels.filter(entry => entry.level !== 'usage')
  assert.equal(groupLevels.reduce((sum, entry) => sum + entry.usages, 0), usage.rows,
    '每条用法只有**一个**父行 ⇒ 各层"直接挂着"的那一格合起来正好等于用法条数，不重不漏')
})

test('④ 成员层出现时四层一起有账；子树合计那一格允许父子层重叠（屏上读的就是它）', () => {
  const symbols = [
    { name: 'Foo', kind: 5, startLine: 0, endLine: 20 },
    { name: 'bar', kind: 6, startLine: 5, endLine: 9, detail: '(n: number)' },
  ]
  const root = buildUsageTree([at('src/x.ts', 6, 2), at('src/x.ts', 1)], '工作区', {
    symbolProvider: path => (path === 'src/x.ts' ? symbols : []),
  })
  const rows = flattenUsageTree(root, { showDirectories: true })
  const levels = usageTreeLevelCounts(rows)
  assert.deepEqual(levels.map(entry => entry.level), ['group', 'file', 'member', 'usage'], '四个层都在账上')
  const byLevel = new Map(levels.map(entry => [entry.level, entry]))
  assert.deepEqual([byLevel.get('member').rows, byLevel.get('member').usages], [2, 2],
    '一个类 + 一个方法 = 成员层两行，两条用法都直接挂在成员层')
  assert.equal(byLevel.get('member').subtreeUsages, 3,
    'Foo 的子树里 2 条 + bar 的子树里 1 条 = 3 > 总条数 2 ⇒ 这一格是屏上/导出的递归合计，**不是**划分')
  assert.equal(byLevel.get('usage').rows, 2)
  const groupLevels = levels.filter(entry => entry.level !== 'usage')
  assert.equal(groupLevels.reduce((sum, entry) => sum + entry.usages, 0), 2, '划分那一格仍然不重不漏')
})

// ——— 生产链路（真有消费方：`referenceRows` 就是面板渲染的那一列）———

test('生产消费方：referenceRows 的每一行带着稳定 id 与层，折叠一个组之后提示语跟着改', () => {
  resetReferences()
  provideUsageSymbols(() => [])
  try {
    const search = startReferences('delta', 'D#delta')
    finishReferences(search, [at('src/x.ts', 1), at('src/x.ts', 4), at('README.md', 0), at('src/x.ts', 4)])
    const rows = referenceRows.value
    assert.ok(rows.length > 0, '面板有行')
    const ids = rows.map(row => row.id)
    assert.equal(new Set(ids).size, ids.length, `面板里不许两行同一个 id：${JSON.stringify(ids)}`)
    assert.ok(rows.every(row => row.level === usageTreeLevelOfRow(row)), '每行都带层（④的输入）')
    const fileKey = usageGroupKey('file', 'src/x.ts')
    toggleUsageGroup(fileKey)
    const collapsed = referenceRows.value.find(row => row.key === fileKey)
    assert.equal(collapsed.collapsed, true)
    assert.equal(collapsed.toggleLabel, `展开 ${collapsed.label}`, '折叠态与提示语同源（③）')
    const visible = referenceRows.value.filter(row => row.kind === 'usage' && row.path === 'src/x.ts')
    assert.deepEqual(visible.map(row => row.id), [], '收起之后子树不出现')
    // 重复位置那一格：src/x.ts:4 进来两次 ⇒ 两行、两个 id
    const twins = usageTreeRowsReport(flattenUsageTree(buildUsageTree(
      [at('src/x.ts', 4), at('src/x.ts', 4)], '工作区')))
    assert.deepEqual(twins.duplicateIds, [], '同一份内容出现两遍也不撞 id')
    assert.equal(twins.rows.length, 3, '一个文件组 + 两行位置')
  } finally {
    referencesSpeedSearch.value = ''
    referencesGroupByDirectory.value = false
    provideUsageSymbols(null)
    resetReferences()
  }
})
