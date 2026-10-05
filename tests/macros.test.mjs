// 宏（录制/回放）的规则与接线单测。
//
// 源码依据（路径见 src/macros.ts 头部）：
//   · `ActionMacro.java`（三类步骤 / `MACRO_ACTION_PREFIX = "Macro."` / `appendKeyPressed` 的合并）
//   · `ActionMacroManager.kt`（录制钩子 `:100-121`、`startRecording :148`、`stopRecording :279-305`、
//     `InvokeMacroAction` 的防递归 `:469-490`、`KeyPostProcessor :496+`）
//   · 菜单 `PlatformActions.xml:506-510`（EditMenu 内的 Macros 子菜单）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  ANONYMOUS_MACRO_LABEL, MACRO_ACTION_PREFIX, MACRO_STORAGE_KEY, actionStepCount, appendAction, appendShortcut,
  appendTyping, findMacro, macroActionId, macroDisplayName, macroNameConflict, macroNameError, moveMacroStep, parseMacros,
  removeMacro, serializeMacros, upsertMacro,
} from '../src/macros.ts'

const action = (id, title, keys) => ({ kind: 'action', id, title, ...(keys ? { keys } : {}) })

test('宏本身也是一个动作 id：Macro.<名字>（ActionMacro.java:62/222）', () => {
  assert.equal(MACRO_ACTION_PREFIX, 'Macro.')
  assert.equal(macroActionId('折叠全部'), 'Macro.折叠全部')
  // 匿名宏没有动作 id（它进不了 Keymap / Find Action）
  assert.equal(macroActionId(''), '')
})

test('连续输入合并成一条（appendKeyPressed 的合并分支），被动作打断', () => {
  let steps = appendTyping([], '晶')
  steps = appendTyping(steps, '体')
  steps = appendTyping(steps, '管')
  assert.deepEqual(steps, [{ kind: 'typing', text: '晶体管' }])
  steps = appendAction(steps, action('edit.copy', '复制', 'Ctrl C'))
  steps = appendTyping(steps, 'x')
  assert.equal(steps.length, 3, '动作之后打字应新开一条')
  assert.equal(steps[2].kind, 'typing')
})

test('动作与按键步骤：空 id / 空按键不记录（不产生空步骤）', () => {
  assert.deepEqual(appendAction([], action('', '无 id')), [])
  assert.deepEqual(appendShortcut([], ''), [])
  assert.equal(appendShortcut([], 'Ctrl Shift P').length, 1)
})

test('动作计数只数动作（菜单上显示"几个动作"）', () => {
  const steps = [...appendTyping([], 'abc'), ...appendAction([], action('a', 'A')), ...appendShortcut([], 'Ctrl K')]
  assert.equal(actionStepCount({ name: 'm', steps }), 1)
  assert.equal(steps.length, 3)
})

test('命名宏入表 + 同名先删旧；匿名宏覆盖上一个匿名宏（addRecordedMacroWithName:307-330）', () => {
  const first = upsertMacro([], { name: 'm1', steps: [] })
  assert.equal(first.length, 1)
  const second = upsertMacro(first, { name: 'm1', steps: [action('x', 'X')] })
  assert.equal(second.length, 1, '同名宏不应出现两个')
  assert.equal(second[0].steps.length, 1, '同名应换成新的那一条')
  // 匿名宏：只有一个，新的覆盖旧的
  const anonymous = upsertMacro(second, { name: '', steps: [action('anon', 'A')] })
  assert.equal(anonymous.length, 2)
  const anonymous2 = upsertMacro(anonymous, { name: '', steps: [] })
  assert.equal(anonymous2.length, 2, '匿名宏只能有一个')
  assert.equal(anonymous2[1].steps.length, 0, '匿名宏应被覆盖成新的那一条')
})

test('宏名校验：空名拒绝、重名拒绝、改成自己原来的名字允许（checkCanCreateMacro）', () => {
  const macros = [{ name: 'm1', steps: [] }, { name: 'm2', steps: [] }]
  assert.equal(macroNameError('', macros), '宏名不能为空。')
  assert.equal(macroNameError('   ', macros), '宏名不能为空。')
  assert.match(macroNameError('m1', macros), /已存在/)
  assert.equal(macroNameError('m3', macros), null)
  // 重命名时传 renaming，允许"改成自己"
  assert.equal(macroNameError('m1', macros, 'm1'), null)
})

test('重名冲突单独可查：重命名时宿主拿它决定要不要问（canRenameMacro:157-178）', () => {
  const macros = [{ name: 'm1', steps: [] }, { name: 'm2', steps: [] }]
  assert.equal(macroNameConflict('m2', macros), macros[1], '撞上别的宏时返回那一个')
  assert.equal(macroNameConflict('m1', macros, 'm1'), undefined, '改成自己不算冲突')
  assert.equal(macroNameConflict('m3', macros), undefined)
  assert.equal(macroNameConflict('   ', macros), undefined)
})

test('删除与查找', () => {
  const macros = [{ name: 'a', steps: [] }, { name: '', steps: [] }]
  assert.equal(findMacro(macros, 'a')?.name, 'a')
  assert.equal(findMacro(macros, 'zz'), undefined)
  assert.deepEqual(removeMacro(macros, 'a').map(macro => macro.name), [''])
})

test('持久化：往返一致，坏数据/未知步骤一律丢弃（宁可丢宏也不要起不来）', () => {
  const macros = [
    { name: 'm1', steps: [action('edit.copy', '复制', 'Ctrl C'), { kind: 'typing', text: 'hi' }, { kind: 'shortcut', stroke: 'Ctrl K' }] },
    { name: '', steps: [] },
  ]
  assert.deepEqual(parseMacros(serializeMacros(macros)), macros)
  assert.equal(parseMacros(null).length, 0)
  assert.equal(parseMacros('not json').length, 0)
  assert.equal(parseMacros('{"version":99,"macros":[]}').length, 0, '版本不认识就退回空表')
  // 未知 kind 的那一步被丢掉，其余保留
  const broken = '{"version":1,"macros":[{"name":"m","steps":[{"kind":"typing","text":"ok"},{"kind":"wat"}]}]}'
  assert.deepEqual(parseMacros(broken), [{ name: 'm', steps: [{ kind: 'typing', text: 'ok' }] }])
  assert.ok(MACRO_STORAGE_KEY.startsWith('taocode.'))
})

test('显示名：命名宏用名字，匿名宏用占位（菜单里不出现空白行）', () => {
  assert.equal(macroDisplayName({ name: 'm1', steps: [] }), 'm1')
  assert.equal(macroDisplayName({ name: '', steps: [] }), ANONYMOUS_MACRO_LABEL)
})

test('步骤上移/下移（ActionMacroConfigurationPanel 的 moveUp/moveDown）：越界原样，移动是一条', () => {
  const steps = [action('a', 'A'), action('b', 'B'), action('c', 'C')]
  assert.deepEqual(moveMacroStep(steps, 2, -1).map(s => s.id), ['a', 'c', 'b'])
  assert.deepEqual(moveMacroStep(steps, 0, 1).map(s => s.id), ['b', 'a', 'c'])
  assert.deepEqual(moveMacroStep(steps, 0, -1).map(s => s.id), ['a', 'b', 'c'], '第一行不能再上移')
  assert.deepEqual(moveMacroStep(steps, 2, 1).map(s => s.id), ['a', 'b', 'c'], '最后一行不能再下移')
  assert.deepEqual(moveMacroStep(steps, 0, 0).map(s => s.id), ['a', 'b', 'c'], 'delta 0 不动')
  assert.deepEqual(steps.map(s => s.id), ['a', 'b', 'c'], '不就地改原数组')
  // 接线：对话框有上/下移按钮并派发 moveStep，宿主把它落到宏表
  const dialog = readFileSync('src/components/MacrosDialog.vue', 'utf8')
  assert.ok(dialog.includes("@click=\"emit('moveStep', { name: current.name, index, delta: -1 })\""), '对话框没有上移按钮')
  assert.ok(dialog.includes("@click=\"emit('moveStep', { name: current.name, index, delta: 1 })\""), '对话框没有下移按钮')
  const host = readFileSync('src/macroHost.ts', 'utf8')
  assert.ok(host.includes('function moveMacroStep(name: string, index: number, delta: number)'), '宿主没有 moveMacroStep')
  const app = readFileSync('src/App.vue', 'utf8')
  assert.ok(app.includes('@move-step="moveMacroStep($event.name, $event.index, $event.delta)"'), 'App 没有把 moveStep 接到宿主')
})

test('接线：菜单、录制钩子、对话框、动态子菜单都在', () => {
  const edit = readFileSync('src/menus/editMenu.ts', 'utf8')
  assert.ok(edit.includes('...createMacrosMenuRows(ctx.macros)'), '编辑菜单没有宏子菜单')
  assert.ok(edit.includes("  macros: any"), '编辑菜单 ctx 里没有宏')
  const macrosMenu = readFileSync('src/menus/macrosMenu.ts', 'utf8')
  for (const id of ['edit.playbackLastMacro', 'edit.startStopMacroRecording', 'edit.editMacros', 'edit.playSavedMacros'])
    assert.ok(macrosMenu.includes(`id: '${id}'`), `宏菜单缺少 ${id}`)
  // 录制钩子：动作执行的两处（菜单行 + 命令面板）都在广播口上，宏录制是登记进管道的监听者
  // （对应 `AnActionListener.beforeActionPerformed`；2026-10-04 起管道在 src/actionEvents.ts）。
  const menuUi = readFileSync('src/menuUi.ts', 'utf8')
  assert.equal((menuUi.match(/fireBeforeActionPerformed\(/g) ?? []).length, 2, '菜单/命令面板两处都要广播')
  assert.ok(menuUi.includes('addActionListener({ beforeActionPerformed: recordActionStep })'), '录制钩子没有登记进广播管道')
  // 打字也录（KeyPostProcessor 的等价物）：编辑器上报 + 宿主接住
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  assert.ok(editor.includes('typing: [text: string]'), '编辑器没有上报输入文本')
  assert.ok(editor.includes("emit('typing', typed)"), '编辑器没有发出 typing 事件')
  const app = readFileSync('src/App.vue', 'utf8')
  assert.ok(app.includes('@typing="recordTypingStep"'), 'App 没有把打字接给宏录制')
  assert.ok(app.includes('<MacrosDialog v-if="macrosDialogOpen"'), 'App 没有挂「编辑宏」对话框')
  // 动态子菜单能力（IDEA ActionGroup.getChildren 的对应物）
  const types = readFileSync('src/menus/types.ts', 'utf8')
  assert.ok(types.includes('childrenOf?: () => MenuRow[]'), 'MenuRow 没有动态子菜单能力')
  const submenu = readFileSync('src/menus/submenuState.ts', 'utf8')
  assert.ok(submenu.includes('row.childrenOf ? row.childrenOf() : row.children'), '子菜单没有优先取动态行')
})
