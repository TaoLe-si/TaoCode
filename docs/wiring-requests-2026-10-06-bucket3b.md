# 接线请求 · 桶 3b（提示 / CodeVision / 语言服务面）· 2026-10-06

> 只列**必须动保留文件或别人名下文件**的接线。模型与测试都已在 `src/cv*`、`src/codeLens*`、`src/inlay*`、`src/ls*` 落好，
> 下面每一条给的都是可以直接粘的那几行。上游坐标在括号里。
> 与 3a 的分工：3a 名下（`src/documentationView.ts`/`hoverDocumentation.ts`/`quickDoc*`/`quickDefinition*`/`documentLinks*`/
> `MarkdownPreview.vue`/`QuickDocPopup.vue` 与 `lsFeaturesWidget` 的**组件**）一条都没碰。

## W1 · Code Vision 本地提供者的生产入口（`src/components/CodeEditor.vue`，保留文件）

- 目标文件：`src/components/CodeEditor.vue`，第 151 行那个 `createCodeLens({...})` 的**前面**
- 要接什么：把 `src/cvLocalVision.ts` 的通道交给渲染层（`CodeLensDeps.localChannel`，`src/codeLensExtension.ts:257`）
  ```ts
  import { createCodeVisionLocalChannel } from '../cvLocalVision'
  // `lspDiagnostics` 见 `src/bridge.ts:297`（reactive Map，值形状 `LspDiagnostic{line,character,severity}`，
  // 与 `VisionProblem` 同形，`src/codeVisionProviders.ts:53`）；CodeEditor 里若还没有这个名字，从 '../bridge' 补导入。
  const codeVisionLocal = createCodeVisionLocalChannel({
    request: <T>(method: 'lsp.request', params: Record<string, unknown>) => request<T>(method, params),
    path: () => props.path,
    enabled: () => props.lspEnabled && !heavy && Boolean(view),
    problems: () => lspDiagnostics.get(props.path) ?? [],
    signature: () => `${props.path}:${view?.state.doc.length ?? 0}`,
  })
  ```
  然后 `createCodeLens({ ..., localChannel: codeVisionLocal })` 加这一项即可（**不要**再传 `local`）。
- 为什么需要：`src/codeVisionProviders.ts` 的三个内置 provider（problems / references / inheritors）与
  `src/cvLocalVision.ts` 的抓取层目前**没有生产消费方** —— 渲染侧的 `local` 依赖在 `CodeEditor.vue:151` 那次调用里没给，
  于是"行上方提示"仍然只有服务端 `codeLens` 一个来源。上游那一组内置 provider 是挂在 EP 上、**不经过 LSP** 的
  （`platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:25`、
  `java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaReferencesCodeVisionProvider.kt:17-38`）。
  补刷回调（计数落地 → 再落一次盘）已经由渲染层自己挂上（`src/codeLensExtension.ts:355`），宿主不用管顺序。
- 判据：`tests/cv-local-vision.test.mjs`（15 条，抓什么/几条请求/什么不画）、
  `tests/code-vision-local-channel.test.mjs` 末两条（通道对象 → 补刷一拍、通道抛错只丢本地那半）。

## W2 · Code Vision 本地条目的**点击**路由（`src/App.vue`，保留文件）

- 目标文件：`src/App.vue:1009` 的 `async function runCodeLensCommand(payload)` 开头
- 要接什么：先问本地动作，再谈服务端命令
  ```ts
  import { localCodeVisionAction } from './codeVisionProviders'   // src/codeVisionProviders.ts:181
  const local = localCodeVisionAction(payload.command, payload.arguments)
  if (local.kind !== 'none') { /* 见下三档 */ return }
  ```
  三档的去向都用**既有**链路，不需要新通道：
  · `findUsages`（path/line/character/symbol）→ 复用 `CodeEditor` 那条 `semantic` 事件链
    （声明见 `src/components/CodeEditor.vue:95`，`kind:'references'` 已在负载枚举里）；
  · `showInheritors` → 同一条链的 `kind:'typeHierarchy'`；
  · `showProblems` → 既有 `showOutput('problems')` + `revealLocation({path, line})`（两个函数名都在
    `src/App.vue:1000-1004` 那份装配清单里）。
- 为什么需要：现在 `runCodeLensCommand` 把**任何**命令名原样发给 `workspace/executeCommand`。
  本地条目带的是 `codeVision.*`（不是服务端命令，上游对应 `CodeVisionProvider.handleClick`，
  `platform/lang-impl/src/com/intellij/codeInsight/codeVision/CodeVisionProvider.kt:76`；
  usages 那一档的具体动作 = `ReferencesCodeVisionProvider.kt:12-14` 的 `GotoDeclarationAction.startFindUsages`），
  照今天这条路点一下就是「未注册的命令」报错。`localCodeVisionAction` 对残缺参数一律回 `none`，
  所以不会误吞服务端命令（判据：`tests/cv-local-vision.test.mjs`「条目带的命令与坐标能被 IDE 侧收口成本地动作」）。

## W3 · 语言服务状态面的那颗状态栏部件（`src/App.vue` + `src/statusBarWidgets.ts`，桶 6 名下）

- 目标：状态栏右侧一颗可点的 LSP 部件（上游 `lsWidget`：`platform/lsp-impl/src/impl/lsWidget/LspWidgetItemsProvider.kt:15-26`
  汇总条目、`platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt:43-90` 定标签/tooltip/错误标记/存活徽章、
  `platform/lang-api/src/com/intellij/platform/lang/lsWidget/LanguageServiceWidgetItem.kt:53-80`）
- 要接什么（模型侧**全都已经算好**，UI 只读）：
  · 一行摘要 `lspSessionLine()` / `lspWidgetLine(items)`（空表中英文名 `NO_SERVICES`＝「无服务」，`LangBundle.properties:609`）
  · tooltip `lspWidgetTooltip(items)`；条目 `lspWidgetItemFor(language, presentableName, { currentFile, content })`
  · 点击动作 `runLspWidgetItemAction(item, { request, notify })`（`src/lsSessionHost.ts:265`，走宿主 `lsp.stop`，
    `native/main.cpp:1079-1082`）——`item.stopOrRestart === null` 那一档它自己不发请求、不出一颗点不动的按钮
- 为什么需要：`ls/platform` 判词点名的就是「`lsWidget/LspWidgetItemsProvider` 的状态栏条目没有落点」。
  今天状态栏只有一颗 `smartMode` chip（`src/App.vue:2307`，aria-label 写着「语言服务状态」但点了跳大纲），
  那不是这一族：上游那颗是**每台服务器一条 + 分「当前文件/其他文件」两段 + 停止/重启动作**。
- 备注：`lspSessionStates` 的生产写入方已经有两处（`src/lspCompletionStartup.ts:41-44` 与 `src/quickDocHost.ts`），
  所以这颗部件读得到真状态，不是空壳。图标要从 `src/uiIcons.ts`（保留文件）里取既有键，
  尺寸走 `iconSize.*`；错误标记 + 存活徽章这两层叠法见 `LanguageServiceWidgetItem.kt:57-63`。
- 判据：`tests/ls-widget-action.test.mjs`（7 条）、`tests/lsp-feature-widget.test.mjs`、`tests/ls-session-state.test.mjs`。

## W4 · Code Vision 设置页与持久化（`src/settingsTreeMeta.ts` + 一个新页面组件 + `native/settings_schema.cpp`）

- 要接什么：`src/codeLensSettings.ts` 已有的这份表 —— 总闸 `codeVisionSettings.codeVisionEnabled`、
  每组开关 `setCodeVisionGroupEnabled(groupId, enabled)`、组名 `codeVisionGroupName(...)`
  （两组：`LSP CodeLens` = `LspCodeVisionProvider`、`问题计数` = `problems`）、
  每行可见条数 `CODE_VISION_VISIBLE_COUNT`（出厂 5，`CodeVisionSettings.kt:38-39`）；
  磁盘那一份的进出口是 `restoreCodeVisionSettings(patch)` / `codeVisionSettingsPatch()`。
- 为什么需要：右键「隐藏这个 provider / 全部隐藏」的**动作已经生效**（`src/codeLensExtension.ts:30-31` 在用），
  但缺设置页就没有反悔的地方（上游 `CodeVisionConfigurable`，`platform/lang-impl/resources/messages/CodeVisionBundle.properties:2-3`
  「Enable Code Vision」），而且重启后 `disabledGroups` 会丢（表是会话内的）。
- 上游坐标：设置分组名 `settings.hints.new.group.code.vision`（`platform/ide-core/resources/messages/ApplicationBundle.properties:724-726`）；
  与 3a 无关；`native/settings_schema.cpp` 是桶 7 名下（同键默认值那段见 `:315`）。
- 备注：这一条与 `docs/wiring-requests-2026-10-06-bucket3.md` 里 S1（若存在）是同一件事的两半，合并时以本条为准。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1 未接** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。复核 `createCodeVisionLocalChannel` / `localChannel` 在该文件 0 命中。需 CodeEditor owner。
- **W2 已接线**：`src/App.vue:163` import `localCodeVisionAction`、`:1042-1047` `runCodeLensCommand` 先问本地动作。
- **W3 已接线**：`src/App.vue:29` import + `:2379` 状态栏已挂 `<LspServicesWidget :active-path="activePath" @notify="…" />`。
- **W4（Code Vision 设置页与持久化）** —— 目标含 `src/settingsTreeMeta.ts`（保留文件）+ `native/settings_schema.cpp`（非本 lane）。需 settings/native owner。

结论：W2/W3 已接线；W1/W4 转给对应 owner。
