# 接线请求 · 桶 13b（VCS / 提交 / 书签 / 分析范围）· 2026-10-06

> 格式照 `docs/batches-2026-10-06-buckets.md` §4。以下每一条的目标文件都**不在**本轮的可写清单里（保留文件 或 别的半区名下），所以我没自己动手改。
> 报告本体：`docs/batch-2026-10-06-bucket13b.md`。

## 接线请求（给主代理）

- **目标文件**：`tests/scope-persistence.test.mjs` 第 12-25 行（`host()` 里的 require 桩）
- **要接什么**：把桩键从 `'./bridge' / './errors' / './bookmarksView' / './commitMessageInspection' / './settingsDraft' / './fileChooserDescriptor'` 改成**带 `.ts`** 的形态（与 `src/settingsPersistence.ts:13,15,16,17,20,28` 现在的 import 写法一致）；或者反过来，由 `settingsPersistence.ts` 的属主把那几个值 import 退回无扩展名。**二者取其一，方向由主代理定**（仓规「.ts 值 import 必须带 .ts」指向前者）。
- **为什么需要**：现在这个文件 **3 条用例全红**（`Error: ./bridge.ts`，抛在 :24 的 `throw new Error(name)`）—— 源码加了 `.ts`，桩没跟上。这条红**不是我造成的**（`src/settingsPersistence.ts` 与 `tests/scope-persistence.test.mjs` 都不是我的文件），但它落在「作用域/持久化」这一族，我顺手定位到了根因。
- **上游依据**：不适用（纯本仓测试装配面）。
- **复现**：`node --test tests/scope-persistence.test.mjs` → `tests 3 / pass 0 / fail 3`。

- **目标文件**：`src/components/ProblemsPanel.vue`（桶 2 名下）
- **要接什么**：`analysisUiOptions` / `setAnalysisUiOption(key, value)`（`src/analysisScope.ts:58-74`、`:202-208`）接到问题视图的四个既有控件：按严重度分组、过滤已解决项、自动跟随编辑器、结果区分栏比例。状态已经存在并且**已经在被范围判定消费**（`analyzeTestSources` 那一档），缺的只是控件绑定。
- **为什么需要**：这四个值现在只有存档、没有 UI，是判词里 `lp/analysis-scope` 剩余的"控件在别的桶名下"那一半；我不在自己域外的组件里渲染别人的控件（会撞车）。
- **上游依据**：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:35-38`（四个缺省值）、`:53-62`（`AUTOSCROLL_TO_SOURCE` 的读写口）、`:85`（`GROUP_BY_SEVERITY` 的 setter）、`:109`（`FILTER_RESOLVED_ITEMS` 的 setter）。

- **目标文件**：`native/git.cpp` 的 `git.status` 返回体 + `src/bridge.ts:109` 的 `Method`/类型面（都不可写）
- **要接什么**：状态行里带**符号链接归属**（这个路径是不是 symlink、指向哪儿）。落地后我这边把它接进 `src/vcsFileUtil.ts` 与 `src/changes*.ts` 的归属判定。
- **为什么需要**：`vc/changes` 判词里的「符号链接归属解析」缺口的**唯一卡点**就是这条字段 —— 前端拿不到归属信息时无从解析，硬做就是假判定。
- **上游依据**：`platform/vcs-impl/src/com/intellij/vcs/DefaultVcsSymlinkResolver.java:16`（`implements VcsSymlinkResolver`）、`:41`（`resolveSymlink(VirtualFile)`）。

- **目标文件**：`native/git*.cpp` + `src/bridge.ts`（新增/扩展一个取"某修订里某文件内容"的通道）
- **要接什么**：入参 `{ revision, path }` → 出参该文件在该修订的**整份内容**（或与之配对的双侧 diff）。有了它我就能在 `src/vcsLog*.ts` + `src/changes*.ts` 里做「与本地版本比较」。
- **为什么需要**：现有通道都不够：`git.showCommit` 只出单侧内容（见 `src/projectExtras.ts:180` 的 `GitShowCommit` 用法）、`git.commitFileDiff` 给的是**提交之间**的差异、`git.diff` 给的是工作区 vs index。同一缺口已由 `src/vcsLogMenu.ts:13` 就地登记过（`Vcs.ShowDiffWithLocal`）。
- **上游依据**：`platform/vcs-impl/src/com/intellij/vcs/CompareWithLocalDialog.java:53`（类）、`:55`（`showChanges(project, …)`）。

- **目标文件**：`src/settingsPersistence.ts`（或 `src/App.vue` 里读到 `project.settings.get` 的那一处）
- **要接什么**：读到项目设置后调一次 `setAnalysisScopeNamedScopes(scopes)`（`src/analysisScope.ts`）。
- **为什么需要**：命名作用域的真来源在项目设置里，而 `pathInAnalysisScope` 是**同步**求值。**本轮我已经加了启动缓存兜底**（`taocode.analysisNamedScopes`，模块初始化时同步读回，见报告 §1.4），所以"重启后没进过设置页 ⇒ 分析范围为空"这个洞已经不再对用户可见；这条请求是把真来源的生效时机从「打开设置页」提前到「项目打开」，避免上一次会话遗留的缓存在作用域被别的机器改掉之后短暂偏旧。属于**加固**，不是缺口。
- **上游依据**：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:42-43`（`SCOPE_TYPE` / `CUSTOM_SCOPE_NAME` 存在 workspace 里，求值走同步的 `ProjectScopeService`）。

## 明确不需要接线的（免得主代理来找）

- `src/components/ScopesSettingsPage.vue` 的「分析」一节：本轮已自己接完（页面是我的文件），无保留文件改动。
- `ANALYZE_INJECTED_CODE` 的控件：**不放**。上游在 `BaseAnalysisActionDialog.java:105` 自己就 `setVisible(false)`，本仓也没有注入语言的 PSI 片段可查 ⇒ 放了就是假控件。

## 处理结果（wiring-backlog lane，2026-10-06）

- **`tests/scope-persistence.test.mjs` 桩键** —— `tests/**` 不属本 lane。复核现状：`node --test tests/scope-persistence.test.mjs` ⇒ **tests 3 / pass 3 / fail 0**，该红已被别人修掉。
- **`ProblemsPanel.vue` 四控件** —— 与 bookmarks W-1 同一条；本 lane 不越界改 ProblemsPanel 的既有 owner，登记为「需 ProblemsPanel owner 处理」。
- **`native/git.cpp` 符号链接归属 / 「某修订里某文件内容」通道** —— `native/*` 与 `src/bridge.ts` 非本 lane 可改面。跳过给 native/vcs owner。
- **命名作用域表注入** —— **本 lane 已接线**（与 bookmarks W-2 同一处）：`src/App.vue:499-506` 的 `watch(() => projectSettings.value.scopes, …)` → `setAnalysisScopeNamedScopes(...)`。

结论：零待接（命名作用域那半本 lane 已接），未改本份请求点名的任何文件。
