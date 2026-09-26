# 自动化执行记忆 · TaoCode UI 1:1 移植（每 15 分钟）

## 2026-09-26 04:28 第 1 次执行（对应第 25~28 批）

**做了什么**（三批，每批都跑完整验证口径）：
1. 状态栏「工具窗口」widget + Alt+编号语义修正（`ToolWindowsWidget.java:62-299`、`ActivateToolWindowAction.kt:88-111`）
2. 顶栏项目 widget + 两处真实缺口修复（`ProjectToolbarWidgetAction.kt:118-297`；DebugPanel 未声明标识符、CSS 误插媒体查询）
3. 提交图例 + 提交前检查与拒绝原因（`CommitStatusPanel.kt`/`CommitLegendPanel.kt`、`NonModalCommitWorkflowHandler.kt:156-184`、`CommitProgressPanel.kt:321-328`）
4. 提交作者行 CommitAuthorComponent（`CommitAuthorComponent.kt`、`VcsUserUtil.java`）——跨层：原生新增 `git.user` + `git.commit --author`

**结果**：全部通过。vue-tsc 0 错误；npm test 112 → 144（新增 32 条单测）；vite build exit 0；原生构建 RC 0 零告警；ctest 17/17；启动冒烟 ALIVE（每批各验一次）。

**新增可复用模块**：`src/toolWindows.ts`、`src/commitLegend.ts`、`src/projectWidget.ts`、`src/commitCheck.ts`、`src/commitAuthor.ts`（纯逻辑、无 Vue 依赖，配套 `tests/*.test.mjs`）。

**两个必须记住的坑**：
- `build-native-locked.bat` 的锁在输出被重定向时会瞬时跑满并返回 **RC 1 且输出无 "error"/"warning"**（`BUILD_LOCK_TIMEOUT`）→ 校验原生构建要连 `LOCK` 一起 grep，遇 RC 1 先重跑一次。
- 冒烟偶发 `rc=1` 无输出 = `main.cpp:1798` 的 `CoInitializeEx` 失败（紧接 ctest 之后资源紧张时出现过一次）；复跑即 ALIVE，别误判成崩溃。

**下次接续建议**：
- 权威清单 `docs/ui-parity-checklist.md` 已更新（含每批验证表 + 有意偏差及源码行号）；日志 `.workbuddy/memory/2026-09-26.md`。
- 优先核对清单里标「有意偏差 / N/A」的条目是否仍成立；如无新缺口，可做 `CommitAuthorComponent`（需新增原生 `git.user` + `git.commit --author`，跨层改动）。
- 「图 X」截图条目仍挂起（等桃补图；本模型看不到图片，不得假装看到）。
- 注意：每批必须真跑六项验证，禁止只跑 vue-tsc；改 CSS 后必须跑 vite build（模板/CSS 问题 vue-tsc 不报）。

## 后续执行：**并发防护触发，直接跳过**

本次（以及此前多次）执行在第 0 步并发检查即命中「最近 8 分钟内有写入」，按用户硬规则**本轮未改动任何文件**，只做判定与记录。

命中样本（判定时距当前分钟数）：
- `src/style.css` 3.2、`src/components/SourceControl.vue` 3.3
- `src/App.vue` 5.5、`src/components/WelcomePage.vue` 5.5
- `src/components/NoticeList.vue` 6.3、`src/notices.ts` 6.5

**结论**：高频定时任务（每 15 分钟）与主代理会话在 `src/` 上互相踩踏的概率很高——因为一批的六项验证（尤其原生构建 + ctest + 冒烟）本身就要好几分钟，上一批的写盘时间很难在下一轮 8 分钟窗口外。**改前必查、命中即退，是当前唯一安全策略**；不要为了"必须有产出"而绕过它。

**给主会话的建议**：真正的批次推进应在主代理会话里连续做（第 38~41 批：`src/filenameWidget.ts` 文件名 widget、`src/settingsBadge.ts` 设置页新标记、`src/notices.ts` + `NoticeList.vue` 通知工具条、`SourceControl.vue` 的 Alt+M amend 与选项分组），定时任务只作补充。

---

## 2026-09-26 后续执行 · 第 0 步并发防护再次命中 → 本轮跳过改码

**判定证据**（只读扫描 `src/` + `native/` mtime）：
- `src/App.vue` 3.67 min、`src/gotoNextError.ts` 3.38 min、`src/components/CodeEditor.vue` 2.85 min、`src/style.css` 3.76 min
- 这 4 个恰好是主会话「第 42 批（GotoNextError F2/Shift+F2）」的改动集；`docs/source-todo.md` 1.92 min、`docs/ui-parity-checklist.md` 0.93 min 也是该批的收尾写入
- `src/jumpToLastWindow.ts` 不存在、`tasklist` 无 `TaoCode.exe` 残留 → 第 43 批尚未开始
- 结论：命中窗口内确有写入，按用户硬规则**本轮不改任何文件**（含 docs），仅记录。

**给主会话的两条提醒（只读发现，未落盘）**：
1. **当天记忆文件落后 5 批**：`.workbuddy/memory/2026-09-26.md` mtime 已 157 min，正文最后一节仍是「第三十七批」——第 38/39/40/41/42 批都还没写进去（第 42 批是上一轮遗留的待办）。建议按批补记，别只补 42。（本次不代写：该文件属主会话代码区外的同一批产物，避免撞写。）
2. **`Ctrl+Shift+F12` 目前是被遮蔽的死绑定**：见下方第 43 批规格。

## 第 43 批规格（只读取证完成，可直接开工）

**缺口**：IDEA `$default.xml:846-848` — 裸 **F12 = `JumpToLastWindow`**（`control F12` 才是 `FileStructurePopup`）；TaoCode 的 `App.vue:3794` 写成
`if (event.key === 'F12' && workspace.value && lspReady.value) { ... openSymbol('file') }`，**没有 ctrl/shift 判据** → 同时吞掉 `Ctrl+F12` 与 `Ctrl+Shift+F12`，导致 `App.vue:3795`（`Ctrl Shift F12` → `toggleMaximizeEditor`）在 `lspReady` 时**不可达**。IDEA 的 `JumpToLastWindow` 完全缺失。

**IDEA 权威结构（已核对行号）**：
- `platform/platform-impl/src/com/intellij/ide/actions/JumpToLastWindowAction.java:19-30`：取 `manager.getLastActiveToolWindowId()`；`null` 或 `!isAvailable()` 直接 return；否则 `activateToolWindow(id, null, /*autoFocusContents*/ true, ToolWindowEventSource.JumpToLastWindowAction)`。`update():42-43` 用同一判据决定 enable。
- `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerImpl.kt:746-747`：`lastActiveToolWindowId = getLastActiveToolWindows().firstOrNull()?.id`
- 同文件 `:749-754`：`getLastActiveToolWindows` = 遍历 `activeStack.persistentSize`，`peekPersistent(i)`（**0 = 栈顶 = 最近**），`filter { it.isAvailable }`
- 同文件 `:641` / `:679`：激活时 `activeStack.push(entry)`；`:717`/`:883`/`:923`：隐藏/失活 `activeStack.remove(entry, false)`；`:1217`：注销 `remove(entry, true)`
- `openapi/wm/impl/ActiveStack.java:15-94`：**两个栈**——`myStack`（编辑器激活时被 clear）+ `myPersistentStack`（永不清）。`push()` = `remove(id, true)` 后两栈各 push（`:64-68`）→ 去重 + 置顶。`clear():36-38` 只清 `myStack`。`peekPersistent(i):78-80` = `get(size-i-1)`。`getPersistentStack():56-62` 按 0.. 顺序展开。
- **clear 时机**：`openapi/wm/impl/ToolWindowManagerLifecycle.kt:84-92` — `FOCUS_GAINED` 且焦点落在某个 editor 的 component 上时 `activeStack.clear()`。
- 菜单挂载点：`platform/platform-impl/resources/idea/PlatformActions.xml:652-659` → `WindowMenu › ActiveToolwindowGroup`，顺序 `HideActiveWindow, HideSideWindows, HideBottomWindows, HideAllWindows, PinToolwindowTab, **JumpToLastWindow**, MaximizeToolWindow, DockToolWindow`。TaoCode 对应位置：`App.vue:3344`（`window.maximizeToolWindow`）**之前**。
- 键位：`platform/platform-resources/src/keymaps/$default.xml:846-848`（F12）。文案：`platform-resources-en/src/messages/ActionsBundle.properties:1143-1144` — `_Jump to Last Tool Window` / `Activate the last focused tool window`。

**建议实现（同轮必须接真实消费方，否则不加）**：
1. 新纯逻辑模块 `src/toolWindowHistory.ts` + `tests/tool-window-history.test.mjs`：双栈 `push/clear/remove/peekPersistent/persistentStack/lastActive(filterAvailable)`，逐条对齐上面行号；`persistentSize` 与 `peekPersistent(0)=最新` 的语义要有测试。
2. `App.vue` 接入：`push` 挂在工具窗口激活路径（`focusToolWindowContent` 219-228 / `showView` 3041-3046 / `activateToolWindow` 205-213）；`clear` 挂在编辑器获得焦点的路径（对应 `ToolWindowManagerLifecycle.kt:84-92`）。
3. 菜单行 `window.jumpToLastWindow` 插在 `window.maximizeToolWindow`（3344）前，keys `F12`，`enabled` 跟随「存在可用的 lastActiveToolWindowId」。
4. 修 `App.vue:3794-3795` 的修饰键判据：裸 F12 → `jumpToLastWindow`；`Ctrl+F12` → `openSymbol('file')`；`Ctrl+Shift+F12` → `toggleMaximizeEditor`；`Alt+F12`（:3772）保持不变。
5. 六项验证照旧（vue-tsc / npm test / vite build / 原生构建锁脚本 RC 0 零告警 / ctest 17/17 / 冒烟 ALIVE），并回写 `docs/source-todo.md` 与 `docs/ui-parity-checklist.md`。

---

## 2026-09-26 后续执行 · 第 0 步并发防护第三次命中 → 本轮跳过改码，只读完成下一批取证

**并发判定证据**（只读扫描 `src/` + `native/` mtime）：
- `src/App.vue` 244s、`src/components/CodeEditor.vue` 392s、`src/activeToolWindow.ts` 434s —— 均在 8 分钟窗口内
- 这 3 个恰好是上一批（第 45/46 批 ActiveToolwindowGroup 收尾）的改动集；`docs/source-todo.md` 与 `docs/_batch4546.md` 同为 09:57 写入
- 结论：命中窗口内确有写入，按硬规则**本轮不改任何文件（含 docs）**，仅记录

**遗留（未代写，属主会话产物）**：`docs/_batch4546.md`（批次 45/46 验证记录）**尚未并入** `docs/ui-parity-checklist.md`；`.workbuddy/memory/2026-09-26.md` 尚未追加 45/46 批摘要。

**本轮只读取证（推翻一条原计划 + 新增一条可开工项 + 结案两条待决）**

1. **`MinimizeCurrentWindow` / `ZoomCurrentWindow` → 判定不做（原计划作废）**
   - `platform/platform-impl/src/com/intellij/ide/actions/MacWindowActionBase.java:27`：`p.setVisible(SystemInfo.isMac)`；`:39-41`：`else { p.setEnabled(false); }`
   - 即**非 macOS 上这两个菜单项根本不可见**；键位也只在 `Mac OS X.xml:376-383` / `Mac OS X 10.5+.xml:479-486`，`$default.xml` 里**没有**
   - 实现细节：`MinimizeCurrentWindowAction.java:13-18`（`Frame.ICONIFIED`）、`ZoomCurrentWindowAction.java:21-33`（`MAXIMIZED_BOTH` ↔ `NORMAL`）
   - Windows 上的最小化/最大化走自定义标题栏按钮（`FrameHeader.kt:21-24` 的 `CustomFrameAction`），不是菜单动作
   - **source-todo §7 里"下一步做原生 `window.minimize`/`window.zoom` 跨层通道"应改为 `[~]` 不做** —— 做了等于给 Windows 加一个 IDEA 在 Windows 上不显示的动作

2. **`TW.CloseAllTabs` → 下一批可开工项**
   - 挂载：`PlatformActions.xml:666`（ActiveToolwindowGroup，`TW.CloseOtherTabs` 之后）
   - 定义：`intellij.platform.ide.impl.actions.xml:462`，`class=com.intellij.ide.actions.ToolWindowCloseAllTabsAction`，`use-shortcut-of="CloseAllEditors"`
   - 实现：`ToolWindowCloseAllTabsAction.kt:11-23` —— `actionPerformed` 遍历 `contentManager.contents`，`isCloseable()` 的逐个 `removeContent(cur, true)`；`update` 用 `contentManager.canCloseAllContents()`
   - `canCloseAllContents()` = `ContentManagerImpl.java:472-481`：`canCloseContents()` 为假则 false，否则**存在任一 closeable 内容即真**（名字叫 All 但语义是"至少一个"）
   - **键位**：`use-shortcut-of="CloseAllEditors"`，而 `CloseAllEditors`（`intellij.platform.ide.impl.actions.xml:494`）在 `$default.xml` 里**没有任何键位**（只有 `Emacs.xml:207`）→ `TW.CloseAllTabs` 在默认键位下**无快捷键**，只作菜单项，别自造绑定
   - TaoCode 对接面：`App.vue` 的 `closeOtherToolTabs`(:463) / `closeOtherTabsTarget`(:469) / `closeTab`(:2457)；可关闭内容 = references / hierarchy / blame

3. **§8 第 1 条结案**：`$default.xml:296-299`（`Back` = `control alt LEFT` + `button4`）/ `:901-904`（`Forward` = `control alt RIGHT` + `button5`）→ **无裸 `Alt+←/→`**，批次 45/46 把 tooltip 从 `(Alt ←)` 改成 `(Ctrl Alt ←)` 是正确修复 → 可标 `[x]`

4. **§8 第 2 条结案**：`PlatformActions.xml:521-597` 整个 ViewMenu 段**没有任何 maximize 项**（`MaximizeEditorInSplit` 属 EditorTabsGroup `:673`）；`HideAllWindows` = `HideAllToolWindowsAction`（`intellij.platform.ide.impl.actions.xml:448`，名字直译就是"隐藏所有工具窗口"）只挂在 WindowMenu `:656`。→ TaoCode 在 View 菜单再放一行 `view.maximizeEditor` 是自造重复项且菜单名与 IDEA 不符，建议删除或改名为「隐藏所有工具窗口」

**下次接续建议**：优先把 45/46 收尾做完（并入 `_batch4546.md` + 追加 09-26 日志），再开第 47 批（`TW.CloseAllTabs`）并顺手落 §7/§8 的三条判定。注意本文件已连续三次因并发防护跳过——真正的批次推进应在主会话连续做。

---

## 2026-09-26 后续执行 · 第 0 步并发防护第四次命中 → 本轮跳过改码，只读完成第 50 批取证

**并发判定证据**（只读扫描 `src/`+`native/` mtime）：`src/App.vue` 329s、`src/style.css` 380s、`src/toolWindowContentUi.ts` 436s、`src/toolWindowResize.ts` 780s、`tests/tool-window-*.test.mjs` 321–325s 全在 8 分钟窗口内；`docs/source-todo.md` 199s / `docs/ui-parity-checklist.md` 231s / `.workbuddy/memory/2026-09-26.md` 192s 为该批收尾写入（时间序单调 src→tests→docs→memory = 一批已闭合，不是半途写入）。按硬规则**本轮不改任何文件（含 docs）**，仅记录。另：本自动化记忆已 84 min 未更，说明 3–7 min 前的 src 改动来自主会话而非上一轮定时任务。

**第 50 批规格（只读取证完成，可直接开工）：菜单快捷键提示纠错 —— 六处重复和弦 + 三处自造动作行**

方法：python 扫 `src/App.vue` 全部带静态 `keys:` 的 MenuRow 找重复和弦，再逐个到 IDEA 源码定位真实绑定。`row.keys` 运行时只有两个消费点（`App.vue:3955` 写进命令面板索引、模板里渲染快捷键提示），**没有按键→动作的通用分派器**（都在 `onKey` 显式分支），所以这些 bug 是「菜单/面板里显示的快捷键是错的」，不是双触发。

| # | 行 | 现状 | IDEA 权威 | 结论 |
|---|---|---|---|---|
| 1 | `run.debugContext` `App.vue:3707` | `keys:'Ctrl Shift F9'` | `$default.xml:475` `<action id="DebugClass"/>` —— **空条目 = 显式无快捷键**；`:428-430` `Compile` = `control shift F9` | **删 keys**（IDEA 的 Debug context configuration 无键位） |
| 2 | `build.rebuild` `App.vue:3699` | `keys:'Ctrl Shift F9'` | `java/java-backend/resources/META-INF/JavaActions.xml:76` `Compile`=`CompileAction`（Ctrl+Shift+F9，编译选中文件/包）；`:79` `CompileProject`=`CompileProjectAction`（icon=AllIcons.Actions.Rebuild，**真 Rebuild**，`$default.xml` 无任何绑定）；`:71` `CompileDirty`=Ctrl+F9 已是 `build.project` | 二选一：**建议删 keys** 保留「重新构建项目」语义（TaoCode `startBuild(true)` 有真实消费方 `App.vue:3699`） |
| 3 | `app.settings.git` `App.vue:3744` | `keys:'Ctrl Alt S'`，`run: openSettings()` | `$default.xml:21-23` `ShowSettings` = `control alt S`（唯一）；`plugins/git4idea/**/*.xml` 里所有 `*Settings*` id 都是 popup 内 gear 组（`intellij.vcs.git.backend.xml:142` 等），**没有 Settings 菜单动作** | **删行**：标题承诺「版本控制设置」但 `run` 与 `app.settings`(:3532) 逐字相同 → 既是重复和弦又是假控件。若想保留，须让 `openSettings(section)` 支持新增 VCS 页（当前签名只支持 `'editor'\|'appearance'`，`App.vue:1738`），否则不渲染 |
| 4 | `window.searchEverywhere` `App.vue:3779` | `keys:'Shift Shift'` | `PlatformActions.xml:604`（GoToMenu）、`:142`（工具栏左组）、`:835`、`:850`（MainToolbarRight）；**WindowMenu(`:637-686`) 内无** | **删行**（`navigate.everywhere`(:3626) 已覆盖同一动作同一和弦） |
| 5 | `window.bookmarkSelection` `App.vue:3781` | `keys:'F11'`，标题「将当前选择存为书签」 | 全仓 grep `Store Current Selection` **0 命中** —— 该文案在 IDEA 里根本不存在；真动作是 `ToggleBookmark`=F11（`$default.xml:776-778`，文案 `ActionsBundle.properties:1328` `Toggle _Bookmark`） | **删行** |
| 6 | `window.toggleBookmark` `App.vue:3782` | `keys:'Ctrl F11'`，标题「切换书签（不跳转）」 | `ToggleBookmarkWithMnemonic`=control F11（`$default.xml:779-781`，文案 `ActionsBundle.properties:1329` `Toggle Bookmark Mnemonic…`），**无「不跳转」语义** | **删行**（`navigate.bookmarkMnemonic`(:3636) 已是正确行） |
| 7 | `tools.terminal` `App.vue:3875` | `keys:'Alt F12'` | `ActivateTerminalToolWindow`=alt F12 是唯一绑定（`$default.xml:368-370`）；`ToolsMenu` 组内容 = `CreateLauncherScript, CreateDesktopEntry, OtherMenu, ToolsMenu.Services`（`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:434-440`），**无 Terminal** | **删行**（`window.activateTerminal`(:3792) 已正确） |

**必须同轮修掉的注释**：`App.vue:3775-3777` 的注释断言「IDEA's Window menu (ActionsBundle: "Search Everywhere…", "Store Current Selection as a Bookmark", …)」——**该 provenance 是编造的**（见 #4/#5 证据）。删行后注释要改写为真实出处：SearchEverywhere→GoToMenu+工具栏；书签组 `EditBookmarksGroup`→`platform/bookmarks/resources/intellij.platform.bookmarks.xml:236-247` 用 `add-to-group group-id="EditMenu" anchor="after" relative-to-action="Macros"`（属 **Edit 菜单**）；`ToggleBookmark/ToggleBookmarkWithMnemonic` 挂 `EditorTabPopupMenu`/`ProjectViewPopupMenu`（同文件 `:225-228`）与环境菜单。

**已核对无需改动的键位**（`$default.xml` 行号，供回归断言复用）：`CloseActiveTab`=control shift F4(`:260-261`)、`NextTab`=alt RIGHT(`:717-718`)、`PreviousTab`=alt LEFT(`:309-310`)、`HideActiveWindow`=shift ESCAPE(`:867-868`)、`ResizeToolWindowLeft`=control alt shift LEFT(`:873-874`)、`MaximizeToolWindow`=control shift QUOTE(`:885-886`)、`JumpToLastWindow`=F12(`:846-847`)、`RestoreDefaultLayout`=shift F12(`:865`)、`ShowBookmarks`=shift F11(`:357`)、`ShowTypeBookmarks`=control shift F11(`:360`)、`RunClass`=control shift F10(`:705`)、`ChooseRunConfiguration`=alt shift F10(`:1019`)、`Debug`=shift F9(`:981`)、`Run`=shift F10(`:573`)、`ActivateTerminalToolWindow`=alt F12(`:369`)、`ShowSettings`=control alt S(`:22`)。`TW.CloseOtherTabs`/`TW.CloseAllTabs`/`ToggleContentUiTypeMode`/`DockToolWindow`/`PinToolwindowTab` 在 `$default.xml` **均无绑定** —— 别给它们自造键位（47/49 批已按此处理）。

**安全性**：这 7 个 row id 在 `tests/` 里 grep **0 命中** → 删行不会破测试；`options`/`keywords` 无需迁移；`window.*` 各行的区分度只增不减。

**下一步建议**：主会话执行第 50 批（删 6 行 + 改 1 行 keys + 修注释 + 六项验证 + 回写 `docs/source-todo.md`/`docs/ui-parity-checklist.md`/`.workbuddy/memory/2026-09-26.md`），并考虑新增 `tests/menu-shortcut-parity.test.mjs`：把上表右侧的 IDEA 权威键位写成断言表，反向禁止 `App.vue` 再出现重复和弦（同一 `keys` 出现两次即失败）。
