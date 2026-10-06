# 接线请求 · 2026-10-06 · 键位/注册表 lane（keymap）

> 本 lane 本轮可改面只有四件保留文件：`src/keymap.ts`、`src/keymapBindings.ts`、
> `src/actionRegistry.ts`、`src/menus/types.ts`。下面四条都要动**别人的**文件（`src/App.vue` 独占给
> appvue、`src/components/CodeEditor.vue` 与 `src/menus/editMenu.ts` 在 caretops 名下、
> `src/menuUi.ts` 无主），所以按 `docs/batches-2026-10-06-buckets.md` §4 交请求。
> 每条都写「现在接上会怎样、不接会怎样」，判据编号在最后。

## R1 · App.vue 把 `runEditor` 塞进 `createKeymap`（编辑器一族动作的注册表半边）

- 目标文件：`src/App.vue` 第 1825-1847 行那个 `createKeymap({ ... })` 实参对象。
- 要接什么：加一个成员 `runEditor,` —— 函数已经存在（`src/App.vue:1405` 的 `function runEditor(name: string)`，
  菜单那一路 `editable()` 用的就是它，`:1438`）。
- 已就绪的另一侧（本 lane 已落）：`src/keymap.ts:112` 的可选字段 `runEditor?: (name: string) => unknown`
  与 `:427` 的 `if (runEditor) registerEditorActions(EDITOR_ACTIONS, name => runEditor(name), () => !!active.value)`。
- 接上之后：`ACTIONS.has('line.sort'|'line.reverse'|'line.unique'|'cursor.above'|'cursor.below'|'brace.match')`
  为真 ⇒ 插件命令（`src/pluginCommands.ts:94` 的 `hasAction`）、命令补全（`src/lspCompletion.ts:88` 读
  `ACTIONS.ids()`）、宏的 `hasAction` 都按 id 认得这六条。
- 不接会怎样：**什么都不会坏，也不会假装能跑** —— `keymap.ts:427` 那行是 `if (runEditor)`，
  拿不到执行入口就整批不注册（注册一个跑不动的动作 = 本仓铁律里的假控件）。
  代价只是这六条继续只有菜单行入口、没有注册表入口。
- 差异说明：`menuUi.ts:246` 的 actionList 按 id 去重且**菜单行优先**，所以接上之后「查找操作」里
  不会多出第二行（六条的 id 与 `src/menus/editMenu.ts:128`/`:129`/`:135`/`:176`/`:178`/`:179` 逐字相同）。
- 上游依据：见 §R1 附表（本 lane 已逐条核过，行号写在 `src/keymapBindings.ts:197-217` 的注释里）。

## R2 · App.vue 把 `gotoSuper` / `gotoTest` / `gotoRelated` 塞进 `createKeymap`

- 目标文件：同 R1 的那个实参对象（`src/App.vue:1825-1847`）。
- 要接什么：`gotoSuper, gotoTest, gotoRelated,` —— 三个函数已经在 `src/App.vue:1219` 从
  `createLspNavigation` 解构出来了，`:1499` 也已经喂给 `navigateMenuContext`（所以**菜单行现在就在**）。
- 已就绪的另一侧：`src/keymap.ts:119-121` 的三条可选字段、`:390-392` 的 `tailActions` 三条、
  `src/keymapBindings.ts:119-126` 的三条键位（Ctrl+U / Ctrl+Shift+T / Ctrl+Alt+Home，
  `$default.xml:251-253`/`:254-256`/`:257-259`）。
- **这条是修 bug，不是加功能**：菜单那三行早就写着加速键（`src/menus/navigateMenu.ts:153`/`:161`/`:168`），
  而全局分派表里根本没有这三把键 ⇒ 用户看到的是「写着 Ctrl+Shift+T、按下去没反应」。
  桶 4b 的 W1 键位半边（`docs/wiring-requests-2026-10-06-bucket4b.md:22-23`）就是这一条。
- 不接会怎样：不吞键、不假动作 —— `src/keymap.ts:416-418` 的 `unwired` 会把没给处理器的那几条
  从**注册**这一步挑掉，`ACTIONS.has` 为假 ⇒ 命中键位也原样放行。菜单行照旧能点。
  代价是菜单上那三格加速键继续是空头支票。
- 判据：`tests/keymap-bindings.test.mjs` 的「导航三条新键位…」（可用性真值表 + 上游精确匹配的串味检查）。

## R3 · 把 Ctrl+Alt+Shift+↑/↓ 让回上游的主人（`EditorCloneCaretAbove/Below` 的摘键请求）

- 判决（本 lane 定了，口径 = caretops 那份请求里的**处置 2**）：这对键属工具窗口调整大小，不属克隆光标。
  它提的 R1 事实我另开 `$default.xml` 复核过，全部成立（不是照抄它的结论）：
  - `$default.xml:879-881` = `ResizeToolWindowUp` 的 `control alt shift UP`、`:882-884` = `ResizeToolWindowDown`
    的 `control alt shift DOWN`；
  - `EditorCloneCaretAbove`/`EditorCloneCaretBelow` 在 `$default.xml` 里**零命中**（我把整个
    `platform/platform-resources/src/keymaps/` 十张表 grep 了一遍），只有
    `keymaps/Sublime Text.xml:280`/`:284` 给过 `control alt UP`/`DOWN`（另一档
    `Sublime Text (Mac OS X).xml:309`/`:312`）；
  - 本仓的全局分派表已经按上游做了：`src/keymap.ts:305-310` 把 Ctrl+Alt+Shift+方向键给
    `stretchToolWindow`（= `ResizeToolWindowLeft/Right/Up/Down`），这一条**不动**。
- 要接什么（caretops / 编辑器 lane）：删掉 `src/components/CodeEditor.vue:865-866` 那两行
  （`Ctrl-Alt-Shift-Up`/`Ctrl-Alt-Shift-Down` → `editingCommands['cursor.above']`/`['cursor.below']`），
  并把 `src/menus/editMenu.ts:178-179` 的第三个实参从 `'Ctrl Alt Shift ↑'`/`'↓'` 改成 `''`。
  命令实现本身**留着**（菜单行与「查找操作」照旧可达，上游也是只有动作没有键）。
- 我这边跟着改（这两条在我文件里，摘完键再改才不会红）：`src/keymapBindings.ts:225-230` 的
  `cursor.above`/`cursor.below` 从 `{ source: 'repo', display: … }` 降到 `{ source: 'none' }`。
  现在登记成 `repo` 档是**如实描述现状**（本仓编辑器 keymap 真绑着，`boundAt` 给的是 `CodeEditor.vue:865`/`:866`），
  不是给它发上游牌照 —— 两档的 `upstream` 串里都写明了「上游 $default.xml 没有这个动作的键位」与撞车对象。
- 判据：`tests/keymap-bindings.test.mjs` 的「编辑器一族…」。摘完键后那条 `none` 分支会自动去核
  「编辑器 keymap 里不许再绑着这把键」，所以漏删会红。

## R4 · 问题面板选中行的 Alt+Enter（桶 2 · 2b2 的 R1：判定 = 现在不注册，缺两件前置）

- 上游核对（自己开的文件，不是照抄判词）：
  `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103` 的
  `ProblemsView.QuickFixes` 写的是 **`use-shortcut-of="ShowIntentionActions"`**，
  而 `ShowIntentionActions` 的键在 `$default.xml:480-482` = `alt ENTER` —— 2b2 那份请求的键位结论成立。
- 但**同一把键本仓已经给编辑器用了**：`src/components/CodeEditor.vue:781` 把 `Alt-Enter` 绑到
  `emitSemantic('codeAction')`，菜单行是 `src/menus/codeMenu.ts` 的 `codeAction`（`keys: 'Alt Enter'`）。
  上游这本来就是**同一个动作**（`KeymapPanel.isShortcutConflictAction` 第 3 条排除：`use-shortcut-of`
  指向别人 = 其实同一个动作，见 `src/keymapBindings.ts:308-320` 的注释），
  ⇒ 正确形态不是「再加一条 Alt+Enter 的键位」，而是**面板自己认领这把键**。
- 缺的两件前置（都不在本 lane）：
  1. `src/components/ProblemsPanel.vue` 现在**没有**任何 `defineExpose`（`:226` 的 `openRowMenu(row, event)`
     是组件内部函数，行上的入口在 `:658`），2b2 自己说下一轮加 `openMenuForSelected()`；
  2. 宿主得知道「此刻焦点在问题面板」才能把 Alt+Enter 分给面板而不是编辑器 —— `src/App.vue` 的
     `createKeymap` 那一路只有 `workspace/editor/lsp` 三面状态（`src/keymapBindings.ts:26-30`），
     没有面板焦点位。
- 因此本轮**没有**把它写进 `KEY_BINDINGS`：写进去就是一条命中后只 `preventDefault` 不干事的假绑定，
  而且 `tests/keymap-bindings.test.mjs:106` 的「动作映射与表一一对应」会立刻要求我在 `tailActions` 里
  配一个空转处理器 —— 那正是本仓铁律要避免的形状。
- 前置齐了之后的照抄配方（给我或下一轮）：
  `KeyBindingState` 加 `problems?: boolean`，条目形如
  `{ id: 'problems.view.quickFixes', label: '操作（选中问题）', display: 'Alt Enter', scope: 'tool-window',
     chord: { key: 'Enter', alt: true, forbid: ['ctrl', 'shift'] }, when: s => s.problems === true,
     upstream: '$default.xml:480-482 ShowIntentionActions（面板侧 use-shortcut-of 见 problemView.ui.xml:100-103）' }`，
  并把 `App.vue` 的焦点位与 `ProblemsPanel` 的出口一并接上；三条都到位再落键位表，判据才不会红。

## R5 · 两条陈旧计数注释（非功能，`src/menuUi.ts` 无主/不在我派单里）

- `src/menuUi.ts:85` 写「`keymapBindings.ts` 的 **25** 个动作 id 里有 **21** 个在 `src/menus/*` 找不到对应行」：
  本轮之后是 **30** 条、其中 9 条有同 id 菜单行 ⇒ 应改成「30 个里有 21 个」（21 那个数恰好还成立：
  `navigate.super`/`navigate.related` 有行、`navigate.test` 也有行，另 9 条一一对上）。
- `src/searchEverywhereHost.ts:80` 的「那 21 个」同口径，不用改。
- 我没动这两处：`menuUi.ts` 不在我的四个授权文件里，注释也不被任何判据读。

## 判据（本轮新增/改动，全部只加不减）

- `tests/keymap-bindings.test.mjs`：新增 3 条 ——
  「编辑器一族：上游没键位的不编键位，写了键位的必须真绑着（菜单文案与键位栏同源）」、
  「菜单手写的 keys 必须等于键位表里的 display（两处不许漂移）」（实测核到 9 对）、
  「导航三条新键位：可用性与菜单行 enabled 同源，且上游的精确匹配不许串味」。
- `tests/action-registry.test.mjs`：新增 1 条「编辑器一族注册进动作注册表：不凭空长加速键，run 走宿主的 runEditor」。
- 反向验证数字写在 `docs/batch-2026-10-06-keymap.md` §4。
