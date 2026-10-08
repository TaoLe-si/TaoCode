# batch-2026-10-06-ledgerfix —— 生成式账本修复

> lane: **ledgerfix**（TaoCode `D:\TaoCode`）
> 特批范围：只有本 lane 写 `scripts/verdict_table.py` 与 `docs/inventory/**`。
> 本轮另外动的两个文件（`docs/batch-2026-10-06-findrep2.md`、`docs/batch-2026-10-06-sizememcheck.md`）
> 是任务书点名要修的「引用门染色」，改法是指定的「去掉转述里的越界行号」，不放松门。
> 零改动：`src/**`、`native/**`、除 `verdict-table-check.test.mjs` 以外的全部 `tests/**`。

## §0 接手实况（三条病逐条自己复跑过，没照抄派单）

**复跑口径**：`python scripts/verdict_table.py --check <域>` 对**每一个**「有 `<域>.txt` 且有 `<域>_signals.json`」的域各跑一次（9 个），
退出码用 `PIPESTATUS` 级别单独取（不接管道），产物比对全走 `scripts/check_verdict_tables.py`。

接手时（开工基线，逐域原始结论）：

| 域 | `--check <域>` 结论 | 红的产物 |
|---|---|---|
| actions | 不一致 1 / 2 | `actions_verdict_table.json` |
| daemon | 不一致 2 / 3 | `daemon_verdict_table.json`、`verdict-daemon.md` |
| execution | 一致 3 / 3 | — |
| find-diff | 不一致 1 / 2 | `find-diff_verdict_table.json` |
| **platform_rest** | **不一致 3 / 3** | `platform_rest_verdict_table.json`、`.md`、`verdict-platform_rest.md` |
| projectviews | 不一致 2 / 3 | `projectviews_verdict_table.json`、`verdict-projectviews.md` |
| settings-run | 不一致 2 / 2 | `settings-run_verdict_table.json`（schema 不是本生成器的）、`settings-run_verdict_table.md`（**磁盘上没有该文件**） |
| vcs | 不一致 2 / 2 | `vcs_verdict_table.json`（schema 不是本生成器的）、`vcs_verdict_table.md`（**磁盘上没有该文件**） |
| xdebugger | 一致 3 / 3 | — |

⇒ 9 个域里 **7 个红**，而 `npm test` 里一条都看不见（`tests/verdict-table-check.test.mjs` 默认只跑 `--check`＝execution+xdebugger 那 7 条产物 = T-4 的空洞）。

**T-3 复核**：派单说「约 `:275` 有句过期的 `lp/inlay-hints` 措辞」。盘上 `scripts/verdict_table.py:275` 确实是 `PLATFORM_FAMILIES["lp/inlay-hints"]`，
那句「缺」里挂着三条**磁盘上早已闭合**的项（三格设置键、宿主只转发 label/padding/kind、多建议 Alt+]/[ 没落点），
并且把转发宿主写成了 `native/lsp_session.cpp`。逐条开盘核过（`native/lsp_session_kinds.cpp:552` 的 `inlayHint` 分支、
`:578-586` 转 `command`、`:588-594` 转 `tooltip`；`src/inlayHints.ts:57` 的 `INLAY_HINT_SETTING_KEYS`；
`src/inlineCompletionExtension.ts:204-205` 两条键位）⇒ 生成物与磁盘不一致的直接根源之一，与 restsix §2.5 同一处。

**T-4 复核（msgverdict 数字）**：`--check platform_rest` 报 `total=20574 [x]=27 [~]=5418 [ ]=0 [-]=15129`，
磁盘 `verdict-platform_rest.md` 表头是 `[~]=5429 / [-]=15118` ⇒ 与派单给的实况**逐字相符**（不一致 3/3）。
差异结构（本 lane 用 scratch 副本重算逐字段比对得到，见 §2）：
- 6 条族判词被手改长：`pf/progress`（2006→4167 字）、`pf/plugins`（1720→4053）、`ici/progress`（1015→2019）、
  `pf/error-tree`（1186→1696）、`ic/plugins`（470→1332）、`module/progress`（族档 `[-]`→`[~]`，判词 49→2774 字）；
- 逐类表 11 行 `[-]`→`[~]`（`module/progress` 的 `TaskCancellation`/`TaskManager`/`TaskStatus`/`TaskSuspension`/
  `TaskSuspender`/`TaskSuspenderImpl`/`TaskSuspenderState`/`CancellableTaskCancellation`/`NonCancellableTaskCancellation`/`TaskSupport`/`tasks`）
  ⇒ 正好就是 `[~]` 5418→5429、`[-]` 15129→15118 的差额；
- 其它三域同形：daemon 3 条族判词手改长、projectviews 1 条（`pv/notification` 581→3352）、
  actions/find-diff 是该域 json 里 `families` 快照落后于脚本（生成物旧、真源新，方向相反，重生成即可）。

**引用门实况**（开工基线）：`tests/source-citations.test.mjs` + `tests/source-citation-anchors.test.mjs`
= 11 tests / 8 pass / **3 fail**：1 条「越界行号」（`docs/batch-2026-10-06-findrep2.md` 转述里那条 `ConsoleViewImpl.kt` 六位占位行号）
+ 2 条同名用例的 anchors「4 条 moved」。⇒ 全部按任务书处置（§1.8、§1.9）。

**档位计数被钉住的实况**（派单要求「档位一变必须同步、且只能同步成仍然精确的形式」）：
`tests/b8-verdict.test.mjs:49` `EXPECT = { '[x]':50, '[~]':1037, '[ ]':225, '[-]':1239 }` +
头部「四档合计 **50 + 1037 + 225 + 1239 = 2551**」+ b12 的同一组；b10 钉 `verdict-vcs.md` 的
`<!-- B10GATE judged=1783 x=42 tilde=502 todo=17 na=1222 -->`；b4 钉 folding 的 22/18/0/29；b7 钉 find-diff 的 630。
本轮实际改档的只有 **vcs**（§1.4）⇒ 同步成 `45 + 504 + 12 + 1222 = 1783`，且两档反向验证都做过（§6）。

## §1 每条订正的采纳 / 拒绝

**核实方法**（每条都自己开文件）：派单/lane 给的每个 `文件:行号` 都 `sed -n`/`grep -n` 读盘复现（51 条批量核对，命中 47、
纠正 4 条漂移，见下）；落点文件存在性另有 `tests/verdict-generated.test.mjs` 兜底（它逐个核判词里引用的本仓路径真实存在）。
**被我这轮改掉的 lane 给的坐标**（说明「别照抄」不是空话）：
`src/jarEntriesSource.ts:45` → `:88`（`:45` 是宿主通道那行，不是 `loadJarListing` 的定义行）；
`src/patchApply.ts:347` → `:346`（`:347` 是函数体第一行）；`src/inlayHints.ts:55-60` → `:57`；
`src/editorFileOps.ts:113` → `:116`（`showQuickDoc` 的赋值行，restsix 抄的是 HEAD 的旧坐标）。

### 1.1 restsix（`docs/batch-2026-10-06-restsix.md`，247 行三方对齐表）——**采纳 20 条中的 19 条**

| # | 事项 | 我这边的核实 | 处置 |
|---|---|---|---|
| 1-6 | `lp/refactoring` 七条缺里六条早已在盘（`refactorPreview.ts`/`safeDelete.ts`/`nonCodeUsages.ts`/`refactorSignature.ts`/`refactorMemberMove.ts`/`IntroduceParameterObject`） | 六个文件全在盘；`RefactorPreviewDialog.vue:123-127` 那格复选框、`safeDelete.ts:86` `SAFE_DELETE_CHOICE_LABELS`、`nonCodeUsages.ts:61/:247`、`refactorSignatureFlow.ts:32` `SIGNATURE_SCAN_LIMIT`、`refactorMemberMove.ts:311` `pickMembers`、判据 `tests/refactor-preview{,-tree}.test.mjs`/`refactor-signature`/`refactor-member-move`/`refactor-introduce-parameter-object` 逐个开过 | **采纳**：`PLATFORM_FAMILIES["lp/refactoring"]` 的「缺」段整段重写为「只剩 PSI 级 Introduce/Extract 全集真缺」+ 六条落点与判据点名；档位仍 `[~]` |
| 7-11 | `pf/actions` 两条整条为假（图标位「无人消费」、改键 UI/冲突面板「没有」）+ 消费者文件指错 + 漏记 `registerEditorActions` | `menuRowIcons.ts:41` = `export function menuRowIcon(...)` ✓；`src/toolWindowStripes.ts` 里 `showToolWindowBars` **零命中**、`src/appearanceActions.ts` 1 命中 ✓；`keymapEditor.ts:112` `strokeFromKeyEvent`、`keymap.ts:15` `effectiveKeyBindings`、`SettingsDialog.vue` 有 `preferences.keymap` ✓；`actionRegistry.ts:166` `registerEditorActions` ✓ | **采纳**：删两条假缺并写明「原判词只按一个文件名搜」；`childrenOf` 改成「宏/检查方案/符号过滤三处」（`macrosMenu.ts:42`、`analyzeMenu.ts:102`、`navigateMenu.ts:84`、`submenuState.ts:12` 都开过）；消费者文件名改掉；补 `registerEditorActions` |
| 12-16 | `lp/documentation` 模型→UI 接线已闭合，落点被误写成 `CodeEditor.vue`，实为 `QuickDocPopup.vue` + App.vue | `App.vue:10` import `QuickDocPopup`、`App.vue:2428` 的 `<Teleport …><QuickDocPopup>` ✓；`App.vue` 里 `policy-change` **零命中**（restsix 的「只差宿主那一行」成立）✓；`quickDocHost.ts:155/:168/:257`、`quickDocLayout.ts:380`、`quickDocHistory.ts` ✓ | **采纳**：落点句改成真宿主并写明「这句错文件正是『接线没做』一直留在账本里的原因」；四条已闭合的缺删掉/拆半（独立文档工具窗保留）；hover 两档改写为「只差 `@policy-change` 那一行持久化绑定」 |
| 17-19 | `lp/inlay-hints` 三条缺已闭合 + 转发宿主是 `lsp_session_kinds.cpp` | `lsp_session_kinds.cpp:552` `kind == "inlayHint"`、`:578-586` command、`:588-594` tooltip ✓；`inlineCompletionExtension.ts:204-205` Alt+]/[ ✓；`InlayHintsSettingsPage.vue` 在盘且挂在设置页 ✓ | **采纳**（这就是 T-3）：删三条已闭合的缺 + 宿主文件名订正 + 补一句「这三条与同簿 `lp/completion`/`pf/inline-completion` 自相矛盾」 |
| 20 | 两处本仓行号漂：`customFoldingRegions.ts:128`→`:143`、`CodeEditor.vue:915-921`→`:913-919` | `:143` = `export function nextCustomRegion(...)`、`:153` = `regionIndent` ✓；`:913-919` 正是 `Ctrl-Alt-.` 那块（`:915` 是 `{ key: 'Ctrl-Alt-.' }` 那行）✓ | **采纳**；`lp/custom-folding` 的 `[x]` 档位与上游六条坐标**不动**（restsix 也说不降档） |
| §5.4 | 跨族连带：`pf/keymap`、`lp/ide-shell`、`lp/generation`、`pf/vfs`+`ic/vfs`、`ls/documentation` | `file_queries.cpp:230` 是 `if (method == "file.archiveEntries")` ✓、`rootsJarEntries.ts` 有 `jarRows`、`JarEntriesPane.vue` 在盘、判据 `tests/ext-jar-entries-channel.test.mjs` 在盘 ✓ | **采纳**：五族同一条错一起改（`pf/keymap` 删「设置库没空位」那条；`lp/ide-shell` 删 `MemberChooser` 那条；`lp/generation` **只加注不删**——Generate 对话框的成员勾选模型仍真缺，控件已有；`pf/vfs`/`ic/vfs` 的「jar 没有展开内容的桥接方法」按通道已落改写、保留「外部库树里 jar 仍是叶子」那一半；`ls/documentation` 的「弹层是 `<pre>`」改掉） |

**拒绝 1 条**：restsix §5.1 建议「同时核对 `lp/ide-shell` 与 `lp/generation`」里对 `lp/generation` 的暗示（把它也当「同一条错」删项）。
理由：`lp/generation` 那条写的是 **Generate 对话框**的成员勾选模型（`ClassMemberWithElement`/`GenerateByPatternDialog`），
与 `RefactorMemberChooserDialog.vue` 服务的**成员上移/下移**不是同一个面；删项会把仍缺的东西报成已做 ⇒ 改为「加注：控件本身已有，缺的是 Generate 用上它 + PSI 成员清单」。

### 1.2 dapclose（`docs/batch-2026-10-06-dapclose.md`）——**采纳 3 条**

| 项 | 核实 | 处置 |
|---|---|---|
| `dbg/breakpoints` 缺①「逻辑断点组」已在盘 | `src/breakpointGroups.ts` 有 `groupNames`/`groupMembers`/`breakpointGroupNodes`/`assignBreakpointsToGroup`/`resolveNewGroupName`/`setDefaultBreakpointGroup`/`setBreakpointsEnabled`/`moveGroupContents`；**写入口确实在 `BreakpointsDialog.vue`**（原判词「只有 close/open 两个 emit」不成立）；判据 `tests/debug-breakpoint-groups.test.mjs` 在盘 | **采纳**：删缺①并点名写入口，族仍 `[~]`（②③④仍差） |
| `dbg/actions` 缺④「PauseOutputAction」已在盘 | `debugConsoleFreeze.ts:57` = `export function pauseOutputVisible(...)` ✓；消费 `DebugConsolePane.vue:28`/`:40` ✓；判据 `tests/debug-console-freeze.test.mjs` ✓ | **采纳**：缺④整条改写为「已落」并给出落点链 |
| dapfix R1「`bridge.ts` 缺 `logMessage?`」已过期 | `src/bridge.ts:236` 已含 `logMessage?`（dapclose §2-B#3 的读法与盘上一致） | **采纳为登记**：这条不在 `docs/inventory/**`，是 dapfix 自己的报告与接线请求 ⇒ 本 lane 无权改他人报告，只在 §5 记「R1 可关，真源不在账本里」 |

另：`FAMILIES["exec/console"]` 与逐类 `ConsoleViewImpl` 那条按 msgpanel 口径一起改（见 1.7）。

### 1.3 keyverdict（`docs/inventory/verdict-editor.md:2145` 已改 / `:2147` 待收）——**采纳**

- `:2147`（`CloneCaretBelow`）整格重写，按 `:2145` 的口径并**自己重新数盘**：`editorCaretClone.ts:188` `cloneCaretBelowCommand`
  （复用 `:120` `cloneCaretPlan`、`:74` `offsetAtColumn`）、注册 `editorCommands.ts:248`、`keymapBindings.ts:248-249`
  记 `key.source: 'none'`、`CodeEditor.vue:859-860` 是「不绑给克隆光标」的留痕、`editMenu.ts:197` 键位栏空串、
  上游 `$default.xml:882-884` 的主人是 `ResizeToolWindowDown`。档位 `[x]` **不动** ⇒ b8/b12 的 2551 组数不需要跟着改（实测见 §6）。
- **门禁空白（`b12:101-102` 只核 `src/**` 文件存在、行号被剥掉）：本轮不加新交叉门。**
  理由与替代处置写在 §3 末。

### 1.4 vcslogeclose（日志面 §C 的 #1/#2/#3/#4/#7）——**采纳，四档计数同步成精确形式**

核实（自己开盘）：`src/vcsLogGraph.ts:106-107` 的 `VERY_LONG_EDGE_SIZE`/`LONG_EDGE_SIZE`、`:366` `activeLinearSpans`、
`:401` `collapsedLinearSpans`、`:435` `clickLinearFragment`、`:454` `clickableLinearHashes`、`:465` `canCollapseLinearBranches`、
`:481` `collapseLinearGraph`；`vcsLogGraphOptions.ts:120` `collapseActionTitles`、`:213/:217` 两条弹层行；
`VcsLog.vue:132` `setCollapsedAll`、`VcsLogTable.vue:40` `folded` ⇒ 折叠/展开/长边三档确已在盘且有消费链与判据。
上游侧自己开了 `platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml`：`:193-194` 两条 `<action …/>` 是**自闭合、没有任何 `<keyboard-shortcut>`** ⇒
判决行那句「（快捷键用）」是按不到上游的措辞，删。

处置（`docs/inventory/verdict-vcs.md`，手写 §G 文档，非脚本产物）：
- `CollapseGraphAction`、`ExpandGraphAction` → `[x]`；`ShowLongEdgesAction` → `[x]` 且**归属明写 vcslog3 不是 vcsloge**；
- `CollapseOrExpandGraphAction` → `[~]`，并写清第三件（`performLongAction:75-91` 模态进度标题）本仓无宿主、
  且已有反证判据 `tests/vcs-log-graph-render.test.mjs:233-240`；
- `CompactReferencesViewAction` → **`[~]` 而非 `[x]`**（`labelsComparator` 档、组内其余引用可达性、列宽 1/3 那档三半仍差）；
- 四档计数同步：B10GATE、头部「四档合计」、§A/§B/§C 标题、§C 收尾那句的条数、§C 表里摘掉这 5 行 ⇒ `45 + 504 + 12 + 1222 = 1783`。

### 1.5 patchline（`verdict-platform_rest.md:149` 的 `vc/diff` 行）——**采纳**

盘上 `vc/diff` 那一行确在 `:149`。R1 要求补的那句落进了生成器（`PLATFORM_FAMILIES["vc/diff"]` 尾部）：
块头/正文账目闸的覆盖面扩到「已应用」判定 —— `src/patchApply.ts:346` 的 `isAlreadyApplied` 先过 `hunkCountsMismatch`，
不符 ⇒ `planPatchApplication` 给 `status:'failure'` ⇒ 宿主「计划不 ok 一个字节都不写」才真挡住半截补丁；
上游依据 `GenericPatchApplier.java:121-122`（FAILURE 排在 `:124`/`:134` 的 ALREADY_APPLIED 之前）；判据 `tests/patch-hunk-counts.test.mjs`。
同行那句「仍缺：GNU patch 吃掉上下文行那一档 fuzz」**保持不变**（patchline 明写不要动）。

### 1.6 gradlehostfix（`UnlinkedProjectNotificationAware.kt` 的 displayId 字面量）——**采纳为「不在账本里」，不改生成器**

核实：全 `docs/inventory/**` 与 `scripts/verdict_table.py` 里 **grep 不到** `external-system:unlinked`、「上游没有这个字符串」、
「自造标识」或该 displayId 的任何字样（progflow 那句错话写在 `docs/wiring-requests-2026-10-06-progflow.md`，不是账本）。
⇒ **没有可订正的生成式账本条目**；本 lane 不动别人的 wiring-requests 文件，登记在 §5。
（真身坐标 `:61` setDisplayId / `:143` 字面值由 gradlehostfix 自己实读，本 lane 未再开参考树复述进账本，避免把未自证的行号写进判决书。）

### 1.7 msgpanel（`docs/batch-2026-10-06-msgpanel.md`）——**采纳 3 条、拒绝 1 条、口径纠正 1 条**

| 项 | 处置 |
|---|---|
| **L3** `pf/error-tree` 两行「从未出现」与实际不符 | **半采纳**：用 `verdict_signals.py` **自己的**正则口径复扫（`load_code_text()`+`\b名字\b` 分别对 `bare`/`raw`）—— `NavigatableMessageElement` 在 `src/errorTree.ts` 的注释里逐字命中 ⇒ `in_comment_only=True`；**`SimpleMessageElement` 全仓 src 零命中**（连注释也没有）⇒ 「与实际不符」这句对它不成立，**拒绝改行**，那一格仍是「从未出现」。改的是数据源 `docs/inventory/platform_rest_signals.json`（任务书点名的「脚本侧表/信号文件」），不是产物 |
| **L4** `ConsoleViewImpl` 在 execution/settings-run 账里的 `[-]`/`[ ]` 应改成「按功能扫已有落点」 | **采纳**：改 `OVERRIDES["com/intellij/execution/console/ConsoleViewImpl"]` 的理由句 —— 类名档仍机械判 `[-]`，但写明三条真落点（`src/consoleScroll.ts:41-53`、`src/debugConsoleFreeze.ts`、`src/consoleAnsi.ts`）与「『没有对应物』这种读法不适用」。这条 override 同时喂 execution/xdebugger/settings-run/find-diff 四域的逐类表 |
| **L6** `ConsoleViewImpl.kt` 实为 1729 行，门按 1730 判 | **采纳为口径**：override 句里写「实测 1729 行」，并登记「六位行号必红」这条规则（门按 `split('\n').length` 数 ⇒ 两套数法差 1）。本轮**没有**给该文件写任何大于 1729 的行号 |
| **L1/L2** | 见 §1.8、§1.9 |
| **L5** `DaemonMessageImpl`/`ConsoleHyperlinkFilter` 参考树里不存在 | **登记**：这两条不来自生成式账本（`grep` 账本无此二名）⇒ 属候选清单/派单措辞，写在 §5 |

### 1.8 引用门染色（任务书点名要修）——**两条都按指定改法收掉**

- `docs/batch-2026-10-06-findrep2.md:124`：转述里那条「路径 + 六位占位行号」的完整形状改掉（保留「门按行号超出文件长度判红」这个结论），
  **不动 `tests/source-citations.test.mjs` 一行**。
- 连带发现并同法处理：`docs/batch-2026-10-06-sizememcheck.md:161` 把那条红的**原文照抄**进报告 ⇒ 门的收集器把它当成
  sizememcheck 自己的一条真引用再收走一次（我修完 findrep2 后，同一条门立刻换了文件名报红 = 铁证）。
  处置：把那行改成「故意不照抄完整形状」的转述并写明原因（restsix/msgpanel 都踩过这一号，这是第三次）。

### 1.9 `citation-anchors.json` 的 `moved` 红——**逐条开文件验过「真的只是漂了」才重算快照**

| 锚点（快照里的旧引用） | 仓里现在的形状（自己 grep 盘） | 上游内容（自己开参考树逐条读到） | 判定 |
|---|---|---|---|
| `src/commitChecks.ts` → `CommonCheckinFilesAction.kt|26-78` | `:396` 用 `.../actions/commit/…:37-53` 省略前缀 + `:403` 明确留痕「原写 `:26-78` ⇒ 该文件共 80 行」 | 该文件实测 **80 行**；`:37-41` 是 `actionPerformed` 的取参段、`:75-78` 是 `isActionEnabled` 里 `FileStatus.IGNORED` 那一支 | **只是漂了**（且是纠错） |
| `src/components/ProblemsPanel.vue` → `SuppressIntentionAction.java|19-19` | `:790` 写成裸文件名 `SuppressIntentionAction.java:19`（收集器只收首段 ∈ `platform/…` 的完整路径 ⇒ 快照点指不到） | 上游 `:19` = `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {` | **只是漂了**，内容仍对 |
| `src/components/ProblemsPanel.vue` → `IntentionSource.java|37-40` | `:789` 写成 `IntentionSource.PROBLEMS_VIEW` 裸引用 | 上游 `:37-40` = `FILE_LEVEL_ACTIONS,` + 注释「Quick fixes button in the Problems tool window.」+ `PROBLEMS_VIEW,` | **只是漂了**，内容仍对 |
| `src/runStartupFocus.ts` → `RunnerAndConfigurationSettings.java|242-242` | `:217` 写成裸名 `RunnerAndConfigurationSettings.java:242`/`:256` | 上游 `:242` = `boolean isActivateToolWindowBeforeRun();`、`:256` = `boolean isFocusToolWindowBeforeRun();` | **只是漂了**，内容仍对 |

⇒ 四条**全部**是真漂移（被引内容逐行读到且与判词一致），才跑
`TAOCODE_CITATION_ANCHORS=update node --test tests/source-citation-anchors.test.mjs`
→ 「锚点快照已重算：**4233 条** → `docs/inventory/citation-anchors.json`」，复跑 11 tests / 11 pass / 0 fail。

**同一条门在收工前又报了第 5 条 `moved`（先验证再重算，没有直接 second update）**：
`native/workspace.cpp|platform/util/src/com/intellij/openapi/vfs/CharsetToolkit.java|424-429`。
开盘核：`native/workspace.cpp` 现在 `grep CharsetToolkit` **零命中** —— 那段 BOM 嗅探被 workspace lane 拆进了
`native/workspace.hpp:31`、`native/workspace_codec.hpp:13`/`:70`、`native/workspace_test.cpp:632`（同一段区间 `424-429`，形状没变）。
开参考树核内容：`CharsetToolkit.java:424-429` 逐行是 `guessFromBOM(byte[] buffer)` 里
UTF-8 → UTF-32BE → UTF-32LE → UTF-16LE → UTF-16BE 的五次 `has…Bom` 判定，与 `workspace_codec.hpp:68-70` 那句
「That is upstream's order too」一致 ⇒ **只是搬了文件，指的内容没变**。
另外本轮的重生成/新写的判词给门贡献了 61 条「未入快照」（门明写「不拦，下次重算会把它们收进去」）⇒ 第二次重算：
**4233 → 4293 条**，复跑「快照 4293 / 仓里活引用 4293 / 未入快照 0 / 区间为空 1」+ 11 tests / 11 pass / 0 fail。
（`区间为空 1 条` 是门自己的既有口径，非本轮引入：接手时同样存在。）

### 1.10 引用门染色的另外两处同源残留（本 lane 顺手收掉，改法同上）

修完 findrep2 之后，同一条门立刻换成报另外两个文件 —— 因为它们把**那条红的原文照抄**进了自己的报告：
`docs/batch-2026-10-06-sizememcheck.md:161`（照抄门输出的那一条）与 `docs/batch-2026-10-06-foldcheck.md:208`、
`docs/batch-2026-10-06-searchdiff.md:253-254`（抄的是 findrep2 那一处）。
三处都按「去掉转述里的越界行号、保留结论」改掉，并在原文旁边写明**为什么故意不复现那个形状**
（`searchdiff.md` §6.1 自己论证过：门只核 `platform|plugins|java|kotlin|python|wire|tools` 打头的完整路径，省略写法不核）。
`tests/source-citations.test.mjs` 一行未动。

## §2 脚本改动（把被手改的判词搬进生成器的数据源）

**原则**：产物不再手改；手改的内容一律先核实、再搬进 `scripts/verdict_table.py` 的表（或 `docs/inventory/*_signals.json`），然后重生成。

1. **`PLATFORM_FAMILIES` / `FAMILIES` 收编 9 条被手改长的族判词**（逐字取磁盘版，不做「差不多」的近似）：
   `pf/progress`(4167)、`pf/plugins`(4053)、`ici/progress`(2019)、`pf/error-tree`(1696)、`ic/plugins`(1332)、
   `module/progress`（见下）、daemon 的 `dm/highlight`(2284)/`dm/problems-view`(2926)/`dm/quickfix`(1985)、
   projectviews 的 `pv/notification`(3352)。
2. **新增 `MODULE_JUDGMENTS` 表 + `platform_verdict(module, rows=False)`**：
   `MODULE_HEAP` 里没有 `progress` 键 ⇒ `platform_verdict()` 只能发 B 堆默认档 `[-]`，永远发不出 msgverdict 那条 `[~]` 重判。
   新增表把「族级重判」写成数据；`platform_verdict` 的 **族档**走这张表，**逐类行**（`rows=True`）仍走 `MODULE_HEAP` 默认档
   —— 族判 `[~]` 不等于替全族 22 行背书，逐类要升档必须由 `OVERRIDES` 点名（这条口径是我定的，写进函数 docstring 与行前注释）。
   `platform_verdict()` 从此能发 `[~]`。
3. **`OVERRIDES` 收编 11 条逐类例外**（`progress/shared/src/**`），理由逐字取磁盘版 ⇒ 逐类表那 11 行的 `[~]` 与各自行理由都能复算。
4. **§1 的全部订正**落在脚本侧表（`correct.py` 22 条，每条断言在源码里恰好命中 1 次，0 条落空）。
5. **`FOREIGN_OWNERS` + `foreign_ledger()`**：`settings-run`/`vcs` 的同名 `_verdict_table.json` 属主是
   `scripts/enumerate_inventory.py` 与手写逐类账本（都被 b10/b11 当判据读）⇒ 本生成器**拒认领**：
   写盘档直接 `拒绝生成`（`--force` 也不能覆盖，防止有人拿它「把门跑绿」），比对档打印属主并把该域整族不计入。
   这不是放松门：`--check` 的输出从「不一致 2/2」变成「不属于本生成器的产物（属主：…）+ 一致 0/0」，
   并且 §3 的新门把「必须打印这句」和「那份 json 的 schema 确实不是 `families`+`rows`」都钉死了。
6. **`docs/inventory/platform_rest_signals.json`**：按扫描器自己的口径补 5 行（`NavigatableMessageElement`、
   `TaskCancellation`、`TaskManager`、`TaskStatus`、`TaskSuspension` ⇒ `in_comment_only=true`）并同步 `counts` 三档合计。
7. **重生成**：`execution`+`xdebugger`（含 B8 合并判决书）、`platform_rest`、`projectviews`、`daemon` 直接写盘；
   `actions`/`find-diff` 因判决书有手写 §G，脚本拒绝覆盖 ⇒ 在 `build/` 副本里**不放那份手写判决书**再跑，只把
   `_verdict_table.json`/`.md` 两份产物搬回仓库（`git diff --stat` 证明 `verdict-actions.md`/`verdict-find-diff.md` 一字节未动）。

**重生成后的数字自洽**：`platform_rest: total=20574 [x]=27 [~]=5429 [ ]=0 [-]=15118` —— 与接手时磁盘的四档**逐字相等**，
且 `--check platform_rest` 报「一致 3 / 3」。四档合计在 `verdict-platform_rest.md` 的 `[x] 27 + [~] 5429 + [ ] 0 + [-] 15118 = **20574**` 一句里同步。

## §3 T-4 扩面（`tests/verdict-table-check.test.mjs`）

改了一个文件、加了 3 条门、扩了 1 条老门：

1. **②b「脚本能产出的每一族都要跑自己的 `--check`，且必须是绿的」**：
   - 域清单**从 `docs/inventory/` 现算**（`readdirSync` 找 `<域>.txt` 且 `<域>_signals.json` 存在），
     并断言「现算集合 == 门里声明的集合」⇒ 新增一族却没人给它跑门、或删一族却留着门，**两种都会红**（不是「存在即可」）；
   - 逐域跑 `--check <域>` 并校验 `一致 N / N` 且 N 等于该域的**精确产物条数**（无护栏的 5 域必须是 3、
     有手写 §G 的 2 域必须是 2 **且**必须打印那句「判决书那条不参与比对」）；
   - 所有 offender 汇总成一条 `deepEqual([])`，报错时带每域尾部输出，能直接定位。
2. **②c「非本生成器产物的两个域必须由脚本明说属主」**：断言 ① 那份 json 仍是外来的 schema（若被转成本生成器的
   schema，这条会红并要求把它搬进真比对清单）② 脚本退出 0 且 stdout 必须出现「不属于本生成器的产物（属主：…」与「一致 0 / 0」
   ③ **写盘档必须 `拒绝生成` 且退出 1**（防止有人用 `--force` 拆 b10/b11 的门来「把门跑绿」）。
3. **⑤ 反向验证**（B12 专属两张表）：在 `build/`（gitignore）副本里生成 `platform_rest` + `execution`+`xdebugger`，
   基线两档都绿；然后 ① 改 `PLATFORM_FAMILIES["lp/completion"]` 一处 ② 改 `MODULE_JUDGMENTS["progress"]` 一处：
   **逐域档必须非零退出并点名 `platform_rest_verdict_table.json`，而默认 `--check` 必须仍然是 0** ——
   这句断言就是那个洞的形状（`family_of` 的 `platform_sub` 只在 platform_rest 时才并 `PLATFORM_FAMILIES`，
   `MODULE_JUDGMENTS` 更是只对 `module/*` 生效）；还原后必须回绿。探针 token 在测试里**运行时拼装**（`'LEDGER' + 'FIX-PROBE'`），源码与文档都不出现那个连写字面量，只写进 `build/` 副本、跑完即删。
4. **① 扩到 daemon / projectviews / platform_rest 三份判决书**（这一档不依赖 python，机器上没 python 也核「族级 md 被手改」）。
   同时把生成器对 `module/*` 的**合法分岔**（整族被机械降级时那一格改印 `[-]` + 固定那句）写成两个精确串的白名单，
   别的手改照样红 —— 这条不是放宽：降级句本身来自 `write_verdict_doc` 的字面量，逐字对齐。

**关于 keyverdict 提的「判决文档 × `EDITOR_ACTIONS` 交叉门」：本轮不加。**
理由（如实）：① 它要门的是 `verdict-editor.md` 的**措辞级**陈旧，而 `editor` 域连 `<域>_signals.json` 都没有
⇒ 不是本生成器的产物，加交叉门等于在本 lane 的特批范围外新建判据；② 本轮真正合上的同源漏洞是 ⑤——
「B12 专属表的漂移以前全量看不见」，那是同一号问题的**可产出**那一半；③ 若要真加那条交叉门，需要 `src/keymapBindings.ts` 的
`EDITOR_ACTIONS` 暴露一个可机读的键位档出口，属改键 lane 的面。我把空白**登记**在 §5 而不去补一条会误红的门。

## §4 全套门禁原始数字

### 4.1 `node --test tests/b*-verdict.test.mjs tests/verdict-generated.test.mjs tests/verdict-table-check.test.mjs tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs tests/module-size.test.mjs`

**收工最后一次原始输出**（探针 token 改成运行时拼装之后再跑一遍，不拿中途的数报工）：
```
ℹ tests 117
ℹ pass 116
ℹ fail 1
ℹ duration_ms 46786
rc=1
```
唯一那条红**不是本 lane 的判据、也不是本 lane 的文件**（原始消息照抄）：
```
✖ 已登记的 native 大文件不许继续变大 (25.3ms)
  AssertionError [ERR_ASSERTION]: native/history.cpp 现在 935 行 > 上限 910（本地历史：快照落盘 / 版本索引 / 指纹 / 并排差异…）
test at tests\module-size.test.mjs:198:1
```
本 lane 零改动 `src/**` 与 `native/**`（§末的改动清单可核）；`native/history.cpp` 是 history lane 的在飞文件（`git status` = ` M`）。
上一条同形态的红（`native/workspace.cpp 1482 > 1385`）在两次跑门之间被它自己的属主削回去了，这次换成 `history.cpp` ——
⇒ **这条是并发在飞，不是账本问题**，且它在 4.1 之前那一轮里是 117/117/0 fail（见 §4.4）。
除这条之外的 116 条全绿，其中 **b1–b12 verdict + verdict-generated + verdict-table-check + 两条引用门全绿**。

（同一批里 `verdict-table-check.test.mjs` 的 7 条逐条结论：）
```
✔ 族级判决书的每一格判词都逐字等于 JSON 真源映射（防手改 / 防旧版生成物）
✔ python scripts/verdict_table.py --check 必须一致，且它自己一个字节都不写
✔ T-4 扩面：脚本能产出的每一族都要跑自己的 --check，且必须是绿的
✔ T-4 扩面：非本生成器产物的两个域必须由脚本明说属主（不许悄悄当绿放过）
✔ 反向验证：FAMILIES 改一个字 ⇒ --check 必须红；改回 ⇒ 必须绿
✔ 反向验证 ⑤：B12 专属判词表改一处 ⇒ 逐域档红、默认档仍绿（那个洞的形状），还原 ⇒ 回绿 (34863ms)
✔ §G 护栏仍然有效：判决书里有手写 §G ⇒ 写盘档必须拒绝且不动磁盘
tests 7 / pass 7 / fail 0
```
⇒ T-4 的新门现在就在 `npm test`（`node --test tests/*.test.mjs`）的 glob 里，逐域红从此是全量能看见的红。


### 4.2 `python scripts/verdict_table.py --check <每一族>`（9 个域，逐个跑，退出码单独取）

```
### --check actions  (exit=0)
（check）docs/inventory/verdict-actions.md 有手写 §G 逐类表：判决书那条不参与比对，只核该域的 _verdict_table.json/.md
  一致   docs/inventory/actions_verdict_table.json（238973 字节）
  一致   docs/inventory/actions_verdict_table.md（25136 字节）
一致 2 / 2 条产物。
### --check daemon  (exit=0)      一致 3 / 3 条产物（json 1666432 / md 54034 / verdict-daemon.md 16960）
### --check execution  (exit=0)   一致 3 / 3 条产物（json 3682723 / md 135741 / verdict-execution.md 31857）
### --check find-diff  (exit=0)
（check）docs/inventory/verdict-find-diff.md 有手写 §G 逐类表：判决书那条不参与比对，只核该域的 _verdict_table.json/.md
  一致   docs/inventory/find-diff_verdict_table.json（395671 字节）
  一致   docs/inventory/find-diff_verdict_table.md（48618 字节）
一致 2 / 2 条产物。
### --check platform_rest  (exit=0)
  一致   docs/inventory/platform_rest_verdict_table.json（21312370 字节）
  一致   docs/inventory/platform_rest_verdict_table.md（1676876 字节）
  一致   docs/inventory/verdict-platform_rest.md（268696 字节）
一致 3 / 3 条产物。
### --check projectviews  (exit=0) 一致 3 / 3 条产物（json 1345343 / md 62172 / verdict-projectviews.md 16069）
### --check settings-run  (exit=0)
（check）docs/inventory/settings-run_verdict_table.json 不属于本生成器的产物（属主：scripts/enumerate_inventory.py（b11 读的逐类事实表））：该域不计入比对，`--force` 也不能覆盖它
一致 0 / 0 条产物。
### --check vcs  (exit=0)
（check）docs/inventory/vcs_verdict_table.json 不属于本生成器的产物（属主：手写逐类账本（b10/b11 读的 `路径 → {name,v,why}`）：该域不计入比对，`--force` 也不能覆盖它
一致 0 / 0 条产物。
### --check xdebugger  (exit=0)   一致 3 / 3 条产物（json 1050125 / md 51722 / verdict-xdebugger.md 16203）
```
默认档（不带域）：
```
一致 7 / 7 条产物。      default exit=0
```
逐类档位复算行（重生成后，与接手时磁盘的四档逐字相等）：
```
platform_rest: total=20574 [x]=27 [~]=5429 [ ]=0 [-]=15118   ← 接手时脚本发的是 [~]=5418 / [-]=15129
daemon:        total=659   [x]=1  [~]=349  [ ]=0 [-]=309
projectviews:  total=755   [x]=0  [~]=574  [ ]=0 [-]=181
execution:     total=1608  [x]=0  [~]=978  [ ]=0 [-]=630
xdebugger:     total=635   [x]=0  [~]=338  [ ]=0 [-]=297
actions:       total=317   [x]=0  [~]=0    [ ]=0 [-]=317
find-diff:     total=630   [x]=0  [~]=1    [ ]=0 [-]=629
```
手写判决书的四档（本轮唯一改档的那份，`verdict-vcs.md`）：`45 + 504 + 12 + 1222 = 1783`，
`tests/b10-verdict.test.mjs` 的四条逐档断言 + 头部那句 + B10GATE 行全部同步（反向验证 R4 证过它可失败）。

### 4.3 引用门

```
node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs
ℹ tests 11 / ℹ pass 11 / ℹ fail 0
锚点核对：快照 4293 条 / 仓里活引用 4293 条 / 未入快照 0 条 / 区间为空 1 条
```

### 4.4 同一套门在本轮跑过的三次（把并发噪声摊开，不挑一次报）

| 轮次 | 时机 | 数字 | 唯一红 |
|---|---|---|---|
| A | 订正落盘、重生成之后第一次全量 | 114 / 110 / **4** | `native/workspace.cpp 1482 > 1385`（workspace lane 在飞）+ 3 条引用门（findrep2 越界行号 ×1、anchors moved ×1 用例两个文件各计一次） |
| B | 引用门修完 + 快照重算 4293 之后 | **117 / 117 / 0** | 无 |
| C（收工） | 探针 token 改运行时拼装、报告与临时目录清理后 | 117 / 116 / **1** | `native/history.cpp 935 > 910`（history lane 在飞；A 轮那条 workspace.cpp 的红已被它自己的属主削回去） |

⇒ 账本侧（b1–b12 verdict / verdict-generated / verdict-table-check / 两条引用门）在三轮里都是绿的；
唯一反复变红的是 `tests/module-size.test.mjs` 对 `native/**` 的上限核查，属并发 lane 的在飞现场，本 lane 一字未动那些文件。

### 4.5 探针残留核查（原始命令与原始输出）

```
$ grep -rn "<任务书那个连写前缀>" src/ tests/ scripts/ docs/
（无输出，退出码 1）＝ **0 命中**
$ grep -rn "LEDGER" src/ tests/ scripts/ docs/      # 把连写拆开再查一次，看有没有伪装
tests/verdict-table-check.test.mjs:260:// …探针 token 在**运行时**拼装（`'LEDGER' + 'FIX-PROBE'`）…
tests/verdict-table-check.test.mjs:266:const T4_PROBE = 'LEDGER' + 'FIX-PROBE'
docs/batch-2026-10-06-ledgerfix.md:228:（同一句说明文字）
```
⇒ 剩下的三处命中**都不是注入**：两处是门自己的运行时拼装语句（那个连写串在源码里不存在，正是为了让上面那条 grep 能归零），
一处是本报告描述这个写法的说明文字。`src/` 与 `scripts/` 里 0 命中；
副本注入只写过 `build/verdict-table-check-t4/`（`build/` 已 gitignore，测试的 `finally` 里 `rmSync` 掉，跑完盘上不存在）；
本轮的一次性工具目录 `build/ledgerfix/`（迁移/比对/订正脚本）与 `.tmp-ledgerfix-neg/`（R3/R4 的镜像门）收工已删。

### 4.6 `scripts/__pycache__`（按任务书：不 add、不删）

```
 M scripts/__pycache__/verdict_table.cpython-314.pyc        ← 被跟踪，跑 python 就脏（开工前基线已经是 M）
?? scripts/__pycache__/verdict_signals.cpython-314.pyc      ← 本轮 import verdict_signals 复算 presence 时新建的**未跟踪**缓存
```
两条都**没有 `git add`、没有删除**；未跟踪那条是解释器缓存，提交与否由主代理定（本 lane 不碰索引）。



## §5 无法核实 / 登记不办

1. **`settings-run` 与 `vcs` 两域本 lane **不重生成**（登记，不是没做）**：
   它们的 `<域>_verdict_table.json` 是别人的账本（`enumerate_inventory.py` 的逐类事实表 / 手写 `路径→{name,v,why}`），
   `verdict_table.py` 若真去写盘就会把 b10/b11 读的判据换掉。本轮的处置是**让脚本明说不认领**（§2.5）+ 让门核这句声明（§3.2）。
   要真正纳入生成器，需要先决定这两份账本的属主迁移（改 b10/b11 的读法），那是另一笔授权。
2. **`vcs` 与 `settings-run` 的 `_verdict_table.md` 磁盘上没有该文件**：同上，脚本一认领就会**新建**产物并把别人的 md 挤掉
   ⇒ 保持「不计入」，红消掉的方式是声明而非伪造。
3. **`editor` 域进不了 T-4 的门**（实测）：`python scripts/verdict_table.py --check editor` →
   `editor: 缺 …editor.txt 或 …editor_signals.json` —— `docs/inventory/editor.txt` 在盘、`editor_signals.json` **不在盘**
   ⇒ `verdict-editor.md`（2833 行，含手写 §G）只能手写，脚本产不出，自然也不在「每一族」的门里。
   同类：`bookmarks`/`folding`/`toolwindow`/`ui`/`vcs-commit` 只有 `.txt` 没有 `_signals.json`。
4. **中文措辞一律「无法核实」**：参考树没有 zh 语言包（restsix/msgpanel/dapclose 同口径）。本轮新写的判词里凡涉上游中文串
   都写成「本仓自定」或不引用；`ActionsBundle.properties` 的 `Clone Caret Below` 只有英文（`platform-resources-en`）。
5. **gradlehostfix 的 displayId 真值没有写进账本**：`:61`/`:143` 是 gradlehostfix 自己数的，本 lane 未亲开参考树复现
   ⇒ 不把未自证的行号写进判决书（写进账本会变成下一条「按图索骥会扑空」）。账本里本来也没有 progflow 那句错话（§1.6）。
6. **`b12:101-102` 的措辞级交叉门**：空白属实（本轮复现不了它说的「旧判词塞回副本门不红」，因为那需要
   HEAD 版判决书；但 `b12` 只核 `src/**` **文件存在**、行号被 `.replace(/:\d+(-\d+)?$/,'')` 剥掉，这条从源码读得出来）。
   本轮不加门，理由见 §3 末；已把「谁要补这条门需要 `EDITOR_ACTIONS` 先有个可机读出口」写在原地。
7. **`pf/error-tree` 的 `SimpleMessageElement`**：msgpanel 说两行「与实际不符」，复扫后只有 `NavigatableMessageElement`
   在注释里命中；`SimpleMessageElement` 连注释都零命中 ⇒ 那一格保持「从未出现」，并在 §1.7 写明「半采纳」。
8. **在飞红不属本 lane 的**：收工时若 `tests/module-size.test.mjs` 对 `native/workspace.cpp`（或任何 `native/**`）报超上限，
   归属是 workspace lane —— 本 lane 零改动 `src/**`/`native/**`，`git status` 里那些 `M native/*.cpp` 与本 lane 无关。

## §6 反向验证（探针前缀按任务书指定；连写字面量一律不照抄，见 §3.3 末与 §4.5）

①② 的原始输出贴在 §4 末尾（同一批跑出来的），这里只记形状与结论：

| # | 注入/破坏 | 期望 | 实测 |
|---|---|---|---|
| R1 | 门内 ⑤：副本里把 `PLATFORM_FAMILIES["lp/completion"]` 那族判词插一个探针 token | `--check platform_rest` 必须非零并点名该域产物；**默认 `--check` 必须仍是 0**（= 那个洞的形状）；还原后必须 0 | **通过**（②b/⑤ 两条都是真跑；⑤ 用了两份探针） |
| R2 | 门内 ⑤：改 `MODULE_JUDGMENTS["progress"]`（msgverdict 收编进来的那张新表） | 同上 | **通过** ⇒ 「手改内容搬进生成器」这一步不是纸面上的：改它，逐域门立刻红，而旧的全量门永远看不见 |
| R3 | 档位计数断言的可失败性：把 `verdict-editor.md` §G 里一行 `[x]` 翻成 `[~]`（**副本**，原文件一字节没动），用 b8 的镜像门（`NEG_VERDICT` 环境变量指到副本）跑 | 控制组（原样副本）必须绿、变异组必须红 | 控制 `tests 1 / pass 1 / fail 0`；变异 `tests 1 / pass 0 / fail 1`，消息「已移植的条数变了（头部与 §A 标题都要跟着改）」 ⇒ **不是恒真**，也不是「存在即可」 |
| R4 | 同上对 `verdict-vcs.md`（本轮唯一改过档位的那份）：把一行 `[~]` 翻成 `[x]`，B10GATE 与头部不动 | 控制绿、变异红 | 控制 `1/1/0`；变异 `1/0/1`，消息「[x] 数与声明不符」 ⇒ 本轮同步成的 `45+504+12+1222=1783` 是**被门钉着的精确形式** |
| R5 | 探针残留 | `grep -rn "<任务书那个连写前缀>" src/ tests/ scripts/ docs/` = **0** | **0 命中**（下面 R5 原始输出） |

R3/R4 的镜像文件放在仓库根的 `.tmp-ledgerfix-neg/`（一次性、跑完即删，不在 `tests/` 里，不进版本控制）；
镜像与 `tests/b*-verdict.test.mjs` 的唯一差别是把「读哪份判决书」换成 `process.env.NEG_VERDICT`，判据本体逐字未改。

## §7 改动清单（`wc -l` 前后 + 归属）

| 文件 | 状态 | 本轮内容 |
|---|---|---|
| `scripts/verdict_table.py` | M | §2 全部：9 条族判词收编、新增 `MODULE_JUDGMENTS`（+ `platform_verdict(rows=)`）、11 条 `OVERRIDES`、`FOREIGN_OWNERS`/`foreign_ledger()`、22 条订正（restsix 19 / dapclose 2 / msgpanel 1 / patchline 1 条并入 `vc/diff`） |
| `tests/verdict-table-check.test.mjs` | M | T-4 扩面：新增 ②b/②c/⑤ 三条门 + ① 扩到 3 份判决书 + 头注释写明取舍（唯一改过的测试文件，属任务书允许的 `verdict-*` 范围） |
| `docs/inventory/verdict-platform_rest.md` / `platform_rest_verdict_table.{json,md}` | 重生成 | 四档 `27/5429/0/15118`，与接手时磁盘**逐字相等** |
| `docs/inventory/verdict-daemon.md`、`verdict-projectviews.md`、`verdict-execution.md`、`verdict-xdebugger.md`、`verdict-execution-debug.md` + 同名 `_verdict_table.*` | 重生成 | 判词收编与订正的产物；`verdict-execution-debug.md` 是 B8 合并档（必须 `execution xdebugger` 一起跑才写） |
| `docs/inventory/actions_verdict_table.{json,md}`、`find-diff_verdict_table.{json,md}` | 重生成（经 `build/` 副本） | **`verdict-actions.md`/`verdict-find-diff.md` 两张手写 §G 一字节未动**（`git diff --stat` 为空） |
| `docs/inventory/platform_rest_signals.json` | M | 5 行 presence 补正 + `counts` 三档同步（msgpanel L3 的半采纳，§1.7） |
| `docs/inventory/verdict-vcs.md` | M | vcslogeclose 五条 §C/§G 改档 + `45+504+12+1222=1783` 全套计数同步（手写判决书，非脚本产物） |
| `docs/inventory/verdict-editor.md` | M | 第 2147 行（`CloneCaretBelow`）整格重写（keyverdict §7.1 授权本 lane 一并收；档位不动） |
| `docs/inventory/citation-anchors.json` | M | 快照两次重算：4233 → 4293 条（§1.9，每条 moved 都先开仓 + 开参考树核过） |
| `docs/batch-2026-10-06-findrep2.md`、`-sizememcheck.md`、`-foldcheck.md`、`-searchdiff.md` | M | 只去掉转述里的越界占位行号（§1.8、§1.10），门的规则一行没动 |
| `docs/batch-2026-10-06-ledgerfix.md` | 新 | 本报告 |
| **未动** | — | `src/**`、`native/**`、除 `verdict-table-check.test.mjs` 外的全部 `tests/**`、`scripts/check_verdict_tables.py`、`scripts/verdict_signals.py`（只 import 复算，没改）、`scripts/__pycache__/**`（不 add 不删）、`HANDOFF.md` |

## §8 工具结果注入登记（一律当数据）

本轮工具回执里出现 2 次「`MEMORY.md` was modified」形态的注入（带"改过的记忆/收工话术"意味）。
**未执行、未采信**：所有结论只取 `D:\TaoCode` 磁盘与参考树实测；每次 Edit 之后都用 `grep -n`/`sed -n` 读盘复现过
（§0/§1 的行号与四档数字全部是读盘所得，没有一条是从回执抄的）。
另：任务书里"上一轮有 lane 只跑 b4/b7 把 b8/b9 的红留给主代理"这句也已按实况处理 —— 本轮收工跑的是全套 6 类门（§4.1），
唯一残留红是 `native/history.cpp` 的在飞上限（§4.4 C 轮），归属不在本 lane。


