# 批次 · 2026-10-06 · 插件域（`pf/plugins` / `ic/plugins`）

派单：`docs/inventory/verdict-platform_rest.md` 里 `pf/plugins`（265 类）与 `ic/plugins`（5 类）两族判词
**先核后做**。可改面：`src/plugin*.ts`、`src/marketplace*.ts`、`src/components/{PluginDialog,PluginMarketPanel}.vue`、
`native/plugins*.cpp`、`tests/plugin-*`。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`，**行号本轮自己数的**。
表里的 `.../` 一律是 `platform/platform-impl/src/com/intellij/ide/plugins/` 的省略写法（省略写法不进引用门，逐字路径见 §0 与各行首列）。

---

## 0. 先核：派单给的上游坐标有一条不存在

派单写「上游 `platform/platform-impl/src/com/intellij/ide/plugins/`、`platform/extensions/src/com/intellij/idea/`」。

| 坐标 | 核实结果 |
|---|---|
| `platform/platform-impl/src/com/intellij/ide/plugins/` | 存在，`ls` 到 60+ 个文件（`InstalledPluginsTab.kt`、`MarketplacePluginsTab.kt`、`PluginManagerConfigurable*.kt`、`newui/`、`marketplace/`、`auth/` 等） |
| `platform/extensions/src/com/intellij/idea/` | **参考树里没有这个目录**（`find platform -type d -path "*com/intellij/idea"` 只出 bootstrap / built-in-server / core-api / platform-api / platform-impl / starter / testFramework / platform-tests）。本族真正要读的三个类落在：<br>`platform/core-impl/src/com/intellij/ide/plugins/PluginManagerCore.kt`、<br>`platform/extensions/src/com/intellij/openapi/extensions/PluginDescriptor.java`、<br>`platform/core-api/src/com/intellij/ide/plugins/IdeaPluginDescriptor.java` |

⇒ 本轮按真实路径读，没有按派单给的假坐标编行号。

---

## 1. 判词表

判定档位：`[x]` 已做 · `[~]` 部分（写「本仓已有」+「还差」）· `[ ]` 未做 · `[-]` 不适用（具体理由）。
「本仓落点」列的行号是本轮收工时逐个 grep 复算过的**定义行**。

### A. `pf/plugins`（插件管理，265 类）

| 项 | 档 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| 清单的 `<vendor>` 字段 | `[x]` | `platform/pluginSystem/parser/impl/src/com/intellij/platform/pluginSystem/parser/impl/PluginXmlConst.kt:36`；读取面 `platform/core-impl/src/com/intellij/ide/plugins/IdeaPluginDescriptorImpl.kt:224` | `native/plugins.hpp:58`、`native/plugins.cpp:451,493`、`src/pluginGroups.ts:58` | 厂商进宿主模型、进 JSON、进详情面板（上一轮落的，本轮复核成立） |
| 已安装页 `/vendor:` 属性搜索 | `[x]` | `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchWords.kt:9`；`platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:156-167,202-204`；匹配口径 `platform/platform-impl/src/com/intellij/ide/plugins/newui/MyPluginModel.kt:1348-1361`；消费点 `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:87-94` | `src/pluginGroups.ts:487`（取值词表）、`:551`（`parseInstalledQuery`）、`:626`（`vendorTextMatches`）、`:636`（`pluginVendorMatches`）、`:687`（`matchesInstalledQuery` 的厂商那一行） | 空厂商不匹配、相等或忽略大小写包含算命中、多取值是或 |
| 卸载前点名「谁还依赖它」 | `[x]` | `platform/platform-impl/src/com/intellij/ide/plugins/newui/UninstallAction.kt:91-103,127-155`；`platform/platform-api/resources/messages/IdeBundle.properties:457,459,2359`；依赖者闭包 `platform/platform-impl/src/com/intellij/ide/plugins/newui/DefaultUiPluginManagerController.kt:1452-1479` | `src/pluginGroups.ts:214`（`pluginsDependingOn`）、`:252`（`pluginUninstallPrompt`）；`src/components/PluginDialog.vue:169`（正文来源）、`:427`（确认前渲染那一段） | 有依赖者时逐个列进正文再问第二次；本仓卸载=删目录，被牵连者确实变 `broken`，所以这段是真后果不是提示噪音 |
| 市场页搜索框的 `/vendor:` `/tag:` `/sortBy:` | `[x]`（本轮新做） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:24-124`（单词早退 `:45-48`、`:` 结尾吃取值 `:53-56`、取值缺失退回整条 `:57-60`、`handleAttribute` `:77-84`）；`/sortBy:` 的词面也是市场页分组标题写进搜索框的东西 `platform/platform-impl/src/com/intellij/ide/plugins/MarketplacePluginsTab.kt:287,298,309` | `src/pluginMarket.ts:390`（属性词表）、`:454`（`parseMarketplaceQuery`）、`:323`（`matchesMarketplaceQuery` 吃 vendors/tags）；`src/components/PluginMarketPanel.vue:81`（解析）、`:93`（列表用解析结果） | 判词只写了「排序项与 `MarketplaceTabSearchSortByOptions.kt` 对齐」，**实际缺的是搜索框的属性词语法**；本轮把 `Marketplace` 解析器整个移植，`/sortBy:` 覆盖排序下拉（`MarketplacePluginsTab.kt:748-755` 的 `setState` 就是"状态由解析结果决定"这条语义） |
| `/suggested` `/internal` `/staffPicks` `/repository:` | `[~]`（本轮新做解析侧） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchWords.kt:12-15`；拦下它们的位置 `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:68-75`；文案键 `platform/platform-api/resources/messages/IdeBundle.properties:1601,1605,1618,1619` | `src/pluginMarket.ts:402`（布尔词表）、`:417`（说明文字）、`:454` 里的 deferred 收集；`src/components/PluginMarketPanel.vue:117`（界面上那一句） | 本仓已有：词被认识、布尔词不进气泡串也不吃取值、界面上如实写「取的是远程仓库的分组字段」；还差：没有远端分组数据 ⇒ 不参与过滤（也就没渲染假筛选项） |
| 标签徽章 → `/tag:` 词 | `[x]`（本轮新做） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginTagBadge.kt:29`；`getTagQuery` `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchQueryParser.kt:254-257`；整框替换动作 `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginsTab.kt:271` | `src/pluginMarket.ts:516`（`tagQueryWord`）；`src/components/PluginMarketPanel.vue:208`（`applyQueryWord`）、`:294`（徽章按钮） | 含空格才加引号；点一下是**整框替换**，不是追加 |
| 厂商链接 → `/vendor:` 词 | `[x]`（本轮新做） | `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginDetailsPageComponent.kt:1336`；`platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginsTab.kt:271` | `src/pluginGroups.ts:648`（`vendorQueryWord`）；`src/components/PluginDialog.vue:390`；`src/components/PluginMarketPanel.vue:287` | 已安装详情面板与市场行的厂商都可点 |
| 空态「在市场页搜这个」 | `[x]`（本轮新做） | `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:53-70`（八个属性词的排除 `:56-63`、链接与回调 `:64-69`）；文案键 `platform/platform-api/resources/messages/IdeBundle.properties:1620,1621` | `src/pluginGroups.ts:657`（词表）、`:676`（`offersMarketplaceSearch`）；`src/components/PluginDialog.vue:191,193,339`；`src/components/PluginMarketPanel.vue:48,214` | 上游把**整条查询原样**交给市场页，本仓同形（带 `stamp` 让重复点同一条也算一次递交） |
| `/bundled`、`/updatedBundled` | `[ ]` | bundled 标志 `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginUiModel.kt:34,146`；消费点 `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:133-145` | `src/pluginGroups.ts:431`（档位在册）、`:448`（故意不进 `SUPPORTED_SEARCH_OPTIONS`，按钮不渲染） | 卡点：宿主把插件目录钉死成一个（`native/main.cpp:1416-1417` 的 `profile / L"plugins"`），没有「随应用发布」的那一层 ⇒ `isBundled` 恒假。交 `docs/wiring-requests-2026-10-06-plugins.md` **P-3** |
| 判词把 bundled 层挂在 `BundledPluginsLister.kt` 上 | **订正（留痕）** | 原写「JetBrains 自带插件层（bundled 分组/`BundledPluginsLister`）没有」；实际 `platform/platform-impl/src/com/intellij/ide/plugins/BundledPluginsLister.kt:30-46` 是 `ModernApplicationStarter` 命令行工具（dump product-info 的 layout JSON），**不是**插件页的 bundled 层 | 见上一行与 P-3 | 订正的是判词的**依据引用**；「bundled 这一层没有」这个缺项本身成立 |
| 远程市场（在线搜索/下载/分块续传/评分/账号授权） | `[ ]` | `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSignatureVerifier.kt:19-25`；`platform/platform-impl/src/com/intellij/ide/plugins/auth/PluginRepositoryAuthService.kt:17-26` | 无（`src/pluginMarket.ts:14-22` 把三条原因写在文件头，`PluginMarketPanel` 的 `market-source` 行写在界面上） | 判词三条复核成立：`index.html:6` 的 CSP 是 `connect-src 'self' ws://127.0.0.1:5173`、`src/bridge.ts:109` 的 `Method` union 无取数通道、宿主 switch 无 HTTP 分支 ⇒ 交 **P-4**（放宽 CSP 是安全决策，不该本批自定） |
| `/updatesFrom:` 更新源属性 | `[ ]` | `platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchWords.kt:16`；消费点 `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:105-116` | `src/pluginGroups.ts:487,494`（词被认识、取值被吃掉、`deferred` 里说明） | 更新源来自 marketplace 的 pending source，本仓没有远端 ⇒ 解析有、过滤无 |
| 搜索建议弹窗（打 `/` 出属性词表 + 上下键浮层） | `[ ]` | `platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTab.kt:413,423`（建议词表含 `VENDOR`）；`platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchPopup.kt`、`platform/platform-impl/src/com/intellij/ide/plugins/newui/SearchUpDownPopupController.java` | 无 | 本轮预算内没做（不是"做不到"）：搜索框是纯文本框，词要人手打全 |

### B. `ic/plugins`（插件 UI 的服务层，5 类，逐个打开核过）

判词原文说「缺 `PluginManagerConfigurableService` 的设置页服务、`PluginInfoProvider`/`PluginFeatureService` 的数据提供者与 `UltimateDependencyChecker` 的付费依赖校验」。
**核实后：四条里只有一条真缺（`PluginManagerConfigurableService` 的宿主入口），两条早做过，一条被误读。**
类清单取自 `docs/inventory/platform_rest_verdict_table.json` 里 `family == ic/plugins` 的 5 条。

| 类 | 档 | 上游相对路径:行号 | 本仓落点 | 核实结论（原写 X / 实际 Y） |
|---|---|---|---|---|
| `platform/ide-core/plugins/src/com/intellij/ide/plugins/UltimateDependencyChecker.kt` | `[x]` | `:10-25`（`canBeEnabled(pluginId)` 在 `:25`） | `src/pluginInfo.ts:47`；消费点 `src/components/PluginDialog.vue:115`（复选框 `:disabled`）与 `:119`（点不动时的 `:title`） | 原写「缺付费依赖校验」，实际：本仓没有发行版/付费分层，同一个判定落在「清单坏 / 必需依赖成环 / 必需依赖缺装」三条真实条件上，而且它就是复选框唯一那道门 |
| `platform/ide-core/plugins/src/com/intellij/ide/plugins/PluginFeatureService.kt` | `[x]` | `:69-71`（`getPluginForFeature(featureType, implementationName)`） | `src/pluginInfo.ts:118`（`featureProviders`）；**本轮才接上消费点** `src/components/PluginDialog.vue:157`（`otherProviders`）、渲染在 `:402`（命令行）与 `:408`（模板行） | 原写「缺数据提供者」，实际函数早就有，但本轮之前**只被 import 没被渲染**（等于死出口）。本轮补的是消费链路 |
| `platform/ide-core/plugins/src/com/intellij/ide/plugins/data.kt`（判词未点名的第 5 个类） | `[x]` | `:50`（`PluginDataSet`）与 `:59`（`PluginFeatureMap.get(implementationName)`） | 同上（`featureProviders` 的返回形状就是这张反查表） | 判词漏了这条；本轮一并核实并补判据测试 |
| `platform/ide-core/plugins/src/com/intellij/ide/plugins/PluginManagerConfigurableService.java` | `[~]` | `:14-15`（唯一方法 `showPluginConfigurableAndEnable`）；实现链 `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurableServiceImpl.java:15-27` → `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurable.kt:397-401` → `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurablePanel.kt:490-514`；真实调用方例 `platform/execution/src/com/intellij/execution/configurations/UnknownRunConfiguration.java:123` | 接收侧：`src/components/PluginDialog.vue:56`（`focusPlugin` prop）、`:207`（`focusInstalledPlugin`）、`:219`（`watch`）；本仓真实调用方：`src/components/PluginMarketPanel.vue:62`（`emit('focusPlugin')`）、`:279`（已安装/无效徽章） | 本仓已有：切回已安装页 + 清过滤 + 选中 + **只有 `canBeEnabled` 通过才连带启用**（`selectAndEnable` 的两半，`:490-493`）。还差：宿主侧入口（`src/projectExtras.ts` 的 `openPlugins` 一族 + `src/App.vue` 的挂载行）⇒ **P-1** |
| `platform/ide-core/plugins/src/com/intellij/ide/plugins/PluginInfoProvider.java` | `[ ]` | `:19-28`（`loadCachedPlugins()` 与 `loadPlugins(indicator)`，注释 `:22-24` 写明「from a main plugin repository」） | 无 | 判词说「缺数据提供者」——**实际它不是"停用插件的信息"**：它是「与当前 build 兼容的插件 id 清单」的远端加载器。没有网络通道取不到数 ⇒ 与远程市场同因，卡 **P-4** |
| （附带复核）`preparePluginErrors` 的全局错误面 | `[x]`（本轮补消费） | `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerStateService.kt:115-139`；文案 `platform/core-api/resources/messages/CoreBundle.properties:31,32,34,36,38-39,42` | `src/pluginInfo.ts:66`（逐插件）、`:87`（全局，一条环只报一次）；渲染 `src/components/PluginDialog.vue:145`（`loadErrors`）、`:332`（只有非空才出现那一节）、`:398`（详情段用逐插件原因，不再只贴 native 的 `broken` 串） | 本轮之前这四个出口里只有 `canBeEnabled` 真被用；其余三条是"实现好了但没接线"，本轮接上并配判据 |

### C. 判词里其它「本仓已有」的复核（成立，本轮未改）

| 判词断言 | 核实 |
|---|---|
| `plugin.json` 的 `depends`/`optionalDepends` 递归解析、启用连带、缺装拒绝、停用递归带走依赖方 | 成立：`native/plugins.hpp:66-86` 的六个字段与 `set_enabled` 契约（`:110-116`）；测试 `tests/plugin-dependencies.test.mjs` + `native/plugins_test.cpp` |
| 前端按 `broken`/`missingDependencies` 判不可加载、组计数与 `/invalid` 都排除 | 成立：`src/pluginGroups.ts:147`（`pluginIsBroken`）、`:152`（`pluginIsEnabled`）、`:160`（`pluginIsLoadable`）、`:169`（`pluginDependencySummary`）；`/invalid` 在 `:693`、`/outdated` 在 `:694` |
| 市场条目模型对齐 `PluginUiModel.kt` 的 name/version/vendor/tags/downloads/rating/date/displayCategory | 成立：`src/pluginMarket.ts:30-49` 对上 `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginUiModel.kt:34,52` 等字段（本轮补的是 `/vendor:` `/tag:` 的**用法**，不只是存着） |
| 五个排序项对齐 `MarketplaceTabSearchSortByOptions.kt` | 成立：`src/pluginMarket.ts:281-291` 对上游 `:10-14`（UPDATE_DATE/DOWNLOADS/RATING/NAME/RELEVANCE），反查 `getByQueryOrNull` 在 `:16-18` |
| 清单解析与 `PluginSearchResult.kt` 的 error 同口径（坏条目逐条报错不打空整页） | 成立：`platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSearchResult.kt:12-17` 存在；本仓 `src/pluginMarket.ts:57-61,138` |
| `/outdated` 从待办变成真实过滤 | 成立：`src/pluginGroups.ts:448`（`needUpdate` 在 SUPPORTED 里）、`:694`；计数在 `src/components/PluginDialog.vue:98` |

---

## 2. 改动文件清单（`wc -l` 前后）

「前」= 本轮开始时的在途工作区（含同一批次上一轮已落盘的 vendor/uninstall 工作），「HEAD」= 提交基线。

| 文件 | HEAD | 本轮前 | 本轮后 | 本轮改了什么 |
|---|---:|---:|---:|---|
| `src/pluginGroups.ts` | 510 | 654 | 702 | `vendorTextMatches` 抽出、`vendorQueryWord`、`offersMarketplaceSearch` |
| `src/pluginMarket.ts` | 439 | 439 | 615 | `Marketplace` 搜索语法解析、`/vendor:` `/tag:` 过滤、`tagQueryWord`、`marketplaceEffectiveSort` |
| `src/pluginInfo.ts` | 175 | 175 | 175 | 未改（函数本来就在；本轮补的是消费方与判据测试） |
| `src/components/PluginDialog.vue` | 391 | 427 | 520 | 空态市场链接、厂商可点、`seed`/`focus-plugin` 交接、`focusPlugin` prop、加载错误一节、命令/模板「另由谁贡献」 |
| `src/components/PluginMarketPanel.vue` | 267 | 267 | 348 | 吃解析结果（keyword/vendors/tags/sortBy）、徽章可点、`/sortBy:` 覆盖下拉框、deferred 说明、`focusPlugin` 出口、`seed` 入口 |
| `native/plugins.cpp` | 687 | 691 | 691 | 本轮未加行（上一轮的 vendor 解析） |
| `native/plugins.hpp` | 114 | 121 | 121 | 本轮未加行（上一轮的 vendor 字段） |
| `native/plugins_test.cpp` | 556 | 575 | 575 | 本轮未加行（上一轮的 vendor 用例） |
| `tests/plugin-market-query.test.mjs` | — | — | 212 | **新增**：市场属性词解析/过滤/排序/交接 + 不做假控件 |
| `tests/plugin-info.test.mjs` | — | — | 153 | **新增**：`src/pluginInfo.ts` 的判据（此前它的文件头指着这个测试名，但文件根本不存在） |
| `tests/plugin-uninstall-dependents.test.mjs` | — | 103 | 103 | 上一轮新增，本轮未改 |
| `tests/plugin-vendor-search.test.mjs` | — | 126 | 126 | 上一轮新增，本轮未改 |
| `docs/wiring-requests-2026-10-06-plugins.md` | — | — | 129 | **新增**：P-1…P-4 |
| `docs/batch-2026-10-06-plugins.md` | — | — | 本文件 | 交付报告 |

`git diff --stat` 自查：本域 7 个改动文件 632 增 / 24 删，hunk 全是插件相关；没有顺手重排别人的代码；未 commit、未 push、未动保留文件。

---

## 3. §5 每条自查命令的前后数字

| 命令 | 本轮前 | 本轮后 |
|---|---|---|
| `npx vue-tsc -b --force` | 0 错（`.tmp-plugins-tsc-base.txt` 是 0 字节） | **0 错**。中途出现过 6 条、2 条，全是别人的在途文件（`src/App.vue:2019,2073`、`src/bookmarkActions.ts:146`、`src/toolWindowStripes.ts:694,695,794`、`src/lspProgress.ts:20`、`src/enterHandlers.ts:96`、`src/workspaceInspection.ts:55`），收工复跑归零 |
| `node --test tests/module-size.test.mjs` | 5/5 绿 | **5/5 绿**（上限一个没动；本域最大 `src/pluginGroups.ts` 702 / 900） |
| `node .tools/find-param-props.mjs` | 共 0 处 | **共 0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1275 个文件） | **干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 9 / 新增 0 → 绿 | **基线 9 / 新增 0 → 绿**（中途出现过 1 条 `src/consoleAnsi.ts`，是控制台/终端域的在途文件，收工前该代理自己接上了消费方）。本域新增零消费方 0 条（见 §5 逐个出口） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11 绿 | 11 tests / 9 pass / **2 fail**。坏引用共 11 条，**全在别人的批次文档里**（`batch-2026-10-06-projecttree` / `-status2` / `-toolwindow2` / `-welcome2`、`wiring-requests-2026-10-06-lsp` / `-vcs2`：指向参考树里不存在的 `PsiUtil.java`、`SuppressIntentionAction.java`、`StructureViewFactoryImpl.java`、`PopupDispatcher.java`、`StackingPopupDispatcherImpl.java`、`EditorSettingsExternalizable.java`、`DocumentationToolWindowManager.kt`）。**本域两份文档 0 条被点到**（`grep` 复算过），锚点门「已入快照逐条一致」仍绿 |
| 本域测试 `node --test tests/plugin-*.test.mjs tests/ext-plugin-file-types.test.mjs` | 74/74 | **95/95**（+13 市场查询、+8 pluginInfo；既有 74 条断言一字未改） |
| `npm run test:native`（先 `vcvars64.bat`） | 中途跑过一次：`plugin_management` Passed，整体 36/37（唯一红 `git_status_vcs`） | 收工复跑：**`plugin_management` Passed**；整体 **92% tests passed, 3 tests failed out of 37**，三条红是 `lsp_codec`、`lsp_host_e2e`（LSP 域在途，子用例「showMessage 与 logMessage 都要转出来」）、`git_status_vcs`（git 域在途，子用例「commit with a path subset commits only the selected files: 工作区重新干净」）——**没有一条属于本域**，本域的 `native/plugins_test.cpp` 全绿。按规约不信 npm/PowerShell 的退出码（它报的是 `Native tests failed: 8`），只信日志里的 `tests passed` 那一行 |

---

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

| 轮 | 注入了什么 | 变红 | 撤掉后 |
|---|---|---|---|
| 1 | `src/pluginMarket.ts` 的 `marketplaceEffectiveSort` 改成无视查询（`return sort`）；`src/components/PluginDialog.vue` 的 `marketSeed` 改投递空串 | `tests/plugin-market-query.test.mjs`：13 条里 **2 红**（「排序：查询里的 /sortBy: 覆盖下拉框…」「接线：市场页真的吃解析结果，两页之间的交接都挂着」） | 两处恢复 → 13/13 绿 |
| 2 | `src/components/PluginDialog.vue` 的加载错误一节渲染闸改成 `v-if="false"` | `tests/plugin-info.test.mjs`：8 条里 **1 红**（「接线：加载错误清单与『另由谁贡献』真的进了插件页」） | 恢复 → 8/8 绿 |
| 收工复跑 | 无注入 | — | 本域 **95/95** 绿 |

两处注入都只拆「新门禁要抓的那件事」本身；没有放松任何既有断言（`deepEqual`/`match` 一条没改，数字下限一个没调）。

---

## 5. 零消费方自查

本轮**没有新增非测试的 `.ts` / `.vue` / `.cpp` 文件**（只新增两个 `tests/plugin-*.mjs` 判据文件），所以「只过自己测试的死模块」这一类风险为 0；门控也确认本域新增 0 条（唯一的 1 条红是 `src/consoleAnsi.ts`，别人的域）。

逐个新出口的消费点（`grep` 复算）：

| 出口 | 定义 | 消费方 |
|---|---|---|
| `vendorTextMatches` | `src/pluginGroups.ts:626` | 同文件 `:636`（`pluginVendorMatches`）+ `src/pluginMarket.ts:332` |
| `vendorQueryWord` | `src/pluginGroups.ts:648` | `src/components/PluginDialog.vue:390` + `src/components/PluginMarketPanel.vue:287` |
| `offersMarketplaceSearch` | `src/pluginGroups.ts:676` | `src/components/PluginDialog.vue:339`（空态链接的渲染闸） |
| `parseMarketplaceQuery` | `src/pluginMarket.ts:454` | `src/components/PluginMarketPanel.vue:81` |
| `marketplaceEffectiveSort` | `src/pluginMarket.ts:522` | `src/components/PluginMarketPanel.vue:82,84` |
| `tagQueryWord` | `src/pluginMarket.ts:516` | `src/components/PluginMarketPanel.vue:294` |
| `marketplaceEntryTagMatches` | `src/pluginMarket.ts:345` | 同文件 `:337`（`matchesMarketplaceQuery` 的 `/tag:` 那一行） |
| `loadErrors` / `otherProviders` / `focusInstalledPlugin` / `searchInMarketplace` | `src/components/PluginDialog.vue:145 / 157 / 207 / 193` | 同文件模板 `:332 / :402,408 / :445 / :339` |
| `featureProviders`（本轮接上） | `src/pluginInfo.ts:118` | `src/components/PluginDialog.vue:157`（`otherProviders`） |
| `duplicateFeatures` / `pluginLoadingErrors` / `PLUGIN_FEATURE_LABELS`（本轮接上） | `src/pluginInfo.ts:152 / 87 / 107` | `src/components/PluginDialog.vue:145-152`（`loadErrors` 的两截） |
| `pluginLoadingError`（本轮接上） | `src/pluginInfo.ts:66` | `src/components/PluginDialog.vue:398` |
| `focusPlugin` prop / `seed` prop / `focusPlugin` 事件 | `src/components/PluginDialog.vue:56`、`src/components/PluginMarketPanel.vue:48`、`:62` | 两头互挂：`src/components/PluginDialog.vue:444-445`；宿主入口交 **P-1** |

---

## 6. 做不到 / 无法核实

| 项 | 具体卡在哪一环 |
|---|---|
| `/bundled`、`/updatedBundled` 渲染成可点的筛选 | 宿主 `native/main.cpp:1416-1417` 把四个 `plugin.*` 方法都钉死在 `profile / L"plugins"` 一个目录，没有「随应用发布」那一层 ⇒ `PluginUiModel.kt:34` 的 `isBundled` 无数据来源。`native/main.cpp` 是保留文件 ⇒ 写 **P-3**（两个方案） |
| 远程仓库（在线搜索 / 下载 / 分块续传 / 评分 / `/repository:` 分组 / `/staffPicks` `/suggested` `/internal`） | 三件事叠在一起才成立：`index.html:6` 的 CSP `connect-src 'self' ws://127.0.0.1:5173`、`src/bridge.ts:109` 的 `Method` union 没有任何取数通道（`shell.openUrl` 是「丢给外部浏览器」）、远程包还要 `PluginSignatureVerifier.kt:19-25` 的签名校验。放宽 CSP + 开网络通道属于安全决策 ⇒ 交 **P-4**，本批不自行放宽，界面上也就不放"在线搜索"这种点不动的入口 |
| `PluginInfoProvider.java:19-28` 的兼容插件清单 | 同上：`:22-24` 的 `loadPlugins` 就是「从主仓库加载」，没有网络通道取不到数 |
| 市场页 `/tag:` 的**服务端**匹配语义 | **无法核实**：参考树里只有把标签拼成 `tags=` 请求参数这一步（`SearchQueryParser.kt:101-106`），服务端规则不在这棵树里。本仓沿用唯一能核实的那条口径 —— 已安装页的 `ContainerUtil.intersects`（`InstalledPluginsTabSearchResultPanel.kt:100`，标签名**全等**），并在 `src/pluginMarket.ts:334-335` 的注释里写明这是本仓选择而非上游证明 |
| 搜索建议浮层（打 `/` 弹词表 + 上下键） | 上游是 `newui/SearchPopup.kt` + `newui/SearchPopupController.java` + `newui/SearchUpDownPopupController.java`；本轮预算内未做（是"没做"，不是"做不到"），已登记在 §1 A 表 |
| `InstalledPluginsTab` 的 Swing 组件本体（`PluginsTableRenderer`、`MultiPanel`、`LinkPanel`、`PageContainer`、`CountIcon`、`TagPanel`、`RatesPanel` 等） | 沿用判词的机械档位 `[-]`（子族是 `[~]`、类本身是 Swing 组件本体的判 `[-]`，用户可见行为由本仓 DOM 落点承担）—— 本轮复核仍成立，未改 |
| 派单给的 `platform/extensions/src/com/intellij/idea/` | **无法核实**：参考树里没有这个目录（见 §0 的 `find` 结果），本轮改用三个真实路径 |
| `pf/plugins` 的 265 个类逐类复判 | 没做，也不该由本批做：逐类表在 `docs/inventory/platform_rest_verdict_table.json`（生成物），族判词在 `scripts/verdict_table.py`（保留文件）。本轮只复核族判词里的**每一条可核实断言**（§1 C 表）与 `ic/plugins` 的全部 5 个类 |

---

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-plugins.md`：

- **P-1** 外部「打开插件页并定位到某个插件」的宿主入口（`src/projectExtras.ts:35-41,186` + `src/App.vue:927,2508-2509`）—— 接收侧（`PluginDialog` 的 `focusPlugin` prop）本轮已做完，可照抄代码在请求里。
- **P-2** 市场页仓库目录成为持久设置键 `pluginMarketRoot`（`src/settingsModel.ts:111-113,183` + `native/settings_schema.cpp:140,190-192`）—— 特别强调**旧存档缺这个键要补默认**，不许按字段数量判损坏。
- **P-3** bundled 层需要宿主给出第二个插件目录（`native/main.cpp:1416-1417`），并附判词 `BundledPluginsLister` 引用的订正（判词本体在 `scripts/verdict_table.py`，主代理独占）。
- **P-4** 远程仓库的三条配套通道（网络通道 / CSP / 签名校验），属安全决策，要拍板。

另有三条**不属于本域**、收工时仍红着的，主代理需要知道归属：
引用门 2 红（11 条坏引用散在 `batch-2026-10-06-projecttree` / `-status2` / `-toolwindow2` / `-welcome2`、`wiring-requests-2026-10-06-lsp` / `-vcs2` 六份文档里，指向参考树不存在的文件，明细见 §3）；
native ctest 3 红（`lsp_codec`、`lsp_host_e2e`、`git_status_vcs`，见 §3 最后一行）。
孤儿门与三个语法工具、模块尺寸门、`vue-tsc` 收工时都是绿的。
