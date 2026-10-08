// exec/junit：**变更列表受影响的测试** —— 上游 `TestsByChanges` +
// `AffectedTestsInChangeListPainter` + `ShowAffectedTestsAction` 的文件级等价物。
//
// 上游依据：
//   · `plugins/junit/src/com/intellij/execution/junit/testDiscovery/TestsByChanges.java:9-21`
//     —— 一个 runnable state，`getChangeList()` 返回配置里存的那份变更列表名，
//     `getPosition()` 返回 null（没有"当前光标位置"这一档）；真正的关联靠
//     `JUnitTestDiscoveryRunnableState` 的**测试发现索引**（"哪些测试跑过/用到这个类"）。
//   · `java/vcs/src/com/intellij/execution/testDiscovery/AffectedTestsInChangeListPainter.java:33-43`
//     —— 变更列表节点后面追加 `, Find Affected Tests`（`JavaCompilerBundle.properties` 的
//     `test.discovery.find.affected.tests`，`STYLE_UNDERLINE` 的链接），门控两条：
//     `Registry.is("show.affected.tests.in.changelists")` 与 `ShowAffectedTestsAction.isEnabled(project)`；
//     变更列表为空就不画（`:43-44`）。
//   · `ShowAffectedTestsAction.showDiscoveredTestsByChanges(project, changes, name, context)`
//     —— 点了那个链接之后按变更算出测试集合。
//
// 本仓的等价物（文件级，纯函数）：
//   · **没有测试发现索引**（上游那份索引记录"哪些测试执行时用到过哪些类"，要跑过测试 + 索引存储）；
//     本仓的关联是**文件级命名关系**：变更文件不是测试 ⇒ 用 `src/navGotoTest.ts` 的
//     `findTestTargets`（`JavaTestFinder` 的名字包含 + 邻近度）找它的测试文件；变更文件本身是测试
//     ⇒ 直接受影响。这是可移植的那一半，索引那半缺（差异写在这里，不冒充等价）。
//   · 变更列表来自宿主 `git.status`（`GitChange`），本仓没有 ChangeList 模型，用 git 的工作区变更代替。
//
// 消费点：`src/components/TestRunnerPanel.vue` 的「受影响的测试」按钮（选中变更里发现到的测试）。
// 判据 `tests/affected-tests.test.mjs`。

import { baseNameOfPath, findTestTargets, isTestPath, type RecentFileEntry } from './navGotoTest.ts'

/** 变更列表里的一项（本仓用 git 的工作区变更；上游是 `Change`）。 */
export interface AffectedChange {
  path: string
  /** git 的索引状态（`GitChange.indexStatus`）；只用于展示，不影响判定。 */
  indexStatus?: string
  /** git 的工作区状态（`GitChange.workStatus`）。 */
  workStatus?: string
  untracked?: boolean
}

export interface AffectedTestHit {
  /** 变更文件（触发这条关联的那一项）。 */
  changedPath: string
  /** 受影响测试文件的路径（变更文件本身就是测试时与 `changedPath` 相同）。 */
  testPath: string
  /** 关联强度：变更文件本身是测试 ⇒ 0（最强）；否则是 `findTestTargets` 的邻近度。 */
  weight: number
  /** 为什么算受影响（给界面显示一句话，别让人猜）。 */
  reason: 'changed-test' | 'name-match'
}

/** 上游 `AffectedTestsInChangeListPainter.java:43-44` 的空列表门控 + 链接文案。 */
export const FIND_AFFECTED_TESTS_TEXT = '查找受影响的测试'

/**
 * 按变更算受影响的测试文件。
 * `entries` 是工作区文件清单（用来找测试文件）；返回按（变更文件, 测试文件）去重后的命中表，
 * 排序：变更文件本身是测试的在前，其余按 weight 升序（`findTestTargets` 的口径）、再按路径。
 */
export function affectedTestFiles(changes: readonly AffectedChange[], entries: readonly RecentFileEntry[]): AffectedTestHit[] {
  const hits: AffectedTestHit[] = []
  const seen = new Set<string>()
  for (const change of changes) {
    const path = change.path?.replace(/\\/g, '/') ?? ''
    if (!path) continue
    const push = (testPath: string, weight: number, reason: AffectedTestHit['reason']) => {
      const key = `${path}\u0000${testPath}`
      if (seen.has(key)) return
      seen.add(key)
      hits.push({ changedPath: path, testPath, weight, reason })
    }
    if (isTestPath(path)) {
      // 变更的本身就是测试：它自己受影响（上游的索引也会把"测试类自身变了"算进去）。
      push(path, 0, 'changed-test')
      continue
    }
    for (const target of findTestTargets(entries, path)) push(target.path, target.weight, 'name-match')
  }
  return hits.sort((left, right) =>
    left.weight - right.weight
    || left.changedPath.localeCompare(right.changedPath)
    || left.testPath.localeCompare(right.testPath))
}

/**
 * 受影响的测试文件集合（去重，保序）：面板要拿去勾选/筛选发现到的测试。
 */
export function affectedTestPaths(hits: readonly AffectedTestHit[]): string[] {
  const out: string[] = []
  for (const hit of hits) if (!out.includes(hit.testPath)) out.push(hit.testPath)
  return out
}

/** 变更文件的显示名（面板提示里用；`baseNameOfPath` 同源）。 */
export function affectedChangeName(change: AffectedChange): string {
  return baseNameOfPath(change.path ?? '')
}

/** 一句话结果（面板的 note）：`0` 个时说明为什么没有 —— 空变更列表 vs 有关联但没发现测试。 */
export function affectedTestsNote(changes: readonly AffectedChange[], hits: readonly AffectedTestHit[]): string {
  if (!changes.length) return '当前没有本地更改，没有受影响的测试。'
  const paths = affectedTestPaths(hits)
  if (!paths.length) return `本地更改有 ${changes.length} 个文件，但没在其中或按名字找到对应的测试文件。`
  return `本地更改有 ${changes.length} 个文件，受影响的测试文件 ${paths.length} 个。`
}