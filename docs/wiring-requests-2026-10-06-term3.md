# 接线请求 · 2026-10-06 · term3（ex/terminal 与 ex/terminal-actions）

本代理的可改面只有 `src/terminal*.ts` 与 `src/components/TerminalPanel.vue`。下面每一条的目标文件都是保留文件
（`src/App.vue`、`src/keymap.ts`、`src/settingsModel.ts`、`native/*`、`CMakeLists.txt`），需要主代理接。
上游路径与行号都是本轮亲自打开过的。

## R1 终端输出的 `file:` / 路径链接 → 编辑器（沿用 `docs/wiring-requests-2026-10-06-terminal.md` 的 T1，补可判定层）

现状：`src/terminalHyperlinks.ts` 已经能算出 `{ kind:'file', path, line, column }`（`terminalLinkTarget`），
本轮又补上了裸路径的判定（`terminalPathLinkRanges`，上游 `plugins/terminal/src/org/jetbrains/plugins/terminal/hyperlinks/filter/TerminalGenericFileFilter.kt:20-30`）。
但 `terminalLinkActivatable` 对 `kind:'file'` 一律给否（`src/terminalHyperlinks.ts` 文件头第 4 条），
因为终端面板没有打开编辑器的通道（props/emits 里没有 jump 一类）。

请求：`src/App.vue` 给 `<TerminalPanel>` 加一个 `@open-file` 出口，落点沿用已有的
`linkPathWithinWorkspace`（`src/appLinkPath.ts:26`，绝对路径落回工作区相对路径、工作区外如实说明）+ `openFile`。

```vue
<!-- App.vue：终端面板那一段，加 emits 绑定（名字与面板 defineEmits 一致） -->
<TerminalPanel ... @open-file="onTerminalOpenFile" />
```

```ts
// App.vue script 里，紧跟已有的 openDocumentLink 之后
function onTerminalOpenFile(payload: { path: string; line: number | null; column: number | null }) {
  const target = linkPathWithinWorkspace(workspaceRoot.value, payload.path)
  if (target.kind === 'outside') { notify(`终端里的路径在工作区外：${target.shown}`); return }
  void openFile(target.path, payload.line ?? undefined, payload.column ?? undefined)
}
```

面板侧已经备好，只等这个事件（`src/components/TerminalPanel.vue` 的 `attachLinkProvider` 里
`if (!verdict.ok || target.kind !== 'browser') return []` 那一档，以及 `openTerminalUrl` 旁边加一行 emit 即可）。

## R2 宿主缺一条廉价的 `exists` 查询（原生侧，不需要新文件）

上游 `TerminalGenericFileFilter.kt:25-27` 是硬规则：**只有 `fileLookup` 查得到文件才算链接**；
`:110-112` 的 `TerminalVfsFileLookup` 注释写明「每一行输出都要过滤，只有 VFS 缓存查得起」。
本仓现在没有同步、廉价的存在性查询：`file.read` 会整读文件、`workspace.files` 是全树扫描 ⇒
所以 `terminalPathLinkRanges` 的 `exists` 由调用方注入，**面板暂时不渲染这批链接**
（判据 `tests/terminal-hyperlinks.test.mjs` 的最后一条把它钉住了，接错会红）。

建议落点：`native/file_queries.cpp`（已有的文件查询那一族）加一条 `file.exists`：
入参 `path`（工作区相对或绝对），出参 `{ exists: boolean, directory: boolean }`；
只 `std::filesystem::exists` / `is_directory`，不读内容。
`native/main.cpp` 的 dispatch 里注册这个名字，`src/bridge.ts` 的 `Method` 联合类型加 `'file.exists'`。
**不改 CMakeLists.txt**（落在既有 `.cpp` 里）。
上游依据：`plugins/terminal/src/org/jetbrains/plugins/terminal/hyperlinks/filter/TerminalFileLookup.kt`
（`TerminalFileKind` 的 FILE/DIRECTORY 两档正是这条返回形状）。

## R3 设置三格（`src/settingsModel.ts` 是保留文件）

面板现在写死 `TITLE_SETTINGS = { showApplicationTitle: true, applicationTitleShowingMode: 'always' }`
（`src/components/TerminalPanel.vue` 的注释里写了为什么取 `'always'` 那一档）。
上游的对应三格与默认值：

| 本仓键（建议） | 上游 | 默认 |
| --- | --- | --- |
| `terminalTabName` | `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:73` + `:325` | bundle `local.terminal.default.name=Local`（`plugins/terminal/resources/messages/TerminalBundle.properties:96`）⇒ 本仓直译「本地」 |
| `terminalShowApplicationTitle` | 同文件 `:68` | `true` |
| `terminalApplicationTitleShowingMode` | 同文件 `:71` + `settings/TerminalApplicationTitleShowingMode.kt:8-9` | `whenCommandRunning` |

旧存档缺键要补默认（不许按字段数量判损坏）；三格的取值范围就是 `src/terminalTitle.ts` 的
`TerminalTitleSettings`。接上后面板只需把常量换成 `settings.terminalXxx` 的 computed。

## R4 全局键位两条（`src/keymap.ts` / `src/keymapBindings.ts` 是保留文件）

终端面板已经实现了「焦点在终端里」这两条（`terminalActionKeyFor`，判据在 `tests/terminal-actions.test.mjs`）：

- `Ctrl+F` = `Terminal.Find`（`plugins/terminal/frontend/resources/intellij.terminal.frontend.xml:158`
  `use-shortcut-of="Find"`；`platform/platform-resources/src/keymaps/$default.xml:565-566` 给 `Find` 配的是 `control F`）；
- `Ctrl+Shift+T` = `Terminal.NewTab`（同文件 `:242-243`）。

要在全局（不只终端聚焦时）生效，需要在键位注册表里加这两条并指向终端面板的动作。
另外 `Alt+F12` 在本仓的实际含义是 `ActivateTerminalToolWindow`
（`platform/platform-resources/src/keymaps/$default.xml:368-369`，本仓实装 `src/keymap.ts:338`）
—— `src/terminalActions.ts` 的 `terminal.new` 原先把它当成「新建终端」的键展示，本轮已改成 `Ctrl+Shift+T`。

## N1 ConPTY 缺的两条信号（原生侧；不新建文件 ⇒ 不动 CMakeLists.txt）

`native/terminal.hpp:49-62` 的公开面是 `create/write/resize/kill/running/ids/kill_all/on_exit`，
`native/terminal.cpp` 只是把 ConPTY 的字节原样搬运（文件头注释 `:18-26` 写明「不解码不重写」）。缺：

1. **OSC 133 的命令边界**（`A/B/C/D` 序列 ⇒ `isCommandRunning`）。
   上游用它做三件用户可见的事，本仓三件都只能降级：
   - `TerminalClearAction` 的「命令在跑就不给清屏」（`src/terminalActions.ts` 里 `terminal.clear.buffer` 的 hint 已写明）；
   - `TerminalInterruptCommandAction.kt:24-29` 只在 `isCommandRunning` 时才发 `\u0003`；
   - 本轮的标题门 `TerminalTitleUtils.kt:54-59`（`WHEN_COMMAND_RUNNING` 那一档）⇒ 面板只能先按 `'always'`（见 R3）。
   建议落点：`native/terminal.cpp` 的 reader 线程旁挂一个**只观察不改写**的 OSC 扫描（把 133 事件通过
   现有的 `queue_event` 上报 `term.block {id, state}`），字节流本身照旧原样转发。
2. **shell 的当前工作目录**（上游 `TerminalWidget.kt:87-94` 的 `getCurrentDirectory()`、
   `TerminalAbsolutePathLinkFinder.kt:45-47` 的 `context.currentWorkingDirectory`）。
   有了它，`terminalPathLinkRanges` 的相对路径那一半才能像上游一样按 shell 的 cwd 解析
   （上游另有 `~/` 家目录档，本仓 `home` 参数已留好）。
   建议落点：同上，OSC 7（`\x1b]7;file://host/path`）或 OSC 133 的 C 序列携带 cwd ⇒ `term.cwd` 事件。

两条都**不需要新 `.cpp`**，因此不需要登记 `CMakeLists.txt`；判据建议加进 `native/terminal_test.cpp`
（现 219 行，上限 1300）。跑原生测试时按规约**读日志里的 `tests passed` 那行**，不要看 npm 退出码。
