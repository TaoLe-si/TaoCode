# 接线请求 2026-10-06（保存时两条 pass）—— 请照抄，别手搓

执行体已经在 `src/editorSaveTransforms.ts`（判词与上游逐条坐标在
`docs/batch-2026-10-06-saveops.md`），本仓入口 `transformOnSave` 已经在 `src/editorFileOps.ts` 的返回对象里。
**本轮没有动 `src/App.vue`、`src/settingsModel.ts`、`native/*`**（都在这条 lane 的禁改面上），
所以还差下面三段。三段彼此独立，但 **②③ 必须同一次落**（键的白名单与默认值分两次落会把旧存档判坏）。

---

## ① `src/App.vue`：把 pass 接进 `save()`（必须，两步）

### ①.1 在 `createEditorFileOps({...})` 的解构里加一个名字

当前（`src/App.vue:1160-1166`）：

```ts
const {
  conflictPrompt, conflictDiff, showConflictDiff, resolveConflictReload, resolveConflictKeep,
  quickDoc, showQuickDoc, closeQuickDoc, copyReference, showFileProperties,
  quickDocGoBackward, quickDocGoForward, quickDocCanBackward, quickDocCanForward,
  quickDocOpenExternal, quickDocCanOpenExternal, quickDocFollowLink, quickDocResolveImage,
  convertIndents, convertLineSeparators, encodingPrompt, encodingSelect, openEncoding,
  reloadWithEncoding, applyEncodingChoice,
} = createEditorFileOps({
```

改成（只在末行前多一个 `transformOnSave,`）：

```ts
  reloadWithEncoding, applyEncodingChoice,
  transformOnSave,
} = createEditorFileOps({
```

### ①.2 在 `save()` 里、`runActionsOnSave` 之后插一段

当前（`src/App.vue:1134-1140`）：

```ts
  if (actionsOnSave.changed) { content = actionsOnSave.content; editorFor(tab.path)?.setDraft(content) }
  try {
    const result = await request<SaveResult>('file.write', { path: tab.path, content, expectedVersion: tab.version, encoding: tab.encoding, bom: tab.bom, safeWrite: generalSettings.value.isUseSafeWrite })
    tab.content = content
    tab.version = result.version
    tab.dirty = false
    notify(isDesktop ? `已保存 ${tab.path} · ${result.bytes} 字节 · ${encodingLabels[tab.encoding]}` : `示例已保存到内存 · ${result.bytes} 字节（未写入磁盘）`)
```

整段替换为（新增 `savePass` / `savePassNote` 两处，其余原样）：

```ts
  if (actionsOnSave.changed) { content = actionsOnSave.content; editorFor(tab.path)?.setDraft(content) }
  // IDEA 的保存前两条 pass（清行尾空白 / 补末行换行）。上游排在 Actions on Save **之后**：
  // `FileDocumentManagerImpl.java:1214-1245` 的 multiCast 顺序是 消息总线 → Actions on Save →
  // `myTrailingSpacesStripper`（:1237）。执行体与逐条判据在 src/editorSaveTransforms.ts。
  const savePass = await transformOnSave(tab, content)
  if (savePass.changed) { content = savePass.text; editorFor(tab.path)?.setDraft(content) }
  const savePassNote = [
    savePass.strippedLines.length ? `清掉 ${savePass.strippedLines.length} 行的行尾空白` : '',
    savePass.finalNewLine === 'added' ? '补了末行换行'
      : savePass.finalNewLine === 'last-line-cleared' ? '删掉了末行的空白行' : '',
    savePass.deferredLines.length ? `${savePass.deferredLines.length} 行被光标挡着未清` : '',
  ].filter(Boolean).join(' · ')
  try {
    const result = await request<SaveResult>('file.write', { path: tab.path, content, expectedVersion: tab.version, encoding: tab.encoding, bom: tab.bom, safeWrite: generalSettings.value.isUseSafeWrite })
    tab.content = content
    tab.version = result.version
    tab.dirty = false
    notify((isDesktop ? `已保存 ${tab.path} · ${result.bytes} 字节 · ${encodingLabels[tab.encoding]}` : `示例已保存到内存 · ${result.bytes} 字节（未写入磁盘）`)
      + (savePassNote ? ` · ${savePassNote}` : ''))
```

要点（别改）：
- `savedText` 用 `tab.content`（= 上次落盘正文），在 `transformOnSave` 内部取，**不要**在这里传；
  这条就是上游 `DocumentImpl.isLineModified` 的本仓承接物（默认档只清改动过的行）。
- 顺序：`runActionsOnSave` → `transformOnSave` → `file.write`。反过来会变成「先补换行、再清行尾」，
  判据测试「执行顺序：先清行尾、再判末行」会红（反向验证 M5）。
- 光标只传主光标（`EditorHandle.getCursor()` 只暴露一条，见 `src/editorTab.ts:21`）。
  上游是 `getAllCarets()`（`TrailingSpacesStripper.java:216-226`）；多光标档要等 `EditorHandle` 增加
  读取全部光标的能力，**不要**在这里假造。
- 非桌面端（示例缓冲）由 `backedByFile: isDesktop` 短路，等价于上游「文档没有对应文件 ⇒ `getOptions` 返回 null」
  （`TrailingSpacesStripper.java:298`），所以浏览器里保存不会改正文。

### ①.3（可选）本地历史回滚那条链不要接

`src/App.vue:1109` 的 `history.content` → `file.write` 是上游 `saveDocumentAsIs`
（`FileDocumentManagerImpl.java:376-392`，那里显式 `TrailingSpacesStripper.setEnabled(file, false)`）的对应物，
**保持绕过这条 pass** 才是对的。

---

## ② 设置键（**与 ③ 同一次落**；缺键必须补默认，不许按字段数量判损坏）

三条字段，全部来自上游 `EditorSettingsExternalizable.OptionSet` 的字段初值：

| 字段名 | 类型 | 默认值 | 上游依据（相对路径:行号） | 本仓消费方 |
|---|---|---|---|---|
| `stripTrailingSpaces` | `'None' \| 'Changed' \| 'Whole'` | `'Changed'` | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:73`（初值）、`:216-218`（三档字面值）、`:826-829`（读接口） | `src/editorSaveTransforms.ts:148-160` 的 `saveTrimOptionsFromSettings` |
| `ensureNewLineAtEof` | `boolean` | `false` | 同上 `:74`（`IS_ENSURE_NEWLINE_AT_EOF`）、`:804-806` | 同上 |
| `keepTrailingSpacesOnCaretLine` | `boolean` | `true` | 同上 `:142`（`KEEP_TRAILING_SPACE_ON_CARET_LINE`）、`:1144-1146` | 同上 + `:418-433` 的 `ensureNewLineAtEnd` |

**不要**这一轮落 `removeTrailingBlankLines`（`:75`）：本批没有它的执行体（判词只点名两条），
落了键就是一格假控件。执行体在后续批次里补，键与控件同时落。

### ②.1 `src/settingsModel.ts`（保留文件，由你落）

- 接口 `EditorSettings`（`src/settingsModel.ts:274-283` 那一段）追加：
  `stripTrailingSpaces: 'None' | 'Changed' | 'Whole'; ensureNewLineAtEof: boolean; keepTrailingSpacesOnCaretLine: boolean;`
- `defaultEditorSettings`（`:223`）追加：`stripTrailingSpaces: 'Changed', ensureNewLineAtEof: false, keepTrailingSpacesOnCaretLine: true`。
- 读取处一律 **`parsed.x !== undefined ? parsed.x : 默认`** 的写法；**不许**用字段数量或键数量判损坏
  （本仓出过把用户锁在项目外的事故，见任务书与 `native/settings_schema.cpp:1-2` 的「未知键剪枝」注释）。

### ②.2 `native/settings_schema.hpp`（我这边可以改，但必须等 ②.1 的键先存在 ⇒ 请同一次落）

第 15 行那一组里，在 `"formatOnSave",` 之后加：

```cpp
    // 保存时两条 pass（IDEA EditorSettingsExternalizable.java:73-74,142；
    // 消费方 src/editorSaveTransforms.ts）。三档字面值照抄 :216-218。
    "stripTrailingSpaces", "ensureNewLineAtEof", "keepTrailingSpacesOnCaretLine",
```

### ②.3 `native/settings_schema.cpp`

第 358 行那组默认值里，在 `{"formatOnSave", false},` 之后加：

```cpp
            // 上游默认：STRIP=Changed（:73）、ENSURE_NEWLINE_AT_EOF=false（:74）、
            // KEEP_TRAILING_SPACE_ON_CARET_LINE=true（:142）。缺键走这三个值。
            {"stripTrailingSpaces", "Changed"}, {"ensureNewLineAtEof", false}, {"keepTrailingSpacesOnCaretLine", true},
```

并把 `:55` 那段注释（「useTabCharacter / showWhitespaces / formatOnSave were added to the editor …」）
续上这三条，说明「新增字段按缺补默认」。

### ②.4 `src/bridge.ts`（保留文件）

`settings.update` 的 general/editor 补丁白名单里放行 `stripTrailingSpaces`（字符串枚举）与
两个布尔；校验域 = `None|Changed|Whole`，越界按上游一样**剪掉这一条**而不是整份作废。

---

## ③ 落完 ② 之后请解锁的两格设置页控件（+ 一条测试）

上游的这两格都在 Settings ▸ Editor ▸ General（`platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt`）：

| 本仓控件 | 上游控件与文案键 | 落点 |
|---|---|---|
| 三档下拉「保存时去除行尾空白：无 / 改动行 / 整个文件」 | `cdStripTrailingSpacesEnabled`（`EditorOptionsPanel.kt:156-157`，文案键 `combobox.strip.trailing.spaces.on.save`），三档字面值 `None`/`Changed`/`Whole` 见 `EditorSettingsExternalizable.java:216-218` | `src/components/SettingsDialog.vue` 的「保存时格式化代码」那一行附近（现 `:837`） |
| 勾选「保存时确保文件以换行结尾」 | `cdEnsureBlankLineBeforeCheckBox`（`EditorOptionsPanel.kt:147-149`，文案键 `editor.options.line.feed`） | 同段 |
| （同一段还有）勾选「光标所在行保留行尾空白」 | `cdKeepTrailingSpacesOnCaretLine`（`EditorOptionsPanel.kt:153-155`，文案键 `editor.settings.keep.trailing.spaces.on.caret.line`） | 同段，第三格 |

键落完后请把这行接上（`src/App.vue` 的 `save()` 里 `transformOnSave` 已在调用，设置面由
`editorFileOps.ts` 的 `saveTrimOptionsFor({ settings })` 传入）—— 需要把
`src/editorFileOps.ts:240` 的 `settings: {}` 换成真实取值：

```ts
    settings: {
      stripTrailingSpaces: editorSettings.value.stripTrailingSpaces,
      ensureNewLineAtEof: editorSettings.value.ensureNewLineAtEof,
      keepTrailingSpacesOnCaretLine: editorSettings.value.keepTrailingSpacesOnCaretLine,
    },
```

（`editorSettings` 已在 `EditorFileOpsDeps` 里，`src/editorFileOps.ts:31`，不用加新 dep。）

同时把这条判据从「不许渲染」改成「渲染了就必须有消费链路」：
`tests/save-transforms.test.mjs` 最后一条
`test('设置页没有渲染还没有消费链路的格子（不放假控件）')` —— 键与格子都落地后，
把它改成断言 `SettingsDialog.vue` 里那三格各自 `v-model` 到同名设置字段，且 `settingsModel.ts` 里三个字段都在。
**不要顺手删掉这条。**
