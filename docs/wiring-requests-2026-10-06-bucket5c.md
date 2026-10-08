# 接线请求 —— 桶 5c（回车家族 / 注释，2026-10-06）

本轮我只改了自己归属的文件；下面两处要挂在**保留只读**文件上，请主代理落。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。

---

## 1.（必须）`src/components/CodeEditor.vue:114-118`：把块注释词法喂进回车家族

**现状**：语言工厂只给了 `{ line }`，没给 `block` ⇒
`src/enterHandlers.ts:236-249` 的第②步（`EnterInBlockCommentHandler` 那一条，块注释里 `* ` 续行 /
没闭合就补 `*/`）在真实编辑器里**永远问不到** —— 模块与判据都在（`src/editorEnterBlockComment.ts`、
`tests/editor-enter-block-comment.test.mjs` 13 条），差这一根线。

**上游依据**：
- `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInBlockCommentHandler.java:38-39`
  —— 先要语言有 `CodeDocumentationAwareCommenter`，没有就 `Result.Continue`；这个 commenter 提供的
  正是 `getBlockCommentPrefix/Suffix` + `getDocumentationCommentPrefix` + `getDocumentationCommentLinePrefix`。
- `java/java-psi-impl/src/com/intellij/lang/java/JavaCommenter.java:27-28`（`/*`）、`:32-33`（`*/`）、
  `:62-63`（`/**`）、`:67-68`（`*`）—— 四件套的对应关系。
- `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1161-1162` —— 这一条的注册（`id="blockComment"`）。

**需要的 import**（`src/components/CodeEditor.vue` 现有 import 段，第 77 行 `smartEnterCommand` 那行旁边）：

```ts
import { blockLexiconFor } from '../editorEnterBlockComment'
```

**整段替换**（目标：`src/components/CodeEditor.vue:112-118`，现在是这一段）：

```ts
// 回车：上游那三条先问，都不接管时交回 CodeMirror 的 `insertNewlineAndIndent`（见 src/enterHandlers.ts 头）。
// 行注释前缀取语言数据（`commentTokens`），没有语言数据时按扩展名查表 —— 与注释切换同一个来源。
const smartEnter = smartEnterCommand(() => {
  const editor = view
  const style = editor ? commentStyleFromState(editor.state, editor.state.selection.main.head) : null
  return { line: (style ?? commentStyleFor(undefined, props.path))?.line }
})
```

替换为：

```ts
// 回车：上游那四条先问，都不接管时交回 CodeMirror 的 `insertNewlineAndIndent`（见 src/enterHandlers.ts 头）。
// 行注释前缀取语言数据（`commentTokens`），没有语言数据时按扩展名查表 —— 与注释切换同一个来源。
// 块注释那一半（`EnterInBlockCommentHandler.java:38-39` 要的 `CodeDocumentationAwareCommenter`）也在这儿给：
// 不给 `block` 就等于第②步永远不问（`JavaCommenter.java:27-28/:32-33/:62-63/:67-68` 的四件套由
// `blockLexiconFor` 按同一对应关系翻一次；块前缀不是 `/*` 的语言它只给 block，续行那一支自然退出）。
const smartEnter = smartEnterCommand(() => {
  const editor = view
  const style = editor ? commentStyleFromState(editor.state, editor.state.selection.main.head) : null
  const base = style ?? commentStyleFor(undefined, props.path)
  return { line: base?.line, block: blockLexiconFor(base) }
})
```

**落点已备好**：`blockLexiconFor` 在 `src/editorEnterBlockComment.ts:54-60`，判据在
`tests/editor-enter-block-comment.test.mjs:22-32`；`EnterLanguage.block`（`src/enterHandlers.ts:64-66`）
已经是这一族现成的入参，无需再改我的文件。
**验收**：接一个 Java/TS 文件，在 `/*abc`（没闭合）行尾按 Enter ⇒ 补出缩进 + ` */` 并普通换行；
在多行 `* ` 注释里按 Enter ⇒ 光标处补 `* ` 并停在它之后。

---

## 2.（可选，不做也不影响用户可见行为）`CLOSE_COMMENT_ON_ENTER` 开关

上游把它当设置项：`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`
（默认 `true`；同文件 `:129` `SMART_INDENT_ON_ENTER`、`:130` `INSERT_BRACE_ON_ENTER` 是另两条回车开关）。
**本仓现在按上游默认值 `true` 走**（`enterInBlockComment(text, caret, lexicon, closeOnEnter = true)`，
`src/editorEnterBlockComment.ts:176-178`），没有渲染任何假开关，判据也已钉住
（`tests/editor-enter-block-comment.test.mjs:93-97`：关掉 ⇒ 返回 null）。

要露这个开关的话需要三处协同，第 3 处是我自己的文件、我可以随后补：

1. `src/settingsModel.ts:274` 的 `export interface EditorSettings` 末尾加一条：

```ts
  /** IDEA `CodeInsightSettings.CLOSE_COMMENT_ON_ENTER`（`platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`，默认 true）：块注释没闭合时回车自动补闭尾。 */
  closeCommentOnEnter: boolean;
```

2. `src/settingsModel.ts:223` 的 `defaultEditorSettings` 加 `closeCommentOnEnter: true`；
   `src/components/CodeEditor.vue:909` 那条 `{ key: 'Enter', … run: smartEnter }` 所在的
   `smartEnterCommand(() => …)` 工厂（见第 1 条）多返回一个字段：

```ts
  return { line: base?.line, block: blockLexiconFor(base), blockCloseOnEnter: props.settings.closeCommentOnEnter }
```

3. 我在 `src/enterHandlers.ts` 的 `EnterLanguage` 加 `blockCloseOnEnter?: boolean`（`undefined` 按上游默认
   `true`），并把 `:240` 的调用改成
   `enterInBlockComment(doc.toString(), selection.head, block, lexicon.blockCloseOnEnter ?? true)`。
   —— **在设置键真的存在之前我不先加这个字段**（避免留一个没人设的死旋钮）。

---

## 3. 本轮没有向下列文件伸手（确认只读边界）

`src/App.vue`、`src/style.css`、`src/tokens.css`、`src/uiIcons.ts`、`src/settingsTreeMeta.ts`、
`src/bridge*.ts`、`src/keymap.ts`、`src/keymapBindings.ts`、`src/actionRegistry.ts`、
`src/menus/types.ts`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、
`CMakeLists.txt`、`package.json`、`tsconfig.json` —— 均未改动，也没有改动它们的需要。

## 处理结果（wiring-backlog lane，2026-10-06）

- **1（块注释词法喂进回车家族）已接线**：`src/enterHandlers.ts:140` 已走 `block: blockLexiconFor(style ?? undefined)`（块词法从语言工厂透出），`:169` 已带 `blockCloseOnEnter`。
- **2（`CLOSE_COMMENT_ON_ENTER` 开关）已接线**：`src/settingsModel.ts:473` 已有 `closeCommentOnEnter: boolean`（默认 `true`），`src/enterHandlers.ts:112/:169/:501` 已消费 `blockCloseOnEnter ?? true`。
- **3** —— 只读边界确认。

结论：**零待接**（1/2 均已在真实链路），未改任何文件。
