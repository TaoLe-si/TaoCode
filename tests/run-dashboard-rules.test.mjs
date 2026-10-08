// Run Dashboard 规则层判据（上游 `platform/execution.dashboard` 的分组/排序/显示/内容/动作）。
//
// 每条断言的出处写在上游 `文件:行号`（本文件用相对路径）。纯 JS（`.mjs` 不带类型语法）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  RUN_DASHBOARD_GROUPING_RULES, RUN_DASHBOARD_GROUPING_RULE_EP, RUN_DASHBOARD_STATUSES,
  RUN_DASHBOARD_ACTION_RULES, RUN_DASHBOARD_SERVICE_FIELD_NAMES, RUN_DASHBOARD_UNKNOWN_TYPE,
  activeRunDashboardGroupingRules, applyRunDashboardTypes, compareRunDashboardGroups,
  compareRunDashboardOrdering, emptyRunDashboardActionContext, emptyRunDashboardVisibilityState,
  flattenRunDashboardGroups, groupRunDashboardByRules, isShowInRunDashboard, isShownInRunDashboard,
  naturalCompare, runDashboardActionEnabled, runDashboardActionLabel, runDashboardActionSelected,
  runDashboardActionVisible, runDashboardEnableByDefaultTypes, runDashboardGroupEntry,
  runDashboardGroupingEnabled, runDashboardGroupingRule, runDashboardGroupPath,
  runDashboardGroupPathId, runDashboardIconDimmed, runDashboardIconSource, runDashboardNameEmphasis,
  runDashboardRowVisible, runDashboardRuleView, runDashboardStatusById, runDashboardStatusFor,
  runDashboardStatusOfRowState, runDashboardStatusVisible, runDashboardTypesFromState,
  sameRunDashboardConfiguration, sortRunDashboardOrdering, sortRunDashboardRows,
  sortedRunDashboardFolderNames, toggleRunDashboardGroupingRule, toggleRunDashboardStatusFilter,
} from '../src/runDashboardRules.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// ── 分组规则（RunDashboardGroupingRule + EP 注册） ──────────────────────────────

test('三条内置分组规则：名字/实现/EP order 链照 intellij.platform.execution.dashboard.xml:56-61', () => {
  assert.equal(RUN_DASHBOARD_GROUPING_RULE_EP, 'com.intellij.runDashboardGroupingRule',
    'EP id 逐字取自 RunDashboardGroupingRule.java:31')
  assert.deepEqual(RUN_DASHBOARD_GROUPING_RULES.map(rule => rule.id), ['type', 'status', 'folder'])
  assert.deepEqual(RUN_DASHBOARD_GROUPING_RULES.map(rule => rule.order),
    ['first', 'after type', 'after status'], 'order 链决定嵌套层次')
  assert.deepEqual(RUN_DASHBOARD_GROUPING_RULES.map(rule => rule.name), [
    'ConfigurationTypeDashboardGroupingRule',   // ConfigurationTypeDashboardGroupingRule.java:18
    'StatusDashboardGroupingRule',              // StatusDashboardGroupingRule.java:17
    'FolderDashboardGroupingRule',              // FolderDashboardGroupingRule.java:19
  ])
  // 默认开关：type 是 true（:29 getBoolean(NAME, true)）、status 是 false（:28 getBoolean(NAME, false)）、
  // folder 没有开关（:27-34 无 getBoolean；actions/ 里也没有它的 ToggleAction）
  assert.deepEqual(RUN_DASHBOARD_GROUPING_RULES.map(rule => rule.enabledByDefault), [true, false, true])
  assert.deepEqual(RUN_DASHBOARD_GROUPING_RULES.map(rule => rule.toggleAction), [
    'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationTypeAction',
    'com.intellij.platform.execution.dashboard.actions.GroupByConfigurationStatusAction',
    null,
  ])
  assert.equal(runDashboardGroupingRule('type')?.implementation.endsWith('ConfigurationTypeDashboardGroupingRule'), true)
  assert.equal(runDashboardGroupingRule('nope'), undefined, '认不出的规则不编一条')
})

test('规则开关：isSelected 取「存值 ?: 默认」，setSelected 取反（RunDashboardGroupingRuleToggleAction.java:46-61）', () => {
  const type = runDashboardGroupingRule('type')
  const status = runDashboardGroupingRule('status')
  const folder = runDashboardGroupingRule('folder')
  assert.equal(runDashboardGroupingEnabled(type, undefined), true)
  assert.equal(runDashboardGroupingEnabled(status, undefined), false)
  assert.equal(runDashboardGroupingEnabled(status, { StatusDashboardGroupingRule: true }), true)
  // folder 没有 ToggleAction ⇒ 恒生效，哪怕存了个 false
  assert.equal(runDashboardGroupingEnabled(folder, { FolderDashboardGroupingRule: false }), true)
  const flipped = toggleRunDashboardGroupingRule(status, undefined)
  assert.equal(flipped.StatusDashboardGroupingRule, true)
  assert.deepEqual(activeRunDashboardGroupingRules(undefined).map(rule => rule.id), ['type', 'folder'])
  assert.deepEqual(activeRunDashboardGroupingRules(flipped).map(rule => rule.id), ['type', 'status', 'folder'])
})

// ── 状态档（RunDashboardRunConfigurationStatus） ────────────────────────────────

test('状态四档的权重照 RunDashboardRunConfigurationStatus.java:21-28（10/20/30/40）', () => {
  assert.deepEqual(RUN_DASHBOARD_STATUSES.map(status => status.id), ['STARTED', 'FAILED', 'STOPPED', 'CONFIGURED'])
  assert.deepEqual(RUN_DASHBOARD_STATUSES.map(status => status.weight), [10, 20, 30, 40])
  assert.deepEqual(RUN_DASHBOARD_STATUSES.map(status => status.label), ['正在运行', '已失败', '已完成', '未启动'])
  // bundle 键照 ExecutionBundle.properties:373-376
  assert.deepEqual(RUN_DASHBOARD_STATUSES.map(status => status.labelKey), [
    'run.dashboard.started.group.name', 'run.dashboard.failed.group.name',
    'run.dashboard.stopped.group.name', 'run.dashboard.configured.group.name',
  ])
  assert.equal(runDashboardStatusById('FAILED')?.label, '已失败')
  assert.equal(runDashboardStatusById('NOPE'), null, ':79-89 认不出的 id 回 null')
  assert.equal(runDashboardStatusById(null), null)
})

test('getStatus 判据照 RunDashboardRunConfigurationStatus.java:59-76 的五条分支', () => {
  // descriptor == null ⇒ CONFIGURED（:60-62）
  assert.equal(runDashboardStatusFor(false, true, 3, false).id, 'CONFIGURED')
  // handler == null ⇒ STOPPED（:64-66）
  assert.equal(runDashboardStatusFor(true, false, 3, false).id, 'STOPPED')
  // exitCode == null ⇒ STARTED（:67-70）
  assert.equal(runDashboardStatusFor(true, true, null, false).id, 'STARTED')
  // exitCode == 0 ⇒ STOPPED（:71-73）
  assert.equal(runDashboardStatusFor(true, true, 0, false).id, 'STOPPED')
  // TERMINATION_REQUESTED ⇒ STOPPED，哪怕退出码非 0（:72）
  assert.equal(runDashboardStatusFor(true, true, 3, true).id, 'STOPPED')
  // 否则 FAILED（:75）
  assert.equal(runDashboardStatusFor(true, true, 3, false).id, 'FAILED')
  // 本仓四档 → 上游四档（ok 与 stopped 都落 STOPPED，:72-73 一条判据管两件事）
  assert.deepEqual(['running', 'ok', 'stopped', 'failed'].map(state => runDashboardStatusOfRowState(state).id),
    ['STARTED', 'STOPPED', 'STOPPED', 'FAILED'])
})

// ── 自然序（NaturalComparator） ────────────────────────────────────────────────

test('自然序：数字段按位数（NaturalComparator.java:57-59），忽略大小写（:26）', () => {
  assert.equal(Math.sign(naturalCompare('run2', 'run10')), -1, '2 < 10 而不是字符串序')
  assert.equal(Math.sign(naturalCompare('run10', 'run2')), 1)
  assert.equal(naturalCompare('same', 'same'), 0)
  assert.equal(Math.sign(naturalCompare('item 007', 'item 7')), 1, '位数相同再比含前导零的整段长度（:65-67）')
  assert.equal(Math.sign(naturalCompare('Run', 'run')), -1, '忽略大小写相等后再区分大小写比一遍（:104-105）')
  assert.equal(Math.sign(naturalCompare('a', 'ab')), -1, '前缀更短的在前面（:100-101）')
  assert.equal(Math.sign(naturalCompare('b', 'a')), 1)
})

// ── 组排序（ServiceModel.compareGroups） ───────────────────────────────────────

test('组排序：WeighedItem 优先、权重升序、再自然序（ServiceModel.java:535-552）', () => {
  const weighed = (name, weight) => ({ weighed: true, weight, name })
  const plain = name => ({ weighed: false, weight: 0, name })
  // 权重升序（:543）
  assert.ok(compareRunDashboardGroups(weighed('x', 10), weighed('y', 40)) < 0)
  assert.ok(compareRunDashboardGroups(weighed('y', 40), weighed('x', 10)) > 0)
  // 权重相等才比名字（:549-551）
  assert.ok(compareRunDashboardGroups(weighed('b', 10), weighed('a', 10)) > 0)
  // 带权重的一律在没权重的前面（:540-548）
  assert.ok(compareRunDashboardGroups(weighed('zzz', 40), plain('aaa')) < 0)
  assert.ok(compareRunDashboardGroups(plain('aaa'), weighed('zzz', 40)) > 0)
  // 都没权重 ⇒ 自然序
  assert.ok(compareRunDashboardGroups(plain('a2'), plain('a10')) < 0)
})

// ── 配置排序（RunManager.getAllSettings 的顺序） ─────────────────────────────────

test('文件夹名表：出现过的按自然序、null 加在最后（RunConfigurationListManagerHelper.kt:232-244）', () => {
  const entries = [
    { name: 'c', typeId: 'shell', typeDisplayName: 'Shell', folder: 'b' },
    { name: 'a', typeId: 'shell', typeDisplayName: 'Shell', folder: 'a10' },
    { name: 'b', typeId: 'shell', typeDisplayName: 'Shell', folder: 'a2' },
    { name: 'd', typeId: 'shell', typeDisplayName: 'Shell', folder: null },
  ]
  assert.deepEqual(sortedRunDashboardFolderNames(entries), ['a2', 'a10', 'b', null])
})

test('配置排序：类型 → 文件夹 → 临时在后 → 名字自然序（RunConfigurationListManagerHelper.kt:60-89/131-144）', () => {
  const entries = [
    { name: 'z', typeId: 'shell', typeDisplayName: 'Shell 命令', folder: null },
    { name: 'a', typeId: 'debug', typeDisplayName: '调试', folder: null },
    { name: 'm', typeId: 'shell', typeDisplayName: 'Shell 命令', folder: null },
  ]
  const folders = sortedRunDashboardFolderNames(entries)
  // 类型不同时比类型显示名（:67-69 → compareTypesForUi:266-273）：'Shell 命令' < '调试'? 按自然序比字符串
  const sorted = sortRunDashboardOrdering(entries).map(entry => entry.name)
  assert.equal(sorted.length, 3)
  // 同类型的两个按名字自然序：m 在 z 前面
  assert.ok(sorted.indexOf('m') < sorted.indexOf('z'), '同类型同文件夹按名字自然序（:138）')
  // 未知类型永远排最后（:269-270）
  const withUnknown = [
    { name: 'x', typeId: RUN_DASHBOARD_UNKNOWN_TYPE, typeDisplayName: '其它', folder: null },
    { name: 'y', typeId: 'shell', typeDisplayName: 'Shell 命令', folder: null },
  ]
  assert.equal(sortRunDashboardOrdering(withUnknown)[0].name, 'y', '未知类型排最后')
  // 临时配置在同类型同文件夹时排后面（:79-87）
  const temporary = [
    { name: 't', typeId: 'shell', typeDisplayName: 'S', folder: null, temporary: true },
    { name: 's', typeId: 'shell', typeDisplayName: 'S', folder: null },
  ]
  assert.equal(sortRunDashboardOrdering(temporary)[0].name, 's', '非临时在前')
  // 文件夹顺序按文件夹名表的下标（:71-77）
  const folderRows = [
    { name: 'n', typeId: 'shell', typeDisplayName: 'S', folder: 'zz' },
    { name: 'f', typeId: 'shell', typeDisplayName: 'S', folder: 'aa' },
  ]
  const folderNames = sortedRunDashboardFolderNames(folderRows)
  assert.equal(compareRunDashboardOrdering(folderRows[1], folderRows[0], folderNames) < 0, true,
    'aa 的文件夹下标在前 ⇒ 排在 zz 前')
})

test('自定义顺序（doCustomSort，:171-191）：按用户下标，两边都没下标才比名字', () => {
  const entries = [
    { name: 'a', typeId: 'shell', typeDisplayName: 'S', folder: null },
    { name: 'b', typeId: 'shell', typeDisplayName: 'S', folder: null },
    { name: 'c', typeId: 'shell', typeDisplayName: 'S', folder: null },
  ]
  assert.deepEqual(sortRunDashboardOrdering(entries, { c: 0, b: 1, a: 2 }).map(entry => entry.name),
    ['c', 'b', 'a'])
})

// ── 显示判据（isShowInDashboard） ───────────────────────────────────────────────

test('isShown：类型白名单 + 隐藏表/显示表两档（RunDashboardManagerImpl.java:382-390）', () => {
  const base = { ...emptyRunDashboardVisibilityState(), types: ['shell'] }
  const config = { typeId: 'shell', name: 'App' }
  assert.equal(isShownInRunDashboard(config, base), true)
  assert.equal(isShownInRunDashboard({ typeId: 'debug', name: 'App' }, base), false, ':383 类型不在表里')
  assert.equal(isShownInRunDashboard(config, { ...base, hidden: [config] }), false, ':387-389')
  // excludedNewTypes 那一档：默认隐藏，只有显式 shown 才算显示（:384-386）
  const excluded = { ...base, excludedNewTypes: ['shell'] }
  assert.equal(isShownInRunDashboard(config, excluded), false)
  assert.equal(isShownInRunDashboard(config, { ...excluded, shown: [config] }), true)
  // isSameConfiguration 是「类型 id + 名字」（:397-399）
  assert.equal(sameRunDashboardConfiguration({ typeId: 'shell', name: 'A' }, { typeId: 'shell', name: 'A' }), true)
  assert.equal(sameRunDashboardConfiguration({ typeId: 'shell', name: 'A' }, { typeId: 'shell', name: 'B' }), false)
  assert.equal(sameRunDashboardConfiguration({ typeId: 'shell', name: 'A' }, { typeId: 'debug', name: 'A' }), false)
})

test('isShowInDashboard 递归到委托配置（RunDashboardManagerImpl.java:371-380/392-395）', () => {
  const state = { ...emptyRunDashboardVisibilityState(), types: ['compound'] }
  const member = { typeId: 'shell', name: 'App' }
  const wrapper = { typeId: 'compound', name: 'All' }
  assert.equal(isShowInRunDashboard(member, state), false)
  assert.equal(isShowInRunDashboard(member, state, wrapper), true, '本配置不算显示时看委托配置')
  assert.equal(isShowInRunDashboard(member, state, null), false, '没有基配置就是 false')
})

test('setTypes 的状态算术与 loadState 的合并（RunDashboardManagerImpl.java:407-430/946-953）', () => {
  const enableByDefault = runDashboardEnableByDefaultTypes([['a'], ['b', 'a']])
  assert.deepEqual(enableByDefault, ['a', 'b'], ':884-891 并集去重')
  const applied = applyRunDashboardTypes({ configurationTypes: ['c'], excludedTypes: [], excludedNewTypes: ['c', 'z'] },
    ['a', 'c'], enableByDefault)
  // configurationTypes = types - enableByDefault（:414-417）
  assert.deepEqual(applied.configurationTypes, ['c'])
  // excludedTypes = enableByDefault - types（:418-420）
  assert.deepEqual(applied.excludedTypes, ['b'])
  // excludedNewTypes 只留仍在 types 里的（:422）
  assert.deepEqual(applied.excludedNewTypes, ['c'])
  // loadState：configurationTypes ∪ (enableByDefault - excludedTypes)（:949-953）
  assert.deepEqual(runDashboardTypesFromState({ configurationTypes: ['c'], excludedTypes: ['b'] }, enableByDefault).sort(),
    ['a', 'c'])
})

// ── 分组链（RunDashboardServiceViewContributor.getGroups） ─────────────────────

test('分组链：按 EP 顺序逐条问，后面的组挂在前面的组下面（RunDashboardServiceViewContributor.java:126-142）', () => {
  const row = { type: 'shell', state: 'running', folder: 'svc' }
  // type 默认开、status 默认关 ⇒ 默认链只有 type 与 folder
  assert.deepEqual(runDashboardGroupPath(row).map(entry => entry.kind), ['type', 'folder'])
  const withStatus = { StatusDashboardGroupingRule: true }
  assert.deepEqual(runDashboardGroupPath(row, withStatus).map(entry => entry.kind), ['type', 'status', 'folder'])
  // 没有文件夹的行不产出 folder 组（FolderDashboardGroupingRule.java:29-33 返回 null）
  assert.deepEqual(runDashboardGroupPath({ type: 'shell', state: 'ok' }, withStatus).map(entry => entry.kind),
    ['type', 'status'])
  // type 组的 value = typeId（ConfigurationTypeDashboardGroupingRule.java:32-33）
  const typeEntry = runDashboardGroupEntry(runDashboardGroupingRule('type'), row)
  assert.equal(typeEntry.value, 'shell')
  assert.equal(typeEntry.weighed, false, 'type 组的值是 String ⇒ 权重 0（RunDashboardServiceViewContributor.java:477-481）')
  // status 组的 value 是状态对象 ⇒ 带权重（StatusDashboardGroupingRule.java:31-33）
  const statusEntry = runDashboardGroupEntry(runDashboardGroupingRule('status'), row)
  assert.equal(statusEntry.value, 'STARTED')
  assert.deepEqual([statusEntry.weighed, statusEntry.weight], [true, 10])
})

test('组的身份：嵌套路径用 / 连、叶子取组名（RunDashboardServiceViewContributor.java:508-524）', () => {
  const path = runDashboardGroupPath({ type: 'shell', state: 'running', folder: 'svc' },
    { StatusDashboardGroupingRule: true })
  // 三条内置规则的 value 都不是 ConfigurationType ⇒ 每段取 getName()
  assert.equal(runDashboardGroupPathId(path), 'Shell 命令/正在运行/svc')
})

test('分组：嵌套成树，同层组按 compareGroups 排、行挂在最深一层', () => {
  const rows = [
    { type: 'shell', state: 'running', folder: 'b' },
    { type: 'shell', state: 'ok', folder: 'b' },
    { type: 'shell', state: 'failed', folder: null },
  ]
  const { groups, ungrouped } = groupRunDashboardByRules(rows, { StatusDashboardGroupingRule: true })
  assert.equal(ungrouped.length, 0)
  assert.equal(groups.length, 1, '只有 shell 一个类型组')
  const typeNode = groups[0]
  assert.equal(typeNode.kind, 'type')
  // 状态组按权重排：STARTED(10) → STOPPED(30) → FAILED(20)？实际权重序是 10,20,30 ⇒ STARTED, FAILED, STOPPED
  assert.deepEqual(typeNode.children.map(node => node.value), ['STARTED', 'FAILED', 'STOPPED'])
  // STARTED 与 STOPPED 两支各有自己的文件夹组（组的身份只由 value 决定，
  // RunDashboardGroupImpl.java:37-50 ⇒ 不同父组下的同名文件夹是两个组）
  const started = typeNode.children[0]
  assert.equal(started.children.length, 1)
  assert.equal(started.children[0].value, 'b')
  assert.equal(started.children[0].rows.length, 1)
  const stopped = typeNode.children[2]
  assert.equal(stopped.children.length, 1)
  assert.equal(stopped.children[0].value, 'b')
  // 没有文件夹的行直接挂在状态组上
  assert.equal(typeNode.children[1].rows.length, 1, 'FAILED 那支没有文件夹 ⇒ 行挂状态组')
  const flat = flattenRunDashboardGroups(groups)
  assert.equal(flat.length, 1 + 3 + 2, 'type + 3 个状态 + 2 个文件夹组（STARTED/STOPPED 各一个）')
  assert.equal(flat.filter(item => item.node.value === 'b').map(item => item.pathId).sort().join(' | '),
    ['Shell 命令/正在运行/b', 'Shell 命令/已完成/b'].sort().join(' | '),
    '同一文件夹挂在两个状态组下 ⇒ 两个不同的节点 id')
})

// ── 行的字段/图标/动作 ────────────────────────────────────────────────────────

test('行字段面：13 个字段逐字照 RunDashboardServiceDto.kt:14-29', () => {
  assert.deepEqual(RUN_DASHBOARD_SERVICE_FIELD_NAMES, [
    'uuid', 'name', 'iconId', 'typeId', 'typeDisplayName', 'typeIconId', 'folderName',
    'contentId', 'isRemovable', 'serviceViewId', 'isStored',
    'isActivateToolWindowBeforeRun', 'isFocusToolWindowBeforeRun',
  ])
})

test('名字强调与图标来源照 FrontendRunConfigurationNode.java:93-105/128-142', () => {
  assert.equal(runDashboardNameEmphasis(true, true), 'bold', 'stored 且有 content ⇒ 加粗（:94-98）')
  assert.equal(runDashboardNameEmphasis(true, false), 'regular', 'stored 无 content ⇒ 常规（:99）')
  assert.equal(runDashboardNameEmphasis(false, true), 'grayed-bold', '非 stored ⇒ 灰色加粗（:100-102）')
  assert.equal(runDashboardIconDimmed(false), true, '非 stored 的图标是置灰版（:105）')
  assert.equal(runDashboardIconDimmed(true), false)
  assert.equal(runDashboardIconSource('STARTED', true, true, true), 'executor', ':131-133')
  assert.equal(runDashboardIconSource('FAILED', true, true, true), 'status', ':134-136')
  assert.equal(runDashboardIconSource('STOPPED', false, false, true), 'dto', ':137-141')
  assert.equal(runDashboardIconSource('STOPPED', false, false, false), 'none')
})

test('动作表：id/组/开关默认值照 intellij.platform.execution.dashboard.xml:71-135', () => {
  const ids = RUN_DASHBOARD_ACTION_RULES.map(rule => rule.id)
  for (const expected of [
    'RunDashboard.Run', 'RunDashboard.Stop', 'RunDashboard.EditConfiguration',
    'RunDashboard.CopyConfiguration', 'RunDashboard.HideConfiguration',
    'RunDashboard.RestoreHiddenConfigurations', 'RunDashboard.RemoveType',
    'RunDashboard.OpenRunningConfigInNewTab', 'RunDashboard.ClearConsole', 'RunDashboard.ClearContent',
    'RunDashboard.RestoreConfiguration', 'RunDashboard.GroupConfigurations',
    'RunDashboard.UngroupConfigurations', 'RunDashboard.GroupByType', 'RunDashboard.GroupByStatus',
    'RunDashboard.DoubleClickRun',
  ]) {
    assert.ok(ids.includes(expected), `动作表缺 ${expected}`)
  }
  assert.deepEqual(RUN_DASHBOARD_ACTION_RULES.filter(rule => rule.group === 'toolbar').map(rule => rule.id),
    ['RunDashboard.Run', 'RunDashboard.Stop'], ':80-86 工具条只有 Run/Stop（ExpandAll/CollapseAll 是平台引用）')
  const open = RUN_DASHBOARD_ACTION_RULES.find(rule => rule.id === 'RunDashboard.OpenRunningConfigInNewTab')
  assert.equal(open.defaultOn, false, 'RunDashboardManagerImpl.java:1036 openRunningConfigInTab = false')
  const dbl = RUN_DASHBOARD_ACTION_RULES.find(rule => rule.id === 'RunDashboard.DoubleClickRun')
  assert.equal(dbl.defaultOn, true, 'RunDashboardDoubleClickRunAction.kt:45 默认 true')
})

test('动作可用性/可见性判据照各自 update()（含「不在右键菜单里就藏」那一档）', () => {
  const ctx = { ...emptyRunDashboardActionContext(), selectionCount: 2, runnableCount: 1, runningCount: 1 }
  assert.equal(runDashboardActionEnabled('RunDashboard.Run', ctx), true)
  assert.equal(runDashboardActionVisible('RunDashboard.Run', ctx), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.Stop', ctx), true, 'StopAction.kt:21-24 有人在跑')
  // 不可用时：右键菜单里藏、工具条上留着（StopAction.kt:25）
  const idle = { ...emptyRunDashboardActionContext(), selectionCount: 1 }
  assert.equal(runDashboardActionVisible('RunDashboard.Stop', idle), true, '不在右键菜单 ⇒ 可见但置灰')
  assert.equal(runDashboardActionVisible('RunDashboard.Stop', { ...idle, fromContextMenu: true }), false, '右键菜单里藏')
  // Edit/Copy 是单行选中（RunDashboardActionUtils.kt:15-17）
  assert.equal(runDashboardActionEnabled('RunDashboard.EditConfiguration', ctx), false)
  assert.equal(runDashboardActionEnabled('RunDashboard.EditConfiguration', idle), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.CopyConfiguration', idle), true)
  // Hide 看选中非空（HideConfigurationAction.java:32-35）
  assert.equal(runDashboardActionEnabled('RunDashboard.HideConfiguration', idle), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.HideConfiguration', emptyRunDashboardActionContext()), false)
  // Restore hidden / RemoveType 各自的判据
  assert.equal(runDashboardActionEnabled('RunDashboard.RestoreHiddenConfigurations',
    { ...emptyRunDashboardActionContext(), hasHiddenConfigurations: true }), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.RemoveType',
    { ...emptyRunDashboardActionContext(), selectedTypeCount: 1 }), true)
  // ClearConsole 要控制台有内容（ClearConsoleAction.kt:21-26）
  assert.equal(runDashboardActionEnabled('RunDashboard.ClearConsole',
    { ...emptyRunDashboardActionContext(), consoleWithContentCount: 1 }), true)
  // ClearContent / RestoreConfiguration 各自那一档
  assert.equal(runDashboardActionEnabled('RunDashboard.ClearContent',
    { ...emptyRunDashboardActionContext(), clearableContentCount: 1 }), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.RestoreConfiguration',
    { ...emptyRunDashboardActionContext(), restorableCount: 1 }), true)
  // Ungroup 要选中的组全是文件夹组（UngroupConfigurationsActions.java:31-34）
  assert.equal(runDashboardActionEnabled('RunDashboard.UngroupConfigurations',
    { ...emptyRunDashboardActionContext(), selectionCount: 1, allTargetsAreFolderGroups: true }), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.UngroupConfigurations',
    { ...emptyRunDashboardActionContext(), selectionCount: 1, allTargetsAreFolderGroups: false }), false)
  // DoubleClickRun 的可见性要工具窗口 id 对得上（RunDashboardDoubleClickRunAction.kt:25-31）
  assert.equal(runDashboardActionEnabled('RunDashboard.DoubleClickRun', emptyRunDashboardActionContext()), false)
  assert.equal(runDashboardActionEnabled('RunDashboard.DoubleClickRun',
    { ...emptyRunDashboardActionContext(), doubleClickRunVisible: true }), true)
  assert.equal(runDashboardActionEnabled('RunDashboard.Nope', ctx), false, '认不出的动作不编默认可用')
})

test('Run/Rerun 文案随「选中里有人在跑」切换（RunAction.kt:14-26）', () => {
  const running = { ...emptyRunDashboardActionContext(), selectionCount: 1, runningCount: 1 }
  const idle = { ...emptyRunDashboardActionContext(), selectionCount: 1 }
  assert.equal(runDashboardActionLabel('RunDashboard.Run', running), '重新运行')
  assert.equal(runDashboardActionLabel('RunDashboard.Run', idle), '运行')
  // 固定文案取本地化包原文
  assert.equal(runDashboardActionLabel('RunDashboard.HideConfiguration', idle), '隐藏配置')
  assert.equal(runDashboardActionLabel('RunDashboard.GroupConfigurations', idle), '组配置')
})

test('开关动作的选中态：两个分组开关 + 新标签页 + 双击运行', () => {
  const ctx = {
    ...emptyRunDashboardActionContext(),
    openRunningConfigInNewTab: true,
    groupingEnabled: { StatusDashboardGroupingRule: true },
  }
  assert.equal(runDashboardActionSelected('RunDashboard.OpenRunningConfigInNewTab', ctx), true)
  assert.equal(runDashboardActionSelected('RunDashboard.GroupByStatus', ctx), true)
  assert.equal(runDashboardActionSelected('RunDashboard.GroupByType', ctx), true, '没存过 ⇒ 默认 true')
  assert.equal(runDashboardActionSelected('RunDashboard.DoubleClickRun', ctx), true, '默认 true')
})

// ── 状态过滤器（RunDashboardStatusFilter） ─────────────────────────────────────

test('状态过滤器：默认全显示，隐藏某个状态后那一档的行不渲染（RunDashboardStatusFilter.java:18-32）', () => {
  const empty = { hidden: [] }
  assert.equal(runDashboardStatusVisible('FAILED', empty), true)
  assert.equal(runDashboardStatusVisible('FAILED', { hidden: ['FAILED'] }), false)
  const hidden = toggleRunDashboardStatusFilter(empty, 'FAILED', false)
  assert.deepEqual(hidden.hidden, ['FAILED'])
  assert.equal(runDashboardRowVisible({ type: 'shell', state: 'failed' }, hidden), false)
  assert.equal(runDashboardRowVisible({ type: 'shell', state: 'running' }, hidden), true)
  const shown = toggleRunDashboardStatusFilter(hidden, 'FAILED', true)
  assert.deepEqual(shown.hidden, [])
  // 开关的构造顺序照 RunDashboardFilterActionGroup.java:38：STARTED, FAILED, STOPPED, CONFIGURED
  assert.deepEqual(RUN_DASHBOARD_STATUSES.map(status => status.id), ['STARTED', 'FAILED', 'STOPPED', 'CONFIGURED'])
})

// ── 与 runDashboard.ts 的关系（复用，不重写） ───────────────────────────────────

test('规则层复用 runDashboard.ts 的行与类型标签，不重定义它们', () => {
  const rules = read('src/runDashboardRules.ts')
  const existing = read('src/runDashboard.ts')
  // 上游那两件事已经在 runDashboard.ts 里（本文件只 import，不再定义一遍）
  assert.match(existing, /export function runDashboardRows\(/)
  assert.match(existing, /export function groupRunDashboardRows\(/)
  assert.match(rules, /from '\.\/runDashboard\.ts'/)
  assert.doesNotMatch(rules, /export function runDashboardRows\(/)
  assert.doesNotMatch(rules, /export function groupRunDashboardRows\(/)
  // 「其它」那一档也复用，不另立一个常量
  assert.match(rules, /RUN_DASHBOARD_OTHER_TYPE/)
  assert.doesNotMatch(rules, /export const RUN_DASHBOARD_OTHER_TYPE/)
})

test('规则层的入口：重排 + 重分组（不替代 MainToolbar 接线中的 groupRunDashboardRows）', () => {
  const rows = [
    { id: 1, title: 'b', state: 'ok', type: 'shell', statusText: '', elapsedText: '', pid: 0,
      stoppable: false, kill: false, stopText: '', description: '' },
    { id: 2, title: 'a', state: 'running', type: 'shell', statusText: '', elapsedText: '', pid: 0,
      stoppable: true, kill: false, stopText: '', description: '' },
  ]
  const view = runDashboardRuleView(rows)
  assert.equal(view.groups.length, 1)
  assert.deepEqual(view.groups[0].rows.map(row => row.title), ['a', 'b'], '名字自然序（sortAlphabetically）')
  // 状态过滤器挡住 failed 那一档
  const filtered = runDashboardRuleView([...rows, { ...rows[0], id: 3, title: 'c', state: 'failed' }],
    undefined, { hidden: ['FAILED'] })
  assert.equal(filtered.groups[0].rows.length, 2, 'failed 那一行不渲染')
})

test('排序入口对 RunDashboardRow 直接可用（title/type 两格就是上游的 name/type）', () => {
  const rows = [
    { title: 'App10', type: 'shell' },
    { title: 'App2', type: 'shell' },
  ]
  assert.deepEqual(sortRunDashboardRows(rows).map(row => row.title), ['App2', 'App10'])
})
