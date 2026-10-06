// 动作注册表（`src/actionRegistry.ts`）—— 上游 `ActionManager` / `AnAction.update` /
// `Presentation` / `ActionUpdateThread` 的等价物，以及「菜单与键位从同一份注册表读」的机检。
//
// 覆盖：注册/替换/注销、id 查找、可用性谓词（enabled）、勾选态（checked）、不可用拒绝执行、
// presentation 世代、`actionRow` 从注册表取 title/keys/enabled/checked/run、
// 构建菜单与本地历史行确实由注册表驱动、键位尾部注册与分派、冲突报告（消费 `keymapConflicts`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ACTIONS, ActionRegistry, actionRow, registerEditorActions, registerKeymapActions } from '../src/actionRegistry.ts'
import { EDITOR_ACTIONS, KEY_BINDINGS, keymapConflictReport, keymapConflicts, keymapKeys } from '../src/keymapBindings.ts'
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

// 编辑器一族（`EDITOR_ACTIONS` 那六条）：上游 `$default.xml` 没有它们的键位（或那把键在编辑器的
// CodeMirror keymap 里），所以它们不进键位表、只进注册表 —— 注册了 `ACTIONS.has('line.sort')` 才为真，
// 插件命令与命令补全才按 id 认得它们；「查找操作」那边不会出双行（`menuUi.ts:246` 按 id 去重、菜单行优先）。
test('编辑器一族注册进动作注册表：不凭空长加速键，run 走宿主的 runEditor', () => {
  const called = []
  registerEditorActions(EDITOR_ACTIONS, name => called.push(name), () => true)
  for (const action of EDITOR_ACTIONS) {
    const present = ACTIONS.present(action.id)
    assert.ok(present, `${action.id} 没注册进动作注册表`)
    assert.equal(present.title, action.label, '标题与键位侧的注册条目同源（菜单行同一个 id 同一份文案）')
    assert.equal(present.enabled, true)
    assert.equal(keymapKeys(action.id), '', '注册表这一侧也不许凭空长出加速键')
    assert.equal(ACTIONS.run(action.id), true)
    assert.deepEqual(called.splice(0), [action.command], `${action.id} 的 run 必须只调 runEditor('${action.command}')`)
  }
  // 没有编辑器 ⇒ 与菜单行的 `enabled: hasEditor` 同口径置灰，`run()` 拒绝执行（上游 keymap 同样
  // 不会触发 `update()` 关掉的动作）。
  registerEditorActions(EDITOR_ACTIONS, name => called.push(name), () => false)
  assert.equal(ACTIONS.present('line.sort').enabled, false)
  assert.equal(ACTIONS.run('line.sort'), false)
  assert.deepEqual(called, [])
  // 接线面：分派器真的注册它们，而且**只在宿主给了 runEditor 之后**才注册（拿不到执行入口就不注册，
  // 而不是注册一个点了没反应的假动作）。
  const keymap = readFileSync('src/keymap.ts', 'utf8')
  assert.match(keymap, /runEditor\?: \(name: string\) => unknown/)
  assert.match(keymap, /if \(runEditor\) registerEditorActions\(EDITOR_ACTIONS, name => runEditor\(name\), \(\) => !!active\.value\)/)
})
