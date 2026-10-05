// LSP 按文件缓存 —— 上游 `platform/lsp-impl/src/impl/cache` 的
// `LspCache`/`LspPerFileCache`/`LspSingleSlotCache` 在本仓的对应物。
//
// 上游语义（逐条对齐，判据在 `tests/lsp-per-file-cache.test.mjs`）：
//   · **单槽**：每个缓存实例只留一个 `(file, key, value)`（`LspPerFileCache.slot`）；
//   · stamp 守卫：槽里记写入时的修改计数，查询时计数变了就当未命中（`currentStamp`：
//     默认全局 PSI 修改计数；`invalidateOnlyOnDocumentChange=true` 时用**文档自己的**
//     modification stamp —— 上游注释点的就是 `textDocument/documentSymbol` 这类只依赖本文件的请求）；
//   · `matches(storedKey, storedValue, queriedKey)` 可放宽命中（包含式查找；命中时把槽的 key
//     重锚到最新查询，`s.key = key`）；
//   · 计算返回 null **不入槽**（下次重算）；抛异常丢槽并释放等待者；
//   · 在途合并：同 file+stamp 的并发调用 join 同一个 future，不重复发请求；
//   · `clearCache()` 参与批量生命周期（关项目/重启语言服务）。
//
// 本仓的 stamp 来源：宿主没有 PSI 修改计数，`stampOf(file)` 由调用方给（编辑器路径传
// 「内容签名」，等价于文档自己的 modification stamp）。`get`/`set` 是给「先查缓存、未命中再跑
// 带退避的重试链」的调用方开的同步口（`src/lspNavigation.ts` 的结构视图），命中规则与
// `getOrCompute` 完全一致。

export interface LspCache {
  clearCache(): void
}

export type CacheStamp = string | number

interface Slot<K, V> {
  stamp: CacheStamp
  file: string
  key: K
  value: V | null
  promise: Promise<V | null> | null
}

/**
 * 按文件 + 次级键的单槽缓存。`stampOf(file)` 变了就整体作废（默认口径：全局修改计数；
 * 传 `invalidateOnlyOnDocumentChange` 时用文件自己的 stamp）。
 */
export class LspPerFileCache<K, V> implements LspCache {
  private slot: Slot<K, V> | null = null
  private readonly stampOf: (file: string) => CacheStamp
  private readonly matches: (storedKey: K, storedValue: V, queriedKey: K) => boolean

  constructor(stampOf: (file: string) => CacheStamp,
              options: { matches?: (storedKey: K, storedValue: V, queriedKey: K) => boolean } = {}) {
    this.stampOf = stampOf
    this.matches = options.matches ?? ((stored, _value, queried) => stored === queried)
  }

  /** 只读命中（不触发计算）：文件 + stamp + matches 三条都成立才返回值。 */
  get(file: string, key: K): V | null {
    const slot = this.slot
    if (!slot || slot.file !== file) return null
    if (slot.stamp !== this.stampOf(file)) { this.slot = null; return null }
    if (slot.value === null || !this.matches(slot.key, slot.value, key)) return null
    slot.key = key
    return slot.value
  }

  /** 写入一个已算好的值（null 不入槽，与上游一致）。 */
  set(file: string, key: K, value: V | null): void {
    if (value === null) { this.slot = null; return }
    this.slot = { stamp: this.stampOf(file), file, key, value, promise: null }
  }

  /**
   * 取或算：同 file+stamp 的并发调用 join 在途计算；`compute` 返回 null 时不缓存。
   * `compute` 抛错时丢槽并把它抛给调用方（等待者也会收到同一错误）。
   */
  async getOrCompute(file: string, key: K, compute: () => V | null | Promise<V | null>): Promise<V | null> {
    while (true) {
      const stamp = this.stampOf(file)
      const slot = this.slot
      if (slot && slot.file === file && slot.stamp === stamp) {
        if (slot.promise) {
          // 在途：同一个键直接等结果；不同键等它落地后再按 matches 复评（包含式命中）。
          // 拥有者失败时等待者不当场抛（上游口径：等待者重试，可能有人成为新拥有者）。
          try {
            const value = await slot.promise
            if (slot.key === key || value === null) return value
            continue
          } catch { continue }
        }
        if (slot.value !== null && this.matches(slot.key, slot.value, key)) {
          slot.key = key
          return slot.value
        }
      }
      const promise = Promise.resolve().then(compute)
      const fresh: Slot<K, V> = { stamp, file, key, value: null, promise }
      this.slot = fresh
      try {
        const value = await promise
        if (value === null) { if (this.slot === fresh) this.slot = null; return null }
        fresh.value = value
        fresh.promise = null
        return value
      } catch (error) {
        if (this.slot === fresh) this.slot = null
        throw error
      }
    }
  }

  clearCache(): void {
    this.slot = null
  }
}

/**
 * 全局单槽缓存（`LspSingleSlotCache`）：不按文件分，只留一个 `(key, value)`，
 * stamp 一变即失效。`matches` 可做包含式命中（上游例子：光标仍落在缓存结果的文本范围内）。
 */
export class LspSingleSlotCache<K, V> implements LspCache {
  private stamp: CacheStamp | null = null
  private key: K | null = null
  private value: V | null = null
  /** 串行化尾巴：上游 `getOrCompute` 是 `@Synchronized`，并发调用要等前一个落地后再判命中。 */
  private tail: Promise<unknown> = Promise.resolve()
  private readonly stampOf: () => CacheStamp
  private readonly matches: (storedKey: K, storedValue: V, queriedKey: K) => boolean

  constructor(stampOf: () => CacheStamp,
              options: { matches?: (storedKey: K, storedValue: V, queriedKey: K) => boolean } = {}) {
    this.stampOf = stampOf
    this.matches = options.matches ?? ((stored, _value, queried) => stored === queried)
  }

  getOrCompute(key: K, compute: () => V | null | Promise<V | null>): Promise<V | null> {
    const run = async (): Promise<V | null> => {
      const stamp = this.stampOf()
      if (this.stamp === stamp && this.key !== null && this.value !== null && this.matches(this.key, this.value, key)) {
        this.key = key
        return this.value
      }
      const value = await compute()
      if (value === null) return null
      this.stamp = stamp
      this.key = key
      this.value = value
      return value
    }
    const result = this.tail.then(run)
    this.tail = result.catch(() => undefined)
    return result
  }

  clearCache(): void {
    this.stamp = null
    this.key = null
    this.value = null
  }
}
