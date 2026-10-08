// blame 缓存判据（`src/blameCache.ts`）—— 上游 `CacheableAnnotationProvider` /
// `AnnotationProviderEx` / `VcsAnnotationCachedProxy` 的可移植那一半。
//
// 上游依据（本轮逐条打开参考树核对）：
//   · `platform/vcs-impl/src/com/intellij/vcs/CacheableAnnotationProvider.java:12-16` ——
//     `populateCache(file)` / `getFromCache(file)` 两个方法就是这张表的两端；
//   · `platform/vcs-impl/src/com/intellij/vcs/AnnotationProviderEx.java:26-45` ——
//     `annotate(path, revision)` 按修订取、`isAnnotationValid(path, revisionNumber)` 是命中校验；
//   · `platform/vcs-impl/src/com/intellij/openapi/vcs/history/VcsAnnotationCachedProxy.java:44-88`
//     —— 按 (filePath, vcsKey, revisionNumber) 存，命中后校验、不命中才算；
//   · `platform/vcs-impl/lang/src/com/intellij/openapi/vcs/annotate/AnnotationsPreloader.kt:73`
//     与 `VcsCodeVisionProvider.kt:251` —— 先 `populateCache` 再 `getFromCache`，命中就不往返。
//
// 判据的口径：驱动真实消费链 —— 假 `git.blame` 的往返计数。
// 「命中 ⇒ 不再请求」必须表现为**调用次数不涨**，而不只是一个布尔值变了。
import test from 'node:test'
import assert from 'node:assert/strict'

import { BLAME_CACHE_LIMIT, BlameCache, blameCacheKey, loadBlameLines } from '../src/blameCache.ts'

/** 假 `git.blame`：记下每一次往返，返回可辨识的行。 */
function fetcher() {
  const calls = []
  return {
    calls,
    fetch(path) { calls.push(path); return Promise.resolve([{ line: 1, author: path, hash: 'h', date: 'd', email: '', summary: '', content: '' }]) },
  }
}

test('第二次读同一个 (路径, 修订, 行数) 不再往返 —— 上游 getFromCache 命中那一支', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  const first = await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 1, '第一次必须真的拉一次')
  const second = await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 1, '同一 (路径, 修订, 行数) 第二次又发了一次请求 —— 缓存等于没有')
  assert.deepEqual(second, first, '命中时要拿到与第一次相同的内容')
})

test('修订变了就换键（isAnnotationValid 的修订那一半）', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/A.java', 'v2', 10, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 2, '换修订必须重新拉（旧修订的注解对新修订无效）')
})

test('行数变了不命中（文件被编辑/外部改过，旧行号会画错行）', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/A.java', 'v1', 11, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 2, '行数变了还命中 —— 会把注解画到错行上')
})

test('路径归一：Windows 分隔符与正斜杠是同一条键', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src\\A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 1, '同一条路径两种写法该命中同一条')
  assert.equal(blameCacheKey('src\\A.java', 'v1'), blameCacheKey('src/A.java', 'v1'))
})

test('invalidatePath 只清那一条路径的所有修订（外部改盘那条链）', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/A.java', 'v2', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/B.java', 'v1', 10, () => fake.fetch('src/B.java'))
  assert.equal(cache.size, 3)
  assert.equal(cache.invalidatePath('src/A.java'), 2, 'A 的两个修订都该清掉')
  assert.equal(cache.size, 1, 'B 不受影响')
  await loadBlameLines(cache, 'src/B.java', 'v1', 10, () => fake.fetch('src/B.java'))
  assert.equal(fake.calls.length, 3, 'B 仍该命中（只有 A 被作废）')
})

test('invalidateAll 整批清（换工作区 / VCS 更新）', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  await loadBlameLines(cache, 'src/B.java', 'v1', 10, () => fake.fetch('src/B.java'))
  assert.equal(cache.invalidateAll(), 2)
  assert.equal(cache.size, 0)
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'))
  assert.equal(fake.calls.length, 3, '整批清之后必须重新拉')
})

test('LRU 上限：超了就丢最久没用的那条（Map 插入顺序 = 使用顺序）', async () => {
  const cache = new BlameCache()
  for (let index = 0; index < BLAME_CACHE_LIMIT; ++index) {
    await loadBlameLines(cache, `src/F${index}.java`, 'v1', 1, async () => [{ line: 1 }])
  }
  assert.equal(cache.size, BLAME_CACHE_LIMIT)
  // 摸一下第 0 条（提到最近使用），再插一条把别人挤掉。
  assert.ok(cache.get('src/F0.java', 'v1', 1))
  await loadBlameLines(cache, 'src/New.java', 'v1', 1, async () => [{ line: 1 }])
  assert.equal(cache.size, BLAME_CACHE_LIMIT, '上限必须守住')
  assert.ok(cache.get('src/F0.java', 'v1', 1), '刚摸过的第 0 条不该被挤掉')
  assert.equal(cache.get('src/F1.java', 'v1', 1), null, '最久没用的第 1 条该被挤掉')
})

test('仓库维度进键：同路径同修订不同仓库是两条', async () => {
  const cache = new BlameCache()
  const fake = fetcher()
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'), 'repo-a')
  await loadBlameLines(cache, 'src/A.java', 'v1', 10, () => fake.fetch('src/A.java'), 'repo-b')
  assert.equal(fake.calls.length, 2, '不同仓库的同名文件不该互相命中')
  assert.notEqual(blameCacheKey('src/A.java', 'v1', 'repo-a'), blameCacheKey('src/A.java', 'v1', 'repo-b'))
})