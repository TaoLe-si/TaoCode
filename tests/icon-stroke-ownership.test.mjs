// 「图标笔画归属」的门禁：CSS 只许给 lucide 覆盖 stroke-width。
//
// 由来（第一百一十八批记过，这里落成机检）：本仓有**两条**图标通道 ——
//   · lucide（`lucide-vue-next`）：24 格描边图，笔画由 `stroke-width` 决定。同一张图在
//     20px 与 13px 两个槽位下"笔画粗细/尺寸"的比值不同，看着不像同一套，所以轨道上那几颗
//     显式抬到 2（`ICON_STROKE`）；
//   · IDEA 的 expui 图标（渲染成 `class="idea-icon"` 的 `<svg>`，见 `components/icons/IdeaIcon.ts`）：
//     **笔画写在 path 上**（20 格那份 `stroke-width="1.5"`，实心那几支根本不描边）。
//
// 用 CSS 的 `stroke-width` 去覆盖 `.idea-icon`，等于把 IDEA 手绘好的笔画改成另一套 ——
// 这正是"字体图标不对齐"里最隐蔽的一类：图形没换，但粗细被改了，与同一排的其它图标不像一套。
//
// 判据（结构式，扫 `src/**/*.css` 与所有 `.vue` 的样式块）：
//   1. 任何把 `stroke-width` 设成具体数值的选择器，其选择器片段里**必须**带 `.lucide`；
//   2. 任何作用到 `.idea-icon` 的选择器都不许声明 `stroke`/`stroke-width`；
//   3. 不许有裸 `svg` 选择器声明 `stroke`/`stroke-width`（无 `:not(.lucide):not(.idea-icon)` 或其它的显式限定）。
//
// 模板里的 `:stroke-width` 属性绑定**不在**管辖内（那是直接给 lucide 组件的 prop），
// 这条门禁只看样式表 —— CSS 的层叠才是"覆盖"发生的地方。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.css') || p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')

/** 取出文件里所有 `<style>` 块（`.css` 文件整体算一块）。 */
function styleBlocks(file) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return [text]
  const blocks = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) blocks.push(m[1])
  return blocks
}

/** 把一条样式表拆成 `选择器 → 声明体` 的序列（够用即可：不解析嵌套 @media 的深层选择器，
 *  但 `@media` 里的规则同样会被扫到，因为花括号是逐层配对的）。 */
function rules(css) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selector = m[1].trim()
    const body = m[2]
    if (!selector || selector.startsWith('@') && !body.includes(':')) continue
    out.push({ selector, body })
  }
  return out
}

test('stroke-width 只许作用在 .lucide 上（不给 idea-icon / 裸 svg 改笔画）', () => {
  const bad = []
  let checked = 0
  for (const file of walk(SRC)) {
    for (const css of styleBlocks(file)) {
      for (const { selector, body } of rules(css)) {
        const decl = body.match(/(?:^|[;\s])stroke-width\s*:\s*([^;]+)/)
        if (!decl) continue
        const value = decl[1].trim()
        // `inherit` / `initial` / `unset` 是"交还给原样"，不是覆盖，放行。
        if (/^(inherit|initial|unset)$/.test(value)) continue
        checked += 1
        if (!/\.lucide\b/.test(selector)) {
          bad.push(`${rel(file)}: ${selector} { stroke-width: ${value} }`)
        }
      }
    }
  }
  assert.ok(checked >= 1, `一条 stroke-width 规则都没扫到 —— 门禁本身失效了`)
  assert.deepEqual(bad, [],
    `这些规则改了图标的笔画，但不是只针对 lucide（IDEA 的 expui 图标自带笔画，被覆盖就不是那套图了）：\n${bad.join('\n')}`)
})

test('作用到 .idea-icon 的规则不许声明 stroke / stroke-width', () => {
  const bad = []
  for (const file of walk(SRC)) {
    for (const css of styleBlocks(file)) {
      for (const { selector, body } of rules(css)) {
        if (!/\.idea-icon\b/.test(selector)) continue
        if (/(^|[;\s])(stroke|stroke-width)\s*:/.test(body)) {
          bad.push(`${rel(file)}: ${selector} { …${body.trim().slice(0, 80)} }`)
        }
      }
    }
  }
  assert.deepEqual(bad, [], `expi 图标自带笔画，这些选择器不该碰它：\n${bad.join('\n')}`)
})

test('裸 svg 选择器不许声明 stroke / stroke-width（要限定 :not(.lucide):not(.idea-icon)）', () => {
  const bad = []
  for (const file of walk(SRC)) {
    for (const css of styleBlocks(file)) {
      for (const { selector, body } of rules(css)) {
        // 选择器里出现 `svg` 且没有 `.lucide` 限定；再看它是否声明了 stroke*。
        if (!/(^|[\s,>+~])svg\b/.test(selector)) continue
        if (/\.lucide\b/.test(selector)) continue
        if (/(^|[;\s])(stroke|stroke-width)\s*:/.test(body)) {
          bad.push(`${rel(file)}: ${selector} { …${body.trim().slice(0, 80)} }`)
        }
      }
    }
  }
  assert.deepEqual(bad, [],
    `裸 svg 的笔画规则会同时命中 lucide 与 expui 两条通道，必须加 :not(.lucide):not(.idea-icon) 限定：\n${bad.join('\n')}`)
})
