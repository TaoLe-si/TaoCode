# 接线请求 · 桶 2c（补全 / 内联补全 / 意图）· 2026-10-06

按 `docs/batches-2026-10-06-buckets.md` §4 的格式。本轮**没有**改任何保留文件；下面 5 条都要动保留文件或别人名下的落点。
行号是 2026-10-06 现树实测（工作区在并发变动中，落地前请重读目标区域）。

---

## W1 · Code 菜单的三条补全动作（**2026-10-06 二次核对后订正**：不是"有行无动作"，是"有行但走错入口"）

> **订正（本轮实测，别再照原文去接）**：`src/components/CodeEditor.vue:717` 已经有 `completion: startCompletion`
> （`@codemirror/autocomplete` 自带的那个），所以这一行点了**能**开弹层，不是假控件。
> 真正的差是：菜单这一路**不登记补全轮次**（`completionRoundActive` / `reopeningViews` / `beginCompletion` 只在键位那一路跑，
> `src/completionUi.ts:33,25,52-72`），于是「开着再按一次让 `invocationCount` 递增」那一档（`CodeCompletionHandlerBase.java:210-213`）
> 从菜单进入时永不生效。另外 `smartTypeCompletion` / `classNameCompletion` 这两个 id 在全仓 `src/**` 里 **0 命中**
> ⇒ 上游另两条菜单项在本仓是"没有行"，不是"有行无动作"；要不要加行属桶 1 的 `src/menus/codeMenu.ts`。

### 可照抄的整段替换（`src/components/CodeEditor.vue` 的 `editorActions`，第 705-717 行那张表）

import 并入现有那行（`:30` 已经是 `import { completionUi } from '../completionUi'`）：

```ts
import { completionUi, startCompletionAs } from '../completionUi'
```

表里把这一行：

```ts
  completion: startCompletion,
```

替换成：

```ts
  // 菜单与键位走同一个入口：`startCompletionAs` 会登记补全轮次（上游 `CodeCompletionHandlerBase.java:210-213`
  // 的「再按一次 invocationCount++」靠这份状态），CodeMirror 自带的 `startCompletion` 没有这一档。
  completion: editor => startCompletionAs(editor, 'basic') || startCompletion(editor),
```

若桶 1 决定补上另两条菜单行（`src/menus/codeMenu.ts:33` 之后），同一张表里加两行即可，模型侧不需要新代码：

```ts
  smartTypeCompletion: editor => startCompletionAs(editor, 'smart'),
  classNameCompletion: editor => startCompletionAs(editor, 'className'),
```

### 原文（保留作历史，行号已过期处以上面为准）

- 目标文件：`src/components/CodeEditor.vue` 第 698 行附近那张 `editorActions`（给菜单用的扁平动作面，`EditorHandle.command(name)` → `runEditorCommand(view, editorActions, name)`，见 `:433`）；
  菜单行在桶 1 名下 `src/menus/codeMenu.ts:33`（`ctx.editable('completion', '代码补全', 'Ctrl Space', …)`，**目前 `actionRegistry`/`App.vue` 里查不到 `completion` 这个 id 的 run** ⇒ 这一行点了没有动作）。
- 要接什么：`startCompletionAs(view, mode)`（新导出，`src/completionUi.ts:41-72`）
  ⇒ `codeCompletion` → `startCompletionAs(view, 'basic')`
  ⇒ `smartTypeCompletion` → `startCompletionAs(view, 'smart')`
  ⇒ `classNameCompletion` → `startCompletionAs(view, 'className')`
  （`startBasicCompletion(view)` 就是 BASIC 那一层皮，`src/completionUi.ts:74-76`。）
- 为什么需要：上游这三条是**动作**，既能按键也能从菜单/Find Action 走；本仓现在只有按键那一条通路（`basicCompletionKeys`），菜单那一行是空的 ⇒ 要么是假控件，要么缺入口。按键那半区本轮已经补齐并且判据在 `tests/completion-mode-keys.test.mjs`。
- 上游依据：`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:115-132`（`CodeCompletionGroup` 从 `:133` 起）、`:133-147`；
  `platform/platform-resources/src/keymaps/$default.xml:732-734`（CodeCompletion）、`:909-911`（SmartTypeCompletion）、`:843-845`（ClassNameCompletion）；
  动作类 `platform/lang-impl/src/com/intellij/codeInsight/completion/actions/CodeCompletionAction.java:12-17`、`SmartCodeCompletionAction.java:11-17`、`ClassNameCompletionAction.java:11-17`。

## W2 · 「打开的编辑器」表改由宿主登记（跨文件词补全的完整性）

- 目标文件：`src/App.vue` 第 164-172 行（`editorRefs` / `setEditorRef` / `forgetEditorRefs`）与第 1707、1716 行（关标签处）。
- 要接什么：编辑器挂载/换内容时调 `registerOpenEditor(path, () => handle.text())`、关标签时调 `unregisterOpenEditor(path)`、换工程时 `clearOpenEditors()`（三个导出都在 `src/completionOpenEditors.ts:17-38`）。
- 为什么需要：这张表就是上游 `FileEditorManager.getAllEditors()` 的等价物，Alt+/ 走完当前文档要换到**别的打开文档**接着找词（`platform/lang-impl/src/com/intellij/codeInsight/completion/actions/HippieWordCompletionHandler.java:270-278`）。本轮生产者只能挂在补全查询上（`src/lspCompletion.ts:183-189`，`CodeEditor.vue` 是保留文件、编辑器扩展里拿不到 `props.path`）⇒ **只有至少被查过一次补全的标签**才在表里；关标签也没有注销时机（现在靠"正文取不到就当场摘掉"兜底，`src/completionOpenEditors.ts:47-53`）。宿主登记后这两条才真正对齐上游。
- 上游依据：`HippieWordCompletionHandler.java:271-278`（遍历 `getAllEditors()`、`instanceof TextEditor`、`:274` 的 `anotherEditor != editor`）。

### 可照抄的整段替换（`src/App.vue:165-173` 那一小段，净 +3 行）

```ts
import { clearOpenEditors, registerOpenEditor, unregisterOpenEditor } from './completionOpenEditors.ts'
```

```ts
const editorRefs = new Map<string, EditorHandle>()
// 「打开的编辑器」表 = 上游 FileEditorManager.getAllEditors() 的等价物（HippieWordCompletionHandler.java:271-278）：
// Alt+/ 走完当前文档要换到**别的打开文档**接着找词。宿主登记才是真口径（此前只能靠补全查询顺手登记）。
function setEditorRef(pane: Pane, path: string, element: unknown) {
  const key = `${pane}:${path}`
  if (element) { editorRefs.set(key, element as EditorHandle); registerOpenEditor(path, () => (element as EditorHandle).text()) }
  else editorRefs.delete(key)
}
function editorFor(path: string) { return editorRefs.get(`0:${path}`) ?? editorRefs.get(`1:${path}`) }
function forgetEditorRefs(path: string) { editorRefs.delete(`0:${path}`); editorRefs.delete(`1:${path}`); unregisterOpenEditor(path) }
```

换工程 / 关工作区那一处的清表时机**没有现成钩子**（本轮实测：`src/App.vue` 里 `editorRefs` 只有 `:165` 的声明与
`:169-173` 的 set/delete，**不存在 `editorRefs.clear()`**）⇒ `clearOpenEditors()` 要挂在真正重置 tabs 的那里
（`workspaceEpoch` / `bufferEpoch` 变化、或换工作区把 `groups` 整张表重建的那一段），落地时按那一处插一行即可；
三个导出都在 `src/completionOpenEditors.ts:20,26,31`，`EditorHandle.text()` 在 `src/editorTab.ts:14`。

## W3 · 行内补全的悬浮操作条（来源名 / 接受 / 隐藏）

- 目标文件：`src/components/CodeEditor.vue` 第 880-900 行那段（幽灵文本 widget 与 Tab/Esc 的宿主处）。
- 要接什么：一个 tooltip 宿主，内容 = 当前建议的来源名 + 「接受」/「隐藏」两个动作；数据与动作本仓都有现成的：建议身份 `src/inlineCompletionNav.ts`（`suggestionKey` 一族）、接受 `src/inlineCompletionExtension.ts:99`（`acceptInlineSuggestion`）、按词/按行 `:131`（`acceptInlineSuggestionPartially`）、收起 `src/inlineCompletion.ts:88`（`shouldDismissInlineSuggestion`）。图标走 `lucide-vue-next` + `iconSize.*`，不自加动效。
- 为什么需要：判词里这一族明确缺这个操作条；挂点在保留文件里，本轮不做假控件。
- 上游依据：`platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/tooltip/InlineCompletionTooltip.kt:37`（`fun show(session: InlineCompletionSession)`）、`:110`（`InlineCompletionTooltipHint`）；同目录 `InlineCompletionTooltipActions.kt:7`（onboarding 组件）、`InlineCompletionTooltipComponent.kt`、`InlineCompletionTooltipFactory.kt`。

## W4 · 行内补全的按 provider 开关 / `options` 设置页

- 目标文件：`src/settingsModel.ts`（存储）+ `src/components/SettingsDialog.vue` 的行内补全区（渲染）。
- 要接什么：一条"行内补全 provider 启停"的开关（本仓当前只有 LSP 一条供给），键位与文案照上游 `options/` 那张页；纯规则侧不需要新代码。
- 为什么需要：判词把 `options` 设置页列为缺项；存储面在保留文件里。
- 上游依据：`platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/options/InlineCompletionConfigurable.kt` 与 `options/InlineCompletionConfigurableEP.kt`（扩展点宿主本身在本仓没有对应物 ⇒ 只能做成一条固定开关，不要照抄 EP 结构）。

## W5 · 问题面板逐行的「抑制」入口（2b 面）

- 目标文件：`src/components/ProblemsPanel.vue`（桶 2 的 2b 半区，本轮未改）。
- 要接什么：每行的次级动作调 `suppressionActionsFor({ path, text, diagnostics })`（`src/localIntentions.ts`），条目形状与 Alt+Enter 里用的完全一致（`src/semanticActions.ts` 已经把本地条目与 LSP 条目并进同一个弹层）。
- 为什么需要：`lp/intention` 判词里唯一的剩余缺口就是"抑制条目只能从编辑器 Alt+Enter 出，问题面板没有逐行入口"；条目侧 API 已就位，面板在别的子轮名下。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/intention/impl/SuppressIntentionAction.java` 一族（意图与快速修复同源，问题面板的逐行灯泡走的也是 `ShowIntentionsPass`）。

---

## 需要人复核的一件事（不是请求，是警报）

`src/completionUi.ts` 本轮被**外部并发修改**过一次：我写的 `revision: view.state.changeCount` 被改成 `view.state.seq` —— 两者在 `@codemirror/state` 的 `EditorState` 上**都不存在**（`node_modules/@codemirror/state/dist/index.d.ts` 里两个名字都搜不到），会是一个编译期就炸、跑起来才暴露的坑。我改成用 `EditorState.doc` 的**对象身份**当上游那个 `modificationStamp`（不可变 `Text`，改一次换一个新对象；判据 `tests/cyclic-word-completion.test.mjs` 的「文档改动号变了 = 新一轮」）。同一次外部改动里的 `EditorSelection.create(...)` 是合法 API，我保留了。
