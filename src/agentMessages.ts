// 对话正文的**解析层**：把助手一段回复拆成渲染单元（文本 / 文件引用 / 计划 / 工具行 / 代码块）。
//
// 为什么单独一个模块：`AgentPanel.vue` 只负责把这里的输出贴到模板上。解析规则若写进组件，
// 就没法脱离 Vue 单测 —— 而「点对话里的文件要跳到左边对应窗口」这条恰恰是最容易出错的
// 地方（路径要能对上工作区里的真实文件，行号是可选的）。
//
// 与 `src/agent.ts` 的分工：那边是**决策与记账**（权限门、计划步骤、差异预览、用量、导出），
// 这边是**渲染切分**（一段文本长什么样）。两边都不持状态。

/**
 * 一段回复切出来的一个渲染单元。
 *
 * `file` 这一类是本模块存在的理由：ZCode 形态的对话里，助手提到文件时用户要能点进去，
 * 所以「文本里的文件引用」必须从纯文本升级成结构化的一格，带上可选的起始行。
 */
export type AgentMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'file'; path: string; line: number | null }
  | { kind: 'plan'; steps: string[] }

/**
 * 文件引用里的路径形状。只认「看起来像仓库内相对路径」的写法，避免把
 * `Ctrl+Alt+O`、`float`、`v1.2` 这种普通文本误判成可点文件。
 *
 * 规则（每一条都为挡住一类误判）：
 *   · 必须含至少一个 `/`，或者带一个已知的源码扩展名 —— 只有目录层级的写法才可能是文件；
 *   · 不许以 `/` 开头（绝对路径交给宿主，不在正文里点）；
 *   · 不许含空格（正文里的散文片段常带空格，形状上不像路径）；
 *   · 反引号包起来的最可信，裸文本要额外满足扩展名条件。
 */
const SOURCE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'java', 'kt', 'kts',
  'cpp', 'cc', 'cxx', 'hpp', 'h', 'c', 'cs', 'go', 'rs', 'py', 'rb',
  'php', 'swift', 'scala', 'sql', 'sh', 'ps1', 'bat', 'md', 'json',
  'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'less', 'txt',
] as const

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot === path.length - 1) return ''
  return path.slice(dot + 1).toLowerCase()
}

/**
 * 判定一段候选文本是不是仓库内文件引用，是就给出路径与可选行号（`path:12` / `path:12:5`）。
 *
 * 返回 `null` 表示不是文件 —— 调用方按纯文本处理。这个函数是**纯的且不碰磁盘**：
 * 它只判形状，路径真不真由宿主在点击时自己核对（本模块不进文件系统）。
 */
export function parseFileReference(candidate: string): { path: string; line: number | null } | null {
  const raw = candidate.trim()
  if (!raw) return null
  if (raw.startsWith('/') || raw.startsWith('\\')) return null
  if (/^[A-Za-z]:[\\/]/.test(raw)) return null
  if (/\s/.test(raw)) return null
  if (raw.includes('://')) return null

  // 行号后缀：`:12` 或 `:12:5`（列号本仓不用，但遇到要能正确剥掉，否则路径会带上 `:5`）。
  let path = raw
  let line: number | null = null
  const withLine = /^(.*?):(\d+)(?::\d+)?$/.exec(raw)
  if (withLine) {
    path = withLine[1]!
    line = Number.parseInt(withLine[2]!, 10)
  }
  if (!path) return null
  if (path.endsWith('/') || path.endsWith('\\')) return null

  const hasSlash = path.includes('/')
  const ext = extensionOf(path)
  const knownExtension = (SOURCE_EXTENSIONS as readonly string[]).includes(ext)
  // 要么有目录层级，要么是已知源码扩展名 —— 两个都不满足就不是路径（`float`、`v1.2`）。
  if (!hasSlash && !knownExtension) return null
  // 有层级但文件名的扩展名完全不认（如 `src/foo.xyz`）时仍接受：`.` 后是短字母数字就当扩展名。
  if (hasSlash && !ext) return null
  return { path, line }
}

/** 正文里以反引号写出来的文件引用：`` `src/App.vue:120` ``。 */
const INLINE_CODE = /`([^`\n]+)`/g

/** 一段回复里的围栏代码块 ```lang\n…\n``` 。 */
const FENCED_CODE = /(```|~~~)([^\n`]*)\n([\s\S]*?)(?:\1|$)/g

/**
 * 把一段回复切分成渲染单元。顺序保持原文顺序。
 *
 * 处理顺序：先按围栏代码块切大段（代码块内部**不再**解析文件引用 —— 代码里的字符串
 * 长得像路径的很多，点了也多半不该跳），再在每个非代码段里按行解析计划与行内引用。
 */
export function parseAgentMessage(reply: string): AgentMessageSegment[] {
  const segments: AgentMessageSegment[] = []
  const text = reply.replace(/\r\n/g, '\n')
  let cursor = 0
  let match: RegExpExecArray | null
  FENCED_CODE.lastIndex = 0
  while ((match = FENCED_CODE.exec(text)) !== null) {
    if (match.index > cursor) segments.push(...parsePlainText(text.slice(cursor, match.index)))
    segments.push({ kind: 'code', language: match[2]!.trim(), text: match[3]! })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push(...parsePlainText(text.slice(cursor)))
  return segments
}

/**
 * 非代码段的切分：连续的列表行收成一个 `plan` 单元，其余按行找反引号引用。
 *
 * 逐行处理而不是整段正则，是为了让「一行里有文件引用」与「这一行是计划步骤」两件事
 * 互不干扰 —— 整段正则会把跨行的反引号配错对。
 */
function parsePlainText(block: string): AgentMessageSegment[] {
  if (!block) return []
  const out: AgentMessageSegment[] = []
  const lines = block.split('\n')
  let planSteps: string[] = []
  let textBuffer: string[] = []

  const flushText = () => {
    if (!textBuffer.length) return
    const joined = textBuffer.join('\n')
    textBuffer = []
    if (!joined.trim()) return
    out.push(...splitInlineReferences(joined))
  }
  const flushPlan = () => {
    if (!planSteps.length) return
    out.push({ kind: 'plan', steps: planSteps })
    planSteps = []
  }

  for (const line of lines) {
    const step = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(line)
    if (step && step[1]!.trim()) {
      flushText()
      planSteps.push(step[1]!.trim())
      continue
    }
    flushPlan()
    textBuffer.push(line)
  }
  flushPlan()
  flushText()
  return out
}

/**
 * 把一段纯文本按反引号引用切成 text / file 混合单元。反引号里不是文件就当普通文本，
 * 但**保留反引号**（原文怎么写就怎么显示），避免把用户的排版改掉。
 */
function splitInlineReferences(text: string): AgentMessageSegment[] {
  const out: AgentMessageSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  INLINE_CODE.lastIndex = 0
  while ((match = INLINE_CODE.exec(text)) !== null) {
    const inner = match[1]!
    const ref = parseFileReference(inner)
    if (!ref) continue
    if (match.index > cursor) out.push({ kind: 'text', text: text.slice(cursor, match.index) })
    out.push({ kind: 'file', path: ref.path, line: ref.line })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
  if (!out.length) out.push({ kind: 'text', text })
  return out.filter(segment => segment.kind !== 'text' || segment.text.length > 0)
}

/**
 * 从一段回复里收集所有文件引用（去重、保序）。宿主用它来决定「这条回复涉及哪些文件」——
 * 例如把改动过的路径交给左侧 DiffView，或统计上下文里带了哪些文件。
 */
export function collectReferencedFiles(reply: string): Array<{ path: string; line: number | null }> {
  const seen = new Set<string>()
  const files: Array<{ path: string; line: number | null }> = []
  for (const segment of parseAgentMessage(reply)) {
    if (segment.kind !== 'file') continue
    if (seen.has(segment.path)) continue
    seen.add(segment.path)
    files.push({ path: segment.path, line: segment.line })
  }
  return files
}
