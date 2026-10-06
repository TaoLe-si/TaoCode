// 代码块首尾移动（上游 `CodeBlockUtil.java` 的括号扫描那一支，
// 键位 `$default.xml:569-571`/`:315-317`/`:318-320`/`:824-826`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorSelection, EditorState } from '@codemirror/state'
import { blockEndOffset, blockStartOffset, codeBlockTarget, structuralBraceTokens } from '../src/editorCodeBlock.ts'
import { editorLanguageId } from '../src/editorMatchBrace.ts'
import { findCodeBlockRange } from '../src/structuralCodeBlock.ts'
import { editingCommands } from '../src/editorCommands.ts'

function run(name, doc, spec) {
  let state = EditorState.create({ doc, selection: spec })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: editingCommands[name](view), state }
}

// 带语言档的那条链路（生产侧取的是 `state.facet(editorLanguageId)`，`src/editorCommands.ts:179`）。
function runWithLanguage(name, doc, spec, language) {
  let state = EditorState.create({ doc, selection: spec, extensions: [editorLanguageId.of(language)] })
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  return { ran: editingCommands[name](view), state }
}

test('字符串与注释里的括号不算结构括号', () => {
  // `f("a(b"); // x( }` ⇒ 只有真正的 `(` 与 `)`（偏移 1 与 7）。
  assert.deepEqual(structuralBraceTokens('f("a(b"); // x( }').map(t => `${t.from}${t.kind}`), ['1L', '7R'])
})

test('块内 ⇒ 右手边是关掉当前块的右括号，左手边是开出块的左括号之后（:144-173、:214-237）', () => {
  const text = '{ aaa\n  bbb\n}'
  assert.equal(blockEndOffset(text, 3), text.length - 1, '落在那个 } 的起始偏移')
  assert.equal(blockStartOffset(text, 3), 1, '落在那个 { 之后')
})

test('光标正好压在左括号上 ⇒ 块尾算到右括号**之后**（:173 的 isBeforeLBrace ? getEnd()）', () => {
  assert.equal(blockEndOffset('{aaa}', 0), 5)
})

test('光标压着的那个括号算「当前位置本身」，要再往外一层（:149 与 :220 的 if (moved)）', () => {
  // `f(g(a), b)`：光标停在 a 后面那个 `)` 上 ⇒ 那一对已经过去了，块尾是最外层的 `)`。
  assert.equal(blockEndOffset('f(g(a), b)', 5), 9)
  assert.equal(blockEndOffset('{a}}', 3), null, '再往外没有括号了')
  assert.equal(blockEndOffset('{a}}b}', 3), 5)
  // 左手边同理：光标压在 `(` 之后 ⇒ 那一个不算开块，往外找到 `f(` 的那个 `(` 之后。
  assert.equal(blockStartOffset('f(g(a), b)', 4), 2)
})

test('嵌套：块内光标只关掉当前这一层', () => {
  assert.equal(blockEndOffset('f(g(a), b)', 4), 5, '光标在 a 上：关掉 g( 的那一对')
  assert.equal(blockStartOffset('f(g(a), b)', 4, ), 2)
})

test('找不到块 ⇒ null（上游的 -1，命令据此不吞键）', () => {
  assert.equal(codeBlockTarget('no braces here', 3, true), null)
  assert.equal(codeBlockTarget('no braces here', 3, false), null)
  assert.equal(blockStartOffset('(', 0), null)
})

test('命令：光标移动不带选区，±Shift 从原 lead 选到落点（CodeBlockUtil.java:63-68、:100-105）', () => {
  const text = '{ aaa\n  bbb\n}'
  const moved = run('block.end', text, { anchor: 3 })
  assert.equal(moved.ran, true)
  assert.equal(moved.state.selection.main.head, text.length - 1)
  assert.equal(moved.state.selection.main.empty, true, '不带 Shift 时清掉选区')

  const selected = run('block.endSelect', text, { anchor: 3 })
  assert.equal(selected.state.selection.main.anchor, 3, 'anchor 停在原来的 lead 偏移')
  assert.equal(selected.state.selection.main.head, text.length - 1)

  assert.equal(run('block.start', text, { anchor: 8 }).state.selection.main.head, 1)
})

test('命令：多光标逐个算（上游 Handler 是 ForEachCaret，CodeBlockStartAction.java:22）', () => {
  const text = '{ a } b { c }'
  // 要开 `allowMultipleSelections`，否则 CodeMirror 先把两个光标折成一个（判据就成空转）。
  const base = EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true)] })
  let state = base.update({
    selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(10)], 0),
  }).state
  assert.equal(state.selection.ranges.length, 2, '判据真的是两个光标')
  const view = { get state() { return state }, dispatch: (...specs) => { state = state.update(...specs).state } }
  assert.equal(editingCommands['block.end'](view), true)
  assert.deepEqual(state.selection.ranges.map(range => range.head), [4, 12])
})

test('命令：没有块时不动也不吞键', () => {
  const result = run('block.end', 'plain text', { anchor: 3 })
  assert.equal(result.ran, false)
  assert.equal(result.state.selection.main.head, 3)
})

// ── 「结构支持」那一半的合并边（CodeBlockUtil.java:108-120 / :176-188）────────────
// 上游在括号扫描之外还要问一次 CodeBlockSupportHandler.findCodeBlockRange
// （platform/lang-impl/src/com/intellij/codeInsight/editorActions/CodeBlockUtil.java:110 与 :178），
// 块尾取 Math.min（:118）、块首取 Math.max（:186）、某一支没有时用另一支
// （:111-113 / :114-116、:179-181 / :182-184）。本仓的结构那半在 src/structuralCodeBlock.ts。
// 下面四组数值都是 codeBlockTarget/blockEndOffset/blockStartOffset 实测出来的，不是估的。
test('合并块尾取 min(结构, 括号)（CodeBlockUtil.java:118）', () => {
  const text = '(if a:\n    x = 1\n)\n'
  const caret = text.indexOf('if a') + 1
  // 括号那半会把块尾算到最外层那个右括号（17），结构那半收在复合语句末尾（16）⇒ 取 16。
  assert.equal(blockEndOffset(text, caret), 17, '括号那半实测值（本条是前提，不是结论）')
  assert.equal(codeBlockTarget(text, caret, true, 'python'), 16)
})

test('合并块首取 max(结构, 括号)（CodeBlockUtil.java:186）', () => {
  const text = '(if a:\n    x = 1\n)\n'
  const caret = text.indexOf('if a') + 1
  // 同一份文本反过来：括号那半给 1，结构那半给 0 ⇒ max 取 1（不跳到 0）。
  assert.equal(blockStartOffset(text, caret), 1, '括号那半实测值（本条是前提，不是结论）')
  assert.equal(codeBlockTarget(text, caret, false, 'python'), 1)
})

test('括号那半扫不到 ⇒ 用结构那半（:114-116 / :182-184）', () => {
  const text = ['def f():', '    if a:', '        x = 1', '    elif b:', '        y = 2', '    else:', '        z = 3'].join('\n')
  const caret = text.indexOf('elif b') + 2
  assert.equal(blockEndOffset(text, caret), null, '这段文本里没有结构括号 ⇒ 括号那半是上游的 -1')
  assert.equal(blockStartOffset(text, caret), null)
  // 结构那半 = 整条 if/elif/else 复合语句（本例是 [13, 82)，82 就是文档末尾）。
  assert.deepEqual(findCodeBlockRange(text, caret, 'python'), { from: 13, to: 82 })
  assert.equal(codeBlockTarget(text, caret, true, 'python'), 82)
  assert.equal(codeBlockTarget(text, caret, false, 'python'), 13)
})

test('结构那半为空 ⇒ 结果与只用括号扫描逐字一致（:111-113 / :179-181）', () => {
  // 这棵社区树里只有 Python 注册了 codeBlockSupportHandler
  // （python/pluginResources/intellij.python.community.impl.xml:439），Java/C++/TS 在上游就是
  // EMPTY_RANGE ⇒ 本仓对非 Python 语言必须**一个字节都不改**地退回括号扫描。
  const text = 'def f(a, b):\n    if a:\n        print(y, z)\n    else:\n        w = 3\n'
  const caret = text.indexOf('y, z') + 1
  assert.equal(findCodeBlockRange(text, caret, 'python'), null, '光标压在非关键字上 ⇒ 结构那半是空区间')
  for (const forward of [true, false]) {
    for (const language of ['java', 'cpp', 'typescript', 'other', '']) {
      assert.equal(codeBlockTarget(text, caret, forward, language),
        forward ? blockEndOffset(text, caret) : blockStartOffset(text, caret),
        `${forward ? '块尾' : '块首'}在语言档 ${JSON.stringify(language)} 下必须等于括号扫描`)
    }
    // 不传第四个实参 = 接线前的调用形状 ⇒ 默认档位不许变（既有调用方不改也能过类型）。
    assert.equal(codeBlockTarget(text, caret, forward),
      forward ? blockEndOffset(text, caret) : blockStartOffset(text, caret))
  }
})

// ── 判词点名「无代码块语言时不动光标」的那条**整链路**判据 ─────────────────────────
// 上游的三支里，本仓的 `codeBlockTarget` 拿到 EMPTY_RANGE（`CodeBlockSupportHandler.java:60`/`:65`）
// 且括号扫描给 -1（`CodeBlockUtil.java:54`/`:91`）时，落点是「哪儿都不去」：
// `:55` 的 `if (endOffset != -1)` 与 `:92` 的 `if (start < 0) return;`。
// 下面两条测的是 facet → 命令这一条生产链路（`src/editorCommands.ts:179` 读
// `state.facet(editorLanguageId)`），不是只测 `codeBlockTarget` 这个纯函数。
test('无代码块语言（facet 写着 java）+ 没有括号 ⇒ 光标原位不动、命令不吞键', () => {
  const doc = 'int a = 1;\nreturn a;'
  // 两支都要给空：java 没注册 handler（结构那半 EMPTY_RANGE），文本里也没有任何结构括号。
  const caret = 6
  assert.equal(findCodeBlockRange(doc, caret, 'java'), null, '前提：java 没有注册 codeBlockSupportHandler')
  assert.equal(blockEndOffset(doc, caret), null, '前提：右手边括号扫描扫不到')
  assert.equal(blockStartOffset(doc, caret), null, '前提：左手边括号扫描扫不到')
  for (const name of ['block.end', 'block.start', 'block.endSelect', 'block.startSelect']) {
    const result = runWithLanguage(name, doc, { anchor: caret }, 'java')
    assert.equal(result.ran, false, `${name} 不许吞键`)
    assert.equal(result.state.selection.main.head, caret, `${name} 不许挪光标`)
    assert.equal(result.state.selection.main.anchor, caret, `${name} 不许改选区`)
  }
})

test('语言档经 facet 传到命令：python 的复合语句（零括号）真的会动光标', () => {
  // 与上一条同一形状、只差语言档 ⇒ 证明「动/不动」确实由 `editorLanguageId` 决定，
  // 不是 `codeBlockTarget` 里写死的。
  const doc = 'def f():\n    if a:\n        x = 1\n'
  const caret = doc.indexOf('if a')
  // 上游给的是 PSI 节点的 textRange（`AbstractCodeBlockSupportHandler.java:81` 的 `obj.getTextRange()`），
  // 语句末尾**不含**行尾换行 ⇒ 落点是那个换行的位置，不是 doc.length。
  const blockEnd = doc.indexOf('\n', doc.indexOf('x = 1'))
  assert.equal(blockEndOffset(doc, caret), null, '前提：这段文本里没有结构括号')
  const plain = run('block.end', doc, { anchor: caret })
  assert.equal(plain.ran, false, '没挂语言档 ⇒ 语言是空档 ⇒ 与接线前逐字相同（不动）')
  const none = runWithLanguage('block.end', doc, { anchor: caret }, 'java')
  assert.equal(none.ran, false, 'java 档 ⇒ 上游 EMPTY_RANGE ⇒ 不动')
  const python = runWithLanguage('block.end', doc, { anchor: caret }, 'python')
  assert.equal(python.ran, true, 'python 档 ⇒ 结构那半给出块尾')
  assert.equal(python.state.selection.main.head, blockEnd)
  assert.equal(blockEnd, doc.length - 1, '前提：落点确实不含那个行尾换行')
})

// ── 「先向内找更小的块、再向外扩、到达边界时的行为」──────────────────────────────
// 上游的向内/向外是一条方向：`AbstractCodeBlockSupportHandler.java:79-83` 的 `getCodeBlockRange`
// 把光标处那个**叶子**交给 `getParentByTokenSet`（`:103-109`），后者从叶子自己开始一路 `getParent()`
// 往外走，**第一个**命中 `getBlockElementTypes()` 的祖先就是答案 ⇒ 拿到的是「包含光标的**最小**那块」
// （契约原文 `CodeBlockSupportHandler.java:49`）。一路走到根都没命中 ⇒ null ⇒ EMPTY_RANGE（`:82`），
// 合并那一步（`CodeBlockUtil.java:111-116`/`:179-184`）因此只剩另一支；两支都没有 ⇒ 不动光标。
test('嵌套复合语句：光标压内层 if ⇒ 只到内层那条语句的边界（ getCodeBlockRange 给最小那块）', () => {
  const doc = ['if a:', '    if b:', '        x = 1', '    else:', '        y = 2'].join('\n')
  const outer = 0
  const inner = doc.indexOf('if b')
  assert.ok(inner > 0, '前提：内外两层的关键字都在')
  // 内层：from = 内层 `if` 的第一个字符，to = 内层那条语句最后一个部件的块级末尾（= 整段末尾）。
  assert.deepEqual(findCodeBlockRange(doc, inner + 1, 'python'), { from: inner, to: doc.length })
  assert.equal(codeBlockTarget(doc, inner + 1, false, 'python'), inner, '块首停在内层关键字上，不许跳到外层')
  assert.equal(codeBlockTarget(doc, inner + 1, true, 'python'), doc.length)
  // 外层：同一份文本、光标压外层 `if` ⇒ 拿到的是外层那条（from = 0）。
  assert.equal(codeBlockTarget(doc, outer, false, 'python'), 0)
  assert.equal(codeBlockTarget(doc, outer, true, 'python'), doc.length)
})

test('到达边界（外面再没有块）⇒ 两支都给空 ⇒ null，命令据此不动光标', () => {
  const doc = 'x = 1\ny = 2\n'
  // 光标既不在关键字上、文本里也没有任何结构括号 ⇒ 上游的 EMPTY_RANGE + -1。
  assert.equal(findCodeBlockRange(doc, 2, 'python'), null)
  for (const language of ['python', 'java', '']) {
    assert.equal(codeBlockTarget(doc, 2, true, language), null, `${language} 右手边`)
    assert.equal(codeBlockTarget(doc, 2, false, language), null, `${language} 左手边`)
  }
  assert.equal(runWithLanguage('block.end', doc, { anchor: 2 }, 'python').ran, false)
  assert.equal(runWithLanguage('block.start', doc, { anchor: 2 }, 'python').ran, false)
})
