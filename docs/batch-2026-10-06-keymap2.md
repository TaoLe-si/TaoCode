# batch-2026-10-06 · keymap2 lane —— 把 keymap 请求单的 R3 / R4 / R5 判完并落掉能落的部分

上游基准树：`D:/Backup/Downloads/intellij-community-master/intellij-community-master`（下面每个上游行号都是本次亲自 `sed`/`grep` 打开过的，不是转抄判词）。
先读了 `.tools/agent-rules.md`（本仓无 AGENTS.md）。未 commit、未 push、未用任何 git 丢弃命令；保留文件（`src/App.vue`/`src/bridge.ts`/`src/style.css`/`src/tokens.css`/`src/settingsModel.ts`/`CMakeLists.txt`/`scripts/verdict_table.py`/`docs/inventory/*.md`）一字未动。

## 1. 判词表

| 族 / 项 | 判定 | 上游相对路径:行号（亲自核过） | 本仓落点 | 一句话说明 |
|---|---|---|---|---|
| **R3** · `Ctrl+Alt+Shift+↑/↓` 的主人 | `[x]` 已判 + 已落（**摘键**） | `platform/platform-resources/src/keymaps/$default.xml:879-881` = `ResizeToolWindowUp` 的 `control alt shift UP`、`:882-884` = `ResizeToolWindowDown` 的 `control alt shift DOWN` | `src/keymap.ts:305-310`（`stretchToolWindow` 四条方向，未动） | 这对键在上游属工具窗口调整大小，本仓全局分派表已经照做 ⇒ 编辑器那一族不配占它 |
| R3 · `EditorCloneCaretAbove/Below` 上游到底给没给键 | `[x]` 判 = **没给** | 注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219`；动作组 `platform/platform-impl/resources/idea/PlatformActions.xml:199-200`；实现 `platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretAbove.java:8-11`（只有 `new EditorAction(new CloneCaretActionHandler(true))`，**无** `registerCustomShortcutSet`）与 `…/CloneCaretActionHandler.java:24`（纯 handler）；id 常量 `platform/ide-core/src/com/intellij/openapi/actionSystem/IdeActions.java:67-68`；`platform/editor-ui-api/` 全目录 grep `CloneCaret` **零命中** | `src/keymapBindings.ts:225-231`（`EDITOR_ACTIONS` 两条降到 `none`）、`src/components/CodeEditor.vue`（删掉 `Ctrl-Alt-Shift-Up`/`Down` 两行绑定）、`src/menus/editMenu.ts:195-196`（键位栏改空串） | 键位只可能来自键位表，而默认表没给 ⇒ 本仓那两行是**抢上游工具窗口的键**，不是「另一种一致」；不留与上游不同键位的假一致 |
| R3 · 别的方案给过什么键（不作为发牌依据） | `[x]` 登记 | `platform/platform-resources/src/keymaps/Sublime Text.xml:280`/`:284` = `control alt UP`/`DOWN`；插件方案 `plugins/keymaps/vscode-keymap/resources/keymaps/VSCode.xml:130-132`/`:134-136` = `ctrl alt up`+`shift ctrl alt up`（`VSCode.xml:1` 写 `parent="$default"`，是派生方案） | `src/keymapBindings.ts` 的 `cursor.above`/`cursor.below` 的 `upstream` 串、`src/editorCaretClone.ts:10-17` | 派生方案给过键 ≠ 出厂默认给键；移植的是 `$default.xml` 那一档 |
| R3 · 命令本身 | `[x]` 保留（不删实现） | 同注册处 `intellij.platform.ide.impl.actions.xml:218-219`（上游也是「有动作、无键位」） | `src/editorCaretClone.ts`、`src/editorCommands.ts:242`、`src/menus/editMenu.ts:195-196` 菜单行 | 摘键 ≠ 删命令：入口 = 编辑菜单 + 「查找操作」（`runEditor` 那一路 R1 已接） |
| **R4** · 问题面板选中行的 Alt+Enter | `[~]` 部分：前置①到位、前置②缺 ⇒ **仍不注册** | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`（`ProblemsView.QuickFixes` 的 `use-shortcut-of="ShowIntentionActions"`）+ `platform/platform-resources/src/keymaps/$default.xml:480-482`（`ShowIntentionActions` = `alt ENTER`） | 出口已在：`src/components/ProblemsPanel.vue:302`（`openMenuForSelected()`）、`:310`（`defineExpose({ openMenuForSelected })`）；新判据 `tests/keymap-bindings.test.mjs`「问题面板的 Alt+Enter…」 | 原请求写「面板没有任何 defineExpose」**已过时**（留痕：原写 X、实际 Y）；真正缺的是宿主那一件，见 §6/§7 |
| R4 · 缺的那一件（证据） | `[ ]` 未做（不归本 lane） | —— | `src/keymapBindings.ts:26-30`（`KeyBindingState` 只有 `workspace/editor/lsp`）、`src/keymap.ts:418-419` 与 `:426`（喂给注册/匹配的就是那三面）、`src/App.vue:2238`（`<ProblemsPanel …>` **没有模板 ref**） | 没有焦点位就写不出 `when`；没有 ref 就没人能调那个出口 ⇒ 进表 = 一条命中后只 `preventDefault` 不干事的假绑定 |
| **R5** · `src/menuUi.ts:85` 的计数注释 | `[x]` 已订正 | 数是自己跑的：`KEY_BINDINGS` = **30** 条，`src/menus/*.ts` 里有同 id 行的 **9** 条（`file.saveAll`、`navigate.super/test/related`、`refactor.changeSignature/safeDelete/extractVariable/inline`、`edit.copyReference`），无行的 **21** 条 | `src/menuUi.ts:85`（25→**30**，21 保留）+ 同段 `keymap.ts:384`→`:418` 的锚点订正 | 旧数 25 是 R1/R2 进表之前写的；新数由判据现算，以后再进表不会漂 |
| R5 · `src/searchEverywhereHost.ts:80` 的「那 21 个」 | `[x]` 已复核 = **不改** | 同一只表算出来的 orphan = 21 | `src/searchEverywhereHost.ts:80` | 那个数恰好还成立（原判词说的「不用改」经核实成立），改了就成假订正 |
| 判据门（键位改动必须动真值表） | `[x]` 已加 3 条 | 上游依据同上各行 | `tests/keymap-bindings.test.mjs`（11→**14** 条）、`tests/editor-caret-clone.test.mjs`（1 条改写） | display 串 / `source` 三态 / `when` 谓词 / 计数注释全部逐字符钉住，见 §4 的三次「该红」 |

## 2. 改动文件清单（`wc -l`）

| 文件 | 本批前 | 本批后 | 这次改了什么 |
|---|---:|---:|---|
| `src/components/CodeEditor.vue` | 1142 | 1144 | 删 `Ctrl-Alt-Shift-Up`/`Ctrl-Alt-Shift-Down` 两行绑定，换成 2 行留痕注释。门控口径：进场 1143 → 我第一版注释太长顶到 **1148 > 登记上限 1147**（module-size 当场红）→ 压到 2 行后收工 **1145 ≤ 1147**；期间并行代理也在此文件净 −1 行左右 ⇒ 数字含他们的量，上限未调高、未登记豁免 |
| `src/menus/editMenu.ts` | 205 | 210 | `cursor.above`/`cursor.below` 两行键位栏改 `''`，keywords 补上游 id（菜单行在 `menuUi.ts` 的按 id 去重中优先 ⇒ 按 `EditorCloneCaretAbove` 也搜得到），加 4 行依据注释 |
| `src/keymapBindings.ts` | 425 | 433 | `EDITOR_ACTIONS` 的两条 `repo`→`none`；族头注释补「实现类不声明键位 / editor-ui-api 零命中 / VSCode 是派生方案 / 判决=摘键」；`brace.match` 的 `boundAt` 跟着盘上真行号走（现 `:840`，由并行代理同批改成正向核行逻辑） |
| `src/editorCaretClone.ts` | 185 | 188 | 头注释的键位段改写：那两行编辑器绑定**已摘**、命令与菜单入口留着、证据指 `docs/batch-2026-10-06-keymap2.md` |
| `src/menuUi.ts` | 365 | 367 | R5：`25 个`→`30 个`（21 不动）、`keymap.ts:384`→`:418`，并注明两个数由判据现算 |
| `tests/keymap-bindings.test.mjs` | 222 | 326 | 新增 3 条：R3 真值表 / R4 前置判定 / R5 计数注释同步（11→14 条） |
| `tests/editor-caret-clone.test.mjs` | 158 | 161 | 那条「命令：走的是命令表里的 cursor.above/cursor.below」：`assert.match(编辑器里有这两把键)` ⇒ `assert.doesNotMatch`（回潮即红）+ 命令表与菜单行的正向钉子 |
| `docs/wiring-requests-2026-10-06-keymap.md` | 108 | 145 | R3 改成「已落」并补新证据；R4 改成「前置只到了一件」+ 照抄配方；R5 改成「已订正 + 现算门」；删掉被取代的旧正文 |

> 注：并行代理在 11:0x 前后的提交（`200232e`「多域收工批量」）把本批一部分改动带进了 HEAD，所以收工时 `git diff` 只剩尾部 hunk（`CodeEditor.vue` 2/2、`keymapBindings.ts` 1/1、`keymap-bindings.test.mjs` 8/1）。本代理没有执行任何 commit。

## 3. §5 自查命令的前后数字

| 命令 | 本批前 | 本批后 |
|---|---|---|
| `node --test tests/keymap-bindings.test.mjs` | 11 / 11 pass | **14 / 14 pass**（新增 3 条） |
| `node --test tests/keymap-bindings.test.mjs tests/editor-caret-clone.test.mjs` | 25 / 25 | **28 / 28** |
| `node --test tests/keymap-bindings.test.mjs tests/editor-caret-clone.test.mjs tests/action-registry.test.mjs tests/keymap-affordances.test.mjs tests/keymap-dialog.test.mjs tests/macro-keymap-actions.test.mjs`（键位域全域） | 55 / 55 | **55 / 55 pass** |
| `node --test tests/app-main-menu.test.mjs tests/main-menu-parity.test.mjs tests/merged-main-menu.test.mjs tests/editor-popup-menu.test.mjs`（受 editMenu 改动牵连） | 25 / 25 | **25 / 25 pass** |
| `node --test tests/module-size.test.mjs` | 5 / 5 | 中途 **4 / 5**（`CodeEditor.vue` 被我的注释顶到 1148 > 登记上限 1147 ⇒ 我把 7 行注释压到 2 行）→ 收工 **5 / 5 pass**（1145 ≤ 1147，上限未调高、未登记豁免） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 | 收工 **10 / 11**：1 条红 = 「已入快照的引用内容与快照一致」，4 条 moved 全在**我没碰的文件**里（`src/commitChecks.ts` 1、`src/components/ProblemsPanel.vue` 2、`src/runStartupFocus.ts` 1）⇒ 并行代理在飞现场，按规约「在飞红只记录不修」 |
| `npx vue-tsc -b --force` | —— | **6 条错，零条在本批文件**：`src/codeLensExtension.ts` 3、`src/gradleHost.ts` 1、`src/intentionList.ts` 1、`src/semanticActions.ts` 1（他人在飞）；本批改的 5 个 `.ts`/`.vue` 与 2 个 `.mjs` 全干净 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1310 文件） | **干净** |
| `node .tools/find-orphan-modules.mjs --gate` | —— | 1 条红：`src/components/IntentionListMenu.vue` 新增零生产消费方（意图列表那一路的在飞模块，**不是本批产物**，见 §5） |

## 4. 反向验证记录（三步：注入 → 变红 → 撤掉 → 复绿）

1. **键位回潮**（验 R3 摘键是否真被门看着）：把 `{ key: 'Ctrl-Alt-Shift-Up', preventDefault: true, run: editingCommands['cursor.above']! }` 塞回 `src/components/CodeEditor.vue` ⇒ `node --test tests/keymap-bindings.test.mjs tests/editor-caret-clone.test.mjs` **28 条里 3 红**（「克隆光标那对不占工具窗口调整大小的键（R3 摘键后的真值表）」报 `Ctrl-Alt-Shift-Up 还绑在编辑器 keymap 里`；「编辑器一族」的 `none` 分支同报；`editor-caret-clone` 那条改过的命令钉子同报）。撤掉注入 → 28 / 28 绿。
2. **计数漂移**（验 R5 的现算门）：`src/menuUi.ts` 注释里的 `30` 手改 `29` ⇒ **14 条里 1 红**（「menuUi 与 searchEverywhereHost 的计数注释与键位表同步（数字不许漂）」）。还原 → 14 / 14 绿。
3. **假 Alt+Enter 进表**（验 R4 的「缺前置不许进表」）：往 `KEY_BINDINGS` 头部插一条 `{ id: 'problems.view.quickFixes', display: 'Alt Enter', chord: { key: 'Enter', alt: true, forbid: ['ctrl','shift'] } }`（没给 `when`）⇒ **14 条里 4 红**：「出厂键位表没有同作用域冲突，且每条都带上游依据」（注入时 shell 转义把 `upstream` 串写坏了 `$default.xml` 这一段，红得对，但不是本条门的功劳）、「消费链：动作映射与表一一对应」、新增的 R4 判定、「计数注释同步」（表变 31 条）。还原 → 14 / 14 绿。
4. 断言**只换方向、没放松**：`tests/editor-caret-clone.test.mjs` 里原 `assert.match(editor, /key: 'Ctrl-Alt-Shift-Up'…/)` 改的是 `assert.doesNotMatch`（回潮即红），并**新增**命令表与菜单行的正向钉子；理由 = 上游 `$default.xml:879-884` 把这族键给了 `ResizeToolWindow*`（§1 R3 行）。其余 10 条既有断言一字未动。

## 5. 零消费方自查结论

本批**没有新建任何模块**，只改了 5 个既有源文件 + 2 个既有测试 + 1 份请求文档，因此没有新增零消费方模块。被删的两行编辑器键位的执行体 `editingCommands['cursor.above'|'cursor.below']`（`src/editorCommands.ts:242`）消费链完好：菜单行 `src/menus/editMenu.ts:195-196` 与「查找操作」的注册表条目（`EDITOR_ACTIONS` → `registerEditorActions`，`src/keymap.ts:429`）都在跑（`tests/action-registry.test.mjs` 绿）。
`node .tools/find-orphan-modules.mjs --gate` 唯一那条红是 `src/components/IntentionListMenu.vue`（意图列表 lane 的在飞模块），不是本批产物 —— 交主代理归口。

## 6. 做不到 / 无法核实

1. **R4 落不了注册**（不是「不愿」，是链路真的断在保留文件外）：`src/App.vue:2238` 渲染 `<ProblemsPanel>` 时没有模板 ref，`KeyBindingState`（`src/keymapBindings.ts:26-30`）也没有面板焦点面；`src/App.vue` 是本派单的保留文件 ⇒ 我无权加。写进 `KEY_BINDINGS` 只会得到一条吞键的假绑定，且必须配一个空转 `tailActions` 处理器才能过「一一对应」门 —— 那正是本仓铁律要避免的形状（已用 §4 第 3 步现场证明它会红 4 条）。
2. **`docs/inventory/verdict-editor.md:2145` 那行现在过时**（它把「键位 `src/components/CodeEditor.vue:865`（Ctrl+Alt+Shift+↑）」当成本仓现状登记）：`docs/inventory/*.md` 是保留文件，本批不改，只在报告里留痕；R3 的新形态（摘键 + `none` 档）以 `src/keymapBindings.ts` + `tests/keymap-bindings.test.mjs` 为准。
3. **`src/menuUi.ts:1` 的「（137 行，18 个依赖）」与 `src/keymap.ts:1` 的「（204 行，104 个依赖）」没动**：无法核实这两个数指的是「从 App.vue 搬出的那一段」还是「当前文件」—— 前者与当前行数本就该不一致。不猜着改数，交主代理定口径。
4. **上游中文文案**：`EditorCloneCaretAbove/Below` 的中文措辞取现仓既有直译（`ActionsBundle.properties:119-122` 的英文 `Clone Caret Above/Below`）；本地参考树里没有随 IDE 发货的 zh 包 ⇒ 中文原文**无法核实**，本批没有新造中文（只把键位栏清空）。
5. **`boundAt` 这类行号锚点在共享工作区里天生脆**：本批内 `src/components/CodeEditor.vue` 被并行代理改了 3 次，`brace.match` 的 `boundAt` 从 `:846` 漂到 `:840`（现由判据现算核行）。已按门的设计改成盘上真行号；不是「无法核实」，是**会反复漂**，主代理需要知道这是常态红点。

## 7. 需要主代理接的线（全文在 `docs/wiring-requests-2026-10-06-keymap.md` R4）

1. `src/App.vue`（归 appvue）：给 `<ProblemsPanel>` 加模板 ref + 一个面板焦点位（行 `@focusin` 已能落到 `rememberSelectedRow`，`src/components/ProblemsPanel.vue:297`），并把两者塞进 `createKeymap({ …, problemsPanel, problemsFocused })`。
2. `src/keymapBindings.ts` + `src/keymap.ts`（本 lane 随时能接）：`KeyBindingState` 加 `problems?: boolean`、`tailActions` 加 `'problems.view.quickFixes'`、`KEY_BINDINGS` 加请求文档里那条照抄条目（`forbid: ['ctrl','shift']` 的依据 = `platform/platform-resources/src/keymaps/$default.xml:480-482` 的 `alt ENTER` 那一档）。
3. 上面三件到位后，把新增判据「问题面板的 Alt+Enter…」里那条**负向**断言（`App.vue` 仍无 `<ProblemsPanel … ref=`）翻成正向，同时同步 R4 与 R5 的注释计数。
4. 归口他人现场的三条红：`node .tools/find-orphan-modules.mjs --gate` 的 `src/components/IntentionListMenu.vue`、`tests/source-citation-anchors.test.mjs` 的 4 条 moved（`commitChecks.ts`/`ProblemsPanel.vue`×2/`runStartupFocus.ts`）、`vue-tsc` 的 6 条（`codeLensExtension.ts`×3、`gradleHost.ts`、`intentionList.ts`、`semanticActions.ts`）—— 都不是本批文件。
5. `docs/inventory/verdict-editor.md` 那行过时结论需要 verdict 册子的归属代理按 §6.2 更新（本批禁改）。
