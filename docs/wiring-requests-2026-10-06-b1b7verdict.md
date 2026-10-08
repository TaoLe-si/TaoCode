# 接线请求 · B1–B7 手写判决书 lane（2026-10-06）

本 lane 动的是 `docs/inventory/verdict-*.md`（七份）与 `src/**`（除禁改清单）、`tests/**`、`native/**`（除 `main.cpp`）。
下面这些缺口**卡在禁改文件上**（组件归 UI 审查 lane 独占），数据与规则侧已经落盘并有判据，接上即可用。

## W-1 · SE 会话历史的键盘分支 —— `src/components/SearchEverywhereDialog.vue`

**上游**：`SearchEverywhereManagerImpl.java:423-427` 把 `showHistoryItem(true/false)` 注册成
`SearchTextField.SHOW_HISTORY_SHORTCUT`（`Alt+Down`）/ `ALT_SHOW_HISTORY_SHORTCUT`（`Alt+Up`）
（`platform/platform-api/src/com/intellij/ui/SearchTextField.java:64-67`）；
`showHistoryItem`（`:465-472`）把取到的词 `setText` 进搜索框并 `selectAll`。

**本仓已就绪**（`src/searchEverywhereHost.ts` 的返回值）：

| 入口 | 语义 |
|---|---|
| `searchHistoryStep(next: boolean)` | `next=true` 走 `HistoryIterator.next()`、`false` 走 `prev()`，返回要填进输入框的词 |
| `openSearchHistoryText()` | 打开弹层时预填最近一条（`SearchEverywhereManagerImpl.java:128` 的 `myHistoryIterator.prev()`） |
| 记录时机 | 宿主已在关弹层时记一笔（`:138-141` 的 `saveSearchText()`），**无需组件参与** |

规则与持久化在 `src/searchEverywhereHistory.ts`（`SEARCH_HISTORY_LIMIT=50`、按 tab 分家、
All 档跨 tab + distinct、`parse/load/store` 的 localStorage 存档），判据
`tests/search-everywhere-history.test.mjs`（10 条）。

**要加的那几行**：输入框 `@keydown.alt.down.prevent="…"` / `@keydown.alt.up.prevent="…"`，
把 `searchHistoryStep(true/false)` 的返回值写回 `query`；打开弹层时用 `openSearchHistoryText()`
预填（`watch(() => props.open, …)` 那一处已有分支）。

**为什么不由本 lane 做**：`src/components/**` 全部归 UI 审查 lane 独占（lane brief 禁改清单）。

## W-2 · 折叠选区的两条提示（沿用 fold3 的 W-1，未动）

`CollapseSelectionHandler` 行的两处宿主缺口（编辑器内 hint「不能移除自动生成的折叠区域」、
重叠确认框）仍缺，登记在 `docs/wiring-requests-2026-10-06-fold3.md` 的 W-1，本 lane 只订正了判词措辞，档位不动。
## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1 已接线**：`src/components/SearchEverywhereDialog.vue` 补两个 prop `historyStep?/historyText?`（:89-101 附近的注释块），输入框加 `@keydown.alt.down.prevent="applyHistoryStep(true)"` / `@keydown.alt.up.prevent="applyHistoryStep(false)"`，`applyHistoryStep` 写回 `query` 并 `select()`；打开弹层那一支 `watch(() => props.open, …)` 用 `props.historyText?.() ?? ''` 预填。宿主侧：`src/App.vue:1724` 解构补 `searchHistoryStep, openSearchHistoryText`，`:2644` 挂载补 `:history-step` / `:history-text`。出口 `src/searchEverywhereHost.ts:274/:282`（原已就绪，无消费方）。
- **W-2（折叠选区两条提示）跳过** —— 目标在 `docs/wiring-requests-2026-10-06-fold3.md` W-1，属 fold3 域，本 lane 不重复处理（见下条）。

App.vue 行数：2686 → 2695（+9：解构 1 行 + 挂载同行加两 prop）。

## W-3 · 提交期两处面板接线（本轮新增；`src/components/SourceControl.vue`）

本轮把提交期三条上游 EP 落了：`com.intellij.checkinHandlerFactory` / `com.intellij.vcsCheckinHandlerFactory`
（`src/checkinHandlers.ts`；提交前闸**已接**进 `src/sourceControlCommitChecks.ts` 的 `passedCommitCheck()`）
与 `com.intellij.vcs.changes.localCommitExecutor`（同模块的 `commitExecutors()`/`defaultCommitExecutor()`/
`userCommitExecutors()`/`executeCommit()`）。差的只是面板那两处：

1. **提交结果的派发口**（上游 `CheckinHandlersNotifier.kt:15`/`:24`）：`reportCommitResult` 在成功与失败
   两支各有一处调用（`SourceControl.vue` 的 `:449` / `:456` 附近）。改法：在 `passedCommitCheck` 那里把
   `createCheckinHandlers(panel)` 存一份，两支里分别调本轮造好的 `runCheckinSuccessful(handlers)` /
   `runCheckinFailed(handlers, failures.map(String))`（都在 `src/checkinHandlers.ts`）。
   判据：`tests/checkin-handlers.test.mjs` 的「生产消费点」那条现在只钉 `passedCommitCheck`，接线后可加一行。
2. **第三方执行器那条动作**：`userCommitExecutors()` 非空时，在提交按钮旁各出一行（`getActionText()`），
   点了走 `executeCommit(executor.getId(), { root, message, paths, amend })`；缺省那条
   （`taocode.localCommit`）仍走现有 `git.commit` 路径不变。

另：`CheckinPanelLike.root` 现在恒为空串 —— 要填得给 `createCommitChecks` 加一个可选 dep
（`workspaceRoot?: () => string`，见 `src/sourceControlCommitChecks.ts` 的 `CommitChecksDeps`），
再在 `passedCommitCheck` 里写 `root: workspaceRoot?.() ?? ''`；不传不影响现有行为。

## W-4 · B5 只剩一条 `BookmarkBundle`（建议维持 `[~]`，无需接线）

上游 `messagePointer` 是惰性 Supplier（`DynamicBundle.getLazyMessage`），本仓取文案都是一次性同步求值，
没有"先拿指针、稍后再取"的消费者。要闭合需要一条同名面 + 一个真惰性消费点，本仓没有后者 ⇒
建议维持 `[~]` 与现有说明（不造空壳）。
