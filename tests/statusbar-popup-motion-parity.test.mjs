// 状态栏 / 弹层 / 主题动效 三个域的收口判据。
//
// 这一组只钉**可数的事实**，判据全部指向上游源码行（platform/platform-impl/.../status/ 与
// platform/external-system-impl/.../ExternalSystemTaskProgressIndicatorUpdater.kt），不碰像素：
//
//   1. 注册表里没有「勾了不生效」的死条目（铁律：状态栏 widget 必须真消费）。KNOWN_GAPS 现为空 =
//      本域没有已知的死条目（`bridge` 那一条 2026-10-06 桶 status2 已从注册表删除，判定见
//      `src/statusWidgets.ts` 表头）；新增死条目会当场红，而不是等用户点出空按钮。
//   1b.（2026-10-06 lane statusclose 补）**反方向**：模板里的每个 `showWidget('<id>')` 挂点都必须有注册表行，
//      并且未登记的 id 在 `findWidgetFactory`/`showWidget`/`widgetChecked`/`widgetClickable`/`toggleWidget`
//      五个口上都是"没有这条状态"（默认拒绝 + 不污染存档）——这一侧失效是静默的：组件永远不出现，
//      右键清单也列不出来，编译与测试都不会红，所以必须显式钉。
//   2. 不可点的组件确实不可点：`VfsRefreshIndicatorWidgetFactory` 的组件是 `setEnabled(false)`
//      的 JLabel（`:106`），所以本仓落成只读 span；反过来，可点的条目都带真动作。
//   3. 主题水纹（`startViewTransition` + clip-path 揭示）认**两道**降级闸：系统
//      `prefers-reduced-motion` 与应用内省电模式 `html[data-motion='reduced']`。
//      只看前一道，"用户在设置里开了省电"这条路就漏了 —— 而 style.css 的全局降级
//      （`html[data-motion='reduced'] *`）**不含** `::view-transition-*` 伪元素，得单独点名。
//   4. 浮层家族的阴影走 `--popup-shadow` 令牌（换主题时跟着换），不写死 rgba。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATUS_WIDGETS, findWidgetFactory, showWidget, widgetChecked, widgetClickable, widgetOverrides, toggleWidget } from '../src/statusWidgets.ts'
import { themeRipple } from '../src/themeRipple.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
/** 取出含 `needle` 的所有行拼起来 —— 整份 style.css 有 1400 多行，整文当断言消息会把日志淹掉。 */
const linesWith = (file, needle) => read(file).split('\n').filter(line => line.includes(needle)).join('\n')
const lineOf = (file, needle) => read(file).split('\n').find(line => line.includes(needle)) ?? ''

/**
 * 状态栏模板里**没有** `showWidget(...)` 的条目。每一项都要写清为什么。
 * 空数组 = 全仓没有死控件；新增死控件时把这个数组撑大 = 门禁放行，必须先补上理由。
 *
 * 2026-10-06 桶 status2：这里原本钉着一处 `bridge`（勾选清单里有、模板不消费 = 假控件）。
 * 判定过程与两处同批改法记在 `src/statusWidgets.ts` 的表头（本仓侧：`App.vue` 消费的 16 个 id 不含它；
 * 上游侧：`statusBarWidgetFactory` 的全部注册处都没有"桥接状态"）⇒ 条目已从注册表删除，
 * 这一份登记随之清空。**断言体一字未动**：`:40-49` 那条既不许新增死条目，也不许留过期的 gap。
 */
const KNOWN_GAPS = new Map()

test('注册表里没有新的死条目：每个 id 都被状态栏模板真正消费', () => {
  const template = read('src/App.vue')
  const consumed = new Set([...template.matchAll(/showWidget\('([A-Za-z]+)'\)/g)].map(match => match[1]))
  assert.ok(consumed.size >= 15, `模板里解析到的 showWidget 调用只有 ${consumed.size} 个，判据本身失效了`)
  for (const widget of STATUS_WIDGETS) {
    if (consumed.has(widget.id)) continue
    assert.ok(KNOWN_GAPS.has(widget.id),
      `${widget.id} 在勾选清单里但状态栏模板不消费它 —— 那是点了没反应的假控件。`
      + '要么接上真动作，要么从 STATUS_WIDGETS 删掉；要留就写进 KNOWN_GAPS 并说明理由。')
  }
  // KNOWN_GAPS 也不能过期：条目被接上（或删掉）后，这里的理由就该撤掉。
  for (const id of KNOWN_GAPS.keys()) {
    assert.ok(!consumed.has(id) && STATUS_WIDGETS.some(widget => widget.id === id),
      `KNOWN_GAPS 里的 ${id} 已经不再是死条目（要么接上了，要么从注册表删了）—— 把它从 KNOWN_GAPS 移除`)
  }
})

// 2026-10-06 lane statusclose 补：上一条只钉**正向**（注册表的每条都得被模板消费），
// 反方向当时没人管 —— 而这一侧失效是**静默**的，比假控件更难发现：
//   · `src/statusWidgets.ts:180-184` 的 `showWidget(id)` 是默认拒绝（`BY_ID.get(id)` 认不出就 `return false`），
//     所以「模板里写了 `showWidget('新组件')`、注册表忘了加那一行」不抛错、不红编译，
//     只让那颗组件**永远不出现**，右键勾选清单里也列不出来（`listWidgets()` 遍历的是注册表）；
//   · 上游的对应关系是"工厂注册 = 组件存在"
//     （`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1618-1644` 十五条 `statusBarWidgetFactory`，
//     `StatusBarWidgetsManager` 按 EP 列表建组件），本仓的注册表就是那份 EP 清单
//     ⇒ 挂点而没有清单行 = 一个连上游都对不上的名字。
// ⇒ 这里钉两件：① 模板解析到的每个 id 都在注册表里（子集判据，不是数量对比）；
//   ② 认不出的 id 在四个读写口上都是"没有这条状态"（默认拒绝不许被改成默认放行，也不许污染存档）。
test('反向奇偶：模板里的每个 showWidget 挂点都必须在注册表里（漏登记 = 永远画不出来）', () => {
  const template = read('src/App.vue')
  const consumed = [...new Set([...template.matchAll(/showWidget\('([A-Za-z]+)'\)/g)].map(match => match[1]))]
  const registered = STATUS_WIDGETS.map(widget => widget.id)
  const unregistered = consumed.filter(id => !registered.includes(id))
  assert.deepEqual(unregistered, [],
    `状态栏模板里有 ${unregistered.length} 个挂点没在 STATUS_WIDGETS 登记：${unregistered.join(', ')} —— `
    + 'showWidget 对认不出的 id 返回 false，用户看不见也关不掉，右键清单里也不会出现这一行。')
  // 判据自身不许失效：解析必须真的解析到东西（模板那一段被写成正则不认的形状时，上面那条会空转通过）。
  assert.ok(consumed.length >= 15, `只解析到 ${consumed.length} 个 showWidget 挂点，判据本身失效了`)
  assert.equal(consumed.filter(id => registered.includes(id)).length, consumed.length,
    '子集判据与这份计数自相矛盾（解析结果被动过？）')

  // ② 默认拒绝的四道读写口：认不出的 id 一律"没有这条状态"。
  const ghost = 'notARegisteredWidgetId'
  assert.equal(findWidgetFactory(ghost), undefined, '反查必须认不出未登记的 id')
  assert.equal(showWidget(ghost), false, '未登记的 id 不得画（默认拒绝）')
  assert.equal(widgetChecked(ghost), false, '未登记的 id 不得凭空有勾选态')
  assert.equal(widgetClickable(ghost, true), false, '未登记的 id 不得出现在可点状态里')
  // `toggleWidget` 对未登记的 id 必须当场返回（`src/statusWidgets.ts:207-212` 的 `if (!widget) return`），
  // 既不写覆盖表也不落存档 —— 否则会给一个不存在的组件留下持久化残留键。
  const before = JSON.stringify(widgetOverrides.value)
  toggleWidget(ghost)
  assert.equal(JSON.stringify(widgetOverrides.value), before,
    '未登记的 id 不该往持久化覆盖里写任何东西')
})

test('不可点的组件不可点，可点的组件有真动作：两边都照上游那句判据', () => {
  const template = read('src/App.vue')
  // 上游 `VfsRefreshIndicatorWidgetFactory` 的组件是 `setEnabled(false)` 的 JLabel（`:106`），
  // 类本身 `@ApiStatus.Internal`（`:27`）—— 本仓落成只读 span，不给它假按钮。
  const vfs = template.match(/<span v-if="showWidget\('vfsRefresh'\)"[^>]*>/)
  assert.ok(vfs, 'vfsRefresh 应当是个 span')
  assert.ok(!vfs[0].includes('@click'), '上游那个 JLabel 是 setEnabled(false) 的，不该给它点击动作')
  // 行列模式 / 内存 / 通知 / 编码 / 缩进这些上游给的是可点组件，本仓必须各有一个真动作。
  for (const [id, action] of [
    ['column', 'toggleColumnModeFromStatusBar'],
    ['memory', 'refreshMemory'],
    ['notices', 'noticeOpen'],
    ['encoding', 'openEncoding'],
    ['indent', 'openSettings'],
    ['powerSave', 'togglePowerSave'],
    ['file', 'openSelectIn'],
    ['branch', 'showView(\'git\')'],
  ]) {
    const tag = template.match(new RegExp(`<(button|span)[^>]*showWidget\\('${id}'\\)[^>]*>`))
    assert.ok(tag, `${id} 在状态栏模板里找不到挂点`)
    assert.ok(tag[0].includes(`@click`) && tag[0].includes(action),
      `${id} 没有真动作（期望 @click 里有 ${action}）—— 那是点了没反应的假控件`)
  }
})

function mockDom(t, { reduced = false, motion = undefined } = {}) {
  const properties = new Map()
  const classes = new Set()
  const root = { dataset: { theme: 'light', ...(motion === undefined ? {} : { motion }) },
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
    classList: { add: key => classes.add(key), remove: key => classes.delete(key) } }
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const document = { documentElement: root }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 1000, innerHeight: 800,
    matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reduced } } } })
  t.after(() => {
    for (const [key, descriptor] of [['document', originalDocument], ['window', originalWindow]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { document, properties, classes }
}

test('省电模式（html[data-motion=reduced]）下主题水纹不启动 —— 应用内开关与系统偏好同一条语义', t => {
  const { document, properties, classes } = mockDom(t, { motion: 'reduced' })
  document.startViewTransition = () => assert.fail('省电模式不得启动主题过渡')
  let applied = 0
  assert.equal(themeRipple(null, 'dark', () => applied++), false, '省电模式下应立即应用主题')
  assert.equal(applied, 1)
  assert.equal(properties.size, 0, '不得留下揭示用的自定义属性')
  assert.equal(classes.size, 0, '不得挂上 theme-transition')
  // 属性是 appearanceActions.ts 写的那一个，值只有 reduced / full 两档。
  assert.match(lineOf('src/appearanceActions.ts', 'dataset.motion'), /dataset\.motion = powerSave \? 'reduced' : 'full'/)
})

test('两道闸都关着时水纹照常跑：省电之外不误伤', async t => {
  const { document, classes } = mockDom(t, { motion: 'full' })
  let update, finish
  document.startViewTransition = callback => {
    update = callback
    return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(),
      finished: new Promise(resolve => { finish = resolve }), skipTransition() {} }
  }
  let applied = 0
  assert.equal(themeRipple(null, 'dark', () => applied++), true)
  assert.ok(classes.has('theme-transition'))
  await update()
  assert.equal(applied, 1)
  finish()
})

test('CSS 侧也要点名 ::view-transition-new：全局降级的 * 覆盖不到这组伪元素', () => {
  // 全局降级只覆盖元素与 *::before/::after。
  assert.match(linesWith('src/style.css', "*::before, html[data-motion='reduced'] *::after"),
    /animation:\s*none\s*!important/)
  // 水纹自己的动画必须被单独关掉；`html` 就是 `:root`，`.theme-transition` 挂在它身上，
  // 所以是同一个元素 —— 写成后代选择器（`html … :root`）会永远不匹配。
  assert.match(linesWith('src/style.css', "html[data-motion='reduced'].theme-transition::view-transition-new"),
    /animation:\s*none/)
  assert.ok(!/html\[data-motion='reduced'\]\s+:root/.test(read('src/style.css')),
    '水纹的降级选择器写成了后代关系，永远匹配不上')
  // 揭示动画的时长仍走令牌。
  assert.match(lineOf('src/style.css', 'animation: theme-reveal'), /animation:\s*theme-reveal var\(--dur-theme-reveal\) var\(--ease\) both/)
})

test('浮层家族的阴影走令牌：status/popup 域不留裸 rgba 阴影', () => {
  for (const selector of ['.status-widget-menu', '.status-toolwindows-popup', '.status-progress-list',
    '.output-tabs-more-menu', '.content-combo-menu', '.select-in', '.choose-target', '.quick-definition']) {
    const rule = lineOf('src/style.css', `${selector} {`)
    assert.ok(rule, `${selector} 的规则没找到，判据本身失效了`)
    assert.match(rule, /box-shadow:\s*var\(--popup-shadow\)/, `${selector} 的阴影没走 --popup-shadow 令牌`)
    assert.ok(!/rgba\(/.test(rule), `${selector} 还留着裸 rgba —— 换主题时它不跟着换`)
  }
  // 令牌本身两档都有值（亮面/暗面），不是只有一个方向的空壳。
  assert.match(lineOf('src/tokens.css', '--popup-shadow:'), /--popup-shadow:\s*var\(--m-menu-shadow\)/)
  assert.equal(read('src/tokens.css').split('\n').filter(line => /--m-menu-shadow:\s/.test(line)).length, 2,
    '--m-menu-shadow 应当亮面暗面各一份')
})

test('状态栏度量仍是令牌，且依据是上游那四行', () => {
  assert.match(lineOf('src/tokens.css', '--statusbar-height'), /--statusbar-height:\s*22px/)
  // 顶边框 1px + max(minIconHeight=scale(18+1+1)=20, 文本高) ⇒ 默认缩放下 22px。
  const cited = lineOf('src/tokens.css', 'IdeStatusBarImpl.kt:266') + lineOf('src/style.css', 'IdeStatusBarImpl.kt:266')
  assert.match(cited, /IdeStatusBarImpl\.kt:266\/:169-170\/:803\/:351/)
  // 左右各 10px 内容区内缩（IdeStatusBarImpl.kt:269 `JBUI.Borders.empty(0, 10)`）。
  assert.match(lineOf('src/style.css', '.statusbar {'), /padding:\s*0 10px/)
})
