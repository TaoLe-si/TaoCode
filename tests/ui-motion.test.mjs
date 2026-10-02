// 动效门禁。守的不是一个"好不好看"，而是**动效的数值只有一处真源**（src/tokens.css）
// 以及三个"不写下来就会悄悄劣化"的行为。
//
// 为什么单独一份而不是并进 ui-icons：两者判的是不同的东西 —— 图标门禁管几何（尺寸/描边/
// 字形），这里管**时间**（时长/缓动/降级/循环）。第八十五批的审计结论是：仓库里 CSS 侧
// 基本干净，但三处漏在别处 —— ① App.vue 里 motion-v 收不到 var()，手抄了 0.1/0.16 和缓动
// 四元组；② DebugPanel 有一条裸 `ease-in-out`；③ 省电模式用 `animation-duration:.001ms`
// 去停 `infinite` 循环，转圈变成每秒几千帧的频闪。前两条本门禁直接挡住，第三条是"停"这件事
// 本身要判对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseDom } from '@vue/compiler-dom'

const srcDir = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const tokensRaw = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8')
// tokens.css 里有一段注释**故意**写着 `--dur-3: 220ms`（说明为什么砍掉第三档），正则会把它
// 当成真声明收进来。判据只看声明，所以先剥注释再解析 —— 这是第一次写这道门禁就踩的坑。
const tokens = tokensRaw.replace(/\/\*[\s\S]*?\*\//g, '')
const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

function allSourceFiles(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) allSourceFiles(p, out)
    else if (/\.(css|vue|ts)$/.test(name)) out.push(p)
  }
  return out
}
const rel = file => file.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/')
const FILES = allSourceFiles()
const read = file => readFileSync(file, 'utf8')
/** 文件里第 n 行（1 起）。 */
const lineOf = (file, needle) => {
  const lines = read(file).split('\n')
  const i = lines.findIndex(l => l.includes(needle))
  assert.notEqual(i, -1, `${rel(file)} 里找不到 ${JSON.stringify(needle)}`)
  return i + 1
}
const at = needle => {
  const hits = []
  for (const file of FILES) read(file).split('\n').forEach((l, i) => { if (l.includes(needle)) hits.push(`${rel(file)}:${i + 1}`) })
  return hits
}

/** 把一个文件里所有 CSS 声明体抠出来（够门禁用，不追求完整解析）。 */
function cssBodies(source) {
  const out = []
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], line: source.slice(0, m.index).split('\n').length })
  return out
}

/** 模板里的元素节点（门禁只关心标签名和静态 class）。 */
function templateNodes(template) {
  if (!template) return []
  const out = []
  const visit = node => {
    if (node.type === 1) out.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  // parseDom 的返回值是根节点，元素是它的 children —— 只往下走一层会把根自己漏掉。
  visit(parseDom(template, { comments: false }))
  return out
}

/** 静态 class 属性的字面量值；`:class` 这类绑定的值读不出来，返回空数组（宁可漏报不误报）。 */
function literalClass(value) {
  // 注意别拿 value.type 当判据：@vue/compiler-dom 里 **属性** 的 type 是 6（ATTRIBUTE），
  // **属性值** 的 type 是 2（TEXT）。第一版写成 `value.type !== 6` —— 于是每个静态 class
  // 都被当成"读不出来"跳过，按钮集合恒为空，那道门禁把 26 个 <button> 全报成了缺陷。
  if (!value || typeof value.content !== 'string') return []
  const content = value.content
  // 含插值（`{{ }}`）的 class 读不出静态部分，直接放弃 —— 半读出来比不读更危险。
  if (content.includes('{{') || content.includes('}')) return []
  return content.split(/\s+/).filter(Boolean)
}

test('动效时长只有五档，且都在 tokens.css 里', () => {
  const declared = [...tokens.matchAll(/(--dur-[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()])
  const names = declared.map(([n]) => n).sort()
  assert.deepEqual(names, ['--dur-1', '--dur-2', '--dur-spin', '--dur-submenu', '--dur-theme-reveal'])
  for (const [name, value] of declared) {
    assert.match(value, /^\d+(\.\d+)?(ms|s)$/, `${name} 的值 ${value} 不是合法时长`)
  }
  // --dur-1 反馈、--dur-2 状态切换：两档必须有严格大小关系，否则"离场比进场快"那条约定会倒过来。
  const ms = v => (v.endsWith('ms') ? Number.parseFloat(v) : Number.parseFloat(v) * 1000)
  const byName = Object.fromEntries(declared)
  assert.ok(ms(byName['--dur-1']) < ms(byName['--dur-2']), '--dur-1 必须短于 --dur-2（离场快一档，见 motionTokens.ts）')
})

test('匀速档单列一档，循环动效才有恒定角速度', () => {
  assert.match(tokens, /--ease-linear:\s*linear;/, 'tokens.css 必须有 --ease-linear 档')
  // 拿 --ease 去驱动**转圈**是错的：cubic-bezier(.16,1,.3,1) 首段极慢，转起来是"顿一下再转"。
  // 判据只覆盖纯旋转 —— DebugPanel 那条 indeterminate 进度条是来回**扫掠**，匀速才对，
  // 所以不能按"凡是 infinite 就要 --ease-linear"一刀切（第一版就是这么一刀切的，
  // 结果把那条扫掠也报成缺陷）。
  const rotations = new Set()
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const m of read(file).matchAll(/@keyframes\s+([\w-]+)\s*\{([^}]*)\}/g)) {
      if (/rotate\(/.test(m[2])) rotations.add(m[1])
    }
  }
  assert.ok(rotations.size > 0, '至少要找到一个旋转 keyframes，否则这道门禁是空的')
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const { body, line } of cssBodies(read(file))) {
      for (const decl of body.split(';')) {
        if (!/^\s*animation\s*:/.test(decl.trim())) continue
        const name = /^\s*animation\s*:\s*([\w-]+)/.exec(decl)?.[1]
        if (!name || !rotations.has(name)) continue
        assert.match(decl, /var\(--ease-linear\)/, `${rel(file)}:${line} 的转圈 ${name} 用了非匀速缓动：${decl.trim().slice(0, 100)}`)
      }
    }
  }
})

test('CSS 里不出现裸时长：每处 transition/animation 的时长都走 var(--dur-*)', () => {
  const offenders = []
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const { body, line } of cssBodies(read(file))) {
      for (const decl of body.split(';')) {
        if (!/^\s*(transition|animation)\b/.test(decl.trim())) continue
        // 只有 shorthand 里带显式时长的才算；`transition: none` / `transition: background-color x`
        // 这类没有时长的不查（前者是降级，后者靠别处的 token）。
        const value = decl.slice(decl.indexOf(':') + 1)
        for (const m of value.matchAll(/(\d*\.?\d+)(ms|s)(?![a-z-])/gi)) {
          if (decl.includes('var(--dur')) continue
          offenders.push(`${rel(file)}:${line}  ${decl.trim().slice(0, 110)}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `这些 transition/animation 写死了时长：\n${offenders.join('\n')}`)
})

test('不出现裸缓动关键字（cubic-bezier 一律走 var(--ease) / var(--ease-linear)）', () => {
  // `linear` 只允许出现在 --dur-spin 的循环上，而那条已经由上一条门禁锁住必须用 --ease-linear。
  const offenders = []
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const { body, line } of cssBodies(read(file))) {
      for (const decl of body.split(';')) {
        if (!/^\s*(transition|animation)\b/.test(decl.trim())) continue
        const value = decl.slice(decl.indexOf(':') + 1)
        if (/var\(--ease/.test(value)) continue
        if (/\b(ease-in-out|ease-in|ease-out|cubic-bezier)\b/.test(value)) {
          offenders.push(`${rel(file)}:${line}  ${decl.trim().slice(0, 110)}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `这些 transition/animation 写死了缓动：\n${offenders.join('\n')}`)
})

test('不用 transition: all（它会把布局属性也一起动画掉）', () => {
  const offenders = []
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const { body, line } of cssBodies(read(file))) {
      for (const decl of body.split(';')) {
        if (/^\s*(transition|transition-property)\s*:/.test(decl) && /(^|[\s,])all([\s,;]|$)/.test(decl.slice(decl.indexOf(':') + 1))) {
          offenders.push(`${rel(file)}:${line}  ${decl.trim().slice(0, 110)}`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `这些地方用了 transition: all：\n${offenders.join('\n')}`)
})

test('省电模式把动画**停掉**，而不是把周期压到 1 微秒', () => {
  // 这条是第八十五批修掉的真缺陷：原来的 `animation-duration: .001ms` 对**单次**动效等价于
  // 瞬时，但仓库里有三个 `infinite` 转圈，周期压到 1 微秒等于每秒几千帧地闪 —— 比转着还晃，
  // 省电反而更费眼。判据是：这条规则里不许出现 .001ms 之类的时长压扁写法。
  const line = lineOf(new URL('../src/style.css', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), "data-motion='reduced'] *,")
  const rule = cssBodies(styleCss).find(r => r.selector.includes("data-motion='reduced']") && r.selector.includes('*'))
  assert.ok(rule, 'style.css 里必须有 data-motion=reduced 的全局降级规则')
  assert.doesNotMatch(rule.body, /animation-duration:\s*0?\.\d+ms/, `style.css:${rule.line} 的降级规则仍在压扁时长`)
  assert.match(rule.body, /animation:\s*none/, `style.css:${rule.line} 的降级规则必须是 animation: none（停下来）`)
  // 停下来之后每个 infinite 转圈都要有静态替身，否则一个静止的完整圆环读作"卡住"而不是"暂停"。
  for (const cls of ['status-spin', 'gradle-spin', 'plugin-spin']) {
    const fallback = cssBodies(styleCss).find(r => r.selector.includes("data-motion='reduced']") && r.selector.includes(`.${cls}`))
    assert.ok(fallback, `.${cls} 是 infinite 循环，data-motion='reduced' 下必须有静态替身`)
    assert.match(fallback.body, /opacity/, `.${cls} 的静态替身要降不透明度（上游 JBAnimator 暂停时也是变淡的）`)
  }
  assert.ok(line > 0)
})

test('prefers-reduced-motion 的全局降级存在', () => {
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/, 'tokens.css 末尾要有全局降级块')
  const block = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /transition:\s*none\s*!important/)
  assert.match(block, /animation:\s*none\s*!important/)
})

test('每个 @keyframes 要么被引用、要么被删；引用的必须存在', () => {
  const defined = new Map()
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const m of read(file).matchAll(/@keyframes\s+([\w-]+)/g)) defined.set(m[1], rel(file))
  }
  const used = new Set()
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    for (const { body } of cssBodies(read(file))) {
      for (const decl of body.split(';')) {
        if (!/^\s*animation(-name)?\s*:/.test(decl.trim())) continue
        for (const m of decl.matchAll(/([\w-]+)\s+(?:var\(--dur|[-\d.]+(?:ms|s))/g)) used.add(m[1])
      }
    }
  }
  const orphans = [...defined].filter(([name]) => !used.has(name) && name !== 'tc-spin' && name !== 'debug-progress-slide')
  // 留两个具名例外的理由写在这儿，免得下一个人以为是漏网：tc-spin 是三个转圈共用的那一份
  // （Gradle/Plugin 的 scoped 样式按名字引用它，扫描器看不到跨文件的 animation 简写），
  // debug-progress-slide 同理。
  assert.deepEqual(orphans, [], `这些 @keyframes 没有任何地方引用：${orphans.map(([n, f]) => `${n} (${f})`).join(', ')}`)
  const referenced = [...used].filter(n => !defined.has(n))
  assert.deepEqual(referenced, [], `这些 animation 引用了未定义的 @keyframes：${referenced.join(', ')}`)
})

test('interactive 的 :hover 改了背景/颜色/透明度就必须有 transition', () => {
  // **排除 `<button>`**：`src/style.css:38` 的全局 `button` 规则已经给每个 <button> 挂了
  // transition，所以按钮类不算缺陷。哪些类是按钮，得从**模板**里查 —— 光看类名会误判：
  // 第一版用 `selector.includes('button')` 过滤，结果 39 条里 32 条是 `<button>`（.debug-btn、
  // .fs-toggle、.settings-tab…），噪声把真缺陷淹了。现在用 @vue/compiler-sfc 解析模板、
  // 收集 `<button>` 上真实出现过的 class，再按集合排除。
  const buttonClasses = new Set()
  for (const file of FILES) {
    if (!file.endsWith('.vue')) continue
    const { descriptor, errors } = parseSfc(read(file), { filename: file })
    assert.equal(errors.length, 0, `${rel(file)} 解析失败：${errors[0]?.message}`)
    for (const node of templateNodes(descriptor.template?.content ?? '')) {
      if (node.tag !== 'button') continue
      for (const value of node.props.filter(p => p.name === 'class').flatMap(p => literalClass(p.value))) {
        for (const cls of value.split(/\s+/).filter(Boolean)) buttonClasses.add(cls)
      }
    }
  }
  const offenders = []
  for (const file of FILES) {
    if (!/\.(css|vue)$/.test(file)) continue
    const rules = cssBodies(read(file))
    for (const { selector, body, line } of rules) {
      if (!selector.includes(':hover')) continue
      if (!/\b(background|background-color|color|opacity|border-color)\s*:/.test(body)) continue
      for (const part of selector.split(',')) {
        // 只看**真的带 :hover 的那几片**。`.a:hover .b, .a:focus-visible .b` 这种写法里，
        // 后两片没有 :hover，按 ':hover' 切一刀会切不出东西、base 退化成 `.a` ——
        // 于是判成「.a 缺 transition」，而 .a 根本不是被 hover 的元素。
        if (!part.includes(':hover')) continue
        const after = part.split(':hover')[1] ?? ''
        // 注意判的是**未 trim 的** after：`.a:hover .b` 里 after 是 `" .b"`，那个前导空格
        // 才是"后代选择器"的信号；trim 掉再判就看不出后面还挂着一个元素了（第一版就死在这）。
        if (/\s/.test(after)) continue
        const base = part.split(':hover')[0].trim()
        // 后代选择器（`.a:hover .b`）的"底规则"是 `.b` 而不是 `.a` —— 判据要的是被 hover 的那个
        // 元素自己的 transition。第一版按 ':hover' 切一刀，把 `.recent-row:hover .row-menu-button`
        // 算成了「.recent-row 没有 transition」，而 .row-menu-button 本来就有（style.css:744）。
        if (!base || base.startsWith('@') || /\s/.test(base)) continue // 组合/伪类选择器跳过，宁可漏报不误报
        if (base.startsWith('.')) {
          const cls = base.slice(1).replace(/\[[^\]]*\]/g, '')
          // 复合类（`.a.b`）按**逐个类**判：`.settings-search-icon.has-history` 只要有一个类
          // 是 <button> 就说明全局 button 规则覆盖了它。
          if (cls.split('.').every(c => buttonClasses.has(c))) continue
        }
        const baseRule = rules.find(r => r.selector === base)
        if (!baseRule) continue
        if (!/transition\s*:/.test(baseRule.body)) offenders.push(`${rel(file)}:${line}  ${selector}（底规则 ${base}）`)
      }
    }
  }
  assert.deepEqual(offenders, [], `这些 :hover 改了可见属性但底规则没有 transition：\n${offenders.join('\n')}`)
})

test('motion-v 的时长与缓动从令牌读，不再手抄字面量', () => {
  const motionTokens = read(new URL('../src/motionTokens.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  // 令牌模块自己可以写 fallback 常量（取不到 CSSOM 时用），但 App.vue 这类**消费方**不行。
  const consumers = FILES.filter(f => f.endsWith('.vue') || (f.endsWith('.ts') && !f.endsWith('motionTokens.ts')))
  const offenders = []
  for (const file of consumers) {
    read(file).split('\n').forEach((l, i) => {
      if (!/duration\s*:/.test(l)) return
      if (/motionDurations\.|reducedMotion/.test(l)) return
      const m = /duration\s*:\s*([^,}]+)/.exec(l)
      if (m && /^\s*[\d.]+\s*$/.test(m[1])) offenders.push(`${rel(file)}:${i + 1}  ${l.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(offenders, [], `这些 motion-v 时长是手抄的：\n${offenders.join('\n')}`)
  assert.match(motionTokens, /--dur-2/, 'motionTokens.ts 必须真的从令牌读')
})

test('motionTokens.ts 的 fallback 常量与 tokens.css 一致（没有 CSSOM 时靠它）', () => {
  // 两份数值手抄在两个文件里，天然会漂。这里把 tokens.css 当真源，fallback 当影子核对。
  const shadow = new Map([...read(new URL('../src/motionTokens.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    .matchAll(/'(--dur-[\w-]+)':\s*(\d+)/g)].map(m => [m[1], Number(m[2])]))
  assert.ok(shadow.size >= 5, 'fallback 表至少要覆盖五档时长')
  for (const [name, value] of shadow) {
    const m = new RegExp(`${name}:\\s*([\\d.]+)(ms|s)`).exec(tokens)
    assert.ok(m, `tokens.css 里没有 ${name}`)
    const real = m[2] === 'ms' ? Number(m[1]) : Number(m[1]) * 1000
    assert.equal(real, value, `${name}: motionTokens.ts 的 fallback 是 ${value}ms，tokens.css 是 ${real}ms`)
  }
})
