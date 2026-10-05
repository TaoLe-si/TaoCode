# 批次交付 · 桶 W（不动 `src/App.vue` 的接线收口）· 2026-10-06

范围纪律：本批**一行 `src/App.vue` 都没动**（`git diff` 里 App.vue 的 120 行变更是主代理并发的腾地方，不是我的 hunk）。
保留文件（`src/settingsModel.ts`、`src/components/CodeEditor.vue`、`src/bridge.ts`、`tests/module-size.test.mjs` 等）一律只读；
需要动它们的都写进 `docs/wiring-requests-2026-10-06-bucketW.md`（H1-H6）。

## 1. 判决表

| # | 请求 | 判决 | 改动文件:行号 / 证据行号 | 核实过的上游坐标 | 验证数字 | 反向验证（注入→红→撤→绿） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 11c **W-B11c-1** 测试树跳源 | **模块侧早齐 + 宿主登记**（H1） | 面板侧：`src/components/TestRunnerPanel.vue:32`（emit `jump`）、`:271-273`、`:404`、模板 `:491` 双击 / `:507` 点行、tooltip `:496`；宿主缺的那一行登记在 `docs/wiring-requests-2026-10-06-bucketW.md` H1 | `platform/smRunner/src/com/intellij/execution/testframework/sm/runner/SMTestLocator.java:22-31`（开过，接口 + `getLocation` 就在这些行）；`java/execution/impl/src/com/intellij/execution/testframework/JavaTestLocator.java:96-125`，`OpenFileDescriptor` 实测在 **:111-117**（请求写 :112-117，差一行） | 判据跑 `tests/test-locator.test.mjs` + `tests/test-tree-view.test.mjs` + 另三条 = **33/33/0** | 不适用（本批没新增行为，只核实与订正） |
| 2 | 11c **W-B11c-2** 陈旧 import | **照做**（并订正：同形的是**两条**不是**一条**） | 删 `src/components/ToolWindowView.vue` 原 `:11 ./HistoryPanel.vue`、原 `:12 ./TestRunnerPanel.vue`；新门禁 `tests/tool-window-view-panels.test.mjs`（42 行，2 条） | 请求自己声明「不是上游行为，是本仓假接线形状判定」⇒ 不给上游坐标；渲染归属实测唯一：`src/App.vue:2283`（`<TestRunnerPanel>`）、`src/App.vue:2390`（`<HistoryPanel>`） | `--dead-imports` 的冗余 import **11 处 → 9 处**（少的正是这两条）；门禁 **2/2/0** | 注入 `import TestRunnerPanel from './TestRunnerPanel.vue'` → **2 tests / 0 pass / 2 fail**（消息「这些面板被 import 却没有渲染点（假接线形状）：TestRunnerPanel」）；撤掉 → **2/2/0** |
| 3 | 11c **W-B11c-3** `'jar'` 运行配置 | **做不到**（保留文件，登记 H6） | 不动。已备好的在 `src/jarRun.ts:50`/`:103`（`src/jarRun.ts` 仍在 `.tools/orphan-baseline.txt` 的 8 条里等这条） | 请求引 `java/execution/impl/src/com/intellij/execution/jar/JarApplicationConfigurationType.java:19-22` —— 本批没用它下结论，**未复核** | — | — |
| 4 | 桶 15 **W1** 新建文件对话框接模板 | **跳过并登记**（三段全在保留的 App.vue） | 无改动。登记 H6 第一行 | 未动 ⇒ 未复核 | — | — |
| 5 | 桶 15 **W2** externalTools 白名单 | **照做 + 两处订正**（请求的「前端不用改」是假的） | `native/settings_schema.cpp:262-300`（白名单 2→11 键、可选键的形态/长度守卫、`outputFilters` 正则本体）；`native/settings_schema.hpp:108-114`（键表注释同形状）；`src/externalToolsRecords.ts:75-105`（`HostToolEntry` 带可选 bean 字段 + `hostToolFields()` 在 `:102`）、`:184`（`toolRecordsFrom` 改**宿主优先**合流）、模块头 `:10-27` 留痕；判据 `native/settings_transfer_test.cpp:183-211` + `tests/ext-external-tools-records.test.mjs:194-225` | `platform/lang-impl/src/com/intellij/tools/Tool.java:56-78`（逐行开过：name :56 … `myOutputFilters` **:78**）、`platform/lang-impl/src/com/intellij/tools/ToolEditorDialog.java:100-121`（getData）/`:137-158`（setData）；不放开那两组照实引 `Tool.java:62-65`（"effectively not used anymore, see IDEA-190856"）与 `:75-76` | native：新用例 **5 条 ok + `settings_transfer: all checks passed`**；全量 ctest **`100% tests passed, 0 tests failed out of 37`**（改注释后又跑一遍）；前端 **ext-external-tools-records 12/12** | 把 `known_keys` 退回 `{"name","command"}` 重新编译 → **`FAIL externalTools 的白名单…: Unknown field: description`**（5 条里 1 条红）；恢复 → **all checks passed** + **37/37**。前端侧另证一次：把合流退回 `withToolDetailDefaults(detail ?? null)` → **12 条里 1 条红**（「宿主带了就以宿主为准」），恢复 → 合并跑 **34/34** |
| 6 | 桶 15 **W3** 忽略清单的启动钩子 | **照做 + 两处订正** | `src/main.ts:6`（值 import 带 `.ts`）、`:20-31`（注释 + `loadIgnoredPatterns()` 排在 mount 之前）；判据 `tests/file-type-ignored-list.test.mjs:145-166` | 请求引 `FileTypeManagerImpl.java:165` ✅ 实开为 `new IgnoredPatternSet(DEFAULT_IGNORED)`；引的 **`:1363-1364` 是假的** —— 那几行实为 `setFileTypes` 里的 `readHashBangs` ⇒ 订正成 `:1236-1238`（`loadState` 里 `ignoredPatterns.setIgnoreMasks(...)`）+ `:142`（`DEFAULT_IGNORED`），并留痕在源码注释与判据注释里 | 该文件 **10/10**（注入时 9 pass/1 fail）→ 合并跑 **34/34/0** | 把 `loadIgnoredPatterns()` 挪到 `createApp(App).mount('#app')` **之后** → **9 pass / 1 fail**（「灌清单要排在挂界面之前」）；挪回 → **复绿**。另：判据第一版用 `indexOf` 会被我自己写的注释里的字面量骗过（删掉调用仍绿）⇒ 改成只认**行首语句** `/^[ \t]*loadIgnoredPatterns\(\)[ \t]*$/m` 才拦得住 |
| 7 | 桶 14a **W1** 树右键「将目录标记为」 | **只做模块侧**（宿主登记 H3） | `src/explorerActions.ts:69-77`：`treeSubmenu` 联合补 `'markroot'` 字面量（在 `:77`；宿主那行没有它 vue-tsc 报 TS2322）。模块面实测早已齐：`src/treeActions.ts:162` `markRootMenu`、`:168` `applyMarkRoot`、`:188` 已 return，写回走 `project.settings.update` | `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:252`（`<group id="MarkRootGroup" popup="true">`；请求写 252-253，实际是 252 一行开 + 253 闭）；`platform/lang-impl/src/com/intellij/ide/projectView/actions/MarkRootGroup.java:14-22`（组标题按选区切 file.text/text；请求写 16-22） | `tests/pv-command-wiring.test.mjs` 等 **33/33/0**；`vue-tsc -b --force` **0 错** | 不适用（新增的是类型字面量，无新断言；宿主行粘上前它只被 H3 引用） |
| 8 | 桶 14a **W2** `createTreeActions` 补 `refreshTree` | **判词成立，登记**（H4） | 实测 `src/App.vue:1350`（deps 首行）里**没有** `refreshTree`；`:1340` 那条属上面的 `createExplorerActions` ⇒ 别接错。模块侧 `src/treeActions.ts:53-58`（可选声明）+ `:179` `deps.refreshTree?.()` 现在空转 | 请求引 `MarkRootActionBase.java:52-56` —— 本批没据此下结论，**未复核** | — | — |
| 9 | 桶 14a **W3** 撤销要连引用改写一起撤 | **不属本批**（登记 H6） | 实现实测在 `src/semanticActions.ts:465`（桶 1，未收口）；`src/explorerActions.ts:111-115` 的注释指针已由上一轮订正到 14a 那份 | 同上，未复核 | — | — |
| 10 | 桶 10b 第 1 条（Run Anything 的 cwd） | **执行侧其实早做过**；两半登记（H6） | 已在：`src/runActions.ts:444` 签名 `runExternalTool(command, name, cwd?)`、`:465` `cwd: cwd?.trim() \|\| workspace.value.root`。缺：`src/components/RunAnythingDialog.vue:17`/`:43` payload 不带 `cwd`（属桶 9b，`runAnythingContext.ts` 还在 orphan 基线 8 条里）+ `src/App.vue:2648`（保留） | 请求自己声明上游 `platform/execution-impl/src/com/intellij/execution/runAnything/` 在本 checkout find 无命中 ⇒ 无法核实，不引坐标（与本仓 `runActions.ts:463-464` 的注释一致） | — | — |
| 11 | 桶 10b 第 2 条（滚轮总闸 / 终端基准字号） | **做不到，整条登记** | 落点确认是 `src/components/TerminalPanel.vue:81`（`WHEEL_FONT_ZOOM_ENABLED = true`）与 `:102-103`/`:402`/`:411` 的 `TERMINAL_BASE_FONT_SIZE`；但新键要同时进 `src/settingsModel.ts`（保留）+ `EDITOR_SETTING_KEYS`，设置页那一格在上游是 **Editor › General**（本仓 `src/components/SettingsDialog.vue:722`）。只改 TerminalPanel 读 localStorage = 默认值与今天写死的 `true` 相同、无人能改的旋钮 ⇒ 用户可见行为零变化，按「不放假控件/不留死分支」不做半截 | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:1043` ✅ 实开为 `public boolean isWheelFontChangeEnabled()` | — | — |
| 12 | 桶 10b 第 3 条（ANSI 逐色号） | **做不到，登记** | 出口实测只有三参：`src/terminalColors.ts:85`；`TerminalPanel.vue:256-260` 的 `currentPalette()` 只喂主题 + `--text`/`--editor`。写入方要新增设置页格 + `settingsModel.ts`（保留）⇒ 加第四参就是死分支 | 请求引 `JBTerminalSchemeColorPalette.kt:14-26` —— 未复核（本批没动这条） | — | — |
| 13 | 桶 10b 第 4 条（大文件动作替换） | **做不到，登记** | 生效点 `src/components/CodeEditor.vue`（保留）+ `src/editorCommands.ts`（不属本批）；`LARGE_FILE_DISABLED_ACTIONS` 表按请求约定「等认领再写」 | 未复核 | — | — |
| 14 | 桶 10b 第 5 条（大文件正则提示） | **判词成立（函数确实没有），登记** | 实测 `src/largeFileNotice.ts` 的导出只有 `:14/:22/:30/:34/:42` 五条，**没有** `largeFileRegexNoticeText`；渲染点 `src/components/EditorFindBar.vue` 属桶 5（未收口）⇒ 纯函数与消费点一起做 | 未复核 | — | — |
| 15 | 桶 10b 第 6 条（`elevate?: boolean`） | **做不到，登记** | `src/bridge.ts` 是保留文件；且请求自己说明提权进程拿不到 `run_host` 的继承管道，要先定 daemon/命名管道层 | 未复核 | — | — |
| 16 | 桶 5b **W-5** 可视区首行 | **模块侧 + 判据早做过；登记宿主四行**（H5） | 模块：`src/stickyLines.ts:69-71`/`:74-83`/`:96` 齐全；判据：`tests/sticky-lines.test.mjs:76-91`（四条断言，含「首行正好是可视区顶行 ⇒ 不必重复钉」）。本批只订正过期判词：`src/stickyLines.ts:108-116` | `platform/platform-impl/src/com/intellij/openapi/editor/impl/stickyLines/VisualStickyLines.kt:67-86` 与同目录 `StickyLinesManager.kt:32,86,111`（沿用 `src/stickyLines.ts` 里已核过的坐标，源码注释引用未改动） | `tests/sticky-lines.test.mjs` **5/5**（含那条顶行筛选）；宿主锚点全部现读现核：`src/App.vue:503`（`createStickyLines` 没给 `firstVisibleLine`）、`:2194`（`@cursor` 那一行）、`src/components/CodeEditor.vue:95`（`defineEmits`）/`:1006-1026`（updateListener） | 不适用（无新断言） |
| 17 | 桶 5b **W-2**（顺带核实，不在派单内） | **其实早做过** | 请求写「`src/App.vue:2169-2171` 的 sticky 只是纯文本、还带 `aria-hidden`」——实测现树 `src/App.vue:2191` 已是 `role="button" tabindex="0"` + `@click="revealLocation(stickyRevealTarget(…))"` + `title` 「跳转到第 N 行」，`aria-hidden` 已去掉；判据 `tests/editor-sticky-navigate.test.mjs`（本批跑过，绿）。过期判词已在 `src/stickyLines.ts:108-116` 订正留痕 | 同上 | `tests/editor-sticky-navigate.test.mjs` 并入那轮 **33/33/0** | — |

## 2. 本批跑过的每条命令与数字

| 命令 | 数字 |
| --- | --- |
| `node --experimental-strip-types --test tests/tool-window-view-panels.test.mjs tests/file-type-ignored-list.test.mjs tests/ext-external-tools-records.test.mjs tests/external-tools-model.test.mjs` | **34 tests / 34 pass / 0 fail** |
| 上面四条之外的整域回归：`grep -rl` 出所有引用 `ToolWindowView / externalTools / src/main.ts / explorerActions / stickyLines / testLocator` 的 41 个判据文件，一起跑 | **352 tests / 352 pass / 0 fail**（11.2s） |
| `node --experimental-strip-types --test tests/pv-command-wiring.test.mjs tests/test-locator.test.mjs tests/test-tree-view.test.mjs tests/sticky-lines.test.mjs tests/editor-sticky-navigate.test.mjs` | **33 / 33 / 0** |
| `node --test tests/module-size.test.mjs` | **5 / 5 / 0**（中途红过一次，见下） |
| `node --test tests/source-citations.test.mjs` | **3 / 3 / 0**（本批新增的每条完整上游坐标都被机器核过一遍） |
| vcvars64 + `cmake --build build` + `ctest --test-dir build` | **`100% tests passed, 0 tests failed out of 37`**（两轮：加判据后、压缩注释后；看的是日志里这一行，不是 npm 退出码） |
| `build/settings_transfer_test.exe` 直跑 | 5 条 `ok` + `settings_transfer: all checks passed` |
| `npx vue-tsc -b --force` | **0 错**（日志 0 行） |
| `node .tools/find-param-props.mjs` | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | **干净** |
| `node .tools/find-missing-ext.mjs` | 扫描 1209 文件，**干净** |
| `node .tools/find-orphan-modules.mjs --gate` | **已登记孤儿 8 / 基线 8 · 新增 0 · 清掉 0 → 绿** |
| `node .tools/find-orphan-modules.mjs --dead-imports` | 冗余 import **11 → 9 处**（ToolWindowView 的两条已消失） |

没有跑全量 `npm test`（主代理在同一棵树上收口）。

## 3. 本批自己引入并修掉的红（如实登记）

1. `native/settings_schema.cpp` 从 1070 → **1107 行**，`module-size` 的 native 门禁红（`1107 > 1100`）。
   **没有调上限**（该判据文件是保留文件，也不许调），把自己的注释从 14 行压到 8 行、`outputFilters` 的两条守卫并成不带花括号的写法 ⇒ 现 **1099 行**，门禁复绿 **5/5/0**，native 判据与 ctest 重跑仍 **37/37**。
2. `tests/file-type-ignored-list.test.mjs` 的反证第一版**假绿**：判据用 `indexOf('loadIgnoredPatterns()')`，而我在 `src/main.ts` 写的订正注释里就有这个字面量 ⇒ 删掉真调用也不会红。改成只认行首语句后，注入才如实报红（见判决表第 6 行）。

## 4. 做不到 / 无法核实清单

- **App.vue 余量**：H1（0 行，改现有行）、H3（+6 行）、H4（0 行，改现有行）、H5（App.vue +2 行、CodeEditor.vue +3 行）。
  H3 与 H5 一起接需要主代理先腾出 8 行以上——本批不碰该文件，具体行数已按现树实测给出。
- **无法核实（本批未据此下结论，沿用请求原文标注）**：桶 10b 的 Run Anything 上下文（上游目录在本 checkout 无命中）、
  `JBTerminalSchemeColorPalette.kt:14-26`、`MarkRootActionBase.java:52-56`、`JarApplicationConfigurationType.java:19-22`、
  `PlatformActionsReplacer.java:22/:57`、`LfeEditorActionHandlerDisabled.java:13-17`、`LargeFileRegexSearchNotificationProvider.java:21`、
  `ElevationDaemonProcessLauncher.kt`。要落这些条目时再逐条开。
- **订正留痕汇总（共 7 处）**：
  ① 11c W-B11c-1 的宿主行号 `App.vue:2254` → **2283**（`src/testLocator.ts:34-39` 已改）；
  ② `JavaTestLocator.java` 的 `OpenFileDescriptor` `:112-117` → **:111-117**；
  ③ 15 W2 的「前端侧不需要改动」——**假的**，`toolRecordsFrom` 原先只读 `entry.name/entry.command`（`src/externalToolsRecords.ts:10-27` 留痕 + 判据钉住）；
  ④ `Tool.java` 的 `outputFilters` `:77` → **:78**（bean 跨度 `:56-78`，`src/externalToolsRecords.ts:3-4`、`native/settings_schema.cpp:263`）；
  ⑤ 15 W3 的第二坐标 `:1363-1364` → **:1236-1238 + :142**（`src/main.ts:20-29`、`tests/file-type-ignored-list.test.mjs:145-153`）；
  ⑥ 15 W3 的代码 `applyIgnoredPatterns(loadIgnoredPatterns())` → **只调 `loadIgnoredPatterns()`**（`:226-230` 已 apply，套一层多写一次 localStorage）；
  ⑦ 14a W1 的 `MarkRootGroup.java:16-22` → **:14-22**、`actions.xml:252-253` → **:252**；另 5b W-2 的「sticky 点不动」判词已过期（见判决表第 17 行）。

## 5. 改动文件清单（12 个，App.vue 不在内）

`native/settings_schema.cpp`、`native/settings_schema.hpp`、`native/settings_transfer_test.cpp`、
`src/main.ts`、`src/explorerActions.ts`、`src/externalToolsRecords.ts`、`src/stickyLines.ts`、`src/testLocator.ts`、
`src/components/ToolWindowView.vue`、`tests/tool-window-view-panels.test.mjs`（新建）、
`tests/file-type-ignored-list.test.mjs`、`tests/ext-external-tools-records.test.mjs`；
交付文档：本文件 + `docs/wiring-requests-2026-10-06-bucketW.md`。
