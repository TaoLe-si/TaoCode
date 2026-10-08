# lane pv-views · 2026-10-08（projectviews 域 9 族 / 571 行 `[~]`）

结论先行：9 条族判词的每条「缺」逐句核过、`presence==真实代码` 逐条对位（我名下 27 行）；**4 处「缺」已不成立**
（structure-view 继承成员 + W-4 挂载点、project-view 窗格贡献点与 `ContentEntry` 模型、notification 通知组 EP、todo 索引器 EP），
其余维持；9 条判词各追加「2026-10-08 lane pv-views 复核」段；新增判据 1 份（10 test / 44 assert，反向验证会红）。未改任何 `src/` 文件。

## 一、订正（「缺」不再成立，判词已写清新表述）
1. `pv/structure-view`：`Show Inherited Members` 已落 —— `src/outlineInheritedMembers.ts`（`SHOW_INHERITED` 默认关、按定义类型分组、字段/可见性过滤、计数）
   + 取数 `src/outlineSupertypes.ts`（LSP 三跳，未打开文件按需 `lsp.open`）+ 面板 `src/components/OutlinePanel.vue:9-11,102-190`；W-4 挂载点也落了
   （`OutlinePanel.vue:6` → `src/outlineExtensions.ts`）。另订正：上游**没有** Sorter 的 EP（结构视图只有 `psiStructureViewFactory`/`structureViewBuilder`/`lang.structureViewExtension` 三条，均已登记）。
2. `pv/project-view`：`ProjectViewPane` 贡献点已被真实消费（`src/projectViewPanes.ts` + `src/projectViewPaneRegistry.ts` + `src/components/ToolWindowView.vue:312-315` 齿轮下拉）；
   「没有 `ContentEntry` 模型」不成立（`src/rootsModel.ts` 的 `RootContentEntry`/`buildRootModel`/`rootModelRows`，渲染在 `src/components/ProjectStructurePane.vue:167,187,450`）。
3. `pv/notification`：「仍缺的四条」实际只列三条（订正为三条）；`NotificationGroupEP` 已登记、不是缺口。
4. `pv/command`：`UndoProvider` 方法面订正为 `commandStarted`/`commandFinished`（`src/ideViewExtensionPoints.ts:202-216`）。
5. `pv/todo`：两族索引器 EP 均已登记、不是缺口；编辑器高亮落到 `src/todoAnnotator.ts`（未跟踪、149 行）但**零消费方**。
6. `pv/project-view-nodes`：包视图三档数据层在（`src/symbolModel.ts:224`、`src/packageDepsView.ts:239,270,290`），挂载点仍缺。

## 二、维持（逐句核过后仍真缺）
- `pv/history` 三条：标签不随历史清空（`src/historyLabels.ts:24-25`）、重命名回滚仍按当前路径（`src/historyFollow.ts:14-15`）、`HISTORY_SESSION_PATH_LIMIT=32`（`src/historySessions.ts:30`）；族内无第三方注册面（上游非 EP）。
- `pv/command` ①③④⑤：CodeMirror 文本历史不并入全局栈、无 mark/finish 边界、被拒报告仍是提示条（`src/explorerActions.ts:147-153`）、新建/重命名/删除未登记（`src/App.vue` 直写；登记点全仓只有 `src/explorerActions.ts:109,116`）。
- `pv/notification`：`NotificationRouter`、逐组设置页（`src/settingsTreeMeta.ts` 无通知页）；`pv/welcome` 四条（Learn/WSL/OpenAlien/`WelcomeScreenCustomization`，`WelcomePage.vue` 与 EP 表零命中）。
- `pv/project-view`：`SplitProjectViewUtil` 双窗格/Attach to Pane、`CustomizeTreesAction` 定制、用户显式内容根、`PreloadMode`/`PerformanceMonitor`（零命中）。
- `pv/project-view-nodes`：包视图开关组挂载点（`PACKAGE_VIEW_OPTIONS` 零消费方）、模块分组、同一文件多 pane、Detach/Attach 库、inplace comments。
- `pv/bookmarks-alias`：B5 维持（无 `BookmarkType` 插件面；上游 `com.intellij.bookmarkProvider` 在 `platform/lang-api/resources/intellij.platform.lang.xml:134`）。

## 三、真实代码行（我名下 27 行）对位
`ProjectView.java`→`projectViewBehavior.ts`/`projectTreeState.ts`/`projectViewPanes.ts`；`ProjectViewImpl`→`FileTree.vue`/`projectTreeModel.ts`；`nodes/impl.kt`→`moduleScopes.ts`/`rootsModel.ts`；
`NamedLibraryElementNode`→`externalLibraries.ts`；`util.kt`→`outlineView.ts`/`outlineExtensions.ts`；`Content`/`Paths`/`Change`/`Entry`→`native/history.cpp`(+`historyTimeline.ts`)；`ShowHistoryAction`→`menus/localHistory.ts` + `HistoryPanel.vue`；
`Notification`/`Notifications`→`notices.ts`/`notifications.ts`/`notificationGroups.ts`；`TodoPanel`/`FileTree`/`TodoFileNode`→`TodoPanel.vue`/`todoTree.ts`/`todoView.ts`，`TodoConfigurable`→`TodoPatternsPage.vue`；welcome 9 行→`WelcomePage.vue`(+`welcomeProjects.ts`/`welcomeProjectColor.ts`)；`Bookmark`/`BookmarkItem`→`bookmarks.ts`/`bookmarkActions.ts`/`bookmarkLists.ts`/`BookmarksPanel.vue`。

## 四、落点与判据
- `scripts/verdict_table.py`：只改我名下 9 个 `pv/*` 键（追加、未删历史段落；他人族键未动）；生成物用 `python scripts/verdict_table.py projectviews` 重建（`projectviews_verdict_table.json` 变了、`_verdict_table.md` 逐字节未变、`verdict-projectviews.md` 变了；JSON 未手改）。新增判据 `tests/pv-views-verdict-claims.test.mjs`（121 行 / 10 test / 44 assert）：把「已落」落点与「仍缺」里可核实的常量钉住，摘掉即红。

## 五、门禁读数（实跑原文）
```
$ node --test tests/pv-views-verdict-claims.test.mjs   ℹ tests 10  ℹ pass 10  ℹ fail 0
$ node --test tests/module-size.test.mjs               ℹ tests 5   ℹ pass 5   ℹ fail 0
$ node --test tests/verdict-generated.test.mjs         ℹ tests 5   ℹ pass 5   ℹ fail 0
$ node --test <12 份被复核引用的判据：outline-inherited-members/outline-supertypes/roots-model/project-view-pane-registry/
  ide-view-extension-points/ep-component-mount/external-libraries/pv-history-session/history-labels/pv-command-processor/
  notification-groups/todo-multiline>                   ℹ tests 168 ℹ pass 168 ℹ fail 0
$ npx vue-tsc --noEmit  4 错，全在别人 lane 在写的文件：agent-settings/SubagentsSettingsSection.vue 1、
  pluginMarketRemote.ts 1、pluginMarketSearch.ts 2；本 lane 未改 src/ ⇒ 我名下 0 错
反向验证：HISTORY_SESSION_PATH_LIMIT 32→99、todoAnnotator `kind:'todo'`→`'warn'` ⇒ fail=2（两条红）；逐字节恢复后 10/10 绿。
python scripts/verdict_table.py projectviews --check：判决书/`_verdict_table.md` 一致；JSON 报 1 处不一致 —— 差的是
exec/run-instances 与 exec/filters 两条**别人的**族判词（exec lane 在飞编辑），我的 9 族与计数未变。
```

## 六、族档位变化
**无档位变化**：9 族全部维持 `[~]`，逐类行档维持 755 = 3 `[x]` + 571 `[~]` + 0 `[ ]` + 181 `[-]`（一个数都没变）。理由：structure-view 的 86 行是
Java PSI 树元素（本仓只有 LSP `documentSymbol` 文本模型，没有 PSI 对象图）；command/notification/todo 各还有一条真缺口（合并撤销 / 逐组设置页 / 编辑器高亮接线）挡着；本轮只订正文本。

## 七、仍缺什么（如实）
1. `pv/todo` 编辑器内 TODO 高亮「模块在、注册不在」；`src/todoAnnotator.ts` 是**未跟踪**文件（停掉的 lane 留下的落盘件，未撤）。其余缺口的文件/行明细见第二节与各族判词新段；
   `--check` 的 JSON 不一致属他人在飞编辑，生成物未手改（他们稳定后重跑 `projectviews` 即自洽）。

## 八、接线清单（协调代理；文件 + 改法）
1. `src/components/PackageDepsDialog.vue` 工具栏：渲染 `PACKAGE_VIEW_OPTIONS` 三档并把 settings 传 `buildPackageView`（关掉 pv/project-view-nodes 挂载点缺口）。
2. `src/App.vue` 的 `applyNameDialog`/`confirmDelete`：三条落盘路径加 `recordFileCommand(commands(), { name, groupId, steps:[fileUndo.createStep|deleteStep|moveStep(...)] })`（W2' 原样，关掉 pv/command ⑤）。
3. `src/App.vue`/`FileTree.vue`：把 `activePaneId` 透给 `FileTree` 按窗格选 `buildPackageView` 行表（数据层已备），并在行渲染处接 `workspaceLifecycle.syntheticIcon` 与 `projectTreeDecorations.nodeDecorationFor`（W-1/W-2）。
