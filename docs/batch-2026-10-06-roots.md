# 批次报告 · 2026-10-06 · roots（桶 15 续派：根与 SDK / 外部系统 / 序根 / 文件索引）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下文「上游」都相对它）。
本报告覆盖三条任务：①bucket15 接线请求里目标在我名下的条目；②`docs/inventory/verdict-platform_rest.md`
的 `lp/roots`/`pm/roots`/`pm/file-index`/`an/module`/`pf/roots-ui`/`es/*`/`esa/*` 中不需要 PSI、按用户可见行为可做的缺项；
③序根有效性判据红点复核。

## 0. 任务 1 的判定：bucket15 接线请求 —— 我名下没有可做项（逐条核过）

| 条目 | 目标文件 | 判定 | 理由 |
|---|---|---|---|
| W1 | `src/App.vue` | 跳过 | 派单明确「App.vue 的新建文件模板对话框跳过」 |
| W2 | `native/settings_schema.cpp:262-271` | `[-]` 不在我名下 | `native/settings_schema.*` 是保留文件（派单禁改）；且该请求的**前端侧不需要改动**（`src/externalToolsRecords.ts` 已在读放开后的键，请求文档 `:146` 自己写明），我这边零动作 |
| W3 | `src/main.ts:23` | `[-]` 不在我名下 | `src/main.ts` 不在派单的可改面里（属主代理/其他代理）；前端库文件本身（`fileTypeIgnoredList.ts`）早已存在，缺的只是挂载时机 |

## 1. 判词表（本轮亲手落的三块 + 复核到的既有状态）

| 族 | 项 | 判定 | 上游依据（相对路径:行号，本轮亲手数过） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| es/execution | **任务编辑对话框**（判词：「`ExternalSystemEditTaskDialog` 的任务名/VM 参数/脚本参数/env 编辑面 —— 这些字段没有输入口」） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemEditTaskDialog.java:25-37,60-64`；字段面 `ExternalSystemTaskSettingsControl.java:66-103,105-127,145-155`（roots2 订正：原写 `143-152`，实测该文件 177 行、`apply` 签名在 `:146`、方法尾在 `:155`，`:143` 是上一个方法 `isModified` 的收尾花括号；`ParametersListUtil.parse` 在 `:149` 不是 `:147`）；标签 `platform/external-system-api/resources/messages/ExternalSystemBundle.properties:37,110-113,134`；入口 `ExternalSystemBeforeRunTaskProvider.java:59-60`；字段本体 `ExternalSystemTaskExecutionSettings.java:33,39,40,43,94-99,102`；执行消费 `ExternalSystemExecuteTaskTask.java:41-44,80-82`；复用口径 `ExternalSystemTasksTree.java:183-190`；`GRADLE_OPTS` = `platform/execution-process-mediator/common/gradlew:168,202`、`gradlew.bat:36` | `src/externalTaskSettings.ts`（新，230 行）；矩阵行 `src/externalSystemActions.ts:86`；对话框 `src/components/GradlePanel.vue:129-161,233,358-375`；执行消费 `src/gradleHost.ts:646-665`（runTask 折命令/env 通道分流）、`:666-677`（saveTaskAsRunConfig 折命令 + roots2 新交的 env 第三参）（roots2 订正：本仓这几处行号按现树重数，原写 `GradlePanel.vue:115-152,227,350-372` 与 `gradleHost.ts:645-663`/`:664-670` —— 任务 tooltip 折进激活串与运行配置带 env 那两步把它们推后了） | 任务右键「编辑任务…」开本仓等价对话框（Gradle 项目/任务/VM 选项/参数/环境变量五栏，标题与标签直译上游 properties）；保存按工作区根 + 构建目录 + 任务名落 localStorage；「运行」把任务名与参数折进命令，VM 选项/env 走**带环境的原生 Gradle 通道**（`native/gradle.cpp` 的 env 叠加），输出与进度沿用 Gradle 通道既有的事件流 |
| es/autoimport ⑤ | `ExternalSystemAutoImportAwareListener` 的**长操作计数接线**（判词：「模型已有 operationStarted/operationCompleted，gradleHost 未调用」） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/autoimport/AutoImportProjectTracker.kt:267-275`（isOperationInProgress 的门）；攒脏/补齐语义在既有 `src/externalSystemAutoImport.ts`（settingsFileChanged 的 `operations>0` 分支 `:343-348`、operationCompleted 补齐 `:397-408`） | `src/gradleHost.ts:455-458`（execute 开头 `longOperation` + operationStarted）、`:531`（finally 里 operationCompleted） | 依赖加载与带 env 的任务执行这两类长执行期间，构建脚本改动只攒脏不当场决策，跑完按当时的档位补齐「重载/出通知」 |
| esa/autoimport ④ | **`smartProjectReloadDelay` 的合并窗**（判词：「本仓 UI 改动即走判据，没有排队合并」） | `[x]` | `AutoImportProjectTracker.kt:89-96`（`MergingUpdateQueue`，跨度 300ms）、`:549,551`（300ms / 3s 两个默认值）、`:157-170`（`scheduleDelayedProjectReload`：`effectiveDispatchIterations = max(delay/span − 1, 1)` ⇒ 2700ms）、`:137-142`（`scheduleProjectRefresh` 显式不等延迟）、`:171-196`（`PriorityEatUpdate`：显式把待着的延迟重载吃掉） | `src/externalSystemAutoImport.ts:486-558`（常量 300/3000、`effectiveReloadDelayMs`、`createAutoReloadWindow`）；`src/gradleHost.ts:286-291`（开窗）、`:325-329`（aware 的 `reloadProject` 按 `isExplicitReload` 分流：显式直排、自动进窗）、`:578-582`（`sync()` 里 `eatPending`）、`:759-772`（`onBuildFilesChanged` 的自动重载不再当场 `await sync`，VCS 批量补排同窗）、`:800`（换工作区 `dispose`） | 「保存一下构建脚本就连着弹三次重载」没了：窗内多次改动并成一次延迟重载（2.7s），点「同步更改」/同步按钮仍然当场生效并把待着的窗吃掉 |
| pm/file-index ② | **`getSourceRootForFile` 拿不到配置就退约定**（判词：「配置的源根只有 `ProjectStructurePane.vue` 手上有」） | `[x]` | 上游每次查询现场读根模型（`platform/projectModel-api/src/com/intellij/openapi/projectRootDescriptors/...` 一族的 `ModuleRootManager.getSourceRoots` 语义；本仓对照写在 `src/projectFileIndex.ts` 模块头） | 进程表 `src/projectFileIndex.ts:110-133`（`setConfiguredSourceRoots`/`getConfiguredSourceRoots`，`sourceRootFor` 优先级=显式 > 进程表 > 约定）；写者 `src/gradleHost.ts:32,134-136`（watch `projectSettings.java.sourcePaths`） | 标签右键「来自源根的路径」现在按**配置的源根**算（自定义根如 `app/code` 不再被目录约定顶掉），设置没到手时才落约定代偿；消费方（`TabContextMenu.vue`，非我名下）一行没改 |
| lp/roots · pm/roots | ① SDK 表（`ProjectJdkImpl`/`ProjectJdkTable`） | `[x]`（判词过期，订正沿用桶 15 报告 #2） | `platform/projectModel-api/src/com/intellij/openapi/projectRoots/ProjectJdkTable.java:40-90`；`platform/projectModel-impl/src/com/intellij/openapi/projectRoots/impl/ProjectJdkImpl.java:49-51,220-225` | `src/rootsSdkTable.ts`（220 行）；消费 `src/components/ProjectStructurePane.vue`、`src/workspaceLifecycle.ts`、`src/externalLibraries.ts`、`src/rootsModel.ts`；判据 `tests/roots-sdk-table.test.mjs`（本轮复跑 13 条全绿） | SDK 表（增删改查 + 版本比较 + 按家目录寻址）已在，判词 ① 的「没有 SDK 对象」不成立；本轮无重复施工 |
| lp/roots · pm/roots | ② `JavadocOrderRootType`/`AnnotationOrderRootType`/`JavaSyntheticLibrary` 的按类型贡献 | `[~]` | `platform/projectModel-impl/src/com/intellij/openapi/roots/JavadocOrderRootType.java:9`、`platform/projectModel-impl/src/com/intellij/openapi/roots/AnnotationOrderRootType.java:9`（族本体；**citefix 订正**：原写 `platform/projectModel-api/src/com/intellij/openapi/projectRootDescriptors/impl/JavadocOrderRootType.java` 参考树里没有该路径，两个类分别 38 / 71 行、第 9 行逐字是 `public class JavadocOrderRootType extends PersistentOrderRootType` / `public class AnnotationOrderRootType extends PersistentOrderRootType`；`projectRootDescriptors/impl` 那层包名是编的）；`ExternalSystem…` 无关 | `src/orderRoots.ts:20`（四类根类型已入枚举）、`:68-75`（javadoc 可枚举、annotations 无贡献者） | javadoc 根可被枚举（`LibraryRootSet.javadoc`，数据源=库识别的三档根，`src/libraryRootDetection.ts` 已落）；**annotations 档没数据源**：上游的外部注解 jar 是 java 插件发行件里的文件（IDEA 安装目录），不在用户的 JDK home 里，`native/jdk.cpp` 探不到 ⇒ 本仓不做（不放假表）；具体卡点=「发行物缺席」，登记在 §6.3 |
| an/module | ② `ModuleScopeProviderFactoryImpl` 的按模块工厂与 `ModuleWithDependenciesScopeCache` | `[-]` 架构性 | `platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes/factories/ModuleScopeProviderFactoryImpl.java`（族本体） | `src/moduleScopes.ts`（作用域对象与 `tests/module-scopes.test.mjs` 在册） | 本仓单隐式模块，「按模块的工厂 + 按 (module, options) 的缓存」只剩一个键；`OrderRootsCache` 形态的按修改计数作废已在 `src/orderRoots.ts:125-144` 落了等价物 —— 给单模块再造一层缓存没有用户可见差 |
| pf/roots-ui | 排除/作用域的颜色与图标完整呈现 | `[-]` 沿用桶 15 §6.7 | `platform/platform-impl/src/com/intellij/openapi/roots/ui/FileAppearanceServiceImpl.java`（78 行，本体已在 `src/rootAppearance.ts`） | —— | 颜色通道是样式表（`src/style.css` 保留文件），呈现服务只给语义种类；不属我面 |
| es/actions | AFTER_COMPILE/AFTER_REBUILD 触发点 | `[~]`（本批无动作） | `ExternalSystemTaskActivator.java:375-382`（7 档） | `src/externalSystemAfterBuild.ts`（68 行）← 消费 `src/runActions.ts` | 触发点已在上一批落（runActions 消费同一张激活表）；runActions.ts 不在我名下，本轮只核了消费链存在 |
| es/ui / es/project-model / esa/model / es/dependency | 面板/模型/存储/分析器 | `[x]`/`[~]`（无新增） | 见判词行 107/109/126/226 的坐标 | 上一轮已落（`externalSystemModel.ts`/`externalSystemDataStorage.ts`/`externalSystemNameGenerator.ts`/`externalTasksActivation.ts`/`DependencyAnalyzerDialog.vue` 等），本轮**复核消费链在**（grep 每个模块都有非测试消费方）后不重做 | 判词里这些族的「缺」多数已被上一批闭环，本轮只补了 §1 前三行 |
| 序根有效性判据（任务 3） | `OrderEntry.java:60`：空库无效、未构建输出不报无效 | `[x]` 现已绿 | `platform/projectModel-api/src/com/intellij/openapi/roots/OrderEntry.java:54-60`（该文件 78 行：javadoc `:54-59`、`isValid()` 声明 `:60`。**roots2 订正**：原写 `:60-66` 并称「`:60` 的注释」—— 实测 `:60` 是声明本身，那句「valid 不等于每个根都 valid」在 `:55-56`，`:61-66` 是下一个方法 `getOwnerModule` 的注释） | 判据 `tests/roots-model.test.mjs:72-86`（在 `src/rootsModel.ts` 的 `buildOrderEntries`），本轮复跑全绿 | 派单说「之前是红的」；**现在不红**（基线 154/154 里就含它）——留痕：无需修，也未放松任何断言 |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 性质 |
|---|---:|---:|---|
| `src/externalTaskSettings.ts` | —— | 227 | 新（任务设置模型/解析/折命令/env 组装/localStorage 存取） |
| `src/gradleHost.ts` | 757 | 833 | 改：任务设置消费（runTask/saveTaskAsRunConfig）、`kind:'task'` 队列作业、合并窗 + 显式分流 + eatPending + dispose、操作计数、配置源根写表 |
| `src/externalSystemAutoImport.ts` | 483 | 558 | 改：尾部新增合并窗一节（300/3000/2700 折算 + `createAutoReloadWindow`），头注坐标齐全 |
| `src/externalSystemActions.ts` | 146 | 150 | 改：任务节点加「编辑任务…」行 |
| `src/projectFileIndex.ts` | 204 | 222 | 改：进程级配置源根表 + `sourceRootFor` 三档优先级 |
| `src/components/GradlePanel.vue` | 340 | 413 | 改：编辑对话框（字段/校验/保存/Esc）、tooltip「（已编辑）」、取消链接连带清表 |
| `tests/ext-task-settings.test.mjs` | —— | 129 | 新（10 条） |
| `tests/ext-autoimport-window.test.mjs` | —— | 104 | 新（6 条） |
| `tests/roots-file-index-config.test.mjs` | —— | 51 | 新（5 条） |
| `tests/gradle-host.test.mjs` | 218 | 293 | 改：3 条新宿主判据（折命令、env 通道、合并窗延迟与到点真跑）+ 模块装载表补两条映射 |

`native/` 一行没动（env 通道是既有 `gradle.sync` 能力）⇒ 本轮无 ctest 义务；上游 `projectRootDescriptors/projectRoots/roots/impl` 诸文件本轮实读行号见 §1。

## 3. §5 自查前后数字

| 判据 | 前（起手） | 后（收工） |
|---|---|---|
| `node --test tests/ext-* tests/roots-* tests/library-* tests/gradle-* tests/module-size` | 130 / 128 / **2 红**（git.cpp、SearchPanel 行数——非我面） | **154 / 154 / 0** |
| 邻居域（`external-*`、`auto-import-*`、`order-roots`、`module-scopes`、`project-roots`、`project-file-index`、`roots-model`） | 104 / 104 / 0 | **122 / 122 / 0** |
| `npx vue-tsc -b` | 0 错 | **exit 0、0 错** |
| `find-param-props` / `find-ts-in-mjs` / `find-missing-ext` | 0 处 / 干净 / 干净（1200+ 文件） | 0 处 / 干净 / 干净（**1257 文件**） |
| `find-orphan-modules --gate` | 绿（基线 9） | **绿：已登记孤儿 9 / 基线 9 · 新增 0** |
| `source-citations` + `anchors` | 接手时含 2 条非我面红（`docs/batch-2026-10-06-runcfg.md` 的两条假路径引用，收工前该文件已自行修复；不代改、只登记）| **11 / 9 / 2**——两条红都指向我写下本行之前的转述残留；把假路径的完整形状从转述里去掉后，本域引用**全过**（本行不再写出任何假路径:行号形状） |
| module-size 上限 | ts/vue 900 / native 1100 | 我面最大值 `gradleHost.ts` 833、`GradlePanel.vue` 413，均在档内；未动任何登记上限 |

## 4. 反向验证记录（注入 → 红 → 撤 → 绿）

基线：`tests/ext-task-settings.test.mjs` **10 / 10 / 0**。

| 步骤 | 做了什么 | 实测 |
|---|---|---|
| 注入 | `src/externalSystemActions.ts` 的矩阵行 id 由 `EditExternalSystemTaskAction` 改成 `EditExternalSystemTaskActionXX`（把「编辑任务…」从动作矩阵摘出真链路） | `10 / 9 / **1 红**`（`✖ 接线①：任务右键矩阵有「编辑任务…」行`） |
| 撤销 | 逐字改回原 id | 收工复跑域测试 **154 / 154 / 0**、邻居 **122 / 122 / 0**（绿） |

另有一次**非人为的灵敏度证据**：给 gradleHost 加新 import 后、宿主测试装载表还没补映射时，`tests/gradle-host.test.mjs` 整文件 **9 条红**（`Error: ./externalTaskSettings.ts`），补上映射后复绿 —— 说明宿主判据真的在装载消费链路，不是摆设。行为面判据（合并窗延迟/到点真跑、env 通道数组内容、GRADLE_OPTS 次序）都是**行为断言**而非字符串锚点。

## 5. 零消费方自查

新增的三份导出都有**生产消费方**（grep 实测）：
- `src/externalTaskSettings.ts` ← `src/gradleHost.ts:24-29`（runTask/saveTaskAsRunConfig 真调）、`src/components/GradlePanel.vue:31-37`（对话框读写存储）；
- `externalSystemAutoImport.ts` 新导出 ← `src/gradleHost.ts:44` import、`createAutoReloadWindow` 在 `:290` 实例化、`effectiveReloadDelayMs` 由窗口默认参调用；
- `projectFileIndex.ts` 的 `setConfiguredSourceRoots` ← `src/gradleHost.ts:32,134-136`；读者 `sourceRootFor` ← `src/components/TabContextMenu.vue:20`（既有链路）。
`node .tools/find-orphan-modules.mjs --gate`：新增 0、门禁绿（数字见 §3）。

## 6. 做不到 / 无法核实（具体卡在哪一环）

1. **运行配置携带 VM 选项/env**：存储 schema **早就允许**（`src/runConfigurationSchema.ts:22` 的键白名单含 `env`），
   但 `src/App.vue:1817` 的 `addRunConfiguration(name, command)` 回调只收两条字符串、运行实例的 env 位也未核实
   （宿主 `native/run_host.cpp` 非我面）⇒ 「保存为运行配置」本轮只折任务名与脚本参数，VM/env 在**直接运行**时生效。
   已写成接线请求 R1（含可照抄的 App.vue 替换行）。
2. **`passParentEnvs`（上游 `EnvironmentVariablesComponent` 的「继承父环境」勾选）**：宿主通道（`native/gradle.cpp:49-52`，env **叠在继承来的环境之上**）没有「清空父环境」的能力，改宿主不在我面 ⇒ 该勾不渲染（不放假控件），文件头写明。
3. **`AnnotationOrderRootType` 贡献**：上游的 JDK 外部注解 jar 在 IDEA **插件发行目录**（不在用户 JDK home，`native/jdk.cpp` 探不到），本仓没有这份发行物也没有插件资源管线 ⇒ 无数据源，不造假表；`src/orderRoots.ts:74` 保持「annotations 档无贡献者」的注释口径。
4. **AFTER_SYNC 之外多阶段的任务 env**：afterSync 激活任务仍走 `deps.runInConsole` 单命令通道（`:485-491`），带 env 的编辑设置只作用于「直接运行该任务」；把激活链整体搬进带 env 通道要动 `runActions.ts`（非我面）。
5. **对话框任务名的完成候选**：上游 `TaskCompletionProvider`（`ExternalSystemTaskSettingsControl.java:86`）挂在 Swing EditorTextField 上给同步后的任务表补全；本仓输入框是原生 `<input>`，接补全要动编辑器基础设施（非我面），未做。
6. **引用门的转述坑（本轮自己踩了一次，已修）**：上一行原稿把别人文档里两条假路径**带行号整形状转述**进我的报告，
   被门禁当成真引用收集（正是规约 §5 警告的形态）；收工前该两处在 `runcfg.md` 已被其作者修复，我的转述也已去掉完整形状。
7. **无法核实**：判词 `es/execution` 提的 `#JAVA_HOME` 注入「没有入口」——本轮给它找到了**间接**入口（编辑对话框的 env 行可以写 `JAVA_HOME=…`，用户 env 最后叠、盖过 Gradle JVM 的 JAVA_HOME），但 Gradle JVM 下拉本身没有 `#JAVA_HOME` 档位（`gradleEnvironment` 读 `src/gradle.ts`，其选项集对应上游 `GradleProjectSettings.getGradleJvm`，档位定义在 `ExternalSystemJdkUtil.java:52-54`——该文件本轮实读；下拉加档要走 GradleSettingsPage 的选项表，属我面但改动牵动 native 校验口径，本轮预算尽处，留作下一批）。

## 7. 需要主代理接的线

单放 `docs/wiring-requests-2026-10-06-roots.md`：R1（运行配置形状带 env/VM 的通道），R2（bucket15 的 W2/W3 仍在无人面上——schema 与 main.ts 归主代理裁决）。
