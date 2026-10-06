# 收工批次 2026-10-06 · edinput3（编辑器输入 / 分屏 / 沉浸模式域收尾）

派单：① 核对 `docs/wiring-requests-2026-10-06-editorinput.md`（尤其 W-3）并登记闭环；② `src/components/CodeEditor.vue`
已到 1146/1147 行 ⇒ 任何加行都要先拆后加、净增 ≤ 0；③ 在分屏 / Zen-Distraction-Free / 列选择-多光标三族里挑
判词仍挂 `[~]` 的做 2~3 条，每条配会失败的判据 + 反向验证；④ 交付本文 + 请求文档 + 实跑门禁。

上游真源：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下面所有行号都是我自己打开文件逐行核过的）。

---

## 1. 判词表

| # | 族 | 项 | 判定 | 上游 相对路径:行号 | 本仓落点 文件:行号 | 一句话说明 |
|---:|---|---|---|---|---|---|
| 1 | 沉浸模式 | 专注模式（Distraction Free）设置映射表 | `[~]` → 本批**补做 2 项** | `platform/platform-impl/src/com/intellij/ide/actions/ToggleDistractionFreeModeAction.java:111`（`ARE_GUTTER_ICONS_SHOWN`）、`:118`（`HIDE_TOOL_STRIPES`，上游传的是 `!value`） | `src/distractionFreeMode.ts:34-56` + 判据 `tests/distraction-free-mode.test.mjs:21-52` | 原模块头写「gutter 图标 / 工具窗口条本仓没有对应设置」**是错的**：键在 `src/settingsModel.ts:223`、界面在 `src/components/SettingsDialog.vue:795`/`:702`、消费方在 `src/gutterIconHost.ts:46` 与 `src/appearanceActions.ts:235` ⇒ 两项按上游补进 8 项表，专注模式现在真的会关掉装订线图标与工具窗口条，退出时按 BEFORE/AFTER 双向语义还原。 |
| 2 | 编辑器输入 | `EditorSplitLine`（Ctrl+Enter 拆行） | `[~]` → **已做** | `platform/platform-impl/src/com/intellij/openapi/editor/actions/SplitLineAction.java:22/:30/:50-55/:57-67`、默认档 `platform/platform-impl/src/com/intellij/openapi/editor/actions/EnterAction.java:60-67`、键位 `platform/platform-resources/src/keymaps/$default.xml:959-961 = control ENTER` | 新模块 `src/editorSplitLine.ts`（`onlySpaces:60`/`indentUpTo:66`/`splitLinePlan:89`/`splitLineCommand:110`）+ 键位 `src/components/CodeEditor.vue:907` + 判据 `tests/editor-split-line.test.mjs`（11 条） | 补齐判词点名的两条欠账：「拆完光标**不**移到下一行」（`:65` 把光标拽回切点）与「`:38` 逐光标处理」（多光标/有选区时按每条光标各算一刀，落点带上前面那些刀的净增减）。 |
| 3 | 列选择 | `DeleteInColumnModeHandler`（列模式里的 Delete） | `[~]` → **已做** | `platform/platform-impl/src/com/intellij/openapi/editor/actions/DeleteInColumnModeHandler.java:18/:21/:25/:30-34/:37`，注册位 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1084`（**只有** `EditorDelete`） | 新模块 `src/editorColumnMode.ts`（`inColumnMode:45`/`columnBlockDeletable:53`/`columnBlockDeletePlan:79`/`deleteInColumnModeCommand:97`/`createColumnSelection:113`）+ `src/components/CodeEditor.vue:908`、模式位 `:161`、扩展挂载 `:954` + 判据 `tests/editor-column-mode.test.mjs`（9 条） | 短行口径落地：列块比某些行长时，**行尾那个空光标不删**（改动前走 CM 的 `deleteCharForward` 会把下一行整行并上来）；同时把「现在在不在列模式」从宿主的局部布尔提成 facet，命令层才问得到。 |
| 4 | 编辑器输入 | W-1：三格回车/引号设置的消费方 | **已闭环**（本批落地，未动保留文件） | `platform/analysis-impl/src/com/intellij/codeInsight/CodeInsightSettings.java:130`（`INSERT_BRACE_ON_ENTER`）、`:132`（`CLOSE_COMMENT_ON_ENTER`）、`:140`（`AUTOINSERT_PAIR_QUOTE`）；把关点 `enter/EnterAfterUnmatchedBraceHandler.java:84-86`、`enter/EnterInBlockCommentHandler.java:62`、`editorActions/TypedQuoteImpl.java:66-68` | `src/components/CodeEditor.vue:117` + `:966`；装配本体 `src/enterHandlers.ts:160-172` | 原文「改法一净 +3 行」被**先拆后加**替掉（注释词法的两次调用搬进 `enterHandlers.ts`）⇒ 那一段 6 行变 5 行；设置页 `EditorEnterKeysFields.vue:29/:31/:33` 三格从此都有消费方。 |
| 5 | 编辑器输入 | W-3：语言档 facet 挂载（`<>` 配对档） | **已闭环 · 复核通过** | `java/java-frontback-impl/src/com/intellij/codeInsight/highlighting/JavaPairedBraceMatcher.java:26-34` | 证据 `src/components/CodeEditor.vue:480`（`language.reconfigure([extension, editorLanguageIdExtension(props.language)])`）；出口 `src/editorMatchBrace.ts:51-56` | 主代理落的那一行我 reopen 核过：挂载点就是请求建议的 extensions 处，且 `editorLanguageIdExtension(undefined)` 返回 `[]` ⇒ 没有语言 id 的文件不会被写成空串。**已在请求文档登记闭环。** |
| 6 | 多光标 | W-2 步骤 4：`EditorAddCaretPerSelectedLine` 的键位面 | **仍开**（保留文件） | `AddCaretPerSelectedLineAction.java:22-54`、`$default.xml:155-157 = shift alt G`、注册 `intellij.platform.ide.impl.actions.xml:358`、菜单 `PlatformActions.xml:485-487`、文案 `ActionsBundle.properties:130` | 已落：`src/editorCaretPerLine.ts:85`、`src/editorCommands.ts:246`、`src/menus/editMenu.ts:121`（键位栏仍 `''`）；待落：`src/keymapBindings.ts` 的 `EDITOR_ACTIONS` + `src/components/CodeEditor.vue:908` 之后一行 | 两处都在保留/别人面 ⇒ 请求保留，本批**没有**偷偷在 `.vue` 里加这一行（那会让 `editMenu.ts:121` 的键位栏与实际注册不一致，`tests/editor-caret-per-line.test.mjs:91` 那条判据正钉着它）。 |
| 7 | 沉浸模式 | `FocusModeModel`（非当前文件淡出） | `[~]` 保持，**未做** | `platform/platform-impl/src/com/intellij/openapi/editor/impl/FocusModeModel.java`（判词行 `docs/inventory/verdict-editor.md:2382`） | 无 | 需要「同一时刻多个编辑器实例互相知道谁在前」的通道：本仓两栏各建一个 `CodeEditor`，实例间没有可见性/焦点区通知链路（要动 `src/App.vue` + `.vue` 两侧）⇒ 按规约不渲染没有消费链路的控件/效果，登记不做。 |
| 8 | 列选择 | `AddRectangularSelectionOnMouseDragAction`（拖拽时再加一块列选区） | `[~]` 保持，**未做** | `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddRectangularSelectionOnMouseDragAction.java`（判词行 `verdict-editor.md:2138`） | 无 | CodeMirror 的 `rectangularSelection` 只给一个 `eventFilter` 档（`src/components/CodeEditor.vue:954` 那条 Compartment），「把新矩形**并入**已有列选区」得自己写一套 mousemove 的选区组装；落点是 `.vue`（本批只剩 3 行余量）+ 一个 DOM 事件模块。本批选了第 3 行那条更短的路（先让命令层看得见模式位）。**不是做不到，是本批预算内没排上——留给下一批。** |
| 9 | 多光标 | `CloneCaretActionHandler:53` 的 `addCaretsOnDoubleCtrl` 档 | `[~]` 保持，**未做（键不存在）** | `platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretActionHandler.java:53` | 无 | 上游那一档是**可设置**行为；本仓 `src/settingsModel.ts`（保留文件）里没有对应键 ⇒ 做了就是假控件。要做得先加键（会牵动 native 的 `editor_defaults_impl` 与旧存档补默认），交设置面代理。 |
| 10 | 分屏 | 「同一文件在两栏里各是两份文档」 | **未做 → 已提请求 W-5** | `platform/lang-impl/src/com/intellij/openapi/fileEditor/impl/PsiAwareFileEditorManagerImpl`（判词原文 `docs/inventory/verdict-platform_rest.md:228` 的 ①） | `src/editorSplits.ts:90` 让同一个 `Tab` 进两组；`src/components/CodeEditor.vue` 只在 `onMounted` 读 `props.content` | 缺的是一行 `watch(() => props.content, ...)`，落在 `.vue`（保留面之外但有 3 行余量）⇒ 已给可粘贴 diff + 三条坑（`replacing` 旗、watch 顺序 TDZ、判据），见请求文档 W-5。 |

**分屏族的核对结论**：`src/editorSplits.ts`（205 行）与 `src/editorGroups.ts`（167 行）本批**没有需要补的用户可见行为** ——
判词里指向这两个文件的那几行（`verdict-editor.md:117` A-4、`:2063` B-16）欠的都是「`Editor` 接口的对象形态」
与「tabPlacement 四方位」两档，前者是 API 形状、后者需要 `src/App.vue` 的模板与 `UISettings` 新键，
都不是模块侧能独立收口的；`[~]` 保持不动。真正在模块侧可收的是第 10 行那条同步缺口 ⇒ 走请求。

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `src/components/CodeEditor.vue` | 1146（HEAD）/ 1150（我进场时另一路代理已 +4） | **1144** | 我的净变化 **−6**：拆掉宿主里的注释词法装配（−1）、列模式状态与 `toggleColumnSelection` 搬进 `src/editorColumnMode.ts`（−7）、新增 Ctrl-Enter 与 Delete 两行键位（+2），其余（`:161`/`:424`/`:425`/`:724`/`:883`/`:954`/`:966`/`:77`）都是**同行替换**。上限 1147 ⇒ 还余 3 行；且**低于** HEAD 的 1146（只降不升）。 |
| `src/enterHandlers.ts` | 531 | 558 | +27：新出口 `smartEnterLanguageForView`（W-1 的两条开关装配从宿主搬进来）。 |
| `src/distractionFreeMode.ts` | 93 | 109 | +16：键表补 `showGutterIcons`/`showToolWindowBars`，模块头改判并留痕（「原写 X、实际 Y」）。 |
| `src/editorSplitLine.ts` | — | 122 | 新模块（判词第 2 行）。 |
| `src/editorColumnMode.ts` | — | 138 | 新模块（判词第 3 行）。 |
| `tests/editor-split-line.test.mjs` | — | 106 | 新判据 11 条。 |
| `tests/editor-column-mode.test.mjs` | — | 91 | 新判据 9 条。 |
| `tests/distraction-free-mode.test.mjs` | 87 | 117 | 7 条 → 9 条：键表 6→8 项（deepEqual 更严）+ 新加「每个映射键都要有真实消费方」。 |
| `tests/editor-enter-block-comment.test.mjs` | 152 | 159 | 锚点改指新出口 + 两条开关断言（见第 6 节「改断言的理由」）。 |
| `tests/editor-quote-faces.test.mjs` | 136 | 140 | `smartQuotes` 那条正则钉成两实参的新形状（更严）。 |
| `docs/wiring-requests-2026-10-06-editorinput.md` | 172 | 214 | 复核登记表（W-1/W-3 闭环、W-2 只剩步骤 4）+ 新写 W-4、W-5。 |
| `docs/batch-2026-10-06-edinput3.md` | — | 本文件 | 交付。 |

未动：`src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`src/settingsModel.ts`、`src/keymap.ts`、
`src/keymapBindings.ts`、`src/actionRegistry.ts`、`src/menus/types.ts`、`CMakeLists.txt`、`scripts/verdict_table.py`、
`package.json`、`tsconfig.json`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`、`docs/inventory/*.md`。
未 commit、未 push、未跑 `git checkout/reset/stash/clean`。

---

## 3. §5 每条自查命令的前后数字（收工实跑）

| 命令 | 收工前 | 收工后 |
|---|---|---|
| `npx vue-tsc -b --force` | 中途 3 处我自己引入的错（`EditorView \| undefined` 不匹配 `\| null` ×2、`heads.map(EditorSelection.cursor)` 签名不匹配） | **0 错**（无任何输出） |
| `node --test tests/<编辑器输入/分屏/沉浸域>`：`editor-split-line`、`editor-column-mode`、`distraction-free-mode`、`editor-enter-block-comment`、`editor-quote-faces`、`editor-enter-handlers`、`editor-enter-order`、`editor-caret-clone`、`editor-caret-per-line`、`editor-groups`、`tab-drag-split`、`tool-stripe-split` | —— | 第一轮（10 文件）**116 tests / 116 pass / 0 fail**；改断言与类型修复后再跑 7 文件 **75 / 75 / 0** |
| `node --test tests/module-size.test.mjs` | 跑之前 `CodeEditor.vue` 是 1150（别人并发 +4 顶到红） | **5 tests / 5 pass / 0 fail**（该文件 1144 ≤ 上限 1147，且比 HEAD 的 1146 低） |
| `node .tools/find-orphan-modules.mjs --gate` | —— | **新增 0**（已登记孤儿 6 / 基线 8；本轮清掉的 `src/jarRun.ts`、`src/runAnythingContext.ts` 不是我的）⇒ 门禁绿 |
| `node .tools/find-param-props.mjs` | —— | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | —— | **干净：tests/*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | —— | **干净**（扫描 1319 文件，src + tests） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | —— | `source-citations` 全绿；`source-citation-anchors` **7 pass / 1 fail** ⇒ 那 1 条红的**不是我**：它报的是 `docs/wiring-requests-2026-10-06-fix-macros.md` 里两条已入快照的引用在仓里指不到了（别的代理在途改动）。我没碰那份文档，也**没有**用 `TAOCODE_CITATION_ANCHORS=update` 重算快照（那会替别人把漂移盖掉）。 |
| ctest / `npm run test:native` | —— | 本批**没动 `native/`** ⇒ 不适用（不是「同上」：改动面只有 `src/*.ts`、`src/components/CodeEditor.vue` 与 `tests/*.mjs`）。 |

---

## 4. 反向验证记录（新门必须有牙）

每条都是「注入违规 → 确认变红 → 撤掉 → 复绿」，数字是同一条 `node --test` 的 pass/fail。

| 注入 | 期望拦住的判据 | 结果 |
|---|---|---|
| 往 `DISTRACTION_FREE_KEYS` 塞一个上游有、本仓**没有消费方**的键（`showMethodSeparators`，同时补进 `DISTRACTION_FREE_VALUES`） | 「映射的 8 项…一一对应」+「每个映射的键都有真实消费方」 | **pass 5 / fail 4**（红）→ 撤后 **9 / 0**（绿） |
| 从 `createColumnSelection().toggle` 的 reconfigure 里删掉 `columnModeMarker`（模式位不再跟着 `rectangularSelection` 走） | 「接线：… 模式位没跟着 reconfigure ⇒ 命令永远看不见列模式」 | **pass 8 / fail 1**（红）→ 撤后 **9 / 0** |
| 把 `splitLinePlan` 的落点从 `cut + shift` 改成 `cut + insert.length`（光标不再留在切点、也不再随前面那些刀映射） | 「光标前有文字…光标留在切点」「多光标逐刀」「算式：两条分支各落在哪」等 | **pass 6 / fail 5**（红）→ 撤后 **11 / 0** |
| 摘掉宿主里的 `{ key: 'Ctrl-Enter', … }` 那一行（命令变无人调用的死模块） | 「接线：Ctrl+Enter 真的绑在这条命令上」 | **pass 10 / fail 1**（红）→ 撤后 **11 / 0** |

撤回后的残留标记 grep：`showMethodSeparators` **0 命中**；`Ctrl-Enter` **1 命中**（就是那条真键位行）；
`columnModeMarker` **3 命中**（定义、导出、`reconfigure` —— 都是应有内容）。临时备份放在
`build/tmp-edinput3/`（已 gitignore），收工删净。

另外两条**结构性**判据（不需要注入就会长期挡红）：
`tests/editor-column-mode.test.mjs` 末条用 `assert.doesNotMatch(view, /key: 'Backspace'[^}]*deleteForward/)`
钉住「上游只注册了 `EditorDelete`（`ide.impl.xml:1084`）⇒ 不许顺手给 Backspace 加同一档」；
`assert.ok(indexOf("{ key: 'Delete'") < indexOf('basicSetup,'))` 钉住「必须排在 basicSetup 之前，
否则默认档先赢、这一档永远问不到」（拆行那条 Ctrl-Enter 同款断言）。

---

## 5. 零消费方自查结论

- `src/editorSplitLine.ts`：被 `src/components/CodeEditor.vue:77`（import）与 `:907`（键位）消费 ⇒ 不是只过自己测试的死模块。
- `src/editorColumnMode.ts`：被 `src/components/CodeEditor.vue:77`（import）、`:161`（状态装配）、`:954`（扩展挂载）、`:908`（Delete 键位）、`:424/:425/:724/:883`（`columnModeActive`/`toggleColumnSelection`/`column.select` 三个既有出口）消费。
- `smartEnterLanguageForView`（`src/enterHandlers.ts:160`）：被宿主 `:117` 消费；旧的 `smartEnterLanguageFor` 仍在（模块内被新出口复用，且 `tests/editor-enter-handlers.test.mjs` 直接判它）。
- 门禁实测：`node .tools/find-orphan-modules.mjs --gate` ⇒ **新增 0**。

---

## 6. `做不到 / 无法核实` 清单

1. **`FocusModeModel` 的「非当前文件淡出」**（判词第 7 行）：本仓两栏各是一个独立 `CodeEditor` 实例，
   实例之间没有任何「谁在前 / 别的编辑器可见」的通道；要做就得同时动 `src/App.vue`（保留面）的布局层
   与两栏之间的状态桥。这不是「上游有 PSI 所以做不了」那种借口，是**跨实例事件链路在本仓还没建**，
   一行都塞不进只剩 3 行余量的 `.vue`。⇒ 未做，登记在此。
2. **`AddRectangularSelectionOnMouseDragAction`（拖拽再加一块列选区）**（第 8 行）：CodeMirror 只暴露
   `rectangularSelection({ eventFilter })` 一档，「并入已有列选区」要自己写 DOM mousemove 组装 +
   与 `crosshairCursor` 打架的取舍；本批把「命令层看得见列模式」这条更短的路先收口（第 3 行）。⇒ 未做。
3. **`CloneCaretActionHandler:53` 的 `addCaretsOnDoubleCtrl` 可设置档**（第 9 行）：本仓没有那个设置键，
   键位在保留文件 `src/settingsModel.ts` / `native/settings_transfer*` 那一族里 ⇒ 做不了真行为，
   也不肯放假控件。
4. **`EditorAddCaretPerSelectedLine` 的键位面**（第 6 行）：`src/keymapBindings.ts` 与 `src/keymap.ts` 都是
   保留文件 ⇒ 只能提请求（W-2 第 4 步，请求文档里坐标已刷成当前行号）。
5. **`EditorSplitLine` / 列模式 Delete 的「动作表 + Find Action」行**：同上，`src/keymapBindings.ts` 是保留面 ⇒
   已写 W-4，并明确标出「不能只加表不加命令表」的两条前置（命令表单表是模块级的，
   而拆行要传宿主那条回车链 ⇒ 两种做法各有代价，交给主代理定夺）。
6. **`ActionsBundle.properties` 里 `EditorSplitLine` 有没有 `.description`**：**未核实**（本批没为它写菜单行，
   也就不需要抄那段文案）⇒ 请求文档 W-4 里明写「核不到就不要编描述文案」。
7. **改断言的理由留痕**（规约第 3 节要求）：
   - `tests/editor-enter-block-comment.test.mjs`：原正则 `smartEnterCommand\(\(\) => smartEnterLanguageFor\(`
     钉的是宿主那一行的**形状**。W-1 落地必须把两条设置递进模块 ⇒ 那一行改名换形（新出口
     `smartEnterLanguageForView`），**不是放松**：新正则更严（把 `view, props.path, props.language, props.settings`
     四个实参逐字钉住），并**多加**两条「两条开关要真的落到 `EnterLanguage` 那两个字段」的断言。
   - `tests/editor-quote-faces.test.mjs`：同理，`smartQuotes` 那条从「一个实参」改成「两个实参且第二个问
     `autoInsertPairQuote`」，比原来更严。
   - `tests/distraction-free-mode.test.mjs`：键表 `deepEqual` 从 6 项变 8 项（上游 `:111`/`:118` 两项补进来），
     并新增一条「每个键都要有真实消费方」的门 ⇒ 都是收紧。
8. **`source-citation-anchors` 那 1 条红**：属于 `docs/wiring-requests-2026-10-06-fix-macros.md`（别人面），
   本批未重算快照。要收那条红，请由那份文档的作者把两行引用补回去（或主代理确认后可以重算快照）。

---

## 7. 并发痕迹与归属留痕（收工前补）

`git diff -U0 -- src/components/CodeEditor.vue` 的 hunk 清单：`77`、`113-117`、`157-164`、`430`、`730`、
`889`、`910`、`954`、`956`、`968` —— **都是本批的**。另有 **`865` 那一处不是本批**：
`{ key: 'Ctrl-Alt-Shift-Up'/'Ctrl-Alt-Shift-Down', run: editingCommands['cursor.above'/'cursor.below'] }`
两行在我批次进行中被另一路代理摘掉，换成两行注释（现在在 `src/components/CodeEditor.vue:859-860`，
原文「Ctrl+Alt+Shift+↑/↓ **不绑给克隆光标**（R3 判决 2026-10-06）」），理由是上游
`$default.xml:879-884` 把这一族键的主人是 `ResizeToolWindowUp/Down`。**我没有恢复、也没有跟进改动**，
只是记账：`src/editorCaretClone.ts` 的 `cursor.above`/`cursor.below` 两条命令仍在命令表里
（`src/editorCommands.ts:246` 一族），入口按他们那次的说法退回菜单与「查找操作」。
这条摘除与本批的判据无冲突：`tests/editor-caret-clone.test.mjs` 钉的是命令与算法，不是那两行键位。

## 8. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-editorinput.md`：

- **W-1 / W-3 已闭环**（本批 / 主代理），登记表已写在文档开头，证据是 文件:行号。
- **W-2 步骤 4**（唯一剩下的旧请求）：`src/keymapBindings.ts` 的 `EDITOR_ACTIONS` 一条 + `src/components/CodeEditor.vue:908`
  之后那一行 `Shift-Alt-G` + `src/menus/editMenu.ts:121` 的键位栏从 `''` 改 `'Shift Alt G'`（三处一起，缺一处就是假加速键）。
- **W-4（新）**：`EditorSplitLine` / 列模式 Delete 的动作表条目 + 为什么命令表单表塞不下拆行。
- **W-5（新）**：同一文件在两栏之间同步 `props.content` 的可粘贴 `watch` + 三条坑。
