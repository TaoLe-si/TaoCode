// trust5 的判据之二：候选浏览器表与上游 `browsers` 的**注册字段**对齐（缺键补默认那一半）。
//
// 上游那张表的持久形态是 `web-browsers.xml` 里 `<state>` 下的一串 `<browser>` 元素
// （`platform/platform-impl/src/com/intellij/ide/browsers/WebBrowserManager.java:35-38` 的
// `@State(name = "WebBrowsersConfiguration", storages = @Storage(value = "web-browsers.xml", roamingType = RoamingType.DISABLED))`）。
// **写出去**（`getState()` `:160-206`）与**读回来**（`loadState()` `:257-335`）是成对的：
// 上游把「等于默认值」的字段省掉不写，所以读回来必须按同一套缺省规则补，否则「省掉的字段」
// 在下一轮读盘时就成了坏行 —— 本仓以前只做了前一半（`path` 缺省读成 null、内置行不补），
// 2026-10-06 trust5 补齐后一半，判据就是下面这几条。
//
// 逐条坐标（基准树逐行打开过）：
//   · `path`：只在它不等于家族执行路径时才写（`:186-188`）⇒ 缺省补 `family.getExecutionPath()`（`:305-308`）；
//   · `active`：只在 false 时写（`:190-192`）⇒ 缺省 = 勾着（`:314`）；
//   · `family`：`'OPERA'` 老值映射 CHROME（`:210`）、枚举名对不上再按显示名比（`:215-219`）、
//     都对不上整行跳过（`:282-285`）；
//   · `id`：为空按家族补内置 id（`readId()` `:226-236`）、`UUID.fromString` 大小写不敏感（`:248`）、
//     同批重复的 id 跳过（`:238-243` "duplicated entry, skip"）、旧版 Edge 那一行直接丢（`:288` + `:49`）；
//   · `<settings>` 子元素（`:196-200`）：只有 `family.createBrowserSpecificSettings()` 非 null 的家族留
//     （`:293-296` + `BrowserFamily.java:18-27`/`:49-51`），可编辑性也由它决定（`BrowserSettingsPanel.kt:111-113`）；
//   · 整表等于内置表时一个 `<browser>` 都不写（`:178`）⇒ 读回来把缺的内置行补回表尾（`:318-332`）；
//   · 策略 `default` 只在非 SYSTEM 时写（`:162-164`），坏值被 catch 之后保持默认（`:259-275`）；
//   · 字段名 `additionalParameters` / `environmentVariables`（`BrowserSpecificSettings.java:14-20`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  familyOfRegistrationValue, normalizeBrowserSettings, PREDEFINED_BROWSER_IDS, PREDEFINED_OLD_EDGE_ID,
  predefinedBrowsers,
} from '../src/browsers.ts'

/** 只取这张表，省得每条断言都拖一遍策略键。 */
const rowsOf = (raw, os) => normalizeBrowserSettings(raw, os).browserList

test('家族字段能吃下的三种值：本仓 id / 上游枚举名 / OPERA 老值 / 显示名（readFamily :208-223）', () => {
  assert.equal(familyOfRegistrationValue('chrome'), 'chrome')
  assert.equal(familyOfRegistrationValue('CHROME'), 'chrome', '上游写的是枚举名（getState :183 的 family.name()）')
  assert.equal(familyOfRegistrationValue(' firefox '), 'firefox', '两头空白吃掉')
  assert.equal(familyOfRegistrationValue('OPERA'), 'chrome', '老档里的 OPERA 不是家族（:210）')
  assert.equal(familyOfRegistrationValue('opera'), 'chrome', '本仓存的是 lowercase id，两种都认')
  assert.equal(familyOfRegistrationValue('Internet Explorer'), 'explorer', '按家族显示名比一次（:215-219）')
  assert.equal(familyOfRegistrationValue('google chrome'), null, '显示名是 Chrome，不是 Google Chrome（IdeBundle.properties:27）')
  assert.equal(familyOfRegistrationValue('netscape'), null)
  assert.equal(familyOfRegistrationValue(null), null)
  assert.equal(familyOfRegistrationValue(7), null)
})

test('认不出家族的整行丢掉，别把坏行留在表里（loadState :282-285）', () => {
  const rows = rowsOf({ browserList: [
    { name: 'Good', family: 'firefox', path: 'C:/firefox.exe' },
    { name: 'Bad', family: 'netscape', path: 'C:/netscape.exe' },
    { name: '   ', family: 'chrome' },
    null, 42, 'x', [],
  ] })
  assert.deepEqual(rows.filter(row => row.name === 'Bad'), [], '坏家族不占行')
  assert.deepEqual(rows.filter(row => !row.name.trim()), [],
    'name 缺省**不**采上游那一手（:312 补 family.getName()）：本仓这张表按 name 寻址，补出一个与内置行同名的行会让查重失效')
  assert.equal(rows.filter(row => row.name === 'Good').length, 1)
})

test('path 缺省补家族执行路径（loadState :305-308），按平台分（BrowserFamily :53-63）', () => {
  const row = { name: 'My Chrome', family: 'chrome' }
  assert.equal(rowsOf({ browserList: [row] })[0].path, 'chrome', 'Windows 上补 windows 路径')
  assert.equal(rowsOf({ browserList: [row] }, 'linux')[0].path, 'google-chrome', 'Linux 上补 unix 路径')
  assert.equal(rowsOf({ browserList: [row] }, 'mac')[0].path, 'Google Chrome', 'mac 上补 mac 路径')
  // EXPLORER / SAFARI 的 unix 路径本来就是 null（BrowserFamily.java:28-29）⇒ 那一行是真的没路径。
  assert.equal(rowsOf({ browserList: [{ name: 'IE', family: 'explorer' }] }, 'linux')[0].path, null)
  // 显式写了路径：过一遍归一（反斜杠 → 正斜杠，`ConfigurableWebBrowser.setPath` :105-107）。
  assert.equal(rowsOf({ browserList: [{ name: 'X', family: 'chrome', path: 'C:\\x\\chrome.exe' }] })[0].path, 'C:/x/chrome.exe')
  // 空串 = 没写（`StringUtil.nullize` :305 把空串也归成「没有」）⇒ 同样补家族路径。
  assert.equal(rowsOf({ browserList: [{ name: 'Y', family: 'chrome', path: '  ' }] })[0].path, 'chrome')
})

test('active 缺省 = 勾着（:314），只有显式 false 才不勾（:190-192 只在 false 时写）', () => {
  const rows = rowsOf({ browserList: [{ name: 'A', family: 'chrome' }, { name: 'B', family: 'chrome', active: false }] })
  assert.equal(rows[0].active, true)
  assert.equal(rows[1].active, false)
})

test('id 三种形状：大小写都认成内置行、同 id 第二行丢、旧版 Edge 整行丢（readId :225-255 / :288）', () => {
  const upper = rowsOf({ browserList: [{ name: 'FF', family: 'firefox', id: PREDEFINED_BROWSER_IDS.firefox.toUpperCase() }] })
  assert.equal(upper[0].id, PREDEFINED_BROWSER_IDS.firefox.toUpperCase(),
    '上游 `UUID.fromString` 大小写不敏感（:248）⇒ 比较时归一，但**存储原样留下**（本仓内置行的 id 字面值照 `:43-50`，不能被改写）')
  assert.equal(upper.filter(row => idKeyOf(row.id) === idKeyOf(PREDEFINED_BROWSER_IDS.firefox)).length, 1,
    '认得出它就是那条内置 Firefox ⇒ 补内置行那一步（:318-332）不再重复加一遍')
  const dup = rowsOf({ browserList: [
    { name: 'First', family: 'chrome', id: PREDEFINED_BROWSER_IDS.chrome },
    { name: 'Second', family: 'chrome', id: PREDEFINED_BROWSER_IDS.chrome },
  ] })
  assert.deepEqual(dup.filter(row => row.id === PREDEFINED_BROWSER_IDS.chrome).map(row => row.name), ['First'],
    '同 id 的第二行跳过（:238-243 "duplicated entry, skip"）')
  assert.deepEqual(PREDEFINED_OLD_EDGE_ID, 'B2A9DCA7-9D0B-4E1E-98A8-AFB19C1328D2', '旧版 Edge 的 id（:49）')
  const oldEdge = rowsOf({ browserList: [{ name: 'Edge', family: 'chrome', id: PREDEFINED_OLD_EDGE_ID }] })
  assert.equal(oldEdge.filter(row => row.id === PREDEFINED_OLD_EDGE_ID).length, 0, '旧版 Edge 那一行直接丢（:288）')
  assert.ok(oldEdge.some(row => row.id === PREDEFINED_BROWSER_IDS.edge), '新 Edge 由内置补回那一步带上（:52-59）')
})

test('id 缺省不按家族补：那是 pre-UUID 老档的迁移，本仓照抄会静默丢用户行', () => {
  // 上游 `readId()` `:228-236` 把空 id 按家族补成内置 id，随后 `:238-243` 会把它当成重复行丢掉
  // ⇒ 本仓「用户自己加的第二条 Chrome」会凭空消失（本仓的行由 `addBrowser` 现造、故意不带 id，
  // 与 `ConfigurableWebBrowser.java:28` 的 `UUID.randomUUID()` = 「不是内置行」同一语义）。
  const rows = rowsOf({ browserList: [
    { name: 'Chrome Beta', family: 'chrome', path: 'C:/chrome beta/chrome.exe' },
    { name: 'Chrome Canaries', family: 'chrome', path: 'C:/canary/chrome.exe' },
  ] })
  assert.deepEqual(rows.filter(row => row.name === 'Chrome Beta' || row.name === 'Chrome Canaries').map(row => row.id),
    [undefined, undefined], '两行都留下、都没有内置 id（用户行）')
  assert.ok(rows.some(row => row.id === PREDEFINED_BROWSER_IDS.chrome),
    '内置 Chrome 由补回那一步单独带上 ⇒ 写侧要落 id（`predefinedBrowsers` 那六行本来就带）')
})

/** 与模块内部同一个大小写口径（测试里不复用私有函数，就把它要判的事写出来）。 */
function idKeyOf(id) { return String(id ?? '').trim().toLowerCase() }

test('<settings> 只有带专属设置的家族才留（:293-296 + BrowserFamily.java:18-27/:49-51）', () => {
  const chrome = rowsOf({ browserList: [{
    name: 'C', family: 'chrome',
    settings: { additionalParameters: ['--new-window', '  ', 7], environmentVariables: { LANG: 'en_US', BAD: 1 } },
  }] })
  assert.deepEqual(chrome[0].specificSettings.additionalParameters, ['--new-window'], '非字符串与空的参数丢掉')
  assert.deepEqual(chrome[0].specificSettings.environmentVariables, { LANG: 'en_US' })
  // EXPLORER / SAFARI 走基类 `createBrowserSpecificSettings()` 返回 null（:49-51）⇒ 设置不留（上游那一行也压根不可编辑）。
  const explorer = rowsOf({ browserList: [{ name: 'E', family: 'explorer', settings: { additionalParameters: ['--x'] } }] })
  assert.equal('specificSettings' in explorer[0], false)
  // 上游过一遍 `SkipDefaultValuesSerializationFilters`（:197-198）⇒ 空设置不落，本仓同口径：不带这个键。
  const empty = rowsOf({ browserList: [{ name: 'F', family: 'firefox', settings: {} }] })
  assert.equal('specificSettings' in empty[0], false, '什么都没配就别占一格')
})

test('缺的内置行补回表尾；整表等于内置表时往返是恒等的（:178 与 :318-332 是一对）', () => {
  const roundTrip = predefinedBrowsers('windows')
  assert.deepEqual(rowsOf({ browserList: roundTrip }), roundTrip, '内置表原样写出去再读回来必须一模一样（上游根本不写它）')
  const saved = normalizeBrowserSettings({ browserList: roundTrip })
  assert.deepEqual(saved.browserList, roundTrip)
  const partial = rowsOf({ browserList: [
    { name: 'Mine', family: 'chrome', path: 'C:/mine/chrome.exe', active: true },
    { name: 'Safari', family: 'safari', path: 'Safari', active: false, id: PREDEFINED_BROWSER_IDS.safari },
  ] })
  // 用户行在前（保持读到的顺序），缺的内置行按 `predefinedBrowsers` 的顺序追加（:331 的 list.add）。
  // 这条里没有内置 Chrome ⇒ 它被补回来（`Mine` 不带 id，本仓不猜它是内置行，见上面那条留痕）。
  assert.deepEqual(partial.map(row => row.name),
    ['Mine', 'Safari', 'Chrome', 'Firefox', 'Opera', 'Internet Explorer', 'Edge'])
  assert.equal(partial[0].id, undefined, '用户行没有内置 id（addBrowser 的 `id: undefined` 语义）')
  assert.equal(partial[1].id, PREDEFINED_BROWSER_IDS.safari, '带 id 的行原样保留 ⇒ Safari 没被重复补一条')
})

test('策略坏值与大小写：认不出落回 system（:259-275 的 catch），FIRST/first 都吃', () => {
  assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: 'FIRST' }).defaultBrowserPolicy, 'first')
  assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: 'alternative' }).defaultBrowserPolicy, 'alternative')
  assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: 'system' }).defaultBrowserPolicy, 'system')
  for (const bad of ['SYSTEM2', '', '   ', null, 7, ['first']])
    assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: bad }).defaultBrowserPolicy, 'system', `${String(bad)} 落回默认`)
})

test('上游那四个本仓没有落点的字段：不读、不假装读出来了（:165-176）', () => {
  const rows = normalizeBrowserSettings({ serverReloadMode: 'NEVER', previewReloadMode: 'NEVER', showHover: false, showHoverXml: true })
  assert.deepEqual(Object.keys(rows).sort(), ['browserList', 'defaultBrowserPolicy'],
    '本仓的读盘结果只有这两键；reload 模式与悬浮提示属于内置预览服务器（pf/browsers ④），宿主没有那条通道')
})
