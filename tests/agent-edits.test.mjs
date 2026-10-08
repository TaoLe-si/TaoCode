// `agent/edits` 判据：待决改动台账 + Do / Undo / Do All + 撤回的安全检查。
//
// 起因（用户原话）：agent 改完文件要能「既在对话窗口里看到、也在左侧写代码的窗口看到红绿
// diff」，并逐条决定保留还是撤回。这里钉住三件事：不保留就不写盘、写失败不许谎报成功、
// **撤回不覆盖用户自己改过的内容**（ROADMAP S5 的验收口径）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentEditLedger, editDiffRows, hasPendingEdits } from '../src/agentEdits.ts'

/** 一个内存文件系统 + 动作日志，用来断言「Do 到底写了什么」。 */
function fakeFiles(initial = {}) {
  const table = new Map(Object.entries(initial))
  const writes = []
  return {
    table, writes,
    files: {
      read: path => (table.has(path) ? table.get(path) : null),
      write: (path, content) => { table.set(path, content); writes.push({ path, content }); return true },
    },
  }
}

test('登记不写盘：改动在被保留之前磁盘上一动不动', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  assert.equal(disk.writes.length, 0, '登记阶段不许写盘')
  assert.equal(disk.table.get('src/a.ts'), 'old\n')
  assert.equal(ledger.get(id).state, 'pending')
  assert.equal(hasPendingEdits(ledger), true)
})

test('Do 保留这一条：写盘内容 = after，状态转 applied', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  assert.deepEqual(await ledger.do(id), { ok: true })
  assert.deepEqual(disk.writes, [{ path: 'src/a.ts', content: 'new\n' }])
  assert.equal(ledger.get(id).state, 'applied')
  assert.equal(hasPendingEdits(ledger), false)
})

test('Undo 撤回待决改动：直接丢弃，**不写盘**（没有东西需要还原）', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  assert.deepEqual(await ledger.undo(id), { ok: true })
  assert.equal(disk.writes.length, 0, '从没落盘过就不该动磁盘')
  assert.equal(disk.table.get('src/a.ts'), 'old\n')
  assert.equal(ledger.get(id).state, 'reverted')
})

test('Undo 撤回已落盘改动：盘上仍是 after 时写回 before', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  await ledger.do(id)
  disk.writes.length = 0
  assert.deepEqual(await ledger.undo(id), { ok: true })
  assert.deepEqual(disk.writes, [{ path: 'src/a.ts', content: 'old\n' }])
  assert.equal(disk.table.get('src/a.ts'), 'old\n')
  assert.equal(ledger.get(id).state, 'reverted')
})

test('撤回不覆盖用户独立修改：盘上被外部改过就拒绝', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  await ledger.do(id)
  // 用户自己在这之后编辑了这个文件。
  disk.table.set('src/a.ts', '用户自己写的\n')
  disk.writes.length = 0
  assert.deepEqual(await ledger.undo(id), { ok: false, reason: 'conflict' })
  assert.equal(disk.writes.length, 0, '拒绝时不许写盘')
  assert.equal(disk.table.get('src/a.ts'), '用户自己写的\n', '用户的改动必须原样保留')
  assert.equal(ledger.get(id).state, 'applied', '拒绝撤回时状态不变')
})

test('同一条不许决定两次：已 applied 的再 do 返回 wrongState', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  await ledger.do(id)
  disk.writes.length = 0
  assert.deepEqual(await ledger.do(id), { ok: false, reason: 'wrongState' })
  assert.equal(disk.writes.length, 0, '已决的条目不许再触发写盘')
  await ledger.undo(id)   // 已落盘的可以撤
  assert.deepEqual(await ledger.undo(id), { ok: false, reason: 'wrongState' }, '撤回过的不能再撤')
})

test('Do All 保留全部待决：一次写满，已决的不重复写', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' })
  const ledger = createAgentEditLedger(disk.files)
  const first = ledger.record({ path: 'src/a.ts', before: 'a\n', after: 'A\n', turn: 0 })
  ledger.record({ path: 'src/b.ts', before: 'b\n', after: 'B\n', turn: 1 })
  ledger.record({ path: 'src/c.ts', before: 'c\n', after: 'C\n', turn: 1 })
  await ledger.undo(first)                        // 先撤一条，它不该被 Do All 再写一次
  disk.writes.length = 0
  assert.deepEqual(await ledger.doAll(), { applied: 2, failed: [] })
  assert.deepEqual(disk.writes.map(entry => entry.path).sort(), ['src/b.ts', 'src/c.ts'])
  assert.equal(ledger.get(first).state, 'reverted', '已撤回的保持撤回')
  assert.equal(hasPendingEdits(ledger), false)
})

test('写失败不许谎报成功：状态不变、仍待决，doAll 报失败明细', async () => {
  const ledger = createAgentEditLedger({ read: () => 'x', write: () => false })
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  assert.deepEqual(await ledger.do(id), { ok: false, reason: 'writeFailed' })
  assert.equal(ledger.get(id).state, 'pending', '写失败必须保持待决，不能显示"已保留"')
  assert.deepEqual(await ledger.doAll(), { applied: 0, failed: [{ id, reason: 'writeFailed' }] })
  assert.equal(ledger.get(id).state, 'pending')
})

test('写回调抛错等同失败，不许把异常漏给 UI', async () => {
  const ledger = createAgentEditLedger({ read: () => 'x', write: () => { throw new Error('磁盘满了') } })
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  assert.deepEqual(await ledger.do(id), { ok: false, reason: 'writeFailed' })
  assert.equal(ledger.get(id).state, 'pending')
})

test('文件没了：已落盘的撤回报 missing，不抛', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'old\n' })
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'old\n', after: 'new\n', turn: 0 })
  await ledger.do(id)
  disk.table.delete('src/a.ts')
  assert.deepEqual(await ledger.undo(id), { ok: false, reason: 'missing' })
})

test('红绿行：删行在左、增行在右，且计数与对话里那份一致', async () => {
  const rows = editDiffRows({ before: 'a\nb\nc\n', after: 'a\nB\nc\nd\n' })
  const deletes = rows.filter(row => row.kind === 'delete')
  const inserts = rows.filter(row => row.kind === 'insert')
  assert.equal(deletes.length, 1)
  assert.equal(inserts.length, 2)
  assert.equal(deletes[0].left.text, 'b')
  assert.equal(deletes[0].right, undefined, '删行只在左侧有格子')
  assert.equal(inserts[0].right.text, 'B')
  assert.equal(inserts[0].left, undefined, '增行只在右侧有格子')

  const disk = fakeFiles()
  const ledger = createAgentEditLedger(disk.files)
  const id = ledger.record({ path: 'src/a.ts', before: 'a\nb\nc\n', after: 'a\nB\nc\nd\n', turn: 0 })
  const summary = ledger.summarize()[0]
  assert.equal(summary.added, inserts.length, '对话里的 +N 必须等于左侧红行的数量口径')
  assert.equal(summary.removed, deletes.length)
  assert.equal(ledger.rows(id).length, rows.length)
})

test('同一文件改多次是两条独立改动（路径不能当键）', async () => {
  const disk = fakeFiles({ 'src/a.ts': 'v1\n' })
  const ledger = createAgentEditLedger(disk.files)
  const first = ledger.record({ path: 'src/a.ts', before: 'v1\n', after: 'v2\n', turn: 0 })
  const second = ledger.record({ path: 'src/a.ts', before: 'v2\n', after: 'v3\n', turn: 1 })
  assert.notEqual(first, second)
  assert.equal(ledger.pending().length, 2)
  await ledger.do(first)
  assert.equal(ledger.get(second).state, 'pending', '决定第一条不影响第二条')
  assert.equal(ledger.summarize().length, 2)
})

test('clear 清空并重置编号', async () => {
  const ledger = createAgentEditLedger({ read: () => null, write: () => true })
  ledger.record({ path: 'src/a.ts', before: '', after: 'x\n', turn: 0 })
  ledger.clear()
  assert.equal(ledger.all().length, 0)
  assert.equal(ledger.record({ path: 'src/b.ts', before: '', after: 'y\n', turn: 0 }), 1, '编号回到 1')
})

test('不存在的 id 一律给出明确结果，不抛错', async () => {
  const ledger = createAgentEditLedger({ read: () => null, write: () => true })
  assert.equal(ledger.get(999), undefined)
  assert.deepEqual(await ledger.do(999), { ok: false, reason: 'missing' })
  assert.deepEqual(await ledger.undo(999), { ok: false, reason: 'missing' })
  assert.deepEqual(ledger.rows(999), [])
})
