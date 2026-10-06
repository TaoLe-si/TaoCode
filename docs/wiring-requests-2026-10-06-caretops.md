# 接线请求 · 2026-10-06 · 行操作与多光标一组（caretops）

派单明确禁止我动保留文件，所以本批**只落了非保留面**（`src/editorLineOps.ts`、`src/editorCaretClone.ts`、
`src/editorCommands.ts`、`src/menus/editMenu.ts` + 两个测试文件）。本文件列出要你落的部分，
每条都给「上游相对路径:行号」，可照抄。判词与验证数字在 `docs/batch-2026-10-06-caretops.md`。

## 结论先说：本批**不需要**新增键位，也**不需要**改 `src/App.vue`

- 三条行操作在上游默认键位表里**根本没有绑定**：
  `platform/platform-resources/src/keymaps/$default.xml` 里查不到 `EditorSortLines` /
  `EditorReverseLines` / `EditorUniqueLines`（我对整个 `keymaps/` 目录 grep 过，只有
  `platform/platform-resources/src/keymaps/Sublime Text.xml:105-107` 给 `EditorSortLines` 绑了
  `control F9`，Mac 版 `Sublime Text (Mac OS X).xml:99-101` 是 `control F5`；`EditorReverseLines`
  与 `EditorUniqueLines` **任何键位表里都没有**）。
  ⇒ **请不要给这三条编加速键**。`src/menus/editMenu.ts:128-135` 的三行键位栏我已经留空，
  并且有判据守着（`tests/editor-line-ops.test.mjs` 的「这三行不许带没注册的加速键」，注入假键会变红）。
  将来若你决定跟 Sublime 档（Ctrl+F9 排 `EditorSortLines`），改法是把那行的第 3 个实参从 `''` 换成
  `'Ctrl F9'`，同时把键注册进 `src/keymapBindings.ts` / `src/keymap.ts` —— 两边同步，判据才不会红。
- 消费链路已经通了，不欠 App.vue 的挂点：命令在 `src/editorCommands.ts:221`（`line.sort` /
  `line.reverse` / `line.unique`），菜单行在 `src/menus/editMenu.ts:128-135`，
  「查找操作」的索引沿菜单树取行（`src/menuUi.ts:322` 的 `findMenuRow`）⇒ 三行已经可被搜到并执行。

## R1（要你定夺）：`Ctrl+Alt+Shift+↑/↓` 现在指向编辑器克隆光标，上游那对键是别的动作

事实（都是行号，不是我推测）：

- 上游 `EditorCloneCaretAbove` / `EditorCloneCaretBelow` 注册在
  `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219`，
  在 `$default.xml` 里**没有任何绑定**（只有 `Sublime Text.xml:280-285` 给过 `control alt UP/DOWN`）。
- `$default.xml:879-884` 把 `control alt shift UP` / `control alt shift DOWN` 给了
  `ResizeToolWindowUp` / `ResizeToolWindowDown`。
- 本仓现状（保留文件）：`src/components/CodeEditor.vue:865-866` 把 `Ctrl-Alt-Shift-Up/Down`
  绑到 `editingCommands['cursor.above']` / `['cursor.below']`；
  `src/menus/editMenu.ts:178-179` 两行的键位栏照抄了这对键。
- 本批把这两个名字的**实现**从 CodeMirror 的 `addCursorAbove`/`addCursorBelow` 换成了按上游
  `CloneCaretActionHandler.java:64-102` + `CaretImpl.java:845-893` 写的 `src/editorCaretClone.ts`
  （命令名没改 ⇒ 冻结的键位表不改就拿到新语义；`EditorCloneCaretAbove/Below` 的语义现已与上游一致）。

可选处置，你挑一个我就照你的决定改非保留面：
1. 保留现状（本仓把这对键给编辑器，接受与 `$default.xml` 的全局动作冲突）—— 我不动任何东西；
2. 把键让给 `ResizeToolWindowUp/Down`（上游口径）⇒ 你在 `CodeEditor.vue` 摘掉两行、
   我去把 `src/menus/editMenu.ts:178-179` 的键位栏改成 `''`（上游确实无键）；
3. 给克隆光标另挑一对键并同步两处 —— 需要你先定键，我不编。

可照抄（若选 2）：删掉 `src/components/CodeEditor.vue:865-866` 这两行

```ts
          { key: 'Ctrl-Alt-Shift-Up', preventDefault: true, run: editingCommands['cursor.above']! },
          { key: 'Ctrl-Alt-Shift-Down', preventDefault: true, run: editingCommands['cursor.below']! },
```

## R2（可选，不做也不影响可用性）：把上游 action id 显式注册进 `src/actionRegistry.ts`

`src/actionRegistry.ts` 里没有任何 `Editor*` 形状的条目（我 grep 过），而本仓「查找操作」已经能从菜单树
索引到这三行 ⇒ 这一步**不是必需**，只有当你想让上游 id 成为一等公民（宏录制 / 插件命令按 id 调用）时才做。
要注册的话，五条的 id 与文案照抄（文案 = `Presentation.text` 的上游原文）：

| id | 上游注册处 | 文案（`platform/platform-resources-en/src/messages/ActionsBundle.properties`） | 本仓处理器 |
|---|---|---|---|
| `EditorSortLines` | intellij.platform.ide.impl.actions.xml:262 | :173 `Sort Lines` | `editingCommands['line.sort']` |
| `EditorReverseLines` | 同上:263 | :174 `Reverse Lines` | `editingCommands['line.reverse']` |
| `EditorUniqueLines` | 同上:264 | :175 `Delete Duplicate Lines` | `editingCommands['line.unique']` |
| `EditorCloneCaretAbove` | 同上:219 | :121-122 `Clone Caret Above` / `Insert a secondary cursor in the line above …` | `editingCommands['cursor.above']` |
| `EditorCloneCaretBelow` | 同上:218 | :119-120 `Clone Caret Below` / `Insert a secondary cursor in the line below …` | `editingCommands['cursor.below']` |

（`EditorAction` 的子类都是包内私有，`final class SortLinesAction`（`SortLinesAction.java:9`）——
所以上游也只能靠 id 引用，没有公开类名可抄。）

## R3（下一轮的现成事实，本批没做）：`EditorAddCaretPerSelectedLine`

这一族**唯一有真键位**的一条，判词里属 C-优 第 ⑥ 条，派单没点名所以本批未做。核好的事实：

- 实现：`platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`
  （`ForEachCaret`；选区尾压在行首时不算那一行 `:31`；超过 `getMaxCaretCount()` 就整条不做事并提示
  `:33-36`；每个选中行**在行尾**放一个光标 `:41-51`；最后把原来那个光标删掉 `:53`）。
- 注册：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`；
  菜单：`platform/platform-impl/resources/idea/PlatformActions.xml:487`（EditMenu › EditSelectGroup，
  紧跟 `$SelectAll`）。
- 键位：`platform/platform-resources/src/keymaps/$default.xml:155-157` ⇒ **Shift+Alt+G**
  （`first-keystroke="shift alt G"`）。
- 文案：`platform/platform-resources-en/src/messages/ActionsBundle.properties:130`
  = `Add Carets to Ends of Selected Lines`。

顺带纠正一个容易踩的坑（派单里那句「Ctrl+Alt+Shift+J / SortLines 那组」）：
`Ctrl+Alt+Shift+J` 是 `SelectAllOccurrences`（`$default.xml:138-141`），
文案 `ActionsBundle.properties:125-126`，与排序行无关；本仓早已由
`editingCommands['occurrence.select']`（CodeMirror 的 `selectMatches`）+
`src/menus/editMenu.ts:85`、`:166` 承担，无需接线。
