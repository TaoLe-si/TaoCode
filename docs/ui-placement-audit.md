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

## E. 待继续审计的范围（尚未开始，不假装已完成）

| 范围 | 现状 |
|---|---|
| 设置树的多层结构（Editor 之外） | `待核`：外观页的 15 个未定键；`Editor › Code Style` 系列；`Version Control` 系列；`Tools` 系列 |
| **菜单的嵌套**（子菜单） | **已开始整改**。IDEA 的子菜单在动作 XML 里就是 `<group … popup="true">`；`platform/platform-impl/resources/idea/PlatformActions.xml` 里主菜单共有 **18 个**：`FilePropertiesGroup`(:400)、`ChangeLineSeparators`(:405)、`ExportImportGroup`(:419)、`FileExportGroup`(:432)、`PasteGroup`(:454)、`FindMenuGroup`(:465)、`ConvertIndentsGroup`(:500)、`Macros`(:506)、`ViewAppearanceGroup`(:523)、`EditorToggleActions`(:572)、`EditorBidiTextDirection`(:591)、`NavigateInFileGroup`(:620)、`LayoutsGroup`(:641)、`ResizeToolWindowGroup`(:680)、`EditorTabsGroup`(:688)、`Notifications`(:726)、`BackgroundTasks`(:731)、`HelpDiagnosticTools`(:764)。TaoCode 的 `MenuRow` **原本没有 children**，所以这 18 处**全部被拍平**。<br>**本轮已做**：① `MenuRow.children` + 子菜单渲染（父行右侧浮层、`position: fixed`、`▸` 提示、Esc 关闭、点击父行只切换展开、挑选子行才执行并关闭整条链）；② `窗口 › 布局` 收成一个 `children` 子菜单（对应 `LayoutsGroup` popup="true"）；③ 动作索引递归摊平（否则搬进 children 的动作会从「查找操作」里消失）；④ 汉堡面板按树展开（分组标题 + 缩进子行）；⑤ 又收拢四处：`窗口 › 调整工具窗口`（`ResizeToolWindowGroup` popup，:680-686，四个拉伸动作）与 `编辑 › 查找`（`FindMenuGroup` popup，:465-486）—— 这两处原来都是用 **section 标题**顶替的（注释里就写着 "TaoCode's menus are flat"），现在是真子菜单；⑥ `窗口 › 编辑器标签页`（`EditorTabsGroup` popup，:688-705 —— 其中 `CloseEditorsGroup` **不带** popup 是内联组，用分隔线表达同一层）；⑦ `文件 › 文件属性`（`FilePropertiesGroup` popup，:400-412，子项含 ChangeFileEncodingAction / ToggleReadOnlyAttribute），**其中再嵌一层** `文件属性 › 行分隔符`（`ChangeLineSeparators` 自己也是 popup="true"，:405-409）—— 这是本轮唯一的**两级子菜单**；⑧ `视图 › 外观`（`ViewAppearanceGroup` popup，:523-546 —— 内部 `ToggleFullScreenGroup` 与 `UIToggleActions` 都是**不带 popup 的内联组**，用分隔线表达），并把 `ToggleCompactMode` 补成真开关（落 `editorSettings.compactMode`）；`ToggleDistractionFreeMode` 与 `ToggleZenMode` 在 TaoCode 里是同一件事，**不重复放两行**；`ToggleFullScreen` 需要先给宿主加全屏通道，登记为待办。<br>**逐个核对后的两个例外（不改成子菜单，理由如下）**：① `BackgroundTasks`（:731-734）——IDEA 有两个子项，TaoCode 只有 `ShowProcessWindow` 一个有落点（另一个 `AutoShowProcessPopupAction` 是注册表键、无 UI，按规则不造假设置），**单项做成子菜单反而多一次点击**，保留 section；② `HelpDiagnosticTools`（:764-773）—— TaoCode **没有「帮助」菜单**（`menu` 联合类型里没有 help），它的父菜单不存在，无从收拢，除非先补一整个帮助菜单。<br>**18 处的最终分解（逐个核对完）**：已收拢 **5**（LayoutsGroup、ResizeToolWindowGroup、FindMenuGroup、EditorTabsGroup、FilePropertiesGroup›ChangeLineSeparators 两级）＋ ViewAppearanceGroup **6**（见⑧）；两个**有意例外**（BackgroundTasks 单子项、HelpDiagnosticTools 父菜单不存在）；其余（PasteGroup / ConvertIndentsGroup / Macros / EditorBidiTextDirection / NavigateInFileGroup / ExportImportGroup / FileExportGroup）在 TaoCode **暂无对应动作行** —— 按「全量移植」要求，它们是**待办**而不是放弃，已逐条登记进 `docs/class-parity-todo.md` §9（缺什么能力写得很具体，例如全屏通道、gutter 图标层、宏系统）；`Notifications` 已移植（`窗口 › 通知`）；唯一还**可做**的是 `EditorToggleActions`（:572-586：软换行 / 空白符号 / 行号 / 行内图标 / 缩进参考线 / 字号±）——TaoCode 有这些设置的落点（`wordWrap`/`showWhitespaces`/`lineNumbers`/`showIndentGuides`），只差把它们做成 View 菜单里的 **ToggleAction 行**，属于新增功能行而不是位置搬家。（`文件属性 › 行分隔符`、`编辑 › 查找`、`视图 › 外观`、`窗口 › 编辑器标签页`、`帮助 › 诊断工具` …），需要逐条核对后再改 |
| **对话框内的分层**（标签页 / 分栏） | `待核`。已知两处可疑：运行配置编辑器（IDEA 是左右分栏 + 多标签）、`项目结构` 对话框（IDEA 是左侧多页 + 右侧详情） |
| 工具窗口内的多层内容 | `待核`。IDEA 的工具窗口有条带 › 内容 › 内容的侧边组件三层 |
| 编辑器右键菜单的分组 | 已有部分对标（`EditorTabPopupMenu` 曾逐行核过），`待核`其余 |
