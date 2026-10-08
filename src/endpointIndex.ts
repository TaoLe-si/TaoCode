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
// **明确不做**（上游有、本子集没有）：从调用点反推客户端端点（`src/endpointRoutes.ts` 已补文本子集）、
// URL 内联提示（`url/inlay` 的 `UrlInlayProvider`）与端点搜索/导航。
//
// **2026-10-06 本 lane 补**：`EndpointsProvider` 插件点已有 EP 宿主 ——
// EP id `com.intellij.microservices.endpointsProvider`（逐字取自上游
// `platform/lang-api/resources/intellij.platform.lang.xml:182-183` 的
// `qualifiedName="com.intellij.microservices.endpointsProvider"`，
// interface `com.intellij.microservices.endpoints.EndpointsProvider` dynamic="true"）。
// 本仓的文本扫描是一个 bundled provider，第三方按同一 EP id 挂的 provider 由
// `buildEndpointIndex()`（`src/components/EndpointsDialog.vue` 的真实消费点）合并解析。
import type { SearchMatch } from './bridge'
import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

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
export function buildEndpointIndex(
  matches: SearchMatch[],
  providers: readonly EndpointsProvider[] = endpointsProvidersFromExtensions(),
): EndpointEntry[] {
  const seen = new Set<string>()
  const entries: EndpointEntry[] = []
  for (const match of matches) {
    const path = match.path.replace(/\\/g, '/')
    const preview = match.preview ?? ''
    // 每个 provider 独立解析这一行，全部结果合流（上游 `EndpointsModel` 就是多 provider 合并）。
    for (const provider of providers) {
      const entry = provider.parseLine(path, match.line, preview)
      if (!entry) continue
      const key = `${entry.method} ${entry.route} ${entry.path}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(entry)
    }
  }
  entries.sort((left, right) => left.route.localeCompare(right.route) || left.path.localeCompare(right.path) || left.line - right.line)
  return entries
}

// ── `EndpointsProvider` 扩展点宿主（上游 `com.intellij.microservices.endpointsProvider`） ──

/** EP id（逐字取自上游 `intellij.platform.lang.xml:182` 的 `qualifiedName`）。 */
export const ENDPOINTS_PROVIDER_EP = 'com.intellij.microservices.endpointsProvider'

/**
 * 一个端点供给方（上游 `EndpointsProvider` 的可移植子集）：本仓没有 PSI/项目模型，
 * provider 用「一段正则 + 逐行解析」表达「我要宿主扫什么、怎么认」。
 */
export interface EndpointsProvider {
  /** 贡献 id（上游 EP 无 id，这里是本仓宿主要求的键）。 */
  id: string
  /** 该供给方要宿主搜索的正则片段（多个 provider 的片段并集成一条 `search.run` query）。 */
  scanQuery: string
  /** 把一行源码解析成端点；不是路由行返回 null。 */
  parseLine: (path: string, line: number, text: string) => EndpointEntry | null
}

/** 声明 EP（幂等）。 */
export function declareEndpointsProviderExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({ id: ENDPOINTS_PROVIDER_EP, name: '端点供给方', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 插件贡献一个端点供给方（等价于上游 plugin.xml 的一条 `com.intellij.microservices.endpointsProvider`）。 */
export function registerEndpointsProvider(provider: EndpointsProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(ENDPOINTS_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条端点供给方贡献。 */
export function unregisterEndpointsProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(ENDPOINTS_PROVIDER_EP, id)
}

/** 当前 EP 上的全部供给方（bundled + 第三方）。 */
export function endpointsProvidersFromExtensions(scope: string = APPLICATION_SCOPE): EndpointsProvider[] {
  return EXTENSIONS.extensionsOf<EndpointsProvider>(ENDPOINTS_PROVIDER_EP, scope)
}

/** 全部供给方的扫描正则并成一条（宿主 `search.run` 的 `query`）；空表退 bundled 那条。 */
export function endpointScanQuery(scope: string = APPLICATION_SCOPE): string {
  const queries = endpointsProvidersFromExtensions(scope).map(provider => provider.scanQuery).filter(Boolean)
  return queries.length ? queries.join('|') : ENDPOINT_SCAN_QUERY
}

/** bundled 文本扫描供给方（把本文件既有的 `RULES` 文本扫描做成一个默认贡献者）。 */
export const TEXT_SCAN_ENDPOINTS_PROVIDER: EndpointsProvider = {
  id: 'text-scan',
  scanQuery: ENDPOINT_SCAN_QUERY,
  parseLine: parseEndpointLine,
}

/** 摘要行：`N 个端点 / M 个文件 / 各框架计数`。 */
export function endpointSummary(entries: EndpointEntry[]): string {
  const files = new Set(entries.map(entry => entry.path))
  const frameworks = new Map<string, number>()
  for (const entry of entries) frameworks.set(entry.framework, (frameworks.get(entry.framework) ?? 0) + 1)
  const parts = [...frameworks.entries()].sort((left, right) => right[1] - left[1]).map(([name, count]) => `${name} ${count}`)
  return `${entries.length} 个端点 / ${files.size} 个文件${parts.length ? `（${parts.join('，')}）` : ''}`
}

// bundled：文本扫描供给方按上游 plugin.xml 的 `<com.intellij.microservices.endpointsProvider/>` 形态
// 登记在 EP 上；第三方按同一 EP id 挂的供给方由 `buildEndpointIndex` 一并解析。
declareEndpointsProviderExtensionPoint()
EXTENSIONS.registerExtension(ENDPOINTS_PROVIDER_EP, TEXT_SCAN_ENDPOINTS_PROVIDER.id,
  TEXT_SCAN_ENDPOINTS_PROVIDER, { source: 'bundled' })
