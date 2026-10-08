// 判据 · **远程只读文档的取数宿主**（`src/remoteFileHost.ts`）—— 把 `src/remoteFiles.ts` 的纯规则
// 接到宿主 `http.get`（`native/http_client.cpp` 的 WinHTTP）上的那一格。
//
// 钉四件事：
//   ① 真实链路：`fetchRemoteRaw` 真发 `request('http.get', …)`（不是死代码）；
//   ② 通道三处齐：`src/bridge.ts` 的 `Method` union 有 `http.get`、`native/main.cpp` 有
//      `case "http.get"_h`、`native/http_client.hpp` 存在（原生真有这条分派）；
//   ③ 宿主行为：会话缓存命中不重复取、`refresh` 强制重取、过期重取、坏 URL 不发请求、
//      失败给一句人话（宿主 reason 优先）；
//   ④ 浏览器预览如实拒绝（`src/bridgePreview.ts` 有 `http.` 前缀的守卫）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import { createRemoteFileHost } from '../src/remoteFileHost.ts'
import { REMOTE_CACHE_TTL_MS } from '../src/remoteFiles.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const exists = rel => existsSync(new URL(`../${rel}`, import.meta.url))

/** 一个记下每次调用的假 `http.get`。 */
function fakeFetch(reply) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    return typeof reply === 'function' ? reply(url, calls.length) : reply
  }
  return { impl, calls }
}

const ok = url => ({ available: true, url, finalUrl: url, status: 200, contentType: 'text/plain', bytes: 3, content: 'abc' })

test('真实链路：fetchRemoteRaw 真发 http.get，宿主三处齐', async () => {
  const host = read('src/remoteFileHost.ts')
  assert.match(host, /request<RemoteFetchResult>\('http\.get'/, 'fetchRemoteRaw 必须真发 http.get')
  // 桥接的方法名清单（routing-parity 会再把三张表钉在一起）。
  assert.match(read('src/bridge.ts'), /'http\.get'/, 'Method union 要有 http.get')
  const native = read('native/main.cpp')
  assert.match(native, /case "http\.get"_h:/, 'native 分派要有 http.get')
  assert.match(native, /#include "http_client\.hpp"/, 'native 要 include http_client.hpp')
  assert.ok(exists('native/http_client.hpp') && exists('native/http_client.cpp'), 'WinHTTP 通道要在盘上')
  // 浏览器预览没有这条通道（本仓 CSP 拦跨源 fetch），要如实拒绝而不是静默走 default。
  assert.match(read('src/bridgePreview.ts'), /method\.startsWith\('http\.'\)/, '浏览器预览要有 http. 守卫')
})

test('宿主行为：会话缓存命中不重复取，refresh 强制重取', async () => {
  const { impl, calls } = fakeFetch(url => ok(url))
  const host = createRemoteFileHost({ fetch: impl, now: () => 1000 })
  const first = await host.open('https://x/a.ts')
  assert.equal(first.content, 'abc')
  assert.equal(calls.length, 1)
  // 同 URL 再开：缓存命中，不再发请求（上游 isUseCache 的会话内等价物）。
  await host.open('https://x/a.ts')
  assert.equal(calls.length, 1, '未过期时不该重取')
  // refresh 跳过缓存。
  await host.open('https://x/a.ts', { refresh: true })
  assert.equal(calls.length, 2, 'refresh 要重取一次')
})

test('过期就重取：同一 URL 在 TTL 之后取第二份', async () => {
  let clock = 1000
  const { impl, calls } = fakeFetch(url => ok(url))
  const host = createRemoteFileHost({ fetch: impl, now: () => clock })
  await host.open('https://x/a.ts')
  assert.equal(calls.length, 1)
  clock = 1000 + REMOTE_CACHE_TTL_MS + 1  // 过期
  await host.open('https://x/a.ts')
  assert.equal(calls.length, 2, '过期后要重取')
})

test('坏 URL 不发请求，失败给一句人话（宿主 reason 优先）', async () => {
  const { impl, calls } = fakeFetch(url => ok(url))
  const host = createRemoteFileHost({ fetch: impl })
  assert.equal(await host.open('ftp://host/x'), null)
  assert.equal(await host.open(''), null)
  assert.equal(await host.open('C:/tmp/a.txt'), null)
  assert.equal(calls.length, 0, '坏 URL 一个请求都不该发')
  assert.match(host.error.value, /不是 http\/https 地址/)

  // 宿主回 available:false + reason：原样用 reason。
  const failHost = createRemoteFileHost({ fetch: async () => ({ available: false, url: 'https://x/a.ts', reason: '连不上主机' }) })
  assert.equal(await failHost.open('https://x/a.ts'), null)
  assert.equal(failHost.error.value, '连不上主机')
  assert.equal(failHost.document.value, null)
  // "成功但没正文"是坏答复 ⇒ 拒，并给兜底说明。
  const emptyHost = createRemoteFileHost({ fetch: async () => ({ available: true, url: 'https://x/a.ts', status: 200 }) })
  assert.equal(await emptyHost.open('https://x/a.ts'), null)
  assert.match(emptyHost.error.value, /取不到/)
})

test('refresh / close 语义：没有当前文档时 refresh 什么都不做；close 清空', async () => {
  const { impl, calls } = fakeFetch(url => ok(url))
  const host = createRemoteFileHost({ fetch: impl })
  assert.equal(await host.refresh(), null, '没打开时 refresh 不发请求')
  assert.equal(calls.length, 0)
  await host.open('https://x/a.ts')
  assert.equal((await host.refresh()).id.url, 'https://x/a.ts')
  assert.equal(calls.length, 2)
  host.close()
  assert.equal(host.document.value, null)
  assert.equal(host.error.value, null)
})
