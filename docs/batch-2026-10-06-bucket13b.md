# 桶 13b · VCS / 提交 / 书签 / 分析范围 —— 接手收红报告（2026-10-06）

> 接手对象：前一个 13b 代理撞到 150 次调用上限被切断，留下 `tests/analysis-scope.test.mjs` 三条红 + 没写报告。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（本轮每条结论都实读源码并给「相对路径:行号」；未上网、未截图比对）。
> 交付：本报告 + `docs/wiring-requests-2026-10-06-bucket13b.md`（5 条请求 + 一节"不需要接线"的说明；其中 1 条是**别人域的现成红**）。

## 0. 结论与 before→after

| 项 | before（主代理实测 / 我接手时） | after（本轮收工） |
|---|---|---|
| `node --test tests/analysis-scope.test.mjs` | 9 用例 / 6 通过 / **3 失败** | **11 用例 / 11 通过 / 0 失败** |
| `node --test tests/analysis*.test.mjs tests/vcs-*.test.mjs tests/scopes*.test.mjs`（+ `changes-view-settings` + `module-scopes`） | 未跑（有红） | **100 用例 / 100 通过 / 0 失败** |
| `npx vue-tsc --noEmit -p <窄 tsconfig：我域 + 其传递依赖>` | — | **exit 0 / 0 错**（覆盖性做过反向验证，见 §5.4） |
| `npx vue-tsc -b --force`（全仓） | 基线 0 错 | 1 错，**不在我名下**：`src/customFoldingProviders.ts:48` TS1002（别的桶的现场，未提交）。⚠️ **全仓 `-b` 这一轮不能用来判我自己文件的类型健康**：`-b` 一旦有语法错就跳过语义阶段，"只剩那一条语法错"是**假阴性** ⇒ 我改用窄项目 tsconfig 自证，跑完即删临时文件 |
| `node .tools/find-param-props.mjs` | 7 处（历史） | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | — | **干净**（`tests/*.mjs` 全纯 JS） |
| `node .tools/find-missing-ext.mjs` | — | **干净**（1110+ 个文件，三种 import 形态） |
| `node .tools/find-orphan-modules.mjs --gate` | 17 → 收工时 3 | 剩 3 条**都不在我域**（`editorJoinComments` / `externalSystemDataStorage` / `fileTemplateCreate`）；`analysisScope.ts`、`changesViewSettings.ts`、`ScopesSettingsPage.vue` 均有生产消费方 |
| 文件行数 | — | `src/analysisScope.ts` 352 / `src/components/ScopesSettingsPage.vue` 599 / `tests/analysis-scope.test.mjs` 226 —— 全部 < 900，未调上限 |

**血规「旧存档不能因为新增字段变成坏的」这轮保住了，并且加强了**：三条读侧兜底判据（旧形状照读 / 坏 JSON 退回缺省 / 认不出的 kind 退回缺省）一条没松，另加两条把"读的时候不许补键"钉到**存档字符串**上的判据（§1.2）。

---

## 1. 三条红的逐条处置

### 1.1 红 1 —— `ANALYZE_TEST_SOURCES（AnalysisUIOptions.java:39 默认 true）：关掉后测试文件不进范围`

- **实况失败点**：`tests/analysis-scope.test.mjs:110`（**不是** :95 那条缺省值断言；`false !== true`）。
- **判定**：**旧断言 —— 测试夹具的前提是错的**，不是回归。
- **证据（上游源码实读）**：
  - `platform/analysis-api/src/com/intellij/psi/search/scope/packageSet/FilePatternPackageSet.java:73-118` 的 `convertToRegexp`：**结尾那个未闭合的单个 `*` 在 :115-117 译成 `[^\/]*`**（不跨目录分隔符）；连续两个 `*` 在 :91-94 同样译成 `[^\/]*`；只有"星号后面还有字符"时 :83-85 才展开成 `.*`。`fileMatcher`（:56-70）拿这个正则整串匹配相对路径。
  - ⇒ `file:*` 只匹配**根层文件**；`file:*.ts` 才匹配 `tests/x.test.ts`。本仓 `src/scopes.ts:319-352` 是逐字符复刻（:350 就是上游 :115-117 那一支），行为一致 ⇒ **实现没有回归**。
  - 本仓既有事实也印证：`tests/module-scopes.test.mjs:222` 早就是用 `file:*.java` 匹配 `src/main/A.java`。
  - 原夹具的第二个毛病：`file:*` 对 `tests/x.test.ts` 恒假 ⇒ 原来 :108「关掉这一档 ⇒ 不在范围」**无论开关都绿**，那条断言根本没在验闸门。
- **处置**：只换夹具（`file:*` → `file:*.ts`；名字 `All` → `Ts`），**断言只加严不放松**：新增「非测试文件不受这一档影响」（`src/a.ts` 开关两边都 true），闸门两侧仍是 `assert.equal` 严格相等。另新增一条**判据用例**把三档通配符的上游语义钉死，防止后来人"以为 `file:*` 匹配所有文件"而去误改 `src/scopes.ts`：`file:*`（根层进 / 带分隔符不进）、`file:*.ts`（任意深度、扩展名不符不进）、`file:src//*`（`//` 是递归，对应上游 :98-103 那一支 → `\/(.*\/)?`）。
- before→after：1 红 → 1 绿；该用例净增 4 条严格断言 + 1 条新用例。

### 1.2 红 2 —— `存档往返 + 坏存档/旧存档退回缺省（旧的两档存档不能因新增字段变成坏的）`

- **实况失败点**：`tests/analysis-scope.test.mjs:137`，deep-equal 差一个键：实际 `{kind:'custom',include:['docs/**'],exclude:[],namedScope:''}`，期望没有 `namedScope`。
- **判定**：**真回归 —— 实现多写了一个不该有的字段**（不是"新字段该带默认值、序列化要补齐"）。
- **依据**：
  - 写侧 `setAnalysisScopeFromText` 落盘的就是 `{kind,include,exclude}`（`src/analysisScope.ts:179-188`），读侧却无条件补 `namedScope: ''` ⇒ **往返不幂等**（存进去的形状 ≠ 读回来的形状）。这正是本仓那条血规的反面：任何"按形状比较 / 再序列化 / 判损坏"的下游写法都会把它当成"存档坏了"。
  - `namedScope` 在类型上是 `kind === 'named'` 才有的判别字段（`src/analysisScope.ts:39-46`）。上游也是分列的：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:42` 的 `SCOPE_TYPE` 与 :43 的 `CUSTOM_SCOPE_NAME` 是两个独立持久化字段，`BaseAnalysisActionDialog.java:205-206` **只有选中 CUSTOM 档才写名字** ⇒ 不存在"project/custom 档也带一个空名字"的形状。
- **处置**：**改实现**（不是改断言）——`src/analysisScope.ts:76-97` 的 `read()` 按 kind 分支：只有 `named` 带 `namedScope`（非字符串照样折成 `''`，**绝不按键数判损坏**），`custom` 只回三列；公开签名不变。断言一个字没动，:137 / :139 / :144 三条 deep-equal 全绿。
- **判据有没有保住**：保住了。并且新增两条更硬的：`assert.equal(map.get(ANALYSIS_SCOPE_KEY), '{"kind":"custom","include":["docs/**"],"exclude":[]}')`（存档串里就不许出现 `namedScope`）+ 两次 `loadAnalysisScope(storage)` 结果 deep-equal。既有三条兜底（旧形状 :143-144 / 坏 JSON :146-147 / 认不出的 kind :148-149）原样保留。
- before→after：1 红 → 1 绿 + 2 条新精确断言。

### 1.3 红 3 —— `设置 › 作用域页接上了「分析」那一节（命名作用域单选 + 包含测试代码）`

- **实况**：动手前 `grep -n "analysisScope" src/components/ScopesSettingsPage.vue` = **0 命中**。`src/analysisScope.ts` 落了 288 行、有 3 个生产消费方（`src/workspaceInspection.ts:14,79-80`、`src/components/ProblemsPanel.vue:33,130-138`、`src/notificationDoNotAsk.ts:27` 的同族做法），**唯独作用域设置页这一头没接**。
- **判定**：**真缺接线** ⇒ 修代码，**没有**改断言迁就现状。
- **上游形状（逐条实读，不是"IDEA 一般是…"）**：
  - `platform/lang-impl/src/com/intellij/analysis/BaseAnalysisActionDialog.java:100-102` —— 复选框文案 = `CodeInsightBundle.message("scope.option.include.test.sources")`，初值 = `AnalysisUIOptions.ANALYZE_TEST_SOURCES`，可见性 = `ModuleUtil.hasTestSourceRoots(project)`（:72、:102）。
  - `platform/lang-api/resources/messages/CodeInsightBundle.properties:474` = `Include &test sources`；中文包（`D:/IntelliJ IDEA 2026.2/plugins/localization-zh/lib/localization-zh.jar!messages/CodeInsightBundle.properties:464`）= `包含测试代码(&T)` ⇒ **页面文案就是这四个字**，本轮实机解包核实过。
  - 中文包 :468 = `scope.option.whole.project` = `整个项目(&P)`（EN :468 `Whole &project`）。本仓这一档单选沿用既有措辞「全部项目」——`scopeSummary()`（`src/analysisScope.ts`）与 `src/components/ProblemsPanel.vue:484` 的重置按钮都是这句，同一句还由 `tests/analysis-scope.test.mjs:22` 钉着 ⇒ 就地写了差异注释（`src/components/ScopesSettingsPage.vue:522-523`），不假装它就是上游原文。
  - `BaseAnalysisActionDialog.java:204-206` —— rememberScope 时写回 `SCOPE_TYPE`，CUSTOM 档再记 `CUSTOM_SCOPE_NAME`（= 作用域名）；机制见 `platform/ide-core/src/com/intellij/ide/util/scopeChooser/ScopeIdMapper.kt:8-31`（"id 与英文名同值，显示名过 mapper"），消费点 `platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeChooserCombo.java:247`。
  - `BaseAnalysisActionDialog.java:218-222` —— `scope.setIncludeTestSource(...)`：这一档属于**范围本身**，不是结果列表的显示过滤 ⇒ 本仓把它接在 `pathInAnalysisScope` 的判定链上（`src/analysisScope.ts:230-257`），三档（project / custom / named）都要过这道门。
  - `BaseAnalysisActionDialog.java:105` —— `myAnalyzeInjectedCode.setVisible(false)`：`ANALYZE_INJECTED_CODE` 上游默认不显示 ⇒ **不放这个控件**（本仓也没有注入语言的 PSI 片段可查，放了就是没有消费者的假控件）。
- **落点**（`src/components/ScopesSettingsPage.vue`，512 → 599 行）：
  - `:15` 头注释登记这一节的逐条对照；`:32-37` `import { analysisScope, analysisUiOptions, scopeSummary, setAnalysisScopeNamed, setAnalysisScopeNamedScopes, setAnalysisUiOption } from '../analysisScope'`
  - `:347-390` 脚本：`CUSTOM_CHOICE`（custom 档在单选组里无对应项 ⇒ 谁都不选中，不谎报）/ `appliedScopes`（只列**已应用**到项目设置的作用域，草稿名字不给选）/ `analysisChoice`（可写 computed，set → `setAnalysisScopeNamed`）/ `includeTestSources`（set → `setAnalysisUiOption('analyzeTestSources', …)`）/ `analysisKind` / `analysisChoiceKnown` / `analysisSummary` + 注入命名作用域表的 `watch(appliedScopes, …, { immediate: true })`
  - `:515-542` 模板：`role="radiogroup"` 的「全部项目 + 每个已应用作用域」单选、「包含测试代码」复选框、当前范围一句话、两句话术提示（没有已应用作用域 / 选中的作用域已不在项目里）
  - `:588-594` 样式全走令牌（`var(--line)` / `var(--muted)`）。顺手清掉本页一条**裸 hex**：原 `:509` `.field-hint.bad{color:#c0392b}` 与 `:485` 的 `var(--error)` 同选择器重复（且是文件注释里声称"已改成令牌"之后漏掉的那一处）⇒ 删除，错误态统一跟随 `--error`。这属规范修复，不是新功能。
- **消费者是真的**：范围被 `src/workspaceInspection.ts:14` + `:79-80` 消费（回执那句「范围「…」跳过了 N 个范围外文件」）。
- before→after：1 红 → 1 绿；该用例断言由 5 条**加严到 10 条**（新增"控件必须落在 `<template>` 段"5 条，见 §5.1）。

### 1.4 顺手补的一个真洞（同族、非三条红之一）—— 命名作用域表的**启动解析缓存**

接线时发现的：`namedScopeTable` 原来只有设置页这一个注入点，而 `pathInAnalysisScope` 是同步求值 ⇒ 用户把范围选成「命名作用域」并重启后，**在打开设置页之前**那张表是空的，`kind === 'named'` 的范围**一个文件都不命中**（用户看到的就是"整工程检查扫了 0 个文件"）。上游没有这个问题，因为它是同步的 `ProjectScopeService`（`AnalysisUIOptions.java:42-43` 只存名字，求值现取服务）。
- **处置（本仓架构补一层，身份仍照上游）**：`src/analysisScope.ts:39-52` 新增 `ANALYSIS_NAMED_SCOPES_KEY = 'taocode.analysisNamedScopes'`；`setAnalysisScopeNamedScopes(scopes, storage?)`（`:211-219`）注入真表的同时缓存 name/pattern；`loadAnalysisNamedScopes(storage?)`（`:225-229`）同步读回（**读到空不覆盖**真表）；模块初始化 `namedScopeTable = ref(readNamedScopes())`（`:205`）；`readNamedScopes`（`:186-201`）逐条校验形状（非字符串 name/pattern 丢掉、上限 200 条）、坏 JSON / 坏形状一律退回空表，**永不抛**。持久化的**身份**仍然是名字（照上游），这张缓存只是解析辅助。
- **判据**：`tests/analysis-scope.test.mjs` 新增一条用例（注入即落盘 / 新进程清空内存后从缓存读回 / 读回前后 `pathInAnalysisScope` 的 false→true / 坏缓存退回空表且**不擦**已解析的表 / 形状不对的条目逐条丢掉）。
- 配套接线请求（真来源提前到"项目打开"）见 `docs/wiring-requests-2026-10-06-bucket13b.md` 第 5 条。

---

## 2. 族判词表（本轮实读上游后的判定）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| `lp/analysis-scope` | 范围三档（project / custom / named） | `[x]` | `platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:42-43`；`BaseAnalysisActionDialog.java:204-206` | `src/analysisScope.ts:39-48`、`:179-199` | 本仓没有 `ModelScopeItemView` 那棵树，落成判别式联合；`namedScope` 只在 named 档出现（§1.2 修正） |
| `lp/analysis-scope` | `ANALYZE_TEST_SOURCES` 这一档 | `[x]` | `AnalysisUIOptions.java:39`（默认 true）；`BaseAnalysisActionDialog.java:100-102`、`:218-222`；`CodeInsightBundle.properties:474`（中文包 :464） | `src/analysisScope.ts:253-257`、`:284-287`；`src/components/ScopesSettingsPage.vue:382-385`、`:537-541` | 关掉后 `classifyFile(path)==='test'` 出局，三档都过这道门 |
| `lp/analysis-scope` | 范围选择 UI（单选 + 复选框）接到宿主 | `[x]`（本轮补） | `BaseAnalysisActionDialog.java:100-102` | `src/components/ScopesSettingsPage.vue:347-390`、`:515-542` | 前置代理只落模型没接线；`ANALYZE_INJECTED_CODE` 上游 :105 就 `setVisible(false)` ⇒ 不放控件 |
| `lp/analysis-scope` | 范围过滤真的作用于分析结果 | `[x]` | `BaseAnalysisActionDialog.java:197-232`（`getScope()` 把范围交给 action） | `src/workspaceInspection.ts:14`、`:79-80`；判据 `tests/analysis-scope.test.mjs:49-73` | 范围外文件不进诊断表，`resultId` 全记（下一轮可回 unchanged） |
| `lp/analysis-scope` | 作用域通配符语义（`*` / `**` / `//`） | `[x]` | `platform/analysis-api/src/com/intellij/psi/search/scope/packageSet/FilePatternPackageSet.java:56-70`、`:73-118` | `src/scopes.ts:319-352`、`:384-430`；判据 `tests/analysis-scope.test.mjs`（本轮新增那条） | 结尾单星不跨目录这条现在被测试钉住 |
| `lp/analysis-scope` | `ScopeIdMapper` 的 scope→id 映射 | `[~]` 部分 | `platform/ide-core/src/com/intellij/ide/util/scopeChooser/ScopeIdMapper.kt:15-31`；`platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeChooserCombo.java:247` | `src/analysisScope.ts:44-46`、`:194-199` | 本仓存的就是名字（= 英文名同值的序列化 id）；**没有**那 11 个预定义标准 id 的提供者 |
| `lp/analysis-scope` | 命名作用域表的同步可得性 | `[x]`（本轮补，本仓自建等价物） | 上游靠同步 `ProjectScopeService`：`AnalysisUIOptions.java:42-43` | `src/analysisScope.ts:39-52`、`:186-229` | 架构不等价 ⇒ 用「注入 + 解析缓存 + 启动同步读回」还原用户可见行为 |
| `lp/analysis-scope` | `BaseAnalysisActionDialog` 对话框本体 / `ModuleScopeItem` / `OtherScopeItem` | `[-]` | `BaseAnalysisActionDialog.java:88-99`（`ModelScopeItemPresenter.createOrderedViews`） | —— | 本仓没有模态对话框宿主 + 只有一个隐式模块；已在 `src/analysisScope.ts:25-28` 登记 |
| `vc/log-ui` | `ChangesViewSettings` 的跨会话存档 | `[x]` **订正判词** | `platform/vcs-impl/shared/src/com/intellij/platform/vcs/impl/shared/changes/ChangesViewSettings.kt:17-25`（只有 `groupingKeys` / `showIgnored` 两字段）、`:27-47`（`@State(name="ChangesViewManager", storages=[WORKSPACE_FILE])`；缺省 `groupingKeys=REPOSITORY_GROUPING` :43、`showIgnored=false` :46） | `src/changesViewSettings.ts:26-100` + 消费方 `src/components/SourceControl.vue:159-173`（按工作区根分键、读回、写回、改了立刻持久化）；判据 `tests/changes-view-settings.test.mjs` | 判词「缺：`ChangesViewSettings` 的跨会话存档（目前是会话内状态）」**已过期**，本轮实测已落地并接线。本仓缺省是"不分组"而不是上游的"仓库"，理由在 `src/changesViewSettings.ts:36-42`（单根单仓库分出来永远一组） |
| `vc/log-ui` | 搁架树（`ShelfTree`） | `[-]` | 与 `vc/shelf`/`dv/shelf` 同判（本轮只把同族的 `ChangesViewSettings.kt` 打开核到行号） | 通道只有 `git.stash` / `git.stash.save` / `git.stash.pop`（`src/bridge.ts:109` 的 Method 表） | 本仓没有"搁架 = 独立 diff 树"的后端；画树控件就是假控件 |
| `vc/log-ui` | 仓库 / 模块分组 | 明确不做 | `platform/vcs-impl/shared/src/com/intellij/openapi/vcs/changes/ui/ChangesGroupingSupport.kt` | `src/changesGrouping.ts:14`（文件头逐条记理由） | 任务书 + `docs/batches-2026-10-06-buckets.md` 桶 13 都点名"别翻案" |
| `vc/log-ui` | 前后端 RPC 拆分与序列化（`ChangesViewApi` / `ChangeListDto`） | `[-]` 架构不成立 | `platform/vcs-impl/shared/src/com/intellij/platform/vcs/impl/shared/rpc/ChangesViewApi.kt`、`platform/vcs-impl/src/com/intellij/vcs/changes/ChangesViewApiImpl.kt`（本轮 find 实到） | —— | 上游那套是给 Swing 前端 ↔ 后端进程拆的；本仓单进程宿主（Vue + C++ 一跳），拆 RPC 只是把一次调用改成一次序列化往返 |
| `vc/changes` | 多变更列表与持久化 | `[-]` | `ChangeListManager` / `CommittedChangeListForRevision` 同族（本轮按语义在 `platform/vcs-impl/src/com/intellij/vcs/changes/` 一侧核） | `src/components/SourceControl.vue`（staged/unstaged 两份，直接映射 git index） | 本仓没有 LGFS 那套变更列表对象；编一排列表 = 假数据 |
| `vc/changes` | `CompareWithLocalDialog` | `[-]` 缺通道 | `platform/vcs-impl/src/com/intellij/vcs/CompareWithLocalDialog.java:53`、`:55` | `src/vcsLogMenu.ts:13` 已就地登记同一缺口 | `git.showCommit` 只给单侧内容（`src/projectExtras.ts:180`），`git.commitFileDiff` 给提交间差异，`git.diff` 给工作区 vs index ⇒ 没有"修订版 vs 工作区版"对照面；要 native 新通道 ⇒ 已提请求 |
| `vc/changes` | blame 注解按修订缓存 | `[-]` 不在本轮可写清单 | `platform/vcs-impl/src/com/intellij/vcs/CacheableAnnotationProvider.java`（本轮 find 实到） | `src/blameAnnotations.ts`（已有身份稳定的注解折算） | 缺"按修订/区间的缓存层与失效规则"；该文件不在我的归属清单（13b 任务书的可写列里没有它），不越权 |
| `vc/changes` | 符号链接归属解析 | `[-]` 缺 native 字段 | `platform/vcs-impl/src/com/intellij/vcs/DefaultVcsSymlinkResolver.java:16`、`:41` | `native/git*.cpp` 的 `git.status` | 状态行没有链接归属 ⇒ 前端无从解析；要动 native ⇒ 已提请求 |

---

## 3. 改动文件

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/analysisScope.ts` | 修改（288 → 352 行） | ① `read()` 判别式返回（`:76-97`，红 2 的实现修复）；② 命名作用域解析缓存（`:39-52` 键与闸值、`:186-229` `readNamedScopes` / `writeNamedScopes` / `setAnalysisScopeNamedScopes(scopes, storage?)` / `loadAnalysisNamedScopes(storage?)`、`:205` 初值）；③ 文件头说明补这一段为什么存在 |
| `src/components/ScopesSettingsPage.vue` | 修改（512 → 599 行） | 「分析」一节（import `:32-37`、脚本 `:347-390`、模板 `:515-542`、样式 `:588-594`）+ 删除重复的裸 hex 规则（规范修复） |
| `tests/analysis-scope.test.mjs` | 修改（166 → 226 行） | 红 1 夹具换正确模式并加严；红 2 新增 2 条存档串级判据；红 3 加严 5 条（控件必须在 `<template>` 段）；新增 2 条用例（通配符语义、解析缓存）⇒ 9 用例变 11 用例 |
| `docs/batch-2026-10-06-bucket13b.md` | 新增 | 本报告 |
| `docs/wiring-requests-2026-10-06-bucket13b.md` | 新增 | 6 条接线请求 |
| `tsconfig.13b.tmp.json` | 建后**已删** | 只为绕开别人文件的语法错跑我自己的窄项目类型检查；收工前删掉（`ls tsconfig*.json` 只剩 `tsconfig.json` + 别人留的 `tsconfig.9a/9b.tmp.json`） |

**没改**：`src/scopes.ts`（本轮判定它是上游忠实复刻，红 1 不是它的错；该文件现存的 diff 全是别的 agent 的现场）、`src/analysisIgnore*.ts`、`src/vcsLog*.ts`、`src/components/VcsLog*.vue`、任何保留文件。

## 4. 验证

- `node --test tests/analysis-scope.test.mjs` → **11 / 11**。
- `node --test tests/analysis*.test.mjs tests/vcs-*.test.mjs tests/scopes*.test.mjs` + `tests/changes-view-settings.test.mjs` + `tests/module-scopes.test.mjs` → **100 / 100**。
- 类型：窄项目 `npx vue-tsc --noEmit -p tsconfig.13b.tmp.json` → **exit 0 / 0 错**（跑完即删）。全仓 `npx vue-tsc -b --force` → 仅 1 条别人域的语法错（`src/customFoldingProviders.ts:48`），我域 0 条。
- 四个门禁：`find-param-props` 0 / `find-ts-in-mjs` 干净 / `find-missing-ext` 干净 / `find-orphan-modules --gate` 剩 3 条且无我域文件。
- 保留门禁也跑了（我只读它们，没改）：`node --test tests/source-citations.test.mjs tests/module-size.test.mjs` → **8 / 8**（本轮写进代码注释的上游全路径引用逐条核得过、行数没顶到上限）。
- 行数上限：`src/analysisScope.ts` 352、`src/components/ScopesSettingsPage.vue` 599，均 < 900，**没动 `tests/module-size.test.mjs`**（保留文件，只读）。
- 共享树纪律：改前逐个重读；`git diff -- <文件>` 自查 —— `src/components/ScopesSettingsPage.vue` 的 7 个 hunk 里**我的**是 `+15`（头注释）、`+32-37`（import）、`+346-391`（脚本）、`+515-541`（模板）与样式那段；`+58 / +75 / +86-123`（`moduleScopes` / `externalLibraries` / `loadFiles` / `fileSystem`）是前置 agent 留下的现场，**我没有覆盖它们**。`src/scopes.ts` 的 52 行 diff 全部不是我做的。未 commit、未 push、未跑任何 `checkout/reset/stash/clean`。

## 5. 反向验证记录（每条新门禁都被故意证伪过一次）

1. **模板接线门禁**（红 3 新增的 `<template>` 段断言）：把页面源码切到 `<template>` 之后、删掉 `v-model="includeTestSources"` 或 `role="radiogroup"` ⇒ 正则 `false` ⇒ 会红。顺带堵住原门禁的漏洞：原先只有 `assert.match(page, /包含测试代码/)`，**只在注释里写一句也能绿**（正是红 3 的成因形态）；现在我把模板顶部注释里的"包含测试代码"改成"那一档开关"，让全模板这四个字**只剩真控件一处**。
2. **`read()` 判别字段修复**：它本来就红（:137 差一个键），改后绿；新加的存档串断言（`'{"kind":"custom","include":["docs/**"],"exclude":[]}'`）是字符串级严格相等 ⇒ 任何"读时补键"立刻红。
3. **解析缓存的两条反向验证**（§1.4）：
   - 注释掉 `setAnalysisScopeNamedScopes` 里的 `writeNamedScopes(...)` ⇒ 1 红，报在 `tests/analysis-scope.test.mjs:193`「注入真表的同时把解析用的表缓存下来」；恢复后绿。
   - 把 `loadAnalysisNamedScopes` 的采纳条件改成永不成立 ⇒ 1 红，报在 `:200`「读回缓存后 named 档照常解析」；恢复后绿。两处临时改动都已撤（`grep -rn REVERSE-CHECK-TEMPORARY src/ tests/` = 空）。
4. **类型检查覆盖性自证**：往 `ScopesSettingsPage.vue` 塞 `const __probe: number = analysisSummary.value` ⇒ 窄项目 `vue-tsc --noEmit` 报 `src/components/ScopesSettingsPage.vue(380,7): error TS2322` ⇒ 证明这一页真的被语义检查覆盖（**全仓 `-b` 因为别人文件的语法错会跳过语义阶段，不能当证据**）；撤掉 probe 后复跑 0 错。
5. **通配符判据用例**（§1.1）的作用就是一条反向验证：它把 `file:*` 的"不跨目录"钉成断言，任何"顺手把 `src/scopes.ts:350` 改成 `.*`"的写法都会红 —— 而那种改法会同时打红 `tests/scopes.test.mjs` / `tests/module-scopes.test.mjs` 里的既有上游复刻判据。
6. **我自己制造过一次 playbook 里那类事故并被这条纪律抓住**：给 `analysisScope.ts` 加缓存时把 `MAX_CACHED_NAMED_SCOPES` 声明了两遍 ⇒ `SyntaxError: Identifier … has already been declared` ⇒ **整个 `tests/analysis-scope.test.mjs` 加载失败**（98 ms 就"1 用例 1 失败"，而不是某条断言红）。改完立刻重跑测试抓到，删掉重复声明后恢复 11/11。留这条记录是因为它的**症状**和 playbook §0.5 说的三种禁令一模一样，靠"改完立刻跑自己域测试"才能当场看见。

## 6. 撞到的、不在我名下的红（如实上报，未动）

`node --test tests/scope-persistence.test.mjs` → **3 条红**（`Error: ./bridge.ts`，抛在 `tests/scope-persistence.test.mjs:24` 的 `throw new Error(name)`）。根因已定位，**不是我改的**：`src/settingsPersistence.ts:13,15,16,17,20` 的相对 import 被加上 `.ts`（`git diff` 显示 `- from './bridge'` / `+ from './bridge.ts'`），而该测试用 `ts.transpileModule` 手搭 CommonJS require 桩，桩键仍是**不带扩展名**的那六个 ⇒ 桩没命中就 `throw`。两个文件都不在我的可写清单（提交/书签半区 + 测试装配面）⇒ 已写成接线请求第 1 条，附复现命令与两种修法。

## 7. 做不到 / 无法核实（逐条给具体卡点，无"下一轮再做"）

1. **`ANALYZE_INJECTED_CODE` 控件**：上游 `BaseAnalysisActionDialog.java:105` 自己 `setVisible(false)`；本仓没有注入语言（SQL / SpEL / JS 片段）的 PSI 片段可查 ⇒ 没有消费者，放了就是假控件。状态位仍按 `AnalysisUIOptions.java:40` 缺省 true 持久化。
2. **预定义作用域（`Project Files` / `Project Test Files` / `All Places` …）**：`ScopeIdMapper.kt:22-31` 那 11 个标准 id 由上游的 `StandardScopes`/provider 链提供，本仓没有任何 provider（`ScopeChooserConfigurable` 的两个持有者在本仓只有"工程设置里的用户作用域"一张表）⇒ 单选组只能列「已应用的用户作用域 + 全部项目」。
3. **`CompareWithLocalDialog` / `Vcs.ShowDiffWithLocal`**：缺"某修订某文件的整份内容（或双侧对照）"通道 ⇒ native 不在我可写清单 ⇒ 接线请求第 4 条。
4. **符号链接归属**：`git.status` 返回体没有该字段 ⇒ 接线请求第 3 条。
5. **blame 按修订缓存**：落点 `src/blameAnnotations.ts` 不在本轮可写清单。
6. **搁架树 / 多变更列表 / 前后端 RPC / 仓库分组**：见 §2 的 `[~-]` 行，四条都有上游坐标，判定分别是"无后端"、"不编造数据"、"单进程架构不成立"、"任务书明确不许翻案"。
7. **中文包文案**：`包含测试代码(&T)` 与 `整个项目(&P)` 本轮都**实机解包核实**（`localization-zh.jar!messages/CodeInsightBundle.properties:464` / `:468`），不再是抄前置代理的说法。
8. 其余 `无法核实` 项：无。

## 8. 接线请求

见 `docs/wiring-requests-2026-10-06-bucket13b.md`，5 条请求 + 末尾一节「明确不需要接线的」（下面第 6 项就是那一节，写出来是为了避免主代理白跑）：
1. `tests/scope-persistence.test.mjs` 的 require 桩键（**别人域的现成红**，附复现与两种修法）
2. `src/components/ProblemsPanel.vue` 接 `AnalysisUIOptions` 的四个控件（状态与 setter 已就绪）
3. `native/git.cpp` 的 `git.status` 增加符号链接归属
4. `native/git*.cpp` + `src/bridge.ts` 增加"某修订某文件内容"通道（`CompareWithLocalDialog`）
5. `src/settingsPersistence.ts` / `App.vue`：项目打开即 `setAnalysisScopeNamedScopes(scopes)`（加固，洞已由 §1.4 的缓存堵住）
6. 反向说明两条"不需要接线"的（避免主代理白跑）
