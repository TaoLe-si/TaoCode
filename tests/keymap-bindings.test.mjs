// 快捷键注册表（`src/keymapBindings.ts`）：键位事实、分派匹配、冲突检测、键位方案继承，
// 以及「分派器真的从这张表读」的机检（表与 `src/keymap.ts` 的动作映射不许漂移）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  DEFAULT_SCHEME, EDITOR_ACTIONS, KEY_BINDINGS, chordIdentity, findKeyBinding, keymapConflicts, keymapKeys,
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
  // base 显式给这份**分派表自己**的出厂表：`effectiveKeyBindings()` 的缺省 base 是
  // `KEYMAP_EDITABLE_BINDINGS`（多含 agent 工具栏那几条，它们不归这里分派）⇒ 少给这一档就会
  // 混进下面 `mapped` 对不上的 id。
  assert.match(source, /const bindings = effectiveKeyBindings\(undefined, KEY_BINDINGS\)/)
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

// 编辑器一族（`EDITOR_ACTIONS`）：这六条的上游动作**没有全局键位** —— `$default.xml` 里查不到
// （`EditorSortLines` 一族 + 克隆光标那对），或者那把人是在编辑器自己的 CodeMirror keymap 里按到的
// （`EditorMatchBrace`）。它们因此不进 `KEY_BINDINGS`、只进动作注册表。这里把这一族的三处钉成一处：
//   1. 键位表里查不到它们的显示串（按不下去的键绝不写进菜单，也不冒充上游）；
//   2. `src/menus/editMenu.ts` 那一行的文案与键位栏逐字等于表里的 `label` 与 `key`
//      （`key.source === 'none'` ⇒ 菜单那一格必须是空串）；
//   3. `upstream`/`repo` 两档说「编辑器里按得到」⇒ `CodeEditor.vue` 的 keymap 必须真有那一行，
//      而 `boundAt` 记的行号就是它所在的行（挪了行号也要红，不许留假坐标）。
test('编辑器一族：上游没键位的不编键位，写了键位的必须真绑着（菜单文案与键位栏同源）', () => {
  const menu = readFileSync(new URL('src/menus/editMenu.ts', root), 'utf8')
  // 编辑器常驻 keymap 2026-10-06 搬进 src/editorKeymap.ts（CodeEditor.vue 贴着机检上限，
  // 拆一次降一次）；`boundAt` 指向新落点，判据读同一份文件、行号仍要指着真在绑的那一行。
  const editor = readFileSync(new URL('src/editorKeymap.ts', root), 'utf8').split('\n')
  const lineMatches = (text, action) => text.includes(`key: '${action.key.cm}'`) && text.includes(`editingCommands['${action.command}']`)
  const editableRows = [...menu.matchAll(/ctx\.editable\('([^']+)', '([^']*)', '([^']*)'/g)]
  assert.equal(new Set(EDITOR_ACTIONS.map(action => action.id)).size, EDITOR_ACTIONS.length, 'id 不许重复')
  for (const action of EDITOR_ACTIONS) {
    assert.equal(keymapKeys(action.id), '', `${action.id} 不该出现在全局键位表里（它没有全局键位）`)
    assert.equal(KEY_BINDINGS.some(binding => binding.label === action.label), false,
      `${action.id} 的文案已经在 KEY_BINDINGS 里了，两处会各写一份`)
    assert.match(action.upstreamId, /^Editor/, `${action.id} 要钉的是上游的编辑器动作 id`)
    assert.ok(action.keywords.includes(action.upstreamId), `${action.id} 的 keywords 要含上游 id（按上游 id 也搜得到）`)
    const rows = editableRows.filter(row => row[1] === action.id)
    assert.equal(rows.length, 1, `${action.id} 在编辑菜单里应当恰好一行，实际 ${rows.length} 行`)
    assert.equal(rows[0][2], action.label, `${action.id} 的菜单文案与注册表文案漂移`)
    assert.equal(rows[0][3], action.key.source === 'none' ? '' : action.key.display,
      `${action.id} 的菜单键位栏必须与注册条目一致（none ⇒ 空串：上游没键位就不编）`)
    assert.ok(action.key.upstream.includes('actions.xml:'), `${action.id} 要写上游的注册处行号`)
    if (action.key.source === 'none') {
      assert.ok(action.key.upstream.includes('无绑定'), `${action.id} 的 none 档要写明键位表里查不到`)
      assert.ok(!editor.some(line => line.includes(`editingCommands['${action.command}']`) && /key: '/.test(line)),
        `${action.id} 记的是 none，编辑器 keymap 里却还绑着这把键`)
      continue
    }
    const [boundFile, boundLine] = action.key.boundAt.split(':')
    assert.equal(boundFile, 'src/editorKeymap.ts', `${action.id} 的键位在编辑器 keymap 里`)
    const line = editor[Number(boundLine) - 1] ?? ''
    // 盘上真正在绑这一把键的那一行（同一把键 + 同一个命令）：只许有一处，且 boundAt 必须指着它 ——
    // 这一行报错时直接给出行号，别让"漂移 5 行"变成一条看不出该改哪的断言。
    const realAt = editor.findIndex(text => lineMatches(text, action)) + 1
    assert.ok(realAt > 0, `${action.id} 在 CodeEditor.vue 的编辑器 keymap 里根本没有 \`key: '${action.key.cm}'\` + ${action.command} 那一行`)
    assert.equal(editor.filter(text => lineMatches(text, action)).length, 1, `${action.id} 的这把键在编辑器 keymap 里绑了不止一处`)
    assert.ok(line.includes(`key: '${action.key.cm}'`),
      `${action.id} 的 ${action.key.cm} 不在 ${action.key.boundAt}（盘上真正在绑的是 src/components/CodeEditor.vue:${realAt} ⇒ 改 boundAt 或改实现，别留着指空行）`)
    assert.ok(line.includes(`editingCommands['${action.command}']`), `${action.id} 在 ${action.key.boundAt} 绑的不是 ${action.command}`)
    if (action.key.source === 'upstream') assert.match(action.key.upstream, /\$default\.xml:\d/)
    else assert.ok(action.key.upstream.startsWith('本仓绑定'), `${action.id} 的键位是本仓给的，必须写明不许冒充上游`)
  }
})

// 「键位表 = 分派表 = 菜单显示 = 动作注册表」里的**菜单**那一路：菜单凡是手写了 `keys` 的行，
// 只要它的 id 在全局键位表里，那一格就必须逐字等于表里的 `display`。
// 两边写法不同 = 文案漂移；菜单写了表里没有的串 = 屏幕上出现一个按下去没反应的假加速键
// （表外的键位由上一条测试去核编辑器自己的 keymap，例：`brace.match` 的 `Ctrl Shift M` 在
// `src/components/CodeEditor.vue:846`，不在 `KEY_BINDINGS`）。
test('菜单手写的 keys 必须等于键位表里的 display（两处不许漂移）', () => {
  const displays = new Map(KEY_BINDINGS.map(binding => [binding.id, binding.display]))
  let checked = 0
  for (const name of readdirSync(new URL('src/menus', root)).filter(file => file.endsWith('.ts'))) {
    const source = readFileSync(new URL(`src/menus/${name}`, root), 'utf8')
    // 行 id 的两种写法：`editable/semantic(首参 = id)` 的第 3 个实参，与对象字面量里的 `keys:`。
    for (const match of source.matchAll(/(?:editable|semantic)\('([^']+)',\s*'([^']*)',\s*'([^']*)'/g)) {
      if (!displays.has(match[1])) continue
      checked += 1
      assert.equal(match[3], displays.get(match[1]), `${name} 里 ${match[1]} 的键位栏与键位表不一致`)
    }
    // 对象字面量：`{ id: '…', …, keys: '…' }`。`[^{}]` 保证不会把上一行的 id 与下一行的 keys 配成一对。
    for (const match of source.matchAll(/id: '([^']+)'[^{}]*?keys: '([^']*)'/gs)) {
      if (!displays.has(match[1])) continue
      checked += 1
      assert.equal(match[2], displays.get(match[1]), `${name} 里 ${match[1]} 的键位栏与键位表不一致`)
    }
  }
  assert.ok(checked >= 9, `机检面塌了：只核到 ${checked} 行（复制符号引用 / 全部保存 / 导航三条 / 重构四条都该在内）`)
})

// 2026-10-06 补的三条导航键位（`$default.xml:251-259`，桶 4b 的 W1 键位半边）：
// 可用性谓词必须与菜单行的 `enabled` 同一套判据，`forbid` 必须挡得住同物理键的别家动作。
test('导航三条新键位：可用性与菜单行 enabled 同源，且上游的精确匹配不许串味', () => {
  const combos = []
  for (const workspace of [false, true]) for (const editor of [false, true]) for (const lsp of [false, true]) combos.push({ workspace, editor, lsp })
  const expected = {
    // 菜单：`enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value`（navigateMenu.ts:155）
    'navigate.super': keyState => keyState.editor && keyState.lsp,
    // 菜单：`Boolean(ctx.active.value) && Boolean(ctx.workspace.value)`（navigateMenu.ts:162 / :170）
    'navigate.test': keyState => keyState.workspace && keyState.editor,
    'navigate.related': keyState => keyState.workspace && keyState.editor,
  }
  for (const [id, predicate] of Object.entries(expected)) {
    const binding = KEY_BINDINGS.find(item => item.id === id)
    assert.ok(binding?.when, `${id} 要有可用性谓词（没有就总是一击即中）`)
    for (const combo of combos) assert.equal(binding.when(combo), predicate(combo),
      `${id} 在 ${JSON.stringify(combo)} 的可用性与菜单行不一致`)
  }
  // Ctrl+Shift+U = EditorToggleCase（`$default.xml:529-530`）、Ctrl+Alt+T = SurroundWith（`:915-916`）、
  // Ctrl+Shift+Home = EditorTextStartWithSelection（`:562-563`）⇒ 多一个修饰键都不许命中新加的三条。
  assert.equal(findKeyBinding(event('u', { ctrlKey: true, shiftKey: true }), state), null, 'Ctrl+Shift+U 该归切换大小写')
  assert.equal(findKeyBinding(event('u', { ctrlKey: true, altKey: true }), state), null, 'Ctrl+Alt+U 没人绑')
  assert.equal(findKeyBinding(event('t', { ctrlKey: true, altKey: true }), state), null, 'Ctrl+Alt+T 该归环绕方式')
  assert.equal(findKeyBinding(event('t', { ctrlKey: true }), state), null, 'Ctrl+T（更新项目）在 if 链里，不在表里')
  assert.equal(findKeyBinding(event('Home', { ctrlKey: true, shiftKey: true }), state), null, 'Ctrl+Shift+Home 是编辑器内动作')
  assert.equal(findKeyBinding(event('Home', { altKey: true }), state), null, 'Alt+Home（ShowNavBar）在 if 链里，不带 Ctrl')
  assert.equal(findKeyBinding(event('u', { ctrlKey: true }), state)?.id, 'navigate.super')
  assert.equal(findKeyBinding(event('t', { ctrlKey: true, shiftKey: true }), state)?.id, 'navigate.test')
  assert.equal(findKeyBinding(event('Home', { ctrlKey: true, altKey: true }), state)?.id, 'navigate.related')
})

// R3 判决（2026-10-06 keymap2）：`Ctrl+Alt+Shift+↑/↓` 的上游主人是 `ResizeToolWindowUp`/
// `ResizeToolWindowDown`（platform/platform-resources/src/keymaps/$default.xml:879-884），
// `EditorCloneCaretAbove`/`EditorCloneCaretBelow` 在 `$default.xml` 里**零命中**（注册只在
// platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:218-219，实现类
// platform/platform-impl/src/com/intellij/openapi/editor/actions/CloneCaretAbove.java:8-11 与
// CloneCaretActionHandler.java:24 都不在代码里声明键位）⇒ 本仓那两行编辑器键位已摘、
// 菜单两行的键位栏清空、`EDITOR_ACTIONS` 的两条从 `repo` 降到 `none`。
// 这一条钉住摘干净之后的真值表：键位回潮、display 残留、菜单格子复活、上游主人那条链被删，都红。
test('克隆光标那对不占工具窗口调整大小的键（R3 摘键后的真值表）', () => {
  const editor = readFileSync(new URL('src/components/CodeEditor.vue', root), 'utf8').split('\n')
  const menu = readFileSync(new URL('src/menus/editMenu.ts', root), 'utf8')
  const dispatch = readFileSync(new URL('src/keymap.ts', root), 'utf8')
  const arrows = { 'cursor.above': ['Ctrl-Alt-Shift-Up', 'ArrowUp'], 'cursor.below': ['Ctrl-Alt-Shift-Down', 'ArrowDown'] }
  for (const [id, [cm, arrow]] of Object.entries(arrows)) {
    const action = EDITOR_ACTIONS.find(item => item.id === id)
    assert.ok(action, `${id} 还在编辑器一族的表里（摘的是键，不是命令）`)
    assert.equal(action.key.source, 'none', `${id}：上游 $default.xml 无绑定 ⇒ none 档`)
    // 逐字符：none 档不许留下任何键位文案（残留 = 屏幕上有个按不动的格子）。
    assert.equal(action.key.display, undefined, `${id} 的 none 档不许带 display`)
    assert.equal(action.key.cm, undefined, `${id} 的 none 档不许带 cm 写法`)
    assert.equal(action.key.boundAt, undefined, `${id} 的 none 档不许带 boundAt`)
    assert.ok(action.key.upstream.includes('无绑定'), `${id} 的 none 档要写明键位表里查不到`)
    assert.match(action.key.upstream, /\$default\.xml:87(9)|\$default\.xml:88(2)/,
      `${id} 要写明这把键在上游归 ResizeToolWindow*`)
    assert.ok(menu.includes(`ctx.editable('${id}', '${action.label}', '', `),
      `${id} 的菜单行键位栏必须是空串（与注册条目同源，见上一条测试）`)
    assert.equal(editor.some(line => line.includes(`key: '${cm}'`)), false, `${cm} 还绑在编辑器 keymap 里`)
    assert.equal(keymapKeys(id), '', `${id} 不该出现在全局键位表里`)
    assert.equal(findKeyBinding(event(arrow, { ctrlKey: true, altKey: true, shiftKey: true }), state), null,
      `${arrow} + Ctrl+Alt+Shift 不在表里（主人是 if 链的 stretchToolWindow）`)
  }
  // 摘键 ≠ 丢键：上游那把键在本仓仍然由 `stretchToolWindow` 接单，四个方向一个都不许少。
  for (const direction of ['left', 'right', 'up', 'down']) {
    assert.ok(dispatch.includes(`stretchToolWindow('${direction}')`), `Ctrl+Alt+Shift+方向键的 ${direction} 一档要从分派链里消失`)
  }
  // 整族门：表里任何一条都不许抢 Ctrl+Alt+Shift+方向键（上游四个方向全给了 ResizeToolWindow*）。
  const stolen = KEY_BINDINGS.filter(binding => /^arrow/i.test(binding.chord.key)
    && binding.chord.alt === true && binding.chord.shift === true)
  assert.deepEqual(stolen.map(binding => binding.id), [], 'Ctrl+Alt+Shift+方向键整族属 ResizeToolWindow*，表里不许出现')
})

// R4（问题面板选中行的 Alt+Enter · 桶 2 的 2b2）：本轮**逐条重核**那两件前置，不看文档。
// ① 面板的出口**已经在了** —— `src/components/ProblemsPanel.vue` 现在有
//    `function openMenuForSelected()` 与 `defineExpose({ openMenuForSelected })`
//    （请求文档 R4 原先写「现在没有任何 defineExpose」，那是**旧的**，这里按实际留痕）。
// ② 宿主仍然**没有**「此刻焦点在问题面板」这一位：`KeyBindingState` 还是 workspace/editor/lsp 三面
//    （`src/keymapBindings.ts:26-30`），而宿主渲染 `<ProblemsPanel>` 时连模板 ref 都没给 ⇒
//    没人能调那个出口，`when` 也无从写起。
// ⇒ 缺②就不进表：写进去就是一条命中后只 `preventDefault` 不干事的假绑定（本仓铁律）。
// App.vue 那一路到位（模板 ref + 焦点位塞进 `createKeymap`）时，这条测试与键位表一起改，
// 照抄配方在 `docs/wiring-requests-2026-10-06-keymap.md` R4。
test('问题面板的 Alt+Enter：两件前置只到了一件，缺焦点位就不进表（R4 判定）', () => {
  const panel = readFileSync(new URL('src/components/ProblemsPanel.vue', root), 'utf8')
  const host = readFileSync(new URL('src/App.vue', root), 'utf8')
  // 前置①：面板已经把「对当前聚焦行开操作菜单」出口给到动作层。
  assert.match(panel, /function openMenuForSelected\(\)/)
  assert.match(panel, /defineExpose\(\{ openMenuForSelected \}\)/)
  // 前置②（仍缺）：宿主既没拿面板实例（无模板 ref），也没把面板焦点位喂进 `createKeymap`。
  assert.equal(/<ProblemsPanel[^>]*\sref="/.test(host), false,
    'App.vue 已给 <ProblemsPanel> 模板 ref ⇒ 前置②到位，请把 Alt+Enter 落进 KEY_BINDINGS 并同步本条')
  assert.equal(/problems\??:/.test(readFileSync(new URL('src/keymapBindings.ts', root), 'utf8')), false,
    'KeyBindingState 里不许先躺一个没人给的 problems 位（先接线、后进表）')
  // 表里此刻不许有 Alt+Enter 的第二位主人：编辑器那一档在 CodeEditor.vue 的 keymap 里，不在表里。
  assert.equal(findKeyBinding(event('Enter', { altKey: true }), state), null,
    'Alt+Enter 属编辑器的 ShowIntentionActions（$default.xml:480-482），面板那一档没接线前不进表')
  const altEnter = KEY_BINDINGS.filter(binding => binding.chord.key.toLowerCase() === 'enter' && binding.chord.alt === true)
  assert.deepEqual(altEnter.map(binding => binding.id), [], 'Alt+Enter 只能有一个主人：面板焦点位到位之前不许进表')
  // 可用性谓词只许读真实存在的状态位：读到表外的字段会得到 undefined，`findKeyBinding` 里
  // `binding.when && !binding.when(state)` 就把这一格永远跳过 —— 一条永远按不到的死绑定。
  for (const binding of KEY_BINDINGS) {
    if (!binding.when) continue
    for (const combo of [{ workspace: false, editor: false, lsp: false }, { workspace: true, editor: true, lsp: true }]) {
      assert.equal(typeof binding.when(combo), 'boolean', `${binding.id} 的 when 读到了 KeyBindingState 之外的状态位`)
    }
  }
})

// `menuUi.ts` 里那句计数注释（「`keymapBindings.ts` 的 N 个动作 id 里有 M 个在 `src/menus/*` 找不到对应行」）
// 数漂过一回：写的是 25/21，R1+R2 落了导航三条与编辑器一族之后表已经是 30 条。
// R5 的处置 = 注释订正成实数，并把两个数**现算**钉在这里，以后加一条键位就跟着变，不再靠人肉数。
test('menuUi 与 searchEverywhereHost 的计数注释与键位表同步（数字不许漂）', () => {
  const comment = readFileSync(new URL('src/menuUi.ts', root), 'utf8')
    .match(/`keymapBindings\.ts` 的 (\d+) 个动作 id 里有 \*\*(\d+) 个\*\*在 `src\/menus\/\*` 找不到对应行/)
  assert.ok(comment, 'menuUi.ts 那句计数注释的写法变了 ⇒ 这条门控就空转了，改注释时一起改这里')
  const menuTexts = readdirSync(new URL('src/menus', root)).filter(file => file.endsWith('.ts'))
    .map(file => readFileSync(new URL(`src/menus/${file}`, root), 'utf8'))
  const orphanIds = KEY_BINDINGS.filter(binding => !menuTexts.some(text => text.includes(`'${binding.id}'`)))
    .map(binding => binding.id)
  assert.equal(Number(comment[1]), KEY_BINDINGS.length, '注释里的总数与表的条数不一致')
  assert.equal(Number(comment[2]), orphanIds.length, '注释里「找不到对应行」的条数与实际不一致')
  const hostComment = readFileSync(new URL('src/searchEverywhereHost.ts', root), 'utf8')
    .match(/那 (\d+) 个只有键位、没有菜单行的动作/)
  assert.ok(hostComment, 'searchEverywhereHost.ts 那句「那 N 个」的写法变了 ⇒ 同上，一起改这里')
  assert.equal(Number(hostComment[1]), orphanIds.length, 'searchEverywhereHost.ts 的计数与表不一致')
})

// keymap.ts 里有一道闸门：宿主没把某个 ctx 出口塞进 `createKeymap({...})`，那条 action 就**不参与注册**
// （`handlerOf` 返回 undefined ⇒ 命中键位也只把键原样放行）。方向是对的 —— 它挡的是
// 「键位表写着 Ctrl+Shift+T、按下去只吞键不干活」的假动作。但反过来的失败没有任何门看着：
// 17:1x 实测 `code.optimizeImports`（Ctrl+Alt+O）在键位表、Code 菜单、`semanticActions` 出口三处都齐，
// 唯独 `App.vue:1816` 的装配没给 `runOrganizeImports` ⇒ 菜单能点、键按不动，而当时所有键位判据全绿。
// 这条钉的就是"表的另一头有人接着"。
test('keymap.ts 里以"宿主给没给"决定注不注册的出口，App.vue 的装配必须真的给', () => {
  const keymap = readFileSync(new URL('src/keymap.ts', root), 'utf8')
  const app = readFileSync(new URL('src/App.vue', root), 'utf8')
  const gate = /const unwired = new Set\(\[([\s\S]*?)\]\)/.exec(keymap)
  assert.ok(gate, 'keymap.ts 那道「没给就不注册」的闸门换了形状 ⇒ 这条门要跟着改，不许让它空转')
  const wanted = [...new Set([...gate[1].matchAll(/([A-Za-z][\w]*)\s*\?\s*''\s*:/g)].map(m => m[1]))].sort()
  assert.ok(wanted.length >= 4, `至少要钉住 4 条条件出口（实际扫到 ${wanted.length} 条：${wanted.join(', ')}）`)
  const call = /createKeymap\(\{([\s\S]*?)\n\}\)/.exec(app)
  assert.ok(call, 'App.vue 里 createKeymap({…}) 那一处装配找不到了')
  // 只认紧跟逗号的**简写**实参（`runOrganizeImports,`）；`x: (...a) => fn(...a),` 那种逗号前是 `)`，不算给过。
  const given = new Set([...call[1].matchAll(/(?:^|[,\s])([A-Za-z][\w]*)\s*,/gm)].map(m => m[1]))
  for (const name of wanted) {
    assert.ok(given.has(name),
      `键位表按 ${name} 决定那条 action 注不注册，宿主装配里却没有 ⇒ 那把键静默放行、菜单里倒是能点（假动作）`)
  }
  // 反假绿：装配块里必须真的扫到过东西，否则上面那个循环是在空转。
  assert.ok(given.size >= 40, `App.vue 的 createKeymap 块只扫到 ${given.size} 个实参 ⇒ 抽取形状错了，这条门拦不住任何东西`)
})

