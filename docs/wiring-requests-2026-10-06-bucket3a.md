# 接线请求 · 2026-10-06 · 桶 3 文档半区（`lp/documentation` / `ls/documentation`）

> 我只写了 `src/docHoverContent.ts`（新增）、`src/hoverDocumentation.ts`、`src/documentationView.ts`、
> `src/quickDocLayout.ts`、`src/quickDocHost.ts`、`src/components/QuickDocPopup.vue`（都在我名下）。
> 下面四条要动的是保留文件 / 别人名下文件，**我没有动**。每条都给了目标行号与可照抄的整段。
>
> 已经复核过的（**不用再交、也不要再改**）：`QuickDocPopup` 挂进 `App.vue:2400` 的那一行是完整的 ——
> `@follow`→`quickDocFollowLink`→`followInternalDocLink`（符号引用换页 / 带路径跳编辑器 / 工作区外如实说）、
> `:resolve-image`→`quickDocResolveImage`→`resolveImage`（工作区相对路径读字节转 data URL、`file:` 与认不出的扩展名返回 null 退回 alt）、
> `@back`/`@forward`/`:can-backward`/`:can-forward`→`quickDocHistory.ts` 的真栈、
> `@open-external`/`:can-open-external`→`currentExternalUrl` + `shell.openUrl`。
> 这些现在有判据：`tests/doc-host.test.mjs`（12 条，含「内联过的链接不再重复列一行」）与
> `tests/doc-history.test.mjs` 的接线那两条。**缺的是下面 R1/R2/R3：齿轮的两档开关里，「自动更新」已经落到行为，
> 「在鼠标移动时显示」还没有生效点。**

---

## R1 · 编辑器 hover 通道改用共享的文档取用面（并把「在鼠标移动时显示」那档闸接上）

- **目标文件**：`src/components/CodeEditor.vue`
- **目标行号**：第 64 行的 import 段补一个符号；第 **512-517** 行整段替换（`hoverSource` 里 `try { const result = await request<LspHoverResult>(...)` 到 `catch { return null }`）
- **要接什么**：把「自己发 `lsp.request` hover + 原样贴 contents」换成调用 `src/docHoverContent.ts` 的共享取用面。
- **上游依据**：
  - `platform/lang-impl/src/com/intellij/openapi/editor/EditorMouseHoverPopupManager.java:452`
    （`findElementForQuickDoc` 第一行就是 `isShowQuickDocOnMouseOverElement` 那道闸，关掉 ⇒ 返回 null ⇒ 文档那部分整个不出现；
    同文件 `:445-448` 是两个 null 分支，普通提示照旧）
  - `platform/lang-impl/src/com/intellij/openapi/editor/HoverPopupContext.kt:106`（`showDocumentation && isShowQuickDocOnMouseOverElement` 才去算文档）
  - `platform/lsp-impl/src/impl/features/documentation/LspDocumentationTargetProvider.kt:20-51` +
    `platform/lang-impl/src/com/intellij/platform/backend/documentation/DocumentationTargetProvider.java:31`
    （hover 与 Ctrl+Q 走的是**同一个** `documentationTargets(file, offset)` 注入面，不是两条各自实现）
  - `platform/lsp-impl/src/impl/LspRequestExecutor.kt:50` + `213`（hover 结果全工程就一张 `HoverResultCache`）
  - `platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt:22-24/35-36`（整段空白当没有文档，不弹空框）

**第 64 行那条 import 之后加一行**（同文件，紧跟现有 `import { dapState, lspDiagnostics, request, ... } from '../bridge'`）：

```ts
// 文档取用面（闸 + 共享 hover 缓存 + 签名/描述整形）在 src/docHoverContent.ts；
// Ctrl+Q 那条入口（src/quickDocHost.ts）用的是同一张缓存，这里不再自己发 hover。
import { hoverDocStampOf, sharedDocHover } from '../docHoverContent.ts'
```

**第 512-517 行整段替换为**：

```ts
  // 「在鼠标移动时显示」这一档关掉时这里返回 null —— 与上游一致：不是改成显示别的，
  // 而是文档这一部分整个不出现（EditorMouseHoverPopupManager.java:452）。
  const text = await sharedDocHover().tooltipText({
    path: props.path,
    line: info.number - 1,
    character: pos - info.from,
    // 标记按 CodeMirror 的不可变文档对象取：只有真改动才变（改选区不算变更）。
    stamp: hoverDocStampOf(hovered.state.doc),
    lineText: info.text,
  })
  if (!text) return null
  return { pos, create: () => { const dom = document.createElement('div'); dom.className = 'lsp-hover'; dom.textContent = text; dom.style.whiteSpace = 'pre-wrap'; return { dom } } }
```

- **为什么需要**：现在这段是「每次都发一条 `lsp.request` hover 并把 markdown 原文（连同 ``` 围栏）贴进 tooltip」，
  既不过 `HoverResultCache`（与 Ctrl+Q 各发各的），也不认 `showQuickDocOnMouseOverElement` 那档设置，
  而且弹层里已经能显示的「签名在前、描述在后」在 tooltip 里还是反引号原文。
  接完之后：两入口共用一张缓存 + 区间命中、闸真的生效、tooltip 与弹层同一份整形。
- **落地后请顺手把 `LspHoverResult` 的 import 保留**（同文件别处仍在用），本请求不删任何东西。
- **验证判据**：接完之后 `tests/doc-hover-content.test.mjs` 的「hover 那一档闸」+「接线」两条已经把这条链的形状钉住；
  行为侧的 UI 判据需要跑起来才有（本仓无 hover 自动化的 DOM 层），所以**这条接上之前**，
  `QuickDocPopup.vue` 里那颗「在鼠标移动时显示」的按钮按 `canToggleHover` 缺省**不渲染**（假控件禁令）。

---

## R2 · 弹层齿轮：把 `policy-change` 落到持久化，并把 `can-toggle-hover` 打开

- **目标文件**：`src/App.vue`
- **目标行号**：第 **2400** 行（`<Teleport v-if="quickDoc" to="body"><QuickDocPopup …>` 那一整行）
- **要接什么**：在已有的 `@follow="quickDocFollowLink($event)"` 之后补两个属性/事件：
  `:can-toggle-hover="true"`（**仅当 R1 已落地**）与 `@policy-change="applyDocHoverPolicy($event)"`。
- **上游依据**：
  - `platform/lang-impl/src/com/intellij/codeInsight/documentation/ToggleShowDocsOnHoverAction.java:22/32`
    （动作读写 `EditorSettingsExternalizable` 的那一格 —— 改了就要落盘，不然重启就丢）
  - `platform/lang-impl/src/com/intellij/lang/documentation/ide/actions/ToggleAutoUpdateAction.kt:13/17/21`
    （同上，写 `documentation.auto.update`）
  - 两档的键名/默认档由 `src/docHoverPolicy.ts:54-57`（`DOC_HOVER_SETTING_KEYS`）与
    `:47`（默认都开）给出，**补丁形状就是那两个键**，不用在 App 里现写。

**第 2400 行替换成**（只在行尾的 `/>` 之前插入两个属性，其余一字不动）：

```html
    <Teleport v-if="quickDoc" to="body"><QuickDocPopup :layout="quickDoc.layout" :origin="quickDoc.origin" :x="quickDoc.x" :y="quickDoc.y" :can-backward="quickDocCanBackward()" :can-forward="quickDocCanForward()" :can-open-external="quickDocCanOpenExternal()" :can-toggle-hover="true" :resolve-image="(image, docPath) => quickDocResolveImage(image, docPath)" @close="closeQuickDoc()" @back="quickDocGoBackward()" @forward="quickDocGoForward()" @open-external="quickDocOpenExternal()" @follow="quickDocFollowLink($event)" @policy-change="applyDocHoverPolicy($event)" /></Teleport>
```

**并在本仓已有的 `createEditorFileOps({...})` 解构（第 1140-1156 行）之后加一个两行的函数**（放在第 1156 行的 `})` 之后）：

```ts
// 弹层齿轮改了一档：运行时真值已经由 `src/docHoverPolicy.ts` 的单例翻好，这里只负责落盘。
// 上游那两个 ToggleAction 写的也是同一份持久化设置（EditorSettingsExternalizable / documentation.auto.update）。
function applyDocHoverPolicy(patch: Record<string, boolean>) { void saveSettingsPatch(patch as Partial<EditorSettings>) }
```

- **为什么需要**：`QuickDocPopup.vue:61/73` 已经把 `policy-change` 发出来了，但 `App.vue:2400` 没有 `@policy-change`，
  于是现在**点了只改运行时值、重启就回到默认档**（用户看到「我关掉了，下次打开又自己开了」）。
  `saveSettingsPatch` 就在同文件 `:639`，`EditorSettings` 类型已经 import 着。
- **配套**：R4（`settingsModel.ts` 登记那两把键）必须一起做，否则 `Partial<EditorSettings>` 这两个键不在类型里、
  落盘也带不走。**R4 没落地时这条 `@policy-change` 先别接**（写进去会 TS 报错），
  但 `:can-toggle-hover` 与 R1 一起接。
- **判据**：`tests/doc-hover-policy.test.mjs` 的「接线」那条钉着
  `v-if="canToggleHover"`（没有生效点的开关不渲染）与 `emit('policy-change'`。

---

## R3 · 启动/加载设置时把两档灌回运行时单例

- **目标文件**：`src/settingsPersistence.ts`（不在我名下，也不在 §1 保留清单里 —— 但它属于设置装配面，故走请求）
- **目标行号**：第 **86** 行 `editorSettings.value = await request<EditorSettings>('settings.update', { settings })` 之后
- **要接什么**：`docHoverPolicyFromSettings(editorSettings.value)`（`src/docHoverPolicy.ts:73`）
- **为什么需要**：那份磁盘上的值现在没人读回运行时单例 —— 重启后两档都回到默认（开），
  与 R2 是同一个洞的两半（一个不管写、一个不管读）。
- **上游依据**：`EditorSettingsExternalizable.java:76`（持久化的运行时真值）/
  `DocumentationToolWindowManager.kt:55`（`by propComponentProperty("documentation.auto.update", …)`，属性变了行为就跟着变）。

**第 86 行之后插入一行**：

```ts
      // 文档面那两档（「在鼠标移动时显示」/「选区更改时自动刷新文档」）的运行时真值在
      // src/docHoverPolicy.ts 的单例里；从盘上读回来后灌进去，缺键按上游默认档（开）。
      docHoverPolicyFromSettings(editorSettings.value)
```

**并在文件顶部 import 段补**：

```ts
import { docHoverPolicyFromSettings } from './docHoverPolicy.ts'
```

- **注意（迁移）**：老 settings 文件里**没有**这两把键。`docHoverPolicyFromSettings` 的口径是
  「只有显式 `false` 才算关」（`src/docHoverPolicy.ts:74`），缺键 ⇒ 默认开 ⇒ 与上游默认档一致，
  不会因为「少一个键」把用户当配置损坏。

---

## R4 · 设置模型登记那两把键（`EditorSettings` 的字段 + 默认值）

- **目标文件**：`src/settingsModel.ts`（§1 保留文件）
- **要接什么**：`EditorSettings` 接口加两个布尔字段 + `defaultEditorSettings` 给出**开**，
  键名与默认档都已经在 `src/docHoverPolicy.ts:47/54-57` 定死，请逐字取用：
  `showQuickDocOnMouseHover: boolean`、`autoUpdateDocumentation: boolean`，默认都 `true`。
- **上游依据**：`EditorSettingsExternalizable.java:76`（`SHOW_QUICK_DOC_ON_MOUSE_OVER_ELEMENT = true`）、
  `DocumentationToolWindowManager.kt:55`（`documentation.auto.update` 默认 `true`）。
- **为什么需要**：没有这两格，R2 的补丁写不进持久化面（`saveSettingsPatch` 收 `Partial<EditorSettings>`）。
- **放置建议**：`EditorSettings` 里 `lineNumeration`（第 274 行那一段）之后，注释里带上上面两条上游坐标；
  字段注释请写「IDEA「在鼠标移动时显示」/「选区更改时自动刷新文档」」，中文文案与
  `DOC_HOVER_LABELS`（`src/docHoverPolicy.ts:60-67`）逐字一致 —— 后者取自
  `localization-zh.jar messages/CodeInsightBundle.properties` 的 `javadoc.show.on.mouse.move`
  与 `action.description.refresh.documentation.on.selection.change.automatically`。
- **判据**：`tests/doc-hover-policy.test.mjs` 里 `DOC_HOVER_SETTING_KEYS` 那条已经把键名钉死，
  登记时若名字不一致会在设置页/持久化两侧漂（这条测试只钉单例侧，R4 的字段名要靠复读对齐）。

---

## R5 · native 把 hover 的 `range` 透传上来（做完「按文本区间命中」才是真数据驱动）

- **目标文件**：`native/lsp_session.cpp`（属桶 3，但**当前工作区里它已经被另一个半区改着** —— `git status` 显示 ` M`，
  所以我不动它，避免覆盖别人的现场），可选配套 `src/bridge.ts:126` 的 `LspHoverResult`（§1 保留文件）。
- **目标行号**：`native/lsp_session.cpp` 第 **156-162** 行的 `if (kind == "hover")` 分支里，
  第 **162** 行 `on_result({{"available", true}, {"contents", hover_text(result.at("contents"))}}, Json(nullptr));`
- **要接什么**：把服务器给的 `result["range"]` 原样带上（缺失就不带）。改这一行为：

```cpp
                auto reply = Json{{"available", true}, {"contents", hover_text(result.at("contents"))}};
                if (result.contains("range") && result["range"].is_object()) reply["range"] = result["range"];
                on_result(reply, Json(nullptr));
```

- **`src/bridge.ts:126` 可选配套**（不加也能跑：`src/docHoverContent.ts` 用自己的
  `LspHoverPayload` 结构类型读这一格，`request<T>` 是泛型，不需要动保留文件）：
  `LspHoverResult` 加 `range?: { start: LspPosition; end: LspPosition }`。
- **上游依据**：
  - `platform/lsp-impl/src/impl/LspRequestExecutor.kt:213-221`
    （`it.range = hover.range?.let { range -> lspDocument.toHostRange(range) }` —— 区间是服务器给的，映射到宿主文档）
  - `platform/lsp-impl/src/impl/features/documentation/HoverResultCache.kt:11-12`
    （`storedValue.textRange.contains(queriedOffset)` —— 命中就按这条区间判）
  - `platform/lsp-impl/src/impl/features/documentation/TextRangeAndMarkupContent.kt:14-20`
    （服务器没给 ⇒ 零长区间 ⇒ 只剩「同位置」这一档，本仓现在就是这个状态）
- **为什么需要**：判决里那条「按**文本区间**命中（同符号内移动光标不命中）」的**TS 侧已经做完并测死**
  （`src/hoverDocumentation.ts` 的 `docHoverRangeContains` + `createHoverCache` 的 containment 命中 +
  `src/docHoverContent.ts` 的 `hoverRangeFromPayload`，判据在 `tests/doc-hover-content.test.mjs` 前四条）。
  卡的只剩 native 把 `range` 丢掉这一行 —— 不补这一行，`payload.range` 永远是 `undefined`，
  区间命中这条路就永远走不到（**不是没实现，是没有数据**）。
- **验证义务**：native 改动要 `call vcvars64.bat` 后重建 + `.tools/nctest-all.bat`；
  建议在 `native/lsp_fake_server_requests.cpp:119-120`（fake server 的 `textDocument/hover` 分支）
  顺手回一个 `range`，这样 `lsp_host_test.cpp`/`lsp_coding_test.cpp` 那条 hover 往返能顺带把新字段钉住
  （**我没有改任何 native 文件**，包括 fake server）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 未接** —— 目标 `src/components/CodeEditor.vue`（禁改清单）。复核 `:510-521` 仍是「自己发 `lsp.request` hover 原样贴」，未换 `sharedDocHover`。需 **CodeEditor owner**。
- **R2 部分** —— `@policy-change` 已接（`src/App.vue:2478` 的 `@policy-change="(patch) => void saveSettingsPatch(patch)"`）；`:can-toggle-hover="true"` **未加**（R1 未落地前按请求原文「先别接」，否则那颗按钮无生效点 = 假控件）。等 R1。
- **R3 已接线（形状迁移）**：`docHoverPolicyFromSettings` 现由 `src/workspaceLifecycle.ts:15/:247` 调用（不再是 settingsPersistence.ts 的 `:86`），设置读回后灌运行时单例。
- **R4 已接线**：`src/settingsModel.ts:504/:506` 两字段 + `:265` 默认值（都 true）。
- **R5 已接线**：`native/lsp_session.cpp:171` 已透传 `range`（`:163-165` 注释记明）。
- **3a2 W1 已接线**：`src/style.css:1361` `.quickdoc-content .quickdoc-link`、`:1371` `.quickdoc-section-body p` 等规则已在。
- **3a2 W2 未接** —— 同 R1，`CodeEditor.vue` 的 hover 渲染仍另走一套（禁改清单）。需 CodeEditor owner。

结论：R3/R4/R5/W1 已接线；R1/R2 的 can-toggle-hover/R2 与 3a2 W2 转给 CodeEditor owner。
