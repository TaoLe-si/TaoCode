// 底部停靠的工具窗口必须能搬回左/右栏。
//
// 起因（2026-09-28，用户实测）：「项目」用标题栏菜单「移动到底部」之后，左栏就不再渲染它的
// 标题栏 —— 而「移动到 左侧/右侧/底部」这三条**只**挂在 `ToolWindowHeader` 上，于是这个操作是单向的，
// 窗口再也回不去。IDEA 的头部属于窗口本身、跟着窗口出现在它停靠的那个 dock 里
// （ToolWindowHeader.kt:119 起），底部窗口同样能改锚点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const app = read('src/App.vue')
const actions = read('src/toolWindowActions.ts')
const menu = read('src/components/ToolWindowAnchorMenu.vue')
const header = read('src/components/ToolWindowHeader.vue')
const css = read('src/style.css')

test('底部 dock 的工具窗口标签带右键入口', () => {
  assert.match(app, /v-for="id in bottomAnchoredIds"[\s\S]{0,400}@contextmenu\.prevent="openAnchorMenu\(id, \$event\)"/,
    '底部标签没有右键菜单 —— 沉到底部的窗口就没有任何入口改锚点')
  assert.match(app, /<Teleport v-if="anchorMenu" to="body"><ToolWindowAnchorMenu :anchor="anchorMenuAnchor"/,
    '锚点菜单要 Teleport 到 body（底部 dock 有 overflow，挂里面会被裁掉）')
  assert.match(css, /\.tool-anchor-menu \{ position: fixed; top: auto; right: auto; \}/,
    '菜单吃到了 .tool-menu 的 absolute/top/right，会贴到父容器而不是指针位置')
})

test('锚点菜单的三条与标题栏那三条同源（标签、方向、当前项置灰）', () => {
  // UIBundle `tool.window.move.to.action.group.name` 只给 Left / Right / Bottom 三个方向。
  for (const label of ['移动到左侧', '移动到右侧', '移动到底部']) {
    assert.ok(menu.includes(label), `锚点菜单少了「${label}」`)
    assert.ok(header.includes(label), `标题栏少了「${label}」—— 两个入口的文案不能各写一套`)
  }
  assert.match(menu, /:disabled="anchor === item\.side"/, '已经在这一侧的项必须置灰，否则用户不知道现在在哪')
  assert.doesNotMatch(menu, /'top'|移动到顶部/, 'IDEA 的锚点没有"顶部"（ToolWindowAnchor 只有 left/right/bottom）')
})

test('moveAnchorTo：换锚点 → 持久化 → 按新位置亮出来', () => {
  const body = actions.slice(actions.indexOf('function moveAnchorTo'), actions.indexOf('function moveAnchorTo') + 900)
  assert.match(body, /ctx\.setToolAnchor\(target\.id, side\)/)
  assert.match(body, /ctx\.saveToolAnchors\(\)/, '不落盘的话重启又回底部（锚点是随项目保存的布局的一部分）')
  assert.match(body, /ctx\.showView\(target\.id\)/, '换完锚点必须按**新**位置显示；showView 内部按 activationTarget 选 dock')
  assert.match(body, /if \(\(ctx\.toolAnchors\(\)\[target\.id\] \?\? 'left'\) === side\) return/,
    '点"当前所在的一侧"应当什么都不做，而不是把窗口关掉再开')
  // 反例：菜单项没置灰时，这条 no-op 是唯一防线 —— 它必须在 setToolAnchor **之前**。
  assert.ok(body.indexOf('=== side) return') < body.indexOf('ctx.setToolAnchor'), 'no-op 判断写晚了')
})

test('禁用/不可用的工具窗口不开菜单，菜单也只服务真有的窗口', () => {
  assert.match(actions, /function openAnchorMenu\(id: string, event: MouseEvent\) \{\s*if \(ctx\.toolDisabled\(id\)\) return/)
  assert.match(actions, /const anchorMenu = ref<\{ id: string; x: number; y: number \} \| null>\(null\)/)
  // 关掉时清状态：留着 {id} 会让下一次 v-if 直接渲染在旧坐标上。
  assert.match(actions, /function closeAnchorMenu\(\) \{ anchorMenu\.value = null \}/)
  // 2026-10-06：点外面 / Esc 不再由本组件自挂 window 监听，而是注册进**全局弹层栈**
  // （`src/popupStack.ts` 承接上游 `PopupDispatcher.java:36-37` 的那条全局链）。
  // 意图没变：菜单一定收得起来；形状变了，所以这里改查注册。自挂监听还有一个真问题 ——
  // 两层弹层各挂各的监听会抢同一次 pointerdown（点开层时把下层一起关掉）。
  assert.match(menu, /usePopupLayer\(box, shown, \(\) => emit\('close'\)/, '点外面/Esc 不收进弹层栈 = 菜单收不起来，也不被 auto-hide 认作「焦点进了弹层」')
  assert.doesNotMatch(menu, /window\.addEventListener/, '组件不该再自己挂全局监听（一条链只该有一个所有者）')
})
