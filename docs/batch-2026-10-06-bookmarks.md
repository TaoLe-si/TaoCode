# 桶 13 · bookmarks 半区收尾报告（书签 / 分析范围 / 忽略 / 包依赖）· 2026-10-06

> 派单：核 `docs/wiring-requests-2026-10-06-bucket13b.md` 与 `-bucket13c.md` 里目标在本代理名下的条目；
> 书签 `EDITOR_TAB_POPUP` 一支**模型做完**、右键菜单挂点交请求；`lp/analysis-scope`、`lp/analysis-ignore`、
> `lp/package-deps`、`verdict-bookmarks.md` **先核后做**。
> 上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`
> —— 本报告每条坐标都是本轮 `Read`/`sed` 实读过的行；转述别人的结论时**标明未复核**。
> 交付：本报告 + `docs/wiring-requests-2026-10-06-bookmarks.md`（5 条请求 + 一节"不需要接线"的说明）。

## 0. 结论与 before→after

| 项 | before（接手实测） | after（收工） |
|---|---|---|
| `node --test tests/bookmark*.test.mjs tests/scope*.test.mjs tests/analysis-*.test.mjs tests/package-deps-*.test.mjs tests/dependency-*.test.mjs` | **138 用例 / 138 通过 / 0 失败** | **145 / 145 / 0**（净增 7 条判据） |
| `node --test tests/scope-persistence.test.mjs`（13b 报的"3 条全红"） | **3 / 3 绿**（红已由别人收掉，见 §1.3） | 3 / 3 绿 |
| 全仓 `npx vue-tsc -b --force` | 接手时 **0 错** | 收工时 **2 错，都不在我名下**（`src/workspaceDiagnostics.ts:168/175`，lsp 半区在途）⇒ 我域用窄项目 tsconfig 自证 **0 错**（§5.4） |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 干净（1273 个文件） | **干净**（同一数量级，无新增） |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 新增 1（`src/structuralCodeBlock.ts`，不是我的域） | 同样 **1 条新增、不是我做的**；我域零新增（§6） |
| `node --test tests/module-size.test.mjs` | — | **5 / 5 绿**；上限未动，最大文件 614 行 < 900 |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 别人交工时为绿 | **11 用例 / 9 通过 / 2 失败** —— 两条红是**同一句假路径**在别人的三份报告里（`docs/batch-2026-10-06-completion2.md`、`-welcome2.md`），我域引用全部过门（§5.5） |

**做了什么**（三件，全在派单点名的面上）：
1. **书签 `EDITOR_TAB_POPUP` 一支的模型补完** —— 缺的那半不是菜单挂点（挂点早接上了），是"**该标签编辑器里的非空白选区要成为文件书签的自定义描述**"。
2. **`lp/analysis-scope` 判词里"没有标准作用域提供者"那一半落成提供者** —— 标准范围三档（项目文件 / 项目生产文件 / 项目测试文件）现在能在设置›作用域页选、并被整工程检查真实消费。
3. **族判词逐条先核**：`lp/analysis-ignore` 与 `lp/package-deps` 的"缺"里共有 **3 条已过期**（其实早已落码），本轮订正并给坐标；其余缺项逐条给"为什么在本仓形态下不成立"。

---

## 1. 逐项处置

### 1.1 书签 `EDITOR_TAB_POPUP`：模型做完 + 挂点核实（原写"未接"、实际已接）

**上游形状（本轮逐行读过）**

| 上游 | 行为 |
|---|---|
| `platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61` | `place == ActionPlaces.EDITOR_TAB_POPUP \|\| window?.id == PROJECT_VIEW` ⇒ `manager.createBookmark(file)` —— 建**文件书签**（没有行号） |
| 同文件 `:55` | 上下文工具窗口是 Bookmarks 时直接 `return null` ⇒ 书签窗口里没有这一条（本仓面板的右键菜单确实没有"添加书签"，一致） |
| 同文件 `:63-67` | 有 editor 时才走 `LineBookmarkProvider.createBookmark(editor, LOGICAL_LINE_AT_CURSOR)` ⇒ 标签右键拿不到那片行号，所以只能落文件档 |
| `actions/ToggleBookmarkAction.kt:72-82` | `addSingleBookmark`：`manager.toggle(bookmark, type)`（`:75-76` 先 `getType(bookmark) ?: DEFAULT`；`BookmarksManagerImpl.kt:186-187` 的 `toggle` = 已有同类型就 `remove`、没有就 `add`）＋ **`:78-81` `selectedText` 非空白 ⇒ `group.setDescription(bookmark, selectedText)`** |
| `actions/ToggleBookmarkAction.kt:54-58` | 右键菜单里的标题三态：`bookmark.delete.action.text`（已有）/ `bookmark.add.action.text`（没有）/ 非右键时 `action.ToggleBookmark.text` |
| `resources/intellij.platform.bookmarks.xml:222-227` | `popup@ExpandableBookmarkContextMenu` = AddAnotherBookmark → EditBookmark → ToggleBookmark，`:226` 挂 `EditorTabPopupMenu`、`:227` 挂 `ProjectViewPopupMenu` |
| `actions/EditBookmarkAction.kt:14-16` + `:22-37` | 「编辑描述」的可见性 = `process(event,false) != null`，而 `:28` 取 `group.getDescription(bookmark)`；`BookmarksManagerImpl.kt:579-583` 的 `getDescription` **首次被问就用 `createDescription` 补一个**（文件书签补的是空串、不是 null）⇒ 只要书签存在这行就显示 |
| `platform/lang-api/resources/messages/BookmarkBundle.properties:13-15` | `Add _Bookmark` / `Add Bookmarks…` / `Delete _Bookmark`；本机 IDEA 2026.2 中文包（`localization-zh.jar` 解包，键同名）= 添加书签(_B) / 删除书签(_B) ⇒ 本仓 `fileBookmarkLabel` 那两句逐字对上 |

**本仓落点**

| 落点 | 内容 |
|---|---|
| `src/bookmarks.ts:244-262` | 新增 `bookmarkSelectionDescription(selectedText?)` —— 上游 `isNullOrBlank()` 那条规则的唯一本体（空白/取不到 ⇒ 不设；设的是**原文、不 trim**，trim 只在 `bookmarkDescription` 取值时做，同上游 `createDescription:129-136`） |
| `src/bookmarks.ts:263-281` | `toggleFileBookmark(list, path, selectedText?)`：第三个形参的语义从"描述"改成"**该标签的选区文本**"，描述由上面那条规则算；取消那一支照旧整条删掉（对齐 `toggle` 的 remove 语义），且**不写 `line` 键** |
| `src/bookmarkActions.ts:247-252` | `bookmarkFile(path)` 现在把 `deps.selection?.(path)` 喂进去 —— 宿主给的是"**被右键那一个标签**"的选区（`src/App.vue:1255` 的 `selection: path => editorFor(path)?.selectionText()`），与上游"取不到 editor 就没有描述"同形 |
| `src/bookmarkActions.ts:139-148` | `toggleBookmark`（F11 那一支）改用同一个纯函数 ⇒ 文件档与行档不会漂出两套"空白算不算"的判定 |

**挂点（本代理不可写 ⇒ 只核不改）**：`src/components/TabContextMenu.vue:68-70` **早已**在调 `ctx.bookmarkFile / fileBookmarkLabel / editBookmarkAt / addFileBookmarkToAnotherList`。
⇒ 留痕：`docs/batch-2026-10-06-bucket13c.md`「做不到」第 4 条写的"落点在别人的编辑器标签右键菜单、本轮未动"**只对模型侧成立**，挂点那半已不在。本轮新加一条 anchor 判据把这个挂点钉住（`tests/bookmarks.test.mjs:253-267`）——别人把这三行删掉会当场红。
**唯一残余偏差**是**行序**（本仓 Toggle 在首、上游 AddAnotherBookmark 在首）⇒ 已按上游 `xml:222-227` 写成可照抄的替换片段，进 `docs/wiring-requests-2026-10-06-bookmarks.md` W-3。

### 1.2 `lp/analysis-scope`：标准（预定义）范围的**提供者**落地

判词原文（`docs/inventory/platform_rest_verdict_table.md` / 13b 报告 §2）：`ScopeIdMapper` 那一行 `[~]`，缺的是"**没有那 11 个预定义标准 id 的提供者**"；13b 的「做不到 2」也写着"单选组只能列「已应用的用户作用域 + 全部项目」"。
**本轮核对**：`src/scopeIdMapper.ts:29-57`（id 常量与 `STANDARD_SCOPE_IDS`）、`:74-92`（两向映射）、`:112-117`（`DEPENDENCY_SCOPE_OPTIONS`，已被 `src/components/PackageDepsDialog.vue:32/78` 消费）—— 也就是说 **id 与显示名那一半早就有了**，缺的确实只剩"分析范围这头的提供者"。 ⇒ 判词的 `[~]` 描述本身已过期一半，本轮补掉剩下那一半。

**上游依据（逐条实读）**

- `Project Files` —— `platform/analysis-api/src/com/intellij/psi/search/scope/ProjectFilesScope.java:19-31`：`contains` = `fileIndex.isInContent(file)`（另含 scratches，本仓没有）。本仓的工作区清单就是内容根里的文件 ⇒ 恒真。
- `Project Production Files` —— `platform/analysis-api/src/com/intellij/psi/search/GlobalSearchScopesCore.java:152`：`isInSourceContent(file) && !TestSourcesFilter.isTestSources(...)`；显示名 `:177` → `:405-406`。
- `Project Test Files` —— 同文件 `:188`：`TestSourcesFilter.isTestSources(...)`；显示名 `:208` → `:409-410`。
- 序列化 id：`platform/ide-core/src/com/intellij/ide/util/scopeChooser/ScopeIdMapper.kt:24-26`（`standardNames` 在 `:36-41`）；显示时过映射：`platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeIdMapperImpl.kt:20-21` 与反查 `:34-35`。
- 范围选择是**工作区状态**（按项目存）：`platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:28-29`（`@State` + `@Storage(PRODUCT_WORKSPACE_FILE)`）、`:42-43`（`SCOPE_TYPE` / `CUSTOM_SCOPE_NAME`）；对话框那一侧记住名字只在 CUSTOM 档：`platform/lang-impl/src/com/intellij/analysis/BaseAnalysisActionDialog.java:204-206`（`:206` 存的还是 `getDisplayName()`）。
- 「包含测试代码」是**范围的一档**、不是结果列表的过滤：`BaseAnalysisActionDialog.java:218-222`（`:222` 对**选中的任何范围**都调 `scope.setIncludeTestSource(...)`）⇒ 本仓 `pathInAnalysisScope` 保持"先过范围、再过这一档"的顺序，所以选了「项目测试文件」又关掉「包含测试代码」时**结果为空是上游行为**。

**本仓落点**

| 落点 | 内容 |
|---|---|
| `src/analysisScope.ts:65-113` | `StandardAnalysisScope` + `STANDARD_ANALYSIS_SCOPES`（三档：id 取 `scopeIdMapper` 的常量、title 取 `scopePresentableName`、`contains` 用 `packageDepsView` 的 `classifyFile`）＋ 逐条说明剩下八档为什么**不进表**（库/外部文件/scratches 没有对应实体；编辑器打开表与最近查看/更改要宿主状态 ⇒ W-5） |
| `src/analysisScope.ts:115-118` | `isStandardAnalysisScope(name)` —— 给 UI 判"这个名字认不认得"，避免选中标准档时误报"作用域已不在项目里" |
| `src/analysisScope.ts:363-378` | `namedScopeContains`：**用户表优先**，查不到名字才落标准表；认不出的一律不在范围内（原有兜底不变） |
| `src/analysisScope.ts:402` | `scopeSummary` 的名字过 `scopePresentableName` —— 存档是 id、那句话是中文（映射表里没有的名字原样返回，同 `ScopeIdMapperImpl.kt:27` 的 `else -> scopeId`） |
| `src/components/ScopesSettingsPage.vue:395` 附近（脚本 `analysisChoiceKnown`）与模板单选组 | 单选组在「全部项目 + 已应用作用域」之后追加三行标准档（`:value="scope.id"`、`{{ scope.title }}`）；页面头注释里"本仓没有这些提供者，故列表里只有用户自定义作用域"那条**订正**为：*作用域列表*仍然只有用户条目（`CustomScopesProvider` 扩展点没有 ⇒ 造只读条目是假控件），但*分析范围*的单选组给出可判定的三档 |

**为什么不是假控件**：这三档的判定链是真链路 —— `pathInAnalysisScope` → `filterByAnalysisScope` → `src/workspaceInspection.ts:14/79-80`（整工程检查写诊断表**之前**过滤，回执那句「范围「…」跳过了 N 个范围外文件」）。

**⚠ 那条钉着严格清单与旧存档兼容的测试（`tests/analysis-scope.test.mjs`）**：本轮**一个字没松**。
- 11 条既有用例（含 `deepEqual` 判别式形状、存档串级 `assert.equal(map.get(ANALYSIS_SCOPE_KEY), '{"kind":"custom",...}')`、`{kind:'module'}` 退回缺省、坏 JSON 退回缺省、模板接线 5 条）**原样保留且全绿**；
- 判别式形状没被破坏：标准档复用 `kind:'named'`，所以 `{kind:'named',include:[],exclude:[],namedScope:'Project Test Files'}` 写出去读回来逐键相同（新增判据把这条存档串钉住，见 `:267`）；
- 只**新增** 4 条用例（11 → 15），并在新用例里显式设 `analyzeTestSources` 初值 —— 因为既有的"存档往返"用例用过带 `storage` 的 setter，会把全局那一档留在 `false`（这是**原文件就有的状态泄漏**，我没改那条用例，只是让新用例不依赖执行顺序）。

### 1.3 两份接线请求里目标在我名下的条目：核完情况

| 13b/13c 的请求 | 目标文件 | 归属 | 本轮实况 |
|---|---|---|---|
| 13b 第 1 条（require 桩键缺 `.ts` ⇒ 3 条全红） | `tests/scope-persistence.test.mjs` | **我名下**（`tests/scope*`） | **红已不在**：该文件现在的桩按「去掉 `.ts`」归一化匹配（文件内 `:13-15` 的注释与 `rawName.replace(/\.ts$/,'')`），本轮实测 **3/3 绿**。留痕：原写"3 条用例全红"、实际本轮已不复现 ⇒ 这条请求可以销账 |
| 13b 第 2 条（四个 `AnalysisUIOptions` 控件） | `src/components/ProblemsPanel.vue` | 桶 2 ⇒ 不可写 | **仍未接**（`grep analysisUiOptions\|setAnalysisUiOption\|groupBySeverity\|filterResolvedItems\|autoScrollToSource\|splitterProportion` = 0 命中）⇒ 重述为本半区 W-1，附上现成 API 与本轮重读过的缺省值坐标 |
| 13b 第 5 条（项目打开即注入命名作用域表） | `src/settingsPersistence.ts` / `src/App.vue` | 保留文件 ⇒ 只交请求 | 唯一生产调用方仍是 `ScopesSettingsPage.vue:395` ⇒ 重述为 W-2，并补一条**新增理由**（跨项目时解析缓存会带着上一个项目的 pattern）＋ 一条**减小**：标准档不依赖注入，W-2 现在只剩"用户自定义作用域"那一半 |
| 13b 第 3、4 条（`git.status` 符号链接归属 / 某修订某文件内容） | `native/git*.cpp` + `src/bridge.ts` | 不是我的面（vcs 半区） | 未动、不重复交请求（原请求仍在 13b 那份里） |
| 13c R1（`git.commit` 的可选 `paths`） | `native/main.cpp:1169`（保留文件）＋ `native/git.cpp` | 宿主在 `native/main.cpp` ⇒ **按派单只交请求** | 已重述为 W-4：`native/main.cpp:1169` 的 `case "git.commit"_h:` 本轮**实地确认存在**；上游那两个 `.kt` 文件路径本轮确认存在（`CommonCheckinFilesAction.kt` 80 行、`CheckinActionUtil.kt` 191 行，13c 引的区间都在范围内），但**逐行语义未复核**，W-4 里已注明 |
| 13c R2（提交前检查的文档修订计数） | `src/toolViewContext.ts` + `src/App.vue` | 不是我的面 | 未动（属 vcs 半区任务 #225） |

---

## 2. 族判词表（本轮实读后的判定；`[-]` 都给具体理由）

| 族 | 项 | 判定 | 上游相对路径:行号 | 本仓落点文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| `ide/bookmarks` | `EDITOR_TAB_POPUP` 一支（标签右键 = 文件书签 + 选区成描述） | `[x]` **本轮补完** | `platform/bookmarks/src/com/intellij/ide/bookmark/actions/extensions.kt:57-61`；`actions/ToggleBookmarkAction.kt:72-82` | `src/bookmarks.ts:244-281`、`src/bookmarkActions.ts:247-252`；判据 `tests/bookmarks.test.mjs:224-267` | 模型三段（切换/描述/标题两态）都照上游；挂点 `src/components/TabContextMenu.vue:68-70` 已在，只剩行序 ⇒ W-3 |
| `ide/bookmarks` | 菜单行序 AddAnother / Edit / Toggle | `[ ]` 未做（不在我面） | `platform/bookmarks/resources/intellij.platform.bookmarks.xml:222-227` | —— | 别人组件里的模板，给了可照抄片段（W-3） |
| `ide/bookmarks` | `EditBookmark` 的可见性（文件书签也要能改描述） | `[x]` **本轮核实**（原已做） | `actions/EditBookmarkAction.kt:14-16`、`:22-37`；`BookmarksManagerImpl.kt:579-583` | `src/bookmarkActions.ts:207-212`（`editBookmarkAt`，`line` 省略即文件书签）、`src/components/TabContextMenu.vue:69` | 上游 `getDescription` 首次被问就补 `createDescription`（文件书签是空串、非 null）⇒ "书签存在就显示"与本仓 `label === '删除书签'` 等价 |
| `ide/bookmarks` | `BookmarkBundle.messagePointer`（惰性 Supplier） | `[~]` 维持**不做** | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarkBundle.java:21-28` | —— | 本仓每处取文案都是一次性同步求值，没有"先拿指针稍后再取"的消费者 ⇒ 造包装是空壳（与 13c 同判，本轮无新证据翻案） |
| `ide/bookmarks` | `BookmarksListener` 事件面 | `[~]` 维持**不做** | `platform/bookmarks/src/com/intellij/ide/bookmarks/BookmarksListener.java:10-16` | —— | Vue 响应式已承接"表一变四处重算"；无插件运行时、无第二个订阅者 |
| `ide/bookmarks` | 目录书签的 `FolderNode` 独立呈现 | `[ ]` 未做（缺字段通道） | `platform/bookmarks/src/com/intellij/ide/bookmark/providers/FileBookmarkImpl.kt:26-29`（按 `isDirectory` 分 File/Folder 节点）—— *本轮未逐行读，坐标转引自 `docs/inventory/verdict-bookmarks.md` §C②* | `src/bookmarks.ts`（`Bookmark` 无目录标记）、`native/settings_schema.cpp`（保留：白名单要放行新字段） | 加一个持久化字段要动原生白名单 + 校验（别人的面），且面板现在把目录当普通文件行渲染 —— 不是回归，但也不动 |
| `lp/analysis-scope` | 标准（预定义）范围的提供者 | `[x]` **本轮落地** | `platform/analysis-api/src/com/intellij/psi/search/GlobalSearchScopesCore.java:152`、`:188`、`:177/208`、`:405-410`；`scope/ProjectFilesScope.java:19-31`；`ScopeIdMapper.kt:24-26`；`ScopeIdMapperImpl.kt:20-21` | `src/analysisScope.ts:65-118`、`:363-378`、`:402`；`src/components/ScopesSettingsPage.vue` 单选组；判据 `tests/analysis-scope.test.mjs:235-291` | 可判定的三档进表；剩下八档的理由写在表注释里（四档要宿主状态 ⇒ W-5，四档本仓没有对应实体） |
| `lp/analysis-scope` | `ScopeIdMapper` 的 id 侧（存 id、显示才映射） | `[x]` **订正判词** | `ScopeIdMapperImpl.kt:16-28`、`:30-42` | `src/scopeIdMapper.ts:29-92`（既有）＋ `src/analysisScope.ts:402`（本轮把显示名接上） | 原判词"本仓直接存模式文本"已过期：存的一直是名字，本轮补的是**分析范围这一头**的映射与提供者 |
| `lp/analysis-scope` | `AnalysisUIOptions` 六个缺省值 | `[x]` **本轮逐条重读核对** | `platform/lang-impl/src/com/intellij/analysis/AnalysisUIOptions.java:35-40`、`:47`（`ANALYSIS_IN_BACKGROUND=true`） | `src/analysisScope.ts:81-88` + `DEFAULT_ANALYSIS_UI_OPTIONS`；判据 `tests/analysis-scope.test.mjs:138-150` | 六项全对（false / 0.5 / false / true / true / true）；本轮没有改值，只把控件那半重述为 W-1 |
| `lp/analysis-scope` | 四个控件接宿主 | `[ ]` 未做（不在我面） | `AnalysisUIOptions.java:53-62`、`:85`、`:109` | `src/analysisScope.ts:266-273`（setter 现成） | 问题面板是桶 2 名下 ⇒ W-1，附可照抄的 import |
| `lp/analysis-scope` | `BaseAnalysisActionDialog` 对话框本体 / `ModuleScopeItem` / `OtherScopeItem` | `[-]` 维持不适用 | `platform/lang-impl/src/com/intellij/analysis/BaseAnalysisActionDialog.java:98-107`、`:204-206`、`:218-222`（本轮重读 `:186-235` 全段） | 已在 `src/analysisScope.ts:26-29` 登记 | 本仓没有模态对话框宿主 + 只有一个隐式模块 ⇒ 造那棵树就是编控件 |
| `lp/analysis-ignore` | `.analysisignore` 的就近/逐目录读取**要宿主注入 `exists`（接线未接）** | `[x]` **订正判词：已接** | `platform/lang-impl/src/com/intellij/ide/analysisignore/AnalysisIgnoreService.kt:35`（service 本体）、`:38`（`baseDirsToForget`）、`:54-59`（`scheduleChanges(baseDirUrls…)` 按 baseDir 收规则） | `src/analysisIgnore.ts:76-93`（`AnalysisIgnoreHost` + `defaultHost` 走 `workspace.files` / `file.read`）、`:112-138`（门控首次被问就发读盘）、消费方 `src/problems.ts:93/111` | 宿主不需要外部注入：默认宿主自己发桥请求；读到的记录落在 `projectIgnoreRecords` 这个 ref 上 ⇒ 诊断表自动重算。判词那句"接线未接"已过期 |
| `lp/analysis-ignore` | "每个 `.analysisignore` 只管自己那棵子树"（不是"就近取一个"） | `[x]` 本轮核实（原已做） | 同 `AnalysisIgnoreService.kt:54-59` 的 `baseDirUrls` 口径；`analysisignore/` 整包 15 个类本轮 `ls` 过 | `src/analysisIgnoreFile.ts:258-320`（`analysisIgnoreFilesIn` / `analysisIgnoreRecord` / `analysisIgnoreHits` / `isAnalysisIgnoredByRecords`）；判据 `tests/analysis-ignore-file.test.mjs:81`、`tests/analysis-ignore-project-file.test.mjs` | `verdict-platform_rest.md` 里写的 `analysisIgnoreCandidates` / `nearestAnalysisIgnoreFile` 这两个名字**现在模块里没有**（导出表核对过）—— 那句话是早期形状，现形是"逐文件、各自管子树" |
| `lp/analysis-ignore` | `.analysisignore` 作为独立文件类型（词法/解析/高亮） | `[-]` 维持不做 | `platform/lang-impl/src/com/intellij/ide/analysisignore/`（`lang` 子目录 = `AnalysisIgnoreFileType`/`Lexer`/`SyntaxHighlighter` 那一族） | `src/analysisIgnoreFile.ts:23`（文件头逐条写明不做的理由） | 那是 PSI 侧形态；本仓的匹配语义已经用纯解析实现（`:67-256` 的规则编译 + gitignore 风格解析），编辑器里给这个后缀挂语法着色要动文件类型/高亮注册（别人的面）且没有任何行为差别 |
| `lp/analysis-ignore` | 索引层联动（`AnalysisIgnoreIndexableFileScanner` / `WorkspaceFileIndexContributor`） | `[-]` 维持不适用 | 同目录那两个类名（`ls` 实到） | —— | 本仓没有 Workspace File Index 可挂，聚合前那道同步门控就是等价物 |
| `lp/package-deps` | `DependencyUISettings` 的 `UI_FILTER_LEGALS` | `[x]` **订正判词：已做** | `platform/lang-impl/src/com/intellij/packageDependencies/DependencyUISettings.java:21`（默认 false） | `src/packageDepsView.ts:103-116`（`filterLegals` + 缺省 false）、`src/components/PackageDepsDialog.vue:66-69/237-241`（「仅显示非法依赖」真过滤 + 违规标红） | 判词"缺：…filter legals"过期；缺省值与上游一致（false） |
| `lp/package-deps` | `UI_FLATTEN_PACKAGES` | `[-]` 本仓形态下不成立 | `DependencyUISettings.java:17`（true）；`ui/DependenciesPanel.java:518` 与 `:985`：`fillFiles(result, !UI_FLATTEN_PACKAGES)`；开关动作 `ide/util/scopeChooser/FlattenPackagesAction.java:39/49` | `src/packageDepsView.ts:98-99/128`（`showFiles`）＋ `PackageDepsDialog.vue` 的「显示文件」 | 上游这一档控制的是"树里把包展开到文件节点"；本仓的同一件事已由 `showFiles` 承担 ⇒ 再加一个开关 = 同一状态两份存储（假选项）。`UI_SHOW_FILES` 那一对动作在 `ShowFilesAction.java:40/50` |
| `lp/package-deps` | `UI_SHOW_MODULES` / `UI_SHOW_MODULE_GROUPS` | `[-]` 不适用 | `DependencyUISettings.java:19-20` | —— | 本仓只有一个隐式模块、没有模块组可显示（同 13b 对 `ModuleScopeItem` 的判法） |
| `lp/package-deps` | `UI_COMPACT_EMPTY_MIDDLE_PACKAGES` | `[-]` 无消费者 | `DependencyUISettings.java:24`（true）；本轮 grep 全 `platform` 只见 `ui/DependenciesPanel.java:1171/1176` 的那份 settings 拷贝 ⇒ 没有真正的行为读点 | —— | 找不到消费它的渲染代码 ⇒ 在本仓做出来就是无人读的开关 |
| `lp/package-deps` | 其余缺项（常驻工具窗口、包/模块/库三类树节点、PSI 级引用边、`DependencyValidationManager` 规则存储） | `[~]` 维持部分 | `DependencyUISettings.java:25`（`SCOPE_TYPE` = `PatternDialectProvider` 首项短名） | `src/packageDeps.ts`（目录级图 + Tarjan）、`src/packageDepsView.ts`（scope/闭包/分组）、`src/dependencyRules.ts` + `PackageDepsDialog.vue:31/78/141`（规则与 `.idea/scopes` 同形的 from/to/deny） | 本轮**未新做**：对话框 vs 常驻工具窗口属形态差（已在判词里记账）；`SCOPE_TYPE` 那一档本仓的等价物是 `DEPENDENCY_SCOPE_OPTIONS` 的选择（值就是序列化 id） |
| `vc/changes` | blame 注解按修订缓存 | `[ ]` 未做（本轮点名了可写面但没做） | `platform/vcs-impl/src/com/intellij/vcs/CacheableAnnotationProvider.java`（**本轮未打开**，坐标转引自 13b §2） | `src/blameAnnotations.ts`（92 行，身份稳定的注解折算） | 13b 因"该文件不在它的清单里"没动；本轮它**在**我的清单里，但缺的是"按修订/区间的缓存层与失效规则"，而**修订号通道在别人的 `native/git*.cpp` + `src/bridge.ts`**（13b 第 4 条请求）⇒ 拿不到修订就没有真缓存键，硬做是假判定。本轮不动它（见 §7 第 3 条） |

---

## 3. 改动文件（`wc -l` 前后）

| 文件 | 前 | 后 | 内容 |
|---|---|---|---|
| `src/bookmarks.ts` | 306 | 335 | `bookmarkSelectionDescription`（`:244-262`）+ `toggleFileBookmark` 的选区语义与上游坐标注释（`:263-281`） |
| `src/bookmarkActions.ts` | 331 | 336 | `bookmarkFile` 接 `deps.selection`（`:247-252`）、`toggleBookmark` 改调同一纯函数（`:139-148`）、import 补 `bookmarkSelectionDescription`（`:9`） |
| `src/analysisScope.ts` | 352 | 413 | 标准范围表 + `isStandardAnalysisScope`（`:65-118`）、`namedScopeContains` 的表优先/标准兜底（`:363-378`）、`scopeSummary` 过映射（`:402`）、文件头那段"提供者"说明（`:13-21`）、`scopeIdMapper` 的 import（`:35`） |
| `src/components/ScopesSettingsPage.vue` | 599 | 614 | 头注释订正（"没有提供者"那句）、import 两行、`analysisChoiceKnown` 认标准档、单选组追加三行 + 上游坐标注释 |
| `tests/bookmarks.test.mjs` | 215 | 267 | 新增 3 条用例（选区→描述规则、标签右键三段行为、菜单标题两态 + 挂点/模型的 anchor 判据） |
| `tests/analysis-scope.test.mjs` | 226 | 291 | 新增 4 条用例（三档判定、用户作用域优先、存档是 id/显示是中文 + 与「包含测试代码」的交叉、页面 anchor 判据）；**既有 11 条一字未改** |
| `docs/batch-2026-10-06-bookmarks.md` | — | 本文件 | 交付报告 |
| `docs/wiring-requests-2026-10-06-bookmarks.md` | — | 5 条请求 + 免接线说明 | 交付请求 |
| `tsconfig.bookmarks.tmp.json` | — | **收工前已删** | 只为绕开别人文件的类型错跑我自己的窄项目检查（§5.4） |

**没有改**：`src/scopes.ts`、`src/analysisIgnore*.ts`、`src/packageDeps*.ts`、`src/dependencyAnalyzer.ts`、`src/blameAnnotations.ts`、`src/scopeIdMapper.ts`（只 import，不动它的文件）、`src/bookmark{Lists,ListActions,Settings,View}.ts`、任何保留文件；未 commit、未 push、没跑任何 `checkout/reset/stash/clean`。

---

## 4. §5 每条自查命令的前后数字

见 §0 表格（同一条口径）。补充两点：

- `node --test tests/module-size.test.mjs` 收工 **5/5 绿**；**上限一个没动**、没登记任何豁免。本轮最大文件是 `src/components/ScopesSettingsPage.vue` 的 614 行（< 900），`src/analysisScope.ts` 413 行。
- 域测试只跑自己域（12 路并行，不跑全量 `npm test`）：`tests/bookmark*.test.mjs tests/scope*.test.mjs tests/analysis-*.test.mjs tests/package-deps-*.test.mjs tests/dependency-*.test.mjs` = **145/145**；另外单独确认 `tests/scope-persistence.test.mjs` = 3/3。

---

## 5. 反向验证记录（每条新判据都被故意证伪过一次）

**注入 3 处违规 → 4 条红 → 撤掉 → 复绿**：

| # | 注入了什么 | 红了哪几条 | 撤后 |
|---|---|---|---|
| 1 | `src/analysisScope.ts` 的 `namedScopeContains` 里把标准表查找改成"永不命中"（`const standard = undefined`） | ①「标准范围不需要项目设置里那张表就能判定」②「标准档的显示名过 ScopeIdMapper：存档是 id、那句话是中文」（两处都靠这条兜底判路径） | 绿 |
| 2 | `src/bookmarkActions.ts` 的 `bookmarkFile` 退回不传选区（`toggleFileBookmark(bookmarks.value, path)`） | ③「标签菜单标题随状态（添加书签 / 删除书签），且挂点真的消费了模型」 | 绿 |
| 3 | `src/components/ScopesSettingsPage.vue` 单选组里把 `v-for="scope in STANDARD_ANALYSIS_SCOPES"` 换成 `v-for="scope in []"` | ④「作用域页把标准档也列进单选组（不是只在注释里提一句）」 | 绿 |

- 注入时实况：`node --test tests/analysis-scope.test.mjs tests/bookmarks.test.mjs` → **37 用例 / 33 通过 / 4 失败**（红的正是上面四条，标题逐条对得上）；撤掉后 → **37 / 37 / 0**，全域 → **145 / 145 / 0**。
- 临时标记全清：`grep -rn "REVERSE-CHECK-TEMPORARY" src/ tests/` = **空**。
- 第 4 条为什么有效：页面那 5 条 anchor 断言只看 `<template>` 段里的 `v-for`/`:value`/`{{ scope.title }}` —— 早先那种"在注释里提一句标准范围"的写法**过不了这道门**（这正是本轮要防的假接线形态）。
- 判据强度只升不降：既有用例零改动（§2 的 `⚠` 那条），新增断言一律用 `assert.equal` / `assert.deepEqual` / 精确存档串，没有把任何 `deepEqual` 换成 `includes`、没有调低任何数字下限。

---

## 6. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate` 收工实况：**已登记 9 / 基线 9 · 新增 1 · 本轮清掉 0**，那 1 条是 `src/structuralCodeBlock.ts`（别人的在途文件，我既没读也没写它）。**我域零新增孤儿**。
- 本轮新符号逐个查消费方（不是"只过自己测试"）：
  - `bookmarkSelectionDescription` → `src/bookmarkActions.ts:146`（F11 一支）与 `:250`（标签/树右键）——两处都是生产链路；
  - `toggleFileBookmark`（改签名）→ 唯一调用方 `src/bookmarkActions.ts:250`；
  - `STANDARD_ANALYSIS_SCOPES` / `isStandardAnalysisScope` → `src/components/ScopesSettingsPage.vue`（单选组 + 警告判定），而单选组的值经 `setAnalysisScopeNamed` → `analysisScope` → `src/workspaceInspection.ts:14/79-80` 消费；
  - `StandardAnalysisScope` 接口 / `namedScopeContains` 的标准兜底 → 同一条链。
- 顺带确认别人那两份现成通道没被我改成死代码：`src/scopeIdMapper.ts` 的消费方从 1 个变 2 个（`PackageDepsDialog.vue:32/78` + 本轮 `analysisScope.ts:35/402`）。

---

## 7. 做不到 / 无法核实（逐条给具体卡点）

1. **标签右键菜单的行序**：目标模板 `src/components/TabContextMenu.vue:68-70` 不在我的可写面（派单没写它）⇒ 只能交请求（W-3）。卡点很窄：一次三行顺序调换。
2. **`git.commit` 的 `paths`（13c R1）**：入参解析在保留文件 `native/main.cpp`（本轮实地确认 `:1169` 就是那个 `case`），native 侧拼旗标在 vcs 半区的 `native/git.cpp` ⇒ 两层都不在我名下 ⇒ 按派单只交请求（W-4）。上游那两个 `.kt` 我只确认了**文件存在与行数够**，`CommonCheckinFilesAction.kt:26-78` / `CheckinActionUtil.kt:100-160` 的**逐行语义本轮未复核**，已在 W-4 里注明"转述自 13c"。
3. **`src/blameAnnotations.ts` 的按修订缓存**：文件这轮在我名下，但**缓存键拿不到** —— 上游的键是 revision/区间（`CacheableAnnotationProvider`），本仓通道只有 `git.blame` 这类一次性结果，"某修订某文件内容"这条通道是 13b 第 4 条请求（要动 `native/git*.cpp` + `src/bridge.ts`）。在缺键的情况下加一层缓存只能按内容哈希伪造 ⇒ 不做假逻辑。
4. **标准范围的另外四档（Open Files / Current File / Recently Viewed / Recently Changed）**：判定要编辑器的打开表与历史表，而 `pathInAnalysisScope` 是同步求值、本模块发不了请求 ⇒ 交请求（W-5）。已把接口形状留成 `id + title + contains`，宿主把状态注进来即可加行。
5. **`.analysisignore` 的文件类型/高亮**：本仓要挂这个得动文件类型注册与高亮层（都不在我名下），且**行为上没有任何差别**（规则匹配已生效）⇒ 判 `[-]` 而不是"下一轮再说"。
6. **`UI_FLATTEN_PACKAGES` / `UI_SHOW_MODULES` / `UI_SHOW_MODULE_GROUPS` / `UI_COMPACT_EMPTY_MIDDLE_PACKAGES` / `SCOPE_TYPE`**：见 §2 那三行 `[-]` —— 前两个是形态不成立（本仓没有模块组、`showFiles` 已承担展开），第三、第四个本轮在 `platform` 全树 grep 只找到那份 settings 拷贝、找不到行为读点，第五个本仓的等价物已是 `DEPENDENCY_SCOPE_OPTIONS`。
7. **目录书签的 Folder 节点呈现**：要新增持久化字段（`native/settings_schema.cpp` 白名单在别人的面）+ 宿主给目录判定 ⇒ 本轮不动，判 `[ ]` 并给了上游坐标（`FileBookmarkImpl.kt:26-29` 那一支本轮**未逐行读**，坐标转引自 `docs/inventory/verdict-bookmarks.md`）。
8. **收工时的两条全仓红不算我域**：`npx vue-tsc -b --force` 剩 2 条（`src/workspaceDiagnostics.ts:168/175`，lsp 半区在途）；引用门剩 2 条（`docs/batch-2026-10-06-completion2.md`、`-welcome2.md` 里同一句假路径）。我域用窄项目 tsconfig 自证 0 错（下条）。
9. **无法核实项**：无（本轮所有 `[x]`/`[~]`/`[-]` 都有我实读过的坐标；两处转述已在第 2、7 条点名"未复核"）。

---

## 8. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-bookmarks.md`：W-1（问题面板四个控件）、W-2（项目打开即注入命名作用域表）、W-3（标签右键三行行序）、W-4（`git.commit` 可选 `paths`，宿主 `native/main.cpp:1169`）、W-5（标准范围剩下四档要宿主状态），末尾一节写了**不需要接**的（假控件理由）与**已可销账**的（13b 第 1 条的桩键红）。
