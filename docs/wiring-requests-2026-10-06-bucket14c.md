# 接线请求 · 2026-10-06 · 桶 14c（欢迎页 / 文件选择器 / 受信任位置 / 浏览器）

> 本桶只动了自己名下的文件；下面每一条都要落在**保留文件**或**别人名下**的文件里。
> 行号是 2026-10-06 在当前工作区实测的（`src/App.vue` 已有人在中途改过，落之前重读一次）。

## 1. 文件选择器：把「最近 / 收藏」两栏接到真数据上

- 目标文件：`src/App.vue` 第 1458-1460 行（`createFileChooserHost({ ... recent: () => [], favorites: () => [] })`）
  与第 2414 行（`<FileChooserDialog … :recent="[]" :favorites="[]" … />`）
- 要接什么：
  1. 第 1458 行那两个空数组换成真的：`recent: () => filenameRecentRows.value.map(row => row.path)`
     （`filenameRecentRows` 已在 `App.vue:542` 定义，形状是 `{ path, name }[]`，路径就是工作区相对路径，
     与 `src/fileChooserModel.ts` 的 `recentShortcuts` 输入口径一致）；
  2. 第 2414 行的 `:recent="[]" :favorites="[]"` 换成宿主那两份：`:recent="chooser.recent()" :favorites="chooser.favorites()"`
     （`createFileChooserHost` 已经把 `recent / favorites` 透出在返回对象上，见 `src/fileChooserHostState.ts:101`）。
- 为什么需要：应用内选择器左栏那两组现在**永远不渲染** —— `FileChooserDialog.vue` 的
  `shortcuts.recent / shortcuts.favorites` 拿到的恒为空数组，`v-if` 全假。上游
  `universal/UniversalFileChooser.kt:304`（左栏 Locations splitter）与 `:124-155`
  `TrustedHostsConfigurable` 同款 `TextFieldWithBrowseButton` 那几条都是「有数据就画」；
  没有数据就整栏不画是对的，但本仓数据其实是**有**的（`editorHistory`），只是没接。
- 上游依据：`platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/UniversalFileChooser.kt:304`、
  `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:206`

## 2. 打开外部链接前的那一句（未信任项目）

- 目标文件：`src/App.vue` 第 1451 行 `openExternal: url => { void request('shell.openUrl', { url }) }`
  （以及同一份 URL 出口的其它调用点：`src/quickDocHost.ts:246` `openExternalDoc`、
  `src/htmlExport.ts:354` `openInBrowser` —— 这两处不属本桶，一并列出以免漏）
- 要接什么：调用 `request('shell.openUrl', …)` **之前**过一道
  `src/trustedProjects.ts` 的 `externalLinkPrompt(url, workspace?.root, generalSettings.trustedPaths)`：
  返回非 null 就弹 `TrustedProjectDialog.vue` 同款的三按钮框（文案取
  `EXTERNAL_LINK_LABELS`，焦点在 `trust`），答完再走
  `externalLinkOutcome(choice, root, entries)` —— `open.open === true` 才真的开，
  `open.entries` 与进来那份不同时就 `saveSettingsPatch({ trustedPaths: … })`。
- 为什么需要：上游 `browse()` 在**未信任项目**里一定要先问这一句
  （`BrowserLauncherImpl.kt:59-87`），答「Open」不放行信任、答「Trust Project and Open」才落库；
  本仓现在是 `shell.openUrl` 直接开，问都没问。规则与判据都已经在
  `src/trustedProjects.ts` + `tests/trusted-external-link.test.mjs` 落地，只差这一处调用点。
- 上游依据：`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`、
  文案 `platform/platform-api/resources/messages/IdeBundle.properties:3149-3153`

## 3. 信任框的「始终信任来自此来源的项目」勾选

- 目标文件：`src/App.vue` 第 2681 行 `<TrustedProjectDialog … @resolve="resolveTrustPrompt" />`
  与 `src/workspaceLifecycle.ts:89-94`（`trustPrompt` / `sessionTrust` / `resolveTrustPrompt`）
- 要接什么：
  1. `TrustedProjectDialog.vue` 需要多一个可选 prop `trustAll?: boolean`（默认 false）+ 一条 emit 第二参，
     或按现在的签名：`resolve(choice, remember)` 之外再带一个 `trustAllParent`；
  2. 落库动作在 `resolveTrustPrompt` 里：`choice === 'trust' && trustAll` 时把
     `trustedLocationParent(root)` 写进 `generalSettings.trustedPaths`
     （规则函数 `trustedLocationParent` / `isProjectLocationOfferedForTrust` / `trustDecisionPaths`
     都在 `src/trustedProjects.ts`，`tests/trusted-trust-all.test.mjs` 已判据；
     「配置目录里的项目不给这一项」那条也已经在规则里）；
  3. 同时把 `src/trustedProjects.ts` 新加的会话级那一档接起来：
     `src/workspaceLifecycle.ts:91-94` 的本地 `sessionTrust` ref 换成
     `rememberSessionTrust(path, trusted)` + `sessionTrustEntries()`（同文件 92 行的
     `trustEntries()` 就能直接 `mergeTrustEntries(generalSettings.trustedPaths, sessionTrustEntries())`）。
     换完之后设置页那张表会自动多出「本次会话」那几行（`TrustedLocationsSettingsPage.vue` 已经在读并集）。
- 为什么需要：勾选框与「以后不再询问」的差别是**写父目录**还是**写项目目录**，
  现在前者没有任何落点；`TrustedLocationsSettingsPage.vue` 的并集渲染同理（规则有、数据源在他人文件里）。
- 上游依据：`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`、
  `platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:61-69`/`:80-89`

## 4. 「用指定浏览器打开」缺的那条宿主通道（浏览器族①②③）

- 目标文件：`native/main.cpp`（分派表）+ 新 `native/browser_launch.cpp` + `CMakeLists.txt`（注册）
  + `src/bridge.ts:109` 的 `Method` union + `src/settings_schema.cpp`（浏览器表的键）
- 要接什么：一条 `shell.openUrlWithBrowser { url, path, args }`
  （`ShellExecuteW(path, nullptr, url + 附加参数, …)`；mac/Linux 对应 `posix_spawn` 一条 argv），
  以及 `generalSettings` 里的浏览器表存储（`browserList` + `defaultBrowserPolicy`，
  **新增字段要给缺失键补默认值**：`browserList: []`、`defaultBrowserPolicy: 'system'`，
  不能按键数判存档损坏）。规则侧本仓已经有：`src/browsers.ts` 的
  `predefinedBrowsers/selectDefaultBrowser/firstActiveBrowser/addBrowser/updateBrowser/setBrowserActive`，
  缺的只有「把选出来的可执行文件真的拿去开 URL」这一步与那份持久存储。
- 为什么需要：宿主唯一的 URL 出口 `shell.openUrl` 走的是
  `native/workspace.cpp` 的 `open_external`（系统默认浏览器），
  所以 `ConfigurableWebBrowser`/`BrowserSettings` 那张表选完没有地方去 —— 这也是
  本批**没有**给浏览器建设置页的原因（建了就是假控件）。
- 上游依据：`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:54-57`
  （`getDefaultBrowser()` 只在 `DefaultBrowserPolicy.FIRST` 时给 `firstActiveBrowser`）、
  `platform/platform-impl/src/com/intellij/ide/browsers/BrowserSettingsPanel.kt:83`/`:111`/`:115`
  （表格的 clone / isEditable / isRemovable）、
  `platform/platform-impl/src/com/intellij/ide/browsers/BrowserSelector.java:21`、
  设置页注册 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1306`
  （`id="reference.settings.ide.settings.web.browsers"`）

## 5. `FileChooserDialog` 的多选（描述件那一半已就绪）

- 目标文件：`src/App.vue:1458-1460`（宿主 `choose` 的返回签名）与 `src/fileChooserHostState.ts:59-64`
- 要接什么：本桶**没有**实现多选，先把卡点写实：`ChooserNode` 那侧的树已经能画，
  但 `choose()` 的契约是 `Promise<string | null>`，`onPick`（`src/fileChooserHostState.ts:67`）
  收到一条路径就把这次调用结掉；要支持 `descriptor.chooseMultiple`
  （`src/fileChooserDescriptor.ts:92-102` 的 `multiFilesDescriptor` 等三个预设）就得加一条
  `chooseMany(): Promise<string[] | null>` 并在 `FileChooserDialog.vue` 的行上开 Ctrl/Shift 多选
  （上游 `FileChooserDialogImpl.java:452` `getSelectedFiles()` 返回的就是数组，
  `:552` 把它塞进 `CommonDataKeys.VIRTUAL_FILE_ARRAY`）。
- 为什么需要（以及为什么现在不做）：仓里**没有**一个调用方用 `chooseMultiple` 的描述件
  （唯一的调用点是 `App.vue:1451` 那条 `pickDirectory`，单目录）。
  在没有消费方之前把行做成可多选，就是 playbook §3 说的假控件。
  等第一个多选调用点（例如「附加目录」「安装多个插件包」）落地时，这条与它一起做。

## 处理结果（wiring-backlog lane，2026-10-06）

- **1 已接线**：`src/App.vue:1521` 宿主 `recent: () => filenameRecentRows.value.map(row => row.path)`，`:2470` `<FileChooserDialog … :recent="chooser.recent()" :favorites="chooser.favorites()" …>`。
- **2 已接线（形状升级）**：URL 出口收成唯一一条 `src/externalLinkLauncher.ts` 的 `openExternalUrl`（内部走 `browseWithTrustCheck` = `externalLinkPrompt`/`externalLinkOutcome` 的门禁）。消费点 `src/App.vue:1070/:1511`、`src/quickDocHost.ts:257`、`src/components/TerminalPanel.vue:429`、`src/components/RunConsole.vue:254` 全部改走它；门禁装配在 `src/workspaceLifecycle.ts:214` 的 `installExternalLinkGate`。比逐处调 `externalLinkPrompt` 更严（收成一条出口）。
- **3 已接线**：`src/components/TrustedProjectDialog.vue:46` 的 `resolve` 已是三参 `(choice, remember, trustAll)`、`:107-108` 的勾选框按 `trustAllAvailable` 条件渲染；宿主 `src/App.vue:2667` 传 `:can-trust-all="trustCanTrustAll"`、`:2668` `@resolve="resolveTrustPrompt"`；落库在 `src/workspaceLifecycle.ts:166` 的三参 `resolveTrustPrompt` → `trustResolver`；会话级信任 `sessionTrustEntries()` 已被 `TrustedLocationsSettingsPage.vue:19/:27` 读并集。
- **4（指定浏览器通道）跳过** —— 目标 `native/main.cpp`（禁改）+ `native/browser_launch.cpp` + `CMakeLists.txt` + `src/bridge.ts`（前端接线 lane 独占）。需 native/bridge owner 处理。
- **5（FileChooserDialog 多选）不做** —— 请求原文自己判定「没有消费方之前做 = 假控件」。维持。

结论：零待接（1/2/3 早已接线），未改任何文件。
