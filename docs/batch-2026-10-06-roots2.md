# 批次报告 · 2026-10-06 · roots2（GradlePanel 任务激活收口 / 运行配置带 env 的模块侧 / 坐标订正）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下文「上游」都相对它，
每条坐标本轮亲手开文件数过行号；`docs/` 里别人写的坐标本轮也逐条重数，错的按「原写 X、实际 Y」留痕）。

## 0. 派单 ① 的现场核对（先 git status 再动手）

`git status --porcelain -- src/GradlePanel* src/gradle* src/components/GradlePanel.vue` ⇒
只有两条：`M src/components/GradlePanel.vue`、`M src/gradleHost.ts`（上一路 roots 代理的未跟踪新文件另在
`src/externalTaskSettings.ts`、`tests/ext-task-settings.test.mjs`、`tests/roots-file-index-config.test.mjs`、
`docs/batch-2026-10-06-roots.md`、`docs/wiring-requests-2026-10-06-roots.md`）。
`tests/gradle-*.test.mjs` 64 条**全绿**，红的是**别人的门禁**：`tests/file-chooser-activation-wiring.test.mjs:28`
「GradlePanel 挂上任务激活：状态持久化、动作矩阵、右键入口、任务 tooltip」——该文件不在我的可改测试面里
⇒ **只能改代码去满足它，不许动断言**。

根因（不是「落了一半」，是「落完又拆回去」）：上一路把「（已编辑）」后缀拼进了模板的 title 绑定，
写成 `:title="taskActivationTitle(task, build.directory) + taskEditedSuffix(build.directory, task.name)"`，
而门禁钉的是**带结尾引号**的字面量 `:title="taskActivationTitle(task, build.directory)"` ⇒ 第 37 行 `assert.match` 红。
两侧（激活阶段串、已编辑标记）都是有真消费链路的行为，**不适用「死代码直接删」**：
处理 = 把两段折进**同一个出口** `taskActivationTitle`（`src/components/GradlePanel.vue:118-127`），
模板回到门禁的形状。**门禁断言一字未放松**（仍是完整字面量 + 闭引号，没有改成 `includes`、没有降数字）。

同场另清掉一处真死码：`src/gradleHost.ts` 原 `export const GRADLE_SYNC_TASKS = 'projects tasks --all'`
全仓零消费方（`src`/`tests`/`native`/`docs` 都只命中它自己那一行），注释还指向**不存在的**
`src/gradleTaskActivations.ts`（真的那张表在 `src/externalSystemViewOptions.ts` 的 `gradleSyncTasks()`，
判据 `tests/external-system-actions.test.mjs:64-65`）⇒ 删除 + 留痕。

## 1. 判词表

| 族 | 项 | 判定 | 上游依据（相对路径:行号，本轮实读） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| es/activation | **任务 tooltip 的单一出口**（状态持久化 + 激活阶段 + 「已编辑」回声） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/ExternalSystemTaskActivator.java:74`（`getDescription(systemId, projectPath, taskName)`：有激活才给串）；阶段名语义 `ExternalSystemTaskActivator.java:375-382`（7 档 TaskPhase） | `src/components/GradlePanel.vue:118-127`（折好的 tooltip）、`:326`（模板绑定）、判据 `tests/ext-task-settings.test.mjs`「接线④」+ 现网门禁 `tests/file-chooser-activation-wiring.test.mjs:28-39` | 一个绑定同时回声「激活：…」与「（已编辑）」；拆回两处拼接就会被门禁钉红（本轮实测：注入坏形状 ⇒ 2 红） |
| es/execution | **「创建运行配置」带 VM 选项/env**（接线请求 R1 的模块侧） | `[x]` | `.../service/execution/ExternalSystemBeforeRunTask.java:38-45`（tasks / externalProjectPath / **vmOptions** / scriptParameters 全部随运行配置写进 XML）；bean `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java:33,39,40,43,94-99,102`；执行消费 `.../service/internal/ExternalSystemExecuteTaskTask.java:41-44,80-82` | `src/gradleHost.ts:72`（`addRunConfiguration(name, command, env?)`）、`:666-677`（喂 `taskRunEnvironment(settings, [])`）、判据 `tests/gradle-host.test.mjs`「存过的 VM 选项/env 随『创建运行配置』交出」+ `tests/ext-task-settings.test.mjs`「接线③」 | 通道在本面扩完：第三参只交**增量**（`GRADLE_OPTS=<VM 选项>` + 用户 env），不把解析出的 `JAVA_HOME` 冻进配置（上游 JDK 是执行时再解析的）；下游三段本轮实测已在（`src/runConfigurationSchema.ts:22,32,62` → `src/runActions.ts:96` → `native/run_host.cpp:207`，`native/runner.hpp:30-32` 写明 env 是**叠加**不是替换）⇒ 只差 `src/App.vue:1817` 收第三参，已另放请求 |
| 死码 | `GRADLE_SYNC_TASKS` 零消费导出 + 假文件指向 | `[x]` 删 | —— | `src/gradleHost.ts:77-80`（替换为指向真模块的注释） | 「任务串有常量默认值」是假的：每次现算 `gradleSyncTasks()`，面板开关决定带不带 `--all` |
| ic/file-types | **F1** 忽略清单灌进文件树/预览过滤链 | `[-]` 不在我面 | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFileCache.java:80-82`（按**名字**判，不是整路径）；`.../impl/FileTypeManagerImpl.java:1166-1167`（`isFileIgnored(String name)`） | 目标 `src/bridge.ts`、`src/bridgePreview.ts:51,85`（派单禁改 `bridge*`） | 判定函数本仓早有（`src/fileTypeIgnoredList.ts` 的 `isIgnoredName`/`isPathIgnored`，文件选择对话框那条已消费）；树/预览那侧的过滤点在保留文件里，我面里**没有任何**可替代的挂点（`native/workspace.cpp` 的 `list` 要能收模式串就得先动 `src/bridge.ts` 的入参形状 ⇒ 仍是保留文件）。本轮实测：除 `FileTypesPage.vue`/`main.ts` 外无人读 `ignoredPatterns()` |
| ic/file-types | **F2** 同一张清单并进工程搜索 exclude | `[-]` 不在我面 | `IgnoredFileCache.java:80-82` + `platform/platform-impl/resources/messages/FileTypesBundle.properties:58-61`（「不可见**且不被索引**」） | 目标 `src/searchExclusions.ts`、`src/components/SearchPanel.vue:36,50`（派单没写 ⇒ 只读） | 折算规则（`*.pyc` → `**/*.pyc`、`.git` → `**/.git/**`）与合并点（只在一处合、`native/search.cpp:46-49` 那张硬编码表当兜底）请求原文已写清，本面没有可落的代码 |
| lp/exclude | **F3** 文件树右键「覆盖文件类型」挂点 | `[-]` 不在我面 | `platform/lang-impl/src/com/intellij/openapi/file/exclude/OverrideFileTypeAction.java:53-76`（列表按显示名大小写不敏感排序、`isAvailableForOverride` 过滤在 `:62`、重名拼「来自插件 X」在 `:64-72`） | 目标 `src/components/EditorPopupMenu.vue` / `src/App.vue`（都不在我面） | 模型侧齐的（`src/fileTypeOverrides.ts` 的 `overridableFileTypes`/`fileTypeOverrideRows`/`changeFileTypeOverride`/`revertFileType` 都在，且 `FileTypesPage.vue:32,343-344` 已消费）⇒ 纯挂点缺失，不是缺实现 |
| pf/vfs | **F4** 「文件信息」的宿主 stat 通道 | `[-]` 不在我面 | 查询面 `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:610`（`getLength()`）与 `:224`（`isWritable()`）；**动作本体无法核实**：本地树 `find -name 'VirtualFileInfoAction*'` 零命中 | 目标 `src/bridge.ts` 的 `Method` 联合 + `native/main.cpp` switch（都是保留文件） | `src/bridge.ts:109` 那整条 `Method` 本轮重数过，没有任何一条回 size/mtime；`file.read` 只回 `{content, version, encoding, bom, readOnly}`。`native/workspace.cpp` 在我面，但**没有 Method 名与挂点就先加 handler = 造不可达死码**（§3「不放假控件」）⇒ 不开工，等证据 |
| ic/file-types | **F5** 忽略清单/覆盖表进宿主设置 | `[-]` 决策请求，本轮不开具体代码 | 应用级 `filetypes.xml` 组件状态；工程级 `platform/lang-impl/src/com/intellij/openapi/file/exclude/PersistentFileSetManager.java:104-118`（`<file url value/>`） | 目标 `native/settings_schema.cpp`（禁改） | 两份现在都落 localStorage（`src/fileTypeIgnoredList.ts`、`src/fileTypeOverrides.ts` 头注写明先例与理由）。要落宿主得先定作用域（覆盖表按上游是**工程级**，本仓现在是全局一份），并按「旧存档缺键补默认」补判据 ⇒ 属主代理统筹 |
| bucket15 W2/W3 | roots.md 的 R2 | `[-]` **已落，本条作废** | —— | `native/settings_schema.cpp:248-258` + `native/settings_transfer_test.cpp:183`；`src/main.ts:6` import `loadIgnoredPatterns` | 本轮直接 grep 两个保留文件的现树内容核到：外部工具白名单已按上游 bean 放开并有判据，忽略清单已在启动时灌（且只调一次，`fileTypeIgnoredList.ts` 自己 apply）。已在请求文档里改成作废 + 留痕 |
| 「K 系列」 | 派单点名的 K 系列条目 | `[-]` **仓里找不到** | —— | —— | 搜索方式全给了：`grep -rn "K1" docs`（只命中 `docs/handoff-java-lsp-2026-09-28.md:85` 的 `<JDK17>` 字样）、`grep -rnoE "\bK[0-9]+[a-z]?\b" docs`、`grep -rn "K 系列\|K系列"` ⇒ 零命中。两份被点名的文档里编号只有 **R1/R2**（roots）与 **F1-F5 + W1-W3 状态段**（filetypes）。不猜、不编一批 K 出来 |

**顺带核到的上游坐标（本轮实读、全部指得到）**：`.../service/execution/ExternalSystemEditTaskDialog.java:25-37`
（构造 + 标题 `tasks.edit.task.title`）与 `:60-64`（`doOKAction` → `myControl.apply`）；
`ExternalSystemTaskSettingsControl.java:66-103`（fillUi 五栏，`EnvironmentVariablesComponent` 在 `:98`）、
`:105-127`（reset 回填）、`:145-155`（apply，`ParametersListUtil.parse` 在 `:149`）、`:86`（`TaskCompletionProvider`）；
`ExternalSystemBundle.properties:37,110-113,134`；`ExternalSystemBeforeRunTaskProvider.java:59-60`；
`ExternalSystemTasksTree.java:181-192`（同 (系统 id, 工程路径) 复用上次 vmOptions/scriptParameters 的键在 `:183`）；
`AutoImportProjectTracker.kt:89-96,137-142,157-171,267-275,549,551`；
`platform/projectModel-api/src/com/intellij/openapi/roots/OrderEntry.java:54-60`；
`ProjectJdkTable.java:40-90`、`ProjectJdkImpl.java:49-51,220-225`；
`platform/core-api/src/com/intellij/openapi/fileTypes/FileTypeRegistry.java:156,157,168,176-178`；
`FileTypeBean.java:144`；`FileType.java:63`；`NativeFileType.java:48-51`；`UserBinaryFileType.java:16-19`；
`FileTypeManagerImpl.java:263-273,644-649,916-923,925-934,950-956`；`FileUtil.java:1300-1310`；
`HashBangFileTypeDetector.kt:15-29`（`:28` = 256）；`ReparseUtil.kt:11-17`；
`FileTypeDetectionService.java:338-340,401`；`UserFileTypeOverrider.java:17-24`；
`PersistentFileSetManager.java:90-96`；`platform/execution-process-mediator/common/gradlew:168,202`、`gradlew.bat:36`。

## 2. 派单 ③：`source-citations` 的现场与订正

起手实测：`node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` ⇒ **11 / 11 / 0 红**
（仓里 2062 条活引用全过；锚点快照 1627 条、未入快照 435 条、区间为空 3 条——`empty` 不拦、也不是我面）。
⇒ 派单点名的「若红」不成立，**但**按「把坐标订正到能指到」的要求，我把那两个文件（外加我面上被它们指着的代码注释）
逐条重数，**查出 4 处真错**并订正（都是「行号落在别的方法上/把上一个方法的收尾算进来」这一类，门禁的
`行号 ≤ 文件长度`拦不住，锚点又没入快照）：

| 位置 | 原写 | 实际（本轮实读） | 处理 |
|---|---|---|---|
| `docs/batch-2026-10-06-roots.md` §1 行 1（上游列） | `ExternalSystemTaskSettingsControl.java:66-103,105-127,143-152` | 该文件 177 行：`apply` 签名在 `:146`、方法尾在 `:155`；`:143` 是**上一个**方法 `isModified` 的收尾花括号 | 改成 `:66-103,105-127,145-155` + 留痕 |
| `src/externalTaskSettings.ts` 头注（同一件事的本仓源头） | 「apply `:143-152`」「parse 在 `:147`」「VM `:148` / 参数 `:149` / env `:150-151`」 | `apply :145-155`；`ParametersListUtil.parse :149`；VM 原文 `:151`、脚本参数 `:152`、passParentEnvs `:153`、env 表 `:154` | 整段按实数重写 + 留痕（`src/components/GradlePanel.vue:30,144-145` 两处同口径跟着改） |
| `docs/batch-2026-10-06-roots.md` §1 最后一行 | `OrderEntry.java:60-66`，并称「`:60` 注释「valid 不等于每个根都 valid」」 | 该文件 78 行：javadoc 在 `:54-59`（那句在 `:55-56`）、`isValid()` 声明在 `:60`；`:61-66` 是下一个方法 `getOwnerModule` 的注释 | 改成 `:54-60` + 留痕 |
| `docs/batch-2026-10-06-roots.md` §1 行 1 / §2 的本仓落点列 | `GradlePanel.vue:115-152,227,350-372`、`gradleHost.ts:645-663`、`:664-670`、`externalTaskSettings.ts` 227 行 | 现树：`GradlePanel.vue:129-161,233,358-375`、`gradleHost.ts:646-665`、`:666-677`、`externalTaskSettings.ts` 230 行 | 按现树重数 + 留痕（本轮 tooltip 折叠与运行配置带 env 两步确实把行号推后了） |

`src/fileTypeDetection.ts` 的 7 条**全路径**引用逐条开上游核过，**全部指得到**（`FileTypeRegistry.java:156` 是嵌套接口
`FileTypeDetector`、`FileTypeBean.java:144` 是 `hashBangs` 属性、`FileType.java:63` 是 `isBinary()`、
`NativeFileType.java:48-51` 与 `UserBinaryFileType.java:16-19` 是恒真实现、`FileTypeManagerImpl.java:925-934` 是
`getFileTypeByFile` 里「按名字没认出来才跑内容探测」那段、`FileUtil.java:1300-1310` 是 `isHashBangLine`）；
它的短形引用（`ReparseUtil.kt:11-17`、`FileTypeDetectionService.java:338-340,401`、
`UserFileTypeOverrider.java:17-24`、`HashBangFileTypeDetector.kt:15-29`）也都重数过、行号对得上，
**只有目录和我一开始的猜测不同**（`UserFileTypeOverrider`/`OverrideFileTypeAction` 在 `platform/lang-impl/…/file/exclude/`，
`HashBangFileTypeDetector`/`ReparseUtil`/`FileTypeDetectionService` 在 `platform/platform-impl/…/fileTypes/impl/`）
—— 文档里写的是短形，不构成错。⇒ 该文件本轮**未改**（无需订正）。

## 3. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 性质 |
|---|---:|---:|---|
| `src/components/GradlePanel.vue` | 413 | 419 | 改：tooltip 折成单一出口（激活串 + 已编辑）、模板回到门禁形状、头注 2 处坐标订正 |
| `src/gradleHost.ts` | 839 | 846 | 改：`GradleHostDeps.addRunConfiguration` 扩第三参、`saveTaskAsRunConfig` 喂增量 env、删零消费导出 `GRADLE_SYNC_TASKS` |
| `src/externalTaskSettings.ts` | 227 | 230 | 改：头注 apply 段坐标按实数订正（带留痕），逻辑一字未动 |
| `tests/ext-task-settings.test.mjs` | 129 | 147 | 改：接线③加两条（第三参签名 + 喂法）、新增接线④（tooltip 单一出口，含 title 绑定的 `assert.equal`） |
| `tests/gradle-host.test.mjs` | 293 | 322 | 改：新增 1 条**行为**判据（保存为运行配置交出 `['GRADLE_OPTS=…','TOKEN=secret']`、不含 `JAVA_HOME`、没存过时第三参是 `undefined`） |
| `docs/batch-2026-10-06-roots.md` | 96 | 96 | 改：4 处坐标订正（原地、带「原写 X、实际 Y」） |
| `docs/wiring-requests-2026-10-06-roots.md` | 37 | 44 | 改：R1 改成「模块侧已落完、只剩 App.vue 一行」（并订正原请求里「env 折成对象」的形状）、R2 改成作废 |
| `docs/batch-2026-10-06-roots2.md` | —— | 本文件 | 新（交付报告） |
| `docs/wiring-requests-2026-10-06-roots2.md` | —— | 56 | 新（一条：App.vue 的回调收第三参） |

`native/` 一行没动（本轮只**读** `native/run_host.cpp:207`、`native/runner.hpp:30-32`、`native/settings_schema.cpp:248-258`、
`native/settings_transfer_test.cpp:183` 取证）⇒ 无 ctest 义务。

## 4. §5 自查前后数字

| 判据 | 前（起手实测） | 后（收工实测） |
|---|---|---|
| `npx vue-tsc -b --force` | **0 错**（起手实测） | **6 条，全在非我面**：`src/App.vue(2019,43)`、`src/App.vue(2073,23)`、`src/bookmarkActions.ts(146,25)`、`src/components/ToolStripe.vue(92,68)`、`src/toolWindowStripes.ts(694,29)`、`src/toolWindowStripes.ts(695,60)`；**我面 0 条**（工具窗口/书签那条并行线在途；期间还抓到过 `src/structuralCodeBlock.ts` 的 TS1005/TS1127 一片语法错，同样非我面、其作者随后自修）。见 §7.1 |
| `node --test tests/ext-* tests/roots-* tests/library-* tests/gradle-* tests/fileType-* tests/file-type-* tests/file-template-* tests/macro* tests/template* tests/templates-* tests/order-roots tests/project-roots tests/external* tests/project-file-index tests/module-scopes tests/filename-widget tests/file-chooser-activation-wiring` | 本轮第一次采样的直接证据：派单点名的 `tests/file-chooser-activation-wiring.test.mjs` **4 / 3 / 1 红**（红的就是「GradlePanel 挂上任务激活…」那条），同场 `tests/gradle-*.test.mjs` **64 / 64 / 0**（⇒ 我域内 gradle 测试当时已全绿，红只在别人的门禁文件里） | **420 / 420 / 0 红**（420 = 同一份文件清单收工复跑；其中 +2 是本轮新增的两条判据：`gradle-host` 的行为判据、`ext-task-settings` 的接线④） |
| `node --test tests/module-size.test.mjs` | 5 / 5 / 0 | **5 / 5 / 0**；上限一字未动（ts/vue 900 / native 1100 / `_test.cpp` 1300 / `main.cpp` 2000），我面最大值 `gradleHost.ts` 846、`GradlePanel.vue` 419 |
| `node .tools/find-param-props.mjs` | 0 处 | **0 处** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净** |
| `node .tools/find-missing-ext.mjs` | 1268 文件，干净 | **1273 文件，干净** |
| `node .tools/find-orphan-modules.mjs --gate` | 未单跑（起手直接跑的是域测试） | **绿：已登记孤儿 9 / 基线 9 · 新增 0 · 本轮清掉 0**（中途那次「新增 1 = `src/structuralCodeBlock.ts`」非我面、收工时已被其作者接上） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 / 0（快照 1627 / 活引用 2062 / 未入快照 435 / 区间为空 3） | **11 / 9 / 2 红**（同一条断言在两个测试文件里各报一次；合并跑是 16/14/2）： offending 引用**只有 2 条、都不在我面**——`docs/batch-2026-10-06-completion2.md` 与 `docs/batch-2026-10-06-welcome2.md` 里那条 `SuppressIntentionAction` 引用把 analysis-api 的包目录少写了一层（真路径见 §7.7，行号本身全对）。我这两份新文档里每一条全路径引用（含本轮新写的 `ExternalSystemTaskActivator.java:74`、`OrderEntry.java:54-60`、`VirtualFile.java:610,224`、`ExternalSystemBeforeRunTask.java:38-45` 等）**全过**；活引用数 2062 → 2182（我 + 并行线新增），订正没减一条可核引用。见 §7.7 |
| 域内单文件复跑 | `gradle.test.mjs` 64/64、`gradle-host.test.mjs` 12/12、`gradle-events.test.mjs` 全绿 | `gradle.test.mjs` 64/64、`gradle-host.test.mjs` **13/13**、`ext-task-settings.test.mjs` **11/11**、`file-chooser-activation-wiring.test.mjs` **4/4** |

## 5. 反向验证记录（注入 → 红 → 撤 → 绿，三档都记）

**注入 A（把运行配置的 env 通道摘掉）**：`src/gradleHost.ts:675-676` 改回两参调用
`deps.addRunConfiguration(taskRunName(task, directory), composeTaskRunCommand(command, settings, task))`。
⇒ `node --test tests/ext-task-settings.test.mjs tests/gradle-host.test.mjs` = **24 / 22 / 2 红**
（`✖ 接线③：runTask/saveTaskAsRunConfig 消费存过的设置；env 走原生通道`、
`✖ 存过的 VM 选项/env 随「创建运行配置」交出`）。撤掉后 = **24 / 24 / 0**。

**A′（灵敏度对照，同一条注入更狠的形状）**：把判据条件写成 `settings && false && taskNeedsEnvironment(settings)`
（保留 `taskRunEnvironment(settings, [])` 的字面量）。⇒ **24 / 23 / 1 红**：只有**行为**判据红，字符串锚点看不见。
⇒ 结论写进报告：`tests/gradle-host.test.mjs` 那条是读 `calls` 里真参数的行为断言（`assert.deepEqual(config[3], ['GRADLE_OPTS=-Xmx2g', 'TOKEN=secret'])`），
接线③的 `assert.match` 只是形状闸。撤掉后复绿。

**注入 B（把 title 绑定拆回两处拼接，就是本轮接手时那个坏形状）**：
`:title="taskActivationTitle(task, build.directory) + taskEditedSuffix(build.directory, task.name)"`。
⇒ `node --test tests/ext-task-settings.test.mjs tests/file-chooser-activation-wiring.test.mjs` =
**15 / 13 / 2 红**（`✖ 接线④`、`✖ GradlePanel 挂上任务激活…`——即现网那条门禁自己也会被撞红，
说明新加的接线④和门禁同灵敏度）。撤掉后 = **15 / 15 / 0**，再复跑整套域测试 **420 / 420 / 0**。

**C（删死码的反向确认）**：`GRADLE_SYNC_TASKS` 删前 `grep -rn` 全仓只命中定义行自己（含 `docs`）；删后
域测试 420/420、`find-orphan-modules --gate` 绿 ⇒ 没有东西在用它。

## 6. 零消费方自查

- **本轮没有新建 `src/` 或 `native/` 模块**（只新建两份 `docs/`，门禁不扫 docs 的消费方）。
- 唯一新增的**导出形状**是 `GradleHostDeps.addRunConfiguration` 的可选第三参：消费链上游是
  `src/gradleHost.ts:675-676`（真调），下游三段本轮实测**已在**（`src/runConfigurationSchema.ts:22,32,62`、
  `src/runActions.ts:96`、`native/run_host.cpp:207`），断点只有 `src/App.vue:1817` 那一行的形参表——
  这是「保留文件差一行」不是「造了个没人接的模块」，已按 §7 单放请求钉住。
- 新增判据都有真被测对象：接线④读 `src/components/GradlePanel.vue` 现树、
  行为判据跑 `src/gradleHost.ts` 的 `saveTaskAsRunConfig`（走 `tests/gradle-host.test.mjs` 的 require 装载表，
  未登记新映射——第三参只是既有 `externalTaskSettings.ts` 的用法）。
- `node .tools/find-orphan-modules.mjs --gate`：**绿**（登记 9 / 基线 9 / 新增 0）。

## 7. 做不到 / 无法核实（具体卡在哪一环）

1. **`vue-tsc` 现网 6 条错我收不了**：文件是 `src/App.vue`（禁改）、`src/bookmarkActions.ts`、
   `src/components/ToolStripe.vue`、`src/toolWindowStripes.ts`（派单没写 ⇒ 只读）。错内容是工具窗口 id 联合类型
   `string[]` 与 `"todo"|"debug"|"gradle"|…` 的收窄、以及 `bookmarkActions.ts:146` 引用了不存在的
   `bookmarkSelectionDescription`。起手基线是 0 错，本轮我的 3 次采样里错误条目**没有一条落在我面上**，
   但也**不是我能让它绿的**——按 §2 归属交给工具窗口/书签那条线与主代理。
2. **「K 系列」条目不存在**（搜索方式见 §1 最后一行；不猜编号、不编造条目）。
3. **F1-F5 一条都不能在我面落地**：目标文件逐个实测是 `src/bridge.ts`、`src/bridgePreview.ts`、
   `src/searchExclusions.ts`、`src/components/SearchPanel.vue`、`src/components/EditorPopupMenu.vue`、
   `src/App.vue`、`native/main.cpp`、`native/settings_schema.cpp` —— 派单要么明确禁改、要么没写（= 只读）。
   我面里没有可替代挂点（F1 若硬做要在 `native/workspace.cpp` 加一个前端永远不会传的参数 = 假通道，违反 §3）。
4. **「（已编辑）」这个后缀找不到上游对应物**：本轮在上游 `ExternalSystemTasksTree.java`（205 行）、
   `ExternalSystemNode.java`、`ExternalSystemNodeDescriptor.java` 里搜 renderer / tooltip / presentable 一类
   都没命中「给配置过的任务加尾标」的实现 ⇒ 它是 roots 上一批自加的真状态回声（反映 localStorage 里确实存过
   非默认设置），**文案非上游**。我保留（拆了会把已有行为删掉、且门禁形状仍要求 tooltip 单出口），
   但按「上游没有的中文不要编」登记给主代理裁决。
5. **R1 的最后一寸（`src/App.vue:1817`）**不能由我落；`docs/wiring-requests-2026-10-06-roots2.md` 给了可照抄整段
   与三处实测证据。
6. **宿主 env 语义只核到「叠加」**：`native/runner.hpp:30-32` 写 "applied on top of the inherited"，
   我没跑真机（不启动图形界面、不花外部调用），所以「保存的运行配置带 env 后启动是否真生效」= 代码级核实，
   不是运行级取证。
7. **引用门现网这两条红我不能替它们改**（非我面、是并行线刚落的在途文档，同一条错误抄了两次）：
   `docs/batch-2026-10-06-completion2.md` 与 `docs/batch-2026-10-06-welcome2.md` 里那条
   `SuppressIntentionAction` 引用把 analysis-api 下的包目录少写了一层——
   它们写的是 analysis-api 里 `com/intellij/codeInsight/` 那一版，本轮 Glob 实测真路径是
   **`platform/analysis-api/src/com/intellij/codeInspection/SuppressIntentionAction.java`**
   （包名 `codeInspection`，不是 `codeInsight`；文件 99 行，`:19` = `public abstract class SuppressIntentionAction implements Iconable, IntentionAction {`、
   `:29` = `getText()`、`:44` = `return getText()` ⇒ **行号全对，只有目录错**；
   completion2 第 48 行与第 128 行还用「基准树里只有抽象基类」的口径转述了同一个形状——按 §5 的提醒，
   转述别带完整路径＋行号，否则门禁会把它当真引用收）。⇒ 两处各改一个目录名就绿，
   请其作者或主代理落；我这条域的红与它们无关（我两份文档里的全路径引用逐条过）。

## 8. 需要主代理接的线

单放 `docs/wiring-requests-2026-10-06-roots2.md`（只有一条：App.vue 的 `addRunConfiguration` 收第三参）。
原 `docs/wiring-requests-2026-10-06-roots.md` 已按现状改写：R1 = 模块侧已落完、只剩那一行；R2 = 作废（两条都已落地）。
