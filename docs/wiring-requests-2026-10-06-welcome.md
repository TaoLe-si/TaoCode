# 接线请求 · 2026-10-06 · welcome 桶（欢迎页 / 文件选择器 / 受信任位置 / 浏览器 / 结构视图跟随）

> 本桶只动了自己名下的文件（`src/structureFollow.ts`、`src/components/OutlinePanel.vue`、
> `src/fileChooserModel.ts`、`src/fileChooserHostState.ts`、`src/components/FileChooserDialog.vue`、
> `src/trustedProjects.ts`、`src/components/TrustedProjectDialog.vue`、`src/browsers.ts`）。
> 下面每一条的目标文件都是**保留文件**或别人名下的文件（`src/App.vue` / `src/workspaceLifecycle.ts` /
> `src/components/TerminalPanel.vue` / `src/quickDocHost.ts` / `src/bridge.ts` / `native/*` / `CMakeLists.txt`）。
> 行号是本桶 2026-10-06 收工前实测的；`src/App.vue` 在被并行改（本轮内它动了三次），**落之前按引文重定位**。

---

## W1b · 给结构视图的光标补上「列」（W1 的行差一已修，列还缺）

- **背景（留痕）**：W1（`ToolWindowView.vue` 的 `:source="ctx.todoSource"`）**已落**，但复核发现
  两边基准不同：`ctx.todoSource` 给的是**编辑器 1 基行**（`src/components/CodeEditor.vue:1022`
  `emit('cursor', line.number, pos - line.from + 1)`），而符号区间是 **LSP 0 基**
  （`native/lsp_support.cpp:174-175` 原样透传；跳转同口径，`src/components/CodeEditor.vue:815` 的
  `applyReveal` 用 `target.line + 1`）。**已在本桶名下修好**：`OutlinePanel.vue` 现在按
  `props.source.line - 1` 送进 `caretSymbolInTree`，判据 `tests/outline-caret-source.test.mjs`。
- **还差的这一环**：那份数据源**没有列** ⇒ 结构视图只能按行选中。同一行里有两个符号时
  （`int a; int b;`、或 lambda 与它后面的一条语句）上游选的是光标那个，本仓会选到行里第一个包住它的。
- **目标文件 / 行号**：`src/App.vue:217`
- **可照抄的整段替换**（只加一个字段，`Tab` 已经有 `column`，见 `src/editorTab.ts:8`）：

```ts
const todoSource = computed(() => active.value ? { path: active.value.path, line: active.value.line, character: active.value.column } : null)
```

- **为什么不用改 `TodoPanel`**：它的 prop 是 `{ path: string; line: number }`
  （`src/components/TodoPanel.vue:16`），多给一个字段不是超额属性检查的对象（那是 computed 的返回值，
  不是字面量），类型与行为都不变。`OutlinePanel.vue:16` 的 prop 早就声明了 `character?: number`，
  换算函数 `caretCharacterInSymbolBasis`（`src/structureFollow.ts:88`）也已经按「1 基列 → 0 基列」写好在等。
- **上游依据**：`platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:804-849`
  （`MyAutoScrollFromSourceHandler` 注册光标监听并在 `:841` 读开关）与
  同文件 `:655-661`（`scrollToSelectedElement`：光标一动就把树里包住它的那个元素选中并滚过去）——
  上游拿的是**偏移量**（行 + 列一起），不是只有行。

## W2 · 打开外部链接前的那一句（四个 URL 出口共用一条判定）

- **模块侧已做完**：`src/trustedProjects.ts` 新增 `browseWithTrustCheck(url, deps)` —— 它就是上游
  `browse()` 里那条 `canBrowse` 链（trim → 该不该问 → 答完之后开不开 / 写不写清单 → 才真的开）。
  弹框组件也已就绪：`src/components/TrustedProjectDialog.vue` 的 `mode="link"` 那一档
  （标题 / 正文 / 三颗按钮 / 焦点全取 `EXTERNAL_LINK_*`）。判据：`tests/welcome-trust-dialog.test.mjs` 后 4 条。
- **为什么要一次接四处**：上游只有一个 `browse()`，判定长在它里面（`BrowserLauncherAppless.kt:99`）；
  本仓的出口有四条，漏一条就是「有个地方不问就开了」：
  1. `src/App.vue:1416` `openExternal: url => { void request('shell.openUrl', { url }) }`
     —— 这是 `createHtmlExport` 的 dep，被 `src/htmlExport.ts:212`/`:354`
     （`draft.openInBrowser` 那一路，「在浏览器里打开导出的 HTML」）吃；
  2. `src/App.vue:1000` `try { await request('shell.openUrl', { url: action.url }) }`
     —— 链接动作里 `kind === 'external'` 那一档（编辑器/文档链接跳外部）；
  3. `src/components/TerminalPanel.vue:350` `try { await request('shell.openUrl', { url }) }`（终端超链接）；
  4. `src/quickDocHost.ts:246-250` `openExternalDoc()` 里那句
     `try { await request('shell.openUrl', { url }) }`（快速文档的「在浏览器里看」）——
     这个模块**现在是直接打桥**，没有 `openExternal` 这个 dep，所以要么给它加一条 dep（与上面
     `htmlExport` 同款，装配点在 `src/App.vue` 的 `createQuickDocHost(...)` 那一堆参数里），
     要么把这一处也换成 `openExternalUrl(url)`。
- **目标文件 / 行号与可照抄代码**（`src/App.vue`，在 `trustPrompt` 旁边加一份状态 + 一个函数）：

```ts
// 打开外部链接前的那一句（上游 BrowserLauncherAppless.kt:99 的 canBrowse 就在 browse() 里面）。
const linkPrompt = ref<{ url: string; resolve: (choice: ExternalLinkChoice) => void } | null>(null)
function askExternalLink(prompt: { url: string }): Promise<ExternalLinkChoice> {
  return new Promise<ExternalLinkChoice>(resolve => { linkPrompt.value = { url: prompt.url, resolve } })
}
/** 四处 URL 出口都走这一条（不再各自 request('shell.openUrl')）。 */
function openExternalUrl(url: string) {
  void browseWithTrustCheck(url, {
    root: () => workspace.value?.root,
    entries: () => trustEntries(),
    ask: askExternalLink,
    save: entries => { void saveTrustedPaths(entries) },
    open: next => request('shell.openUrl', { url: next }),
  })
}
```
然后 1416 行换成 `openExternal: url => openExternalUrl(url)`（`htmlExport` 那一侧不用动，
它的 dep 形状还是 `(url) => unknown`），1000 行换成 `openExternalUrl(action.url)`；
`src/components/TerminalPanel.vue:350` 与 `src/quickDocHost.ts:246-250` 两条把
`request('shell.openUrl', { url })` 换成同一个 `openExternalUrl(url)`
（前者要往组件再传一个 prop 或在宿主侧接住那个 `open-url` 事件，后者要加一条 dep —— 两个文件都不在本桶名下）。
模板里挂弹框（挨着 2626 行那一份 `<TrustedProjectDialog>`）：

```vue
<TrustedProjectDialog v-if="linkPrompt" mode="link" :root="workspace?.root ?? ''" :name="workspace?.name ?? ''" :url="linkPrompt.url" @resolve-link="choice => { linkPrompt.resolve(choice); linkPrompt = null }" />
```

- **import**：`import { browseWithTrustCheck, type ExternalLinkChoice } from './trustedProjects'`
- **还要多暴露两条**：`trustEntries`（`:92`）与 `saveTrustedPaths`（`:99`）现在只在
  `src/workspaceLifecycle.ts` 内部用，`return` 那一张表在 `:431`
  （`trustPrompt, resolveTrustPrompt, projectTrustBlock,`）—— 加上这两个名字，上面那份
  `openExternalUrl` 才能在 `App.vue` 里拿到它们；不加就变成宿主自己再抄一份清单，正是要避免的。
- **上游依据**：`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`
  （`:69-71` 已信任不问、`:72-80` 三颗按钮 + 默认 Open + 焦点 Trust、`:83` 答 Open 不放信任、
  `:84` 答 Trust 才 `setProjectTrusted(true)`、`:85` 其它不开）、
  调用点 `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:99`、
  文案 `platform/platform-api/resources/messages/IdeBundle.properties:3149-3153`。

## W3 · 信任框「始终信任来自此来源的项目」的落库

- **模块侧已做完**：勾选框在 `src/components/TrustedProjectDialog.vue`（`v-if="trustAllAvailable"`），
  回值签名已是 `resolve: [choice, remember, trustAll]` —— **老宿主的前两个参数照旧编译**
  （`resolveTrustPrompt(choice, remember)` 接三个实参是合法的）。规则
  `trustDecisionPaths` / `applyTrustDecision` / `isProjectLocationOfferedForTrust` 都在
  `src/trustedProjects.ts`，判据 `tests/trusted-trust-all.test.mjs` + `tests/welcome-trust-dialog.test.mjs` 第 1、2、6 条。
- **断的那一环**：宿主没传 `canTrustAll` ⇒ 那一格**现在不渲染**（按规约「没有消费链路就不画」），
  第三参数也没人接。要落库需要两处：
  1. `src/App.vue:2626`（`<TrustedProjectDialog v-if="trustPrompt" … @resolve="resolveTrustPrompt" />`）换成：

```vue
<TrustedProjectDialog v-if="trustPrompt" :root="trustPrompt.root" :name="trustPrompt.name" :can-trust-all="true" :config-dir="appConfigDir" @resolve="resolveTrustPrompt" />
```

  2. `src/workspaceLifecycle.ts` 的四行（`90` / `120` / `127-128` / `133`）：把回值收成三个，
     落库从「只记项目根」换成 `trustDecisionPaths`（勾了就多记**父目录**）：

```ts
let trustResolver: ((choice: TrustChoice, remember: boolean, trustAll: boolean) => void) | null = null
// …
const [choice, remember, trustAll] = await new Promise<[TrustChoice, boolean, boolean]>(resolve => {
  trustResolver = (nextChoice, nextRemember, nextTrustAll) => resolve([nextChoice, nextRemember, nextTrustAll])
  trustPrompt.value = { root, name: result.name || root }
})
// …
if (remember) await saveTrustedPaths(applyTrustDecision(entries, trustDecisionPaths(choice, root, trustAll, appConfigDir())))
else sessionTrust.value = rememberTrust(sessionTrust.value, root, choice === 'trust')
// …
function resolveTrustPrompt(choice: TrustChoice, remember: boolean, trustAll: boolean) { trustResolver?.(choice, remember, trustAll) }
```

  3. `appConfigDir`：宿主已有的那一份就是 `app.info` 返回的 `profile`
     （`native/diagnostics.cpp:152-168` 的「配置与项目」那条 = profile 根，
     `src/helpActions.ts:23` 的 `AppInfo.profile`）。`aboutInfo` 只在打开「关于」时才取，
     所以要在启动那次 `app.state` 之后补一份：`const appConfigDir = ref('')` + `request<AppInfo>('app.info').then(info => { appConfigDir.value = info.profile })`。
     **不给这一格也行**（`configDir` 缺省时 `isProjectLocationOfferedForTrust` 判不出配置目录那一档，
     会把「镜像到配置目录里的项目」也当成可信任的位置 —— 那是上游 `TrustedProjects.kt:98-102` 明令避免的），
     所以要么给对，要么干脆别传 `canTrustAll`。
- **上游依据**：`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`
  （`:66` 的 `projectRoot.parent != null && dialog.isTrustAll`、`:69` 的
  `service<TrustedPathsSettings>().addTrustedPath(projectLocationPath)`）与
  `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:96-107`
  （配置目录里的项目不提供「信任这个位置」）。

## W3b · 会话级信任有**两份**，设置页看到的是没有落库那一半

- **实测到的断链**（本轮复核出来的，不是猜的）：
  `src/workspaceLifecycle.ts:91` 自己留了一个 `sessionTrust = ref<TrustedPathEntry[]>([])`，
  而 `src/trustedProjects.ts` 早就有一份模块级的会话档
  （`rememberSessionTrust` / `sessionTrustEntries` / `replaceSessionTrust`），
  且**已经被设置页在用**：`src/components/TrustedLocationsSettingsPage.vue:27,28,61,71-72`。
  于是：对话框里答「这次信任」→ 写进宿主那份；设置页「受信任位置」并集 → 读的是模块那份 ⇒
  **设置页看不到刚才那一条**，反过来在设置页改会话项也不影响执行侧的门禁
  （门禁 `trustBlockReason` 吃的是宿主那份 `trustEntries()`）。
- **目标文件 / 行号**：`src/workspaceLifecycle.ts:91-92`、`:128`
- **可照抄的替换**：

```ts
// 删掉 const sessionTrust = ref<TrustedPathEntry[]>([])
function trustEntries(): TrustedPathEntry[] {
  return mergeTrustEntries(generalSettings.value?.trustedPaths, sessionTrustEntries())
}
// :128 那一行换成：
else rememberSessionTrust(root, choice === 'trust')
```
  配套 import：`import { mergeTrustEntries, rememberSessionTrust, sessionTrustEntries, … } from './trustedProjects'`。
  换完之后 `TrustedLocationsSettingsPage.vue` 不用动（它已经在读同一份），
  「设置页那条表会多出本次会话那几行」这句 14c 的原话才真的成立。
- **上游依据**：`platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`
  （一张表 = `TrustedPathsSettings` + `TrustedPaths.getExplicitlyTrustedPaths()` 的并集，
  先设置里的、后对话框里的那一份）与 `:80-89`（apply 时按差集各回各家）。

## W4 · `shell.openUrlWithBrowser`：指定浏览器那条宿主通道

- **模块侧已做完**（`src/browsers.ts`）：
  · `browserLaunchPayload(browser, url)` → `{ path, args }`，就是
    `BrowserUtil.getOpenBrowserCommand` 在「路径是个真文件」那一档的形状
    （`platform/platform-api/src/com/intellij/ide/BrowserUtil.java:124-130`：可执行文件、附加参数、最后 URL；
    参数取 `specificSettings.additionalParameters`，`BrowserLauncherAppless.kt:220`；URL 先 trim，`:96`）；
    路径空 ⇒ 返回 `{ error }`，**不**悄悄退回系统默认（`:214-218` 是报错不是回退）；
  · `normalizeBrowserSettings(raw)`：那两个新键的读盘口径（缺键 = `browserList: []` + `defaultBrowserPolicy: 'system'`，
    坏条目逐条丢，绝不按字段数判存档损坏）。
  判据：`tests/welcome-browsers-launch.test.mjs`（6 条）。
- **要接的四层**（本桶都不名下，新建 `.cpp` 也不许自己写进 `CMakeLists.txt`）：
  1. `native/browser_launch.cpp`（新文件）：`open_with_browser(path, args)` ——
     Windows `ShellExecuteW(path.c_str(), nullptr, 拼好的参数, …)`；mac/Linux 一条 `posix_spawn` argv。
     返回 `{ ok, error }`，失败时把 stderr/错误码带回来（上游 `showError` 那一档，`BrowserLauncherImpl.kt:133-149`）。
  2. `native/main.cpp` 分派表加一条 `case "shell.openUrlWithBrowser"_h:`；`CMakeLists.txt` 注册新 cpp。
  3. `src/bridge.ts:109` 的 `Method` union 加 `'shell.openUrlWithBrowser'`。
  4. `native/settings_schema.cpp` 加 `browserList`（数组，元素 `{id?,name,family,path,active}`）与
     `defaultBrowserPolicy`（`system|first|alternative`）两键 + **默认值**，读盘缺键补默认
     （事故先例：新键把旧存档判损坏，用户被关在项目外）。
- **接上之后调用方怎么改**（`src/App.vue` 的 `openExternal`，或 W2 那条 `openExternalUrl` 的 `open:` 依赖）：

```ts
const chosen = selectDefaultBrowser(normalizeBrowserSettings(generalSettings.value).browserList,
                                    generalSettings.value?.defaultBrowserPolicy ?? 'system')
const payload = chosen ? browserLaunchPayload(chosen, url) : null
if (payload && 'path' in payload) await request('shell.openUrlWithBrowser', payload)
else if (payload && 'error' in payload) notify(payload.error, true)   // 上游 :214-218 是报错，不是回退
else await request('shell.openUrl', { url })                          // 策略 = system：交给系统默认
```
- **为什么本批没建浏览器设置页**：这条通道没有 ⇒ 表格选完无处可去 = 假控件。通道一到，
  页面（`BrowserSettingsPanel.kt:83` 的 clone / `:111` isEditable / `:115` isRemovable 三条已在
  `src/browsers.ts` 有等价规则）与注册项（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1306`
  的 `id="reference.settings.ide.settings.web.browsers"`）下一批一起做。

## W5 · 文件选择器的多选：**建议继续不做**（要拍板，不是漏做）

- 现状（实测）：`src/fileChooserDescriptor.ts:48` 的 `chooseMultiple` 与 `:92/:98/:103` 那三个
  多选取舍**没有任何调用方** —— 全仓唯一的选路径入口是 `src/App.vue` 的 `pickDirectory`（单目录）。
  ⇒ 按规约「没有消费链路的 UI 一律不渲染」，行上做 Ctrl/Shift 多选就是假控件，本批仍不做。
- 真要做，两处一起（都在本桶名下，只等第一个多选调用点）：
  1. `src/fileChooserHostState.ts`：`choose()` 的契约从 `Promise<string | null>` 扩一条
     `chooseMany(): Promise<string[] | null>`（`onPick` 改成收数组、复核逐条过 `selectionProblem`）；
  2. `src/components/FileChooserDialog.vue`：`picking` 从 `ref('')` 换成选区（裸点清空 / Shift 段选 /
     Ctrl 单行 toggle —— 现成口径见 `src/welcomeRowSelection.ts` 的 `selectionAfterClick`）。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:452`
  （`getSelectedFiles()` 返回的是数组）与 `:552`（`CommonDataKeys.VIRTUAL_FILE_ARRAY`）。

## W6 · 顺带一条：左栏「收藏」那一栏**上游没有**（订正 14c 的第 1 条）

- 14c 的请求把左栏写成「最近 / 收藏」并给了 `universal/UniversalFileChooser.kt:304` 作依据。
  实测：那一行是 `OnePixelSplitter`（左栏确实是 splitter），但 splitter 左边那张表的内容是
  **Home / Desktop / Project 三个固定位置**（同文件 `:677-697` 的 `createLocationsPanel`），
  不是「最近 + 收藏」；而 `platform/platform-impl/src/com/intellij/openapi/fileChooser/**` 全包搜
  `favorite` **零命中**，`FavoritesList` 这个类在基准树里**不存在**（`find -name "FavoritesList*"` 空，
  收藏视图在 `platform/favoritesTreeView/src/com/intellij/ide/favoritesTreeView/FavoritesManager.java`，
  与文件选择器没有引用关系）。⇒ 「收藏」是本仓早期编出来的一栏，`src/fileChooserModel.ts` 里那两条
  假坐标本轮已订正（代码留着、注释写实）。
- 「最近」那一栏的**真**上游依据是另一条链：选中就记
  （`ex/FileChooserDialogImpl.java:186-191` `storeSelection` → `impl/FileChooserUtil.java:89-108`，
  键与 30 条上限 `:33-34`，读盘 `:74-82`，用在路径下拉 `:258`）—— 本桶已照这一条把
  记表做进选择器宿主自己（`src/fileChooserHostState.ts`），**不需要宿主再给数据**。
- 要主代理拍的：`favorites` 这一栏是 (a) 删掉（本桶可以下轮做，组件在自己名下），
  还是 (b) 换成上游那三个固定位置（Home/Desktop 在工作区之外，本仓的 `workspace.list` 列不出来，
  点了只能转交宿主原生对话框 —— 语义会变味），还是 (c) 保留空栏（现在就是这样，`v-if` 保证一行都不画）。
  本桶按 (c) 收尾，没有新增假控件。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1b（结构视图光标补列）已接线**：`src/App.vue:225` 的 `todoSource` 已带 `character: active.value.column`。
- **W2（外部链接判定）已接线**：URL 出口收成 `src/externalLinkLauncher.ts` 的 `openExternalUrl`（见 bucket14c 处理结果）。

结论：W1b/W2 已接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W1b/W2 已接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
