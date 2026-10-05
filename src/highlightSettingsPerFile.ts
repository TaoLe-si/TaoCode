// 逐文件高亮级别（上游 `com.intellij.codeInsight.daemon.impl.HighlightingSettingsPerFile`
// + `HighlightingLevelManager` + `HighlightingLevel` 三档）。
//
// 上游行为：每个文件可以单独设置高亮级别 ——
//   · `NONE`        不做任何高亮（连语法错误都不画）；
//   · `SYNTAX`      只留语法错误，inspection 不跑；
//   · `INSPECTIONS` 全量（默认）。
// 级别存在工程的 `HighlightingSettingsPerFile` 服务里（按文件覆盖默认值），
// 编辑器/StatusBar 的级别弹层与分析运行时都读同一份判定。
//
// 本仓的等价物：没有 PSI/语法树，级别只能作用在**诊断聚合**这一步 ——
// `src/problems.ts` 在把 LSP/本地诊断折成 `ProblemRow` 之前问一次本模块：
//   · `none`        该文件的诊断整条丢掉；
//   · `syntax`      只留 severity 1（错误）—— 本仓没有「语法错误 vs 类型错误」的区分，
//                   按错误档近似（比 IDEA 的 SYNTAX 略宽：类型错误也会留下，如实记在这里）；
//   · `inspections` 全留（默认）。
//
// 与 `src/analysisIgnore.ts` 的分工（上游也是两个机制）：分析忽略是「这个文件不参与分析」，
// 三档级别是「分析结果里要哪一档」；两者都在聚合前生效，叠加关系与本文件一致。
//
// 持久化沿用应用级用户数据的口径：`localStorage`（与 `taocode.analysisIgnore.*` 同族）。
import { ref } from 'vue'

/** 上游 `HighlightingLevel` 的三档（顺序即菜单里的呈现顺序）。 */
export type HighlightingLevel = 'none' | 'syntax' | 'inspections'

export interface HighlightingLevelOption {
  id: HighlightingLevel
  label: string
  /** 菜单里的一行说明（上游三档的 tooltip 口径）。 */
  description: string
}

export const HIGHLIGHTING_LEVELS: readonly HighlightingLevelOption[] = [
  { id: 'none', label: '无', description: '不显示该文件的任何高亮与问题' },
  { id: 'syntax', label: '仅语法', description: '只保留错误级诊断（本仓按 LSP severity 1 近似）' },
  { id: 'inspections', label: '检查', description: '全量诊断（默认）' },
]

const STORAGE_KEY = 'taocode.highlightLevels'
const LEVEL_IDS: readonly HighlightingLevel[] = HIGHLIGHTING_LEVELS.map(option => option.id)

/** 按文件覆盖的级别表（路径按 `/` 归一化；只存非默认值）。 */
export const highlightLevelsPerFile = ref<Record<string, HighlightingLevel>>(readStored())

function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

function readStored(): Record<string, HighlightingLevel> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, HighlightingLevel> = {}
    for (const [path, level] of Object.entries(parsed)) {
      if (typeof path === 'string' && LEVEL_IDS.includes(level as HighlightingLevel)) out[normalize(path)] = level as HighlightingLevel
    }
    return out
  } catch {
    return {}
  }
}

function writeStored(value: Record<string, HighlightingLevel>) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的级别照常生效（与 analysisIgnore 同口径）。
  }
}

/** 这个文件当前的级别（没有覆盖就是默认的 `inspections`）。 */
export function highlightLevelForPath(path: string): HighlightingLevel {
  return highlightLevelsPerFile.value[normalize(path)] ?? 'inspections'
}

/** 设置/清除一个文件的级别（设为默认档 = 删掉覆盖，上游的 Revert 语义）。 */
export function setHighlightLevelForPath(path: string, level: HighlightingLevel): void {
  const normalized = normalize(path)
  const next = { ...highlightLevelsPerFile.value }
  if (level === 'inspections') delete next[normalized]
  else next[normalized] = level
  highlightLevelsPerFile.value = next
  writeStored(next)
}

/** 已覆盖的文件清单（面板的级别清单一栏；按路径排序，稳定呈现）。 */
export function highlightLevelEntries(): Array<{ path: string; level: HighlightingLevel }> {
  return Object.entries(highlightLevelsPerFile.value)
    .map(([path, level]) => ({ path, level }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 清空全部逐文件级别（恢复默认）。 */
export function clearHighlightLevels(): void {
  highlightLevelsPerFile.value = {}
  writeStored({})
}

/**
 * 聚合门控：这个级别下，该严重度的一条诊断要不要保留。
 * `syntax` 档只留错误（severity 1）；其余两档在调用点已经分流（`none` 整文件丢）。
 */
export function keepsDiagnosticAtLevel(level: HighlightingLevel, severity: number): boolean {
  if (level === 'none') return false
  if (level === 'syntax') return severity <= 1
  return true
}
