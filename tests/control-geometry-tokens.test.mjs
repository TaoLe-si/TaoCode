// 「面板控件的几何统一」门禁（2026-10-06 UI 对标线）。
//
// 由来：把全仓的硬编码数值扫了一遍，间距里凡与 `--space-*` 同值的**已经一个不剩**（token 化完成），
// 但**控件高度**与**圆角**还留着两族"同一个角色、不同数值"的写法：
//
//   1. 面板里的行内搜索框/筛选框/小图标钮，高度散着 `22px`（`ProblemsPanel`/`Panel` 一族）与
//      `var(--ctrl-height-sm)`（24，`TerminalPanel`/`OutlinePanel`/`TodoPatternsPage` 一族）两套。
//      `22` 没有任何出处，而且**不随紧凑模式收**（`--ctrl-height-sm` 会被 `html[data-density=compact]`
//      覆写成 20）—— 于是紧凑模式下同一排控件一个 20 一个 22，肉眼就是"没对齐"。
//   2. 有两颗**图标钮不是方的**：`.hist-tool` / `.outline-tool` 写成 `width: var(--ctrl-height-sm)`（24）
//      配 `height: 22px` —— 24×22 的盒里放一颗居中图标，图标会比同排的方形钮低 1px，且 hover 底色不是正方形。
//   3. 圆的角：`ScopesSettingsPage` 的三个盒子写 `6px`、`ColorChooserDialog` 的外壳写 `8px` ——
//      房子的令牌是 `--radius-md`（7，卡片/内层盒）与 `--radius-lg`（9，对话框外壳）。
//
// 判据（结构式，只管本线名下的文件：`src/style.css` + `src/components/**` 里除四个大组件之外的 `.vue`）：
//   · `(min-height|height)` 不许再写 `22px`（控件高度一律走 `--ctrl-height*`）；
//   · 上面点名的五个类必须引令牌（别悄悄退回裸数字）；
//   · 不允许 `border-radius: 6px` / `8px` 这种"令牌就在旁边却另写一个数"的圆角
//     （1/2/3px 的打字高亮小片、`50%` 的圆点不在此列）。
//
// 为什么用正则而不用 CSSOM：WebView2 之外没有渲染器，且这些是"源码里写没写令牌"的文本事实，
// 与 `tests/tool-window-header-geometry.test.mjs` 同一套路数。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 本线名下的样式文件（四个大组件 lane 独占的文件不在内）。 */
const FORBIDDEN = new Set(['CodeEditor.vue', 'DebugPanel.vue', 'SourceControl.vue', 'DiffView.vue', 'EditorFindBar.vue'])
const OWNED_VUE = readdirSync('src/components')
  .filter(f => f.endsWith('.vue') && !FORBIDDEN.has(f))
  .map(f => `src/components/${f}`)
const STYLE_FILES = ['src/style.css', ...OWNED_VUE]
/** 只取样式块（`.vue` 只扫 `<style>` 里的内容，免得把模板里的内联 `style` 误伤）。 */
function styleText(file) {
  const text = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return text
  const blocks = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = re.exec(text))) blocks.push(m[1])
  return blocks.join('\n')
}

test('本线文件里没有 22px 的控件高度（一律走 --ctrl-height*）', () => {
  const bad = []
  for (const file of STYLE_FILES) {
    const text = styleText(file)
    text.split(/\r?\n/).forEach((ln, i) => {
      if (/(^|[;{\s])(min-height|height)\s*:\s*22px/.test(ln)) bad.push(`${file}:${i + 1}: ${ln.trim().slice(0, 120)}`)
    })
  }
  assert.deepEqual(bad, [], `这些控件高度写死 22px，既不随紧凑模式收、也与同排的 --ctrl-height-sm 对不齐：\n${bad.join('\n')}`)
})

test('点名的控件引令牌，不是退回裸数字', () => {
  const style = readFileSync('src/style.css', 'utf8')
  const ruleOf = (cls) => {
    const at = style.indexOf(`\n${cls} {`)
    assert.ok(at >= 0, `style.css 里找不到 ${cls}`)
    return style.slice(at, style.indexOf('}', at))
  }
  // 菜单行的行高：`--menu-row-height`（New UI List.rowHeight）。
  assert.match(ruleOf('.menu-button'), /min-height:\s*var\(--menu-row-height\)/, '.menu-button 的行高要走 --menu-row-height')
  assert.doesNotMatch(ruleOf('.menu-button'), /min-height:\s*\d+px/)
  // 顶栏图标钮：`--ctrl-height`（28）。
  assert.match(ruleOf('.icon-button'), /width:\s*var\(--ctrl-height\)/)
  assert.match(ruleOf('.icon-button'), /height:\s*var\(--ctrl-height\)/)
  // 编辑器标签的关闭钮：`--ctrl-height-sm`（24）。
  assert.match(ruleOf('.tab-close'), /width:\s*var\(--ctrl-height-sm\)/)
  assert.match(ruleOf('.tab-close'), /height:\s*var\(--ctrl-height-sm\)/)

  // 放图标的**方形盒**必须是方的（宽高引用同一个令牌）—— 24×22 / 29×28 这种会让盒里的图标
  // 与同排的方形钮错开半点，肉眼就是"图标没对齐"。
  for (const [file, cls] of [
    ['src/components/HistoryPanel.vue', '\\.hist-tool'],
    ['src/components/OutlinePanel.vue', '\\.outline-tool'],
    ['src/style.css', '\\.route-icon'],
  ]) {
    const text = readFileSync(file, 'utf8')
    const m = text.match(new RegExp(`${cls} \\{([^}]*)\\}`))
    assert.ok(m, `${file} 里找不到 ${cls}`)
    const body = m[1]
    const w = body.match(/(?:^|[;\s])width\s*:\s*([^;]+)/)
    const h = body.match(/(?:^|[;\s])height\s*:\s*([^;]+)/)
    assert.ok(w && h, `${cls} 要有显式的 width 与 height`)
    assert.equal(w[1].trim(), h[1].trim(), `${cls} 的宽高必须相等（方形盒）：width ${w[1].trim()} vs height ${h[1].trim()}`)
    assert.match(w[1].trim(), /^var\(--ctrl-height(-sm)?\)$/, `${cls} 的宽要走 --ctrl-height*，不许写死`)
  }
})

test('圆角不许"令牌在旁边却另写一个数"（6px / 8px 收进 --radius-md / --radius-lg）', () => {
  const bad = []
  for (const file of STYLE_FILES) {
    const text = styleText(file)
    text.split(/\r?\n/).forEach((ln, i) => {
      const m = ln.match(/border-radius:\s*([^;]+)/)
      if (!m) return
      // 1/2/3px 的打字高亮小片、50% 的圆点、`var(--…)` 与多值（如 `--radius-md --radius-md 0 0`）放行。
      if (/var\(--|%|\d+px\s+\d/.test(m[1])) return
      // 滚动条拇指：`::-webkit-scrollbar-thumb` 的圆头是**按可见宽度**画的（8px 宽配 8px 半径），
      // 而 `data-scrollbars='contrast'` 会把它加宽到 14px —— 用 --radius-pill(999) 会从"圆头矩形"
      // 变成"整条胶囊"，是另一套形状。这是滚动条自己的度量，不是卡片圆角，单独留在这里。
      if (/scrollbar/.test(ln)) return
      if (/border-radius:\s*[68]px/.test(ln)) bad.push(`${file}:${i + 1}: ${m[0].trim()}`)
    })
  }
  assert.deepEqual(bad, [], `这些圆角该用 --radius-md(7) / --radius-lg(9)：\n${bad.join('\n')}`)
})

test('圆形盒（border-radius: 50%）的显式宽高必须相等，否则圆变成椭圆', () => {
  // 布局错位里最直白的一类：`border-radius: 50%` 画的是"内切椭圆"——宽高不等就成了一颗鸭蛋。
  // 本批抓到一处：`WelcomePage.vue` 的 `.recent-open` 窄屏媒体查询把 `.project-avatar`
  // 从基线的 30×30 改成 `width: 30px; height: 32px`，圆形头像被拉成竖椭圆。
  // 判据只认"同时写了 width 与 height 且都是裸像素值"的规则（`var(--…)`/`%`/`auto`/`calc`
  // 由令牌或布局决定，不在此列）。
  const bad = []
  for (const file of STYLE_FILES) {
    const text = styleText(file)
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim()
      const body = m[2]
      if (!/border-radius:\s*50%/.test(body)) continue
      const w = body.match(/(?:^|[;\s])width\s*:\s*([^;]+)/)
      const h = body.match(/(?:^|[;\s])height\s*:\s*([^;]+)/)
      if (!w || !h) continue
      const wv = w[1].trim()
      const hv = h[1].trim()
      if (/var\(|%|auto|calc/.test(wv) || /var\(|%|auto|calc/.test(hv)) continue
      if (Number.parseFloat(wv) !== Number.parseFloat(hv)) {
        bad.push(`${file}: ${selector} { width: ${wv}; height: ${hv} }`)
      }
    }
  }
  assert.deepEqual(bad, [], `圆形的盒宽高必须相等，否则渲染成椭圆：\n${bad.join('\n')}`)
})
