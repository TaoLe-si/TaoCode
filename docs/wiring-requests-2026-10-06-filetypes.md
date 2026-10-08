# 接线请求 · 2026-10-06 · filetypes 族（文件类型 / VFS / 磁盘同步 / 文件模板）

本轮**没有**改任何保留文件。下面每条的目标都在别人的可改面里（`src/bridge*`、`src/App.vue`、
`src/searchExclusions.ts`、`native/settings_schema.cpp`），按 `.tools/agent-rules.md` §2 只提请求。
行号是 2026-10-06 现树实测（工作区在并发变动中，落地前请重读目标区域）。

**先说三条「不用再提」的**（本轮核实到已经落了，别重复接）：

---

## 0. 第二轮复核（shell2 收尾 · 逐条判定）

派单要求的「逐条对当前代码判」结论。**行号是本篇原文写好之后漂移到现树的实测值**（本域模块本轮又被改过，
`src/fileTypeIgnoredList.ts` 从 247 行长成 293 行 ⇒ 原文引的 :33/:197/:226/:233/:241 全部下移，已在正文里改成新号）。

| 条 | 判定 | 现状证据（本仓） | 还差什么 |
|---|---|---|---|
| F1 忽略清单灌进文件树/预览过滤链 | **仍缺**（前提没变） | `src/bridge.ts`、`src/bridgePreview.ts` 全文 grep `isFileIgnored\|isPathIgnored\|ignored` **零命中**；`src/bridgePreview.ts:51`/`:85` 仍只看 `excludedDirs` | 两个目标文件都是保留文件 ⇒ 只能等主代理。模型侧口径不变 |
| F2 忽略清单并进工程搜索 exclude | **仍缺** | `src/searchExclusions.ts` 的三个导出（`projectExclusionPatterns:18`/`mergeSearchExclude:32`/`excludedDirsOf:39`）都不看忽略清单 | 目标文件不在本域；本篇 §F2 的折算口径不变 |
| F3 文件树右键「覆盖文件类型」 | **仍缺** | `src/components/EditorPopupMenu.vue` 与 `src/App.vue` grep `fileTypeOverride\|changeFileTypeOverride` **零命中** | 纯挂点，模型侧一套（`src/fileTypeOverrides.ts`）齐 |
| F4 「文件信息」宿主 stat 通道 | **仍缺** | `src/bridge.ts:109` 那条 `Method` 联合类型现在逐条翻过，仍无 `file.info`、无任何给 size/mtime 的通道（`file.read` 只给 `content/version/encoding/bom/readOnly`） | 要 Method 名 + `native/main.cpp` switch，两个都不在本域 |
| F5 忽略清单/覆盖集要不要进宿主设置 | **仍缺（决策请求）** | 两份仍在 localStorage。**本轮新增一条前提**：忽略清单现在「与上游默认表逐位相同 ⇒ 直接清键不写」，所以进宿主设置时要照上游 `getState` 那条「相等就不写元素」的语义（见 §F5 补） | 要先定作用域（应用级 vs 工程级），归主代理拍板 |

**本轮新提两条**（不在上面的表里，是新发现的）：**F6**（设置页 apply 后回读生效清单）、
**F7**（`languageFor` 与注册表两张真源 ⇒ 并成一张）。两条都给了可照抄的 old/new 与配套判据。

**本轮在模块侧自己闭环的三条**（不占上面的请求，写在 `docs/batch-2026-10-06-shell2.md`）：
忽略清单的**遮蔽闸**、默认表与上游**逐字一致**的门禁 + 「等于默认表就不持久化」、通配关联表**同长时 `?` 先于 `*`**
的排序修正（原实现把两级方向做反了）。

## F6 · 设置页「应用」后要回读**生效后**的忽略清单（给 FileTypesPage.vue 属主 · 本轮新提）

- **目标文件**：`src/components/FileTypesPage.vue` 的 `ignoreApply()`（现树 `:307-312`，要改的是 `:309-310` 那两行）。
- **为什么要改**：本轮把上游 `IgnoredPatternSet.addIgnoreMask` 的遮蔽闸落了（`src/fileTypeRegistry.ts` 的
  `addIgnoreMask`），被现有掩码盖住的词条不再进清单 ⇒ 页面那份 `ignoreList` 可能比**真正生效的那张表**多几条。
  上游不会这样：面板 `reset()` 从 `FileTypeManager.getIgnoredFilesList()` 回读。
- **可照抄改动**（`ignoredPatterns` 该文件已经 import 了，现树 `:38`，不用动 import）：

```ts
// 旧（逐字原文，含缩进两格）：
  const changed = applyIgnoredPatterns(ignoreList.value)
  ignoreApplied.value = [...ignoreList.value]

// 新：
  const changed = applyIgnoredPatterns(ignoreList.value)
  // 回读**生效后**的清单：被遮蔽闸挡掉的那条（`*.pyc` 在场时加 `build.pyc`）在上游连清单都进不去，
  // 不该继续显示在表里 —— 与面板 `reset()` 从 `getIgnoredFilesList()` 回读同一口径。
  ignoreList.value = ignoredPatterns()
  ignoreApplied.value = [...ignoreList.value]
```

- **配套判据**（落在哪个测试由属主定；本域已把模型侧的判据钉在 `tests/file-type-ignored-list.test.mjs`
  的「落盘的是生效后的那张表」那条）：页面 apply 一条被盖住的模式后，表里不该再有那条。


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
- **要接什么**：`src/fileTypeIgnoredList.ts:287` 的 `isPathIgnored(path)`（路径**任一段**命中忽略掩码即真）
  与 `:279` 的 `isIgnoredName(name)`（单个名字，上游 `FileTypeManager.isFileIgnored` 的直译，
  `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1166-1167`）。
- **为什么需要**：`docs/inventory/verdict-platform_rest.md:241`（`ic/file-types`）剩下的就是这一句
  「忽略清单没有接进文件树/搜索的过滤链」。现状：清单**已经**灌进进程内注册表并在
  **文件选择对话框**生效（`src/fileChooserDescriptor.ts:236`、`:270` 的 `hideIgnored` 那一档，
  照上游 `FileChooserDescriptorBase` 的 `isHideIgnored() && FileTypeManager.isFileIgnored(file)`），
  但项目树与预览不看它 ⇒ 用户加了 `*.pyc` 之后资源管理器式列表里还在，设置页那句
  「在 IDE 里不可见」（`src/fileTypeIgnoredList.ts:62`）就成了空话。
- **上游依据**：`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFileCache.java:80-82`
  （`calcIgnored` 把 `file.getNameSequence()` 交给判定 —— 只按**名字**，不按路径）；
  掩码表本体 `IgnoredPatternSet`（分号分隔）。**口径提醒**：上游忽略判定是**按文件名**的，
  所以树这一层应当逐段问 `isIgnoredName(segment)`（本仓 `isPathIgnored` 就是这个写法），
  不要把整条路径丢给掩码匹配。
- **落地后要配的判据**：树里出现 `.git`/`__pycache__` 这类默认掩码命中的目录时**不出行**；
  改清单 ⇒ 下一次 `workspace.list` 结果跟着变。

## F2 · 同一张忽略清单并进工程搜索的 exclude

- **目标文件**：`src/searchExclusions.ts`（工程排除目录 → `**/<dir>/**` 那条已有的折算）
  与它的调用面 `src/components/SearchPanel.vue`（现树：`:39` import、`:53` 读工程设置、`:279` 拼 `exclude`）。
- **要接什么**：`ignoredPatterns()`（`src/fileTypeIgnoredList.ts:239`）返回的那串模式，
  按同一套折算并进去：`*.pyc` → `**/*.pyc`，`.git` → `**/.git/**`（目录型掩码），
  已有的 `projectExclusionPatterns()` 去重规则照用。
  **本轮补充口径**：`ignoredPatterns()` 现在返回的就是**生效后**的那张表（遮蔽闸挡掉的词条不会在里面，
  与上游 `getIgnoreMasks()` 一致），所以折算不用再自己判重。
- **为什么需要**：上游那份清单的语义就是「不可见**且不被索引**」（`FileTypesBundle.properties:58-61`
  那句中文直译，本仓文案在 `src/fileTypeIgnoredList.ts:62`）。现在只做到了一半。
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

- 现状：两份都落 **localStorage**（`src/fileTypeIgnoredList.ts:45-49` 与
  `src/fileTypeOverrides.ts:11-13` 的头注释都写明了理由与先例：`src/macros.ts`、`src/externalToolsRecords.ts`）。
  **本轮新增的前提（要做这条时一并带上）**：忽略清单那份已经照上游 `getState` 落了「**与默认表逐位相同就不持久化**」
  （`src/fileTypeIgnoredList.ts` 的 `writeStored` + `isEqualToDefaultIgnoreList`，
  上游 `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1434-1438` 与 `:1494-1504`）——
  所以宿主侧的等价物**不该**是「永远写一份 17 条」，而要能表达「这一段没存过 ⇒ 用默认表」；
  另外落盘值是**遮蔽后的那张表**（`FileTypeManager` 的 `addIgnoreMask` 挡掉的词条不会出现在里面）。
- 上游那两份是 `filetypes.xml` 里的组件状态（**应用级**）与项目 `.idea/` 里的
  `<component name="FileTypeOverriderConfiguration"/>`（**工程级**，
  `platform/lang-impl/src/com/intellij/openapi/file/exclude/PersistentFileSetManager.java:104-118`
  的 `<file url value/>` 形态）。
- 要动的是 `native/settings_schema.cpp` 的已知键表。**本轮不开这个请求的具体代码**，因为：
  ① 应用级 vs 工程级要先定（覆盖表按上游是**工程级**，本仓现在是全局一份）；
  ② 新增设置键必须「旧存档缺键补默认」，那条纪律属于主代理统筹（本仓真出过把用户锁在项目外的事故）。
  需要落的话，先定作用域，再按 `tests/settings-*.test.mjs` 的既有形状补一条「缺键补默认」的判据。

---

## F7 · 「这个文件是哪种语言」现在有**两张表**（模板与文件类型的对应 · 本轮新提）

- **目标文件**：`src/templates.ts` 的 `languageFor`（不在本域）。它的两个消费点也都不在本域：
  `src/App.vue`（面包屑那一处，保留文件）与 `src/components/SettingsDialog.vue`（模板页按当前编辑器语言挑模板）。
- **现状（两张真源）**：`src/templates.ts` 里 `languageFor(path)` 是一张**手写的扩展名正则表**
  （`.java`→java、`.cpp|cc|c|h|hpp|cxx`→cpp、`.ts|tsx|js|jsx|mjs`→typescript、其余 other），
  而本域已经有一张进程内注册表：`src/fileTypeRegistry.ts` 的 `getFileTypeByFileName(...).language`
  （`STANDARD_FILE_TYPES` 每条都带 `language`，值域与 `src/languages.ts` 的 `EDITOR_LANGUAGES` 完全同 =
  java/cpp/typescript/other，与 `templates.ts` 的 `Language` 联合也同）。
  ⇒ 用户注册/改判一个文件类型（`src/fileTypePluginBeans.ts`、设置页的关联表）会改变编辑器高亮，
  **却不会改变哪些 live template 可用**、也不会改变面包屑的档 —— 这就是「模板与文件类型对不上」。
- **上游依据**：一个文件的语言在上游只有一个出口 ——
  `platform/core-api/src/com/intellij/openapi/fileTypes/LanguageFileType.java:82` 的 `public final @NotNull Language getLanguage()`；
  同文件 `:25` 的类注释更直接：**「implementation class 与 `getLanguage()` 不一致就把注册报成错误」** ——
  上游明确不接受同一件事有两张表。本仓的对应物就是「类型描述符里的 `language` 字段是唯一的语言档真源」。
- **可照抄改动**（`src/templates.ts`；上面加一行值 import，**必须带 `.ts` 扩展名**）：

```ts
// import 处加一行（本仓已有同形态：src/fileTypeDetection.ts 就是这么引的）：
import { fileTypeManager } from './fileTypeRegistry.ts'

// 旧（当前逐字原文，含缩进）：
export function languageFor(path: string): Language {
  if (/\.java$/i.test(path)) return 'java'
  if (/\.(cpp|cc|c|h|hpp|cxx)$/i.test(path)) return 'cpp'
  if (/\.(ts|tsx|js|jsx|mjs)$/i.test(path)) return 'typescript'
  return 'other'
}

// 新：
/**
 * 这个文件属于哪种模板语言 —— 先问**文件类型注册表**（唯一真源，上游是 `LanguageFileType.getLanguage()`，
 * `platform/core-api/src/com/intellij/openapi/fileTypes/LanguageFileType.java:82`），
 * 注册表认不出来（没注册的类型、或类型带的语言不在本仓四档里）才回落下面那张内置表。
 * 内置表留着不是为了另起一套真相：它是 `STANDARD_FILE_TYPES` 之外那几条扩展名
 * （`js`/`jsx`/`mjs` 本仓没有对应类型条目）的兜底，注册表一旦补上就该整块删掉。
 */
const BUILT_IN_TEMPLATE_LANGUAGES: readonly (readonly [RegExp, Language])[] = [
  [/\.java$/i, 'java'],
  [/\.(cpp|cc|c|h|hpp|cxx)$/i, 'cpp'],
  [/\.(ts|tsx|js|jsx|mjs)$/i, 'typescript'],
]

export function languageFor(path: string): Language {
  const registered = fileTypeManager.getFileTypeByFileName(path)?.language
  if (registered === 'java' || registered === 'cpp' || registered === 'typescript' || registered === 'other') return registered
  for (const [pattern, language] of BUILT_IN_TEMPLATE_LANGUAGES) if (pattern.test(path)) return language
  return 'other'
}
```
- **配套判据**（一条就够，配反向验证）：往 `fileTypeManager` 注册一个 `{ id: 'TsxTest', language: 'typescript', matchers: [{kind:'extension',extension:'taocodetmpl'}] }`
  ⇒ `languageFor('a.taocodetmpl')` 回 `'typescript'`；`unregister` 后复原成 `'other'`。
  **反向验证**：把 `languageFor` 改回只查内置表 ⇒ 这条必红（本域已确认注册表侧 `getFileTypeByFileName` 的判定是对的）。
- **为什么本域不自己接**：`src/templates.ts` 不在本域可改面（派单只给了 `src/fileType*.ts`）；
  且它的两个消费点一个在保留文件 `src/App.vue`、一个在设置页属主那里。**模型侧不需要新代码** ——
  这条纯粹是「把第二张表接到第一张表上」，不动 `native`。


## 处理结果（wiring-backlog lane，2026-10-06）

- **F6 已接线**：`src/components/FileTypesPage.vue:309-312` 的 `ignoreApply()` 已回读生效后清单（`ignoreList.value = ignoredPatterns()`）。判据 `tests/file-type-ignored-list.test.mjs` **pass 18 / fail 0**。
- **F1 / F2（忽略清单灌进过滤链 / 搜索 exclude）** —— 目标 `src/bridge.ts` / `src/bridgePreview.ts`（保留文件，非本 lane）。跳过给 bridge owner。
- **F3（文件树右键「覆盖文件类型」）** —— 目标 `src/components/EditorPopupMenu.vue` / `src/App.vue`（本 lane 可改面）。登记为待办（需 fileTypeOverrides 的完整入口）。
- 桶 15 W1/W3、桶 15j 的复核结论本 lane 已独立核过（见各自处理结果）。

结论：F6 已接线；F1/F2 转 bridge owner，F3 登记。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「F6 已接线；F1/F2 转 bridge owner，F3 登记。」。
F3 复核仍未接：`grep 覆盖文件类型|fileTypeOverride src/menus src/App.vue` 0 命中；入口需在 `src/menus/` 的右键菜单表 + App 状态（子菜单面），属多文件装配，登记待办。F1/F2 需 native/bridge owner。

## 处理结果（EP 化收口 lane，2026-10-07）

**F3 仍缺宿主挂载点（模型侧本就齐）**：`src/fileTypeOverrides.ts` 的 `overridableFileTypes()` /
`changeFileTypeOverride()` / `overrideFailureReason()` / `revertFileType()` / `isFileTypeOverridden()` 已导出；
文件节点右键子菜单的**组件挂载点**写在 `docs/wiring-requests-2026-10-07-epclose.md` W-4
（App.vue 文件树 `treeMenu` 的 `kind === 'file'` 分支）。本 lane 不动 App.vue / components。F1/F2/F6 结论不变。
