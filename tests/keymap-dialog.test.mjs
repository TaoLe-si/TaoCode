// 键位设置面板 —— `pf/keymap` 判词里「用户自定义改键 + 冲突面板没有落点」的判据。
//
// 上一轮 `src/keymapEditor.ts` 把规则层（显示串 / 按下即录 / 限制位 / 覆盖表 / 冲突收口）都写了，
// 但除了自己的单测**全仓零消费**：改键、冲突三选一、恢复默认都没有 UI 入口。
// 这一批补上宿主状态（`src/keymapHost.ts`）、面板（`src/components/KeymapDialog.vue`）与
// 帮助菜单入口（`src/menus/helpMenu.ts` 的 `help.keymapSettings`）。
//
// 上游坐标：`platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java`
//   `:111` implements SearchableConfigurable · `:447` showConflictsAction · `:455` FilterComponent
//   `:516-563` addKeyboardShortcut · `:529-537` 冲突三选一 · `:565-574` isShortcutConflictAction
//   `:576-582` removeConflictingShortcuts · `:139-142`（KeymapSchemeManager）resetScheme
//
// 本文件是**纯 JavaScript**（仓库 `npm test` 不带 --experimental-strip-types）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createKeymapHost } from '../src/keymapHost.ts'
import {
  applyOverrides, currentOverrides, effectiveKeyBindings, resetScheme,
  restrictionReason, shortcutRestrictions, strokeFromKeyEvent, keystrokeText,
  doubleClickModifierText, onOverridesChanged, setDynamicKeyBindings,
  NO_RESTRICTIONS, FIXED_SHORTCUT,
} from '../src/keymapEditor.ts'
import { keymapConflicts } from '../src/keymapBindings.ts'

const read = path => readFileSync(path, 'utf8')

test('按一次键录成一组键位；纯修饰键不成键位（KeyboardShortcutPanel 的按下即录）', () => {
  const chord = strokeFromKeyEvent({ key: 'k', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })
  assert.ok(chord)
  assert.deepEqual(chord.chord, { key: 'k', control: 'ctrl' })
  assert.equal(chord.text, 'CtrlK')

  assert.equal(strokeFromKeyEvent({ key: 'Control', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), null)
  assert.equal(strokeFromKeyEvent({ key: 'Shift', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false }), null)
})

test('快捷键显示串按上游口径：修饰键固定顺序、无分隔符（KeymapTextContext.getKeystrokeText）', () => {
  assert.equal(keystrokeText({ key: 'k', ctrlKey: true, altKey: true, shiftKey: true, metaKey: false }), 'CtrlAltShiftK')
  // 双击修饰键手势的串（`getModifierDoubleClickText`，`:76-89`）。
  assert.equal(doubleClickModifierText('Shift'), 'Shift Shift')
})

test('限制位按动作 id 的六个布尔位判（ActionShortcutRestrictions.getForActionId）', () => {
  assert.deepEqual(shortcutRestrictions(null), NO_RESTRICTIONS)
  assert.equal(shortcutRestrictions('EditorAddOrRemoveCaret').allowKeyboardShortcut, false, '多光标动作只许鼠标')
  assert.deepEqual(shortcutRestrictions('ExpandLiveTemplateByTab'), FIXED_SHORTCUT)
  assert.equal(restrictionReason('ExpandLiveTemplateByTab') !== null, true)
  assert.equal(restrictionReason('file.saveAll'), null)
})

test('宿主：改键 → 冲突时弹三选一 → 三个答法各有上游口径', () => {
  const host = createKeymapHost()
  resetScheme()

  // 无冲突：直接写进去。
  assert.equal(host.assign('search.findInPath', 'Ctrl+Alt+K'), null)
  assert.equal(host.conflictPrompt.value, null)
  assert.equal(effectiveKeyBindings().find(row => row.id === 'search.findInPath').display, 'CtrlAltK')

  // 撞上另一个动作 ⇒ 不自动移走，先问（KeymapPanel :529-537）。
  // 本仓 `keymapConflicts`（`src/keymapBindings.ts`）按 `scope::chordIdentity` 分组，
  // 所以要挑**同作用域**的一对：`file.saveAll` 与 `search.findInPath` 都是 global；
  // `tab.close` 是 tool-window，跟它们撞不算冲突。
  // （**与上游的一处已知差异**：上游 `KeymapImpl.getConflicts` 是整张键位算的，不分作用域 ——
  //   属于既有实现的口径问题，本轮不扩大改动，如实登记在报告里。）
  // `file.saveAll` 的出厂键位是 {key:'s',control:'mod'}，覆盖串 `S` 解析成同一个键。
  applyOverrides({ 'file.saveAll': 'S' })
  assert.equal(host.assign('search.findInPath', 'S'), null)
  assert.ok(host.conflictPrompt.value, '有冲突时要先弹三选一')
  assert.equal(host.conflictPrompt.value.conflicts.length, 1)

  // 「移走冲突」（Messages.YES → removeConflictingShortcuts，`:532`）。
  host.answerConflictRemove()
  assert.equal(host.conflictPrompt.value, null)
  assert.equal(host.rows.value.find(row => row.id === 'file.saveAll').keys, '', '冲突方被摘掉')
  assert.equal(keymapConflicts(effectiveKeyBindings()).length, 0)

  // 「保留」（Messages.NO）：两边都留着，面板把冲突标出来。
  applyOverrides({ 'file.saveAll': 'S' })
  host.assign('search.findInPath', 'S')
  host.answerConflictKeep()
  assert.equal(host.conflictPrompt.value, null)
  const conflictedRow = host.rows.value.find(row => row.id === 'search.findInPath')
  assert.deepEqual(conflictedRow.conflictsWith, ['file.saveAll'], '保留 = 冲突照报')

  // 「取消」（`:534-536` 直接 return 不落盘）：刚写的那条要撤掉。
  applyOverrides({ 'file.saveAll': 'S' })
  host.assign('search.findInPath', 'S')
  assert.ok(host.conflictPrompt.value)
  host.answerConflictCancel()
  assert.equal(host.conflictPrompt.value, null)
  assert.equal(Object.prototype.hasOwnProperty.call(currentOverrides(), 'search.findInPath'), false, '取消要把刚写的覆盖撤掉')

  resetScheme()
  assert.deepEqual(currentOverrides(), {})
  assert.equal(host.conflictCount.value, 0)
})

test('宿主：限制位说不可改时直接拒，不写覆盖', () => {
  resetScheme()
  const host = createKeymapHost()
  const error = host.assign('ExpandLiveTemplateByTab', 'Ctrl+K')
  assert.ok(error, '固定键位的动作不该能被改')
  assert.equal(Object.prototype.hasOwnProperty.call(currentOverrides(), 'ExpandLiveTemplateByTab'), false)
})

test('宿主：搜索框 / 只看冲突 / 恢复默认 / 覆盖表变更会重画', () => {
  resetScheme()
  const host = createKeymapHost()
  applyOverrides({ 'file.saveAll': 'Ctrl+Alt+S' })
  const all = host.rows.value.length
  assert.ok(all > 0)

  host.query.value = '保存'
  assert.ok(host.rows.value.length < all, '搜索框按动作名过滤')
  assert.ok(host.rows.value.every(row => `${row.label}${row.id}`.includes('保存')))
  host.query.value = ''
  assert.equal(host.rows.value.length, all)

  applyOverrides({ 'file.saveAll': 'Ctrl+Alt+S', 'search.findInPath': 'Ctrl+Alt+F' })
  host.conflictsOnly.value = true
  assert.ok(host.rows.value.length < all, '只看冲突要收窄')
  host.conflictsOnly.value = false

  assert.equal(host.customizedCount.value, 2)
  host.resetAll()
  assert.deepEqual(currentOverrides(), {})
  assert.equal(host.customizedCount.value, 0)

  // 覆盖表变更 → 订阅者被叫醒（上游 WeakKeymapManagerListener / KeymapListener）。
  let bumps = 0
  const off = onOverridesChanged(() => { bumps += 1 })
  applyOverrides({ 'file.saveAll': 'Ctrl+Alt+S' })
  applyOverrides({ 'file.saveAll': 'Ctrl+Alt+S' }) // 没变 → 不广播
  off()
  applyOverrides({})
  assert.equal(bumps, 1, '只有真变了才广播')
})

test('宿主：宏这类动态动作在面板里有行、能绑键（ActionMacroManager.registerActions 的产物）', () => {
  resetScheme()
  setDynamicKeyBindings([{ id: 'Macro.折叠全部', label: '回放宏 折叠全部', scope: 'global' }])
  try {
    const host = createKeymapHost()
    const row = host.rows.value.find(item => item.id === 'Macro.折叠全部')
    assert.ok(row, '没绑键的宏也要列出来，否则没有绑键入口')
    assert.equal(row.keys, '')
    assert.equal(host.assign('Macro.折叠全部', 'Ctrl+Alt+M'), null)
    assert.equal(host.rows.value.find(item => item.id === 'Macro.折叠全部').keys, 'CtrlAltM')
    assert.equal(host.rows.value.find(item => item.id === 'Macro.折叠全部').overridden, true)
  } finally {
    setDynamicKeyBindings([])
    resetScheme()
  }
})

test('解绑出厂键位后动作仍在面板里（否则用户再也绑不回去）', () => {
  resetScheme()
  const host = createKeymapHost()
  assert.ok(host.rows.value.some(row => row.id === 'file.saveAll'))
  const conflict = keymapConflicts(effectiveKeyBindings())
  assert.equal(conflict.length, 0)

  // 用一个别的动作去抢 Ctrl+S → 冲突 → 选「移走冲突」⇒ file.saveAll 被解绑。
  host.assign('search.findInPath', 'S')
  assert.ok(host.conflictPrompt.value, '抢键要先问')
  host.answerConflictRemove()
  const unbound = host.rows.value.find(row => row.id === 'file.saveAll')
  assert.ok(unbound, '被解绑的动作不能从面板里消失')
  assert.equal(unbound.keys, '')
  assert.equal(unbound.factoryKeys, 'CtrlCmdS', '出厂键位仍然显示，便于对比')
  assert.equal(unbound.overridden, true)

  // 还能再绑回去。
  assert.equal(host.assign('file.saveAll', 'Ctrl+Alt+S'), null)
  assert.equal(host.rows.value.find(row => row.id === 'file.saveAll').keys, 'CtrlAltS')
  resetScheme()
})

test('接线：帮助菜单有「键盘映射…」入口，面板与宿主都真存在', () => {
  const help = read('src/menus/helpMenu.ts')
  assert.match(help, /id: 'help\.keymapSettings'/)
  assert.match(help, /keymapHost\.openKeymapDialog\(\)/, '菜单那一行要真的能打开面板')

  const host = read('src/keymapHost.ts')
  for (const fn of ['assign', 'answerConflictRemove', 'answerConflictKeep', 'answerConflictCancel', 'resetAll']) {
    assert.match(host, new RegExp(`function ${fn}\\(`), `宿主缺 ${fn}`)
  }
  assert.match(host, /export const keymapHost: KeymapHost = createKeymapHost\(\)/, '组件要有一个进程级单例可 import')

  const dialog = read('src/components/KeymapDialog.vue')
  // 按下即录 / 三选一 / 清除 / 恢复默认 / 只看冲突 —— 五件都要在模板里真的派发。
  assert.match(dialog, /@keydown\.enter|onRecordKey/, '录键通道')
  assert.match(dialog, /strokeFromKeyEvent/, '录键要用上游那条通道')
  assert.match(dialog, /answerConflictRemove\(\)/)
  assert.match(dialog, /answerConflictKeep\(\)/)
  assert.match(dialog, /answerConflictCancel\(\)/)
  assert.match(dialog, /clearKeys\(recordingRow\)/, '清除键位')
  assert.match(dialog, /restoreDefaults\(\)/, '恢复默认')
  assert.match(dialog, /conflictsOnly = !conflictsOnly/, '只看冲突开关（KeymapPanel :447）')
  // 代码规范：不许写死尺寸、纯图标按钮要有 title 与 aria-label。
  assert.doesNotMatch(dialog, /:size="1[0-9]"/, '图标尺寸走 uiIcons 的阶梯')
  assert.match(dialog, /title="关闭" aria-label="关闭"/, '纯图标按钮要 title + aria-label')
})
