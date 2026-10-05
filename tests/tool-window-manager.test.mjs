// 工具窗口统一门面（`ToolWindowManager` / `ToolWindowManagerEx` / `WindowInfo`）的判据。
//
// 上游坐标（参考树 intellij-community-master）：
//   · `platform/platform-api/src/com/intellij/openapi/wm/WindowInfo.kt:9-50`（20 个属性）、
//     `:7`（默认 pane id `"root"`）、`:53`（`safeToolWindowPaneId`）；
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowManager.kt:120/122/127/139/144`
//     （`toolWindowIds` / `toolWindowIdSet` / `activeToolWindowId` / `getToolWindow` / `invokeLater`）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/ex/ToolWindowManagerEx.kt:19/50`
//     （`toolWindows` / `getIdsOn(anchor)`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import {
  WINDOW_INFO_DEFAULT_TOOL_WINDOW_PANE_ID, assembleWindowInfo, installToolWindowManager,
  registerToolWindowId, resetRegisteredToolWindowIds, toolWindowManager, windowInfo,
} from '../src/toolWindowManager.ts'
import { createToolWindowStripes } from '../src/toolWindowStripes.ts'

function fixture(overrides = {}) {
  const anchors = { files: 'left', project: 'left', gradle: 'bottom', run: 'bottom' }
  const order = { left: ['project', 'files'], right: [], bottom: ['run', 'gradle'] }
  const types = { files: { type: 'docked', autoHide: true }, gradle: { type: 'sliding', autoHide: false } }
  const disabled = new Set(['project'])
  return {
    anchorOf: id => anchors[id] ?? 'left',
    idsOn: side => order[side] ?? [],
    visibleIds: () => ['files', 'gradle'],
    stripeButtonHidden: id => id === 'gradle',
    contentUiType: () => 'tabbed',
    stripeWidth: id => (id === 'files' ? 180 : 0),
    typeState: id => types[id] ?? { type: 'docked', autoHide: false },
    viewModeOf: id => (types[id]?.autoHide ? 'dockUnpinned' : 'dockPinned'),
    floatingBoundsOf: () => null,
    toolDisabled: id => disabled.has(id),
    setViewMode: () => true,
    maximizedId: () => 'gradle',
    ...overrides,
  }
}

test('WindowInfo 一次给全 20 个属性（WindowInfo.kt:9-50 逐条对上）', () => {
  const info = assembleWindowInfo('files', fixture())
  const keys = Object.keys(info).sort()
  for (const name of ['id', 'order', 'stripeWidth', 'isVisible', 'isFromPersistentSettings', 'anchor',
                      'floatingBounds', 'isMaximized', 'isSplit', 'type', 'isActiveOnStart', 'isAutoHide',
                      'isDocked', 'isShowStripeButton', 'contentUiType', 'toolWindowPaneId', 'viewMode',
                      'isAvailable']) {
    assert.ok(keys.includes(name), `聚合对象少了 \`WindowInfo.${name}\``)
  }
  assert.equal(info.anchor, 'left')
  assert.equal(info.isVisible, true)
  assert.equal(info.order, 1, '`WindowInfo.order` 是**该条侧条内**的序号，不是全局序号')
  assert.equal(info.stripeWidth, 180, '本仓侧条存像素宽度而不是权重（判词 §B-5 登记的那条差异）')
  assert.equal(info.isShowStripeButton, true)
  assert.equal(info.contentUiType, 'tabbed')
  assert.equal(info.toolWindowPaneId, WINDOW_INFO_DEFAULT_TOOL_WINDOW_PANE_ID)
})

test('isDocked 是 type 的派生位，isAutoHide 与它无关（WindowInfo.kt:36-38）', () => {
  const source = fixture()
  assert.equal(assembleWindowInfo('files', source).isDocked, true, 'DOCKED ⇒ isDocked')
  assert.equal(assembleWindowInfo('files', source).isAutoHide, true, 'isAutoHide 独立于 type（auto_hide 是另一列）')
  assert.equal(assembleWindowInfo('gradle', source).isDocked, false, 'SLIDING ⇒ 不是停靠')
})

test('getToolWindow 对没注册的 id 返回 null，不猜（ToolWindowManager.kt:139）', t => {
  install(t, fixture())
  const manager = toolWindowManager()
  assert.notEqual(manager.getToolWindow('files'), null, 'files 在可见集里 ⇒ 算注册过')
  assert.equal(manager.getToolWindow('not-registered'), null)
  assert.equal(manager.getToolWindow(null), null)
  assert.equal(manager.getToolWindow(''), null, '空串也算没注册')
})

test('toolWindows() 只列可用的窗口；getIdsOn 用该侧的顺序（ToolWindowManagerEx.kt:19/50）', t => {
  install(t, fixture())
  const manager = toolWindowManager()
  // `project` 在夹具里是 disabled（`ToolWindow.isAvailable` 为假）⇒ 不列，菜单里也就没有这一行。
  assert.equal(manager.toolWindows().some(info => info.id === 'project'), false, '不可用的窗口进了列表')
  assert.equal(manager.toolWindows().some(info => info.id === 'files'), true)
  assert.deepEqual(manager.getIdsOn('bottom'), ['run', 'gradle'], '`getIdsOn(anchor)` 的顺序就是那条侧条的顺序')
  assert.equal(manager.getIdsOn('right').length, 0)
  assert.equal(manager.toolWindowIdSet().has('gradle'), true, '`toolWindowIdSet`（:122）与 `toolWindowIds`（:120）同集合')
  assert.deepEqual([...manager.toolWindowIds()], [...manager.toolWindowIdSet()])
})

test('activeToolWindowId = 可见集里最后亮出来的那一个；没有可见窗口时是 null（:127）', t => {
  install(t, fixture())
  assert.equal(toolWindowManager().activeToolWindowId(), 'gradle')
  assert.equal(toolWindowManager().isEditorComponentActive(), false, '有窗口可见 ⇒ 焦点不在编辑器')
  install(t, fixture({ visibleIds: () => [] }))
  assert.equal(toolWindowManager().activeToolWindowId(), null)
  assert.equal(toolWindowManager().isEditorComponentActive(), true)
})

test('invokeLater 排到微任务，不同步执行（ToolWindowManager.kt:144）', async () => {
  const manager = toolWindowManager()
  let ran = false
  manager.invokeLater(() => { ran = true })
  assert.equal(ran, false, '`invokeLater` 当场就跑了就不是"排到队列尾部"')
  await Promise.resolve()
  assert.equal(ran, true)
})

/** 把一个夹具状态装成"进程里的那一份"；用例结束后卸掉（门面是进程级单例，留着会串下一个用例）。 */
function install(t, source) {
  installToolWindowManager(source)
  t.after(() => installToolWindowManager(null))
}

// ── 接线判据：门面必须被真实状态安装、被真实组件消费（不是又一个只过自己测试的死模块） ──
function withStorage(t) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  } })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  })
  return values
}

test('createToolWindowStripes 就是门面的安装点：建完状态后 windowInfo(id) 立刻答得上来', t => {
  withStorage(t)
  const explorer = ref(false), bottom = ref(false), activeView = ref(''), bottomTab = ref('')
  const store = createToolWindowStripes({
    isDesktop: true, workspace: ref({ root: 'project' }), lspReady: ref(true),
    gradleAvailable: ref(true), explorer, activeView, bottom, bottomTab,
  })
  store.setToolAnchor('files', 'left')
  const info = windowInfo('files')
  assert.notEqual(info, null, '工厂没有 installToolWindowManager ⇒ 门面永远是空的')
  assert.equal(info.anchor, 'left')
  assert.equal(info.isAvailable, true)
  assert.equal(info.isDocked, true, '出厂默认 DOCKED（WindowInfoImpl.kt:74）')
  assert.equal(info.isAutoHide, false, '出厂默认 auto_hide=false（WindowInfoImpl.kt:46-47）')
  // 写路径也走同一条门面（`ToolWindowViewModeAction.java:127-135`）。
  assert.equal(toolWindowManager().setViewMode('files', 'dockUnpinned'), true)
  assert.equal(windowInfo('files').isAutoHide, true)
  assert.equal(toolWindowManager().setViewMode('files', 'dockUnpinned'), false, '同值再设一次要直接 return')
})

test('标题栏读的是门面，不再连读三份 store 指针', () => {
  const header = readFileSync(new URL('../src/components/ToolWindowHeader.vue', import.meta.url), 'utf8')
  assert.ok(header.includes("from '../toolWindowManager.ts'"), '视图模式那一组没接门面')
  assert.doesNotMatch(header, /activeToolWindowLayoutState\(\)\?\.windowTypeState/,
    '还在直接读 stripes 的散装 getter ⇒ `WindowInfo`「缺每窗口聚合对象」这条又回来了')
})

// ── 运行期注册表：本批（2026-10-06）接上的那条生产方 ──────────────────────────────
// 上游：`ToolWindowManager.kt:39` 的 `registerToolWindow(id, …)` 与 `:107-108` 的
// `unregisterToolWindow(id)`；`toolWindowIds()`（`:120`）答的是**注册过的**窗口，不是"正开着的"，
// `getToolWindow(id)`（`:139`）只对没注册过的错答 null。
// 本仓底部那几格内容（output/run/problems/references/hierarchy/terminal）不在出厂锚点表里，
// 上游它们各自就是工具窗口 ⇒ 装载项目布局时由 `src/toolWindowStripes.ts` 逐条登记。
test('登记过的内容收起来了也答得出 getToolWindow；reset 后回到"没注册过"', () => {
  installToolWindowManager(fixture())
  resetRegisteredToolWindowIds()
  assert.equal(toolWindowManager().getToolWindow('output'), null, '没登记、也没开着 ⇒ null（:139）')
  registerToolWindowId('output')
  assert.notEqual(toolWindowManager().getToolWindow('output'), null, '登记过就该答得出，哪怕它没开着')
  assert.ok(toolWindowManager().toolWindowIds().includes('output'), '`toolWindowIds`（:120）漏了登记的那条')
  assert.equal(toolWindowManager().toolWindowIdSet().has('output'), true, '`toolWindowIdSet`（:122）与它不同集合')
  registerToolWindowId('output')
  assert.equal(toolWindowManager().toolWindowIds().filter(id => id === 'output').length, 1, '同一条登记两次不该出现两次')
  resetRegisteredToolWindowIds()
  assert.equal(toolWindowManager().getToolWindow('output'), null, '换项目要先清掉上一份登记（:108）')
})

test('生产方确实存在：stripes 装载项目布局时登记 / 换项目时清登记', () => {
  const stripes = readFileSync(new URL('../src/toolWindowStripes.ts', import.meta.url), 'utf8')
  assert.ok(stripes.includes("import { installToolWindowManager, registerToolWindowId, resetRegisteredToolWindowIds } from './toolWindowManager.ts'"),
    "门面注册表没有生产方（或值 import 漏了 .ts 扩展名 ⇒ Node ESM 下整个模块加载失败）")
  assert.match(stripes, /extraContentIds\.add\(id\); registerToolWindowId\(id\)/,
    '布局里读到的"不在出厂锚点表"的内容没登记进门面')
  assert.match(stripes, /resetRegisteredToolWindowIds\(\)\s*\n\s*refreshContentUiTypes\(layout\)/,
    '换项目时没清上一份登记（`unregisterToolWindow`，:107-108）')
})

// ── isEditorComponentActive 的**真判据**：问焦点，不问"有没有窗口开着" ──────────────
// 上游：`ToolWindowManager.kt:112-115` 的 kdoc「`true` if and only if an editor component is active」，
// 实现在 `ToolWindowManagerState.kt:52-55` = `getParentOfType(EditorsSplitters, focusOwner) != null`。
// 消费方一族：`TabNavigationActionBase.java:59/:83`、`ActivateToolWindowAction.kt:156`。
test('宿主给了焦点判据就用它：窗口开着而光标在编辑器里 ⇒ 编辑器 active', () => {
  installToolWindowManager(fixture({ editorComponentActive: () => true }))
  assert.equal(toolWindowManager().isEditorComponentActive(), true,
    '夹具里两条窗口可见，但焦点在编辑器 ⇒ 上游答 true')
  installToolWindowManager(fixture({ editorComponentActive: () => false }))
  assert.equal(toolWindowManager().isEditorComponentActive(), false, '焦点进了 dock ⇒ 上游答 false')
  // 没装焦点通道时（SSR / 旧夹具）退回那条保守近似，且如实登记在门面文件头。
  installToolWindowManager(fixture())
  assert.equal(toolWindowManager().isEditorComponentActive(), false,
    '近似档：有窗口可见 ⇒ 答"编辑器不 active"')
  installToolWindowManager(null)
})
