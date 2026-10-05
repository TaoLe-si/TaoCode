// 行内监视的**接线**判据（`dbg/inline` 判词缺口② `InlineWatch` 未做 → 本轮补上）：
//   · 规则层在 `src/debugInlineWatch.ts`（判据见 tests/debug-inline-watch.test.mjs，本文件不重复）；
//   · 接线层在 `src/debugInlineWatchSync.ts`：加/删、推进编辑器、会话结束清空；
//   · 编辑器侧字段在 `src/editorDebugLine.ts` 的 `inlineWatchesField` —— 挂在 CodeEditor
//     **已经装好的** `debugLineExtension` 上，所以编辑器组件本轮冻结、不改一行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { EditorState } from '@codemirror/state'
import { useInlineWatches } from '../src/debugInlineWatchSync.ts'
import { debugLineExtension, debugLineField, inlineWatchesField, setDebugLine, setInlineWatches } from '../src/editorDebugLine.ts'

/** @param {{ anchor?: { path: string, line: number } }} [opts] */
function harness(opts = {}) {
  const { anchor = { path: 'src/User.java', line: 12 } } = opts
  /** @type {import('vue').Ref<{ text: string, value: string }[]>} */
  const watches = ref([{ text: 'user.name', value: 'John' }, { text: 'user.age', value: '31 : int' }])
  let at = anchor
  const api = useInlineWatches({ watches, anchor: () => at })
  return { watches, api, move: next => { at = next } }
}

test('加/删是同一对动作：同表达式同位置再点一次就撤掉（INLINE_WATCH_LIMIT 与去重见规则层）', () => {
  const { api } = harness()
  assert.equal(api.isShown('user.name'), false)
  api.toggle('user.name')
  assert.equal(api.isShown('user.name'), true)
  assert.deepEqual(api.inlineWatches.value, [{ expression: 'user.name', path: 'src/User.java', line: 12 }])
  api.toggle('user.name')
  assert.equal(api.isShown('user.name'), false)
  assert.deepEqual(api.inlineWatches.value, [])
})

test('没停住（锚点为 null）时按了也加不上 —— 上游只在暂停时求值（InlineWatch.kt:13-16）', () => {
  const { api } = harness({ anchor: null })
  api.toggle('user.name')
  assert.deepEqual(api.inlineWatches.value, [])
  assert.equal(api.isShown('user.name'), false)
})

test('换到别的帧/别的文件后，同一条不再算「已显示」（可见性按当前锚点判定）', () => {
  const { api, move } = harness()
  api.toggle('user.name')
  move({ path: 'src/User.java', line: 30 })
  assert.equal(api.isShown('user.name'), false, '同文件不同行 ⇒ 另一条监视')
  move({ path: 'src/Other.java', line: 12 })
  assert.equal(api.isShown('user.name'), false, '别的文件 ⇒ 不在暂停的那个文件里')
})

test('空表达式不产生监视（规则层 normalizeInlineWatch 的同一道门）', () => {
  const { api } = harness()
  api.toggle('   ')
  assert.deepEqual(api.inlineWatches.value, [])
})

test('CodeMirror 状态机：行内监视与执行行是两个独立字段，推进只改自己那个', () => {
  let state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: [debugLineExtension] })
  assert.equal(state.field(debugLineField), 0)
  assert.deepEqual(state.field(inlineWatchesField), { path: '', items: [] })
  state = state.update({ effects: setDebugLine.of(3) }).state
  // 监视锚在第 1 行（≠ 执行行 3）—— 上游按 position 锚定，与执行行无关
  state = state.update({ effects: setInlineWatches.of({ path: 'a.java', items: [{ line: 1, text: 'a = 1' }] }) }).state
  assert.equal(state.field(debugLineField), 3)
  assert.deepEqual(state.field(inlineWatchesField).items, [{ line: 1, text: 'a = 1' }])
  // 同一个 state 上再推行内值，两者互不覆盖
  assert.deepEqual(state.field(inlineWatchesField).path, 'a.java')
})

test('挂点在 CodeEditor 已经在用的 debugLineExtension 里，编辑器组件一行没改', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  assert.match(editor, /import \{ debugLineExtension, syncDebugLine \} from '\.\.\/editorDebugLine'/,
    '编辑器仍只 import 这两个符号 —— 新字段随整个扩展数组进去，不需要碰组件')
  assert.doesNotMatch(editor, /inlineWatches/, '编辑器组件里不该出现任何行内监视的字样')
  const line = readFileSync('src/editorDebugLine.ts', 'utf8')
  const extension = /export const debugLineExtension: Extension = \[([^\]]*)\]/.exec(line)
  assert.ok(extension, 'debugLineExtension 必须是数组字面量')
  for (const field of ['debugLineField', 'inlineValuesField', 'inlineWatchesField'])
    assert.ok(extension[1].includes(field), `${field} 必须在扩展数组里，否则 state.field 会抛`)
})

test('面板接线：每停一次推进一次、继续/会话结束/卸载都清空', () => {
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /const inlineWatches = useInlineWatches\(\{/)
  assert.match(panel, /return stopped\.value && frame && path \? \{ path, line: frame\.line \} : null/,
    '锚点是当前帧；没停住就没有锚点')
  assert.match(panel, /inlineWatches\.sync\(\)\s*\/\/ 行内监视的文本就是这一轮算出的值/, 'refreshWatches 末尾推进')
  assert.match(panel, /frames\.value = \[\]; setDebugInlineValues\(null\); inlineWatches\.clear\(\) \}/, '继续时清空')
  assert.match(panel, /selectedFrameIndex\.value = 0; setDebugInlineValues\(null\); inlineWatches\.clear\(\) \}/, '会话结束清空')
  assert.match(panel, /setDebugInlineValues\(null\); inlineWatches\.clear\(\) \}\)/, '面板卸载清空')
  assert.match(panel, /@click\.stop="inlineWatches\.toggle\(watch\.text\)"/, '监视行上那个眼睛按钮就是加/删入口')
})

test('文件判据：编辑器视图没有路径，本仓用「这个视图有执行行」当下界（App.vue:1133 只给暂停文件发 debugLine）', () => {
  const line = readFileSync('src/editorDebugLine.ts', 'utf8')
  assert.match(line, /if \(state\.field\(debugLineField\) < 1\) return Decoration\.none/,
    '没执行行 ⇒ 那个文件不是暂停文件，不画行内监视')
  // RangeSetBuilder 要求区间升序 —— 插入顺序不能当行号顺序用。
  assert.match(line, /\[\.\.\.byLine\.keys\(\)\]\.sort\(\(a, b\) => a - b\)/)
})
