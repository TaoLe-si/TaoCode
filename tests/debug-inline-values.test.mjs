// 行内值（`showValuesInline`）的判据：纯格式化规则 + 真正挂进 CodeEditor 已有扩展链的
// CodeMirror StateField（`src/editorDebugLine.ts` 的 `inlineValuesField`，CodeEditor 冻结，
// 但它在扩展表里已经装了同一个 `debugLineExtension`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { inlineSourceScope, inlineValueEntries, inlineValueText, INLINE_VALUE_LIMIT } from '../src/debugInlineValues.ts'
import { debugLineExtension, debugLineField, inlineValuesField, setDebugLine, setInlineValues } from '../src/editorDebugLine.ts'

const v = (name, value) => ({ name, value, reference: 0, named: true })

test('条目：跳过空名字、压平空白、超长截断、上限截断', () => {
  const entries = inlineValueEntries([v('a', '1'), v('  ', 'x'), v('b', 'line1\nline2'), v('long', 'x'.repeat(200))])
  assert.deepEqual(entries.map(entry => entry.name), ['a', 'b', 'long'])
  assert.equal(entries[1].value, 'line1 line2')
  assert.ok(entries[2].value.length <= 60)
  assert.ok(entries[2].value.endsWith('…'))
  assert.equal(inlineValueEntries([v('a', '')])[0].value, '（空）')
  assert.equal(inlineValueEntries(Array.from({ length: INLINE_VALUE_LIMIT + 4 }, (_, index) => v(`v${index}`, '1'))).length, INLINE_VALUE_LIMIT)
})

test('数据源：第一个已加载且非 expensive 的作用域；没加载就不显示（不为它单开请求）', () => {
  const scopes = [
    { name: 'Globals', reference: 9, expensive: true },
    { name: 'Locals', reference: 1, expensive: false },
  ]
  assert.equal(inlineSourceScope(scopes, { 1: [v('x', '1')] })?.name, 'Locals')
  assert.equal(inlineSourceScope(scopes, { 9: [v('g', '1')] }), undefined)
  assert.equal(inlineSourceScope([], {}), undefined)
})

test('渲染文本：`name = value` 以三个空格连接，空条目返回空串（= 不画）', () => {
  assert.equal(inlineValueText([{ name: 'a', value: '1' }, { name: 'b', value: '2' }]), 'a = 1   b = 2')
  assert.equal(inlineValueText([]), '')
})

test('CodeMirror 状态机：只有「值所属行 == 当前执行行」时才把值挂在那个字段上（渲染层同一判据）', () => {
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [debugLineExtension] })
  assert.equal(state.field(debugLineField), 0)
  assert.deepEqual(state.field(inlineValuesField), { line: 0, entries: [] })
  state = state.update({ effects: setDebugLine.of(2) }).state
  state = state.update({ effects: setInlineValues.of({ line: 2, entries: [{ name: 'x', value: '1' }] }) }).state
  assert.equal(state.field(debugLineField), 2)
  assert.deepEqual(state.field(inlineValuesField).entries, [{ name: 'x', value: '1' }])
  // 会话继续：清空推送（line 0）后不变量再次成立。
  state = state.update({ effects: setInlineValues.of({ line: 0, entries: [] }) }).state
  assert.equal(inlineValueText(state.field(inlineValuesField).entries), '')
})

test('挂点真的在 CodeEditor 的扩展表里（冻结文件不改，复用它已经在用的 debugLineExtension）', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  assert.match(editor, /import \{ debugLineExtension, syncDebugLine \} from '\.\.\/editorDebugLine'/)
  assert.match(editor, /\n\s*debugLineExtension,/)
  const line = readFileSync('src/editorDebugLine.ts', 'utf8')
  // 守意图：行内值自己的字段在扩展数组里（数组里还有别的调试字段，不钉死形状）。
  const extension = /export const debugLineExtension: Extension = \[([^\]]*)\]/.exec(line)
  assert.ok(extension)
  assert.match(extension[1], /debugLineField/)
  assert.match(extension[1], /inlineValuesField/)
  assert.match(line, /export const inlineValuesField = StateField\.define<InlineValuesState>/)
})

test('面板接线：设置打开才推送、每次 refreshStack/选帧后刷新、继续/卸载时清空', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /if \(!dataView\.value\.showValuesInline \|\| !stopped\.value\) \{ setDebugInlineValues\(null\); return \}/)
  assert.match(panel, /const entries = scope \? inlineValueEntries\(values\[scope\.reference\] \?\? \[\]\) : \[\]/)
  assert.match(panel, /setDebugInlineValues\(frame && entries\.length \? \{ line: frame\.line, entries \} : null\)/)
  assert.match(panel, /await refreshScopes\(selectedFrame\.value\?\.id\)\n\s*syncInlineValues\(\)/)
  assert.match(panel, /setDebugInlineValues\(null\); return \}/, '未停住时清空')
  assert.match(panel, /onBeforeUnmount\(\(\) => \{ if \(completionTimer !== undefined\) clearTimeout\(completionTimer\); setDebugInlineValues\(null\)/,
    '面板卸载时清空行内值（同一行后面还挂着别的清理，不必钉死）')
  assert.match(panel, /function syncInlineValues\(\)/)
})
