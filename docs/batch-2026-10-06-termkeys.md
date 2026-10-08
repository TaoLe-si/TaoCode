# batch-2026-10-06 · termkeys（终端字号两把键 + 设置页两行）

来源请求：`docs/wiring-requests-2026-10-06-termset.md` 的 **R-1**（六处成对）与 **R-3**（设置页两行）。
上游真源 = `D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下表每一行本轮**亲自打开过**，
未上网、未像素比对、未沿用别人给的判词）。本轮代号 termkeys。

## 0) 一句话结论

两把键 `wheelFontChangeEnabled`（缺省 **false**）与 `terminalBaseFontSize`（缺省 **13**）在**六个落点全部成对**，
缺省值三处同一个数；设置页「编辑器 › 常规」多了勾选一行 + `min=4 max=40` 数字行（绑的是 `editor` 草稿的真键名）；
门禁全绿（含 native ctest `100% tests passed, 0 tests failed out of 37`）；反向验证（只落四处）确实红 3 条。
**唯一没动的**是宿主挂载那一行（`src/App.vue:2273`）⇒ 见 §7 的可粘贴 old/new；不落它，两把键存得进、
但面板拿不到（缺省档 = 总闸关、基准 13，行为与改造前逐字相同）。

## 1) 判词表

| 族 | 项 | 判定 | 上游相对路径:行号（本轮实测） | 本仓落点 文件:行号 | 一句话说明 |
|---|---|---|---|---|---|
| R-1 键表 | `EditorSettings` 接口两把 | `[x]` | `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`（= `    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`）、getter `:1043`、setter `:1047-1051` | `src/settingsModel.ts:485` / `:497`（注释块 `:465-497`） | 接口尾部加 `wheelFontChangeEnabled: boolean` 与 `terminalBaseFontSize: number`，注释写满上游坐标与本仓消费点 |
| R-1 缺省 | `defaultEditorSettings` | `[x]` | 同上 `:124`（false）；基准 13 = 本仓 `src/terminalFontSize.ts:47` | `src/settingsModel.ts:223` 尾部 `… wheelFontChangeEnabled: false, terminalBaseFontSize: 13 }` | 缺省档 **false / 13**，不是请求里被订正前的「开着」 |
| R-1c 白名单 | `EDITOR_SETTING_KEYS[]` | `[x]` | 门：`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382`（`isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)`；`:383` 新字号、`:384` 界内才写、**`:387` `return`**） | `native/settings_schema.hpp:117`（注释 `:101-116`） | 漏这里 = `validate_editor_patch` 的 `known_keys` 第一句就拒整次 `settings.update`，且 `prune_unknown` 会把值从盘上剪掉 |
| R-1d 默认值 | `editor_defaults_impl()` | `[x]` | 同上 `:124`；界 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`（`JBUIScale.scale(4)`）/ `:15-17`（`ide.editor.max.font.size` 默认 40） | `native/settings_schema.cpp:419` | `{"wheelFontChangeEnabled", false}, {"terminalBaseFontSize", 13}`；旧存档补默认走的是 `native/project_settings_state.cpp:47-49` 的**逐键补洞**循环（本轮打开确认：先 `prune_unknown` 再 `validate_editor_patch` 再按 defaults 补缺键 ⇒ **不按字段数量判损坏**，用户不会被锁在项目外） |
| R-1e 预览白名单 | `previewSettings.ts` 键表 | `[x]` | 同 `EditorSettingsExternalizable.java:124` / `EditorFontsConstants.java:11-17` | `src/previewSettings.ts:47`（注释 `:45-46`） | 浏览器预览态那一道关卡必须认这两把，否则整次 `settings.update` 被拒 |
| R-1f 预览值域 | 数字键分支 | `[x]` | `EditorFontsConstants.java:11-13` / `:15-17`；界与本仓 `src/terminalFontSize.ts:37/:40` 同源 | `src/previewSettings.ts:53`（import 在 `:14`） | `terminalBaseFontSize` 有自己的 `Number.isInteger && 4..40` 分支；漏了它就掉进 `:82` 末尾的 `typeof value !== 'boolean'` 兜底 ⇒ 预览能勾、永远存不下。`wheelFontChangeEnabled` 是布尔，**故意不加分支**（走布尔兜底） |
| R-1g 桌面值域 | `validate_editor_added_key` | `[x]` | `EditorFontsConstants.java:11-13` / `:15-17`，与本仓 `native/settings_schema.cpp:47-51` 的 `fontSize` 同一对（本轮打开：`:50` `value < 4 \|\| value > 40`、`:51` `fontSize must be an integer from 4 through 40.`） | `native/settings_editor_keys.hpp:70-74`（注释 `:63-69`） | 越界的基准字号在桌面态就被拒；面板 `src/components/TerminalPanel.vue:121` 自己也会挡 ⇒ 两侧都挡，手改 `projects.json` 也开不出 xterm 不接受的字号 |
| R-3a 勾选行 | 总闸那一格 | `[x]` | 控件定义 `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94`（`enableWheelFontChange`）、挂点同文件 **`:216`**（`chkEnableWheelFontSizeChange = checkBox(enableWheelFontChange)`）、组 `:214` 用 `group.advanced.mouse.usages` = `platform/ide-core/resources/messages/ApplicationBundle.properties:395` Mouse Control、文案 `ApplicationBundle.properties:396` = `Change font size with Ctrl+Mouse Wheel in:`（macOS 变体 `:397` = Command） | `src/components/SettingsDialog.vue:736`（`v-model="editor.wheelFontChangeEnabled" type="checkbox"`） | 文案是英文原句直译（中文包不在本地树 ⇒ 注释里留了原句）；**没有**借用 `aria-describedby="editor-diagnostics-hint"`，新起 `editor-terminal-font-hint` |
| R-3b 数字行 | 基准字号那一格 | `[x]` | 界 = `EditorFontsConstants.java:11-13` / `:15-17`；上游**没有这一格的原样**（那档住在配色方案的 consoleFontSize：`platform/execution-impl/src/com/intellij/terminal/TerminalUiSettingsManager.kt:123-128` 的 `detectFontSize()`、`:130-132` 的 `resetFontSize()` ⇒ 现算、不落设置） | `src/components/SettingsDialog.vue:736`（`v-model.number="editor.terminalBaseFontSize" type="number" min="4" max="40" step="1"`） | 本仓没有可编辑配色方案 ⇒ 落成一格显式设置（注释已写明「本仓架构映射，不是上游原样」）；`min/max` 与 R-1f/R-1g 同一套数 |
| R-2 宿主挂载 | `:settings="editorSettings"` | `[ ]` **未做（保留文件，`src/App.vue` 不归本轮）** | `JBTerminalPanel.java:382` 那道门的前半个条件要靠它才有人喂 | `src/App.vue:2273`（现状：`<TerminalPanel ref="terminalPanelRef" :active="…" @focus-terminal="showOutput('terminal')" />`） | 交主代理粘贴（§7）。传上前行为不变：面板 `src/components/TerminalPanel.vue:115` 是 `props.settings?.wheelFontChangeEnabled ?? false`、`:121-122` 越界/缺省都退回 `TERMINAL_BASE_FONT_SIZE` 13 |
| R-4 ANSI 覆盖供给侧 | 第三个键 | `[-]` **本轮不落（请求自己写明「建议下一批；不落也不影响本批的绿」）** | `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java` 不涉及；上游侧 `JBTerminalSchemeColorPalette.kt` 本轮**未打开核实** | — | 因此 §7 的 new 行**不带** `:ansi-overrides`，避免留一条永远为空的假链路（请求 R-2 的同一口径） |
| 假控件禁令 | 两行是否有后端 | `[x]` | — | 判据 `tests/terminal-font-size.test.mjs:157-186` | 键先落齐（六处），界面才加；判据同时钉「接口里有同名键」⇒ 有格子必有后端 |

## 2) 改动文件清单（行数用 `tests/module-size.test.mjs` 自己的度量口径 `split('\n').length`）

| 文件 | 前 | 后 | 上限 | 说明 |
|---|---|---|---|---|
| `src/settingsModel.ts` | 466 | 499 | 900 | 接口两把 + 缺省表两处 |
| `native/settings_schema.hpp` | 187 | 204 | 1100 | 键表两处 + 逐条上游坐标注释（注释集中在这里，见下条的原因） |
| `native/settings_schema.cpp` | **1100** | **1100** | **1100** | ⚠ 改前就**贴着上限**（余量 0）⇒ 两个默认值**同行追加**、出处写成行尾 `//` 注释（`C1` 行注释，不含裸 `*/`），行数一字未增 |
| `native/settings_editor_keys.hpp` | 81 | 93 | 1100 | `terminalBaseFontSize` 的 4..40 分支 |
| `src/previewSettings.ts` | 76 | 86 | 900 | 键表 + 值域分支 + 一条 `.ts` 值 import（带扩展名） |
| `src/components/SettingsDialog.vue` | **1182** | **1182** | **1182** | ⚠ 同样**贴着已登记上限**（余量 0）⇒ 两行 + 提示 `<p>` + 出处注释全部挂在既有那行（`:736`，原 `<EditorSavePassesFields :settings="editor" :busy="busy" />`），一字未增行；未新开页键、未塞进 `'Console'` 页 |
| `tests/terminal-font-size.test.mjs` | 146 | 241 | 900 | 新增两条判据（设置页两行 / 六处成对 + 缺省值 + 预览态实跑校验） |

未改（且明确不许我改）：`src/App.vue`、`src/bridge.ts`、`src/bridgePreview.ts`、`tests/module-size.test.mjs`、
`tests/source-citations.test.mjs`、`tests/source-citation-anchors.test.mjs`、`CMakeLists.txt`、`scripts/*`、`docs/inventory/*`、任何 `native/*_test.cpp`。
`src/components/TerminalPanel.vue` / `RunConsole.vue` / `src/terminalFontSize.ts` / `src/terminalColors.ts` 一字未动（消费侧上一批已落）。

## 3) §5 自查命令的前后数字（原始输出摘录）

| 命令 | 改前（基线） | 改后 |
|---|---|---|
| `node --test tests/settings-keys-parity.test.mjs tests/terminal-font-size.test.mjs tests/terminal-colors.test.mjs tests/console-ansi.test.mjs tests/run-console-clear.test.mjs` | `tests 50 / pass 50 / fail 0` | `tests 52 / pass 52 / fail 0`（+2 = 本批两条判据） |
| `npx vue-tsc -b --force` | 未单独跑（进入本批时工作区已含上一批 termset 的在途改动） | **0 错**（无输出、`EXIT=0`） |
| `node --test tests/module-size.test.mjs` | `tests 5 / pass 5 / fail 0` | `tests 5 / pass 5 / fail 0`（两个贴线文件行数未增 ⇒ 没抬任何上限、没登记豁免） |
| `node .tools/find-orphan-modules.mjs --gate` | — | 「门禁绿：没有基线之外的新增零消费方模块。」（`已接上（可以更新基线）：src/jarRun.ts`、`src/runAnythingContext.ts` 是别人的线，与本批无关） |
| `node .tools/find-param-props.mjs` | — | `共 0 处参数属性` |
| `node .tools/find-ts-in-mjs.mjs` | — | `干净：tests/*.mjs 全部是纯 JavaScript。` |
| `node .tools/find-missing-ext.mjs` | — | `扫描 1320 个文件（src + tests）… 干净` |
| `vcvars64` + 原生构建 + ctest（`cmake --build build` → `ctest --test-dir build`） | — | 第一次 `FAILED … fatal error C1083 … Permission denied`（共享 `build/` 里 `.obj` 被并发构建占住，**不是**本批的编译错），重跑后：`100% tests passed, 0 tests failed out of 37`、`Total Test time (real) = 96.32 sec`（按规约**不信退出码**，看的是 `tests passed` 那行） |
| `node --test tests/source-citations.test.mjs tests/source-citation-anchors.test.mjs` | — | `tests 11 / pass 10 / fail 1`。关键那条「仓里每一条带路径的上游引用都指得到（参考树在时）」= **绿**（跑了两遍，含写完这份报告之后 ⇒ 本批新写的每一条 `路径:行号` 都真指得到）。**唯一那条红不是本批的**：`已入快照的每条引用，被引区间内容必须仍与快照一致`，第一次跑报两条、第二次跑只剩一条，全部落在 `docs/wiring-requests-2026-10-06-fix-macros.md`（`platform/lang-impl/resources/intellij.platform.lang.impl.xml|1058-1062`；另一条 `ClipboardMacro.java|15-15` 在两次跑之间被那一路自己修好了），而 `git status` 显示那个文件正被另一路改动 ⇒ 留给主代理找 macros 那一路核对，本批未碰它的文件 |

## 4) 反向验证记录（三步数字）

1. **注入**：把两把键从**两处**成对表里撤掉 ⇒ 只剩四处（接口 + 前端缺省 + native 默认值 + 桌面值域分支）：
   `native/settings_schema.hpp:117` 的 `"wheelFontChangeEnabled", "terminalBaseFontSize",` 与
   `src/previewSettings.ts:47` 的那一行都换成带 `TERMSET-INJECT-MARKER` 的注释行。
2. **确认变红**：`node --test tests/settings-keys-parity.test.mjs tests/terminal-font-size.test.mjs` ⇒
   `tests 17 / pass 14 / fail 3`，三条红分别是
   `✖ defaultEditorSettings 的每个键都在 native 编辑器键白名单里`（`actual: ['wheelFontChangeEnabled','terminalBaseFontSize']`）、
   `✖ 预览态的 settings.update 编辑器档白名单与 native 一致`（`actual: ['wheelFontChangeEnabled']`）、
   `✖ 六处成对 + 缺省值…`（`expected: /"wheelFontChangeEnabled"/`）⇒ 这道门真的有牙。
3. **撤后复绿**：两处逐字补回 ⇒ 同一命令 `tests 17 / pass 17 / fail 0`；
   全量五文件 `tests 52 / pass 52 / fail 0`。
4. **标记无残留**：`grep -rn "TERMSET-INJECT" src native tests docs build .tools | wc -l` ⇒ **0**。
5. 顺手钉了一条「缺省落成 true 会直接红」的验证口径（未实际注入）：`tests/terminal-font-size.test.mjs` 的
   「上游默认档钉 false」那条现在走的是 `landed` 分支 ⇒ `defaultEditorSettings.wheelFontChangeEnabled` 被硬钉 `false`
   （上一批它只能钉「接线请求文本」）。

## 5) 零消费方自查

- 本批没有新增任何 `.ts`/`.vue`/`.cpp`/`.hpp` 文件 ⇒ 没有新孤儿可登记。
- 新增的两把键**都有生产消费链路**（不是只过自己测试的死键）：
  `wheelFontChangeEnabled` → `src/components/TerminalPanel.vue:115` → `src/terminalFontSize.ts:79` → 面板 wheel 监听；
  `terminalBaseFontSize` → `src/components/TerminalPanel.vue:121-122`（xterm 建实例、复位、换档 watch 六处取数点）。
- 界面侧反向也齐：设置页那两行 ↔ 接口同名键（判据 `tests/terminal-font-size.test.mjs` 里
  `assert.match(model, /wheelFontChangeEnabled: boolean/)` 等两条）。
- 唯一「暂时悬着」的是宿主那一处传参（`src/App.vue:2273`）⇒ 保留文件，已按 §7 交线；
  不传时两把键仍走缺省档（关 / 13），行为与改造前逐字相同，不会出现半接的怪状态。

## 6) 做不到 / 无法核实

1. **设置页那两行拿不到 SSR 判据**（只有源码锚点）：`tests/vue-sfc-loader.mjs` 渲染 `SettingsDialog.vue` 时
   在模块求值期撞循环依赖炸栈 ——
   `RangeError: Maximum call stack size exceeded (while loading D:\TaoCode\src\fileChooserModel.ts) (while loading D:\TaoCode\src\fileChooserDescriptor.ts) (while loading … 反复)`。
   既有 SSR 判据（`tests/reference-panel-host.test.mjs` 等）渲染的都是小包图组件，`SettingsDialog` 这条链没人在 SSR 下跑过。
   ⇒ 改成把判据钉在**常规页切片的真实属性与 v-model 键名**上：页锚点（`v-show="section === 'editor'"` + `data-page="editor"`）、
   `v-model="editor.wheelFontChangeEnabled" type="checkbox"`、
   `v-model.number="editor.terminalBaseFontSize" type="number" min="4" max="40" step="1"`、
   `aria-describedby="editor-terminal-font-hint"` **恰好 2 次** + `id="editor-terminal-font-hint"` **恰好 1 次**、
   并且 `assert.doesNotMatch(page, /editor-diagnostics-hint/)`（不许蹭诊断那条提示）。
   另外直接**调用**了 `previewSettingsError(...)`（不是查字符串）：`false/13/4/40` 放行，
   `3/41/0/-1/13.5/'13'/null` 全拒 ⇒ 值域是真的在跑。
   要 SSR 的话，得由主代理决定给 `vue-sfc-loader.mjs` 补环依赖处理（不是本批文件面）。
2. **native 侧没有新增用例**：`native/*_test.cpp` 不在本轮许可文件面里（且新 `.cpp` 也不许自己写进 `CMakeLists.txt`）。
   `grep -rn "EDITOR_SETTING_KEYS|editor_defaults_impl|terminalBaseFontSize" native/*_test.cpp` ⇒ **0 命中**，
   所以本批没有撞任何既有 native 计数断言（ctest 37/37 绿）。
   想补的那条是：`validate_editor_patch({"terminalBaseFontSize": 41})` 必须 `INVALID_SETTINGS`、`{"terminalBaseFontSize": 4}`/`40` 必须过、
   `{"wheelFontChangeEnabled": "yes"}` 必须被那条布尔兜底拒。
3. **请求 R-3 的两个坐标自相矛盾**（本批按上游宿主取舍，留痕）：R-3 标题写「编辑器 › 常规」页，
   但 3a 给的锚点 `:918`（`settings.showDiagnostics`）实测在 `section === 'Errors'`（编辑器 › 检查）那一段
   （`SettingsDialog.vue:914-921`）。两页绑的还不是同一个对象：常规页绑 `editor` 草稿（`ref<EditorSettings>({ ...props.settings })`，
   走 `applyEditor()` → `emit('save', { ...editor.value })`，还有「恢复默认」），Errors 页直接改 `props.settings`。
   ⇒ 两行都放在**编辑器 › 常规**（`EditorOptionsPanel.kt` 的宿主页，也是 Mouse control 组所在），
   并按该页既有写法绑 `editor.*`；**没有**按请求逐字的 `settings.*`（那会把格子放错页、且绕过草稿）。
4. **上游 `JBUIScale.scale(4)` 的 UI 缩放**：本仓没有 UI 缩放等价物 ⇒ 界直接取未缩放的 4/40（与本仓
   `src/terminalFontSize.ts:37/:40`、`src/editorFontSize.ts` 既有口径一致），**不是**上游那台的缩放后值。
5. **`IS_WHEEL_FONTCHANGE_PERSISTENT` 不落**（上游 `EditorSettingsExternalizable.java:125`）：
   它管「滚轮缩放要不要写回设置」，本仓缩放是会话内临时的
   （`platform/execution-impl/src/com/intellij/terminal/TerminalFontSizeProvider.kt:16-18`
   = `Sets temporary font size without changing the size in the settings. Useful for temporary Zoom feature.`）⇒ 没有执行体，落它就是假键。
6. **`ApplicationBundle.properties:397` 的 macOS 变体、`:398` 的 `.hint`、`:399-400` 的两条 radio（Active editor / All editors）**
   本轮**没有**对应界面：本仓只有一个终端消费者，没有「当前编辑器 / 全部编辑器」那个作用域选择器 ⇒ 不编。

## 7) 需要主代理接的线（可直接粘贴；本轮唯一一处宿主改动）

**文件 `src/App.vue`，第 2273 行**（行号会漂；锚点字符串 = `class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef"`。
请求 R-2 写的 `:2272` 是改前另一版本，本轮实测 `:2273`；`git diff` 请用 `git show 200232e -- src/App.vue` 之外的行号口径重数）。

old（逐字，整行，行首 10 个空格）：

```
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" @focus-terminal="showOutput('terminal')" /></div>
```

new（逐字，只多 `:settings="editorSettings"` 一段；**不带** `:ansi-overrides`，因为 R-4 本轮不落 ⇒ 留一条永远为空的绑定就是假链路）：

```
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" :settings="editorSettings" @focus-terminal="showOutput('terminal')" /></div>
```

依据与注意：
- `editorSettings` 是 App.vue 里那本编辑器账（本轮实测 `src/App.vue:481` 的 `const editorSettings = ref<EditorSettings>({ ...defaultEditorSettings })`）；
  保存路径本轮实测在 `src/App.vue:668`（请求写的 `:676` 已漂）：
  `editorSettings.value = await request<EditorSettings>('settings.update', { settings: { ...editorSettings.value, ...patch } })`
  ⇒ 发的是**整本账**，所以 §1 那六处成对缺一个就会让每一次保存整条被拒（`known_keys` + `prune_unknown`）。
- 面板入参形状在 `src/components/TerminalPanel.vue:52-65`（`settings?: { wheelFontChangeEnabled?: boolean; terminalBaseFontSize?: number }`），
  取数在 `:115`（总闸，缺省 false）与 `:121-122`（基准，越界/缺省退回 13）⇒ 传与不传都不会抛错。
- **`RunConsole.vue` 不需要这一半**：请求 §0 说「两个组件都新声明了 `settings?: {…}`」，实测不成立 ——
  `src/components/RunConsole.vue:101` 的 `defineProps` 里只有 `ansiOverrides?: Record<string, string> | null`（`:113`），
  文件里 `props.settings` **零命中** ⇒ 它没有字号入参；等 R-4 落键时再给 `:2230` 那行加 `:ansi-overrides`。
- 若主代理顺手，把 `src/App.vue` 那行 `<RunConsole …>`（`:2230`）留到 R-4 一起动即可，本批不需要。

## 8) 留痕：订正过的转述（原写 X ⇒ 实际 Y，均本轮亲自打开确认）

1. `JBTerminalPanel.java` 的 `return`：**原写 `:386`** ⇒ 实际 `:387`（`:386` 是界内那次赋值的收尾 `}`；`:384` 是 `newFontSize >= getMinEditorFontSize() && <= getMaxEditorFontSize()`）。
2. `ApplicationBundle.properties:395` 的组名：**请求 R-5 第 3 条写「无法核实（没打开确认）」** ⇒ 本轮打开核实到
   `:395` = `group.advanced.mouse.usages=Mouse Control`、`:396` = 那条文案、`:397` = macOS 变体、`:398` = `.hint`。
   `EditorOptionsPanel.kt:214` 用的正是 `message("group.advanced.mouse.usages")` ⇒ 组名与挂点两侧对得上。
3. `EditorOptionsPanel.kt`：**b10audit 原写 `:195`** ⇒ 实测定义 `:91-94`、复选框挂点 `:216`（`:195` 无相关内容，与请求 R-5 第 2 条同结论）。
4. 面板消费点行号：**原写 `:107` / `:113`** ⇒ 实测 `wheelFontZoomEnabled` 在 `:115`、`baseFontSize` 在 `:121-122`
   （`:107/:113` 落在那段的注释正文里）。本批注释一律写实测行号。
5. `src/components/TerminalPanel.vue` 的 palette 调用点与 `RunConsole.vue`：请求 R-5 第 4 条说改后是 `:322` 与 `:151/:153` ⇒ 本轮实测
   `RunConsole.vue:151` 与 `:153` 两支确实都在（且是**唯一**的 `terminalPalette` 调用），一致。
6. `docs/wiring-requests-2026-10-06-termset.md` 的 R-3 锚点矛盾（`:918` 在检查页 vs 标题的「编辑器 › 常规」）⇒ 见 §6 第 3 条。
7. 本轮**没有**改 `docs/wiring-requests-2026-10-06-termset.md`（不是本批文件面），以上订正只写在这份报告里。

## 9) git 纪律说明

本批未执行 `commit` / `push` / `checkout` / `reset` / `stash` / `clean`（只用了 `git status` / `git diff` / `git log` / `git show` 这些只读命令）。
⚠ 期间主代理在 **12:33** 落了一个检查点提交 `200232e`（`feat(parity): 多域收工批量 …`），把当时在途的工作区改动（含本批七个文件）扫进了 HEAD
⇒ 现在 `git status --porcelain -- <本批七文件>` 为空、`git diff` 看不到本批内容；核对请用
`git show HEAD:<file>`（已验证六个落点都在 HEAD 里：`settingsModel.ts` 3 处、`settings_schema.hpp` 3 处、`settings_schema.cpp` 1 处、
`settings_editor_keys.hpp` 4 处、`previewSettings.ts` 2 处、`SettingsDialog.vue` 1 处、`tests/terminal-font-size.test.mjs` 31 处）。
临时文件（SSR 探针、原生构建 `.bat` 与两份日志）都在 `build/` 里，收工已删净：`ls build/ | grep -i termset | wc -l` ⇒ 0。
