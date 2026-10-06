# 批次报告 · 2026-10-06 · problems / inspections / highlighting 第二轮（代号 problems2）

派单两件事：**R5**（`native/diagnostics.cpp` ↔ `src/diagnosticsPanel.ts` 的假上游路径订正）与
**仍属实的 `ls/highlighting` 缓存/按特性注册表缺项**。R1 的宿主在 `native/lsp_support.cpp`（lsp lane 在途）⇒ 没碰。
面板的精确断言（`muteKeys: groupMute.value ? muteKeysFor(group) : []` 那一族）**一个字没动**（证据见 §5）。

## 0. 先留痕：R5 的「影响面」是编的（它给的**新路径**倒是真的）

规约 §1 说「主代理给你的坐标都可能是编的，动手前自己打开文件核实」。本轮逐条核实结果：

| R5 的说法 | 实测（本轮命令与输出） | 结论 |
|---|---|---|
| `src/diagnosticsPanel.ts` 里有 `inspectionToolRegistrarProbe()` 等同名条目 | `ls src/diagnosticsPanel.ts` ⇒ `No such file or directory`；`ls src/ \| grep -i diag` 只有 `workspaceDiagnostics.ts` | **不存在这个文件** |
| `native/diagnostics.cpp:410-470` 那四条探针 | `wc -l native/diagnostics.cpp` = **254 行**（没有 410 行）；`grep -c "codeInspection\|InspectionToolRegistrar\|HighlightInfoFilter\|GlobalInspectionContext\|InspectionProfileConvertor" native/diagnostics.cpp` = **0**（`.hpp` 同为 0）。该文件全文是 `idea.log` 等价物：`log_dir` / `rotate_if_needed` / `internal_errors` / `special_paths` / `troubleshooting` / `app_info` | **探针不存在** |
| 「这两文件会把注册面/转换器/过滤器报成上游没有本地 inspection 引擎」 | 全仓 `grep -rn "codeInspection/impl" src/ native/ tests/` ⇒ **0 命中**（只在 `build/` 取证产物与 R5 文档自己的文字里出现） | **无对象可改** |
| R5 表里 6 条「实测存在的位置」 | 逐条 `test -f` 全部 `OK`；`InspectionToolRegistrar.kt` 237 行（`:36` 是 `class InspectionToolRegistrar(...)`）、`HighlightInfoFilter.java` 25 行 | **表本身是真的**，只是本仓没有引用它们的地方 |

⇒ R5 的**代码改动量 = 0**（不是"做不到"，是"没有那个东西"）。我做的三件替代动作：
① 在 `docs/wiring-requests-2026-10-06-problems.md` 的 R5 末尾**留痕订正**（该文件 162 → **181 行**）：
原写"两处探针要改"、实际"两个对象都不存在"，并给了上面三条实测命令与输出，请主代理把 R5 从待办里撤掉；
② 表里 6 条路径本轮亲自复核为真（含 `.java` / `.kt` 之分与行数），不再转抄；
③ 把 R5 背后那条**真**缺口（「本仓没有本地检查引擎宿主」）继续挂在 §7-3，并顺手把这一轮真正能落地的
"按特性缓存注册表"接上了（§1 第 1 行与第 4 行）。

## 1. 判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游（本轮实测存在） | 本仓落点（实测行号） | 说明 |
|---|---|---|---|---|---|
| `ls/highlighting` | `LspHighlightingCacheRegistry` 注册的**两份诊断缓存**（push 与 pull）+ 读时合并 | `[x]` | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:26-27`（并列注册）、`:64-80`（push 在前 + 拼接，`:79` 就是那句 `pushed + pulled`）、`:92`（pull 里与 push 重复的那条丢掉）；`platform/lsp-impl/src/impl/features/highlighting/LspPublishDiagnosticsCache.kt:31`（`supportsPull = false`） | `src/workspaceDiagnostics.ts:116`（`diagnosticIdentityKey`）、`:127-135`（`mergeDiagnosticSources`）、`:168-231`（`DiagnosticSourceCaches`）、`src/workspaceInspection.ts:86-112` | 上游面板读的是两份缓存的**并集**；本仓整工程报告此前把共享槽整体 `set` 掉 ⇒ 跑一次「检查代码」会抹掉编辑器里 push 来的波浪线。现在 pull 单独记、写回的是并集，push 侧一行不丢 |
| `ls/highlighting` | `Unchanged` 报告与共享槽互相覆盖 | `[x]` | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:31`（"Staleness is per document"）、`LspHighlightingCacheRegistry.kt:46-48`（`clearCache` 清全部） | `src/workspaceDiagnostics.ts:183-193`（`remergePull`）、`src/workspaceInspection.ts:100-104` | 服务端 push 覆盖过共享槽之后，`unchanged` 的文件按记着的那份 pull 结果**重新并一次**（不重算请求）—— 否则那几条会在下一次推送后永久消失 |
| `ls/highlighting` | 上一轮拉来、这一轮服务端不再报的那条**不该变成永久幽灵行** | `[x]` | `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCache.kt:234`（Full 响应整份替换该文档快照） | `src/workspaceDiagnostics.ts:213-220`（`dropPull`）、`src/workspaceInspection.ts:106-112` | 报告里完全没提到的文件：pull 那一份作废、只减掉我们上次塞进去的那几条；从没拉过的文件返回 `null` ⇒ 不动它（`tests/workspace-diagnostics.test.mjs:82` 那条既有断言原样成立） |
| `ls/highlighting` | **按特性注册表缺项**：诊断这一族的缓存没参与"整批作废" | `[x]`（本轮补上） | `platform/lsp-impl/src/impl/LspClientImpl.kt:398`（`highlightingCacheRegistry.clearCache()`）、`LspHighlightingCacheRegistry.kt:46-48` | `src/workspaceDiagnostics.ts:168`（`implements LspCache`）+ `:172-176`（构造时 `registerLspCache(this)`） | 本仓的注册表在 `src/lspPerFileCache.ts:39-55`（`registerLspCache` / `clearAllLspCaches` / `lspCacheCount`），两个生产触发点都已存在：`src/lsSessionHost.ts:163`（重启语言服务）与 `src/lspProgress.ts:181-187`（服务器 `workspace/…/refresh`）。诊断这两份缓存自登记后**跟着一起作废**，旧服务器的 pull 行不会留在面板里 |
| `ls/highlighting` | `LspSemanticTokensCache` / `LspDocumentLinkCache` 搬到 `HighlightingSnapshotCache` | `[ ]`（**不在我的面**） | `platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt`、`LspDocumentLinkCache.kt:17-35`；注册在 `LspHighlightingCacheRegistry.kt:28-29`；消费在 `LspClientImpl.kt:270` / `:285` | 实测：`src/lspHighlightingCache.ts:162` 只有通用容器 `HighlightingSnapshotCache`（`:174` 已自登记）；token 那份状态是 `src/components/CodeEditor.vue:306-307` 的两个 `let`（`semanticResultId` / `semanticData`），换文档靠 `:308` `resetSemanticTokens()` 清空 ⇒ **没有按文件的快照缓存** | `CodeEditor.vue` 在派单禁改清单、`src/lspHighlightingCache.ts` 与 `tests/lsp-highlighting-cache.test.mjs` 都不在本轮可改面 ⇒ 连可照抄代码写成请求 **W1** |
| `ls/highlighting` | 通用注册表剩下的 5 个特性（inlayHints / documentColor / foldingRange / codeLens / inheritanceMarkers） | `[-]`（**接不上就是死模块**） | `LspHighlightingCacheRegistry.kt:31-35`；fan-out 的唯一调用方 `LspClientImpl.kt:223`（`invalidateServerResults`）、`:235`（`refreshSemanticTokens`）、`:260`（`refreshDiagnostics`） | 本仓只有**整批**作废（`clearAllLspCaches`），没有**按单份缓存**作废的调度面；`src/codeLensCache.ts:48-51` 也明写该族"刷新类通知没出口 ⇒ 见接线请求 N2" | 上游是按特性逐个清（`semanticTokensCache.clearCache()` 等），本仓现在只有"一次清整族"。把这 5 个塞进注册表 = 没有调用方的摆设，按规约 §3 判不适用；差异已写进 W1 末尾 |
| `dm/inspections` | R5 声称的那四条探针文案 | `[-]` | 表里 6 条路径本轮 `test -f` 全部命中 | — | **不适用理由**：本仓没有那两个文件/那些函数（§0 三条实测）。我没有新建一个 `diagnosticsPanel.ts` 把探针写进去 —— 那是凭空造文案 |
| 面板 | `muteKeys` 一族精确断言 | `[x]`（未放松） | — | `src/components/ProblemsPanel.vue:197`（未改动）、`tests/inspection-item.test.mjs:123`、`tests/problem-code-grouping.test.mjs:157-158` | 本轮没有改面板一行（`git diff` 见 §2） |
| R1 | `relatedInformation` 宿主透传 | `[-]`（本轮刻意不做） | — | — | 派单：宿主在 `native/lsp_support.cpp`，lsp lane 在途 ⇒ 不碰；前端那一半仍在那儿等数据（§8 W3） |

## 2. 改动文件清单（`wc -l` 前后；`git diff --numstat` 自查 hunk 全属本轮）

| 文件 | 前 | 后 | numstat |
|---|---:|---:|---|
| `src/workspaceDiagnostics.ts` | 84 | **231** | `+147 -0` |
| `src/workspaceInspection.ts` | 93 | **132** | `+40 -1`（唯一一行删除 = 旧的 `for (const write of scoped.kept) deps.diagnostics.set(write.path, write.diagnostics)` 换成合并写入） |
| `tests/inspection-workspace-merge.test.mjs` | 新建 | **147**（12 条 test） | 未跟踪 |
| `docs/wiring-requests-2026-10-06-problems.md` | 162 | **181** | 只在 R5 末尾加「订正」块（§0 的三条实测），R1–R4 一行没动 |
| `docs/wiring-requests-2026-10-06-problems2.md` | 新建 | **169** | 请求 W1 / W2 / W3 |
| `docs/batch-2026-10-06-problems2.md` | 新建 | 本文件 | — |

**没有改**（只读核实）：`src/components/ProblemsPanel.vue`、`InspectionProfileSwitcher.vue`、`BinaryViewer.vue`、
`src/problems*.ts`、`src/inspection*.ts`（含 `inspectionProfile*.ts`）、`src/annotator*.ts`、`src/highlight*.ts`、
`src/editorSemantic*.ts`、`src/editorDiagnosticMarkers.ts`、`src/errorReport.ts`、`src/internalErrors.ts`、
`src/problemsView.ts`、`src/problemRelatedInformation.ts`、`native/diagnostics.cpp`（§0：无可改对象）、
以及不属于本轮可改面的 `src/lspHighlightingCache.ts`、`src/lspPerFileCache.ts`、`src/lspNavigation.ts`、
`src/lspProgress.ts`、`src/lsSessionHost.ts`、`src/semanticTokens.ts`、`src/documentLinks.ts`、
`src/editorSemanticField.ts`、`src/codeLensCache.ts`、`src/components/CodeEditor.vue`、`src/App.vue`。
`native/` 一行没动 ⇒ **本轮不需要 ctest**。

## 3. §5 每条自查命令的前后数字

| 门禁 | 开工（基线） | 收工（最终磁盘） |
|---|---|---|
| `node --test tests/problem-*.test.mjs tests/problems-*.test.mjs tests/inspection-*.test.mjs tests/annotator-*.test.mjs tests/highlight-*.test.mjs tests/workspace-diagnostics.test.mjs tests/lsp-highlighting-cache.test.mjs tests/lsp-per-file-cache.test.mjs tests/module-size.test.mjs` | **135 / 135 / 0** | **155 / 155 / 0**（= 135 + `workspace-diagnostics` 8 + 本轮新增 12） |
| 上面那一套再并上 `tests/lsp-progress.test.mjs`（注册表那条红线的邻居） | — | **169 / 169 / 0** |
| `node --test tests/inspection-workspace-merge.test.mjs tests/workspace-diagnostics.test.mjs` | — | **20 / 20 / 0** |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | **5 / 5 / 0**（上限未动、未登记豁免；`workspaceDiagnostics.ts` 231、`workspaceInspection.ts` 132，都远在 ts/vue 900 以内） |
| `npx vue-tsc -b --force` | **0 错**（基线那份输出） | **收工最后一次跑：0 错**。中途两次采样出现过 5 条 / 1 条，全在**别人的在途文件**：`src/App.vue(2019,43)`、`src/App.vue(2073,23)`、`src/bookmarkActions.ts(146,25)`、`src/toolWindowStripes.ts(694,29)`、`src/toolWindowStripes.ts(695,60)`、`src/enterHandlers.ts(96,10)`、`src/components/RunConsole.vue(176,46)` —— 随后各被自己 lane 收掉；`grep -c "workspaceDiagnostics\|workspaceInspection\|inspection-workspace"` 在每份输出里都是 **0** ⇒ 我这面全程 0 错 |
| `node .tools/find-param-props.mjs` | 0 处（中途别 lane 短暂 1 处：`src/testTree.ts:103`） | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净：tests/*.mjs 全部是纯 JavaScript**（新测试在扫描范围内） |
| `node .tools/find-missing-ext.mjs` | 干净（1261 个文件） | **干净**（扫描 1279 个文件；新测试与 `workspaceDiagnostics.ts` 的 `registerLspCache` 值 import 都写了 `.ts`） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 · 新增 0 ⇒ 绿 | **已登记 9 / 基线 9 · 新增 0 · 本轮清掉 0 ⇒ 绿**（中途那次红是别 lane 的 `src/structuralCodeBlock.ts`，随后被它自己接上消费方） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | **11 / 11 / 0** | **9 / 11 / 2 红**，红的是别人本轮新写文档里按文件名找不到的那两条上游引用（类名分别是 `SuppressIntentionAction.java` 与 `StructureViewFactoryImpl.java` 那两条，命中的文档有 `batch-2026-10-06-completion2.md`、`-refactor.md`、`-status2.md`、`-welcome2.md`、`-projecttree.md`、`wiring-requests-2026-10-06-completion.md`、`-toolwindow2.md`）。**规约 §5 提醒过：完整"路径:行号"形状会被这道门当真引用收走 —— 所以我这里只写类名、不写它们的完整路径与行号。** 我自己写的两份文档没有一条红（我引的每一条都先 `test -f` + 行号实测过） |
| ctest | — | 本轮没改 `native/`，未跑 |
| 全量 `npm test` | — | 按规约 §5 不跑（12 路并行，别人的在途红会算到我头上） |

## 4. 反向验证（注入违规 → 变红 → 撤掉 → 复绿；跑的是 `tests/inspection-workspace-merge.test.mjs` + `tests/workspace-diagnostics.test.mjs`）

| # | 注入了什么 | 红 | 撤后 |
|---|---|---|---|
| 1 | `mergeDiagnosticSources` 的 `:92` 去重条件删成 `return [...pushed, ...pulled]`（同一条诊断列两遍） | 19 条里 **2 红**：`与 push 逐字段相同的 pull 条目不再列第二遍`、`端到端：问题面板读的那张表里 push 与 pull 两份都在，且顺序是 push 在前`（该轮 19 = 11 新 + 8 既有） | **19 / 19 / 0** |
| 2 | `subtractByIdentity` 改成"什么都不减"（不记我们上次塞了哪几条 ⇒ 上一轮 pull 结果被当成 push 供着） | 19 条里 **2 红**：`本轮报告里完全没提到的文件：pull 那一份作废，push 的留下`、`端到端：下一轮报告里没有的那条不会变成永久幽灵行` | **19 / 19 / 0** |
| 3 | 在**最终代码**（12 条新判据 + 8 条既有 = 20）上把构造函数里的 `registerLspCache(this)` 注释掉 | `node --test tests/inspection-workspace-merge.test.mjs` ⇒ **12 / 11 / 1 红**，红的正是新那条 `构造时自登记进批量作废的注册表：refresh / 重启后 pull 那一份不再沿用` | **12 / 12 / 0**，随后并跑既有 8 条 ⇒ **20 / 20 / 0** |
| 附 | 写第一版时 `dropPull` 里先 `delete(this.contributed)` 再用它算"只剩 push"（= 减不到东西） | 同 2 的两条红 | 改成先取局部变量再删（`src/workspaceDiagnostics.ts:213-219`）⇒ 绿 |

`tests/workspace-diagnostics.test.mjs` 既有 8 条在三次注入里**始终绿** —— 包括
`assert.deepEqual(planWorkspaceReports(undefined), { writes: [], ids: [], unchanged: 0, ignored: 0 })`（整对象 deepEqual，
我给 `WorkspaceDiagnosticPlan` **加一个字段**就会红）与 `stale.ts` 那条"这一轮没提到的文件不动它"。
⇒ 我没有改它们的形状，也没有为了让新代码过去而放宽任何一条。

## 5. 面板精确断言未放松（派单点名的那条）

- `src/components/ProblemsPanel.vue:197` 仍是 `muteKeys: groupMute.value ? muteKeysFor(group) : [],`（本轮没动这个文件）；
- 钉它的两条既有断言原样：`tests/inspection-item.test.mjs:123`
  （`assert.match(panel, /muteKeys: groupMute\.value \? muteKeysFor\(group\) : \[\]/)`）与
  `tests/problem-code-grouping.test.mjs:157-158`（含 `v-if="group.muteKeys.length"`）—— 逐字符未动，都在 §3 的 155 条里跑绿；
- 新测试**没有**任何 `includes` 化比较：合并顺序、去重、身份键逐字段、`null` 与空数组的区别全部 `deepEqual` / 精确 `equal`。

## 6. 零消费方自查结论

- 本轮**没有新增模块文件**（不建只过自己测试的 `src/highlightingCacheRegistry.ts` 之类），
  孤儿门禁：已登记 9 / 基线 9 · 新增 0 ⇒ 绿。
- 新增公开出口 4 个，逐个给消费方：
  `mergeDiagnosticSources` ← `DiagnosticSourceCaches.applyPullReport`（同文件 `:201`）← `src/workspaceInspection.ts:96`
  ← `src/App.vue:1532` `runWorkspaceInspectionAction`（在跑的「检查代码」入口）；
  `diagnosticIdentityKey` ← 上面两个函数；`DiagnosticSourceCaches` ← `src/workspaceInspection.ts:42,53,86`；
  `LspCache` 的 `clearCache` ← `src/lspPerFileCache.ts:52-55` 的整批作废（两个生产触发点，见 §1 第 4 行）。- 写出来又**删掉**的候选（避免只过自己测试的死出口）：`resetWorkspaceDiagnosticSources()`。
  最初为了"重启语言服务时清干净"开了这个导出，后来实测本仓已经有
  `src/lspPerFileCache.ts:39-55` 的注册表 + `src/lsSessionHost.ts:163` / `src/lspProgress.ts:182` 两个触发点 ⇒
  改成构造时自登记，导出删掉 ⇒ **W2 从"要接的线"降级为"记录"（见 §8）**。
- `pushedOf` 保持 `private`（`:190`）：它是"读时合并"的内部一步，外部没有真实调用方就不开。
- `ProblemRow.related` 那一族（上一轮的）消费链未动，宿主没透传时恒空 ⇒ 面板那一节不渲染。

## 7. 做不到 / 无法核实（具体卡在哪一环）

1. **R5 的"改正"没有对象**：`src/diagnosticsPanel.ts` 不存在、`native/diagnostics.cpp` 254 行且不含那四个探针名
   （§0 三条实测）。我没有"顺手新建一个 diagnosticsPanel.ts 把探针写进去"—— 那会是凭空造控件/造文案。
2. **`LspSemanticTokensCache` / `LspDocumentLinkCache` 搬到快照缓存**：状态在
   `src/components/CodeEditor.vue:306-311`（禁改）、容器在 `src/lspHighlightingCache.ts`（不在本轮可改面）、
   判据文件 `tests/lsp-highlighting-cache.test.mjs`（也不在）⇒ 三重卡住，只能出请求 W1（含可照抄代码）。
   `src/documentLinksExtension.ts` 里 `grep -n "new Map"` **零命中**（它是自包含控制器，没有按文件 Map），
   所以 W1 对它只给目标与判据、不给行号 —— 不给假坐标。
3. **本仓没有"本地检查引擎宿主"**（R5 背后那条真缺口）：`InspectionToolRegistrar` 的 EP 注册面要插件描述符宿主，
   `InspectionProfileConvertor` 要旧 profile 格式，`HighlightInfoFilter` 要在宿主侧跑完整本地 inspection 之后才有意义 ——
   本仓的本地生产者只有 `src/junitInspections.ts` 与 `src/todoIndex*` 那一族。这一条不是我这轮能落的（要新宿主 + 新桥 kind）。
4. **`lsp4j Diagnostic.equals` 到底比哪几个字段：无法核实** —— lsp4j 是 jar 依赖，不在本机参考树。
   所以我没冒充它，`diagnosticIdentityKey` 用"宿主实际透传的字段全集"，并把这条理由写进函数头注释（`:109-115`）。
5. **合并的是"诊断行"而不是上游的"诊断 + 惰性 quick fix 对"**：`workspaceDiagnostics.ts:13-20` 的
   `WorkspaceDiagnosticReport` 形状里没有 `DiagnosticAndQuickFixes` 载荷（宿主没给），
   上游 `LspHighlightingCacheRegistry.kt:71-77` 那一步的 `getQuickFixes(...)` 本仓接不上 —— 与 R1 的宿主透传同源。
6. **按特性的粒度作废做不到**：本仓注册表只提供 `clearAllLspCaches()`（一次清整族），
   `LspClientImpl.kt:235-240` 那种"只清 semanticTokensCache"的粒度没有对应口（`src/lspPerFileCache.ts:37-38` 的注释已如实写明）。
7. 没改 `native/` ⇒ 未跑 ctest；按规约未跑 `npm test` 全量。

## 8. 需要主代理接的线

全部单放在 `docs/wiring-requests-2026-10-06-problems2.md`：
- **W1**：`src/lspHighlightingCache.ts` 加 `HighlightingCacheRegistry`（可照抄整段，含九个上游特性名）
  + `src/lspNavigation.ts` 用它替掉"只有一个诊断缓存" + `src/components/CodeEditor.vue:306-311` 把
  `semanticResultId` / `semanticData` 搬进按 path 分桶的 `HighlightingSnapshotCache`（判据四条也写在里面）；
- **W2**：**已在本轮自己闭环**（不需要动保留文件）—— 记录形式保留在请求里，写明为什么不用接 `App.vue`；
- **W3**：上一轮的 R1（`native/lsp_support.cpp` + `src/bridge.ts`）与 R2/R3/R4 仍然挂着，我没动。

另外提醒主代理（不是我的面）：`tests/source-citations.test.mjs` 现在被好几份**别人本轮新写的文档**钉红
—— 都是"按文件名在参考树里找不到"的那两类（类名见 §3 倒数第二行，我故意不写完整形状，免得自己也变成一条红）。
