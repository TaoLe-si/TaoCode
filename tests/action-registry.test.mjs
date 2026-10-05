// 动作注册表（`src/actionRegistry.ts`）—— 上游 `ActionManager` / `AnAction.update` /
// `Presentation` / `ActionUpdateThread` 的等价物，以及「菜单与键位从同一份注册表读」的机检。
//
// 覆盖：注册/替换/注销、id 查找、可用性谓词（enabled）、勾选态（checked）、不可用拒绝执行、
// presentation 世代、`actionRow` 从注册表取 title/keys/enabled/checked/run、
// 构建菜单与本地历史行确实由注册表驱动、键位尾部注册与分派、冲突报告（消费 `keymapConflicts`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ACTIONS, ActionRegistry, actionRow, registerKeymapActions } from '../src/actionRegistry.ts'
import { KEY_BINDINGS, keymapConflictReport, keymapConflicts } from '../src/keymapBindings.ts'
import { createBuildMenuRows } from '../src/menus/buildMenu.ts'
import { LOCAL_HISTORY_ACTION_ID, localHistoryMenuRow } from '../src/menus/localHistory.ts'

test('注册/替换/注销：id 唯一，查找与快照一致，世代随写入增长', () => {
  const registry = new ActionRegistry()
  let ran = 0
  registry.register({ id: 'demo.run', title: '演示', run: () => { ran++ } })
  assert.equal(registry.has('demo.run'), true)
  assert.equal(registry.size, 1)
  assert.deepEqual(registry.present('demo.run'), { id: 'demo.run', title: '演示', enabled: true, checked: false })
  assert.equal(registry.run('demo.run'), true)
  assert.equal(ran, 1)
  assert.equal(registry.run('missing'), false)

  // 同 id 再注册 = 替换（上游 replaceAction 的口径），旧处理器不再被调用。
  registry.register({ id: 'demo.run', title: '演示 v2', enabled: () => false, run: () => { ran++ } })
  assert.equal(registry.titleOf('demo.run'), '演示 v2')
  assert.equal(registry.run('demo.run'), false, 'enabled() 为 false 时 run 必须拒绝执行')
  assert.equal(ran, 1)

  const before = registry.presentationVersion
  registry.bumpPresentation()
  assert.equal(registry.presentationVersion, before + 1)
  assert.equal(registry.unregister('demo.run'), true)
  assert.equal(registry.has('demo.run'), false)
  assert.equal(registry.unregister('demo.run'), false)
})

test('勾选态与函数标题：checked 谓词实时求值，标题随状态变化', () => {
  const registry = new ActionRegistry()
  let checked = false
  registry.register({ id: 'toggle', title: () => (checked ? '开' : '关'), checked: () => checked, run: () => { checked = !checked } })
  assert.equal(registry.present('toggle').title, '关')
  assert.equal(registry.present('toggle').checked, false)
  registry.run('toggle')
  assert.equal(registry.present('toggle').title, '开')
  assert.equal(registry.present('toggle').checked, true)
})

test('actionRow 从注册表取 title/keywords/enabled/checked/run，keys 查键位表', () => {
  ACTIONS.register({ id: 'edit.copyPath', title: '', run: () => {} }) // 覆盖：验证行取注册表而不是键位表标题
  ACTIONS.register({
    id: 'demo.row', title: '演示行', keywords: 'demo keyword', checked: () => true,
    enabled: () => false, run: () => {},
  })
  const row = actionRow('demo.row')
  assert.equal(row.id, 'demo.row')
  assert.equal(row.title, '演示行')
  assert.equal(row.keywords, 'demo keyword')
  assert.equal(row.enabled(), false)
  assert.equal(row.checked(), true)
  assert.equal(row.keys, undefined)
  assert.equal(typeof row.run, 'function')

  // keys 从键位表读（edit.copyPath 的显示串在 KEY_BINDINGS 里），也可以经 keymapId 跨 id 取。
  assert.equal(actionRow('edit.copyPath').keys, 'Ctrl Shift C')
  ACTIONS.register({ id: 'demo.alias', title: '别名', run: () => {} })
  assert.equal(actionRow('demo.alias', { keymapId: 'docs.quickDoc' }).keys, 'Ctrl Q')
  assert.equal(actionRow('demo.alias', { keys: 'Ctrl 1' }).keys, 'Ctrl 1')
  assert.throws(() => actionRow('nope.not.registered'), /未注册/)
})

test('键位尾部注册进注册表，可用性谓词与 KEY_BINDINGS 的 when 同源', () => {
  const registry = new ActionRegistry()
  const handlers = new Map(KEY_BINDINGS.map(binding => [binding.id, () => {}]))
  let state = { workspace: true, editor: true, lsp: true }
  // 直接调用注册辅助函数（键位表 + 处理器 + 实时状态）。
  const local = new ActionRegistry()
  const original = ACTIONS
  // registerKeymapActions 写的是单例；这里用一个可观测的做法：注册后逐条核 present。
  registerKeymapActions(KEY_BINDINGS, binding => handlers.get(binding.id), () => state)
  for (const binding of KEY_BINDINGS) {
    const present = ACTIONS.present(binding.id)
    assert.ok(present, `${binding.id} 没有注册进动作注册表`)
    assert.equal(present.title, binding.label)
  }
  // 谓词实时求值：workspace 关掉后 symbol.class（workspaceLspWhen）必须不可用。
  state = { workspace: false, editor: true, lsp: true }
  assert.equal(ACTIONS.present('symbol.class').enabled, false)
  assert.equal(ACTIONS.present('file.openPath').enabled, true, 'Ctrl+Shift+O 在欢迎态也必须可用')
  assert.equal(ACTIONS.present('navigate.gotoLine').enabled, true, 'editor 仍为真')
  assert.equal(registry.size, 0, '新实例不受单例影响')
  assert.equal(original, ACTIONS)
})

test('构建菜单与本地历史行由注册表驱动：改注册表就改菜单表现', () => {
  const workspace = { value: { root: 'D:/P' } }
  const runState = { running: false }
  const started = []
  const rows = createBuildMenuRows({
    isDesktop: true, workspace, runState,
    startBuild: rebuild => started.push(rebuild), stopRun: () => {}, showOutput: () => {},
  })
  const byId = new Map(rows.map(row => [row.id, row]))
  assert.deepEqual([...byId.keys()], ['build.project', 'build.rebuild', 'build.stop', 'build.rule1', 'build.output'])
  assert.equal(byId.get('build.project').keys, 'Ctrl F9')
  assert.equal(byId.get('build.project').enabled(), true)
  // 运行中：构建/重构建关闭，停止构建打开 —— 谓词来自注册表里的那一条。
  runState.running = true
  assert.equal(byId.get('build.project').enabled(), false)
  assert.equal(byId.get('build.stop').enabled(), true)
  runState.running = false
  byId.get('build.project').run()
  assert.deepEqual(started, [false], '菜单行的 run 必须走注册表里的处理器')
  // 换掉注册表里的处理器，同一行的行为跟着变（行持有的是 ACTIONS.run(id)，不是拷贝）。
  ACTIONS.register({ id: 'build.project', title: '构建项目', source: 'menu', run: () => started.push('replaced') })
  byId.get('build.project').run()
  assert.deepEqual(started, [false, 'replaced'])

  const dialog = { value: false }
  const historyState = { dialog, canShow: () => true }
  const historyRow = localHistoryMenuRow(historyState)
  assert.equal(historyRow.id, LOCAL_HISTORY_ACTION_ID)
  assert.equal(ACTIONS.has(LOCAL_HISTORY_ACTION_ID), true)
  assert.equal(historyRow.enabled(), true)
  historyRow.run()
  assert.equal(dialog.value, true)
  // 不可用时 run 直接返回、不改状态（注册表复核 enabled）。
  dialog.value = false
  historyState.canShow = () => false
  historyRow.run()
  assert.equal(dialog.value, false)
})

test('键位冲突报告：无冲突时写明条数，有冲突时逐条列出（含生效者）', () => {
  assert.deepEqual(keymapConflicts(KEY_BINDINGS), [])
  const report = keymapConflictReport(KEY_BINDINGS)
  assert.match(report, new RegExp(`^键位冲突检查：${KEY_BINDINGS.length} 条绑定，0 处冲突。`))
  assert.match(report, /没有重复键位/)

  const duplicate = [
    { id: 'a.one', label: '一', display: 'Ctrl K', scope: 'global', chord: { key: 'k', control: 'ctrl' }, upstream: 'x' },
    { id: 'b.two', label: '二', display: 'Ctrl K', scope: 'global', chord: { key: 'k', control: 'ctrl' }, upstream: 'x' },
  ]
  const conflicted = keymapConflictReport(duplicate)
  assert.match(conflicted, /2 条绑定，1 处冲突/)
  assert.match(conflicted, /Ctrl K（global）绑了 2 个动作：a\.one、b\.two —— 生效的是 a\.one/)
})

test('接线：keymap.ts 经注册表分派、帮助菜单有冲突检查入口、构建/本地历史已迁', () => {
  const keymap = readFileSync('src/keymap.ts', 'utf8')
  // 注册进注册表的是**生效表**（出厂 + 用户覆盖 + 动态动作），不是出厂表本身 ——
  // 否则用户改过的键位与绑了键的宏都不参与分派。
  assert.match(keymap, /const bindings = effectiveKeyBindings\(\)/)
  assert.match(keymap, /registerKeymapActions\(bindings,/)
  assert.match(keymap, /ACTIONS\.has\(binding\.id\)/)
  assert.match(keymap, /ACTIONS\.run\(binding\.id\)/)
  const help = readFileSync('src/menus/helpMenu.ts', 'utf8')
  assert.match(help, /id: 'help\.keymapConflicts'/)
  assert.match(help, /keymapConflictReport\(\)/)
  assert.match(readFileSync('src/menus/buildMenu.ts', 'utf8'), /actionRow\('build\.project'/)
  assert.match(readFileSync('src/menus/localHistory.ts', 'utf8'), /actionRow\(LOCAL_HISTORY_ACTION_ID\)/)
  assert.match(readFileSync('src/actionRegistry.ts', 'utf8'), /anActionListener|actionEvents/)
})
