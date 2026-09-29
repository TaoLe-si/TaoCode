// 编辑器标签**双击**的判据（判决表原写"双击就地重命名标签" —— 核对上游后是**误读**）。
//
// 上游（逐条读过原文）：
//   · `TabLabel.kt:151-153`：标签自己的 `mouseClicked` 只做 `handlePopup(e)`；整个 `ui/tabs` 包里
//     搜不到 rename 字样与任何文本域 ⇒ **IDEA 没有"就地重命名标签"这回事**。
//   · `EditorTabbedContainer.kt:348-361` 的 `doProcessDoubleClick`：
//       ① 命中预览标签 → `composite.isPreview = false` 晋升常驻，然后 **return**（`:349-356`）；
//       ② 否则按 `editor.maximize.on.double.click`（`intellij.platform.ide.impl.xml:1511`，默认 **true**）
//          执行 Hide All Tool Windows / Restore Windows；
//          `editor.maximize.in.splits.on.double.click`（`:1512`，默认 false）= Maximize Editor /
//          Normalize Splits；两个都关着就直接 return（`:358-361`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editorTabDoubleClickAction } from '../src/editorTabDoubleClick.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const both = { hideToolWindowsOnDoubleClick: true, maximizeInSplitsOnDoubleClick: true }
const none = { hideToolWindowsOnDoubleClick: false, maximizeInSplitsOnDoubleClick: false }

test('预览标签：双击只晋升常驻，不继续做最大化（上游那一步就 return 了）', () => {
  assert.equal(editorTabDoubleClickAction(true, both), 'promote-preview')
  assert.equal(editorTabDoubleClickAction(true, none), 'promote-preview', '哪怕设置全关也照样晋升')
})

test('非预览：默认走「隐藏全部工具窗口」（editor.maximize.on.double.click 默认 true）', () => {
  assert.equal(editorTabDoubleClickAction(false, { hideToolWindowsOnDoubleClick: true, maximizeInSplitsOnDoubleClick: false }),
    'hide-tool-windows')
  // 两条都开时先走 hide —— 上游就是 if/else if 的先后（:367 起）。
  assert.equal(editorTabDoubleClickAction(false, both), 'hide-tool-windows')
})

test('两条设置都关着时什么都不做', () => {
  assert.equal(editorTabDoubleClickAction(false, none), 'none')
})

test('接线：标签按钮绑了 dblclick，且 handler 走纯函数判定', () => {
  const app = read('src/App.vue')
  assert.match(app, /@dblclick="onEditorTabDoubleClick\(tab\)"/, '标签上没绑双击')
  const splits = read('src/editorSplits.ts')
  assert.match(splits, /function onEditorTabDoubleClick\(tab: Tab\) \{/, 'handler 没实现')
  assert.match(splits, /editorTabDoubleClickAction\(tab\.preview === true, \{/, '没走纯函数判定')
  assert.match(splits, /hideToolWindowsOnDoubleClick: deps\.editorSettings\.value\.maximizeEditorOnTabDoubleClick/,
    '开关没接到编辑器设置上')
  assert.match(splits, /if \(action === 'promote-preview'\) keepTabOpen\(tab\)/, '预览晋升没落地')
  assert.match(splits, /else if \(action === 'hide-tool-windows'\) deps\.toggleMaximizeEditor\(\)/, '第二条行为没落地')
})

test('设置键按上游默认 true 落三处（类型/默认、原生 schema、bridge 白名单）', () => {
  const model = read('src/settingsModel.ts')
  assert.match(model, /maximizeEditorOnTabDoubleClick: true,/, '默认值不是 true（上游 :1511 default="true"）')
  assert.match(model, /maximizeEditorOnTabDoubleClick: boolean;/, '缺类型声明')
  assert.match(read('native/settings_schema.cpp'), /\{"maximizeEditorOnTabDoubleClick", true\}/, '原生默认值没登记')
  assert.match(read('native/settings_schema.hpp'), /"maximizeEditorOnTabDoubleClick",/, '原生布尔键表没登记')
  assert.match(read('src/bridge.ts'), /key === 'maximizeEditorOnTabDoubleClick'/, 'bridge 白名单没放行')
})

test('判决表里那条"就地重命名"的误读要被纠正（不是删掉不提）', () => {
  // 记录事实：IDEA 没有这个行为。清单里要留下"已核实为误读"的痕迹，避免以后再排一次队。
  const verdict = read('docs/inventory/verdict-ui-tabs-popup.md')
  assert.match(verdict, /双击就地重命名标签/, '原判据文字还在（要给对照）')
  assert.match(verdict, /误读|没有.*重命名|无.*重命名/, '要写明核实结论是"没有这个行为"')
})
