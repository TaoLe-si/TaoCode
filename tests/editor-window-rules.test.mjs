// 判据 · **编辑器多窗口**（`src/editorWindowRules.ts` 的窗口表 + 分屏树，
// `src/editorTabMigrationRules.ts` 的标签开关与迁移）—— 上游 `EditorsSplitters` /
// `EditorWindow` / `DockableEditorTabbedContainer` / `SplitAction` 一族在本仓的还原。
//
// 钉五件事：
//   ① 分屏树语义：split 只搬选中的那一个、方向/前后侧、unsplit 怎么合并、翻转与比例归一化；
//   ② 窗口生命周期：建/加/删窗口、当前窗口指针、空窗口的处置、关掉独立窗口后标签去哪；
//   ③ 标签迁移：opposite group / SplitAction / 拖拽落点 / 关闭后选中谁 / 关闭标签栈；
//   ④ 可用性判据：`EditSourceInNewWindow` 的"恰好一个非目录文件"、容器注册、宿主能力；
//   ⑤ 与既有模块的关系：`NEW_WINDOW` 档的能力探测仍来自 `editorWindows.ts`（不重复实现），
//      且两个新文件都真的 import 了它。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  EDITOR_TAB_LIMIT_DEFAULT, NORMALIZE_SPLITS_DEFAULT, SPLIT_DEFAULT_PROPORTION, SPLIT_MAX_PROPORTION,
  SPLIT_MIN_PROPORTION, addWindow, changeOrientation, collapseToSelf, createCurrentWindow, createWindowTable,
  getOrCreateCurrentWindow, isInSplitter, isSingletonDockWindow, isSingletonEditorInWindow, leafWindowIds,
  normalizeProportionsFrom, openTargetWindow, orderedWindows, parentSplitterOf, parseLayout,
  preferSiblingForSingleton, removeLeaf, removeWindow, replaceLeaf, reopenWindowOnStartup, serializeLayout,
  setCurrentWindow, siblingWindowIds, splitCount, splitWindow, unsplit, unsplitAll, windowById,
  windowDimensionKey, windowDisposesWhenEmpty, windowsShowing, windowShowing,
} from '../src/editorWindowRules.ts'
import {
  DOCK_CONTAINER_TYPE, MOVE_TAB_DOWN_ORIENTATION, MOVE_TAB_RIGHT_ORIENTATION, acceptsTabDrop,
  cleanupEmptyWindows, closeAllFiles, closeFileEverywhere, closeFileInWindow, containerDisposesWhenEmpty,
  containerIsEmpty, dragDropActionId, dragOutFinish, dragOutStart, dropTabOnWindow,
  editSourceInNewWindowAvailable, forbidSplit, insertIndexFor, moveTabToOppositeGroup, newWindowAvailability,
  openCopyInOppositeGroup, openFileInWindow, openInRightSplit, restoreClosedTab, selectIndexOnClose,
  splitActionAvailability, splitTab, tabsHiddenInWindow,
} from '../src/editorTabMigrationRules.ts'
import { canDetachEditor } from '../src/editorWindows.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 两栏并排（0 在左、1 在右）的窗口表。 */
function twoPane() {
  let table = createWindowTable(['a.ts', 'b.ts'], 'a.ts')
  const split = splitWindow(table, 0, 'horizontal', { virtualFile: 'c.ts', forceSplit: true })
  return split.table
}

test('分屏树：split 只把选中的那一个开进新组，源窗口的标签一个不少', () => {
  const table = twoPane()
  assert.equal(table.windows.length, 2)
  const first = windowById(table, 0)
  const second = windowById(table, 1)
  assert.deepEqual(first.tabs, ['a.ts', 'b.ts'], '源窗口标签不动（EditorWindow.kt:550-551 只开 nextFile）')
  assert.deepEqual(second.tabs, ['c.ts'], '新窗口只有那一个文件')
  assert.equal(second.active, 'c.ts')
  assert.equal(table.layout.kind, 'split')
  assert.equal(table.layout.orientation, 'horizontal', 'openInRightSplit 走水平分屏（EditorsSplitters.kt:1263）')
  assert.equal(table.layout.first.kind === 'leaf' && table.layout.first.window, 0, 'fileIsSecondary ⇒ 新组在 second')
  assert.equal(table.layout.proportion, SPLIT_DEFAULT_PROPORTION, 'EditorWindow.kt:529 初值 0.5')
  assert.equal(splitCount(table.layout), 2)
  assert.deepEqual(leafWindowIds(table.layout), [0, 1], 'getOrderedWindows 的树序遍历序')
})

test('分屏树：空窗口分不了屏；已有分屏且不 forceSplit 时复用第一个兄弟（EditorWindow.kt:507-523）', () => {
  const empty = createWindowTable([], '')
  const refused = splitWindow(empty, 0, 'horizontal', { virtualFile: 'x.ts' })
  assert.equal(refused.newWindowId, null, 'tabCount < 1 ⇒ 返回 null')
  assert.equal(refused.table.windows.length, 1)

  const table = twoPane()
  const reused = splitWindow(table, 0, 'vertical', { virtualFile: 'd.ts' })
  assert.equal(reused.newWindowId, null, '不新建')
  assert.equal(reused.reusedWindowId, 1, '开进第一个兄弟窗口')
  assert.equal(reused.table.windows.length, 2)
})

test('分屏树：落点在左/上时新组排在 first（DockableEditorTabbedContainer.kt:182）', () => {
  const table = createWindowTable(['a.ts'], 'a.ts')
  const left = splitWindow(table, 0, 'horizontal', { virtualFile: 'b.ts', forceSplit: true, fileIsSecondaryComponent: false })
  assert.equal(left.table.layout.first.kind === 'leaf' && left.table.layout.first.window, 1, '新组在 first（左侧）')
  assert.equal(left.table.layout.second.kind === 'leaf' && left.table.layout.second.window, 0)
})

test('分屏树：unsplit 把兄弟窗口的标签并进来、超限的丢掉、子树塌成一格（EditorWindow.kt:858-900）', () => {
  let table = createWindowTable(['a.ts', 'b.ts'], 'a.ts')
  table = splitWindow(table, 0, 'horizontal', { virtualFile: 'b.ts', forceSplit: true }).table
  table = openFileInWindow(table, 1, 'c.ts', { selectAsCurrent: true }).table
  assert.deepEqual(windowById(table, 1).tabs, ['b.ts', 'c.ts'])
  const merged = unsplit(table, 0)
  assert.equal(merged.windows.length, 1, '兄弟窗口被 dispose')
  assert.deepEqual(windowById(merged, 0).tabs, ['a.ts', 'b.ts', 'c.ts'], 'b.ts 已在本窗口，c.ts 并进来')
  assert.equal(merged.layout.kind, 'leaf', '整棵 Splitter 子树被本窗口顶替（:889-891）')
  assert.equal(merged.current, 0, 'setCurrent 默认 true')

  // 超限：limit = 2 时合不进来的丢（:874 的 `tabCount < editorTabLimit`）。
  const limited = unsplit(twoPane(), 0, { tabLimit: 2 })
  assert.deepEqual(windowById(limited, 0).tabs, ['a.ts', 'b.ts'], '已经 2 个就不再并入')

  // 没分屏时 unsplit 是 no-op（:860 的 `?: return`）。
  const flat = createWindowTable(['a.ts'], 'a.ts')
  assert.equal(unsplit(flat, 0), flat)
  // unsplitAll 循环到不再在 Splitter 里。
  assert.equal(unsplitAll(twoPane(), 0).layout.kind, 'leaf')
})

test('分屏树：changeOrientation 只翻转包着它的那个 Splitter（EditorWindow.kt:849-855）', () => {
  const table = twoPane()
  const flipped = changeOrientation(table, 0)
  assert.equal(flipped.layout.orientation, 'vertical')
  const flippedTwice = changeOrientation(flipped, 0)
  assert.equal(flippedTwice.layout.orientation, 'horizontal')
})

test('分屏树：normalizeProportions 的 1-1/(2+i) 公式与同方向截断（EditorWindow.kt:582-614）', () => {
  assert.equal(NORMALIZE_SPLITS_DEFAULT, false, 'intellij.platform.ide.impl.xml:1513 默认 false')
  let table = createWindowTable(['a.ts'], 'a.ts')
  table = splitWindow(table, 0, 'horizontal', { virtualFile: 'b.ts', forceSplit: true }).table
  table = splitWindow(table, 1, 'horizontal', { virtualFile: 'c.ts', forceSplit: true }).table
  const normalized = normalizeProportionsFrom(table, 2)
  // 窗口 2 在最近那个 split 的 second 侧 ⇒ i=0: 1/(2+0) = 0.5；
  // 再往外那个 split 里它也在 second 侧 ⇒ i=1: 1/(2+1)。
  assert.equal(normalized.layout.proportion, 1 / 3)
  assert.equal(normalized.layout.second.proportion, 0.5)
  // 方向不同的祖先不入栈（:602-604 的 break）⇒ 外层保持原值。
  let mixed = createWindowTable(['a.ts'], 'a.ts')
  mixed = splitWindow(mixed, 0, 'horizontal', { virtualFile: 'b.ts', forceSplit: true }).table
  mixed = splitWindow(mixed, 1, 'vertical', { virtualFile: 'c.ts', forceSplit: true }).table
  const kept = normalizeProportionsFrom(mixed, 2)
  assert.equal(kept.layout.proportion, SPLIT_DEFAULT_PROPORTION, '换方向的祖先不动')
  assert.equal(kept.layout.second.proportion, 0.5, '内层同方向链只有它自己：i=0 且在 second 侧')
})

test('分屏树：持久化属性名照 writePanel / EditorSplitterState（EditorsSplitters.kt:1272-1334）', () => {
  const table = twoPane()
  const serialized = serializeLayout(table.layout)
  assert.equal(serialized.kind, 'split')
  assert.equal(serialized.orientation, 'horizontal')
  assert.equal(serialized.proportion, SPLIT_DEFAULT_PROPORTION)
  assert.equal(serialized.first.kind, 'leaf')
  assert.equal(serialized.second.kind, 'leaf')

  let next = 7
  const parsed = parseLayout({
    'split-orientation': 'vertical',
    'split-proportion': '0.25',
    'split-first': { leaf: {} },
    'split-second': { leaf: {} },
  }, () => next++)
  assert.equal(parsed.kind, 'split')
  assert.equal(parsed.orientation, 'vertical')
  assert.equal(parsed.proportion, 0.25)
  assert.equal(parsed.first.window, 7)
  assert.equal(parsed.second.window, 8)
  // 缺 proportion ⇒ 0.5（:1334 的 `?: 0.5f`）。
  const noProp = parseLayout({ 'split-first': { leaf: {} }, 'split-second': { leaf: {} } }, () => 0)
  assert.equal(noProp.proportion, SPLIT_DEFAULT_PROPORTION)
  // 两个子元素缺一不可，否则不是 Splitter（:1362-1363）。
  assert.equal(parseLayout({ 'split-first': { leaf: {} } }, () => 0), null)
  assert.equal(parseLayout(null, () => 0), null)
  assert.equal(SPLIT_MIN_PROPORTION, 0.1)
  assert.equal(SPLIT_MAX_PROPORTION, 0.9)
})

test('窗口生命周期：createCurrentWindow 只在没有当前窗口时建（EditorsSplitters.kt:1042-1048）', () => {
  const empty = { windows: [], layout: { kind: 'leaf', window: 0 }, current: null, nextId: 0 }
  const created = createCurrentWindow(empty)
  assert.equal(created.created, true)
  assert.equal(created.table.windows.length, 1)
  assert.equal(created.table.current, 0)
  const again = createCurrentWindow(created.table)
  assert.equal(again.created, false, '上游是 LOG.assertTrue(currentWindow == null)')
  assert.equal(again.table.windows.length, 1)
})

test('窗口生命周期：addWindow / removeWindow 与当前窗口指针（EditorsSplitters.kt:1070-1081）', () => {
  let table = createWindowTable(['a.ts'], 'a.ts')
  table = addWindow(table, ['b.ts'])
  assert.equal(table.windows.length, 2)
  assert.equal(table.current, 1, '新窗口成为当前窗口')
  assert.equal(isInSplitter(table, 1), true, '新叶子挂进了树')
  assert.deepEqual(siblingWindowIds(table, 0), [1])
  assert.deepEqual(siblingWindowIds(table, 1), [0])

  const removed = removeWindow(table, 1)
  assert.equal(removed.windows.length, 1)
  assert.equal(removed.current, null, '当前窗口正是被删的那个 ⇒ 置空')
  assert.equal(removed.layout.kind, 'leaf')
  assert.equal(removed.layout.window, 0)
})

test('窗口生命周期：getOrCreateCurrentWindow / setCurrentWindow / openTargetWindow（EditorsSplitters.kt:1020-1040、FileEditorManagerImpl.kt:1216-1230）', () => {
  const table = twoPane()
  assert.equal(table.current, 1)
  // 文件开在 0 栏、当前是 1 栏 ⇒ 当前窗口切到 0。
  const switched = getOrCreateCurrentWindow(table, 'a.ts')
  assert.equal(switched.current, 0)
  // 谁都没开这个文件 ⇒ 保持当前窗口。
  assert.equal(getOrCreateCurrentWindow(table, 'zz.ts').current, 1)
  // 没有当前窗口 ⇒ 优先挑开着这个文件的窗口。
  const noCurrent = { ...table, current: null }
  assert.equal(getOrCreateCurrentWindow(noCurrent, 'a.ts').current, 0)
  // setCurrentWindow 不认不存在的窗口。
  assert.equal(setCurrentWindow(table, 99), table)
  assert.equal(setCurrentWindow(table, 0).current, 0)
  // reuseOpen 档：全 splitters 找开着这个文件的窗口（FileEditorManagerImpl.kt:1223-1224）。
  const reused = openTargetWindow(table, 'a.ts', { reuseOpen: true })
  assert.equal(reused.windowId, 0)
  // 默认档走 getOrCreateCurrentWindow。
  assert.equal(openTargetWindow(table, 'b.ts').windowId, 0)
  assert.equal(windowShowing(table, 'c.ts').id, 1)
  assert.deepEqual(windowsShowing(table, 'b.ts'), [0])
})

test('窗口生命周期：空窗口才被摘；关掉独立窗口 = 标签被关掉，不回流主窗口', () => {
  const table = twoPane()
  assert.equal(windowDisposesWhenEmpty(table, 1), false)
  const emptied = closeFileInWindow(table, 1, 'c.ts', { disposeIfNeeded: true })
  assert.equal(emptied.emptied, true)
  assert.equal(emptied.table.windows.length, 1, 'removeIfEmpty → removeFromSplitter + dispose（:714、:783-815）')
  assert.equal(emptied.table.layout.kind, 'leaf')

  // closeAllFiles：先清窗口表再逐个关（EditorsSplitters.kt:713-729）。
  const all = closeAllFiles(twoPane())
  assert.deepEqual(all.closedPaths, ['a.ts', 'b.ts', 'c.ts'], '按树序逐个关')
  assert.equal(all.table.current, null)
  assert.deepEqual(windowById(all.table, 0).tabs, [])
  assert.deepEqual(windowById(all.table, 1).tabs, [])
  // 关掉窗口之后它的标签进了本窗的关闭栈（removedTabs），不是回到别的窗口。
  assert.deepEqual(all.perWindow.find(item => item.windowId === 1).closed.map(record => record.path), ['c.ts'])
  assert.deepEqual(windowById(all.table, 0).tabs.filter(path => path === 'c.ts'), [])
})

test('窗口生命周期：removedTabs 的栈上限是 tabLimit-1，restoreClosedTab 取栈顶（EditorWindow.kt:698-701、659-671）', () => {
  let table = createWindowTable(['a.ts', 'b.ts', 'c.ts'], 'a.ts')
  table = closeFileInWindow(table, 0, 'a.ts', { tabLimit: 3 }).table
  table = closeFileInWindow(table, 0, 'b.ts', { tabLimit: 3 }).table
  assert.deepEqual(windowById(table, 0).closed.map(record => record.path), ['a.ts', 'b.ts'])
  table = closeFileInWindow(table, 0, 'c.ts', { tabLimit: 3 }).table
  assert.deepEqual(windowById(table, 0).closed.map(record => record.path), ['b.ts', 'c.ts'], '超了丢最旧的一条')

  const restored = restoreClosedTab(table, 0)
  assert.equal(restored.path, 'c.ts', '取栈顶（removeLastOrNull）')
  assert.deepEqual(windowById(restored.table, 0).tabs, ['c.ts'], '按原位下标插回')
  assert.equal(restoreClosedTab(createWindowTable(['a.ts'], 'a.ts'), 0).path, null)
})

test('窗口生命周期：isSingletonDockWindow / isSingletonEditorInWindow / preferSiblingForSingleton', () => {
  const floating = createWindowTable(['a.ts'], 'a.ts', true)
  assert.equal(isSingletonDockWindow(floating, 0, true), true)
  assert.equal(isSingletonDockWindow(floating, 0, false), false)
  assert.equal(isSingletonDockWindow(createWindowTable(['a.ts'], 'a.ts', false), 0, true), false, '主 splitters 不算')
  assert.equal(isSingletonEditorInWindow(floating, 0), true, 'DiffEditorTabFilesManagerImpl.kt:157-159')
  assert.equal(isSingletonEditorInWindow(createWindowTable(['a.ts', 'b.ts'], 'a.ts', true), 0), false)
  // 独享编辑器在分屏里 ⇒ 新标签落到兄弟窗口（FileEditorManagerImpl.kt:1257-1266）。
  // split 之后当前窗口是新窗口 1，它的兄弟是 0。
  const split = splitWindow(floating, 0, 'horizontal', { virtualFile: 'a.ts', forceSplit: true })
  assert.equal(split.table.current, 1)
  assert.equal(preferSiblingForSingleton(split.table), 0, 'current 的兄弟窗口')
  assert.equal(preferSiblingForSingleton(floating), null, '没分屏就没有兄弟')
})

test('打开标签：插入下标照 addComposite 的三档（EditorWindow.kt:342-350）', () => {
  const window = { id: 0, tabs: ['a.ts', 'b.ts'], active: 'a.ts', pinned: [], preview: '', closed: [], floating: false }
  assert.equal(insertIndexFor(window), 1, '默认插在当前标签之后')
  assert.equal(insertIndexFor(window, { openTabsAtTheEnd: true }), 2, 'UISettingsState.kt:154 默认 false')
  assert.equal(insertIndexFor(window, { index: 0 }), 0)
  assert.equal(insertIndexFor(window, { index: 99 }), 2, '越界夹取')
  const withPreview = { ...window, tabs: ['a.ts', 'p.ts', 'b.ts'], preview: 'p.ts' }
  assert.equal(insertIndexFor(withPreview, { usePreviewTab: true }), 2, '落在最后一个预览标签之后')
})

test('打开标签：已开着只切选中；pin 跟随；forbidSplit 先关别处的副本', () => {
  const table = twoPane()
  // 1 栏本来只有 c.ts ⇒ 第一次开 a.ts 是**插入**（`addComposite` 的新建路径）。
  const first = openFileInWindow(table, 1, 'a.ts', { selectAsCurrent: true })
  assert.equal(first.inserted, true)
  assert.deepEqual(windowById(first.table, 1).tabs, ['c.ts', 'a.ts'], '插在当前标签之后（:348）')
  assert.equal(windowById(first.table, 1).active, 'a.ts')
  // 已经开着 ⇒ 只切选中，不新建标签（上游复用 composite）。
  const again = openFileInWindow(first.table, 1, 'c.ts', { selectAsCurrent: true })
  assert.equal(again.inserted, false)
  assert.deepEqual(windowById(again.table, 1).tabs, ['c.ts', 'a.ts'])
  assert.equal(windowById(again.table, 1).active, 'c.ts')

  const pinned = openFileInWindow(table, 1, 'd.ts', { pin: true })
  assert.deepEqual(windowById(pinned.table, 1).pinned, ['d.ts'])
  // forbidTabSplit：文件已经在 0 栏 ⇒ 关掉它再开进 1 栏（FileEditorManagerImpl.kt:1103-1105）。
  const moved = openFileInWindow(table, 1, 'a.ts', { forbidTabSplit: true })
  assert.deepEqual(windowById(moved.table, 0).tabs, ['b.ts'], '别处的副本被关掉')
  assert.ok(windowById(moved.table, 1).tabs.includes('a.ts'))
  assert.equal(forbidSplit({ forbidTabSplit: true }), true)
  assert.equal(forbidSplit({}), false)
})

test('关闭选中：computeIndexToSelect 的三档（EditorWindow.kt:817-847）', () => {
  const window = { id: 0, tabs: ['a.ts', 'b.ts', 'c.ts'], active: 'b.ts', pinned: [], preview: '', closed: [], floating: false }
  assert.equal(selectIndexOnClose(window, 'a.ts'), 1, '关的不是当前标签 ⇒ 当前标签不动')
  assert.equal(selectIndexOnClose(window, 'b.ts'), 0, '默认选左邻')
  assert.equal(selectIndexOnClose(window, 'b.ts', { activeRightEditorOnClose: true }), 2, 'activeRightEditorOnClose 选右邻')
  assert.equal(selectIndexOnClose(window, 'b.ts', { activeMruEditorOnClose: true, history: ['a.ts', 'c.ts'] }), 2, '回最近访问过的那个')
  assert.equal(selectIndexOnClose({ ...window, active: 'a.ts' }, 'a.ts'), -1, '第一个位置 ⇒ -1')
  assert.equal(selectIndexOnClose(window, 'zz.ts'), -1)
})

test('关闭标签：空窗口 cleanup 走 unsplit（EditorsSplitters.kt:992-1001）', () => {
  const table = twoPane()
  assert.deepEqual(orderedWindows(table).map(window => window.id), [0, 1])
  // 关掉 1 栏唯一的标签，disposeIfNeeded = false ⇒ 空窗口留着，再由 cleanup 收尾。
  const closed = closeFileInWindow(table, 1, 'c.ts', { disposeIfNeeded: false })
  assert.equal(closed.emptied, true)
  assert.equal(closed.table.windows.length, 2, 'disposeIfNeeded = false 时窗口原地留着')
  const cleaned = cleanupEmptyWindows(closed.table)
  assert.equal(cleaned.windows.length, 1, '空窗口 unsplit(setCurrent = false)')
  assert.equal(cleaned.layout.kind, 'leaf')
  // 空的是 1 栏 ⇒ 它吸收 0 栏的标签，0 栏消失（不是空窗口自己消失）。
  assert.deepEqual(windowById(cleaned, 1).tabs, ['a.ts', 'b.ts'])
  assert.equal(windowById(cleaned, 0), null)

  // closeFileEverywhere：在所有开着它的窗口里关，再清理。
  const everywhere = closeFileEverywhere(table, 'c.ts')
  assert.equal(everywhere.windows.length, 1)
  assert.deepEqual(windowById(everywhere, 1).tabs, ['a.ts', 'b.ts'])
  // 关掉的文件不在任何窗口里 ⇒ 表不动。
  assert.equal(closeFileEverywhere(table, 'zz.ts'), table)
})

test('标签迁移：Move to Opposite Group 要求恰好一个兄弟，搬完源位置补选（MoveEditorToOppositeTabGroupAction.kt:22-45）', () => {
  const table = twoPane()
  const moved = moveTabToOppositeGroup(table, 0, 'a.ts')
  assert.equal(moved.moved, true)
  assert.deepEqual(windowById(moved.table, 0).tabs, ['b.ts'])
  assert.ok(windowById(moved.table, 1).tabs.includes('a.ts'))
  assert.equal(windowById(moved.table, 0).active, 'b.ts', '源位置按 computeIndexToSelect 补选')
  // 没有分屏 ⇒ siblings.size != 1 ⇒ 整条动作不动。
  const flat = createWindowTable(['a.ts'], 'a.ts')
  const refused = moveTabToOppositeGroup(flat, 0, 'a.ts')
  assert.equal(refused.moved, false)
  assert.ok(refused.reason)
  assert.equal(moveTabToOppositeGroup(table, 0, 'zz.ts').moved, false)
})

test('标签迁移：Open in Opposite Group 不关源 ⇒ 同一文件出现在两栏', () => {
  const table = twoPane()
  const opened = openCopyInOppositeGroup(table, 0, 'a.ts')
  assert.equal(opened.opened, true)
  assert.deepEqual(windowById(opened.table, 0).tabs, ['a.ts', 'b.ts'], '源不动')
  assert.ok(windowById(opened.table, 1).tabs.includes('a.ts'))
})

test('标签迁移：SplitAction 的可用性下限（SplitAction.java:73-82）', () => {
  assert.equal(splitActionAvailability(1).enabled, true, '保留档 1 个就够')
  assert.equal(splitActionAvailability(0).enabled, false)
  assert.equal(splitActionAvailability(1, { closeSource: true }).enabled, false, '搬走档要 2 个')
  assert.equal(splitActionAvailability(2, { closeSource: true }).enabled, true)
  assert.equal(splitActionAvailability(3, { forbidTabSplit: true }).enabled, false, '禁止同文件双开')
  assert.equal(splitActionAvailability(3, { forbidTabSplit: true, closeSource: true }).enabled, true, '搬走档不看这条')
})

test('标签迁移：SplitVertically/Down 与 Split and Move Right/Down 的方向档', () => {
  assert.equal(MOVE_TAB_RIGHT_ORIENTATION, 'horizontal', 'MoveTabRightAction.java:11 传 SwingConstants.VERTICAL ⇒ 左右并排')
  assert.equal(MOVE_TAB_DOWN_ORIENTATION, 'vertical', 'MoveTabDownAction.java:11 传 SwingConstants.HORIZONTAL ⇒ 上下')
  const table = twoPane()
  const right = splitTab(table, 0, 'a.ts', MOVE_TAB_RIGHT_ORIENTATION, { closeSource: true })
  assert.equal(right.newWindowId, 2)
  assert.equal(windowById(right.table, 0).tabs.length, 1, '搬走档关掉源里的那一个')
  assert.ok(windowById(right.table, 2).tabs.includes('a.ts'))
  // 只有一个标签且要搬走 ⇒ 拒绝并给理由。
  const refused = splitTab(createWindowTable(['a.ts'], 'a.ts'), 0, 'a.ts', 'vertical', { closeSource: true })
  assert.equal(refused.newWindowId, null)
  assert.ok(refused.reason)
})

test('标签迁移：拖拽落点 → 统计 id 与分屏/插入两条路（DockableEditorTabbedContainer.kt:176-246）', () => {
  assert.equal(dragDropActionId('TOP'), 'SplitVertically')
  assert.equal(dragDropActionId('LEFT'), 'SplitHorizontally')
  assert.equal(dragDropActionId('BOTTOM'), 'MoveTabDown')
  assert.equal(dragDropActionId('RIGHT'), 'MoveTabRight')
  assert.equal(dragDropActionId('CENTER'), null)
  assert.equal(dragDropActionId(null), null)

  const table = twoPane()
  // CENTER：插进目标窗口的标签条。
  const centered = dropTabOnWindow(table, { path: 'a.ts', fromWindowId: 0, toWindowId: 1, dropSide: 'CENTER', index: 0 })
  assert.equal(centered.splitWindowId, null)
  assert.deepEqual(windowById(centered.table, 1).tabs, ['a.ts', 'c.ts'])
  assert.deepEqual(windowById(centered.table, 0).tabs, ['b.ts'], '跨窗口拖拽关掉源里的它')
  // RIGHT：在目标窗口上水平分屏，新组在 second。
  const right = dropTabOnWindow(table, { path: 'a.ts', fromWindowId: 0, toWindowId: 1, dropSide: 'RIGHT' })
  assert.equal(right.splitWindowId, 2)
  assert.equal(right.actionId, 'MoveTabRight')
  // LEFT：新组排在 first（原窗口留在 second）。
  const left = dropTabOnWindow(table, { path: 'a.ts', fromWindowId: 0, toWindowId: 1, dropSide: 'LEFT' })
  const leftSplit = parentSplitterOf(left.table.layout, 1)
  assert.equal(leftSplit.first.kind === 'leaf' && leftSplit.first.window, 2, 'LEFT ⇒ 新组在前')
  assert.equal(leftSplit.second.kind === 'leaf' && leftSplit.second.window, 1, '原窗口留在 second')
  // TOP 是上下分屏。
  const top = dropTabOnWindow(table, { path: 'a.ts', fromWindowId: 0, toWindowId: 1, dropSide: 'TOP' })
  assert.equal(parentSplitterOf(top.table.layout, 2).orientation, 'vertical')
})

test('标签迁移：拖出标签起手与落地（EditorTabbedContainer.kt:469-540）', () => {
  const table = twoPane()
  const start = dragOutStart(table, 0, 'a.ts')
  assert.equal(start.startIndex, 0)
  assert.equal(start.pinnedAtStart, false)
  // `getTabToSelect` 在 `computeIndexToSelect` 回 -1（第一个位置）时是 null ⇒ 没有接替者。
  assert.equal(start.selected, '', 'EditorWindow.kt:754-756')
  assert.equal(dragOutStart(table, 0, 'b.ts').selected, 'a.ts', '非首位 ⇒ 选左邻')
  // 非复制：源被关掉；落到另一窗口。
  const dropped = dragOutFinish(table, 0, 'a.ts', { toWindowId: 1 })
  assert.equal(dropped.closedInSource, true)
  assert.equal(dropped.movedTo, 1)
  assert.deepEqual(windowById(dropped.table, 0).tabs, ['b.ts'])
  // 复制档（Ctrl / ACCEPT_COPY）：源不动。
  const copied = dragOutFinish(table, 0, 'a.ts', { copy: true, toWindowId: 1 })
  assert.equal(copied.closedInSource, false)
  assert.deepEqual(windowById(copied.table, 0).tabs, ['a.ts', 'b.ts'])
})

test('标签迁移：openInRightSplit 复用已有右侧块（EditorsSplitters.kt:1238-1268）', () => {
  const table = twoPane()
  // 当前窗口在 first 侧 ⇒ 父 Splitter 的 secondComponent 是另一块 ⇒ 复用它（:1247-1260）。
  const fromLeft = openInRightSplit(setCurrentWindow(table, 0), 'd.ts')
  assert.equal(fromLeft.windowId, 1, '右侧已经有窗口 ⇒ 复用')
  assert.deepEqual(windowById(fromLeft.table, 1).tabs, ['c.ts', 'd.ts'])
  // 当前窗口已经在 second 侧（父的 secondComponent 就是它）⇒ 不再复用，继续分屏（:1263-1268）。
  const fromRight = openInRightSplit(table, 'd.ts')
  assert.equal(fromRight.windowId, 2)
  assert.equal(fromRight.table.windows.length, 3)
  // 没分屏 ⇒ 水平分屏出新组。
  const flat = createWindowTable(['a.ts'], 'a.ts')
  const split = openInRightSplit(flat, 'b.ts')
  assert.equal(split.table.windows.length, 2)
  assert.equal(split.windowId, 1)
})

test('可用性：EditSourceInNewWindow 要恰好一个非目录文件（EditSourceInNewWindowAction.java:39-50）', () => {
  assert.equal(editSourceInNewWindowAvailable({ hasProject: true, fileCount: 1, isDirectory: false }), true)
  assert.equal(editSourceInNewWindowAvailable({ hasProject: true, fileCount: 2, isDirectory: false }), false)
  assert.equal(editSourceInNewWindowAvailable({ hasProject: true, fileCount: 1, isDirectory: true }), false)
  assert.equal(editSourceInNewWindowAvailable({ hasProject: false, fileCount: 1, isDirectory: false }), false)
})

test('可用性：NEW_WINDOW 档的三条闸（复用 / 容器注册 / 宿主能力）', () => {
  const capability = { overlayHostPresent: true, browserWindowSupported: false }
  const base = { fileCount: 1, isDirectory: false, hasProject: true, capability }
  assert.equal(newWindowAvailability(base).action, 'create')
  assert.equal(newWindowAvailability(base).allowed, true)
  // 复用档优先于一切（FileEditorManagerImpl.kt:1051-1071）。
  assert.equal(newWindowAvailability({ ...base, reuseOpen: true, existingWindowWithFile: true }).action, 'reuse')
  // 没注册 file-editors 工厂 ⇒ 开不出来（DockableEditorContainerFactory.kt:16）。
  const unregistered = newWindowAvailability({ ...base, containerTypeRegistered: false })
  assert.equal(unregistered.allowed, false)
  assert.match(unregistered.reason, /file-editors/)
  // 宿主能力不足 ⇒ 不画这一档（能力探测来自 editorWindows.ts）。
  const noCap = newWindowAvailability({ ...base, capability: { overlayHostPresent: false, browserWindowSupported: false } })
  assert.equal(noCap.allowed, false)
  assert.equal(canDetachEditor({ overlayHostPresent: false, browserWindowSupported: false }), false)
  // forbidTabSplit ⇒ 先把别处的副本关掉（FileEditorManagerImpl.kt:1073-1075）。
  assert.equal(newWindowAvailability({ ...base, forbidTabSplit: true }).closeExistingCopies, true)
  // 文件数不对 ⇒ 一律拒绝。
  assert.equal(newWindowAvailability({ ...base, fileCount: 3 }).allowed, false)
  assert.equal(DOCK_CONTAINER_TYPE, 'file-editors')
})

test('可用性：标签条隐藏、容器空态、落点接受、REOPEN_WINDOW、窗口尺寸 key', () => {
  assert.equal(tabsHiddenInWindow({
    floating: true, tabCount: 1, singletonEditorInWindow: true,
    tabPlacement: 'top', presentationMode: false,
  }), true, 'EditorWindow.kt:639')
  assert.equal(tabsHiddenInWindow({
    floating: false, tabCount: 3, singletonEditorInWindow: false,
    tabPlacement: 'none', presentationMode: false,
  }), true, 'TABS_NONE = 0')
  assert.equal(tabsHiddenInWindow({
    floating: false, tabCount: 3, singletonEditorInWindow: false,
    tabPlacement: 'top', presentationMode: true,
  }), true, '演示模式默认藏标签条')
  assert.equal(tabsHiddenInWindow({
    floating: false, tabCount: 3, singletonEditorInWindow: false,
    tabPlacement: 'top', presentationMode: true, tabsVisibleInPresentationMode: true,
  }), false)
  assert.equal(tabsHiddenInWindow({
    floating: true, tabCount: 2, singletonEditorInWindow: true,
    tabPlacement: 'top', presentationMode: false,
  }), false, '标签多于一个就不藏')

  assert.equal(containerIsEmpty({ fileOpeningCompleted: true, windowsEmptyVisible: true }), true)
  assert.equal(containerIsEmpty({ fileOpeningCompleted: false, windowsEmptyVisible: true }), false, '首次展示还没开完')
  assert.equal(containerIsEmpty({ fileOpeningCompleted: true, windowsEmptyVisible: false }), false)
  assert.equal(containerDisposesWhenEmpty(), true, 'DockableEditorContainerFactory.kt:72')
  assert.equal(acceptsTabDrop({ tabsFound: true, hideTabs: false }), true)
  assert.equal(acceptsTabDrop({ tabsFound: true, hideTabs: true }), false)
  assert.equal(acceptsTabDrop({ tabsFound: false, hideTabs: false }), false)

  assert.equal(reopenWindowOnStartup(undefined), true, 'DockManagerImpl.kt:417 默认 true')
  assert.equal(reopenWindowOnStartup(true), true)
  assert.equal(reopenWindowOnStartup(false), false, 'FileEditorManagerKeys.kt:107-115')
  assert.equal(windowDimensionKey({}), null)
  assert.equal(windowDimensionKey({ windowDimensionKey: 'editor.window' }), 'editor.window')
})

test('树工具：removeLeaf / collapseToSelf / replaceLeaf 的边界', () => {
  const tree = { kind: 'split', orientation: 'horizontal', proportion: 0.5, first: { kind: 'leaf', window: 0 }, second: { kind: 'leaf', window: 1 } }
  assert.deepEqual(removeLeaf(tree, 0), { kind: 'leaf', window: 1 })
  assert.deepEqual(removeLeaf(tree, 1), { kind: 'leaf', window: 0 })
  assert.deepEqual(collapseToSelf(tree, 0), { kind: 'leaf', window: 0 })
  const replaced = replaceLeaf(tree, 1, { kind: 'leaf', window: 9 })
  assert.equal(replaced.second.window, 9)
  // 嵌套：内层塌掉之后外层保留。
  const nested = {
    kind: 'split', orientation: 'horizontal', proportion: 0.5,
    first: { kind: 'leaf', window: 0 },
    second: { kind: 'split', orientation: 'vertical', proportion: 0.5, first: { kind: 'leaf', window: 1 }, second: { kind: 'leaf', window: 2 } },
  }
  assert.deepEqual(removeLeaf(nested, 1), {
    kind: 'split', orientation: 'horizontal', proportion: 0.5,
    first: { kind: 'leaf', window: 0 }, second: { kind: 'leaf', window: 2 },
  })
  assert.equal(collapseToSelf(nested, 2).kind, 'split', '外层不动，内层塌成 2')
  assert.deepEqual(collapseToSelf(nested, 2).second, { kind: 'leaf', window: 2 })
  assert.equal(orderedWindows({ windows: [], layout: nested, current: null, nextId: 3 }).length, 0, '窗口表里没有就不返回')
  assert.equal(EDITOR_TAB_LIMIT_DEFAULT, 30, 'UISettingsState.kt:68')
})

test('关系：能力探测仍只有 editorWindows.ts 一处真相，两个新文件都真 import 它', () => {
  const windowRules = read('src/editorWindowRules.ts')
  const migration = read('src/editorTabMigrationRules.ts')
  assert.match(migration, /from '\.\/editorWindowRules\.ts'/, '迁移规则单向依赖窗口规则（无环）')
  // 窗口规则只**在注释里**提那个文件名（说明职责边界），没有 import 语句 —— 靠"去掉注释后"判。
  const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const windowRulesCode = stripComments(windowRules)
  const migrationCode = stripComments(migration)
  assert.doesNotMatch(windowRulesCode, /editorTabMigrationRules/, '窗口规则不反向 import，避免环')
  assert.match(migrationCode, /from '\.\/editorWindows\.ts'/)
  assert.match(migrationCode, /canDetachEditor/)
  // 手势判档 / 几何 / 拖出边界不在这里重复实现。
  const foreign = /openModeForEvent|detachedGeometry|clampDetachedGeometry|dropDetachesTab/
  assert.doesNotMatch(windowRulesCode, foreign)
  assert.doesNotMatch(migrationCode, foreign)
})
