// 装订线右键菜单（IDEA `EditorGutterPopupMenu`）—— 行模型 + 接线。
//
// 上游组的内容在 src/gutterMenu.ts 的文件头里逐条列了（含 `EditorGutterPopupMenu` 的三段与两处
// add-to-group：书签那组在**软换行之前**、`ShowGutterIconsSettings` 在最后）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { createGutterMenu, gutterBookmarkLabel } from '../src/gutterMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const editor = read('src/components/CodeEditor.vue')
const fileGutter = read('src/editorGutterIcons.ts')
const app = read('src/App.vue')
const menu = read('src/components/EditorPopupMenu.vue')

const settings = (patch = {}) => ({ wordWrap: false, lineNumbers: true, showIndentGuides: true, showStickyLines: true, ...patch })
function host(overrides = {}) {
  const editorSettings = ref(settings(overrides.settings))
  const bookmarks = ref(overrides.bookmarks ?? [])
  const calls = []
  const h = createGutterMenu({
    editorSettings, bookmarks,
    bookmarkAt: (path, line) => bookmarks.value.find(entry => entry.path === path && entry.line === line),
    toggleBookmark: (path, line) => calls.push(['toggle', path, line]),
    editDescription: (path, line) => calls.push(['edit', path, line]),
    chooseMnemonic: (path, line) => calls.push(['mnemonic', path, line]),
    clearMnemonic: (path, line) => calls.push(['clear', path, line]),
    patchSettings: patch => calls.push(['patch', patch]),
    openSettings: page => calls.push(['settings', page]),
    toggleFocusMode: () => calls.push(['focus']),
    focusModeOn: () => overrides.focus ?? false,
  })
  const rowById = id => h.gutterMenuRows.value.find(row => row.id === id)
  return { h, editorSettings, bookmarks, calls, rowById }
}

test('没有书签时只有"添加书签"；有书签才有编辑描述/助记键那几行', () => {
  const plain = host()
  plain.h.openGutterMenu({ path: 'a.ts', line: 4, x: 10, y: 20 })
  const ids = plain.h.gutterMenuRows.value.map(row => row.id)
  assert.ok(ids.includes('gutter.toggleBookmark'))
  assert.deepEqual(ids.filter(id => id.startsWith('gutter.') && /editBookmark|bookmarkMnemonic|clearMnemonic/.test(id)), [],
    '没有书签时不该出现编辑/助记键那三行')
  assert.equal(plain.rowById('gutter.toggleBookmark').title, '添加书签')
  plain.rowById('gutter.toggleBookmark').run()
  assert.deepEqual(plain.calls[0], ['toggle', 'a.ts', 4], '动作落在右键那一行上')
  assert.equal(plain.h.gutterMenu.value, null, '动作之后菜单关闭')

  const withBookmark = host({ bookmarks: [{ path: 'a.ts', line: 4, mnemonic: 'A' }] })
  withBookmark.h.openGutterMenu({ path: 'a.ts', line: 4, x: 0, y: 0 })
  const rows = withBookmark.h.gutterMenuRows.value.map(row => row.id)
  assert.equal(withBookmark.rowById('gutter.toggleBookmark').title, '删除书签')
  assert.ok(rows.includes('gutter.editBookmark') && rows.includes('gutter.bookmarkMnemonic'))
  assert.ok(rows.includes('gutter.clearMnemonic'), '有助记键时才有"删除助记键"')
  withBookmark.rowById('gutter.clearMnemonic').run()
  assert.deepEqual(withBookmark.calls[0], ['clear', 'a.ts', 4])
  // 行书签**不出现**「添加另一书签…」（上游 `AddAnotherBookmarkAction.update:16-19`）。
  assert.ok(!rows.some(id => /addAnother/i.test(id)), '行书签不该有"添加另一书签"')
})

test('软换行/外观三项读设置、写完回调 patch；配置项打开设置页', () => {
  const h = host({ settings: { wordWrap: true } })
  h.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  assert.equal(h.rowById('gutter.softWraps').checked(), true)
  // 每一行动作之后菜单都会关（行是从"当前目标"算出来的），所以每次取行前重新打开。
  h.rowById('gutter.softWraps').run()
  assert.deepEqual(h.calls[0], ['patch', { wordWrap: false }])
  h.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  h.rowById('gutter.configureSoftWraps').run()
  assert.deepEqual(h.calls[1], ['settings', 'editor'])
  h.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  const appearance = h.rowById('gutter.appearance')
  assert.deepEqual(appearance.children.map(row => row.id), ['gutter.lineNumbers', 'gutter.indentGuides', 'gutter.stickyLines'])
  assert.equal(appearance.children[0].checked(), true)
  appearance.children[2].run()
  assert.deepEqual(h.calls[2], ['patch', { showStickyLines: false }])
  h.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  h.rowById('gutter.iconsSettings').run()
  assert.deepEqual(h.calls[3], ['settings', 'editor.preferences.gutterIcons'])
})

test('焦点模式那一行随状态换标题；行顺序与上游组一致（书签在最前、图标设置在最后）', () => {
  const off = host()
  off.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  assert.equal(off.rowById('gutter.focusMode').title(), '进入专注模式')
  const on = host({ focus: true })
  on.h.openGutterMenu({ path: 'a.ts', line: 1, x: 0, y: 0 })
  assert.equal(on.rowById('gutter.focusMode').title(), '退出专注模式')
  const ids = on.h.gutterMenuRows.value.map(row => row.id)
  assert.equal(ids[0], 'gutter.toggleBookmark', '书签组在软换行之前')
  assert.equal(ids[ids.length - 1], 'gutter.iconsSettings', '装订线图标设置在最后')
})

test('接线：编辑器把装订线的右键转成事件、外壳渲染菜单', () => {
  assert.match(fileGutter, /export function gutterContextMenu\(onMenu: \(line0: number, x: number, y: number\) => void\): Extension/, '缺 gutter 右键的扩展')
  assert.match(fileGutter, /view\.dom\.querySelector<HTMLElement>\('\.cm-gutters'\)/, '监听器要挂在装订线元素上（cm-content 上收不到）')
  assert.match(fileGutter, /event\.stopPropagation\(\)/, '不吞事件就会冒泡成编辑器菜单')
  assert.doesNotMatch(fileGutter, /EditorView\.domEventHandlers\(\{\s*\n\s*contextmenu/, 'domEventHandlers 只挂在内容元素上，装订线收不到')
  assert.match(editor, /gutterContextMenu\(\(line, x, y\) => emit\('gutterMenu', \{ line, x, y \}\)\)/, '编辑器没把右键转出去')
  assert.match(app, /@gutter-menu="at => openGutterMenu\(\{ path: tab\.path, line: at\.line, x: at\.x, y: at\.y \}\)"/, '外壳没接装订线菜单事件')
  assert.match(app, /<EditorPopupMenu v-if="gutterMenu"/, '菜单没渲染')
  assert.match(menu, /aria-label="label \?\? '编辑器'"/, '菜单组件要能换 aria-label（装订线菜单不是编辑器菜单）')
  assert.equal(gutterBookmarkLabel(undefined), '添加书签')
  assert.equal(gutterBookmarkLabel({ path: 'a' }), '删除书签')
})

// 顺带钉一条刚拆出来的纯规则：粘性行（`editor.stickyLines`）—— 粘性行的三条设置项就在
// 装订线菜单的「外观 ▸」里，拆到 src/stickyLines.ts 之后规则本身也要有判据。
test('粘性行：取包含光标行的最内层 N 条，开关/上限都能关掉它', async () => {
  const { createStickyLines } = await import('../src/stickyLines.ts')
  const outline = ref([
    { name: 'Class', kind: 5, startLine: 0, endLine: 40, startChar: 0, endChar: 0 },
    { name: 'outer()', kind: 6, startLine: 10, endLine: 30, startChar: 0, endChar: 0 },
    { name: 'inner()', kind: 6, startLine: 20, endLine: 25, startChar: 0, endChar: 0 },
  ])
  const settings = ref({ showStickyLines: true, stickyLinesLimit: 2 })
  const lines = createStickyLines({ editorSettings: settings, outline, currentLine: () => 22 }).stickyLines
  assert.deepEqual(lines.value.map(line => line.name), ['outer()', 'inner()'], '外层在上、最内层在下，超过上限只留最内层')
  settings.value = { showStickyLines: false, stickyLinesLimit: 2 }
  assert.deepEqual(lines.value, [], '开关关掉就没有粘性行')
  settings.value = { showStickyLines: true, stickyLinesLimit: 0 }
  assert.deepEqual(lines.value, [], '上限 0 同样没有')
})
