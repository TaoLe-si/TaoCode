import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as vue from 'vue'
import * as macros from '../src/macros.ts'
import * as actionRegistry from '../src/actionRegistry.ts'
import * as keymapEditor from '../src/keymapEditor.ts'

const source = readFileSync('src/macroHost.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function host(resolveAction = () => undefined, answers = [], confirmAnswer = true) {
  const storage = new Map()
  const notices = []
  const inserted = []
  const exports = {}
  const window = { setTimeout, clearTimeout, prompt: () => answers.shift() ?? null, confirm: () => confirmAnswer }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  // `macroHost` 现在要 import 动作注册表与键位层（宏 ⇒ 动作注册 + 重命名/删除迁键位），
  // require 桩要把它们一起喂进去，否则 `ACTIONS` 是 undefined。
  // 桩按**去掉 `.ts` 扩展名**的文件名索引：`src/macroHost.ts` 的相对 import 必须写全 `.ts`
  // （Node ESM 的判据，见 `docs/agent-playbook-parity.md`），所以这里不能拿原始 spec 查表。
  const modules = { vue, macros, actionRegistry, keymapEditor }
  new Function('require', 'exports', 'window', 'localStorage', code)(name => modules[name.split('/').pop().replace(/\.ts$/, '')], exports, window, localStorage)
  return { session: exports.createMacros({ notify: text => notices.push(text), activePath: { value: 'a.txt' }, editorFor: () => ({ insertText: text => inserted.push(text) }), resolveAction }), notices, inserted, storage }
}

test('macro playback awaits asynchronous actions before typing and protects active playback from recording', async () => {
  let finish
  const action = new Promise(resolve => { finish = resolve })
  const { session, inserted } = host(() => () => action)
  const playback = session.playMacro({ name: 'm', steps: [{ kind: 'action', id: 'open', title: 'Open' }, { kind: 'typing', text: 'after' }] })
  session.startMacroRecording()
  assert.equal(session.recording.value, false)
  assert.deepEqual(inserted, [])
  finish()
  await playback
  assert.deepEqual(inserted, ['after'])
  assert.equal(session.playing.value, false)
  session.dispose()
})

test('duplicate macro names prompt again without losing captured input', () => {
  const { session, notices } = host(undefined, ['used', 'new'])
  session.macros.value = [{ name: 'used', steps: [] }]
  session.startMacroRecording()
  session.recordTyping('hello')
  assert.match(session.recordingText.value, /hello/)
  session.stopMacroRecording()
  assert.equal(session.recording.value, false)
  assert.equal(session.macros.value.at(-1).name, 'new')
  assert.deepEqual(session.macros.value.at(-1).steps, [{ kind: 'typing', text: 'hello' }])
  assert.equal(notices.filter(text => text.includes('已保存')).length, 1)
  session.dispose()
})

test('rename to an existing name asks first: yes merges over it, no keeps both macros', () => {
  // 答"是"：旧的那个被删掉，名字并过来（上游 canRenameMacro 的 yes 分支）
  const yes = host(undefined, [], true)
  yes.session.macros.value = [
    { name: 'old', steps: [{ kind: 'typing', text: 'a' }] },
    { name: 'used', steps: [{ kind: 'typing', text: 'b' }] },
  ]
  assert.equal(yes.session.renameMacro('old', 'used'), null)
  assert.deepEqual(yes.session.macros.value.map(macro => macro.name), ['used'])
  assert.deepEqual(yes.session.macros.value[0].steps, [{ kind: 'typing', text: 'a' }])
  yes.session.dispose()

  // 答"否"：什么都不改（两个宏都还在）
  const no = host(undefined, [], false)
  no.session.macros.value = [
    { name: 'old', steps: [{ kind: 'typing', text: 'a' }] },
    { name: 'used', steps: [{ kind: 'typing', text: 'b' }] },
  ]
  assert.equal(no.session.renameMacro('old', 'used'), null)
  assert.deepEqual(no.session.macros.value.map(macro => macro.name), ['old', 'used'])
  no.session.dispose()
})

test('macro status follows action/input and uses the host recording controls', () => {
  const { session, notices } = host()
  session.startMacroRecording()
  session.recordAction({ id: 'edit.copy', title: '复制' })
  assert.match(session.recordingText.value, /复制/)
  assert.equal(notices.length, 0, 'visible recording state does not create a notification per keystroke')
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /<MacroRecordingChip :recording="recording" :text="recordingText" :stop="toggleMacroRecording"/)
  assert.match(app, /disposeMacros\(\)/)
  session.dispose()
})
