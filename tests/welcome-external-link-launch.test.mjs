// welcome3 的判据：把「打开外部链接」收成**一条出口**（接线请求 welcome2 的 R2）、
// 信任框第三个回值与 trust-all 落库（R3 的模块 + 生命周期这一半）、
// 以及「指定浏览器」那条通道的**成对性**门禁（R5：Method union 与 native 分派缺一边就是假通道）。
//
// 上游基准（本地树，逐行打开过）：
//   · `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`
//     —— 所有打开 URL 的动作汇到同一个 `browse()`：`:96` 先 trim、`:99` 才 `canBrowse`、过了才真的开；
//   · `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`
//     —— 已信任不问（`:69-71`）、三按钮（`:72-80`）、答 Open 不写信任（`:83`）、
//     答 Trust 才 `setProjectTrusted(true)`（`:84`）、其它不开（`:85`）；
//   · `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`
//     —— 勾了 trust-all 才多记**父目录**；`TrustedProjects.kt:103-107` —— 配置目录里的项目不给这一项。
//
// 落库那一条（`settings.general.update`）在浏览器预览里必然失败，所以这里用
// 「记每一次 generalSettings 写入」的假 ref 抓乐观写入的那一手，而不是抓落盘结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  externalLinkGateInstalled, installExternalLinkGate, openExternalUrl,
} from '../src/externalLinkLauncher.ts'
import { createWorkspaceLifecycle } from '../src/workspaceLifecycle.ts'
import { replaceSessionTrust } from '../src/trustedProjects.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))

/**
 * 一个只装配「信任 + URL 出口」所需依赖的生命周期（其余 dep 在这几条路径上根本不会被碰）。
 * `generalSettings` 用 accessor 记每一次写入：`saveTrustedPaths` 先乐观写、预览里请求失败再回滚，
 * 只读最后一次就把「写过」这件事丢了。
 */
function makeLifecycle(root = 'D:/Work/P', persisted = []) {
  const writes = []
  const notices = []
  let inner = { trustedPaths: persisted, defaultProjectDirectory: '' }
  const generalSettings = {
    get value() { return inner },
    set value(next) { writes.push(next); inner = next },
  }
  const workspace = { value: root ? { root, name: 'P', entries: [] } : null }
  const lc = createWorkspaceLifecycle({
    notify: (message, error) => notices.push({ message, error }), isDesktop: false,
    recentProjects: { value: [] }, editorSettings: { value: {} }, generalSettings,
    gitAvailable: { value: false }, defaultParent: { value: '' }, appError: { value: '' },
    loading: { value: false }, pluginList: { value: [] }, busy: { value: false },
    working: { value: false }, leavePrompt: { value: null }, allTabs: { value: [] },
    save: async () => true, resetLsp: () => undefined, resetHierarchy: () => undefined,
    workspace, workspaceEpoch: { value: 0 }, closeAllPanes: () => undefined,
    navBack: { value: [] }, navForward: { value: [] }, treeVersion: { value: 0 }, places: { value: [] },
    projectSettings: { value: { java: {} } }, bookmarks: { value: [] }, runConfigName: { value: '' },
    selectRunConfig: () => undefined, useProjectSettings: () => undefined,
    offerSessionRestore: () => undefined, menu: { value: null }, palette: { value: false },
    notice: { value: '' }, binaryView: { value: null }, projectError: { value: '' },
    projectForm: { value: {} }, projectMode: { value: null }, projectBusy: { value: false },
    cancelling: { value: false }, openFile: () => undefined,
  })
  return { lc, writes, notices, generalSettings, workspace }
}

/** 一次调用的记录：运输被调了几次、带了什么 URL。 */
function transport() {
  const opened = []
  return { opened, open: url => { opened.push(url); return Promise.resolve() } }
}

test.beforeEach(() => { replaceSessionTrust([]) })

test('装了门禁：未信任项目里点链接先问那一句，答「打开」开了但清单一个字不写', async () => {
  const { lc, writes } = makeLifecycle()
  const car = transport()
  assert.equal(externalLinkGateInstalled(), true, '装配这一域就把门禁装上了（宿主不必自己 install）')
  const pending = openExternalUrl('  https://example.org/doc  ', car.open)
  await flush()
  assert.ok(lc.linkPrompt.value, '弹框状态挂上了（mode="link" 那一档）')
  assert.equal(lc.linkPrompt.value.url, 'https://example.org/doc', 'URL 先 trim（:96）')
  assert.equal(lc.linkPrompt.value.root, 'D:/Work/P', '问句带当前项目根（宿主弹框要用）')
  lc.resolveLinkPrompt('open')
  assert.equal(await pending, 'opened')
  assert.deepEqual(car.opened, ['https://example.org/doc'], '答 Open 就开')
  assert.deepEqual(writes, [], '答 Open 什么都不写（BrowserLauncherImpl.kt:83）')
})

test('答「信任项目并打开」：先写清单（记项目根）再开', async () => {
  const { lc, writes } = makeLifecycle()
  const car = transport()
  const pending = openExternalUrl('https://example.org/doc', car.open)
  await flush()
  lc.resolveLinkPrompt('trust')
  assert.equal(await pending, 'opened')
  assert.deepEqual(car.opened, ['https://example.org/doc'])
  assert.deepEqual(writes.map(setting => setting.trustedPaths), [[{ path: 'd:/work/p', trusted: true }]],
    '只有答 Trust 才动清单（:84 那一路才有 setProjectTrusted）')
})

test('答「取消」：不开也不写（:85）', async () => {
  const { lc, writes } = makeLifecycle()
  const car = transport()
  const pending = openExternalUrl('https://example.org/doc', car.open)
  await flush()
  lc.resolveLinkPrompt('cancel')
  assert.equal(await pending, 'canceled')
  assert.deepEqual(car.opened, [], '取消不开')
  assert.deepEqual(writes, [])
  assert.equal(lc.linkPrompt.value, null, '答完就把弹框状态收掉')
})

test('已信任 / 没开项目：根本不问那一句（:60-62 与 :69-71）', async () => {
  const trusted = makeLifecycle('D:/Work/P', [{ path: 'd:/work/p', trusted: true }])
  const trustedCar = transport()
  assert.equal(await openExternalUrl('https://example.org/a', trustedCar.open), 'opened')
  assert.equal(trusted.lc.linkPrompt.value, null, '已信任不弹')
  assert.deepEqual(trustedCar.opened, ['https://example.org/a'])
  const noProject = makeLifecycle('')
  const noProjectCar = transport()
  assert.equal(await openExternalUrl('https://example.org/b', noProjectCar.open), 'opened')
  assert.equal(noProject.lc.linkPrompt.value, null, '没开项目 = 上游 project == null 那一档')
  assert.deepEqual(noProjectCar.opened, ['https://example.org/b'])
})

test('已经挂着一句时不叠第二扇模态：后到的按「取消」答', async () => {
  const { lc } = makeLifecycle()
  const firstCar = transport()
  const secondCar = transport()
  const first = openExternalUrl('https://example.org/first', firstCar.open)
  await flush()
  assert.ok(lc.linkPrompt.value, '第一句还挂着')
  assert.equal(await openExternalUrl('https://example.org/second', secondCar.open), 'canceled',
    '第二句立刻是取消：不开')
  assert.deepEqual(secondCar.opened, [])
  lc.resolveLinkPrompt('open')
  assert.equal(await first, 'opened', '第一句仍由用户的答案决定')
  assert.deepEqual(firstCar.opened, ['https://example.org/first'])
})

test('没装门禁 = 接线前的行为：直接把 URL 交给宿主那条通道，不静默吞掉', async () => {
  installExternalLinkGate(null)
  assert.equal(externalLinkGateInstalled(), false)
  // 测试进程里没有 WebView2 桥 ⇒ 这条通道必然报错；报错恰恰证明**请求发出去了**（而不是被悄悄丢掉）。
  await assert.rejects(() => openExternalUrl('https://example.org/x'), /浏览器预览/,
    '没装门禁时仍走 shell.openUrl（宿主忘了装也只是「问句不在」，不是「链接打不开」）')
})

test('五条 URL 出口收成一个调用：不在保留文件里那三处已经不再各自直连宿主', () => {
  const launcher = read('../src/externalLinkLauncher.ts')
  assert.match(launcher, /return browseWithTrustCheck\(url, \{/, '判定复用 trustedProjects 那一条（不另写一份）')
  for (const file of ['../src/components/TerminalPanel.vue', '../src/components/RunConsole.vue', '../src/quickDocHost.ts']) {
    const source = read(file)
    assert.match(source, /openExternalUrl\(/, `${file}：走那一条出口`)
    assert.doesNotMatch(source, /request\('shell\.openUrl', \{ url(?:s)? \}\)/, `${file}：不再自己直连宿主`)
  }
  // 剩下的两处就在保留文件 src/App.vue 里（文档链接、导出 HTML 后打开浏览器）⇒ 接线请求 welcome3 的 W1。
  const host = read('../src/App.vue')
  assert.equal((host.match(/request\('shell\.openUrl'/g) ?? []).length, 2,
    'App.vue 那两处是宿主唯一还欠的行数')
})

test('R3：确认框的第三个回值一路接到落库（勾了才多落父目录）', () => {
  const lifecycle = read('../src/workspaceLifecycle.ts')
  assert.match(lifecycle,
    /const \[choice, remember, trustAll\] = await new Promise<\[TrustChoice, boolean, boolean\]>\(/,
    '回值收成三个（老宿主接三个实参合法 ⇒ 只有钉住形状才发现它没落）')
  assert.match(lifecycle,
    /if \(remember\) await saveTrustedPaths\(applyTrustDecision\(entries, trustDecisionPaths\(choice, root, trustAll, trustConfigDir\.value\)\)\)/,
    '勾了「以后不再询问」才落库，落哪几条路径由 trustDecisionPaths 判（TrustedProjectsDialog.kt:64-71）')
  assert.match(lifecycle, /else rememberSessionTrust\(root, choice === 'trust'\)/, '没勾只活本次会话')
  assert.match(lifecycle,
    /function resolveTrustPrompt\(choice: TrustChoice, remember: boolean, trustAll: boolean\)/,
    '宿主 @resolve 的三个参数都吃下了')
  assert.match(lifecycle, /T1/, 'return 表露出 trustEntries/saveTrustedPaths（T1）')
})

test('R3：配置目录里的项目不给 trust-all 那一格（可用性的判据在生命周期里）', () => {
  const { lc } = makeLifecycle()
  lc.trustPrompt.value = { root: 'D:/Work/Proj', name: 'Proj' }
  assert.equal(lc.trustCanTrustAll.value, false, '还不知道配置目录（app.info 没读到）⇒ 不画那一格')
  lc.trustConfigDir.value = 'C:/Users/me/.taocode'
  assert.equal(lc.trustCanTrustAll.value, true, '父目录不在配置目录里 ⇒ 可以信任这个位置')
  lc.trustPrompt.value = { root: 'C:/Users/me/.taocode/projects/mirror', name: 'mirror' }
  assert.equal(lc.trustCanTrustAll.value, false, '项目就在配置目录里 ⇒ 这一项根本不提供（TrustedProjects.kt:103-107）')
  lc.trustConfigDir.value = null
  assert.equal(lc.trustCanTrustAll.value, false, '配置目录丢了就退回「不给」')
})

test('R5：指定浏览器那条通道要么两侧都在，要么一侧都没有（半条就是假通道）', () => {
  const bridge = read('../src/bridge.ts')
  const dispatch = read('../native/file_queries.cpp')
  const inUnion = /'shell\.openUrlWithBrowser'/.test(bridge)
  const inDispatch = /"shell\.openUrlWithBrowser"/.test(dispatch)
  assert.equal(inUnion, inDispatch, 'Method union 加了而 native 分派没加 = 前端发出去没人接；反之 = 接了没人发')
  // 那两个设置键要五处同时到位（键表白名单 / 默认值 / 校验 / 类型与默认 / 预览白名单）——
  // 少任何一处都会让「表选完了但存不下来」或「旧存档被判损坏」。
  const keys = read('../native/settings_schema.hpp') + read('../native/settings_schema.cpp')
  const model = read('../src/settingsModel.ts')
  const preview = read('../src/bridgePreview.ts')
  assert.equal(/browserList/.test(keys), /browserList/.test(model),
    'native 键表与本仓设置类型必须同时认识 browserList/defaultBrowserPolicy')
  assert.equal(/browserList/.test(keys), /browserList/.test(preview),
    '预览桩的白名单也要同一批加（否则预览里保存带这两个键的设置的成败与桌面端不一样）')
})
