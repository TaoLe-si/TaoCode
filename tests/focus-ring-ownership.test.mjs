// 「焦点环只有一种写法」门禁（2026-10-06 UI 对标线）。
//
// 由来：全仓 `:focus-visible` 的焦点环原先散着四种写法 ——
//   · `outline: 2px solid var(--accent)`（全站控件默认那条，style.css:56）；
//   · `outline: 1px solid var(--accent)`（面板里的行内输入框一族，宽只有一半）；
//   · `outline-offset` 从 +1 / -1 / -2 / +2 / -4 五花八门；
//   · 还有一处 `.breadcrumb-seg` 走 `box-shadow: var(--ring)` 的**双环**（2px 底色 + 4px accent），
//     与其余二十来处**形状都不一样**，而且 box-shadow 会被宿主的 `overflow` 成片裁掉。
//
// 统一到 tokens.css 的成文口径（`--focus-ring` / `--focus-ring-offset` /
// `--focus-ring-offset-inset` / `--focus-ring-on-accent`）—— 宽度、颜色、偏移全部从令牌取，
// 于是"改一次全站一起改"，也不再出现"同一排两个框一个 1px 一个 2px"。
//
// 判据（结构式，扫 `src/*.css` 与 `src/components/**` 的 `.vue` 样式块；四个大组件与 App.vue
// 由别的 lane 独占，不在本线名下，见下方 FORBIDDEN）：
//   1. 任何匹配 `:focus` 的选择器，只要声明了非 none 的 `outline`，其值必须正好是
//      `var(--focus-ring)` 或 `var(--focus-ring-on-accent)`（后者只给填充 accent 底的控件）；
//   2. 同一批规则里若写了 `outline-offset`，其值必须是 `var(--focus-ring-offset)` 或
//      `var(--focus-ring-offset-inset)`——不许退回裸像素；
//   3. `:focus` 规则不许用 `box-shadow` 画环（`var(--ring)` / accent 色的 box-shadow 都不行）；
//   4. tokens.css 必须四颗令牌齐备，且那条只被一处消费的 `--ring` 已经删掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 别线独占的文件（本线判据不覆盖，改了要冲突）。 */
const FORBIDDEN = new Set(['App.vue', 'CodeEditor.vue', 'DebugPanel.vue', 'SourceControl.vue', 'DiffView.vue', 'EditorFindBar.vue'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.css') || p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/')

/** 本线名下的样式来源：src/*.css + src/components/**（排除别线独占的 .vue）。 */
function ownedFiles() {
  const out = readdirSync('src').filter(f => f.endsWith('.css')).map(f => `src/${f}`)
  for (const f of walk('src/components')) {
    if (!f.endsWith('.vue')) continue
    if (FORBIDDEN.has(f.split(/[\\/]/).pop())) continue
    out.push(rel(f))
  }
  return out
}

/** 把文件切成 `选择器 → 声明体` 的序列（够用：本仓没有深层嵌套规则）。 */
function rules(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(stripped))) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}
function styleBlocks(file) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.css')) return [text]
  const blocks = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) blocks.push(m[1])
  return blocks
}

const RING = /^var\(--focus-ring(?:-on-accent)?\)$/
const OFFSET = /^var\(--focus-ring-offset(?:-inset)?\)$/

/** 返回违反"焦点环只有一种写法"的条目。 */
function offenders() {
  const bad = []
  let rings = 0
  for (const file of ownedFiles()) {
    for (const css of styleBlocks(file)) {
      for (const { selector, body } of rules(css)) {
        if (!/:focus/.test(selector)) continue
        const outline = body.match(/(?:^|[;\s])outline\s*:\s*([^;]+)/)
        if (outline) {
          const value = outline[1].trim()
          if (!/^(none|0)$/.test(value)) {
            rings += 1
            if (!RING.test(value)) bad.push(`${file}: ${selector} { outline: ${value} }`)
          }
        }
        const offset = body.match(/(?:^|[;\s])outline-offset\s*:\s*([^;]+)/)
        if (offset && !OFFSET.test(offset[1].trim())) {
          bad.push(`${file}: ${selector} { outline-offset: ${offset[1].trim()} }`)
        }
        if (/(^|[;\s])box-shadow\s*:[^;]*(?:var\(--ring\)|var\(--accent\))/.test(body)) {
          bad.push(`${file}: ${selector} { …box-shadow 画焦点环… }`)
        }
      }
    }
  }
  return { bad, rings }
}

test('焦点环只许一种写法：outline: var(--focus-ring[on-accent])，偏移走令牌', () => {
  const { bad, rings } = offenders()
  assert.deepEqual(bad, [], `这些焦点环不是统一写法（宽度/颜色/偏移都要走 tokens.css 的 --focus-ring*）：\n${bad.join('\n')}`)
  assert.ok(rings >= 15, `只扫到 ${rings} 条 :focus 环路 —— 判据退化成空转了`)
})

test('反例：四种旧写法都必须被这条抓到', () => {
  const find = source => {
    const out = []
    for (const { selector, body } of rules(source)) {
      if (!/:focus/.test(selector)) continue
      const o = body.match(/(?:^|[;\s])outline\s*:\s*([^;]+)/)
      if (o && !/^(none|0)$/.test(o[1].trim()) && !RING.test(o[1].trim())) out.push("outline:" + o[1].trim())
      const f = body.match(/(?:^|[;\s])outline-offset\s*:\s*([^;]+)/)
      if (f && !OFFSET.test(f[1].trim())) out.push("offset:" + f[1].trim())
      if (/(^|[;\s])box-shadow\s*:[^;]*(?:var\(--ring\)|var\(--accent\))/.test(body)) out.push("shadow")
    }
    return out
  }
  assert.deepEqual(find('.x:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }'),
    ['outline:1px solid var(--accent)', 'offset:-1px'])
  assert.deepEqual(find('.x:focus-visible { outline: none; box-shadow: var(--ring); }'), ['shadow'])
  assert.deepEqual(find('.x:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }'), ['offset:2px'])
  assert.deepEqual(find('.x:focus-visible { outline-color: var(--on-accent); outline-offset: -4px; }'), ['offset:-4px'])
  // 正例：合法的两种环、两种偏移、以及 outline:none 的"不是环"都不该被抓。
  assert.deepEqual(find('.x:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }'), [])
  assert.deepEqual(find('.x:focus-visible { outline: var(--focus-ring-on-accent); outline-offset: var(--focus-ring-offset); }'), [])
  assert.deepEqual(find('.x:focus-visible { outline: none; background: var(--hover); }'), [])
})

test('tokens.css 四颗焦点环令牌齐备，且旧的 --ring 双环已删', () => {
  const tokens = readFileSync('src/tokens.css', 'utf8')
  assert.match(tokens, /--focus-ring:\s*2px solid var\(--accent\)/)
  assert.match(tokens, /--focus-ring-offset:\s*1px/)
  assert.match(tokens, /--focus-ring-offset-inset:\s*-2px/)
  assert.match(tokens, /--focus-ring-on-accent:\s*2px solid var\(--on-accent\)/)
  assert.doesNotMatch(tokens, /^[^\n]*--ring:/m, '那条只被一处消费的 box-shadow 双环 --ring 应已删除')
  assert.doesNotMatch(readFileSync('src/style.css', 'utf8'), /var\(--ring\)/, 'style.css 不许再引用 --ring')
})
