// 层级结果缓存（IDEA `HierarchyBrowser` 的 children 缓存在本仓的对应物）。
//
// 上游行为：调用/类型层次的每个节点展开后把 children 存进浏览器的模型里，折叠再展开**不重查**；
// 只有显式刷新（换方向/换根/重跑）才作废。本仓之前每次折叠后展开都重发一次
// `callHierarchyIncoming` 等请求 —— 同一个节点来回折两次就是两次网络往返，层级大时肉眼可见地卡。
//
// 纯逻辑，无 Vue 依赖：键的构造、LRU 淘汰、按前缀作废都在这里，宿主（`src/hierarchyView.ts`）只调用。

/** 缓存键：与 `hierarchyView.hierarchyKey` 同构的稳定标识 + 查询形状。 */
export function hierarchyCacheKey(shape: string, itemKey: string): string {
  return `${shape}\u0000${itemKey}`
}

export interface HierarchyCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** 作废一个键前缀下的全部条目（换根/换方向/刷新时用）。 */
  invalidate(prefix: string): void
  clear(): void
  size(): number
}

/**
 * 有上限的 FIFO 缓存（超出后丢最早写入的）。层级结果的条目通常只有几十个节点，
 * 上限存在的意义是防止长会话里无限增长 —— 不是做精细的 LRU 命中率优化。
 */
export function createHierarchyCache<T>(limit = 256): HierarchyCache<T> {
  const entries = new Map<string, T>()
  return {
    get: key => entries.get(key),
    set(key, value) {
      // 重新写入同一个键时先删再插，保持「最近写入在尾部」的淘汰顺序。
      if (entries.has(key)) entries.delete(key)
      entries.set(key, value)
      while (entries.size > limit) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    invalidate(prefix) {
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key)
    },
    clear: () => entries.clear(),
    size: () => entries.size,
  }
}

/**
 * 一次层级查询的形状串（kind + direction）。放进键里是为了「调用方/被调用」、父类型/子类型
 * 在同一节点上各自缓存 —— 它们查询结果不同，混用会显示错方向的数据。
 */
export function hierarchyShape(kind: 'call' | 'type', direction: string): string {
  return `${kind}:${direction}`
}

/** 层级缓存的默认上限（节点数；层级视图的根 + 展开节点远小于这个数）。 */
export const HIERARCHY_CACHE_LIMIT = 256
