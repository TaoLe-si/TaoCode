// 判据：求值历史的「树」（上游 `DebuggerTreeWithHistoryPanel` / `DebuggerTreeWithHistoryContainer` 的树那一半）。
//
// 守三件事：
//   ① 纯规则（`src/debugHistoryTree.ts`）：历史条目怎么从 `evaluate` 回参造出来、根/孩子/省略号
//      三行怎么排、行动作按能力过滤后**哪些证明性地不出现**（DAP 没有的通道）；
//   ② 规则不重复：历史的容器语义在 `src/debugValueHistory.ts`（本模块与组件都不重写一份）；
//   ③ 接线：独立子组件 `src/components/debug/DebugHistoryTree.vue` 与宿主对话框的锚点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HISTORY_MORE_KEY, HISTORY_ROOT_KEY, evaluateHistoryEntry, historyChildPage, historyChildRows,
  historyRootRow, historyRowActions, historyRowMenuItems, historyTreeRows, historyValueEntry,
} from '../src/debugHistoryTree.ts'
import { variablePageInfo } from '../src/debugPaging.ts'

const read = path => readFileSync(path, 'utf8')

test('历史条目：句柄取 reference 优先、缺了退回 variablesReference，规模来自适配器', () => {
  const entry = evaluateHistoryEntry('xs.size()', { result: '3', type: 'int', variablesReference: 7 })
  assert.equal(entry.expression, 'xs.size()')
  assert.equal(entry.value, '3')
  assert.equal(entry.type, 'int')
  assert.equal(entry.reference, 7, '只有 variablesReference 时也留得下句柄')
  assert.equal(entry.page.paged, false, '适配器没报 named/indexed ⇒ 不假装知道总量')
  const rich = evaluateHistoryEntry('map', { result: '{}', reference: 9, namedVariables: 2, indexedVariables: 3 })
  assert.equal(rich.reference, 9, 'reference 优先于 variablesReference')
  assert.equal(rich.page.total, 5)
  assert.equal(rich.page.paged, true)
  assert.equal(evaluateHistoryEntry('bad', null).reference, 0, '没有回参 ⇒ 不可展开')
  assert.equal(evaluateHistoryEntry('bad', null).value, '')
})

test('根行：名字是表达式，文本是行文本（` = {类型} 值`），可展开性看句柄', () => {
  const row = historyRootRow(evaluateHistoryEntry('count', { result: '42', type: 'int', reference: 3 }))
  assert.equal(row.key, HISTORY_ROOT_KEY)
  assert.equal(row.kind, 'root')
  assert.equal(row.name, 'count')
  assert.equal(row.value, '42', '值的原文留在行上（设为根要用）')
  assert.equal(row.type, 'int')
  assert.equal(row.text, ' = {int} 42', 'XValueNodeImpl.buildText 的拼法')
  assert.equal(row.hasChildren, true)
  const leaf = historyRootRow(evaluateHistoryEntry('count', { result: '42' }))
  assert.equal(leaf.text, ' = 42', '类型没报就不画 {类型} 那一段')
  assert.equal(leaf.hasChildren, false)
})

test('行动作按能力过滤：DAP 没有的通道（引用查询 / 类型源码）证明性地不出现', () => {
  const ids = historyRowActions().map(entry => entry.id)
  assert.deepEqual(ids, ['inspect', 'copy-value', 'compare-clipboard', 'copy-name'],
    '保守缺省下只剩这四条（set-value 要 modifier、evaluate 一族要宿主处理函数）')
  assert.equal(ids.includes('show-referring'), false, 'XReferrersProvider 在 DAP 没有对应请求')
  assert.equal(ids.includes('jump-to-type-source'), false, 'variables 不带类型源码位置')
  assert.equal(ids.includes('add-to-watch'), false, '没有监视视图能力时不画（hide-disabled-in-popup）')
  // 反过来证明过滤是**能力驱动**的，不是把动作写死了：给了通道它就回来。
  const withChannels = historyRowActions({ referrersProvider: true, canNavigateToTypeSource: true, backendCounterpart: true })
    .map(entry => entry.id)
  assert.equal(withChannels.includes('show-referring'), true)
  assert.equal(withChannels.includes('jump-to-type-source'), true)
})

test('孩子行与省略号行：还有没取完才补省略号，取完了不画假节点', () => {
  const children = [
    { name: '0', value: '1', type: 'int', reference: 11 },
    { name: '1', value: '2', type: 'int', reference: 0 },
  ]
  const info = variablePageInfo({ namedVariables: 0, indexedVariables: 4 })
  const rows = historyChildRows(children, children.length, info)
  assert.equal(rows.length, 3, '两个孩子 + 一个省略号行')
  assert.equal(rows[0].key, 'child:11')
  assert.equal(rows[0].name, '0')
  assert.equal(rows[0].text, ' = {int} 1')
  assert.equal(rows[0].hasChildren, true, '句柄 > 0 ⇒ 可以继续展开')
  assert.equal(rows[1].hasChildren, false)
  assert.equal(rows[2].key, HISTORY_MORE_KEY)
  assert.equal(rows[2].kind, 'ellipsis')
  assert.equal(rows[2].text, '... (2 more items. Double-click to see)', 'MessageTreeNode.createEllipsisNode 的文案')
  const done = historyChildRows(children, 4, info)
  assert.equal(done.some(row => row.kind === 'ellipsis'), false, '取完了就没有省略号行')
  const unknown = historyChildRows(children, children.length, variablePageInfo(undefined))
  assert.equal(unknown.some(row => row.kind === 'ellipsis'), false, '适配器没报总量 ⇒ 不说“还有”')
})

test('一棵树 = 根行 + 孩子行，顺序即渲染顺序', () => {
  const entry = evaluateHistoryEntry('list', { result: '[1, 2]', type: 'ArrayList', reference: 5, indexedVariables: 2 })
  const rows = historyTreeRows(entry, [{ name: '[0]', value: '1', reference: 0 }, { name: '[1]', value: '2', reference: 0 }])
  assert.deepEqual(rows.map(row => row.kind), ['root', 'child', 'child'])
  assert.equal(rows[0].key, HISTORY_ROOT_KEY)
  // 适配器报了两个下标孩子却一个都没取：根行 + 省略号行（"还有 2 项"），这是对的行为。
  assert.deepEqual(historyTreeRows(entry).map(row => row.kind), ['root', 'ellipsis'])
  const quiet = historyTreeRows(evaluateHistoryEntry('list', { result: '[1, 2]', reference: 5 }))
  assert.deepEqual(quiet.map(row => row.kind), ['root'], '适配器没报规模 ⇒ 只有一个根行')
})

test('值根（设为根）：值的原文与类型跟着走，规模只认这一行报的量', () => {
  const entry = historyValueEntry('this.user', '{User@1}', 'User', 12, { namedVariables: 3 })
  assert.equal(entry.expression, 'this.user', '条目名就是行名')
  assert.equal(entry.value, '{User@1}')
  assert.equal(entry.reference, 12)
  assert.equal(entry.page.total, 3)
  assert.equal(historyChildPage({ name: 'x', value: '1', reference: 0 }).paged, false)
})

test('行菜单只画宿主真能处理的模式（没接的动作不出现）', () => {
  const row = historyRootRow(evaluateHistoryEntry('count', { result: '42', type: 'int', reference: 3 }))
  const items = historyRowMenuItems(row, ['copy-value', 'copy-name'])
  assert.deepEqual(items.map(item => item.mode), ['copy-value', 'copy-name'])
  assert.equal(items.every(item => item.disabled === false), true)
  const delegated = historyRowMenuItems(row, ['copy-value', 'inspect'])
  assert.deepEqual(delegated.map(item => item.mode), ['inspect', 'copy-value'], '顺序照上游 XDebugger.ValueGroup')
})

test('独立子组件：工具栏三个动作走 debugValueHistory 的规则，不重写历史语义', () => {
  const component = read('src/components/debug/DebugHistoryTree.vue')
  assert.match(component, /from '\.\.\/\.\.\/debugValueHistory'/)
  for (const fn of ['canGoBackward', 'canGoForward', 'canSetAsRoot', 'pushValueHistory', 'goBackward', 'goForward']) {
    assert.ok(component.includes(fn), `组件要用 ${fn}，不能自己写一份`)
  }
  assert.equal(/const \w*[Hh]istory\w*\s*=\s*11\b/.test(component), false, '容量判据在规则模块里，组件不重写一份')
  assert.match(component, /title="设为根"/, '设为根（SetAsRootAction）')
  assert.match(component, /title="前进（Alt\+→）"/)
  assert.match(component, /title="后退（Alt\+←）"/)
  assert.match(component, /aria-label="求值历史树"/)
})

test('独立子组件自己取数、自己做完复制两档，其余动作要宿主白名单', () => {
  const component = read('src/components/debug/DebugHistoryTree.vue')
  assert.match(component, /dapEvaluate\(label, 'watch'/, '历史条目只有文本，句柄现算（DAP evaluate）')
  assert.match(component, /dapVariables\(reference\)/, '展开走 DAP variables')
  assert.match(component, /copyToClipboard\(/, '复制值/复制名称本组件就做完')
  assert.match(component, /historyRowMenuItems\(/)
  assert.match(component, /from '\.\.\/\.\.\/debugHistoryTree'/)
  assert.equal(/debuggerValueHistory|QueryReferrers|referrers/i.test(component), false, '不发明 DAP 没有的通道')
})

test('宿主接线：求值对话框里挂了这棵历史树', () => {
  const dialog = read('src/components/DebugEvaluateDialog.vue')
  assert.match(dialog, /import DebugHistoryTree from '\.\/debug\/DebugHistoryTree\.vue'/)
  assert.match(dialog, /<DebugHistoryTree/)
  assert.match(dialog, /:expressions="history"/)
  assert.match(dialog, /frameId/, '宿主还要给出求值所在帧（DebugPanel 的选中帧）')
})
