// 宏 ⇒ 动作注册 + 键位迁移 —— `pf/action-macro` 判词里那条真缺口的判据。
//
// 上一轮登记的缺口「宏编辑的设置页形态」经逐行核对**前提不成立**
// （`ActionMacroConfigurationPanel.java:173`/`:187` 的 `.disableAddAction().disableUpDownActions()`）。
// 真正没做的是 **`ActionMacroManager.registerActions`（`ActionMacroManager.kt:395-423`）**：
// 命名宏从来没被注册成 `Macro.<名字>` 动作，于是
//   · 宏进不了「查找操作」/ Search Everywhere（`macros.ts` 文件头引的正是这一条）；
//   · 宏绑不了键；
//   · 因而 `ActionMacroConfigurationPanel.apply`（`:69-104`）那套「重命名搬键位 / 删除摘键位」
//     也就没有作用对象。
// 本文件钉住这三层：纯规则（macros.ts）→ 生效表（keymapEditor.ts）→ 宿主装配（macroHost.ts 源码）。
//
// 注意：本文件是**纯 JavaScript**（仓库 `npm test` 不带 --experimental-strip-types）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  macroActionId, macroActionIds, macroRenameKeymapOverrides, macroStripKeymapOverrides,
} from '../src/macros.ts'
import {
  applyOverrides, assignShortcut, currentOverrides, effectiveKeyBindings, keymapRows,
  parseOverrides, serializeOverrides, setDynamicKeyBindings, unassignShortcut, shortcutRestrictions,
} from '../src/keymapEditor.ts'
import { keymapConflicts } from '../src/keymapBindings.ts'

/** 测试用出厂表：两个动作 + 一条出厂键位（替代真实 KEY_BINDINGS，避免与真实分派耦合）。 */
const FACTORY = [
  { id: 'file.saveAll', label: '全部保存', chord: { key: 's', control: 'mod' }, display: 'CtrlS', scope: 'global', upstream: '$default.xml:855' },
  { id: 'file.open', label: '转到文件…', chord: { key: 'n', control: 'mod', shift: true }, display: 'CtrlShiftN', scope: 'global', upstream: '$default.xml:365' },
]

test('macroActionIds：只有命名宏有动作 id，且同名只算一次', () => {
  assert.equal(macroActionId(''), '', '匿名宏没有动作 id')
  assert.equal(macroActionId('折叠全部'), 'Macro.折叠全部')
  assert.deepEqual(
    macroActionIds([{ name: '折叠全部', steps: [] }, { name: '', steps: [] }, { name: '展开', steps: [] }]),
    ['Macro.折叠全部', 'Macro.展开'],
  )
  // 上游 `registerActions` 用 registeredIds 去重（`ActionMacroManager.kt:411-415`）。
  assert.deepEqual(macroActionIds([{ name: 'A', steps: [] }, { name: 'A', steps: [] }]), ['Macro.A'])
})

test('重命名宏：键位跟着搬到新动作 id 上（ActionMacroConfigurationPanel.apply :71-81）', () => {
  const before = { 'Macro.折叠全部': 'Ctrl+Alt+M' }
  const after = macroRenameKeymapOverrides(before, '折叠全部', '折叠')
  assert.deepEqual(after, { 'Macro.折叠': 'Ctrl+Alt+M' })
  // 顺序不能换：新名上原有的（陈旧）绑定要先让位，再被旧名的搬过来。
  assert.deepEqual(
    macroRenameKeymapOverrides({ 'Macro.折叠': 'Ctrl+Alt+X', 'Macro.折叠全部': 'Ctrl+Alt+M' }, '折叠全部', '折叠'),
    { 'Macro.折叠': 'Ctrl+Alt+M' },
  )
  // 没有绑过键就什么都不用搬（同 :76 的 `keymap.getShortcuts(oldId)` 为空）。
  assert.deepEqual(macroRenameKeymapOverrides({}, 'A', 'B'), {})
  // 同名改名是空操作。
  assert.deepEqual(macroRenameKeymapOverrides({ 'Macro.A': 'Ctrl+M' }, 'A', 'A'), { 'Macro.A': 'Ctrl+M' })
})

test('删除宏：把它留在键位里的绑定摘掉（:84 / :99-103 的 removedIds）', () => {
  const before = { 'Macro.A': 'Ctrl+Alt+M', 'Macro.B': 'Ctrl+Alt+N', 'file.saveAll': 'Ctrl+Shift+S' }
  assert.deepEqual(macroStripKeymapOverrides(before, ['A']), { 'Macro.B': 'Ctrl+Alt+N', 'file.saveAll': 'Ctrl+Shift+S' })
  assert.deepEqual(macroStripKeymapOverrides(before, ['不存在']), before, '没绑过键的宏删了不动覆盖表')
  assert.deepEqual(macroStripKeymapOverrides(before, ['']), before, '匿名宏没有动作 id')
})

test('动态动作层：宏进生效表 ⇒ 可绑键、可解绑、参与冲突检测', () => {
  setDynamicKeyBindings([{ id: 'Macro.A', label: '回放宏 A', scope: 'global' }])
  const empty = effectiveKeyBindings({}, FACTORY)
  assert.deepEqual(empty.map(row => row.id), ['file.saveAll', 'file.open'], '没绑键的宏不进生效表')

  applyOverrides({ 'Macro.A': 'Ctrl+Alt+M' })
  const bound = effectiveKeyBindings(currentOverrides(), FACTORY)
  const macroRow = bound.find(row => row.id === 'Macro.A')
  assert.ok(macroRow, '绑了键的宏要出现在生效表里')
  assert.equal(macroRow.label, '回放宏 A')
  assert.equal(macroRow.override, true, '动态动作没有出厂键位，必然是用户自定义')

  // 与出厂键位真撞了 → 冲突检测要报到（`KeymapManagerEx.getConflicts` 的口径）。
  // `file.open` 的出厂键位是 {key:'n', control:'mod', shift:true}，覆盖串按 `parseChord`
  // （`keymapBindings.ts`，按 `[\s+]+` 切）写成 `Shift+N` 才是同一个键。
  applyOverrides({ 'Macro.A': 'Shift+N' })
  const conflicted = keymapConflicts(effectiveKeyBindings(currentOverrides(), FACTORY))
  assert.ok(conflicted.some(item => item.ids.includes('Macro.A') && item.ids.includes('file.open')),
    `宏与出厂动作撞键要报冲突，实际：${JSON.stringify(conflicted)}`)

  // assignShortcut 现在认动态动作 id（没有这一层会以「没有这个动作」拒掉）。
  const result = assignShortcut('Macro.A', 'Ctrl+Alt+K')
  assert.ok(!('error' in result), `动态动作应当可绑键，实际：${JSON.stringify(result)}`)
  assert.equal(result.conflicts.length, 0)

  assert.equal(unassignShortcut('Macro.A'), true)
  assert.equal(unassignShortcut('file.saveAll'), false, '没自定义过的出厂动作不可解绑')
  applyOverrides({})
  setDynamicKeyBindings([])
  assert.deepEqual(effectiveKeyBindings({}, FACTORY).map(row => row.id), ['file.saveAll', 'file.open'])
})

test('keymapRows：没绑键的宏也要列出来，否则用户没有「给宏绑键」的入口', () => {
  setDynamicKeyBindings([{ id: 'Macro.A', label: '回放宏 A' }])
  try {
    const rows = keymapRows(effectiveKeyBindings(currentOverrides(), FACTORY), '', FACTORY)
    const macroRow = rows.find(row => row.id === 'Macro.A')
    assert.ok(macroRow, '未绑键的动态动作也要出现在面板行里')
    assert.equal(macroRow.keys, '')
    assert.equal(macroRow.factoryKeys, '', '宏没有出厂默认键位')
    // 搜索也要能搜到它（`ShortcutFilteringPanel` 的动作名检索）。
    assert.ok(keymapRows(effectiveKeyBindings(currentOverrides(), FACTORY), '宏 A', FACTORY)
      .some(row => row.id === 'Macro.A'))
  } finally { setDynamicKeyBindings([]) }
})

test('宏没有 place 限制：shortcutRestrictions 对 Macro.* 放行', () => {
  assert.equal(shortcutRestrictions('Macro.A').allowKeyboardShortcut, true)
  assert.equal(shortcutRestrictions('Macro.A').allowChanging, true)
})

test('parseOverrides 认宏的键位串，认不出的条目丢掉（覆盖表是应用级用户数据）', () => {
  const parsed = parseOverrides(serializeOverrides({ 'Macro.A': 'Ctrl+Alt+M', '坏': 'Ctrl+Hyper+M' }))
  assert.deepEqual(parsed, { 'Macro.A': 'Ctrl+Alt+M' }, '不认识的修饰键（Hyper）整条丢弃')
})

test('宿主装配：macroHost 真的把宏注册进动作表并迁键位（源码断言）', () => {
  const host = readFileSync('src/macroHost.ts', 'utf8')
  // `ActionMacroManager.registerActions`（`ActionMacroManager.kt:395-423`）的等价物。
  assert.match(host, /function syncMacroActions\(\)/, '缺少宏 → 动作的同步函数')
  assert.match(host, /ACTIONS\.unregister\(id\)/, '重注册前要先注销旧的 Macro.*')
  assert.match(host, /ACTIONS\.register\(\{/, '宏要注册进动作表')
  assert.match(host, /enabled: \(\) => !playing\.value/, 'InvokeMacroAction 的 setEnabled(!isPlaying)')
  assert.match(host, /setDynamicKeyBindings\(/, '宏要进键位层的动态动作表，否则绑不了键')
  // 三条变更路径都要重算（启动 / 录制完 / 改名 / 删除）。
  assert.equal((host.match(/syncMacroActions\(\)/g) ?? []).length >= 4, true,
    '启动 / 录制完成 / 重命名 / 删除 四条路径都要重新同步')
  // 键位迁移（`ActionMacroConfigurationPanel.apply`，`:69-104`）。
  assert.match(host, /applyOverrides\(macroRenameKeymapOverrides\(currentOverrides\(\), from, name\)\)/, '重命名要搬键位')
  assert.match(host, /applyOverrides\(macroStripKeymapOverrides\(currentOverrides\(\), \[name\]\)\)/, '删除要摘键位')
})
