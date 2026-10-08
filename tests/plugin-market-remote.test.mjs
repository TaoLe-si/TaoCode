// 判据 · **远程插件市场**（`src/pluginMarketRemote.ts`）—— 从 http(s) 仓库取清单，复用本地市场
// 同一份解析器（`src/pluginMarket.ts` 的 `parseMarketplaceCatalog`）。取数走宿主 `http.get`
// （桌面端）或放宽后的 CSP 直连（浏览器预览档）；判据注入假 fetch，不发网络请求。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  JETBRAINS_MARKETPLACE_HOST, REMOTE_INSTALL_AVAILABLE, REMOTE_MANIFEST_NAME,
  loadRemoteMarketplace, remoteManifestUrl, resolveRemotePackageUrl,
} from '../src/pluginMarketRemote.ts'

test('清单 URL 拼接：补 `repository.json`、去掉结尾斜杠、非 http(s) 拒绝', () => {
  assert.equal(remoteManifestUrl('https://plugins.jetbrains.com/repo'), `https://plugins.jetbrains.com/repo/${REMOTE_MANIFEST_NAME}`)
  assert.equal(remoteManifestUrl('https://x/y/'), `https://x/y/${REMOTE_MANIFEST_NAME}`, '去掉结尾斜杠再拼')
  assert.equal(remoteManifestUrl('https://x/y/repository.json'), 'https://x/y/repository.json', '已是清单地址则原样')
  assert.equal(remoteManifestUrl('ftp://x/y'), null, '只认 http(s)')
  assert.equal(remoteManifestUrl('not a url'), null)
})

test('包地址解析成绝对 URL（相对路径基于清单 URL）', () => {
  const base = 'https://plugins.jetbrains.com/repo/repository.json'
  assert.equal(resolveRemotePackageUrl(base, 'p-1.0.zip'), 'https://plugins.jetbrains.com/repo/p-1.0.zip')
  assert.equal(resolveRemotePackageUrl(base, 'https://cdn.example.com/p.zip'), 'https://cdn.example.com/p.zip', '已是绝对 URL')
  assert.equal(resolveRemotePackageUrl(base, ''), null)
})

test('取远程清单：解析成与本地同形的条目，file 换成绝对 URL', async () => {
  const manifest = JSON.stringify({
    name: '远端仓库',
    plugins: [
      { id: 'com.acme.plugin', name: 'Acme', version: '1.2.0', file: 'acme-1.2.0.zip', vendor: 'Acme', category: 'Tools' },
      { id: 'bad', name: '没有版本', file: 'x.zip' },
    ],
  })
  const result = await loadRemoteMarketplace('https://plugins.jetbrains.com/repo', {
    fetch: async url => ({ available: true, url, status: 200, contentType: 'application/json', content: manifest }),
  })
  assert.equal(result.available, true)
  assert.equal(result.url, 'https://plugins.jetbrains.com/repo/repository.json')
  assert.equal(result.plugins.length, 1, '坏条目不空整页')
  assert.equal(result.plugins[0].id, 'com.acme.plugin')
  assert.equal(result.plugins[0].vendor, 'Acme')
  assert.equal(result.plugins[0].file, 'https://plugins.jetbrains.com/repo/acme-1.2.0.zip', 'file 解析成绝对 URL')
  assert.ok(result.errors.length >= 1, '逐条错误保留')
})

test('取不到 / 抛错 / 坏 JSON 都如实失败，不抛给调用方', async () => {
  const unavailable = await loadRemoteMarketplace('https://x/y', {
    fetch: async url => ({ available: false, url, reason: '网络不可达' }),
  })
  assert.equal(unavailable.available, false)
  assert.ok(unavailable.reason.length > 0)

  const threw = await loadRemoteMarketplace('https://x/y', {
    fetch: async () => { throw new Error('超时') },
  })
  assert.equal(threw.available, false)
  assert.match(threw.reason, /超时/)

  const badJson = await loadRemoteMarketplace('https://x/y', {
    fetch: async url => ({ available: true, url, status: 200, content: 'not json' }),
  })
  assert.equal(badJson.available, false)
  assert.ok(badJson.errors.length >= 1)
})

test('非 http(s) 地址不进取数（直接失败）', async () => {
  const result = await loadRemoteMarketplace('file:///tmp/repo')
  assert.equal(result.available, false)
  assert.match(result.reason, /不是 http\(s\)/)
})

test('敞开的 CSP 主机与远程安装缺口如实登记', () => {
  assert.equal(JETBRAINS_MARKETPLACE_HOST, 'plugins.jetbrains.com')
  assert.equal(REMOTE_INSTALL_AVAILABLE, false, '远程下载+验签没有落点 ⇒ 不画安装按钮')
})
