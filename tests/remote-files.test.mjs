// 判据 · **远程（http/https）只读文件**（`src/remoteFiles.ts` + `native/http_client.cpp`）——
// 上游 `HttpFileSystemBase` / `HttpVirtualFileImpl` / `RemoteFileManagerImpl` 在本仓的可移植子集。
//
// 钉四件事：
//   ① URL 白名单与归一化（与宿主 `http_url_supported` 逐字同口径：只认 http/https 且有主机名）；
//   ② 文档身份、显示名、语言推断、缓存过期与"成功但没正文"的答复被拒；
//   ③ 失败时给出人话原因（宿主 reason 优先、HTTP 4xx/5xx 有兜底文案）；
//   ④ 宿主通道真的在：`native/http_client.cpp/.hpp` 存在、CMake 挂了目标与 ctest、
//      前端模块的注释指向它（不是死代码）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  REMOTE_CACHE_TTL_MS, REMOTE_FILE_READ_ONLY, isRemoteUrl, isStale, normalizeRemoteUrl,
  remoteDocumentFrom, remoteFailureReason, remoteFileId, remoteFileName, remoteLanguageOf, remoteStatusText,
} from '../src/remoteFiles.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const exists = rel => existsSync(new URL(`../${rel}`, import.meta.url))

test('URL 白名单：只认 http/https 且有主机名（与宿主 http_url_supported 同口径）', () => {
  assert.equal(isRemoteUrl('http://example.com/a.ts'), true)
  assert.equal(isRemoteUrl('https://example.com'), true)
  assert.equal(isRemoteUrl('HTTP://Example.COM/x'), true, '协议大小写不敏感')
  assert.equal(isRemoteUrl('HtTpS://host/p'), true)
  // 拒绝档（与 native/http_client_test.cpp 那张表逐条对齐）。
  for (const bad of ['file:///C:/x.ts', 'ftp://host/x', 'javascript:alert(1)', 'C:/Windows/calc.exe', 'http://', 'http:/host', '', 'example.com']) {
    assert.equal(isRemoteUrl(bad), false, `${bad} 不该被当成远程地址`)
  }
  assert.equal(normalizeRemoteUrl('  https://x/y  '), 'https://x/y', '去首尾空白')
  assert.equal(normalizeRemoteUrl('ftp://x'), null, '不受支持的返回 null，不编一个假地址')
})

test('文档身份：显示名取 URL 末段、secure 按协议判、语言按扩展名', () => {
  const id = remoteFileId('https://raw.example.com/repo/src/App.ts?ref=main')
  assert.deepEqual(id, { url: 'https://raw.example.com/repo/src/App.ts?ref=main', name: 'App.ts', secure: true })
  assert.equal(remoteFileId('http://x/a/b/')?.name, 'b', '末段为空时取上一段')
  assert.equal(remoteFileId('http://example.com')?.name, 'example.com', '没有路径时用主机名')
  assert.equal(remoteFileId('ftp://x')?.name, undefined)
  assert.equal(remoteFileId('https://x/y.md').secure, true)
  assert.equal(remoteFileId('http://x/y.md').secure, false)
  assert.equal(remoteFileName('http://x/p/A.java'), 'A.java')
  assert.equal(remoteLanguageOf('http://x/p/A.java'), 'java')
  assert.equal(remoteLanguageOf('http://x/p/noext'), '')
  assert.equal(REMOTE_FILE_READ_ONLY, true, '上游 HttpVirtualFileImpl.isWritable() = false')
})

test('取数结果整形：成功要真带正文；缺正文/失败一律 null（不造一个空文档）', () => {
  const id = remoteFileId('https://x/a.ts')
  const ok = remoteDocumentFrom(id, { available: true, url: id.url, content: 'let a = 1', status: 200, bytes: 9, contentType: 'text/plain' }, 1000)
  assert.equal(ok.content, 'let a = 1')
  assert.equal(ok.finalUrl, id.url, '没重定向时 finalUrl 与请求地址同')
  assert.equal(ok.fetchedAt, 1000)
  assert.equal(ok.truncated, false)
  // 「成功但没正文」是坏答复 ⇒ 拒（否则编辑器会显示一份空文档，看起来像文件真的空）。
  assert.equal(remoteDocumentFrom(id, { available: true, url: id.url, status: 200 }, 1000), null)
  assert.equal(remoteDocumentFrom(id, { available: false, url: id.url, reason: '连不上' }, 1000), null)
  // 重定向：finalUrl 记下来（界面上要能看出真实取的是哪儿）。
  const moved = remoteDocumentFrom(id, { available: true, url: id.url, finalUrl: 'https://y/a.ts', content: 'x', status: 200 }, 1000)
  assert.equal(moved.finalUrl, 'https://y/a.ts')
})

test('缓存过期：缺失/超期算过期，TTL 内不算', () => {
  const id = remoteFileId('https://x/a.ts')
  const doc = remoteDocumentFrom(id, { available: true, url: id.url, content: 'x', status: 200 }, 1000)
  assert.equal(isStale(null, 2000), true, '没有文档 = 该取')
  assert.equal(isStale(doc, 1000 + REMOTE_CACHE_TTL_MS - 1), false, 'TTL 内不重取')
  assert.equal(isStale(doc, 1000 + REMOTE_CACHE_TTL_MS), true, '到点重取')
  assert.equal(isStale({ ...doc, fetchedAt: Number.NaN }, 1000), true, '坏时间戳当过期')
})

test('失败原因：宿主 reason 优先，4xx/5xx 有兜底，什么都没有也要说人话', () => {
  assert.equal(remoteFailureReason({ available: false, url: 'u', reason: '连接超时。' }, 'u'), '连接超时。')
  assert.equal(remoteFailureReason({ available: false, url: 'u', status: 404 }, 'u'), '服务器返回 404。')
  assert.match(remoteFailureReason({ available: false, url: 'u' }, 'https://x/a.ts'), /取不到 https:\/\/x\/a\.ts/)
  assert.match(remoteFailureReason(null, 'https://x/a.ts'), /取不到/)
})

test('状态文案：只说真话（重定向要说、截断必须说）', () => {
  const id = remoteFileId('https://x/a.ts')
  const doc = remoteDocumentFrom(id, { available: true, url: id.url, content: 'x'.repeat(10), status: 200, bytes: 10 }, 0)
  const text = remoteStatusText(doc)
  assert.match(text, /只读远程文件/)
  assert.match(text, /HTTP 200/)
  assert.doesNotMatch(text, /截断/, '没截断不说截断')
  const truncated = remoteStatusText({ ...doc, truncated: true })
  assert.match(truncated, /已截断显示/, '截断了必须说出来')
  const moved = remoteStatusText({ ...doc, finalUrl: 'https://y/a.ts' })
  assert.match(moved, /重定向到 https:\/\/y\/a\.ts/)
})

test('宿主通道真的在：http_client.cpp/.hpp + CMake 目标 + ctest 都挂了', () => {
  assert.ok(exists('native/http_client.cpp'), 'native/http_client.cpp 存在')
  assert.ok(exists('native/http_client.hpp'), 'native/http_client.hpp 存在')
  assert.ok(exists('native/http_client_test.cpp'), 'native/http_client_test.cpp 存在')
  const header = read('native/http_client.hpp')
  assert.match(header, /Json http_get\(const HttpRequest& request\)/)
  assert.match(header, /bool http_url_supported\(const std::string& url\)/)
  const source = read('native/http_client.cpp')
  assert.match(source, /WinHttpOpen/, '走 WinHTTP（系统库）')
  assert.match(source, /WINHTTP_OPTION_REDIRECT_POLICY_DISALLOW_HTTPS_TO_HTTP/, '不跟随 https→http 降级')
  const cmake = read('CMakeLists.txt')
  assert.match(cmake, /add_library\(taocode_http native\/http_client\.cpp\)/)
  assert.match(cmake, /target_link_libraries\(taocode_http PUBLIC taocode_workspace winhttp\)/)
  assert.match(cmake, /add_executable\(http_client_test native\/http_client_test\.cpp\)/)
  assert.match(cmake, /add_test\(NAME http_client_contract COMMAND http_client_test\)/)
  assert.match(cmake, /taocode_gradle taocode_http/, 'TaoCode 可执行目标链上了它')
})

test('前端模块说明了为什么必须走宿主（CSP）且不 import 运行时桥接', () => {
  const source = read('src/remoteFiles.ts')
  assert.match(source, /connect-src 'self' ws:\/\/127\.0\.0\.1:5173/, '记下了 CSP 这条边界')
  assert.match(source, /native\/http_client\.cpp/)
  assert.match(source, /HttpVirtualFileImpl|HttpFileSystemBase/)
  // 纯数据层：不 import bridge 的运行时值（结构类型入参）。
  assert.doesNotMatch(source, /from '\.\/bridge(\.ts)?'/, '不 import bridge 的运行时值')
})