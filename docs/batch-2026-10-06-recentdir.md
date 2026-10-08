# batch-2026-10-06-recentdir —— Run Anything 执行上下文的最近目录缓存（项目级持久化）

> **收口指针（后续批次 recentdirclose，2026-10-06）**：本 lane 撞轮次上限时，实现里留了一处**未还原的反向验证注入**
> （`src/runAnythingRecentDirectories.ts` 的读出归一把「非数组」当损坏 `throw`，尾部还挂着读出侧 `.slice(0, 5)` 截断）
> ⇒ 判据 `tests/run-anything-recent-dir-cache.test.mjs` 当时 **7 tests / 0 pass / 7 fail**。下一批按上游撤掉注入
> （`RunAnythingChooseContextAction.kt:238` 读出整份列；条数上限只管 `:141-144` 入栈那一步）并补了
> 「运行时谁灌缓存 + 原生白名单登记」那条判据 ⇒ 现在 8/8 绿。
> **本文件正文一字未改**，但里面指向本仓文件的行号已漂移（映射表见 `docs/batch-2026-10-06-recentdirclose.md` §5）；
> 宿主面还剩 `docs/wiring-requests-2026-10-06-recentdirclose.md`。
>
> 另：本文件在收口批的一次脚本失误中被清空过（`io.open(p,'w')` 先求值、后续 `join` 抛异常 ⇒ 只剩 0 字节），
> 收口批按**同一会话内先前的完整读盘回显**逐字恢复（31 行）。它是未跟踪文件、`git` 里没有副本，
> 无法再做字节级比对 —— 此句为事故留痕，见 `docs/batch-2026-10-06-recentdirclose.md` §10。

lane：Run Anything「最近目录」缓存 + 模块描述核对。上游参考树 =
`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（仓内 `third_party/intellij-community` 是坏树，未使用）。
**所有坐标都是我自己 `find` / `grep` / `sed` 开文件核过的**；派单给的坐标有两条错（见 §6）。

## 0. 派单三条「核实」的结果（先说结论，包括派单自己写错的）

| 派单的说法 | 实际（逐条开过文件） | 处置 |
| --- | --- | --- |
| `RunAnythingDialog.vue` 文件头写「本仓没有最近目录缓存」 | **成立**：`src/components/RunAnythingDialog.vue:52-58`（改前）原写「本仓没有『最近目录』缓存…本仓没有对应的存储 ⇒ 不给」，并把 `recentDirectories: []`、`canBrowse: false` 钉死；`docs/batch-2026-10-06-runctx.md:49-50` 也把这两档判 `[-]`（理由「加设置键超出本 lane」） | 本批把设置键、缓存模块、浏览动作、弹层消费全接上 ⇒ 判词从 `[-]` 升 `[x]`，注释原地改写并留痕 |
| 上游 `RunAnythingContextRecentDirectoryCache.kt:26-29` 的 `State.paths`，随 `.idea/workspace.xml` 持久化 | **成立**：`:26-29` = `class State { @XCollection(elementName = "recentPaths") val paths: MutableList<String> }`；存储档在 `:13-14` = `@Service(Service.Level.PROJECT)` + `@State(... storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])`，宏在 `platform/projectModel-api/src/com/intellij/openapi/components/StoragePathMacros.java:25` | 等价落点 = 本仓项目级那一段（§1） |
| `UserHomeDirectoryUtil` 那族的 `~` 折叠 | **该类的名字在参考树里不存在**：`find . -name "UserHomeDirectoryUtil*"` = 0 命中、`grep -rn "UserHomeDirectoryUtil" .` = 0 命中；全树只有 `python/installer/src/com/intellij/python/community/impl/installer/CondaInstallManager.kt:76` 的安装参数字面量 `CurrentUserHomeDirectory` 含该子串。**无法核实**（按假类名登记）。真族 = `FileUtil.getLocationRelativeToUserHome`（`platform/util/src/com/intellij/openapi/util/io/FileUtil.java:1264-1282`） | 实现按真族核对，注释写明该坐标核过 |
| 入栈规则 `:139-147`、条数取注册表默认 5（`intellij.platform.ide.core.impl.xml:170-171`） | **成立**：`:139-147` = `if (recentDirectories.size >= Registry.intValue("run.anything.context.recent.directory.number")) { recentDirectories.removeAt(0) }; recentDirectories.add(path); selectedContext = RecentDirectoryContext(path)`；注册表 `platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171` `defaultValue="5"` | `src/runAnythingContext.ts` 的 `pushRecentDirectory` 就是这一条（本批给它第一个生产消费方） |
| `ModuleContext` 的 contentRoots 规则（恰好一个用那一个，否则退回 `getModuleDirPath`；相对路径空串合法不是「未定义」） | 前半句**成立**（`RunAnythingExecutingContext.kt:23-24`）。后半句**值钉错了**：内容根 == 项目根时上游给的不是空串而是 `.`（`platform/util-rt/src/com/intellij/openapi/util/io/FileUtilRt.java:404-405`），而 `getRelativePath` 算不出（没有公共前缀）时返回 **null**（同文件 `:418`）⇒ 那一档才是「未定义」 | 本批补 `moduleDescription(true, null)` ⇒ 未定义 这一支（`''` 那一条断言按本仓口径保留，理由写在测试注释里） |

## 1. 判词表（本批交付项）

| 族 / 项 | 判定 | 上游相对路径:行号 | 本仓落点 | 一句话说明 |
| --- | --- | --- | --- | --- |
| Run Anything · 最近目录**缓存本体** | `[x]` 本批新增 | `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextRecentDirectoryCache.kt:13-14`、`:26-29` | `src/runAnythingRecentDirectories.ts:36`（键名）、`:45`（状态）、`:87`（入栈） | 项目级一份 `string[]`，只有 `paths` 这一个字段，与上游 `State` 同形 |
| Run Anything · 缓存的**持久化落点** | `[x]` 本批新增 | 同上 `:14`（`Storage(StoragePathMacros.WORKSPACE_FILE)`）；宏定义 `platform/projectModel-api/src/com/intellij/openapi/components/StoragePathMacros.java:25` | `projects.json` → `perProject[项目根].runAnythingRecentPaths`；读 `native/projects.cpp:770-784`、写 `:820-844`（`merge_patch` ⇒ 只交这一个键不动别家） | 本仓「项目的 workspace 文件」那一段就是这一档：前例 `src/editorFoldingState.ts:86`（上游也在 workspace 文件里）与 `native/settings_schema.cpp:981-983` 的 runConfigs 注释 |
| Run Anything · **缺键补默认 / 不按键数判损坏** | `[x]` 本批新增（硬约束 ⑥） | 上游读出侧不截断也不判形状（`RunAnythingChooseContextAction.kt:238` 直接把 `state.paths` 整份列出来） | `src/runAnythingRecentDirectories.ts:49`（`normalizeRecentDirectories`）、`:59`（`importRunAnythingRecentDirectories`）；原生侧 `native/settings_schema.cpp:952` 加白名单、**不进** `:432-479` 的 `project_defaults()` | 老存档没这个键 / 值为 null / 非数组 / 混坏条目 / 条数比 5 多 ⇒ 全部合法，逐条丢坏条目，**任何形状都不抛错、不判损坏** |
| Run Anything · **入栈规则**（满了先摘最老的一条、条数 5） | `[x]` 已做（规则早就在，本批给它消费方） | `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingChooseContextAction.kt:139-147`；`platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171` | `src/runAnythingContext.ts:195-204`（`pushRecentDirectory`）← 被 `src/runAnythingRecentDirectories.ts:87` 消费 | 本批之前它只有单测消费（零生产链路）；现在「浏览目录…）」那一步真的走它 |
| Run Anything · **浏览目录…（写侧）** | `[x]` 本批新增（原判词 `[-]` 已翻转） | 同文件 `:132-150`（`createSingleFolderDescriptor` + `isForcedToUseIdeaFileChooser`、起始目录 `choose(project.guessProjectDir())` `:138`、记完设当前档 `:146`） | `src/components/RunAnythingDialog.vue:88-96`（`canBrowse`）、`:123-143`（`chooseContext`/`browseContextDirectory`） | 通道 = `dialog.pickDirectory`（`native/main.cpp:135-137` → `native/dialogs.cpp:100-118` 返回绝对路径或 null）；取消与失败都**什么都不记** |
| Run Anything · **最近目录档的渲染（读侧）** | `[x]` 本批新增 | `RunAnythingChooseContextAction.kt:238`、`RunAnythingExecutingContext.kt:31-32` | `src/runAnythingContext.ts:136-139`（`allRunAnythingContexts` 的最近目录一段）← `src/components/RunAnythingDialog.vue:79` 吃 `recentDirectoryPaths.value` | 缓存有值 ⇒ 表里真的多出那几档，次序在「浏览目录…」之后 |
| Run Anything · **标签的 `~` 折叠** | `[x]` 本批核对并**订正一个钉错的值** | `platform/util/src/com/intellij/openapi/util/io/FileUtil.java:1264-1282`（`:1273` 的 `isUnix \|\| !unixOnly`、`:1276` 的 `isAncestor(..., true)`、`:1277` 的 `'~' + File.separator + …`）；相等时判 `ThreeState.NO`：同文件 `:180-182`（注释 `:130`） | `src/runAnythingContext.ts:144-157`（`recentDirectoryLabel`） | 非 Unix 原样返回（本宿主只有 Windows 原生宿主：`CMakeLists.txt:4-6` 的 `NOT WIN32` 直接 FATAL）；家目录**本身**不折成 `~`（上游 strict 祖先判定不含相等），只有后代折成 `~/子路径` |
| Run Anything · `ModuleContext` 的 contentRoots 档 | `[-]` 本批不实现那一支（具体理由） | `RunAnythingExecutingContext.kt:23-24`；`.iml` 父目录 = `platform/projectModel-api/src/com/intellij/openapi/module/ModuleUtilCore.java:287-289` | `src/runAnythingContext.ts:217-238`（`gradleSubprojectRoots`） | 本仓模块来源是 Gradle 子工程树，**一个子工程恰好一个目录** ⇒ 恒走 `contentRoots.size == 1` 那一支；退回 `getModuleDirPath` 需要 `.iml`/`ModuleManager` 模型（本仓没有，`src/runAnythingContext.ts:49-51` 已写明）⇒ 没有可喂进那一支的输入，不造空壳 |
| Run Anything · 模块档**描述**的两条拿不到 | `[x]` 本批补（`null` ⇒ 未定义） | `RunAnythingExecutingContext.kt:22`（`guessProjectDir()?`）与 `:25` 的同一个 `?:`；null 的来源 `platform/util-rt/src/com/intellij/openapi/util/io/FileUtilRt.java:418`；相等时是 `.`：同文件 `:404-405` | `src/runAnythingContext.ts:86-104`（`moduleDescription`） | 项目根拿不到**或**相对路径算不出 ⇒ 未定义；算得出的（含本仓口径的空串）照原样 |
| Run Anything · 端到端**收端** | `[x]` 已做（早于本批，本批只核） | `RunAnythingContextUtils.kt:14-21`（`getPath()`）；`RunAnythingPopupUI.java:509-516`（把 `EXECUTING_CONTEXT` 交出去） | `src/components/RunAnythingDialog.vue:158-160`（`emit('runCommand', { command, cwd })`）→ `src/runActions.ts:491`（`runExternalTool(command, name, cwd?)`）→ `:515`（`cwd: cwd?.trim() \|\| workspace.value.root`）→ `native/run_host.cpp:203`（`step.cwd = value.value("cwd", …)`）→ `:257-264`（绝对路径原样用、相对按项目根解释） | 最近目录是**绝对路径**、模块根是**工作区相对**，`run_host.cpp:258-261` 那两支正好各自接住 ⇒ 不需要动保留文件 |
