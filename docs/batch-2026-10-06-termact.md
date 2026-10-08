# 批次报告 · 2026-10-06 · termact（`ex/terminal-actions` 里还缺的用户可见终端动作）

上游真源 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下表每条路径本轮**亲自 `sed -n` / `grep -n` 打开过**，
未上网、未照抄别人判词）。文件面：`src/terminalActions.ts` + `src/components/TerminalPanel.vue` + `tests/terminal-actions.test.mjs`。

## 0) 一句话结论

判决簿那行「缺统一动作上下文层」是**陈账**（`src/terminalActions.ts` 就是那一层，本批把它从 21 条动作扩到 23 条）。
族里**真缺、上游确有、本仓架构能做**的用户可见动作 = **键盘翻页滚动终端输出**（`Terminal.PageUp` / `Terminal.PageDown`）⇒ 本批只做这一条：
Shift+PageUp / Shift+PageDown 滚这个窗格的一整页 + 右键菜单两条紧跟「清空终端缓冲区」+ 备用屏（vim/less）里整条不启用、按键交回该程序。
宿主行（`src/App.vue` / `src/bridge.ts`）与 `native/` **一字未动**，本批不需要它们动。门禁 `97 / 97 / 0`（基线 93），反向验证注入两处后**红 3 条**，收工按注入前缀（`TERMACT` + 连字符 + `PROBE` 这个 token）全仓 grep = **0**。

## 1) 判定表（判词逐条 + 磁盘真身；`docs/inventory/verdict-platform_rest.md:350` = `platform_rest_verdict_table.json:1011`）

| 判词声称的项 | 判定 | 磁盘真身（本轮实测坐标） |
|---|---|---|
| 「面板内搜索条：Ctrl+F 查找/上一个/下一个/清除，走 `SearchAddon`，无更多匹配给提示」 | `[x]` 已闭环 | `TerminalPanel.vue:717/:722/:729`（`toggleSearch`/`runSearch`/`clearSearch`）+ 模板查找条；判据 `tests/terminal-actions.test.mjs:110-116`、`:191-203` |
| 「重命名/分屏/回收已退出/重启等动作逐条有落点」 | `[x]` 已闭环 | `TERMINAL_ACTIONS`（现 23 条，新增那两条在 `terminalActions.ts:335-354`）+ 面板工具条/菜单；判据 `tests/terminal-actions.test.mjs:139-150` |
| 「缺统一动作上下文层：`TerminalActionWrapper`/`TerminalBaseContextAction` 没有统一对象」 | `[!]` **判词过时，需订正**（见 REQ-1） | `src/terminalActions.ts`：`TerminalActionContext` = 那份 DataContext、`enabledWhen` 求值 = 那份 `update()`、`createTerminalActions` = 那份登记表（三条登记规则 `TerminalActionUtil.java:36-40/45-48/49` 与 `TerminalBaseContextAction.java:20` 的 `setEnabledAndVisible` 都在）；判据同文件测试 `:25-53` |
| 三条类行 `TerminalActionUtil` / `TerminalActionWrapper` / `TerminalBaseContextAction` 的 presence=「从未出现」（`platform_rest_verdict_table.md:4512-4514`） | `[!]` **需订正**（REQ-2）：语义已移植、类名不同，不是「从未出现」 | 同上；`TerminalActionWrapper.kt:27-30` 的「keyStrokes → 键位」在本仓是 `terminalActionKeyFor`（`terminalActions.ts:115-122`） |
| （判词没列，本批找出来的真缺口）`Terminal.PageUp` / `Terminal.PageDown` | `[x]` **本批做了** | 上游：`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:205-208` 与 `:209-212`（`$default` 键位 `shift PAGE_UP` / `shift PAGE_DOWN`）、文案 `plugins/terminal/resources/messages/TerminalBundle.properties:83/:85`（Page Up / Page Down；旧引擎那份 `IdeBundle.properties:1977-1978`）、实现 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalScrollingActions.kt:16`/`:18`（动作类）+ `:37`/`:39`（`Unit.PAGE, ∓1`）+ 启用门同文件 `:27-29`、语义 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/view/impl/TerminalOutputScrollingModel.kt:33-38` + `TerminalOutputScrollingModelImpl.kt:143-172`（`coerceIn` 夹两端）、菜单位置 `intellij.terminal.frontend.xml:266-268`（宿主 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/view/impl/TerminalEditorFactory.kt:116`） |
| `Terminal.LineUp` / `Terminal.LineDown`（同文件 `:197-204`，键位 control UP / DOWN） | `[~]` **本批未做** | 上游那两把键按「光标在提示符区 / 在输出区」分给不同动作（`plugin.xml` 的 `Terminal.SelectLastBlock` = control UP、`Terminal.SelectPrompt` = control DOWN），本仓一个窗格只有一层表面分不出这个区 ⇒ 真按就是抢 shell 的 Ctrl+↑（PowerShell PSReadLine 的 HistorySearchBackward）。逐行滚仍可由鼠标滚轮完成 |
| `Terminal.SelectNextTab` / `SelectPreviousTab`（`JBTerminalSystemSettingsProviderBase.java:194-201`，键取 `NextTab`/`PreviousTab` = `$default.xml:717-718`/`:309-310` 的 Alt+Right/Left） | `[-]` 架构不等价（键位已归宿主） | 本仓那两把键在 `src/keymap.ts:343-345` 全局截走做**编辑器标签**切换 ⇒ 面板内再截一次会抢宿主那条 |
| `Terminal.SwitchFocusToEditor`（`plugin.xml:127` + `TerminalMoveFocusToEditorAction.kt:14-25`，`activateEditorComponent()`） | `[~]` **本批未做，可做** | 本仓等价物已备：`src/editorFocus.ts:24` 的 `focusActiveEditor()`（现被 `src/mainToolbarFocus.ts:115` 消费）。缺的只是面板那条动作 + 一次 emit ⇒ 记在本报告里给下一批 |
| `Terminal.MoveToolWindowTabToEditor`（「Open as Editor Tab」，`IdeBundle.properties:1986`） | `[-]` 架构不等价 | 本仓没有「把工具窗 content 挂成编辑器 tab」那层容器（本轮按 `src/App.vue` 的 tab 数据形状判断，未逐条核） |
| `TerminalNewPredefinedSession`（`intellij.terminal.frontend.xml:249-251` + `frontend/.../TerminalNewPredefinedSessionAction.kt:31-40`，弹出**探测到的 shell** 列表） | `[-]` 宿主侧没有 ⇒ 不放假控件（REQ-3） | 本仓宿主只起 `%COMSPEC%`（`native/terminal.cpp:55-61`，取不到回落 `cmd.exe`），没有 shell 探测通道。旧的那份 `org/jetbrains/plugins/terminal/action/TerminalNewPredefinedSessionAction.kt:11-15` 是 `@Deprecated` 且 `actionPerformed` 里只有 `// do nothing` |
| `Terminal.ShowDocumentation`（`plugin.xml:180-181`） | `[-]` 架构不等价 | `TerminalShowDocAction.kt:27-38`：只在**终端命令补全 lookup** 里启用（`isPromptEditor && lookup != null`）；本仓没有终端补全弹窗 |
| `Terminal.CopyBlock` / `ClearPrompt` / `SelectPrompt` / `SearchInCommandHistory` / 补全一族 / `Terminal.PromptStyle` 组 | `[-]` 架构不等价（OSC 133 无产生者） | 与 `docs/batch-2026-10-06-bucket10b.md:44/:155` 同一条卡点（裸 ConPTY 不注入 shell integration），本批不重做、不重述 |
| `Terminal.OpenInTerminal`（`RevealFileInTerminalAction`，`plugin.xml:116-119`） | `[x]` 已闭环 | `src/treeActions.ts:151` → 面板 `openIn(dir)`（`TerminalPanel.vue:322`，`defineExpose` 在 `:647`） |
| `Terminal.ShowTabs`（`JBTerminalSystemSettingsProviderBase.java:213-215`，键取 `ShowContent`） | `[-]` 无法核实 | 本轮没有打开 `ShowContentAction` 的实现 ⇒ 不判、不做（上游 `isReworkedTerminalEditor` 那套弹出列表与「标签常驻可见」的本仓不是一件事，但这句话我没有证据支撑） |

## 2) 本批做了什么（一条动作，四个落点）

1. **登记表**：`terminalActions.ts:190-191` 两个 id、`:335-354` 两条定义（`scope: 'context'` ⇒ 没有终端时整条不出现；键位 `Shift+PageUp` / `Shift+PageDown` 直抄 `frontend.xml:207/:211`；名字是上游英文原文 `Page Up`/`Page Down` 的直译 ⇒ 本仓无中文包，官方译名**无法核实**）。
2. **门（同一个真源）**：`terminalPageScrollApplies(alternateBuffer)`（`:230-232`）= 上游 `isOutputModelEditor` 那一档；上下文新字段 `alternateBuffer`（`:159`），面板读数 `TerminalPanel.vue:524`（xterm `buffer.active.type === 'alternate'`），喂进上下文在 `:155-156`。
3. **键派发**：`terminalActionKeyFor` 扩两条（`:119-120`，只认 keydown、只认**带 Shift**）；面板在 `attachCustomKeyEventHandler` 里 `:580-584` —— 备用屏时 `return true` 把键交回全屏程序，其余 `scrollPages(∓1)` 后 `return false`；不带 Shift 的 PageUp/PageDown 一律不拦（`less`/`man` 靠它们）。
4. **菜单两条**：`TerminalPanel.vue:820-821`，位置紧跟「清空终端缓冲区」= 上游 `intellij.terminal.frontend.xml:266-268` 的顺序；`v-if="shownAs(...)"` + `:disabled="!can(...)"` + `title` 走 `why()`，**没有后端的条目不画**。
5. **判据**（`tests/terminal-actions.test.mjs` 新增 4 条，`:216-287`）：键位与上游逐字一致 + 裸 PageUp/Ctrl/Alt/Meta/keyup 全不吃；备用屏里 `enabled=false` 且 `visible=true`（上游 disable 而不 hide）、无终端时 `visible=false`；`title` 拼键位与原因；接线（面板里 `scrollPages` 两路、`alternateBuffer` 真读数、菜单三条同序）。每条都是 `assert.equal` 级形状断言，能红。

## 3) 原始数字

| 文件 | 前 | 后 | 上限 | 余量 |
|---|---|---|---|---|
| `src/terminalActions.ts` | 446 | 526 | 900 | 374 |
| `src/components/TerminalPanel.vue` | 825 | 862 | 900（未登记，`tests/module-size.test.mjs:22`） | 38 |
| `tests/terminal-actions.test.mjs` | 213 | 287 | 900 | 613 |

`node --test tests/terminal*.test.mjs tests/module-size.test.mjs`：改前 **tests 93 / pass 93 / fail 0**，改后 **tests 97 / pass 97 / fail 0**（+4 = 本批判据；没有放松任何既有断言，`ctx()` 只补了 `alternateBuffer: false` 这一格）。

## 4) 反向验证（注入 → 变红 → 还原 → 复绿）

1. 注入 A：`terminalActions.ts` 里 `terminal.page.up` 的 `enabledWhen` 换成 `() => true` 并带本轮注入标记的注释「撤掉备用屏那道门」；注入 B：面板键盘那一路的 `scrollPages(...)` 换成 `void 0` 并带同一标记「键盘那一路不滚」（标记 = 下一节那个 token，故意不在本报告里连写，免得收工 grep 命中自己的描述）。
2. `node --test tests/terminal-actions.test.mjs` ⇒ **tests 22 / pass 19 / fail 3**，红的是「备用屏里翻页两条不启用…」「两条的 title 带上键位…」「接线：面板真的按这两条滚整页…」⇒ 这道门真有牙。
3. 还原：两处逐字改回 ⇒ 与注入前的临时备份 `diff` **逐字节相同**（`ACTIONS-IDENTICAL` / `PANEL-IDENTICAL`），临时备份已删。
4. 复绿：同一命令 22/22/0，全量 `tests/terminal*.test.mjs tests/module-size.test.mjs` = **97 / 97 / 0**。
5. 残留：`grep -rn` 那个注入 token（`TERMACT`+`-`+`PROBE`）在 `src` / `tests` / `native` / `build` / `scripts` / `docs` 全部 = **0**（含本文件：上面两处描述都把它拆开了）。本批没在仓库里留任何临时文件（注入前的临时备份已 `diff` 核对并删除）。

## 5) 请求（不改判决簿本体）

- **REQ-1**（`docs/inventory/verdict-platform_rest.md:350` 与 `platform_rest_verdict_table.json:1011` 的 `ex/terminal-actions` reason）：建议把末句「缺统一动作上下文层……动作启用矩阵没有统一对象」替换为「统一动作上下文层已落 `src/terminalActions.ts`（23 条动作 + 登记三规则 + `setEnabledAndVisible` 同档）；仍缺的用户可见动作是键盘翻页滚动（本批 2026-10-06 termact 已落 `Terminal.PageUp`/`PageDown`）、逐行滚动（键位分不出提示符/输出区，见 §1）、`Terminal.SwitchFocusToEditor`（落点 `src/editorFocus.ts` 已备）与 shell 选择新建会话（宿主无 shell 探测）」。
- **REQ-2**（同表 `:4512-4514` 三条类行的 presence=「从未出现」）：这三条的**语义**在 `src/terminalActions.ts` 有等价物（登记规则 / keyStrokes→键位 / `setEnabledAndVisible`），presence 应改写成「类名不同、语义已移植」，`lines: 0` 那一档随之。
- **REQ-3**（`native/terminal.cpp`，不在本轮文件面）：要落 `TerminalNewPredefinedSession` 需要一条 shell 探测/指定 shell 的通道（`term.create` 现在只有 cols/rows/cwd）。不落则该动作在本仓永远是假控件。
- 本批**没有**需要主代理粘贴的宿主行：动作表、键派发与菜单都在面板内部，`src/App.vue`（余量 31 行）与 `src/bridge.ts`（余量 1 行）一字未动。

## 6) 留痕 / 边界

1. `src/terminalActions.ts` 文件头原写「`updateTerminalAction` 是那份 `update()`」—— 全仓**没有**这个函数（grep 只在注释里命中），求值入口是 `createTerminalActions` ⇒ 本轮就地订正并在原地留了一句说明。
2. 中文文案是上游英文原文直译（`Page Up` → 向上翻页）：本地树没有 zh 语言包 ⇒ 官方中文措辞**无法核实**。
3. 「一页」的口径差异留个数：上游 `scrollByPages` = `floor(视口高 / 行高) × 行数`（`TerminalOutputScrollingModelImpl.kt:169-172`），xterm 的 `scrollPages(n)` = `scrollLines(n × (rows-1))` ⇒ 本仓每页比上游少 1 行；夹住两端、到底/到顶原地不动这条行为一致。
4. 本轮按指令**只跑了** `tests/terminal*.test.mjs` + `tests/module-size.test.mjs`，没跑 `vue-tsc` 与引用门；新增的每条 `路径:行号` 都自己 `sed -n` 打开确认过存在且不越界。为避模板字面量类型收窄的疑点，`scrollPage(direction: number)` 取宽类型（`-1 | 1` 的字面量调用照旧）。
