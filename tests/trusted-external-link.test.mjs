// 打开外部链接前的那一句确认（`pf/browsers` ⑤ 的菜单/门控面 + `pf/trusted` 的链接那一支）。
// 上游依据（逐行核过）：
//   · `platform/platform-impl/src/com/intellij/ide/browsers/BrowserLauncherImpl.kt:59-87` `canBrowse`
//     —— 已信任直接开（`:69-71`）；未信任弹警告框，按钮 Open / Trust Project and Open / Cancel
//     （`:72-78`），默认按钮 Open（`:79`）、**焦点**在 trust（`:80`）；
//     Open 开但不写清单（`:82`），trust 写 `setProjectTrusted` 再开（`:83`），其它不开（`:84`）；
//   · 文案：`platform/platform-api/resources/messages/IdeBundle.properties:3149`（Open Link）/
//     `:3151`（正文，URL 单独一行）/ `:3152`（Open）/ `:3153`（Trust Project and Open）/
//     `:3154`（Trust File and Open，文件级那一支，本仓做不到）；
//   · 文件级那一条 `confirmOpeningUntrustedFile` 在同文件 `:89-108`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EXTERNAL_LINK_LABELS, EXTERNAL_LINK_TITLE, externalLinkMessage, externalLinkOutcome, externalLinkPrompt,
} from '../src/trustedProjects.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const ENTRIES = [{ path: 'd:/work/alpha', trusted: true }]

test('项目已信任 ⇒ 不问，直接开（BrowserLauncherImpl.kt:69-71）', () => {
  assert.equal(externalLinkPrompt('https://example.com', 'd:/work/alpha', ENTRIES), null)
  assert.equal(externalLinkPrompt('https://example.com', 'd:/work/alpha/sub', ENTRIES), null, '最近祖先命中同样放行')
})

test('项目没信任 ⇒ 给三句话：打开 / 信任项目并打开 / 取消', () => {
  const prompt = externalLinkPrompt('https://example.com/docs', 'd:/other/proj', ENTRIES)
  assert.ok(prompt)
  assert.deepEqual(prompt.labels, { open: '打开', trust: '信任项目并打开', cancel: '取消' })
  assert.equal(EXTERNAL_LINK_TITLE, '打开链接')
  assert.equal(prompt.focused, 'trust', '焦点在「信任项目并打开」（:80 的 focusedButton）')
  assert.match(prompt.message, /https:\/\/example\.com\/docs$/, 'URL 在正文最后一行（message.0 的 {0}）')
})

test('答「信任项目并打开」：开，并把项目写进信任清单（:83 的 setProjectTrusted）', () => {
  const before = externalLinkOutcome('trust', 'D:/Other/Proj', ENTRIES)
  assert.equal(before.open, true)
  assert.deepEqual(before.entries.map(entry => entry.path), ['d:/work/alpha', 'd:/other/proj'])
  assert.equal(externalLinkPrompt('https://x', 'd:/other/proj', before.entries), null, '写过之后同一会话里不再问')
})

test('答「打开」：开，但**不**写信任清单（:82 与 :83 的分别是重点）', () => {
  const once = externalLinkOutcome('open', 'd:/other/proj', ENTRIES)
  assert.equal(once.open, true)
  assert.deepEqual(once.entries, ENTRIES, '一次性的「打开」不能变成永久信任')
  assert.ok(externalLinkPrompt('https://x', 'd:/other/proj', once.entries), '下次还是要问')
})

test('答「取消」/ 关窗：不开也不写（:84）', () => {
  const cancelled = externalLinkOutcome('cancel', 'd:/other/proj', ENTRIES)
  assert.equal(cancelled.open, false)
  assert.deepEqual(cancelled.entries, ENTRIES)
})

test('没有工作区根时也答 trust 不会写出半条记录', () => {
  const result = externalLinkOutcome('trust', '', ENTRIES)
  assert.equal(result.open, true, '上游 setProjectTrusted 需要一个 project，本仓没根时只放行不写清单')
  assert.deepEqual(result.entries, ENTRIES)
})

test('清单里显式不信任的条目不会被「打开」这一答洗白', () => {
  const distrusted = [{ path: 'd:/other/proj', trusted: false }]
  const prompt = externalLinkPrompt('https://x', 'd:/other/proj', distrusted)
  assert.ok(prompt, '显式不信任仍然要问')
  assert.deepEqual(externalLinkOutcome('open', 'd:/other/proj', distrusted).entries, distrusted)
})

test('外部链接这一问要接在真的 URL 出口上（宿主只有 shell.openUrl 这一条）', () => {
  const rules = read('src/trustedProjects.ts')
  assert.match(rules, /if \(isProjectTrusted\(root, entries\)\) return null/)
  assert.match(rules, /return \{ open: choice !== 'cancel', entries: current \}/)
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /'shell\.openUrl'/, 'URL 出口就是这一条：信任门控要接在它的调用点前面')
})
