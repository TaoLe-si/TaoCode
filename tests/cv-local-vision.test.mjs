// Code Vision 本地提供者的**抓取层**（`src/cvLocalVision.ts`）在这里被直接驱动：
// 假 `lsp.request` 记录每一趟往返，断言的是"问了什么、几趟、什么进条目、什么被丢掉"。
//
// 每条判据都对着上游那一行的语义，不是对着本仓的实现形状：
//   · 「0 个用法」这一支证明声明点不计数 —— `usages.telescope={0,choice, 0#0 个用法|…}`
//     （java/openapi/resources/messages/JavaBundle.properties:1805，中文包同键 `0#0 个用法`）；
//   · 「0 个继承者不画」—— java/java-impl/src/com/intellij/codeInsight/daemon/impl/JavaInheritorsCodeVisionProvider.kt:37,43；
//   · 「入口点不画」—— 同目录 JavaReferencesCodeVisionProvider.kt:25；
//   · 「usages 排在 inheritors 前」—— 同文件 :33-34 的 CodeVisionRelativeOrderingBefore("java.inheritors")；
//   · 计数阈值出厂 0（0 也显示）—— java/java-backend/resources/META-INF/JavaPlugin.xml:227。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createCodeVisionLocalChannel,
  inheritorAnchorSymbols,
  languageOfPath,
  toVisionSymbols,
  usageAnchorSymbols,
  usageCountOf,
  VISION_COUNT_MAX_SYMBOLS,
} from '../src/cvLocalVision.ts'
import {
  CODE_VISION_SHOW_INHERITORS,
  CODE_VISION_SHOW_USAGES,
  createCodeVisionRegistry,
  inheritorsHintText,
  localCodeVisionAction,
  usagesHintText,
  usagesVisionProvider,
  inheritorsVisionProvider,
} from '../src/codeVisionProviders.ts'

// 本文件是纯 JS（`package.json` 的 test 脚本不带 `--experimental-strip-types`）。

const CLASS = { name: 'Alpha', kind: 5, startLine: 0, startChar: 10, endLine: 20, endChar: 1 }
const METHOD = { name: 'run', kind: 6, startLine: 3, startChar: 16, endLine: 6, endChar: 5 }
const FIELD = { name: 'count', kind: 8, startLine: 1, startChar: 14, endLine: 1, endChar: 19 }
const MAIN = { name: 'main', kind: 6, startLine: 8, startChar: 22, endLine: 12, endChar: 5 }
const IFACE = { name: 'Beta', kind: 11, startLine: 22, startChar: 17, endLine: 24, endChar: 1 }
const OUTLINE = [CLASS, METHOD, FIELD, MAIN, IFACE]

/** 假语言服务：按 kind 分发，并把每一趟往返原样记下来。 */
function server(options = {}) {
  const calls = []
  const request = async (method, params) => {
    calls.push({ method, params })
    const kind = params.kind
    if (kind === 'documentSymbol') return options.outline ?? { available: true, symbols: OUTLINE }
    if (kind === 'references') return options.references ? options.references(params) : ownDeclarationOnly(params)
    if (kind === 'prepareTypeHierarchy') return options.prepare ? options.prepare(params) : { available: true, items: [{ name: params.path }] }
    if (kind === 'typeHierarchySubtypes') return options.subtypes ? options.subtypes(params) : { available: false }
    return { available: false }
  }
  request.calls = calls
  return request
}

/** 只回声明点自己那一条（`includeDeclaration: true` 的最小回包）⇒ 用法数 0。 */
const ownDeclarationOnly = params => ({
  available: true,
  refs: [{ path: params.path, line: params.line, character: params.character }],
})

const kinds = request => request.calls.map(call => call.params.kind)
const countOfKind = (request, kind) => request.calls.filter(call => call.params.kind === kind).length

test('一轮抓取 = 一次 documentSymbol + 每个锚点一次 references，条目里是「N 个用法」', async () => {
  const request = server({ references: () => ({ available: true, refs: [{ path: 'src/Other.java', line: 4, character: 2 }] }) })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  assert.equal(countOfKind(request, 'documentSymbol'), 1)
  // 锚点：类/方法/字段/接口四个（`main` 是入口点，上游不画 ⇒ 连问都不问）。
  assert.equal(countOfKind(request, 'references'), 4)
  assert.equal(request.calls.some(call => call.params.line === MAIN.startLine), false, '入口点不该被问')
  const titles = channel.entries().map(entry => entry.title)
  assert.deepEqual(titles, ['1 个用法', '1 个用法', '1 个用法', '1 个用法'])
  // 行的先后由合流那一层统一排（`mergeCodeVisionEntries` 按行升序、同行保持本地在前）；
  // provider 这一层只按符号表顺序产条目，自己不排序。
  assert.deepEqual(channel.entries().map(entry => entry.line), [0, 3, 1, 22])
})

test('声明点自己不算用法：只有声明时是「0 个用法」而不是「1 个用法」', async () => {
  const request = server()   // references 默认只回声明点那一条
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  assert.deepEqual(channel.entries().map(entry => entry.title), ['0 个用法', '0 个用法', '0 个用法', '0 个用法'])
})

test('问不到的符号一条都不画（不填 0），其余照常', async () => {
  const request = server({
    references: params => {
      if (params.line === METHOD.startLine) throw new Error('Language server is not running')
      return { available: true, refs: [{ path: 'src/Other.java', line: 9, character: 1 }] }
    },
  })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  assert.deepEqual(channel.entries().map(entry => entry.line), [0, 1, 22], '失败那一趟只丢它自己那条')
})

test('服务端没有 documentSymbol 能力时一条不问、一条不画', async () => {
  const request = server({ outline: { available: false } })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  assert.deepEqual(channel.entries(), [])
  assert.equal(countOfKind(request, 'references'), 0)
})

test('继承者：0 个不画，>0 才画；接口用「个实现」，类用「个继承者」', async () => {
  const request = server({
    subtypes: params => ({ available: params.line === CLASS.startLine || params.line === IFACE.startLine, items: params.line === CLASS.startLine ? [{ name: 'A' }, { name: 'B' }] : [{ name: 'X' }] }),
  })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  const vision = channel.entries()
  const inheritorTitles = vision.filter(entry => entry.command === CODE_VISION_SHOW_INHERITORS).map(entry => entry.title)
  assert.deepEqual(inheritorTitles, ['2 个继承者', '1 个实现'])
  // 两跳：每个类/接口各一次 prepare + 一次 subtypes，字段/方法不参与。
  assert.equal(countOfKind(request, 'prepareTypeHierarchy'), 2)
  assert.equal(countOfKind(request, 'typeHierarchySubtypes'), 2)
  assert.equal(inheritorAnchorSymbols(toVisionSymbols(OUTLINE), 8).length, 2)
})

test('同一行的用法排在继承者前面（上游的 relativeOrderings：usages before inheritors）', async () => {
  const request = server({
    references: () => ({ available: true, refs: [{ path: 'src/Other.java', line: 9, character: 1 }] }),
    subtypes: () => ({ available: true, items: [{ name: 'A' }] }),
  })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  const onClassLine = channel.entries().filter(entry => entry.line === CLASS.startLine).map(entry => entry.command)
  assert.deepEqual(onClassLine, [CODE_VISION_SHOW_USAGES, CODE_VISION_SHOW_INHERITORS])
})

test('上限只作用在"问多少个"，超出的符号少画一行而不是报错', async () => {
  const request = server()
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java', maxSymbols: 2 })
  await channel.refresh()
  assert.equal(countOfKind(request, 'references'), 2)
  assert.equal(channel.entries().length, 2)
  assert.equal(VISION_COUNT_MAX_SYMBOLS, 24, '默认上限是显式写出来的常数，不是散在各处的字面量')
})

test('同一拍不重复问；签名变了才重问（旧值先用，不是每次都清空）', async () => {
  let signature = 'src/Alpha.java:10'
  const request = server()
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java', signature: () => signature })
  channel.entries()                       // 起第一轮（后台）
  const first = channel.pending()
  assert.ok(first, '这一拍要在飞')
  channel.entries()                       // 同一拍：不再起第二轮
  await first
  assert.equal(countOfKind(request, 'documentSymbol'), 1, '同一拍只问一次')
  signature = 'src/Alpha.java:11'
  channel.entries()                       // 新签名：这一拍要重问
  const second = channel.pending()
  assert.ok(second, '签名变了要重问')
  await second
  assert.equal(countOfKind(request, 'documentSymbol'), 2)
})

test('计数落地后补刷一次（宿主那条 schedule 就是被这个叫起来的）', async () => {
  const request = server()
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  let notified = 0
  channel.attach(() => { ++notified })
  await channel.refresh()
  assert.equal(notified, 1)
})

test('reset 丢掉上一拍，且在飞的那轮回来不再落盘（换文件不能拿旧计数画新文件）', async () => {
  let releaseOutline
  const calls = []
  const request = async (method, params) => {
    calls.push(params.kind)
    if (params.kind === 'documentSymbol') return new Promise(resolve => { releaseOutline = resolve })
    return { available: false }
  }
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  const pending = channel.refresh()
  await new Promise(resolve => setImmediate(resolve))
  channel.reset()
  releaseOutline({ available: true, symbols: OUTLINE })
  await pending
  assert.deepEqual(channel.entries(), [])
  assert.equal(calls.filter(kind => kind === 'references').length, 0)
  channel.reset()
  assert.deepEqual(channel.entries(), [], 'reset 之后同步那半也是空的')
})

test('provider 表按 id 覆盖：自定义的 references 提供者顶掉内置那个', async () => {
  const request = server()
  const registry = createCodeVisionRegistry([usagesVisionProvider()])
  registry.register({ ...usagesVisionProvider(), computeForDocument: () => [{ line: 0, title: '自定义', command: 'a.b' }] })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java', registry })
  await channel.refresh()
  assert.deepEqual(channel.entries().map(entry => entry.title), ['自定义'])
  assert.equal(registry.providers().length, 1)
})

test('条目带的命令与坐标能被 IDE 侧收口成本地动作（不是把假命令发给语言服务）', async () => {
  const request = server({ references: () => ({ available: true, refs: [{ path: 'src/Other.java', line: 9, character: 1 }] }) })
  const channel = createCodeVisionLocalChannel({ request, path: () => 'src/Alpha.java' })
  await channel.refresh()
  const entry = channel.entries().find(item => item.command === CODE_VISION_SHOW_USAGES)
  assert.deepEqual(localCodeVisionAction(entry.command, entry.arguments),
    { kind: 'findUsages', path: 'src/Alpha.java', line: 0, character: 10, symbol: 'Alpha' })
  // 参数残缺（少了名字/坐标）时退回 none，而不是带着半个坐标跳。
  assert.deepEqual(localCodeVisionAction(CODE_VISION_SHOW_USAGES, [{ path: 'a.java', line: 1 }]), { kind: 'none' })
  assert.deepEqual(localCodeVisionAction(CODE_VISION_SHOW_INHERITORS, [{ path: 'a.java', line: 1, character: 2, symbol: 'B' }]),
    { kind: 'showInheritors', path: 'a.java', line: 1, character: 2, symbol: 'B' })
  assert.deepEqual(localCodeVisionAction('server.someCommand', [{ path: 'a.java', line: 1 }]), { kind: 'none' })
})

test('文案与中文包一字不差；provider id 用上游的组 id', () => {
  assert.equal(usagesHintText(0), '0 个用法')
  assert.equal(usagesHintText(1), '1 个用法')
  assert.equal(usagesHintText(12), '12 个用法')
  assert.equal(inheritorsHintText(1, 5), '1 个继承者')
  assert.equal(inheritorsHintText(3, 11), '3 个实现')
  assert.equal(usagesVisionProvider().id, 'references', 'PlatformCodeVisionIds.kt:5 的 USAGES.key')
  assert.equal(inheritorsVisionProvider().id, 'inheritors', '同文件 :6 的 INHERITORS.key')
})

test('回包形状不对就当没这个符号：缺名字/缺行/区间倒置都不进表', () => {
  const junk = [
    { kind: 5, startLine: 0, startChar: 1, endLine: 3 },
    { name: 'NoLines', kind: 5 },
    { name: 'Inverted', kind: 5, startLine: 9, startChar: 1, endLine: 2 },
    { name: 'NoNamePos', kind: 5, startLine: 1, endLine: 2 },
    { name: 'Ok', kind: 5, startLine: 4, startChar: 9, endLine: 7 },
  ]
  const symbols = toVisionSymbols(junk)
  // `NoNamePos` 留着：没有名字列它仍是 `problems` 那一档的合法锚点，只是不能拿去问计数。
  assert.deepEqual(symbols.map(symbol => symbol.name), ['NoNamePos', 'Ok'])
  assert.deepEqual(usageAnchorSymbols(symbols, 24).map(symbol => symbol.name), ['Ok'])
  assert.deepEqual(toVisionSymbols(undefined), [])
  assert.equal(languageOfPath('src/main/java/Alpha.java'), 'java')
  assert.equal(languageOfPath('README'), '')
})

test('references 回包里的坏条目不计入用法数；没名字位置时宁可不画', () => {
  const reply = { available: true, refs: [{ path: 'a.java', line: 3 }, null, { path: 'b.java', line: 4, character: 2 }] }
  assert.equal(usageCountOf(reply, 'a.java', { name: 'x', kind: 5, startLine: 0, startChar: 0, endLine: 9 }), 1)
  assert.equal(usageCountOf(reply, 'a.java', { name: 'x', kind: 5, startLine: 0, endLine: 9 }), null)
  assert.equal(usageCountOf({ available: false }, 'a.java', { name: 'x', kind: 5, startLine: 0, startChar: 0, endLine: 9 }), 0)
  assert.equal(usageCountOf(null, 'a.java', { name: 'x', kind: 5, startLine: 0, startChar: 0, endLine: 9 }), null)
})
