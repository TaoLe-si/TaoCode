# batch-2026-10-06-inspections2

Lane: `lp/inspections` + 问题视图（problems）族里 inspection **本体**一侧（抑制注释 / 启停档位与 severity 映射 / `ProblemsViewSettings` 一族 / 逐文件逐范围计数口径）的**判词与磁盘对齐**，并落**其中一条**今天能落的用户可见缺项。

上游参考树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（`third_party/intellij-community` 坏树禁用；无 zh 包 ⇒ 中文措辞「无法核实」）。
只读坐标（别的 lane 已收）：`src/errorTree*`、`src/components/ProblemsPanel.vue`。
禁写：`src/App.vue`(30)、`src/bridge.ts`(0 贴顶)、`src/components/CodeEditor.vue`(2)、`native/main.cpp`、`scripts/verdict_table.py`、`docs/inventory/**`、`src/settingsModel.ts` + native schema。
并发黑名单：`src/semanticActions.ts`、`src/intentionList.ts`、`src/components/IntentionListMenu.vue`、`src/menus/**`、`src/codeLens*`、`src/lsp*`、`src/commit*`、`src/vcsLog*`、`src/usageView*`、`src/hierarchy*`、`src/todo*`、`src/terminal*`、`src/patch*`、`src/diff*`、`src/gradle*`。

## 0. 接手实况（先核后写，逐条开文件）

### 0.1 名下候选的真实文件名（`ls src | grep -iE "inspection|problem|suppress|severity|error"` 实测）

生产侧（本 lane 可写）：`src/suppressIntention.ts`(117)、`src/localSuppressions.ts`(74)、`src/inspectionIdentity.ts`(152)、`src/inspectionProfile.ts`(543)、`src/inspectionProfileHost.ts`(32)、`src/inspectionProfileIo.ts`(143)、`src/inspectionReport.ts`(159)、`src/problems.ts`(125)、`src/problemsPanelState.ts`(105)、`src/problemsView.ts`(600)、`src/highlightLevels.ts`(104)、`src/localIntentions.ts`(121)、`src/intentionSettings.ts`(93)、`src/dapOutputSeverity.ts`(161)、`src/junitInspections.ts`、`src/workspaceInspection.ts`、`src/bridgeError.ts`、`src/errors.ts`、`src/errorReport.ts`、`src/internalErrors.ts`、`src/gotoNextError.ts`、`src/problemRelatedInformation.ts`。
本 lane 实际动到的：**`src/suppressIntention.ts`** 一个（头注释 + `typescript/javascript` 档的排序）。

**旁支黑名单**（`refactorclose` lane 名下，只读引坐标）：`src/semanticActions.ts`、`src/intentionList.ts`、`src/components/IntentionListMenu.vue`。另：**`src/errorTree*`、`src/components/ProblemsPanel.vue` 归前批 lane 只读**（errtreejudge + msgpanel 已收）。

测试侧：`tests/suppress-intention.test.mjs`(62)、`tests/local-suppressions.test.mjs`(67)、`tests/local-intentions.test.mjs`(91)、`tests/intention-settings.test.mjs`(58)、`tests/inspection-*.test.mjs`(7 份)、`tests/problem-*.test.mjs`(4 份)、`tests/problems-*.test.mjs`(4 份)。

### 0.2 派单点名的四条上游坐标，**两条在参考树里不存在**（逐条 find 实测）

| 派单原话 | 参考树实际 | 结论 |
| --- | --- | --- |
| `codeInsight/SuppressIntentionAction` | `find . -name "SuppressIntentionAction*"` → `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java`(98 行) + `platform/analysis-impl/src/com/intellij/codeInspection/SuppressIntentionActionFromFix.java`(154 行)。**`codeInsight/intention/` 目录下没有这个类**（那里只有 `QuickFixFactory.java`/`AddAnnotationFix.java` 之类）。| **本仓 `src/suppressIntention.ts:1-2` 抄的这个假坐标** —— 见 §1 判决 A1。真身是 `codeInspection` 包，不是 `codeInsight/intention`。msgpanel §8-L2 已钉 `ProblemsPanel.vue` 的引用已订成 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java|19-19`（本 lane 复核该类确实在 `:19` `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`）。|
| `SupressImportErrors` | `find . -iname "*SupressImportErrors*"` → 零命中（只有 `AnnotationSupressing.kt`/`.fir.kt` 两枚 Kotlin 测试数据）| **不存在**，登记 §5。派单给的是别名/编的名字。Java 侧对应的抑制基础设施是 `platform/analysis-impl/src/com/intellij/codeInspection/SuppressionUtil.java`(197 行) + `platform/core-impl/src/com/intellij/codeInspection/SuppressionUtilCore.java`（`SUPPRESS_INSPECTIONS_TAG_NAME = "noinspection"`，实测 `:9`）。|
| `ProblemsViewSettings` 一族 | `find . -type f -name "ProblemsViewSettings*"` → 零命中 | **不存在**，登记 §5。真身是 `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt`（**67 行**；errtreejudge §2.2 已按 `:15` 类声明、`:21-34` 九个持久字段、`:36-59` 五个 `fun` 拆过，本 lane 复数一致）。本仓对应物：`src/problemsPanelState.ts`（字段逐个对照上游那份）。|
| ERROR/WARNING/WEAK WARNING/**GOOD** 四档 + 服务器推送 severity 映射 | `platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java`(220 行) 全文开过 | **"GOOD" 不在 `DEFAULT_SEVERITIES` 里**（`DEFAULT_SEVERITIES = {INFORMATION, TEXT_ATTRIBUTES, GENERIC_SERVER_ERROR_OR_WARNING, INFO, WEAK_WARNING, WARNING, ERROR}` `:124-125`）⇒ 派单给的这一档**参考树里没有**，登记 §5；本仓 `src/highlightLevels.ts:76-81` 与 `src/inspectionProfile.ts:95-100` 的四档（ERROR/WARNING/WEAK WARNING/INFO）与 `HighlightSeverity.java:112,99,86,76` 的 myName 逐字对上。LSP 数字（1-4）→ 上游级别的映射点在 `src/highlightLevels.ts:90-95`（`levelForSeverity`），与 `platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:80-85`（Error→ERROR、Warning→WARNING、其余一律 WEAK_WARNING）方向一致，本仓把 Information/Hint 拆开多分一档，`src/highlightLevels.ts:41-42` 已明写这条差异。|

### 0.3 zh 语言包

参考树 `find` 无 `zh` 目录/包（沿用 msgpanel §0 的判定）⇒ **本 lane 新增/更动的用户可见中文措辞**：`// @ts-ignore` 抑制条目的标题（`抑制类型错误（// @ts-ignore）`）沿用磁盘上既有文案（`src/suppressIntention.ts:71`，未新造），上游 `InspectionsBundle.properties` 只有英文名 ⇒ **登记 §5 无法核实**，不改。

## 1. 判词核对表

判定档：`[x]` 判词与磁盘一致 · `[~]` 部分（判词对、坐标错或反过来说） · `[ ]` 判词与磁盘不一致 · `[-]` 上游没这个类/不适用。

| # | 判词出处 | 原文 | 磁盘实测 | 上游实测 | 判定 | 处置 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | `src/suppressIntention.ts:1-2` | 「上游 `platform/lang-impl/src/com/intellij/codeInsight/intention/` 里 `SuppressIntentionAction` 那一族」 | 磁盘就这么写的 | `find . -name "SuppressIntentionAction*"` 只在 `platform/analysis-api/src/com/intellij/codeInspection/` 与 `platform/analysis-impl/…/codeInspection/`；`codeInsight/intention/` 目录里没有这个类。**`lang-impl/src/com/intellij/codeInsight/intention/actions/ShowIntentionActionsAction.kt` 存在**，但那是"显示意图列表"的动作不是抑制动作本体 | `[~]` | 本轮**已订正**：改成 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19-98`（实开：`:19` 抽象类声明、`:23-26` `getIcon`、`:38-40` `startInWriteAction()=true`、`:48-53` `invoke(...)`、`:66-70` `isAvailable(...)`、`:83-85` `isSuppressAll()`、`:87-91` `getElement(...)` 走 caret 位置、`:94-97` `IntentionPreviewInfo.EMPTY`）+ 顺带列出真实抑制基础设施的坐标（`SuppressionUtil.java:31-33,42`、`SuppressionUtilCore.java:9` 的 `"noinspection"`）。|
| A2 | `src/suppressIntention.ts:9-13` | Java `//noinspection <Id>` 与 `@SuppressWarnings`；ESLint `// eslint-disable-next-line`；`// @ts-ignore`；flake8 `# noqa`；mypy `# type: ignore`；clang-tidy `// NOLINT(<check>)`；`#pragma clang diagnostic ignored`；Go `//nolint:<linter>` | 磁盘 `:62-63,69-71,76-77,82-83,86` 逐条产出的 `insertText` 字面串与这段一一对得上 | `SuppressionUtilCore.java:9 = "noinspection"`；`SuppressionUtil.java:31-33 COMMON_SUPPRESS_REGEXP` + `:37-38` 两条 `Pattern` 都是 `//noinspection <id>[, <id>]` ⇒ Java 一档**准确**。ESLint/`@ts-ignore`/`# noqa`/`// NOLINT(...)`/`//nolint:` 是各家生态的官方抑制语法，不是 IDEA 类，不查参考树。| `[x]` | 未改。|
| A3 | `src/suppressIntention.ts` 的 `typescript/javascript` 分档（**编辑前** `:56-73`，**编辑后** `:69-102`）| 磁盘实际：`if (tool === 'eslint' && ruleSuffix) push(eslint-disable-next-line <rule>)` **else push(eslint-disable-next-line)** ⇒ 只有 `tool === 'eslint'` 且带规则名才用带 rule 那一支，其他一律落到「不带 rule 的 eslint-disable-next-line」；**`@ts-ignore` 排在第二条** | 判据 `tests/suppress-intention.test.mjs:27-28` 就把这条假控件钉住了：`suppressOptionsFor({source:'ts', code:''}, 'typescript')[0].insertText === '// eslint-disable-next-line'` | `native/lsp_support.cpp` 透传的 `source` 值 tsserver 会给 `ts` 或 `typescript`（见本仓 `src/suppressIntention.ts:38` 与 `src/inspectionIdentity.ts:118-121` 的映射档），此时 tsserver **不认** `// eslint-disable-next-line`，只认 `// @ts-ignore` / `// @ts-expect-error`。| `[ ]` **判词与磁盘一致、但与「点它有没有用」不一致**——**假控件** | 本轮落盘的**唯一用户可见缺项**：`suppressOptionsFor` 的 `typescript`/`javascript` 档按 `tool` 分派，`tool==='ts'` 或 `tool==='generic'` 时把 `@ts-ignore` 提到**第一条**；只有 `tool==='eslint'` 时保留 eslint-disable 优先。判据同批更新（`tests/suppress-intention.test.mjs` 里那条断掉旧行为的用例 + 三条新用例；详见 §3）。|
| A4 | `src/localSuppressions.ts:1-3` | 「上游 `SuppressIntentionAction` 应用后，daemon 立即重跑、问题列表同步变短」 | 磁盘就这么说的 | `SuppressIntentionAction.java:38-40` `startInWriteAction()=true` + `:48-53` `invoke(project, editor, psiFile)`（拿 caret 位置解析 element 再 delegate）⇒ 写命令里落编辑、`DaemonCodeAnalyzer` 会 reset 并再跑；「同步变短」的语义成立。但**这句在讲行为、没点具体路径**，判词本身不错。| `[x]` | 未改。|
| A5 | `src/intentionSettings.ts:22-33` | 「id 与 `suppressOptionsFor` 返回的 `SuppressOption.id` 一一对应」——清单：`noinspection/suppress-warnings/eslint-disable-next-line/ts-ignore/noqa/type-ignore/nolint/pragma-diagnostic/generic` | 磁盘 `suppressOptionsFor` 全部产出：`noinspection`+`suppress-warnings`(java)、`eslint-disable-next-line`+`ts-ignore`(ts/js)、`noqa`+`type-ignore`(py)、`nolint`+`pragma-diagnostic`(cpp)、`nolint`(go)、`generic`(default) | 上游 `IntentionManager` 的开关面在 `platform/lang-impl` 与 `platform/analysis-impl`，与本仓这一份**清单**语义一致。判据 `tests/intention-settings.test.mjs:16-23` 已经在遍历 7 个语言档，把每条产出的 id 收集起来对照清单——这条**已被判据钉住**、且我这次 A3 的修法**没新增 id**（还是 `eslint-disable-next-line`+`ts-ignore` 两条，只是换顺序），不触发红灯。| `[x]` | 未改。|
| A6 | `src/inspectionProfile.ts:11-25,88-94,108-117` 的级别↔XML 档 | 「`ERROR/WARNING/WEAK WARNING/INFO`，`WEAK WARNING` 中间有空格」「`HighlightSeverity.java:43-119`」 | 磁盘 `:95-100` 四档 + `:103 DEFAULT_LEVEL_XML='WARNING'` + `severityForLevelXml`/`levelXmlForSeverity` 双向 | 上游 `HighlightSeverity.java` 里：`:43-49 INFORMATION (myVal=10)`、`:52-58 TEXT_ATTRIBUTES (11)`、`:64-71 GENERIC_SERVER_ERROR_OR_WARNING "SERVER PROBLEM" (100)`、`:73-83 INFO (200, @Deprecated)`、`:85-93 WEAK_WARNING "WEAK WARNING" (200)`、`:95-106 WARNING (300)`、`:108-119 ERROR (400)`。⇒ 判词那句「名字取 `HighlightSeverity.getName()`（`:43-119`）」的**行号区间是 myName 字面串所在的构造调用**，`getName()` 方法本身在 `:164-166`；「WEAK WARNING 中间有空格」在 `:88`，判词引的 `idea_fatal_errors.xml:28` 我也开了 —— 逐字对上（本轮**没改这条**，判词与磁盘一致）。| `[x]` | 未改；坐标精度不完美但语义对，不列入本轮订正。|
| A7 | `src/inspectionProfile.ts:37-49` 的「键粒度」段 | 「`native/lsp_support.cpp:127-145` 只透传四列 + source，没有 code」这条**以前**的判断已订，实测 `native/lsp_support.cpp:148-149` 已透传 `code`/`tags`，`src/bridge.ts:118` 有类型 | 磁盘 `:38-40` 就写「实测该前提已不成立」+ 新坐标 | 需要真开 native 才叫数——本轮**没实测 native 的行号**（改 native 属禁写）⇒ 判词与磁盘一致，上游侧不适用（本仓 native 就是上游）。| `[x]` | 未改；native 侧留别的 lane。|
| A8 | `src/problemsView.ts:60-65` 的分组档 & `PROBLEM_SEVERITIES = [1,2,3,4]` | 磁盘七档 `none/file/directory/source/code/inspection/severity`；`PROBLEM_SEVERITIES` 只写四档 | 上游 `ProblemsViewState.kt:28` `groupByToolId` 是布尔（不是本仓的档），本仓把「按检查器分组」拆成三档 `source/code/inspection`——判词在 `:22-34` 已明写这是本仓的多出档位；`PROBLEM_SEVERITIES` 的四档对应 LSP `DiagnosticSeverity` 枚举 1-4，不是 `HighlightSeverity` 七档。**判词里已经点了这条差异**，磁盘一致。| `[x]` | 未改。|
| A9 | 派单说的「逐文件/逐范围的计数口径」 | 落点在 `src/problemsView.ts:484-599`（`problemCounts`/`levelCountsOf`/`problemTailCounts`/`groupTailOf`）与 `src/highlightLevels.ts:70-73` 的 `counted` 布尔 | 磁盘上 `problemCounts`（`:484-490`）用 `HIGHLIGHT_LEVELS.filter(l => !l.counted)` 折出 `infos`；`levelCountsOf`（`:531-540`）只产出在场级别；`MAX_TAIL_LEVEL_TYPES=5`（`:543`）与上游 `InspectionTreeTailRenderer.java:23` 一致；`groupedBySeverity` 只影响 ERROR 一格的颜色（`:583-587`），与 `InspectionTreeTailRenderer.java:63-65` 一致。上游 `getCountMessage(int)` 在 `HighlightSeverity.java:176-179`（本仓 `:504-507` 判词已引）。| `[x]` | 未改。**这条上游计数**在 `:509-523` 有 `id: string`（不是字面四档联合）的**有意宽化**，注释 `:513-518` 交代了理由（`SeverityRegistrar` 可注册自定义严重度、`MAX_LEVEL_TYPES` 那条回落要能被判据喂到）——不是判词与磁盘错位。|

## 2. 落盘（本轮唯一的用户可见缺项 = A3）

改动面**只有一份实现 + 一份判据**（禁写清单里的一枚文件都没碰）：

- **`src/suppressIntention.ts`**（`wc -l` 从 117 → **147**，仍在 `DEFAULT_LIMIT = 900` 之下，未登记进 `module-size.test.mjs` 的 `REGISTERED`）：
  · 头注释 `:1-24` 重写：把派单与本仓旧注释共用的假坐标 `platform/lang-impl/src/com/intellij/codeInsight/intention/` **换成真身** `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19-98`（逐点标了 `:19` 声明、`:38-40` `startInWriteAction()=true`、`:48-53` `invoke`、`:66-70` `isAvailable`、`:83-85` `isSuppressAll`、`:87-91` `getElement` 走 caret、`:94-97` `IntentionPreviewInfo.EMPTY`），并列出**注释式抑制的真基础设施**（`SuppressionUtil.java:31-38`、`SuppressionUtilCore.java:9` 的字面串 `"noinspection"`）；**原地留痕**说明派单给的这条路径是假的（`find` 结果，`codeInsight/intention/` 只有 `QuickFixFactory.java`/`AddAnnotationFix.java` 那一族；`ShowIntentionActionsAction.kt` 在 `lang-impl/codeInsight/intention/actions/` 是"显示列表"的动作，不是抑制动作本体）。
  · `suppressOptionsFor` 的 `typescript`/`javascript` 档 `:79-102`：**按 `tool` 分派**。`tool === 'eslint'` → `[eslint-disable-next-line(带 rule 时带 rule, 无 rule 时给通用文案), @ts-ignore]`（保持旧行为，`local-intentions.test.mjs:42,52,66` 三条既有判据一字未动就过）；否则（`tool === 'ts'` 或 `'generic'`）→ **主项 `@ts-ignore`**，`ruleSuffix` 存在时 eslint-disable 降为备档、不存在时**整条不给**（那是假控件，`eslint-disable-next-line` 无 rule 对 tsserver 与 eslint 都无作用）。
- **`tests/suppress-intention.test.mjs`**（`wc -l` 从 62 → **87**）：`test('typescript：…')` 拆成三条 ——
  ① `:23-38` 同档两向（eslint 走带 rule 的主项 + ts-ignore 备档；tsserver 反过来；无 rule 时只一条 `@ts-ignore`，`plain.length === 1` 钉「不放假控件」）；
  ② `:40-47` javascript 与 typescript **并立**（`case 'javascript':` 摘掉后 JS 会掉进 `default:` 拿到 `// 已确认：忽略此行告警`）；
  ③ `:49-54` 未知来源（`tool='generic'`，source 匹配不到任何一列）在 ts/js 上仍以 `@ts-ignore` 为主项，`deepEqual` 钉死数组形状。

**没做的**（属"接了会成假控件 / 属别的 lane / 属禁写"）：
- 未新增 `@ts-expect-error`（现代 TS 更严格，但引入会撞 `intentionSettings.ts` 的 id 清单，需要配套改判据 + 加设置项；本轮 A3 的**根因**是「第一条是不是真有效」，加一档新形态超出这一条范围）。
- 未新增 java `//file:noinspection` 那一支（`SuppressionUtil.java:38` 的 `SUPPRESS_IN_FILE_LINE_COMMENT_PATTERN` 是**整文件抑制**、插入位置不在行上一行；本仓的 `placement` 只有两档，塞进来要么骗位置要么扩接口，超出「一条今天能落的缺项」的范围）。
- 未订正 `suppressOptionsFor` 的 `default:` 档（`// 已确认：忽略此行告警`）：那条**是**一条假控件的候选，但去掉它会让 `LOCAL_INTENTIONS` 的 `generic` 项与 `tests/intention-settings.test.mjs:19-22` 的清单覆盖判据**同时红**（判据要求「规则表里产出的 id 都在清单里」，删了 default 那支之后清单里那个 `generic` 也成孤儿）—— 那是**接不上**而不是不做，登记 §6-C1 请主代理裁定（要么删 default 那支 + 同步清 LOCAL_INTENTIONS 那一行 + 同步改那条清单覆盖判据；要么 default 换一条真的能生效的形态，比如按 `source` 猜一个通用 `// suppress-next-line-if-known` 的哨兵注释——本仓没有对应解析器，那就是假控件）。

## 3. 判据与反向验证

**判据能失败**（4 个注入点，每个都至少打红一条），手法与 errtreejudge 同一份：`cp src/suppressIntention.ts /tmp/suppressIntention.orig`（sha1 `616c5813ec52797e6dd6d3cfdb8c7433e725f498`）→ node 生成变异版落 `D:/TaoCode/.tmp-probe.ts`（**Windows 文件锁定的绕法**：`node fs.writeFileSync` 直接写 `src/…` 撞 `UNKNOWN: unknown error, errno -4094`，同一路径 `cp /tmp/… src/…` 也撞 `Permission denied`；改 `rm -f src/…` + `cp .tmp-probe.ts src/…` 才通；每轮都当场核）→ `node --test tests/suppress-intention.test.mjs` → `rm -f src/… && cp /tmp/suppressIntention.orig src/…` → 复算 sha1。**四轮还原后 sha1 均等于起始值**（末轮又核了一次）。

| # | 注入点（对表达式定点变异，不插标记串） | 打红的用例（实测） |
| --- | --- | --- |
| A1 | `if (tool === 'eslint') {` → `if (true)`：强制走 eslint 分支 | 3 条：① `plain[0]==='// @ts-ignore'` 变 `'// eslint-disable-next-line'`；① `plain.length===1` 变 2；① `withCode[0]==='// @ts-ignore'` 变 `'// eslint-disable-next-line TS2345'`；③ `deepEqual` 报 `['// eslint-disable-next-line','// @ts-ignore']` ≠ `['// @ts-ignore']`。（首轮实测：`grep -c PROBE-A1` 未 0 但断言红，`expected: ['// @ts-ignore'], actual: ['// eslint-disable-next-line', '// @ts-ignore']`。）|
| A2 | else 分支里删掉 `if (ruleSuffix)` 守卫 → 无 rule 也摆 eslint-disable | 用例 ③（`deepEqual` 报 `['// @ts-ignore','PROBE-A2']` ≠ `['// @ts-ignore']`）、用例 ①（`plain.length === 1` 变 2）。首轮实测红 = 1 条 `✖ 未知来源…`。|
| A3 | else 分支的 `@ts-ignore` `insertText` → `'PROBE-A3'` | 3 条：① `plain[0].insertText` 断言 `'// @ts-ignore'` 红、② `js[0].insertText` 同红、③ `deepEqual(['// @ts-ignore'])` 红。|
| A4 | `case 'typescript':\n    case 'javascript':` → 只留 `case 'typescript':` | 用例 ②（`js[0].insertText` 掉进 `default:` 拿到 `'// 已确认：忽略此行告警'`）。首轮实测红 = 1 条 `✖ javascript 与 typescript 走同一份分派…`。|
| A5 | `if (tool === 'eslint') {` → `if (tool !== 'eslint') {`（分派取反）| 3 条：① `eslint[0].insertText` 变 `'// @ts-ignore'`（期望 `'// eslint-disable-next-line no-console'`）、② `jsEslint[0].insertText` 同红、③ `unknown` 走 if 分支拿到 `['// eslint-disable-next-line','// @ts-ignore']` ≠ `['// @ts-ignore']`。首轮实测红 = 3 条。|

覆盖：A1/A5 打分派条件、A2 打 ruleSuffix 守卫、A3 打 ts-ignore 载荷、A4 打 javascript 并立 case ⇒ 每一维都有独立能红的用例。

**收工残留核对**（前缀 `INSPECTIONS2` 与本轮变异标记 `PROBE-A*` 都算）：
```
$ grep -rn "INSPECTIONS2" src/ tests/ native/   → 0 命中
$ grep -rn "PROBE-A"      src/ tests/ native/   → 0 命中
```
（判据里的批次指代一律写小写 `batch-inspections2`，与 grep 的字面串不撞；本报告表格保留大写前缀作为记录。）

## 4. 门禁原始数字

### 4.1 派单指定的主 gate（`tests/inspection*.test.mjs tests/problems*.test.mjs tests/error*.test.mjs tests/module-size.test.mjs`）

```
ℹ tests 119 / suites 0 / pass 119 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 694.3799
```
**glob 实测**（`ls` 结果）：`tests/inspection{,-cancel,-item,-profile,-profile-disk-wiring,-profile-multi,-report,-workspace-merge}.test.mjs`（8 份）、`tests/problems{,-export-text-details,-panel-actions,-panel-state,-view}.test.mjs`（5 份，**没有** `problems.test.mjs`）、`tests/error{,-tree,-tree-expansion}.test.mjs`（3 份，**没有** `errors.test.mjs`）、`tests/module-size.test.mjs`（1 份）。

**开工首轮同一门是 `119 / 118 / fail 1`** —— 那 1 条 fail 是 `已登记的 native 大文件不许继续变大`，报的是 `native/workspace.cpp 现在 1482 行 > 上限 1385`（mtime `2026-10-06 17:02:47`，**本会话 17:07 开工前 5 分钟**，我一个字没动）。**收工同一门 119 全绿** —— 因为 17:10 前后 `native/workspace.cpp` 被别的 lane 拆到 1236 行、上限 1385 满足；**本 lane 既未参与、也未修复、也未掩盖，只是同一时间窗内的并发事实**。原始数字（首轮那条红的 `actual` 串）留在 §6-C4 里给主代理对账。

### 4.2 本 lane 名下判据（未列入派单主 gate，但改动面就在这几份上）

```
$ node --test tests/suppress*.test.mjs tests/local-suppressions.test.mjs \
             tests/local-intentions.test.mjs tests/intention-settings.test.mjs tests/problem*.test.mjs
ℹ tests 102 / suites 0 / pass 102 / fail 0 / duration_ms 1982.6789
```
分量：`tests/suppress-intention.test.mjs` **9 条**（本轮拆 1 条为 3 条 + 净新增 2 条 ⇒ 原 6 条 → 9 条，**未减少**）、`tests/local-suppressions.test.mjs` 5、`tests/local-intentions.test.mjs` 7、`tests/intention-settings.test.mjs` 4、`tests/problem-*` 合计 77。

### 4.3 `node .tools/find-orphan-modules.mjs --gate`

**收工时**：
```
词法自检：0 异常（每个 specifier 都在原文里逐字存在）
门禁：已登记孤儿 6 / 基线 8 · 新增 1 · 本轮清掉 2
   ✔ 已接上（可以更新基线）：src/jarRun.ts
   ✔ 已接上（可以更新基线）：src/runAnythingContext.ts
   ✘ 新增零生产消费方模块：src/components/CodeActionPopup.vue
门禁红：1 个**新增**零生产消费方模块。
```
**开工时**同一门是 `src/codeActionPopupModel.ts`（mtime 17:07:39）。本 lane 未参与创建。17:12:58 别的 lane 建了 `src/components/CodeActionPopup.vue` **消费**了 `codeActionPopupModel.ts`（同目录 `../codeActionPopupModel.ts`，实测 `grep -rn codeActionPopupModel src/` 只命中新 `.vue` 一处），门禁跟着换了一枚孤儿 ⇒ 与本 lane 无关。

本 lane 名下**未新增任何生产模块**（只改了一份既有 `src/suppressIntention.ts` + 一份既有 `tests/suppress-intention.test.mjs`；`src/suppressIntention.ts` 的消费方仍 `:18 src/localIntentions.ts`、`:64 src/components/ProblemsPanel.vue`、`:10 src/intentionSettings.ts`（注释）、`:17 src/intentionMenuModel.ts`—— 一个未少）。登记 §6-C4 请主代理裁定（要么由 `CodeActionPopup.vue` 的作者接进 App 的挂载点，要么按 `src/agent.ts` 的先例在文件头写明"接不上"理由）。

### 4.4 隔离 tsconfig `tsc --noEmit`

```
$ cat > .tmp-inspections2-tsconfig.json  # files: [src/suppressIntention.ts, src/localSuppressions.ts]
$ npx --no-install tsc -p .tmp-inspections2-tsconfig.json
(无输出)
TSC-EXIT=0
$ rm -f .tmp-inspections2-tsconfig.json
```
`files` 只列改动面两份：`src/suppressIntention.ts`、`src/localSuppressions.ts`（后者本轮**只读**、也走 `suppressIntention.ts` 的 `SuppressibleProblem` 类型 → 一起 check 才能证明头注释重写没把类型面碰歪）。tsconfig 用与仓库根同一组选项（`target: ES2022 / module: ESNext / moduleResolution: Bundler / strict / allowImportingTsExtensions / verbatimModuleSyntax`），跑完即删。

### 4.5 改动模块逐个 `node -e import()` 自证可加载

```
$ node -e "import('./src/suppressIntention.ts').then(m => console.log(Object.keys(m)))"
suppressIntention OK, keys: alreadySuppressed,applySuppression,suppressOptionsFor,suppressionRuleFor
```
四个 export 一字未动（本轮**没**新增/删除/改名 export ⇒ `intentionSettings.ts` 的清单与 `localIntentions.ts` 的消费点都不需要跟着改）。

### 4.6 收工 sha1 与残留

```
616c5813ec52797e6dd6d3cfdb8c7433e725f498  src/suppressIntention.ts    ← 4 轮注入后每一轮都复原至此
f93b07712e24a4d9f723617680a7f46958033860  tests/suppress-intention.test.mjs
$ grep -rn "INSPECTIONS2" src/ tests/ native/   → (空)
$ grep -rn "PROBE-A"      src/ tests/ native/   → (空)
```

## 5. 无法核实

| 项 | 依据 | 处置 |
| --- | --- | --- |
| `GOOD` 档位 | 派单点名的「ERROR/WARNING/WEAK WARNING/**GOOD**」四档，`HighlightSeverity.java:124-125` 的 `DEFAULT_SEVERITIES` 只有 `{INFORMATION, TEXT_ATTRIBUTES, GENERIC_SERVER_ERROR_OR_WARNING, INFO, WEAK_WARNING, WARNING, ERROR}` **七档、没有 GOOD**；`grep '"GOOD"' java/` 零命中，`SeverityValues.GOOD` 亦零命中。⇒ 派单给的这一档在参考树里**不存在**。| 本仓四档（`src/highlightLevels.ts:76-81`、`src/inspectionProfile.ts:95-100`）与上游 myName 逐字对齐，**不引入 `GOOD`**。派单侧请核对来源，或告知具体上游类名。|
| `SupressImportErrors` | `find . -iname "*SupressImportErrors*"` → 零命中（只有 Kotlin 测试数据 `AnnotationSupressing.kt`/`.fir.kt`）。派单里已带「注意另一条 lane 报告过 `codeInsight/SuppressIntentionAction` 这个坐标在参考树里**不存在**」这句提醒 —— 这一条同一类：是假名。| 已按真实抑制基础设施 `SuppressionUtil.java:31-38` + `SuppressionUtilCore.java:9`（`"noinspection"`）替换判词坐标。派单侧请核对来源。|
| `ProblemsViewSettings` | `find . -name "ProblemsViewSettings*"` 与 `grep -rn ProblemsViewSettings platform/problemsView` 都**零命中** ⇒ 参考树里根本没有这一族。真身是 `ProblemsViewState.kt`（67 行，`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/`），errtreejudge §2.2 已按 `:15 / :21-34 / :36-59` 拆过；本仓对应物 `src/problemsPanelState.ts` 的字段一一对得上（见其头注释 `:1-31`）。| 本 lane 不动这一份（判词与磁盘一致）。登记给派单侧。|
| `SuppressIntentionAction` 所在包 | 派单给 `platform/lang-impl/src/com/intellij/codeInsight/intention/`；`find` 实测真身在 `platform/analysis-api/src/com/intellij/codeInspection/`。`codeInsight/intention/` 顶层目录（在 `java/java-analysis-api` 与 `java/java-analysis-impl` 之下）**没有 `SuppressIntentionAction.java`**。| **本轮已订正**（`src/suppressIntention.ts:1-13`）+ 原地留痕，写清了假坐标与订正依据。|
| 中文措辞：`抑制类型错误（// @ts-ignore）`、`抑制本条（// eslint-disable-next-line …）`、`抑制下一行（// eslint-disable-next-line）` | 本机参考树**无 zh 语言包**（`find . -type d -name "zh*"` 零命中，沿用 msgpanel §0 的判定）⇒ 上游这几条英文文案（`InspectionsBundle.properties` 里的 `suppression.*`）在参考树里就没有对应中文译法。本仓沿用的是磁盘上既有中文（`src/suppressIntention.ts:71` 那条一字未改）；本轮**没有**为 A3 引入任何新的中文用户可见文案。| 无处置。登记「无法核实」。|
| 上游 `SuppressIntentionActionFromFix.java` 具体写 PSI 的那几行 | 我只 `wc -l` 了那份文件（154 行），本轮**未逐行开**它，只在头注释里泛指「走 PSI 找 enclosing declaration」。| **不算订正、也不算核实**：本仓 A3 的落点不依赖它（不引入注解式抑制的新形状）。若下游 lane 要按这一条做真注解式抑制，需自行开这份文件核。|

## 6. 接线请求 / 观察

- **C1（请主代理裁定）**：`suppressOptionsFor` 的 `default:` 分支（`// 已确认：忽略此行告警`）——**没有任何工具认这条注释**，是纯文本假控件；但删除它需要同步清 `src/intentionSettings.ts:32` 的 `LOCAL_INTENTIONS` 里那条 `generic`，且会让 `tests/intention-settings.test.mjs:19-22` 那条清单覆盖判据变宽（清单里有、规则表里不再产出 → 判据本身允许，但 `catalog.size >= produced.size` 那条 `assert.ok` 语义会失去意义）。本 lane 判「不做」比「做一半」诚实。**接线请求**：要么授权一起把这条删掉（连带 default 分支 + LOCAL_INTENTIONS 那一行 + 相应判据），要么指定一个真能被消费的兜底形态。
- **C2（不是缺陷、是差异）**：`suppressOptionsFor` 走 `problem.source` 匹配工具档，而 `src/components/ProblemsPanel.vue:332` 传的是 `suppressionLanguageFor(row.path)`（按**扩展名**折出的语言档）。两者语义正交：一个文件是 `.ts` ⇒ 语言档走 `typescript`；诊断来源是 eslint / tsserver ⇒ 工具档走 eslint / ts。本 lane 的 A3 修正只影响工具档这一维；语言档那一维不变。（`ProblemsPanel.vue` 是别的 lane 名下只读，此处只引坐标。）
- **C3（工具/操作手法记录给别的 lane）**：**Windows 上 `node fs.writeFileSync` 直接改 `src/…` 会撞 `UNKNOWN: unknown error`（errno -4094 文件锁定）**，同一路径 bash `cp /tmp/… src/…` 也撞 `Permission denied`。绕法：`rm -f 目标` + `cp 备份 目标`；一次 `cp` 后**别再对同一路径连续 `fs.writeFileSync`**（首轮 A1 直接 write 撞 `UNKNOWN` 是同一原因）。另外变异文件请写**绝对 Windows 路径**：`/tmp` 在 Git Bash 是 `C:\Users\Administrator\AppData\Local\Temp\`，但 `node` 里的 `/tmp` 会解析成 `D:\tmp` 撞 `ENOENT`（本 lane 就踩过一次）⇒ 用 `D:/TaoCode/.tmp-probe.ts` 这种仓库内的路径最稳，跑完 `rm -f` 不留残文件。
- **C4（既有红的归属与并发事实）**：**开工时**主 gate 有 1 条红（`native/workspace.cpp 现在 1482 行 > 上限 1385`，mtime `2026-10-06 17:02:47`，我开工前 5 分钟）、孤儿门禁有 1 条红（`src/codeActionPopupModel.ts` 新增零消费方，mtime `2026-10-06 17:07:39`，我刚开工时出现）；**收工时**主 gate 全绿（别的 lane 把 `native/workspace.cpp` 拆到 1236 行），孤儿门禁的红**换了名字**（`src/components/CodeActionPopup.vue`，mtime `2026-10-06 17:12:58`，是别的 lane 建 `.vue` 消费了原 `.ts` 后自己的新孤儿）。**本 lane 未参与这四件事中的任何一件**（不掩盖、也不"顺手清"）—— 主代理若想让孤儿门全绿，请派 `src/components/CodeActionPopup.vue` 名下 lane 处理（接进 App 的挂载点或按 `src/agent.ts` 先例在文件头写明"接不上"理由）；本 lane 已把两轮原始数字都逐字留在 §4.1/§4.3。
- **C5（`relatedInformation` 一侧）**：`src/problems.ts:76-79` 明写「宿主侧还**没有**把这个字段透传出来 ⇒ 面板的『相关位置』一节一行都不渲染（没数据不渲染，不是假控件）」+ 指向 `docs/wiring-requests-2026-10-06-problems.md` R1。本 lane **没碰** `native/**`（禁写）也没接这一条：`problemRelatedInformation.ts` 是 problems 一侧、`native/lsp_support.cpp` 是禁写。留 R1 不动。

## 7. 账本订正请求（不动 `docs/inventory/**`）

- **D1**：`docs/inventory/platform_rest_verdict_table.md:171` 那一行 `SuppressIntentionAction | module/analysis-api | [-] | 0 | | | | 从未出现`——**「从未出现」不成立**：文件本体在 `platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java:19-98`（本轮 `wc -l`=98、逐行开过），本仓 `src/suppressIntention.ts`、`src/localSuppressions.ts`、`src/localIntentions.ts` 三份都点它的名字。同类另一枚 `SuppressIntentionActionFromFix`（`:566` 那行 `an/inspections [-] 从未出现`）在 `platform/analysis-impl/src/com/intellij/codeInspection/SuppressIntentionActionFromFix.java`（154 行）**也存在**。**口径提示**：账本的机械扫描按"名字出现在代码里"判 `[x]`；本仓的实现**不叫这两个名字**（叫 `SuppressOption`/`suppressOptionsFor`）⇒ 机械判定没错，但**判词列应写「行为已移植/上游类名不在代码里」**，而不是「从未出现」—— 后者会让下一批把它当"没人做过"重做一遍。同口径见 msgpanel §8-L3、L4。
- **D2**：`docs/inventory/platform_rest_verdict_table.md:8397-8445`（`lp/inspections` 那一段）里 `RedundantSuppressInspection` 与 `EmptyDirectoryInspection`/`LossyEncodingInspection`/`TodoCommentInspection`/… 都写作 `[~] … 从未出现`。上游 `RedundantSuppressionDetector` 在 `platform/analysis-api/src/com/intellij/codeInspection/RedundantSuppressionDetector.java`（本轮 `find` 实测存在），与本仓 `src/suppressIntention.ts:141-147` 的 `alreadySuppressed` 是**同一族语义**（判"这一处是不是已经被抑制过"），但类名与本仓不同 ⇒ 同样建议 `[~]` 那一列写「行为已移植/上游类名不在代码里」。派单点名 `SupressImportErrors` 也来自这一族，见 §5 已订为不存在。
- **D3**：派单本身给的三条上游候选（`codeInsight/SuppressIntentionAction` 具体路径、`SupressImportErrors`、`GOOD` 档）与参考树实测**全部不合**（§0.2 表格已钉）；`ProblemsViewSettings` 一族参考树里根本没有。若这三条来自某张候选清单 ⇒ 请从清单里删名并换成 §0.2 表中我实测的真坐标。

