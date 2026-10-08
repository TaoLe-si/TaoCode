# 接线请求 · 2026-10-06 · 桶 2 · 2b2（问题视图「按诊断码分组」端到端）

> 本轮四环（分组维度 / 面板项 / 过滤 / 抑制入口）**全部落在自有文件里**，没有改任何保留文件：
> 改的是 `src/problemsView.ts`、`src/components/ProblemsPanel.vue` 与 `tests/problem*` 四个测试文件（清单见
> `docs/batch-2026-10-06-bucket2b2.md` §2）。下面两条是给主代理的：第 1 条是这条链**剩下的唯一真缺口**，
> 第 2 条是锦上添花，四环都不依赖它。

## 接线请求（给主代理）

### R1（建议做）：问题面板的选中行要能用 Alt+Enter 打开「操作」菜单
- 目标文件：`src/keymapBindings.ts` + `src/actionRegistry.ts`（都在保留清单里），落点配合 `src/App.vue` 里
  `<ProblemsPanel v-else-if="bottomTab === 'problems'" …>` 那一处挂载。
- 要接什么：把「对选中的问题行打开抑制/快速修复弹层」这个动作注册成一个 action（id 建议
  `problems.view.quickFixes`），键位取既有 `ShowIntentionActions`（Alt+Enter）的同一把，
  作用对象 = 面板里当前聚焦的那一行；面板需要为此多暴露一个 `openMenuForSelected()` 出口（我可以在下一轮加，
  只要保留文件那边给我一个调用点）。组件侧我已备好入口：`src/components/ProblemsPanel.vue:226` 的
  `openRowMenu(row, event)`，行上的 `@click.stop="openRowMenu(p, $event)"` 在 `:658`。
- 为什么需要：上游这一格就是工具栏上的**同一个动作**，而且**带快捷键**——本仓现在只有鼠标入口，
  键盘用户走完「按诊断码分组 → 选中一条 → 抑制」这条链要靠点鼠标；补齐后这条链与上游同形。
- 上游依据：`platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`
  （`<action id="ProblemsView.QuickFixes" icon="AllIcons.Actions.IntentionBulb" use-shortcut-of="ShowIntentionActions"
  class="…ShowProblemsViewQuickFixesAction"/>`）；动作对"选中的那个问题节点"生效：
  `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ShowProblemsViewQuickFixesAction.kt:33-35`
  （`event.getData(SELECTED_ITEM) as? ProblemNode`）与 `:78-92`（`IntentionListStep(…, IntentionSource.PROBLEMS_VIEW)`）；
  快捷键来自 `PlatformCoreDataKeys`/`ActionPlaces.PROBLEMS_VIEW_POPUP`
  （`platform/ide-core/src/com/intellij/openapi/actionSystem/ActionPlaces.java:112`；
  树右键菜单挂载点 `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewPanel.java:220`）。

### R2（可选）：状态栏透出「只看某一组」的焦点态
- 目标文件：`src/App.vue` 状态栏那一带（保留文件；本轮没动，状态栏的 profile 切换器在 `App.vue:2307` 已由前一批接好，我不再交那一条）。
- 要接什么：把 `src/components/ProblemsPanel.vue` 内的会话态 `focus`（`:104` 的
  `ref<{ key, label } | null>`）通过一个 `focusChange` 事件抛出去，状态栏显示「只看：〈组名〉」。
- 为什么需要：焦点是会话内的、**故意不落存档**（上游 `ProblemsViewState.kt:20-33` 没有这个字段），
  所以它只在面板里可见；如果用户把面板滚到底部，容易误以为"问题变少了"。这是可见性提示，不是功能缺口 ——
  不做也不影响四环（面板工具栏上已经有在场标记与退出按钮，`ProblemsPanel.vue:489-492`）。
- 上游依据：上游的同类提示是状态栏的 inspection 计数与工具窗口标题的严重度图标
  （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewIconUpdater.java`，
  注册于 `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:62`）。

## 本轮**没有**提出的请求（避免重复劳动）
- `bridge.ts` 的 `LspDiagnostic.code`/`tags`：已存在（`src/bridge.ts:118`），宿主也已在
  `native/lsp_support.cpp:148-149` 原样上传 —— 这条链的卡点从来不在类型上，所以本轮没有提这一类请求。
- 状态栏 profile 切换器：已在 `App.vue:2307`，不再交。
- `relatedInformation` / `codeDescription` 透传：**没有提**，因为这两个字段在这棵上游基准树里搜不到任何引用点
  （`grep -rn codeDescription platform/lsp` 无命中），属"无法核实"，按规约不能拿它当依据要求宿主改动
  （详见报告 §5.4）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（选中行 Alt+Enter 开操作菜单）** —— 组件侧入口**已就绪**：`src/components/ProblemsPanel.vue:307-325` 有 `openMenuForSelected()` 并 `defineExpose`。但键位/动作注册落在 `src/keymapBindings.ts` + `src/actionRegistry.ts`（保留文件，非本 lane 可改面）⇒ **需 action/keymap owner** 注册 `problems.view.quickFixes`（键位取 `ShowIntentionActions`）并在 App.vue 挂载处给它一个调用点。
- **R2（状态栏焦点态）** —— 可选；`focusChange` 事件**已就绪**（`ProblemsPanel.vue:101/:143`），宿主只需在状态栏显示「只看：〈组名〉」。本 lane 不新增（请求原文自述「不做也不影响四环」）。

结论：零待接（组件侧已备好），键位/状态栏那半转给对应 owner。
