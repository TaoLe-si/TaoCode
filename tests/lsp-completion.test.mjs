// Java 语义补全的唯一实现（src/lspCompletion.ts）在这里被直接驱动 —— 不是模型，
// 也不是 CodeEditor.vue 里的一段摘抄。红灯阶段这些用例打在组件真实源码上。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { createLspCompletion } from '../src/lspCompletion.ts'
import { mergeCompletionResults } from '../src/completionMerge.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function editor(doc, head = doc.length) {
  const view = { state: EditorState.create({ doc, selection: { anchor: head } }) }
  view.dispatch = spec => { view.state = view.state.update(spec).state }
  return view
}

async function fixture(doc, send, head = doc.length) {
  const view = editor(doc, head)
  const errors = []
  const calls = []
  const request = async (method, params) => { calls.push({ method, params }); return send(method, params) }
  const source = createLspCompletion({ enabled: () => true, path: () => 'src/Main.java', view: () => view,
    request, sync: state => request('lsp.change', { path: 'src/Main.java', text: state.sliceDoc() }),
    reportError: message => errors.push(message) })
  const context = new CompletionContext(view.state, head, false)
  return { source, context, view, calls, errors }
}

const item = { label: 'println', kind: 'method', raw: { label: 'println', data: { id: 1 } } }

test('typing completion synchronizes the current buffer before requesting semantic items', async () => {
  let synced = 'System.out.'
  const h = await fixture('System.out.pri', async (method, params) => {
    if (method === 'lsp.change') { synced = params.text; return { ok: true } }
    return { available: true, items: synced === 'System.out.pri' ? [item] : [] }
  })
  const result = await h.source(h.context)
  assert.equal(result?.options[0]?.label, 'println')
  assert.deepEqual(h.calls.map(call => call.method), ['lsp.change', 'lsp.request'])
  assert.equal(h.calls[1].params.character, 14)
})

test('acceptance honors server textEdit replacement range, not just the typed prefix', async () => {
  const replacement = { ...item, raw: { label: 'println', textEdit: { range: {
    start: { line: 0, character: 11 }, end: { line: 0, character: 15 },
  }, newText: 'println()' } } }
  const h = await fixture('System.out.prnt', async (method, params) => params.kind === 'completionItemResolve'
    ? { available: false, supported: false } : { available: true, items: [replacement] }, 13)
  const result = await h.source(h.context)
  await result.options[0].apply(h.view, { label: result.options[0].label }, result.from, 13)
  assert.equal(h.view.state.sliceDoc(), 'System.out.println()')
})

test('fast Enter resolves auto-import edits and maps the caret through the import', async () => {
  const h = await fixture('class A { Lis }', async (method, params) => params.kind === 'completionItemResolve'
    ? { available: true, supported: true, additionalTextEdits: [{ text: 'import java.util.List;\n', startLine: 0, startChar: 0, endLine: 0, endChar: 0 }] }
    : { available: true, items: [{ label: 'List', kind: 'class', raw: { label: 'List', data: { id: 1 } } }] }, 13)
  const result = await h.source(h.context)
  await result.options[0].apply(h.view, { label: result.options[0].label }, result.from, 13)
  assert.equal(h.view.state.sliceDoc(), 'import java.util.List;\nclass A { List }')
  assert.equal(h.view.state.selection.main.head, 'import java.util.List;\nclass A { List'.length)
})

test('completion failure is diagnosable rather than silently becoming no suggestions', async () => {
  const h = await fixture('System.', async () => { throw new Error('Language server is not running') })
  assert.equal(await h.source(h.context), null)
  assert.match(h.errors.join('\n'), /Language server is not running/)
})

test('a superseded request is silent, not a per-keystroke toast', async () => {
  const h = await fixture('System.', async () => { throw new Error('CANCELLED') })
  assert.equal(await h.source(h.context), null)
  assert.deepEqual(h.errors, [])
})

test('native and fake server use the real completionItem/resolve protocol method', () => {
  // 该请求从 Session::semantic 的 kind 链搬到了 native/lsp_session_kinds.cpp（逐字搬运）
  assert.ok(read('native/lsp_session_kinds.cpp').includes('host->request("completionItem/resolve"'))
  assert.ok(!read('native/lsp_fake_server_requests.cpp').includes('method == "textDocument/completionItem/resolve"'))
})

test('enabling code insight late still hands the server the current buffer', () => {
  // Typed while the server was still initializing: those edits never reached
  // native, so the deferred didOpen carries the text from open time. The moment
  // `lsp-enabled` flips, the editor must push what is on screen.
  const editor = read('src/components/CodeEditor.vue')
  const watch = editor.slice(editor.indexOf('watch(() => props.lspEnabled'), editor.indexOf('watch(() => lspDiagnostics'))
  assert.match(watch, /scheduleLspChange\(\)/)
  // The completion popup moved out of the component into src/completionUi.ts, so the
  // assertion follows the real assembly: the editor registers ONE source that merges both
  // contributors, and that source has to reach `autocompletion({ override })` — the only
  // place CodeMirror reads sources from.
  assert.match(editor, /completionUi\(\[mergeCompletion\]\)/, 'override 是"第一个非空即止"，两个源并列排 = 模板独占点位')
  assert.match(editor, /mergeCompletionResults\(await lspCompletion\(context\), templates\)/)
  const ui = read('src/completionUi.ts')
  assert.match(ui, /autocompletion\(\{\s*override: sources/)
  assert.match(ui, /export function completionUi\(sources: CompletionSource\[\]\)/)
})

test('点位上的成员补全不会被后置模板吃掉', async () => {
  // 用户实测的现场：`text.` 之后只剩模板候选。这里让真实源跑完，再按编辑器的合流规则并模板。
  const doc = 'class A { int m() { String text = "x"; return text.'
  const h = await fixture(doc, async (method, params) =>
    params.kind === 'completion' ? { available: true, items: [{ label: 'length()', kind: 'method' }, { label: 'toString()', kind: 'method' }] } : { available: true })
  const semantic = await h.source(h.context)
  assert.ok(semantic && semantic.options.length === 2, '语义候选没回来，后面合流无从谈起')
  const templates = { from: doc.length, options: [{ label: 'var' }, { label: 'length()' }] }
  const merged = mergeCompletionResults(semantic, templates)
  assert.deepEqual(merged.options.map(option => option.label), ['length()', 'toString()', 'var'],
    '语义在前、模板在后，同名模板被语义顶掉')
  assert.equal(merged.from, Math.min(semantic.from, templates.from))
  // 单边为空时原样返回：语义为空（服务器没就绪/无候选）就只剩模板，模板为空就只剩语义。
  assert.equal(mergeCompletionResults(null, templates), templates)
  assert.equal(mergeCompletionResults(semantic, null), semantic)
  assert.equal(mergeCompletionResults(null, null), null)
})

test('same-label overloads resolve by identity and never reuse another result import', async () => {
  const seen = []
  const h = await fixture('Lis', async (method, params) => {
    if (params.kind === 'completionItemResolve') {
      seen.push(params.raw.data.id)
      return { available: true, supported: true, apply: `List${params.raw.data.id}` }
    }
    return { available: true, items: [1, 2].map(id => ({ label: 'List', kind: 'class', raw: { label: 'List', data: { id } } })) }
  })
  const result = await h.source(h.context)
  await result.options[1].apply(h.view, { label: result.options[1].label }, result.from, 3)
  assert.deepEqual(seen, [2])
  assert.equal(h.view.state.sliceDoc(), 'List2')
})

test('discard a delayed result after the user edits the document', async () => {
  let reply
  const h = await fixture('System.', async (method, params) => {
    if (method === 'lsp.change') return { ok: true }
    return new Promise(resolve => { reply = resolve })
  })
  const pending = h.source(h.context)
  await new Promise(resolve => setImmediate(resolve))
  h.view.dispatch({ changes: { from: 7, insert: 'o' } })
  reply({ available: true, items: [item] })
  assert.equal(await pending, null)
})

test('late resolve must not insert into a changed document', async () => {
  // 条目label要**匹配打出来的前缀**（'Lis'）：表里的过滤按上游 `CamelHumpMatcher.prefixMatches`
  // （`platform/analysis-impl/src/com/intellij/codeInsight/completion/impl/CamelHumpMatcher.java:80-119`）
  // 在本仓做（`src/completionCamelHump.ts`），`println` 在这种点位根本进不了表。
  let reply
  const matching = { label: 'List', kind: 'class', raw: { label: 'List', data: { id: 1 } } }
  const h = await fixture('Lis', async (method, params) => params.kind === 'completionItemResolve'
    ? new Promise(resolve => { reply = resolve }) : { available: true, items: [matching] })
  const result = await h.source(h.context)
  const pending = result.options[0].apply(h.view, { label: result.options[0].label }, result.from, 3)
  h.view.dispatch({ changes: { from: 3, insert: 't' } })
  reply({ available: true, supported: true, apply: 'wrong' })
  await pending
  assert.equal(h.view.state.sliceDoc(), 'List')
})

test('a member dot and Unicode identifier both query the server, never a keyword fallback', async () => {
  for (const text of ['System.', '变量.方']) {
    const h = await fixture(text, async () => ({ available: true, items: [item] }))
    const result = await h.source(h.context)
    assert.equal(result.from, text === 'System.' ? 7 : 3)
    assert.equal(h.calls[1].params.kind, 'completion')
    assert.equal(h.calls[1].params.character, text.length)
  }
})

test('服务端一条都没回时，本地贡献者（文档词）接上而不是弹层关掉', async () => {
  const doc = 'const value = 1\nval'
  const h = await fixture(doc, async (method, params) =>
    params.kind === 'completion' ? { available: false } : { available: true })
  const result = await h.source(h.context)
  assert.ok(result, '服务端空结果不该把本地词补全一起吞掉')
  assert.equal(result.from, doc.length - 3)
  assert.deepEqual(result.options.map(option => option.label), ['value'])
  await result.options[0].apply(h.view, { label: 'value' }, result.from, doc.length)
  assert.equal(h.view.state.sliceDoc(), 'const value = 1\nvalue')
})

test('服务端有条目时仍以服务端为准，不掺本地词', async () => {
  // 服务端那条的 label 前缀命中打出来的 `val`（表内过滤按上游 CamelHumpMatcher，见上一条用例的注），
  // 文档词 `value` 同样命中 —— 于是"只有一行"这个断言量的就是**混不混本地词**，不是过不过滤。
  const doc = 'const value = 1\nval'
  const serverItem = { label: 'validate', kind: 'method', raw: { label: 'validate', data: { id: 1 } } }
  const h = await fixture(doc, async () => ({ available: true, items: [serverItem] }))
  const result = await h.source(h.context)
  assert.deepEqual(result.options.map(option => option.label), ['validate'])
})
