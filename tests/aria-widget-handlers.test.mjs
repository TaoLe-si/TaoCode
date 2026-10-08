// 「有 aria 展开态的控件必须真的能点开」的门禁。
//
// 由来：这一批核 UI 逻辑时发现 `RunConsole.vue` 的两颗下拉按钮（「视图」与「显示正在运行清单」）
// 只写了 `aria-haspopup="menu"` + CSS 的 `:hover` 展开 —— 鼠标划过能看见，但**点下去什么都不发生**，
// 键盘（Enter/Space）与触屏用户永远打不开。这是真实的可达性缺陷，不是风格问题：
// 带 `aria-haspopup` 就是在向辅助技术承诺"这里会弹一个 menu"，而它弹不出来。
//
// 判据（结构式，不看具体文案）：
//   带 `aria-expanded` / `aria-haspopup` 的 `<button>`，必须同时满足两条之一：
//     · 有 `@click`（或 `@mousedown` / `@pointerdown`）处理器；或
//     · 是原生 `<summary>`（浏览器自己管展开）—— 这里按 tag 排除。
//   `disabled` 的按钮豁免（点不动是它该有的样子）。
//
// 为什么走 AST：`<button @click="f('>')">` 这种属性值里带 `>` 的写法会让正则提前截断
// （`ui-icons.test.mjs:152-159` 记的同一个坑）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}
const hasProp = (node, name) => (node.props ?? []).some(p =>
  (p.type === NodeTypes.ATTRIBUTE && p.name === name) ||
  (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name))
const staticClassOf = node => {
  for (const p of node.props ?? []) if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class') return p.value?.content ?? ''
  return ''
}

test('带 aria-expanded / aria-haspopup 的按钮必须真的有点开它的处理器', () => {
  const bad = []
  let checked = 0
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template) continue
    const offset = descriptor.template.loc.start.line - 1
    let ast
    try { ast = parseDom(descriptor.template.content) } catch { continue }
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      if (!hasProp(node, 'aria-expanded') && !hasProp(node, 'aria-haspopup')) return
      checked += 1
      if (hasProp(node, 'disabled')) return
      // 任何一个 `@xxx` 都算"点了有反应"（有的用 mousedown 抢在失焦之前）。
      const opens = (node.props ?? []).some(p => p.type === NodeTypes.DIRECTIVE && p.name === 'on')
      if (!opens) bad.push(`${rel(file)}:${node.loc.start.line + offset} .${staticClassOf(node)}`)
    })
  }
  assert.ok(checked >= 8, `只匹配到 ${checked} 个带 aria 展开态的按钮 —— 门禁本身失效了`)
  assert.deepEqual(bad, [], `这些按钮承诺了展开态却点不开（键盘/触屏打不开）：\n${bad.join('\n')}`)
})

test('RunConsole 两颗下拉按显式状态展开，不只靠 CSS :hover', () => {
  const console_ = readFileSync('src/components/RunConsole.vue', 'utf8')
  // 显式状态：点开 / 再点收起；两个互斥（开一个关另一个）。
  assert.match(console_, /const viewsOpen = ref\(false\)/)
  assert.match(console_, /const liveOpen = ref\(false\)/)
  assert.match(console_, /@click\.stop="toggleViewsMenu\(\)"/, '「视图」按钮要能点开')
  assert.match(console_, /@click\.stop="toggleLiveMenu\(\)"/, '「正在运行清单」按钮要能点开')
  // 展开态绑到 aria-expanded（读屏要能知道开着还是关着）。
  assert.match(console_, /:aria-expanded="viewsOpen"/)
  assert.match(console_, /:aria-expanded="liveOpen"/)
  // 菜单在展开时渲染（`v-if`），不是恒定挂在 DOM 里靠 CSS 显隐 ——
  // 后者会让读屏把一份"看不见但存在"的菜单念出来。
  assert.match(console_, /v-if="viewsOpen" class="run-views-menu"/)
  assert.match(console_, /v-if="liveOpen" class="run-views-menu run-live-menu"/)
  // 点别处要收起（否则弹层一直盖在控制台上）。
  assert.match(console_, /closeRunMenus/, '缺"点别处收起"那条监听')
})