# 批 · 2026-10-06 b10judge —— 桶 10 六条接线请求的判定复核 + 一条真判据

代号 `b10judge`。任务 = 把 `docs/wiring-requests-2026-10-06-b10audit.md`（`b10*` 只有这一份）交付给主代理的
6 条**逐条重判**：每条都重新打开它引用的本仓行（按字符串定位，行号一律重测）与上游那一行（自己 `sed`/`grep -n` 开的），
再判 `已闭环 / 该主代理接 / 该模块侧做 / 前提不成立` 四类之一。另外复核主代理点名的三条坐标，
并落一条"宿主没接 ⇒ 界面上这一格不出现 / 接了 ⇒ 出现"的可执行判据（见 §3）。

**本保留文件清单按本次派单**：`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`
⇒ 只有落点在这四个文件里才算「该主代理接」。**本轮一个保留文件都没动**（反向验证用的是内存副本，见 §3.3）。

**坐标时效**：共享工作树，`src/App.vue` 在我这轮期间从 2690 → 2706 行、终端挂载从 `:2321` 漂回 `:2304`、
`runAnythingModuleRoots` 从内联 for 循环被重构成 `gradleSubprojectRoots(...)`（App.vue:1874）。
下表"实测坐标"= 本文写完前的最后一次统一重测（13:35–13:45 本地时间），**引用请以字符串锚点为准**。

---

## 1. 判定表（6 条 + 主代理点名要核的第 7 行）

| # | 原请求号 | 原写坐标（请求文档里的） | 实测坐标（本轮重测） | 上游依据（我亲自打开过那一行） | 判定 | 交付 |
|---|---|---|---|---|---|---|
| 1 | bucket10b 第 1 条 / b10audit §1 —— Run Anything 执行上下文 cwd | `src/App.vue:2635`、`RunAnythingDialog.vue:17/:43`、`runActions.ts:462/:486`、"runAnythingContext.ts 零消费方"、"上游 `platform/execution-impl/.../execution/runAnything/` find 命中 0 ⇒ 无法核实" | `src/App.vue:2667`（挂载：`:module-roots="runAnythingModuleRoots"` + 第三参 `payload.cwd`）、`src/App.vue:1874`、`src/components/RunAnythingDialog.vue:32/:35/:48/:50/:58-76/:97-98/:125-136`、`src/runActions.ts:475/:499`、`src/runAnythingContext.ts:80/:119/:160/:218`（已被弹层 import，不再是孤儿） | `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingChooseContextAction.kt:62-78`（`:65-68` 表空就隐藏、`:73` 没选取第一档、`:76` 文字=选中项 label）、同文件 `:235-240`（allContexts）、`:242-249`（`:247` 模块只有一个就不列）、`RunAnythingContextUtils.kt:14-21`（`:15-17` 项目根、`:18` `guessModuleDir()`、`:20` 「浏览…」返回 null）、`RunAnythingPopupUI.java:796`（`createHeader()`）/`:804`/`:826`、`RunAnythingRunConfigurationProvider.java:56-58`（配置行给空上下文表）、`platform/platform-api/resources/messages/IdeBundle.properties:1186`/`:1189` | **已闭环**（主代理 §11.4/§11.5 落的，落地形状经核一致） | 订正文案见 §2.1（含 b10audit 那句"上游无法核实"是**找错目录**的实证） |
| 2 | bucket10b 第 2 条 / b10audit §2 —— 终端两格设置（Ctrl+滚轮总闸 / 基准字号） | `src/App.vue:2272`、`settingsModel.ts:462-465`+`:223`、`TerminalPanel.vue:89/:326/:318/:120-121/:308/:535/:546/:704`、`SettingsDialog.vue:918`、`settings_schema.hpp:13/:44-51`、`settings_schema.cpp:419`、`previewSettings.ts:40-41`、"四处成对" | `src/App.vue:2304`（`:settings="editorSettings"`）、`src/App.vue:482` + `:690`（那本活账的初值与回包替换）、`src/settingsModel.ts:527`/`:539`（接口）+ `:265`（缺省 `wheelFontChangeEnabled: false, terminalBaseFontSize: 13`）、`native/settings_schema.hpp:102-117`、`native/settings_schema.cpp:419`、`native/settings_editor_keys.hpp:63-72`（**值域分支**）、`src/previewSettings.ts:52`/`:58`、`src/components/TerminalPanel.vue:66`（props）/`:115`（fallback false）/`:121-124`（4..40 不采纳越界）/`:156-157`/`:344`/`:354`/`:363`/`:573`/`:584`/`:719`、`src/components/SettingsDialog.vue:736`（两格 + `editor-terminal-font-hint`） | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124` = `    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter `:1043`、setter `:1047`；同文件 `:125` 的 `IS_WHEEL_FONTCHANGE_PERSISTENT = false` 管"写不写回设置"，本仓缩放是会话内的 ⇒ 不落）、`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382-386`、`platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`（`scale(4)`）/`:15-17`（`ide.editor.max.font.size` 默认 40）、`platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94`（`enableWheelFontChange`）/`:214`（组名）/`:216`（挂点）、`platform/ide-core/resources/messages/ApplicationBundle.properties:395` = `Mouse Control`、`:396` = `Change font size with Ctrl+Mouse Wheel in:`、`:397`（mac 变体）、`platform/execution-impl/src/com/intellij/terminal/TerminalUiSettingsManager.kt:104-109`/`:123-128`（`detectFontSize()`）/`:130-132`、`platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsUtils.kt:21-22`、`TerminalFontSizeProvider.kt:14`/`:16-20`/`:22-25` | **已闭环**（六处成对 + 面板取数 + 设置页两行 + 宿主挂载全部落完） | 订正文案见 §2.2（"四处成对"实际是**七处**；宿主那一行**当时没有任何判据** ⇒ 本轮补，见 §3） |
| 3 | bucket10b 第 3 条 / b10audit §3 —— ANSI 16 色逐色号自定义 | `TerminalPanel.vue:294`、`RunConsole.vue:145`、"设置键建议存 general 档"、`ColorSchemeSettingsPage.vue` 是零消费方 | 模块侧在：`src/terminalColors.ts:81`（`TerminalAnsiOverrides`）/`:100`（签名）/`:104`（第四参）/`:111`（取值）。面板侧**也在**：`src/components/TerminalPanel.vue:66`（`ansiOverrides?`）/`:330`（第四参）/`:726`（换了就重算）、`src/components/RunConsole.vue:114`/`:160`/`:162`（两支都传）。**缺的是供给侧**：`grep -rn terminalAnsiColors src native tests` ⇒ 只命中 `src/components/RunConsole.vue:108` 的一句注释；`src/settingsModel.ts:213`（general 接口尾）/`:263`（缺省）无该键、`native/settings_schema.hpp:120-159`（`GENERAL_SETTING_KEYS`）无、`native/settings_schema.cpp:183`（general 默认）/`:216`（校验分支）无、`src/bridgePreview.ts:266-272` 的 general `accepted` 链无、16 格 UI 无（`src/components/ColorSchemeSettingsPage.vue` 实测**仍在**孤儿清单里） | `platform/execution-impl/src/com/intellij/terminal/JBTerminalSchemeColorPalette.kt:12-16`/`:17-21`（默认前后景，本仓已有的那两参）/`:23-25`（每取一个色号都回 `EditorColorsScheme` 要键）、`platform/platform-api/src/com/intellij/execution/process/ColoredOutputTypeRegistryImpl.java:160-165`（`:161` 对 `value >= 16` 直接退回 `NORMAL_OUTPUT_KEY` ⇒ 这张表天生只有 0..15） | **该模块侧做**（先落供给侧 R-4 六处），落完后**该主代理接**（两行挂载，片段见 §4.3）。主代理 §11.2 主动**不带** `:ansi-overrides` 是对的 ⇒ 那条不算缺陷 | 可照抄挂载 + 前置条件；现状是"面板有入参、没人喂"的**空口半边**，但界面没有假格子（无 16 格 UI、无设置键） |
| 4 | bucket10b 第 4 条 / b10audit §4 —— 大文件模式动作替换 | `CodeEditor.vue:853-868`（`:854/:856/:857/:861/:867/:868`）、`:129`、`:1099`/`:1106`、`editMenu.ts` 的 enabled、`EditorFindBar.vue:38/:183/:213-214` | 模块侧在：`src/largeFileMode.ts:66`（八条禁用表）/`:72`/`:81`/`:88`。**分发层零消费**：`grep -rn "largeFileCommandAllowed|largeFileCommandGate|LARGE_FILE_DISABLED_COMMANDS" src/` ⇒ 除声明处外**只有 tests/**。实测待改点：`src/components/CodeEditor.vue:848`(`Mod-r`)、`:850`(`Ctrl-F3`)、`:851`(`Ctrl-Shift-F3`)、`:855`(`Alt-Shift-j`)、`:861`(`Alt-j`)、`:862`(`Ctrl-Shift-Alt-j`)、命令面 `:698-703`、`:1104`（`:replace-mode`）、heavy 在 `:128-129`、import 在 `:87`；菜单面 `src/menus/editMenu.ts:81-91`/`:106` 走宿主 `ctx.editable`，其实现是 `src/App.vue:1416-1418`（`enabled: hasEditor`，**没有 gate**）；`navigate.gotoLine` 的键在 `src/keymapBindings.ts:110-111`（`when: editorWhen`，而 `KeyBindingState` 只有 workspace/editor/lsp 三档，见 `:26-30`）、派发在 `src/keymap.ts:387` → App.vue 的 `openGoLine`（`src/App.vue:1277` 解构），而**菜单行是另一个 id**：`src/menus/navigateMenu.ts:113` 的 `navigate.line`（`enabled: ctx.hasEditor`，不吃 `editable()`）；`EditorFindBar.vue:38`（`replaceMode`）/`:183`（切替换的按钮**恒渲染**）/`:186`（`v-if="replaceMode"`）/`:213-214` | `platform/lang-impl/src/com/intellij/largeFilesEditor/PlatformActionsReplacer.java:22`（类）、`:37` `HighlightUsagesInFile`、`:38` `GotoLine`、`:40-41` 换 FindNext/FindPrevious、`:47` 换 Find、`:48-53` 六条禁用（`:48` Replace、`:49` FindWordAtCaret、`:50` FindPrevWordAtCaret、`:51` SelectAllOccurrences、`:52` SelectNextOccurrence、`:53` **Unselect**PreviousOccurrence）、`:56-58`（`:57` = `addEditorActionHandler(actionId, LfeEditorActionHandlerDisabled::new)`）；`.../actions/LfeEditorActionHandlerDisabled.java:13`（类）/`:17`（构造）/`:30-36`（`isEnabledInLfe()`，`return false` 在 `:35`）；`.../actions/LfeEditorActionHandlerFind.java:12`（类）/`:26-32`（`return true` 在 `:31`） | **该主代理接**（`CodeEditor.vue` 那 7 处，可照抄见 §4.1）+ **该模块侧做**（`EditorFindBar.vue` 的「替换可用否」prop；`src/editorTab.ts` 的 `EditorHandle` 若要给 App/菜单层判 heavy 需成对加 `largeFile()`，见 §4.2） | 菜单那一半（`src/App.vue:1416`）我给了可照抄，但**有前置**：没有跨层的 heavy 出口时只能按内容长度现算（代价写在 §4.2） |
| 5 | bucket10b 第 5 条 / b10audit §5 —— 大文件「正则搜索不可用」提示 | 请求原文："勾选正则时提示不可用" + 渲染点=查找条 `role="status"` | `src/largeFileMode.ts:8`（「编辑、查找/替换、保存照常」）、`:34-35`（`LARGE_FILE_NOTICE` 里写着「查找替换仍可用」）、`src/editorSearchExtension.ts:62`（`collectSearchMatches(...)` **不传 limit**）/`:47`（`MAX_HIGHLIGHTS = 200`，与大文件无关）、`src/editorSearch.ts:127`（缺省 `limit = Infinity`）；`src/components/EditorFindBar.vue:34` 的 `status` 仍是「第 n / 共 m 条」，没被动过 | `platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileRegexSearchNotificationProvider.java:21`（类）、`:42-45`（`:44` = `largeFileEditor.getPageSize() / 500`）；`platform/platform-api/resources/messages/EditorBundle.properties:155` = `Regex search can''t find matches with length longer then {0} Kb` | **前提不成立**（b10audit 的结论复核成立，且我另核了两处它没写的：本仓确实没有分页模型，也没有可播报的正则上限） | 订正文案见 §2.5：从桶 10 清单**撤掉**，模块侧不加 `largeFileRegexNoticeText()` |
| 6 | bucket10b 第 6 条 / b10audit §6 —— `RunStartParams.elevate` | "目标文件 `src/bridge.ts` 的 `RunStartParams`"、`bridge.ts:109`、`native/main.cpp:1104-1112`、`native/run_host.hpp:35-39` | `src/settingsModel.ts:93`（`RunStartParams` **在这里**，`src/bridge.ts:71`/`:81` 只是 `export … from './settingsModel.ts'` 的转发 ⇒ 原请求的目标文件写错）；`grep -rin elevat src native tests`（去掉 CSS 变量 `--elevated` 后）**0 命中**；`native/main.cpp:1104-1112`（`:1110` 整包 `runs->start(params, …)`）、`native/run_host.hpp:35-43`（`struct Step` 只有 label/command/program/cwd/args/environment/shell，无提权档）；`src/bridge.ts:109` 的 `Method` 联合里 `run.start|run.write|run.stop|run.instances` ↔ `native/main.cpp:1104`/`:1113`/`:1121`/`:1123`（b10audit 写 `:1120`/`:1121`，实测后两条各漂 1–2 行）⇒ 现有 run.* 通道**没有假的那条**；`src/runActions.ts:94` 的 `runStartParams()` 只服务跑配置那条链，`runExternalTool`（`:499`）发的是内联对象 | `platform/execution-process-elevation/src/com/intellij/execution/process/elevation/`（整包 ls 到 5 个文件 + `settings/`）；`ElevationDaemonProcessLauncher.kt:28`（类）、`:30-36`（`:32` 注释 "instead of process stdio, and launch it in a trampoline mode"）、`:68-74`（`:71` = `it.copy(trampoline = true, daemonize = true, …)`） | **前提不成立**（两个前提同时死：① 落点写错文件；② 加字段收不到输出 —— 缺的是 daemon/管道那一层，不是参数） | 订正文案见 §2.6：登记为独立批次（含 `native/run_host.cpp` + `CMakeLists.txt` + 新增方法名时 `src/bridge.ts:109` 与 `native/main.cpp` 分派成对） |
| 7 | **主代理点名核**：`dialog.saveFile` + `app.writeExportFiles` 两跳导出（引用面板 / 层级面板的「导出到文本文件」到底哪条已接） | nav3 §N-1b 写 `src/App.vue:1356`/`:1358`（navigation2 更早写 `:1333-1337`） | **层级面板：已接**——按钮 `src/App.vue:2278`（`title="导出层级到文本文件（IDEA: Export to Text File）"`、`:disabled="!hierRows.length"`、`@click="void exportHierarchyToFile()"`）→ 函数 `src/App.vue:1380-1384`（`:1381` = `dialog.saveFile`、`:1383` = `app.writeExportFiles`）→ 内容 `src/hierarchyView.ts` 的 `exportCurrentHierarchy`/`hierarchyExportSummary` + `src/hierarchyExport.ts:62`；通道成对：`native/main.cpp:1478`/`:1481`、白名单 `native/export_file.hpp:29` = `{".html", ".htm", ".txt"}`（`.txt` 确实放行，越界文案在 `native/export_file.cpp:52`）。**引用面板：未接**——`src/referenceContents.ts:226` 的 `exportReferencesText` 生产侧**零消费方**（`grep -rn exportReferencesText src/` 只命中声明；消费只在 `tests/usage-view-panel-rows.test.mjs:24/:155/:199/:331`），面板工具条 `src/components/ReferencePanel.vue:79-83` 只有「全部展开 / 全部折叠 / 过滤」三件、**没有导出**，中间层 `src/components/ToolWindowView.vue:220` 的事件通道里也没有 export 一条 ⇒ nav3 §N-1b 里"三条按钮"只有两条落了 | `platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java:22-41`（`:22` `getReportText()`、`:33` 缩进四个空格、`:36` 高亮文本、不含位置），`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:2260`（`sink.set(PlatformDataKeys.EXPORTER_TO_TEXT_FILE, myTextFileExporter)`）、`platform/platform-api/src/com/intellij/openapi/actionSystem/PlatformDataKeys.java:82`、`platform/platform-impl/src/com/intellij/ide/actions/ExportToTextFileAction.java:28`（动作就是问这把 DataKey） | **一条已接、一条未接**。引用那条判 **该模块侧做**（`ReferencePanel.vue` 加按钮 + emit、`ToolWindowView.vue` 加 ctx 一条），落完后 **该主代理接**（App.vue 的 ctx handler 复用同一条两跳，见 §4.4） | 现状不构成假控件（面板上没有那格），但 `exportReferencesText` 是"模块侧先落、宿主没人接"的既有形状 —— 与 §3 补的判据同一类 |

---

## 2. 判为「已闭环 / 前提不成立」的订正文案（给主代理直接抄进文档，别再当缺口挂着）

### 2.1 第 1 条（Run Anything cwd）——b10audit §1 的四句已全部过期

订正写法（建议直接替换 `docs/wiring-requests-2026-10-06-b10audit.md` §1 与 §「交付清单」第 1 项）：

> **1) Run Anything 的执行上下文（cwd）—— 已闭环（2026-10-06 b10judge 复核）**
> 三处同批落完了：`src/components/RunAnythingDialog.vue` 有了那格上下文选择 UI（`:125-136`，
> 候选装配 `:58-63`、选择/隐藏规则 `:64-67`，全部走 `src/runAnythingContext.ts` 的
> `allRunAnythingContexts`/`resolveSelectedContext`/`contextPath`），
> payload 带上 `cwd`（emit 形状 `:35`、发出处 `:97-98`），
> 宿主把表与目录都接上（`src/App.vue` 的 `:module-roots="runAnythingModuleRoots"` +
> `runExternalTool(payload.command, payload.command, payload.cwd)`），
> 收端 `src/runActions.ts:475` 的第三参已放宽成 `cwd?: string | null`，`:499` 仍是
> `cwd?.trim() || workspace.value.root`（不发 cwd 键 = 工作区根，与上游 ProjectContext 同结果）。
> `src/runAnythingContext.ts` **不再是零消费方**（本轮 `node .tools/find-orphan-modules.mjs` 的孤儿清单里没有它）。
> 判据：`tests/run-anything-context-dialog.test.mjs` 11 条（含宿主两半 + `gradleSubprojectRoots` 的折算），本轮实跑 11/11。
> **两处口径修正**：① 本审计轮建议的 `cwd: contextPath(...) ?? undefined` **没有照抄**，落的是
> 「为空就不带 `cwd` 键」（`:98`），比 `undefined` 更严 —— 收端不必再区分"给了空串"与"没给"；
> ② 原写「上游 `platform/execution-impl/src/com/intellij/execution/runAnything/` find 命中 0 ⇒ 无法核实」**是找错了目录**：
> 那一档确实不存在，但上游实现**在树里**，真路径是 `platform/lang-impl/src/com/intellij/ide/actions/runAnything/`
> （`RunAnythingChooseContextAction.kt`、`RunAnythingPopupUI.java`、`RunAnythingContextUtils.kt`、
> `RunAnythingRunConfigurationProvider.java` 全在，坐标见判定表第 1 行）⇒ 这条**不再是"按本仓架构还原、不引上游"**。

### 2.2 第 2 条（终端两格设置）——已闭环，但有五处口径要订正

1. **「四处成对」实际是七处**：除 b10audit 列的 ①`src/settingsModel.ts`（接口 `:527`/`:539` + 缺省 `:265`）
   ②`native/settings_schema.hpp`（`EDITOR_SETTING_KEYS` 尾部 `:117`，注释 `:102-116`）
   ③`native/settings_schema.cpp:419`（默认值表）④`src/previewSettings.ts:52`（预览白名单）之外，
   数字那把还要 ⑤`native/settings_editor_keys.hpp:70-72`（**桌面态的 4..40 值域分支**，漏了就是"能存不能校验"）
   与 ⑥面板取数（`TerminalPanel.vue:115`/`:121-124`）+ ⑦**宿主挂载** `src/App.vue:2304` 的 `:settings="editorSettings"`。
   ⇒ 请求文档里那句"四处"请按七处订正（`docs/wiring-requests-2026-10-06-termset.md` R-1 已经写成六处 + 面板，仍少宿主那一行）。
2. **`EditorOptionsPanel.kt:195` 是错的**（b10audit `:163`）：实测 `:91-94` 是 `enableWheelFontChange` 的定义、
   `:214` 是 `group(message("group.advanced.mouse.usages"))`、`:216` 才是复选框挂点。termset R-5.2 已订正，本轮复核成立。
3. **termset R-5.3 那句"只核实到 `ApplicationBundle.properties:396`"本身是误订正**：
   `platform/ide-core/resources/messages/ApplicationBundle.properties:395` 逐字是
   `group.advanced.mouse.usages=Mouse Control`，`:396` 是那条文案、`:397` 是 mac 变体 ⇒ b10audit 的 `:395` 没错。
   仓里现有注释（`src/components/SettingsDialog.vue:736` 那句长注）写的是 `:395 = Mouse Control`，**是对的，别照 termset 改坏**。
4. **`TerminalFontSizeProvider.kt:16-25` 没有 `detectFontSize()`**（bucket10b 原写）：实测该文件 `:14` 是
   `fun getFontSize(): Float`、`:16-20`/`:22-25` 是 `setFontSize`（注释写明"临时缩放不写回设置"）与 `resetFontSize` 的文档；
   `detectFontSize()` 在 `platform/execution-impl/src/com/intellij/terminal/TerminalUiSettingsManager.kt:123-128`
   （`resetFontSize()` `:130-132` 交回它），链条接到 `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsUtils.kt:21-22`。
5. **默认档钉 false 已落实**：`TerminalPanel.vue:89` 那个占位常量与"先按上游的『开着』处理"那句注释都撤了
   （现 `:115` 的 fallback 是 `?? false`，与 `EditorSettingsExternalizable.java:124` 同档）⇒ b10audit §2 那句"仍然缺 + 注释要一并修"过期。
6. 请求文档里的行号（`TerminalPanel.vue:81/:89/:326/:318/:120-121/:308/:535/:546/:704`、`App.vue:2272`、
   `SettingsDialog.vue:918`）**全部漂了**，现状见判定表第 2 行；`SettingsDialog.vue:918` 那条建议的
   `aria-describedby="editor-diagnostics-hint"` 也**没照抄**（落的是新起的 `editor-terminal-font-hint`，两行共用、id 只定义一次）——
   这是 termset R-3 的订正，落地一致。

⇒ 第 2 条判 `已闭环`；**唯一没被任何测试钉过的是宿主那一行**，本轮补上（§3）。

### 2.5 第 5 条（大文件正则提示）——判 `前提不成立`，建议撤条

订正文案：

> **5) 大文件「正则搜索」提示 —— 从桶 10 清单撤掉（前提不成立，不是"做不了"）**
> 上游那条播报的是**匹配长度上限**、不是"不可用"：`platform/lang-impl/src/com/intellij/largeFilesEditor/editor/`
> `LargeFileRegexSearchNotificationProvider.java:42-45`，`{0}` 填的是 `getPageSize() / 500`（`:44`），
> 文案原文 `platform/platform-api/resources/messages/EditorBundle.properties:155` =
> `Regex search can''t find matches with length longer then {0} Kb`。本仓编辑器是 CodeMirror 单视图、**没有分页模型**
> ⇒ 那个数字无从算。且本仓大文件模式**没关正则查找**（`src/largeFileMode.ts:8` 与 `:34-35` 的提示条都写着查找替换照常；
> `src/editorSearchExtension.ts:62` 调 `collectSearchMatches(...)` 不传 limit，而 `src/editorSearch.ts:127` 的缺省是
> `limit = Infinity`）⇒ 没有可播报的降级。本仓真有的那条限制是高亮条数 `MAX_HIGHLIGHTS = 200`
> （`src/editorSearchExtension.ts:47`），它与大文件无关，属另一条判词。
> 模块侧**不加** `largeFileRegexNoticeText()`（加了就是没人调的死分支）；查找条 `role="status"` 那行不动。

### 2.6 第 6 条（`elevate`）——判 `前提不成立`，登记为独立批次

订正文案：

> **6) `RunStartParams.elevate` —— 本轮不落，登记为独立批次（前提两条都不成立）**
> ① 落点写错：`RunStartParams` 不在 `src/bridge.ts`，定义在 `src/settingsModel.ts:93`，
> `src/bridge.ts:71`/`:81` 只是类型转发；② 消费侧完全没有：全仓 `elevat`（去掉 CSS 变量 `--elevated`）0 命中，
> `native/main.cpp:1104-1112` 只把 `params` 整包交给 `runs->start`（`:1110`），`native/run_host.hpp:35-43` 的
> `struct Step` 没有提权档 ⇒ 现在加 `elevate?: boolean` 就是"前端写了、native 读不到"的假通道。
> 缺的是**传输层**：上游 `platform/execution-process-elevation/src/com/intellij/execution/process/elevation/`
> `ElevationDaemonProcessLauncher.kt:30-36` 的注释直说提权进程**不走进程 stdio**（`:32`，trampoline 模式），
> `:68-74`（`:71` = `trampoline = true, daemonize = true`）⇒ 先要有 daemon/命名管道那一层才收得到输出。
> 独立批次的内容：`native/run_host.cpp` + `CMakeLists.txt`（保留文件，只能交请求）+ 新增方法名时
> `src/bridge.ts:109` 的 `Method` 联合与 `native/main.cpp` 的分派**成对**改 + UAC 侧取证。
> 另记一处口径：`src/runActions.ts:94` 的 `runStartParams()` 只服务「跑配置」那条链，
> `runExternalTool`（`:499`）发的是内联对象 ⇒ 真做提权时两处要分别接，单加类型字段不会自动带上。

---

## 3. 新增判据（本轮唯一落手的改动）

### 3.1 为什么钉这一条

第 2 条请求落地后，**六处成对 + 面板取数 + 设置页两行都有判据**（`tests/terminal-font-size.test.mjs` 原 12 条），
唯独**宿主挂载那一行**（`src/App.vue` 的 `<TerminalPanel … :settings="editorSettings">`，主代理 §11.2 落的）**一条判据都没有**：
`settings` 是**可选 prop** ⇒ 漏传时 `vue-tsc` 不报、module-size 不管、上面 12 条全绿，
而界面上「终端基准字号 / 按 Ctrl+鼠标滚轮改变字号」两格改了就是没反应（面板一路 fallback 到内置 13 / 关）。
这正是本桶要拦的「请求落地但没人核」的形状，也是 `docs/wiring-requests-2026-10-06-runctx.md` §请求1 明说过的风险。

### 3.2 落点与内容

文件：`tests/terminal-font-size.test.mjs`（240 → 312 行，12 条 → **13 条**）。
新增一条 `test('宿主把 :settings 交给终端面板：没接 ⇒ 面板按内置档，接了 ⇒ 界面那一格跟着用户那一档走')`，
外加顶部一行 `import { loadSetup } from './vue-sfc-loader.mjs'` 与两个本地helper（`PANEL`、`quiet()`）。断言分三段，**全部精确、没有一条 `includes` 蒙**：

1. **宿主半边（源码锚点，按 `<TerminalPanel…>` 标签整体抓）**：
   `mounts.length >= 1`；**每一个**挂载标签都必须命中 `/:settings="editorSettings"/`；
   且必须**不**命中 `/:settings="\s*\{/`（不许在挂载处现抄字面量 —— 抄来的那份不随 `settings.update` 的回包更新）；
   再钉那本活账本身：`/const editorSettings = ref<EditorSettings>\(\{ \.\.\.defaultEditorSettings \}\)/`
   与 `/editorSettings\.value = await request<EditorSettings>\('settings\.update'/`。
2. **行为半边（真调组件自己那份 setup，不重写规则）**：
   接了 `{ wheelFontChangeEnabled: true, terminalBaseFontSize: 18 }` ⇒
   `baseFontSize.value === 18`、`fontSizeShown.value === 18`（工具条那一格的读数）、`wheelFontZoomEnabled.value === true`、
   `terminalWheelZoomApplies({ ctrlKey: true }, …) === true`；
   **没接**（只给 `active: true`）⇒ `baseFontSize.value === TERMINAL_BASE_FONT_SIZE`、`fontSizeShown.value === 13`、
   `wheelFontZoomEnabled.value === false`、`terminalWheelZoomApplies({ ctrlKey: true }, false) === false`。
3. **越界/坏值半边**：`terminalBaseFontSize: 41` 与 `13.5` 都必须退回内置档（`EditorFontsConstants.java:15-17` 的那对界 + `Number.isInteger` 守卫）。

判据头注里带了我逐行开过的上游坐标（`EditorSettingsExternalizable.java:124`/`:1043`、`JBTerminalPanel.java:382-386`、
`EditorFontsConstants.java:11-13`/`:15-17`、`TerminalUiSettingsManager.kt:123-128`）。

### 3.3 原始跑测数字

| 跑法 | 数字 |
|---|---|
| `node --test tests/terminal-font-size.test.mjs`（改完） | **tests 13 / pass 13 / fail 0**（duration 约 1.19s，新增那条自身约 773ms —— 它真跑组件 setup） |
| 注入 A（真文件，`src/components/TerminalPanel.vue`：`props.settings?.wheelFontChangeEnabled ?? false` → `?? true`，即"宿主没接时不再按上游关档"） | **tests 13 / pass 11 / fail 2** —— 红的正是①新加的「宿主把 :settings 交给终端面板…」、②已有的「上游默认档钉 false…」 |
| 还原后 | md5 与注入前逐字一致（`1cc042517060a6cb183f1f6d78f0800d`）、`git diff --numstat src/components/TerminalPanel.vue` 空、`grep -c "wheelFontChangeEnabled ?? true"` = **0** 残留、**13/13 复绿** |
| 注入 B（**保留文件不许动** ⇒ 内存副本）：① 从 `<TerminalPanel…>` 标签里摘掉 ` :settings="editorSettings"`；② 换成 `:settings="{ wheelFontChangeEnabled: true, terminalBaseFontSize: 13 }"` | ①判据 = **false**（红）②判据 = **false**（红），现状（未注入）= true；`src/App.vue` **一个字节都没写**（脚本只读，`/tmp/b10judge-inject.mjs`，跑完即弃） |
| 桶 10 域测试（`terminal-font-size` + `terminal-colors` + `large-file-mode` + `editor-large-file-guard` + `run-anything-context-dialog` + `run-anything-context`） | **55 / 55 / 0** |
| 引用与层级面板域测试（`reference-panel-host` + `hierarchy-export` + `usage-view-panel-rows`） | **36 / 36 / 0** |

---

## 4. 判为「该主代理接 / 该模块侧做」的可照抄片段

⚠ 所有 old 都是本轮**逐字**读出来的（含缩进）。`src/App.vue` 与 `src/components/CodeEditor.vue` 都在被并行编辑，
落之前请按给出的字符串再定位一次；`.vue` 里的相对 import 沿用**该文件自己的**写法（`CodeEditor.vue`/`App.vue` 都是无扩展名，
`node .tools/find-missing-ext.mjs` 两种写法都判干净）。

### 4.1 `src/components/CodeEditor.vue`（保留文件 ⇒ 该主代理接）—— 大文件动作门禁的键位面

前置 import（实测在 `:87`，紧跟其后加一行）：

```
import { largeFilePolicyForText, utf8ByteLength } from '../largeFileBytes'
```
⇒
```
import { largeFilePolicyForText, utf8ByteLength } from '../largeFileBytes'
import { largeFileCommandAllowed } from '../largeFileMode'
```

`heavy` 已在同一文件 `:128-129`（`const large = largeFilePolicyForText(props.content)` / `const heavy = large.large`），**不需要新出口**。

六条键位（实测 `:848`、`:850`、`:851`、`:855`、`:861`、`:862`）—— 每处都**保留原有返回式**，只在前置那道门；
被禁时返回 `true` 把键**吞掉不放大**（`Mod-r` 交回浏览器就是整页重载，`Ctrl-F3`/`Alt-j` 同理）：

| 实测行 | old（逐字） | new |
|---|---|---|
| `:848` | `          { key: 'Mod-r', preventDefault: true, run: () => { openFindBar(true); return true } },` | `          { key: 'Mod-r', preventDefault: true, run: () => { if (!largeFileCommandAllowed('replace', heavy)) return true; openFindBar(true); return true } },` |
| `:850` | `          { key: 'Ctrl-F3', preventDefault: true, run: () => findBar.findWordAtCaret(false) },` | `          { key: 'Ctrl-F3', preventDefault: true, run: () => { if (!largeFileCommandAllowed('find.wordAtCaret', heavy)) return true; return findBar.findWordAtCaret(false) } },` |
| `:851` | `          { key: 'Ctrl-Shift-F3', preventDefault: true, run: () => findBar.findWordAtCaret(true) },` | `          { key: 'Ctrl-Shift-F3', preventDefault: true, run: () => { if (!largeFileCommandAllowed('find.prevWordAtCaret', heavy)) return true; return findBar.findWordAtCaret(true) } },` |
| `:855` | `          { key: 'Alt-Shift-j', preventDefault: true, run: editingCommands['occurrence.unselect']! },` | `          { key: 'Alt-Shift-j', preventDefault: true, run: (v) => largeFileCommandAllowed('occurrence.unselect', heavy) ? editingCommands['occurrence.unselect']!(v) : true },` |
| `:861` | `          { key: 'Alt-j', preventDefault: true, run: editingCommands['occurrence.next']! },` | `          { key: 'Alt-j', preventDefault: true, run: (v) => largeFileCommandAllowed('occurrence.next', heavy) ? editingCommands['occurrence.next']!(v) : true },` |
| `:862` | `          { key: 'Ctrl-Shift-Alt-j', preventDefault: true, run: editingCommands['occurrence.select']! },` | `          { key: 'Ctrl-Shift-Alt-j', preventDefault: true, run: (v) => largeFileCommandAllowed('occurrence.select', heavy) ? editingCommands['occurrence.select']!(v) : true },` |

（`:844/:845` 的 `F3`/`Shift-F3` 与 `:847` 的 `Mod-f` **不套 `largeFileCommandAllowed`** —— 上游 `:40-41`/`:47` 是
"换成页内搜索那一档"，不是禁；`Mod-f` 走下面 `:replace-mode` 那一半。）

「只搜不替换」那一档（实测 `:1104`）：

```
      :replace-mode="findBar.state.replaceMode"
```
⇒
```
      :replace-mode="!heavy && findBar.state.replaceMode"
```

⚠ 单改这一行**不够**：`src/components/EditorFindBar.vue:183` 那个「切换替换」按钮是**无条件渲染**的
（`:186` 的替换行才吃 `replaceMode`），用户在 heavy 里点它就把 `replaceMode` 又打开了 ⇒ 必须配 §4.2 那条 prop。
`navigate.gotoLine` 的键不在本文件：它在 `src/keymapBindings.ts:110-111`（`when: editorWhen`），派发在
`src/keymap.ts:387` → 宿主的 `openGoLine`（`src/App.vue:1277` 解构）⇒ 那条走 §4.2 的第三条落点。

### 4.2 该模块侧做（不是保留文件，本轮我没动）

1. `src/components/EditorFindBar.vue` —— 加一个「替换可用否」的入参并把那枚切换按钮跟着藏：
   props 现在只有 `:38` 的 `replaceMode: boolean`；建议加 `canReplace?: boolean`（缺省 `true`），
   `:183` 的按钮改 `v-if="canReplace"`，`:186` 改 `v-if="canReplace && replaceMode"`，
   `:213-214` 的 `replaceOne`/`replaceAll` 出口不动（宿主侧拿不到入口就是按不到）。
   归属：EditorFindBar/查找栏那一条 lane（与 §4.1 的 `:replace-mode` **同批**落，缺一半就是假门禁）。
2. `src/editorTab.ts` + `src/components/CodeEditor.vue` 的 `defineExpose` —— **若要**在 App/菜单层判 heavy，
   必须成对：`EditorHandle`（`src/editorTab.ts:13-29`，实测 11 个方法，无任何大文件/heavy getter）加
   `largeFile(): boolean` 与 `CodeEditor.vue:423` 起的 `defineExpose` 里加 `largeFile: () => heavy`。
   归属：编辑器宿主层那条 lane。**注意**：只加接口不加 expose ⇒ `vue-tsc` 直接报，不会被静默放过。
3. `navigate.gotoLine` **在两个面上是两个 id**（本轮实测，别按一个 id 关两处）：键位面是
   `src/keymapBindings.ts:110-111`（`id: 'navigate.gotoLine'`、`when: editorWhen`），派发到
   `src/keymap.ts:387` → 宿主的 `openGoLine`（`src/App.vue:1277` 解构）；而**菜单行**是
   `src/menus/navigateMenu.ts:113` 的 `{ id: 'navigate.line', title: '转到行/列…', keys: 'Ctrl G', …, enabled: ctx.hasEditor, run: () => ctx.openGoLine() }`
   —— 它**不吃** `src/App.vue:1416` 的 `editable()`（走的是 navigateMenu 自己那套 ctx），
   所以 §4.3 那条 `editable` 的 gate **管不到它**，而 `src/largeFileMode.ts:66` 的禁用表里登记的键位面 id
   也**对不上**那一行。要落这一条有两条路：① 模块侧把 `navigateMenu.ts:113` 的 `enabled` 换成带 heavy 判据的 ctx 谓词；
   ② 宿主在 `openGoLine` 里早退（一处，覆盖键位 + 菜单 + 状态栏那个「点击转到行」按钮 `src/App.vue:2329`）。
   `KeyBindingState`（`src/keymapBindings.ts:26-30`）现在只有 `workspace`/`editor`/`lsp` ⇒ 想走 `when` 就得先加 `large?: boolean`（模块侧）+ 宿主供给（同批）。
4. `src/components/ReferencePanel.vue` + `src/components/ToolWindowView.vue` —— 引用面板的「导出到文本文件」那一格
   （现状见判定表第 7 行），先落模块侧的按钮 + emit + ctx 一条，再由宿主接两跳（§4.4）。

### 4.3 `src/App.vue`（保留文件 ⇒ 该主代理接）

1. **ANSI 覆盖（第 3 条的最后一行，前置 = R-4 的六处供给侧先落完）**
   终端（实测 `:2304`）：
   old 行尾片段 `:settings="editorSettings" @focus-terminal="showOutput('terminal')" />`
   new 行尾片段 `:settings="editorSettings" :ansi-overrides="generalSettings.terminalAnsiColors" @focus-terminal="showOutput('terminal')" />`
   控制台（实测 `:2258`，同一处标签内加同一属性）：
   old `:lines="runLines" :is-desktop="isDesktop"` ⇒ new `:lines="runLines" :is-desktop="isDesktop" :ansi-overrides="generalSettings.terminalAnsiColors"`
   ⚠ **R-4 没落就一行都别接**（面板拿不到就是 `undefined` ⇒ 不覆盖，行为同今天；但留一条永远为空的绑定就是假链路）。
   主代理 §11.2 现在的"主动不接"是**正确状态**，不是待办缺陷。
2. **大文件菜单面（第 4 条的 `enabled`，前置 = §4.2 第 2 条的 `largeFile()` 出口）**
   实测 `:1416-1418`：
   ```
   const editable = (name: string, title: string, keys?: string, keywords?: string): MenuRow => ({
     id: name, title, keys, keywords, enabled: hasEditor, run: () => runEditor(name),
   })
   ```
   new（有出口时，**首选**）：
   ```
   const editable = (name: string, title: string, keys?: string, keywords?: string): MenuRow => ({
     // 大文件模式：上游 `PlatformActionsReplacer.java:37-38/:48-53` 那八条在这里灰掉，其余照旧（白名单式降级）。
     id: name, title, keys, keywords,
     enabled: () => hasEditor() && largeFileCommandAllowed(name, editorFor(activePath.value)?.largeFile?.() === true),
     run: () => runEditor(name),
   })
   ```
   前置 import：`import { largeFileCommandAllowed } from './largeFileMode'`。
   无出口时的**次选**（不用改模块，代价是每次建菜单都重扫一遍正文）：
   `enabled: () => hasEditor() && largeFileCommandAllowed(name, largeFilePolicyForText(active.value?.content ?? '').large)`。
3. `navigate.gotoLine` 那一档**不在** `editable()` 覆盖范围内（菜单行是 `src/menus/navigateMenu.ts:113` 的
   `navigate.line`，`enabled: ctx.hasEditor` 写死）⇒ 宿主最省的一行是在 `openGoLine`（`src/App.vue:1277` 解构的那个函数）
   里按 heavy 早退，一次覆盖键位、菜单行与状态栏那个「点击转到行」入口；细节与另一条路见 §4.2 第 3 项。

### 4.4 引用面板导出那一格（第 7 行的宿主半边，前置 = §4.2 第 4 条）

现成可复用的两跳就在同文件（实测 `:1380-1384`，层级那一条已经落完）：
`request<string | null>('dialog.saveFile', { title, filters: [{ name: '文本文件', pattern: '*.txt' }], name })` →
`request('app.writeExportFiles', { files: [{ path: target, content }] })`。
引用侧要做的只是把 `content` 换成 `exportReferencesText(header)`（`src/referenceContents.ts:226`），
并给 `ToolWindowView.vue:220` 的 `<ReferencePanel>` 补 `@export` 一条 + ctx 一个回调；
按钮必须带 `:disabled="!rows.length"`（照 `ReferencePanel.vue:80-81` 那两条同形写法）。
通道成对性本轮核过：`src/bridge.ts:109` 的 `dialog.saveFile`/`app.writeExportFiles` ↔ `native/main.cpp:1478`/`:1481`，
`.txt` 在 `native/export_file.hpp:29` 的白名单里；`src/bridgePreview.ts:66` 已把这两条判为浏览器预览不可用（`DESKTOP_REQUIRED`）。

---

## 5. 收尾门禁的原始数字（本轮实跑，未加滤镜）

| 命令 | 结果 |
|---|---|
| `node --test tests/terminal-font-size.test.mjs` | **13 / 13 / 0** |
| `node --test tests/module-size.test.mjs` | 首跑 **5 tests / 4 pass / 1 fail** —— 红的是「原生源文件也没有未登记的巨型文件」：`native/settings_schema.cpp(1113 行 > 1100)`（该文件当时是 ` M`，在**别人名下**并行编辑）；收工前复跑 **5 / 5 / 0**（同文件已被那一轮削到 1099 行）。两次数字都留着，因为红的原因与本桶无关 |
| `npx vue-tsc -b --force` | 13:28:26 快照 **0 错**（`grep -c "error TS"` = 0）；13:40:23 与 13:47 复跑各 **1 错**：`src/lspSymbolBridge.ts(33,10) TS2459 … 'SPEED_SEARCH_STRUCTURE_SEPARATORS' … not exported`，该文件是 ` M`（LSP lane 在途）⇒ **本桶名下 0 错**；三次都 `TS1xxx` 语法错 = 0（所以语义检查没被掩盖）。期间还抓到过别人在途的 `src/lspServerMessages.ts`（7 条 TS2339）与 `src/editorInlayHints.ts`（2 条 TS2304），当时两个文件都是 ` M` |
| `node .tools/find-missing-ext.mjs` | **干净**（扫描 1325 个文件：src + tests；本轮两次跑分别是 1322 / 1325，多出来的是并行轮次新增的文件，两种 import 写法都判干净） |
| `node .tools/find-ts-in-mjs.mjs` | **干净**：tests/*.mjs 全部是纯 JavaScript |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 / 10 / 1** —— 红的不是本文：`moved :: src/runStartupFocus.ts|platform/execution/src/com/intellij/execution/RunnerAndConfigurationSettings.java|242-242`（快照里有、仓里已指不到；`src/runStartupFocus.ts` 当时是 ` M`，在别人名下）。本文新写的上游坐标**全部逐条打开过**，按 §「锚点门控」第 ③ 条只计数不拦 |
| `node .tools/find-orphan-modules.mjs` | 孤儿清单（本轮）：`src/agent.ts`、`src/components/ColorSchemeSettingsPage.vue`、`src/dragAndDropTargets.ts`、`src/generalSettingsLocal.ts`、`src/ideShellCreateTarget.ts`、`src/scratchHistory.ts`（+ 合法例外 `src/main.ts`）⇒ **`src/runAnythingContext.ts` 已不在清单里**（第 1 条闭环的旁证）；`ColorSchemeSettingsPage.vue` 仍在 ⇒ 第 3 条那条设置页 UI 至今没有宿主 |

## 6. 本轮改动清单与"没做什么"

| 文件 | 前 | 后 | 内容 |
|---|---|---|---|
| `tests/terminal-font-size.test.mjs` | 240 行 / 12 条 | 312 行 / **13 条** | §3.2 那条宿主挂载判据 + `loadSetup` import + `PANEL`/`quiet()` |
| `docs/batch-2026-10-06-b10judge.md` | — | 本文件 | 判定表 + 订正文案 + 可照抄片段 + 跑测数字 |

没做的（按约束）：**没动任何保留文件**（`src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp` 逐字节未写；
`native/settings_schema.cpp` 的巨型文件红项、`src/runStartupFocus.ts` 的引用漂移、LSP lane 在途的 TS 错误都在别人名下，只登记不代改）；
**没替模块侧代写代码**（§4.2 那四条只给归属与形状）；反向验证对保留文件用的是**只读内存副本**（§3.3 注入 B）。

## 7. 残留扫描（本轮自己的 + 顺手抓到的别人家的）

| 扫描 | 结果 |
|---|---|
| `grep -rn "wheelFontChangeEnabled ?? true" src/`（本轮注入 A 的唯一形状） | **0** ⇒ 注入已还原（同文件 md5 与注入前一致：`1cc042517060a6cb183f1f6d78f0800d`） |
| `grep -rn "b10judge" src/ tests/` | **1** = `tests/terminal-font-size.test.mjs:244` 那条判据的归属注释（是交付内容，不是残留） |
| `grep -rn "INJECT\|PROBE-" src/ tests/`（通用形状，不背名单） | 除上游 API 名 `ANALYZE_INJECTED_CODE`（`src/analysisScope.ts:32`/`:119`、`src/components/ScopesSettingsPage.vue:360`）外，**13:36 那次抓到一条别家标记**：`src/vcsLogGraph.ts:155` 写着 `// VCSLOG3-INJECT-B 回归注入：退回"只要跨行就算长边"的旧阈值` 且同一行是 `… : 2`（不是 `LONG_EDGE_SIZE`），该文件当时 ` M` ⇒ 那是 vcslog3 lane 的**未还原注入**。**本轮按约束没碰它**；13:41 复跑同一条 grep 时该处已是 `… : LONG_EDGE_SIZE`、标记消失（那一轮自己撤了）。**留给主代理**：vcslog3 的批报告若声明"已还原"，以磁盘现状为准即可，不必回溯 |

