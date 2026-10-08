# 接线请求 · 2026-10-06 · lane `refactorclose`

给主代理的三条线。**每条的出口名与行号本轮都自己开文件核过**（前任 `refactorfix` 的
`docs/wiring-requests-2026-10-06-refactorfix.md` R1/R2/R3 讲的是同一批事，但它写下的行号已经漂，
本文按 2026-10-06 16:5x 盘上实况给准坐标；两份文档并读时以本文为准）。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（仓内 `third_party/intellij-community` 是坏树，不使用）。
本 lane 禁写 `src/App.vue`（余量 30）、`src/bridge.ts`（0 贴顶）、`native/**`、`docs/inventory/**` ⇒ 三件都要宿主动手。

---

## W1 · `src/App.vue`：把 `runOrganizeImports` 塞进 `createKeymap({…})`（一行，Ctrl+Alt+O 现在按不动）

**现状（本轮实测）**：
- `src/App.vue:972` 已从 `createSemanticActions` 解出 `runOrganizeImports`；
- `src/App.vue:1564` 已把它喂给 Code 菜单（`codeMenuContext`）⇒ **菜单那一行能点**
  （行本体 `src/menus/codeMenu.ts:141`，`run: () => void ctx.runOrganizeImports()`）；
- `src/App.vue:1800` 起的 `createKeymap({ … })` 参数表里**没有**它。
  订正留痕：前任文档写的是 `:1795` / `:1809`，盘上现在是 **`:1800`**（`const { onKey } = createKeymap({`）
  和 **`:1814`**（`runContextConfiguration, …, gotoRelated, showNavBar, selectNextTab, selectPreviousTab,`）。

**后果**：`src/keymapBindings.ts:155-157` 的 `code.optimizeImports`（`Ctrl Alt O`，上游
`platform/platform-resources/src/keymaps/$default.xml:340-342`
= `<action id="OptimizeImports"><keyboard-shortcut first-keystroke="control alt O"/>`）会落进
`src/keymap.ts:429-430` 的 `unwired` 集合 ⇒ **不参与注册**（本仓铁律：宿主没给执行入口就不注册，
宁可让键原样放行，也不留一条只吞键不干活的假动作）。⇒ 菜单能点、键按不动，差的就是这一行。

**可直接粘贴**（`src/App.vue:1814` 那一行，在 `gotoRelated` 之后加一个标识符）：

```ts
  runContextConfiguration, runSelectedConfig, runToCursor, runEditor, save, saveAll, openSelectIn,
  gotoSuper, gotoTest, gotoRelated, runOrganizeImports, showNavBar, selectNextTab, selectPreviousTab,
```

**接线后自动发生的事**（不需要再改别的文件）：
`src/keymap.ts:412` 的 `'code.optimizeImports': () => void (runOrganizeImports?.())` 拿到真处理器
（`KeymapContext` 里这一位早已声明好：`src/keymap.ts:130` `runOrganizeImports?: () => unknown`，
`:191` 已从 ctx 解构）⇒ `unwired` 少一项 ⇒ `ACTIONS.has('code.optimizeImports')` 为真 ⇒
Ctrl+Alt+O 与菜单那一行走**同一个** `runOrganizeImports`（`src/semanticActions.ts:499`），
后者只消费 `src/organizeImports.ts` 的两个出口。

**判据**：`tests/refactor-organize-imports.test.mjs:114-156` 已钉住 ①菜单行 `run: () => void ctx.runOrganizeImports()`、
②表里那条的 chord/display/`upstream` 与 `findKeyBinding` 的实跑命中（含 Ctrl+O / Alt+O / Ctrl+Alt+Shift+O 三档不串味）、
③分派器只转发不抄第二份实现、④`unwired` 那道闸的存在。**该测试不需要 W1 也算绿**（闸让未接线的键不进注册），
但「按 Ctrl+Alt+O 真的整理导入」这件用户可见的行为要等 W1。

---

## W2 · `native/lsp_code_actions.cpp`：`textDocument/codeAction` 的 context 缺 `only` 与 `triggerKind`

**现状（实测）**：`native/lsp_code_actions.cpp:44-46`（本轮逐行开）：

```cpp
host.request("textDocument/codeAction", {{"textDocument", text_document(uri)},
    {"range", argument_range(args, line, character)},
    {"context", {{"diagnostics", argument_diagnostics(args)}}}},
```

`context` 里只有 `diagnostics`，没有 `only`、也没有 `triggerKind`。

**上游那一档**（`platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt`，本轮重新逐行开，
行号与前任文档一致）：`:69` `val codeActionContext = CodeActionContext().apply {`、`:70`
`diagnostics = emptyList()`、`:71` `triggerKind = CodeActionTriggerKind.Invoked`、
`:72` `only = listOf(SourceOrganizeImports)`（常量 import 在 `:20`）、
`:79` `Range(Position(0, 0), Position(0, 0)), // doesn't matter`。
⇒ 上游是**由服务器按 `only` 筛**、只回一条（`:85` `singleOrNull()`），所以它连标题都不看。

**本仓现在的替代做法**（不给 `only` 也能对齐用户可见行为的那一半）：
`src/organizeImports.ts:59-65` 的 `organizeImportsActionOf` 先按 `kind === 'source.organizeImports'`
（含 `source.organizeImports.*` 子 kind）精确筛；只有**全部条目都没填 kind**时才退回标题正则
（`:51`，注释里写明「上游从不按标题认动作」）。这条形状被
`tests/refactor-organize-imports.test.mjs:60-90` 四条判据钉着。

**缺口（要宿主补）**：`only` + `triggerKind` 得由 `lsp.request` 的 `codeAction` 那一支按调用意图给 ——
`src/organizeImports.ts:46-48` 的 `organizeImportsRequest(path)` 目前只发
`{ kind:'codeAction', path, line:0, character:0, diagnostics:[] }`。
建议加可选的 `only?: string[]` / `triggerKind?: 'invoked'|'automatic'` 并透传到那三行 JSON：
不给 = 现在行为一格不变；整理导入那一路给 `['source.organizeImports']` + `'invoked'`。
补上之后 `src/organizeImports.ts:50-51,63-64` 的标题兜底档就可以删掉（那时筛选完全由服务器负责）——
**届时要同步改判据**：`tests/refactor-organize-imports.test.mjs` 的第 1 条（上游锚点，已钉 `:69/:70/:71/:72/:79`）、
`organizeImportsRequest` 那条（`:48-54`，形状一变它就红）、以及
`src/semanticActions.ts:514` 这个调用点（TS2345 的现场，形状换 `type`/`interface` 都会当场红）。

---

## W3 · 「目标位已被占用」的四选一对话框缺弹层宿主（沿用前任 R3，本轮把上游坐标改准）

**已落的一半（本仓，已绿）**：`src/renamePreview.ts:265-274` `renameTargetConflict()` + 消费者
`src/semanticActions.ts:576-577` ⇒ 冲突就通知并**什么都不做**，等于上游「跳过/取消」那一支；
判据 `tests/rename-file-conflict.test.mjs`（12 条，本轮修好其中 2 条写反的）。

**缺的那一半**（上游，本轮逐行开 + 订正前任写错的行号）：
- `platform/lang-impl/src/com/intellij/refactoring/copy/CopyFilesOrDirectoriesHandler.java:543`
  `checkFileExist(...)`：`:545` `findFile(name)`、`:546` `existing != null && !existing.equals(file)`、
  `:549` `SkipOverwriteChoice.askUser(...)`、`:555-557` 「全部」档的记忆、
  **`:560-563` 选「覆盖」(index 0) 先 `existing.delete()`**、**`:565-566` 否则 `return true`**、`:570` 覆盖成功 ⇒ `return false`。
  （前任文档写的 `:547` / `:549-554` / `:555-561` 各差 1–4 行，按本文这版为准。）
- `platform/lang-impl/src/com/intellij/refactoring/SkipOverwriteChoice.java:42-52`：`:47` 消息键、
  `:49` `Messages.showDialog(..., 0, ...)` 默认项 = 覆盖、`:50` `if (selection < 0) return SKIP;`（关闭对话框 = 跳过）。
- `platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java:232-235`：
  为 true 时 `:234` `iterator.remove();` + `:235` `continue;` ⇒ 这一条从改名集合里去掉，什么都不发生。
  （前任文档写的「`:235` 是 `iterator.remove()`」差一行 ⇒ 就是这条把它的判据判红的，见
  `docs/batch-2026-10-06-refactorclose.md` §2.2。）
- 文案：`platform/refactoring/resources/messages/RefactoringBundle.properties:492`
  `dialog.message.file.already.exists.in.directory=File ''{0}'' already exists in directory ''{1}''`
  —— zh 语言包不在这份社区树里 ⇒ **中文措辞无法核实**，宿主写弹层时自己定。

**要宿主配合**：四选一（覆盖 / 跳过 / 全部覆盖 / 取消）需要 `src/App.vue` 那侧的弹层宿主 + 一个把选择回传给
`renameEntryWithReferences` 的入口；「覆盖」还要先删占位文件（落盘动作）。本 lane 禁写 `src/App.vue`、
且这已超出「窄收尾」的范围 ⇒ 只登记，不做。

---

## 本 lane 的出口清单（供核 W1 用，全部本轮 grep/Read 实测）

| 出口 | 定义 | 消费方 |
| --- | --- | --- |
| `runOrganizeImports` | `src/semanticActions.ts:499`，导出表 `src/semanticActions.ts:802` | `src/App.vue:972`（解构）、`src/App.vue:1564`（菜单 ctx）、`src/menus/codeMenu.ts:26/:141`、`src/keymap.ts:130/:191/:412/:430` |
| `organizeImportsRequest` / `organizeImportsActionOf` | `src/organizeImports.ts:46` / `:59` | 只有 `src/semanticActions.ts:19` 一处 |
| `renameTargetConflict` / `renameTargetConflictMessage` | `src/renamePreview.ts:265` / `:282` | 只有 `src/semanticActions.ts:576-577` 一处 |
| `postFormatRegions` / `processFormattedText` | `src/postFormatProcessors.ts:270` / `:394` | `src/semanticActions.ts:52/:265/:267`、`src/actionsOnSave.ts:39/:89` |

**另一处坐标漂了（别人的文件，本 lane 不写，只登记）**：`src/keymapBindings.ts:147` 的注释写
「Code 菜单那一行 `src/menus/codeMenu.ts:112`」，实际那一行现在在 **`:141`**；
`src/keymap.ts:409-411` 与 `src/organizeImports.ts:20` 引 `codeMenu.ts` 时没写行号，不受影响。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（`runOrganizeImports` 进 `createKeymap`）已接线**：`src/App.vue:1859` 的 `createKeymap({...})` 实参已含 `runOrganizeImports`。
- **W2（native codeAction context `only`/`triggerKind`）** —— 非本 lane。
- **W3（目标位已占用四选一对话框）** —— 需弹层宿主，登记。

结论：W1 已接线；W2/W3 转 owner/登记。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「W1 已接线；W2/W3 转 owner/登记。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
