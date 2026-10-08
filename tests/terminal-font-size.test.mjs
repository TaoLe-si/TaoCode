// `src/terminalFontSize.ts` 的判据：越界保持原值、滚轮那一档、复位的靶子与 Ctrl+滚轮那道门。
//
// 上游依据：`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:381-390`
// （Ctrl+滚轮缩放、越界不改、并且这条分支 return 掉不再滚缓冲区）、
// `platform/execution-impl/src/com/intellij/openapi/editor/actions/TerminalChangeFontSizeAction.kt:26-28`（±1 步进）、
// `:57-68`（越界不改 / 复位交回提供者）、`TerminalFontSizeProvider.kt:16-25`（临时缩放不写设置）、
// 上下限 `platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`（4 / 40），
// 动作登记 `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:34-45`。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadSetup } from './vue-sfc-loader.mjs'

import {
  FONT_SIZE_STEP_DOWN, FONT_SIZE_STEP_UP, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE,
  TERMINAL_BASE_FONT_SIZE, changeTerminalFontSize, resetTerminalFontSize, terminalFontSizeForWheel,
  terminalFontSizeReason, terminalFontSizeTitle, terminalWheelZoomApplies,
} from '../src/terminalFontSize.ts'
import { previewSettingsError } from '../src/previewSettings.ts'

test('上下限是 4 与 40，步进 ±1（EditorFontsConstants.java:11-17、TerminalChangeFontSizeAction.kt:26-28）', () => {
  assert.equal(MIN_TERMINAL_FONT_SIZE, 4)
  assert.equal(MAX_TERMINAL_FONT_SIZE, 40)
  assert.equal(FONT_SIZE_STEP_UP, 1)
  assert.equal(FONT_SIZE_STEP_DOWN, -1)
})

test('越界是「保持原值」而不是夹到边界（JBTerminalPanel.java:384-386）', () => {
  assert.equal(changeTerminalFontSize(13, FONT_SIZE_STEP_UP), 14)
  assert.equal(changeTerminalFontSize(13, FONT_SIZE_STEP_DOWN), 12)
  assert.equal(changeTerminalFontSize(MAX_TERMINAL_FONT_SIZE, FONT_SIZE_STEP_UP), MAX_TERMINAL_FONT_SIZE)
  assert.equal(changeTerminalFontSize(MIN_TERMINAL_FONT_SIZE, FONT_SIZE_STEP_DOWN), MIN_TERMINAL_FONT_SIZE)
  assert.equal(changeTerminalFontSize(20, 100), 20, '一步跨过上限同样不改')
  assert.equal(changeTerminalFontSize(Number.NaN, 1), Number.NaN, '非有限值不当成一次有效缩放')
})

test('滚轮：往下滚 = 变小（newFontSize = 当前 - wheelRotation）', () => {
  assert.equal(terminalFontSizeForWheel(13, 1), 12)
  assert.equal(terminalFontSizeForWheel(13, -1), 14)
  assert.equal(terminalFontSizeForWheel(13, 0), 13, '没滚就不动')
  assert.equal(terminalFontSizeForWheel(4, 1), 4, '已在下限：这次滚动什么也不做')
  assert.equal(terminalFontSizeForWheel(40, -1), 40)
})

test('复位交回设置里那一档（TerminalFontSizeProvider 的 temporary zoom 反操作）', () => {
  assert.equal(resetTerminalFontSize(), TERMINAL_BASE_FONT_SIZE)
  assert.equal(resetTerminalFontSize(16), 16)
})

test('Ctrl+滚轮那道门要两个条件同时成立（JBTerminalPanel.java:382）', () => {
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, true), true)
  assert.equal(terminalWheelZoomApplies({ metaKey: true }, true), true, 'mac 上是 Cmd')
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, false), false, '总闸关掉 ⇒ 照常滚缓冲区')
  assert.equal(terminalWheelZoomApplies({ shiftKey: true }, true), false, '光滚不改字号')
})

test('启用判定与提示文案把上下限说清楚', () => {
  assert.deepEqual(terminalFontSizeReason(13), { canIncrease: true, canDecrease: true })
  assert.equal(terminalFontSizeReason(40).canIncrease, false)
  assert.equal(terminalFontSizeReason(4).canDecrease, false)
  assert.match(terminalFontSizeTitle(13, 13), /^终端字号 13px（范围 4–40px）$/)
  assert.match(terminalFontSizeTitle(18, 13), /临时缩放/, '缩放后要写明这是临时的')
})

test('消费链：面板挂 Ctrl+滚轮（越界不滚缓冲区）与工具条那三枚按钮', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /terminalWheelZoomApplies\(event, wheelFontZoomEnabled\.value\)/, '先过上游那道双条件门（总闸来自设置）')
  assert.match(panel, /event\.preventDefault\(\)/, '缩放时不再滚缓冲区（那条分支 return）')
  assert.match(panel, /terminalFontSizeForWheel\(pane\.fontSize, event\.deltaY\)/, '滚轮那一档走纯函数')
  assert.match(panel, /addEventListener\('wheel',.*\{ passive: false \}\)/, 'preventDefault 要 passive: false')
  assert.match(panel, /fontSize: baseFontSize\.value/, 'xterm 建实例的基准字号 = 设置里那一档')
  assert.match(panel, /changeTerminalFontSize\(pane\.fontSize, step\)/, '工具条放大/缩小走纯函数')
  assert.match(panel, /resetTerminalFontSize\(baseFontSize\.value\)/, '复位交回设置里那一档')
  assert.match(panel, /terminalFontSizeTitle\(fontSizeShown, baseFontSize\)/, '字号读数写明是否临时缩放')
  assert.doesNotMatch(panel, /localStorage/, '缩放是会话内的，不写设置也不写盘')
})

/**
 * 判据（本批新增）：**字号随 Ctrl+滚轮变、总闸关掉时一次都不动** —— 纯函数级把面板那两步
 * （先过 `terminalWheelZoomApplies`，再走 `terminalFontSizeForWheel`）串起来跑。
 * 上游那条 && 的两个条件见 `JBTerminalPanel.java:382`（实测本行：
 * `if (EditorSettingsExternalizable.getInstance().isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e))`）。
 */
test('把面板那两步串起来：开着时 Ctrl+滚轮才改字号，关掉时任何滚动都不改', () => {
  const panelZoomStep = (current, event, wheelEnabled, deltaY) =>
    terminalWheelZoomApplies(event, wheelEnabled) ? terminalFontSizeForWheel(current, deltaY) : current
  assert.equal(panelZoomStep(13, { ctrlKey: true }, true, -1), 14)
  assert.equal(panelZoomStep(14, { ctrlKey: true }, true, 1), 13, '往上滚一次要能原路退回去')
  assert.equal(panelZoomStep(13, { metaKey: true }, true, -1), 14, 'mac 那半（EditorUtil.isChangeFontSize 也认 Meta）')
  for (const deltaY of [-1, 1, -3, 3]) {
    assert.equal(panelZoomStep(13, { ctrlKey: true }, false, deltaY), 13, '总闸关掉 ⇒ 这次滚动只滚缓冲区')
    assert.equal(panelZoomStep(13, {}, true, deltaY), 13, '没按 Ctrl 就是普通滚动')
  }
  assert.equal(panelZoomStep(MAX_TERMINAL_FONT_SIZE, { ctrlKey: true }, true, -1), MAX_TERMINAL_FONT_SIZE, '已在上限：保持原值（:384-386）')
  assert.equal(panelZoomStep(MIN_TERMINAL_FONT_SIZE, { ctrlKey: true }, true, 1), MIN_TERMINAL_FONT_SIZE, '已在下限：同上')
  assert.equal(resetTerminalFontSize(16), 16, '复位交回的是设置那一档，不是 13')
  assert.equal(resetTerminalFontSize(), TERMINAL_BASE_FONT_SIZE, '没有设置时退回本仓内置基准')
})

/**
 * 判据（本批新增）：**上游默认档钉 false**。上游 `EditorSettingsExternalizable.java:124` 实测是
 * `public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter `:1043`）—— 本仓此前那个占位常量
 * `WHEEL_FONT_ZOOM_ENABLED = true` 与它的注释「先按上游的『开着』处理」都写反了，本轮订正并留痕。
 *
 * 设置键（`wheelFontChangeEnabled` / `terminalBaseFontSize`）落在四处成对的白名单里，那四个文件都归
 * 主代理（`src/settingsModel.ts`、`native/settings_schema.hpp`、`native/settings_schema.cpp`、
 * `src/previewSettings.ts`）。所以这里：**键已落 ⇒ 直接钉住 false**；键未落 ⇒ 钉住接线请求里写的是 false
 * （落成 true 就是与本仓声明过的上游差异）。
 */
test('上游默认档钉 false：设置缺省、面板 fallback、纯函数那道门三处同一个 false', () => {
  const model = readFileSync(new URL('../src/settingsModel.ts', import.meta.url), 'utf8')
  const defaultsLine = model.split(/\r?\n/).find(line => line.includes('export const defaultEditorSettings'))
  assert.ok(defaultsLine, 'src/settingsModel.ts 里找不到 defaultEditorSettings')
  const landed = /wheelFontChangeEnabled:\s*(true|false)/.exec(defaultsLine)
  if (landed) {
    assert.equal(landed[1], 'false', 'defaultEditorSettings.wheelFontChangeEnabled 必须 = EditorSettingsExternalizable.java:124 的 false')
    assert.match(model, /wheelFontChangeEnabled: boolean/, 'EditorSettings 接口里有这一把键（面板读的就是它）')
  } else {
    const request = readFileSync(new URL('../docs/wiring-requests-2026-10-06-termset.md', import.meta.url), 'utf8')
    assert.match(request, /wheelFontChangeEnabled: false/, '键还没落 ⇒ 接线请求必须把缺省钉成 false，不许落成 true')
  }
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /props\.settings\?\.wheelFontChangeEnabled \?\? false/, '面板的 fallback 与上游同一档')
  assert.doesNotMatch(panel, /const WHEEL_FONT_ZOOM_ENABLED\s*=/, '占位常量的**声明**已撤（文件里只许留下「原写 true、实际 false」的留痕注释）')
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, landed ? landed[1] === 'true' : false), false,
    '把缺省档喂给那道门 ⇒ 关着（Ctrl+滚轮不缩放）')
})

/**
 * 判据（本批新增）：**基准字号这一档真的来自设置**，且面板里所有取数点都换成那一档
 * （原先六处硬编码 `TERMINAL_BASE_FONT_SIZE`；接线请求第 2 条列的 `:308/:318/:535/:546/:704` 与
 * `actionContext()` 的两行）。缺省常量仍留在文件里当「没有设置时的那一档」
 * （`src/terminalFontSize.ts:47` 与 `resetTerminalFontSize` 的默认参数 `:71`）。
 */
test('基准字号来自设置：面板六个取数点 + 越界不采纳 + 换档跟到没被临时缩放的窗格', () => {
  const panel = readFileSync(new URL('../src/components/TerminalPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /props\.settings\?\.terminalBaseFontSize/, '读的是设置里那一格')
  assert.match(panel, /raw >= MIN_TERMINAL_FONT_SIZE && raw <= MAX_TERMINAL_FONT_SIZE/, '越界的基准值不采纳（EditorFontsConstants.java:11-17）')
  assert.match(panel, /fontSize: current\?\.fontSize \?\? baseFontSize\.value/, 'actionContext 的当前字号')
  assert.match(panel, /baseFontSize: baseFontSize\.value/, 'actionContext 的基准字号（复位按钮可用性的靶子）')
  assert.match(panel, /selected\.value\?\.fontSize \?\? baseFontSize\.value/, '工具条读数缺省档')
  assert.match(panel, /fontSize: baseFontSize\.value,\n/, '新建窗格的会话字号')
  assert.match(panel, /watch\(baseFontSize, \(next, previous\) =>/, '设置换档要重排现有窗格（上游 detectFontSize() 是现算的）')
  assert.doesNotMatch(panel, /fontSize: TERMINAL_BASE_FONT_SIZE/, '六处硬编码都撤干净了')
  assert.equal(TERMINAL_BASE_FONT_SIZE, 13, '内置缺省那一档本身没被改值')
})

/**
 * 判据（R-3 落地）：**设置页那两行是真的挂在编辑器设置对象上，且只在「编辑器 › 常规」那一页**
 * （上游宿主 `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt:91-94`
 * 的定义 + 同文件 :216 的挂点，组名 :214 用 `group.advanced.mouse.usages`
 * = `platform/ide-core/resources/messages/ApplicationBundle.properties:395` Mouse Control，
 * 文案同文件 :396 = `Change font size with Ctrl+Mouse Wheel in:`）。
 *
 * 为什么钉「页」而不只是钉文件：这个对话框把编辑器设置拆成多页，每页绑的是**同一个** `editor` 草稿
 * （`const editor = ref<EditorSettings>({ ...props.settings })`，应用走 `applyEditor()` →
 * `emit('save', { ...editor.value })`）。格子放错页 = 用户找不到，放对页但绑 `props.settings`
 * = 改了不落盘（Errors 那类页直接改 props，没有草稿也没有恢复默认）。所以两处都要钉。
 */
test('设置页两行：在「编辑器 › 常规」页上，v-model 绑的是 editor 草稿的同名键，界 4..40', () => {
  const dialog = readFileSync(new URL('../src/components/SettingsDialog.vue', import.meta.url), 'utf8')
  const start = dialog.indexOf(`v-show="section === 'editor'"`)
  assert.ok(start > 0, '找不到「编辑器 › 常规」那一页（data-page="editor" 的 form）')
  const end = dialog.indexOf('</form>', start)
  assert.ok(end > start, '那一页的 form 没有收尾')
  const page = dialog.slice(start, end)
  assert.match(page, /data-page="editor"/, '锚点确实落在常规页')

  // 勾选那一行：绑到真实属性名 wheelFontChangeEnabled（不是同名局部量）。
  assert.match(page, /v-model="editor\.wheelFontChangeEnabled" type="checkbox"/,
    '常规页没有把滚轮总闸绑到 editor.wheelFontChangeEnabled 的复选框')
  // 数字那一行：min/max/step 是 EditorFontsConstants.java:11-13 / :15-17 的那对界（4 / 40）。
  assert.match(page, /v-model\.number="editor\.terminalBaseFontSize" type="number" min="4" max="40" step="1"/,
    '常规页没有 4..40 的终端基准字号数字行')

  // 提示：新起的 id，两行共用；**不许**借用 editor-diagnostics-hint（那是「显示错误与警告」的说明）。
  const described = [...page.matchAll(/aria-describedby="editor-terminal-font-hint"/g)].length
  assert.equal(described, 2, '两行都要指向同一条新提示（aria-describedby 各一次）')
  assert.equal([...page.matchAll(/id="editor-terminal-font-hint"/g)].length, 1, '提示的 id 只能定义一次')
  assert.doesNotMatch(page, /editor-diagnostics-hint/, '不许把滚轮那格挂到诊断那条提示上')

  // 文案 = 上游 ApplicationBundle.properties:396 的英文直译（本地化包不在本地树 ⇒ 注释里写明原句）。
  assert.match(page, /按 Ctrl\+鼠标滚轮改变字号/, '缺少上游那句 Change font size with Ctrl+Mouse Wheel 的直译')
  assert.match(dialog, /Change font size with Ctrl\+Mouse Wheel in:/, '注释里没有登记上游英文原句（直译要留痕）')

  // 假控件禁令的反面：界面有格子 ⇒ 设置模型必须有同名键（两把都在 EditorSettings 接口里）。
  const model = readFileSync(new URL('../src/settingsModel.ts', import.meta.url), 'utf8')
  assert.match(model, /wheelFontChangeEnabled: boolean/, '接口里没有 wheelFontChangeEnabled 这一把')
  assert.match(model, /terminalBaseFontSize: number/, '接口里没有 terminalBaseFontSize 这一把')
})

/**
 * 判据（R-1 落地）：**六处成对一处不缺**，且缺省值钉死
 * `wheelFontChangeEnabled = false`（上游 `EditorSettingsExternalizable.java:124`
 * 的 `IS_WHEEL_FONTCHANGE_ENABLED = false`，getter :1043 / setter :1047-1051）
 * 与 `terminalBaseFontSize = 13`（本仓内置档 `src/terminalFontSize.ts:47`）。
 * 少一处 = 整次 `settings.update` 被 native 的 `known_keys` 拒（前端每次发的是整本账），
 * 或被预览态那条 `typeof value !== 'boolean'` 的兜底判坏（浏览器能勾、永远存不下）。
 */
test('六处成对 + 缺省值：false / 13 在两把键的每一张表里都同一个值', () => {
  const model = readFileSync(new URL('../src/settingsModel.ts', import.meta.url), 'utf8')
  const defaultsLine = model.split(/\r?\n/).find(line => line.includes('export const defaultEditorSettings'))
  assert.match(defaultsLine, /wheelFontChangeEnabled: false/, '前端缺省必须是上游那个 false')
  assert.match(defaultsLine, /terminalBaseFontSize: 13/, '前端缺省基准 = 本仓内置档 13')

  const hpp = readFileSync(new URL('../native/settings_schema.hpp', import.meta.url), 'utf8')
  const keys = hpp.match(/EDITOR_SETTING_KEYS\[\] = \{([\s\S]*?)\};/)[1].replace(/\/\/.*$/gm, '')
  assert.match(keys, /"wheelFontChangeEnabled"/, 'native 编辑器键白名单漏了布尔那把')
  assert.match(keys, /"terminalBaseFontSize"/, 'native 编辑器键白名单漏了数字那把')

  const cpp = readFileSync(new URL('../native/settings_schema.cpp', import.meta.url), 'utf8')
  const body = cpp.match(/Json editor_defaults_impl\(\) \{([\s\S]*?)\n\}/)[1]
  assert.match(body, /\{"wheelFontChangeEnabled", false\}/, 'native 默认值表：总闸必须 false')
  assert.match(body, /\{"terminalBaseFontSize", 13\}/, 'native 默认值表：基准必须 13')

  const preview = readFileSync(new URL('../src/previewSettings.ts', import.meta.url), 'utf8')
  assert.match(preview, /key === 'wheelFontChangeEnabled' \|\| key === 'terminalBaseFontSize'/,
    '预览态白名单漏键（漏一个 = 浏览器预览整次 settings.update 被拒）')
  // 数字键必须有**自己的**值域分支：落到末尾那条布尔兜底就是"能勾、存不下"。
  assert.match(preview, /: key === 'terminalBaseFontSize' \? !Number\.isInteger\(value\) \|\| Number\(value\) < MIN_TERMINAL_FONT_SIZE \|\| Number\(value\) > MAX_TERMINAL_FONT_SIZE/,
    '预览态没有 terminalBaseFontSize 的 4..40 值域分支')

  const nativeKeys = readFileSync(new URL('../native/settings_editor_keys.hpp', import.meta.url), 'utf8')
  assert.match(nativeKeys, /key == "terminalBaseFontSize"/, '桌面态没有 terminalBaseFontSize 的分支')
  assert.match(nativeKeys, /terminalBaseFontSize must be an integer from 4 through 40\./,
    '桌面态的值域文案（界 4..40 = EditorFontsConstants.java:11-17）')

  // 直接跑那道校验：两个缺省值都必须被预览态放行，越界的必须被拒。
  const languages = ['java', 'cpp', 'typescript', 'other']
  assert.equal(previewSettingsError('wheelFontChangeEnabled', false, languages), null, '缺省档 false 存不进预览态')
  assert.equal(previewSettingsError('wheelFontChangeEnabled', 'no', languages), '无效设置：wheelFontChangeEnabled')
  assert.equal(previewSettingsError('terminalBaseFontSize', 13, languages), null, '缺省档 13 存不进预览态')
  for (const bad of [3, 41, 0, -1, 13.5, '13', null]) {
    assert.equal(previewSettingsError('terminalBaseFontSize', bad, languages), '无效设置：terminalBaseFontSize',
      `越界值 ${String(bad)} 必须被预览态挡住`)
  }
  for (const good of [4, 13, 40]) {
    assert.equal(previewSettingsError('terminalBaseFontSize', good, languages), null, `边界值 ${good} 应当收`)
  }
})

/**
 * 判据（b10judge 新增，2026-10-06）：**成对的第七处 = 宿主挂载**。
 * 上面那些判据把两把键钉成了「存得下 + 面板读得到」：`src/settingsModel.ts`（接口与缺省）、
 * `native/settings_schema.hpp` 白名单、`native/settings_schema.cpp` 默认值、
 * `native/settings_editor_keys.hpp` 值域、`src/previewSettings.ts` 预览档、面板那六个取数点、
 * `src/components/SettingsDialog.vue` 的两格设置页行 —— 一处不缺也照样可能整条链是死的：
 * `src/components/TerminalPanel.vue` 的 `settings` prop 是**可选**的，宿主挂载少写
 * `:settings="editorSettings"` 时 `vue-tsc` 不报（可选 prop 缺省合法）、上面每一条都仍绿，
 * 界面上「终端基准字号 / 按 Ctrl+鼠标滚轮改变字号」那两格却永远停在内置档（13 / 关）。
 * 这条正是 `docs/wiring-requests-2026-10-06-b10audit.md` 第 2 条由主代理落地
 * （`docs/batch-2026-10-06-main.md` §11.2）之后**没有任何测试覆盖**的那一行。
 *
 * 上游依据（本代理逐行打开过，坐标为实测）：
 *   · 总闸默认关：`platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:124`
 *     = `    public boolean IS_WHEEL_FONTCHANGE_ENABLED = false;`（getter 同文件 `:1043`、setter `:1047`）；
 *   · 两道条件的那扇门：`platform/execution-impl/src/com/intellij/terminal/JBTerminalPanel.java:382`
 *     = `if (EditorSettingsExternalizable.getInstance().isWheelFontChangeEnabled() && EditorUtil.isChangeFontSize(e)) {`
 *     （`:383` 新字号 = 当前 - wheelRotation、`:384` 界内才写、`:386` `return` ⇒ 缩放时不滚缓冲区）；
 *   · 界 4..40：`platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-13`
 *     （`getMinEditorFontSize()` = `JBUIScale.scale(4)`）与 `:15-17`（`ide.editor.max.font.size` 默认 40）；
 *   · 基准字号上游没有那一格，只有现算的那一档：`platform/execution-impl/src/com/intellij/terminal/`
 *     `TerminalUiSettingsManager.kt:123-128` 的 `detectFontSize()`（`resetFontSize()` `:130-132` 交回它）。
 */
const PANEL = 'src/components/TerminalPanel.vue'

/** `loadSetup` 里没有组件实例，`onMounted`/`onBeforeUnmount` 会各打一条 dev 警告 —— 与本判据无关，消音。 */
function quiet(fn) {
  const error = console.error
  console.error = () => {}
  try { return fn() } finally { console.error = error }
}

test('宿主把 :settings 交给终端面板：没接 ⇒ 面板按内置档，接了 ⇒ 界面那一格跟着用户那一档走', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const mounts = [...app.matchAll(/<TerminalPanel\b[^>]*>/g)].map(match => match[0])
  assert.ok(mounts.length >= 1, 'src/App.vue 里找不到终端面板的挂载 ⇒ 面板根本没上树')
  for (const tag of mounts) {
    assert.match(tag, /:settings="editorSettings"/,
      '终端面板挂载少传 :settings ⇒ 设置页那两格改了没反应（prop 可选，vue-tsc 与上面那些判据都不会报）')
    assert.equal(/:settings="\s*\{/.test(tag), false,
      '不许在挂载处现抄一份字面量 —— 抄来的那份不随 settings.update 的回包更新')
  }
  // 传进去的必须是那本活账：初值取 defaultEditorSettings，保存回包整体替换。
  assert.match(app, /const editorSettings = ref<EditorSettings>\(\{ \.\.\.defaultEditorSettings \}\)/,
    '宿主侧那本编辑器账的初值就是设置缺省（wheelFontChangeEnabled:false / terminalBaseFontSize:13）')
  assert.match(app, /editorSettings\.value = await request<EditorSettings>\('settings\.update'/,
    '保存回包要换掉整本账，否则传给面板的是快照')

  // ── 两侧都真跑一遍：调的是组件自己那份 setup 源码，不是重写一遍规则 ──
  const wired = quiet(() => loadSetup(PANEL, { active: true, settings: { wheelFontChangeEnabled: true, terminalBaseFontSize: 18 } }))
  assert.equal(wired.bindings.baseFontSize.value, 18, '接了 ⇒ 基准字号 = 用户那一档')
  assert.equal(wired.bindings.fontSizeShown.value, 18, '工具条那一格显示的是 18px')
  assert.equal(wired.bindings.wheelFontZoomEnabled.value, true, '接了 ⇒ 总闸跟着设置开')
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, wired.bindings.wheelFontZoomEnabled.value), true,
    '开着时 Ctrl+滚轮这一档才走缩放（JBTerminalPanel.java:382 的前半个条件）')

  const unwired = quiet(() => loadSetup(PANEL, { active: true }))
  assert.equal(unwired.bindings.baseFontSize.value, TERMINAL_BASE_FONT_SIZE,
    '宿主没接 ⇒ 面板退回内置 13，用户在设置页改的那一档在界面上不出现')
  assert.equal(unwired.bindings.fontSizeShown.value, TERMINAL_BASE_FONT_SIZE)
  assert.equal(unwired.bindings.wheelFontZoomEnabled.value, false, '没接时总闸关（EditorSettingsExternalizable.java:124 的 false）')
  assert.equal(terminalWheelZoomApplies({ ctrlKey: true }, unwired.bindings.wheelFontZoomEnabled.value), false)

  // 越界与坏值都不采纳：宿主传什么都不把复位打到 xterm 不接受的那一档。
  const outOfRange = quiet(() => loadSetup(PANEL, { active: true, settings: { terminalBaseFontSize: 41 } }))
  assert.equal(outOfRange.bindings.baseFontSize.value, TERMINAL_BASE_FONT_SIZE, '41 越界（EditorFontsConstants.java:15-17）⇒ 不采纳')
  const notAnInteger = quiet(() => loadSetup(PANEL, { active: true, settings: { terminalBaseFontSize: 13.5 } }))
  assert.equal(notAnInteger.bindings.baseFontSize.value, TERMINAL_BASE_FONT_SIZE, '非整数 ⇒ 不采纳（Number.isInteger 那道守卫）')
})

