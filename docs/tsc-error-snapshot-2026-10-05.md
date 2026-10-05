# 树状态快照 · 2026-10-05

> 这个文件**由父代理持续追加**。子代理收尾前请**再读一次**。
> 原始损坏快照（58 个类型错误）已修完，改为记录**当前**状态与**未收口**的发现。

---

## 一、类型错误：58 → 5

`npx vue-tsc -b --force`（**必须带 `--force`**：`tsc -b` 是增量构建，命中 `.tsbuildinfo` 缓存会**根本不重扫**，报出的 "exit 0" 是假阴性）。

### 现状（18:50）

**5 个错误 / 4 个文件，全部是桶 8 名下的**：

| 文件 | 错误数 | 属主 |
|---|---:|---|
| `src/macroHost.ts` | 2 | 桶8 |
| `src/App.vue` | 1 | 桶8 |
| `src/lsSessionDocuments.ts` | 1 | 桶8 |
| `src/dragAndDropTargets.ts` | 1 | 桶8 |

**桶 2 / 5 / 6 / 7 均已清零。** 桶 4 仍在推进。

### 原始 58 个错误的归属（已全部处理，供追溯）

桶6 18 个（`TestRunnerPanel.vue` 12、`testNavigation.ts` 2、`DebugInspectWindow.vue` 2、`junitParameters.ts` 1、`MainToolbar.vue` 1）、
桶2 8 个（`lspCompletion.ts`）、桶5 12 个（`mergeResolve.ts` 8、`VcsLogFilters.vue` 2、`VcsLogTextFilterSettings.vue` 2）、
桶4 8 个（`annotatorHighlights.ts` 3、`highlightPasses.ts` 3、`usageHighlightExtension.ts` 2）、
桶7 4 个（`PluginDialog.vue` 2、`fileTypeRegistry.ts` 1、`libraryModel.ts` 1）、
桶8 8 个（`macroHost.ts` 2、`App.vue` 2、`lsSessionDocuments.ts` 1、`dragAndDropTargets.ts` 1、`DebugPanel.vue` 1、`CodeEditor.vue` 1）。

---

## 二、系统性约束（写进规约了，这里留索引）

| 约束 | 说明 | 自查工具 |
|---|---|---|
| **参数属性禁令** | `constructor(private readonly x: T)` 在 Node strip-only 擦除下抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` ⇒ **整个测试文件加载失败**。7 处待清（`autoTest.ts:87`→桶6、`completionUi.ts:206`/`editorInlineValues.ts:18`→桶2、`editorGutterIcons.ts:99`/`editorWhitespace.ts:10/:44`→桶1、`libraryModel.ts:145`→桶7） | `node .tools/find-param-props.mjs` |
| **`.mjs` 必须是纯 JS** | `npm test` **不带** `--experimental-strip-types`。TS 标注 / `type` 别名 / `import type` / `as` 断言 ⇒ 整个文件加载失败。**已全仓清零** | `node .tools/find-ts-in-mjs.mjs` |
| **行数上限** | `module-size.test.mjs` 是唯一权威。当前红灯：`src/components/CodeEditor.vue` 1156 > 登记上限 1147（桶1/桶4 的文件） | `node --test tests/module-size.test.mjs` |

> 检测器都是父代理写的，**都做过反向验证**（注入违规确认会红）。
> 注意 `find-ts-in-mjs.mjs` 第一版没剥字符串/正则，12 条里 10 条是误报 —— 已修，**漏检比误报更糟**。

---

## 三、待收口的发现

### 1. 虚构测试文件 → ✅ **已修（父代理 2026-10-05 21:30）**

`tests/analysis-ignore-project-file.test.mjs` 依赖一个**根本不存在**的测试钩子：
`bridge.__setBridgeTransportForTests is not a function`
—— `src/bridge.ts` / `src/bridgePreview.ts` / `src/bridgeError.ts` 里都搜不到
`__set` / `ForTests` / `TransportForTest` 任何形态。**全仓只有这个测试文件在用它。**
上一轮那个代理凭空发明了这个钩子，整个测试文件是虚构的（5 条用例 0 通过）。

**修法走的是依赖注入**（本仓既有惯例，`toolMacros` / `inspectionProfileHost` 同样把宿主做成可注入 deps），
**不是**加全局测试钩子：

- `src/analysisIgnore.ts` 新增 `AnalysisIgnoreHost` 接口 + `setAnalysisIgnoreHost()`，
  默认实现仍是 `bridge.request`；`refreshProjectAnalysisIgnore` / `loadProjectAnalysisIgnore` 走这个 host。
- 测试改成 `setAnalysisIgnoreHost({ listFiles, readFile })`。

**顺带挖出一个真 bug（被那个虚构钩子盖住的）**：
`refreshProjectAnalysisIgnore()` 原先先 `projectLoadPending = true` 再调 `loadProjectAnalysisIgnore()`，
而后者开头就是 `if (projectLoadPending) return projectIgnoreRecords.value.length`
—— 于是「宿主知道文件变了、显式重读」这条路径**立刻返回旧记录、一次盘都不读**。
换工程后重新读 `.analysisignore` 一直静默失效。已改成先清标志再加载。

另外测试的假宿主 `readFile` 原先返回**字符串**而生产代码读 `document?.content`，
所以即便钩子存在也拿不到内容 —— 一并改回 `{ content }`。

结果：`analysis-ignore-*` 三个文件 **40/40 通过**。

### 2. 上一轮遗留的红测试（红测试 = 待实现功能的契约，**不要删**）

| 桶 | 文件 | 条数 | 状态 |
|---|---|---:|---|
| 桶2 | `tests/structural-search-constraints.test.mjs` | 8 | ✅ **已全绿**（桶2 实现 + 修 5 条过期断言） |
| 桶3 | `tests/module-scopes.test.mjs` | 1 | ⬜ 反向依赖作用域：内容按各模块自己的内容根 union 判定，库与 SDK 不参与 |
| 桶1 | `tests/tab-sticky-lines.test.mjs` | 2 | ⬜ `:66`/`:72`，落点是 `src/tabStickyLines.ts` + `App.vue`（`App.vue` 那条走接线请求） |
| 桶6 | `run-anything-context` 等 | 1 | ✅ 随桶2 一并处理 |

### 3. 过期文档/判词（各桶自己改 `scripts/verdict_table.py` 后重新生成，**不要手改生成物**）

- `exec/run-instances`：「运行统计（`execution/impl/statistics`）」→ 实测只有 9 个 FUS 采集器，全树无 `RunStatistics`/`ExecutionStatistics` ⇒ 是**功能使用统计上报**，无用户可见面。
- `exec/console`：判词写「需要『对运行中进程执行片段的解释器回路』」**前提不成立** —— `ConsoleExecuteAction.java:148-151` 的 `useProcessStdIn` 分支就是本仓的 `run.write` + `native/run_host.hpp:89-90` `write_line` + 可切编码。
- `lp/ide-shell`：任务书里说的「打开项目/关于/退出/设置」**不属于这个族**，它们在 `platform/platform-impl/src/com/intellij/ide/actions/`。
- `pf/nav-toolbar`：「上游路径导航是可编辑的路径下拉」**前提不成立** —— `navigationToolbar/` 只有 4 个模型扩展 java 文件，UI 在 `platform/navbar/frontend/`（Compose 那一族）。
- `dm/problems-view`：**`code`/`tags` 实际是透传的**（`native/lsp_support.cpp:148-149`），判词里"code 没透传"那条阻塞不存在。
- `src/lspFeatureMatrix.ts:44`：文案写「悬停不弹文档」已过期 —— `CodeEditor.vue:518-534` 已在弹 hover。该文件不属任何桶，只提不改。

---

## 四、已确认的「做不到」（有上游依据，不用重做）

- **提交列表按天/作者/提交者/仓库分组**：上游 vcs-log 树里**不存在**（无 `VcsLogGroupBy`，`VcsLogBundle.properties` 无 group 键）。按取证口径不编造。
- **Git Log 过滤器历史**：检索只命中 file history（`VcsLogFileHistoryHandler.kt:25-29`，是另一功能）。
- **结构化搜索的环视断言**：次数/取反约束要发 `(?!\s*,)` / `(?<!,\s*)`，而 `native/search.cpp:249-256` 用 `std::regex(…, std::regex::ECMAScript)`，**该文法不实现环视**，带上去宿主报 `INVALID_QUERY`。要真可用得给宿主换文法或在 `SearchPanel.vue` 侧加前端预筛。
- **`App.vue` 的语言上下文**：`tests/tab-sticky-lines.test.mjs:66/:72` 要 App.vue 把当前编辑器语言喂给 `createStickyLines` ⇒ 走接线请求。
