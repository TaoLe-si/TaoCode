# 批次 · 层级 / 用法 / 导航 —— 判词缺项核对与收尾（2026-10-06）

代号：hierarchy。可改面 = `src/hierarchy*.ts` / `src/usage*.ts` / `src/referenceContents.ts` /
`src/findResultsNav.ts` / `src/chooseTarget*.ts` / `src/selectIn*.ts` / `src/nonCodeUsages.ts` /
`src/breadcrumbs.ts` / `src/navBarModel.ts` / `src/navToolbar*.ts` / `src/gotoNextError.ts` /
`src/menus/navigateMenu.ts` + `src/components/{BreadcrumbsBar,SelectInPopup}.vue` + `tests/{nav,hierarchy,usage}-*`。

## 0. 一句话结论

逐条打开 `docs/inventory/verdict-platform_rest.md` 的 8 个族（`lp/navigation` `ls/navigation`
`lp/hierarchy` `ls/hierarchy` `ixa/find-usages` `lp/usage-view` `lp/highlighting` `rf/core`）核对后：
本族**模块侧代码全都已实现并被生产消费**（`hierarchyView.ts` / `referenceContents.ts` /
`usageViewGrouping.ts` / `nonCodeUsages.ts` / `selectIn.ts` / `breadcrumbs.ts` 等），判词里的
`缺` 要么 ① 早做过只是**没有判据**（抓到 2 处：`hierarchyRenderer`、`hierarchyScopes`——
两个模块头都白纸黑字承诺了 `tests/hierarchy-renderer.test.mjs` / `tests/hierarchy-scopes.test.mjs`，
而这两个文件根本不存在），要么 ② 卡在 **App.vue 面板模板 / 标签栏**（宿主冻结，另人在接），
要么 ③ 卡在**服务端能力 / PSI / EP 宿主**（本仓架构没有对应物）。

本批的落点 = **补齐那 2 处缺失的判据（15 条，含反向验证）** + 订正判词 + 把 ② 写成接线请求、把 ③ 写进"做不到"。
不新造模块（造了没有生产消费方就是死模块，违反零消费方门禁），不碰 App.vue / bridge / keymap /
settingsModel / structural / SearchPanel.vue，不重做桶 4b 已交给 App.vue 的 3 个导航动作。

## 1. 判词表（族 / 项 / 判定 / 上游依据 / 本仓落点 / 说明）

判定符号：`[x]` 早做过（本批核实） · `[~]` 部分（模块侧 done、宿主模板待接） · `[ ]` 判词说缺、其实已做且已有判据 · `[-]` 不适用（具体理由）。
"上游依据"只对本批逐行开过的层级族给 `path:行号`（均已用参考树自数核对）；其余族引用上游类名不带行号（判词文档里已有带行号版本，转抄进本文会被引用门当成待核引用，故省行号——见 `.tools/agent-rules.md` §5）。

| 族 | 项（判词原文里的 `缺`） | 判定 | 上游依据 | 本仓落点 file:行 | 一句话 |
|---|---|---|---|---|---|
| `lp/hierarchy` | `HierarchyNodeRenderer` 分段渲染 | `[x]` | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeRenderer.java:32-43`；三段拼法 `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-31`；次要色 `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeDescriptor.java:100-101`；失效前缀 `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyNodeDescriptor.java:131-138` | `src/hierarchyRenderer.ts:40-83` / 消费 `src/hierarchyView.ts:13,70` | 早做过：段数组 `{text,tone}` + `[失效]` 前缀去重；本批补 `tests/hierarchy-renderer.test.mjs`（原判词说缺，错）。 |
| `lp/hierarchy` | 按 kind 的图标（`getIcon`） | `[x]` | `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:45-48` | `src/hierarchyRenderer.ts:46-65` | 早做过：`HIERARCHY_KIND_ICONS` + `hierarchyKindIcon`；未识别 kind 返 `null` 不占位；纳入同一判据。 |
| `lp/hierarchy` | `HierarchyBrowserScopes` 范围收窄 | `[x]` | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`；谓词 `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:159-199`；呈现顺序 `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:235-243` | `src/hierarchyScopes.ts:41-106` / 消费 `src/hierarchyView.ts:11,69,78` | 早做过：五档 id = 上游常量原值、`nodeInScope` 复刻 `isInScope`、`filterNodesByScope` 非法档退默认；本批补 `tests/hierarchy-scopes.test.mjs`。 |
| `lp/hierarchy` | 面板范围下拉（UI） | `[~]` | `platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:775` | 视图侧 `src/hierarchyView.ts:90-93`（`pickHierarchyScope`/`hierScope`/`hierScopeNotice` 已就绪），App.vue 未渲染 | 模块侧全好，缺 App.vue 面板模板的下拉；→ wiring-requests W-1。 |
| `lp/hierarchy` | 固定标签页接进标签栏 | `[~]` | 上游 `HierarchyBrowser` 的钉住（`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:109-113` 视图类型/表） | 视图侧 `src/hierarchyView.ts:206,220-233`（`hierPinned`/`pinCurrentHierarchy`/`closePinnedHierarchyTab` 已就绪），App.vue 未渲染 | 模块侧全好，缺标签栏渲染钉住项；→ W-2。 |
| `lp/hierarchy` | 导出接进面板 | `[x]` | `platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java`（类名，行号见判词 `lp/hierarchy` 行） | `src/hierarchyExport.ts` / 消费 `src/hierarchyView.ts:16,208-218`，App.vue:2225,1336 已有导出按钮 | 早已接进面板（"导出层级到文本文件"按钮），非缺项。 |
| `ls/hierarchy` | `getIcon` 按 symbol kind | `[x]` | `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:45-48` | 同 `lp/hierarchy` 的 `src/hierarchyRenderer.ts:46-65` | 与上面同一条，纳入 `tests/hierarchy-renderer.test.mjs`。 |
| `ls/hierarchy` | 每浏览器各自的视图类型表 | `[x]` | 上游 `LspCallHierarchyBrowser`/`LspTypeHierarchyBrowser`（类名） | `src/hierarchyView.ts:50-53`（`hierOptions`：call→incoming/outgoing，type→supertypes/subtypes） | 早做过：方向表按 `hierKind` 分岔，非缺项。 |
| `ls/hierarchy` | `LspFakePsiElement` 与 PSI 导航 | `[-]` | —— | `src/hierarchyView.ts:116`（`revealLocation`/`request` 直跳） | 本仓没有 PSI 宿主，跳转直接走位置揭示；FakePsi 无对应物，不假装。 |
| `lp/usage-view` | 把分组树接进引用面板 | `[~]` | 上游 `UsageViewImpl` 用法树（类名，见判词 `lp/usage-view` 行） | 规则 `src/usageViewGrouping.ts:56-130`（`buildUsageTree` 已被 `src/refactorPreview.ts:15,198` 生产消费），引用面板 `src/App.vue:2217` 仍是平表 | 分组规则本仓已有且有生产消费方（重构预览），引用面板那侧要改 App.vue 模板；→ W-3。 |
| `lp/usage-view` | 按引用类型（读/写/调用）分组 | `[-]` | 上游 `UsageType`/`UsageView` 的 type 分组（类名） | —— | LSP `references` 不回 kind、没有 `documentHighlight` 之外的读写来源，本仓拿不到逐引用种类 ⇒ 不造假分组。登记"做不到"。 |
| `ixa/find-usages` | 按语言 provider：描述名/类型标签/节点文本 | `[-]` | 上游 `FindUsagesProvider`/`LanguageFindUsages`/`DescriptiveNameUtil`（类名，见判词 `ixa/find-usages` 行） | 取词在 `src/semanticActions.ts`（`wordAt`）、标题在 `src/toolContents.ts`（`usagesTabName`/`usagesPanelTitle`）——均非本批可改面 | 本仓符号唯一来源是 LSP，`references` 不带元素种类、没有 provider EP；标题层落点在别的代理名下 → 见"做不到"，不新造无人消费模块。 |
| `ixa/find-usages` | `FindUsagesOptions`（搜注释/字符串/跳过） | `[~]` | 上游 `FindUsagesOptions`（类名） | 注释/字符串出现已在 `src/nonCodeUsages.ts`（`nonCodeRanges`/`nonCodeReport`，消费方 `renamePreview.ts` 等） | 文本档的"注释/字符串"那一半已由 `nonCodeUsages.ts` 落；LSP 请求无 option 字段 ⇒ 结果集过滤档做不了，登记差异。 |
| `lp/navigation` | `GotoSuperAction` / `GotoTest` / `GotoRelated` | `[x]` | 见桶 4b 报告 `docs/batch-2026-10-06-bucket4b.md`（navGotoSuper/navGotoTest/navGotoRelated 逐行订正） | `src/navGotoSuper.ts` / `src/navGotoTest.ts` / `src/navGotoRelated.ts`（消费 `src/lspNavigation.ts`、菜单 `src/menus/navigateMenu.ts`） | 桶 4b 已接完并补判据；判词说缺属陈旧，本批不动（重做=踩别人现场）。 |
| `lp/navigation` | `ChooseByNameFilter` 按语言过滤/持久化 | `[x]` | `platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilter.java`（类名，行号见桶 4b 报告） | `src/navChooseByNameFilter.ts`（用户明令勿动，锚点快照刚重算） | 桶 4b 已做；本批不碰该文件。 |
| `ls/navigation` | workspace symbol 客户端缓存 | `[x]` | `platform/lsp-impl/src/impl/LspRequestExecutor.kt` + `platform/lsp-impl/src/impl/cache/LspSingleSlotCache.kt`（类名，行号见桶 4b 报告） | `src/navWorkspaceSymbolCache.ts`（用户明令勿动） | 桶 4b 已接线补判据；判词说缺属陈旧。 |
| `ls/navigation` | workspace symbol 的视图选项/链接缓存 | `[-]` | `platform/lsp-impl/src/impl/features/...`（`LspStructureViewSupport`/`LspDocumentLinkCache`，类名） | 结构树选项在 `src/outlineView.ts`（非本批可改面） | 落点不在本批文件面，且 `documentLink` 缓存属 `ls/highlighting` 族；转对应代理。 |
| `lp/highlighting` | `UsageRanges` 读写分类 / 逐元素类型 | `[-]` | 上游 `HighlightUsagesHandlerBase`/`UsageRanges.kt`（类名，见判词 `lp/highlighting` 行） | `src/usageHighlight.ts`（词法层） | 本仓是文本层高亮，字符串内出现无法区分读/写；判词已注明该限制，不假装 PSI 分类。 |
| `lp/highlighting` | 后台重算 / 代码块范围 / 注释超链接 | `[-]` | `BackgroundHighlighter` / `CodeBlockSupportHandler` / `HyperlinkAnnotator`（类名） | 代码块范围属桶 9（`docs/batch-...-searchdiff.md` 在途 `findCodeBlockRange`） | 编辑后即收起（现状行为）；代码块范围另代理在做；注释超链接要 `documentLink` resolve，转 `ls/highlighting`。逐条"做不到"。 |
| `rf/core` | Switcher（Ctrl+Tab）UI | `[-]` | 上游 `Switcher.kt`/`frontendSwitcherItemsCollector.kt`（类名，见判词 `rf/core` 行） | 模型 `src/recentFilesModel.ts`（`recentlyEdited`/pinned 两档） | 宿主是禁改的 App.vue（另 `appvue` 在途）；本批无入口可挂，不渲染无消费链路的控件。 |
| `rf/core` | 最近文件上限可设 | `[-]` | `SWITCHER_ELEMENTS_LIMIT`（常量，见判词） | `src/recentFilesModel.ts` 常量 30 | 设置项要改 settingsModel.ts（冻结、主代理独占）；登记。 |

> 原写「层级分段渲染 / 范围收窄 / getIcon 是缺项」——实际：`src/hierarchyRenderer.ts` 与
> `src/hierarchyScopes.ts` 早已实现且被 `src/hierarchyView.ts` 生产消费，只是**没有判据**
> （模块头承诺的两个 test 文件不存在）。本批留痕订正：判定改 `缺`→`[x] 早做过·补判据`。

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `tests/hierarchy-renderer.test.mjs` | 不存在 | 114 | 新增判据（8 条用例：分段文本/失效前缀去重/按 kind 图标/1 基位置/行尾优先级/整行组装/接线）。 |
| `tests/hierarchy-scopes.test.mjs` | 不存在 | 91 | 新增判据（7 条用例：五档 id 对齐上游常量/isInScope 谓词/ThisClass·ThisModule/未知档不收/保序过滤+非法档退默认/一级目录归一/scopeNotice+接线）。 |
| `src/hierarchyRenderer.ts` | 138 | 138 | **净零**：反向验证临时把 detail 段 `tone` 改 `base`、注入后复原（`git diff` 空）。 |
| `src/hierarchyScopes.ts` | 106 | 106 | **净零**：反向验证临时把 `Production` 档改 `return true`、注入后复原（`git diff` 空）。 |

本批未新增/删除任何 `src/` 生产模块；没有动桶 4b 交给 App.vue 的 3 个导航动作、
未动 `navChooseByNameFilter.ts` / `navWorkspaceSymbolCache.ts`。

## 3. §5 自查前后数字（域内，不跑全量 `npm test`）

| 门 | 命令 | 后（最终态） | 归属 |
|---|---|---|---|
| 域内测试 | `node --test tests/nav-*.test.mjs tests/hierarchy-*.test.mjs tests/usage-*.test.mjs` | **129 项 / 129 绿**（含本批新增 15） | 我的两条新判据全绿 |
| 模块规模门 | `node --test tests/module-size.test.mjs` | **绿** | 中途一度红（`SearchPanel.vue` 901>900，他人 `appvue`/file-types 在途），终跑他人已收回 900 下 ⇒ 与本人无关 |
| 合并跑 | `... tests/usage-*.test.mjs tests/module-size.test.mjs` | **134 项 / 134 绿 / 0 红** | 全绿 |
| 类型 | `npx vue-tsc -b --force` | 最终一次 **exit=0 / 0 错**；并发窗口内一度见 4 条，全在 `SearchPanel.vue` | **我的域文件 0 错**（本批只加 `.mjs`，不入 tsc） |
| 参数属性 | `node .tools/find-param-props.mjs` | 0 | 干净 |
| mjs 里的 TS | `node .tools/find-ts-in-mjs.mjs` | 干净 | 新用例是纯 JS |
| 漏扩展名 | `node .tools/find-missing-ext.mjs` | 干净（1244 文件） | `.ts` import 全带扩展名 |
| 零消费方 | `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 = 基线 9，新增 1（`src/structuralCodeBlock.ts`） | **非我**：他人 `src/structural*` 在途；我的两模块早被 `hierarchyView` 消费，不新增孤儿 |
| 引用门·解析 | `node --test tests/source-citations.test.mjs` | **绿** | 本报告 12 条层级 `path:行号` 全部逐行开参考树自数核对（`HierarchyBrowserBaseEx.java` 实 869 行，引 775 在界内） |
| 引用门·锚点 | `node --test tests/source-citation-anchors.test.mjs` | 10/11，1 红 = `moved src/fileTypeDetection.ts → platform/ide-core/.../NativeFileType.java:48-51` | **非我**：`src/fileTypeDetection.ts` 是他人在途（`git status` 显 34+/13-，本批从未碰）；本人两份新文档只贡献"未入快照"引用（门明示"不拦，下次重算收进去"） |

> 说明（12 路并行的必然现象）：本批运行期间 `SearchPanel.vue`（模块规模 + 类型）与 `structuralCodeBlock.ts`（孤儿）
> 与 `fileTypeDetection.ts`（锚点 `moved`）都在**别的代理名下反复变动**——`git status` 可证本批只新增了
> 2 个 `tests/*.mjs` + 2 个 `docs/*.md`，一个 src/native 文件都没改。上述三处红全部落在他人在途文件里。

## 4. 反向验证记录（三条都跑了「注入→变红→复原→复绿」）

- 注入 ①：`src/hierarchyRenderer.ts` 把 detail 段 `tone: 'muted'` 改成 `base`（违背 `HierarchyNodeDescriptor.java:100-101` 的次要色档）。
- 注入 ②：`src/hierarchyScopes.ts` 把 `Production` 档改成 `return true`（丢 `isTestPath` 判定，违背 `HierarchyTreeStructure.java` 的 `!isTestSources`）。
- 变红：`node --test` 两文件 ⇒ **15 项中 4 项红**（renderer 2 条：分段文本用例 + 整行组装用例；scopes 2 条：isInScope 用例 + filterNodesByScope 用例）。
- 复原后复绿：`git diff --stat src/hierarchyRenderer.ts src/hierarchyScopes.ts` = 空；重跑 **15/15 绿**。

## 5. 零消费方自查结论

本批只新增 2 个 `tests/*.test.mjs`（判据文件，非 `src` 模块，不参与孤儿门）。被核对的两个模块
`src/hierarchyRenderer.ts`、`src/hierarchyScopes.ts` 早已是 `src/hierarchyView.ts` 的 import 依赖
（`src/hierarchyView.ts:11,13,69,70,78`），而 `hierarchyView.ts` 的 `createHierarchyView` 由 `src/App.vue` 消费——
即"模块→视图→宿主"三段链路存在，本批补的是**判据**（此前承诺的两 test 缺失），不是造新孤岛。
orphan 门的新增 1 条是他人 `src/structuralCodeBlock.ts`，与本批无关。

## 6. 做不到 / 无法核实（具体卡点）

1. **按引用类型（读/写/调用）分组**（`lp/usage-view`）：LSP `textDocument/references` 只回 `Location`、不带 `kind`；`documentHighlight` 只在单文件内、给不出工程级读写。没有服务端能力/PSI 就拿不到逐引用的种类 ⇒ 造分组就是假数据。
2. **`FindUsagesProvider`/`DescriptiveNameUtil` 的按语言 provider 层**（`ixa/find-usages`）：取搜索名（`wordAt`）在 `src/semanticActions.ts`、用法树标题（"Usages of 'x'"）在 `src/toolContents.ts`，**两个都不在本批可改面**；且没有插件 EP 宿主可注册 per-language provider。新造无人消费的 provider 模块会触发零消费方门禁 ⇒ 不做，转对应代理（见 wiring W-4 的说明）。
3. **Switcher（Ctrl+Tab）与最近文件上限设置**（`rf/core`）：宿主是禁改 `App.vue`（`appvue` 在途）与冻结 `settingsModel.ts`（主代理独占）；不渲染无消费链路的控件。
4. **层级"本地改动角标"**（`HierarchyNodeRenderer.java:45-50`）：要逐节点查 VCS 状态，而本仓 `git.status` 是整仓一次接口、层级节点可能指向库文件 ⇒ 拿不到按节点的脏状态，`src/hierarchyRenderer.ts` 头已注明不放假角标。
5. **`LspDynamicFiles`/`LspFakePsiElement`/后台高亮重算/代码块范围/注释超链接**：分别卡"没有动态文件模型 / 没有 PSI 宿主 / CodeEditor.vue 冻结 / 属桶 9 在途 / 属 `ls/highlighting`"。
6. **判词里非层级族的上游行号**：本批只对层级族逐行开了参考树自数（见上表 `path:行号`）；其余族沿用判词/桶 4b 报告里已核过的行号，未在本文重复转抄（转抄带行号会被引用门当新引用核，省行号即规避，符合 agent-rules §5）。无法独立复核者以类名给出，标"见对应报告"。
