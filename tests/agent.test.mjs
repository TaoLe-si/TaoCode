import { test } from 'node:test'
import assert from 'node:assert/strict'
const {
  decidePermission, defaultAgentPermissions, parsePlan, renderEditPreview,
  contextUsage, summarizeUsage, exportTranscript, fakeModelReply,
} = await import('../src/agent.ts')

test('permission defaults: reads allowed, writes and commands gated, network off', () => {
  assert.equal(decidePermission('read_file', defaultAgentPermissions), 'allow')
  assert.equal(decidePermission('write_file', defaultAgentPermissions), 'ask')
  assert.equal(decidePermission('run_command', defaultAgentPermissions), 'ask')
  assert.equal(decidePermission('fetch_network', defaultAgentPermissions), 'deny')
})

test('a refused setting is denied outright, not asked', () => {
  assert.equal(decidePermission('write_file', { ...defaultAgentPermissions, write: 'never' }), 'deny')
  assert.equal(decidePermission('run_command', { ...defaultAgentPermissions, run: 'allow' }), 'allow')
})

test('plans parse numbered and dashed lists, dropping prose and blanks', () => {
  const steps = parsePlan('计划：\n1. 第一步\n2) 第二步\n- 第三步\n\n无关散文\n4. 第四步')
  assert.deepEqual(steps.map(step => step.text), ['第一步', '第二步', '第三步', '第四步'])
  assert.ok(steps.every(step => step.done === false))
  assert.deepEqual(parsePlan('完全没有列表'), [])
})

test('edit previews count additions and deletions per hunk', () => {
  const preview = renderEditPreview({ path: 'a.txt', before: 'one\ntwo\nthree', after: 'one\nTWO\nthree\nfour' })
  assert.equal(preview.removed, 1)
  assert.equal(preview.added, 2)
  assert.deepEqual(preview.hunks, [{ before: ['two'], after: ['TWO'] }, { before: [], after: ['four'] }])
  // a two-block change yields two hunks
  const split = renderEditPreview({ path: 'b.txt', before: 'a\nkeep\nb', after: 'x\nkeep\ny' })
  assert.equal(split.hunks.length, 2)
})

test('context usage truncates from the first files under the budget', () => {
  const usage = contextUsage([
    { path: 'big.txt', content: 'x'.repeat(600) },
    { path: 'small.txt', content: 'y'.repeat(100) },
  ], 500)
  assert.equal(usage.usedChars, 500)
  assert.equal(usage.overBudget, true)
  assert.equal(usage.files[0].truncated, true)
  assert.equal(usage.files[1].truncated, false)
})

test('usage summary keeps estimate math separate from call counts', () => {
  const summary = summarizeUsage([
    { calls: 2, promptChars: 300, completionChars: 100 },
    { calls: 1, promptChars: 200, completionChars: 100 },
  ])
  assert.equal(summary.calls, 3)
  assert.equal(summary.estimatedTokens, 350)
})

test('the transcript exports as stable JSON with every entry kind', () => {
  const json = exportTranscript([
    { at: '2026-09-25T10:00:00Z', kind: 'user', text: '帮我加个标记' },
    { at: '2026-09-25T10:00:01Z', kind: 'assistant', text: '计划…' },
    { at: '2026-09-25T10:00:02Z', kind: 'tool', text: 'write_file', tool: 'write_file', params: { path: 'a.txt' }, result: 'pending' },
    { at: '2026-09-25T10:00:03Z', kind: 'approval', text: '允许写入', approved: true },
  ], { model: 'local-fake', started: '2026-09-25T10:00:00Z' })
  const parsed = JSON.parse(json)
  assert.equal(parsed.format, 'taocode-agent-transcript/1')
  assert.equal(parsed.entries.length, 4)
  assert.equal(parsed.model, 'local-fake')
})

test('the fake model is deterministic and proposes gated tool calls', () => {
  const first = fakeModelReply('在 `src/Main.java` 里加标记', ['src/Main.java'], 0)
  const again = fakeModelReply('在 `src/Main.java` 里加标记', ['src/Main.java'], 0)
  assert.deepEqual(first, again)
  assert.equal(first.toolCalls[0].tool, 'read_file')
  assert.equal(first.toolCalls[0].params.path, 'src/Main.java')
  assert.equal(first.toolCalls.length, 1)  // the first turn only reads
  const second = fakeModelReply('在 `src/Main.java` 里加标记', ['src/Main.java'], 1)
  assert.equal(second.toolCalls.length, 2)
  assert.equal(second.toolCalls[1].tool, 'write_file')
  assert.ok(parsePlan(second.text).length === 3, 'the reply carries a three-step plan')
})
