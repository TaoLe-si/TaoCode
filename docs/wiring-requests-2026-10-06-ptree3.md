# 接线请求 · 2026-10-06 · 代号 `ptree3`（判词升档 / 订正，全部只针对保留文件）

保留文件我一个字没改：`scripts/verdict_table.py` 与 `docs/inventory/*.md`。
下面每对的 `old` 都是我用 `grep -c` 在 `scripts/verdict_table.py` 里**逐字验过存在**的子串
（计数见每条后面），改完要重跑 `python scripts/verdict_table.py projectviews` 才能刷新
`docs/inventory/verdict-projectviews.md`（该文件是生成物，别手改）。
本仓证据行号来自我这一轮亲自打开的文件；上游行号同理（参考树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）。

---

## R1 · `pv/project-view-nodes`：「可编辑的嵌套规则」已经做了（判词仍写在「缺」里）

坐标：`scripts/verdict_table.py` 的 `FAMILIES['projectviews']` 里 `pv/project-view-nodes` 那条判词（`grep -c 可编辑的嵌套规则` = 1）。

old（判词原文片段）：
```
、可编辑的嵌套规则（上游 `FileNestingInProjectViewDialog`；本仓 `createProjectTreeModel` 没有设置页给 `nestingRules` 喂值，只用 `DEFAULT_NESTING_RULES`）
```
new：
```
（「可编辑的嵌套规则」已于 2026-10-06 落地，原列「缺」撤销：上游 `FileNestingInProjectViewDialog.java:185-208` 的 `doValidate` 三条在 `src/projectTreeNestingDialog.ts:44,58,79,86`，对话框在 `src/components/FileNestingSettings.vue:51-54`，入口 `src/components/ProjectViewSortSettings.vue:34,67` → `src/components/ToolWindowView.vue:18,224`，喂回模型的写入口是 `src/projectTreeState.ts` 的 `updateNesting`，消费点 `src/components/FileTree.vue:50`；判据 `tests/project-tree-appearance.test.mjs:117,243` + `tests/project-tree-nesting.test.mjs`。落盘形态也照上游整形过：一个父一条、`(父,子)` 去重、父升序，`ProjectViewFileNestingService.java:102-103,149-158` ⇒ `src/projectTreeState.ts:50-93`）
```

## R2 · `pv/project-view-nodes`：「压缩目录」没进判词任何一侧（既没记已有、也不该挂在「包视图」那条缺项下）

坐标：同一条判词里 `包视图（`PackageViewPaneModel`/`ClassesTreeStructureProvider` 的 flatten/compact middle packages 呈现，需 PSI/Java 模型）`（`grep -c CompactDirectories` = 0 ⇒ 这是**插入**不是替换）。

在「本仓已有」那一串里、`src/projectTreeDecorations.ts`（…判据 …）之后插一句：
```
；`src/projectTreeCompactDirs.ts`（`ProjectView.CompactDirectories`「压缩目录」：只有一个子目录的目录与那个子目录并成一行、显示名按 `/` 连，`intellij.platform.projectView.xml:98-99`、`ActionsBundle.properties:1459-1460`、`ScopeViewTreeModel.java:595-610,657-661,789-792`；默认关 `NodeOptions.java:41-43`，消费点 `src/projectTreeModel.ts:49-82,184-193`，判据 `tests/project-tree-appearance.test.mjs:28-116,269`）。**注意与「包视图的 flatten/compact middle packages」不是一件事**：上游那条走 `isPackage(icon)`/`visitPackages`（`ScopeViewTreeModel.java:594,635-655`），需要 PSI，本仓判 `[-]`；文件系统目录这一半本仓已做。
```

## R3 · `pv/project-view`：`MarkRootGroup` 那一条「缺」已不成立

坐标：`FAMILIES['projectviews']` 的 `pv/project-view` 判词（`grep -c MarkRootGroup` = 1）。

old（片段）：
```
`MarkRootGroup`/`MarkAsContentRootAction` 这组标记根动作（根与 SDK 只在 `src/components/ProjectStructurePane.vue` 编辑，项目树右键没有 Mark Directory As）
```
new：
```
（「`MarkRootGroup`/`MarkAsContentRootAction` 这组标记根动作」已于 2026-10-06 复核为**已做**，原列「缺」撤销：成员与可见性规则在 `src/pvMarkRoots.ts`，右键那格的渲染与落盘在 `src/treeActions.ts:156-184`（`markRootMenu`/`applyMarkRoot`，写回 `project.settings.update` 后 `deps.refreshTree?.()`），菜单挂点在 `src/App.vue:2461-2463`，判据 `tests/pv-mark-roots.test.mjs`。根与 SDK 仍可在 `src/components/ProjectStructurePane.vue` 编辑。**上游坐标由该动作的归属桶补**：本轮没有亲自打开 `MarkRootGroup` 的上游文件，指不到就按规约写「无法核实」，所以这条升档只带本仓证据）
```

## R4 · `pv/project-view`：`src/projectTreeState.ts` 的括注写错了职责

old（片段，`grep -c 折叠状态持久化` = 1）：
```
`src/projectTreeState.ts`（折叠状态持久化）
```
new：
```
`src/projectTreeState.ts`（**项目视图设置**的持久化：`sortKey` + `foldersAlwaysOnTop`/`autoscrollToSource`/`autoscrollFromSource`/`openInPreviewTab`/`compactDirectories`/`showScratchesAndConsoles` 六个布尔键 + `useFileNestingRules`/`nestingRules`，按工作区根分桶存 localStorage，见 `:7-18,75`）
```
留痕：原判词的「折叠状态持久化」在本文件里没有任何对应序列化代码（我读完 `src/projectTreeState.ts:1-176` 全文），也没有定位到别处做树折叠状态的持久化 ⇒ 若确有落点，请改指那个文件；若没有，就写「本仓缺：树折叠状态不跨会话」。

## R5 · `pv/structure-view`：两条「缺」其实已做

坐标：`FAMILIES['projectviews']` 的 `pv/structure-view` 判词（`grep -c "autoscroll to/from source 两个开关"` = 1、`grep -c 本仓只有名称与种类两档` = 1）。

old：
```
autoscroll to/from source 两个开关（`StructureViewComponent` 的跟随编辑器开关）、PSI 侧的排序器族（`VisibilitySorter`/`Sorter` 扩展点；本仓只有名称与种类两档）
```
new：
```
（以下两条已于 2026-10-06 复核为**已做**，原列「缺」撤销）① `StructureViewComponent` 的跟随编辑器两个开关：上游默认档 `StructureViewFactoryImpl.java:49`（`AUTOSCROLL_MODE = true`）与 `:50`（`AUTOSCROLL_FROM_SOURCE = false`）—— 实测路径是 `platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java`（中间有 `impl/`）；生效点 `.../newStructureView/StructureViewComponent.java:655`、`:794`、`:804-849`。本仓：`src/structureFollow.ts:105-112`（`shouldRevealInEditor`）与 `:88-90`（编辑器 1 基列 → LSP 0 基），面板两个开关真渲染在 `src/components/OutlinePanel.vue:116,121`（默认档 `:31-32` 照上游 true/false），跟随光标那一支 `:74-77` → `src/outlineView.ts:127`；判据 `tests/structure-follow.test.mjs` + `tests/outline-caret-source.test.mjs`。② 按可见性排序（`VisibilitySorter` 族的等价物）：上游 `java/java-structure-view/src/com/intellij/ide/structureView/impl/java/VisibilityComparator.java:23-29`（级别大的在前、同级交给下一个比较器）与 `:16`（判不出 = `UNKNOWN_ACCESS_LEVEL = -1` 排最后）；本仓四档 + unknown 在 `src/structureFollow.ts:24-54`，接在 `src/outlineView.ts:39,93-94`，面板工具条那一格 `src/components/OutlinePanel.vue:47,55`。**仍缺**的是 `Sorter` 扩展点这一层（本仓没有可扩展的排序器注册位，只有名称/种类/可见性三档）与 `Show Inherited Members`（继承成员要 PSI 或语言服务给出，LSP `documentSymbol` 不区分）
```

---

## 本轮不需要接的线（免得误会）

C1（嵌套传递规则/大小写/角色判定）、C2（批量展开覆盖嵌套父行）、C3（规则表落盘形态）都只在
`src/projectTree{Nesting,Model,State}.ts` 内部改，消费链是既有的：
`FileTree.vue:50` → `projectTreeModel` → 齿轮/对话框/「递归展开」按钮（`ToolWindowView.vue:208`）。
**没有**新增需要 `src/App.vue` 挂载的入口。
