// 每一次内容变更（含撤销）都必须通知宿主 —— 机检。
//
// 起因（第六十七批的探针）：Ctrl+Z 那一下没有产生书签对账记录，要等"撤销之后的下一次内容
// 变更"才看到放回。查下来是这条闸门：`emit('change')` 被 `if (!dirty)` 挡住，只在"变脏那一拍"
// 发一次 —— 而挂在 `change` 上的东西不止脏标记：书签对账（上游 BookmarkManager 监听的是
// **每个**文档变更）、断点位置缓存失效、最近更改位置、markdown 预览刷新、草稿与自动保存重排。
// 第二个编辑之后它们全都不再跑，撤销只是最容易看见的那一种。
//
// 撤销本身**是**一次带 changes 的事务：CodeMirror 6.11.1 的 history `pop`
// （node_modules/@codemirror/commands/dist/index.js:548-556）派发
// `state.update({ changes: event.changes, …, userEvent: "undo" })` —— 所以 `update.docChanged`
// 为真，闸门才是唯一致命的点。这组断言守两件事：① 闸门不许再出现；② 宿主侧那条幂等性前提
// （重复通知不会造成重复记录）还成立。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n')
const editor = read('src/components/CodeEditor.vue')

/** updateListener 里那一段 `if (update.docChanged …) { … }`（到本行结束）。 */
function docChangedLine() {
  const lines = editor.split('\n').filter(line => line.includes('if (update.docChanged && !replacing)'))
  assert.equal(lines.length, 1, '变化通知那段应当只有一处')
  return lines[0]
}

test('每次 docChanged 都通知宿主，不再被"变脏那一拍"挡住', () => {
  const line = docChangedLine()
  assert.match(line, /emit\('change'\)/, '这段必须通知宿主')
  assert.doesNotMatch(line, /if \(!dirty\)/, '`emit(\'change\')` 不许再被 `!dirty` 包住')
  // 同一条闸门的老写法（`dirty = true` 与 emit 绑在一起）也要绝迹。
  assert.equal((editor.match(/let dirty = false/g) ?? []).length, 0, '组件里那个只服务于闸门的状态应当已删除')
  assert.equal((editor.match(/markSaved/g) ?? []).length, 0, 'markSaved 只服务于那个状态，应当已删除')
})

test('撤销是带 changes 的事务：CodeMirror 的 history.pop（本仓依赖的版本）', () => {
  const commands = read('node_modules/@codemirror/commands/dist/index.js')
  const pop = commands.slice(commands.indexOf('    pop(side, state, onlySelection) {'), commands.indexOf('    pop(side, state, onlySelection) {') + 2200)
  assert.match(pop, /changes: event\.changes/, 'undo 派发的事务要带 changes（docChanged 才会为真）')
  assert.match(pop, /userEvent: side == 0 \/\* BranchName\.Done \*\/ \? "undo" : "redo"/, 'undo 的 userEvent 形状')
})

test('宿主侧对重复通知幂等：最近更改位置按文件+行去重', () => {
  // 2026-10-06：两条最近位置环与 `rememberPlace` 整段搬到 src/appPlacesRing.ts（逐字等价），
  // 读取面带上那一半；下面那条断言本体一字未改。
  const app = read('src/App.vue') + '\n' + read('src/appPlacesRing.ts')
  const start = app.indexOf('function rememberPlace(place: Place) {')
  assert.ok(start >= 0, '找不到 rememberPlace')
  const body = app.slice(start, start + 600)
  assert.match(body, /item\.path === place\.path && item\.line === place\.line/, '重复的行不该在最近更改里堆两条')
})

test('清空编辑器的 setDraft 不通知宿主（程序化加载不算用户编辑）', () => {
  const line = docChangedLine()
  assert.match(line, /!replacing/, '程序化替换期间不该通知宿主')
})
