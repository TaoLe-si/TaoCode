// 工具窗口「头部」几何的门禁（`ToolWindow.Header.height`）。
//
// 由来：这一批核 UI 布局时发现 `.tool-strip-heading`（侧条上那个窗口头部）与 `.output-heading`
// （底部工具窗口的头部）都写死 32px，且**没有出处** —— 32 是跟着 `--panel-heading-h` 走的，
// 而那个令牌服务的是"面板内部小标题"（`DebugPanel` 的「调试」、`OutlinePanel` 的「结构大纲」），
// IDEA 里根本没有对应的度量。真正的上游取值是 `ToolWindow.Header.height`：
//   · 默认 **41** —— `JBUI.java:1181 defaultHeaderHeight()`（`ToolWindowHeader.getUnscaledHeight()`
//     在 New UI 下返回它，`ToolWindowHeader.kt:75-80`）；
//   · compact **31** —— `darcula.theme.json` 的 `ui/ToolWindow/Header.height.compact`。
//
// 这条门禁守两件事：① 两处头部用**同一个** `--tool-window-header-h` 令牌（不许再各写一个数）；
// ② 令牌的两个取值与上游逐字一致（默认 41 / compact 31）。改数字必须同时改这里，改这里必须
// 能说清上游哪一行 —— 32 那种"看着差不多"的取值就再也进不来了。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tokens = readFileSync('src/tokens.css', 'utf8')
const style = readFileSync('src/style.css', 'utf8')

/** 取一条规则体（`.cls {` 开头那一条）。 */
function ruleBody(cls) {
  const at = style.indexOf(`\n${cls} {`)
  assert.ok(at >= 0, `style.css 里找不到 ${cls}`)
  const end = style.indexOf('}', at)
  return style.slice(at, end)
}

test('两处工具窗口头部共用 --tool-window-header-h，不许各写一个裸数字', () => {
  for (const cls of ['.tool-strip-heading', '.output-heading']) {
    const body = ruleBody(cls)
    assert.match(body, /min-height:\s*var\(--tool-window-header-h\)/, `${cls} 的 min-height 要走令牌`)
  }
  // `.output-heading` 是定高（它内部有绝对定位的标签条），`.tool-strip-heading` 是 min-height
  // （头部可以随内容长高）—— 两者都必须引同一个令牌，不许退回 32/41 这类裸数字。
  assert.match(ruleBody('.output-heading'), /height:\s*var\(--tool-window-header-h\)/)
  assert.doesNotMatch(ruleBody('.output-heading'), /height:\s*\d+px/)
  assert.doesNotMatch(ruleBody('.tool-strip-heading'), /min-height:\s*\d+px/)
})

test('令牌取值 = 上游 ToolWindow.Header.height（默认 41 / compact 31）', () => {
  // 默认档在 tokens.css（41），compact 档在 style.css 的密度覆盖里（31）——
  // 两个取值都要与上游逐字一致。
  assert.match(tokens, /--tool-window-header-h:\s*41px/, '默认档必须是 JBUI.java:1181 的 41')
  assert.match(style, /--tool-window-header-h:\s*31px/, 'compact 档必须是 darcula.theme.json 的 31')
  // 出处要写在令牌旁边（下一个读的人得知道 41 是抄来的而不是挑的）。
  const at = tokens.indexOf('--tool-window-header-h')
  const comment = tokens.slice(Math.max(0, at - 700), at)
  assert.match(comment, /ToolWindow\.Header\.height/, '令牌旁要写出上游键名')
  assert.match(comment, /JBUI\.java:1181/, '令牌旁要写出默认值的行号')
})

test('compact 档在密度覆盖里改的是同一个令牌（不是另开一个）', () => {
  const compact = style.slice(style.indexOf("html[data-density='compact']"), style.indexOf('}', style.indexOf("html[data-density='compact']")))
  assert.match(compact, /--tool-window-header-h:\s*31px/)
  assert.doesNotMatch(compact, /--tool-strip-heading-h|--output-heading-h/, '不许为两处头部各开一个令牌')
})

test('两处头部与 --panel-heading-h 解耦（那是面板小标题，不是工具窗口头部）', () => {
  // 面板小标题仍然走 --panel-heading-h（它服务 DebugPanel/OutlinePanel 那一族），
  // 两个度量现在是两件事，不该再被同一个令牌粘在一起。
  assert.match(tokens, /--panel-heading-h:\s*32px/)
  assert.doesNotMatch(ruleBody('.tool-strip-heading'), /--panel-heading-h/)
  assert.doesNotMatch(ruleBody('.output-heading'), /--panel-heading-h/)
})