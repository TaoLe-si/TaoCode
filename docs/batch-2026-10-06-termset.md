# 批次报告 · termset（2026-10-06）· 终端设置与 ANSI 颜色的消费侧收尾

范围：`docs/wiring-requests-2026-10-06-b10audit.md` 第 2/3 条的**消费侧**。四个保留文件
（`src/settingsModel.ts`、`native/settings_schema.hpp`、`native/settings_schema.cpp`、`src/previewSettings.ts`）
一个字没动 ⇒ 键本身与 native 校验写成可粘贴请求（`docs/wiring-requests-2026-10-06-termset.md` R-1…R-4）。
也没有动 `src/App.vue`、`src/bridge.ts`、`src/style.css`、`src/tokens.css`、`CMakeLists.txt`、
`scripts/verdict_table.py`、`docs/inventory/*`；没 commit、没 push、没跑任何丢弃工作区的 git 命令。

## 1) 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（本轮亲自打开） | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| 终端字号 | Ctrl+滚轮那道总闸接进设置 | `[x]` | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`（`IS_WHEEL_FONTCHANGE_ENABLED = false`）、getter 同文件 `:1043`；消费门 `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382` | `src/components/TerminalPanel.vue:107`（computed）→ `:355`（`terminalWheelZoomApplies(event, wheelFontZoomEnabled.value)`，出口在 `src/terminalFontSize.ts:79`） | 面板那道门改吃 `settings.wheelFontChangeEnabled`，宿主没传时缺省 **false**（= 上游同一档，不再硬编码「开着」） |
| 终端字号 | 复位与基准字号接进设置 | `[x]` | `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`（min `scale(4)`）与 `:15-17`（max `ide.editor.max.font.size` 默认 40）；基准来源 `TerminalUiSettingsManager.kt:123-132` 的 `detectFontSize()` | `src/components/TerminalPanel.vue:113`（`baseFontSize` computed，越界不采纳）→ 取数点 `:148/:149/:346/:565/:576/:747`；出口 `src/terminalFontSize.ts:71`（`resetTerminalFontSize(base)`）与 `:47`（`TERMINAL_BASE_FONT_SIZE`，值**没改**，只退为「没有设置时的那一档」） | 复位的靶子、xterm 建实例的 `fontSize`、会话字号、工具条读数与 title 的基准都来自那一格 |
| 终端字号 | 换档要重排已有窗格 | `[x]` | `TerminalUiSettingsManager.kt:123-132`（现算 ⇒ 上游改基准会立刻反映）；临时缩放语义 `TerminalFontSizeProvider.kt:16-25` | `src/components/TerminalPanel.vue:711`（`watch(baseFontSize, …)`） | 只把**没被临时缩放**的窗格跟到新档，正在缩放的保持自己的临时值 |
| 终端字号 | 设置页那两格（勾选 + 数字） | `[ ]` 未做 | `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94`；文案 `platform/ide-core/resources/messages/ApplicationBundle.properties:396` = `Change font size with Ctrl+Mouse Wheel in:` | 请求 `docs/wiring-requests-2026-10-06-termset.md` R-3（目标 `src/components/SettingsDialog.vue:918` 之后） | `SettingsDialog.vue` 不在本轮可改面 ⇒ 给逐字 old/new；不落这两行用户就没法打开那道闸 |
| ANSI 颜色 | 终端面板的 palette 第四参 | `[x]` | `platform/execution-impl/src/com/intellij/terminal/JBTerminalSchemeColorPalette.kt:23-25`（`getAttributesByColorIndex`）、`:24`（`ColoredOutputTypeRegistryImpl.getAnsiColorKey(index)`）；键表 `platform/platform-api/src/com/intellij/execution/process/ColoredOutputTypeRegistryImpl.java:160-164`（`value >= 16` 退回 `NORMAL_OUTPUT_KEY`） | `src/components/TerminalPanel.vue:322`（第四参 = `props.ansiOverrides ?? undefined`），入参形状 `:58` | 覆盖表原样递给 `terminalPalette`（`src/terminalColors.ts:104`），逐色号取值在 `:111`，坏值由 `:70-72` 的 `pickColor` 丢 ⇒ 面板里不需要转换层 |
| ANSI 颜色 | 运行控制台的 palette 第四参 | `[x]` | 同上（控制台与终端共用同一张方案表） | `src/components/RunConsole.vue:153`（浏览器支）与 `:151`（无 `document` 的 Node 支），入参 `:113` | 两个调用点都补了第四参；b10audit 说「`:143` 那条无 document 的分支不用改」，本轮**也改了**（否则 Node 侧与浏览器两张表不一致） |
| ANSI 颜色 | 覆盖表换了要重算 | `[x]` | 上游 palette 每次取色号都回方案要（同一个 `JBTerminalSchemeColorPalette.kt:23-25`）⇒ 是活的 | `src/components/TerminalPanel.vue:718`（`watch(() => props.ansiOverrides, () => applyPalette())`） | 与 `data-theme` 切换同一条应用路径，改完不必重开会话 |
| ANSI 颜色 | 覆盖表存哪（`terminalAnsiColors`）+ 16 格 UI | `[ ]` 未做（登记为 R-4） | 无法核实上游那一格的**行号**（`ColorSettingsPage` 的 ANSI 区没打开核对）；语义依据就是上面那三条已核坐标 | 请求 R-4：`src/settingsModel.ts:171/:221`、`native/settings_schema.hpp:142`、`native/settings_schema.cpp:183/:216`、`src/bridgePreview.ts:271/:276` | 建议放 **general** 档（编辑器键表是扁平标量白名单，`settings_schema.cpp:131` 的兜底会把非布尔直接判无效）；UI 的宿主页 `ColorSchemeSettingsPage.vue` 现在还是零消费方 ⇒ 先键、先链路、后格子 |
| 订正留痕 | 面板注释把上游默认值写成 `true` | `[x]` 已订正 | `EditorSettingsExternalizable.java:124` 实测 `public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;` | `src/components/TerminalPanel.vue:100-106`（注释里写明「原写『开着』、实际 false」并撤掉 `const WHEEL_FONT_ZOOM_ENABLED = true`）；判据 `tests/terminal-font-size.test.mjs` 的「上游默认档钉 false」 | 任务书点名的那句 `:89` 注释确认是错的，已按上游改 |
| 订正留痕 | 请求文档给的行号有偏 | `[-]` 不改（只登记） | `EditorOptionsPanel.kt` 实测复选框挂点在 `:216`（原文写 `:195`）；文案键在 `ApplicationBundle.properties:396`（原文写 `:395`，组名 `:395` **无法核实**）；palette 调用点改前实测 `TerminalPanel.vue:295` / `RunConsole.vue:146`（原文写 `:294` / `:145`） | 请求 R-5 | 别人的文档不替别人改，只把「原写 X、实际 Y」留痕 |
| native | `terminalBaseFontSize` 的值域校验 | `[~]` 部分 | `EditorFontsConstants.java:11-13` / `:15-17` | 请求 R-1f（`src/previewSettings.ts:43` 的数字链）+ R-1g（`native/settings_editor_keys.hpp`） | 布尔那把四处成对就够；数字那把**实际要六处**（少预览态那一处 = 浏览器存不下，少桌面那一处 = 任意数能进盘） |
| 旧存档兼容 | 新增两把键缺键补默认 | `[x]`（按既有规则） | —（本仓铁律） | `native/settings_schema.hpp`/`.cpp` 的表都是「缺键补默认」形态（R-1c/R-1d 沿同一形状），`prune_unknown` 只剪未知键 | 不按字段数量判损坏 ⇒ 不会重演「把用户锁在项目外」那类事故 |

## 2) 改动文件清单（`wc -l` 前后）

| 文件 | 前 | 后 | 改了什么 |
|---|---|---|---|
| `src/components/TerminalPanel.vue` | 776 | 825 | 入参加 `settings` / `ansiOverrides`（`:58`）；`wheelFontZoomEnabled`（`:107`）与 `baseFontSize`（`:113`）两个 computed 替掉占位常量与六处硬编码；palette 第四参（`:322`）；两条 watch（`:711/:718`）；模板 title 用 computed（`:747`）；文件头与注释留痕（`:18-25`、`:100-106`） |
| `src/components/RunConsole.vue` | 593 | 600 | 入参加 `ansiOverrides`（`:113`）；两支 palette 都传第四参（`:151/:153`）；注释说明覆盖表来源与丢弃规则 |
| `tests/terminal-font-size.test.mjs` | 76 | 145 | 7 ⇒ 10 条：改三条「钉住占位形状」的消费链锚点（理由见 §3 下方），新增三条判据（串起来的开/关两态、上游默认钉 false、基准字号来自设置） |
| `tests/terminal-colors.test.mjs` | 103 | 150 | 8 ⇒ 10 条：新增「设置档字符串键形状逐色号生效/不影响未覆盖/16 号以后不进表」与「两个 palette 调用点都交第四参」 |
| `docs/wiring-requests-2026-10-06-termset.md` | — | 333 | 新建：R-1（六处逐字 old/new）、R-2（App.vue:2272 挂载）、R-3（两格设置页行）、R-4（ANSI 键的六处 + 挂载）、R-5（行号留痕） |
| `docs/batch-2026-10-06-termset.md` | — | 本文件 | 新建 |
| `build/tsc-termset.log` | — | 临时 | vue-tsc 的取证日志（`build/` 已 gitignore），收工删 |

改完逐文件 `git diff` 自查：`git diff --stat` = 4 个文件、+187/−22，14 个 hunk 全部对应上面列出的改动，
没有顺手重排别人的代码（`src/components/TerminalPanel.vue` 的 14 个 hunk 头逐条看过）。

**既有断言的处理**（铁律「不许放松断言」）：`tests/terminal-font-size.test.mjs` 原 `:66/:70/:72` 三条锚点钉的是
`WHEEL_FONT_ZOOM_ENABLED`、`fontSize: TERMINAL_BASE_FONT_SIZE`、`resetTerminalFontSize(TERMINAL_BASE_FONT_SIZE)`
这三样**本仓占位实现**，不是上游行为：前者与 `EditorSettingsExternalizable.java:124`（`false`）直接冲突，
后两者把「基准不可配」钉死。⇒ 改成同样严格的 settings 驱动锚点（`wheelFontZoomEnabled.value` /
`baseFontSize.value` / 另加 `doesNotMatch(/const WHEEL_FONT_ZOOM_ENABLED\s*=/)`、`doesNotMatch(/fontSize: TERMINAL_BASE_FONT_SIZE/)`），
一条没删、没有把 `match` 降级成 `includes`。其余既有断言（越界保持原值、`resetTerminalFontSize()` 缺省 13、
`TERMINAL_BASE_FONT_SIZE` 仍 = 13、向后兼容的「不传覆盖表逐字节一致」）一字未动。

## 3) §5 每条自查的前后数字

| 命令 | 前 | 后 |
|---|---|---|
| `node --test tests/terminal*.test.mjs` | 80 条 / 80 绿（7 个文件，改前工作区与 HEAD 一致） | **85 条 / 85 绿 / 0 红**（+5 条判据） |
| `npx vue-tsc -b --force` | 3 错（全在别人的在途文件：`CodeEditor.vue:116`、`editorSplitLine.ts:146`、`lspNavigation.ts:20`） | 收尾复跑 **4 错，全部集中在 `src/lspNavigation.ts`**（同一批别人的文件还在动），**本批四个文件 0 错**（`grep 'TerminalPanel\|RunConsole'` 命中 0） |
| `node --test tests/module-size.test.mjs` | 绿 | **5/5 绿**（上限一个没动；`TerminalPanel.vue` 825 < 900，`RunConsole.vue` 600 < 900） |
| `node .tools/find-orphan-modules.mjs --gate` | 红 1 条（`src/editorSplitLine.ts`，别人的在途） | 收尾复跑红 **2 条**：`src/editorColumnMode.ts` + `src/editorSplitLine.ts`（都不是本批产物，本批零新建模块） |
| `node .tools/find-param-props.mjs` | 干净 | **共 0 处参数属性** |
| `node .tools/find-ts-in-mjs.mjs` | 干净 | **干净：tests/\*.mjs 全部纯 JavaScript** |
| `node .tools/find-missing-ext.mjs` | 干净 | **扫描 1313 个文件，干净** |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 绿 | **11/11 绿**（含本轮两份新文档里的全部上游坐标） |
| 相关旁路：`node --test tests/console-ansi.test.mjs tests/settings-keys-parity.test.mjs tests/run-console-clear.test.mjs` | 28/28（前两条文件）+ | **30/30 绿**（`RunConsole.vue` 改了入参/palette，`settings-keys-parity` 是 R-1 的门禁） |
| `ctest`（`npm run test:native`） | — | **没跑**：本轮没改 `native/` 任何文件（R-1c/R-1g 是请求，主代理落完要跑） |
| 全量 `npm test` | — | 按规约**不跑**（12 路并行，别人的在途红会算到本批头上） |

## 4) 反向验证记录（三步 × 三处注入）

| # | 注入的违规（带标记） | 结果 | 撤回后 |
|---|---|---|---|
| 1 | `TerminalPanel.vue` 的 `wheelFontZoomEnabled` fallback 由 `false` 改回 `true`（`// TERMSET-RVI-1`）⇒ 把上游默认档写成「开着」 | 85 条里 **1 红**：「上游默认档钉 false：设置缺省、面板 fallback、纯函数那道门三处同一个 false」 | 撤 ⇒ 85/85 绿 |
| 2 | `RunConsole.vue:153` 摘掉 `terminalPalette` 的第四参（`// TERMSET-RVI-2`）⇒ ANSI 覆盖进不了控制台 | 85 条里 **2 红**（与 #3 同批跑）：「消费链：两个 palette 调用点都把覆盖表交给第四参」+「基准字号来自设置：面板六个取数点 + 越界不采纳 + 换档跟到没被临时缩放的窗格」，83 绿 | 撤 ⇒ 85/85 绿 |
| 3 | `TerminalPanel.vue` 的 `baseFontSize` 去掉 4..40 界（`// TERMSET-RVI-3`）⇒ 任意基准值都采纳 | 同 #2（那条锚点在 #3 的测试里） | 撤 ⇒ 85/85 绿 |

收工取证（撤回注入后复跑）：`node --test tests/terminal*.test.mjs` ⇒ **85/85 绿**；
`grep -rn "TERMSET-RVI" src tests native scripts` ⇒ **0 命中**（代码里无残留标记）；
全仓只剩 `docs/batch-2026-10-06-termset.md` 自己转述那三个标记（4 处命中，就是本表的文字），
源码与测试树干净。临时文件 `build/tsc-termset*.log` 已删。
**会失败的边界用例**（设计成「一错就红」而不是摆设）：
① 主代理若把 `wheelFontChangeEnabled` 的缺省落成 `true` ⇒「上游默认档钉 false」直接红（现在键未落，
该条退而钉住请求文档里的 `wheelFontChangeEnabled: false`，落完自动升级成硬钉）；
② 设置里给越界基准（0 / 999）⇒ 面板不采纳、退回 13（锚点 `raw >= MIN_TERMINAL_FONT_SIZE && raw <= MAX_TERMINAL_FONT_SIZE`）；
③ 总闸关掉时 `-1/+1/-3/+3` 四种 `deltaY` 一次都不许改字号（`tests/terminal-font-size.test.mjs` 那条串起来的判据）；
④ 覆盖表给了 `'16': '#123456'` 也不许进表（`colorByAnsiIndex` 的 16 号以后现算，
与上游 `ColoredOutputTypeRegistryImpl.java:160-164` 的 `value >= 16` 退回默认同一口径）。

## 5) 零消费方自查结论

本轮**没有新建任何 `src/*.ts` 模块** ⇒ 不可能引入新的零消费方；`node .tools/find-orphan-modules.mjs --gate`
的「新增零生产消费方」只有一条 `src/editorSplitLine.ts`（别人的在途，本轮没打开过那个文件的写句柄）。
新加的三处消费侧输入都有人喂或写明谁喂：
- `TerminalPanel.vue` 的 `settings` / `ansiOverrides` ⇒ 生产挂载点在 `src/App.vue:2272`（R-2 给逐字片段；
  没挂载前入参 `undefined`，行为与改造前逐字相同，界面上**没有多画任何控件**）。
- `RunConsole.vue` 的 `ansiOverrides` ⇒ 同上（`src/App.vue:2229`）。
- 面板里那两个 computed 与两条 watch 都被现有渲染路径吃着（`terminalWheelZoomApplies` 在 `onWheel`、
  `baseFontSize` 在 actionContext/xterm 建实例/工具条 title/复位、`applyPalette` 在 watch 与 `data-theme` 观察器）。
纯函数侧（`terminalFontSize.ts` 的 `:71/:79/:47`、`terminalColors.ts` 的 `:81/:100/:104/:111`）本轮全部有真实调用方，
不再是「只过自己测试的死模块」。

## 6) 做不到 / 无法核实

1. **两把键本身做不到**（保留文件）：`src/settingsModel.ts:461-465/:223`、`native/settings_schema.hpp:100-101`、
   `native/settings_schema.cpp:419`、`src/previewSettings.ts:40`（数字键另加 `previewSettings.ts:43` 与
   `native/settings_editor_keys.hpp`）⇒ 只能给逐字 old/new（请求 R-1a…R-1g）。**R-1 不落，面板读到的永远是缺省档**
   （总闸关、基准 13）⇒ 用户可见效果 = 「Ctrl+滚轮不改字号」，与上游默认档一致但不是「已闭环」。
2. **App.vue 的挂载做不到**（保留文件，`appvue` 独占）：`:settings` / `:ansi-overrides` 两处 = 请求 R-2。
3. **设置页那两格做不到**（`src/components/SettingsDialog.vue` 不在本轮可改面）：请求 R-3。没有那两行，
   用户无法打开总闸 ⇒ 这条判据只能等主代理落完后才算完整。
4. **ANSI 覆盖表的存储键做不到**：本轮按任务书只请求两把键（编辑器档），ANSI 那把放 general 档要另动六处
   （`src/settingsModel.ts:171/:221`、`native/settings_schema.hpp:142`、`native/settings_schema.cpp:183/:216`、
   `src/bridgePreview.ts:271/:276`）⇒ 请求 R-4；本轮不落它，消费侧第四参照样接（拿不到就是不覆盖）。
5. **无法核实**：① 上游「Mouse control」那一组的**组名行号**（b10audit 写 `ApplicationBundle.properties:395`，
   本轮只核实到 `:396`/`:397` 两条文案键，`:395` 没打开确认）；② `ColorSettingsPage` 里 ANSI 16 色的**具体
   行号**（只核实了 palette 取值链 `JBTerminalSchemeColorPalette.kt:23-25` 与键表
   `ColoredOutputTypeRegistryImpl.java:160-164`）；③ `IS_WHEEL_FONTCHANGE_PERSISTENT`（实测
   `EditorSettingsExternalizable.java:125` = false）要不要升格为设置项——本仓缩放是会话内临时的，本轮**不落**，
   没有上游行为差异可核。
6. **真机行为没验**：本轮不启动图形界面 ⇒ 「滚轮一次改 1px」「换主题后 16 色重绘」只到纯函数 + 源码锚点这一层；
   `native/` 没改 ⇒ 没跑 ctest。
7. **收尾时全仓仍有别人的在途红**：`npx vue-tsc -b --force` 的 4 条错都在 `src/lspNavigation.ts`，
   `node .tools/find-orphan-modules.mjs --gate` 的两条新增孤儿是 `src/editorColumnMode.ts` 与
   `src/editorSplitLine.ts` ⇒ 都不是本批文件（本批四个文件 0 错、0 新孤儿），要由那两个 owner 的批次收。
   ⚠ 共享工作区是活的：本报告中「前/后」两列之间，这两条门的数字被别人动过两次（3→4 错、1→2 孤儿），
   以**收尾复跑**那一列为准。

## 7) 需要主代理接的线

全部在 `docs/wiring-requests-2026-10-06-termset.md`：R-1（两把键，六处逐字片段）→ R-1f/R-1g（数字键的两处值域）
→ R-2（`src/App.vue:2272` 传 `:settings="editorSettings"` 与 `:ansi-overrides`）→ R-3（`SettingsDialog.vue:918`
之后那两行）→ R-4（ANSI 键的六处 + `src/App.vue:2229` 的 `<RunConsole>` 挂载）。
**顺序要求**：R-1 先落（键与默认）⇒ R-2/R-3 才不空转；R-4 可独立下一批。
落完 R-1 后必跑：`node --test tests/settings-keys-parity.test.mjs`、`node --test tests/terminal*.test.mjs`
（「上游默认档钉 false」会自动从「钉请求文本」升级成「钉 `defaultEditorSettings`」）、`npm run test:native` 看 `tests passed`。

---

# 追加 · 2026-10-06 termset（第 2 切片）：copy-on-select / paste-on-middle-click 两个「假开关」

> 上一节是同一 termset 路的「字号 + ANSI 颜色消费侧」交付（已入 citation-anchors 快照，原文一字未改，仅在下面追加）。
> 本节代号仍记 termset，落在 `ex/terminal` 的设置面档位对齐。上游坐标本轮逐条 `sed -n` 开过。

## A) 结论表

| 族 | 项 | 判定 | 上游相对路径:行号（本轮亲自打开） | 本仓落点 文件:行号 | 一句话 |
|---|---|---|---|---|---|
| ex/terminal | 「Copy to clipboard on selection」旋钮 | `[x]` 本切片落模块侧 | 子类真身 `plugins/terminal/src/org/jetbrains/plugins/terminal/JBTerminalSystemSettingsProvider.java:74-81`（`copyOnSelect()` = `(isSystemSelectionSupported() \|\| getCopyOnSelection()) && Registry.is("editor.caret.update.primary.selection")`）；缺省 `plugins/terminal/src/org/jetbrains/plugins/terminal/TerminalOptionsProvider.kt:77`（`myCopyOnSelection = false`）；Linux 判定 `platform/editor-ui-api/src/com/intellij/openapi/ide/CopyPasteManager.java:83`（基类 `return false`，Linux 实现覆写为 true） | `src/terminalClipboard.ts`（`terminalCopyOnSelect(linux, copyOnSelection)`）、`src/components/TerminalPanel.vue:571`（`terminalCopyOnSelect(ON_LINUX, props.settings?.copyOnSelection ?? false)`） | 旧实现把这一档钉死成「只有 Linux」（引的是**基类** `JBTerminalSystemSettingsProviderBase.java:297-299`），而 JBTerminalPanel 实际 new 的是子类真身，那里 Windows/macOS 勾了旋钮也复制 ⇒ **勾选此前是死的**。改成 `linux \|\| 旋钮`，缺省 false ⇒ 落设置键前行为逐字不变 |
| ex/terminal | 「Paste from clipboard on middle mouse button click」旋钮 | `[x]` 本切片落模块侧 | 子类真身 `JBTerminalSystemSettingsProvider.java:84-86`（`pasteOnMiddleMouseClick()` = `getPasteOnMiddleMouseButton()`，**不是**基类 `JBTerminalSystemSettingsProviderBase.java:302-304` 的无条件 `return true`）；缺省 `TerminalOptionsProvider.kt:78`（`myPasteOnMiddleMouseButton = true`） | `src/terminalClipboard.ts`（`terminalPasteOnMiddleClick(enabled)`）、`src/components/TerminalPanel.vue:415`（`terminalPasteOnMiddleClick(props.settings?.pasteOnMiddleMouseClick ?? true)`） | 旧实现写死 `return true`（引基类那一档），取消勾选也照样粘 ⇒ 死开关。改成读旋钮值，缺省 true ⇒ 与改造前逐字相同 |
| ex/terminal | 响铃 audible bell（缺省 **true**） | `[-]` 本切片不落，仅登记 | `JBTerminalSystemSettingsProvider.java:64-66`（`audibleBell()` = `getAudibleBell()`）、缺省 `TerminalOptionsProvider.kt:76`（`mySoundBell = true`）；消费门 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/view/impl/TerminalSessionController.kt:111-113`（`is TerminalBeepEvent -> if (settings.audibleBell()) Toolkit.beep()`）、块视图门 `plugins/terminal/src/org/jetbrains/plugins/terminal/block/output/TerminalAlarmManager.kt:12-14`（`commandIsRunning && audibleBell`）、BEL 来源 `plugins/terminal/frontend/src/com/intellij/terminal/frontend/session/ghostty/GhosttyTerminalSession.kt:276-278`（`onBell()` ⇒ `TerminalBeepEvent`） | — | 本仓 xterm 完全忽略 BEL（`TerminalPanel.vue` 无 `onBell` 订阅）⇒ 缺省 on 的上游行为这里**缺失**。但发声要宿主/原生通道：native 不在本路文件面、`src/App.vue` 保留、面板无既有 notify/flash 出口（`defineEmits` 只有 `focusTerminal`）。在不放假控件的铁律下无法只改模块侧就落一个真会响的档 ⇒ 登记给下一批（见 D） |

## B) 本切片做了什么（模块侧 + 面板消费，净行数）

1. `src/terminalClipboard.ts`（218 → 236，净 **+18**，全在文件头注释的「基类 vs 真身」留痕 + 两个函数注释）：
   - `terminalCopyOnSelect(linux)` → `terminalCopyOnSelect(linux, copyOnSelection)`，体 `return linux || copyOnSelection`（真身 `JBTerminalSystemSettingsProvider.java:74-81`）。
   - `terminalPasteOnMiddleClick()`（无条件 true）→ `terminalPasteOnMiddleClick(enabled)`，体 `return enabled`（真身 `:84-86`）。
   - 文件头把「这两条是覆写值不是设置页旋钮」这句**订正**为「子类真身读 `getCopyOnSelection()`/`getPasteOnMiddleMouseButton()`，是设置页旋钮」，并留痕「旧注释引的是基类那一档」。
2. `src/components/TerminalPanel.vue`（887 → 887，净 **0**，全 in-place）：props 的 `settings` 形状加两个可选布尔（`:75`）；`:415`、`:571` 两个调用点各读旋钮值（缺省档 `pasteOnMiddleMouseClick ?? true` / `copyOnSelection ?? false`）；两条相邻注释同步订正。**没往 bridge/native/App 加任何东西**；`TerminalPanel.vue` 未登记、上限 900，改后仍 887（余量 13，未逼近）。
3. `tests/terminal-hyperlinks.test.mjs`（既有断言订正，判据）：原两条 `terminalCopyOnSelect(true)/terminalPasteOnMiddleClick()` 与两条面板源码锚点，钉的是**基类那一档**（值钉错），本轮按真身改写并**加严**：Linux 复制、非 Linux 缺省不复制、非 Linux 勾了才复制、中键旋钮关就不粘；两条 panel 锚点改指 `props.settings?.copyOnSelection ?? false` / `?? true`。一条没删、没把 `match` 降级成 `includes`。

## C) 门禁原始数字（本切片）

| 命令 | 数字 |
|---|---|
| `node --test tests/terminal*.test.mjs tests/process-*.test.mjs tests/module-size.test.mjs` | 改前基线 123（10 个 terminal/process 文件）+5（module-size）=**128 / 128 / 0**；本切片后仍 **128/128/0**（hyperlinks 文件条数不变，只改断言体） |
| `node --test tests/terminal-clipboard.test.mjs tests/terminal-hyperlinks.test.mjs` | **29 / 29 / 0**（含订正后的「子类真身」门那条） |
| `node --test tests/module-size.test.mjs` | **5 / 5 / 0**（TerminalPanel.vue 887 < 900 未登记；terminalClipboard.ts 236 < 900） |
| `node .tools/find-missing-ext.mjs` | 干净（扫描 1374 文件） |
| 隔离 tsconfig `npx tsc -p build/tsconfig.termset.json --noEmit`（files 只含 `src/terminalClipboard.ts`） | **0 错**（临时 tsconfig 收工删） |
| `node .tools/find-orphan-modules.mjs --gate` | 红 **1 条**：`src/usageViewTreeModel.ts` ⇒ **非本路文件**（本切片零新建模块，不可能引入新孤儿；孤儿来自别的路） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | 见 E：本切片引用的坐标全部可解；快照「moved」/「扑空」红点都不属本切片 |
| 全量 `npm test` / ctest | 按规约**不跑**（未改 native） |

## D) 接线请求（写进 `docs/wiring-requests-2026-10-06-termset.md` 的 R-6/R-7）

- **R-6**：把 `terminalCopyOnSelection`（bool，缺省 false）与 `terminalPasteOnMiddleMouseButton`（bool，缺省 true）两把持久化键**六处成对**落齐（`src/settingsModel.ts` 接口+缺省、`native/settings_schema.hpp` 白名单、`native/settings_schema.cpp` 默认值、`src/previewSettings.ts` 键表、`src/App.vue` 把 `editorSettings`/`terminalSettings` 透传进 `<TerminalPanel :settings=…>`）。目标出口名核对：面板已 `props.settings?.copyOnSelection ?? false`（`:571`）、`?? true`（`:415`）——宿主不传时行为与改造前逐字相同。`SettingsDialog.vue` 需加两行勾选（绑这两个真键名），文案走上游英文原句直译（本仓无 zh 包 ⇒ 措辞「无法核实」）。
- **R-7**（下一批，不阻塞本切片）：audible bell 需要①native/宿主一条 `requestTerminalBell`（或复用状态栏/通知）发声出口 + ②面板 `instance.onBell(() => if (audibleBell) 触发)` + ③`terminalAudibleBell` 缺省 true 的键。本切片**未落**任何 onBell 假订阅。

## E) 无法核实 / 未落（带具体卡点）

1. 中文措辞：`copyOnSelect` / `pasteOnMiddleMouseClick` / `audibleBell` 三条设置项的上游**中文界面文案**无法核实——参考树无本地化包，只有英文原文（`getCopyOnSelection` 等是代码标识，不是 UI 串）。UI 落格时按英文原句直译并注释。
2. `Registry.is("editor.caret.update.primary.selection")` 那半句条件：是 IDE 全局高级注册表项、不是终端设置页旋钮，本仓无对应物、无消费链 ⇒ **不建模**（不是把它当 false 硬编进门，而是根本不引入这个变量）。已如实写进 `terminalClipboard.ts` 文件头。
3. audible bell 未落：具体卡点 = 发声需要宿主/原生通道，`native/` 不在本路文件面、`src/App.vue` 保留、`TerminalPanel.vue` 的 `defineEmits` 只有 `focusTerminal` 一个出口且净余量 13 行，加一条 onBell+发声会既逼近面板上限又造出「调了但没人发声」的死效果 ⇒ 违反「不放假控件」，宁可不落，登记 R-7。
4. citation 门红点归属：`source-citations`/`anchors` 当前红，命中的是 `findrep2.md`/`menukeys.md`（`ConsoleViewImpl.kt:999999` 越界）与 `commitChecks.ts`/`ProblemsPanel.vue`/`runStartupFocus.ts`（别的 lane 在途改了被引区间）——**都不是本切片文件**；本切片新增坐标（上表 A/B 列）逐条开过参考树、区间在文件长度内。本切片**未改** `docs/inventory/**`（生成式账本、一次一路），anchors 快照随主代理装配时统一复采。
5. 真机行为未验：不启动 GUI，「非 Linux 勾了选中即复制」「取消中键粘贴」只到纯函数 + 源码锚点层；宿主值传入前的可见行为与改造前逐字相同（缺省档）。
