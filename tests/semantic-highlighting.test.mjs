// 语义高亮的「按特性注册表 + 缓存」判据（族 `ls/highlighting`，判词 ③）。
//   · 一一对应：客户端声明表（`src/semanticTokens.ts` 的 SEMANTIC_TOKEN_TYPES/MODIFIERS）
//     ↔ 渲染注册表（`src/semanticHighlighting.ts`）↔ 颜色表（`src/editorSemanticColors.ts`）。
//     上游的口径是**同一张表**（`platform/lsp/src/api/LspClientCapabilities.kt:193`
//     `tokenTypes = semanticTokensSupport.tokenTypes`），本仓跨了 C++/TS 只能机检。
//   · 未注册不高亮：`platform/lsp/src/api/customization/LspSemanticTokensCustomizer.kt:121`
//     的 `else -> null`；索引越界那条整条丢（`platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt:102-105`）。
//   · capability 没声明就不请求：`LspSemanticTokensCache.kt:29-36` 的 `isSupportedForFile`。
//   · 文档修订变了缓存失效并重新取：`LspSemanticTokensCache.kt:40-41,51-54`（请求前后比对
//     `document.modificationStamp`，不一致连解码都不做）。
//   · 编辑后区间跟着走、被吃掉的丢掉：`LspCachedHighlighting.kt:38-80` 的四条分支
//     （本仓 `src/lspHighlightingCache.ts:8-12` 记着那四条）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'

const {
  SEMANTIC_MODIFIER_RENDER_KEYS, SEMANTIC_SNAPSHOT_LIMIT, SEMANTIC_TOKEN_RENDER_KEYS, SemanticHighlightingCache,
  capabilityRenderDrift, highlightingFeatureIds, invalidatePulledResults, registerHighlightingFeature,
  semanticHighlightClasses, semanticHighlightingCache, semanticModifierRegistered, semanticRevisionOf,
  semanticTokenTypeRegistered,
} = await import('../src/semanticHighlighting.ts')

const {
  buildSemanticDecorations, sameSemanticTokens, semanticMarksOf, semanticTokensField, semanticTokensState, setSemanticTokens,
} = await import('../src/editorSemanticField.ts')

const { semanticHighlightStyles } = await import('../src/editorSemanticColors.ts')
const { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES, decodeSemanticTokens } = await import('../src/semanticTokens.ts')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const token = (line, startChar, length, type, modifiers = []) => ({ line, startChar, length, type, modifiers })

/** 读某一层的实际装饰（文本 + 类名），按位置升序。 */
function decorated(state) {
  const out = []
  state.field(semanticTokensState).decorations.between(0, state.doc.length, (from, to, decoration) => {
    out.push({ text: state.doc.sliceString(from, to), cls: decoration.spec.class })
  })
  return out
}

function classesOf(state, tokens) {
  return decorated(EditorState.create({ doc: state.doc.toString(), extensions: [semanticTokensField] })
    .update({ effects: setSemanticTokens.of(tokens) }).state)
}

// —————————————————————————— ① 声明 ↔ 注册 ↔ 颜色：一一对应

test('声明表、渲染注册表、颜色表三个方向的漂移恒为空', () => {
  const drift = capabilityRenderDrift()
  assert.deepEqual(drift.declaredWithoutRegistryEntry, [], '每一条声明过的类型/修饰符都要有处置（上游 else -> null 也要求显式写 null）')
  assert.deepEqual(drift.registryKeyWithoutColorRule, [], '注册表指向的颜色规则必须真存在，否则这一层画不出东西')
  assert.deepEqual(drift.colorRuleNobodyDeclares, [], '颜色表里不许留没人声明的死规则')
  // 注册表既不多也不少：键集必须与两张声明表逐一对上。
  assert.deepEqual(Object.keys(SEMANTIC_TOKEN_RENDER_KEYS).sort(), [...SEMANTIC_TOKEN_TYPES].sort())
  assert.deepEqual(Object.keys(SEMANTIC_MODIFIER_RENDER_KEYS).sort(), [...SEMANTIC_TOKEN_MODIFIERS].sort())
})

test('keyword 落得下一条真有颜色的规则（本仓漂过的那次：声明是 keyword、颜色表写的是 key）', () => {
  // 上游 `LspSemanticTokensCustomizer.kt:113` 是 Keyword → KEYWORD；
  // 改动前本仓发的是 `cm-sem-keyword`，而颜色表只有 `.cm-sem-key` ⇒ 服务端发来 keyword 时整层不着色。
  assert.equal(SEMANTIC_TOKEN_RENDER_KEYS.keyword, 'key')
  assert.ok(semanticHighlightStyles[SEMANTIC_TOKEN_RENDER_KEYS.keyword], 'keyword 必须映射到颜色表里存在的那条规则')
  assert.equal(semanticHighlightClasses(token(0, 0, 5, 'keyword')), 'cm-sem-key')
  assert.equal(semanticTokenTypeRegistered('keyword'), true)
})

// —————————————————————————— ② token 类型未注册不高亮

test('没注册的类型不高亮，也不会只把修饰符画上去', () => {
  // 服务端 legend 自己加的类型（本仓没声明、没注册）⇒ 整条为空：上游对认不出的类型是
  // `continue` 掉整条（`LspSemanticTokensCache.kt:102-105`），不是「类型没有、删除线照画」。
  assert.equal(semanticHighlightClasses(token(0, 0, 3, 'templateExpression', ['deprecated'])), '')
  assert.equal(semanticTokenTypeRegistered('templateExpression'), false)
  // 索引越界解出来的空类型同理（`src/semanticTokens.ts:104` 的 `types[typeIndex] ?? ''`）。
  assert.equal(semanticHighlightClasses(token(0, 0, 3, '', ['static'])), '')
  // 声明过但注册表显式写 null 的：上游 `:100` Variable → LOCAL_VARIABLE = 默认前景，不额外着色。
  assert.equal(SEMANTIC_TOKEN_RENDER_KEYS.variable, null)
  assert.equal(semanticHighlightClasses(token(0, 0, 3, 'variable', ['readonly'])), '')
  // 修饰符只发注册过的：`declaration`/`definition` 上游不换 key ⇒ 本仓没有视觉处置。
  assert.equal(semanticModifierRegistered('declaration'), false)
  assert.equal(semanticHighlightClasses(token(0, 0, 4, 'method', ['declaration', 'static', 'nope'])), 'cm-sem-method cm-sem-mod-static')
})

test('装饰层只留注册过的类型（未注册的区间根本不出现在 RangeSet 里）', () => {
  const state = EditorState.create({ doc: 'class Main { int x; }' })
  const marks = semanticMarksOf(state, [
    token(0, 0, 5, 'keyword'),
    token(0, 6, 4, 'class'),
    token(0, 13, 3, 'templateExpression', ['deprecated']),
    token(0, 17, 1, 'variable'),
    token(5, 0, 3, 'keyword'), // 行号越界：丢掉而不是把编辑器打挂
  ])
  assert.deepEqual(marks.map(item => [item.from, item.to, item.cls]), [[0, 5, 'cm-sem-key'], [6, 10, 'cm-sem-class']])
  const built = buildSemanticDecorations(state, [token(0, 6, 4, 'class', ['static'])])
  assert.equal(built.size, 1)
})

// —————————————————————————— ③ capability 没声明就不请求

test('能力没声明（或宿主回过 LSP_UNSUPPORTED）时 plan 永远是 unsupported，不发请求', () => {
  const cache = new SemanticHighlightingCache('semanticTokens')
  const doc = {}
  assert.equal(cache.capabilityDeclared(), true, 'semanticTokens 在能力表里登记过 provider')
  assert.equal(cache.plan(doc, 1), 'request')
  cache.noteServerDeclined()
  assert.equal(cache.capabilityDeclared(), false)
  assert.equal(cache.plan(doc, 1), 'unsupported', '服务器声明过不支持 ⇒ 同一个文档也不再发第二次')
  assert.equal(cache.plan({}, 7), 'unsupported')
  // 整族作废（语言服务重启 / 服务端 refresh）⇒ 换了一个新客户端对象，能力要重新问一次。
  cache.clearCache()
  assert.equal(cache.plan(doc, 1), 'request')
  // 没在能力表里登记过的特性：注册表不受理，plan 恒 unsupported（上游那时 isSupportedForFile 直接 false）。
  const ghost = new SemanticHighlightingCache('noSuchHighlightingFeature')
  assert.equal(ghost.capabilityDeclared(), false)
  assert.equal(registerHighlightingFeature(ghost), false, '未声明的特性不许登记进按特性注册表')
  assert.equal(ghost.plan({}, 1), 'unsupported')
  assert.equal(highlightingFeatureIds().includes('noSuchHighlightingFeature'), false)
  assert.ok(highlightingFeatureIds().includes('semanticTokens'), '生产那份必须在自己那张注册表里')
})

// —————————————————————————— ④ 文档修订变了 ⇒ 缓存失效并重新取

test('快照按文档修订命中；修订一变即失效', () => {
  const cache = new SemanticHighlightingCache()
  const first = {}
  const tokens = [token(0, 0, 5, 'keyword')]
  cache.store(first, 10, tokens)
  assert.equal(cache.plan(first, 10), 'cached')
  assert.deepEqual(cache.tokensFor(first, 10), tokens)
  // 文档改了 ⇒ 换了对象、换了修订号：旧答案必须取不到（上游 `:51-54` 连解码都不做）。
  const second = {}
  cache.store(second, 11, tokens)
  assert.equal(cache.plan(second, 11), 'cached')
  assert.equal(cache.tokensFor(first, 11), null, '同一份旧文档配新修订号：不认')
  assert.equal(cache.tokensFor(second, 10), null, '修订号不一致就不给（缓存失效）')
  assert.equal(cache.plan(second, 12), 'request', '修订又前进了 ⇒ 必须重新取')
  cache.invalidate(second)
  assert.equal(cache.tokensFor(second, 11), null)
  assert.equal(cache.size, 1)
  cache.clearCache()
  assert.equal(cache.size, 0, '整族作废（重启/refresh）后一份不留')
})

test('快照有上限，超出后按 FIFO 顶掉最旧的一份（不无界增长）', () => {
  const cache = new SemanticHighlightingCache()
  const docs = []
  for (let index = 0; index < SEMANTIC_SNAPSHOT_LIMIT + 10; index++) {
    const doc = { index }
    docs.push(doc)
    cache.store(doc, index, [])
  }
  assert.equal(cache.size, SEMANTIC_SNAPSHOT_LIMIT)
  assert.equal(cache.tokensFor(docs[0], 0), null, '最旧的那份已被顶掉')
  assert.deepEqual(cache.tokensFor(docs[docs.length - 1], docs.length - 1), [], '最新的一份必须在')
  // 同一份文档重复 store 不算新增（否则上限会把当前文件自己挤掉）。
  const before = cache.size
  cache.store(docs[docs.length - 1], docs.length - 1, [token(0, 0, 1, 'type')])
  assert.equal(cache.size, before)
})

// —————————————————————————— ⑤ 装饰层：缓存 + 编辑后跟着走

test('同一修订重复派发不重建装饰（上游 Unchanged 的「保留内容不重画」）', () => {
  const state = EditorState.create({ doc: 'void run() {}', extensions: [semanticTokensField] })
  const tokens = [token(0, 0, 4, 'type'), token(0, 5, 4, 'function')]
  const once = state.update({ effects: setSemanticTokens.of(tokens) }).state
  const twice = once.update({ effects: setSemanticTokens.of(tokens.slice()) }).state
  assert.equal(twice.field(semanticTokensState).decorations, once.field(semanticTokensState).decorations,
    '同一份文档、同一份结果再派发一次时必须复用那个 DecorationSet')
  assert.deepEqual(decorated(twice).map(item => item.cls), ['cm-sem-type', 'cm-sem-function'])
  // 内容真变了（少了一条）就绝不复用 —— 这是反向的一半。
  assert.equal(sameSemanticTokens(tokens, tokens.slice(1)), false)
  const third = twice.update({ effects: setSemanticTokens.of(tokens.slice(1)) }).state
  assert.notEqual(third.field(semanticTokensState).decorations, twice.field(semanticTokensState).decorations)
})

test('编辑后区间跟着编辑走、旧修订的快照作废、新权威结果整份覆盖', () => {
  const state = EditorState.create({ doc: 'class Main {}', extensions: [semanticTokensField] })
  const withTokens = state.update({ effects: setSemanticTokens.of([token(0, 0, 5, 'keyword'), token(0, 6, 4, 'class')]) }).state
  assert.deepEqual(decorated(withTokens), [
    { text: 'class', cls: 'cm-sem-key' },
    { text: 'Main', cls: 'cm-sem-class' },
  ])
  const oldDoc = withTokens.doc
  assert.equal(semanticHighlightingCache.tokensFor(oldDoc, semanticRevisionOf(oldDoc)) !== null, true, '取到结果后快照在该修订上')

  // 在最前面插两个字符：区间整体右移（上游 `applyPendingEdits` 的「编辑在区间之前 ⇒ 整体右移」）。
  const edited = withTokens.update({ changes: { from: 0, to: 0, insert: '//' } }).state
  assert.deepEqual(decorated(edited), [
    { text: 'class', cls: 'cm-sem-key' },
    { text: 'Main', cls: 'cm-sem-class' },
  ], '颜色跟着代码走，不闪断')
  assert.equal(semanticHighlightingCache.tokensFor(oldDoc, semanticRevisionOf(oldDoc)), null,
    '文档一变，旧修订的快照必须作废（下一次读只能重新取）')
  assert.equal(semanticHighlightingCache.plan(edited.doc, semanticRevisionOf(edited.doc)), 'request')
  assert.notEqual(edited.field(semanticTokensState).revision, semanticRevisionOf(oldDoc))

  // 编辑吃掉了整个 token（删掉 `class` 这个词）：那条区间映射后零宽 ⇒ 丢掉，不画在错位置。
  const eaten = withTokens.update({ changes: { from: 0, to: 5, insert: '' } }).state
  assert.deepEqual(decorated(eaten).map(item => item.text), ['Main'], '被删掉的那条不再出现')

  // 权威结果回来：整份覆盖（不再是从旧结果平移出来的那份）。
  const fresh = [token(0, 2, 5, 'keyword')]
  const refreshed = edited.update({ effects: setSemanticTokens.of(fresh) }).state
  assert.deepEqual(decorated(refreshed), [{ text: 'class', cls: 'cm-sem-key' }])
  assert.equal(refreshed.field(semanticTokensState).marks.length, 1)
})

test('跨修订不串档：编辑器不会把上一份文档的 token 当成当前文档的', () => {
  const state = EditorState.create({ doc: 'int a;', extensions: [semanticTokensField] })
  const tokens = [token(0, 0, 3, 'type')]
  const built = state.update({ effects: setSemanticTokens.of(tokens) }).state
  const edited = built.update({ changes: { from: 0, insert: 'x' } }).state
  // 平移后的那一层仍画着旧结果；但**缓存**已经不认这份修订了 —— 拿旧 token 去派发必然 miss。
  assert.equal(semanticHighlightingCache.tokensFor(edited.doc, semanticRevisionOf(edited.doc)), null)
  const reused = edited.update({ effects: setSemanticTokens.of([token(0, 1, 3, 'type')]) }).state
  assert.notEqual(reused.field(semanticTokensState).decorations, built.field(semanticTokensState).decorations,
    '修订不同就必须重建，不能复用旧文档上算出来的偏移')
  assert.deepEqual(decorated(reused).map(item => item.text), ['int'])
})

test('接线：装饰层走的是注册表，不是裸 token 名', () => {
  const source = readFileSync(join(root, 'src/editorSemanticField.ts'), 'utf8')
  assert.match(source, /from '\.\/semanticHighlighting\.ts'/, 'decoration 层必须用注册表给类名')
  assert.doesNotMatch(source, /semanticTokenClass\(/, '不许退回「拿到什么名字就发什么类名」')
  const module_ = readFileSync(join(root, 'src/semanticHighlighting.ts'), 'utf8')
  assert.match(module_, /lspFeatureRow\(/, 'capability 那道闸必须读能力表，不是自己另写一份')
})

// ——————————————————— 2026-10-06 hlregistry：注册表扇出要按 supportsPull 过滤

test('注册表的作废扇出只给拉取族（上游 LspHighlightingCacheRegistry.kt:54-56），推的那一条跳过', () => {
  // 上游那一条是 `allCaches.forEach { if (it.supportsPull) it.forceFullRepull(file) }`：
  // 推族（`LspPublishDiagnosticsCache.kt:31` 的 `supportsPull = false`）的陈旧由服务端**重发**来收，
  // 客户端替它作废没有意义。本仓原来无条件扇给表里每一条，本轮补上这一问。
  const doc = {}
  const base = invalidatePulledResults(doc)
  assert.ok(base >= 1, '生产那份（semanticTokens）必须在表里并被作废到')

  const touched = []
  const probe = (id, supportsPull) => ({
    featureId: id,
    supportsPull,
    invalidate: () => { touched.push(id) },
    clearCache: () => { touched.push(`${id}:clear`) },
  })
  assert.equal(registerHighlightingFeature(probe('documentLink', false)), true, 'documentLink 在能力表里登记过')
  assert.equal(invalidatePulledResults(doc), base, '推的那一条不参与 ⇒ 计数不变')
  assert.deepEqual(touched, [], '推的那一条的 invalidate 一次都不该被调到')

  assert.equal(registerHighlightingFeature(probe('foldingRange', true)), true)
  assert.equal(invalidatePulledResults(doc), base + 1, '拉取族照常参与扇出')
  assert.deepEqual(touched, ['foldingRange'])

  // 没在能力表里登记过的特性仍然进不来（既有那条判据的形状不变，这里只补结构类型放宽后的对照）。
  assert.equal(registerHighlightingFeature(probe('noSuchHighlightingFeature', true)), false)
  assert.equal(highlightingFeatureIds().includes('noSuchHighlightingFeature'), false)
})
