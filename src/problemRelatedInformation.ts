// LSP `Diagnostic.relatedInformation` → 问题面板的「相关位置」 —— `dm/problems-view` 判词里
// 「Project Problems 的成员级关联问题」那条缺口的**可移植子集**。
//
// 上游基准（逐条在本机参考树里核对过，行号实测）：
//   · `platform/lsp-impl/src/impl/features/highlighting/LspDiagnosticAndLazyQuickFixes.kt:35-43`
//     —— LSP 宿主把服务器给的诊断字段**原样保留**进它持有的注解数据，其中
//     `:39 this.codeDescription = diagnostic.codeDescription`、`:42 this.relatedInformation = diagnostic.relatedInformation`；
//     也就是说这条链上游没有裁，客户端拿到就呈现得了。
//   · 整棵树里 `relatedInformation` 只有这一处引用点（`grep -rn relatedInformation platform/` 只命中这一行），
//     上游**没有** problems-view 侧的呈现坐标（`ProblemDescriptorBase.java` 在本机树里没有 related 字段，
//     `RelatedProblem`/`BrokenUsage` 那批类不在本地基准里）。⇒ 本节只照两件事：
//     「字段原样透传」+「本仓既有 reveal 通道跳过去」，不编上游文案、不编树形节点。
//
// 本仓落点：`src/problems.ts` 的 `ProblemRow.related` 原样透传，`ProblemsPanel.vue` 的行菜单里
// 多一节「相关位置」，点一条就走已有的 `reveal` 事件（与问题行本身的跳源同一条通道）。
//
// 链路的最后一环在宿主：`native/lsp_support.cpp` 的 `shape_diagnostics` 目前不把 `relatedInformation`
// 带出来（`src/bridge.ts` 的 `LspDiagnostic` 也没有这个字段），所以前端拿到的永远是 undefined ⇒
// 这一节一行都不出现。**不是假控件**：没数据就不渲染，与上游「没有关联位置就没有那一节」同效；
// 宿主与桥类型的透传已写进 `docs/wiring-requests-2026-10-06-problems.md` R1，接上后本模块零改动即生效。
import type { ProblemRow } from './problems.ts'

/**
 * 一条相关位置的线上形态（与接线请求 R1 给宿主的形状逐字段对齐）：
 * `line`/`character` 是 **0 基**文档坐标（与 `LspDiagnostic` 同一折法，同一函数里的 `nvl` 宏），
 * `path` 只有指向**别的文件**时才有（宿主用 `shape_diagnostics` 已有的 file URI → 工作区相对路径折法给），
 * 没有 `path` 就表示与父问题同文件。
 */
export interface RelatedLocationInput {
  line?: number | null
  character?: number | null
  message?: string | null
  path?: string | null
  /** LSP 原样形态（宿主没折的时候）：`{ location: { uri, range: { start } } }`。 */
  location?: { uri?: string; range?: { start?: { line?: number; character?: number } } } | null
}

/** 折好的一条相关位置（面板直接画这一份，坐标已定、路径已定）。 */
export interface RelatedLocation {
  /** 相关位置所在文件（工作区相对路径；与 `ProblemRow.path` 同基准）。 */
  path: string
  /** 0 基行号（渲染时 +1，与问题行同一口径）。 */
  line: number
  character: number
  message: string
  /** 是否指向另一个文件（面板据此在标题里带上路径，同文件时只带行号）。 */
  foreign: boolean
}

/** 一条坐标是否可用：整数、非负（LSP 的 range 越界与 null 都在这里挡掉，不画 `第 NaN 行`）。 */
function validPosition(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null
  return n
}

/**
 * 一条问题带几条关联位置：把 `related` 折成面板可画的一组位置。
 *
 * 规则（为什么这么折）：
 *   · 丢掉**没有消息**的条目 —— 这一节的每一行都要说清「那个位置怎么了」，上游给的面板条目也带 message；
 *   · 丢掉**行号不可用**的条目（非整数/负数/缺字段）；列号缺失按 0（LSP 的 `character` 是必填，
 *     缺了就说明服务端没给，退到行首而不是退到 NaN）；
 *   · 按「是否指向别的文件 → 路径 → 行 → 列」排序：同文件的先列（多数相关位置在本文件里），
 *     跨文件的排在后面并带上路径；
 *   · 完全相同的位置（同文件同行同列同消息）只留一条 —— 服务端偶尔把同一个位置报两遍
 *     （`relatedInformation` 是数组，没有唯一性约束）。
 * 空数组 = 这一节不渲染。
 */
export function relatedLocationsOf(row: Pick<ProblemRow, 'path'>, related?: readonly RelatedLocationInput[] | null): RelatedLocation[] {
  if (!Array.isArray(related) || related.length === 0) return []
  const seen = new Set<string>()
  const out: RelatedLocation[] = []
  for (const item of related) {
    if (!item) continue
    const message = typeof item.message === 'string' ? item.message.trim() : ''
    if (!message) continue
    // 两种线上形态都接：宿主按接线请求 R1 折好的 `{ line, character, message, path? }`，
    // 以及 LSP 原样的 `{ location: { uri, range: { start } }, message }`（服务器直给、宿主没折的时候）。
    const start = item.location?.range?.start
    const line = validPosition(item.line ?? start?.line)
    if (line === null) continue
    const rawCharacter = item.character ?? start?.character
    const character = rawCharacter === undefined || rawCharacter === null ? 0 : validPosition(rawCharacter)
    if (character === null) continue
    const given = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : ''
    const uri = item.location?.uri
    // 只带 file URI、没有宿主映射的条目丢掉（见 `RelatedLocationInput.location` 的注释：猜错位置比少列一行更糟）。
    if (!given && typeof uri === 'string' && uri.length > 0) continue
    const path = given || row.path
    const foreign = path !== row.path
    const key = `${foreign ? path : ''}|${line}|${character}|${message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, line, character, message, foreign })
  }
  out.sort((a, b) => Number(a.foreign) - Number(b.foreign) ||
                    a.path.localeCompare(b.path) || a.line - b.line || a.character - b.character)
  return out
}

/** 面板用：这一条问题有没有相关位置（空数组就不渲染那一节）。 */
export function relatedOf(row: ProblemRow): RelatedLocation[] {
  return relatedLocationsOf(row, row.related)
}

/**
 * 相关位置的**一行文案**（面板与判据共用这一把，别处不再各拼一遍）：
 * 同文件只报「第 N 行」（与问题行本身的 `ref-pos` 同一口径：0 基 → 1 基），
 * 跨文件带上路径（上游的 reveal 通道在本仓是 `{ path, line }`，见 `ProblemsPanel.vue` 的 `emit('reveal')`）。
 */
export function relatedLocationText(loc: RelatedLocation): string {
  return loc.foreign ? `${loc.path}:${loc.line + 1}：${loc.message}`
    : `第 ${loc.line + 1} 行：${loc.message}`
}
