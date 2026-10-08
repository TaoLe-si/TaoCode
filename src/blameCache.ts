// blame 的**按 (路径, 修订) 缓存** —— 上游 `CacheableAnnotationProvider`/`AnnotationProviderEx` 的可移植那一半
// （`platform/vcs-impl/src/com/intellij/vcs/CacheableAnnotationProvider.java:12-16` 的
// `populateCache(file)`/`getFromCache(file)` 与 `AnnotationProviderEx.java:26-45` 的
// `annotate(path, revision)`/`isAnnotationValid(path, revisionNumber)`）。
//
// 上游为什么要有这一层：`AnnotationsPreloader.kt:73` 在后台线程先把注解灌进缓存
// （`annotationProvider.populateCache(file)`），随后 `VcsCodeVisionProvider.kt:251`
// 在 UI 线程 `getFromCache(file) ?: return AnnotationResult.NotReady` —— **先读缓存、命中就不再往返**。
// 缓存本体是 `VcsAnnotationCachedProxy.java:44-88`：按 (filePath, vcsKey, revisionNumber) 存，
// 命中后还要校验（`isAnnotationValid`，`:149-150` 转发给真正的 provider）。
//
// 本仓的等价物（落点与消费链）：
//   · `git.blame` 的原始行（`GitBlameLine[]`）是**按路径与修订**取的，与上游同粒度；
//     缓存里存的也是它（折算成 `BlameAnnotation` 是纯函数 `src/blameAnnotations.ts` 的事，
//     不必进缓存 —— 上游缓存的 `FileAnnotation` 也是「原始数据 + 惰性呈现」）。
//   · **失效规则**照 `isAnnotationValid`：修订变了 ⇒ 换键（等于重新拉）；文件在磁盘上被
//     外部改过（宿主 `fsChanges` 的路径命中）⇒ 整份作废（blame 的行号会漂）；同一修订下
//     重复打开同一个文件 ⇒ 命中缓存、不再发 `git.blame`。
//
// 本模块是纯逻辑 + 一个自持的表（零运行时 import），`node --test` 可直接驱动。

/** 缓存里的一条：某个 (路径, 修订) 下的原始 blame 行 + 当时的行数。 */
export interface BlameCacheEntry<T> {
  revision: string
  /** 当时文档的行数 —— 文件被编辑过（行数变了）就不该复用旧行号。 */
  lineCount: number
  lines: readonly T[]
}

/** 一条查询的键：路径归一 + 修订 + 仓库。 */
export function blameCacheKey(path: string, revision: string, repository = ''): string {
  const normalized = path.replace(/\\/g, '/')
  return `${repository}\u0000${normalized}\u0000${revision}`
}

/** 缓存上限（本仓同时开着「追溯」的文件数很少；超了丢最久没用的那条）。 */
export const BLAME_CACHE_LIMIT = 32

/**
 * 按 (路径, 修订) 的 blame 缓存。`put` 是上游 `populateCache`，`get` 是 `getFromCache`，
 * `invalidatePath`/`invalidateAll` 是失效面。
 */
export class BlameCache<T> {
  private readonly entries = new Map<string, BlameCacheEntry<T>>()

  /** 当前有几条（判据与状态面用）。 */
  get size(): number { return this.entries.size }

  /**
   * 读缓存（`getFromCache`）。`lineCount` 与当时不一致 ⇒ **不命中**（文件被改过，旧行号会画错行）
   * —— 这正是上游 `isAnnotationValid` 在本仓能做的那一半（本仓没有 PSI 的 revision 对象，
   * 用「行数 + 修订」两个可观测量代替）。
   */
  get(path: string, revision: string, lineCount: number, repository = ''): readonly T[] | null {
    const key = blameCacheKey(path, revision, repository)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.lineCount !== lineCount) return null
    // 命中即提到最近使用（Map 的插入顺序 = LRU 顺序）。
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.lines
  }

  /** 写缓存（`populateCache`）。超上限时丢最久没用的那条。 */
  put(path: string, revision: string, lineCount: number, lines: readonly T[], repository = ''): BlameCacheEntry<T> {
    const entry: BlameCacheEntry<T> = { revision, lineCount, lines: [...lines] }
    const key = blameCacheKey(path, revision, repository)
    this.entries.delete(key)
    this.entries.set(key, entry)
    while (this.entries.size > BLAME_CACHE_LIMIT) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return entry
  }

  /**
   * 一条路径作废（任何修订）—— 宿主 `fsChanges` 报这个文件在磁盘上变了时调。
   * 上游对应 `VcsAnnotationCachedProxy` 里「修订号变了就换键」的另一半：
   * 外部改动会改行号，旧注解必须丢。
   */
  invalidatePath(path: string): number {
    const normalized = path.replace(/\\/g, '/')
    let removed = 0
    for (const key of [...this.entries.keys()]) {
      if (key.split('\u0000')[1] === normalized) { this.entries.delete(key); ++removed }
    }
    return removed
  }

  /** 整批作废（换工作区 / VCS 更新之后调）。 */
  invalidateAll(): number {
    const removed = this.entries.size
    this.entries.clear()
    return removed
  }

  /** 排查用：当前缓存的 (路径, 修订) 清单。 */
  keys(): string[] { return [...this.entries.keys()] }
}

/**
 * 上游 `AnnotationsPreloader.kt` 的「先灌缓存再读」形态：**同一条键只发一次请求**。
 * 调用方给 `fetch`（真正发 `git.blame` 的那一条），本函数负责命中判断与写回；
 * `lineCount` 由调用方按当时的文档算（编辑器给的是行数）。
 *
 * 与上游的一处差异（如实）：上游 `populateCache` 是**后台预取**（UI 线程随后一定命中），
 * 本仓是**首次需要时同步取**（没有可预取的时机：注解要等用户按「追溯」才要）。
 * 行为上的等价处是「第二次读同一个 (路径, 修订, 行数) 不再往返」。
 */
export async function loadBlameLines<T>(
  cache: BlameCache<T>,
  path: string,
  revision: string,
  lineCount: number,
  fetch: () => Promise<readonly T[]>,
  repository = '',
): Promise<readonly T[]> {
  const cached = cache.get(path, revision, lineCount, repository)
  if (cached) return cached
  const lines = await fetch()
  cache.put(path, revision, lineCount, lines, repository)
  return lines
}