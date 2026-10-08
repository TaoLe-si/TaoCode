# batch · 2026-10-06 · refview（把「用法/引用」真的挂进工具窗口宿主）

先读 `.tools/agent-rules.md`（本仓没有 `AGENTS.md`）。上游真源 =
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（禁搜网；下面每条坐标都是本批
自己 `sed`/`grep` 开出来数过行号的）。保留文件（`src/App.vue`、`src/bridge.ts`、`src/style.css`、
`src/tokens.css`、`src/settingsModel.ts`、`CMakeLists.txt`、`scripts/verdict_table.py`、`docs/inventory/*.md`）
**一个都没动**；`src/App.vue` 要动的那一跳写成逐字请求（`docs/wiring-requests-2026-10-06-refview.md` S-RV-1）。
禁改清单里的 `src/components/CodeEditor.vue`、`src/progressNotices.ts`、`src/statusBar*.ts`、
`src/lspServerMessages.ts` 本批**一个字节没碰**。未 commit、未 push，没跑任何丢弃工作区的 git 命令。

⚠ **工作区状态留痕**：本批跑到一半时主代理把整个工作区提交成了 `200232e`
（`git show --stat HEAD` 里能看到 `src/components/ReferencePanel.vue 113 ++++`、
`tests/reference-panel-host.test.mjs 335 ++++`），所以收工时 `git status --short src tests` 对本批文件是**空的**、
`git diff --stat` 也只剩别人的 hunk。这不是"改动丢了"——文件在盘上、测试在跑（下面每一条数字都是重跑的真实值），
只是本批的 diff 归属被并进了那条提交（`git show --numstat HEAD` 里 `ToolWindowView.vue 30/1`、
`toolViewContext.ts 27/1`、`toolWindowMeta.ts 10/0` 这几行**含 hier3 同期未提交的 hunk**，不能整算成本批）。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（本批亲自开过） | 本仓落点（文件:行） | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| 引用挂窗 | 缺的到底是**哪一层** | `[x]` 已核实（结论与派单给的假设**不同**，见留痕） | `platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:118`（`myFindContentManager = toolWindow.getContentManager()`）、`:120-136`（`getOrRegisterFindToolWindow`：`:128-135` `registerToolWindow(ToolWindowId.FIND, …)`、`:133` `shouldBeAvailable = false`）、`:149-190`（`addContent`：`:157-158` 钉住取反、`:162-178` 顶替候选、`:185-189` 先占位再删再选中）；`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewManagerImpl.java:145-163`（`showUsageView` 把组件 add 成 Content 并 `setContent`）；`platform/usageView-impl/src/com/intellij/usages/impl/UsageViewImpl.java:1651-1654`（`getComponent()`）、`:1667-1670`（`setContent`）、`:1786-1791`（`close()` → `closeContent`）；`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:198-243`（`doAddContent`） | 结论：缺**三层**，且**不缺**两层。缺的三层 = ①`ToolWindowView.vue` 模板链没有 `references` 分支（旧行为：掉进 `:220` 的 `<template v-else>`，把引用**画成项目树**）②没有消费行模型的内容组件 ③`ToolWindowViewContext`（`:21`）没有引用那六栏。**不缺**的两层 = `view` 不是联合类型（`ToolWindowView.vue:179` 就是 `view: string`，没有可扩的联合）；`TOOL_WINDOW_REGISTRY` 也不该有它（上游被注册的是**装内容的 Find 窗口**，且是按需注册，内容只是 `addContent`；本仓底部那一格就是那个 ContentManager 的等价物） | 派单假设「view 联合类型缺 references」经核实不成立 ⇒ 按规约 §1 留痕：原写「view 集合」，实际 `view` 是 `string`，缺的是渲染点 |
| 引用挂窗 | 内容组件（行模型有渲染点） | `[x]` 本批做完 | `UsageViewImpl.java:1081-1082`（工具条的 expand/collapse all，本体 `:989` `createActionsToolbar()`）、`:977-985`（`installTreeSpeedSearch` 取 `getPlainTextForNode`）；`platform/usageView/resources/messages/UsageViewBundle.properties:8`（`usages.n`）、`:131`（`usage.view.counter`）、`:19/:20/:21`（Group By / File Structure / Directory Structure） | `src/components/ReferencePanel.vue`（新，113 行）：props `rows/count/query/searching`，emits `open/toggle-group/collapse-all/expand-all/speed-search`；`emptyText()` `:76-79` | 无状态面板：组行整行 = 折叠开关（`activate()` `:66-73`），叶子 = 单击导航 `{path, line, column: character + 1}`；空态三档（正在查找 / `usagesFoundText(0)` / 没有匹配） |
| 引用挂窗 | 宿主分支 + ctx 数据源 | `[x]` 本批做完 | 同上（`UsageViewManagerImpl.java:145-163` 那条"内容 = 一条 Content"） | `src/components/ToolWindowView.vue:15`（import）、`:194-197`（分支）、`:143-165`（ctx 新增六栏）；`src/toolViewContext.ts:16-19`（import）、`:195-207`（透传 `referenceRows/referenceCount/referenceQuery/referenceSearching` + 四个回调） | ctx 是**快照**、由宿主 `src/App.vue:861` 的 `computed` 每次重算 ⇒ 面板动一下折叠态立刻换行（判据第 3 条钉住这条重算链） |
| 引用挂窗 | `references` 出现在内容集合里 | `[x]` 本批有判据（生产函数，不是字符串） | `UsageViewContentManagerImpl.java:149-190`（每条搜索一条 Content）；`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:198-243` | `src/toolWindowActions.ts:113-122`（`bottomTabAvailable`/`bottomContentCount`）、`:162-167`（`bottomTabOptions`：引用逐条列 `references:<id>`）、`:309-311`（`referenceComboOptions`）；判据 `tests/reference-panel-host.test.mjs:209-223` | 两条内容 = 两个选项（combo 形式列得全才选得到）；那一格标题 = 选中那条的 `tabName` |
| 引用挂窗 | 打开后渲染出行模型（SSR 真渲） | `[x]` 本批做完 | `UsageViewBundle.properties:131`（组行计数）、`:8`（空态）；层级次序 `platform/usageView-impl/src/com/intellij/usages/impl/rules/UsageGroupingRulesDefaultRanks.java:26-32`（本批只沿用、未重开，由既有 `tests/usage-view-panel-rows.test.mjs` 头部背书） | `tests/reference-panel-host.test.mjs:146-165`（9 行的文本 + 9 档缩进 + 「没有 `.tree-scroll`」三条一起钉） | 断言的是 `@vue/compiler-dom` 解析出来的**渲染节点**（`ref-row` / `.ref-path` / `.ref-pos` / `padding-left`），不是源码字符串 |
| 引用挂窗 | 关闭后不再占一格 | `[x]` 本批做完 | `UsageViewImpl.java:1786-1791`（`close()` → `closeContent`）、`UsageViewContentManagerImpl.java:219`（`removeContent(content, true)`）、`:57`（`setToHideOnEmptyContent(true)`） | `src/referenceContents.ts:293-302`（`closeReferences` 选中标退回邻居）、`src/toolWindowActions.ts:276-279`（`closeReferenceTab`）、`:287-289`（`watch(hasReferences)` 关到空跳回 output）；判据 `tests/reference-panel-host.test.mjs:265-289`（含 `bottomContentCount` 少一格 + `bottomTab==='output'`） | 关掉最后一条：面板 0 行、那一格从内容集合里消失、宿主跳回输出（三件事同一条判据） |
| 引用挂窗 | `src/App.vue` 那一跳 | `[ ]` 仍缺（保留文件，逐字请求已交） | 同上 | 现状 `src/App.vue:2240-2243` 仍自己画平表；请求 `docs/wiring-requests-2026-10-06-refview.md` S-RV-1 | 两行 new 用现成的 `ToolWindowView` + `toolViewCtx`，**不需要新 import**；本批不动它（规约 §2） |
| 样式 | hier3 留下的「新样式类不在 `style.css`」 | `[x]` 本批绕开而不是求人加 | —— | `src/components/ReferencePanel.vue:100-112`（scoped）+ 复用 `src/style.css:1155-1160` 的 `.ref-list/.ref-item/.ref-path/.ref-pos/.ref-empty` | **留痕**：hier3 的 §3 建议"复用 `.outline-filter`"，实际那一类是 `OutlinePanel.vue:158` 的 **scoped** 类、跨组件不生效 ⇒ 本批自带 `.ref-search`，`style.css`（保留文件）一行没改 |
| 工具窗口 | `ToolWindowViewContext.onExpandAll` 名不副实 | `[~]` 本批降级为可选 + 写请求 | `PlatformActions.xml:1178-1184`（本批未重开，沿用 `src/components/ToolWindowView.vue:234-235` 既有注释的出处） | `src/components/ToolWindowView.vue:139-142`（`onExpandAll?:` + 留痕注释）；`src/toolViewContext.ts:196`（仍透传） | 模板里只有「递归展开」`:237` 与「全部折叠」`:238`，「全部展开」的唯一渲染点在 `gradle` 那一支 ⇒ 必填字段是在替别的窗口说谎；改可选是最小诚实化，补不补按钮交主代理（请求 S-TW-1） |
| 用法视图 | 「导出到文本文件」按钮 | `[-]` 不适用（本批刻意不做） | `platform/usageView-impl/src/com/intellij/usages/impl/ExporterToTextFile.java:31-71`（导出的是缩进树；`UsageViewImpl.java:2260` 那条本批没重开，沿用 `src/referenceContents.ts:116-117` 既有注释） | 模块侧已有 `src/referenceContents.ts:226-228`（`exportReferencesText`）；面板**没有**这个按钮 | 保存通道（`dialog.saveFile`）只在宿主 `src/App.vue` 手里（层级导出用的就是它），`ToolWindowViewContext` 里没有这一栏 ⇒ 画一个存不了文件的导出按钮就是假控件，规约 §3 禁止 |
| 用法视图 | 单击导航的列口径 | `[x]` 本批补齐（与结构视图同一口径） | `UsageViewImpl.java:1906`（`showNode` 走 offset 导航；本批只确认函数存在，具体跳法属 PSI 侧、**无法核实**到列，见 §6） | `src/components/ReferencePanel.vue:66-70` → `src/components/ToolWindowView.vue:196`（`@open="target => ctx.onReveal(target)"`）→ `src/lspNavigation.ts:323`（`revealLocation({path, line, column?})`） | 平表原来只给 `line`；面板给 `column = character + 1`（编辑器 1 基），与 `ToolWindowView.vue:170` 结构视图那条挂载点一字不差 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 这批改了什么 |
| --- | --- | --- | --- |
| `src/components/ReferencePanel.vue` | —— | **113** | 新建：无状态的用法视图内容组件（组行/叶子的两种行、折叠箭头、展开折叠两条、过滤串输入、空态三档、scoped 样式） |
| `src/components/ToolWindowView.vue` | 235 | **264** | import `ReferencePanel` + `import type { UsageTreeRow }`；ctx 新增引用六栏（`:143-165`，含"为什么不进注册表"的上游依据注释）；模板新增 `view === 'references'` 分支（`:194-197`）；`onExpandAll` 改可选（`:139-142`） |
| `src/toolViewContext.ts` | 203 | **220** | 从 `src/referenceContents.ts` 透传 `referenceRows/referenceCount/referenceQuery/referenceSearching` + 四个动作回调（`:195-207`）；新增值 import 带 `.ts` 扩展名 |
| `src/toolWindowMeta.ts` | 268 | **278** | 只加注释：`BOTTOM_TABS` 头上写清 `references` 是**内容**不是注册窗口，并给上游按需注册那一段的坐标（`:241-253`） |
| `tests/reference-panel-host.test.mjs` | —— | **336** | 新建 10 条判据（SSR 真渲 5 条 + ctx/内容集合/关闭 4 条 + 接线形状 1 条） |
| `docs/batch-2026-10-06-refview.md` | —— | 134 | 交付 |
| `docs/wiring-requests-2026-10-06-refview.md` | —— | 69 | S-RV-1（`src/App.vue` 逐字 old/new）+ S-TW-1（`onExpandAll` 那条） |

别人的同域文件本批**没改**：`src/referenceContents.ts`、`src/usageViewGrouping.ts`、`src/toolContents.ts`、
`src/toolWindowActions.ts`、`src/usageViewGear.ts`、`src/App.vue`、`src/style.css`（只读它们）。

## 3. §5 每条自查命令的前后数字

| 命令 | 改前 | 改后（收工） |
| --- | --- | --- |
| `npx vue-tsc -b --force` | 本批第一次跑（面板 + 宿主 + ctx 刚接完）：**4 错**，全在 `src/components/CodeEditor.vue(117,161)` 与 `src/editorSplitLine.ts(117)`，**0 条在本批文件**（都是别的域在途的现场） | **0 错**（`build/tsc-refview-3.txt` 空文件，exit 0）。中途那 4 条在收工前已被对应域代理修掉，本批只是复读 |
| `node --test tests/<引用 + 工具窗口内容域 17 个文件>` | 收工前跑过两轮：注入态 **tests 10 / pass 1 / fail 9**（见 §4）；还原后单独跑新文件 **10 / 10 / 0** | **tests 172 / pass 172 / fail 0**（17 个文件：reference-panel-host、reference-contents、usage-view-panel-rows、usage-view-grouping、usage-view-gear、tool-contents、tool-content-tabs、tool-tabs、tool-window-content-ui、tool-window-registry、tool-window-factories、tool-window-view-panels、tool-view-activation、active-tool-window、non-code-usages、usage-highlight、tool-window-view-mode） |
| `node --test tests/module-size.test.mjs` | 5 / 5 绿 | **5 / 5 绿**（本批最大文件 `tests/reference-panel-host.test.mjs` 335、`src/components/ToolWindowView.vue` 264，都远低于 ts/vue 900；`CodeEditor.vue` 那条红已被对应域清掉） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净**（新测试文件里没有 TS 语法） |
| `node .tools/find-missing-ext.mjs` | 干净（1320 文件） | **干净**（1320 → 同一批数，新 `.ts` 值 import 都带扩展名） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 6 / 基线 8 · 新增 0 · 清掉 2 | **新增 0**：已登记孤儿 6 / 基线 8 · 本轮清掉 2（`src/jarRun.ts`、`src/runAnythingContext.ts` —— **不是我清的**，基线可由主代理下调）。新组件 `ReferencePanel.vue` 有生产消费方（`ToolWindowView.vue:15` import 且 `:196` 渲染），`--dead-imports` 里搜 `ReferencePanel` = **0 条** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 10 绿 1 红（红的那条本批开始前就红） | **11 / 10 绿 1 红**，红的仍是 `已入快照的每条引用…`，报出的两条都是 `docs/wiring-requests-2026-10-06-fix-macros.md` 里 `intellij.platform.lang.impl.xml:1058-1062` 与 `ClipboardMacro.java:15-15` 的快照区间不符 —— **macro 域的文件，本批没碰**。本批新写的上游引用被 `仓里每一条带路径的上游引用都指得到`（绿）全部收进去并核对通过 |
| ctest（`npm run test:native`） | —— | **不适用**：本批一个 `native/` 字节都没改 |

**订正之后的最后一次复跑**（把三处上游行号写准：`registerToolWindow` = `:128-135`、
`shouldBeAvailable = false` = `:133`、`createActionsToolbar()` = `:989`）：
`npx vue-tsc -b --force` = **0 错**；`node --test tests/reference-panel-host.test.mjs` = **10 / 10 / 0**；
`node --test tests/module-size.test.mjs` = **5 / 5 / 0**；引用门 = **11 / 10 绿 / 1 红**（红的还是 macro 域那两条快照区间）；
`find-ts-in-mjs` / `find-missing-ext` / `find-param-props` / `find-orphan-modules --gate` 全部干净。

## 4. 反向验证记录（三步数字 + 每条注入的归属）

注入方式：`cp` 三份原文件到 `build/rv-refview/*.bak` → 用 `build/rv-inject.mjs` 做**逐字单点替换**
（脚本要求锚点在文件里唯一，否则直接抛错）→ 跑判据 → `cp` 还原 → 再跑。临时脚本与备份已删
（`rm build/rv-inject.mjs build/rv-each.mjs build/rv-refview`）。

| 注入了什么 | 红了几条 |
| --- | --- |
| ①`src/components/ToolWindowView.vue`：`v-else-if="view === 'references'"` → `'referencesRVINJECT1'`（= 补这一层**之前**的状态） | 单独跑 **tests 10 / pass 3 / fail 7**：打开 references / 换看别条 / 还在搜的那条 / 关到空 / 只关掉选中的那条 / 过滤串不为空 / 接线形状（7 条全指着"引用这一格渲不渲得出来"） |
| ②`src/toolViewContext.ts`：`referenceRows: referenceRows.value` → `referenceRows: []`（上下文层不透传） | 单独跑 **tests 10 / pass 2 / fail 8**：上面 7 条 + 「上下文层把六栏全递出来」+「ctx 挂在 computed 上会重算」（注：这两条里有重叠，净增 1 条） |
| ③`src/components/ReferencePanel.vue`：`props.count ? '没有匹配的引用。' : usagesFoundText(0)` → 固定 `'没有找到引用。'`（本仓自造、没有出处的那句） | 单独跑 **tests 10 / pass 8 / fail 2**：「关到空…」（钉的是 `usagesFoundText(0)` = 上游 `usages.n` 的 `0#no usages`）+「有引用但过滤串一条不剩 ≠ 没有用法」 |
| 三处**同时**注入 | **tests 10 / pass 1 / fail 9**（只剩「标签条/combo 列的是 content」那条不依赖这三层，正说明它钉的是另一件事） |
| 撤掉全部注入 | **tests 10 / pass 10 / fail 0**；`grep -rn "RVINJECT" src tests docs build` = **0 处**；`git status --short src tests` 里 `.bak`/残留文件 = **0 条**（中途一次 `cp` 误在 `src/components/` 生成过 `ToolWindowView.vue.bak`，已当场 `rm`，复查计数 0） |

**会失败的边界用例**（不是"永远绿"的那种）：
- 「关到空」里 `await nextTick()` 之后才关，是因为 `watch` 是 pre-flush 的：**同一个 tick 内 false→true→false
  它根本不回调**（Vue 比的是刷新时的值）。第一版判据就是这么写的，结果注入③之外还多了一条假绿 ——
  补 `await nextTick()` 之后这条才真的拦得住"关到空没跳回输出"（注入时它变红，见上表①③）。
- 「有引用但过滤串一条不剩 ≠ 没有用法」：注入③专杀它。
- 「还在搜的那条不被顶替」：把 `referenceContents.ts` 的 `searching` 标志摘掉就会红（本批没做这处注入，
  因为它由既有 `tests/tool-contents.test.mjs` 的顶替规则钉着）。

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate` **新增 0**；`--dead-imports` 里 **没有** `ReferencePanel`
  （既有那三条陈旧的 `src/App.vue:38`、`SearchPanel.vue:21`、`:30` 不是本批的，也没被本批掩盖）。
- 既有门禁 `tests/tool-window-view-panels.test.mjs`（每条本地组件 import 必须有渲染点）本批**跑过且绿** ——
  这就是"不许 import 了不渲染"那条规则的落点。
- 本批**没有新建 `.ts` 模块**、没有新建测试专用模块；新组件的四个 emit 全部在 `ToolWindowView.vue:196`
  接住了（`@open`/`@toggle-group`/`@collapse-all`/`@expand-all`/`@speed-search`），ctx 的六栏在
  `toolViewContext.ts:195-207` 全部有真实赋值（无 `undefined` 占位），面板的 `count/query/searching`
  三栏都在 `emptyText()`/按钮 `:disabled` 上被读 —— 没有"只过自己测试的死导出"。
- `onExpandAll` 由必填改可选是本批**唯一**一处让契约变松的地方，理由与出处写在
  `src/components/ToolWindowView.vue:139-142`，并另开请求 S-TW-1 交主代理定夺（不是顺手放宽：
  那个字段在本宿主里根本没有渲染点，必填=让每个手写 ctx 的调用方替一个不存在的按钮填坑）。

## 6. 做不到 / 无法核实

1. **`src/App.vue` 那一跳没做**（规约 §2 保留文件）：引用面板在生产界面上还进不去 ——
   底部 `bottomTab === 'references'` 仍画平表。已交逐字 old/new（请求 S-RV-1）。
   在宿主落地之前，本批的新链路是"有判据、有渲染点、但入口未接"，
   `src/components/ReferencePanel.vue` 文件头与 `ToolWindowView.vue:143-165` 都写明了这一点。
2. **「导出到文本文件」没做**：具体卡在保存通道 —— `src/App.vue:1356` 的层级导出用的是宿主自己的
   `request('dialog.saveFile')`，`ToolWindowViewContext` 里没有这一栏，而 `src/App.vue` 是保留文件、
   `src/toolViewContext.ts` 也拿不到 `request` 的宿主闭包。文本生成本身早就有（`exportReferencesText`）。
   要接就得让宿主把 `onReferenceExport` 递进 ctx（同一份请求里可以顺带要）。
3. **上游"叶子精确跳到列"无法核实到行号**：本批只核到 `UsageViewImpl.java:1906`（`showNode`）确实存在，
   再往里是 PSI/`UsageDescriptor` 那一族，参考树里这一轮没逐行开（预算），所以导航口径按**本仓既有**
   的编辑器 1 基列（`ToolWindowView.vue:170` 结构视图那条挂载点）对齐，没照上游编新的换算。
4. **`ToolWindowView.vue` 的 `view` 没有联合类型可扩**（`:179` 是 `view: string`）。派单里"补进 view 联合类型"
   那一档**在本仓不存在** ⇒ 实际补的是模板分支 + ctx 字段。要真做成数据化（上游
   `ToolWindowFactory.createToolWindowContent` 那种）需要先给所有视图统一 `content(ctx)` 契约，
   `src/toolWindowMeta.ts:14-20` 早就登记在 `docs/source-todo.md` §12，本批没扩这个范围。
5. **速度搜索串在换 Content 时是否重置**：沿用 `src/referenceContents.ts:160-167` 的结论（**无法核实**，
   参考树里没有显式清串的调用），本批没改动这一行为，也没替它编上游依据。
6. **`UsageViewBundle.properties` 的行号订正**：本批实测 `action.group.by.title=19`、
   `File Structure=20`、`Directory Structure=21`、`usages.n=8`、`usage.view.counter=131`
   —— 与本仓既有注释（`src/usageViewGear.ts:27`、`src/referenceContents.ts:114` 等）**一致**，
   没有发现别的代理报的那种错位；`usages.title=6` 与本仓引用的 `AnalysisBundle.properties:13` 是两个包，
   不冲突，本批没有背书或否认后者（没打开那个文件）。

## 7. 需要主代理接的线

全部单放在 `docs/wiring-requests-2026-10-06-refview.md`：
- **S-RV-1**：`src/App.vue` 的 `bottomTab === 'references'` 那段换成 `<ToolWindowView view="references" :active="bottom" :ctx="toolViewCtx" />`
  （两行 new、无需新增 import；已核 `references` / `referenceTabs` / `FileCode2` 的 import 都还要留着，
  以及既有测试里**没有**钉 `没有找到引用。` 那句的断言 ⇒ 落地不会撞红）；
- **S-TW-1**：项目树「全部展开」要不要补（上游是被 ExpandRecursively 取代的，不补才是上游行为），
  以及要补就顺手把 `onExpandAll` 拆名，别再让一个字段挂两个窗口。

另外两条只需主代理自己确认的：孤儿基线可下调 2（`src/jarRun.ts`、`src/runAnythingContext.ts` 已被接上），
以及锚点快照 `docs/inventory/citation-anchors.json` 里 macro 域那两条区间（本批的引用门 1 红就是它）。
