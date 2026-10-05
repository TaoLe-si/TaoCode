# 桶 2 · 2b2 —— 问题视图「按诊断码分组」端到端（四环）

> 交付日期 2026-10-06。上游基准树 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本地解压，逐条实读）。
> 本轮起点：主代理实测基线 `node --test tests/problem*.test.mjs tests/inspection*.test.mjs tests/annotator*.test.mjs` = **74/74 全绿**（无红要修）。
> 前任留下的痕迹：`src/problemsView.ts` 已有 `code` 档 + `codeOf`/`NO_CODE_LABEL` 占位组；`ProblemsPanel.vue` 已有 `<option value="code">按诊断码</option>`。
> **本轮不重做这两处，只做订正与补齐**（订正的地方逐条给上游坐标，见下表）。

## 0. tool id → 诊断码 的等价物（负责人 2026-10-05 指示：架构不等价就用本仓架构还原用户可见功能）

上游的分组键**不是**诊断码，而是"检查项身份"，取自 `HighlightingProblem.kt:85-89`：

```
override val group: String?
  get() { val id = info?.problemGroup?.problemName ?: info?.inspectionToolId ?: return null
          return HighlightDisplayKey.getDisplayNameByKey(HighlightDisplayKey.find(id)) }
```

本仓没有 PSI、没有 `HighlightDisplayKey` 注册表，也没有 `inspectionToolId` 这一列；一条诊断能拿到的身份材料是
`(source, code, tags)` 三列（宿主在 `native/lsp_support.cpp:148-149` 原样上传 `code`/`tags`，
类型在 `src/bridge.ts:118` 的 `LspDiagnostic`，透传到 `src/problems.ts:47` 的 `ProblemRow.code`）。
`src/inspectionIdentity.ts:123-147` 把这三列折成检查项身份（键层级：`#伪检查项` > `检查器::码` > `检查器` > `码`）。

⇒ **等价关系**：上游 `group` 的那把 tool id，在本仓由**诊断码**承接具体粒度（`'code'` 档）、由**身份键**承接完整粒度（`'inspection'` 档）。
两档都算 `groupByToolId` 的落点，因此本轮把上游挂在这个开关上的**四条可见行为**同时接上：
① 键取不到时**不进组**（不编组名）、② 组间按组名自然序 / 未分组的排在组之前、③ 组的可见性谓词、④ 组级抑制/停用与快速修复的关系。

## 1. 判词（四环）

| 环 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 测试名（+ 数字） |
|---|---|---|---|---|---|
| ① | 分组维度 `groupBy` 有 `code` 档 | 已在（前任所留，本轮沿用） | `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:28`（`var groupByToolId: Boolean by property(false)`）；开关动作 `.../ProblemsViewToggleAction.kt:12`；建树 `.../ProblemsViewHighlightingChildrenBuilder.kt:20-40` | `src/problemsView.ts:33`（类型）与 `:36`（`PROBLEM_GROUPINGS`）；键 `:246`（`groupKeyOf`）、`:229`（`codeOf`）、`:260`（`inspectionKeyOf`） | `按诊断码分组：同 code 合并；没码的行**不进组**并排在所有组之前`（tests/problems-view.test.mjs:79） |
| ① | **订正**：无码 ⇒ 不进组，不造「（无诊断码）」占位组 | 已改 | `ProblemsViewHighlightingChildrenBuilder.kt:53-62`（`if (group != null) 组节点 else problems.toProblemNodes(parent, file)`）；`HighlightingProblem.kt:87`（`?: return null`）；组节点的标题只有那个串：`ProblemsViewGroupNode.kt:11-19` | `src/problemsView.ts:229-231`（`codeOf` 无码返空串）、`:294-310`（`groupProblems` 把空键的行收进 `ungrouped`，`label:''`）；`NO_CODE_LABEL`/`NO_INSPECTION_LABEL` 两个占位常量删除 | 同上 + `全表都没有码时，按诊断码分组不会变成空面板`、`渲染：按诊断码分组时组头按码出现、没码的那条不带组头`（`assert.doesNotMatch(html, /（无诊断码）/)`） |
| ① | 分组排序：未分组在前 + 组间按组名自然序 | 已做 | `ProblemsViewNodeComparator.kt:19-20`（`if (node1 is ProblemNodeI) return -1 // problem node before other nodes`）、`:25`（`naturalCompare(node1.name, node2.name)`）；比较器的构造入参来自 `ProblemsViewPanel.java:524-529`（`createComparator()`） | `src/problemsView.ts:273`（`TOOL_ID_GROUPINGS = ['code','inspection']`）、`:307-309`（`result.sort((a,b) => naturalCompare(a.label,b.label))` + 未分组前置）；自然序实现 `:108`（`naturalCompare`，照 `NaturalComparator.java:45-105`） | `按诊断码分组的组序 = 组名自然序，不是首次出现顺序`（tests/problems-view.test.mjs:101，钉 9/10/100 的次序）、`按诊断码分组的组顺序：未分组的那批在最前，其余按组名自然序`（tests/problem-code-grouping.test.mjs） |
| ② | 面板下拉项（诊断码那档） | 已在，本轮改文案 | 动作文案 `platform/platform-resources-en/src/messages/ActionsBundle.properties:2659`（`action.ProblemsView.GroupByToolId.text=Group by Inspection`）、`:2660`（description）；前端版同名 `:2678` | `src/components/ProblemsPanel.vue:484`（`按诊断码（承接上游的 tool id）`）、`:485`（`按检查项（IDEA: Group by Inspection）`） | `② 面板下拉：诊断码那档有图标、有上游文案坐标的 title`；既有锚点 `<option value="code">` 仍由 `面板真的接上了新的过滤/排序/折叠面` 钉住 |
| ② | 图标 | 已做 | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:82`（`ProblemsView.Options` 的 `icon="AllIcons.Actions.GroupBy"`）、`:96-98`（`ProblemsView.GroupByToolId` 的 `icon="AllIcons.ObjectBrowser.SortByType"`） | `src/components/ProblemsPanel.vue:478`（`<Group :size="iconSize.inline" aria-hidden="true" />`，lucide `Group` 承接上游的 GroupBy 语义）、`:472-477`（title 与注释写明上游动作名与坐标）、样式 `:720`（`.problems-field > svg { flex-shrink: 0 }`） | 同上（`/Group :size="iconSize\.inline"/`）；图标尺寸走 `src/uiIcons.ts` 的 `iconSize.*`，模板里没有裸数字 |
| ② | 组头不画图标 | 有意不做 | `ProblemsViewGroupNode.kt:21`（`presentation.addText(name, REGULAR_ATTRIBUTES)` —— 上游的组节点**只有文字**，没有图标）；有图标的是问题节点：`HighlightingProblem.kt:67-75` | 面板组头保持文字（`src/components/ProblemsPanel.vue:647-652`） | 渲染用例断言组头文本正是身份显示名（`tsserver (6133)`） |
| ③ | 选中某码/某组的可见性 | 已做（本仓推广，见 §3.2） | 上游可见性 = 逐条问题谓词 `ProblemFilter.kt:17-22`（`!(state.hideBySeverity.contains(highlighting.severity))`）；"整族显隐"的形状给在 `ProblemFilter.kt:62-75`（`OtherSeveritiesFilterAction`，文案 `ProblemsViewBundle.properties:8` `problems.view.highlighting.other.problems.show=Show Other Problems`）；选中态**不持久化**：`ProblemsViewState.kt:20-33` 全字段里没有"选中的组" | `src/problemsView.ts:325-328`（`focusRows(rows, grouping, focus)`）；面板 `src/components/ProblemsPanel.vue:104-105`（会话态 + 换档清空）、`:165-167`（`focusRows(sortProblems(filterProblems(...)))`）、`:178-179`（`setFocus`）、`:653-655`（组头按钮）、`:489-492`（工具栏的在场标记，`X` 图标） | `focusRows：焦点键命中的行留下，null = 全显示，不分组时不做空动作`、`③ 面板真的把「只看这一组」接进了可见性链路（不是只写了纯函数）`、`渲染：不分组时既没有组头也没有焦点标记（不放假控件）` |
| ④ | 抑制入口与 quickfix 的关系（上游是哪个动作） | 核过并已接 | **一个动作、一个弹层**：`ProblemsView.java` 工具栏组 `intellij.platform.problemView.ui.xml:100-103`（`ProblemsView.QuickFixes`，`use-shortcut-of="ShowIntentionActions"`）→ `ShowProblemsViewQuickFixesAction.kt:73-92`（`IntentionListStep(..., IntentionSource.PROBLEMS_VIEW)`）；来源枚举注释 `platform/lang-impl/src/com/intellij/codeInsight/intention/IntentionSource.java:37-40`（"Quick fixes button in the Problems tool window"）；抑制条目本身就是意图 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19`（`implements Iconable, IntentionAction`）；没有意图时整项不可用 `ShowProblemsViewQuickFixesAction.kt:36-44` | `src/components/ProblemsPanel.vue:240`（取抑制用的规则 id：`row.code?.trim() \|\| ruleIdFromMessage(row.message)` —— **诊断码优先**，这正是这条链的落点）、`:278-297`（`applySuppression`：写文件 → `noteLocalSuppression` → `lsp.change`）、`:257`（同一次请求里拿 codeAction = 上游弹层的 quick fix 那一半）、`:667-679`（注释里逐条写上游坐标）；两段都为空时不渲染（`:680`/`:686` 的 `v-if`） | `④ 面板的抑制入口仍按诊断码取规则，并与快速修复同处一个菜单（上游同一个弹层）`；既有 `抑制动作接进真实写入链路…`、`抑制菜单跳过已抑制的行（上游 isAvailable 口径）`（tests/problems-panel-actions.test.mjs） |
| ④ | 组级抑制 = profile 停用，且**按码分组时一把键停不干净** | 已修 | 上游 profile 的启停粒度 = 单个 `HighlightDisplayKey`：`platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:804`；一个组节点只对应一个 group 串：`ProblemsViewGroupNode.kt:11-19` | `src/problemsView.ts:331`（`MUTABLE_GROUPINGS`）、`:345-356`（`groupMuteKeys`：`code` 档返回组内**每一把**身份键；`file/directory/none` 返回空 ⇒ 不给按钮；`（无来源）`占位组返回空 ⇒ 不往 profile 写没人读的键）；面板 `:353-361`（改走纯函数 + 逐键 `setInspectionToolEnabled`）、`:656`（`v-if="group.muteKeys.length"`） | `code 档的组级停用覆盖组内每一个检查项身份（跨检查器的同一个码不能只停一半）`、`停用整组 ⇒ 这一族问题根本不再进表（profile 门控与面板同一把键）`（真的调 `applyInspectionProfile` 断言返回 null）、`source 档的「（无来源）」占位组不给停用键`、`④ 组头按钮按停用键集合的有无渲染` |

## 2. 改动文件

| 文件 | 新增/修改 | 内容 |
|---|---|---|
| `src/problemsView.ts` | 修改（367 行，上限 900） | `codeOf` 改为「无码 = 空串 = 不进组」；删 `NO_CODE_LABEL`/`NO_INSPECTION_LABEL`；新增 `groupKeyOf`(`:246`)、`TOOL_ID_GROUPINGS`(`:273`)、`groupProblems` 的未分组前置 + 组名自然序(`:294-310`)、`focusRows`(`:325`)、`MUTABLE_GROUPINGS`(`:331`)、`groupMuteKeys`(`:345`) |
| `src/components/ProblemsPanel.vue` | 修改（778 行，上限 900） | 分组下拉加 `Group` 图标与上游文案 title(`:472-486`)；焦点态 `focus` + 换分组档清空(`:104-105`)；`rows` 走 `focusRows`(`:165-167`)；组头「只看这一组」(`:653-655`) 与工具栏在场标记(`:489-492`)；停用键改集合(`:175`、`:353-361`、`:656`)；行菜单的上游同源注释(`:667-679`)；四条 scoped 样式(`:720`、`:764-768`，全走令牌) |
| `tests/problem-code-grouping.test.mjs` | **新增**（196 行 / 13 用例） | 四环的判据 + 两个真实 SSR 渲染用例（夹具 `tests/vue-sfc-loader.mjs`，用 `localStorage` 桩把面板初值设成 `grouping:'code'`） |
| `tests/problems-view.test.mjs` | 修改 | 把「占位组」那条判据改成上游那一形（`没码不进组 + 未分组在前`）；**新增**一条组序自然序判据（9/10/100） |
| `tests/problem-identity.test.mjs` | 修改 | `code`/`inspection` 两档的期望键序改成 `['', '2304', '6133']`（未分组在前）；去掉两个占位常量的引用；保留 `sourceOf` 仍走占位档的断言 |
| `tests/inspection-item.test.mjs` | 修改（一行） | 面板锚点 `muteKeyFor(group)` → 搬进纯函数后的两处锚点（面板的 `muteKeys: groupMute.value ? muteKeysFor(group) : []` + `src/problemsView.ts` 的 `identityOfRow(row).key`），断言意图不变（ playbook §7：搬符号要改 read 路径，断言体不动） |

未动：`src/problems.ts`、`src/problemsPanelState.ts`、`src/localSuppressions.ts`、`src/inspectionProfile*.ts`、`src/annotator*.ts`、任何保留文件。

## 3. 关键判定与订正留痕

### 3.1 订正前任的「（无诊断码）」占位组
前任在 `codeOf` 上造了 `（无诊断码）` 组名，并在 `tests/problems-view.test.mjs` 里钉成判据。上游在**同一个开关**的建树代码里给的是另一件事：`group == null` 的问题直接挂父节点，不生成组节点
（`ProblemsViewHighlightingChildrenBuilder.kt:53-62`），所以那一格是编出来的组名。本轮按上游改回"不进组"，并把
`ProblemsViewNodeComparator.kt:19-20`（问题节点先于组节点）落成"未分组的那批排在组之前"。
`source` 档的 `（无来源）` 占位**保留** —— 它是本仓自己多出来的一档，没有上游的组节点语义可照（`src/problemsView.ts:233-238` 的注释里写明了这条分界）。

### 3.2 「只看这一组」不是上游动作，是上游谓词的推广（如实记）
上游 Options 弹层里没有"按组过滤"这一格（`intellij.platform.problemView.ui.xml:82-99` 全集 = `SeverityFilters` + `SortFoldersFirst` + `SortBySeverity` + `SortByName` + `GroupByToolId`）。
本仓据以下几点把它做成真功能而不是假控件：可见性在上游本来就是逐条问题的谓词（`ProblemFilter.kt:17-22`）、
上游已有"把一批问题当一族整体显隐"的先例（`ProblemFilter.kt:62-75`）、树的选中态在上游也不落存档
（`ProblemsViewState.kt:20-33` 没有该字段）⇒ 焦点只活在会话内，换分组档即清空（否则旧键会把表滤空，这条由测试钉住）。

### 3.3 `code` 档比上游粗，所以停用要按组内每一把身份键
上游一个组节点 = 一个 `HighlightDisplayKey`；本仓"按诊断码"会把 tsserver 的 `6133` 与 eslint 的 `6133` 并成一组，
只停第一条的话另一半还留在表上（前任的实现正是 `group.rows[0]` 取键）。本轮改成逐条折身份、去重、全部停用，
落点粒度仍是上游的单把 `HighlightDisplayKey`（`InspectionProfileImpl.java:804`），并用 `applyInspectionProfile` 真跑一遍断言两条都不再进表。

## 4. 验证

- `node --test tests/problem*.test.mjs tests/inspection*.test.mjs tests/annotator*.test.mjs` = **88/88 通过**（基线 74 + 本轮新增 14：新文件 13 条 + `tests/problems-view.test.mjs` 1 条）。
- `npx vue-tsc -b --force`：报错只来自 `src/editorEnterBlockComment.ts`（51 条，桶 5 在途，非本轮文件，未动）；**过滤掉该文件后零错**，本轮文件无类型错。
- `node --test tests/module-size.test.mjs`：4/5，唯一失败是 `src/components/DebugPanel.vue(909)` 与 `src/components/WelcomePage.vue(920)` 超 900 行未登记（非本轮文件）。本轮文件行数：`problemsView.ts` 367、`ProblemsPanel.vue` 778、新测试 196。
- 三个检测器：`node .tools/find-param-props.mjs`（本轮文件无参数属性）、`node .tools/find-ts-in-mjs.mjs` → 「干净：tests/*.mjs 全部是纯 JavaScript」、`node .tools/find-missing-ext.mjs`（本轮文件无缺失扩展名）。
- `node .tools/verify-fake-controls.mjs`：未点名 `ProblemsPanel.vue`。
- `node .tools/find-orphan-modules.mjs --gate`：唯一红项是 `src/rootsJarEntries.ts`（桶 15b2/14 名下），与本轮无关。

### 4.1 新门禁的反向验证（三条都先看红再撤）

| # | 注入的违规 | 变红的用例 | 撤掉后 |
|---|---|---|---|
| A | 删 `src/problemsView.ts:308` 的 `result.sort((a,b) => naturalCompare(a.label,b.label))` | `按诊断码分组的组序 = 未分组的那批在最前，其余按组名自然序`（新文件）+ `按诊断码分组的组序 = 组名自然序，不是首次出现顺序`（problems-view） | 已还原，绿 |
| B | `ProblemsPanel.vue` 的 `rows` 去掉 `focusRows(...)` 包裹（退回只排序不过滤） | `③ 面板真的把「只看这一组」接进了可见性链路（不是只写了纯函数）` | 已还原，绿 |
| C | `groupMuteKeys` 只返回组内第一把身份键 | `code 档的组级停用覆盖组内每一个检查项身份（跨检查器的同一个码不能只停一半）` + `停用整组 ⇒ 这一族问题根本不再进表（profile 门控与面板同一把键）` | 已还原，绿 |

三处注入全部撤除并 `grep -rn "INJECT-REVERSE" src tests` 为空；还原后同一批次跑出 88/88。

## 5. 做不到 / 未做（具体卡点）

1. **上游 `sortFoldersFirst`（"Folders Always on Top"）没有等价落点 ⇒ 不渲染这个开关。**
   依据：`ProblemsViewState.kt:29`（`var sortFoldersFirst: Boolean by property(true)`）、动作 `intellij.platform.problemView.ui.xml:86-88`、
   文案 `ActionsBundle.properties:2661`、消费点 `ProblemsViewNodeComparator.kt:21-24`（只在 `node1 is FileNode && node2 is FileNode` 时把目录排到文件前）。
   卡点：本仓的问题面板是**一张扁平表 + 一层组头**，分组下拉是单档 —— 目录键与文件键永远不会出现在同一层做兄弟节点比较，
   照搬这个开关就是一个改了也不改变任何像素的假控件。上游那段行为的载体（目录节点下同时挂子目录与文件的树）本仓没有。
2. **上游「只在问题视图里隐去这一条，不改文件」的逐条开关：入口无法核实。**
   读取侧存在：`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewHighlightingWatcher.kt:106`
   （`info.description != null && info.severity.myVal >= level && !highlighter.isSuppressedInProblemsView()`）；
   机制在 `platform/analysis-api/src/com/intellij/analysis/problemsView/toolWindow/ProblemViewSuppressor.kt:12-22`。
   但写入侧 `setSuppressedInProblemView` 在这棵上游树里**只有定义那一行、没有任何调用方**（按包路径 / 语义 `suppressInProblemsView` / XML 里的 `id` 三条路各搜过一遍）⇒ 触发它的动作"无法核实"。
   本仓不把它冒充成按钮：同一用户意图由两条真链路承接 —— 行级「抑制此检查」写注释（`ProblemsPanel.vue:240`、`:278-297`）与组级 profile 停用（§3.3）。
3. **跨工程的批量抑制（"Suppress for all in ..."）未做。**
   上游：`platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/actions/AbstractBatchSuppressByNoInspectionCommentFix.java`、
   同目录 `AbstractBatchSuppressByNoInspectionCommentModCommandFix.java`、`java/java-analysis-api/src/com/intellij/codeInspection/BatchSuppressManager.java`（+ `java/java-analysis-impl/src/com/intellij/codeInspection/BatchSuppressManagerImpl.java`）。
   卡点：这条链要在 PSI 里找"能挂 `@SuppressWarnings` 的最小声明"并按一个 `ModCommand` 事务统一提交/回滚；
   本仓没有 PSI，写文件走 `file.write` 的逐文件 CAS（`ProblemsPanel.vue:268-270`），没有跨文件事务 ⇒ 只能做到"逐行插注释"（已做）与"整检查项停用"（已做）。
4. **组头上不画文档链接/图标。** 上游组节点 presentation 只有文字（`ProblemsViewGroupNode.kt:21`）；
   LSP 侧能给这一格的字段（`codeDescription.description/link`）在本上游树里**搜不到任何引用点**（`grep -rn codeDescription` 无命中）⇒ 宿主也没有透传这一列的通道，无出处不实现。
5. **`showPreview` / `autoscrollToSource` / `openInPreviewTab`（`intellij.platform.problemView.ui.xml:71-79`）不在本环。**
   预览窗格与编辑器↔树联动在本仓没有消费面，`src/problemsPanelState.ts:16-17` 已如实记为"没有承接的上游字段"。

## 6. 共享工作区自查（git 纪律）

- 本轮只写这 7 个文件：`src/problemsView.ts`、`src/components/ProblemsPanel.vue`、
  `tests/problem-code-grouping.test.mjs`（新增）、`tests/problems-view.test.mjs`、`tests/problem-identity.test.mjs`、
  `tests/inspection-item.test.mjs`、`docs/batch-2026-10-06-bucket2b2.md` + `docs/wiring-requests-2026-10-06-bucket2b2.md`。
- **保留文件一个都没动**（`App.vue`/`CodeEditor.vue`/`style.css`/`tokens.css`/`uiIcons.ts`/`bridge*.ts`/
  `actionRegistry.ts`/`keymap*.ts`/`CMakeLists.txt`/`tests/module-size.test.mjs` 在 `git status` 里显示的改动全部来自前几批，不是本轮）。
- 没有跑 `git checkout`/`reset`/`stash`/`clean`，没有 commit。
- ⚠️ 本轮改的那 6 个源/测文件本来就都是**未跟踪**状态（前一批新建，`git status --porcelain` 显示 `??`）⇒
  `git diff -- <文件>` 恒为空、无法用 hunk 自证。改法因此是：改前重读全文（已做，见
  `src/problemsView.ts`/`ProblemsPanel.vue` 的开局通读），改后用 `Read`/`grep -n` 复读关键行（§4 的行号即复读结果），
  并确认注入验证的三次改回都精确回到原样（`grep -rn "INJECT-REVERSE" src tests` 为空）。

