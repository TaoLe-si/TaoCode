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

## R3 · 把 Ctrl+Alt+Shift+↑/↓ 让回上游的主人（`EditorCloneCaretAbove/Below` 的摘键请求）——**已落**（keymap2，2026-10-06）

- 判决复核（keymap2 另开一遍上游，不是照抄本文原判词）：
  - `platform/platform-resources/src/keymaps/$default.xml:879-881` = `ResizeToolWindowUp` 的
    `control alt shift UP`、`:882-884` = `ResizeToolWindowDown` 的 `control alt shift DOWN`；
  - `EditorCloneCaretAbove`/`EditorCloneCaretBelow` 在 `$default.xml` **零命中**（对
    `platform/platform-resources/src/keymaps/` 十张表整目录 grep 过）；仅有的两处绑定都在**别的方案**里：
    `platform/platform-resources/src/keymaps/Sublime Text.xml:280`/`:284` = `control alt UP`/`DOWN`，
    插件方案 `plugins/keymaps/vscode-keymap/resources/keymaps/VSCode.xml:130-136` =
    `ctrl alt up` + `shift ctrl alt up`（`VSCode.xml:1` 写 `parent="$default"`，即它是默认表的**派生方案**，不是出厂默认）；
  - **代码里也不声明键位**：`platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretAbove.java:8-11`
    只是 `new EditorAction(new CloneCaretActionHandler(true))`（无 `registerCustomShortcutSet`），
    `platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java:24` 起是纯 handler；
    `platform/ide-core/src/com/intellij/openapi/actionSystem/IdeActions.java:67-68` 只有 id 常量；
    `platform/editor-ui-api/` 整个目录 grep `CloneCaret` **零命中** ⇒ 这一族的键位只可能来自键位表，
    而默认表没给 —— 「上游给没给这族键」= **没给**。
  - 本仓的全局分派表早已按上游做了：`src/keymap.ts:305-310` 把 Ctrl+Alt+Shift+方向键给
    `stretchToolWindow`（= `ResizeToolWindowLeft/Right/Up/Down`），这一条**不动**；
    且 `src/App.vue:1918` 是 `window.addEventListener('keydown', onKey, true)`（**捕获阶段**），
    编辑器聚焦时那两行 CodeMirror 键位与全局那一条**同时吃到一次按键**（上游只有 resize 一个行为）。
- 落掉的改动（摘键，不留「与上游不同键位的假一致」）：
  `src/components/CodeEditor.vue` 删掉 `Ctrl-Alt-Shift-Up`/`Ctrl-Alt-Shift-Down` 两行绑定；
  `src/menus/editMenu.ts` 两行的第三个实参（键位栏）改成 `''`，keywords 顺手补上游 id（菜单行在
  `menuUi.ts:246` 的按 id 去重里**优先**，补了才按 `EditorCloneCaretAbove` 搜得到）；
  `src/keymapBindings.ts` 的 `cursor.above`/`cursor.below` 从 `repo` 档降到 `none` 档。
- 命令实现与菜单行都留着（上游也是只有动作没有键）：`src/editorCaretClone.ts`、`src/editorCommands.ts` 的
  `cursor.above`/`cursor.below` 一字未动。
- 判据：`tests/keymap-bindings.test.mjs` 新增「克隆光标那对不占工具窗口调整大小的键（R3 摘键后的真值表）」；
  `tests/editor-caret-clone.test.mjs` 里原写 `assert.match` 的那两行（钉着「编辑器 keymap 里有这两把键」）
  按上游改成 `assert.doesNotMatch` + 命令表/菜单行的正向钉子 —— 留痕见 `docs/batch-2026-10-06-keymap2.md` §1/§4。

## R4 · 问题面板选中行的 Alt+Enter（桶 2 · 2b2 的 R1）——**仍未注册**；两件前置只到了一件

- 上游核对（自己开的文件，不是照抄判词）：
  `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103` 的
  `ProblemsView.QuickFixes` 写的是 **`use-shortcut-of="ShowIntentionActions"`**，
  而 `ShowIntentionActions` 的键在 `$default.xml:480-482` = `alt ENTER` ⇒ 键位结论成立。
- 同一把键本仓已给编辑器：`src/components/CodeEditor.vue` 的 `Alt-Enter` → `emitSemantic('codeAction')`，
  菜单行 `src/menus/codeMenu.ts` 的 `codeAction`（`keys: 'Alt Enter'`）。上游这本来就是**同一个动作**
  （`KeymapPanel.isShortcutConflictAction` 第 3 条排除，见 `src/keymapBindings.ts` 的注释）
  ⇒ 正确形态是**面板自己认领这把键**，不是再加一条 Alt+Enter。
- 前置逐条重核（本轮**打开代码看的**，原文档那句「现在没有任何 defineExpose」已过时）：
  1. **已到位**：`src/components/ProblemsPanel.vue` 有 `function openMenuForSelected()` 与
     `defineExpose({ openMenuForSelected })`（现落在 `:302-310` 一带），聚焦行即选中的等价物
     （`rememberSelectedRow`，行上 `@focusin`）—— 2b2 说「下一轮加」的那件事已经加了。
  2. **仍缺**：宿主不知道「此刻焦点在问题面板」。证据三处：
     `src/keymapBindings.ts:26-30` 的 `KeyBindingState` 只有 `workspace/editor/lsp` 三面；
     `src/keymap.ts:418-419` 与 `:426` 喂给 `registerKeymapActions`/`findKeyBinding` 的就是那三个字段；
     `src/App.vue:2238` 渲染 `<ProblemsPanel …>` **没有模板 ref** ⇒ 全仓没有任何地方拿得到那个出口，
     `openMenuForSelected()` 现在是**只有判据读它、没有调用者**的暴露（消费链路缺宿主那一环）。
- 因此本轮**没有**把它写进 `KEY_BINDINGS`：缺②就写不出 `when`，写进去是一条命中后只 `preventDefault`
  不干事的假绑定，而 `tests/keymap-bindings.test.mjs` 的「动作映射与表一一对应」会立刻要求
  `tailActions` 配一个空转处理器 —— 正是本仓铁律要避免的形状。
- 已钉住的红线（新判据）：`tests/keymap-bindings.test.mjs` 的
  「问题面板的 Alt+Enter：两件前置只到了一件，缺焦点位就不进表（R4 判定）」—— 它同时钉
  ①面板出口在位、②`App.vue` 仍无 `<ProblemsPanel … ref=`、③表里 Alt+Enter 零主人、
  ④每条 `when` 只许读 `KeyBindingState` 真有的字段（读到表外字段得到 `undefined` = 永远按不到的死绑定）。
- **要主代理接的线**（`src/App.vue` 归 appvue，本轮禁改）：给 `<ProblemsPanel>` 加模板 ref +
  一个「面板焦点位」（`focusin` 落到 `ref<boolean>`，Esc/编辑器聚焦时清），再把两者塞进
  `createKeymap({ …, problemsPanel, problemsFocused })`；`src/keymap.ts` 侧我这边随时能接
  （`KeyBindingState` 加 `problems?: boolean`、`tailActions` 加 `'problems.view.quickFixes'`，
  键位条目照下面这条抄）：
  `{ id: 'problems.view.quickFixes', label: '操作（选中问题）', display: 'Alt Enter', scope: 'tool-window',
     chord: { key: 'Enter', alt: true, forbid: ['ctrl', 'shift'] }, when: s => s.problems === true,
     upstream: '$default.xml:480-482 ShowIntentionActions（面板侧 use-shortcut-of 见 problemView.ui.xml:100-103）' }`
  —— 三条（App.vue 的 ref、焦点位、`createKeymap` 实参）都到位之后再落表，同时把上面那条判据里的②翻成正向断言。

## R5 · 陈旧计数注释 ——**已订正**（keymap2）

- `src/menuUi.ts:85`：原写「`keymapBindings.ts` 的 **25** 个动作 id 里有 **21** 个在 `src/menus/*` 找不到对应行」；
  本轮自己数过：`KEY_BINDINGS` 共 **30** 条，其中 **9** 条在 `src/menus/*` 有同 id 行
  （`file.saveAll`、`navigate.super/test/related`、`refactor.changeSignature/safeDelete/extractVariable/inline`、
  `edit.copyReference`），**21** 条没有 ⇒ 改成「30 个里有 21 个」（21 那个数恰好还成立）。
  同一段里 `keymap.ts:384` 这个锚点也漂了（`registerKeymapActions` 现在在 `src/keymap.ts:418`），一并订正。
- `src/searchEverywhereHost.ts:80` 的「那 **21** 个」经同一只表复核 = 21，**仍然成立**，不改。
- 这两个数现在由 `tests/keymap-bindings.test.mjs` 的「menuUi 与 searchEverywhereHost 的计数注释与键位表同步」
  **现算**比对（正则抠注释里的数字与表实际条数比），以后再进表就不会再漂。


## 判据（本轮新增/改动，全部只加不减）

- `tests/keymap-bindings.test.mjs`：新增 3 条 ——
  「编辑器一族：上游没键位的不编键位，写了键位的必须真绑着（菜单文案与键位栏同源）」、
  「菜单手写的 keys 必须等于键位表里的 display（两处不许漂移）」（实测核到 9 对）、
  「导航三条新键位：可用性与菜单行 enabled 同源，且上游的精确匹配不许串味」。
- `tests/action-registry.test.mjs`：新增 1 条「编辑器一族注册进动作注册表：不凭空长加速键，run 走宿主的 runEditor」。
- 反向验证数字写在 `docs/batch-2026-10-06-keymap.md` §4。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R1 已接线**：`src/App.vue:1845` 的 `createKeymap({...})` 实参已含 `runEditor`。
- **R2 已接线**：同对象已含 `gotoSuper, gotoTest, gotoRelated`。
- **R3 已落**（keymap2）。
- **R4（问题面板选中行 Alt+Enter）未注册** —— 目标 `src/actionRegistry.ts` + `src/keymapBindings.ts`（保留文件，非本 lane）。组件侧 `ProblemsPanel.vue:325` 的 `openMenuForSelected()` 已就绪。需 action/keymap owner。
- **R5 已订正**。

结论：R1/R2 已接线；R4 转给 action/keymap owner。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「R1/R2 已接线；R4 转给 action/keymap owner。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
