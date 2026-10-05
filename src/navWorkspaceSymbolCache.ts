// 「转到符号 / 转到类」的工作区符号**客户端缓存**（`ls/navigation` 判词里那条 ④）。
//
// 上游依据（逐条）：
//   · `platform/lsp-impl/src/impl/LspRequestExecutor.kt:156-163` —— `getWorkspaceSymbolsCaching(query)`
//     不是每次输入都直发服务器，而是 `workspaceSymbolCache.getOrCompute(query) { … }`。
//   · `platform/lsp-impl/src/impl/LspRequestExecutor.kt:51` —— 那张表就是
//     `LspSingleSlotCache<String, List<WorkspaceSymbol>>`（**单槽**，键 = 查询串）。
//   · `platform/lsp-impl/src/impl/cache/LspSingleSlotCache.kt:19-46` —— 命中条件两条：
//     ①存进去之后**全局修改计数没变**（`:36` `lastPsiModificationCount == psiModCount`），
//     ②`matches(storedKey, storedValue, queriedKey)` 为真（`:21` 默认就是键相等）；
//     计算结果为 `null` 时**不入槽**（`:42` `val newResult = compute() ?: return null`）——
//     "服务器没答上来"和"服务器答了空表"是两回事，后者可以复用。
//     命中时把 `lastKey` 换成查询键（`:38`），值不动。
//   · `platform/lsp-impl/src/impl/cache/LspSingleSlotCache.kt:50-53` —— `clearCache()` 把三格全清
//     （本仓的对应触发点：语言服务重启、换工程）。
//   · 调用侧的顺序（本仓照抄）：`LspWorkspaceSymbolContributor.kt:73` 先取
//     `getWorkspaceSymbolsCaching(query)`，再在 `:86` 逐条 `shouldAcceptSymbolKind` ——
//     缓存管原始应答，kind 过滤在缓存**之后**。
//
// 本仓的架构不等价（负责人 2026-10-05 指示按本仓架构还原功能）：
//   · 上游的 `PsiManager.modificationTracker.modificationCount` → 本仓的 `revision()` 计数源，
//     由宿主在「任一编辑器内容变化 / 磁盘变化 / 换工程」时递增（接线见 `src/lspNavigation.ts`）。
//   · 上游的 `null`（请求失败）→ 本仓 `compute()` 返回 `null`，同样不入槽。
//
// 消费链路（不是死模块）：
//   · `src/lspNavigation.ts` 的 `globalSymbolEntries` —— 槽里存**服务器原始应答**，
//     命中就不重发 `workspace/symbol`；计数源 `symbolRevision` 由该模块在
//     「编辑器内容变化 / 文件关闭 / 替换改写磁盘」时递增，`clearCache()` 的触发点是
//     「语言服务重启（`resetLsp`）/ 换工程（`workspaceEpoch` 变化）」；
//   · 判据 → `tests/nav-workspace-symbol-cache.test.mjs`（纯逻辑）+
//     `tests/nav-symbol-cache-wiring.test.mjs`（接线：探测不入槽、命中不重发请求）。
// 判据：`tests/nav-workspace-symbol-cache.test.mjs`。

/** 缓存的一份结果（`SymbolEntry` 的数组；这里不 import 宿主模块，避免循环依赖）。 */
export type WorkspaceSymbolCacheValue = readonly unknown[]

/**
 * 单槽缓存（`LspSingleSlotCache` 的等价物）。
 *
 * 注意：**不用 TS 参数属性**（`constructor(private readonly …)` 在本仓会被 Node 的
 * strip-only 类型擦除拒掉，见 `docs/agent-playbook-parity.md` §0.5），字段显式声明。
 */
export class NavWorkspaceSymbolCache<V extends WorkspaceSymbolCacheValue = WorkspaceSymbolCacheValue> {
  private readonly revisionSource: () => number
  private storedRevision = -1
  private storedQuery: string | null = null
  private storedValue: V | null = null

  constructor(revision: () => number) {
    this.revisionSource = revision
  }

  /**
   * `getOrCompute`（`LspSingleSlotCache.kt:31-46`）：命中就复用，否则算一次；
   * 算出 `null` 不入槽。查询串在 `matches`（=键相等）之外没有别的条件，所以这里不放开自定义。
   */
  getOrCompute(query: string, compute: () => V | null): V | null {
    const revision = this.revisionSource()
    if (this.storedQuery !== null && this.storedValue !== null && this.storedRevision === revision
        && this.matches(this.storedQuery, this.storedValue, query)) {
      this.storedQuery = query          // 上游 :38 —— 命中后键换成查询键，值不动
      return this.storedValue
    }
    const computed = compute()
    if (computed === null) return null  // 上游 :42 —— 失败不入槽，下次仍然会重算
    this.storedRevision = revision
    this.storedQuery = query
    this.storedValue = computed
    return computed
  }

  /** 上游 :24 的默认 `matches`：键相等。 */
  protected matches(storedQuery: string, _storedValue: V, queriedQuery: string): boolean {
    return storedQuery === queriedQuery
  }

  /** `clearCache()`（`LspSingleSlotCache.kt:48-52`）：三格一起清。 */
  clearCache(): void {
    this.storedRevision = -1
    this.storedQuery = null
    this.storedValue = null
  }

  /** 调试/判据用：槽里现在装的是哪个查询（空槽返回 null）。 */
  cachedQuery(): string | null {
    return this.storedValue === null ? null : this.storedQuery
  }
}
