// 查找结果列表的右键菜单（上游 `FindInFiles.Results.ContextMenu` → 「复制路径/引用…」）。
//
// 上游要点（逐条核过）：
//   · `PlatformActions.xml:1330-1332`：`FindInFiles.Results.ContextMenu` 里只有一条引用 ——
//     `CopyReferencePopupGroup`（`popup="true"`），组名 `group.CopyReferencePopupGroup.text` = 复制路径/引用…；
//   · `:1266-1281` 的 `CopyFileReference` 组：绝对路径 · 文件名 · (分隔) · 带行号的路径 ·
//     来自内容根的路径 · 来自源根的路径；外带 `CopyExternalReferenceGroup` 的「工具箱 URL」；
//   · 各条实现：`CopyPathProvider.kt:117`（presentableUrl）、`:133-139`（FQN + ":" + 行号，
//     FQN 问不到时退回相对基目录的路径）、`:121-129`（相对内容根）。
// 文案取随 IDE 发货的中文包 `ActionsBundle.properties`：334 / 342 / 343 / 339。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  COPY_REFERENCE_GROUP, FIND_COPY_ACTIONS, absoluteResultPath, copyPathMenuRows, findResultClipboardText, resultFileName, resultPathWithLine,
} from '../src/copyPathActions.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// 本文件同时看两个宿主：查找结果右键（第一百零六批）与编辑菜单（第一百零八批）。

const TARGET = { path: 'src/deep/inner.ts', line: 12 }
const copied = []
const ROOT = 'E:/work/project'

test('the four labels are the shipped Chinese ones', () => {
  const labels = Object.fromEntries(FIND_COPY_ACTIONS.map(a => [a.id, a.label]))
  assert.equal(labels.absolute, '绝对路径', 'ActionsBundle.properties:334 action.CopyAbsolutePath.text')
  assert.equal(labels.fileName, '文件名', ':342 action.CopyFileName.text')
  assert.equal(labels.pathWithLine, '带行号的路径', ':343 action.CopyPathWithLineNumber.text')
  assert.equal(labels.contentRootPath, '来自内容根的路径', ':339 action.CopyContentRootPath.text')
  assert.equal(COPY_REFERENCE_GROUP, '复制路径/引用…', ':2561 group.CopyReferencePopupGroup.text')
})

test('the menu order follows the upstream group', () => {
  assert.deepEqual(FIND_COPY_ACTIONS.map(a => a.id), ['absolute', 'fileName', 'pathWithLine', 'contentRootPath'])
})

test('absolute path is the workspace root joined with the relative path', () => {
  assert.equal(absoluteResultPath(TARGET, ROOT), 'E:/work/project/src/deep/inner.ts')
  assert.equal(absoluteResultPath(TARGET, ''), 'src/deep/inner.ts', '没有工作区时退回相对路径')
})

test('file name is the last segment', () => {
  assert.equal(resultFileName('src/deep/inner.ts'), 'inner.ts')
  assert.equal(resultFileName('top.txt'), 'top.txt')
})

test('the path with line number is 相对路径:行号', () => {
  // 上游是 `FqnUtil.getVirtualFileFqn(...) + ":" + 行号`，FQN 问不到语言限定名时退回相对路径 ——
  // 本仓没有语言限定名那一层，走的就是这条退路。
  assert.equal(resultPathWithLine(TARGET), 'src/deep/inner.ts:12')
})

test('the clipboard text of each action', () => {
  assert.equal(findResultClipboardText('absolute', TARGET, ROOT), 'E:/work/project/src/deep/inner.ts')
  assert.equal(findResultClipboardText('fileName', TARGET, ROOT), 'inner.ts')
  assert.equal(findResultClipboardText('pathWithLine', TARGET, ROOT), 'src/deep/inner.ts:12')
  assert.equal(findResultClipboardText('contentRootPath', TARGET, ROOT), 'src/deep/inner.ts')
})

test('the two actions we do not offer are documented, not silently missing', () => {
  const src = read('src/copyPathActions.ts')
  assert.match(src, /来自源根的路径/, '要源根模型，本仓没有这一层')
  assert.match(src, /工具箱 URL/, 'JetBrains Toolbox 的 jetbrains:\/\/ 链接，本仓不做')
  assert.ok(!FIND_COPY_ACTIONS.some(a => /源根|工具箱/.test(a.label)), '菜单里不许出现这两项')
})

// —— 接线 ——

test('a result row opens the menu on right click', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /@contextmenu\.prevent="openResultMenu\(\$event, match\)"/)
  assert.match(panel, /resultMenu\.value = \{ x: event\.clientX, y: event\.clientY, target: \{ path: match\.path, line: match\.line \} \}/)
})

test('the menu reuses the shared popup renderer with the upstream group title', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import EditorPopupMenu from '\.\/EditorPopupMenu\.vue'/)
  // 真机抓到的：浮层没有 `.tree-menu-backdrop` 那层背景时 z-index 是 auto，
  // 会被别的浮层背景盖住 —— 画得出来、点不到。
  assert.match(panel, /<div v-if="resultMenu" class="tree-menu-backdrop"/)
  assert.match(panel, /<EditorPopupMenu\s+:rows="resultMenuRows"/)
  assert.match(panel, /title: COPY_REFERENCE_GROUP/)
  assert.match(panel, /children: FIND_COPY_ACTIONS\.map\(action => \(\{ id: action\.id, title: action\.label \}\)\)/)
})

test('picking an item copies through the central clipboard helper', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import \{ copyToClipboard \} from '\.\.\/clipboard\.ts'/)
  assert.match(panel, /void copyToClipboard\(findResultClipboardText\(row\.id as FindCopyActionId, menu\.target, props\.root\)\)/)
})


// —— 第一百零八批：编辑菜单里的同一个组 ——

test('the group factory produces the four menu rows with the shipped labels', () => {
  const rows = copyPathMenuRows({ target: () => ({ path: 'a/b.ts', line: 7 }), root: () => 'E:/w', copy: text => copied.push(text) })
  assert.deepEqual(rows.map(r => r.title), ['绝对路径', '文件名', '带行号的路径', '来自内容根的路径'])
  assert.deepEqual(rows.map(r => r.id), ['copyPath.absolute', 'copyPath.fileName', 'copyPath.pathWithLine', 'copyPath.contentRootPath'])
  assert.ok(rows.every(r => r.enabled()), '有目标时四行都可用')
  for (const row of rows) row.run()
  assert.deepEqual(copied, ['E:/w/a/b.ts', 'b.ts', 'a/b.ts:7', 'a/b.ts'])
})

test('without a target the whole group is disabled (upstream returns null too)', () => {
  const rows = copyPathMenuRows({ target: () => null, root: () => 'E:/w', copy: () => { throw new Error('不该复制') } })
  assert.ok(rows.every(r => !r.enabled()))
  for (const row of rows) row.run()
})

test('the Edit menu carries the group right after 复制, as upstream anchors it after CopyPaths', () => {
  const menu = read('src/menus/editMenu.ts')
  const copy = menu.indexOf("ctx.editable('copy', '复制'")
  const group = menu.indexOf("id: 'edit.copyPathGroup'")
  const paste = menu.indexOf("id: 'edit.pasteGroup'")
  assert.ok(copy > 0 && group > 0 && paste > 0, '三行都要在')
  assert.ok(copy < group && group < paste, '顺序：复制 → 复制路径/引用… → 粘贴')
  assert.match(menu, /title: '复制路径\/引用…'/, '组名取 group.CopyReferencePopupGroup.text')
  assert.match(menu, /children: ctx\.copyPathRows\(\)/)
})

test('App wires the group to the active file and the caret line', () => {
  const app = read('src/App.vue')
  assert.match(app, /copyPathRows: \(\) => copyPathMenuRows\(/)
  assert.match(app, /line: active\.value\?\.line \?\? 1/, '带行号的路径要用光标行')
  assert.match(app, /copy: copyToClipboard/, '复制走中央通道（进剪贴板环）')
})
