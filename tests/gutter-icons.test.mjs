// 行内装订线图标层（IDEA `GutterIconRenderer` + `EditorToggleShowGutterIcons`）的规则与接线单测。
//
// 源码依据（路径与行号见 src/gutterIcons.ts 头部）：
//   · `GutterIconRenderer.java:59/68/105/121/210`（tooltip / clickAction / alignment / accessibleName / equals）
//   · `EditorSettingsExternalizable.java:87` 默认 `ARE_GUTTER_ICONS_SHOWN = true`
//   · `ToggleShowGutterIconsAction.java`（编辑器级 Toggle）、菜单 `PlatformActions.xml:577`
//   · 设置页 `GutterIconsConfigurable`（`id=editor.preferences.gutterIcons`，`:221` Apply）
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  GUTTER_ICON_ORDER, collectGutterIcons, gutterIconAppearance, gutterKindForSeverity,
} from '../src/gutterIcons.ts'
import { defaultEditorSettings } from '../src/bridge.ts'

const diagnostic = (line, severity, message) => ({ line, severity, message })

test('严重度折档：1 错误 / 2 警告 / 3·4 提示，缺省按提示', () => {
  assert.equal(gutterKindForSeverity(1), 'error')
  assert.equal(gutterKindForSeverity(2), 'warning')
  assert.equal(gutterKindForSeverity(3), 'hint')
  assert.equal(gutterKindForSeverity(4), 'hint')
  // 0 或负数按最严重的处理（LSP 里 1 是最严重，出现 0 说明上游没给值）
  assert.equal(gutterKindForSeverity(0), 'error')
})

test('五档都有外形与主题色（配色走 CSS 变量，明暗主题各自生效）', () => {
  const kinds = ['error', 'warning', 'hint', 'breakpoint', 'bookmark']
  assert.deepEqual([...GUTTER_ICON_ORDER], kinds)
  for (const kind of kinds) {
    const look = gutterIconAppearance(kind)
    assert.ok(look.shape, `${kind} 没有外形`)
    assert.match(look.color, /^var\(--[a-z-]+\)$/, `${kind} 的颜色不是主题变量：${look.color}`)
  }
})

test('关掉开关就一个图标都不产出（areGutterIconsShown=false）', () => {
  const sources = { diagnostics: [diagnostic(0, 1, 'boom')], breakpoints: [3], bookmarks: [5] }
  assert.equal(collectGutterIcons(sources, false).length, 0)
  assert.equal(collectGutterIcons(sources, true).length, 3)
})

test('同一行的多条诊断合成一个图标：档位取最严重，tooltip 列出全部消息', () => {
  const icons = collectGutterIcons({
    diagnostics: [diagnostic(0, 3, '提示一'), diagnostic(0, 1, '错误二'), diagnostic(0, 2, '警告三')],
  }, true)
  assert.equal(icons.length, 1, '同行多条诊断应合成一个图标（对应 IDEA 合成一个 renderer）')
  assert.equal(icons[0].kind, 'error')
  assert.equal(icons[0].tooltip, '提示一\n错误二\n警告三')
  assert.equal(icons[0].clickable, true, '诊断图标必须可点（GutterIconRenderer.getClickAction != null）')
  assert.equal(icons[0].alignment, 'center')
  assert.equal(icons[0].accessibleName, icons[0].tooltip, '无障碍名至少要有 tooltip 的内容')
})

test('诊断行号从 0 基折成 1 基（LSP 与 LineMarkerInfo 的基准差）', () => {
  const icons = collectGutterIcons({ diagnostics: [diagnostic(0, 1, 'a'), diagnostic(41, 2, 'b')] }, true)
  assert.deepEqual(icons.map(icon => icon.line), [1, 42])
})

test('断点与书签都可点：书签点击 = ToggleBookmark，中键 = EditBookmark（上游 :48-50）', () => {
  const icons = collectGutterIcons({ breakpoints: [7], bookmarks: [{ line: 9, tooltip: '书签' }] }, true)
  const breakpoint = icons.find(icon => icon.kind === 'breakpoint')
  const bookmark = icons.find(icon => icon.kind === 'bookmark')
  assert.equal(breakpoint.line, 7)
  assert.equal(breakpoint.clickable, true)
  assert.equal(bookmark.line, 9)
  assert.equal(bookmark.clickable, true, '书签图标的 getClickAction() 就是 ToggleBookmark')
  assert.equal(bookmark.middleClickable, true, '中键是 EditBookmark')
  assert.equal(bookmark.alignment, 'right', 'GutterLineBookmarkRenderer 对齐到 RIGHT')
  assert.equal(bookmark.tooltip, '书签', '悬停文本由调用方按上游拼好')
})

test('同一行混多种图标：按 GUTTER_ICON_ORDER 并排，行号升序', () => {
  // 注意两套基准：诊断是 0 基（LSP），断点/书签是 1 基 —— 第 5 行 = 诊断 line 4 = 断点/书签 5。
  const icons = collectGutterIcons({ diagnostics: [diagnostic(4, 2, 'w')], breakpoints: [5], bookmarks: [{ line: 5, tooltip: '书签' }] }, true)
  assert.deepEqual(icons.map(icon => [icon.line, icon.kind]),
    [[5, 'warning'], [5, 'breakpoint'], [5, 'bookmark']])
})

test('图标带去重键（源码要求 equals/hashCode，同一行同文本只应有一份）', () => {
  const icons = collectGutterIcons({ breakpoints: [1] }, true)
  assert.equal(icons[0].key, '1:breakpoint:断点：点击切换')
  const again = collectGutterIcons({ breakpoints: [1] }, true)
  assert.equal(again[0].key, icons[0].key)
})

test('默认设置里开关是开的，且前后端键白名单都登记了它', () => {
  assert.equal(defaultEditorSettings.showGutterIcons, true)
  // 白名单 2026-10-04 从 src/bridge.ts 搬到了 src/previewSettings.ts（bridge 贴着机检上限）。
  const preview = readFileSync('src/previewSettings.ts', 'utf8')
  assert.ok(preview.includes("key === 'showGutterIcons'"), '前端设置白名单里没有这个键')
  const schema = readFileSync('native/settings_schema.cpp', 'utf8')
  assert.ok(schema.includes('{"showGutterIcons", true}'), '原生默认值里没有这个键')
  assert.ok(readFileSync('native/settings_schema.hpp', 'utf8').includes('"showGutterIcons"'), '原生键白名单里没有它')
})

test('接线：编辑器装了图标层、宿主传了图标、菜单与设置页都有这一项', () => {
  const editor = readFileSync('src/components/CodeEditor.vue', 'utf8')
  // 图标层扩展 + 同步入口 + prop/emit
  assert.ok(editor.includes('gutterIconsExtension('), '编辑器没有装图标层')
  assert.ok(editor.includes("onMiddleClick: icon => emit('gutterIconMiddle', icon)"), '图标层没接中键（EditBookmark）')
  assert.ok(editor.includes('syncGutterIcons(view, props.gutterIcons ?? [])'), '编辑器没有同步图标')
  assert.ok(editor.includes('gutterIcons?: GutterIcon[]'), '编辑器没有 gutterIcons prop')
  // 断点/书签不再用整行 boxShadow 表达（迁到图标层，避免两套表达并存）
  assert.equal(/cm-has-breakpoint/.test(editor), false, '断点的整行 boxShadow 还在，与图标层重复')
  assert.equal(/cm-has-bookmark/.test(editor), false, '书签的整行 boxShadow 还在，与图标层重复')
  // 宿主传参 + 点击处理
  const app = readFileSync('src/App.vue', 'utf8')
  assert.ok(app.includes(':gutter-icons="gutterIcons"'), 'App 没有把图标传给编辑器')
  assert.ok(app.includes('@gutter-icon="onGutterIcon"'), 'App 没有接图标点击')
  assert.ok(app.includes('@gutter-icon-middle="onGutterIconMiddleClick"'), 'App 没有接图标中键（EditBookmark）')
  // 视图菜单（IDEA 位置：紧跟显示行号）
  const view = readFileSync('src/menus/viewMenu.ts', 'utf8')
  assert.ok(view.includes("id: 'view.toggleGutterIcons'"), '视图菜单没有「显示装订线图标」')
  // 设置页（IDEA id 原样沿用）
  const settings = readFileSync('src/components/SettingsDialog.vue', 'utf8')
  assert.ok(settings.includes("'editor.preferences.gutterIcons'"), '设置页没有装订线图标页')
  assert.ok(settings.includes('v-model="editor.showGutterIcons"'), '设置页没有绑定这个设置')
})
