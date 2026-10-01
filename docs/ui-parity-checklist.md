# UI 对照清单（IDEA ↔ TaoCode）与差距核对

参照 IDEA 源码位置（本机 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：

| 区域 | IDEA 类 |
|---|---|
| 主窗口顶部工具栏 | `platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/MainToolbar.kt` |
| 主菜单 | `platform/platform-impl/src/com/intellij/openapi/wm/impl/IdeMenuBar.kt` |
| 右侧工具窗口条 | `platform/platform-impl/src/com/intellij/openapi/wm/impl/Stripe.java` / `StripeButton.java` |
| 提交工具窗口 | `platform/vcs-impl/src/com/intellij/vcs/commit/ChangesViewCommitPanel.kt`、`CommitActionsPanel.kt` |
| 状态栏 | `platform/platform-impl/src/com/intellij/openapi/wm/impl/status/IdeStatusBarImpl.kt`、`PositionPanel.kt`、`EncodingPanel.java`、`LineSeparatorPanel.java`、`ReadOnlyAttributeWidgetFactory.java` |
| 设置对话框 | `platform/platform-impl/src/com/intellij/openapi/options/newEditor/SettingsEditor.kt`、`ConfigurablesListPanel.kt`、`SettingsFilter.kt` |
| 欢迎页 | `WelcomeScreenVerticalToolbar.kt`、`ProjectsTabFactory.kt`、`RecentProjectPanel.java` |

状态标记：**已实现** / **部分实现** / **仅占位** / **缺失**；✅ = 本轮修复完成并验证。

---

## 区域 A · 主窗口（图 3）

### A1 顶部工具栏 `MainToolbar.kt`

- [x] **部分实现** 品牌区 `brand "TaoCode"`（App.vue:3304）。
- [x] **已实现** 主菜单组（App.vue:3305-3315，键盘导航/勾选态/分隔符/最近项目）。
- [x] **已实现** 全局搜索入口 `command-box`（App.vue:3316）。
- [x] **已修（第二十六批，源码核对 `headertoolbar/ProjectToolbarWidgetAction.kt:118-297`）** **项目 widget**：顶栏主菜单右侧给出「项目名 ▾」按钮（文案 = 项目名 :165-166，tooltip = 项目根路径 :167），弹层按 IDEA 的两个分组列出 **已打开的项目 / 最近的项目**（`ProjectConceptBundle.properties:22-23` 原文），行内显示项目名、路径、分支（`ProjectToolbarWidgetPresentable.branchName`，`ReopenProjectAction.kt:48`），顶部搜索框按 **名称+路径** 过滤（`ProjectWidgetSpeedsearchFilter:367-372`），列表先取前 `MAX_RECENT_COUNT=100` 再分组（:98、:262-276），组为空则整组隐藏（:121-124 无子项时不开弹层）。逻辑抽到 `src/toolWindows.ts` 兄弟模块 `src/projectWidget.ts`，`tests/project-widget.test.mjs` 6 条覆盖。
  - **有意偏差（已核实）**：IDEA 的 tooltip 用 `FileUtil.getLocationRelativeToUserHome` 把路径相对到用户主目录（:167）；渲染进程拿不到用户主目录，TaoCode 显示绝对路径（信息更多，不是缺失）。IDEA 行内的 `status`（"1 window" 等）来自远端项目动作，本地 `ReopenProjectAction` 未覆写 `status` → 默认 null（:547-549），故不渲染，与 IDEA 一致。
  - **有意偏差**：分组名沿用 IDEA 原文的中文，「项目」无障碍前缀取 `project.widget.accessible.name.prefix`（:133）。
- [x] **已修（第三十八批，源码核对 `headertoolbar/FilenameToolbarWidgetAction.kt:49-181` + `PlatformActions.xml:825-853` + `EditorTabPresentationUtil.kt:72-75` + `PlatformFrameTitleBuilder.kt:69-96` + `StringUtil.shortenTextWithEllipsis` + `UIUtil.java:1843-1846`）** **主工具栏三段结构补全**：IDEA 的 `MainToolbarNewUI`（`PlatformActions.xml:839-853`）由三段组成 —— `MainToolbarLeft`（项目 widget + 通用动作组）、**`MainToolbarCenter`（`main.toolbar.Filename`）**、`MainToolbarRight`（`SearchEverywhere` + `SettingsEntryPoint`，运行 widget 由 `ExecutionActions.xml:117-119` 插到 `anchor="first"`、分支 widget 由 VCS 模块插在运行 widget 之前）。此前 TaoCode 缺的正是**中央的文件名 widget**，本批补上：
  - **可见性照源码**（`:53-60`）：`editorTabPlacement != TABS_NONE && !fullPathsInWindowHeader` 时隐藏。TaoCode 的编辑器标签**恒在顶部**、没有 Placement 设置，所以可见条件落到 `fullPathsInWindowHeader`（该键早已存在、已有真实消费方=原生窗口标题）；`filenameWidgetVisible(…)` 的 `tabsHidden` 参数保留并在单测里覆盖 IDEA 的另一个可见分支。
  - **名称**取 `getUniquePresentableNameForUI`（`:81` → `EditorTabPresentationUtil.kt:72-75`）：同名文件只有**一个**时就是文件名，重名时取**最短的唯一路径后缀**。IDEA 用工程索引算唯一性（`UniqueVFilePathBuilderImpl.kt:52-54`），TaoCode 没有索引 → 用 IDEA 为此保留的「仅在已打开编辑器范围内唯一」变体（`:56-64`），即与所有已打开标签比较。
  - **标注**（`:139`）：`shortenTextWithEllipsis(name, 60, 30)`（27 字符 + `...` + 末 30 字符）；`fullPathsInWindowHeader` 打开且路径≠名称时追加 ` [路径]`。
  - **颜色**（`:63-73`）：按文件 VCS 状态着色 —— `FileStatus.ADDED/MODIFIED/DELETED` 三色沿用提交图例的同一组 token（`--success`/`--accent`/`--error`），不在变更列表里的文件用默认前景（IDEA 的 `UNKNOWN`/`NOT_CHANGED` 回落，`:75-78`）。状态来自已有的 `git.status` 变更表（原生已返回 `changes`，无需新通道），保存成功后刷新一次（对应 IDEA `FileStatusManager` 的变更通知）。
  - **点击**（`:94-102`）：弹出**最近文件**列表（历史去掉第一条 = 当前文件；只有一条时不弹，与 `createPopup` 返回 null 一致），每行图标 + 文件名 + 状态色，点击打开。
  - **中键 / Shift+左键关闭当前文件**（`:118-131` + `UIUtil.java:1843-1846` 的 `isCloseClick(e, MOUSE_RELEASED)`）。
  - 逻辑抽到 `src/filenameWidget.ts`，`tests/filename-widget.test.mjs` **18 条**覆盖。
  - **有意偏差（已核实）**：IDEA 的 tooltip 是 `FrameTitleBuilder.getFileTitle`，其中 `fullPathsInWindowHeader` 打开时取 `file.presentableUrl`（`/` 分隔的呈现路径）；TaoCode 用编辑器/其它面板一致的路径形式（`PlatformFrameTitleBuilder.kt:81` 的 `presentableUrl` 语义等价）。
- [x] **已核实（第三十八批）** 右侧图标组：主题切换/设置/帮助三键 + `SearchEverywhere`（`command-box`）+ `SettingsEntryPoint`（设置按钮）已在位；**分支 widget**（`main.toolbar.git.Branches`）与**运行 widget**（`NewUiRunWidget`）在第二十批已实现于 `topbar-widgets`。至此 `MainToolbarLeft/Center/Right` 三段与两个插件贡献项全部对上 IDEA，无缺口。
- [x] **已修** ~~仅占位 `version-tag "FOUNDATION 0.1"`~~ 已删除（含 style.css 两处样式）。

### A2 编辑区

- [x] **已实现** 编辑器组（分屏/标签/拖拽/预览标签）App.vue:3430-3450。
- [x] **已实现** 面包屑 + 保存状态 + Markdown 预览切换（App.vue:3455）。
- [x] **已实现** Markdown 分屏渲染、二进制/图片查看器。
- [x] **已修（第四十二批，源码核对 `GotoNextErrorHandler.java:64-208` + `BaseGotoNextErrorAction.java:22-63` + `PlatformActions.xml:609-617` + `$default.xml:658-660,679-681` + `SeverityRegistrar.java:47` + `HighlightSeverity.java:124-125` + `LspDiagnosticsCustomizer.kt:80-85` + `HintManagerImpl.java:606-624`）** **下一个 / 上一个高亮错误（F2 / Shift+F2）**：IDEA 的 `GotoNextError` / `GotoPreviousError` 此前**完全没有实现**（编辑器里按 F2 无任何反应），而它在 Navigate 菜单里是一条常驻项。本批按源码补齐：
  - **位置与键位照源码**：`<group id="GoToErrorGroup">` 在 Navigate 菜单里紧跟 Go to Line、在 Jump to Last Change 之前（`PlatformActions.xml:609-617`），键 = F2 / Shift+F2（`$default.xml:658-660`、`:679-681`；macOS `System Shortcuts.xml:425,430`），文案取 `ActionsBundle.properties:708-711`（「Next/Previous Highlighted Error」）。菜单行只在「当前文件有可用的高亮」时可用 —— 对应 `BaseGotoNextErrorAction.isValidForFile:52-54`，在 TaoCode 就是 `lspReady`（该文件有在跑的语言服务器）。
  - **严重度分层**（`gotoNextError():64-91`）：从最高级别往下走、**第一个有内容的级别独占**，所以文件里只要有一条错误，F2 就永远跳过更近的警告。级别顺序用 `HighlightSeverity` 自身的比较值（ERROR 400 > WARNING 300 > WEAK_WARNING/INFO 200 > SERVER PROBLEM 100 > TEXT ATTRIBUTES 11 > INFORMATION 10，`HighlightSeverity.java:124-125`、`:193-195`），`SHOWN_SEVERITIES_OFFSET = 2` 砍掉最后两级（`SeverityRegistrar.java:47`），默认 `goesToErrorsFirst = true`（`DaemonCodeAnalyzerSettings.java:17`）。→ TaoCode 侧映射到 LSP severity 有**权威依据**：IDEA 自带 LSP 客户端把 LSP Error→ERROR、Warning→WARNING、**其余全部**→WEAK_WARNING（`LspDiagnosticsCustomizer.kt:80-85`），因此恰好是 1 / 2 / (3|4) 三层，被 offset 砍掉的两级 LSP 根本产生不了。
  - **前/后向的严格比较**（`isBetterThan():116-132`）：前向 = 光标之后**最近**的一条，没有则回绕到文件里第一条；后向 = 光标之前**最近**的一条，没有则回绕到最后一条。两处都是"严格"的（前向判据 `caretOffset < offset`，后向分支偏好不满足 `caretOffset <= offset` 的那一侧）——所以光标**正好落在**一条高亮上时，F2 继续往后、Shift+F2 往回走，不会原地不动。相同偏移的两条按文档顺序取靠前的那条（`isBetterThan` 只在**严格**更优时替换）。
  - **落点与滚动**（`navigateToError():165-198`）：清掉选区与多光标（`selection: { anchor }`）、光标居中（`scrollIntoView(..., { y: 'center' })`，对应 `ScrollType.CENTER_DOWN/UP`）、落点所在的折叠区自动展开（`:178-179`，用 `foldedRanges` 找包含落点的折叠区间再 `unfoldEffect`）。
  - **无高亮时的提示**（`:134-163`）：在光标行**上方**给一个轻量标签（`HintManagerImpl.java:611` 的 `ABOVE`），任何按键 / 文本改动 / 滚动即消失（`:624` 的 `HIDE_BY_ANY_KEY | HIDE_BY_TEXT_CHANGE | HIDE_BY_SCROLLING`）。IDEA 的文案 `no.errors.found.in.this.file`（`InspectionsBundle.properties:152`）。
  - 逻辑抽到 `src/gotoNextError.ts`（纯函数、无 Vue/DOM），`tests/goto-next-error.test.mjs` **16 条**覆盖（含分层、严格比较、两端回绕、同偏移并列、输入不被改写，以及"菜单入口 ↔ 编辑器命令名 ↔ 键位"的源码级双向断言）。
  - **未做（有意，不是无后端）**：`:136-142` 的另一个分支——分析尚未结束时报「Error analysis is in progress」并在 `daemonFinished` 后重试。TaoCode 的 `lspDiagnostics` 在 `lsp.open` 时就给文件建了键（`App.vue` `startLsp`），空数组无法区分「已发布且无问题」与「还没发布」，没有「分析已完成」这个信号就实现不了，不猜。
  - **有意偏差（已核实）**：`:200-208` 的 `navigationShift` / `isAfterEndOfLine` 那笔 `+1` 在 TaoCode 不需要——LSP 诊断不带"行尾之后"标志，而 `lspPosition` 会把越过行尾的字符位置夹到行尾，落在的正是 IDEA 那条 `charAt(start) != '\n'` 判据为假、shift 取 0 的同一个偏移上。
- [x] **已修（第四十二批，源码核对 `$default.xml:846-851` + `@codemirror/lint` 6.9.7 的 `lintKeymap`）** **F8 一键两用（真实缺陷）**：CodeMirror 的 `basicSetup` 内置 `lintKeymap`，把 **F8 绑成了 `nextDiagnostic`**；而 IDEA 的 F8 是 **Step Over**（`$default.xml:849-851`，在 TaoCode 由窗口级 `dapStep('next')` 执行，见 `App.vue` 的 `dapState.paused` 分支）。调试暂停、编辑器有焦点时按 F8 会**同时**单步并把光标拽到该文件的第一条 lint 诊断上、还弹出它的提示气泡。已在 `basicSetup` **之前**加一条 F8 绑定把库的那条遮掉（CodeMirror 的 `keymap` 是普通 facet，扩展列表里靠前者得键；且它只 `preventDefault`、不 `stopPropagation`，所以窗口级的调试单步照常收到这个键）。

### A3 侧边工具窗口条

- [x] **已实现** 左侧活动条（11 个按钮含 active/disabled 态，App.vue:3318-3340）。
- [x] **已修（第五批，源码核对 `Stripe.java` + `ToolWindowAnchor.java` + `UIBundle.properties`）** 右侧 Stripe 竖条 + 工具窗口重定位：每个工具窗口记住自己的停靠边（left/right，localStorage 持久化，损坏回退；**载入时拒绝历史遗留的 `bottom`**，因为底区是输出面板不是工具窗口停靠位）；面板头部 ⋮ 菜单（移动到左侧/右侧 + 隐藏，文案取 UIBundle `tool.window.move.to.*` / `hide` 原文）；锚在右侧的面板渲染到右侧镜像栏，右缘窄条列出所有右侧工具窗口（行为与左 activity bar 一致）。**锚到底部**仍由拖放完成（`onToolDrop('bottom')`），与 IDEA 的 `DockToolWindow` 拖放等价。
- [x] **已修（第三十一批，源码核对 `toolWindow/ToolWindowHeader.kt:203-256,345-368` + `MaximizeToolWindowAction.java:26,36,45-63` + `ToolWindowPane.kt:544-560` + `$default.xml:885-887`）** **工具窗口头部交互**：两处重复的头部代码合并为 `src/components/ToolWindowHeader.vue`（IDEA 每个工具窗口正好一个 `ToolWindowHeader`），并按源码实现四种手势 —— 单击**激活并把焦点送进内容**（`:212-235` 的 `fireActivated` + `requestContentFocus`，**不**像条纹按钮那样再次点击收起）、双击**最大化/恢复**（`:242-248`）、中键或 **Shift+左键**隐藏（`:219-226` + `UIUtil.java:1843-1846`）、右键/齿轮打开该窗口自己的菜单（`:215-217`、`:345-368` 的 `ShowOptionsAction` 显示 `gearProducer.get()`）。菜单项顺序照 `ActiveToolwindowGroup`（`PlatformActions.xml:652-664`）：隐藏 → 最大化/恢复 → 移动到左/右，四个 `Hide*` 动作在 TaoCode 收敛为一个 隐藏（每侧只有一个窗口，可见性就是每侧的开关）。**最大化**对应 `ToolWindowPane.kt:544-560` 的 `stretch`：dock 撑满整宽、编辑器列与嵌在其中的底部面板被挤掉（纯 CSS，不写状态，所以恢复就是移除这个类），快捷键 **Ctrl+Shift+'**（`$default.xml:885-887 control shift QUOTE`；macOS 也是 ctrl 而非 ⌘，`macOS System Shortcuts.xml:394-396`）。同时清掉一个真实缺陷：条纹按钮右键原本只写 `toolMenu = id`，若该窗口不是当前显示的那个就**没有任何界面响应**（状态写了但菜单不渲染），现在改为先激活再开菜单。
- [x] **已修（第五批）** 工具窗口头部 ⋮（见上一条，第三十一批已升级为完整 `ToolWindowHeader`）。

### A4 提交工具窗口 `ChangesViewCommitPanel.kt`

- [x] **已加（第六十七批）** 书签的**行文本锚与编辑后对账**：一次删掉整行 ⇒ 越界的书签被丢（记在会话内的"丢掉表"里），撤销让原文回到同一行号 ⇒ 放回去；同一行只留一条（上游 `isDuplicate:517-530`）。落点 `src/bookmarks.ts` 的 `reconcileBookmarks` + `src/bookmarkActions.ts` / `src/lspNavigation.ts` 的变更接线（审计 §BM）。
- [x] **已修（第六十七批）** 项目树**偶发空白**：`refreshTree()` 原来在**全应用的** `busy` 为真时**静默放弃**且不排队 —— 打开项目那一串里正好 busy，这次刷新就被丢掉，`workspace.entries` 停在 `[]`，项目视图一片空白（切一次左视图才恢复，那时 busy 已落下、`showView` 又刷了一次）。改成**自己的忙标 + 排队**（`src/editorSideViews.ts`：`treeBusy`/`treeAgain`，放弃时置 `treeAgain` 而不是丢）。验证：新起 3 个实例，开项目视图后树都是 8 行、名字齐全 ✓（面板**关着**时 0 行是正常的，不是缺陷 —— 这一轮一半时间花在把这两种情况分开上）。
- [x] **已修（第六十八批）** 大工程上语言服务卡死不再"只能重启应用"：`lsp.stop` 改走**就地**通路（不排那条可能卡死的队列）→ 原生换掉卡住的线程并重配；前端状态查询加 10s 上限，没响应就先重启再重来一次。真机取证（13904 个 .java 的真工程：`app.memory` 15ms 回、三个 lsp.* 请求 30s 不回）与三处结构性缺陷写在审计 §BO；判据 `tests/lsp-completion-startup.test.mjs` + `tests/lsp-thread.test.mjs`。
- [x] **已补完（第六十九批）** 上一条的**端到端复验**跑完，而且**更深根因定死了**：不是锁死，是**出站帧的阻塞写落在语言服务线程上**（`WriteFile` 到不读 stdin 的 JDT + 4KB 管道），线程一停，`status`/`open`/诊断/折叠全部排队 —— 这才是「语言服务没响应」的真身。已改：出站帧走**专写线程**（调用方只入队）、两条管道 4KB→1MB、弃养的一代按代号收掉它的服务器进程（`native/lsp_children.*`）。红/绿判据 `lsp_host_test`（`--stall-stdin=3000`：旧行为堵 3006ms / 新行为 <500ms 且帧仍送达）+ `lsp_children_test`；真机复验（同一个 3GB 工程）：状态查询 259–265ms 全回包、页面零「没有响应」提示、全程 1 次 `initialize`、握手后第一帧是 85KB 的 `didOpen`、请求全部出帧、退出无孤儿 java.exe。取证与数字见审计 §BP。
- [x] **已补完（第七十一批）** 书签的**自动描述**（书签面板那一行显示什么）与它顺带暴露的真缺陷：`text`（第六十七批加的行文本锚）没进原生校验白名单，**带锚的书签一律存不进去**（`Unknown field: text` → 弹「书签未能保存」，项目设置里 `bookmarks` 一直是空的）。修完的面板行按 2026.2 的 `ui/tree/LineNode.kt:20-31` 渲染成 `行号: 那一行原文`；真机取证（F11 → 无失败提示 → 项目设置里有 `text` → **重启后照旧**）与上游规则更正（截断长度是 50 不是 200、`getAutoDescription` 在快照里是死代码）写在 `docs/inventory/verdict-bookmarks.md` §C①。
- [x] **已补（第七十五批）** 书签装订线那一侧：悬停文本按上游 `GutterLineBookmarkRenderer.getTooltipText:56-72` 拼（`书签 [助记键][: 描述][ (键)]`）、图标可点（点击 = ToggleBookmark）、**中键 = EditBookmark**（新增「书签描述」对话框，预填当前描述、清空即回到"用行原文"）。真机取证：三个图标的悬停文本分别是 `书签 A` / `书签: Small scratch…` / `书签: 940`；中键弹的对话框预填 `940`，改成「改过的描述」点确定 → 持久化 `{"description":"改过的描述","line":6,…}` 且悬停文本立刻跟着变；左键点图标 → 弹「已取消书签 README.md:2」、图标少一个。
- [ ] **待查（第六十九批遗留，非本仓缺陷）** 大工程上的**语义结果**仍取决于 JDT 自己能不能把工程导入做完：该工程的 `AE2-refs/*` 有十几个 Gradle 子工程，机器代理没开时 buildship 逐个同步失败（`.metadata/.log` 里成片 `ForgeGradle … Connect to 127.0.0.1:7890 failed`），导入未完时 JDT 对 `foldingRange`/`documentSymbol` 就是不回答（客户端 60s 期限如实回 `TIMEOUT`）。要在**能联网/Gradle 能同步**的工程上再验一遍语义结果（补全/跳转/诊断）。
- [x] **已定论并修掉（第七十批）** 撤销（Ctrl+Z）**会**触发内容变更通知 —— 挡住的不是撤销，是 `CodeEditor` 里一道闸门：`emit('change')` 被 `if (!dirty)` 包着，只在"变脏那一拍"发一次，于是**第二次以后的编辑**（撤销只是最容易看见的那种）就再也不通知宿主，挂在 `change` 上的东西全部静默：书签对账（上游 BookmarkManager 监听的是每个文档变更）、断点位置缓存失效、最近更改位置、markdown 预览刷新、草稿与自动保存重排。证据两面：① 撤销本身是带 changes 的事务 —— CodeMirror 6.11.1 的 history `pop` 派发 `state.update({changes: event.changes, …, userEvent: "undo"})`（`node_modules/@codemirror/commands/dist/index.js:548-556`），所以 `update.docChanged` 为真；② 真机复验（探针记 `reconcile` 调用，跑完已撤）：打开 8 行的 README.md → 第 3 行 F11 → `Ctrl+Y` 两次 → `Ctrl+Z`，对账记录 **3 条**（8→7 行、7→6 行、撤销回 7 行）—— 修之前只有第一条。**改动**：闸门去掉、`emit('change')` 每次变更都发；组件里那个只服务于闸门的 `dirty` 与 `markSaved`（宿主两处调用点 + `EditorTab.ts` 的接口成员）一并删除。判据 `tests/editor-change-notify.test.mjs`（4 条：闸门绝迹、撤销事务形状、宿主侧按文件+行去重、程序化替换不通知）。
  另外记两条**探针姿势**（这一轮踩了很久，已写进 memory）：工具窗口的活动条**合成 `MouseEvent` 点不动，要 `el.click()`**；连点两次会把它关掉 —— 判断"要不要点"必须先读 `.explorer-panel` 的 `clientHeight`。**新增两条**：项目树的行是 `.explorer-panel button.tree-entry`（路径在 `title`，不是 `[data-path]`），且**展开根节点要先把按钮 `focus()` 再发 → 键**；markdown 文件上 `elementFromPoint` 命中的是预览层的 `<p>`，**点击进不了编辑器** —— 键盘取证一律走 `document.querySelector('.cm-content').focus()` + `Input.dispatchKeyEvent`（Ctrl+Home/方向键定位光标）。
- [x] **已起域（第六十六批）** B5 = `ide/bookmarks` 5 类：判决 `docs/inventory/verdict-bookmarks.md` + 门控 `tests/b5-verdict.test.mjs`（覆盖率从扫描件重推、引用要落在真文件上）。五条全 `[~]`，缺口按 §G 行内逐条写明（编辑后重锚 / 描述与书签类型 / 列表项富渲染），§C 三条是下一批。
- [x] **已收口（第六十五批）** B4（`codeInsight/folding` 69 类）`[ ]` 归零：`FoldingPolicy`/`FoldingUtil` 判 `[~]`（逐函数有落点），`CollapseBlockHandler`/`CodeFoldingZombie`/`FoldingHintMouseMotionListener` 判 `[-]`（语言侧 EP、注册表后的模型缓存、装订线折叠轮廓区本仓没有对应形态）—— 依据逐条写在判决 §G 与审计 §BK。
- [x] **已加（第六十四批）** 折叠状态**落盘**：写进项目级设置（`ProjectSettings.foldingState`），杀进程重启后打开同一文件折叠原样回来；原生新增 `native/folding_state_schema.cpp` 校验形状与上限（50×40、签名 ≤96），前端按"最近动过的"裁到 20×30（判决 §C③，审计 §BJ）。
- [x] **已加（第六十三批）** `caretInsideRange` 接进默认折叠（光标严格落在区间里就不折，上游 `shouldExpandNewRegion:236-238`）；「全部收起/展开」的两段式经分析在本仓退化成一段（`keepExpandedOnFirstCollapseAll` 是语言侧钩子），依据写进判决 §G（审计 §BI）。
- [x] **已加（第六十二批）** 折叠状态的存/取与重算：关标签/换文件前存档、区间到手后按偏移+签名恢复（区间被编辑推走的按签名认回）；文档一变重算时先存后删失效项、"用户展开过"的块活在重算里。落点在 `src/editorFoldingState.ts` + `src/editorFoldingController.ts`（判决 §C③⑤，审计 §BH）；**缺**落盘那半。
- [x] **已加（第六十一批）** 设置页「编辑器 › 代码折叠」：`Import`（默认开）与 `自定义折叠区域`（默认关）两条真开关 —— 打开发文件时按 LSP `kind` 预折叠、改了一键重算；上游另外三个开关只有语言侧 builder 读（本仓没有），不渲染（判决 `docs/inventory/verdict-folding.md` §G，审计 §BG）。
- [x] **已修（第六十批）** 编辑器折叠动作族：Code 菜单「折叠」子菜单（13 条，照 `FoldingGroup` 顺序与 `ActionsBundle` 文案）+ 常驻 keymap 的 9 条键位（`Ctrl+-`/`Ctrl+=`/`Ctrl+Shift+-`/`Ctrl+Shift+=`/`Ctrl+Alt±`/`Ctrl+.`/`Ctrl+Shift+.`/`Ctrl+*`），命令实现在 `src/editorFolding.ts`（挑目标规则逐条照上游；判决 `docs/inventory/verdict-folding.md`，审计 §BF）。
- [~] **已修（第五十二批修正过）** 变更树头部 `sc-changes-head`：现在只剩「折叠/展开 ⌄」这一个按钮（amend 勾选框已按上游搬去与图例同一行）。**位置待判**：上游 `ChangesView.CommitToolbar` 那一行才是 amend + 消息历史，折叠按钮该在哪一行还没有引文，登记在 `docs/source-todo.md` §16。
- [x] **已修（第五十二批按上游改正）** 提交信息框：**消息区自己不带工具条** —— 上游非模态面板用的是 `CommitMessage(project, withSeparator=false, showToolbar=false, …)`（`CommitMessage.java:118-155`），所以原先那行「提交信息 + 三个图标按钮」整行删掉；消息历史按钮（`Vcs.ShowMessageHistory` = 「提交消息历史记录」，点击列出 git.log 最近 12 条 subject 可复用）搬去与提交图例同一行，与 amend 勾选框相邻；placeholder = `commit.message.placeholder` = **提交消息**（原先是自造的「默认信息」）。判据 `tests/scm-panel-strings.test.mjs`。
- [x] **已修** 底部动作条 `sc-actions`：`提交(N)`（N=已暂存数）+ `提交并推送(P)`（带 ahead 徽标），Ctrl+Enter / Ctrl+Shift+Enter（:336-339, commit()/commitAndPush()）。
- [x] **已修（第二十五批，源码核对 `CommitStatusPanel.kt:19-78` + `CommitLegendPanel.kt:36-68` + `ChangeInfoCalculator.kt:7-26` + `VcsBundle.properties:304-306`）** **提交图例**：提交工具条同一行的右端显示**已暂存**变更的分类小计（新增/修改/删除，各带颜色 —— 对应 `FileStatus` 属性），计数按 git index 状态字母分类（A/? → 新增，D → 删除，其余 M/R/C/T/U → 修改，对应 `Change.Type` 的 NEW / MODIFICATION|MOVED / DELETED）；全空时不渲染（:33 `isPanelEmpty`）。宽度不够时自动切**紧凑形式**（`+N *N −N`，`format()` :38-39,58 的字面量），判据 = 全串实测宽度 > 面板给它的宽度（`adjustLegendToFitPanel` :63-78），并用 `ResizeObserver` 复现 `componentResized` 的重算（:33-37）。逻辑抽到 `src/commitLegend.ts`，`tests/commit-legend.test.mjs` 7 条覆盖。
  - **未做（有意）**：registry 开关 `vcs.non.modal.commit.legend.compact`（`registry.properties:802`）是开发者 registry 项、不是用户设置，TaoCode 无 registry 界面，不额外造一个假设置；自动紧凑（registry=false 的默认路径）已完整实现。
- [x] **已修（第二十七批，源码核对 `NonModalCommitWorkflowHandler.kt:156-159,177-184` + `NonModalAmendCommitHandler.kt:51` + `CommitProgressPanel.kt:80-85,316-328` + `VcsBundle.properties:17-19`）** **提交前检查与拒绝原因**：IDEA 的提交按钮只要求「有 VCS + 没有正在执行的提交」（`isReady()` :156-159），**不**因「没有暂存文件 / 没有提交信息」而禁用；真正的原因在点下之后由 `checkCommit()`（:177-184）判定，并以错误色标签显示在提交按钮上方（`buildErrorText()` :321-328，文案 `选择要提交的文件` / `指定提交消息` / `选择要提交的文件并指定提交消息`（中文包原文））。本轮照此改：提交/提交并推送按钮只在 `busy` 时禁用、提交信息框不再因「未暂存」而禁用（IDEA 允许先写信息再选文件），点击后才判定并显示原因；信息或暂存集变化即清除标签（`clearError()` :316-319 + 文档/包含监听 :146-156）。逻辑抽到 `src/commitCheck.ts`，`tests/commit-check.test.mjs` 6 条覆盖。
  - **有意偏差（已核实）**：IDEA 的 `isEmptyMessage = getCommitMessage().isBlank()` 无条件要求信息非空；TaoCode 的「修改上次提交」允许留空并走原生 `--no-edit` 沿用原信息（原生 `git.cpp` 既有行为、placeholder 已说明），故 `amend` 时豁免「必须有信息」。
- [x] **已修（第二十八批，源码核对 `CommitAuthorComponent.kt:38-121,124-137` + `VcsUserUtil.java:24-46` + `NonModalCommitPanel.kt:74-81`）** **提交作者行**：检查标签与动作按钮之间显示 `By <作者>`（`label.by.author`，`VcsBundle.properties:329`；行内文案 = `getShortPresentation` 短名，tooltip = `Name <email>`），点击打开作者编辑器覆盖**本次提交**的作者（原生 `git commit --author=`，邮箱缺失/含控制字符直接拒绝），有覆盖时显示「已覆盖」并可用 × 移除（对应 `removeAuthorAndDate` :117-120），切项目清空覆盖。原生新增 `git.user` 读 `user.name`/`user.email` 并进工作线程白名单；原生测试覆盖「覆盖生效 + 仓库配置不变 + 两种非法覆盖被拒」。
  - **未做（有意）**：IDEA 的 `VcsDateViewer` 还能显示并改写提交日期（`--date`）；TaoCode 未做日期编辑，只显示/覆盖作者 —— 日期改写属低频操作，且需另加原生参数与日期控件，本轮不做（不是无后端，是有意缩范围）。
- [x] **已修（第五十/五十一批，源码核对 `RunCommitChecksExecutor.kt:14-29` + `CommitProgressPanel.kt:284-291,394-471,492-521` + `AbstractCommitWorkflowHandler.kt:226-237` + `NonModalCommitWorkflowHandler.kt:229-233` + `SaveCommittingDocumentsVetoer.kt` + 中文包 `VcsBundle`/`ActionsBundle`/`GitBundle`）** **提交检查的入口、失败行与「仍然提交」**：检查收成一处（`src/commitChecks.ts`，提交 / 提交并推送都走它；TODO 预检原先在两处各写一遍）；「只运行检查」**没有常显按钮** —— 上游入口是**失败行**上那把 `RerunCommitChecksAction`（`AllIcons.General.InlineRefresh`，提示 `tooltip.rerun.commit.checks` = 重新运行提交检查），而失败行只在检查报出 failure 之后才可见；检查失败后提交按钮改名 `action.commit.anyway.text` = 「仍然提交」，按下去**跳过检查**直接提交；提交期间弹「在提交期间保存文件」（`save.committing.files.confirmation.*` 原文：「立即保存」/「延迟保存」）。真机取证（空信息 ⇒ 错误行「指定提交消息」；超长主题 ⇒ 失败行「提交信息：主题行不能超过 72 个字符」+「仍然提交(1)」+ 通知「提交 检查失败」；重跑 / 改信息复位 / 仍然提交真提交都走通）见 `docs/ui-placement-audit.md` §AW。
- [x] **已修（第五十二批，源码核对 `VcsActions.xml:396-408` + `NonModalCommitPanel.kt:100,104-107` + `CommitMessage.java:118-155` + `ToggleAmendCommitModeAction.kt:29-33,55-60` + `ToggleAmendCommitOption.kt:18-23` + `AmendCommitHandlerImpl.kt:52,76-105` + `$default.xml:1057-1059` + 中文包 `VcsBundle`/`ActionsBundle`）** **amend 与消息区的形状/文案/位置**：勾选框文案 = `checkbox.amend` = 「修正(M)」、浮层 = 标题 + Alt+M（上游那枚复选框没有描述）、与「消息历史」按钮一起放在**图例那一行**（`ChangesView.CommitToolbar`）；一开 amend 就把**上次提交的信息**填进输入框、退出时还原草稿（`setAmendMessage`/`restoreBeforeAmendMessage`，新模块 `src/amendMessage.ts`）；**删掉两处上游没有的控件/文案**：「回滚提交信息」按钮（连带那套 localStorage 持久化）与自造的占位文本「默认信息」。系统化核法（面板全部中文文案 × 中文包 95030 条取值）与真机取证见 `docs/ui-placement-audit.md` §AX。
- [x] **已修（第五十三批，源码核对 `VcsActions.xml:416-425,49-52` + `intellij.platform.vcs.dvcs.impl.xml:80-86`）** **面板那一行的内容**：上游本地变更工具窗口那一行是 `VcsToolbarActions`（更新项目 / 提交 / 切换提交界面 / 推送 / 比较同版本 / 文件历史 / 回滚）。本仓这一行只留我们真有的两个 —— 「更新项目」（`Vcs.UpdateProject`，先 fetch 再整合，Ctrl+T 进提示）与「推送」（`Vcs.Push`，Ctrl+Shift+K 进提示）；原来重复放在这里的「获取/变基/储藏/弹出」（上游位置 = Git 菜单，本仓已有）与「历史」（上游位置 = 日志工具窗口，本仓已有）都删掉，连同面板里那份自造的提交历史列表。见 `docs/ui-placement-audit.md` §AY。
- [x] **已修（第五十四批，源码核对 `ChangesTree.java:725-744,752-762` + `TreeActionsToolbarPanel.java:53-54` + `intellij.vcs.git.backend.xml:108,303-333,418-428` + `VcsActions.xml:394-395` + 中文包 `ActionsBundle`）** **变更树头部 + 分支/比较两行 + reformat 键位**：变更树头部换成上游那对头部动作「全部展开 / **全部收起**」（文案取 `action.ExpandAll.text` / `action.CollapseAll.text`，语义 = 收起分组里的行、组节点留着）；面板里 新建/合并/删除分支 与 与分支比较 两行删掉（上游位置 = 分支弹窗，本仓 `src/branchPopup.ts` 已有；比较结果列表仍在面板，触发点回到弹窗）；提交信息框接上 Alt+L（= `ReformatCode` 的键位）。见 `docs/ui-placement-audit.md` §AZ。
- [x] **已修（第五十五批，源码核对 `intellij.platform.vcs.log.impl.xml:274-284` + `intellij.vcs.git.backend.xml:108,400-428` + `ChangesTree.java` 一族的头部动作 + `GitUncommitAction.update` + 中文包 `ActionsBundle`/`GitBundle`）** **日志窗口的提交行右键菜单**（`Vcs.Log.ContextMenu`）：本仓此前没有右键菜单，这一批按上游两组建起来 —— 复制修订号 / 将当前分支重置到此处… / 撤消提交…（只对当前分支最后一个提交可用，灰着时给上游那句理由）/ 新建标记…；没有后端的条目（补丁、提交↔提交比较、`git revert`、交互式变基那一族、以提交为起点开分支、图的父子导航）逐条记在 `src/vcsLogMenu.ts` 里，不建空壳。真机取证见 `docs/ui-placement-audit.md` §BA（顺带修掉一个真缺陷：菜单最初用 `position: fixed`，被带 transform 的祖代挪走 ⇒ 改成面板内绝对定位）。
- [x] **已修（第五十六批，源码核对 `intellij.vcs.git.backend.xml:320-344` + `GitDeleteRefAction.kt:29` + 中文包 `GitBundle`）** **标签那一行的收尾**：删除标签放到**日志窗口引用 chip 的右键菜单**里（上游 `Git.Branch.Backend` 那一族按引用类型过滤，`GitDeleteRefAction` 对 `GitTag` 走 `deleteTag`；本仓 `logRefMenu` 只给标签这一列，其余类型不开菜单）；面板里那条自造的「新标签名 + 新建标签 + 标签 chips」整行拆掉（新建在提交菜单、删除在引用菜单、列表=日志行的引用 chip），连带 `tags`/`loadTags`/`tagsError` 与那套 CSS 一并清掉。见 `docs/ui-placement-audit.md` §BB。
- [x] **已修（第五十七批，源码核对 `NonModalCommitWorkflowHandler.kt:270-291,302-321` + 中文包 `VcsBundle`）** **失败通知的两个动作 + 补上一个真缺陷**：面板的通知此前**根本没接上**（`ToolWindowView.vue` 里 `<SourceControl>` 没有绑 `@notify` ⇒ emit 被静默丢弃，提交结果/检查失败那些通知一条都没显示过）；现在绑到 `ctx.notifyFromPanel`（ctx 新增该通道与 `showToolWindow`，后者 = 宿主的 `showView`）。失败通知按上游带动作：「显示详细信息」（= 激活提交工具窗口，`showCommitCheckFailuresPanel`）与「仍然提交」（只在提交路径那条通知上，点了走跳过检查直接提交）。见 `docs/ui-placement-audit.md` §BC。
- [x] **已修（第五十八批，源码核对 `GoToParentOrChildAction.kt:47-54,63,69-95,110-115` + `VcsLogBundle.properties:14-17,65-68`）** **日志的「转到子提交 / 转到父提交」**：候选 = 可见图里相邻的行（本仓：父 = 该提交 `parents` 里已加载的，子 = 已加载里以它为父的）；父/子各自按候选是否为空决定可用性；多候选按上游格式逐候选补一行；跳转走既有的 `jump`；上游没有默认键位 ⇒ 不编。见 `docs/ui-placement-audit.md` §BD —— §17 全部收口。
- [x] **已实现** 变更列表分组/勾选/hunk 级暂存（原有）。
- [x] **已修（第三十四批，源码核对 `ShowNotificationCommitResultHandler.kt:24-129`）** **提交结果通知**：提交结束后发一条通知，标题 = 最差结果 + 计数（「提交失败：N 个错误」/「提交完成，但有 N 个警告」/「已提交 N 个文件」/「没有文件已提交」，文案取 `VcsBundle.properties:103/104/952`），正文按 `getCommitSummary`（`:100-116`）的顺序列出提交信息 → feedback → 失败原因，且**每次提交只留最新一条**（`:97 expirePreviousAndNotify` → `notify()` 的 `displayId`）；TODO 检查被拒绝等同 `onCancel`（`:29-31`）发一条空正文「提交已取消」。逻辑抽到 `src/commitNotification.ts`，`tests/commit-notification.test.mjs` 10 条覆盖。
- [x] **已修（第三十六批，源码核对 `vcs/commit/message/BaseCommitMessageInspection.kt:144-157` + `SubjectLimitInspection.kt:19,25-36` + `BodyLimitInspection.kt:26,32-57` + `SubjectBodySeparationInspection.java:28-68` + `ReformatCommitMessageAction.java:54-59`）** **提交信息检查**：提交框在信息框下方列出三类问题 —— 主题行超过右边距（默认 72）、正文行超过右边距、第 2 行不为空（主题与正文之间没有空行）；每条给出**行号**（点击即选中 IDEA 高亮的那一段）、**超出部分的原文**、以及与该检查一一对应的快捷修复（`换行`/`插入空行`/`重新格式化提交信息`，fix 组合照 `:35`、`:54-55`、`:33-35`）。判据与 IDEA 完全一致：`end > start + rightMargin`，范围 = `TextRange(start + rightMargin, end)`（`:151-155`，只标出超出的那一段而不是整行）；按 UTF-16 计数（IDEA 的 `Document` 是 UTF-16，代理对算 2 个字符）。开关/边距/输入时换行在**设置 › 版本控制 › 提交**页。逻辑抽到 `src/commitMessageInspection.ts`，`tests/commit-message-inspection.test.mjs` 17 条覆盖。
  - **更正（第二十一批的偏离，本批改回源码语义）**：第二十一批把「重新格式化提交信息」实现成「去行尾空格 / 压缩空行 / 去首尾空行」——读源码后确认这不是 `Vcs.ReformatCommitMessage` 的行为：`ReformatCommitMessageAction.reformat`（`:54-59`）只是依次调用**每个启用的检查自己的** `reformat`，即 `BodyLimitInspection.reformat`（按右边距折行正文，`:63-65`）与 `SubjectBodySeparationInspection.reformat`（主题后补空行，`:47-49`）；它**不改主题行**（`SubjectLimitInspection` 未覆写 `reformat`）、也不做空白规整。整条信息的首尾空白由提交路径的 `CommitMessage.getComment()`（`CommitMessage.java:300-302` 的 `trimTrailing`）与 `message.trim()` 负责。本批已改成源码语义，按钮提示同步为「在主题后补空行、按右边距折行正文」。
  - **未做（有意）**：`显示右边距`（`VcsConfiguration.USE_COMMIT_MESSAGE_MARGIN` 默认 true，`:73` → `CommitMessage.java:338-339 setRightMarginShown`）要求提交框是等宽字体才有确定的列位置（IDEA 的提交框是 `EditorTextField`、用编辑器字体），TaoCode 的提交框是比例字体 `<textarea>`，画出来是发明出来的位置；把提交框改成等宽字体属外观决策，未擅自改。超出内容改为逐条显示原文，信息不缺。
  - **未做（有意）**：`settings.commit.postpone.slow.checks`（`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS` 默认 true，`:151`）会把 TaoCode 唯一的提交前检查（TODO 确认框）挪到提交之后，改变该确认框的含义，不是移植；`checkbox.clear.initial.commit.message`（`CLEAR_INITIAL_COMMIT_MESSAGE` 默认 false，`:131`）的"不清空"分支在 IDEA 是恢复变更列表自带的默认信息（`AbstractCommitMessagePolicy.kt:47-53`），TaoCode 没有这个概念，可观察结果与现有行为相同。

### A5 状态栏 `IdeStatusBarImpl.kt`

- [x] **已修** 左侧当前文件 widget `status-file`（项目名 › 相对路径）。点击 = IDEA 的 **Alt+F1 `SelectIn` 目标列表弹窗**
  （2026-09-28：不再是"直达文件树"，`src/components/SelectInPopup.vue` + `src/selectIn.ts`，证据与六个落点登记在 `docs/class-parity-todo.md` §12.1）。
- [x] **已修** 缩进 widget（`4 个空格`/`制表符`，点击打开设置编辑器页）。
- [x] **已修** 诊断计数改为常驻（0 也显示，IDEA 行为）。
- [x] **已实现** 行/列、CRLF/LF 点击转换、编码点击重读、只读切换、分支+ahead/behind。
- [x] **已修（第四批，源码核对 `InfoAndProgressPanel.kt:115-260,725-830`）** 进度指示器：原生新增 `git.progress` 事件（入队/出队/排空/停止四处发布真实队列深度与运行标志，错误路径也会归零）；状态栏内联"后台任务 N"旋转指示器，点击弹层列出每个运行中任务（Git 操作含队列明细 / 项目克隆含最新进度行 / 构建运行），弹层带 aria-expanded 与 reduced-motion 适配。
- [x] **已修（第七批，补读 `ProcessPopup.java:64-150`）** 弹层每行取消按钮（见上）。
- [x] **已修（第三十二批，源码核对 `IdeStatusBarImpl.kt:313-323,579-596,863-872,874-880,901-902,952-962` + `FocusStatusBarAction.kt:10-21`）** **状态栏键盘导航**：左右方向键在状态栏 widget 间移动焦点（`RIGHT`/`LEFT` 被加进遍历键 `:317-322`）、到两端**回绕**（`getComponentAfter` 兜底到第一个 / `getComponentBefore` 兜底到最后一个，`:955-959`）、只遍历「可见且启用」的 widget（`:901-902`，禁用项被跳过而非只挡激活）、顺序就是视觉从左到右（`:874-880` 的 leftPanel → 进度面板 → rightPanel 按 `gridx`）；新增「聚焦状态栏」动作（`FocusStatusBarAction.kt:10-21` → `focusFirstWidget :863-872`，焦点已在状态栏内则不动），Esc 走 `restoreFocusToPreviousComponent`（`:579-596`：记住的焦点失效时退回编辑器组件）。**Space/Enter 激活聚焦的 widget**（`:566,573-576`）在 DOM 里由原生 `<button>` 等价满足，不重复绑定（已在 `src/statusBarNav.ts` 注释写明）。逻辑抽到 `src/statusBarNav.ts`，`tests/status-bar-nav.test.mjs` 9 条覆盖。
  - **有意偏差（已核实）**：IDEA 把 `FocusStatusBar` 放在 `ToolbarPopupActions` 组（`PlatformActions.xml:1366`），由 `CustomizationUtil.java:567-568` 注入**工具栏自定义**弹层 —— 它不是菜单项。TaoCode 没有工具栏自定义界面，因此只登记为**可搜索动作**（Shift+Shift 的动作搜索里以「窗口 › 聚焦状态栏」出现），不塞进窗口菜单，与既有「书签数字跳转只在动作列表里」的处理一致。

---

## 区域 B · 设置对话框（图 1）`SettingsEditor.kt` — ✅ 本轮重构

- [x] **已修（第二十九批升级，见文末）** 顶部搜索框 `settings-filter`（SettingsDialog.vue）：按页名+选项名过滤左树（"缩进"能找到"编辑器"页）、无结果时搜索框转红、Ctrl+F 定位、点进非空框全选、Esc 清空（再按一次关窗）、粘贴 `文件 | 设置 | …` 路径直达、当前页匹配选项聚光灯高亮并居中第一个、面包屑右键复制设置路径。
- [x] **已修（第三十七批，源码核对 `ui/SearchTextField.java:64-69,119-124,173-195,233-235,284-288,318-336,351-354,417-461` + `SettingsSearch.java:25`）** **搜索框历史**：查询按「最近在前」保存到 `taocode.settingsSearchHistory`（与 IDEA 的 `PropertiesComponent` 同一个**换行分隔**格式），上限 5 条，重复项忽略大小写、已被移到顶部的再次输入不写入；记录时机 = **失焦**、**打开历史前**、**选中某条历史后**（三处与 `:233-235`、`:425-426`、`:417-423` 一一对应）。搜索框左侧图标可点开**下方的历史列表**（单点即开，对应 `:119-124` 的可点击前导区；无历史时只聚焦），列表最多 5 行、上下键移动选中、Enter 采用、Esc 逐级退出（弹层 → 过滤 → 关窗，对应弹层 `setRequestFocus` 抢焦点在前）。Alt+↓ 打开列表、Alt+↑ 上一条（`:64/:487-490` 与 `:183`）。逻辑抽到 `src/searchHistory.ts`，`tests/search-history.test.mjs` 12 条覆盖。
  - **有意偏差（已核实）**：IDEA 的 `reset()` 不裁剪载入的历史（`:318-336`），而弹层只显示 `min(size, 5)` 条（`:351-354`）却用完整列表做 Alt+↑↓ 循环；本项目在载入时即裁到 5 条（唯一写入方就是这个框，超长不可达），避免复刻这个不可达的不一致。
  - **未做（有意）**：New UI 的**行内历史补全**（`JTextField.Search.InplaceHistory`，`:314`）由 LaF 的 `TextFieldWithPopupHandlerUI` 实现（输入框内灰字补全 + Tab/右方向键采纳）；不确定的按键语义不瞎猜，历史弹层已覆盖同一需求。
- [x] **已修** 左侧层级树：`外观与行为 › 外观`、`项目 › 项目结构/实时模板`、`版本控制 › 提交`（第三十六批新增，IDEA 位置 `CommitDialogConfigurable.kt:66-77`）、`编辑器`（顶层）——组可折叠（ChevronDown 旋转），映射 `ConfigurablesListPanel`。没有后端的分类（按键映射/插件/构建…）**不渲染空壳**，注释写明原因（:36-49）。
- [x] **已修（第三十九批，源码核对 `options/newEditor/SettingsNewBadgeState.kt:19-56` + `SettingsNewBadgeRecorder.kt:10-19` + `SettingsTreeView.java:536-540,674-680,791-794`）** **「新选项」点标记**：带**新增选项**的设置页在左树显示一个圆点，**打开过一次即消失**并永久记住。规则逐条照源码：
  - 计数器按页持久化，键就是 IDEA 自己的 `settings.new.badge.shown.count.<id>`（`Recorder:10`），"已看过"= `MAX_SHOWS = 1`（`:11`），不可读的值一律当"从未显示"（`PropertiesComponent.getInt(key, 0)`）。
  - 只有声明为 `Configurable.NewOptions` 的页才有资格（`State:53-56`）——本 IDEA checkout 里**唯一**实现者是 `EditorAppearanceConfigurable.kt:69-72`（设置 › 编辑器 › 常规 › 外观），其选项集（行号/缩进参考线/空白符号/外观）落在 TaoCode 的**编辑器**页。
  - **记录时机**：树选中该页时记录（`SettingsTreeView.java:536-540` 的 `fireSelected`），包括**打开对话框时的那次初始选中**（`SettingsEditor.java:410 treeView.select` → 同一链路）→ TaoCode 用 `watch(section, …, { immediate: true })` 覆盖所有进入该页的路径（点击 / 后退前进 / 搜索跳转 / 初始页），只在**确实未看过**时才写存储。
  - **绘制规则**（`:791`）：`hasNewOptions && (leaf || !expanded)` —— 叶子页常显，组节点只在**折叠**时显示（`State:32-36` 的向上传播，让折叠的组能提示"里面有新东西"）；右侧对齐的圆点 + 无障碍文本 `badge.text.new`（`IdeBundle.properties:3355`）。
  - 逻辑抽到 `src/settingsBadge.ts`，`tests/settings-badge.test.mjs` **10 条**覆盖（含 key/阈值/传播/折叠规则/幂等标记/坏值回落）。
  - **未做（有意）**：行级 `Badge.new`（`EditorAppearanceConfigurable.kt` 里 `checkBox(myCbSmoothBlinkCaret)` 等**具体新选项**旁的 `icon(Badge.new)`）——TaoCode 没有"平滑光标闪烁/光标动画缓动"这两行，不给不存在的选项挂徽标。
  - **有意偏差（已核实）**：`beta` 徽标（`SettingsTreeView.java:781-784` `Badge.beta`）与 `promo` 图标（`:786-789` `asPromo`）需要各 configurable 自带的数据，TaoCode 的页面没有，不渲染。
- [x] **已修** 面包屑 `settings-breadcrumb` + 后退/前进箭头（导航历史 history/future，`goBack()/goForward()`，:118-135）。
- [x] **已修** 底部 `确定 / 取消 / 应用(A)` 三键 + Alt+A 快捷键 + 应用仅在有改动（`editorDirty`）时可用 + 左下帮助图标与项目级设置说明。
- [x] **已修（第三十六批，源码核对 `CommitDialogConfigurable.kt:56-101` + `CommitMessageInspectionsPanel.kt:69-79,149-162` + `SubjectLimitInspection.kt:25-31` + `BodyLimitInspection.kt:32-48`）** **版本控制 › 提交页**：提交信息检查三项开关（限制主题行长度 / 限制正文行长度 / 主题与正文之间需要空行）+ 两个右边距数字框（0–10000，对应 `spinner(0..10000)`，默认 72）+ 「输入达到右边距时自动换行」（`ApplicationBundle.properties:450`）。IDEA 的这套选项在 `Settings › Version Control › Commit` 面板里（profile 名 `Commit Dialog`，随 `vcs.xml` 保存 + 检查明细面板）；TaoCode 没有 inspection profile 基础设施，故把同一组选项做成一个页面。值存 `taocode.commitMessageInspections`，点“应用/确定”生效并即时作用于提交框。
- [x] **已修（第三十六批）** 应用/确定语义修正：IDEA 的 Apply 提交改动但**不关窗**，只有 OK 关窗 —— 原先两个按钮共用同一个会关窗的保存回调。现在保存回调带 `close` 参数：应用(A)/Alt+A 只应用不关窗，确定 保存成功后关窗（保存失败仍保持打开并显示错误）。
- [x] **已修（第二批，源码逐项核对）** 外观页真实控件：**缩放**（`uiZoomPercent`，50–400% + 重置，App.vue watch 设根字号→整体缩放）、**紧凑模式**（`compactMode`→`html[data-density=compact]` 覆写 6 个密度变量：控件高度/标签条/标题栏）、**完整路径标题**（`fullPathsInWindowHeader`→原生 `SetWindowTextW` 显示项目根路径，打开与 settings.update 均实时生效）。三项均持久化（`settings.update` 通道 + `projects.cpp` 校验）。
  控件来源逐项核对：`AppearanceConfigurable.kt:287-319`（缩放+重置）、`:425-433`（紧凑模式）、`:435`（完整路径）、文案取自 `IdeBundle.properties:609/611/1258/1259/1301`。
- [x] **已修（第三批，源码核对 `AppearanceConfigurable.kt:528-536`）** 树视图组：**显示缩进参考线**（`showTreeIndentGuides`，FileTree 每层级边界 1px 垂直线，周期随缩进步长动态计算）、**使用更小的缩进**（`compactTreeIndents`，15px→11px/层）。设置外观页新增"树视图"组，随"应用"保存并即时生效。
- [x] **已修（第六批，源码核对 `AppearanceConfigurable.kt:423-469`）** UI 选项组（可接真实效果的部分）：**平滑滚动**（`smoothScrolling`→根元素 `scroll-behavior`，IDEA"整个界面平滑滚动而不是逐行跳"原文）、**在菜单项中显示图标**（`showIconsInMenus` 默认 true 与 UISettings 一致→关闭时菜单图标列隐藏、标题左移）。两键走完整持久化链。
- [x] **已修（第九、十批，源码核对 `AppearanceConfigurable.kt:136-148,565-580`）** **左侧并列布局**（`leftSideBySide`：左停靠区在当前工具窗口下方保留项目视图，独立 FileTree 实例 + 分隔线）、**右侧并列布局**（`rightSideBySide`，右侧同款）、**宽屏工具窗口布局**（`wideScreenSupport`：底部面板最大高度限为窗口 40%，切换时立即重算；IDEA 说明见 `IdeBundle:2794`）。三键走完整持久化链。
- [x] **已修（第十批，回归）** 启动崩溃 rc `0xC0000409`：`queue_git_request`/`git_worker` 在持有 `git_mutex` 时调用 `publish_git_progress()`（内部再次锁同一把 `std::mutex`）→ 递归加锁 UB。发布已移出锁外；修后 ctest **17/17**、启动冒烟存活。
- [x] **已修（第十一~十四批）** 状态栏演进：**内存指示器**（`app.memory` 原生进程内存 → 显示工作集 `N MB`，tooltip 列出峰值与提交量并注明**峰值不是上限**（宿主没有 JVM 堆，与 IDEA `MemoryUsagePanel.java:214-264` 的 `used of total M` 只是在"显示已用量"这一点等价）；5s 轮询、窗口隐藏时暂停、点击立即刷新）、**列选择模式指示器**（IDEA `ColumnSelectionModePanel`，可点关闭）、**工具窗口编号**（`showToolWindowNumbers`：Alt+1..9 徽标 + 快捷键，IDEA `:123-125`）、**保持弹出/仅 Alt 拖放**（`:156-167`）、**工具窗口组三项**（`:116-148,538-603`：每窗口尺寸 / 显示名称 / 隐藏条）、**并列布局三项 + 宽屏**、**UI 选项两项**（平滑滚动 / 菜单图标）、**树视图两项**。
- [x] **已修（第十八~十九批，监督代理第 4~6 轮驱动）** 状态栏第三轮演进：**右键菜单**（IDEA `IdeStatusBarImpl` + `ViewStatusBarWidgetsGroup`/`HideCurrentWidgetAction`：15 个 widget 勾选表 + 全部显示 + 遮罩关闭，持久化到 `taocode.hiddenStatusWidgets`）；**位置 widget 升级**（IDEA `PositionPanel`：有选区时显示「已选 N 字符」+ 跨行数 tooltip，点击打开转到行；编辑器新增 `selection` 事件）；**通知分级**（含错误时 chip 红色 + tooltip 区分）；**省电模式覆盖面扩大**（追加关闭平滑滚动 + `data-motion=reduced`，对应 IDEA 停 `JBAnimator`/`ScrollSettings`）；**欢迎页**：仅从列表移除加确认对话框（`RecentProjectPanel`）、空态补快捷动作按钮组 + 「更多」下拉（`EmptyStateProjectsPanel`）。
- [x] **已修（第十六~十七批）** 状态栏再补两项：**省电模式**（IDEA `core-api/PowerSaveMode.java` + `PowerSaveStatusWidgetFactory.java`：`powerSaveMode` 键 → `lspOn()` 直接关断语言服务、内存与 git 状态轮询全部暂停；状态栏 Zap widget 可切换 + 调色板命令「省电模式」）、**通知中心**（`notify()` 同时写入最多 200 条历史，状态栏「N 条通知」widget 打开列表，带时间/错误级别/全部清空/Esc 关闭）。
- [x] **已修（第二十批，监督代理 #14/#25/#26）** **SmartMode 指示**（IDEA `SmartModeIndicatorWidgetFactory`：载入设置中 / 语言服务未就绪 / 就绪时隐藏，进状态栏组件菜单）、**多光标计数**（IDEA `PositionPanel`：>1 个光标时位置 widget 显示「N 个光标」）、**顶部 header widget**（IDEA New UI `main.toolbar.git.Branches` + `RunToolbarWidgetAction`：顶栏 Git 分支 widget（分支 + ↑↓，点击开源代码管理）与运行 widget（▶/■ 运行-停止、▾ 打开配置选择器））。
- [x] **已修（第二十一批，监督代理第 7 轮 #27-#31）** 真缺陷与可落地项：**SmartMode 误报修复**（`lsp.open` 新增 `configured`，原生 `Session::has_server(language)`；未配置服务器的语言不再显示“语言服务未就绪”）、**提交信息重新格式化**（IDEA `VcsActions.xml:394-395` `Vcs.ReformatCommitMessage`：去行尾空格/压缩空行/去首尾空行）、**欢迎页键盘删除**（IDEA `RecentProjectPanel.java:195`：DELETE/BACK_SPACE 走确认框）、**外观页三项落地**（对比度滚动条 `useContrastScrollbars` → 高对比滚动条 CSS；色觉调整 `colorBlindness` → 根元素 SVG `feColorMatrix` 三套矩阵；界面字体 `uiFontFamily`/`uiFontSize` → `--font-ui` 与根字号，与缩放叠加）、**文档更正**（widget 数 14→15；WriteThread/VfsRefresh/索引 flush 明确定义为 N/A 并附源码行号）。
- [x] **已修（第二十二批）** 外观页最后两处可落地项：**背景图像**（IDEA `Images.SetBackgroundImage`，对话框字段 path/opacity/fillType/anchor/keepRatio：原生新增 `dialog.pickImage` 文件选择器 + `app.readImage` 按路径重读（仅图片扩展名、≤16 MiB，不是任意读文件通道）；六键入 bridge 与原生校验；`.editor-stage` 背景 + `color-mix` 不透明度；设置页与调色板入口）、**演示模式**（IDEA `UISettingsState.presentationMode` + `presentationModeFontSize` 默认 24：开启即 zen 模式 + 根字号 12–72）。
- [x] **已修（第二十三批，代码审查发现）** 第 6 个装饰性设置：`bracketMatching` 有控件与持久化但编辑器从未读取（CodeMirror `basicSetup` 一直开着匹配）→ 新增 `data-bracket-matching` 开关与对应 CSS（关闭时去掉 `.cm-matchingBracket`/`.cm-nonmatchingBracket` 强调），设置真实生效。同时审查确认：41 个 EditorSettings 键在「前端接口 / 前端默认值 / 前端白名单 / 原生默认值 / 原生 known_keys」五处**完全一致**，其余 5 个"App.vue 零引用"键的消费方分别在 `CodeEditor.vue`（wordWrap/lineNumbers/showIndentGuides/showWhitespaces）与 `native/main.cpp`（fullPathsInWindowHeader）。
- [x] **已修（第二十四批，todolist 四项一次性完成）**
  1. **欢迎页项目分组**（IDEA `NewRecentProjectPanel.java:170 isUseGroups`）：分组表与折叠状态持久化到 `taocode.projectGroups`；组头可点击/左右键折叠、带项目计数；行菜单新增「移出分组 / 移入「X」/ 新建分组并移入…」。
  2. **主菜单位置三模式**（IDEA `UISettingsState.kt:207 mainMenuDisplayMode`）：`hamburger`（**默认档**，☰ 按钮 + 单一弹层列出全部分组与命令）/ `merged`（顶层菜单横向并进工具栏行，宽度不够时尾部折进溢出按钮）/ `separate`（菜单栏独立一行，工具栏另起一行）。~~`merged`（默认）~~ 是当初读错 `UISettings.kt:863` 的迁移分支得到的，见 `docs/ui-placement-audit.md` §K.3。**一处 markup 三种布局**，未复制菜单代码。
  3. **屏幕阅读器支持**（IDEA `AppearanceConfigurable.kt:364-375` + `GeneralSettings.isSupportScreenReaders`）：开启后 `title` 全部转成 `aria-label` 并移除（真实关掉悬停提示，MutationObserver 覆盖后续渲染），并新增视觉隐藏的 `aria-live` 实时区域朗读通知。
  4. **工具窗口条拖放换边与重排**（IDEA `AbstractDroppableStripe.kt:242-259`）：条纹按钮可拖动重排、拖到右条纹或底部面板即换边，顺序与停靠边都持久化（`taocode.toolOrder` / `taocode.toolAnchors`）；顺带把 9 个硬编码按钮改为数据驱动（`stripeOrder(side)`），并删除两个因重构失效的 computed。
- [ ] **仍缺失（无消费链路，不放假控件，每项 IDEA 源码行号已核对）**：透明度（`:629-653`，需原生分层窗口，CSS 等效会连文字一起透明，不做）、抗锯齿（`:655-691`，浏览器不暴露，N/A）；状态栏 `WriteThread`/`VfsRefresh`/索引 flush 三个 widget 判定为 **N/A**（监督代理已核源码：`WriteThreadIndicatorWidgetFactory.kt:34-50` 依赖 AWT/EDT 写线程、`VfsRefreshIndicatorWidgetFactory.java:28-122` 依赖 VFS 刷新窗口期、`IndexesAndVfsFlushIndicatorWidgetFactory.kt:20-43` 依赖 `FSRecords.connection().isDirty`，TaoCode 均无对应机制，不做装饰性闪动）；`SmartModeIndicator` 已实现（见上）；`ClockPanel.java` 实际用于新 UI 浮动菜单栏而非状态栏，N/A。
- [x] **已修（第十五批，监督代理复核后）** 监督代理第 2/3 轮报的缺陷全清：`smoothScrolling` 默认值改回 IDEA 的 **true**（`UISettingsState.kt:220`）；Alt+1..9 **解耦**（IDEA `ActivateToolWindowAction` 不读编号设置，编号只影响 `StripeButton` 标签）；内存 chip 语义改准（显示工作集 MB，tooltip 注明峰值**不是上限**，宿主无 JVM 堆）；删除死变量 `clearMessageAfterCommit`；TODO 预检查文案改为"工作区中…（全工作区扫描）"；补提交信息**回滚按钮**（IDEA `CommitMessagePanel` Rollback，持久化到 `taocode.commitMsg:<root>`）；amend 文案写清"改写 HEAD"。
- [x] **已修（第二十四批，本条曾为陈旧描述）** 工具窗口条**拖放停靠**（IDEA `AbstractDroppableStripe.kt:242-259` `finishDrop`）：条纹按钮可拖动重排、拖到另一侧条纹即换边，顺序与停靠边都持久化（`taocode.toolOrder` / `taocode.toolAnchors`），并在第三十一批把 `anchoredLeft/anchoredRight` 收敛为数据驱动的 `stripeOrder(side)`。面板头部的「移动到左/右」菜单保留为键盘/无鼠标的等价入口。
- [x] **已修（第三批）** 欢迎页项目行 git 分支（原"缺失"项）：App.vue `watch(gitHead)` 按项目根把分支记入 localStorage，WelcomePage `branchOf()` 读回、有则渲染在路径下方（IDEA `RecentProjectPanel` 行为，图 2 每项下的分支行）。
- [x] **已修（第二十五批，源码核对 `status/ToolWindowsWidget.java:62-299` + `IdeStatusBarImpl.kt:286-297`）** 状态栏最左端的**工具窗口 widget**：单击切换工具窗口条显示/隐藏（`:206-212` 翻 `UISettings.hideToolStripes` → TaoCode 的 `showToolWindowBars`，走完整持久化链），悬停 300 ms 弹出工具窗口列表（`:197` 定时、`:126-147` 出入弹层各 300 ms 不误关），每行 = 图标 + 条标题 + `Alt+<编号>`（`:288-296` 读 `ActivateToolWindowAction` 的快捷键），点击激活该窗口（`:188-191`）；列表按**条标题自然序**排序（`:168`，`StringUtil.naturalCompare` 实现于 `src/toolWindows.ts`，数字段按数值比较），只列可用窗口（`:163-167`）。按键提示不设 tooltip（IDEA 显式置 null，`:216`）。
  - **有意不一致（已核实）**：IDEA 把该 widget 直接塞进状态栏左面板而**不经过** `StatusBarWidgetFactory`（`IdeStatusBarImpl.kt:286-297`），因此它**不出现在**状态栏组件勾选表（`ViewStatusBarWidgetsGroup` 只列 factory）。TaoCode 照此：该 widget 不在 `STATUS_WIDGETS` 清单内、不受勾选影响，但有工作区时常驻。
- [x] **已修（第二十五批，源码核对 `ActivateToolWindowAction.kt:88-111` + `StripeButton.kt:287-298`）** Alt+编号与工具窗口的绑定修正：编号是**工具窗口自身的属性**（从 keymap 读 `Activate<Id>ToolWindow` 的快捷键），与条上的位置无关 → 编号表改为独立常量、拖动重排不变号；右侧条纹按钮也补上编号（IDEA 的 `StripeButton` 在哪条都显示）。删除旧 `onKey` 里 `{0:git,1:files,3:search,7:outline,9:git}` 的重复映射（其中 1/3/7/9 已被前置处理不可达，且 3 的兜底会打开**另一个**工具窗口）；不可用的工具窗口现在**什么都不做**（IDEA `:131-137` 是禁用该 action），不再回退到别的面板。`Alt+0` 保留为「提交」（IDEA 默认把 Alt+0 给 Commit 工具窗口，TaoCode 的源代码管理面板即提交窗口）。
- [x] **已实现** 主题切换立即生效。

---

## 区域 C · 欢迎页（图 2）— ✅ 本轮修复

- [x] **已修** 左栏：`项目` / `插件（计数徽标）` / `关于`；`设置` 移到底部齿轮图标（WelcomePage.vue:57-78）。插件计数来自真实的 `plugin.list`（App.vue bootstrap 加载）。
- [x] **已修（第十三批）** 左栏改为真正的 tab 选中语义（IDEA `TabbedWelcomeScreen`），并新增**自定义页**（IDEA `CustomizeTabFactory` 语义：主题 / 缩放 / 字体大小，接真实 `settings.update` 与 `changeTheme`）。
- [ ] **未做（已核实无后端，不放假壳）** 远程开发分组（IDEA `RemoteDevelopmentWelcomeTabFactory`）：TaoCode 没有任何远程连接后端（未检测 WSL/SSH，也不解析 `\\wsl$`），只渲染标签就是空壳导航；学习（IDEA `LearnIdeTabFactory`：教程与示例项目）无内容源，同理不做。
- [x] **已修（第四十批，源码核对 `ProjectsTabFactory.kt:126-131` + `WelcomeScreenComponentFactory.createNotificationToolbar:399-451` + `welcomeScreen/NotificationEventAction.kt:24-81` + `IdeBundle.properties:2238`）** **欢迎页通知工具条**：IDEA 把通知工具条放在**项目 tab 的最后一行、右对齐**（`ProjectsTabFactory.kt:126-131` 的 `align(AlignX.RIGHT)`），内容来自 `NotificationEventAction`：**只在有通知时才存在**（`:53-56` `isEnabledAndVisible = notificationTypes.isNotEmpty()`）、按钮文案取 `toolwindow.stripe.Notifications`（`IdeBundle.properties:2238`），点击弹出**与状态栏同一个**通知列表。TaoCode 照此在项目页列表下方加右对齐的通知按钮（`通知 N` + 图标，tooltip 写明条数与是否含错误），弹出复用同一份列表组件。**这补上了一个真实缺口**：欢迎页没有工作区时状态栏不渲染（`<footer v-if="workspace && !zenMode">`），此前欢迎页上发生的通知（如打开/克隆项目失败）只有一闪而过的气球、**没有历史入口**。
  - 列表本身抽成 `src/components/NoticeList.vue`（状态栏与欢迎页共用一份 markup，不再各写一遍），通知规则抽到 `src/notices.ts`（`noticeLevel` / `noticeButtonVisible` / `noticeButtonText` / `noticeTitle` / `noticePreview` / `pushNotice`），`tests/notices.test.mjs` **7 条**覆盖。
  - `App.vue` 的 `notify()` 改用 `pushNotice`（把原本内联的 `expirePreviousAndNotify` 规则搬进模块），状态栏 chip 的着色/提示也改走同一组函数（原来在模板里内联重写了两遍）。
  - **未做（有意）**：`IdeMessagePanel.getAction()`（同一条工具条上的第二个按钮）打开的是**IDE 内部错误日志对话框**（`diagnostic/IdeMessagePanel.java:166,188-200` 的 `openErrorsDialog`）；TaoCode 没有日志文件与错误对话框基础设施，渲染一个点不开的图标就是假控件。
  - **有意偏差（已核实）**：IDEA 的通知图标按最高类型着色（旧 UI `createIconWithNotificationCount`，`:380-383`），New UI 只区分"有没有"（`:372-374`）；TaoCode 走 New UI 口径，类型信息放在 tooltip 与列表行颜色里。
- [x] **部分实现** 动作按钮 新建/打开/克隆（真实功能）。
- [x] **已修** 项目行 `⋮` 更多菜单（悬停才显示，打开项目/仅从列表移除；菜单开着时行高亮 `menu-open`；点击遮罩关闭）（WelcomePage.vue:118-146）。
- [x] **已修（第三批）** 项目行 git 分支显示：App.vue `watch(gitHead)` 按项目根记入 localStorage，WelcomePage `branchOf()` 读回渲染（IDEA `RecentProjectPanel` 行为）。
- [x] **已修（第三批）** 项目行 `⋮` 更多菜单 + 菜单打开时行高亮 + 遮罩关闭。
- [x] **已实现** 选中态（当前页 aria-current + selected 样式）。
- [x] **已修（第三十五批，源码核对 `projectActions/RevealProjectDirAction.kt:15-34` + `ide/actions/RevealFileAction.java:103-123,162-174,273`）** 项目行菜单新增**在资源管理器中显示**：走新的原生通道 `shell.reveal`（不需要打开工作区，接受任意绝对路径），行为 = `openFile(Path)` 的「打开**父目录**并高亮该项」（Windows 落到 `explorer /select,"<path>"`）；项目目录已删除也能用（IDEA 的 `update` 只看有没有选中的 `RecentProjectItem`），只有父目录也不存在时才报错。浏览器预览下禁用（对应 `isDirectoryOpenSupported()` 的能力判定）。第三十批挂起的该项至此关闭。

---

## 验证记录（本轮实际执行）

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit` | exit 0，0 错误（每个改动后均跑） |
| `npm test` | 112/112 |
| `npx vite build --emptyOutDir false` | exit 0，5.42s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning |
| 启动冒烟 | TaoCode.exe 存活 10s（PID 33696，62.8 MB）后干净终止 |

## 本轮改动文件

- `src/App.vue` — 状态栏（当前文件/缩进/常驻诊断）、删 version-tag、欢迎页接 pluginCount + bootstrap 预载插件数
- `src/style.css` — status-file 样式、sc-* 提交面板样式、删 version-tag 样式
- `src/components/SourceControl.vue` — IDEA 提交面板结构（信息框头部/历史/折叠/双按钮）
- `src/components/SettingsDialog.vue` — 整体重构：层级树/搜索/面包屑/前进后退/确定取消应用
- `src/components/WelcomePage.vue` — 左栏插件+齿轮、行 ⋮ 菜单、选中态

## 明确未完成项（不假装完成）

1. ~~右侧 Stripe + 工具窗口重定位~~（第五批已修：停靠模型 + ⋮ 菜单 + 右栏/右条）
2. ~~工具窗口头部 ⋮~~（第五批已修）
3. ~~状态栏进度指示器~~（第四批已修：git.progress 事件 + backgroundTasks 汇合三源 + 弹层）
4. 设置外观页其余控件（自定义字体/色觉/背景图像/平滑滚动/菜单图标等——每项的 IDEA 源码行号已写进清单 B 区，按"接一个真实效果才加一个控件"推进）
5. ~~欢迎页项目行 git 分支~~（第三批已修：localStorage 记录 + WelcomePage 渲染）
6. 欢迎页远程开发/自定义/学习（无后端，不渲染空壳）

## 重要更正（2026-09-26）

**本会话的模型不支持图片，三张截图内容从未被实际看到**（系统过滤并要求告知）。此前清单中所有"图 1/图 2/图 3"的截图依据**不成立**——那是我根据场景推断的描述，属于应禁止的猜测。清单条目中只有 IDEA 源码依据（类名+行号）成立。待桃切换多模态模型重发截图或文字描述后，需对"图 X"条目逐一重新核实。

## 第二批验证记录（外观页三项真实效果）

| 项 | 结果 |
|---|---|
| `vue-tsc --noEmit` | exit 0 |
| `npm test` | 112/112 |
| `vite build` | exit 0，5.38s |
| 原生构建 | RC 0，0 error / 0 warning |
| `projects_lifecycle`（含 settings 校验新键） | 1/1 通过 |
| 启动冒烟 | PID 33084 存活 10s 后干净终止 |
| 窗口标题（fullPathsInWindowHeader） | `native/main.cpp` 打开项目时 + `settings.update` 时按开关切换完整路径 |

## 第三批验证记录（树视图 + 欢迎页分支）

| 项 | 结果 |
|---|---|
| `vue-tsc --noEmit` | exit 0 |
| `npm test` | 112/112 |
| `vite build` | exit 0，7.78s |
| 原生构建 | RC 0，0 error / 0 warning |
| `projects_lifecycle`（新键进校验） | 1/1 通过 |
| 启动冒烟 | PID 31548 存活 10s 后干净终止 |
| 缩进参考线 | FileTree.vue `guideStyle()`：repeating-gradient 周期 = 当前 step()，紧凑模式下不错位（首版写死 15px 已当场发现并修正） |

---

## 第二十五~二十七批验证记录（状态栏工具窗口 widget / 项目 widget / 提交图例 / 提交前检查）

三批各自完整跑过全量验证口径：

| 项 | 第二十五批 | 第二十六批 | 第二十七批 |
|---|---|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0 | exit 0 | exit 0 |
| `npm test` | 125/125 | 132/132 | 138/138 |
| `npx vite build --emptyOutDir false` | exit 0，5.77s | exit 0，6.58s | exit 0，5.71s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning | RC 0，0 error / 0 warning | RC 0，0 error / 0 warning |
| `ctest --output-on-failure` | 17/17 | 17/17 | 17/17 |
| 启动冒烟（`./TaoCode.exe`，15s） | ALIVE | ALIVE | ALIVE |

基线 112 条测试 → 138 条（新增 26 条，全部针对本三轮新写的纯逻辑模块）。

### 本轮顺带修掉的两个真实缺口（不是新功能）

1. **`src/components/DebugPanel.vue:127` 编译不过**：`disconnect()` 的 catch 里写成了 `consoleNote = caught …`（未声明标识符，运行时会 ReferenceError），`vue-tsc` 直接报 `TS2304: Cannot find name 'consoleNote'`。按同文件其它 20 处一致的写法改为 `error.value = message(caught)`。
2. **`src/style.css` 里顶栏 widget 样式被误插进 `@media (max-width: 700px)`**（第 508-518 行旧位置）：`.topbar-widgets`/`.header-widget`/`.header-run`/`.run-button`/`.run-caret` 与全局同名规则重复一遍，导致窄屏下多一份冗余、宽屏下 `.run-caret` 的 `padding/font-size` 缺席。已删除媒体查询内的重复块、把 `.run-caret` 留在全局，媒体查询只保留真正属于窄屏的 `.command-box { flex-basis: 120px }`。

### 本轮新增文件

- `src/toolWindows.ts` —— Alt+编号绑定（`mnemonicOf` / `mnemonicBindings`）+ `StringUtil.naturalCompare` + 按标题排序（`sortedByTitle`）
- `src/commitLegend.ts` —— 提交图例的分类（`classifyLegend`）、分组（`legendGroups`）、文本与紧凑形式（`legendText`）
- `src/projectWidget.ts` —— 项目 widget 的过滤（`filterProjects`）与分组（`groupProjects`）
- `src/commitCheck.ts` —— 提交前检查（`commitBlockReason` / `commitBlockMessage`）
- `tests/tool-windows.test.mjs`、`tests/commit-legend.test.mjs`、`tests/project-widget.test.mjs`、`tests/commit-check.test.mjs`

---

## 第二十八批验证记录（提交作者行 / CommitAuthorComponent）

源码依据：`vcs/commit/CommitAuthorComponent.kt:38-121,124-137`、`NonModalCommitPanel.kt:74-81`（`bottomPanel` 顺序 = 检查面板 → 作者行 → 动作按钮）、`VcsUserUtil.java:24-28,34-46,48-55`（短名/全名规则）、`VcsBundle.properties:329-332`（`label.by.author=By`）。

- **原生新增** `git.user`（`native/git.cpp` 的 `user()`：`git config --get user.name` / `user.email`，未配置时返回空串，退出码 1 不算错）→ 进入 `is_git_method` 白名单（走 git 工作线程，`native/main.cpp:1523`）。
- **原生扩展** `git.commit` 增加 `author` / `authorEmail`：非空时拼 `--author=Name <email>`，**邮箱缺失或含控制字符直接 `INVALID_REQUEST` 拒绝**（`format_author`，值是单个 argv 项、不经过 shell，但仍要挡住换行写进提交对象）。amend 与非 amend 两条路径都生效。
- **前端**：面板加载与切项目时读 `git.user` 填 `repositoryAuthor`；在「提交检查标签」与「动作按钮」之间渲染 `By <链接>`（链接文案 = 短名，tooltip = `Name <email>`），点击打开作者编辑器（名字 + 邮箱，Enter/应用提交、恢复仓库配置、取消），有覆盖时显示「已覆盖」标记与 × 移除。切项目清空覆盖。
- **逻辑抽离**：`src/commitAuthor.ts`（`shortName` / `fullName` / `nameFromEmail` / `hasAuthor`）+ `tests/commit-author.test.mjs` 5 条。
- **原生新增测试**（`native/git_test.cpp`）：`git.user reads the repository author and can be overridden for one commit` —— 读配置、覆盖作者后 `blame` 的首行作者变成 Guest 且仓库配置不变、缺邮箱与控制字符两种非法覆盖都被拒；测试末尾 unstage + 删除临时文件以免污染后续 rebase/cherry-pick 用例。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 144/144（新增 5 条） |
| `npx vite build --emptyOutDir false` | exit 0，6.31s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning |
| `ctest --output-on-failure` | 17/17（`git_status_vcs` 21 passed / 0 failed，含新用例） |
| 启动冒烟（`./TaoCode.exe`，15s） | ALIVE（连续 4 次，含 3 次 kill-后-立即重启） |

### 已知偶发（非本批引入，如实记录）

本批第一次冒烟出现一次 `rc=1` 即刻退出、无任何输出。定位到唯一能产生该形态的路径是 `native/main.cpp:1798` 的 `CoInitializeEx` 失败分支（进程在创建窗口前返回 1）。随后 4 次启动（含 3 次连续 kill-后-立即重启）全部存活，且本批改动只新增 `git.user` 与 `git.commit` 参数、不触碰 COM 初始化，故判定为**紧接 17 项 ctest 之后的瞬时 COM 初始化失败**，属环境偶发。未做修改（无法复现，改启动期 COM 语义属猜测）。

### 补充：`build-native-locked.bat` 的一个坑（已确认，未改）

`timeout /t 5 /nobreak >nul` 在输出被重定向时无法运行（stdin 不可用），循环会瞬间跑完 120 次并打印 `BUILD_LOCK_TIMEOUT`、`exit /b 1`。**表现是 RC 1 但输出里没有 "error"/"warning" 字样**，容易误判成编译失败。本次遇到过一次（残留 `.buildlock`）；重跑即 RC 0。grep 校验原生构建时要连 `LOCK` 一起匹配。

---

## 第二十九批验证记录（设置搜索：聚光灯 / 无结果红框 / Esc 链 / 粘贴路径 / 复制设置路径）

源码依据：`options/newEditor/SettingsFilter.kt:83-105,139-171,177-255`、`SettingsSearch.java:25,41-70,96-100`、
`SettingsDialog.java:126-140,251-265`、`ide/ui/search/SearchUtil.kt:63-86,209-237`、
`ide/ui/search/SearchableOptionsRegistrarImpl.kt:42,184-260,457-529,563-569`、`SearchableOptionsRegistrar.java:21`、
`options/ex/GlassPanel.java:37-40,59-104`、`SpotlightPainter.kt:45-121,131-171`、
`CopySettingsPathAction.kt:34-69,179-197`、`SettingsEditor.java:793-806`、`SettingsTreeView.java:371-386`、
`ActionBundle`：`ActionsBundle.properties:445-447`、`CommonBundle.properties:37`、`LightColors.java:11`。

实现（全部接真实消费链路，无空壳）：

1. **选项聚光灯**：搜索时当前页匹配的选项行加 2px 橙色描边、未匹配行淡出，并把**第一个**匹配滚到视口中央。
   描边色取 `GlassPanel.java:37-40` 的 fallback（Orange6 `#e08855` / Orange4 `#a36b4e`），
   线宽 2 对应 `:62 stroke = 2`；"只滚第一个"对应 `SpotlightPainter.kt:57-59` 的 `DO_NOT_SCROLL`；
   重算延迟 200ms 对应 `:64-67 debounce(200)`；命中判据两趟对应 `SearchUtil.lightOptions:82-86`（先全词、全页无命中才退回单词/子串，`:209-237`）。
2. **无结果红框**：过滤结果为空时搜索框背景转红（`SettingsFilter.kt:212` 的 `LightColors.RED`，色值 `LightColors.java:11`）。
3. **Esc 链**：`SettingsSearch.java:50-52`（Esc 先清空过滤）+ `SettingsDialog.java:255-261`（`editor.cancel()` 未被消费才关窗）
   → App.vue 捕获阶段的全局 Esc 先调用对话框暴露的 `handleEscape()`，第一次清空、第二次关闭。
4. **Ctrl+F 定位搜索框**（`SettingsDialog.java:129-132` 把平台 Find 动作注册到根面板）+ tooltip 显示该快捷键（`SettingsSearch.java:96-100`）。
5. **点进非空搜索框全选**（`SettingsFilter.kt:93-105`）。
6. **左树过滤升级**：页名包含整串 = name hit（`SearchableOptionsRegistrarImpl.kt:217-231`，无词查询时全页命中 `:221-225`）；
   否则看该页选项是否命中（内容命中 `:246-260`）。选项文本**从 DOM 读**（`[data-page]` 面板内的 `.checkbox-row/.input-row/.theme-option`），
   不在数据里复制第二份标签 —— 对应 IDEA 直接遍历组件树（`SearchUtil.kt:63-79`）。Enter 优先跳 name hit（`SettingsFilter.kt:222-229`）。
7. **粘贴路径直达**：查询含 ` | ` 时按 `parseSettingsPath` 拆段、逐段忽略大小写匹配页名、剩余段成为 spotlight 文本
   （`SearchableOptionsRegistrarImpl.kt:457-529`，前缀表 `:515-525` 含 `File | Settings`）。
8. **复制设置路径**：面包屑右键 / Shift+F10 / 菜单键 → 「复制设置路径」，写出 `文件 | 设置 | <组> | <页>`
   （`CopySettingsPathAction.kt:55-65` 前缀+分隔符拼接、`SettingsEditor.java:793-806` 深拷贝到每个面包屑、
   `SearchableOptionsRegistrar.java:21` 分隔符 `" | "`、`CommonBundle.properties:37` 的 `File | Settings`、
   `ActionsBundle.properties:446/447` 的动作文案与描述）。复制结果在底部状态区回显 4 秒。

逻辑抽到新模块 `src/settingsSearch.ts`（纯函数，无 Vue/DOM），`tests/settings-search.test.mjs` 15 条覆盖
（分词含 CJK 单段、两趟匹配、name hit、路径解析与前缀剥离、路径拼接）。

**未做（有意，不是无后端）**：

- `Copy Link`（`CopySettingsPathAction.kt:179-197` 的 `jetbrains://<product>/settings?name=A--B`）：TaoCode 未注册 URI 协议、
  也没有 IDE 实例间委派，生成一个谁都打不开的链接就是空壳，只做"复制路径"。
- Porter 词干还原与英文停用词（`SearchableOptionsRegistrarImpl.kt:557,563-569`）：半套 stemmer 会静默错配、中文标签也用不到，
  不假装实现（英文需输入完整词形）。
- 搜索历史下拉（`SearchTextField("SettingsSearchHistory")`，`SettingsSearch.java:25`）：本轮未做，需接 localStorage 与下拉弹层。**（第三十七批已完成：`src/searchHistory.ts` + 搜索框下方的历史弹层，见文末）**

**行为变更（对齐 IDEA）**：过滤状态下点击页面**不再清空**搜索框。IDEA 的 `isHoldingFilter`（`SettingsFilter.kt:93-105`）
在用户继续操作时保持过滤，清空只由 Esc / × 触发；上一批"选中即清空"属偏离，本批改正。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 159/159（144 → 159，新增 15 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.13s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（38.00s） |
| 启动冒烟（`./TaoCode.exe`，15s） | ALIVE |

---

## 第三十批验证记录（欢迎页项目列表：搜索文本 / Enter·Alt+Delete / 预选最近打开 / 行图标 / 复制路径）

源码依据：`welcomeScreen/recentProjects/RecentProjectTreeItem.kt:67-148`（`searchName()` :139-147）、
`recentProjects/RecentProjectFilteringTree.kt:164-166,174-196,219-259,470-545,824-843`、
`ProjectsTabFactory.kt:163-204`（`selectLastOpenedProject()` 在 `:170`/`:210` 被调用）、
`projectActions/CopyProjectPathAction.kt:19-33`、`IdeBundle.properties:2296,2303-2305,2314`、`ActionsBundle.properties:2208`、
`CommonBundle`/`IdeBundle` 的 `recent.project.unavailable`（`IdeBundle.properties:2671`）。

实现（每项都接真实链路）：

1. **搜索文本含分组名**（`RecentProjectTreeItem.kt:139-147`）：匹配串改为 `"<分组> <路径> <名称>"`，
   搜索框 placeholder / aria-label 同步改为「项目名称、路径或分组」。逻辑进 `src/welcomeProjects.ts` 的 `searchText/matchesSearch`。
2. **搜索框键盘动作**（`RecentProjectFilteringTree.kt:188-192`）：Enter 打开当前聚焦（无则第一个可见）的项目，**Alt+Delete** 从列表移除（沿用既有确认框）。
3. **进入列表即预选最近打开的项目**（`:236-254`，`ProjectsTabFactory.kt:170,210`）：按 `lastOpened` 时间戳取最新一条并 focus 它的行；
   只在首次加载、且焦点属于 body 时抢焦点（用户已点进搜索框则不打扰）。取"最新一条"的规则进 `lastOpenedPath`。
4. **行操作按钮图标随路径有效性切换**（`RecentProjectFilteringTree.kt:536-545`）：可达 → 齿轮，失效 → 移除图标（并给失效行更明确的 title）。
5. **行菜单新增「复制路径」**（`CopyProjectPathAction.kt:19-33`，文案 `ActionsBundle.properties:2208` `action.WelcomeScreen.CopyProjectPath.text=Copy Path`）：
   复制绝对路径，Windows 用 `\` 分隔（对应 `FileUtil.toSystemDependentName`，由 `systemDependentPath(path, windows)` 实现），
   结果在列表状态行回显 4 秒。失效路径**仍可复制**（IDEA 只按"是否为本地 RecentProjectItem"判定可用性，`:21-22`）。

逻辑抽到 `src/welcomeProjects.ts`（纯函数），`tests/welcome-projects.test.mjs` 7 条覆盖
（匹配文本含分组、空查询放行、大小写、最新时间戳选取与回落、分隔符转换）。

**有意偏差（已核实）**：IDEA 的 `searchName()` 先把路径相对到用户主目录再匹配（`RecentProjectTreeItem.kt:140-144`）；
渲染进程拿不到主目录，改为对完整路径匹配 —— 是同一批命中的超集，不会漏。

**未做（有意）**：`RevealProjectDirAction`（`projectActions/RevealProjectDirAction.kt:16-35` 在资源管理器中显示项目目录）需要
对**任意绝对路径**掉起资源管理器，而现有原生 `file.reveal`（`native/workspace.cpp:1198-1218`）要求工作区已打开且路径为工作区相对路径，
欢迎页没有工作区；新增一个 `shell.reveal` 通道属跨层改动，留给下一批，不先放一个只能灰着的菜单项。**（第三十五批已完成：原生 `shell.reveal` + 行菜单「在资源管理器中显示」，见文末）**

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 166/166（159 → 166，新增 7 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.19s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK |
| `ctest --output-on-failure` | 17/17（37.84s） |
| 启动冒烟（`./TaoCode.exe`，15s） | ALIVE |

---

## 第三十一批验证记录（工具窗口头部 ToolWindowHeader：单击激活并聚焦 / 双击最大化 / 中键·Shift+左键隐藏 / 齿轮菜单 / Ctrl+Shift+'）

源码依据：`toolWindow/ToolWindowHeader.kt:203-256`（`mouseClicked` 激活 `:203-209`、`mouseReleased` 的 `isCloseClick` 分支 `:212-235`、`DoubleClickListener` `:242-248`）、
`:345-368`（`ShowOptionsAction` 弹出 `gearProducer.get()`，`:374-376` 的 `copyFrom` 决定菜单内容）、
`openapi/wm/impl/MaximizeToolWindowAction.java:26`（文案键）、`:36`（`setMaximized(toolWindow, !isMaximized(toolWindow))` 就是 toggle）、`:45-63`（无工具窗口时禁用 + Toggleable 文案切换）、
`toolWindow/ToolWindowPane.kt:544-560`（`setMaximized`：`stretch(toolWindow, MAX)` + `maximizedProportion` 记住旧尺寸）、
`util/ui/UIUtil.java:1843-1846`（`isCloseClick = BUTTON2 || BUTTON1 && isShiftDown`）、
`platform-resources/src/keymaps/$default.xml:885-887`（`control shift QUOTE`）、`macOS System Shortcuts.xml:394-396`（mac 同样是 `ctrl shift QUOTE`）、
`PlatformActions.xml:652-664`（`ActiveToolwindowGroup` 项序）、`ActionsBundle.properties:1187-1188`（`Maximize Tool Window` / `Restore Tool Window Size`）。

实现（全部接真实链路）：

1. **两处头部合并为一个组件** `src/components/ToolWindowHeader.vue`：左、右 dock 各渲染一个实例，props `id/title/anchor/maximized/menuOpen`，events `activate/hide/maximize/move/menu`；DOM 结构保持 `.tool-strip-heading`（App.vue 的"点击外部关闭菜单"仍按这个类判定）。
2. **单击 = 激活 + 焦点进内容**：新增 `focusToolWindowContent(id)`（App.vue），走 `showView` 后 `nextTick` 把焦点给 `.explorer-panel`（该 aside 新增 `tabindex="-1"` 作为真实焦点目标）。与条纹按钮的 `activateToolWindow` **语义不同**：后者是开关，头部单击永不收起 dock。
3. **双击 = 最大化/恢复**：`maximizedSide` + `.workbench.tool-maximized` → CSS `.tool-maximized .explorer-panel { width: 100% }` + `.tool-maximized .editor-column { display: none }`。底部输出面板嵌在 `.editor-column` 内（App.vue:4197 起的 `<main>` 到 4349 的 `</main>`），因此与编辑器一起被挤掉，对应 `stretch` 把同一 pane 内其它 dock 挤出的语义；纯视觉、不写状态，恢复即移除类。
4. **中键 / Shift+左键 = 隐藏**：`mousedown` 只挡掉浏览器的中键自动滚动，动作发生在 `auxclick`（对应 IDEA 只在 `MOUSE_RELEASED` 上判定）。
5. **菜单顺序照 `ActiveToolwindowGroup`**：隐藏 → 最大化/恢复 → 移动到左/右；四个 `Hide*` 收敛为一条 隐藏（TaoCode 每侧只有一个窗口，可见性就是该侧开关）。
6. **快捷键 Ctrl+Shift+'**：`event.code === 'Quote' && ctrlKey && shiftKey`（keymap 存的是物理键；Shift 会把字符变成 `"`）。同时在 Window 菜单/动作注册表新增 `window.maximizeToolWindow`（Toggleable 文案随状态切换，`enabled` = 有工作区且 dock 可见）。
7. **顺带修掉一个真实缺陷**：条纹按钮（左、右两条）的 `@contextmenu` 原本直接 `toolMenu = id`，仅当该 id 恰好是 `leftView` 时菜单才渲染，否则状态被写入却**没有任何 UI 响应**。改为 `openToolMenu(id)`：先 `focusToolWindowContent(id)` 再开菜单（对应 `ToolWindowHeader.kt:345-368` 弹出的是**该窗口自己**的组）。
8. **载入时拒绝历史遗留锚点 `'bottom'`**（该项 `toolAnchors` 只接受 left/right），底区由输出面板承担。

逻辑抽到 `src/toolWindowHeader.ts`（纯函数：`headerAction` / `toggleMaximized` / `reconcileMaximized` / `canMaximize` / 快捷键常量），`tests/tool-window-header.test.mjs` 10 条覆盖。

**有意偏差（已核实）**：
- IDEA 的 `alt+中键` 是 `fireHidden`（隐藏整个窗口）、`中键` 是 `fireHiddenSide`（隐藏该侧）；TaoCode 每侧一个窗口、`explorer` 就是每侧开关，两者是同一操作，故收敛（`toolWindowHeader.ts` 注释已写明）。
- IDEA 的齿轮菜单是 `gearProducer.get()`（`createPopupGroup(true)`），含 Pin/JumpToLastWindow/Split 等 TaoCode 没有对应实现的项；按"接一个真实消费链路才加一个控件"，菜单只列已实现的三类动作。
- 最大化范围是 dock，不含 trace 面板（IDEA 的 stripe 在 stretch 后仍可见，行为一致）。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 176/176（166 → 176，新增 10 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.20s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（37.87s） |
| 启动冒烟 | ALIVE（两次，均 `D:\TaoCode\build\TaoCode.exe` 存活过 15s） |

---

## 第三十二批验证记录（状态栏键盘导航与聚焦）

源码依据：`status/IdeStatusBarImpl.kt:313-323`（`isFocusCycleRoot` + 把 RIGHT/LEFT 加进遍历键 + 恢复焦点动作）、
`:566,573-576`（SPACE/ENTER → `STATUS_BAR_WIDGET_ACTIVATE`，守卫 `isShowing && isEnabled`）、
`:579-596`（`restoreFocusToPreviousComponent`：保存的焦点失效则退回编辑器组件）、
`:863-872`（`focusFirstWidget`：焦点已在状态栏内直接返回）、`:874-880`（组件顺序 = 左面板 → 进度面板 → 右面板按 `gridx`）、
`:901-902`（只取可见且启用）、`:952-962`（`StatusBarFocusTraversalPolicy`：两端回绕）、
`status/FocusStatusBarAction.kt:10-21`、`ActionsBundle.properties:81-82`、`PlatformActions.xml:1366`、`CustomizationUtil.java:567-568`。

实现：

1. **左右方向键在 widget 间移动**，到两端回绕（`navigateWidget`），空状态栏不做任何事。
2. **只遍历可见+启用**：`offsetParent === null` 视作 `!isShowing`，`disabled` 视作 `!isEnabled`（`focusableWidgets`）。
3. **弹层内部的行不算 widget**：IDEA 遍历的是注入三个面板的组件，`ProcessPopup.java:98-100` 给弹层自带一套 `FocusTraversalPolicy`，所以查询排除 `.status-progress-list / .status-toolwindows-popup / .status-widget-menu / .status-notice-list` 内的元素。
4. **「聚焦状态栏」动作**（动作搜索里的 `window.focusStatusBar`）：记忆当前焦点 → 聚焦第一个 widget；焦点已在状态栏内则什么都不做（`:864-866`）。
5. **Esc 离开状态栏**：`restoreFocusFromStatusBar` 按 `resolveRestoreTarget` 决定回到记住的焦点（仍连通且未禁用）还是编辑器组件（`:583-590`）；弹层自己的 `@keydown.esc.stop` 先消费，不会误退出。
6. **Space/Enter 激活**：不加绑定 —— 原生 `<button>` 对两个键都会触发 click，且禁用时不触发，与 `:566` 的守卫等价（显式记在模块注释里，避免"看起来漏了"）。

逻辑抽到 `src/statusBarNav.ts`（`focusableWidgets` / `navigateWidget` / `shouldFocusFirstWidget` / `resolveRestoreTarget`），`tests/status-bar-nav.test.mjs` 9 条覆盖。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 185/185（176 → 185，新增 9 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.17s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（37.88s） |
| 启动冒烟 | ALIVE |

---

## 第三十三批验证记录（进程弹层：空闲态文案 / 分隔线规则 / Window › 后台任务）

源码依据：`status/ProcessPopup.java:60-133`（`myIndicatorPanel` 建 `TasksFinishedDecorator`/`AnalyzingBannerDecorator`/`SeparatorDecorator`；
`addIndicator` :107-118 调 `indicatorAdded`，`removeIndicator` :120-133 调 `indicatorRemoved`）、`:251-256`（`hideSeparator`）、`:258-260`（`isProgressIndicator`）、
`:80,351-352`（`MyJBPanelWithEmptyText` + `progress.window.empty.text`）、
`TasksFinishedDecorator.kt:19-46`（`indicatorAdded` 移除标签 / `indicatorRemoved` 在无指示器时插到 **index 0**；`:35-45` 成功图标 + 信息前景色）、
`SeparatorDecorator.kt:31-43`（`previousComponentIsIndicator` 判定）、
`ShowProcessWindowAction.java:16-55`（ToggleAction；`isSelected` = `statusBar.isProcessWindowOpen()`）、`:45-63`（update 的启用条件）、
`IdeStatusBarImpl.kt:693-697` + `InfoAndProgressPanel.kt:574-576`（`isProcessWindowOpen` = popup 正在显示）、
`PlatformActions.xml:637`（WindowMenu）`:723-726`（`BackgroundTasks` 组 = ShowProcessWindow + AutoShowProcessWindow）、
`AutoShowProcessPopupAction.java:12-24` + `registry.properties:209-210` + `InfoAndProgressPanel.kt:319-321`（`infos.size > 1` 时自动开弹层，默认 false）、
`IdeBundle.properties:951,3346`、`ActionsBundle.properties:1071-1072`。

实现：

1. **空闲态文案**：没有运行任务时，弹层显示「全部后台任务已完成」（`IdeBundle.properties:3346`，带成功图标）**仅当**曾经有过任务（`updateFinishedLatch` 在「有 → 无」的那一刻置位，之后不再复位，对应 `indicatorRemoved` 每次都会把标签放回去）；从未有过任务则显示「无进程正在运行。」（`:951`，即 `JBPanelWithEmptyText` 的空态文案）。
2. **分隔线规则**：只有**前一行也是运行中任务**时才画分隔线（`SeparatorDecorator.kt:31-43`），所以第一行永远没有、完成标签也没有（`TasksFinishedDecorator.kt:42` 显式关掉）。
3. **弹层可空闲打开**：inline 指示器在无任务时不渲染（IDEA 同样收起 inline 面板），但 `ShowProcessWindow` 仍可打开弹层 → widget 渲染条件改为 `有任务 || 弹层已开`（`showProgressWidget`），空闲时图标是静态对勾而不是转圈。
4. **Window › 后台任务**（`PlatformActions.xml:637,723-726` 的 `BackgroundTasks` 组）：`显示进程窗口` 是 ToggleAction —— 用 `checked`（勾选态 = 弹层是否打开）而不是 显示/隐藏 标题，与 `ShowProcessWindowAction.isSelected` 一致；TaoCode 菜单是扁平的，故该 popup 组按既有惯例压成 section 头。

**未做（有意）**：`AutoShowProcessWindow`（`AutoShowProcessPopupAction.java:12-24`）只翻 registry 键 `ide.windowSystem.autoShowProcessPopup`（`registry.properties:209-210`），唯一消费点 `InfoAndProgressPanel.kt:319-321` 要求「同时存在 ≥2 个任务」；registry 是开发者开关、TaoCode 无 registry 界面，按既有惯例**不造假设置**，其默认值 `false`（不自动弹层）就是 TaoCode 现有行为。

逻辑抽到 `src/processPopup.ts`（`popupRows` / `showProgressWidget` / `updateFinishedLatch`），`tests/process-popup.test.mjs` 9 条覆盖。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 194/194（185 → 194，新增 9 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.16s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（37.91s） |
| 启动冒烟 | ALIVE |

---

## 第三十四批验证记录（提交结果通知 ShowNotificationCommitResultHandler）

源码依据：`vcs/commit/ShowNotificationCommitResultHandler.kt:24-98`（`onSuccess`/`onFailure` → `reportResult` `:35`；`onCancel` → `notifyMinorWarning` `:29-31`；
标题的四种类型 `:47-58`；正文 `getCommitSummary` `:100-116`；`expirePreviousAndNotify` `:97`；`countChangesIgnoringChangeLists` `:128`；
`CommitNotificationType` `:118-126`）、
`CommitSuccessNotificationActionProvider.kt:8-16`（扩展点动作）、`:63-74`（异常动作 + Show details）、
`vcs-api-core/resources/messages/VcsBundle.properties:103,104,952,956`（文案与复数选择）。

实现：

1. **标题 = 最差结果 + 计数**（`:47-58`）：有错误 → 「提交失败：N 个错误」（`VcsBundle:103`）；只有警告 → 「提交完成，但有 N 个警告」（`:104`）；否则 → 「已提交 N 个文件」/「没有文件已提交」（`:952` 的 `{0,choice,0#No files…}` 三档）。等级同理（error / warning / info）。
2. **正文顺序**（`:100-116`）：提交信息 → feedback 行 → 失败原因行（全为警告时不重复列出）；空行不占位。通知中心的行改为「标题 + 缩进正文」两段式。
3. **每次提交只留最新一条**（`:97 expirePreviousAndNotify`）：`notify()` 新增 `displayId`，同 id 的旧通知先被移除；提交结果固定用 `vcs.commit` 作 display id。
4. **取消**（`:29-31`）：提交前的 TODO 检查被用户拒绝时发一条空正文的「提交已取消」警告（对应 `onCancel`）。
5. **失败也算一次结果**（`:33,47-58`）：提交抛错时通知标题为「提交失败：1 个错误」，正文列出失败原因 —— 与面板内联错误并存（IDEA 也是通知 + 面板两处）。
6. **提交并推送的边界**：推送失败**不**报成「提交失败」（提交已经成功）；只有提交本身失败才走失败通知（推送仍走通用错误提示）。

**未做（有意）**：提交成功通知上的动作按钮（`:76-78` 的 `CommitSuccessNotificationActionProvider` 扩展点、`:68-74` 的异常动作 + Show details、`:80-94` 的 Share Project）—— TaoCode 的通知行没有动作按钮，也没有插件扩展点；按"接一个真实消费链路才加一个控件"不先放假按钮。

逻辑抽到 `src/commitNotification.ts`（`commitNotificationTitle` / `commitNotificationLevel` / `commitNotificationRows` / `countCommittedPaths`），`tests/commit-notification.test.mjs` 10 条覆盖。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 204/204（194 → 204，新增 10 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.13s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（38.00s） |
| 启动冒烟 | ALIVE |

---

## 第三十五批验证记录（欢迎页「在资源管理器中显示」+ 原生 shell.reveal）

源码依据：`welcomeScreen/projectActions/RevealProjectDirAction.kt:15-34`（`:16` 动作名取 `RevealFileAction.getActionName()`；
`:17-21` `enabled = isDirectoryOpenSupported() && hasItemsToOpen`、`visible = hasItemsToOpen`；`:25-33` 三分支）、
`ide/actions/RevealFileAction.java:103-105`（`isSupported` = Windows/macOS/…）、`:108-110`（`isDirectoryOpenSupported`）、
`:112-123`（`action.RevealIn.name.other` + `getFileManagerName()`）、`:162-174`（`openFile(Path)` 取 **父目录** 并高亮该项；无父目录则什么都不做）、
`:192-211`（`doOpen`）、`:273`（Windows 分支 `explorer /select,"<path>"`）、
`platform-api/resources/messages/IdeBundle.properties:3209`（`action.explorer.text=Explorer`）、
`platform-resources-en/src/messages/ActionsBundle.properties:1936-1937`（`action.RevealIn.name.mac` / `.other`）。

**这一批关掉了第三十批记录的「未做（有意）RevealProjectDirAction 需要新的原生通道」**：

1. **原生新增 `shell.reveal`**（`native/workspace.cpp` 的 `reveal_absolute`，声明在 `workspace.hpp`）：接受**任意绝对路径**、不需要打开工作区。校验顺序 = UTF-8/NUL → 必须是绝对路径 → 取父目录（对应 `openFile` 的 `path.getParent()`，无父目录则报错而不是静默打开别的目录）→ **父目录必须存在且是目录**（项目目录本身可以已删除，对应 `update` 只看「有选中的 RecentProjectItem」）→ `explorer.exe /select,"<path>"`（等价 `doOpen` 的 Windows 分支，`/select` 同时加载父目录并高亮条目）。
2. **桥接登记**：`Method` 联合类型加 `'shell.reveal'`；浏览器预览的只读/桌面专属守卫加上它（预览里调用即 `DESKTOP_REQUIRED`）。
3. **欢迎页行菜单**新增「在资源管理器中显示」（图标 FolderSearch），紧跟「复制路径」；`isDesktop` 为假时禁用并说明原因（对应 `isDirectoryOpenSupported()` 的能力判定）；成功/失败都在列表状态行回显 4 秒。
4. **原生测试**（`native/workspace_test.cpp`）：`shell.reveal rejects a bad path and a missing parent before starting the shell` —— 空路径、相对路径、含 NUL 的路径均 `INVALID_PATH`，父目录不存在的路径 `NOT_FOUND`；**成功路径不进测试**（那会真的拉起资源管理器）。workspace_test 现为 22 passed / 0 failed。

**本批逻辑在原生层**，因此新增的是原生测试而不是前端单测（前端本批只多了一个菜单项与一次请求调用）。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 204/204（无新增前端用例） |
| `npx vite build --emptyOutDir false` | exit 0，5.20s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（修掉第一次出现的两条 C4129：写入测试时把 `\p` 与 `\t` 写成了单反斜杠，第二次编译起归零） |
| `ctest --output-on-failure` | 17/17（37.95s；`workspace_safety` 22 passed 含新用例） |
| 启动冒烟 | ALIVE |

---

## 第三十六批验证记录（提交信息检查：主题/正文右边距 + 主题正文空行）

源码依据：`vcs/commit/message/BaseCommitMessageInspection.kt:36-47,73-80,110-140,144-157`（检查基类、`ReformatCommitMessageQuickFix`、
`checkRightMargin`：`end > start + rightMargin` → `TextRange(start + rightMargin, end)`）、
`SubjectLimitInspection.kt:19`（`RIGHT_MARGIN = 72`）`:25-31`（options：`settings.commit.message.right.margin.label` + `spinner(0..10000)`）
`:33-36`（只查第 0 行，fixes 只有 `ReformatCommitMessageQuickFix`）、
`BodyLimitInspection.kt:26`（`RIGHT_MARGIN = 72`）`:32-48`（options：右边距 / 显示右边距 / 输入时换行）`:50-57`（`1 until lineCount`，fixes = `WrapLineQuickFix` + `ReformatCommitMessageQuickFix`）
`:59-65`（`reformat` = 折行正文）`:67-95`（`WrapLineQuickFix`：有 descriptor 用该行范围，否则整段正文）、
`SubjectBodySeparationInspection.java:28-39`（`checkRightMargin(..., line = 1, rightMargin = 0)` + `document.getLineCount() > 1` 守卫）`:51-73`（`AddBlankLineQuickFix`：在行首插 `\n`，空行则跳过）、
`ReformatCommitMessageAction.java:35-42,54-59`（`reformat` 依次调用每个**启用**检查的 `reformat`）、
`CommitMessageInspectionProfile.java:41-43,57-67,81-87`（profile 名 `Commit Dialog`；右边距来自各自检查的 `RIGHT_MARGIN`）、
`VcsConfiguration.java:73-74`（`USE_COMMIT_MESSAGE_MARGIN = true` / `WRAP_WHEN_TYPING_REACHES_RIGHT_MARGIN = false`）、`:131`（`CLEAR_INITIAL_COMMIT_MESSAGE = false`）、`:151`（`NON_MODAL_COMMIT_POSTPONE_SLOW_CHECKS = true`）、
`CommitMessage.java:300-302`（`getComment()` 只 `trimTrailing` 整条文本）`:323-342`（`RightMarginCustomization` 把 body 边距/显示/输入时换行喂给编辑器）、
`CommitDialogConfigurable.kt:56-101`（`Settings › Version Control › Commit`：清空信息框 + 提交信息检查面板 + 检查分组）、
`VcsBundle.properties:830,914-917,982,1156-1161`、`ide-core/resources/messages/ApplicationBundle.properties:450`。

实现（全部接真实链路，无空壳）：

1. **三类检查**（`src/commitMessageInspection.ts`）：主题行 > 右边距 → 「主题行不能超过 N 个字符」；第 2 行起的每行 > 右边距 → 「正文行不能超过 N 个字符」；第 2 行非空 → 「主题与正文之间缺少空行」。默认边距 72（两个检查各自的字段，都可配），`0..10000`。
2. **报告范围与 IDEA 完全一致**：只标出超出的那一段（`[rightMargin, lineLength)`），而不是整行；第 2 行的问题范围是整行（因为边距为 0）。UTF-16 计数（代理对 2 个字符），与 IDEA 的 `Document` 一致 —— 单测里用 `😀` 验证了范围会落在代理对中间。
3. **快捷修复与该检查一一对应**：主题 → 只有「重新格式化提交信息」；正文 → 「换行」+「重新格式化提交信息」；空行 → 「插入空行」+「重新格式化提交信息」。行号可点，点击即选中出问题的区间（`setSelectionRange`），对应 IDEA 里点问题高亮的跳转。
4. **「重新格式化提交信息」按源码重写**（更正第二十一批的偏离）：= 主题后补空行（若启用空行检查）+ 按正文右边距折行正文（若启用正文检查）；不改主题行、不做空白规整。
5. **输入达到右边距时自动换行**（默认关闭，同 IDEA）：输入时当前行到正文边距即按最后一个空格折行（无空格则在边距处硬断），光标随之移动；只处理光标所在行。为避免把程序性改动（历史信息、回滚、快捷修复、提交后清空）也重写，该钩子只在文本框已持有新文本（即用户输入）时生效。
6. **设置 › 版本控制 › 提交页**：三项开关 + 两个边距 + 输入时换行；值存 `taocode.commitMessageInspections`（容错解析，非法值逐字段回落到 IDEA 默认）。
7. **顺带修正应用/确定语义**：IDEA 的 Apply 不关窗，原先两个按钮共用会关窗的回调；现在保存回调带 `close` 参数（应用/Alt+A 只应用）。

**未做（有意，逐条有源码行号）**：显示右边距（`:73` + `CommitMessage.java:338-339`）需等宽字体才有确定列位置，见 A4 说明；
`settings.commit.postpone.slow.checks`（`:151`）与 `checkbox.clear.initial.commit.message`（`:131`，`AbstractCommitMessagePolicy.kt:47-53`）语义在本项目没有对应概念，见 A4 说明。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 221/221（204 → 221，新增 17 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.18s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑；顺带把新 dist 同步到 `build/ui`） |
| `ctest --output-on-failure` | 17/17（37.99s） |
| 启动冒烟 | ALIVE（`D:\TaoCode\build\TaoCode.exe` 存活过 15s） |

新增文件：`src/commitMessageInspection.ts`、`tests/commit-message-inspection.test.mjs`。

---

## 第三十七批验证记录（设置搜索历史：SearchTextField 历史下拉 / Alt+↑↓ / 失焦记录）

源码依据：`ui/SearchTextField.java:64`（`SHOW_HISTORY_KEYSTROKE = Alt+Down`）`:66-67`（`Alt+Up`）、
`:69`（`myHistorySize = 5`）、`:119-124`（前导 28px 区域单击开历史，非空历史才可点）、
`:173-195`（`showPrevHistoryItem` 在 `Alt+Up`、`showNextHistoryItem` 在 `Alt+Down`；索引从 0 起、**从不重置**，所以第一次 Alt+Down 落到第 2 条；两端回绕；`size < 2` 直接返回）、
`:233-235`（`onFocusLost` → `addCurrentTextToHistory`）、`:252-255`（historySize 必须为正）、
`:284-288`（`addElement` 返回 false 时不写入 `PropertiesComponent`）、`:318-336`（`reset()`：按 `\n` 拆分并丢掉空项）、
`:351-354`（模型只暴露 `min(historySize, size)` 条）、`:356-384`（`addElement` 全部规则）、
`:417-423`（选中回调：写入文本 + 再记录一次）、`:425-431`（`showPopup` 先记录当前文本）、`:433-438`（模型变化时弹层重开）、
`:440-461`（弹层：单选中、`setRequestFocus(true)`、无障碍名 `search.text.field.history.popup.accessible.name`、`setMovable(false)`）、
`:459`（`AlignedPopup.showUnderneathWithoutAlignment` 对齐到字段下方）、
`SettingsSearch.java:25`（`super("SettingsSearchHistory")`）、`SettingsSearch.java:50-52`（Esc 清空过滤，已在第二十九批实现）、
`platform-api/resources/messages/UIBundle.properties:381-382`（无障碍名 `Search` / `Search History`）。

实现：

1. **历史规则**（`src/searchHistory.ts`）：裁剪 + 空串不入库（`:357-360`）、忽略大小写查重（`:365`）、已在顶部则**完全不写入**（`:370-373` + `:285`）、靠后则移到顶部（`:374-377`）、满 5 条挤掉最旧（`:378-381`）、新项插到最前（`:382`）。
2. **存储格式与 IDEA 一致**：`getHistory()` 用 `\n` 连接写进属性（`:286`），`reset()` 按 `\n` 拆开并丢空项（`:322-330`）——直接搬进 localStorage。
3. **记录时机**：失焦（`:233-235`）、打开历史弹层前（`:425-426`）、选中历史项后（`:417-423`）。
4. **弹层**：单点搜索框左侧图标即开（等价 `:119-124` 的前导区），位置固定在字段下方左对齐（`:459`），最多 5 行、上下键移动选择、Enter 采用、鼠标悬停即选中、Esc 关弹层；弹层内带全屏遮罩点击关闭（与面包屑菜单同款做法）。
5. **Alt+↓ / Alt+↑**：分别是「打开历史」与「上一条」（`:64/:487-490` 的预处理优先于 `:194` 的动作映射，故 Alt+↓ 是弹层而不是"下一条"），循环时先把框内文本记入历史（`:176/:187`）。
6. **Esc 链顺序**：弹层 → 过滤 → 关窗（弹层在 IDEA 里抢焦点，所以最先被 Esc 关掉），接进 `handleEscape()`。

**有意偏差（已核实）**：载入时即把历史裁到 5 条 —— IDEA 的 `reset()` 不裁剪，导致弹层显示 5 条而 Alt+↑↓ 在更长的完整列表上循环（`:318-336` vs `:351-354`）；该状态在本项目不可达（唯一写入方就是这个框），故不复刻。

**未做（有意）**：行内历史补全（`JTextField.Search.InplaceHistory`，`:314`）由 LaF 的 `TextFieldWithPopupHandlerUI` 实现，其按键采纳语义不在已读源码内，不猜。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误（中途出现一次 `history` 与导航历史重名，已改名为 `searchHistory`） |
| `npm test` | 233/233（221 → 233，新增 12 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.27s |
| `build-native-locked.bat` | RC 0，0 error / 0 warning / 0 LOCK（本批无原生改动，仍全跑） |
| `ctest --output-on-failure` | 17/17（38.34s） |
| 启动冒烟 | ALIVE |

新增文件：`src/searchHistory.ts`、`tests/search-history.test.mjs`。

---

## 第三十八批验证记录（主工具栏中央：文件名 widget）

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **251/251**（233 → 251，新增 `tests/filename-widget.test.mjs` 18 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.21s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning，无 LOCK 超时（本批无原生改动，仅重拷 `dist → build/ui`） |
| `ctest --output-on-failure` | 17/17 |
| 启动冒烟 | `build/TaoCode.exe`（cwd=build）15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/filenameWidget.ts`（纯逻辑）、`tests/filename-widget.test.mjs`（18 条）。
**改动**：`src/App.vue`（文件名 widget 状态/计算属性/事件 + `git.status` 变更表缓存 + 保存后刷新 + Esc/遮罩接线）、`src/style.css`（`.filename-*`）。

## 第三十九批验证记录（设置页「新选项」点标记）

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **261/261**（251 → 261，新增 `tests/settings-badge.test.mjs` 10 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.23s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning，无 LOCK 超时 |
| `ctest --output-on-failure` | 17/17（37.92s） |
| 启动冒烟 | `build/TaoCode.exe`（cwd=build）15s 未退出 → ALIVE，随后干净终止 |

**新增文件**：`src/settingsBadge.ts`（纯逻辑）、`tests/settings-badge.test.mjs`（10 条）。
**改动**：`src/components/SettingsDialog.vue`（徽标计数读取/写入、`watch(section)` 记录、树上四处圆点标记 + `.settings-new-dot` 样式）。

## 第四十批验证记录（欢迎页通知工具条 + 通知中心共用件）

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **268/268**（261 → 268，新增 `tests/notices.test.mjs` 7 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.30s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning，无 LOCK 超时 |
| `ctest --output-on-failure` | 17/17（38.04s） |
| 启动冒烟 | `build/TaoCode.exe`（cwd=build）15s 未退出 → ALIVE，随后干净终止 |

**新增文件**：`src/notices.ts`、`src/components/NoticeList.vue`、`tests/notices.test.mjs`。
**改动**：`src/App.vue`（通知类型改从模块导入、`notify()` 用 `pushNotice`、状态栏 chip 与列表改用共用件/共用函数、给欢迎页传 `notices`）、`src/components/WelcomePage.vue`（通知按钮 + 弹层 + `.welcome-notifications` 样式）。

### 本轮判定不做（附源码行号，不是"没后端"就不做）

- `ChangesViewCommitTabTitleUpdater.kt:43-50`：提交页标题只在**同一工具窗口里有多个 content** 时才改写（`contentCount == 1` 时 `displayName = null`，用工具窗口自己的名字）。TaoCode 的每个工具窗口固定一个面板（`contentCount` 恒为 1），照搬等于什么都不做 → 记录为 N/A，不写装饰性分支。
- `ToggleAmendCommitOption.kt:19,23,37-38`：助记符 **Alt+M** 与 tooltip 文案（`VcsBundle.properties:1162-1163`）已在 `SourceControl.vue:521` 的标签里以「修改(M)」呈现；`isAmendCommitSupported()` 对 git 恒为 true（`GitAmendCommitService.kt:34`），因此"没有 HEAD 时禁用"**不是** IDEA 行为，未擅自添加。

## 第四十一批验证记录（提交选项：amend 助记符与分组）

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | 268/268（本批为交互接线，未新增纯逻辑模块） |
| `npx vite build --emptyOutDir false` | exit 0，5.27s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning，无 LOCK 超时 |
| `ctest --output-on-failure` | 17/17（38.02s） |
| 启动冒烟 | `build/TaoCode.exe`（cwd=build）15s 未退出 → ALIVE，随后干净终止 |

**改动**：`src/components/SourceControl.vue`（`ToggleAmendCommitOption.kt:19,23` 的 **Alt+M** 助记符真实绑定 + amend tooltip；提交选项按 `CommitOptionsPanel.kt:62-95` 分成 `Git` / `提交检查` 两组）、`src/style.css`（`.sc-options-group`）。

### 顺带的机械核对（状态栏 widget 注册表 ↔ IDEA `statusBarWidgetFactory` 扩展点）

把 IDEA 平台里注册的工厂逐个对照 TaoCode 的 `STATUS_WIDGETS`（15 项）后，**结论是没有遗漏**：

| IDEA 工厂（注册处） | TaoCode | 说明 |
|---|---|---|
| `Position` / `LineSeparator` / `Encoding` / `ReadOnlyAttribute` / `PowerSaveMode` / `InsertOverwrite`(=列选择) / `Notifications` / `Memory` / `SmartModeIndicator` | ✅ 同名 widget | 见 A5 各区 |
| `CodeStyleStatusBarWidget`（`intellij.platform.lang.impl.xml:1517`） | ✅ 缩进 widget | 点开设置编辑器页 |
| `WriteThread` / `VfsRefresh` / `IndexesAndVfsFlushIndicator` | N/A | 见 A5（无对应机制，不放假闪动） |
| `largeFileEncodingWidget` / `EditorAnimationCacheStatistics` / `FatalError` | N/A | 只服务大文件编辑器 / 内部统计 / 崩溃对话框 |
| `inspectionProfileWidget` | N/A | 需要 inspection profile 基础设施 |
| `IncomingChanges`（`VcsExtensions.xml:220`） | N/A | 面向有"待合并提交"概念的 VCS，Git 不注册 |
| `settingsEntryPointWidget`（`SettingsEntryPointAction.java:654-679`） | N/A | `isAvailableInStatusBar()`（`:642-650`）要求 **`!ExperimentalUI.isNewUI()`** —— New UI 下恒不可用，而 TaoCode 对齐的正是 New UI |
| `ToolWindowsWidget`（`IdeStatusBarImpl.kt:286-297`） | ✅ 工具窗口 widget | 不经工厂，已在第二十五批实现 |

### 关于 `AmendCommitModeDropDownLink.kt`

IDEA 在非模态提交面板的 amend 复选旁还有一个下拉链接（选择"改哪一次提交"）。TaoCode 的 amend 明确是"改写 HEAD、不选具体提交"（第二十八批已把这句话写进标签与文案），且原生 `git.commit --amend` 无 `--amend <commit>` 通道；本项留待有真实需求时再评估，不先造一个选不了的控件。

---

## 第四十二批验证记录（错误导航：F2 / Shift+F2，以及 F8 一键两用的修正）

源码依据：`platform/lang-impl/src/com/intellij/codeInsight/daemon/impl/GotoNextErrorHandler.java:64-208`（分层循环 `:64-91`、`findInfo` 四桶 `:93-114`、
`isBetterThan` `:116-132`、无高亮提示 `:134-163`、`navigateToError` `:165-198`、`getNavigationPositionFor` `:200-208`）、
`actions/GotoNextErrorAction.java:5-10` / `GotoPreviousErrorAction`、`BaseGotoNextErrorAction.java:22-63`（`isValidForFile:52-54`）、
`platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:376-377`（动作 id）、
`platform/platform-impl/resources/idea/PlatformActions.xml:609-617`（`GoToErrorGroup` 在 Navigate 菜单里的位置）、
`platform/platform-resources/src/keymaps/$default.xml:658-660`（F2）、`:679-681`（Shift+F2）、`:846-851`（F12 / F8）、
`"macOS System Shortcuts.xml":425,430`、`platform-resources-en/src/messages/ActionsBundle.properties:708-711`、
`analysis-impl/.../impl/SeverityRegistrar.java:47`（`SHOWN_SEVERITIES_OFFSET = 2`）、`:306-313`、`:433-440`、
`analysis-api/.../annotation/HighlightSeverity.java:43-119`（各级取值）、`:124-125`（`DEFAULT_SEVERITIES` 顺序）、`:193-195`（`compareTo`）、
`analysis-impl/.../daemon/DaemonCodeAnalyzerSettings.java:17`（`myNextErrorActionGoesToErrorsFirst = true`）、`:30-33`、
`platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:80-85`（LSP severity → IDEA severity 的权威映射）、
`analysis-api/resources/messages/InspectionsBundle.properties:151-152`（两条提示文案）、
`platform-impl/.../codeInsight/hint/HintManagerImpl.java:583-624`（`ABOVE` + `HIDE_BY_ANY_KEY | HIDE_BY_TEXT_CHANGE | HIDE_BY_SCROLLING`）、
`@codemirror/lint` 6.9.7 的 `lintKeymap`（`F8` → `nextDiagnostic`，库自带）。

实现（全部接真实链路）：

1. **`src/gotoNextError.ts`**（纯函数，无 Vue/DOM）：`errorTier`（LSP 1/2/其它 → IDEA ERROR/WARNING/WEAK_WARNING 三层）、
   `nextErrorTarget`（挑出**最高有内容的层**，层内按 `isBetterThan` 的严格比较取"光标之后最近 / 之前最近"，两端回绕；同偏移按文档顺序取靠前者），
   `NO_ERRORS_IN_FILE`。输入数组不被改写（`.slice()`）。
2. **`CodeEditor.vue`**：`goToError(forward)` = 取本文件诊断 → 算落点（`lspPosition`，即 IDEA 的 highlight start，`navigationShift` 为 0）
   → 清选区与多光标（`selection: { anchor }`）→ 居中滚动（`EditorView.scrollIntoView(pos, { y: 'center' })`）
   → 落点所在的折叠区自动展开（`foldedRanges` + `unfoldEffect`）；命令名 `error.next` / `error.previous` 进 `editorActions`，
   F2 / Shift+F2 绑在**只在该文件有语言服务器时才安装**的键位表里（对应 `isValidForFile:52-54`）。
3. **行上提示**：无高亮时在光标行**上方**给 `此文件中未发现错误。`，任何按键 / 文本改动 / 滚动即消失（`HintManagerImpl.java:611,624`）；
   行贴到视图顶端时翻转显示到该行下方，避免被 `.code-editor` 的 `overflow:hidden` 裁掉。
4. **`App.vue`**：Navigate 菜单按源码位置（Go to Line 之后、Jump to Last Change 之前）加「下一个高亮错误 F2」/「上一个高亮错误 Shift F2」，
   可用性 = 有活动文件且有语言服务器；两行都走 `runEditor('error.next'|'error.previous')`，与键盘同一条命令。
5. **F8 修正**：在 `basicSetup` **之前**加一条 `{ key: 'F8', run: () => true }`，把 `@codemirror/lint` 的 `nextDiagnostic` 遮掉
   （CodeMirror 的 `keymap` 是普通 facet，靠前者得键；它只 `preventDefault` 不 `stopPropagation`，所以窗口级的调试单步照常收到该键）。

**未做（有意，已附源码行号）**：`:136-142` 的「分析尚未结束」分支（TaoCode 的 `lspDiagnostics` 在 `lsp.open` 时就建键，空数组区分不了"已发布且无问题"与"还没发布"）；
`Mod-Shift-m`（CodeMirror `openLintPanel` vs IDEA `EditorMatchBrace`，`$default.xml:1146-1148`）—— CodeMirror 6 不导出括号匹配命令，自己写纯文本配对器属发明语义，登记在 `docs/source-todo.md` §5。
**有意偏差（已核实）**：`navigationShift` / `isAfterEndOfLine` 的 `+1` 不需要，见 A2 条目说明。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **284/284**（268 → 284，新增 `tests/goto-next-error.test.mjs` 16 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.41s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning，无 LOCK 超时（本批无原生改动，仅重拷 `dist → build/ui`） |
| `ctest --output-on-failure` | 17/17（38.61s） |
| 启动冒烟 | `build/TaoCode.exe`（cwd=build）15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/gotoNextError.ts`（纯逻辑）、`tests/goto-next-error.test.mjs`（16 条）。
**改动**：`src/components/CodeEditor.vue`（导入 `foldedRanges`/`unfoldEffect`、`goToError`、行上提示与三种消失时机、`editorActions` 两条命令、F2/Shift-F2 键位、`basicSetup` 前的 F8 遮挡、模板与样式绑定）、`src/App.vue`（Navigate 菜单两行）、`src/style.css`（`.code-editor { position: relative }` + `.editor-hint`）。

---

## 第四十三批验证记录（裸 F12 = JumpToLastWindow，Ctrl+F12 / Ctrl+Shift+F12 解耦）

**起因（审计出的真实缺陷）**：窗口级处理器在 `event.key === 'F12'` 之前有一条
`if (!(event.ctrlKey || event.metaKey) && !event.altKey) return`，裸 F12 两者都不带 → **直接早退**，
所以 IDEA 的 `JumpToLastWindow` 在 TaoCode 里完全不存在；而写在它后面的 `Ctrl+F12` 分支又不看 `Shift`，
于是 `Ctrl+Shift+F12` 被它抢走，再后面的 `toggleMaximizeEditor` 成了「只在没有语言服务器时才会命中」的死分支。

源码依据：`platform/platform-resources/src/keymaps/$default.xml:846-848`（F12 = `JumpToLastWindow`）、
`:279-281`（Ctrl+F12 = `FileStructurePopup`）、`:870-872`（Ctrl+Shift+F12 = `HideAllWindows`）、`:368-370`（Alt+F12 = `ActivateTerminalToolWindow`）、
`platform/platform-impl/src/com/intellij/ide/actions/JumpToLastWindowAction.java:17-50`（`actionPerformed:19-30`、`update:32-44`）、
`platform/platform-impl/src/com/intellij/openapi/wm/impl/ActiveStack.java:15-95`（双栈、`push:64-68`、`peekPersistent:78-80`、`remove:89-94`）、
`platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt:746-753`（`lastActiveToolWindowId` = persistent 栈顶第一个 `isAvailable`）、
`:641` / `:679`（激活 / 聚焦时 push）、`:711-718`（`setHiddenState` → `remove(entry, false)`：隐藏不动 persistent 栈）、`:1217`（注销才 `remove(entry, true)`）、
`platform/platform-impl/resources/idea/PlatformActions.xml:653-660`（`ActiveToolwindowGroup` 中 `JumpToLastWindow` 位于 `PinToolwindowTab` 与 `MaximizeToolWindow` 之间）、
`platform-platform-resources-en/src/messages/ActionsBundle.properties:1143-1144`（`_Jump to Last Tool Window` / `Activate the last focused tool window`）。

实现：

1. **`src/activeToolWindow.ts`**（纯逻辑）：`pushActive`（去重置顶，返回新数组）、`removeActive`（注销用）、
   `lastActiveId(stack, available)`（从栈顶往下取第一个可用项，空 / 全不可用返回 `undefined`）。只移植 persistent 栈——
   short 栈在 TaoCode 没有消费方；栈不做 localStorage 镜像，因为 `ActiveStack` 本身不持久化。
2. **`App.vue` 激活点接真实消费链**：`showView` / `showOutput` 末尾记一次；`activateToolWindow`（条纹点击，本身是 toggle）
   只在**带前**的分支记（第二次点击是隐藏，按 `:711-718` 不得改动 persistent 栈）；底部 8 个页签按钮与状态栏「问题」
   「SmartMode」两个组件从内联赋值改为走 `showOutput` / `showView`，因此自动进入同一条记录路径。
3. **可用性**：左停靠窗口用现成的 `toolDisabled`，底部页签镜像各自 tab 按钮的 `v-if`（references / hierarchy / blame 需要内容）。
4. **动作**：`jumpToLastToolWindow()` 走非 toggle 的带前路径（左：`focusToolWindowContent`，底：`showOutput`）；
   菜单行 `window.jumpToLastToolWindow`（F12）的 `enabled` = `lastActiveId(...) !== undefined`，对应 `update():32-44` 的自我禁用。
5. **键位**：裸 F12 分支前置到早退之前并显式排除 Shift；`Ctrl+Shift+F12` 分支前移到 `Ctrl+F12` 之前且后者加 `!event.shiftKey`。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **293/293**（284 → 293，新增 `tests/active-tool-window.test.mjs` 9 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.32s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.38s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/activeToolWindow.ts`、`tests/active-tool-window.test.mjs`（9 条，其中 2 条是源码级断言：F12 三种绑定的**相对顺序**、以及激活路径必须经由共享助手记录）。
**改动**：`src/App.vue`（import、`LeftViewId` / `BottomTabId` 别名、persistent 栈与 `toolWindowAvailable` / `jumpToLastToolWindow`、`activateToolWindow` / `showView` / `showOutput` 记录、底部页签与两处状态栏组件改走助手、F12 三条分支、Window 菜单新行、帮助对话框补「跳到上一个工具窗口 F12」）。

**踩到的坑**：源码级测试里把变参助手当成数组形参调用（`find(['a','b'])` 实际是「在行里找字符串 `a,b`」），
断言静默失败在 `-1` 上。教训：**变参助手必须用展开的位置实参调用**；这类「断言本身写错」要靠插桩打印实际索引才能定位。

---

## 第四十四批验证记录（Window 菜单 LayoutsGroup：命名工具窗口布局 + Shift+F12）

源码依据：`platform/platform-impl/resources/idea/PlatformActions.xml:641-651`（`LayoutsGroup` 的六项与顺序：
`RestoreFactoryDefaultLayout` · 分隔 · `CustomLayoutsGroup` · 分隔 · `RestoreDefaultLayout` · `StoreDefaultLayout` · `StoreNewLayout`）、
`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:770-775`（动作类注册）、
`:776-778`（`RestoreFactoryDefaultLayout`：`update:27-38` / `setSelected:29-35`）、
`platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDefaultLayoutManager.kt:46-47`（`INITIAL_LAYOUT_NAME = "Custom"` / `FACTORY_DEFAULT_LAYOUT_NAME = ""`）、
`:54-58`（`activeLayoutName`）、`:60`（`getLayoutNames`）、`:62-64`（`getLayoutCopy` / `getFactoryDefaultLayoutCopy`）、
`:70-82`（`setLayout`：存到空名会改名，否则写回同名布局）、`:84-91`（`renameLayout` / `deleteLayout`）、`:117`（`loadState` 丢弃空名条目）、
`ide/actions/StoreNamedLayoutAction.kt:22-25`、`StoreNewLayoutAction.kt:25-32`、`RenameLayoutAction.kt:28-48`、`DeleteNamedLayoutAction.kt:24-40`（删除当前布局被禁用）、
`CustomLayoutsActionGroup.kt:45-96`（每个布局是一个子菜单：Apply / Restore / Save / Rename / Delete，`update` 里用 `Toggleable.setSelected(activeLayoutName == layoutName)` 表达选中态）、
`actions/LayoutNameInputDialog.kt:84-118`（校验：空 → 禁用确定、超长 → 立即报错、重名 → 按确定时报错且不关窗）、
`platform/util/resources/misc/registry.properties:2198`（`ide.max.tool.window.layout.name.length = 50`）、
`platform/platform-api/resources/messages/IdeBundle.properties:426-431`（三条文案）、
`platform-resources-en/src/messages/ActionsBundle.properties:1085-1107`（`Default` / `_Restore Current Layout` / `_Save Changes in Current Layout` / `Save Current Layout as _New…`）、
`$default.xml:864-866`（Shift+F12 = `RestoreDefaultLayout`）。

实现：

1. **`src/toolLayout.ts`**（纯逻辑）：出厂默认名 = 空串且不入表、`saveLayout` 存到空名时改名为「自定义」、
   `setActiveLayout` / `renameLayout` / `deleteLayout`（删当前布局被拒）、`resolveLayout`、`layoutNames`、
   `normalizeToolLayout`（逐字段容错：布尔 / 正数尺寸 / 锚边取值都单独校验，坏字段回落到出厂值）、`normalizeLayoutStore`（丢空名条目、活跃名不存在则回到出厂默认）、
   `layoutNameError`（50 字符 / 重名）。
2. **四条动作 + 动态列表**（Window 菜单，位置按源码插在「搜索任何地方」之后的菜单顶部）：`window.factoryLayout`（toggle）、
   `window.layout.<名字>`（列表，选中态 = 当前）、`window.restoreLayout`（**Shift F12**）、`window.storeLayout`、
   `window.storeLayoutAs`、`window.renameLayout` / `window.deleteLayout`（只在非出厂默认时出现）。
   列表是动态行，因此 `allMenuGroups` 里把 `layoutMenuRows.value` 拼进 Window 菜单的静态数组（`windowRows.splice(afterSearch, 0, ...)`）。
3. **快照**：`captureToolLayout` 覆盖 `explorer` / `bottom` / `view` / `tab` / 每个窗口的 `anchors` / 条带 `order` / 三个 `sizes`；
   `applyToolLayout` 写回时校验视图 id 与底部页 id、把未记录的窗口补在左条带尾部（与顺序加载器同一条规则）、
   尺寸走 `setPanelSize`（同一套 clamp 与「按窗口记尺寸」分支）、顺序走 `saveToolOrder`。
4. **命名对话框复用**：`nameDialog` 增加 `newLayout` / `renameLayout` 两个 mode（`nameDialogTitle` / `isLayoutDialog` 两个 computed 承担标题与「不显示路径行」），
   重名 / 超长时**保持对话框打开并就地提示**（`LayoutNameInputDialog.kt:114-118`：按确定返回 false 则不关窗）。

**未做 / 有意偏差（已附行号）**：`CustomLayoutActionGroup` 的**子菜单**结构（每个布局名下的 Apply / Restore / Save / Rename / Delete）——
TaoCode 的 `MenuRow` 没有 children，只有 `rule` / `section` 两种分段。扁平菜单能表达的部分已实现（列表项点击 = Apply，Rename / Delete 作用于当前布局，Save 由两条全局行承担）；
要 1:1 复刻需先给菜单模型加子菜单支持，登记在 `docs/source-todo.md` §6。
`RestoreFactoryDefaultLayout` 的 `update` 在**主菜单**里会把自身隐藏（改成往当前布局子菜单里加一项）——
TaoCode 保留常驻 toggle 行，因为它就是扁平菜单里「回到出厂布局」的唯一入口。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **304/304**（293 → 304，新增 `tests/tool-layout.test.mjs` 11 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.34s（产物里可 grep 到「恢复当前布局」，确认进包） |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.04s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/toolLayout.ts`、`tests/tool-layout.test.mjs`（11 条，其中 2 条为源码级断言：Shift+F12 必须在早退之前、快照字段与写回路径必须成对）。
**改动**：`src/App.vue`（import、布局存储与 `captureToolLayout` / `applyToolLayout` / 四条动作、`layoutMenuRows` computed、`allMenuGroups` 拼接、
Shift+F12 键位、`nameDialog` 两个新 mode 与 `applyNameDialog` 分支、帮助对话框补「恢复当前布局 Shift F12」）。

---

## 第四十五 / 四十六批验证记录（WindowMenu › ActiveToolwindowGroup 收尾：隐藏、页签导航、关闭页签）

源码依据：`platform/platform-impl/resources/idea/PlatformActions.xml:635-637`（`MinimizeCurrentWindow` / `ZoomCurrentWindow` / `MoveWindowBuiltinDisplayAction` 位于 `LayoutsGroup` 之前）、
`:653-665`（`ActiveToolwindowGroup` 的完整顺序：HideActiveWindow, HideSideWindows, HideBottomWindows, HideAllWindows, PinToolwindowTab, JumpToLastWindow, MaximizeToolWindow, DockToolWindow, 分隔, NextTab, PreviousTab, CloseActiveTab, TW.CloseOtherTabs）、
`intellij.platform.ide.impl.actions.xml:441-442`（窗口两个动作）、`:445-447`（三个 Hide）、`:455`, `:458`, `:459-460`（PinToolwindowTab / DockToolWindow / CloseActiveTab / TW.CloseOtherTabs）、
`ide/actions/HideToolWindowAction.kt:15-33`（`shouldBeHiddenByShortCut` = `isVisible && type.isInternal`；`actionPerformed:21-29` = `activeToolWindowId ?: lastActiveToolWindowId`）、
`openapi/wm/impl/ToolWindowTypeExtensions.kt:9-10`（`isInternal = SLIDING || DOCKED`）、
`ide/actions/HideSideWindowsAction.kt:18-25`、`HideBottomToolWindowsAction.kt:19-24`（`anchor == BOTTOM`）、
`ide/actions/TabNavigationActionBase.java:50-78`（焦点在编辑器就切编辑器页签，否则切工具窗口内容）、`:187-201`（启用条件 > 1）、
`ui/content/impl/ContentManagerImpl.java:621-646`（`selectPreviousContent` / `selectNextContent` 的回绕与 `index = -1` 起点）、
`ide/actions/CloseActiveTabAction.java:39-58`（先关可关闭内容，关不掉就隐藏工具窗口）、
`ide/actions/ToolWindowCloseOtherTabsAction.kt:17-35`、
`$default.xml:260-262`（Ctrl+Shift+F4 = `CloseActiveTab`）、`:309-311` / `:717-719`（Alt+Left/Right）、`:867-869`（Shift+Esc）、
`macOS System Shortcuts.xml:170-172`（`ReopenClosedTab` 只在 macOS 键位表里有 `meta shift T`，`$default.xml` 里无键位）、
`ActionsBundle.properties:1111-1115`, `:1133-1138`, `:1194-1197`, `:1204-1207`。

实现：

1. **`focusedDock()`** 提供 IDEA `activeToolWindowId` 的等价物：焦点元素属于 `.output-panel` → bottom，`.explorer-panel` → side，其余（编辑器 / 条纹按钮 / 菜单 / 浮层）→ editor，并由 `lastActiveId` 回落到 persistent 栈顶。
2. **三个 Hide**：`hideActiveToolWindow()`（`HideToolWindowAction.kt:21-29`）、`hideSideToolWindows()`（`explorer = false`）、`hideBottomToolWindows()`（`bottom = false`），三行菜单按源码插在 `HideAllWindows` 之前；启用条件分别是"当前 dock 可见 / 侧边可见 / 底部可见"。
3. **`Alt+← / Alt+→`**：`cycleTab(step)` 按 `TabNavigationActionBase.java:50-78` 分流；底部页签列表用 `bottomTabAvailable`（= 各页签按钮自己的 `v-if`，`toolWindowAvailable` 改为复用它）；回绕算术照 `ContentManagerImpl:621-646` 提取成纯函数 `nextContentIndex` 并单测（含 `index = -1` 时按下一条会落到 `count - 2` 的真实怪癖）。`CodeEditor.vue` 前置 keymap 遮掉 CodeMirror 的 `Alt-ArrowLeft/Right`（`cursorSyntaxLeft/Right`），否则一次按键既切页签又跳光标。
4. **`Ctrl+Shift+F4` = `CloseActiveTab`**：底部面板焦点下先清可关闭内容（references / hierarchy / blame），否则收起面板，对应 `CloseActiveTabAction.java:50-55` 的 `processed` 逻辑；编辑器焦点下关闭当前编辑页签。「重新打开已关闭标签页」按 `$default.xml` 的真实情况去掉快捷键（保留菜单入口）。
5. **`TW.CloseOtherTabs`**：`closeOtherToolTabs()` 清掉非当前的可关闭内容，`closeOtherTabsTarget()` 作为启用条件。
6. Editor 工具栏「后退 / 前进」的 `title` 从 `(Alt ←)` 改为 `(Ctrl Alt ←)`，与真实绑定一致（源码复核：`$default.xml:296-299` = `control alt LEFT` + `button4`、`:901-904` = `control alt RIGHT` + `button5`，**没有裸 `Alt+←/→`**，见第四十七批）。

**判定不做（附理由）**：`PinToolwindowTab`（底部页签是固定视图，没有"被新标签挤掉"的对象）、`DockToolWindow`（TaoCode 没有浮动工具窗口）。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **309/309**（304 → 309，`tests/active-tool-window.test.mjs` 9 → 14 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.25s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.07s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**改动**：`src/activeToolWindow.ts`（新增 `nextContentIndex`）、`src/components/CodeEditor.vue`（遮 `Alt-ArrowLeft/Right`）、
`src/App.vue`（`focusedDock` / 三个 Hide / `bottomTabAvailable` / `tabTargetCount` / `cycleTab` / `selectNextTab` / `selectPreviousTab` / `closeActiveTab` / `closeOtherToolTabs`；
`toolWindowAvailable` 改为复用 `bottomTabAvailable`；Shift+Esc 与 Alt+←/→ 两条键位；Ctrl+Shift+F4 改绑；Window 菜单新增 6 行；帮助对话框补 3 条；两处 `title` 修正）、`tests/active-tool-window.test.mjs`（+5 条）。

**踩到的坑**：源码级断言里用"整行包含多个片段"的方式找代码，遇到**跨两行的 `if`** 就会失配（换行后的续行不含首行的条件文本）；
另外 `lines.findIndex(l => l.includes("if (event.key === 'Escape') {"))` 会命中文件里**更早的**同名处理器。教训：
断言必须锚定到目标函数体内（先定位 `function onKey(...)` 再在其后查找），不要假设"第一个匹配就是它"。

---

## 第四十七批验证记录（`TW.CloseAllTabs` + `HideAllWindows` 改成源码里的双文案 toggle；§7 / §8 三条待决结案）

源码依据：`platform/platform-impl/src/com/intellij/ide/actions/ToolWindowCloseAllTabsAction.kt:10-23`、
`ToolWindowCloseOtherTabsAction.kt:10-27`、`ui/content/impl/ContentManagerImpl.java:472-481`（`canCloseAllContents` = `canCloseContents() && any isCloseable`）、
`:140-142`（`canCloseContents()` 返回构造期标志）、`ContentFactoryImpl.java:21`、
`ui/content/impl/ContentImpl.java:237-239`（`isCloseable()`）、`toolWindow/ToolWindowHeadlessManagerImpl.java:474-481`（无头管理器硬返回 false）、
`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:462`（`TW.CloseAllTabs`，`use-shortcut-of="CloseAllEditors"`）、`:494`（`CloseAllEditors` 定义）、
`resources/idea/PlatformActions.xml:666`（`TW.CloseAllTabs` 紧跟 `TW.CloseOtherTabs`）、
`ActionsBundle.properties:1206-1209`（`Close _Other Tabs` / `Close _All Tabs` 及其 description）、
`ide/actions/HideAllToolWindowsAction.kt:13-52`（`actionPerformed:14-32` 快照 `layoutToRestoreLater` 后隐藏；`:17-22` 恢复并清空该字段；`update:34-49` 两段文案 + 无可隐藏且无可恢复时 `isEnabled = false`）、
`platform-api/resources/messages/IdeBundle.properties:384-385`（`action.hide.all.windows` / `action.restore.windows`）、
`ide/actions/MacWindowActionBase.java:27`（`p.setVisible(SystemInfo.isMac)`）、`:38-40`（非 macOS `setEnabled(false)`）、
`$default.xml:296-299`（`Back` = `control alt LEFT` + `button4`）、`:901-904`（`Forward` = `control alt RIGHT` + `button5`）、`:868-870`（`HideAllWindows` = `control shift F12`）。

实现：

1. **新增 `src/toolTabs.ts`**（纯逻辑）：把工具窗口条带的**内容集合**按 `ContentManager` 建模 —— `CLOSEABLE_TOOL_TABS`（references / hierarchy / blame，条带序）、
   `isCloseableToolTab`（`Content.isCloseable()` 的收窄判据）、`presentCloseableTabs`、`canCloseAllContents`、`canCloseOtherContents`、
   `tabsCloseAllWouldRemove`、`tabsCloseOtherWouldRemove`；并保留源码的**双因子**形状（`CAN_CLOSE_CONTENTS` 常量 + `any isCloseable`），
   注释写明它在 TaoCode 恒为 `true` 的原因（唯一的条带确实持有可关闭内容，与无头管理器 `:474-481` 相反）。
   `active` 参数**不收窄**成可关闭 id：源码比较的是"动作被调用的那个 content"，Output 这类不可关闭内容也是合法目标，此时整组都被清掉。
2. **`TW.CloseAllTabs` 真正落地**：`closeAllToolTabs()` / `closeAllTabsTarget()` 接上菜单行 `window.closeAllTabs`，位置就在 `window.closeOtherTabs` 之后（`PlatformActions.xml:666`）。
   **不给快捷键**：它借的是 `CloseAllEditors` 的键，而 `$default.xml` 里 `CloseAllEditors` / `CloseAllEditorsButActive` **一条键位都没有**（已 grep 全文），自造绑定就是发明语义。
3. **三条移除路径收敛到同一份模型**：`closeActiveTab` / `closeOtherToolTabs` / `closeAllToolTabs` 现在共用 `toolTabPresence()` + `clearToolTab()` +
   模块里的三个函数，不再各写一套 `bottomTab !== 'x'` 判断（那正是它们可能互相跑偏的地方；`tests/active-tool-window.test.mjs` 新增反向断言禁止回退）。
4. **`HideAllWindows` 补上 ToggleAction 语义（真缺陷）**：`savedChrome` 由普通 `let` 改为 `ref<ToolWindowChrome | null>(null)`，行标题改为
   `hideAllToolWindowsTitle(...)` —— 有窗口可见时「隐藏所有工具窗口」、只剩已保存布局时「恢复窗口」（`IdeBundle.properties:384-385` 原文），
   启用条件 `canHideAllToolWindows` 两条都没有时禁用（`:36, :48`）；恢复时**先清空快照再写回**（`:19-21`），不再拿一份从未拍过快照的默认值去"恢复"。
5. **删掉 View 菜单里的 `view.maximizeEditor`**：ViewMenu（`PlatformActions.xml:521-597`）整段没有 maximize/hide-all 项，该动作唯一的入口是 Window 菜单的 `HideAllWindows`（`:656`）。
   此前那行与 `window.hideAllWindows` 同标题前缀、同 `Ctrl Shift F12`，是同一动作的第二张脸；现已删除并留注释说明来源。

**结案（原先登记为待决的两条）**：§8-1 `Alt+←/→` 的旧提示文案 —— `$default.xml` 里 `Back` / `Forward` 只有 `control alt` + 鼠标键，**没有裸 `Alt+←/→`**，
第四十五/四十六批把 tooltip 改成 `(Ctrl Alt ←)` 是正确修复；§8-2 `HideAllWindows` 的 ToggleAction 语义 —— 如上第 4 条已按源码实现（不是"两行合并成一行"的问题，而是那一行本身要会翻文案）。
**判定不做（新，附理由）**：`MinimizeCurrentWindow` / `ZoomCurrentWindow` 在**非 macOS 上根本不可见**（`MacWindowActionBase.java:27` 的 `setVisible(SystemInfo.isMac)`，
`:38-40` 非 mac 直接 `setEnabled(false)`；键位只存在于 `Mac OS X.xml`），Windows 上的最小化/最大化走自定义标题栏按钮。
原计划新增原生 `window.minimize` / `window.zoom` 通道 = 给 Windows 加一个 IDEA 在 Windows 上不显示的动作，**作废**。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **319/319**（309 → 319，新增 `tests/tool-tabs.test.mjs` 10 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.28s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.43s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/toolTabs.ts`、`tests/tool-tabs.test.mjs`（10 条，含 4 条源码级断言：`CLOSEABLE_TOOL_TABS` 序 == App.vue `BOTTOM_TABS` 过滤后序、
菜单行紧随 `TW.CloseOtherTabs` 且无键位、三条移除路径都必须走共用模型、`HideAllWindows` 只能有一行且先快照后恢复）。
**改动**：`src/App.vue`（import、`toolTabPresence` / `clearToolTab` / `closeActiveTab` / `closeOtherToolTabs` / `closeOtherTabsTarget` / `closeAllToolTabs` / `closeAllTabsTarget`、
`currentChrome` / `toggleMaximizeEditor` / `savedChrome` 改 ref、菜单新增 `window.closeAllTabs` 一行、`window.hideAllWindows` 改双文案与启用条件、删除 `view.maximizeEditor`）、
`tests/active-tool-window.test.mjs`（改写 CloseOtherTabs 那条断言，锚定到共用模型）。

---

## 第四十八批验证记录（`ResizeToolWindowGroup` 四行 + 工具窗口分屏组判定不做）

源码依据：`platform/platform-impl/resources/idea/PlatformActions.xml:677-683`（`ActiveToolwindowGroup` 末尾：`TW.ViewModeGroup` · `TW.MoveToGroup` · `ToggleContentUiTypeMode` · `ShowContent` · **`ResizeToolWindowGroup`** = `ResizeToolWindowLeft/Right/Up/Down`）、`:668-675`（分屏组）、
`intellij.platform.ide.impl.actions.xml:481-486`（`ToggleContentUiTypeMode` / `ShowContent` / 四个 `ResizeToolWindowAction$*`）、`:463-478`（`TW.SplitRight` … `TW.Unsplit`、`TW.MoveToNextSplitter/Previous`）、
`ide/actions/ResizeToolWindowAction.java:93-118`（`update` 的总开关：编辑器持有焦点 → `setEnabledAndVisible(false)`；`:52-56`）、`:67-80`（窗口不可用 / 不可见 / 浮动 / 独立窗口 → 不可见）、`:83-87`（`getToolWindow` = 动作所在窗口，回落 `LAST_ACTIVE_TOOL_WINDOWS[0]`）、
`:127-131`, `:144-148`（Left/Right 启用条件 = `!anchor.isHorizontal()`）、`:161-165`, `:178-182`（Up/Down = `anchor.isHorizontal()`）、`:107-121`（`stretch` 的符号算术与其轴向 no-op 分支）、
`openapi/wm/ToolWindowAnchor.java:49-51`（`isHorizontal()` = TOP || BOTTOM）、
`ide/actions/WindowAction.java:96-98`（步长 = 首选尺寸 × registry 值）、`:113-118`（`getPreferredDelta()` = `JLabel("W")` 的首选尺寸）、`platform/util/resources/misc/registry.properties:205-208`（`ide.windowSystem.hScrollChars` / `vScrollChars` = 5）、
`$default.xml:873-884`（`control alt shift LEFT/RIGHT/UP/DOWN`）、`ActionsBundle.properties:1179-1186`（`Stretch to Left/Right/Top/Bottom` + description）、
`ide/actions/ToolWindowSplitActions.kt:16-27`、`ToolWindowSplitAndMoveActions.kt:11-25`、`ToolWindowUnsplitAction.kt:11-24`、`ToolWindowMoveToSplitterActions.kt:28`、`toolWindow/ToolWindowSplitContentProvider.kt:11-14,32-35`（`@ApiStatus.Experimental` 扩展点）、`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:95`（全树唯一的 provider 注册）、`openapi/wm/impl/ToolWindowImpl.kt:710-716`（`canSplitTabs()`）。

实现：

1. **新增 `src/toolWindowResize.ts`**（纯逻辑）：`anchorIsHorizontal`（TOP/BOTTOM）、`resizeDirectionEnabled`（Left/Right 对垂直锚、Up/Down 对水平锚）、`stretchSign` / `stretchDelta`（把 `stretch` 的 `isIncrementAction` 算术逐条搬过来，含轴向不匹配返回 0）、`RESIZE_CHARS = 5`。`ToolWindowAnchor` 里保留 `top`，因为源码的算术对 TOP 与 BOTTOM 不同；TaoCode 没有顶部 dock，调用方只传 left/right/bottom。
2. **四行菜单 + 区段**：`window.sectionResizeToolWindow`（「调整工具窗口」，TaoCode 菜单是扁平的，按既有惯例把 popup group 变成区段标题）+ `window.resizeToolWindowLeft/Right/Up/Down`，键位照 `$default.xml:873-884`，标题取 `ActionsBundle` 的 `Stretch to …` 语义（「向左/右/上/下拉伸」）。
3. **动作对象与启用**：`resizeTarget()` 用 `focusedDock()` 拿当前激活的 dock（编辑器有焦点 → 整个动作不可用，对应 `:52-56`），底部 dock → `output` + anchor `bottom`，侧边 dock → `explorer` + `activeAnchor`（left/right）；`resizeTargetFor(direction)` 再叠上轴匹配规则，直接作为菜单行的 `enabled`，所以"点不到不可用的方向"。
4. **步长实测而非写死**：隐藏探针 `<span>W</span>` 的 `getBoundingClientRect()` 取字宽（水平）或行高（垂直），字体族/字号/字重/行高全部抄 `body` 的计算样式 —— 与 `getPreferredDelta()` 的 `JLabel("W")` 同一语义，并自动跟随「界面字体」设置；再乘 `RESIZE_CHARS`。
5. **写回走已有通道**：`setPanelSize(target.panel, 当前值 + stretchDelta(...))`，因此沿用的是同一套 clamp（`appearance.ts:clampPanelSize`）与「按工具窗口记尺寸」逻辑，也和 `toolLayout` 快照、分隔条拖拽同源。
6. **顺带修一处键位遮蔽**：`Ctrl+Alt+Shift+←/→` 是 `Ctrl+Alt+←/→`（Back/Forward）的超集，而后者原本不看 Shift → 四条新键位会被完全吞掉。已给 Back/Forward 加上 `!event.shiftKey`（与 F12 那次是同一类问题），并给分隔条的 `resizeKey` / `resizeSplitKey` 加上"带修饰键的箭头不是分隔条的"守卫，避免和弦同时触发两处尺寸变化。

**判定不做（新，附理由）**：`TW.SplitRight` / `SplitAndMoveRight` / `SplitDown` / `SplitAndMoveDown` / `Unsplit` / `MoveToNextSplitter` / `MoveToPreviousSplitter` —— 七个动作都额外要求 `canSplitTabs()` **且**该工具窗口 id 注册了 `ToolWindowSplitContentProvider`（`@ApiStatus.Experimental` 扩展点，全树只有终端前端插件注册）。没有 provider 的工具窗口 `isEnabledAndVisible = false`，即平台自带工具窗口里这些项**根本不可见**；TaoCode 没有"复制一份内容分屏"的对象，做出来就是发明语义。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **326/326**（319 → 326，新增 `tests/tool-window-resize.test.mjs` 7 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.27s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.23s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/toolWindowResize.ts`、`tests/tool-window-resize.test.mjs`（7 条：轴向判定、四锚 × 四方向共 16 组的启用矩阵、方向即分隔条行进方向（左/右 dock 互为镜像）、轴向不匹配为 no-op、步长符号、源码级断言"四行存在且有序 + 键位正确 + 走 `setPanelSize` + `RESIZE_CHARS` 参与 + Back/Forward 必须排除 Shift"）。
**改动**：`src/App.vue`（import、`resizeTarget` / `resizeTargetFor` / `resizeStep` / `stretchToolWindow`、菜单区段 + 四行、`onKey` 里在 Back/Forward **之前**插入 `Ctrl+Alt+Shift+箭头` 分支并给 Back/Forward 加 `!event.shiftKey`、`resizeKey` / `resizeSplitKey` 加修饰键守卫）。

---

## 第四十九批验证记录（`ToggleContentUiTypeMode` 落地为真实的 COMBO 内容视图；菜单"活动工具窗口"判据修正）

源码依据：`platform/platform-impl/resources/idea/PlatformActions.xml:680`（`ToggleContentUiTypeMode`，位于 `TW.MoveToGroup` 与 `ShowContent` 之间）、
`intellij.platform.ide.impl.actions.xml:481`（注册）、`ide/actions/ToggleContentUiTypeAction.java:8-21`（`isSelected` = `type == TABBED`、`setSelected` = `state ? TABBED : COMBO`、`update` = `getContentCount() > 1`）、
`ide/actions/BaseToolWindowToggleAction.java:31-37, 60-95`（`ToggleAction` + 一律取 `manager.getActiveToolWindowId()`，**没有** last-active 兜底）、
`openapi/wm/ToolWindowContentUiType.java:12-13, 33-45`（`TABBED` / `COMBO`，`getInstance` 对未知名字回落到 TABBED）、
`openapi/wm/impl/content/ContentComboLabel.java`（COMBO 的渲染物是下拉框）、
`openapi/wm/impl/ToolWindowImpl.kt:511-515`（`setContentUiType` → `toolWindowManager.setContentUiType`）、`:521`（`getContentUiType()` 读 `windowInfo.contentUiType`，即随布局持久化）、`:934-958`（**同 id 的第二个 action**：每个工具窗口自己的齿轮菜单里那份，选中态是 **COMBO**，可见性用粘性的 `hadSeveralContents`；菜单里那份是注册版，本批只实现注册版）、
`wiki/默认布局`：`toolWindow/defaultToolWindowlayoutProvider.kt:238, 263`（Project / Notifications 默认 COMBO）、`projectView/frontend/src/window/ProjectViewToolWindowServiceImpl.kt:127`（`setDefaultContentUiType(COMBO)`）—— 说明 COMBO 不是遗留模式，而是平台自带的默认之一、
`ide/actions/ShowContentAction.java:37-46`（文案按类型切换）、`ActionsBundle.properties:1167-1177`（`Group Tabs` / `Toggle between tabbed/combo presentation of contents` / `Show List of Tabs` / `Show List of Views`）。

实现：

1. **新增 `src/toolWindowContentUi.ts`**（纯逻辑）：`resolveContentUiType`（未知值回落 TABBED，对齐 `getInstance`）、`isTabbedContentUi`（选中态 = TABBED，**不是** COMBO）、`toggledContentUiType`、`canToggleContentUiType`（内容数 > 1）、`contentCountLabel`。
2. **菜单行 `window.toggleContentUiType`**（标题取动作原文「合并标签页」= `Group Tabs`）：`checked` = 当前是 TABBED、`enabled` = 活动工具窗口内容数 > 1、`run` 翻转类型；类型存 `taocode.toolWindowContentUi`（对应 `windowInfo.contentUiType` 随布局走），载入时经 `resolveContentUiType` 校验。
3. **真实渲染**：底部 dock 的内容条在 COMBO 下换成 `<select class="output-content-select">`（`ContentComboLabel` 的等价物），选项 = 同一个 `bottomTabOptions`（`BOTTOM_TABS` 按可用性过滤 + `bottomTabLabel`），因此两种呈现列的内容完全一致；测试用"标签名必须在标签条里也出现"做防漂移断言。侧边 dock 只持一个视图（本来就是"单个下拉/标题"形态），`activeContentCount()` 对侧边 dock 恒返回 1，所以那一行在侧边窗口激活时按源码规则置灰。
4. **修正"活动工具窗口"的判据（真缺陷）**：`BaseToolWindowToggleAction` 与 `ToolWindowMoveAction` 都用 `getActiveToolWindowId()` = **焦点所在**的工具窗口；而 Swing 的菜单**不夺焦点**，DOM 的菜单按钮**会**。原来的 `focusedDock()` 只读 `document.activeElement`，于是菜单一打开焦点就跑到按钮上、所有"需要活动工具窗口"的行当场全部置灰（第四十八批的四条拉伸行也会因此变成永远点不到的死行）。现在新增 `dockOf()` / `lastDockFocus`（由 `.ide-shell` 上的 `@focusin` 记录真实焦点归属）与 `activeToolWindowDock()`：焦点在 dock 内 → 用实时答案；焦点在 `.topbar`（菜单栏、下拉、命令框）→ 用最近一次真实焦点所在 dock；其它情况（编辑器、状态栏）→ 严格回答"没有活动工具窗口"。`resizeTarget()` 与 `activeContentCount()` 都改走这条判据。

**判定不做（附理由）**：`TW.MoveToGroup`（`PlatformActions.xml:679`，`ToolWindowMoveAction.java`）—— 组内 8 项里 New UI 先砍掉 `TopLeft`/`TopRight`（`isAllowed` `:247-254`，无顶部条）；剩下 6 项中 `LeftBottom` / `BottomRight` / `RightBottom` 是**分屏位**（`isSplit()` `:89-91`，需要每个工具窗口自己的 `splitMode`，TaoCode 只有全局的左右并列设置，没有 per-window split），`BottomLeft` 指向底边停靠（TaoCode 的 `setToolAnchor(id, 'bottom')` 没有渲染路径，见 `docs/source-todo.md` §3 的旧结论）。真正可落地的只有 `LeftTop` / `RightTop` 两项，而它们与工具窗口头部 ⋮ 菜单里已有的「移动到左侧/右侧」（含同一个 `isApplied` 置灰规则，`ToolWindowMoveAction.java:106-108`）完全重合 —— 再往 Window 菜单里放两行是同一动作的第二张脸，**不做**。
`TW.ViewModeGroup`（`:678`，`ToolWindowViewModeAction.java:33-37, 56-84`）—— `DockPinned` 就是现状；`Float` / `Window` 需要独立 OS 窗口（TaoCode 没有）；`Undock`（SLIDING）需要滑出式浮层；`DockUnpinned`（autoHide）需要"失焦即收、点条纹即展"的机制，而 TaoCode 的可见性标志是用户手动且粘性的，做出来只是名字对不上的开关，**不做**。
`ShowContent`（`:680`，`ShowContentAction.java:48-54`）—— 动作体是 `ToolWindowContentUi.toggleContentPopup`（`:862-875`）+ `ContentLayout.showContentPopup`，是 New UI 内容布局自己的弹层机制（还带"当前内容是 TabbedContent 时 50ms 后自动确认"的细节）；TaoCode 的内容条既不会隐藏也不共用这套布局，复刻出来是标签条的第二张脸，**不做**。
`MoveToolWindowTabToEditorAction`（`impl.actions.xml:449-451`，`<add-to-group group-id="ToolWindowTabContextMenu"/>`）—— 本源码树里**没有**该类文件，只有 XML 注册，**不做**。

| 项 | 结果 |
|---|---|
| `npx vue-tsc --noEmit -p tsconfig.json` | exit 0，0 错误 |
| `npm test` | **334/334**（326 → 334，新增 `tests/tool-window-content-ui.test.mjs` 8 条） |
| `npx vite build --emptyOutDir false` | exit 0，5.29s |
| 原生构建 `build-native-locked.bat` | RC 0，0 error / 0 warning（本批无原生改动） |
| `ctest --output-on-failure` | 17/17（38.19s） |
| 启动冒烟 | `build/TaoCode.exe` 15s 未退出 → ALIVE，随后 `taskkill` 干净终止 |

**新增文件**：`src/toolWindowContentUi.ts`、`tests/tool-window-content-ui.test.mjs`（8 条：未知值回落、选中态极性、toggle 映射与往返、启用阈值、文案随类型、行接线 + 渲染分支 + 持久化 + 判据来源、两种呈现的标签一致性、顶栏回退）。
**改动**：`src/App.vue`（import、`dockOf` / `focusedDock` 重构 / `lastDockFocus` / `noteDockFocus` / `activeToolWindowDock`、`bottomContentCount` / `activeContentCount` / `bottomTabOptions` / `bottomTabLabel` / `bottomContentUiType` + 持久化、`tabTargetCount` 复用、`resizeTarget` 改判据、菜单新增 `window.toggleContentUiType`、底部内容条加 `v-if`/`v-else` 分流、`.ide-shell` 加 `@focusin`）、`src/style.css`（`.output-content-select`）、`tests/tool-window-resize.test.mjs`（断言改用 `activeToolWindowDock`）。

---

- [x] **已补（第七十六批）** 书签**列表**这条线：运行时 `src/bookmarkListActions.ts`（建/改名/删/把书签加进某张列表）、对话框 `src/components/BookmarkListDialog.vue`（上游三个对话框合一的形状）、面板段头的重命名/删除按钮、标题栏的「创建书签列表」「书签打开的标签页…」，以及齿轮的「删除多个书签前询问」（默认开）。真机取证：建「待办」→ 改名「待办2」→「书签打开的标签页…」把打开的标签页加成**文件书签**并落盘 → 删除时弹出上游那句「确定要删除 ''待办2'' 书签列表吗? 此操作无法撤消。」。
- [ ] **待补（第七十六批遗留）** `AddAnotherBookmark`（把一条**已有**书签加到另一张列表）：运行时与对话框都就绪（`runWithChosenList` + `addBookmarkToNamedList` + select 模式），缺的是上游那个入口（书签节点右键菜单里的「添加另一书签…」）。

- [ ] **LSP「解析外部」这条线（进行中）** —— 目标是让 JDT 拿到外部类路径与源根，等价于 IDEA「已导入的模型」。
  已落地（`0a76a4d` / `a2a329d`）：`default_referenced_libraries`（`build/rfg/**/*.jar`、`build/libs/**`、`lib/**`
  等磁盘上真实存在的产物）+ `default_source_paths`（链接子工程的 `src/main/java` 等）+ `window/showMessage`
  转发（导入失败在界面上看得见）。都有 `projects_test` / `lsp_host_test` 判据。
  **还差最后一步（下一个开关）**：JDT 的 Buildship 导入**不理会** `java.import.exclusions`（真机日志实证：
  仍逐个同步 `AE2-refs/*` 与 `AE2VMAddon-1.10.2/-1.12.2-nova/-1.15.2…`，每个 ~75s、逐个失败）⇒ 收敛导入范围
  只能靠 `java.import.gradle.enabled=false`（"不导入，用磁盘产物"）。做法：`buildTools.gradle` 加一个
  布尔（默认 true，保持现在的行为），映射到该 JDT 偏好；设置页/Gradle 栏给一行；判据加在
  `projects_test` 的 JDT 形状那一档。
  **验证配方**：把大工程的 `lastProject` 指到 `E:/Applied Energistics 2 Acceleration`（只改这一个字段，
  别动 `perProject` 里的设置 —— 我手写过一次 `buildTools` 让整份配置被判非法，应用会停在欢迎页），
  启动后 `lsp.open` 那个 `AE2VMConfig.java`，再 `lsp.request {kind:'hover'|'definition', line:24, character:45}`
  指向 `net.minecraftforge.common.config.Configuration`：**回包里带 jar 路径 = 外部解析通了**；
  `available:false` = 文件仍不在源根里；无回包 = 服务端仍在导入（JDT 导入期间不答语义请求）。
- [ ] **LSP「解析外部」的落点（2026-10-01，三次探针）**：
  1) 关掉 Gradle 导入后 `definition` 从「20–28s 无回包」变成**立刻回包** ✓（导入 churn 让语义请求全悬死那半解决了）；
  2) 回包仍是 `{"available":false}` / hover 回空 ⇒ 符号解析不了。诊断日志（`lsp_config.cpp` 里那行
     "java lsp 配置：…"）**抓到一个真缺陷并已修**：`default_referenced_libraries` 原来按**工作区根**判
     `build/` 是否存在，而这个仓库的产物在 `<子工程>/build/rfg` ⇒ 真机日志是"类路径兜底 **0** 条"。
     改成**按链接的子工程派生**后，日志变成"源根 4 条（…/src/main/java）、类路径兜底 4 条
     （AE2VMAddon-1.7.10-gtnh/build/rfg/**/*.jar）" ✓（`projects_test` 的夹具也照真机摆成多子工程形状）；
  3) 但探针结果没变（hover 可用但空、definition 不可用）⇒ **settings 已经对了，是 JDT 没把这些
     设置"落成工程"**。下一个动作有了明确依据：服务器自己的命令表里有 `java.project.import`
     （日志 `Non-Static Commands: [java.project.import, java.project.changeImportedProjects, …]`）——
     关掉 Gradle 导入后，**需要由客户端触发一次 `workspace/executeCommand {command:"java.project.import"}`**，
     JDT 才会按 `java.project.sourcePaths`/`referencedLibraries` 把普通文件夹建成不可见工程
     （VS Code 那边是扩展在 initialize 之后自动做的）。做法：在 native 侧 `Session` 的 ready 回调之后
     发这条命令（幂等），再按同一配方复验。
  4) 又补了一步：关掉导入时由客户端主动发 `java.project.import`（`Session::request_project_import`，
     只在 `gradle.enabled == false` 时发）——**复验结果与加它之前完全一样**（hover 空、definition 不可用）。
  **于是只剩两条各一次探针的判定**（下次从这里开始）：
     ① grep JDT 的 `.metadata/.log`：加命令前后 `Importing … project(s)` 那几行有没有差异
        ⇒ 命令到底有没有被当真；
     ② 把 `java.import.exclusions` 暂时清空再复验一次 ⇒ 排除"排除模式误伤链接目录"这个嫌疑
        （我推导的模式里含 `**/AE2-refs/**` 这类，理论上不碰 `AE2VMAddon-1.7.10-gtnh`，但值得实测）。
  5) **从 JDT 日志又挖到一条硬线索**（2026-10-01 06:06 那次运行）：
     `!MESSAGE begin problem for /AE2VMConfig.java` / `1 problems reported for /AE2VMConfig.java` /
     `Validated 1. Took 5 ms` —— 该文件**确实被当成 Java 在编译与诊断**（不是"没进任何工程"），
     而且只报了 **1 个问题**。所以下一个动作最省事也最直接：**把那 1 个问题的原文读出来**
     （`lsp.request {kind:'diagnostics'}` 或问题面板）—— 它会直接说清是"外部类型 cannot be resolved"
     （⇒ 类路径没进编译单元）还是别的东西（⇒ 另一条线）。
  6) 读那条诊断的第三次尝试（2026-10-01，`enabled=false`）：
     · `lsp.request {kind:'diagnostics'}` **不是合法 kind**（回 `unknown semantic kind`）；
       合法的拉取入口叫 `diagnostic`（单文件）—— 参 `native/lsp_capability_queries.cpp` 的 kind 表；
     · 于是发 `{kind:'diagnostic'}` → JDT 回 **`{"code":"LSP_FAILED","message":"Internal error."}`**
       （拉取诊断在这个文件上内部报错，同样指向"它不在一个类路径完整的工程里"）；
     · 状态栏的问题计数 chip（`.status-problems`）默认不渲染，读不到条数。
     ⇒ 拿诊断原文的可行路径（第四次尝试后收窄为一条）：**不要**去找"切换输出面板"这类按钮
     （`title` 不是那个词，找不到）；最稳的是**临时探针**——在编辑器页里把拿到的那份诊断表暴露成
     `window.__diag`（我们前端把它存在模块级的 Map 里，页面读不到），读完即撤，和书签那几轮的做法一致。
     这一步做完就能直接看到「`Configuration` cannot be resolved」这类原文。
  7) **拿到诊断原文了（临时探针 `window.__diag`，读完即撤）**：
     `AE2VMConfig.java is a non-project file, only syntax errors are reported`（severity 2 警告）
     —— JDT 自己说得很清楚：**这个文件不在任何工程里**，所以只报语法错、语义一律不解析。
     这把问题从"类路径 glob 怎么解析"收敛成了"**为什么 JDT 没把我们的源根建成熟见工程**"：
     `java.project.sourcePaths` 对应的服务端偏好是 `invisibleProjectSourcePaths`
     （JDT 1.44.0 的 Preferences 常量里确认存在），我们已按链接子工程派生并下发；
     下一个已实现但**尚未在真机上验证**的调整：**关掉 Gradle 导入时不再下发 `java.import.exclusions`**
     （`lsp_config.cpp` 里改成只有导入开着才发）—— 因为排除模式可能把 JDT 自己的不可见工程扫描也挡了；
     验证配方：`enabled=false` 下启动，`lsp.open` 那个文件，读 `window.__diag` 的诊断原文
     （应当不再是 "non-project file"）与 `definition` 是否可用。
  8) **三条否定结果（都在 `enabled=false`、大工程上实测）**：
     · 不发 `java.import.exclusions` ⇒ 诊断不变（仍是 "non-project file"）；
     · 主动发 `workspace/executeCommand {command:"java.project.import"}` ⇒ **确认发出去了**
       （trace 里有一条 118 字节的 `workspace/executeCommand`），但 JDT 日志里**一条 "invisible" 都没有**；
     · 把链接的子工程目录也声明成 LSP 的 workspace folder（`set_extra_roots`）⇒ 诊断不变。
     ⇒ 下一步用**随发行那份 JDT 里现成的只读命令**把状态读出来（一次就能定位）：
     `java.project.getAll`（有哪些工程）、`java.project.sourcePaths`（我们的源根到底注册了没）、
     `java.project.getSettings`（JDT 自己看到的设置）。这三个都在这份 1.44.0 的命令表里。
  9) **通了（2026-10-01 12:40）**：把"已算好的模型"物化成 **Eclipse 工程**（`.project` + `.classpath`）
     交给 JDT 自带的 `EclipseProjectImporter`（`native/java_lsp_paths.cpp` 的
     `materialize_eclipse_project`：源根用工程内相对路径、jar 用绝对路径、**已有配置不覆盖**），
     启动日志出现"物化 Eclipse 工程 2 个文件"，随后探针里 **`hover` 回出了
     `net.minecraftforge.common.config.Configuration`** —— 外部类型解析成功（此前一直是空串）。
     物化器又补了两处（真机踩出来的）：① 两个文件**各自**判断（原来"任意一个存在就整体跳过"，
     删掉 `.classpath` 后再也不写）；② `*-sources.jar` 不当普通 lib，而是找**同名**二进制 jar 当
     `sourcepath`（本工程的源码 jar 名字与二进制不配对 ⇒ 一处都没配上，这是预期）。
     **仍差一处**：`definition` 对 jar 里的类型给不出位置（`available:false`）—— 我们这边的
     `available` 语义是"有没有目标"（`unsupported()` 只在服务端显式声明 `false`/`null` 时才拦），
     所以是 JDT 在没有**源码附件**时不给库类型的定义位置。下一步（对齐 IDEA 的"反编译/附加源码"）：
     已按**共享词**配对（同名优先；否则取共享 4+ 字词最多的那个 —— `srg_patched_minecraft-sources.jar`
     ↔ `srg_merged_minecraft.jar` 共享 `minecraft`）。真机复验：`hover` 现在连 **javadoc 一起回**
     （`net.minecraftforge.common.config.Configuration` + "This class offers advanced configurations
     capabilities…"）—— 源码附件确实生效了；但 **`definition` 仍空**（同一位置、同一门控下 hover 能过，
     说明请求发出去了、是 JDT 回了空数组）。下一个探针：把 definition 打在**同一文件的 import 行**
     （`import net.minecraftforge.common.config.Configuration;`）与本地符号上，区分"位置相关"与
     "库类型一律不给"。
     产物说明：`.project`/`.classpath` 会写进**被链接的子工程目录**（这就是本功能的落点），
     已有同名文件时一字不动；不想要时删掉即可（下次启动会重建）。
  **三个 definition 探针的实际结果（2026-10-01）**：① import 行的外部类型 → 空；② 字段初始化里的同一类型 → 空；③ 本地类名 → **有位置**（`available:true` + `{path,line,character}`）⇒ definition 链路本身是通的，JDT 只是**对 jar 里的类型一律不给位置**。下一步：definition 之前先发 `textDocument/declaration`（JDT 有 `declarationProvider`；VS Code 就是 declaration → definition 退化），库里类型再退回 `typeDefinition`。
  探针注意：手写 `projects.json` 时**只加 `enabled`/`lastProject`**，跑完按备份还原、停掉 exe 与 java；
  调试端口别用 9410（那台机器上被别的服务占了，`/json/list` 会回一段 JWT 而不是 CDP 列表）。


- `git_clone_lifecycle`（原生 ctest）：2026-10-01 在**整批跑**时偶发失败**两次**（两次都紧跟在一次完整前端构建/真机取证之后），单跑 10/10、随后重跑整批 34/34 —— 与并发/资源占用有关，与本批改动无关。见到就重跑一次，别当缺陷改代码。
