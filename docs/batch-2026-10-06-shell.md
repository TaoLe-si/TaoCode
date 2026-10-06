# 批次报告 · 2026-10-06 · 桶 shell（平台外壳 / 生命周期 / 对话框 / 注册表 / 向导）

接手 `docs/wiring-requests-2026-10-06-bucket7b.md` 的 A2/A5，并按 `docs/inventory/verdict-platform_rest.md`
复核 12 族 `[ ]`/`[~]`（bucket7b 已覆盖的 4 族只作复核、不重做）。**本桶没有任何 `.ts`/`.vue`/`native` 源码改动**
（改动全在判词真源 `scripts/verdict_table.py` + 产物 + 两份交付文档），所以**不跑 ctest**（无 native 改动）。

---

## 0. 实况 vs 派单（先说清哪句话与磁盘不符）

| 派单 / 上游文档的说法 | 磁盘实况 | 处置 |
|---|---|---|
| bucket7b A5.2：`scripts/verdict_table.py` 与 `verdict-*.md`、`*_verdict_table.*` 都是 **untracked**（`?? scripts/verdict_table.py`） | `git ls-files` 显示这几个文件**现在都已跟踪**（本桶改动 `git status` 出 `M`） | A5.2 已被别的批纳入跟踪；本桶把 W-2 从「请纳入跟踪」订正成「已解决、有 diff 可审」 |
| 判词 `pf/general-settings`：`SettingsInspector` 的浏览/重置面板「本仓只有数据模型、没有入口——设置页宿主贴着 1356 行上限」 | **早做过**：`src/components/GeneralRegistryToggles.vue` 的「已改动的通用设置」区就是该面板（`inspectableSettings`/`restoreSettingsToDefault`/`changedSettings`，逐行+整页恢复默认），挂在 `src/components/SettingsDialog.vue:1065`；`SettingsDialog.vue` 实为 **1181 行**、`tests/module-size.test.mjs` 登记上限 1182（不是 1356） | 族判词订正（留痕），改 `scripts/verdict_table.py` 后重生成 |
| 判词 `pf/registry`：缺「`RegistryUi` 的可编辑表格对话框、本仓只有两条开关、没有显示注册表入口」 | **早做过**：`GeneralRegistryToggles.vue` 的「注册表键」区就是 `RegistryUi` 等价物（键/值/来源三列 `visibleRegistryRows`、列头排序、速度搜索过滤档、选中行说明+需重启补句、恢复默认按改动置灰 `anyRevertibleChange`），判据 `tests/platform-general-registry-panel.test.mjs`（含「设置页真的把两块挂上了」的接线断言） | 族判词订正（留痕），残余缺口如实保留：独立 Find Action 宿主、逐键运行时覆盖通道 |
| 判词 `pf/platform-ide`：`SettingsDialog.vue`「当前 1176 行…只剩 6 行余量」 | 现 **1181 行 / 上限 1182 / 只剩 1 行**（别的批在 1176 之后又给设置页加了内容） | 数字随磁盘订正 |

其余 8 族（`pf/lifecycle`、`pf/openapi-ui`、`ic/dialogs`、`ici/project`、`pm/project`、`pf/startup`、`ic/application`、`ic/wizard`、`pf/wizard`）逐族**打开文件核实**后判词与磁盘相符，**未改档**（见 §1 逐族结论）。

---

## 1. 判词表（12 族逐族：判定 / 上游依据 / 本仓落点 / 一句话）

| 族 | 判定 | 上游相对路径:行号 | 本仓落点（文件:行） | 一句话说明 |
|---|---|---|---|---|
| `pf/lifecycle` | `[~]`（未改档，bucket7b 已核） | `GeneralLocalSettings.kt:17-18`、`ApplicationManager`/`ProjectManagerImpl` 一族 | `src/workspaceLifecycle.ts`（bootstrap/activateWorkspace/closeWorkspace，`refreshAppState:134` 已接 `settingsInspector`+`environmentKeys`+`startupActivities`+`preloadingActivities`） | 缺项全部卡在保留文件/宿主/架构（本机级拆分见 W-1、协议唤起伏在禁改 `native/main.cpp`、Dumb/遥测前提不成立），本桶复核后**不重做** |
| `ici/project` | `[~]`（未改档） | `ProjectImpl`/`P3PathsEx`/`ProjectNameProvider` 一族 | `src/projectDirectories.ts`（消费 `ProjectStructureDialog.vue:25`、`ProjectStructurePane.vue:12` 的 `defaultProjectName`） | 「已落」claims 逐条 grep 核实有真实消费者；缺项（per-instance 目录分家、`LowLevelProjectOpenProcessor`、组件容器）无宿主、不造 |
| `pm/project` | `[~]`（未改档） | `ProjectLocatorImpl`/`ProjectManager`/`ProjectUtil.guessProjectDir` | `src/projectLocator.ts`（`normalizeProjectRoot`/`locateProject`/`uniqueProjectRoots`…，消费 `src/projectWidget.ts`） | `.idea` 探测「打开目录即工作区」是架构差异（文件头已写清），非漏做；`Project` 对象/多窗口判不适用 |
| `pf/platform-ide` | `[~]`（**数字订正** 1176→1181/剩1） | `StartupErrorReporter.java:353-409`/`:122-141`/`:143-150`/`:191`、`StartupErrorHandler.java:11-13` | `src/platformIdeStartupFailure.ts` + 入口 `src/main.ts:5`/`:23`，判据 `tests/crash-startup-failure.test.mjs` | 启动失败面已落（bucket7b），本桶只把「设置库空位」那句的数字与磁盘对齐 |
| `pf/startup` | `[~]`（未改档） | `StartupManager`/`EnvironmentUtil`/`HeadlessEnvironmentService`/`EnvironmentKeyStubGenerator` | `src/startupActivities.ts` + `src/environmentKeys.ts`，接线在 `src/workspaceLifecycle.ts:24-26`/`:414-417` | 缺的「真实 EnvironmentKeyProvider」——上游键来自插件 EP，本仓没有真必需环境键，**填进去=编造**，故注册表空是如实状态（文件头已写） |
| `ic/application` | `[~]`（未改档） | `Application`/`ApplicationStarter`/`PreloadingActivity`/`ApplicationActivationListener` | `src/applicationStarters.ts`+`src/applicationActivation.ts`（消费 `src/main.ts:4`、`src/workspaceLifecycle.ts`）、`src/preloadingActivities.ts`（`workspaceLifecycle.ts:27`/`:172`/`:426` 跑 `taocode.warmJdkCache`）、`src/appearanceActions.ts` focus/blur | 「已落」claims 全部有生产消费者；缺项（第二实例转交、Experiments、对象模型）保留文件/架构挡住 |
| `pf/openapi-ui` | `[~]`（未改档，bucket7b 已核） | `DialogWrapper`/`DialogWrapperPeerImpl.java:442-443`/`:946-958`/`:1161-1172` | `src/dialogGeometry.ts`（消费 `ProjectDialog.vue`/`SpecialPathsDialog.vue`）、`src/dialogValidation.ts`（消费 `wizard.ts`/`ProjectDialog.vue`） | 尺寸记忆/校验两条基座行为已落并有真实消费者；缺 `Relative/HybridLineNumberConverter`（gutter 入口在禁改 `CodeEditor.vue`） |
| `ic/dialogs` | `[~]`（未改档，bucket7b 已核） | `Messages`/`MessageDialogBuilder`/`ListPopupStep.java`/`PopupShowOptions.kt` | `src/messageDialog.ts`（消费 `TrustedProjectDialog.vue`）、`src/popupSteps.ts` | 缺 ①（全局消息宿主=App.vue，W-4）与 ⑤ 的弹层那一半（宿主在桶 8，W-4）都是保留/他桶文件，维持未完成 |
| `pf/general-settings` | `[~]`（**订正：浏览/重置面板已落 + 数字订正**） | `GeneralSettings`/`GeneralLocalSettings.kt`/`PropertiesComponentEx` | `src/settingsModel.ts`+`src/settingsInspector.ts`（读盘消费 `workspaceLifecycle.ts:140`）+ `src/components/GeneralRegistryToggles.vue`（挂 `SettingsDialog.vue:1065`） | 原判词把「已改动设置浏览/重置面板」记成缺——其实已由设置页批落地并有判据；本机级 vs 应用级拆分见 W-1 |
| `pf/registry` | `[~]`（**订正：可编辑/浏览表格已落**） | `RegistryUi.java:125-138`/`:140-176`/`:188-189`/`:193`/`:485`、`ShowRegistryAction`/`ManagedRegistry` | `src/registryKeys.ts`（数据模型）+ `src/components/GeneralRegistryToggles.vue`「注册表键」区（挂 `SettingsDialog.vue:1065`），判据 `tests/registry-keys.test.mjs`+`tests/platform-general-registry-panel.test.mjs` | 原判词「缺可编辑表格、只有两条开关」与磁盘不符：三列+排序+速度搜索过滤+选中说明+恢复默认门控都在；残余缺=独立 Find Action 宿主、逐键运行时覆盖 |
| `ic/wizard` | `[~]`（未改档） | `Wizard`/`AbstractWizardStepEx.java:15-70`/`StepWithSubSteps`/`StepListener` | `src/wizard.ts`（消费 `ProjectDialog.vue` 新建三步），判据 `tests/wizard.test.mjs`+`tests/wizard-steps.test.mjs` | 残余缺（`StepWithSubSteps` 嵌套/`StepAdapter` 空基类/`CommitStepException` 提交拒绝）本仓用 `validate` 门禁替代，无消费场景——加了=金工/假控件，不补 |
| `pf/wizard` | `[~]`（未改档） | `Wizard`/`AbstractWizardStepEx`/`ModuleBuilder`/`ModuleNameGenerator` | `src/wizard.ts` + `src/components/ProjectDialog.vue` | `ModuleBuilder`/语言分步向导需要 Module 模型（`lp/module-model` 判 `[-]`）；`ModuleNameGenerator` 重名建议无 Module 对象可挂，不造 |

---

## 2. A2 本机级设置（`RoamingType.DISABLED`）—— 模块侧状态

- 模块侧 `src/generalSettingsLocal.ts`（82 行）**已做完且经上游核对**：
  三键集合 `GENERAL_LOCAL_SETTING_KEYS`（对齐 `GeneralLocalSettings.kt:79-83`）、
  `useDefaultBrowser` 默认 **true**（`:81`）、`browserPath` 默认 null 且按平台回落（`:28-35`/`:66-70`）、
  `splitGeneralSettingsByRoaming` 的导出/同步只带 roaming 那一半（`:17-18` `RoamingType.DISABLED` 的语义）。
  上游文件我打开逐行核过（Windows `IExplore.exe`/mac `open`/Unix `/usr/bin/firefox`、`migrateFromGeneralSettings:42-58`）。
- 判据 `tests/general-settings-local.test.mjs`（6 条）**81/81 绿**（本桶域内合跑）。
- 保留文件那一行交请求：`docs/wiring-requests-2026-10-06-shell.md` **W-1** 给了 `src/settingsModel.ts`
  （interface `:111-112` + `defaultGeneralSettings` `:182-184`）、`native/settings_schema.hpp:103-105` + `.cpp:140`、
  导出侧 `src/settingsTransfer.ts` + `native/settings_transfer.cpp:41-49` 三处的**可照抄整段**与上游依据。
- 本桶刻意**没单独改 `native/settings_transfer.cpp` 的导出过滤**：在存储分家之前单独剪键会让导入端把本机值冲成空，
  正是 bucket7b A2 警告的「两份真相」，因此整批交主代理（W-1 §③ 写明顺序）。

## 2b. A5（治理）
见 W-2/W-3：A5.1（`verdict-find-diff.md` 勿按快照重写）本桶未触碰、b7 复跑 10/10 绿；
A5.2（判词真源纳入 git）**已由别的批解决**（实测五个文件都 `TRACKED`），W-2 留痕订正；
A5.3（`customFoldingProviders.ts` 的 TS1002）——收工时 tsc 实况见 §3（该错已不在，但另两条别 lane 的在途错出现）。

---

## 3. 改动文件清单（`wc -l` / numstat 前后）

| 文件 | 动作 | numstat | 说明 |
|---|---|---|---|
| `scripts/verdict_table.py` | 修改（**tracked**，有 diff） | `+3 / -3` | 只动 3 段族级散文（`pf/general-settings`、`pf/registry`、`pf/platform-ide`）；`FAMILIES`/`PLATFORM_FAMILIES` 结构、护栏、逐类表逻辑一个字没碰。当前 1034 行。 |
| `docs/inventory/verdict-platform_rest.md` | 重新生成（产物） | `+3 / -3` | 与 `.py` 一致（`--check` 3/3）；当前 390 行 |
| `docs/inventory/platform_rest_verdict_table.json` | 重新生成（产物） | `+70 / -70` | `families.*.reason` 三段散文重排的字节数 |
| `docs/batch-2026-10-06-shell.md` | 新增 | — | 本报告 |
| `docs/wiring-requests-2026-10-06-shell.md` | 新增 | — | W-1（A2）/W-2（A5）/W-3/W-4 |

**未动**：任何 `src/*.ts`/`*.vue`、任何 `native/*`、任何 `tests/*`、`src/App.vue`/`settingsModel.ts`/`settingsTreeMeta.ts`/
`bridge*.ts`/`keymap*.ts`/`actionRegistry.ts`/`native/main.cpp`/`CMakeLists.txt`/`src/problems*`/`src/status*`/`src/terminal*`/
`src/dbg*`/`src/vcs*`（别人在途）、`docs/inventory/verdict-find-diff.md`、`docs/inventory/verdict-actions.md`。
没有 `git checkout/reset/stash/clean`，没有 commit/push。

---

## 4. §5 每条自查命令的前后数字

| 命令 | 前 | 后 |
|---|---|---|
| `node --test tests/platform-*.test.mjs tests/dialog-*.test.mjs tests/registry*.test.mjs tests/main-toolbar-render.test.mjs tests/b6-verdict.test.mjs tests/b7-verdict.test.mjs tests/module-size.test.mjs` | （派单基线）b6 7/7、b7 10/10 | **60 / pass 60 / fail 0**（含 b6-verdict、b7-verdict、module-size、main-toolbar 全在内） |
| 本桶域内补测（general-settings-local / wizard / wizard-steps / environment-keys / startup-activities / project-locator / project-directories / project-build / application-activation / about-dialog-copy / message-dialog / dialog-geometry / dialog-validation） | — | **81 / pass 81 / fail 0** |
| `node --test tests/verdict-generated.test.mjs`（platform_rest 的门，非 b6/b7） | 5/5 绿 | 改判词重生成后 **5/5 绿**（见 §5 反向验证） |
| `python scripts/verdict_table.py platform_rest --check` | 一致 3/3 | **一致 3/3**（`total=20574 [x]=22 [~]=5423 [ ]=0 [-]=15129`，域四档自洽不受族散文影响） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | — | **pass 11 / fail 0**（交付文档里的上游引用都指得到） |
| `node .tools/find-param-props.mjs` | — | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | — | **干净**（tests/*.mjs 全纯 JS） |
| `node .tools/find-missing-ext.mjs` | — | **干净**（扫描 1259 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 | **9 已登记 / 基线 9 · 新增 1（`src/consoleHyperlinks.ts`，非本桶文件=别 lane 在途）**。本桶名下文件里唯一零消费方仍是 `src/generalSettingsLocal.ts`（在基线内，理由「缺 settingsModel.ts 三个键」，见 W-1），本桶**没有新增**孤儿 |
| `npx vue-tsc -b --force` | 派单基线 0 错 | **1 错：`src/components/ProblemsPanel.vue(125,3): error TS2769`**（problems lane 在途，非本桶文件）。本桶**没改过任何 `.ts`/`.vue`**，此错与 shell 无关；bucket7b A5.3 的 `customFoldingProviders.ts` TS1002 已不在当前 tsc 输出里。（另：我第一次跑时看到的是 `dbgBreakpointUpdate.ts` 的 `running` 未定义 3 条——DAP lane 在两次跑之间自行修掉了，进一步说明这些红是别 lane 的活现场） |
| ctest / native | 无 native 改动 | **未跑**（`native/{dialogs,settings_transfer,projects}*.cpp` 一个字没动） |

---

## 5. 反向验证记录（新门禁/改门禁必须三步：注入违规→变红→撤掉→复绿）

本桶没新增门禁，但**动了 `platform_rest` 的族判词**，其门 `verdict-generated.test.mjs` 的
`[x]/[~] 族的判词必须指出真实存在的本仓落点` 会核对判词里的 `src/`/`native/` 路径。三步：
1. 注入违规：把 `pf/registry` 判词里的 `src/App.vue` 改成 `src/__REVERSE_VERIFY_FAKE__.vue` → 重生成 → 跑门 →
   **pass 4 / fail 1**，报错 `platform_rest/pf/registry → src/__REVERSE_VERIFY_FAKE__.vue`（文件不存在）。
2. 撤掉：改回 `src/App.vue` → 重生成 → 跑门 → **pass 5 / fail 0**。
3. 四档自洽未放松：`--check` 始终 3/3，域四档 `[x]=22/[~]=5423/[ ]=0/[-]=15129` 不因族散文改动而漂移（族档仍是 `[~]`，逐类表档位由 `.py` 的类规则决定，本桶没碰）。
   b6-verdict / b7-verdict 读的是 `verdict-actions.md` / `verdict-find-diff.md`（本桶没改），复跑仍 **b6 7/7、b7 10/10**（`本轮清扫后的四档计数已冻结` 钉 `[31,352,0,247]` 那条绿）。

---

## 6. 零消费方自查结论
- 本桶名下唯一零生产消费方：`src/generalSettingsLocal.ts`——已在 `.tools/orphan-baseline.txt`（`# 缺 settingsModel.ts 三个键`），
  文件头写清了为什么接不上（三处保留文件必须同批），模块侧规则+判据齐备，交 W-1。
- 本桶**没有把任何新模块接成死模块**（没新增 `.ts`/`.vue`）。
- 门禁出现的 `src/consoleHyperlinks.ts` 新增孤儿不是本桶文件（console 域在途），不替它登记基线（不属我判断范围）。

## 6b. 做不到 / 无法核实（具体卡点）
1. **A2 本机级存储拆分**：卡在 `src/settingsModel.ts`（保留只读）+ `native/settings_schema.cpp`（不在本 lane、且有别 agent 在途）+ `src/settingsTransfer.ts`（不在本 lane）。单动 `native/settings_transfer.cpp` 会造成导入冲空本机值 ⇒ 整批交 W-1，本桶按规约**没自接**。
2. **`ic/dialogs` 缺 ①（`Messages` 统一宿主）**：宿主在保留 `src/App.vue`；模型侧 `src/messageDialog.ts` 齐。= W-4 / bucket7b A3。
3. **`ic/dialogs` 缺 ⑤（步骤式列表弹层）**：宿主组件在桶 8（`AnchoredMenu.vue`/`EditorPopupMenu.vue`/`SearchEverywhereDialog.vue`）。= W-4 / bucket7b A1。
4. **`pf/startup` 真实 EnvironmentKeyProvider**：上游环境键由插件 EP 贡献，本仓没有真必需键 ⇒ 空注册表是如实状态，硬填即编造。
5. **`pf/registry` 独立「显示注册表」Find Action 对话框 + 逐键运行时覆盖**：对话框宿主在冻结 `App.vue`（行为已落在设置页『系统设置』）；常量消费键无覆盖通道。
6. **`ic/wizard`/`pf/wizard` 的 `StepAdapter`/`CommitStepException`/`ModuleBuilder`/`ModuleNameGenerator`**：无消费场景 / 需要 Module 模型（判 `[-]`），补了=假控件或金工，按规约不做。
7. **无法核实项**：本桶判词订正里引用的 `RegistryUi.java:125-138/:140-176/:188-189/:193/:485` 沿用了 `GeneralRegistryToggles.vue` 文件头（别的批）已给的坐标，形态是简写（`RegistryUi.java:NNN`，无 `platform/` 前缀）⇒ 引用门不核；若主代理要精确核对，请打开 `platform/lang-impl/src/com/intellij/openapi/util/registry/RegistryUi.java` 复核这些行号（本桶未逐一展开该文件，只核到了 `GeneralLocalSettings.kt` 全文与本仓磁盘事实）。

---

## 7. 给下一个人的一句话
`pf/general-settings`/`pf/registry` 这两族**判词是过期的**（浏览/重置面板与注册表可编辑表格都由设置页批先落地了），
本桶已按磁盘订正；`SettingsDialog.vue` 现在是 1181 行 / 上限 1182（只剩 1 行），任何「再挂一页」都得先从它里搬一块出去。
