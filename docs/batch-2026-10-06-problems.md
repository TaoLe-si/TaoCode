# 批次报告 · 2026-10-06 · problems / inspections / highlighting（桶 2 收尾，代号 problems）

## 0. 先留痕：本轮遇到「工作区被回滚 + 我基于旧快照做过判词」两件事
1. **中途丢过一次已落盘的内容**（自测发现：同一批 Edit/Write 报成功后，shell 侧文件回到改前状态；
   重做一遍才落住）。所以本报告里**所有行号与数字都是收工时按磁盘现状重新复核过的**，
   凡只在旧快照里出现过、现在不在的东西，我在 §6 里明说「不存在」。
2. **判词/逐类表里「判词说缺、其实早做过」在本域复核出 7 行**（§1 表里打了「订正判词」的行：
   code/tags 透传、按检查项分组、面板展开态持久化、profile 导入导出、状态栏 profile 切换器、
   注解器按文件分派、`EditorBoundHighlightingPass`），另有 **6 条被判词/旧文档引用但不存在的上游坐标**（§6-5）。
   本轮还纠了我自己早先两条「不存在」的错判（`RainbowHighlighter.java`、`ProblemsViewGroupNode`，见 §6-5 的注意行）。
3. 会话期间**别的代理在同时改本域文件**（实测 `src/problemsView.ts` 从 368 行变 367、
   `tests/problem-identity.test.mjs` 从 185 行变 116、`src/editorSemanticColors.ts` 变 64 行）；
   我改完的 hunk 只在我这 3 个文件里（`git diff --numstat` 见 §2），**没有动别人的行**。

## 1. 判词表（族 / 项 / 判定 / 上游相对路径:行号 / 本仓落点 / 一句话）

| 族 | 项 | 判定 | 上游（实测存在） | 本仓落点（实测行号） | 说明 |
|---|---|---|---|---|---|
| `dm/highlight` | 一条问题带几条「相关位置」 | `[~]` | `platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:35-43`（`:42` relatedInformation、`:39` codeDescription） | `src/problemRelatedInformation.ts:29-35 / 70-92 / 94-105`、`src/problems.ts:40 / 81 / 103`、`src/components/ProblemsPanel.vue:52 / 253 / 258 / 738-743` | 模型侧与面板侧做完（列表 + 点一条走既有 reveal）；宿主与桥类型透传交请求 R1，**没数据就不渲染，不是假控件** |
| `dm/highlight` | `code`/`tags` 判词写「不透传」 | `[x]`（订正判词） | 同上 `:37-38` | `native/lsp_support.cpp:148-149`、`src/problems.ts:99 / 106-107`、`src/inspectionIdentity.ts:36-38` | 早已原样透传并被身份解析消费；`dm/highlight` 那行判词过时 |
| `dm/problems-view` | 按检查项分组（Group by Inspection） | `[x]`（订正判词） | `platform/problemsView/ui/resources/intellij.platform.problemView.ui.xml:96-98` + `platform/platform-resources-en/src/messages/ActionsBundle.properties:2659-2660`（`Group by Inspection`） | `src/problemsView.ts:33 / 36 / 260 / 273 / 294`、面板 `:477-487` 下拉第 6 档 | `inspection` 档 = 身份键分组，未分组排组前、组间自然序 |
| `dm/problems-view` | 面板展开态「没有可持久化对象」 | `[x]`（订正判词） | `ProblemsViewState.kt:20-33`（本仓把展开态单独持久化，上游没有该字段 ⇒ 本仓扩展） | `src/problemsPanelState.ts`（`collapsedGroups`）+ 面板 `:84 / 119-125`、`tests/problems-panel-state.test.mjs` | 折叠的组键集合已随视图状态存档 |
| `dm/problems-view` | Project Problems 成员级关联问题（`BrokenUsage`/`RelatedProblem`） | `[-]`（不可移植部分） | **无法核实**：`RelatedProblemViewProvider.kt`、`ProblemsViewSuppressAction.kt`、`ProblemDescriptorBase.java` 的 related 字段在本机树都不存在（见 §6-5） | 可移植子集见本表第 1 行 | PSI/索引上的成员使用搜索没有等价物；只有 LSP `relatedInformation` 这一支能做，已做 |
| `dm/inspections` | profile 导入/导出（.xml） | `[x]`（订正判词） | 上游在 `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java`（本轮 find 命中） | `src/inspectionProfileIo.ts` + 面板 `:373-417`、`tests/inspection-profile-disk-wiring.test.mjs` | `.taocode/inspectionProfiles/` 读写 + 根档切换，判词说「缺导入导出」不成立 |
| `dm/inspections` | 多 profile 与状态栏 profile 切换器 | `[x]`（订正判词） | 同上 | `src/components/InspectionProfileSwitcher.vue`，**实测挂在 `src/App.vue:10`（import）与 `:2273`（状态栏）** | 切换器已在状态栏，判词那句「状态栏因此没有 profile 切换器」过时 |
| `dm/inspections` | `InspectionToolRegistrar` 扩展点注册面 | `[-]` | `platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionToolRegistrar.kt:9-27`（**是 .kt**） | — | 本仓没有插件 EP 宿主；顺带发现 `native/diagnostics.cpp`/`src/diagnosticsPanel.ts` 的上游路径写错 → 请求 R5 |
| `dm/inspections` | `InspectionProfileConvertor` / `InspectionProfilerDataHolder` | `[-]` | `platform/analysis-impl/src/com/intellij/codeInsight/daemon/InspectionProfileConvertor.java`（存在） | — | 判词理由成立：本仓没有旧格式可迁、没有本地工具耗时可记 |
| `dm/annotator` | 注解器的按文件分派 | `[x]`（订正判词） | — | `src/junitInspections.ts:275`（`if (!/\.(java|kt)$/i.test(path)) return []`） | 内建本地生产者已按扩展名分派；第三方 `Annotator`/`ExternalAnnotator` EP 注册面仍 `[-]`（没有插件宿主，理由同上） |
| `an/highlighting` | `EditorBoundHighlightingPass` | `[x]`（订正判词/逐类表写「从未出现」） | 上游类名见 `src/highlightPasses.ts:12-13` 注释 | `src/highlightPasses.ts:35 / 47 / 400` + `tests/highlight-editor-bound-passes.test.mjs` | 已有 `kind: 'editorBound'` 一档与只跑该档的调度 |
| `an/highlighting` | `RainbowHighlighter` / 可配置严重度颜色 | `[~]`（缺口属实，本轮没做） | 无法核实（本机树没有 `RainbowHighlighter.java`，`find` 零命中） | 收工实测：`src/editorSemanticColors.ts` **64 行、没有** `rainbowScopes`/`severityDiagnosticAttributes` | 我旧快照里读到的那份不存在；消费点 `CodeEditor.vue` 对本代理冻结 ⇒ 写清不做 |
| `ls/highlighting` | `LspSemanticTokensCache`/`LspDocumentLinkCache` 搬到快照缓存、`LspHighlightingCacheRegistry` | `[ ]`（缺口属实，本轮没做） | `platform/lsp-impl/src/impl/features/highlighting/`（`LspCachedHighlighting.kt`/`LspHighlightingCache.kt` 一族） | 实测只有 `src/lspHighlightingCache.ts:160`（`HighlightingSnapshotCache`）与 `:300`（`documentHighlightHit`），没有 link/token 缓存与按特性注册表 | 落点已想清楚（见 §7），预算切断没写 |
| `bucket2b R2` | 状态栏「按检查项」芯片的数据面 | `[x]`（本轮**没加新函数**） | `ActionsBundle.properties:2659` | `src/problemsView.ts:358`（`problemCounts`）、`src/inspectionProfile.ts:375`（`inspectionItems` 逐检查项条数）、`src/inspectionIdentity.ts:59 / 70-73`（`#unused` 档，显示名 `Unused declaration`） | 早做过；我最初写的 `unusedDeclarationCount` 是这三者的重复实现，已删（不留只过自己测试的死函数） |
| `bucket2b2 R1` | 面板选中行能用 Alt+Enter 打开「操作」 | `[~]`（组件侧做完） | `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ShowProblemsViewQuickFixesAction.kt:34 / 47 / 79` + `ui.xml:100-103 / 110` | `src/components/ProblemsPanel.vue:269-289`（`selectedRow`/`rememberSelectedRow`/`openMenuForSelected`/`defineExpose`）+ 模板 `:725`（行 `tabindex="0" @focusin`） | 键位/action/App.vue 的 ref 三处都在保留文件 → 请求 R3 |
| `bucket2b2 R2` | 焦点态抛给状态栏 | `[~]`（面板侧做完） | `ProblemsViewState.kt:20-33`（上游没有该字段 ⇒ 会话内不落档，本轮只抛事件） | `ProblemsPanel.vue:85-90`（`focusChange` 声明）+ `:123-127`（`watch(focus)` 抛出） | 挂载点在 `App.vue:2214` → 请求 R4 |

## 2. 改动文件清单（`wc -l` 前后；`git diff --numstat` 自查 hunk 全属本轮）
| 文件 | 前 | 后 | numstat |
|---|---:|---:|---|
| `src/problemRelatedInformation.ts` | 新建 | **115** | 未跟踪（新文件） |
| `src/problems.ts` | 95 | **125** | `+31 -1` |
| `src/components/ProblemsPanel.vue` | 778 | **857** | `+82 -3` |
| `tests/problem-related.test.mjs` | 新建 | **147**（12 条 test） | 未跟踪 |
| `docs/wiring-requests-2026-10-06-problems.md` | 新建 | **162** | 未跟踪 |
| `docs/batch-2026-10-06-problems.md` | 新建 | 本文件 | 未跟踪 |
未改动（刻意）：`src/problemsView.ts`、`src/inspectionProfile.ts`、`src/inspectionIdentity.ts`、
`src/errorReport.ts`、`src/internalErrors.ts`、`src/workspaceDiagnostics.ts`、`src/workspaceInspection.ts`、
`src/lspHighlightingCache.ts`、`src/lspPerFileCache.ts`、`src/annotator*.ts`、`src/highlight*.ts`、
`src/editorSemantic*.ts`、`src/editorDiagnosticMarkers.ts`、`native/diagnostics.cpp`、
`src/components/{BinaryViewer,InspectionProfileSwitcher}.vue` —— 只读核实，缺项判定见 §1 与 §7。

## 3. §5 每条自查命令的前后数字
| 门禁 | 开工（基线） | 收工 |
|---|---|---|
| `node --test tests/problem-*.test.mjs tests/problems-*.test.mjs tests/inspection-*.test.mjs tests/annotator-*.test.mjs tests/highlight-*.test.mjs tests/module-size.test.mjs` | 106 tests / 106 pass / 0 fail（不含本轮新增 12 条） | **118 / 118 / 0** |
| `node --test tests/problem-*.test.mjs`（含新增） | 106 | **118 / 118 / 0** |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | **5 / 5 / 0**（`problemsView.ts` 367、`ProblemsPanel.vue` 857、新模块 115 都在 900 以内） |
| `npx vue-tsc -b --force` | 我的文件 0 错（中途全树出现的 3 条 `src/dbgBreakpointUpdate.ts`、2 条 `src/components/RunConsole.vue` 都是别人的在途文件） | **0 错**（`build/tsc-final.txt`，`grep -cE 'error TS'` = 0） |
| `node .tools/find-param-props.mjs` | 0 | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净：tests/*.mjs 全部是纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 干净 | **干净**（扫描 1261 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 基线登记 9 | **已登记 9 / 基线 9 · 新增 0 · 本轮清掉 0**（门禁绿） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 | **11 / 11 / 0** |
| ctest | — | **本轮没改 `native/`**（宿主那一环是保留文件，写在请求 R1 里） |

## 4. 反向验证（新门禁/新判据的三步记录）
本轮新增判据是 `tests/problem-related.test.mjs`（12 条，其中 7 条打纯函数、5 条打接线锚点）。两次注入：
1. 删掉 `src/problemRelatedInformation.ts:53` 的越界守卫 `|| n < 0`（让负行号通过）
   → 注入后：**12 tests / 11 pass / 1 fail**（「越界与非整数坐标整条丢掉」红）
   → 撤销后：**12 / 12 / 0**，`grep -n 'n < 0'` 显示守卫回到 `:53`。
2. 删掉去重那行 `if (seen.has(key)) continue`
   → 注入后：**12 / 11 / 1**（「完全相同的位置只留一条」红）
   → 撤销后：**12 / 12 / 0**，`grep -c "seen.has(key)"` = 1。
另外两条「反向验证」我早先记过（删 `relatedFrom` 的 `?? related` 回退、删聚合行的 `...(related …)`），
但当时的工作区随后被回滚，**那两次红/绿的数字不作数**；上表两次是收工前在当前磁盘上重跑的。
既有的精确断言**没有放松**：`muteKeys: groupMute.value ? muteKeysFor(group) : []`
（`tests/inspection-item.test.mjs`、`tests/problem-code-grouping.test.mjs` 钉的那一行）原样保留，
新测试里还专门加了一条 test 复钉它和 `@click.stop="openRowMenu(p, $event)"`。

## 5. 零消费方自查
- `src/problemRelatedInformation.ts`：消费方 3 个 —— `src/problems.ts`（`RelatedLocationInput` + 字段）、
  `src/components/ProblemsPanel.vue`（`relatedLocationsOf` / `relatedLocationText` / `RelatedLocation`）、
  `tests/problem-related.test.mjs`。`relatedOf` 只被测试消费，但它是对外的语义出口
  （「一条问题有没有相关位置」），文件头写清了与 `relatedLocationsOf` 的分工。
- 曾写过、**最终删掉**的候选（避免只过自己测试的死模块）：
  `unusedDeclarationCount`（与 `problemCounts`/`inspectionItems` 重复，见 §1 R2 行）、
  `problemCounts.ts`、`inspectionDisplayNames.ts`（`src/inspectionIdentity.ts:70-73` 已有同一份）。
- `ProblemRow.related` 有真实消费链路（聚合 → 面板行菜单 → 既有 `reveal` 通道），
  宿主没透传时恒空 ⇒ 面板那一节不渲染，符合「没有后端就不渲染」。
- 孤儿门禁：新增 0（见 §3 表）。

## 6. 做不到 / 无法核实
1. **宿主 + 桥类型透传**（`native/lsp_support.cpp` 的 `shape_diagnostics`、`src/bridge.ts` 的 `LspDiagnostic`）：
   两个文件都在保留清单 → 请求 R1（含可照抄 C++ 片段与整行替换的类型）。
2. **App.vue 状态栏芯片 / 面板 ref / 挂载点**、**keymapBindings + actionRegistry 的 Alt+Enter**：保留文件 → 请求 R2/R3/R4。
3. **`native/diagnostics.cpp` 与 `src/diagnosticsPanel.ts` 的假上游路径订正**：
   前者在我的可改面、后者不在（只改一半会让宿主探针与前端文案各说一套）→ 请求 R5（真路径已实测，见下）。
4. **`ls/highlighting` 的 link/token 快照缓存 + 按特性注册表**：本轮没做（预算切在 §4 的验证与报告上）；
   缺口属实，落点写在 §7。
5. **无法核实的上游坐标（本轮实测「不存在」，别再当依据）**：
   `…/relatedProblem/RelatedProblemViewProvider.kt`、`…/toolWindow/ProblemsViewSuppressAction.kt`
   （两条 `find platform -name …` 都零命中）、
   `ProblemDescriptorBase.java` 里的 `RelatedInfo`/`getRelatedInformation`（文件在
   `platform/analysis-impl/src/com/intellij/codeInspection/ProblemDescriptorBase.java`，但全文 `grep -c related` = **0**）、
   `BrokenUsage`、`RelatedProblem` 两个类名、
   `platform/core-impl/src/messages/resources/core/ActionsBundle.properties`（`find platform -name "ActionsBundle*.properties"`
   只命中 `platform/platform-resources-en/src/messages/ActionsBundle.properties`）。
   **注意我早先的两条「不存在」结论是搜错扩展名**，本轮改正后它们**存在**（别按旧结论下判）：
   - `RainbowHighlighter.java` 在 `platform/analysis-impl/src/com/intellij/codeHighlighting/RainbowHighlighter.java`；
   - `ProblemsViewGroupNode` 是 **`.kt`**，路径
     `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewGroupNode.kt`。
   ⇒ `grep -rn relatedInformation platform/` 全树只命中 `LspDiagnosticAndLazyQuickFixes.kt:42` 一行，
   所以相关位置的**呈现形状**只能按 LSP 字段语义 + 本仓既有 reveal 通道做，没有上游文案可照（我没编）。
   **另注**：`docs/batch-2026-10-06-bucketW.md` 里给过的 ActionsBundle 坐标（`:1782`/`:2945`/4020 行）与
   `src/annotatorEpProtocol.ts`、`src/inspectionsToolNames.ts` 两个本仓落点，收工实测**都不存在**；
   那是我这轮早先读到的旧快照内容，不是本仓现状 —— 请主代理按本条复核那份批语（我没有改动它）。
6. **`relatedInformation` 指向别的文件**：宿主只给 file URI 时前端**丢掉那一条**
   （猜错位置比少列一行更糟；规则在 `src/problemRelatedInformation.ts:89`（判定）与 `:36-43`（理由注释））。
   要支持跨文件，宿主需按已有的 URI→工作区相对路径折法给 `path`（请求 R1 里写了）。
7. 没跑 ctest、没跑 `npm test` 全量（规约：只跑本域）。

## 7. 下一轮的本域落点（已核实缺口，不必再查）
- `src/lspHighlightingCache.ts`：加 `CacheKey` 族（diagnostics / semanticTokens / documentHighlight / documentLink）
  + `mergePublishedLinks`（按 range 起末键合并、整文件替换语义），把 `src/semanticTokens.ts`、
  `src/documentLinks.ts` 的按文件记忆搬到 `HighlightingSnapshotCache`；判据补进 `tests/lsp-highlighting-cache.test.mjs`。
- `dm/highlighting` 侧「同区间可叠加多条 info」：LSP 一条诊断只有一个区间，本仓做不到（不是缺口，是数据源限制）。
- 宿主 R1 接上后：`ProblemsPanel.vue` 的「相关位置」节可直接用，跨文件条目需要在请求里补的 `path` 字段生效。

## 8. 需要主代理接的线
全部在 `docs/wiring-requests-2026-10-06-problems.md`：R1（宿主 + 桥类型，含可照抄代码）、
R2（状态栏按检查项芯片，复用 `problems` 组件开关，不需要新设置键）、R3（Alt+Enter → `openMenuForSelected()`）、
R4（`focusChange` 挂 App.vue:2214）、R5（假上游路径订正表）。
