# 接线请求 · 2026-10-06 · problems2（`ls/highlighting` 剩余面 + 一处宿主清理点）

> 只列**必须动保留文件 / 别人可改面**的部分。本轮已经做完并落盘的那一半（push/pull 两份诊断缓存
> 与读时合并）在 `docs/batch-2026-10-06-problems2.md` §1 前两行与 §4（含反向验证数字）。
> 上游坐标都是本机参考树里 **本轮亲自 `test -f` / `grep -n` 命中**过的，指不到的我写了「无法核实」。

## W1 · `LspSemanticTokensCache` / `LspDocumentLinkCache` 搬到快照缓存 + 通用按特性注册表

**为什么挂在我这里**：三个目标文件都不在本轮可改面
（`src/lspHighlightingCache.ts`、`src/components/CodeEditor.vue`、`tests/lsp-highlighting-cache.test.mjs`），
而 `CodeEditor.vue` 在派单的禁改清单里。

**现状（实测，不是猜）**
- `src/lspHighlightingCache.ts` 只有通用容器：`:160` `class HighlightingSnapshotCache<T>`（含 `fileEdited` /
  `pullPlan` / `acceptFull` / `acceptUnchanged` / `invalidate` / `forceFullRepull` / `clearCache`），
  **没有**注册表，也没有按特性的实例；
- 唯一的实例化点在 `src/lspNavigation.ts:197`（`diagnosticRanges`，只服务诊断）；
- 语义 token 的"按文件记忆"**不在本仓的缓存里**：`src/components/CodeEditor.vue:306-307` 是两个
  `let semanticResultId = ''` / `let semanticData: number[] = []`，换文档时 `:308-311` `resetSemanticTokens()`
  直接清空 ⇒ 切回原文件必然整份重拉（`resultId` 也没了，服务端只能回 Full）；
  `:303-305` 的注释已经点明"`resultId` 与压缩数组必须成对维护"，所以搬的时候两个要一起进同一个桶；
- 上游对照：`platform/lsp-impl/src/impl/features/highlighting/LspSemanticTokensCache.kt` 与
  `platform/lsp-impl/src/impl/features/highlighting/LspDocumentLinkCache.kt:17-35` 都是
  `LspHighlightingCache` 的子类，经
  `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:28-29`
  注册成 `semanticTokensCache` / `documentLinkCache` 两个成员；消费方是
  `platform/lsp-impl/src/impl/LspClientImpl.kt:270`（`getSemanticTokens`）与 `:285`（documentLink）。

**要接什么（1）：`src/lspHighlightingCache.ts` 末尾追加（可照抄）**

```ts
// ---------------------------------------------------------------- 按特性的注册表（LspHighlightingCacheRegistry）

/**
 * 上游注册进 registry 的九个特性名，逐字照
 * `platform/lsp-impl/src/impl/features/highlightingCommon/LspHighlightingCacheRegistry.kt:26-35`
 * （`:26-27` push/pull 诊断、`:28` semanticTokens、`:29` documentLink、
 *   `:31-35` inlayHints / documentColor / foldingRange / codeLens / inheritanceMarkers）。
 * 名字不在此列的特性别往这里加 —— `documentHighlight` 上游就**不在** registry 里
 * （它是 `LspDocumentHighlightCache.kt` 的单槽缓存，走 `LspSingleSlotCache` 那一族）。
 */
export type HighlightingFeature =
  | 'publishDiagnostics' | 'pullDiagnostics' | 'semanticTokens' | 'documentLink'
  | 'inlayHints' | 'documentColor' | 'foldingRange' | 'codeLens' | 'inheritanceMarkers'

/** 注册表只要求缓存有这几个同步口（= `HighlightingSnapshotCache` 已经全部提供的面）。 */
export interface RegistryCache {
  fileEdited(file: string, edit: PendingEdit): void
  invalidate(file: string): void
  forceFullRepull(file: string): void
  clearCache(): void
}

/**
 * `LspHighlightingCacheRegistry` 的同步版：按特性注册一份缓存，生命周期动作 fan-out 给全部成员。
 * `supportsPull` 缺省除 `publishDiagnostics` 外全为 true —— 上游只有那一个显式写了
 * `override val supportsPull: Boolean get() = false`
 * （`platform/lsp-impl/src/impl/features/highlighting/LspPublishDiagnosticsCache.kt:31`），
 * 因为 push 那一份是服务端自己重推的，`invalidatePulledResults` 不该去碰它
 * （`LspHighlightingCacheRegistry.kt:50-56` 的注释原话）。
 */
export class HighlightingCacheRegistry {
  private readonly entries: Array<{ feature: HighlightingFeature; cache: RegistryCache; supportsPull: boolean }> = []

  register(feature: HighlightingFeature, cache: RegistryCache,
           options: { supportsPull?: boolean } = {}): RegistryCache {
    if (this.entries.some(entry => entry.feature === feature)) throw new Error(`高亮缓存特性重复注册：${feature}`)
    this.entries.push({ feature, cache, supportsPull: options.supportsPull ?? feature !== 'publishDiagnostics' })
    return cache
  }

  cacheFor(feature: HighlightingFeature): RegistryCache | undefined {
    return this.entries.find(entry => entry.feature === feature)?.cache
  }

  /** `LspHighlightingCacheRegistry.kt:42-44`：一次编辑要同时平移九个特性的区间。 */
  fileEdited(file: string, edit: PendingEdit): void {
    for (const entry of this.entries) entry.cache.fileEdited(file, edit)
  }

  /** `:54-56`：服务端作废结果时只重拉「能拉的那几份」，push 的留给服务端自己重推。 */
  invalidatePulledResults(file: string): void {
    for (const entry of this.entries) if (entry.supportsPull) entry.cache.forceFullRepull(file)
  }

  /** `:46-48`（调用方 `LspClientImpl.kt:398`）：换服务器 / 关项目时全清。 */
  clearCache(): void {
    for (const entry of this.entries) entry.cache.clearCache()
  }

  features(): HighlightingFeature[] {
    return this.entries.map(entry => entry.feature)
  }
}
```

**要接什么（2）：`src/lspNavigation.ts` 用注册表替掉"只有一个诊断缓存"的局面**
`src/lspNavigation.ts:197`（`const diagnosticRanges = new HighlightingSnapshotCache<LspDiagnostic>({…})`）之后把实例注册进去，
并把编辑回调里那一行直接调用（`src/lspNavigation.ts:223`
`diagnosticRanges.fileEdited(path, textEditBetween(previous, text))`）改成
`highlightingCaches.fileEdited(path, textEditBetween(previous, text))`：

```ts
const highlightingCaches = new HighlightingCacheRegistry()
// push 那份：本仓的宿主把 publishDiagnostics 与 pull 的结果都折进 lspDiagnostics，
// 所以两者共用同一条区间轨道，但 supportsPull 各自如实。
highlightingCaches.register('publishDiagnostics', diagnosticRanges, { supportsPull: false })
```
`import { ..., HighlightingCacheRegistry } from './lspHighlightingCache.ts'` 加进 `:43-45` 那个 import 块。

**要接什么（3）：`src/components/CodeEditor.vue:306-311`（禁改文件，由该 lane 落地）**
把两个 `let` 换成"按 path 分桶 + 走 `HighlightingSnapshotCache`"，判据是**切走再切回不重拉**：

```ts
// 语义着色的按文件快照（上游 `LspSemanticTokensCache`，经 LspHighlightingCacheRegistry.kt:28 注册）：
// `resultId` 与压缩数组**必须成对**（它们一起进同一个桶），否则 delta 的 edits 会打在错的数组上。
const semanticSnapshots = new HighlightingSnapshotCache<{ resultId: string; data: number[] }>()
```
`resetSemanticTokens()` 改为 `semanticSnapshots.invalidate(props.path)`（保留内容到新结果落地，不闪断 ——
上游 `LspHighlightingCache.kt` 的 `invalidate` 就是这个语义），
`runSemanticTokens()` 里读写 `semanticResultId` / `semanticData` 的两处换成
`semanticSnapshots.highlightingsFor(props.path)[0]?.highlightingInfo` 与 `acceptFull(...)`。
**这一步由 CodeEditor 那条 lane 做**：我没有行号可给的地方是 `RangeSetBuilder` 之外的那几处
`props.path` 竞态保护（`:325-327` 的 `target !== editor` 判断），改的时候必须一并保住。

**判据补在 `tests/lsp-highlighting-cache.test.mjs`**（本轮不可改）：
① 九个特性名逐个 `register` + 重复注册抛错；② `fileEdited` 一次调用要动到**所有**已注册缓存
（用两个假缓存计数）；③ `invalidatePulledResults` 不打扰 `publishDiagnostics`
（钉 `LspPublishDiagnosticsCache.kt:31` 那条 `supportsPull = false`）；④ `clearCache` 清全部。

**接不上的那 5 个特性如实说明**：`inlayHints` / `documentColor` / `foldingRange` / `codeLens` /
`inheritanceMarkers` 现在**没有**宿主触发通道 —— 实测
`grep -rn "invalidateServerResults\|workspace/diagnostic/refresh\|semanticTokens/refresh\|codeLens/refresh" src/ native/`
⇒ 0 命中，上游那三个 refresh 处理器（`platform/lsp-impl/src/impl/LspClientImpl.kt:223`、`:235`、`:260`）
本仓都还没桥接。任务清单里已有「lsp 域：服务器主动消息/请求的响应面（logMessage + showMessageRequest + refresh）」
这一条（别的 lane 在途），所以 **`invalidatePulledResults` 的真实调用方要等那条线**；
在那之前只注册有消费链路的特性（诊断 + semanticTokens + documentLink），别把九个都塞进去当摆设。
上游那三个 refresh 处理器的实测行号：
`platform/lsp-impl/src/impl/LspClientImpl.kt:223`（`invalidateServerResults`）、`:235`（`refreshSemanticTokens`）、
`:260`（`refreshDiagnostics`）。

## W2 · 语言服务重启 / refresh 时清掉整工程检查的两份缓存 —— **本轮自己闭环了，不需要接线（留作记录）**

- 我原本要请求的：在 `src/App.vue:1527`（`const workspaceDiagnosticIds = new Map<string, string>()`）旁挂一个
  `watch(lspReady, ready => { if (!ready) ... })`，好让 `src/workspaceInspection.ts` 自持的那两份诊断缓存
  跟着语言服务一起清（上游 `platform/lsp-impl/src/impl/LspClientImpl.kt:398` 的
  `highlightingCacheRegistry.clearCache()`）。
- **实测之后发现不用动保留文件**：本仓已经有那张注册表与两个生产触发点 ——
  `src/lspPerFileCache.ts:39-55`（`registerLspCache` / `clearAllLspCaches` / `lspCacheCount`）、
  `src/lsSessionHost.ts:163`（`resetLspSession()` 里整批作废）、
  `src/lspProgress.ts:181-187`（服务器 `workspace/…/refresh` → `clearAllLspCaches()`）。
  所以 `DiagnosticSourceCaches` 改成 `implements LspCache` + 构造时 `registerLspCache(this)`
  （`src/workspaceDiagnostics.ts:168,172-176`），**自己就进了那一次整批作废**，
  我原先准备的 `resetWorkspaceDiagnosticSources()` 导出也据此删掉（不留只过自己测试的死出口）。
- 剩下的只有一条**语义差异**（不是接线）：上游按单个缓存清（`LspClientImpl.kt:235` 只清 `semanticTokensCache`），
  本仓一次清整族 —— 代价是"下一次读重新请求一次"，`src/lspPerFileCache.ts:37-38` 已如实写明。
- 另外提醒：`tests/workspace-diagnostics.test.mjs:79` 那一条会读 `previousResultIds`，
  而 `resultIds` 那张表仍由 `src/App.vue:1537` 注入、**没人清**。重启后把旧 resultId 发给新服务器
  这一条仍然成立（本轮之前就是这样，不是我引入的）。要清就在 `src/App.vue` 的
  `workspaceDiagnosticIds` 旁边加一行 `workspaceDiagnosticIds.clear()` 的 watch —— 一行，保留文件，
  所以我停在这里，请主代理定夺。

## W3 · 上一轮的 R1 仍然挂着（我只提醒，不重复贴代码）

`docs/wiring-requests-2026-10-06-problems.md` 的 **R1**（`native/lsp_support.cpp` 的 `shape_diagnostics`
透传 `relatedInformation` + `src/bridge.ts` 的 `LspDiagnostic` 加两格）本轮**没有动**：派单写明
lsp lane 在途、宿主文件不许碰。前端消费链（`src/problems.ts`、`src/problemRelatedInformation.ts`、
`src/components/ProblemsPanel.vue:738-743`）与判据（`tests/problem-related.test.mjs`）都还在原地等数据，
宿主一旦透传就生效。R2/R3/R4 同理，目标文件仍分别是 `src/App.vue` / `src/keymapBindings.ts` / `src/actionRegistry.ts`。
