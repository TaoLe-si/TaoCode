// 工具窗口条纹（New UI）几何与上游对齐的机检。
//
// 由来（2026-10-06 UI 对标线）：条纹上有两处对不上上游，都是"看着差不多、量出来差十几像素"：
//   ① 按钮之间被加了 3px 间隙 —— 上游 `AbstractDroppableStripe.layoutButton`（`:477-506`）把
//      `data.eachY` 一步推进 `preferredSize.height`，按钮逐个相接（`gap` 只用于前后半组的拆分缝）。
//      6 个按钮累计往下漂 18px。
//   ② 分隔件写成了"1px 线 + 上下 12px 外边距"（共 25px）—— 上游 `StripeButtonSeparator`
//      的盒是 32×11（`StripeButtonSeparator.kt:22-23`），线是 24×1 居中（`:30-32`）。
//
// 判据分三层：
//   · 令牌与 JS 常量同步（`src/toolStripeSplit.ts` 的 `STRIPE_SEPARATOR_*` 与 tokens.css）；
//   · 条纹按钮**没有间距**（`.activity-bar` / `.stripe-list` 的 gap 必须是 0）；
//   · 分隔件与按钮底色都按上游的盒与内衬来（引用对应令牌，不写裸数）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const split = require('../src/toolStripeSplit.ts')
const tokens = readFileSync('src/tokens.css', 'utf8')
const css = readFileSync('src/style.css', 'utf8')

test('分隔件的令牌值与 src/toolStripeSplit.ts 的常量逐条相等（几何只有一个出处两个通道）', () => {
  assert.equal(split.STRIPE_SEPARATOR_HEIGHT_PX, 11)
  assert.equal(split.STRIPE_SEPARATOR_LINE_WIDTH_PX, 24)
  assert.equal(split.STRIPE_SEPARATOR_LINE_THICKNESS_PX, 1)
  assert.match(tokens, /--stripe-separator-height:\s*11px;/)
  assert.match(tokens, /--stripe-separator-line-width:\s*24px;/)
  assert.match(tokens, /--stripe-separator-line-thickness:\s*1px;/)
})

test('条纹按钮之间没有间距（上游步长 = 按钮高 30，不是 33）', () => {
  const rules = [...css.matchAll(/\.activity-bar \{[^}]*\}/g)].map(m => m[0])
  const bar = rules.find(r => /flex-direction:\s*column/.test(r))
  assert.ok(bar, '找不到 .activity-bar 的主规则')
  const list = css.match(/\.stripe-list \{[^}]*\}/)[0]
  assert.match(bar, /gap:\s*0;/, '.activity-bar 不该给按钮留间距')
  assert.match(list, /gap:\s*0;/, '.stripe-list 不该给按钮留间距')
  assert.doesNotMatch(css, /\.activity-bar \{[^}]*gap:\s*3px;/, '旧的三像素间隙必须清掉')
})

test('分隔件按 StripeButtonSeparator 的盒高与线宽（引用令牌，不写裸数）', () => {
  const divider = css.match(/\.rail-divider \{[^}]*\}/)[0]
  assert.match(divider, /height:\s*var\(--stripe-separator-height\);/)
  assert.doesNotMatch(divider, /margin:/, '分隔件的盒高已经含了上下留白，不该再有外边距')
  const line = css.match(/\.rail-divider::before \{[^}]*\}/)[0]
  assert.match(line, /width:\s*var\(--stripe-separator-line-width\);/)
  assert.match(line, /height:\s*var\(--stripe-separator-line-thickness\);/)
})

test('条纹按钮的 hover / pressed 底色按上游内衬 5px + arc 12 画（不是整块 30px 铺满）', () => {
  const after = css.match(/\.activity-button::after \{[^}]*\}/)[0]
  assert.match(after, /inset:\s*var\(--stripe-btn-icon-padding\);/)
  assert.match(after, /border-radius:\s*var\(--stripe-btn-arc\);/)
  // 底色从按钮本体挪到了 ::after —— 本体不该再直接铺 background 高亮。
  assert.match(css, /\.activity-button:hover::after \{ background: var\(--hover\); \}/)
  assert.match(css, /\.activity-button\.active::after \{ background: var\(--selected\); \}/)
  // 图标/文字要压在底色之上。
  assert.match(css, /\.activity-button > \* \{ position: relative; z-index: 1; \}/)
  // 令牌出处：5 = JBUI.defaultStripeToolbarButtonIconPadding()，12 = stripeButtonArc()。
  assert.match(tokens, /--stripe-btn-icon-padding:\s*5px;/)
  assert.match(tokens, /--stripe-btn-arc:\s*12px;/)
})
