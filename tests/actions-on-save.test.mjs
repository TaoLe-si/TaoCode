// 「保存时操作」执行链（src/actionsOnSave.ts）的判据。
//
// 上游口径：`FormatOnSaveAction.kt:24-77` 的四段顺序里，本仓只有 ① Reformat code 有落点
// （语言服务 `formatting`）；②–④ 的开关要跨 `native/settings_schema.hpp` 与
// `src/bridge.ts` 的白名单，而 `bridge.ts` 本轮被禁改 —— 所以只测已有那一段，
// 并钉住"没有开关/没有语言服务就一个字节都不动"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runActionsOnSave } from '../src/actionsOnSave.ts'

const base = {
  path: 'a.ts',
  formatOnSave: true,
  lspAvailable: true,
  notify: () => {},
}

function formatResult(edits) {
  return { available: true, edits }
}

test('开关关闭时原样返回，不请求语言服务', async () => {
  let called = false
  const out = await runActionsOnSave({ ...base, content: 'const a=1\n', formatOnSave: false, format: async () => { called = true; return formatResult([]) } })
  assert.equal(called, false, '没有开关还去请求格式化')
  assert.deepEqual(out, { content: 'const a=1\n', changed: false })
})

test('没有语言服务时同样原样返回（上游 getPsiFile 短路）', async () => {
  let called = false
  const out = await runActionsOnSave({ ...base, content: 'x', lspAvailable: false, format: async () => { called = true; return formatResult([]) } })
  assert.equal(called, false)
  assert.equal(out.content, 'x')
  assert.equal(out.changed, false)
})

test('只有本文件那一份编辑会落到正文上', async () => {
  const out = await runActionsOnSave({
    ...base,
    content: 'const a=1\n',
    format: async () => formatResult([
      { path: 'other.ts', textEdits: [{ text: 'OTHER', startLine: 0, startChar: 0, endLine: 0, endChar: 5 }] },
      { path: 'a.ts', textEdits: [{ text: 'const a = 1', startLine: 0, startChar: 0, endLine: 0, endChar: 9 }] },
    ]),
  })
  assert.equal(out.content, 'const a = 1\n')
  assert.equal(out.changed, true)
})

test('编辑把正文改成原样时 changed 为假（不触发多余的 setDraft）', async () => {
  const out = await runActionsOnSave({
    ...base,
    content: 'const a = 1\n',
    format: async () => formatResult([
      { path: 'a.ts', textEdits: [{ text: 'const a = 1', startLine: 0, startChar: 0, endLine: 0, endChar: 11 }] },
    ]),
  })
  assert.equal(out.content, 'const a = 1\n')
  assert.equal(out.changed, false, '内容没变不该标 changed')
})

test('语言服务没有返回编辑：原样保存', async () => {
  const out = await runActionsOnSave({ ...base, content: 'z\n', format: async () => formatResult([]) })
  assert.deepEqual(out, { content: 'z\n', changed: false })
})

test('格式化抛错不阻断保存，且必须通知（上游不吞失败）', async () => {
  const messages = []
  const out = await runActionsOnSave({
    ...base,
    content: 'z\n',
    notify: (message, error) => messages.push({ message, error }),
    format: async () => { throw new Error('server down') },
  })
  assert.deepEqual(out, { content: 'z\n', changed: false })
  assert.equal(messages.length, 1, '失败必须说一声')
  assert.equal(messages[0].error, true)
  assert.match(messages[0].message, /保存前格式化失败/)
  assert.match(messages[0].message, /server down/)
})
