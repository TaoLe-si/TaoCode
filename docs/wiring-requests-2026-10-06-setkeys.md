# 接线请求 2026-10-06 · setkeys（本批落完键之后还差的那几行）

派单文件面只有 `src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`native/settings_schema.{cpp,hpp}`、
`src/components/SettingsDialog.vue`、`src/previewSettings.ts`（外加三个新组件与新头文件）。
下面每一条都给**目标文件 + 目标行号 + import + 可照抄整段 + 上游依据**，都在别人名下文件里，请按半区派下去。
**没接的键 = 存得下但没人读的死旋钮**，判词表与本批自查在 `docs/batch-2026-10-06-setkeys.md`。

---

## K-1 `src/App.vue`：把保存时两条 pass 接进 `save()`（必须，两步）

键（`stripTrailingSpaces` / `ensureNewLineAtEof` / `keepTrailingSpacesOnCaretLine`）与设置页那三格本批已落，
`src/editorFileOps.ts:242-246` 也已经把真值喂进 `saveTrimOptionsFor`（原文写 `settings: {}`，
现按 `docs/wiring-requests-2026-10-06-saveops.md` ③ 逐字换掉）。**只剩 `App.vue` 不调 `transformOnSave`**
（`grep -n transformOnSave src/App.vue` 零命中；`runActionsOnSave` 在 `src/App.vue:1125`）。

整段可照抄的代码（含顺序与通知文案）在
`docs/wiring-requests-2026-10-06-saveops.md` 的 ①.1（解构里加 `transformOnSave,`）与 ①.2（`save()` 里
`runActionsOnSave` 之后插 `transformOnSave` + `savePassNote`）—— 那两段是桶 saveops 自己写好的，本批**不重抄一遍**，
以免两份版本漂。要点复述：顺序必须是 `runActionsOnSave` → `transformOnSave` → `file.write`
（上游 `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/FileDocumentManagerImpl.java:1214-1245` 的
multiCast 顺序，`TrailingSpacesStripper` 在 `:1237`），本地历史回滚那条链保持绕过（①.3）。
判据：`tests/save-transforms.test.mjs` 末条现在钉的是「格子必须绑到同名键」，`执行顺序：先清行尾、再判末行` 那条
一旦顺序颠倒会红（他们的反向验证 M5）。

## K-2 `src/components/CodeEditor.vue`：回车家族与引号开关（W-4 ①+②）

- 目标行：`src/components/CodeEditor.vue:114-118`（`smartEnter = smartEnterCommand(() => …)`）与 `:968`（`smartQuotes(...)`）。
- 键已经存在：`EditorSettings.autoInsertPairQuote` / `closeCommentOnEnter` / `insertBraceOnEnter`
  （`src/settingsModel.ts:427/429/431`，默认全 **true** = `CodeInsightSettings.java:140/:132/:130`），
  `props.settings` 本来就是整个 `EditorSettings`（`CodeEditor.vue:91`），不用加 prop。
- 提供方多回四个字段（`block` 那一半是 W-4 ①，缺它整套块注释判定在生产里永不被问）：

```ts
const smartEnter = smartEnterCommand(() => {
  const style = view ? commentStyleFromState(view.state, view.state.selection.main.head) : null
  const lexicon = smartEnterLanguageFor(style ?? commentStyleFor(undefined, props.path))
  // 块注释词法四件套与上游同源：`java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28`（开）、
  // `:32-33`（闭）、`:62-63`（文档前缀 `/**`）、`:67-68`（续行 `*`）。
  return { ...lexicon, block: lexicon.block ?? undefined,
    blockCloseOnEnter: props.settings.closeCommentOnEnter, insertBraceOnEnter: props.settings.insertBraceOnEnter }
})
```

- 引号那一格（上游 `CodeInsightSettings.java:140`，注释见 `QuoteHandler.java:10-20`）：

```ts
        ...(props.settings.autoInsertPairQuote ? [smartQuotes(() => props.language)] : []),
```

  （今天 `:968` 是无条件 `smartQuotes(() => props.language), angleBraceHighlight(() => props.language),`；
  只包 `smartQuotes`，`angleBraceHighlight` 是配对高亮、不属于这条开关。）
- 行数提醒：`CodeEditor.vue` 登记上限 1147（`tests/module-size.test.mjs`），上面两段共 +5 行，
  要么把提供方抽进 `src/enterHandlers.ts`（他们名下），要么先拆别的东西，**不要抬上限**。
- 判据：`tests/editor-enter-block-comment.test.mjs` 的 Enter 挂载那条不受影响；
  `tests/editor-quote-faces.test.mjs:96-100` 钉的是 `smartQuotes(...)` 那一整行**逐字**，改成带 `...(cond ? [...] : [])`
  的形状时**必须同时**把那条断言改成判「条件里问的是 autoInsertPairQuote」，不许删断言。

## K-3 `src/enterHandlers.ts`：`EnterLanguage` 多三个字段（桶 5c 自己承诺的那第三处）

- 目标行：`src/enterHandlers.ts:63-68`（`interface EnterLanguage`）、`:253`（`enterInBlockComment(...)`）、
  `:281`（`enterAfterUnmatchedBrace(...)`）。
- 他们原文写的就是（`docs/wiring-requests-2026-10-06-bucket5c.md` §2 第 3 条）：
  `EnterLanguage` 加 `blockCloseOnEnter?: boolean`（`undefined` 按上游默认 true），
  并把调用改成 `enterInBlockComment(doc.toString(), selection.head, block, lexicon.blockCloseOnEnter ?? true)`；
  「在设置键真的存在之前我不先加这个字段」⇒ **键已存在，这一条现在可以做了**。
- 再加一条同形状的：`insertBraceOnEnter?: boolean`，`:281` 改成
  `const afterBrace = (lexicon.insertBraceOnEnter ?? true) ? enterAfterUnmatchedBrace(...) : null`
  （上游 `EnterAfterUnmatchedBraceHandler.java:84-87` 问的就是 `INSERT_BRACE_ON_ENTER`）。
- 默认值口径：`?? true` 与上游默认（`CodeInsightSettings.java:130/:132` 都是 true）一致，
  所以 K-2 没接之前行为一个字都不变 —— 这也是为什么 K-2/K-3 要**同批**落。

## K-4 `src/codeLensExtension.ts`：Code Vision 的两层过滤与每行条数上限（W4 的消费侧）

本批把 Code Vision 四把键与设置页落了，但渲染侧**今天不读那张表**（订正：W4 原文写「动作已经生效」，
实际 `shouldShowCodeVisionEntry` 只有 `src/codeLensExtension.ts:34` 的 import、**没有任何调用点**，
`buildDecorations`（`:233-248`）按 `groupAnchoredLenses(lenses)` 全量画）。差两行：

```ts
// :238 之前把该藏的组先滤掉（上游两层：CodeVisionSettings.kt:55-60 总闸 + :96-101 每组）
  const shown = lenses.filter(lens => shouldShowCodeVisionEntry(codeVisionGroupId(lens)))
  if (!shown.length) return Decoration.none
  for (const row of groupAnchoredLenses(shown, codeVisionSettings.visibleEntries)) {
```

- `visibleEntries` 需要 `src/codeLensSettings.ts` 的 `CodeVisionSettingsState` 补一个
  `visibleEntries: number`（出厂 5 = `CodeVisionSettings.kt:38-39`），`restoreCodeVisionSettings()` 与
  `codeVisionSettingsPatch()` 各带上它；**设置页已经在写盘上那一份**
  （`src/components/CodeVisionSettingsPage.vue` 的 `codeVisionVisibleEntries`，界 1..10 =
  `CodeVisionGlobalSettingsProvider.kt:43` 的 `spinner(1..10, 1)`），表里加了字段我就把 `syncRuntime()` 补一行。
- `groupAnchoredLenses(lenses, limit)` 的第二参早就在（`src/codeLens.ts:149-150`，非正数回落
  `CODE_LENS_VISIBLE_MAX = 5`，`:127`）⇒ 这一行不是新造行为。
- 启动读回：`restoreCodeVisionSettings(...)`（`src/codeLensSettings.ts:171`）今天没人调 ⇒ 请在
  `src/settingsPersistence.ts:86` 之后补一行（与 K-5 同一处、同一个形状）：

```ts
      restoreCodeVisionSettings({
        codeVisionEnabled: editorSettings.value.codeVisionEnabled,
        disabledGroups: editorSettings.value.codeVisionDisabledGroups,
        enabledGroups: editorSettings.value.codeVisionEnabledGroups,
      })
```

  （缺键时 `editor_defaults_impl()` 已经补好：`native/settings_schema.cpp:416-418`。）
- 判据：`tests/code-vision-local-channel.test.mjs`、`tests/cv-local-vision.test.mjs`、`tests/code-lens-grouping.test.mjs`。

## K-5 快速文档两档的写回与读回（= 桶 3a 的 R2 与 R3，键已就位）

R4 本批已落（`src/settingsModel.ts:462/464`，默认 true = `EditorSettingsExternalizable.java:76` 与
`DocumentationToolWindowManager.kt:55` 的 `documentation.auto.update`），所以那两条现在可以做了：
- `src/settingsPersistence.ts:86` 之后：`docHoverPolicyFromSettings(editorSettings.value)`
  （`src/docHoverPolicy.ts:73`；口径是「只有显式 `false` 才算关」⇒ 旧存档缺键 = 默认开，与上游一致）。
- `src/App.vue` 的 `<QuickDocPopup>` 上加 `@policy-change="applyDocHoverPolicy"` 与 `:can-toggle-hover`，
  补丁出口 `docHoverPolicyPatch()`（`src/docHoverPolicy.ts:82`）产出的就是这两把键。
- 整段可照抄代码在 `docs/wiring-requests-2026-10-06-bucket3a.md` 的 R2/R3，本批不重抄。

## K-6 终端那两格（`docs/wiring-requests-2026-10-06-bucket10b.md` 第 1 条）—— **本批不落，需先定默认值**

上游 `IS_WHEEL_FONTCHANGE_ENABLED = **false**`（`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`
的 `OptionSet` 初值，读接口 `isWheelFontChangeEnabled()` 在同文件 `:1043`），而本仓 `src/components/TerminalPanel.vue:81`
现在写死 `WHEEL_FONT_ZOOM_ENABLED = true`。⇒ 落键 + 照上游默认会**悄悄关掉**用户现在能用的滚轮缩放；
照本仓现状默认（true）就是**钉了一个与上游相反的默认值**而不留痕。两条都不能盲落，请桶 10 选一条并写明差异
（`docs/wiring-requests-2026-10-06-bucketW.md:118` 已把整条登记为「不做半截」）。
终端基准字号那一格同理要动 `TerminalPanel.vue:88-105`（他人文件），一并由桶 10 落。

## K-7 ~ K-9 扫其余文档后判定「不落」的三条（理由与去处）

| 条目 | 为什么不落 | 去处 |
|---|---|---|
| `bucket2c.md` W4：行内补全 provider 启停 | 本仓只有一条 LSP 供给，`src/inlineCompletionExtension.ts` 没有读设置的入口 ⇒ 一格只能永远为真的开关就是假控件；上游 `InlineCompletionConfigurableEP` 那张 EP 表在本仓没有对应物（他们自己也写了「只能做成一条固定开关」） | 桶 2 名下先给 `inlineCompletionExtension.ts` 加设置入口，再由设置面落键 |
| `bucket14c.md` §4 / `bucket7b.md` 第 1 条：浏览器族四把键（`browserList` / `defaultBrowserPolicy` / `useDefaultBrowser` / `browserPath`） | 要动 `native/main.cpp` + 新 `native/browser_launch.cpp` + `CMakeLists.txt` + `src/bridge.ts` 的 `Method` union（全在保留文件/禁改面）。只落键 = 存了一份没人执行的表 | 桶 14c/桶 7 与桶 15 同批；键面四处登记本批已备好模板（见 `docs/batch-2026-10-06-setkeys.md` §1.4） |
| `bucket11c.md` / `bucket12b.md`：`RunConfig['type']` 加 `'jar'` | `src/settingsModel.ts:26` 那一支的自陈写明了三张表必须同改：`src/runConfigEditors.ts:90`（`Record<NonNullable<RunConfig['type']>, …>`，只改联合直接 TS2741）与 `src/runConfigTree.ts:16` 都不在本面 | 主代理一次派给能同时改那两张表的半区 |

另外两条扫到但**无需动作**：`bucket15.md` 第 3 条（`externalTools` 可选字段放开）与 `bucket6b.md`（音频提示两键）
—— 本仓现状早做过（`native/settings_schema.cpp:286-300` 已有那几条分支、`settings_schema.hpp:124` 的注释写着
「2026-10-06 放开」；`audioCuesMode` / `audioCuesDisabled` 已在 `src/settingsModel.ts:135/141` 与
`settings_schema.hpp:111`）。留痕：判词说缺、实际已在。
