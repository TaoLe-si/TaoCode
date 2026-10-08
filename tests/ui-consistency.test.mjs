// UI 收口线（2026-10-06）的判据：**布局错位 / 格式不统一 / 字体图标不对齐** 三类的机检。
//
// 每一类都钉在本批真实改过的落点上（源码出处逐条写在断言旁），不做"风格偏好"式门禁。
//   1. 布局：树行高取上游 `Tree.rowHeight`（`JBUI.java:2526-2528` defaultRowHeight = scale(24)）；
//      ManageRecentProjects 弹层尺寸取上游 300x485（`ManageRecentProjectsAction.java:38-39/:75`）；
//      「最近项目」一行是**五**格（图标/名称/路径/打开/移除），grid 轨道数必须与子元素数一致
//      —— 少一格会让最后一个子元素落到第二行那个 14px 的图标格里（重叠）。
//   2. 格式：同一控件在不同面板写法必须一致（`.field-hint` / `.ft-hint` 的字号；
//      VCS 日志弹层的浮层族外观；裸的 999px 圆角统一走 `--radius-pill`）。
//   3. 图标对齐：带「图标 + 文字」的行必须 `display: flex` + `align-items: center`
//      （行内并排的走 `vertical-align`），否则 SVG 的基线（自身下沿）会沉到文字基线上。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = rel => readFileSync(join(SRC, String(rel).replace(/^src[\\/]/, '')), 'utf8')

/** 禁改文件（大组件 lane / 另一 lane 独占）：结构性图标对齐巡检要跳过。 */
const EXEMPT = new Set([
  'src/App.vue',
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

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** 把 CSS 的 `选择器 { 声明 }` 拆开；`subject` = 最后一个复合选择器（规则主体）。 */
function rules(css) {
  const out = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), subject: m[1].trim().split(/\s*[>+~]\s*/).pop(), body: m[2] })
  }
  return out
}
const declOf = (body, prop) => {
  for (const d of body.split(';')) {
    const i = d.indexOf(':')
    if (i < 0) continue
    if (d.slice(0, i).trim() === prop) return d.slice(i + 1).trim()
  }
  return undefined
}

// ── 1 · 布局 ──────────────────────────────────────────────────────────────────

test('树行高走 --tree-row-h 令牌，取值 24（上游 Tree.rowHeight 默认 scale(24)）', () => {
  const tokens = read('src/tokens.css')
  assert.match(tokens, /--tree-row-h:\s*24px;/, 'tokens.css 缺 --tree-row-h: 24px')
  // 出处写在令牌旁：上游 `JBUI.java` 的 Tree.defaultRowHeight() = JBUIScale.scale(24)。
  assert.match(tokens, /--tree-row-h[\s\S]{0,500}?JBUI\.java:\d+/, '--tree-row-h 旁没写上游 file:line 出处')
  assert.match(tokens, /defaultRowHeight\(\)\s*=\s*JBUIScale\.scale\(24\)/, '--tree-row-h 没写上游取值本身')
  const css = read('src/style.css')
  const entry = rules(css).find(r => r.subject === '.tree-entry')
  assert.ok(entry, 'style.css 里没有 .tree-entry')
  assert.equal(declOf(entry.body, 'height'), 'var(--tree-row-h)', '.tree-entry 的行高要取令牌')
  assert.doesNotMatch(css, /\.tree-entry\s*\{[^}]*height:\s*26px/, '树行又写回了 26px（那是 VCS 日志行的默认值，不是树行的）')
})

test('「最近项目」弹层尺寸取上游 300x485，不再目测成 480', () => {
  const css = read('src/style.css')
  const dlg = rules(css).find(r => r.subject === '.manage-recents-dialog')
  assert.ok(dlg, 'style.css 里没有 .manage-recents-dialog')
  assert.equal(declOf(dlg.body, 'width'), '300px', '宽度要取上游 DEFAULT_POPUP_WIDTH = 300')
  assert.match(declOf(dlg.body, 'max-height') ?? '', /485px/, '高度上限要取上游 DEFAULT_POPUP_HEIGHT = 485')
  assert.doesNotMatch(css, /\.manage-recents-dialog\s*\{[^}]*width:\s*480px/, '480px 是目测值')
})

test('「最近项目」一行是五格，grid 轨道数必须与子元素数一致（否则末位落进 14px 图标格）', () => {
  const css = read('src/style.css')
  const row = rules(css).find(r => r.subject === '.manage-recents-row')
  assert.ok(row, 'style.css 里没有 .manage-recents-row')
  const cols = declOf(row.body, 'grid-template-columns') ?? ''
  let tracks = 0
  for (const tok of cols.trim().split(/\s+/)) {
    const rep = /^repeat\((\d+),/.exec(tok)
    if (rep) { tracks += Number(rep[1]); continue }
    if (/^(minmax|fit-content)\(/.test(tok) || /^auto$/.test(tok) || /^[0-9.]+(fr|px|rem|em|%|ch)$/.test(tok)) tracks += 1
  }
  // 子元素数从 App.vue 的真实模板里数（App.vue 是禁改文件，只能读）。
  const app = read('src/App.vue')
  const ast = parseDom(app.slice(app.indexOf('<template>')))
  let rowNode = null
  walk(ast, n => {
    if (n.type !== NodeTypes.ELEMENT) return
    const cls = (n.props ?? []).find(p => p.type === NodeTypes.ATTRIBUTE && p.name === 'class')?.value?.content ?? ''
    if (cls.split(/\s+/).includes('manage-recents-row')) rowNode = n
  })
  assert.ok(rowNode, 'App.vue 里找不到 .manage-recents-row')
  const children = (rowNode.children ?? []).filter(c => c.type === NodeTypes.ELEMENT).length
  assert.equal(tracks, children, `.manage-recents-row 有 ${children} 个子元素，但 grid 只声明了 ${tracks} 条轨道（"${cols}"）`)
})

// ── 2 · 格式不统一 ────────────────────────────────────────────────────────────

test('设置页「提示行」字号一致：所有 .field-hint 都是 11px（原先色彩页是 12）', () => {
  const sizes = new Map()
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    for (const st of descriptor.styles ?? []) {
      for (const r of rules(st.content)) {
        if (r.subject !== '.field-hint') continue
        const fs = declOf(r.body, 'font-size')
        if (fs) sizes.set(rel(file), fs)
      }
    }
  }
  assert.ok(sizes.size >= 3, `只找到 ${sizes.size} 处 .field-hint，门禁可能在空转`)
  for (const [file, fs] of sizes) assert.equal(fs, '11px', `${file} 的 .field-hint 字号是 ${fs}，与其余面板不一致`)
})

test('文件模板页 / 文件类型页的 .ft-hint 字号一致（都是 11px）', () => {
  for (const file of ['src/components/FileTemplatesSettingsPage.vue', 'src/components/FileTypesPage.vue']) {
    const m = /\.ft-hint\s*\{([^}]*)\}/.exec(read(file))
    assert.ok(m, `${file} 里没有 .ft-hint`)
    assert.equal(declOf(m[1], 'font-size'), '11px', `${file} 的 .ft-hint 字号应统一为 11px`)
  }
})

test('VCS 日志的四个弹层用同一套浮层外观（border/radius/background/shadow 走 --popup-*）', () => {
  for (const file of [
    'src/components/VcsLogFilters.vue',
    'src/components/VcsLogGoToRef.vue',
    'src/components/VcsLogGraphOptions.vue',
    'src/components/VcsLogTextFilterSettings.vue',
  ]) {
    const m = /\.popup\s*\{([^}]*)\}/.exec(read(file))
    assert.ok(m, `${file} 里没有 .popup`)
    const body = m[1]
    assert.equal(declOf(body, 'border'), 'var(--popup-border)', `${file} 的 .popup 边框没走浮层族令牌`)
    assert.equal(declOf(body, 'border-radius'), 'var(--popup-radius)', `${file} 的 .popup 圆角没走浮层族令牌`)
    assert.equal(declOf(body, 'background'), 'var(--elevated)', `${file} 的 .popup 底色没走浮层族令牌`)
    assert.equal(declOf(body, 'box-shadow'), 'var(--popup-shadow)', `${file} 的 .popup 阴影没走浮层族令牌`)
    assert.equal(declOf(body, 'color'), 'var(--popup-foreground)', `${file} 的 .popup 没显式声明前景色`)
  }
})

test('对话框 / 设置页的单行输入控件统一走 --ctrl-height 令牌（上游 expUI TextField.minimumSize = 49,28）', () => {
  // 上游取值：`expUI_light.theme.json:668-672` / `expUI_dark.theme.json:657-661` 的
  // `"TextField": { "minimumSize": "49,28" }` —— New UI 里单行文本控件的基准高是 28。
  // 本仓 `--ctrl-height` = 28，且 FileTemplates / ExternalTools / ProjectStructure / TemplateSettings
  // 四个设置页的输入框**已经**用它 —— 这两处（工程向导 / 通用设置）原先写 34、33 是仅剩的不一致。
  const tokens = read('src/tokens.css')
  assert.match(tokens, /--ctrl-height:\s*28px;/, '--ctrl-height 应为 28（上游 TextField.minimumSize 的高）')
  const cases = [
    ['src/components/ProjectDialog.vue', /\.form-field input, \.form-field select\s*\{([^}]*)\}/],
    ['src/components/SettingsDialog.vue', /\.input-row input, \.input-row select\s*\{([^}]*)\}/],
    ['src/components/SettingsDialog.vue', /\.zoom-row select\s*\{([^}]*)\}/],
    ['src/components/WelcomePage.vue', /\.customize-row select, \.customize-row input\s*\{([^}]*)\}/],
  ]
  for (const [file, re] of cases) {
    const m = re.exec(read(file))
    assert.ok(m, `${file} 里没找到 ${re}`)
    assert.equal(declOf(m[1], 'min-height'), 'var(--ctrl-height)', `${file} 的输入控件高度要统一走 --ctrl-height`)
  }
  const cc = /\.color-fields select\s*\{([^}]*)\}/.exec(read('src/components/ColorChooserDialog.vue'))
  assert.ok(cc, 'ColorChooserDialog 里没有 .color-fields select')
  assert.equal(declOf(cc[1], 'height'), 'var(--ctrl-height-sm)', '色板选择框要走 --ctrl-height-sm（24）')
})

test('圆角不再出现裸的 999px（统一走 --radius-pill）', () => {
  const offenders = []
  const sheets = [['src/style.css', read('src/style.css')], ...vueFiles().map(f => [rel(f), readFileSync(f, 'utf8')])]
  for (const [file, text] of sheets) {
    if (EXEMPT.has(file)) continue
    for (const m of text.matchAll(/border-radius:\s*999px/g)) {
      offenders.push(`${file}:${text.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(offenders, [], `这些圆角是裸的 999px，应写 var(--radius-pill)：\n${offenders.join('\n')}`)
})

test('原生复选框统一 14px（--icon-size-checkbox）：上游 CheckboxIcon.kt:42 iconSize = 14', () => {
  // 上游 `platform/platform-api/src/com/intellij/util/ui/CheckboxIcon.kt:42` `iconSize = 14`
  // （New UI 的圆角 arc = 4，:45-47）。本仓是原生 `<input type=checkbox>` + `accent-color`，
  // 尺寸得自己写 —— 原先散落 12/13/14/15 四种，这里统一钉到 `--icon-size-checkbox`（=14）。
  // 判据按「带 accent-color 的 input 规则」认（那是本仓复选框/单选框唯一的共同标记）。
  const offenders = []
  const sheets = [['src/style.css', read('src/style.css')], ...vueFiles().map(f => [rel(f), readFileSync(f, 'utf8')])]
  for (const [file, text] of sheets) {
    if (EXEMPT.has(file)) continue
    const css = file.endsWith('.css') ? text : (text.split('<style').slice(1).join('\n'))
    for (const r of rules(css)) {
      if (!/accent-color:\s*var\(--accent\)/.test(r.body)) continue
      const w = declOf(r.body, 'width'), h = declOf(r.body, 'height')
      const tok = 'var(--icon-size-checkbox)'
      if (w === tok && h === tok) continue
      offenders.push(`${file} ${r.selector}  width=${w ?? '-'} height=${h ?? '-'}`)
    }
  }
  assert.deepEqual(offenders, [], `这些复选框没统一成 14px 的 --icon-size-checkbox：\n${offenders.join('\n')}`)
})

// ── 3 · 字体图标不对齐 ────────────────────────────────────────────────────────

test('带「图标 + 文字」的行必须有 flex + align-items: center 或行内 vertical-align', () => {
  // 类 -> 规则集合：flex 容器 / 居中 / 列向 / 给 > svg 写了 vertical-align。
  const flexed = new Set(), centered = new Set(), column = new Set(), valigned = new Set()
  const collect = css => {
    for (const r of rules(css)) {
      const classes = [...r.subject.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(c => c[1])
      for (const c of classes) {
        if (/display:\s*(inline-)?flex/.test(r.body)) flexed.add(c)
        if (/align-items:\s*center/.test(r.body)) centered.add(c)
        if (/flex-direction:\s*column/.test(r.body)) column.add(c)
      }
      if (/>\s*svg/.test(r.selector) && /vertical-align:\s*(middle|text-bottom|text-top|-?[\d.]+em)/.test(r.body)) {
        // 选择器是 `.X > svg` 这类**后代**规则：容器类是 > 左边那一段，不是 r.subject（那是 'svg'）。
        for (const c of r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) valigned.add(c[1])
      }
    }
  }
  collect(read('src/style.css'))
  const parsed = []
  for (const file of vueFiles()) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    for (const st of descriptor.styles ?? []) collect(st.content)
    parsed.push([file, descriptor])
  }
  const bad = []
  for (const [file, descriptor] of parsed) {
    if (EXEMPT.has(rel(file))) continue
    const tpl = descriptor.template?.content
    if (!tpl) continue
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    const offset = descriptor.template.loc.start.line - 1
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT) return
      const props = node.props ?? []
      const cls = props.find(p => p.type === NodeTypes.ATTRIBUTE && p.name === 'class')?.value?.content ?? ''
      const classes = cls.split(/\s+/).filter(Boolean)
      if (!classes.length) return
      if (props.some(p => p.type === NodeTypes.ATTRIBUTE && p.name === 'style')) return // 行内样式的按钮（色卡）跳过
      let hasVec = false, hasText = false
      for (const c of node.children ?? []) {
        if (c.type === NodeTypes.ELEMENT && (c.tag === 'svg' || c.tag === 'component' || /^[A-Z]/.test(c.tag))) hasVec = true
        if (c.type === NodeTypes.TEXT && c.content.trim()) hasText = true
        if (c.type === NodeTypes.INTERPOLATION) hasText = true
      }
      if (!(hasVec && hasText)) return
      if (classes.some(c => valigned.has(c))) return
      if (classes.some(c => column.has(c))) return            // 列向堆叠，不涉及侧向基线
      if (classes.some(c => flexed.has(c) && centered.has(c))) return
      bad.push(`${rel(file)}:${node.loc.start.line + offset} .${cls.slice(0, 60)}`)
    })
  }
  assert.deepEqual(bad, [], `这些「图标 + 文字」行没居中（SVG 基线会沉到文字基线上）：\n${bad.join('\n')}`)
})

test('状态栏 chip / 依赖页按钮 / Gradle 行都居中图标与文字', () => {
  const chip = rules(read('src/style.css')).find(r => r.subject === '.status-chip')
  assert.ok(chip, 'style.css 里没有 .status-chip')
  assert.match(chip.body, /display:\s*inline-flex/, '.status-chip 要 inline-flex')
  assert.match(chip.body, /align-items:\s*center/, '.status-chip 要 align-items: center')
  const deps = /\.deps-clear\s*\{([^}]*)\}/.exec(read('src/components/PackageDepsDialog.vue'))
  assert.ok(deps, 'PackageDepsDialog 里没有 .deps-clear')
  assert.match(deps[1], /display:\s*inline-flex/, '.deps-clear 要 inline-flex')
  assert.match(deps[1], /align-items:\s*center/, '.deps-clear 要 align-items: center')
  const gradle = /\.gradle-running\s*\{([^}]*)\}/.exec(read('src/components/GradlePanel.vue'))
  assert.ok(gradle, 'GradlePanel 里没有 .gradle-running')
  assert.match(gradle[1], /align-items:\s*center/, '.gradle-running 要 align-items: center')
})

test('调试控制台跳转按钮是真矢量图标，不是 ↪ 字形，且与文字垂直居中对齐', () => {
  const text = read('src/components/DebugConsolePane.vue')
  assert.ok(!text.includes('\u21aa'), '↪ 是字形冒充图标，应换成 CornerDownRight')
  assert.match(text, /import\s*\{[^}]*\bCornerDownRight\b[^}]*\}\s*from\s*'lucide-vue-next'/, '要 import CornerDownRight')
  assert.match(text, /<CornerDownRight\s+:size="iconSize\.inline"\s*\/>/, '跳转按钮要画 CornerDownRight')
  const jump = /\.debug-console-jump\s*\{([^}]*)\}/.exec(text)
  assert.ok(jump, '没有 .debug-console-jump')
  assert.match(jump[1], /display:\s*inline-flex/, '按钮要 inline-flex')
  assert.match(jump[1], /align-self:\s*center/, '行是 baseline 对齐，按钮要 align-self: center 才不会沉下去')
})
