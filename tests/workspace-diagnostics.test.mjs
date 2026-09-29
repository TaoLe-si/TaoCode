// 整工程诊断（LSP `workspace/diagnostic` = IDEA 的 Analyze → Inspect Code）。
//
// 最要紧的一条规则：**`kind: "unchanged"` 不等于"这个文件现在没有诊断"**。
// 规范里 unchanged 的报告根本没有 `items` 键；把它当成空诊断会把一整批诊断从问题面板里抹掉。
// 另一条：`previousResultIds` 只带有 resultId 的文件（带空串等于告诉服务器"上一份是空的"）。

import test from 'node:test'
import assert from 'node:assert/strict'

const { describeWorkspaceDiagnostics, planWorkspaceReports, previousResultIdsFrom } =
  await import('../src/workspaceDiagnostics.ts')
const { runWorkspaceInspection } = await import('../src/workspaceInspection.ts')

const full = (path, diagnostics = [], resultId = undefined) => ({ path, kind: 'full', diagnostics, resultId })
const unchanged = (path, resultId) => ({ path, kind: 'unchanged', resultId })

test('full 报告写进诊断表，unchanged 报告不写', () => {
  const plan = planWorkspaceReports([
    full('a.ts', [{ message: 'x' }], 'r1'),
    unchanged('b.ts', 'r2'),
  ])
  assert.deepEqual(plan.writes, [{ path: 'a.ts', diagnostics: [{ message: 'x' }] }])
  assert.equal(plan.unchanged, 1, 'unchanged 只计数，不产生写入')
  assert.deepEqual(plan.ids, [{ path: 'a.ts', value: 'r1' }, { path: 'b.ts', value: 'r2' }],
    'unchanged 的 resultId 也要留着给下一轮')
  assert.equal(plan.ignored, 0)
})

test('full 报告缺 diagnostics 键时按空数组处理（那是"这个文件没问题"）', () => {
  const plan = planWorkspaceReports([full('a.ts')])
  assert.deepEqual(plan.writes, [{ path: 'a.ts', diagnostics: [] }])
})

test('unchanged 不会给诊断表写入空数组', () => {
  const plan = planWorkspaceReports([unchanged('a.ts', 'r1')])
  assert.deepEqual(plan.writes, [], '写进去就等于说"这个文件现在没诊断"')
  assert.equal(plan.unchanged, 1)
})

test('认不出的报告与坏输入只计数，不猜语义', () => {
  const plan = planWorkspaceReports([
    { path: 'a.ts', kind: 'partial' },
    { path: '', kind: 'full', diagnostics: [] },
    null,
  ])
  assert.deepEqual(plan.writes, [])
  assert.equal(plan.ignored, 3)
  assert.deepEqual(planWorkspaceReports(undefined), { writes: [], ids: [], unchanged: 0, ignored: 0 })
})

test('previousResultIds 只带非空值', () => {
  assert.deepEqual(previousResultIdsFrom(new Map([['a.ts', 'r1'], ['b.ts', '']])), [{ path: 'a.ts', value: 'r1' }])
  assert.deepEqual(previousResultIdsFrom({ 'a.ts': 'r1', 'b.ts': '' }), [{ path: 'a.ts', value: 'r1' }])
  assert.deepEqual(previousResultIdsFrom(new Map()), [])
})

test('总结文案把「沿用」与「忽略」都说出来', () => {
  const plan = planWorkspaceReports([full('a.ts', [{ message: '1' }, { message: '2' }]), unchanged('b.ts', 'r2')])
  const text = describeWorkspaceDiagnostics(plan)
  assert.match(text, /检查了 2 个文件/)
  assert.match(text, /发现 2 个问题/)
  assert.match(text, /沿用 1 个未变化的文件/)
  // 什么都没返回时说清楚，而不是静默成功。
  assert.match(describeWorkspaceDiagnostics(planWorkspaceReports([])), /没有返回任何文件/)
})

test('runWorkspaceInspection 把 full 并入诊断表、替换 resultId 表', async () => {
  const diagnostics = new Map([['stale.ts', [{ message: '旧' }]]])
  const resultIds = new Map([['gone.ts', 'old-id']])
  let seenPrevious
  const outcome = await runWorkspaceInspection({
    query: async previous => {
      seenPrevious = previous
      return { available: true, items: [full('a.ts', [{ message: 'x' }], 'r1'), unchanged('b.ts', 'r2')] }
    },
    diagnostics,
    resultIds,
  })
  assert.deepEqual(seenPrevious, [{ path: 'gone.ts', value: 'old-id' }], '把上一轮的 id 发回去')
  assert.deepEqual(diagnostics.get('a.ts'), [{ message: 'x' }])
  assert.equal(diagnostics.has('b.ts'), false, 'unchanged 不写诊断表')
  assert.equal(diagnostics.has('stale.ts'), true, '这一轮没提到的文件不在这个模块的职责里 —— 不动它')
  assert.deepEqual([...resultIds.entries()], [['a.ts', 'r1'], ['b.ts', 'r2']], 'resultId 表整体替换')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.scanned, 2)
  assert.equal(outcome.found, 1)
})

test('服务器没给整工程诊断时如实返回失败而不是假装成功', async () => {
  const diagnostics = new Map()
  const outcome = await runWorkspaceInspection({
    query: async () => ({ available: false }),
    diagnostics,
    resultIds: new Map(),
  })
  assert.equal(outcome.ok, false)
  assert.match(outcome.message, /没有返回整工程诊断/)
  assert.equal(diagnostics.size, 0)
})
