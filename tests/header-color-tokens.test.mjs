// 顶栏配色 = 「月相」浮层族的角色映射 + 两档的字面值。
//
// 2026-09-28 的分工调整（桃：「颜色可以修改为适合我们的颜色，符合月之亮面／月之暗面动态调整，
// 但布局要严格符合源码」）之后，这个文件钉的是**两件事**：
//   · **角色→键**：顶栏为什么两行必须同色、失焦为什么要换色、运行中那一格的图标为什么单独换色 ——
//     这三条是 IDEA 的结构（`mainToolbarBackground(active)` 的第二参数是**窗口激活态**、不是亮暗），
//     逐条带 file:line，**不许因为换色而丢**；
//   · **值**：换成我们自己的月相 chrome 层（`--m-chrome*`），两档各一套，切换只换月相层。
// 上游被替换掉的原字面量留在每条断言的消息里，改的人一眼看得见"我们偏离了哪一行"。
//
// 2026-10-03（批次 87-B）：亮面下顶栏**由深改亮**。依据是上游本来就有两份角色集相同、只换值的主题 ——
// 亮面那份是 `expUI_light_with_light_header.theme.json`（MainToolbar.background = Gray13、
// foreground = Gray1、inactiveBackground = Gray12、separatorColor = Gray11；RunWidget
// runningBackground = Green5、runningIconColor = Gray14、hover #00000022、pressed #00000028）。
// 桃的原话是「亮面模式下的上边栏颜色不合理」与「配色不需要严格对齐上游，按你的设计来」——
// 事实是两份上游主题都存在，选亮的那份与月相族更自洽（深字压亮底，与 --m-bright/--m-text 同色阶）。
// 这一族因此从 `--m-night*` 改名 `--m-chrome*`：亮面下它不再"夜"，叫 night 就是个谎。
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
  assert.equal(tokenOf(lightBlock, 'header-bg'), 'var(--m-chrome)')
  assert.equal(tokenOf(lightBlock, 'header-bg-inactive'), 'var(--m-chrome-inactive)',
    'CustomHeader.kt:166-168 记 isActive = window.isActive ⇒ 失焦必须换色')
  assert.equal(tokenOf(lightBlock, 'header-fg'), 'var(--m-chrome-fg)')
  assert.equal(tokenOf(lightBlock, 'header-hover'), 'var(--m-chrome-hover)',
    '上游 Icon.hoverBackground 与 pressedBackground 是同一个值（两份主题都只给一个）')
  assert.equal(tokenOf(lightBlock, 'header-line'), 'var(--m-chrome-line)', '上游 separatorColor')
  assert.equal(tokenOf(lightBlock, 'header-run-bg'), 'var(--m-chrome-run)',
    'RunWidget.runningBackground：只有运行中那一格有底色（浅顶栏那份 = Green5）')
  assert.equal(tokenOf(lightBlock, 'header-run-hover'), 'var(--m-chrome-run-hover)',
    'RunWidget 自己带一对 hover/pressed，不并进 --header-hover')
  assert.equal(tokenOf(lightBlock, 'm-chrome-run-hover'), '#00000019',
    '叠黑不叠白：深顶栏那份字面量就是 #00000019（expUI_light:1098），浅顶栏那份是 #00000022；两档统一取深的一档')
  assert.equal(tokenOf(darkBlock, 'm-chrome-run-hover'), '#00000019', '暗面照旧')
  assert.equal(tokenOf(lightBlock, 'm-chrome-run-pressed'), '#00000028', '同上 :1099')
  // 运行中那一格的**图标单独换色**这条不能丢：深顶栏 Gray12 = 前景（即 --header-fg 本身），
  // 浅顶栏 Gray14 = 白压 Green5。两者差得远 ⇒ 必须是独立的一个键。
  assert.equal(tokenOf(lightBlock, 'header-run-fg'), 'var(--m-chrome-run-fg)',
    'runningIconColor 必须是自己的键；复用 --header-fg 会让亮面变成"深字压绿底"')
  assert.match(style, /\.run-button\.running \{[^}]*color: var\(--header-run-fg\)/, '运行中那一格没取 --header-run-fg')
  // FilenameToolbarWidgetAction.kt:67-70：只有 `isDarkToolbar()` 时状态色才取 "Dark" 配色里同一个 colorKey。
  assert.equal(tokenOf(lightBlock, 'header-accent'), 'var(--m-chrome-accent)')
  assert.equal(tokenOf(lightBlock, 'm-chrome-accent'), 'var(--m-accent)', '亮顶栏上不需要"另一面"的月相蓝')
  assert.equal(tokenOf(lightBlock, 'm-chrome-success'), 'var(--m-success)')
  assert.equal(tokenOf(lightBlock, 'm-chrome-error'), 'var(--m-error)')
  // 暗面仍在深顶栏上，状态色还是"另一面"（这一面没改，别顺手改掉）。
  assert.equal(tokenOf(darkBlock, 'm-chrome-accent'), '#7fa9e8', '暗顶栏上的状态色 = 同名 key 的亮面版本')
})

test('月之亮面：顶栏是亮面（跟上游那份浅顶栏主题，值换成月相族）', () => {
  assert.equal(tokenOf(lightBlock, 'm-chrome'), '#f8fafc', '替换掉上游 Gray13（expUI_light_with_light_header MainToolbar）')
  assert.equal(tokenOf(lightBlock, 'm-chrome-inactive'), '#f1f4f8', '替换掉上游 Gray12（失焦比激活更淡）')
  assert.equal(tokenOf(lightBlock, 'm-chrome-fg'), '#2f3a4e', '替换掉上游 Gray1 #000000')
  assert.equal(tokenOf(lightBlock, 'm-chrome-hover'), '#e3e9f2', '替换掉上游 #00000022 的浅色化版本')
  assert.equal(tokenOf(lightBlock, 'm-chrome-line'), '#d6dde8', '替换掉上游 Gray11')
  assert.equal(tokenOf(lightBlock, 'm-chrome-run'), '#2e8a5a', '替换掉上游 Green5')
  assert.equal(tokenOf(lightBlock, 'm-chrome-run-fg'), '#ffffff', '替换掉上游 runningIconColor Gray14（白压绿）')
  // 与月相族的关系：顶栏要比面板亮（自成一"层"），但不能亮过编辑区，字也必须够深。
  const lum = hex => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) * .299 + (n >> 8 & 255) * .587 + (n & 255) * .114 }
  assert.ok(lum(tokenOf(lightBlock, 'm-chrome')) >= lum(tokenOf(lightBlock, 'm-panel')),
    '顶栏必须比 --m-panel(#f4f7fb) 亮，否则顶栏与面板糊成一片')
  assert.ok(lum(tokenOf(lightBlock, 'm-chrome')) < lum(tokenOf(lightBlock, 'm-editor')),
    '顶栏不要亮过 --m-editor(#fcfdff)，否则它会跟内容区抢注意力')
  assert.ok(lum(tokenOf(lightBlock, 'm-chrome-fg')) < lum(tokenOf(lightBlock, 'm-chrome')) * .5,
    '亮顶栏上的字必须是深字 —— 亮字压亮底看不见，那正是这次要修的毛病')
})

test('月之暗面：顶栏再深一档，且失焦**不变色**（上游深色主题没有那个键）', () => {
  assert.equal(tokenOf(darkBlock, 'm-chrome'), '#0b101a', '替换掉上游 Gray2 #2B2D30（expUI_dark:757）')
  assert.equal(tokenOf(darkBlock, 'm-chrome-inactive'), tokenOf(darkBlock, 'm-chrome'),
    'JBUI.java:570：没有 inactiveBackground 键时回退到激活色本身 —— 深色主题失焦不变色是上游行为')
  assert.equal(tokenOf(darkBlock, 'm-chrome-fg'), '#dfe6f0', '替换掉上游 Gray12 #DFE1E5（:1063-1064）')
  assert.equal(tokenOf(darkBlock, 'm-chrome-hover'), '#1a2333', '替换掉上游 Gray3 #393B40（:749）')
  assert.equal(tokenOf(darkBlock, 'm-chrome-line'), '#26303f', '替换掉上游 Gray4 #43454A（:758）')
  assert.equal(tokenOf(darkBlock, 'm-chrome-run'), '#52915f', '替换掉上游 Green6 #57965C（:1065）')
  assert.equal(tokenOf(darkBlock, 'm-chrome-run-fg'), '#dfe6f0', '深顶栏上 runningIconColor = 前景（同 Gray12）')
})

test('这一族已经改名成 chrome —— 亮面下顶栏不再"夜"，残留的 --m-night 是不一致', () => {
  assert.doesNotMatch(tokens, /--m-night/, 'tokens.css 里还有 --m-night* 残留')
  assert.doesNotMatch(tokens + style, /var\(--m-night/, '还有地方在引用 --m-night*')
})

test('顶栏与其中控件走 header 令牌，不再走面板令牌', () => {
  assert.match(style, /\.topbar \{[^}]*background-color: var\(--header-bg\)/, '顶栏底色必须是 header 令牌')
  assert.match(style, /\.topbar \{[^}]*background-image: var\(--project-tint, none\)/,
    '项目色（differentiateProjects）必须是**叠在底色上的图层**，不是替换底色')
  assert.doesNotMatch(style, /\.topbar \{[^}]*background: var\(--project-tint/,
    '用 `background: var(--project-tint, …)` 二选一 = 带项目色时底色变透明，顶栏字色会跟项目色撞掉')
  assert.doesNotMatch(style, /\.topbar \{[^}]*var\(--rail\)/, '顶栏又用回 --rail（会与面板同色，边界消失）')
  assert.match(style, /\.topbar \.menu-button, \.topbar \.header-widget, \.topbar \.icon-button \{ color: var\(--header-fg\); \}/,
    '顶栏里的控件没有跟随顶栏前景换字色')
  assert.match(style, /html\[data-window-active='inactive'\] \.topbar/, '失焦换色没有接线')
  assert.match(style, /\.run-button\.running \{ background: var\(--header-run-bg\)/,
    '运行中那一格应当是绿底（RunWidget.runningBackground），不是红字')
  assert.doesNotMatch(style, /\.run-button \{ color: var\(--success/,
    'RunWidget.iconColor 与前景同色（expUI_light:1095）—— 播放图标不上色')
})

test('行面上的状态色走 header 状态令牌（文件名 widget 的三态）', () => {
  assert.match(style, /\.topbar \.filename-button\.filename-modified \{ color: var\(--header-accent\); \}/,
    '文件名状态色没接到 header 状态色上')
  assert.ok(!/\.topbar \.filename-popup[^{]*\{[^}]*color:/.test(style),
    '弹层里的行仍应走面板那组状态色 —— 不该被 .topbar 的规则连带覆盖')
})