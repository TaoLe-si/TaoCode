// 工程内查找的**分块发布**（上游 `SearchResults` 的 chunk 流）。
//
// 上游要点（逐条核过）：
//   · `SearchResults.java:87` 的 `CHUNK_TIME_BUDGET_MS = 50`；`:256-306` 的注释写明动机 ——
//     "每搜到一块就先发出去，慢搜索也能先看到命中"，并且每一块都是**可取消的**一步；
//   · 发布出来的块还要带"是不是最后一块"（`publish(chunk, first, done, stamp)`），
//     以及块之间文档被改过就整份作废（`:299-304` 的 documentTimeStamp 对不上就丢）——
//     后者在本仓的等价物是 `streamId`：认不回来的块丢掉，宁可少显示也不搅混结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginSearchStream, endSearchStream, handleSearchChunk, searchStream } from '../src/searchStream.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

/** 一条命中（字段与 native 的 `preview()` 出参同形）。 */
const hit = (path, line) => ({ path, line, column: 1, length: 5, before: 'a', after: 'b', preview: 'alpha' })

// —— 累积与认领 ——

test('a chunk for the current stream is appended in order', () => {
  beginSearchStream(1)
  handleSearchChunk({ streamId: 1, matches: [hit('a.txt', 1)], fileCount: 1 })
  handleSearchChunk({ streamId: 1, matches: [hit('a.txt', 9), hit('b.txt', 2)], fileCount: 2 })
  assert.deepEqual(searchStream.matches.map(m => `${m.path}:${m.line}`), ['a.txt:1', 'a.txt:9', 'b.txt:2'])
  assert.equal(searchStream.fileCount, 2, '文件数取最后一次报告的值（宿主每块都会重报累计值）')
  assert.equal(searchStream.chunks, 2)
})

test('begin resets everything from the previous search', () => {
  beginSearchStream(1)
  handleSearchChunk({ streamId: 1, matches: [hit('a.txt', 1)], fileCount: 1 })
  beginSearchStream(2)
  assert.deepEqual(searchStream.matches, [])
  assert.equal(searchStream.fileCount, 0)
  assert.equal(searchStream.chunks, 0)
  assert.equal(searchStream.done, false)
  assert.equal(searchStream.id, 2)
})

// 迟到的块不许进新搜索 —— 与 bridge 里那两个世代计数器同一种纪律。
test('a chunk from a superseded search is dropped', () => {
  beginSearchStream(1)
  handleSearchChunk({ streamId: 1, matches: [hit('old.txt', 1)], fileCount: 1 })
  beginSearchStream(2)
  handleSearchChunk({ streamId: 1, matches: [hit('old.txt', 2)], fileCount: 2 })
  assert.deepEqual(searchStream.matches, [], '上一轮的块到了就丢')
  handleSearchChunk({ streamId: 2, matches: [hit('new.txt', 1)], fileCount: 1 })
  assert.deepEqual(searchStream.matches.map(m => m.path), ['new.txt'])
})

test('after the stream ends, later chunks are ignored', () => {
  beginSearchStream(5)
  endSearchStream()
  handleSearchChunk({ streamId: 5, matches: [hit('late.txt', 1)], fileCount: 1 })
  assert.deepEqual(searchStream.matches, [])
  assert.equal(searchStream.done, true)
})

test('a malformed chunk does not disturb the stream', () => {
  beginSearchStream(3)
  handleSearchChunk({ matches: [hit('no-id.txt', 1)] })
  handleSearchChunk({ streamId: 3 })
  handleSearchChunk({ streamId: 3, matches: [hit('ok.txt', 1)], fileCount: 'nope' })
  assert.deepEqual(searchStream.matches.map(m => m.path), ['ok.txt'], '认不出 id 的块不进，缺 matches 的块不进')
  assert.equal(searchStream.fileCount, 0, '文件数不是数字就不动它')
})

test('the handler claims the event so the router stops looking', () => {
  beginSearchStream(4)
  assert.equal(handleSearchChunk({ streamId: 4, matches: [] }), true)
})

// —— 接线：native 侧 ——

test('native splits the walk on a time budget and a match ceiling', () => {
  const hpp = read('native/search.hpp')
  assert.match(hpp, /std::function<void\(const Json& matches, std::size_t file_count\)> on_chunk;/)
  assert.match(hpp, /int chunk_budget_ms = 50;/, '上游 CHUNK_TIME_BUDGET_MS = 50')
  assert.match(hpp, /std::size_t chunk_max_matches = 200;/)
  const cpp = read('native/search.cpp')
  assert.match(cpp, /if \(pending\.size\(\) >= options\.chunk_max_matches \|\| elapsed >= options\.chunk_budget_ms\) flush\(\);/)
  assert.match(cpp, /flush\(\);  \/\/ 最后一段/, '最后不满一块的也要交出去')
})

test('only the preview request streams; replace paths stay whole-result', () => {
  const main = read('native/main.cpp')
  assert.match(main, /if \(method == "search\.preview"\) \{/)
  assert.match(main, /options\.on_chunk = \[this, stream_id\]/)
  // 替换那几条要的是整份清单（勾选/取消对齐），分块会把它们拉成两半。
  assert.ok(!/method == "search\.replaceSelected"\)[^]{0,80}on_chunk/.test(main))
})

test('the chunk payload lives next to the search it reports on', () => {
  const cpp = read('native/search.cpp')
  assert.match(cpp, /Json chunk_event\(std::int64_t stream_id, const Json& matches, std::size_t file_count\)/)
  assert.match(cpp, /\{"event", "search\.chunk"\}/)
  assert.match(cpp, /\{"done", false\}/, '块不是终点；终点仍由一次性答复给')
})

// —— 接线：前端 ——

test('the bridge routes search.chunk to the stream module', () => {
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /case 'search\.chunk':\n      return handleSearchChunk\(data\)/)
  assert.match(bridge, /import \{ handleSearchChunk \} from '\.\/searchStream\.ts'/)
})

test('the panel claims a stream per search and closes it on every exit path', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /beginSearchStream\(\+\+streamSeq\)/, '两次入口（首搜 / 刷新）都要认领')
  assert.equal((panel.match(/beginSearchStream\(\+\+streamSeq\)/g) ?? []).length, 2)
  assert.match(panel, /streamId: streamSeq/, '请求要把 streamId 带上，宿主每块回带它')
  assert.match(panel, /endSearchStream\(\)/, 'applyResult 与取消都要收尾')
  assert.ok((panel.match(/endSearchStream\(\)/g) ?? []).length >= 2, '结束与取消两条路径都要收尾')
})

test('the panel shows what has arrived while still running', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /正在搜索…已找到 \$\{streamedCount\} 条 \/ \$\{searchStream\.fileCount\} 个文件/)
  assert.match(panel, /const liveMatches = computed\(\(\) => \{/, '流式期间用已到达的那部分渲染')
  assert.match(panel, /for \(const match of liveMatches\.value\)/)
  assert.match(panel, /if \(!searchStream\.done\) return false/, '流式阶段不拿上一次的 selected 当"将替换"')
  // 空态那一支原先看 `total`（最终总数）：流式期间它恒为 0，于是"正在搜索…"一直挂着、
  // 块到了也画不出来（真机取证时列表是空的，状态行却已经在报 4167 条）。
  assert.match(panel, /<div v-if="running && !liveMatches\.length" class="fs-empty">正在搜索…<\/div>/)
  assert.ok(!panel.includes('v-if="running && !total"'), '空态不能再看最终总数')
})
