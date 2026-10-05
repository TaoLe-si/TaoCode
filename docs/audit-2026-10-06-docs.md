# 文档独立验收 · 2026-10-06（docs 侧，只读）

验收对象：`docs/agent-playbook-parity.md` · `docs/ui-parity-checklist.md` · `docs/ui-placement-audit.md` ·
`docs/class-parity-todo.md` · `docs/settings-parity.md` · `docs/source-todo.md` · `docs/inventory/verdict-*.md` ·
`HANDOFF.md` · `docs/handoff-2026-10-05-*.md`

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`

口径：默认文档是错的。每条问题给「文档行号 + 复算命令 + 上游/本仓的真实行内容」。
与 `docs/audit-2026-10-06-tree.md`（代码侧）不重叠：那份查实现，这份只查**文档声称**。

⚠️ 本仓正被约 15 个代理并行改写，**本仓侧的行数/计数会以分钟级漂移**（`src/App.vue` 在我两次读之间从
2708 行未变，但 `docs/inventory/verdict-editor.md:14` 的头部计数在我两次读之间从
`34 + 989 + 199 + 1329` 变成了 `34 + 1039 + 206 + 1272`）。上游树是静态解压，**上游侧的数全部可复算**。

---

## 一、问题表

严重度：**硬错** = 声称与实测直接矛盾，会生产假「无法核实」或假落点；**可疑** = 数字/口径过时或不自洽，
但当前语境（带时间戳的历史段）还能自圆；**已核实无误** 见第二节。

| # | 严重度 | 文档:行号 | 原文声称 | 实况证据 | 建议处置 |
|---|---|---|---|---|---|
| D1 | **硬错** | `docs/agent-playbook-parity.md:136`（§1.5） | 「上游树**缺文件/缺模块**是常态（例：`OpenProjectAction` / `EditRecentProjectsAction` / `ResetLayoutAction` / `UISettings.java` 在本 checkout 里按文件名都搜不到）」——把「重置布局」「打开工程」当成本轮不存在的例证 | 「按文件名搜不到」为真，但「缺功能」为假，且**三条里两条走 §1.5 自己规定的 XML `id` 路就能搜到**：① 重置布局 = `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:444` `<action id="RestoreFactoryDefaultLayout" class="com.intellij.ide.actions.RestoreFactoryDefaultLayoutAction"/>`，类体 `platform/platform-impl/src/com/intellij/ide/actions/RestoreFactoryDefaultLayoutAction.kt:13`，挂在 `PlatformActions.xml:641-643` 的 `LayoutsGroup`；**本仓自己的 `ui-parity-checklist.md:840` 已经引了 `ActionsBundle.properties:1085` = `action.RestoreFactoryDefaultLayout.text=Default`** —— 同一棵树里两个文档互相打脸。② 打开工程 = `idea/customization/min/resources/intellij.platform.customization.min.xml:53` `<action id="WelcomeScreen.OpenProject" class="com.intellij.ide.actions.OpenFileAction$OnWelcomeScreen">`。③ `UISettings` = `platform/editor-ui-api/src/com/intellij/ide/ui/UISettings.kt`（914 行）。只有 `EditRecentProjects`（`--include=*.xml` 全树 0 命中）确实没有对应 id | 把 §1.5 的例子换成**已经三条路都走完**的例：`EditRecentProjectsAction` 可以留；`ResetLayoutAction`/`OpenProjectAction`/`UISettings.java` 三个必须改写成「文件名不同但功能在，坐标如下」，并写「**本节例子里没有一个可以当『无法核实』的依据**」 |
| D2 | **硬错** | `docs/agent-playbook-parity.md:145` | `plugins/keymaps/`（**10 个插件目录 / 26 个 scheme XML**） | 10 个插件目录 ✓（`ls plugins/keymaps` 11 条含 1 个 `OWNERSHIP` 文件）。**26 是全部 XML 的条数**，其中 10 个是各插件的 `META-INF/plugin.xml`；真正的 scheme XML = **16**：`find plugins/keymaps -type f -name "*.xml" -not -path "*META-INF*" \| wc -l` = 16 | 改成「10 个插件目录 / **16 个 scheme XML**（另有 10 份 `plugin.xml`，别混算）」。这正是 §1.6 自己警告过的「把别的量当文件数」同款错误 |
| D3 | **硬错** | `docs/ui-parity-checklist.md:3420` | `platform-impl/.../keymap/impl/ui/`（27 个文件）、`plugins/keymaps/`（**10 个插件目录 / 26 个 scheme XML**） | 27 个文件 ✓；26 个 scheme XML ✗（同上，16 个）。同文件的 `:3125` 写的是「10 目录 / 26 XML」——措辞不含「scheme」，勉强算对，但两处口径不一致 | `:3420` 改 16；`:3125` 也补一句「其中 16 个是 scheme」 |
| D4 | **硬错** | `docs/handoff-2026-10-05-parity-batch.md:140` | `platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/`（**47 个文件**，含 `KeymapPanel.java` 1138 行） | 实测 **27** 个文件（`ls ... \| wc -l` = 27）。1138 行 ✓。**47 恰好是 `Default for GNOME.xml` 的行数**（`wc -l` = 47）—— 也就是 `agent-playbook-parity.md:149-151` 与 `handoff-2026-10-05-agent-protocol.md:47` 声称「已被第二轮验收抓出并改对」的那次错误，**在这份交接件里原样存活** | 改 27，并把该行标注「47 是 GNOME 的行数，不是任何文件数」——这条不修，下一位还会照着 47 去数 |
| D5 | **硬错** | `docs/ui-parity-checklist.md:8` / `:9` / `:12`（文档最开头的「参照 IDEA 源码位置」常驻表） | 主菜单 = `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeMenuBar.kt`；工具窗口条 = `…/wm/impl/Stripe.java` / `StripeButton.java`；设置对话框 = `…/openapi/options/newEditor/SettingsEditor.kt`、`SettingsFilter.kt`（写成 `…/openapi/options/SettingsFilter.kt`） | `find` 全树：**`IdeMenuBar.kt` 不存在**（真实邻居 `platform/platform-impl/src/com/intellij/platform/ide/menu/{IdeMenuBarHelper.kt, IdeJMenuBar.kt, JMenuBasedIdeMenuBarHelper.kt}`）；**`StripeButton.java` 不存在**（本仓别处已在用 `SquareStripeButton.kt`）；`Stripe.java` 存在但在 `platform/platform-impl/src/com/intellij/toolWindow/Stripe.java`（**包写错**）；`SettingsEditor.kt` 不存在（真实 `platform/ide-core/src/com/intellij/openapi/options/SettingsEditor.java`，扩展名+包都不同）；`SettingsFilter.kt` 真实在 `…/options/newEditor/`（文档写的是没有 newEditor 的那层）。同表的 `MainToolbar.kt`、`ChangesViewCommitPanel.kt`、`CommitActionsPanel.kt`、`IdeStatusBarImpl.kt`、`PositionPanel.kt`、`EncodingPanel.java`、`LineSeparatorPanel.java`、`ReadOnlyAttributeWidgetFactory.java`、`ConfigurablesListPanel.kt` **9 条全部逐条命中** | 这 5 条按上面实测路径改掉。这张表是整份清单的「坐标入口」，写错会往下游批量生产假「无法核实」 |
| D6 | **硬错** | `docs/inventory/verdict-actions.md:7` | 「§B 讲部分移植 **36** 条，§C 讲未移植 **6** 条 …… 四档合计 12 + 36 + 6 + 263 = 317」 | §G 实测（317 行逐行数）：`[x]` 12 / `[~]` **40** / `[ ]` **2** / `[-]` 263。**同一文件后面另有一句**「`[x]` 12 + `[~]` 40 + `[ ]` 2 + `[-]` 263 = **317**」（正确），`HANDOFF.md:237` 第 91 批也记了这次改档「actions `[~]` 36→40、`[ ]` 6→2」——只有第 7 行的头部没跟着改。**36+6 == 40+2 == 42，所以总数 317 依旧自洽，假象被总数掩盖** | 改 `:7` 为 12 / 40 / 2 / 263；顺手给 `tests/b6-verdict.test.mjs` 加一条「头部四档必须等于 §G 实测」，光校总数抓不到 |
| D7 | **硬错** | `docs/settings-parity.md:17` | 「清单现在的状态分布：`[x]` **15** / `[~]` 8 / `[ ]` 28，共 **52**」 | 15+8+28 = **51 ≠ 52**，文档自己的加不回去。实测该表编号行 52 条、52 个不同 `id`，分布 `[x]` **16** / `[~]` 8 / `[ ]` 28 = 52 | `15` → `16` |
| D8 | **硬错** | `docs/settings-parity.md:9` | 「IDEA 平台注册：**52** 个；TaoCode 设置节点：**12** 个」 | 52 侧 ✓（与表行数吻合）。**12 侧已不成立**：`src/settingsTreeMeta.ts` 现有 **40** 行 `  { key:` 节点、39 个不同 key（`grep -c "^  { key:" src/settingsTreeMeta.ts` = 40） | 「12」改成实测值并注明复算命令；或写成「本轮新增时是 12，现为 N（复算命令见 `docs/…`）」 |
| D9 | **硬错** | `docs/source-todo.md:29`（§2 `configChooser` 那条，另见 §「已修（第二十五批）」） | 「`App.vue:4152-4166` 新增真实弹层（配置列表 + ↑↓/Enter/Esc + 遮罩关闭）」 | `src/App.vue` 实测 **2708 行**（`wc -l`）——**`:4152-4166` 越界约 1440 行**。行为本身是真的：`configChooser` 的 `v-if` 在 `src/App.vue:2043`、标题行 `:2044`、遮罩 `:2057`。即「结论对、坐标假」 | 改成 `src/App.vue:2043-2057`。这条最危险，因为它是一条**「已修」的正向证据**，下一位会拿它当"真机验过"的凭据 |
| D10 | **硬错** | `docs/settings-parity.md:125`（第 42 行 `project.propDebugger`） | 「`[x]` 已实现……七格全部有真实消费点：…… → `src/debugDataView.ts`、`src/debugInlineValues.ts`）与……→ **`src/debugBreakpointMute.ts`**、`src/components/DebugEvaluateDialog.vue`」 | `src/debugBreakpointMute.ts` **不存在**（全仓 `src/` 无此文件）。同一行为真实落在 `src/debugBreakpointExtras.ts:62-66`（`shouldAutoUnmute`，注释直接写「上游 `XDebuggerGeneralSettings.isUnmuteOnStop` 的唯一消费点」）与 `src/debugDataView.ts:37-38`（`unmuteOnStop`）。`src/components/DebuggerSettingsPage.vue` ✓ 存在，`src/settingsTreeMeta.ts:152` 的 `debugger` 节点 ✓ 存在 | 路径改 `src/debugBreakpointExtras.ts`。**这是"编造的本仓路径"**：行为有、文件没有，门禁只校「路径真实存在」的话应该已经红，说明这条绕过了门禁 |
| D11 | **硬错** | `docs/inventory/verdict-vcs.md:1863`；同类：`docs/inventory/verdict-vcs.md:160` | 前者落点写 `src/vcsLogDetails.vue:1`；后者写「本仓编辑器打开是一条路（`src/App.vue:1` 的标签模型）」 | `src/vcsLogDetails.vue` **不存在**，真实是 `src/components/VcsLogDetails.vue`（目录 + 大小写都错）。`src/App.vue:1` 的实际内容是 `<script setup lang="ts">` —— 一行都撑不起「标签模型」这句话 | 前者改真实路径并指到具体行为行；后者改指 `src/App.vue` 里真的建标签的行。`:1` 这种退化的行号应当被门禁当假落点拦下 |
| D12 | **硬错** | `docs/ui-parity-checklist.md:2302` | 「`canToggleEverywhere()`（`ScopeChooserAction.java:264-266`）」 | `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/ScopeChooserAction.java` 实测 **214 行**（`find -name ScopeChooserAction.java -exec wc -l` = 214），且**该文件里没有 `canToggleEverywhere`**。真实坐标：接口 `platform/lang-api/src/com/intellij/ide/actions/searcheverywhere/SearchEverywhereToggleAction.java:7`、实现 `platform/lang-impl/src/com/intellij/find/impl/TextSearchContributor.kt:268` 与 `platform/lang-impl/src/com/intellij/ide/actions/searcheverywhere/AbstractGotoSEContributor.kt:226`、`:250-251` | 换成上面三处真实坐标。这条是「文件里有这个词就算数」的反面：**类和行号都不对** |
| D13 | **硬错** | `docs/ui-placement-audit.md:2874` | 「`intellij.platform.ide.actions.xml:479` 注册为 `ToolWindowViewModeAction$Group`（`popup="true"`）」 | `platform/platform-api/resources/intellij.platform.ide.actions.xml` 实测 **114 行**，`:479` 不存在。注册行真实在**另一个文件**：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:479` = `<group id="TW.ViewModeGroup" class="com.intellij.ide.actions.ToolWindowViewModeAction$Group" popup="true"/>`（行号巧合相同） | 文件名补 `.impl`。这种「行号对、文件名差一个 `.impl`」最难被机械校验抓到，只能人肉开文件 |
| D14 | **硬错** | `docs/class-parity-todo.md:48` | 「判决表原是 107 类（`ui/tabs` 53 + `ui/popup` 54），而这两个包**真实是 63 + 64 = 127 类**」 | 复算 `docs/inventory/ui.txt`：`/ui/tabs/` 63 行（0 个 `package-info`）、`/ui/popup/` 64 行（**3 个 `package-info`**）⇒ 真实类数 **63 + 61 = 124**。`docs/inventory/verdict-ui-tabs-popup.md:1-7`、同文件 `:211`、`HANDOFF.md:57` 都已把口径定成 **124**，且明确写「旧『127 类』的说法把 package-info 当成了类 —— 这是本轮更正的口径错误」 | `:48` 的「真实是 63 + 64 = 127 类」改成「63 + 64 行，扣 3 个 `package-info` ⇒ 124 类」 |
| D15 | 可疑 | `docs/inventory/verdict-editor.md:14` vs `:243` vs `:2810` | 同一文件里三套四档分解：头部（本轮读到的最新值 `34 + 1039 + 206 + 1272`）、门禁自述句「四档合计 34 + 877 + 172 + 1468 = 2551」（`:243`）、文末注释同 `:243`（`:2810`） | 我在几分钟前实测 §G（2551 行）为 `[x]`34 / `[~]`989 / `[ ]`199 / `[-]`1329 —— 与三个都不完全相同；总数 2551 恒吻合（每套都凑到 2551，掩盖分布漂移）。此文件正被并行代理改写，**具体哪套是当下真值不确定** | 让属主重新生成并**只留一处真值**；`:243`/`:2810` 的「同步」句不该再抄一个旧分解 |
| D16 | 可疑 | `docs/agent-playbook-parity.md:79-90` | 「**2026-10-05 17:50 全仓现状 —— 7 处待清**（`src/autoTest.ts:87`、`src/completionUi.ts:206`、`src/editorGutterIcons.ts:99`、`src/editorInlineValues.ts:18`、`src/editorWhitespace.ts:10`/`:44`、`src/libraryModel.ts:145）」 | `node .tools/find-param-props.mjs` 现在输出「**共 0 处参数属性**」。逐行开这 7 个坐标：`autoTest.ts:87`、`completionUi.ts:206`、`editorInlineValues.ts:18`、`editorWhitespace.ts:10` 现在都是**解释性注释**（「不能写参数属性」），`editorGutterIcons.ts:99` 是 `onMenu(...)` 调用，`editorWhitespace.ts:44` 是 `builder.add(...)`，`libraryModel.ts:145` 是 `private readonly original: Library`（正确写法） | 常驻规约里这张表整段删掉或改成「已清零，工具仍要跑」。留着会让下一位去"修"7 个不存在的问题 |
| D17 | 可疑 | `docs/agent-playbook-parity.md:33`、`:11`、`:12`、`:181` | `src/App.vue`（**2702 行** / 上限 2737）、「只剩 35 行余量」、`CodeEditor.vue`（**1127 行**）、「**842 处改动**（261 已修改 + 581 未跟踪新增）」、「**58 个类型错误 / 19 个文件**」、「工作区有 **700+** 处未提交改动」 | 实测：`wc -l src/App.vue` = **2708**（余量 **29**）、`src/components/CodeEditor.vue` = **1141**；`git status --porcelain` = **316 M + 857 ?? = 1173**；`docs/tsc-error-snapshot-2026-10-05.md:7` 自己写「类型错误：**58 → 5**」。上限 2737 与 `tests/module-size.test.mjs:108` 吻合 ✓，`DEFAULT_LIMIT=900` / `NATIVE_DEFAULT_LIMIT=1100` / `_test.cpp` 1300 分别在该文件 `:22` / `:28` / `:190` ✓ | 这些是带时间戳的快照，但写在**常驻规约**里就会被当现状。建议改成「快照值 + 复算命令」，或直接把数字挪出 playbook |
| D18 | 可疑 | `docs/ui-placement-audit.md:1255` | 「齿轮那一行由 **`src/speedSearchHost.ts`** 供（`ToolWindowGearEntry.fromHost`）」 | `src/speedSearchHost.ts` **不存在**。符号是真的但不在那个文件：`src/menus/toolWindowGear.ts:32` `export interface ToolWindowGearEntry`、`:45` `fromHost?: boolean`、`:58` `{ action: 'window.speedSearch', fromHost: true }`、`:85` 消费 `entry.fromHost`。组件 `src/components/SpeedSearchBar.vue` ✓ 存在 | 路径改 `src/menus/toolWindowGear.ts` |
| D19 | 可疑 | `docs/ui-parity-checklist.md:1069` | 「本仓：`src/chooseTarget.ts`、**`src/components/ChooseTargetPopup.vue`**」 | 后者当前树里**不存在**；`git log --diff-filter=D` 显示它在提交 `ebb5a6a`（「选择实现 / 选择类型」弹层）被删；现役组件是 `src/components/TargetChooserPopup.vue`（`src/App.vue:29` import、`:2425` 渲染）。`src/chooseTarget.ts` / `src/chooseTargetHost.ts` ✓ 存在 | 改名。属于「重构后 `file:line` 腐烂」那一类（playbook §7 第二条自己写过要同步） |
| D20 | 可疑 | `docs/ui-parity-checklist.md:1123`、`:1543` | `native/main.cpp:1845`（两处） | `native/main.cpp` 实测 **1843 行**，`:1845` 越界 2 行（漂移 <±15，但字面上指不到） | 让属主核对该行是否被搬动；顺手改 |
| D21 | 可疑 | `docs/inventory/verdict-find-diff.md`（§G 里 `CombinedDiff*` 一族约 8 行，如 `:554`、`:556`、`:557`、`:560`、`:564`、`:567`、`:569`、`:571`） | 每行都判 `[~]` 并写「本仓有对应物（`src/components/DiffView.vue:158`，……）」 | `src/components/DiffView.vue:158` 实读为 `watch(effectiveRows, () => { changeAnchor.value = -1; activeBlock.value = -1 })` —— 一行 `watch` 撑不起 8 个不同上游类的「合成 diff 对应物」；该文件里 `combined`/`Combined`/`多文件` 合计只命中 **1** 处 | 要么把 `[~]` 降到 `[ ]`（不假装有多文件合成视图），要么指到真正承载该行情的文件与行 |
| D22 | 可疑 | `docs/inventory/verdict-editor.md`、`verdict-folding.md`、`verdict-toolwindow-openapi.md`、`verdict-actions.md` 的 `[-]` 理由 | 四档里 `[-]` 需「附具体理由」（playbook §3：「不是『太复杂』这种空话」） | 机械统计各行理由：`verdict-editor.md` 1356 条 `[-]` 只有 **144 个不同理由**，1268 行共用同一段模板（最热一条 ×264「daemon 的其余内部管线……没有 PSI/索引模型可移植」、次热 ×213「编辑器与文档的实现体……本仓文档 = CodeMirror Text」）；`verdict-folding.md` 29 条 `[-]` 里 **6 条理由就是「同上」**、25 条短于 40 字；`verdict-toolwindow-openapi.md` 8 条「同上（实现）」、179 条短于 40 字；`verdict-actions.md` 126/264 条短于 40 字。另：`verdict-find-diff.md` 把 `MergeConflictResolutionStrategy` / `MergeConflictType` 用模板句「diff 工具类……本仓不需要」判 `[-]`，而本仓**有**冲突解决（`HANDOFF.md:268-273` 第一百批：`src/mergeConflicts.ts` + `src/editorMergeHost.ts` + `src/components/MergeBar.vue`） | 「同上」必须展开成该行自己的依据；被模板降级但本仓真有对应物的类要逐条复核档位（这与 `MEMORY` 里「机械降级规则别把接口契约判不适用」是同一条雷） |
| D23 | 可疑 | `docs/source-todo.md:11` | 「Method 联合 ↔ 原生分派：**107 ↔ 107**，双向差集为空」 | 现测 `src/bridge.ts:109` 的 `export type Method` 有 **162** 个成员（按 `'...'` 计数）。"双向差集为空"这半句我无法独立判定（native 侧分派不是单一形式，我的粗 grep 只数到 58 个字符串字面量，明显低估） | 至少把 162 写进去并重跑一次真正的双向差集；这一条是「已验证干净」的正向结论，过期了就没人再查 |
| D24 | 可疑 | `HANDOFF.md:4` | 「现树 `tests/` 下 **459 个**文件、静态 `test()` 调用 **3891** 个」 | 实测 `ls tests/` = **546** 个（全是 `.mjs`），行锚定的 `test(`/it(` 调用 = **4555** | 数字明显是被并行批次甩下的。建议这条改成"复算命令"而不是常量 |
| D25 | 可疑 | `HANDOFF.md:20` | 「四档计数未变：`platform_rest [~] 5434 · execution [~] 977 · … · daemon [~] 328`」 | 与 `docs/inventory/*_verdict_table.json` 三处不符（实测 5423 / 978 / 349）。同文件 `:9` 已在 21:55 重算并**明确推翻了 `:20`**（「下面正文里那句『四档计数未变』已不成立」），`:161-165` 的 2026-10-04 表也已被 `:9` 覆盖 | 在 `:20`、`:161-165` 行首加「⚠️ 已被 `:9` 推翻」的前缀标记，避免下一位从上往下读先采信旧数 |
| D26 | 可疑 | `docs/class-parity-todo.md:247` | 「B1 判决（`ui/tabs` + `ui/popup` = **107 类**） \| `[x]` 完成：`[~]` 20 / `[ ]` 56 / `[-]` 30 / `[x]` 1」 | 107 与 20/56/30/1 是**第一版**口径；该文件 `:211` 与判决文档都已定为 124 / 实测 8/58/0/59（125 格）。表头单元格里直接印旧数，容易被当现行结论 | 表头改成「原判 107（已废止）→ 现 124」 |
| D27 | 可疑 | `docs/class-parity-todo.md:638`（§25.3） | 折叠「四档：`[x]` 0 / `[~]` 38 / `[ ]` 5 / `[-]` 26 = 69」 | `docs/inventory/verdict-folding.md` 头部与 §G 实测都是 `[x]` 3 / `[~]` 37 / `[ ]` 0 / `[-]` 29 = 69（我逐行数过 69 行）。总数对得上，分布两套 | 以判决文档为准，`class-parity-todo` 里那行改成引用判决文档而不是抄数 |

---

## 二、抽验过且站得住的（覆盖面）

这一节同样重要：说明哪些**不需要动**，以及我用什么命令数的。

**上游坐标 / 计数（全部我亲自数过或打开那一行看过）**

| 声称 | 出处 | 实测 |
|---|---|---|
| `platform/platform-resources/src/keymaps/` **10 个文件**，`$default.xml` **1308 行**，含 `Mac OS X.xml` / `Emacs.xml` | `agent-playbook-parity.md:142`、`ui-parity-checklist.md:3125`/`:3420`、`HANDOFF.md:12` | `ls` = 10 条 ✓；`wc -l '$default.xml'` = 1308 ✓；`Mac OS X.xml`、`Mac OS X 10.5+.xml`、`Emacs.xml` 均在 ✓ |
| `platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/` **27 个文件**、`KeymapPanel.java` **1138 行**、含 `KeyboardShortcutPanel.java` / `KeymapSchemeManager.java` | `agent-playbook-parity.md:144`、`ui-parity-checklist.md:3420`、`HANDOFF.md:13` | `ls` = 27 ✓（`KeymapPanel.java` 1138 ✓，两个具名文件在 ✓）。**只有 `handoff-2026-10-05-parity-batch.md:140` 写 47 —— 见 D4** |
| `plugins/keymaps/` **10 个插件目录** | `agent-playbook-parity.md:145` 等 | ✓（第 11 项是 `OWNERSHIP` 文件，不计目录）。「26 个 scheme XML」部分见 D2 |
| `Default for GNOME.xml` 的 47 是**行数** | `agent-playbook-parity.md:149-150`、`handoff-2026-10-05-agent-protocol.md:47` | `wc -l` = **47** ✓ —— 这条更正本身是对的 |
| `$default.xml` 8 处键位行号「逐行核实全部命中」 | `ui-parity-checklist.md:3125`、`:3420` | 我逐行开：`:279-281` FileStructurePopup=Ctrl+F12 ✓、`:368-370` ActivateTerminalToolWindow=Alt+F12 ✓、`:627` 落在 `<action id="Move">` 块内且就是 `F6`（**F6=Move 成立**）✓、`:732-734` CodeCompletion=Ctrl+SPACE ✓、`:846-848` JumpToLastWindow=F12 ✓、`:849-851` StepOver=F8 ✓、`:870-872` HideAllWindows=Ctrl+Shift+F12 ✓、`:885-887` MaximizeToolWindow=Ctrl+Shift+QUOTE ✓、`:909-911` SmartTypeCompletion=Ctrl+Shift+SPACE ✓ |
| 「F2/Shift+F2 在 macOS 键位表 `System Shortcuts.xml:425,430`」 | `ui-parity-checklist.md:46-47` | `platform/platform-resources/src/keymaps/macOS System Shortcuts.xml`（459 行）`:423` = `<action id="GotoNextError">`、`:425` = `F2` ✓、`:429-430` = GotoPreviousError 的 `shift F2` ✓ |
| `intellij.platform.ide.impl.xml:1313-1318` = `actions.on.save`（provider `ActionsOnSaveConfigurable$ActionsOnSaveConfigurableProvider`） | `settings-parity.md:53` | `:1313` `<projectConfigurable groupId="tools"`、`:1314` provider、`:1315` `id="actions.on.save"`、到 `:1318` 闭合 ✓ |
| `FormatOnSaveAction.kt:24-77` | `settings-parity.md:53` | 文件 90 行；`:20` 类声明、`:24` 在 `isEnabledForProject` 内、`:29-30` `presentableName = ReformatCodeProcessor.getCommandName()` ✓ 支撑「① Reformat code」 |
| `ui-placement-audit.md:181-191` 那一整张设置页 XML 缩写引用表 | 同文件 | 逐个开：`ide.impl.xml:1231` = `editor.breadcrumbs` + `parentId="preferences.editor"` ✓、`lang.impl.xml:1823` = `groupId="editor" groupWeight="160"` ✓、`lang.impl.xml:983` = `Console` `parentId="preferences.editor"` ✓、`todo.xml:49` = `preferences.toDoOptions` `groupId="editor"` ✓、`diff.impl.xml:78` = `diff.base` `groupId="tools"` ✓、`vcs.log.impl.xml:86` = `<projectConfigurable id="vcs.log"` ✓、`git4idea/shared.xml:35` = `<group id="MainToolbarVCSGroup">`（真实文件 `plugins/git4idea/shared/resources/intellij.vcs.git.shared.xml:35`）✓ —— **缩写文件名 + 行号在这批里全部对得上** |
| `impl.actions.xml:449-451` = `MoveToolWindowTabToEditorAction` 只有 XML 注册 | `ui-parity-checklist.md:1037` | 注册行核实：`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:449` ✓（「类文件不在树里」那半句我只搜了 XML，见第三节 U1） |
| `PlatformActions.xml:1337-1345` / `intellij.platform.ide.impl.xml:1596-1601` 的 `MainToolbarQuickActions` 形状 | `ui-parity-checklist.md:3121`、`:3419` | 未逐行（本轮预算）；两处口径互相自洽且 `:3419` 已记录前一次「1594-1601 → 1596-1601」的更正 |
| 上游引用整体健康度 | 全部 9 份目标文档 | 机械扫出 **2014 条** `路径:行号` 形式的上游引用，**1911 条**能解析到真实文件且行号在范围内；越界/找不出的一共 103 条中，绝大多数是我自己按文件名解析时撞上同名文件（`$default.xml`、带空格的 `macOS System Shortcuts.xml`、`UIUtil.java` 多副本）造成的假警报，**真问题只有 D12/D13 两条** |

**档位自洽 / 覆盖率（逐张数过）**

| 判决文档 | 声明 | 实测 | 结论 |
|---|---|---|---|
| `verdict-actions.md` | 317 类；另有一句 12+40+2+263 | §G 317 行 = 12/40/2/263；`actions.txt` 317 行；**317 个类名 0 个缺席** | 覆盖真实，只有 `:7` 头部错（D6） |
| `verdict-find-diff.md` | 尾部「合计 630：`[x]`31 `[~]`352 `[ ]`0 `[-]`247」 | §G 630 行 = 31/352/0/247 ✓；`find-diff.txt` 630 行 ✓ | **完全自洽** |
| `verdict-toolwindow-openapi.md` | 350 类；19+97+0+234=350 | §G 350 行 = 19/97/0/234 ✓；`toolwindow.txt` 350 行 ✓ | **完全自洽** |
| `verdict-ui-tabs-popup.md` | 124 类（63+61，扣 3 个 `package-info`），125 格（`PopupState` 两个包各一份） | `ui.txt`：`/ui/tabs/` 63 行 0 桩、`/ui/popup/` 64 行 3 桩 ⇒ 124 类 / 123 个不同名字；**124 个类名逐个在判决文档里都能找到，0 缺席** | **口径正确**（反而是 `class-parity-todo.md:48` 错，D14） |
| `verdict-vcs.md` | 已判 1783/1783；42+502+17+1222=1783 | §G 1783 行 = 42/502/17/1222 ✓；`vcs.txt` 1783 行 ✓；1762 个不同类名 **0 缺席** | **完全自洽** |
| `verdict-vcs-commit.md` | 18+43+0+17=78 | §G 78 行 = 18/43/0/17 ✓；`vcs-commit.txt` 78 行 ✓ | ✓ |
| `verdict-settings-run.md` | 6+46+2927+268=3247 | §G 3247 行 = 6/46/2927/268 ✓；`settings-run.txt` 3247 行 ✓；JSON counts 一致 | ✓ |
| `verdict-folding.md` | 3+37+0+29=69 | §G 69 行 = 3/37/0/29 ✓；`folding.txt` 69 行 ✓ | ✓（与 `class-parity-todo.md:638` 冲突，D27） |
| `verdict-bookmarks.md` | 3+2+0+0=5 | §G 5 行 = 3/2/0/0 ✓ | ✓ |
| `verdict-platform_rest.md` | 22/5423/0/15129 = 20574 | 与 `platform_rest_verdict_table.json` counts 逐项吻合 ✓；逐类表 `platform_rest_verdict_table.md` 实测 **20574 行** ✓；`platform_rest.txt` 20574 行 ✓ | ✓（本文件是族级表，逐类在 `_verdict_table.md`，且文档 `:4-5` 自己写明了这点，不算覆盖率假象） |
| `verdict-editor.md` | 2551 类 | §G 实测 2551 行 ✓；`editor.txt`/`editor_scan.md` 2551 类 ✓；**分布三套口径互异**（D15） | 覆盖真、分布账乱 |
| `verdict-daemon.md` / `verdict-execution.md` / `verdict-xdebugger.md` / `verdict-projectviews.md` | 族级 | 逐类表行数分别 659 / 1608 / 635 / 755，与各自 JSON `total` 与 `counts` 四档之和**全部吻合** ✓；`verdict-editor.md:89` 抄的 daemon「349 `[~]` / 309 `[-]` / 1 `[x]`」也与 JSON 一致 ✓ | ✓ |

**本仓落点与门禁常量**

| 声称 | 出处 | 实测 |
|---|---|---|
| `src/App.vue` 上限 **2737**、`DEFAULT_LIMIT=900`、`NATIVE_DEFAULT_LIMIT=1100`、`_test.cpp` 1300 | `agent-playbook-parity.md:33`、`:209` | `tests/module-size.test.mjs:108`（`limit: 2737`）、`:22`、`:28`、`:190` ✓ |
| 「`src/breakpointLocations.ts:60-62` 有参数属性禁令的说明注释，是正确写法样板」 | `agent-playbook-parity.md:91` | 逐行核对：`:60-62` 确实是那条注释，`:64` 起是显式字段 ✓ |
| 672 个被引用的本仓路径的存在性 | 全部目标文档 | 机械核对 `src/**` + `native/**` 引用：**672 个不同路径里 10 个找不到**，其中 4 个是刻意的占位/示例（`src/old.ts`、`src/x.ts`、`src/xxx.ts`、`native/git_xxx.cpp`）、2 个是历史陈述（`src/completionGroup.ts`「已删」，git 证实 `d1d880f` 删的；`src/bookmark-probe.ts` 是真机取证用的沙箱文件，实际在 `.tools/ui-parity-proj/src/bookmark-probe.ts` ✓）。**剩下 4 个是真错：D10 / D11 / D18 / D19** |
| 4044 条本仓 `文件:行号` 引用 | 全部目标文档 | 只有 **6 条**越界/找不到（D11 的 `src/vcsLogDetails.vue`、D20 的 `native/main.cpp:1845` ×2、占位 `src/x.ts`/`src/xxx.ts`）。**本仓落点引用整体是健康的**，问题集中在少数几处「文件根本不存在」 |
| `HANDOFF.md:157`「四个没判过的域共 **24231** 类」 | 同文件 | 1608+635+755+659+20574 = **24231** ✓ |
| `HANDOFF.md:9` 21:55 重算的四档 | 同文件 | 5 个域的 `[~]` 值与 5 份 JSON `counts` **逐项吻合** ✓（这也是我判定 `:20`/`:161-165` 已过期的依据） |
| `_platform.json` 三数自洽（`HANDOFF.md:62` 的 9092 重算） | 同文件 | `platform_total 29666 = covered 9092 + rest 20574` ✓ 加得回去 |
| `class-parity-todo.md:4`「7 个域共 **10400** 行（`docs/inventory/*_scan.md`）」 | 同文件 | 逐文件数类行：actions 317 + editor 2551 + projectviews 755 + settings-run 3247 + toolwindow 350 + ui 1397 + vcs 1783 = **10400** ✓ |
| `settings-parity.md:50` 第 5 行「本仓 `TargetChooserPopup` 只有本地进程一档」 | 同文件 | `src/components/TargetChooserPopup.vue` ✓ 存在，`src/chooseTarget.ts` / `src/chooseTargetHost.ts` ✓ 存在 |

---

## 三、我无法判定的（缺什么证据）

| # | 事项 | 缺什么 |
|---|---|---|
| U1 | `ui-parity-checklist.md:1037` 后半句「`MoveToolWindowTabToEditorAction` **本源码树里没有该类文件，只有 XML 注册**」 | 我只跑了 `grep --include=*.xml`（命中 `:449` ✓），**没跑 `.kt/.java` 那两路**。要判整条，得再跑 `find -name "MoveToolWindowTabToEditorAction.*"` 与 `grep -rn "class MoveToolWindowTabToEditorAction"` |
| U2 | `source-todo.md:11`「Method ↔ 原生分派**双向差集为空**」 | 原生分派不是一种统一写法，我的粗 grep（`method == "x.y"`）只捞到 58 个，明显低于 162。需要按 `native/*.cpp` 的路由表逐个枚举才能复算，本轮预算不够。**107 这个数确定过期，"差集为空"这半句未判** |
| U3 | `verdict-editor.md` 1268 行、`verdict-actions.md`/`verdict-toolwindow-openapi.md`/`verdict-folding.md` 大量**共用族级理由**的 `[-]`，是否构成「假降级」 | 判定需要逐类开上游类体看有没有用户可见面，69/317/2551 这种规模本轮不可能逐条开。我只坐实了**形式不合格**（「同上」= playbook §3 明令禁止的空话）与**一个具体反例**（`MergeConflictResolutionStrategy` vs `src/mergeConflicts.ts`）。其余按「可疑，待属主复核」处理 |
| U4 | `HANDOFF.md:4` 的 459 / 3891 到底是「写的时候就是假的」还是「写完就被并行批次甩下」 | 需要该刻的 git 树快照或写该行的会话记录。我只知道**现在**是 546 / 4555 |
| U5 | `ui-parity-checklist.md:5-15` 那 5 条错路径（D5）是"照 2026.2 安装包写的、照本树是错的"还是纯粹编造 | 需要拿 `D:\IntelliJ IDEA 2026.2` 的 jar 清单交叉；playbook §1.4 允许读 `lib/` 资源文本但不允许反推像素，我没有用它做类名核对 |
| U6 | `playbook:11` 的「约 150 个新文件已经落地」 | 「新文件」的口径（未跟踪？含产物？）不明。`git status --porcelain` 的 857 条未跟踪里混着 `build*/`、`dist/` 产物，我没有按 playbook 的产物目录排除规则逐条分类 |
| U7 | `docs/inventory/verdict-*.md` 与 `scripts/verdict_table.py` 的关系是否仍成立（playbook §9 说判决文档是生成物） | `verdict-actions.md`/`verdict-find-diff.md`/`verdict-editor.md` 明显是**手写**的（B6/B7/B1–B5 系），而 `verdict-platform_rest.md`/`verdict-daemon.md` 等标了「由脚本生成」。**两套并存**，我没核对 `tests/verdict-generated.test.mjs` 的门禁到底覆盖哪些文件——不跑测试的前提下无法判 |

---

## 四、按危害排序的修订优先级

**排序依据**：常驻规约 > 判决总账 > 单条判词 > 历史快照。一条假规约会污染后续每一个 agent 的判定；一条过期快照只误导一次。

1. **P0 — `agent-playbook-parity.md:136`（D1）**。§1.5 是**唯一教人「什么时候可以写无法核实」的规则**，它的三个例子里有两个（`ResetLayoutAction`、`OpenProjectAction`）用本节的规则自己就能搜到，第三个（`UISettings.java`）类就在树里。这份规约会**持续生产假「无法核实」**，而且它写的是「先自己搜一遍确认」——读者会以为例子里已经确认过。**这是本次最该改的一行。**
2. **P0 — `agent-playbook-parity.md:145` + `ui-parity-checklist.md:3420`（D2/D3）**。「26 个 scheme XML」是把「全部 XML 条数」当「scheme 条数」，与 §1.6 自己举的「47 是行数不是文件数」**完全同一类错误**，而且就写在那条警告的**上文十行之内**。规则旁边站着规则的违规样本。
3. **P0 — `handoff-2026-10-05-parity-batch.md:140`（D4）**。「47 个文件」这个**已被两处文档宣布改正**的错数仍然活着，并且活在"撤销假规约"那一条里——下一位会拿这行当"已验收"的证据。
4. **P1 — `ui-parity-checklist.md:5-15` 的参照表（D5）**。整份清单（349 KB / 常驻）的坐标入口，5 条指不到文件。它比正文里的单条错引用危害大得多，因为它定义了「这个区域该去哪个上游文件读」。
5. **P1 — 编造的本仓落点：`settings-parity.md:125`（D10）、`verdict-vcs.md:1863`/`:160`（D11）、`ui-placement-audit.md:1255`（D18）、`ui-parity-checklist.md:1069`（D19）、`source-todo.md:29`（D9）**。这些是「行为真的、路径假的」，比纯假控件更难发现；D9 尤其糟，它是一条**「已修」的正向证据**。建议给 `tests/*-verdict.test.mjs` 补两类断言：**行号必须 ≤ 文件行数**，**`:1` 一律不算落点**。
6. **P1 — 四档头部计数与 §G 实测不符：`verdict-actions.md:7`（D6）、`settings-parity.md:17`/`:9`（D7/D8）**。这两个文件都是**别的文档抄数的来源**；`verdict-actions.md:7` 的假分布因为 36+6 == 40+2 而**总数照样吻合**，现有"总数自洽"型门禁永远抓不到它。
7. **P2 — `verdict-editor.md:14`/`:243`/`:2810`（D15）**：同一文件三套分布、`[-]` 模板理由与「同上」（D22）。属主重生成一次即可，但要先决定「族级理由是否允许」的口径，否则改完还会漂。
8. **P2 — `class-parity-todo.md:48`/`:247`/`:638`（D14/D26/D27）**：总控文档抄了已被判决文档废止的旧数。改法是**只引用不抄数**。
9. **P3 — `agent-playbook-parity.md:33`/`:79-90`/`:11-12`/`:181`（D16/D17）与 `HANDOFF.md:4`/`:20`（D24/D25）**：都是带时间戳的快照数字漂了。它们的问题不是"当年数错"，而是**把快照写成了规约**。建议 playbook 里这类数字一律后面紧跟复算命令（playbook §1.6 已经这么要求自己了）。
10. **P3 — `ui-parity-checklist.md:1123`/`:1543`（D20）、`source-todo.md:11`（D23）、`verdict-find-diff.md` 的 `DiffView.vue:158` 复用（D21）**：单点、影响面小，但要在那批活收尾时一起清掉，否则又会攒成下一轮的"腐烂引用"。

**给主代理的一句话**：这批文档的**上游引用质量比本仓落点质量好得多**（1911/2014 能解析，且我逐行看的约 40 条里除 D12/D13 都撑得住结论；本仓侧则是 672 路径里 4 个不存在 + 4044 条行号里 6 条越界）。真正的系统性问题集中在**常驻规约自己违反了它写的规则**（D1–D4），以及**"总数自洽"掩盖分布错**（D6/D7/D15）——现有门禁只看总数，所以这两类都能长期绿着。
