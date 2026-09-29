# UI 放置位置审计（设置树 / 菜单 / 对话框的层级对标）

> 用户要求（2026-09-26 追加）：**UI 的位置也要对标源码**，存在大量放错位置的 UI；**尤其要仔细检查嵌套 UI、多层 UI**。
> 用户要求（2026-09-26 再次追加）：**不要盲信文档** —— 只有 100% 经源码确认的东西才允许写进文档；
> 没查证的必须显式标注 `推断` 或 `待核`，任何移植以源代码为基准。（本文件曾因违反这条写错过 backgroundImage 的归属，已修正。）
> 本文件记录审计方法与**已核实**的结论。凡未核实的一律写 `待核`，不猜。

工具：`scripts/ui_placement_audit.py`（键 → 状态组件 → 访问器 → 引用它的 Configurable），原始输出 `docs/ui-placement-audit-raw.txt`。

---

## A. 审计方法（四步，每步可复核）

1. **键 → 状态组件**：键名在哪个状态文件里声明（`GeneralSettings.kt` / `UISettings.kt` / `EditorSettingsExternalizable.java` / `GeneralLocalSettings.kt`…）。
2. **状态字段 → 真实访问器**：不能假设 getter 等于字段。从状态文件解析 `var <accessor> … get() = …state.<字段>…`
   （例：`deleteToBin` 的 getter 是 `isDeletingToBin`；`autoSyncFiles` 是 `isSyncOnFrameActivation`；`autoSaveFiles` 是 `isSaveOnFrameDeactivation`）。
   Java 状态类没有 `state.x` 形式，要用 UPPER_SNAKE 常量或 `is<Key>()` 反查。
3. **访问器 → Configurable**：在 338 个 `*Configurable*` 文件里找 `::<accessor>` / `<accessor>()` / UPPER_SNAKE。**引用它的那个 Configurable 就是它的家**。
4. **Configurable → 设置树位置**：从 EP 注册读 `parentId` / `groupId`（`resources/**/*.xml` 的 `editorOptionsProvider` / `projectConfigurable`）与 Bundle 页名。

---

## B. 已核实：TaoCode「系统设置」页（general）——**放置正确**

审计脚本对 13 个键逐个跑，**全部**指向 `GeneralSettingsConfigurable`，与 TaoCode 所在页一致：

| 键 | IDEA 访问器 | 引用它的 Configurable |
|---|---|---|
| `confirmExit` | `isConfirmExit` | `GeneralSettingsConfigurable` |
| `deleteToBin` | `isDeletingToBin` | 同上 |
| `autoSaveIfInactive` | `isAutoSaveIfInactive` | 同上 |
| `autoSaveFiles` | `isSaveOnFrameDeactivation` | 同上 |
| `isUseSafeWrite` | `isUseSafeWrite` | 同上 |
| `autoSyncFiles` | `isSyncOnFrameActivation` | 同上 |
| `backgroundSyncFiles` | `isBackgroundSync` | 同上 |
| `inactiveTimeout` | `inactiveTimeout` | 同上 |
| `processCloseConfirmation` | `processCloseConfirmation` | 同上 |
| `defaultProjectDirectory` | `defaultProjectDirectory` | 同上（组件实为 `GeneralLocalSettings`，见 §7 记录） |
| `isShowWelcomeScreen` | `isShowWelcomeScreen` | **无引用**（Windows 上不生效，已判 `[-]`） |
| `confirmOpenNewProject2` | `confirmOpenNewProject` | 无引用（单窗口，已判 `[-]`） |

**结论：这一页不需要动。**

---

## C. 已核实：TaoCode「外观」页（appearance）——**基本正确**

| 键 | 引用它的 Configurable |
|---|---|
| `fullPathsInWindowHeader`、`mainMenuDisplayMode`、`showTreeIndentGuides`、`compactTreeIndents`、`smoothScrolling`、`keepPopupsForToggles`、`dndWithPressedAltOnly`、`showIconsInMenus`、`wideScreenSupport` | `AppearanceConfigurable` |
| `supportScreenReaders` | `AppearanceConfigurable`（B1-d 已归位到 `GeneralSettingsState`） |

**已全部核实（B1-h，15/15 归属 `AppearanceConfigurable`，放置正确）**：
`compactMode`、`useContrastScrollbars`、`colorBlindness`、`presentationMode`、`showToolWindowBars`、
`showToolWindowNames`、`showToolWindowNumbers`（在 `AppearanceConfigurable.kt:123` 的 `cdShowToolWindowNumbers`，
之前 grep 不到是因为常量名里是**大写** S）、`rememberSizeForEachToolWindow`、`wideScreenSupport` 均直接命中；
另有 **5 个是命名映射**（TaoCode 的键名 ≠ IDEA 的属性名，但都在同一页）：

| TaoCode 键 | IDEA 属性（AppearanceConfigurable.kt） |
|---|---|
| `uiZoomPercent` | `ideScale`（`:293-318`，"IDE Scale" 下拉） |
| `uiFontSize` | `settings.fontSize`（`:347-349`） |
| `uiFontFamily` | `settings.fontFace`（`:341`） |
| `leftSideBySide` | `settings.leftHorizontalSplit`（`:140`，"Left toolwindow layout"） |
| `rightSideBySide` | `settings.rightHorizontalSplit`（`:142`） |

`backgroundImageFill` / `backgroundImageKeepRatio`：**已核实**（B1-h 修正）—— `SetBackgroundImage` 就在
`AppearanceConfigurable.kt` 里，即 IDEA 的**外观设置页**本身就带背景图像入口（我此前写"不在设置页里"是错的，
当时没查就下了结论）。TaoCode 放在外观页**完全正确**。**结论：外观页 15/15 无需改动。**

---

## D. 已核实：TaoCode「编辑器」页 —— **结构性错误：IDEA 是分层的，TaoCode 是扁平的**

### D.1 IDEA 的真实结构（`platform/lang-impl/resources/intellij.platform.lang.impl.xml`）

```
Editor（preferences.editor）
├── General
│   ├── Appearance        ← editorOptionsProvider id="editor.preferences.appearance"
│   │                       （EditorAppearanceConfigurable.kt:49-56）
│   ├── Smart Keys        ← id="editor.preferences.smartKeys"
│   ├── Editor Tabs       ← id="editor.preferences.tabs"（EditorTabsConfigurable）
│   ├── Code Folding      ← id="editor.preferences.folding"（CodeFoldingConfigurable，
│   │                       另有 codeFoldingOptionsProvider id="General" order="first"）
│   ├── Auto Import       ← projectConfigurable parentId="preferences.editor"（:1224-1228）
│   ├── Gutter Icons      ← id="editor.preferences.gutterIcons"
│   └── Code Completion › …（CompletionConfigurable + 子页 Inline Completion）
└── Code Style › Tabs and Indents …（IndentOptionsEditor 体系）
```

### D.2 逐行判定（TaoCode 那 7 行）

| TaoCode 现状 | IDEA 真实归属（证据） | 判定 |
|---|---|---|
| `lineNumbers`（编辑器页） | **Editor › General › Appearance**（`EditorAppearanceConfigurable.kt:49`：`model::isLineNumbersShown`） | 页面对，**层级错**（少了 General › Appearance 两层） |
| `showWhitespaces`（编辑器页） | **Editor › General › Appearance**（`:51`：`model::isWhitespacesShown`） | 同上 |
| `showIndentGuides`（编辑器页） | **Editor › General › Appearance**（`:56`：`model::isIndentGuidesShown`） | 同上 |
| `wordWrap`（编辑器页） | **Editor › General**（`EditorOptionsPanel.kt` 引用 `checkbox.use.soft.wraps.at.editor`） | 页面对（General），但 TaoCode 把它和 Appearance 的行混在同一平面页 |
| `useTabCharacter`（编辑器页） | **Editor › Code Style › Tabs and Indents**（`IndentOptionsEditor.java` 引用 `use.tab.character`） | **页面错**：应在代码风格下，不是编辑器 › 常规 |
| `formatOnSave`（编辑器页） | **Tools › Actions on Save**（`intellij.platform.ide.impl.xml:1313-1317`：`projectConfigurable groupId="tools" id="actions.on.save"`；文案 `CodeInsightBundle.properties:484` `Reformat code`） | **大页错**：应在「工具」下，不是编辑器 |
| `bracketMatching`（编辑器页） | **待核**：`EditorSettingsExternalizable.java` 里**没有** bracket 相关字段；平台里唯一的括号复选框是 `checkbox.insert.pair.bracket`（`EditorSmartKeysConfigurable`，语义是"自动插入配对括号"，不是"高亮匹配括号"）。`checkbox.highlight.matched.bracket` 与 `matched.bracket` 在全部 `.properties` 里**都不存在** | **疑似 IDEA 里没有这个设置项**（IDEA 的匹配括号高亮由 `Editor › Color Scheme › General › Matched brace` 配色控制，没有开关）。待核完再决定"改名归位"还是"按 `[-]` 移除" |
| `tabSize` / `fontSize`（未在此页渲染，但同属 EditorSettings） | **待核**（`tabSize` 极可能在 Code Style › Tabs and Indents；`fontSize` 在 Editor › General 或 Color Scheme） | 待核 |

### D.3 已实施（本轮）

1. **导航模型扩到三层**：`SettingsNode.parent` 现在既可以是分组，也可以是另一个节点；新增 `expandOnly` 标记表示"IDEA 树里只有子项、自己不是设置页"的父节点（点它只展开，不打开空页面）。模板三种层级（`settings-tab` / `settings-child` / `settings-grandchild`）与键盘遍历顺序（`flatKeys`）都跟着改；搜索时的祖先可见性用 `ancestorGroupOf()` 一路走到分组。
2. **新增 6 个页面**（全部带源码出处写在页内说明里）：
   - `编辑器 › 常规`（EditorOptionsPanel.kt）：软换行（`checkbox.use.soft.wraps.at.editor`）+ 字体大小（**待核**：很可能在 Editor › Color Scheme › Color Scheme Font）
   - `编辑器 › 常规 › 外观`（EditorAppearanceConfigurable.kt:49-56）：行号 / 空白符号 / 缩进参考线 + 括号匹配高亮（**IDEA 无此开关**，页内已写明理由）
   - `编辑器 › 常规 › 编辑器标签页`（EditorTabsConfigurable.kt:109 `editbox.tab.limit`）：标签页上限
   - `编辑器 › 代码风格 › 制表符与缩进`（IndentOptionsEditor.java）：缩进宽度 / 使用制表符
   - `工具 › 保存时操作`（intellij.platform.ide.impl.xml:1313-1317 `groupId="tools"`）：保存时格式化
   - `编辑器` 与 `编辑器 › 代码风格` 改为 `expandOnly`（只展开）
3. **新增「工具」分组**（IDEA 的顶层分组之一）。
4. **跳转目标跟着改**：`window.configureTabs` 与标签右键的「配置编辑器标签页…」→ `编辑器 › 常规 › 编辑器标签页`；状态栏缩进 chip → `编辑器 › 代码风格 › 制表符与缩进`；"新选项"徽标页从 `editor` 改为 `editor.general.appearance`。
5. **删掉编辑器页里 3 段孤儿提示文本**（`autosave-hint` / `sync-hint` / `restore-hint`）—— 它们描述的是早已迁到系统设置页的选项，属于死 UI 文本。

### D.4 结论

「编辑器」页不是"行的位置错"，而是**缺了 IDEA 的整棵子树**：TaoCode 把 `General › Appearance`、`General`（软换行）、`Code Style › Tabs and Indents`、`Tools › Actions on Save` 四处的行**平铺在一页**。要 1:1 对标，需要：
1. 设置左树支持**多层**（现在只有一层 6 项）；
2. 新增页面：`编辑器 › 常规 › 外观`、`编辑器 › 常规 › 智能键`、`编辑器 › 常规 › 编辑器标签页`、`编辑器 › 常规 › 代码折叠`、`编辑器 › 代码风格 › 制表符与缩进`、`工具 › 保存时操作`；
3. 把现有行按 D.2 迁移过去。

**这一项是本轮发现的最大结构性问题**，工作量集中在设置对话框的导航模型（左树 + 页面路由），需要在 `SettingsDialog.vue` 引入"父页/子页"两级模型（`settingsSearch.ts` 的索引也要跟着改）。

---

## F. 已核实并已归位：设置树的**真实层级**（2026-09-27 本批）

方法同 §A（键 → 状态组件 → 访问器 → Configurable → EP 注册的 parentId/groupId），
这一批把"每一页在 IDEA 树里的位置"逐条读注册行，**发现 11 处放错位置**并已归位。

### F.1 顶层分组：id 与权重（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:575-608`）

| groupId | weight | 显示名（`OptionsBundle.properties`） |
|---|---|---|
| `appearance` | 70 | Appearance & Behavior |
| `editor` | 60 | Editor |
| `project` | 40 | Default Project |
| `build` | 30 | Build, Execution, Deployment |
| `language` | 20 | Languages & Frameworks |
| `tools` | 10 | Tools |
| `other` | -10 | Other Settings |

**「版本控制」不是分组**：`platform/vcs-impl/resources/META-INF/VcsExtensions.xml:172`

```
<projectConfigurable groupId="root" groupWeight="45" dynamic="true"
                     key="version.control.main.configurable.name"       ← VcsBundle:145 = Version Control
                     provider="...VcsManagerConfigurableProvider"
                     id="project.propVCSSupport.Mappings"/>
```

即：它是注册在 root 下、权重 45 的**顶层页面**（页面本体 = `VcsManagerConfigurable`，
`VcsManagerConfigurable.java:83-96` 逐个 `add` 出 目录映射 / 忽略 / 问题导航 / 变更列表冲突 /
**提交**(`CommitDialogConfigurable`) / 搁置 / 文件状态颜色 等子页）。
之前 TaoCode 把它做成一个 `group:vcs` 分组，**父节点类型就是错的**，已改为顶层 expandOnly 页面 +
`提交` / `VCS 日志` 两个子页。

### F.2 「编辑器」分组的成员与权重（`intellij.platform.lang.impl.xml` + `intellij.platform.ide.impl.xml`）

| groupWeight | id | 页名 key | 说明 |
|---:|---|---|---|
| 190 | `preferences.editor` | `title.editor` = **General**（ApplicationBundle:240） | 页面本体 `EditorOptionsPanel`，子页由 `childrenEPName="com.intellij.editorOptionsProvider"` 提供（:1181-1214：Smart Keys / Appearance / Gutter Icons / Editor Tabs / Code Folding / Completion） |
| 189 | `preferences.editor.code.editing` | `title.code.editing` = Code Editing | 本仓未移植 |
| 180 | `reference.settingsdialog.IDE.editor.colors` | `title.colors.and.fonts` | 颜色方案页，本仓没有 |
| 170 | `preferences.sourceCode` | Code Style | `editor.codeStyle` ✓ |
| 160 | `Errors` | `configurable.InspectionToolsConfigurable.display.name` = Inspections | **原放在「常规 › 外观」里，错** |
| 150 | `fileTemplates` | `title.file.templates` | 本仓未移植 |
| 130 | `editing.templates` | `templates.settings.page.title` = Live Templates | **原挂在「默认项目」下，错** |
| 120 | `preferences.fileTypes` | `filetype.settings.title` = File Types | 原本没有设置页入口，只有右键菜单 |
| — | `preferences.toDoOptions` | `title.todo` = TODO（`platform/todo/resources/intellij.platform.todo.xml:49` `groupId="editor"`） | **原放在「项目结构」页里，错** |
| — | `Console`（:983）、`editor.breadcrumbs`（`intellij.platform.ide.impl.xml:1231`）、`editor.stickyLines`（:1236） | `configurable.Console.display.name` / `configurable.breadcrumbs` / `configurable.sticky.lines` | 三者都是 `parentId="preferences.editor"` 的**编辑器直接子页**，原本被塞进「常规 › 外观」/「项目结构」 |

### F.3 本批归位清单（11 处，全部有注册行证据）

| IDEA id | 真实归属（证据） | 归位前 | 归位后 |
|---|---|---|---|
| `editor.breadcrumbs` | Editor（`ide.impl.xml:1231` parentId=preferences.editor） | 项目结构页 | 编辑器 › 面包屑 |
| `editor.stickyLines` | Editor（`:1236`） | 项目结构页 | 编辑器 › 粘性行 |
| `Errors` | Editor（`lang.impl.xml:1823` groupId=editor/160） | 常规›外观 | 编辑器 › 检查 |
| `Console` | Editor（`lang.impl.xml:983` parentId=preferences.editor） | 系统设置页 | 编辑器 › 控制台 |
| `editing.templates`(实时模板) | Editor（`:1000-1002` groupId=editor/130） | 默认项目 › 实时模板 | 编辑器 › 实时模板 |
| `preferences.fileTypes` | Editor（`:992-994` groupId=editor/120） | 无设置页入口 | 编辑器 › 文件类型（新增页内编辑） |
| `preferences.toDoOptions` | Editor（`todo.xml:49`） | 项目结构页 | 编辑器 › TODO（新增独立表页） |
| `preferences.externalTools` | Tools（`:1013` groupId=tools） | 系统设置页 | 工具 › 外部工具 |
| `diff.base` | Tools（`diff.impl.xml:78` groupId=tools） | 系统设置页 | 工具 › 差异与合并 |
| `build.tools` | Build（`ExternalSystemExtensions.xml:24` groupId=build） | 系统设置页（且本仓没有 build 分组） | 构建、执行、部署 › 构建工具（新增分组） |
| `vcs.log` | Version Control（`vcs.log.impl.xml:86` parentId=project.propVCSSupport.Mappings） | 项目结构页 | 版本控制 › VCS 日志（版本控制改为顶层页） |

同时新增「构建、执行、部署」分组（`groupId="build"`，weight 30），并把分组顺序按源码权重排为
外观与行为(70) → 默认项目(40) → 构建、执行、部署(30) → 工具(10)；「编辑器」与「版本控制」是顶层页面/节点。

### F.4 本批**没有**动的（诚实登记，不是掩盖）

* `structure`（项目结构）仍作为「默认项目」下的一个页面：IDEA 里项目结构是**独立对话框**
  （`ProjectStructureConfigurable`），不是设置树页面。把它改成对话框是独立工程，登记待办。
* `advanced`（高级设置）：IDEA 是 Registry 对话框，TaoCode 用可编辑页等价，位置见 §B 说明。
* `scopes`（作用域）放在「外观与行为」下 ✓ 与注册一致（`:1825` groupId="appearance"）。
* IDEA 的 `Default Project` 分组下应有的页（Path Variables / Run Configurations / ...），本仓未移植。

---

## E. 待继续审计的范围（尚未开始，不假装已完成）

| 范围 | 现状 |
|---|---|
| 设置树的多层结构（Editor 之外） | `待核`：外观页的 15 个未定键；`Editor › Code Style` 系列；`Version Control` 系列；`Tools` 系列 |
| **菜单的嵌套**（子菜单） | **已开始整改**。IDEA 的子菜单在动作 XML 里就是 `<group … popup="true">`；`platform/platform-impl/resources/idea/PlatformActions.xml` 里主菜单共有 **18 个**：`FilePropertiesGroup`(:400)、`ChangeLineSeparators`(:405)、`ExportImportGroup`(:419)、`FileExportGroup`(:432)、`PasteGroup`(:454)、`FindMenuGroup`(:465)、`ConvertIndentsGroup`(:500)、`Macros`(:506)、`ViewAppearanceGroup`(:523)、`EditorToggleActions`(:572)、`EditorBidiTextDirection`(:591)、`NavigateInFileGroup`(:620)、`LayoutsGroup`(:641)、`ResizeToolWindowGroup`(:680)、`EditorTabsGroup`(:688)、`Notifications`(:726)、`BackgroundTasks`(:731)、`HelpDiagnosticTools`(:764)。TaoCode 的 `MenuRow` **原本没有 children**，所以这 18 处**全部被拍平**。<br>**本轮已做**：① `MenuRow.children` + 子菜单渲染（父行右侧浮层、`position: fixed`、`▸` 提示、Esc 关闭、点击父行只切换展开、挑选子行才执行并关闭整条链）；② `窗口 › 布局` 收成一个 `children` 子菜单（对应 `LayoutsGroup` popup="true"）；③ 动作索引递归摊平（否则搬进 children 的动作会从「查找操作」里消失）；④ 汉堡面板按树展开（分组标题 + 缩进子行）；⑤ 又收拢四处：`窗口 › 调整工具窗口`（`ResizeToolWindowGroup` popup，:680-686，四个拉伸动作）与 `编辑 › 查找`（`FindMenuGroup` popup，:465-486）—— 这两处原来都是用 **section 标题**顶替的（注释里就写着 "TaoCode's menus are flat"），现在是真子菜单；⑥ `窗口 › 编辑器标签页`（`EditorTabsGroup` popup，:688-705 —— 其中 `CloseEditorsGroup` **不带** popup 是内联组，用分隔线表达同一层）；⑦ `文件 › 文件属性`（`FilePropertiesGroup` popup，:400-412，子项含 ChangeFileEncodingAction / ToggleReadOnlyAttribute），**其中再嵌一层** `文件属性 › 行分隔符`（`ChangeLineSeparators` 自己也是 popup="true"，:405-409）—— 这是本轮唯一的**两级子菜单**；⑧ `视图 › 外观`（`ViewAppearanceGroup` popup，:523-546 —— 内部 `ToggleFullScreenGroup` 与 `UIToggleActions` 都是**不带 popup 的内联组**，用分隔线表达），并把 `ToggleCompactMode` 补成真开关（落 `editorSettings.compactMode`）；`ToggleDistractionFreeMode` 与 `ToggleZenMode` 在 TaoCode 里是同一件事，**不重复放两行**；`ToggleFullScreen` 需要先给宿主加全屏通道，登记为待办。<br>**逐个核对后的两个例外（不改成子菜单，理由如下）**：① `BackgroundTasks`（:731-734）——IDEA 有两个子项，TaoCode 只有 `ShowProcessWindow` 一个有落点（另一个 `AutoShowProcessPopupAction` 是注册表键、无 UI，按规则不造假设置），**单项做成子菜单反而多一次点击**，保留 section；② `HelpDiagnosticTools`（:764-773）—— TaoCode **没有「帮助」菜单**（`menu` 联合类型里没有 help），它的父菜单不存在，无从收拢，除非先补一整个帮助菜单。<br>**18 处的最终分解（逐个核对完）**：已收拢 **5**（LayoutsGroup、ResizeToolWindowGroup、FindMenuGroup、EditorTabsGroup、FilePropertiesGroup›ChangeLineSeparators 两级）＋ ViewAppearanceGroup **6**（见⑧）；两个**有意例外**（BackgroundTasks 单子项、HelpDiagnosticTools 父菜单不存在）；其余（PasteGroup / ConvertIndentsGroup / Macros / EditorBidiTextDirection / NavigateInFileGroup / ExportImportGroup / FileExportGroup）在 TaoCode **暂无对应动作行** —— 按「全量移植」要求，它们是**待办**而不是放弃，已逐条登记进 `docs/class-parity-todo.md` §9（缺什么能力写得很具体，例如全屏通道、gutter 图标层、宏系统）；`Notifications` 已移植（`窗口 › 通知`）；唯一还**可做**的是 `EditorToggleActions`（:572-586：软换行 / 空白符号 / 行号 / 行内图标 / 缩进参考线 / 字号±）——TaoCode 有这些设置的落点（`wordWrap`/`showWhitespaces`/`lineNumbers`/`showIndentGuides`），只差把它们做成 View 菜单里的 **ToggleAction 行**，属于新增功能行而不是位置搬家。（`文件属性 › 行分隔符`、`编辑 › 查找`、`视图 › 外观`、`窗口 › 编辑器标签页`、`帮助 › 诊断工具` …），需要逐条核对后再改 |
| **对话框内的分层**（标签页 / 分栏） | `待核`。已知两处可疑：运行配置编辑器（IDEA 是左右分栏 + 多标签）、`项目结构` 对话框（IDEA 是左侧多页 + 右侧详情） |
| 工具窗口内的多层内容 | `待核`。IDEA 的工具窗口有条带 › 内容 › 内容的侧边组件三层 |
| 编辑器右键菜单的分组 | 已有部分对标（`EditorTabPopupMenu` 曾逐行核过），`待核`其余 |

---

## G. 下一批的 UI 分层目标（已读源码，登记待办 —— 不是"不做"）

### G.1 运行/调试配置对话框：IDEA 的**真实骨架**（已核实）

`platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditorWrapper.java:36-83`
逐行读出的组成（自上而下）：

| 位置 | IDEA 组件 | 行号 | 文案来源 |
|---|---|---|---|
| 顶部 | `content.beforeRunStepsRow` → `BeforeRunStepsPanel` | :63-64 | 启动前步骤表 |
| 顶部 | `content.isAllowRunningInParallelCheckBox`（**仅模板**可见，`settings.isTemplate() && factory.getSingletonPolicy().isPolicyConfigurable()`） | :73-77 | 允许多个实例 |
| 顶部 | `myRunOnTargetPanel` → `RunOnTargetPanel`（**仅模板**，`groupId="root"`… 实为"运行目标"） | :52-55 | Run on |
| 顶部 | `myRCStorageUi` → `RunConfigurationStorageUi`（**仅模板**） | :72-76 | `run.configuration.store.as.project.file`=**Store as project file**（ExecutionBundle:286） |
| 主体 | `content.componentPlace` → `ConfigurationSettingsEditor` 的标签页 | :84-89 | 唯一内建标签 = `run.configuration.configuration.tab.title`=**Configuration**（ExecutionBundle:58，`ConfigurationSettingsEditor.java:86`）；**其余标签由扩展提供，CE 源码里没有 Logs/Common 的实现** |

**本批已完成（2026-09-27）**：`src/components/RunConfigurationsDialog.vue` 按上面的骨架重写 ——
左树 = 类型节点 › 文件夹节点 › 配置节点（分组规则抽到 `src/runConfigTree.ts` + 7 条测试），
树下方是 RunConfigurable 的工具条（添加▾ / 删除 / 复制 / **保存配置** / **新建文件夹**），
右栏 = Configuration 标签页容器 + **可折叠的「启动前」行**（展开状态存 localStorage，对应
PropertiesComponent 的 `ExpandBeforeRunStepsPanel`），对话框宽 880 / 内容高 ≥420（IDEA 是 ≥800×600）。
`RunConfig` 新增 `folder` 字段走全链路（native 白名单 + 校验 `≤80/单行/UTF-8` → `bridge.ts` 类型与预览校验 → 组件）。
顺带修掉一个真 bug：浏览器预览的 `runConfigs` 映射**静默丢掉 `adapter`**（保存调试配置会丢适配器），现在 `adapter` 与 `folder` 都校验并保存。

**仍未做（登记，不造假控件）**：
* **Allow multiple instances**（`run.configuration.allow.running.parallel.tag`=ExecutionBundle:285）：
  原生 runner 只有一个子进程（`native/main.cpp:376-418` 单个 `runner`），勾上也无处生效；
  单实例守卫本来就一直生效（前端 `runState.running` + 原生 `BUSY`）。要真做得先把 runner 改成
  多实例 + 每个实例一个控制台标签（IDEA 的 `RunContentDescriptor`）。
* **Store as project file**（`run.configuration.store.as.project.file`=ExecutionBundle:286）：
  需要把配置写到项目目录的 `.idea/runConfigurations/*.xml`，而原生现在**按设计禁止在用户项目里建配置**
  （`projects_test.cpp` 有断言锁住）。改成写项目目录是独立工程（含 XML 格式与读回）。
* **Run on target**（`RunOnTargetPanel`）：只在模板配置上创建（wrapper `settings.isTemplate()`），
  本仓没有模板配置体系。

---

### G.1-旧：TaoCode 现状（`src/components/RunConfigurationsDialog.vue`，133 行）：左列表（名称 + 类型徽标）
+ 右单页表单（名称/类型/命令/程序/参数/工作目录/环境变量/启动前步骤）——**没有**「存储为项目文件」、
「允许多个实例」、标签页容器，也没有左侧树的分组与「模板」节点。要 1:1 对标需要：
① 左树加「模板」节点与分组（IDEA 的 `RunConfigurationsDialog` 用 `MasterDetailsComponent` + `FolderNode`）；
② 右侧改成「Configuration 标签页 + 顶部一行复选框 + 下方启动前步骤」；
③ `RunConfig` 增加 `storedInProject` / `allowMultipleInstances` 两个字段（含 native 白名单与校验）。
（**已在本批完成上表前 4 项**，后 3 项见上面的登记。）

### G.1-b 顶部主工具栏（本批已按源码重排，2026-09-27）

`PlatformActions.xml:839-853` 定义了新 UI 工具栏的三段：

| 段 | 成员（源码顺序） |
|---|---|
| `MainToolbarLeft` | `main.toolbar.Project` → `MainToolbarVCSGroup`（git4idea/shared.xml:35-38）→ `MainToolbarGeneralActionsGroup`（默认只有分隔符 = 用户自定义动作区） |
| `MainToolbarCenter` | `main.toolbar.Filename` |
| `MainToolbarRight` | `ExecutionTargetsToolbarGroup`（ExecutionActions.xml:134）→ `NewUiRunWidget`（:118，内部 = `RunToolbarMainActionGroup`：RedesignedRunConfigurationSelector → compositeResumeGroup → RunToolbarTopLevelExecutorActionGroup → Stop → MoreRunToolbarActions）→ `SearchEverywhere` → `SettingsEntryPoint` |

修的三处错位：① **运行配置选择器原本排在运行 widget 最后**，源码里它是**第一个**；
② 右段缺 `SearchEverywhere`（只有设置/主题/帮助）；③ **分支 widget 点击切的是源代码管理工具窗口**，
而 `main.toolbar.git.Branches` 打开的是**分支弹窗**（`GitBranchesPopup`）。

### G.2 工具窗口内的多层内容（**本批已核实**，2026-09-27）

读 `platform/platform-impl/src/com/intellij/openapi/wm/impl/content/` 后的真实层级：

| 层 | IDE 的实现 | 事实 |
|---|---|---|
| 条带 | `StripeButton` / `ToolWindowAnchor` | TaoCode 已有（左/右/底三条 + `toolStripeDrag`） |
| 窗口标题栏 | `ToolWindowHeader` + `ToolWindowHeader.kt:119` 的动作组（Dock / Options(齿轮) / Hide） | TaoCode 已有（`toolWindowHeader.ts` + 各面板自己的齿轮） |
| 内容区布局 | `ToolWindowContentUi implements ContentUI`（:95），`type` = **`ToolWindowContentUiType.TABS` / `COMBO`**（:135,150,327,344），三种布局实现 `SingleContentLayout` / `TabContentLayout` / `ComboContentLayout`（:132-151,343-349） | TaoCode 有 tabbed/combo 两种，作用于底部 dock（`src/toolWindowContentUi.ts`）；**单内容窗口用 SingleContentLayout**，与 TaoCode 每个左栏视图只放一个 content 一致 |
| 内容标签旁的动作工具条 | `ToolWindowContentUi.setTabActions(:788-807)` → `tabToolbar`（:141,277,792，`ActionPlaces.TOOLWINDOW_TITLE`） | 全平台**只有项目视图**注册（`ProjectViewImpl.java:1242-1245` 读 `ProjectViewTabToolbar` 组），而 `ProjectViewTabToolbar`（PlatformActions.xml:1186）**是空组**，由插件扩展 —— 本仓无插件，故无内容可移 |
| 内容层级 | `SingleContentLayout.SubContent`（:177-189）：内容可以作为另一个内容的子内容，按需显示 | 本仓没有"子内容"概念，登记待办 |

**顺带核实并已修的错位**：项目视图标题栏动作组 `ProjectViewToolbar`（PlatformActions.xml:1178-1184）= 
`SelectInProjectView` → `ExpandRecursively` → `ExpandAll` → `CollapseAll`。
TaoCode 原来只有「全部折叠 / 全部展开 / 刷新」且顺序相反，本批补齐两项并改成源码顺序
（`FileTree` 新增 `expandRecursively()`；`SelectInProjectView` 用已有的 `reveal()` + 切到项目视图）。
「刷新目录」是 TaoCode 自己的按钮（IDEA 的刷新在右键菜单与 F5），排在 IDEA 四项之后并在代码里注明。

### G.3 项目结构：IDEA 是**独立对话框**，不是设置页（**本批已改**）

`ProjectStructureConfigurable` 由「文件 › 项目结构…」打开（`ProjectStructureAction`），
左侧是 `SidePanel` 的多级分类（Project / Modules / Libraries / Facets / Artifacts / SDKs /
Global Libraries / Problems），右侧是详情。**本批已按源码改成独立对话框**：
* 新组件 `src/components/ProjectStructureDialog.vue`：标题「项目结构」+ 左侧 SidePanel 分类
  （项目 / 模块 / 库 —— 只有这三类有真实内容）+ 右侧详情 + 底部 确定/应用/取消
  （`ShowStructureSettingsAction.java:26-32` 用 `SingleConfigurableEditor` 打开，即模态对话框）。
* `ProjectStructurePane.vue` 新增 `category` prop 做分类切换，并**把手动保存按钮交给宿主**
  （IDEA 的 Configurable 自己不带确定按钮），`defineExpose({ save, resetForm })`。
* 入口：文件菜单「项目结构…」紧跟「设置」之后（`JavaActions.xml:46` `FileMainSettingsGroup`
  `anchor="after" relative-to-action="ShowSettings"`）+ 快捷键 **Ctrl+Alt+Shift+S**
  （`$default.xml:23-26`）—— 快捷键此前错误地打开的是「设置 › 项目结构」页，现已指向对话框。
* 设置树里删掉「默认项目 › 项目结构」页；该分组下暂无页面时显示「本分组下的设置页尚未移植」，
  不显示点开什么都没有的空节点。

---

## H. 2026-09-27 第三批：构建链路（桃点名「真的能构建 java 代码」）+ 窗口菜单层级 + 审计基础设施

### H.1 修掉的一处**逻辑错误**：`startBuild` 写死了 cmake

`src/runActions.ts` 原先只有一行：

```ts
const command = runCommand.value.trim() || 'cmake --build build'
```

⇒ 打开一个 **Gradle / Java 项目**按 Ctrl+F9（构建项目），它会去跑 `cmake --build build`。
IDEA 不是这样：`CompileDirtyAction.java:28-30` 的 `doAction` 走 `ProjectTaskManager.buildAllModules()`，
由 `ProjectTaskRunner` 体系**按项目类型**认领（`GradleProjectTaskRunner.kt:186-214` 的 `canRun`）。

本批把折算规则做成纯函数 `src/projectBuild.ts`（零依赖、有单测）：

| 项目类型 | TaoCode 现在跑什么 | 源码依据 |
|---|---|---|
| Gradle | `gradlew.bat --console=plain classes testClasses` | `TasksExecutionSettingsBuilder.java:151-160`（`getTaskName("", "classes", "main")` ⇒ `classes`，再加 test source set 的 `testClasses`）；模块里没有 `classes` 但有 `assemble` 时退回 `assemble`（`:178-180`） |
| Gradle 的**重建** | 追加 `--rerun-tasks`（**不是** `clean`） | `:52-58` 的 `FORCE_COMPILE_TASKS_INIT_SCRIPT_TEMPLATE` 给 `AbstractCompile` 挂 `outputs.upToDateWhen { false }`，`:143-145` 在非增量构建时注入 —— CLI 的等价物 |
| Maven | `mvn compile`；重建 `mvn clean compile` | `MavenProjectTaskRunner.kt:176-193`（`clean = any { !isIncrementalBuild() }`）、`:215-220`（`getPhase` ⇒ `compile`） |
| 纯 Java（无外部系统） | `javac -encoding UTF-8 -g -d out/production/<模块名> -cp … @argfile` | `JpsProjectTaskRunner`（JPS 编译器）—— 本仓用 javac，这才是「真的能构建 Java 代码」 |
| CMake / 不认识的 | 项目里配置的构建命令 | 原来的行为，保留为兜底 |

**真实验证**（不是只测字符串）：在本机用生成的命令形状编译了一个 Java 源文件 ——
`javac … -d out/production/demo @.taocode-javac-args.txt` ⇒ `out/production/demo/Hello.class`，
`java -cp out/production/demo Hello` 打印 `built ok`。

### H.2 「IDEA 打开默认就有」的三样东西（本批补齐）

桃的原话是「gradle 等配置，IDEA 打开默认都是有的」。逐项对照后补的三处：

| 东西 | IDEA 的来源 | TaoCode 的落点 |
|---|---|---|
| **JDK 列表** | `JavaHomeFinderBasic`（`:59-71` 的 finders 顺序、`:238-256` 的 `scanFolder`、`JdkUtil.checkForJdk:64-72`、`JdkVersionDetectorImpl:54-69` 读 `release` 文件） | `native/jdk.cpp`：JAVA_HOME/JDK_HOME → PATH 里的 `bin` 父目录 → 安装根目录（`Program Files\Java` / `Eclipse Adoptium` / `D:/Java*` …）→ `~/.gradle/jdks`；路由 `app.jdks`；打开项目时**只填空值**地写回 `JavaProjectSettings.jdkHome`（`src/buildHost.ts` 的 `javaDefaults`） |
| **编译输出目录** | JPS 默认 `out/production/<模块名>` | 同上，`javaDefaults` 只填 `outputPath` 为空的项目 |
| **Gradle JVM** | `GradleProjectSettings.java:60` 构造即 `ExternalSystemJdkUtil.USE_PROJECT_JDK`（`ExternalSystemJdkUtil.java:52`） | `BuildToolsGradleSettings.gradleJvm`（默认 `#USE_PROJECT_JDK`），设置页第一项是下拉；跑同步/任务时折成 `JAVA_HOME`（`gradleEnvironment` → `gradle.sync` 的 `env` → `Runner::Spec.environment`） |

### H.3 窗口菜单的一处**层级错放**（本批修正）

审计发现：`PlatformActions.xml:652` 是 `<group id="ActiveToolwindowGroup" popup="true">`
—— 它是**子菜单**，而 TaoCode 把它的成员摊在「窗口」菜单顶层（注释里也承认"TaoCode's menus are flat"）。

| 动作 | IDEA 位置 | TaoCode 原先 | 现在 |
|---|---|---|---|
| HideActiveWindow / HideSideWindows / HideBottomWindows / HideAllWindows | WindowMenu › **ActiveToolwindowGroup** | 窗口顶层 | 收进「激活工具窗口 ▸」 |
| JumpToLastWindow / MaximizeToolWindow / ResizeToolWindowGroup / ToggleContentUiTypeMode | 同上 | 窗口顶层 | 同上（`调整工具窗口` 保持自己的子菜单，成为**二级**） |
| `ActivateToolWindowActions`（激活 XX 工具窗口） | `PlatformActions.xml:1310`，**不带 popup** = 内联组 | 窗口顶层 | **保持顶层**（源码就是内联组，摊平才对） |

### H.4 审计基础设施：`docs/menu-groups.txt`

`scripts/menu_placement_audit.py` 从 IDEA 的 action XML 里抽出**每个菜单组的成员**
（`inline` = group 的直接子元素，`inserted` = `<add-to-group>` 跨文件插入），
按 `anchor` / `relative-to-action` / `weight` 排序，输出 2400+ 行清单。

两处解析坑（都踩过并修正）：
1. **必须用真正的 XML 解析**：菜单是嵌套的（`<group id="FileMenu"><group …/></group>`），
   正则非贪婪会在第一个 `</group>` 收尾，把整棵子树当成一个成员 —— 第一版只抽出 95 个组、主菜单只见 2 项；
2. **`<reference ref="X"/>` 也是成员**：漏了它，「只有引用」的组看起来是空的 ——
   补上后清单从 907 行涨到 2420 行（`ViewMenu` 的 16 项才完整暴露）。
   **当时的结论有一处说得太粗**（本批更正）：那 16 项里的 `EditorIncreaseFontSizeGlobal`
   并不是"本仓还没做"——它与 TaoCode 已有的 `view.increaseEditorFont` 是**同一件事**
   （IDEA 有"当前编辑器临时字号 `EditorIncreaseFontSize`"与"全局字号 `…Global`"两套，
   本仓只有一套）。清单随后补了**同名变体反向索引**（见 §H.5）来防止这类误判。

用法：核对 `src/menus/*.ts` 时，某个动作**在 IDEA 里属于哪个菜单**以本表为准。

---

## I. 2026-09-27 第四批：View 菜单按源码补齐两项 + 清单的「同名变体」反向索引

### I.1 `ViewMenu` 的第一项是「工具窗口」（本批补）

`PlatformActions.xml:521-522`：

```xml
<group id="ViewMenu" popup="true" compact="true">
  <reference ref="ToolWindowsGroup"/>
```

定义在 `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:367`
—— `<group id="ToolWindowsGroup" class="com.intellij.ide.actions.ToolWindowsGroup" popup="true"/>`，
按工具窗口**动态**生成子项。TaoCode 原先 View 菜单里完全没有它。

现在 `src/menus/viewMenu.ts` 的**第一行**就是它，子项用同一张表（`src/toolWindowMeta.ts` 的
`toolWindowOrder` / `toolTitles`）生成，点一行 = `activateToolWindow(id)`。

**它和「窗口」菜单里那批「激活 XX 工具窗口」不是重复**：IDEA 里两处都有 ——
`ToolWindowsGroup` 是 View 菜单的入口，`ActivateToolWindowActions`（`:1310`，**不带 popup**）
是 Window 菜单里的内联组。

**同一天的更正**：上面写的"IDEA 每个窗口还是一个子菜单"是**错的** —— 读了 `ToolWindowsGroup.java:39-44`，`getChildren` 返回的就是一批 `ActivateToolWindowAction`
（**平铺**，没有 Show/Hide/Dock 子菜单）。真正要照抄的是它的**排序**：
`:78-87` 的 `getActionComparator` = 先按助记符（`getMnemonicForToolWindow`，没有的排最后），
助记符相同的再按工具窗口 id（不区分大小写）。已按此实现 `toolWindowGroupOrder()` 并加断言：
有 Alt+数字 的窗口在前（顺序 = 注册顺序），`gradle` 没有助记符所以排在最后。
标题栏 ⋮ 菜单里的"移动到左/右/下 + 隐藏"是 **tool window 自身的 header 动作**
（`ToolWindowHeader.kt:119` 的 `ShowOptionsAction` 那条链），与 `ToolWindowsGroup` 无关，
不需要搬到这里。

### I.2 `EditorResetFontSizeGlobal`（本批补），以及**故意不补**的两条

`PlatformActions.xml:572-588` 的结构（实测，别被名字骗）：

```
572:  <group id="EditorToggleActions" popup="true">
580:    <reference ref="EditorIncreaseFontSize"/>      ← 「当前编辑器」的临时字号
581:    <reference ref="EditorDecreaseFontSize"/>
583:  </group>
584:  <reference ref="EditorIncreaseFontSizeGlobal"/>  ← 「全局」字号（ViewMenu 直接层）
585:  <reference ref="EditorDecreaseFontSizeGlobal"/>
586:  <reference ref="EditorResetFontSizeGlobal"/>
588:  <reference ref="ToggleFocusMode"/>
```

| 动作 | 层 | TaoCode |
|---|---|---|
| `EditorIncreaseFontSize` / `Decrease`（**不带** Global） | ViewMenu › EditorToggleActions | ✓ 已有（就是 `view.increaseEditorFont`） |
| `EditorIncreaseFontSizeGlobal` / `DecreaseGlobal` | ViewMenu 直接层 | **不补** —— TaoCode 只有一套字号语义，已有那两行就是全局的；再放一遍等于同一动作出现两次 |
| `EditorResetFontSizeGlobal` | ViewMenu 直接层 | ✓ **本批补**（`view.resetEditorFont`，回到 `defaultEditorSettings.fontSize`） |
| `ToggleFocusMode` | ViewMenu 直接层 | **待办** —— `ToggleFocusViewModeAction` 写的是 `EditorSettingsExternalizable.isFocusMode()`（新 UI 的聚焦模式状态），本仓没有这个状态；先补宿主状态再做这一行 |

### I.3 清单脚本的改进：**同名变体反向索引**

上一批我在本文档里写过"`EditorIncreaseFontSizeGlobal` 本仓还没做" —— **说得太粗**：
它与 TaoCode 已有的 `view.increaseEditorFont` 是同一件事。这类误判的根源是
**IDEA 用 `X` / `XGlobal` / `XLocal` / `XAll` 表达同一功能的不同变体**，而名字看起来像同一个。

`scripts/menu_placement_audit.py` 现在在清单末尾输出一段反向索引：

```
===== 同名变体（去掉 Global/Local/All 后缀后同名，4 组）=====
  EditorIncreaseFontSize
    EditorIncreaseFontSize        ← EditorActions、EditorToggleActions
    EditorIncreaseFontSizeGlobal  ← EditorActions、ViewMenu
```

**移植前先用它确认"这两个 id 是不是同一个东西"**，再决定是补齐、映射还是明确不补。
（写这段时又踩了一次：第一版只收集"带后缀的那些"，而基名本身 `EditorIncreaseFontSize`
也是一个真实 id，于是家族里只有 1 个成员、被过滤掉 —— 输出"0 组"。修法是把基名本身也算进家族。）

---

## J. 2026-09-27 第五批：主工具栏按 `MainToolbarNewUI` 重排（桃：「工具栏几乎全是错的」）

### J.1 IDEA 的真实构成（`PlatformActions.xml:839-854`）

```xml
<group id="MainToolbarNewUI">
  <group id="MainToolbarLeft">
    <reference ref="main.toolbar.Project"/>
    <group id="MainToolbarGeneralActionsGroup"><separator/></group>
  </group>
  <group id="MainToolbarCenter"><reference ref="main.toolbar.Filename"/></group>
  <group id="MainToolbarRight">
    <reference ref="SearchEverywhere"/>
    <reference ref="SettingsEntryPoint"/>
  </group>
</group>
```

它是一段**独立的一行**（在菜单栏下方）；分支 widget（`main.toolbar.git.Branches`）与运行 widget
由 widget 机制挂到左段，**不在**这个 XML 的成员表里。

### J.2 本批修正的三处

| # | 问题 | 依据 | 修法 |
|---|---|---|---|
| 1 | 菜单栏与工具栏**挤在同一行**（默认档是 `merged`） | ~~`UISettings.kt:863` 初始化时把它设成 `SEPARATE_TOOLBAR`~~ **该依据已被推翻**（那是 `separateMainMenu` 的迁移分支，见 §K.3）；默认档是 `UNDER_HAMBURGER_BUTTON`（`UISettingsState.kt:207`） | 当时把默认值改成 `separate`（**后续批次已改回 `hamburger`**）；模板拆成 `.topbar-menubar-row` + `.topbar-toolbar` 两行；CSS 里靠 `order: 9` 挤行的旧技巧删掉 —— 两行结构本身仍然正确，它是 `SEPARATE_TOOLBAR` 档的样子 |
| 2 | 顶栏有一格「TaoCode」品牌标签 | IDEA 的顶栏第一行**就是菜单栏**（应用名在窗口标题栏上），没有品牌格 | 删掉 |
| 3 | 工具栏末尾有「主题切换」「帮助」两个按钮 | IDEA 的 `MainToolbarRight` 只有 `SearchEverywhere` + `SettingsEntryPoint` | 删掉 —— 两处入口本来就有（主题在「外观」设置页与「视图 › 外观」；帮助在「帮助」菜单） |

顺带把工具栏整块抽成 **`src/components/MainToolbar.vue`**（App.vue 2744 → 2703 行），
这样才有净余量把行拆开（App.vue 一直贴着机检上限）。

### J.3 顺带发现的一处**菜单差异**（已登记，本批未改）

`AnalyzeMenu` 在**整个源码树里只有两处引用**：`java/java-backend/resources/META-INF/JavaActions.xml:61`
（定义）与 `:122`（编辑器右键菜单 `EditorPopupMenuAnalyze` 里引用）——
**从来没有插到 `MainMenu`**。⇒ IDEA master 的主菜单**没有「分析」**；
检查类动作走的是 **CodeMenu › `InspectCodeInCodeMenuGroup`**（清单 `docs/menu-groups.txt:22`、其成员 `:1144`）。

TaoCode 有独立的「分析」菜单 ⇒ **待办**：把检查类动作并进「代码」菜单，其余项按各自源码归属搬。
已登记 `docs/class-parity-todo.md` §10 #2。

### J.4 「全量 UI 检查」怎么做（方法固化）

逐个肉眼比对几千个元素不现实，本仓的可复现做法是：

1. **先生成权威清单**：`python scripts/menu_placement_audit.py > docs/menu-groups.txt`
   （每个菜单组的成员 + 排序 + 同名变体索引）；
2. **按区域逐批核**：主工具栏（本批）→ 主菜单 12 组 → 工具窗口条/活动条 → 状态栏 → 设置树 → 各对话框；
3. 每处结论都写成**「IDEA 位置（含文件:行号）| 本仓原先 | 现在」**三列，修正进本文件，未核的如实登记；
4. **证据不足不改**：例如「分析」菜单只找到"没插到主菜单"这种**否定性证据**，就只登记待办，
   不凭印象删菜单。

## K. 2026-09-28 第六批：顶栏（标题行 / 主工具栏行）的**度量与行结构**按源码归位

### K.1 顶栏是几行，由**两个**设置决定，不是一个

`mainMenuDisplayMode` 只决定「菜单怎么放」（`ShowMode.kt:20-24`）：

| MainMenuDisplayMode | ShowMode | CoreBundle.properties 里的原文 |
|---|---|---|
| `UNDER_HAMBURGER_BUTTON`（**默认**，`UISettingsState.kt:207`） | `TOOLBAR` | Hide under Hamburger Button（:159） |
| `MERGED_WITH_MAIN_TOOLBAR` | `TOOLBAR_WITH_MENU` | Merge with Main Toolbar（:158） |
| `SEPARATE_TOOLBAR` | `MENU` | Show above Main Toolbar（:157） |

而**主工具栏在哪一行**由第二个设置决定（`CustomWindowHeaderUtil.kt:122-135`
`isToolbarInHeader`，Windows 分支要求 `mainMenuDisplayMode != SEPARATE_TOOLBAR` **且**
`mergeMainMenuWithWindowTitle` 为真；后者在 Win10+ 默认就是 true，`UISettingsState.kt:226-227`）：

- 在标题行里 → 一行（`ToolbarFrameHeader.kt:446-452` 的 `toolbarPnl` = 「菜单格 → 主工具栏」两格）；
- 不在 → 主工具栏被摘出标题行（`ToolbarFrameHeader.kt:184-190` 把 `toolbar` 置 null），
  由宿主另起一行装进客户端区（`ProjectFrameCustomHeaderHelper.kt:354-368`）→ 两行。

⇒ TaoCode 的三档 CSS 保持「hamburger/merged 一行、separate 两行」是对的；本批改的是**每行的内缩**。

### K.2 逐条度量（左/右内缩、组间距、行高）

| 位置 | 上游值与出处 | 本仓原先 | 现在 |
|---|---|---|---|
| 顶栏整体内缩 | 没有「整体内缩」这个概念：每一行各自决定 | `.topbar { padding: 0 12px }` 一刀切 | `.topbar` 内缩清零，改由三行各自负责 |
| 菜单格 / 汉堡格左边距 | `ToolbarFrameHeader.kt:504` `emptyLeft(scale(if (iconRightPosition) 16 else 4))`，窗口按钮在右（Windows 即 `:248` 分支）时是 **16** | 12 | `--header-inset: 16px` |
| 菜单格 ↔ 主工具栏 | `ToolbarFrameHeader.kt:271` `empty(0, scale(4))`（第二个参数是**横向**，两侧各 4） | `gap: 16px`（`--space-4`） | `--header-menu-gap: 4px`，且 `hamburger`/`merged` 的行 `gap: 0`（4 由工具栏自己的左右内缩出） |
| 独立成行的主工具栏 | `ProjectFrameCustomHeaderHelper.kt:364` `toolbar.border = emptyLeft(5)`：**只有**左边 5，右侧没有 | 12 | `--toolbar-row-inset: 5px`，右侧 0 |
| 组内两个组件之间 | `MainToolbar.kt:137` `layoutGap = 10` + `HorizontalLayout.kt:186` `x += width + gap` | 无（靠 spacer 撑） | `--toolbar-group-gap: 10px` 挂在 `.topbar-toolbar` 的 `gap` |
| 组与组之间 | `HorizontalLayout.kt:19`「组间是**双倍**间距」，:145 `+ gap + gap` = 20 | `.topbar-spacer { min-width: 20px }`（+ 两侧 0 间距） | spacer `min-width: 0`，20 = gap 出两次 |
| 行右边缘 | `HorizontalLayout.kt:135` `rightX = width`（右组贴边），窗口按钮同样是 `fillContent:251` 直接 add 到 EAST，无内缩 | 12 | 0 |
| 标题行高 | `CustomHeader.kt:70-72` DFM 30 / 紧凑 32 / 正常 40，由 `CustomWindowHeaderUtil.kt:141-145` 三选一 | 紧凑档 **34**（无出处） | 紧凑档 32 |
| 设置页三档的**顺序与文案** | `AppearanceConfigurable.kt:509` 用 `MainMenuDisplayMode.entries`（声明顺序），显示文本 = `description`（`MainMenuDisplayMode.kt:27 toString`）；标签 = `IdeBundle.properties:3282` "Main menu:" | 顺序 merged/separate/hamburger；文案「合并到主工具栏 / 独立工具栏 / 隐藏在汉堡按钮下方」；提示写「合并（默认）」 | 顺序按枚举；文案照三条 CoreBundle 原文；标签「主菜单」；提示改为「默认是隐藏在汉堡按钮下方」 |
| 缺值回退 | `MainMenuDisplayMode.kt:20` 认不出的值回退 `UNDER_HAMBURGER_BUTTON` | `mode \|\| 'merged'` | `mode \|\| 'hamburger'`（`src/appearanceActions.ts:64-68`） |

### K.3 **收回**上一批的一条结论

`docs/ui-placement-audit.md` §J.2 第 1 行与 `docs/ui-parity-checklist.md` 都写着「IDEA 的默认档是
`SEPARATE_TOOLBAR`，依据 `UISettings.kt:863`」。**这条是错的**：`UISettings.kt:862-865` 是一个
**迁移分支** —— 只有旧的 `separateMainMenu` 布尔为真时才把显示模式改写成 `SEPARATE_TOOLBAR`（随后把该布尔清掉）。
真正的默认值在字段声明处：`UISettingsState.kt:207` `by string(MainMenuDisplayMode.UNDER_HAMBURGER_BUTTON.name)`，
并且 `MainMenuDisplayMode.valueOf` 对认不出的值同样回退到它（:20）。
默认值本身已由后续批次改对（`native/settings_schema.cpp:264`、`src/settingsModel.ts:141` 都是 `hamburger`），
本批把**残留的错误文案与回退值**一并改掉，并把 §J.2 那行标注为已更正。

### K.4 本批**没做**、已核过源码的差异（不是"不做"，是登记）

1. `MERGED_WITH_MAIN_TOOLBAR` 的**溢出折叠**：上游把顶层菜单横向摆在工具栏左侧，宽度不够时
   从**尾部**逐项藏进一个 `ChevronRight` 溢出按钮（`MainMenuWithButton.kt:62-131`，
   预算式 :88、藏 :92-103、回补 :104-117、按钮可见性 :119；至少留一项 :75-80/:121-125）。
   TaoCode 的 merged 档目前把整条菜单栏平铺、超宽只靠裁切 ⇒ 缺这套逻辑，本批之后补。
2. 标题行菜单 ↔ 窗口标题的 **44px** 列间距（`ToolbarFrameHeader.kt:282`
   `UnscaledGapsX(44)`）：这一格是 `menuBarHeaderTitle`（窗口标题），TaoCode 的窗口标题由**原生标题栏**
   承担、DOM 里不渲染标题 ⇒ 判定 **N/A**，不为了凑数造一个标题格。
3. 主工具栏底色：`ProjectFrameCustomHeaderHelper.kt:361` 独立行用
   `JBUI.CurrentTheme.CustomFrameDecorations.mainToolbarBackground(true)` 且 `isOpaque = true`；
   标题行里的工具栏 `isOpaque = false`（`ToolbarFrameHeader.kt:334` 走默认参数）。
   本仓两行同色（`--rail` / 项目色 tint），差异只体现在「独立行是否比标题行更实」——待与颜色令牌一起核。

### K.5 顶栏**配色**按 expUI 归位（同一批的第二段，浅色主题的顶栏是深炭色）

先纠正一条子代理给的假线索：它说上游是 `intellijlaf.theme.json:1103-1116` 的 `#f2f2f2`。**本仓浅色主题对的是
expUI（新 UI）**，证据是本仓 `--panel` 的字面值 `#f7f8fa` 正是 `expUI_light.theme.json:21` 的 Gray13，
而 intellijlaf 的面板是 `#f2f2f2`。所以顶栏取的是 **`MainToolbar` 那一组键**，不是旧 UI 的灰。

消费链（一次读完整）：`JBUI.java:564-572 mainToolbarBackground(active)` →
`ToolbarFrameHeader.kt:424-427 getHeaderBackground()`（标题行）与
`ProjectFrameCustomHeaderHelper.kt:361`（独立成行的主工具栏）**同一个键** ⇒ 两行同色；
`CustomHeader.kt:166-168` 记 `isActive = window.isActive` ⇒ 失焦换 `inactiveBackground`。

| 令牌 | 浅色（expUI_light） | 深色（expUI_dark） | 上游键 |
|---|---|---|---|
| `--header-bg` | `#27282e` | `#2b2d30` | `MainToolbar.background = Gray2`（light:760 / dark:757） |
| `--header-bg-inactive` | `#383a42` | 同激活色 | light:762 `inactiveBackground = Gray3`；深色主题**没有**这个键 → JBUI.java:570 回退 |
| `--header-fg` | `#ebecf0` | `#dfe1e5` | light:761 `foreground = Gray12`；深色由 :1063-1064 `RunWidget.foreground/iconColor = Gray12` 定 |
| `--header-hover` | `#383a42` | `#393b40` | light:766-767 / dark:749 `Icon.hover/pressedBackground = Gray3` |
| `--header-line` | `#494b57` | `#43454a` | `MainToolbar.separatorColor = Gray4`（light:763 / dark:758） |
| `--header-run-bg` | `#599e5e` | `#57965c` | `RunWidget.runningBackground`（light:1096 / dark:1065 = Green6） |
| `--header-run-hover` `-pressed` | `#00000019` `#00000028` | 同 | light:1098-1099 = dark:1067-1068（两套主题字面量相同） |

三处**逻辑**随颜色一起改掉（不是换 hex）：

1. **播放图标不上色**：`RunWidget.iconColor = Gray12`（light:1095），本仓原先写 `color: var(--success)` 是绿的；
   「运行中」也不是红字，而是**整格换绿底 + 图标仍浅色**（light:1096-1097 `runningBackground` / `runningIconColor`）。
2. **项目色是图层，不是替换值**：旧写法 `background: var(--project-tint, var(--rail))` 在开了
   `differentiateProjects` 时把底色换成半透明渐变 ⇒ 底色变 transparent。上游是
   `ToolbarFrameHeader.kt:308-316`：先让 `ProjectWindowCustomizerService.paint(...)` 画渐变，**没画才** `fillRect(background)`。
   现在拆成 `background-color` + `background-image` 两层。
3. **深色顶栏上的状态色取同名 key 的深色版本**：`FilenameToolbarWidgetAction.kt:67-70` ——
   亮色主题 + `isDarkToolbar()`（:92 直接量 `MainToolbar.background` 的亮度）时，前景改取
   **"Dark" 配色里同一个 `status.colorKey`**（顺带 :68 把图标 `getDarkIcon`）。
   本仓照此给行面上的文件名 新增/修改/删除 三态与 ↑↓ 计数换了 `--header-success/accent/error`，
   **弹层里的行**仍是浅色面板那组。

机检：`tests/header-color-tokens.test.mjs` 把七个字面量与这三条逻辑一起钉住（含
「不许退回 `background: var(--project-tint, …)` 二选一写法」这条反向断言）。

## L. 2026-09-28 第八批：主菜单**没有「分析」档**，检查这一族回到代码菜单

§J.3 当时只找到"没插到 MainMenu"这种**否定性证据**，所以只登记没动手。这一批把肯定性证据也拿到了，
于是真的搬：

| 依据 | 内容 |
|---|---|
| `tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2444-2456` | `[group MainMenu]` 解析后的 12 个直接子项：FileMenu / EditMenu / ViewMenu / GoToMenu / CodeMenu / RefactoringMenu / BuildMenu / RunMenu / ToolsMenu / VcsGroups / WindowMenu / HelpMenu。**没有 AnalyzeMenu** |
| `java/java-backend/resources/META-INF/JavaActions.xml:61-66` | `AnalyzeMenu` 是 `popup="true"` 的**上下文菜单组**，只 `add-to-group` 到 `ProjectViewPopupMenu` 与 `NavbarPopupMenu`（锚 `ReplaceInPath` 之后）；`:120-124` 的 `EditorPopupMenuAnalyze` 再挂到编辑器右键（`EditorPopupMenu1`，锚 `FindUsages` 之后） |
| `platform/platform-impl/resources/idea/LangActions.xml:230-259` | 主菜单里的检查入口 = `CodeMenu` 里的 `InspectCodeInCodeMenuGroup`（紧跟 `CodeCompletionGroup`）= `InspectCodeGroup{InspectCode, CodeCleanup}` + `AnalyzeActionsPopup{AnalyzeActions}` + `AnalyzePlatformMenu{Unscramble}` |
| `ActionsBundle.properties:794/799/1765`、`IdeBundle.properties:1041`、`keymaps/$default.xml:276-278` | `Analy_ze` / `_Inspect Code…` / `Analyze Code` / `&Run Inspection by Name…` + `control shift alt I`；`InspectCode` 在默认键map 里**没有**快捷键 |

改动：

1. 主菜单去掉「分析」档（`src/App.vue` 的 `menus`、`menu` 联合类型与装配段）。本仓的 12 档顺序
   与解析结果一致（工具/窗口两档由 `src/menuUi.ts:58-82` 的 `allMenuGroups` 插到 Git 前后）。
2. `src/menus/analyzeMenu.ts` 改成**这一族的行工厂**（`inspectCodeRow` / `runInspectionRow` /
   `createInspectCodeInCodeMenuRows`），由 `src/menus/codeMenu.ts` 在补全组之后展开。
3. 文案按上游：`Inspect Code…` → 「检查代码…」（**不给**快捷键），`RunInspection` →
   「按名称运行检查…」+ `Ctrl Shift Alt I`（原先两条的键位是反的且没有出处）；
   `AnalyzeActionsPopup` 保留成**子菜单**而不是拍平。
4. 原「分析」档里另外两条（查看当前文件问题 / 待办事项）删掉：它们不是 `AnalyzeMenu` 的成员，
   而是工具窗口激活动作，本仓在「窗口」菜单（`window.activateProblems`）、「工具」菜单
   （`tools.taskList`）、条纹按钮与底部标签里都已经有入口 —— 那是第三份重复。
5. 上游有、本仓没有实现的条目一律**不放**（不造假控件）：`CodeCleanup`、`SilentCodeCleanup`、
   `PopupHector`、`ViewOfflineInspection`、`SliceBackward/Forward`、`Unscramble`。

机检：`tests/main-menu-parity.test.mjs`（4 条）—— 12 档与顺序、检查族在代码菜单的位置、
两条动作的文案与键位、以及"没有第三份工具窗口入口"。

6. `AnalyzeMenu` 挂到了它真正的宿主上 —— **项目树右键菜单**，锚点照上游 `ReplaceInPath` 之后
   （`src/App.vue` 的 `treeMenu` 段 + `treeSubmenu === 'analyze'`）。行数据仍来自同一批行工厂
   （`createAnalyzeMenuRows(codeMenuContext)`），没有第二份实现。

**同一族剩下的待办**：编辑器右键菜单那一处（`JavaActions.xml:120-124` 的 `EditorPopupMenuAnalyze`
挂在 `EditorPopupMenu1` 的 `FindUsages` 之后）。本仓编辑器右键目前走的是浏览器原生菜单
（`CodeEditor.vue` 没有自绘的 `EditorPopupMenu`），所以要先有那个容器再挂 —— 已登记，不是这一批。

## N. 2026-09-28 第九批：配色换成我们自己的「月相」体系，浮层族统一规格

桃的口径：**「颜色可以修改为适合我们的颜色，符合月之亮面／月之暗面动态调整，但布局要严格符合源码」**。
于是把 tokens.css 改成真正的三层，并把"哪一层归谁"写进文件头：

| 层 | 内容 | 换主题时 | 出处 |
|---|---|---|---|
| 1 · 度量 | 内缩、组间距、行高、按钮/图标尺寸、圆角、时长、缓动 | **不变** | 每条都带 IDEA 的 file:line（本文件 §K 那批） |
| 2 · 月相原色 `--m-*` | 中性阶、强调色、夜面（顶栏）、浮层（弹窗）、语法九色、状态色 | **只换这一层** | 我们自己的配色 |
| 3 · 语义别名 | `--editor/--text/--accent/--header-*/--completion-*` … | 只声明一次，全部 `var(--m-*)` | 名字沿用组件读的那些 |

这样"动态调整"不是运行时算色，而是**级联本身**：`data-theme` 一换，月相层换值，
所有语义名（含顶栏、补全弹窗、语法着色）跟着换面，组件里一个十六进制都不许有。

### N.1 月相两档的取色

- **月之亮面**：月白瓷面带冷蓝相（`--m-editor #fcfdff → --m-rail #eaeef5`），字色是墨蓝四级
  （`#232d40 / #3d4a63 / #55617a / #606c82`），交互色月相蓝 `#3c6ba8`，
  "光"这一类语义（搜索命中、调试当前行、拖放聚焦）统一走月华金 `#b3812a/#c08a2e` 一族。
  顶栏仍是**夜面** `#16202f` —— 那是结构（§K.5 的角色映射），不是配色偏好。
- **月之暗面**：夜面深蓝黑四级（`#12161f / #171d28 / #1c2331 / #1f2735`），字色月银，
  交互色 `#7fa9e8`，光走 `#e0b464`；顶栏比面板再深一档（`#0b101a`），
  且**失焦不变色**（上游深色主题没有 `inactiveBackground` 键，JBUI.java:570 的回退行为）。
- 七个具名**文件色不动**（`FileColorManagerImpl.ourDefaultColors` 的 JBColor 左右半）：
  那是用户可见的具名标识，不是界面配色。

### N.2 补全弹窗（代码提示窗口）重做

度量一条没动（`List.rowHeight` 24、最多 11 行、bodyInsets 4、图标 inset 6、右留白 10、
最大宽 500、文本与图标对齐到 lookupStart —— 每条旁注了上游类与行号）。改的是**外观与一致性**：

1. **颜色全部搬到令牌层**：删掉 `completionColors` 与按 CM light/dark 各发一份的 `colorRules()`；
   现在读 `--completion-*` / `--popup-*`，所以换主题时它和菜单、顶栏一起换面。
2. **浮层族统一**：`--popup-radius` / `--popup-border` / `--popup-shadow` 三个令牌，
   23 处 `position: absolute|fixed` 的浮层（菜单、项目 widget、文件名、分支、配置选择器、
   状态栏各弹层、书签齿轮…）以前有 5 种各写各的配方，现在同一套。
   阴影只留一档（`--m-menu-shadow`），对话框仍用更重的 `--shadow-3`（它是窗中窗）。
3. 选中行加一道 2px 的"月光"左缘标记（`::before`），长列表里当前项不只靠底色区分；
   命中字符上色加粗但**不划线**（划线专属"已弃用"，两种语义不能共用一种笔法）。
4. 右侧文档面板（`completionItem/resolve` 回来的内容）改成同规格浮层，
   并且容器**不许 `overflow: hidden`** —— CM 把该面板绝对定位在 tooltip 内、列表右侧，一裁就没。
5. 出现动效与菜单同一套语汇（`--dur-1` + `--ease`，用独立的 `translate` 属性避免和 CM 的
   `transform` 抢），reduced-motion 由全局规则统一关。

### N.3 机检（换配色这件事本身也要有防回归）

`tests/moon-palette.test.mjs` 6 条：两档月相**名集合必须一模一样**（漏一个就会静默串色）、
语义层不许出现裸色、`completionUi.ts` 不许有裸色、浮层不许自带旧配方、弹窗不得裁文档面板、
动效必须用令牌。`tests/header-color-tokens.test.mjs` 改成钉**角色→键**的映射 + 两档字面量，
并把被我们替换掉的上游原值留在断言消息里（看得见偏离了哪一行）。
`tests/appearance.test.mjs` 的两条对比度门改为**顺着 `var()` 解析后**再算
（旧实现只认"语义名后面直接跟十六进制"，三层结构一改就误报），阈值与那条自证负例都保留：
两档的 `text/secondary/muted` × 四种表面、`on-accent` vs `accent`、九个语法色 vs 编辑区，
全部 ≥ WCAG AA 4.5:1；`active-line/symbol-highlight/debug-line` 的 alpha 仍 < 0.2
（否则会把下面的选区盖掉）。

## O. 2026-09-28 第十批：浮层的文字必须自带前景色 + 底部停靠的窗口要能搬回来

两件都是用户实测抓出来的，都不是"配色选错"，而是**结构性的漏**。

### O.1 月之亮面下主菜单看不清（浅字压在白底上）

根因：`src/style.css` 的 `.topbar { color: var(--header-fg) }`（深炭色顶栏配浅字，本身是对的），
而下拉面板 `.dropdown` 就渲染在 `.topbar` 里面，它自己**从来没写过 `color`** —— 于是继承了
`#e7edf6` 压在 `--elevated`（亮面 = `#ffffff`）上。深色主题看不出来，只是因为它的浮层底色也是深的；
禁用行再叠一层 Chrome 对 `disabled` 按钮的 UA 淡化，两档主题一个灰法。

上游不这样：expUI 的通配组 `"*"` 给**所有组件**统一 `foreground` / `disabledForeground`
（`expUI_light.theme.json:108-116`），组件不靠父容器继承文字色。所以补的是这条规则，而不是调一个色值：

- 新令牌 `--popup-foreground`（= `--m-pop-fg`）与 `--popup-disabled`
  （= `--m-pop-disabled`，亮 `#A8ADBD` = Gray8 `expUI_light.theme.json:16,114`；
  暗 `#5A5D63` = Gray6 `expUI_dark.theme.json:14,123`）。
  **禁用档故意低于 AA** —— 它表达"不可用"，所以不进对比度门禁（门禁只管正文三档）。
- 机检 `tests/popup-foreground.test.mjs`：凡是"画了浮层底色（`--elevated` / `--popup-background`）
  且选择器是浮层语素"的规则，必须同时自己声明 `color:`。这条一扫就把同类漏全揪出来了：
  `.dropdown`、`.project-widget-popup`、`.filename-popup`、`.tool-menu`、`.status-toolwindows-popup`、
  `.status-widget-menu`、`.config-chooser`、`.tree-menu`、`.settings-crumb-menu`、`.signature-popup`。
  判据自带反例（删掉 `color` 必须报、非浮层的 `.run-command` 不许误伤、扫描器命中数 ≥6 否则算空转）。

### O.2 工具窗口"移动到底部"是单向的

「移动到 左侧/右侧/底部」三条只挂在 `ToolWindowHeader` 的菜单上；窗口一旦沉到底部，左/右栏就不再渲染
它的标题栏，于是**没有任何入口**能把它搬回去。IDEA 的头部属于窗口本身、跟着窗口出现在它停靠的那个 dock
（`ToolWindowHeader.kt:119` 起），底部窗口同样改得了锚点。

补法：底部 dock 的工具窗口标签右键 → 同一个三条菜单（`src/components/ToolWindowAnchorMenu.vue` +
`toolWindowActions.ts` 的 `anchorMenu / openAnchorMenu / moveAnchorTo`）。三条方向与标题栏同源
（UIBundle `tool.window.move.to.action.group.name` 只给 Left/Right/Bottom，`ToolWindowAnchor` 没有"顶部"），
当前所在那一侧置灰；换锚点后走 `showView`，由它按 `activationTarget` 选 dock（与
`ToolWindowManagerImpl.activateToolWindow` 一致），并落盘锚点表。机检 `tests/tool-window-anchor.test.mjs`。

### O.3 语言服务独占一条线程（修「窗口未响应」）

现象：打开 `E:/Applied Energistics 2 Acceleration` 约 2 秒后标题栏出现「未响应」，CPU 停在 3.1s
不动（**park，不是死循环**）；小项目 untitled3 从不复现。

定位过程（全部实测，中间有一次猜测被数据否掉）：
1. 给宿主加请求边界追踪（`TAOCODE_TRACE_REQUESTS=1` → `taocode.log` 记 `begin/end <method>[:<kind>]`）。
   卡住时最后一行是 `begin lsp.request:status` 且没有 end → UI 线程停在 `Session::status()`
   的 `std::lock_guard(mutex_)`（`native/lsp_capability_queries.cpp:148`）。
2. 加锁归属追踪（`trace::Lock` 记录持有者线程 + 获取点）。报出：
   `等锁 status 已 20515ms（线程 A），线程 B 在 ensure::<lambda_3> 已持有 20547ms` —— 持锁者是
   **Host 读线程上的 initialize-ready 回调**。
3. 我先猜"锁里写 stdin 把管道写堵了"，并加了慢写 WARN。**数据否掉了它**：一条 WARN 都没有
   （原因是 WARN 写在 `WriteFile` 返回之后，写不返回就永远不记 —— 这个盲区本身也已修）。
4. 真形状：ready 回调抱着 `Session::mutex_` 调 `did_open` → 要 `Host::io_mutex_`；而 `io_mutex_`
   被另一条路径上的**阻塞 `WriteFile`** 抱着（`write_frame` 在 `io_mutex_` 里）。两条锁序相反 → 死锁。
   大项目才复现，因为 jdt.ls 要导 Gradle，回 initialize 的时机正好撞进临界区。

修法（按桃定的方向：**给语言服务单开一条线程**，不是加写线程、更不是关语言服务）：
- 新增 `native/lsp_worker.{hpp,cpp}`：一条串行线程，`post()` 只入队、`stop()` 先排干再 join、
  stop 之后投递就地执行（收尾通知不能丢）、任务抛异常不带走线程。
- `native/main.cpp`：`lsp` 只在这条线程上创建/使用/销毁。五个 `lsp.*` 处理器改成投递 + 经
  `queue_lsp` 按请求编号回包（前端的 `pending` 按 id 认领，**调用契约不变**）；
  `reset_lsp` / `stop_lsp` / `announce_file_change` / Java 配置更新同样改成投递。
- 读线程的 ready 回调改成**只登记状态**，补发 `didOpen` 交回语言服务线程
  （`Session::flush_opens`：锁内只收集，锁外才发送）。没有宿主线程可交时（离线自测）保留就地补发兜底。
- 收尾顺序：先 `lsp_worker->stop()` 排干并 join，再 `stop_lsp_now()` 收子进程。

验证：同一项目同一口径，等锁告警 **11 → 0**；30s 全程 `Responding=True`，jdt.ls 存活，
21 次 `lsp.*` 正常投递。回归防线：`native/lsp_worker_test.cpp`（6 条，ctest `lsp_worker_thread`）
+ `tests/lsp-thread.test.mjs`（5 条结构判据，含"投递之前不许同步调 Session"和两条反例）。

## P. 2026-09-29 第十一批：补全被模板吃掉、标签条溢出没接线、子目录 Gradle 工程没法链接

现象（桃的三句原话）：「依旧没有代码补全提示，识别不到 gradle，上边栏文件打开超过一定数量就看不到后面的 tab 了」。

### P.1 标签条：算法在、接线断了

`src/tabStripLayout.ts` + `src/tabStripView.ts` 早就照 `ScrollableSingleRowLayout` 算出了
`placed / dropped / moreButtonVisible`，但 **App.vue 的模板一个都没消费**：没注册 strip 元素
（`registerTabStrip` 从没被调用 ⇒ `recomputeTabStrip` 直接 return，布局恒为 null）、没有「…」按钮、
没按算出的宽度落 style，而 `.editor-tabs` 是 `overflow: hidden`（style.css:366）——
于是超出宽度的标签**既看不见也够不着**。955 个前端用例全绿也照样坏，因为纯函数用例只测算法。

接线（`JBTabsImpl.kt:1089-1098`：`showMorePopup()` 的内容 = `filter { effectiveLayout.isTabHidden(it) }`）：
`:ref="element => registerTabStrip(pane, element)"`、`v-for="(tab, index)"` + `tabWidthStyle(pane, index)`、
`v-if="tabStripLayouts[pane]?.moreButtonVisible"` 的「…」按钮、`TabMoreMenu` 弹窗选中即 `switchTabIn`。
被挤出的标签给 **零宽**而不是 `display: none`：源码的 `layoutStopped` 就是给零尺寸，而且只有留着盒子，
下一轮 `measureTabNaturalWidth` 才量得到它自己的自然宽度（量到 0 不缓存 ⇒ 会在阈值上抖）。
`.tab-more` 定宽 28px = 布局里预留的 `tabMoreButtonWidth`，预留与实际画的必须一致。
新判据：`tests/tab-strip-wiring.test.mjs`（5 条，全部带反例）。

### P.2 代码补全：`override` 让实时模板把语言服务挤掉了

宿主日志里 `lsp.request` 只有 `status`，**一条 `completion` 都没有** ⇒ 请求根本没发出去。
量 `src/templates.ts` 的 `candidates()`：光标在 `text.` 的点号后时 `postfixAt` 拿到的 key 是**空串**，
`entry.key.startsWith('')` 对所有后置模板成立 ⇒ 返回 10 项。而 `completionUi` 用的是
CodeMirror 的 `autocompletion({ override: sources })` —— **第一个非空即止**，于是
`[templateCompletion, lspCompletion]` 里第二个永远轮不到。

上游不是这样：IDEA 的 `CompletionResultSet` 是**合流**的，后置模板只是一个普通提案
（`PostfixCompletionProposalAgent`），与语义提案同列表。所以改成一次合流：
`src/completionMerge.ts` 的 `mergeCompletionResults(语义, 模板)`（语义在前、同名只留语义那条），
CodeEditor 注册单一源 `completionUi([mergeCompletion])`。

真实服务器侧同时量了一遍（`native/lsp_real_test.cpp` 现在也断言补全）：临时工程 = 根目录**没有**
`build.gradle`、Gradle 工程在子目录 `demo/`（wrapper 6.8.3，与 AE2 同构），对着 `text.` 问补全，
随发行的 JDT LS 1.44.0 回 50 项，含 `length()` / `toString()` 等真实成员；Buildship 写出
`.classpath`（`src/main/java` 带 `gradle_scope` 属性）⇒ 同步确实完成。
判据踩过的坑：JDT LS 给方法的 label 是 **带括号的 `length()`**，按 `== "length"` 断言会把一次
正常补全误判成失败。

### P.3 Gradle：根目录规则没错，缺的是「链接」这一半

`detectGradle` 只看工作区根**不是 bug** —— IDEA 的自动链接同样只看根：
`GradleWarmupConfigurator.kt:118-128 linkRootProject` 只 `findFirstThatExist(basePath/build.gradle, build.gradle.kts)`，
没有就返回 false（另一条 `linkGradleHintProjects` 读 `intellij.yaml` 的 `projectsToImport`）。
AE2 的根目录只有 `AE2-refs/` 与 `AE2VMAddon-*/`，工程在下一层 ⇒ IDEA 同样不会自动链接。

真正缺的是**链接的动作**：`Gradle.ImportExternalProject`
（`ImportProjectFromScriptAction.kt:18-30`：可见性 = 文件名 ∈ `KNOWN_GRADLE_FILES` 且该目录未链接；
动作 = `linkAndSyncGradleProject(project, virtualFile.parent.path)`），
挂在 `ProjectViewPopupMenuSettingsGroup` + `EditorPopupMenu`（`intellij.gradle.xml:408-411`），
文案 `GradleBundle.properties:141-142`「Link Gradle Project / Link Gradle project described by this file」。
TaoCode 补上：项目树右键「链接 Gradle 项目」⇒ 写项目级 `buildTools.gradle.linkedProjects` ⇒
按该目录检测/同步（`gradle.sync` 的 root 跟着走，对应 `GradleConnector.forProjectDirectory(File)`）。
工具窗口的可用性判据也改成上游那条：`AbstractExternalSystemToolWindowFactory.java:32-34`
`shouldBeAvailable = !getLinkedProjectsSettings().isEmpty()`（原来是 `detection.isGradle`，
子目录工程就永远没有窗口）。工具条补 `ExternalSystemView.ActionsToolbar.AttachProjectPanel`
里的 `ExternalSystem.DetachProject`（文案 `ExternalSystemBundle.properties:67`「Unlink {0} Project」）。

上限（`ponytail:` 已在代码里标注）：TaoCode 的 Gradle 工具窗口是单工程形状，链接列表虽然能存 N 项，
检测/同步只取**第一项**；要真支持多工程并列，得先给 `GradleProjectNode/GradleTaskNode` 带上所属工程，
再改工具窗口的分组 —— 已登记在 docs/class-parity-todo.md。

### P.4 顺带补上的一条断链：Gradle 运行设置从没送给语言服务

`java_lsp_settings` 只发 `java.configuration.runtimes` 与 `java.project.*`，
「构建工具 › Gradle」那一栏（用哪个 Gradle、Gradle JVM、离线、用户主目录）**从没进过 initialize/didChangeConfiguration**
—— JDT LS 用 Buildship 自己跑 Gradle 同步，这些正是它要的输入。键名按**实际在跑的那一份**核对：
`build/jdtls/plugins/org.eclipse.jdt.ls.core_1.44.0.202501221502.jar` 的 `Preferences.class` 常量池里
`java.import.gradle.{enabled,home,version,wrapper.enabled,java.home,jvmArguments,arguments,offline.enabled,user.home,annotationProcessing.enabled}`。
现在映射 `wrapper.enabled / home / java.home / user.home / offline.enabled`。

诚实标注：这次实测**没有**证明 AE2 的补全失败是它造成的 —— 探针工程里 Buildship 已经从
`java.configuration.runtimes` 的 default VM 拿到了 JDK 8，同步照常完成（`.classpath` 为证）。
它修的是"用户在设置里改了 Gradle JVM / 指定 Gradle 路径 / 勾了离线，语言服务却完全不知道"这条断链。
AE2 那边 jdt.ls 停在 `No previous Gradle project at ...AE2-1.16.5-src, it must be synchronized`
（60s+ 未完成）是 Gradle 同步本身没跑完，属于这台机器上 wrapper 依赖网络的环境约束，不是 IDE 能替它完成的。

## Q. 2026-09-29 第十二批：编辑器右键菜单 + 工具窗口齿轮的缺失项

接上一批登记的两条"还差"，这一批把**弹出菜单**这条线补齐，并顺手把齿轮菜单里
本仓真能接住的动作接进去。两块用的是同一个设计：**组只登记引用，不复制文案**。

### Q.1 `EditorPopupMenu`（编辑器右键）

上游这个组几乎每一行都是 `<reference ref="已存在的 action"/>`
（`PlatformActions.xml:857-878` + `LangActions.xml:26-30 / :100-102 / :566-578 / :595-597` +
`intellij.gradle.xml:408-411` + `intellij.vcs.git.backend.xml:532-545`），
组本身只规定引用顺序与分隔线。所以 TaoCode 侧新增 `src/menus/editorPopupMenu.ts` 只写引用清单，
运行时由 `menuUi.findMenuRow(id)` 从**主菜单动作索引**里取行 —— 标题、快捷键、可用性、执行
全部沿用那一份，不存在"右键里显示的键位和菜单里不一样"这种漂移。

要点：
- `EditorPopupMenu1.FindRefactor` 是 **compact** 组：解析器把它换成 `DefaultCompactActionGroup`
  （`XmlReader.kt:302`），该类只额外打开 `HIDE_DISABLED_CHILDREN`（`DefaultCompactActionGroup.java:24-28`），
  组上没有 `popup="true"` ⇒ 成员**摊平**进父菜单，而不是变成一行子菜单。
- 三个真 popup 组的标题取自 bundle：`group.Copy.Paste.Special.text=Copy / Paste Special`(:452)、
  `group.EditorPopupMenu.GoTo.text=Go To`(:1359)、`group.FoldingGroup.text=Folding`(:621)。
- 取不到的 id 直接丢掉；成员全丢的组整段不出现；连续分隔线合并、首尾不留分隔线。
- 上游有、本仓没有对应动作的（CopyAsRichText、FindSelectionInPath、GotoSuperMethod、GotoRelated、
  GotoTest、$SearchWeb、Git 的 Stage 组）一律**不渲染假控件**，登记在 `docs/class-parity-todo.md`。
- 点击执行复用 `runAction`：那条链上已有"不可用要说清楚"与"执行前记一步宏"
  （IDEA 的 `AnActionListener.beforeActionPerformed`），右键菜单不该另开一条。
- 浮层 `Teleport` 到 body：`.code-editor` 是 `overflow: hidden`，弹在里面会被裁掉。
- 顺带补上 P.3 里那条"只挂弹出组的动作"：`Gradle.ImportExternalProject` 现在在项目树右键**和**
  编辑器右键两处都出现（上游就是这两个挂载点），可见性判据仍是同一条 `isVisible`。

判据：`tests/editor-popup-menu.test.mjs` —— 其中"每个引用 id 都必须在各菜单里存在"这条是关键：
`editorPopupRows` 对解析不到的 id 是静默丢弃，动作一旦改名，右键菜单会少一行而其它断言全绿。

### Q.2 工具窗口齿轮（`ToolWindowImpl.kt:801-891`）

齿轮内容逐项核对后，本仓**当时**只接得住两条（其余逐条写进 `docs/class-parity-todo.md §14`：
SpeedSearch、View Mode 组、RemoveStripeButton、Help）：
`ToggleContentUiTypeAction`（=「合并标签页」）与 `ResizeActionGroup`（四个拉伸方向，自带子项）。
两条都按 id 引用主菜单里已有的行，`ToolWindowHeader.vue` 只负责渲染与回抛；
组行成员在 `.tool-menu` 里摊平缩进（`.tool-menu-item.is-child`），因为那层不再开第二个浮层。
`tests/tool-window-header-move.test.mjs` 顺带覆盖"一条都没有 ⇒ 整段连分隔线都不出现"。

> **本节已过期**：`CloseAllAction` 那一条后来接上了，齿轮也从"嵌在头部的一列"改成真正的浮层菜单
> （`src/components/ToolWindowGear.vue`）。改动与判据见 §W.1。

## R. 2026-09-29 第十三批：标签条「显示一行」开关与多行（wrap）布局

上一批把单行布局接上了线，这一批补它的另一条分支 —— 而且先弄清了一件事：
**换行不是"放不下才换"，是设置决定的。**

- 决策点：`JBTabsImpl.createRowLayout`（platform-api/.../tabs/impl/JBTabsImpl.kt:766-773）
  `tabListOptions.singleRow ? ScrollableSingleRowLayout : WrapMultiRowLayout`；
  编辑器侧由 `EditorTabbedContainer.kt:582-584` 把 `singleRow` 绑到
  `UISettings.scrollTabLayoutInEditor`（`UISettingsState.kt:123` 默认 **true**）。
- 设置页文案：`checkbox.editor.tabs.in.single.row=Show tabs in one row`
  （ApplicationBundle.properties:316，绑定点 `EditorTabsOptionsModel.kt:39-40`）⇒ 本仓「标签显示在一行」。
- 多行与单行的三点本质差别，逐条照 `multiRow/WrapMultiRowLayout.kt` + `SimpleTabsRow.kt` + `TabsRow.kt`：
  ① 标签**永远按自然宽度画**，不裁切；② **没有「…」也不能滚动**（`isWithScrollBar()=false`、
  `getScrollOffset()=0`、`scroll()` 空实现）；③ 只有**第一行**为左右两侧的工具条让位
  （`firstRowWidth = rightmostX - leftmostX`，其余行是整块宽；`withTitle/withEntryPointToolbar` 只在 `isFirst`）。
- 装箱循环连源码里那个"`curLen = 0` 之后仍统一 `curLen += len + tabHGap`"的细节一起搬，
  并把"单个标签比整行还宽 ⇒ 独占一行照原宽画（不裁）"保留成用例。
  唯一刻意不一致：上游在换行时可能先加进一个**空行**（`createRow(空 curRowInfos)`），本仓不会 ——
  空行没有可画内容，只会把条撑高一行。

渲染侧：多行时标签**绝对定位**到 `(row × 行高, 行内 x)`，条高 = `rowCount × 行高`（CSS 侧
`.tabs-wrapped`）。这样容器高度由布局给，不是由内容撑 —— 内容撑高会让 ResizeObserver 与布局互相喂。
行高只有**一个**来源：`TAB_STRIP_ROW_HEIGHT` 与 `--tab-strip-row` 必须相等，`tests/tab-strip-wrap.test.mjs` 机检这一对。

新设置键 `tabsInOneRow` 四处一起登记（缺键补默认的机制也进了判据）：
`src/settingsModel.ts` 默认值 + 接口、`src/bridge.ts` 白名单、`native/settings_schema.cpp` 默认值、
`native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS`（不在表里会被 `prune_unknown` 静默删键）。

## S. 2026-09-29 第十四批：浮层不许"关掉又立刻弹开"（`PopupState`）

现象形状：编辑器右键/标签条「…」这类浮层，"点外面关闭"挂在 `pointerdown` 的捕获阶段，
打开挂在同一个位置自己的 `click` 上 —— 一次点击的顺序是 pointerdown → click，
所以**关着的时候再点那个按钮**会被同一次点击先关后开，看起来像按钮失灵。

上游正是为这件事准备的 `com.intellij.ui.popup.PopupState`
（类注释 `PopupState.java:23-26`："prevent opening a popup… right after its closing"），
判据在 `isRecentlyHidden()`（`:56-61`）：阈值取注册表 `ide.popup.hide.show.threshold`（代码默认 **200ms**），
并且**读一次就复位**（`hiddenLongEnough = true` 写在 getter 里）—— 每道闸门只吞一次，
不会把"关掉后隔一会儿再点"也一起挡掉。

本仓对应物：`src/popupState.ts`（阈值与可注入时钟 ⇒ 能机检），接在 `menuUi.openEditorPopup` 上；
关闭只在"确实开着"时记一笔，否则 Esc / 切标签关掉一个本来就空着的浮层也会把下一次点击吞掉。
（第十六批把标签条的「…」浮层换成了滚动，那道闸门随之删掉 —— 判据里现在反向检查
`tabStripView.ts` **不该**再有 `createPopupGate`/`tabMore`。）
判据：`tests/popup-state.test.mjs`（含"只吞一次"与接线的反向检查）。

## T. 2026-09-29 第十五批：点关闭后"未响应"——收尾链上唯一的无界 join

现象（桃的截图）：标题栏「TaoCode (未响应)」+ Windows 的"应用程序没有响应，你想结束这个进程吗"。
日志侧的硬证据：`01:01`、`01:10`、`08:48` 三次会话都**只有启动行，没有"退出 TaoCode"** ——
收尾链没跑完，且当时看不出卡在哪一步。

根因形状（代码事实，不是猜）：`WM_CLOSE` 在 UI 线程上依次 join 八条线程/子进程，其中
`taocode::lsp::Worker::stop()` 是**裸 `thread_.join()`**，而它的名下任务可能堵在一次
`Host::write_frame` 的**阻塞式 `WriteFile`**（`native/lsp_host.cpp:110`，无超时）——
服务器正忙（AE2 这种工程 jdt.ls 要导几分钟 Gradle）不读 stdin，管道满，写就挂住；
写挂住 → 线程不退 → join 不返回 → 界面"未响应"。

对照本仓自己已有的正确形状：`native/watcher.cpp` 的 `stop()` 是
"置停止标志 → `CancelIoEx` → join（锁外）"。语言服务线程没跟上这个形状。

修法（两条，都不改"语言服务独占一条线程"的骨架）：
1. `Worker::stop()` 改成**有界排干 + 取消**：先等 `kDrainWaitMs=2000ms`；没退就
   `CancelSynchronousIo(线程句柄)`（`loop()` 启动时 `DuplicateHandle` 一份自己，
   `std::thread` 拿不到 HANDLE），让那次 WriteFile 以 `ERROR_OPERATION_ABORTED` 返回，再 join。
   剩下的等待全部本身有界（请求超时、`Host::stop` 的 2s 进程回收）。
2. 收尾链改成 `App::close_children()` 里的**命名步骤表**，每步走
   `diagnostics::run_step`：**先写「关闭 · X」再执行**，回来补一条「用时 Nms」（≥500ms 记 WARN）。
   这条顺序是重点 —— 上次所有诊断都写在动作之后，卡住的那一步恰好什么都不留。
   下次再卡，日志里就是一条没有配对的「关闭 · X」。

判据：
- `native/lsp_worker_test.cpp` 新增用例：任务堵在**没人读的管道写**上时，`stop()` 仍必须有界返回，
  而且让它返回的必须是取消（断言 `WriteFile` 以 `ERROR_OPERATION_ABORTED` 回来），不是"碰巧写完了"。
- `tests/lsp-thread.test.mjs`：`CancelSynchronousIo` + `wait_for(kDrainWaitMs)` 在位；
  八个 stop 一个都不能漏；`run_step` 里"关闭 · "必须出现在 `body()` **之前**（附倒序反例）。

## U. 2026-09-29 第十六批：标签条改成"能滚"，Gradle 同步改成"看得见在跑"

桃的两句原话：「顶部文件打开栏不应该是 `...`，应该改为可滚动」+「gradle 始终在解析解析不出来」。

### U.1 标签条溢出：`…` 换成滚动（同一份上游布局的另一半）

`ScrollableSingleRowLayout` 处理溢出本来就有两半，之前只接了前半：
- **裁切 + 「…」**：`layoutMoreButton`（:114-118）+ `applyTabLayout`（:120-141）+
  `JBTabsImpl.showMorePopup()`（JBTabsImpl.kt:1089-1098，内容 = `filter { isTabHidden(it) }`）。
- **滚动**：`scroll(units)`（:38-42）+ `clampScrollOffsetToBounds`（:49-66）+
  `doScrollToSelectedTab`（:68-103，在 `recomputeToLayout` :105-111 里每次布局都跑一次），
  输入来自 `JBTabsImpl` 的滚轮监听（:570-577：水平标签补 `SHIFT_DOWN_MASK` 后转给那条**隐藏的**
  滚动条 —— 编辑器标签的 `isWithScrollBar` 是 false，:24-26 与 :703-705，所以上游也不画滚动条）。

本仓改法：`moreButtonWidth` 传 0（上游同一件事：`getMoreRectAxisSize()` 在 New UI 侧边标签就是 0，
:167-172），标签一律画到右边缘；溢出量 `maxScrollOffset` 早就算得出来，现在真的被消费 ——
`onTabStripWheel`（竖向 delta 优先，触控板给 deltaX 时用它）→ `scrollTabStrip` → 重算 →
第一条标签的 `margin-left: -scrollOffset`（= `SingleRowLayout.java:112` 的
`getStartPosition(data) - getScrollOffset()`）。切标签会把选中项滚进可视区；鼠标在标签条上时
跳过这一步（:69-71 的 `isMouseInsideTabsArea()` 守卫），否则用户自己滚会被布局抢回去。
`TabMoreMenu.vue`、`hiddenTabsFor`、`openTabMore/closeTabMore` 与那道 `createPopupGate`
一起删（没有浮层就没有"关掉又立刻弹开"要防）。原生 `overflow-x: auto` 仍被
`.editor-tabs { overflow: hidden; }` 关掉：滚动只有一套偏移，JS 的。

判据：`tests/tab-strip-layout.test.mjs` 新增三条（滚到尽头每条都回到条里 / `scrollUnitsToShowTab`
的左右两支与"比窗口还宽"的 else 支 / 间距按 `getRequiredLength` 计入），
`tests/tab-strip-wiring.test.mjs` 里原来到「…」的四条改成到"滚动 + 不预留 + 反向检查模板里不许再出现 tab-more"。

### U.2 Gradle：不是解析不出来，是**跑失败了而面板不显示**（有 daemon 日志原文）

硬证据（不是推测）：`C:\Users\Administrator\.gradle\daemon\9.3.1\daemon-30780.out.log`
记的是桃那一次同步（`currentDir=E:\Applied Energistics 2 Acceleration\AE2VMAddon-1.7.10-gtnh`）：

```
10:14:25 [INFO] StartBuildOrRespondWithBusy ... daemon is about to start building
FAILURE: Build failed with an exception.
* Where:  Build file '…\build.gradle.kts' line: 1
* What went wrong:
An exception occurred applying plugin request [id: 'com.gtnewhorizons.gtnhconvention']
> Failed to apply plugin 'com.gtnewhorizons.gtnhconvention'.
   > A problem occurred evaluating script.
      > Failed to load the manifest from Github
BUILD FAILED in 1m 15s
10:15:38 [DEBUG] ExecuteBuild] The daemon has finished executing the build.
```
而 `TaoCode` 的日志（`%LOCALAPPDATA%\TaoCode\log\taocode.log`）里收尾链从 `10:15:35` 开始、
`10:15:39` 退出 —— **桃是在第 75 秒、也就是 Gradle 结束前 3 秒关的软件**，他从头到尾没看到失败。

面板看不见的三个原因，逐个修：
1. `gradleFailure()` 原来只取 `FAILURE:` 那一行 ⇒ 面板上是"Build failed with an exception."，
   等于没说什么。现在取 `* What went wrong:` 段：表面原因 + 因果链最里层
   （"An exception occurred applying plugin request … — Failed to load the manifest from Github"），
   并且**不**把 `* Try:` 的建议与 `BUILD FAILED in …` 的统计卷进来。
2. 跑的时候只有一句"正在跑：<命令>"。现在加了**已用秒数**（每秒一跳）和**输出尾部**（`gradleOutputTail`，
   默认展开、可折），跑完失败时尾部仍在 —— IDEA 的对应物是 Build 窗口的外部系统输出。
3. 节点空态在骗人：同步在跑时写"还没有同步过；点「同步」"，依赖区在跑**同步**时写"正在解析依赖…"。
   现在跟着状态改文案（依赖那一句按 `gradleSync.command` 到底是哪条命令来说）。

另外收尾链补了第九步 `Gradle 同步 → gradle_sync->cancel()`：这次 daemon 日志是**关窗之后**才写完的，
说明子进程树原先不归任何一步管（只在 `~App` 被 Job Object 端掉，日志上看不出来）。

### U.3 这次同步为什么失败（环境事实，不是 TaoCode 的缺陷）

- 拉 manifest 的是 GTNH 的约定插件：`elytra-conventions-1.2.1.jar` 里
  `ManifestUtils` 写死 `https://raw.githubusercontent.com/GTNewHorizons/DreamAssemblerXXL/refs/heads/master/releases/manifests/%s.json`，
  用的是 `java.net.http.HttpClient`（不吃系统代理）。
- 本机实测：`raw.githubusercontent.com` 直连**超时**（curl 10s/12s 两次 `http=000`，DNS 正常解析到
  185.199.108-111.133）；`api.github.com` 直连 200；走系统代理 `127.0.0.1:7890` 时
  `raw.githubusercontent.com` 1.9s 就通了（404 也说明连接成立）。
- 所以这是**桃的网络/代理**问题：IDEA 自己跑同一条 `projects tasks --all` 会拿同样的失败。
  代理按 Gradle 官方口径写在 `gradle.properties` 里（`C:\Users\Administrator\.gradle\gradle.properties` 目前只有
  `org.gradle.jvmargs=-Xmx4G -XX:MaxMetaspaceSize=1G`，没有 `systemProp.*` 两行）——
  这一改**动了他的构建配置，没有代改**；要动的话给他逐条命令，由他决定。

## V. 2026-09-29 第十七批：LSP 与 Gradle 的进度都要在右下角看得见

桃的原话：「给 LSP 和 gradle 解析都在右下角消息窗口加入进度表示，对照 IDEA 消息窗口」。

### V.1 语言服务：`$/progress` 整条被丢掉，界面上只有一句"语言服务未就绪"

上游的形状（本机树逐行核对）：

| 环节 | 位置 |
| :-- | :-- |
| 客户端能力 | `platform/lsp/src/api/LspClientCapabilities.kt:245-249`：`window = WindowClientCapabilities().apply { showMessage; showDocument; workDoneProgress = true }` |
| 服务器申请 token | `LspServerNotificationsHandlerImpl.kt:255` `createProgress` 只回 `completedFuture(null)`（同意，不做别的） |
| 进度通知 | 同文件 `:257-328`：`begin` → `ProgressTask(text = title, details = message, fraction = percentage/100)` 并起一条后台任务，任务名 `LspBundle.properties:32` `progress.title.progress={0}: progress`；`report` **只覆盖发出来的那两个字段**（`?:` 语义，:315-322）；`end` → 删掉整条（:323-326） |
| 显示位置 | 状态栏的后台任务弹窗：`ProcessPopup.java:331` 遍历的行里就是 `JProgressBar` —— 进度是**画在那一行上**的 |

本仓之前的两处断链：`initialize` 的 capabilities 里**连 `window` 段都没有**（服务器有权根本不发进度），
`native/lsp.cpp` 的通知分支 `if (method != "textDocument/publishDiagnostics") return;` 把它连同
`window/showMessage` 一起丢掉。于是 jdt.ls 那句"Importing projects / Building workspace index"
从来没有变成任何可见的东西。

补上：`Client::on_progress` + `Host::set_progress` + `Session::set_progress_sink`
（整形在 `native/lsp_host_bootstrap.cpp`，与 diagnostics 同一条"读线程上只整形、不碰 `Session::mutex_`、不抛"的纪律），
`main.cpp` 挂一行把它接到既有的 `lsp` 事件通道 ⇒ 前端 `bridge` 多一个 `lsp.progress` 分支，
纯逻辑（解析、三支合并、百分比夹进 0-100、`{0}：进度` 兜底、按 begin 先后排序）在 `src/lspProgress.ts`。
面板那一行由 `progressPanel.ts` 列出：**有百分比才画条**，`cancellable` 由服务器声明了也不给取消按钮 ——
本仓还没有把 `window/workDoneProgress/cancel` 发回去的那条通道（登记在 class-parity-todo §15，不给假控件）。

### V.2 Gradle：CLI 通道没有 progress/total，所以那一行给的是"已用时间 + 最新一行输出"

`ExternalSystemTaskProgressIndicatorUpdater.kt` 的判据是 `if (total <= 0) indicator.setIndeterminate(true)`，
有总数才 `setFraction(progress/total)` 并把文字拼成 `description (progress / total)`。我们跑的是
`gradlew` 命令行，拿不到 Tooling API 那两个数 ⇒ **百分比如实留空**（不确定式），行上给
`elapsedLabel(startedAt)` 与 `gradleOutputTail(output, 1)`。为此 `gradleSync` 多了 `startedAt`
（`at` 在结束那一拍会被重打，两个含义不能挤在一个字段里）。

### V.3 右下角的消息窗口：进度行是"同一对象被刷新"，不是每拍重发

`src/notices.ts` 加 `upsertNotice`：命中同一个 `displayId` 就**原位替换**内容并保留 id 与首次时间，
否则退回 `pushNotice` 的 `expirePreviousAndNotify`。这两条规则分开是有意的 —— 上游那条"先顶替再前插"
是给同一件事的第二次通知用的（提交结果），一条正在推进的进度若走它，列表每 100ms 重排一次。
Gradle 那一行（`gradle:sync`）由 `gradleHost` 负责：命令一起来就有一行、输出每批刷一次、
结束时原地收成 `Gradle 同步完成（用时 N 秒）` / `Gradle 同步失败：<原因>`；
语言服务那些行由 `notifications.ts` 挂 `wireLspProgressNotices`（一个 displayId 只有一个主人）。
`NoticeEntry` 的进度分三态：缺省 = 普通通知、`null` = 进行中、数字 = 百分比。

判据：
- `native/lsp_test.cpp` 新用例：`$/progress` 交给 progress 回调、**不叫醒**诊断回调，
  未知通知两个都不叫醒（反证：把通知统统塞给一个回调的写法会响）。
- `native/lsp_host_test.cpp`：让 `lsp_fake_server` 在 didOpen 后真发三拍 begin/report/end，
  断言三拍都到 Host 回调、`percentage` 在路上没丢。
- `tests/lsp-progress.test.mjs`（6 条）、`tests/progress-notices.test.mjs`（5 条）、
  `tests/notices.test.mjs`（+3 条 upsert/三态）、`tests/gradle.test.mjs`（面板那一行的新形状）。

### V.4 同日的两条补完（桃接着要求"取消与停机也要照 IDEA"）

`ProgressCancel` 从四个字符串变成"字符串或 `{ lsp: { language, token } }`"：token 是服务器给的，
只能跟着那一行走（上游也是每行带自己的取消回调）。回程是 `lsp.cancelProgress` →
`Session::cancel_progress`（新文件 `native/lsp_session_progress.cpp`，`lsp_session.cpp` 已经贴死在 1075 行）。
`shutdown_all()` 里在 `host->stop()` **之前**先 `announce_progress_reset()`：
不这么做的话界面会永远等一个不会再来的 `end`。

## W. 2026-09-29 第十八批：齿轮补上 Close All、通知自带按钮，顺手给"引用行号"加门控

### W.1 工具窗口齿轮：`Close All` 那一条，以及"底部 dock 也有一个齿轮"

上游 `ToolWindowImpl.kt:857-891` 的 `GearActionGroup` 里 `TabbedContentAction.CloseAllAction` 排在
SpeedSearch 之后、ToggleToolbar 组之前（`:872`）。它的可见性判据不是"有没有标签"，而是
`TabbedContentAction.java:144-150`：

```java
boolean notForTheOnlyContent = myManager.getContentCount() > 1 || !(component instanceof ContentTabLabel);
presentation.setEnabledAndVisible(notForTheOnlyContent && myManager.canCloseAllContents());
```

`setEnabledAndVisible(...)` ⇒ 不适用时**整行不见**；同组的 `ToggleContentUiTypeAction` 用的是
`setEnabled(...)`（`ToggleContentUiTypeAction.java:19-21`）⇒ 灰着但留在原位。两种写法不能糊成一种，
所以 `ToolWindowGearEntry` 多了一个 `hideWhenDisabled`。`canCloseAllContents()`
（`ContentManagerImpl.java:472-481`）还要先过 `canCloseContents()` 且**至少有一条 closeable** ——
本仓对应的谓词是 `src/toolWindowActions.ts` 的 `closeAllTabsTarget()`。

另一件事是**入口**：IDEA 给侧栏标题栏和底部 dock 的齿轮是同一份内容，本仓以前只有侧栏那个头有齿轮，
于是「关闭所有标签页 / 标签形态」这两条只剩主菜单一条路。现在抽出
`src/components/ToolWindowGear.vue`（齿轮 + 那份弹出菜单）两处共用；弹层 `Teleport` 到 body、
fixed 定位往上长，理由与 `ToolWindowAnchorMenu.vue` 同一条：`.output-panel` 是 `overflow: hidden`。
`contentsScoped` 这个标记是给侧栏用的 —— 侧栏那个齿轮管不到底部 dock 的内容，
给它一行"点了会去清空底部那排标签"的动作就是骗人。

判据：`tests/tool-window-gear.test.mjs`（引用表顺序、两种可见性写法、SSR 真渲出按钮）。

### W.2 通知自带按钮：Gradle 失败不再是"看完还得自己去工具条上点一下"

Gradle 那个通知组本来就是 `displayType="STICKY_BALLOON"`
（`plugins/gradle/plugin-resources/intellij.gradle.xml:309`，组名 = `GradleBundle.properties:320`
`notification.group.gradle=Gradle`），上游也真把动作挂在通知上
（`GradleBundle.properties:343-345`：Migrate / Ignore / Learn more）。这一族的规矩写在
`Notification.java:52`：**别在 HTML 内容里放链接，用 `addAction` 与
`NotificationAction.createSimpleExpiring`**。

于是 `NoticeEntry` 多一个 `actions?: NoticeAction[]`，`notify(...)` 末尾带上，三处渲染点共用
（状态栏弹层、通知工具窗口、气球）。点击次序照 `LspServerNotificationsHandlerImpl.kt:443-454`：
动作回调里**先 `notification.expire()` 再做事**。以前气球只把气球藏起来、列表里那一条还留着，
与列表行上那排按钮点出来的结果不一样 —— 现在气球走 `runBalloonAction`，认的是**它自己那一条**的 id
（`noticeEntryId`），所以点列表里的旧那条不会误伤最新的、点气球也不会留下一条没人收的通知。
Gradle 侧发的是 `gradleHost.ts` 的 `notifyFailure(...)`：重新同步 / 打开构建脚本 / 构建工具设置。
**没有**「了解更多」那类按钮：本仓没有本地文档，凭空造的链接比没有按钮更糟 —— 上游那条 Learn more
之所以合法，是因为它下一行就写着真 url（`GradleBundle.properties:346`）。

判据：`tests/notice-actions.test.mjs`（6 条；其中"点气球动作要把那条通知 expire 掉"与"点旧那条不动
最新那条"是反证式，另有一条专门拦"不许出现凭空造的 URL"）。

### W.3 给"引用本身"加门控（这一批人肉抄错过，就不该只靠人肉）

写 W.1/W.2 时手抄错三处行号（`TabbedContentAction.java:146-151` → `:144-150`、
`LspServerNotificationsHandlerImpl.kt:440-450` → `:443-454`）与一处文件名
（`intellij.lang.impl.xml` 实际叫 `intellij.platform.lang.impl.xml`）。这类错不会让任何断言变红，
但后来人按图索骥会扑空，所以 `tests/source-citations.test.mjs` 把它变成机器可查：
扫 `src/ native/ docs/`，凡 `<平台目录>/…/<文件>:N[-M]` 的写法，参考树在时**必须**存在该文件且
行号不越界；带 `...` 的省略写法不核（省了就没法核）。参考树不在本仓，那一条按 `existsSync` 跳过
（与 `tests/tool-tabs.test.mjs` 里查键位那半段同样处理）。
门控自己带反证：喂两条假引用（一条不存在、一条越界）必须两条都响；
`items.length >= 150` 兜住"正则坏了 ⇒ 门控空转还是绿的"。

## X. 2026-09-29 第十九批：同一个工具窗口挂**多条内容**（`ContentManager.addContent` 那一半）

### X.1 以前只有"一条"，所以"再查一次"只能把上一批冲掉

「引用」原来是 `const references = ref<LspLocation[]>([])`：一个数组，一次搜索覆盖上一次。IDEA 不是这样 ——
Find 窗口的内容管理器里**每次搜索是一条 `Content`**，标签条上就是一行（`addContent` 那一半，
`platform/lang-impl/src/com/intellij/usageView/impl/UsageViewContentManagerImpl.java:149-192`）。
这一批把那半个管理器补上，纯逻辑在 `src/toolContents.ts`（列表语义）+ `src/referenceContents.ts`（宿主），
逐条照源码：

- `doAddContent`（`platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:198-243`）：
  同一条对象再 add = **挪位置**不是复制（`:209-213`）；插入位置 `index < 0 ? size : index`（`:228`）。
- `toOpenInNewTab |= 选中的那条被钉住`（`:158`）；不开新标签且这条可复用（`:156` 的 `REUSABLE_CONTENT_KEY`）时，
  从尾到头找一条"没钉住 + 可复用 + 没在搜索中"的当被顶替者（`:169-177`，选中的那条被 append 到候选末尾，
  是"最后也是最好"的删除对象）；**先 add 到被顶替者的下标、再删它**（`:185-188`），标签位置才不跳。
- 标签文字 = `tabName`（`platform/platform-impl/src/com/intellij/ui/content/impl/ContentImpl.java:135-137`
  `myTabName == null ? myDisplayName : myTabName`）；本仓的 tabName 照
  `createPresentation`（`platform/lang-impl/src/com/intellij/find/findUsages/FindUsagesManager.java:551-565`）：
  `{0} of {1}`（短名，`FindBundle.properties:32`，`{0}` = `Usages`，`AnalysisBundle.properties:13`），
  面板标题 = `{0} in {1}`（`:31`，长名 + 范围；本仓范围恒为
  `psi.search.scope.project` = `Project Files`，`CoreBundle.properties:24`）。
- 钉住是 `PinActiveTabAction`（`platform/platform-impl/src/com/intellij/ide/actions/PinActiveTabAction.java:52-70`），
  动作本身**取反**；它挂在 `PlatformActions.xml:657` 的 ActiveToolwindowGroup 里（`PinToolwindowTab`，
  `intellij.platform.ide.impl.actions.xml:455`）。
- "内容关光就把窗口收起来"是那个窗口注册时设的 `setToHideOnEmptyContent(true)`
  （`UsageViewContentManagerImpl.java:57`）—— 本仓对应"最后一格关掉就跳回输出"。
- `find.open.in.new.tab.action`（`FindBundle.properties:23`）在 IDEA 里是 Find 齿轮上的勾选项
  （`UsageViewContentManagerImpl.java:59-74` 造、`:114-116` 挂），状态存在 `FindUsagesSettings.showResultsInSeparateView`；
  本仓是可持久化开关（`taocode.referencesInNewTab`，**只认 'true'，缺键/坏值一律按默认 false**）。

界面：标签条那一格改成 `v-for="tab in referenceTabs"`（标签 + 钉住 + 关闭，后两个悬停才露），
组合框形式（`ContentComboLabel`）按**每条 content 一行**列出，`window.pinToolwindowTab` 与
`window.referencesInNewTab` 进 Window 菜单的 ActiveToolwindowGroup（就在 `TW.CloseAllTabs` 前后，
与 `PlatformActions.xml:657-666` 的顺序一致）。

判据：`tests/tool-contents.test.mjs`（10 条：顶替/钉住/搜索中不顶替/不可复用/位置与谓词按条目/取反）、
`tests/reference-contents.test.mjs`（11 条）、`tests/workbench-dock-render.test.mjs` 新增 SSR 用例
（**真渲染**两条 content 的标签条，数出 2 个关闭按钮 + 2 个钉住按钮，还在搜的那条显示"正在查找…"）。
`tests/tool-window-content-ui.test.mjs` 里那条"combo 与标签条同名"改判据为"combo 把引用列成内容条目、
标签条显示 `tab.label`"，不是把断言放松。

### X.2 顺手修掉的两处重复与一处越位

- `appearanceActions.ts:271` 与 `lspNavigation.ts:342` **各有一个** `watch(activePath)` 在清引用并跳走 ——
  同一件事写两遍，而且按 IDEA 的模型它本来就**不该发生**（内容归管理器，换编辑器标签与它无关）。
  两处都拆掉，只留 `refreshOutline(path)`。
- 引用搜索的标题需要符号名：`wordAt(tab.content, line, character)`（`src/editorText.ts`）就是上游
  `UsageViewUtil.getShortName` 的等价物；长名用 `<相对路径>#<短名>`（本仓没有限定名解析器，如实这么拼）。

## Y. 2026-09-29 第二十批：速度搜索（`SpeedSearch`）—— 齿轮组里第一条真接上的"未接项"

§14 把 `SpeedSearchAction` 记成"未接"，理由是"没有可聚焦的列表宿主"。这一批发现**有**：项目树
（`leftView === 'files'`）从来没有过滤能力，而 IDEA 的项目视图正是它的宿主
（`platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPaneWithAsyncSupport.java:177`
装 `TreeSpeedSearch`）。

上游三块，缺一不可：

- **动作与可见性**：`SpeedSearchAction.kt:29-37` —— `isVisible = 有 handler`、`isEnabled = 有 handler &&
  可用 && 未激活`。所以"没有可搜的列表时这一行根本不出现"是源码语义，本仓照此实现
  （宿主给不出行 ⇒ 齿轮里没有它）。
- **键位**：`use-shortcut-of="Find"`（`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:157-160`）
  ⇒ 与 Find 同一个 **Ctrl+F**；两者都可能触发时由 `SpeedSearchActionPromoter.kt:9-11`
  （`sortedBy { it is SpeedSearchAction }`）把速度搜索排前面 —— 也就是**焦点在列表上时 Ctrl+F 归它**，
  在编辑器里才归 Find。本仓的 Ctrl+F 原本**没有绑定**，正好由列表自己接（`@keydown.ctrl.f` 绑在
  `.project-view` 上，冒泡范围内才生效）。
- **匹配**：`MinusculeMatcher`（`platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcherImpl.kt`）
  的驼峰子序列 —— 大小写不敏感，但**大写字母必须落在词首**（`:303-305`），
  `SpeedSearchComparator` 默认 `shouldMatchFromTheBeginning = false`
  （`platform/platform-impl/src/com/intellij/ui/SpeedSearchComparator.java:30-32`、`:59-61`）
  ⇒ "从中间开始匹配"是默认行为。空 pattern 不跳走（焦点还在输入框里）。
- **键盘归属**：`SpeedSearchBase.java:958-1002` —— Enter/PageUp/PageDown/左右键把搜索框收起、焦点交回列表；
  Esc 只隐藏搜索框；空串上的退格**吞掉**（不让焦点弹回列表）；上下键/Home/End 在**命中项之间**移动
  （`:683-706` 的 `findTargetElement`）。命中后是**选中那一行**，不是隐藏不匹配行
  （`:679` `selectElement(findElement(query))`），`TreeSpeedSearch.selectElement` 还会展开折叠的祖先
  （`platform/platform-impl/src/com/intellij/ui/TreeSpeedSearch.java:204-208`）—— 本仓的等价物是
  模型里已有的 `reveal(path)`。

实现：纯逻辑在 `src/speedSearch.ts`（匹配/定位/按键归属，10 条单测），搜索框单独成
`src/components/SpeedSearchBar.vue`（**能真渲染出来核**，包括上游那个空提示
`editorsearch.search.hint` = `Search`，`ApplicationBundle.properties:661`），
接线在 `src/components/FileTree.vue`（Ctrl+F 开、输入即选、上下键走、Enter/Esc 收），
齿轮那一行由 `src/speedSearchHost.ts` 供（`ToolWindowGearEntry.fromHost` —— 它不在菜单索引里，
上游 `PlatformActions.xml:146` 也只是**顶层引用**，所以本仓**没有**给它编一个菜单位置；
一开始我把它错放进 Window 菜单，核对 group 归属后撤回）。

判据：`tests/speed-search.test.mjs`（10 条）+ `tests/speed-search-wiring.test.mjs`（7 条，含
"关着不出现、开着有输入框与空提示"的真渲染，以及"点齿轮那一行真的会开搜索框"——
行在却不干活就是假控件）。`tests/tool-window-gear.test.mjs` 的"三条"改成"四条 + 第一条来自宿主"，
是按新事实改判据，不是把断言放松。

## Z. 2026-09-29 第二十一批：`RemoveStripeButtonAction`（把按钮从侧栏移除，并且能恢复）

§14 把这一条记成"未接"，理由是"侧条按钮是固定的一组，没有'从侧栏移除'的持久化模型"。
这一批把那个模型补上 —— 上游的语义其实很明确：

- 可见性：`ToolWindowImpl.kt:914-925` 的 `update` 里 `isEnabledAndVisible = isShowStripeButton`
  （按钮已经不在侧条上时这一行整条不见，不是灰着）。
- 执行：`hideToolWindow(id, removeFromStripe = true)`（`:923-925`）⇒
  `ToolWindowManagerImpl.kt:849-853` 把 `info.isShowStripeButton = false` 并 `entry.removeStripeButton()`。
- **移除 ≠ 隐藏**（最容易做错的一处）：隐藏只收面板，按钮留在侧条上（本仓那是 `explorer` / `chromeHidden`
  那条路）；移除是把按钮摘掉。所以判据盯的是"`stripeOrder` 里没有它了"，不是"面板收起了"。
- 恢复：`showToolWindowImpl` 里 `toBeShownInfo.isShowStripeButton = true`
  （`ToolWindowManagerImpl.kt:942`）—— 也就是**再激活一次就把按钮放回侧条**；否则这里会变成不归路。
- 文案：`ActionsBundle.properties:1170-1171`（`Remove from Sidebar` / `Remove the tool window button
  from the sidebar`）。
- 位置：它在齿轮组的**最后**（`ToolWindowImpl.kt:889`），且不进任何主菜单（那个类是 private inner）——
  所以本仓同样只给它一个**宿主行**（`ToolWindowGearEntry.fromHost`，与上一批的 `SpeedSearch` 同一个入口）。

实现：`src/toolWindowStripes.ts` 加持久化集合 `hiddenStripeButtons` + `removeStripeButton` /
`restoreStripeButton`（`taocode.hiddenStripeButtons`，坏存档只认表里存在的 id，认不出的丢掉，
侧条不会因此变空）；`stripeOrder` 过滤它，停靠底部的窗口连带从底部 tab 条上消失
（`isShowStripeButton` 在上游也管着那两处：`ToolWindowsWidget.java:164`、`SwitcherRendering.kt:241`）；
宿主 `activateToolWindow` 里复原；两条宿主行合成一张表（`src/gearHostRows.ts`，由
`speedSearchHost.ts` 改名而来 —— 它现在装两条不在菜单索引里的行动作）。

判据：`tests/remove-stripe-button.test.mjs`（7 条：移除后侧条真的没有它、底部那排也跟着收、
再激活就回来、持久化、坏存档、文案与可见性、宿主接线）。

## AA. 2026-09-29 第二十二批：`additionalGearActions`（项目视图**自己**的齿轮组）

§14 的头一行"additionalGearActions（各窗口自己的）"记的是"没有按窗口的额外动作 ⇒ 无"。
这一批补的是它，落点是**项目视图**：上游 `ProjectViewImpl.java:1169`
（`toolWindow.setAdditionalGearActions(actionGroup)`）把一组只属于这个窗口的动作挂上去，
内容来自 `platform/projectView/shared/resources/intellij.platform.projectView.xml:43-60` 的
`ProjectView.ToolWindow.SecondaryActions`。本仓能真接住的是它第一个子组
`ProjectView.ToolWindow.Behavior.Actions`（`:44-55`）:

- `OpenInPreviewTab` 「Enable Preview Tab」→ 本仓的「用预览标签打开」。语义在
  `UISettingsState.kt:75` 的 `openInPreviewTabIfPossible`（键 `OPEN_IN_PREVIEW_TAB_IF_POSSIBLE`，默认 false）：
  从树里打开的文件进预览标签，关掉时是持久标签 —— 正是本仓 `openFile(path, false, { preview })` 的那个参数。
- `AutoscrollToSource` 「Open Files with Single Click」（`ActionsBundle.properties:1455`）→「单击打开文件」。
  与目录的 `OpenDirectoriesWithSingleClick` 是**两条**动作（后者本仓已有，即设置里的「单击展开节点」），
  别混成一条：目录行不受这一条影响。
- `AutoscrollFromSource` 「Always Select Opened File」（`:1453`）→「始终选择打开的文件」。
  上游挂在 `AutoScrollFromSourceHandler.java:80` 的 `selectInAlarm`（`editor != null && isShowing() &&
  isAutoScrollEnabled()`），本仓落在已有的 `watch(activePath)` 上（与 Alt+F1 的 Select In 同一条 reveal 路径）。
  关掉所有标签时**不动**树里的选中（路径为空不选）。
- `OpenDirectoriesWithSingleClick` 本仓已有，不重复添加。

三条都存在**项目视图设置**里（`src/projectTreeState.ts` 的 host，按项目 root 分档）：
读盘逐键判类型、缺键取上游默认（三条全 false）—— 旧存档缺这三键不会被判成损坏，
与项目其它设置的纪律一致。齿轮里这一组排在排序组之前（源码里它就是第一组），
顺序与文案都取自上面那两处坐标，没有自造的项。

判据：`tests/project-view-behavior.test.mjs`（7 条：单击/双击的分界、目录不受影响、
预览标记与 `openFile` 的对应、空路径不选中、默认值与缺键补默认、齿轮顺序与三条写回设置、四处接线）。

## AB. 2026-09-29 第二十三批：`TabsListener` 那两处**真实行为**（判决表已更正"通知而非否决"）

判决表原来把 `TabsListener.beforeSelectionChanged` 记成"否决"，B1 实现行里也写"That 待做：`beforeSelectionChange` 否决"。
这一批先把事实钉死，再把那条真行为接上：

- `beforeSelectionChanged` 返回 **void**，`JBTabsImpl.kt:1680-1691` 的 `fireBeforeSelectionChanged` 只遍历调用、
  **不看返回值** —— 它不是否决接口。回调期间唯一可见的副作用是 oldSelection 被临时露出来（`:1682`/`:1689`），
  `getOldSelection()`（`:1957`）在回调内可查。所以"否决"这条**本来就不存在**，不该照一个不存在的语义做控件。
- 真实消费者有两处，都是**行为**而不是接口：
  ① `EditorWindow.kt:210-219` 的 `selectionChanged` —— 新选中的文件若 `GeneralSettings.isSyncOnFrameActivation`
     就 `VfsUtil.markDirtyAndRefresh`，即**切编辑器标签时只重同步这一个新的文件**；
  ② `JBEditorTabsBorder.kt:34-60` 的下划线**滑动动画**（100ms，收缩侧延迟 50ms）。

本批落的是 ①：`src/diskSync.ts` 把单文件同步抽成 `syncOneTabFromDisk(tab, quiet)`（整批循环改走它，
两处共用同一道闸：有未保存改动的不动、超大文件跳过、版本一致不整篇换），新增
`syncTabOnActivation(path)` —— 开关用的就是同一个 `autoSyncFiles`，**只读切过去的那一个文件**；
触发点接在 `src/editorSplits.ts` 的 `switchTabIn`（切标签的唯一入口），并且
`tab.path !== previous` 时才发通知（重复点同一个标签不该再读一次盘）。
判定本身抽成两个导出的纯函数（`shouldSyncTabFromDisk` / `diskSupersedesBuffer`）以便单独核。

② **不做，理由登记**：下划线滑动动画属于"点击/切换的动画效果"，与本仓既有反馈纪律冲突
（不加点击动效、不追加全局元素选择器）。本仓的目标态反馈走状态文字与既有样式，
所以这里如实登记出处与差距，**不自加动效**充当对齐。

判据：`tests/tab-listener-behavior.test.mjs`（7 条：两条纯判定 + 三处接线 + 空路径/重复点击 + 动画那条的登记）。

## AC. 2026-09-29 第二十四批：编辑器标签**双击**的真语义（判决表那条「就地重命名」是误读）

核对的起因是 B1 待做项里写着「`TabLabel` 就地重命名」。查原文之后结论相反：

- `TabLabel.kt:151-153` 的 `mouseClicked` 只做 `handlePopup(e)`；`TabLabel.kt` 全文没有 rename，
  `JBTabsImpl.kt` 也没有，整个 `platform/platform-api/src/com/intellij/ui/tabs/` 包搜不到 rename 字样，
  也**没有任何文本域**（`JTextField`/`CellEditor` 一个都没有）。
- 判决表那句很可能来自 `EditorTabbedContainer.kt` 里那个 `clickCount == 2` 的监听器 —— 但那一条
  在**命中标签时先 return**（`:186-193`，只有点在标签之外的空白处才走），而且它做的是
  `doProcessDoubleClick`，内容是下面两条，跟重命名无关。

双击标签的真语义（`EditorTabbedContainer.kt:348-361`）：

1. **预览标签晋升常驻**：`composite.isPreview = false`（`:349-356`），这一步之后**直接 return**；
2. 否则按高级设置执行"最大化"：
   - `editor.maximize.on.double.click`（`intellij.platform.ide.impl.xml:1511`，默认 **true**）
     = Hide All Tool Windows / Restore Windows；
   - `editor.maximize.in.splits.on.double.click`（`:1512`，默认 false）= Maximize Editor / Normalize Splits；
   - 两个都关着就 `return`（`:358-361`）。

本仓落地：判定抽成 `src/editorTabDoubleClick.ts`（纯函数，按上游的先后与 return 语义），
`src/editorSplits.ts` 的 `onEditorTabDoubleClick(tab)` 执行（晋升走既有的 `keepTabOpen`，
隐藏/恢复走既有的 `toggleMaximizeEditor`），标签按钮绑 `@dblclick`；新设置键
`maximizeEditorOnTabDoubleClick` 默认 **true**（照上游），类型/默认值、原生 schema 布尔表与默认值、
bridge 白名单三处同步登记。第二条（in-splits）**不做**：本仓没有"编辑器内分屏最大化"这一档，
给一个点了没反应的开关正是硬规则禁止的形态，所以在设置注释与纯函数里都写明恒 false 的理由。

判据：`tests/editor-tab-double-click.test.mjs`（6 条：预览只晋升不继续、默认走隐藏、全关不做、
四处接线、设置键三处登记、判决表误读已更正）。判决表 `verdict-ui-tabs-popup.md` 与
`class-parity-todo.md` 的对应文字已按新结论改。

## AD. 2026-09-29 第二十五批：标签条右端的「更多」下拉（`ActionPanel` / `EditorTabsEntryPoint`）

B1 待做项里的「`ActionPanel` 多动作按钮」。上游两块，都读过原文：

- `ActionPanel.java`：标签右侧排**多个**动作按钮的容器。`update()`（`:118-146`）逐个跑 `AnAction.update`
  并 `myInplaceButton.setVisible(p.isEnabled() && p.isVisible())` —— **不可用或不显示的动作整个不画**；
  一条可见的都没有时 `getPreferredSize()` 返回 **0×0**（`:158-160`），连位置都不占。
  悬停语义在 `ActionButton.setAutoHide`/`toggleShowActions`（`ActionButton.java:174-189`）。
- `EditorTabbedContainer.kt:554-555`：每个编辑器标签挂 `DefaultActionGroup(editorActionGroup, closeTab)`；
  `:626-632` 里 `editorActionGroup = DefaultActionGroup(toolbarActions, source)`，其中
  `source` = `EditorTabsEntryPoint` —— 一个 `popup="true" icon="AllIcons.Actions.More"` 的**常驻下拉**
  （`platform/platform-impl/resources/idea/PlatformActions.xml:804-816`），成员与顺序：
  RecentFilesFallback · RecentLocations · GotoFile | CloseAllEditors · ReopenClosedTab |
  Unsplit · UnsplitAll · ChangeSplitOrientation | ConfigureEditorTabs。

本批落地的是那个常驻下拉（本仓此前只有标签**右键**菜单，没有常驻入口）：

- 规则抽成 `src/tabEntryPoint.ts`（`visibleEntryPointItems` = 上游"不可用就不出现"；
  `entryPointHasActions` = 上游的 0×0 语义，一条可见都没有时连按钮都不画）。
- 成员表在 `src/tabEntryPointMenu.ts`（`id` 用 IDEA 的动作 id，便于逐条对照）。**只放本仓真接得住的七条**；
  上游那组里的 `RecentFilesFallback` / `RecentLocations` / `GotoFile` 是**全局找回**动作、
  不属于"标签这一格"，本仓留在各自的键位与菜单里（Ctrl+E / Ctrl+Shift+E / Ctrl+Shift+N），
  在这里不重复挂一行 —— 登记在 `docs/class-parity-todo.md`。
- 界面 `src/components/TabEntryPoint.vue`：Teleport 到 body（标签条那层是 `overflow: hidden`），
  **外观不另立配方** —— 复用浮层族的 `.dropdown`（`--popup-*` 令牌），与其它菜单同一套规格
  （`tests/moon-palette.test.mjs` 那条"浮层族统一"门禁盯着这件事）。
- 装配落在 `src/explorerActions.ts`（那边已有 `closeAllTabsIn` / `closeUnpinnedTabsIn` / 右键菜单那一族），
  App.vue 只留一行组件与一行注入（那个文件的上限只降不升，装配不能留在组装层）。

判据：`tests/tab-entry-point.test.mjs`（7 条：不可用不画、全不可用不画按钮、成员表顺序与"不重复挂全局动作"、
每条的可用性跟着真实状态、**点每一行都真的干活**、组件的过滤与 Teleport、装配位置与 App.vue 的接法）。

## AE. 2026-09-29 第二十六批：浮层**尺寸/位置记忆**（判决表把它记错了类）

B1 待做项里的「`PopupState` 尺寸记忆」。核对原文后：

- `PopupState.java`（`platform/platform-api/src/com/intellij/ui/popup/PopupState.java`，192L）
  **只管"刚关掉又立刻弹开"的抑制**：`isRecentlyHidden()`（`:56-61`）配 registry
  `ide.popup.hide.show.threshold`（默认 200ms），全类**没有一个 size 字段**。
  本仓的对应物 `src/popupState.ts` 的 `createPopupGate` 早已落地（浮层"关掉又弹开"那条修复）。
  ⇒ 判决表把它记成"尺寸/位置记忆"是**误读**，已按原文订正。
- 尺寸/位置记忆的真出处是 `AbstractPopup`：`getStoredSize()`（`:3145-3148`）、
  `storeDimensionSize()`（`:2314-2318`）、`getStoredLocation()`/`storeLocation()`（`:3140-3143`/`:2320-2324`），
  key 由调用方给（`setDimensionServiceKey`，`:594-596`）；**是否连位置一起记**是 builder 的
  `setUseDimensionServiceForXYLocation`（`PopupChooserBuilder.java:284-287`、`:444`）。
  Search Everywhere 传的是 `true`（`SearchEverywhereManagerImpl.java:147`，key `"search.everywhere.popup"`，`:69`），
  读回来在 `:184`（`getSize`）与 `:292`（`getLocation`）——**第一次没有存档就用自己的首选尺寸**
  （`:184-188`）。

本批落地：`src/popupBounds.ts`（解析/序列化/夹回视口三条纯函数，坏存档一律当"没有存档"），
`SearchEverywhereDialog.vue` 用它记住浮层的**尺寸与位置**（`taocode.searchEverywhere.bounds`），
并把标题行做成拖动把手（上游 `setMovable(true)`）；记下的坐标贴回去前先夹回视口，
屏幕变小也不会把浮层甩到看不见的地方。这里**只做 Search Everywhere** —— 上游也是逐个弹层传 key，
没有 key 的弹层本来就不记；其余浮层等有真需求时各补一行，登记在 `class-parity-todo.md`。

判据：`tests/popup-bounds.test.mjs`（7 条：无存档=null、坏存档全当没存档、正常解析、
尺寸不超视口、位置夹回、序列化互逆、SE 弹窗接线与判决表订正）。

## AF. 2026-09-29 第二十七批：核对「助记符」与「行内动作」两条 —— **本仓都已有真实现**

B1 待做里挂着 `MnemonicsSearch`（助记符跳转）与 `PopupInlineActionsSupport`（列表行内动作）。
核对原文后，两条在本仓都**已经落地**，只是判决表还记着 `[ ]`：

### AF.1 助记符（`MnemonicsSearch.java`）

`src/selectIn.ts` 的 `selectInMnemonicHit` 逐条照 `MnemonicsSearch.java:34-46`：
只在 `KEY_TYPED`、只接受字母或数字、速度搜索框**已有字时让路**（`:37`）、命中即 `consume()`（`:44`），
助记符表大小写各登记一份（`:25-31`）。调用点在 `SelectInPopup.vue:37`，且排在**速度搜索之前** ——
与上游 `WizardPopup.java:489-490`（先 `myMnemonicsSearch.processKeyEvent(event)` 再 `processKeyEvent(event)`）
同一条顺序。判据 `tests/select-in.test.mjs` 已覆盖。

唯一真实差距：`ActionPopupStep.getMnemonicString`（`:197-205`）在动作**自带数字助记符**时走
`NumericMnemonicItem.getMnemonicChar` 那一支。本仓没有"动作带数字助记符"的模型，主菜单/右键菜单里
也没有 `_X` 标记（上游那支的真使用者只有两处：插件面板的齿轮下拉、`BasicOptionButtonUI` 的选项按钮，
且 `ActionPopupOptions.kt:14` 的 `honorActionMnemonics` **默认 false**）。所以这一支**不做**，
登记在 `class-parity-todo.md`，不放假实现。

### AF.2 行内动作（`PopupInlineActionsSupport*`）

上游语义：行内按钮只在新 UI 且元素是 `ActionItem` 时才有（`PopupInlineActionsSupportImpl.kt:22-30`），
按钮数 = 行内项 + 有「更多」时的 1；动作来自 `Presentation` 的 `INLINE_ACTIONS` 客户端属性
（`ActionUtil.kt:192` 定义、`PopupFactoryImpl.java:899-900` 消费），而"组首项当主行、其余当行内动作"
的规则在 `ProjectsTabFactory.kt:285-300`。真使用者全上游只有三处。

本仓的等价物**已有且按同一规则**：
- 欢迎页项目行（`WelcomePage.vue:555` 起）= 主行按钮 + 行内动作区，次级动作**悬停/聚焦才浮现**
  （`:741-742` 的 `opacity: 0 → 1`，"更多"按钮开着时保持可见）；
- 通知列表行（`NoticeList.vue`）同规格。

**不做的那半**：装不下时的「更多」收纳。本仓这两处用 `flex-wrap: wrap` 换行、不会溢出，
所以没有消费者 —— 我先按上游写过一个 `popupInlineActions.ts`，发现无调用方后**删掉**了：
没有真消费者的抽象就是下一条要被修的账。这条写进判决表而不是留一个空模块。

判决表相应四行（`MnemonicsSearch` / `NumericMnemonicItem` / `ListPopupImpl` / 四个 `PopupInlineActions*`）
已按上面的核实结果改写（保留原文以便对照）。

## AG. 2026-09-29 第二十八批：Esc 的**两段式**取消（`AbstractPopup.dispatchKeyEvent`）

查 `AbstractPopup` 的选项集时，先落地了其中一个**真缺陷**：

上游 `platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java:2995-3012`：

```java
if (isCloseRequest(e) && myCancelKeyEnabled && !mySpeedSearch.isHoldingFilter()) {
  if (mySpeedSearchFoundInRootComponent != null && mySpeedSearchFoundInRootComponent.isHoldingFilter()) {
    mySpeedSearchFoundInRootComponent.reset();     // ① 框里有字 → 先清掉过滤器，弹层留着
  } else {
    cancel(e);                                    // ② 框里没字 → 才关
  }
  return true;
}
```

`isCloseRequest`（`:3022-3027`）取 keymap 里 `IdeActions.ACTION_EDITOR_ESCAPE` 的绑定（本仓没有可换绑的
keymap，落点就是 Escape）。**这条两段式是有意的**：用户敲了几个字想退回去，按一次 Esc 应该只清搜索词，
而不是把整个弹层收掉。

本仓带速度搜索的两个弹层此前都是"Esc 一句话关掉"，丢了第一段。这一批补上：

- 规则抽成 `src/popupCancel.ts` 的 `popupCancelKeyAction(filter)`（`reset-filter` / `close`；
  纯空白不算"有内容"，与速度搜索自己的空串语义一致）；
- `SelectInPopup.vue`（Alt+F1 目标列表）与 `BranchPopup.vue`（Git 分支弹窗，上游
  `GitBranchesPopupBase.kt:352` 装的就是平台 SpeedSearch）两处改为两段式，清过滤器时把选中位一并复位。

判据：`tests/popup-cancel.test.mjs`（4 条：两条规则 + 两处接线 + 一条**回归门**，专拦"Esc 又变回
一句话关掉"这种退化）。

`AbstractPopup` 其余选项的核对结论：`cancelKeyEnabled`（本批做的两条）、`cancelOnClickOutside`
（本仓各弹层的"点外面关闭"已实现，见 `src/popupState.ts` 那条闸门与各弹层的 `pointerdown` 捕获）、
`resizable`/`movable`（Search Everywhere 已做，见 §AE；其余弹层上游也没传 key，不记尺寸）、
`showBorder`/`shadowed`/`modalContext`（Swing 特有，本仓用 CSS/Teleport 表达，无对应开关）、
`dimensionServiceKey`（已订正到 §AE）。剩余未落的按"没有真宿主就不做"处理，登记在 `class-parity-todo.md`。

## AH. 2026-09-29 第二十九批：多行标签条的**固定标签单独成排**（`WrapMultiRowLayout` 的最后一支）

B1 待做清单的最后一项（多行布局）核到一条真缺口：本仓 `layoutMultiRow` 只按宽度换行，
**没有**上游那条"固定标签单独成排"。

上游依据（逐条读过原文）：

- `MultiRowLayout.splitToPinnedUnpinned`（`platform/platform-api/src/com/intellij/ui/tabs/impl/multiRow/MultiRowLayout.kt:105-120`）：
  取**最后一个**固定标签（`indexOfLast`，不是第一个），它（含）之前是固定排、之后是未固定排；
  一个固定的都没有时固定排为空。
- `WrapMultiRowLayout.splitToRows`（`WrapMultiRowLayout.kt:24-45`）：`showPinnedTabsSeparately` 为真时
  **先把固定那一排加进 rows**，再对剩下那些做常规分行；`withTitle`/`withEntryPointToolbar` 只加在第一行。
- 开关是**两个条件的与**（`TabLayout.showPinnedTabsSeparately()`，`TabLayout.java:75-78`）：
  设置页的 `showPinnedTabsInASeparateRow`（`UISettingsState.kt:127`，默认 **false**）
  **且** 高级设置 `editor.keep.pinned.tabs.on.left`（`intellij.platform.ide.impl.xml:1514`，默认 **true**）。
- 设置页位置与文案：`EditorTabsConfigurable.kt:85-88` 排在「显示在一行」之后、只在该项选中时可用；
  文案 `ApplicationBundle.properties:324` `Show pinned tabs in a separate row`。

本批落地：`src/tabStripLayout.ts` 新增 `splitPinnedRow`（按"最后一个固定标签"划界）与
`showsPinnedTabsSeparately`（两个开关的与），`layoutMultiRow` 接 `pinned` / `separatePinnedRow`
两个入参；设置键 `pinnedTabsInSeparateRow` 默认 false 落三处（类型/默认值、原生 schema、bridge 白名单），
设置页加复选框（`tabsInOneRow` 开着时禁用 —— 上游 `enabledIf(tabsPlacedHorizontally ...)` 同义）。
宿主那条高级设置 `editor.keep.pinned.tabs.on.left` 在 IDEA 里默认 true 且本仓没有它的消费者，
所以恒成立的那半不另造开关（注释里写明）。

**如实不做的一支**：上游 `splitToPinnedUnpinned` 里"若紧跟在最后一个固定标签后面的是**拖放占位**就把它
一并划进固定排"（`:111-114` 的 `isDropTarget`）。本仓多行布局没有拖放占位模型（拖拽只在单行布局里做），
硬凑一个占位只会是假逻辑 —— 登记在 `class-parity-todo.md`。

**同族里仍缺的两个多行变体**（先说清上游怎么选，免得下一个人再猜）：`EditorTabbedContainer.createRowLayout`
（`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/EditorTabbedContainer.kt:656-670`）在**非单行**时
分三支 —— 普通多行 = `WrapMultiRowLayout`（本仓已落）；开了 `UISettings.hideTabsIfNeeded` 时是
`ScrollableMultiRowLayout`（多行 + 可滚动）；否则是 `CompressibleMultiRowLayout`（多行 + 把标签压窄）。
本仓"标签显示在一行"关掉后只走换行那一种，**后两个变体没有对应实现**（本仓多行不做滚动条、
也不在多行里压宽标签），按"没有真宿主就不做"登记，不假造。

同批还补上一条同族的：**固定标签的宽度上限**。`TabLabel.getPreferredSize`（`TabLabel.kt:298-304`）
在 `isPinned` 时 `size.width = min(getMaxPinnedTabWidth(), size.width)`，
`getMaxPinnedTabWidth()`（`TabLayout.java:64-66`）= registry `ide.editor.max.pinned.tab.width`
（`registry.properties:169` = **2000**；`TableLayout.java:242` 同样夹一次）。本仓 `preferredTabWidth`
原先不看 pinned，一个长路径的固定标签会独占整条 —— 现已加上上限（与 50px 地板同时生效）。

判据：`tests/tab-strip-pinned-row.test.mjs`（9 条：划界取最后一个、两开关的与、开启后分行、
**关闭时维持原行为**、宽度仍决定换行、无固定标签时不凭空多一排、固定标签的宽度上限与地板同时生效、
视图把 pinned 传进宽度计算、五处接线）。

## AI. 2026-09-29 第三十批：状态栏**组件注册表**（B2 的 §C 第一条：`StatusBarWidgetFactory`）

**改的是结构，不是观感**：在此之前「加一个状态栏组件」= 同时改 App.vue 的模板、`src/statusWidgets.ts`
的清单、以及显隐状态的形状；插件（未来的）没有入口。现在组件是一张**工厂表**的一条记录。

上游四件，逐条核过：

| 上游 | 位置 | 本仓对应 |
|---|---|---|
| `StatusBarWidgetFactory` 接口 | `platform-api/.../StatusBarWidgetFactory.java` | `src/statusBarWidgets.ts` 的 `StatusBarWidgetFactory`：`id`/`displayName`/`enabledByDefault`/`configurable`/`internal`/`available` |
| 注册 EP | `platform-api/resources/intellij.platform.ide.xml:98`；平台那一批在 `platform-impl/.../intellij.platform.ide.impl.xml:1618-1645` | `src/statusWidgets.ts` 的 `STATUS_WIDGETS` 表（11 个真工厂 + 4 个非工厂条目） |
| `StatusBarWidgetsManager.updateWidget` 的三道闸（`:98-100`） | `(isConfigurable && !settings.isEnabled) \|\| !isAvailable \|\| !isAllowedByInternalMode` ⇒ 不建 | `shouldCreateWidget`（判据里逐条测过） |
| `StatusBarWidgetSettings`（`:20-41`） | 状态 `Map<id, Boolean>`，**只存与默认不同的**（`setEnabled` :32-40 会删掉等于默认的那条）；查回来 `widgets[id] ?: isEnabledByDefault`（:26-28） | `widgetOverrides` + `widgetEnabled`/`withWidgetEnabled`；存档键沿用 `taocode.hiddenStatusWidgets`，旧格式（隐藏键数组）由 `migrateHiddenKeys` 迁移 |

**登记上游 id**：每条真工厂带 `upstreamId`（`git`/`Position`/`LineSeparator`/`Encoding`/`ReadOnlyAttribute`/
`InsertOverwrite`/`CodeStyleStatusBarWidget`/`Notifications`/`Memory`/`PowerSaveMode`/
`LanguageServiceStatusBarWidget`），默认值抄上游 `isEnabledByDefault()`：`Memory`
（`MemoryIndicatorWidgetFactory.java:22-24`）与 `PowerSaveMode`（`PowerSaveStatusWidgetFactory.java:53-55`）
默认**关**，其余默认开。本仓 `id` 保留既有短键（`position`/`lineSeparator`…）—— 它就是我们的扩展 id，
持久化键中途改名会让用户的显隐设置静默丢失。

**一处纠正**（写下来免得以后又抄错）：`smartMode` 这条 chip 原本按 `SmartModeIndicator` 想，但那个上游
默认关且 `isInternal = true`（`SmartModeIndicatorWidgetFactory.kt:24-25`，只在内部模式出现）—— 照它登记
会让这条 chip 默认消失。它的真语义是「当前文件有没有活着的语言服务」，对应
`LanguageServiceStatusBarWidget`（`LanguageServiceWidgetFactory.kt:13-15`，正常组件、默认开），已改。

**四个条目不是工厂**（上游不经过 EP，直接画进面板）：`file`/`progress`/`bridge`/`problems`。
上游的 `ToolWindowsWidget` 走 `IdeStatusBarImpl.kt:286-297` 的 leftPanel、`InfoAndProgressPanel` 走 `:343`
的 centerPanel。本仓把它们也列进勾选清单是既有行为（用户能隐藏），所以保留，但标 `factory: false`，
门控只对 `factory: true` 的条目核上游 id/默认值。

**如实不做**：上游 `StatusBarWidgetsManager` 的 EP 动态增删（`:203-235` 的 listener）—— 本仓没有插件
运行时，建了就是空壳。

**editor-based 那一层也跟着落了**：上游 `StatusBarEditorBasedWidgetFactory.canBeEnabledOn`
（`status/widget/StatusBarEditorBasedWidgetFactory.kt:14-16`）= `getTextEditor(statusBar) != null`，
即**没有打开的编辑器时这个组件不能开启**；右键菜单里那一格会因此禁用
（`ToggleWidgetAction.update` 在状态栏位置用 `canBeEnabledOnStatusBar` 决定 `isEnabledAndVisible`，
`StatusBarWidgetsActionGroup.kt:104-110`）。本仓 `widgetToggleEnabled` 兑现这条，App.vue 的勾选项绑了
`:disabled="!widgetClickable(widget.id, Boolean(active))"`。哪些是 editor-based 抄上游**基类**而非逐条猜：
`EncodingPanelWidgetFactory.java:15`、`LineSeparatorWidgetFactory.java:15`、
`ReadOnlyAttributeWidgetFactory.java:13`、`ColumnSelectionModeWidgetFactory.java:12`、
`CodeStyleStatusBarWidgetFactory.java:22`、`LanguageServiceWidgetFactory.kt:12`。其余
（`PositionPanelWidgetFactory`/`MemoryIndicatorWidgetFactory`/`PowerSaveStatusWidgetFactory`/
`NotificationWidgetFactory`/git 的 `GitBranchWidget.Factory`）都是直接实现接口，没有这一层 —— 所以
`position`/`memory`/`powerSave`/`notices`/`branch` 在没编辑器时**照样可点**，这是对的。

判据：`tests/status-bar-widgets.test.mjs`（8 条：默认值三态、切回默认就删条、三道闸各自否决、
勾选清单只列可配置非内部、editor-based 没编辑器不可开启、旧存档迁移与坏输入、
App.vue 装配 + 4 个非工厂条目 + 11 个真工厂都带 upstreamId、上游默认值与 `smartMode` 的纠正）。

## AJ. 2026-09-29 第三十一批：状态栏**中间那段文字**（`StatusBar.Info` 通道）+ 进程结束播报

**这是补一个"此前完全不存在"的通道**：状态栏中段一直写着硬编码的 `working ? '正在处理…' : '就绪'`，
没有任何地方能往里说话 —— 运行/调试结束之后，界面上一句结果都不说。

上游链路三跳，逐跳核过：

| 上游 | 位置 | 本仓 |
|---|---|---|
| `StatusBar.Info.set(text, project, requestor)` → `StatusBarInfo.TOPIC` | `ide-core/.../StatusBar.kt:34-49`、`StatusBarInfo.java:12-20` | `src/statusBarText.ts` 的 `setStatusText(text, requestor)` |
| `InfoAndProgressPanel.setText(text, requestor)` | `InfoAndProgressPanel.kt:439-451` | `acceptStatusText`：空文字只有来自**当前说话人或通知通道**才被接受；返回值 = 是否通知托管 |
| `StatusPanel.updateText(nonLogText)` | `StatusPanel.java:168-213` | `statusBarDisplay`：通知托管时显示通知文字，`myDirty \|\| >= 60_000` 追加相对时间，每 30_000ms 重算 |

**没有通知可用时回到通道自己说的话**（上游 `:203-209`）—— 所以通知穷尽/清空时要把文字交回通道，
这条接在 `notifications.ts` 的 `expireNotice`/`clearNotices`/`closeFirstNotification` 三处。

**进程结束那一句**（`src/processTerminated.ts`，IDEA `ProcessTerminatedListener`）：
文案 `IdeCoreBundle.properties:131` = `Process finished with exit code {0}`；上游 `attach(handler, project)`
给的是**前后各一个换行**（`:45-49`），落在控制台里；同一句话再发一条 `StatusBar.Info.set`（`:59-66`）。
`stringifyExitCode`（`:75-93`）**逐条照抄**：Windows 上 `[0xC0000000, 0xD0000000)` 追加
`(0x…大写十六进制)`，其中 `0xC000013A` 再补 `: interrupted by Ctrl+C`；Unix 上按信号表反查，
追加 `(interrupted by signal N:SIGNAME)`。信号表（含 `EXIT_CODE_OFFSET = 128` 与 BSD/Linux
两套号）抄自 `platform/eel/.../UnixSignal.kt:18-45/55`。

**两处如实不报**：
1. **只在整条链结束时报**（`remaining === 0`）。上游 `attach` 挂在一个 ProcessHandler 上，而本仓
   一条配置会以 `remaining > 0` 连发每步的退出（`native/run_host.cpp` 的链式步骤），每步都报就是刷屏。
2. **用户主动停止不报**（`aborted`）。本仓用 `code = -1` 作停止哨兵（`run_host.cpp` 的 `stop_instance`），
   那不是进程真实退出码 —— 报「退出码 -1」是编造数字；中止那一路宿主自己已写「链已中止…」一行。

判据：`tests/status-bar-text.test.mjs`（9 条：空文字过滤三态、时间后缀首次必带与 60 秒门槛、
后缀粒度、通道/托管/静默三种显示、Windows 失败码与 Ctrl+C、Unix 信号反查（含 BSD/Linux 号差）、
文案模板与前后换行、接线五处、`IDLE_TEXT` 是唯一哨兵）。已自证有牙：注释掉空文字过滤那条规则，
"空文字只有来自当前说话人或通知通道才被接受"当场变红。

**连带更新**：4 个测试文件里"运行输出"的精确断言加上末尾那条结束行（新增的第二条控制台文字，
与上游一致是独立的一条，不并进解码残留），并把 `menu-submenu.test.mjs` 里那条断言改为同时校验
"收起面板 + 交回状态栏文字"。`src/App.vue` 与 `src/bridge.ts` 都在登记上限上（2737 / 1208 行，
机检口径 `split('\n').length`）—— 逻辑一律落在 `src/statusBarText.ts` 与 `src/processTerminated.ts`，
宿主只留一行调用。

## AK. 2026-09-29 第三十二批：字号上下限的**实质偏差**（10–32 → 上游的 4–40 / 8–40）

**这是一个真缺陷，不是位置问题**：本仓把编辑器字号卡在 **10–32**，而上游不是这个区间。原先设置页
那句提示自己就写着「**待核**：IDEA 的编辑器字号很可能在 Editor › Color Scheme › Color Scheme Font，
尚未核实」—— 本轮把出处查实了。

上游**两处来源、两个区间**（这才是容易踩错的地方）：

| 用途 | 上游 | 区间 |
|---|---|---|
| 设置页 / 配色方案**写入**门槛 | `EditorFontsConstants.getMinEditorFontSize()` = `scale(4)`、`getMaxEditorFontSize()` = `scale(registry ide.editor.max.font.size，默认 40)`（`EditorFontsConstants.java:11-17`）；`AbstractColorsScheme.setEditorFontSize`（`:324-326`）每次写入都 `checkAndFixEditorFontSize`；设置页输入框同界 clamp（`AbstractFontOptionsPanel.java:109`） | **[4, 40]** |
| 菜单「增大/减小字号」 | `ChangeEditorFontSizeAction.actionPerformed`（`ChangeEditorFontSizeAction.java:48`）只在 `unscaledSize >= 8 && <= getMaxEditorFontSize()` 时应用 —— 判的是**目标值** | **[8, 40]** |

所以两处修正，规则落在 `src/editorFontSize.ts`（单一来源）：

1. **设置页 / 欢迎页 / 原生校验**改成 [4, 40]。原生 `settings_schema.cpp` 是权威校验器，它原先
   会把 4–9 和 33–40 判成非法 —— 也就是说**用户改不到上游允许的值**。三处（设置页 input + 校验、
   欢迎页自定义框、原生 schema + 错误文案）一起改，避免各写一个数。
2. **菜单动作**走 `stepEditorFontSize(current, ±1)`：按**目标值**判 [8, 40]，越界时 `enabled` 为假。
   这一条连"从设置页写进来的 4 按增大得 5 也不动"都照抄了（目标值 5 不满足 `>= 8`）—— 判目标值
   而不是当前值，正是上游那句代码的形状。

**为什么这算实质偏差**：10–32 让 [4,9] 与 [33,40] 两段上游可用区间在本仓不可达，且菜单动作与设置页
用了**同一个**区间（上游其实不同）。

判据：`tests/editor-font-size.test.mjs`（7 条：门槛常量出处、clamp 到 [4,40]、动作判目标值、
步进越界返回 null、低值 5 也不应用、三处 UI + 原生 schema 都走共享边界且旧字面量已消失、
原生边界用例已移到 4/3/41）。并同步更新 `tests/menu-submenu.test.mjs` 里那两条写死 32/10 的断言
（改成断"走共享步进函数"，仍精确）。

**顺带订正**：`src/menus/viewMenu.ts` 里 `EditorToggleShowGutterIcons` 那段注释还写着「待办」，
但该组**早已落地**（`src/gutterIconHost.ts` 消费 `showGutterIcons`，三个生产者是 LSP 诊断/DAP 断点/
书签，判据 `tests/gutter-icons.test.mjs`）—— 注释改为"已落地 + 仍待办的是 gutter 右键弹层"。

## AL. 2026-09-29 第三十三批：工具窗口「激活」行的**假控件**（不可用时看着可点）

**病因**：`ActivateToolWindowAction.update` 的可用性判据在 `ActivateToolWindowAction.kt:130-137`：

```kotlin
presentation.isVisible = true
val available = toolWindow.isAvailable || hasEmptyState(project)
if (e.place == ActionPlaces.POPUP) presentation.isVisible = available
else                               presentation.isEnabled = available
```

也就是**按位置分派**：弹层里不可用 ⇒ 整行不见；其它位置（含主菜单）⇒ 灰着。本仓两处激活行都只判了
`workspace`（外加一处 `needsDesktop`），于是**未就绪的「结构」等行看着可点，点下去被
`activateToolWindow` 的 `if (toolDisabled(id)) return` 静默吃掉** —— 典型"看得见但点了没反应"。

**先纠正我自己一个差点写错的判断**：我原以为 View 菜单那一组是弹层 ⇒ 该照 `POPUP` 那支**隐藏**，
并据此加了 `MenuRow.hidden` + 渲染器/动作索引两处过滤。查证后**撤回**：

- 主菜单的 place 是 `ActionPlaces.MAIN_MENU`（`JMenuBasedIdeMenuBarHelper.kt:69` 的
  `ActionMenu(place = ActionPlaces.MAIN_MENU, …)`）；
- 而且 place **原样传进子菜单**（`Utils.kt:708` 的 `ActionMenu(context, place, action, …)`）——
  所以「视图 › 工具窗口」子菜单里报的仍是 `MAIN_MENU`，走的是**灰着**那一支。
- 顺带确认 `filterInvisible`（`Utils.kt:786-802`）确实会丢掉 `isVisible == false` 的行，
  机制是真的存在，只是**不适用于主菜单**。

`hidden` 那套机制因此**没有消费者**（本仓没有以 `ActionPlaces.POPUP` 打开的 `ActivateToolWindowAction`
宿主），已整组回滚（`types.ts` / `menuUi.ts` / `submenuState.ts` / App.vue destructure）——
不做没有真宿主的抽象。

**改动**（两处，都只加一个条件）：

| 位置 | 原判据 | 现判据 |
|---|---|---|
| `src/menus/viewMenu.ts` 的 `view.toolWindow.<id>`（View › 工具窗口） | `Boolean(workspace)` | `&& !ctx.toolDisabled(id)` |
| `src/App.vue` 的 `toolWindow` 助手（Window/Edit/Git/Run 菜单共用这一份） | `Boolean(workspace) && (!needsDesktop \|\| isDesktop)` | 再 `&& !toolDisabled(view)` |

判据：`tests/view-menu-parity.test.mjs` 新增 3 条（不可用的行**仍在**但 `enabled()` 为假 ⇒ 灰着；
工作区没开时整组仍不可用；`toolWindow` 助手带 `toolDisabled` 门禁）。已自证有牙：去掉助手那半句，
"也带 toolDisabled 门禁"当场变红。另把 `makeContext` 补上 `toolDisabled`，并把原先那条只断
`activateToolWindow }` 的接线断言改成同时断两个注入。

## AM. 2026-09-29 第三十四批：`ToolWindowManager` 查询面 —— 查到一处**跨 dock 切标签**的真缺陷

先说结论：这一族（`getToolWindow` / `getToolWindows` / `getToolWindowIds` / `getActiveToolWindowId` /
`getLastActiveToolWindowId` / `invokeLater` / `canShowNotification` / `isStripeButtonShow` /
`getLocationIcon` …）**不该另起一个门面模块**。本仓的查询散在三个模块里
（`toolWindowMeta` 的 id/标题/顺序、`toolWindowStripes` 的锚点与可见性、`toolWindowActions` 的激活态），
抽一个 `ToolWindowManager` 门面只是把三处转发一遍，没有新语义 —— 与「EP→Factory 不建」同一个理由。
逐个成员核过消费者后，**只有一处是真缺陷**：

### 缺陷：焦点在**侧栏**时按 Alt+←/→ 会去切**底部** dock 的标签

上游 `TabNavigationActionBase`（`platform-impl/.../ide/actions/TabNavigationActionBase.java`）：

| 位置 | 规则 |
|---|---|
| `actionPerformed:57-65` | 只有两支 —— `isEditorComponentActive()` → 走编辑器（`:130-147` 的 `composites`）；否则 `PlatformDataKeys.NONEMPTY_CONTENT_MANAGER.getData(...)` → 走**当前聚焦那个**工具窗口自己的 ContentManager（`InternalDecoratorImpl.kt:648` 把它塞进 data context） |
| `update:106`、`:81-87` | 可用性 = `contentManager != null && contentManager.getContentCount() > 1 && contentManager.isSingleSelection()` |

关键在最后一行：**侧栏工具窗口只有一条内容**，它那个 ContentManager 的 `getContentCount()` 恒为 1
⇒ 动作灰着、切不动。本仓原先写的是"不是编辑器就当底部"：

```ts
if (focusedDock() === 'editor') { …编辑器… }
// 否则一律走底部那一支 ⇒ 焦点在项目树里按 Alt+→ 去切底部 dock
```

结果是**跨 dock 操作**：用户在项目树里按 Next Tab，动的是他没在看的面板。`tabTargetCount()`
（那两条菜单行的 `enabled`）有同样的错，所以行也是亮的。

**修复**：判据抽到 `src/activeToolWindow.ts` 的 `tabNavigationCount(focused, editorTabs, bottomTabs)`
（侧栏恒 1，与 `getContentCount() > 1` 同义），`tabTargetCount` 与 `cycleTab` 都改走它；
`cycleTab` 对侧栏**提前返回**（那一支没有可切的东西）。

**这同时是查询面该在哪里的答案**：`isEditorComponentActive` 的等价物就是本仓那个
`focusedDock()`（`'editor' | 'side' | 'bottom'`），它已经在 `toolWindowActions.ts` 里服务了七处调用
（隐藏当前窗口、关闭当前标签、折叠/展开目标、标签导航…）。要加的不是门面，而是把**判据本身**
放回纯模块以便单测。

判据：`tests/active-tool-window.test.mjs` 新增 3 条（侧栏恒 1；编辑器与底部各报各的数；
接线：`tabTargetCount` 走共享判据 + `cycleTab` 对侧栏提前返回），已自证有牙（把提前返回改成
`if (false) return`，接线那条当场变红）。

**同批（第三十五批）**：上一条的**同一个错**在 `closeActiveTab` 里也有一份。
`CloseActiveTabAction`（`platform-impl/.../ide/actions/CloseActiveTabAction.java`）先取**上下文里那个**
ContentManager（`:23`），没有可关的选中内容才落到 `toolWindow.hide(null)`（`:31-37`）—— 而那个
`toolWindow` 是**从该 ContentManager 自己的上下文**里取的（`:32`），所以收的一定是同一个窗口。
侧栏只有一条不可关的内容 ⇒ 那一支收的是**侧栏**。本仓原来是 `if (focusedDock() !== 'editor')`
一把抓，于是焦点在项目树里按 Ctrl+Shift+F4 会去收**底部**面板。已改成显式分开：
侧栏 ⇒ `explorer = false`；底部 ⇒ 关内容或收面板；编辑器 ⇒ 关标签。
判据 `tests/active-tool-window.test.mjs` 新增 1 条（并锁住旧写法必须消失），已自证有牙。

## AN. 2026-09-29 第三十六批：侧条**拖宽**与**「更多」按钮**（B2 §C 的 `ResizeStripeManager` + `MoreSquareStripeButton`）

交接文档把这两条排成"下一步优先级 1"。动手前先把 2026.2 的**实际**行为钉死 —— 参考树（OSS master）
与本机安装版（IU-262.8665.258）在这块**结构不一样**：参考树里"侧条能不能拖"来自
`ToolWindowStripeExtension.isStripeResizable()`，而 2026.2 的整包 jar 里**已经没有** `ToolWindowStripeExtension`
这个类（`lib/intellij.platform.ide.impl.jar` 全扫，0 命中），`ResizeStripeManager$Companion.enabled()`
反编译出来是常量 `true`：

| 事实 | 证据 | 本仓落点 |
|---|---|---|
| 能拖 ⟺ 「显示工具窗口名称」开着 | `enabled()` = `iconst_1; ireturn`；`isShowNames() = enabled() && UISettings.showToolWindowsNames` | `src/stripeResize.ts` 的门控语义 + `ToolStripe.vue` 的 `v-if="showNames"` |
| 宽度上下限 40..100（紧凑 33） | `checkMinMax` 反编译（`ResizeStripeManager.kt:138-150` 同款） | `stripeWidthLimits` / `clampStripeWidth` |
| 开关名称 = 把宽度重置 | `applyShowNames`：开 `JBUI.scale(59)`、关 0，**两侧**都重置 | `stripeWidthsAfterShowNames` + `toolWindowStripes.ts` 的 watch（只在变化时重置） |
| 名称关着时存档宽度**不生效** | `updateState`（`:89-102`）在 `isShowNames()` 为假时把 `myCustomWidth` 直接归零并摘掉分隔线（`getSideCustomWidth` 只在名称开着时读） | `stripeWidth()` 先看名称开关再读存档 —— 否则会出现"轨道很宽但没有名字"的中间态 |
| 拖出来的宽度按边持久化 | `getSideCustomWidth`/`setSideCustomWidth`（UISettings 两侧各一份，`:230-253`） | `taocode.stripeWidths`（`{left, right}`） |
| 右侧条方向取反 | `setProportion` 里 `anchor == RIGHT ⇒ width = fullWidth - width`（`:120-123`） | `stripeWidthAfterDrag` 的镜像 |
| 分隔线在**内沿** | `layoutContainer`：左条 `target.width - 1`、右条 `0`（`:79-86`） | `.stripe-resize-handle` 的 `right:0` / `left:0` |
| 「更多」= 有窗口**没有侧条按钮** | `AbstractMoreSquareStripeButton.isAvailable`（`:142`）= `getToolWindowActions(project, true).isNotEmpty()`，跳过规则在 `ToolWindowsGroup.java:50-53` | `moreButtonRows`（= 被「从侧栏移除」的**可用**窗口） |
| 「更多」只停在它那一侧 | `MoreSquareStripeButton.isAvailable`（`:78-80`）：`getMoreButtonSide() == side`；`ToolWindowManagerState.moreButton` 默认 LEFT、只在非 LEFT 时写存档（`:86-87`） | `moreButtonSide` / `moreButtonVisible(side)` |
| 左键 = 窗口列表；右键 = 「移至对侧」 | `ShowMoreToolWindowsAction`（`:100-123`，`minPopupWidth = JBUI.scale(300)`）；`createPopupGroup(moveTo)`（`:49-61`） | 弹层与「移至右侧 / 移至左侧」 |
| 侧条空白处右键 = 名称开关 | `ResizeStripeManager.kt:49-61` 挂的 `PopupHandler` → `ToolWindowShowNamesAction` | `openNamesMenu` |

文案一律取本机随 IDE 发货的中文语言包（`plugins/localization-zh/lib/localization-zh.jar`，不是自己译的）：
「更多」（`more.button.accessible.name`）、「更多工具窗口」（`tool.window.new.stripe.more.title`）、
「移至{左,右}侧」（`tool.window.more.button.move` × `action.text.anchor.*.capitalized`）、
「显示工具窗口名称」（`action.ToolWindowShowNamesAction.text`）。**行序**照 `ToolWindowsGroup` 的比较器
（助记符 → 窗口 id 大小写不敏感，`ToolWindowsGroup.java:79-88`），**不是**状态栏那个按标题排的比较器 ——
所以 `src/toolWindows.ts` 新增 `sortedByMnemonicThenId`（同一弹层的两种排序上游真的都有）。

**结构变化**：App.vue 原先把两条侧条的按钮循环内联着写，而它顶在机检上限（2737 行，`tests/module-size.test.mjs`），
新增的四处标记（分隔线、更多按钮、两个弹层）没有位置。按本仓 §4 的规矩，把这一域整体搬进
`src/components/ToolStripe.vue` —— 左右两条侧条本来就是**同一份结构**（IDEA 也只是
`ToolWindowLeftToolbar`/`RightToolbar` 两个薄子类），App.vue 每条只剩一行调用，左侧条尾部那几个固定按钮
（处理记录 / 输出 / 设置 / 头像）走 `<slot>`。按钮列表另起一层 `.stripe-list` 自己滚：轨道本体不能再滚
（`overflow-y: auto` 的容器里，绝对定位的分隔线会跟着内容滚走）。

**刻意偏差（逐条登记在 `docs/source-todo.md` §9）**：

1. 默认宽度取 **66** 而不是上游的 59 —— 59 是 IDEA 在自己的字体度量下量出的按钮宽度，本仓名称态按钮盒
   是 60px + 两侧 3px 内边距，照搬 59 会把按钮挤出去。拖动范围仍是上游的 `[40,100]`（紧凑 33）。
2. 不做 IDE scale 乘法（上游 `updateNamedState:152-171` 会按 `currentIdeScale` 换算）—— 本仓整条侧条都是
   未缩放的 px，只缩宽度会与图标/文字错位。
3. 分隔线命中区 7px（线宽仍 1px、平时不画 —— 与上游 `paint(){}` 一致）：1px 的线在 DOM 里抓不住，
   Swing 那边是拖拽事件直接命中。
4. 「更多」的触发比上游窄一档：上游把"按钮不在条纹上"的窗口**都**算进去（含不可用的窗口，弹层里那几行是灰的）；
   本仓每个可用窗口都必有一条按钮，所以只剩「从侧栏移除」这一档，且不可用的窗口不进表（与状态栏那个弹层
   同一条规矩：不列假行）。
5. 弹层行不带「钉住」内联动作：上游 `XNextToolWindowsMoreGroup` / `StripeActionGroup.MyMoreAction` 给每行
   挂 `TogglePinAction`（钉住侧条按钮），本仓没有"钉住的侧条按钮"这个概念，不放假按钮。

判据：`tests/stripe-resize-more.test.mjs`（17 条 —— 夹取/拖拽方向/名称闸/持久化与重置/坏存档/拖拽收尾、
更多按钮的可用性与两侧归属/行序/存档只记非默认档/不可用窗口不进表、组件真模板渲染的按钮与分隔线与
更多按钮、App.vue 与 CSS 的接线）。**自证有牙**：把"不可用窗口的过滤"与"分隔线的 `v-if="showNames"`"
各拔一次，对应两条当场变红，改回即绿。

顺带纠正判决表里**判断依据写错**的三行：`ToolWindowToolbar` / `ToolWindowLeftToolbar` /
`ToolWindowRightToolbar` 被记成"窗口内工具栏（本仓窗口内没有工具栏层）"——它们就是**侧条本体**的类，
判决随本轮实现一起改成 `[~]`（`ToolWindowHorizontalToolbar` 仍是 `[ ]`：TOP 横向条纹，本仓与 2026.2
都没有这条形态）。B2 四档计数随之由 `4 + 68 + 96 + 182` 变成 `6 + 71 + 91 + 182`（仍是 350）。

**真 exe 取证（这一步抓到两个测试看不见的缺陷）**：`build/TaoCode.exe` 用
`TAOCODE_DEBUG_PORT=9335` 起 WebView2 的 CDP，直接对真实 DOM 取证（跑完 `taskkill` 收进程、
`projects.json` 原样还原）：

| 步骤 | 结果 |
|---|---|
| 名称关（默认） | 两条轨道都在、`.stripe-list` 在、分隔线 0 个、名字 `display: none`、宽度 31 |
| 名称开 | 分隔线 2 个、宽度 66、名字 `display: block` |
| 拖左条分隔线（合成 `Input.dispatchMouseEvent`，pointerId=1） | `.dragging` 生效，宽度 66 → 96，落盘 `{"left":96,"right":66}`（只动左边） |
| 右键侧条按钮 → 齿轮「从侧栏移除」 | 按钮消失、`taocode.hiddenStripeButtons = ["git"]`、「更多」出现（`aria-label=更多`、`title=更多工具窗口`） |
| 点「更多」 | 弹层开、`min-width: 300px`、左沿 = 轨道右沿（`ShowMoreToolWindowsAction.showPopup` 的几何）、行 = `源代码管理 Alt+2` |
| 点那一行 | 按钮回来、「更多」消失、`hiddenStripeButtons` 清空（上游同一个循环） |
| 右键侧条空白处 | 弹层只有一行「显示工具窗口名称」，`aria-checked=true` |
| 控制台 | 0 异常 / 0 报错 |

抓到的两个**真缺陷**（都已修 + 各自留了回归判据）：

1. **TDZ**：原先宽度那一域挂在 `toolWindowStripes.ts` 里的 `watch(() => deps.showNames.value, …)`，
   而非 immediate 的 `watch` 在**创建时**就会求值一次取 oldValue ⇒ 读到了宿主里声明更晚的
   `editorSettings` ⇒ 真 exe 里 `ReferenceError: Cannot access 'dt' before initialization`
   （SSR 测试看不见：那边传的是普通对象）。改法照上游语义 —— `applyShowNames` 本来就该由设置页
   `onApply` 触发，所以现在由 `src/appearanceActions.ts` 在设置变化时调 `deps.applyShowNamesWidths`，
   状态域只读存档（新增判据锁住"这一层不许挂 watch"）。
2. **右键冒泡**：按钮的 `contextmenu` 冒泡到轨道 ⇒ 齿轮菜单与「显示工具窗口名称」同时弹出，
   后者的遮罩接着吞掉下一次点击（拖拽也就跟着失效）。改成 `.prevent.stop`（上游是按钮自己的
   `PopupHandler` 吃掉事件）。

**同批补判（判决表的欠账）**：收拾判决表时发现第三十批的**状态栏注册表**（本文件 §AI）代码已落地、
依据已写清，但 §G 里那一族仍是 `[ ]`（`StatusBarWidgetFactory` / `StatusBarWidgetSettings` /
`StatusBarWidgetsActionGroup` / `StatusBarWidgetsManager` / `WidgetRegistry`）。
按 **本文件已有的记录**（§AI 逐条引了 `src/statusBarWidgets.ts` 与 `src/statusWidgets.ts`）把它们补判成
`[x]`（前两条）与 `[~]`（后三条 —— 三道闸与按 id 反查都在，缺的是 `LinkedHashMap<Factory, Widget>` 那种
"已建组件容器 + 增量增删"，渲染模型里不需要），并在 §C 的优先表里把第 1、2 条划掉。
`StatusBarWidgetProvider` / `StatusBarWidgetProviderToFactoryAdapter`（EP 侧）与
`StatusBarWidgetsOptionProvider`（设置页）仍是 `[ ]`：本仓没有插件运行时、也没有状态栏组件的设置页。

由此 §C 的"最有价值的下一条"标记移到**工具窗口的注册机制**（`RegisterToolWindowTask` / `ToolWindowEP` /
`ToolWindowFactory`）：它是与状态栏注册表**同一种**结构性缺口 —— 加一个工具窗口现在要改
`src/toolWindowMeta.ts` 的 id 联合、两张表与可用性函数。B2 四档计数同时由 `6 + 71 + 91 + 182`
订正为 `8 + 74 + 86 + 182`（`tests/b2-verdict.test.mjs` 的和数断言与文档头部一起改，仍 = 350）。
