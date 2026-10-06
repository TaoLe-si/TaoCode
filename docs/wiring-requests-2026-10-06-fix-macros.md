# wiring requests · fix-macros（2026-10-06）

本文件的每一条都是**实时模板宏**里「上游有、本仓接不上」的那 12 条（清单与理由在
`src/templateMacros.ts:481-494`，对账门禁在 `tests/template-macro-registry.test.mjs:103-113`）。
目标文件全都不在本代理可改面（`src/App.vue`、`src/components/CodeEditor.vue`、`src/keymap*.ts`、
`src/commentToggle.ts`、`docs/inventory/citation-anchors.json`），所以只写请求 + 可照抄代码，不动手。

口径先说清：**这几条宏在没有下列挂点之前，本仓不实现、不渲染**（规约 §3）。
挂点落地时，请把 `src/templateMacros.ts` 的 `DEFERRED_TEMPLATE_MACROS`（`:481-494`）里对应那条**删掉**、
把 `LIVE_TEMPLATE_MACROS`（`:402-477`）加上实现，然后跑
`node --test tests/template-macro-registry.test.mjs` —— 那条门禁要求「实现侧 + 登记侧 = 上游那 33 条」，
两边同时存在或同时缺失都会红，不会让挂点和宏漂开。

---

## W-1 · 给宏上下文加「展开点行号」与「项目根」两个字段（解锁 `lineNumber`、`fileRelativePath`）

- 目标文件与行号：
  - `src/templateMacros.ts:70-78`（`TemplateMacroContext`，本代理可改，**等这条被批准我再改**）
  - `src/templates.ts:220-231`（`expand()` 的签名与 `const macroContext: TemplateMacroContext = { path }`，本代理可改）
  - `src/components/CodeEditor.vue:577`（**只读**，调用点）
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/LineNumberMacro.java:20-25`
  （`context.getStartOffset()` → `editor.offsetToLogicalPosition(offset).line + 1`）；
  同目录 `FilePathMacroBase.java:81-84`（相对路径要 `FqnUtil.getVirtualFileFqn(virtualFile, project)`，即项目 + 源根）。
- 请照抄的替换（CodeEditor.vue 的 577 那一行，其余不动）：

```ts
// 原来：
const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)
// 改成（line 已经是 view.lineAt(head) 的结果，CodeMirror 的 Line.number 是 1 起的）：
const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates,
  { line: line.number, projectRoot: props.projectRoot ?? '' })
```

- `src/templates.ts` 那两处的配套改法（同一批里由我改，或主代理顺手改）：

```ts
// expand() 参数表最后加一个可选项（默认值保证 tests/templates.test.mjs 与既有调用点不破）：
  plugins: readonly PluginTemplateSource[] = [],
  macro?: { line?: number; projectRoot?: string },
): Expansion | null {
  …
  const macroContext: TemplateMacroContext = { path, line: macro?.line, projectRoot: macro?.projectRoot }
```

```ts
// src/templateMacros.ts 的 TemplateMacroContext 增两个可选字段（注释按上游口径写）：
export interface TemplateMacroContext {
  readonly path: string
  /** 展开点的 1 起行号（`LineNumberMacro.java:22-24` 的 offsetToLogicalPosition(起点).line + 1）。 */
  readonly line?: number
  /** 项目根，`fileRelativePath` 用它把绝对路径削成相对（`FilePathMacroBase.java:82-84` 的等价物）。 */
  readonly projectRoot?: string
  readonly now?: () => Date
}
```

- 落地后新增的判据（我来写，主代理只需批准挂点）：`lineNumber` 出 `"1"`（行号 1 起，不是 0 起）、
  `fileRelativePath` 在 `projectRoot` 缺失时是空串而不是半截路径。

---

## W-2 · 剪贴板要在展开**之前**取，不能在宏里 `await`（解锁 `clipboard`）

- 目标文件与行号：`src/keymap.ts` / `src/keymapBindings.ts`（Tab 展开那条动作，**只读**）、
  落点仍是 `src/components/CodeEditor.vue:577`（同 W-1 的那一行）。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/ClipboardMacro.java:15`（`super("clipboard")`，
  其 `calculateResult` 同步读 `Toolkit` 剪贴板）；本仓的对应通道是 `src/clipboard.ts:52` 的
  `export async function readClipboardText(): Promise<string>` —— **异步**。
- 为什么不能只在宏里等：`render()` 与 CodeMirror 的 Tab 处理都必须同步返回一段文本，
  在 `TemplateMacro.calculate` 里 `await` 会把整条展开链变成异步，键位层的返回值（`boolean`）就断了。
- 请照抄的形状（在键位层先取料、再同步展开）：

```ts
// keymap 层（示意；具体行由主代理定，因为 Tab 的分派在 CodeEditor.vue 的 keymap 扩展里）：
const pendingClipboard = readClipboardText().catch(() => '')   // 焦点进入编辑器时预热
// 展开点（同 W-1 那一行）多带一个已解析好的字符串：
{ line: line.number, projectRoot: props.projectRoot ?? '', clipboard: lastClipboard }
```

```ts
// TemplateMacroContext 再加一个字段（与 W-1 同一批落）：
  /** 展开前预热好的剪贴板文本；没预热到就是空串（上游同步读，本仓拿不到「当下」）。 */
  readonly clipboard?: string
```

- 这条如果不做，请保持现状：`clipboard` 留在 `DEFERRED_TEMPLATE_MACROS`，设置页不渲染它（现在就是不渲染的）。

---

## W-3 · 模板收尾后还要再跑一个编辑器动作（解锁 `complete`、`completeSmart`、`showParameterInfo`）

- 目标文件与行号：`src/templates.ts:240-248` 一带的 `Expansion` 返回形状（本代理可改，等批准）、
  `src/components/CodeEditor.vue:578-590`（dispatch 之后那段，**只读**）、
  以及 `src/editorCommands.ts` 里现成的补全/参数信息入口（**只读**）。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/BaseCompleteMacro.java:58-63`
  （`calculateResult` 返回 `InvokeActionResult(() -> invokeCompletion(context))`）与
  `:65-90`（真正执行时先 `invokeLater`、再查当前有没有补全在跑、最后拉起 handler）；
  `ShowParameterInfoMacro.java:30-33` 同形，其 `:36-43` 明确「先 `finishTemplate` 再 `ShowParameterInfoHandler.invoke`」。
- 也就是说：这类宏**不产出文本**，而是「模板结束后做什么」。本仓现在的 `Expansion` 只有
  `{ start, end, text, stops }`，没有「结束后动作」这一格，所以宏无处安放。
- 请照抄的最小形状：

```ts
// src/templates.ts：Expansion 增一个收尾动作（默认 undefined ⇒ 既有调用点与用例一字不改）
export type TemplateAfterInsert = 'complete' | 'completeSmart' | 'parameterInfo'
export interface Expansion { start: number; end: number; text: string; stops: Stop[]; after?: TemplateAfterInsert }
```

```ts
// src/components/CodeEditor.vue（577 那一行之后，dispatch 完再看要不要收尾动作）：
if (result.after === 'parameterInfo') queueMicrotask(() => triggerParameterInfoAt(view, from))
else if (result.after) queueMicrotask(() => triggerCompletionAt(view, from, result.after === 'completeSmart'))
```

（`triggerParameterInfoAt` / `triggerCompletionAt` 请复用 `src/editorCommands.ts` 已有的那两个入口，别新造。）

- 落地前这 3 条宏继续留在登记侧；**不要**先给它们放假实现（比如返回空串），那会让上游「不产出文本」的语义
  在本仓变成「产出一个空槽位」，用户看到的是模板少了内容。

---

## W-4 · 把注释标记表抽成纯数据模块（解锁 `lineCommentStart`、`blockCommentStart`、`blockCommentEnd`、`commentStart`、`commentEnd`）

- 目标文件与行号：`src/commentToggle.ts:24-25`（`import { EditorSelection, type EditorState } from '@codemirror/state'`
  与 `@codemirror/view` —— 就是这两行让整张表对模板层不可用）、`:69`（`export function commentStyleFor(...)`，
  纯函数、不碰 CodeMirror，**要搬的就是它和它的表**）。`src/commentToggle.ts` 不在本代理可改面。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/CommentMacro.java:21-27`
  （`super(name, name + "()")`，presentable 就是名字加括号）与 `:38-67` 的五个子类
  （`lineCommentStart`、`blockCommentStart`、`blockCommentEnd`、`commentStart`、`commentEnd`，
  每个只是从 `Commenter` 上取一个方法）；注册见
  `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1058-1062`。
- 请求：新建 `src/commentStyles.ts`（纯数据：`CommentStyle` 类型 + 语言→标记表 + `commentStyleFor`），
  `src/commentToggle.ts` 改为从它 import 并**只留**CodeMirror 那半（`commentStyleFromState` 等）。
  这样 `src/templateMacros.ts` 就能 value-import `commentStyleFor`，而不把 `@codemirror/state` 拖进
  `src/templates.ts` 的依赖图（那个图现在必须保持无 CodeMirror，`tests/templates.test.mjs` 与
  `tests/template-macros.test.mjs` 才能用 `node --test` 直接跑 `.ts`）。
- 搬过去之后请给 `src/commentToggle.ts` 里被搬走的符号做一次锚点自查：
  `grep -rn "commentStyleFor" tests/ src/` 里凡是指向 `read('src/commentToggle.ts')` 的源码断言都要改指
  `src/commentStyles.ts`，**断言体一字不动**（规约 §5）。
- 落地后 5 条宏的实现口径（写在这里免得下一批自己编）：presentable = `名字 + ()`、
  `getDefaultValue()` 继承 `MacroBase.java:47-49` 的 `"a"`、结果取该语言 `CommentStyle` 的对应字段，
  取不到标记时返回 `null`（上游 `CommentMacro` 拿不到 Commenter 时也是 null）。

---

## W-5 · 跨半区的两条门禁红（**不是**本批文件，给主代理处置）

1. `node .tools/find-orphan-modules.mjs --gate`：本批跑动期间一度红 2（`src/structuralCodeBlock.ts` 属桶 9、
   `src/externalTaskSettings.ts` 属 Tools 半区），**收工时已自愈为绿**（新增 0），
   这里只留作归属记录。本批域内文件全程不在清单里（`src/templateMacros.ts` 的生产消费方是 `src/templates.ts:8`）。
2. `node --test tests/source-citation-anchors.test.mjs` ⇒ 红 1，锚点 id：
   `src/fileTypeDetection.ts → platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java|48-51`。
   取证：快照 `docs/inventory/citation-anchors.json:1238` 记的是 48-51，而
   `src/fileTypeDetection.ts:82/:185/:257` 已被别的半区写成 `:49-51`（上游 48 行是 `@Override`、49-51 是方法体，
   两档都指得动，属于**行区间被顺手改窄**）。要复绿请重算快照：
   `$env:TAOCODE_CITATION_ANCHORS='update'; node --test tests/source-citation-anchors.test.mjs`
   （`docs/inventory/citation-anchors.json` 与两个 citation 门都是主代理独占文件）。
3. 派单里给本族的判据坐标 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/Macros.java`
   **在基准树里不存在**（那个目录只有 `EditVariableDialog.java` 等界面件）。真身是
   `platform/lang-impl/src/com/intellij/codeInsight/template/macro/`（实现类）与
   `platform/analysis-impl/src/com/intellij/codeInsight/template/macro/`（`MacroFactory`/`MacroService`）。
   请把这条从上游基准清单/判词里订正掉，免得下一路再去追；本批已在
   `src/templateMacros.ts:11-19` 的头注释里留痕。

---

## W-6 · 一条产品口径请求：宏清单要不要能点（**默认不做**）

上游的宏清单在「Edit Template Variables」对话框里是一个**可编辑下拉**
（`platform/lang-impl/src/com/intellij/codeInsight/template/impl/EditVariableDialog.java:103-119`，
下拉项来自 `MacroFactory.getMacros()`，文案是 `getPresentableName()`；`isComboboxEditable()` 见 `:113-116`），
选完写回的是**某个变量的表达式那一列**。
本仓没有那张表 —— 表达式就活在模板正文的 `$NAME:那一段$` 里（`src/templates.ts:153-176`），
所以设置页现在只**展示**这 21 条文案（`src/components/TemplateSettingsPage.vue:257-259`，只读 `<code>`），
没有给它们挂点击行为。

要不要做成「点一下就把 `capitalize(EXPR)` 插进正文」是本代代号之外的问题：那样做就**不是**上游的交互
（上游是选列、不是插文本）。请主代理定口径；在没有结论之前，本仓保持只读清单，
避免出现一个「长得像上游控件、行为却不是上游行为」的假交互。
