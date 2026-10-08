// trust5 的判据之一：「用浏览器打开」那一步之前的**可用性判定**（接线请求 trust5 的 U1 的模块侧）。
//
// 这条判据分三层，缺任何一层都算没落：
//   ① 规则层（`src/browsers.ts` 的 `externalLaunchRejection` / `hasLaunchUrlScheme`）；
//   ② 出口层（`src/externalLinkLauncher.ts` 的 `openExternalUrl`：判定装在**问那一句之前**）；
//   ③ 宿主对照层（拒的形状与 `native/workspace.cpp` 那条硬边界同口径，不比对它就更松）。
//
// 上游基准（基准树逐行打开过，`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · `platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112`
//     —— `browse()`：`:91-94` `jar:` 只 `LOG.info` 就 return（不给用户看任何东西）、`:96` 先 trim、
//     `:99` 才 `canBrowse`、`:101-105` 解析不出 ⇒ `error.malformed.url`、`:106-109` `file:` 带 host ⇒
//     `error.unc.not.supported`；`:146-161` `mailto` 单独交给 `Desktop.mail`（不是错误）；
//   · `platform/platform-api/resources/messages/IdeBundle.properties:13`（`notification.title.cannot.open`）、
//     `:15`（`error.malformed.url=Malformed URL: {0}`）、`:16`（`error.unc.not.supported=UNC paths are not supported: {0}`）、
//     `:18`（`error.0.browser.path.not.specified={0} browser path is not specified.`）、
//     `:19`（`browser.default.not.supported`）；
//   · 「没有可用浏览器」那两档：`BrowserLauncherAppless.kt:199-209`（`defaultBrowserCommand` 为 null ⇒
//     `browser.default.not.supported`）与 `:211-218`（选了行但行没路径 ⇒ 上面 `:18` 那句）；
//     本仓宿主的对应表现是 `native/workspace.cpp:1232-1233` 的 `ShellExecuteW` 返回值 ≤ 32
//     （没有关联程序就打不开）⇒ 报 `IO_ERROR`，由五个调用点各自 catch 成一句可见提示。
//   · 宿主的协议语法（本仓采它做判据，不采上游那一手）：`native/workspace.cpp:1205-1220` 的 `has_url_scheme`
//     与 `:1225-1231` 的三道拒绝（空 / 非 UTF-8 / 没有协议名）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  externalLaunchRejection, hasLaunchUrlScheme, browserLaunchPayload, browserPathNotSpecifiedMessage,
  MALFORMED_URL_MESSAGE, UNC_URL_MESSAGE, formatUrlMessage,
} from '../src/browsers.ts'
import { installExternalLinkGate, markLinkDialogMounted, openExternalUrl, externalLinkGateInstalled } from '../src/externalLinkLauncher.ts'
import { createWorkspaceLifecycle } from '../src/workspaceLifecycle.ts'
import { replaceSessionTrust, trustedStateFor, externalLinkOutcome } from '../src/trustedProjects.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))

/**
 * 一条**到点就失败**的 Promise：判定要是被谁短路掉了，未信任项目里那条 URL 会走进门禁去等一句
 * 没人回答的弹框 —— 那时这条用例是「挂住」而不是「红」，挂住的判据等于没有判据。
 * 到点报错就把它变成一次可失败的断言（正常情况下这一步是同步就出结果的，用不到这个超时）。
 */
function settle(promise, ms = 2000, what = '这条 Promise 没在超时里落地') {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}（判定被绕过了？)`)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** 只装配「信任 + URL 出口」所需依赖的生命周期（与 `welcome-external-link-launch.test.mjs` 同一形状）。 */
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
  return { lc, writes, notices, workspace }
}

test.beforeEach(() => { replaceSessionTrust([]); markLinkDialogMounted(true) })

// ── ① 规则层 ──────────────────────────────────────────────────────────────

test('放行的是绝对 URL：http/https/file:///（不带 host）/mailto —— 上游 browse() 的口径', () => {
  for (const url of ['https://example.org/a', 'http://example.org', 'HTTPS://EXAMPLE.ORG',
    'file:///C:/docs/index.html', 'mailto:someone@example.com', '  https://example.org/padded  '])
    assert.equal(externalLaunchRejection(url), null, `${url} 该放行`)
})

test('jar: 那一档：不碰浏览器、也不编一句话（BrowserLauncherAppless.kt:91-94 只 LOG.info）', () => {
  const rejection = externalLaunchRejection('jar:file:/C:/libs/a.jar!/index.html')
  assert.ok(rejection, 'jar: 不能被放行')
  assert.equal(rejection.code, 'ignored')
  assert.equal(rejection.message, null, '上游不给用户看任何东西 ⇒ 本仓也不许自己造一句')
})

test('URL 不合法 ⇒ 拒：空串 / 纯空白 / 没有协议 / 单字母协议名紧跟斜杠', () => {
  const codes = [' ', '', 'example.org/a', '/tmp/index.html', 'calc.exe', 'C:/tools/x.exe', 'c:\\tools\\x.exe']
  for (const url of codes) {
    const rejection = externalLaunchRejection(url)
    assert.ok(rejection, `${url} 该被拒`)
    assert.equal(rejection.code, 'malformed', `${url}：走 malformed 那一档（:101-105 + 宿主 :1225/:1231）`)
  }
  assert.equal(externalLaunchRejection('   ').message, formatUrlMessage(MALFORMED_URL_MESSAGE, ''), '先 trim 再判（:96）')
  assert.equal(externalLaunchRejection('calc.exe').message, `URL 格式不正确：calc.exe`)
})

test('UNC 拒、file://host 就是 UNC（:106-109；文案 = error.unc.not.supported 的直译）', () => {
  const rejection = externalLaunchRejection('file://server/share/doc.html')
  assert.equal(rejection.code, 'unc')
  assert.equal(rejection.message, formatUrlMessage(UNC_URL_MESSAGE, 'file://server/share/doc.html'))
  assert.equal(rejection.message, '不支持 UNC 路径：file://server/share/doc.html')
})

test('协议名语法与宿主那条硬边界逐字同口径（native/workspace.cpp:1205-1220）', () => {
  const accepted = ['a+', 'a-b', 'a.b1', 'http', 'https', 'mailto', 'file']
  for (const scheme of accepted) assert.equal(hasLaunchUrlScheme(`${scheme}:x`), true, `${scheme}: 是合法协议名`)
  const rejected = ['1abc:x', '-abc:x', ':x', 'C:/x.exe', 'c:\\x.exe', 'ab/x:y', 'a b:x']
  for (const scheme of rejected) assert.equal(hasLaunchUrlScheme(scheme), false, `${scheme} 不是协议名（盘符那一手抄宿主 :1212-1214）`)
  // 宿主的源码里那条语法注释必须在（两侧同口径这件事不许悄悄漂）：
  const host = read('../native/workspace.cpp')
  assert.match(host, /协议名按 RFC 3986/)
  assert.match(host, /单字母 scheme 后面紧跟 `\/` 或 `\\` → 盘符，不是协议/)
  assert.match(host, /if \(!has_url_scheme\(url\)\) fail\("INVALID_PATH", "只允许带协议的绝对链接/)
})

// ── ② 出口层：判定装在「问那一句」之前 ──────────────────────────────────

test('出口层：URL 不合法 ⇒ 不开、不弹那一句、不写清单，抛的是上游那两句之一', async () => {
  const { lc, writes } = makeLifecycle()
  const opened = []
  // 判定在门禁之前 ⇒ 这一步是**同步**就拒的，别等下一拍（那会让这个 Promise 变成未处理拒绝）。
  await assert.rejects(settle(openExternalUrl('calc.exe', url => { opened.push(url) }), 2000, '不合法的 URL 该当场就拒'),
    /URL 格式不正确：calc\.exe/)
  assert.deepEqual(opened, [], '一条宿主本来就要拒的 URL 不该发出去')
  assert.equal(lc.linkPrompt.value, null, '根本不该弹「要在浏览器里打开吗」那一句')
  assert.deepEqual(writes, [], '弹都没弹 ⇒ 信任清单一个字不写')
})

test('出口层：答「信任项目并打开」之后运输失败，错误不被吞、清单仍按上游写完（:84 的顺序）', async () => {
  const { lc } = makeLifecycle()
  const pending = openExternalUrl('https://example.org/doc', () => Promise.reject(new Error('IO_ERROR: 无法打开该链接。')))
  await flush()
  lc.resolveLinkPrompt('trust')
  await assert.rejects(pending, /无法打开该链接/, '「没有可用浏览器 / 没有关联程序」这一档必须看得见（宿主 :1232-1233）')
  assert.equal(await trustedStateForAsync(lc), 'trusted', '答 trust 就写清单：与上游 :84 一致，运输失败不回滚')
})

/** 出口写进清单之后的状态（走模块那一份真源，不读宿主自留数组）。 */
async function trustedStateForAsync(lc) {
  await flush()
  return trustedStateFor('D:/Work/P', lc.trustEntries())
}

test('出口层：jar: 走「不运输也不说一句」，返回 ignored 而不是 opened', async () => {
  const opened = []
  const { lc, writes } = makeLifecycle()
  const outcome = await settle(openExternalUrl('jar:file:/C:/a.jar!/x', url => { opened.push(url) }), 2000, 'jar: 该当场就不开')
  assert.equal(outcome, 'ignored')
  assert.deepEqual(opened, [])
  assert.equal(lc.linkPrompt.value, null, 'jar: 在上游是被 `:91-94` 挡掉的，连问都不问')
  assert.deepEqual(writes, [])
})

test('出口层：门禁没装也照样拒不合法 URL（判定不属于门禁）', async () => {
  makeLifecycle()
  assert.equal(externalLinkGateInstalled(), true, '上一条用例装配过 ⇒ 先确认这条是在「装了」的状态上取掉的')
  installExternalLinkGate(null)
  assert.equal(externalLinkGateInstalled(), false)
  await assert.rejects(() => openExternalUrl('C:/tools/x.exe'), /URL 格式不正确/)
})

test('出口层：五条 URL 出口都吃这一道判定（只有一个调用点，改一处就全改）', () => {
  const launcher = read('../src/externalLinkLauncher.ts')
  // 形状钉死：判定是函数体的**第一句**，紧接其后才是运输与门禁 —— 包在 `if (false …)` 里、
  // 或者挪到 `const transport =` 之后，这一段就不匹配了（短路型的半落地是本仓踩过的坑）。
  assert.match(launcher,
    /openExternalUrl\(url: string, open\?: \(url: string\) => unknown\)[^\n]*\{\n\s*const rejection = externalLaunchRejection\(url\)\n\s*if \(rejection\) \{\n\s*if \(rejection\.code === 'ignored'\) return 'ignored'\n\s*throw new Error\(rejection\.message\)\n\s*\}\n\s*const transport = /,
    '出口第一件事就是判定，而且它没有被任何条件包起来')
  assert.doesNotMatch(launcher, /if \(false[\s\S]{0,200}externalLaunchRejection/, '不许出现短路型的「判定在但走不到」')
  // 判定必须在门禁之前：门禁里那条 `browseWithTrustCheck` 会弹框、答 trust 会写清单。
  assert.ok(launcher.indexOf('externalLaunchRejection(url)') < launcher.indexOf('browseWithTrustCheck(url'),
    '可用性判定长在门禁之前')
})

// ── ③ 「没有可用浏览器」的两档（规则侧，通道到位才接） ──────────────────

test('没有可用浏览器①：选了行但那一行没有路径 ⇒ 上游 :18 那句，不悄悄退回系统默认', () => {
  assert.equal(browserPathNotSpecifiedMessage('Edge'), '未指定 Edge 的浏览器路径。')
  // EXPLORER / SAFARI 在非本平台上家族执行路径就是 null（BrowserFamily.java:28-29 + :53-63）
  // ⇒ 那一行是真的没有路径，载荷建不出来（`WebBrowserManager.java:305-308` 补不出东西）。
  const noPathOnLinux = { name: 'Internet Explorer', family: 'explorer', path: null, active: true }
  assert.equal('error' in browserLaunchPayload(noPathOnLinux, 'https://a'), true)
})

test('没有可用浏览器②：表里一行都选不出来 ⇒ 上游那一路是「交给系统默认」，本仓不许报错', () => {
  // `BrowserLauncherAppless.kt:124` 的 `useDefaultBrowser` 那一档 = 本仓宿主的唯一出口；
  // 所以「表里没选出任何一行」不是失败，是**不碰这张表**（`selectDefaultBrowser` 给 null 已由
  // `welcome-browsers-launch.test.mjs` 钉住）。这一条钉的是另一半：
  // 载荷函数被硬叫去给一个不存在的行时，报错内容要说清「该退回系统默认」，不能写成启动失败。
  const result = browserLaunchPayload(null, 'https://a')
  assert.match(result.error, /应退回系统默认浏览器/)
})

test('外部链接的 trust 答案只写项目根，绝不写父目录（trust-all 的作用域边界）', () => {
  // 上游那一问的答案是 `setProjectTrusted(project, true)`（`BrowserLauncherImpl.kt:84`），
  // 没有 trust-all 那颗勾（勾在启动确认框 `TrustedProjectsDialog.kt:66-70`）⇒ 答「信任项目并打开」
  // 只放行**这一个项目**，不许顺手把「它所在的整个文件夹里的全部项目」放掉。
  const answer = externalLinkOutcome('trust', 'D:/Work/P', [])
  assert.deepEqual(answer.entries, [{ path: 'd:/work/p', trusted: true }])
  assert.equal(answer.entries.some(entry => entry.path === 'd:/work'), false, '不写父目录')
  // 没有项目根时那一路（上游 `canBrowse` 的 `project == null`，`:60-62`）连半条记录都不许出现。
  assert.deepEqual(externalLinkOutcome('trust', null, []).entries, [])
  assert.deepEqual(externalLinkOutcome('open', 'D:/Work/P', []).entries, [], '答「打开」什么都不写（:83）')
  assert.deepEqual(externalLinkOutcome('cancel', 'D:/Work/P', []).entries, [], '答「取消」什么都不写（:85）')
})
