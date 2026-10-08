// 行操作一族（排序行 / 删除重复行 / 反串行 / 饥饿退格）的判据。
// 上游：`AbstractPermuteLinesHandler.java:18-101` + 三个 `permute` 实现，
// 动作注册 `intellij.platform.ide.impl.actions.xml:262-264`，菜单次序 `PlatformActions.xml:495-496`；
// 饥饿退格 `HungryBackspaceAction.java:29-50` + `CharArrayUtil.java:136-151`（`intellij.platform.ide.impl.actions.xml:177`）。
// C-6 同族的「光标处的词」三条不在本模块（已在 `src/selectWordAtCaret.ts`，判据 `select-word-at-caret.test.mjs`）：
// 这里只断言模块头把它指向那一份，防止再写第二份。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import {
  compareLinesNatural, hungryBackspace, isHungryWhitespace, lineIndexOf, permuteTargetRange,
  placePermutation, reversePermutation, shiftBackward, sortPermutation, uniquePermutation,
} from '../src/editorLineOps.ts'
import { editingCommands } from '../src/editorCommands.ts'

const startsOf = doc => {
  let at = 0
  return doc.split('\n').map(line => {
    const start = at
    at += line.length + 1
    return start
  })
}

function run(name, selection, doc) {
  let state = EditorState.create({ doc, selection })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: editingCommands[name](view), state }
}

test('无选区时作用于整篇，不是当前行（AbstractPermuteLinesHandler.java:90-91）', () => {
  assert.deepEqual(
    permuteTargetRange({ hasSelection: false, selFrom: 2, selTo: 2, lineStarts: startsOf('a\nb\nc'), textLength: 5 }),
    { startLine: 0, endLine: 2 },
  )
})

test('不足两行 ⇒ 动作不可用（:97 的 startLine < endLine）', () => {
  assert.equal(permuteTargetRange({
    hasSelection: false, selFrom: 0, selTo: 0, lineStarts: startsOf('only one line'), textLength: 13,
  }), null)
})

test('选区尾正好压在行首 ⇒ 那一行不算进来（:94-96）', () => {
  const starts = startsOf('a\nb\nc\nd')
  assert.equal(permuteTargetRange({ hasSelection: true, selFrom: 2, selTo: 4, lineStarts: starts, textLength: 8 }), null)
  assert.deepEqual(permuteTargetRange({ hasSelection: true, selFrom: 2, selTo: 5, lineStarts: starts, textLength: 8 }),
    { startLine: 1, endLine: 2 })
})

test('排序按 UTF-16 码元、大小写敏感、不 trim（SortLinesAction.java:14 的 Arrays.parallelSort）', () => {
  assert.equal(compareLinesNatural('B', 'a'), -1, '大写排在小写前面：大小写不敏感的排法会给反')
  assert.equal(compareLinesNatural(' z', 'zz'), -1, '空格(32) 比字母小：trim 过的排法会给反')
  assert.deepEqual(sortPermutation(['b', 'A', 'a']).lines, ['A', 'a', 'b'])
  assert.deepEqual(sortPermutation(['beta', 'alpha', 'gamma']).lines, ['alpha', 'beta', 'gamma'])
})

test('等值行保持原相对次序（对象数组的 parallelSort 是稳定归并 ⇒ JS 的 sort 也是稳定的）', () => {
  assert.deepEqual(sortPermutation(['x', 'x', 'y']).sources, [0, 1, 2])
  assert.deepEqual(sortPermutation(['x1', 'x0']).lines, ['x0', 'x1'])
})

test('去重：保序、留第一次出现、不排序（UniqueLinesAction.java:13-18 的 HashSet）', () => {
  const out = uniquePermutation(['b', 'a', 'b', 'a', 'c'])
  assert.deepEqual(out.lines, ['b', 'a', 'c'], '保序去重，不是排序后折叠')
  assert.deepEqual(out.sources, [0, 1, 4])
  assert.deepEqual(uniquePermutation(['A', 'a', 'A']).lines, ['A', 'a'], '整行相等才算重复：大小写敏感')
})

test('反串：整段倒序（ReverseLinesAction.java:11-19 的首尾交换）', () => {
  assert.deepEqual(reversePermutation(['a', 'b', 'c']).lines, ['c', 'b', 'a'])
  assert.deepEqual(reversePermutation(['a', 'b', 'c']).sources, [2, 1, 0])
})

test('落点：有选区 ⇒ 整块重新选中，尾到块的下一行行首（:72-76）', () => {
  const p = placePermutation(
    { lines: ['b', 'a'], starts: [0, 2], blockEnd: 3, textLength: 5, hasLineAfter: true, caret: null },
    sortPermutation(['b', 'a']),
  )
  assert.equal(p.insert, 'a\nb')
  assert.deepEqual({ anchor: p.anchor, head: p.head }, { anchor: 0, head: 4 })
})

test('落点：块就是最后一行时选区尾到文档末尾（:73 的另一支）', () => {
  const p = placePermutation(
    { lines: ['b', 'a'], starts: [0, 2], blockEnd: 3, textLength: 3, hasLineAfter: false, caret: null },
    sortPermutation(['b', 'a']),
  )
  assert.equal(p.head, 3)
})

test('落点：无选区 ⇒ 光标跟着原来那一行走，并保持行内列偏移（:77-84）', () => {
  const p = placePermutation(
    { lines: ['ccc', 'aaa'], starts: [0, 4], blockEnd: 7, textLength: 8, hasLineAfter: true, caret: { line: 0, column: 1 } },
    sortPermutation(['ccc', 'aaa']),
  )
  assert.equal(p.anchor, 5, '新行首 4 + 原列偏移 1')
  assert.equal(p.head, 5)
})

test('行号换算：偏移落在哪一行', () => {
  const starts = startsOf('ab\ncde\nf')
  assert.equal(lineIndexOf(starts, 0), 0)
  assert.equal(lineIndexOf(starts, 3), 1)
  assert.equal(lineIndexOf(starts, 8), 2)
})

test('命令：排序行（无选区 = 整篇）', () => {
  const out = run('line.sort', { anchor: 0 }, 'c\na\nb')
  assert.equal(out.ran, true)
  assert.equal(out.state.doc.toString(), 'a\nb\nc')
})

test('命令：只置换选区覆盖的那几行，块外的行不动；选区尾覆盖到块的下一行行首', () => {
  const out = run('line.sort', { anchor: 5, head: 9 }, 'HEAD\nc\nb\nTAIL')
  assert.equal(out.state.doc.toString(), 'HEAD\nb\nc\nTAIL')
  assert.equal(out.state.selection.main.from, 5, '第 1 行（c）的行首')
  assert.equal(out.state.selection.main.to, 9, 'TAIL 那一行的行首')
})

test('命令：反串行', () => {
  assert.equal(run('line.reverse', { anchor: 0 }, 'a\nb\nc').state.doc.toString(), 'c\nb\na')
})

test('命令：删除重复行 —— 保序、留第一次出现、不动块外的行', () => {
  assert.equal(run('line.unique', { anchor: 0 }, 'b\na\nb\na\nc').state.doc.toString(), 'b\na\nc')
})

test('命令：去重把块缩短之后，选区仍然盖住整块', () => {
  const out = run('line.unique', { anchor: 2, head: 8 }, 'X\nb\na\nb\nY')
  assert.equal(out.state.doc.toString(), 'X\nb\na\nY')
  assert.equal(out.state.selection.main.from, 2)
  assert.equal(out.state.selection.main.to, 6, '块后第一行（Y）的行首')
})

test('命令：单行文档（无选区）无事可做 ⇒ 返回 false，不吞键', () => {
  assert.equal(run('line.sort', { anchor: 0 }, 'single').ran, false)
})

test('命令：只读文档不改（上游是 write action，本仓按 state.readOnly 挡）', () => {
  let state = EditorState.create({ doc: 'c\na\nb', selection: { anchor: 0 }, extensions: [EditorState.readOnly.of(true)] })
  const view = { get state() { return state }, dispatch: () => { throw new Error('只读文档不该 dispatch') } }
  assert.equal(editingCommands['line.sort'](view), false)
})

test('命令：排序后光标跟着原来那一行（:77-84 的观感）', () => {
  const out = run('line.sort', { anchor: 1 }, 'ccc\naaa\nbbb')
  assert.equal(out.state.doc.toString(), 'aaa\nbbb\nccc')
  assert.equal(out.state.selection.main.head, 9, 'ccc 排到了第 3 行（行首 8）+ 原列偏移 1')
})

test('接线：三条命令在命令表里，且菜单行指向它们（有命令无入口 = 死代码）', () => {
  for (const name of ['line.sort', 'line.reverse', 'line.unique']) {
    assert.equal(typeof editingCommands[name], 'function', `命令表缺 ${name}`)
  }
  const menu = readFileSync('src/menus/editMenu.ts', 'utf8')
  for (const name of ['line.sort', 'line.reverse', 'line.unique']) {
    assert.match(menu, new RegExp(`editable\\('${name}'`), `菜单没有 ${name} 这一行`)
  }
})

test('门禁：这三行不许带没注册的加速键（$default.xml 里查不到这三条动作的绑定）', () => {
  const menu = readFileSync('src/menus/editMenu.ts', 'utf8')
  const rows = [...menu.matchAll(/editable\('(line\.sort|line\.reverse|line\.unique)', '([^']*)', '([^']*)'/g)]
  assert.equal(rows.length, 3, '三行都还在')
  const keymapFiles = ['src/keymap.ts', 'src/keymapBindings.ts', 'src/components/CodeEditor.vue'].map(f => readFileSync(f, 'utf8'))
  for (const [, name, , keys] of rows) {
    if (!keys) continue
    const dashed = keys.split(' ').join('-')
    const registered = keymapFiles.some(source => source.includes(keys) || source.includes(dashed))
    assert.ok(registered, `菜单行 ${name} 写了加速键「${keys}」，但本仓键位面里没有它`)
  }
})

test('落点留痕：模块头引了三个动作与 AbstractPermuteLinesHandler（不然下次又被当成"IDEA 一般是…"）', () => {
  const src = readFileSync('src/editorLineOps.ts', 'utf8')
  assert.match(src, /AbstractPermuteLinesHandler\.java:18-101/)
  assert.match(src, /SortLinesAction\.java:14/)
  assert.match(src, /UniqueLinesAction\.java:13-18/)
  assert.match(src, /ReverseLinesAction\.java:11-19/)
  assert.match(src, /intellij\.platform\.ide\.impl\.actions\.xml:262-264/)
  assert.match(src, /ActionsBundle\.properties:173-175/)
})

// ── 饥饿退格（`HungryBackspaceAction.java:29-50`）─────────────────────────────────────
// 上游判据只有两条：`!hasSelection && StringUtil.isWhiteSpace(text.charAt(caretOffset - 1))`
// （`:41`，空白口径 = `Strings.java:729-731` 的 `\n`/`\t`/` ` 三个字符），命中才做 `:42-43` 的扫+删。

test('空白口径就是三个字符：\\r 与 NBSP 都不算（Strings.java:729-731，不是 Character.isWhitespace）', () => {
  for (const ch of [' ', '\t', '\n']) assert.equal(isHungryWhitespace(ch), true, JSON.stringify(ch))
  for (const ch of ['\r', '\u00A0', '\v', '\f', 'x']) {
    assert.equal(isHungryWhitespace(ch), false, JSON.stringify(ch))
  }
})

test('shiftBackward：往回跳到第一个不在集合里的下标；扫到头返回 -1；上界越界原样返回（:137）', () => {
  assert.equal(shiftBackward('a  b', 2, '\t \n'), 0, '两格空白都跳过，停在 a 上')
  assert.equal(shiftBackward('   ', 2, '\t \n'), -1, '全是空白 ⇒ 一路到 -1')
  assert.equal(shiftBackward('ab', 1, ' '), 1, '第一个字符就不在集合里 ⇒ 原地')
  assert.equal(shiftBackward('ab', 5, ' '), 5, ':137 maxOffset >= length 原样返回')
})

test('饥饿退格：光标前是一段空白 ⇒ 连制表符与换行一起，一次删到第一个非空白（:42-43）', () => {
  assert.deepEqual(hungryBackspace('ab\n   ', 6), { kind: 'delete', from: 2, to: 6 })
  assert.deepEqual(hungryBackspace('x\t  ', 4), { kind: 'delete', from: 1, to: 4 })
  assert.deepEqual(hungryBackspace('a\n', 2), { kind: 'delete', from: 1, to: 2 }, '只有换行本身')
})

test('饥饿退格：整篇都是空白 ⇒ 从 0 删到光标（shiftBackward 的 -1 再 +1）', () => {
  assert.deepEqual(hungryBackspace('   ', 3), { kind: 'delete', from: 0, to: 3 })
  assert.deepEqual(hungryBackspace('\t\n ', 3), { kind: 'delete', from: 0, to: 3 })
})

test('饥饿退格：末行没有换行符 / 单行文档也照吃（删的是行尾那一小段，不是整行）', () => {
  assert.deepEqual(hungryBackspace('value = 1 ', 10), { kind: 'delete', from: 9, to: 10 })
  assert.deepEqual(hungryBackspace('let x = 1;\n    ', 15), { kind: 'delete', from: 10, to: 15 },
    '末行只有空白 ⇒ 连上一行那个换行一起删掉')
})

test('饥饿退格：前一个字符不是那三个空白 ⇒ 交给普通退格（:41 的第二个条件）', () => {
  assert.deepEqual(hungryBackspace('abc', 3), { kind: 'plain' })
  assert.deepEqual(hungryBackspace('a\nb', 3), { kind: 'plain' })
})

test('饥饿退格：有选区时也是普通退格 —— 饥饿档只认无选区（:41 的 !hasSelection）', () => {
  assert.deepEqual(hungryBackspace('ab   ', 5, { from: 0, to: 3 }), { kind: 'plain' })
  assert.deepEqual(hungryBackspace('   ', 3, { from: 1, to: 2 }), { kind: 'plain' })
})

test('饥饿退格：光标在文档开头什么都不做（:34-36）；空文档与越界同理（越界是本仓护栏）', () => {
  assert.equal(hungryBackspace('', 0), null)
  assert.equal(hungryBackspace('   ', 0), null, '光标在 0 —— 前面没有东西可删')
  assert.equal(hungryBackspace('abc', -1), null)
  assert.equal(hungryBackspace('abc', 4), null, '上游没有这个状态，本仓按不动作处理')
})

test('饥饿退格的删除范围应用到文档就是新文档（宿主接线用同一段；plain 档文档不动）', () => {
  const apply = (text, caret, selection) => {
    const plan = hungryBackspace(text, caret, selection)
    return plan?.kind === 'delete' ? text.slice(0, plan.from) + text.slice(plan.to) : text
  }
  assert.equal(apply('let x = 1;\n    ', 15), 'let x = 1;')
  assert.equal(apply('ab\n   ', 6), 'ab')
  assert.equal(apply('keep  me', 8), 'keep  me', 'plain = 这一条不吞键，交给普通退格')
})

test('落点留痕：模块头记了饥饿退格的每条依据，并把「光标处的词」指向既有模块（不复写第二份）', () => {
  const src = readFileSync('src/editorLineOps.ts', 'utf8')
  assert.match(src, /HungryBackspaceAction\.java:29-50/)
  assert.match(src, /StringUtil\.java:1250-1252/)
  assert.match(src, /Strings\.java:729-731/)
  assert.match(src, /CharArrayUtil\.java:136-151/)
  assert.match(src, /intellij\.platform\.ide\.impl\.actions\.xml:177/)
  assert.match(src, /selectWordAtCaret\.ts/, 'C-6 的「光标处的词」三条已在那一份，这里只留指针')
  assert.doesNotMatch(src, /export function selectWordAtCaret/, '不许出现第二份实现')
})
