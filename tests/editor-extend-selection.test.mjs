// 扩展选区（IDEA Extend Selection 一族）与**块注释智能选择器**
// （`wordSelection/BlockCommentSelectioner.java`）的判据。
//
// 这条命令上游的键位在 `$default.xml` 里查不到（全树也没有 `EditorExtendSelectionHandler`），
// 所以本文件只钉**范围计算**这层纯逻辑：菜单与命令都走它，键位不编。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  blockCommentContentRange, extendLevels, extendSelection, lexemeRange, lineCommentRunRange, wordRange,
} from '../src/editorExtendSelection.ts'

const style = { line: '//', block: ['/*', '*/'] }
const at = (text, needle) => {
  const index = text.indexOf(needle)
  assert.notEqual(index, -1, `测试样本里找不到 ${needle}`)
  return index
}

// ── ① 词 / 词素（AbstractWordSelectioner.java:31 那一档）────────────────────────

test('词：光标在词内选中整个词，紧贴词尾也算', () => {
  const text = 'value = computeTotal(items);'
  const start = at(text, 'computeTotal')
  const end = start + 'computeTotal'.length
  assert.deepEqual(wordRange(text, start + 3), { from: start, to: end })
  assert.deepEqual(wordRange(text, end), { from: start, to: end }, '紧贴词尾仍选中那个词')
  assert.equal(wordRange(text, 7), null, '两边都不是标识符字符的空白处没有词')
})

test('词素：驼峰切分（isCamelWords 那一档），连着按会一级级变大', () => {
  const text = 'getUserName'
  assert.deepEqual(lexemeRange(text, 4), { from: 3, to: 7 }, 'get**User**Name → get|User|Name')
  assert.deepEqual(lexemeRange(text, 0), null, '紧贴词头给的是整个词而不是词素')
  const levels = extendLevels({ text, head: 4, current: { from: 4, to: 4 }, style: null })
  assert.deepEqual(levels[0], { from: 3, to: 7 }, '词素是最内层')
  assert.deepEqual(levels[1], { from: 0, to: 11 }, '整个词是下一层')
})

// ── ② 块注释智能选择器（BlockCommentSelectioner.java:26-37）──────────────────────

test('块注释：选中两个分隔符之间的内容，不含 /* 与 */', () => {
  const text = 'a = 1; /* hello world */ b = 2;'
  const open = at(text, '/*')
  const close = at(text, '*/')
  const head = at(text, 'hello') + 2
  const range = blockCommentContentRange(text, head, style.block)
  assert.deepEqual(range, { from: open + '/*'.length, to: close }, '右端是收尾分隔符的起点')
  // 选区文本正是注释**正文**。
  assert.equal(text.slice(range.from, range.to), ' hello world ')
})

test('块注释：没闭合的 /* 不选（:33 要求以 blockEnd 结尾）', () => {
  const text = 'x; /* never closed'
  assert.equal(blockCommentContentRange(text, at(text, 'never'), style.block), null)
})

test('块注释：排除 /** 文档注释（:22 的 PsiDocCommentBase）', () => {
  const text = '/** doc block */ var x;'
  assert.equal(blockCommentContentRange(text, at(text, 'doc'), style.block), null, '文档注释不走这一层')
  // 而普通的 /* */ 照选。
  const plain = '/* doc */ var x;'
  assert.ok(blockCommentContentRange(plain, at(plain, 'doc'), style.block))
})

test('块注释：没有块标记的语言不选（:28-31 的 commenter 判据）', () => {
  const text = '/* hi */'
  assert.equal(blockCommentContentRange(text, 4, undefined), null)
  assert.equal(blockCommentContentRange(text, 4, null), null)
})

test('块注释：HTML 注释用自己的分隔符', () => {
  const html = { block: ['<!--', '-->'] }
  const text = '<p>x</p><!-- note --><p>y</p>'
  const range = blockCommentContentRange(text, at(text, 'note') + 1, html.block)
  assert.equal(text.slice(range.from, range.to), ' note ')
})

// ── ③ 行注释链（LineCommentSelectioner.java:33-58）──────────────────────────────

test('行注释：单行时选注释自己，不含行首空白与行尾空白（expandToWholeLine :117-119）', () => {
  const text = '  // a comment here   \nnext();'
  const head = at(text, 'comment')
  const range = lineCommentRunRange(text, head, style.line)
  assert.deepEqual(range, { from: 2, to: at(text, 'here') + 'here'.length })
  assert.equal(text.slice(range.from, range.to), '// a comment here', '行尾空白不算进去')
})

test('行注释：连续多行合成一条链并对称扩到整行', () => {
  const text = 'x();\n// one\n// two\ny();'
  const head = at(text, 'one')
  const range = lineCommentRunRange(text, head, style.line)
  assert.equal(text.slice(range.from, range.to), '// one\n// two\n')
})

test('行注释：光标在空白处不成立', () => {
  const text = '// c\nplain();'
  assert.equal(lineCommentRunRange(text, at(text, 'plain'), style.line), null)
})

// ── ④ 层级顺序与「按几下」的长法 ───────────────────────────────────────────────

test('层级按上游扩展点顺序：词 → 词素 → 行注释 → 块注释（注册顺序）', () => {
  const text = '/* fooBar */'
  const head = at(text, 'fooBar') + 2
  const levels = extendLevels({ text, head, current: { from: head, to: head }, style })
  const open = at(text, '/*')
  const close = at(text, '*/')
  assert.deepEqual(levels[levels.length - 1], { from: open + 2, to: close }, '块注释内容是最外层')
  assert.deepEqual(levels[0], { from: at(text, 'fooBar'), to: at(text, 'fooBar') + 3 }, '词素在最内层')
})

test('extendSelection 每按一次长一级，长到头返回 null（命令据此不吞键）', () => {
  const text = '/* fooBar */'
  const close = at(text, '*/')
  // 三层：词素 {3,6} → 整词 {3,9} → 块注释内容 {2,10}（由内到外）。
  const steps = [{ from: 3, to: 6 }, { from: 3, to: 9 }, { from: 2, to: close }]
  let current = { from: 4, to: 4 }
  const seen = []
  for (let step = 0; step < steps.length + 2; ++step) {
    const next = extendSelection({ text, head: current.to, current, style }, true)
    if (!next) break
    seen.push(next)
    current = next
  }
  assert.deepEqual(seen, steps.map(level => ({ from: 4, to: level.to })), '一层一级往外长')
  assert.equal(extendSelection({ text, head: current.to, current, style }, true), null, '长到头返回 null')
})

test('往左长：头变小，另一头不动', () => {
  const text = 'x = /* mid */ y;'
  const head = at(text, 'mid')
  // 当前在 `mid` 里，往左长一级 = 块注释内容的起点（紧贴 `/*` 之后那格空白之前）。
  const range = extendSelection({ text, head, current: { from: head, to: head }, style }, false)
  assert.deepEqual(range, { from: at(text, '/*') + 2, to: head })
  // 再往左就没有更外层的块注释了（这一带没有行注释），返回 null。
  assert.equal(extendSelection({ text, head: range.from, current: range, style }, false), null)
})
