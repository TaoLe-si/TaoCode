# 接线请求 · 2026-10-06 · 桶 1（格式化 / 重构域，代号 `format`）

给主代理的线。目标文件都不在本片可改面（保留文件或他桶名下），所以只交代码与坐标，不代改。
本片已完成的部分写在 `docs/batch-2026-10-06-format.md`。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列行号都是本片自己打开文件核对过的）。

---

## W1 · `src/treeActions.ts` + `src/App.vue`：安全删除的「注释与字符串用法账」接进三选一（bucket1b A5 的树侧）

**现状**：`src/treeActions.ts:123-134` 的 `warnBeforeDelete(entry)` 只问语言服务要代码引用，
拿到就 `notify(safeDeleteNotice(...))` 一句话提示，**没算注释/字符串那半本账**，也没有上游的三选一。
（重构菜单/Alt+Delete 那一侧在上一轮已接好：`src/refactorHostAssembly.ts:405-410` 用
`nonCodeReport(...)` + `safeDeletePrompt(...)`，入口 `openSafeDelete`。）

**本片已经做好的模块侧**（`src/safeDelete.ts`，可直接用，不用再写第二份组装）：
- `safeDeletePromptFromFiles(name, refs, files, options?)`（`src/safeDelete.ts:211`）——
  调用方只给 `{path,text}`，注释标记由模块按路径补齐（漏传 `style` 会**静默漏报注释**，
  上一轮 `docs/batch-2026-10-06-wiring1.md` 就记过这个坑）；
  `options.searchInComments` 为假时**一个字都不扫**（上游 `SafeDeleteProcessor.java:457-460` 的那个 `if`）；
- `safeDeleteSearchWord(name)`（`src/safeDelete.ts:190`）—— 词 = 文件名主干；
- 判据：`tests/refactor-safe-delete.test.mjs`（8 条，含 style 缺失的反向用例）。

**上游依据**：
- `platform/lang-impl/src/com/intellij/refactoring/safeDelete/SafeDeleteProcessor.java:447-464`
  （`addNonCodeUsages`：`:459` `addUsagesInStringsAndComments`、`:463` `addTextOccurrences`）；
- `.../safeDelete/UnsafeUsagesDialog.java:35`（标题 `usages.detected`）/`:36`（OK 按钮 `delete.anyway.button`）/
  `:41-45`（`createActions()` = 查看用法 → 仍然删除 → 取消，并把 OK 的 `DEFAULT_ACTION` 置空）/
  `:58`（抬头 `the.following.problems.were.found`）/`:95-98`（`ViewUsagesAction` 带 `DEFAULT_ACTION` ⇒ 回车落它）；
- `platform/refactoring/resources/messages/RefactoringBundle.properties:312/:313/:316/:317/:318`；
- `.../safeDelete/SafeDeleteDialog.java:149/:155`（两个复选框）、`:163-165`（缺省档 ⇒ 本仓 `defaultSafeDeleteOptions()`）。
- 注：bucket1b 请求书与本仓旧注释写的 `SafeDeleteProcessor.java:449-464` 是**签名头两行**的偏移，
  方法实际从 `:447` 起（本片在 `src/safeDelete.ts` 的新注释里已写清并留痕；`src/nonCodeUsages.ts:4` 的旧写法未改，
  那个文件不在本片可改面）。

### 改法 1／3：`src/treeActions.ts`

顶部 import 加一行（`src/treeActions.ts:14` 那句既有的 `safeDelete` import 直接扩写）：

```ts
import { declarationTarget, defaultSafeDeleteOptions, safeDeleteNotice, safeDeletePromptFromFiles,
         type SafeDeletePrompt } from './safeDelete.ts'
import { isSignatureSource } from './refactorSignature.ts'
import type { LspLocation } from './bridge.ts'
```

`TreeActionsDeps`（`src/treeActions.ts:19-58`）加一条（放在 `onSemantic` 之后即可）：

```ts
  /**
   * 删档前有用法账时，由宿主弹出上游 `UnsafeUsagesDialog` 那三选一（查看用法 / 仍然删除 / 取消）。
   * `deleteTarget` 由本模块撤回（树里那个「确认删除」对话框与三选一只留一个，上游就是一张对话框）。
   */
  openSafeDelete: (entry: Entry, prompt: SafeDeletePrompt,
                   target: { line: number; character: number } | null) => unknown
```

`warnBeforeDelete`（`src/treeActions.ts:123-134`）整段替换：

```ts
/** 删除前算「注释与字符串里的字面出现」要读多少份文件（与 `refactorHostAssembly.HOST_SCAN_LIMIT` 同档）。 */
const DELETE_SCAN_LIMIT = 200
/**
 * 删除前的用法账（上游 `SafeDeleteProcessor`）：代码引用来自语言服务，注释/字符串里的字面出现
 * 由本仓文本扫描补齐（`src/nonCodeUsages.ts`）。有账 ⇒ 交宿主的三选一；没账 ⇒ 什么都不说（上游也是直接删）。
 * 语言服务不可用只让代码那一半账为空，**不阻断删除流程**。
 */
async function warnBeforeDelete(entry: Entry) {
  if (!isDesktop || entry.kind !== 'file') return
  let refs: LspLocation[] = []
  let target: { line: number; character: number } | null = null
  if (findTab(entry.path)) {
    await refreshOutline(entry.path)
    const declaration = declarationTarget(entry.path, outline.value)
    if (declaration) {
      target = { line: declaration.startLine, character: declaration.startChar }
      try {
        const result = await request<LspReferencesResult>('lsp.request',
          { kind: 'references', path: entry.path, line: declaration.startLine, character: declaration.startChar })
        refs = result.available ? (result.refs ?? []) : []
      } catch { /* 语言服务不可用：不打扰删除流程 */ }
    }
  }
  const files = await deleteScanFiles(entry.path)
  const prompt = safeDeletePromptFromFiles(baseName(entry.path), refs, files, defaultSafeDeleteOptions())
  if (!prompt.blocked) return
  deps.openSafeDelete(entry, prompt, target)
}
/** 已打开的标签页用编辑器正文（未保存的改动也在里面），其余源码文件读盘；读不到就少扫一份。 */
async function deleteScanFiles(path: string): Promise<{ path: string; text: string }[]> {
  const seen = new Map<string, string>()
  for (const tab of allTabs.value) seen.set(tab.path, editorFor(tab.path)?.text?.() ?? tab.content)
  const entries = workspace.value?.entries ?? []
  const rest = (entries as Entry[]).filter(entry => entry.kind === 'file' && isSignatureSource(entry.path) && !seen.has(entry.path))
  for (const entry of rest.slice(0, DELETE_SCAN_LIMIT - seen.size)) {
    try { seen.set(entry.path, (await request<{ content: string }>('file.read', { path: entry.path })).content) }
    catch { /* 读不到就少扫这一个文件，不猜内容 */ }
  }
  return [...seen].filter(([at]) => isSignatureSource(at) || at === path).map(([at, text]) => ({ path: at, text }))
}
```

（`beginDelete` 那行**不动**，`deleteTarget` 的撤回到改法 2 的宿主回调里做。）

### 改法 2／3：`src/App.vue`

`createTreeActions({ ... })` 的依赖对象里加（`refactorHost` 在 `src/App.vue:952` 之后装配，
若树装配点在前、就用既有的惰性写法 `(...a) => ...`）：

```ts
  openSafeDelete: (entry, prompt, target) => {
    deleteTarget.value = null                       // 三选一取代树里那个「确认删除」
    refactorHost.safeDeleteState.value = { prompt, path: entry.path, target }
  },
```

宿主的三条出口已经现成，不用新写：`safeDeleteChoose`（`src/refactorHostAssembly.ts:424-435`，
「仍然删除」→ `runDelete` → `deps.deleteFile`）、「查看用法」→ `deps.showUsages`、回车默认项 =
`viewUsages`（`src/components/RefactorSafeDeleteDialog.vue` 的 `onKeydown`）。
需要确认的一点：`refactorHost` 的 `deleteFile` 依赖是否覆盖「文件没打开」的情形（树侧选中未打开的文件时
`runDelete` 走的是宿主的 `file.delete` + 刷树，不依赖标签页）。

### 改法 3／3：`tests/safe-delete.test.mjs` 的一条锚点

`tests/safe-delete.test.mjs:56` 钉的是旧那一句提示的形状，替换后它必然红。**不是放松断言**，
是把锚点改指新的落点（同文件其余四条、以及 `beginDelete` / `request<LspReferencesResult>` /
`catch { /* 语言服务不可用：不打扰删除流程 */ }` 三条锚点**都还成立**，本片逐条核过）：

```js
  assert.match(source, /safeDeletePromptFromFiles\(baseName\(entry\.path\), refs, files, defaultSafeDeleteOptions\(\)\)/, '有账就按 safeDeletePromptFromFiles 组装（注释与字符串那半本账算进去）')
  assert.match(source, /if \(!prompt\.blocked\) return/, '一笔用法都没有 ⇒ 不弹框（上游也是直接删）')
  assert.match(source, /deps\.openSafeDelete\(entry, prompt, target\)/, '有账就弹三选一')
```

---

## W2 · `src/components/CodeEditor.vue` + `src/editorCommands.ts`：Unwrap 多候选的 chooser 宿主（bucket1b A6）

**本片已经做好的模块侧**（`src/unwrap.ts`，判据 `tests/refactor-unwrap-chooser.test.mjs` 6 条）：
`UNWRAP_CHOOSER_TITLE`、`unwrapChooserItems(candidates)`、`unwrapChooserNeeded(candidates)`、
`unwrapEditIntact(text, edit)`、`createUnwrapApplyCommand(edit)`。

**上游依据**：
- `platform/lang-impl/src/com/intellij/codeInsight/unwrap/UnwrapHandler.java:80-91`（`selectOption`：
  空列表什么都不做；`showOptionsDialog()` 为真就 `showPopup`，**只有单元测试模式**才直接 `options.get(0).perform()`）、
  `:93-121`（`showPopup`：`:101` 标题、`:104` 单选、`:107` 选中即执行、`:108` 选中行高亮作用域）、
  `:125`（`MyItem(name, index)`）、`:153-171`（`perform()`）；
- `UnwrapDescriptorBase.java:33-47`（候选由内向外 ⇒ 最内层在前）、`:67-69`（`showOptionsDialog()` 恒真）；
- `platform/lang-api/resources/messages/CodeInsightBundle.properties:52` = `Choose the statement to unwrap/remove`
  （`:53-61` 是逐条行文本 `unwrap.if` / `unwrap.braces` / `unwrap.with.placeholder`，
  由 `java/java-impl/src/com/intellij/codeInsight/unwrap/JavaIfUnwrapper.java:28`、
  `JavaBracesUnwrapper.java:18` 取键）。
- 键位：`$default.xml:918-920`（`Unwrap` = control shift DELETE）。

**要接的三条线**：

1. `src/editorCommands.ts:233` 现在挂的是 `unwrapCommand`（直接拆最内层）。改成把候选交给宿主：

```ts
// Unwrap/Remove（Ctrl+Shift+Delete，$default.xml:918-920）：候选列表与「拆哪一层」的判据在 src/unwrap.ts。
// 上游 `UnwrapHandler.java:80-91` 是非空列表一律弹层；本仓先保留「只有一条直接拆」的现状（见请求书差异说明）。
export function createUnwrapCommand(indentWidth: number, choose?: (items: UnwrapChooserItem[]) => void): Command {
  return view => {
    const text = view.state.doc.toString()
    const range = view.state.selection.main
    const candidates = findUnwrapCandidates(text, range.from, range.to, indentWidth)
    if (!unwrapChooserNeeded(candidates)) return false
    if (candidates.length === 1 || !choose) return createUnwrapCommandInner(candidates[0]!.edit)(view)
    choose(unwrapChooserItems(candidates))
    return true
  }
}
```

（`createUnwrapCommandInner` 就是既有的 `createUnwrapCommand` 体内那段 dispatch；本片给的
`createUnwrapApplyCommand(edit)` 可以直接当它用，不必再复制。）

2. `src/components/CodeEditor.vue`：`unwrap` 这条 `editorActions` 行（与 `Ctrl-Shift-Delete` 那处 keymap）
   改成传 `choose`，把 items 用 `emit('unwrapChooser', items)` 抛给宿主（emits 声明在 `CodeEditor.vue:95`，
   `indentWidth` 取编辑器设置的 `tabSize`，与 `unwrap.ts:49` 的兜底 4 同一口径）。

3. `src/App.vue`：`@unwrap-chooser` 的弹层。骨架可照 `src/components/RefactorSafeDeleteDialog.vue`
   （同一个 `.command-palette` + `.safe-delete-list` 那套），标题用 `UNWRAP_CHOOSER_TITLE`，
   每行文本用 `items[i].label`，选中后
   `editorFor(path)?.applyCommand(createUnwrapApplyCommand(candidates[i].edit))`；
   落笔前的偏移回验由 `unwrapEditIntact()` 在命令里做（站不住就返回 false，不吞键）。

**两处如实差异，接的时候要一起决定**：
- 上游**只有一条候选也弹层**（`UnwrapHandler.java:80-91`），本仓现状是直接拆。要按上游改的话，
  `src/editorCommands.ts` 那行去掉 `candidates.length === 1` 分支即可；`tests/unwrap.test.mjs` 里
  钉「`unwrapCommand` 直接拆最内层」的断言要同步改（那两个文件都不是本片可改面）。
- 行文本：上游是 `Unwrap 'if...'` 这一族（`CodeInsightBundle.properties:53-61`），本仓既有口径是
  「拆掉 if 包裹」，且被 `tests/unwrap-candidates.test.mjs:22` 逐字钉住。本片**没有**改标签、也没放松那条断言；
  要换成上游文本的话，得连那个测试一起改（属桶 5 / appvue 的文件面）。

---

## W3 · 代码风格的两处「设置面没有」：`src/components/SettingsDialog.vue`（+ 设置树）

模块侧都已经做完并且生产可调用，缺的只是页面上那一个控件；不放假控件 ⇒ 没页面就一直改不动。

1. **「不格式化」glob 清单**（上游 `CodeStyleSettings.EXCLUDED_FILES` /
   `platform/lang-impl/src/com/intellij/formatting/ExcludedFileFormattingRestriction.java:16-25`）：
   写入口 `setFormatExcludedPatterns(text): number`（`src/formattingRestriction.ts:47`）、
   读 `formatExcludedPatterns`（同文件 `:41`），存 localStorage 键 `taocode.formatterExcluded`。
   消费链路已通（`src/semanticActions.ts` 的 `runFormatting` 在发请求前问一次）。
   ⇒ 设置页「编辑器 › 代码风格 › 格式化程序」加一个多行文本框，初值
   `formatExcludedPatterns.value.join('\n')`，保存调 `setFormatExcludedPatterns(...)` 并提示条数。
2. **「行注释前补空格（重排时）」**（上游
   `platform/code-style-impl/src/com/intellij/formatting/LineCommentAddSpacePostFormatProcessor.kt:25-27`，
   默认值 `CommonCodeStyleSettings.java:261` `LINE_COMMENT_ADD_SPACE_ON_REFORMAT = false`；
   设置页文案键 `ApplicationBundle.properties:667` `checkbox.line.comment.add.space.on.reformat`）：
   写入口 `setPostFormatSettings({ lineCommentAddSpaceOnReformat })`（`src/codeStyleSettings.ts:118`）、
   读 `postFormatSettings`（同文件 `:113`），缺省 **false**（上游默认，不落盘也等于默认）。
   消费链路已通（`src/semanticActions.ts:236`）。
   ⇒ 同一页加一个复选框，缺省不勾。
3. 顺带：`codeStyleToggles`（`autodetectIndents` / `editorConfigEnabled`，`src/codeStyleSettings.ts:92/:94`）
   同样只有模块侧、没有页面。上游键：`CodeStyleSettings.java:193`（`AUTODETECT_INDENTS = true`）、
   `plugins/editorconfig/backend/src/settings/EditorConfigSettings.java:12`（`ENABLED = true`），两个都**默认开**。
   ⇒ 判词 `docs/inventory/verdict-platform_rest.md` 里「`cs/settings` 缺 .editorconfig / 缺文件级缩进探测」**已不成立**
   （`src/editorConfig.ts` + `src/indentDetection.ts` + `resolveIndentOptions` 三件都在，
   并被 `src/semanticActions.ts` 的格式化路径真实消费）；剩下的只有这一条「页面没挂」。

三条都是**纯前端 localStorage**，不要新增持久化设置键（新增键要按 §「旧存档缺键要补默认」走
`native/settings_schema.*` + `src/bridge.ts` 三道口子，本片没有动它们）。

---

## W4 · `src/actionsOnSave.ts`：保存时格式化绕过了格式化那一整套本地闸

`src/semanticActions.ts` 的 `runFormatting()` 一条路走完：准入限制 → 请求 → **`@formatter:off` 区间过滤**
（`filterFormatEdits`，`src/formatterTags.ts:136`）→ 快照合并（`src/formattingMerge.ts`）→
**后处理**（`processLineCommentAddSpace`，`src/postFormatProcessors.ts:53`）。

而保存时那条（`src/App.vue:1070-1078` → `runActionsOnSave`，`src/actionsOnSave.ts:51-65`）
是**第二次独立实现**：直接 `applyTextEdits(input.content, file.textEdits)`，三件事都没做：

| 漏了 | 用户可见后果 | 上游依据 |
|---|---|---|
| `filterFormatEdits` | 标了 `@formatter:off` 的文件，保存时照样被整段重排 | `platform/code-style-impl/src/com/intellij/formatting/FormatterTagHandler.java:70-106`（禁用区间不重排） |
| `formattingRestrictionFor` | 「不格式化」清单里的文件保存时仍发请求 | `platform/lang-impl/src/com/intellij/formatting/ExcludedFileFormattingRestriction.java:16-25` |
| `processLineCommentAddSpace` | 开了「行注释前补空格」后，只有 Ctrl+Alt+L 生效、保存时不生效 | `LineCommentAddSpacePostFormatProcessor.kt:22-50` |

改法（`src/actionsOnSave.ts:55-60` 那段，把 `input.content` 当基线文本）：

```ts
    const formatted = await input.format()
    const file = formatted.edits?.find(entry => entry.path === input.path)
    if (!file?.textEdits.length) return { content: input.content, changed: false }
    // 与 `runFormatting` 同一套本地闸：禁用区间内的编辑整条丢掉，再补一遍行注释空格。
    const edits = filterFormatEdits(input.content, file.textEdits)
    const merged = applyTextEdits(input.content, edits)
    const next = processLineCommentAddSpace(merged, { start: 0, end: merged.length }, postFormatSettings.value).text
    return { content: next, changed: next !== input.content }
```

外加 `runFormatting` 那条准入判定（在 `App.vue` 的 `format` 回调里先问
`formattingRestrictionFor(tab.path)`，被挡就整段跳过）。imports：
`filterFormatEdits` 来自 `./formatterTags.ts`、`processLineCommentAddSpace` 来自 `./postFormatProcessors.ts`、
`postFormatSettings` 来自 `./codeStyleSettings.ts`、`formattingRestrictionFor` 来自 `./formattingRestriction.ts`。
判据建议加在 `tests/save-transforms.test.mjs`（已有文件）：给定一段带 `// @formatter:off` 的文本，
断言保存链路的输出与 `runFormatting` 的一致（现测试不覆盖这三闸 ⇒ 反向验证时先注入再看红）。

---

## 本片**没做**、也不该由本片做的

- `src/App.vue` / `CodeEditor.vue` / `editorCommands.ts` / `actionsOnSave.ts` / `treeActions.ts` /
  `SettingsDialog.vue` / `nonCodeUsages.ts` / `commentToggle.ts` —— 都不在本片可改面（保留文件或他桶名下）。
- 「把搜索注释/字符串当 rename 入参传给语言服务」：LSP 协议没有这个字段，做不了（bucket1b「不做」第 1 条，
  本片复核：`src/bridge.ts:176` 的 `LspRequestKind` 里没有任何带该入参的通道）。
- 按列对齐（`AlignmentInColumnsHelper` 一族）、`FormattingModel`/`Block`/`Spacing` 本地重排引擎、
  `changeSignature` 的调用者层级选择器（`createCallerChooser`）：都要 PSI，本仓按 `[-]` 处理。
