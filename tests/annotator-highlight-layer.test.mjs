// 注解器高亮层的判据 —— `src/annotatorHighlightLayer.ts`（调度）+ `src/annotatorHighlights.ts`（规则）。
//
// 上游依据：`AnnotatorRunner.runAnnotators`（`AnnotatorRunner.java:96-110,132-140`）的按语言分派、
// `GeneralHighlightingPass.java:79-96,112-117` 的「首次整份 / 之后只算脏行」、
// `MainHighlightingPassFactory` 的「同一内容重复触发整拍跳过」、
// `LspHighlightingApplier.kt:76-80,88-98,102` 的代数去重与 40ms 去抖、`:107` 的 stamp 复核。
//
// 宿主接线（CodeEditor.vue）的源码锚点也在这里钉 —— 这一层是上一轮留下的零消费方模块。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import {
  ANNOTATOR_DEBOUNCE_MS, createAnnotatorHighlightLayer,
} from '../src/annotatorHighlightLayer.ts'
import {
  annotatorAnnotationField, diagnosticKind, runAnnotators, UNUSED_SYMBOL_DISPLAY_NAME, webUrlsIn,
} from '../src/annotatorHighlights.ts'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

// `schedule()` 走的是 `window.setTimeout`（浏览器口径）；node 下补一个同形状的窗。
globalThis.window ??= { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) }
const settle = () => new Promise(resolve => setTimeout(resolve, ANNOTATOR_DEBOUNCE_MS + 15))

/** 一个只够这一层用的假视图：真 EditorState（带这一层的扩展）+ 可替换的 state。 */
function makeLayer({ doc, diagnostics = [], commentStyle = null, enabled = () => true }) {
  // state 要**带扩展**建，否则 `state.field(annotatorAnnotationField)` 抛 "Field is not present"。
  let state = null
  const view = {
    get state() { return state },
    dispatch(spec) { state = state.update(spec).state },
  }
  const layer = createAnnotatorHighlightLayer({
    enabled,
    path: () => 'src/a.ts',
    language: () => 'javascript',
    view: () => view,
    diagnostics: () => diagnostics,
    commentStyle: () => commentStyle,
    dumb: () => false,
  })
  state = EditorState.create({ doc, extensions: layer.extension })
  return { layer, annotations: () => state.field(annotatorAnnotationField) }
}

test('扩展自带注解字段 + 三档外观（缺一样就会出现「有 class 没样式」）', () => {
  const { layer } = makeLayer({ doc: 'x' })
  assert.ok(Array.isArray(layer.extension))
  assert.ok(layer.extension.includes(annotatorAnnotationField), '字段与主题必须一起挂')
  assert.equal(layer.extension.length, 2)
})

test('首见该文件 = 整份重算：诊断带 tags=[1] 的未使用符号被画出来', async () => {
  const { layer, annotations } = makeLayer({
    doc: 'let unusedOne = 1\n',
    diagnostics: [{ line: 0, character: 4, endLine: 0, endCharacter: 12, severity: 2, message: 'never used', tags: [1] }],
  })
  layer.schedule()
  await settle()
  const marks = annotations()
  assert.equal(marks.length, 1)
  assert.equal(marks[0].kind, 'unusedSymbol')
  assert.equal(marks[0].description, UNUSED_SYMBOL_DISPLAY_NAME)
  assert.deepEqual([marks[0].from, marks[0].to], [4, 12])
})

test('同一内容重复触发 → 整拍跳过，已画的留着（MainHighlightingPassFactory）', async () => {
  // 诊断必须带 end：没有 end 时注解的 from === to，registry 按 `to <= from` 丢掉零宽标记
  // （零宽的 mark 画不出东西；波浪线那一层由 src/editorDiagnosticMarkers 负责）。
  const diagnostics = [{ line: 0, character: 4, endLine: 0, endCharacter: 12, severity: 2, message: 'never used', tags: [1] }]
  const { layer, annotations } = makeLayer({ doc: 'let unusedOne = 1\n', diagnostics })
  layer.schedule()
  await settle()
  const first = annotations().length
  assert.equal(first, 1)
  layer.schedule()
  await settle()
  assert.equal(annotations().length, first, '没变内容就不该重画成空')
})

test('clear() 撤掉已画的：留着就是一份没人再更新的旧标记', async () => {
  const { layer, annotations } = makeLayer({
    doc: 'let unusedOne = 1\n',
    diagnostics: [{ line: 0, character: 4, endLine: 0, endCharacter: 12, severity: 2, message: 'never used', tags: [1] }],
  })
  layer.schedule()
  await settle()
  assert.equal(annotations().length, 1)
  layer.clear()
  assert.equal(annotations().length, 0)
})

test('enabled 为假时既不排期也不画（关掉语言服务/大文件模式）', async () => {
  const { layer, annotations } = makeLayer({
    doc: 'let unusedOne = 1\n',
    diagnostics: [{ line: 0, character: 4, endLine: 0, endCharacter: 12, severity: 2, message: 'never used', tags: [1] }],
    enabled: () => false,
  })
  layer.schedule()
  await settle()
  assert.equal(annotations().length, 0)
})

test('diagnosticKind：Unnecessary→未使用、Deprecated→已废弃、其余不产文字属性注解', () => {
  assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '', tags: [1] }), 'unusedSymbol')
  assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '', tags: [2] }), 'deprecated')
  // Unnecessary 优先（上游 toHighlightInfoType 也是先判 Unnecessary）。
  assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '', tags: [1, 2] }), 'unusedSymbol')
  assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '', tags: [3] }), null)
  assert.equal(diagnosticKind({ line: 0, character: 0, severity: 2, message: '' }), null)
})

test('网页链接注解器只在注释里找，字符串字面量里的不是链接（HyperlinkAnnotator.isWebReferenceWorthy）', () => {
  const text = '// see https://example.com/a\nconst u = "https://example.com/b"\n'
  const out = runAnnotators({
    path: 'src/a.ts', language: 'javascript', text,
    diagnostics: [], commentStyle: { line: '//' },
  })
  const links = out.filter(annotation => annotation.kind === 'hyperlink')
  assert.equal(links.length, 1)
  assert.equal(links[0].target, 'https://example.com/a')
  // 裸词不带 scheme 就不是链接。
  assert.deepEqual(webUrlsIn('TODO: fix TBD'), [])
})

test('接线：CodeEditor.vue 真的挂了这一层（不是留下零消费方模块）', () => {
  const editor = read('src/components/CodeEditor.vue')
  assert.match(editor, /import \{ createAnnotatorHighlightLayer \} from '\.\.\/annotatorHighlightLayer'/)
  assert.match(editor, /const annotatorLayer = createAnnotatorHighlightLayer\(\{/)
  // 扩展挂进编辑器 + 四条生命周期（编辑/换文件/诊断变化排期，关语言服务 clear，卸载 dispose）。
  assert.match(editor, /annotatorLayer\.extension,/)
  assert.ok((editor.match(/annotatorLayer\.schedule\(\)/g) ?? []).length >= 3, '排期点：挂载 / 编辑 / 换文件 / 诊断变化')
  assert.match(editor, /annotatorLayer\.clear\(\)/)
  assert.match(editor, /annotatorLayer\.dispose\(\)/)
})
