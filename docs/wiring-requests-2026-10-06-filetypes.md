# 接线请求 · 2026-10-06 · filetypes 族（文件类型 / VFS / 磁盘同步 / 文件模板）

本轮**没有**改任何保留文件。下面每条的目标都在别人的可改面里（`src/bridge*`、`src/App.vue`、
`src/searchExclusions.ts`、`native/settings_schema.cpp`），按 `.tools/agent-rules.md` §2 只提请求。
行号是 2026-10-06 现树实测（工作区在并发变动中，落地前请重读目标区域）。

**先说三条「不用再提」的**（本轮核实到已经落了，别重复接）：
- 桶 15 的 **W1（新建文件对话框接用户文件模板）已落**：`src/App.vue:152-153` 已 import
  `HOST_FILE_TEMPLATE_KINDS`/`fileTemplatesState`/`createFileFromTemplate`，`:244-249` 是那个
  `nameDialogTemplates` 计算属性，`:1693-1699` 是 `user:` 前缀分支，`:2464` 是 `v-for` 的 `<option>`。
- 桶 15 的 **W3（启动时灌忽略清单）已落**：`src/main.ts:6` import `loadIgnoredPatterns`（注意：
  请求原文给的 `applyIgnoredPatterns(loadIgnoredPatterns())` 会多写一次 localStorage，
  落地时改成了只调 `loadIgnoredPatterns()` —— `src/fileTypeIgnoredList.ts:226-230` 自己已经 apply，
  这条口径钉在 `tests/file-type-ignored-list.test.mjs:151-165`）。
- 桶 15j 要的 **`file.archiveEntries` 已进 `Method` 联合类型**（`src/bridge.ts:109` 实数命中），
  `src/jarEntriesSource.ts` 那处窄化 cast 可以删了（不属于本域，只是顺手报个状态）。
- 桶 15 的 **W2（externalTools 放开完整 bean 字段）已落**：`native/settings_transfer_test.cpp`
  里已经有那条「externalTools 的白名单按上游 Tool 的 bean 放开：缺键补默认、不按字段数判坏」用例并且跑绿。

---

## F1 · 把「忽略的文件与目录」灌进文件树 / 预览的过滤链

- **目标文件**：`src/bridge.ts`（`workspace.list` 的落地处与 `Entry[]` 过滤）与 `src/bridgePreview.ts:51`、
  `:85`（预览侧那段已经按 `excludedDirs` 过滤的代码）。
- **要接什么**：`src/fileTypeIgnoredList.ts:241` 的 `isPathIgnored(path)`（路径**任一段**命中忽略掩码即真）
  与 `:233` 的 `isIgnoredName(name)`（单个名字，上游 `FileTypeManager.isFileIgnored` 的直译，
  `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1166-1167`）。
- **为什么需要**：`docs/inventory/verdict-platform_rest.md:241`（`ic/file-types`）剩下的就是这一句
  「忽略清单没有接进文件树/搜索的过滤链」。现状：清单**已经**灌进进程内注册表并在
  **文件选择对话框**生效（`src/fileChooserDescriptor.ts:236`、`:270` 的 `hideIgnored` 那一档，
  照上游 `FileChooserDescriptorBase` 的 `isHideIgnored() && FileTypeManager.isFileIgnored(file)`），
  但项目树与预览不看它 ⇒ 用户加了 `*.pyc` 之后资源管理器式列表里还在，设置页那句
  「在 IDE 里不可见」（`src/fileTypeIgnoredList.ts:49`）就成了空话。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFileCache.java:80-82`
  （`calcIgnored` 把 `file.getNameSequence()` 交给判定 —— 只按**名字**，不按路径）；
  掩码表本体 `IgnoredPatternSet`（分号分隔）。**口径提醒**：上游忽略判定是**按文件名**的，
  所以树这一层应当逐段问 `isIgnoredName(segment)`（本仓 `isPathIgnored` 就是这个写法），
  不要把整条路径丢给掩码匹配。
- **落地后要配的判据**：树里出现 `.git`/`__pycache__` 这类默认掩码命中的目录时**不出行**；
  改清单 ⇒ 下一次 `workspace.list` 结果跟着变。

## F2 · 同一张忽略清单并进工程搜索的 exclude

- **目标文件**：`src/searchExclusions.ts`（工程排除目录 → `**/<dir>/**` 那条已有的折算）
  与它的调用面 `src/components/SearchPanel.vue:36,50`。
- **要接什么**：`ignoredPatterns()`（`src/fileTypeIgnoredList.ts:197`）返回的那串模式，
  按同一套折算并进去：`*.pyc` → `**/*.pyc`，`.git` → `**/.git/**`（目录型掩码），
  已有的 `projectExclusionPatterns()` 去重规则照用。
- **为什么需要**：上游那份清单的语义就是「不可见**且不被索引**」（`FileTypesBundle.properties:58-61`
  那句中文直译，本仓文案在 `src/fileTypeIgnoredList.ts:49`）。现在只做到了一半。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFileCache.java:80-82`
  + 同目录 `IgnoredPatternSet`（掩码语义）；文案 `platform/platform-impl/resources/messages/FileTypesBundle.properties:58-61`。
- **注意**：`native/search.cpp:46-49` 已有一张硬编码默认排除目录表，别把两份合成三处真源 ——
  合并点只在 `src/searchExclusions.ts`，宿主那张表当兜底。

## F3 · 文件树右键的「覆盖文件类型」入口（模型侧已就绪）

- **目标文件**：`src/components/EditorPopupMenu.vue`（或 `src/App.vue` 里的文件右键菜单，两者都不在本域）。
- **要接什么**：`src/fileTypeOverrides.ts` 已经导出完整的一套：
  `overridableFileTypes()`（可当覆盖目标的类型，按 `OverrideFileTypeManager.isAvailableForOverride`
  的口径过滤）、`changeFileTypeOverride(path, target)`、`overrideFailureReason()`、
  `fileTypeOverrideRows()`、`revertFileType(path)`。
- **为什么需要**：上游这条动作在**文件节点的右键菜单**上
  （`platform/lang-impl/src/com/intellij/openapi/file/exclude/OverrideFileTypeAction.java:53-76`，
  列表按显示名大小写不敏感排序、重名时拼「来自插件 X」的提示在 `:64-72`），
  本仓现在只有两个入口：问题面板逐行的「纯文本」与设置 › 文件类型页那张覆盖清单
  （`src/components/FileTypesPage.vue:471` 附近）。用户想「把这个文件按别的类型打开」得先知道它出现在问题面板里。
- **不是缺实现**：模型与文案都在，只是没有那个菜单项 ⇒ 属于挂点，不是新行为。

## F4 · 「文件信息」需要宿主 stat 通道（`pf/vfs` 判词 ⑤）

- **目标文件**：`src/bridge.ts` 的 `Method` 联合类型 + `native/main.cpp` 的 switch（两者都不在本域）。
- **要什么**：一条 `file.info`（入参 `{path}`，回 `{bytes, modifiedAt, readOnly, encodingHint}`）。
- **为什么需要**：`docs/inventory/verdict-platform_rest.md:57` 的 `pf/vfs` ⑤
  「`VirtualFileInfoAction`（文件信息对话框）——宿主没有 size/mtime 通道」这条**至今成立**：
  本轮把 `src/bridge.ts:109` 那整条 `Method` 联合类型翻过一遍，没有任何一条给出 size 或 mtime；
  `file.read` 只回 `{content, version, encoding, bom, readOnly}`。
  上游那条动作读的是 `VirtualFile.getLength()` 与 `timeStamp()`。
- **本域的准备**：`native/workspace.cpp` 里 `std::filesystem::file_size` / `last_write_time` 已经在
  别处用过（同一个 `fs` 头），加一个 handler 是 20 行以内的活；先要 Method 名与挂点。
- **上游依据**：`platform/ide-core/src/com/intellij/openapi/vfs/VirtualFile.java`（`getLength`/`timeStamp` 那两条查询面）
  与 `platform/platform-impl/…/vfs/` 的 `VirtualFileInfoAction` 一族 —— **注意**：本轮在本地树里
  `find -name 'VirtualFileInfoAction*'` **没有命中**（只在判词文本里出现过），
  所以这条只能按「语义 + `VirtualFile` 查询面」接，指不到具体行号（已登记进报告的「无法核实」）。

## F5 · 忽略清单与覆盖文件集要不要进宿主设置（**只是决策请求**）

- 现状：两份都落 **localStorage**（`src/fileTypeIgnoredList.ts:33-35` 与
  `src/fileTypeOverrides.ts:11-13` 的头注释都写明了理由与先例：`src/macros.ts`、`src/externalToolsRecords.ts`）。
- 上游那两份是 `filetypes.xml` 里的组件状态（**应用级**）与项目 `.idea/` 里的
  `<component name="FileTypeOverriderConfiguration"/>`（**工程级**，
  `platform/lang-impl/src/com/intellij/openapi/file/exclude/PersistentFileSetManager.java:104-118`
  的 `<file url value/>` 形态）。
- 要动的是 `native/settings_schema.cpp` 的已知键表。**本轮不开这个请求的具体代码**，因为：
  ① 应用级 vs 工程级要先定（覆盖表按上游是**工程级**，本仓现在是全局一份）；
  ② 新增设置键必须「旧存档缺键补默认」，那条纪律属于主代理统筹（本仓真出过把用户锁在项目外的事故）。
  需要落的话，先定作用域，再按 `tests/settings-*.test.mjs` 的既有形状补一条「缺键补默认」的判据。
