// nav3 一批落在 `src/lspNavigation.ts` 的那几件用户可见行为：
//   ① 导航栈（上一步 / 下一步）的上限与「每一格记住自己那一栏」；
//   ② 跳转落点 = 记住的那一栏（规则本体在 `src/editorGroups.ts` 的 `jumpTargetPane`，行为判据见
//      `tests/editor-groups.test.mjs` 的那四条）；
//   ③ 「下一步」跳过栈顶就是当前位置的那些；
//   ④ 「最近位置」弹层读出的那条列表走 `recentPlacesList`（25 条上限 + 全局去重，行为判据在
//      `tests/recent-places-ring.test.mjs`）。
// 这里钉的是**接线**：模块里真的调了规则层、真的带了 `pane`、上限真的是注册表默认值。
//
// 上游依据（2026-10-06 逐行开参考树自数核对）：
//   · 栈上限 = 注册表 `editor.navigation.history.stack.size` 默认值 150：
//     `platform/util/resources/misc/registry.properties:494`，读它的是
//     `platform/platform-impl/src/com/intellij/openapi/fileEditor/impl/IdeDocumentHistoryImpl.kt:76-77`；
//     正向栈没有上限（`back()` 只做 `forwardPlaces.add(current)`，同文件 `:427-430`）⇒ 只截 Back 那一侧。
//   · 每一格记着自己的窗口：同文件 `:685-694`（`window: EditorWindow?` + `:694` 的 `WeakReference`）、
//     取用 `:712`、跳回去 `:572-579`（`openFile(window = …)`）。
//   · `getTargetForwardInfo()`：同文件 `:454-473` —— 栈顶与当前位置是同一格就继续往下找。
//   · 弹层读出去重 + 上限 25：`platform/platform-impl/src/com/intellij/ide/actions/RecentLocationsDataModel.kt:83-104`
//     （`:91` 取 `UISettings.recentLocationsLimit` = `platform/editor-ui-api/src/com/intellij/ide/ui/UISettingsState.kt:57` 的 25）。
// 本文件一律纯 JavaScript（规约 §4.2）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const nav = read('src/lspNavigation.ts')

test('① 导航栈上限 = 注册表默认值 150，而且只截 Back 那一侧', () => {
  assert.match(nav, /const NAV_BACK_LIMIT = 150/, '上限取自 registry.properties:494 的默认值，不是原来的 100')
  assert.doesNotMatch(nav, /navBack\.value\.length > 100/, '搬走前的 100 已经不在')
  assert.equal(nav.match(/navForward\.value\.length >/g)?.length ?? 0, 0,
    '正向栈不截（上游 :427-430 的 forwardPlaces.add 没有上限）')
  assert.equal(nav.match(/if \(navBack\.value\.length > NAV_BACK_LIMIT\)/g).length, 2,
    '两处入栈都截：新导航（revealLocation）与「下一步」回填（goForward）')
})

test('② 栈里每一格与环里每一格都带着自己那一栏', () => {
  assert.match(nav, /export interface NavSpot \{ path: string; line: number; pane: PaneGroup<Tab> \| null \}/,
    '导航栈的一格 = 位置 + 分栏对象（上游 PlaceInfo 的 window）')
  assert.match(nav, /edited\?: boolean; pane\?: PaneGroup<Tab> \| null \}/, '最近位置的一格同样带 window')
  assert.match(nav, /navBack\.value\.push\(currentNavSpot\(\)\)/, '入栈的是带栏的当前落点')
  assert.match(nav, /navForward\.value\.push\(currentNavSpot\(\)\)/, '「上一步」把当前位置压进正向栈时也带栏')
  assert.match(nav, /pane: groups\[splitModel\.focused\] as PaneGroup<Tab> \| null/, '当前落点的栏 = 焦点栏那个对象')
  assert.match(nav, /rememberPlace\(\{ kind: target\.kind \?\? '文件'.*pane: groups\[pane\] \}\)/,
    '跳到的那一栏就是这一格记下的那一栏')
})

test('② 跳转落点走 jumpTargetPane，记住的栏作为最后一个实参传进去', () => {
  assert.match(nav, /from '\.\/editorGroups\.ts'/, '值 import 必须带扩展名')
  assert.match(nav, /import \{ jumpTargetPane, type PaneGroup \} from '\.\/editorGroups\.ts'/)
  assert.match(nav, /const pane = jumpTargetPane\(splitModel, \(tab: Tab\) => tab\.path, target\.path, target\.pane \?\? null\)/,
    '已开的那一栏 > 记住的那一栏 > 当前栏（上游 :572-579 的 window 实参）')
  assert.doesNotMatch(nav, /groups\[0\]\.tabs\.some\(\(tab: any\) => tab\.path === target\.path\) \? 0 as const/,
    '原来那行只看下标的写法已经换掉')
  // 编辑那一条也要知道自己在哪一栏：`paneShowing` 找的是当前挂着这个文件的那一栏。
  assert.match(nav, /const editPane = paneShowing\(tab\.path\)/)
  assert.match(nav, /label: tab\.path, edited: true, pane: editPane \}\)/)
})

test('③ 「下一步」跳过栈顶就是当前位置的那几条（getTargetForwardInfo :454-473）', () => {
  assert.match(nav, /const here = currentNavSpot\(\)/, '先算当前位置，比较用它')
  assert.match(nav, /while \(to && navForward\.value\.length && to\.path === here\.path && to\.line === here\.line\) to = navForward\.value\.pop\(\)/,
    '上游 while 的两个条件都在：还要有货、且栈顶确实是「跳自己」才再 pop')
  assert.match(nav, /if \(!to\) return\n\s*navBack\.value\.push\(here\)/, '空栈就停，不 pop 到 undefined；回填用同一个 here')
})

test('④ 弹层那一条列表是 recentPlacesList 出来的，不是裸的环', () => {
  assert.match(nav, /import \{ recentPlacesList \} from '\.\/appPlacesRing\.ts'/)
  assert.match(nav, /const placesList = computed\(\(\) => recentPlacesList\(placesEditedOnly\.value \? changePlaces\.value : places\.value\)\)/,
    '两档各取自己的环，读出侧去做全局去重与 25 条上限（RecentLocationsDataModel.kt:83-104）')
  assert.match(nav, /placesList\.value\.filter\(place => place\.label\.toLowerCase\(\)\.includes\(query\)/,
    '查询词作用在已经截好的那 25 条之外层（ListWithFilter 套在模型外面，RecentLocationsAction.java:146）')
})
