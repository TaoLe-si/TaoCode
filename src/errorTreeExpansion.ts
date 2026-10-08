// 错误树「新到的错误自动展开它所在的组」—— 上游 `NewErrorTreeViewPanel.kt:331-361`
// （`updateAddedElement`）末尾那两拍：`:357-360`
//   if (element.kind == ErrorTreeElementKind.ERROR) { // expand automatically only errors
//       future!!.thenRun { makeVisible(element) } }
// `makeVisible` = `:363-365` 的 `structureModel.makeVisible(element, myTree) {}`，展开的是这条元素
// 到根的那条路径 ⇒ 效果是「折着的组里冒出一个错误，那一组当场展开」。警告/提示/信息新到时**不**展开
// （上游那句注释 "expand automatically only errors" 讲的就是这一条区别对待）。
//
// 本仓与上游差一处，写在明面上：上游的展开态是 `JTree` 的运行时对象、从不落盘
// （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:21-34`
// 那九个持久字段（selectedTabId / proportion / autoscrollToSource / showPreview / groupByToolId /
// sortFoldersFirst / sortBySeverity / sortByName / hideBySeverity）里没有展开态那一格 ——
// 全文件 grep `expand|collaps` 零命中），而本仓的折叠集合 `collapsedGroups` **是**持久化的
// （理由见 `src/problemsPanelState.ts:17-19`）⇒ 打开面板时已经在的那一批算**基线**、不算"新到"，
// 否则上次会话折着的错误组一开机就被强制打开，那份持久化就白存了。只对打开之后新冒出来的错误生效。
//
// 规则本体（怎么判新到、挑哪些组放出来）是纯函数，住在 `src/errorTree.ts` 的
// `errorTreeRowKey` / `expandGroupsForNewErrors`。判据在 **`tests/error-tree-expansion.test.mjs`**：
//   · `errorTreeRowKey` —— 该文件 `:40-104` 那 6 条（重排不改键 `:40`、同位置不同错不撞 `:51`、
//     不同文件同名同位置不撞 `:56`、逐格都参与身份 `:63`、`code` 缺省与空串同键 `:86`、
//     tags/相关位置在身份之外 `:95`）；
//   · `expandGroupsForNewErrors` —— 该文件 `:106-195` 那 10 条（基线不放组 `:106`、只放出出错那一组
//     且保留用户手动折的 `:115`、恒为子集从不新增 `:127`、全新分组默认展开 `:136`、
//     只有 ERROR 触发展开 `:144`、同组多条幂等 `:155`、分组档 `:162`、空串档是空操作 `:170`、
//     返回新数组 `:178`、消息变了算新到 `:189`）。
// 反向验证：`docs/batch-2026-10-06-errtreejudge.md` §3 那六个注入点（行键函数 2 处、展开沿用 4 处），
// 每个都至少打红一条上面点名的用例。
// （这一处 2026-10-06 之前写的是「判据在 `tests/error-tree.test.mjs`」，那句话当时是**假的** ——
// 那份文件里零条用例钉这两个函数；订正留痕见上面那份报告的 §2。）
// 这一层只做一件事：持有「上一批」这份会话内快照，并把面板的响应式接进去。
import { ref, watch, type Ref } from 'vue'
import type { ProblemRow } from './problems.ts'
import { errorTreeRowKey, expandGroupsForNewErrors } from './errorTree.ts'

/**
 * `source` 是当前显示的那批问题（面板给 `() => rows.value`），`collapsed` 是折起来的组键集合
 * （`src/problemsPanelState.ts` 的那一格）。有新错误落进某个折着的组 ⇒ 把那个组的键拿掉。
 *
 * `groupKeyOf` 由调用方按**当前的分组档**给（`src/problemsView.ts` 的 `groupKeyOf(row, grouping)`）：
 * 同一个键在不同档下含义不同（见那里），所以档换了之后旧的判定不会去动新档的键。
 * 只在行集合变化时跑 —— `watch` 建在调用方 `setup()` 里，随组件卸载自动停，
 * 与面板里其它 `watch` 同一形态（不另开一条生命周期）。
 */
export function trackErrorTreeExpansion(
  source: () => readonly ProblemRow[],
  collapsed: Ref<string[]>,
  groupKeyOf: (row: ProblemRow) => string,
): void {
  // 「上一批」的身份集合。第一次跑只登记基线、不做展开（见文件头那条差异）。
  const seen = ref<ReadonlySet<string>>(new Set())
  let primed = false
  watch(source, next => {
    const before = seen.value
    seen.value = new Set(next.map(errorTreeRowKey))
    if (!primed) {
      primed = true
      return
    }
    const opened = expandGroupsForNewErrors(collapsed.value, before, next, groupKeyOf)
    // 真要少键时才写回 —— 写一次就触发一次存档 watch，没必要每帧都摸。
    if (opened.length !== collapsed.value.length) collapsed.value = [...opened]
  }, { immediate: true, deep: false })
}
