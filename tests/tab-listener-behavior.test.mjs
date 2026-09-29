// `TabsListener` 那两处**真实行为**的判据（判决表把 `beforeSelectionChanged` 更正为"通知而非否决"）。
//
// 上游：`JBTabsImpl.kt:1680-1691`（`fireBeforeSelectionChanged` 只遍历调用，不看返回值；
// oldSelection 只在回调期间露出来）、`EditorWindow.kt:210-219`（`selectionChanged` → 新选中的文件若
// `isSyncOnFrameActivation` 就 `VfsUtil.markDirtyAndRefresh`，即**切标签时只重同步这一个文件**）、
// `JBEditorTabsBorder.kt:34-60`（下划线滑动动画，100ms、收缩侧延迟 50ms）。
//
// 读盘那一步走 `request` 直连 bridge（ESM 绑定改不动），所以这里核**判定本身**与**接线**：
// 判定就是行为；接线断了，判定再对也没用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// `diskSync` 的依赖链在模块顶层会碰 DOM（计时器 / 事件门控），给个最小壳再导入。
if (typeof globalThis.document === 'undefined') {
  const element = () => ({
    style: {}, dataset: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: child => child, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    focus: () => {}, remove: () => {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), children: [],
  })
  globalThis.document = {
    visibilityState: 'visible', readyState: 'complete', activeElement: null,
    addEventListener: () => {}, removeEventListener: () => {},
    createElement: element, createTextNode: () => ({}), createDocumentFragment: element,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    documentElement: element(), head: element(), body: element(),
  }
  globalThis.HTMLElement = class {}
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, setInterval: () => 0,
    clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} }
}
const { diskSupersedesBuffer, shouldSyncTabFromDisk } = await import('../src/diskSync.ts')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('未保存改动的标签绝不读盘覆盖（会丢用户的字）', () => {
  assert.equal(shouldSyncTabFromDisk({ dirty: true, content: 'mine' }, 1_000_000), false)
  assert.equal(shouldSyncTabFromDisk({ dirty: false, content: 'clean' }, 1_000_000), true)
})

test('超大文件跳过（与整批同步同一道闸）', () => {
  assert.equal(shouldSyncTabFromDisk({ dirty: false, content: 'x'.repeat(11) }, 10), false)
  assert.equal(shouldSyncTabFromDisk({ dirty: false, content: 'x'.repeat(10) }, 10), true, '正好到上限仍然同步')
})

test('版本一致就不必整篇换掉缓冲区', () => {
  assert.equal(diskSupersedesBuffer({ version: 'v1' }, { version: 'v1' }), false)
  assert.equal(diskSupersedesBuffer({ version: 'v1' }, { version: 'v2' }), true)
})

test('接线①：切换标签的唯一入口发通知，重复点同一标签不触发', () => {
  const splits = read('src/editorSplits.ts')
  assert.match(splits, /onTabActivated\?: \(path: string\) => void/, '缺这条钩子')
  assert.match(splits, /const previous = groups\[pane\]\.activePath/, '没记切换前的路径')
  assert.match(splits, /if \(tab\.path !== previous\) deps\.onTabActivated\?\.\(tab\.path\)/,
    '同标签重复点击也会读盘（上游只在 selectionChanged 时动）')
})

test('接线②：单文件同步抽出、整批走同一条实现、开关是同一个 autoSyncFiles', () => {
  const disk = read('src/diskSync.ts')
  assert.match(disk, /async function syncOneTabFromDisk\(tab: Tab, quiet = false\) \{/, '单文件同步没抽出来')
  assert.match(disk, /for \(const tab of allTabs\.value\) await syncOneTabFromDisk\(tab, quiet\)/,
    '整批同步没走同一条实现 = 两套闸门迟早分叉')
  assert.match(disk, /async function syncTabOnActivation\(path: string\) \{[\s\S]{0,120}?autoSyncFiles/,
    '切标签这条没用同一个 autoSyncFiles 开关')
  assert.match(disk, /const tab = findTab\(path\)[\s\S]{0,80}?syncOneTabFromDisk\(tab, true\)/,
    '只同步切过去的那个文件（EditorWindow.kt:210-219 按 newSelection 拿文件）')
})

test('接线③：宿主把钩子接到磁盘同步域', () => {
  const app = read('src/App.vue')
  assert.match(app, /onTabActivated: \(\.\.\.a\) => syncTabOnActivation\(\.\.\.a\)/, 'App 没把它接上')
  assert.match(app, /performDiskSync, syncFromDisk, syncTabOnActivation,/, '同步域没导出这台接口')
})

test('下划线滑动动画这条按本仓既有纪律不做，理由登记在审计档', () => {
  // 上游 `JBEditorTabsBorder.kt:34-60` 是 100ms（收缩侧 50ms）的下划线动画。
  // 本仓有一条既有反馈纪律（不加点击动效 / 不追加全局元素选择器），所以只登记不做。
  assert.match(read('docs/ui-placement-audit.md'), /JBEditorTabsBorder\.kt:34-60/, '动画那条的出处要落在审计档里')
})
