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

---

# 收尾（2026-10-06 caretops2）—— 本文件这三条的现状与**只剩 R3 第 4 处**

判词全表与本批数字在 `docs/batch-2026-10-06-caretops2.md`。

## R1 = 已闭环（不是我落的，登记现场）

处置按本文件 §R1 的**选项 2** 由 keymap2 那批落完：
`src/components/CodeEditor.vue:865-871`（两行绑定已摘，只剩说明注释）、
`src/keymapBindings.ts:235-238`（两条从 `repo` 降到 `source: 'none'`）、
`src/menus/editMenu.ts:195-196`（键位栏空串）、
`tests/editor-caret-clone.test.mjs:129-138`（断言按上游改成反向钉子）。
上游依据我本批重开核过：`platform/platform-resources/src/keymaps/$default.xml:879-884` 把
`control alt shift UP/DOWN` 给了 `ResizeToolWindowUp`/`ResizeToolWindowDown`；
`EditorCloneCaretAbove/Below` 在 `platform/platform-resources/src/keymaps/` 的出厂档里**零命中**
（只有 `Sublime Text.xml:280/:284`、`Sublime Text (Mac OS X).xml:309/:312` 与
`plugins/keymaps/vscode-keymap/resources/keymaps/VSCode.xml:130/:134` 给过）。**本文件这条请求可以关掉。**

## R2 = 已闭环（按本仓口径）

`src/keymapBindings.ts:228-241` 的 `EDITOR_ACTIONS` 六条都带 `upstreamId`，`keywords` 内含上游 id；
注册走 `src/keymap.ts:427` → `src/actionRegistry.ts:166-180`（`registerEditorActions`）。
判据 `tests/keymap-bindings.test.mjs:143-144` 钉的就是「`upstreamId` 以 `Editor` 开头 + `keywords` 必含它」，
⇒ 「查找操作」按 `EditorSortLines` 搜得到。**没有**把 `EditorSortLines` 做成第二个 id（本仓注册表按 id 唯一，
做了就是两条入口指向同一命令 ⇒ 面板双行），R2 原写「可选」，现状即合格。

## R3-收尾（**要你落的一处**：`Shift+Alt+G` 的键位注册；四处里前三处本批已落）

本批已落（模块/菜单侧，无需你动）：

- `src/editorCaretPerLine.ts`（新建 104 行，执行体）
- `src/editorCommands.ts:59`（import）+ `:246`（`'caret.perLine': addCaretPerSelectedLineCommand,`）
- `src/menus/editMenu.ts:121`（菜单行，紧跟「全选」`:109`，位置对齐上游
  `platform/platform-impl/resources/idea/PlatformActions.xml:485-487`；键位栏**留空**等你这一步）
- `tests/editor-caret-per-line.test.mjs`（8 条判据，含一条「键位没注册就不许写加速键」的门禁）

### 第 4 步（保留文件）· `src/keymapBindings.ts` 的 `EDITOR_ACTIONS` 加第七条

形状照本文件 §R1/R2 里已有的 `brace.match` 那条（`source: 'upstream'` + `cm` + `boundAt`）。
建议插在 `{ id: 'brace.match', … }` 之后、数组收尾前：

```ts
  { id: 'caret.perLine', upstreamId: 'EditorAddCaretPerSelectedLine', label: '在所选各行末尾添加光标',
    keywords: 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine',
    command: 'caret.perLine', key: { source: 'upstream', display: 'Shift Alt G', cm: 'Shift-Alt-G',
      boundAt: 'src/components/CodeEditor.vue:<你那一行的真实行号>',
      upstream: '键位 platform/platform-resources/src/keymaps/$default.xml:155-157 = shift alt G；注册 platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358；菜单 platform/platform-impl/resources/idea/PlatformActions.xml:485-487；文案 platform/platform-resources-en/src/messages/ActionsBundle.properties:130（该 id 没有 .description）；实现 platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54' } },
```

`Shift-Alt-G` 在本仓**没人占**（`grep -n "Alt-G\|Shift Alt G" src/keymapBindings.ts src/keymap.ts src/components/CodeEditor.vue`
本批实跑零命中），`tests/keymap-bindings.test.mjs:17` 的 `keymapConflicts(KEY_BINDINGS)` 不受影响（这条进的是
`EDITOR_ACTIONS`，不进 `KEY_BINDINGS`）。

### 第 5 步 · `src/components/CodeEditor.vue` 的编辑器 keymap 加一行

挂在克隆光标那族注释块（`:865-871`）之后、`Alt-j`（现 `:872`）之前，逐字：

```ts
          // AddCaretPerSelectedLine = Shift+Alt+G（$default.xml:155-157；实现
          // AddCaretPerSelectedLineAction.java:22-54）。命令只走这里与菜单行，没有别的入口。
          { key: 'Shift-Alt-G', preventDefault: true, run: editingCommands['caret.perLine']! },
```

然后把上面 `boundAt` 的 `<你那一行的真实行号>` 填成那一行（`tests/keymap-bindings.test.mjs:157-160`
会核「`boundAt` 那一行必须真有 `key: '<cm>'`」，**行号漂了就会红**，这是刻意的）。

### 第 6 步 · 两处「键位还没注册」的临时钉子要同步翻（**不是放松断言，是钉错了当下状态**）

1. `src/menus/editMenu.ts:121`（当前逐字）

```ts
    ctx.editable('caret.perLine', '在所选各行末尾添加光标', '', 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine'),
```

改成（只把第 3 个实参 `''` 换成 `'Shift Alt G'`）：

```ts
    ctx.editable('caret.perLine', '在所选各行末尾添加光标', 'Shift Alt G', 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine'),
```

改完记得把 `src/menus/editMenu.ts:110-120` 那段注释里「键位栏**留空**」的说明一起改掉（它写的是当下状态）。

2. `tests/editor-caret-per-line.test.mjs:91`（当前逐字）

```ts
  assert.equal(row[2], '', '键位注册（keymapBindings/CodeEditor 都是保留文件）没落地之前，这一行不许写 Shift Alt G')
```

改成（同一条判据的另一半，键位落地后必须成立；`tests/keymap-bindings.test.mjs:147-148` 已经在要求
「菜单键位栏 == 注册条目的 `key.display`」，两边同向，不会互相打脸）：

```ts
  assert.equal(row[2], 'Shift Alt G', '键位已注册 ⇒ 菜单键位栏必须等于注册条目的 display（上游 $default.xml:155-157）')
```

3. 文案性计数（不改行为，顺手即可）：`src/keymap.ts:108`、`:421`、`tests/keymap-bindings.test.mjs:126`、
`tests/action-registry.test.mjs:168` 都写着「那六条」，加了第七条就是「那七条」。

### 做不到 / 不要照着做

- 上游超限会弹 balloon（`AddCaretPerSelectedLineAction.java:33-36` 调 `EditorUtil.notifyMaxCarets`）：
  本仓没有编辑器内 balloon 通道 ⇒ `src/editorCaretPerLine.ts` 头部第 2 条差别已经写明「整条不动作且静默」，
  **不要**为它编一条提示文案或新控件。
- 上游 `:44-48` 那个「先把原光标挪开再 addCaret」不需要照搬（IDEA 在同点已有光标时拒绝新增，
  `platform/editor-ui-api/src/com/intellij/openapi/editor/CaretModel.java:236-241`；CodeMirror 没这条限制，
  本仓改成撞点去重，见 `src/editorCaretPerLine.ts:70-74`）。
- 别再给 `line.sort` / `line.reverse` / `line.unique` / `cursor.above` / `cursor.below` 补键位
  （本文件开头与 §R1 已经核过：出厂 `$default.xml` 里没有它们）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 已闭环**（按选项 2 由 keymap2 批落）：`CodeEditor.vue:865-871` 两行绑定已摘、`keymapBindings.ts:235-238` 降 `source: 'none'`、`editMenu.ts:195-196` 键位栏空。
- **R2 已闭环**（`keymapBindings.ts:228-241` 的 `EDITOR_ACTIONS` 带 `upstreamId`）。
- **R3 第 4 步 / 第 5 步 / 第 6 步未落** —— 目标 `src/keymapBindings.ts`（保留文件）+ `src/components/CodeEditor.vue`（禁改清单）+ `tests/editor-caret-per-line.test.mjs`（非本 lane）。复核 `grep caret.perLine` 只命中 `src/menus/editMenu.ts:121`（键位栏仍空串）⇒ `Shift+Alt+G` 键位未注册。需 **keymap owner + CodeEditor owner** 同批落（三步必须同批，否则菜单键位栏与注册条目不一致会红）。

结论：R1/R2 已闭环；R3 转给 keymap/CodeEditor owner。
