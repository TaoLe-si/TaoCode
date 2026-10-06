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
//   · `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:54-57`
//     —— 只有 `DefaultBrowserPolicy.FIRST` 才用表里第一个 ⇒ 默认策略是「交给系统」。
import test from 'node:test'
import assert from 'node:assert/strict'

import { browserLaunchPayload, normalizeBrowserSettings, selectDefaultBrowser } from '../src/browsers.ts'

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
  assert.match(errorOf(browserLaunchPayload({ name: 'Edge', family: 'chrome', path: null, active: true }, 'https://a')),
    /没有可用的浏览器路径/)
  assert.match(errorOf(browserLaunchPayload(undefined, 'https://a')), /未选择/)
  assert.match(errorOf(browserLaunchPayload(null, 'https://a')), /未选择/)
})

test('旧存档缺那两个键：补默认，绝不判损坏', () => {
  assert.deepEqual(normalizeBrowserSettings({}), { browserList: [], defaultBrowserPolicy: 'system' })
  assert.deepEqual(normalizeBrowserSettings(null), { browserList: [], defaultBrowserPolicy: 'system' })
  assert.deepEqual(normalizeBrowserSettings(undefined), { browserList: [], defaultBrowserPolicy: 'system' })
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
  assert.deepEqual(saved.browserList.map(row => row.name), ['Chrome', 'Safari'])
  assert.equal(saved.browserList[0].id, undefined, '用户加的行没有上游的 UUID 稳定键')
  assert.equal(saved.defaultBrowserPolicy, 'first')
  // 认不出的策略值一律落回默认那一档（上游只有三个常量）。
  assert.equal(normalizeBrowserSettings({ defaultBrowserPolicy: 'safari' }).defaultBrowserPolicy, 'system')
})

test('策略不是 first 时表里选了也白选：给 null = 交给系统（BrowserLauncherImpl.kt:54-57）', () => {
  const rows = [{ name: 'Chrome', family: 'chrome', path: 'chrome.exe', active: true }]
  assert.equal(selectDefaultBrowser(rows, 'first')?.name, 'Chrome')
  assert.equal(selectDefaultBrowser(rows, 'system'), null, '默认策略不碰这张表')
  assert.deepEqual(normalizeBrowserSettings({}).browserList, [], '落盘的表初始为空')
})
