# 设置（Configurable）对照清单



> 桃 2026-09-27 §10 #4「设置缺巨量核心逻辑」的逐项依据。

> IDEA 侧证据：`platform/**/resources/*.xml` 里 `<applicationConfigurable>` / `<projectConfigurable>` 的 `id`。

> IDEA 平台注册：**52** 个；TaoCode 设置节点：**12** 个。



## IDEA 注册的 Configurable（平台模块）



| # | IDEA id | 实现类 | TaoCode 状态 |

|---:|---|---|---|

| 1 | `Console` | `ConsoleConfigurable` | `[x]` **已实现**：`foldConsoleLines`/`foldExceptions` 设置（native 键表+默认值+数组校验 → bridge → 设置页「编辑器 › 控制台」（注册 parentId="preferences.editor"））+ `src/consoleFold.ts` 纯函数 + 运行面板折叠渲染（×N）。**源码**：`platform/lang-impl/src/com/intellij/execution/console/ConsoleConfigurable.java:43-73` —— 内容是**两个 AddDeleteListPanel**：`console.fold.console.lines`（要折叠的控制台行）与 `console.fold.exceptions`（不折叠的例外），即**控制台行折叠规则**（不是字体/行数）。TaoCode 落地 = 新增设置 `foldConsoleLines`/`foldExceptions`（数组，native 校验 + bridge + 设置页列表）+ 输出面板渲染时按规则折叠重复行 |

| 2 | `Errors` | `ErrorsConfigurableProviderImpl` → `ErrorOptionsProvider` 扩展点 | `[x]` **已实现等价物**：设置 `showDiagnostics`/`showErrorStripe`（编辑器键表+默认值+兜底布尔校验 → bridge → 设置页「编辑器 › 检查」 → `CodeEditor.vue` 的 `lspExtensions()` 按开关包含 `linter`/`lintGutter`）。源码：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1824`（id=Errors）、`.../profile/codeInspection/ui/ErrorOptionsProviderEP.java:9`（各语言扩展点，TaoCode 用 LSP 无此类扩展点） |

| 3 | `File.Encoding` | `FileEncodingConfigurableProvider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` |

| 4 | `RemoteServers` | `RemoteServerListConfigurableProvider`（声明于 `platform/remote-servers/impl/resources/intellij.platform.remoteServers.impl.xml`） | `[ ]` |

| 5 | `Runtime.Targets.Configurable` | `TargetEnvironmentsConfigurableProvider`（声明于 `platform/execution-impl/resources/intellij.platform.execution.impl.xml`） | `[ ]` |

| 6 | `actions.on.save` | `ActionsOnSaveConfigurable$ActionsOnSaveConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml`） | `[ ]` |

| 7 | `advanced.settings` | `AdvancedSettingsConfigurable`（IDEA 的 Registry 对话框） | `[x]` **已实现并可编辑**：「外观与行为 › 高级设置」列出 editor/general 的**全部内部键与当前值**，值为 **JSON 文本框**（非法 JSON 标红、「应用更改」按各自链路提交 editor→save / general→saveGeneral）+ 「复制为 JSON」+「仅供内部使用」警示 |：IDEA 的"高级设置"本质是**内部注册表编辑器**（Registry），TaoCode 没有注册表对话框，等价物是把它已升格为设置的内部开关集中成一个"高级设置"页（已有若干：`autoShowProcessPopup`、`presentationMode` 等），需要在页面里按 IDEA 的 Registry 条目逐条映射 |

| 8 | `application.elevation` | `ElevationSettingsConfigurable` | `[ ]` |

| 9 | `application.passwordSafe` | `PasswordSafeConfigurable` | `[ ]` |

| 10 | `build.tools` | `ExternalSystemGroupConfigurable.kt:22-58`（`:22-26` projectConfigurable/id=`build.tools`；`:31-55` 复选框 + ALL/SELECTIVE 单选 + `onApply`；`:58` `PREVIOUS_KEY`） + `ExternalSystemProjectTrackerSettings.kt:12-28`（三档语义） | `[x]` **已按源码重做**（2026-09-27）：旧实现是**应用级布尔** `buildToolAutoReload`（错作用域、错元数，桃点名「假逻辑」），现已换成**项目级** `ProjectSettings.buildTools = {autoReloadType, previousAutoReloadType, gradle}`（native 默认值 + `validate_build_tools` 三档校验 + 局部补丁 `merge_patch`；旧键从应用级键表移除并被 `prune_unknown` 剪掉，不做迁移 —— 它回答的是另一个问题）。UI = `src/components/BuildToolsSettingsPage.vue`（复选框 + 两档单选，关闭时单选 disable，等于 `:31-55`）。消费者 = `src/gradleHost.ts` 的 `onBuildFilesChanged`（三档纯函数 `shouldAutoReload` 在 `src/gradle.ts`；`diskSync` 只转交变化清单；`vcsActions` 的 `noteVcsUpdate()` 供 SELECTIVE 的「VCS 更新」那一条）。Gradle 页（`reference.settingsdialog.project.gradle`，`intellij.gradle.xml:177-179` groupWeight 110）作为它的子页见 §11 |

| 11 | `consents` | `ConsentConfigurable` | `[ ]` |

| 12 | `diff.base` | `DiffSettingsConfigurable`（`platform/diff-impl/src/com/intellij/diff/settings/DiffSettingsConfigurable.kt:30-58`） | `[~]` **上下文行数已打通**：设置 `diffContextLines`（general 键表 + 默认 3 + 1..100 校验 → bridge → 设置页「工具 › 差异与合并」（注册 groupId="tools"） → native `git::diff`/`git::diff_sides` 加 `context` 参数拼 `-U<n>`，`git.diff`/`git.diffSides` 路由按 `params.context` 传入）。**调用点已接**：`SourceControl.vue:472-473` 的 `git.diff`/`git.diffSides` 调用现在带 `context: props.diffContextLines`（经 `ToolWindowView` 的 ctx 从 `generalSettings.diffContextLines` 传入），git 通道闭环；其余项（末尾跳下一文件 / `IncludeInNavigationHistory` / Merge 自动应用）待做 |

| 13 | `editing.templates` | `LiveTemplatesConfigurable` | `[ ]` |

| 14 | `editor.breadcrumbs` | `BreadcrumbsConfigurable`（`platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java:24`，UI 在 `BreadcrumbsConfigurableUI.kt:44-70`） | `[x]` **三项全实现**（本批校正）：① 显示开关 `showBreadcrumbs`（`EditorSettingsExternalizable.isBreadcrumbsShown:439-453`）；② 位置 `breadcrumbsPlacement: 'top'\|'bottom'`（`isBreadcrumbsAbove:420-430`，**只有上/下**，默认**下方** —— `OptionSet:91-92` `SHOW_BREADCRUMBS_ABOVE=false`；旧版把「不显示」编进这个键的第三态已按源码拆开，旧文件由 `bridge.ts` 的 `normalizeEditorSettings` 迁移）；③ 按语言开关 `breadcrumbsLanguages: {语言: 布尔}`（`mapLanguageBreadcrumbs:146-152` **只存显式配置过的语言**，未进表=显示，`isBreadcrumbsShownFor:459-466`），native 用 `validate_language_flags` 校验键必须是已知语言 id；消费点是编辑器上下两条面包屑的 `breadcrumbsOn(path)`。设置页按源码排布：总开关 → 位置单选（随总开关禁用）→ 每语言复选。**仍缺**：页底「配置面包屑颜色」链接指向颜色方案页（`ColorAndFontOptions.selectOrEditColor(context,"Breadcrumbs//Current",GeneralColorsPage)`），本仓没有色板/颜色方案页，登记在 `class-parity-todo.md`，不渲染假链接 |

| 15 | `editor.preferences.import` | `AutoImportOptionsConfigurable` | `[ ]` |

| 16 | `editor.reader.mode` | `ReaderModeConfigurableProvider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` |

| 17 | `editor.stickyLines` | `StickyLinesConfigurable.kt:7-20` | `[x]` **宿主能力已补并可用**：设置 `showStickyLines`（默认 true）+ `stickyLinesLimit`（默认 3，0..10 校验）→ 编辑器顶边叠加**粘性作用域行层**（`stickyLines` computed 从 LSP `documentSymbol` 里取包含当前光标行的符号链，按 startLine 升序取最内层 N 条）+ `.sticky-lines` 样式 + 设置页「编辑器 › 粘性行」（注册 parentId="preferences.editor"） |

| 18 | `fileTemplates` | `AllFileTemplatesConfigurable$Provider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` |

| 19 | `http.certificates` | `CertificateConfigurable` | `[ ]` |

| 20 | `http.proxy` | `HttpProxyConfigurable` | `[ ]` |

| 21 | `ide.audiocues` | `AudioCuesConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml`） | `[ ]` |

| 22 | `ide.date.format` | `DateTimeFormatConfigurable` | `[ ]` |

| 23 | `ijent.dashboard` | `IjentDashboardConfigurableProvider`（声明于 `platform/ijent/ui/resources/intellij.platform.ijent.community.ui.xml`） | `[ ]` |

| 24 | `inlay.hints` | `InlaySettingsConfigurableProvider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` |

| 25 | `preferences.customizations` | `CustomizationConfigurable` | `[ ]` |

| 26 | `preferences.editor` | `EditorOptionsPanel` | `[ ]` |

| 27 | `preferences.editor.code.editing` | `EditorCodeEditingConfigurable` | `[ ]` |

| 28 | `preferences.externalDependencies` | `ExternalDependenciesConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml`） | `[ ]` |

| 29 | `preferences.externalTools` | `ToolConfigurable`（`platform/lang-impl/src/com/intellij/tools/ToolConfigurable.java`） | `[x]` **已实现**：设置 `externalTools: {name, command}[]`（native 键表 + 默认空数组 + **逐条白名单/长度校验** → bridge → 设置页「工具 › 外部工具」（注册 groupId="tools"）（每行「名称|命令」））+ **消费点**：「工具 › 外部工具」子菜单（`toolsMenu.ts`，每项点击走 `runExternalTool()` → 与构建同一条 `run.start` 通道 + 输出面板） |

| 30 | `preferences.fileTypes` | `FileTypeConfigurable` | `[x]` **已实现**：设置页「编辑器 › 文件类型」（注册 `intellij.platform.lang.impl.xml:992-994` `groupId="editor" groupWeight="120"`），扩展名 → 语言 的表，可增删改；校验在 `src/fileTypes.ts`（与原生 `validate_file_associations` 同规则）；写的是 `ProjectSettings.fileAssociations`，与文件树/标签页右键的「关联文件类型」同一份数据，保存后按变更的扩展名重挂语言 |

| 31 | `preferences.general` | `GeneralSettingsConfigurable` | `[ ]` |

| 32 | `preferences.intentionPowerPack` | `IntentionsConfigurableProviderImpl`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` |

| 33 | `preferences.keymap` | `KeymapPanel` | `[ ]` |

| 34 | `preferences.language.and.region` | `LanguageAndRegionConfigurable` | `[ ]` |

| 35 | `preferences.lookFeel` | `AppearanceConfigurable` | `[ ]` |

| 36 | `preferences.pathVariables` | `PathMacroConfigurable` | `[ ]` |

| 37 | `preferences.pluginManager` | `PluginManagerConfigurable` | `[ ]` |

| 38 | `preferences.sourceCode` | `CodeStyleSchemesConfigurable` | `[ ]` |

| 39 | `preferences.startup.tasks` | `ProjectStartupConfigurable$ProjectStartupConfigurableProvider`（声明于 `platform/execution-impl/resources/intellij.platform.execution.impl.xml`） | `[ ]` |

| 40 | `preferences.toDoOptions` | `TodoConfigurable`（`platform/todo/src/com/intellij/ide/todo/configurable/TodoConfigurable.java` 的**模式表**，每行 = 正则 + `caseSensitive` + 颜色） | `[~]` **已补 `caseSensitive`**：`TodoPattern.caseSensitive`（默认 false）全链路 —— native `known_keys` 白名单 + 类型校验 → bridge 类型/映射（**原映射只带两字段会丢该值**，已修）+ 前端 malformed 校验 → `TodoPanel.markerMatches` 按开关切换 `i` 标志。**本批补上模式表编辑 UI**：设置页「编辑器 › TODO」（注册 `groupId="editor"`，`platform/todo/resources/intellij.platform.todo.xml:49`），可增删改「模式 / 说明 / 区分大小写」，校验在 `src/todoPatterns.ts`（与原生 `validate_todo_patterns` 同规则）。**仍缺**：模式表的**颜色**列（需要颜色方案页） |

| 41 | `preferences.updates` | `UpdateSettingsConfigurable` | `[ ]` |

| 42 | `project.propDebugger` | `DebuggerConfigurableProvider`（声明于 `platform/xdebugger-impl/ui/resources/intellij.platform.debugger.impl.ui.xml`） | `[ ]` |

| 43 | `project.propVCSSupport.Mappings` | `VcsManagerConfigurableProvider`（声明于 `platform/vcs-impl/resources/META-INF/VcsExtensions.xml`） | `[ ]` |

| 44 | `project.scopes` | `ScopeChooserConfigurable`（`platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeChooserConfigurable.java:65-529`） | `[x]` **已实现**：注册在 `intellij.platform.lang.impl.xml:1825`（`groupId="appearance"` → 设置树「外观与行为 › 作用域」，`IdeBundle.properties:913 scopes.display.name=Scopes`）。① 模式语言：`src/scopes.ts` 逐分支复刻 `_ScopesLexer.flex`（**空白是有效字符**）、`PackageSetFactoryImpl.Parser:74-211`（`||`/`&&`/`!`/括号/`$引用`）、`FilePackageSetParserExtension`（`file:`/`ext:`）、`ProjectPathPackageSetParserExtension`+`ProjectPathPatternPackageSet`（`projectPath:`）、`FilePatternPackageSet.convertToRegexp:73-120`、Union/Intersection/Complement 的 `getText` 与优先级、`ScopeEditorPanel.doIncludeSelected/doExcludeSelected:545-609`；② 主从页 `ScopesSettingsPage.vue`：左列表（本地/共享 + 添加·删除·复制·另存为·上移·下移 + 唯一名「未命名N」）、右明细（通过 VCS 共享 + 模式框 + 错误消息与 `pos:N` + 「包含 N / 共 M 个文件」+ 文件树 + 包含/递归包含/排除/递归排除四个按钮 + 递归/部分包含图例）；③ 全链路：native `project_defaults`/`validate_project_patch` 的 `scopes` 键（形状校验，**故意不校验模式语法** —— `readScope:137-142` 允许存下解析不了的模式）→ `bridge.ts` 类型与预览校验 → `App.vue` 的 `saveScopes`；④ **消费点**：搜索面板的「范围」下拉（IDEA `FindPopupScopeUIImpl.java:59,137` 的 `ScopeChooserCombo`），结果按作用域精确过滤并重算文件数。**仍缺**（登记在 `class-parity-todo.md`）：预定义作用域（`CustomScopesProvider`）、`ScopeDescriptorProvider`/`SearchScopeProvider` 的分组条目（模块/库/问题/变更列表）、`ScopeEditorPanel.createTreeToolbar:647-679` 的树工具条（扁平化包子目录/显示文件/显示模块/过滤合法项/切换方言）、`ScopesStateService` 的每作用域 UI 状态（展开状态）、项目视图按作用域过滤 |

| 45 | `reference.idesettings.quicklists` | `QuickListsPanel` | `[ ]` |

| 46 | `reference.settings.ide.settings.file-colors` | `FileColorsConfigurable` | `[ ]` |

| 47 | `reference.settings.ide.settings.notifications` | `NotificationsConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml`） | `[ ]` |

| 48 | `reference.settings.ide.settings.web.browsers` | `BrowserSettings` | `[ ]` |

| 49 | `reference.settingsdialog.IDE.editor.colors` | `ColorAndFontOptions` | `[ ]` |

| 50 | `settings.sync` | `SettingsSyncConfigurableProvider`（声明于 `platform/settings-sync-core/resources/intellij.settingsSync.core.xml`） | `[ ]` |

| 51 | `trusted.hosts` | `TrustedHostsConfigurable` | `[ ]` |

| 52 | `vcs.log` | `VcsLogApplicationSettings.kt` / `FileHistoryUiProperties.kt`（`platform/vcs-log/impl/...`） | `[~]` **已实现前两项**：`ProjectSettings.vcsLog.{showTagNames,showRootNames}`（native `project_defaults` + `known_keys` 白名单 → bridge 类型 → 设置页「版本控制 › VCS 日志」（注册 `parentId="project.propVCSSupport.Mappings"`）两个勾选 → `VcsLog.vue` 的 `visibleRefs()` 按开关过滤 tag refs，数据不受影响）；仍缺 `SHOW_DIFF_PREVIEW`/`SHOW_ISSUE_PREVIEW_ON_HOVER`/`SHOW_DETAILS`（需先有对应 UI 元素） |



## TaoCode 现有设置节点



```

appearance

commit

editor

editor.codeStyle

editor.codeStyle.indents

editor.general

editor.general.appearance

editor.general.tabs

general

structure

templates

tools.actionsOnSave

```



## 已明确对应的（TaoCode 有落点）



| IDEA | TaoCode | 状态 |

|---|---|---|

| `editor.breadcrumbs` | 设置 › 编辑器 › 常规 › 面包屑（显示 + 位置 上/下/不显示） | `[x]` 全链路：native 键表/默认值/枚举校验 → bridge → 设置页 → 渲染（含下方位置） |

| `preferences.general` | 设置 › 外观与行为 › 系统设置（generalSettings 全套） | `[~]` |

| `AppearanceConfigurable`（appearance 页） | 设置 › 外观与行为 › 外观 | `[x]` 15/15 命名映射已核 |

| Editor 相关（EditorConfigurable / CodeStyle / Colors） | 设置 › 编辑器（含 代码风格 › 制表符与缩进、常规、编辑器标签页、保存时操作、外观） | `[~]` |

| `KeymapConfigurable` | 设置 › 外观与行为 › 快捷键（?） | 待核 |

| `PluginsConfigurable` | 插件对话框（已补搜索/分类/详情/安装/卸载） | `[~]` |



> 其余 50+ 项（Console / build.tools / editor.breadcrumbs / editor.stickyLines / http.proxy /

> preferences.externalTools / preferences.toDoOptions / project.scopes / settings.sync / trusted.hosts /

> vcs.log / advanced.settings / consents / diff.base / Runtime.Targets.Configurable …）逐项实现，

> 每项完成时把状态改为 `[x]` 并补落点文件。

---

## 放置位置校正（2026-09-27 本批，逐条有注册行证据）

本批对照 **EP 注册行**（`parentId` / `groupId` / `groupWeight`）把所有已实现设置页的位置核了一遍，
发现并修正 **11 处放错位置**（详细证据见 `docs/ui-placement-audit.md` §F）：

| IDEA 页/键 | 现在的位置 | 之前的位置（错） |
|---|---|---|
| `editor.breadcrumbs` | 编辑器 › 面包屑 | 项目结构 |
| `editor.stickyLines` | 编辑器 › 粘性行 | 项目结构 |
| `Errors`（检查） | 编辑器 › 检查 | 编辑器 › 常规 › 外观 |
| `Console` | 编辑器 › 控制台 | 外观与行为 › 系统设置 |
| `editing.templates` | 编辑器 › 实时模板 | 默认项目 › 实时模板 |
| `preferences.fileTypes` | 编辑器 › 文件类型 | （无设置页入口） |
| `preferences.toDoOptions` | 编辑器 › TODO | 项目结构 |
| `preferences.externalTools` | 工具 › 外部工具 | 外观与行为 › 系统设置 |
| `diff.base` | 工具 › 差异与合并 | 外观与行为 › 系统设置 |
| `build.tools` | 构建、执行、部署 › 构建工具 | 外观与行为 › 系统设置 |
| `vcs.log` | 版本控制 › VCS 日志 | 项目结构 |

结构修正：新增「构建、执行、部署」分组（`groupId="build"`，weight 30）；「版本控制」由**分组**改为
**顶层页面**（注册在 root、weight 45，本体是 `VcsManagerConfigurable`，提交/VCS 日志是它的子页）。

**未动**（诚实登记）：`structure`（IDEA 里项目结构是独立对话框）、`advanced`（IDEA 是 Registry 对话框）、
默认项目分组下未移植的页（Path Variables / Run Configurations …）。
