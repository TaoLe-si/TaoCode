// 搜索结果预览面板（上游 `FindPopupPanel` 的 `UsagePreviewPanel`）。
//
// 上游要点（逐条核过）：
//   · `FindPopupPanel.java:895-896`：结果表与预览分居一个 splitter 两侧，比例 .33，用户拖过的位置被记住；
//   · `:868-872`：选中变化 **50ms 去抖**后才刷新预览；
//   · `:871`：预览体最小高度 15 行；
//   · `:369-377`：标题栏写文件名 + 位置路径；
//   · `UsagePreviewPanel.kt:376` `showLoading()`；`:652-668` 三句状态文案，中文包 `UsageViewBundle.properties:86/106/110`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PREVIEW_CONTEXT_LINES, PREVIEW_DEBOUNCE_MS, PREVIEW_SELECT_HINT, PREVIEW_TITLE, PREVIEW_UNAVAILABLE,
  previewHeader, previewLines, previewWindow, resultLineParts,
} from '../src/searchPreview.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

// —— 常量与文案（逐条对上游）——

test('the debounce and the context match the upstream numbers', () => {
  assert.equal(PREVIEW_DEBOUNCE_MS, 50, 'FindPopupPanel.java:871 的 addRequest(..., 50)')
  assert.ok(PREVIEW_CONTEXT_LINES >= 15, '预览体最小 15 行（:871），本仓的窗口不小于它')
})

test('the three labels are the shipped Chinese ones', () => {
  assert.equal(PREVIEW_TITLE, '预览', 'UsageViewBundle.properties:106 tab.title.preview')
  assert.equal(PREVIEW_SELECT_HINT, '选择要预览的项', ':86 select.the.usage.to.preview')
  assert.equal(PREVIEW_UNAVAILABLE, '所选条目没有预览', ':110 usage.preview.isnt.available')
})

// —— previewWindow ——

test('a short file is shown whole', () => {
  const window = previewWindow(10, 4, 40)
  assert.deepEqual(window, { from: 1, to: 10, matchIndex: 3, truncated: false })
})

test('a long file is windowed around the match', () => {
  const window = previewWindow(1000, 500, 40)
  assert.deepEqual(window, { from: 460, to: 540, matchIndex: 40, truncated: true })
})

test('the window never runs past either end of the file', () => {
  assert.deepEqual(previewWindow(1000, 1, 40), { from: 1, to: 41, matchIndex: 0, truncated: true })
  const tail = previewWindow(1000, 1000, 40)
  assert.deepEqual(tail, { from: 960, to: 1000, matchIndex: 40, truncated: true })
})

test('an out-of-range line is clamped, not thrown', () => {
  // 搜索期间文件可能被改短：行号越界时按文件末尾处理。
  assert.equal(previewWindow(20, 99, 5).to, 20)
  assert.equal(previewWindow(20, 0, 5).from, 1)
  assert.equal(previewWindow(20, -3, 5).matchIndex, 0)
})

test('an empty file has an empty window', () => {
  assert.deepEqual(previewWindow(0, 1, 40), { from: 1, to: 0, matchIndex: 0, truncated: false })
})

test('a zero context shows exactly the match line', () => {
  assert.deepEqual(previewWindow(100, 50, 0), { from: 50, to: 50, matchIndex: 0, truncated: true })
})

// —— previewLines ——

test('the rendered lines are the window, with CR stripped', () => {
  const content = ['one', 'two', 'three', 'four'].join('\n')
  assert.deepEqual(previewLines(content, previewWindow(4, 2, 1)), ['one', 'two', 'three'])
  assert.deepEqual(previewLines('a\r\nb\r\nc', previewWindow(3, 2, 0)), ['b'], '行尾 \\r 要去掉（与搜索给的行号同一口径）')
})

test('an empty window renders nothing', () => {
  // 空文件（0 行）的窗口是空区间 —— 一行都不渲染，而不是渲染一个空行。
  assert.deepEqual(previewLines('', previewWindow(0, 1, 40)), [])
  assert.deepEqual(previewLines('x', previewWindow(0, 1, 40)), [])
  assert.deepEqual(previewLines('x\ny', previewWindow(2, 1, 40)), ['x', 'y'])
})

// —— previewHeader ——

test('the header shows the file name and the line position', () => {
  assert.deepEqual(previewHeader('src/deep/inner.ts', 12, 340), { name: 'inner.ts', detail: '行 12 / 共 340' })
  assert.equal(previewHeader('top.txt', 1, 1).name, 'top.txt')
})

// —— 接线 ——

test('the panel loads the preview through file.read and keeps a per-path cache', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import \{[^}]*previewWindow[^}]*\} from '\.\.\/searchPreview'/)
  assert.match(panel, /request<\{ content: string \}>\('file\.read', \{ path: match\.path \}\)/, '内容从 file.read 来')
  assert.match(panel, /const previewCache = new Map<string, string\[\]>\(\)/, '同一文件多处命中不重复读盘')
  assert.match(panel, /previewTimer = setTimeout\(\(\) => \{ void loadPreview\(\) \}, PREVIEW_DEBOUNCE_MS\)/, '去抖 50ms')
})

test('a late reply cannot overwrite a newer preview', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /const seq = \+\+previewSeq/)
  assert.match(panel, /if \(seq !== previewSeq\) return/, '迟到的答复丢掉')
})

test('the panel renders the three states the upstream panel has', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /v-if="preview\.status === 'idle'" class="fs-empty">\{\{ PREVIEW_SELECT_HINT \}\}/)
  assert.match(panel, /v-else-if="preview\.status === 'empty'" class="fs-empty">\{\{ PREVIEW_UNAVAILABLE \}\}/)
  assert.match(panel, /正在载入预览…/, '加载态（上游 showLoading）')
  assert.match(panel, /:class="\{ current: index === preview\.window\.matchIndex \}"/, '命中行高亮')
})

test('the preview follows the current match, first row when nothing was walked yet', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /return list\[cursor\.value >= 0 \? cursor\.value : 0\] \?\? null/)
  assert.match(panel, /watch\(previewMatch, \(\) => \{ schedulePreview\(\) \}\)/)
})

test('a fresh search re-schedules the preview', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /cursor\.value = -1\n  schedulePreview\(\)/, '新结果落定时刷新预览')
})

test('the preview pane is labelled and styled like the rest of the panel', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /class="fs-preview" role="region" :aria-label="PREVIEW_TITLE"/)
  // 真机抓到过：状态属性写成了字面量（`data-preview-status="preview.status"`），
  // 探针读出来就是那句字符串本身 —— 必须是绑定。
  assert.match(panel, /:data-preview-status="preview\.status"/)
  assert.ok(!/[^:]data-preview-status="preview\.status"/.test(panel), '状态属性要绑定，不要字面量')
  assert.match(panel, /\.fs-preview-line\.current \{ background: var\(--accent-soft\)/)
  // 矮停靠区里预览体不能只剩标题（真机截图看到过：列表吃掉整块，正文在折叠线以下）。
  assert.match(panel, /\.fs-preview \{[^}]*min-height: 96px/, '预览面板保底高度')
})

// —— 结果列表那一行的行内切分（同一族的第二段规则，从面板搬进来）——

test('resultLineParts 按宿主报的 column/length 切行内命中，不在面板里重新匹配', () => {
  assert.deepEqual(resultLineParts('get(user, name)', 5, 4),
    [{ text: 'get(', hit: false }, { text: 'user', hit: true }, { text: ', name)', hit: false }])
  assert.deepEqual(resultLineParts('abc', 1, 3), [{ text: 'abc', hit: true }], '整行命中时只有一段')
  assert.deepEqual(resultLineParts('abc', 3, 5), [{ text: 'ab', hit: false }, { text: 'c', hit: true }], 'length 越界时夹到行尾')
  assert.deepEqual(resultLineParts('abc', 0, 2), [{ text: 'ab', hit: true }, { text: 'c', hit: false }], 'column 缺省（0）按行首算')
  assert.deepEqual(resultLineParts('', 1, 0), [{ text: '', hit: true }], '空行给一段空命中 —— 与搬出组件前那份逐字同形')
})

test('面板用这条规则渲染结果行（不是自己再实现一份切分）', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /import \{[^}]*resultLineParts as lineParts[^}]*\} from '\.\.\/searchPreview'/)
  assert.match(panel, /in lineParts\(match\.preview, match\.column, match\.length\)/)
  assert.doesNotMatch(panel, /function parts\(/, '切分已搬进 src/searchPreview.ts，面板不留第二份')
})
