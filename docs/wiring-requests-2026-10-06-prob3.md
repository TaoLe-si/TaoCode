# 接线请求（prob3 · 问题视图 / 检查 / 意图族，2026-10-06）

目标文件都是**保留文件**（`.tools/agent-rules.md` §2），所以这里只给可照抄的整段替换，不动现场。

---

## R1 · 状态栏的严重度计数改读 `problemCounts`（消掉一份就地重算）

- 目标文件：`src/App.vue`
- 目标行：2297（状态栏 `<button v-if="showWidget('problems')" class="status-problems" …>` 那一条，
  现文案是 `{{ allProblems.filter(p => p.severity === 1).length }} 错误` + `| ` + `{{ …severity === 2… }} 警告`）
- 现状问题：同一件事（哪些级别算"错误/警告/信息"）在本仓写了**两遍** —— 面板侧的纯函数
  `src/problemsView.ts:475` 的 `problemCounts`（级别归属取自 `src/highlightLevels.ts:46` 的 `levelForSeverity`）
  一直没有生产消费方（本轮之前只有 `tests/problems-view.test.mjs` 读它），而状态栏在模板里现算
  `filter(p => p.severity === 1)`。`severity === 1` 与 `levelForSeverity(severity).id === 'ERROR'`
  在 **severity 0 / 负数 / 非整数**上不是一条规则（级别函数把 `<= 1` 全归 ERROR），两把尺早晚会漂。
  本轮已在面板里给它接了一个消费方（`src/components/ProblemsPanel.vue:208` 的计数气泡），
  状态栏这一格是第二个、也是用户最常看的那一个。
- import 语句（加到 `src/App.vue` 第 90 行 `import { allProblems } from './problems'` 之后）：

  ```ts
  import { problemCounts } from './problemsView'
  ```

- 可照抄的整段替换（把上面那条按钮的两个 `filter(...)` 换成一份计数）：

  ```html
  <button v-if="showWidget('problems')" class="status-problems" :title="`错误 ${problemCounts(allProblems).errors} · 警告 ${problemCounts(allProblems).warnings} · 信息 ${problemCounts(allProblems).infos}（点击打开问题面板）`" aria-label="打开问题面板" @click="showOutput('problems')"><span class="sev-error">{{ problemCounts(allProblems).errors }} 错误</span><span class="status-separator">|</span><span class="sev-warning">{{ problemCounts(allProblems).warnings }} 警告</span></button>
  ```

  更省一次遍历的写法（与现有 `computed` 风格一致，建议用这个）：在 script 里加

  ```ts
  // 状态栏那一格的严重度计数：口径与问题面板、HTML 报告同一把（级别归属只在
  // src/highlightLevels.ts 的 levelForSeverity 一处定义，见 src/problemsView.ts 的 problemCounts）。
  const problemCountsNow = computed(() => problemCounts(allProblems.value))
  ```

  模板里把三处 `problemCounts(allProblems)` 换成 `problemCountsNow`。

- 上游依据：状态栏那一格是 IDEA 的 `TrafficLightRenderer`（
  `platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/TrafficLightRenderer.kt:383`
  用的正是 `severity.getCountMessage(count)` —— 计数与级别对象同源，不是在 UI 里再 `filter` 一遍）；
  「哪些级别折进哪一格」由级别对象自己说（
  `platform/analysis-api/src/com/intellij/lang/annotation/HighlightSeverity.java:176-180`）。
- 判据：`tests/problems-view.test.mjs` 末条已经钉住"`problemCounts` 必须有生产消费方"（面板侧）；
  接上这条后建议再加一条 `assert.match(app, /problemCounts\(/)`，本代理不动那个测试文件里的 App.vue 断言段
  （那条断言归主代理/门禁维护）。

---

## R2 · 判词表升级请求（`docs/inventory/verdict-daemon.md`，保留文件）

下面三行都**逐条打开本仓与参考树核对过**；「条目原文」是文件里现有的写法，「新档」是可照抄的替换段。
行号：`docs/inventory/verdict-daemon.md` 第 30 行（`dm/problems-view`）、第 31 行（`dm/highlight`）、
第 32 行… 实际位置请以 `grep -n "dm/highlight"` 为准（本代理没改这张表）。

### R2.1 `dm/highlight`：那条「`code`/`tags` 不透传」已经过时（本仓实测已透传）

- 条目原文（该行内）：`缺：…在 native/lsp_support.cpp:127-145 的 shape_diagnostics 就被裁成
  {line,character,message,severity,end*,source}，code/tags（Unnecessary/Deprecated）/relatedInformation 不透传，
  而 LspDiagnostic 类型在禁改文件 src/bridge.ts:109…`
- 实际现状：`native/lsp_support.cpp:148-149` 已经把 `code` 与 `tags` 带出来
  （注释里写的就是 `LspDiagnosticsCustomizer.kt:93-96` 那两档外观），
  桥类型在 `src/bridge.ts:118` 也已含 `code?: string | number; tags?: number[]`；
  消费链是 `src/problems.ts:99`（`applyInspectionProfile(..., item.code, item.tags)`）→
  `src/inspectionIdentity.ts:123-147` → 面板的「未使用 / 已废弃」芯片与按检查项分组。
  **只剩 `relatedInformation` 没透传**（那一环的请求在 `docs/wiring-requests-2026-10-06-problems.md` R1）。
- 新档（替换「缺：」那一段的开头到 `富信息留在语言服务侧` 之前）：
  `缺：LSP `Diagnostic.relatedInformation` 宿主仍未透传（`native/lsp_support.cpp` 的 `shape_diagnostics`
  只到 `code`/`tags`），面板的「相关位置」一节因此恒空（折叠规则与判据已在
  `src/problemRelatedInformation.ts:70-100`，接上后零改动生效）；`code`/`tags` **本轮核对为已透传**
  （`native/lsp_support.cpp:148-149` + `src/bridge.ts:118`，原写「不透传」是旧判词，实际已落）`
- 一句话说明：这条不是升档而是**订正**（`.tools/agent-rules.md` §1 要求留痕：原写 X、实际 Y）。

### R2.2 `dm/problems-view`：分组维度与三个排序开关都齐了

- 条目原文（该行内）：`本仓：…严重度过滤/文本过滤/按文件·目录·**来源（检查器）**分组/…`
  与 `缺：…问题树的展开态没有可持久化对象（本仓是扁平列表，只持久化三格取向）…`
- 新档（把这两段替换成）：
  `本仓：严重度多选过滤 / 文本过滤 / 按文件·目录·来源（检查器）·诊断码·检查项·**严重级**六种分组
  （档清单 `src/problemsView.ts:61`，`severity` 档承接上游「Group by Severity」
  `platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:37,70-93` +
  级别组节点 `platform/lang-impl/src/com/intellij/codeInspection/ui/InspectionTree.java:452-479` +
  组名 `.../InspectionSeverityGroupNode.java:37-39` + 组序 `.../InspectionResultsViewComparator.java:34-38`）/
  **三个**排序开关（上游 `ProblemsViewPanel.java:523-529` 递给比较器的那三格：
  `sortFoldersFirst`（`ProblemsViewState.kt:29` 默认 true）+ `sortBySeverity` + `sortByName`，
  `src/problemsView.ts:194-199`）/ 组头逐级计数（上游树节点尾巴
  `.../InspectionTreeTailRenderer.java:34-67` + `.../InspectionTreeNode.java:81-99`，
  本仓 `src/problemsView.ts:522-591`）/ 逐文件忽略 / 批量修复 / 导出 HTML 报告与文本 / 逐行「操作 ▾」菜单。
  面板展开态**已经**持久化（`collapsedGroups` 在 `src/problemsPanelState.ts:37,56-58,79`，跨会话读回）。`
- 落点：`src/problemsView.ts`、`src/problemsPanelState.ts`、`src/components/ProblemsPanel.vue`；
  判据 `tests/problems-view.test.mjs`（本轮 +8 条）、`tests/problems-panel-state.test.mjs`（+1 条旧档补默认）。

### R2.3 `dm/inspections`：profile 的 `.xml` 导入导出与状态栏切换器都在场了

- 条目原文（该行末尾）：`缺：profile 的导入/导出（`.xml`/`.ipr`）、按工程的多 profile 与状态栏 profile 切换器、…`
- 实际现状：`.taocode/inspectionProfiles/<name>.xml` + `profiles_settings.xml` 两份都已实现
  （`src/inspectionProfileIo.ts:5-7,25-30`），面板上有「从工程目录导入…／导出到工程目录…」与档下拉
  （`src/components/ProblemsPanel.vue` 的检查配置弹层，档下拉与导入/导出两个按钮），状态栏有切换器 `<InspectionProfileSwitcher />`
  （`src/App.vue:2297` 那条 status-right 里，组件在 `src/components/InspectionProfileSwitcher.vue`）；
  多档 + 逐档门控在 `src/inspectionProfile.ts`，判据 `tests/inspection-profile-multi.test.mjs`、
  `tests/inspection-profile-disk-wiring.test.mjs`。
- 新档（把「缺：」那一段改成）：
  `缺：`.ipr`（项目文件内嵌 profile）的读写、上游 `InspectionProfileConvertor` 的旧格式迁移、
  `InspectionToolRegistrar` 的扩展点注册面（规则由服务器注册，宿主没有注册面）、
  `InspectionProfilerDataHolder` 的逐工具耗时`
- 一句话说明：`.xml` 那条已经从"缺"变成"有"，留着会让下一个代理重做一遍。
