# 批 · 2026-10-06 b10audit —— 桶 10b 六条接线请求逐条判定（审计轮）

代号 `b10audit`。任务 = 把 `docs/wiring-requests-2026-10-06-bucket10b.md` 挂了没判的 6 条**逐条判定并交付成可粘贴形式**。
交付件：`docs/wiring-requests-2026-10-06-b10audit.md`（6 条结论 + 可粘贴 old/new + 上游坐标）。
本文件是过程留痕：打开过哪些行、原始 grep 输出、前后数字、反向验证三步。

## 1. 判定表

| 族 | 项 | 判定 | 上游相对路径:行号（本代理亲自打开过那一行） | 本仓落点 | 一句话 |
|---|---|---|---|---|---|
| 运行实例 | Run Anything 的执行上下文 cwd | `[~]` 本仓已有：接收侧签名；还差：`App.vue` 第三参、弹层 payload、**弹层那格上下文 UI** | `platform/execution-impl/src/com/intellij/execution/runAnything/` **find 命中 0** ⇒ 无法核实，不引坐标 | `src/runActions.ts:462`/`:486` 就位；`src/App.vue:2635`、`src/components/RunAnythingDialog.vue:17`/`:43` 未接 | 三处必须同批落：`src/runAnythingContext.ts` 仍是零消费方模块，`payload.cwd` 现在恒 undefined |
| 终端 | 「Ctrl+滚轮改终端字号」设置格 | `[ ]` 未做（出口名全部存在，键不存在） | `EditorSettingsExternalizable.java:124`/`:1043`/`:1047`；`JBTerminalPanel.java:382`；`EditorOptionsPanel.kt:91-94`/`:195`；`ApplicationBundle.properties:395-396` | `src/terminalFontSize.ts:79` 就位；`src/components/TerminalPanel.vue:89` 仍是占位常量 | 上游默认 **false**，本仓占位写 `true` 且注释（`:86`）称「按上游的开着」——与 `:124` 不符，落键时一并修 |
| 终端 | 「终端基准字号」设置格 | `[ ]` 未做（请求的坐标写错了，本仓按实测改写） | 原写 `TerminalFontSizeProvider.kt:16-25 detectFontSize()` —— 实际该文件 `:16` 是 `fun getFontSize(): Float`，**没有** `detectFontSize`；真源在 `TerminalUiSettingsManager.kt:123-128`（+ `:104-109`/`:130-132`）与 `UISettingsUtils.kt:21-22`、`AbstractColorsScheme.java:877` | `src/terminalFontSize.ts:47`/`:71`；消费点 `TerminalPanel.vue:120-121`/`:308`/`:318`/`:535`/`:546`/`:704` | 基准是写死的 13；文档写 `TerminalPanel.vue:81`（实际 `:89`）、`88-105`（实际 `:120-121`） |
| 终端 | ANSI 16 色逐色号自定义 | `[x]` **模块侧本轮落完**（第四参 + 判据 + 反向验证）；宿主与设置页仍缺 ⇒ 留请求 | `JBTerminalSchemeColorPalette.kt:14-15`/`:19-20`/`:23-25`；`ColoredOutputTypeRegistryImpl.java:160` | `src/terminalColors.ts:81`（类型）/`:100`（签名）/`:111`（取值） | 请求原文的 `Partial<Record<0..15, string>>` 不是合法 TS ⇒ 落成 `TerminalAnsiOverrides = Readonly<Record<number, string>>` |
| 编辑器/大文件 | 大文件模式动作替换 | `[x]` **模块侧本轮落完**（禁用表 + 门禁 + 判据）；分发层仍缺 ⇒ 留请求 | `PlatformActionsReplacer.java:22`/`:34-54`/`:37`/`:38`/`:40-41`/`:47`/`:48-53`/`:56-58`；`LfeEditorActionHandlerDisabled.java:13`/`:31-36`；`LfeEditorActionHandlerFind.java:26-32` | `src/largeFileMode.ts:44-90`（`:66`/`:72`/`:81`/`:88`） | 原请求清单**不完整且有错**：漏 `FindWordAtCaret`/`FindPrevWordAtCaret`(`:49-50`)；「Select Previous Occurrence」不存在，`:53` 是 UnselectPreviousOccurrence；引用的 `LfeEditorActionHandlerDisabled.java:13-17` 只是类声明+构造 |
| 编辑器/大文件 | 大文件「正则搜索不可用」提示 | `[-]` **不落 · 前提不成立**（不是"做不了"） | `LargeFileRegexSearchNotificationProvider.java:21`/`:42-45`；`EditorBundle.properties:155`（文案原文是「匹配长度超过 {0} Kb 找不到」）、`:91` | 模块侧不加（`src/largeFileNotice.ts` 保持 44 行） | 那条数字来自 `getPageSize()/500`，本仓无分页；且本仓大文件模式没关正则查找（`src/largeFileMode.ts:8`、`src/editorSearchExtension.ts:62` 不传 limit、`src/editorSearch.ts:127` 缺省 `Infinity`）⇒ 写出来就是编造限制 |
| 运行实例 | `RunStartParams.elevate` | `[-]` **不落 · 前提未成立**（本轮只登记是对的） | `ElevationDaemonProcessLauncher.kt:32`（"instead of process stdio…trampoline mode"）、`:71`（`trampoline = true, daemonize = true`）；整包 5 个文件本轮 ls 到 | `src/settingsModel.ts:51`（**目标文件写错**：类型不在 `src/bridge.ts`，那里只有 `:71`/`:81` 的转发） | `native/main.cpp:1104-1112`/`:1110` 只整包转给 `runs->start`，`native/run_host.hpp:35-39` 的 `Step` 无提权档；先要 daemon/管道那一层 ⇒ 独立批次 |

## 2. 特别核的三点（任务点名）

1. **模块出口名**：`grep -n "^export" src/terminalFontSize.ts` ⇒ `:37 :40 :43 :44 :47 :53 :64 :71 :79 :84 :89`
   三条被引用的出口全部存在（`resetTerminalFontSize` `:71`、`terminalWheelZoomApplies` `:79`、`TERMINAL_BASE_FONT_SIZE` `:47`），
   请求文档写的 `:71`/`:79` 行号**恰好对**；`src/terminalColors.ts` 的 `terminalPalette` 在 `:85`（改造前）/`:100`（改造后）。
   `src/runAnythingContext.ts` 的 `contextPath()` 在 `:80` 确实存在，但 src/ 下**零生产消费方**。
2. **`EditorHandle` 是否真暴露**：`src/editorTab.ts:13-29` 全文 11 个方法
   （`text`/`setDraft`/`command`/`expandAtCursor`/`hasSelection`/`setReadOnly`/`surroundWith`/`getCursor`/`getCursorCoords`/`exportStyledLines`/`selectionText`）
   ⇒ **没有**任何 heavy/大文件相关 getter。第 4、5 条都不需要它（`heavy` 就在 `src/components/CodeEditor.vue:129`，键位分发在同文件 `:853-868`）。
3. **bridge/native 成对**：`src/bridge.ts:109` 的 `Method` 联合里 `run.start|run.write|run.stop|run.instances`
   ↔ `native/main.cpp:1104`/`:1113`/`:1120`/`:1121` 四个 case 一一对上 ⇒ 现有 run.* 通道无假的那条；
   第 6 条不新增方法名，但**新增键**要成对：`src/settingsModel.ts` + `native/settings_schema.hpp:13`（`EDITOR_SETTING_KEYS[]`）
   + `native/settings_schema.cpp:419`（默认值表）+ `src/previewSettings.ts:40-41`（预览桩白名单）——少一处就是存不下的假设置。

## 3. 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 内容 |
|---|---|---|---|
| `src/terminalColors.ts` | 137 | 159 | `TerminalAnsiOverrides`（`:81`）+ `terminalPalette` 第四参（`:100/:104/:111`） |
| `src/largeFileMode.ts` | 42 | 90 | 大文件动作降级段（`:44-90`）：`:66` 表、`:72` 类型、`:81` 门禁、`:88` 布尔问法 |
| `tests/terminal-colors.test.mjs` | 77 | 103 | +3 条（逐色号生效 / 坏值坏键 / 不传时逐字节兼容） |
| `tests/large-file-mode.test.mjs` | 27 | 68 | +3 条（禁用清单八条+形状 / find-only 那一档+白名单式降级 / 表里 id 必须在本仓三张表存在） |
| `docs/wiring-requests-2026-10-06-b10audit.md` | — | 交付件 | 6 条逐条结论 + 可粘贴 old/new |
| `docs/batch-2026-10-06-b10audit.md` | — | 本文件 | 过程留痕 |

未动任何保留文件（`src/App.vue`、`src/bridge.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`CMakeLists.txt`、
`native/main.cpp`、`tests/module-size.test.mjs`、`tests/source-citations.test.mjs`）与任何 `.vue`。

## 4. §5 自查命令前后数字

| 命令 | 前（基线） | 后 |
|---|---|---|
| `npx vue-tsc -b --force` | 1 错（`src/refactorPreview.ts(207,7)`，**别人在途**，非本代理名下） | **0 错**（收工时全树 0，本代理名下 0） |
| `node --test tests/module-size.test.mjs` | 5/5 绿 | 5/5 绿（两文件仍分别 159/90 行，远低于 900） |
| `node .tools/find-param-props.mjs` | 0 处 | 0 处 |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | 干净 |
| `node .tools/find-missing-ext.mjs` | 干净（1303 文件） | 干净 |
| `node .tools/find-orphan-modules.mjs --gate` | 已登记 9 / 基线 9 · 新增 0 | 已登记 8 / 基线 8 · **新增 0**（基线在并行轮次里从 9 降到 8，非本代理改动） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 11/11 | **11/11 绿**（新文档写完后复跑） |
| 本代理域测试（6 个文件 + module-size） | 52 | **57/57 绿**（`large-file-mode` 4→7、`terminal-colors` 5→8） |

## 5. 反向验证记录（两步：注入 → 红 → 撤 → 绿）

1. `src/terminalColors.ts`：把 `attributes[index] = { foreground: pickColor(overrides?.[index], color) }`
   注回改造前的 `= { foreground: color }` ⇒ `node --test tests/terminal-colors.test.mjs` = **8 tests / 6 pass / 2 fail**
   （红的是「按色号覆盖…只改被覆盖的那一号」与「覆盖表里的坏值/坏键一律丢弃」）。
   撤掉注入 ⇒ **8/8 绿**。
2. `src/largeFileMode.ts`：删掉 `largeFileCommandGate` 的第一行守卫 `if (!heavy) return 'allowed'`
   ⇒ `node --test tests/large-file-mode.test.mjs` = **7 tests / 6 pass / 1 fail**（红的是「大文件里被禁的动作（上游禁用清单逐条）」，
   它逐条断言普通文件必须 `allowed`）。撤掉注入 ⇒ **7/7 绿**。
3. 「表里的 id 必须在本仓三张表里真实存在」那条测试在写作过程中**先红过一次**（我把 `id.replace(/[.*+?…]/g,…)` 的正则转义
   误用进 `String.includes` 的逐字比较，报 `'find\.wordAtCaret' 在本仓三张表里找不到`）⇒ 去掉转义后逐字命中
   `src/menus/editMenu.ts:81-92`/`:106`、`src/editorCommands.ts:239/:247/:249`、`src/keymapBindings.ts:110-111` 全绿。
   这是「判据真的在拦假 id」的直接证据，不是空转门禁。

## 6. 零消费方自查结论

- 本轮**没有新增文件**，只在两个已被消费的模块里加出口 ⇒ 门禁「新增 0」。
- 已登记的 8 个孤儿里与本次判定直接相关的是 `src/runAnythingContext.ts`（第 1 条的前提）与
  `src/components/ColorSchemeSettingsPage.vue`（第 3 条建议的设置页落点）——两者都**如实写进**交付件，
  没有为了"消孤儿"去自建假消费方。
- 第 5、6 条明确判「不落」，因此**没有**留下 `largeFileRegexNoticeText()` 或 `elevate` 这类没人调的死分支。

## 7. 原始 grep / 命令输出摘录（取证）

```
$ grep -n "export" src/terminalFontSize.ts
37:export const MIN_TERMINAL_FONT_SIZE = 4      40:export const MAX_TERMINAL_FONT_SIZE = 40
43:export const FONT_SIZE_STEP_UP = 1           44:export const FONT_SIZE_STEP_DOWN = -1
47:export const TERMINAL_BASE_FONT_SIZE = 13    53:export function changeTerminalFontSize(...)
64:export function terminalFontSizeForWheel(...) 71:export function resetTerminalFontSize(base: number = TERMINAL_BASE_FONT_SIZE): number {
79:export function terminalWheelZoomApplies(event: { ctrlKey?: boolean; metaKey?: boolean }, wheelEnabled: boolean): boolean {
84:export function terminalFontSizeReason       89:export function terminalFontSizeTitle

$ grep -n "terminal\|wheel\|Wheel" src/settingsModel.ts        → 0 命中（两把键不存在）
$ grep -n "WHEEL_FONT_ZOOM_ENABLED|baseFontSize: TERMINAL_BASE_FONT_SIZE" src/components/TerminalPanel.vue
89:const WHEEL_FONT_ZOOM_ENABLED = true
121:    baseFontSize: TERMINAL_BASE_FONT_SIZE,
326:  if (!terminalWheelZoomApplies(event, WHEEL_FONT_ZOOM_ENABLED)) return

$ grep -rn "contextPath|allRunAnythingContexts|resolveSelectedContext|CONTEXT_POPUP_TITLE" src --include=*.ts --include=*.vue
（只命中 src/runActions.ts:483 的注释 + src/runAnythingContext.ts 自身）⇒ 零生产消费方

$ grep -rn "elevat" src native tests -i                        → 只有 CSS 变量 --elevated（无运行期消费）
$ node .tools/find-orphan-modules.mjs（本轮）
── src/agent.ts  ── src/components/ColorSchemeSettingsPage.vue  ── src/dragAndDropTargets.ts
── src/generalSettingsLocal.ts  ── src/ideShellCreateTarget.ts  ── src/jarRun.ts
── src/runAnythingContext.ts  ── src/scratchHistory.ts   合法例外：── src/main.ts
门禁：已登记孤儿 8 / 基线 8 · 新增 0 · 本轮清掉 0
```

上游侧取证（每条都 `sed`/`cat -n` 打开过那一行）：

```
EditorSettingsExternalizable.java:124   public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;
EditorSettingsExternalizable.java:1043  public boolean isWheelFontChangeEnabled() {
JBTerminalPanel.java:382                if (EditorSettingsExternalizable.getInstance().isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)) {
TerminalUiSettingsManager.kt:123-128    private fun detectFontSize(): Float { … UISettingsUtils.getInstance().scaledConsoleFontSize }
UISettingsUtils.kt:21-22                val scaledConsoleFontSize: Float get() = scaleFontSize(…globalScheme.consoleFontSize2D, currentIdeScale)
JBTerminalSchemeColorPalette.kt:23-25   override fun getAttributesByColorIndex(index: Int) = … getAnsiColorKey(index)
PlatformActionsReplacer.java:37-38/47-53 禁 8 条 + 换 Find（:40-41 换 FindNext/FindPrevious）
LfeEditorActionHandlerDisabled.java:31-36 isEnabledInLfe(…) { return false }
LargeFileRegexSearchNotificationProvider.java:42-45 panel.text(EditorBundle.message("message.warning.about.regex.search.limitations", … getPageSize() / 500))
EditorBundle.properties:155             message.warning.about.regex.search.limitations=Regex search can''t find matches with length longer then {0} Kb
ElevationDaemonProcessLauncher.kt:32    注释「instead of process stdio, and launch it in a trampoline mode」
find . -path "*execution/runAnything*"  命中 0（原请求的这条「find 无命中」断言复核成立）
```

## 8. 并行轮次留痕（判定复核）

收工前 `git log` 显示别的代理提交了 `11a736e`（"…8 条保留文件接线"），并把本代理这四个已改文件**扫进了那次提交**
（`git diff HEAD -- src/… tests/…` 对这四个文件已无差异，内容仍在）。因此对本审计结论做了一次**重跑复核**：

- `src/App.vue:2635` 仍是 `runExternalTool(payload.command, payload.command)`（没传第三参）⇒ 第 1 条判定不变；
- `src/components/RunAnythingDialog.vue:17/:43` 仍是 `{ command: string }` ⇒ 不变；
- `src/settingsModel.ts` 仍无 `wheelFontChangeEnabled`/`terminalBaseFontSize`/ANSI 键 ⇒ 第 2、3 条判定不变；
- `src/components/TerminalPanel.vue:89` 占位常量仍在 ⇒ 不变。

⇒ 6 条判定在提交后仍然成立，没有"其实早做过"的误判。

## 9. 做不到 / 无法核实

1. Run Anything 那一档执行上下文的上游实现：**无法核实**（本地树 `find . -path "*execution/runAnything*"` 命中 0），
   所以第 1 条只按本仓架构给落点，不给上游坐标。
2. 终端「基准字号」的确切出厂数字：**无法核实**。上游链条是
   `TerminalUiSettingsManager.kt:123-128` → `UISettingsUtils.kt:21-22` → 配色方案的 `consoleFontSize2D`
   （`AbstractColorsScheme.java:877`），出厂值取决于当前方案（`AbstractColorsScheme.java:623` 那半说明它缺省跟 editorFontSize），
   本地树里没有可直接引用的"13"字面量 ⇒ 交付件按本仓内置 13 落，并在注释里写明「本仓架构映射，不是上游那一格的原样」。
3. 提权运行（第 6 条）**做不到**的原因具体卡在：`native/run_host.cpp` 的输出通道是继承的标准管道
   （`native/main.cpp:1104-1112` 只调 `runs->start(params, …)`，`native/run_host.hpp:84` 的 `start` 返回 `{instance, label, parallel}`），
   提权进程拿不到同一根管道；要先设计 daemon/命名管道层并新增方法名（`src/bridge.ts:109` 的 `Method` + `native/main.cpp` 分派成对），
   且 `CMakeLists.txt` 是保留文件（新 `.cpp` 只能交请求）⇒ 属独立批次，本审计轮不启动。
4. 所有 `.vue` 与保留文件的挂载**只能交请求**（本轮可改面只有该域 `src/*.ts` 与 `tests/*.mjs`），
   故第 2、3、4 条的宿主侧保持"缺"，片段已写到可直接粘贴。

## 10. 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-b10audit.md`，按可粘贴顺序列了 7 条；其中第 5、6 条建议**撤掉/改判**（理由与证据在对应小节），
第 1 条要先落弹层那格上下文 UI 才不至于接出一条恒 undefined 的假通道。
