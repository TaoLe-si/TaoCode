// 覆盖率报告的**收集与解析**（上游 `execution/coverage` 的 `CoverageSuite` / `CoverageDataManager`
// 里"读报告"那半的可移植子集）。
//
// 为什么只做这半：上游 Java 覆盖率的**采集**靠 JVM 侧 `-javaagent`（`com.intellij.coverage` 的
// `CoverageRunner` 把收集器注入被测进程，退出后读回 .ic/.exec 数据），本仓宿主只做 CreateProcess、
// DAP 客户端（native/dap*.cpp）也没有覆盖率面的请求/事件 —— 没有真实数据源就不该画进度条。
// 但**报告文件**是真实存在的：Gradle/Maven 的 JaCoCo 插件（以及 Kover）会把 XML 报告写进工作区，
// 本模块：
//   1. 在工作区文件清单里认出这些标准报告位置（`collectCoverageReportPath`）；
//   2. 解析 JaCoCo 的 XML（`<package>/<sourcefile>` 的 LINE 计数器）；
//   3. 汇总成可展示的行覆盖模型（每文件 covered/missed/percent + 总计）。
// 消费点：`src/components/RunConsole.vue` 的「覆盖率」区（运行结束后自动尝试 + 手动重读）。
//
// 纯函数、零宿主依赖，判据 tests/coverage-report.test.mjs。

export interface CoverageFileSummary {
  /** 报告里的源文件路径（JaCoCo 用 `/` 分隔，包路径 + 文件名）。 */
  path: string
  coveredLines: number
  missedLines: number
  /** 行覆盖率百分比（0-100，保留一位小数）；总行数为 0 时是 0。 */
  percent: number
}

export interface CoverageSummary {
  /** 读的是哪个报告文件（工作区相对/绝对路径）。 */
  reportPath: string
  files: CoverageFileSummary[]
  coveredLines: number
  missedLines: number
  percent: number
  /** 文件数超过上限被截断（避免超大报告把面板撑爆）。 */
  truncated: boolean
}

/** 最多展示多少个源文件。 */
export const MAX_COVERAGE_FILES = 500

/**
 * 标准报告位置（Gradle JaCoCo `build/reports/jacoco/…/*.xml`、Maven JaCoCo
 * `target/site/jacoco/jacoco.xml`、Kover `build/reports/kover/*.xml`、手放的 `coverage/*.xml`）。
 * 路径按 `/` 归一化后匹配（调用方负责把反斜杠换掉）。
 */
const REPORT_LOCATION = /(?:^|\/)(?:build\/reports\/(?:jacoco|kover)\/.*\.xml|target\/site\/(?:jacoco|kover)\/.*\.xml|coverage\/.*\.xml)$/i

export function isCoverageReportPath(path: string): boolean {
  return REPORT_LOCATION.test(path.replace(/\\/g, '/'))
}

/**
 * 从工作区文件清单里挑一个报告：
 * 优先 `jacocoTestReport.xml` / `jacoco.xml`（Gradle/Maven 的默认产物名），其次路径最短的。
 */
export function collectCoverageReportPath(files: readonly string[]): string | null {
  const candidates = files.filter(isCoverageReportPath)
  if (!candidates.length) return null
  const normalized = (path: string) => path.replace(/\\/g, '/')
  const rank = (path: string): number => {
    const base = normalized(path).split('/').pop() ?? ''
    if (base === 'jacocoTestReport.xml') return 0
    if (base === 'jacoco.xml') return 1
    if (/jacoco/i.test(base)) return 2
    return 3
  }
  return [...candidates].sort((left, right) => rank(left) - rank(right)
    || normalized(left).length - normalized(right).length
    || normalized(left).localeCompare(normalized(right)))[0] ?? null
}

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (whole, entity: string) => {
    switch (entity) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return whole
    }
  })
}

function percentOf(covered: number, missed: number): number {
  const total = covered + missed
  return total > 0 ? Math.round((covered / total) * 1000) / 10 : 0
}

const LINE_COUNTER = /<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/>/

/**
 * 解析 JaCoCo 报告。结构：`<report><package name="com/x"><sourcefile name="Y.java">
 * <counter type="LINE" missed=".." covered=".."/></sourcefile></package>…</report>`；
 * 没有 `<sourcefile>`（例如只导出的总览报告）时退回报告根上的 LINE 计数器。
 */
export function parseJacocoXml(xml: string, reportPath: string): CoverageSummary {
  const files: CoverageFileSummary[] = []
  const packagePattern = /<package\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g
  let packageMatch: RegExpExecArray | null
  while ((packageMatch = packagePattern.exec(xml)) !== null) {
    const packageName = decodeXml(packageMatch[1]!)
    const body = packageMatch[2]!
    const sourcePattern = /<sourcefile\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/sourcefile>/g
    let sourceMatch: RegExpExecArray | null
    while ((sourceMatch = sourcePattern.exec(body)) !== null) {
      const name = decodeXml(sourceMatch[1]!)
      const counter = LINE_COUNTER.exec(sourceMatch[2]!)
      if (!counter) continue
      const missed = Number(counter[1])
      const covered = Number(counter[2])
      files.push({
        path: packageName ? `${packageName}/${name}` : name,
        coveredLines: covered,
        missedLines: missed,
        percent: percentOf(covered, missed),
      })
    }
  }
  let coveredLines = 0
  let missedLines = 0
  if (files.length) {
    for (const file of files) { coveredLines += file.coveredLines; missedLines += file.missedLines }
  } else {
    // 没有 sourcefile：用报告根上的 LINE 计数器（总览报告）。
    const rootCounters = xml.match(/<counter\s+type="LINE"[^>]*\/>/g) ?? []
    for (const counter of rootCounters) {
      const parsed = LINE_COUNTER.exec(counter)
      if (!parsed) continue
      missedLines += Number(parsed[1])
      coveredLines += Number(parsed[2])
    }
  }
  const truncated = files.length > MAX_COVERAGE_FILES
  return {
    reportPath,
    files: truncated ? files.slice(0, MAX_COVERAGE_FILES) : files,
    coveredLines,
    missedLines,
    percent: percentOf(coveredLines, missedLines),
    truncated,
  }
}
