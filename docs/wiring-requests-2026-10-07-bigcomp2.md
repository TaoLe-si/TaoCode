# 接线请求 · 2026-10-07 · bigcomp2（大组件收口 lane）

本 lane 名下：`CodeEditor.vue` / `DebugPanel.vue` / `SourceControl.vue` / `DiffView.vue` 四个大组件
及其拆出模块（`src/debug*.ts` / `src/dap*.ts` / `src/changeList*.ts` / `src/mergeEditor.ts` /
`src/editorKeymap.ts` / `DebugStartPane.vue` / `DebugConsolePane.vue` / `DebugProgressPane.vue` /
`RevisionCompareDialog.vue` / `MergeEditor.vue` 等）。**上限只降不抬**。

本文只是给**别的 lane 占着**或**被上限/门禁挡住**的挂载点 —— 每条写清：目标文件、插入点、要加什么、
为什么本 lane 不直接落。

---

## W-1：`RevisionCompareDialog.vue` 的三栏「暂存内容」——**已落**（MergeEditor）

**已实现**：`src/components/MergeEditor.vue` 的工具栏加了「暂存内容…」按钮，打开
`src/components/RevisionCompareDialog.vue` 的 `stages` 模式（索引冲突三阶段 `:1:` 基线 /
`:2:` 我们的 / `:3:` 他们的**真 blob**）。取数在 `src/revisionContent.ts` 的 `loadMergeStages`，
复用现有 `git.showCommit` 的 `:<n>:<path>` 说明符 —— **不新增 native 方法**。

> 原计划的挂点是 `SourceControl.vue` 的变更右键菜单（`changesMenuActions.ts` 加一行 +
> `pickRowMenu` 加一个 `case`）。本 lane 改从 `MergeEditor.vue` 挂 —— 后者是本 lane 文件且
> 有充足行数余量，语义同样成立（三方合并编辑器正是处理冲突的地方），避开了两处硬约束：
> ① `SourceControl.vue` 897/900 行、② `CHANGES_MENU_ROWS` 被 `tests/changes-menu.test.mjs:30/35/40/57/96`
> 用精确 id 序列钉住。若仍想要变更视图那一条入口，按上面的行/位置加即可（记得同步那几处断言）。

---

## W-2：`RevisionCompareDialog.vue` 的两栏「与本地比较」挂点（VCS Log）

`revision` 模式要一个**修订号**才能比"该修订 vs 工作区"。`SourceControl.vue` 是变更视图，
**没有修订上下文**（这正是上游 `CompareWithLocalDialog.showChanges(project, file, revision…)` 从
Log 工具窗口调起、而不是从 Changes 视图调起的原因）。本仓的修订上下文在 VCS Log 那一族：

- 建议落点：`src/components/VcsLogDetails.vue`（选定修订的路径行）或 `src/components/VcsLogDiff.vue`，
  加一条「与本地比较」→ 打开 `<RevisionCompareDialog :path="…" :revision="currentRevision" @close="…" />`。

这是 **VCS-log lane** 的文件，本 lane 不碰。模块与取数都已就绪，只需这一处宿主调用。

---

## W-3：三方合并 stage1/2/3 的 native 通道（如实记，**当前不需要新增**）

任务书要求"三方合并 stage1/2/3 真内容"。**已用现有通道补齐**：`src/revisionContent.ts` 通过
`git.showCommit` 的 `<rev>:<path>` / `:<n>:<path>` 说明符读索引三阶段，`RevisionCompareDialog.vue`
的 `stages` 模式消费它。因此 `src/bridge.ts` 的 `Method` union 与 `native/main.cpp` 的 `git.*`
分派**无需改动**（这两个文件在本 lane 仍属禁改/贴死）。

若将来要把取数换成显式的原生方法（如新增 `git.stageContent`），才需要：
`src/bridge.ts` 的 `Method` union 加方法名、`native/main.cpp` 加分派、`native/git.cpp` 加实现
—— 那是跨 lane 的 native 改动，本 lane 不发起。

---

## 插件 API 暴露清单（本 lane 新增，已落 + 判据绿）

新增模块 `src/debugDiffExtensionPoints.ts`（照 `src/daemonExtensionPoints.ts` / `ideViewExtensionPoints.ts`
的形状：EP 声明 + 注册/注销 + 消费函数 + bundled 默认贡献者），把调试/差异/变更列表三域的上游
**同名 EP** 暴露给第三方插件：

| EP id（逐字上游） | 上游出处 | 方法面（同名） | bundled 默认贡献 |
| --- | --- | --- | --- |
| `com.intellij.xdebugger.breakpointType` | `intellij.platform.debugger.content.xml:10` / `XBreakpointType.java:39` | `getId` / `getTitle` / `isSuspendThreadSupported` / `isTemporaryBreakpointSupported` / `getDefaultSuspendPolicy` | 行断点 `dap-line` |
| `com.intellij.diff.DiffTool` | `intellij.platform.diff.xml:17` / `DiffTool.java:19` | `getName` / `canShow(context, request)` | 并排差异 `taocode.diffView` |
| `com.intellij.diff.merge.MergeTool` | `intellij.platform.diff.xml:19` / `MergeTool.kt` | `canShow` / `createComponent` | 三方合并 `taocode.mergeEditor` |
| `com.intellij.diff.DiffExtension` | `intellij.platform.diff.xml:21` / `DiffExtension.java` | `onViewerCreated(viewer, context, request)` | 无（派发点：`DiffView.vue`） |
| `com.intellij.vcs.changeListDecorator` | `ChangeListDecorator.java:16`（**项目级**） | `decorateChangeList(changeList, cell, selected, expanded, hasFocus)` | 无 |

**消费链**：`src/components/DiffView.vue` 在每个查看器创建/切换显示对象时调 `applyDiffExtensions`
（上游 `DiffExtension` 的等价派发点）；`src/main.ts` 加载本模块（启动即声明 EP + 登记 bundled 默认贡献）。
判据：`tests/debug-diff-extension-points.test.mjs`（9 条，绿）。

**如实边界**（不发明上游没有的 EP）：
- 上游**没有** `XDebuggerExtension` 这个类/EP（参考树整树 grep 零命中）——调试域的面就是
  `breakpointType` 这条真 EP（行断点走它的子类 `XLineBreakpointType`，是同一个 EP）。
- 上游**没有** `VcsAnnotationProvider` 这个 EP —— `AnnotationProvider`
  （`.../annotate/AnnotationProvider.java:15`）是 `AbstractVcs.getAnnotationProvider()` 按 VCS 现取的
  对象，不是插件 EP。本仓没有多 VCS 后端 ⇒ 不登记假 EP。
