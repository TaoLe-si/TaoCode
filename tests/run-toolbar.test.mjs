// exec/run-toolbar 的两处补齐的判据：
//   · 运行 widget 的「最近配置」（RunManagerImpl.kt:589-628 的 MRU）—— `src/runToolbar.ts`；
//   · 运行 widget 末尾的「更多」弹层（`MoreRunToolbarActions`）—— 条目数据 + 工具条装配。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RECENT_RUN_CONFIG_LIMIT, RUN_TOOLBAR_MORE_ACTIONS, configIndexIn, orderRunConfigNames, rememberRecentConfiguration } from '../src/runToolbar.ts'

test('记住一次选择：置顶、去重、截断，且不改原数组', () => {
  const before = ['a', 'b', 'c']
  const after = rememberRecentConfiguration(before, 'c')
  assert.deepEqual(after, ['c', 'a', 'b'])
  assert.deepEqual(before, ['a', 'b', 'c'], '纯函数不改入参')
  assert.equal(rememberRecentConfiguration(after, 'd').length, 4)
  const many = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(rememberRecentConfiguration(many, 'f'), ['f', 'a', 'b', 'c', 'd'])
  assert.equal(rememberRecentConfiguration(many, 'f').length, RECENT_RUN_CONFIG_LIMIT)
  assert.deepEqual(rememberRecentConfiguration(before, '  '), before, '空名字不入最近')
})

test('选择器顺序：最近的在前，未知/已删的名字忽略，其余保持原顺序', () => {
  const names = ['Main', 'Tests', 'Build', 'Docs']
  assert.deepEqual(orderRunConfigNames(names, ['Tests', 'Main']), ['Tests', 'Main', 'Build', 'Docs'])
  assert.deepEqual(orderRunConfigNames(names, ['Gone', 'Build']), ['Build', 'Main', 'Tests', 'Docs'])
  assert.deepEqual(orderRunConfigNames(names, []), names)
})

test('索引落在排序后的列表上（打开弹层按当前配置选中）', () => {
  const ordered = orderRunConfigNames(['Main', 'Tests'], ['Tests'])
  assert.equal(configIndexIn(ordered, 'Tests'), 0)
  assert.equal(configIndexIn(ordered, 'Main'), 1)
  assert.equal(configIndexIn(ordered, '不存在'), 0, '找不到时落在第一项，与旧行为一致')
})

test('「更多」弹层的条目是运行侧真实动作（与 Run 菜单同源）', () => {
  assert.deepEqual(RUN_TOOLBAR_MORE_ACTIONS.map(action => action.id), ['run.rerun', 'run.stopAll', 'run.editConfigurations'])
  assert.equal(RUN_TOOLBAR_MORE_ACTIONS[0].keys, 'Ctrl+F5')
  const menu = readFileSync('src/menus/runMenu.ts', 'utf8')
  assert.match(menu, /id: 'run\.rerun'/, '重新运行与 Run 菜单同一条实现')
})

test('装配：App 注入条目、工具条渲染弹层、选择器吃 MRU 顺序', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  assert.match(app, /get moreRunActions\(\) \{ return RUN_TOOLBAR_MORE_ACTIONS \}/)
  assert.match(app, /v-for="\(name, index\) in orderedRunConfigNames"/)
  const toolbar = readFileSync('src/components/MainToolbar.vue', 'utf8')
  assert.match(toolbar, /aria-label="更多运行动作"/)
  assert.match(toolbar, /c\.moreRunActions/)
  const host = readFileSync('src/runConfigurations.ts', 'utf8')
  assert.match(host, /recentConfigNames\.value = rememberRecentConfiguration/)
  assert.match(host, /orderRunConfigNames\(allRunConfigNames\.value, recentConfigNames\.value\)/)
})
