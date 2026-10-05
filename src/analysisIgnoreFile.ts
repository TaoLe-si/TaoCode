// `.analysisignore` 文件 —— 上游 `platform/lang-impl/src/com/intellij/ide/analysisignore/` 的格式与匹配。
//
// **这个格式不是 gitignore。** 逐条对源码（`AnalysisIgnorePattern.kt`）：
//   · `patternSource:110-113`：行尾空格去掉；空行与 `#` 开头的行不是规则。
//   · `unsupportedReason:140-160`：**`!`（取反）、`[`（字符类）、`\`（转义）都不支持**，
//     `***` 这样的连星与 `a**b` 这种没占满一段的 `**` 也不支持；只支持 `*` / `?` / `**`。
//     `validate:118-122` 对每行先验一遍，**只把受支持的存下来**（不支持的只进日志）。
//   · `parse:165-184`：尾 `/` = 只匹配目录；含 `/` 的是 **anchored**（对文件所在目录下的相对路径），
//     不含 `/` 的匹配**任意层级下的同名名字**；开头的 `/` 去掉；`**/` 后面没有别的 `/` 时退化成不锚定。
//   · `matches:44-50` + `matchesSegments:77-104`：逐段匹配，`**` 占零段或多段。
//   · `directoryOnly` 只在**被匹配的那个东西真是目录**时才算命中（`matches` 的第一个分支）。
//
// 作用域模型（`AnalysisIgnoreService.kt:143-149` + `findAnalysisIgnoreExclusions.kt:39-53`）：
// 每个 `.analysisignore` 的 baseDir 是**它自己所在的目录**（不是"就近那个"——所有文件都算数，
// 每个管自己那棵子树）；判定一个文件时从它自己往上走到 baseDir，**每一层**都试一遍全部规则，
// 命中任意一层即忽略（这就是"目录规则忽略其下全部文件"的机制，与 `directoryOnly` 无关）。
// 结果按路径长度降序排（`findAnalysisIgnoreExclusions.kt:56`：匹配文件自身的那行排最前）。
//
// 与 `src/analysisIgnore.ts` 里**手动** glob 规则（问题面板里手写的那份）是两条来源：
// 手动那份走本仓自己的 `globToRegExp`（gitignore 味的整串匹配），`.analysisignore` 走这里的格式；
// 两者是并集，谁先命中都算忽略。
//
// 词法/高亮（`lang/` 一族：`AnalysisIgnoreLexer`/`SyntaxHighlighter`/`FileType`）不做：那是 PSI 侧形态，
// 本仓的 `.analysisignore` 在编辑器里按纯文本打开即可。

/** 一条规则里被通配的那一段。 */
export type AnalysisIgnoreSegment =
  /** 无通配：整段字面比较（本仓一律按大小写敏感，宿主只有本机盘）。 */
  | { kind: 'literal'; text: string }
  /** `*.log` 形状：一个前导 `*` + 无通配的尾巴。 */
  | { kind: 'suffix'; text: string }
  /** 含通配的一段：`*` 不跨 `/`，`?` 匹配一个字符。 */
  | { kind: 'glob'; regex: RegExp }
  /** 单独的 `*`：匹配任意名字。 */
  | { kind: 'anyName' }
  /** 匹配不到任何名字（空段、或编不出正则的段）。 */
  | { kind: 'noName' }
  /** 占满一整段的 `**`：匹配零段或多段。 */
  | { kind: 'anySegments' }

/** `.analysisignore` 不支持的一条写法（`AnalysisIgnoreUnsupported.kt:296-324`）。 */
export type AnalysisIgnoreUnsupported =
  | 'negation' | 'characterClass' | 'escape' | 'asteriskRun' | 'partialDoubleAsterisk' | 'separatorsOnly'

/** 解析出来的一条规则。 */
export interface AnalysisIgnorePattern {
  /** 去掉行尾空格的原始行（`AnalysisIgnorePattern.source`）。 */
  source: string
  /** 尾 `/`：只匹配目录。 */
  directoryOnly: boolean
  /** 含 `/`（或原为锚定）：对 baseDir 下的**相对路径**匹配；否则匹配任意层级的名字。 */
  anchored: boolean
  /** 无通配且各段都合法时，锚定规则命名的那条路径；其余为 null。 */
  literalPath: string | null
  segments: readonly AnalysisIgnoreSegment[]
}

/** 一条被拒的规则：原文 + 原因（`AnalysisIgnoreValidated.Unsupported`，`:282-288`）。 */
export interface AnalysisIgnoreRejected { source: string; reason: AnalysisIgnoreUnsupported }

/** 解析结果：受支持的规则 + 被拒的规则（后者只用来如实报给用户/日志）。 */
export interface AnalysisIgnoreFileParse { patterns: AnalysisIgnorePattern[]; rejected: AnalysisIgnoreRejected[] }

const normalize = (path: string) => path.replace(/\\/g, '/')

/** `patternSource:110-113`：只去掉**行尾**的空格（`trimEnd(' ')`，不是 trim）；空行与 `#` 开头不是规则。 */
export function analysisIgnorePatternSource(line: string): string | null {
  const source = line.replace(/ +$/, '')
  return !source || source[0] === '#' ? null : source
}

/** `unsupportedReason:140-160`。`length` 只在 `asteriskRun` 上有意义。 */
export function analysisIgnoreUnsupportedReason(source: string): AnalysisIgnoreUnsupported | null {
  if (source.startsWith('!')) return 'negation'
  let index = 0
  while (index < source.length) {
    const char = source[index]!
    if (char === '[') return 'characterClass'
    if (char === '\\') return 'escape'
    if (char === '*') {
      let end = index
      while (end < source.length && source[end] === '*') ++end
      const run = end - index
      if (run > 2) return 'asteriskRun'
      // `**` 必须占满一整段（前面是行首或 `/`，后面是行尾或 `/`）。
      if (run === 2 && !fillsComponent(source, index, end)) return 'partialDoubleAsterisk'
      index = end
    } else ++index
  }
  return null
}

/** `fillsComponent:406-407`：`[start, end)` 这一段星号是不是占满了整个路径分量。 */
function fillsComponent(source: string, start: number, end: number): boolean {
  return (start === 0 || source[start - 1] === '/') && (end === source.length || source[end] === '/')
}

interface Parsed { directoryOnly: boolean; anchored: boolean; body: string }

/** `parse:165-184`。 */
function parsePattern(source: string): Parsed {
  let body = source
  const directoryOnly = body.endsWith('/')
  if (directoryOnly) body = body.slice(0, -1)
  let anchored = body.includes('/')
  if (anchored && body[0] === '/') body = body.slice(1)
  // `**/foo`（后面没有别的 `/`）与 `foo` 同义：不锚定。
  if (body.startsWith('**/') && body.indexOf('/', 3) < 0) {
    body = body.slice(3)
    anchored = false
  }
  return { directoryOnly, anchored, body }
}

/** `literalPathOf:345-349`。 */
function literalPathOf(body: string, anchored: boolean): string | null {
  if (!anchored || /[*?]/.test(body)) return null
  const parts = body.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) return null
  return body
}

/** `regexOf:383-400`：`*` 不跨 `/`，`?` 匹配一个字符，其余字符按字面。 */
function segmentRegex(component: string): RegExp | null {
  let source = ''
  for (const char of component) {
    if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`)
  } catch {
    return null
  }
}

/** `nameSegmentOf:372-378`。 */
function nameSegmentOf(component: string): AnalysisIgnoreSegment {
  if (!component) return { kind: 'noName' }
  if (component === '*' || component === '**') return { kind: 'anyName' }
  if (!/[*?]/.test(component)) return { kind: 'literal', text: component }
  // `isSuffixMask:412`：以 `*` 开头且没有第二个 `*` 也没有 `?`。
  if (component.length > 1 && component[0] === '*' && component.indexOf('*', 1) < 0 && !component.includes('?'))
    return { kind: 'suffix', text: component.slice(1) }
  const regex = segmentRegex(component)
  return regex ? { kind: 'glob', regex } : { kind: 'noName' }
}

/** `segmentsOf:354-367`。 */
function segmentsOf(body: string, anchored: boolean): AnalysisIgnoreSegment[] {
  if (!anchored) return [nameSegmentOf(body)]
  const segments = body.split('/').map(component => component === '**'
    ? ({ kind: 'anySegments' } as AnalysisIgnoreSegment)
    : nameSegmentOf(component))
  // `a/**` 要能匹配 `a/x`（`a/` 之后至少一段），所以 `**` 收尾时补一段任意名字。
  if (segments[segments.length - 1]!.kind === 'anySegments') segments.push({ kind: 'anyName' })
  return segments
}

/** 一段能否匹配一个路径分量（`AnalysisIgnoreSegment.matches`，`:196-250`）。 */
function segmentMatches(segment: AnalysisIgnoreSegment, name: string): boolean {
  switch (segment.kind) {
    case 'literal': return name === segment.text
    case 'suffix': return name.endsWith(segment.text)
    case 'glob': return segment.regex.test(name)
    case 'anyName': return true
    default: return false
  }
}

/**
 * `matchesSegments:77-104` 的逐段回溯：`**` 可以吃掉零段或多段，
 * 其余段必须按顺序对上，末尾多余的 `**` 允许（`segmentsOf` 已经补过 anyName）。
 */
function matchSegments(segments: readonly AnalysisIgnoreSegment[], names: readonly string[]): boolean {
  let segmentIndex = 0
  let pathIndex = 0
  let lastAny = -1
  let lastAnyPath = -1
  while (pathIndex < names.length) {
    if (segmentIndex < segments.length) {
      const segment = segments[segmentIndex]!
      if (segment.kind === 'anySegments') {
        lastAny = segmentIndex
        lastAnyPath = pathIndex
        ++segmentIndex
        continue
      }
      if (segmentMatches(segment, names[pathIndex]!)) {
        ++segmentIndex
        ++pathIndex
        continue
      }
    }
    if (lastAny < 0) return false
    segmentIndex = lastAny + 1
    ++lastAnyPath
    pathIndex = lastAnyPath
  }
  while (segmentIndex < segments.length && segments[segmentIndex]!.kind === 'anySegments') ++segmentIndex
  return segmentIndex === segments.length
}

/** 编译一行（`compile:127-136`）。调用方先跑过 `validate`。 */
export function compileAnalysisIgnorePattern(source: string): AnalysisIgnorePattern {
  const parsed = parsePattern(source)
  return {
    source,
    directoryOnly: parsed.directoryOnly,
    anchored: parsed.anchored,
    literalPath: literalPathOf(parsed.body, parsed.anchored),
    segments: segmentsOf(parsed.body, parsed.anchored),
  }
}

/** 解析整个文件：受支持的进 `patterns`，被拒的进 `rejected`（`validate:118-122` 只存前者）。 */
export function parseAnalysisIgnoreFile(text: string): AnalysisIgnoreFileParse {
  const patterns: AnalysisIgnorePattern[] = []
  const rejected: AnalysisIgnoreRejected[] = []
  for (const raw of text.split(/\r?\n/)) {
    const source = analysisIgnorePatternSource(raw)
    if (source === null) continue
    const reason = analysisIgnoreUnsupportedReason(source) ?? (parsePattern(source).body ? null : 'separatorsOnly')
    if (reason) rejected.push({ source, reason })
    else patterns.push(compileAnalysisIgnorePattern(source))
  }
  return { patterns, rejected }
}

/**
 * 一条规则命中吗（`matches:44-50`）。`relativePath` 是**相对 baseDir** 的路径（`/` 分隔），
 * `name` 是它的最后一段，`isDirectory` 说的是被匹配的那个东西是不是目录。
 */
export function analysisIgnorePatternMatches(pattern: AnalysisIgnorePattern, relativePath: string, name: string, isDirectory: boolean): boolean {
  if (pattern.directoryOnly && !isDirectory) return false
  if (!pattern.anchored) return segmentMatches(pattern.segments[0]!, name)
  return matchSegments(pattern.segments, relativePath.split('/'))
}

/** 一条规则**是否会排除**这条相对路径（`AnalysisIgnoreMatcher.isExcluded:102-110`：第一条命中即算）。 */
export function analysisIgnoreRuleExcludes(pattern: AnalysisIgnorePattern, relativePath: string, name: string, isDirectory: boolean): boolean {
  if (!relativePath) return false
  return analysisIgnorePatternMatches(pattern, relativePath, name, isDirectory)
}

/** 一个 `.analysisignore` 记录：它在哪、它管哪棵子树（`AnalysisIgnoreService.readIfRelevant:143-149`）。 */
export interface AnalysisIgnoreRecord {
  /** `.analysisignore` 的工作区相对路径。 */
  file: string
  /** 它自己所在的目录（`''` = 工作区根）；它的规则只对子树生效。 */
  baseDir: string
  patterns: readonly AnalysisIgnorePattern[]
  /** 没被格式接受的行（如实报出来，不静默丢）。 */
  rejected: readonly AnalysisIgnoreRejected[]
}

export const ANALYSIS_IGNORE_FILE_NAME = '.analysisignore'

/** 这个相对路径是不是一个 `.analysisignore` 文件（`AnalysisIgnoreFile.isAnalysisIgnoreFile`）。 */
export function isAnalysisIgnoreFile(path: string): boolean {
  const name = normalize(path).split('/').pop() ?? ''
  return name === ANALYSIS_IGNORE_FILE_NAME
}

/** 从文件清单里挑出所有 `.analysisignore`（每个都是一条记录，**没有"就近取一个"这回事**）。 */
export function analysisIgnoreFilesIn(paths: readonly string[]): string[] {
  return paths.filter(isAnalysisIgnoreFile).map(normalize)
}

/** 造一条记录：baseDir = 文件自己所在的目录。 */
export function analysisIgnoreRecord(file: string, text: string): AnalysisIgnoreRecord {
  const normalized = normalize(file)
  const slash = normalized.lastIndexOf('/')
  const { patterns, rejected } = parseAnalysisIgnoreFile(text)
  return { file: normalized, baseDir: slash >= 0 ? normalized.slice(0, slash) : '', patterns, rejected }
}

/** 命中记录里某一条规则的那一层（文件自身或某个祖先目录）。 */
export interface AnalysisIgnoreHit { record: AnalysisIgnoreRecord; pattern: AnalysisIgnorePattern; path: string; depth: number }

function isUnder(baseDir: string, path: string): boolean {
  if (baseDir === '') return true
  return path === baseDir || path.startsWith(`${baseDir}/`)
}

/**
 * 一个文件被哪条记录排除（`findAnalysisIgnoreExclusions.kt:39-53`）：
 * 对每条 baseDir 是它**严格祖先**的记录，从文件自己往上逐层试全部规则；
 * 返回全部命中，按路径长度降序（`findAnalysisIgnoreExclusions.kt:56`：匹配文件自身的那行排最前）。
 */
export function analysisIgnoreHits(records: readonly AnalysisIgnoreRecord[], path: string, isDirectory = false): AnalysisIgnoreHit[] {
  const normalized = normalize(path)
  const hits: AnalysisIgnoreHit[] = []
  for (const record of records) {
    if (!record.patterns.length) continue
    if (record.baseDir === normalized) continue
    if (!isUnder(record.baseDir, normalized)) continue
    const basePrefix = record.baseDir ? `${record.baseDir}/` : ''
    let current = normalized
    for (let depth = 0; ; ++depth) {
      const relativePath = current.slice(basePrefix.length)
      if (!relativePath) break
      const name = relativePath.split('/').pop() ?? ''
      for (const pattern of record.patterns) {
        if (analysisIgnoreRuleExcludes(pattern, relativePath, name, isDirectory || depth > 0)) {
          hits.push({ record, pattern, path: current, depth })
          break
        }
      }
      const cut = current.lastIndexOf('/')
      if (cut < basePrefix.length) break
      current = current.slice(0, cut)
    }
  }
  return hits.sort((left, right) => left.depth - right.depth || right.path.length - left.path.length)
}

/** 命中任意一条记录即忽略（聚合门控用这一条）。 */
export function isAnalysisIgnoredByRecords(records: readonly AnalysisIgnoreRecord[], path: string, isDirectory = false): boolean {
  return analysisIgnoreHits(records, path, isDirectory).length > 0
}

/** 摘要：`N 条规则（K 条目录 / M 条不受支持）` —— 面板上给用户一眼看全。 */
export function describeAnalysisIgnoreRules(patterns: readonly AnalysisIgnorePattern[], rejected: readonly AnalysisIgnoreRejected[] = []): string {
  if (!patterns.length && !rejected.length) return '无忽略规则'
  const parts: string[] = []
  if (patterns.length) parts.push(`${patterns.length} 条规则`)
  const directories = patterns.filter(pattern => pattern.directoryOnly).length
  if (directories) parts.push(`${directories} 条目录`)
  if (rejected.length) parts.push(`${rejected.length} 条不受支持`)
  return parts.length === 1 ? parts[0]! : `${parts[0]}（${parts.slice(1).join('，')}）`
}
