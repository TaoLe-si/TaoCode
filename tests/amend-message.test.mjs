// 「修改(M)」模式的提交信息行为 —— 上游 `AmendCommitHandlerImpl`
// （`platform/vcs-impl/src/com/intellij/vcs/commit/AmendCommitHandlerImpl.kt`）：
//   · 进 amend 模式：先把草稿记成 `beforeAmendMessage`，再把"上次提交的信息"填进输入框，
//     空串不填（`:86-87`），只差空白也不填（`:99` 的 `equalsIgnoreWhitespaces`）；
//   · 退出 amend 模式：还原草稿（`:52` 的反向分支 `restoreBeforeAmendMessage`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { amendMessagePlan, equalsIgnoreWhitespaces, restoreBeforeAmendMessage } from '../src/amendMessage.ts'

test('进 amend 模式：草稿被记下，上次提交的信息填进输入框', () => {
  const plan = amendMessagePlan('WIP 草稿', 'Fix the parity probe\n\nbody line')
  assert.deepEqual(plan, { fill: 'Fix the parity probe\n\nbody line', before: 'WIP 草稿' })
})

test('上次提交的信息是空的 ⇒ 什么都不做（上游 takeIf { isNotBlank() }）', () => {
  assert.deepEqual(amendMessagePlan('草稿', ''), { fill: null, before: null })
  assert.deepEqual(amendMessagePlan('草稿', '   \n\t '), { fill: null, before: null })
})

test('草稿与要填的只差空白 ⇒ 不动（equalsIgnoreWhitespaces，:99）', () => {
  assert.deepEqual(amendMessagePlan('Fix it\n', 'Fix it'), { fill: null, before: null })
  assert.deepEqual(amendMessagePlan('Fix  it', 'Fix it'), { fill: null, before: null })
  assert.equal(equalsIgnoreWhitespaces('a\tb', 'a b'), true)
  assert.equal(equalsIgnoreWhitespaces('a b', 'ab'), false)
})

test('填进去的那份去掉尾随空白（上游拿的是提交信息本体）', () => {
  const plan = amendMessagePlan('', 'Subject\n\nbody\n\n')
  assert.equal(plan.fill, 'Subject\n\nbody')
})

test('退出 amend 模式：输入框里还是那份填进去的 ⇒ 还原草稿', () => {
  assert.equal(restoreBeforeAmendMessage('上次的信息', '上次的信息', '我的草稿'), '我的草稿')
})

test('用户改过就不动（以免把编辑成果冲掉）', () => {
  assert.equal(restoreBeforeAmendMessage('改过的信息', '上次的信息', '我的草稿'), null)
  assert.equal(restoreBeforeAmendMessage('', null, '我的草稿'), null, '没填过就没有草稿可还')
  assert.equal(restoreBeforeAmendMessage('x', 'x', null), null)
})

test('接线：面板把这三步接在 amend 开关上，占位文本只有一种（上游没有再编一句提示）', () => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/components/SourceControl.vue'), 'utf8')
  assert.match(text, /watch\(amend, value => \{/, 'amend 开关触发')
  assert.match(text, /request<GitCommitDetails>\('git\.commitDetails', \{ revision: 'HEAD' \}\)/, '上次提交的信息来自 git.commitDetails（原生 %B）')
  assert.match(text, /:placeholder="COMMIT_MESSAGE_PLACEHOLDER"/, '占位文本只有包里的那一条')
})
