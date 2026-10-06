# 批次报告 · 2026-10-06 · 键位表 = 分派表 = 菜单显示 = 动作注册表（lane: keymap）

派单：让四处重新一致，并补上本轮新实现动作的注册。授权可改的保留文件只有四件：
`src/keymap.ts`、`src/keymapBindings.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`；
`src/App.vue` 明确禁碰（appvue 独占）。上游基准树：
`D:/Backup/Downloads/intellij-community-master/intellij-community-master`（下面每条行号都是我自己开文件核过的，
不是转述判词）。

## 1. 判词表

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| caretops 行操作 | `line.sort`（`EditorSortLines`）进注册表、不编键位 | `[x]` | 注册 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:262`；文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:173`（`Sort Lines`）；键位：**`platform/platform-resources/src/keymaps/$default.xml` 里零命中** | `src/keymapBindings.ts:219`、`src/actionRegistry.ts:166`、`src/keymap.ts:427` | 上游没键位 ⇒ 只进注册表，菜单键位栏继续留空（`src/menus/editMenu.ts:128`），新判据把它钉死 |
| caretops 行操作 | `line.reverse`（`EditorReverseLines`）同上 | `[x]` | 注册 `…ide.impl.actions.xml:263`；文案 `ActionsBundle.properties:174`；键位：`$default.xml` 零命中，且**十张 keymaps 表全都没有** | `src/keymapBindings.ts:221` | 同上 |
| caretops 行操作 | `line.unique`（`EditorUniqueLines`）同上 | `[x]` | 注册 `…ide.impl.actions.xml:264`；文案 `ActionsBundle.properties:175`（`Delete Duplicate Lines`）；键位：`$default.xml` 零命中，十张表全都没有 | `src/keymapBindings.ts:223` | 同上 |
| caretops 克隆光标 | `cursor.above` / `cursor.below` 进注册表 | `[x]`（登记为**本仓绑定**档，不是上游档） | 注册 `…ide.impl.actions.xml:219`/`:218`；文案 `ActionsBundle.properties:121-122`/`:119-120`；键位：`$default.xml` 零命中，只有 `keymaps/Sublime Text.xml:280`/`:284` 给过 `control alt UP/DOWN` | `src/keymapBindings.ts:225-230` | 现状如实登记（本仓编辑器 keymap 真绑着 `Ctrl-Alt-Shift-Up/Down`），**摘键请求已提**（R3），摘完我把这两条降到 `none` |
| caretops R1 复核 | `Ctrl+Alt+Shift+↑/↓` 到底该给谁 | `[x]` 已复核并判决 | `$default.xml:879-881` = `ResizeToolWindowUp`、`:882-884` = `ResizeToolWindowDown`；`$default.xml:139-141` = `SelectAllOccurrences`（`control alt shift J`，确实不是排序行） | 本仓：`src/keymap.ts:305-310`（`stretchToolWindow`，**不动，这条本来就对**）；要动的是 `src/components/CodeEditor.vue:865-866` ⇒ 请求 R3 | 2b2/caretops 那份事实全部成立；既有全局键**不动**，越界的那对编辑器键交请求摘掉 |
| caretops R2 | 五条上游 id 注册进 `src/actionRegistry.ts` | `[~]` | 同上五行 | `src/keymapBindings.ts:218-233` + `src/actionRegistry.ts:166-181` | 本仓已做，但**用本仓 id**（`line.sort` 等）而不是上游 id 当注册键：`src/menuUi.ts:246` 的 actionList 按 id 去重、菜单行优先，换成上游 id 会在「查找操作」里出双行；上游 id 记在 `upstreamId` 并塞进 `keywords`（按 `EditorSortLines` 也搜得到）。还差：宿主 `runEditor` 那一行 ⇒ 请求 R1 |
| caretops R3 | `EditorAddCaretPerSelectedLine`（Shift+Alt+G） | `[ ]` 本轮不做 | 实现 `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`；键位 `$default.xml:155-157`；文案 `ActionsBundle.properties:130` | 本仓：`src/editorCommands.ts` 无同名命令、无菜单行 | 派单没点名、实现也不在本仓（caretops 自己也说「本批未做」）⇒ 没有动作可注册，按「不放假控件」不写空条目 |
| 桶 2 · 2b2 R1 | 问题面板选中行 Alt+Enter（`problems.view.quickFixes`） | `[ ]` 判定为**现在不能注册**，证据与配方已给 | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`（`ProblemsView.QuickFixes` 的 `use-shortcut-of="ShowIntentionActions"`）；`$default.xml:480-482`（`alt ENTER`）；上游文案 `ActionsBundle.properties:12`（`Show Context Actions`） | 请求 R4（含可照抄的条目形状） | 键位结论成立，但：① 这把键本仓已给编辑器的同一上游动作（`src/components/CodeEditor.vue:781` 的 `Alt-Enter` → `codeAction`）；② `src/components/ProblemsPanel.vue` 至今没有 `defineExpose`（`:226` 的 `openRowMenu` 是内部函数），出口不存在 ⇒ 写进键位表就是一条只吞键不干事的假绑定，而且 1:1 门禁会逼我在分派表里配空转处理器 |
| 桶 1b A1/A2 | `refactor.changeSignature` 的 Ctrl+F6 进表 + 分派 | `[x]` 早已落（本轮复核） | `$default.xml:469-471` | `src/keymapBindings.ts:127-131`、`src/keymap.ts:393` | 不用再做；`tests/refactor-menu-parity.test.mjs:264-272` 正钉着这两处 |
| 桶 4b W1（键位半边） | `navigate.super` / `navigate.test` / `navigate.related` 进键位表 | `[x]` 表与分派已补，宿主那一行交请求 | `$default.xml:251-253`（`control U`）/`:254-256`（`control shift T`）/`:257-259`（`control alt HOME`）；`platform/platform-impl/resources/idea/LangActions.xml:194-196` | `src/keymapBindings.ts:112-126`、`src/keymap.ts:390-392`、`:416-418` | 这三条是本轮查出来的**真漂移**：菜单三行早就写着加速键（`src/menus/navigateMenu.ts:153`/`:161`/`:168`），分派表却没有 ⇒ 「写着按不动」。可用性谓词与菜单行 `enabled` 逐字对齐（真值表判据） |
| 桶 5b W-3 | `EditorMatchBrace` 的 Ctrl+Shift+M | `[x]` 判定为「已在位，不必进全局表」 | `$default.xml:1146-1148`；注册 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`；文案 `ActionsBundle.properties:161` | `src/components/CodeEditor.vue:846`（真实分派在这）+ `src/keymapBindings.ts:231-233`（注册条目，`source: 'upstream'`） | 那把键**按得动**（编辑器 CodeMirror keymap 绑着），所以菜单写着 `Ctrl Shift M` 不是假键；它属「表外键位」⇒ 不进 `KEY_BINDINGS`（进了就是重复绑定 + 空转处理器），改由新判据逐条核「`EDITOR_ACTIONS` 写了键位的，`CodeEditor.vue` 必须真有那一行、行号也要对」 |
| 四处一致性 | 键位表 ↔ 分派表 1:1 | `[x]` 既有门禁仍绿 | — | `tests/keymap-bindings.test.mjs:106` | 30 条键位 ↔ 30 个 `tailActions` 条目，一条不多一条不少 |
| 四处一致性 | 菜单手写 `keys` ↔ 键位表 `display` | `[x]` **新门禁** | — | `tests/keymap-bindings.test.mjs`（「菜单手写的 keys…」） | 实测核到 9 对（复制符号引用 / 全部保存 / 导航三条 / 重构四条），全部逐字相等；本轮之前没有任何机检看这一路 |
| 四处一致性 | 编辑器一族：菜单文案+键位栏 ↔ 注册条目 | `[x]` **新门禁** | — | `tests/keymap-bindings.test.mjs`（「编辑器一族…」） | `none` 档 ⇒ 菜单那一格必须是空串且编辑器 keymap 不许偷偷绑；`upstream`/`repo` 档 ⇒ 必须真在 `CodeEditor.vue` 那一行 |
| 四处一致性 | 注册表 ↔ 键位表不凭空长加速键 | `[x]` **新门禁** | — | `tests/action-registry.test.mjs:171` | 六条注册项的 `keymapKeys(id)` 必须是空串，`run` 必须只调 `runEditor(command)` |
| `src/menus/types.ts` | 是否需要改 | `[-]` 复核后不改 | 本仓侧理由见说明 | `src/menus/types.ts`（33 行，0 改动） | 派单授权了我可以不改：`MenuRow` 现有字段（`id`/`keys`/`title`/`keywords`/`run`…）够这四处用；想加的「本行为什么没有加速键」字段**没有生产者**（写它的是 `src/menus/*.ts`，不属本 lane），加了就是 `src/menuRowIcons.ts:20` 抱怨过的那种空槽位。一致性改由判据（源文本比对）守，而不是靠类型位 |
| 状态栏精确计数 | 「真工厂应有 13 条」 | `[-]` 不适用（未碰，只复跑） | — | `tests/status-bar-widgets.test.mjs:104` | 本批不改状态栏一族；复跑 8/8 绿，那条 `assert.equal(lines.length, 13)` 一字未动 |

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---|---|---|
| `src/keymapBindings.ts` | 326 | 425 | 新增 `EDITOR_ACTIONS`（六条编辑器一族的事实表，`:218-233`）+ `EditorActionBinding`/`EditorActionChord` 类型（`:172-196`）+ 三条导航键位（`:112-126`）+ 谓词 `workspaceEditorWhen`（`:69`） |
| `src/keymap.ts` | 415 | 450 | `KeymapContext` 加 4 条**可选**字段（`runEditor` `:112`、`gotoSuper`/`gotoTest`/`gotoRelated` `:119-121`）、`tailActions` 加三条（`:390-392`）、`unwired` 跳过未接线的三条（`:416-418`）、注册编辑器一族（`:427`）、把注释里写死的「这 25 条」换成不写数字的口径（`:404-405`） |
| `src/actionRegistry.ts` | 176 | 205 | 新增 `registerEditorActions()`（`:166-181`）与它的 `EditorActionBinding` 类型导入（`:23`） |
| `src/menus/types.ts` | 33 | 33 | 未改，理由见 §1 最后一行 |
| `tests/keymap-bindings.test.mjs` | 124 | 222 | 新增 3 条判据（编辑器一族 / 菜单 keys 对表 / 导航三条可用性与串味） |
| `tests/action-registry.test.mjs` | 166 | 194 | 新增 1 条判据（编辑器一族进注册表） |
| `docs/batch-2026-10-06-keymap.md` | — | 本文件 | 交付 |
| `docs/wiring-requests-2026-10-06-keymap.md` | — | 107 | R1 `runEditor`、R2 导航三条、R3 摘克隆光标的编辑器键、R4 问题面板 Alt+Enter 判定+配方、R5 陈旧计数注释 |

既有断言**一条都没放松**：`deepEqual`/`match` 原样、数字下限没降（`checked >= 9` 是新门禁的下限，
它锁的是「机检面别塌」而不是既有值）、`tests/keymap-bindings.test.mjs:106` 的 1:1 与 `:103` 的
`findKeyBinding(event, { workspace: … }, bindings)` 锚点都保持逐字不变（新逻辑写在 `handlerOf` 那一侧）。

## 3. §5 每条自查命令的前后数字

| 命令 | 批次前 | 批次后 | 备注 |
|---|---|---|---|
| `node --test tests/keymap-affordances.test.mjs tests/keymap-bindings.test.mjs tests/keymap-dialog.test.mjs tests/action-registry.test.mjs tests/refactor-menu-parity.test.mjs` | 34 tests / 34 pass / 0 fail | **38 tests / 38 pass / 0 fail** | 派单里的 `tests/edit-menu*.test.mjs` **在本仓不存在**（`ls tests/edit-menu*.test.mjs` 报 No such file）⇒ 用同域的 `tests/editor-line-ops`/`editor-caret-clone`/`editor-match-brace`/`app-main-menu` 代替，见下一行 |
| 上面 5 件 + `tests/status-bar-widgets.test.mjs` | 42 / 42 / 0 | **46 / 46 / 0** | 状态栏那条「真工厂应有 13 条」的精确计数原样绿 |
| 消费方全量（26 个读 `keymap*`/`actionRegistry`/`ACTIONS`/`KEY_BINDINGS` 的测试文件） | — | **257 / 257 / 0** | `action-registry active-tool-window branch-popup compare-files copy-path-actions diff-citations editor-line-ops everywhere-filters keymap-* macro-keymap-actions macro-session presentation-assistant refactor-menu-parity refactor-signature run-toolbar runner-view-actions search-everywhere tab-context-menu terminal-actions terminal-clipboard tool-layout tool-window-resize wiring-closeout-2026-10-05 status-bar-widgets` |
| `npx vue-tsc -b --force` | 13 错（`src/App.vue` 9 + `src/appLinkPath.ts` 3 + `src/components/VcsLog*.vue` 2，全是别人的在途文件） | 批次中段 6 错 → **收工时 0 错（全仓 0）**；本批四个文件自始至终 0 错（`grep -E "keymap\|actionRegistry\|menus/types"` 命中 0 行） | 数字变化是 12 路并行、别人的文件在动；与本批无关的两批错先后自己消了 |
| `node --test tests/module-size.test.mjs` | 1 红：`native/git.cpp 954 行 > 上限 938`（native lane 在途） | **2 红**：同一条 `native/git.cpp`，加 `src/components/SearchPanel.vue(920 行)`（桶 9 在途）——**都不是本批文件** | 我这边：`src/keymapBindings.ts` 425 / `src/keymap.ts` 450 / `src/actionRegistry.ts` 205，都在 ts 900 上限内；上限一字未动、没登记豁免、没拆别人的文件 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** | |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** | 新增的三条测试是纯 JS（无类型标注/`as`/`satisfies`） |
| `node .tools/find-missing-ext.mjs` | 干净（1236 文件） | **干净** | 值 import 全带 `.ts`；`EditorActionBinding` 走 `import type`（会被擦除，不受影响） |
| `node .tools/find-orphan-modules.mjs --gate` | 红 2：`src/components/ColorSchemeSettingsPage.vue`、`src/templateMacros.ts`（别人的在途模块） | 红 1：`src/structuralCodeBlock.ts`（桶 9 在途；前两条已被它们自己接上）——**不是本批** | 我没新增模块；本批新导出全部有生产消费方，见 §5 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 各 1 红：`src/settingsModel.ts :: platform/lang-impl/…/DocumentationToolWindowManager.kt:55`（参考树里没有）与 `src/vcsLogGraph.ts :: …CollapseGraphAction.java:13-38`（38 > 34） | **各 1 红，只剩 `src/vcsLogGraph.ts` 那一条**（settingsModel 那条被它的主人修掉了）——**不是本批** | 我这份报告与本批源码里新增的全部 `platform/…:行号`（`$default.xml`、`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218/219/262/263/264`、`platform/platform-resources-en/src/messages/ActionsBundle.properties:12/119-122/161/173-175/698/701/702/705`、`platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:100-103`、`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:23`、`platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`）都逐条开文件核过、行号都在文件长度内 ⇒ 引用门对本批零新增红 |

## 4. 反向验证记录（新门禁三条，各注入→变红→撤掉→复绿）

1. **「编辑器一族」那条**（`tests/keymap-bindings.test.mjs`）
   - 注入：把 `line.sort` 的 `key` 从 `{ source: 'none' }` 改成假的「上游有键位 Ctrl F9」（`cm: 'Ctrl-Shift-F9'`）。
   - 变红：**1 条红 / 16 条绿**，报错文案 = `line.sort 的菜单键位栏必须与注册条目一致（none ⇒ 空串：上游没键位就不编）`。
   - 另注一次：把 `brace.match` 的 `boundAt` 从 `CodeEditor.vue:846` 改成 `:847` ⇒ **1 红 / 8 绿**，
     文案 = `brace.match 的 Ctrl-Shift-m 不在 src/components/CodeEditor.vue:847`（假坐标也会被抓住）。
   - 撤掉：`pass 9 / fail 0`。
2. **「菜单手写的 keys 必须等于键位表里的 display」**
   - 注入：把 `navigate.related` 的 `display` 改成 `'Ctrl Alt End'`（菜单仍写 `Ctrl Alt Home`）。
   - 变红：**2 红 / 9 绿**，文案 = `navigateMenu.ts 里 navigate.related 的键位栏与键位表不一致`。
   - （同一次注入顺带把第 3 条也打红了，见下）
3. **「导航三条新键位：可用性与菜单行 enabled 同源，且上游的精确匹配不许串味」**
   - 注入：把 `navigate.super` 的 `forbid: ['shift', 'alt']` 减成 `['alt']`（等于允许 Ctrl+Shift+U）。
   - 变红：文案 = `Ctrl+Shift+U 该归切换大小写`（上游 `EditorToggleCase` = `$default.xml:529-530`）。
   - 撤掉两次注入后复绿：**19 pass / 0 fail**（keymap-bindings + action-registry 两件合跑）。
4. 另外两条既有门禁没被我的改动绕过：`keymapConflicts(KEY_BINDINGS)` 仍是 `[]`（30 条无冲突），
   `keymapConflictReport` 的头一行随条数自动变成「30 条绑定，0 处冲突」（断言用的是 `${KEY_BINDINGS.length}`，没写死）。

## 5. 零消费方自查结论

- `EDITOR_ACTIONS`（`src/keymapBindings.ts:218`）→ 生产方：`src/keymap.ts:14` import、`:427` 传给注册函数；判据 `tests/keymap-bindings.test.mjs`、`tests/action-registry.test.mjs`。
- `EditorActionBinding` / `EditorActionChord`（`:172`/`:181`）→ `src/actionRegistry.ts:23` 类型导入（`registerEditorActions` 的形参）。
- `registerEditorActions`（`src/actionRegistry.ts:166`）→ `src/keymap.ts:16` import、`:427` 调用（唯一调用点，与 `registerKeymapActions` 同一条装配链）。
- `workspaceEditorWhen`（`src/keymapBindings.ts:69`）→ 同文件 `:124`/`:126` 两条 `when`。
- `KeymapContext.runEditor` / `gotoSuper` / `gotoTest` / `gotoRelated` → `src/keymap.ts:181-182` 解构、`:390-392`/`:416-418`/`:427` 消费。
- `node .tools/find-orphan-modules.mjs --gate` 新增零消费方：**本批 0 条**（收工时红的 1 条是别人的在途模块 `src/structuralCodeBlock.ts`，见 §3）。
- 结论：本批没有「只过自己测试的死模块」；唯一悬空的是**宿主那一行**（R1/R2），我在源码里用
  `if (runEditor)` / `unwired` 明确写了「宿主没给就不注册」，所以它不会变成一个静默的空转分派。

## 6. 做不到 / 无法核实

1. **派单给的测试文件名不存在**：`tests/edit-menu*.test.mjs` 在 `tests/` 下 glob 不到
   （`node --test tests/edit-menu*.test.mjs` 直接报 `No such file or directory`）。我用同域四个文件代替并跑绿（§3 第 2、3 行）。
2. **上游 `EditorActionAction.update()` 的置灰口径没核实**：按文件名与按 `class EditorActionAction` 两条路
   在这棵 community 树里都搜不到（`find platform -name "EditorActionAction.*"` 空），
   所以「没有编辑器就置灰」这条**只用本仓既有判据支撑**（`src/App.vue:1436` 的 `hasEditor`，菜单行也是它），
   已在 `src/actionRegistry.ts:163-165` 的注释里写明「没当上游依据用」。
3. **摘克隆光标那对编辑器键（R3）我做不到**：`src/components/CodeEditor.vue` 与 `src/menus/editMenu.ts`
   都在 caretops 名下（它的报告自己写了「我去把 `src/menus/editMenu.ts:178-179` 的键位栏改成 `''`」），
   越界改 = 踩别人现场。本轮只把事实登记成 `repo` 档并在 `upstream` 串里写明撞车对象。
4. **`problems.view.quickFixes` 本轮不能注册**：面板出口（`defineExpose`/`openMenuForSelected`）不存在、
   宿主没有「焦点在问题面板」这一面状态（`KeyBindingState` 只有 workspace/editor/lsp），
   写进键位表只会得到一条吞键的假绑定 —— 完整判定与照抄配方在请求 R4。
5. **`navigate.super/test/related` 三把键在宿主接线之前仍是「写着按不动」**：键位表与分派表我已补齐，
   缺 `src/App.vue` 那一行（`createKeymap` 的实参对象）—— 我不碰 `App.vue`（派单禁），请求 R2。
   不接的后果我已用 `unwired` 兜住：不吞键、不注册空动作。
6. **两处陈旧注释不归我改**：`src/menuUi.ts:85` 的「25 个动作 id」现已是 30（21 那个数仍成立），
   `src/menus/*.ts` 里手写 `keys` 的行仍在抄第二份文案（`src/menus/editMenu.ts:34` 的 `Ctrl Alt Shift C` 与
   `src/menus/refactorMenu.ts` 那四条）—— 现在有机检盯着它们不许漂（§1 倒数第四行），
   但把它们改成 `actionRow()` 属菜单 lane 的活。
7. 收工时全仓还有这些红：`vue-tsc` **0 错**、`module-size` 2 红（`native/git.cpp` 954>938、
   `src/components/SearchPanel.vue` 920 行未登记）、`source-citations`/`-anchors` 各 1 红（`src/vcsLogGraph.ts`
   的 `CollapseGraphAction.java:13-38`）、orphan 门 1 红（`src/structuralCodeBlock.ts`）——
   **逐条都不是本批引入**（归属见 §3 的行）；按派单「只跑自己域」我没有替别人修。

## 7. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-keymap.md`：
R1 = `App.vue` 给 `createKeymap` 加 `runEditor,`（编辑器一族六条的注册表半边）；
R2 = 同一个对象再加 `gotoSuper, gotoTest, gotoRelated,`（修「导航三行写着加速键却按不动」）；
R3 = caretops/编辑器 lane 摘掉 `CodeEditor.vue:865-866` 的克隆光标键并把 `editMenu.ts:178-179` 的键位栏清空，
摘完回我，我把 `keymapBindings.ts:225-230` 两条降到 `none`；
R4 = 问题面板 Alt+Enter 的两件前置（面板 `defineExpose` + `KeyBindingState` 的面板焦点位）；
R5 = `src/menuUi.ts:85` 的计数注释 25 → 30。
