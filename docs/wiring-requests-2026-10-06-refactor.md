# 接线请求 · 2026-10-06 · 桶 1 代号 `refactor`

给主代理的线。目标文件都在保留面（§1）或他桶名下，本片只给**可照抄的整段** + 实测行号 + 上游依据。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列行号本片都自己打开核对过）。

与 `docs/wiring-requests-2026-10-06-format.md`（上一轮、同一片文件面）的关系：
它的 **W1 = 本片 R1**、**W2 = 本片 R2**，那两份的模块侧本轮又补了一块（`src/refactorHostAssembly.ts` 的
`showSafeDelete()`），行号也按现状重核过 ⇒ **以本片 R1/R2 为准，W1/W2 可作废**。
它的 W3（设置面两个控件）与 W4（保存时格式化绕过本地闸）不在本片范围，维持原样、不重复交。

---

## R1 · `src/treeActions.ts` + `src/App.vue`：树侧删除走上游那张三选一（bucket1b A5 的最后一格）

**现状**：`src/treeActions.ts:123-134` 的 `warnBeforeDelete()` 只问语言服务要代码引用，拿到就
`notify(safeDeleteNotice(...))` 一句话提示（`:132`），**没算注释/字符串那半本账**，也没有三选一；
`beginDelete()`（`:139`）随后照样把 `deleteTarget` 立起来 ⇒ 树的确认框与上游那张对话框是两套。
重构菜单/Alt+Delete 那一侧已经接好（`src/refactorHostAssembly.ts:383-412`），两个入口现在共用同一条删档链，
但**树侧那条还没共用同一个对话框**。

**本片已备好的模块侧**（不用再写第二份组装）：
- `safeDeletePromptFromFiles(name, refs, files, options?)`（`src/safeDelete.ts:226`）—— 调用方只给 `{path,text}`，
  注释标记由模块按路径补齐（漏给 `style` 会**静默漏报注释**）；`options.searchInComments` 为假就一个字都不扫；
- `defaultSafeDeleteOptions()`（`src/safeDelete.ts:108`）；`prompt.blocked`（`:188`）判要不要弹；
- `showSafeDelete(prompt, path, target)`（`src/refactorHostAssembly.ts:446`，**本片新增**）——
  把外部算好的账交给**同一张** `RefactorSafeDeleteDialog`（挂载点已在 `src/App.vue`，`tests/refactor-menu-parity.test.mjs:257` 守着）；
- `scanFiles(path)`（`src/refactorHostAssembly.ts:129`，已有出口）—— 与「更改签名」同一份源码扫描口径。
- 判据：`tests/refactor-safe-delete.test.mjs`（8 条）、`tests/refactor-host-assembly.test.mjs`（新增那条 `showSafeDelete` 契约）。

### 改法 1／3：`src/treeActions.ts` 的 import（第 14 行那句直接扩写）

```ts
import { declarationTarget, defaultSafeDeleteOptions, safeDeleteNotice, safeDeletePromptFromFiles,
         safeDeleteReport, type SafeDeleteFileText, type SafeDeletePrompt } from './safeDelete.ts'
import type { LspLocation } from './bridge.ts'
```

### 改法 2／3：`TreeActionsDeps`（`src/treeActions.ts:19-58`）加两条**可选**依赖

放在 `refreshTree?`（`:57`）旁边即可。写成可选是有原因的：上一轮把 `RefactorMenuContext` 的五个成员写成必填，
`src/App.vue` 没同批补 ⇒ TS2739，而且菜单里冒出点了没反应的行（`docs/batch-2026-10-06-bucket1b.md` §1 记过）。

```ts
  /**
   * 安全删除：把外部算好的用法账交给上游那张三选一对话框（`UnsafeUsagesDialog` 的本仓等价物）。
   * 宿主没接这两条时维持今天的「一句话提示」，不弹一个没人实现的框。
   */
  showSafeDelete?: (prompt: SafeDeletePrompt, path: string, target: { line: number; character: number } | null) => unknown
  /** 工作区源码文本（注释/字符串那半本账扫的就是这一份，与「更改签名」同一条扫描链）。 */
  scanSourceTexts?: (path: string) => Promise<SafeDeleteFileText[]>
```

并在 `createTreeActions` 的解构（`:61-63`）里补 `deps` 用法（这两条**不要**解构进 `const {...}`，
按 `deps.showSafeDelete` 判存在性，见下）。

### 改法 3／3：`warnBeforeDelete`（`src/treeActions.ts:118-134`）整段替换 + `beginDelete`（`:139`）改一行

```ts
/**
 * Safe Delete 的删前检查（上游 `SafeDeleteProcessor`）：算完「代码引用 + 注释/字符串里的字面出现」
 * 两本账，有账就弹 `UnsafeUsagesDialog` 的三选一（默认项是「查看用法」，回车落它），
 * 没账就直接进删除。返回值 = 这次删除是否已被三选一接管（接管了就不该再弹树自己的确认框）。
 */
async function warnBeforeDelete(entry: Entry): Promise<boolean> {
  if (!isDesktop || entry.kind !== 'file' || !findTab(entry.path)) return false
  await refreshOutline(entry.path)
  const target = declarationTarget(entry.path, outline.value)
  if (!target) return false
  let refs: LspLocation[] = []
  try {
    const result = await request<LspReferencesResult>('lsp.request',
      { kind: 'references', path: entry.path, line: target.startLine, character: target.startChar })
    refs = result.available ? (result.refs ?? []) : []
  } catch { /* 语言服务不可用：代码引用那一半账就是空的，对话框里如实写着 */ }
  if (!deps.showSafeDelete || !deps.scanSourceTexts) {          // 宿主还没接三选一 ⇒ 维持今天的一句话提示
    if (refs.length) notify(safeDeleteNotice(baseName(entry.path), safeDeleteReport(refs)))
    return false
  }
  const files = await deps.scanSourceTexts(entry.path)
  const prompt = safeDeletePromptFromFiles(baseName(entry.path), refs, files, defaultSafeDeleteOptions())
  if (!prompt.blocked) return false                             // 一笔用法都没有 ⇒ 上游也是直接删
  deps.showSafeDelete(prompt, entry.path, { line: target.startLine, character: target.startChar })
  return true
}
```

```ts
function beginDelete(chosen?: Entry) { const entry = chosen ?? treeMenu.value?.entry; if (!entry || !entry.path || isSyntheticPath(entry.path)) return; treeMenu.value = null; void warnBeforeDelete(entry).then(handled => { if (!handled) deleteTarget.value = entry }) }
```
（原来那句 `deleteTarget.value = entry; void warnBeforeDelete(entry)` 的顺序要让位于「先算账、再决定弹哪一张框」，
否则两张对话框会一起出现。）

### 改法 4／4：`src/App.vue` 的 `createTreeActions({...})`（deps 集中在 `:1355` 那一段）加两行

```ts
  // 安全删除：树侧的账交给重构域那同一张三选一对话框（`src/refactorHostAssembly.ts` 的 showSafeDelete/scanFiles）。
  showSafeDelete: refactorHost.showSafeDelete, scanSourceTexts: (path: string) => refactorHost.scanFiles(path),
```

**上游依据**：
- `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteProcessor.java:447-452`
  （`addNonCodeUsages(element, searchScope, usages, insideElements, searchNonJava, searchInCommentsAndStrings)`；
  bucket1b 与本仓旧注释写的 `:449-464` 是签名头往前挪了两行，方法从 `:447` 起）；
- `platform/lang-impl/src/com/intellij/refactoring/safeDelete/UnsafeUsagesDialog.java:35`（标题 `usages.detected`）/
  `:36`（OK = `delete.anyway.button`）/ `:41-47`（三个动作：`ViewUsagesAction` → OK → `CancelAction`）/
  `:58`（清单抬头 `the.following.problems.were.found`）/ `:95-98`（`DEFAULT_ACTION` ⇒ 回车落「查看用法」）；
- `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteDialog.java:149/:155`（两个搜索复选框）、
  `:163-165`（缺省档 = 本仓 `defaultSafeDeleteOptions()`）；
- `platform/refactoring/resources/messages/RefactoringBundle.properties:312/:313/:316/:317/:318`（那五句文案）；
- `platform/platform-impl/resources/idea/LangActions.xml:388`（`<reference ref="SafeDelete"/>`）——
  树右键 Delete、`Delete` 键与重构菜单 SafeDelete 在上游是**同一个动作** ⇒ 两个入口不能各画一张框。

---

## R2 · `src/components/CodeEditor.vue` + `src/App.vue`：Unwrap 多候选的 chooser（bucket1b A6）

**现状**：`src/components/CodeEditor.vue:903` 的 `Ctrl-Shift-Delete` 直接跑
`createUnwrapCommand(props.settings.tabSize)`（拆**最内层**），`src/editorCommands.ts:18/233` 也仍注册 `unwrapCommand`。
候选列表 `findUnwrapCandidates()` 与 chooser 的五件都在 `src/unwrap.ts`（判据 `tests/refactor-unwrap-chooser.test.mjs` 6 条、
`tests/unwrap-candidates.test.mjs`），只是没人消费 ⇒ 判词那条「缺：多候选的 chooser UI」。

**要接的三条线**（模块侧全部现成，不用新写逻辑）：

1. `src/components/CodeEditor.vue` 的 import 补一行，键位那行换成候选分派：

```ts
import { createUnwrapApplyCommand, findUnwrapCandidates, unwrapChooserItems, unwrapChooserNeeded } from '../unwrap.ts'
```
```ts
          // Unwrap/Remove（Ctrl+Shift+Delete，`$default.xml:918-920`）：候选模型在 src/unwrap.ts。
          // 一条候选 ⇒ 直接拆；多于一条 ⇒ 把行表抛给宿主弹层（上游一律弹层，见下面的差异说明）。
          { key: 'Ctrl-Shift-Delete', preventDefault: true, run: editor => {
            const text = editor.state.doc.toString()
            const { from, to } = editor.state.selection.main
            const candidates = findUnwrapCandidates(text, from, to, props.settings.tabSize)
            if (!unwrapChooserNeeded(candidates)) return false
            if (candidates.length > 1) { emit('unwrapChooser', unwrapChooserItems(candidates)); return true }
            return createUnwrapApplyCommand(candidates[0]!.edit)(editor)
          } },
```
   `emits` 声明在 `src/components/CodeEditor.vue:92-95`，加 `unwrapChooser: [items: UnwrapChooserItem[]]`；
   `defineExpose`（`:429-432`）加一条给宿主回应用：`applyUnwrap: (edit: UnwrapEdit) => createUnwrapApplyCommand(edit)(view)`
   —— 落笔前的偏移回验已经在 `unwrapEditIntact()` 里做（站不住就返回 `false`，不吞键）。

2. `src/App.vue`：`@unwrap-chooser` 的弹层。骨架照 `src/components/RefactorSafeDeleteDialog.vue`
   （同一个 `.command-palette` 那一套），标题用 `UNWRAP_CHOOSER_TITLE`（`src/unwrap.ts:209`），
   每行文本用 `items[i].label`，选中后 `editorFor(activePath.value)?.applyUnwrap(candidates[items[i].index].edit)`；
   宿主自己留一份 `candidates`（items 里带 `index`，就是为这一步，见 `unwrapChooserItems` 的注释）。

3. `src/editorCommands.ts:18/233`：`unwrap: unwrapCommand` 可以保留（`editorActions` 那张表还在被命令面板用），
   但**建议**一并换成同一个候选分派，否则「菜单/命令面板按 unwrap」和「按快捷键」行为不同。

**两处如实差异，接的时候一起决定**：
- 上游**只要有一条候选也弹层**：`platform/lang-impl/src/com/intellij/codeInsight/unwrap/UnwrapHandler.java:80-91`
  （`selectOption`：空列表直接 return；`showOptionsDialog()` 为真就 `showPopup`，只有单元测试模式才
  `options.get(0).perform()`）+ `UnwrapDescriptorBase.java:67-69`（`showOptionsDialog()` 恒真）。
  本仓 `unwrapChooserNeeded()` 已按上游写（`length > 0`），上面那段代码里的「一条直接拆」是本仓现状的保守档；
  要按上游改就把 `candidates.length > 1` 换成 `true`，并同步改 `tests/unwrap.test.mjs` 里
  钉「`unwrapCommand` 直接拆最内层」的那条（该测试文件在桶 5 名下）。
- 行文本：上游是 `Unwrap 'if...'` 这一族（`platform/lang-api/resources/messages/CodeInsightBundle.properties:53-61`，
  逐条由 `JavaIfUnwrapper.java:28`、`JavaBracesUnwrapper.java:18` 取键）；本仓既有口径是「拆掉 if 包裹」，
  被 `tests/unwrap-candidates.test.mjs` 逐字钉住 ⇒ 本片**没有**改标签、也没放松那条断言。
- 键位事实：`platform/platform-resources/src/keymaps/$default.xml:918-920` = `<action id="Unwrap">` /
  `first-keystroke="control shift DELETE"`（**订正留痕**：判词原文写 `:917-920` 且 id 写成 `UnwrapRemove`，
  实测行号 `:918-920`、id 是 `Unwrap`）。

---

## R3 · 桶 5：`Ctrl+Alt+I`「自动缩进」现在做的不是上游那件事（`lp/generation` 的实测偏差）

**实测现状**（三处都在他桶/保留面，本片只读）：
- 菜单行：`src/menus/codeMenu.ts:111` `ctx.editable('indent.selection', '自动缩进', 'Ctrl Alt I', …)`
  —— 行**有**、键位**有**、命令**有**（不是假控件），但命令体是 CodeMirror 的 `indentMore`
  （`src/editorCommands.ts:269` `'indent.selection': indentMore`）；
- 键位：`src/components/CodeEditor.vue:784` `{ key: 'Ctrl-Alt-i', … run: editingCommands['indent.selection']! }`。

**上游那条动作实际做的两件事**（`platform/lang-impl/src/com/intellij/codeInsight/generation/AutoIndentLinesHandler.java:24-72`）：
1. `:41` → `adjustLineIndent(...)`：把选区里每一行的缩进**调到代码风格算出的那一档**
   （`:70` `codeStyleManager.adjustLineIndent(file, new TextRange(行首, endOffset))`）—— 不是「每行加一级」；
   单行且无选区时先问 `isLineToBeIndented`（`:66`），不该动的行一个字都不改；
2. `:47-57`：**没有选区**时把光标移到**下一行同一列**（越界就夹到该行行尾）、清选区、相对滚动 ——
   所以连按 Ctrl+Alt+I 是「一路往下逐行找齐」。
键位事实：`platform/platform-resources/src/keymaps/$default.xml:828-830`（`control alt I`）；
菜单位置：`platform/platform-impl/resources/idea/LangActions.xml:314-322`（`CodeFormatGroup`：
`ReformatCode`(:315) → `ShowReformatFileDialog`(:318) → `AutoIndentLines`(:319) → `OptimizeImports`(:320) → `RearrangeCode`(:321)）
—— 本仓 `codeMenu.ts:108/111/112` 的次序与之一致，`ShowReformatFileDialog`/`RearrangeCode` 没有落点。

**要请桶 5 决定的两档**（本仓没有语法树，「按风格算缩进」这件事只有两条真路）：
- A 档（改动最小、语义最近）：命令体走既有的**选区格式化**那条链（`src/semanticActions.ts:181` 的
  `runFormatting(path, range)`，range = 选区所覆盖的行）。如实代价：LSP 的 rangeFormatting 会连空白与间距一起重排，
  不是「只调缩进」，与上游有差 ⇒ 要么把菜单行文案与 `重新格式化` 区分开、要么在提示里写明；
- B 档：把这一行的键位与文案撤下（本仓 `Edit` 菜单已有「缩进选区 Tab」/「反缩进选区 Shift+Tab」，
  `src/menus/editMenu.ts:156-157`），等真有本地缩进器再挂 —— `src/lspFeatureMatrix.ts` 明确写了不回退本地缩进器。
本片按规约**不猜、不自造**：两条都要桶 5 + 主代理点名，才动得那三个文件。
判据：`tests/refactor-menu-parity.test.mjs` 里那两条「不许自造键位」的形态可以照搬到代码菜单
（一旦选 B 撤键位，`codeMenu.ts:111` 那行的 `keys` 也要同时清掉，别留键位表里没有的 advertised 键）。

---

## 本片**没做**、也不该由本片做的

1. **postFormat / 「不格式化」清单的设置面**：写入口都在模块里
   （`setFormatExcludedPatterns()` `src/formattingRestriction.ts:47`、`src/codeStyleSettings.ts:113-121`），
   缺的是 `src/components/SettingsDialog.vue` 那一个控件 ⇒ 与 `docs/wiring-requests-2026-10-06-format.md` W3 同一件事，不重复交。
2. **保存时格式化绕过本地闸**（`src/actionsOnSave.ts`）：同上，维持 W4。
3. **`ConfigureCodeStyleOnSelectedFragment`**（Alt+Enter 的意图）：意图注册在 `src/localIntentions.ts`（桶 2 名下），
   而它的面板是 Swing 的 `CodeFragmentCodeStyleSettingsPanel`；本仓发给语言服务的格式化选项只有
   `tabSize`/`insertSpaces`（`LspFormattingService.kt:119-125`，本仓 `src/semanticActions.ts:196-204` 同档）
   ⇒ 没有「临时改这份文件风格」的入参通道，不放假意图。
4. **格式化请求的服务器端取消**（`AsyncFormattingRequest`）：要 `$/cancelRequest` 的宿主通道，在 `native/` + `src/bridge.ts`。
5. **本地 `Block`/`Spacing`/`Alignment` 块模型**（`csi/formatter` ①②、`cs/formatting-api` 块那一族）、
   **按列对齐**（`AlignmentInColumnsHelper.java:7-9` 依赖 `TreeUtil`/`IElementType`）、**CLI 批处理**、
   **逐方法生成**：判词与本片复核一致，理由写在 `docs/batch-2026-10-06-refactor.md` §2.2-§2.5 与 §7。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1（树侧删除三选一）** —— 目标 `src/treeActions.ts`（本 lane）+ `src/App.vue`。登记为待办（与 format W1 同一条）。
- **R2（Unwrap 多候选 chooser）** —— 目标 `src/components/CodeEditor.vue`（禁改）。需 CodeEditor owner。
- **R3（Ctrl+Alt+I 自动缩进）** —— 目标 `src/components/CodeEditor.vue`（禁改）+ 桶 5。需对应 owner。

结论：零接线（R1 登记，R2/R3 转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R1 登记，R2/R3 转 owner）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
