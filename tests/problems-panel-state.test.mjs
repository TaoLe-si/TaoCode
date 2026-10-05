// dm/problems-view 的判词（三）：面板视图状态持久化。上游 `ProblemsViewState`
// （`platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/ProblemsViewState.kt:15-59`）
// 存在工作区文件里，重开工具窗口恢复上次取向。落点：`src/problemsPanelState.ts` + 面板挂载/变更时读写。
//
// 逐字段对照见 src/problemsPanelState.ts 的头注；这里钉住「解析 / 迁移 / 往返」三件事。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_PROBLEMS_PANEL_STATE, loadProblemsPanelState, parseProblemsPanelState, saveProblemsPanelState,
} from '../src/problemsPanelState.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('默认值：全显示 / 按严重度排序 / 不按名称 / 不分组 / 空查询 / 全展开', () => {
  assert.deepEqual(DEFAULT_PROBLEMS_PANEL_STATE, {
    hiddenSeverities: [], sortBySeverity: true, sortByName: false,
    grouping: 'none', query: '', collapsedGroups: [],
  })
  assert.deepEqual(parseProblemsPanelState(null), DEFAULT_PROBLEMS_PANEL_STATE)
  assert.deepEqual(parseProblemsPanelState('junk'), DEFAULT_PROBLEMS_PANEL_STATE)
})

test('逐字段校验：坏字段回默认，好字段保留', () => {
  assert.deepEqual(
    parseProblemsPanelState({ hiddenSeverities: [2], sortBySeverity: false, sortByName: true, grouping: 'file', query: 'unused', collapsedGroups: ['a', 'a', ''] }),
    { hiddenSeverities: [2], sortBySeverity: false, sortByName: true, grouping: 'file', query: 'unused', collapsedGroups: ['a'] },
    '折叠组去重且丢掉空串',
  )
  assert.deepEqual(
    parseProblemsPanelState({ grouping: 'nope', sortBySeverity: 1, sortByName: null, query: 42, hiddenSeverities: [9, 2], collapsedGroups: 'x' }),
    { hiddenSeverities: [2], sortBySeverity: true, sortByName: false, grouping: 'none', query: '', collapsedGroups: [] },
    '越界的严重度被丢掉，只认 1-4',
  )
})

test('旧存档的单选 severity 迁移成隐藏集合（单选「只看警告」= 藏起其余三档）', () => {
  assert.deepEqual(parseProblemsPanelState({ severity: 2 }).hiddenSeverities, [1, 3, 4])
  assert.deepEqual(parseProblemsPanelState({ severity: null }).hiddenSeverities, [])
  assert.deepEqual(
    parseProblemsPanelState({ severity: 1, hiddenSeverities: [3] }).hiddenSeverities, [3],
    '新字段在场时优先于旧字段',
  )
})

test('保存/读回在 Node 下不炸（无 localStorage 时静默），消费链在面板里', () => {
  saveProblemsPanelState({
    hiddenSeverities: [4], sortBySeverity: false, sortByName: true,
    grouping: 'directory', query: 'x', collapsedGroups: ['src/a'],
  })
  const state = loadProblemsPanelState()
  assert.ok(Array.isArray(state.hiddenSeverities))
  assert.ok(['none', 'file', 'directory', 'source'].includes(state.grouping))
  const panel = read('src/components/ProblemsPanel.vue')
  assert.match(panel, /loadProblemsPanelState\(\)/)
  assert.match(panel, /saveProblemsPanelState\(\{\s*hiddenSeverities: hiddenSeverities\.value/)
  assert.match(panel, /collapsedGroups: collapsedGroups\.value/, '展开态没有跟着存')
})
