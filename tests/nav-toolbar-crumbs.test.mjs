// 面包屑呈现与扩展面（`src/navToolbarCrumbs.ts`）：四个 `EditorColors.BREADCRUMBS_*` 档的
// 判定顺序、`BreadcrumbsPresentationProvider` 的按位对齐、`LazyTooltipCrumb` 的懒算协议、
// `BreadcrumbsProvider` 的按语言注册面、`BreadcrumbsForceShownSettings` 的三态。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CRUMB_TOKEN_CLASS, crumbColor, crumbColorKey, crumbColorKeys, crumbStates, createLazyTooltipCrumb,
  defaultCrumbPresentation, forcedShown, providerAcceptsSticky, providersForLanguage, resolveCrumbPresentations,
  setForcedShown, showByDefaultOf,
} from '../src/navToolbarCrumbs.ts'

const state = (selected, hovered, light, navigation = false) => ({ selected, hovered, light, navigation })

test('背景档位：hovered > selected > (light && !navigation) > default（:639-648 的顺序）', () => {
  assert.equal(crumbColorKey(state(false, true, false)), 'BREADCRUMBS_HOVERED', 'hovered 压过一切')
  assert.equal(crumbColorKey(state(true, true, false)), 'BREADCRUMBS_HOVERED', 'hovered 压过 selected')
  assert.equal(crumbColorKey(state(true, false, false)), 'BREADCRUMBS_CURRENT')
  assert.equal(crumbColorKey(state(false, false, true)), 'BREADCRUMBS_INACTIVE')
  assert.equal(crumbColorKey(state(false, false, false)), 'BREADCRUMBS_DEFAULT')
})

test('navigation 只影响 INACTIVE 那一档：导航段在 light 态落回 DEFAULT（:645 的 && !navigationCrumb）', () => {
  assert.equal(crumbColorKey(state(false, false, true, true)), 'BREADCRUMBS_DEFAULT')
  // hovered/selected 两档不受 navigation 影响。
  assert.equal(crumbColorKey(state(true, false, true, true)), 'BREADCRUMBS_CURRENT')
  assert.equal(crumbColorKey(state(false, true, true, true)), 'BREADCRUMBS_HOVERED')
})

test('令牌名是本仓映射（不落 hex），四个键都有对应 class', () => {
  assert.deepEqual(Object.keys(CRUMB_TOKEN_CLASS).sort(), [
    'BREADCRUMBS_CURRENT', 'BREADCRUMBS_DEFAULT', 'BREADCRUMBS_HOVERED', 'BREADCRUMBS_INACTIVE',
  ])
  for (const value of Object.values(CRUMB_TOKEN_CLASS)) assert.match(value, /^crumb-bg-[a-z]+$/)
  for (const value of Object.values(CRUMB_TOKEN_CLASS)) assert.doesNotMatch(value, /#/, '禁裸 hex')
})

test('DefaultCrumbsPresentation 永远把 navigationCrumb 当 false（DefaultCrumbsPresentation.java:23）', () => {
  // 传进来的三态里没有 navigation —— 自定义呈现拿不到 NavigationCrumb 那个区分。
  assert.equal(defaultCrumbPresentation.background(false, false, true), 'BREADCRUMBS_INACTIVE')
  assert.equal(defaultCrumbPresentation.background(true, false, true), 'BREADCRUMBS_CURRENT')
  assert.equal(defaultCrumbPresentation.background(false, true, true), 'BREADCRUMBS_HOVERED')
  // 而走默认分流（无自定义呈现）时 navigation 是生效的。
  assert.equal(crumbColor(null, state(false, false, true, true)), 'BREADCRUMBS_DEFAULT')
})

test('自定义呈现优先于默认分流（ButtonSettings.getBackgroundColor(c) 的 :655-658）', () => {
  const custom = { background: (selected, hovered) => (hovered ? 'BREADCRUMBS_HOVERED' : selected ? 'BREADCRUMBS_CURRENT' : 'BREADCRUMBS_INACTIVE') }
  assert.equal(crumbColor(custom, state(false, false, true)), 'BREADCRUMBS_INACTIVE', '自定义说了算')
  assert.equal(crumbColor(null, state(false, false, true)), 'BREADCRUMBS_INACTIVE', '没自定义才走默认')
})

test('provider 的呈现按位对齐，后面的只能填空位（:27 的数组语义）', () => {
  const crumbs = [{ text: 'a', key: 'k0' }, { text: 'b', key: 'k1' }, { text: 'c', key: 'k2' }]
  const custom = { background: () => 'BREADCRUMBS_CURRENT' }
  const first = { presentations: () => [custom, null] }
  const second = { presentations: () => [null, custom, custom] }
  const resolved = resolveCrumbPresentations([first, second], crumbs)
  assert.equal(resolved.length, 3, '与传入的段数对齐')
  assert.equal(resolved[0], custom)
  assert.equal(resolved[1], custom, '第一个 provider 留空的格子由第二个填')
  assert.equal(resolved[2], custom)

  // 没人贡献 ⇒ 每一格都是 null（走默认）。
  assert.deepEqual(resolveCrumbPresentations([], crumbs), [null, null, null])
  // provider 给的数组比段数短 ⇒ 缺的格子留 null，不越界。
  const short = { presentations: () => [custom] }
  assert.deepEqual(resolveCrumbPresentations([short], crumbs).map(entry => entry === custom), [true, false, false])
})

test('LazyTooltipCrumb：第一次之前要算，算过非取消的之后不再算（:10-14）', () => {
  let calls = 0
  const crumb = createLazyTooltipCrumb(() => { calls += 1; return 'com.demo.Foo#bar' })
  assert.equal(crumb.needCalculateTooltip(), true, '还没取过 ⇒ 需要后台算')
  assert.equal(crumb.tooltip(), 'com.demo.Foo#bar')
  assert.equal(calls, 1)
  assert.equal(crumb.needCalculateTooltip(), false, '算过一次就不再往后推')
})

test('LazyTooltipCrumb：取到 null 视作「取消」，不置位，下次仍可算', () => {
  const crumb = createLazyTooltipCrumb(() => null)
  assert.equal(crumb.needCalculateTooltip(), true)
  assert.equal(crumb.tooltip(), null)
  assert.equal(crumb.needCalculateTooltip(), true, '取消的调用不算数（:12-13 只认非取消的）')
})

// ——— BreadcrumbsProvider 的按语言注册面 ———

const provider = (name, languages, extra = {}) => ({
  name, languages, accept: () => true, info: crumb => crumb.text, ...extra,
})

test('按语言筛 provider：EP 顺序 = 注入顺序', () => {
  const providers = [provider('java', ['java']), provider('kotlin', ['kotlin']), provider('polyglot', ['java', 'kotlin'])]
  assert.deepEqual(providersForLanguage(providers, 'java').map(entry => entry.name), ['java', 'polyglot'])
  assert.deepEqual(providersForLanguage(providers, 'kotlin').map(entry => entry.name), ['kotlin', 'polyglot'])
  assert.deepEqual(providersForLanguage(providers, 'rust'), [], '没人负责的语言 ⇒ 空表')
})

test('默认显示：「全票通过才算开」是本仓的映射，上游没有这条合成规则', () => {
  const on = provider('java', ['java'])
  const off = provider('kotlin', ['kotlin'], { shownByDefault: false })
  const providers = [on, off]
  assert.equal(showByDefaultOf(providers, 'java'), true, 'isShownByDefault 的 default 是 true（:92-94）')
  assert.equal(showByDefaultOf(providers, 'kotlin'), false, '设了 false 就得在设置里打开')
  assert.equal(showByDefaultOf(providers, 'rust'), false, '没有 provider ⇒ 那一语言没有面包屑')
  assert.equal(showByDefaultOf([provider('a', ['java']), provider('b', ['java'], { shownByDefault: false })], 'java'), false,
    '多条里只要有一条默认关，这一语言就默认关（本仓映射，不是上游规则）')
  // 别的语言那条显式关掉，不影响本语言。
  assert.equal(showByDefaultOf([on, provider('x', ['rust'], { shownByDefault: false })], 'java'), true,
    '按语言筛过之后才谈默认值')
})

test('acceptStickyElement 的 default 委托 acceptElement（:100-102）', () => {
  const only = provider('java', ['java'], { accept: crumb => crumb.key === 'k1' })
  assert.equal(providerAcceptsSticky(only, { text: 'x', key: 'k1' }), true)
  assert.equal(providerAcceptsSticky(only, { text: 'x', key: 'k2' }), false)
})

// ——— 段状态（NavBarVmImpl.kt:211-213 / BreadcrumbsComponent.java:199-228）———

test('段状态：选中段之后才是 light，选中段之前与没选中时都是 DEFAULT', () => {
  const states = crumbStates(4, 2)
  assert.deepEqual(states.map(one => one.selected), [false, false, true, false])
  assert.deepEqual(states.map(one => one.light), [false, false, false, true], '选中段之后才是 inactive')
  assert.deepEqual(crumbColorKeys(states), [
    'BREADCRUMBS_DEFAULT', 'BREADCRUMBS_DEFAULT', 'BREADCRUMBS_CURRENT', 'BREADCRUMBS_INACTIVE',
  ])
  assert.deepEqual(crumbColorKeys(crumbStates(3, -1)).map(() => 'x'), ['x', 'x', 'x'], '没选中时没有一段是 light')
  assert.deepEqual(crumbColorKeys(crumbStates(3, -1)), ['BREADCRUMBS_DEFAULT', 'BREADCRUMBS_DEFAULT', 'BREADCRUMBS_DEFAULT'])
})

test('段状态：hovered 压过 selected（NavBarItemComponent.kt:146-153 的鼠标进出）', () => {
  const states = crumbStates(3, 1, 2)
  assert.equal(states[2].hovered, true)
  assert.deepEqual(crumbColorKeys(states), ['BREADCRUMBS_DEFAULT', 'BREADCRUMBS_CURRENT', 'BREADCRUMBS_HOVERED'])
})

test('段状态：navigation 只由调用方给，批量取档时按段透传', () => {
  const states = crumbStates(2, 0, -1, true)
  assert.deepEqual(crumbColorKeys(states), ['BREADCRUMBS_CURRENT', 'BREADCRUMBS_DEFAULT'])
  const mixed = [states[0], { ...states[1], navigation: false }]
  assert.deepEqual(crumbColorKeys(mixed), ['BREADCRUMBS_CURRENT', 'BREADCRUMBS_INACTIVE'])
})

test('批量取档：有自定义呈现的那一格走呈现，其余走默认分流', () => {
  const states = crumbStates(3, 0)
  const custom = { background: () => 'BREADCRUMBS_HOVERED' }
  assert.deepEqual(crumbColorKeys(states, [null, custom]), [
    'BREADCRUMBS_CURRENT', 'BREADCRUMBS_HOVERED', 'BREADCRUMBS_INACTIVE',
  ])
  assert.deepEqual(crumbColorKeys(states, [null]), ['BREADCRUMBS_CURRENT', 'BREADCRUMBS_INACTIVE', 'BREADCRUMBS_INACTIVE'])
})

// ——— BreadcrumbsForceShownSettings ———

test('强制显示是三态：没设 = null', () => {
  assert.equal(forcedShown({}, 'a.ts'), null)
  const store = {}
  assert.equal(setForcedShown(store, 'a.ts', null), false, '设成 null 与原值相同 ⇒ 没变化')
  assert.equal(setForcedShown(store, 'a.ts', true), true, 'null → true 是变化')
  assert.equal(forcedShown(store, 'a.ts'), true)
  assert.equal(setForcedShown(store, 'a.ts', true), false, 'true → true 没变化')
  assert.equal(setForcedShown(store, 'a.ts', false), true, 'true → false 是变化')
  assert.equal(forcedShown(store, 'a.ts'), false)
})

test('设成 null 是「摘掉这个键」，不是存一个 null（putUserData(key, null)）', () => {
  const store = { 'a.ts': true }
  assert.equal(setForcedShown(store, 'a.ts', null), true)
  assert.equal('a.ts' in store, false, '键被删掉了')
  assert.equal(forcedShown(store, 'a.ts'), null, '读回来仍是三态的 null')
})
