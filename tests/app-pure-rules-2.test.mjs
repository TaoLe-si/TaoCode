// 2026-10-06 第二轮「纯规则搬家」的判据：搬出去的九条规则逐条给**行为**用例，
// 而不是只 grep 文本 —— 文本锚点由 `tests/*` 里既有的那些断言继续守着（改的只有读取面）。
//
// 另外钉三条**接线**（本轮新落的用户可见链路），并反向验证：把它们逐个改坏 ⇒ 对应用例必须变红。
// 本文件一律纯 JavaScript（规约 §4.2），值 import 一律带全扩展名（规约 §4.1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'

import { createMenuKeyboard } from '../src/appMenuKeyboard.ts'
import { createToolWindowActivation } from '../src/appToolWindowActivation.ts'
import { createToolWindowDockPlacement } from '../src/appDockPlacement.ts'
import { createToolWindowDockSide } from '../src/toolWindowDockSide.ts'
import { createToolWindowsHoverPopup } from '../src/appToolWindowHoverPopup.ts'
import { createPlacesRing, PLACES_RING_LIMIT, recentPlacesList } from '../src/appPlacesRing.ts'
import { affectedDirtyTabs } from '../src/appAffectedTabs.ts'
import { linkPathWithinWorkspace } from '../src/appLinkPath.ts'
import { saveFailureFor } from '../src/appSaveFailure.ts'
import { findGitChange } from '../src/appGitChangeLookup.ts'
import { readExportThemeTokens } from '../src/appExportTheme.ts'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const app = read('../src/App.vue')

// 给 `appMenuKeyboard` 与悬停弹层用的最小 DOM 替身（模块里的选择器字符串照抄宿主，这里按前缀认）。
function installDom(items) {
  const focused = []
  const triggers = []
  globalThis.document = {
    querySelectorAll(selector) {
      if (!selector.startsWith('#menu-')) return []
      return items.map((item, index) => ({
        disabled: false,
        focus() { focused.push(index) },
      }))
    },
    querySelector(selector) {
      if (!selector.startsWith('[aria-controls="menu-')) return null
      const kind = selector.slice(selector.indexOf('"menu-') + 6, -2)
      const node = { focus() { focused.push('trigger:' + kind) } }
      triggers.push(kind)
      return node
    },
  }
  globalThis.document.activeElement = null
  return { focused, triggers }
}

test('菜单键盘导航：按键集合与 Tab / Escape 的收菜单和回焦点', async () => {
  const dom = installDom(['a', 'b', 'c'])
  const opened = []
  const closed = []
  const nav = createMenuKeyboard({
    groups: () => [{ menu: 'file' }, { menu: 'edit' }, { menu: 'window' }],
    open: kind => opened.push(kind),
    close: () => closed.push('close'),
  })
  // 不在集合里的键：既不 stopPropagation 也不 preventDefault，交给外层。
  let stop = 0
  let prevent = 0
  const keyed = (key, extra = {}) => {
    const event = { key, stopPropagation() { stop++ }, preventDefault() { prevent++ }, ...extra }
    nav.onMenuKeydown(event, 'file')
    return event
  }
  stop = 0; prevent = 0; keyed('Enter')
  assert.equal(stop, 0, 'Enter 不该被拦截')
  assert.equal(prevent, 0, 'Enter 不该被吃掉默认动作')
  stop = 0; prevent = 0; keyed('Tab')
  assert.equal(stop, 1, 'Tab 属于菜单的键，要 stopPropagation')
  assert.equal(prevent, 0, 'Tab 只收菜单，不 preventDefault（与搬走之前一致）')
  assert.deepEqual(closed, ['close'], 'Tab 收起菜单')
  stop = 0; prevent = 0; closed.length = 0; keyed('Escape')
  assert.equal(prevent, 1, 'Escape 要 preventDefault')
  assert.deepEqual(closed, ['close'], 'Escape 收起菜单')
  await nextTick()
  assert.deepEqual(dom.focused.at(-1), 'trigger:file', 'Escape 之后焦点回到该档的触发按钮')
  // focusMenu：open 之后在 nextTick 里聚焦第一项 / 最后一项。
  dom.focused.length = 0
  nav.focusMenu('edit')
  await nextTick()
  assert.deepEqual(opened.at(-1), 'edit', 'focusMenu 先开这一档')
  assert.equal(dom.focused[0], 0, '默认聚焦第一颗可用的行')
  dom.focused.length = 0
  nav.focusMenu('edit', true)
  await nextTick()
  assert.equal(dom.focused[0], 2, 'last = true 聚焦最后一颗（按住上键打开菜单那条）')
})

test('菜单键盘导航：左右换档与上下 / Home / End 的环形取模', async () => {
  installDom(['a', 'b', 'c'])
  const opened = []
  const nav = createMenuKeyboard({
    groups: () => [{ menu: 'file' }, { menu: 'edit' }, { menu: 'window' }],
    open: kind => opened.push(kind),
    close: () => {},
  })
  const fire = key => nav.onMenuKeydown({ key, stopPropagation() {}, preventDefault() {} }, 'file')
  fire('ArrowRight')
  assert.deepEqual(opened.at(-1), 'edit', '右移到下一档')
  fire('ArrowLeft')
  assert.deepEqual(opened.at(-1), 'window', '第一档往左回绕到最后一档')
  opened.length = 0
  // 行内的环形：activeElement 不在表里时 indexOf = -1 ⇒ 下移落在 0、上移落在最后一项。
  const focused = []
  document.querySelectorAll = () => [0, 1, 2].map(index => ({ focus() { focused.push(index) } }))
  document.activeElement = null
  fire('ArrowDown')
  assert.deepEqual(focused.at(-1), 0, '没有当前项时下移落到第一项（-1 + 1 取模）')
  fire('ArrowUp')
  assert.deepEqual(focused.at(-1), 1, '没有当前项时上移落在第二颗（-1 - 1 + 3 取模 = 1，与搬走之前一致）')
  focused.length = 0
  fire('Home')
  assert.equal(focused.at(-1), 0, 'Home 是第一颗')
  fire('End')
  assert.equal(focused.at(-1), 2, 'End 是最后一颗')
})

test('侧条一次点击：底部档收起 / 展开，files 档翻左栏，outline 档走自己的切换', () => {
  const calls = []
  const host = () => {
    const bottom = { value: false }
    const bottomTab = { value: 'output' }
    const explorer = { value: true }
    const leftView = { value: 'files' }
    const rightView = { value: 'agent' }
    const rightVisible = { value: false }
    const made = createToolWindowActivation({
      bottom, bottomTab, explorer, leftView, rightView, rightVisible,
      toolDisabled: id => id === 'notifications',
      restoreStripeButton: id => calls.push('restore:' + id),
      anchorOf: id => (id === 'gradle' ? 'bottom' : 'left'),
      routeToDock: id => { if (id === 'gradle') return 'bottom'; explorer.value = true; leftView.value = id; return 'left' },
      toggleOutline: () => calls.push('toggleOutline'),
      recordActiveToolWindow: id => calls.push('record:' + id),
    })
    return { ...made, bottom, bottomTab, explorer, leftView, rightView, rightVisible }
  }
  const off = host()
  off.activateToolWindow('notifications')
  assert.deepEqual(calls, [], '不可用的窗口整条不动（连按钮复原都不做）')

  const gradle = host()
  gradle.activateToolWindow('gradle')
  assert.equal(gradle.bottom.value, true, '底部锚点：第一次点击打开底部 dock')
  assert.equal(gradle.bottomTab.value, 'gradle', '并且选中这一格')
  assert.ok(calls.includes('record:gradle'), '带上前的那一次点击算激活')
  gradle.activateToolWindow('gradle')
  assert.equal(gradle.bottom.value, false, '同一格再点一次收起（IDEA 的 stripe toggle）')

  const files = host()
  files.explorer.value = true
  files.activateToolWindow('files')
  assert.equal(files.explorer.value, false, 'files 档：左栏开着时点击是切换而不是保持')
  files.activateToolWindow('files')
  assert.equal(files.explorer.value, true, '再点回来')
  assert.ok(calls.includes('record:files'), '展开的那一次算激活')

  const outline = host()
  outline.activateToolWindow('outline')
  assert.ok(calls.includes('toggleOutline'), 'outline 档走自己的切换（不是直接设 leftView）')

  calls.length = 0
  const other = host()
  other.leftView.value = 'git'
  other.activateToolWindow('git')
  assert.equal(other.leftView.value, 'files', '同一个窗口再点一次回 files（收起）')
  assert.ok(!calls.includes('record:git'), '收起的那一次不动常驻栈')
})

test('停靠落点：showView 按锚点选 dock 并记激活、requestEvaluate 用 nonce 重新触发', () => {
  const recorded = []
  let menuClosed = 0
  const make = anchor => {
    const state = {
      bottom: { value: false }, bottomTab: { value: 'output' }, explorer: { value: true }, leftView: { value: 'files' },
    }
    // 用真的 dock 分派（`routeToDock` 就是它的产出面）：锚点由夹具按窗口种类钉住。
    const dock = createToolWindowDockSide({
      toolAnchors: { git: anchor === 'bottom' ? 'bottom' : 'left', todo: 'bottom', debug: anchor === 'bottom' ? 'bottom' : 'left' },
      leftView: state.leftView, explorer: state.explorer,
    })
    const made = createToolWindowDockPlacement({
      bottom: state.bottom, bottomTab: state.bottomTab, leftView: state.leftView, routeToDock: dock.routeToDock,
      recordActiveToolWindow: id => recorded.push(id), closeMenu: () => { menuClosed++ },
    })
    return { ...made, ...state }
  }
  const side = make('left')
  side.showView('git')
  assert.equal(side.leftView.value, 'git', '侧边档把该窗口设为左 dock 的当前视图')
  assert.equal(side.bottom.value, false, '侧边档不碰底部 dock')
  assert.deepEqual(recorded.at(-1), 'git', '每次显示都记一次激活')
  const bottomed = make('bottom')
  bottomed.showView('todo')
  assert.equal(bottomed.bottom.value, true, '底部档打开底部 dock')
  assert.equal(bottomed.bottomTab.value, 'todo', '底部档选中那一格（不能设 leftView）')
  assert.equal(bottomed.leftView.value, 'files', '底部档不动左侧栏的当前视图')
  assert.equal(menuClosed, 2, '两处都收尾收起主菜单')
  bottomed.requestEvaluate('1 + 1')
  assert.equal(bottomed.evaluateRequest.value.text, '1 + 1', '求值文本交过去')
  assert.equal(bottomed.evaluateRequest.value.nonce, 1, 'nonce 从 0 起（第一次是 1）')
  bottomed.requestEvaluate('1 + 1')
  assert.equal(bottomed.evaluateRequest.value.nonce, 2, '同一段文字第二次求值也重新触发面板')
  assert.equal(bottomed.leftView.value, 'debug', '求值落到调试器那一格')
})

test('悬停弹层：同一条 300 ms 双向用 —— 起弹层、指针走进弹层路上不关', () => {
  const armed = []
  let clearedCount = 0
  globalThis.window = {
    setTimeout: (fn, ms) => { armed.push({ fn, ms, cancelled: false }); return armed.length - 1 },
    clearTimeout: handle => { clearedCount++; if (armed[handle]) armed[handle].cancelled = true },
  }
  const fire = () => { const last = armed.at(-1); if (last && !last.cancelled) last.fn() }
  const popup = createToolWindowsHoverPopup()
  assert.equal(popup.toolWindowsPopup.value, false, '默认收起')
  popup.scheduleToolWindowsPopup(true)
  assert.deepEqual(armed.map(item => item.ms), [300], '起弹层用 300 ms')
  popup.scheduleToolWindowsPopup(false)
  assert.equal(clearedCount, 1, '重排之前先取消上一条（否则旧的一条会晚一步把弹层打开）')
  fire()
  assert.equal(popup.toolWindowsPopup.value, false, '只有最后排的那条生效')
  popup.scheduleToolWindowsPopup(true)
  fire()
  assert.equal(popup.toolWindowsPopup.value, true, '到点就打开')
  popup.scheduleToolWindowsPopup(false)
  popup.closeToolWindowsPopup()
  assert.equal(popup.toolWindowsPopup.value, false, '关闭立刻收')
  fire()
  assert.equal(popup.toolWindowsPopup.value, false, '关闭之后被取消的那条计时器不能再把弹层打开')
})

// 「最近位置环」这条判据**原写**：两条环都收同一个位置（第二条只多一个 `edited` 过滤）、
// 写入时按「同文件 + 同行」**全局**去重、上限 60（搬走之前的字面量，没有上游依据）。
// **实际**上游（2026-10-06 nav3 逐行开参考树自数核对）：
//   · 一条命令只进一档 —— `onCommandFinished`：导航档在 `currentCommandIsNavigation && currentCommandHasMoves`
//     时才 `commitBackPlace`（`platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:285-287`
//     → `:388-402` → `putLastOrMerge(isChanged = false)`），有改动时才 `setCurrentChangePlace`
//     （`:289-291` → `:311-341` → `:338` 的 `putLastOrMerge(isChanged = true)`）⇒ 打字留下的位置不再混进「最近位置」列表；
//   · 写入侧只与**最新一条**合并（`putLastOrMerge` `:655-674`，比的是 `list.getLast()`），
//     全局去重在**读出那一步**（`platform/platform-impl/src/com/intellij/ide/actions/RecentLocationsDataModel.kt:95`）；
//   · 两档的上限都是注册表默认值 150（`platform/util/resources/misc/registry.properties:494`，
//     读它的是同文件 `:76-77` 的 `BACK_QUEUE_LIMIT` / `CHANGE_QUEUE_LIMIT`）。
// ⇒ 下面把断言改成**钉新形状**（不比原来松：条数、顺序、两档归属、合并半径都逐字钉）。
test('最近位置环：一条命令只进一档、写入只并表头、上限 150、读出才全局去重', () => {
  const ring = createPlacesRing()
  const at = (line, edited) => ({ path: 'a/x.ts', line, edited })
  ring.rememberPlace(at(10, true))
  ring.rememberPlace(at(20, false))
  ring.rememberPlace(at(10, true))
  assert.deepEqual(ring.places.value.map(item => item.line), [20], '导航档不收带 edited 的那一条（`:285-291` 的两支互斥）')
  assert.deepEqual(ring.changePlaces.value.map(item => item.line), [10], '更改档只收 edited，且表头同位置合并成一条')
  // 写入侧的合并半径 = 表头那一条（`putLastOrMerge` `:660-665` 的 `list.getLast()`）：
  // 同一个位置夹在别的落点之后再来一次，环里**留两条**（用户看到的是 `:95` 读出去重后的结果）。
  ring.rememberPlace(at(30, false))
  ring.rememberPlace(at(20, false))
  assert.deepEqual(ring.places.value.map(item => item.line), [20, 30, 20], '非表头的同位置不摘：环里可以有两条，读出去掉')
  assert.deepEqual(recentPlacesList(ring.places.value).map(item => item.line), [20, 30], '读出那一步全局去重（`RecentLocationsDataModel.kt:95`）')
  for (let line = 1; line <= PLACES_RING_LIMIT + 10; line++) ring.rememberPlace({ path: 'b/y.ts', line, edited: false })
  assert.equal(PLACES_RING_LIMIT, 150, '上限取注册表默认值 150（registry.properties:494）')
  assert.equal(ring.places.value.length, PLACES_RING_LIMIT, `超上限从表尾摘（上游 removeFirst，方向镜像）`)
  assert.equal(ring.places.value[0].line, PLACES_RING_LIMIT + 10, '最新在前')
})

test('未保存缓冲闸门：目录连子树、文件只算自己', () => {
  const tabs = [
    { path: 'src/a.ts', dirty: true },
    { path: 'src/nested/b.ts', dirty: true },
    { path: 'src/nested/c.ts', dirty: false },
    { path: 'other/d.ts', dirty: true },
  ]
  assert.deepEqual(affectedDirtyTabs(tabs, 'src/nested', true).map(tab => tab.path), ['src/nested/b.ts'],
    '目录档：落在该路径之下且真的脏')
  assert.deepEqual(affectedDirtyTabs(tabs, 'src/a.ts', false).map(tab => tab.path), ['src/a.ts'],
    '文件档：只等于该路径')
  assert.deepEqual(affectedDirtyTabs(tabs, 'src/nested/c.ts', false), [],
    '没改动的文件不进闸门')
  assert.deepEqual(affectedDirtyTabs(tabs, 'src/nested', false).map(tab => tab.path), [],
    '按文件判时子树不算（同一条规则的两个分支互不串）')
})

test('链接的工作区归属：盘符与斜杠开头才算绝对路径，大小写不敏感地剥前缀', () => {
  assert.deepEqual(linkPathWithinWorkspace('D:/work/proj', 'src/a.ts'), { kind: 'relative', path: 'src/a.ts' })
  assert.deepEqual(linkPathWithinWorkspace('D:/work/proj', 'D:/work/proj/src/a.ts'),
    { kind: 'inside', path: 'src/a.ts' }, '盘符形式剥掉根前缀')
  assert.deepEqual(linkPathWithinWorkspace('d:/WORK/proj', 'D:/work/proj/a.ts'),
    { kind: 'inside', path: 'a.ts' }, '大小写不敏感')
  assert.deepEqual(linkPathWithinWorkspace('/srv/proj', '/srv/proj/a.ts#L3'),
    { kind: 'inside', path: 'a.ts#L3' }, '斜杠开头同样处理')
  assert.deepEqual(linkPathWithinWorkspace('/srv/proj', '/srv/other/a.ts'),
    { kind: 'outside', shown: '/srv/other/a.ts' }, '工作区外：如实报原文，不猜路径')
  assert.deepEqual(linkPathWithinWorkspace('', 'D:/x/a.ts'), { kind: 'relative', path: 'D:/x/a.ts' },
    '没有工作区根 ⇒ 不做归属判定（与原来 root 为 falsy 时一致）')
})

test('保存失败三档：CONFLICT 摆选择框、READ_ONLY 标只读、其余照原样提示', () => {
  const conflict = saveFailureFor('CONFLICT', 'src/a.ts', '别的话')
  assert.equal(conflict.conflict, true)
  assert.equal(conflict.readOnly, false)
  assert.match(conflict.message, /在磁盘上已被外部修改/)
  const readOnly = saveFailureFor('READ_ONLY', 'src/a.ts', '别的话')
  assert.equal(readOnly.readOnly, true)
  assert.match(readOnly.message, /文件属性 → 切换只读/)
  const other = saveFailureFor('OTHER', 'src/a.ts', '就是这句')
  assert.equal(other.message, '就是这句', '兜底沿用 errorMessage(error)')
  assert.equal(other.conflict, false)
  assert.equal(other.readOnly, false)
  assert.equal(saveFailureFor(null, 'src/a.ts', '网络断了').message, '网络断了', '不是桥接错误也走兜底')
})

test('git 变更查表：仓库相对路径与编辑器绝对路径同一口径', () => {
  const changes = [{ path: 'src/a.ts', status: 'M' }, { path: 'src\\b.ts', status: 'A' }]
  assert.equal(findGitChange('D:/work/proj', 'D:/work/proj/src/a.ts', changes), changes[0],
    '编辑器路径是绝对路径时也认得')
  assert.equal(findGitChange('D:/work/proj', 'src/b.ts', changes), changes[1],
    '反斜杠的仓库路径同样命中')
  assert.equal(findGitChange('D:/work/proj', 'src/c.ts', changes), undefined, '表里没有就是 undefined')
})

test('导出主题：三个令牌名与兜底规则照抄', () => {
  const values = { '--panel': ' rgb(1, 2, 3) ', '--text': '', '--font-mono': ' "Moria, monospace" ' }
  const style = { getPropertyValue: name => values[name] ?? '' }
  const theme = readExportThemeTokens(style, 15)
  assert.equal(theme.background, 'rgb(1, 2, 3)', 'trim 之后非空才用令牌值')
  assert.equal(theme.foreground, '#000000', '令牌空 ⇒ 兜底')
  assert.equal(theme.fontFamily, '"Moria, monospace"', '等宽字体取令牌原样')
  assert.equal(theme.fontSize, 15, '字号由调用方传（这里不读响应式状态）')
})

// —— 接线（本轮新落的用户可见链路）——

test('接线：保存时的两条 pass 排在 Actions on Save 之后、file.write 之前', () => {
  const saveStart = app.indexOf('async function save(tab = active.value)')
  assert.ok(saveStart >= 0, '找不到 save()')
  const body = app.slice(saveStart, app.indexOf('\n}', saveStart) + 2)
  const actions = body.indexOf('await runActionsOnSave(')
  const pass = body.indexOf('await transformOnSave(tab, content)')
  const write = body.indexOf("'file.write'")
  assert.ok(actions >= 0 && pass >= 0 && write >= 0, '三段都要在 save() 里')
  assert.ok(actions < pass && pass < write, '顺序：Actions on Save → 保存前 pass → 落盘')
  assert.match(body, /if \(savePass\.changed\) \{ content = savePass\.text/, 'pass 改过的正文要落进同一次写入')
  assert.match(body, /editorFor\(tab\.path\)\?\.setDraft\(content\)/, '编辑器正文跟着换（屏幕上与磁盘一致）')
  assert.match(body, /savePassNote \? ` · \$\{savePassNote\}` : ''/, '提示里带上这一趟做了什么，没做就不加尾缀')
})

test('接线：打开的编辑器表由宿主登记（跨文件词补全的完整性）', () => {
  assert.match(app, /registerOpenEditor\(path, \(\) => \(element as EditorHandle\)\.text\(\)\)/,
    '挂上句柄时登记取实时正文的 thunk')
  assert.match(app, /function forgetEditorRefs\(path: string\) \{.*unregisterOpenEditor\(path\)/,
    '关标签时注销（否则 Alt+/ 会读到已关闭的文档）')
  assert.match(app, /function closeAllPanes\(\) \{\s*\n\s*clearOpenEditors\(\)/,
    '换工程 / 关工作区时整张表清空')
})

test('接线：应用内文件选择器的「最近」用真数据，收藏没有数据源就不画', () => {
  assert.match(app, /recent: \(\) => filenameRecentRows\.value\.map\(row => row\.path\)/,
    '「最近」= 文件名部件同一份编辑器历史（口径：工作区相对路径）')
  assert.match(app, /favorites: \(\) => \[\]/, '本仓没有收藏数据源 ⇒ 空（那一栏整栏不画）')
  assert.match(app, /:recent="chooser\.recent\(\)" :favorites="chooser\.favorites\(\)"/,
    '模板读的是宿主那两份，而不是写死的空数组')
})
