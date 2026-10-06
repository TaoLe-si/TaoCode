# 接线请求 · 2026-10-06 · welcome2（宿主 / 桥那一侧，行号本轮实测）

> 桶 welcome2 逐条**复核**了 `docs/wiring-requests-2026-10-06-bucket14c.md` 的 5 条与
> `docs/wiring-requests-2026-10-06-welcome.md` 的 6 条：模块侧（本桶名下）能做的都做完了，
> 剩下的全部落在**保留文件**或别人名下。行号是 2026-10-06 welcome2 轮在全量在途工作区里
> 亲手重新数的（`src/App.vue` 又被并行改过：14c 写 1458/2414、welcome.md 写 1416/2626，
> **现在**分别是 1421/2364 与 1414/2622 ⇒ 落之前按引文重定位，别按记忆行号）。
>
> 每条末尾标了「落地时要反转的判据」——那些是本桶故意钉成「未接线」形状的门禁，
> 不反转就会红，不是实现坏了。

## R0 · 已落，登记核对结果（不需要动）

- 14c 第 1 条「选择器最近」两半都已在盘上：`src/App.vue:1421-1424` 的
  `createFileChooserHost({ … recent: () => filenameRecentRows.value.map(row => row.path), favorites: () => [] })`
  与 `src/App.vue:2364` 的 `<FileChooserDialog … :recent="chooser.recent()" :favorites="chooser.favorites()" … />`；
  选择器宿主还按上游 `storeSelection`（`platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:186-191`）
  自己记一档并落 localStorage（`src/fileChooserHostState.ts:28-88`，键与 30 条上限 = `impl/FileChooserUtil.java:33-34`）。
  本轮复核判据 `tests/file-chooser-model.test.mjs` / `tests/file-chooser-tree.test.mjs` 全绿，未改动。

## R1 · 给结构视图跟随的光标补「列」（App.vue 一行）

- **现状（本轮端到端复核）**：14b 报的「假控件」已不成立——W1 的 `:source="ctx.todoSource"` 已落在
  `src/components/ToolWindowView.vue:170`，`src/toolViewContext.ts:116` 透传 `todoSource: todoSource.value`
  （外层 ctx 是 computed ⇒ 光标动就重算），`OutlinePanel.vue:74-86` 的 watch 吃 `path/line`，
  行号按 1 基→0 基换算（`props.source.line - 1`）。**整条链按「行」粒度真的生效**。
  断的只剩两截：① 宿主那份没有列（下面这一行）；② 同行多符号时的选中次序——②本桶已修
  （`src/outlineView.ts` 的 `pickCaretCandidate`：按光标列锚定最近起点，判据
  `tests/outline-caret-source.test.mjs`「同一行两个符号时选光标包住的那一个」）。
- **目标文件 / 行号**：`src/App.vue:215`
- **可照抄的整段替换**（`Tab.column` 早就在维护：`src/editorTab.ts:8`，光标事件在
  `src/App.vue:2123` 的 `@cursor="(line, column) => { tab.line = line; tab.column = column }"` 写它）：

```ts
const todoSource = computed(() => active.value ? { path: active.value.path, line: active.value.line, character: active.value.column } : null)
```

- **为什么不用动别家**：`TodoPanel.vue` 的 prop 是 `{ path, line }`，多一个字段类型与行为都不变；
  `OutlinePanel.vue:16` 的 `source.character?: number` 与换算函数
  `caretCharacterInSymbolBasis`（`src/structureFollow.ts:88-90`，1 基列→0 基列）都在等这一格数据。
- **落地时要反转的判据**：`tests/outline-caret-source.test.mjs:89-93` 已按**前缀**匹配钉
  `{ path, line`，加了 `character` 不会变红，无需动测试。
- **上游依据**：`platform/structure-view-impl/src/com/intellij/ide/structureView/newStructureView/StructureViewComponent.java:655-661`
  （`scrollToSelectedElement` 先判 `AUTOSCROLL_FROM_SOURCE`）、`:829-835`（光标监听 + 开关打开时
  **立即**选一次，不等第一次光标移动）——上游拿的是**偏移量**（行 + 列），不是只有行。

## R2 · 打开外部链接前的那一句（四个 URL 出口共用一条判定）

- **模块侧已做完并有判据**：`src/trustedProjects.ts` 的 `browseWithTrustCheck(url, deps)`（上游
  `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112` 的 `browse()`：
  `:96` 先 trim、`:99` 才 `canBrowse`、过了才真的开）与判定链
  `externalLinkPrompt/externalLinkOutcome`（上游 `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`：
  已信任不问 `:69-71`、三按钮 `:72-80`、默认 Open `:79`、焦点 Trust `:80`、答 Open 不放信任 `:83`、
  答 Trust 才 `setProjectTrusted(true)` `:84`、其它不开 `:85`；文案 `IdeBundle.properties:3149`/`:3151`/`:3152`/`:3153`）。
  弹框 = `src/components/TrustedProjectDialog.vue` 的 `mode="link"` 那一档（已就绪）。
- **断的**：本仓四处 URL 出口全都直接打 `shell.openUrl`，一句都没问：
  1. `src/App.vue:998`（`openDocumentLink` 的 `kind === 'external'` 分支，编辑器/文档链接）；
  2. `src/App.vue:1414`（`createHtmlExport` 的 `openExternal` dep → `src/htmlExport.ts` 的 `openInBrowser` 那一路）；
  3. `src/components/TerminalPanel.vue:350`（终端 Ctrl+单击超链接，不在本桶名下）；
  4. `src/quickDocHost.ts:250`（快速文档「在浏览器里看」，不在本桶名下）。
- **目标文件 / 行号与可照抄代码**（`src/App.vue`，在 `trustPrompt` 旁加一份状态 + 一个函数）：

```ts
// 打开外部链接前的那一句（上游 BrowserLauncherAppless.kt:99 的 canBrowse 就长在 browse() 里面）。
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

  模板里挂第二份弹框（挨着 `src/App.vue:2622` 那一份 `<TrustedProjectDialog>`）：

```vue
<TrustedProjectDialog v-if="linkPrompt" mode="link" :root="workspace?.root ?? ''" :name="workspace?.name ?? ''" :url="linkPrompt.url" @resolve-link="choice => { linkPrompt.resolve(choice); linkPrompt = null }" />
```

- **import**：`import { browseWithTrustCheck, type ExternalLinkChoice } from './trustedProjects'`
- **前置**：`trustEntries`（`src/workspaceLifecycle.ts:92-94`）与 `saveTrustedPaths`（`:99-108`）现在只在
  宿主内部用 ⇒ 在 `src/workspaceLifecycle.ts:431` 的 return 表里加上这两个名字（与 R3/R4 同文件同批做）。
- 3、4 两处（`TerminalPanel.vue:350`、`quickDocHost.ts:246-250`）把 `request('shell.openUrl', { url })`
  换成同一个 `openExternalUrl(url)`：前者要接住 `open-url` 事件的宿主侧（或加一条 prop），
  后者要加一条 `openExternal` dep（装配点在 `src/App.vue` 的 `createQuickDocHost(...)` 参数里）。
  **这两个文件都不在本桶名下**（terminal / docs 桶在途），落地时找对应 lane 或主代 一次改齐。
- **落地时要反转的判据**：`tests/welcome-trust-dialog.test.mjs` 最后一条
  「宿主那两行还没接」钉着 `!host.includes('resolveLink')`——W2 落地后把它改成
  「`resolveLink` 已挂 + `openDocumentLink` 走 `openExternalUrl`」的正向钉。
- **上游依据**：坐标见上；文件级那一支（`BrowserLauncherImpl.kt:88-108`，按钮 `:3154`
  `Trust File and Open`）本仓存储只有目录级，做不到，如实登记（`src/trustedProjects.ts:117-121`）。

## R3 · 信任框「始终信任此来源」的落库（canTrustAll + 三参回值）

- **模块侧已做完并有判据**：勾选框在 `src/components/TrustedProjectDialog.vue`
  （`v-if="trustAllAvailable"`，可用性 = 宿主给 `canTrustAll` **且** `isProjectLocationOfferedForTrust`，
  上游 `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71` +
  `platform/platform-impl/src/com/intellij/ide/trustedProjects/impl/TrustedProjectsStartupDialog.kt:86-95`）；
  回值签名 `[choice, remember, trustAll]` —— 老宿主的 `resolveTrustPrompt(choice, remember)` 接三个实参合法，
  **不改也不会编译失败**，这正是它一直没落的原因（没人报错）。文案本轮已订正为上游原文直译
  （`untrusted.project.warning.trust.location.checkbox`，`IdeBundle.properties:2949`，带父目录文件夹名、
  40 字符截断按 `impl/TrustedProjectsStartupDialog.kt:89` 的口径；早先版本写的是转述文案，已留痕订正）。
- **目标文件 / 行号**：
  1. `src/App.vue:2622` 那一行换成：

```vue
<TrustedProjectDialog v-if="trustPrompt" :root="trustPrompt.root" :name="trustPrompt.name" :can-trust-all="true" :config-dir="appConfigDir" @resolve="resolveTrustPrompt" />
```

  2. `src/workspaceLifecycle.ts` 的四段（`:90`、`:120-123`、`:127-128`、`:133`）：回值收成三个、
     落库换成 `trustDecisionPaths`（勾了就多记**父目录**；不勾只记项目根；安全模式记 false 且不吃
     trust-all；取消什么都不记——`TrustedProjectsDialog.kt:64-73`/`:95` 的逐行等价物）：

```ts
let trustResolver: ((choice: TrustChoice, remember: boolean, trustAll: boolean) => void) | null = null
// …（:120-123 那段 Promise）
const [choice, remember, trustAll] = await new Promise<[TrustChoice, boolean, boolean]>(resolve => {
  trustResolver = (nextChoice, nextRemember, nextTrustAll) => resolve([nextChoice, nextRemember, nextTrustAll])
  trustPrompt.value = { root, name: result.name || root }
})
// …（:127-128 那两行）
if (remember) await saveTrustedPaths(applyTrustDecision(entries, trustDecisionPaths(choice, root, trustAll, appConfigDir())))
else rememberSessionTrust(root, choice === 'trust')
// …（:133）
function resolveTrustPrompt(choice: TrustChoice, remember: boolean, trustAll: boolean) { trustResolver?.(choice, remember, trustAll) }
```

  配套 import（`src/workspaceLifecycle.ts:22-23` 那份加名字）：
  `applyTrustDecision, rememberSessionTrust, sessionTrustEntries, trustDecisionPaths`。
  `trustDecisionPaths`/`applyTrustDecision`/`rememberSessionTrust` 都在 `src/trustedProjects.ts`，
  判据 `tests/trusted-trust-all.test.mjs` + `tests/welcome-trust-dialog.test.mjs`。
  **不给 `config-dir` 就别给 `can-trust-all`**：配置目录里的项目不给这一项是上游明令
  （`TrustedProjects.kt:96-106`，理由：镜像项目共用父目录，信任它会连带信任全部并把 IDE 内部路径
  塞进用户清单）。宿主已有的那一份 = `app.info` 的 `profile`（`native/diagnostics.cpp` 的
  「配置与项目」那条；类型 `AppInfo.profile` 见 `src/helpActions.ts`）——
  在启动那次 `app.state` 之后补：`const appConfigDir = ref('')` + `request<AppInfo>('app.info').then(info => { appConfigDir.value = info.profile })`。
- **落地时要反转的判据**：同 R2 那条（`tests/welcome-trust-dialog.test.mjs` 最后一条还钉着
  `!mount.includes('canTrustAll')`）。

## R4 · 会话级信任有**两份**，把宿主那份并进模块那份（W3b 的行号复核）

- **实测复核（本轮再数了一遍，断链属实）**：`src/workspaceLifecycle.ts:91` 自留
  `sessionTrust = ref<TrustedPathEntry[]>([])`、`:128` 只往它写；而设置页
  `src/components/TrustedLocationsSettingsPage.vue:27-28` 读/写的是 `src/trustedProjects.ts:316-336`
  的模块级会话档 ⇒ 对话框答「这次信任」**在设置页看不见**，反过来设置页改会话项也**不影响**
  执行侧门禁（门禁吃 `trustEntries()` = `:92-94` 的宿主并集）。
- **目标文件 / 行号**：`src/workspaceLifecycle.ts:91-94`、`:128`：

```ts
// 删掉 const sessionTrust = ref<TrustedPathEntry[]>([])
function trustEntries(): TrustedPathEntry[] {
  return mergeTrustEntries(generalSettings.value?.trustedPaths, sessionTrustEntries())
}
// :128 那一行换成（随 R3 一起落）：
else rememberSessionTrust(root, choice === 'trust')
```

  换完 `TrustedLocationsSettingsPage.vue` 一个字不用动（它已经在读同一份），
  「设置页那张表会多出本次会话那几行」这句 14c 的原话才真的成立
  （上游一张表 = 两个存储并集：`platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`，
  应用按差集各回各家：`:80-89`）。

## R5 · `shell.openUrlWithBrowser`：指定浏览器那条宿主通道（14c 第 4 条）

- **模块侧已做完并有判据**（`src/browsers.ts:342-417` + `tests/welcome-browsers-launch.test.mjs` 6 条）：
  `browserLaunchPayload(browser, url)` → `{ path, args }` =
  `platform/platform-api/src/com/intellij/ide/BrowserUtil.java:92-133` 的 `getOpenBrowserCommand`
  在「路径是个真文件」那一档的形状（`:124-130`：可执行文件、附加参数、最后 URL；参数取
  `specificSettings.additionalParameters` = `BrowserLauncherAppless.kt:220`；URL 先 trim `:96`；
  路径空 ⇒ 返回 error，**不**退回系统默认 —— `:211-218` 那一档是 `showError` 不是回退）；
  `normalizeBrowserSettings(raw)` = 新键读盘口径（缺键 = `browserList: []` + `defaultBrowserPolicy: 'system'`，
  坏条目逐条丢，**绝不按字段数判存档损坏**——事故先例在案）。
- **要接的四层（本桶都不名下；新建 `.cpp` 不许自己写进 CMakeLists，按规定交请求）**：
  1. `native/browser_launch.cpp`（新文件）：`open_with_browser(path, args)` —— Windows
     `ShellExecuteW(path.c_str(), nullptr, 拼好的参数, …)`，mac/Linux 一条 `posix_spawn` argv；
     返回 `{ ok, error }`（失败把错误码带回来，上游 `BrowserLauncherImpl.kt:133-149` 的 `showError` 档）。
  2. 分派：现在 `shell.openUrl` 的分派点在 `native/file_queries.cpp:236-237`（`== "shell.openUrl"` →
     `open_external`，`native/workspace.cpp:1223`）——同处加一条 `== "shell.openUrlWithBrowser"` 分支；
     `CMakeLists.txt` 注册新 cpp（主代独占）。
  3. `src/bridge.ts:109` 的 `Method` union 加 `'shell.openUrlWithBrowser'`。
  4. `native/settings_schema.cpp` 的 general 键表（`trustedPaths` 登记在 `:182-183`/`:216-224`，照它的形状）
     加 `browserList`（数组，元素 `{id?,name,family,path,active}`）与 `defaultBrowserPolicy`
     （`system|first|alternative`）两键 + 默认值；旧存档缺键补默认。
- **通道一到，调用方这样改**（`src/App.vue` 的 `openExternalUrl` 的 `open:` dep，R2 那份）：

```ts
const chosen = selectDefaultBrowser(normalizeBrowserSettings(generalSettings.value).browserList,
                                    generalSettings.value?.defaultBrowserPolicy ?? 'system')
const payload = chosen ? browserLaunchPayload(chosen, url) : null
if (payload && 'path' in payload) await request('shell.openUrlWithBrowser', payload)
else if (payload && 'error' in payload) notify(payload.error, true)   // BrowserLauncherAppless.kt:215-217 是报错，不是回退
else await request('shell.openUrl', { url })                          // 策略 = system：交给系统默认
```

  上游口径：`getDefaultBrowser()` 只在 `DefaultBrowserPolicy.FIRST` 时给 `firstActiveBrowser`
  （`BrowserLauncherImpl.kt:54-57` + `DefaultBrowserPolicy.java:18-19`）。
- **浏览器设置页为什么还没建**：这条通道没有 ⇒ 表格选完无处可去 = 假控件。规则都在
  （`src/browsers.ts` 的表格增删改 + clone/isEditable/isRemovable 等价物 =
  `BrowserSettingsPanel.kt:83`/`:111`/`:115`）；通道一到，页面与注册项
  （`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1306`
  `id="reference.settings.ide.settings.web.browsers"`）下一批一起做。

## R6 · 左栏「收藏」那一栏：上游**没有**（要主代拍板，14c 第 1 条的另一半）

- **本轮复核**（不照抄 welcome.md，基准树里重新走过）：`platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/UniversalFileChooser.kt:304-305`
  的左栏 splitter 里那张表是 `createLocationsPanel`（同文件 `:677-697`）= **Home / Desktop / Project 三个固定位置**；
  `platform/platform-impl/src/com/intellij/openapi/fileChooser/` **全包** grep `favorite` **零命中**。
  14c 请求 1 里「把收藏栏接到真数据上」这句的**上游依据不成立**（收藏视图在别处、与选择器无引用关系）。
- 现状 = 空数据源 + `v-if` 永不渲染（宿主传 `favorites: () => []`，`src/App.vue:1424`），**不是假控件**，
  但那是本仓早先编出来的一栏。要主代拍：(a) 整栏删掉（本桶组件/模型/宿主状态三个文件都在名下，
  只差 `src/App.vue:2364` 的 `:favorites=` 绑定与 `:1424` 那一条 dep，一次请求就能清干净）；
  (b) 换成上游那三个固定位置（Home/Desktop 在工作区外，`workspace.list` 列不出来，点了只能转交原生对话框，语义变味）；
  (c) 保持现状。welcome2 建议 (a)，并连带删 `src/fileChooserModel.ts` 的 `favoriteShortcuts`
  （其注释已如实登记「上游无此类」）。**未拍板前本桶不动**，免得白删。

## R7 · 多选：维持「不做」，触发条件写死（14c 第 5 条复核）

- 本轮 grep 复核：全仓 `chooseMultiple === true` 的描述件**没有任何生产调用点**
  （`multiFilesDescriptor` 只在 `src/fileChooserDescriptor.ts` 与钉它形状的
  `tests/file-chooser-descriptor.test.mjs` 里出现；生产侧调用 = `pickDirectory`（`src/App.vue:1417`）、
  插件包/目录（`src/projectExtras.ts`）、JDK/输出目录（`src/settingsPersistence.ts`），全是单选）。
  按规约「没有消费链路就不渲染」，行上做 Ctrl/Shift 多选 = 假控件 ⇒ **`[-]` 不做，理由如上**。
- 第一个多选调用点落地时两处一起做（都在本桶名下，方案在盘上）：
  `src/fileChooserHostState.ts` 加 `chooseMany(): Promise<string[] | null>`（`onPick` 收数组、逐条过
  `selectionProblem`）；`src/components/FileChooserDialog.vue` 的 `picking` 换成选区
  （裸点清空 / Shift 段选 / Ctrl toggle，现成口径 `src/welcomeRowSelection.ts` 的 `selectionAfterClick`）。
  上游：`FileChooserDialogImpl.java:452`（`getSelectedFiles()` 返回数组）、`:552`（`VIRTUAL_FILE_ARRAY`）。
