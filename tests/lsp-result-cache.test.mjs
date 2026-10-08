// 语言服务**结果缓存**这一族的判据（族 `ls/highlighting` / `lp/inlay-hints`，hlfeat 那条被中止的
// lane 留下的缺项）。派单点名的两个前提都在这里被"能失败"的方式钉住，不是只在文档里判定：
//
// ## 上游是谁在决定"这一次要不要打服务器"
//   · **documentHighlight 有一份按文件的结果缓存**：
//     `platform/lsp-impl/src/impl/LspRequestExecutor.kt:55` 登记 `documentHighlightCache`
//     （跟着客户端走，`:48` 的 `allCaches` + `:68-70` `clearCaches()` + `:63-65` `afterShutdown()`），
//     取用点是 `:180-192` 的 `getDocumentHighlightsCaching(file, offset)` ——
//     里面就是 `documentHighlightCache.getOrCompute(file, offset)`。
//     命中规则在 `platform/lsp-impl/src/impl/features/highlighting/LspDocumentHighlightCache.kt:8-10`：
//     **同一个偏移**，或**查询点落在任一已存区间里**（`storedValue.any { it.textRange.contains(queriedOffset) }`）。
//     底座是 `platform/lsp-impl/src/impl/cache/LspPerFileCache.kt:16-46` 那三条命中判据
//     （同文件 / stamp 未变 / `matches`）、`:99-101` 的「`null` 不入槽」与 `:76-82` 的「在途合并」。
//   · **inlayHint 走的是另一条**：`platform/lsp-impl/src/impl/features/inlayHint/LspInlayHintsCache.kt:17-39`
//     是 `LspHighlightingCache` 的子类，注册在
//     `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:31`。
//     父类那份状态机：`:62-84` 的 `getHighlightings` 先问 `isSupportedForFile`（`:63`）、
//     戳相同就不重取（`:68-71`）、`:95-102` 同一戳的请求只发一次、`:170-177` 回包时戳变了整份不收、
//     `:263-270` `clearCache` 参与整批生命周期。
//   · **"编辑后已画的要跟着走"** 也是这一族的：`platform/lsp-impl/src/impl/LspClientImpl.kt:213-220`
//     的 `fileEdited` 注释原话 —— 不做这一步「编辑之前应用上的高亮会一直停在旧偏移上」。
//
// ## 本仓接法
//   · documentHighlight → `src/editorSymbolHighlight.ts` 用 `LspPerFileCache` + `documentHighlightHit()`
//     组出 `documentHighlightCache`（那份 matches 规则此前只有判据在调、生产侧零消费方）。
//   · inlayHint → `src/editorInlayHints.ts` 用 `HighlightingSnapshotCache` 组出 `inlayHintCache`，
//     存**服务器原文 + 锚点**（不是过滤后的画面），所以改开关那一拍不发请求也能立刻重画。
//   · 两条都不再"每次调度一趟往返"；修订一变必然 miss（`semanticRevisionOf()` 的文档对象身份）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'

const {
  createSymbolHighlight, setSymbolHighlights, symbolHighlightField, documentHighlightCache,
} = await import('../src/editorSymbolHighlight.ts')
const {
  createInlayHints, hintField, setInlayHints, inlayHintCache,
} = await import('../src/editorInlayHints.ts')
const { clearAllLspCaches, lspCacheCount } = await import('../src/lspPerFileCache.ts')
const { lspFileFeatures } = await import('../src/lspPerFileCapabilities.ts')
const { semanticRevisionOf } = await import('../src/semanticHighlighting.ts')
const { clearHighlightLevels, setHighlightLevelForPath } = await import('../src/highlightSettingsPerFile.ts')

/** 一条宿主形状的拒绝（`native/lsp_capability_queries.cpp:95-106` ⇒ `src/bridge.ts` 的 `BridgeError.code`）。 */
const declined = () => Object.assign(new Error('服务器未声明该 provider'), { code: 'LSP_UNSUPPORTED' })

/**
 * 无头编辑器替身：只需要 `state` 与 `dispatch` 两件事（控制器不碰 DOM）。
 * `dispatch` 把事务真的作用到 state 上，于是"已画的那一层"能被读回来。
 */
function fakeEditor(doc, offset = 0) {
  let state = EditorState.create({ doc, extensions: [symbolHighlightField] })
  return {
    get state() { return state },
    dispatch(transaction) { state = state.update(transaction).state },
    moveCaret(to) { state = state.update({ selection: { anchor: to } }).state },
    edit(changes) { state = state.update({ changes }).state },
    painted: () => state.field(symbolHighlightField),
  }
}

/** documentHighlight 的控制器 + 往返计数。 */
function symbolHarness(doc, offset, replies) {
  const calls = []
  const editor = fakeEditor(doc, offset)
  const controller = createSymbolHighlight({
    enabled: () => true,
    path: () => 'src/Alpha.java',
    view: () => editor,
    request: async (_method, params) => {
      calls.push(params)
      const reply = replies?.[calls.length - 1] ?? (() => ({ available: true, highlights: [{ kind: 1, startLine: 0, startChar: 6, endLine: 0, endChar: 10 }] }))
      return reply()
    },
  })
  editor.moveCaret(offset)
  return { calls, controller, editor }
}

/** inlayHint 的控制器 + 往返计数（画面读的是自己建的那一层，与控制器同一个 StateEffect）。 */
function inlayHarness(doc, replies, options = {}) {
  const calls = []
  const field = hintField(() => undefined)
  let state = EditorState.create({ doc, extensions: [field] })
  const editor = {
    get state() { return state },
    dispatch(transaction) { state = state.update(transaction).state },
    edit(changes) { state = state.update({ changes }).state },
  }
  const controller = createInlayHints({
    enabled: () => true,
    path: () => options.path ?? 'src/Alpha.java',
    view: () => editor,
    toggles: options.toggles,
    request: async (_method, params) => {
      calls.push(params)
      const reply = replies?.[calls.length - 1] ?? (() => ({ available: true, hints: [{ line: 0, character: 5, label: ': int', kind: 1 }] }))
      return reply()
    },
  })
  return { calls, controller, editor, painted: () => state.field(field) }
}

test.beforeEach(() => {
  // 两份单例缓存 + 能力表都跟着客户端生命周期；判据之间必须从"全新的语言服务"开始。
  clearAllLspCaches()
  clearHighlightLevels()
})

// —————————————————————————— ① documentHighlight 的结果缓存

test('1 documentHighlight：同修订同偏移重复问 ⇒ 只打服务器一次', async () => {
  const { calls, controller, editor } = symbolHarness('class Alpha { void run() {} }', 8)
  await controller.run()
  await controller.run()
  await controller.run()
  assert.equal(calls.length, 1, `同一份文档同一个偏移发了 ${calls.length} 次请求 —— 上游那是 getOrCompute（LspRequestExecutor.kt:181）`)
  assert.deepEqual(editor.painted(), [{ from: 6, to: 10 }], '命中缓存也必须把高亮画上（不然缓存成了"什么都不画"）')
})

test('2 documentHighlight：光标落在已存区间里不再发；落到没覆盖的地方才发（上游 matches 那两条）', async () => {
  const { calls, controller, editor } = symbolHarness('class Alpha { void run() {} }', 7)
  await controller.run()
  assert.equal(calls.length, 1)
  // 同一处用法的另一个位置（8 仍在那条 6..10 里）⇒ 不发（`LspDocumentHighlightCache.kt:9` 的 contains）。
  editor.moveCaret(8)
  await controller.run()
  assert.equal(calls.length, 1, '光标还在已存区间里就又打了一次服务器')
  assert.deepEqual(editor.painted(), [{ from: 6, to: 10 }], '命中缓存时画面必须照旧有那条高亮')
  // 跳到别的词上（区间没覆盖 20）⇒ 必须重问（上游那时 matches 不成立）。
  editor.moveCaret(20)
  await controller.run()
  assert.equal(calls.length, 2, '光标已经落在已存区间之外却仍然不发请求 —— 那会把上一条用法的区间当成这个符号的答案')
})

test('3 documentHighlight：编辑换了文档对象 ⇒ 旧修订的答案绝不能顶上新内容', async () => {
  const { calls, controller, editor } = symbolHarness('class Alpha { void run() {} }', 7)
  await controller.run()
  assert.equal(calls.length, 1)
  const revisionBefore = semanticRevisionOf(editor.state.doc)
  editor.edit({ from: 0, insert: 'public ' })        // 换了一个 Text 对象 = 修订前进
  assert.notEqual(semanticRevisionOf(editor.state.doc), revisionBefore, '文档修订号没变：这条判据的驱动力本身坏了')
  editor.moveCaret(14)
  await controller.run()
  assert.equal(calls.length, 2, '内容变了还复用旧修订的区间 —— 上游那时 stamp 不同必然重取（LspPerFileCache.kt:68）')
})

test('4 documentHighlight：并发两拍合并在途那一次（上游 LspPerFileCache.kt:76-82 的等待-复评）', async () => {
  const gate = deferred()
  const { calls, controller, editor } = symbolHarness('class Alpha { void run() {} }', 7, [() => gate.promise])
  const first = controller.run()
  editor.moveCaret(9)                                 // 仍然会在回来的区间里
  const second = controller.run()
  await Promise.resolve()
  assert.equal(calls.length, 1, '第二拍没搭在途那一次车（并发打了两趟）')
  gate.resolve({ available: true, highlights: [{ kind: 1, startLine: 0, startChar: 6, endLine: 0, endChar: 10 }] })
  await Promise.all([first, second])
  assert.equal(calls.length, 1, `等待方复评后又发了一次（实发 ${calls.length}）`)
  assert.deepEqual(editor.painted(), [{ from: 6, to: 10 }])
})

test('5 documentHighlight：空答案也入槽，同偏移不再重问；被拒过的那条能力第二次一次都不发', async () => {
  const { calls, controller } = symbolHarness('class Alpha {}', 3, [() => ({ available: false })])
  await controller.run()
  await controller.run()
  assert.equal(calls.length, 1, '空结果没进缓存 ⇒ 每拍都在问同一件"这里没有高亮"')
  // 能力被服务器显式拒过：撤掉已画的，并且第二次问连表都过不去。
  const rejected = symbolHarness('class Beta {}', 4, [() => { throw declined() }, () => ({ available: true })])
  await rejected.controller.run()
  assert.equal(rejected.calls.length, 1, '第一次必须真的发出去（不然是靠猜而不是靠回包记账）')
  await rejected.controller.run()
  assert.equal(rejected.calls.length, 1, '宿主回过 LSP_UNSUPPORTED 之后又发了一次（`native/lsp_capability_queries.cpp:95-106`）')
  // 先画上了、后来那一发被确定拒掉 ⇒ 画着的要撤掉（换一台语言服务再演一遍，避开上一段的记忆）。
  lspFileFeatures.clearCache()
  const later = symbolHarness('class Gamma { void run() {} }', 7,
    [() => ({ available: true, highlights: [{ kind: 1, startLine: 0, startChar: 6, endLine: 0, endChar: 10 }] }), () => { throw declined() }])
  await later.controller.run()
  assert.deepEqual(later.editor.painted(), [{ from: 6, to: 10 }])
  later.editor.edit({ from: 0, insert: 'public ' })   // 修订一变，这一拍必然真的再问一次
  later.editor.moveCaret(14)
  await later.controller.run()
  assert.equal(later.calls.length, 2, '被拒的那一发是该问出来的（否则这条判据没有驱动力）')
  assert.deepEqual(later.editor.painted(), [], '能力被确定拒过，屏幕上还留着旧高亮')
})

test('6 documentHighlight：逐文件高亮级别「无」⇒ 撤掉已画的并且不再发', async () => {
  const { calls, controller, editor } = symbolHarness('class Alpha { void run() {} }', 7)
  await controller.run()
  assert.deepEqual(editor.painted(), [{ from: 6, to: 10 }])
  setHighlightLevelForPath('src/Alpha.java', 'none')
  editor.moveCaret(9)
  await controller.run()
  assert.deepEqual(editor.painted(), [], '这个文件已经声明不显示任何高亮，屏幕上还留着旧标记')
  assert.equal(calls.length, 1, '「无」档之后仍打了服务器')
})

test('7 documentHighlight：编辑后已画区间跟着文档走，被吃掉的丢掉', async () => {
  const { controller, editor } = symbolHarness('class Alpha { void run() {} }', 7)
  await controller.run()
  assert.deepEqual(editor.painted(), [{ from: 6, to: 10 }])
  // 在最前面插入 4 个字符：整条右移（上游 applyPendingEdit 的「编辑在区间之前 ⇒ 平移」）。
  editor.edit({ from: 0, insert: 'pub ' })
  assert.deepEqual(editor.painted(), [{ from: 10, to: 14 }], '高亮停在编辑前的偏移上（LspClientImpl.kt:213-220 点名的就是这个）')
  // 删掉那条区间本身：映射后零宽 ⇒ 丢掉，不画在错位置。
  editor.edit({ from: 10, to: 14, insert: '' })
  assert.deepEqual(editor.painted(), [], '被编辑吃掉的区间还留着')
})

test('8 documentHighlight：缓存参与整批作废（语言服务重启 / 服务器 refresh）', async () => {
  const { calls, controller } = symbolHarness('class Alpha { void run() {} }', 7)
  await controller.run()
  await controller.run()
  assert.equal(calls.length, 1)
  assert.ok(lspCacheCount() >= 1, '这份缓存没登记进整批作废的表（`src/lspPerFileCache.ts:41-46`）')
  clearAllLspCaches()
  await controller.run()
  assert.equal(calls.length, 2, '作废之后仍复用旧服务器的答案 —— 换客户端必须重新问一次')
})

// —————————————————————————— ② inlayHint 的结果缓存

test('9 inlayHint：文档没变重复调度 ⇒ 只打服务器一次，画面照旧有条目', async () => {
  const { calls, controller, painted } = inlayHarness('int x = value();')
  await controller.run()
  await controller.run()
  await controller.run()
  assert.equal(calls.length, 1, `同一修订发了 ${calls.length} 次 inlayHint —— 上游那一族是注册表里的具名缓存（LspHighlightingCacheRegistry.kt:31）`)
  assert.deepEqual(painted().map(entry => [entry.from, entry.text]), [[5, ': int']])
})

test('10 inlayHint：改开关（文档没变）不发第二次请求，但必须按新开关重画', async () => {
  const toggles = { type: true, parameter: true, other: true }
  const { calls, controller, painted } = inlayHarness('int x = value();', undefined, { toggles: () => ({ ...toggles }) })
  await controller.run()
  assert.equal(painted().length, 1)
  toggles.type = false
  await controller.run()
  assert.equal(calls.length, 1, '开关是渲染期的事，改它不该再打服务器')
  assert.deepEqual(painted(), [], '缓存里存的是**过滤后的画面**才会出现这条红 —— 原文与画面必须分开存')
  toggles.type = true
  await controller.run()
  assert.equal(calls.length, 1)
  assert.equal(painted().length, 1, '重新勾选也必须能把缓存里那条原文再画出来')
})

test('11 inlayHint：编辑换了修订 ⇒ 重新问，旧锚点先跟着走而不是留在错位置', async () => {
  const { calls, controller, editor, painted } = inlayHarness('int x = value();')
  await controller.run()
  assert.equal(calls.length, 1)
  assert.deepEqual(painted().map(entry => entry.from), [5])
  editor.edit({ from: 0, insert: 'final ' })         // 只有编辑，没有新的权威结果
  assert.deepEqual(painted().map(entry => entry.from), [11], '提示停在编辑前的偏移上')
  await controller.run()
  assert.equal(calls.length, 2, '内容变了还端着旧修订的答案 —— 上游那时 `getHighlightings` 必然排一次重取（LspHighlightingCache.kt:68-71）')
})

test('12 inlayHint：在途那一拍第二次调度不再补一发（同一修订的去重闸）', async () => {
  const gate = deferred()
  const { calls, controller, painted } = inlayHarness('int x = value();', [() => gate.promise])
  const first = controller.run()
  const second = controller.run()
  await Promise.resolve()
  assert.equal(calls.length, 1, '同一修订的请求在飞时又发了一次（`LspHighlightingCache.kt:95-102` 的那道闸）')
  gate.resolve({ available: true, hints: [{ line: 0, character: 5, label: ': int', kind: 1 }] })
  await Promise.all([first, second])
  assert.equal(calls.length, 1)
  assert.equal(painted().length, 1, '去重之后必须由在途那一条把画面落地，不然这一族永远不出现')
})

test('13 inlayHint：答案回来时文档又变了 ⇒ 整份不收，下一拍重新问', async () => {
  const gate = deferred()
  const { calls, controller, editor } = inlayHarness('int x = value();', [() => gate.promise])
  const first = controller.run()
  await Promise.resolve()
  editor.edit({ from: 0, insert: 'zz' })             // 在飞期间改了内容
  gate.resolve({ available: true, hints: [{ line: 0, character: 1, label: ': int', kind: 1 }] })
  await first
  assert.equal(inlayHintCache.snapshotStamp('src/Alpha.java'), null, '旧修订的答案被当成当前结果收进了快照')
  await controller.run()
  assert.equal(calls.length, 2, '被丢掉那一发之后必须能重新问（去重闸要释放，否则这一族永远不再问）')
})

test('14 inlayHint：服务器显式拒过 ⇒ 撤掉已画的并且第二次一次都不发', async () => {
  // (a) 第一次就被拒：画不出东西，也绝不问第二次。
  const rejected = inlayHarness('int x = value();', [() => { throw declined() }])
  await rejected.controller.run()
  assert.equal(rejected.calls.length, 1, '第一次必须真的发出去（不然是靠猜而不是靠回包记账）')
  await rejected.controller.run()
  assert.equal(rejected.calls.length, 1, '宿主回过 LSP_UNSUPPORTED 之后又发了第二次')
  assert.deepEqual(rejected.painted(), [])
  // (b) 先画上了，后来（换了修订、真的又问了一次）被拒 ⇒ 旧提示必须撤掉。
  //     上一段把 java 那台服务器的 inlayHint 记成"被拒过"了，这里换一台（= 语言服务重启）再验一遍。
  lspFileFeatures.clearCache()
  const { calls, controller, editor, painted } = inlayHarness('int x = value();',
    [() => ({ available: true, hints: [{ line: 0, character: 5, label: ': int', kind: 1 }] }), () => { throw declined() }])
  await controller.run()
  assert.equal(painted().length, 1)
  editor.edit({ from: 0, insert: 'final ' })         // 修订一变，缓存必然放行一次真正的请求
  await controller.run()
  assert.equal(calls.length, 2, '被拒的那一次是该问出来的（修订变了却没重问 = 缓存挡错了方向）')
  assert.deepEqual(painted(), [], '这条能力已被确定拒掉，屏幕上还留着旧提示')
  await controller.run()
  assert.equal(calls.length, 2, '记下拒绝之后仍再问')
})

test('15 inlayHint：缓存按文件分格，A 文件的答案不会画到 B 文件上', async () => {
  const a = inlayHarness('int a = 1;',
    [() => ({ available: true, hints: [{ line: 0, character: 3, label: ': A', kind: 1 }] })],
    { path: 'src/A.java' })
  await a.controller.run()
  assert.equal(a.calls.length, 1)
  assert.deepEqual(a.painted().map(entry => [entry.from, entry.text]), [[3, ': A']])
  const b = inlayHarness('int bbbb = 2;',
    [() => ({ available: true, hints: [{ line: 0, character: 8, label: ': B', kind: 1 }] })],
    { path: 'src/B.java' })
  await b.controller.run()
  assert.equal(b.calls.length, 1, '换文件必须重新问（上游按 file 存快照，`LspHighlightingCache.kt:38`）')
  assert.deepEqual(b.painted().map(entry => [entry.from, entry.text]), [[8, ': B']], 'B 的画面里混进了 A 的条目')
})

test('16 inlayHint：缓存参与整批作废', async () => {
  const { calls, controller } = inlayHarness('int x = value();')
  await controller.run()
  await controller.run()
  assert.equal(calls.length, 1)
  clearAllLspCaches()
  await controller.run()
  assert.equal(calls.length, 2, '语言服务重启 / workspace/inlayHint/refresh 之后仍复用旧快照')
})

// —————————————————————————— ⑦ 接线与注册表（形状钉死，防止"写了没接"）

test('17 接线：两条链都是先问缓存再发请求，且用的是同一份 matches/状态机', () => {
  const symbol = readFileSync('src/editorSymbolHighlight.ts', 'utf8')
  assert.match(symbol, /from '\.\/lspPerFileCache\.ts'/, 'documentHighlight 没用那份单槽缓存底座')
  assert.match(symbol, /documentHighlightHit/, '没复用 `src/lspHighlightingCache.ts` 里那条 matches 规则')
  assert.ok(symbol.indexOf('getOrCompute(') < symbol.indexOf("'lsp.request'"), '查缓存必须发生在发请求之前')
  assert.match(symbol, /import \{ LspPerFileCache \}/)
  const inlay = readFileSync('src/editorInlayHints.ts', 'utf8')
  assert.match(inlay, /from '\.\/lspHighlightingCache\.ts'/, 'inlayHint 没用那份按文件快照状态机')
  assert.ok(inlay.indexOf('pullPlan(') < inlay.indexOf("'lsp.request'"), '问缓存必须发生在发请求之前')
  assert.match(inlay, /inlayHintCache\.acceptFull\(path, revision, semanticRevisionOf\(target\.state\.doc\), items\)/,
    '接受闸门必须是「请求时的修订 vs 回包时的修订」这一对比（上游 responseReceived 的判定）')
  assert.match(inlay, /const DEBOUNCE_MS = LOW_PRIORITY_QUIESCENCE_MS/, '这一族用上游那一档 300ms，不是自己另写一个数')
})

test('18 按特性注册表：作废走注册表扇出，而不是各点各清', () => {
  const semantic = readFileSync('src/editorSemanticField.ts', 'utf8')
  assert.match(semantic, /invalidatePulledResults\(transaction\.startState\.doc\)/,
    '文档一变只清自己那一份缓存 = 注册表没有扇出点')
  assert.doesNotMatch(semantic, /semanticHighlightingCache\.invalidate\(/,
    '绕开注册表直接点单份缓存的写法又回来了（上游是从 allCaches 扇出去的，LspHighlightingCacheRegistry.kt:54-56）')
})

test('19 反向对照：缓存挡不住"内容真的变了"—— 改一个字就必须重新问（两条链各自）', async () => {
  const symbol = symbolHarness('class Alpha { void run() {} }', 7)
  await symbol.controller.run()
  symbol.editor.edit({ from: 6, insert: 'X' })
  symbol.editor.moveCaret(8)
  await symbol.controller.run()
  assert.equal(symbol.calls.length, 2, 'documentHighlight 把旧修订的区间当成了新内容的结果')

  const inlay = inlayHarness('int x = value();')
  await inlay.controller.run()
  inlay.editor.edit({ from: 5, insert: 'Y' })
  await inlay.controller.run()
  assert.equal(inlay.calls.length, 2, 'inlayHint 把旧修订的答案当成了新内容的结果')
})

/** 一个能被测试手动了结的 promise（模拟慢服务器）。 */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((innerResolve, innerReject) => { resolve = innerResolve; reject = innerReject })
  return { promise, resolve, reject }
}
