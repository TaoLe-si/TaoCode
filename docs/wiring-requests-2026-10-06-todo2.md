# wiring-requests-2026-10-06-todo2 —— TODO 族需要别人配合的两条

本 lane（`docs/batch-2026-10-06-todo2.md`）自己那半已经落盘；下面两条**都卡在本 lane 不能动的文件**上，
所以只登记，不硬接线。每条都给了上游依据与本仓落点，接线方照着改就能过判据。

## 1. 提交前 TODO 检查没有按每条模式的大小写档位搜（命中数会比面板偏多）

- 现状：`src/components/SourceControl.vue:487` 的注入实现把 `caseSensitive` **写死 false**：

  ```ts
  pattern => request<SearchResult>('search.run', { query: pattern, regex: true, caseSensitive: false, ... })
  ```

  而 `src/todoScan.ts:22-26` 是逐条模式各发一趟 `search(entry.pattern)`，签名里没有大小写这一位。
  于是勾了「区分大小写」的模式在**提交检查**里仍按不区分统计 ⇒ 同一个模式，
  TODO 工具窗口（本轮已按每条模式定夺）与提交前检查的数字可以不一致。
- 上游依据：两张面板共用**同一份**模式表（`platform/editor-ui-ex/src/com/intellij/ide/todo/TodoConfiguration.java:72`
  的 `getDefaultPatterns()` 是唯一来源；提交检查那条链 `platform/vcs-impl/lang/todo/src/com/intellij/openapi/vcs/checkin/
  TodoCheckinHandlerWorker.java:152-157` 走 `PsiTodoSearchHelper.findTodoItems(...)`，
  而 `findTodoItems` 最终由每条 `IndexPattern` 自己的 `Pattern` 决定命中
  （`platform/editor-ui-ex/src/com/intellij/psi/impl/search/IndexPatternSearcher.java:239,245-247`；
  `Pattern.CASE_INSENSITIVE` 只在 `caseSensitive == false` 时加：
  `platform/indexing-api/src/com/intellij/psi/search/IndexPattern.java:80-89`）⇒ 检查与工具窗不会说两种话。
- 请求的接法（改动面 2 行，都在别人地盘）：
  1. `src/todoScan.ts`（todo 族，本 lane 可以配合改，但**单独改它没有消费者**，按纪律不动）：
     `search: (pattern: string, caseSensitive: boolean) => Promise<SearchResult>`，调用处传
     `entry.caseSensitive ?? false`；
  2. `src/components/SourceControl.vue:487`：把写死的 `caseSensitive: false` 换成收到的第二参。
  ⇒ 若接线方只做 ①，判据 `tests/todo-scan.test.mjs`（若有）会绿而行为没变，所以**必须同批做 ②**，
  并把"caseSensitive 透传"钉成一条能失败的断言。
- 为什么本 lane 不自己动：`src/commit*` 在并发黑名单里，`SourceControl.vue` 是 commit 族在飞的宿主组件。

## 2. 编辑器里的 TODO 着色需要保留文件配合（本仓只着色了工具窗预览）

- 现状：`markerSegments()` 只在 `TodoPanel.vue` 的预览块里用（`src/components/TodoPanel.vue:82-95` + 模板 `:399`）。
  真编辑器里注释中的 TODO 不着色 —— 这与 `docs/inventory/verdict-projectviews.md` 的 `pv/todo` 判词
  「缺：编辑器内的 TODO 高亮（`TodoHighlightVisitor`）」一致，本轮**没有**改这条判词（`docs/inventory` 是脚本生成物，
  手改算缺陷）。
- 上游依据：`platform/todo/src/com/intellij/ide/todo/codeInsight/TodoHighlightVisitor.java:91-93`
  （`getWordToHighlight()` + `Strings.indexOfIgnoreCase` 定位标记词）与 `:60-88` 的整条 TODO 上色。
- 请求的接法：走既有的装饰通道给 `src/components/CodeEditor.vue` 增一层 TODO decoration（数据源就是本轮修好的
  `todoMarkerRegions`，它现在返回 `{start,length}` 词面区间，可直接换列）。
  `src/components/CodeEditor.vue` 是保留文件 ⇒ 只能由接线方开。本 lane 不提供假控件。

## 处理结果（wiring-backlog lane，2026-10-06）

- **1（提交前 TODO 检查大小写档）** —— 目标 `src/commitChecks.ts`（本 lane 可改面），登记。
- **2（编辑器 TODO 着色）** —— 目标 `src/components/CodeEditor.vue`（禁改）。需 CodeEditor owner。

结论：零接线（1 登记，2 转 CodeEditor owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（1 登记，2 转 CodeEditor owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
