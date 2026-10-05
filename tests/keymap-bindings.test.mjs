// 快捷键注册表（`src/keymapBindings.ts`）：键位事实、分派匹配、冲突检测、键位方案继承，
// 以及「分派器真的从这张表读」的机检（表与 `src/keymap.ts` 的动作映射不许漂移）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_SCHEME, KEY_BINDINGS, chordIdentity, findKeyBinding, keymapConflicts, keymapKeys,
  matchesKeyChord, parseChord, resolveKeymapSchemes,
} from '../src/keymapBindings.ts'
import { chordToOverrideText } from '../src/keymapEditor.ts'

const root = new URL('..', import.meta.url)
const event = (key, modifiers = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...modifiers })
const state = { workspace: true, editor: true, lsp: true }

test('出厂键位表没有同作用域冲突，且每条都带上游依据', () => {
  assert.deepEqual(keymapConflicts(KEY_BINDINGS), [])
  for (const binding of KEY_BINDINGS) assert.ok(binding.upstream.includes('$default.xml') || binding.upstream.startsWith('本仓'), binding.id)
})

test('冲突检测：同键位同作用域的两个动作被报出，赢家是分派顺序靠前者', () => {
  const duplicate = [
    { id: 'a', label: 'A', display: 'Ctrl K', scope: 'global', chord: { key: 'k', control: 'mod' }, upstream: '本仓' },
    { id: 'b', label: 'B', display: 'Ctrl K', scope: 'global', chord: { key: 'k', control: 'mod' }, upstream: '本仓' },
  ]
  const conflicts = keymapConflicts(duplicate)
  assert.equal(conflicts.length, 1)
  assert.deepEqual(conflicts[0].ids, ['a', 'b'])
  assert.equal(conflicts[0].winner, 'a')
  // 不同作用域不算冲突；不同 `control` 口径（ctrl vs mod）也不算同一键位。
  assert.deepEqual(keymapConflicts([{ ...duplicate[0], scope: 'editor' }, duplicate[1]]), [])
  assert.deepEqual(keymapConflicts([{ ...duplicate[0], chord: { key: 'k', control: 'ctrl' } }, duplicate[1]]), [])
  assert.ok(chordIdentity({ key: 'K', control: 'mod' }) === chordIdentity({ key: 'k', control: 'mod' }))
})

test('匹配语义：写了的必须按、forbid 必须没按、没写的不看（与原 if 链同口径）', () => {
  const pasteHistory = KEY_BINDINGS.find(binding => binding.id === 'edit.pasteHistory')
  const pastePlain = KEY_BINDINGS.find(binding => binding.id === 'edit.pastePlain')
  assert.ok(matchesKeyChord(pasteHistory.chord, event('v', { ctrlKey: true, shiftKey: true })))
  assert.ok(!matchesKeyChord(pasteHistory.chord, event('v', { ctrlKey: true, shiftKey: true, altKey: true })))
  assert.ok(matchesKeyChord(pastePlain.chord, event('v', { ctrlKey: true, shiftKey: true, altKey: true })))
  // 「没写的不看」：Ctrl+Shift+S 落到 SaveAll（旧 if 链就只查了键名）；Meta 也算 mod。
  assert.equal(findKeyBinding(event('s', { ctrlKey: true, shiftKey: true }), state)?.id, 'file.saveAll')
  assert.equal(findKeyBinding(event('s', { metaKey: true }), state)?.id, 'file.saveAll')
  // 显式 ctrl 的分支不认 Meta。
  assert.equal(findKeyBinding(event('q', { metaKey: true }), state), null)
})

test('分派优先级：同一事件命中多条时取表里靠前的那条', () => {
  // Ctrl+Shift+Alt+N：symbol.global 与 file.open（alt 不看）都匹配 —— 表顺序让 GotoSymbol 赢。
  assert.equal(findKeyBinding(event('n', { ctrlKey: true, shiftKey: true, altKey: true }), state)?.id, 'symbol.global')
  // Ctrl+Shift+E 与 Ctrl+E：RecentLocations 在前，RecentFiles 在后。
  assert.equal(findKeyBinding(event('e', { ctrlKey: true, shiftKey: true }), state)?.id, 'navigate.recentLocations')
  assert.equal(findKeyBinding(event('e', { ctrlKey: true }), state)?.id, 'navigate.recentFiles')
  // Ctrl+Shift+F12 在 Ctrl+F12 之前，Shift 变体不会被文件结构吞掉。
  assert.equal(findKeyBinding(event('F12', { ctrlKey: true, shiftKey: true }), state)?.id, 'window.maximizeEditor')
  assert.equal(findKeyBinding(event('F12', { ctrlKey: true }), state)?.id, 'symbol.file')
})

test('可用性谓词：workspace/editor/lsp 三面显式写在表里', () => {
  assert.equal(findKeyBinding(event('n', { ctrlKey: true, shiftKey: true }), { workspace: false, editor: true, lsp: true }), null)
  assert.equal(findKeyBinding(event('F12', { ctrlKey: true }), { workspace: true, editor: true, lsp: false }), null)
  assert.equal(findKeyBinding(event('g', { ctrlKey: true, shiftKey: true }), { workspace: true, editor: false, lsp: true }), null)
  // Ctrl+Shift+O 打开工作区：欢迎态（没有 workspace）也必须能用。
  assert.equal(findKeyBinding(event('o', { ctrlKey: true, shiftKey: true }), { workspace: false, editor: false, lsp: false })?.id, 'file.openPath')
})

test('键位显示串查表；键位方案按父链覆盖/解绑', () => {
  assert.equal(keymapKeys('edit.copyPath'), 'Ctrl Shift C')
  assert.equal(keymapKeys('edit.copyReference'), 'Ctrl Alt Shift C')
  assert.equal(keymapKeys('nope'), '')
  assert.deepEqual(parseChord('Ctrl+Shift+V'), { key: 'v', control: 'ctrl', shift: true })
  assert.equal(parseChord('Frobnicate+V'), null)

  const schemes = [
    DEFAULT_SCHEME,
    { name: 'Child', parent: 'Default', overrides: { 'edit.copyPath': 'Ctrl Alt P', 'docs.quickDoc': null } },
    { name: 'Grand', parent: 'Child', overrides: { 'edit.copyPath': 'Ctrl Alt Q' } },
  ]
  const resolved = resolveKeymapSchemes(schemes, KEY_BINDINGS)
  assert.deepEqual(resolved.find(s => s.name === 'Default').bindings, KEY_BINDINGS)
  assert.equal(resolved.find(s => s.name === 'Child').bindings.find(b => b.id === 'edit.copyPath').display, 'Ctrl Alt P')
  assert.equal(resolved.find(s => s.name === 'Child').bindings.find(b => b.id === 'docs.quickDoc'), undefined)
  assert.equal(resolved.find(s => s.name === 'Grand').bindings.find(b => b.id === 'edit.copyPath').display, 'Ctrl Alt Q')
  assert.deepEqual(resolved.find(s => s.name === 'Grand').unknownIds, [])
  assert.deepEqual(resolveKeymapSchemes([{ name: 'X', parent: null, overrides: { nope: 'Ctrl K' } }], KEY_BINDINGS)[0].unknownIds, ['nope'])
  // 环：A → B → A，不挂死，两边覆盖都生效（近的赢）。
  const cyclic = resolveKeymapSchemes([
    { name: 'A', parent: 'B', overrides: { 'edit.copyPath': 'Ctrl Alt A' } },
    { name: 'B', parent: 'A', overrides: { 'edit.copyPath': 'Ctrl Alt B' } },
  ], KEY_BINDINGS)
  assert.equal(cyclic.length, 2)
  assert.equal(cyclic[0].bindings.find(b => b.id === 'edit.copyPath').display, 'Ctrl Alt A')
})

test('消费链：分派器从表读，动作映射与表一一对应（不许漂移）', () => {
  const source = readFileSync(new URL('src/keymap.ts', root), 'utf8')
  assert.match(source, /from '\.\/keymapBindings\.ts'/)
  // 生效表 = 出厂表 + 用户自定义覆盖 + 运行期动态动作（宏）。
  // `effectiveKeyBindings()` 是上游 `KeymapManagerEx.getActiveKeymap()` 的等价物，
  // 分派与菜单显示读同一份，所以改键立刻改行为。
  assert.match(source, /const bindings = effectiveKeyBindings\(\)/)
  assert.match(source, /findKeyBinding\(event, \{ workspace: !!workspace\.value, editor: !!active\.value, lsp: lspReady\.value \}, bindings\)/)
  assert.match(source, /tailActions\[binding\.id\]/)
  const mapped = [...source.matchAll(/^\s*'([a-z][\w.]*)': \(\) =>/gm)].map(match => match[1])
  assert.deepEqual([...mapped].sort(), KEY_BINDINGS.map(binding => binding.id).sort(),
    '分派器的动作映射与注册表不一致（多一个或少一个都会在这里红）')
})

// 上游有一档键位是**只有 Alt**的（`SafeDelete` = `alt DELETE`，`$default.xml:999-1001`），
// `KeyChord.control` 因此是可缺省的；这里钉住「缺省 = 不要求 Ctrl/Meta」的匹配语义与显示串。
test('只有 Alt 的键位档：不带 Ctrl 也要能命中，且同物理键的另三档不许串味', () => {
  const safeDelete = KEY_BINDINGS.find(binding => binding.id === 'refactor.safeDelete')
  assert.ok(safeDelete, '出厂表里要有 SafeDelete 这一条（重构菜单那行的快捷键列查得到）')
  assert.equal(safeDelete.chord.control, undefined, '上游这条是 alt DELETE，不带 Ctrl')
  assert.ok(matchesKeyChord(safeDelete.chord, event('Delete', { altKey: true })))
  assert.ok(!matchesKeyChord(safeDelete.chord, event('Delete', { altKey: true, ctrlKey: true })),
    'Ctrl+Alt+Delete 不接管（上游 `control DELETE`(:1016)/`control shift DELETE`(:919)/`shift DELETE`(:433) 各有其人）')
  assert.ok(!matchesKeyChord(safeDelete.chord, event('Delete', { altKey: true, shiftKey: true })))
  assert.equal(findKeyBinding(event('Delete', { altKey: true }), state)?.id, 'refactor.safeDelete')
  // 显示串与冲突表身份都不许给「不带 Ctrl」这一档拼出假前缀。
  assert.equal(chordToOverrideText(safeDelete.chord), 'Alt+Delete')
  assert.ok(chordIdentity(safeDelete.chord).startsWith('none|'))
})
