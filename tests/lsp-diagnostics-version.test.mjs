// `textDocument/publishDiagnostics` 的**整批版本号**这条数据链的判据（lane: lspdiagver）。
//
// 上游依据（本轮自己开参考树核过的行号，坐标与仓里旧引用不同，见报告 §7）：
//   · LSP 3.17 `PublishDiagnosticsParams { uri, diagnostics, version?: integer }`
//     —— `version` 是**整批**的兄弟字段，不是每条 `Diagnostic` 的字段；
//   · `platform/lsp-impl/src/impl/features/highlighting/LspPublishDiagnosticsCache.kt:54-67`
//     （`handleDiagnosticsNotification`）：`val declaredVersion = params.version`（:56）→
//     只在 `declaredVersion != null && lspClient.isFileOpened(file)` 时比（:57-61）→
//     `getDocumentVersion(document) != declaredVersion` 就 `return`（:62-65，注释原文
//     "These diagnostics are for some previous document version. Ignore."）；
//   · `:69-83` 才是按 documentUri 分桶合并（`fileToDiagnosticsByDocumentUri[params.uri] = …`）。
//
// 本仓的对应物：闸门 `src/lspHighlightingCache.ts` 的 `acceptsPublishedVersion()`
// （函数早已存在，本轮补的是**喂给它的数据**：native 侧 `shape_publish_params()` +
// `Session::VersionedDiagnosticsSink`）。传输段（`native/main.cpp` 的事件、`src/bridge.ts`
// 的 `applyPushedDiagnostics`）在别的车道名下，本轮只提请求，见
// docs/wiring-requests-2026-10-06-lspdiagver.md。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptsPublishedVersion, mergePublishedDiagnostics } from '../src/lspHighlightingCache.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(root, relative), 'utf8')

// ── 闸门本身：拿**宿主真的会给的那几种值**过一遍（不是随手编的号） ──
test('闸门按上游的四种处置走：号相同才收，没声明/没文档/没开编都不比', () => {
  // 上游 :62-65 —— 已发布 ≠ 当前文档版本 ⇒ 整批丢弃（"陈旧包被拒"）。
  // 3 与 7 是 ctest 里那一对（`shape_publish_params` 递减那一条）用的同一组数：
  // 宿主把 3 原样交出来，闸门才有东西可拒。
  assert.equal(acceptsPublishedVersion(3, 7, true), false, '陈旧批次（发布 3 / 当前 7）必须拒收')
  assert.equal(acceptsPublishedVersion(7, 7, true), true, '当前版本的那一批照收')
  // 上游 :57 `declaredVersion != null` —— 服务器没声明就不比，照收。
  assert.equal(acceptsPublishedVersion(null, 1, true), true, '没声明版本 = 照收（宿主给的是 null，不是 0）')
  assert.equal(acceptsPublishedVersion(undefined, 1, true), true, '键整个缺席同样照收')
  // 上游 :61 `document != null` —— 手上没有当前版本号时不许拒（否则一切都被丢光）。
  assert.equal(acceptsPublishedVersion(3, null, true), true, '没有当前版本可比时照收')
  // 上游 :58-60 注释：未打开的文件不比版本 —— 没有编辑，不会出现视觉错位。
  assert.equal(acceptsPublishedVersion(3, 7, false), true, '没打开的文件一律不比版本')
  // 0 是合法的版本号（LSP 的 version 是任意整数）：它**不许**被当成「没声明」。
  assert.equal(acceptsPublishedVersion(0, 0, true), true, '第 0 版与第 0 版相符要收')
  assert.equal(acceptsPublishedVersion(0, 1, true), false, '第 0 版也要能被拒（塌成 null 就永远拒不掉）')
})

// ── 透传段：宿主真的把 version 取出来了吗（缺一段这条就红） ──
test('透传接线：整形层取整批 version、Session 有槽位、bootstrap 两条 sink 只走一条', () => {
  const support = read('native/lsp_support.cpp')
  const batch = support.slice(support.indexOf('PublishedBatch shape_publish_params'))
  assert.ok(batch.length > 0 && batch !== support, 'lsp_support.cpp 里有 shape_publish_params 的实现')
  // 只认整数：字符串/小数/显式 null 都当「没声明」，不许猜。
  assert.match(batch, /params\.at\("version"\)\.is_number_integer\(\)/, 'version 只认整数形状')
  assert.match(batch, /batch\.version = Json\(nullptr\)/, '默认值是 null（不是 0、不是 -1）')
  // `version` 在 params 层，不在条目层 —— 这条断的就是「别把它塞回 shape_diagnostics」。
  assert.ok(batch.indexOf('shape_publish_params') <= batch.indexOf('is_number_integer'),
    '整批 version 由 params 层的整形取出（条目层结构上拿不到）')

  const bootstrap = read('native/lsp_host_bootstrap.cpp')
  // 整形入口在重构后是**双参**：第二参是把 documentUri 折叠成工作区相对路径的 λ
  // （`shape_publish_params(const Json&, const std::function<std::string(const std::string&)>&)`，
  // 见 native/lsp_support.hpp）。断言意图不变 —— 诊断回调必须走这条带 version 的整批整形，
  // 旧写法（只传 params / 走 shape_diagnostics）会把整批 version 丢掉。
  assert.match(bootstrap, /shape_publish_params\(params, \[[^\]]*\]\(const std::string&/,
    '诊断回调改走整批整形（旧写法会把 version 丢掉）；第二条 λ 负责 uri→相对路径')
  assert.match(bootstrap, /on_diagnostics_versioned_\(path, batch\.items, batch\.version\)/,
    '注册了新 sink 时把 version 一起交出去')
  assert.match(bootstrap, /else if \(on_diagnostics_\) on_diagnostics_\(path, std::move\(batch\.items\)\)/,
    '没注册新 sink 时退回旧那条（宿主没接线前不能出现半条新事件）')

  const session = read('native/lsp_session.hpp')
  assert.match(session, /using VersionedDiagnosticsSink = std::function<void\(std::string path, Json diagnostics, Json version\)>/,
    'Session 的契约里有 version 这个槽位')
  assert.match(session, /void set_versioned_diagnostics_sink\(VersionedDiagnosticsSink sink\)/,
    '宿主有一条注册入口（main.cpp 那一句是接线请求的内容）')
})

// ── 能力声明要与实际处理一致 ──
test('能力声明：versionSupport 翻成 true，且假服务器真的回显版本（否则判据是空的）', () => {
  const bootstrap = read('native/lsp_host_bootstrap.cpp')
  const publishBlock = bootstrap.slice(bootstrap.indexOf('{"publishDiagnostics"'), bootstrap.indexOf('{"tagSupport"'))
  assert.match(publishBlock, /"versionSupport", true/, '客户端声明自己看得懂 params.version —— 报 false 时服务器有权不发')
  assert.ok(!/"versionSupport", false/.test(bootstrap), '不许留下另一处 versionSupport=false（声明与实际处理要一致）')
  // 判据的对照：假服务器不回显版本的话，上面那条 ctest 就只是在测空气。
  const fake = read('native/lsp_fake_server.cpp')
  assert.match(fake, /publish_params\["version"\] = opened_version/, '假服务器按真实服务器的规矩回显 didOpen 的版本')
  assert.match(fake, /const int opened_version = params\.at\("textDocument"\)\.value\("version", -1\)/,
    '回显的是客户端报上去的那一个号（不是编出来的）')
})

// ── 反证：拒收之后仍然要能重新接受（闸门不是单向黑洞） ──
test('陈旧包被拒后，同uri 的新批次照常合并进来（上游 :69-83 的分桶不看被拒的那一批）', () => {
  const byUri = new Map()
  const current = 7
  const stale = [{ line: 0, severity: 1, message: 'stale' }]
  const fresh = [{ line: 1, severity: 2, message: 'fresh' }]
  assert.equal(acceptsPublishedVersion(3, current, true), false, '先确认这一批会被拒')
  // 被拒的批次不进桶：桶里只有当前版本那一批。
  if (acceptsPublishedVersion(3, current, true)) mergePublishedDiagnostics(byUri, 'file:///a.java#1', stale)
  mergePublishedDiagnostics(byUri, 'file:///a.java#1', fresh)
  assert.deepEqual(mergePublishedDiagnostics(byUri, 'file:///a.java#1', fresh), fresh, '合并出来的是新的那一批')
  // 同一个文件的第二个 LSP 文档（分桶合并的那条规矩）：两桶都要在。
  mergePublishedDiagnostics(byUri, 'file:///a.java#2', [{ line: 2, severity: 3, message: 'other doc' }])
  assert.equal(byUri.size, 2, '一个文件可以有多个 LSP 文档，按 documentUri 分桶')
})
