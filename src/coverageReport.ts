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
  /** 逐包聚合（JaCoCo `<package>` 分组，按包名排序）：`CoverageSuite` 包级汇总的等价物。 */
  packages: CoveragePackageSummary[]
  /** 逐类聚合（JaCoCo `<class>` 的 LINE 计数器）；报告没给 class 时为空。 */
  classes: CoverageClassSummary[]
  /** 类数超过上限被截断。 */
  classesTruncated: boolean
  /** 逐方法聚合（JaCoCo `<method>` 的 LINE 计数器）；报告没给 method 时为空。 */
  methods: CoverageMethodSummary[]
  /** 方法数超过上限被截断。 */
  methodsTruncated: boolean
  /** 报告的格式（决定 UI 说"读的是哪种报告"，也用于诊断为什么解析出 0 行）。 */
  format: CoverageFormat
}

/** 本仓认的覆盖率报告格式。 */
export type CoverageFormat = 'jacoco' | 'cobertura' | 'lcov' | 'unknown'

/** 一个包（JaCoCo `<package name>`）的聚合行。 */
export interface CoveragePackageSummary {
  /** 包名（`/` 分隔，与 JaCoCo 一致；默认包是空串）。 */
  name: string
  files: CoverageFileSummary[]
  coveredLines: number
  missedLines: number
  percent: number
}

/** 一个类（JaCoCo `<class name sourcefilename>`）的行覆盖。 */
export interface CoverageClassSummary {
  /** 全限定名（JaCoCo 用 `/` 分隔，如 `com/example/Main`）。 */
  name: string
  /** 它属于哪个源文件（`sourcefilename`；报告没给就是空串）。 */
  sourceFile: string
  coveredLines: number
  missedLines: number
  percent: number
}

/**
 * 一个方法（JaCoCo `<method name desc>`）的行覆盖 —— `CoverageSuite` 方法级汇总的等价物。
 * 上游 `execution/coverage` 的 `CoverageDataManager` 在类级之下还有方法级聚合，
 * IDEA 的「覆盖率报告视图」按方法展开（哪个分支没走到）。
 */
export interface CoverageMethodSummary {
  /** 方法名（JaCoCo `<method name>`，不含签名）。 */
  name: string
  /** 它属于哪个类（`<class name>`，`/` 分隔）。 */
  className: string
  /** 它属于哪个源文件（`<class sourcefilename>`；报告没给就是空串）。 */
  sourceFile: string
  coveredLines: number
  missedLines: number
  percent: number
}

/** 最多展示多少个类（`CoverageSuite` 的类级汇总用；超大报告只留前 N 个）。 */
export const MAX_COVERAGE_CLASSES = 2000

/** 最多展示多少个方法（方法级汇总用；超大报告只留前 N 个）。 */
export const MAX_COVERAGE_METHODS = 4000

/** 最多展示多少个源文件。 */
export const MAX_COVERAGE_FILES = 500

/**
 * 标准报告位置（Gradle JaCoCo `build/reports/jacoco/…/*.xml`、Maven JaCoCo
 * `target/site/jacoco/jacoco.xml`、Kover `build/reports/kover/*.xml`、手放的 `coverage/*.xml`）。
 * 路径按 `/` 归一化后匹配（调用方负责把反斜杠换掉）。
 */
const REPORT_LOCATION = /(?:^|\/)(?:build\/reports\/(?:jacoco|kover)\/.*\.xml|target\/site\/(?:jacoco|kover)\/.*\.xml|coverage\/.*\.xml|coverage\/.*\.info|(?:^|\/)(?:lcov|coverage)\.info)$/i

export function isCoverageReportPath(path: string): boolean {
  return REPORT_LOCATION.test(path.replace(/\\/g, '/'))
}

/** 报告格式（按路径/文件名判定，内容再兜底一次）。 */
export function coverageFormatOf(path: string): CoverageFormat {
  const normalized = path.replace(/\\/g, '/')
  const base = normalized.split('/').pop() ?? ''
  if (/\.info$/i.test(base) || /^lcov\./i.test(base)) return 'lcov'
  if (/cobertura/i.test(base)) return 'cobertura'
  if (/jacoco|kover/i.test(normalized)) return 'jacoco'
  return 'unknown'
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

/** 空汇总（格式认不出/内容为空时的诚实答案：0 行覆盖 + format:'unknown'）。 */
function emptySummary(reportPath: string, format: CoverageFormat): CoverageSummary {
  return {
    reportPath, files: [], coveredLines: 0, missedLines: 0, percent: 0, truncated: false,
    packages: [], classes: [], classesTruncated: false,
    methods: [], methodsTruncated: false, format,
  }
}

/**
 * **格式分发入口**：UI 只调这一个（`parseCoverageReport`），JaCoCo/Cobertura 走 XML 解析、
 * LCOV 走 `.info` 文本解析。按文件名判格式，认不出时看内容（`<report`/`<coverage`/`SF:`）。
 * 这样 `src/components/RunConsole.vue` 的消费点不用知道报告是哪种格式。
 */
export function parseCoverageReport(content: string, reportPath: string): CoverageSummary {
  let format = coverageFormatOf(reportPath)
  if (format === 'unknown') {
    if (/^\s*SF:/m.test(content)) format = 'lcov'
    else if (/<coverage\b/i.test(content)) format = 'cobertura'
    else if (/<report\b/i.test(content)) format = 'jacoco'
  }
  if (format === 'lcov') return parseLcovInfo(content, reportPath)
  if (format === 'cobertura') return parseCoberturaXml(content, reportPath)
  return parseJacocoXml(content, reportPath)
}

/**
 * 解析 LCOV `.info`（`lcov.info`/`coverage/lcov.info`；C/C++/JS/Rust 覆盖率工具的通用格式）。
 *
 * 结构是逐文件记录：`SF:<源文件>` 开头，`LF:<总行数>` / `LH:<命中行数>` 汇总，
 * 中间每个 `DA:<行号>,<命中次数>` 是一行；`end_of_record` 收尾。
 * 本仓只取行覆盖：每个 `SF:` 段成一条 file（命中 = 命中次数 > 0 的 DA 行数，
 * 未命中 = LF - 命中）；`LF`/`LH` 缺失时按 DA 行自己数。
 * 没有包/类/方法概念（LCOV 是文件级），所以 packages/classes/methods 都是空表 ——
 * 不编造层级，UI 就按"逐文件"展示。
 */
export function parseLcovInfo(text: string, reportPath: string): CoverageSummary {
  const files: CoverageFileSummary[] = []
  let coveredLines = 0
  let missedLines = 0
  let current: { path: string; hit: number; total: number } | null = null
  const finish = () => {
    if (!current) return
    const missed = Math.max(0, current.total - current.hit)
    files.push({ path: current.path, coveredLines: current.hit, missedLines: missed, percent: percentOf(current.hit, missed) })
    coveredLines += current.hit
    missedLines += missed
    current = null
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('SF:')) {
      finish()
      current = { path: line.slice(3).replace(/\\/g, '/'), hit: 0, total: 0 }
    } else if (!current) {
      continue
    } else if (line.startsWith('DA:')) {
      const comma = line.indexOf(',', 3)
      const hits = Number(line.slice(comma + 1).split(',')[0])
      if (!Number.isFinite(hits)) continue
      current.total += 1
      if (hits > 0) current.hit += 1
    } else if (line === 'end_of_record') {
      finish()
    }
  }
  finish()
  const truncated = files.length > MAX_COVERAGE_FILES
  return {
    reportPath,
    files: truncated ? files.slice(0, MAX_COVERAGE_FILES) : files,
    coveredLines, missedLines, percent: percentOf(coveredLines, missedLines), truncated,
    packages: [], classes: [], classesTruncated: false,
    methods: [], methodsTruncated: false, format: 'lcov',
  }
}

/**
 * 解析 Cobertura XML（`coverage.xml`/`cobertura.xml`；Python coverage.py、gcovr、Cobertura 的输出）。
 *
 * 结构：`<coverage><packages><package name="…"><classes>
 * <class name="…" filename="…"><methods><method name="…"><lines>
 * <line number=".." hits=".."/></method></methods><lines><line number=".." hits=".."/></lines></class>…`。
 * 本仓取行覆盖：每个 `<class>` 成一条 file（`filename`，命中 = hits>0 的 `<line>` 数）；
 * 逐方法聚合照 `<method>` 的 `<line>` 计数器（Cobertura 有方法级，JaCoCo 也有 —— 两边的
 * `methods` 形状一致）；方法归属由它所在的 `<class>` 决定（`className` = `<class name>`、
 * `sourceFile` = `<class filename>`），与 JaCoCo 那一支同一条规则。
 * `<package>` 分组照 `<package name>`。
 */
export function parseCoberturaXml(xml: string, reportPath: string): CoverageSummary {
  const files: CoverageFileSummary[] = []
  const packages: CoveragePackageSummary[] = []
  const classes: CoverageClassSummary[] = []
  const methods: CoverageMethodSummary[] = []
  const countLines = (body: string): { covered: number; missed: number } => {
    let covered = 0
    let missed = 0
    const pattern = /<line\s[^>]*\bhits="(\d+)"/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body)) !== null) {
      if (Number(match[1]) > 0) covered += 1
      else missed += 1
    }
    return { covered, missed }
  }
  const packagePattern = /<package\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g
  let packageMatch: RegExpExecArray | null
  while ((packageMatch = packagePattern.exec(xml)) !== null) {
    const packageName = decodeXml(packageMatch[1]!)
    const body = packageMatch[2]!
    const packageFiles: CoverageFileSummary[] = []
    const classPattern = /<class\s+name="([^"]*)"(?:\s+filename="([^"]*)")?[^>]*>([\s\S]*?)<\/class>/g
    let classMatch: RegExpExecArray | null
    while ((classMatch = classPattern.exec(body)) !== null) {
      const className = decodeXml(classMatch[1]!)
      const filename = decodeXml(classMatch[2] ?? '')
      const classBody = classMatch[3]!
      // 方法级（Cobertura `<method name>` 在 `<class>` 里）：归属由它所在的 `<class>` 决定 ——
      // 与 JaCoCo 那一支同一条规则（`className`/`sourceFile` 都填上），否则方法行在
      // 「按方法」档里没有归属可显示（`coverageViewSection` 的 detail 会退化成空串）。
      const methodPattern = /<method\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/method>/g
      let methodMatch: RegExpExecArray | null
      while ((methodMatch = methodPattern.exec(classBody)) !== null) {
        const counters = countLines(methodMatch[2]!)
        methods.push({
          name: decodeXml(methodMatch[1]!),
          className,
          sourceFile: filename,
          coveredLines: counters.covered,
          missedLines: counters.missed,
          percent: percentOf(counters.covered, counters.missed),
        })
      }
      // 类级行计数：去掉方法段再数，否则方法里的行会被重复计入类。
      const counters = countLines(classBody.replace(/<methods>[\s\S]*?<\/methods>/g, ''))
      const path = filename || className
      const file: CoverageFileSummary = {
        path: packageName ? `${packageName}/${path}` : path,
        coveredLines: counters.covered,
        missedLines: counters.missed,
        percent: percentOf(counters.covered, counters.missed),
      }
      files.push(file)
      packageFiles.push(file)
      classes.push({ name: className, sourceFile: filename, coveredLines: counters.covered,
        missedLines: counters.missed, percent: percentOf(counters.covered, counters.missed) })
    }
    let packageCovered = 0
    let packageMissed = 0
    for (const file of packageFiles) { packageCovered += file.coveredLines; packageMissed += file.missedLines }
    packages.push({ name: packageName, files: packageFiles, coveredLines: packageCovered,
      missedLines: packageMissed, percent: percentOf(packageCovered, packageMissed) })
  }
  let coveredLines = 0
  let missedLines = 0
  for (const file of files) { coveredLines += file.coveredLines; missedLines += file.missedLines }
  // 兜底：没有 `<class>`（只给了根 `<coverage line-rate>` 的总览报告）时按根行计数。
  if (!files.length) {
    const root = countLines(xml)
    coveredLines = root.covered
    missedLines = root.missed
  }
  const truncated = files.length > MAX_COVERAGE_FILES
  const classesTruncated = classes.length > MAX_COVERAGE_CLASSES
  const methodsTruncated = methods.length > MAX_COVERAGE_METHODS
  packages.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  classes.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  methods.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return {
    reportPath,
    files: truncated ? files.slice(0, MAX_COVERAGE_FILES) : files,
    coveredLines, missedLines, percent: percentOf(coveredLines, missedLines), truncated,
    packages, classes: classesTruncated ? classes.slice(0, MAX_COVERAGE_CLASSES) : classes, classesTruncated,
    methods: methodsTruncated ? methods.slice(0, MAX_COVERAGE_METHODS) : methods, methodsTruncated,
    format: 'cobertura',
  }
}

/**
 * 解析 JaCoCo 报告。结构：`<report><package name="com/x"><sourcefile name="Y.java">
 * <counter type="LINE" missed=".." covered=".."/></sourcefile>
 * <class name="com/x/Y" sourcefilename="Y.java"><counter type="LINE" …/></class></package>…</report>`；
 * 没有 `<sourcefile>`（例如只导出的总览报告）时退回报告根上的 LINE 计数器。
 * 逐包聚合照 `<package>` 分组，逐类聚合照 `<class>` 的 LINE 计数器（没有 `<class>` 就是空表）。
 */
export function parseJacocoXml(xml: string, reportPath: string): CoverageSummary {
  const files: CoverageFileSummary[] = []
  const packages: CoveragePackageSummary[] = []
  const classes: CoverageClassSummary[] = []
  const methods: CoverageMethodSummary[] = []
  const packagePattern = /<package\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g
  let packageMatch: RegExpExecArray | null
  while ((packageMatch = packagePattern.exec(xml)) !== null) {
    const packageName = decodeXml(packageMatch[1]!)
    const body = packageMatch[2]!
    const packageFiles: CoverageFileSummary[] = []
    const sourcePattern = /<sourcefile\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/sourcefile>/g
    let sourceMatch: RegExpExecArray | null
    while ((sourceMatch = sourcePattern.exec(body)) !== null) {
      const name = decodeXml(sourceMatch[1]!)
      const counter = LINE_COUNTER.exec(sourceMatch[2]!)
      if (!counter) continue
      const missed = Number(counter[1])
      const covered = Number(counter[2])
      const file: CoverageFileSummary = {
        path: packageName ? `${packageName}/${name}` : name,
        coveredLines: covered,
        missedLines: missed,
        percent: percentOf(covered, missed),
      }
      files.push(file)
      packageFiles.push(file)
    }
    // 类级（JaCoCo `<class name="com/x/Y" sourcefilename="Y.java">`）：同一个类可能
    // 在报告里出现多次（不同 sourcefile/嵌套类），这里按 name 合并计数。
    const classPattern = /<class\s+name="([^"]*)"(?:\s+sourcefilename="([^"]*)")?[^>]*>([\s\S]*?)<\/class>/g
    let classMatch: RegExpExecArray | null
    while ((classMatch = classPattern.exec(body)) !== null) {
      const name = decodeXml(classMatch[1]!)
      const sourceFile = decodeXml(classMatch[2] ?? '')
      const counter = LINE_COUNTER.exec(classMatch[3]!)
      if (!counter) continue
      const missed = Number(counter[1])
      const covered = Number(counter[2])
      const existing = classes.find(entry => entry.name === name)
      if (existing) {
        existing.coveredLines += covered
        existing.missedLines += missed
        existing.percent = percentOf(existing.coveredLines, existing.missedLines)
      } else {
        classes.push({ name, sourceFile, coveredLines: covered, missedLines: missed, percent: percentOf(covered, missed) })
      }
      // 方法级（JaCoCo `<method name="m" desc="…"><counter type="LINE" …/></method>`）：
      // 上游 `CoverageSuite` 在类级之下还有方法级汇总（IDEA 的报告视图按方法展开）。
      // 方法归属由它所在的 `<class>` 决定，所以在这里（类循环内）摘。
      const methodPattern = /<method\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/method>/g
      let methodMatch: RegExpExecArray | null
      while ((methodMatch = methodPattern.exec(classMatch[3]!)) !== null) {
        const lineCounter = LINE_COUNTER.exec(methodMatch[2]!)
        if (!lineCounter) continue
        const methodMissed = Number(lineCounter[1])
        const methodCovered = Number(lineCounter[2])
        methods.push({
          name: decodeXml(methodMatch[1]!),
          className: name,
          sourceFile,
          coveredLines: methodCovered,
          missedLines: methodMissed,
          percent: percentOf(methodCovered, methodMissed),
        })
      }
    }
    let packageCovered = 0
    let packageMissed = 0
    for (const file of packageFiles) { packageCovered += file.coveredLines; packageMissed += file.missedLines }
    packages.push({
      name: packageName,
      files: packageFiles,
      coveredLines: packageCovered,
      missedLines: packageMissed,
      percent: percentOf(packageCovered, packageMissed),
    })
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
  const classesTruncated = classes.length > MAX_COVERAGE_CLASSES
  const methodsTruncated = methods.length > MAX_COVERAGE_METHODS
  packages.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  classes.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  methods.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return {
    reportPath,
    files: truncated ? files.slice(0, MAX_COVERAGE_FILES) : files,
    coveredLines,
    missedLines,
    percent: percentOf(coveredLines, missedLines),
    truncated,
    packages,
    classes: classesTruncated ? classes.slice(0, MAX_COVERAGE_CLASSES) : classes,
    classesTruncated,
    methods: methodsTruncated ? methods.slice(0, MAX_COVERAGE_METHODS) : methods,
    methodsTruncated,
    format: 'jacoco',
  }
}

// ── 展示面的视图模型（`CoverageReportPane.vue` 用；纯函数，判据在同一个测试文件）──────
//
// IDEA 的覆盖率报告视图有四档聚合（`CoverageSuite` 的包/类/方法汇总 + 逐文件），
// 上面三种解析器给的是同一形状的 `CoverageSummary`，所以「哪一档能切 / 每档画什么行」
// 只在这里写一次，组件不再各写一套（也不把规则埋在模板里）。

/** 聚合档位（与 `CoverageReportPane.vue` 的切换按钮一一对应）。 */
export type CoverageGrouping = 'file' | 'package' | 'class' | 'method'

/** 展示面的一行（四种档位共用同一种行形状，`key` 唯一用于 v-for）。 */
export interface CoverageViewRow {
  key: string
  /** 主文本（文件路径 / 包名 / 全限定类名 / 方法名）。 */
  label: string
  /** 次文本（类名归属、源文件、方法所属类…）；没有就是空串。 */
  detail: string
  coveredLines: number
  missedLines: number
  percent: number
}

/** 一档的行集合 + 有没有这一档的数据（没数据时按钮要禁用，不是切过去看空表）。 */
export interface CoverageViewSection {
  grouping: CoverageGrouping
  rows: CoverageViewRow[]
  /** 这一档在这个报告里有没有内容（LCOV 只有文件级 ⇒ 包/类/方法三档都为空）。 */
  available: boolean
}

/**
 * 四档聚合的行。**空表是有意义的答案**：LCOV 是文件级格式，`packages`/`classes`/`methods`
 * 都是空数组 ⇒ 那三档 `available:false`，UI 据此禁用按钮（切过去看一张空表等于骗人）。
 */
export function coverageViewSection(summary: CoverageSummary | null | undefined, grouping: CoverageGrouping): CoverageViewSection {
  if (!summary) return { grouping, rows: [], available: false }
  if (grouping === 'file') {
    return {
      grouping,
      available: summary.files.length > 0,
      rows: summary.files.map(file => ({
        key: `f:${file.path}`, label: file.path, detail: '',
        coveredLines: file.coveredLines, missedLines: file.missedLines, percent: file.percent,
      })),
    }
  }
  if (grouping === 'package') {
    return {
      grouping,
      available: summary.packages.length > 0,
      rows: summary.packages.map(pkg => ({
        key: `p:${pkg.name}`, label: pkg.name || '(默认包)', detail: `${pkg.files.length} 个文件`,
        coveredLines: pkg.coveredLines, missedLines: pkg.missedLines, percent: pkg.percent,
      })),
    }
  }
  if (grouping === 'class') {
    return {
      grouping,
      available: summary.classes.length > 0,
      rows: summary.classes.map(cls => ({
        key: `c:${cls.name}`, label: cls.name, detail: cls.sourceFile,
        coveredLines: cls.coveredLines, missedLines: cls.missedLines, percent: cls.percent,
      })),
    }
  }
  return {
    grouping,
    available: summary.methods.length > 0,
    rows: summary.methods.map(method => ({
      key: `m:${method.className}#${method.name}`,
      label: method.name,
      // 方法归属：类名优先，类名缺（Cobertura 不报）时退回源文件名。
      detail: method.className || method.sourceFile,
      coveredLines: method.coveredLines, missedLines: method.missedLines, percent: method.percent,
    })),
  }
}

/** 四档各自有没有内容（组件据此决定哪几个切换按钮可点）。 */
export function coverageAvailableGroupings(summary: CoverageSummary | null | undefined): Record<CoverageGrouping, boolean> {
  return {
    file: coverageViewSection(summary, 'file').available,
    package: coverageViewSection(summary, 'package').available,
    class: coverageViewSection(summary, 'class').available,
    method: coverageViewSection(summary, 'method').available,
  }
}

/** 报告格式的显示名（面板标题那一格：「读的是哪种报告」）。 */
export const COVERAGE_FORMAT_LABELS: Record<CoverageFormat, string> = {
  jacoco: 'JaCoCo / Kover',
  cobertura: 'Cobertura',
  lcov: 'LCOV',
  unknown: '未识别的格式',
}

/** 一行覆盖率的百分比文案（`0` 行总数时写 `—`，不写 `0%` 冒充"一行都没覆盖"）。 */
export function coveragePercentText(covered: number, missed: number): string {
  return covered + missed > 0 ? `${percentOf(covered, missed)}%` : '—'
}
