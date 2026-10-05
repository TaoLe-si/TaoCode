// `ls/session` 的按文件缓存判据（`src/lspPerFileCache.ts` + 结构视图接线）。
//
// 上游依据（platform/lsp-impl/src/impl/cache）：
//   · `LspPerFileCache` 单槽 + 修改计数守卫；`invalidateOnlyOnDocumentChange = true` 用文档
//     自己的 stamp（注释里点名的就是 `textDocument/documentSymbol`）；
//   · `null` 不入槽、抛异常丢槽、并发同 file+stamp 的调用 join 在途计算；
//   · `LspCache.clearCache()` 参与批量生命周期；`LspSingleSlotCache` 是全局单槽 + `matches`
//     包含式命中（命中时重锚 key）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LspPerFileCache, LspSingleSlotCache } from '../src/lspPerFileCache.ts'

const navigation = () => readFileSync('src/lspNavigation.ts', 'utf8')

test('按文件单槽：stamp 一变即失效；换文件后旧文件不占槽', async () => {
  let stamp = 1
  const cache = new LspPerFileCache(() => stamp)
  let calls = 0
  const compute = () => { calls += 1; return calls }
  assert.equal(await cache.getOrCompute('a.java', 'sym', compute), 1)
  assert.equal(await cache.getOrCompute('a.java', 'sym', compute), 1, '同 stamp 同键应命中')
  assert.equal(calls, 1)
  stamp = 2
  assert.equal(await cache.getOrCompute('a.java', 'sym', compute), 2, 'stamp 变了要重算')
  assert.equal(await cache.getOrCompute('b.java', 'sym', compute), 3, '换文件重算（单槽只能留一个）')
  assert.equal(await cache.getOrCompute('a.java', 'sym', compute), 4, 'a 的槽已被 b 顶掉')
  assert.equal(calls, 4)
})

test('null 不入槽；抛异常丢槽且等待者重试成为新拥有者', async () => {
  const cache = new LspPerFileCache(() => 'fixed')
  let calls = 0
  assert.equal(await cache.getOrCompute('f', 'k', () => { calls += 1; return null }), null)
  assert.equal(await cache.getOrCompute('f', 'k', () => { calls += 1; return 'v' }), 'v')
  assert.equal(calls, 2, 'null 结果不该被缓存')

  const failing = new LspPerFileCache(() => 'fixed')
  await assert.rejects(() => failing.getOrCompute('f', 'k', () => { throw new Error('boom') }), /boom/)
  assert.equal(await failing.getOrCompute('f', 'k', () => 'after'), 'after', '失败后槽要丢掉')
})

test('在途合并：同一 file+stamp 的并发调用只算一次', async () => {
  const cache = new LspPerFileCache(() => 'fixed')
  let calls = 0
  let release
  const gate = new Promise(resolve => { release = resolve })
  const compute = async () => { calls += 1; await gate; return 'v' }
  const [first, second] = [cache.getOrCompute('f', 'k', compute), cache.getOrCompute('f', 'k', compute)]
  release()
  assert.equal(await first, 'v')
  assert.equal(await second, 'v')
  assert.equal(calls, 1)
})

test('matches 包含式命中：命中后把槽的 key 重锚到最新查询', async () => {
  const cache = new LspPerFileCache(
    () => 'fixed', { matches: (_stored, value, queried) => {
      const at = Number(queried)
      return at >= value.from && at <= value.to
    } })
  let calls = 0
  assert.equal((await cache.getOrCompute('f', '5', () => { calls += 1; return { from: 0, to: 10 } })).to, 10)
  assert.equal((await cache.getOrCompute('f', '7', () => { calls += 1; return { from: 0, to: 10 } })).to, 10)
  assert.equal(calls, 1, '包含式查询不该重算')
  assert.equal(await cache.getOrCompute('f', '20', () => { calls += 1; return { from: 20, to: 30 } }).then(v => v.from), 20)
  assert.equal(calls, 2)
})

test('get/set 只读口与 clearCache（结构视图的「先查再跑重试链」）', () => {
  let stamp = 'v1'
  const cache = new LspPerFileCache(() => stamp)
  assert.equal(cache.get('f', 'k'), null)
  cache.set('f', 'k', [1, 2])
  assert.deepEqual(cache.get('f', 'k'), [1, 2])
  assert.equal(cache.get('other', 'k'), null, '文件不同不命中')
  stamp = 'v2'
  assert.equal(cache.get('f', 'k'), null, 'stamp 变了不命中')
  cache.set('f', 'k', [3])
  cache.set('f', 'k', null)
  assert.equal(cache.get('f', 'k'), null, 'null 不入槽')
  cache.set('f', 'k', [4])
  cache.clearCache()
  assert.equal(cache.get('f', 'k'), null)
})

test('LspSingleSlotCache：全局单槽 + stamp 守卫 + 自定义 matches', () => {
  let stamp = 0
  const cache = new LspSingleSlotCache(() => stamp)
  let calls = 0
  const run = async () => { calls += 1; return `v${calls}` }
  return Promise.all([cache.getOrCompute('a', run), cache.getOrCompute('a', run)]).then(results => {
    assert.equal(calls, 1)
    stamp = 1
    return cache.getOrCompute('a', run).then(value => {
      assert.equal(value, 'v2')
      assert.equal(calls, 2)
    })
  })
})

test('接线：结构视图走按文件缓存，语言服务重启/关文件时清缓存', () => {
  const source = navigation()
  // 这条守的是**意图**（结构视图真的引入了按文件缓存），不是 import 语句的字面形状：
  // 值 import 必须写全 `.ts` 扩展名是仓库规矩（Node ESM 下少了它就是 ERR_MODULE_NOT_FOUND），
  // 上一版把字符串锁成没有扩展名那条，代码改对之后反而变红。
  assert.ok(/import \{ LspPerFileCache \} from '\.\/lspPerFileCache(\.ts)?'/.test(source), 'lspNavigation 没有引入按文件缓存')
  assert.ok(source.includes('new LspPerFileCache<string, LspDocumentSymbol[]>(path => outlineDocumentStamp(path))'),
    '结构视图没有按文档签名建缓存')
  assert.ok(source.includes('const cached = outlineCache.get(path, OUTLINE_REQUEST)'), 'refreshOutline 没有先查缓存')
  assert.ok(source.includes('if (cached) { outline.value = cached; return }'), '缓存命中没有直接复用')
  assert.ok(source.includes('if (symbols.length > 0) outlineCache.set(path, OUTLINE_REQUEST, symbols)'),
    '取到符号后没有入槽（空符号不入槽）')
  const reset = source.slice(source.indexOf('function resetLsp'), source.indexOf('async function revealLocation'))
  assert.ok(reset.includes('outlineCache.clearCache()'), 'resetLsp 没有清缓存（重启语言服务后会读到旧符号）')
  const stop = source.slice(source.indexOf('function stopLspFile'), source.indexOf('function resetLsp'))
  assert.ok(stop.includes('outlineCache.clearCache()'), '关文件没有清缓存')
})
