// 端点索引（上游 `platform/lang-impl/src/com/intellij/microservices/`：`EndpointsView` 树 +
// `EndpointsModel`/`EndpointsFilter`；真实数据由各框架插件通过 `EndpointsProvider` 供给，
// 见 `microservices/http`、`microservices/url/inlay` 等子包）。
//
// 本仓没有框架插件宿主，也没有 PSI，所以在**文本层**扫 HTTP 路由声明，做一个真子集：
//   · Spring：`@GetMapping("/x")` / `@RequestMapping(value="/x", method=RequestMethod.POST)`；
//   · JAX-RS：`@Path("/x")`（方法标注另起一行时记为空方法，不猜）；
//   · Express/Koa：`app.get("/x", …)` / `router.post("/y", …)`；
//   · FastAPI/Flask：`@app.get("/x")` / `@app.route("/x", methods=["POST"])`；
//   · Go（gin/chi/标准库）：`r.GET("/x", …)` / `http.HandleFunc("/x", …)`；
//   · C#：`[HttpGet("x")]` / `[Route("x")]`。
//
// **明确不做**（上游有、本子集没有）：`EndpointsProvider` 插件点、从调用点反推客户端端点、
// 控制器类的继承/前缀合并（`@RequestMapping` 类级前缀 + 方法级路径）、URL 内联提示
// （`url/inlay` 的 `UrlInlayProvider`）与端点搜索/导航。
import type { SearchMatch } from './bridge'

/** 一次搜索能覆盖的路由声明（喂 `search.run` 的 `query`，`regex: true`）。 */
export const ENDPOINT_SCAN_QUERY =
  '@(?:Get|Post|Put|Delete|Patch|Request)Mapping|@Path\\s*\\(|@(?:app|router|bp|blueprint)\\s*\\.\\s*(?:get|post|put|delete|patch|route)\\s*\\(|\\b(?:app|router|server|r|mux)\\s*\\.\\s*(?:get|post|put|delete|patch|all|use|HandleFunc)\\s*\\(|\\[Http(?:Get|Post|Put|Delete|Patch)\\(|\\[Route\\('

export interface EndpointEntry {
  /** 声明所在文件（工作区相对路径）。 */
  path: string
  /** 0 基行号。 */
  line: number
  /** HTTP 方法（大写；推断不出时为空串）。 */
  method: string
  /** 路由模板原文。 */
  route: string
  /** 识别出的框架/写法标签。 */
  framework: string
}

interface Rule {
  framework: string
  match: RegExp
  method: (match: RegExpExecArray) => string
  route: (match: RegExpExecArray) => string
}

const QUOTED = /['"]([^'"]*)['"]/

const RULES: Rule[] = [
  // Spring：@GetMapping("/x") / @RequestMapping(value="/x", method=RequestMethod.POST)
  {
    framework: 'Spring',
    match: /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?['"]([^'"]*)['"]/,
    method: match => match[1]!.toUpperCase(),
    route: match => match[2]!,
  },
  {
    framework: 'Spring',
    match: /@RequestMapping\s*\(([^)]*)\)/,
    method: match => (/RequestMethod\.(GET|POST|PUT|DELETE|PATCH)/.exec(match[1]!)?.[1] ?? '').toUpperCase(),
    route: match => QUOTED.exec(match[1]!)?.[1] ?? '',
  },
  // JAX-RS：@Path("/x")，方法标注通常在下一行 —— 不猜。
  { framework: 'JAX-RS', match: /@Path\s*\(\s*['"]([^'"]*)['"]/, method: () => '', route: match => match[1]! },
  // FastAPI/Flask 装饰器：@app.get("/x") / @app.route("/x", methods=["POST"])
  {
    framework: 'FastAPI/Flask',
    match: /@(?:app|router|bp|blueprint)\s*\.\s*(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]*)['"]/,
    method: (match) => {
      if (match[1] !== 'route') return match[1]!.toUpperCase()
      const tail = match.input.slice(match.index + match[0].length, match.index + match[0].length + 120)
      return (/methods\s*=\s*\[?\s*['"]([A-Za-z]+)['"]/.exec(tail)?.[1] ?? '').toUpperCase()
    },
    route: match => match[2]!,
  },
  // Express/Koa/gin/标准库：app.get("/x", …) / r.GET("/x", …) / http.HandleFunc("/x", …)
  {
    framework: 'Node/Router',
    match: /\b(?:app|router|server|r|mux|http)\s*\.\s*(get|post|put|delete|patch|all|use|HandleFunc|GET|POST|PUT|DELETE|PATCH|ANY)\s*\(\s*['"]([^'"]*)['"]/,
    method: match => (/HandleFunc|use/i.test(match[1]!) ? (match[1] === 'use' ? 'ALL' : '') : match[1]!.toUpperCase()),
    route: match => match[2]!,
  },
  // C#：[HttpGet("x")] / [Route("x")]
  {
    framework: 'ASP.NET',
    match: /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']*)["']/,
    method: match => match[1]!.toUpperCase(),
    route: match => match[2]!,
  },
  { framework: 'ASP.NET', match: /\[Route\s*\(\s*["']([^"']*)["']/, method: () => '', route: match => match[1]! },
]

/** 从一行源码解析一个端点声明；不是路由行返回 null。 */
export function parseEndpointLine(path: string, line: number, text: string): EndpointEntry | null {
  const trimmed = text.trim()
  // 注释掉的声明不算端点（文本层没有 AST，只挡最明显的行首注释标记）。
  if (/^(?:\/\/|#|\*|<!--)/.test(trimmed)) return null
  for (const rule of RULES) {
    const match = rule.match.exec(trimmed)
    if (!match) continue
    const route = rule.route(match)
    if (!route) continue
    return { path, line, method: rule.method(match), route: normalizeRoute(route), framework: rule.framework }
  }
  return null
}

/** 路由归一：补前导 `/`，去掉末尾斜杠（`/x/` 与 `/x` 是同一个端点）。 */
export function normalizeRoute(route: string): string {
  const text = route.trim()
  if (!text) return ''
  const withSlash = text.startsWith('/') ? text : `/${text}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
}

/** 把搜索命中整理成端点索引（同文件同方法的同一路由只留第一条），按路由排序。 */
export function buildEndpointIndex(matches: SearchMatch[]): EndpointEntry[] {
  const seen = new Set<string>()
  const entries: EndpointEntry[] = []
  for (const match of matches) {
    const entry = parseEndpointLine(match.path.replace(/\\/g, '/'), match.line, match.preview ?? '')
    if (!entry) continue
    const key = `${entry.method} ${entry.route} ${entry.path}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(entry)
  }
  entries.sort((left, right) => left.route.localeCompare(right.route) || left.path.localeCompare(right.path) || left.line - right.line)
  return entries
}

/** 摘要行：`N 个端点 / M 个文件 / 各框架计数`。 */
export function endpointSummary(entries: EndpointEntry[]): string {
  const files = new Set(entries.map(entry => entry.path))
  const frameworks = new Map<string, number>()
  for (const entry of entries) frameworks.set(entry.framework, (frameworks.get(entry.framework) ?? 0) + 1)
  const parts = [...frameworks.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `${name} ${count}`)
  return `${entries.length} 个端点 / ${files.size} 个文件${parts.length ? `（${parts.join('，')}）` : ''}`
}
