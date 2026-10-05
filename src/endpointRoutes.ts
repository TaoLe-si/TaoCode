// 端点索引的**类级前缀合并与客户端端点**（上游 `platform/lang-impl/src/com/intellij/microservices/`：
// `EndpointsModel` 把类级 `@RequestMapping("/api")` 与方法级路径拼成完整 URL；客户端调用
// （`fetch("…")`/`axios.post(…)`/`RestTemplate`…）由 `microservices/url` 那侧反推成端点条目，
// 视图里与控制器端点并排显示）。
//
// 本仓现状：`src/endpointIndex.ts` 只按**单行**解析路由声明，类级前缀不合并（`/api` + `/users`
// 显示成两条互不相干的路径），也没有客户端端点。这个模块补这两件纯规则：
//   · `classRoutePrefixes`：找出类型声明上方的 `@RequestMapping`/`@Path` 作为前缀；
//   · `mergeEndpointPrefixes`：按文件内容把方法级路由补全成完整 URL；
//   · `clientEndpointCalls`：扫常见 HTTP 客户端调用（不猜动态段：带 `${…}` 的 URL 原样保留）。

import { normalizeRoute, type EndpointEntry } from './endpointIndex.ts'

/** 一个类级路由前缀：类型声明所在行（0 基）+ 前缀 + 框架。 */
export interface ClassRoutePrefix {
  classLine: number
  route: string
  framework: string
}

const TYPE_DECLARATION = /^\s*(?:export\s+|public\s+|final\s+|abstract\s+|open\s+|internal\s+)*(?:class|interface|object|enum)\s+[A-Za-z_$]/
const SPRING_PREFIX = /@RequestMapping\s*\((?:[^)]*?(?:value|path)\s*=\s*)?['"]([^'"]+)['"]/
const JAX_RS_PREFIX = /@Path\s*\(\s*['"]([^'"]+)['"]/

/**
 * 找出「类型声明 + 上方注解」组成的类级前缀。
 * 只看紧邻的注解块（中间允许空行），断在第一个非注解行 —— 与 IDEA 认 PSI 上 `PsiClass` 的
 * 注解同口径，不把方法上的 `@RequestMapping` 误当类前缀。
 */
export function classRoutePrefixes(text: string): ClassRoutePrefix[] {
  const lines = text.split(/\r?\n/)
  const prefixes: ClassRoutePrefix[] = []
  for (let index = 0; index < lines.length; ++index) {
    if (!TYPE_DECLARATION.test(lines[index])) continue
    let route = ''
    let framework = ''
    for (let above = index - 1; above >= 0; --above) {
      const line = lines[above].trim()
      if (!line) continue
      if (!line.startsWith('@')) break
      const spring = SPRING_PREFIX.exec(line)
      if (spring && spring[1] && spring[1] !== '/') { route = spring[1]; framework = 'Spring' }
      const jax = JAX_RS_PREFIX.exec(line)
      if (jax && jax[1] && jax[1] !== '/') { route = jax[1]; framework = 'JAX-RS' }
    }
    if (route) prefixes.push({ classLine: index, route: normalizeRoute(route), framework })
  }
  return prefixes
}

/** 拼接类前缀与方法路径（两边都归一化；前缀为空时就是方法路径）。 */
export function joinRoute(prefix: string, route: string): string {
  const base = normalizeRoute(prefix)
  const tail = normalizeRoute(route)
  if (!prefix || base === '/') return tail
  if (tail === '/') return base
  return `${base}${tail}`
}

/**
 * 按文件内容补全端点路由：每条端点找**它上方最近的一个类级前缀**（同文件），拼成完整路径。
 * 没有文件内容的条目原样返回（搜索结果里拿不到全文时的诚实降级）。
 */
export function mergeEndpointPrefixes(entries: readonly EndpointEntry[], fileTexts: Record<string, string> = {}): EndpointEntry[] {
  const cache = new Map<string, ClassRoutePrefix[]>()
  return entries.map(entry => {
    const path = entry.path.replace(/\\/g, '/')
    if (!Object.prototype.hasOwnProperty.call(fileTexts, path)) return entry
    let prefixes = cache.get(path)
    if (!prefixes) { prefixes = classRoutePrefixes(fileTexts[path]); cache.set(path, prefixes) }
    let best: ClassRoutePrefix | undefined
    for (const prefix of prefixes) {
      if (prefix.classLine > entry.line) continue
      if (!best || prefix.classLine > best.classLine) best = prefix
    }
    if (!best) return entry
    return { ...entry, route: joinRoute(best.route, entry.route) }
  })
}

/** 客户端端点：一条 HTTP 调用。 */
export interface ClientEndpoint {
  path: string
  line: number
  method: string
  route: string
  framework: string
}

const CLIENT_RULES: ReadonlyArray<{ framework: string; match: RegExp; route: (match: RegExpExecArray) => string; method: (match: RegExpExecArray) => string }> = [
  // fetch('/x', { method: 'POST' })：URL 是第 1 个捕获组（没有方法组），方法在同行的 options 里。
  { framework: 'fetch', match: /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g, route: match => match[1], method: match => {
    const tail = match.input.slice(match.index, match.index + 240)
    return (/method\s*:\s*['"]([A-Za-z]+)['"]/.exec(tail)?.[1] ?? 'GET').toUpperCase()
  } },
  { framework: 'axios', match: /\baxios\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g, route: match => match[2], method: match => match[1].toUpperCase() },
  // Angular HttpClient：this.http.get<...>('/x') —— 泛型参数可选地夹在中间。
  { framework: 'HttpClient', match: /\bhttp\s*\.\s*(get|post|put|delete|patch)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g, route: match => match[2], method: match => match[1].toUpperCase() },
  { framework: 'requests', match: /\brequests\s*\.\s*(get|post|put|delete|patch|head)\s*\(\s*['"]([^'"]+)['"]/g, route: match => match[2], method: match => match[1].toUpperCase() },
  { framework: 'HttpClient', match: /\bHttpClient\s*\.\s*(GetAsync|PostAsync|PutAsync|DeleteAsync|PatchAsync)\s*\(\s*["']([^"']+)["']/g, route: match => match[2], method: match => ({ GetAsync: 'GET', PostAsync: 'POST', PutAsync: 'PUT', DeleteAsync: 'DELETE', PatchAsync: 'PATCH' } as Record<string, string>)[match[1]] ?? 'GET' },
  { framework: 'RestTemplate', match: /\.\s*(getForObject|getForEntity|postForObject|postForEntity|put|delete)\s*\(\s*['"]([^'"]+)['"]/g, route: match => match[2], method: match => (/^get/i.test(match[1]) ? 'GET' : /^post/i.test(match[1]) ? 'POST' : match[1].toUpperCase()) },
  { framework: 'WebClient', match: /\.\s*(get|post|put|delete|patch)\s*\(\s*\)\s*\.uri\s*\(\s*['"]([^'"]+)['"]/g, route: match => match[2], method: match => match[1].toUpperCase() },
]

/**
 * 扫客户端 HTTP 调用。`/x/${id}` 这类模板串保留原文（动态段是事实，不猜具体值）。
 * 每行最多一条（同一行叠多个调用时取第一个，避免同一处出现两条重复候选）。
 */
export function clientEndpointCalls(path: string, text: string): ClientEndpoint[] {
  const normalizedPath = path.replace(/\\/g, '/')
  const lines = text.split(/\r?\n/)
  const out: ClientEndpoint[] = []
  const seen = new Set<string>()
  for (let line = 0; line < lines.length; ++line) {
    const source = lines[line]
    // 「一行只取第一个命中」按**位置**算：`axios.get(`/a`); fetch('/b')` 的第一个是 axios，
    // 不是规则表里排在前面的 fetch —— 规则顺序只用来打破同一位置的平局。
    let bestIndex = -1
    let bestMatch: RegExpExecArray | null = null
    for (let index = 0; index < CLIENT_RULES.length; ++index) {
      const rule = CLIENT_RULES[index]
      rule.match.lastIndex = 0
      const match = rule.match.exec(source)
      if (!match) continue
      if (!bestMatch || match.index < bestMatch.index) { bestMatch = match; bestIndex = index }
    }
    if (!bestMatch || bestIndex < 0) continue
    const rule = CLIENT_RULES[bestIndex]
    const route = normalizeRoute(rule.route(bestMatch))
    if (!route) continue
    const key = `${line}:${rule.framework}:${route}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path: normalizedPath, line, method: rule.method(bestMatch), route, framework: `客户端/${rule.framework}` })
  }
  return out
}

/** 摘要里客户端端点的计数（与控制器端点分开报）。 */
export function clientEndpointSummary(entries: readonly ClientEndpoint[]): string {
  if (!entries.length) return ''
  const files = new Set(entries.map(entry => entry.path))
  return `${entries.length} 个客户端调用 / ${files.size} 个文件`
}

/**
 * 端点对话框要的一张表：控制器端点**合并类级前缀**，再按开关并上客户端调用条目
 * （上游 `EndpointsView` 同一棵树里既有控制器端点也有客户端端点，两类条目图标不同；
 * 本仓是扁平列表，客户端条目的 framework 前缀「客户端/」用来区分）。
 * `fileTexts` 是路径 → 全文；拿不到全文的文件跳过前缀合并（诚实降级），客户端扫描同理。
 */
export function buildEndpointReport(
  entries: readonly EndpointEntry[],
  fileTexts: Record<string, string> = {},
  includeClients = true,
): EndpointEntry[] {
  const merged = mergeEndpointPrefixes(entries, fileTexts)
  const out: EndpointEntry[] = [...merged]
  if (includeClients) {
    for (const [path, text] of Object.entries(fileTexts)) {
      for (const call of clientEndpointCalls(path, text)) {
        out.push({ path: call.path, line: call.line, method: call.method, route: call.route, framework: call.framework })
      }
    }
  }
  return out.sort((left, right) =>
    left.route.localeCompare(right.route) || left.path.localeCompare(right.path) || left.line - right.line)
}

/** 报告里客户端条目的条数（对话框摘要用）。 */
export function reportClientCount(entries: readonly EndpointEntry[]): number {
  return entries.filter(entry => entry.framework.startsWith('客户端/')).length
}

/** 报告里客户端条目的摘要（没有客户端条目时给空串）。 */
export function reportClientSummary(entries: readonly EndpointEntry[]): string {
  const clients: ClientEndpoint[] = entries
    .filter(entry => entry.framework.startsWith('客户端/'))
    .map(entry => ({ path: entry.path, line: entry.line, method: entry.method, route: entry.route, framework: entry.framework }))
  return clientEndpointSummary(clients)
}
