// 判据 · **市场两个来源**（`src/pluginMarketSources.ts`）—— 工作区本地仓库 + 远程 http(s) 仓库的
// 合并规则与「能不能装」，以及面板那一侧的接线（`src/components/PluginMarketPanel.vue`）。
//
// 规则（合并、可安装判定）是纯函数，直接测；接线断言读 .vue 源码（本仓既有口径，
// 见 `tests/plugin-market.test.mjs` 的同名一节），并顺带钉住「远程条目不许出现可点的安装按钮」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MARKETPLACE_ORIGIN_LABELS,
  REMOTE_INSTALL_BLOCKED,
  combineMarketplaceEntries,
  marketplaceOriginCounts,
  marketplaceOriginIndex,
  marketplaceOriginSummary,
} from '../src/pluginMarketSources.ts'

const entry = (id, version = '1.0.0', extra = {}) => ({
  id, name: id, version, file: `${id}-${version}.zip`, ...extra,
})

test('合并：本地在前、远程独有接在后面，两个来源都保留', () => {
  const merged = combineMarketplaceEntries([entry('a'), entry('b')], [entry('c')])
  assert.deepEqual(merged.map(item => [item.entry.id, item.origin, item.installable]), [
    ['a', 'local', true],
    ['b', 'local', true],
    ['c', 'remote', false],
  ])
  assert.equal(merged.length, 3)
})

test('同 id 本地优先：远程那一份同名条目不进列表（本地才是装得了的那一份）', () => {
  const merged = combineMarketplaceEntries([entry('a', '1.0.0')], [entry('a', '2.0.0'), entry('b', '1.0.0')])
  const a = merged.filter(item => item.entry.id === 'a')
  assert.equal(a.length, 1, '同 id 只留一条')
  assert.equal(a[0].origin, 'local')
  assert.equal(a[0].entry.version, '1.0.0', '留下的是本地版本，不是远程那个装不了的 v2')
  assert.equal(a[0].installable, true)
  assert.equal(merged.find(item => item.entry.id === 'b').origin, 'remote')
})

test('可安装判定只给本地条目；远程条目恒不可安装且原因写得出手', () => {
  const merged = combineMarketplaceEntries([entry('a')], [entry('b')])
  assert.deepEqual(merged.filter(item => item.installable).map(item => item.entry.id), ['a'])
  assert.equal(merged.find(item => item.entry.id === 'b').installable, false)
  assert.match(REMOTE_INSTALL_BLOCKED, /plugin\.install/, '原因要点到只收工作区路径的那条通道')
  assert.match(REMOTE_INSTALL_BLOCKED, /验签/, '也要点到缺的是验签/下载，不是"尚未完成"')
  assert.deepEqual(Object.keys(MARKETPLACE_ORIGIN_LABELS).sort(), ['local', 'remote'])
})

test('空表：两个来源都没有条目时合出来是空数组，不是 undefined', () => {
  assert.deepEqual(combineMarketplaceEntries([], []), [])
  assert.deepEqual(marketplaceOriginCounts([]), { local: 0, remote: 0 })
  assert.equal(marketplaceOriginSummary([]), '')
})

test('来源索引：按 id 查得到 origin（面板的徽章与按钮按它走）', () => {
  const index = marketplaceOriginIndex(combineMarketplaceEntries([entry('a')], [entry('b')]))
  assert.equal(index.get('a').origin, 'local')
  assert.equal(index.get('b').origin, 'remote')
  assert.equal(index.get('missing'), undefined)
})

test('来源计数与那一行文字：某一档为 0 时不写它', () => {
  const localOnly = combineMarketplaceEntries([entry('a'), entry('b')], [])
  assert.deepEqual(marketplaceOriginCounts(localOnly), { local: 2, remote: 0 })
  assert.equal(marketplaceOriginSummary(localOnly), '工作区仓库 2 条')

  const both = combineMarketplaceEntries([entry('a')], [entry('b'), entry('c')])
  assert.deepEqual(marketplaceOriginCounts(both), { local: 1, remote: 2 })
  assert.equal(marketplaceOriginSummary(both), '工作区仓库 1 条 · 远程仓库 2 条')
})

// ── 面板接线 ──────────────────────────────────────────────────────────────────

test('接线：市场页真的取远程清单，并把来源合成一份画出来', () => {
  const panel = readFileSync('src/components/PluginMarketPanel.vue', 'utf8')
  assert.match(panel, /import \{ loadRemoteMarketplace, type RemoteMarketplaceResult \} from '\.\.\/pluginMarketRemote'/)
  assert.match(panel, /const result = await loadRemoteMarketplace\(repository\)/)
  assert.match(panel, /combineMarketplaceEntries\(loadResult\.value\?\.entries \?\? \[\], remoteResult\.value\?\.plugins \?\? \[\]\)/)
  // 地址真的存起来（刷新/重开页不用重填），不是只留内存的假输入
  assert.match(panel, /localStorage\.setItem\(REMOTE_REPO_KEY, repository\)/)
  assert.match(panel, /v-model="remoteRepo"/)
  assert.match(panel, /@click="loadRemote"/)
  assert.match(panel, /{{ originSummary }}/)
  // 取不到时显示原因，不把整页打空
  assert.match(panel, /failure\.value = `远程仓库取不到：\$\{result\.reason\}`/)
})

test('不做假控件：远程条目的安装按钮禁用 + 写明原因，代码里也有硬闸', () => {
  const panel = readFileSync('src/components/PluginMarketPanel.vue', 'utf8')
  // 可安装判定真的看来源（`installableIds` = 工作区仓库那份）
  assert.match(panel, /installableIds\.value\.has\(entry\.id\)/)
  assert.match(panel, /function installLabel\(entry: MarketplacePlugin\): string \{[\s\S]{0,80}if \(isRemoteEntry\(entry\)\) return '不可安装'/)
  assert.match(panel, /function installTitle\(entry: MarketplacePlugin\): string \{[\s\S]{0,80}if \(isRemoteEntry\(entry\)\) return REMOTE_INSTALL_BLOCKED/)
  // 硬闸：即使按钮被绕过，install() 自己也会拒绝远程条目
  assert.match(panel, /async function install\(entry: MarketplacePlugin\) \{[\s\S]{0,400}if \(!installableIds\.value\.has\(entry\.id\)\) \{/)
  // 远程条目带只读徽章（title 就是那句原因）
  assert.match(panel, /v-if="isRemoteEntry\(entry\)" class="market-badge" :title="REMOTE_INSTALL_BLOCKED">(?:远程|\{\{ MARKETPLACE_ORIGIN_LABELS\.remote \}\}) · 只读</)
  // 上传给已安装页/更新检查的只有装得了的那一份
  assert.match(panel, /emit\('catalog', installableCatalog\.value\)/)
  assert.match(panel, /available: async id => installableCatalog\.value\.find/)
})

test('订正后的界面文案不再说"宿主没有网络通道"（那是过期事实）', () => {
  const panel = readFileSync('src/components/PluginMarketPanel.vue', 'utf8')
  assert.equal(/远程插件仓库需要网络通道/.test(panel), false, '旧的那句假原因是错的：宿主有 http.get')
  assert.equal(/宿主没有.*网络/.test(panel), false)
  assert.equal(/宿主 Method 清单无网络/.test(panel), false)
  // 只读的边界要写在界面上（远程条目装不了的原因）
  assert.match(panel, /远程条目只读，装包仍走工作区仓库/)
  // 来源那一行在空态时也不是"没有远程这回事"的口径
  assert.match(panel, /远程来源是上面填的仓库地址的清单，只读/)
})
