import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { showPanel } from '@codemirror/view'
import { containsBidirectionalText, showBidiNotification, BIDI_NOTIFICATION_KEY } from '../src/bidiNotification.ts'
import { bidiNotificationExtension } from '../src/editorBidiNotification.ts'
import { defaultEditorSettings } from '../src/bridge.ts'

test('bidi detection includes RTL scripts and explicit direction controls', () => {
  for (const text of ['hello שלום', 'مرحبا', '\u202eabc', '\u2067abc', '\u{1e900}']) assert.equal(containsBidirectionalText(text), true)
  for (const text of ['abc', '中文', 'hello 123', '']) assert.equal(containsBidirectionalText(text), false)
  assert.equal(showBidiNotification(true, false, false), true)
  for (const flags of [[false, false, false], [true, true, false], [true, false, true]]) assert.equal(showBidiNotification(...flags), false)
})

test('editor panel is driven by live transactions and persists once bidi was encountered', () => {
  let state = EditorState.create({ doc: 'abc', extensions: [bidiNotificationExtension(() => {})] })
  assert.equal(state.facet(showPanel).filter(Boolean).length, 0)
  state = state.update({ changes: { from: 3, insert: 'שלום' } }).state
  assert.equal(state.facet(showPanel).filter(Boolean).length, 1)
  state = state.update({ changes: { from: 3, to: state.doc.length } }).state
  assert.equal(state.facet(showPanel).filter(Boolean).length, 1)
})

test('application-wide do-not-show suppresses new editor notifications', () => {
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem: key => key === BIDI_NOTIFICATION_KEY ? 'true' : null }
  try {
    const state = EditorState.create({ doc: 'שלום', extensions: [bidiNotificationExtension(() => {})] })
    assert.equal(state.facet(showPanel).filter(Boolean).length, 0)
  } finally { globalThis.localStorage = previous }
})

test('direction change uses shared settings persistence; sticky defaults are five on both sides', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(editor, /bidiNotificationExtension\(direction => emit\('bidiDirection', direction\)\)/)
  assert.match(app, /@bidi-direction="direction => saveSettingsPatch\(\{ bidiTextDirection: direction \}\)"/)
  assert.equal(defaultEditorSettings.stickyLinesLimit, 5)
  const native = readFileSync('native/settings_schema.cpp', 'utf8')
  assert.equal([...native.matchAll(/\{"stickyLinesLimit", (\d+)\}/g)].length, 2)
  assert.ok([...native.matchAll(/\{"stickyLinesLimit", (\d+)\}/g)].every(match => match[1] === '5'))
})
