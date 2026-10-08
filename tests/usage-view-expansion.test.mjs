// 用法树的**行模型本体**（任务 #219 / `docs/wiring-requests-2026-10-06-usage3.md` 的 W-3 模块侧）：
// 一条用法 → 分组节点 / 文件节点 / 成员节点 / 用法节点，外加这一棵树的**同级计数**与**展开态沿用**。
//
// 上游依据（本批逐行开参考树自数核对，坐标全在
// `D:\Backup\Downloads\intellij-community-master\intellij-community-master`，
// 账目见 `docs/batch-2026-10-06-refview2.md` §1）：
//   · 节点种类与同级先后：`platform/usageView-impl/src/com/intellij/usages/impl/GroupNode.java:317-348`
//     （`NodeComparator`：`ClassIndex {UNKNOWN, USAGE_TARGET, GROUP, USAGE}` 在 `:318`）；
//   · 递归计数的算法：同文件 `:290-299`（`incrementUsageCount` 从自己一路往上加到根）、
//     读的一处 `:363-366`（`getRecursiveUsageCount`）、直接挂在本节点的那一份 `:409-417`（`getUsageNodes()`）、
//     直接子组那一份 `:399-407`（`getSubGroups()`）⇒ `递归合计 = 直接 + 各子组`这一条账；
//   · 展开态存哪儿（两处分开）：逐节点的态只在运行时、重建时靠
//     `impl/UsageViewImpl.java:1270-1288`（`captureUsagesExpandState`，`:1272` 只往"当前展开的"路径里钻）
//     与 `:1291-1307`（`restoreUsageExpandState`，`:1293` 那句 `//always expand the last level group`）沿用；
//     落盘的只有 `platform/usageView/src/com/intellij/usages/UsageViewSettings.kt:63-64` 的 `IS_EXPANDED`
//     （`usageView.xml`，默认 false），写它的只有那两个整体动作
//     （`UsageViewImpl.java:344-347` 置 true、`:353-358` 置 false），读它的一处是 `:1875-1877`；
//   · 导出：`impl/ExporterToTextFile.java:24-29` 导的是 **model**（与展开态无关），组行的计数取
//     `getRecursiveUsageCount()`（同文件 `:61-62`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allUsageGroupKeys, buildUsageTree, carryUsageExpansion, flattenUsageTree, usageGroupKey, usageLevelCounts,
} from '../src/usageViewGrouping.ts'
import {
  closeReferences, collapseAllUsageGroups, expandAllUsageGroups, finishReferences, provideUsageSymbols,
  referenceRows, referencesExpandedAll, referencesInNewTab, resetReferences, selectReferences,
  startReferences, toggleUsageGroup,
} from '../src/referenceContents.ts'

const at = (path, line, character = 0) => ({ path, line, character })

/** 三个目录、四个文件、五条引用（与 `usage-view-panel-rows.test.mjs` 同一份样本，别另造形状）。 */
const SAMPLE = [at('src/sub/y.ts', 4, 2), at('src/x.ts', 1), at('src/x.ts', 0, 7), at('README.md', 9), at('src/note.md', 2)]

const SYMBOLS_X = [
  {
    name: 'Foo', kind: 5, startLine: 0, endLine: 20, startChar: 0, endChar: 1,
    children: [{ name: 'bar', kind: 6, startLine: 3, endLine: 8, startChar: 2, endChar: 3, detail: '(n: number)' }],
  },
  { name: 'main', kind: 12, startLine: 25, endLine: 30, startChar: 0, endChar: 1 },
]
const MEMBER_SAMPLE = [at('src/x.ts', 5, 2), at('src/x.ts', 12), at('src/x.ts', 27), at('src/y.ts', 1), at('src/y.ts', 3)]
const withSymbols = symbols => ({ symbolProvider: path => (path === 'src/x.ts' ? symbols : []) })

const groupRows = rows => rows.filter(row => row.kind !== 'usage')
const leafRows = rows => rows.filter(row => row.kind === 'usage')

// ——— 同级计数（`usageLevelCounts` 那张对账表）———

test('同级计数：每个组行的 递归合计 = 直接挂的 + 各子组的，同级互不重叠', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const table = usageLevelCounts(root)
  for (const entry of table) {
    assert.equal(entry.ownCount + entry.childCount, entry.count, `${entry.key} 的三格账要闭合`)
  }
  // 根下那一层（默认档：目录那一层不出现）各文件的子树合计相加正好等于整棵树
  const topLevel = table.filter(entry => entry.parentKey === '')
  assert.deepEqual(topLevel.map(entry => `${entry.key}|${entry.count}`), [
    `${usageGroupKey('file', 'src/x.ts')}|3`, `${usageGroupKey('file', 'src/y.ts')}|2`,
  ], '同级两行就是根下的那两份，谁也没重复数谁的')
  assert.equal(topLevel.reduce((sum, entry) => sum + entry.count, 0), root.count, '同级合计 == 根的子树合计')
})

test('同级计数：`ownCount` 数的就是直接挂在本节点上的那些位置（成员层里类与方法各一份）', () => {
  const root = buildUsageTree(MEMBER_SAMPLE, '工作区', withSymbols(SYMBOLS_X))
  const byKey = new Map(usageLevelCounts(root).map(entry => [entry.key, entry]))
  const classEntry = byKey.get(usageGroupKey('class', 'src/x.ts#Foo'))
  assert.ok(classEntry, '类组要有账')
  assert.equal(classEntry.ownCount, 1, '类体里那一条直接挂在类组上（上游 getUsageNodes()，GroupNode.java:409-417）')
  assert.equal(classEntry.childCount, 1, '方法子树那一条算在 childCount 里')
  assert.equal(classEntry.count, 2, '递归合计 = 直接 + 子组（屏上 `2 条结果` 那一份）')
  const methodEntry = byKey.get(usageGroupKey('method', 'src/x.ts#Foo#bar(n: number)'))
  assert.equal(methodEntry.ownCount, 1)
  assert.equal(methodEntry.childCount, 0, '方法下面没有子组了')
  assert.equal(classEntry.parentKey, usageGroupKey('file', 'src/x.ts'), '父键按可见层的那一列行走（根不可见 ⇒ 文件行是根下那一层）')
})

test('同级计数的表与屏上的行同一份遍历（键、顺序、层都不得各数一遍）', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  const rows = flattenUsageTree(root, { showDirectories: true })
  const table = usageLevelCounts(root, { showDirectories: true })
  assert.deepEqual(table.map(entry => entry.key), groupRows(rows).map(row => row.key), '同一批键、同一个顺序')
  assert.deepEqual(table.map(entry => entry.depth), groupRows(rows).map(row => row.depth), '同一批层')
  assert.deepEqual(table.map(entry => `${entry.key} ${entry.count}`),
    groupRows(rows).map(row => `${row.key} ${row.count}`), '计数也同一份')
  assert.deepEqual(allUsageGroupKeys(root, { showDirectories: true }), table.map(entry => entry.key),
    '「全部折叠」收的那批键就是这张表的键列')
})

// ——— 展开态沿用（`carryUsageExpansion`）———

test('沿用 mixed：消失的组键就地清掉、还在的沿用、新出现的组按默认展开', () => {
  const before = buildUsageTree(SAMPLE, '工作区')
  const collapsedKey = usageGroupKey('file', 'src/x.ts')
  const absentKey = usageGroupKey('file', 'gone.ts')
  const carried = carryUsageExpansion(before, { mode: 'mixed' }, [absentKey, collapsedKey])
  assert.deepEqual(carried, [collapsedKey], 'gone.ts 那一键永不命中 ⇒ 不再沿用（上游只抓还看得见的路径，UsageViewImpl.java:1272）')
  const grown = buildUsageTree([...SAMPLE, at('src/new.ts', 3)], '工作区')
  assert.deepEqual(carryUsageExpansion(grown, { mode: 'mixed' }, carried), [collapsedKey],
    '新出现的 src/new.ts 不在结果里 = 默认展开（上游 restore 那一步根下那一层一律展开，:1293-1302）')
})

test('沿用 expanded / collapsed：按上一次那一整档盖过逐组的状态', () => {
  const root = buildUsageTree([...SAMPLE, at('src/new.ts', 3)], '工作区')
  const xKey = usageGroupKey('file', 'src/x.ts')
  assert.deepEqual(carryUsageExpansion(root, { mode: 'expanded' }, [xKey]), [],
    '全展开那一档 ⇒ 新出现的组也展开（上游 IS_EXPANDED=true 时结果回来 expandAll()，UsageViewImpl.java:1875-1877）')
  assert.deepEqual(carryUsageExpansion(root, { mode: 'collapsed' }, []), allUsageGroupKeys(root),
    '全折叠那一档 ⇒ 新出现的组也收起')
})

test('沿用给的结果是树序、去重的（旧集乱序或带重复都不影响）', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  const keys = allUsageGroupKeys(root)
  const shuffled = [keys[3], keys[1], keys[3], keys[0]]
  assert.deepEqual(carryUsageExpansion(root, { mode: 'mixed' }, shuffled),
    [keys[0], keys[1], keys[3]], '按树里的先后重排 + 去掉重复的那一键')
})

test('沿用认档：目录那一层关掉后旧的目录键不往新形状上贴', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  const directoryKey = usageGroupKey('directory', 'src/')
  const fileKey = usageGroupKey('file', 'src/x.ts')
  const collapsed = carryUsageExpansion(root, { mode: 'mixed', showDirectories: true }, [directoryKey, fileKey])
  assert.deepEqual(collapsed, [directoryKey, fileKey], '开着目录时两键都还在')
  assert.deepEqual(carryUsageExpansion(root, { mode: 'mixed' }, [directoryKey, fileKey]), [fileKey],
    '目录那一档关着 ⇒ 树里没有目录组 ⇒ 折叠集里也不该有（否则就是永不命中的垃圾键）')
})

// ——— 面板状态层（真消费方：`src/referenceContents.ts` → `src/toolViewContext.ts` → ReferencePanel）———

test('面板：换一批结果后那个已经消失的组键被清掉，结果再回来时不沿用旧意图', () => {
  resetReferences()
  const search = startReferences('prune', 'P#prune')
  finishReferences(search, SAMPLE)
  const xKey = usageGroupKey('file', 'src/x.ts')
  toggleUsageGroup(xKey)
  assert.equal(leafRows(referenceRows.value).some(row => row.path === 'src/x.ts'), false, '先收起来')
  finishReferences(search, [at('src/y.ts', 0), at('src/z.ts', 5)])
  assert.equal(referenceRows.value.some(row => row.key === xKey), false, '这一批里没有 src/x.ts 那一组')
  finishReferences(search, SAMPLE)
  assert.equal(leafRows(referenceRows.value).filter(row => row.path === 'src/x.ts').length, 2,
    '同一份内容、同一棵树形状再回来：那条已经失效的折叠意图不该把它重新收起')
  resetReferences()
})

test('面板：全部折叠后单独放开一个组，别的组仍收起', () => {
  resetReferences()
  const search = startReferences('mixed-after-all', 'M#mixed')
  finishReferences(search, SAMPLE)
  collapseAllUsageGroups()
  assert.equal(leafRows(referenceRows.value).length, 0, '全部折叠：一条叶子都不剩')
  const xKey = usageGroupKey('file', 'src/x.ts')
  toggleUsageGroup(xKey)
  assert.deepEqual(leafRows(referenceRows.value).map(row => row.path), ['src/x.ts', 'src/x.ts'],
    '只有被点的那一组放开')
  assert.equal(groupRows(referenceRows.value).filter(row => row.collapsed).length, 3, '其余三个文件组仍是收起态')
  toggleUsageGroup(xKey)
  assert.equal(leafRows(referenceRows.value).length, 0, '再点一次收回去（渲染中那份才是存储的依据）')
  resetReferences()
})

test('面板：全部折叠这一档跟着新结果走（新增的那个文件组也收起）', () => {
  resetReferences()
  const search = startReferences('grow-collapsed', 'G#grow')
  finishReferences(search, SAMPLE)
  collapseAllUsageGroups()
  finishReferences(search, [...SAMPLE, at('src/new.ts', 2)])
  const newKey = usageGroupKey('file', 'src/new.ts')
  assert.equal(referenceRows.value.find(row => row.key === newKey).collapsed, true,
    '上游按过折叠之后新节点不会自己展开；本仓同一档 ⇒ carry 给的是整棵树的键')
  assert.equal(leafRows(referenceRows.value).length, 0, '新结果也没有把叶子行放回来')
  resetReferences()
})

test('面板：两个整体动作写的就是应用级那一格（上游 :346/:357 那两笔 IS_EXPANDED）', () => {
  resetReferences()
  const previous = referencesExpandedAll.value
  try {
    const search = startReferences('flag', 'F#flag')
    finishReferences(search, SAMPLE)
    expandAllUsageGroups()
    assert.equal(referencesExpandedAll.value, true, 'expandAll ⇒ IS_EXPANDED=true')
    collapseAllUsageGroups()
    assert.equal(referencesExpandedAll.value, false, 'collapseAll ⇒ IS_EXPANDED=false')
    toggleUsageGroup(usageGroupKey('file', 'src/x.ts'))
    assert.equal(referencesExpandedAll.value, false, '单独收起一个组**不写**那一格（上游只有那两个整体动作写）')
    resetReferences()
    assert.equal(referencesExpandedAll.value, false, '换工程清的是内容，应用级那一格留着（usageView.xml 跟着 IDE 走）')
  } finally {
    referencesExpandedAll.value = previous
    resetReferences()
  }
})

test('面板：新起的这份内容继承应用级那一档（没按过逐组动作就跟着 IS_EXPANDED 那一格）', () => {
  resetReferences()
  const previousTab = referencesInNewTab.value
  const previous = referencesExpandedAll.value
  try {
    referencesInNewTab.value = true
    const first = startReferences('inherit', 'I#inherit')
    finishReferences(first, SAMPLE)
    // 「全部展开」既把这一条内容置成 expanded，也写应用级那一格
    expandAllUsageGroups()
    const second = startReferences('fresh', 'F#fresh')
    finishReferences(second, SAMPLE)
    assert.equal(groupRows(referenceRows.value).every(row => !row.collapsed), true,
      '新起的一条没有自己的档位 ⇒ 继承应用级那一格（此刻是 expanded）')
    toggleUsageGroup(usageGroupKey('file', 'src/x.ts'))
    selectReferences(first.id)
    assert.equal(referenceRows.value.find(row => row.key === usageGroupKey('file', 'src/x.ts')).collapsed, false,
      '逐组的意图只属于那一条内容（上游一 Content 一棵 model 树），另一条仍按它自己的 expanded 走')
  } finally {
    referencesInNewTab.value = previousTab
    referencesExpandedAll.value = previous
    resetReferences()
  }
})

test('面板：关掉一条内容就把它那两份状态一起丢掉（不留垃圾键也不留档位）', () => {
  resetReferences()
  const previousTab = referencesInNewTab.value
  try {
    referencesInNewTab.value = true
    const first = startReferences('one', 'One')
    finishReferences(first, SAMPLE)
    const second = startReferences('two', 'Two')
    finishReferences(second, [at('src/x.ts', 1)])
    toggleUsageGroup(usageGroupKey('file', 'src/x.ts'))
    selectReferences(first.id)
    assert.equal(referenceRows.value.find(row => row.key === usageGroupKey('file', 'src/x.ts')).collapsed, false,
      '第一条那份从来没收起过')
    closeReferences(second.id)
    finishReferences(first, [...SAMPLE, at('src/w.ts', 3)])
    assert.equal(leafRows(referenceRows.value).filter(row => row.path === 'src/x.ts').length, 2,
      '第二条那份折叠状态/档位不该顶到第一条上（上游一 Content 一棵 model 树）')
  } finally {
    referencesInNewTab.value = previousTab
    resetReferences()
  }
})

test('成员层迟到（符号后到）时已收的文件组仍收着，新的成员键按 mixed 只沿用在树里的', () => {
  resetReferences()
  const search = startReferences('late-symbols', 'L#late')
  finishReferences(search, MEMBER_SAMPLE)
  const xKey = usageGroupKey('file', 'src/x.ts')
  toggleUsageGroup(xKey)
  provideUsageSymbols(path => (path === 'src/x.ts' ? SYMBOLS_X : []))
  const rows = referenceRows.value
  assert.equal(rows.find(row => row.key === xKey).collapsed, true, '符号迟到不该把用户收起来的那一组打开')
  assert.equal(leafRows(rows).length, 2, '收着的文件组下面一条都不出现（成员层也一样收在里面）')
  provideUsageSymbols(null)
  resetReferences()
})

test('行模型：组行的箭头只在真收得住东西时出现（没有假按钮）', () => {
  const root = buildUsageTree(SAMPLE, '工作区')
  const rows = flattenUsageTree(root)
  assert.equal(groupRows(rows).every(row => row.collapsible), true, '每个真组都收得动')
  assert.equal(leafRows(rows).every(row => !row.collapsible), true, '叶子没有箭头')
  const filtered = flattenUsageTree(buildUsageTree([at('src/x.ts', 5, 2)], '工作区', {
    symbolProvider: () => SYMBOLS_X,
  }))
  assert.deepEqual(filtered.map(row => `${row.depth}${row.kind.slice(0, 1)}`), ['0f', '1c', '2m', '3u'],
    '四档行树都在：文件 → 类 → 方法 → 用法')
  assert.equal(filtered.find(row => row.kind === 'method').collapsible, true,
    '方法组自己挂着那一条位置 ⇒ 收它就是收那一条，箭头是真的')
  assert.equal(root.count, 5)
})
