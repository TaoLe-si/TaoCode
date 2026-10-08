// 「间距 / 圆角一律走令牌」的机检。
//
// 由来（2026-10-06 UI 对标线）：全仓扫出 299 处与令牌**等值**的硬编码
// （`gap: 4px` 就是 `var(--space-1)`、`border-radius: 3px` 就是 `var(--radius-xs)` …）。
// 值虽然一样，但同一个间距在 A 面板写 4px、B 面板写 var(--space-1)，改令牌时就会漏改一半 ——
// 这正是用户说的「格式不统一」。本批把它们一次换齐，并用这条门禁钉住不再回潮。
//
// 令牌的出处（`src/tokens.css` §1，逐条带上游 file:line）：
//   · `--space-1..6` = 4 / 8 / 12 / 16 / 20 / 24（`JBUI` 的 `scale()` 阶梯在 UI 层的常用档）；
//   · `--radius-xs/sm/md/lg` = 3 / 5 / 7 / 9（`MainToolbar.Button.arc` 一族）。
//
// 判据：`.vue` 的 `<style>` 块与 `src/style.css` 里，`gap` / `row-gap` / `column-gap` /
// `padding*` / `margin*` / `border-radius*` 的 px 值若与某个令牌等值，必须写成 `var(--…)`。
// 例外只列**禁改文件**（大组件 lane 独占）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SPACE = { 4: '--space-1', 8: '--space-2', 12: '--space-3', 16: '--space-4', 20: '--space-5', 24: '--space-6' }
const RADIUS = { 3: '--radius-xs', 5: '--radius-sm', 7: '--radius-md', 9: '--radius-lg' }
const SPACE_PROPS = new Set(['gap', 'row-gap', 'column-gap', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom', 'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom'])
const RADIUS_PROPS = new Set(['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'])

/** 禁改文件：大组件 lane 独占。 */
const EXEMPT_FILES = new Set([
  'src/components/CodeEditor.vue',
  'src/components/DebugPanel.vue',
  'src/components/SourceControl.vue',
  'src/components/DiffView.vue',
])

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')

/** 把注释换成等长空白（保住行号），再逐条声明扫。 */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}
const lineAt = (text, idx) => text.slice(0, idx).split('\n').length

/** 扫一段 CSS，返回 `属性: 值` 里与令牌等值的硬编码位置。 */
function offenders(css, file, baseLine) {
  const clean = blankComments(css)
  const found = []
  const re = /([a-z-]+)\s*:\s*([^;{}]+)/g
  let m
  while ((m = re.exec(clean))) {
    const prop = m[1]
    if (prop.startsWith('--')) continue
    const table = SPACE_PROPS.has(prop) ? SPACE : RADIUS_PROPS.has(prop) ? RADIUS : null
    if (!table) continue
    for (const pm of m[2].matchAll(/(\d+(?:\.\d+)?)px/g)) {
      const k = Number(pm[1])
      if (table[k]) found.push({ prop, px: k, token: table[k], line: baseLine + lineAt(clean, m.index) - 1 })
    }
  }
  return found
}

test('间距 / 圆角里与令牌等值的硬编码必须写成 var(--space-*) / var(--radius-*)', () => {
  const bad = []
  for (const file of vueFiles()) {
    if (EXEMPT_FILES.has(rel(file))) continue
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    for (const style of descriptor.styles) {
      if (!style.content || !style.loc) continue
      for (const hit of offenders(style.content, file, style.loc.start.line)) {
        bad.push(`${rel(file)}:${hit.line}  ${hit.prop}: ${hit.px}px → 应为 var(${hit.token})`)
      }
    }
  }
  {
    const file = 'src/style.css'
    const css = readFileSync(file, 'utf8')
    for (const hit of offenders(css, file, 1)) bad.push(`${file}:${hit.line}  ${hit.prop}: ${hit.px}px → 应为 var(${hit.token})`)
  }
  assert.deepEqual(bad, [], `这些间距/圆角与令牌等值却没走令牌：\n${bad.join('\n')}`)
})

test('令牌阶梯本身的值与 tokens.css 一致（门禁自己不许漂）', () => {
  const tokens = readFileSync('src/tokens.css', 'utf8')
  for (const [px, name] of Object.entries(SPACE)) assert.match(tokens, new RegExp(`${name}:\\s*${px}px;`), `${name} 应为 ${px}px`)
  for (const [px, name] of Object.entries(RADIUS)) assert.match(tokens, new RegExp(`${name}:\\s*${px}px;`), `${name} 应为 ${px}px`)
})

test('例外表只列禁改文件', () => {
  for (const file of EXEMPT_FILES) {
    assert.ok(/(CodeEditor|DebugPanel|SourceControl|DiffView)\.vue$/.test(file), `${file} 不是禁改的大组件`)
  }
})

test('兜底 svg 尺寸的 CSS 规则必须排除 .idea-icon（否则覆盖 IDEA 图标自带的尺寸）', () => {
  const css = readFileSync('src/style.css', 'utf8')
  // 所有给 `> svg` 设 width/height 的规则，选择器里必须同时有 :not(.lucide) 与 :not(.idea-icon)。
  const re = /([^{}]*>\s*svg[^{}]*)\{([^{}]*)\}/g
  let m
  const bad = []
  while ((m = re.exec(blankComments(css)))) {
    const [, selector, body] = m
    if (!/[^-]width\s*:|[^-]height\s*:/.test(body)) continue
    if (!/:not\(\.lucide\)/.test(selector)) continue // 只管"兜底非 lucide"的那类规则
    if (!/:not\(\.idea-icon\)/.test(selector)) bad.push(selector.trim().slice(0, 120))
  }
  assert.deepEqual(bad, [], `这些兜底规则会覆盖 .idea-icon 声明的尺寸：\n${bad.join('\n')}`)
})
