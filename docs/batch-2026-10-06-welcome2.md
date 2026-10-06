# 桶 welcome2 · 14c 五条逐条复核收口 + 14b「跟随光标」复核 · 2026-10-06

范围：`docs/wiring-requests-2026-10-06-bucket14c.md` 的 5 条接线请求**逐条核**后做掉名下那一半；
宿主/桥那一侧全部写进 `docs/wiring-requests-2026-10-06-welcome2.md`（R0-R7，行号本轮实测）。
并复核 `docs/batch-2026-10-06-bucket14b.md` §5-1 那条「结构视图跟随编辑器光标」在
`:source` 接上之后是否真生效。

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
下表每条上游坐标本轮都亲手打开对过行号（不是转抄 14c / welcome.md / 14b 的旧报告）。

---

## 1. 判词表（14c 五条 + 14b 复核条）

| # | 族 / 项 | 判定 | 上游相对路径:行号（本轮实测） | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| 1a | 文件选择器左栏「最近」接真数据 | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:186-191`（storeSelection：选中即记）、`platform/platform-impl/src/com/intellij/openapi/fileChooser/impl/FileChooserUtil.java:33-34`（键 + 30 上限） | `src/App.vue:1421-1424`（宿主第二档 = `filenameRecentRows`）、`src/App.vue:2364`（`:recent="chooser.recent()"`）、`src/fileChooserHostState.ts:28-88`（选择器自记一档 + localStorage 持久） | 14c 请求要的两半（宿主 seed + 组件绑定）**已在盘上**（并行轮落的）；本轮端到端复核：数据流通、上限/去重口径同上游、判据在 `tests/file-chooser-model.test.mjs`。 |
| 1b | 文件选择器左栏「收藏」接真数据 | `[-]` 不做，具体理由 | `platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/UniversalFileChooser.kt:304-305`（左栏 splitter）与 `:677-697`（`createLocationsPanel` = Home/Desktop/Project 三个固定位置）；`fileChooser/` 全包 grep `favorite` **零命中** | `src/fileChooserModel.ts:331-346`（注释已如实登记）、`src/fileChooserHostState.ts:69-71` | 「收藏」这一栏**上游没有** —— 14c 第 1 条的上半句（接收藏）依据不成立；数据源给不出来不是断链而是编造。现状 = 空档不渲染（`v-if`），不是假控件。删栏 / 换固定位置 / 保留要主代拍板，方案与影响文件清单写在 welcome2 R6。 |
| 2 | 未信任项目开外部链接前那一句 | `[~]` 本桶已有；还差宿主四个出口 | `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`（`:69-71` 已信任不问、`:72-80` 三按钮 + 默认 Open `:79` + 焦点 Trust `:80`、`:83` Open 不放信任、`:84` Trust 才落库、`:85` 其它不开）、调用点 `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`（`:96` trim、`:99` canBrowse）、文案 `platform/platform-api/resources/messages/IdeBundle.properties:3149`/`:3151`/`:3152`/`:3153` | `src/trustedProjects.ts:138-192`（`externalLinkPrompt`/`externalLinkOutcome`/`browseWithTrustCheck`）、`src/components/TrustedProjectDialog.vue:53-62`（`mode="link"` 三按钮，顺序照上游 `buttons(yesLabel, trustLabel, noLabel)`）、判据 `tests/welcome-trust-dialog.test.mjs` | 规则 + 弹框 + 判据三件齐；断的只剩**调用点**：四处 `shell.openUrl` 出口（`src/App.vue:998`/`:1414`、`TerminalPanel.vue:350`、`quickDocHost.ts:250`）全在保留/他人文件 ⇒ welcome2 R2（可照抄代码已给）。上游的文件级那一支（`BrowserLauncherImpl.kt:88-108`）本仓存储只有目录级 ⇒ 做不到，写进模块头。 |
| 3 | 信任框「始终信任此来源」勾选 | `[~]` 本桶已有（本轮文案订正）；还差落库两行 | `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`（TRUST_AND_OPEN 且 `parent != null && isTrustAll` → 父目录写 `TrustedPathsSettings`）、`platform/platform-impl/src/com/intellij/ide/trustedProjects/impl/TrustedProjectsStartupDialog.kt:86-95`（勾选框 + tooltip 给父路径；`:89` 名字过 `shortenTextWithEllipsis(·,40,0,true)`）、门禁 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:96-106`（配置目录里的项目不给这一项）、文案 `IdeBundle.properties:2949` | `src/trustedProjects.ts:212-241`（`TRUST_ALL_LABEL` 模板 + `trustAllLabel`/`shortenFolderName` 本轮新增；`trustDecisionPaths`/`applyTrustDecision`/`isProjectLocationOfferedForTrust` 复核在位）、`src/components/TrustedProjectDialog.vue:49-52,90-98`（勾选按 `canTrustAll` 渲染 + 带文件夹名 + tooltip）、判据 `tests/trusted-trust-all.test.mjs` + `tests/welcome-trust-dialog.test.mjs` 前 2 条 | **留痕**：模块注释原写「本仓不渲染这个勾选」+ 文案「始终信任来自此来源的项目」（14c 转述、非上游原文），实际组件早已条件渲染；本轮按 `:2949` 原文直译改成带 `{0}` 文件夹名的模板（40 字截断逐字照上游），并订正三处 canBrowse 行号差一（`:82/:83/:84` → `:83/:84/:85`）与「TrustedProjectStartupDialog 资源包」这个基准树里不存在的路名（真源是 `impl/TrustedProjectsStartupDialog.kt`，早先只写了类名没写路径所以引用门没抓到）。断链 = 宿主没传 `can-trust-all` 且 `resolveTrustPrompt` 只收两参（`src/App.vue:2622`、`src/workspaceLifecycle.ts:90,120-123,127-128,133`）⇒ welcome2 R3（含 `appConfigDir` 来源与「不给 config-dir 就别给 canTrustAll」的警示）。 |
| 4 | 「用指定浏览器打开」宿主通道 | `[-]` 宿主侧全部在保留文件；规则侧 `[x]` | `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:54-57`（`getDefaultBrowser` 只在 `FIRST` 给 `firstActiveBrowser`）、`platform/platform-api/src/com/intellij/ide/BrowserUtil.java:92-133`（`:124-130` = 真文件那一档 `[exe, ...args, url]`）、`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:211-224`（`:215-217` 路径空 = `showError` **不回退**；`:220` 参数取 additionalParameters）、`:259-265`（系统默认命令表）、`platform/platform-impl/src/com/intellij/ide/browsers/BrowserSettingsPanel.kt:83`/`:111`/`:115`、注册 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1306`、`BrowserLauncherImpl.kt:133-149`（showError 通知） | `src/browsers.ts:361-417`（`browserLaunchPayload`/`normalizeBrowserSettings`，判据 `tests/welcome-browsers-launch.test.mjs` 6 条） | 通道四层（`native/browser_launch.cpp` 新文件、分派点实测在 `native/file_queries.cpp:236-237` 而非 main.cpp、`src/bridge.ts:109`、`native/settings_schema.cpp` 两键补默认）全部主代独占 ⇒ welcome2 R5 整段可照抄。**没建浏览器设置页是对的**：通道不在，表格选完无处可去 = 假控件。 |
| 5 | 选择器多选 | `[-]` 维持不做，具体理由 | `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:452`（`getSelectedFiles()` 数组）、`:552`（`VIRTUAL_FILE_ARRAY`） | `src/fileChooserDescriptor.ts:92-102`（三个多选取舍 + `:48` `chooseMultiple`） | 本轮 grep 复核：`chooseMultiple` **仍无任何生产调用点**（生产侧只有 `pickDirectory`、插件包/目录、JDK/输出目录，全单选）⇒ 行上做 Ctrl/Shift 就是假控件。两文件都在本桶名下，触发条件与实现方案钉在 welcome2 R7。 |
| 6 | 14b 复核：结构视图「跟随编辑器光标」接上 `:source` 后真生效？ | `[x]` 生效（行粒度），差列一项已核已请求；**本桶修了名下断点两处** | `platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:655-661`（`scrollToSelectedElement` 先判 `AUTOSCROLL_FROM_SOURCE`）、`:829-835`（光标监听；开关打开时**立即**选一次不等第一次移动）、`platform/structure-view-impl/src/com/intellij/ide/structureView/impl/StructureViewFactoryImpl.java:49-50` 两开关默认值（前轮 14b 已核，本轮复核语义） | 链路逐环实测：`src/components/ToolWindowView.vue:170`（`:source="ctx.todoSource"` 已落）→ `src/toolViewContext.ts:116`（`todoSource.value`，外层 ctx 是 computed ⇒ 光标动即重算）→ `src/components/OutlinePanel.vue:74-86`（watch 换算 `line - 1`、展开祖先、`scrollRowIntoView`）→ `src/outlineView.ts:127-145` → `src/structureFollow.ts:88-90`（1 基列→0 基列） | 结论：**不是假控件了，行粒度真的跟随**（开关按 `v-if="source"` 画、开了会立刻跟随、光标动会选中+滚动）。复核揪出两处名下断点并已修：① `caretSymbolInTree` 同一行多符号时「后面的覆盖前面的」——光标在 `int a;` 上会选到 `b`（`src/outlineView.ts` 新增 `pickCaretCandidate`：按光标列锚定最近起点、行首兜底取文档序第一个；上游按偏移取元素，同一口径）；② 判据 `tests/outline-caret-source.test.mjs:76` 把宿主 `todoSource` 的形状钉成精确匹配，R1 落地加 `character` 时会假红 ⇒ 改前缀钉（行为不变：仍钉 path/line 都在）。剩下的断点只有一截在保留文件：`src/App.vue:215` 的 `{ path, line }` 没有列 ⇒ welcome2 R1 一行替换（`Tab.column` 早已在维护：`src/editorTab.ts:8` + `src/App.vue:2123`）。开关打开即刻选一次的语义与上游 `:833-835` 对齐（watch 键含开关位 ⇒ 一开就触发）。 |

## 2. 改动文件清单（接手时 → 现在，`wc -l`）

| 文件 | 前 → 后 | 本轮内容 |
|---|---|---|
| `src/trustedProjects.ts` | 433 → 453 | trust-all 文案订正为上游 `{0}` 模板 + `trustAllLabel`/`shortenFolderName`；过期注释「本仓不渲染这个勾选」改成实况；canBrowse 三处行号差一订正；假路径 `TrustedProjectStartupDialog` 订正为 `impl/TrustedProjectsStartupDialog.kt`；文件级分支 `:89`→`:88` |
| `src/components/TrustedProjectDialog.vue` | 105 → 110 | 勾选框文案走 `trustAllLabel(props.root)`；`title` 挂父目录完整路径（上游 `:94-95`）；注释坐标订正 |
| `src/outlineView.ts` | 145 → 163 | `caretSymbolInTree` 的同行兄弟选中改「偏移锚定优先、文档序兜底」；`walkCaret` 重写为单层候选 + 下钻 |
| `src/components/OutlinePanel.vue` | 176 → 176 | 纯注释订正（`src/App.vue:208` → 实测 `:215`） |
| `tests/welcome-trust-dialog.test.mjs` | 158 → 168 | 文案钉值按上游 `:2949` 重写（**留痕**：原钉的是 14c 转述文案，「钉错了值」理由 = `IdeBundle.properties:2949` 带 `{0}` + `StartupDialog.kt:89` 截断口径）；新增文件夹名/截断两条判据 |
| `tests/outline-caret-source.test.mjs` | 81 → 97 | 新增「同一行两个符号时选光标包住的那一个」3 断言；宿主形状钉死改前缀匹配（防 R1 假红） |
| `docs/wiring-requests-2026-10-06-welcome2.md` | 新 | R0-R7（§7） |

未动任何保留文件；`App.vue`/`CodeEditor.vue`/`settingsModel.ts`/`settings_schema.*`/`bridge*`/`projectTree*`/`explorerActions.ts`/`toolWindow*` 零改动（改完 `git diff` 逐文件复看过 hunk，全部是本桶的）。

## 3. §5 自查（前 → 后）

- `npx vue-tsc -b --force`：接手时全仓 **10 条错**（App.vue×2、bookmarkActions×1、editorFoldingController×3、gradleHost×1、toolWindowManager×1、toolWindowStripes×2 —— 全在他人/别桶在途文件）⇒ 收工复跑**同样这 10 条、一条不多**；本桶名下 4 个 .ts/.vue **0 错**（错误清单里没有本桶文件）。
- `node --test tests/module-size.test.mjs`：前 5/5 绿 → 后 **5/5 绿**（上限未动；最大改动文件 `trustedProjects.ts` 453 / `outlineView.ts` 163，均远小于 900）。
- `node .tools/find-param-props.mjs`：前「共 1 处」（`src/testTree.ts:103`，别桶在途）→ 后 **0 处**（那 1 处在收工前被其所属桶清掉，非本桶改动）；`find-ts-in-mjs.mjs`：前干净 → 后**干净**；`find-missing-ext.mjs`：前「扫描 1273 个文件干净」→ 后**干净**。
- `node .tools/find-orphan-modules.mjs --gate`：前「已登记 9/基线 9 · 新增 1（`src/structuralCodeBlock.ts`，搜索桶在途）红」→ 后**同样新增 1、还是它**；本桶无新模块，`trustAllLabel`/`shortenFolderName` 消费方 = `TrustedProjectDialog.vue`，`pickCaretCandidate` 是 `outlineView.ts` 私有。
- `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs`：写文档前 11/11 绿 → 两份交付文档落盘后 **11 条里 2 红**：其中本桶 1 红（`StructureViewFactoryImpl` 少写了一层 `impl/` 包名，**已订正后消掉**），另一红**不属本桶** = 别桶文档 `docs/batch-2026-10-06-completion2.md` 引的 `platform/analysis-api/src/com/intellij/codeInsight/SuppressIntentionAction.java :19`（**转述假写法时刻意把冒号前留一个空格**：规约 §5 —— 引用门会把文档里转述的「路径:行号」也当成一条真引用收集，原样抄就再造一条红）——基准树实测该文件在 `platform/analysis-api/src/com/intellij/codeInspection/`（`codeInsight` 包名编错），那份文档不在本桶名下、不越界代改，真路径留痕在此给主代/该桶。**2026-10-06 citefix 复核补全真坐标**：`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`（98 行文件，第 19 行逐字 `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`）⇒ 行号与内容都对，只有包名错，见 `docs/batch-2026-10-06-citefix.md`。最终复跑：`tests 11 / pass 9 / fail 2`，**两条红的引文都是 completion2 那一条**（citations 与 anchors 各扫一遍同一句话）；本桶的全部引用（两张表 + 两份文档）逐条指得到。本轮新增的上游坐标全部实测过；批评旧写法时不带行号，防被收集成真引用。
- ctest：本桶**没动 `native/`**（通道全在保留文件，交了请求）⇒ 不适用，未跑。
- 域测试（只跑自己域，按规约不跑全量 `npm test`）：`node --test tests/welcome-*.test.mjs tests/file-chooser-*.test.mjs tests/todo-*.test.mjs tests/outline-*.test.mjs tests/structure-follow.test.mjs tests/pv-history-session.test.mjs` ⇒ 前 **188/188** → 后 **190/190**（+2 条新判据，一条未删未松）；同组再并上 `tests/trusted-*.test.mjs` 五条 = **229/229**（含 `tests/trusted-trust-all.test.mjs` 复核：文案值改动没破它——它只钉「非空字符串」；`tests/trusted-locations-union.test.mjs` 亦绿，设置页并集读的就是模块那份会话档，R4 落地后无需动它）。

## 4. 反向验证（新判据注入违规 → 红 → 撤 → 绿）

1. **同行兄弟选中**（`tests/outline-caret-source.test.mjs` 新增条）：把 `pickCaretCandidate` 的 `if (!first) first = node` 注回旧语义（后写覆盖）⇒ `tests 6 / pass 5 / fail 1`（✖「同一行两个符号时选光标包住的那一个」）⇒ 还原（`/tmp` 备份拷回）⇒ `6/6 绿`，`git diff` 无残迹。
2. **trust-all 文案取自模块**（`tests/welcome-trust-dialog.test.mjs` 第 1 条）：把组件里 `{{ trustAllLabel(props.root) }}` 注回裸 `{{ TRUST_ALL_LABEL }}` ⇒ `tests 12 / pass 11 / fail 1`（✖「trust-all 那一格要宿主明说接得住才画」）⇒ 还原 ⇒ `12/12 绿`。
3. 临时备份 `/tmp/ov.bak`、`/tmp/tpd.bak` 与 `build/tsc-welcome2.log` 已删净。

## 5. 零消费方自查

本桶**没有新增文件级模块**；新增导出 `trustAllLabel`/`shortenFolderName` 生产消费方 = `src/components/TrustedProjectDialog.vue`（渲染勾选框文案）；`pickCaretCandidate` 为文件私有、被 `caretSymbolInTree` 消费。孤儿门禁的红点（`src/structuralCodeBlock.ts`）接手前就在、不属本域，不越界处理。

## 6. 做不到 / 无法核实

1. **外部链接那一句的四个调用点**：卡在 `src/App.vue`（主代独占）与 `TerminalPanel.vue`/`quickDocHost.ts`（他桶在途）。规则与弹框都齐，缺的只是「出口处问一句」——代码已写好放在 welcome2 R2，一次装配即通。
2. **trust-all 落库 + 三参 `resolveTrustPrompt`**：卡在 `src/App.vue:2622` 与 `src/workspaceLifecycle.ts:90-133`（不在名下）⇒ R3；其中 `appConfigDir` 只能取 `app.info.profile`（宿主没有更小的配置根 getter），拿不到 `getOriginalConfigDir` 的精确等价物，已如实写在请求里。
3. **会话级信任两份并存**：`src/workspaceLifecycle.ts:91` 的本地 ref 不在本桶名下 ⇒ R4（4 行）。
4. **指定浏览器启动通道与设置页**：`native/*`、`CMakeLists.txt`、`src/bridge.ts`、`native/settings_schema.cpp`、`src/settingsModel.ts` 全为保留 ⇒ R5；**通道不在时建页面 = 假控件**，故本批不建。`environmentVariables` 一项桥载荷没有格子，上游 `BrowserLauncherAppless.kt:221` 做不到，写在 `src/browsers.ts:370-375` 模块注释里。
5. **文件级信任那一句**（`Trust File and Open`）：本仓信任存储只有目录级（`native/trusted_paths.cpp` 三道硬边界按目录判），上游那一支的落库点不存在 ⇒ 做不到，登记在 `src/trustedProjects.ts:117-121`。
6. **收藏栏去留**：上游依据不存在已核实（§1 表 1b），但 (a) 删栏要连带动 `src/App.vue` 两处绑定 ⇒ 主代拍板后按 R6 执行；本轮不擅删（上一桶已把它升格给主代，welcome2 维持该决定并给出建议 (a)）。
7. **无法核实**：无 —— 本轮每张表的每个上游坐标都亲手打开对过行号；两处发现旧报告差一行（canBrowse when 分支、confirmOpeningUntrustedFile 起点），一处发现基准树不存在的文件路径名（只写了类名那种），均已订正并留痕（§1 表 3 最后一栏）。

## 7. 需要主代理接的线

见 `docs/wiring-requests-2026-10-06-welcome2.md`：R1（App.vue 一行，跟随补列）、R2（外部链接四出口）、R3（canTrustAll + 三参落库 + appConfigDir）、R4（会话档并一份）、R5（`shell.openUrlWithBrowser` 四层 + 设置键默认）、R6（收藏栏拍板）、R7（多选触发条件）。R2/R3 落地时要反转 `tests/welcome-trust-dialog.test.mjs` 末尾那条「宿主还没接」钉（文档里写了反转点）。
