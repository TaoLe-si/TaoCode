// 文档浏览的前进/后退历史（`src/quickDocHistory.ts`）—— 上游
// `platform/lang-impl/src/com/intellij/lang/documentation/ide/impl/DocumentationBrowserHistory.kt:7-48`
// 的等价物，逐条照抄：
//   · `nextPage()`（:43-47）点进新页：把**当前**快照压进 backStack，并**清空** forwardStack；
//   · `backward()`（:20-24）先把当前快照压进 forwardStack，再弹 backStack 交给 restore；
//   · `forward()`（:31-35）对称；
//   · `canBackward()`（:15-18）/`canForward()`（:26-29）就是「对应栈非空」——
//     `DocumentationBackAction.kt:14` / `DocumentationForwardAction.kt:14` 据此置灰；
//   · `clear()`（:37-41）。
// 键位来自 `platform/lang-impl/resources/intellij.platform.lang.impl.actions.xml:46-49`
// （两个动作都 `use-shortcut-of`，实际键是 `$default.xml` 里 Back/Forward 的 Ctrl+Alt+左/右）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_HISTORY_LIMIT, createDocumentationHistory } from '../src/quickDocHistory.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = path => readFileSync(join(root, path), 'utf8')

/** 一个「页面栈 + 当前页」的最小模型，够用且能看出 restore 的先后。 */
function fixture(pages) {
  let current = pages[0]
  const log = []
  const history = createDocumentationHistory(
    () => current,
    value => { log.push(['restore', value]); current = value },
  )
  return { history, get current() { return current }, log }
}

test('空栈时两个方向都不可用（上游据此把动作置灰）', () => {
  const { history } = fixture(['A'])
  assert.equal(history.canBackward(), false)
  assert.equal(history.canForward(), false)
  assert.equal(history.backward(), false, '栈空时不 restore、返回 false')
  assert.equal(history.forward(), false)
  assert.equal(history.size(), 0)
})

test('nextPage 压当前页并清空前进栈（上游 :43-47）', () => {
  const f = fixture(['A'])
  f.history.nextPage()
  assert.equal(f.history.canBackward(), true)
  // 先能前进（上一轮留下的），再 nextPage 就必须把它清掉。
  f.history.backward()
  assert.equal(f.history.canForward(), true)
  f.history.nextPage()
  assert.equal(f.history.canForward(), false, '点进新的一页，「前进」那一侧的历史就没意义了')
})

test('backward 是「先把当前压进前进栈，再弹上一页」，顺序与上游逐行一致', () => {
  const pages = ['A', 'B', 'C']
  let index = 0
  const current = () => pages[index]
  const order = []
  const history = createDocumentationHistory(current, value => { order.push(value) })
  history.nextPage() // 在 A 上点进 B
  index = 1
  history.nextPage() // 在 B 上点进 C
  index = 2
  assert.equal(history.size(), 2)
  history.backward()
  assert.deepEqual(order, ['B'], 'restore 到的正是上一页')
  index = 1
  history.backward()
  assert.deepEqual(order.at(-1), 'A')
  index = 0
  assert.equal(history.canBackward(), false)
  assert.equal(history.canForward(), true, '两次后退都留下了可前进的一步')
})

test('forward 与 backward 对称；走完就不可再走', () => {
  const pages = ['A', 'B']
  let index = 0
  const restored = []
  const history = createDocumentationHistory(() => pages[index], value => { restored.push(value) })
  history.nextPage()
  index = 1
  history.backward()
  index = 0
  assert.equal(history.canForward(), true)
  history.forward()
  assert.deepEqual(restored.at(-1), 'B', '前进落回刚才退掉的那一页')
  index = 1
  assert.equal(history.canForward(), false)
  assert.equal(history.canBackward(), true, '前进回去之后，后退又可用了')
})

test('clear 之后两个方向都不可用，但当前页不动', () => {
  const f = fixture(['A', 'B'])
  f.history.nextPage()
  f.history.clear()
  assert.equal(f.history.size(), 0)
  assert.equal(f.history.canBackward(), false)
  assert.equal(f.history.canForward(), false)
  assert.equal(f.current, 'A')
})

test('本仓的差异：栈有上限（默认 32），裁的是最旧那一端', () => {
  assert.equal(DEFAULT_HISTORY_LIMIT, 32)
  const f = fixture(['A'])
  for (let step = 0; step < 40; ++step) f.history.nextPage()
  assert.equal(f.history.size(), DEFAULT_HISTORY_LIMIT, '超限不无限涨（一个符号能点出上百条 javadoc 链接）')
  // 丢掉的是最旧的 ⇒ 后退到底只能到第 9 次那一步（前 8 步已被裁）。
  let reached = 0
  while (f.history.canBackward()) { f.history.backward(); ++reached }
  assert.equal(reached, DEFAULT_HISTORY_LIMIT)
})

test('接线：宿主真的在「点进新页」时压历史，自动刷新不压', () => {
  const host = source('src/quickDocHost.ts')
  assert.match(host, /createDocumentationHistory</, '宿主没有建历史')
  assert.match(host, /history\.nextPage\(\)/, '翻页没有压历史（上游 nextPage 就是被这一步调用）')
  assert.match(host, /if \(remember && quickDoc\.value\) history\.nextPage\(\)/, '压栈条件丢了：自动刷新也会压历史')
  assert.match(host, /showAt\(current\.line, current\.column, current\.path, false\)/, '自动刷新那一拍不该 remember')
})

test('接线：弹层的前进/后退按 disabled 走，键位与上游 use-shortcut-of 一致', () => {
  const popup = source('src/components/QuickDocPopup.vue')
  assert.match(popup, /:disabled="!canBackward"/, '后退按钮没有按 canBackward 置灰')
  assert.match(popup, /:disabled="!canForward"/, '前进按钮没有按 canForward 置灰')
  assert.match(popup, /ArrowLeft.*emit\('back'\)/s, '后退没有落进行为')
  assert.match(popup, /ArrowRight.*emit\('forward'\)/s, '前进没有落进行为')
  assert.match(popup, /ctrlKey[\s\S]{0,80}altKey/, 'Ctrl+Alt+左/右（Documentation.Back/Forward 继承的键）没有实现')
  assert.match(popup, /intellij\.platform\.lang\.impl\.actions\.xml:46-53/, '键位的上游出处没有登记')
  assert.match(popup, /canOpenExternal/, '「在浏览器中打开」的可点性没有透到按钮上')
})
