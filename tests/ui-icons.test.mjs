import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { parse as parseSfc, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { parse as parseDom, NodeTypes } from '@vue/compiler-dom'

const require = createRequire(import.meta.url)
const { ICON_SIZE, ICON_SIZE_CSS_VAR, ICON_SIZE_PROVENANCE, ICON_ROLE_BY_PX, iconSize, FORBIDDEN_ICON_GLYPHS, ICON_STROKE } = require('../src/uiIcons.ts')
const tokens = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

/** 仓库里所有 .vue（src 根 + components）。 */
function vueFiles(dir = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) vueFiles(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}
const FILES = vueFiles()
/** 只读模板原文 —— 图标/动效门禁都只看模板里的写法。 */
const PARSED = new Map(FILES.map(file => {
  const { descriptor, errors } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
  assert.equal(errors.length, 0, `${file} 解析失败：${errors[0]?.message}`)
  return [file, descriptor]
}))
const TEMPLATES = new Map([...PARSED].map(([file, d]) => [file, d.template?.content ?? '']))
/** 模板内容里的行号要加回 `<template>` 前面那几行，才是文件里的真实行号。 */
const descriptorOffset = file => PARSED.get(file).template.loc.start.line - 1
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')

/** 遍历 AST。 */
function walk(node, visit) {
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

/** 元素上的静态 class（`:class` 是绑定，取不到字面量，返回 null）。 */
function staticClassOf(node) {
  for (const p of node.props ?? []) if (p.type === NodeTypes.ATTRIBUTE && p.name === 'class') return p.value?.content ?? ''
  return null
}

test('尺寸阶梯与 tokens.css 逐档同步（几何只在一个地方定义）', () => {
  for (const [role, px] of Object.entries(ICON_SIZE)) {
    const varName = ICON_SIZE_CSS_VAR[role]
    assert.equal(varName, `--icon-size-${role}`, `${role} 的 CSS 变量名要跟角色同名`)
    const rule = new RegExp(`${varName}:\\s*${px}px;`)
    assert.match(tokens, rule, `tokens.css 缺 ${varName}: ${px}px（uiIcons.ts 说 ${role} 是 ${px}）`)
  }
  // 反向：tokens.css 里不能有本模块没登记的 --icon-size-*（否则多了一档没人知道出处）
  const declared = [...tokens.matchAll(/--icon-size-([a-z]+):/g)].map(m => m[1])
  assert.deepEqual(declared.sort(), Object.keys(ICON_SIZE).sort(), 'tokens.css 的图标档位与 uiIcons.ts 不一致')
})

test('ICON_ROLE_BY_PX 覆盖了阶梯上的每一个像素（没有落在阶梯外的数字）', () => {
  // control 与 checkbox 同为 14px —— 同一像素只能反查到一个角色，所以这条只核覆盖率，
  // 不核双向唯一。两档同尺寸是有据的（uiIcons.ts 的 control 档与 CheckboxIcon.kt:42 都给 14）。
  for (const [role, px] of Object.entries(ICON_SIZE)) assert.equal(ICON_SIZE[ICON_ROLE_BY_PX[px]], px, `${role} = ${px}px 但按像素反查不到`)
  assert.deepEqual(Object.keys(ICON_ROLE_BY_PX).map(Number).sort((a, b) => a - b),
    [...new Set(Object.values(ICON_SIZE))].sort((a, b) => a - b), '像素表和尺寸阶梯对不上')
})

test('每一档尺寸都登记了出处：upstream 必带 file:line，local 必写为什么上游没有', () => {
  assert.deepEqual(Object.keys(ICON_SIZE_PROVENANCE).sort(), Object.keys(ICON_SIZE).sort(), '有档位没登记出处')
  for (const [role, entry] of Object.entries(ICON_SIZE_PROVENANCE)) {
    if (entry.from === 'upstream') {
      assert.match(entry.at ?? '', /:\d+/, `${role} 标了 upstream 却没有 file:line 出处`)
    } else {
      assert.equal(entry.from, 'local')
      assert.ok((entry.why ?? '').length >= 10, `${role} 标了 local 就要说清上游为什么没有这个度量`)
    }
  }
})

test('模板里直接可用的 iconSize 是普通对象而不是函数（模板要写 iconSize.menu）', () => {
  assert.equal(iconSize, ICON_SIZE)
  assert.equal(typeof iconSize, 'object', '导出函数会让 vue-tsc 报 TS2339')
  for (const role of Object.keys(ICON_SIZE)) assert.equal(typeof iconSize[role], 'number', `缺 ${role}`)
})

test('模板里不再有硬编码的 :size="N"（尺寸只从角色取）', () => {
  const bad = []
  for (const [file, tpl] of TEMPLATES) {
    for (const m of tpl.matchAll(/:size\s*=\s*"([^"]*)"/g)) if (/^\s*\d+\s*$/.test(m[1])) bad.push(`${rel(file)} :size="${m[1]}"`)
  }
  assert.deepEqual(bad, [], `这些地方该换成 :size="iconSize.<role>"：\n${bad.join('\n')}`)
})

test('用了 iconSize 的模板必须真的 import 它（片段渲染/懒加载会静默拿到 undefined）', () => {
  const bad = []
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8')
    if (!/iconSize\./.test(src)) continue
    if (!/\bimport\s*\{[^}]*\biconSize\b[^}]*\}\s*from\s*['"][^'"]*uiIcons['"]/.test(src)) bad.push(rel(file))
  }
  assert.deepEqual(bad, [], `这些文件用了 iconSize 但没 import：\n${bad.join('\n')}`)
})

test('模板里没有 Unicode 字形冒充图标（统一走 lucide 组件）', () => {
  // 唯一豁免：`×` 紧跟一个插值时是**乘号**（`RunConsole.vue` 的「×3 合并了 3 条相同行」、
  // IDEA 的 fold 徽标也是这个写法），属于文字不是图标 —— 其余位置一律换成 lucide 组件。
  const MULTIPLIER = new RegExp('×\\s*(?=\\{\\{)')
  const bad = []
  for (const [file, tpl] of TEMPLATES) {
    // 注释与行内代码是文档，不是渲染出来的字形
    const text = tpl.replace(/<!--[\s\S]*?-->/g, '').replace(/`[^`]*`/g, '')
    for (const { glyph } of FORBIDDEN_ICON_GLYPHS) {
      for (const [i, line] of text.split('\n').entries()) {
        if (!line.includes(glyph)) continue
        if (glyph === '×' && MULTIPLIER.test(line)) continue
        bad.push(`${rel(file)}:${i + 1} "${glyph}"`)
      }
    }
  }
  assert.deepEqual(bad, [], `这些字形要换成 lucide 组件：\n${bad.join('\n')}`)
})

test('纯图标按钮同时有 title 与 aria-label（鼠标提示和读屏名缺一不可）', () => {
  // 「纯图标」= 整棵子树里没有可见文字。注意插值 `{{ x }}` 也是文字（角色名、标题、文件名
  // 都靠它），而 `<svg>` / 组件节点不算 —— 之前只看直接子文本节点，把 120 个带插值的正常
  // 按钮全报了假阳性。
  const labelOf = node => {
    let text = ''
    walk(node, n => {
      if (n.type === NodeTypes.TEXT) text += n.content
      else if (n.type === NodeTypes.INTERPOLATION) text += n.content.content
    })
    return text.trim()
  }
  const has = (node, name) => node.props.some(p =>
    (p.type === NodeTypes.ATTRIBUTE && p.name === name) || (p.type === NodeTypes.DIRECTIVE && p.arg?.content === name))
  const bad = []
  for (const [file, tpl] of TEMPLATES) {
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    const offset = descriptorOffset(file)
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      if (labelOf(node)) return
      if (has(node, 'aria-hidden')) return // 隐藏代理按钮（表单提交替身），不面向用户
      const missing = ['title', 'aria-label'].filter(n => !has(node, n))
      if (missing.length) bad.push(`${rel(file)}:${node.loc.start.line + offset} 缺 ${missing.join(' + ')}`)
    })
  }
  assert.deepEqual(bad, [], `这些纯图标按钮看不出是干什么的：\n${bad.join('\n')}`)
})

test('定尺图标按钮必须 padding: 0（WebView2 的 UA 默认 button padding 会吃掉图标盒）', () => {
  // 踩过的坑：`.activity-button` 是 30px 定尺盒，UA 默认给 button `padding: 1px 6px`，
  // 内容盒只剩 18px，svg 又是 flex 项默认 flex-shrink: 1 —— 真机里图标渲染成 18×20 而不是
  // 20×20，作者样式里根本没写过 padding，纯粹是没人对过账。这条把「定尺按钮归零内边距」
  // 变成可检查的规则。
  // 从 AST 取，不用 `<button[^>]*class="..."` 那种正则：属性值里带 `>` 的按钮
  // （`@click="emit('move', 'left')"` 这种）会被 `[^>]*` 提前截断而整条漏掉 ——
  // 门禁"没报"和"没看见"分不开的时候，它就等于没有。
  const buttonClasses = new Set()
  for (const [file, tpl] of TEMPLATES) {
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      const raw = staticClassOf(node)
      if (!raw) return
      for (const c of raw.split(/\s+/)) if (c) buttonClasses.add(c)
    })
  }
  // 已经归零内边距的类（`.icon-button` 那种基类）由别处兜着，复合/后代选择器不算漏。
  const zeroed = new Set()
  for (const m of styleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/padding:\s*0[;\s]/.test(m[2])) continue
    for (const c of m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)) zeroed.add(c[1])
  }
  const bad = []
  for (const m of styleCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim(), body = m[2]
    if (/[ >]/.test(selector.replace(/\.[a-zA-Z][\w-]*/g, '')) || selector.includes(',')) continue
    const w = body.match(/(?<!max-|min-)width:\s*(\d+)px\s*;/)
    const h = body.match(/(?<!max-|min-)height:\s*(\d+)px\s*;/)
    if (!w || !h || w[1] !== h[1] || Number(w[1]) > 40) continue
    const className = selector.replace(/^\./, '')
    if (!buttonClasses.has(className) || zeroed.has(className)) continue
    bad.push(selector)
  }
  assert.deepEqual(bad, [], `这些定尺按钮没归零内边距，UA 默认 padding 会挤掉图标：${bad.join(' / ')}`)
})

test('定尺的 > svg 规则必须同时写 flex-shrink: 0（图标尺寸不能被兄弟节点挤掉）', () => {
  const bad = []
  for (const m of styleCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim(), body = m[2]
    if (!/>\s*svg\b/.test(selector)) continue
    if (!/(?<!max-|min-)width:\s*\d/.test(body)) continue
    if (/flex-shrink:\s*0/.test(body)) continue
    bad.push(selector)
  }
  assert.deepEqual(bad, [], `这些图标规则会被 flex 压扁：${bad.join(' / ')}`)
})

test('每个 .vue 的 SFC 结构完整：能解析、模板非空、模板与样式都能编译', () => {
  // 这一条是踩坑补的：批量改写模板时丢过一个 </template>，而 @vue/compiler-sfc 的
  // parse() 对游离在块外的内容是**静默吞掉**的 —— 不额外看 template.content 就查不出来。
  // 样式块同理：改写时吃掉一个 `/*` 会留下半句注释，parse() 一样放行，只有真编译才炸。
  const bad = []
  for (const file of FILES) {
    const { descriptor, errors } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    if (errors.length) { bad.push(`${rel(file)} parse: ${errors[0].message}`); continue }
    if (!descriptor.template?.content.trim()) { bad.push(`${rel(file)} 没有根 <template>`); continue }
    const compiled = compileTemplate({ source: descriptor.template.content, filename: file, id: 'gate' })
    if (compiled.errors.length) { bad.push(`${rel(file)} 模板编译: ${String(compiled.errors[0].message ?? compiled.errors[0])}`); continue }
    for (const style of descriptor.styles) {
      if (style.lang && style.lang !== 'css') continue
      // 必须带 scoped: true 走一遍 —— vite 的 plugin-vue 就是这么编译的，而普通
      // compileStyle 走的是宽松路径：半句悬空注释它会悄悄吞成一个空规则，只有
      // scoped 变换去读那个选择器时才报 "Expected a pseudo-class or pseudo-element"。
      const result = compileStyle({ source: style.content, filename: file, id: 'data-v-gate', scoped: style.scoped })
      const problems = result.errors.map(e => (typeof e === 'string' ? e : e.message))
      if (problems.length) bad.push(`${rel(file)} 样式编译: ${problems[0]}`)
    }
  }
  assert.deepEqual(bad, [], `SFC 结构被改坏了：\n${bad.join('\n')}`)
})

test('模板里没有混进来的 CSS 规则行（改写模板时最容易漏进来的东西）', () => {
  const bad = []
  for (const [file, tpl] of TEMPLATES) {
    for (const [i, line] of tpl.split('\n').entries()) {
      const s = line.trim()
      if (!s || s.startsWith('<!--')) continue
      // `选择器 { 声明 }` 一整行、且不含标签/插值的 —— 模板里不会出现这种东西
      if (/^[.#a-zA-Z\[][^{<>]*\{[^{}]*\}$/.test(s) && !/<|>/.test(s)) bad.push(`${rel(file)}:${i + 1} ${s.slice(0, 60)}`)
    }
  }
  assert.deepEqual(bad, [], `模板里混进了样式行：\n${bad.join('\n')}`)
})

test('写了 gap / justify-content 的类必须真的是 flex 容器（inline-block 上这两条整条失效）', () => {
  // 踩了两次的同一个坑：`.tool-menu-item`（style.css:318）和 `.status-widget-item`（:734）
  // 都只写了 `justify-content: flex-start; gap: ...` 而漏了 `display: flex` ——
  // `<button>` 的 UA 默认是 inline-block，那两条声明静默失效，图标和文字挤在一起、gap 是 0。
  // 判定按**类**而不是按规则：CSS 常把 display 和 gap 拆成两条写（`.settings-tab` 就是），
  // 要求同一条规则里成对出现会误报一大片。
  //
  // 但**拿哪几个类**去登记必须是"这条规则真正作用的那一个复合选择器"（`subject`）：
  // `.dropdown > .menu-item` 作用在 `.menu-item` 上，`.a .b { gap }` 作用在 `.b` 上 ——
  // **祖先不是主体**。原来只按 `>+~` 切、不按后代空格切，于是
  // `ModelMetadataSection.vue:186` 的 `.model-metadata .settings-fields .model-metadata-block { gap: … }`
  // 把 `.model-metadata`（外层 wrapper，只有 margin-top）也算成"写了 gap 的类"，
  // 报出一个不存在的缺陷（2026-10-08 lane visual-leftovers 实证：那个 gap 归 `.model-metadata-block`，
  // 而它总是与 `.input-row` 同元素出现、由 `.agent-settings-body .input-row` 给 `display: grid`）。
  // 只取最后一个复合选择器同时**收紧**另一个方向：祖先类不再被误记为 flex 容器。
  const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => ({ selector: m[1].trim(), body: m[2], subject: m[1].trim().split(/\s*[>+~]\s*/).pop().split(/\s+/).pop() }))
  const classesIn = subject => [...subject.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(c => c[1])
  /** 类 -> 该类是否声明过 flex 容器 / 是否声明过 gap|justify-content。 */
  const flexed = new Map(), gapped = new Map()
  const cssOf = file => file.endsWith('.css')
    ? readFileSync(file, 'utf8')
    : [...PARSED.get(file).styles].map(s => s.content).join('\n')
  for (const file of [new URL('../src/style.css', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...FILES]) {
    for (const r of rules(cssOf(file))) {
      for (const c of classesIn(r.subject)) {
        if (/display:\s*(?:flex|inline-flex|grid|inline-grid)/.test(r.body)) flexed.set(c, true)
        if (/(?<![\w-])gap:\s*var\(--space-/.test(r.body) || /justify-content:\s*(?!normal|inherit)/.test(r.body)) gapped.set(c, true)
      }
    }
  }
  // 按**元素**判，而不是按类判：`.todo-row`（TodoPanel.vue:249）与 `.debug-row-editing`
  // （DebugPanel.vue:735）自己只补了几条修饰，容器是同元素上的基类 `.todo-node`/`.debug-row`
  // 给的 —— CSS 就是这么叠加的，门禁也得按这个口径。
  const bad = []
  for (const [file, tpl] of TEMPLATES) {
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    const offset = descriptorOffset(file)
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT) return
      const raw = staticClassOf(node)
      if (!raw) return // 纯 `:class` 绑定拿不到字面量，跳过（宁可漏报也不误报）
      const classes = raw.split(/\s+/).filter(Boolean)
      if (!classes.some(c => gapped.get(c))) return
      if (classes.some(c => flexed.get(c))) return
      bad.push(`${rel(file)}:${node.loc.start.line + offset} .${raw}`)
    })
  }
  assert.deepEqual(bad, [], `这些元素写了 gap / justify-content 却没有 display: flex，声明是空操作：\n${bad.join('\n')}`)
})

test('动效时长一律走 --dur-* 令牌（唯独 prefers-reduced-motion 里的 0.001ms 是无障碍覆盖）', () => {
  const bad = []
  for (const file of [...FILES, new URL('../src/style.css', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]) {
    const raw = readFileSync(file, 'utf8')
    const text = file.endsWith('.css') ? raw : raw.slice(raw.indexOf('<style'))
    for (const [i, line] of text.split('\n').entries()) {
      if (!/(?:^|[\s;{])(transition|animation)(?:-[a-z]+)?\s*:/.test(line)) continue
      if (/var\(--dur-/.test(line)) continue
      if (/prefers-reduced-motion|0\.001ms/.test(line)) continue
      if (!/\b\d*\.?\d+m?s\b/.test(line)) continue
      bad.push(`${rel(file)}:${i + 1} ${line.trim().slice(0, 70)}`)
    }
  }
  assert.deepEqual(bad, [], `这些动效时长是裸数字：\n${bad.join('\n')}`)
})

test('描边宽度统一（ICON_STROKE 是全仓 lucide 图标唯一的笔画值）', () => {
  const bad = []
  for (const file of FILES) {
    const raw = readFileSync(file, 'utf8')
    for (const [i, line] of raw.split('\n').entries()) {
      if (!/stroke-width\s*:/.test(line)) continue
      if (line.includes('var(--dur-')) continue
      // VcsLogTable 的连线图（1.5）是示意图不是图标，单独放行
      if (file.includes('VcsLogTable')) continue
      const value = line.match(/stroke-width\s*:\s*([\d.]+)/)?.[1]
      if (value !== undefined && Number(value) !== ICON_STROKE) bad.push(`${rel(file)}:${i + 1} stroke-width: ${value}`)
    }
  }
  assert.deepEqual(bad, [], `这些描边宽度和图标族不一致：\n${bad.join('\n')}`)
})

test('带图标槽的菜单行必须 text-align: left（button 的 UA 默认是 center）', () => {
  // 踩过的坑：标题 span 是 `flex: 1`（style.css:128），撑满整行剩下的宽度；而 `<button>` 的
  // UA 默认 `text-align: center` —— 槽和文字盒的**左沿**是对齐的，字形却在盒子里居中，
  // 真机上一排菜单行看上去是「每条各自居中」而不是左对齐的列表。只量
  // `getBoundingClientRect().left` 看不出来，只有截图能看出来，所以这条按类名静态钉死。
  //
  // 判定按**整个 class 列表**而不是单个类：行基类（`.menu-item` 由 `.dropdown > .menu-item`
  // 带、`tool-menu-item` 自己带）已经把整行对上了，修饰类（`is-child`）不必重复声明。
  // 全仓其它行族（`.dropdown > .menu-item`:94、`.project-widget-row`:172、`.filename-row`:222、
  // `.stripe-popup-row`:272、`.tree-menu > button`:1010、`.settings-tab`、`.navigation-item`）
  // 一律显式写了这一条，这里把它变成"忘了就红"。
  const rowButtons = []
  for (const [file, tpl] of TEMPLATES) {
    let ast
    try { ast = parseDom(tpl) } catch { continue }
    const offset = descriptorOffset(file)
    walk(ast, node => {
      if (node.type !== NodeTypes.ELEMENT || node.tag !== 'button') return
      const raw = staticClassOf(node)
      if (!raw) return
      // 子树里带槽（`.menu-item-icon` / `.menu-item-title`）才算"图标 + 文字同排"的行
      let slotted = false
      walk(node, n => {
        if (n.type !== NodeTypes.ELEMENT) return
        const c = staticClassOf(n)
        if (c && /\bmenu-item-(?:icon|title)\b/.test(c)) slotted = true
      })
      if (!slotted) return
      rowButtons.push([file, node.loc.start.line + offset, raw, raw.split(/\s+/)])
    })
  }
  assert.ok(rowButtons.length > 0, '没匹配到任何带图标槽的菜单行 —— 门禁本身失效了')
  // 全局表（style.css）：条件在祖先上的规则算数 —— `.dropdown > .menu-item` 确实对上了
  // `.menu-item`，`.tool-menu-item` 自己带也算。
  const leftAligned = new Set()
  const collectGlobal = css => {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/text-align:\s*(?:left|start)\s*;/.test(m[2])) continue
      const subject = m[1].trim().split(/\s*[>+~]\s*/).pop() // 最后一个复合选择器才是主体
      for (const c of subject.matchAll(/\.([a-zA-Z][\w-]*)/g)) leftAligned.add(c[1])
    }
  }
  collectGlobal(styleCss)
  // `<style scoped>` 只认**单类**选择器：`.log-menu .menu-button`（VcsLog.vue:213）离开
  // `.log-menu` 就不成立，拿它去给全局的 `.menu-button` 盖章会让这条门禁永远绿 ——
  // 第一次写这条时就正是被它遮住的。
  for (const d of PARSED.values()) {
    for (const style of d.styles ?? []) {
      for (const m of style.content.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/text-align:\s*(?:left|start)\s*;/.test(m[2])) continue
        if (!/^\.[a-zA-Z][\w-]*$/.test(m[1].trim())) continue
        leftAligned.add(m[1].trim().slice(1))
      }
    }
  }
  const bad = rowButtons.filter(([, , , classes]) => !classes.some(c => leftAligned.has(c)))
    .map(([file, line, raw]) => `${rel(file)}:${line} .${raw}`)
  assert.deepEqual(bad, [], `这些菜单行带图标槽却没写 text-align: left，字会在标题盒里居中：\n${bad.join('\n')}`)
})

/**
 * 「图标宿主」= 自身就是一个定尺图标按钮的 class。它们的 svg **一定**被 CSS 的
 * `> svg` 规则捞到（`style.css` 的 `.topbar .header-widget > svg` / `.topbar .icon-button > svg` /
 * `.activity-button > svg`），所以尺寸必须由模板的 `:size` 说出来 —— 少写一个就等于
 * 把决定权交给 CSS 那个 20px 的兜底值。
 *
 * 这一族过去长期没人管，是因为前 16 条门禁只看「写没写 `:size`」，不看**写的是不是
 * 声明的那一档**：`MainToolbar.vue` 的运行仪表盘写着 `:size="iconSize.menu"`(13)、
 * 搜索/设置写着 `:size="iconSize.action"`(16)，CSS 实际渲染 20px —— 源码在骗人。
 */
const ICON_HOST_CLASSES = ['icon-button', 'menu-button', 'header-widget', 'activity-button']

/** 一个文件里从 `lucide-vue-next` 导入的图标名（可能有**多条** import，`BookmarksPanel.vue` 就有两条）。 */
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

/** `:size` 的写法：`:iconSize.menu`（指令）或 `="13"`（静态属性）；没有就 null。 */
function sizeBindingOf(node) {
  for (const p of node.props ?? []) {
    if (p.type === NodeTypes.DIRECTIVE && p.arg?.content === 'size') return { bound: true, value: p.exp?.content ?? '' }
    if (p.type === NodeTypes.ATTRIBUTE && p.name === 'size') return { bound: true, value: p.value?.content ?? '', static: true }
  }
  return { bound: false, value: '' }
}

/** 宿主按钮的**直接子**图标组件（大写标签 = 组件、`<svg>`、`<component :is>`）。 */
function iconChildrenInHosts(file) {
  const tpl = TEMPLATES.get(file)
  if (!tpl) return []
  let ast
  try { ast = parseDom(tpl) } catch { return [] }
  const lucide = lucideImportsOf(file)
  const out = []
  walk(ast, node => {
    if (node.type !== NodeTypes.ELEMENT) return
    const host = staticClassOf(node)?.split(/\s+/).find(c => ICON_HOST_CLASSES.includes(c))
    if (!host) return
    for (const child of node.children ?? []) {
      if (child.type !== NodeTypes.ELEMENT) continue
      if (child.tag !== 'svg' && child.tag !== 'component' && !lucide.has(child.tag)) continue
      out.push({ host, tag: child.tag, line: child.loc.start.line + descriptorOffset(file), node: child })
    }
  })
  return out
}

test('图标宿主按钮里的每个图标都显式声明 :size（不许让 CSS 替它决定尺寸）', () => {
  // 少了 `:size`，lucide 就退回自己的默认 24（`Icon.js` 的 `width: size || 24`），而 CSS 的
  // 兜底只对 `:not(.lucide)` 生效 —— 也就是图标会**真的**变成 24px 而不是 20px。
  // 所以"没写"不是风格问题，是一次肉眼可见的尺寸回归。
  const all = FILES.flatMap(file => iconChildrenInHosts(file).map(icon => ({ ...icon, file })))
  assert.ok(all.length > 0, '没匹配到任何图标宿主里的图标 —— 门禁本身失效了')
  const bad = all.filter(({ node }) => !sizeBindingOf(node).bound)
    .map(({ file, line, tag, host }) => `${rel(file)}:${line} <${tag}> 在 .${host} 里没有 :size`)
  assert.deepEqual(bad, [], `这些图标没声明 :size，尺寸只能听 CSS 的（lucide 默认 24px）：\n${bad.join('\n')}`)
})

test('图标宿主的 :size 必须来自 iconSize 阶梯（不许写字面量或别的表达式）', () => {
  // 与上面那条配套：声明了不等于声明对了。`:size="13"` 是字面量（几何散成第二处真源），
  // `:size="iconSize.chekbox"` 这种拼错的角色名会渲染成 `undefined` → 退回 24。
  const bad = []
  for (const file of FILES) {
    for (const { tag, line, host, node } of iconChildrenInHosts(file)) {
      const { bound, value, static: isStatic } = sizeBindingOf(node)
      if (!bound) continue
      const m = /^iconSize\.(\w+)$/.exec(value)
      if (!isStatic && m && Object.hasOwn(ICON_SIZE, m[1])) continue
      bad.push(`${rel(file)}:${line} <${tag}> 在 .${host} 里 :size="${value}"`)
    }
  }
  assert.deepEqual(bad, [], `这些 :size 不是 iconSize 阶梯上的一档：\n${bad.join('\n')}`)
})

test('CSS 的 `> svg` 宽度规则只兜底非 lucide 图标（不许覆盖模板声明的 :size）', () => {
  // 组 A 那几处「源码在骗人」的**根因**，也是唯一能防它复发的判据。
  // lucide 把 `:size` 渲染成 svg 的 `width`/`height` **属性**
  // （`node_modules/lucide-vue-next/dist/esm/Icon.js`：`width: size || defaultAttributes.width`），
  // 而 CSS 的 `width` **永远赢过**呈现属性 —— 所以 `.topbar .header-widget > svg { width: … }`
  // 会把这一族模板里所有的 `:size` 一律改写成 20px。
  // 豁免写法是 `:not(.lucide)`：`.lucide` 类同样出自那个文件（`class: ["lucide", "lucide-<kebab>"]`），
  // 于是这条规则只对**手写的** `<svg>` 兜底。作用域：全局表 + 各组件的 `<style>` 块。
  const sheets = [
    ['src/style.css', styleCss],
    ...[...PARSED].map(([file, d]) => [rel(file), d.styles.map(s => s.content).join('\n')]),
  ]
  const bad = []
  for (const [file, css] of sheets) {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // `(?<![\w-])` 是必须的：`stroke-width: 2` 里也含 `width:`，用 `(?<!max-|min-)` 会把它算进来。
      if (!/(?<![\w-])width:\s*[^;]/.test(m[2])) continue
      for (const part of m[1].split(',')) {
        const selector = part.trim()
        if (!/>\s*svg\b/.test(selector)) continue
        if (selector.includes(':not(.lucide)')) continue
        bad.push(`${file}  ${selector}`)
      }
    }
  }
  assert.deepEqual(bad, [], `这些规则会用 CSS 的 width 覆盖模板里的 :size：\n${bad.join('\n')}`)
})
