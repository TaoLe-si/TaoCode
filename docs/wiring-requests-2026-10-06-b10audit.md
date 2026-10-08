# 桶 10b 六条接线请求 · 逐条判定与可粘贴片段（2026-10-06 审计轮 b10audit）

对象：`docs/wiring-requests-2026-10-06-bucket10b.md` 的 6 条。每条都重新打开目标文件核过当前内容；
文档里的行号与本轮实测不一致的地方**都标了「原写 X、实际 Y」**。上游坐标全部亲自打开过那一行。

## 判定汇总

| # | 请求 | 判定 | 模块侧 | 宿主侧 |
|---|---|---|---|---|
| 1 | Run Anything 的执行上下文 cwd | **仍然缺**（三处必须同批落，单落 = 假通道） | 就位（`src/runActions.ts:462`） | 缺：`src/App.vue:2635`、`src/components/RunAnythingDialog.vue:17/:43` |
| 2 | 终端「Ctrl+滚轮改字号」+「基准字号」两格设置 | **仍然缺**（出口名三条全部核实存在） | 就位 | 缺：设置键（4 处成对）+ 两格设置页行 + `TerminalPanel.vue` 取数 |
| 3 | ANSI 16 色逐色号自定义 | **部分 · 模块侧本轮已落** | 已做（`src/terminalColors.ts:81/:100`） | 缺：设置键 + 两个 palette 调用点 |
| 4 | 大文件模式动作替换 | **部分 · 模块侧本轮已落** | 已做（`src/largeFileMode.ts:44-90`） | 缺：`CodeEditor.vue` 键位/查找栏、`editMenu.ts` 的 enabled |
| 5 | 大文件正则搜索提示 | **不落 · 前提不成立**（照抄就是编造限制） | 不加 | 不加 |
| 6 | `RunStartParams.elevate` | **不落 · 前提未成立**（传输层没有；目标文件也写错了） | 不加 | 登记为独立批次 |

预算内我做了 3、4 两条的**模块侧**（只碰 `src/terminalColors.ts`、`src/largeFileMode.ts`、`tests/terminal-colors.test.mjs`、`tests/large-file-mode.test.mjs`），
宿主挂载一律留在下面的片段里。**没有动任何保留文件**（`src/App.vue`、`src/bridge.ts`、`src/settingsModel.ts`、`src/settingsTreeMeta.ts`、`CMakeLists.txt`、`native/main.cpp`）与任何 `.vue`。

---

## 1) Run Anything 的执行上下文（cwd）—— 仍然缺

### 本仓现状（逐行打开过）

- 接收侧签名 **已就位**：`src/runActions.ts:462`
  `async function runExternalTool(command: string, name: string, cwd?: string) {`
  （原写 `:444`，实际 `:462`；原写 `:465` 发 cwd，实际 `:486`）
  `src/runActions.ts:486`
  `    const started = await request<{ instance: number }>('run.start', { command: expanded, label: name, cwd: cwd?.trim() || workspace.value.root })`
- 调用侧 **没接**：`src/App.vue:2635`（整行原文见下）
- 弹层 **payload 里没有 cwd**：`src/components/RunAnythingDialog.vue:17`
  `  (event: 'runCommand', payload: { command: string }): void`
  与 `src/components/RunAnythingDialog.vue:43`
  `    emit('runCommand', { command: row.name })`

### 前提核实（这条为什么不能只接 App.vue）

`src/runAnythingContext.ts` 的 `contextPath()` 在 `src/runAnythingContext.ts:80`，但 **src/ 下没有任何生产调用**：
`grep -rn "contextPath|allRunAnythingContexts|resolveSelectedContext|CONTEXT_POPUP_TITLE" src --include=*.ts --include=*.vue`
只命中 `src/runActions.ts:483` 的**注释**与该文件自身；`node .tools/find-orphan-modules.mjs` 把 `src/runAnythingContext.ts`
列为已登记的零消费方模块（本轮实测输出，见 batch 报告）。⇒ 现在接 `payload.cwd` 恒为 `undefined`，
落到 `:486` 就退回工作区根，等于什么都没接。
**结论：三处（上下文选择 UI → payload.cwd → App 传第三参）必须同批落。**

### 可粘贴（给桶 8 · `src/App.vue`）

old（第 2635 行整行，逐字含缩进）：

```
    <RunAnythingDialog v-if="runAnythingOpen" :configs="runConfigs" @run-config="selectRunConfig($event.name); void runSelectedConfig(false); runAnythingOpen = false" @run-command="payload => { void runExternalTool(payload.command, payload.command); runAnythingOpen = false }" @close="runAnythingOpen = false" />
```

new：

```
    <RunAnythingDialog v-if="runAnythingOpen" :configs="runConfigs" @run-config="selectRunConfig($event.name); void runSelectedConfig(false); runAnythingOpen = false" @run-command="payload => { void runExternalTool(payload.command, payload.command, payload.cwd); runAnythingOpen = false }" @close="runAnythingOpen = false" />
```

⚠ 顺序：`payload.cwd` 要能通过类型检查，**必须**先把下面那半（弹层 emit 类型）改掉，否则这一行是 TS2339。

### 可粘贴（给桶 9b · `src/components/RunAnythingDialog.vue`）

old（第 17 行）：

```
  (event: 'runCommand', payload: { command: string }): void
```

new（`cwd` 为空/缺省 = 用工作区根，与 `src/runActions.ts:486` 的 `|| workspace.value.root` 同语义）：

```
  (event: 'runCommand', payload: { command: string; cwd?: string | null }): void
```

old（第 43 行，`pick()` 里命令行那一支）：

```
    emit('runCommand', { command: row.name })
```

new（`context` 是弹层里那一格「执行上下文」的选择结果，取自 `src/runAnythingContext.ts:80` 的 `contextPath(context, moduleRoots)`；
`context === null` 或不选 ⇒ 不传，仍旧在工作区根跑）：

```
    emit('runCommand', { command: row.name, cwd: contextPath(context.value, moduleRoots.value) ?? undefined })
```

这一支的**真正缺口在弹层还没有那格上下文选择 UI**（`CONTEXT_POPUP_TITLE`、`allRunAnythingContexts`、
`resolveSelectedContext` 三个出口都在 `src/runAnythingContext.ts:35/:119/:160`，零生产消费方）：
先落 UI + `context`/`moduleRoots` 两个 ref，上面这行才有意义。UI 不在本审计轮的可改面里（`.vue`），留请求。

### 上游

`platform/execution-impl/src/com/intellij/execution/runAnything/` 在本 checkout **确实 find 无命中**
（本轮复核：`find . -path "*execution/runAnything*"` 命中 0）。⇒ 这条按「本仓架构还原用户可见功能」做，不引上游坐标。

---

## 2) 两格设置：Ctrl+滚轮改终端字号 / 终端基准字号 —— 仍然缺

### 出口名核实（任务点名要 grep `export`，别信文档）

`src/terminalFontSize.ts` 的真实出口（`grep -n "^export" src/terminalFontSize.ts`）：

- `:37` `MIN_TERMINAL_FONT_SIZE`、`:40` `MAX_TERMINAL_FONT_SIZE`、`:43` `FONT_SIZE_STEP_UP`、`:44` `FONT_SIZE_STEP_DOWN`
- `:47` `export const TERMINAL_BASE_FONT_SIZE = 13`
- `:53` `changeTerminalFontSize`、`:64` `terminalFontSizeForWheel`
- `:71` `export function resetTerminalFontSize(base: number = TERMINAL_BASE_FONT_SIZE): number {` ✓（文档写 :71，对）
- `:79` `export function terminalWheelZoomApplies(event: { ctrlKey?: boolean; metaKey?: boolean }, wheelEnabled: boolean): boolean {` ✓（文档写 :79，对）
- `:84` `terminalFontSizeReason`、`:89` `terminalFontSizeTitle`

⇒ **三个出口名全部存在**，请求成立。文档里 `TerminalPanel.vue:81` 的占位常量实际在 `src/components/TerminalPanel.vue:89`
（`const WHEEL_FONT_ZOOM_ENABLED = true`）；`actionContext()` 的 `baseFontSize` 实际在 `:120-121`（原写 88-105）。

### 设置键根本不存在（已核实）

`grep -n "terminal\|wheel\|Wheel" src/settingsModel.ts` ⇒ **0 命中**。`src/settingsTreeMeta.ts` 里 `terminal` 只命中
图标 `Terminal`（`:11`）与 `'Console'` 页（`:116`）。⇒ 「已闭环」不成立，仍然缺。

### ⚠ 默认值必须按上游改（这条文档没说，但会踩）

上游总闸默认是**关**：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`
`    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter `:1043`、setter `:1047`）。
而 `src/components/TerminalPanel.vue:86` 那句注释「先按上游的『开着』处理」与 `:124` **不符**。
⇒ 落设置项时按 `false` 落（并修那句注释），或明确登记「本仓默认开 = 与上游 :124 的差异」；
两态都比对 `Ctrl+滚轮` 有意义：关掉时这次滚动照常滚缓冲区（`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382`
的门是 `isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)`）。

### ⚠ 新编辑器设置键是**四处成对**，少一处就存不下（本仓实测过的坑）

1. `src/settingsModel.ts`：接口字段 + `defaultEditorSettings`（接口在 `:274` 起，最后一个字段是 `:464`
   `  autoUpdateDocumentation: boolean`；默认值整行在 `:223`，末尾是 `showQuickDocOnMouseHover: true, autoUpdateDocumentation: true }`）
2. `native/settings_schema.hpp:13` 的 `EDITOR_SETTING_KEYS[]`（数组尾巴见 `:44-51`；`validate_editor_patch` 第一行就 `known_keys(patch, EDITOR_SETTING_KEYS)`，
   前端每次保存发的是**整个** editorSettings 对象 ⇒ 漏键会拒掉整次 `settings.update`）
3. `native/settings_schema.cpp:419` 的默认值表（同一行形态：`{"showQuickDocOnMouseHover", true}, {"autoUpdateDocumentation", true}};`）
4. `src/previewSettings.ts:40-41` 的预览桩白名单（`key === 'showQuickDocOnMouseHover' || key === 'autoUpdateDocumentation' ||`）

（旧存档缺键补默认：以上 2/3 都是「缺键补默认」而不是按字段数判损坏，符合派单铁律。）

### 可粘贴 · 键定义（给桶 8 · `src/settingsModel.ts`）

old（`:462-465`，接口尾部）：

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
  /**
   * `EditorSettingsExternalizable.java:124`（`IS_WHEEL_FONTCHANGE_ENABLED`，默认 **false**）/
   * getter `:1043`。上游这一格在「编辑器 › 常规」（`EditorOptionsPanel.kt:195` 的 `ID = "preferences.editor"`，
   * 面板行 `:91-94`，组名 `ApplicationBundle.properties:395` = Mouse Control、
   * 文案 `:396` = Change font size with Ctrl+Mouse Wheel in:）。
   * 本仓唯一消费点是终端：`src/terminalFontSize.ts:79` 的 `terminalWheelZoomApplies(event, wheelEnabled)`。
   */
  wheelFontChangeEnabled: boolean;
  /**
   * 终端基准字号（上游 `TerminalUiSettingsManager.kt:123-128` 的 `detectFontSize()`：
   * 演示模式用 `presentationModeFontSize`，否则 `UISettingsUtils.kt:21-22` 的 `scaledConsoleFontSize`
   * = 配色方案的 consoleFontSize2D（`AbstractColorsScheme.java:877`）× IDE scale）。
   * 本仓没有可编辑配色方案 ⇒ 落成一格显式设置，缺省 13 = 本仓内置 `TERMINAL_BASE_FONT_SIZE`
   * （`src/terminalFontSize.ts:47`）。**这是本仓架构映射，不是上游那一格的原样。**
   */
  terminalBaseFontSize: number
}
```

old（`:223` 尾部，逐字）：`showQuickDocOnMouseHover: true, autoUpdateDocumentation: true }`
new：`showQuickDocOnMouseHover: true, autoUpdateDocumentation: true, wheelFontChangeEnabled: false, terminalBaseFontSize: 13 }`

（注意：文档原写「基准字号进 `resetTerminalFontSize(base)` 与 `TERMINAL_BASE_FONT_SIZE`」——`TERMINAL_BASE_FONT_SIZE` 是 `:47` 的
**内置缺省常量**，不要改它的值；要改的是调用点，见下。）

### 可粘贴 · 面板取数（给 `TerminalPanel.vue` 的 owner）

`TerminalPanel.vue` 现在的 props 是 `src/components/TerminalPanel.vue:43`
`const props = defineProps<{ active: boolean; cwd?: string; confirmClose?: (label: string) => Promise<boolean> }>()`，
组件读不到任何设置 ⇒ 桶 8 需要在 `src/App.vue:2272` 的挂载上多传一个 `:settings="editorSettings"`
（同页其它面板的既有写法：`src/components/SettingsDialog.vue:923` 的 `<ConsoleSettingsPage :settings="general" …>`）。

old（`:89`）：

```
const WHEEL_FONT_ZOOM_ENABLED = true
```

new：

```
const wheelFontZoomEnabled = computed(() => props.settings?.wheelFontChangeEnabled ?? defaultEditorSettings.wheelFontChangeEnabled)
```

（`:82-88` 那段注释里「先按上游的『开着』处理」要一并改成指向上游 `EditorSettingsExternalizable.java:124` 的 `false`。）

替换引用点（逐字原文）：

- `:326` old：`  if (!terminalWheelZoomApplies(event, WHEEL_FONT_ZOOM_ENABLED)) return`
  new：`  if (!terminalWheelZoomApplies(event, wheelFontZoomEnabled.value)) return`
- `:318` old：`  setFontSize(pane, resetTerminalFontSize(TERMINAL_BASE_FONT_SIZE))`
  new：`  setFontSize(pane, resetTerminalFontSize(baseFontSize()))`
- `:120-121` old：
  ```
    fontSize: current?.fontSize ?? TERMINAL_BASE_FONT_SIZE,
    baseFontSize: TERMINAL_BASE_FONT_SIZE,
  ```
  new：
  ```
    fontSize: current?.fontSize ?? baseFontSize(),
    baseFontSize: baseFontSize(),
  ```
- 另三处同样换成 `baseFontSize()`：`:308`、`:535`（`new Terminal({ … fontSize: TERMINAL_BASE_FONT_SIZE … })`）、`:546`、`:704`。
  建议加一行 `const baseFontSize = () => props.settings?.terminalBaseFontSize ?? defaultEditorSettings.terminalBaseFontSize`，
  并把 `:37` 的 import 里 `TERMINAL_BASE_FONT_SIZE` 留着当 `resetTerminalFontSize` 的缺省档（`src/terminalFontSize.ts:71` 的默认参数就是它）。

### 可粘贴 · 设置页行（给桶 8 · `src/components/SettingsDialog.vue`）

「编辑器 › 常规」页是 `src/components/SettingsDialog.vue:720` 起的那个 `<section v-show="section === 'editor'" …>`，
页键与文案见 `src/settingsTreeMeta.ts:88`（`{ key: 'editor', label: '常规', … }`）；既有行形态（`:918`）：

old（`:918`）：

```
            <label class="checkbox-row"><input v-model="settings.showDiagnostics" type="checkbox" aria-describedby="editor-diagnostics-hint" /><span>在编辑器里显示错误与警告</span></label>
```

new（在其后补一行；文案 = 上游 `ApplicationBundle.properties:396` 的英文直译，本地化包不在树里）：

```
            <label class="checkbox-row"><input v-model="settings.wheelFontChangeEnabled" type="checkbox" aria-describedby="editor-diagnostics-hint" /><span>按 Ctrl+鼠标滚轮改变字号（终端）</span></label>
```

终端基准字号那一格：建议放同一页（数字输入，`min=4`/`max=40` 取 `src/terminalFontSize.ts:37/:40` 的
`MIN_TERMINAL_FONT_SIZE`/`MAX_TERMINAL_FONT_SIZE`），不要新开页键 —— 上游那一档的宿主是配色方案的 consoleFontSize，
本仓没有可编辑方案，`'Console'` 页（`src/settingsTreeMeta.ts:116`）对应的是上游 `ConsoleConfigurable`（折叠规则），
把字号塞进那页会串页语义。

---

## 3) ANSI 16 色逐色号自定义 —— 模块侧已落，宿主仍缺

### 模块侧（本轮做完）

- `src/terminalColors.ts:81` `export type TerminalAnsiOverrides = Readonly<Record<number, string>>`
- `src/terminalColors.ts:100` `export function terminalPalette(` ⇒ 第四参 `overrides?: TerminalAnsiOverrides`（`:104`），
  内部 `:111` `attributes[index] = { foreground: pickColor(overrides?.[index], color) }`：坏值/空串走既有 `pickColor`（`:70-72`）丢弃，
  16 之后的色号不进这张表（`colorByAnsiIndex` 对 16..255 现算，`:56-67`）。
- 判据测试：`tests/terminal-colors.test.mjs` 新增 3 条（该文件 5 ⇒ 8 条），含「不传覆盖表时与改造前逐字节一致」的向后兼容断言。
- 反向验证：把 `pickColor(overrides?.[index], color)` 注回 `color` ⇒ **2 条变红**，撤掉 ⇒ 8/8 复绿（数字见 batch 报告）。
- 上游依据：`platform/execution-impl/src/com/intellij/terminal/JBTerminalSchemeColorPalette.kt:23-25`
  （`getAttributesByColorIndex(index)` 每取一色号都回 `EditorColorsScheme` 要
  `ColoredOutputTypeRegistryImpl.getAnsiColorKey(index)`，同文件 `:24`；键表在
  `platform/platform-api/src/com/intellij/execution/process/ColoredOutputTypeRegistryImpl.java:160`），
  默认前后景同文件 `:14-15` 与 `:19-20`（本仓已有的两参就是这个）。

### 仍缺的两半（宿主挂载 + 设置写入）—— 留请求

1. 面板调用点（逐字原文）：
   - `src/components/TerminalPanel.vue:294`
     old：`  return terminalPalette(theme, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim())`
     new：`  return terminalPalette(theme, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim(), terminalAnsiOverrides())`
   - `src/components/RunConsole.vue:145`
     old：`  return terminalPalette(consoleTheme.value, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim())`
     new：`  return terminalPalette(consoleTheme.value, root.getPropertyValue('--text').trim(), root.getPropertyValue('--editor').trim(), props.ansiOverrides ?? {})`
   （`RunConsole.vue:143` 那条无 document 的分支不用改：`terminalPalette(consoleTheme.value)` 少给四参 = 不覆盖。）
2. 设置键：建议存 `GeneralSettingsState`（应用级、随 `settings.general.update` 走，`ConsoleSettingsPage.vue:11` 已经吃同一份草稿）
   加 `terminalAnsiColors?: Record<string, string>`（键是色号的字符串形式，`src/terminalColors.ts` 的取值用 `Number(key)` 折一下），
   `defaultGeneralSettings`（`src/settingsModel.ts:182-222`，尾部 `trustedPaths: [],` 之后）补 `terminalAnsiColors: {}`；
   设置页行放「配色方案」那一节（`src/components/ColorSchemeSettingsPage.vue` —— 注意它现在也是零消费方模块，见 `node .tools/find-orphan-modules.mjs` 输出）。
   ⚠ 走 `EditorSettings` 的话同样要动 `native/settings_schema.hpp` 那张表，而它是**扁平标量**白名单，
   存 16 项映射建议放 general 档，别把 Record 塞进编辑器档惹出整次保存被拒的老问题。

---

## 4) 大文件模式的动作替换 —— 模块侧已落，分发层仍缺

### 请求原文的两处口径修正（留痕）

- 「被禁清单」原写「查找替换 / Select All Occurrences / Select Next·Previous Occurrence / Highlight Usages / GotoLine」，
  上游实际是**八条禁 + 四条换**（`platform/lang-impl/src/com/intellij/largeFilesEditor/PlatformActionsReplacer.java:34-54`）：
  禁 = `HighlightUsagesInFile`(`:37`)、`GotoLine`(`:38`)、`Replace`(`:48`)、`FindWordAtCaret`(`:49`)、
  `FindPrevWordAtCaret`(`:50`)、`SelectAllOccurrences`(`:51`)、`SelectNextOccurrence`(`:52`)、`UnselectPreviousOccurrence`(`:53`)
  —— **没有 "SelectPreviousOccurrence" 这一条**，`:53` 是 UnselectPreviousOccurrence；`:49-50` 原文漏了。
  换 = `FindNext`(`:40`)、`FindPrevious`(`:41`)、`Find`(`:47`)（「只搜不替换」说的就是 `:47` 换成
  `platform/lang-impl/src/com/intellij/largeFilesEditor/actions/LfeEditorActionHandlerFind.java:26-32` 那个恒 `return true` 的处理器，
  替换那一半已经被 `:48` 禁掉）。
- `LfeEditorActionHandlerDisabled.java:13-17` 是「类声明 + 构造」（`:13`、`:17`）；禁用的判据在 **`:31-36`**（`isEnabledInLfe()` 恒 `return false`）。
  `PlatformActionsReplacer.java:22`（类）与 `:57`（`addEditorActionHandler(actionId, LfeEditorActionHandlerDisabled::new)`）核对无误。

### 模块侧（本轮做完）

`src/largeFileMode.ts:44-90`：

- `:66` `export const LARGE_FILE_DISABLED_COMMANDS: readonly string[]`（八条，id 全取本仓真名）
- `:72` `export type LargeFileCommandGate = 'allowed' | 'blocked' | 'find-only'`
- `:81` `export function largeFileCommandGate(command: string, heavy: boolean): LargeFileCommandGate`（`:82` 是 `if (!heavy) return 'allowed'`）
- `:88` `export function largeFileCommandAllowed(command: string, heavy: boolean): boolean`
  （未知 id ⇒ `allowed`：白名单式降级，不拿表去关别人的动作。）
- id 来源核实：`src/menus/editMenu.ts:81-92` 的 `ctx.editable('find'/'replace'/'find.next'/'find.previous'/…)`、
  `:106` 的 `ctx.editable('usage.highlight', '高亮用法', 'Ctrl Shift F7', …)`、
  `src/editorCommands.ts:239/:247/:249` 的 `occurrence.select`/`occurrence.next`/`occurrence.unselect`、
  `src/keymapBindings.ts:110-111` 的 `navigate.gotoLine`（分派在 `src/keymap.ts:387`）。
- 判据测试：`tests/large-file-mode.test.mjs` 新增 3 条（该文件 4 ⇒ 7 条），其中一条**逐 id 回查三张本仓表**，
  表里出现假 id 就红（防「拿上游名字糊弄」）。
- 反向验证：删掉 `largeFileCommandGate` 的 `if (!heavy) return 'allowed'` ⇒ **1 条变红**，撤掉 ⇒ 7/7 复绿。

### 仍缺的分发层 —— 留请求（`CodeEditor.vue` 与 `EditorFindBar.vue` 都不在本轮可改面）

- 键位面：`src/components/CodeEditor.vue:853-868` 那批条目里，
  `Mod-r`（`:854`）、`Ctrl-F3`（`:856`）、`Ctrl-Shift-F3`（`:857`）、`Alt-Shift-j`（`:861`）、`Alt-j`（`:867`）、`Ctrl-Shift-Alt-j`（`:868`）
  都要在 `run:` 前套 `largeFileCommandAllowed(<id>, heavy)`；`heavy` 就在同一文件 `src/components/CodeEditor.vue:129`
  （`const heavy = large.large`，`:128` 是 `const large = largeFilePolicyForText(props.content)`）——**不需要新出口**。
  菜单面：`src/menus/editMenu.ts` 的 `ctx.editable(...)` 生成的 `enabled` 目前只看 `hasEditor()`，
  需要一次把 gate 传进去（`src/menus/types.ts` 是保留文件，桶 8 自己动）。
- `Find` 的「只搜不替换」那一档：`src/components/CodeEditor.vue:853` 已经是 `openFindBar(false)`（非替换档），
  还差**替换那一行**在 heavy 时不出现：挂载点 `src/components/CodeEditor.vue:1099` 的 `<EditorFindBar …>`
  要把 `:replace-mode="findBar.state.replaceMode"`（`:1106`）换成 `:replace-mode="!heavy && findBar.state.replaceMode"`，
  并给 `EditorFindBar.vue` 加一个「替换可用否」的 prop（那个文件现在只有 `:38` 的 `replaceMode` prop，
  切替换的按钮在 `src/components/EditorFindBar.vue:183`，`replaceOne`/`replaceAll` 在 `:213-214`）。
- ⚠ `EditorHandle`（`src/editorTab.ts:13-29`）**没有**任何大文件/heavy 相关 getter（`text`/`setDraft`/`command`/
  `expandAtCursor`/`hasSelection`/`setReadOnly`/`surroundWith`/`getCursor`/`getCursorCoords`/`exportStyledLines`/`selectionText`）。
  本条不需要它 —— `heavy` 与键位同在 `CodeEditor.vue` 内；**若**将来要在 App/菜单层判，得给 `EditorHandle` 加出口，
  那时桥的两端（`src/editorTab.ts` 的接口 + `CodeEditor.vue` 的 `defineExpose`）必须成对改。

---

## 5) 大文件里「正则搜索不可用」提示 —— 不落

理由（三句，都带证据；不是「做不了」）：

1. 上游那条播报的**不是"不可用"，是"匹配长度上限"**：`platform/lang-impl/src/com/intellij/largeFilesEditor/editor/LargeFileRegexSearchNotificationProvider.java:42-45`
   把 `largeFileEditor.getPageSize() / 500` 填进 `EditorBundle.message("message.warning.about.regex.search.limitations", …)`，
   文案原文 `platform/platform-api/resources/messages/EditorBundle.properties:155`
   = `Regex search can''t find matches with length longer then {0} Kb`（`:21` 是类声明，核对无误）。
   本仓编辑器是 CodeMirror 单视图、**没有分页** ⇒ 那个 `{0}` 数字无从算，写出来就是编一个数。
2. 本仓大文件模式**没关正则查找**，因此没有可播报的降级：`src/largeFileMode.ts:8`（「编辑、查找/替换、保存照常」）、
   `src/largeFileMode.ts:35` 的 `LARGE_FILE_NOTICE` 文案里就写着「查找替换仍可用」；
   查找实现 `src/editorSearchExtension.ts:62` 调 `collectSearchMatches(state.sliceDoc(scope.from, scope.to), query, options)`
   **不传 limit**，而 `src/editorSearch.ts:127` 的缺省就是 `limit = Infinity`。
3. 本仓真有的那一条限制是**高亮条数** `MAX_HIGHLIGHTS = 200`（`src/editorSearchExtension.ts:47`），
   它与大文件无关（普通文件同样受约束）⇒ 要播报它属另一条判词，不在本 6 条内，本轮不夹带。

⇒ 模块侧也**不加** `largeFileRegexNoticeText()`：加了就是没人调的死分支（请求原文自己也这么写）。
建议把这条从桶 10b 清单撤掉。查找条 `role="status"` 那一行的现有内容不用动
（`src/components/EditorFindBar.vue:34` 的 `status` prop 已是「第 n / 共 m 条」，与上游 `StatusTextAction` 同语义）。

---

## 6) `RunStartParams.elevate` —— 不落（本轮只登记是对的）

1. **目标文件写错了**：`RunStartParams` 不在 `src/bridge.ts`，定义在 `src/settingsModel.ts:51`
   （`export interface RunStartParams { command?: string; program?: string; args?: string[]; cwd?: string; env?: string[]; shell?: boolean; label?: string; … allowParallel?: boolean }`），
   `src/bridge.ts:71`/`:81` 只是 `export … from './settingsModel.ts'` 的转发。要加字段得动 settingsModel.ts（保留文件，桶 8）。
2. **消费侧完全没有**：全仓 `grep -rin "elevat"` 在 `src/` `native/` `tests/` 只命中 CSS 变量 `--elevated`，
   没有任何运行期读 `elevate` 的地方；`native/main.cpp:1104-1112` 的 `case "run.start"_h:` 只把 `params` 整包交给
   `runs->start(params, …)`（`:1110`），`native/run_host.hpp:35-39` 的 `struct Step` 里只有 `cwd` 一类字段，没有提权档。
   ⇒ 现在加 `elevate?: boolean` = 前端写了、native 读不到 ⇒ 假通道，违反「不放假控件」。
3. **缺的不是参数而是传输层**：上游整包 5 个文件确实 find 到
   （`platform/execution-process-elevation/src/com/intellij/execution/process/elevation/`：
   `ElevationBundle.java`、`ElevationDaemonProcessLauncher.kt`、`ElevationLogger.kt`、
   `ElevationServiceAvailabilityImpl.kt`、`ElevationServiceImpl.kt`），而
   `platform/execution-process-elevation/src/com/intellij/execution/process/elevation/ElevationDaemonProcessLauncher.kt:32`
   的注释直说提权进程**不走进程 stdio**（"instead of process stdio, and launch it in a trampoline mode"），`:71` 是
   `trampoline = true, daemonize = true` 那一档 ⇒ 本仓要先有 daemon / 命名管道那一层才能收输出，
   这条登记为**独立批次**（含 `native/run_host.cpp` + `CMakeLists.txt` 请求 + UAC 侧的取证）。
4. 附带核实（任务点名的桥/native 成对性）：`src/bridge.ts:109` 的 `Method` 联合里
   `'run.start' | 'run.write' | 'run.stop' | 'run.instances'` 四条 ↔ `native/main.cpp:1104`、`:1113`、`:1120`、`:1121`
   四个 case 一一对上 ⇒ **现有 run.* 通道没有假的那条**。这条不新增方法名，所以不涉及 `Method` 联合；
   但真做提权时若加 `run.elevate`/`run.daemon.*` 之类的方法，`src/bridge.ts:109` 与 `native/main.cpp` 的分派必须同批改。
5. 另一处口径：`src/runActions.ts:93-94` 的 `runStartParams()` 只服务「跑配置」那条链；
   `runExternalTool`（`:486`）发的是**内联对象**而不是 `RunStartParams` ⇒ 单加类型字段两处都不会自动带上，
   实现时要分别接。

---

## 交付给桶 8 / 各 owner 的清单（按能立刻粘贴的顺序）

1. `src/App.vue:2635` —— 一行（第 1 条，前提：先改弹层 emit 类型 `RunAnythingDialog.vue:17`，否则 TS2339）。
2. `src/settingsModel.ts:462-465` + `:223` —— 两把键（第 2 条），**同批**动 `native/settings_schema.hpp:13` 白名单、
   `native/settings_schema.cpp:419` 默认值、`src/previewSettings.ts:40` 预览桩白名单。
3. `src/components/SettingsDialog.vue:918` 之后 —— 两格设置行（第 2 条）。
4. `src/components/TerminalPanel.vue:89/:326/:318/:120-121/:308/:535/:546/:704` —— 取数换成设置（第 2 条），
   并在 `src/App.vue:2272` 挂 `:settings="editorSettings"`。
5. `src/components/TerminalPanel.vue:294` + `src/components/RunConsole.vue:145` —— ANSI 覆盖第四参（第 3 条，模块侧已就位）。
6. `src/components/CodeEditor.vue:853-868` + `src/menus/editMenu.ts` 的 `enabled` + `:1106` 的 `replace-mode` ——
   大文件动作门禁（第 4 条，模块侧已就位：`src/largeFileMode.ts:66/:81/:88`）。
7. 第 5、6 条：建议**撤掉/改判**（理由与证据见对应小节），不留悬案。

## 处理结果（wiring-backlog lane，2026-10-06）

逐条复核本审计的 6 条，**本 lane 只动了第 4 条的菜单侧**：

- **第 1 条（Run Anything cwd）已接线**：`src/App.vue:2638` 已透传 `payload.cwd`；`RunAnythingDialog.vue:51` emit 类型已含 `cwd?: string | null`、`:153-154` 已按上下文选择结果发 cwd。三处同批落，非假通道。
- **第 2 条（Ctrl+滚轮改字号 / 终端基准字号）已接线**：`src/settingsModel.ts:265/:344` 两键 + 默认值；`native/settings_schema.hpp:124` / `settings_schema.cpp:419` 白名单与默认；`src/previewSettings.ts:52/:58` 预览桩；`SettingsDialog.vue:736` 两格设置行；`TerminalPanel.vue:75/:124/:137` 取数 + `App.vue:2336` `:settings="editorSettings"`。整条闭环。
- **第 3 条（ANSI 16 色覆盖）模块侧 + 宿主取数已接**：`TerminalPanel.vue:351` 第四参 `props.ansiOverrides`、`RunConsole.vue:161/:163` 第四参 `props.ansiOverrides` 都已接。**仍缺一处**：设置键 `general.terminalAnsiColors` 全仓 `grep` 只命中 `RunConsole.vue:110` 的注释 —— `GeneralSettingsState`（`src/settingsModel.ts:153`）没有该字段，`GENERAL_SETTING_KEYS`（`native/settings_schema.hpp:127`）也没有 ⇒ 用户无法写入覆盖表，`ansiOverrides` 恒空。补键需同批改 `src/settingsModel.ts` + `native/settings_schema.hpp/.cpp` + `src/previewSettings.ts` + 设置页，跨 `native/`（非本 lane 可改面），**需 settings owner + native owner 处理**。
- **第 4 条（大文件动作替换）已接线（菜单侧）**：本 lane 在 `src/App.vue` 补 `import { largeFilePolicy, largeFileCommandAllowed } from './largeFileMode'`（:96）、`heavyActive()`（:1449）并把 `editable` 的 `enabled` 改成 `hasEditor() && largeFileCommandAllowed(name, heavyActive())`（:1455），并在 `runEditor`（:1444）加同一道门 —— 菜单、键位分发、动作搜索共用一个入口。**键位面**（`src/components/CodeEditor.vue:853-868` 的 `Mod-r`/`Ctrl-F3`/`Ctrl-Shift-F3`/`Alt-Shift-j`/`Alt-j`/`Ctrl-Shift-Alt-j`）与**查找栏替换行**（`CodeEditor.vue:1099` 的 `:replace-mode`）在 CodeEditor 名下，**需 CodeEditor owner 处理**（`EditorFindBar.vue` 是 VCS lane 独占，一并跳过）。
- **第 5 条（大文件正则提示）不落** —— 认同审计判定（前提不成立），不改。
- **第 6 条（RunStartParams.elevate）不落** —— 认同审计判定（缺传输层），登记为独立批次，不改。

App.vue 行数：2677 → 2686（+9：1 import 行 + 2 注释 + heavyActive + editable/runEditor 两处门）。上限 2737 未破。
