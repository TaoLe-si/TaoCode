// 「该用矢量图的地方用了字符字形」的兜底门禁。
//
// 为什么不并进 `tests/ui-icons.test.mjs`：`FORBIDDEN_ICON_GLYPHS` 是**按字形**列黑名单，
// 而 ↑ / ↓ 在正文里是合法的键盘提示文字（`App.vue:2085`「↑↓ 选择 · Enter 运行 · Esc 取消」、
// `SearchEverywhereDialog.vue:249`「Tab 切换 · ↑↓ 选择 · 回车打开」）—— 加进黑名单会误伤一大片文案。
// 所以这里换一条**结构判据**，不看字形表：
//
//   纯图标按钮（子树里没有可见文字）**必须渲染一个 `<svg>` 或一个组件**，
//   只剩一个文本节点 ⇒ 那是字形冒充图标（`ExternalTasksActivationDialog.vue:74/76/78`
//   原来的 `↑` `↓` `✕` 就是这样被抓出来的）。
//
// 判据走 AST 而不是正则模板：`<button @click="f('>')">…</button>` 这种属性值里带 `>`
// 的写法会让 `<button[^>]*` 提前截断，"没报"和"没看见"就分不开了
// （`ui-icons.test.mjs:152-159` 记的是同一个坑）。
//
// 2026-10-08 lane visual-leftovers 补的唯一豁免：**开关不是图标按钮**。
//   `src/components/agent-settings/AgentSettingsSwitch.vue` 是 ZCode 开关的移植 ——
//   上游 `.tools/ZCode/packages/ui/src/components/ui/switch.tsx`（Radix Switch = Root 轨道 + Thumb 滑块，
//   没有图标）与 `.tools/ZCode/packages/ui/src/settings/AutomationSwitchToggle.tsx:22-38`
//   （`<button role="switch" aria-checked aria-label>` + 轨道 + 一个绝对定位的圆形 `<span>` 滑块，同样没有图标）。
//   开关的状态由**轨道位置 + aria-checked** 表达，上游也没有那个形状的矢量图 —— 要求它画一个就是发明形状。
//   豁免条件写死成"`role="switch"` **且** `aria-checked`"两件齐全：想拿 role 当挡箭牌藏字形按钮，
//   拿不到另一半（下面还钉住"这条豁免必须真的用得上"，免得它变成垃圾桶）。
const SWITCH_ROLE = 'switch'
/** 静态属性的字面量值（`:role` 这类绑定取不到，返回 null）。 */
const attrOf = (node, name) => {
  for (const p of node.props ?? []) if (p.type === NodeTypes.ATTRIBUTE && p.name === name) return p.value?.content ?? ''
  return null
}
/** 有没有这个属性（静态属性或 `:x` 绑定都算）。 */
const hasProp = (node, name) => (node.props ?? []).some(p =>
  (p.type === NodeTypes.ATTRIBUTE && p.name === name) ||
  (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name))
//
// 上游依据（图标该长什么样）：
//   · `platform/platform-api/src/com/intellij/ui/CommonActionsPanel.java:61-88` —— Buttons 枚举
//     的每个分支都带一个 `AllIcons` / `IconUtil` 矢量图标，没有一个字形；
//   · `platform/core-ui/src/util/IconUtil.kt:252/255-256/258-259` —— remove/moveUp/moveDown 的具体图标；
//   · `platform/util/ui/src/com/intellij/icons/AllIcons.java:655/135/120` —— 三个都是 16x16 SVG；
//   · `platform/external-system-impl/.../task/ui/ConfigureTasksActivationDialog.java:193-201` ——
//     本仓这个对话框对应的那一族：remove / moveUp / moveDown 三个按钮的挂法。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const require = createRequire(import.meta.url)
const { ICON_SIZE, FORBIDDEN_ICON_GLYPHS } = require('../src/uiIcons.ts')

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function vueFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const FILES = vueFiles()
const PARSED = new Map(FILES.map(file => {
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  return [file, descriptor]
}))
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')
/** 例外表里写的是仓库相对路径（`src/...`），PARSED 的键是绝对路径 —— 这里对一下。 */
const byRel = new Map([...PARSED.keys()].map(file => [rel(file), file]))

function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** 内联 lucide 图标的组件名（`lucide-vue-next` 导入的那些）。
 *  一个文件可能有**多条**独立的 lucide import（`BookmarksPanel.vue:15` 与 `:25` 各一条），
 *  只认第一条会把 `ArrowDownUp` 判成"没导入"，于是那一行被误报成字形冒充图标。 */
function lucideImportsOf(file) {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-vue-next['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name) names.add(name)
    }
  }
  return names
}

/** 本仓自己的矢量图标（`components/icons/` 的 IDEA expui 副本）的组件名。
 *  与 lucide 那条同理：它们是真组件、真 SVG，只是来源不同（见 src/components/icons/index.ts
 *  的通道划分）—— 门禁要认它们，否则 `ToolStripe.vue` 的「更多」按钮会被误报成字形。 */
function ideaImportsOf(file) {
  const src = readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*icons\/[^'"]*['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  return names
}

/** `:size="iconSize.x"` 里的 x（静态属性与指令都要认；这里只取字面量那一支）。 */
function sizeRoleOf(node) {
  for (const p of node.props ?? []) {
    if (p.type === NodeTypes.ATTRIBUTE && p.name === 'size') return p.value?.content
    if (p.type === NodeTypes.DIRECTIVE && p.arg?.content === 'size') return p.exp?.content
  }
  return undefined
}

/** 「纯图标按钮」= 去掉符号之后**一个字母/数字/汉字都不剩**。
 *  这里必须这么绕一层：字形（`↑ ↓ ✕ ·`）在 AST 里就是**文本节点**，直接判"有没有文字"
 *  会让这些按钮全部当成"带文字的按钮"提前放行 —— 门禁就白写了。
 *  `Array.from(s).filter(c => /[\p{L}\p{N}]/u.test(c))` 的结果是空的 ⇒ 这个按钮
 *  渲染出来的全是符号 ⇒ 它在冒充图标。
 *  反过来，只要里面有真字母/数字/汉字（`选择任务…`、`×3`、`Foo`）就是文字，放行。 */
const hasRealWord = text => /[\p{L}\p{N}]/u.test(text)

/**
 * 「符号即文字」的例外表 —— 按 (文件, 按钮里那个符号串) 精确匹配，每条必须写清理由。
 * 没有这张表，门禁会卡在一个两难上：判"有没有文字"太松（放过 `↑`），判"是不是全符号"
 * 太紧（误伤 `Aa`/`.*`/`$` 这些**确实是文字**的开关标签）。
 */
const SYMBOL_TEXT_EXEMPTIONS = [
  // `Aa` / `.*` / `词` 是本仓查找面板的三档开关，`.*` 与 `词` 分别是"正则"与"全词"的意思，
  // 写成符号是刻意的（上游查找栏那几颗开关也是极短标签）。本轮**没能**在本 fork 的源码树里
  // 找到这三个标签的字面出处（搜过 platform 下的 IdeActions / FindPopupHeader / *.properties，
  // 无 `ToggleMatchCase` / `ToggleWordMatch` 这类动作定义）⇒ 标为无法核实，
  // 保持现状，不在本批处置。依据：本仓判决书 `docs/inventory/verdict-find-diff.md:879`
  // 已经把 `Aa/.*/词` 三档记为 `FindPopupHeader.kt` 的对应物。
  { file: 'src/components/SearchPanel.vue', text: '.*', why: '「正则」开关的标签；上游字面出处未能核实，保持现状' },
  { file: 'src/components/SearchPanel.vue', text: '$', why: '「结构化搜索」开关的标签；上游字面出处未能核实，保持现状' },
  // 标签条的溢出开关是本仓**自有**控件（`App.vue:2228`），上游没有对应物可核 ⇒ 无法核实。
  { file: 'src/App.vue', text: '…', why: '标签条溢出开关是本仓自有控件，上游无对应物，无法核实' },
]

const BUTTON_TAGS = new Set(['button'])

test('纯图标按钮必须渲染矢量图标，不能只渲染一个字符', () => {
  const bad = []
  let switches = 0
  for (const [file, d] of PARSED) {
    const tpl = d.template?.content
    if (!tpl) continue
    const offset = d.template.loc.start.line - 1
    const lucide = lucideImportsOf(file)
    const idea = ideaImportsOf(file)
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || !BUTTON_TAGS.has(node.tag)) return
      // 「纯图标」= 子树里既没有文本、也没有插值。
      let text = ''
      let hasVector = false
      walk(node, n => {
        if (n.type === NodeTypes.TEXT) text += n.content
        else if (n.type === NodeTypes.INTERPOLATION) text += n.content.content
        else if (n.type === NodeTypes.ELEMENT) {
          if (n.tag === 'svg' || n.tag === 'component') hasVector = true
          else if (lucide.has(n.tag) || idea.has(n.tag)) hasVector = true
        }
      })
      if (hasRealWord(text)) return    // 有真文字（`选择任务…`、`×3`、`Aa`）：那是文字，不是图标
      if (hasVector) return            // 已经是矢量图
      // 开关豁免（见文件头）：`role="switch"` + `aria-checked` 两件齐全才算开关。
      if (attrOf(node, 'role') === SWITCH_ROLE && hasProp(node, 'aria-checked')) { switches += 1; return }
      const key = text.trim()
      if (SYMBOL_TEXT_EXEMPTIONS.some(e => e.file === rel(file) && e.text === key)) return
      // 色卡按钮（`ColorChooserDialog.vue:114/115`）本来就"没有图标" —— 它整个样子就是一块
      // 背景色。按 `:style` 里有没有 background 认，不按类名认（免得改个类名就失效）。
      const style = node.props.find(p =>
        (p.type === NodeTypes.ATTRIBUTE && p.name === 'style') ||
        (p.type === NodeTypes.DIRECTIVE && p.arg?.content === 'style'))
      if (style) {
        const raw = style.type === NodeTypes.ATTRIBUTE ? style.value?.content : style.exp?.content
        if (/\bbackground\b/.test(raw ?? '')) return
      }
      const hidden = node.props.some(p =>
        (p.type === NodeTypes.ATTRIBUTE && p.name === 'aria-hidden') ||
        (p.type === NodeTypes.DIRECTIVE && p.arg?.content === 'aria-hidden'))
      if (hidden) return
      bad.push(`${rel(file)}:${node.loc.start.line + offset} <${node.tag}> 子树里没有 svg/组件`)
    })
  }
  assert.deepEqual(bad, [], `这些纯图标按钮没渲染任何矢量图标（多半是个字形）：\n${bad.join('\n')}`)
  // 开关豁免的反向守卫（同下面「例外表不许养着空条目」的口气）：仓库里得真有开关按钮，
  // 否则这条豁免就是垃圾桶里的空条目，该删掉。
  assert.ok(switches >= 1, '开关豁免已经用不上了：全仓找不到 role="switch" + aria-checked 的按钮，删掉那条豁免')
})

test('例外表不许养着空条目（写进去的例外必须真的还在那儿）', () => {
  // 反向的门禁：例外表最容易变成"垃圾桶" —— 条目留着，代码早改了，于是它开始
  // 悄悄放过新出现的字形。所以每条都要回去确认那个按钮还在、内容还是那个符号。
  const stale = []
  for (const { file, text, why } of SYMBOL_TEXT_EXEMPTIONS) {
    assert.ok((why ?? '').trim().length >= 8, `${file} 的例外 ${text} 没写理由`)
    const parsed = PARSED.get(byRel.get(file))
    assert.ok(parsed?.template?.content, `例外表里的 ${file} 不存在了（或者路径写错了）`)
    let seen = false
    walk(parseDom(parsed.template.content), node => {
      if (node.type === NodeTypes.TEXT && node.content.trim() === text) seen = true
    })
    if (!seen) stale.push(`${file} 里已经找不到 ${JSON.stringify(text)}`)
  }
  assert.deepEqual(stale, [], `这些例外已经不成立了，删掉：\n${stale.join('\n')}`)
})

test('字形黑名单真的覆盖了被当成图标用过的那些字符', () => {
  // 这三个都在 `ExternalTasksActivationDialog.vue` 里当过图标，逐个钉住：
  // ✕ 是 U+2715（叉号），跟黑名单里原有的 × (U+00D7，乘号) **不是同一个字形**，
  // 所以光靠 × 那一条根本抓不到它 —— 这正是它能活下来的原因。
  const glyphs = FORBIDDEN_ICON_GLYPHS.map(g => g.glyph)
  assert.ok(glyphs.includes('✕'), '✕ (U+2715) 必须单独进黑名单，× (U+00D7) 抓不到它')
  assert.ok(glyphs.includes('×'), '× (U+00D7) 不能被 ✕ 替换掉 —— 它是乘号豁免那条要匹配的字符')
  assert.ok(glyphs.includes('●'), '● 是「正在运行」记号，必须留着')
  // 每一条都要写清楚该换成什么，否则这张表就只是一张黑名单。
  // （`✖` 写的是「同上」——指回上一条 `✗`，是有意的简写，所以门槛只要求非空。）
  for (const { glyph, use } of FORBIDDEN_ICON_GLYPHS) {
    assert.ok((use ?? '').trim().length >= 2, `字形 ${glyph} 没写该换成什么`)
  }
})

test('ExternalTasksActivationDialog 的重排/移除按钮用的是上游那几个矢量图标', () => {
  // 上游 `ConfigureTasksActivationDialog.java:198-201` 挂的是 moveUp/moveDown，
  // 走 `ToolbarDecorator.java:489-493` → `CommonActionsPanel.Buttons`：
  //   UP   = `IconUtil.getMoveUpIcon()`   (`CommonActionsPanel.java:79`) → `AllIcons.Actions.MoveUp`
  //   DOWN = `IconUtil.getMoveDownIcon()` (`CommonActionsPanel.java:85`) → `AllIcons.Actions.MoveDown`
  //   REMOVE = `AllIcons.General.Remove`  (`CommonActionsPanel.java:67`)
  // 三个都是 16x16（`AllIcons.java:655/135/120`），所以尺寸档取 `action` = 16。
  // 形状也一一对上（都是读上游 SVG 的 path 核的，不是"挑个差不多的"）：
  //   moveUp.svg   = 向上箭头 + **下方**一条横基线  ⇒ lucide `ArrowUpFromLine`
  //   moveDown.svg = **上方**一条横基线 + 向下箭头  ⇒ lucide `ArrowDownFromLine`
  //   remove.svg   = 只有一条横杠（没有叉）        ⇒ lucide `Minus`
  const file = join(SRC, 'components', 'ExternalTasksActivationDialog.vue')
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  const ast = parseDom(descriptor.template.content)
  const found = new Map()
  walk(ast, node => {
    if (node.type !== NodeTypes.ELEMENT) return
    if (node.tag !== 'ArrowUpFromLine' && node.tag !== 'ArrowDownFromLine' && node.tag !== 'Minus') return
    found.set(node.tag, sizeRoleOf(node))
  })
  assert.equal(found.get('ArrowUpFromLine'), 'iconSize.action', '上移按钮要 ArrowUpFromLine @ iconSize.action')
  assert.equal(found.get('ArrowDownFromLine'), 'iconSize.action', '下移按钮要 ArrowDownFromLine @ iconSize.action')
  assert.equal(found.get('Minus'), 'iconSize.action', '移除按钮要 Minus（横杠）@ iconSize.action，不是 X')
  assert.equal(ICON_SIZE.action, 16, '上游这三个图标都是 16x16 SVG')
})

test('任务行里的按钮不能用"形状对不上"的替代图标', () => {
  // moveUp/moveDown 带基线、remove 是横杠；写成 `ArrowUp` / `ArrowDown` / `X` / `Trash2`
  // 都能编过，但渲染出来是**另一个图形**。这一条把它们钉死。
  // 判据是**祖先链**上有没有 `.activation-phase`：对话框顶栏那个关闭按钮用 `X` 是对的
  // （上游 DialogWrapper 的关闭就是 X），只有重排/移除这三颗受基线/横杠约束。
  const file = join(SRC, 'components', 'ExternalTasksActivationDialog.vue')
  const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  const ast = parseDom(descriptor.template.content)
  const staticClassOf = node => node.props
    ?.find(p => p.type === NodeTypes.ATTRIBUTE && p.name === 'class')?.value?.content ?? ''
  const wrong = []
  const descend = (node, insidePhase) => {
    if (node.type !== NodeTypes.ELEMENT && node.type !== NodeTypes.ROOT && node.type !== NodeTypes.FRAGMENT) return
    const inPhase = insidePhase || staticClassOf(node).split(/\s+/).includes('activation-phase')
    if (inPhase && node.type === NodeTypes.ELEMENT &&
        ['ArrowUp', 'ArrowDown', 'X', 'Trash2', 'ArrowUpToLine', 'ArrowDownToLine'].includes(node.tag)) {
      wrong.push(`${node.tag} @ ${node.loc.start.line}`)
    }
    for (const child of node.children ?? []) descend(child, inPhase)
  }
  descend(ast, false)
  assert.deepEqual(wrong, [], `任务行里的按钮图标换错了（要么没基线、要么是叉不是横杠）：${wrong.join(' / ')}`)
})
