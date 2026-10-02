// 弹层的位置夹取（src/popupAnchor.ts + src/menuPlacement.ts）与**谁在用它**。
//
// 87-C 与 87-D 之前，四张弹层各写各的夹取，全是"按行数猜高度"的魔数：
//   · 项目树右键  `Math.min(y, viewport.height - 330)`   ← 猜这段菜单 330px 高
//   · 标签页右键  `Math.min(y, viewport.height - 260)`   ← 猜 260
//   · 编辑器右键  直接照抄坐标，一行都不夹
//   · 工具窗口条  `.tool-menu { right: 8px }` 贴右边，不看宽度
// 行数一变（子菜单、按文件分组、上下文动作那条链继续长），估算就不准。两次实测都翻了车：
//   · 工具窗口条那条菜单实测 372px 高、246px 宽，长在 239px 宽的侧栏里靠 right 贴边 ⇒
//     左边缘落到 x = -14.5px，图标与"×"整列被裁掉（用户 2026-10-03 截图）。
//   · 编辑器那条实测 419px 高，光标在 y=200 处展开后底边落到 y=619，**盖在下边栏输出面板上**
//     ——用户当时的话是「下边栏会把右键菜单遮挡住」（2026-10-03 截图）。
// 所以现在统一：量一次真实尺寸，交给 `placeMenu` 按 `AbstractPopup` 的顺序落位。
// 这个文件钉两件事：(1) 那个顺序本身；(2) 四张弹层**都已经接上**，且没人再写魔数。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeMenu } from '../src/menuPlacement.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

test('编辑器右键菜单那次的实测输入：菜单比上下都高，只能贴着视口顶落', () => {
  // 真机量出来的：菜单 419.33 高，视口 603 高，光标在 y≈196（编辑器下沿附近），下边栏面板 y=411.67。
  // 下方只剩 407px、上方只有 192px，**两侧都放不下** ⇒ 走 `placeMenu` 的第三步：夹进视口。
  // 这正是用户那次截图的成因：原先一行都不夹，菜单底边落到 y=619，压在下边栏输出面板上，
  // 看着像"下边栏把右键菜单遮挡住了"。
  const VIEWPORT = { width: 1280, height: 603 }
  const MENU = { width: 240, height: 419.33 }
  const out = placeMenu({ x: 420, y: 196, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.y, 4, '两侧都放不下 ⇒ 夹到视口顶 + margin')
  assert.ok(out.y >= 0, '菜单上沿必须在视口里')
  assert.ok(out.y + MENU.height <= VIEWPORT.height,
    `菜单下沿 ${out.y + MENU.height} 超出了视口 ${VIEWPORT.height} —— 这就是"被下边栏挡住"`)
})

test('下方放不下但上方放得下 ⇒ 翻到上方（上游 AbstractPopup 的 Alignment）', () => {
  const VIEWPORT = { width: 1280, height: 900 }
  const MENU = { width: 240, height: 300 }
  // 光标在 y=700：下方剩 200px（不够），上方有 700px（够）⇒ 应当翻上去，而不是夹在下方。
  const out = placeMenu({ x: 420, y: 700, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.equal(out.y, 700 - MENU.height - 4, '下方差一点点就翻到上方，底边离锚点 4px')
  assert.ok(out.y + MENU.height <= VIEWPORT.height, '菜单下沿必须在视口里')
})

test('工具窗口条那次的实测输入：菜单比它的锚（侧栏）宽，不能再靠 right: 8px 贴边', () => {
  const VIEWPORT = { width: 1280, height: 720 }
  const MENU = { width: 245.82, height: 372 }
  const out = placeMenu({ x: 12, y: 40, ...MENU, viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height })
  assert.ok(out.x >= 4, `菜单左边缘落在 x=${out.x}，被视口左边裁掉了`)
  assert.ok(out.x + MENU.width <= VIEWPORT.width, '菜单右边缘必须在视口里')
  assert.ok(out.y + MENU.height <= VIEWPORT.height, '菜单下沿必须在视口里')
})

test('四张弹层都接上了按实测尺寸的落位，没有一个还写死魔数', () => {
  const app = read('src/App.vue')
  // 项目树 / 标签页两张：改用 AnchoredMenu 外壳（它内部就是 usePopupAnchor）。
  assert.doesNotMatch(app, /viewport\.height - \d+\)px`/,
    'App.vue 里还有按行数猜高度的 Math.min(y, viewport.height - N) 夹取')
  assert.doesNotMatch(app, /viewport\.width - \d+\)px`/,
    'App.vue 里还有按行数猜宽度的 Math.min(x, viewport.width - N) 夹取')
  assert.ok(app.includes('<AnchoredMenu :x="treeMenu.x" :y="treeMenu.y"'), '项目树右键菜单没走 AnchoredMenu')
  assert.ok(app.includes('<AnchoredMenu :x="tabMenu.x" :y="tabMenu.y"'), '标签页右键菜单没走 AnchoredMenu')

  const editor = read('src/components/EditorPopupMenu.vue')
  assert.ok(editor.includes('usePopupAnchor'), '编辑器菜单没接 usePopupAnchor')
  assert.doesNotMatch(editor, /Math\.min\([^)]*(viewport|innerWidth|innerHeight)/, '编辑器菜单里还有坐标魔数')

  const header = read('src/components/ToolWindowHeader.vue')
  assert.ok(header.includes('usePopupAnchor'), '工具窗口条菜单没接 usePopupAnchor')
  // Teleport 之后 `.tool-menu` 的 position/right 会跟内联的 left/top 打架，必须在本地压掉。
  assert.match(header, /\.tool-header-menu \{ position: fixed; top: auto; right: auto; \}/,
    'Teleport 到 body 之后还留着 `.tool-menu` 的 absolute + right，菜单会被拉向两边')

  const anchored = read('src/components/AnchoredMenu.vue')
  assert.ok(anchored.includes('usePopupAnchor'), 'AnchoredMenu 自己没接 usePopupAnchor')
  assert.match(anchored, /class="tree-menu"/, 'AnchoredMenu 必须沿用 .tree-menu 的样式与 backdrop 约定')
})

test('usePopupAnchor 量完再夹：首帧量到 0 尺寸时不能把菜单推到负坐标', () => {
  // 反射式地确认那段逻辑的两个前提，避免以后有人把它简化成"直接算"。
  const src = read('src/popupAnchor.ts')
  assert.match(src, /if \(!rect\.width && !rect\.height\) return/,
    '未挂载/未布局时量到 0 尺寸，必须跳过这次夹取（否则会按 0 宽高算出越界坐标）')
  assert.match(src, /nextTick/, '展开后要等一帧再量：子段展开会改变高度')
  assert.match(src, /getBoundingClientRect\(\)/, '必须量真实盒子，不能按行数估算')
})