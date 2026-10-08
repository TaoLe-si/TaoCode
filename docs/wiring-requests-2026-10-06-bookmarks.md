# 接线请求 · bookmarks 半区（书签 / 分析范围 / 包依赖）· 2026-10-06

> 派单规约 §2：以下目标文件**都不在**本代理的可写面里（保留文件或别人的半区），所以只交请求，不动手。
> 报告本体：`docs/batch-2026-10-06-bookmarks.md`。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（每条坐标本轮都实读过）。

## W-1 · 问题面板接 `AnalysisUIOptions` 的四个既有控件

- **目标文件**：`src/components/ProblemsPanel.vue`（桶 2 名下）
- **要接什么**：现成状态与写入口都在 `src/analysisScope.ts`（我名下，已核）：
  ```ts
  import { analysisUiOptions, setAnalysisUiOption } from '../analysisScope'
  ```
  四个键：`groupBySeverity`、`filterResolvedItems`、`autoScrollToSource`、`splitterProportion`
  （缺省值逐条 = 上游 `AnalysisUIOptions.java:35-38`，本轮重读确认；`splitterProportion` 的取值区间已在读侧校验 `>0 && <1`）。
- **现状（本轮实测）**：`grep -n "analysisUiOptions|setAnalysisUiOption|groupBySeverity|filterResolvedItems|autoScrollToSource|splitterProportion" src/components/ProblemsPanel.vue` ⇒ **0 命中** ⇒ 这四个值仍然只有存档、没有控件。
- **为什么需要**：判词 `lp/analysis-scope` 里「其余四项」那一行的"控件在别的桶名下"那一半；我不在别人组件里替他们渲染控件。
- **上游依据**：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:35-38`（四个缺省值）、`:53-62`（`AUTOSCROLL_TO_SOURCE` 的读写口 = `AutoScrollToSourceHandler`）、`:85`（`GROUP_BY_SEVERITY` 的 setter）、`:109`（`FILTER_RESOLVED_ITEMS` 的 setter）；`ANALYZE_INJECTED_CODE` 不放控件的理由见 `BaseAnalysisActionDialog.java:105`（上游自己 `setVisible(false)`）。
- **同族遗留**：`analyzeInjectedCode` 仍按上游缺省 true 存档、无消费者 ⇒ 不要为它做控件。

## W-2 · 项目打开即注入命名作用域表（把生效时机从"进设置页"提前到"开项目"）

- **目标文件**：`src/settingsPersistence.ts` 读到 `project.settings.get` 的那一处（或 `src/App.vue` 装配项目设置的那一行）——两者都是保留文件
- **要接什么**：拿到 `settings.scopes` 后调一次
  ```ts
  import { setAnalysisScopeNamedScopes } from './analysisScope.ts'
  setAnalysisScopeNamedScopes(settings.scopes.map(s => ({ name: s.name, pattern: s.pattern })))
  ```
- **现状（本轮实测）**：`setAnalysisScopeNamedScopes` 的唯一生产调用方仍是 `src/components/ScopesSettingsPage.vue:395`（设置页那个 `watch(appliedScopes, …, { immediate: true })`）。
- **为什么需要**：本仓的范围求值是**同步**的，靠 `taocode.analysisNamedScopes` 这份解析缓存兜底（`src/analysisScope.ts:51`、`:225-241`）。上一轮 13b 已把"重启后没进过设置页 ⇒ 范围为空"那个洞堵住；这条请求擦掉的是**跨项目**那半：换项目后、进设置页之前，缓存里仍是上一个项目的表 ⇒ 选着「命名作用域」的范围会拿旧 pattern 判新项目的文件。属于加固，不是新缺口。
  **本轮之后这条只剩"用户自定义作用域"那一半**：标准范围三档（见报告 §1.2）不依赖这张表，永远解得开。
- **上游依据**：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:28-29`（`@State` + `@Storage(PRODUCT_WORKSPACE_FILE)` ⇒ 范围选择本来就是**按项目**的工作区状态）、`:42-43`（`SCOPE_TYPE` / `CUSTOM_SCOPE_NAME` 只存名字，求值现取同步的 `ProjectScopeService`）。

## W-3 · 编辑器标签右键菜单里书签三行的**行序**

- **目标文件**：`src/components/TabContextMenu.vue` 第 68-70 行（桶 8 / appvue 名下）
- **要接什么**：把三行的顺序按上游组里的 `<reference>` 顺序改成 **添加另一书签… / 编辑描述 / 添加书签｜删除书签**：
  ```vue
  <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.addFileBookmarkToAnotherList(path); close()">添加另一书签…</button>
  <button v-if="ctx.fileBookmarkLabel(path) === '删除书签'" @click="ctx.editBookmarkAt(path); close()">编辑描述</button>
  <button @click="ctx.bookmarkFile(path); close()">{{ ctx.fileBookmarkLabel(path) }}</button>
  ```
- **为什么需要**：上游 `popup@ExpandableBookmarkContextMenu` 的三条 reference 就是这个顺序，且该组整体插在 `ReopenClosedTab` 之后（本仓插在菜单首格，位置差另一条已在 `docs/ui-placement-audit.md` 族里记账）。行序属于"位置要照上游"那一档。
- **上游依据**：`platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227`（`:223` AddAnotherBookmark、`:224` EditBookmark、`:225` ToggleBookmark、`:226` 挂到 `EditorTabPopupMenu`、`:227` 挂到 `ProjectViewPopupMenu`）。
- **顺带说明（免得主代理重复找）**：
  1. **挂点本身已经接上了** —— `src/components/TabContextMenu.vue:68-70` 就在调 `ctx.bookmarkFile/fileBookmarkLabel/editBookmarkAt/addFileBookmarkToAnotherList`。`docs/batch-2026-10-06-bucket13c.md`「做不到」第 4 条写的"落点在别人的编辑器标签右键菜单、本轮未动"**只对模型侧成立**（那一条缺的是"非空白选区 ⇒ 自定义描述"，本轮已在 `src/bookmarks.ts` + `src/bookmarkActions.ts` 补完，判据 `tests/bookmarks.test.mjs`）。本轮新增一条 anchor 判据把这个挂点钉住，别人删掉这行会当场红。
  2. 两行的可见性条件（`fileBookmarkLabel(path) === '删除书签'`）与上游等价：`EditBookmarkAction.kt:14-16` 的 `isEnabledAndVisible = process(event, false) != null` 只要书签存在就成立（`BookmarksManagerImpl.kt:579-583` 的 `getDescription` 首次被问就用 `createDescription` 补一个，文件书签补的是空串而非 null ⇒ 行照显示）。

## W-4 · `git.commit` 增加可选 `paths`（按选中项提交）——**宿主在保留文件，只交请求**

- **目标文件**：`native/main.cpp`（`case "git.commit"_h:` 的入参解析，保留文件）＋ `native/git.cpp` 的 `commit(...)`（vcs 半区名下）
- **要接什么**：可选入参 `paths: string[]` ⇒ 有值时拼 `git commit --only -m <消息> -- <路径…>`；为空时与现在逐字一致。校验（非空、不含控制字符、走既有 `checked_ref`/工作区根约束）在 native 侧做。
- **为什么需要**：这是「提交文件…」（选中文件右键 / Git 菜单里按选中项改名的那条动作）唯一的下游 ⇒ 没有通道就只能挂假控件。
- **上游依据**：`platform/vcs-impl/src/com/intellij/openapi/vcs/actions/commit/CommonCheckinFilesAction.kt:26-78`（动作名 = `VcsBundle` 的 `action.name.checking.file`/`action.name.checkin.directory` 那一族 + `StringUtil.ELLIPSIS`）、`CheckinActionUtil.kt:100-160`（`pathsToCommit` → `getIncludedChanges` → `workflowHandler.setCommitState(...)`）。
  （以上坐标转述自 `docs/wiring-requests-2026-10-06-bucket13c.md` R1，本轮**未**逐行重读上游那两个文件 —— 需要验收时按 R1 的坐标复核。）
- **归属**：这条的**模块侧不在我名下**（我的可写面没有 `native/*`、也没有 `src/commit*.ts`）。派单写"R1 的宿主在 `native/main.cpp` ⇒ 只交请求"，此处按派单把请求原文接住，实施由 vcs 半区（任务 #224）与主代理同一次改。
- **附带**：native 改动要跑 ctest（`call vcvars64.bat` 后 `npm run test:native`，看日志里的 `tests passed` 那行）；用例建议打在临时目录里 `git init` 的新仓库。

## W-5 · 标准范围剩下四档需要宿主状态（编辑器打开表 / 历史表）

- **目标文件**：`src/App.vue` 或 `src/toolViewContext.ts`（把"打开中的路径"与"最近查看/最近更改"两个清单交给分析范围模块）——都不在我名下
- **要接什么**：`src/analysisScope.ts` 的 `STANDARD_ANALYSIS_SCOPES` 已经是一个 `id + title + contains(path)` 的表 ⇒ 宿主把状态注进来只需再加两档：
  ```ts
  { id: OPEN_FILES_SCOPE_ID, title: scopePresentableName(OPEN_FILES_SCOPE_ID), contains: p => openedPaths().includes(p) }
  { id: CURRENT_FILE_SCOPE_ID, title: scopePresentableName(CURRENT_FILE_SCOPE_ID), contains: p => p === activePath() }
  ```
  `Recently Viewed Files` / `Recently Changed Files` 同理要 `src/appPlacesRing.ts` / 文件历史那两张表。
- **为什么需要**：本轮落的是**不依赖宿主状态**的三档（项目文件 / 项目生产文件 / 项目测试文件）；剩下四档的判定标准在编辑器与历史状态里，而 `pathInAnalysisScope` 是同步求值、本模块发不了请求 ⇒ 硬做就是假判定。
- **上游依据**：`platform/ide-core/src/com/intellij/ide/util/scopeChooser/ScopeIdMapper.kt:28-31`（四个 id）；显示名与映射 `platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeIdMapperImpl.kt:23-26`、`:37-40`；名字来源 `platform/lang-impl/src/com/intellij/psi/search/PredefinedSearchScopeProviderImpl.kt:364`（`scope.recent.files`）、`:366`（`scope.recent.modified.files`）、`:368`（`scope.current.file`，使用点在同文件 `:138`）。
- **不需要接线的（免得重复劳动）**：
  - `Project and Libraries` / `All Places` / `Scratches and Consoles`：本仓没有库作用域、没有外部文件参与检查、没有 scratches ⇒ 列出来永远是全集或空集，属假控件（理由同 `src/scopeIdMapper.ts:23-26` 文件头那三条）。
  - `ANALYZE_INJECTED_CODE` 控件、`PerformAnalysisInBackgroundOption`：维持 13b 的判定（上游 `BaseAnalysisActionDialog.java:105` 自己隐藏；宿主请求本就异步）。
  - 书签族的 `BookmarkBundle.messagePointer` / `BookmarksListener`：维持 `[~]`（无消费者 ⇒ 不造空壳），本轮没有新证据要翻案。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W-1（问题面板 `AnalysisUIOptions` 四控件）跳过** —— 目标 `src/components/ProblemsPanel.vue`，本 lane 可改面含 `src/components/**`，但该请求点名「桶 2 名下」且现状 `grep` 仍 0 命中；为不与 ProblemsPanel 的既有 owner 冲突，登记为「需 ProblemsPanel owner 处理」（挂点四键 `groupBySeverity`/`filterResolvedItems`/`autoScrollToSource`/`splitterProportion`，出口 `src/analysisScope.ts`）。
- **W-2 已接线**：`src/App.vue` 在 `projectSettings` 声明后（:499-506）加 `watch(() => projectSettings.value.scopes, …, { immediate: true, deep: true })` → `setAnalysisScopeNamedScopes(...)`，并补 `import { setAnalysisScopeNamedScopes } from './analysisScope'`（:96）。这补的是「开项目 / 换项目后、进设置页之前」那一半（原唯一生产调用方仍是 `ScopesSettingsPage.vue:395`）。
- **W-3 已接线** —— 与 `docs/wiring-requests-2026-10-06-bm3.md` 的 R-1/R-2 是同一条（该文件自己写明「二选一，别两处都改」）：本 lane 已在 `src/components/TabContextMenu.vue:68-70` 与 `src/App.vue:2511-2512` 按上游 `intellij.platform.bookmarks.xml:222-227` 的行序接上。**未重复改**。
- **W-4（`git.commit` 可选 `paths`）跳过** —— 目标 `native/main.cpp` + `native/git.cpp`，本 lane 禁改 `native/main.cpp`，其余属 vcs 半区。需 native/vcs owner 处理。
- **W-5（标准范围剩余四档）跳过** —— 目标 `src/App.vue` 或 `src/toolViewContext.ts` 需要「打开中的路径」与「历史表」两个宿主状态；本 lane 不新建假判定（请求原文自己也说硬做就是假判定）。需 appPlacesRing / 文件历史两张表的 owner 提供状态后再接。

App.vue 行数：2686 → 2695（与 b1b7verdict 的 W-1 同一批改动合计）。
