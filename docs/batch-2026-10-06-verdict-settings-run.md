# 批次报告 · 2026-10-06 · `settings-run` 域逐类判决（B11）

交付三件：`docs/inventory/verdict-settings-run.md`（判决，§G 逐类表）、`tests/b11-verdict.test.mjs`（门禁）、
`docs/inventory/settings-run_verdict_table.json`（判决真源：每条的 kind/继承链/EP/字段命中/判词）。
**没有改任何 `src/**`、`native/**` 源码**（派单纪律：`src/settingsModel.ts`、`native/settings_schema.*` 只读）。

## 1. 门禁状态与反向验证

`node --test tests/b11-verdict.test.mjs` → **10 tests / 10 pass / 0 fail**（只跑这一个文件，没跑全量 `npm test`）。

| 注入的假判决（临时副本，`B11_VERDICT` 指过去跑） | 变红的用例 |
|---|---|
| §G 里把一条 `[x]` 的本仓引用改成 `src/thisFileDoesNotExist.ts` | 「每个 [x]/[~] 行指到真实存在的 src/ 或 native/ 文件」 |
| §G 删掉一行（`AutoTestWatcher`） | 「§G 每类恰好一行」+「表头计数与四档和数」（2 红） |
| §G 追加一行伪造类 | 同上 2 红 |
| 表头四档 `6` 改成 `7`（和数不自洽） | 「表头计数与四档和数」 |
| 把接口 `SearchableConfigurable` 改判 `[-]` 并塞 `[控件本体 JComponent]` 理由 | 「每条 [-] 与机械事实互证」+「接口/抽象类不得 [-]」+「§B 自证」（4 红） |

对照（未注入的原文件）：10 全绿。测试文件是纯 JavaScript（无 `as`/`satisfies`/类型标注），
门禁只解析 `## G. 逐条总表` 之后的行，§A–§F 的说明表不参与机检。

## 2. 四档计数与已判行数

- **当前已判 3247 行 = 扫描件 3247 类**（`docs/inventory/settings-run.txt` 自己数：`wc -l` 3247，与 `settings-run_signals.json` 的 `total` 一致）。
- 四档：**`[x]` 6 + `[~]` 46 + `[ ]` 2927 + `[-]` 268 = 3247**。
- `[-]` 268 的构成：上游测试源码集 126、`package-info` 35、控件本体（具体类）103、平台专属 4。
- 证据分布（§0）：名字在本仓 `src/`+`native/` 真实代码里出现 41、只在注释里 383、从未出现 2726、非专名剔除 97。
- 声明类型：class 1918 / interface 552 / abstract 527 / object 86 / unknown 164。

## 3. §B 规则收紧（原规则 → 新规则 → 误判样例）

**原规则**（上一任留下的机械判据）：文本里出现 `JComponent`/`JPanel`/`JBPopup`/`paintComponent` ⇒ `[-]`，理由写「行为由本仓 DOM 落点承担」。
本域按这个口径会命中 **620** 条（`settings-run_signals.json` 的 `swing`）。

**新规则**：只有**具体类**（kind = `class`/`object`）的本体继承 Swing/JB 控件本体（解析声明头的继承链），或自带 `paintComponent` 自绘，才 `[-]`；
且理由必须写「哪个具体控件本体（继承链）+ 行为由本仓哪个**真实存在**的 DOM 落点承担」（门禁逐条 `existsSync`）。
接口、抽象类、契约/模型/持久化性质的类一律按行为判 `[x]/[~]/[ ]`。
按新口径真控件只有 **103** 条，**43** 条被误降的契约救回（清单在判决 §D 末）。

| 样例 | 上游 | 旧规则判 | 新规则判（现判词） |
|---|---|---|---|
| `SearchableConfigurable`（接口，签名里返回 `SearchableDescriptor[]`，文中出现 `JComponent`） | `platform/ide-core/src/com/intellij/openapi/options/SearchableConfigurable.java:18` | `[-]` ⇒ 缺口被抹掉 | `[ ]`：可搜索性契约缺——本仓设置搜索 `src/settingsSearch.ts` 是中心化关键词表，没有「页自报命中」的接口面 |
| `SettingsEditor`（接口） | `platform/ide-core/src/com/intellij/openapi/options/SettingsEditor.java:25` | `[-]` | `[ ]`：component/reset/applyData/fromSettings/addListener 五段协议缺失 |
| `RunConfigurable`（abstract class，含 `JPanel`/`Tree` 字段） | `platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt:134` | `[-]` | `[ ]`：运行配置页契约与筛选/模板/排序面未移植（本仓是 `src/components/RunConfigurationsDialog.vue` 硬编码） |
| `LinkAction`（abstract AnAction，`createCustomComponent` 返回 `JComponent`） | `platform/diff-impl/src/com/intellij/diff/actions/impl/LinkAction.kt:15` | `[-]` | `[ ]`，并且**同名不同义已排除**：本仓 `src/documentLinks.ts:32` 的 `LinkAction` 是文档链接判别联合，不是 diff 动作 |
| `MethodListDlg`（具体类，`extends DialogWrapper` + `JList`/`JPanel`） | `java/execution/impl/src/com/intellij/execution/MethodListDlg.java` | `[-]` | 仍 `[-]`（真控件本体），理由带继承链与 DOM 落点 `src/components/RunConfigurationsDialog.vue` |

门禁自证（`tests/b11-verdict.test.mjs` 第 8 条用例）：把 `kind:'interface'` + `widget:true` 的假事实喂进 `isSwingBody` 必须返回 `false`；
`kind:'class'` + `widget:true` 或 `paint:true` 才返回 `true`；并要求 §G 里 `SearchableConfigurable`/`SettingsEditor` 两行不是 `[-]`。

**顺带踩到的第二个同名假命中**（已修）：本仓有同名定义不等于移植。机械口径 originally 给出 18 条 `[x]`，
逐条读上下游源码后降到 6 条：`LinkAction`/`MergeResult`/`MessageReader` 同名不同义、`ListeningPort`/`TargetEnvironment` 形状近似但成员缺；
另有 7 条（`TestTreeExpander`/`AutoTestManager`/`UsageOptions`/`FindInProjectRecents`/`CommandHistory`/`RunDashboardGroup`/`HighlightPolicy`）
因上游成员/谓词没对齐降 `[~]`。保留的 6 条 `[x]`：`ComparisonPolicy`、`HighlightingLevel`、`MergeRange`、`MergeConflictType`、`TargetPlatform`、`AutoTestWatcher`。
`.vue` 的 `<!-- -->` 也按注释算（早先口径把它当代码，虚增了 30 余条「真实代码命中」）。

## 4. 缺失设置项清单（本域最可执行的结论）

口径（判决 §C）：① 上游 `@State(name/id/fqn)`；② 上游 `@Option(tag)`/`@Tag`/`@Property` + 类级字段；
③ 本仓键空间 = `native/settings_schema.cpp` 的 JSON 键与 `it.key()` 分支 + `src/settingsModel.ts` 字段 + `src/settingsTreeMeta.ts` 节点，机械数出 **187** 个标识符。
匹配用归一化驼峰值整词相等 ⇒ 「命中」不保证语义同一，「未命中」不保证功能不存在。

总量：187 个设置项持有者里 **141 个提不出持久化字段**（多是「页」不是「存储 bean」）、**9 个字段 0 命中**、**37 个部分命中**；
**36 个带 `@State` EP 名的类，EP 名在本仓键空间全部 0 命中**（本仓不按 EP 分段存）。

**最值得先做的 20 条**（上游依据 → 本仓建议落点；键类一律按「缺键补默认值、不按键数判损坏」落地）：

| # | 上游依据（路径:行） | 缺什么 | 本仓建议落点 |
|---:|---|---|---|
| 1 | `platform/ide-core/src/com/intellij/openapi/options/Configurable.java:133` | 设置页契约对象（isModified/apply/reset/helpTopic） | 新建 `src/settingsContract.ts`；`src/settingsTreeMeta.ts` 节点挂契约；`src/components/SettingsDialog.vue` 按契约渲染 |
| 2 | `.../options/UnnamedConfigurable.java:24` | apply/reset 相位 + 全局脏态汇总 | 同上 + `src/settingsDraft.ts`（已有草稿态） |
| 3 | `.../options/SearchableConfigurable.java:18` | 页自报搜索命中与权重 | `src/settingsSearch.ts` + `src/settingsSearchController.ts` |
| 4 | `.../options/ConfigurableEP.java:40` | 声明式 id/orderWeight/parentId/noIdCard | `src/settingsTreeMeta.ts`（顺序改声明驱动）、`src/settingsBadge.ts` |
| 5 | `.../options/ConfigurableProvider.java:13` | 按可用性决定页是否出现 | `src/settingsTreeMeta.ts` + `src/languages.ts`/`src/languageRuntimes.ts` 的可用性 |
| 6 | `.../options/SettingsEditor.java:25`（+`CompositeSettingsEditor.java:20`） | 编辑器泛型协议与子编辑器组合 | `src/runConfigEditors.ts`（已有 Record<type,表单>，缺协议层） |
| 7 | `.../options/ExtendableSettingsEditor.java:18`、`ExtensionSettingsEditor.java:7` | 扩展点向设置页注入行（Java/JAR 扩展靠它） | `src/runConfigEditors.ts` + `src/settingsTransfer.ts` |
| 8 | `.../options/SettingsEditorListener.java:8` | 「改动即脏」通知通道 | `src/settingsDraft.ts`、`src/settingsInspector.ts` |
| 9 | `platform/platform-impl/src/com/intellij/openapi/options/BeanConfigurable.kt:20` | 字段元数据自动铺 UI 行 | `src/generalSettingsLocal.ts` + `src/components/SettingsDialog.vue` 的行渲染 |
| 10 | `.../options/ex/ConfigurableExtensionPointUtil.java:41`、`ConfigurableWrapper.java:39` | 树 + 面包屑 + 搜索行的装配层 | `src/settingsTreeMeta.ts`、`src/settingsSearch.ts` |
| 11 | `platform/editor-ui-api/src/com/intellij/ide/ui/UISettings.kt:46`（40 字段，命中 12） | 缺 `ideAAType`/`editorAAType`/`allowMergeButtons` 等 28 项 | 键：`native/settings_schema.cpp`（补默认值分支）+ `src/settingsModel.ts` GeneralSettingsState；UI：`src/components/SettingsDialog.vue` |
| 12 | `platform/editor-ui-api/src/com/intellij/ide/ui/NotRoamableUiSettings.kt:25`（14/3） | `fontFace`/`fontScale`/AAType | 同上（本仓已有 `uiFontFamily`/`uiFontSize`，续别名即可） |
| 13 | `platform/platform-impl/src/com/intellij/openapi/options/advanced/AdvancedSettingsImpl.kt:277` + `AdvancedSettingsConfigurable.kt:83`（35/6） | 高级开关的分组/标题/tooltip/依赖 | `src/registryKeys.ts` + `src/components/GeneralRegistryToggles.vue`（现在是平面表） |
| 14 | `platform/diff-impl/src/com/intellij/diff/tools/external/ExternalDiffSettings.kt:23`（23/4） | 外部差异工具表（diffToolName/3way/忽略空白） | 新 `ExternalDiffSettingsPage.vue`，参考 `src/components/ExternalToolsSettingsPage.vue`；键落 schema |
| 15 | `platform/diff-impl/src/com/intellij/diff/tools/util/base/TextDiffSettingsHolder.kt:28`（23/4） | 按 place 的同步滚动/对齐改动/高亮策略设置 | `src/diffNavigation.ts`、`src/diffAlign.ts`、`src/diffWords.ts`（算法已有，缺设置键与 UI 行） |
| 16 | `platform/lang-impl/src/com/intellij/execution/console/ConsoleFoldingSettings.java:26`、`java/execution/impl/src/com/intellij/execution/filters/StackTraceFoldingSettings.kt:19` | 折叠名单的**页内编辑行**（键 `foldConsoleLines`/`foldExceptions` 本仓已在 `native/settings_schema.cpp:173`/`:277`，属别名已落） | `src/consoleFold.ts` + 新 UI 行；**这条是「判词说缺、其实早做过」的订正实例** |
| 17 | `platform/execution-impl/src/com/intellij/execution/runToolbar/RunToolbarSettings.kt:22`（5/1） | `slotOrder`/`uid` 持久化 | `src/runToolbarSlots.ts` + schema 新键（补默认值） |
| 18 | `platform/execution-impl/src/com/intellij/execution/ui/layout/impl/RunnerLayoutSettings.java:22` | `runner.layout.xml` 的格位与权重 | `src/runToolWindowLayout.ts`、`src/toolLayouts.ts` |
| 19 | `platform/xdebugger-impl/src/com/intellij/xdebugger/impl/settings/XDebuggerGeneralSettings.java:10`（6/3）+ `XDebuggerDataViewSettings.java:22`（3/1） | `evaluation-dialog-mode`/`scroll-to-center`/`run-to-cursor-gesture` 等 | `src/debugSettingsStore.ts` + `src/components/DebuggerSettingsPage.vue`（该页已存在，缺这几格） |
| 20 | `platform/execution/src/com/intellij/execution/target/TargetEnvironmentsManager.kt:20`（9/2）+ `TargetEnvironmentDetailsConfigurable.kt:16`、`LanguageRuntimeConfigurable.kt:18` | 目标环境的默认项持久化 + 详情/运行时两个子页 | `src/targetEnvironments.ts`、`src/executionTargets.ts`、`src/components/TargetEnvironmentsDialog.vue` |

（§C-1 另有按「字段数」降序的 26 行完整表，§C-2 是上面 1–10 的契约层逐条依据。）

## 5. 没做完的部分还剩多少

- **逐条读上游类体的只有 68 条**：§A 6 + §B 46 + §C-2 契约 16（其中 4 条与 §B 重叠）。其余 **2927 条 `[ ]` 是机械判词**（声明类型 + 名字/键三态命中 + 缺哪一环），没打开类体 ⇒ 判词是**待核实断言**。
- `[ ]` 里 **383 条只有注释证据**（其中 333 条注释没给落点）、**2726 条名字从未出现**；异名同义只抽查了 §C-1 前 26 条（发现 §C-4 那三族假缺口）。
- **施工图未做**：只到「哪个类、哪些字段、缺哪一环」，没做「补一个键要改哪几个文件、改哪几行」。
- **上游文案未核实**：`getDisplayName`/bundle 只机械抓到 2 条，其余按类名推断，未作判据。
- 本域 `[ ]` 占 90%，按 §2 的 `[x]`+`[~]` = 52 条对照，**绝大多数执行链/调试器/差异/测试发现的本体仍未移植**；
  与 `toolwindow`（350 类里 `[x]`+`[~]` = 116）比例差得远，主因是判据更严（要求同名定义 + 真实落点 + 逐条复核），不全是本域真的更空。

## 6. 接线请求（给桶 8，本轮按纪律未动源码）

- 目标文件：`native/settings_schema.cpp`（各设置段的默认值表 + `known_keys` 白名单）与 `src/settingsModel.ts`（`GeneralSettingsState`/`EditorSettings`）
- 要接什么：§4 表里第 11–20 行的缺失键；每键给默认值、读取按 `containsKey` 逐键取
- 为什么需要：这两处是只读保留文件，本域判决的 20 条可执行结论全部要经过它们；**不得按键数判存档损坏**（历史上因此把用户锁在项目外）
- 目标文件：`src/components/SettingsDialog.vue`、`src/settingsTreeMeta.ts`
- 要接什么：§4 第 1–10 行的设置页契约层（新文件 `src/settingsContract.ts` 由后续批次实现，本批只出判词与落点建议）
- 为什么需要：设置页目前是硬编码行表，缺 isModified/apply/reset 相位与页自报搜索，逐页手写校验不可扩展

## 7. 复现口径（判词真源）

`docs/inventory/settings-run_verdict_table.json` 每条含 `kind/sup/paint/os/test/state/psc/fields/keyhit/code/comment/decl_line/verdict/why`；
§G 由它渲染，规则集完整写在判决 §0（信号口径）、§D（`[-]` 四条判据）、§F（门禁）里，
判定顺序：`package-info` → 测试源码集 → 控件本体（具体类）→ 平台专属（路径/类名）→ 本仓同名定义 → 名字真实命中 → 注释指到落点 → 其余 `[ ]`。
临时脚本在仓库外，**判决真源在库内**（JSON + md + 测试），重跑只需照 §0/§D/§F 的规则再走一遍。
