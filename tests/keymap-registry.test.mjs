// `src/keymapRegistry.ts` 的判据 —— 上游 `Keymap`/`KeymapImpl` 的键位注册表与冲突判定。
//
// 上游坐标全部逐行核过本地基准树（`D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt`
//     `:778-810` `getConflicts`、`:621-622` `<action id>` 必填、`:625-681` 三种快捷键子元素、
//     `:683-685` 空 `<action/>` 的语义、`:62-75` 元素/属性常量；
//   · `platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java:565-574`
//     `isShortcutConflictAction`、`:576-584` `removeConflictingShortcuts`、`:790-799` 三选一；
//   · `platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java:137-195` 键位串解析、
//     `:257-272` 修饰键表、`:274-294` VK 名表；
//   · `platform/platform-api/resources/messages/KeyMapBundle.properties:34-39`/`:63` 文案。
// 上游不存在时这些用例跳过（`upstreamAvailable`），其余用例用内联夹具照跑。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONFLICTS_LABEL, CONFLICT_DIALOG_BUTTONS, CONFLICT_DIALOG_MESSAGE, CONFLICT_DIALOG_TITLE, DEFAULT_KEYMAP_XML,
  getKeymapConflicts, isShortcutConflictAction, keymapConflictGroups, keymapConflictReport,
  keystrokeText, parseKeystroke, parseKeymapXml, parseMouseKeystroke, sameStroke, strokeIdentity,
} from '../src/keymapRegistry.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM_ROOT = process.env.KEYMAP_UPSTREAM || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const upstreamAvailable = existsSync(UPSTREAM_ROOT)
const upstreamLines = (relative) => {
  const path = join(UPSTREAM_ROOT, relative)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').split('\n')
}
const readUpstream = (relative) => {
  const path = join(UPSTREAM_ROOT, relative)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}
const xmlText = upstreamAvailable ? readUpstream(DEFAULT_KEYMAP_XML) : null
const parsed = xmlText ? parseKeymapXml(xmlText, { source: '$default.xml' }) : null

// ── 键位解析（上游 KeyStrokeAdapter）─────────────────────────────────────────

test('键位串解析：大小写不敏感、control==ctrl、修饰键与键名分开（KeyStrokeAdapter.java:137-195）', () => {
  const a = parseKeystroke('control shift T')
  const b = parseKeystroke('ctrl Shift t')
  assert.deepEqual(a.modifiers, ['ctrl', 'shift'])
  assert.equal(a.key, 'T')
  assert.equal(strokeIdentity(a), strokeIdentity(b))
  assert.ok(sameStroke(a, b))
  // `$default.xml` 里同时出现 `ENTER` 与 `Enter`（:461 附近），两者必须同一。
  assert.ok(sameStroke(parseKeystroke('ENTER'), parseKeystroke('Enter')))
  // 单字符键名规范化成大写；`$default.xml:1206` 的小写 `alt down` 同样成立。
  assert.equal(parseKeystroke('alt down').key, 'DOWN')
  assert.deepEqual(parseKeystroke('alt down').modifiers, ['alt'])
  // 命名键与数字键原样大写。
  assert.equal(parseKeystroke('control MULTIPLY').key, 'MULTIPLY')
  assert.equal(parseKeystroke('control 1').key, '1')
  assert.equal(parseKeystroke('F11').key, 'F11')
  // 坏串（两个键名、空串）解析不了（上游 :167-174 记错误后返回 null）。
  assert.equal(parseKeystroke('control T U'), null)
  assert.equal(parseKeystroke('   '), null)
  assert.equal(parseKeystroke('typed ab'), null)
})

test('修饰键顺序与显示串：Ctrl → Alt → Shift → Meta、无分隔符（KeymapTextContext.java:201-222）', () => {
  assert.equal(keystrokeText(parseKeystroke('shift control alt T')), 'CtrlAltShiftT')
  assert.equal(keystrokeText(parseKeystroke('control F6')), 'CtrlF6')
  assert.equal(keystrokeText(parseKeystroke('alt HOME')), 'AltHOME')
})

test('鼠标键位解析（KeymapUtil.parseMouseShortcut 子集）：$default.xml:19 的 alt button1 doubleClick', () => {
  const mouse = parseMouseKeystroke('alt button1 doubleClick')
  assert.deepEqual(mouse.modifiers, ['alt'])
  assert.equal(mouse.button, 'button1')
  assert.equal(mouse.clicks, 'doubleclick')
  // 没有按钮就不是鼠标键位；认不出的词也返回 null。
  assert.equal(parseMouseKeystroke('alt'), null)
  assert.equal(parseMouseKeystroke('alt nope'), null)
  // 单个 `button1` 是合法的单击（无修饰键）。
  assert.deepEqual(parseMouseKeystroke('button1').modifiers, [])
})

// ── XML 解析（上游 KeymapImpl.readExternal）──────────────────────────────────

test('内联夹具：三种子元素 + 空 <action/> + 坏数据进 problems，不静默吞', () => {
  const xml = [
    '<keymap name="fixture" version="1" disable-mnemonics="false">',
    '  <action id="A"><keyboard-shortcut first-keystroke="control K"/></action>',
    '  <action id="B"><keyboard-shortcut first-keystroke="control K" second-keystroke="1"/></action>',
    '  <action id="C"/>',
    '  <action id="D"><keyboard-gesture-shortcut keystroke="shift SHIFT" modifier="dblClick"/></action>',
    '  <action id="E"><mouse-shortcut keystroke="alt button1"/></action>',
    '  <action id="F"><keyboard-shortcut first-keystroke="bogus key name"/></action>',
    '  <keyboard-shortcut first-keystroke="control Z"/>',
    '</keymap>',
  ].join('\n')
  const document = parseKeymapXml(xml, { source: 'fixture.xml' })
  assert.equal(document.name, 'fixture')
  assert.equal(document.version, '1')
  assert.equal(document.disableMnemonics, false)
  assert.equal(document.parent, null)
  // C 是空 action：有 id、没有绑定（上游 :683-685）。
  assert.deepEqual(document.actionIds, ['A', 'B', 'C', 'D', 'E', 'F'])
  assert.deepEqual(document.entries.map(e => [e.actionId, e.kind]), [
    ['A', 'keyboard'], ['B', 'keyboard'], ['D', 'gesture'], ['E', 'mouse'],
  ])
  // B 的第二段被解析出来（两段式判定的输入）。
  const b = document.entries.find(e => e.actionId === 'B')
  assert.equal(b.secondKeystroke, '1')
  assert.equal(b.second.key, '1')
  assert.equal(b.line, 3)
  assert.equal(b.actionLine, 3)
  // D 的手势类型保留；E 的鼠标串原样。
  assert.equal(document.entries.find(e => e.actionId === 'D').modifier, 'dblClick')
  assert.equal(document.entries.find(e => e.actionId === 'E').keystroke, 'alt button1')
  // F 的坏键位串与「不在 action 里的快捷键」都进了 problems，条目被跳过。
  assert.equal(document.entries.some(e => e.actionId === 'F'), false)
  assert.equal(document.problems.length, 2)
  assert.ok(document.problems.some(p => p.includes('fixture.xml:7') && p.includes('F')))
  assert.ok(document.problems.some(p => p.includes('fixture.xml:8')))
})

test('缺 id 的 <action> 报错并跳过（上游 :621-622 抛 InvalidDataException）', () => {
  const document = parseKeymapXml('<keymap name="x"><action><keyboard-shortcut first-keystroke="control A"/></action></keymap>')
  assert.equal(document.entries.length, 0)
  assert.equal(document.actionIds.length, 0)
  assert.ok(document.problems.some(p => p.includes('缺 id')))
})

test('缺 first-keystroke 报错（上游 :629-631 抛错）', { skip: !upstreamAvailable }, () => {
  const document = parseKeymapXml('<keymap name="x"><action id="A"><keyboard-shortcut second-keystroke="1"/></action></keymap>')
  assert.ok(document.problems.some(p => p.includes('first-keystroke')))
})

test('$default.xml 全量解析：动作数/绑定数/元素类型与实测一致', { skip: !upstreamAvailable }, () => {
  assert.ok(parsed, '读不到上游 $default.xml')
  // 实测：422 个 <action>、443 个 <keyboard-shortcut>、2 个 <keyboard-gesture-shortcut>、
  // 14 个 <mouse-shortcut>（自闭合的 14 条 + `:618-619` 那对开闭空元素 ⇒ 15 个无绑定的 action）。
  assert.equal(parsed.actionIds.length, 422)
  assert.equal(parsed.entries.filter(e => e.kind === 'keyboard').length, 443)
  assert.equal(parsed.entries.filter(e => e.kind === 'gesture').length, 2)
  assert.equal(parsed.entries.filter(e => e.kind === 'mouse').length, 14)
  assert.equal(parsed.entries.length, 459)
  // 15 个 action 没有绑定（14 条自闭合 + `:618` 的开闭空元素），其余都有。
  const withEntries = new Set(parsed.entries.map(e => e.actionId))
  assert.equal(parsed.actionIds.filter(id => !withEntries.has(id)).length, 15)
  assert.ok(parsed.actionIds.filter(id => !withEntries.has(id)).includes('Diff.FocusOppositePaneAndScroll'))
  // 解析过程零告警：这张表没有坏串（坏串会让上游 `?: continue` 丢键位，等于静默改行为）。
  assert.deepEqual(parsed.problems, [])
  // 两段式条目 22 条（实测 grep second-keystroke）。
  assert.equal(parsed.entries.filter(e => e.secondKeystroke).length, 22)
  // 逐条带上来源行，且行号落在文件长度内。
  const lines = upstreamLines(DEFAULT_KEYMAP_XML)
  assert.ok(lines.length > 1300)
  for (const entry of parsed.entries) {
    assert.ok(entry.line >= 1 && entry.line <= lines.length, `${entry.source} 行号越界`)
    assert.ok(lines[entry.line - 1].includes(entry.kind === 'keyboard' ? 'keyboard-shortcut' : `${entry.kind}-shortcut`) || entry.kind === 'mouse',
      `${entry.source} 那一行不是快捷键元素：${lines[entry.line - 1]}`)
  }
})

test('$default.xml 的已知条目坐标正确（逐行核对）', { skip: !upstreamAvailable }, () => {
  const byId = (id) => parsed.entries.filter(e => e.actionId === id)
  const gototest = byId('GotoTest')[0]
  assert.equal(gototest.line, 255)
  assert.equal(gototest.keystroke, 'control shift T')
  const services = byId('ServiceView.ShowServices')[0]
  assert.equal(services.line, 1189)
  assert.equal(services.keystroke, 'control shift T')
  const optimize = byId('OptimizeImports')[0]
  assert.equal(optimize.line, 341)
  assert.equal(optimize.keystroke, 'control alt O')
  const flatten = byId('UsageGrouping.FlattenModules')[0]
  assert.equal(flatten.line, 1258)
  assert.equal(flatten.keystroke, 'control alt O')
  // 手势与鼠标那两条的坐标。
  assert.equal(byId('RunAnything')[0].keystroke, 'ctrl control')
  assert.equal(byId('RunAnything')[0].modifier, 'dblClick')
  assert.equal(byId('SearchEverywhere')[0].keystroke, 'shift SHIFT')
})

// ── 冲突判定（上游 KeymapImpl.getConflicts + KeymapPanel.isShortcutConflictAction）──

test('同第一段键位的两个动作被报出（KeymapImpl.kt:781 + :795-797）', { skip: !upstreamAvailable }, () => {
  const conflicts = getKeymapConflicts(parsed.entries, 'GotoTest', parseKeystroke('control shift T'))
  assert.deepEqual([...conflicts.keys()], ['ServiceView.ShowServices'])
  // 反向同样成立（判定是对称的，除了 use-shortcut-of 那条方向性规则）。
  const reverse = getKeymapConflicts(parsed.entries, 'ServiceView.ShowServices', parseKeystroke('control shift T'))
  assert.deepEqual([...reverse.keys()], ['GotoTest'])
  // 同一个动作自己不冲突（上游 :782）。
  assert.equal(getKeymapConflicts(parsed.entries, 'GotoTest', parseKeystroke('control shift T')).has('GotoTest'), false)
})

test('两段式过滤（KeymapImpl.kt:799-803）：第二段都不同才不冲突，一方缺第二段仍算冲突', () => {
  const entries = parseKeymapXml([
    '<keymap name="x">',
    '  <action id="One"><keyboard-shortcut first-keystroke="control MULTIPLY" second-keystroke="1"/></action>',
    '  <action id="Two"><keyboard-shortcut first-keystroke="control MULTIPLY" second-keystroke="NUMPAD1"/></action>',
    '  <action id="Bare"><keyboard-shortcut first-keystroke="control MULTIPLY"/></action>',
    '</keymap>',
  ].join('\n')).entries
  // 1 与 NUMPAD1 不同 ⇒ Two 不冲突；但 Bare（无第二段）与 One 算冲突 ——
  // 单段键位会与同第一段的两段键位相撞（上游 :799-803 只在**两边都有**第二段时才过滤）。
  const conflicts = getKeymapConflicts(entries, 'One', parseKeystroke('control MULTIPLY'), parseKeystroke('1'))
  assert.deepEqual([...conflicts.keys()], ['Bare'])
  const bareConflicts = getKeymapConflicts(entries, 'Bare', parseKeystroke('control MULTIPLY'))
  assert.deepEqual([...bareConflicts.keys()].sort(), ['One', 'Two'])
})

test('$default.xml 真实两段式：control MULTIPLY 的五个级别互不冲突', { skip: !upstreamAvailable }, () => {
  const level1 = parsed.entries.filter(e => e.actionId === 'ExpandToLevel1')
  assert.equal(level1.length, 2) // :386 与 :387 两条（1 与 NUMPAD1）
  const conflicts = getKeymapConflicts(parsed.entries, 'ExpandToLevel1', parseKeystroke('control MULTIPLY'), parseKeystroke('1'))
  // 只有同第二段的 NUMPAD 变体与它自己那条不算；级别 2-5 的第二段都不同 ⇒ 不冲突。
  assert.equal(conflicts.has('ExpandToLevel2'), false)
  assert.equal(conflicts.has('ExpandToLevel3'), false)
})

test('三条排除：同 id / EditorFoo vs $Foo / use-shortcut-of（KeymapPanel.java:565-574）', () => {
  // 同 id（:566-568）。
  assert.equal(isShortcutConflictAction('A', 'A'), false)
  // EditorFoo 与 $Foo 是同一个动作（:569-571）。
  assert.equal(isShortcutConflictAction('EditorCopy', '$Copy'), false)
  assert.equal(isShortcutConflictAction('EditorToggleCase', '$ToggleCase'), false)
  // 反向不是：$Copy 与 EditorCopy —— 上游只看 `actionId` 以 Editor 开头这一侧。
  assert.equal(isShortcutConflictAction('$Copy', 'EditorCopy'), true)
  // 普通两个动作是冲突。
  assert.equal(isShortcutConflictAction('GotoTest', 'ServiceView.ShowServices'), true)
  // use-shortcut-of 别名指向本动作 ⇒ 不是冲突（:572-573，上游 ActionManagerEx.getActionBinding）。
  const options = { actionBinding: (id) => (id === 'BookmarksView.Delete' ? '$Delete' : undefined) }
  assert.equal(isShortcutConflictAction('$Delete', 'BookmarksView.Delete', options), false)
  assert.equal(isShortcutConflictAction('$Delete', 'BookmarksView.Delete'), true) // 没有绑定表时按冲突算
})

test('EditorFoo 与 $Foo 在真实表上互不报（$default.xml 有 $Undo/:232、$Cut/:431 等 7 条）', { skip: !upstreamAvailable }, () => {
  const dollarIds = parsed.actionIds.filter(id => id.startsWith('$'))
  assert.equal(dollarIds.length, 7)
  for (const id of dollarIds) {
    const editorTwin = `Editor${id.slice(1)}`
    assert.equal(isShortcutConflictAction(editorTwin, id), false, `${editorTwin} vs ${id}`)
  }
})

test('全表冲突清单：真实 $default.xml 上能查出已知的 GotoTest/ShowServices 与 OptimizeImports/FlattenModules', { skip: !upstreamAvailable }, () => {
  const groups = keymapConflictGroups(parsed.entries)
  const find = (ids) => groups.find(g => ids.every(id => g.actionIds.includes(id)))
  const ctrlShiftT = find(['GotoTest', 'ServiceView.ShowServices'])
  assert.ok(ctrlShiftT, 'control shift T 的冲突没报出来')
  assert.equal(ctrlShiftT.keystroke, 'CtrlShiftT')
  assert.equal(ctrlShiftT.winner, 'GotoTest') // 表里靠前（:254 在 :1188 之前）
  const ctrlAltO = find(['OptimizeImports', 'UsageGrouping.FlattenModules'])
  assert.ok(ctrlAltO, 'control alt O 的冲突没报出来')
  assert.equal(ctrlAltO.keystroke, 'CtrlAltO')
  // 冲突组数 > 0 且每个组都至少两个动作（分组本身不产生单元素组）。
  assert.ok(groups.length > 0)
  for (const group of groups) assert.ok(group.actionIds.length >= 2)
})

test('报告文案：没有冲突时不返回空串；有冲突时带上游那句 Already assigned to:', () => {
  const clean = parseKeymapXml('<keymap name="x"><action id="A"><keyboard-shortcut first-keystroke="control K"/></action></keymap>')
  const report = keymapConflictReport(clean.entries)
  assert.ok(report.includes('1 条绑定'))
  assert.ok(report.includes('0 处冲突'))
  assert.ok(report.trim().length > 0)
  const messy = parseKeymapXml([
    '<keymap name="x">',
    '  <action id="A"><keyboard-shortcut first-keystroke="control K"/></action>',
    '  <action id="B"><keyboard-shortcut first-keystroke="control K"/></action>',
    '</keymap>',
  ].join('\n'))
  const conflictReport = keymapConflictReport(messy.entries)
  assert.ok(conflictReport.includes('1 处冲突'))
  assert.ok(conflictReport.includes(CONFLICTS_LABEL))
  assert.ok(conflictReport.includes('A'))
  assert.ok(conflictReport.includes('B'))
})

test('上游文案逐字（KeyMapBundle.properties:34-39 / :63）', () => {
  assert.equal(CONFLICT_DIALOG_MESSAGE,
    'This shortcut is already assigned to other actions. Do you want to remove the other assignments?')
  assert.equal(CONFLICT_DIALOG_TITLE, 'Warning')
  assert.deepEqual(CONFLICT_DIALOG_BUTTONS, { remove: 'Remove', keep: 'Keep', cancel: 'Cancel' })
  assert.equal(CONFLICTS_LABEL, 'Already assigned to:')
})

// ── 逐行证据复核（把上面注释里引的坐标钉成「那一行必须含这个符号」）─────────────

test('引用的上游坐标逐行存在（防止注释腐烂）', { skip: !upstreamAvailable }, () => {
  const EVIDENCE = [
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 778, 'override fun getConflicts'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 782, 'id == actionId || (actionId.startsWith("Editor")'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 787, 'getActionBinding(id)'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 795, 'shortcut1.firstKeyStroke != keyboardShortcut.firstKeyStroke'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 799, 'keyboardShortcut.secondKeyStroke != null'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 621, "getAttributeValue(ID_ATTRIBUTE)"],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 629, 'FIRST_KEYSTROKE_ATTRIBUTE'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 683, 'creating the list even when there are no shortcuts'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 685, 'actionIdToShortcuts.put(id'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/KeymapImpl.kt', 838, 'sortInRegistrationOrder'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java', 565, 'isShortcutConflictAction'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java', 569, 'actionId.startsWith("Editor")'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java', 572, 'getActionBinding(conflictActionId)'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java', 576, 'removeConflictingShortcuts'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/ShortcutDialog.java', 79, 'getConflicts(shortcut, myActionId, myKeymap)'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/MouseShortcutDialog.java', 62, 'getConflicts(MouseShortcut shortcut'],
    ['platform/platform-api/src/com/intellij/openapi/keymap/Keymap.java', 83, 'getConflicts(@NotNull String actionId'],
    ['platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java', 137, 'public static KeyStroke getKeyStroke(String string)'],
    ['platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java', 262, 'mapNameToMask.put("ctrl"'],
    ['platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java', 263, 'mapNameToMask.put("control"'],
    ['platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java', 280, 'for (Field field : KeyEvent.class.getFields())'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/IdeKeyEventDispatcher.kt', 710, 'context.isModalContext'],
    ['platform/platform-impl/src/com/intellij/openapi/keymap/impl/SystemShortcuts.java', 127, 'getUnmutedKeymapConflicts'],
    ['platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerImpl.kt', 462, 'registrationOrderComparator'],
    ['platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerRegistration.kt', 253, 'fun getActionBinding(actionId: String'],
    ['platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionManagerXmlSupport.kt', 73, 'USE_SHORTCUT_OF_ATTR_NAME = "use-shortcut-of"'],
    ['platform/platform-api/resources/messages/KeyMapBundle.properties', 34, 'conflict.shortcut.dialog.message'],
    ['platform/platform-api/resources/messages/KeyMapBundle.properties', 63, 'dialog.conflicts.text'],
    ['platform/platform-resources/src/keymaps/$default.xml', 254, '<action id="GotoTest">'],
    ['platform/platform-resources/src/keymaps/$default.xml', 255, 'control shift T'],
    ['platform/platform-resources/src/keymaps/$default.xml', 1188, '<action id="ServiceView.ShowServices">'],
    ['platform/platform-resources/src/keymaps/$default.xml', 1189, 'control shift T'],
    ['platform/platform-resources/src/keymaps/$default.xml', 340, '<action id="OptimizeImports">'],
    ['platform/platform-resources/src/keymaps/$default.xml', 1257, '<action id="UsageGrouping.FlattenModules">'],
    ['platform/platform-resources/src/keymaps/$default.xml', 266, '<action id="GotoChangedFile"/>'],
    ['platform/platform-resources/src/keymaps/$default.xml', 1206, 'first-keystroke="alt down"'],
  ]
  for (const [file, line, token] of EVIDENCE) {
    const lines = upstreamLines(file)
    assert.ok(lines, `读不到 ${file}`)
    assert.ok(lines.length >= line, `${file}:${line} 超出文件长度 ${lines.length}`)
    assert.ok(lines[line - 1].includes(token),
      `${file}:${line} 是「${lines[line - 1].trim().slice(0, 80)}」，不含钉住的「${token}」`)
  }
})

test('上游 $default.xml 里没有 context / place 属性（任务书前提不成立，逐表枚举）', { skip: !upstreamAvailable }, () => {
  assert.ok(xmlText, '读不到 $default.xml')
  const attributes = new Set()
  for (const match of xmlText.matchAll(/[A-Za-z_][\w:.-]*\s*=/g)) attributes.add(match[0].replace(/\s*=$/, ''))
  assert.equal(attributes.has('context'), false)
  assert.equal(attributes.has('place'), false)
  // 真实属性集就这十个。
  assert.deepEqual([...attributes].sort(), [
    'disable-mnemonics', 'first-keystroke', 'id', 'keystroke', 'modifier', 'name', 'second-keystroke', 'version',
  ])
})