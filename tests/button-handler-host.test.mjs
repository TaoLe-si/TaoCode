// 「按钮的点击处理器挂在图标上、没挂在按钮上」的门禁。
//
// 由来：`FileTypesPage.vue` 的「把 <模式> 从 <文件类型> 摘掉」那颗按钮写成了
//   `<button … :aria-label="…"><X :size="…" @click="removePattern(…)"/></button>`
// —— `@click` 挂在 `<X>` 那个 **12px 的 svg** 上。按钮自身的盒（`.ft-unlink` 有
// `display: inline-flex` 与内边距）点下去什么都不发生，只有正正好点在图标笔画上才触发。
// 与紧挨着的「编辑」那颗（`@click` 在 `<button>` 上）形状不一致，用户按不出区别。
//
// 判据（结构式，不看具体文案）：
//   · 一个 `<button>` 自己没有任何 `@xxx` 处理器；
//   · 但它的**某个后代**带了 `@click`；
//   · 且这个按钮不是 `type="submit"`（表单提交靠 form 的 submit 事件，不需要自己的 click）。
//   ⇒ 报出来。`disabled` 的按钮豁免（点不动是它该有的样子）。
//
// 为什么只看 click 类事件：`@mouseenter` 挂图标上是合法的（图标自己的 hover 态），
// 挂到按钮上反而会在按钮盒内移动时反复触发。
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
const staticClassOf = node => {
  for (const p of node.props ?? []) if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class') return p.value?.content ?? ''
  return ''
}
const attrOf = (node, name) => (node.props ?? []).find(p => p.type === NodeTypes.ATTRIBUTE && p.name === name)?.value?.content
const hasAttr = (node, name) => attrOf(node, name) !== undefined
/** 这个元素上有没有某个事件的监听（`@click` / `v-on:click` 都算）。 */
const onEvents = node => (node.props ?? []).filter(p => p.type === NodeTypes.DIRECTIVE && p.name === 'on')
  .map(p => p.arg?.content ?? '')

const CLICK_EVENTS = new Set(['click', 'mousedown', 'pointerdown', 'keydown', 'keyup'])

test('按钮的点击处理器不许只挂在图标上（按钮自身的盒点下去要真的有用）', () => {
  const bad = []
  let scanned = 0
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (!descriptor.template) continue
    const offset = descriptor.template.loc.start.line - 1
    let ast
    try { ast = parseDom(descriptor.template.content) } catch { continue }
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      scanned += 1
      if (hasAttr(node, 'disabled')) return
      // `type="submit"` 靠 form 的 submit 事件，不需要自己的 click。
      if (attrOf(node, 'type') === 'submit') return
      // 按钮自己有处理器 ⇒ 没问题（图标上多挂一个也不算错）。
      if (onEvents(node).some(name => CLICK_EVENTS.has(name))) return
      // 找后代里带 click 类事件的元素。
      let descendantHandled = false
      for (const child of node.children ?? []) {
        walk(child, n => {
          if (n.type !== NodeTypes.ELEMENT) return
          if (onEvents(n).some(name => CLICK_EVENTS.has(name))) descendantHandled = true
        })
      }
      if (!descendantHandled) return
      bad.push(`${rel(file)}:${node.loc.start.line + offset} .${staticClassOf(node)}`)
    })
  }
  assert.ok(scanned > 300, `只扫到 ${scanned} 个按钮 —— 门禁本身失效了`)
  assert.deepEqual(bad, [],
    '这些按钮的处理器只挂在图标上，按钮自身的盒点了没反应（只有点在图标笔画上才触发）：\n' + bad.join('\n'))
})

test('FileTypesPage 摘模式那一颗：处理器在按钮上，形状与旁边那颗一致', () => {
  const source = readFileSync(join(SRC, 'components', 'FileTypesPage.vue'), 'utf8')
  // 摘掉那一颗：`@click` 在 `<button>` 上。
  assert.match(source,
    /<button type="button" class="ft-unlink" :disabled="busy" :title="`把 \$\{pattern\} 从 \$\{entry\.type\.name\} 摘掉`"[^>]*@click="removePattern\(entry\.type\.id, pattern\)"[^>]*><X /,
    '「摘掉」那颗的 @click 必须挂在 <button> 上')
  // 反例：`<X … @click=…` 这种形状不许再出现（X 是图标，不是按钮）。
  assert.doesNotMatch(source, /<X :size="iconSize\.dense" @click=/,
    '点击处理器又挂回 <X> 图标上了')
  // 编辑那一颗（同一行的对照）也必须挂在按钮上。
  assert.match(source, /class="ft-unlink"[^>]*@click="editPattern\(entry\.type\.id, pattern\)"/,
    '「编辑」那颗的 @click 必须在 <button> 上 —— 两颗形状要一致')
})