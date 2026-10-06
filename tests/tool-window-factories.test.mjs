// 工具窗口**注册机制**（EP → Factory → 注册任务）与它喂给查询面的那几位。
// 判词：`docs/inventory/verdict-toolwindow-openapi.md` 里 `ToolWindowFactory` `[~]`、
// `WindowInfo` `[~]`、`ToolWindowManagerEx` `[~]`、`ToolWindowManagerImpl` `[~]`、`RegisterToolWindowTask` `[x]`。
//
// 上游坐标（参考树 intellij-community-master，行号自己数的）：
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java:18/22-24/29-30/49-50/60-61/67-69/78-82`
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowFactory.kt:23-30/33/54/64-66/68-70`
//   · `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt:340-342/344-356/358-376/379-409`
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt:42-55`（`:46` = `info.isSplit = task.sideTool`）
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/WindowInfoImpl.kt:165-170`（`isActiveOnStart` ← EP `doNotActivateOnStart`）
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowImpl.kt:647` +
//     `platform/platform-impl/src/com/intellij/ui/content/impl/ContentManagerImpl.java:139-141/473` +
//     `platform/platform-impl/src/com/intellij/ui/content/TabbedPaneContentUI.java:161` +
//     `platform/platform-impl/src/com/intellij/ide/actions/CloseActiveTabAction.java:25/46`（`canCloseContents` 那一条链）
//   · `<toolWindow>` 的注册出处：`platform/structure-view-impl/resources/intellij.platform.structureView.xml:55-56`、
//     `platform/bookmarks/resources/intellij.platform.bookmarks.xml:47-48`、
//     `platform/platform-impl/resources/intellij.platform.ide.impl.xml:1210-1212`（三条 `secondary="true"`）；
//     `platform/todo/resources/intellij.platform.todo.xml:60-61`、
//     `platform/vcs-impl/resources/META-INF/VcsExtensions.xml:193-194`（两条 `canCloseContents="true"`）；
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1329-1330`、
//     `platform/vcs-impl/resources/META-INF/VcsExtensions.xml:185-186`、
//     `plugins/gradle/plugin-resources/intellij.gradle.xml:228-229`（三条**都没写**这两个属性）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beanToTask, canActivateOnStart, toolWindowAnchorOf } from '../src/toolWindowFactories.ts'
import { TOOL_WINDOW_REGISTRY, toolActiveOnStart, toolCanCloseContents, toolSecondary,
         toolWindowTask, toolWindowTasks } from '../src/toolWindowMeta.ts'
import { assembleWindowInfo, canCloseContents, toolWindowManager } from '../src/toolWindowManager.ts'
import { toolWindowGearRows } from '../src/menus/toolWindowGear.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const ALL_READY = { isDesktop: true, hasWorkspace: true, lspReady: true, gradleAvailable: true }

// --- 装配规则（`ToolWindowSetInitializer.kt:340-376` 逐条对上）--------------------------------

test('锚点的三级优先：工厂覆盖 EP，EP 覆盖默认 left（:340-342、DesktopLayout.kt:51-53）', () => {
  assert.equal(toolWindowAnchorOf({ id: 'X' }), 'left', '两处都没写 = LEFT（`bean.anchor ?: LEFT`）')
  assert.equal(toolWindowAnchorOf({ id: 'X', anchor: 'bottom' }), 'bottom')
  assert.equal(toolWindowAnchorOf({ id: 'X', anchor: 'bottom' }, { anchor: 'right' }), 'right',
    '工厂的 anchor 覆盖注册表那一份')
})

test('两道闸分开：档案压掉与 isApplicable 不通过 = 压根不注册（:350-355）', () => {
  const bean = { id: 'Demo', anchor: 'left' }
  const made = beanToTask({ bean, factory: { isApplicable: () => true }, deps: ALL_READY, stripeTitle: '演示' })
  assert.ok(made, 'isApplicable 答 true 时该有这一条任务')
  assert.equal(beanToTask({ bean, factory: { isApplicable: () => false }, deps: ALL_READY, stripeTitle: '演示' }), null,
    'isApplicable 答 false ⇒ 不注册（不是"注册了但灰着"）')
  assert.equal(beanToTask({ bean, deps: ALL_READY, stripeTitle: '演示', suppressedIds: ['Demo'] }), null,
    '被档案压掉的 id（上游 suppressedToolWindowIds）也不注册')
  // shouldBeAvailable 是**另一层**：任务照样存在，只是带着 false。
  const grayed = beanToTask({ bean, factory: { shouldBeAvailable: () => false }, deps: ALL_READY, stripeTitle: '演示' })
  assert.equal(grayed?.shouldBeAvailable, false)
  assert.equal(grayed?.id, 'Demo', '不可用 ≠ 不注册（条纹上还该有它，只是灰着）')
})

test('EP 三个布尔位各自的去处（:368-369 与 WindowInfoImpl.kt:169、DesktopLayout.kt:46）', () => {
  const plain = beanToTask({ bean: { id: 'Plain' }, deps: ALL_READY, stripeTitle: '平' })
  assert.equal(plain.sideTool, false)
  assert.equal(plain.isSplit, false)
  assert.equal(plain.canCloseContent, false, 'XML 没写 canCloseContents 的窗口在上游就是 false（Java boolean 字段）')
  assert.equal(plain.isActiveOnStart, true, '没写 doNotActivateOnStart ⇒ 允许启动即亮')
  const odd = beanToTask({
    bean: { id: 'Odd', secondary: true, canCloseContents: true, doNotActivateOnStart: true },
    deps: ALL_READY, stripeTitle: '怪',
  })
  assert.equal(odd.sideTool, true)
  assert.equal(odd.isSplit, true, 'secondary → sideTool → WindowInfo.isSplit 的初值')
  assert.equal(odd.canCloseContent, true)
  assert.equal(odd.isActiveOnStart, false)
  assert.equal(canActivateOnStart({}), true)
  assert.equal(canActivateOnStart({ doNotActivateOnStart: true }), false)
})

test('注册表里那几条的 EP 值与上游 XML 一字不差', () => {
  // 三条 secondary="true"：Structure / Bookmarks / Notifications（本仓的 outline / bookmarks / notifications）
  assert.deepEqual(TOOL_WINDOW_REGISTRY.filter(e => e.secondary === true).map(e => e.id), ['outline', 'bookmarks', 'notifications'])
  // 两条 canCloseContents="true"：TODO 与 Version Control
  assert.deepEqual(TOOL_WINDOW_REGISTRY.filter(e => e.canCloseContents === true).map(e => e.id), ['vcslog', 'todo'])
  // 本仓没有任何窗口写 doNotActivateOnStart（上游唯一的例子是 UI Inspector，本仓没那个窗口）
  assert.deepEqual(TOOL_WINDOW_REGISTRY.filter(e => e.doNotActivateOnStart === true), [])
})

test('三条派生表都只由注册表算出，别处没有第二份（与 toolTitles/toolIcons 同一手法）', () => {
  const ids = TOOL_WINDOW_REGISTRY.map(e => e.id)
  assert.deepEqual(Object.keys(toolSecondary), ids)
  assert.deepEqual(Object.keys(toolCanCloseContents), ids)
  assert.deepEqual(Object.keys(toolActiveOnStart), ids)
  for (const entry of TOOL_WINDOW_REGISTRY) {
    assert.equal(toolSecondary[entry.id], entry.secondary === true)
    assert.equal(toolCanCloseContents[entry.id], entry.canCloseContents === true)
    assert.equal(toolActiveOnStart[entry.id], entry.doNotActivateOnStart !== true)
  }
  const meta = read('src/toolWindowMeta.ts')
  for (const name of ['toolSecondary', 'toolCanCloseContents', 'toolActiveOnStart']) {
    assert.match(meta, new RegExp(`export const ${name}: Record<ToolWindowId, boolean> = derived\\(`), `${name} 要派生`)
  }
})

test('toolWindowTask / toolWindowTasks = registerToolWindow 与 computeToolWindowBeans 的读的那一半', () => {
  const task = toolWindowTask('gradle', ALL_READY)
  assert.equal(task.anchor, 'right')
  assert.equal(task.stripeTitle, 'Gradle')
  assert.equal(task.canCloseContent, false)
  assert.equal(toolWindowTask('todo', ALL_READY).canCloseContent, true)
  assert.equal(toolWindowTask('不存在的窗口', ALL_READY), null)
  // 可用性住在注册表里：同一条 bean 换一份项目状态，任务还在、只是 shouldBeAvailable 变 false。
  assert.equal(toolWindowTask('gradle', { ...ALL_READY, gradleAvailable: false }).shouldBeAvailable, false)
  assert.equal(toolWindowTask('vcslog', { ...ALL_READY, isDesktop: false }).shouldBeAvailable, false)
  assert.deepEqual(toolWindowTasks(ALL_READY).map(t => t.id), TOOL_WINDOW_REGISTRY.map(e => e.id),
    '全就绪时装配出的顺序 = 注册表顺序（不重排）')
  assert.deepEqual(toolWindowTasks(ALL_READY, ['notifications']).map(t => t.id).filter(id => id === 'notifications'), [],
    '压掉的 id 从装配结果里消失')
})

// --- 查询面（门面读这几位的方式）---------------------------------------------------------------

test('门面的 canCloseContents：注册过的答真值，没注册记录的答 null 而不是猜', () => {
  assert.equal(canCloseContents('todo'), true)
  assert.equal(canCloseContents('vcslog'), true)
  assert.equal(canCloseContents('files'), false)
  assert.equal(canCloseContents('notifications'), false)
  // 底部那几格固定内容在本仓没有 <toolWindow> 注册记录 ⇒ 答不出，调用方沿用"有几条内容"那条判据。
  assert.equal(canCloseContents('references'), null)
  assert.equal(toolWindowManager().canCloseContents('outline'), false, '门面那一份与模块函数同一条来源')
})

test('WindowInfo.isSplit 由注册表给初值，布局存过的值优先（DesktopLayout.kt:46 与 AbstractDroppableStripe.kt:254-255）', () => {
  const source = fixture()
  assert.equal(assembleWindowInfo('files', source).isSplit, false)
  assert.equal(assembleWindowInfo('bookmarks', source).isSplit, true, 'EP secondary 的窗口 isSplit 初值为真')
  assert.equal(assembleWindowInfo('notifications', source).isSplit, true)
  assert.equal(assembleWindowInfo('references', source).isSplit, false, '没有注册记录的 id 不猜')
  assert.equal(assembleWindowInfo('bookmarks', { ...source, isSplit: () => false }).isSplit, false,
    '布局里存过这一位就用布局的')
})

test('WindowInfo.isActiveOnStart 先问 EP 那一位，再问这一侧能不能占着那一格（WindowInfoImpl.kt:165-170）', () => {
  const source = fixture()
  assert.equal(assembleWindowInfo('files', source).isActiveOnStart, true)
  assert.equal(assembleWindowInfo('gradle', source).isActiveOnStart, false, '底部那一格没开着 ⇒ 不亮（本仓的单格近似）')
  assert.equal(assembleWindowInfo('gradle', { ...source, visibleIds: () => ['gradle', 'files'] }).isActiveOnStart, true)
})

function fixture() {
  const anchors = { files: 'left', bookmarks: 'left', notifications: 'right', gradle: 'bottom', references: 'bottom' }
  return {
    anchorOf: id => anchors[id] ?? 'left',
    idsOn: side => Object.keys(anchors).filter(id => anchors[id] === side),
    visibleIds: () => ['files'],
    stripeButtonHidden: () => false,
    contentUiType: () => 'tabbed',
    stripeWidth: () => 0,
    typeState: () => ({ type: 'docked', autoHide: false }),
    viewModeOf: () => 'dockPinned',
    floatingBoundsOf: () => null,
    toolDisabled: () => false,
    setViewMode: () => false,
  }
}

// --- 消费链路：齿轮那道闸 + popupSteps 的生产消费点（桶 7b 的请求 A1）---------------------------

test('齿轮的 Close All 要先过注册表那道闸：答 false 的窗口整行不见，答不出的保持现状', () => {
  const row = id => ({ id, title: '关闭所有标签页', enabled: () => true })
  const withContents = ids => toolWindowGearRows(row, undefined, true, {}, ids).map(item => item.id)
  assert.ok(withContents(undefined).includes('window.closeAllTabs'), '不给 id 时摘掉现有行为=放松判据')
  assert.ok(withContents('todo').includes('window.closeAllTabs'), 'TODO 那条注册写了 canCloseContents=true')
  assert.ok(!withContents('files').includes('window.closeAllTabs'),
    'Project 那条注册没写（=false）：上游 TabbedContentAction.java:87/114 是 setEnabledAndVisible，整行不见')
  assert.ok(withContents('references').includes('window.closeAllTabs'),
    '底部那几格在本仓没有注册记录 ⇒ 这一位答不出，不替它猜 false 把好用的行关掉')
  // 同一道闸不该顺手管住别的行：Close All 被摘掉时其余行不受影响（标签形态用的是"有几条内容"）。
  assert.ok(withContents('files').includes('window.toggleContentUiType') || withContents('files').includes('window.resizeToolWindow'),
    'canCloseContents 那道闸把整组都摘了 —— 它只管 Close All 这一行')
})

test('A1 门禁：popupSteps 的**行模型那一半**有生产消费方', () => {
  // 桶 7b 的 A1 原写「`src/popupSteps.ts` 除 `tests/popup-steps.test.mjs` 外全仓无人引用」——
  // 动手前核实：`src/popupAnchor.ts:11` 已经在值 import `showOptionsPoint`，所以"零消费方"这句
  // 到本批**已经不成立**（原写 X、实际 Y）。真正没人接的是 A1 点名的那一半：
  // `listStepRows` / `shouldBeShowing` / `isClosableOnExecute`（分步列表的行模型）。
  // 这一条门禁钉的是**那一半**，不是"随便谁 import 过"。
  const consumers = []
  const scan = (dir, label) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|vue)$/.test(entry.name) || entry.name === 'popupSteps.ts') continue
      const text = readFileSync(join(root, dir, entry.name), 'utf8')
      // 只认**值** import（`import type` 会被擦除，等于没接）。
      const line = text.match(/^import \{([^}]*)\} from '\.{1,2}\/popupSteps\.ts'$/m)
      if (!line) continue
      const named = line[1].split(',').map(part => part.trim().replace(/^type\s+\S+$/, '')).filter(Boolean)
      if (named.some(name => ['listStepRows', 'shouldBeShowing', 'isClosableOnExecute'].includes(name))) {
        consumers.push(`${label}/${entry.name}`)
      }
    }
  }
  scan('src', 'src')
  scan(join('src', 'components'), 'src/components')
  scan(join('src', 'menus'), 'src/menus')
  assert.ok(consumers.length > 0,
    'popupSteps 的行模型那一半（listStepRows/shouldBeShowing/isClosableOnExecute）还是一个生产消费方都没有')
})
