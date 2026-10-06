# 桶 15 · 项目模型 / 外部系统 / 根与 SDK / 文件面 / VFS · 2026-10-06

范围（派单点名的半区）：`lp/roots` `pm/roots` `pm/file-index` `an/module` `pf/roots-ui` `pf/vfs` `ic/vfs`
`lp/file-types` `ic/file-types` `pf/file-types` `lp/exclude` `pf/plugins` `ic/plugins` `pf/action-macro`
`lp/file-templates` `ic(i)/file-templates` `lp/external-tools` `lp/microservices` `es/*` `esa/*`。

**本报告是「现场反推」的交付报告**：上一轮负责这一桶的代理在 150 次工具调用上限处被切断，代码已经落盘、报告没写。
下面每一条都来自 **磁盘实况 + 测试实跑 + 参考树亲开**，不引用任何人的判词当事实。

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
本轮我亲手打开并数过行的上游文件（其余坐标沿用仓里已过 `tests/source-citations.test.mjs` 门禁的引用，并注明）：
`ModuleRootModel.java`(203) `ContentEntry.java`(347) `SourceFolder.java`(73) `OrderEntry.java`(78)
`ProjectJdkImpl.java`(299) `ProjectJdkTable.java`(98) `roots/libraries/Library.java`(113)
`roots/libraries/ui/impl/RootDetectionUtil.java`(182) `LibraryRootsDetectorImpl.java`(60)
`fileTypes/impl/FileTypeManagerImpl.java`(2025) `ConflictingFileTypeMappingTracker.java`(213)
`RemovedMappingTracker.java`(243) `FileTypeBean.java`(168) `file/exclude/OverrideFileTypeManager.java`(91)
`file/exclude/ProjectPlainTextFileTypeManager.java`(47) `ide/plugins/InstalledPluginsTab.kt`(754)
`ide/plugins/marketplace/PluginSearchResult.kt`(17) `tools/Tool.java`(452)
`externalSystem/service/project/manage/ExternalSystemTaskActivator.java`(434，`enum Phase` 实测 `:375-382`，正好 7 档)
`openapi/vfs/JarFileSystem.java`(34) `module/impl/scopes/ModuleWithDependentsScope.java`(271)
`openapi/roots/ui/FileAppearanceServiceImpl.java`(78) `ide/actionMacro/ActionMacro.java`/`ActionMacroManager.kt`（同目录实测存在）。

---

## 0. 接手时的实况（先盘点）

- `node .tools/bucket-landing.mjs 15` ⇒ **归属条目 29 个 / 工作区命中 59 个 / 90 分钟内新写 0 个**。
  把窗口拉到 2880 分钟（`WINDOW=2880`）后 59 个全部命中 ⇒ **这一桶的代码是上一轮落的，一条都不缺落盘，缺的只有报告**。
- 域测试（派单给的那条命令，逐字复跑）：
  `node --test tests/roots*.test.mjs tests/ext-*.test.mjs tests/fileType*.test.mjs tests/library*.test.mjs tests/macro*.test.mjs tests/plugin*.test.mjs tests/gradle*.test.mjs tests/vfs*.test.mjs`
  ⇒ **232 用例 / 232 通过 / 0 失败**（与派单给的数字一致；注：仓里没有 `tests/vfs*.test.mjs`，该 glob 空转，
  VFS 一族的判据实际落在 `tests/disk-sync*.test.mjs`、`tests/roots-attach-scan.test.mjs`、`tests/library-root-detection.test.mjs`、`tests/session-encoding.test.mjs` 里）。
- 把域内其余在册测试一起跑（`file-type-*` `file-template-*` `external*` `auto-import*` `template*` `module-scopes`
  `order-roots` `project-roots` `root-appearance` `pv-mark-roots` `disk-sync*`）⇒ **454 / 454 / 0**。
- `npx vue-tsc -b --force` ⇒ **全仓 0 错**（退出码 0、无输出）。桶 15 的「必修：`src/macroHost.ts:53/:137` 类型错」**已经不成立**：
  该文件现状 308 行、全仓类型检查干净。
- 三个系统性检测器：`find-param-props` 0 处 / `find-ts-in-mjs` 干净 / `find-missing-ext` 干净（1198 个文件）。
- `find-orphan-modules.mjs --gate` ⇒ 起手红 1 条 `src/rootsJarEntries.ts`（**不属于本轮**：另一代理正在给它接宿主通道，派单明确「只登记不动」）。
  收工复跑 ⇒ **门禁已绿**：那位代理在本轮中途落了 `file.archiveEntries`（`src/jarEntriesSource.ts:1,31` + `native/file_queries.cpp` 的 `archive_entries`）
  与 `tests/ext-jar-entries-channel.test.mjs`（148 行，+10 条用例）。本报告不替它的判词背书，只记这个状态变化。

### 判词订正（本轮实测，三条「判词说缺、其实早做过」）

| # | 判词原话（`docs/inventory/verdict-platform_rest.md`） | 实测 |
|---|---|---|
| 1 | `es/autoimport` 行 185：「缺：设置文件按**内容 CRC** 判定真变了（`AutoImportProjectSettingsFilesTracker` 的 `calculateSettingsFilesCRC` 口径；本仓按事件类型与路径判定）」 | **早做过**：`src/externalSystemSettingsCrc.ts`（120 行，导出 `calculateSettingsFilesCrc`）被 `src/gradleHost.ts:43` import、`:616-619` 实际使用（按工作区根存 localStorage）；判据 `tests/external-system-settings-crc.test.mjs` + `tests/gradle-host.test.mjs` 全绿 |
| 2 | `pm/roots` 行 134：「缺：① `ProjectJdkImpl` 的 SDK 表（本仓项目 SDK 只是 java 设置里的字符串，没有 SDK 对象与多 SDK 选择）」 | **早做过**：`src/rootsSdkTable.ts`（220 行）就是那张表（`findJdk`/`findJdk(name,type)`/`getAllJdks`/`getSdksOfType`/`findMostRecentSdkOfType`/`addJdk`/`removeJdk`/`updateJdk`/`preconfigure`），判据 `tests/roots-sdk-table.test.mjs` 13 条全绿，逐条对 `ProjectJdkTable.java:40-90` 与 `ProjectJdkImpl.java:49-51,220-225` |
| 3 | `lp/file-types` 行 182 与 `pf/file-types` 行 205：「缺：把探测接进打开流程」 | **已接**：`App.vue` 的每个编辑器都按 `:language="associationOf(tab.path, tab.content)"` 挂（`src/App.vue:2189`），`associationOf` 内部走 `resolveEditorLanguage`，而 `src/fileTypeDetection.ts:142` 查的是进程内注册表 `fileTypeManager.getFileTypeByFileName`。本轮反向验证（§4）钉住了这条链路 |
| 4 | `lp/file-templates` 行 165：「用户模板与 `${NAME}` 的展开结果没有落盘通道」 | **通道已有**：`src/fileTemplateCreate.ts` 的 `planFileTemplateCreate`/`createFileFromTemplate`（`file.create` 建 + `file.write` 写正文），判据 `tests/template-create.test.mjs`；**唯一剩项**是 App.vue 那条 `nameDialog` 仍把 `dialog.template` 当 `template_kind` 传（`src/App.vue:1773`）⇒ 见接线请求 W1 |

---

## 1. 判词（族 / 项 / 判定 / 上游 / 本仓 / 说明）

`[x]` = 用户可见功能已落地且有判据；`[~]` = 本仓已有 + 还差（都写全）；`[ ]` = 有具体卡点；`[-]` = 有意不做（具体理由）。

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 说明 |
|---|---|---|---|---|---|
| lp/roots · pm/roots | 内容根 / 源根 / 排除根 / 序根条目的**对象图与查询面** | `[x]` | `platform/projectModel-api/src/com/intellij/openapi/roots/ContentEntry.java:63,92,122`；`SourceFolder.java:38,44`；`ModuleRootModel.java:58,84,92,100,118,130`；`OrderEntry.java:60` | `src/rootsModel.ts:10-19`（模块头逐条注坐标）、`:120-240`（对象图与面板树行） | 判据 `tests/roots-model.test.mjs` 11 条：`isTestSourceKind` 是源根自己的属性、排除根只收最外层、序根「SDK → 库 → 模块输出」且没模块依赖就不出那一条 |
| lp/roots | 附加库时**识别根**（classes / sources / javadoc 三档） | `[x]` | `platform/lang-impl/src/com/intellij/openapi/roots/libraries/ui/RootDetector.java:24`；`ui/impl/LibraryRootsDetectorImpl.java:40-49`；`ui/impl/RootDetectionUtil.java:53-149`；`ui/DetectedLibraryRoot.java:12-31` | `src/libraryRootDetection.ts:1-26`+`:120-417`；`src/rootsAttachScan.ts:4`（auto/choose/none 三支） | 判据 `tests/library-root-detection.test.mjs`（185 行）+ `tests/roots-attach-scan.test.mjs`：配额读满就说 truncated、读不到文本不当根、多候选共享同一文件只读一次。**还差**：识别结果的写回对象只有 `project.settings.update` 那条 glob 表（`referencedLibraries`），没有 `Library` 实体可挂 |
| lp/roots · pm/roots | 库模型（`Library` 的 name/roots/level/属性） | `[x]` | `platform/projectModel-api/src/com/intellij/openapi/roots/libraries/Library.java:32`；`platform/projectModel-impl/src/com/intellij/workspaceModel/ide/impl/legacyBridge/library/LibraryBridgeImpl.kt:235-247` | `src/libraryModel.ts:10-22`+`:80-353` | 判据 `tests/library-model.test.mjs`（172 行）。文案取自 `ProjectModelBundle.properties:43-44` |
| pm/roots | **SDK 表**（ProjectJdkTable 的全部查询与增删改） | `[x]`（判词过期，见订正 #2） | `platform/projectModel-api/src/com/intellij/openapi/projectRoots/ProjectJdkTable.java:40-46,48-50,53,66,69-80,90`；`platform/projectModel-impl/src/com/intellij/openapi/projectRoots/impl/ProjectJdkImpl.java:49-51,220-225` | `src/rootsSdkTable.ts:8,19`+`:40-220` | 版本比较按段取数（21 < 21.0.1 < 22）、按家目录寻址忽略尾斜杠与大小写、`updateJdk` 不改名时沿用上游三回调 |
| pm/roots | 序根枚举与真实消费（编译 classpath） | `[x]` | `OrderEntry.java:60`、`ModuleRootModel.java:58`；`src/orderRoots.ts:3`（模块头按 `projectModel-impl/src/com/intellij/openapi/roots/impl/` 逐条核过） | `src/orderRoots.ts:66,95,103,108` | 消费链不是展示：`src/projectBuild.ts` 的 `javacCommand` 的 `-cp` 就是它 |
| pm/file-index | `ProjectFileIndex` 查询面（isInContent / getSourceRootForFile / isExcluded / isInTestSourceContent） | `[x]` | `platform/projectModel-api/src/com/intellij/openapi/roots/ProjectFileIndex.java:28`（`public interface ProjectFileIndex extends FileIndex`）与 `platform/projectModel-api/src/com/intellij/openapi/roots/FileIndex.java:39`（`public interface FileIndex`；**citefix 订正**：原写 `platform/ide-core/src/com/intellij/openapi/projectIndex/FileIndex.java`，参考树里没有 `openapi/projectIndex/` 这层包，113 行的真身在 `platform/projectModel-api/src/com/intellij/openapi/roots/`）。本仓引用面已在 `src/projectFileIndex.ts` 模块头核对）；排除根「可见但不属于内容」= `ExcludedRootFileIndexContributor` 语义 | `src/projectFileIndex.ts:58,95,113,118`+`:120-204` | 真实消费点：`src/components/TabContextMenu.vue` 的「来自源根的路径」（= `CopySourceRootPathProvider`）与 `src/copyPathActions.ts`。**还差**：`getModuleForFile` 只返单隐式模块名（本仓无 Module 对象图，`pm/module` 判 `[-]`） |
| an/module | 作用域对象（`ModuleContentScope`/`ModulesScope`/`ModuleWithDependenciesScope`/`LibraryRuntimeClasspathScope`/`JdkScope`/`RootContainer`） | `[x]` | `platform/analysis-impl/src/com/intellij/openapi/module/impl/scopes/ModuleWithDependentsScope.java:105-120`（同目录一族实测存在） | `src/moduleScopes.ts:84,332`+`:120-492` | 消费不是摆设：`src/scopes.ts` 的 `ScopeFileSystem` 用它求值 `file[...]`/`ext:`，设置 › 外观与行为 › 作用域页的命中计数走它（`src/components/ScopesSettingsPage.vue`）。判据 `tests/module-scopes.test.mjs` |
| pf/roots-ui | 根/SDK 的**呈现**（`FileAppearanceServiceImpl` 判定顺序 / `SdkAppearanceServiceImpl` / `SidePanelCountLabel` / `SidePanelSeparator`） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/roots/ui/FileAppearanceServiceImpl.java`（实测 78 行，同目录 `SdkAppearanceServiceImpl.java`） | `src/rootAppearance.ts:3`+`:40-244` | 消费方 `src/components/ProjectStructurePane.vue`（SDK 行说明 `sdkHint`、内容根行 `:title` 与计数标签）。**还差**：按作用域/排除状态给颜色与图标的完整属性集（本仓颜色归样式表，不硬编）|
| pf/vfs · ic/vfs | 本机 FS 抽象：读写/移动/删除/回收站 + 变更监视 + 前端对账 | `[x]` | `platform/core-api/src/com/intellij/openapi/vfs/VirtualFileManager.java:30`（族本体，30 = `public abstract class VirtualFileManager implements ModificationTracker`，全文件 294 行；**citefix 订正**：原写 `platform/ide-core/src/com/intellij/openapi/vfs/VirtualFileManager.java` 参考树里没有该路径）；`SafeWriteRequestor`/`LargeFileWriteRequestor` 的语义 | `native/workspace.cpp`（`replace_safely`：临时文件 + 备份 + 原子替换）、`native/watcher.cpp`、`src/diskSync.ts:53,58,62` | 开关 = `GeneralSettings.isUseSafeWrite`（`src/settingsModel.ts`），`safeWrite` 真的传给 `file.write`。判据 `tests/disk-sync.test.mjs` |
| ic/vfs | 按文件编码记忆 + 库源码按需读取 | `[x]` | `EncodingRegistry`/`EncodingProjectManagerImpl` 的可移植子集 | `src/sessionEncodings.ts`、`src/sessionSnapshot.ts`、`native/library_sources.hpp`（消费 `src/quickDefinitionHost.ts`） | 判据 `tests/session-encoding.test.mjs`：崩溃恢复按记住的编码重读，不把 GBK 当 UTF-8 |
| pf/vfs · ic/vfs | **jar 当目录**（`JarFileSystem` 的 archive 展开） | `[ ]` 卡宿主通道 | `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9`；`platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:34`；`platform/platform-impl/src/com/intellij/openapi/vfs/impl/jar/JarFileSystemImpl.java:23` | `src/rootsJarEntries.ts:5,8,13`+`:23`（条目模型与解析已写完 152 行） | 具体卡点：桥里没有「列档案内条目」的 Method（`src/bridge.ts` 的 Method 联合类型里没有它），`file.readBinary` 只读工作区内路径。解析侧已就绪，**另一代理正在接宿主通道**（本轮按派单只登记、不动它，也不动 `native/library_sources*.cpp`） |
| lp/file-types · pf/file-types · ic/file-types | `FileTypeManager` 等价注册表（register/unregister/associate/consume/`getFileTypeByFileName` 三档匹配 / 忽略清单广播） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java`（实测 2025 行）；`FileTypeAssocTable.findAssociatedFileType` 的匹配次序；`IgnoredPatternSet` 的分号掩码 | `src/fileTypeRegistry.ts:164,529,633-639`+ 全文 805 行 | 判据 `tests/file-type-registry.test.mjs`（含「注册后编辑器语言立刻变」的消费链判据）。**还差**：模式表不落项目设置（宿主只有「扩展名 → 语言」两栏）⇒ 接线请求 W2 |
| pf/file-types | 内容探测（shebang / XML 序言 / DOCTYPE / 完整 JSON / `#include` / Java 声明 / TS import / markdown）并按高置信度覆盖扩展名 | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java:144`（`hashBangs` 的最近物）；`platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java:48-51`（`isBinary` 的短路口径） | `src/fileTypeDetection.ts:39,75,142,178`+ 全文 330 行 | 已接进打开流程（订正 #3）；`detectedSummary` 说清「按什么识别成什么」。判据 `tests/file-type-detection.test.mjs` + `tests/file-type-hashbangs.test.mjs` |
| ic/file-types | 冲突与摘除映射的审批（`ConflictingFileTypeMappingTracker` / `ApproveRemovedMappingsActivity` / `RemovedMappingTracker`） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/ConflictingFileTypeMappingTracker.java`（213 行）；`impl/RemovedMappingTracker.java`（243 行） | `src/fileTypeRemovedMappings.ts:2`+ 全文 230 行；对话框判据 `tests/ext-file-type-approvals.test.mjs`（328 行） | 审批记录在 `src/components/FileTypesPage.vue` 的「冲突与摘除」区渲染，不是空表 |
| ic/file-types | 插件声明的 `FileTypeBean`（注册表喂给内置类型之外的档） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java`（168 行，字段形状照它） | `src/fileTypePluginBeans.ts:3`+ 全文 210 行；消费 `src/components/PluginDialog.vue`、`src/pluginGroups.ts` | 本仓插件确实带 `fileTypes` 段（`native/plugins.cpp` 解析），所以这张表有真实数据源 |
| ic/file-types | 忽略的文件与目录清单（`IgnoredFilesAndFoldersPanel` 的等价表） | `[~]` | `platform/lang-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFilesAndFoldersPanel.java`；`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:165,1363-1364`（应用启动时装 `filetypes` 组件）；文案 `platform/platform-impl/resources/messages/FileTypesBundle.properties:58-61`；`platform/util-rt/src/com/intellij/util/PathUtilRt.java:221-223` | `src/fileTypeIgnoredList.ts:39,46-51,69,94,107,143,167,197-241`（247 行）；页面 `src/components/FileTypesPage.vue:261` | 本仓已有：整张表 + 校验 + 排序 + 恢复默认 + 落 localStorage + `isPathIgnored`。**还差**：灌进注册表的时机在**打开设置页**时（`FileTypesPage.vue:261`），没有启动钩子 ⇒ 接线请求 W3（一行） |
| lp/exclude | 按文件覆盖文件类型（`OverrideFileTypeManager` / `ProjectPlainTextFileTypeManager` / `PersistentFileSetManager` 的 `<file url value/>`） | `[x]` | `platform/lang-impl/src/com/intellij/openapi/file/exclude/OverrideFileTypeManager.java`（91 行）；同目录 `ProjectPlainTextFileTypeManager.java`（47 行） | `src/fileTypeOverrides.ts:1`+ 全文 302 行；消费 `src/problems.ts`（覆盖为纯文本的文件退出语言分析、不进问题面板） | 入口 `src/components/ProblemsPanel.vue` 的逐行「纯文本」+ 覆盖清单 + 恢复/恢复全部。判据 `tests/file-type-overrides.test.mjs`。**还差**：只认 PlainText 一档（上游可覆盖成任意 `FileType`） |
| lp/exclude | 项目级排除目录的粒度 | `[~]` | `ContentEntry.java:92`（按路径记 excludeFolder） | `src/projectRoots.ts:49-70`（按目录段名命中）+ `src/pvMarkRoots.ts` | 还差的是**根因**：本仓 `excludedDirs` 是目录名表（同名所有目录一起命中），改成路径粒度要动 `src/settingsModel.ts`（保留文件）⇒ 已如实写进判据测试（`tests/pv-mark-roots.test.mjs` 钉住这个口径） |
| pf/plugins | 插件分组 / 启停 / 依赖递归 / 搜索过滤（`PluginsGroup`/`InstalledPluginsTab`/`SearchQueryParser`） | `[x]` | `platform/platform-impl/src/com/intellij/ide/plugins/PluginsGroupType.kt:7-21`；`newui/PluginsGroup.kt:146-155`；`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTab.kt:283-288,486-515,655-670,696-708`（本轮实测该文件 754 行；**订正**：`newui/` 下没有这个文件，它在 `ide/plugins/` 直接下面） | `src/pluginGroups.ts:7-7,76,94,102,105`+ 全文 511 行；`native/plugins.cpp`（688 行，`set_enabled` 的递归启停）；`src/components/PluginDialog.vue`（392 行） | 判据 `tests/plugin-groups.test.mjs` + `tests/plugin-dependencies.test.mjs` + `native/plugins_test.cpp`（557 行）。「已启用」判定排除清单读取失败的插件 = `InstalledPluginsTab.kt:696-708` |
| pf/plugins | **市场**（本地仓库源）：条目模型 / 搜索 / 五个排序 / 版本比较 / 已装-可更新-无效 / 安装与更新 | `[x]` | `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSearchResult.kt:12-17`（本轮实测 17 行）；`newui/PluginUiModel.kt`、`MarketplaceTabSearchSortByOptions.kt`（族本体） | `src/pluginMarket.ts:2,64-70,95`+ 全文 439 行；`src/components/PluginMarketPanel.vue`（268 行，挂在 `PluginDialog` 的「市场」页） | 判据 `tests/plugin-market.test.mjs`（218 行）：读的是**工作区里的仓库目录**（`.taocode/plugins`），没有清单就扫目录里的 zip/jar 兜底；坏条目逐条报错不打空整页；`/outdated` 由此从待办变成真实过滤 |
| pf/plugins · ic/plugins | **远程/在线市场**（仓库拉取、下载、续传、评分、签名校验、账号授权） | `[-]` 有意不做（不是「难」） | `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/`（该族本体）；`PluginSignatureVerifier.kt`、`PluginRepositoryAuthService` | —— | 具体理由两条，都核过：① `index.html` 的 CSP 是 `connect-src 'self' ws://127.0.0.1:5173`，WebView2 里 fetch 远程 URL 被拦；② 宿主 `Method` 清单（`src/bridge.ts` 的联合类型 + `native/main.cpp` 的 switch）**没有任何网络通道**。做了就是假控件。同理 `PluginManagerConfigurableService` 的设置页服务、`UltimateDependencyChecker` 的付费依赖校验没有对象可校验（本仓插件全部来自用户配置目录） |
| ic/plugins | 插件信息提供者与**启用裁决**（能不能启、为什么不能启） | `[x]` | `platform/ide-core/plugins/`（`ic/plugins` 一族，5 个类） | `src/pluginInfo.ts:1,47,66,87,104`（175 行） | `canBeEnabled` / `pluginLoadingError(s)` 是 `PluginDialog` 复选框置灰与 `/invalid` 过滤的唯一口径（`pluginCanToggle`） |
| pf/action-macro | 宏录制 / 播放 / 编辑（重命名、删除、逐步删除、步骤上下移） | `[x]` | `platform/platform-impl/src/com/intellij/ide/actionMacro/ActionMacro.java`（本轮实测存在，同目录 `ActionMacroManager.kt`、`ActionMacroConfigurable.java`、`ActionMacroConfigurationPanel.java`）；`platform/platform-impl/resources/idea/PlatformActions.xml:506-510`（EditMenu 里的 `Macros` 子菜单）；`UIUtil.isReallyTypedEvent` = `platform/util/ui/src/com/intellij/util/ui/UIUtil.java:513-521` | `src/macros.ts:4,20,49-87,237`+ 全文 343 行；`src/macroHost.ts:38,43,57,75`（308 行）；`src/components/MacrosDialog.vue`（121 行）+ `MacroRecordingChip.vue`（38 行）；菜单 `src/menus/macrosMenu.ts`（46 行） | 判据 `tests/macros.test.mjs` + `tests/macro-session.test.mjs` + `tests/macro-keymap-actions.test.mjs`。**还差**：`ActionMacroConfigurationPanel` 的「插入动作 / 改键盘序列」那半张编辑面（本仓只能整体重录覆盖同名宏）—— 那是设置页形态，不是行为缺口 |
| lp/file-templates · ici/file-templates | 模板**变量表**（15 个预定义变量、`${VAR}`/`$VAR`、源根推包名、类名词干校验、未知变量原样保留） | `[x]` | `platform/lang-impl/src/com/intellij/ide/fileTemplates/`（`FileTemplateManager`/`FileTemplate` 族本体） | `src/fileTemplateVars.ts:1,21,49-65`+`:159-168`（`UserFileTemplate` 形状） | 判据 `tests/file-template-vars.test.mjs` |
| 同上 | 模板**文法**（`#if`/`#elseif`/`#else`/`#end`/`#set`/`#parse`、`${DS}` 转义、两类错误分工） | `[x]` | `#parse` 走 Includes：`platform/lang-impl/src/com/intellij/ide/fileTemplates/VelocityWrapper.java:80,82,84`（缺子模板抛 `ResourceNotFoundException`；本轮实测：这份文件**不在 `impl/` 子目录**里，仓里旧注释的 `fileTemplates/impl/VelocityWrapper.java` 是错路径 ⇒ 已按实测写全）；示例文档 `platform/platform-resources-en-file-templates/src/fileTemplates/default.html:62-67` | `src/fileTemplateParser.ts:22,34,248,415`（472 行） | 判据 `tests/file-template-parser.test.mjs`：成环跳过、缺失抛 `TemplateNotFoundError`、语法错包成一句可读的错 |
| 同上 | **加载器层**（五类别与目录前缀、两份方案目录、`.ft`/`.html` 规则、插件内置只读、类别分组） | `[x]` | `platform/lang-impl/src/com/intellij/ide/fileTemplates/impl/FileTemplatesLoader.kt:57,139-144`（`TEMPLATES_DIR = "fileTemplates"`）；`platform/ide-core-impl/src/com/intellij/ide/fileTemplates/FileTemplateManager.java:22-26`（五个类别常量）；`platform/ide-core-impl/src/com/intellij/ide/fileTemplates/PluginBundledTemplate.java:9-11`；`platform/ide-core-impl/src/com/intellij/ide/fileTemplates/FileTemplatesScheme.java:16-26` | `src/fileTemplateRegistry.ts:28-32,48,89-129,152,207-242`（805 行） | 判据 `tests/file-template-registry.test.mjs`；页面 `src/components/FileTemplatesSettingsPage.vue`（301 行）挂在 `TemplateSettingsPage.vue` 的子页切换上（本轮核实消费方） |
| 同上 | **展开结果真的落盘**（用户模板 + `${NAME}`） | `[~]` | `platform/lang-impl/src/com/intellij/ide/actions/CreateFileFromTemplateAction.java:76-79,84-85,93-97,105-106`；`fileTemplates/FileTemplateUtil.java:288-347,384` | `src/fileTemplateCreate.ts:25-50,73-87,104-130,140-148`（183 行，`planFileTemplateCreate` + `createFileFromTemplate` + `FileTemplateCreateIo`） | 本仓已有：建目录→建文件→写正文三步与冲突文案，设置页的「会写成这样」预览用的就是这条会写盘的路径；判据 `tests/template-create.test.mjs`。**还差**：App.vue 的 `nameDialog` 仍只把 `dialog.template` 当 `template_kind` 传（`src/App.vue:1773`），且那个 `<select>` 的 16 个 `<option>` 是硬编码内建 kind ⇒ 接线请求 W1（含整段可照抄代码） |
| lp/external-tools | 外部工具的**完整 bean 字段**（name/description/group/4×shownIn*/enabled/useConsole/showConsoleOnStd*/synchronizeAfterExecution/workingDirectory/program/parameters + outputFilters） | `[~]` | `platform/lang-impl/src/com/intellij/tools/Tool.java:56-76`（本轮实测该文件 452 行，逐字段核对：`:56` myName、`:57` myDescription、`:58` myGroup、`:62-65` 四个 `myShownIn*`（**上游自己标注"effectively not used anymore"，见 IDEA-190856 的注释**）、`:67` myEnabled、`:69-72` useConsole/两个 showConsole*/synchronizeAfterExecution、`:74` myWorkingDirectory、`:75-76` myProgram/myParameters；`outputFilters` 紧随其后）；编辑面 `ToolEditorDialog.java:100-121,137-158`（实测 170 行）；分组注册 `BaseToolManager.java:89-113,164` | `src/externalToolsRecords.ts:3-30`+ 全文 312 行；`src/externalToolsModel.ts:37-60`；页面 `src/components/ExternalToolsSettingsPage.vue`（306 行） | 本仓已有：name/command 落宿主设置，其余字段落 localStorage（与 `fileTypeOverrides.ts:34`、`macros.ts:306` 同一先例），`group`→子菜单、`enabled`→不进菜单、`synchronizeAfterExecution`→跑完按磁盘刷新（这三条是真消费者，不是死数据）。**还差**：`native/settings_schema.cpp:262-270` 的 `known_keys(entry, {"name","command"})` 会把多余键判 `INVALID_SETTINGS` ⇒ 接线请求 W2（放开字段，含整段 C++）；`outputFilters` 上游也没有运行时消费（`ToolEditorDialog.java:158` 只是存），如实标 `consumed:false` |
| lp/microservices | 端点索引与视图（`EndpointsView` 树 + 类级前缀合并 + 客户端端点） | `[x]` | `platform/lang-impl/src/com/intellij/microservices/`（族本体，本轮实测该目录有 `EndpointsViewListener.kt`/`EndpointsViewOpener.kt` 在 `platform/lang-api/src/com/intellij/microservices/endpoints/`） | `src/endpointIndex.ts:1`+ 134 行；`src/endpointRoutes.ts:1`+ 181 行；`src/components/EndpointsDialog.vue`（145 行，消费方 `src/App.vue`） | 数据源是真的：索引由 LSP 符号/诊断喂，没有假端点 |
| es/project-model · esa/model | 外部系统工程模型（`ExternalProjectInfo`/`DataNode`/`ExternalProjectData`） | `[x]` | `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/`（族本体，`src/externalSystemModel.ts:1` 逐条注） | `src/externalSystemModel.ts:1`+ 396 行；`src/externalSystemDataStorage.ts:2`+ 300 行；`src/externalSystemNameGenerator.ts:2`+ 151 行 | 判据 `tests/external-system-model.test.mjs`；消费 `src/gradleHost.ts`（758 行） |
| es/project-model · es/execution | **任务激活**的 7 个阶段与逐条语义（add 允许重复、remove 只删第一处、move 相邻交换且越界原样、按工作区根隔离、取消链接清状态） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/ExternalSystemTaskActivator.java:375-382`（本轮实测：`BEFORE_RUN`/`BEFORE_SYNC`/`AFTER_SYNC`/`BEFORE_COMPILE`/`AFTER_COMPILE`/`BEFORE_REBUILD`/`AFTER_REBUILD`，正好 7 档） | `src/externalProjectModel.ts:2`+ 195 行；执行消费 `src/gradleHost.ts`（同步前/后）与 `src/runActions.ts`（运行/构建/重建前三档） | 判据 `tests/external-tasks-activation.test.mjs`。**还差**（与判词一致且成立）：`AFTER_COMPILE`/`AFTER_REBUILD` 没有触发点——本仓构建完成只有宿主退出事件（`native/run_host.cpp` 的 beforeLaunch 链只能挂前面） |
| es/ui | 外部系统 UI（任务树 + 配置激活对话框） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/task/ui/ConfigureTasksActivationDialog.java`（本轮实测存在，同目录还有 `.form`）；树本体 `ExternalSystemTasksTree`/`ExternalSystemTasksTreeModel` | `src/externalTasksActivation.ts:2`+ 182 行；`src/components/ExternalTasksActivationDialog.vue`；挂点 `src/components/GradlePanel.vue`（341 行）的工程与任务右键 | 上游树只显示**有任务的阶段**，本仓为「能往空阶段添加」而全列 —— 差异写在模块头并进了判据 |
| es/actions | 节点动作矩阵 + 三个视图开关（忽略工程 / 显示已忽略 / 按任务分组 / 显示继承任务） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/action/`（`src/externalSystemActions.ts:1`、`src/externalSystemViewOptions.ts:1` 逐条注；上游 `ExternalSystemNodeAction.getNodeClass()` 分派） | `src/externalSystemActions.ts:1`+ 146 行；`src/externalSystemViewOptions.ts:1`+ 98 行；面板渲染在 `src/components/GradlePanel.vue` | 判据 `tests/external-system-actions.test.mjs`；持久化的刷新范围过滤消费者是 `src/gradleHost.ts` 的 `enqueue` |
| es/execution | 任务执行模型（脚本参数 / VM 参数 / 「工程名 [任务短名]」 / JDK 四档解析） | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/…`（`src/externalSystemTask.ts:1` 逐条注）；`AbstractExternalSystemTaskConfigurationType.generateName`；`ExternalSystemJdkUtil.matchJdkName` | `src/externalSystemTask.ts:1`+ 197 行；命令拼装/wrapper/离线在 `src/gradle.ts`（792 行） | 判据 `tests/external-system-task.test.mjs`。**还差**：任务编辑对话框（这些字段现在没有输入口），且运行配置节点的编辑动作没有宿主 ⇒ 那行带禁用原因渲染，不画假按钮 |
| es/autoimport | 自动导入三档 × 事件矩阵 + 决策 + 通知呈现 | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/autolink/`（`src/externalSystemAutoLink.ts:2,4` 实测存在）；`AutoImportProjectTracker.kt:214-228` 的三分支 | `src/externalSystemAutoImport.ts`（483 行）、`src/externalSystemAutoLink.ts` 45 行、`src/autoImportNotifications.ts`；消费 `src/gradleHost.ts` | 判据 `tests/auto-import-notifications.test.mjs` + `tests/external-system-auto-import.test.mjs`；**CRC 已落**（订正 #1） |
| es/dependency | 依赖分析与展示 | `[~]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/dependency/`（族本体） | `src/gradleHost.ts` 的依赖分组 + `src/components/GradlePanel.vue` | 还差：上游那张「替换建议」表要 `DependencyAnalyzerManager` 的真解析（Gradle 侧要跑构建脚本），本仓只有同步产物里的依赖清单 |
| esa/model | `ExternalSystemProject` 的存储与快照 | `[x]` | `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/`（`src/externalSystemDataStorage.ts:2`、`src/externalProjectModel.ts:2`） | 同上两文件 | 判据在册（`tests/external-system-*.test.mjs` 一族，454 里含） |
| es/* | 通用刷新队列 / `ExternalProjectsManagerImpl` 的刷新线程 / Maven 同步链 | `[-]` 架构不等价，不做假队列 | `platform/external-system-api/src/com/intellij/openapi/externalSystem/ExternalProjectManager.java`（族本体） | —— | 具体理由：本仓每条链路各自直接调 `gradle.sync`（`src/gradleHost.ts`），没有「多构建系统 + 线程池 + 取消队列」的对象；造一个队列只会是空转的调度器。Maven 侧只有设置页、没有同步后端（宿主没有 maven runner），画刷新按钮就是假控件 |

---

## 2. 改动文件（磁盘实况；`before` 用 `git diff --numstat` 折回 HEAD 态）

**上一提交（HEAD）以来被修改、且属于本域的文件**（`M`；格式 `文件 现状行数（+新增 −删除 ⇒ HEAD 态约 N 行）`）：

| 文件 | 现状 | 折回 |
|---|---|---|
| `native/gradle.cpp` | 89 行 | +8 −4 ⇒ 约 85 |
| `native/gradle_test.cpp` | 176 行 | +42 −0 ⇒ 约 134 |
| `native/java_lsp_paths.cpp` | 336 行 | +168 −95 ⇒ 约 263 |
| `native/java_lsp_paths.hpp` | 30 行新增段 | +30 −0 |
| `native/library_sources.hpp` | +2 | 只加两行（**本轮未动**，派单冻结） |
| `native/plugins.cpp` | 688 行 | +282 −9 ⇒ 约 415 |
| `native/plugins.hpp` | +47 | +47 −0 |
| `native/plugins_test.cpp` | 557 行 | +285 −0 ⇒ 约 272 |
| `native/workspace.cpp` | 1369 行 | +45 −112 ⇒ 约 1436（净减 67 行：拆分到别处的旧分支） |
| `src/components/FileTypesPage.vue` | 594 行 | +492 −7 ⇒ 约 109（这一页几乎重写） |
| `src/components/GradlePanel.vue` | 341 行 | +277 −273 ⇒ 约 337 |
| `src/components/MacrosDialog.vue` | 121 行 | +4 −1 |
| `src/components/PluginDialog.vue` | 392 行 | +115 −12 ⇒ 约 289 |
| `src/externalLibraries.ts` | 105 行 | +28 −5 |
| `src/gradle.ts` | 792 行 | +111 −4 |
| `src/gradleHost.ts` | 758 行 | +630 −305 ⇒ 约 433 |
| `src/macroHost.ts` | 308 行 | +131 −22 ⇒ 约 199 |
| `src/macros.ts` | 343 行 | +189 −4 ⇒ 约 158 |
| `src/menus/macrosMenu.ts` | 46 行 | +1 −1 |
| `src/pluginCommands.ts` | 105 行 | +14 −10 |
| `src/pluginGroups.ts` | 511 行 | +110 −11 ⇒ 约 412 |

**本域新文件（HEAD 里没有，`??` ⇒ 前值 = 不存在）**：`src/externalProjectModel.ts` 195、`src/externalSystemActions.ts` 146、
`src/externalSystemAfterBuild.ts` 68、`src/externalSystemAutoImport.ts` 483、`src/externalSystemAutoLink.ts` 45、
`src/externalSystemDataStorage.ts` 300、`src/externalSystemModel.ts` 396、`src/externalSystemNameGenerator.ts` 151、
`src/externalSystemSettingsCrc.ts` 120、`src/externalSystemTask.ts` 197、`src/externalSystemViewOptions.ts` 98、
`src/externalTasksActivation.ts` 182、`src/externalToolsModel.ts` 176、`src/externalToolsRecords.ts` 311、
`src/fileTypeDetection.ts` 330、`src/fileTypeIgnoredList.ts` 247、`src/fileTypeOverrides.ts` 302、
`src/fileTypePluginBeans.ts` 210、`src/fileTypeRegistry.ts` 805、`src/fileTypeRemovedMappings.ts` 230、
`src/libraryModel.ts` 353、`src/libraryRootDetection.ts` 417、`src/moduleScopes.ts` 492、`src/orderRoots.ts` 144、
`src/pluginInfo.ts` 175、`src/pluginMarket.ts` 439、`src/projectFileIndex.ts` 204、`src/projectRoots.ts` 137、
`src/rootsAttachScan.ts` 113、`src/rootsJarEntries.ts` 152、`src/rootsModel.ts` 375、`src/rootsSdkTable.ts` 220、
`src/rootAppearance.ts` 244、`src/fileTemplateParser.ts` 472、`src/fileTemplateRegistry.ts` 805、`src/fileTemplateVars.ts` 约 200、
`src/fileTemplateCreate.ts` 183、`src/endpointIndex.ts` 134、`src/endpointRoutes.ts` 181、
`src/components/EndpointsDialog.vue` 145、`src/components/ExternalToolsSettingsPage.vue` 306、
`src/components/FileTemplatesSettingsPage.vue` 301、`src/components/MacroRecordingChip.vue` 38、`src/components/PluginMarketPanel.vue` 268、
`native/java_lsp_paths_test.cpp` 170、`native/workspace_tree_ops.cpp` 118；
测试 `tests/ext-external-tools-records.test.mjs` 188、`tests/ext-file-type-approvals.test.mjs` 328、
`tests/ext-plugin-file-types.test.mjs` 161、`tests/gradle-host.test.mjs` 218、`tests/library-model.test.mjs` 172、
`tests/library-root-detection.test.mjs` 185、`tests/macro-keymap-actions.test.mjs` 137、`tests/macro-session.test.mjs` 90、
`tests/order-roots.test.mjs` 75、`tests/plugin-dependencies.test.mjs` 109、`tests/plugin-market.test.mjs` 218、
`tests/project-roots.test.mjs` 93、`tests/pv-mark-roots.test.mjs` 94、`tests/roots-attach-scan.test.mjs` 65、
`tests/roots-model.test.mjs` 160、`tests/roots-sdk-table.test.mjs` 134、`tests/template-create.test.mjs` 204。

> 行数口径：`wc -l`（`bucket-landing.mjs` 用 `split('\n')`，同一文件会比 `wc -l` 多 1，两处都对得上）。
> 新文件都在上限内（ts 900：最大 `src/fileTypeRegistry.ts` 805；native 1100：最大 `native/workspace.cpp` 1369 是**既有文件**、
> 且 `tests/module-size.test.mjs` 对它的现有档位没报红；`_test.cpp` 1300：最大 557）。

**本轮（写报告这一轮）我自己动过的文件**：`src/fileTypeDetection.ts`（反向验证注入 ⇒ 已原样撤回，见 §4）、
`docs/batch-2026-10-06-bucket2c.md`（订正一条上游路径）、`src/externalToolsRecords.ts:17`（把指向
`docs/wiring-requests-2026-10-06-bucket15b.md`（该文件从未被写出）的悬空指针改指本桶的接线请求文件）。

---

## 3. 验证

| 命令 | 结果 |
|---|---|
| `node --test tests/roots*.test.mjs tests/ext-*.test.mjs tests/fileType*.test.mjs tests/library*.test.mjs tests/macro*.test.mjs tests/plugin*.test.mjs tests/gradle*.test.mjs tests/vfs*.test.mjs` | 起手 **232 / 232 / 0**（与派单数字一致，复核成立）；收工复跑同一条命令 **242 / 242 / 0** —— 多出的 10 条是并发代理新增的 `tests/ext-jar-entries-channel.test.mjs`。（`tests/vfs*.test.mjs` 与 `tests/fileType*.test.mjs` 两段 glob 在仓里匹配不到文件，空转；VFS/文件类型的判据实际叫 `disk-sync*` / `file-type-*`） |
| 域内其余在册测试（`file-type-*` `file-template-*` `template*` `external*` `auto-import*` `module-scopes` `order-roots` `project-roots` `root-appearance` `pv-mark-roots` `disk-sync*`） | **454 / 454 通过 / 0 失败**（同一条命令合并上面 232 的口径） |
| `npx vue-tsc -b --force` | **0 错**（退出码 0）。桶 15 的「`src/macroHost.ts` 类型错」必修项已不成立 |
| `node .tools/find-param-props.mjs` | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 |
| `node .tools/find-missing-ext.mjs` | 干净（1198 个文件） |
| `node .tools/find-orphan-modules.mjs --gate` | 起手红 1 条（`src/rootsJarEntries.ts`，不属本域）⇒ 收工**绿**（该通道由另一代理在本轮中途接上，附带 10 条新用例） |
| `node --test tests/module-size.test.mjs` | 红：`src/components/CodeEditor.vue` 1156 > 上限 1147 —— 保留文件、桶 5 名下，**不属于本轮**，只登记 |
| `node --test tests/source-citations.test.mjs` | 接手时红 5 条，其中 **1 条在本桶名下**（`docs/batch-2026-10-06-bucket2c.md` 把 `CommandCompletionSuffixProvider.kt` 写成 `platform/lang-impl/...`，实测它在 `platform/analysis-api/...`）⇒ **本轮已订正**；剩 4 条在 `bucket14c.md` 与 `verdict-reconcile.md`（`TrustedProjectsDialog.kt` 与同一条 provider 路径），桶 14 / 主代理名下 ⇒ 只登记 |
| ctest（native） | **本轮未跑**，见 §6 第 1 条 |

---

## 4. 反向验证记录（本轮亲手做的注入）

域内所有「接线/消费链」类门禁在上一轮已由实现者逐条注入过（记录在 `docs/batch-2026-10-06-bucket14a.md` 同类报告的形状里）；
本轮代码没动，因此我只对**报告依赖最重的那条链**重做了一次真注入，并且撤回了：

| 门禁 | 注入的违规（改的是本域文件） | 结果 |
|---|---|---|
| `tests/file-type-registry.test.mjs:115-120`「接线：文件类型探测改走注册表（不是两套内置表）」 | `src/fileTypeDetection.ts:142` 的 `fileTypeManager.getFileTypeByFileName(fileName)` 改成 `getFileTypeByExtension(fileName)` | **2 条立刻红**：`✖ 接线：文件类型探测改走注册表`（字符串锚点不再命中）与 `✖ 消费链：进程内单例注册后编辑器语言判定立刻生效`（9 项中 2 失败）⇒ 这条门禁既盯字符串也盯行为 |
| 撤回 | 同一处改回 `getFileTypeByFileName` | `9 / 9 通过 / 0 失败`，恢复原状 |

另有一条**只读复核**（不改文件）：`tests/source-citations.test.mjs` 的门禁本身自证会响（它内置两条假引用用例），
本轮用它验证了订正后的 `CommandCompletionSuffixProvider.kt` 路径确实指得到
（`platform/analysis-api/src/com/intellij/codeInsight/completion/command/CommandCompletionSuffixProvider.kt`，37 行，`:23` = `fun suffix(): Char = '.'`、`:28` = `filterSuffix()`、`:30-36` = `supportFiltersWithDoublePrefix()`，与报告里的行号逐条对上）。

---

## 5. 零消费方自查

`node .tools/bucket-landing.mjs 15`（`WINDOW=2880`）标了 3 个「⚠ 零消费方（孤儿）」，**三个都是工具误报**：
它用「去掉 `src/` 前缀的整路径」去 grep，而组件之间的 import 是**相对说明符**（`./FileTemplatesSettingsPage.vue` 不含 `components/` 段）。逐条手工复核：

| 被标孤儿 | 实际消费方（grep 实测） |
|---|---|
| `src/menus/macrosMenu.ts` | `src/App.vue`、`src/menus/editMenu.ts` |
| `src/components/ExternalToolsSettingsPage.vue` | `src/components/SettingsDialog.vue`（`src/externalToolsModel.ts` 是它的数据侧） |
| `src/components/FileTemplatesSettingsPage.vue` | `src/components/TemplateSettingsPage.vue`（子页切换） |

其余新模块的消费方也逐个查过（不是看工具颜色）：`externalSystemSettingsCrc` ← `src/gradleHost.ts:43`、
`externalSystemAfterBuild` ← `src/runActions.ts`、`libraryRootDetection` ← `ProjectStructurePane.vue` + `rootsAttachScan.ts`、
`moduleScopes` ← `src/scopes.ts` + `ScopesSettingsPage.vue`、`rootAppearance` ← `ProjectStructurePane.vue`、
`projectFileIndex` ← `TabContextMenu.vue` + `src/copyPathActions.ts`、`fileTypeRemovedMappings` ← `FileTypesPage.vue` + `fileTypeRegistry.ts`、
`fileTypePluginBeans` ← `PluginDialog.vue` + `fileTypeOverrides.ts` + `pluginGroups.ts`、`PluginMarketPanel` ← `PluginDialog.vue`、
`ExternalTasksActivationDialog` ← `GradlePanel.vue`、`EndpointsDialog`/`MacroRecordingChip` ← `App.vue`。
唯一「引用已写、宿主通道未到」的是 `src/rootsJarEntries.ts`（← `src/jarEntriesSource.ts`），即门禁红的那条，按派单不动。

---

## 6. 做不到 / 无法核实

1. **native 的 ctest 结果本轮无法给出**：跑 `.tools/nctest-all.bat` 需要 `vcvars64.bat` + 一次全量 C++ 配置/构建；
   本轮是「补写报告 + 归零红测试」，没改任何 `native/*` 源文件（唯一被我改过的 `src/fileTypeDetection.ts` 已撤回），
   因此**没有属于本轮的 native 判据**。`native/plugins_test.cpp`（557 行）、`native/gradle_test.cpp`（176 行）、
   `native/java_lsp_paths_test.cpp`（170 行）是上一轮落的用例，其 ctest 通过与否本轮**未复核**（如实登记，不替它们背书）。
2. **`jar 当目录`（`JarFileSystem`/`ArchiveFileSystem`/`JarFileSystemImpl`）**：卡在宿主 Method 清单里没有档案条目通道；
   `src/rootsJarEntries.ts` 与 `src/jarEntriesSource.ts` 已就绪，等另一代理的宿主通道（本轮不动 `native/library_sources*.cpp`）。
3. **远程/在线插件市场**：CSP（`index.html` 的 `connect-src 'self' ws://127.0.0.1:5173`）与宿主网络通道两条都不成立，
   不是「本轮来不及」。同理签名校验、账号授权没有可挂的对象。
4. **`es/execution` 的 AFTER_COMPILE / AFTER_REBUILD 触发点**：本仓「构建结束」只有宿主进程退出事件
   （`native/run_host.cpp` 的 beforeLaunch 链），没有编译完成事件源。
5. **多内容根 / 多模块对象图**（`Module`/`ModuleRootManager` 的增删与 `ModuleRootEventImpl`）：本仓单根工作区，
   `src/bridge.ts` 的 Method 联合类型里没有任何 module 写回方法 —— 这是**架构性缺位**，不是补一行能解决。
6. **`ActionMacroConfigurationPanel` 的「插入动作 / 改键盘序列」编辑面**：键位在本仓是静态表（保留文件 `src/keymap*.ts`），
   没有「往宏里插一个键盘序列」的可写对象；本仓的替代是整体重录并覆盖同名宏（已落、有判据）。
7. **判词里 `pf/roots-ui` 的「按作用域/排除状态给文件颜色与图标」**：颜色通道在本仓是样式表（`src/style.css` 是保留文件），
   呈现服务只给「语义种类」不给色值 —— 要接必须先给样式表开一档，属主代理决定。
8. **无法核实（上游侧）**：`docs/inventory/verdict-platform_rest.md` 里引用的 `ExternalSystemViewOptions.kt` 与
   `ActionMacroManager.java` 两个文件名在本轮 `find` 里**搜不到**（实测：前者 0 命中；后者是 `ActionMacroManager.kt`）。
   语义/包路径两条路都走过（`externalSystem/action/` 目录里对应的是 Java/Kt 的其它类名）⇒ 结论：
   「视图开关」这一族的行为已按 `src/externalSystemViewOptions.ts` 落地并有判据，但**具体类名按判词写不出坐标**，不冒充。
9. **未认领改动 35 条**（`bucket-landing.mjs` 报的「没写进任何桶归属清单」）里与本域相邻的是
   `native/{dap,export_file,git,git_log,java_lsp_paths,library_sources,lsp_session,plugins,run_host,settings_schema}.hpp`
   与 `native/{crash_log,dap_routes,dap_shaping,git_detail,history_diff,trusted_paths,workspace_detail}.hpp`、
   `src/components/{AboutDialog,EditorPopupMenu,MainToolbar,SettingsDialog,TargetChooserPopup}.vue`、
   `src/components/{ConsoleSettingsPage,ExternalTasksActivationDialog}.vue`、`tests/vue-sfc-loader.mjs`。
   其中 **`ExternalTasksActivationDialog.vue` 是本域 es/ui 的落点**（`bucket-landing.mjs` 的「我拥有」栏只写了
   `ExternalToolsSettingsPage.vue`/`GradlePanel.vue`，漏了它 ⇒ 建议把这行补进任务书归属栏，或让主代理认领）；
   其余按命名与内容归桶 6/12/13/14，不属于本轮。
