// 预览面板的**行内命中高亮**（上游 `UsagePreviewPanel.kt:503-546`：给命中区间加
// `EditorColors.SEARCH_RESULT_ATTRIBUTES` 的 EXACT_RANGE 高亮；标题与窗口算法见
// `tests/search-preview.test.mjs`）。
//
// 判据分两层：① `previewSegments` 的纯逻辑（用与查找栏同一套 `collectSearchMatches` 匹配语义，
// 所以三档选项的行为直接对着 `src/editorSearch.ts` 的语义写）；② 接线（面板要用**编译后的**
// 查询词、要画 `<mark>`、样式要盖掉浏览器默认底色）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { previewSegments, PREVIEW_HITS_PER_LINE } from '../src/searchPreview.ts'
import { DEFAULT_SEARCH_OPTIONS } from '../src/editorSearch.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const opts = patch => ({ ...DEFAULT_SEARCH_OPTIONS, ...patch })
/** 把段拼回原文，顺带数命中段。 */
const join = segments => segments.map(segment => segment.text).join('')
const hits = segments => segments.filter(segment => segment.hit).map(segment => segment.text)

test('without a query the whole line is one plain segment', () => {
  assert.deepEqual(previewSegments('const value = 1', '', opts()), [{ text: 'const value = 1', hit: false }])
  // 空行没有段可画（`<pre>` 里那一行仍然是空行，由 `preview.lines` 的个数给）。
  assert.deepEqual(previewSegments('', 'value', opts()), [])
})

test('a line without a hit is one plain segment', () => {
  assert.deepEqual(previewSegments('const value = 1', 'missing', opts()), [{ text: 'const value = 1', hit: false }])
})

test('every occurrence on the line is marked, in order', () => {
  const segments = previewSegments('let x = 1; x = 2', 'x', opts())
  assert.deepEqual(segments, [
    { text: 'let ', hit: false },
    { text: 'x', hit: true },
    { text: ' = 1; ', hit: false },
    { text: 'x', hit: true },
    { text: ' = 2', hit: false },
  ])
  assert.equal(join(segments), 'let x = 1; x = 2', '拼回去必须与原文逐字相等')
})

test('a hit at either edge does not produce empty segments', () => {
  assert.deepEqual(previewSegments('x tail', 'x', opts()), [{ text: 'x', hit: true }, { text: ' tail', hit: false }])
  assert.deepEqual(previewSegments('head x', 'x', opts()), [{ text: 'head ', hit: false }, { text: 'x', hit: true }])
})

test('the three options come from the same matcher as the search bar', () => {
  // 区分大小写：与 `editorFindController` / 工程内搜索同一个 flag。
  assert.deepEqual(hits(previewSegments('Alpha alpha', 'alpha', opts({ caseSensitive: true }))), ['alpha'])
  assert.equal(hits(previewSegments('Alpha alpha', 'alpha', opts())).length, 2, '默认不区分大小写')
  // 全词：`cat` 不命中 `category`。
  assert.deepEqual(hits(previewSegments('cat category', 'cat', opts({ wholeWords: true }))), ['cat'])
  // 正则：结构化模板/正则档传进来的就是编译后的模式。
  assert.deepEqual(hits(previewSegments('a1 b2', '\\d', opts()))  , [], '字面量档不认 \\d')
  assert.deepEqual(hits(previewSegments('a1 b2', '\\d', opts({ regex: true }))), ['1', '2'])
})

test('zero-width matches have nothing to paint', () => {
  // `^` / `x*` 这类零宽命中没有可高亮的文本：整行按普通文本渲染，而不是画一堆空 `<mark>`。
  assert.deepEqual(previewSegments('abc', '^', opts({ regex: true })), [{ text: 'abc', hit: false }])
  assert.deepEqual(previewSegments('abc', 'x*', opts({ regex: true })), [{ text: 'abc', hit: false }])
})

test('one line cannot be painted forever', () => {
  const line = 'a'.repeat(PREVIEW_HITS_PER_LINE + 10)
  assert.equal(hits(previewSegments(line, 'a', opts())).length, PREVIEW_HITS_PER_LINE)
  assert.equal(join(previewSegments(line, 'a', opts())), line, '截断只影响标记数，文本不许丢')
})

// —— 接线 ——

test('the panel feeds the compiled query and the live option toggles into the segments', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import \{[^}]*previewSegments[^}]*\} from '\.\.\/searchPreview'/)
  assert.match(panel, /return previewSegments\(text, activeQuery\.value, \{/)
  assert.match(panel, /regex: structural\.value \? true : regex\.value/, '结构化模板传编译后的正则')
  assert.match(panel, /wholeWords: structural\.value \? false : wholeWord\.value/, '与 params() 的三档一致')
})

test('the preview body paints the hit spans and overrides the mark default', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /<mark v-if="segment\.hit" class="fs-preview-hit">\{\{ segment\.text \}\}<\/mark>/)
  assert.match(panel, /v-for="\(segment, at\) in previewSegmentsOf\(text\)"/)
  assert.match(panel, /\.fs-preview-hit \{ background: var\(--selected\)/, '`<mark>` 的浏览器默认黄底必须被样式盖掉')
  assert.match(panel, /border-bottom: 1px solid var\(--accent\)/)
})
