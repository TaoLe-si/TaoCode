# 桶 4b · 导航 / 用法 / 层级 / 最近位置 —— 收尾报告（2026-10-06）

接手点：上一位（桶 4a）在「开始写新模块：workspace-symbol 缓存 + choose-by-name 过滤器」处被切断，
两个文件已落但**零消费方、也零判据**（头注释里承诺的 `tests/nav-workspace-symbol-cache.test.mjs` /
`tests/nav-choose-by-name-filter.test.mjs` 根本不存在）。本轮：把这两个接进真实生产链路并补判据，
顺带把同一条链路上的 `navGotoSuper.ts` / `navGotoTest.ts` / `navGotoRelated.ts` 三个孤儿一并接完；
消费 `showMembersInNavigationBar`；修掉域内那条已知红。

---

## 1 · 两个孤儿的接线结论（都是真消费方，不是假接线）

### `src/navWorkspaceSymbolCache.ts`（上游 `LspSingleSlotCache`）

- 接线：`src/lspNavigation.ts:133` 建槽（计数源 = 同模块的 `symbolRevision`），
  `:384` 在 `globalSymbolEntries` 里用 `getOrCompute(q, () => null)` **探测**命中，
  命中直接复用（不再发 `workspace/symbol`），未命中才发请求，成功后 `:395` 落槽。
  槽里存的是**服务器原始应答**，合并/去重/排序与类别过滤都在缓存之后（`:373-374` `visibleSymbols`）。
- 计数递增的三个真实触发点：`src/lspNavigation.ts:242`（`onEditorChange`，编辑器内容变化）、
  `:265`（`stopLspFile`，文件关闭）、`:445`（`onSearchReplaced`，批量替换改写磁盘）。
  `clearCache()` 的触发点：`:279`（`resetLsp`，语言服务重启）、`:600`（`workspaceEpoch` 变化，换工程）。
- 「没答上来」与「答了空表」的区分照上游：`available:false` / catch 只清列表**不入槽**，
  空表入槽并复用（`src/lspNavigation.ts:391-395`）。
- 上游依据（本轮逐行核过并订正了模块头里三处偏移的行号）：
  `platform/lsp-impl/src/impl/LspRequestExecutor.kt:51`（`LspSingleSlotCache<String, List<WorkspaceSymbol>>` 的注册）、
  `:156-163`（`getWorkspaceSymbolsCaching`，失败 `return@getOrCompute null`）、
  `platform/lsp-impl/src/impl/cache/LspSingleSlotCache.kt:19`（类）、`:21`（默认 `matches` = 键相等）、
  `:36`（`lastPsiModificationCount == psiModCount`）、`:38`（`lastKey = key`）、`:42`（`?: return null` 不入槽）、
  `:50-53`（`clearCache()`）；调用侧顺序
  `platform/lsp-impl/src/impl/features/workspaceSymbol/LspWorkspaceSymbolContributor.kt:73`（先取缓存）→ `:86`（再 `shouldAcceptSymbolKind`，声明在 `:69`）。
- 判据：新增 `tests/nav-workspace-symbol-cache.test.mjs`（8 条：命中/计数失效/单槽顶替/null 不入槽/空表入槽/`clearCache`/键交换（自定义 `matches`）/接线正则）。

### `src/navChooseByNameFilter.ts`（上游 `ChooseByNameFilter` + `FilteringGotoByModel`）

- 接线（三处，全部生产）：
  ① 规则生效 —— `src/lspNavigation.ts:368`（`fileSymbolEntries`，Ctrl+F12 文件符号）与
  `:374`（`globalSymbolEntries` → `visibleSymbols`，Ctrl+Shift+Alt+N / Ctrl+N）；
  ② 开关 UI —— `src/menus/navigateMenu.ts:84` 的「按类型过滤」子菜单：
  四档多选行（`checked` 真读状态）+ All/None/Invert 三钮 + 标题里的点亮信息（`:17` `gotoFilterTitle`，
  用 `filterActionActive` 判灭/亮、`isDegenerateHidden` 换退化态措辞）；
  ③ 状态一变当场重算 —— `src/lspNavigation.ts:603` 的 `watch(hiddenSymbolGroups, …)`。
  排除态由该模块自己持久化（localStorage `taocode.gotoSymbolFilter`，上游是 `filter.xml`）。
- **抓到一个真 bug 并改正**：`invertHidden()` 原来写的是「与 hidden 的交集」（等于没反选），
  与上游 `invertSelection()` 的补集语义相反，新判据直接把它打红后改为
  `SYMBOL_FILTER_GROUP_IDS.filter(id => !hidden.includes(id))`。
  同时订正了模块头里 `isDegenerateHidden` 的错误说法（原来写「上游没有这个按钮，本仓也不给」——
  上游 None 钮确实会把清单清成空，`ChooseByNameFilter.java:110`），现在按真实用途（菜单措辞）写。
- 上游依据（本轮逐行核过）：`platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilter.java:40`（类）、
  `:82-84`（`isActive()` = 有被排除的类别）、`:87`（工具条）、`:95`（`popup.setToolArea`）、
  `:101-117`（清单 + All/None/Invert，`setAllElementsMarked(true)` **:107** / `(false)` **:110** / `invertSelection()` **:113**）；
  `platform/lang-api/resources/messages/LangBundle.properties:372-374`（`label.all=All` / `label.none=None` / `label.invert=Invert`）；
  `platform/lang-impl/src/com/intellij/ide/util/gotoByName/FilteringGotoByModel.java:45-52`（`acceptItem`，`filterValueFor` 在 `:54`）；
  「类」档四类 = `LspGoToClassContributor.kt:7-12`，与 `src/lspSymbolBridge.ts:58` 共用常量。
- 判据：新增 `tests/nav-choose-by-name-filter.test.mjs`（13 条，含「子菜单真的驱动状态」与
  「菜单行只在宿主给了函数时才出现」两条接线用例）。
- 架构不等价（如实，写在模块头）：上游的过滤维度按 provider 分 FileType / Language / SymbolKind 三套并靠 EP 装配；
  本仓符号唯一来源是 LSP `workspace/symbol` ⇒ 只有 SymbolKind 一档，分组切法是本仓自定，
  但「All/None/Invert 三钮」「排除态持久化」「有排除才点亮」三条形状来自上游。

### 顺带清掉的三个同链孤儿（同一条纪律：不许留只过自己测试的死模块）

`src/navGotoSuper.ts`、`src/navGotoTest.ts`、`src/navGotoRelated.ts` 现在都有生产消费方：
宿主装配在 `src/lspNavigation.ts:531`（`gotoSuper`）/ `:558`（`gotoTest`）/ `:578`（`gotoRelated`），
菜单行在 `src/menus/navigateMenu.ts:153`/`:160`/`:168`（宿主没给函数就不渲染，不放假控件），
标题/分组常量复用 `gotoTestActionLabel`、`gotoTestDirection`、`GOTO_RELATED_ACTION_LABEL`。
**又一个真 bug**：`navGotoSuper.enclosingSuperTarget` 的次级排序方向写反（起点相同时把**区间大**的排前，
于是同行「外层类 + 内层方法」拿到的是类而不是方法，与 `getNonStrictParentOfType` 相反）——
`tests/nav-goto-super.test.mjs` 的同行用例打红后改正（`src/navGotoSuper.ts:77-80`）。
新增判据：`tests/nav-goto-super.test.mjs`（9）、`tests/nav-goto-test.test.mjs`（9）、`tests/nav-goto-related.test.mjs`（6，含三档结果与接线）。

---

## 2 · `showMembersInNavigationBar` 的消费结论

主代理已落四处（类型 / 默认 true / 原生 schema / 白名单）；本轮只补**符号层消费**：

- 规则：`src/breadcrumbs.ts:59-60` 新增 `typeLevelSymbolsOnly(symbols, showMembers)`，
  关掉时只保留 Class/Enum/Interface/Struct（5/10/11/23，复用 `src/lspSymbolBridge.ts:58`）。
  消费点两处：`:72`（`symbolBreadcrumbs` 的符号链）与 `:92`（`siblingCandidates` 的兄弟池）。
- 组件：`src/components/BreadcrumbsBar.vue` 新增 `showMembers?: boolean`，
  两处 `props.showMembers ?? true`（缺省 = 现状不变），并订正了组件头里「开关没有」的旧说法。
- 效果：关掉后面包屑停在**类名**，点类名弹的是同层兄弟**类**而不是方法。
- 判据：`tests/breadcrumbs-symbols.test.mjs` 新增 2 条（规则 8 项断言 + 组件两处传参的接线断言）。
- 上游依据：`java/java-impl/src/com/intellij/ide/navigationToolbar/JavaNavBarExtension.java:103`
  （成员 → 所在 `PsiClass`）、同文件 `:107`（再退到 `containingFile`）、
  `java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125`
  （`isShownByDefault() = !getShowMembersInNavigationBar()`）、
  默认值 `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`。
- 不加菜单开关的依据：`platform/navbar/frontend/src/actions/ViewNavigationBarMembersAction.java:20`
  把它 `setEnabledAndVisible(!ExperimentalUI.isNewUI())` —— 新 UI 下不进菜单，只在设置页改；
  该动作 id 在 `platform/navbar/frontend/resources/intellij.platform.navbar.frontend.xml:58`。
- 宿主绑定（`editorSettings.showMembersInNavigationBar` → `:show-members`）在冻结的 `App.vue:2150`/`:2174`
  ⇒ 已提请求 W3。

---

## 3 · 族判词表

| 族 | 项（判词里的「缺」） | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| `ls/navigation` ④ | workspace symbol 客户端缓存 | **已做** | `platform/lsp-impl/src/impl/LspRequestExecutor.kt:51`、`:156-163`；`impl/cache/LspSingleSlotCache.kt:19/21/36/38/42/50-53` | `src/navWorkspaceSymbolCache.ts:37-88`；`src/lspNavigation.ts:133/242/265/279/384/395/445/600` | 单槽、键=查询串、null 不入槽、空表入槽；判据 8 条 |
| `ls/navigation` ③ / `lp/navigation` | `ChooseByNameFilter` 的按类型过滤 + 持久化 | **已做（能做的两半）** | `lang-impl/.../ChooseByNameFilter.java:40/82-84/87/95/101-117`；`FilteringGotoByModel.java:45-52/54`；`LangBundle.properties:372-374`；`LspWorkspaceSymbolContributor.kt:69/86` | `src/navChooseByNameFilter.ts`（全文件）；`src/lspNavigation.ts:368/374/603`；`src/menus/navigateMenu.ts:17/84-99` | EP 宿主那一半做不到（见 §6） |
| `lp/navigation` | `GotoSuperAction`（Ctrl+U） | **已做** | `platform/platform-resources/src/keymaps/$default.xml:251-253`；`platform/platform-impl/resources/idea/LangActions.xml:194`；`java/java-impl/src/com/intellij/codeInsight/navigation/JavaGotoSuperHandler.java:41-53/68` | `src/navGotoSuper.ts`（修正 `:77-80`）；`src/lspNavigation.ts:531`；`src/menus/navigateMenu.ts:153` | LSP 无「父方法」请求 ⇒ 类走 `typeHierarchySupertypes`，方法走父类型 `documentSymbol` + 同名/参数个数近似（差异写在模块头） |
| `lp/navigation` | `GotoTest`（Ctrl+Shift+T） | **已做** | `$default.xml:254-256`；`LangActions.xml:195`；`lang-impl/.../GotoTestOrCodeHandler.java:50-60/111-119`；`TestFinderHelper.java:115-127`/`:85-90`；`java/java-impl/.../JavaTestFinder.java:62/95/105-110/122-124` | `src/navGotoTest.ts`；`src/lspNavigation.ts:558`；`src/menus/navigateMenu.ts:160` | 比对源 = `workspace.entries`（无 PSI）；测试源根判定是本仓自定清单，已逐条写明 |
| `lp/navigation` | `GotoRelated`（Ctrl+Alt+Home） | **已做（两个 provider）** | `$default.xml:257-259`；`LangActions.xml:196`；`lang-impl/src/com/intellij/ide/actions/GotoRelatedSymbolAction.kt:63-82`；`lang-api/src/com/intellij/navigation/GotoRelatedItem.java:23-43`；`LangBundle.properties:138`/`:350` | `src/navGotoRelated.ts`；`src/lspNavigation.ts:578`；`src/menus/navigateMenu.ts:168` | provider①= 测试↔被测（上游 `GotoTestRelatedProvider.java:23-44`）；provider②= 同名 `.h`↔`.cpp`（上游社区树无对应实现 ⇒ 登记「无法核实上游依据、本仓自定」，后端真实） |
| `lp/hierarchy` | 导出接进面板 / 固定标签页接进标签栏 | **规则层已消费，UI 差宿主一行** | `platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java:22-28/33/36/32/39-41`；`impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25/28` | `src/hierarchyExport.ts:62-73`；被 `src/hierarchyView.ts:205-216/238` 调用（孤儿门禁已确认「已接上」） | 域内那条已知红就是这里（见 §4）；按钮/标签条 ⇒ 请求 W4 |
| `lp/hierarchy` | `HierarchyBrowserScopes` 范围收窄 | **已有消费方** | `platform/lang-impl/src/com/intellij/ide/hierarchy/maven/…`（**无法核实**：社区树里 `HierarchyBrowserScopes` 按文件名/包路径都搜不到，只命中 `HierarchyBrowserBaseEx` 侧的 scope 概念） | `src/hierarchyScopes.ts` ← `src/hierarchyView.ts`（本轮 grep 确认） | 不在本轮改动范围，只复核消费方 |
| `ls/hierarchy` | `LspHierarchyNodeDescriptor.getIcon` 按 kind 图标 | **未做**（卡点见 §6） | `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25-30`（图标槽在同文件的 `getIcon`） | — | 面板行形状是 `{name, detail}`，加图标要动 App.vue 内容区 |
| `lp/usage-view` / `ixa/find-usages` / `lp/highlighting` / `rf/core` | 各行的「缺」 | **本轮未动** | 见 §6 的逐条卡点 | — | 预算优先给了两个孤儿 + 三个同链孤儿 + 那条已知红 + 设置项消费 |

---

## 4 · 那条已知红：`导出文本：缩进 + 位置（1 基）、递归节点带 …`

判定：**断言过期，不是代码回归**。

- 上游 `ExporterToTextFileHierarchy.java:36` 每行只打 `descriptor.getHighlightedText().getText()`，
  `:33` 子级缩进是 **四个空格**；而 LSP 那族的高亮文本 = `item.name`（`LspHierarchyNodeDescriptor.kt:25`）
  + 可选 `" : detail"`（`:28`）——**不含位置**。全树里只有 `plugins/ant/.../AntTargetNodeDescriptor.java:88`
  这种个别 descriptor 才往 `getEnding()` 里塞 `" (presentableName)"`，层级 descriptor 没有（grep `myHighlightedText` 全树仅此两处 + LSP 那一处）。
- 旧断言要的 `run (src/A.java:5)` 与两空格缩进两头都不属于上游这一路 ⇒ 代码是对的（位置列在
  `hierarchyClipboardText`，`:84-95`，`tests/hierarchy-export.test.mjs` 第 2 条已经在守它）。
- 处置：按上游形状**改测试**并把意图守住（缩进累加、`… ` 前缀、` : detail` 尾巴、位置不在这一路），
  没有放松任何断言（原来 3 条 `assert.equal` → 现在 5 条，覆盖了 detail 与第三层缩进）。

另两条被撞红的既有断言（不是我引入的回归，都是**别人改对了形状**）：

- `tests/recent-files-model.test.mjs:84`：期望无扩展名的 `from './recentFilesModel'`；
  宿主 `src/explorerActions.ts` 已按仓规补 `.ts` ⇒ 断言改成守「带扩展名」。
- `tests/lsp-symbol-bridge.test.mjs:94`：期望 `mergeWorkspaceSymbols([result.symbols ?? []]`；
  本轮把合并挪进 `visibleSymbols`（缓存 → 过滤 → 合并）⇒ 断言改成
  `mergeWorkspaceSymbols([filterSymbols(symbols, hiddenSymbolGroups.value)]`，意图（必须经过合并层）不变、且更精确。

---

## 5 · 改动文件

**修改**
1. `src/lspNavigation.ts` —— 缓存槽 + `symbolRevision` 计数 + `visibleSymbols` 过滤 + `fileSymbolEntries`/`globalSymbolEntries` 改造 + `gotoSuper`/`gotoTest`/`gotoRelated`/`openTargetChooser`/`revealFileAtTypeLine` + 两个 `watch` + `chooseTargets?` 可选 dep + 新返回值。
2. `src/menus/navigateMenu.ts` —— 「按类型过滤」子菜单（四档 + All/None/Invert + 动态标题 `gotoFilterTitle`）、`navigate.super`/`navigate.test`/`navigate.related` 三行（宿主没给函数就不渲染）、`NavigateContext` 三个可选字段。
3. `src/navWorkspaceSymbolCache.ts` —— 补「消费链路」段；订正 3 处上游行号（`:35→:36`、`:41→:42`、`:48-52→:50-53`、`:24→:21`）；删掉零消费者的 `WorkspaceSymbolCacheOptions` 接口。
4. `src/navChooseByNameFilter.ts` —— **修 `invertHidden` 的补集 bug**；订正 `ChooseByNameFilter.java`/`FilteringGotoByModel.java` 的行号；`isDegenerateHidden` 的注释按真实用途重写。
5. `src/navGotoSuper.ts` —— **修 `enclosingSuperTarget` 同行次级排序方向**（区间小的在前）。
6. `src/breadcrumbs.ts` —— 新增 `typeLevelSymbolsOnly`，`symbolBreadcrumbs`/`siblingCandidates` 各加末位 `showMembers = true`。
7. `src/components/BreadcrumbsBar.vue` —— 新增 `showMembers?` prop 并两处传给规则层；头注释 2/3 两条差异改写为现状。
8. `tests/hierarchy-export.test.mjs` —— 过期断言按上游形状改正 + 补 detail/三层缩进两档。
9. `tests/breadcrumbs-symbols.test.mjs` —— 新增 2 条（规则 + 组件接线）。
10. `tests/recent-files-model.test.mjs`、`tests/lsp-symbol-bridge.test.mjs` —— 各 1 条形状过期断言改精确（见 §4）。

**新增**
`tests/nav-workspace-symbol-cache.test.mjs`（8）、`tests/nav-choose-by-name-filter.test.mjs`（13）、
`tests/nav-goto-super.test.mjs`（9）、`tests/nav-goto-test.test.mjs`（9）、`tests/nav-goto-related.test.mjs`（6）、
`docs/batch-2026-10-06-bucket4b.md`（本文件）、`docs/wiring-requests-2026-10-06-bucket4b.md`（W1-W4）。

没动：`App.vue`/`CodeEditor.vue`/`style.css`/`tokens.css`/`uiIcons.ts`/`settingsModel.ts`/`settingsTreeMeta.ts`/
`bridge*`/`keymap*`/`actionRegistry.ts`/`menus/types.ts`/`module-size.test.mjs`/`source-citations.test.mjs`/`CMakeLists.txt`；
也没动 `src/searchEverywhere*`（9b）、`src/problems*`（2b）、`src/tool*`/`src/popup*`（8b）。无新图标、无新动效、无裸 hex/毫秒/曲线。

---

## 6 · 验证数字

- 域测试（任务书那条）：`node --test tests/nav*.test.mjs tests/usage*.test.mjs tests/hierarchy*.test.mjs tests/recent*.test.mjs tests/breadcrumb*.test.mjs` ⇒ **169 / 169 绿**。
- 加上跨接线的邻居（`navigate-in-file`、`navigation-symbol-filter`、`non-code-usages`、`navbar-members-setting`、
  `find-results-nav`、`find-recents`、`diff-nav`、`status-bar-nav`、`inline-completion-nav`、`lsp-symbol-bridge`）⇒ **221 / 221 绿**。
- 本轮新判据合计 **45 条**（8+13+9+9+6），另加 `tests/breadcrumbs-symbols.test.mjs` 的 2 条 = 47 条。
- `node --test tests/module-size.test.mjs` ⇒ 5/5 绿；我的文件行数：`lspNavigation.ts` 616、
  `navigateMenu.ts` 186、`breadcrumbs.ts` 147、`BreadcrumbsBar.vue` 198、`navGotoSuper.ts` 247、
  `navChooseByNameFilter.ts` 168（上限 900，未调上限）。
- 三个检测器：`node .tools/find-missing-ext.mjs` ⇒ 扫 1141 个文件「干净」；
  `node .tools/find-param-props.mjs` ⇒ 0 处参数属性；
  `node .tools/find-orphan-modules.mjs --gate` ⇒ 我这五个模块全部出红名单（`navWorkspaceSymbolCache`/`navChooseByNameFilter`/
  `navGotoSuper`/`navGotoTest`/`navGotoRelated`），门禁剩下的 4 个新增孤儿都在别桶
  （`cvLocalVision`/`editorCodeBlock`/`editorJoinComments`/`externalSystemDataStorage`）。
- 真判据（`.ts` 能被 Node ESM 加载）：`navWorkspaceSymbolCache`、`navChooseByNameFilter`、`lspNavigation`、
  `breadcrumbs`、`menus/navigateMenu`、`navGotoSuper`、`navGotoTest` 逐个 `await import()` 全部 OK。
- 类型：`npx vue-tsc -b --force` 与 `npx vue-tsc --noEmit` 都只剩 **1 个错误**：
  `src/customFoldingProviders.ts(48,103): error TS1002: Unterminated string literal.` ——
  那是折叠桶（别桶）在我这轮进行中被写下的半成品，不在我的文件清单里，我没动它。我名下文件零类型错误。

## 7 · 反向验证（新门禁不是空转）

1. 把 `src/breadcrumbs.ts:60` 的门禁写成 `showMembers ? [...symbols] : [...symbols]`（关掉不生效）
   ⇒ `tests/breadcrumbs-symbols.test.mjs`「showMembers 关掉…」立刻红；改回 ⇒ 绿。
2. 把 `src/lspNavigation.ts:384` 的探测写成 `getOrCompute(q, () => null as never)`
   ⇒ `tests/nav-workspace-symbol-cache.test.mjs`「接线：宿主真的在用它」红；改回 ⇒ 绿。
3. 把 `src/menus/navigateMenu.ts` 的 `id: 'navigate.filter.all'` 改成 `navigate.filter.allX`
   ⇒ `tests/nav-choose-by-name-filter.test.mjs`「接线：…真的驱动状态」红；改回 ⇒ 绿。
4. 两处**未注入就已经红**的实证（最强的一条）：`invertHidden` 的交集 bug 与 `enclosingSuperTarget` 的排序方向 bug
   都是新判据先打红、我再改代码（不是先改代码再凑断言）。

---

## 8 · 做不到 / 卡点（具体，不写「太复杂」）

1. `ChooseByNameContributor` / `GotoRelatedProvider` 的**扩展点宿主**（`lp/navigation`、`ls/navigation` ③、`ixa/find-usages` 的 provider 层）：
   本仓没有插件加载器与 EP 注册表（`platform/lang-api/resources/intellij.platform.lang.xml:124` 那类声明无处消费），
   符号唯一来源是宿主 `lsp.request` 的两条 kind（`workspaceSymbol`/`documentSymbol`）。
   ⇒ 落成的等价物：provider 表写成模块内数组（`src/navGotoRelated.ts:96-99`）、过滤表写成常量数组（`SYMBOL_FILTER_GROUPS`）。
   上游其余 provider（devkit `*_TestData`、junit `@Parameters`、properties i18n、Kotlin expect/actual）需要 PSI 或语言专属索引，**不做**。
2. `Ctrl+hover` 的符号链接与 hover 里的多定义弹层（`lp/navigation`，上游 `CtrlMouseHandler`）：
   要动 `src/components/CodeEditor.vue`（冻结、贴着 1147 行上限）的 hover 装饰层，且需要 hover 侧新增
   `definition`/`typeDefinition` 请求通道；本仓现在只有 `src/documentLinksExtension.ts` 的 Ctrl+Click 一条路 ⇒ 未做。
3. `JBProtocolNavigateCommand` 的 `jetbrains://` 外部导航（`lp/navigation`）：入口是 native 的命令行/协议回调
   （`native/main.cpp`，不属本桶文件清单，前端也拿不到 URI）⇒ 无法在本桶接。
4. `ls/navigation` ①`LspDynamicFiles`、②`LspImplicitReferenceProvider`/`LspSymbolTypeProvider`：
   宿主的 URI 模型只做 `file:` → 工作区相对路径（`src/bridge.ts` 的 `to_path`），没有内存/动态文档模型；
   也没有 PSI 的 `Symbol`/`resolveReference` 对象模型 ⇒ 只保留「typeDefinition 结果即可导航目标」这一层形状。
5. `ls/navigation` ⑤ `LspStructureViewSupport` 的视图选项：结构视图面板属桶 5（`src/outlineView.ts` 不在我清单）；
   `LspDocumentLinkCache` 归 `ls/highlighting`（桶 2）。
6. `ls/hierarchy` 的 `getIcon` 按 kind 图标：面板行形状是 `{name, detail}`（`src/hierarchyView.ts`），
   图标槽要动 App.vue 的层级内容区 + `src/uiIcons.ts`（冻结），且本仓没有 `SymbolKind → lucide 图标`的现成映射 ⇒ 未做（与 W4 同一批宿主改动才成立）。
7. `lp/usage-view`「按引用类型分组」与 `lp/highlighting`「`HighlightUsagesHandlerBase` 读写分类」：
   LSP `textDocument/references` 不回 kind（只有 `documentHighlight` 带 kind），
   且引用面板/弹窗渲染在 `App.vue` 与 8b 名下的 `src/tool*`/`src/popup*` ⇒ 我不能改。
8. `rf/core` 的 Switcher（Ctrl+Tab）入口与 `recentlyEdited`/pinned 两档 UI 消费者：
   宿主是禁改的 `App.vue`（模型侧 `src/recentFilesModel.ts` 已被 `src/explorerActions.ts`、`src/fileChooserModel.ts` 消费，
   `tests/recent-files-model.test.mjs` 已守）⇒ 只能交请求；跨端 RPC 形态（`RecentFilesBackendApiProvider` 等）在单进程宿主下无对应物。
9. `src/navGotoSuper.ts` 的方法档在「父类型成员」拿不到时跳过：JDT 对 `*-sources.jar` 里的类型不答 `documentSymbol` ⇒
   不画假节点（同 `src/hierarchyView.ts:68-74` 的 `mapNotNull` 口径），差异写在模块头。
