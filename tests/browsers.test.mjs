// 浏览器表的规则侧（`src/browsers.ts`）—— `ConfigurableWebBrowser` / `BrowserFamily` /
// `BrowserFamily` 的执行路径 / `WebBrowserManager` 的内置清单 / `DefaultBrowserPolicy`。
//
// 上游依据（`platform/` 下）：
//   · `platform-api/.../browsers/BrowserFamily.java:15-29` —— 四个家族与各自的
//     windows/unix/mac 三条执行路径；`:53-63` `getExecutionPath()` 按系统挑一条。
//   · `platform-impl/.../browsers/ConfigurableWebBrowser.java:17-49` —— 一行的字段与两个构造器；
//     `:31-33` 的两参构造把名字/路径取自家族、`active=true`。
//   · `platform-impl/.../browsers/WebBrowserManager.java:43-59` 六个内置 id（`:42` 要求跨版本稳定）；
//     `:64-74` `getEdgeExecutionPath()`；`:76-91` `getPredefinedBrowsers()`；
//     `:108-121` isYandex/isEdge/isOpera；`:123-140` `checkNameAndPath`；
//     `:142-145` `isPredefinedBrowser`；`:455-463` `isActive` / `getFirstActiveBrowser`。
//   · `platform-impl/.../browsers/DefaultBrowserPolicy.java:18-19` 三个常量。
//   · `platform-api/.../browsers/BrowserLauncherAppless.kt:259-265` `defaultBrowserCommand`。
//
// ⚠️ 这一族**没有生产消费方**（宿主唯一的 URL 出口是 `shell.openUrl`，一律走系统默认浏览器），
// 所以设置页不渲染这张表。详见 `src/browsers.ts` 模块头与族判词 `pf/browsers`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addBrowser,
  BROWSER_FAMILY_TABLE,
  browserVariant,
  checkNameAndPath,
  edgeExecutionPath,
  executionPathFor,
  familyHasSpecificSettings,
  firstActiveBrowser,
  isPredefinedBrowser,
  normalizeBrowserPath,
  parseBrowserInput,
  PREDEFINED_BROWSER_IDS,
  predefinedBrowsers,
  removeBrowser,
  selectDefaultBrowser,
  setBrowserActive,
  systemDefaultBrowserCommand,
  updateBrowser,
} from '../src/browsers.ts'

test('家族表与执行路径：逐条照 BrowserFamily.java:15-29 / :53-63', () => {
  assert.deepEqual(BROWSER_FAMILY_TABLE.map(row => row.id), ['chrome', 'firefox', 'explorer', 'safari'])
  assert.equal(executionPathFor('chrome', 'windows'), 'chrome')
  assert.equal(executionPathFor('chrome', 'linux'), 'google-chrome')
  assert.equal(executionPathFor('chrome', 'mac'), 'Google Chrome')
  assert.equal(executionPathFor('firefox', 'linux'), 'firefox')
  // EXPLORER / SAFARI 的 unix 路径是 null（BrowserFamily.java:28-29 的第三个构造参数）。
  assert.equal(executionPathFor('explorer', 'linux'), null)
  assert.equal(executionPathFor('safari', 'linux'), null)
  assert.equal(executionPathFor('safari', 'windows'), 'safari')
  assert.equal(executionPathFor('safari', 'mac'), 'Safari')
})

test('路径归一：反斜杠转正斜杠、空串归 null（ConfigurableWebBrowser.setPath :105-107）', () => {
  assert.equal(normalizeBrowserPath('C:\\Program Files\\Chrome\\chrome.exe'), 'C:/Program Files/Chrome/chrome.exe')
  assert.equal(normalizeBrowserPath('  '), null)
  assert.equal(normalizeBrowserPath(null), null)
  assert.equal(normalizeBrowserPath(undefined), null)
})

test('checkNameAndPath：名字 → 文件名 → 父目录名，父目录是 bin 时再上一级（:123-140）', () => {
  const browser = { name: 'My Browser', path: '/usr/bin/chromium' }
  assert.equal(checkNameAndPath('My', browser), true, '命中名字')
  assert.equal(checkNameAndPath('chromium', browser), true, '命中文件名')
  assert.equal(checkNameAndPath('usr', browser), true, 'bin 的上一级')
  assert.equal(checkNameAndPath('opt', browser), false)
  assert.equal(checkNameAndPath('anything', { name: 'x', path: null }), false)
})

test('变体识别：Edge/Yandex 必须 CHROME 家族，Opera 不限家族（:108-121）', () => {
  assert.equal(browserVariant({ name: 'Edge', path: 'C:/msedge.exe', family: 'chrome' }), 'edge')
  assert.equal(browserVariant({ name: 'Edge', path: 'C:/msedge.exe', family: 'firefox' }), 'default', '非 CHROME 家族不算 Edge')
  assert.equal(browserVariant({ name: 'Opera', path: 'opera.exe', family: 'chrome' }), 'opera')
  assert.equal(browserVariant({ name: 'Opera', path: 'opera.exe', family: 'firefox' }), 'opera', 'isOpera 不限家族')
  assert.equal(browserVariant({ name: 'Yandex', path: null, family: 'chrome' }), 'yandex')
  assert.equal(browserVariant({ name: 'Google Chrome', path: 'chrome', family: 'chrome' }), 'default')
  assert.equal(browserVariant({ name: 'Chromium', path: 'chromium', family: 'chrome' }), 'chromium')
})

test('默认浏览器策略：只有 FIRST 选出表里的行，其余交系统（DefaultBrowserPolicy + BrowserLauncherImpl.kt:54-57）', () => {
  const browsers = [
    { name: 'A', family: 'chrome', path: null, active: true },
    { name: 'B', family: 'firefox', path: '/usr/bin/firefox', active: true },
  ]
  assert.equal(firstActiveBrowser(browsers), browsers[1], '第一个「勾了且有路径」的（:459-463）')
  assert.equal(selectDefaultBrowser(browsers, 'first'), browsers[1])
  assert.equal(selectDefaultBrowser(browsers, 'system'), null, 'SYSTEM = 交给系统默认浏览器')
  assert.equal(selectDefaultBrowser(browsers, 'alternative'), null, 'ALTERNATIVE 走 GeneralLocalSettings.browserPath，本仓无启动通道')
  assert.deepEqual(systemDefaultBrowserCommand('windows'), ['cmd.exe', '/c', 'start', '""'])
  assert.deepEqual(systemDefaultBrowserCommand('mac'), ['open'])
  assert.deepEqual(systemDefaultBrowserCommand('linux'), ['xdg-open'])
})

test('内置浏览器清单：六个 id 与默认勾选态逐条照 WebBrowserManager.java:76-91', () => {
  // 六个 id 的**字面值**（:43-50）—— :42 的注释要求它们跨 IDE 版本/机器/用户不变，
  // 不能被重新生成，所以这里直接钉字符串（下面的 isPredefinedBrowser 用例若只比常量自身会空转）。
  assert.deepEqual(PREDEFINED_BROWSER_IDS, {
    chrome: '98CA6316-2F89-46D9-A9E5-FA9E2B0625B3',
    firefox: 'A7BB68E0-33C0-4D6F-A81A-AAC1FDB870C8',
    safari: 'E5120D43-2C3F-47EF-9F26-65E539E05186',
    opera: '53E2F627-B1A7-4DFA-BFA7-5B83CC034776',
    explorer: '16BF23D4-93E0-4FFC-BFD6-CB13575177B0',
    edge: '37cae5b9-e8b2-4949-9172-aafa37fbc09c',
  })
  const windows = predefinedBrowsers('windows')
  // 名字 = `family.getName()`（`ConfigurableWebBrowser.java:31-33` 的两参构造），
  // 而 `BrowserFamily.java:16` 的第一个构造参数是 `IdeBundle.message("browsers.chrome")`
  // = `platform/platform-api/resources/messages/IdeBundle.properties:27` 的 **Chrome**（不是 mac 路径
  // 'Google Chrome'，那是第四个参数 `BrowserFamily.java:16`；2026-10-06 trust5 按原文订正）。
  assert.deepEqual(windows.map(row => row.name), ['Chrome', 'Firefox', 'Safari', 'Opera', 'Internet Explorer', 'Edge'])
  // 两参构造（ConfigurableWebBrowser.java:31-33）给 active=true。
  assert.equal(windows[0].active, true)
  assert.equal(windows[1].active, true)
  // 六参构造逐个给：Safari 只在 mac 勾（:81），Opera 永不勾（:83），Explorer 永不勾（:85），Edge 只在 windows 勾（:88）。
  assert.equal(windows[2].active, false)
  assert.equal(windows[3].active, false)
  assert.equal(windows[4].active, false)
  assert.equal(windows[5].active, true)
  // Opera 与 Edge 都属 CHROME 家族（:83 / :87），没有 EDGE/OPERA 家族成员。
  assert.equal(windows[3].family, 'chrome')
  assert.equal(windows[5].family, 'chrome')
  // Edge 的执行路径不来自 BrowserFamily（:64-74）。
  assert.equal(windows[5].path, 'msedge')
  assert.equal(edgeExecutionPath('mac'), 'Microsoft Edge')
  assert.equal(edgeExecutionPath('linux'), 'microsoft-edge')
  // Opera 的路径按平台分（:83）。
  assert.equal(windows[3].path, 'opera')
  assert.equal(predefinedBrowsers('mac')[3].path, 'Opera')
  assert.equal(predefinedBrowsers('mac')[2].active, true, 'Safari 在 mac 上默认勾上')
  assert.equal(predefinedBrowsers('mac')[5].active, false, 'Edge 在 mac 上默认不勾')
})

test('isPredefinedBrowser：id 在六张内置表里才算内置行（:142-145）', () => {
  const rows = predefinedBrowsers('windows')
  assert.ok(rows.every(row => isPredefinedBrowser(row)), '六个内置行都该被认出来')
  // 用户新增的行是随机 UUID（ConfigurableWebBrowser.java:28）⇒ 不是内置行，可以删。
  const added = addBrowser(rows, { name: 'Mine', family: 'chrome', path: 'x', active: true })
  assert.equal(added.error, undefined)
  assert.equal(isPredefinedBrowser(added.browsers[6]), false)
  // 旧版 Edge 的 id 已不在表里（WebBrowserManager.java:49 但不在 :52-59 的数组中）。
  assert.equal(isPredefinedBrowser({ id: 'B2A9DCA7-9D0B-4E1E-98A8-AFB19C1328D2' }), false)
})

test('家族专属设置：只有 CHROME/FIREFOX 有，EXPLORER/SAFARI 走基类返回 null（BrowserFamily.java:18-27/:49-51）', () => {
  assert.equal(familyHasSpecificSettings('chrome'), true)
  assert.equal(familyHasSpecificSettings('firefox'), true)
  assert.equal(familyHasSpecificSettings('explorer'), false)
  assert.equal(familyHasSpecificSettings('safari'), false)
})

test('表格增删改：同名拒绝、改名查重、路径过归一、勾选可切', () => {
  const start = [{ name: 'A', family: 'chrome', path: 'C:/a.exe', active: true }]
  assert.ok('error' in addBrowser(start, { name: 'A', family: 'chrome', path: null, active: true }))
  const two = addBrowser(start, { name: 'B', family: 'firefox', path: 'C:/b.exe', active: true }).browsers
  assert.deepEqual(removeBrowser(two, 'A').map(row => row.name), ['B'])
  assert.deepEqual(removeBrowser(two, 'nope').map(row => row.name), ['A', 'B'], '删不存在的行幂等')
  assert.ok('error' in updateBrowser(two, 'nope', { path: 'x' }))
  assert.ok('error' in updateBrowser(two, 'A', { name: 'B' }), '改名撞上已有行要报错')
  assert.ok('error' in updateBrowser(two, 'A', { name: '  ' }))
  const renamed = updateBrowser(two, 'A', { name: 'AA', path: 'C:\\aa.exe' })
  assert.equal(renamed.browsers[0].name, 'AA')
  assert.equal(renamed.browsers[0].path, 'C:/aa.exe')
  assert.deepEqual(setBrowserActive(two, 'B', false).map(row => row.active), [true, false])
})

test('新增一行：家族不给时按执行路径反查，对不上要用户选（上游新增行的家族列可手选）', () => {
  const byPath = parseBrowserInput({ name: 'Mine', path: '/usr/bin/firefox' }, [], 'linux')
  assert.equal(byPath.browser.family, 'firefox')
  assert.equal(byPath.browser.active, true, '默认勾上，否则 getFirstActiveBrowser 会跳过它')
  assert.ok('error' in parseBrowserInput({ name: '  ', path: 'x' }))
  assert.ok('error' in parseBrowserInput({ name: 'A', path: 'x' }, [{ name: 'A', family: 'chrome', path: null, active: true }]))
  assert.ok('error' in parseBrowserInput({ name: 'Odd', path: '/opt/thing' }, [], 'linux'), '认不出家族就不猜')
})
