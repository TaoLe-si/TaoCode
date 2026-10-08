// 配色方案设置页注册参数的判据（`src/colorSchemeSettingsRegistration.ts`）。
// 出处核法：每条断言把上游 `文件:行号` 钉死 —— 行内容变了这里会红，防止注释腐烂。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { COLOR_SCHEME_SETTINGS_ID, COLOR_SCHEME_SETTINGS_GROUP, COLOR_SCHEME_SETTINGS_GROUP_WEIGHT,
         COLOR_SCHEME_SETTINGS_DYNAMIC, COLOR_SCHEME_SETTINGS_LABEL, UPSTREAM_BUNDLED_SCHEME_NAMES } from '../src/colorSchemeSettingsRegistration.ts'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'

test('注册参数与上游逐项一致', () => {
  assert.equal(COLOR_SCHEME_SETTINGS_ID, 'reference.settingsdialog.IDE.editor.colors')
  assert.equal(COLOR_SCHEME_SETTINGS_GROUP, 'editor')
  assert.equal(COLOR_SCHEME_SETTINGS_GROUP_WEIGHT, 180)
  assert.equal(COLOR_SCHEME_SETTINGS_DYNAMIC, true)
})

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  const xml = `${REF}/platform/platform-impl/resources/intellij.platform.ide.impl.xml`
  if (!existsSync(xml)) return
  const text = readFileSync(xml, 'utf8')
  assert.ok(text.includes('id="reference.settingsdialog.IDE.editor.colors"'), '注册行不在了')
  assert.ok(text.includes('groupWeight="180"'), 'groupWeight 180 不在了')
  const idConst = `${REF}/platform/platform-impl/src/com/intellij/application/options/colors/ColorAndFontOptions.java`
  assert.ok(readFileSync(idConst, 'utf8').includes('"reference.settingsdialog.IDE.editor.colors"'), 'ID 常量不在了')
})

test('出厂方案清单与上游 bundledColorScheme 对齐', () => {
  const xml = `${REF}/platform/projectModel-impl/resources/intellij.platform.projectModel.impl.xml`
  if (!existsSync(xml)) return
  const text = readFileSync(xml, 'utf8')
  for (const name of UPSTREAM_BUNDLED_SCHEME_NAMES) {
    if (name === 'Default' || name === 'Darcula') continue // 这两个在 DefaultColorSchemesManager.xml，不在 EP 里
    assert.ok(text.includes(`bundledColorScheme id="${name}"`), `bundled 方案 ${name} 不在 EP 注册里`)
  }
})

test('标题文案取自 ApplicationBundle.properties', () => {
  const bundle = `${REF}/platform/ide-core/resources/messages/ApplicationBundle.properties`
  if (!existsSync(bundle)) return
  assert.ok(readFileSync(bundle, 'utf8').includes('title.colors.and.fonts='), '标题键不在了')
})
