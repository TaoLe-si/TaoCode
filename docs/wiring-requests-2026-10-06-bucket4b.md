# 接线请求 · 2026-10-06 桶 4b（导航 / 用法 / 层级 / 最近位置）

> 我只动了本桶名下的文件。以下四条需要改**保留文件**（`src/App.vue`），按 `docs/batches-2026-10-06-buckets.md` §4 的格式提给主代理 / 桶 8。
> 规则层的逻辑与判据都已落地并跑绿，缺的只是宿主那一行绑定。

---

## W1 · App.vue 把三个导航动作并进 `createLspNavigation` 的返回值与 `navigateMenuContext`

- 目标文件：`src/App.vue` 第 1246-1248 行附近（`createLspNavigation({ ... })` 的解构列表）与第 1526 行附近（`navigateMenuContext: NavigateContext = { ... }`）
- 要接什么：`createLspNavigation` 新增导出的 `gotoSuper` / `gotoTest` / `gotoRelated`（`src/lspNavigation.ts:531`/`:558`/`:578`）
  ① 在解构里带上这三项；② 把它们加进 `navigateMenuContext`（`NavigateContext` 里我已按**可选**字段声明，
  `src/menus/navigateMenu.ts` 的 `gotoSuper?`/`gotoTest?`/`gotoRelated?`，所以不传也不会类型报错，
  只是菜单里不出现那三行 —— 见 `src/menus/navigateMenu.ts:153`/`:160`/`:168` 的 `...(ctx.xxx ? [...] : [])`）。
- 为什么需要：Ctrl+U / Ctrl+Shift+T / Ctrl+Alt+Home 三个动作的规则层（`src/navGotoSuper.ts`、`src/navGotoTest.ts`、
  `src/navGotoRelated.ts`）与宿主装配（`src/lspNavigation.ts`）都已接完并有判据
  （`tests/nav-goto-super.test.mjs` 9 条、`tests/nav-goto-test.test.mjs` 9 条、`tests/nav-goto-related.test.mjs` 6 条），
  只有菜单/键位那一行还差 ctx 绑定；不绑就没有入口，绑了才够 IDEA 的三个 GoToCodeGroup 动作。
- 上游依据：`platform/platform-impl/resources/idea/LangActions.xml:194-196`（`GoToCodeGroup` 内依次
  GotoSuperMethod / GotoTest / GotoRelated）、`platform/platform-resources/src/keymaps/$default.xml:251-253`（Ctrl+U）、
  `:254-256`（Ctrl+Shift+T）、`:257-259`（Ctrl+Alt+Home）
- 键位侧：`$default.xml` 的这三条要进本仓键位表（`src/keymapBindings.ts` 属主代理），动作 id 建议
  `navigate.super` / `navigate.test` / `navigate.related`（与菜单行 id 一致）。

## W2 · App.vue 把「选择目标」弹层作为 `chooseTargets` 传给 `createLspNavigation`

- 目标文件：`src/App.vue` 第 1248 行附近（`createLspNavigation({ ... })` 的参数对象）
- 要接什么：`chooseTargets: (targets, title) => chooseTargetHost.open(targets, {})`
  —— 出口是 `src/chooseTargetHost.ts:16` `createChooseTargetHost(deps)` 返回的 `{ chooseTarget, open, close }`
  （宿主早就在用同一个 host 承接 Ctrl+B 的多目标，见 `src/declarationNavigation.ts:16` 的 `openChooser`）。
- 为什么需要：`src/lspNavigation.ts:117` 把这个 dep 声明成**可选**，没传时 Ctrl+U / Ctrl+Shift+T / Ctrl+Alt+Home
  在**多条结果**下退化为「跳第 1 条 + 把数量报出来」（`openTargetChooser`，`src/lspNavigation.ts:520` 附近）。
  上游是 `PsiTargetNavigator` 弹层（`java/java-impl/src/com/intellij/codeInsight/navigation/JavaGotoSuperHandler.java:41-53`、
  `platform/lang-impl/src/com/intellij/ide/actions/GotoRelatedSymbolAction.kt:81` 的 "Choose Target"）——
  不接这一条就少一个真弹层。差异：`chooseTargetHost.open()` 目前**没有标题槽位**（弹层标题走
  `src/chooseTarget.ts:128` 的 `implementationChooserTitle` 那一档），我这边的 `title` 参数暂时只能忽略；
  要完全对齐上游需要给 `open()` 加一个 title 形参（属桶 5 / 主代理的文件）。
- 上游依据：同上 W1 + `platform/lang-api/resources/messages/LangBundle.properties:350`（"Choose Target"）

## W3 · App.vue 给两处 `BreadcrumbsBar` 绑 `show-members`

- 目标文件：`src/App.vue:2150`（`breadcrumbsPlacement === 'top'` 那一条）与 `src/App.vue:2174`（`bottom` 那一条）
- 要接什么：在已有的 `<BreadcrumbsBar ... />` 属性串里加一段 `:show-members="editorSettings.showMembersInNavigationBar"`
  （组件的 prop 已就绪：`src/components/BreadcrumbsBar.vue` 的 `showMembers?: boolean`，
  两处消费点 `props.showMembers ?? true`；规则在 `src/breadcrumbs.ts:59-60` `typeLevelSymbolsOnly`）
- 为什么需要：主代理已经把设置项 `showMembersInNavigationBar` 落了四处（类型 / 默认 true / 原生 schema / 白名单，
  判据 `tests/navbar-members-setting.test.mjs` 5/5 含反证），但**符号层还没消费它**。
  我这边已经把它接到面包屑规则并写了判据（`tests/breadcrumbs-symbols.test.mjs` 新增 2 条），
  宿主不绑就永远是默认的 true（关掉设置看不到效果）。
- 上游依据：`java/java-impl/src/com/intellij/ide/navigationToolbar/JavaNavBarExtension.java:103`（成员折到所在 `PsiClass`）、
  同文件 `:107`（再退到 `containingFile`）、
  `java/java-impl/src/com/intellij/lang/java/JavaBreadcrumbsInfoProvider.java:125`（`isShownByDefault() = !getShowMembersInNavigationBar()`）、
  默认值 `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:121`
- 不额外加菜单开关的理由（已写进组件头注释）：上游那条 `ViewMembersInNavigationBar`
  （`platform/navbar/frontend/resources/intellij.platform.navbar.frontend.xml:58`）在
  `platform/navbar/frontend/src/actions/ViewNavigationBarMembersAction.java:20` 里是
  `setEnabledAndVisible(!ExperimentalUI.isNewUI())` —— 新 UI 下它不进菜单，只在设置页改。本仓同理，不加假控件。

## W4 · 层级导出与固定标签页的面板按钮（沿用桶 4a 的同一条请求，这里补坐标复核）

- 目标文件：`src/App.vue` 的层级面板那一段（`hierarchy*` 工具窗内容区）
- 要接什么：`src/hierarchyView.ts` 已经导出并接好了 `exportCurrentHierarchy` / `hierarchyClipboardPayload` /
  `hierarchyExportSummary` / `pinCurrentHierarchy` / `closePinnedHierarchyTab`（`src/hierarchyView.ts:205-216`、`:238`，
  规则层 `src/hierarchyExport.ts`），只差面板上两枚按钮与固定标签页的标签条渲染。
- 为什么需要：判词 `lp/hierarchy` 的「缺：把导出接进面板、把固定标签页接进标签栏（宿主本批冻结）」。
  规则层与判据（`tests/hierarchy-export.test.mjs` 4 条，本轮把其中一条过期断言按上游形状改正并补了
  `detail` 与第三层缩进两种情形）都已就位。
- 上游依据：`platform/lang-impl/src/com/intellij/ide/hierarchy/ExporterToTextFileHierarchy.java:22-28`（`getReportText`）、
  `:33`（子级缩进四个空格）、`:36`（每行 = `indent + getHighlightedText().getText()`，不含位置）、
  `:32`+`:39-41`（不可见根不打印）、
  `platform/lsp-impl/src/impl/features/hierarchy/LspHierarchyNodeDescriptor.kt:25`/`:28`（高亮文本 = `name` + 可选 `" : detail"`）
