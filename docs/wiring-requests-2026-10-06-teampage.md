# 终端「逐行滚动 + Esc 回编辑器」的供给侧接线请求（2026-10-06 · teampage）

本轮（代号 teampage）**只做了消费侧**：`src/terminalScrolling.ts`（新建）、`src/terminalActions.ts`、
`src/components/TerminalPanel.vue`、`tests/terminal-actions.test.mjs`。
下面每一条要动的都是保留文件（`src/settingsModel.ts`、`src/previewSettings.ts`、
`native/settings_schema.hpp`、`native/settings_schema.cpp`、`src/components/SettingsDialog.vue`、
`src/keymap.ts` / `src/keymapBindings.ts`）⇒ 逐字 old/new 已备好，可直接粘贴。
上游坐标全部本轮亲自 `sed -n` / `grep -n` 打开过；本批**不需要** `native/` 的任何新通道
（滚动是 xterm 的事，交焦点是 DOM 的事），也**不需要**改 `src/App.vue`（证据见 R-1 最后一行）。

## 0) 本轮已经落地的消费侧（给主代理对照，不用再改）

| 出口 | 消费点（本仓，本轮实测行号） |
|---|---|
| `src/terminalScrolling.ts:110` `terminalScrollingApplies(alternateBuffer)`（滚动四条共用的门） | `src/components/TerminalPanel.vue:544`（菜单那一路）与 `:591`（键盘那一路）；`src/terminalActions.ts` 里四条 `enabledWhen`（`terminal.page.up` / `terminal.page.down` / `terminal.line.up` / `terminal.line.down`） |
| `src/terminalScrolling.ts:120` `terminalLineScrollKeyApplies(alternateBuffer, viewportAtBottom)` | `src/components/TerminalPanel.vue:599` —— 不成立时 `return true`，Ctrl+↑/↓ 原样落进 PTY |
| `src/terminalScrolling.ts:129` `terminalScrollBy(target, unit, direction)` | `src/components/TerminalPanel.vue:545`（菜单）与 `:592`/`:600`（键盘的两条方向） |
| `src/terminalScrolling.ts:91` `terminalAlternateBuffer(buffer)` 与 `:99` `terminalViewportAtBottom(buffer)` | `src/components/TerminalPanel.vue:535`（`pane.instance.buffer.active`）与 `:599`；面板 `actionContext()` 的 `alternateBuffer` 那一格仍走前者 |
| `src/terminalActions.ts:166` `terminalActionKeyFor(event, options?)`（新增 `lineUp`/`lineDown`/`focusEditor` 三个结果） | `src/components/TerminalPanel.vue:578`（把 `moveFocusToEditorWithEscape` 传进去） |
| `src/editorFocus.ts:22` `focusActiveEditor()`（**早就存在**，本轮第一次被终端面板消费） | `src/components/TerminalPanel.vue:604`；既有消费方另有 `src/mainToolbarFocus.ts:115` 与 `src/notifications.ts:231` |
| 面板入参 `settings.moveFocusToEditorWithEscape`（缺省 false） | 声明 `src/components/TerminalPanel.vue:75`，读数 `:129`，进上下文 `:170` |

判据：`tests/terminal-actions.test.mjs`（本轮新增 8 条，见批次报告 §4）。
**宿主没传这一格之前，行为与本轮改造前逐字相同**：Esc 仍然整把交给 shell（上游默认也是这个档），
Ctrl+↑/↓ 只在窗格已滚离底部时逐行滚，贴底时仍归 shell。

---

## R-1）新设置键 `moveFocusToEditorWithEscape`（布尔，**缺省 false**）—— 五处成对

上游依据（本轮逐行打开过）：
- 动作本体：`plugins/terminal/resources/META-INF/plugin.xml:127`
  `<action id="Terminal.SwitchFocusToEditor" class="org.jetbrains.plugins.terminal.action.TerminalMoveFocusToEditorAction"/>`
  —— **没有** `<keyboard-shortcut>` 子元素；全树 `grep -rn "SwitchFocusToEditor" --include=*.xml` 只命中这一行
  ⇒ `$default.xml` 也没有绑它 ⇒ **默认无键**。
- 那把键由用户给：`plugins/terminal/frontend/src/com/intellij/terminal/frontend/settings/TerminalOptionsConfigurable.kt:401-405`
  ```kotlin
  actionShortcutComboboxWithEnabledCheckbox(
    labelText = message("settings.move.focus.to.editor.with"),
    presets = listOf(ESCAPE_SHORTCUT_PRESET),
    actionId = "Terminal.SwitchFocusToEditor"
  )
  ```
  勾选框的初值 = 「当前键表里有没有这条键」（同文件 `:778-787`，其中 `:786` 是
  `val initialCheckboxState = curShortcuts.isNotEmpty()`）⇒ 默认**不勾**；
  取消勾选会把键从动作上摘掉（同文件 `:795-797` 的 `updateActionShortcut(actionId, null)`）。
  预设那把键就是 Escape：同文件 `:869-872`
  `private val ESCAPE_SHORTCUT_PRESET = ShortcutPreset(KeyboardShortcut(KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), null), "Escape")`。
- 文案：`plugins/terminal/resources/messages/TerminalBundle.properties:129`
  `settings.move.focus.to.editor.with=Move focus to the Editor with:`；
  动作名同文件 `:6` `action.Terminal.SwitchFocusToEditor.text=Switch Focus To Editor`。
- 默认档为什么是「不勾」而不是「勾上」：上游专门为这件事弹一条通知，
  `plugins/terminal/resources/messages/TerminalBundle.properties:236-238`
  （`Terminal: Escape behavior changed` / `The "Escape" key is now sent to the shell instead of switching focus to the editor.`），
  触发条件就是 `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalEscapeBehaviorChangeNotification.kt:19`
  的 `!moveFocusToEditorAction.shortcutSet.hasShortcuts()`。
- 交焦点那一步：`plugins/terminal/src/org/jetbrains/plugins/terminal/action/TerminalMoveFocusToEditorAction.kt:18`
  `ToolWindowManager.getInstance(project).activateEditorComponent()`；启用门同文件 `:21-25`
  （`project != null && terminalEditor?.isReworkedTerminalEditor == true && getData(PlatformDataKeys.TOOL_WINDOW) != null`，
  且 `:24` 的原文注释解释 TOOL_WINDOW 为 null 意味着「终端本身就在编辑器标签里」）。
  备用屏为什么绝不抢 Esc：`plugins/terminal/frontend/src/com/intellij/terminal/frontend/action/TerminalEscapeAction.kt:170-172`
  原文 "In alternate mode, escape action should be sent to the terminal process, so disable the action in this case."

**R-1a** `src/settingsModel.ts` 的 `EditorSettings` 接口（在 `terminalBaseFontSize: number` 之后加一格）：
```ts
  /**
   * 「Move focus to the Editor with:」那一格（上游是键表里的快捷键，不是终端选项）：
   * 勾上 = 把 Escape 绑到 `Terminal.SwitchFocusToEditor`（交回编辑器），不勾 = Esc 整把交给 shell。
   * 上游 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/settings/TerminalOptionsConfigurable.kt:786`
   * 的初值是 `curShortcuts.isNotEmpty()`，而 `plugins/terminal/resources/META-INF/plugin.xml:127` 没给这条动作配键
   * ⇒ 缺省 **false**。消费方 `src/components/TerminalPanel.vue:129`（面板再传给 `terminalActionKeyFor`）。
   */
  moveFocusToEditorWithEscape: boolean;
```
**R-1b** 同文件 `defaultEditorSettings`（`:265` 那一条对象）尾部加：`, moveFocusToEditorWithEscape: false`。

**R-1c** `src/previewSettings.ts:52` 那行白名单（布尔值走文件末尾 `typeof value !== 'boolean'` 的兜底，正确）：
```ts
      key === 'wheelFontChangeEnabled' || key === 'terminalBaseFontSize' || key === 'moveFocusToEditorWithEscape' ||
```
（漏这一处的后果与该文件 `:57` 那句注释写的一样：预览态能改、永远存不下。）

**R-1d** `native/settings_schema.hpp` 的 `EDITOR_SETTING_KEYS`（`:124` 那行）：
```cpp
    "wheelFontChangeEnabled", "terminalBaseFontSize", "moveFocusToEditorWithEscape",
```
并按该文件既有的注释规格补一句出处（上游 `plugin.xml:127` 无键 + `TerminalOptionsConfigurable.kt:786` 的初值）。
**R-1e** `native/settings_schema.cpp:419` 的默认表：`, {"moveFocusToEditorWithEscape", false}`
（布尔由同文件 `:134` 的 "Editor flags must be JSON booleans." 那条兜底校验，不需要进
`native/settings_editor_keys.hpp` 的数值区间那一段）。

**R-1f** `src/components/SettingsDialog.vue`：挂在既有的那两把终端键旁边
（`:736` 的 `EditorSavePassesFields` 那段，紧跟「终端基准字号」那个 `field-row`）：
```html
<label class="checkbox-row"><input v-model="editor.moveFocusToEditorWithEscape" type="checkbox" aria-describedby="editor-terminal-esc-hint" /><span>用 Escape 把焦点交回编辑器（终端）</span></label>
<p id="editor-terminal-esc-hint" class="field-hint">对应 IDEA 的 Tools › Terminal › “Move focus to the Editor with:”（默认不勾；勾上 = 把 Escape 绑到 Terminal.SwitchFocusToEditor）。不勾时 Escape 整把交给 shell，全屏程序（vim 等）照旧收得到。中文措辞是英文原文直译，本地树没有中文包 ⇒ 官方译名无法核实。</p>
```
⚠ 位置是**本仓的架构映射**，不是上游的位置：上游这一格在 Settings › Tools › Terminal
（`TerminalOptionsConfigurable.kt:401-405`），本仓没有 Terminal 设置页，既有的两把终端键也在「编辑器」页
（`SettingsDialog.vue:736`）⇒ 沿同一条路。**官方中文措辞无法核实**（本地树只有英文 `TerminalBundle.properties`）。

**不需要改 `src/App.vue`**：`src/App.vue:2304` 已经是
`<TerminalPanel ... :settings="editorSettings" ...>` 整本传 `EditorSettings`，
R-1a/R-1b 落完以后 `src/components/TerminalPanel.vue:129` 自动就读到了。

---

## R-2）这四条滚动动作进**全局**动作表 / 「查找操作」（`src/keymap.ts`、`src/keymapBindings.ts` 是保留文件）

上游这四条都写了 `<override-text place="GoToAction"/>`，也就是说它们在「查找操作」列表里显示的是**带括号那一版**：
- `plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:198`（LineUp）、`:202`（LineDown）、
  `:206`（PageUp）、`:210`（PageDown）；
- 对应文案 `plugins/terminal/resources/messages/TerminalBundle.properties:80` = `Line Up (Terminal)`、
  `:82` = `Line Down (Terminal)`、`:84` = `Page Up (Terminal)`、`:86` = `Page Down (Terminal)`
  （`:79`/`:81`/`:83`/`:85` 是不带括号的那一版，给菜单与工具条用）。

本仓现状：这四条只在**终端面板内**可达（xterm 的 `attachCustomKeyEventHandler` + 面板右键菜单），
全局键表里没有它们 ⇒ 焦点不在终端里时按 Ctrl+↑/↓ 与 Shift+PageUp 不会滚终端（这正是应当的，
上游也把作用域限定在终端 editor 上：`TerminalScrollingActions.kt:27-29` 的 `isEnabled` 问的是
`e.terminalEditor`）。**要进「查找操作」就需要**：
1. `src/keymapBindings.ts` 里给四条 `KEY_BINDINGS` 条目（id 建议 `terminal.line.up` / `terminal.line.down` /
   `terminal.page.up` / `terminal.page.down`，与本仓 `src/terminalActions.ts` 的 id 一字不差）；
2. `src/keymap.ts` 的 `registerKeymapActions` 那一带把四条注册进 `ACTIONS`（`src/actionRegistry.ts`），
   `run` 里再转给终端面板 —— 面板已经 `defineExpose({ openIn, adopt })`（`src/components/TerminalPanel.vue:667`），
   需要主代理决定是扩这个 expose 还是在 App 侧存一个「滚动当前窗格」的回调；
3. 「查找操作」的显示名用带 `(Terminal)` 那一版（上面 bundle `:80/:82/:84/:86`）。
本轮**没有**自加这一层：本 lane 改不到那两个保留文件，也不想在面板里造一个没有生产消费方的注册表。

---

## R-3）执行控制台那一档 Escape（本仓等价物 = `src/components/RunConsole.vue`，本轮没动）

上游对**不在终端工具窗里**的终端面板（例如运行/调试控制台）走的是另一档：
`platform/execution-impl/src/com/intellij/terminal/TerminalEscapeKeyListener.java:55-60`
——「这条终端面板在终端工具窗之外……那就跟着终端的 shortcut；**如果没有定义 shortcut，也允许用 Escape 交回编辑器**」。
⇒ 控制台里的 Escape 回编辑器是**默认就通**的，不需要 R-1 那一格。
本仓 `src/components/RunConsole.vue` 有自己的一份 xterm，是这条的落点；它在别的 lane 的文档状态里，
本轮按指令没有动它（也不动 `src/App.vue` / `src/bridge.ts`）。下一批接的时候门照
`TerminalEscapeKeyListener.java:55-60`，别把面板（终端工具窗）那一档的缺省 false 抄过去。

---

## 备注（不需要接线的那两件事）

1. **OSC 133 / shell integration**：`Terminal.SelectLastBlock`（`plugins/terminal/resources/META-INF/plugin.xml:151-155`，
   门 = `.../block/prompt/TerminalBlockSelectionActions.kt:19-21` 的 `isPromptEditor`）与
   `Terminal.SelectPrompt`（同文件 `:156-160`，门 = `:27-30` 的 `isOutputEditor && primarySelection != null`）
   这两条**没搬**，也不属于 R-1/R-2 —— 它们要求「提示符区/输出区」这一格信号，本仓裸 ConPTY 没有产生者
   （同 `src/terminalClipboard.ts` 里 CopyBlock 那条卡点）。本批用「视口是否贴底」做代理，
   差异已经逐行写进 `src/terminalScrolling.ts` 文件头与批次报告 §3。
2. `Terminal.SwitchFocusToEditor` 的**菜单位置**：全树 grep 确认上游没有给它任何 `<add-to-group>`，
   `Terminal.ReworkedTerminalContextMenu`（`intellij.terminal.frontend.xml:256-274`）里也没有它
   ⇒ 本仓菜单里没有这一条，也不该有（判据钉在 `tests/terminal-actions.test.mjs` 最后那条接线用例里）。

## 处理结果（wiring-backlog lane，2026-10-06）

- **R-1（`moveFocusToEditorWithEscape` 五处成对）** —— `src/settingsModel.ts`（保留）+ native + `SettingsDialog.vue`。复核 `TerminalPanel.vue:75` 的 settings prop 已含 `moveFocusToEditorWithEscape`。需 settings/native owner 确认键是否已落。
- **R-2（四条滚动动作进全局表）** —— `src/keymap.ts` / `keymapBindings.ts`（保留），非本 lane。
- **R-3（RunConsole Escape）** —— `src/components/RunConsole.vue`（本 lane 可改面），登记。

结论：零接线（R-1 待核，R-2/R-3 转 owner/登记）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（R-1 待核，R-2/R-3 转 owner/登记）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
