// 信任框两个**待接线**的可见面（桶 14c 接线请求第 2、3 条的模块侧）。
//
// 组件是 `src/components/TrustedProjectDialog.vue`（本桶名下），宿主挂点在
// `src/App.vue`（保留文件）与 `src/workspaceLifecycle.ts`（不在本桶名下）⇒ 落库那两行写成
// `docs/wiring-requests-2026-10-06-welcome.md`。规则侧早已在 `src/trustedProjects.ts`
// （判据 `tests/trusted-trust-all.test.mjs` / `tests/trusted-external-link.test.mjs`）。
//
// 「不放假控件」的机械化：勾选框只有在宿主**明说它接得住第三个回值**（`canTrustAll`）
// 并且这一项允许被提供（`TrustedProjects.kt:103-107`：父目录不在 IDE 配置目录里）时才画；
// 链接那一句只有宿主挂了 `mode="link"` 才存在。宿主没接 ⇒ 一行都不出现，而不是出现但没用。
//
// 上游坐标（基准树逐行数过）：
//   · `platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`
//     —— TRUST_AND_OPEN 且 `projectRoot.parent != null && dialog.isTrustAll` 时把**父目录**
//     写进 `TrustedPathsSettings`（`:69`），`:73` 是 OPEN_IN_SAFE_MODE 记 false，`:95` 取消不记；
//   · `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87`
//     —— 未信任项目里 browse 之前那一句：三个按钮（`:72-78`）、默认 Open（`:79`）、
//     焦点在 Trust（`:80`）、答 Open 不写信任（`:83`）、答 Trust 才 `setProjectTrusted(true)`（`:84`）、
//     其它不开（`:85`）；调用点在 `BrowserLauncherAppless.kt:99`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  EXTERNAL_LINK_LABELS, EXTERNAL_LINK_TITLE, TRUST_ALL_LABEL, browseWithTrustCheck, externalLinkOutcome,
  externalLinkPrompt, isProjectLocationOfferedForTrust, shortenFolderName, trustAllLabel, trustDecisionPaths,
} from '../src/trustedProjects.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const dialog = read('../src/components/TrustedProjectDialog.vue')

test('trust-all 那一格要宿主明说接得住才画', () => {
  assert.match(dialog, /const trustAllAvailable = computed\(\(\) =>/, '有独立的可用性判定，不是恒为真')
  assert.match(dialog, /props\.canTrustAll === true/, '宿主不传 canTrustAll ⇒ 整格不渲染')
  assert.match(dialog, /isProjectLocationOfferedForTrust\(props\.root, props\.configDir \?\? null\)/,
    '配置目录里的项目不给这一项（TrustedProjects.kt:104-106）')
  const row = dialog.split('\n').find(line => line.includes('v-if="trustAllAvailable"'))
  assert.ok(row, '勾选框按可用性渲染')
  assert.match(dialog, /trustAllLabel\(props\.root\)/, '文案取自 trustedProjects（不在组件里另写一句）')
  // 文案照上游原文直译：`untrusted.project.warning.trust.location.checkbox`
  // = "Trust all projects in ''{0}'' folder"（IdeBundle.properties:2949），{0} = 父目录文件夹名。
  // 原写「始终信任来自此来源的项目」（14c 转述的概念、不是上游文案），本轮按实测订正为带名字的模板。
  assert.equal(TRUST_ALL_LABEL, '信任「{0}」文件夹里的所有项目')
})

test('勾选框文案带父目录文件夹名，超 40 字符按上游截断口径收', () => {
  // StartupDialog.kt:89-91：shortenTextWithEllipsis(parentDirName, 40, 0, true) ⇒ 前 39 + 一个省略号。
  assert.equal(trustAllLabel('D:/Work/Proj'), '信任「Work」文件夹里的所有项目')
  const long = 'x'.repeat(45)
  assert.equal(trustAllLabel(`D:/${long}/Proj`), `信任「${'x'.repeat(39)}…」文件夹里的所有项目`)
  assert.equal(shortenFolderName('short'), 'short', '40 字以内一个字不动')
})

test('第三个回值带的是 trust-all，且没有覆盖掉「以后不再询问」', () => {
  assert.match(dialog, /resolve: \[choice: TrustChoice, remember: boolean, trustAll: boolean\]/,
    '回值签名：老宿主的前两个参数照旧（多给的参数被忽略，不会编译失败）')
  assert.match(dialog, /trustAllAvailable\.value && trustAll\.value/,
    '不可用时即使内部 ref 被翻过也不外传 true')
  assert.match(dialog, /shouldRememberChoice\(model\.value, remember\.value, exit\)/,
    '「以后不再询问」仍走 messageDialog 那条既有规则')
})

test('链接那一句：三个按钮的文案与顺序照上游，且单独一条回值', () => {
  assert.match(dialog, /resolveLink: \[choice: ExternalLinkChoice\]/,
    '链接的取值是 open/trust/cancel，不与启动确认框的 trust/distrust/cancel 混一张表')
  assert.match(dialog, /title: EXTERNAL_LINK_TITLE/, '标题 = external.link.confirmation.title')
  assert.match(dialog, /externalLinkMessage\(props\.url \?\? ''\)/, '正文把 URL 放在最后一行')
  assert.deepEqual(EXTERNAL_LINK_LABELS, { open: '打开', trust: '信任项目并打开', cancel: '取消' })
  // 顺序：Open、Trust、Cancel（上游 `buttons(yesLabel, trustLabel, noLabel)`）。
  const order = dialog.match(/messageButtons\(\['([a-z]+)', '([a-z]+)', '([a-z]+)'\], \{\n\s+no: EXTERNAL_LINK_LABELS\.open, yes: EXTERNAL_LINK_LABELS\.trust, cancel: EXTERNAL_LINK_LABELS\.cancel/)
  assert.ok(order, '链接那一档的按钮表按上游顺序组')
  assert.deepEqual(order?.slice(1, 4), ['no', 'yes', 'cancel'])
  // 链接模式没有 doNotAsk（上游那一句没有「不再询问」），信任档才有。
  assert.match(dialog, /doNotAsk: TRUST_REMEMBER_LABEL,/, '只有启动那一档带「以后不再询问」')
  assert.equal(externalLinkPrompt('https://jetbrains.com', 'D:/Work/P', [])?.focused, 'trust',
    '焦点在「信任项目并打开」（:80）')
})

test('答完之后：Open 放行但不记信任，Trust 才写清单（:82-84）', () => {
  const opened = externalLinkOutcome('open', 'D:/Work/P', [])
  assert.equal(opened.open, true)
  assert.deepEqual(opened.entries, [], '答 Open 什么都不写')
  const trusted = externalLinkOutcome('trust', 'D:/Work/P', [])
  assert.equal(trusted.open, true)
  assert.deepEqual(trusted.entries, [{ path: 'd:/work/p', trusted: true }])
  const canceled = externalLinkOutcome('cancel', 'D:/Work/P', [])
  assert.equal(canceled.open, false, '取消不开（:85）')
})

test('已信任的项目根本不问这一句（:69-71）', () => {
  assert.equal(externalLinkPrompt('https://a', 'D:/Work/P', [{ path: 'd:/work/p', trusted: true }]), null)
})

test('trust-all 落库的两条路径：勾了写父目录，配置目录里不写', () => {
  assert.deepEqual(trustDecisionPaths('trust', 'D:/Work/Proj', true, 'C:/Users/me/.taocode'),
    [{ path: 'd:/work/proj', trusted: true }, { path: 'd:/work', trusted: true }])
  assert.deepEqual(trustDecisionPaths('trust', 'D:/Work/Proj', false, 'C:/Users/me/.taocode'),
    [{ path: 'd:/work/proj', trusted: true }], '没勾只记项目根')
  const insideConfig = 'C:/Users/me/.taocode/projects/mirror'
  assert.equal(isProjectLocationOfferedForTrust(insideConfig, 'C:/Users/me/.taocode'), false)
  assert.deepEqual(trustDecisionPaths('trust', insideConfig, true, 'C:/Users/me/.taocode'),
    [{ path: 'c:/users/me/.taocode/projects/mirror', trusted: true }], '配置目录里的项目不给父目录')
  assert.deepEqual(trustDecisionPaths('distrust', 'D:/Work/Proj', true, null),
    [{ path: 'd:/work/proj', trusted: false }], '安全模式那一路不接受 trust-all')
  assert.deepEqual(trustDecisionPaths('cancel', 'D:/Work/Proj', true, null), [], '取消什么都不记')
})

test('App.vue 那两行还没接；会话级那份已并进模块真源（R4 落、W3/W2 未落）', () => {
  const host = read('../src/App.vue')
  const mount = host.split('\n').find(line => line.includes('<TrustedProjectDialog'))
  assert.ok(mount, '信任框仍挂在宿主上')
  assert.ok(!mount.includes('canTrustAll'), 'trust-all 的宿主那一行 = 接线请求 W3，未落')
  assert.ok(!host.includes('resolveLink'), '链接那一句的宿主挂点 = 接线请求 W2，未落')
  // 原写「会话级那一档还在宿主自己的 ref 里（两处 = 接线请求 W3b）」——那是钉**未接线**形状的门禁。
  // 2026-10-06 trust4 落 R4：宿主自留的 `sessionTrust` ref 删掉，读写都走 trustedProjects 的那一份，
  // 所以这里按正向钉（细则判据 tests/trusted-session-single-source.test.mjs）。
  const lifecycle = read('../src/workspaceLifecycle.ts')
  assert.ok(!/sessionTrust\.value/.test(lifecycle), '宿主不再有第二份会话级信任')
  assert.match(lifecycle, /mergeTrustEntries\(generalSettings\.value\?\.trustedPaths, sessionTrustEntries\(\)\)/,
    '门禁的会话档 = 模块真源（上游两侧同一个 TrustedPaths.getInstance()）')
  assert.match(lifecycle, /rememberSessionTrust\(root, choice === 'trust'\)/,
    '没勾「以后不再询问」的答话写进同一份真源')
})

// ── 一条完整的出口：browseWithTrustCheck（上游 `browse()` 里那个 `canBrowse` 的等价物）──
// 本仓有四处 URL 出口（App.vue 两条 + TerminalPanel + quickDocHost），逐处各判一次必漏，
// 所以判定与副作用都在这一条函数里（上游也只有一个 browse，`:88-112`）。
function harness({ root, entries = [], choice = 'open' }) {
  const opened = []
  const saved = []
  const asked = []
  const run = browseWithTrustCheck('  https://jetbrains.com  ', {
    root: () => root,
    entries: () => entries,
    ask: async prompt => { asked.push(prompt); return choice },
    save: next => { saved.push(next.map(entry => ({ ...entry }))) },
    open: url => { opened.push(url) },
  })
  return { run, opened, saved, asked }
}

test('未信任 + 答「打开」：开了，但清单一个字都不写（:82-83）', async () => {
  const box = harness({ root: 'D:/Work/P' })
  assert.equal(await box.run, 'opened')
  assert.deepEqual(box.opened, ['https://jetbrains.com'], 'URL 先 trim（:96）')
  assert.equal(box.asked.length, 1, '问了那一句')
  assert.equal(box.asked[0].labels, EXTERNAL_LINK_LABELS, '按钮表就是 trustedProjects 给的那一份')
  assert.equal(box.asked[0].focused, 'trust', '焦点在「信任项目并打开」（:80）')
  assert.deepEqual(box.saved, [], '答 Open 不落库')
})

test('未信任 + 答「信任项目并打开」：先写清单再开（:84）', async () => {
  const box = harness({ root: 'D:/Work/P', choice: 'trust' })
  assert.equal(await box.run, 'opened')
  assert.deepEqual(box.saved, [[{ path: 'd:/work/p', trusted: true }]])
  assert.deepEqual(box.opened, ['https://jetbrains.com'])
})

test('未信任 + 答「取消」：不开也不写（:85）', async () => {
  const box = harness({ root: 'D:/Work/P', choice: 'cancel' })
  assert.equal(await box.run, 'canceled')
  assert.deepEqual(box.opened, [])
  assert.deepEqual(box.saved, [])
})

test('已信任 / 没开项目：根本不问这一句（:60-62 与 :69-71）', async () => {
  const trusted = harness({ root: 'D:/Work/P', entries: [{ path: 'd:/work/p', trusted: true }] })
  assert.equal(await trusted.run, 'opened')
  assert.deepEqual(trusted.asked, [], '已信任不问')
  const noProject = harness({ root: null })
  assert.equal(await noProject.run, 'opened')
  assert.deepEqual(noProject.asked, [], '没开项目 = 上游的 project == null 那一档')
})
