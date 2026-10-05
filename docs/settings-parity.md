# 设置（Configurable）对照清单



> 桃 2026-09-27 §10 #4「设置缺巨量核心逻辑」的逐项依据。

> IDEA 侧证据：`platform/**/resources/*.xml` 里 `<applicationConfigurable>` / `<projectConfigurable>` 的 `id`。

> IDEA 平台注册：**52** 个；TaoCode 设置节点：**12** 个。

---

## 2026-10-05 批：39 个 `[ ]` 的逐条判定

那一轮清单里有 **39** 项标着 `[ ]`。本批把它们**逐条查过**，发现它们其实是三种东西，
混在一起才显得"缺口巨大"：**真的没做**、**早就做了但清单漏登**、**依赖 IDEA 专有后端**。
本批新做 2 项、补登 9 项、剩下 28 项逐条写明"不做"或"未动"的理由（清单现在的状态分布：
`[x]` 15 / `[~]` 8 / `[ ]` 28，共 52）。

| 分类 | 数量 | 项 |
|---|---:|---|
| **本批新做** | 2 | `ide.audiocues`（三档 mode + **新增键** `audioCuesDisabled` 停用表）、`inlay.hints`（按 LSP `kind` 的三档，键名早就定好只是没登记） |
| **早已实现、清单漏登（本批补登记）** | 9 | `actions.on.save`、`editing.templates`、`preferences.editor`、`preferences.general`、`preferences.lookFeel`、`preferences.sourceCode`、`project.propDebugger`、`project.propVCSSupport.Mappings`、`reference.settings.ide.settings.file-colors` |
| **判定不做（IDEA 专有后端 / 前置缺失 / 形态不同）** | 15 | `RemoteServers`、`application.elevation`、`application.passwordSafe`、`consents`、`http.certificates`、`http.proxy`、`ijent.dashboard`、`preferences.customizations`、`preferences.language.and.region`、`preferences.pluginManager`（上游是顶层对话框不是设置页）、`preferences.updates`、`reference.idesettings.quicklists`、`reference.settings.ide.settings.web.browsers`、`reference.settingsdialog.IDE.editor.colors`（缺颜色方案这一层）、`settings.sync` |
| **本批未动（能做，但要一次更大的独立改动）** | 13 | `File.Encoding`、`Runtime.Targets.Configurable`、`editor.preferences.import`、`editor.reader.mode`、`fileTemplates`、`ide.date.format`、`preferences.editor.code.editing`、`preferences.externalDependencies`、`preferences.intentionPowerPack`、`preferences.keymap`、`preferences.pathVariables`、`preferences.startup.tasks`、`reference.settings.ide.settings.notifications` |

两条判据（本批一直照着做）：

1. **不放假控件** —— 没有后端 / 没有消费链路的项一律**不渲染**，登记理由而不是画一排空控件。
   本批两个新页都按这条裁过：`inlay.hints` 不渲染上游的"按语言分组 / 逐 case 明细 / 排除清单"
   （要"多个 provider"这一层），`ide.audiocues` 不渲染试听按钮（`AudioCuesConfigurable.kt:49`）。
2. **每项决策给上游 文件相对路径 + 行号** —— 没取到上游源码的项（`preferences.editor.code.editing`）
   就写"没取到"，**不猜**。

## IDEA 注册的 Configurable（平台模块）



| # | IDEA id | 实现类 | TaoCode 状态 |

|---:|---|---|---|

| 1 | `Console` | `ConsoleConfigurable` | `[x]` **已实现**：`foldConsoleLines`/`foldExceptions` 设置（native 键表+默认值+数组校验 → bridge → 设置页「编辑器 › 控制台」（注册 parentId="preferences.editor"））+ `src/consoleFold.ts` 纯函数 + 运行面板折叠渲染（×N）。**源码**：`platform/lang-impl/src/com/intellij/execution/console/ConsoleConfigurable.java:43-73` —— 内容是**两个 AddDeleteListPanel**：`console.fold.console.lines`（要折叠的控制台行）与 `console.fold.exceptions`（不折叠的例外），即**控制台行折叠规则**（不是字体/行数）。TaoCode 落地 = 新增设置 `foldConsoleLines`/`foldExceptions`（数组，native 校验 + bridge + 设置页列表）+ 输出面板渲染时按规则折叠重复行 |

| 2 | `Errors` | `ErrorsConfigurableProviderImpl` → `ErrorOptionsProvider` 扩展点 | `[x]` **已实现等价物**：设置 `showDiagnostics`/`showErrorStripe`（编辑器键表+默认值+兜底布尔校验 → bridge → 设置页「编辑器 › 检查」 → `CodeEditor.vue` 的 `lspExtensions()` 按开关包含 `linter`/`lintGutter`）。源码：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:1824`（id=Errors）、`.../profile/codeInspection/ui/ErrorOptionsProviderEP.java:9`（各语言扩展点，TaoCode 用 LSP 无此类扩展点） |

| 3 | `File.Encoding` | `FileEncodingConfigurableProvider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` **本批未动**：编码转换在宿主文件层（`native` 的 UTF-8/GBK/UTF-16 转换 + BOM），要真落地必须同时改 `file.read`/`file.write` 与 BOM 处理，不是设置页能单独兑现的一格 |

| 4 | `RemoteServers` | `RemoteServerListConfigurableProvider`（声明于 `platform/remote-servers/impl/resources/intellij.platform.remoteServers.impl.xml`） | `[ ]` **判定不做**：这一页编辑的是 SSH/SFTP 远程部署目标（`RemoteServerListConfigurable` → `ServerManager` 的持久化清单）。本仓没有远程执行通道，也没有凭据存储 —— 只做清单就是纯空壳 |

| 5 | `Runtime.Targets.Configurable` | `TargetEnvironmentsConfigurableProvider`（声明于 `platform/execution-impl/resources/intellij.platform.execution.impl.xml`） | `[ ]` **本批未动**：它管的是「目标类型注册表」（本地/Docker/WSL/SSH 各自一档，`TargetManager`）。本仓 `TargetChooserPopup` 只有本地进程一档，没有可枚举的第二类型，加下拉就是空选项 |

| 6 | `actions.on.save` | `ActionsOnSaveConfigurable$ActionsOnSaveConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1313-1318`） | `[~]` **已实现一段（2026-10-05 补登记）**：页面早已存在，只是清单漏登。节点 `tools.actionsOnSave`（`src/settingsTreeMeta.ts:129`，`groupId="tools"`）+ `SettingsDialog.vue:827` 的面板 + 设置 `formatOnSave`（native 编辑器键表）→ 消费点 `src/actionsOnSave.ts` 的 `runActionsOnSave`（`src/App.vue:1165` 落进 `save()`）。**只落上游四段里的 ① Reformat code**（`FormatOnSaveAction.kt:24-77`），② Optimize imports / ③ Rearrange / ④ Cleanup 各要自己的持久化开关与处理器，本仓没有 |

| 7 | `advanced.settings` | `AdvancedSettingsConfigurable`（IDEA 的 Registry 对话框） | `[x]` **已实现并可编辑**：「外观与行为 › 高级设置」列出 editor/general 的**全部内部键与当前值**，值为 **JSON 文本框**（非法 JSON 标红、「应用更改」按各自链路提交 editor→save / general→saveGeneral）+ 「复制为 JSON」+「仅供内部使用」警示 |：IDEA 的"高级设置"本质是**内部注册表编辑器**（Registry），TaoCode 没有注册表对话框，等价物是把它已升格为设置的内部开关集中成一个"高级设置"页（已有若干：`autoShowProcessPopup`、`presentationMode` 等），需要在页面里按 IDEA 的 Registry 条目逐条映射 |

| 8 | `application.elevation` | `ElevationSettingsConfigurable` | `[ ]` **判定不做**：它管的是 Windows 的 UAC 提权（以管理员身份重启 IDE）。宿主（WebView2 + 本地进程）没有这个动作，做一格勾选框无处可去 |

| 9 | `application.passwordSafe` | `PasswordSafeConfigurable` | `[ ]` **判定不做**：密码保险箱（`PasswordSafe` 服务 + KeePass/系统钥匙串后端）。本仓不持久化任何用户凭据，开这一页等于凭空造一个无处存密的输入框 |

| 10 | `build.tools` | `ExternalSystemGroupConfigurable.kt:22-58`（`:22-26` projectConfigurable/id=`build.tools`；`:31-55` 复选框 + ALL/SELECTIVE 单选 + `onApply`；`:58` `PREVIOUS_KEY`） + `ExternalSystemProjectTrackerSettings.kt:12-28`（三档语义） | `[x]` **已按源码重做**（2026-09-27）：旧实现是**应用级布尔** `buildToolAutoReload`（错作用域、错元数，桃点名「假逻辑」），现已换成**项目级** `ProjectSettings.buildTools = {autoReloadType, previousAutoReloadType, gradle}`（native 默认值 + `validate_build_tools` 三档校验 + 局部补丁 `merge_patch`；旧键从应用级键表移除并被 `prune_unknown` 剪掉，不做迁移 —— 它回答的是另一个问题）。UI = `src/components/BuildToolsSettingsPage.vue`（复选框 + 两档单选，关闭时单选 disable，等于 `:31-55`）。消费者 = `src/gradleHost.ts` 的 `onBuildFilesChanged`（三档纯函数 `shouldAutoReload` 在 `src/gradle.ts`；`diskSync` 只转交变化清单；`vcsActions` 的 `noteVcsUpdate()` 供 SELECTIVE 的「VCS 更新」那一条）。Gradle 页（`reference.settingsdialog.project.gradle`，`intellij.gradle.xml:177-179` groupWeight 110）作为它的子页见 §11 |

| 11 | `consents` | `ConsentConfigurable` | `[ ]` **判定不做**：GDPR/遥测同意记录（`com.intellij.ide.gdpr.ConsentConfigurable`，注册于 `intellij.platform.ide.impl.xml:986-988` `parentId="preferences.general"`）。本仓没有遥测上报，也就没有同意记录可写 |

| 12 | `diff.base` | `DiffSettingsConfigurable`（`platform/diff-impl/src/com/intellij/diff/settings/DiffSettingsConfigurable.kt:30-58`） | `[~]` **上下文行数已打通**：设置 `diffContextLines`（general 键表 + 默认 3 + 1..100 校验 → bridge → 设置页「工具 › 差异与合并」（注册 groupId="tools"） → native `git::diff`/`git::diff_sides` 加 `context` 参数拼 `-U<n>`，`git.diff`/`git.diffSides` 路由按 `params.context` 传入）。**调用点已接**：`SourceControl.vue:472-473` 的 `git.diff`/`git.diffSides` 调用现在带 `context: props.diffContextLines`（经 `ToolWindowView` 的 ctx 从 `generalSettings.diffContextLines` 传入），git 通道闭环；其余项（末尾跳下一文件 / `IncludeInNavigationHistory` / Merge 自动应用）待做 |

| 13 | `editing.templates` | `LiveTemplatesConfigurable` | `[x]` **已实现（2026-10-05 补登记）**：注册证据 `intellij.platform.lang.impl.xml:1000-1002`（`groupId="editor" groupWeight="130" id="editing.templates"`）→ 节点 `editing.templates`（`src/settingsTreeMeta.ts:107`，`parent: 'group:editor'`）+ 面板 `SettingsDialog.vue:964` + 页面 `src/components/TemplateSettingsPage.vue`（内置模板覆盖 + 自定义模板的增删改）。项目级设置 `ProjectSettings.templates`（native `validate_template_settings`）→ 消费点 `CodeEditor.vue:504` 的 `expandTemplateAt`（打字时展开）与 `:552` 的 `templateCandidates`（模板选择器） |

| 14 | `editor.breadcrumbs` | `BreadcrumbsConfigurable`（`platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsConfigurable.java:24`，UI 在 `BreadcrumbsConfigurableUI.kt:44-70`） | `[x]` **三项全实现**（本批校正）：① 显示开关 `showBreadcrumbs`（`EditorSettingsExternalizable.isBreadcrumbsShown:439-453`）；② 位置 `breadcrumbsPlacement: 'top'\|'bottom'`（`isBreadcrumbsAbove:420-430`，**只有上/下**，默认**下方** —— `OptionSet:91-92` `SHOW_BREADCRUMBS_ABOVE=false`；旧版把「不显示」编进这个键的第三态已按源码拆开，旧文件由 `bridge.ts` 的 `normalizeEditorSettings` 迁移）；③ 按语言开关 `breadcrumbsLanguages: {语言: 布尔}`（`mapLanguageBreadcrumbs:146-152` **只存显式配置过的语言**，未进表=显示，`isBreadcrumbsShownFor:459-466`），native 用 `validate_language_flags` 校验键必须是已知语言 id；消费点是编辑器上下两条面包屑的 `breadcrumbsOn(path)`。设置页按源码排布：总开关 → 位置单选（随总开关禁用）→ 每语言复选。**仍缺**：页底「配置面包屑颜色」链接指向颜色方案页（`ColorAndFontOptions.selectOrEditColor(context,"Breadcrumbs//Current",GeneralColorsPage)`），本仓没有色板/颜色方案页，登记在 `class-parity-todo.md`，不渲染假链接 |

| 15 | `editor.preferences.import` | `AutoImportOptionsConfigurable` | `[ ]` **本批未动**：上游按 import 种类分档（`AutoImportOptionsConfigurable` + `AutoImportOptions` 的 importOnPaste/importOnType 等）。本仓对应的 `src/autoImportNotifications.ts` 还没有可持久化开关，先开页就是没有出口的勾选框 |

| 16 | `editor.reader.mode` | `ReaderModeConfigurableProvider`（`intellij.platform.lang.impl.xml:819-822`，`order="after editor.preferences.import"`） | `[ ]` **本批未动**：阅读器模式要一整套「把 HTML/Markdown 重排成纯文本」的渲染（上游是 `ReaderModeProvider` 一族：`FontReaderModeProvider`/`LigaturesReaderModeProvider`…）。本仓只有 `src/distractionFreeMode.ts`（专注模式），两者不是一回事，不拿它顶替 |

| 17 | `editor.stickyLines` | `StickyLinesConfigurable.kt:7-20` | `[x]` **宿主能力已补并可用**：设置 `showStickyLines`（默认 true）+ `stickyLinesLimit`（默认 **5**，0..10 校验 —— EditorSettingsExternalizable.java:94 `STICKY_LINES_LIMIT = 5`；2026-10-04 续做轮把原先 3 的偏离订正回上游，前端 `src/settingsModel.ts` 与 native 默认值两处同步）→ 编辑器顶边叠加**粘性作用域行层**（`stickyLines` computed 从 LSP `documentSymbol` 里取包含当前光标行的符号链，按 startLine 升序取最内层 N 条）+ `.sticky-lines` 样式 + 设置页「编辑器 › 粘性行」（注册 parentId="preferences.editor"） |

| 18 | `fileTemplates` | `AllFileTemplatesConfigurable$Provider`（声明于 `platform/lang-impl/resources/intellij.platform.lang.impl.xml`） | `[ ]` **本批未动**：文件模板要在「新建文件」这条动作上套模板，本仓没有那个动作入口（只有实时模板 `editing.templates`，那是打字时展开）。先开页等于给一个不存在的流程配清单 |

| 19 | `http.certificates` | `CertificateConfigurable` | `[ ]` **判定不做**：SSL 证书信任库（`com.intellij.util.net.ssl.CertificateConfigurable`，注册于 `intellij.platform.ide.impl.xml:996-999` `parentId="preferences.general"`）。宿主没有通用 HTTP 客户端（出口只有 git 与插件市场两条固定通道），证书表无处可施 |

| 20 | `http.proxy` | `HttpProxyConfigurable` | `[ ]` **判定不做**：代理设置（`HttpConfigurable` 的 useProxy/host/port + PAC）。同上：本仓的网络出口是宿主里写死的两条通道，没有一个「所有 HTTP 请求」这一层可施加代理 |

| 21 | `ide.audiocues` | `AudioCuesConfigurableProvider`（`intellij.platform.ide.impl.xml:971-976`） | `[x]` **本批做完**：注册证据 `intellij.platform.ide.impl.xml:971-976`（`groupId="appearance" groupWeight="140" id="ide.audiocues"`）→ 节点 `ide.audiocues`（`src/settingsTreeMeta.ts`，`parent: 'group:appearance'`）+ 页面 `src/components/AudioCuesSettingsPage.vue`（照 `AudioCuesConfigurable.kt:27-61` 排布：mode 下拉 + `indent{}` 里逐 cue 复选 + 整档关掉时逐 cue 禁用）。两格**都是新落地的真设置**：① `audioCuesMode` 从两档扩到**三档 `auto`/`on`/`off`** = 上游 `AudioCuesMode`（`AudioCuesSettings.kt:75-79`；`isOn` 判定 `:85-89`，AUTO 的探针本仓用「支持屏幕阅读器」，见 `src/audioCues.ts:65-75`）；② **`audioCuesDisabled`（新增键）** = `AudioCuesSettingsState.disabledCues`（`:69-72`）的数组形态，六个 cue id 取自 `IdeAudioCues.kt:13-39`。两格都进了 `settingsModel.ts` + native `GENERAL_SETTING_KEYS`/默认值/`validate_general_patch`（含 cue id 白名单）+ 预览白名单 `src/bridgePreview.ts`；消费点 `src/audioCueHost.ts` 的 `cueAllowed`（`isCueEnabled`）**每一拍都读**。原先把 mode 的二选一下拉塞在 general 页里，与上游的独立页不符，已移走。**默认仍是 `off`**（上游默认 `AUTO`），差异写在 `settingsModel.ts` 的字段注释里。**不渲染**上游的试听（`AudioCuesConfigurable.kt:49` 的 `player.preview(cue)`） |

| 22 | `ide.date.format` | `DateTimeFormatConfigurable` | `[ ]` **本批未动**：日期/时间格式的渲染点在本仓散在 10+ 处（`toLocaleString('zh-CN')`），只开设置页而不改渲染点，得到的是一个「选了但什么都没变」的假开关。要做就得连渲染点一起改，超出单页范围 |

| 23 | `ijent.dashboard` | `IjentDashboardConfigurableProvider`（声明于 `platform/ijent/ui/resources/intellij.platform.ijent.community.ui.xml`） | `[ ]` **判定不做**：`ijent` 是 IntelliJ 商业后端的客户端模块（社区版只有空壳注册），本仓不接 IntelliJ 后端 |

| 24 | `inlay.hints` | `InlaySettingsConfigurableProvider`（`intellij.platform.lang.impl.xml:935-941`） | `[x]` **本批做完**：注册证据 `intellij.platform.lang.impl.xml:935-941`（`<projectConfigurable provider="…InlaySettingsConfigurableProvider" id="inlay.hints" parentId="editor" key="settings.hints" dynamic="true" groupWeight="1"/>`；页面类同款 id 见 `InlaySettingsConfigurable.kt:15,51`）→ 节点 `inlay.hints`（`src/settingsTreeMeta.ts`，`parent: 'editor'`）+ 页面 `src/components/InlayHintsSettingsPage.vue`。上游面板是**按 provider 的清单树**，逐节点开关是 `InlayProviderSettingsModel.isEnabled`（`platform/lang-api/.../settings/InlayProviderSettingsModel.kt:26`）；本仓的 provider 只有一个（LSP `textDocument/inlayHint`，宿主转发含 `kind`，见 `native/lsp_session.cpp:829-854`），那棵树塌成**按 kind 分的三档**，正是 `src/inlayHints.ts` 早就定好键名却一直没登记的那三把（`showTypeInlayHints`/`showParameterInlayHints`/`showOtherInlayHints`）。本批把它们接完：模型 + native `EDITOR_SETTING_KEYS`/默认值 + `src/previewSettings.ts` 白名单 + 消费点 `src/editorInlayHints.ts` 的 `createInlayHints({ toggles })`（**拉取时**按 `shouldShowInlayHint` 过滤）`CodeEditor.vue` 的注入与 watch（改开关重拉）。**不渲染**上游的按语言分组节点 / 逐 case 明细 / 排除清单（`ParameterHintsSettingsPanel.kt:18-22`）—— 它们要求「多个 provider / 文件类型」这一层 |

| 25 | `preferences.customizations` | `CustomizationConfigurable` | `[ ]` **判定不做**：`CustomizationConfigurable.java:18-23` 背的是 `CustomActionsSchema.getInstance()`（自定义动作的 XML 数据库，可增删改动作定义）。本仓没有这个存储层，做一棵树形编辑器只能渲染空壳 |

| 26 | `preferences.editor` | `EditorOptionsPanel` | `[~]` **已实现（2026-10-05 补登记）**：上游 `intellij.platform.lang.impl.xml:974-978`（`instance="…EditorOptionsPanel" id="preferences.editor" key="title.editor" order="after preferences.lookFeel" childrenEPName="com.intellij.editorOptionsProvider"`）→ 本仓节点键就叫 `editor`（`src/settingsTreeMeta.ts`，`parent: 'group:editor'`，label「常规」= 上游 `title.editor=General`），面板 `SettingsDialog.vue:900`（字体/自动换行）+ 五个子页（外观 / 编辑器标签页 / 智能键 / 代码折叠 / 装订线图标）。**键名差异是有意的**：`editor` 既是 `groupId="editor"` 分组同名、又是 `preferences.editor` 这页，本仓沿用短键以免与分组混淆（`tests/settings-tree-parity.test.mjs` 钉住了这一条） |

| 27 | `preferences.editor.code.editing` | `EditorCodeEditingConfigurable` | `[ ]` **本批未动**：注册行是 `intellij.platform.lang.impl.xml:979-982`（`groupId="editor" groupWeight="189"`），但**本批没取到该类的源码**（`EditorCodeEditingConfigurable.*` 在这份 checkout 里递归搜不到）。按铁律不猜：没有逐行的上游依据就不落页面 |

| 28 | `preferences.externalDependencies` | `ExternalDependenciesConfigurableProvider`（声明于 `platform/platform-impl/resources/intellij.platform.ide.impl.xml`） | `[ ]` **本批未动**：它列的是「项目引用了哪些外部库 + 有没有新版」（`ExternalDependenciesManager` 的收集/更新）。本仓的 `src/dependencyAnalyzer.ts` 是**只读**分析，没有可更新的版本源，先开页只会给一份看不了也点不动的清单 |

| 29 | `preferences.externalTools` | `ToolConfigurable`（`platform/lang-impl/src/com/intellij/tools/ToolConfigurable.java`） | `[x]` **已实现**：设置 `externalTools: {name, command}[]`（native 键表 + 默认空数组 + **逐条白名单/长度校验** → bridge → 设置页「工具 › 外部工具」（注册 groupId="tools"）（每行「名称|命令」））+ **消费点**：「工具 › 外部工具」子菜单（`toolsMenu.ts`，每项点击走 `runExternalTool()` → 与构建同一条 `run.start` 通道 + 输出面板） |

| 30 | `preferences.fileTypes` | `FileTypeConfigurable` | `[x]` **已实现**：设置页「编辑器 › 文件类型」（注册 `intellij.platform.lang.impl.xml:992-994` `groupId="editor" groupWeight="120"`），扩展名 → 语言 的表，可增删改；校验在 `src/fileTypes.ts`（与原生 `validate_file_associations` 同规则）；写的是 `ProjectSettings.fileAssociations`，与文件树/标签页右键的「关联文件类型」同一份数据，保存后按变更的扩展名重挂语言 |

| 31 | `preferences.general` | `GeneralSettingsConfigurable` | `[~]` **本体已实现（2026-10-05 补登记）**：节点 `preferences.general`（`src/settingsTreeMeta.ts`，`parent: 'group:appearance'`，label「系统设置」）+ 面板 `SettingsDialog.vue:1192`，覆盖 `GeneralSettingsState`（`GeneralSettings.kt:227-266`）全套 → 消费点在打开流程（`src/workspaceLifecycle.ts`）、执行门（`src/runActions.ts`）、关闭确认（`src/confirmations/*`）与宿主硬边界（`native/trusted_paths.cpp`）。**仍缺的是它的子页**（上游 `parentId="preferences.general"`）：`consents` / `ide.date.format` / `preferences.language.and.region` / `http.certificates` / `http.proxy` —— 逐条见各行 |

| 32 | `preferences.intentionPowerPack` | `IntentionsConfigurableProviderImpl`（`intellij.platform.lang.impl.xml:995-997`） | `[ ]` **本批未动**：`src/intentionSettings.ts` 的意图表已经是可用的真规则（消费者：Alt+Enter 的 `src/semanticActions.ts`、问题面板的抑制菜单），但它是**内存 `ref`**，没进 settings 键表。要开设置页得先把它接进持久化（模型 + native 键表 + 校验），那是一次独立的接线，不夹在本次两页里 |

| 33 | `preferences.keymap` | `KeymapPanel` | `[ ]` **本批不做**：上游 `KeymapPanel`（`intellij.platform.ide.impl.xml:951-953`，`groupId="root" groupWeight="65"`）的核心是**键位图差分**：从 `$default.xml` 出发展示「改过的 / 冲突的 / 未改的」，可搜索动作、双击改键、导入导出。`src/keymapBindings.ts` 是一张**静态**绑定表，没有「用户覆盖」这一层存储 —— 做一个只能看不能改的快捷键页，或临时加一张没进持久化的改键表，都是「看起来有、存不下来」。等键位覆盖真正进 settings 键表时再开 |

| 34 | `preferences.language.and.region` | `LanguageAndRegionConfigurable` | `[ ]` **判定不做**：`LanguageAndRegionConfigurable.kt:52-60` 的内容是 **IDE 语言包下拉 + 区域（Region）下拉**，背后是 `LocalizationStateService` 与 `RegionSettings`（决定插件市场按哪个区域筛）。本仓 UI 文案硬编码中文、没有资源包层，也没有插件市场的区域筛选 —— 两格都无处可去 |

| 35 | `preferences.lookFeel` | `AppearanceConfigurable` | `[x]` **已实现（2026-10-05 补登记）**：节点 `preferences.lookFeel`（`src/settingsTreeMeta.ts`，`parent: 'group:appearance'`，label「外观」）+ 面板 `SettingsDialog.vue:749`。主题 / 缩放 / 紧凑模式 / 树缩进 / 状态栏 / 对比度滚动条 / 色觉滤镜 / 界面字体字号 / 背景图 / 演示模式 / 菜单形态 全部落在 `EditorSettings`（native 编辑器键表）→ 消费点在 `src/rootAppearance.ts` 与 `src/style.css` |

| 36 | `preferences.pathVariables` | `PathMacroConfigurable` | `[ ]` **本批未动**：路径宏要一个**可编辑的变量存储**（`$PROJECT_DIR$` 之类）外加在所有路径解析处展开它。本仓的 `src/macros.ts` 是快捷键宏、`src/fileTemplateVars.ts` 是模板变量，都不是这一层；先开页就是一个改完没人读的表 |

| 37 | `preferences.pluginManager` | `PluginManagerConfigurable` | `[ ]` **形态不同，不是缺口**：上游把它注册成 `groupId="root" groupWeight="55"` 的**独立顶层对话框**（`intellij.platform.ide.impl.xml:978-985`），不是设置树里的一页。本仓的等价物是 `src/components/PluginDialog.vue`（搜索/分类/详情/安装/卸载，已具备）。把它塞进设置树只会造出第二个入口 |

| 38 | `preferences.sourceCode` | `CodeStyleSchemesConfigurable` | `[~]` **已实现子页（2026-10-05 补登记）**：节点 `preferences.sourceCode`（`src/settingsTreeMeta.ts`，`parent: 'group:editor'`，`expandOnly` —— 上游 `intellij.platform.lang.impl.xml:987` 的 `groupWeight=170`）+ 子页 `preferences.sourceCode.indents`（「代码风格 › 制表符与缩进」：缩进宽度 + 用不用 Tab 字符，两格都在 `EditorSettings` → 消费点是编辑器的缩进与软/硬 Tab 写入）。**仍缺**：代码风格的**方案（scheme）**机制 —— 上游可新建/复制/重命名/继承方案，本仓只有一份全局设置，没有方案这一层 |

| 39 | `preferences.startup.tasks` | `ProjectStartupConfigurable$ProjectStartupConfigurableProvider`（声明于 `platform/execution-impl/resources/intellij.platform.execution.impl.xml`） | `[ ]` **本批未动**：它管的是「项目打开时要跑的动作」（pre-startup task）。本仓的启动流程在 `src/workspaceLifecycle.ts` 与 `src/startupActivities.ts`，要先把「哪几条动作可配置」这件事定下来，否则这一页只能是一张没有出口的清单 |

| 40 | `preferences.toDoOptions` | `TodoConfigurable`（`platform/todo/src/com/intellij/ide/todo/configurable/TodoConfigurable.java` 的**模式表**，每行 = 正则 + `caseSensitive` + 颜色） | `[~]` **已补 `caseSensitive`**：`TodoPattern.caseSensitive`（默认 false）全链路 —— native `known_keys` 白名单 + 类型校验 → bridge 类型/映射（**原映射只带两字段会丢该值**，已修）+ 前端 malformed 校验 → `TodoPanel.markerMatches` 按开关切换 `i` 标志。**本批补上模式表编辑 UI**：设置页「编辑器 › TODO」（注册 `groupId="editor"`，`platform/todo/resources/intellij.platform.todo.xml:49`），可增删改「模式 / 说明 / 区分大小写」，校验在 `src/todoPatterns.ts`（与原生 `validate_todo_patterns` 同规则）。**仍缺**：模式表的**颜色**列（需要颜色方案页） |

| 41 | `preferences.updates` | `UpdateSettingsConfigurable` | `[ ]` **判定不做**：更新设置背后是 `ExternalUpdateManager`（IDE 版本检查 + 插件更新通道 + 重启安装）。本仓没有这条通道，开一页「自动检查更新」勾了也没有任何请求可发 |

| 42 | `project.propDebugger` | `DebuggerConfigurableProvider`（`intellij.platform.debugger.impl.ui.xml:75` `id="project.propDebugger"`；另有一条 `groupId="build"` 的 `XDebuggerSettingsConfigurable`） | `[x]` **已实现（2026-10-05 补登记）**：节点 `debugger`（`src/settingsTreeMeta.ts`，`parent: 'group:build'`，label「调试器」）+ 页面 `src/components/DebuggerSettingsPage.vue`，七格全部有真实消费点：`XDebuggerDataViewSettings`（隐藏 null / 按名排序 / 行内值 / 库帧 → `src/debugDataView.ts`、`src/debugInlineValues.ts`）与 `XDebuggerGeneralSettings`（移断点确认 / 停在断点取消静音 / 求值对话框形态 → `src/debugBreakpointMute.ts`、`src/components/DebugEvaluateDialog.vue`）。键在 native `GENERAL_SETTING_KEYS` + 默认值 + `validate_general_patch` 三处齐（判据 `tests/debug-settings-keys.test.mjs`、`tests/debug-data-view.test.mjs`） |

| 43 | `project.propVCSSupport.Mappings` | `VcsManagerConfigurableProvider`（`VcsExtensions.xml:172-176`，`groupId="root" groupWeight="45"`） | `[~]` **本体是顶层节点但没有目录映射（2026-10-05 补登记）**：节点 `project.propVCSSupport.Mappings`（`src/settingsTreeMeta.ts`，`parent: null`，`expandOnly`）下挂两个真页 —— 「提交」与「VCS 日志」（后者消费点 `VcsLog.vue` 的 `visibleRefs()`，见 §52）。**仍缺**：上游这一页的本体是**目录映射**表（`VcsManagerConfigurable` 的 root/submodule 映射），本仓的子模块与 worktree 由 git 自己管，没有这一层可映射，所以节点只做展开 |

| 44 | `project.scopes` | `ScopeChooserConfigurable`（`platform/lang-impl/src/com/intellij/ide/util/scopeChooser/ScopeChooserConfigurable.java:65-529`） | `[x]` **已实现**：注册在 `intellij.platform.lang.impl.xml:1825`（`groupId="appearance"` → 设置树「外观与行为 › 作用域」，`IdeBundle.properties:913 scopes.display.name=Scopes`）。① 模式语言：`src/scopes.ts` 逐分支复刻 `_ScopesLexer.flex`（**空白是有效字符**）、`PackageSetFactoryImpl.Parser:74-211`（`||`/`&&`/`!`/括号/`$引用`）、`FilePackageSetParserExtension`（`file:`/`ext:`）、`ProjectPathPackageSetParserExtension`+`ProjectPathPatternPackageSet`（`projectPath:`）、`FilePatternPackageSet.convertToRegexp:73-120`、Union/Intersection/Complement 的 `getText` 与优先级、`ScopeEditorPanel.doIncludeSelected/doExcludeSelected:545-609`；② 主从页 `ScopesSettingsPage.vue`：左列表（本地/共享 + 添加·删除·复制·另存为·上移·下移 + 唯一名「未命名N」）、右明细（通过 VCS 共享 + 模式框 + 错误消息与 `pos:N` + 「包含 N / 共 M 个文件」+ 文件树 + 包含/递归包含/排除/递归排除四个按钮 + 递归/部分包含图例）；③ 全链路：native `project_defaults`/`validate_project_patch` 的 `scopes` 键（形状校验，**故意不校验模式语法** —— `readScope:137-142` 允许存下解析不了的模式）→ `bridge.ts` 类型与预览校验 → `App.vue` 的 `saveScopes`；④ **消费点**：搜索面板的「范围」下拉（IDEA `FindPopupScopeUIImpl.java:59,137` 的 `ScopeChooserCombo`），结果按作用域精确过滤并重算文件数。**仍缺**（登记在 `class-parity-todo.md`）：预定义作用域（`CustomScopesProvider`）、`ScopeDescriptorProvider`/`SearchScopeProvider` 的分组条目（模块/库/问题/变更列表）、`ScopeEditorPanel.createTreeToolbar:647-679` 的树工具条（扁平化包子目录/显示文件/显示模块/过滤合法项/切换方言）、`ScopesStateService` 的每作用域 UI 状态（展开状态）、项目视图按作用域过滤 |

| 45 | `reference.idesettings.quicklists` | `QuickListsPanel` | `[ ]` **判定不做**：它管理的是「右键/工具栏的快速列表」，而快速列表能装的是**自定义动作**（同 `preferences.customizations` 的 `CustomActionsSchema`）。本仓没有这个存储层，做一个能拖动作进来的列表只能拖空气 |

| 46 | `reference.settings.ide.settings.file-colors` | `FileColorsConfigurable` | `[x]` **已实现（2026-10-05 补登记）**：节点 `reference.settings.ide.settings.file-colors`（`src/settingsTreeMeta.ts`，`parent: 'group:appearance'`，注册 `intellij.platform.lang.impl.xml:1341-1343` `groupWeight=112`）+ 页面 `src/components/FileColorsSettingsPage.vue`。两层开关（`fileColorsEnabled` / `fileColorsForTabs` / `fileColorsForProjectView`，照 `FileColorManagerImpl.java:75-106` 默认全开）在 `EditorSettings`；**两张颜色表是项目级**（`ProjectSettings.fileColors` 共享 / `localFileColors` 本地，照 `FileColorModelStorageManager.kt:27-38`），native 走 `validate_file_colors`。消费点：标签页着色与项目视图着色（`src/fileColors.ts`），优先级 = 数组顺序（`FileColorsModel.findConfigurationWithScopeFilter:247-260` 首个命中就返回） |

| 47 | `reference.settings.ide.settings.notifications` | `NotificationsConfigurableProvider`（`intellij.platform.ide.impl.xml:965-968`） | `[ ]` **本批未动**：通知设置的上游形态是「分组 + 每组的显示条件（LOG 级别/静默规则）」，那套状态存在通知中心里。本仓的通知（`src/notifications.ts`、`src/progressNotices.ts`）只有一条通道、没有分组存储；先开页只能勾一些没有效果的复选框 |

| 48 | `reference.settings.ide.settings.web.browsers` | `BrowserSettings`（`intellij.platform.ide.impl.xml:1305-1307`，`groupId="tools"`） | `[ ]` **判定不做**：它配置的是 `BrowserLauncher` 的一整套 JDK 家族与策略（用哪个 JDK 打开、每个 family 各自的路径/环境变量、是否警告）。本仓打开外链只有 `shell.openUrl` 一条，直接交给系统默认浏览器，没有「浏览器档案」这一层可管 |

| 49 | `reference.settingsdialog.IDE.editor.colors` | `ColorAndFontOptions` | `[ ]` **判定不做（前置缺失）**：这一页是**颜色方案页**，而本仓没有颜色方案（`ColorScheme`）这一层 —— 语法着色的颜色是散在 `src/editorTheme.ts` / `src/editorSemanticColors.ts` 里的固定值。缺了方案层就做不出「方案下拉 + 逐项改色 + 导出导入」，只做几行改色输入框也是半吊子（同 §14 面包屑颜色、§40 TODO 颜色列一起登记在 `class-parity-todo.md`） |

| 50 | `settings.sync` | `SettingsSyncConfigurableProvider`（声明于 `platform/settings-sync-core/resources/intellij.settingsSync.core.xml`） | `[ ]` **判定不做**：IDE 设置同步要账号体系 + `SettingsSync` 服务 + 冲突合并。本仓已有的是本地导入/导出（`src/settingsTransfer.ts` 与 `app.exportSettings`/`app.importSettings`），那是同一条思路的离线形态，不等于同步服务 |

| 51 | `trusted.hosts` | `TrustedHostsConfigurable` | `[x]` **已实现**：注册行同上游（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:783-786`，`groupId="appearance"`）→ 设置树「外观与行为 › 受信任位置」（节点登记在 `src/settingsTreeMeta.ts`）。清单编辑器 `src/components/TrustedLocationsSettingsPage.vue`（列表 + 添加/移除/改信任状态 + 文件夹选择器，挂进 `src/components/SettingsDialog.vue` 的 `trusted.hosts` 页），纯规则在 `src/trustedProjects.ts`（`trustedLocationRows`/`addTrustedLocation`/`removeTrustedLocation`/`setTrustedLocationState`，判据 `tests/trusted-locations.test.mjs`）；清单本体 = 应用级 `generalSettings.trustedPaths`，与打开流程（`src/workspaceLifecycle.ts`）、执行门（`src/runActions.ts`）和宿主硬边界（`native/trusted_paths.cpp`）读的是同一份。**仍缺**：上游清单是两个存储的并集（用户手管 `TrustedPathsSettings` + 确认框勾「不再询问」写进 `TrustedPaths`）并带 Windows Defender 排除项勾选，本仓只有一个存储、无 Defender 集成；文件级信任（`TrustedFiles`）不在此页 |

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
