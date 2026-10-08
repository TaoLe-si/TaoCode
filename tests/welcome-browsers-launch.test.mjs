// 「用指定浏览器打开」的**折算规则**那一半（桶 14c 接线请求第 4 条的模块侧）。
//
// 为什么这个测试叫 welcome-*：本域（14c / welcome 桶）的文件面是「欢迎页 / 文件选择器 /
// 受信任位置 / 浏览器族」，而 `tests/browsers.test.mjs` 不在本桶的可改清单里，
// 派单给的测试面只有 `tests/{pv,welcome,todo,history,outline,fileChooser}-*`。
//
// 上游坐标（基准树逐行数过）：
//   · `platform/platform-api/src/com/intellij/ide/BrowserUtil.java:92-133` `getOpenBrowserCommand`
//     —— 路径是真文件时 `[browserPath, ...parameters, url]`（`:124-130`）；
//   · `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:220`
//     —— parameters 来自 `specificSettings.additionalParameters`；`:96` —— URL 先 trim；
//   · 同文件 `:214-218` —— 路径空的**根本不启动**，报错，不退回系统默认；
//     那句报错来自 `ConfigurableWebBrowser.getBrowserNotFoundMessage()`（`ConfigurableWebBrowser.java:159-161`）
//     = `error.0.browser.path.not.specified`（`platform/platform-api/resources/messages/IdeBundle.properties:18`）；
//   · `platform/platform-impl/src/com/intellij/ide/browsers/WebBrowserManager.java:160-206`（写）与
//     `:257-335`（读）—— 那两个新键的**字段缺省口径**（`path` 省掉补家族执行路径 `:305-308`、
//     `active` 省掉 = 勾着 `:314`、`id` 省掉按家族补内置 id `:226-236`、缺的内置行补回表尾 `:318-332`）；
//   · `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:54-57`
//     —— 只有 `DefaultBrowserPolicy.FIRST` 才用表里第一个 ⇒ 默认策略是「交给系统」。
import test from 'node:test'
import assert from 'node:assert/strict'

import { browserLaunchPayload, normalizeBrowserSettings, predefinedBrowsers, selectDefaultBrowser } from '../src/browsers.ts'

test('启动载荷 = [可执行文件, 附加参数…, URL]（BrowserUtil.java:124-130 的次序）', () => {
  const payload = browserLaunchPayload(
    { name: 'Chrome', family: 'chrome', path: 'C:/Program Files/Google/Chrome/Application/chrome.exe', active: true,
      specificSettings: { additionalParameters: ['--new-window'] } },
    '  https://jetbrains.com  ')
  assert.deepEqual(payload, {
    path: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--new-window', 'https://jetbrains.com'],
  }, 'URL 先 trim（:96），附加参数在前、URL 最后（:126-128）')
})

test('空 URL 只给参数、空的附加参数不进 argv', () => {
  const payload = browserLaunchPayload(
    { name: 'Firefox', family: 'firefox', path: 'firefox', active: true,
      specificSettings: { additionalParameters: ['', '  ', '--private-window'] } }, '   ')
  assert.deepEqual(payload, { path: 'firefox', args: ['--private-window'] })
})

test('没有路径就报错，不悄悄退回系统默认浏览器（:214-218）', () => {
  const errorOf = result => 'error' in result ? result.error : `不是错误，是载荷 ${JSON.stringify(result)}`
  // 文案 = `error.0.browser.path.not.specified`（`IdeBundle.properties:18`，原文
  // `{0} browser path is not specified.`）的直译，经 `ConfigurableWebBrowser.java:159-161`
  // 到 `BrowserLauncherAppless.kt:215-218`。
  assert.equal(errorOf(browserLaunchPayload({ name: 'Edge', family: 'chrome', path: null, active: true }, 'https://a')),
    '未指定 Edge 的浏览器路径。')
  // 一行都没选出来（上游那时 `browser = null` 走的是「交给系统默认」那一路，`:124`）⇒ 这句话
  // 是「调用方别拿这个载荷去启动」，不是一次启动失败。
  assert.match(errorOf(browserLaunchPayload(undefined, 'https://a')), /没有可用的浏览器/)
  assert.match(errorOf(browserLaunchPayload(null, 'https://a')), /没有可用的浏览器/)
})

test('旧存档缺那两个键：补默认，绝不判损坏', () => {
  // 上游的往返：整表等于内置表时不落任何 `<browser>`（`getState()` `:178`），读回来按
  // `loadState()` `:318-332` 把缺的内置行补回去 ⇒ 空档读回来就是那六个内置浏览器。
  for (const raw of [{}, null, undefined]) {
    assert.deepEqual(normalizeBrowserSettings(raw), {
      browserList: predefinedBrowsers('windows'), defaultBrowserPolicy: 'system',
    }, `${JSON.stringify(raw)}：缺键补默认，不判损坏`)
  }
})

test('表里的坏条目逐条丢，好条目按上游形状留下', () => {
  const saved = normalizeBrowserSettings({
    browserList: [
      { name: 'Chrome', family: 'chrome', path: 'C:/x/chrome.exe', active: true },
      { name: '没家族', family: 'netscape', path: 'netscape', active: true },
      { name: '', family: 'chrome' },
      null, 'x',
      { name: 'Safari', family: 'safari', path: null, active: false },
    ],
    defaultBrowserPolicy: 'first',
  })
  // 两条用户行留下（`netscape` 家族认不出 ⇒ 整行丢，`WebBrowserManager.java:282-285`；
  // 空 name 也丢 —— 本仓这张表按 name 寻址，见 `normalizeBrowserSettings` 的注释）。
  assert.deepEqual(saved.browserList.slice(0, 2).map(row => row.name), ['Chrome', 'Safari'], '读到的顺序就是表里的顺序')
  // `path` 省掉时补家族执行路径（`loadState()` `:305-308`）：Safari 在 Windows 上是 `safari`。
  assert.equal(saved.browserList[1].path, 'safari')
  // 缺的内置行按 `:318-332` 追加在表尾（字段级的对齐细节由 `tests/browser-registration.test.mjs` 逐条钉）。
  // 这两条用户行都不带 id ⇒ 六条内置行一条都不算「已在表里」，全须全尾地补回来（本仓不按家族猜 id，
  // 见 `normalizeBrowserSettings` 里 `readId` 那段留痕）：2 条用户行 + 6 条内置行。
  assert.equal(saved.browserList.length, 8, '两条用户行 + 补回来的六条内置行')
  assert.equal(saved.defaultBrowserPolicy, 'first')
  // 认不出的策略值一律落回默认那一档（上游只有三个常量，坏值被 catch `:273-275`）。
  assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: 'safari' }).defaultBrowserPolicy, 'system')
})

test('策略不是 first 时表里选了也白选：给 null = 交给系统（BrowserLauncherImpl.kt:54-57）', () => {
  const rows = [{ name: 'Chrome', family: 'chrome', path: 'chrome.exe', active: true }]
  assert.equal(selectDefaultBrowser(rows, 'first')?.name, 'Chrome')
  assert.equal(selectDefaultBrowser(rows, 'system'), null, '默认策略不碰这张表')
  assert.deepEqual(normalizeBrowserSettings({}).browserList.map(row => row.name),
    predefinedBrowsers('windows').map(row => row.name), '空档读回来 = 六个内置浏览器（`:318-332`）')
})
