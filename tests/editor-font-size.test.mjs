// 编辑器字号上下限的判据（IDEA `EditorFontsConstants` + `ChangeEditorFontSizeAction`）。
//
// 上游**两处来源不是同一区间**，这正是本仓原先写成 10–32 时踩错的地方：
//   · 设置页 / 配色方案写入门槛：`EditorFontsConstants.getMinEditorFontSize()` = `scale(4)`、
//     `getMaxEditorFontSize()` = `scale(SystemProperties.getIntProperty("ide.editor.max.font.size", 40))`
//     （`platform/editor-ui-ex/src/com/intellij/application/options/EditorFontsConstants.java:11-17`）。
//     `AbstractColorsScheme.setEditorFontSize`（`:324-326`）每次写入都 `checkAndFixEditorFontSize`
//     （= `round(min, max, size)`，`:29-35`）；设置页输入框按同一对边界 clamp
//     （`AbstractFontOptionsPanel.java:109`）。
//   · **菜单动作的下界更严**：`ChangeEditorFontSizeAction.actionPerformed`
//     （`platform/platform-impl/src/com/intellij/openapi/editor/actions/ChangeEditorFontSizeAction.java:48`）
//     只在**目标值** `>= 8 && <= getMaxEditorFontSize()` 时才应用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  actionFontSizeApplies, clampEditorFontSize, MAX_EDITOR_FONT_SIZE, MIN_ACTION_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE, stepEditorFontSize,
} from '../src/editorFontSize.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('门槛数值来自源码：写入 [4, 40]，菜单动作 [8, 40]', () => {
  assert.equal(MIN_EDITOR_FONT_SIZE, 4, 'EditorFontsConstants.getMinEditorFontSize = scale(4)')
  assert.equal(MAX_EDITOR_FONT_SIZE, 40, 'registry ide.editor.max.font.size 默认 40')
  assert.equal(MIN_ACTION_FONT_SIZE, 8, 'ChangeEditorFontSizeAction:48 的 >= 8')
})

test('clampEditorFontSize 夹到 [4, 40]（checkAndFixEditorFontSize）', () => {
  assert.equal(clampEditorFontSize(14), 14, '区间内原样')
  assert.equal(clampEditorFontSize(3), 4, '低于下限夹到 4（不是菜单动作的 8）')
  assert.equal(clampEditorFontSize(41), 40, '高于上限夹到 40')
  assert.equal(clampEditorFontSize(-5), 4)
})

test('菜单动作判的是**目标值**（ChangeEditorFontSizeAction.java:48）', () => {
  assert.equal(actionFontSizeApplies(40), true, '上界可到')
  assert.equal(actionFontSizeApplies(41), false, '超上界不应用')
  assert.equal(actionFontSizeApplies(8), true, '下界可到')
  assert.equal(actionFontSizeApplies(7), false, '低于 8 不应用 —— 所以 8 再按减小会被拒')
})

test('步进：区间内出下一步，越界返回 null（enabled 为假）', () => {
  assert.equal(stepEditorFontSize(14, 1), 15)
  assert.equal(stepEditorFontSize(14, -1), 13)
  assert.equal(stepEditorFontSize(40, 1), null, '顶到上限就不再动')
  assert.equal(stepEditorFontSize(8, -1), null, '到 8 就不再往下（不会走到设置页允许的 4）')
})

test('从设置页写进来的低值：动作按**目标值**判，5 也不应用', () => {
  // 上游先算 size = 当前 + step 再判门槛，所以 4 按增大得 5 不满足 `>= 8` ⇒ 不动。
  // 这条把"判目标值而不是当前值"钉住，免得被误改成 `current >= 8` 那种读法。
  assert.equal(stepEditorFontSize(4, 1), null, '目标 5 < 8 ⇒ 不应用')
  assert.equal(stepEditorFontSize(6, 1), null, '目标 7 < 8 ⇒ 不应用')
  assert.equal(stepEditorFontSize(7, 1), 8, '目标 8 ⇒ 应用')
})

test('接线：三处 UI 与原生校验都用同一对边界，不再各写一个数', () => {
  const view = read('src/menus/viewMenu.ts')
  assert.match(view, /import \{ stepEditorFontSize \} from '\.\.\/editorFontSize\.ts'/, '菜单没走共享边界')
  assert.match(view, /stepEditorFontSize\(ctx\.editorSettings\.value\.fontSize, 1\)/, '增大没用共享步进')
  assert.match(view, /stepEditorFontSize\(ctx\.editorSettings\.value\.fontSize, -1\)/, '减小没用共享步进')
  assert.ok(!/fontSize < 32|fontSize > 10/.test(view), '旧写死的 10–32 必须消失')

  const settings = read('src/components/SettingsDialog.vue')
  assert.match(settings, /import \{ MAX_EDITOR_FONT_SIZE, MIN_EDITOR_FONT_SIZE \} from '\.\.\/editorFontSize\.ts'/,
    '设置页没走共享边界')
  assert.match(settings, /editor\.value\.fontSize >= MIN_EDITOR_FONT_SIZE && editor\.value\.fontSize <= MAX_EDITOR_FONT_SIZE/,
    '设置页校验没走共享边界')
  assert.ok(!/fontSize >= 10 && editor\.value\.fontSize <= 32/.test(settings), '旧写死的校验必须消失')
  // 提示文字里那句"待核"应当已经被核实来源替换掉
  assert.ok(!settings.includes('尚未核实'), '字体大小的"待核"注释应已换成核实过的出处')

  const welcome = read('src/components/WelcomePage.vue')
  assert.match(welcome, /clampEditorFontSize\(/, '欢迎页没走共享夹取')
  assert.match(welcome, /:min="MIN_EDITOR_FONT_SIZE" :max="MAX_EDITOR_FONT_SIZE"/, '欢迎页 input 没走共享边界')
  assert.ok(!/Math\.min\(32, Math\.max\(10,/.test(welcome), '旧的 10–32 夹取必须消失')

  const schema = read('native/settings_schema.cpp')
  assert.match(schema, /value < 4 \|\| value > 40/, '原生校验没跟着改')
  assert.match(schema, /fontSize must be an integer from 4 through 40/, '原生错误文案没跟着改')
  assert.ok(!schema.includes('from 10 through 32'), '旧的原生文案必须消失')
})

test('原生边界用例跟着移到 [4, 40] 的边界值', () => {
  const test_cpp = read('native/projects_test.cpp')
  assert.match(test_cpp, /\{\{"fontSize", 4\}, \{"tabSize", 2\}\}/, '下界用例应改成 4')
  assert.match(test_cpp, /\{\{"fontSize", 3\}\}, \{\{"fontSize", 41\}\}/, '越界用例应改成 3 与 41')
  assert.ok(!/\{\{"fontSize", 9\}\}, \{\{"fontSize", 33\}\}/.test(test_cpp), '旧的 9/33 越界用例必须消失')
})
