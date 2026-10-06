# 接线请求 2026-10-06 · editorinput（编辑器输入域：本批模块侧做完、只差别人面/保留文件那几行）

## 复核状态（2026-10-06 · edinput3 收尾批次登记）

| 条 | 状态 | 证据（本仓 文件:行号） |
|---|---|---|
| **W-1** 三格回车/引号设置 + 语言 id 传进来 | **已闭环**（edinput3 自己落地，无需再动保留文件） | `src/components/CodeEditor.vue:117`（`smartEnterLanguageForView(view, props.path, props.language, props.settings)`）与 `:966`（`smartQuotes(() => props.language, () => props.settings.autoInsertPairQuote)`）；装配本体 `src/enterHandlers.ts:160-172`。原文的「改法一净 +3 行」已被**先拆后加**替掉：注释词法两次调用搬进 `src/enterHandlers.ts` ⇒ 宿主那一段 6 行变 5 行（净 −1），`CodeEditor.vue` 由 1150 降到 **1144**（上限 1147）。判据：`tests/editor-enter-block-comment.test.mjs`（两条开关 + 新出口形状，**没放松**）与 `tests/editor-quote-faces.test.mjs`（把 `autoInsertPairQuote` 钉进正则）。 |
| **W-2** `EditorAddCaretPerSelectedLine` | **步骤 1-3 已闭环；步骤 4（键位面）仍开** | 命令 `src/editorCaretPerLine.ts:85`、注册 `src/editorCommands.ts:246`、菜单行 `src/menus/editMenu.ts:121`（键位栏仍是 `''`）。仍缺：`src/keymapBindings.ts` 的 `EDITOR_ACTIONS` 一条 + `CodeEditor.vue` 的 `Shift-Alt-G` 行（**这两个都是保留/别人面**，见下面 W-2 原文第 4 步，插入点现在是 `src/components/CodeEditor.vue:908` 之后）。 |
| **W-3** 语言档 facet 挂载 | **已闭环** | `src/components/CodeEditor.vue:480`：`view?.dispatch({ effects: language.reconfigure([extension, editorLanguageIdExtension(props.language)]) })`（与语法扩展同一条链，挂载点就是原文建议的 extensions 处）；出口 `src/editorMatchBrace.ts:51-56`，读它的判据 `tests/editor-match-brace.test.mjs`。原文说的「Java 的 `<>` 配对档拿不到语言」这一条已不成立。 |
| **W-4** 拆行 / 列模式 Delete 的动作面登记 | 新开（edinput3 落地了命令与键位，缺动作表） | 见文末 W-4。 |
| **W-5** 同一文件在两栏之间不同步 | 新开（判词 `lp/file-editor` ①） | 见文末 W-5。 |

下面保留原文（含已经落地的写法），便于对账：**原文的「改法一/改法二」已由 edinput3 落地**，其余部分仍然有效。

我的文件面只有编辑器输入那一族模块（`src/enterHandlers.ts`、`src/editorTyping.ts`、
`src/editorEnterBlockComment.ts`、`src/editorMatchBrace.ts` 等）与对应测试。
下面三条都**已经在我面内把消费方写好**，缺的是保留文件/别人名下的那几行；每条给
「目标文件 + 目标行号 + 可照抄整段 + 上游依据」。判词表与验证数字在 `docs/batch-2026-10-06-editorinput.md`。

---

## W-1 `src/components/CodeEditor.vue`：三格回车/引号设置 + 语言 id 传进来（已闭环 · 证据见上表）

键与界面早就在，缺消费方（本批把消费方落在模块侧）：

| 键（`src/settingsModel.ts`） | 界面（`src/components/EditorEnterKeysFields.vue`） | 上游开关 | 消费方（本批已写） |
|---|---|---|---|
| `autoInsertPairQuote`（`:427`，默认 true） | `:29` 插入成对引号 | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:140` | `src/editorTyping.ts` 的 `smartQuotes(getLanguage, autoInsertPairQuote)` |
| `closeCommentOnEnter`（`:429`，默认 true） | `:33` 闭合块注释 | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:132`，问在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInBlockCommentHandler.java:62` | `EnterLanguage.blockCloseOnEnter` → `src/enterHandlers.ts` |
| `insertBraceOnEnter`（`:431`，默认 true） | `:31` 插入成对的 `}` | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:130`，问在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterAfterUnmatchedBraceHandler.java:84-86` | `EnterLanguage.insertBraceOnEnter` → 同上 |

**改法一**（`src/components/CodeEditor.vue:112-117`，整段替换；行数 +3，注意上限 1147 见下面「行数提醒」）：

```ts
// 回车：上游那张 enterHandlerDelegate 表按有效次序逐条问（`intellij.platform.lang.impl.xml:1159/:1160/:1163-1164/:1161-1162`），
// 都不接管时交回 CodeMirror 的 insertNewlineAndIndent。词法装配 + 两条开关（CodeInsightSettings.java:130/:132）
// 都在 src/enterHandlers.ts 的 smartEnterLanguageFor / EnterLanguage 里。
const smartEnter = smartEnterCommand(() => {
  const style = (view ? commentStyleFromState(view.state, view.state.selection.main.head) : null)
    ?? commentStyleFor(undefined, props.path)
  const lexicon = smartEnterLanguageFor(style, props.language)
  return { ...lexicon, blockCloseOnEnter: props.settings.closeCommentOnEnter, insertBraceOnEnter: props.settings.insertBraceOnEnter }
})
```

**改法二**（`src/components/CodeEditor.vue:968`，同行替换，行数不变）：

```ts
        smartQuotes(() => props.language, () => props.settings.autoInsertPairQuote), angleBraceHighlight(() => props.language),
```

要点与坑：

1. **不要**用「开关关掉就不挂 `smartQuotes`」的做法（`docs/wiring-requests-2026-10-06-setkeys.md` 的 K-2 给的是那个写法，
   这里请改成本次这种传值写法）。原因：本仓挂着 `basicSetup`（`src/components/CodeEditor.vue:3`），
   它自带 `closeBrackets` —— 摘掉本模块只会退回 CodeMirror 那套**固定字符集**的配对，
   上游关掉 `AUTOINSERT_PAIR_QUOTE` 的语义是「插进去就是一个普通字符」
   （`platform/lang-impl/src/com/intellij/codeInsight/editorActions/TypedQuoteImpl.java:66-68`），
   两者不一样。K-3 要的 `EnterLanguage` 两个字段本批已按它给的字段名落好，K-2 的 `smartEnter` 那段可直接照抄。
2. 第二个实参 `props.language` 是**可选**的（`smartEnterLanguageFor(style, language?)`）：
   不传 ⇒ 字符串字面量那一条按改动前的档位走（对所有语言都切）；传了 ⇒ 只有
   `src/editorTyping.ts` 的 `LANGUAGE_QUOTES` 里有连接符的语言才切
   （门槛在 `platform/lang-impl/src/com/intellij/codeInsight/editorActions/enter/EnterInStringLiteralHandler.java:39-42`
   的 `instanceof JavaLikeQuoteHandler`，全社区树只有
   `java/java-frontback-impl/src/com/intellij/codeInsight/editorActions/JavaQuoteHandler.java:31` 一家）。
3. 两个开关都不传时按上游默认 `true`（`?? true`）⇒ **不接也不会把现有行为改坏**，但设置页那三格仍是空旋钮。
4. 行数提醒：`tests/module-size.test.mjs:135-136` 把 `src/components/CodeEditor.vue` 钉在 **1147 行**，只许降不许升。
   改法一净 +3 行 ⇒ 要么先把别的东西搬出该文件，要么把上面那段抽进 `src/enterHandlers.ts`
   （我的面，随时可以让我抽）。改法二行数不变。
5. 判据：`tests/editor-enter-block-comment.test.mjs` 末条钉的是 `smartEnterCommand(() => smartEnterLanguageFor(`
   这个形状，改成上面那段仍然匹配；`tests/editor-quote-faces.test.mjs:128` 钉的是 `smartQuotes(...) , angleBraceHighlight(...)`
   那一整行逐字 —— 改法二把 `smartQuotes` 的实参加长了，那条断言要同步改成判「第二个实参问的是 autoInsertPairQuote」，
   **不许删断言**。

## W-2 caretops 那份 R3：`EditorAddCaretPerSelectedLine`（编辑器侧命令 + 菜单键位栏 + 键位注册）

事实（我这批自己按行核过，与 `docs/wiring-requests-2026-10-06-caretops.md` 的 R3 一致，另补三条）：

- 实现：`platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`
  —— `ForEachCaret`；选区尾压在行首时那一行不算 `:31`；超过 `getMaxCaretCount()` 整条不做事 `:33-36`；
  每个选中行**在行尾**放一个光标 `:41-51`；`primary = caret.getOffset() != selectionStart` `:40`；
  最后删掉原来那个光标 `:53`。
- 上限与提示：`platform/platform-impl/src/com/intellij/openapi/editor/ex/util/EditorUtil.java:1366-1375`
  （`notifyMaxCarets` 弹 "too.many.carets" balloon），默认值 `editor.max.caret.count=1000` 在
  `platform/util/resources/misc/registry.properties:484`；`addCaret(..., makePrimary)` 的语义在
  `platform/editor-ui-api/src/com/intellij/openapi/editor/CaretModel.java:232-252`
  （「become a primary caret if and only if makePrimary is true」，并且**超出上限/同点已有光标时不动作**）。
- 注册：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`。
- 菜单：`platform/platform-impl/resources/idea/PlatformActions.xml:485-487`
  （EditMenu › `EditSelectGroup`，紧跟 `$SelectAll` 那一条）。
- 键位：`platform/platform-resources/src/keymaps/$default.xml:155-157` ⇒ `first-keystroke="shift alt G"`。
  本仓 `Shift-Alt-G` 目前**没人占**（`grep -n "Alt-G\|alt G" src/keymapBindings.ts src/keymap.ts src/components/CodeEditor.vue` 零命中）。
- 文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:130`
  = `Add Carets to Ends of Selected Lines`（本地化包不在本地树 ⇒ 中文按英文原文直译，见下面标签）。
  该 id **没有** `.description` 条目（同文件里 grep 只有 `:130` 这一行）⇒ 菜单行不要编描述文案。

要落的四处（四处都要，缺一处就是假行/假键位）：

1. **模块侧命令**（建议落 `src/editorCaretClone.ts`，同族且 `MAX_CARET_COUNT` 已经在那儿 `:38`；整段可照抄）：

```ts
// 在所选各行行尾加光标（EditorAddCaretPerSelectedLine，Shift+Alt+G）。
// 上游 platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54。
export const addCaretPerSelectedLineCommand: Command = (view: EditorView): boolean => {
  const { state } = view
  if (state.readOnly) return false
  const doc = state.doc
  const points: { at: number; primary: boolean }[] = []
  for (const range of state.selection.ranges) {
    const startLine = doc.lineAt(range.from)
    let endLine = doc.lineAt(range.to)
    // :31 选区尾正好压在行首 ⇒ 那一行不算。
    if (endLine.number > startLine.number && range.to === endLine.from) endLine = doc.line(endLine.number - 1)
    // :33-36 超过上限整条不做事。上游这里还会弹一条 balloon（EditorUtil.java:1366-1375），
    // 本仓没有对应的编辑器内通知通道 ⇒ 只静默不动手，不编提示文案。
    if (state.selection.ranges.length + points.length > MAX_CARET_COUNT) return false
    const primary = range.head !== range.from                       // :40
    for (let number = startLine.number; number <= endLine.number; ++number) points.push({ at: doc.line(number).to, primary })
  }
  if (points.length === 0) return false
  // :53 原光标全部删掉，只留新加的这些；makePrimary 见 CaretModel.java:232-241。
  const ranges = points.map(point => EditorSelection.cursor(point.at))
  const mainIndex = points.reduce((last, point, index) => (point.primary ? index : last), 0)
  view.dispatch({ selection: EditorSelection.create(ranges, mainIndex), userEvent: 'editor.caret.per-selected-line' })
  return true
}
```

   两处与本仓架构有关的差别，请照实留在注释里（不要当成上游行为）：
   `:44-48`「先把原光标挪开再 addCaret」是因为 IDEA 在同点已有光标时**拒绝**加（`CaretModel.java:236-238`），
   CodeMirror 没有这条限制 ⇒ 不需要那个动作；上游 `notifyMaxCarets` 的 balloon 没有通道 ⇒ 静默。
   判据建议钉：`abc\ndef\nghi` 整段选中 ⇒ 三个行尾光标（原光标被删）、选区尾在下一行行首时那一行不加、
   单光标无选区时等价于「光标跳到行尾」。

2. `src/editorCommands.ts`：加一条命令名（与 `cursor.above`/`cursor.below` 同一族，`:236` 那张表里）

```ts
  'caret.perLine': addCaretPerSelectedLineCommand,
```

3. `src/menus/editMenu.ts:109` 的「全选」之后插一行（上游 `PlatformActions.xml:485-487` 就是这个位置）：

```ts
    ctx.editable('caret.perLine', '在所选各行末尾添加光标', 'Shift Alt G', 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine'),
```

   标签 = 英文原文 `ActionsBundle.properties:130` 的直译（本地化包不在本地树）。
   键位栏**可以**填，因为上游 `$default.xml:155-157` 真给了 `shift alt G` —— 与 `line.sort` 那三行
   （`src/menus/editMenu.ts:128-135` 键位栏留空）不同，那三行上游确实没有键。
   ⇒ 若 `tests/editor-line-ops.test.mjs` 的「这三行不许带没注册的加速键」判据被推广到本行，
   请让它一并核 `src/keymapBindings.ts` 里有没有同名条目（第 4 步没做之前本行会红，这是对的）。

4. 键位注册（保留文件）：`src/keymapBindings.ts` 的 `EDITOR_ACTIONS`（`:218`，形状照 `:230-232` 的 `brace.match` 那条）加：

```ts
  { id: 'caret.perLine', upstreamId: 'EditorAddCaretPerSelectedLine', label: '在所选各行末尾添加光标',
    keywords: 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine',
    command: 'caret.perLine', key: { source: 'upstream', display: 'Shift Alt G', cm: 'Shift-Alt-G',
      boundAt: 'src/components/CodeEditor.vue:<新行>',
      upstream: '$default.xml:155-157 = shift alt G；注册 intellij.platform.ide.impl.actions.xml:358；菜单 PlatformActions.xml:485-487；文案 ActionsBundle.properties:130' } },
```

   再在 `src/components/CodeEditor.vue` 的编辑器键位表（`:846` 那条 `Ctrl-Shift-m` 附近）加一行
   `{ key: 'Shift-Alt-G', preventDefault: true, run: editingCommands['caret.perLine']! }`，
   并把上面 `boundAt` 的行号填成那一行的真实行号。
   注意 `tests/keymap-bindings.test.mjs:17` 会核键位冲突（`keymapConflicts(KEY_BINDINGS)` 必须为空）——
   `Shift-Alt-G` 目前无人占，安全。

## W-3（可选）`src/editorMatchBrace.ts` 那条语言 facet 至今没挂 —— **已闭环 · 证据 `src/components/CodeEditor.vue:480`**

`editorLanguageId` / `editorLanguageIdExtension`（`src/editorMatchBrace.ts:51-56`）没有任何生产消费方
（`grep -rn editorLanguageId src` 只命中定义处），⇒ Java 的 `<>` 配对跳转（上游
`java/java-frontback-impl/src/com/intellij/codeInsight/highlighting/JavaPairedBraceMatcher.java:26-34`）
在真实编辑器里拿不到语言、走 `()[]{}` 那一档。挂法（`src/components/CodeEditor.vue` 的 extensions 里，
与 `options.of(editorOptions())`（`:949`）同一位置）：

```ts
        editorLanguageIdExtension(props.language),
```

本批**没有**把新逻辑压在这条 facet 上（W-1 改法一走的是 `props.language` 实参），所以这条不接也不会让
本批的行为变错；它只影响 `EditorMatchBrace` 的 Java `<>` 那一档。之前的接线请求里没有这条（我 grep 过
`docs/wiring-requests-2026-10-06-*.md` 零命中），现补在这里。
**闭环说明（2026-10-06 · edinput3）**：主代理已落 `src/components/CodeEditor.vue:480`，与语法扩展同一条
`language.reconfigure([...])` 链；`editorLanguageIdExtension(undefined)` 返回 `[]`（`src/editorMatchBrace.ts:55`）
⇒ 没有语言 id 的文件不会把 facet 写成空串。判据 `tests/editor-match-brace.test.mjs`，本批复核后**关闭这条**。

---

## W-4（新）拆行 `EditorSplitLine` 与列模式 Delete 的动作面登记（保留文件 `src/keymapBindings.ts`）

命令与键位都已经在编辑器里落地（edinput3），缺的是「动作表 + Find Action」那两行，都在保留文件里：

- 键位与实现：`src/components/CodeEditor.vue:907` `{ key: 'Ctrl-Enter', preventDefault: true, run: splitLineCommand(smartEnter) }`，
  实现 `src/editorSplitLine.ts`（`splitLinePlan` / `splitLineCommand`）。上游
  `platform/platform-impl/src/com/intellij/openapi/editor/actions/SplitLineAction.java:22/:30/:50-67`，
  键位 `platform/platform-resources/src/keymaps/$default.xml:959-961 = control ENTER`。
- 列模式 Delete：`src/components/CodeEditor.vue:908` `{ key: 'Delete', preventDefault: true, run: columnSelection.deleteForward }`，
  实现 `src/editorColumnMode.ts`。上游 `DeleteInColumnModeHandler.java:18/:25/:30-34/:37`，
  注册位 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1084`（**只有** `EditorDelete` ⇒ 不要给 Backspace 加同一档）。
  这一条**没有自己的键位**（沿用 `Delete`），所以只需要动作表条目，不需要新键：

`src/keymapBindings.ts` 的 `EDITOR_ACTIONS`（原 W-2 第 4 步同一张表）加两条，形状照 `:230-232` 的 `brace.match`：

```ts
  { id: 'line.split', upstreamId: 'EditorSplitLine', label: '拆分行',
    keywords: 'split line 拆行 在光标处换行 EditorSplitLine',
    command: 'line.split', key: { source: 'upstream', display: 'Ctrl Enter', cm: 'Ctrl-Enter',
      boundAt: 'src/components/CodeEditor.vue:907',
      upstream: '$default.xml:959-961 = control ENTER；实现 SplitLineAction.java:22-67' } },
```

⚠ 落地时有两件事必须一起做，否则这条就是假行：

1. **命令表**：`command: 'line.split'` 要能在 `src/editorCommands.ts` 的 `editingCommands` 里查到。本批
   **故意没有**往那张表里塞 `line.split`：表是模块级的单表，而拆行要把宿主那条回车链
   （`smartEnter`，闭包在 `props`/`view` 上）当实参传进去，塞进表里就会出现「菜单那一档没有智能回车、
   键位那一档有」的两种行为（上游只有一条动作）。要么照本批的做法让键位直接指模块导出的命令，
   要么由主代理把 `smartEnter` 一起搬进 `editorCommands.ts`（那是另一个量级的改动，`CodeEditor.vue` 会因此再降几行）。
2. 标签**不要**编描述文案：`ActionsBundle.properties` 里 `EditorSplitLine` 的 `.description` 我没有逐条核到，
   本地树里能不能核到请由接的人确认（核不到就只写 `.text` 的直译）。

判据现成：`tests/editor-split-line.test.mjs` 末条钉的就是宿主那一行；`tests/editor-column-mode.test.mjs`
末条钉 Delete 那一行、并且钉「**不许**给 Backspace 加同一档」。

## W-5（新）同一文件在两栏之间不同步（判词 `docs/inventory/verdict-platform_rest.md:228` 的 ①）

事实：`src/editorSplits.ts:90`（`openInOppositeGroup`，上游 "split same"）让同一个 `Tab` 对象进两组，
`src/App.vue` 因此把同一份 `content` 递给两个 `CodeEditor` 实例；但
`src/components/CodeEditor.vue` 只在 `onMounted` 里读一次 `props.content`
（`watch` 只挂在 `props.path` 上，见该文件 1050 行附近那一串 watch）⇒
**两栏显示同一文件时，一栏改了另一栏不跟**，切换焦点也不重读。上游是
`platform/lang-impl/src/com/intellij/openapi/fileEditor/impl/PsiAwareFileEditorManagerImpl`
在内容变化时同步所有 `FileEditor`（判词原文即指这条）。

这条要 `src/components/CodeEditor.vue` 加 watch ⇒ 只能由主代理落（本文件登记上限 1147、当前 1144，**有 3 行余量**）。
可粘贴（插在 `watch(() => props.path, ...)` 那一行之后，**同行族**，净 +1 行）：

```ts
// 同一个 tab 在两栏里是同一个对象（src/editorSplits.ts 的 openInOppositeGroup）：外部把 content 改了
// （另一栏存盘、磁盘同步、回滚）时这一栏要跟上，否则两栏各显示一份。只在**不是自己正在编辑**时替换。
watch(() => props.content, value => { if (!replacing && view && view.state.doc.toString() !== value) api.setDraft(value) })
```

⚠ 三条坑：①`replacing` 是宿主 `setDraft` 自己按下的旗（见该文件里 `replacing = true` 那一处），
不判它就会在存盘回调里把编辑器内容回灌一次、光标跳到文档尾；②这条 watch **必须**排在
`api`（那块 `createEditorHostApi`/同名对象）声明之后，否则 setup 期求值源就 TDZ；
③判据要配一条「两栏同一文件、外部改 content 后第二栏文档跟着变」的 SSR/纯逻辑判据 ——
本批没做这条，因为落点在保留面上，模块侧无可拆的东西。
