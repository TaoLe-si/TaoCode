# 接线请求 · 2026-10-06 · welcome3（R2 的宿主那四条行 / R5 那条通道的五处登记）

> 范围：本轮（桶 welcome3）把 `docs/wiring-requests-2026-10-06-welcome2.md` 的 **R2 / R3 / R5**
> 推到「主代理只剩粘贴」的形状，并把其中**不在保留文件里**的部分全部落掉：
> `src/workspaceLifecycle.ts`（T1 + R3 落库 + 门禁安装 + 配置目录）、
> `src/externalLinkLauncher.ts`（新：一条 URL 出口）、
> `src/components/TerminalPanel.vue`、`src/components/RunConsole.vue`、`src/quickDocHost.ts`（三个调用点改走那一条出口）。
> 上游坐标本轮全部**亲手打开**过（基准树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`），
> 逐条列在下面 §留痕 与 §W5。
>
> 行号是 2026-10-06 welcome3 轮在**全量在途工作区**里重新数的（`src/App.vue` 又被并行改过一轮：
> welcome2 写 998/1414/2622，**现在**是 1011/1436/2646 ⇒ 落之前按引文重定位）。
> 每条末尾标「落地时要反转的判据」——那些是本桶故意钉成未接线形状的门禁，不反转就会红。

## 留痕（原写 X、实际 Y）

1. **「四个 URL 出口」实际是五个**：welcome2 R2 列的是 `src/App.vue` 两处 + `TerminalPanel.vue` +
   `quickDocHost.ts`。本轮 grep `request\('shell\.openUrl'` 实测还多一处
   `src/components/RunConsole.vue`（运行控制台里 URL 命中的落点，welcome2 之后由 console-hyperlinks 那一批落地的）。
   本轮**五处里的三处**（TerminalPanel / RunConsole / quickDocHost）已改成走那一条出口，剩下两处就在保留文件里（§W1）。
2. **R3 的「宿主补 appConfigDir」不需要宿主做了**：welcome2 R3 写着
   「在启动那次 `app.state` 之后补 `const appConfigDir = ref('')` + `request<AppInfo>('app.info').then(...)`」——
   那两行不在保留文件里就能做完 ⇒ 本轮已落进 `src/workspaceLifecycle.ts`（`bootstrap()` 里读 `app.info` 的
   `profile`，`:138` 的 `trustConfigDir`；宿主只从 return 表拿 `trustConfigDir`/`trustCanTrustAll`）。
3. **R5 的新键要登记的不是四处，是五处**：welcome2 R5 第 4 条只写了
   `native/settings_schema.cpp` 的 general 键表。本轮实测一条新 general 键要同时出现在
   ① `native/settings_schema.hpp` 的 `GENERAL_SETTING_KEYS`（`"trustedPaths"` 在 `:142`，未知键会被
   `native/settings_schema.cpp:187` 的 `known_keys(patch, GENERAL_SETTING_KEYS, …)` 剪掉）、
   ② `native/settings_schema.cpp:183` 的默认值表、③ 同文件 `:216-232` 的校验分支、
   ④ `src/settingsModel.ts:171`（类型）+ `:221`（默认值）——保留文件、
   ⑤ `src/bridgePreview.ts:271` 的预览白名单 + `:276-297` 那一族的校验分支。
   少① ⇒ 保存时被剪；少② ⇒ 旧存档读不出默认；少④ ⇒ `generalSettings.value.browserList` 根本没有那个字段；
   少⑤ ⇒ 预览与桌面的保存成败不一样。
4. **`IdeBundle.properties` 的实际路径**：welcome2/trust4 只写了文件名与行号。本轮实测在
   `platform/platform-api/resources/messages/IdeBundle.properties`（**不是** platform-impl）：
   `:3149 external.link.confirmation.title=Open Link`、`:3151 …message.0=Are you sure you want to open the link
   in a browser or in an associated application?<br><br>{0}`、`:3152 …yes.label=Open`、
   `:3153 …trust.label=Trust Project and Open`、`:3154 …trust.file.label=Trust File and Open`、
   `:2949 untrusted.project.warning.trust.location.checkbox=<html>Trust all projects in <b>''{0}''</b> folder`
   ——与 `src/trustedProjects.ts:124-132` / `:222` 钉的文案一致，未改动。

## W1 · `src/App.vue` 只剩四条粘贴行（R2 的宿主那一半 + R3 的模板那一行）

**前置状态（本轮实测）**：`src/workspaceLifecycle.ts:510-511` 的 return 表已经把
`trustEntries, saveTrustedPaths`（trust4 的 T1）与新落地的 `trustConfigDir, trustCanTrustAll,
linkPrompt, resolveLinkPrompt, openExternalUrl` 一起露出来了 ⇒ 宿主**不用加 import**
（`openExternalUrl` 由这一域转出去，因为门禁就装在这一域）。

1. **`src/App.vue:1904`** 那一行（`trustPrompt, resolveTrustPrompt, projectTrustBlock,`）换成：

```ts
  trustPrompt, resolveTrustPrompt, projectTrustBlock, trustEntries, saveTrustedPaths,
  trustConfigDir, trustCanTrustAll, linkPrompt, resolveLinkPrompt, openExternalUrl,
```

2. **`src/App.vue:1011`**（`openDocumentLink` 的 `kind === 'external'` 分支）：

```ts
    try { await openExternalUrl(action.url) }
```

3. **`src/App.vue:1436`**（`createHtmlExport` 的 `openExternal` dep，另一头是 `src/htmlExport.ts:354`
   的 `deps.openExternal(fileUrl(entry))` = 「导出 HTML 后在浏览器里看」）：

```ts
    openExternal: url => { void openExternalUrl(url) },
```

4. **`src/App.vue:2646`** 那一行加两个 prop，并在它**下面**加一行 link 那一档：

```vue
    <TrustedProjectDialog v-if="trustPrompt" :root="trustPrompt.root" :name="trustPrompt.name" :can-trust-all="trustCanTrustAll" :config-dir="trustConfigDir" @resolve="resolveTrustPrompt" />
    <TrustedProjectDialog v-if="linkPrompt" mode="link" :root="linkPrompt.root" :name="linkPrompt.name" :url="linkPrompt.url" @resolve-link="resolveLinkPrompt" />
```

   第二个 `v-if` 用 `linkPrompt`（模块里已经带了回答时要用根与名字，见
   `src/workspaceLifecycle.ts:170-186`），所以不依赖渲染时的 `workspace` 状态。
   `resolveLinkPrompt` 自己把 `linkPrompt` 清掉再放行 Promise（与 `answerLeave` 同一形状），
   已经挂着问句时**不叠第二扇模态**：后点的那条直接按「取消」答（上游是模态框，
   `BrowserLauncherImpl.kt:75-81` 的 `MessageDialogBuilder…show(project)`；判据
   `tests/welcome-external-link-launch.test.mjs` 的「已经挂着一句时不叠第二扇模态」）。

**⚠ 这一条不落也不会把链接打死（本轮补的机制，必读）**：门禁是装配时装的，而 `mode="link"`
那颗框要等宿主挂进模板 ⇒ 中间那段状态里问句没法弹。为了不出现「点了没反应」（比接线前更糟），
`src/components/TrustedProjectDialog.vue:53-54` 在 `onMounted`/`onBeforeUnmount` 里把
「这颗框此刻在不在屏幕上」报给 `src/externalLinkLauncher.ts:44-58` 的 `markLinkDialogMounted`，
`askExternalLink`（`src/workspaceLifecycle.ts:181-196`）等一拍 `nextTick` 后看那个信号：
**没挂 ⇒ 收掉状态、按「打开」放行并 `notify` 一句「这一句还没挂进界面」**（可见、不静默、不卡死）。
⇒ 宿主落了第 4 条之后：信号为真 ⇒ 真的弹框、真的按用户答案决定开不开；
判据是 `tests/welcome-external-link-launch.test.mjs` 的「宿主还没挂 mode="link" 那颗框时不卡住」
（它同时钉住「没挂 ⇒ 放行 + 有提示」，落地后**这条仍应绿** —— 它测的是那条分支本身，不是未接线形状）。
唯一要按未接线形状反转的是第 7 条里 `App.vue` 的直连计数（2 ⇒ 0）与
`tests/welcome-trust-dialog.test.mjs:113-114` 那两条（见下面）。

**落地时要反转的判据**（三条，都在 `tests/`）：
- `tests/welcome-external-link-launch.test.mjs` 的「五条 URL 出口收成一个调用」最后那条
  `assert.equal((host.match(/request\('shell\.openUrl'/g) ?? []).length, 2, …)` ⇒ 换成 `0`；
- `tests/welcome-trust-dialog.test.mjs:113` `assert.ok(!mount.includes('canTrustAll'))` ⇒
  ⚠ 这条钉**现在就已经是假的**：宿主按上面写的是 kebab-case 属性 `:can-trust-all` +
  `trustCanTrustAll`，字符串里没有小写开头的 `canTrustAll`，所以它落了也不会红（假绿）。
  换成正向钉 `assert.ok(mount.includes('can-trust-all'))`；
- 同文件 `:114` `assert.ok(!host.includes('resolveLink'))` ⇒ 换成
  `assert.ok(host.includes('@resolve-link="resolveLinkPrompt"'))`。

**上游依据**：`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`
（`:96` trim → `:99` `canBrowse` → 过了才 `browse`）、
`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`
（`:60-62` `project == null` 放行、`:69-71` 已信任不问、`:72-81` 三按钮 + 默认 Open（`:79`）+ 焦点 Trust（`:80`）、
`:83` 答 Open 不写信任、`:84` 答 Trust 才 `setProjectTrusted(project, true)`、`:85` 其它不开）、
`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-73`
（`:66` `if (projectRoot.parent != null && dialog.isTrustAll)` → `:69` 把**父目录**写进
`TrustedPathsSettings.addTrustedPath`；`:72-73` 安全模式记 false；取消两路都不进）、
`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:103-107`
（`isProjectLocationOfferedForTrust`：父目录为空或 `startsWith(PathManager.getOriginalConfigDir())` 就不提供，
理由原文在 `:95-102`）。

## W2 · R5：`shell.openUrlWithBrowser` 那条通道的五处（本轮核过：两侧都**没有**，所以不是假通道）

实测成对性（本轮 §5 的机械门禁已经把它钉住，落在 `tests/welcome-external-link-launch.test.mjs`
最后一条，注入半边就会红）：

- `src/bridge.ts:109` 的 `Method` union：有 `'shell.openUrl'`、**没有** `'shell.openUrlWithBrowser'`；
- native 分派：`native/file_queries.cpp:234-239` 只有
  `if (method == "shell.openUrl") { result = open_external(text("url")); return true; }`，
  没有第二条；实现体 `open_external` 在 `native/workspace.cpp:1223`（声明 `native/workspace.hpp:99`）；
- `browserList` / `defaultBrowserPolicy` 两个键：native 键表（`native/settings_schema.hpp:142`、
  `native/settings_schema.cpp:183`、`:216-232`）、`src/settingsModel.ts`、`src/bridgePreview.ts:271` 三侧**都还没有**
  ⇒ 现在只有 `src/browsers.ts:396-417` 的读盘归一（`normalizeBrowserSettings`）与
  `src/browsers.ts:376-386` 的 `browserLaunchPayload` 两份纯规则在盘上（判据 `tests/welcome-browsers-launch.test.mjs`），
  没有半条通道被假装接好。

**要主代/宿主按这个顺序落（缺一处就是半条通道）**：

1. `native/browser_launch.cpp`（**新文件**，规约不许自己写进 `CMakeLists.txt` ⇒ 这条也交请求）：
   `Json open_with_browser(const std::string& path, const std::vector<std::string>& args)`，
   Windows 走 `ShellExecuteW(nullptr, L"open", utf8_wide(path).c_str(), 拼好的参数, …)`，
   macOS/Linux 一条 `posix_spawn` argv；返回 `{ok: true}` 或 `{ok: false, code, message}`。
   存在性与协议校验沿用 `open_external` 那一条边界（`native/workspace.cpp:1223-1226` 的
   `valid_utf8` + `native/workspace.hpp:96-99` 的 scheme 白名单；被拒的裸路径/盘符形状见
   `native/workspace_test.cpp:584-594`）；失败要能把错误码带回前端（上游
   `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:211-218` 那一档是
   `showError`，**不是**退回系统默认）。
2. 分派：`native/file_queries.cpp:236-239` 那一条之后加
   `if (method == "shell.openUrlWithBrowser") { result = open_with_browser(text("path"), string_array(params["args"])); return true; }`。
3. `CMakeLists.txt`：把新 cpp 加进源文件列表（主代独占）。
4. `src/bridge.ts:109`：union 加 `'shell.openUrlWithBrowser'`。
5. 那两个键按 §留痕 3 的**五处**一起登记，旧存档缺键补默认
   （`browserList: []` + `defaultBrowserPolicy: "system"`；上游 `DefaultBrowserPolicy.java:18-19` 的
   `SYSTEM` 是默认档，`FIRST` 是显式选项）。

**通道一到，调用方这样改**（宿主只改 `src/workspaceLifecycle.ts` 的 `entries/save` 那一段旁边——
本轮已经把 `open` 留成门禁的可省字段，见 `src/externalLinkLauncher.ts:44-46` 与 `:70-76`）：

```ts
installExternalLinkGate({
  root: () => workspace.value?.root,
  entries: () => trustEntries(),
  ask: askExternalLink,
  save: entries => { void saveTrustedPaths(entries) },
  open: next => {
    const settings = normalizeBrowserSettings(generalSettings.value)
    const chosen = selectDefaultBrowser(settings.browserList, settings.defaultBrowserPolicy)
    const payload = chosen ? browserLaunchPayload(chosen, next) : null
    if (payload && 'path' in payload) return request('shell.openUrlWithBrowser', payload)
    if (payload && 'error' in payload) return notify(payload.error, true)   // BrowserLauncherAppless.kt:211-218 是报错，不是回退
    return request('shell.openUrl', { url: next })                          // 策略 = system：交给系统默认
  },
})
```

上游口径：`getDefaultBrowser()` 只在 `DefaultBrowserPolicy.FIRST` 时给 `firstActiveBrowser`
（`platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:54-57`）。
**装了这个 `open` 之后不需要再动 `src/externalLinkLauncher.ts`**：它优先用 `open ?? gate.open ?? shell.openUrl`
（那条优先级本身有判据，见 `tests/welcome-external-link-launch.test.mjs` 的前四条）。

## W3 · 浏览器设置页（W2 到位之后同批做）

通道没有 ⇒ 表格选完无处可去 = 假控件，所以这一页一直没建（规约 §3）。
规则都在 `src/browsers.ts`：`predefinedBrowsers`（`:323-340`，上游 `WebBrowserSettings.getDefaultBrowserList`）、
表格的增删改 + clone/isEditable/isRemovable 等价物（上游
`platform/platform-impl/src/com/intellij/ide/browsers/BrowserSettingsPanel.kt:83`/`:111`/`:115`）、
`normalizeBrowserSettings`（`:396-417`，旧存档缺键口径）。
注册项照上游 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1306`
的 `id="reference.settings.ide.settings.web.browsers"`；`src/settingsTreeMeta.ts` 与 `src/App.vue` 是保留文件 ⇒
建页时一并走请求。

## W4 · 还欠的两处「只读持久清单」（与 trust4 的 T2 同族，本轮实测新增一处）

会话档并成一份（R4）之后，读点应当只剩 `trustEntries()` 那一条口径。本轮 grep 实测**还剩两处只读持久那一份**：

1. `src/semanticActions.ts:187`（trust4 的 T2，格式化门禁）——本轮没动（formatting 域在途）。
2. **本轮新数出来的一处**：`src/App.vue:1474` 的
   `projectContext: () => workspace.value ? { … trusted: isProjectTrusted(workspace.value.root, generalSettings.value.trustedPaths) } : null`
   ——`generalSettings.value.trustedPaths` 是持久那一份，看不见会话档 ⇒ 答「这次信任」之后
   项目上下文里仍显示「未信任」。这一行在保留文件里，换成
   `trusted: isProjectTrusted(workspace.value.root, trustEntries())` 即可（`trustEntries` 已由 W1 第 1 条露出去）。
   上游判据只有一个 `TrustedProjects.isProjectTrusted(project)`
   （`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjects.kt:56-73`），
   读的是两个存储合并后的状态，不存在某一处只读持久清单的分叉。

## W5 · 上游 `browse()` 里本轮**没搬**的三道前置检查（要主代拍板，不是漏做）

`BrowserLauncherAppless.kt:88-112` 在 `canBrowse` 之前/之后还有三档，本仓一条都没搬：

- `:91-94` `url.startsWith("jar:")` ⇒ `LOG.info` 后**直接 return**（不打开）；
- `:101-105` `VfsUtil.toUri` 解不出来 ⇒ `showError(error.malformed.url)`；
- `:106-109` `file:` 且带 host（UNC）⇒ `showError(error.unc.not.supported)`。

没搬的理由（如实）：这三档改变的是**开不开得成**而不是**问不问**，动它们会把现在能打开的链接
（例如 `file:` 指向工作区内文件的那一类，`src/documentLinks.ts` 的 `classifyLinkTarget` 已经把它们分给
IDE 自己打开）变成打不开或报错文案变化 = **行为变更**，不在 R2「共用一条判定」的范围里；
本仓现在唯一等价的那道边界在原生侧（`native/workspace.cpp:1223-1226` +
`native/workspace.hpp:96-99` 的 scheme 白名单，判据 `native/workspace_test.cpp:584-594` 那批拒绝用例）。
要搬请拍：(a) 在 `src/externalLinkLauncher.ts` 里加一道 `externalLinkRefusal(url)` 纯函数（jar:/无协议/UNC 三档），
`openExternalUrl` 先问它；(b) 或者维持现状，只靠原生边界。本轮按 (b) 不动，登记在报告 §6。
