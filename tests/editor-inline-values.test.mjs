// 行内调试值（xdebugger `dbg/inline`，上游 `XDebuggerInlineValuesProvider`/`InlineDebugRenderer`）的判据。
//
// 两层：
//   ① 纯规则 `src/inlineDebugValues.ts`：整词匹配、名字=值跳过、每行/每值上限、行号 1 基；
//   ② 接线：`CodeEditor.vue` 的 enabled 门（暂停 + 当前位置就是本文件 + 非大文件）与
//      `dapState` watcher（会话/停点/线程/文件任一变化就重取），DAP 拉取在 `src/editorInlineValues.ts`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectInlineValues, inlineVariableOf, INLINE_VALUE_MAX_PER_LINE, INLINE_VALUE_MAX_TEXT,
} from '../src/inlineDebugValues.ts'

const variable = (name, value, overrides = {}) => ({ name, value, reference: 0, named: true, ...overrides })

test('整词匹配：只在用到变量名的行产出，大小写敏感，子串不算', () => {
  const lines = ['let total = 0', '  subtotal = 1', '// total 出现在注释里也算使用', 'nothing here']
  const entries = collectInlineValues(lines, [{ name: 'total', value: '42' }])
  assert.deepEqual(entries, [
    { line: 1, text: 'total = 42' },
    { line: 3, text: 'total = 42' },
  ], '第 2 行的 subtotal 不算整词 total；第 4 行没出现变量名就不贴')
  assert.deepEqual(collectInlineValues(['TOTAL = 1'], [{ name: 'total', value: '42' }]), [], '大小写敏感')
})

test('一行多条值按出现顺序、去重、封顶；值超长截断', () => {
  const entries = collectInlineValues(['b a b a'], [
    { name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' },
  ])
  assert.deepEqual(entries, [{ line: 1, text: 'b = 2   a = 1' }], '按行内出现顺序去重，超过上限的 c 不出现')
  const many = collectInlineValues(['a b c d'], [variable('a', '1'), variable('b', '2'), variable('c', '3'), variable('d', '4')])
  assert.equal(many[0].text.split('   ').length, INLINE_VALUE_MAX_PER_LINE, `单行最多 ${INLINE_VALUE_MAX_PER_LINE} 条`)
  const long = collectInlineValues(['x'], [{ name: 'x', value: 'y'.repeat(200) }])
  assert.equal(long[0].text.length, 'x = '.length + INLINE_VALUE_MAX_TEXT)
  assert.ok(long[0].text.endsWith('…'))
})

test('无信息量的值不显示：名字=值、空值、缺名字；空变量表直接空', () => {
  assert.equal(inlineVariableOf(variable('i', 'i')), null)
  assert.equal(inlineVariableOf(variable('i', '  ')), null)
  assert.equal(inlineVariableOf({ name: '', value: '1', reference: 0, named: true }), null)
  assert.deepEqual(inlineVariableOf(variable('i', '3', { type: 'int' })), { name: 'i', value: '3', type: 'int' })
  assert.deepEqual(collectInlineValues(['i'], []), [])
})

test('接线：CodeEditor 用 dapState 的暂停/位置门 + 该状态变化就重取', async () => {
  const editor = readFileSync(new URL('../src/components/CodeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /import \{ createInlineValues \} from '\.\.\/editorInlineValues'/)
  assert.match(editor, /createInlineValues\(\{ enabled: \(\) => !heavy && dapState\.paused && dapState\.currentLocation\?\.path === props\.path/, 'enabled 门：暂停 + 当前位置是本文件 + 非大文件')
  assert.match(editor, /dapState\.running, dapState\.paused, dapState\.threadId, dapState\.currentLocation\?\.path, dapState\.currentLocation\?\.line, props\.path[\s\S]{0,60}inlineValues\.refresh\(\)/, 'watcher 覆盖会话/停点/线程/文件')
  assert.match(editor, /inlineValues\.extension,/, '扩展挂进编辑器')
  const layer = readFileSync(new URL('../src/editorInlineValues.ts', import.meta.url), 'utf8')
  for (const method of ['dapStackTrace', 'dapScopes', 'dapVariables']) assert.match(layer, new RegExp(method), `数据来自 DAP 的 ${method}`)
  assert.match(layer, /frames\[0\]/, '用栈顶帧（与 DebugPanel 的默认选中帧一致）')
})
