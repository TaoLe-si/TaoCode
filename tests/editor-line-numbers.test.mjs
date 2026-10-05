// 行号排法（上游 `EditorSettingsExternalizable.LINE_NUMERATION` =
// `LineNumerationType`，UI 在 `EditorAppearanceConfigurable.kt:118-124`）的判据。
//
// 三层：
//   ① 纯转换 `lineNumberText`：绝对/相对/混合（相对取 |距离|，混合的光标行显示绝对行号）；
//   ② 折叠感知 `hiddenLineCount`：折叠藏起来的行不计数（照 `RelativeLineHelper.getRelativeLine`）；
//   ③ 设置端到端：键在 settingsModel / previewSettings / native 白名单 / native 默认值四处都在
//      （tests/settings-keys-parity.test.mjs 的反面清单），CodeEditor 把它接进 options compartment。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { codeFolding, foldEffect } from '@codemirror/language'
import { hiddenLineCount, lineNumberText, normalizeLineNumeration } from '../src/editorLineNumbers.ts'

test('绝对：原样显示', () => {
  assert.equal(lineNumberText(1, 5, 'absolute'), '1')
  assert.equal(lineNumberText(5, 5, 'absolute'), '5')
})

test('相对：|行号 - 光标行|（上游 RelativeLineNumberConverter 取 abs），光标行 0', () => {
  assert.equal(lineNumberText(1, 5, 'relative'), '4')
  assert.equal(lineNumberText(5, 5, 'relative'), '0')
  assert.equal(lineNumberText(9, 5, 'relative'), '4', '下方也是正的距离')
})

test('混合：光标行绝对、其余相对（上游 HybridLineNumberConverter）', () => {
  assert.equal(lineNumberText(5, 5, 'hybrid'), '5')
  assert.equal(lineNumberText(2, 5, 'hybrid'), '3')
})

test('折叠藏起来的行不计数（RelativeLineHelper.getRelativeLine 的折叠扣减）', () => {
  const doc = 'a\nb\nc\nd\ne\nf\ng'
  const state = EditorState.create({ doc, extensions: [codeFolding()] })
  assert.equal(hiddenLineCount(state, 1, 7), 0, '没有折叠时就是距离本身')
  // 折起第 3–5 行（第 3 行的行尾到第 5 行的行尾）：第 4、5 行被藏起来。
  const folded = state.update({ effects: foldEffect.of({ from: state.doc.line(3).to, to: state.doc.line(5).to }) }).state
  assert.equal(hiddenLineCount(folded, 1, 7), 2, '1→7 之间有 2 行被藏')
  assert.equal(hiddenLineCount(folded, 3, 6), 2, '折叠起点行仍可见，藏的是第 4、5 行（2 行）')
  assert.equal(lineNumberText(7, 1, 'relative', hiddenLineCount(folded, 7, 1)), '4', '显示 6 - 2 = 4')
})

test('设置值归一化：认不出的按 absolute（上游默认 ABSOLUTE）', () => {
  assert.equal(normalizeLineNumeration('relative'), 'relative')
  assert.equal(normalizeLineNumeration('hybrid'), 'hybrid')
  assert.equal(normalizeLineNumeration('absolute'), 'absolute')
  assert.equal(normalizeLineNumeration('RELATIVE'), 'absolute')
  assert.equal(normalizeLineNumeration(undefined), 'absolute')
})

test('设置端到端：前端默认/预览白名单/native 白名单/native 默认值四处都有 lineNumeration', () => {
  const model = readFileSync(new URL('../src/settingsModel.ts', import.meta.url), 'utf8')
  assert.match(model, /lineNumeration: 'absolute'/, 'defaultEditorSettings 里有默认值')
  assert.match(model, /lineNumeration: LineNumeration/, 'EditorSettings 接口里有这个键')
  const preview = readFileSync(new URL('../src/previewSettings.ts', import.meta.url), 'utf8')
  assert.match(preview, /key === 'lineNumeration'/)
  assert.match(preview, /\['absolute', 'relative', 'hybrid'\]\.includes/, '预览态三值校验')
  const nativeKeys = readFileSync(new URL('../native/settings_schema.hpp', import.meta.url), 'utf8')
  assert.match(nativeKeys, /"lineNumeration"/, 'native 键白名单')
  const nativeDefaults = readFileSync(new URL('../native/settings_schema.cpp', import.meta.url), 'utf8')
  assert.match(nativeDefaults, /\{"lineNumeration", "absolute"\}/, 'native 默认值')
  assert.match(nativeDefaults, /lineNumeration must be absolute, relative or hybrid/, 'native 值校验')
})

test('接线：CodeEditor 传设置、editorTheme 按模式切换两棵 gutter 的显隐', () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /lineNumeration: props\.settings\.lineNumeration/, 'options compartment 传设置')
  const theme = readFileSync(new URL('../src/editorTheme.ts', import.meta.url), 'utf8')
  assert.match(theme, /lineNumerationExtension\(input\.lineNumeration\)/)
  assert.match(theme, /'\.cm-lineNumbers': \{ display: input\.lineNumbers && !relative \? 'flex' : 'none' \}/)
  assert.match(theme, /'\.cm-relative-line-numbers': \{ display: input\.lineNumbers && relative \? 'flex' : 'none' \}/)
  const page = readFileSync(new URL('../src/components/SettingsDialog.vue', import.meta.url), 'utf8')
  assert.match(page, /v-model="editor\.lineNumeration"/, '设置页外观组有下拉')
})
