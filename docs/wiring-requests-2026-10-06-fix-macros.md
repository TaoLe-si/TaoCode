# wiring requests · fix-macros（2026-10-06 · **macros2 批次复核版**）

本文件是实时模板宏域「上游有、本仓接不上」的那几条挂点请求。
**本版是 `macros2` 批次逐条重开当前代码核对后的版本**：每条给「已闭环 / 仍缺（可直接粘贴的 old→new）/ 不落（理由+证据）」，
`old` 全部是收工时那份文件的**逐字原文**（行号 = 本次实测，别的代理还在动 `CodeEditor.vue`，粘贴前请按内容找而不是按行号找）。

前提说明（口径没变）：这些宏在挂点落地之前**本仓不实现、不渲染**。
落地时把 `src/templateMacros.ts:501-514` 的 `DEFERRED_TEMPLATE_MACROS` 里对应那条删掉、
在 `src/templateMacros.ts:422-498` 的 `LIVE_TEMPLATE_MACROS` 加上实现，然后跑
`node --test tests/template-macro-registry.test.mjs` —— 那条门钉的是「实现侧 + 登记侧 = 上游那 33 条
（`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063`，本批已数过：正好 33 条 `<liveTemplateMacro>`）」，
两边同时存在或同时缺失都会红。**门禁里 `21 / 12` 那对数字与逐字锚点必须跟着改**（见每条末尾的「配套改门禁」），
那是形状锚点，不是断言强度，改它不算放松。

`docs/batch-2026-10-06-fix-macros.md` §7 留过一条：派单给的 `platform/lang-impl/src/com/intellij/codeInsight/template/impl/Macros.java`
在基准树里不存在。**本次派单又给了一条新的：`platform/ide-impl/src/com/intellij/codeInsight/template/impl/MacrosImpl.java` —— 同样不存在**
（`platform/ide-impl/src/com/intellij/codeInsight/template/` 这个目录本身就没有；全树 `find -name 'MacrosImpl*'` 零命中，本批实跑）。
宏族的真身仍是两处：查表侧 `platform/analysis-impl/src/com/intellij/codeInsight/template/macro/MacroFactory.java:13-24`
（`createMacro(name)` = 取同名宏的第一条）与同目录 `MacroService.java`；实现类在
`platform/lang-impl/src/com/intellij/codeInsight/template/macro/`（本批逐条打开过：`LineNumberMacro`、`ClipboardMacro`、
`FilePathMacroBase`、`CommentMacro`、`BaseCompleteMacro`、`ShowParameterInfoMacro`、`SimpleMacro`、`MacroBase`、
`CapitalizeMacro`、`DecapitalizeMacro`、`FirstWordMacro`、`EscapeStringMacro`、`ConcatMacro`、`SubstringBeforeMacro`、
`RegExMacro`、`EnumMacro`、`ConvertToCamelCaseMacro`、`SplitWordsMacro`、`CapitalizeAndUnderscoreMacro`、
`ReplaceSpacesWithUnderscoresMacro`、`ReplaceUnderscoresWithSpacesMacro`、`CurrentUserMacro`、`CurrentDateMacro`、`CurrentTimeMacro`）。
接口侧 `platform/analysis-api/src/com/intellij/codeInsight/template/Macro.java` 的行号（`:18` EP、`:20` getName、
`:26-28` presentable = 名字+`()`、`:30-32` `getDefaultValue()`= `""`、`:34` calculateResult、`:40` calculateLookupItems、
`:44-46` isAcceptableInContext 默认恒真）本批也逐条重开核过，**头注释里那批引用成立**。

---

## W-1a · 给宏上下文加「展开点行号」—— 状态：**仍缺 · 一条挂点即可闭环（解锁 `lineNumber`）**

- 现状证据（三处都没动）：
  - `src/components/CodeEditor.vue:576` 仍是 `const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)`
  - `src/templates.ts:226-236`：`expand()` 的第五个参数仍是 `plugins`（`export function expand(` 在 `:226`），第六个参数不存在；`const macroContext: TemplateMacroContext = { path }`
  - `src/templateMacros.ts:70-75`：`TemplateMacroContext` 只有 `path` 与 `now`（定义在 `:70`）
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/LineNumberMacro.java:20-25`
  —— `context.getStartOffset()` → `editor.offsetToLogicalPosition(offset).line + 1` → `TextResult(String.valueOf(line))`。
  注意它是 `extends Macro`（不是 `MacroBase`），所以空结果的 marker 是 `Macro.java:30-32` 的**空串**，不是 `"a"`。
- 可直接粘贴（三处，顺序无所谓）：

`src/components/CodeEditor.vue:576`（`line` 就是上一行 `view.state.doc.lineAt(head)` 的结果，CodeMirror 的 `Line.number` 是 1 起）：

```ts
// old
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)
// new（`lineNumber` 要的是展开点所在行的 1 起行号，等价于上游 offsetToLogicalPosition(起点).line + 1）
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates,
    { line: line.number })
```

`src/templates.ts:226-236`：

```ts
// old
export function expand(
  line: string,
  caret: number,
  path: string,
  settings: TemplateSettings = defaultTemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
): Expansion | null {
  const prefix = line.slice(0, caret)
  const indent = indentOf(line)
  const usable = effectiveTemplates(path, settings, plugins)
  const macroContext: TemplateMacroContext = { path }
// new
export function expand(
  line: string,
  caret: number,
  path: string,
  settings: TemplateSettings = defaultTemplateSettings,
  plugins: readonly PluginTemplateSource[] = [],
  macro: { line?: number } = {},
): Expansion | null {
  const prefix = line.slice(0, caret)
  const indent = indentOf(line)
  const usable = effectiveTemplates(path, settings, plugins)
  const macroContext: TemplateMacroContext = { path, line: macro.line }
```

`src/templateMacros.ts:70-75` + 表里加实现：

```ts
// old
export interface TemplateMacroContext {
  /** 被展开文件的路径。上游是 `context.getPsiFile().getVirtualFile()`（`FilePathMacroBase.java:24-31`）。 */
  readonly path: string
  /** 时间源（上游 `Clock.getTime()`，`CurrentDateMacro.java:28`）；缺省 = 当下，测试注入固定值。 */
  readonly now?: () => Date
}
// new
export interface TemplateMacroContext {
  /** 被展开文件的路径。上游是 `context.getPsiFile().getVirtualFile()`（`FilePathMacroBase.java:24-31`）。 */
  readonly path: string
  /** 展开点的 1 起行号。上游 `LineNumberMacro.java:22-24` = `offsetToLogicalPosition(起点).line + 1`；
   *  缺省 = 展开点没给（`expand()` 的老调用方），此时 `lineNumber` 出空串，与上游拿不到 editor 同档。 */
  readonly line?: number
  /** 时间源（上游 `Clock.getTime()`，`CurrentDateMacro.java:28`）；缺省 = 当下，测试注入固定值。 */
  readonly now?: () => Date
}
```

```ts
// LIVE_TEMPLATE_MACROS 里加一条（marker 是空串：`LineNumberMacro` 直接 `extends Macro`）
  { name: 'lineNumber', presentableName: 'lineNumber()', defaultValue: '', upstream: 'LineNumberMacro',
    calculate: (_parameters, context) => (context.line === undefined ? null : String(context.line)) },
```

- 配套改门禁：`tests/template-macro-registry.test.mjs:78-79` 的 `21 / 12` → `22 / 11`；
  `:144` 那条逐字锚点 `const macroContext: TemplateMacroContext = \{ path \}` 改成 `const macroContext: TemplateMacroContext = \{ path, line: macro\.line \}`；
  `:61-74` 的 `UPSTREAM_UNIMPLEMENTED` 里删掉 `{ impl: 'LineNumberMacro', name: 'lineNumber' }`、
  `:36-58` 的 `UPSTREAM_IMPLEMENTED` 加 `{ impl: 'LineNumberMacro', name: 'lineNumber', presentableName: 'lineNumber()', defaultValue: '' }`。
- 本批会配的判据（挂点一落地就能跑，宏与用例都由我这边补）：`lineNumber` 在行号 1 起的位置出 `"1"` 而不是 `"0"`；
  `expand()` 没带 `macro` 时出空串（marker 档），不出 `undefined` 字样。

---

## W-1b · 「项目根」字段（原 W-1 的第二半，解锁 `fileRelativePath`）—— 状态：**不落 · 前提不成立**

- 原请求写的挂点代码是 `props.projectRoot ?? ''`。**`CodeEditor.vue` 没有 `projectRoot` 这个 prop**
  （本批实读：`src/components/CodeEditor.vue:91` 的 `defineProps<{ ... }>()` 一共 17 个字段，
  `content/path/language/theme/active/settings/templates/pluginTemplates/lspEnabled/readOnly/reveal/breakpoints/debugLine/bookmarks/gutterIcons/blame`，
  没有 projectRoot）⇒ 照抄那条代码过不了 `vue-tsc`。有 `projectRoot` 的是设置页：`src/components/TemplateSettingsPage.vue:10`。
- 更要紧的是**上游那条宏不是「把绝对路径削成相对」**：
  `platform/lang-impl/src/com/intellij/codeInsight/template/macro/FilePathMacroBase.java:81-84` 走
  `FqnUtil.getVirtualFileFqn(virtualFile, project)`，而
  `platform/refactoring/src/com/intellij/ide/actions/FqnUtil.java:59-73` 的次序是
  ①问 `VirtualFileQualifiedNameProvider` 扩展点 → ②才回落到「相对项目 base directory」。
  社区版里唯一的 provider 是 `java/java-impl/src/com/intellij/ide/actions/JavaVirtualFileQualifiedNameProvider.java:21-32`，
  它给的是**源根相对路径**（`index.getSourceRootForFile(...)` 后 `VfsUtilCore.getRelativePath(..., '/')`），
  即 Java 文件在 `src/main/java` 下时 `fileRelativePath` 是 `com/example/App.java`，**不是**项目相对路径。
- 本仓现状：`src/templates.ts:44` 的 `languageFor(path)` 与 `src/fileTemplateVars.ts:40-43` 的 `SOURCE_ROOTS` 是**目录约定表**，
  没有模块/源根索引，也没有 `ProjectFileIndex`；展开点（`CodeEditor.vue`）手上只有 `props.path`。
  ⇒ 只加一个 `projectRoot` 字段会做出一个「与 `filePath` 完全同值」的假宏（本仓 `props.path` 本来就是工作区相对路径），
  这不是上游那条宏。**要落地得先有源根判定**（`src/projectRoots.ts` 那一族 + 模块模型），故本条不改判：
  `fileRelativePath` 继续登记在 `DEFERRED_TEMPLATE_MACROS`（`src/templateMacros.ts:501-514`）。
- 如果主代理仍要这条：请把请求升格成「给 `TemplateMacroContext` 同时加 `projectRoot` 与 `sourceRoots`，
  并按 `FqnUtil.java:59-73` 的次序取值」，并先确认 `CodeEditor.vue` 能拿到这两样（要改 `App.vue:2147` 那行的传参）。

---

## W-2 · 剪贴板要在展开**之前**取（解锁 `clipboard`）—— 状态：**仍缺 · 前提未变**

- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/ClipboardMacro.java:15`
  （`super("clipboard")` 那一行），整条宏是 `platform/lang-impl/src/com/intellij/codeInsight/template/macro/ClipboardMacro.java:13-22`
  —— `extends SimpleMacro`，`evaluateSimpleMacro` 里
  `CopyPasteManager.getInstance().getContents(DataFlavor.stringFlavor)`（`:20`）**同步**读，`null` 兜成空串（`:21`）。
  它的 marker 是 `SimpleMacro.java:26-29` 的 `"11.11.1111"`，不是 `"a"`（登记侧那条得跟着改）。
- 本仓现状证据：`src/clipboard.ts:52` 仍是 `export async function readClipboardText(): Promise<string>`（异步）。
- 为什么不能在宏里 `await`：`render()` 与 CodeMirror 的 Tab 处理必须同步返回文本；`TemplateMacro.calculate` 变异步会把
  整条展开链变成异步，键位层的返回值（`boolean`）就断了。
- **本批新增的取证（订正原请求的一处含糊）**：`src/clipboard.ts` 里那个环（`clipboardRing`）虽然是模块级 `ref`、同步可读，
  但 `src/clipboard.ts:3` `import { computed, ref } from 'vue'`、下一行还 import `./clipboardHistory.ts`，
  整个文件又通过 `bridge` 走宿主通道 ⇒ **不能 value-import 进 `src/templates.ts` 的依赖图**：
  那条图必须保持「无 Vue / 无 CodeMirror」，否则 `node --test tests/templates.test.mjs` 直接加载不了 `.ts`
  （规约 §4 第 1 条那一类整树失效）。所以只能「展开前把文本带进来」，不能在宏里现取。
- 可直接粘贴（与 W-1a 同一批落，字段并列）：

```ts
// src/templateMacros.ts 的 TemplateMacroContext（接在 W-1a 新增的 line 之后）
  /** 展开**之前**预取好的剪贴板文本；没预热到就是空串。上游是同步读（`ClipboardMacro.java:20`），
   *  本仓拿不到「当下」，只能拿上一次取到的那份。 */
  readonly clipboard?: string
```

```ts
// src/templates.ts:236（同 W-1a 那一处）
  const macroContext: TemplateMacroContext = { path, line: macro.line, clipboard: macro.clipboard }
// 并把 W-1a 的入参形状改成 macro: { line?: number; clipboard?: string } = {}
```

```ts
// src/components/CodeEditor.vue:576 —— 展开点在 `expandTemplate()` 里，取料点由主代理定（键位层是唯一能 await 的地方）
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates,
    { line: line.number, clipboard: lastClipboardText })
```

- 配套改门禁：同 W-1a 那三处数字/清单，把 `{ impl: 'ClipboardMacro', name: 'clipboard' }` 从登记侧挪到实现侧，
  `presentableName: 'clipboard()'`（`Macro.java:26-28` 的默认档）、`defaultValue: '11.11.1111'`（`SimpleMacro.java:26-29`）。
- 这条如果不做，请保持现状：`clipboard` 留在 `DEFERRED_TEMPLATE_MACROS`，设置页不渲染它（现在就是不渲染的，
  `src/components/TemplateSettingsPage.vue:261-263` 只渲染 `LIVE_TEMPLATE_MACROS`（`:262` 那行就是 `<code>`））。

---

## W-3 · 模板收尾后还要再跑一个编辑器动作（解锁 `complete`、`completeSmart`、`showParameterInfo`）—— 状态：**仍缺 · 原请求给的本仓入口是假的**

- 上游依据（本批逐条重开）：
  - `platform/lang-impl/src/com/intellij/codeInsight/template/macro/BaseCompleteMacro.java:58-63`
    —— `calculateResult` 返回 `new InvokeActionResult(() -> invokeCompletion(context))`；`:65-90` 是真正执行时
    先 `invokeLater`、再查「当前有没有补全在跑」（`:75`）、然后把 phase 复位并拉起 handler（`:79-81`）。
    marker = `:53-56` 的 `"a"`。
  - `platform/lang-impl/src/com/intellij/codeInsight/template/macro/ShowParameterInfoMacro.java:29-34` 同形，
    `:36-43` 明确「先 `TemplateManager.finishTemplate(editor)`（`:38`）再 `ShowParameterInfoHandler.invoke(...)`（`:41-42`）」。
- 本仓现状证据：`src/templates.ts:36-42` 的 `Expansion`（`:36`）仍只有 `{ start, end, text, stops, caret }`，
  没有「结束后动作」这一格 ⇒ 这类宏无处安放（继续登记在 `DEFERRED_TEMPLATE_MACROS`）。
- **订正（留痕）**：原请求写「请复用 `src/editorCommands.ts` 已有的 `triggerParameterInfoAt` / `triggerCompletionAt`，别新造」——
  本批实搜：`src/editorCommands.ts` 里**没有**这两个名字（`grep -rn "parameterInfo" src/editorCommands.ts` 零命中）。真实通道是：
  - 补全：`src/completionUi.ts:52` `startCompletionAs(view: EditorView, mode: CompletionMode): boolean`
    （`:73` `startBasicCompletion(view)` 是它的 basic 档包装；三条键位入口在 `:84-92`）；
  - 参数信息：`src/components/CodeEditor.vue:791` 的 `{ key: 'Ctrl-p', preventDefault: true, run: emitSemantic('signature') }`，
    `emitSemantic` 定义在 `:669`（`kind` 的可选值含 `'signature'`），落到 `:686` `emit('semantic', payload)`，
    payload 形状见 `:95` 的 `semantic: [...]` 声明（`{ kind, path, line, character, range? }`）。
- 可直接粘贴：

```ts
// src/templates.ts:36-42
// old
export interface Expansion {
  start: number     // line-local offset where the trigger begins
  end: number       // line-local offset of the caret
  text: string
  stops: Stop[]
  caret: number     // offset inside `text` when the template has no slots
}
// new（默认 undefined ⇒ 既有调用点与用例一字不改）
export type TemplateAfterInsert = 'complete' | 'completeSmart' | 'parameterInfo'
export interface Expansion {
  start: number     // line-local offset where the trigger begins
  end: number       // line-local offset of the caret
  text: string
  stops: Stop[]
  caret: number     // offset inside `text` when the template has no slots
  after?: TemplateAfterInsert   // 收尾动作：上游 InvokeActionResult 的等价格（BaseCompleteMacro.java:58-63）
}
```

```ts
// src/components/CodeEditor.vue:576 那行之后（`expandTemplate()` 里，dispatch 完再收尾）
// old（dispatch 之后紧接着的那两行，收工时实测）
  templateStops = stops.slice(1)
  return true
// new
  templateStops = stops.slice(1)
  if (result.after) queueMicrotask(() => {
    // 上游 ShowParameterInfoMacro.java:38 是「先 finishTemplate 再拉起浮层」：本仓的收尾 = 交还 templateStops
    if (result.after === 'parameterInfo') emitSemantic('signature')(view)
    else startCompletionAs(view, result.after === 'completeSmart' ? 'smart' : 'basic')
  })
  return true
```

（`startCompletionAs` 从 `../completionUi.ts` 取；`emitSemantic(kind)` 是 `CodeEditor.vue:669` 那个返回 `Command` 的工厂，
按它自己的签名传参。这两处都在只读文件里，具体写法由主代理定 —— 本批只保证**入口名字是真的**。）

- 配套改门禁：`UPSTREAM_UNIMPLEMENTED` 里那三条（`CompleteMacro`/`CompleteSmartMacro`/`ShowParameterInfoMacro`）移到实现侧，
  presentable 全部是 `Macro.java:26-28` 的默认档 `名字 + ()`，marker：`complete`/`completeSmart` = `"a"`
  （`BaseCompleteMacro.java:53-56`），`showParameterInfo` = `""`（直接 `extends Macro`，`Macro.java:30-32`）。
- **不要在挂点之前给这三条放假实现**（比如返回空串）：上游它们**不产出文本**，返回空串会让本仓变成「产出一个空槽位」，
  用户看到的是模板少了内容。

---

## W-4 · 把注释标记表抽成纯数据模块（解锁 `lineCommentStart`、`blockCommentStart`、`blockCommentEnd`、`commentStart`、`commentEnd`）—— 状态：**仍缺 · 前提未变**

- 本批实测前提仍然成立：`src/commentStyles.ts` **不存在**（`ls src | grep -i comment` 只有
  `commentToggle.ts`、`editorEnterBlockComment.ts`、`editorJoinComments.ts`）；
  `src/commentToggle.ts:24` 仍是 `import { EditorSelection, type EditorState } from '@codemirror/state'`；
  纯函数 `commentStyleFor` 仍在 `src/commentToggle.ts:69`。
- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/CommentMacro.java:21-27`
  （`extends MacroBase`、`super(name, name + "()")` ⇒ presentable 就是「名字加括号」，marker 继承 `MacroBase.java:46-49` 的 `"a"`）、
  `:30-36`（取不到 `Commenter` 或取不到标记 ⇒ `null`；命中时 `new TextResult(prefix.trim())` —— **注意有 trim**）、
  `:38-73` 的五个子类。注册见 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1031-1063` 那 33 条里的五条。
- **本批补一条原请求没写细的上游口径**（免得下一批自己编）：`commentEnd` 不是「块注释后缀」这么简单 ——
  `CommentMacro.java:65-73` 的 `AnyCommentEnd` 是「**行注释前缀非空时返回空串**，否则才返回 `getBlockCommentSuffix()`」。
  即 Java 这种有行注释的语言里 `$commentEnd$` 出的是空文本（然后被 marker 机制接管 ⇒ 出 `"a"`？
  不：`""` 是 TextResult，`TemplateState.java:787` 的 `resultIsNullOrEmpty` 会把它和 null 并一档 ⇒ 走默认值/marker，
  本仓的 `resolveTemplateSlotValues`（`src/templateMacros.ts:619-644`）也是同一档处理）。
  另外五个子类全部对标记做 `trim()`（`:35`），`lineCommentStart` 出的是 `//`（`" //"` 这种带前导空格的 commenter 会被削掉）。
- 请求不变：新建 `src/commentStyles.ts`（纯数据：`CommentStyle` 类型 + `BY_LANGUAGE`/`BY_EXTENSION` 两张表 + `commentStyleFor`），
  `src/commentToggle.ts` 改为从它 import，并**只留** CodeMirror 那半（`commentStyleFromState` 等）。
- 搬完之后请按规约 §5 做锚点自查：`grep -rn "commentStyleFor" src tests docs`，凡是指向
  `read('src/commentToggle.ts')` 的源码断言都改指 `src/commentStyles.ts`，**断言体一字不动**
  （本批已知引用它的地方：`src/commentToggle.ts:69` 定义 + `tests/comment-toggle.test.mjs` 那一族用例）。
- 落地后 5 条宏的实现口径：presentable = `名字 + ()`；`defaultValue` = `"a"`；
  结果 = 该语言 `CommentStyle` 的对应字段 `trim()` 后的值，`CommentStyle` 取不到（`commentStyleFor` 返回 `null`）时给 `null`。
  本仓的 `TemplateMacroContext` 只有 `path`，正好够：语言 = `src/templates.ts:44` 的 `languageFor(path)`（与上游
  `PsiUtilBase.getLanguageInEditor` 同层，差别是上游按编辑器、本仓按被展开文件的路径）。

---

## W-5 · 跨半区的门禁红 —— 状态：**已更新（本批收工时的原始数字）**

1. `node .tools/find-orphan-modules.mjs --gate`：**红 2**，`src/editorColumnMode.ts`、`src/editorSplitLine.ts`
   （编辑器半区在途；本批域内三个文件 `src/templateMacros.ts`、`src/templates.ts`、`src/components/TemplateSettingsPage.vue`
   都不在清单里 —— 前两者的生产消费方是 `src/components/CodeEditor.vue:35` 与 `src/surroundTemplates.ts:9`，
   第三者由 `src/App.vue` 的设置页渲染）。上一轮自愈的那两条（`jarRun.ts`、`runAnythingContext.ts`）这次由基线里掉了，
   工具报「已接上（可以更新基线）」，属主代理的基线维护动作，不归本批。
2. `node --test tests/source-citation-anchors.test.mjs`：**8 / 8 绿**（上一轮那条 `src/fileTypeDetection.ts → NativeFileType.java|48-51`
   的锚点红已自愈，快照与仓内区间现在一致；本批新增的引用都落在「未入快照」那一档，门里写明「不拦，下次重算会收进去」）。
3. 上游坐标订正：见本文件开头（派单两条不存在的路径：`template/impl/Macros.java` 与 `template/impl/MacrosImpl.java`，
   本批都实查为零命中）。

---

## W-6 · 宏清单要不要能点 —— 状态：**不落 · 前提未变（等主代理定口径）**

- 上游：`platform/lang-impl/src/com/intellij/codeInsight/template/impl/EditVariableDialog.java:103-119`
  —— 变量表的第二列（Expression）挂的是 `ComboBoxCellEditor`，选项来自
  `MacroFactory.getMacros()` 全量 → `isAcceptableInContext` 过滤（`:103`）→ `getPresentableName`（`:104`）→
  `.sorted()`（`:104`）→ `LinkedHashSet` 去重（`:105`）；`isComboboxEditable()` 在 `:113-116` 返回 `true`。
  选完写回的是**那一行的表达式**，不是往正文里插文本。
- 本仓：`src/components/TemplateSettingsPage.vue:116`（`const macros = [...LIVE_TEMPLATE_MACROS].sort(...)`）
  与 `:261-263`（`<div class="lt-macros">` 里只渲染 `<code>{{ macro.presentableName }}</code>`）—— 仍是只读清单，
  和上一轮一致。本仓没有「变量表 + 表达式列」那张表（表达式活在模板正文 `$NAME:那一段$` 里，
  `src/templates.ts:157-189` 的 `render()`），所以「点一下把 `capitalize(EXPR)` 插进正文」**不是**上游行为。
- 结论：保持只读清单（规约 §3：不做「长得像上游控件、行为却不是上游行为」的假交互）。
  要改成可点，请先决定：**插入点**从哪来（页面现在没有光标位置的概念，正文 `<textarea>` 在 `:244`），
  以及是否接受与本仓词法的这套「一列压两列」差异继续分叉。

---

## W-7 ·（本批新增）实参算不出来时用**编辑器选区**兜底（`MacroBase.getTextResult(..., useSelection)` 那一档）—— 状态：**仍缺 · 一条挂点解锁 6 条已实现宏的一档行为**

- 上游依据：`platform/lang-impl/src/com/intellij/codeInsight/template/macro/MacroBase.java:55-67`
  —— `getTextResult(params, context, useSelection)`：只有当**唯一实参**算出 `result == null` 时，
  才取 `context.getProperty(ExpressionContext.SELECTION)` 当值（`:58-63`）。
  选区那份的本体在 `platform/analysis-impl/src/com/intellij/codeInsight/template/impl/TemplateStateBase.java:68-70`
  （`getSelectionBeforeTemplate()` 读 `myProperties` 里的 `ExpressionContext.SELECTION`）。
  传 `useSelection = true` 的正好是 6 条宏：
  `ConvertToCamelCaseMacro.java:35`（`camelCase` + 子类 `underscoresToCamelCase`）、
  `SplitWordsMacro.java:28`（`snakeCase`/`lowercaseAndDash`/`spaceSeparated`）、
  `CapitalizeAndUnderscoreMacro.java:23`。其余宏（`capitalize`/`decapitalize`/`firstWord`/…）传的是默认 `false`，
  **没有**这一档 —— 本批已在表里逐条核对，别把它推广到全部宏。
- 本仓现状：`src/templateMacros.ts:389`（`singleText`）只做「恰好一个实参、否则 null」，
  `evaluateTemplateExpression`（`:577` 起）拿到 `null` 就直接走 marker ⇒ 这 6 条宏少了选区兜底。
- 为什么本批不能自己在模块侧闭环：`TemplateMacroContext` 里没有选区，而唯一可能的取料点在展开点（编辑器）。
  自己加一个 `selection?: string` 字段但没有任何生产调用方传它 = 本仓明令禁止的「假通道」（规约 §3、§5 的零消费方门）。
- 请照抄的挂点（与 W-1a 同一批最省事）：

```ts
// src/components/CodeEditor.vue:576 —— `expandTemplate()` 里 `line` 已经算出来了，选区同处可得
// old
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates)
// new（选区非空才传；上游那份就是「模板开始前被选中的文本」）
  const selection = view.state.selection.main
  const result = expandTemplateAt(line.text, head - line.from, props.path, props.templates, props.pluginTemplates,
    { line: line.number, selection: selection.empty ? undefined : view.state.sliceDoc(selection.from, selection.to) })
```

```ts
// src/templateMacros.ts 的 TemplateMacroContext 再补一个字段
  /** 展开前的编辑器选区。上游是 `context.getProperty(SELECTION)`（`MacroBase.java:58-63` +
   *  `TemplateStateBase.java:68-70`），只有 camelCase / capitalizeAndUnderscore / SplitWords 那 6 条宏读它。 */
  readonly selection?: string
```

```ts
// src/templateMacros.ts:389 的 singleText 旁边，加一个只给那 6 条用的取料口
/** `MacroBase.getTextResult(params, context, true)`：唯一实参算不出东西时退到选区（`:56-63`）。 */
const singleTextOrSelection = (parameters: MacroParameters, context: TemplateMacroContext): string | null =>
  parameters.length === 1 ? (parameters[0] ?? context.selection ?? null) : null
```

- 配套判据（由我这边写）：`camelCase(NO_SUCH_VARIABLE)` 在无选区时仍是 marker `"a"`；带选区 `"Order State"` 时出 `orderState`；
  `capitalize(NO_SUCH_VARIABLE)` **带同一个选区时仍出 marker**（它没开 `useSelection`）—— 最后这条就是「别推广到全部宏」的门。
