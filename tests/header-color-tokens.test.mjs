// 顶栏配色 = 「月相」浮层族的角色映射 + 两档的字面值。
//
// 2026-09-28 的分工调整（桃：「颜色可以修改为适合我们的颜色，符合月之亮面／月之暗面动态调整，
// 但布局要严格符合源码」）之后，这个文件钉的是**两件事**：
//   · **角色→键**：顶栏为什么在浅色主题里也是深的、失焦为什么要换色、运行图标为什么不上色 ——
//     这三条是 IDEA 的结构，逐条带 file:line，**不许因为换色而丢**；
//   · **值**：换成我们自己的月相夜面（`--m-night*`），两档各一套，切换只换月相层。
// 上游被替换掉的原字面量留在每条断言的消息里，改的人一眼看得见"我们偏离了哪一行"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const tokens = read('src/tokens.css')
const style = read('src/style.css')
const darkAt = tokens.indexOf("[data-theme='dark']")
assert.ok(darkAt > 0, 'tokens.css 里找不到深色主题块')
const lightBlock = tokens.slice(0, darkAt)
const darkBlock = tokens.slice(darkAt)

function tokenOf(block, name) {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)
  return match?.[1].trim().toLowerCase()
}

test('角色→键的映射照上游，一条都没在换色时丢掉', () => {
  // JBUI.java:564-572 + ToolbarFrameHeader.kt:424-427 + ProjectFrameCustomHeaderHelper.kt:361
  // ⇒ 标题行与独立成行的主工具栏读**同一个键**，所以两行必须同色（都指 --header-bg）。
  assert.equal(tokenOf(lightBlock, 'header-bg'), 'var(--m-night)')
  assert.equal(tokenOf(lightBlock, 'header-bg-inactive'), 'var(--m-night-inactive)',
    'CustomHeader.kt:166-168 记 isActive ⇒ 失焦必须换色')
  assert.equal(tokenOf(lightBlock, 'header-fg'), 'var(--m-night-fg)')
  assert.equal(tokenOf(lightBlock, 'header-hover'), 'var(--m-night-hover)',
    '上游 Icon.hoverBackground 与 pressedBackground 同值（expUI_light:766-767）')
  assert.equal(tokenOf(lightBlock, 'header-line'), 'var(--m-night-line)', '上游 separatorColor')
  assert.equal(tokenOf(lightBlock, 'header-run-bg'), 'var(--m-night-run)',
    'RunWidget.runningBackground（expUI_light:1096）：只有运行中那一格有绿底')
  assert.equal(tokenOf(lightBlock, 'header-run-hover'), 'var(--m-night-run-hover)')
  assert.equal(tokenOf(lightBlock, 'm-night-run-hover'), '#00000019',
    'RunWidget.hoverBackground（:1098）是**叠黑**，不是叠白')
  assert.equal(tokenOf(darkBlock, 'm-night-run-hover'), '#00000019', '两档同值（上游两套主题这一对字面量相同）')
  assert.equal(tokenOf(lightBlock, 'm-night-run-pressed'), '#00000028', '同上 :1099')
  // FilenameToolbarWidgetAction.kt:67-70：深色顶栏上的状态色 = 同名 key 的"另一面"。
  assert.equal(tokenOf(lightBlock, 'header-accent'), 'var(--m-night-accent)')
  assert.equal(tokenOf(lightBlock, 'header-success'), 'var(--m-night-success)')
  assert.equal(tokenOf(lightBlock, 'header-error'), 'var(--m-night-error)')
})

test('月之亮面：顶栏是夜面（浅色主题也是深的），值取自我们的月相层', () => {
  assert.equal(tokenOf(lightBlock, 'm-night'), '#16202f', '替换掉上游 Gray2 #27282E（expUI_light:760）')
  assert.equal(tokenOf(lightBlock, 'm-night-inactive'), '#243044', '替换掉上游 Gray3 #383A42（:762）')
  assert.equal(tokenOf(lightBlock, 'm-night-fg'), '#e7edf6', '替换掉上游 Gray12 #EBECF0（:761）')
  assert.equal(tokenOf(lightBlock, 'm-night-hover'), '#24324a', '替换掉上游 Gray3（:766-767）')
  assert.equal(tokenOf(lightBlock, 'm-night-line'), '#33415a', '替换掉上游 Gray4 #494B57（:763）')
  assert.equal(tokenOf(lightBlock, 'm-night-run'), '#4e9a6a', '替换掉上游 #599E5E（:1096）')
})

test('月之暗面：夜面再深一档，且失焦**不变色**（上游深色主题没有那个键）', () => {
  assert.equal(tokenOf(darkBlock, 'm-night'), '#0b101a', '替换掉上游 Gray2 #2B2D30（expUI_dark:757）')
  assert.equal(tokenOf(darkBlock, 'm-night-inactive'), tokenOf(darkBlock, 'm-night'),
    'JBUI.java:570：没有 inactiveBackground 键时回退到激活色本身 —— 深色主题失焦不变色是上游行为')
  assert.equal(tokenOf(darkBlock, 'm-night-fg'), '#dfe6f0', '替换掉上游 Gray12 #DFE1E5（:1063-1064）')
  assert.equal(tokenOf(darkBlock, 'm-night-hover'), '#1a2333', '替换掉上游 Gray3 #393B40（:749）')
  assert.equal(tokenOf(darkBlock, 'm-night-line'), '#26303f', '替换掉上游 Gray4 #43454A（:758）')
  assert.equal(tokenOf(darkBlock, 'm-night-run'), '#52915f', '替换掉上游 Green6 #57965C（:1065）')
})

test('顶栏与其中控件走 header 令牌，不再走面板令牌', () => {
  assert.match(style, /\.topbar \{[^}]*background-color: var\(--header-bg\)/, '顶栏底色必须是 header 令牌')
  assert.match(style, /\.topbar \{[^}]*background-image: var\(--project-tint, none\)/,
    '项目色（differentiateProjects）必须是**叠在底色上的图层**，不是替换底色')
  assert.doesNotMatch(style, /\.topbar \{[^}]*background: var\(--project-tint/,
    '用 `background: var(--project-tint, …)` 二选一 = 带项目色时底色变透明，深色文字/浅色文字都会糊掉')
  assert.doesNotMatch(style, /\.topbar \{[^}]*var\(--rail\)/, '顶栏又用回 --rail（浅色主题下会变成浅灰条）')
  assert.match(style, /\.topbar \.menu-button, \.topbar \.header-widget, \.topbar \.icon-button \{ color: var\(--header-fg\); \}/,
    '顶栏里的控件没有跟随深色面换字色')
  assert.match(style, /html\[data-window-active='inactive'\] \.topbar/, '失焦换色没有接线')
  assert.match(style, /\.run-button\.running \{ background: var\(--header-run-bg\)/,
    '运行中那一格应当是绿底（RunWidget.runningBackground），不是红字')
  assert.doesNotMatch(style, /\.run-button \{ color: var\(--success/,
    'RunWidget.iconColor 与前景同色（expUI_light:1095）—— 播放图标不上色')
})

test('深色顶栏上的状态色取同名 key 的另一面（文件名 widget 的三态）', () => {
  assert.match(style, /\.topbar \.filename-button\.filename-modified \{ color: var\(--header-accent\); \}/,
    '行面上的文件名状态色没换到深色版本（浅色主题的 --accent 在夜面上几乎看不见）')
  assert.ok(!/\.topbar \.filename-popup[^{]*\{[^}]*color:/.test(style),
    '弹层里的行仍应走浅色面板那组状态色 —— 不该被 .topbar 的深色规则连带覆盖')
})
