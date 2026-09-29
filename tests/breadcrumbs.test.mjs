import test from 'node:test'
import assert from 'node:assert/strict'
import { EDITOR_LANGUAGES, breadcrumbsShownFor, defaultEditorSettings, normalizeEditorSettings } from '../src/bridge.ts'

// EditorSettingsExternalizable.OptionSet:91-92 —— SHOW_BREADCRUMBS = true、
// SHOW_BREADCRUMBS_ABOVE = false，所以默认显示且位置在下方。
test('breadcrumbs default to shown below the editor', () => {
  assert.equal(defaultEditorSettings.showBreadcrumbs, true)
  assert.equal(defaultEditorSettings.breadcrumbsPlacement, 'bottom')
  assert.deepEqual(defaultEditorSettings.breadcrumbsLanguages, {}, 'no language is configured out of the box')
})

// isBreadcrumbsShownFor(:459-466)：表里没有这个语言就走默认，未知语言也默认显示。
test('a language that was never configured shows breadcrumbs', () => {
  const settings = { breadcrumbsLanguages: {} }
  for (const language of EDITOR_LANGUAGES) assert.equal(breadcrumbsShownFor(settings, language), true, language)
  assert.equal(breadcrumbsShownFor(settings, 'kotlin'), true, 'an unknown language is visible by default')
})

test('an explicitly configured language follows the stored flag', () => {
  const settings = { breadcrumbsLanguages: { java: false, cpp: true } }
  assert.equal(breadcrumbsShownFor(settings, 'java'), false)
  assert.equal(breadcrumbsShownFor(settings, 'cpp'), true)
  assert.equal(breadcrumbsShownFor(settings, 'typescript'), true, 'unlisted languages keep the default')
})

// 旧版本把「不显示」编码成 breadcrumbsPlacement: 'disabled'；源码里位置只有上下两个值。
test('the legacy disabled placement migrates into the two-key shape', () => {
  const legacy = { ...defaultEditorSettings, showBreadcrumbs: true, breadcrumbsPlacement: 'disabled' }
  const migrated = normalizeEditorSettings(legacy)
  assert.equal(migrated.showBreadcrumbs, false, 'the legacy value means "do not show"')
  assert.equal(migrated.breadcrumbsPlacement, 'bottom', 'and it must not leave an invalid placement behind')
  assert.equal(legacy.breadcrumbsPlacement, 'disabled', 'the input object is not mutated')
})

test('a valid placement is passed through untouched', () => {
  const top = { ...defaultEditorSettings, breadcrumbsPlacement: 'top' }
  assert.equal(normalizeEditorSettings(top), top, 'the same object comes back, no copy needed')
})
