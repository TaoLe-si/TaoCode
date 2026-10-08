// 调试器「按类型分组的帧/变量树」的判据（上游 `XValueGroup` / `XValueGroupNodeImpl`）。
//
// 这一族落在 `src/debugFrameTree.ts`（分组派生 + 组键 + 展开态跨会话存档），
// 消费点两处：`src/debugDataView.ts`（变量树/求值结果树摊平，调 `groupChildrenByType`）与
// `src/components/DebugPanel.vue`（分组开关 + 全部展开/收起 + 存档读回）。
//
// 上游形状（逐条核过，注释里带坐标）：
//   · `XValueGroup`（`platform/xdebugger-api/src/com/intellij/xdebugger/frame/XValueGroup.java:13-48`）：
//     `getName()` / `getComment()` / `getSeparator()`（默认 `" = "`，`:42`）/ `isAutoExpand()`
//     （默认 false，`:30`）/ `isRestoreExpansion()`（默认 false，`:37`）；
//   · `XValueGroupNodeImpl`（`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/nodes/XValueGroupNodeImpl.java:16-72`）：
//     组节点文本 = 名字 + 分隔符 + 注释（`:22-26`）；初始展开态按 `isRestoreExpansion()` 读
//     `PropertiesComponent`（`:43-50`）；展开态变化时写回（`:52-60`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GROUP_SEPARATOR, allGroupsExpanded, collapseGroups, expandGroups, groupChildrenByType, groupComment,
  groupLabel, groupRowKeys, isGroupKey, parseGroupExpansion, readGroupExpansion, typeGroupKey,
  writeGroupExpansion,
} from '../src/debugFrameTree.ts'
import { collectVarRows } from '../src/debugDataView.ts'

const v = (name, value, reference = 0, named = true, type) => ({ name, value, reference, named, type })
const entry = (variable, index) => ({ variable, index })

test('按 type 归组：组按首次出现排序、组内保持原顺序、无类型成员留在组外', () => {
  const grouping = groupChildrenByType([
    entry(v('a', '1', 0, true, 'int'), 0),
    entry(v('b', 'x', 0, true, 'String'), 1),
    entry(v('c', '2', 0, true, 'int'), 2),
    entry(v('d', '3'), 3),
  ])
  assert.deepEqual(grouping.groups.map(g => g.type), ['int', 'String'], '组序 = 首次出现序')
  assert.deepEqual(grouping.groups[0].members.map(m => m.variable.name), ['a', 'c'], '组内保持原顺序')
  assert.deepEqual(grouping.ungrouped.map(m => m.variable.name), ['d'], '无类型成员不归组')
  assert.deepEqual(grouping.ungrouped.map(m => m.index), [3], '组外成员保留原始下标')
})

test('组的可观察字段照 XValueGroup：名字 / 注释 / 分隔符 / 初始展开态 / 是否跨会话存', () => {
  const grouping = groupChildrenByType([entry(v('a', '1', 0, true, 'int'), 0), entry(v('b', '2', 0, true, 'int'), 1)])
  const group = grouping.groups[0]
  assert.equal(group.type, 'int', 'getName()')
  assert.equal(group.comment, groupComment(2), 'getComment() = 成员数')
  assert.equal(group.comment, '2 项')
  assert.equal(group.separator, GROUP_SEPARATOR, 'getSeparator() 的默认值')
  assert.equal(GROUP_SEPARATOR, ' = ', '上游 XValueGroup.java:42')
  assert.equal(group.autoExpand, false, 'isAutoExpand() 默认 false（与既有行为一致：组默认收起）')
  assert.equal(group.restoreExpansion, true, 'isRestoreExpansion()：本仓的组都跨会话存')
  assert.equal(groupLabel(group), 'int = 2 项', '组行文本 = 名字 + 分隔符 + 注释（XValueGroupNodeImpl:22-26）')
  // 没有注释时只剩名字（分隔符不空挂）。
  assert.equal(groupLabel({ ...group, comment: '' }), 'int')
})

test('type 前后空白被吃掉（" int " 与 "int" 是同一组）', () => {
  const grouping = groupChildrenByType([entry(v('a', '1', 0, true, ' int '), 0), entry(v('b', '2', 0, true, 'int'), 1)])
  assert.equal(grouping.groups.length, 1)
  assert.equal(grouping.groups[0].members.length, 2)
})

test('组键的拼法与识别：与 debugDataView 造键规则同一个', () => {
  assert.equal(typeGroupKey('s0-', 'int'), 's0-g|int')
  assert.equal(typeGroupKey('eval-', 'std::vector'), 'eval-g|std::vector')
  assert.equal(isGroupKey('s0-g|int'), true)
  assert.equal(isGroupKey('s0-0'), false)
  assert.equal(isGroupKey('eval-3'), false)
})

test('展开态存档：只收组键、只认 true；坏存档退回空表（永不抛）', () => {
  assert.deepEqual(parseGroupExpansion(null), {})
  assert.deepEqual(parseGroupExpansion(''), {})
  assert.deepEqual(parseGroupExpansion('not json'), {})
  assert.deepEqual(parseGroupExpansion('[1,2]'), {}, '数组不是一张键表')
  assert.deepEqual(parseGroupExpansion(JSON.stringify({ 's0-g|int': true, 's0-0': true, 'eval-g|x': false })), { 's0-g|int': true },
    '普通行键与 false 都不进存档')
})

test('存档读写走 localStorage 的形状（读回、写回、清空）', () => {
  const store = new Map()
  const storage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) }
  assert.deepEqual(readGroupExpansion(storage, '/ws'), {}, '没存过 = 空表')
  writeGroupExpansion(storage, '/ws', { 's0-g|int': true, 's0-0': true, 's0-g|String': false })
  assert.deepEqual(readGroupExpansion(storage, '/ws'), { 's0-g|int': true }, '只存组键的 true')
  // 换工作区是另一份存档（上游落在工程工作区文件里）。
  assert.deepEqual(readGroupExpansion(storage, '/other'), {})
  // 全部收起后写回空串（不在存档里留空壳）。
  writeGroupExpansion(storage, '/ws', { 's0-0': true })
  assert.equal(store.get('taocode.debug.groupExpansion.%2Fws'), '')
  assert.deepEqual(readGroupExpansion(storage, '/ws'), {})
})

test('全部展开 / 全部收起 / 全展开判定只作用在组键上', () => {
  const rows = [{ key: 's0', group: false }, { key: 's0-g|int', group: true }, { key: 's0-g|String', group: true }]
  assert.deepEqual(groupRowKeys(rows), ['s0-g|int', 's0-g|String'])
  const open = { s0: true, 's0-0': true }
  const expanded = expandGroups(open, rows)
  assert.equal(expanded['s0-g|int'], true)
  assert.equal(expanded['s0-g|String'], true)
  assert.equal(expanded.s0, true, '普通行的展开态不动')
  assert.equal(allGroupsExpanded(expanded, rows), true)
  const collapsed = collapseGroups(expanded, rows)
  assert.equal('s0-g|int' in collapsed, false, '收起 = 删键（缺省即收起）')
  assert.equal(collapsed.s0, true, '普通行仍不动')
  assert.equal(allGroupsExpanded(collapsed, rows), false)
  assert.equal(allGroupsExpanded({}, []), false, '一个组都没有时不算"全展开"')
})

test('debugDataView 用的是同一份派生：同层同类型聚组、组默认收起、展开后成员深度 +1', () => {
  const scopes = [{ name: 'Locals', reference: 1, variablesReference: 1, expensive: false }]
  const values = { 1: [v('a', '1', 0, true, 'int'), v('b', 'x', 0, true, 'String'), v('c', '2', 0, true, 'int'), v('d', '3')] }
  const rows = collectVarRows(scopes, values, { s0: true }, { hideNullValues: false, sortByName: false, groupByType: true })
  assert.deepEqual(rows.map(r => r.name), ['Locals', 'int', 'String', 'd'])
  assert.equal(rows[1].group, true)
  assert.equal(rows[1].value, '2 项')
  assert.equal(rows[1].expanded, false, '组默认收起')
  const expanded = collectVarRows(scopes, values, { s0: true, 's0-g|int': true }, { hideNullValues: false, sortByName: false, groupByType: true })
  assert.deepEqual(expanded.map(r => r.name), ['Locals', 'int', 'a', 'c', 'String', 'd'])
  assert.equal(expanded[2].depth, expanded[1].depth + 1)
  assert.equal(expanded[2].container, 1, '组内成员仍以作用域为容器（可改值）')
})

test('DebugPanel 接线：分组开关、全部展开/收起、存档读写与图标都真的接上', () => {
  // 面板侧状态（开关 + 存档 + 全部展开/收起）在 src/debugGroupView.ts（DebugPanel 贴着 900 行上限，
  // 2026-10-06 拆出）；面板只调它、并把开关/动作接到模板上。
  const view = readFileSync('src/debugGroupView.ts', 'utf8')
  assert.match(view, /readGroupExpansion\(deps\.storage, deps\.root\(\)\)/, '打开面板读回组展开态')
  assert.match(view, /writeGroupExpansion\(deps\.storage, deps\.root\(\), deps\.open\)/, '组键变化写回存档')
  assert.match(view, /allGroupsExpanded\(deps\.open, deps\.rows\(\)\)/, '全展开判定接的是组键')
  assert.match(view, /expandGroups\(deps\.open, deps\.rows\(\)\)|collapseGroups\(deps\.open, deps\.rows\(\)\)/, '全部展开/收起接的是组键')
  const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')
  assert.match(panel, /createDebugGroupView\(\{/, '面板建了分组视图状态')
  assert.match(panel, /rows: \(\) => varRows\.value, open,/, '面板把渲染行与 open 表注入')
  assert.match(panel, /v-if="groupByType"[\s\S]{0,400}@click="toggleAllGroups"/, '展开/收起按钮只在分组开着时出现')
  assert.match(panel, /ChevronsUpDown :size="iconSize\.chip"/, '展开/收起按钮有图标')
})