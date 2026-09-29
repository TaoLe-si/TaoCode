// 浮层必须自带前景色 —— 机检。
//
// 起因（2026-09-28，用户截图实测）：月之亮面下主菜单下拉**几乎看不清**。根因不是配色选错，
// 而是顶栏为了深炭色 chrome 写了 `.topbar { color: var(--header-fg) }`，而下拉面板 `.dropdown`
// 就渲染在 `.topbar` 里面、靠**继承**拿颜色 —— 于是浅字（#e7edf6）落在 `--elevated` 白底上。
// 深色主题看不出来，只是因为它的浮层底色本身也是深的。
//
// 上游不会这样：expUI 的通配组 `"*"` 给**所有组件**统一 `foreground`/`disabledForeground`
// （expUI_light.theme.json:108-116），组件不靠父容器继承文字色。
// 所以这里的判据是："画了浮层底色的规则，必须同时自己声明前景色"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const css = read('src/style.css')
const tokens = read('src/tokens.css')

// 浮层底色 = 这两个之一；浮层选择器 = 类名带这些语素（面板/菜单/弹窗/提示/选择器/列表）。
const SURFACE = /background:\s*var\(--(?:elevated|popup-background)\)/
const FLOATING = /\.(?:[\w-]*(?:dropdown|popup|menu|tooltip|hint|chooser|overlay|panel)[\w-]*)\b/

/** 把 CSS 切成 `{ selector, body }`（够用了：本仓 style.css 没有嵌套规则）。 */
function blocks(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')   // 注释会被当成"选择器"，先去掉
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }))
}

/** 违反"浮层自带前景色"的规则。 */
function offenders(source) {
  return blocks(source)
    .filter(block => SURFACE.test(block.body) && FLOATING.test(block.selector) && !/\bcolor:/.test(block.body))
    .map(block => block.selector)
}

test('每一个浮层都自己声明前景色，不靠父容器继承', () => {
  const found = offenders(css)
  assert.deepEqual(found, [], `这些浮层画了浮层底色却没写 color:，会被宿主容器（如 .topbar 的浅色字）继承污染：${found.join(' | ')}`)
  // 判据本身不能是空的：至少要有若干浮层被扫到，否则"零违规"没有意义。
  const painted = blocks(css).filter(block => SURFACE.test(block.body) && FLOATING.test(block.selector)).length
  assert.ok(painted >= 6, `扫描器只找到 ${painted} 个浮层规则 —— 判据退化成空转了`)
})

test('反例：漏写 color 的浮层必须被这条抓到', () => {
  const broken = '.dropdown { position: absolute; background: var(--elevated); box-shadow: var(--popup-shadow); }'
  assert.deepEqual(offenders(broken), ['.dropdown'], '把 color 删掉都没报 —— 这条判据是假的')
  // 反例之二：非浮层（表单控件、普通面板）不该被误伤。
  assert.deepEqual(offenders('.run-command { background: var(--elevated); }'), [])
})

test('浮层前景/禁用前景两档都有，且禁用档用的是上游字面量', () => {
  const value = (name, index) => {
    const all = [...tokens.matchAll(new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, 'g'))]
    assert.ok(all[index], `--${name} 缺第 ${index + 1} 档（亮/暗）`)
    return all[index][1]
  }
  // expUI 通配组 `"*".disabledForeground`：浅色 Gray8 = #A8ADBD，深色 Gray6 = #5A5D63。
  assert.deepEqual([value('m-pop-disabled', 0), value('m-pop-disabled', 1)], ['#a8adbd', '#5a5d63'])
  assert.match(tokens, /--popup-foreground: var\(--m-pop-fg\)/)
  assert.match(tokens, /--popup-disabled: var\(--m-pop-disabled\)/)
  // 浮层正文必须过 AA（禁用档**故意**不过：上游就是拿低对比表达"不可用"，所以不进这条门禁）。
  const luminance = hex => {
    const rgb = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
  for (const theme of [0, 1]) {
    const ratio = contrast(value('m-pop-fg', theme), value('m-pop-bg', theme))
    assert.ok(ratio >= 4.5, `第 ${theme ? '暗' : '亮'} 档浮层正文对比只有 ${ratio.toFixed(2)}`)
    // 实际配对：多数浮层底色仍是 --elevated，前景换成 --popup-foreground —— 量的必须是这一对。
    const paired = contrast(value('m-pop-fg', theme), value('m-elevated', theme))
    assert.ok(paired >= 4.5, `第 ${theme ? '暗' : '亮'} 档浮层正文压在 --elevated 上只有 ${paired.toFixed(2)}`)
  }
  // 反例：拿浅色的 header 前景当浮层正文（就是这次的 bug）。
  assert.ok(contrast(value('m-night-fg', 0), value('m-pop-bg', 0)) < 2, '浅色顶栏字色落在浮层底上本该不可读')
})

test('禁用行有显式颜色，不靠浏览器对 disabled 按钮的默认淡化', () => {
  // UA 淡化在两档主题里是同一个灰法：浅色糊成一片、深色几乎看不出来 —— 正是这次的现场。
  assert.match(css, /\.menu-item:disabled, \.menu-button:disabled, \.select-in-row:disabled \{ color: var\(--popup-disabled\); \}/)
  assert.match(css, /\.menu-item:disabled \.menu-item-icon, \.menu-item:disabled > kbd \{ color: inherit; \}/,
    '图标与快捷键自己带颜色，禁用行会只淡一半，看着像渲染坏了')
})
