# 终端设置与 ANSI 颜色的**消费侧**接线请求（2026-10-06 · termset）

对象：`docs/wiring-requests-2026-10-06-b10audit.md` 的第 2 条（终端字号两把键）与第 3 条（ANSI 16 色逐色号覆盖）。
本轮（代号 termset）**只做了消费侧**（`src/components/TerminalPanel.vue`、`src/components/RunConsole.vue` 与
`tests/terminal-font-size.test.mjs`、`tests/terminal-colors.test.mjs`）。下面每一条都要动的都是保留文件
（`src/settingsModel.ts`、`native/settings_schema.hpp`、`native/settings_schema.cpp`、`src/previewSettings.ts`、
`native/settings_editor_keys.hpp`、`src/App.vue`、`src/components/SettingsDialog.vue`、`src/bridgePreview.ts`）
⇒ **逐字 old/new 已经备好，可直接粘贴**。上游坐标全部本轮亲自打开过那一行。

## 0) 本轮已经落地的消费侧（给主代理对照，不用再改）

| 出口 | 消费点（本仓，本轮实测行号） |
|---|---|
| `src/terminalFontSize.ts:71` `resetTerminalFontSize(base)` | `src/components/TerminalPanel.vue:346` `setFontSize(pane, resetTerminalFontSize(baseFontSize.value))` |
| `src/terminalFontSize.ts:79` `terminalWheelZoomApplies(event, wheelEnabled)` | `src/components/TerminalPanel.vue:355`（总闸来自 `:107` 的 `wheelFontZoomEnabled` computed） |
| `src/terminalFontSize.ts:47` `TERMINAL_BASE_FONT_SIZE`（现在只是「没有设置时的那一档」） | `src/components/TerminalPanel.vue:113` 的 `baseFontSize` computed 的 fallback；取数点 `:148/:149/:346/:565/:576/:747` |
| `src/terminalColors.ts:104` 第四参 `overrides?: TerminalAnsiOverrides`（`:81` 类型、`:111` 取值） | 调用点 1 `src/components/TerminalPanel.vue:322`；调用点 2 `src/components/RunConsole.vue:151/:153`（两支都传） |

入参形状（两个组件都新声明了）：`src/components/TerminalPanel.vue:58` 与 `src/components/RunConsole.vue:113`
⇒ `settings?: { wheelFontChangeEnabled?: boolean; terminalBaseFontSize?: number }` / `ansiOverrides?: Record<string, string> | null`。
**宿主还没传这三样**（见 R-2、R-4），传上前行为与改造前逐字相同（缺省 = 总闸关、基准 13、无覆盖）。

⚠ 本轮**订正**了一处错误转述并留痕：`TerminalPanel.vue` 旧注释写「先按上游的『开着』处理」
（占位常量 `WHEEL_FONT_ZOOM_ENABLED = true`），实际上游
`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124` 是
`    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter 同文件 `:1043`、setter `:1047-1051`）。
⇒ 面板 fallback 与请求里的缺省都按 **false**（判据 `tests/terminal-font-size.test.mjs` 的
「上游默认档钉 false」那条，R-1 落完后会自动变成硬钉）。

---

## R-1）两把编辑器设置键：**六处**成对（少一处整次 `settings.update` 会被拒 / 存不进 / 预览态红）

布尔那把 `wheelFontChangeEnabled` 只要四处（R-1a…R-1e）；数字那把 `terminalBaseFontSize` 另需两处值域校验
（R-1f 预览态、R-1g 桌面态）——否则它会掉进 `previewSettings.ts:72` 那条 `typeof value !== 'boolean'` 的兜底，
**浏览器预览能勾、永远存不下**（本仓真出过这类缺陷，见 `tests/settings-keys-parity.test.mjs` 文件头）。

上游依据（本轮逐行打开过）：
- `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`
  = `public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（**默认 false**）；getter `:1043`、setter `:1047-1051`。
- 消费门 `platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382`
  = `if (EditorSettingsExternalizable.getInstance().isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)) {`
  （`:383` 新字号 = 当前 - wheelRotation、`:384` 界内才写、`:386` `return` ⇒ 缩放时不再滚缓冲区）。
- 上下限 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`（`scale(4)`）
  与 `:15-17`（`ide.editor.max.font.size` 默认 40）。
- 设置页那一格（本仓 R-3 的原文案）：`platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94`
  的 `enableWheelFontChange`，文案键 `checkbox.enable.ctrl.mousewheel.changes.font.size` 在
  `platform/ide-core/resources/messages/ApplicationBundle.properties:396`
  = `Change font size with Ctrl+Mouse Wheel in:`（macOS 变体 `:397`）。
  ⚠ 留痕：`docs/wiring-requests-2026-10-06-b10audit.md:163-164` 原写「`EditorOptionsPanel.kt:195`」「`ApplicationBundle.properties:395`」，
  本轮实测分别是 `:216`（`chkEnableWheelFontSizeChange = checkBox(enableWheelFontChange)` 那一行）与 `:396`。

### R-1a · `src/settingsModel.ts:461-465`（`EditorSettings` 接口尾部）

old（逐字含缩进）：

```
  /** `EditorSettingsExternalizable.java:76`，默认 **true**：鼠标停在符号上就弹文档。 */
  showQuickDocOnMouseHover: boolean;
  /** 注册表属性 `documentation.auto.update`（`DocumentationToolWindowManager.kt:55`），默认 **true**。 */
  autoUpdateDocumentation: boolean
}
```

new：

```
  /** `EditorSettingsExternalizable.java:76`，默认 **true**：鼠标停在符号上就弹文档。 */
  showQuickDocOnMouseHover: boolean;
  /** 注册表属性 `documentation.auto.update`（`DocumentationToolWindowManager.kt:55`），默认 **true**。 */
  autoUpdateDocumentation: boolean;
  // ---------------------------------------------------------------- 终端字号的两把（本批新增）
  /**
   * 上游字段 `EditorSettingsExternalizable.java:124` 的 `IS_WHEEL_FONTCHANGE_ENABLED`，默认 **false**
   * （getter 同文件 `:1043`、setter `:1047-1051`）。上游那一格在「编辑器 › 常规」的 Mouse control 组
   * （控件 `EditorOptionsPanel.kt:91-94` 的 `enableWheelFontChange`，文案
   * `ApplicationBundle.properties:396` = Change font size with Ctrl+Mouse Wheel in:）。
   * 本仓唯一消费点：`src/components/TerminalPanel.vue:107` 的 `wheelFontZoomEnabled` →
   * `src/terminalFontSize.ts:79` 的 `terminalWheelZoomApplies(event, wheelEnabled)`；
   * 关着时那次滚动照常滚终端缓冲区（`JBTerminalPanel.java:382` 那个 && 的前半个条件）。
   * 还有一把 `IS_WHEEL_FONTCHANGE_PERSISTENT`（同文件 `:125`，同样默认 false）管「缩放要不要写回设置」，
   * 本仓的缩放是会话内临时的（`TerminalFontSizeProvider.kt:16-25` 的 temporary zoom）⇒ **不落**那把。
   */
  wheelFontChangeEnabled: boolean;
  /**
   * 终端基准字号，整数 4..40（界 = `EditorFontsConstants.java:11-13` 与 `:15-17`）。
   * 上游没有这一格的原样：那一档住在配色方案的 consoleFontSize 里
   * （`TerminalUiSettingsManager.kt:123-132` 的 `detectFontSize()` 现算 ⇒ 是临时的，不写设置）。
   * 本仓没有可编辑配色方案 ⇒ 落成一格显式设置，缺省 13 = 本仓内置 `TERMINAL_BASE_FONT_SIZE`
   * （`src/terminalFontSize.ts:47`）。**这是本仓架构映射，不是上游那一格的原样。**
   * 消费点 `src/components/TerminalPanel.vue:113` 的 `baseFontSize`（越界的值它也不采纳）。
   */
  terminalBaseFontSize: number
}
```

### R-1b · `src/settingsModel.ts:223`（`defaultEditorSettings` 那一行的尾部）

old（逐字）：`showQuickDocOnMouseHover: true, autoUpdateDocumentation: true }`

new（逐字）：`showQuickDocOnMouseHover: true, autoUpdateDocumentation: true, wheelFontChangeEnabled: false, terminalBaseFontSize: 13 }`

⇒ 缺省档必须写 `wheelFontChangeEnabled: false`（上游 `:124`）。判据
`tests/terminal-font-size.test.mjs` 的「上游默认档钉 false」这条：键一落就把它从「请求文本」升级成硬钉，
落成 `true` 会直接红。

### R-1c · `native/settings_schema.hpp:100-101`（`EDITOR_SETTING_KEYS[]` 尾部）

old：

```
    "showQuickDocOnMouseHover", "autoUpdateDocumentation",
};
```

new：

```
    "showQuickDocOnMouseHover", "autoUpdateDocumentation",
    // 终端字号的两把（消费侧 src/components/TerminalPanel.vue:58/:107/:113）。
    // wheelFontChangeEnabled：上游字段 EditorSettingsExternalizable.java:124
    //   `public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;` ⇒ **默认 false**（getter :1043、setter :1047-1051）。
    //   门在 JBTerminalPanel.java:382（isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)）。
    // terminalBaseFontSize：整数 4..40 = EditorFontsConstants.java:11-13 / :15-17（min scale(4)、
    //   max ide.editor.max.font.size 默认 40）。上游那一格住在配色方案的 consoleFontSize
    //   （TerminalUiSettingsManager.kt:123-132 的 detectFontSize()）⇒ 本仓落成一格显式设置，缺省 13。
    "wheelFontChangeEnabled", "terminalBaseFontSize",
};
```

（漏这里的后果已在 hpp:55-60 的注释里写过：`validate_editor_patch` 的 `known_keys` 第一行就拒整次
`settings.update`，而前端每次发的是**整个** `editorSettings`（`src/App.vue:676`）；`prune_unknown`
还会把它从 `projects.json` 剪掉。）

### R-1d · `native/settings_schema.cpp:419`（`editor_defaults_impl()` 默认值表尾部）

old（逐字）：

```
            {"showQuickDocOnMouseHover", true}, {"autoUpdateDocumentation", true}};
```

new（逐字）：

```
            {"showQuickDocOnMouseHover", true}, {"autoUpdateDocumentation", true},
            // 终端字号两把：总闸按上游 EditorSettingsExternalizable.java:124 的 false，基准 13 = 本仓内置档。
            {"wheelFontChangeEnabled", false}, {"terminalBaseFontSize", 13}};
```

### R-1e · `src/previewSettings.ts:40`（预览态编辑器档键白名单）

old（逐字）：

```
      key === 'showQuickDocOnMouseHover' || key === 'autoUpdateDocumentation' ||
```

new（逐字）：

```
      key === 'showQuickDocOnMouseHover' || key === 'autoUpdateDocumentation' ||
      // 终端字号两把（上游 EditorSettingsExternalizable.java:124 默认 false；基准 4..40 = EditorFontsConstants.java:11-17）。
      key === 'wheelFontChangeEnabled' || key === 'terminalBaseFontSize' ||
```

### R-1f · `src/previewSettings.ts:43`（**数字键的值域**，漏了就是「布尔兜底」把它判成无效）

old（逐字，第一行是 `if (key === 'fontSize' …`）：

```
    if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < MIN_EDITOR_FONT_SIZE || Number(value) > MAX_EDITOR_FONT_SIZE
      : key === 'tabSize' ? ![2, 4, 8].includes(Number(value)) || typeof value !== 'number'
```

new：

```
    if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < MIN_EDITOR_FONT_SIZE || Number(value) > MAX_EDITOR_FONT_SIZE
      // 终端基准字号与编辑器字号同一套界（EditorFontsConstants.java:11-13 / :15-17 = 4 / 40）。
      : key === 'terminalBaseFontSize' ? !Number.isInteger(value) || Number(value) < MIN_TERMINAL_FONT_SIZE || Number(value) > MAX_TERMINAL_FONT_SIZE
      : key === 'tabSize' ? ![2, 4, 8].includes(Number(value)) || typeof value !== 'number'
```

并在 `src/previewSettings.ts:10` 那行 import 之后加一行（`.ts` 之间的**值** import 必须带扩展名）：

```
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from './terminalFontSize.ts'
```

（`src/terminalFontSize.ts` 不 import 任何东西 ⇒ 没有环。）

### R-1g · `native/settings_editor_keys.hpp`（桌面态数字键的值域；`validate_editor_added_key` 的 `:77` `return false;` 之前）

old（逐字，`settings_editor_keys.hpp:56-62`）：

```
    if (key == "codeVisionVisibleEntries") {
        if (!value.is_number_integer() || value.get<int>() < 1 || value.get<int>() > 10)
            fail("INVALID_SETTINGS", "codeVisionVisibleEntries must be an integer from 1 through 10.");
        return true;
    }
```

new：

```
    if (key == "codeVisionVisibleEntries") {
        if (!value.is_number_integer() || value.get<int>() < 1 || value.get<int>() > 10)
            fail("INVALID_SETTINGS", "codeVisionVisibleEntries must be an integer from 1 through 10.");
        return true;
    }
    // terminalBaseFontSize：界 4..40 = EditorFontsConstants.java:11-13 / :15-17，与 settings_schema.cpp:47-51
    // 的 fontSize 同一套。消费方 src/components/TerminalPanel.vue:113 的 baseFontSize 自己也会挡越界值
    // （两侧都挡 ⇒ 手改 projects.json 也开不出一个 xterm 不接受的字号）。
    if (key == "terminalBaseFontSize") {
        if (!value.is_number_integer() || value.get<int>() < 4 || value.get<int>() > 40)
            fail("INVALID_SETTINGS", "terminalBaseFontSize must be an integer from 4 through 40.");
        return true;
    }
```

（`wheelFontChangeEnabled` 是布尔，走 `settings_schema.cpp:131` 那条
`else if (!value.is_boolean()) fail(...)` 兜底即可，**不要**在这里加分支。）

⚠ 落完 R-1 之后：`node --test tests/settings-keys-parity.test.mjs` 应当自己就绿（它按
`defaultEditorSettings` 的键去查 hpp / cpp / previewSettings 三张表）；改了 `native/` 要跑
`npm run test:native`（看日志里的 `tests passed`，别信 npm 退出码）。

---

## R-2）把设置喂给终端面板（`src/App.vue:2272` 那一处挂载）

old（逐字，整行）：

```
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" @focus-terminal="showOutput('terminal')" /></div>
```

new：

```
          <div v-show="bottomTab === 'terminal'" class="terminal-host-wrap"><TerminalPanel ref="terminalPanelRef" :active="bottomTab === 'terminal' && bottom" :settings="editorSettings" :ansi-overrides="general.terminalAnsiColors" @focus-terminal="showOutput('terminal')" /></div>
```

- `:settings="editorSettings"` 是 R-1 那两把键唯一的生产消费链路（面板入参见
  `src/components/TerminalPanel.vue:58`）；`editorSettings` 是 App.vue 里那本编辑器账（保存路径 `src/App.vue:676`）。
- `:ansi-overrides="general.terminalAnsiColors"` 依赖 R-4 那个键；**R-4 不落就先把这一半删掉**（面板拿不到就是
  `undefined` ⇒ 不覆盖，行为与今天一致，不会报错，但留着一条永远为空的绑定就是假链路）。

## R-3）两格设置页行（`src/components/SettingsDialog.vue`，「编辑器 › 常规」页 `:720` 起）

### 3a · 总闸（紧跟 `:918` 那行 `showDiagnostics` 之后）

old（逐字，`:918`）：

```
            <label class="checkbox-row"><input v-model="settings.showDiagnostics" type="checkbox" aria-describedby="editor-diagnostics-hint" /><span>在编辑器里显示错误与警告</span></label>
```

new（在其后补一行；文案 = 上游 `ApplicationBundle.properties:396` 的英文直译，本地化包不在本地树）：

```
            <label class="checkbox-row"><input v-model="settings.wheelFontChangeEnabled" type="checkbox" /><span>按 Ctrl+鼠标滚轮改变字号（终端）</span></label>
```

（**不要**沿用 `aria-describedby="editor-diagnostics-hint"` —— 那是「显示错误与警告」那条提示的 id，
把它挂在滚轮那一格上是把说明文字指向不相干的元素。要提示就新起一个 `id` 并写与上游同义的一句。）

### 3b · 基准字号（数字行；同页既有形态见 `:910` 的「层数上限」与 `:934` 的「上下文行数」）

new（同样紧跟 3a 那一行之后）：

```
            <label class="field-row"><span>终端基准字号</span><input v-model.number="settings.terminalBaseFontSize" type="number" min="4" max="40" step="1" /></label>
```

`min`/`max` = `src/terminalFontSize.ts:37/:40`（上游 `EditorFontsConstants.java:11-13`/`:15-17`），与 R-1f/R-1g 同一套界。
上游这一格住在「编辑器 › 常规」（Mouse control 组，`EditorOptionsPanel.kt:91-94`）⇒ 两行都放同一页，
**不要**新开页键，也不要塞进 `'Console'` 页（那页对应上游 `ConsoleConfigurable` 的折叠规则）。

---

## R-4）ANSI 覆盖的供给侧（第三个键，建议下一批；不落也不影响本批的绿）

供给侧现在缺的就是「那张按色号的表存在哪」。按 `docs/wiring-requests-2026-10-06-b10audit.md:276-281` 的口径
放 **general 档**（应用级、随 `settings.general.update` 走）而不是编辑器档：native 的编辑器键表是**扁平标量**白名单，
`settings_schema.cpp:131` 那条兜底会把非布尔值直接判无效（`reformatOnPaste` 之类的字符串键都各有分支），
把一个 16 项映射塞进编辑器档就是惹「整次 settings.update 被拒」的老坑。general 档已经有
`trustedPaths`（数组）、`foldConsoleLines`（数组）、`breadcrumbsLanguages`（映射，编辑器档）这类结构形态。

键名 `terminalAnsiColors: Record<string, string>`（键 = 色号的字符串形式 `'0'`…`'15'`，值 = `#RGB`/`#RRGGBB`；
消费侧原样递给 `terminalPalette` 的第四参，坏值由 `src/terminalColors.ts:70-72` 的 `pickColor` 丢 ⇒
**面板不需要转换层**，判据 `tests/terminal-colors.test.mjs` 的「覆盖表用 JSON 的字符串键」那条）。

成对落点（**六处**，与 R-1 同理少一处就存不下 / 预览红）：

1. `src/settingsModel.ts:171` 之前（`GeneralSettingsState` 接口尾部，`trustedPaths: TrustedPathEntry[]` 之后）
   加 `terminalAnsiColors: Record<string, string>`（记得给上一行补分号）。
2. `src/settingsModel.ts:221` 的 `trustedPaths: [],` 之后加 `terminalAnsiColors: {},`（**旧存档缺键补默认**，
   不是按字段数判损坏）。
3. `native/settings_schema.hpp:142` 的 `"trustedPaths"` 之后（它在数组尾巴，**要补逗号**）：
   old `    "trustedPaths"` → new `    "trustedPaths",\n    // ANSI 16 色逐色号覆盖（JBTerminalSchemeColorPalette.kt:23-25 的按色号回方案取值）。\n    "terminalAnsiColors"`
4. `native/settings_schema.cpp:183` 的 `{"trustedPaths", Json::array()}};` →
   `{"trustedPaths", Json::array()}, {"terminalAnsiColors", Json::object()}};`
5. `native/settings_schema.cpp:216`（`validate_general_patch` 的 `trustedPaths` 分支旁）加一条对象分支：
   键必须是 `'0'`…`'15'`、值必须是 `#` 开头的 3/6/8 位十六进制、条目数 ≤ 16。
   （界与形状照 `src/terminalColors.ts:70-72` 的 `pickColor` 与 `:110` 的 0..15 循环，别放宽到 255：
   上游 `ColoredOutputTypeRegistryImpl.java:160-164` 的 `getAnsiColorKey(int value)` 对 `value >= 16`
   直接退回 `NORMAL_OUTPUT_KEY` ⇒ 16 号以后本来就不进这张表。）
6. `src/bridgePreview.ts:271` 的 general `accepted` 链里加 `|| key === 'terminalAnsiColors'`，并在
   `:276` 那串 `else if` 里加同样的形状校验（与 5 同一口径）。

挂载半边：R-2 的 `:ansi-overrides="general.terminalAnsiColors"`，加 `src/App.vue:2229` 的 `<RunConsole …>` 同一属性
（该行现状：`<RunConsole ref="runLog" :instances="runTabs" :active="activeRunInstance" :lines="runLines" :is-desktop="isDesktop"`）。

**本轮不落的那半**：设置页里逐色号那 16 格 UI。上游的宿主是「编辑器 › 配色方案 › 控制台」
（`JBTerminalSchemeColorPalette.kt:23-25` 回 `EditorColorsScheme` 要 ANSI 键），本仓那一页
（`src/components/ColorSchemeSettingsPage.vue`）现在还是零消费方模块 ⇒ 先有键、有消费链、再有格子，
不要先画 16 个没人喂的输入框（假控件禁令）。

---

## R-5）本轮发现并要求主代理核对的「文档 vs 实际」差异（留痕，不要求改别人的文件）

1. `TerminalPanel.vue` 旧注释把上游默认值写成「开着」⇒ **实际 `EditorSettingsExternalizable.java:124` 是 `false`**（本轮已订正并撤掉占位常量）。
2. `docs/wiring-requests-2026-10-06-b10audit.md:163` 写 `EditorOptionsPanel.kt:195` ⇒ 本轮实测该文件里
   `enableWheelFontChange` 的定义在 `:91-94`、复选框挂点在 `:216`；`:195` 没有核实到与这条相关的内容。
3. 同文档 `:164` 写 `ApplicationBundle.properties:395` = Mouse Control 组名 ⇒ 本轮只核实到
   `platform/ide-core/resources/messages/ApplicationBundle.properties:396`（那条文案键）与 `:397`（macOS 变体），
   `:395` 的组名**无法核实**（没打开确认，引用时请去掉行号）。
4. 同文档 `:270` 写 `TerminalPanel.vue:294` 是 palette 调用点、`:274` 写 `RunConsole.vue:145` ⇒ 本轮改前实测
   分别是 `:295` 与 `:146`（差一行，文档给的行号是改前另一版本）；改后是 `:322` 与 `:151/:153`。
