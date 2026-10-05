// 插件市场（`src/pluginMarket.ts`）：清单解析、路径守卫、版本比较、状态判定、搜索排序、
// 本地仓库加载与安装/更新流程（依赖注入的假实现）。
//
// 只测不碰 RPC 的那一半；`plugin.install`/`plugin.list` 的真实行为由 `native/plugins_test.cpp` 覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_REPOSITORY_ROOT,
  MARKETPLACE_MANIFEST,
  MARKETPLACE_SORTS,
  compareVersions,
  discoverMarketplacePackages,
  formatDownloads,
  installMarketplaceEntry,
  joinWorkspacePath,
  loadMarketplace,
  marketplaceCategories,
  marketplaceEntryStatus,
  marketplaceUpdates,
  matchesMarketplaceQuery,
  normalizeRepositoryPath,
  parseMarketplaceCatalog,
  repositoryManifestPath,
  sortMarketplaceEntries,
} from '../src/pluginMarket.ts'
import { matchesInstalledQuery, parseInstalledQuery } from '../src/pluginGroups.ts'

const installed = (id, version, extra = {}) => ({ id, name: id, version, description: '', path: '', enabled: true, commands: [], templates: [], ...extra })

test('清单解析：对象与数组两种形状，坏条目逐条报错但不打空整页', () => {
  const object = parseMarketplaceCatalog(JSON.stringify({
    name: '团队仓库',
    plugins: [
      { id: 'a', name: 'A', version: '1.0', file: 'pkgs/a-1.0.zip', category: 'Tools', tags: ['x'], downloads: 4200, rating: 4.5, releaseDate: 1700000000000 },
      { id: 'b', version: '2.0', file: '../escape.zip' },
      { name: 'no id', version: '1', file: 'c.zip' },
    ],
  }))
  assert.equal(object.catalog.name, '团队仓库')
  assert.equal(object.catalog.plugins.length, 1)
  assert.deepEqual(object.catalog.plugins[0].tags, ['x'])
  assert.equal(object.catalog.plugins[0].downloads, 4200)
  assert.equal(object.errors.length, 2)
  assert.match(object.errors[1], /没有 id/)

  const array = parseMarketplaceCatalog(JSON.stringify([{ id: 'a', name: 'A', version: '1', file: 'a.zip' }]), '兜底名')
  assert.equal(array.catalog.name, '兜底名')
  assert.equal(array.catalog.plugins.length, 1)

  const broken = parseMarketplaceCatalog('{not json')
  assert.equal(broken.catalog, null)
  assert.match(broken.errors[0], /不是合法 JSON/)
})

test('路径守卫：绝对路径、盘符、.. 与 NUL 都不收；清单路径与安装路径按工作区根拼', () => {
  assert.equal(normalizeRepositoryPath('pkgs/a.zip'), 'pkgs/a.zip')
  assert.equal(normalizeRepositoryPath('pkgs\\a.zip'), 'pkgs/a.zip')
  assert.equal(normalizeRepositoryPath('./pkgs/./a.zip'), 'pkgs/a.zip')
  assert.equal(normalizeRepositoryPath('/etc/passwd'), null)
  assert.equal(normalizeRepositoryPath('C:/x.zip'), null)
  assert.equal(normalizeRepositoryPath('pkgs/../../x.zip'), null)
  assert.equal(normalizeRepositoryPath(''), null)

  assert.equal(repositoryManifestPath('.taocode/plugins'), `.taocode/plugins/${MARKETPLACE_MANIFEST}`)
  assert.equal(repositoryManifestPath('../x'), null)
  assert.equal(joinWorkspacePath('D:/Work/Proj', '.taocode/plugins/a.zip'), 'D:/Work/Proj/.taocode/plugins/a.zip')
  assert.equal(joinWorkspacePath('D:/Work/Proj/', 'pkgs/a.zip'), 'D:/Work/Proj/pkgs/a.zip')
  assert.equal(joinWorkspacePath('', 'pkgs/a.zip'), null)
  assert.equal(joinWorkspacePath('relative/root', 'a.zip'), null)
  assert.equal(joinWorkspacePath('D:/root', '../a.zip'), null)
})

test('没有清单时按目录里的包文件兜底（id/name 从文件名折出）', () => {
  const files = [
    `${DEFAULT_REPOSITORY_ROOT}/My-Plugin-1.0.zip`,
    `${DEFAULT_REPOSITORY_ROOT}/other.jar`,
    `${DEFAULT_REPOSITORY_ROOT}/nested/deep.zip`,
    `${DEFAULT_REPOSITORY_ROOT}/notes.txt`,
    'src/app.ts',
  ]
  const entries = discoverMarketplacePackages(files, DEFAULT_REPOSITORY_ROOT)
  assert.deepEqual(entries.map(entry => entry.id), ['my-plugin-1.0', 'other'])
  assert.equal(entries[0].file, 'My-Plugin-1.0.zip')
})

test('版本比较：数字段按数值、数字优先于字母、缺段当 0、字母段是预发布', () => {
  assert.ok(compareVersions('1.10', '1.9') > 0)
  assert.ok(compareVersions('1.0', '1.0.0') < 0)
  assert.ok(compareVersions('2.0', '1.9.9') > 0)
  assert.ok(compareVersions('1.0', '1.0-beta') > 0)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.ok(compareVersions('2026.1', '2025.3') > 0)
})

test('状态判定：未装/已装/可更新/已装但无效', () => {
  const entry = { id: 'a', name: 'A', version: '2.0', file: 'a.zip' }
  assert.equal(marketplaceEntryStatus(entry, []).state, 'available')
  assert.equal(marketplaceEntryStatus(entry, [installed('a', '2.0')]).state, 'installed')
  const update = marketplaceEntryStatus(entry, [installed('a', '1.0')])
  assert.equal(update.state, 'update')
  assert.equal(update.target, '2.0')
  assert.equal(marketplaceEntryStatus(entry, [installed('a', '1.0', { broken: '缺少依赖 x' })]).state, 'incompatible')
  assert.equal(marketplaceEntryStatus(entry, [installed('a', '1.0', { error: '清单无法读取' })]).state, 'incompatible')
  assert.deepEqual(marketplaceUpdates([entry], [installed('a', '1.0')]).map(item => item.id), ['a'])
})

test('搜索：关键字匹配名称/id/描述/厂商/标签；范围过滤用真实安装状态', () => {
  const entries = [
    { id: 'a', name: 'Formatter', version: '2', file: 'a.zip', description: '代码格式化', vendor: 'ACME', tags: ['java'] },
    { id: 'b', name: 'Runner', version: '1', file: 'b.zip', category: 'Tools' },
  ]
  const query = (patch) => ({ keyword: '', category: '', scope: 'all', ...patch })
  assert.equal(matchesMarketplaceQuery(entries[0], query({ keyword: 'acme' }), []), true)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ keyword: 'java' }), []), true)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ keyword: 'runner' }), []), false)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ category: 'Tools' }), []), false)
  assert.equal(matchesMarketplaceQuery(entries[1], query({ category: 'Tools' }), []), true)
  // 没装、装了、可更新三种情况对 /downloaded 与 /outdated 的判定。
  assert.equal(matchesMarketplaceQuery(entries[0], query({ scope: 'downloaded' }), []), false)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ scope: 'downloaded' }), [installed('a', '2')]), true)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ scope: 'outdated' }), [installed('a', '2')]), false)
  assert.equal(matchesMarketplaceQuery(entries[0], query({ scope: 'outdated' }), [installed('a', '1')]), true)
})

test('排序：四个真实维度，相关度保留清单顺序；类目去重保持出现顺序', () => {
  const entries = [
    { id: 'a', name: 'Beta', version: '1', file: 'a.zip', downloads: 10, rating: 5, releaseDate: 100, category: 'Tools' },
    { id: 'b', name: 'Alpha', version: '1', file: 'b.zip', downloads: 900, rating: 3, releaseDate: 300, category: 'Themes' },
    { id: 'c', name: 'Gamma', version: '1', file: 'c.zip', downloads: 100, rating: 4, releaseDate: 200, category: 'Tools' },
  ]
  assert.deepEqual(MARKETPLACE_SORTS, ['relevance', 'updateDate', 'downloads', 'rating', 'name'])
  assert.deepEqual(sortMarketplaceEntries(entries, 'relevance').map(e => e.id), ['a', 'b', 'c'])
  assert.deepEqual(sortMarketplaceEntries(entries, 'name').map(e => e.id), ['b', 'a', 'c'])
  assert.deepEqual(sortMarketplaceEntries(entries, 'downloads').map(e => e.id), ['b', 'c', 'a'])
  assert.deepEqual(sortMarketplaceEntries(entries, 'rating').map(e => e.id), ['a', 'c', 'b'])
  assert.deepEqual(sortMarketplaceEntries(entries, 'updateDate').map(e => e.id), ['b', 'c', 'a'])
  assert.deepEqual(marketplaceCategories(entries), ['Tools', 'Themes'])
  assert.equal(formatDownloads(999), '999')
  assert.equal(formatDownloads(4200), '4.2K')
  assert.equal(formatDownloads(2_500_000), '2.5M')
})

test('本地仓库加载：优先清单、清单坏了退回目录、没有仓库返回 none', async () => {
  const written = {
    '.taocode/plugins/repository.json': JSON.stringify({ name: 'R', plugins: [{ id: 'a', name: 'A', version: '1', file: 'p/a.zip' }] }),
  }
  const deps = (files, failOnManifest = false) => ({
    readText: async (relative) => {
      if (failOnManifest) throw new Error('ENOENT')
      if (!(relative in written)) throw new Error('ENOENT')
      return written[relative]
    },
    listFiles: async () => files,
  })
  const fromManifest = await loadMarketplace(deps(['.taocode/plugins/other.zip']), DEFAULT_REPOSITORY_ROOT)
  assert.equal(fromManifest.source, 'manifest')
  assert.deepEqual(fromManifest.entries.map(entry => entry.id), ['a'])

  const fromDirectory = await loadMarketplace(deps(['.taocode/plugins/other.zip', '.taocode/plugins/repository.json']), DEFAULT_REPOSITORY_ROOT)
  assert.equal(fromDirectory.source, 'manifest')

  const noManifest = await loadMarketplace(deps(['.taocode/plugins/other.zip'], true), DEFAULT_REPOSITORY_ROOT)
  assert.equal(noManifest.source, 'directory')
  assert.deepEqual(noManifest.entries.map(entry => entry.id), ['other'])

  const empty = await loadMarketplace(deps([], true), DEFAULT_REPOSITORY_ROOT)
  assert.equal(empty.source, 'none')
  assert.deepEqual(empty.entries, [])

  const badRoot = await loadMarketplace(deps([]), '../outside')
  assert.equal(badRoot.source, 'none')
  assert.match(badRoot.errors[0], /工作区相对路径/)
})

test('安装/更新：首次直接装；更新先卸再装（native 拒绝覆盖已存在的 id）', async () => {
  const calls = []
  const deps = {
    install: async (source) => { calls.push(['install', source]) },
    uninstall: async (id) => { calls.push(['uninstall', id]) },
  }
  const entry = { id: 'a', name: 'A', version: '2.0', file: '.taocode/plugins/a-2.zip' }
  assert.equal(await installMarketplaceEntry(deps, entry, 'D:/Proj', []), 'installed')
  assert.deepEqual(calls, [['install', 'D:/Proj/.taocode/plugins/a-2.zip']])

  calls.length = 0
  assert.equal(await installMarketplaceEntry(deps, entry, 'D:/Proj', [installed('a', '1.0')]), 'updated')
  assert.deepEqual(calls, [['uninstall', 'a'], ['install', 'D:/Proj/.taocode/plugins/a-2.zip']])

  await assert.rejects(() => installMarketplaceEntry(deps, entry, '', []), /绝对路径/)
})

test('已安装页的 /outdated 过滤用市场算出的更新 id（没读仓库时匹配不到，而不是乱匹配）', () => {
  const a = installed('a', '1.0')
  const b = installed('b', '3.0')
  const list = [a, b]
  const query = parseInstalledQuery('/outdated')
  assert.deepEqual(list.filter(item => matchesInstalledQuery(item, query, ['a'])).map(item => item.id), ['a'])
  assert.deepEqual(list.filter(item => matchesInstalledQuery(item, query)).map(item => item.id), [])
  // 与其它属性是与关系。
  assert.deepEqual(list.filter(item => matchesInstalledQuery(item, parseInstalledQuery('/outdated /enabled'), ['a'])).map(item => item.id), ['a'])
})

test('市场面板接的是既有 plugin.* 通道，且没有假装能联网', () => {
  const panel = readFileSync('src/components/PluginMarketPanel.vue', 'utf8')
  assert.match(panel, /request<PluginList>\('plugin\.install'/)
  assert.match(panel, /request<PluginList>\('plugin\.uninstall'/)
  assert.match(panel, /file\.read/)
  assert.match(panel, /app\.state/)
  // 远程仓库的缺口如实写在模块注释里（CSP + Method 清单无网络），代码里没有 fetch 假实现。
  const source = readFileSync('src/pluginMarket.ts', 'utf8')
  assert.match(source, /connect-src 'self'/)
  assert.ok(!/^\s*(await\s+)?fetch\(/m.test(source))
  const dialog = readFileSync('src/components/PluginDialog.vue', 'utf8')
  assert.match(dialog, /PluginMarketPanel/)
  assert.match(dialog, /MarketplacePluginsTab|市场/)
})
