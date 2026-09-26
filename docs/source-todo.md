# 源码级 TODO（假 UI / 假位置 / 假控件 / 假逻辑）

来源：4 个只读审计代理分片通读（App.vue / 19 个 .vue 组件 / 13 个 .ts 模块 + tests / 47 个 native 文件）+ 我自己的机械核对（设置键三处一致性、Method 联合 ↔ 原生分派双向差集、事件名双向差集）。

状态：`[x]` 已修并验证；`[ ]` 未修；`[~]` 判定不做（附理由）。

---

## 0. 我自己的机械核对（结论：干净）

- [x] **Method 联合 ↔ 原生分派**：107 ↔ 107，双向差集为空。
- [x] **事件名**：原生发出 12 类事件，前端全部有分支（其中 `lsp.edited` / `term.opened` / `fs.watchStopped` 原是死事件，已接上）。
- [x] **43 个 EditorSettings 键五处一致**：接口 / 默认值 / 前端白名单 / 原生默认值 / 原生 known_keys，缺项均为 0；`bracketMatching` 曾是装饰性设置，已接上。

## 1. 致命

- [x] **`start_nested_debug` 跨线程 UAF**（`native/main.cpp` 内 DAP 反向请求处理）：回调按引用捕获栈上 `message`/atomics，却只等 6s，而嵌套握手超时是 120s → 慢适配器回包时写已销毁栈。已改 `shared_ptr` 状态 + 上界 30s。
- [x] **重命名/移动已打开的脏文件静默丢草稿**（`src/App.vue` `applyNameDialog`/`confirmDelete`）：`file.rename` 先动磁盘，`retitleTab` 再删标签并按磁盘重读 → 未保存编辑无声消失。已在重命名/删除前对受影响脏标签走 `confirmLeave`（保存/丢弃/取消）。

## 2. 严重

- [x] **`dapSetBreakpoints` / `dapStart` 断点映射错误**（`src/bridge.ts`）：用"请求行"去 `includes("绑定行")`，适配器把断点移到有效行后整条被删（连 condition 一起丢）。已改为保留请求列表、只更新 `verified` 标志。
- [x] **`AssignProcessToJobObject` / `SetInformationJobObject` 未检查**（`native/dap.cpp`、`native/lsp_host.cpp`）：失败时 KILL_ON_JOB_CLOSE 未生效，适配器/调试目标可能成孤儿。已检查并在失败时回退到 `TerminateProcess`。
- [x] **`search.cancel` 未接线 + 结果类型缺 `cancelled`**（`src/components/SearchPanel.vue`、`src/bridge.ts`）：取消按钮只自增 token，原生走查照跑到 10 万文件。已真实调用 `search.cancel` 并处理 `cancelled` 结果。
- [x] **`dap.breakpoints` / `dap.disconnect` 未接线**（`src/bridge.ts`、`DebugPanel.vue`）：已加 `dapLoadBreakpoints()`（会话运行时同步适配器断点）与「断开调试器」按钮（保留被调试进程）。
- [x] **`SettingsDialog` deep watch 覆盖用户输入**（`SettingsDialog.vue`）：已改为非 deep 且表单脏时跳过。
- [x] **`ProjectStructurePane`「还原」是假控件**（`ProjectStructurePane.vue`）：`type="reset"` 只重置 DOM，不动 Vue refs。已改 `type="button"` + `@click="resetForm"` 真回填。
- [x] **`DebugPanel` 与运行配置两套 program/cwd**（`DebugPanel.vue`、`App.vue`、`bridge.ts`、`projects.cpp`）：已改为单一来源——`RunConfig.adapter` 新字段 + 面板只读展示当前运行配置。
- [x] **`configChooser` 幽灵 UI**（`App.vue`）：`aria-expanded="configChooser !== null"` 有状态但**没有任何 `v-if` 渲染它**，点 ▾ 无反应。**已修（第二十五批）**：`App.vue:4152-4166` 新增真实弹层（配置列表 + ↑↓/Enter/Esc + 遮罩关闭），▾ 按钮的 `aria-expanded` 现在对应一个实际渲染的元素。

## 3. 一般（假位置 / 假控件 / 假逻辑 / 死代码）

- [x] 重复菜单项 `run.debugContext` 出现两行（`App.vue`）→ 删掉重复项。
- [x] 死函数 `switchTab`（`App.vue`，全库零调用）→ 删除。
- [x] 「移动标签页到下方」与「到右侧」是同一处理（`App.vue`）→ 已按方向区分（`horizontal`/`vertical` + `setSplitOrientation`）。
- [x] **「移动到底部」后工具窗口消失**（`App.vue`）：已移除该入口、底部投放目标与随之成为死代码的分支——不留“点了就丢窗口”的假控件；改为在 `docs/ui-parity-checklist.md` 注明底边停靠未实现。
- [x] `exprOpen` 死状态（`DebugPanel.vue`）→ 用于折叠求值结果树，并加折叠按钮。
- [x] `HistoryPanel` token 校验晚于赋值 → 改为先校验 token 再赋值（并删除死样式 `.hist-diff`）。
- [x] `OutlinePanel` 丢 `character` → 父件改传 `column: character + 1`。
- [x] 设置页缩放文案统一为“点应用/确定后生效”。
- [x] `aria-label` 改为可读文本“缩放与界面密度”。
- [x] `BinaryViewer` 显示用 `FolderOpen`、另存为保留 `Download`。
- [x] `VcsLog` 标题计数改用 `graph.rows.length`（与可见列表一致）。
- [x] `BookmarksPanel` 目录列去掉尾部斜杠。
- [x] 死样式 `.hist-diff`（`HistoryPanel.vue`）→ 已删除。
- [x] 快捷键提示与绑定对齐：`最大化编辑器` 更正为 `Ctrl Shift F12`；并**补上真实绑定** `Ctrl Shift O`（打开文件夹）与 `Ctrl Shift G`（当前文件 Git 追溯）。
- [x] 「转到类」改为真实的 LSP kind 过滤（Class/Interface/Enum/Object/Struct/TypeParameter），与「转到符号」不再是同一行为。
- [x] 删除不可达的 `return 0;`。
- [x] 明确标注为 best-effort（返回码有意忽略，附注释）。
- [x] `Client::cancel` 真正接线：`Host::request` 对光标驱动的四类请求（hover/completion/signatureHelp/documentHighlight）在发出新请求前取消被取代的旧请求；取消在 `io_mutex_` 之外执行，避免与回调重入互锁。
- [x] `src/agent.ts` 文件头明确标注 **NOT WIRED YET（第二阶段）**，并同步去掉回包里嵌入的当天日期（原会破坏“同一输入恒定输出”的承诺）。
- [x] `joinLinesCommand` 无可合并内容时 `return false` 且不 dispatch。
- [x] 该测试改为**读 App.vue / CodeEditor.vue 的 `editable('…')` 菜单名**，双向断言：菜单名必须能在命令表或“编辑器接管”白名单里找到，命令表里的项也必须都有菜单入口。
- [x] `flipCase`、`dapCurrentThread` 收窄为模块内私有；`templates.availableTemplates` 保留导出并在测试中消费（有意）。
- [x] 见上：日期已移除。

## 4. 判定不做 / N-A（附 IDEA 出处）

- [~] 透明度（`AppearanceConfigurable.kt:629-653`）：需要原生分层窗口，CSS 等效会把文字一起透明，语义不符。
- [~] 抗锯齿（`:655-691`）：浏览器不暴露该设置，N/A。
- [~] 状态栏 `WriteThread` / `VfsRefresh` / 索引 flush 三个 widget：分别依赖 AWT/EDT 写线程、VFS 刷新窗口期、`FSRecords.connection().isDirty`，TaoCode 无对应机制，不做装饰性闪动。
- [~] 「图 1/2/3」截图条目：本会话模型看不到图片，需桃补图或文字描述才能核实。
- [~] 底部工具窗口停靠（IDEA `ToolWindowAnchor.BOTTOM`）：当前架构只有左右 dock，见 §3 待决项。

## 5. 第四十二批新发现（错误导航 / 功能键）

- [x] **`GotoNextError` / `GotoPreviousError`（F2 / Shift+F2）从未实现**：Navigate 菜单的 `GoToErrorGroup`（`PlatformActions.xml:612-615`）与 `$default.xml:658-660`、`:679-681` 两条键位在 TaoCode 里都不存在，编辑器里按 F2 无反应。已按 `GotoNextErrorHandler.java:64-208` 补齐（严重度分层、前/后向严格比较、两端回绕、折叠展开、居中滚动、无高亮时的行上提示），逻辑在 `src/gotoNextError.ts`。
- [x] **F8 一键两用（真实缺陷）**：`@codemirror/lint` 的 `lintKeymap` 把 F8 绑成 `nextDiagnostic`，而 IDEA 的 F8 是 Step Over（`$default.xml:849-851`，由窗口级 `dapStep` 执行）→ 调试暂停时按 F8 会一边单步一边跳 lint 诊断。已在 `basicSetup` 之前遮掉库绑定。
- [~] **`Mod-Shift-m` 偏离未修**：CodeMirror 在同一张 `lintKeymap` 里把 `Mod-Shift-m` 绑成 `openLintPanel`，而 IDEA 的 `Ctrl+Shift+M` 是 `EditorMatchBrace`（`$default.xml:1146-1148`，"移动光标到匹配括号"）。CodeMirror 6 没有导出括号匹配命令（`bracketMatching` 只是给高亮用的 ViewPlugin，内部匹配器不对外），自己写一个纯文本配对器等于发明语义（字符串/注释/泛型都要按语言规则办），**判定不做**并登记在此；要实现需先找到可靠的语言级匹配方案。
- [x] **`F12` 绑错（第四十三批已修）**：`$default.xml:846-848` 里 **F12 = `JumpToLastWindow`**（回到上次激活的工具窗口），`Ctrl+F12` 才是 `FileStructurePopup`（`:279-281`）；而 TaoCode 的窗口级处理器里裸 F12 **被 `!(ctrlKey||altKey)` 早退吞掉**（等于完全没实现），且 `Ctrl+F12` 分支不看 Shift → `Ctrl+Shift+F12`（`HideAllWindows`，`:870-872`）被它抢走、后面的 `toggleMaximizeEditor` 成了条件死代码。三条绑定现已各就各位，见第六节。

## 6. 第四十三 / 四十四批（F12 语义 + Window 菜单 LayoutsGroup）

- [x] **`JumpToLastWindow`（裸 F12）**：`JumpToLastWindowAction.java:17-50` + `ActiveStack.java:15-95` + `ToolWindowManagerImpl.kt:746-753`。新增 `src/activeToolWindow.ts`（persistent 栈：push 去重后置顶、隐藏不删、按 `isAvailable` 从栈顶往下取第一个可用项）。TaoCode 的激活点全部接上（`showView` / `showOutput` / `activateToolWindow` 的“带前”分支 / 底部 8 个 tab 按钮 / 状态栏 问题 与 SmartMode 组件），菜单行在 WindowMenu › ActiveToolwindowGroup 中 `PinToolwindowTab` 与 `MaximizeToolWindow` 之间（`PlatformActions.xml:653-660`）。
- [x] **`Ctrl+F12` / `Ctrl+Shift+F12` 解耦**：`Ctrl+Shift+F12` 分支前移并加 `!event.shiftKey`，`Ctrl+F12` 仍是 FileStructure。
- [x] **WindowMenu › LayoutsGroup（`PlatformActions.xml:641-651`）**：新增 `src/toolLayout.ts`（`ToolWindowDefaultLayoutManager.kt` 的命名布局模型：空名 = 出厂默认且不入表、存到出厂默认会改名为 `Custom`、按名增删改、名字校验 50 字符 / 重名）。落地四条动作 + 动态布局列表：
  - 「默认布局」（`RestoreFactoryDefaultLayoutAction.kt:17-35`，ToggleAction，选中态 = 当前就是出厂默认）
  - 布局列表（`CustomLayoutsActionGroup.kt` 的 `CustomLayoutActionGroup`，每项是 toggle，点击即 Apply）
  - 「恢复当前布局」**Shift+F12**（`RestoreDefaultLayoutAction.java:41-47` + `$default.xml:864-866`）
  - 「将更改保存到当前布局」/「将当前布局另存为新布局…」/「重命名当前布局…」/「删除当前布局」
  快照覆盖 explorer / bottom / 当前视图 / 当前底部页 / 每个窗口的锚边 / 条带顺序 / 三个面板尺寸；恢复走 `setPanelSize`（同一套 clamp）与 `saveToolOrder`（同一条持久化路径）。
- [~] **`CustomLayoutActionGroup` 的子菜单结构**：IDEA 里每个布局名是一个**子菜单**，内含 Apply / Restore / Save / Rename / Delete。TaoCode 的菜单模型（`MenuRow`）没有 children，只有 `rule` / `section` 两种分段。按扁平菜单能表达的部分实现：列表项点击 = Apply，Rename / Delete 作用于**当前**布局，Save 由上面两条全局行承担；**不**在扁平菜单里给同一个点击塞第二种含义。要 1:1 复刻需先给 `MenuRow` 加子菜单支持。

## 7. 第四十五 / 四十六批（WindowMenu › ActiveToolwindowGroup 剩余项）

`PlatformActions.xml:653-665` 的整组顺序是：HideActiveWindow · HideSideWindows · HideBottomWindows · HideAllWindows · PinToolwindowTab · JumpToLastWindow · MaximizeToolWindow · DockToolWindow · 分隔 · NextTab · PreviousTab · CloseActiveTab · TW.CloseOtherTabs · TW.CloseAllTabs；`:668-675` 是分屏组（SplitRight · SplitAndMoveRight · SplitDown · SplitAndMoveDown · Unsplit · MoveToNextSplitter · MoveToPreviousSplitter），`:677-683` 是 TW.ViewModeGroup · TW.MoveToGroup · ToggleContentUiTypeMode · ShowContent · ResizeToolWindowGroup。

- [x] **`HideActiveWindow`（Shift+Esc）**：`intellij.platform.ide.impl.actions.xml:445` → `HideToolWindowAction.kt:21-29`（`activeToolWindowId ?: lastActiveToolWindowId` → `hideToolWindow`），`$default.xml:867-869` 绑 `shift ESCAPE`。TaoCode 的 `activeToolWindowId` 等价物 = 拥有焦点的那个 dock（`focusedDock()` 用 `document.activeElement.closest('.explorer-panel' / '.output-panel')` 判定）；焦点在编辑器时回落到 persistent 栈顶。`shouldBeHiddenByShortCut` 里的 `type.isInternal`（`ToolWindowTypeExtensions.kt:9-10` = `SLIDING || DOCKED`）在 TaoCode 恒为真（没有浮动窗口），因此等价于"窗口可见"。
- [x] **`HideSideWindows` / `HideBottomWindows`**：`HideSideWindowsAction.kt:18-25` / `HideBottomToolWindowsAction.kt:19-24`。落地为 `explorer = false` / `bottom = false`，**不是** `HideAllWindows` 的别名：前者只收一侧或底部，后者是 `toggleMaximizeEditor`。
- [x] **`NextTab` / `PreviousTab`（Alt+← / Alt+→）**：`TabNavigationActionBase.java:50-78` 决定分流——**编辑器有焦点就切编辑器标签页**、否则切当前工具窗口的内容；`:187-201` 的启用条件是"可作用对象多于 1 个"。TaoCode 两侧都接了：编辑器走 `groups[focusedPane].tabs` + `switchTabIn`，工具窗口走底部页签。回绕算法照 `ContentManagerImpl.selectNextContent/selectPreviousContent:621-646`（含"无选中项时按上一条会落到 `count - 2`"这个真实怪癖，已写进单测）。**顺带**：CodeMirror 把同一组合键绑成按语法移动光标（`cursorSyntaxLeft/Right`），已在 `CodeEditor.vue` 用前置 keymap 遮掉，否则一次按键会既切标签又跳光标。
- [x] **`Ctrl+Shift+F4` 绑错（已修）**：`$default.xml:260-262` 是 **`CloseActiveTab`**（`CloseActiveTabAction.java:39-58`：先关可关闭的选中内容，关不掉就隐藏整个工具窗口）。原来的「重新打开已关闭标签页」改回无快捷键 —— 源码里 `ReopenClosedTab` **在 `$default.xml` 里没有任何键位**（只有 macOS 键位表的 `meta shift T`，`macOS System Shortcuts.xml:170-172`），所以它本来就不该占 `Ctrl+Shift+F4`。
- [x] **`TW.CloseOtherTabs`**：`intellij.platform.ide.impl.actions.xml:460` → `ToolWindowCloseOtherTabsAction.kt:17-26`（清掉除当前内容外**所有可关闭**的内容，再重新选中当前项；`:28-35` 的启用条件是"存在另一个可关闭内容"）。TaoCode 里可关闭的只有 references / hierarchy / blame，`closeOtherToolTabs()` 按此清空非当前项。
- [x] **`TW.CloseAllTabs`**（第四十七批）：`:462` → `ToolWindowCloseAllTabsAction.kt:11-18`（清掉**全部**可关闭内容，**包括当前项**，这是它与 CloseOtherTabs 的唯一差别；`:20-23` 的启用条件 = `canCloseAllContents()`，即 `ContentManagerImpl.java:472-481` 的 `canCloseContents() && any isCloseable`）。菜单行 `window.closeAllTabs` 按 `PlatformActions.xml:666` 紧跟 `window.closeOtherTabs`。**无快捷键**：它借 `use-shortcut-of="CloseAllEditors"`（`:462`），而 `CloseAllEditors` / `CloseAllEditorsButActive` 在 `$default.xml` 里**一条键位都没有**（已全文 grep），不当发明语义。三条移除路径（CloseActiveTab / CloseOther / CloseAll）已收敛到 `src/toolTabs.ts` 这一份内容模型，不再各写一套 `bottomTab !== 'x'`。
- [x] **`ResizeToolWindowLeft` / `Right` / `Up` / `Down`（第四十八批）**：`PlatformActions.xml:678-683` 的 `ResizeToolWindowGroup`（整组在 `ActiveToolwindowGroup` 的最后，紧随 `ShowContent`），定义在 `intellij.platform.ide.impl.actions.xml:483-486`（`ResizeToolWindowAction$Left/$Right/$Up/$Down`），键位 `$default.xml:873-884`（`control alt shift LEFT/RIGHT/UP/DOWN`），文案 `ActionsBundle.properties:1179-1186`（`Stretch to Left/Right/Top/Bottom` + `Resize an active tool window to the …`）。落地为 `src/toolWindowResize.ts` + 菜单区段「调整工具窗口」四行：
  - **启用规则**（`ResizeToolWindowAction.java:127-131`、`:161-165`）：Left/Right 仅当 `!anchor.isHorizontal()`、Up/Down 仅当 `anchor.isHorizontal()`，而 `ToolWindowAnchor.isHorizontal()` 只对 TOP/BOTTOM 为真（`ToolWindowAnchor.java:49-51`）→ 侧边 dock 只有左右可用、底部 dock 只有上下可用，另一半置灰。
  - **动作对象**（`getToolWindow` `:83-87` + `:52-56`）：当前激活的工具窗口，且**编辑器持有焦点时整个动作隐藏**（`isActiveEditorPresented`）→ 等价物是 `activeToolWindowDock()`（第四十九批修正：焦点在 dock 内用实时答案、焦点在顶栏用最近一次真实焦点，否则严格"无活动工具窗口"，见下方 `ToggleContentUiTypeMode` 条目），与 `HideActiveWindow` 同一套判据。
  - **方向语义**（`stretch` `:107-121`）：箭头指**分隔条移动的方向**，不是窗口变大的方向 —— 左侧 dock 按「向左拉伸」是**缩小**、右侧 dock 按同一条键是**放大**；顶部 dock 按「向上拉伸」缩小、底部 dock 按同一条键放大。源码对轴向不匹配的组合直接 no-op（`:110`, `:114`）。
  - **步长**（`WindowAction.getPreferredDelta()` `:113-118` × registry `ide.windowSystem.hScrollChars` / `vScrollChars`，`:96-98`，两者默认 5，`registry.properties:205-208`）：= `JLabel("W")` 的字体度量 × 5。TaoCode 用同一思路**实测当前 UI 字体**（隐藏探针 span 的字宽 / 行高，字体取自 `body` 的计算样式，因此跟随「界面字体」设置），不写死像素。
  - 尺寸写回走已有的 `setPanelSize`（`src/appearance.ts:clampPanelSize` + 每窗口记忆尺寸），所以拉伸与拖拽分隔条、`toolLayout` 快照是同一条路径。
- [x] **`ToggleContentUiTypeMode`（第四十九批）**：`PlatformActions.xml:680`，动作 `ide/actions/ToggleContentUiTypeAction.java:8-21`（**选中态 = TABBED**、`setSelected` = `state ? TABBED : COMBO`、启用 = `contentCount > 1`），基类 `BaseToolWindowToggleAction.java:31-37,60-95` 一律取 `getActiveToolWindowId()`（**没有** last-active 兜底）。落地为 `src/toolWindowContentUi.ts` + 菜单行 `window.toggleContentUiType`（标题取动作原文 `Group Tabs` =「合并标签页」），**真实渲染**：底部内容条在 COMBO 下换成 `<select>`（`ContentComboLabel.java` 的等价物），选项与标签条同源；类型随 `windowInfo.contentUiType`（`ToolWindowImpl.kt:521`）持久化到 `taocode.toolWindowContentUi`，载入走 `ToolWindowContentUiType.getInstance` 的回落规则。COMBO 不是遗留模式：`defaultToolWindowlayoutProvider.kt:238,263` 给 Project / Notifications 的默认就是它。**同 id 的第二个 action**（`ToolWindowImpl.kt:934-958`，工具窗口齿轮菜单里那份，选中态是 **COMBO**、可见性用粘性 `hadSeveralContents`）未实现——菜单里的是注册版。
  - **顺带修一个真缺陷**：`BaseToolWindowToggleAction` / `ToolWindowMoveAction` 的"活动工具窗口"= **焦点所在**的工具窗口，而 Swing 菜单不夺焦点、DOM 菜单按钮会 → 原来的 `focusedDock()` 让"菜单一打开就全部置灰"，第四十八批那四条拉伸行会因此永远点不到。现新增 `lastDockFocus`（`.ide-shell` 的 `@focusin` 记录）+ `activeToolWindowDock()`：焦点在 dock 内用实时答案，焦点在 `.topbar` 用最近真实焦点，其余严格回答"无活动工具窗口"。
- [~] **`TW.MoveToGroup`（第四十九批判定不做）**：`PlatformActions.xml:679` → `ToolWindowMoveAction.java`。组内 8 项的 New UI 先砍掉 `TopLeft`/`TopRight`（`isAllowed` `:247-254`）；剩下 6 项里 `LeftBottom`/`BottomRight`/`RightBottom` 是**分屏位**（`isSplit()` `:89-91`，要 per-window `splitMode`，TaoCode 只有全局左右并列设置），`BottomLeft` 指向底边停靠（无渲染路径）。真正可落地的只有 `LeftTop`/`RightTop`，而它们与工具窗口头部 ⋮ 已有的「移动到左侧/右侧」（同一个 `isApplied` 置灰规则 `:106-108`）完全重合 → 再放两行是同一动作的第二张脸，**不做**。
- [~] **`TW.ViewModeGroup`（第四十九批判定不做）**：`:678` → `ToolWindowViewModeAction.java:33-37,56-84`。`DockPinned` 就是现状；`Float`/`Window` 要独立 OS 窗口；`Undock`（SLIDING）要滑出式浮层；`DockUnpinned`（autoHide）要"失焦即收、点条纹即展"，而 TaoCode 的可见性标志是用户手动且粘性的 → 做出来只是名字对不上的开关，**不做**。
- [~] **`ShowContent`（第四十九批判定不做）**：`:680` → `ShowContentAction.java:48-54` 调 `ToolWindowContentUi.toggleContentPopup`（`:862-875`）+ `ContentLayout.showContentPopup`，是 New UI 内容布局自己的弹层机制（含"当前内容是 TabbedContent 时 50ms 后自动确认"）。TaoCode 的内容条既不隐藏也不共用该布局，复刻是标签条的第二张脸，**不做**。
- [~] **`MoveToolWindowTabToEditorAction`（第四十九批，源码树里无此类）**：`intellij.platform.ide.impl.actions.xml:449-451` 只注册了 id 与 `ToolWindowTabContextMenu` 挂载，**没有对应的类文件**，**不做**。
- [~] **`TW.SplitRight` / `SplitAndMoveRight` / `SplitDown` / `SplitAndMoveDown` / `Unsplit` / `MoveToNextSplitter` / `MoveToPreviousSplitter`（第四十八批判定不做）**：`PlatformActions.xml:668-675`，定义 `intellij.platform.ide.impl.actions.xml:463-478`。这七个动作**全部**额外依赖 `toolWindow.canSplitTabs()`（`ToolWindowSplitActions.kt:25`、`ToolWindowSplitAndMoveActions.kt:22`、`ToolWindowUnsplitAction.kt:21`、`ToolWindowMoveToSplitterActions.kt:28`）**以及**一个为该工具窗口 id 注册的 `ToolWindowSplitContentProvider`（`ToolWindowSplitActions.kt:16,26`；扩展点 `ToolWindowSplitContentProvider.kt:11-14` 明确写着 `@ApiStatus.Experimental`、注释为 "Should be implemented to make ToolWindowSplitRightAction and ToolWindowSplitDownAction work **in your tool window**"）。整个源码树里**只有终端前端插件**注册了它（`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:95`）；没有 provider 的工具窗口 `update` 里 `isEnabledAndVisible = false`，也就是这些菜单项对平台自带工具窗口**根本不可见**。TaoCode 的底部页签是固定视图、没有"把选中内容复制一份分屏"的概念，做出来只能是自己发明的语义，**不做**。
- [~] **`PinToolwindowTab`**（`:455`，`PinToolwindowTabAction`）：IDEA 把工具窗口的**标签页**钉住，使后续打开的标签不再挤掉它。TaoCode 的底部页签是固定视图（没有"打开新标签挤掉旧标签"这回事），钉住无对象，**不做**。
- [~] **`DockToolWindow`**（`:458`，`DockToolWindowAction`）：在"停靠 / 浮动"之间切换。TaoCode 的架构只有左右两个 CSS dock，**没有浮动工具窗口**，做出来就是假开关，**不做**。
- [~] **`MinimizeCurrentWindow` / `ZoomCurrentWindow`（第四十七批判定不做，原计划作废）**：`intellij.platform.ide.impl.actions.xml:441-442`（`MinimizeCurrentWindowAction` / `ZoomCurrentWindowAction`，`ActionsBundle:1111-1115` 文案 `Minimize` / `Zoom`），在 WindowMenu 里位于 `LayoutsGroup` **之前**（`PlatformActions.xml:635-637`）。**但**：两者的基类 `ide/actions/MacWindowActionBase.java:27` 写死 `p.setVisible(SystemInfo.isMac)`，`:38-40` 非 macOS 直接 `p.setEnabled(false)`；键位也只在 `Mac OS X.xml:376-383` / `Mac OS X 10.5+.xml:479-486`，`$default.xml` 里没有。实现细节是 `MinimizeCurrentWindowAction.java:13-18`（`Frame.ICONIFIED`）与 `ZoomCurrentWindowAction.java:21-33`（`MAXIMIZED_BOTH` ↔ `NORMAL`）。Windows 上的最小化/最大化走自定义标题栏按钮（`FrameHeader.kt:21-24` 的 `CustomFrameAction`），**不是菜单动作**。→ 在 Windows 上新增原生 `window.minimize` / `window.zoom` 通道等于给 TaoCode 加一个 IDEA 在 Windows 上根本不显示的动作，**不做**。

## 8. 第四十六批附带发现（第四十七批全部结案）

- [x] **`Alt+←` / `Alt+→` 的旧提示文案 → 结案：原样就是写错了**：`$default.xml:296-299`（`Back` = `control alt LEFT` + `button4`）与 `:901-904`（`Forward` = `control alt RIGHT` + `button5`）——**没有裸 `Alt+←/→`**，`macOS System Shortcuts.xml` 里也没有。第四十五/四十六批把编辑器工具栏两处 `title` 改成 `Ctrl Alt` 是正确修复，无需回退。
- [x] **`HideAllWindowsAction` 的 ToggleAction 语义 → 结案：那一行本身就该会翻文案（不是"合并成一行"）**：`HideAllToolWindowsAction.kt:34-49` 的 `update` 里，`getIdsToHide(...).any()` 为真 → 文案 `action.hide.all.windows`（`IdeBundle.properties:384` "Hide All _Windows"）；否则若 `layoutToRestoreLater != null` → 文案 `action.restore.windows`（`:385` "Restore _Windows"）且 `CURRENT_STATE_IS_MAXIMIZED_KEY = true`；两者都不满足 → `isEnabled = false`（`:36, :48`）。`actionPerformed:14-32` 是真正的 toggle：先 `getLayout().copy()` 存进 `layoutToRestoreLater` 再逐个 `hideToolWindow`，恢复分支先置空该字段再 `setLayout`（`:17-22`）。View 菜单（`PlatformActions.xml:521-597`）整段**没有** maximize/hide-all 项，唯一入口是 WindowMenu `:656`。→ 已按源码实现：`window.hideAllWindows` 改为双文案 + 源码启用条件，`view.maximizeEditor` 那行删除。
