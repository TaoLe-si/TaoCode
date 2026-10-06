# 批次报告 · 2026-10-06 · roots3（项目模型 / 外部系统 / 根与 SDK 域收尾）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
下列每一条上游 `相对路径:行号` 与每一条本仓坐标都是本轮亲手打开数过的；沿用别人结论的地方都写了「沿用 + 复核方式」。
保留文件一行没改；本轮**没有**新建 native 源文件、**没有**动 `CMakeLists.txt`。
接线请求单：`docs/wiring-requests-2026-10-06-roots3.md`（§7）。

## 1. 判词表

### 1.1 四份请求文档里**仍未闭环**的条目（任务 1）

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点 / 证据（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| es/execution | roots R1 ＋ roots2 N1 · `src/App.vue` 的 `addRunConfiguration` 第三参 | **`[ ]` 仍缺**（唯一一条真缺口） | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemBeforeRunTask.java:38,42-45`（`tasks`/`vmOptions`/`scriptParameters` 写进运行配置 XML）；bean `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java:39-44,94,102,134`；执行 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/internal/ExternalSystemExecuteTaskTask.java:43,80-82` | 断点在 `src/App.vue:1839`（原文只声明两个参数）；链的其余四处本轮实测在：`src/gradleHost.ts:72,675-676`、`src/runConfigurationSchema.ts:61,85,115`、`src/runActions.ts:98`、`native/run_host.cpp:207` ＋ `native/runner.hpp:30-32` | 行号从 roots2 的 `:1817` 漂到 `:1839`、内容逐字没变 ⇒ 不是「前提变了」；可粘贴 old/new 在请求单 A1（old 用的是现树逐字原文） |
| es/misc · settings | roots R2 ＝ bucket15 W2（externalTools 字段落进宿主设置） | **`[x]` 已闭环**（本轮复核） | `platform/lang-impl/src/com/intellij/tools/Tool.java:56-77`（bean 形状，沿用 roots2 实测） | `native/settings_schema.cpp:261-263` 的 `known_keys` 白名单已是 11 个上游字段；判据 `native/settings_transfer_test.cpp:183`（沿用） | 复核方式：本轮直接 grep 现树那三行，逐个键对上；不重跑 ctest（`native/` 一行没动，见 §5） |
| pf/filetypes | roots R2 ＝ bucket15 W3（启动时灌忽略清单） | **`[x]` 已闭环**（本轮复核） | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165`、`:1363-1364`（沿用） | `src/main.ts:6`（import）＋ `:30`（`loadIgnoredPatterns()` 自己 apply） | 复核方式：grep `src/main.ts` 现树；`applyIgnoredPatterns` 不重复调是上一轮的**订正**（请求给的代码会多写一次 localStorage），本轮确认那处注释还在 |
| esa/autoimport | bucket15j §1（`file.archiveEntries` 进 `Method` 联合） | **`[x]` 已闭环** | `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:10-12`、`platform/util/src/com/intellij/util/io/URLUtil.java:39`（沿用 roots 批实测） | `src/bridge.ts:109` 的联合里已有 `'file.archiveEntries'`；`src/jarEntriesSource.ts:45` 已是 `request<ArchiveListingReply>('file.archiveEntries', …)`，请求里说的 `as string as Method` 窄化已经不需要（文件头 `:37` 记了「主代理接线」） | 登记完成后调用点不必带 cast；判据 `tests/ext-jar-entries-channel.test.mjs` 本轮复跑在内（域测试 334 条全绿） |
| esa/autoimport | bucket15j §2（预览**不做**内存桩） | **`[-]` 维持不桩**（设计如此，不是漏接） | —— （这条本来就是「不做什么」的登记） | `src/bridgePreview.ts` 全文 grep 不到 `archiveEntries` ⇒ 浏览器预览里 `jarChannelStatus()` 为 `absent` ⇒ 「档案条目」那整块不渲染 | 桩就等于编造 jar 条目清单，违反「没有数据通道不放假控件」；本轮实测确认桩确实没被顺手加进去 |
| es/ui · 新建文件 | bucket15 W1（用户自定义模板进新建文件对话框） | **`[x]` 已闭环**（本轮实测四处落点） | `platform/lang-impl/src/com/intellij/ide/actions/CreateFileFromTemplateAction.java:68-120`、`platform/lang-impl/src/com/intellij/ide/fileTemplates/FileTemplateUtil.java:384`（沿用） | `src/App.vue:152-153`（两条 import）、`:246`（`nameDialogTemplates` 计算属性）、`:2489`（`v-for` 的 option）、`:1721`（`createFileFromTemplate` 落盘） | 复核方式：grep `HOST_FILE_TEMPLATE_KINDS`/`createFileFromTemplate`/`nameDialogTemplates` 四个符号在 App.vue 的现树位置，全在 |
| pm/file-index · VFS | bucket15j §3（点档案内某行看内容）＋ 任务 3 点名的「VFS/文件索引要不要 native 通道」 | **`[ ]` 仍缺 ⇒ 需要 native**，已写请求 | `platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:672`（`exists()`）、`:274`（`isValid()`）、`:233`（`isDirectory()`）、`:610`（`getLength()`）、`:605`（`getTimeStamp()`）、`:224`（`isWritable()`）—— 本轮逐行数过 | 落点建议：`native/file_queries.cpp` 匿名 namespace（现 `:21-192`）加 `file_stat()`，分派 `:194` 的 `dispatch_file_query` 加一条 case；判据 `native/library_sources_test.cpp:73` 同文件；桥类型 `src/bridge.ts:109` | 「查不到 ≠ 无效」是本仓自己写在 `src/rootsModel.ts:246-248`、`:233` 与 `src/projectFileIndex.ts:180-187` 的约束；**CMakeLists.txt 不用动**（`file_queries.cpp` 已编在 `taocode_workspace`，`CMakeLists.txt:30`）。读归档**内条目**这条 `file.stat` 也解决不了，已分开登记 |
| pf/filetypes · F4 | roots2 §顺带（F4 需要主代理先给 Method 名） | **前提变了**：名与形状本轮给出 | 同上 `VirtualFile.java:610,605,224` | 请求单 A2 末尾：建议就叫 `file.stat`，`{exists, kind, length, modifiedAt, reason}`；`encodingHint` 建议**不放**这条（属 `file.readBinary` 那一族） | F1/F2/F3/F5 的目标文件仍不在我面（`src/bridge.ts` 之外的四处、`native/main.cpp`），沿用 roots2 §7.3 的逐条实测，不重复施工 |

### 1.2 特别核（任务 3 点名的两处口径）

| 项 | 判定 | 上游依据 | 本仓落点 | 结论（**留痕：原写 X、实际 Y**） |
|---|---|---|---|---|
| `OrderEntry` 有效性 | `[x]` 判据成立 ＋ 本轮补强 | `platform/projectModel-api/src/com/intellij/openapi/roots/OrderEntry.java:55-56`（javadoc 那句「条目 valid 不等于它的每个根都 valid」）、`:60`（`isValid()` 声明）—— 本轮重数，该文件 78 行 | `src/rootsModel.ts:233`（SDK 判家目录）、`:246-248`（库判「有没有任何根」）、新条目 `:219-221`；判据 `tests/roots-model.test.mjs:72-87` ＋ 本轮新增的 `:221-225` | **口径一致**：上一批写的 `:54-60` 是对的（roots2 已把 `:60-66` 订正掉）。本轮按 javadoc 的原义把「条目指向的东西在不在」和「它的根在不在」**显式分开**：新加的 `moduleSource` 条目 `valid: true`，源根不在磁盘清单上不翻这条，并在注释里指回 `:56` |
| `pm/file-index` 判词 vs 现状 | 判词**过期**（我不能改保留文件，只登记） | 上游 `WorkspaceFileIndexImpl`/`ExcludedRootFileIndexContributor` 一族（族本体见 `platform/projectModel-impl/src/com/intellij/workspaceModel/core/fileIndex/impl/ExcludedRootFileIndexContributor.kt`，本轮 find 命中） | `docs/inventory/verdict-platform_rest.md:135` 的「缺②」＝「配置的源根只有 `ProjectStructurePane.vue` 手上有」；现树：`src/projectFileIndex.ts:112-133` 的进程表 + 写者 `src/gradleHost.ts:134-137`（本轮实测 `immediate: true, flush: 'sync'` ⇒ 设置一到手就进表，不是「等用户改一次」） | **缺② 已闭**（判词文本待主代理按 `docs/inventory` 的口径重生成）；缺①（按类型贡献的扩展点宿主）确实要宿主 ⇒ 已落成 A2 的 native 请求；缺③（Module 维度只返单隐式模块名）沿用 `[-]`，本轮 `moduleScopes` 的多模块输入面（`moduleContentRoots`/`moduleOrderEntries`）已能吃边，见 §1.3 M1 |
| `an/module` 判词 vs 现状 | 判词**路径有错** ＋ `[-]` 结论**部分被推翻** | 真身：`platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes/ModuleScopeProviderFactoryImpl.kt:10`（`grep -rln "ModuleScopeProviderFactoryImpl" platform/` 全树只命中这一个文件，**没有 `factories/` 目录、不是 `.java`**）；语义本体 `同目录 ModuleScopeUtil.kt:27-54`、`ModuleWithDependenciesScope.kt:131-142,155-160`、`ModuleWithDependenciesScopeCache.kt:16,28` | `docs/batch-2026-10-06-roots.md:26` 写的是 `…/scopes/factories/ModuleScopeProviderFactoryImpl.java`；`docs/inventory/verdict-platform_rest.md:224` 只写类名（没写错路径） | **留痕**：原写「`.java` ＋ `factories/` 子目录」，实际 `.kt` 且在同一 `scopes/` 目录里（该行没带行号，所以引用门拦不住，属**未被机检覆盖的错路径**）。它据此给的 `[-]`「按模块工厂＋缓存没有用户可见差」——**工厂那条站得住**（单隐式模块只剩一个键，且 `OrderRootsCache` 等价物已在 `src/orderRoots.ts:125-144`）；但同一行把 `ModuleScopeUtil` 的**选项语义**一起放过是错的：本仓 `calcModules` 两个分支恒等，选项位传进去不产生任何差别 ⇒ 这是行为差，不是架构差。本轮落正（§1.3 M1），缓存本体仍判 `[-]`（`moduleScopeModel` 由 computed 现场重建，加一层键为单值的缓存零用户可见差） |

### 1.3 模块侧本轮落的（任务 2，2 条；每条都有「改前会红」的判据）

| 族 | 项 | 判定 | 上游依据（相对路径:行号，本轮逐条打开） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| an/module | **正向模块依赖闭包**：`calcModules` 的两个分支此前恒等（`if (!flags.modules) return [x]; return [x]`），传进来的 `ModuleOrderEntry` 边永远不会被走 | `[x]` | `platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes/ModuleScopeUtil.kt:29`（`recursively()` 无条件）、`:30`（COMPILE_ONLY ⇒ `exportedOnly().compileOnly()`）、`:32`（无 MODULES ⇒ `withoutDepModules()`）、`:41-54`（收 `ModuleOrderEntry.getModule()` 与 `ModuleSourceOrderEntry.getOwnerModule()`）、`:99-102`（四个选项位值） | `src/moduleScopes.ts:525-553`（新 `dependencyModuleClosure`）＋ `:556-558`（`calcModules` 改成同一实现）；判据 `tests/module-dep-scopes.test.mjs` 第 1~3 条 | `MODULES` 位决定「走不走边」，`COMPILE_ONLY` 位决定「非 exported 的边整条不看（既不入选也不下探）」，根模块恒排第一；没有边时返回 `[本模块]`，与改前逐字一致（回归判据在第 7 条） |
| an/module | **带依赖的作用域真的把依赖模块的根收进来**：此前 `moduleWithDependenciesScope` 在 `LIBRARIES` 位开着时直接 `return model`，`MODULES` 位形同不存在 | `[x]` | `ModuleWithDependenciesScope.kt:131-134`（`ModuleOrderEntry`/`ModuleSourceOrderEntry` 的根按 **SOURCES** 收，其余按 CLASSES）、`:138-142`（`putIfAbsent(root, i++)` ⇒ 首次出现为准、出现顺序即优先级）、`:155-160`；`ModuleScopeUtil.kt:31`（无 LIBRARIES ⇒ `withoutLibraries().withoutSdk()`） | `src/moduleScopes.ts:315-363`（新私有 `withModuleRoots` 做根表合并）＋ `:374-381`（重写 `moduleWithDependenciesScope`，选项语义写在 `:365-373`）；判据 `tests/module-dep-scopes.test.mjs` 第 4~6 条 | 依赖模块的内容根进 `contentRoots`/`roots`/`isInContent`/`contentRelativePath`/`rootDescriptorOf`；顺带补上改前漏的一条：剥库时 `isInJdk` 也得跟着假（`:31` 的 `withoutSdk()` 语义）；没有边 ⇒ 与改前逐字一致 |
| pm/roots · lp/roots | **`ModuleSourceOrderEntry`（模块自己那条源根条目）此前根本不建**：`buildOrderEntries` 只有 jdk/library/output，面板看不出「哪些根是模块自己贡献的」 | `[x]` | `platform/projectModel-impl/src/com/intellij/workspaceModel/ide/impl/legacyBridge/module/roots/OrderEntriesBridge.kt:363`（`ModuleSourceOrderEntryBridge`）、`:365`（`getFiles(type)` 只在 SOURCES 返 `rootModel.sourceRoots`，其余空数组）、`:367`（`getPresentableName()` ＝ `ProjectModelBundle.message("project.root.module.source")`）、`:380`（`isSynthetic()` 恒真）；文案 `platform/projectModel-api/resources/messages/ProjectModelBundle.properties:40` = `<Module source>`；枚举侧「模块自己的条目先出现」`platform/projectModel-impl/src/com/intellij/openapi/roots/impl/OrderRootComputer.java:53-63` | `src/rootsModel.ts:88`（`RootOrderEntryKind` 加 `moduleSource`）、`:202-225`（`buildOrderEntries` 第一条：kind `:215`、presentableName `:218`、`valid` 的理由 `:219-221`）、`:390`（`ORDER_ENTRY_LABELS.moduleSource`）；判据 `tests/roots-model.test.mjs:72-91` ＋ 面板树行 `:138-150` | 面板 `<模块源码>` 是 `:40` 那条 bundle 的直译（英文原文写进注释）；`valid` 恒真并按 `OrderEntry.java:56` 说明「条目有效 ≠ 每个根有效」；**上游这条恒在，本仓在它一个根都不贡献时不出行**（与 `rootModelRows` 既有「空组不出」同口径，写在 `:210-212`，文件头不等价第 1 条也补了留痕 `:29-32`） |

## 2. 改动文件清单（`wc -l` 前 → 后）

| 文件 | 前 | 后 | 性质 |
|---|---:|---:|---|
| `src/moduleScopes.ts` | 492 | 588 | 改：`withModuleRoots`（根表合并）＋ `moduleWithDependenciesScope` 重写 ＋ `dependencyModuleClosure` ＋ `calcModules` 落到同一实现 |
| `src/rootsModel.ts` | 375 | 407 | 改：`moduleSource` 条目种类、`buildOrderEntries` 第一条、标签表、文件头不等价第 1 条补留痕 |
| `tests/roots-model.test.mjs` | 160 | 185 | 改：面板树行断言按新形状**加一行并重钉** `rows[10]/rows[11]`（原钉的是改前形状）；`ORDER_ENTRY_LABELS` 的全量形状断言补 `moduleSource`；新增 1 条 moduleSource 判据。**没有放松任何断言**（`deepEqual` 仍是 `deepEqual`，没改成 `includes`） |
| `tests/module-dep-scopes.test.mjs` | —— | 96 | 新（7 条）：正向闭包 / exportedOnly / calcModules 同实现 / 依赖根进表 / MODULES 关 / 无 LIBRARIES / 无边回归 |
| `docs/batch-2026-10-06-roots3.md` | —— | 本文件 | 报告 |
| `docs/wiring-requests-2026-10-06-roots3.md` | —— | 约 120 | 请求单（A1 App.vue 一行、A2 `file.stat`、A3 两条状态登记） |

`native/` 一行没动 ⇒ 本轮无 ctest 义务；`CMakeLists.txt` 未动（A2 的落点在已编译的 `native/file_queries.cpp`）。

## 3. §5 自查命令的前后数字

| 判据 | 前（起手基线） | 后（收工） |
|---|---|---|
| `node --test tests/roots-*.test.mjs tests/order-roots.test.mjs tests/project-roots.test.mjs tests/pv-mark-roots.test.mjs`（10 个根/模型文件） | **80 / 80 / 0** | —— 见下一行合并数 |
| `node --test tests/external-system-*.test.mjs tests/external-*.test.mjs tests/ext-*.test.mjs tests/library-*.test.mjs tests/gradle*.test.mjs`（14 个外部系统文件） | **175 / 175 / 0** | —— 同上 |
| 收工全域：`node --test tests/roots-*.test.mjs tests/order-roots tests/project-roots tests/pv-mark-roots tests/project-file-index tests/roots-file-index-config tests/module-*.test.mjs tests/external-*.test.mjs tests/ext-*.test.mjs tests/library-*.test.mjs tests/gradle*.test.mjs tests/jar-*.test.mjs tests/module-size.test.mjs` | （起手分两批合计 255 / 255 / 0） | **334 / 334 / 0 红**（334 里含本轮新增 8 条：`module-dep-scopes` 7 ＋ `roots-model` 1） |
| `node --test tests/roots-model tests/module-dep-scopes tests/module-scopes`（改后专项目标） | 80 里含 roots-model 11、module-scopes 14 | **32 / 32 / 0**（撤掉变异后复绿；`MUTATION` 标记 grep 0 命中） |
| `npx vue-tsc -b --force` | **0 错**（`.tmp-roots3-tsc-base.txt` 空文件，exit 0） | **exit 1 / 3 条错，全非我面**：`src/components/CodeEditor.vue(117,70)`、`(161,53)`（`EditorView \| undefined` vs `\| null`）、`src/editorSplitLine.ts(117,56)`（`Array.prototype.map` 回调签名）—— 编辑器域别的代理在途；我面上（`moduleScopes.ts`/`rootsModel.ts`）**0 条**。**中途另有一次采样是 4 条错、全在 `src/lspNavigation.ts:320,321,666`（语法错，TS1005/TS1136/TS1109）**，那次因为 §4.3 的「语法错遮掉全仓语义检查」而**看不到**编辑器域这几条；两者都不是我的文件，我也没替它们改 |
| `node --test tests/module-size.test.mjs` | **5 / 5 / 0** | **5 / 5 / 0**（上限一律未动；`moduleScopes.ts` 588 / `rootsModel.ts` 407，都在 ts 900 之下；`App.vue` 现 2673 / 2737，A1 净 +4 行有余量） |
| `node .tools/find-orphan-modules.mjs --gate` | **已登记 7 / 基线 8 · 新增 0**（清掉 1：`src/jarRun.ts`） | **已登记 6 / 基线 8 · 新增 0**（清掉 2：`src/jarRun.ts`、`src/runAnythingContext.ts`，后者是别的线接的）⇒ 门禁绿 |
| `node --test tests/source-citations.test.mjs` | 3 / 3 / 0 | **11 / 11 / 0**（与 `source-citation-anchors` 合并跑；本轮新写的两份文档 + 两个测试文件里的每条全路径引用都被解析器收进且**指得到**）。**收工最后一次合并跑变 10 / 11 / 1 红**，红的两条**不指向我**：`docs/wiring-requests-2026-10-06-fix-macros.md` 的 `intellij.platform.lang.impl.xml:1058-1062` 与 `ClipboardMacro.java:15` 被那条线在途改成「快照里有、仓里指不到」（快照待 `TAOCODE_CITATION_ANCHORS=update` 重算）；快照 3192 / 活引用 3271 / 未入快照 81（含我本轮新增的那些，不拦） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 1 个文件 | **1 个文件，非我面**：`run-anything-context-dialog.test.mjs:43`（函数参数类型标注，别人的在途测试）。我的 `tests/module-dep-scopes.test.mjs` 无 TS 语法 |
| `node .tools/find-missing-ext.mjs` | 干净 | 干净（1317 个文件，三种 import 形态；新测试文件对 `../src/moduleScopes.ts` 的取值 import 带全扩展名） |

## 4. 反向验证记录（三步数字）

| 步 | 注入了什么 | 结果 |
|---|---|---|
| 1（红） | **MUTATION-A1**：`moduleWithDependenciesScope` 结尾把 `withModuleRoots(model, foreign, …)` 改成 `withModuleRoots(model, [], …)`（= 依赖模块的根不进表，回到改前的可达形状）；**MUTATION-A2**：`calcModules` 退回 `if (!flags.modules) return [model.moduleName]; return [model.moduleName]`（两分支恒等） | `node --test tests/module-dep-scopes.test.mjs` ⇒ **7 条里 3 红**（`calcModules 与正向闭包同一实现`、`带依赖的作用域：依赖模块的内容根按 SOURCES 进表`、`无 LIBRARIES ⇒ 库与 SDK 都剥掉、依赖模块的根仍进`）；其余 4 条（闭包本体、MODULES 关、无边回归）不受影响 ⇒ 说明这三条红的正是新行为 |
| 2（撤） | 撤掉 A1/A2 | **7 / 7 / 0** 复绿 |
| 1'（红） | **MUTATION-B**：`buildOrderEntries` 的 `if (ownSources.length) {` 改成 `if (ownSources.length && false) {`（= 不建 `moduleSource` 条目） | `node --test tests/roots-model.test.mjs tests/module-dep-scopes.test.mjs` ⇒ **18 条里 2 红**，都在 roots-model：新判据 `模块自己的源根条目…` 与既有 `面板树行：内容根 → …→ 序根条目`（`actual` 少了 `[1, '<模块源码>']` 一行，逐字打印）；module-dep 那 7 条仍全绿 ⇒ A 组撤干净了 |
| 2'（撤） | 撤掉 MUTATION-B | **32 / 32 / 0**（roots-model 11 ＋ module-scopes 14 ＋ module-dep 7），收工再跑一次 37/37/0 |
| 残留 | `grep -rn "MUTATION\|临时" src/moduleScopes.ts src/rootsModel.ts tests/module-dep-scopes.test.mjs` | **0 命中**（`git diff --stat` 三个文件的 hunk 也逐条看过，全属本轮） |

## 5. 零消费方自查结论

- `node .tools/find-orphan-modules.mjs --gate` ⇒ **新增 0**；我域内一个模块都没进孤儿表（`src/moduleScopes.ts` 的真实消费方是 `src/components/ScopesSettingsPage.vue:36,118`，`src/rootsModel.ts` 的是 `src/components/ProjectStructurePane.vue:16,133,417`）。
- 本轮**没有新增模块文件**，只新增 1 个导出（`dependencyModuleClosure`）与 1 个模块内私有函数（`withModuleRoots`）。诚实结论：`dependencyModuleClosure` 在 `src/` 内的消费方是同文件的 `calcModules` 与 `moduleWithDependenciesScope`（都是既有作用域族成员），**跨模块消费方目前只有 `tests/`**；`calcModules`/`moduleWithDependenciesScope` 这两个上游作用域对象在本仓面板上还只在 `moduleScopes` 内部（`libraryRuntimeClasspathScope` → `moduleWithDependenciesScope`）被串起来，面板侧要等「作用域选择器接模块作用域」那条线才用得到（登记在 §6.2，没假装已接）。
- 新加的 `moduleSource` 序根条目**立刻有真实消费链路**：`ProjectStructurePane.vue:417` 直接渲染 `orderEntryKindLabel(row.orderEntryKind, …)`，`ORDER_ENTRY_LABELS` 加了键就出文案，不是只过自己测试的死形状。

## 6. 做不到 / 无法核实（具体卡在哪一环）

1. **A1（`src/App.vue:1839`）落不了**：`src/App.vue` 是保留文件（§2 明确「只有一个代理能改，当前是 `appvue`」）。整条链其余四处本轮实测都在，只差这一行；可粘贴 old/new 在请求单。
2. **`ModuleWithDependenciesScopeCache`（本体在 `ModuleWithDependenciesScopeCache.kt:16,28`）判 `[-]`，本轮没做**：`src/moduleScopes.ts:197` 的 `moduleScopeModel` 由 Vue `computed` 现场重建，给单隐式模块再造一层 (module, options) 缓存没有用户可见差 —— 具体卡点是「没有可观察的差」，不是「没想到」。
3. **`moduleWithDependenciesScope` 的 `TESTS` 位仍不接**（写在 `src/moduleScopes.ts:365-373` 的注释里）：上游 `ModuleScopeUtil.kt:33` 的 `productionOnly()` 要滤的是**依赖模块自己的测试源根**，而本仓多模块输入面 `ModuleScopeInput.moduleContentRoots` 只给了各模块的内容根，没有各模块的源根表 ⇒ 硬做就是猜目录。缺的环是**输入面**（要往 `settingsModel.ts` 的 java 设置加字段，保留文件）。
4. **`pm/file-index` 缺①（按类型贡献的 `WorkspaceFileIndexContributor` 扩展点）与「项目外的库/SDK 根在不在磁盘上」**：都卡在宿主只答工作区相对路径（`src/projectFileIndex.ts:180-187` 的 `listed()` 地板是 `workspace.files`）。⇒ 已写成 native 请求 A2，不自己造前端假通道。
5. **收工的 `vue-tsc` 不是 0 错**：3 条错在 `src/components/CodeEditor.vue` / `src/editorSplitLine.ts`（非我面，派单没写 ⇒ 只读，且 §2 保留文件之外归属不明）。**起手实测 0 错**，所以这三条是并发线带进来的；按 §5「只跑自己域的测试、别把别人的在途红算到自己头上」的口径登记，不动它们。
6. **`OrderEntry` 的「库/SDK 根真的在不在磁盘」这一半仍只能按「有没有根」判**：`native/settings_schema.cpp` / `workspace.files` 都给不了绝对路径的存在性 —— 卡点即 A2；本轮把**能判的那一半**（条目指向的东西在不在、以及 `moduleSource` 那条恒真）按 `OrderEntry.java:55-60` 钉死。
7. **`node .tools/find-ts-in-mjs.mjs` 的 1 红**在 `tests/run-anything-context-dialog.test.mjs:43`（非我面）。
8. **引用锚点门在收工最后一次采样红了 2 条**（`tests/source-citation-anchors.test.mjs:267`），红的两条都在 `docs/wiring-requests-2026-10-06-fix-macros.md`（`intellij.platform.lang.impl.xml:1058-1062`、`ClipboardMacro.java:15` 变成「快照里有、仓里指不到」）⇒ 那条线改了行号没重算快照。我**不动它**：既非我面，也不是我能替它判「引用指错了还是区间内容变了」（§3 那行的建议动作是它自己按 `TAOCODE_CITATION_ANCHORS=update` 重算）。本轮我之前那次合并跑是 11 / 11 / 0，所以红是在我采样之后由并发改动带进来的。
9. **运行级取证没做**：不启动图形界面 ⇒ A1 的「保存的运行配置带 env 后真生效」、以及本轮两条模块改动在真面板上的呈现，都只到**代码级 + 判据级**。

## 7. 需要主代理接的线

全部集中在 `docs/wiring-requests-2026-10-06-roots3.md`：
- **A1**（唯一真缺口，1 行改动）：`src/App.vue:1839` 收 `addRunConfiguration` 的第三参 `env?: string[]`；
- **A2**（VFS 那一寸）：`native/file_queries.cpp` 加 `file_stat()` + `dispatch_file_query` 一条 case，`native/library_sources_test.cpp` 补判据，`src/bridge.ts:109` 加 `'file.stat'`；**CMakeLists.txt 不用动**；顺带给 `docs/wiring-requests-2026-10-06-filetypes.md` 的 F4 定了 Method 名与形状；
- **A3**（状态登记，不用接线）：bucket15j §1/§2 与 bucket15 W1/W2/W3 的实测闭环证据，以及 §1.2 里那两处判词/上一批报告的**错路径与过期项**（`ModuleScopeProviderFactoryImpl.kt` 不是 `.java`、没有 `factories/` 目录；`pm/file-index` 缺②已闭）。
