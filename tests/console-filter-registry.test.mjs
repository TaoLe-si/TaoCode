// 控制台过滤器注册表 + 默认过滤器链 + CompositeFilter 语义的判据。
//
// 上游：`platform/lang-api/src/com/intellij/execution/filters/`（ConsoleFilterProvider / Filter /
// CompositeFilter / ConsoleInputFilterProvider / CompositeInputFilter）+ 内建链
// `DefaultConsoleFiltersProvider` / `UrlFilter$UrlFilterProvider`。
// 本仓落点 `src/consoleFilterRegistry.ts`（插件贡献面仍在 `src/consoleFilterProviders.ts`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ALLOW_OVERLAPPING_HYPERLINKS_REGISTRY_KEY, BUILD_CONSOLE_EXTRA_FILTERS, CONSOLE_FILTER_HIGHLIGHTER_LAYER,
  CONSOLE_FILTER_PROVIDER_INVENTORY, CONSOLE_FILTER_SEMANTICS, CONSOLE_INPUT_FILTER_PROVIDER_EP,
  CONSOLE_OUTPUT_TYPES, ConsoleApplyFilterError, ConsoleFilterRegistry, DEFAULT_PORT_LISTENING_OPTIONS,
  ELEVATION_AUTHORIZE_EVERY_TIME, ELEVATION_DEFAULT_GRACE_PERIOD_MS, ELEVATION_DEFAULT_SETTINGS,
  ELEVATION_KEEP_AUTH_LABEL, ELEVATION_MAX_DAEMON_ATTEMPTS, ELEVATION_SETTINGS_TITLE, EXCEPTION_FILTER_EP,
  EXCEPTION_FILTER_FACTORY_INVENTORY, HYPERLINK_HIGHLIGHTER_LAYER, INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP,
  applyCompositeFilter, applyConsoleFilterChain, builtinConsoleFilterProviders, consoleFilterChainProviders,
  createCompositeInputFilter, createConsoleFilterRegistry, elevationAuthLabel, elevationAvailable, elevationQuota,
  elevationWrappedCommand, filterItem, filterOffsetsCorrect, filterResult, hasHyperlink, inputFilterSplits,
  intersectsAcceptedHyperlink, invisibleHyperlinkFilters, isCancellation, listeningPortsOf, portOptionsIncludeChildren,
  portOptionsIncludeSelf, portWatchDelta, portWatchPids, portWatchStep, portWatchSupported, providerFilters,
  rangesIntersectStrict, registeredInputFilters, urlFilterProvider,
} from '../src/consoleFilterRegistry.ts'
import { CONSOLE_FILTER_PROVIDER_EP, registerConsoleFilterProvider } from '../src/consoleFilterProviders.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'
import { findRunHyperlinks } from '../src/runHyperlinks.ts'
import { terminalHyperlinkRanges, terminalLinkTarget } from '../src/terminalHyperlinks.ts'
import { classifyJavaException } from '../src/exceptionFilter.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const ctx = root => ({ root })

/** 一条只认某个子串的 filter（断言用夹具）。 */
function probe(substring, options = {}) {
  return {
    name: 'probe',
    applyFilter(line) {
      const at = line.indexOf(substring)
      if (at < 0) return null
      const item = filterItem({
        start: at, end: at + substring.length, path: options.path ?? null, url: options.url ?? null,
      })
      return filterResult([item], options.nextAction ?? 'exit')
    },
  }
}

test('EP id 逐字取上游，且四条 EP 都已在宿主里声明', () => {
  assert.equal(CONSOLE_FILTER_PROVIDER_EP, 'com.intellij.consoleFilterProvider')
  assert.equal(CONSOLE_INPUT_FILTER_PROVIDER_EP, 'com.intellij.consoleInputFilterProvider')
  assert.equal(INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP, 'com.intellij.invisibleHyperlinkFilterProvider')
  assert.equal(EXCEPTION_FILTER_EP, 'com.intellij.exceptionFilter')
  assert.equal(ALLOW_OVERLAPPING_HYPERLINKS_REGISTRY_KEY, 'execution.filters.with.hyperlinks.allow.overlapping')
  for (const id of [CONSOLE_FILTER_PROVIDER_EP, CONSOLE_INPUT_FILTER_PROVIDER_EP,
    INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP, EXCEPTION_FILTER_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `EP 未声明：${id}`)
  }
})

test('高亮层与内容类型档照上游常量', () => {
  // HighlighterLayer.java:37 / :35
  assert.equal(HYPERLINK_HIGHLIGHTER_LAYER, 5900)
  assert.equal(CONSOLE_FILTER_HIGHLIGHTER_LAYER, 5800)
  // Filter.java:243-245：有 hyperlink 走 HYPERLINK，否则 CONSOLE_FILTER
  assert.equal(filterItem({ start: 0, end: 1, path: 'a.ts' }).highlighterLayer, HYPERLINK_HIGHLIGHTER_LAYER)
  assert.equal(filterItem({ start: 0, end: 1 }).highlighterLayer, CONSOLE_FILTER_HIGHLIGHTER_LAYER)
  // ConsoleViewContentType.java:47-50 / :52
  assert.deepEqual([...CONSOLE_OUTPUT_TYPES], ['NORMAL_OUTPUT', 'ERROR_OUTPUT', 'USER_INPUT', 'SYSTEM_OUTPUT'])
})

test('provider 三分支分派：consoleView → Ex(scope) → 基础（ConsoleViewUtil.java:300-313 的顺序）', () => {
  const calls = []
  const dependent = {
    getDefaultFilters: () => { calls.push('base'); return [] },
    getDefaultFiltersWithScope: () => { calls.push('ex'); return [] },
    getDefaultFiltersForConsole: () => { calls.push('console'); return [] },
  }
  providerFilters(dependent, ctx('C:/p'))
  assert.deepEqual(calls, ['ex'], '没有 consoleId ⇒ 不进 consoleView 分支（ConsoleViewUtil.java:304 的 consoleView != null）')
  calls.length = 0
  providerFilters(dependent, { root: 'C:/p', consoleId: 'run' })
  assert.deepEqual(calls, ['console'], '有 consoleId 时优先 consoleView 分支')
  calls.length = 0
  const exOnly = { getDefaultFilters: () => { calls.push('base'); return [] }, getDefaultFiltersWithScope: () => { calls.push('ex'); return [] } }
  providerFilters(exOnly, { root: 'C:/p', consoleId: 'run' })
  assert.deepEqual(calls, ['ex'], '没有 consoleView 重载时走 Ex')
  calls.length = 0
  providerFilters({ getDefaultFilters: () => { calls.push('base'); return [] } }, { root: 'C:/p', consoleId: 'run' })
  assert.deepEqual(calls, ['base'])
})

test('单个 provider 抛异常只跳过它；取消类错误上抛（ConsoleViewUtil.java:320-332）', () => {
  const boom = { getDefaultFilters: () => { throw new Error('provider broke') } }
  const ok = { getDefaultFilters: () => [probe('X')] }
  assert.equal(providerFilters(boom, ctx('C:/p')).length, 0)
  assert.equal(providerFilters(ok, ctx('C:/p')).length, 1)
  const cancelled = { getDefaultFilters: () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e } }
  assert.ok(isCancellation(new Error('x')) === false)
  assert.throws(() => providerFilters(cancelled, ctx('C:/p')), /cancelled/)
})

test('CompositeFilter：命中并起来、按顺序、无命中回 null', () => {
  const result = applyCompositeFilter([probe('aa'), probe('bb')], 'x aa bb y', 9, ctx('C:/p'))
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items.map(i => [i.highlightStartOffset, i.highlightEndOffset]), [[2, 4], [5, 7]])
  assert.equal(result.nextAction, 'exit', '最终结果一律回到缺省 EXIT（Filter.java:30）')
  assert.equal(applyCompositeFilter([probe('zz')], 'x aa bb y', 9, ctx('C:/p')), null)
})

test('NextAction：控制台恒 forceUseAllFilters=true ⇒ EXIT 也继续；关掉才停（:86-88/:115-117/:427）', () => {
  const exiting = probe('aa', { nextAction: 'exit' })
  const second = probe('bb')
  assert.equal(applyCompositeFilter([exiting, second], 'aa bb', 5, ctx('C:/p')).items.length, 2,
    '默认 forceUseAllFilters=true 与 ConsoleViewImpl.java:427 一致')
  const stopped = applyCompositeFilter([exiting, second], 'aa bb', 5, ctx('C:/p'), { forceUseAllFilters: false })
  assert.equal(stopped.items.length, 1, 'forceUseAllFilters=false 时 EXIT 停链')
  const continued = applyCompositeFilter([probe('aa', { nextAction: 'continue' }), second], 'aa bb', 5, ctx('C:/p'),
    { forceUseAllFilters: false })
  assert.equal(continued.items.length, 2, 'CONTINUE_FILTERING 不停链')
})

test('merge：偏移非法丢掉（:136-145）；allowOverlapping=false 时相交的 hyperlink 命中丢掉（:124/:128）', () => {
  assert.equal(filterOffsetsCorrect(filterItem({ start: 4, end: 2 }), 10), false)
  assert.equal(filterOffsetsCorrect(filterItem({ start: 0, end: 11 }), 10), false)
  assert.equal(filterOffsetsCorrect(filterItem({ start: 0, end: 10 }), 10), true)
  // intersectsStrict = max(s1,s2) < min(e1,e2)（TextRange.java:247-249）：相邻不算相交
  assert.equal(rangesIntersectStrict(0, 3, 3, 6), false)
  assert.equal(rangesIntersectStrict(0, 4, 3, 6), true)
  const first = filterItem({ start: 0, end: 5, path: 'a.ts' })
  assert.equal(intersectsAcceptedHyperlink([first], filterItem({ start: 3, end: 8, path: 'b.ts' })), true)
  assert.equal(intersectsAcceptedHyperlink([filterItem({ start: 0, end: 5 })], filterItem({ start: 3, end: 8, path: 'b.ts' })), false,
    '已收的那条没有 hyperlink ⇒ 不算相交（CompositeFilter.intersects 只看有 hyperlink 的，:154）')
  assert.equal(hasHyperlink(filterItem({ start: 0, end: 1, url: 'https://x' })), true)

  const a = probe('aa', { path: 'a.ts' })
  const b = probe('bb', { path: 'b.ts' })
  const overlapping = { name: 'over', applyFilter: () => filterResult([filterItem({ start: 1, end: 5, path: 'c.ts' })]) }
  assert.equal(applyCompositeFilter([a, overlapping], 'x aa y', 6, ctx('C:/p')).items.length, 2,
    '默认 allowOverlapping=true（registry 键 defaultValue=true）⇒ 两条都收')
  const strict = applyCompositeFilter([a, overlapping], 'x aa y', 6, ctx('C:/p'), { allowOverlappingHyperlinks: false })
  assert.deepEqual(strict.items.map(i => i.path), ['a.ts'], '关掉时相交的后一条被丢')
})

test('坏 filter 抛 ConsoleApplyFilterError；AbortError 上抛（:72-77）', () => {
  const broken = { name: 'broken', applyFilter: () => { throw new Error('boom') } }
  assert.throws(() => applyCompositeFilter([broken], 'x', 1, ctx('C:/p')), error => {
    assert.ok(error instanceof ConsoleApplyFilterError)
    assert.match(error.message, /Error while applying/)
    return true
  })
  const cancelled = { name: 'cancelled', applyFilter: () => { const e = new Error('c'); e.name = 'AbortError'; throw e } }
  assert.throws(() => applyCompositeFilter([cancelled], 'x', 1, ctx('C:/p')), error => {
    assert.ok(isCancellation(error))
    assert.equal(error.name, 'AbortError')
    return true
  })
})

test('注册表：同 id 覆盖、可注销、顺序即 provider 顺序', () => {
  const registry = new ConsoleFilterRegistry()
  const first = { id: 'p1', getDefaultFilters: () => [probe('aa')] }
  const second = { id: 'p2', getDefaultFilters: () => [probe('bb')] }
  registry.register(first, 'p1')
  registry.register(second, 'p2')
  assert.deepEqual([...registry.providerIds()], ['p1', 'p2'])
  assert.equal(registry.computeFilters(ctx('C:/p')).length, 2)
  registry.register({ id: 'p1', getDefaultFilters: () => [] }, 'p1')
  assert.equal(registry.computeFilters(ctx('C:/p')).length, 1, '同 id 覆盖不新增条目')
  assert.equal(registry.unregister('p1'), true)
  assert.equal(registry.unregister('p1'), false)
  assert.deepEqual([...registry.providerIds()], ['p2'])
})

test('内建链：URL 命中 + file: 命中（UrlFilterProvider）；file:line（RegexpFilter）；异常类名纯高亮', () => {
  const chain = createConsoleFilterRegistry()
  const line = 'see https://example.com/x?y=1 and file:///C:/p/a.ts:12:3 and src/b.ts:7 here'
  const result = chain.applyFilter(line, ctx('C:/p'))
  assert.ok(result, '这条行必须有命中')
  const urls = result.items.filter(item => item.url !== null).map(item => item.url)
  assert.ok(urls.includes('https://example.com/x?y=1'), `URL 命中缺失：${JSON.stringify(urls)}`)
  const fileItems = result.items.filter(item => item.path !== null)
  assert.ok(fileItems.some(item => item.path === 'C:/p/a.ts' && item.line === 12 && item.column === 3),
    `file: 命中缺失：${JSON.stringify(fileItems)}`)
  assert.ok(fileItems.some(item => item.line === 7), `file:line 命中缺失：${JSON.stringify(fileItems)}`)

  const exceptionLine = 'Exception in thread "main" java.lang.NullPointerException: boom'
  const exResult = chain.applyFilter(exceptionLine, ctx('C:/p'))
  const exItems = exResult.items.filter(item => item.path === null && item.url === null)
  assert.equal(exItems.length, 1, '异常类名是一条纯高亮命中（无 PSI ⇒ 不给 hyperlink）')
  const info = classifyJavaException(exceptionLine)
  assert.equal(exceptionLine.slice(exItems[0].highlightStartOffset, exItems[0].highlightEndOffset), info.className)
})

test('内建链与既有识别函数逐条一致（同一行、同一区间）', () => {
  const line = 'at C:/proj/src/a.ts:5:2 and https://example.org/z'
  const items = applyConsoleFilterChain(line, 'C:/proj')
  const expectedFiles = findRunHyperlinks(line, 'C:/proj').map(l => ({ path: l.path, line: l.line, column: l.column }))
  assert.deepEqual(items.filter(i => !i.path.startsWith('http')).map(i => i.path), expectedFiles.map(e => e.path))
  const urlRanges = terminalHyperlinkRanges(line)
  assert.ok(urlRanges.length >= 1)
  const target = terminalLinkTarget(urlRanges[0].text)
  assert.equal(target.kind === 'browser' ? target.url : target.path, 'https://example.org/z')
})

test('插件 provider 按同一个 EP 挂进来即进链尾（内建在前）', () => {
  const before = consoleFilterChainProviders().length
  // 插件那份契约：applyFilter(text, startOffset, context) → {path,line,column?}（不报偏移）。
  const dispose = registerConsoleFilterProvider({
    getDefaultFilters: () => [{
      applyFilter: text => (text.includes('MAGIC') ? { path: 'magic.ts', line: 1, column: 1 } : null),
    }],
  }, 'test.console.filter.chain')
  try {
    const providers = consoleFilterChainProviders()
    assert.equal(providers.length, before + 1)
    const hits = applyConsoleFilterChain('has MAGIC here', 'C:/p')
    assert.deepEqual(hits, [{ path: 'magic.ts', line: 1, column: 1 }])
    // 内建仍在前：同一条行里两族命中都在
    const mixed = applyConsoleFilterChain('MAGIC and src/a.ts:3', 'C:/p')
    assert.equal(mixed.length, 2)
  }
  finally { dispose() }
  assert.equal(consoleFilterChainProviders().length, before)
})

test('输入过滤器：第一个非 null 就返回、坏 filter 永久跳过、空链是 noop', () => {
  const split = {
    applyFilter: (text, contentType) => [{ text: text.toUpperCase(), contentType: 'ERROR_OUTPUT' }],
  }
  const never = { applyFilter: () => { throw new Error('nope') } }
  const composite = createCompositeInputFilter([never, split, { applyFilter: () => [{ text: 'later', contentType: 'NORMAL_OUTPUT' }] }])
  assert.deepEqual(composite.applyFilter('abc', 'NORMAL_OUTPUT'), [{ text: 'ABC', contentType: 'ERROR_OUTPUT' }])
  assert.equal(composite.brokenCount(), 1, '坏 filter 被标记（CompositeInputFilter.java:62-74）')
  assert.deepEqual(composite.applyFilter('abc', 'NORMAL_OUTPUT'), [{ text: 'ABC', contentType: 'ERROR_OUTPUT' }],
    '再问一次坏 filter 不再被调用')
  const empty = createCompositeInputFilter([])
  assert.equal(empty.applyFilter('abc', 'NORMAL_OUTPUT'), null)
  // 上游 ConsoleViewUtil.java:349-351：没有任何 provider 时就是 (text, contentType) -> null
  assert.equal(registeredInputFilters(ctx('C:/p')).length, 0, '参考树里 <consoleInputFilterProvider implementation> 登记数为 0')
})

test('输入过滤结果的用法：USER_INPUT 块当用户输入、其余块打印（ConsoleViewImpl.kt:1402-1420）', () => {
  assert.deepEqual(inputFilterSplits(null), { userInput: '', printed: [] })
  const chunks = [
    { text: 'PS> ', contentType: 'NORMAL_OUTPUT' },
    { text: 'dir', contentType: 'USER_INPUT' },
    { text: ' done', contentType: 'SYSTEM_OUTPUT' },
  ]
  const splits = inputFilterSplits(chunks)
  assert.equal(splits.userInput, 'dir')
  assert.deepEqual(splits.printed.map(c => c.contentType), ['NORMAL_OUTPUT', 'SYSTEM_OUTPUT'])
})

test('悬停行过滤器 EP 可挂（只对鼠标下那一行算，InvisibleHyperlinkFilterProvider.kt:11-16）', () => {
  assert.equal(invisibleHyperlinkFilters(ctx('C:/p')).length, 0, '平台无内建贡献')
  const handle = EXTENSIONS.registerExtension(INVISIBLE_HYPERLINK_FILTER_PROVIDER_EP, 'test.hover.filter', {
    getFilters: () => [probe('hover', { path: 'h.ts' })],
  }, { source: 'user' })
  try {
    assert.equal(invisibleHyperlinkFilters(ctx('C:/p')).length, 1)
  }
  finally { handle.dispose() }
  assert.equal(invisibleHyperlinkFilters(ctx('C:/p')).length, 0)
})

test('内置 provider 清单：条数与登记坐标逐条可指（不抄文档数字）', () => {
  assert.equal(CONSOLE_FILTER_PROVIDER_INVENTORY.length, 15)
  assert.equal(EXCEPTION_FILTER_FACTORY_INVENTORY.length, 3)
  assert.equal(BUILD_CONSOLE_EXTRA_FILTERS.length, 3)
  for (const row of [...CONSOLE_FILTER_PROVIDER_INVENTORY, ...EXCEPTION_FILTER_FACTORY_INVENTORY, ...BUILD_CONSOLE_EXTRA_FILTERS]) {
    assert.match(row.registration, /^[^:]+\.(xml|java|kt):\d+$/, `登记坐标形状不对：${row.registration}`)
  }
  const ids = CONSOLE_FILTER_PROVIDER_INVENTORY.map(row => row.id)
  assert.equal(new Set(ids).size, ids.length, 'provider 清单不该有重复行')
  assert.ok(ids.includes('com.intellij.execution.filters.UrlFilter$UrlFilterProvider'))
  assert.ok(ids.includes('com.intellij.execution.filters.DefaultConsoleFiltersProvider'))
})

test('过滤语义：不折叠不隐藏不改复制；invisible link 不进 occurrence 导航', () => {
  assert.deepEqual({ ...CONSOLE_FILTER_SEMANTICS }, {
    foldsLines: false, hidesLines: false, affectsCopy: false,
    excludesInvisibleLinksFromOccurrenceNavigation: true,
  })
  // filter 只产区间、正文不改：命中区间之外的行内容与输入逐字相同
  const line = 'plain text with C:/p/a.ts:2 inside'
  const items = applyConsoleFilterChain(line, 'C:/p')
  assert.ok(items.length >= 1)
  assert.equal(filterItem({ start: 0, end: 1, path: 'a.ts', invisibleLink: true }).invisibleLink, true)
})

test('内建链的三个 provider 都是上游那三条的形状（id 逐字）', () => {
  const ids = builtinConsoleFilterProviders().map(p => p.id)
  assert.deepEqual(ids, [
    'com.intellij.execution.filters.ExceptionBaseFilterFactory',
    'com.intellij.execution.filters.UrlFilter$UrlFilterProvider',
    'com.intellij.execution.filters.RegexpFilter',
  ])
  assert.equal(urlFilterProvider.getDefaultFilters(ctx('C:/p')).length, 1)
  assert.equal(urlFilterProvider.getDefaultFiltersWithScope(ctx('C:/p')).length, 1)
})

test('接线：模块 import 插件贡献面与既有识别函数，EP 声明在模块加载时执行', () => {
  const src = read('src/consoleFilterRegistry.ts')
  assert.match(src, /import \{ CONSOLE_FILTER_PROVIDER_EP, consoleFilterProviders \} from '\.\/consoleFilterProviders\.ts'/)
  assert.match(src, /from '\.\/terminalHyperlinks\.ts'/)
  assert.match(src, /from '\.\/runHyperlinks\.ts'/)
  assert.match(src, /from '\.\/exceptionFilter\.ts'/)
  assert.match(src, /^declareConsoleFilterExtensionPoints\(\)$/m, 'EP 声明在模块加载时执行')
})

// ── 端口监视器（execution/portsWatcher）：差集 + 进程树 + 平台门 ──────────────────────────────

test('PortListeningOptions 三档与默认档照上游（PortListeningOptions.kt:7-13、ProcessPortsWatcher.kt:49）', () => {
  assert.equal(DEFAULT_PORT_LISTENING_OPTIONS, 'INCLUDE_SELF_AND_CHILDREN')
  assert.equal(portOptionsIncludeSelf('INCLUDE_SELF'), true)
  assert.equal(portOptionsIncludeSelf('INCLUDE_CHILDREN'), false)
  assert.equal(portOptionsIncludeChildren('INCLUDE_CHILDREN'), true)
  assert.equal(portOptionsIncludeChildren('INCLUDE_SELF'), false)
  assert.equal(portOptionsIncludeSelf('INCLUDE_SELF_AND_CHILDREN'), true)
  assert.equal(portOptionsIncludeChildren('INCLUDE_SELF_AND_CHILDREN'), true)
})

test('非本机 Windows 目标禁用端口探测（ProcessPortsWatcher.kt:51-54）', () => {
  assert.equal(portWatchSupported('windows', true), true)
  assert.equal(portWatchSupported('windows', false), false, '非本机 Windows 目标 ⇒ no-op')
  assert.equal(portWatchSupported('linux', false), true)
  assert.equal(portWatchSupported('mac', false), true)
})

test('进程树收 pid：getAllChildPids 递归（ProcessPortsWatcherImpl.kt:174-200）', () => {
  const tree = [
    { pid: 11, parent: 10, name: 'a' },
    { pid: 12, parent: 10, name: 'b' },
    { pid: 13, parent: 12, name: 'c' },
    { pid: 99, parent: 77, name: 'unrelated' },
  ]
  assert.deepEqual(portWatchPids(10, tree), [10, 11, 12, 13], '默认档含自己与后代')
  assert.deepEqual(portWatchPids(10, tree, 'INCLUDE_CHILDREN'), [11, 12, 13])
  assert.deepEqual(portWatchPids(10, tree, 'INCLUDE_SELF'), [10])
  assert.deepEqual(portWatchPids(0, tree), [], '没有根 pid 就没有 pid 表')
  assert.deepEqual(portWatchPids(10, [{ pid: 11, parent: 10, name: '' }, { pid: 10, parent: 11, name: '' }]), [10, 11],
    '输入不可信时的环不会死循环')
})

test('端口差集：双向差集、按 pid+port 比、pid 为 null 按端口比（:157-172）', () => {
  const before = [{ port: 8080, pid: 100 }, { port: 9229, pid: 100 }]
  const delta = portWatchDelta(before, [{ port: 9229, pid: 100 }, { port: 3000, pid: 100 }])
  assert.deepEqual(delta.started, [{ port: 3000, pid: 100 }])
  assert.deepEqual(delta.ended, [{ port: 8080, pid: 100 }])
  assert.deepEqual(portWatchDelta(before, before), { started: [], ended: [] }, '没变就不报事件')
  assert.deepEqual(portWatchDelta([{ port: 5, pid: null }], [{ port: 5, pid: 7 }]), {
    started: [{ port: 5, pid: 7 }], ended: [{ port: 5, pid: null }],
  }, 'pid 不同算不同记录（stdout 监听那条拿不到 pid）')
  assert.deepEqual(portWatchDelta([{ port: 8081, pid: 1 }, { port: 8080, pid: 1 }], []).ended,
    [{ port: 8080, pid: 1 }, { port: 8081, pid: 1 }], 'ended 按端口升序')
})

test('监听记录表：端口过滤去重、pid 记根进程（宿主 ports_of 不带 pid）', () => {
  assert.deepEqual(listeningPortsOf(100, [8080, 8080, 3000, 0, 70000, -1, 1.5, 65535]),
    [{ port: 3000, pid: 100 }, { port: 8080, pid: 100 }, { port: 65535, pid: 100 }])
  assert.deepEqual(listeningPortsOf(0, [8080]), [{ port: 8080, pid: null }])
  const step = portWatchStep([], 100, [8080])
  assert.deepEqual(step.current, [{ port: 8080, pid: 100 }])
  assert.deepEqual(step.delta.started, [{ port: 8080, pid: 100 }])
  assert.deepEqual(portWatchStep(step.current, 100, [8080, 9229]).delta, {
    started: [{ port: 9229, pid: 100 }], ended: [],
  })
})

// ── 提权（execution/process/elevation）：可移植规则 ──────────────────────────────────────────

test('提权设置：quota 与文案照上游（ElevationSettings.kt:31/36-45、ElevationBundle.properties:32-33）', () => {
  assert.equal(ELEVATION_SETTINGS_TITLE, 'Process Elevation')
  assert.equal(ELEVATION_DEFAULT_GRACE_PERIOD_MS, 15 * 60 * 1000)
  assert.equal(ELEVATION_MAX_DAEMON_ATTEMPTS, 3)
  assert.equal(ELEVATION_KEEP_AUTH_LABEL.windows, 'Keep UAC authorization for')
  assert.equal(ELEVATION_KEEP_AUTH_LABEL.posix, "Keep 'sudo' authorization for")
  assert.deepEqual({ ...ELEVATION_DEFAULT_SETTINGS }, { keepAuth: false, refreshable: false, gracePeriodMs: 900000 })
  assert.deepEqual(elevationQuota(ELEVATION_DEFAULT_SETTINGS), { timeLimitMs: 0, isRefreshable: false })
  assert.deepEqual(elevationQuota({ keepAuth: true, refreshable: true, gracePeriodMs: 900000 }),
    { timeLimitMs: 900000, isRefreshable: true })
  assert.deepEqual(elevationQuota({ keepAuth: false, refreshable: true, gracePeriodMs: 900000 }),
    { timeLimitMs: 0, isRefreshable: false }, '不保持授权时 refreshable 无效（:38）')
  assert.equal(elevationAuthLabel(ELEVATION_DEFAULT_SETTINGS), ELEVATION_AUTHORIZE_EVERY_TIME)
  assert.equal(elevationAuthLabel({ keepAuth: true, refreshable: false, gracePeriodMs: 900000 }), 'Keep authorized for 15 min')
  assert.equal(elevationAuthLabel({ keepAuth: true, refreshable: false, gracePeriodMs: 0 }), ELEVATION_AUTHORIZE_EVERY_TIME)
})

test('提权通道：本仓宿主没有 ⇒ isAvailable/sudoCommand 都是否（ElevationService.java:40-42、SudoCommandProvider.kt:11/21）', () => {
  assert.equal(elevationAvailable(false), false)
  assert.equal(elevationAvailable(true), true)
  assert.equal(elevationWrappedCommand('cmd', ['/c', 'x'], false), null, '没有提权工具 ⇒ null（上游注释）')
  assert.equal(elevationWrappedCommand('cmd', ['/c', 'x'], true), 'cmd /c x')
  assert.equal(elevationWrappedCommand('   ', ['x'], true), null)
})