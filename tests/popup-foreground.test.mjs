// 浮层必须自带前景色 + 共用浮层族的边框/圆角 —— 机检。
//
// 起因（2026-09-28，用户截图实测）：月之亮面下主菜单下拉**几乎看不清**。根因不是配色选错，
// 而是顶栏为了深炭色 chrome 写了 `.topbar { color: var(--header-fg) }`，而下拉面板 `.dropdown`
// 就渲染在 `.topbar` 里面、靠**继承**拿颜色 —— 于是浅字（#e7edf6）落在 `--elevated` 白底上。
// 深色主题看不出来，只是因为它的浮层底色本身也是深的。
//
// 上游不会这样：expUI 的通配组 `"*"` 给**所有组件**统一 `foreground`/`disabledForeground`
// （expUI_light.theme.json:108-116），组件不靠父容器继承文字色。
// 所以这里的判据是："画了浮层底色的规则，必须同时自己声明前景色"。
//
// 2026-10-06 扩充（B12 弹层族令牌对齐 lane）：
//   一、扫描面从「只有 src/style.css」扩到「src/components/**/*.vue 的 <style> 块」——
//       `.log-menu`（VcsLog.vue）这类挂在组件里的浮层原先一个都扫不到。
//   二、新增一条「浮层族必须用 --popup-border / --popup-radius」—— 此前有 12 处弹层
//       各自写 `1px solid var(--line)` / `var(--radius-sm)` / 干脆没圆角，与 tokens.css
//       写明的「菜单/补全/各处下拉共用一套」不符。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => readFileSync(join(root, relativePath), 'utf8')
const tokens = read('src/tokens.css')

// 禁改文件：这些是别的 lane 独占的，判据**不扫**它们（扫了就会把别人的红算到自己头上）。
// SourceControl.vue 的 `.sc-checks-popup` 是已知的唯一例外 —— 它是一个画了 `--elevated` 底、
// 却**没有** `color:` 的浮层（与这次的 `.log-menu` 同类问题），但它归 VCS lane，本 lane 不得改，
// 所以只能显式排除。等那个文件解锁后，它应当和其余浮层一样补上 `color: var(--popup-foreground)`。
const LOCKED = new Set([
  'src/components/CodeEditor.vue',
  'src/components/DebugPanel.vue',
  'src/components/SourceControl.vue',
  'src/components/DiffView.vue',
  'src/components/EditorFindBar.vue',
  'src/components/App.vue',
])

/** 从 .vue 里抽出所有 <style> 块（模板里的 `{{ }}` 会被 CSS 规则误当成选择器，必须剔掉）。 */
function styleOf(source) {
  const out = []
  for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push(match[1])
  return out.join('\n')
}

/** 扫描面：src/style.css + src/components 下所有 .vue 的样式块（禁改文件除外）。 */
function sources() {
  const list = [{ name: 'src/style.css', css: read('src/style.css') }]
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry.endsWith('.vue')) {
        const name = relative(root, full).replaceAll('\\', '/')
        if (LOCKED.has(name)) continue
        list.push({ name, css: styleOf(readFileSync(full, 'utf8')) })
      }
    }
  }
  walk(join(root, 'src/components'))
  return list
}

const SOURCES = sources()
const css = read('src/style.css')

// 浮层底色 = 这两个之一；浮层选择器 = 类名带这些语素（面板/菜单/弹窗/提示/选择器/列表）。
const SURFACE = /background:\s*var\(--(?:elevated|popup-background)\)/
const FLOATING = /\.(?:[\w-]*(?:dropdown|popup|menu|tooltip|hint|chooser|overlay|panel)[\w-]*)\b/
// 浮层族的家族记号：tokens.css 写明「菜单、补全、各处下拉共用 --popup-shadow」——
// 画了这个阴影的规则就是浮层族，边框/圆角必须跟着族走。
const POPUP_SHADOW = /box-shadow:\s*var\(--popup-shadow\)/

/** 把 CSS 切成 `{ selector, body }`（够用了：本仓样式没有嵌套规则）。 */
function blocks(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')   // 注释会被当成"选择器"，先去掉
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }))
}

/** 违反"浮层自带前景色"的规则（跨所有可改文件）。 */
function offenders() {
  const found = []
  for (const { name, css: source } of SOURCES) {
    for (const block of blocks(source)) {
      if (SURFACE.test(block.body) && FLOATING.test(block.selector) && !/\bcolor:/.test(block.body)) {
        found.push(`${name} :: ${block.selector}`)
      }
    }
  }
  return found
}

/** 违反"浮层族共用边框/圆角"的规则（按 --popup-shadow 认族）。 */
function borderOffenders() {
  const found = []
  for (const { name, css: source } of SOURCES) {
    for (const block of blocks(source)) {
      if (!POPUP_SHADOW.test(block.body)) continue
      const flags = []
      if (!/border:\s*var\(--popup-border\)/.test(block.body)) flags.push('border')
      if (!/border-radius:\s*var\(--popup-radius\)/.test(block.body)) flags.push('border-radius')
      if (flags.length) found.push(`${name} :: ${block.selector} （缺 ${flags.join(' + ')}）`)
    }
  }
  return found
}

test('每一个浮层都自己声明前景色，不靠父容器继承', () => {
  const found = offenders()
  assert.deepEqual(found, [], `这些浮层画了浮层底色却没写 color:，会被宿主容器（如 .topbar 的浅色字）继承污染：${found.join(' | ')}`)
  // 判据本身不能是空的：至少要有若干浮层被扫到，否则"零违规"没有意义。
  let painted = 0
  for (const { css: source } of SOURCES) {
    painted += blocks(source).filter(block => SURFACE.test(block.body) && FLOATING.test(block.selector)).length
  }
  assert.ok(painted >= 25, `扫描器只找到 ${painted} 个浮层规则 —— 判据退化成空转了（.vue 的样式块没被扫到？）`)
})

test('浮层族必须共用 --popup-border / --popup-radius', () => {
  const found = borderOffenders()
  assert.deepEqual(found, [], `这些规则画了 --popup-shadow（浮层族记号）却自造边框/圆角，与 tokens.css 的「菜单/补全/各处下拉共用一套」不符：${found.join(' | ')}`)
  let painted = 0
  for (const { css: source } of SOURCES) {
    painted += blocks(source).filter(block => POPUP_SHADOW.test(block.body)).length
  }
  assert.ok(painted >= 30, `扫描器只找到 ${painted} 条浮层族规则 —— 判据退化成空转了`)
})

test('禁改文件被显式排除在扫描面之外', () => {
  // 不是形式主义：LOCKED 里少一个，扫描面就会去扫别的 lane 独占的文件，把别人的缺口
  // 算成这条判据的红。SourceControl.vue 的 .sc-checks-popup（:886 画了 --elevated 底、
  // 却没有 color:）就是同类缺口，但它归 VCS lane —— 只能在这里显式排除，并留这条断言
  // 拦住「悄悄解锁」：谁把 SourceControl.vue 从名单里拿掉，这条会立刻点名。
  const scanned = new Set(SOURCES.map(source => source.name))
  for (const name of LOCKED) assert.ok(!scanned.has(name), `${name} 出现在扫描面里 —— 它归别的 lane，本判据不许扫它`)
  assert.ok(LOCKED.has('src/components/SourceControl.vue'), 'SourceControl.vue 必须留在排除名单里（.sc-checks-popup 是已知同类缺口，归 VCS lane）')
})

test('反例：漏写 color 的浮层必须被这条抓到', () => {
  const broken = '.dropdown { position: absolute; background: var(--elevated); box-shadow: var(--popup-shadow); }'
  const dirty = blocks(broken).filter(b => SURFACE.test(b.body) && FLOATING.test(b.selector) && !/\bcolor:/.test(b.body)).map(b => b.selector)
  assert.deepEqual(dirty, ['.dropdown'], '把 color 删掉都没报 —— 这条判据是假的')
  // 反例之二：非浮层（表单控件、普通面板）不该被误伤。
  const clean = blocks('.run-command { background: var(--elevated); }').filter(b => SURFACE.test(b.body) && FLOATING.test(b.selector) && !/\bcolor:/.test(b.body)).map(b => b.selector)
  assert.deepEqual(clean, [])
})

test('反例：自造边框/圆角的浮层必须被这条抓到', () => {
  const broken = '.log-menu { background: var(--elevated); border: 1px solid var(--line); border-radius: var(--radius-sm); box-shadow: var(--popup-shadow); }'
  const dirty = blocks(broken)
    .filter(b => POPUP_SHADOW.test(b.body) && (!/border:\s*var\(--popup-border\)/.test(b.body) || !/border-radius:\s*var\(--popup-radius\)/.test(b.body)))
    .map(b => b.selector)
  assert.deepEqual(dirty, ['.log-menu'], '自造边框/圆角没被抓 —— 这条判据是假的')
  // 反例之二：非浮层（没有 popup-shadow 的普通盒子）不该被误伤。
  const clean = blocks('.member-chooser-table th { background: var(--elevated); border: 1px solid var(--line); border-radius: var(--radius-sm); }')
    .filter(b => POPUP_SHADOW.test(b.body))
  assert.deepEqual(clean, [])
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
  // 反例（这次的 bug）：浮层正文曾经取**浅色顶栏**的前景，落在浮层底上几乎看不见。
  // 批次 87-B 把亮面顶栏改成亮底深字之后，"误取顶栏字色"这一类错不再致盲；反过来这条防线
  // 换了个方向去盯**顶栏字自己**：它也要过 AA —— 文件名弹层那几行就印在浮层那类浅底上。
  for (const theme of [0, 1]) {
    assert.ok(contrast(value('m-chrome-fg', theme), value('m-pop-bg', theme)) >= 4.5,
      `第 ${theme ? '暗' : '亮'} 档顶栏字压在浮层底上只有 ${contrast(value('m-chrome-fg', theme), value('m-pop-bg', theme)).toFixed(2)}`)
  }
  // 且结构上仍要隔开：浮层正文不许引用顶栏那组令牌，将来顶栏改色也不会连带把浮层正文带走。
  assert.doesNotMatch(tokens, /--popup-foreground: var\(--(?:header|m-chrome)/, '浮层正文不许取顶栏那组令牌')
})

test('禁用行有显式颜色，不靠浏览器对 disabled 按钮的默认淡化', () => {
  // UA 淡化在两档主题里是同一个灰法：浅色糊成一片、深色几乎看不出来 —— 正是这次的现场。
  assert.match(css, /\.menu-item:disabled, \.menu-button:disabled, \.select-in-row:disabled \{ color: var\(--popup-disabled\); \}/)
  assert.match(css, /\.menu-item:disabled \.menu-item-icon, \.menu-item:disabled > kbd \{ color: inherit; \}/,
    '图标与快捷键自己带颜色，禁用行会只淡一半，看着像渲染坏了')
})
