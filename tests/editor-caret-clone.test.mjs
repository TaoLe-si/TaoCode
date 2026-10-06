// 克隆光标上/下（上游 `EditorCloneCaretAbove` / `EditorCloneCaretBelow`）的判据。
// 规则来源：`CloneCaretActionHandler.java:64-101`（层级：同一个键继续往外扩、反方向收回最外圈）
// 与 `CaretImpl.java:845-893`（越界返回 null、列位按目标行截断、选区两端各挪一行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorSelection, EditorState } from '@codemirror/state'
import { MAX_CARET_COUNT, cloneCaretPlan, lineAt, offsetAtColumn } from '../src/editorCaretClone.ts'
import { editingCommands } from '../src/editorCommands.ts'

const DOC = 'aaaa\nbbbbb\ncc\ndddd'

function linesOf(doc) {
  const lineStarts = []
  const lineEnds = []
  let at = 0
  for (const line of doc.split('\n')) {
    lineStarts.push(at)
    lineEnds.push(at + line.length)
    at += line.length + 1
  }
  return { lineStarts, lineEnds }
}

function input(doc, ranges, mainIndex, above) {
  const { lineStarts, lineEnds } = linesOf(doc)
  return { ranges, mainIndex, lineStarts, lineEnds, above }
}

const cursor = offset => ({ anchor: offset, head: offset })
const heads = plan => plan.ranges.map(range => range.head)

function run(name, selection, doc = DOC) {
  // CodeMirror 默认**不允许**多光标（`EditorState.allowMultipleSelections` 默认 false），真实的编辑器
  // 实例在 CodeEditor.vue 里开了这一档；测试不开就只会拿到一条光标，判据测不到东西。
  let state = EditorState.create({
    doc, selection, extensions: [EditorState.allowMultipleSelections.of(true)],
  })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: editingCommands[name](view), heads: state.selection.ranges.map(range => range.head), main: state.selection.main.head }
}

test('行号换算与列位截断（CaretImpl.java:871-872 的 truncate）', () => {
  const { lineStarts, lineEnds } = linesOf(DOC)
  assert.equal(lineAt(lineStarts, 0), 0)
  assert.equal(lineAt(lineStarts, 5), 1)
  assert.equal(lineAt(lineStarts, 12), 2)
  assert.equal(offsetAtColumn(lineStarts, lineEnds, 2, 1), 12)
  assert.equal(offsetAtColumn(lineStarts, lineEnds, 2, 9), 13, 'cc 这一行只有两个字符 ⇒ 贴到行尾')
})

test('单个光标 ⇒ 在上行同列加一个光标，焦点交给新克隆出来的（addCaret(clone, true)）', () => {
  const plan = cloneCaretPlan(input(DOC, [cursor(12)], 0, true))
  assert.deepEqual(heads(plan), [6, 12], '第 2 行第 1 列 ⇒ 第 1 行第 1 列')
  assert.equal(plan.mainIndex, 0)
})

test('越界停止：第一行再按「上行」什么都不做（CaretImpl.java:850-852 返回 null）', () => {
  assert.equal(cloneCaretPlan(input(DOC, [cursor(1)], 0, true)), null)
  assert.equal(cloneCaretPlan(input(DOC, [cursor(14)], 0, false)), null, '最后一行再按「下行」同理')
})

test('目标行更短 ⇒ 光标贴到那一行的行尾（truncate，不是把列位重新按行长算）', () => {
  const plan = cloneCaretPlan(input('abcdef\nx\n', [cursor(4)], 0, false))
  assert.deepEqual(heads(plan), [4, 8], '第 1 行只有一个字符 ⇒ 落在行尾')
})

test('选区跟着一起克隆：两端各挪一行（CaretImpl.java:861-877）', () => {
  const plan = cloneCaretPlan(input('abcdef\nghijkl\n', [{ anchor: 2, head: 5 }], 0, false))
  assert.deepEqual(plan.ranges, [{ anchor: 2, head: 5 }, { anchor: 9, head: 12 }])
})

test('重复按同一个键：每次只往外扩一圈，不是把每个光标再复制一份', () => {
  const one = cloneCaretPlan(input(DOC, [cursor(14)], 0, true))
  assert.deepEqual(heads(one), [11, 14])
  const two = cloneCaretPlan(input(DOC, one.ranges, one.mainIndex, true))
  assert.deepEqual(heads(two), [5, 11, 14])
  const three = cloneCaretPlan(input(DOC, two.ranges, two.mainIndex, true))
  assert.deepEqual(heads(three), [0, 5, 11, 14])
  assert.equal(three.mainIndex, 0)
})

test('反方向再按一次 = 收回最外圈（CloneCaretActionHandler.java:76-81 的 removeCarets）', () => {
  const two = cloneCaretPlan(input(DOC, [cursor(14)], 0, true))
  const three = cloneCaretPlan(input(DOC, two.ranges, two.mainIndex, true))
  assert.deepEqual(heads(three), [5, 11, 14], '一路往上：三圈')
  const back = cloneCaretPlan(input(DOC, three.ranges, three.mainIndex, false))
  assert.deepEqual(heads(back), [11, 14], '按「下行」不是往下长，而是把最上面那圈（第 0 行）收掉')
  assert.equal(back.mainIndex, 0, '主光标交给剩下的最外圈')
  const backAgain = cloneCaretPlan(input(DOC, back.ranges, back.mainIndex, false))
  assert.deepEqual(heads(backAgain), [14], '继续按就逐圈收回去')
  assert.equal(cloneCaretPlan(input(DOC, backAgain.ranges, backAgain.mainIndex, false)), null, '只剩一个光标时不再是链 ⇒ 按普通克隆往下走，最后一行没有行可克隆')
})

test('一路往下是同一条规则的镜像（第 4 行存在时才长得出去）', () => {
  const tall = 'aaaa\nbbbbb\ncc\ndddd\neeeee'
  const plan = cloneCaretPlan(input(tall, [cursor(11)], 0, false))
  assert.deepEqual(heads(plan), [11, 14], '第 2 行往下克隆到第 3 行（同列）')
  const more = cloneCaretPlan(input(tall, plan.ranges, plan.mainIndex, false))
  assert.deepEqual(heads(more), [11, 14, 19], '一路往下：三圈')
  assert.equal(more.mainIndex, 2)
})

test('不是克隆链（行号不连续）⇒ 当首次调用：每个光标各克隆一次（:66-75 的 level 全 0）', () => {
  const plan = cloneCaretPlan(input('a\nb\nc\nd\ne\nf\ng\n', [cursor(0), cursor(6)], 1, true))
  assert.deepEqual(heads(plan), [0, 4, 6], '第 0 行越界 ⇒ 只有第 3 行那个光标克隆到了第 2 行')
})

test('主光标在链中间 ⇒ 不认成克隆链（没有「最外圈」可收）', () => {
  const plan = cloneCaretPlan(input(DOC, [cursor(5), cursor(11), cursor(14)], 1, true))
  assert.deepEqual(heads(plan), [0, 5, 11, 14], '按「上行」时三个光标各克隆一次：只有第 1 行长出了第 0 行')
  assert.equal(plan.mainIndex, 0, '主光标 = 最后加进来的那一个')
})

test('光标数上限：到顶就不再新增（editor.max.caret.count 默认 1000）', () => {
  assert.equal(MAX_CARET_COUNT, 1000)
  const plan = cloneCaretPlan({ ...input(DOC, [cursor(14)], 0, true), maxCarets: 2 })
  assert.deepEqual(heads(plan), [11, 14])
  assert.equal(cloneCaretPlan({ ...input(DOC, plan.ranges, plan.mainIndex, true), maxCarets: 2 }), null)
})

test('命令：走的是命令表里的 cursor.above / cursor.below（键位按上游摘掉后，入口 = 命令表 + 菜单行）', () => {
  const up = run('cursor.above', EditorSelection.create([EditorSelection.cursor(14)]))
  assert.equal(up.ran, true)
  assert.deepEqual(up.heads, [11, 14])
  assert.equal(up.main, 11, '焦点交给新克隆出来的那个')
  const down = run('cursor.below', EditorSelection.create([EditorSelection.cursor(14)]))
  assert.equal(down.ran, false, '最后一行往下没有行可克隆')
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  // R3 判决（2026-10-06 keymap2）：这两把键的上游主人是 `ResizeToolWindowUp`/`ResizeToolWindowDown`
  // （platform/platform-resources/src/keymaps/$default.xml:879-884），而 `EditorCloneCaretAbove`/
  // `EditorCloneCaretBelow` 在 `$default.xml` 里零命中（注册处
  // platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219，实现类
  // platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretAbove.java:8-11 也不声明键位）
  // ⇒ 编辑器 keymap 里再绑一次就是抢工具窗口的键。**原写法是 `assert.match`**（钉着那两行绑定存在），
  // 它钉的是「与上游不同键位」的假一致形状，故按上游改成反向钉子：键位回潮就红，不算放松断言。
  assert.doesNotMatch(editor, /key: 'Ctrl-Alt-Shift-Up'/, 'Ctrl+Alt+Shift+↑ 属 ResizeToolWindowUp，不许回到编辑器 keymap')
  assert.doesNotMatch(editor, /key: 'Ctrl-Alt-Shift-Down'/, 'Ctrl+Alt+Shift+↓ 属 ResizeToolWindowDown，同上')
  // 摘键 ≠ 删命令：命令表里两条还在，菜单行的键位栏是空串（上游也是只有动作没有键）。
  const commands = readFileSync('src/editorCommands.ts', 'utf8')
  assert.match(commands, /'cursor\.above': cloneCaretAboveCommand, 'cursor\.below': cloneCaretBelowCommand/)
  const menu = readFileSync('src/menus/editMenu.ts', 'utf8')
  assert.match(menu, /ctx\.editable\('cursor\.above', '在上行添加光标', ''/)
  assert.match(menu, /ctx\.editable\('cursor\.below', '在下行添加光标', ''/)
})

test('命令：多光标（选区）也能克隆，且不会造出重叠的 selection', () => {
  const doc = 'abcdefgh\nijklmnop\nqrstuvwx\n'
  const first = run('cursor.below', EditorSelection.create([EditorSelection.range(2, 5)]), doc)
  assert.equal(first.ran, true)
  assert.deepEqual(first.heads, [5, 14], '选区尾巴那一端挪到下一行的同列')
})

test('落点留痕：模块头引了 CloneCaretActionHandler / CaretImpl / 动作注册 / 文案（不然下次又被当成"IDEA 一般是…"）', () => {
  const src = readFileSync('src/editorCaretClone.ts', 'utf8')
  assert.match(src, /CloneCaretActionHandler\.java/)
  assert.match(src, /CaretImpl\.java:845-893/)
  assert.match(src, /intellij\.platform\.ide\.impl\.actions\.xml:218-219/)
  assert.match(src, /ActionsBundle\.properties:119-122/)
  assert.match(src, /registry\.properties:484/)
})
