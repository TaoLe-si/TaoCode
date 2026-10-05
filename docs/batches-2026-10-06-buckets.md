# 15 桶任务分配表 · 2026-10-06（一次性全量移植批次）

> 派单用的**唯一归属依据**。每桶只能写「我拥有」那一栏 + 自己前缀的新文件；其余一律只读。
> 需要动保留文件或别人名下的文件 ⇒ **交接线请求**（格式见 §4），不许自己动手。
> 主代理只做两件事：**验证交付** + **统一接线**。

## 0. 基线（主代理 2026-10-06 实测）

| 项 | 值 |
|---|---|
| 分支 / HEAD | `parity/rebuild-inventory` / `63056b7` |
| 工作区 | 925 处改动（269 modified + 656 untracked），**全部未提交** |
| `npx vue-tsc -b --force` | **0 错** |
| `npm test` | **3723 用例 / 3706 通过 / 17 失败** |
| `ctest` | 上一轮 37/37，本轮 native 有改动 ⇒ 待重跑 |
| 规模 | 522 个 `src/*.ts` · 117 个组件 · 99 个 `native/*.cpp` · 463 个测试文件 |

**17 条红的归属**（各桶必修，见每桶「必修」栏）：
`tests/b7-verdict.test.mjs`（5 条）· `tests/editor-custom-fold-regions.test.mjs`（4 条）
· 折叠设置交给控制器（1 条）· `tests/about.test.mjs`（1）· `tests/internal-errors.test.mjs`（1）
· `tests/main-toolbar-render.test.mjs`（整文件）· 状态栏 editor-based 判据（1）
· `tests/tool-view-activation.test.mjs`（整文件，20 s 超时）· `tests/ui-motion.test.mjs` hover 过渡（1，主代理处理）

## 1. 保留文件（只有主代理能改）

`src/App.vue` · `src/components/CodeEditor.vue` · `src/style.css` · `src/tokens.css` · `src/uiIcons.ts`
· `src/settingsModel.ts` · `src/settingsTreeMeta.ts` · `src/bridge.ts` · `src/bridgePreview.ts` · `src/bridgeError.ts`
· `src/keymap.ts` · `src/keymapBindings.ts` · `src/actionRegistry.ts` · `src/menus/types.ts` · `src/menus/submenuState.ts`
· `tests/module-size.test.mjs` · `tests/source-citations.test.mjs` · `CMakeLists.txt` · `package.json` · `tsconfig.json`

**为什么**：15 个 agent 共用一棵树，这些是全仓争用最凶的装配面/注册面，同时改必冲突。
`App.vue` 余量极小 ⇒ **逻辑一律进你自己的新文件，组件里只做接线**。

## 2. 归属规则

- **新文件前缀**是你独占的命名空间；前缀之外的新文件 = 撞名风险，不要建。
- 「我拥有」列的是**已存在**文件（按名字前缀族列出，`ls` 一下就能看到全集）。
- 未列出的文件一律只读。判词里引用的落点若在别人名下 ⇒ 交请求。

---

## 桶 1 · 重构 / 生成 / 代码风格 / 格式化

- **族**（`docs/inventory/verdict-platform_rest.md`）：`lp/refactoring` `lp/unwrap` `lp/generation` `lp/ide-shell` `cs/settings` `lp/formatting` `csi/formatter` `cs/formatting-api`
- **新文件前缀**：`src/refactor*` `src/rename*` `src/codeStyle*` `src/format*` `tests/refactor-*`
- **我拥有**：`src/semanticActions.ts` `src/refactorPreview.ts` `src/renamePreview.ts` `src/safeDelete.ts` `src/unwrap.ts`
  `src/generateRefactor.ts` `src/surround*.ts` `src/assertionView.ts` `src/codeStyleSettings.ts` `src/formatterTags.ts`
  `src/formatting*.ts` `src/postFormatProcessors.ts` `src/memberMove*`（若无就新建）`src/menus/refactorMenu.ts`
  `src/menus/codeMenu.ts` `src/components/RefactorPreviewDialog.vue` `tests/refactor*` `tests/safe-delete*`
  `tests/surround*` `tests/unwrap*` `tests/generate*` `tests/format*` `tests/code-style*`
- **红线**：`RefactorPreviewDialog` 的挂载点在 `App.vue`（接线请求 A3）；`semanticActions.ts` 的 junit 挂点在桶 2/11 名下。

## 桶 2 · 补全 / 意图 / 检查 / 问题视图

- **族**：`lp/completion` `pf/inline-completion` `lp/intention` `lp/preview` `an/completion` `dm/quickfix`
  `dm/problems-view` `dm/highlight` `dm/annotator` `dm/inspections` `lp/inspections` `an/highlighting` `ls/highlighting`
- **新文件前缀**：`src/completion*` `src/intention*` `src/inspection*` `src/problem*` `src/annotator*` `tests/completion-*`
- **我拥有**：`src/lspCompletion*.ts` `src/completion*.ts` `src/inlineCompletion*.ts` `src/cyclicWordCompletion.ts`
  `src/moniker.ts` `src/intentionPreview.ts` `src/intentionSettings.ts` `src/localIntentions.ts` `src/localSuppressions.ts`
  `src/previewSettings.ts` `src/literalPreview*.ts` `src/problems*.ts` `src/inspectionProfile*.ts` `src/inspectionReport.ts`
  `src/annotator*.ts` `src/highlightLevels.ts` `src/highlightPasses.ts` `src/highlightSettingsPerFile.ts`
  `src/lspHighlightingCache.ts` `src/lspPerFileCache.ts` `src/editorSemantic*.ts` `src/editorDiagnosticMarkers.ts`
  `src/internalErrors.ts` `src/workspaceInspection.ts` `src/workspaceDiagnostics.ts` `src/errorReport.ts`
  `src/components/ProblemsPanel.vue` `src/components/InspectionProfileSwitcher.vue` `src/components/BinaryViewer.vue`
  `native/lsp_code_actions.cpp` `native/diagnostics.cpp`
- **必修**：`tests/internal-errors.test.mjs`（芯片必须是自包含组件）
- **接线请求 B1/B2/F**（`bridge.ts` 的 `LspDiagnostic.code/tags` 在保留文件；`junitQuickFix` 挂点在桶 11）

## 桶 3 · 文档 / CodeVision / 内联提示 / 语言服务面

- **族**：`lp/documentation` `ls/documentation` `lp/code-vision` `lp/inlay-hints` `ls/platform` `ls/session`
  `ls/features` `ls/completion` `ls/code-lens`
- **新文件前缀**：`src/doc*` `src/quickDoc*` `src/codeLens*` `src/inlay*` `src/ls*` `tests/doc-*`
- **我拥有**：`src/documentationView.ts` `src/hoverDocumentation.ts` `src/quickDoc*.ts` `src/quickDefinition*.ts`
  `src/codeLens*.ts` `src/codeVisionProviders.ts` `src/inlayHint*.ts` `src/editorInlayHints.ts` `src/documentLinks*.ts`
  `src/markdown*.ts` `src/htmlExport*.ts` `src/lsFeaturesWidget.ts` `src/lsSessionState.ts` `src/lsSessionDocuments.ts`
  `src/lspFeatureMatrix.ts` `src/lspProgress.ts` `src/lspServerLog.ts` `src/lspSymbolBridge.ts` `src/lspWarmup.ts`
  `src/lspCapability*`（前端侧）`src/components/QuickDocPopup.vue` `src/components/QuickDefinitionPopup.vue`
  `src/components/MarkdownPreview.vue` `src/components/ExportToHtmlDialog.vue` `native/lsp*.cpp`（除 `lsp_code_actions.cpp`）
- **必修/跟进**：接线请求 A1 + C1 + H1（快速文档弹层挂载与样式）；`src/lsSessionDocuments.ts:33` 若仍红一并修
- **红线**：`CodeEditor.vue` 的 hover 通道是保留文件 ⇒ 交请求

## 桶 4 · 导航 / 用法 / 层级 / 最近位置

- **族**：`lp/navigation` `ls/navigation` `lp/hierarchy` `ls/hierarchy` `ixa/find-usages` `lp/usage-view`
  `lp/highlighting` `rf/core`
- **新文件前缀**：`src/nav*` `src/usage*` `src/hierarchy*` `src/recent*` `tests/nav-*`
- **我拥有**：`src/lspNavigation.ts` `src/declarationNavigation.ts` `src/findResultsNav.ts` `src/gotoNextError.ts`
  `src/hierarchy*.ts` `src/usage*.ts` `src/referenceContents.ts` `src/nonCodeUsages.ts` `src/breadcrumbs.ts`
  `src/navBarModel.ts` `src/navToolbar*.ts` `src/recent*.ts` `src/manageRecentsHost.ts` `src/selectIn*.ts`
  `src/chooseTarget*.ts` `src/symbolSearch.ts` `src/fileBreaks*`（若无就新建）`src/menus/navigateMenu.ts`
  `src/components/BreadcrumbsBar.vue` `src/components/SelectInPopup.vue` `native/lsp_navigation.cpp`
- **必修/跟进**：接线请求 A2 + C2（面包屑挂载与四档色）
- **红线**：`App.vue` 的 `.breadcrumbs` 两处内联模板是保留文件 ⇒ 交请求

## 桶 5 · 编辑器输入 / 折叠 / 编辑器对象与标签

- **族**：`lp/editor-actions` `lp/custom-folding` `lp/sticky-lines` `pf/clipboard` `pf/file-editor`
  `lp/file-editor` `ici/file-editor` + `docs/inventory/verdict-folding.md` 全域
- **新文件前缀**：`src/editor*`（除保留的 `CodeEditor.vue`）`src/folding*` `src/clipboard*` `tests/folding-*`
- **我拥有**：`src/editorTyping.ts` `src/editorCommands.ts` `src/editorBrackets.ts` `src/editorPaste.ts`
  `src/paste*.ts` `src/clipboard*.ts` `src/editorWhitespace.ts` `src/editorLineNumbers.ts` `src/editorIndentGuides.ts`
  `src/editorOverwrite.ts` `src/editorLanguage.ts` `src/editorSideViews.ts` `src/editorFolding*.ts`
  `src/customFolding*.ts` `src/stickyLine*.ts` `src/commentToggle.ts` `src/editorExtendSelection.ts`
  `src/editorStatementMove.ts` `src/bidi*.ts` `src/enterHandlers.ts` `src/smartEnter.ts` `src/editorTab.ts`
  `src/editorTabDoubleClick.ts` `src/editorSplits.ts` `src/editorGroups.ts` `src/editorFocus.ts`
  `src/editorHint.ts` `src/editorFileOps.ts` `src/components/CodeFoldingSettingsPage.vue` `src/components/BinaryViewer.vue 除外`
  `src/menus/editMenu.ts` `native/folding_state_schema.cpp` `native/folding_state_test.cpp`
- **必修**：`tests/editor-custom-fold-regions.test.mjs`（4 条）+「编辑器把代码折叠设置交给折叠控制器」（1 条）

## 桶 6 · 状态栏 / 进度 / 通知 / 诊断转储

- **族**：`pf/progress` `ici/progress` `pf/error-tree` `pf/diagnostics` `pf/troubleshooting`
  `pv/notification` `pf/audio-cues`
- **新文件前缀**：`src/status*` `src/progress*` `src/notice*` `src/notification*` `src/errorTree*` `tests/progress-*`
- **我拥有**：`src/statusBarText.ts` `src/statusBarWidgets.ts` `src/statusWidgets.ts` `src/statusBarLifecycle.ts`
  `src/statusBarNav.ts` `src/memoryWidget.ts` `src/progress*.ts` `src/backgroundTasks.ts` `src/errorTree.ts`
  `src/errors.ts` `src/troubleshootingCollectors.ts` `src/notice*.ts` `src/notification*.ts` `src/audioCue*.ts`
  `src/aboutInfo.ts` `src/components/EventLogPanel.vue` `src/components/NoticeList.vue`
  `src/components/AudioCuesSettingsPage.vue` `src/components/InternalErrorsChip.vue` `tests/about*`
  `tests/status-*` `tests/progress-*` `tests/notification-*` `native/event_channel.cpp`
- **必修**：`tests/about.test.mjs`（关于带构建号）、状态栏「editor-based 的能不能开是菜单那一侧判据」那条
- **红线**：`App.vue` 状态栏区域是保留文件 ⇒ 交请求

## 桶 7 · 平台外壳 / 生命周期 / 对话框 / 注册表 / 向导

- **族**：`pf/lifecycle` `ici/project` `pm/project` `pf/platform-ide` `pf/startup` `ic/application`
  `pf/openapi-ui` `ic/dialogs` `pf/general-settings` `pf/registry` `ic/wizard` `pf/wizard`
- **新文件前缀**：`src/platform*` `src/lifecycle*` `src/dialog*` `src/project*`（除桶 15 名下的 `projectRoots/projectFileIndex/projectTree*/projectViewBehavior`）`tests/platform-*`
- **我拥有**：`src/workspaceLifecycle.ts` `src/projectLocator.ts` `src/projectDirectories.ts` `src/projectExtras.ts`
  `src/projectBuild.ts` `src/projectPath.ts` `src/application*.ts` `src/preloadingActivities.ts`
  `src/startupActivities.ts` `src/platformIdeStartupFailure.ts` `src/generalSettings*.ts` `src/registryKeys.ts`
  `src/dialogGeometry.ts` `src/dialogValidation.ts` `src/messageDialog.ts` `src/wizard.ts` `src/settings*.ts`
  （除 `settingsModel.ts`/`settingsTreeMeta.ts` 两个保留文件）`src/environmentKeys.ts` `src/languageRuntimes.ts`
  `src/languages.ts` `src/aboutDialog 相关` `src/components/ProjectDialog.vue` `src/components/ColorChooserDialog.vue`
  `src/components/GeneralRegistryToggles.vue` `src/components/SpecialPathsDialog.vue` `src/components/TemplateSettingsPage.vue`
  `src/menus/windowMenu.ts` `src/menus/helpMenu.ts` `native/dialogs*.cpp` `native/settings_schema.cpp`
  `native/settings_transfer.cpp` `native/projects.cpp` `native/projects_test.cpp`
- **必修**：`tests/main-toolbar-render.test.mjs`（整文件）、`tests/b7-verdict.test.mjs`（5 条：§G 覆盖率/多余类/真实文件依据/testSources/四档计数）
  —— b7 域 = `docs/inventory/actions.txt` 那 317 类，判词文件被 `scripts/verdict_table.py` 重写后与门禁失配，先复算再改判词表

## 桶 8 · 工具窗口 / 标签条 / 弹层 / 拖放

- **族**：`docs/inventory/verdict-toolwindow-openapi.md` 的全部 `[~]`（97 条）·
  `verdict-ui-tabs-popup.md` 的 GAP 行（`JBTabsPosition` `JBTabsPresentation` `MorePopupAware` `TabLayout`
  `AbstractPopup` `PopupDispatcher` `WizardPopup` `ListPopupModel` `AsyncPopupStep`）· `pf/dnd` `ic/dnd` `lp/scratch`
- **新文件前缀**：`src/tool*` `src/tab*` `src/popup*` `src/dnd*` `src/scratch*` `tests/tool-*`
- **我拥有**：`src/toolWindow*.ts` `src/tool*.ts` `src/tab*.ts`（除桶 5 的 `editorTab*`/`editorSplits`/`editorGroups`）
  `src/editorSplits 除外` `src/popup*.ts` `src/speedSearch.ts` `src/stripeResize.ts` `src/panelResize.ts`
  `src/dragAndDropTargets.ts` `src/dndModel.ts` `src/scratchFiles.ts` `src/scratchHistory.ts` `src/fileColors*.ts`
  `src/components/ToolStripe.vue` `src/components/ToolWindow*.vue` `src/components/TabContextMenu.vue`
  `src/components/TabEntryPoint.vue` `src/components/ContentComboLabel.vue` `src/components/SpeedSearchBar.vue`
  `src/components/AnchoredMenu.vue` `src/menus/toolWindowGear.ts` `src/menus/viewMenu.ts`
- **必修**：`tests/tool-view-activation.test.mjs`（整文件 20 s 超时 —— 先判断是死等还是真慢，别加 timeout 掩盖）

## 桶 9 · 搜索 / 替换 / 结构化搜索 / diff

- **族**：`se/ui` `ss/ui` `ss/matcher` `ss/replace` `lp/text-search` `lp/run-anything` `vc/diff`
  + `verdict-find-diff.md` 全域
- **新文件前缀**：`src/search*` `src/find*` `src/structural*` `src/everywhere*` `src/diff*` `src/merge*` `tests/search-*`
- **我拥有**：`src/search*.ts` `src/find*.ts` `src/structural*.ts` `src/regexReplacement.ts` `src/fuzzyMatch.ts`
  `src/commandSearch.ts` `src/runAnything*.ts` `src/editorSearch*.ts` `src/editorFindController.ts` `src/patch*.ts`
  `src/diff*.ts` `src/compareFiles.ts` `src/merge*.ts` `src/consoleFold.ts` `src/chooseTarget 除外`
  `src/components/SearchPanel.vue` `src/components/SearchEverywhere*.vue` `src/components/RunAnythingDialog.vue`
  `src/components/EditorFindBar.vue` `src/components/DiffView.vue` `src/components/MergeBar.vue`
  `src/components/ChangedHunks.vue` `native/search*.cpp` `native/history_diff.cpp`
- **红线**：`RunAnythingDialog` 的 `@run-command` 在 `App.vue`（A9 执行侧 cwd 属桶 10）

## 桶 10 · 运行实例 / 控制台 / 终端 / 大文件

- **族**：`exec/run-instances` `exec/ui` `exec/run-toolbar` `exec/console` `exec/target`
  `ex/terminal` `ex/terminal-actions` `lp/large-files`
- **新文件前缀**：`src/run*` `src/exec*` `src/terminal*` `src/largeFile*` `tests/run-*`
- **我拥有**：`src/run*.ts`（除 `runAnything*.ts` 属桶 9）`src/executionTargets.ts` `src/runTargets.ts`
  `src/terminal*.ts` `src/largeFile*.ts` `src/process*.ts` `src/console*.ts` `src/sessionEncodings.ts`
  `src/components/RunConsole.vue` `src/components/RunningDot.vue` `src/components/TerminalPanel.vue`
  `src/menus/runMenu.ts` `native/run_host*.cpp` `native/runner*.cpp` `native/terminal*.cpp`
  `tests/run-*` `tests/terminal-*` `tests/console-*`
- **接线请求 A5/D1**（`settingsModel.ts` 的 `RunConfig.type` 加 `'jar'` 是保留文件 ⇒ 交请求）

## 桶 11 · JUnit / 测试框架 / 运行配置 / 构建

- **族**：`exec/junit` `exec/junit-inspection` `exec/sm-runner` `exec/filters` `exec/testframework`
  `exec/run-configs` `exec/configurations-types` `exec/actions` `lp/build`
- **新文件前缀**：`src/junit*` `src/test*` `src/build*` `src/runConfig*` `tests/junit-*`
- **我拥有**：`src/junit*.ts` `src/test*.ts` `src/build*.ts` `src/runConfig*.ts` `src/runCompound.ts`
  `src/runConfigurationSchema.ts` `src/runConfigurations.ts` `src/coverageReport.ts` `src/autoTest.ts`
  `src/exceptionInfo 除外` `src/components/TestRunnerPanel.vue` `src/components/RunConfigurationsDialog.vue`
  `src/menus/buildMenu.ts` `src/menus/toolsMenu.ts 除外` `native/runner.cpp 除外`（native 侧构建相关只改 `native/java_run_host_regression_test.cpp` 这类测试）
- **接线请求**：`runConfigEditors.ts` + `runConfigTree.ts` 与 `settingsModel.ts` 的 `'jar'` 必须**同一次**改（单改保留文件会 TS2741）

## 桶 12 · 调试（DAP / 断点 / 求值）

- **族**：`dbg/frames-vars` `dbg/attach` `dbg/actions` `dbg/breakpoints` `dbg/evaluate` `dbg/settings` `dbg/inline`
- **新文件前缀**：`src/dbg*` `src/debug*` `src/breakpoint*` `tests/dbg-*`
- **我拥有**：`src/debug*.ts` `src/breakpoint*.ts` `src/exception*.ts` `src/editorDebugLine.ts`
  `src/editorInlineValues.ts` `src/inlineDebugValues.ts` `src/sessionSnapshot.ts`
  `src/components/Debug*.vue` `src/components/DebuggerSettingsPage.vue` `src/components/BreakpointsDialog.vue`
  `src/components/DebugClipboardCompare.vue` `native/dap*.cpp`（全部 7 个）
- **接线请求 A5/E**（App.vue 的调试器装配、CodeEditor.vue 的悬停求值通道）

## 桶 13 · VCS / 提交 / 书签 / 分析范围 / 依赖分析

- **族**：`vc/log-ui` `vc/changes` `vc/util` `vca/vcs-util` `lp/analysis-ignore` `lp/analysis-scope`
  `lp/package-deps` `an/package-deps` + `verdict-vcs-commit.md` + `verdict-bookmarks.md`
- **新文件前缀**：`src/vcs*` `src/commit*` `src/bookmark*` `src/analysis*` `src/scope*` `tests/vcs-*`
- **我拥有**：`src/vcs*.ts`（12 个 `vcsLog*` 全在内）`src/changes*.ts` `src/commit*.ts` `src/amendMessage.ts`
  `src/branchPopup.ts` `src/sourceControlCommitChecks.ts` `src/bookmark*.ts` `src/analysis*.ts` `src/scopes.ts`
  `src/packageDeps*.ts` `src/dependencyAnalyzer.ts` `src/blameAnnotations.ts` `src/patchExport 除外`
  `src/components/SourceControl.vue` `src/components/VcsLog*.vue`（12 个）`src/components/BranchPopup.vue`
  `src/components/BookmarksPanel.vue` `src/components/Bookmark*.vue` `src/components/ScopesSettingsPage.vue`
  `src/components/PackageDepsDialog.vue` `src/components/DependencyAnalyzerDialog.vue` `src/menus/gitMenu.ts`
  `native/git*.cpp`（8 个）`native/trusted_paths.cpp`
- **不做**（有上游依据，别翻案）：提交列表按天/作者/仓库分组、Git Log 过滤器历史、
  「改某一次具体提交」下拉（`GitAmendSpecificCommitSquasher.kt:36-76` 是内存内 autosquash）

## 桶 14 · 项目视图面板（欢迎页 / 结构 / 历史 / TODO / 文件树）

- **族**：`pv/project-view-nodes` `pv/welcome` `pv/structure-view` `pv/history` `pv/todo` `pv/command`
  `pv/project-view` `pv/bookmarks-alias` `pf/file-chooser` `pf/trusted` `pf/browsers`
- **新文件前缀**：`src/pv*` `src/welcome*` `src/structure*` `src/history*` `src/todo*` `src/fileChooser*`
  `tests/pv-*`
- **我拥有**：`src/welcomeProjects.ts` `src/welcomeProjectColor.ts` `src/projectTree*.ts` `src/projectViewBehavior.ts`
  `src/projectTreeDecorations.ts` `src/outlineView.ts` `src/historyFollow.ts` `src/todo*.ts` `src/explorerActions.ts`
  `src/fileChooser*.ts` `src/trustedProjects.ts` `src/browsers.ts` `src/copyPathActions.ts` `src/fileColorsHost 除外`
  `src/components/WelcomePage.vue` `src/components/FileTree.vue` `src/components/OutlinePanel.vue`
  `src/components/HistoryPanel.vue` `src/components/TodoPanel.vue` `src/components/TodoPatternsPage.vue`
  `src/components/FileChooserDialog.vue` `src/components/TrustedLocationsSettingsPage.vue`
  `src/components/TrustedProjectDialog.vue` `src/components/ProjectViewSortSettings.vue`
  `src/components/ProjectStructureDialog.vue` `src/components/ProjectStructurePane.vue`
  `src/menus/fileMenu.ts` `native/history*.cpp` `native/workspace_tree_ops.cpp`
- **接线请求 A4/A7**（状态栏 profile 切换属桶 2；`FileChooserDialog` 挂载点在 `PluginDialog`/`App.vue`）

## 桶 15 · 项目模型 / 外部系统 / 根与 SDK / 文件面 / VFS

- **族**：`lp/roots` `pm/roots` `pm/file-index` `an/module` `pf/roots-ui` `es/project-model` `es/ui`
  `es/execution` `es/actions` `es/autoimport` `es/dependency` `esa/model` `esa/autoimport`
  `lp/microservices` `lp/external-tools` `lp/file-types` `ic/file-types` `pf/file-types` `lp/exclude`
  `pf/vfs` `ic/vfs` `lp/file-templates` `ici/file-templates` `pf/plugins` `ic/plugins` `pf/action-macro`
- **新文件前缀**：`src/ext*` `src/roots*` `src/fileType*` `src/library*` `src/macro*` `tests/ext-*`
- **我拥有**：`src/gradle*.ts` `src/external*.ts` `src/library*.ts` `src/rootsSdkTable.ts` `src/orderRoots.ts`
  `src/moduleScopes.ts` `src/projectRoots.ts` `src/projectFileIndex.ts` `src/fileType*.ts` `src/fileTypes.ts`
  `src/filenameWidget.ts` `src/endpointIndex.ts` `src/endpointRoutes.ts` `src/fileTemplate*.ts`
  `src/macroHost.ts` `src/macros.ts` `src/plugin*.ts` `src/templates.ts` `src/templateModel*`
  `src/diskSync.ts` `src/watcher 相关前端` `src/components/GradlePanel.vue` `src/components/GradleSettingsPage.vue`
  `src/components/ExternalToolsSettingsPage.vue` `src/components/FileTypesPage.vue`
  `src/components/FileTemplatesSettingsPage.vue` `src/components/EndpointsDialog.vue`
  `src/components/PluginDialog.vue` `src/components/PluginMarketPanel.vue` `src/components/MacrosDialog.vue`
  `src/components/MacroRecordingChip.vue` `src/components/BuildToolsSettingsPage.vue`
  `src/menus/macrosMenu.ts` `native/gradle*.cpp` `native/plugins*.cpp` `native/workspace.cpp`
  `native/workspace_test.cpp` `native/library_sources*.cpp` `native/java_lsp_paths*.cpp` `native/jdk*.cpp`
  `native/jdtls*.cpp` `native/watcher*.cpp` `native/zipstore.cpp`
- **必修**：`src/macroHost.ts:53/:137` 若仍报类型错就修（上轮快照里的残留）

---

## 3. 每桶的交付要求（一条不许少）

1. **把族判词里的「缺：」逐条做完**，或给出**具体**卡点（缺哪个后端/哪个 LSP 请求不提供/哪层架构不成立）。
   「太复杂」「本轮先到这」不算卡点。
2. **架构不等价 ⇒ 用本仓架构还原功能**（桃 2026-10-05 明确指示）。
   找上游那个行为**对用户可见的一面**，在 Vue/C++ 里做出来；照抄几何/字号/键位/文案/默认档，
   不照抄 Swing/Compose 组件结构与 DI 容器。交付时写清「本仓用什么等价物承接了上游的什么」。
3. **每条判词给上游「相对路径:行号」**，指不到就写「无法核实」。基准树只有一棵：
   `D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
   「按文件名搜不到」≠「功能不存在」⇒ 包路径 / 语义 / XML 里的 `id` 三条路各搜一遍再下结论。
4. **不放假控件**：没有后端或没有消费链路的项一律不渲染。
5. **每个新行为配判据测试**；新门禁必须**反向验证**（注入违规确认真的会红，再撤掉）。
6. **验证只跑自己域的测试**（`node --test tests/<你的>*.test.mjs`）+ 增量 `npx vue-tsc -b`；
   全量由主代理跑。**native 改动必须给 ctest 结果**（用 `.tools/nctest-all.bat`，先 `call vcvars64.bat`）。
7. 三条系统性禁令：**TS 参数属性** / **`.mjs` 里混 TS 语法** / **相对 import 漏 `.ts` 扩展名** ——
   症状都是「整个测试文件加载失败」。收工前跑 `node .tools/find-param-props.mjs`
   `node .tools/find-ts-in-mjs.mjs` `node .tools/find-missing-ext.mjs` 三个检测器。
8. 新文件不超 `tests/module-size.test.mjs` 的默认上限（ts 900 / native 1100 / `_test.cpp` 1300）；
   超了继续拆，**不许调上限**。

## 4. 接线请求格式（需要动保留文件时）

```
## 接线请求（给主代理）
- 目标文件：src/App.vue 第 N 行附近
- 要接什么：<你导出的函数/组件> 接到 <哪个事件/插槽>
- 为什么需要：<一行>
- 上游依据：<相对路径:行号>
```

## 5. 报告格式

```
## 判词
| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |

## 改动文件
## 验证
## 接线请求
## 做不到 / 无法核实
```

「无法核实」和「有意不做」如实保留，不要为了凑完成度而改。
