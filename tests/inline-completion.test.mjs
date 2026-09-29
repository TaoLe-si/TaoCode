// `src/inlineCompletion.ts`：行内补全的「显示什么」与「接受时替换哪一段」。
// 后者的重点在**校验**：`range` 是适配器给的任意坐标，负值/倒序会让 CodeMirror 的 changes
// 抛异常 —— 而这段代码跑在按键路径上，抛异常就是"按 Tab 崩了"。

import test from 'node:test'
import assert from 'node:assert/strict'

const { INLINE_TRIGGER_KINDS, inlineAcceptSpan, inlineGhostLines, inlineGhostText } =
  await import('../src/inlineCompletion.ts')

test('幽灵文本优先 filterText，回退 insertText', () => {
  // filterText 是"和用户输入怎么对齐"的文本，IDEA 的灰色提示显示的就是这一层。
  assert.equal(inlineGhostText({ insertText: 'countLocal()', filterText: 'countLocal' }), 'countLocal')
  assert.equal(inlineGhostText({ insertText: ' += 1' }), ' += 1')
  assert.equal(inlineGhostText(undefined), '')
  assert.equal(inlineGhostText(null), '')
  // 两个都空 → 空串，调用方据此不渲染（而不是画一个空装饰）。
  assert.equal(inlineGhostText({ insertText: '' }), '')
})

test('没有 range 时在光标处零宽插入', () => {
  assert.deepEqual(inlineAcceptSpan({ insertText: 'x' }, { line: 3, char: 7 }),
    { startLine: 3, startChar: 7, endLine: 3, endChar: 7 })
  assert.deepEqual(inlineAcceptSpan(undefined, { line: 0, char: 0 }),
    { startLine: 0, startChar: 0, endLine: 0, endChar: 0 })
})

test('有合法 range 时替换那一段', () => {
  const item = { insertText: 'countLocal', range: { startLine: 2, startChar: 4, endLine: 2, endChar: 9 } }
  assert.deepEqual(inlineAcceptSpan(item, { line: 2, char: 9 }), { startLine: 2, startChar: 4, endLine: 2, endChar: 9 })
  // 跨行区间也合法。
  const multi = { insertText: 'y', range: { startLine: 1, startChar: 2, endLine: 3, endChar: 0 } }
  assert.deepEqual(inlineAcceptSpan(multi, { line: 3, char: 0 }), { startLine: 1, startChar: 2, endLine: 3, endChar: 0 })
})

test('畸形的 range 一律回退到光标插入（不能让 Tab 崩）', () => {
  const cursor = { line: 1, char: 5 }
  const fallback = { startLine: 1, startChar: 5, endLine: 1, endChar: 5 }
  const bad = [
    { startLine: -1, startChar: 0, endLine: 0, endChar: 0 },
    { startLine: 0, startChar: -2, endLine: 0, endChar: 3 },
    { startLine: 3, startChar: 0, endLine: 1, endChar: 0 },          // 倒序（行）
    { startLine: 0, startChar: 9, endLine: 0, endChar: 3 },          // 倒序（列）
    { startLine: 0.5, startChar: 0, endLine: 0, endChar: 1 },        // 非整数
    { startLine: 0, startChar: 0, endLine: 0 },                      // 缺字段
  ]
  for (const range of bad) assert.deepEqual(inlineAcceptSpan({ insertText: 'x', range }, cursor), fallback, JSON.stringify(range))
})

test('多行建议只显示第一行，尾随空行不算内容', () => {
  assert.deepEqual(inlineGhostLines({ insertText: 'a\nb\nc' }), ['a'])
  assert.deepEqual(inlineGhostLines({ insertText: 'a\n' }), ['a'], '以换行结尾是常见写法，别显示成两行')
  assert.deepEqual(inlineGhostLines({ insertText: 'a\n\n\n' }), ['a'])
  assert.deepEqual(inlineGhostLines({ insertText: '' }), [])
  assert.deepEqual(inlineGhostLines(undefined), [])
  assert.deepEqual(inlineGhostLines({ insertText: 'a\nb' }, 2), ['a', 'b'])
})

test('triggerKind 用规范里的取值', () => {
  assert.deepEqual(INLINE_TRIGGER_KINDS, { automatic: 1, explicit: 2, retrigger: 3 })
})
