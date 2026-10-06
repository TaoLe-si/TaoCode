# 批次报告 · 2026-10-06 · filetypes：文件类型 / VFS / 磁盘同步 / 文件模板的判词剩余

派单代号：`filetypes`。范围（判词八族）：`lp/file-types` `ic/file-types` `pf/file-types` `lp/exclude`
`pf/vfs` `ic/vfs` `lp/file-templates` `ici/file-templates`。

基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（全部本地亲开，未上网）。

---

## 0. 先说结论：**这八族的判词剩余几乎全被上一轮（无报告的）落掉了**

派单要求先看 `docs/batch-2026-10-06-bucket15.md` 与 `…-bucket15b2.md`。实况：

- `bucket15.md` 在（243 行，是「现场反推」的补写报告，其 §1 判词表把上面八族全判成 `[x]`/`[~]` 并留了四条「还差」）。
- **`bucket15b2.md` 不存在**（`ls docs/ | grep bucket15b2` 零命中）。但它实现的东西**在盘上**：
  bucket15 报告里那四条「还差 / 接线请求 W1-W3」**今天全部已落地**，逐条实数命中：

| 桶 15 报告留下的「还差」 | 现树实况（本轮亲验） |
|---|---|
| W1 新建文件对话框没接用户文件模板（`src/App.vue:1773` 只把 `dialog.template` 当 `template_kind`） | **已接**：`src/App.vue:152-153` 已 import `HOST_FILE_TEMPLATE_KINDS`/`fileTemplatesState`/`createFileFromTemplate`；`:244-249` 是 `nameDialogTemplates`（内建 16 + `user:` 前缀的用户模板）；`:1693-1699` 是 `user:` 分支走 `createFileFromTemplate`；`:2464` 的 `<option>` 已是 `v-for` |
| W2 `externalTools` 的宿主 schema 只认 `{name, command}` | **已放开**：`native/settings_transfer_test.cpp` 里那条「externalTools 的白名单按上游 Tool 的 bean 放开：缺键补默认、不按字段数判坏」用例本轮实跑 **绿**（`settings_transfer: all checks passed`，5 条） |
| W3 启动时没灌忽略清单 | **已灌**：`src/main.ts:6` import `loadIgnoredPatterns`。注意落地时**订正了请求原文**：`applyIgnoredPatterns(loadIgnoredPatterns())` 会多写一次 localStorage（`loadIgnoredPatterns()` 自己已经 apply，`src/fileTypeIgnoredList.ts:226-230`），这条口径钉在 `tests/file-type-ignored-list.test.mjs:151-165` |
| 桶 15j 要的 `file.archiveEntries` Method 登记 | **已进** `src/bridge.ts:109` 的 `Method` 联合类型（本轮 grep 实数命中） |
| `lp/file-types` 判词「缺：`FileTypeDetector` 的 EP 化 / 二进制短路」 | **已做**：探测器表 + `registerContentDetector()`（`src/fileTypeDetection.ts:117`）、二进制短路 `isBinaryContent()`（`:87`，`detectFileType` 第 2 步 `:204`、`resolveEditorLanguage` 第 2 步 `:263`） |
| `pf/file-types`/`ic/file-types` 判词「缺 `ReparseUtil` 显式重解析入口」 | **已做**：`reparseFileTypes()`（`src/fileTypeDetection.ts:337`）+ 探测缓存（`:312`）+ 版本号 `fileTypeRevision`（`:292`）；**按钮也有**：`src/components/FileTypesPage.vue:466` 那条「重新解析文件类型」 |
| `ic/file-types` 判词「缺 `UserFileType`/`UserBinaryFileType`/`NativeFileType`/`TemplateLanguageFileType`/`MockLanguageFileType` 各自的类与工厂」 | **已做**：五个工厂全在 `src/fileTypeRegistry.ts:717 / :724 / :735 / :744 / :754` |
| `lp/exclude` 判词「缺：覆盖成 PlainText **以外**的类型 / `UserFileTypeOverrider` 链路」 | **已做**：`changeFileTypeOverride(path, value)`（`src/fileTypeOverrides.ts:271`）、`overridableFileTypes()`（`:160`）、上游那两个谓词 `isOverridableType`（`:124`）/`isAvailableForOverride`（`:130`）都照 `OverrideFileTypeManager.java:69-78` 与 `:83-90` 落了；消费在 `src/fileTypeDetection.ts:165`（`overrideGuess`）与 `src/problems.ts:18` |

⇒ **本轮不重做这些**（派单第 1 条：已做的别重做）。本轮做的是：① 把这八族每一条**自己开上游数过**并订正 4 处错的/编的上游坐标；② 补一条真正还缺的行为判据（zip 归档读取的失败口径）；③ 把接不上的写成本域请求。

---

## 1. 判词表

`[x]` 已做且有判据 · `[~]` 本仓已有 + 还差（写全） · `[ ]` 未做（写卡点） · `[-]` 不适用（写具体理由）。
「上游」列的相对路径与行号**本轮全部亲自打开数过**（下表末尾是本轮新数到的行数）。

| 族 | 项 | 判定 | 上游依据（相对路径:行号） | 本仓落点（文件:行号） | 一句话说明 |
|---|---|---|---|---|---|
| ic/file-types | `FileTypeManager` 门面 + 注册表（register/unregister/associate/removeAssociation/consume/三档匹配/广播） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1864-1874`（`removeAssociation`）、`:1591-1619`（摘除账本参与判定）；`FileTypeAssocTable.findAssociatedFileType` 的匹配次序 | `src/fileTypeRegistry.ts:127,155,172,233,800`（819 行） | 判据 `tests/file-type-registry.test.mjs`；「注册后编辑器语言立刻变」那条消费链判据在册 |
| ic/file-types | `<fileType>` EP 的**两种用法**（声明新类型 vs 给已有类型补关联） | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java:29-30`（带 `implementationClass` = 新类型）与 `:36-41`（省掉它 = 只补关联，被引用类型必须已由别的标签注册） | `src/fileTypePluginBeans.ts:100`（`kind: bean.implementationClass && !existed ? 'type' : 'association'`） | **本轮订正**：原头注释把四个关联属性写成 `FileTypeBean.java:94-96`，实际是 `extensions:101`/`fileNames:108`/`patterns:116`（「不能含 `/`」在 `:114`）/`fileNamesCaseInsensitive:123`，「只按文件名匹配」是 `:46-48`；`PluginAware` 原写 `:57` 实为 `:59`（`implements PluginAware`，取用口 `:156-164`）。契约类**没有**被误判「不适用」，但**字段口径此前是错的** |
| ic/file-types | 忽略的文件与目录清单（增/改/删、校验、排序、恢复默认、分号掩码、集合比较） | `[x]` | `IgnoredFilesAndFoldersPanel.java:53-58,76-87,104,146-152,159-190,205-218,238-243`；`FileTypeManagerImpl.java:1142-1145,1148-1152,1156-1163,1166-1167`（本轮实测该文件 2025 行）；`PathUtilRt.java:199-227` | `src/fileTypeIgnoredList.ts:39,69,77,94,107,115,124,143,167,197,211,220,226`（247 行）；页面 `src/components/FileTypesPage.vue:309` | 判据 `tests/file-type-ignored-list.test.mjs`（166 行，含 main.ts 接线那条） |
| ic/file-types | 忽略清单**灌进文件树/搜索的过滤链** | `[~]` | `IgnoredFileCache.java:80-82`（`calcIgnored` 只按 `file.getNameSequence()`） | 本仓已有：`src/fileTypeIgnoredList.ts:233`（`isIgnoredName`）与 `:241`（`isPathIgnored`，逐段）、消费在 `src/fileChooserDescriptor.ts:236,270` 的 `hideIgnored` + `src/fileChooserModel.ts:551`；**还差**：项目树/预览与工程搜索不看它 | 卡点具体：过滤发生在 `src/bridge.ts`（`workspace.list`）与 `src/bridgePreview.ts:51,85`（**只读**），搜索侧合并点在 `src/searchExclusions.ts`（非本域）⇒ 写成请求 F1/F2 |
| ic/file-types | `UserFileType`/`UserBinaryFileType`/`NativeFileType`/`TemplateLanguageFileType`/`MockLanguageFileType` 的类与工厂 | `[x]` | `platform/ide-core/src/com/intellij/openapi/fileTypes/UserFileType.java:13,46-52,54-58,77-80`（94 行）、`UserBinaryFileType.java:6-7,16-19`（20 行）、`NativeFileType.java:19,49-51,54-61,63-105`（106 行） | `src/fileTypeRegistry.ts:717,724,735,744,754` | **本轮订正两处假类名**：仓里两处把二进制那一档说成 `BinaryFileType.isBinary()`、把不可抢说成 `ReadOnlyFileType` 那一族 —— 上游**都没有这两个类**（`find` 实数：`openapi/fileTypes` 下只有 `BinaryFileTypeDecompilers.java`）。真位是 `FileType.java:63` 的 `isBinary()`（恒真实现即上面两个文件）与 `FileType.java:69-71` 的 `isReadOnly()`（default false，唯一覆盖 `ex/FakeFileType.java:29`） |
| lp/file-types | 内容探测（shebang / XML / DOCTYPE / JSON / `#include` / Java / TS / markdown）+ 可注册的探测器 | `[x]` | **`platform/core-api/src/com/intellij/openapi/fileTypes/FileTypeRegistry.java:156`（嵌套接口 `FileTypeDetector`）、`:157`（`EP_NAME = "com.intellij.fileTypeDetector"`）、`:168`（`detect(file, firstBytes, firstCharsIfText)`）、`:176-178`（`getDesiredContentPrefixLength()` 默认 1024）**（185 行）；`HashBangFileTypeDetector.kt:15-29`（30 行） | `src/fileTypeDetection.ts:67,117,127,132,137`（351 行） | **本轮订正一条判词级假陈述**：`src/fileTypeDetection.ts` 原写「`FileTypeDetector` 上游树里没有这个文件（已核实）」⇒ 错。它在**门面文件的嵌套接口**里（按文件名搜不到 ≠ 不存在）。已改为真坐标，并把「本仓照 EP 形状做」的说法落到能核实的两处（EP + `FileTypeBean.hashBangs:144`） |
| lp/file-types | 二进制短路 | `[x]` | `FileType.java:63`；`NativeFileType.java:48-51`；`UserBinaryFileType.java:16-19` | `src/fileTypeDetection.ts:87`，两个消费点 `:204`（`detectFileType`）与 `:263`（`resolveEditorLanguage`） | 复用 `src/vcsFileUtil.ts` 的字节级 `looksBinary`，不另写一套 |
| lp/file-types | 探测接进打开流程 | `[x]` | `FileTypeManagerImpl.java:916-923`（`getFileTypeByFile` 的判定次序） | `src/App.vue` 的 `associationOf` → `src/fileTypeDetection.ts:260`；判据 `tests/file-type-detection.test.mjs:73-77`（钉 App 把 `tab.content` 传进来） | 判词那条「缺：把探测接进打开流程」早在桶 15 就被判为过期，本轮复核仍成立 |
| lp/file-types | 「高置信度内容覆盖扩展名」这一条**与上游次序不同** | `[~]` **本轮不改，交给主代理** | `FileTypeManagerImpl.java:925-934`：只有 `getByFile` 返回 `null` 或 `DetectedByContentFileType.INSTANCE` 时才跑 `detectionService.getOrDetectFromContent`（`:931-933`） | `src/fileTypeDetection.ts:201-232`（次序：覆盖 > 二进制 > shebang > 高置信度内容 > 扩展名 > 低置信度内容）；差异已写进模块注释 `:179-189` | 后果可观察：`tool.txt` 首行 `#!/usr/bin/env python3` 在本仓改判 Python，照上游应是 PlainText。**不改的理由**：`tests/file-type-detection.test.mjs:31-44` 与 `:46-54` 两条断言把现次序**钉住了**，而 `.tools/agent-rules.md` §3 禁止放松既有断言；改它要连断言一起动 ⇒ 主代理决定。本轮把上游坐标钉准并留痕，不藏 |
| pf/file-types | 冲突与摘除映射的审批 | `[x]` | `ConflictingFileTypeMappingTracker.java:107-114`（比厂商，本轮实测命中）、`:161`；`RemovedMappingTracker.java`；`FileTypeManagerImpl.java:1353,1591-1619,1849-1852` | `src/fileTypeRemovedMappings.ts`（230 行）+ `src/fileTypeRegistry.ts:172`；审批面 `src/components/FileTypesPage.vue` | 判据 `tests/ext-file-type-approvals.test.mjs`（328 行）+ `tests/file-type-conflict.test.mjs` |
| pf/file-types | 显式「重新解析文件类型」 | `[x]` | `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/ReparseUtil.kt:11-17`（16/17 行：后台写动作里 `FileContentUtilCore.reparseFiles(changed)`）；`FileTypeDetectionService.java:330-340`（`clearCaches` / `onDetectorListChange`） | `src/fileTypeDetection.ts:292,312,327,337,344` + 按钮 `src/components/FileTypesPage.vue:466-467` | 上游是「后台重解析」，本仓等价物 = 清探测缓存 + `fileTypeRevision` 自增 ⇒ 已打开的标签页当场按新规则重算语言；注册表变更也自动触发（`src/fileTypeDetection.ts` 底部那条 listener） |
| lp/exclude | 按文件覆盖成**任意**类型 | `[x]` | `OverrideFileTypeManager.java:69-78`（`isOverridable`）与 `:83-90`（`isAvailableForOverride`，本轮实测 91 行）；`OverrideFileTypeAction.java:53-76`（136 行，按显示名排序 + `:64-72` 的「来自插件 X」）；`UserFileTypeOverrider.java:17-24`（25 行）；`PersistentFileSetManager.java:90-96,104-118` | `src/fileTypeOverrides.ts:111,124,130,160,182,188,204,237,254,271,280,289`（302 行） | 消费两处：`src/fileTypeDetection.ts:165`（编辑器语言）与 `src/problems.ts:18`（退出诊断聚合）；管理面 `src/components/FileTypesPage.vue:471` |
| lp/exclude | 覆盖入口在**文件右键菜单** | `[ ]` 卡挂点 | 同上 `OverrideFileTypeAction.java:53-76` | 本仓两个入口：`src/components/ProblemsPanel.vue:137` 与文件类型页；**没有**文件树右键项 | 菜单在 `src/components/EditorPopupMenu.vue` / `src/App.vue`（均非本域）⇒ 请求 F3（模型侧一整套已就绪） |
| lp/exclude | 项目级排除目录的**路径粒度** | `[~]` | `platform/projectModel-api/src/com/intellij/openapi/roots/ContentEntry.java:92`（按路径记 excludeFolder） | `src/projectRoots.ts:49-70`（按目录段名命中） | 桶 15 已判，本轮复核仍成立：`ProjectSettings.excludedDirs` 是**目录名表**，改粒度要动 `src/settingsModel.ts`（只读）；口径如实钉在 `tests/pv-mark-roots.test.mjs` |
| pf/vfs | 本机 FS 抽象：读写/移动/删除/回收站 + 安全写 + 大文件写 | `[x]` | `platform/ide-core/src/com/intellij/openapi/vfs/`（`VirtualFileManager`/`SafeWriteRequestor`/`LargeFileWriteRequestor` 族本体） | `native/workspace.cpp`（`replace_safely`：临时文件 + 备份 + 原子替换）、`src/diskSync.ts:53,58` | 开关 = `GeneralSettings.isUseSafeWrite`，`safeWrite` 真的进 `file.write`；判据 `tests/tab-listener-behavior.test.mjs:37,66`（**注意**：桶 15 报告说判据在 `tests/disk-sync.test.mjs` —— 该文件**不存在**，本轮订正，见 §5） |
| pf/vfs · ic/vfs | 磁盘对账：焦点/可见性/后台空闲/切标签/手动 Reload | `[x]` | `SaveAndSyncHandlerImpl.kt:596-611,649,750-752`；`GeneralSettings.kt:67-71`；注册键 `vfs.background.refresh.on.idle`（默认 true）与 `vfs.background.refresh.interval`（15s） | `src/diskSync.ts:105,112,125,129,135,141,145`（246 行） | 判据 `tests/tab-listener-behavior.test.mjs`；15_000 走的是**毫秒常量 + 上游键名注释**，不是裸魔法数（规则里的硬编码毫秒指 CSS 动效时长） |
| pf/vfs · ic/vfs | 变更监视 + 溢出/重启上报 + 构建工具自动重载 | `[x]` | `platform/ide-core/src/com/intellij/openapi/vfs/`（watcher 一族语义） | `native/watcher.cpp`（310 行）、`src/diskSync.ts:156,174,203` | `fsChanges` 400ms 合并一批，`watchStopped` 那条给「监听死了/重启了」说人话；空数组 = 溢出 ⇒ `src/gradleHost.ts` 按 `autoReloadType` 三档判 |
| ic/vfs | **archive（zip）读取的失败口径** | `[x]` **本轮新补** | 上游这一面在本仓的可核实对应物是 `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9-12` 那族「档案只读」的语义（`ArchiveFileSystem.java:99-100,114-115` 的 `copyFile`/`deleteFile` 一律抛）——**它从不假装读得出读不了的东西** | `native/zipstore.cpp:177-214`（新增：先问 `method`（偏移 8）、`flag` bit 0（加密）、bit 3（流式大小），任何一种不支持就抛，**不再把压缩字节当内容**）；口径写进 `native/zipstore.hpp:41-47`；判据 `native/zipstore_test.cpp:43-73,105-152` | 之前是真缺陷：`read_archive` 完全不看 method ⇒ 外部工具打的 deflate 包（IDEA 导出、7-Zip、Windows 压缩）会读出乱码，`settings_transfer` 于是报「归档里的设置不是合法的 JSON」，**把真原因盖掉**。现在报「条目用了压缩方法 8，本仓的 zip 读取只支持 store（方法 0）」 |
| ic/vfs | jar 当目录（档案条目清单） | `[x]`（桶 15j 落的，本轮复核） | `JarFileSystem.java:9-12`；`ArchiveFileSystem.java:32,34,50,68,86,92`；`JarFileSystemImpl.java:23,25,30,53,69`；`URLUtil.java:37,39`（`JAR_SEPARATOR = "!/"`） | `native/file_queries.cpp`（`archive_entries` 走 `bsdtar -tf`）、`src/jarEntriesSource.ts`、`src/components/JarEntriesPane.vue` | 本轮只复核 + 报状态：**Method 已进 `src/bridge.ts:109`**（桶 15j 当时是「等登记」）。仍不支持套娃归档、条目行仍不能点开看内容（`JarFileSystemImpl.java:69` 那条 `findFileByPath` 本仓无对应） |
| ic/vfs | 按文件编码记忆 + 库源码按需读 | `[x]` | `EncodingRegistry`/`EncodingProjectManagerImpl` 的可移植子集 | `src/sessionEncodings.ts`、`src/sessionSnapshot.ts`、`native/library_sources.hpp` | 判据 `tests/session-encoding.test.mjs`（本轮实跑绿）：崩溃恢复按记住的编码重读 |
| pf/vfs | 持久化 VFS 影子记录（`FSRecords`/`FileNameCache`/`CheckVFSHealthAction`/`MarkVfsCorruptedAction`） | `[-]` 架构不等价 | `platform/platform-impl/src/com/intellij/openapi/vfs/newvfs/persistent/`（族本体） | —— | 具体理由：本仓以**操作系统为真源**，不建影子记录库；自检动作没有记录库可查。这不是「机械降级」——是没有任何用户可见行为可以落（没有「VFS 坏了」这个可观察状态） |
| pf/vfs | 符号链接策略（`CanonicalPathMap`/`SymbolicLinkRefresher`） | `[-]` 有等价物，不补第二套 | `platform/ide-core/src/com/intellij/openapi/vfs/`（`SymlinksCapableFileSystem` 一族） | `native/workspace.cpp:382-384`（`fs::canonical` + 双向 `within` 判越界）、`:1311-1325`（`recursive_directory_iterator` 默认**不**跟随目录符号链接，且 `:1325` 显式 `entry.is_symlink() ⇒ continue`） | 本轮实测两条都在 ⇒ 有环检测与规范化，只是没有独立映射层；再包一层 `CanonicalPathMap` 是本仓没有的对象模型 |
| pf/vfs | `VirtualFileInfoAction`（文件信息对话框：size / 修改时间） | `[ ]` 卡宿主通道 | 见「无法核实」§6.2 —— 该动作类名在本地树里 `find` 零命中 | —— | 具体卡点：`src/bridge.ts:109` 整条 `Method` 联合类型里没有任何 size/mtime；`file.read` 只回 `{content, version, encoding, bom, readOnly}` ⇒ 请求 F4 |
| lp/file-templates | 变量表 / 文法 / 加载器层 | `[x]` | `platform/lang-impl/src/com/intellij/ide/fileTemplates/`（`FileTemplateManager`/`FileTemplate` 族）；`FileTemplatesLoader.kt:57,139-144`；`FileTemplateManager.java:22-26`；`PluginBundledTemplate.java:9-11`；`FileTemplatesScheme.java:16-26`；`VelocityWrapper.java:80,82,84` | `src/fileTemplateVars.ts:21,49-65,159-168`（183 行）、`src/fileTemplateParser.ts:22,34,248,415`（472 行）、`src/fileTemplateRegistry.ts:28-32,48,89-129,152,207-242`（260 行） | 判据 `tests/file-template-{vars,parser,registry}.test.mjs`（本轮三条全绿） |
| lp/ici/file-templates | **展开结果真的落盘** | `[x]`（本轮复核，判词那条已过期） | `CreateFileFromTemplateAction.java:68-120`（`:76-79` MkDirs、`:84-85` 变量并进去、`:93-97` openFile、`:105-106` 解析失败包错）；`FileTemplateUtil.java:288-347,384` | `src/fileTemplateCreate.ts:25-29,73-87,104-130,140-148`（165 行）+ 已接进 App（见 §0 表） | 通道 = `file.create` 建 + `file.write` 写，不需要新宿主方法；判据 `tests/template-create.test.mjs` |
| ici/file-templates | 用户模板的**持久化存储段**（宿主设置里那一段） | `[~]` | `PersistentFileSetManager` 同族的应用级 XML 组件形态 | 用户模板存 localStorage（`src/fileTemplateRegistry.ts` 的 `fileTemplatesState`），设置页 `src/components/FileTemplatesSettingsPage.vue` 读写同一份 | 还差：宿主 `native/settings_schema.cpp` 没有这一段 ⇒ 不随项目/换机走。要不要开这个键是**决策**（作用域 + 「缺键补默认」那条纪律），写成请求 F5，本轮不自建 |

---

## 2. 本轮改动文件清单（`wc -l` 前后）

改前值 = HEAD 态（`git diff --numstat` 折回）。本轮**没有新建 src/native 源文件**，只新增两份文档。

| 文件 | 现状 | 前值 | 改动性质 |
|---|---|---|---|
| `src/fileTypeDetection.ts` | 351 | 330（+34 −13） | 只改注释：订正 `FileTypeDetector` EP 的真坐标、`BinaryFileType` 假类名、`FileTypeBean.hashBangs` 与 `FileUtil.isHashBangLine` 的行号、把「内容与扩展名次序 ≠ 上游」这条差异连同上游坐标写进 `detectFileType` 的文档 |
| `src/fileTypeRegistry.ts` | 819 | 805（+21 −7） | 只改注释：`isReadOnlyType` 与 `checkHashBangConflict` 两处删掉不存在的 `ReadOnlyFileType`，改成 `FileType.java:69-71` + `ex/FakeFileType.java:29` + `FileTypeConfigurable.java:393-398,827-850` 的实测口径 |
| `src/fileTypePluginBeans.ts` | 216 | 210（+16 −10） | 只改注释：`FileTypeBean` 四种关联属性与两种用法的行号按实测重写（`:29-30` / `:36-41` 的口径分开）；`PluginAware` `:57→:59`；重名错误 `:49-54→:52-53` |
| `native/zipstore.cpp` | 214 | 200（+14 −0） | **行为**：`read_archive` 在读数据之前判 `method != 0` / 加密位 / 流式大小位，各自抛出说清是哪一种 |
| `native/zipstore.hpp` | 53 | 48（+6 −1） | 把上面那条口径写进 `read_archive` 的声明注释（谁是调用方、为什么不能吐压缩字节） |
| `native/zipstore_test.cpp` | 192 | 106（+86 −0） | 3 条新用例（deflate / 加密+流式 / 「store 带 0x0800 名字标志必须照旧读得出」反向控制），+ 一个手拼本地头的 `raw_local_entry` 夹具 |
| `docs/batch-2026-10-06-filetypes.md` | 本文件 | 新建 | 交付报告 |
| `docs/wiring-requests-2026-10-06-filetypes.md` | 98 | 新建 | 5 条请求 + 4 条「已落，别再误接」 |

**本轮没有动的八族文件**（因为它们已经把判词说的事做完了，重做就是造第二套真源）：
`src/fileTypes.ts`(47) `src/diskSync.ts`(246) `src/filenameWidget.ts`(186)
`src/fileTypeIgnoredList.ts`(247) `src/fileTypeOverrides.ts`(302) `src/fileTypeRemovedMappings.ts`(230)
`src/fileTemplate{Create,Parser,Registry,Vars}.ts`(165/472/260/183) `native/watcher.cpp`(310)
`native/workspace.cpp`(1368) `src/components/FileTypesPage.vue`(593) `FileTemplatesSettingsPage.vue`(301)。

---

## 3. §5 每条自查命令的**前后数字**

| 命令 | 前 | 后 |
|---|---|---|
| `node --test tests/file-type-*.test.mjs tests/file-template-*.test.mjs tests/ext-*.test.mjs tests/template-create.test.mjs tests/filename-widget.test.mjs tests/tab-listener-behavior.test.mjs tests/session-encoding.test.mjs` | **171 / 171 / 0** | **171 / 171 / 0**（本轮没动任何断言：只改注释 + native） |
| 派单原句 `node --test tests/fileType*.test.mjs tests/vfs*.test.mjs tests/ext-*.test.mjs tests/module-size.test.mjs` | 前两段 glob **在仓里匹配不到文件**（域内测试实名是 `file-type-*` / `file-template-*`，VFS 侧是 `tab-listener-behavior` / `session-encoding`）；`ext-*` 4 个文件 | 同前，不重命名（改名会把别人写的 20 多处引用打散）；改用上面那条能命中文件名的命令 |
| `npx vue-tsc -b --force` | 起手（本轮第一次跑）**1 条**：`src/components/TestRunnerPanel.vue(238,59) TS7053` | 收工复跑仍是**那 1 条**（他人在途文件，非本域）。派单给的基线「`SearchPanel.vue` 3 条」本轮**已不存在** —— 那位代理修掉了，同时冒出新的一条 ⇒ 基线漂移如实登记 |
| `node --test tests/module-size.test.mjs` | 起手红 2 条（`src/components/SearchPanel.vue` 902 > 900 未登记、`native/git.cpp` 954 > 938）—— 都不是本域 | **5 / 5 / 0 全绿**（那两条被别人修好了）。本轮新值：`zipstore.cpp` 214 ≤ 1100、`zipstore_test.cpp` 192 ≤ 1300、`fileTypeDetection.ts` 351 ≤ 900、`fileTypeRegistry.ts` 819 ≤ 900 ⇒ **上限一个都没动** |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 起手那一跑报「1 个文件含真 TS 语法」（**不是本域**：本轮没碰任何 `.mjs`），收工复跑「干净：tests/*.mjs 全部是纯 JavaScript」 | 干净（并发代理自己修掉了，留痕） |
| `node .tools/find-missing-ext.mjs` | 干净（1254 文件） | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记孤儿 9 / 基线 9 · **新增 0** · 绿 | 同样 **新增 0** · 绿（本轮没新建模块） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11 / 11 / 0 | 中途**红过 1 条**（本轮订正时把已入快照的 `NativeFileType.java:48-51` 改成 `49-51` ⇒ 锚点门控 `moved ::` 报警），**已改回 48-51** 后复绿 11 / 11 / 0。没有重算快照（那会把别人的在途引用一起吸收掉） |
| `ctest`（native，本轮改了 `native/*`） | —— | **`zipstore_archive`：8 passed / 0 failed**（`zipstore tests passed`）；**`settings_transfer`（同库 `taocode_diagnostics` 的下游）：5 条全 ok**（`settings_transfer: all checks passed`）。全量 `npm run test:native` 本轮**没跑**：12 路并发下 `native/` 有多个别人的在途文件（桶 15j 就是被 `lsp_fake_server_requests.cpp` 的语法错挡住的），只交本域两个可执行用例的数字，且看的是日志里 `passed` 那行而不是退出码 |

---

## 4. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

本轮唯一的新门禁是 native 的 zip 失败口径。三步都做了，**没有用 git checkout/reset/stash**：
先 `cp native/zipstore.cpp build/ft-zipstore.cpp.bak` 并 `md5sum` 记下 `96a1c0580aedc3025213934502107847`，
改完重跑同一命令比 md5 一致才认。

| 步 | 动作 | 结果 |
|---|---|---|
| 基线 | 新用例 + 新守卫 | `zipstore tests passed`：**8 ok / 0 FAIL** |
| 注入 A | 守卫改成 `if (false && method != 0)` | `FAIL 不是 store 的条目要**说清读不了**…`（报的是「deflate 条目竟被当成内容读出来了」） |
| 注入 B（同批） | 三条守卫全 `if (false && …)` | **8 条里 2 FAIL**（deflate 那条 + 「加密条目与流式大小条目各自抛错」那条）；**第 3 条新用例保持 ok** —— 它是「别把标志位一刀切拒了」的反向控制，正好证明守卫**不是越严越好**：带 `0x0800`（UTF-8 名字）的 store 条目必须照旧读得出 |
| 撤掉 | `cp` 还原 + `md5sum` 一致 + `cmake --build build --target zipstore_test` 重链 | `zipstore tests passed` **8 / 0**；`settings_transfer` 再跑 **5 / 5** |
| 只读复核（不改文件） | 引用门自证：`tests/source-citation-anchors.test.mjs` 内置两条假引用用例照绿；本轮它对**我自己的一次改错**真的报了红（见 §3 倒数第二条）⇒ 锚点门是活的 | 红→绿一次真实往返，非人为注入 |

判词级「反向验证」还有一条：§0 那张表里 8 项「判词说缺、其实早做过」，**每一项都给了实数行号**（不是引用桶 15 的结论）。
其中 3 项是桶 15 报告**之后**才落的（W1/W2/W3 + Method 登记），桶 15 报告本身把它们写成「还差 / 待接」。

---

## 5. 零消费方自查

`node .tools/find-orphan-modules.mjs --gate`：**新增 0**（本轮没新建 `.ts/.vue` 模块）。

本轮新增/改动的东西逐条查消费方（不是看工具颜色）：

| 项 | 消费方 |
|---|---|
| `native/zipstore.cpp` 的新守卫 | `native/settings_transfer.cpp:87`（`read_archive`）与 `:71`（`read_archive_summary`）；再上游是 `src/bridge.ts:109` 的 `app.readSettingsArchive` 与 `native/projects.cpp:796`（导入设置）。⇒ **在真链路上**，不是只过自己测试的死代码 |
| `native/zipstore_test.cpp` 新用例 | ctest 在册（`CMakeLists.txt:212-214`，`add_test(NAME zipstore_archive)`），本轮没往 `CMakeLists.txt` 加任何条目 |
| `src/fileTypeDetection.ts` 的新注释里点到的 `reparseFileTypes` / `detectFileTypeCached` / `fileTypeRevision` | `src/components/FileTypesPage.vue:31,361-364,466`（按钮 + 提示）与 `:309` 的 `applyIgnoredPatterns` 之后重算 |
| `src/fileTypeIgnoredList.ts` 的 `isPathIgnored` | **只有测试**（`tests/file-type-ignored-list.test.mjs:136-139`）⇒ 这正是本轮判 `[~]` 的那条（文件树/搜索没接），已写请求 F1/F2；模块头 `:237-240` 已写明「等按路径过滤的消费方」，不是孤儿模块（模块本身有 main.ts/设置页两个消费方） |

## 5b. 顺手抓到的一条假记录（订正）

`docs/batch-2026-10-06-bucket15.md:67` 与 `:165` 两处说磁盘同步的判据在 `tests/disk-sync.test.mjs`。
**该文件不存在**（`ls tests/ | grep -i disk` 只有 `inspection-profile-disk-wiring.test.mjs`；全 `tests/` grep `diskSync` 只命中
`gradle.test.mjs:376` 与 `tab-listener-behavior.test.mjs:15,37,66`）。⇒ `src/diskSync.ts` 的真判据是
**`tests/tab-listener-behavior.test.mjs`**（`diskSupersedesBuffer`/`shouldSyncTabFromDisk` 两条语义 + 读源文件的接线锚）。
本轮**只在这里订正并给行号**，不改别人那份报告（避免和并发代理的写入撞车），主代理可把这条并入勘误。

---

## 6. 做不到 / 无法核实

1. **deflate 归档的读取**（`native/zipstore.cpp`）：**没做，本轮只把「读不了」说清楚**。
   具体卡点：本仓原生层不引压缩库（`CMakeLists.txt` 只拉 nlohmann/json，且 `CMakeLists.txt` 是保留文件），
   自己写 inflate（Huffman + LZ77 滑窗）是数百行的活，超出本轮预算且风险高。
   可选路径（供主代理定）：① 复用桶 15j 在 `native/file_queries.cpp` 已经验证过的 `bsdtar` 外部调用
   （`tar -xf`）解 deflate —— 代价是多一次进程创建；② 引第三方（要改 `CMakeLists.txt`）。
   现状的用户可见后果：**导入外部工具打的设置 zip 会明确告诉你「用了压缩方法 8，本仓只支持 store」**，
   而不是像之前那样报一句误导性的「归档里的设置不是合法的 JSON」。
2. **`VirtualFileInfoAction` 的上游坐标**：**无法核实**。`find -name 'VirtualFileInfoAction*'` 在本地参考树里零命中
   （语义/包路径两条路都走过：`platform/platform-impl/src/com/intellij/openapi/vfs/` 下没有这个类名）。
   判词 `verdict-platform_rest.md:57` ⑤ 直接用了这个类名，本轮按 §1 的规则**不冒充行号**，只把「宿主没有 size/mtime 通道」
   这条能核实的部分留下（`src/bridge.ts:109` 的整条 `Method` 联合类型里没有它）⇒ 请求 F4。
3. **`fileTypes`/`excludedDirs` 与宿主设置的存储段**：本轮不自开新键。理由两条：① 设置键表与
   `native/settings_schema.cpp` 的已知键是别人的可改面（且 `src/settingsModel.ts` 只读）；
   ② 新增键必须「旧存档缺键补默认」，本仓真出过把用户锁在项目外的事故 ⇒ 请求 F5，只提决策不塞代码。
4. **内容探测次序回到上游**：技术上能做（把 shebang/高置信度内容挪到「按名字没认出来」之后），
   但要**同时改两条既有断言**（`tests/file-type-detection.test.mjs:31-44`、`:46-54`）——
   那是 §3 铁律禁止的「放松既有断言」，除非证明原作者钉错。本轮的处置：上游坐标钉准 + 后果写清 + 交主代理判（§1 里那一行）。
5. **`UserFileType.getEditor()` 那半张「编辑用户自定义类型」的对话框**：上游是
   `UserFileType.java:23` 的抽象 `SettingsEditor<T> getEditor()` + `:61-75` 的图标加载（`IconLoader`/`PlatformIcons.CUSTOM_FILE_ICON`）。
   本仓**接不上**：① 图标是 Swing `Icon`，DOM 侧的图标口径是 `lucide-vue-next` + `src/uiIcons.ts`（保留文件）；
   ② `getEditor()` 的宿主是「文件类型设置页里那个类型自己的子面板」，本仓那张面板是 `src/components/FileTypesPage.vue`
   单页 + 保留的 `src/settingsTreeMeta.ts` 决定挂点。⇒ 类型工厂已有（`:717` 等五个），编辑面没有可挂的位置，
   已在本文件的 orphan 说明里写过（`src/fileTypeRegistry.ts:701-716` 的注释），没有再放假按钮。
6. **本轮没跑全量 `npm test`**（12 路并发，全量会把别人的在途红算到我头上）；**没起图形界面**；
   临时件 `build/ft-zip-test.bat` 与 `build/ft-zipstore.cpp.bak` 收工已删。
