# 批次 2026-10-06 · setkeys（设置项与设置页装配一次落齐）

派单：把各代理这一轮欠的**设置键 + 设置页格子**落齐，每个键都要有真实消费方；四处登记一处不能少；
新增键一律「旧存档缺键补默认」，不许按字段数量判损坏。
可改面：`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`native/settings_schema.cpp`、
`native/settings_schema.hpp`、`src/components/SettingsDialog.vue`、`src/previewSettings.ts`。
越界改动（写在下面 §2，逐条留痕）：`src/editorFileOps.ts`（3 行）、`tests/save-transforms.test.mjs`（一条断言按
文件所有者的书面要求翻转）。禁改面一个没碰：`src/App.vue`、`CodeEditor.vue`、`bridge*.ts`、`keymap*.ts`。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本地已解压，逐条打开核对过）。

---

## 1. 判词表（族 / 项 / 判定 / 上游坐标 / 本仓落点 / 一句话）

### 1.1 保存时两条 pass（`docs/wiring-requests-2026-10-06-saveops.md` ②③）

| 项 | 判定 | 上游默认值出处（逐条打开核实） | 本仓落点（四处） | 消费方 |
|---|---|---|---|---|
| `stripTrailingSpaces='Changed'` | `[x]` | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:73`（初值 `STRIP_TRAILING_SPACES_CHANGED`）、三档字面值 `:216-218`（`None`/`Changed`/`Whole`）、读接口 `:826-829` | ① 类型 `src/settingsModel.ts:410` ② 默认 `:223` 那一行 ③ 白名单 `native/settings_schema.hpp:91` ④ 默认值 `native/settings_schema.cpp:410`；非布尔 ⇒ 校验分支 `native/settings_editor_keys.hpp` + 预览白名单/取值 `src/previewSettings.ts` | `src/editorSaveTransforms.ts:148-160` 的 `saveTrimOptionsFromSettings`（`:368-372`/`:387-391` 两档判定），经 `src/editorFileOps.ts:236-246` 喂真值 |
| `ensureNewLineAtEof=false` | `[x]` | 同文件 `:74`（`IS_ENSURE_NEWLINE_AT_EOF = false`）、读接口 `:804-806` | 同上四处（`cpp:410`、`hpp:91`） | 同上 + `applySaveTextTransforms` 的末行换行段 |
| `keepTrailingSpacesOnCaretLine=true` | `[x]` | 同文件 `:142`（`KEEP_TRAILING_SPACE_ON_CARET_LINE = true`）、读接口 `:1144-1146` | 同上四处 | 同上 + `src/editorSaveTransforms.ts:418-433` 的 `ensureNewLineAtEnd` |
| `removeTrailingBlankLines` | `[-]` **不落** | 同文件 `:75`（默认 false） | —— | 本仓**没有这一条的执行体**（`docs/batch-2026-10-06-saveops.md` 判词只点名两条 pass；`tests/save-transforms.test.mjs` 里它被钉成「只有契约字段、没有执行体」）。落了就是一格假控件 ⇒ 与接线请求同判断 |
| 设置页那三格（解锁） | `[x]` | 控件在 `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt`：`:156-157` `cdStripTrailingSpacesEnabled`、`:147-149` `cdEnsureBlankLineBeforeCheckBox`、`:153-155` `cdKeepTrailingSpacesOnCaretLine`；文案 `platform/ide-core/resources/messages/ApplicationBundle.properties:359/815/689`，下拉两项 `:242-243` | `src/components/EditorSavePassesFields.vue`（新，56 行）挂在 `src/components/SettingsDialog.vue` 的 `editor`（编辑器 › 常规）fieldset 里 | 同 1.1 的三个键；`tests/save-transforms.test.mjs` 末条已按请求翻成正向判据 |
| 上游那两格在 `tools.actionsOnSave`？ | `[~]` | 上游 `formatOnSave` 那一条在 Tools ▸ Actions on Save，而这三格在 **Editor ▸ General**（`EditorOptionsPanel.kt`） | 本批按**上游位置**落进 `editor` 那一节（接线请求写的是「现 :837 附近」即 actionsOnSave 那一节 —— 原写 X、实际 Y，留痕见 §2） | —— |

### 1.2 块注释 / 回车的三个开关（`docs/wiring-requests-2026-10-06-bucket5b.md` 的 W-4 ②，`bucket5c.md` §2 同一件事）

| 项 | 判定 | 上游默认值出处 | 本仓落点 | 消费方（执行体） |
|---|---|---|---|---|
| `autoInsertPairQuote=true` | `[x]` | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:140`（`AUTOINSERT_PAIR_QUOTE = true`）；开关注释见 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/QuoteHandler.java:10-20` | 四处：`settingsModel.ts:427`/默认行、`settings_schema.hpp:94`、`settings_schema.cpp:413`、`previewSettings.ts`（布尔，走末尾 `typeof` 兜底） | `src/editorTyping.ts:120` 的 `smartQuotes`，**已挂在生产**：`src/components/CodeEditor.vue:968`（订正：`bucket5b.md` W-1 说「没有任何生产消费方」，实际早已挂上，`tests/editor-quote-faces.test.mjs:96-100` 就是钉这条的） |
| `insertBraceOnEnter=true` | `[x]` | 同文件 `:130`（`INSERT_BRACE_ON_ENTER = true`） | 四处同上（`cpp:413`） | `src/enterHandlers.ts:180` 的 `enterAfterUnmatchedBrace`，调用点 `:281`（生产路径：`CodeEditor.vue:968`/`smartEnterCommand`） |
| `closeCommentOnEnter=true` | `[x]` | 同文件 `:132`（`CLOSE_COMMENT_ON_ENTER = true`） | 四处同上 | `src/editorEnterBlockComment.ts:176-178` 的第 4 参 `closeOnEnter`（现按默认 true 走），调用点 `src/enterHandlers.ts:253` |
| W-4 ①（`block` 词法喂进提供方） | `[-]` **不在本面** | `java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28/:32-33/:62-63/:67-68` | 目标文件是 `src/components/CodeEditor.vue:114-118` ⇒ 派单禁改 | 可照抄的那一行在 `docs/wiring-requests-2026-10-06-setkeys.md` K-2 |
| 设置页那三格 | `[x]` | 行位置：`platform/lang-impl/src/com/intellij/application/options/editor/EditorSmartKeysConfigurable.kt:49-51`（Insert pair quote）、`:69-72`（Insert pair `}'）、`:74-76`（Close block comment）；文案 `ApplicationBundle.properties:409/413/411` | `src/components/EditorEnterKeysFields.vue`（新，35 行）挂在 `editor.preferences.smartKeys` 的 fieldset（与已有的「粘贴时」`reformatOnPaste` 同一个 CodeInsightSettings 族） | 同 1.2 的三个键 |

### 1.3 Code Vision 设置页与持久化（`docs/wiring-requests-2026-10-06-bucket3b.md` 的 W4）

| 项 | 判定 | 上游出处 | 本仓落点 | 消费方 |
|---|---|---|---|---|
| `codeVisionEnabled=true`（总闸） | `[x]` | `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:36`（`State.isEnabled = true`）、门面 `:55-60`；页名与文案 `platform/lang-impl/resources/messages/CodeVisionBundle.properties:2-3` | 四处：`settingsModel.ts:445`/默认行、`settings_schema.hpp:97`、`settings_schema.cpp:416`、`previewSettings.ts` | `src/codeLensSettings.ts:93` 的 `isCodeVisionGloballyEnabled` → `:119-124` 的 `shouldShowCodeVisionEntry`；**渲染侧过滤点还没接**（`shouldShowCodeVisionEntry` 今天只有 import、没有调用点）⇒ 请求 K-4 |
| `codeVisionDisabledGroups=[]` | `[x]` | 同文件 `:45`（`disabledCodeVisionProviderIds`，注释 `:41-44`：只装与出厂相反的那一半） | 四处同上；数组键 ⇒ 校验分支 `native/settings_editor_keys.hpp`（组 id 白名单 = 本仓两组） | `src/codeLensSettings.ts:86-90` 的 `isCodeVisionGroupEnabled` + `:102-105` 的 `setCodeVisionGroupEnabled`（右键「隐藏这一组」在 `src/codeLensExtension.ts:134-136` 真在写这张表） |
| `codeVisionEnabledGroups=[]` | `[x]` | 同文件 `:50`（`enabledCodeVisionProviderIds`） | 四处同上 | 同上；本仓两组出厂都开 ⇒ **界面不假装能往这里写**（上游 `setProviderEnabled` 对出厂开的 provider 也只动 disabled 表），存/取两侧仍成对（`codeVisionSettingsPatch()` / `restoreCodeVisionSettings()`） |
| `codeVisionVisibleEntries=5` | `[x]` | 出厂 5：`CodeVisionSettings.kt:38-39`（`visibleMetricsAboveDeclarationCount` / `visibleMetricsNextToDeclarationCount`）；**界 1..10**：`platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/CodeVisionGlobalSettingsProvider.kt:43` 的 `spinner(1..10, 1)`；文案 `CodeVisionBundle.properties:17` | 四处同上；整数键 ⇒ 校验分支在 `settings_editor_keys.hpp`，预览侧同界 | `src/codeLens.ts:149-150` 的 `groupAnchoredLenses(lenses, limit)`（出厂 `CODE_LENS_VISIBLE_MAX = 5`，`:127`）；调用点 `src/codeLensExtension.ts:238` 目前没传 limit ⇒ 请求 K-4 |
| Code Vision 设置页 | `[x]` | 分组名 `settings.hints.new.group.code.vision`（`ApplicationBundle.properties:725-726`，上游把它当 Inlay Hints 页里的一个**分组**）；页的两行 spinner `CodeVisionGlobalSettingsProvider.kt:38-47` | `src/components/CodeVisionSettingsPage.vue`（新，93 行）+ 树节点 `src/settingsTreeMeta.ts:128`（键 `code.vision`，**本仓起的**，上游那个 configurable 的注册行不在本地树里 ⇒ 不编 id）+ `PAGE_KEYS:187` | 页面同时写「草稿对象（保存走对话框「应用」）」与「运行时表 `codeVisionSettings`」，`onMounted` 打开页面即按盘上那份刷运行时（`syncRuntime`） |
| 每格都有真实消费方？ | `[~]` | —— | 见 §6：总闸与每组开关的**渲染侧过滤点**、可见条数的 **limit 传参**、启动时的 **restore** 三处各差一行，都在他人名下文件里，逐条给了可照抄代码 | —— |

### 1.4 扫其余 `docs/wiring-requests-2026-10-06-*.md` 里目标是这六个文件的条目

| 条目 | 判定 | 理由（动手前自己打开核过） |
|---|---|---|
| `bucket3a.md` R4（`showQuickDocOnMouseHover` / `autoUpdateDocumentation` 登记） | `[x]` 已落 | 键名与默认档由 `src/docHoverPolicy.ts:47-57` 的 `DOC_HOVER_SETTING_KEYS` 定死、`tests/doc-hover-policy.test.mjs:37` 钉着 ⇒ 逐字取用。上游 `EditorSettingsExternalizable.java:76`（`SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true`）与 `DocumentationToolWindowManager.kt:55`（`documentation.auto.update` 默认 true）。四处：`settingsModel.ts:462/464`、`hpp:100`、`cpp:419`、`previewSettings.ts`。界面 = 快速文档齿轮（`src/components/QuickDocPopup.vue` 的 `v-if="canToggleHover"` 那条，`emit('policy-change', toggleDocHoverPolicy(key))` 产出的正是这两把键的补丁）⇒ **不在设置页另造一格**。写回与读回的喂线在请求 K-5 |
| `bucket5b.md` W-4 ① | `[-]` 不在本面 | 目标 `src/components/CodeEditor.vue:114-118`（禁改）。见请求 K-2 |
| `bucket5c.md` §2（`closeCommentOnEnter` 三处协同） | `[x]` 我这一半已落 | 它写的「第 1/2 处（settingsModel）由主代理落、第 3 处（`enterHandlers.ts`）等我确认后补」⇒ 键已落，第 2 处的 `CodeEditor.vue` 一行与第 3 处归他们：请求 K-2/K-3 |
| `bucket10b.md` 第 1 条（终端滚轮总闸 + 终端基准字号） | `[ ]` **本轮不落** | ① 消费点在他人文件（`src/components/TerminalPanel.vue:81` 的占位常量与 `:88-105` 的 `baseFontSize`），只落键就是「没人读的旋钮」；② **默认值冲突**：上游 `EditorSettingsExternalizable.java` 的 `IS_WHEEL_FONTCHANGE_ENABLED = false`，而本仓现在写死 `true` ⇒ 落键并照上游会把已有行为悄悄关掉，必须与桶 10 一起定夺（`docs/wiring-requests-2026-10-06-bucketW.md:118` 已把这条登记为「不做半截」）。见请求 K-6 |
| `bucket10b.md` 第 2 条（ANSI 16 色逐色号） | `[ ]` 不落 | 写入方要新增一格 + `src/terminalColors.ts` 加第四参，色板页在他人名下（同上登记理由） |
| `bucket2c.md` W4（行内补全 provider 开关） | `[ ]` 不落 | 「本仓只有一条 LSP 供给 ⇒ 只能做成一条固定开关」，且 `inlineCompletionExtension.ts` 没有读设置的入口 ⇒ 假开关。见请求 K-7 |
| `bucket14c.md` §4 / `bucket7b.md` 第 1 条（浏览器族：`browserList` / `defaultBrowserPolicy` / `useDefaultBrowser` / `browserPath`） | `[ ]` 不落 | 要动 `native/main.cpp` + 新 `native/browser_launch.cpp` + `CMakeLists.txt` + `src/bridge.ts` 的 `Method` union（四者全在禁改面/保留文件）。键面单独落 = 存了一份没人执行的表。见请求 K-8 |
| `bucket11c.md`/`bucket12b.md` 的 `'jar'` 运行配置类型 | `[ ]` 不落 | `RunConfig['type']` 联合在 `settingsModel.ts:26`，但另外两张表（`src/runConfigEditors.ts:90`、`src/runConfigTree.ts:16`）不在本面 ⇒ 只改联合会直接编译不过（`settingsModel.ts:19-25` 的自陈就是这么写的）。见请求 K-9 |
| `bucket15.md` 第 3 条（`externalTools` 可选字段放开，目标 `native/settings_schema.cpp:262-271`） | `[x]` **早做过** | 本仓现状已含 `useConsole`/`showConsoleOnStdOut`/`synchronizeAfterExecution`/`outputFilters` 那几条分支（`native/settings_schema.cpp:286-300` 一带，`grep -c outputFilters` = 7），`settings_schema.hpp:124` 的注释也写了「2026-10-06 放开」⇒ 判词说缺、其实早做过（规则 §1 里那一类），无需再动 |
| `bucket6b.md`（音频提示两键） | `[x]` 早做过 | `GeneralSettingsState.audioCuesMode` / `audioCuesDisabled` 已在 `src/settingsModel.ts:135/141` + `settings_schema.hpp:111` + `cpp` 默认值表里 |

**合计**：新落 **12 把键**（保存 3 + 回车 3 + Code Vision 4 + 快速文档 2）、**3 个新设置页/字段组组件**、
**1 个新原生头文件**、**1 条新树节点**；`defaultEditorSettings` 从 **68 键 → 80 键**。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 这次动了什么 |
|---|---|---|---|
| `src/settingsModel.ts` | 400 | 465 | `EditorSettings` 加 12 把键（含逐条上游坐标注释），`defaultEditorSettings` 那一行加 12 个默认值 |
| `src/settingsTreeMeta.ts` | 183 | 190 | `PageKey` 加 `code.vision`、`SETTINGS_NODES` 加该页、`PAGE_KEYS` 加该页；lucide 导入加 `Eye` |
| `native/settings_schema.hpp` | 173 | 186 | `EDITOR_SETTING_KEYS` 加 12 个键名（带上游出处注释） |
| `native/settings_schema.cpp` | 1099 | **1099** | 加 12 条默认值 + 一个 `validate_editor_added_key` 调用分支；**同时把 `validate_language_flags` 与 `editor_languages` 搬出去**（净 0 增长，上限 1100 没抬） |
| `native/settings_editor_keys.hpp` | —— | 80（新） | 拆出来的模块：语言标记表 + `validate_language_flags` + 新增非布尔键的校验。头文件不进 `CMakeLists.txt` ⇒ 没动那个保留文件 |
| `src/previewSettings.ts` | 60 | 75 | 预览态白名单加 12 把键 + 三处取值校验（枚举 / 1..10 / 组 id 数组） |
| `src/components/SettingsDialog.vue` | 1176 | 1181 | 三行挂载（`editor` 节 / `smartKeys` 节 / `code.vision` 节）+ **一行**导入三个组件（上限 1182，只 +5：见 §3） |
| `src/components/EditorSavePassesFields.vue` | —— | 56（新） | 保存 pass 三格 |
| `src/components/EditorEnterKeysFields.vue` | —— | 35（新） | 回车与引号三格 |
| `src/components/CodeVisionSettingsPage.vue` | —— | 93（新） | Code Vision 页（总闸 + 两组开关 + 可见条数），同时刷运行时表 |
| `src/editorFileOps.ts` | 274 | 280 | **越界 3 行**：`:239-246` 把 `settings: {}` 换成读 `editorSettings.value` 的三个真值（`bucket` 接线请求 ③ 逐字给的那一段，原样照抄）。留痕：派单写「消费方已存在」，实际 `:240` 传的是空对象 ⇒ 键不落就是永远走上游默认档 |
| `tests/setkeys-batch.test.mjs` | —— | 212（新） | 12 把键的四处 + 旧存档 + 校验分支 + 界面同源的 20 条门禁（含反证） |
| `tests/save-transforms.test.mjs` | 335 | 347 | **越界 1 条**：末条「设置页没有渲染还没有消费链路的格子（不放假控件）」按该文件所有者 `wiring-requests-…saveops.md` ③ 的书面要求从「不许渲染」翻成「渲染了就必须绑到同名键」，断言**没删**、标题没改 |

### 留痕（原写 X / 实际 Y，规则 §1）

1. 原写「消费方已存在（`src/editorFileOps.ts:227-255`）」→ 实际 `:240` 是 `settings: {}`，键没落之前执行体只能走上游默认档 ⇒ 本次一并把那一处接上真值（越界 3 行，已列 §2）。
2. 原写「`transformOnSave` 已经在 `App.vue` 的 `save()` 里被调用」→ 实际 `src/App.vue` 里 **没有** `transformOnSave` 调用点（只有 `runActionsOnSave`，`src/App.vue:1125`）⇒ 端到端还差 `App.vue` 那一段（请求 ①.1/①.2 已给可照抄整段），本批禁改 `App.vue`。
3. 原写「`smartQuotes` / `angleBraceHighlight` 没有任何生产消费方」（`bucket5b.md` W-1）→ 实际两者已挂在 `src/components/CodeEditor.vue:968`，`tests/editor-quote-faces.test.mjs:96-100` 就是钉这条的 ⇒ `autoInsertPairQuote` 的执行体在生产里是活的。
4. 原写「右键『隐藏这个 provider / 全部隐藏』的动作已经生效」（`bucket3b.md` W4）→ 实际 `shouldShowCodeVisionEntry` 只有 `src/codeLensExtension.ts:34` 的 import、**没有调用点**，`buildDecorations`（`:233-248`）没过滤 ⇒ 今天隐藏只改表、不改画面。请求 K-4。
5. 原写三格落点为「`SettingsDialog.vue` 现 :837 附近」（即 Tools ▸ Actions on Save 那一节）→ 上游这三格在 **Editor ▸ General**（`EditorOptionsPanel.kt`）⇒ 按上游位置挂进 `editor` 那一节。

---

## 3. §5 每条自查命令的前后数字

| 命令 | 前（开工时的基线） | 后（收工） |
|---|---|---|
| `npx vue-tsc -b --force` | 别的半区在途红（同一棵树当晚出现过 65 条被一个语法错遮住的情况，无法取干净基线）；本批改到一半时测过一次：**8 条**，全在别人名下 | **收工时 1 条**，在 `src/templateMacros.ts`（模板宏半区在途）。**我改的 6 个授权文件 + `src/editorFileOps.ts` + 3 个新组件 + 1 个新头文件 = 0 条**（按文件名 `grep` 输出为空；中途那 8 条分别在 `src/App.vue` 6 / `VcsLogTable.vue` 1 / `fileChooserHostState.ts` 1，都不是本批碰过的） |
| `node --test tests/module-size.test.mjs` | 全绿（基线） | 本批相关的两条判据**全绿**：`native/settings_schema.cpp` 1099 ≤ 1100（加了 12 把键之后**没有增长**，靠把 `validate_language_flags` 搬进 `settings_editor_keys.hpp`）、`SettingsDialog.vue` 1182 ≤ 1182（只 +5，三个新组件同一行导入）。**全量当前红在 `src/components/SearchPanel.vue`(920 > 900) 与 `native/git.cpp`(954 > 938)** —— 都是别的半区在途文件，本批没抬任何上限、没登记任何豁免 |
| `node .tools/find-param-props.mjs` | 0 | **0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新测试文件里零 TS 语法） |
| `node .tools/find-missing-ext.mjs` | 干净 | 扫描 1228 个文件：**干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 8 / 基线 8；红在 `src/terminalHyperlinks.ts` | 已登记孤儿 8 / 基线 8；**本批 4 个新文件（1 hpp + 3 vue）都不是孤儿**（hpp 被 `settings_schema.cpp` include 并调用，三个组件都挂在 `SettingsDialog.vue`）。收工时新增 1 个，在别人名下：`src/components/ColorSchemeSettingsPage.vue`（色板半区在途；`terminalHyperlinks.ts` 与 `templateMacros.ts` 已被他们自己接上） |
| `node --test tests/settings-keys-parity.test.mjs` | 5 绿 | **5 绿**（这条门就是「四处登记」的机器面：新键一漏任何一处立刻红） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 红在他人文档/代码的假路径 | 11 条里 **9 绿 2 红**，两条红都指向同一个失败项 `src/vcsLogGraph.ts :: platform/vcs-log/impl/.../CollapseGraphAction.java:13-38（38 > 34）` —— 别人名下。本批新写的每一条 `路径:行号` 都被这条门过了一遍（`EditorSettingsExternalizable.java:73/74/76/142/216-218`、`CodeInsightSettings.java:130/132/140`、`EditorOptionsPanel.kt:147-157`、`EditorSmartKeysConfigurable.kt:49-76`、`CodeVisionSettings.kt:36/38-39/45/50/55-60`、`CodeVisionGlobalSettingsProvider.kt:43`、三个 bundle） |
| 改了 `native/` ⇒ ctest | —— | 先 `call vcvars64.bat` 再 `cmake --build build` + ctest：**`100% tests passed, 0 tests failed out of 59`**（日志 `build/tmp-setkeys-ctest.txt`）。第一次不带 vcvars 直接 `cmake --build` 会因 `<filesystem>` 找不到而失败、而包装脚本退出码仍是 0 —— 正是规约 §5 说的那个坑，按日志那行判 |
| 只跑自己域的测试（**没跑全量 `npm test`**，12 路并行） | —— | 15 个文件的域内集（setkeys / settings-keys-parity / doc-hover-policy / doc-hover-content / navbar-members-setting / save-transforms / actions-on-save / editor-enter-block-comment / editor-enter-handlers / editor-quote-faces / code-vision-providers / code-vision-local-channel / cv-local-vision / code-lens / code-lens-grouping）：**167 tests / 167 pass / 0 fail**。中途一次带上 module-size 的跑法是 172 里 2 红，红的就是上面那两个别人名下的巨型文件 |

---

## 4. 新门禁的反向验证记录（三步数字）

`tests/setkeys-batch.test.mjs` 共 **20 条**。

| 轮次 | 注入了什么 | 红了几条 | 撤掉后 |
|---|---|---|---|
| M1 | 从 `defaultEditorSettings` 删 `codeVisionVisibleEntries: 5`、从 `settings_schema.hpp` 删该键名、从 `previewSettings.ts` 删该 `key ===` 一处 | 17 条里 **fail 3**（「四处登记」那条 / 「旧存档缺键」那条 / 「预览态取值校验」那条） | **17 pass / 0 fail** |
| M2 | 把 `native/settings_schema.cpp` 的 `validate_editor_added_key(it.key(), value)` 换成 `false`、把 `onMounted(syncRuntime)` 注释掉、把下拉的 `v-model` 换成 `:value` | setkeys 17 里 **fail 2**（「非布尔键的校验分支」/「Code Vision 页接进运行时表」）+ `save-transforms` 32 里 **fail 1**（末条那条正向绑定的判据） | setkeys **17/0**、save-transforms **32/0** |
| M3（键名本身） | 测试文件里自带一条**常驻**反证（把 12 把键名分别从五处 `replaceAll` 成 `zzAbsent`，断言那五条正则一条都不成立） | —— | 这条判据本身就在 20 条里，跑绿 = 正则「吃得住内容」而不是「文件里有字就算过」 |

---

## 5. 旧存档迁移判据（数字）

* 机制（不是「按字段数量判损坏」）：`native/project_settings_state.cpp:39` 先 `known_keys(...)` 只核对**顶层**五个键；
  `:40-41` `prune_unknown` 把 editor/general 里**未知**的键剪掉并只回报 discarded（**不判坏**）；
  `:44` `validate_editor_patch` 严格校验剩下的键；`:46-48` **逐键**按 `editor_defaults_impl()` 补缺。
  所以新增一把键 = 在白名单 + 在默认值表（+ 非布尔时在校验里有分支），旧存档一律照读。
* 数字：`defaultEditorSettings` 的键数 **68 → 80**（本批 +12）；判据测试里那份「旧存档」夹具
  是把这 12 把键全删掉，剩余键数 **68**，断言 `Object.keys(migrated)` 与其余 68 个键**逐个相等**
  （少一个或多一个都红），并断言 `rest.length > 50` 保证它是一份**大**存档而不是三两份字段。
* 前端这一侧不造值：`normalizeEditorSettings(legacy)[key] === undefined`（补默认发生在原生默认值表那一层，
  与 `tests/navbar-members-setting.test.mjs:43-52` 同一口径）。
* 非布尔键若不写校验分支的后果也钉在测试里：新存档存进去 → 下次读盘落到「Editor flags must be JSON booleans」
  那条兜底 → `STATE_CORRUPT` ⇒ 用户被锁在项目外那一类事故。**这条判据（M2 那一轮）验证过是真会红的。**

---

## 6. 零消费方自查结论

| 键 | 执行体（真实存在、逐条打开核对） | 端到端还差哪一行 | 状态 |
|---|---|---|---|
| `stripTrailingSpaces` / `ensureNewLineAtEof` / `keepTrailingSpacesOnCaretLine` | `src/editorSaveTransforms.ts:148-160` + `applySaveTextTransforms`；`src/editorFileOps.ts:236-246`（`:242-246`）已喂真值 | `src/App.vue` 的 `save()` 里调 `transformOnSave`（接线请求 ①.2 给了整段可照抄） | `[~]` 差 `App.vue` 一行 |
| `closeCommentOnEnter` / `insertBraceOnEnter` / `autoInsertPairQuote` | `src/editorEnterBlockComment.ts:176-192`、`src/enterHandlers.ts:180/:281`、`src/editorTyping.ts:120`（已挂在 `CodeEditor.vue:968`） | `CodeEditor.vue:114-118` 的提供方多回三个字段 + `enterHandlers.ts` 的 `EnterLanguage` 多三个可选字段（`bucket5c` 自己承诺键落地后就补第三处） | `[~]` 差两行（请求 K-2/K-3） |
| `codeVisionEnabled` / 两个组集合 / `codeVisionVisibleEntries` | `src/codeLensSettings.ts:93/102/119-124`、`src/codeLens.ts:149-150`；页面已把盘上那份刷进运行时表 | `src/codeLensExtension.ts` 的 `buildDecorations` 过滤 + `groupAnchoredLenses(lenses, limit)` 传参 + 启动时 `restoreCodeVisionSettings` | `[~]` 差三行（请求 K-4/K-5'） |
| `showQuickDocOnMouseHover` / `autoUpdateDocumentation` | `src/docHoverPolicy.ts:73-79`（`docHoverPolicyFromSettings`，「只有显式 false 才算关」⇒ 缺键=默认开）、`:82` 的 `docHoverPolicyPatch`；运行时单例被 `src/quickDocHost.ts:327` 与 `src/docHoverContent.ts:24` 真读 | `src/settingsPersistence.ts:86` 之后灌一次 + `App.vue` 接 `@policy-change`（`bucket3a` R2/R3） | `[~]` 差两行（请求 K-5） |
| 新文件 | `settings_editor_keys.hpp`（被 `settings_schema.cpp` include 并被调用）、三个 `.vue`（都挂在 `SettingsDialog.vue`） | —— | `[x]` 无孤儿（orphan 门禁的输出里没有它们） |

**没有渲染任何没有执行体的格子**：`removeTrailingBlankLines`（无执行体）、终端滚轮/基准字号、ANSI 逐色号、
行内补全 provider、浏览器表、`'jar'` 类型 —— 一律不落键、不落界面。

---

## 7. 做不到 / 无法核实

1. **端到端还差 8 行，全在禁改面**：`src/App.vue`（`transformOnSave` 调用 + `@policy-change`）、
   `src/components/CodeEditor.vue`（enter/quote 三个字段 + `block` 词法）、`src/enterHandlers.ts`
   （`EnterLanguage` 三个可选字段）、`src/codeLensExtension.ts`（过滤 + limit）、`src/settingsPersistence.ts`（读回）。
   逐字代码都在 `docs/wiring-requests-2026-10-06-setkeys.md`。⇒ 现在这 12 把键是「存得下、界面能改、
   执行体在等最后那一行喂值」；**不写这些线，键就是死的**，请主代理按 K-1…K-5 派给对应半区。
2. **`CodeVisionConfigurable` 的注册行无法核实**：本地树里只有它的 bundle 文案
   （`CodeVisionBundle.properties:2-5`）与 `CodeVisionGlobalSettingsProvider`，`grep` 全树没有
   `<...configurable ... id="code.vision">` 那条注册，也 `find` 不到 `CodeVisionConfigurable.kt`
   ⇒ 页树的**层级**按 bundle 的分组名（`settings.hints.new.group.code.vision`）推断，页键 `code.vision`
   写明是本仓起的，没有编造上游 id。
3. **`autoUpdateDocumentation` 上游是注册表属性**（`documentation.auto.update`），不是 `EditorSettingsExternalizable`
   的持久化字段 ⇒ 本仓把它升格为持久化开关（与 `fuzzyFileSearch` / `autoShowProcessPopup` 同一处理口径，
   那两条的注释在 `settings_schema.hpp:128-130`）。
4. **中文文案**：本地化包不在本地树 ⇒ 12 格的中文全部是英文原文直译，每条注释里都写了对应的
   `Bundle.properties:行号`（`EditorSavePassesFields.vue` / `EditorEnterKeysFields.vue` / `CodeVisionSettingsPage.vue` 文件头）。
5. **没跑 `npm test` 全量**（规约 §5：12 路并行，全量会把别人的在途红算到我头上）。
