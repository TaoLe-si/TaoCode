# 批次交付 · 2026-10-06 · caretops2（编辑器标签条动作？= 光标/行操作一族 与 saveops 收尾）

派单代号：**caretops2**。范围 = `docs/wiring-requests-2026-10-06-caretops.md`（含 R3）+
`docs/wiring-requests-2026-10-06-saveops.md`（①/②/③ 各步）逐条对账 + 两域里**模块/组件侧**还能闭环的缺项。
上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（未上网，全部开本地文件核行号）。

## 0. 先纠派单的两处前提（留痕）

1. 派单写「编辑器**标签条**动作（caretops）」并列了 `src/tabActions*.ts`、`src/components/TabStrip*.vue` ——
   **这两个文件名在仓里不存在**（`ls src | grep -i tab` ⇒ `tabStripLayout.ts`/`tabStripView.ts`/`tabTitle.ts`/
   `tabEntryPoint.ts`/`tabDragSplit.ts`…；`ls src/components | grep -i tab` ⇒ `TabContextMenu.vue`/`TabEntryPoint.vue`）。
   而 `docs/wiring-requests-2026-10-06-caretops.md` 的内容是**编辑器的行操作与多光标**（caret ops），
   一条标签项都没有 ⇒ 本批按**请求文档的实际内容**收尾，落点 = `src/editorCaretPerLine.ts`（新建）、
   `src/editorCommands.ts`、`src/menus/editMenu.ts`、`src/editorSaveTransforms.ts`、`src/editorFileOps.ts` 与三个测试文件。
2. 派单说 saveops ①.1/①.2 早已落 ⇒ **核实为真**（证据见 §1 表），本批没有重复做，只登记行号。

⚠ 本批期间工作区被别的 lane 并发改过 `src/components/CodeEditor.vue`、`src/keymapBindings.ts`、
`src/menus/editMenu.ts`（R1 摘键那一族）、`tests/editor-caret-clone.test.mjs`。我发现后**没有**去改它们
（详见 §5 与 §7），本批自己的 hunk 用 `git diff` 逐块核过。

---

## 1. 判词表

### caretops（行操作 / 多光标一族）

| 项 | 判定 | 上游相对路径:行号（我亲自开过） | 本仓落点文件:行号 | 一句话 |
|---|---|---|---|---|
| R1 `Ctrl+Alt+Shift+↑/↓` 该给谁 | `[x]` **已闭环**（处置 2，由 keymap2 批落的；本批只核对现场） | `platform/platform-resources/src/keymaps/$default.xml:879-884`（`ResizeToolWindowUp/Down` = control alt shift UP/DOWN）；`platform/platform-resources/src/keymaps/Sublime Text.xml:280/:284`、`plugins/keymaps/vscode-keymap/resources/keymaps/VSCode.xml:130/:134`（只有这两档给过克隆光标） | `src/components/CodeEditor.vue:865-871`（只剩说明注释，两行绑定已摘）、`src/keymapBindings.ts:235-238`（`source:'none'`）、`src/menus/editMenu.ts:195-196`（键位栏空串）、`tests/editor-caret-clone.test.mjs:129-138`（断言已按上游改成反向钉子） | 编辑器不再抢工具窗口的键；`cursor.above/below` 的入口 = 命令表 + 菜单行 + 注册表。 |
| R2 上游 action id 进注册表（原写「可选」） | `[x]` **已闭环**（按本仓口径：id 用本仓名，上游 id 走 `upstreamId` + `keywords`） | `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219/:262-264`、`platform/platform-resources-en/src/messages/ActionsBundle.properties:119-122/:173-175` | `src/keymapBindings.ts:228-241`（`EDITOR_ACTIONS` 六条，每条带 `upstreamId`，`keywords` 内含上游 id）→ `src/keymap.ts:427` → `src/actionRegistry.ts:166-180`（`registerEditorActions` 注册进 `ACTIONS`） | 「查找操作」按 `EditorSortLines` 这类上游 id 也搜得到；`upstreamId` 字段本身只作审计对照（消费方是判据 `tests/keymap-bindings.test.mjs:143-144`，它要求 `keywords` 必含上游 id）。 |
| R3 `EditorAddCaretPerSelectedLine` | `[~]` **本批落模块侧 3/4，剩第 4 处（键位注册）在保留文件** ⇒ 请求 `docs/wiring-requests-2026-10-06-caretops.md` §R3-收尾 | `platform/platform-impl/src/com/intellij/openapi/editor/actions/AddCaretPerSelectedLineAction.java:22-54`（`:22` ForEachCaret、`:27-30` 取行、`:31` 行首不算、`:33-36` 上限、`:40` primary、`:41-51` 每行行尾、`:53` 删原光标）、`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`、`platform/platform-impl/resources/idea/PlatformActions.xml:485-487`（`EditSelectGroup` 紧跟 `$SelectAll`）、`platform/platform-resources/src/keymaps/$default.xml:155-157`（shift alt G）、`platform/platform-resources-en/src/messages/ActionsBundle.properties:130`（**只有 `.text`、无 `.description`**）、`platform/util/resources/misc/registry.properties:484`（上限 1000）、`platform/editor-ui-api/src/com/intellij/openapi/editor/CaretModel.java:236-241`（同点已有光标 ⇒ 不动作） | `src/editorCaretPerLine.ts`（**新建 104 行**：纯函数 `caretPerLinePlan` + `addCaretPerSelectedLineCommand`）、`src/editorCommands.ts:59`（import）+ `:246`（`'caret.perLine'`）、`src/menus/editMenu.ts:110-121`（菜单行，紧跟「全选」，键位栏空串）、`tests/editor-caret-per-line.test.mjs`（新建，8 条判据） | 命令 + 命令表 + 菜单行三处齐，**没有假行**（点得到就执行）；只有 `Shift+Alt+G` 那一环要主代理落 `src/keymapBindings.ts` + `src/components/CodeEditor.vue`。 |
| 派单提的标签条（TabStrip）动作项 | `[-]` **不适用**，具体理由：两域请求文档（caretops 88 行 / saveops 171 行）里**零**条标签项；标签条面属别的 lane（`docs/batch-2026-10-06-tabstrip*.md` 不在我这片），本批按「派单没写的一律只读」没动它 | — | — | 「标签条」是派单对 caretops 的口径笔误，不是缺项。 |

### saveops（保存动作）

| 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话 |
|---|---|---|---|---|
| ①.1 解构里加 `transformOnSave` | `[x]` **早已落**（派单已核实，本批只登记） | `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/FileDocumentManagerImpl.java:1214-1245` 的 multiCast 顺序（同请求文档） | `src/App.vue:1138`（`transformOnSave,` 在解构里）、出口 `src/editorFileOps.ts:262`（`return { … transformOnSave, … }`） | 不缺。 |
| ①.2 `save()` 里 Actions on Save 之后插 pass | `[x]` **早已落** | `FileDocumentManagerImpl.java:1214-1245`、`platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java:65-110` | `src/App.vue:1101-1115`（`runActionsOnSave` → `transformOnSave` → `file.write` + `savePassNote`） | 顺序与提示文案都在，不缺。 |
| ①.3 本地历史回滚**保持绕过**这条 pass | `[x]` 正确（未接） | `FileDocumentManagerImpl.java:376-392`（`saveDocumentAsIs` 里 `TrailingSpacesStripper.setEnabled(file, false)`，本批未重开该文件核行号，沿用请求文档坐标） | `src/App.vue:1060-1075`（`revertHistory`：`history.content` → 直接 `file.write`，不经 `transformOnSave`） | 保持原样才对。 |
| ②.1 `settingsModel.ts` 三个字段 + 默认 | `[x]` 已落 | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:73/:74/:142/:216-218` | `src/settingsModel.ts:410-414`（类型）、`:223`（`stripTrailingSpaces: 'Changed', ensureNewLineAtEof: false, keepTrailingSpacesOnCaretLine: true`） | 缺键走默认，不按字段数量判损坏。 |
| ②.2 `native/settings_schema.hpp` 白名单 | `[x]` 已落 | 同上 | `native/settings_schema.hpp:89-91`（三条跟在 `formatOnSave` 之后，注释带消费方） | — |
| ②.3 `native/settings_schema.cpp` 默认值 + 注释 | `[x]` 已落 | 同上（:73/:74/:142） | `native/settings_schema.cpp:405-410`（含「不落 `REMOVE_TRAILING_BLANK_LINES`」的自陈） | — |
| ②.4 `src/bridge.ts` 放行 + 越界「剪掉这一条」 | `[~]` **前提变了**：`bridge.ts` 里没有逐键白名单，editor 设置是整份发 `settings.update`（`src/App.vue:668`），**域校验住在宿主** | `EditorSettingsExternalizable.java:216-218`（三档字面值） | `native/settings_editor_keys.hpp:48-55`（`stripTrailingSpaces` 只认 `None/Changed/Whole`，越界 `fail("INVALID_SETTINGS", …)`）、两个布尔走同文件 :45-46 注释说的布尔兜底 | 差异如实记：越界是**整份补丁被拒**，不是上游那种「剪掉这一条」。要不要改成单条剪枝属宿主/`bridge.ts` 那两片的决定 ⇒ 见请求 §②.4-差异。 |
| ③ 设置页三格 + 真值喂进 pass + 判据翻向 | `[x]` 已落 | `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:147-149/:153-155/:156-157`（沿用请求文档坐标） | `src/components/EditorSavePassesFields.vue:43/:52/:54`（`v-model` 三格）、`src/components/SettingsDialog.vue:34`（import）+ `:736`（挂载）、`src/editorFileOps.ts:242-246`（三个真值）、`tests/save-transforms.test.mjs:382-405`（原「不许渲染」已按请求改成「渲染了就必须有链路」的反向判据，**没删**） | 键、控件、消费链同批落地。 |
| **新发现的真缺口**：`keepTrailingSpacesOnCaretLine` 只管末行那段、**没管清行尾那段** | `[x]` **本批修掉** | `platform/platform-impl/src/com/intellij/openapi/editor/impl/TrailingSpacesStripper.java:70`（`strip(document, isChangedLinesOnly, isKeepTrailingSpacesOnCaretLine())`）→ `:209`（形参 `skipCaretLines`）→ `:229`（`skipCaretLines ? caretOffsets : null`）；被挡的行 `platform/core-impl/src/com/intellij/openapi/editor/impl/StripTrailingSpacesUtil.java:78-84` | `src/editorSaveTransforms.ts:504-507`（`caretOffsets: input.options.keepTrailingSpacesOnCaretLine ? input.caretOffsets : undefined`）、判据 `tests/save-transforms.test.mjs:231-246` | 修前：关掉那一格，光标行照样不清（设置是假的）；修后：关掉 ⇒ 光标行也清、`deferredLines` 为空。 |
| 端到端链（派单第 3 条问的那条） | `[x]` **已通**，并补了一条**链判据** | 上面那三条 + `EditorSettingsExternalizable.java:142` | `tests/save-transforms.test.mjs:266-309`（①设置页 ②`settings.update`+宿主白名单 ③两侧默认值 ④`editorFileOps` 真值 ⑤执行体真的按它分叉） | 任何一段被摘掉，这条就红（§5 的 M3 就是这么验的）。 |
| `removeTrailingBlankLines`（上游第三段） | `[ ]` 仍缺，**且必须三样同批**：执行体 + 键 + 控件 | `TrailingSpacesStripper.java:76-78`（调用点）+ `:112-131`（`removeTrailngBlankLines`，上游原文拼错）、`EditorSettingsExternalizable.java:75`（默认 false） | `src/editorSaveTransforms.ts:117-118` + `:143-144` 的契约字段 + `tests/save-transforms.test.mjs:256-264` 钉着「只有契约字段、没有执行体」；设置页 `EditorSavePassesFields.vue:21-22` 写明不落的原因 | 单落执行体（`options.removeTrailingBlankLines` 恒 false）= 不可达代码；单落键 = 假控件。留给有键的批次。 |
| 多光标档（上游按 `getAllCarets()` 判断） | `[ ]` 仍缺（宿主能力） | `TrailingSpacesStripper.java:213-226`（`getActiveEditors` → `getAllCarets()` → `caretOffsets[]`） | `src/editorFileOps.ts:249` 只取 `editorFor(...)?.getCursor()` 一条；接口 `src/editorTab.ts:21`（`getCursor()`） | `EditorHandle` 没有「读全部光标」的出口 ⇒ 不假造（请求文档 ①.2 要点里已写这条）。 |

---

## 2. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 这次动了什么 |
|---|---|---|---|
| `src/editorCaretPerLine.ts` | —（新建） | **104** | R3 的执行体：`caretPerLinePlan`（纯函数）+ `addCaretPerSelectedLineCommand`；模块头 6 条上游坐标 + 3 条本仓差别 |
| `src/editorCommands.ts` | 280 | 287 | `:59` import、`:246` 命令名 `'caret.perLine'`（与 `cursor.above/below` 同一族） |
| `src/menus/editMenu.ts` | 193 | 205 | `:110-121` 「全选」之后插菜单行（键位栏空串 + 四条上游坐标） |
| `src/editorSaveTransforms.ts` | 547 | 550 | `:504-507` 清行尾那一段按 `keepTrailingSpacesOnCaretLine` 决定传不传光标 |
| `src/editorFileOps.ts` | 280 | 280 | 净零改动（M3 注入已撤回，见 §5） |
| `tests/editor-caret-per-line.test.mjs` | —（新建） | **95** | R3 的 8 条判据 |
| `tests/save-transforms.test.mjs` | 347 | 405 | `:231-246` 设置项分叉判据；`:266-309` 端到端链判据 |

## 3. §5 自查命令的前后数字（收工实跑）

| 命令 | 本批动手前 | 收工 |
|---|---|---|
| `node --test tests/<标签动作与保存域>`（`editor-caret-per-line` + `save-transforms` + `editor-caret-clone` + `editor-line-ops` + `editor-commands` + `actions-on-save` + `setkeys-batch` + `keymap-bindings` + `editor-popup-menu` + `editor-settings-pages`） | 83 条（该 10 个文件） | **全绿**（最后一次整跑见本节末） |
| 单独 `tests/save-transforms.test.mjs` | 33 绿 | **34 绿 0 红**（新增 2 条） |
| 单独 `tests/editor-caret-per-line.test.mjs` | — | **8 绿 0 红** |
| `npx vue-tsc -b --force` | 0 错 | **0 错**（exit=0，无输出） |
| `node --test tests/module-size.test.mjs` | 5 绿 | **5 绿 0 红**（上限一个没动：ts/vue 900；新模块 104 行、新测试 95 行） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线 8 / 登记 7 | **门禁绿：新增 0**（`src/editorCaretPerLine.ts` 的生产消费方 = `src/editorCommands.ts:59`） |
| `node .tools/find-param-props.mjs` | 0 | **0** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（1308 个文件，两个新 `.ts` import 都带扩展名） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 绿 | **绿**（与本批新增的全部 `platform/…:行号` 一起跑，0 红） |

## 4. 零消费方自查（派单第 3 条：`editorSaveTransforms.ts` 每个 export）

生产消费方只有两处：`src/editorFileOps.ts:20`（`applySaveTextTransforms`、`offsetInText`、`saveTrimOptionsFor`）
与 `tests/save-transforms.test.mjs:17-22`（11 个符号）。逐个 export 核下来：

- **有生产消费方**：`applySaveTextTransforms`、`offsetInText`、`saveTrimOptionsFor`。
- **只有测试消费方**（都在文件内被生产路径调用，不是只过自己测试的死模块）：
  `STRIP_TRAILING_SPACES_WHOLE`、`saveTrimOptionsFromSettings`、`editorConfigSaveOverrides`、
  `applyEditorConfigSaveOverrides`、`editorConfigSaveOverridesFor`、`lineRanges`、`changedLinesAgainstSaved`、
  `ensureNewLineAtEnd`、`isEditorConfigPath`（再导出）。
- **`export` 关键字没人用、符号本身在用**（13 个：`StripTrailingSpacesMode`、`SaveTrimSettings`、
  `UPSTREAM_SAVE_TRIM_DEFAULTS`、`SaveTrimOptions`、`EditorConfigSaveOverrides`、`LineRange`、
  `StripTrailingSpacesInput`、`StripTrailingSpacesResult`、`EnsureNewLineInput`、`EnsureNewLineResult`、
  `FinalNewLineAction`、`SaveTransformSkip`、`SaveTransformInput`、`SaveTransformResult`）：
  全部是模块内部签名在用（如 `saveTrimOptionsFromSettings(settings: SaveTrimSettings): SaveTrimOptions`），
  **不可达代码 = 0 条** ⇒ 按「死代码直接删」的口径**没有可删的东西**；这些是入口的类型契约，
  摘掉 `export` 只是把契约藏起来，对调用方（传对象字面量、走结构化类型）没有行为差别 ⇒ 本批**不动**，
  在此登记为「无外部消费者的 `export`，非死代码」。
- 新模块 `src/editorCaretPerLine.ts` 的三个 export：`caretPerLinePlan`（测试 8 条里 6 条打它）、
  `CaretPerLineInput`/`CaretPerLinePlan`（模块内签名 + 测试形状）；命令本体经
  `src/editorCommands.ts:246` 进生产链路 ⇒ **零消费方 0 条**。

## 5. 反向验证记录（三次注入，全部已撤回）

| 号 | 注入了什么 | 结果 | 撤后 |
|---|---|---|---|
| M1 | `src/editorSaveTransforms.ts:507` 退回 `caretOffsets: input.caretOffsets`（即本批修掉的那个缺口） | `tests/save-transforms.test.mjs` **1 红 / 33 绿**，红的正是新判据「设置项=关 ⇒ 光标那一行照样清」 | **34 绿 0 红** |
| M2 | `src/menus/editMenu.ts:121` 的键位栏从 `''` 填成 `'Shift Alt G'`（键位还没注册就写加速键） | `tests/editor-caret-per-line.test.mjs` **1 红 / 7 绿**，红在「接线：…键位栏为空」 | **8 绿 0 红** |
| M3 | `src/editorFileOps.ts:245` 把 `keepTrailingSpacesOnCaretLine` 写死成 `true`（端到端链第 ④ 段断掉） | `tests/save-transforms.test.mjs` **1 红 / 33 绿**，红的正是链判据 | **34 绿 0 红** |
| 残留检查 | `grep -rn "MUTATION-TEMP" src tests docs` ⇒ **0 命中**（exit=1） | — | — |

写判据过程中我自己钉错的两处（**不是放松断言**，是改正我先算错的值，逐字重算过）：
`tests/editor-caret-per-line.test.mjs:44` 期望 `[3,7,9]` ⇒ 实为 `[3,7,11]`（点要落在**行尾**，`:42` 的 `getLineEndOffset`）；
`:64` 期望主光标 `1` ⇒ 实为 `2`（两段都是「光标在选区尾」时，最后一个 primary 接管焦点，与上游逐个 `addCaret(makePrimary)` 一致）。

## 6. 做不到 / 无法核实

1. **R3 的第 4 处（键位）做不到**：`src/keymapBindings.ts`、`src/keymap.ts`、`src/components/CodeEditor.vue`
   都是保留文件 ⇒ 只交请求（整段可照抄的代码在 `docs/wiring-requests-2026-10-06-caretops.md` §R3-收尾）。
2. **超限提示做不到**：上游 `AddCaretPerSelectedLineAction.java:33-36` 走 `EditorUtil.notifyMaxCarets`，
   本仓没有编辑器内 balloon 通道 ⇒ 静默。我**没有**打开 `EditorUtil.java` 那一页核行号 ⇒ 本批不写它的行号（`无法核实`），
   只按动作类那三行事实（我开过）办事。
3. **只读/viewer 的置灰口径**：上游 `EditorActionHandler` 在这个参考树里**不在**
   `platform/platform-impl/src/com/intellij/openapi/editor/actionSystem/EditorActionHandler.java`（我按这个路径打开过 ⇒ 文件不存在），
   所以没有行号可引 ⇒ 本批的命令不加 `state.readOnly` 门，差别写在模块头第 3 条，**不编**置灰行为。
4. **②.4 的「越界剪掉这一条」没做**：校验在宿主 `native/settings_editor_keys.hpp:48-55`，越界是整份
   `INVALID_SETTINGS`；改成单条剪枝要动 `native/*` + `src/bridge.ts`（都在禁改面）⇒ 只登记差异。
5. **多光标档判不了**：`EditorHandle` 只暴露主光标（`src/editorTab.ts:21`）⇒ 不假造 `getAllCarets`。
6. **`removeTrailingBlankLines` 执行体写了就是不可达代码**（键没落 ⇒ 恒 false）⇒ 按请求文档的明确指示没做。

## 7. git 纪律自查

- 本批**没有执行任何 git 写操作**（无 add/commit/push/checkout/reset/stash/clean），只用了 `git status/diff/log/show` 只读命令。
- 工作区在 11:57:29 被外部提交 `7220a76`（**不是我做的**）扫进了本批的在途改动：
  `git show --stat HEAD` 里含 `src/editorCaretPerLine.ts +104`、`src/editorSaveTransforms.ts +5`、
  `src/editorCommands.ts +7`、`src/menus/editMenu.ts +12`、`tests/editor-caret-per-line.test.mjs +95`、
  `tests/save-transforms.test.mjs +17`。写这份报告时仍未提交的只有 `tests/save-transforms.test.mjs`（+41/−15）。
- 并发碰撞留痕：`src/menus/editMenu.ts` 的 `cursor.above/below` 两行（现 :195-196）、`src/keymapBindings.ts:235-238`、
  `src/components/CodeEditor.vue:865-871`、`tests/editor-caret-clone.test.mjs:129-138` 在我这次会话期间被 keymap2 改成
  「摘键」口径。我原计划改这三处（R1 的收尾半），**发现已被同一批改掉后放弃**，只在 §1 R1 行登记为「已闭环（别人落的）」。
