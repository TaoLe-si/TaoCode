# 接线请求 · 2026-10-06 · lane `refactorfix`

给主代理的线。上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
（下列行号本片都自己打开核对过）。本片不动保留文件（`src/App.vue` / `src/bridge.ts` /
`src/components/CodeEditor.vue` / `native/main.cpp` / `scripts/verdict_table.py` / `docs/inventory/*`），
所以需要宿主动手的三件记在这里。

---

## R1 · `src/App.vue`：把 `runOrganizeImports` 塞进 `createKeymap`（一行）

**现状**（实测）：
- `src/App.vue:972` 已经从 `createSemanticActions` 解出了 `runOrganizeImports`；
- `src/App.vue:1564` 已经把它喂给了 Code 菜单（`codeMenuContext`）——菜单那一行能点；
- 但 `src/App.vue:1795` 起的 `createKeymap({ … })` 参数表里**没有**它（那一族最后一行是
  `src/App.vue:1809` 的 `runContextConfiguration, …, gotoSuper, gotoTest, gotoRelated, showNavBar, …`）。

**后果**：`src/keymapBindings.ts` 新增的 `code.optimizeImports`（Ctrl+Alt+O，上游
`platform/platform-resources/src/keymaps/$default.xml:340-342` = `<action id="OptimizeImports">
<keyboard-shortcut first-keystroke="control alt O"/>`）会命中 `src/keymap.ts` 的 `unwired` 集合 ⇒
**不注册**（这是本片按本仓铁律加的闸：宿主没给执行入口就不注册，宁可让键原样放行，也不留一条
只吞键不干活的假动作）。菜单能点、键按不动 —— 差的就是这一行。

**可直接粘贴**（`src/App.vue:1809` 那一行，在 `gotoRelated` 之后加一个标识符）：

```ts
  runContextConfiguration, runSelectedConfig, runToCursor, runEditor, save, saveAll, openSelectIn,
  gotoSuper, gotoTest, gotoRelated, runOrganizeImports, showNavBar, selectNextTab, selectPreviousTab,
```

**接线后自动发生的事**（不需要再改别的文件）：`src/keymap.ts` 的
`'code.optimizeImports': () => void (runOrganizeImports?.())` 拿到真处理器 ⇒
`ACTIONS.has('code.optimizeImports')` 为真 ⇒ Ctrl+Alt+O 与菜单那一行走**同一个** `runOrganizeImports`
（`src/semanticActions.ts:494`），后者只消费 `src/organizeImports.ts` 的两个出口
（`organizeImportsRequest` = 固定 `(0,0)` + 空诊断，`organizeImportsActionOf` = 先按 kind 精确筛）。

**判据**：`tests/refactor-organize-imports.test.mjs` 的「接线：Code 菜单那一行与 Ctrl+Alt+O 仍指向
同一个入口」已经钉住 ①菜单行的 `run: () => void ctx.runOrganizeImports()`、②表里那条的
chord/display/`upstream` 与 `findKeyBinding` 的实跑命中、③分派器只转发不抄第二份实现、
④`unwired` 那道闸的存在。本片的测试**不需要** R1 也算绿（闸让未接线的键不进注册），
但「按 Ctrl+Alt+O 真的整理导入」这一件用户可见的行为要等 R1。

---

## R2 · `native/lsp_code_actions.cpp`：`textDocument/codeAction` 的 context 缺 `only`

**现状**（实测，`native/lsp_code_actions.cpp:44-46`）：

```cpp
host.request("textDocument/codeAction", {{"textDocument", text_document(uri)},
    {"range", argument_range(args, line, character)},
    {"context", {{"diagnostics", argument_diagnostics(args)}}}},
```

context 里只有 `diagnostics`，没有 `only`。

**上游那一档**（`platform/lsp-impl/src/impl/features/formatter/LspImportOptimizer.kt`，本片逐行读过）：
- `:69` `val codeActionContext = CodeActionContext().apply {`
- `:70` `diagnostics = emptyList()`
- `:71` `triggerKind = CodeActionTriggerKind.Invoked`
- `:72` `only = listOf(SourceOrganizeImports)`（常量 import 在 `:20`）
- `:77-80` `CodeActionParams(lspDocument.id, Range(Position(0, 0), Position(0, 0)), // doesn't matter …)`

⇒ 上游是**由服务器按 `only` 筛**，只回一条（`:85` `singleOrNull()`），所以它连标题都不看。

**本仓现在的替代做法**（能不给 `only` 也能对齐用户可见行为的那一半）：
`src/organizeImports.ts:52-58` 先按 `kind === 'source.organizeImports'`（含 `source.organizeImports.*`
子 kind）精确筛；只有**全部条目都没填 kind**时才退回标题正则。

**缺口（要宿主补）**：`only` + `triggerKind` 得由 `lsp.request` 的 `codeAction` 那一支按调用意图给 ——
`src/organizeImports.ts:39-41` 的入参形状目前只有 `{kind:'codeAction', path, line, character, diagnostics}`。
建议加一个可选的 `only?: string[]` / `triggerKind?: 'invoked'|'automatic'` 透传到那三行 JSON：
不给 = 现在行为一格不变，整理导入那一路给 `['source.organizeImports']` + `'invoked'`。
补上之后 `src/organizeImports.ts` 的标题兜底档就可以删掉（那时筛选完全由服务器负责）。

**判据**：`tests/refactor-organize-imports.test.mjs` 第 1 条是**上游锚点**（逐行钉 `:69/:70/:71/:72/:79`，
上游一改就红）；第 2-5 条钉本仓那份筛选与请求形状。R2 落地时要同步改的判据已在
`organizeImportsRequest` 那条里写着（形状变了那条就红）。

---

## R3 · 「目标位已被占用」的四选一对话框缺弹层宿主（从一份不存在的文档里挪过来的登记）

**订正留痕**：`src/semanticActions.ts` 与 `src/renamePreview.ts` 原先把这一件登记在
`docs/wiring-requests-2026-10-06-refactor1.md` R1/R2 —— **本仓没有那份文档**（实测 `ls docs | grep refactor1`
无结果），而真实存在的 `docs/wiring-requests-2026-10-06-refactor.md` 的 R1/R2 讲的是树侧删除与
Unwrap chooser，不是这一件事。本片把引用原地改到本文（`src/renamePreview.ts:257-259`、
`src/semanticActions.ts:506-507`、`:565-566`），内容不变、不改行为。

**缺的那一半**（上游，本片自己打开核对）：
- `platform/lang-impl/src/com/intellij/refactoring/copy/CopyFilesOrDirectoriesHandler.java:543`
  `checkFileExist(...)`：`:547` 发现目标位有同名文件 ⇒ `:549-554` 问 `SkipOverwriteChoice.askUser(...)`，
  `:555-561` 选「覆盖」(index 0) 先删占位文件、否则 `return true`；
- `platform/lang-impl/src/com/intellij/refactoring/SkipOverwriteChoice.java:43-52`：`selection < 0`
  （关闭对话框）也返回 `SKIP`（`:50`）；
- `platform/lang-impl/src/com/intellij/refactoring/rename/RenameProcessor.java:232-235`：拿到 `true`
  就 `iterator.remove()` ⇒ 这个条目从改名集合里去掉，什么都不发生。

**本仓落点**：`src/renamePreview.ts:262` `renameTargetConflict()` + 消费者
`src/semanticActions.ts:571-572` —— 冲突就通知并**什么都不做**，等于上游「跳过/取消」那一支
（口径同一件事，只是没有「覆盖」这一档）。

**要宿主配合**：四选一（覆盖 / 跳过 / 全部覆盖 / 取消）需要 `src/App.vue` 那侧的弹层宿主与一个
把选择回传给 `renameEntryWithReferences` 的入口；本片禁改 `src/App.vue`，且「覆盖」要先删文件
（落盘动作），不在本片范围内 ⇒ 只登记，不做。

---

## 本片**没做**、也不该由本片做的

- 「`only` 筛」的原生侧透传（R2）与四选一宿主（R3）；
- `docs/inventory/*` 判决簿的改数（本片没动任何判决条目；生成物按规矩由脚本重跑，不手改）；
- `src/renamePreview.ts` / `src/semanticActions.ts` 里那些**上游**行号的逐条复核（只复核了
  本片自己要引用的那几条，其余属原 lane 账本）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 已接线**：与 refactorclose W1 同一条（`src/App.vue:1859` 已含 `runOrganizeImports`）。
- **R2** —— native，非本 lane。**R3** —— 登记。

结论：R1 已接线。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R1 已接线。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
