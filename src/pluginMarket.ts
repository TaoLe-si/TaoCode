// 插件市场 —— 对照 IDEA 的 marketplace 一族：
//  · `platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSearchResult.kt:12-17`
//     搜索结果 = 插件模型列表 + error（有错也返回已拿到的部分）。
//  · `.../marketplace/MarketplaceRequests.kt`（`searchPlugins`）
//     请求参数：search（关键字）/ category / orderBy / 分页；响应是 JSON 插件数组。
//  · `.../newui/PluginUiModel.kt:30-126`
//     条目展示字段：pluginId、name、version、vendor、tags、downloads、rating、date、
//     displayCategory、changeNotes、size。
//  · `.../MarketplaceTabSearchSortByOptions.kt:10-18`
//     排序项与它们的 query 词：Update Date/DOWNLOADS/RATING/Name/Relevance。
//  · `.../newui/SearchQueryParser.kt:24-124`（`Marketplace`）
//     市场页搜索框的 `/vendor:` `/tag:` `/sortBy:` `/repository:` 与 `/suggested` `/internal`
//     `/staffPicks` 三个布尔词 —— 解析在下面的 `parseMarketplaceQuery`，`/sortBy:` 的取值词
//     同时是市场页排序动作写进搜索框的词面（`MarketplacePluginsTab.kt:287,298,309`）。
//  · `.../marketplace/PluginChunkDataSource.kt`、`MarketplacePluginDownloadService.kt`
//     下载/分块续传 —— 本仓不适用（见下）。
//
// 本仓的**源**是工作区里的本地仓库目录（默认 `.taocode/plugins`）：清单 `repository.json` 用
// 宿主既有的 `file.read` 读（宿主只接受工作区相对路径），包用既有 `plugin.install` 装（把工作区
// 根与相对路径拼成绝对路径）。**远程仓库的清单**另有取数通道（`src/pluginMarketRemote.ts` 走宿主
// `http.get`；`index.html` 的 CSP 也放开了市场主机：`connect-src 'self' … https://plugins.jetbrains.com`），
// 但远程那一档仍有三处没落点，如实写在这里而不是在代码里假装：
//   1. 上游 `MarketplaceRequests.searchPlugins` 打的是 JetBrains 的搜索 API（多参数、分页、
//      返回 `PluginUiModel` 数组），本仓取的是仓库清单 JSON（与本地同一格式）—— 形状转换没有落点；
//   2. 下载 / 分块续传（`PluginChunkDataSource.kt`、`MarketplacePluginDownloadService.kt`）没有落点：
//      `plugin.install` 只收工作区里的包，远程包要先下载进工作区，而 `http.get` 只取正文文本；
//   3. 远程清单还要配套签名校验（`PluginSignatureVerifier.kt`），本仓只落了判定层
//      `src/pluginSignature.ts`（没有证书链/吊销列表/取 CRL 的网络）—— 所以「插件仓库/搜索/下载/评分」
//      里的**远程取数+只读展示**已落地，**远程安装**仍登记为缺口。
//
// 这个模块只有纯函数 + 依赖注入的加载/安装流程（不 import bridge、不持状态），所以能单独测
// （`tests/plugin-market.test.mjs`）；RPC 调用在 `src/components/PluginMarketPanel.vue` 里接。
import { splitPluginQuery, vendorTextMatches } from './pluginGroups.ts'
import type { PluginInfo } from './pluginGroups.ts'

// ── 条目与清单 ────────────────────────────────────────────────────────────────

/** 市场条目（`PluginUiModel.kt` 展示字段的子集 + 本仓仓库布局需要的 `file`）。 */
export interface MarketplacePlugin {
  /** 插件 id（`PluginUiModel.pluginId`；也是装完后的目录名 / `plugin.json` 的 id）。 */
  id: string
  name: string
  version: string
  /** 相对仓库根的包路径：`foo-1.0.zip` 或 `foo/`（含 plugin.json 的目录）。 */
  file: string
  description?: string
  vendor?: string
  /** `displayCategory`；缺省归入 `PLUGIN_OTHER_CATEGORY`（由 `marketplaceEntryCategory` 兜底）。 */
  category?: string
  tags?: string[]
  /** `PluginUiModel.downloads` 在上游是格式化字符串（"1.2M"），本仓存数字，渲染时格式化。 */
  downloads?: number
  rating?: number
  /** `date`（毫秒时间戳）；上游可空。 */
  releaseDate?: number
  size?: string
  changeNotes?: string
  /**
   * 清单里声明的签名（`PluginSignatureVerifier` 的输入面）。本仓没有密码学验签通道
   * （见 `src/pluginSignature.ts`），所以这两个字段只做**形状校验**：有 `signature` 就用它，
   * 否则认 64 位十六进制的 `sha256` 摘要。界面据此显示「签名 未校验 / 未签名」。
   */
  signature?: string
  sha256?: string
}

export interface MarketplaceCatalog {
  /** 仓库名（`CustomPluginRepositoryService` 的仓库 URL/名字的对应物，这里是目录）。 */
  name: string
  plugins: MarketplacePlugin[]
}

export interface MarketplaceParseResult {
  catalog: MarketplaceCatalog | null
  /** 逐条解析失败的原因（有错也返回能用的部分，与 `PluginSearchResult.error` 同口径）。 */
  errors: string[]
}

/** 清单文件名。仓库根下放这一个文件就是"有清单的仓库"。 */
export const MARKETPLACE_MANIFEST = 'repository.json'

/** 缺省仓库根（工作区相对）。团队可以把内部插件仓库直接放进项目。 */
export const DEFAULT_REPOSITORY_ROOT = '.taocode/plugins'

/** 包扩展名（`PluginInstaller` 只认插件包；本仓 native 侧同样只解 zip/jar）。 */
export const MARKETPLACE_PACKAGE_EXTENSIONS = ['zip', 'jar'] as const

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => asText(item)).filter(Boolean)
}

/**
 * 路径守卫（与 native `Workspace::parse_relative` 同口径）：只收工作区相对路径 ——
 * 不能是绝对路径、不能有盘符、不能有 `..`、不能带 NUL。清单里的 `file` 来自用户文件，
 * 直接拼进 `plugin.install` 的绝对路径前必须过这一关（否则清单能指向工作区外的任意目录）。
 */
export function normalizeRepositoryPath(path: string): string | null {
  const text = asText(path).replace(/\\/g, '/')
  if (!text || text.includes('\0')) return null
  if (text.startsWith('/') || /^[a-zA-Z]:/.test(text)) return null
  const parts: string[] = []
  for (const part of text.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}

/** 清单路径 = 仓库根 + `repository.json`；仓库根不合法时返回 null。 */
export function repositoryManifestPath(root: string): string | null {
  const normalized = normalizeRepositoryPath(root)
  return normalized ? `${normalized}/${MARKETPLACE_MANIFEST}` : null
}

/**
 * 工作区根 + 相对路径 → 绝对路径（`plugin.install` 要绝对路径）。
 * 根为空（没开工作区）或相对路径不合法时返回 null —— 调用方据此禁用安装按钮。
 */
export function joinWorkspacePath(root: string, relative: string): string | null {
  const normalizedRoot = asText(root).replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized = normalizeRepositoryPath(relative)
  if (!normalizedRoot || !normalized) return null
  if (!/^[a-zA-Z]:\//.test(normalizedRoot) && !normalizedRoot.startsWith('//')) return null
  return `${normalizedRoot}/${normalized}`
}

/**
 * 解析仓库清单。两种形状都收（IDEA 的仓库响应也是"一个数组"或"带 plugins 的对象"）：
 *   · `{ "name": "...", "plugins": [ ... ] }`
 *   · `[ { ... }, ... ]`（仓库名取缺省）
 * 条目缺 id/name/version/file 的逐条报错跳过（`PluginSearchResult.error` 的口径：
 * 拿到多少算多少，不因为一条坏数据把整页打空）。
 */
export function parseMarketplaceCatalog(text: string, fallbackName = '本地仓库'): MarketplaceParseResult {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    return { catalog: null, errors: [`清单不是合法 JSON：${error instanceof Error ? error.message : String(error)}`] }
  }
  const rawPlugins = Array.isArray(document)
    ? document
    : (document && typeof document === 'object' && Array.isArray((document as { plugins?: unknown }).plugins)
        ? (document as { plugins: unknown[] }).plugins
        : null)
  if (!rawPlugins) return { catalog: null, errors: ['清单里没有 plugins 数组。'] }
  const name = !Array.isArray(document) && document && typeof document === 'object'
    ? asText((document as { name?: unknown }).name) || fallbackName
    : fallbackName
  const plugins: MarketplacePlugin[] = []
  const errors: string[] = []
  rawPlugins.forEach((item, index) => {
    if (!item || typeof item !== 'object') { errors.push(`第 ${index + 1} 条不是对象。`); return }
    const record = item as Record<string, unknown>
    const id = asText(record.id)
    const name_ = asText(record.name) || id
    const version = asText(record.version)
    const file = asText(record.file)
    if (!id) { errors.push(`第 ${index + 1} 条没有 id。`); return }
    if (!version) { errors.push(`条目 ${id} 没有 version。`); return }
    if (!file || !normalizeRepositoryPath(file)) { errors.push(`条目 ${id} 的 file 不是合法的工作区相对路径。`); return }
    plugins.push({
      id,
      name: name_,
      version,
      file,
      description: asText(record.description) || undefined,
      vendor: asText(record.vendor) || undefined,
      category: asText(record.category) || undefined,
      tags: asTags(record.tags),
      downloads: asNumber(record.downloads),
      rating: asNumber(record.rating),
      releaseDate: asNumber(record.releaseDate),
      size: asText(record.size) || undefined,
      changeNotes: asText(record.changeNotes) || undefined,
      signature: asText(record.signature) || undefined,
      sha256: asText(record.sha256) || undefined,
    })
  })
  return { catalog: { name, plugins }, errors }
}

/**
 * 没有清单时的兜底：把仓库根下的 `*.zip`/`*.jar` 当成条目（id/version 从文件名折出）。
 * 这样"把包扔进目录"也能直接装 —— 对应 IDEA 里"从磁盘安装"的可发现性补足。
 */
export function discoverMarketplacePackages(files: readonly string[], root: string): MarketplacePlugin[] {
  const normalizedRoot = normalizeRepositoryPath(root)
  if (!normalizedRoot) return []
  const prefix = `${normalizedRoot}/`
  const entries: MarketplacePlugin[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const path = file.replace(/\\/g, '/')
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (rest.includes('/')) continue
    const extension = rest.slice(rest.lastIndexOf('.') + 1).toLowerCase()
    if (!(MARKETPLACE_PACKAGE_EXTENSIONS as readonly string[]).includes(extension)) continue
    const stem = rest.slice(0, rest.lastIndexOf('.'))
    const id = stem.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    entries.push({ id, name: stem || id, version: '', file: rest, category: undefined, tags: [] })
  }
  return entries
}

// ── 版本与状态 ───────────────────────────────────────────────────────────────

/**
 * 版本比较（上游 `PluginManagerStateService` 用 `VersionComparatorUtil` 的 `.`/`-` 分段口径）。
 * 数字段按数值比、数字段优先于字母段（`1.10 > 1.9`）；缺段当 0 比（`1.0 < 1.0.1`），
 * 但**字母段是预发布标记**（`1.0-beta` 排在同版本的正式版之后：`1.0 > 1.0-beta`）。
 */
export function compareVersions(left: string, right: string): number {
  const split = (value: string) => value.trim().split(/[.\-_+]/).filter(Boolean)
  const a = split(left)
  const b = split(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const leftPart = a[index] ?? ''
    const rightPart = b[index] ?? ''
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber < rightNumber ? -1 : 1
    if (leftNumber !== null) return 1
    if (rightNumber !== null) return -1
    // 两边都是字母段或一边缺段：缺段 = 正式版，排在该位置的预发布段之后。
    if (!leftPart) return rightPart ? 1 : -1
    if (!rightPart) return leftPart ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

export type MarketplaceEntryState = 'available' | 'installed' | 'update' | 'incompatible'

export interface MarketplaceEntryStatus {
  state: MarketplaceEntryState
  /** 已安装的那个插件（有的话），详情面板用它显示已装版本。 */
  installed?: PluginInfo
  /** `update` 时可更新到的目标版本。 */
  target?: string
}

/**
 * 条目对当前安装列表的状态：
 *   · 没装 → available；
 *   · 装了且清单声明的版本**更新** → update（`InstalledPluginsState` 的"有更新"）；
 *   · 装了但依赖不满足/清单坏 → incompatible（启用必然失败，先修再谈更新）；
 *   · 否则 installed。
 */
export function marketplaceEntryStatus(entry: MarketplacePlugin, installed: readonly PluginInfo[]): MarketplaceEntryStatus {
  const found = installed.find(plugin => plugin.id === entry.id)
  if (!found) return { state: 'available' }
  if (found.error || found.broken) return { state: 'incompatible', installed: found }
  if (entry.version && compareVersions(entry.version, found.version || '0') > 0)
    return { state: 'update', installed: found, target: entry.version }
  return { state: 'installed', installed: found }
}

/** 有更新的条目（`/outdated`、`/needUpdate` 的真实数据来源）。 */
export function marketplaceUpdates(entries: readonly MarketplacePlugin[], installed: readonly PluginInfo[]): MarketplacePlugin[] {
  return entries.filter(entry => marketplaceEntryStatus(entry, installed).state === 'update')
}

/** 条目的类目（缺省 `Other Tools`，与已安装页同一兜底）。 */
export function marketplaceEntryCategory(entry: MarketplacePlugin): string {
  return (entry.category ?? '').trim() || 'Other Tools'
}

/** 条目的下载量显示（上游 `PluginUiModel.downloads` 是格式化字符串）。 */
export function formatDownloads(count: number | undefined): string {
  if (count === undefined) return ''
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K`
  return `${(count / 1_000_000).toFixed(1)}M`
}

// ── 搜索、排序、过滤（`MarketplaceRequests` + `MarketplaceTabSearchSortByOptions`）──

export const MARKETPLACE_SORTS = ['relevance', 'updateDate', 'downloads', 'rating', 'name'] as const
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number]

/** 排序项的显示名与查询词（`MarketplaceTabSearchSortByOptions.kt:11-19` 的顺序与 query 词）。 */
export const MARKETPLACE_SORT_LABELS: Record<MarketplaceSort, { label: string; query: string }> = {
  relevance: { label: '相关度', query: 'relevance' },
  updateDate: { label: '更新时间', query: 'updated' },
  downloads: { label: '下载量', query: 'downloads' },
  rating: { label: '评分', query: 'rating' },
  name: { label: '名称', query: 'name' },
}

export interface MarketplaceQuery {
  keyword: string
  category: string
  /** `all` = 全部；`outdated` 是 `/outdated`（有更新）；`downloaded` 是 `/downloaded`（已安装）。 */
  scope: 'all' | 'outdated' | 'downloaded'
  /**
   * `/vendor:` 的取值（`SearchQueryParser.kt:25` 的 `vendors`）。多个取值是**或**，
   * 与关键字/类目是**与**；判定用 `vendorTextMatches`（本地仓库没有 `organization=` 服务端，
   * `:108-113` 那条 URL 参数拼法在本仓落到客户端过滤）。
   */
  vendors?: readonly string[]
  /** `/tag:` 的取值（`:26` 的 `tags`）；命中口径见 `marketplaceEntryTagMatches`。 */
  tags?: readonly string[]
}

export const MARKETPLACE_SCOPE_LABELS: Record<MarketplaceQuery['scope'], string> = {
  all: '全部',
  outdated: '可更新',
  downloaded: '已安装',
}

/**
 * 关键词匹配（`MarketplaceRequests.searchPlugins` 的关键字口径）：名称 / id / 描述 / 厂商 / 类目 / 标签。
 * `/vendor:`、`/tag:` 是叠加的收窄（与关系），各自内部取值是或关系。
 */
export function matchesMarketplaceQuery(entry: MarketplacePlugin, query: MarketplaceQuery, installed: readonly PluginInfo[]): boolean {
  const status = marketplaceEntryStatus(entry, installed)
  if (query.scope === 'outdated' && status.state !== 'update') return false
  if (query.scope === 'downloaded' && status.state === 'available') return false
  if (query.category && marketplaceEntryCategory(entry) !== query.category) return false
  // `/vendor:`：与已安装页同一条判定（`vendorTextMatches`，`MyPluginModel.kt:1348-1361`）。
  // 上游市场页是把取值拼成 URL 参数 `organization=`（`SearchQueryParser.kt:108-113`）交给服务端，
  // 本仓的仓库在本地工作区，所以这条过滤落在客户端，判定沿用已安装页那一处（不复制第二份规则）。
  const vendors = query.vendors ?? []
  if (vendors.length && !vendorTextMatches(entry.vendor, vendors)) return false
  // `/tag:`：已安装页用 `ContainerUtil.intersects`（`InstalledPluginsTabSearchResultPanel.kt:100`）
  // = 标签名**全等**求交集；市场页在上游把标签拼成 `tags=`（`SearchQueryParser.kt:101-106`）发给服务端，
  // 服务端规则不在这棵参考树里 ⇒ 本仓沿用唯一能核实的全等口径（徽章点出来的也是原样拼词，见 `tagQueryWord`）。
  const tags = query.tags ?? []
  if (tags.length && !marketplaceEntryTagMatches(entry, tags)) return false
  if (!query.keyword) return true
  const needle = query.keyword.toLowerCase()
  return [entry.name, entry.id, entry.description, entry.vendor, entry.category, ...(entry.tags ?? [])]
    .some(value => (value ?? '').toLowerCase().includes(needle))
}

/** 条目的标签集合与查询标签是否有交集（标签名全等，两侧都去首尾空白）。 */
export function marketplaceEntryTagMatches(entry: MarketplacePlugin, tags: readonly string[]): boolean {
  const owned = (entry.tags ?? []).map(tag => tag.trim())
  if (!owned.length) return false
  return tags.some(needle => owned.includes(needle.trim()))
}

/** 排序（缺省相关度 = 清单顺序；`name` 用码元序，与已安装页同一比较口径）。 */
export function sortMarketplaceEntries(entries: readonly MarketplacePlugin[], sort: MarketplaceSort): MarketplacePlugin[] {
  if (sort === 'relevance') return [...entries]
  const sorted = [...entries]
  sorted.sort((left, right) => {
    if (sort === 'name') {
      const a = left.name || left.id
      const b = right.name || right.id
      const lowerA = a.toLowerCase()
      const lowerB = b.toLowerCase()
      if (lowerA !== lowerB) return lowerA < lowerB ? -1 : 1
      return a < b ? -1 : a > b ? 1 : 0
    }
    if (sort === 'downloads') return (right.downloads ?? 0) - (left.downloads ?? 0)
    if (sort === 'rating') return (right.rating ?? 0) - (left.rating ?? 0)
    return (right.releaseDate ?? 0) - (left.releaseDate ?? 0)
  })
  return sorted
}

/** 类目清单（按出现顺序去重；渲染成下拉）。 */
export function marketplaceCategories(entries: readonly MarketplacePlugin[]): string[] {
  const categories: string[] = []
  for (const entry of entries) {
    const category = marketplaceEntryCategory(entry)
    if (!categories.includes(category)) categories.push(category)
  }
  return categories
}

// ---- 市场页搜索框的 `/xxx` 语法（`newui/SearchQueryParser.kt:24-124` 的 `Marketplace`）----

/**
 * 市场页认得的**带取值**属性词（`newui/SearchWords.kt:9-12` 的子集，消费点是
 * `SearchQueryParser.kt:77-84` 的 `handleAttribute`）。键是分词后的原样词 ——
 * `splitQuery`（`:244-245`）把 `:` 留给前一个词，所以 `/sortBy:updated` 拆成 `/sortBy:` + `updated`。
 * 上游拿词面做的是**逐字**比较，本仓与已安装页（`parseInstalledQuery`）同一口径按忽略大小写匹配：
 * 只是多接受几种写法，不改变任何一条命中/取值规则。
 */
const MARKETPLACE_ATTRIBUTE_WORDS: Record<string, 'vendor' | 'tag' | 'sortBy' | 'repository'> = {
  '/vendor:': 'vendor',
  '/tag:': 'tag',
  '/sortby:': 'sortBy',
  '/repository:': 'repository',
}

/**
 * 三个**布尔**词（`SearchWords.kt:13-15`）。上游不在 `handleAttribute` 里处理它们，
 * 而是在市场页重写的 `addToSearchQuery`（`SearchQueryParser.kt:68-75`）里拦下 ——
 * 所以它们既不进关键字串，也不会像 `/vendor:` 那样吃掉后一个词。
 */
const MARKETPLACE_BOOLEAN_WORDS: Record<string, 'suggested' | 'internal' | 'staffPicks'> = {
  '/suggested': 'suggested',
  '/internal': 'internal',
  '/staffpicks': 'staffPicks',
}

/**
 * `/sortBy:` 取值 → 排序项（`MarketplaceTabSearchSortByOptions.kt:10-14` 的 `query` 字段，
 * 反查走 `getByQueryOrNull`，`:16-18`）。取值是**逐字**匹配的（上游 `it.query == query`），
 * 所以 `/sortBy:Updated` 与上游一样落到 null。
 */
const SORT_BY_QUERY_VALUES: Record<string, MarketplaceSort> = {}
for (const key of MARKETPLACE_SORTS) SORT_BY_QUERY_VALUES[MARKETPLACE_SORT_LABELS[key].query] = key

/** 认识但本仓**没有数据源**的词，`deferred` 里给出的是这些词的中文说明。 */
const MARKETPLACE_DEFERRED_LABELS: Record<'repository' | 'suggested' | 'internal' | 'staffPicks', string> = {
  // 词面直译自上游文案（本地化包不在基准树里）：`IdeBundle.properties:1619` `Repository: {0}`、
  // `:1605` `Suggested`、`:1601` `Internal plugins`、`:1618` `Staff Picks`。
  repository: '仓库主机（/repository:）',
  suggested: '推荐（/suggested）',
  internal: '内部插件（/internal）',
  staffPicks: '官方精选（/staffPicks）',
}

export interface MarketplaceSearch {
  /** 拼回的关键字（`:12` 的 `searchQuery` + `:14-21` 的空格拼接）。 */
  keyword: string
  /** `/vendor:` 的取值（`:25`）。 */
  vendors: string[]
  /** `/tag:` 的取值（`:26`）。 */
  tags: string[]
  /** `/sortBy:` 命中的排序项；取值不认识时是 null（`:80` 的 `getByQueryOrNull`）。 */
  sortBy: MarketplaceSort | null
  /** `/repository:` 的取值（`:27`）：本仓只有一个本地仓库根，没有"多主机"这一层。 */
  repositories: string[]
  suggested: boolean
  internal: boolean
  staffPicks: boolean
  /** 解析出来但没有数据源的词的说明（界面上如实说明，不参与过滤）。 */
  deferred: string[]
}

/**
 * 市场页查询解析 —— `SearchQueryParser.Marketplace` 的 `parse`（`:38-66`）逐条对齐：
 *   · 空词表直接返回（`:42-44`）；
 *   · **只有一个词**时它只能是关键字（`:45-48`，没有下一个词当取值）；
 *   · 以 `:` 结尾的词吃下一个词当取值（`:53-56`）；**取值缺失**时把整条原样查询当关键字并停止
 *     （`:57-60`，上游是 `addToSearchQuery(query)` + `return`；本仓与已安装页同样只保留整条原样文本，
 *     不重复累加已收的关键字）；
 *   · 其余词进关键字串，但三个布尔词在 `addToSearchQuery` 的重写里被拦下（`:68-75`）；
 *   · 不认识的 `xxx:` 词照样吃掉取值、然后什么都不做（`:77-84` 的 when 没有 else 分支）。
 */
export function parseMarketplaceQuery(text: string): MarketplaceSearch {
  const result: MarketplaceSearch = {
    keyword: '', vendors: [], tags: [], sortBy: null, repositories: [],
    suggested: false, internal: false, staffPicks: false, deferred: [],
  }
  const words = splitPluginQuery(text)
  if (!words.length) return result
  const keywords: string[] = []
  const add = (value: string): void => {
    const booleanWord = MARKETPLACE_BOOLEAN_WORDS[value.toLowerCase()]
    if (booleanWord) result[booleanWord] = true
    else keywords.push(value)
  }
  const handle = (name: string, value: string): void => {
    switch (MARKETPLACE_ATTRIBUTE_WORDS[name.toLowerCase()]) {
      case 'vendor':
        if (!result.vendors.includes(value)) result.vendors.push(value)
        break
      case 'tag':
        if (!result.tags.includes(value)) result.tags.push(value)
        break
      case 'repository':
        if (!result.repositories.includes(value)) result.repositories.push(value)
        break
      case 'sortBy':
        // 上游是赋值（`:80`）：后一次 `/sortBy:` 覆盖前一次，取值不认识就回到 null。
        result.sortBy = SORT_BY_QUERY_VALUES[value] ?? null
        break
      default:
        break
    }
  }
  if (words.length === 1) {
    add(words[0])
  } else {
    let index = 0
    while (index < words.length) {
      const name = words[index++]
      if (name.endsWith(':')) {
        if (index < words.length) handle(name, words[index++])
        else {
          keywords.length = 0
          keywords.push(text)
          break
        }
      } else add(name)
    }
  }
  result.keyword = keywords.join(' ')
  if (result.repositories.length) result.deferred.push(MARKETPLACE_DEFERRED_LABELS.repository)
  if (result.staffPicks) result.deferred.push(MARKETPLACE_DEFERRED_LABELS.staffPicks)
  if (result.suggested) result.deferred.push(MARKETPLACE_DEFERRED_LABELS.suggested)
  if (result.internal) result.deferred.push(MARKETPLACE_DEFERRED_LABELS.internal)
  return result
}

/**
 * 标签徽章点出来的查询词 —— `SearchQueryParser.getTagQuery`（`:254-257`）：
 * `/tag:` + 标签名，名字里有空格就用双引号包住（分词器把空格当分隔符，`:227-234` 才认引号）。
 * 点击动作是**整框替换**（`newui/PluginsTab.kt:271` 的 `setTextIgnoreEvents(query)`），
 * 上游的徽章监听器就挂在这个词上（`newui/PluginTagBadge.kt:29`）。
 */
export function tagQueryWord(tag: string): string {
  return `/tag:${tag.includes(' ') ? `"${tag}"` : tag}`
}

/** 当前查询里生效的排序项（`/sortBy:` 优先于下拉框，与上游 `MarketplaceSortByAction.setState:748-755` 一致：
 *  状态由解析结果决定，而不是由控件自己记着）。 */
export function marketplaceEffectiveSort(sort: MarketplaceSort, search: MarketplaceSearch): MarketplaceSort {
  return search.sortBy ?? sort
}

// ── 加载与安装（依赖注入：不 import bridge，测试传假实现）────────────────────

export interface MarketplaceSourceDeps {
  /** 读一个**工作区相对**路径的文本（宿主 `file.read`）。 */
  readText: (relative: string) => Promise<string>
  /** 工作区全部文件的相对路径（宿主 `workspace.files`）。 */
  listFiles: () => Promise<string[]>
}

export type MarketplaceSourceKind = 'manifest' | 'directory' | 'none'

export interface MarketplaceLoadResult {
  entries: MarketplacePlugin[]
  /** 数据从哪来：清单 / 只有包文件的目录 / 什么都没有。 */
  source: MarketplaceSourceKind
  root: string
  errors: string[]
}

/**
 * 加载本地仓库：先读 `<root>/repository.json`；读不到就退化成"扫目录里的包文件"。
 * 清单 parse 失败时**同时**返回错误与目录兜底（不让一个坏清单把包也藏起来）。
 */
export async function loadMarketplace(deps: MarketplaceSourceDeps, root: string): Promise<MarketplaceLoadResult> {
  const normalizedRoot = normalizeRepositoryPath(root)
  const result: MarketplaceLoadResult = { entries: [], source: 'none', root, errors: [] }
  if (!normalizedRoot) {
    result.errors.push('仓库目录必须是工作区相对路径（不能是绝对路径或含 ..）。')
    return result
  }
  const manifest = repositoryManifestPath(normalizedRoot)
  if (manifest) {
    try {
      const parsed = parseMarketplaceCatalog(await deps.readText(manifest))
      if (parsed.catalog && parsed.catalog.plugins.length) {
        result.entries = parsed.catalog.plugins
        result.source = 'manifest'
        result.errors = parsed.errors
        return result
      }
      result.errors = parsed.errors.length ? parsed.errors : ['仓库清单里没有条目。']
    } catch {
      // 没有清单是正常情况（目录即仓库），不报错，继续扫包。
    }
  }
  try {
    const files = await deps.listFiles()
    const discovered = discoverMarketplacePackages(files, normalizedRoot)
    if (discovered.length) {
      result.entries = discovered
      result.source = 'directory'
      return result
    }
  } catch {
    // 没有工作区就没有文件清单；保持 none。
  }
  return result
}

export interface MarketplaceInstallDeps {
  /** `plugin.install`（源是绝对路径）。 */
  install: (source: string) => Promise<unknown>
  /** `plugin.uninstall`（更新要先把旧版本卸掉：native 侧拒绝覆盖已存在的 id）。 */
  uninstall: (id: string) => Promise<unknown>
}

/**
 * 安装/更新一个条目。
 *   · 首次安装：直接 `plugin.install`；
 *   · 更新：先 `plugin.uninstall` 再 `plugin.install`（native 的 install 拒绝同名已存在 ——
 *     上游 `PluginInstallOperation` 同样是"替换"，本仓拆成两步如实落到既有通道上）。
 * `source` 必须已经由 `joinWorkspacePath` 拼成绝对路径；拼不出来就是调用方的 bug。
 */
export async function installMarketplaceEntry(
  deps: MarketplaceInstallDeps,
  entry: MarketplacePlugin,
  workspaceRoot: string,
  installed: readonly PluginInfo[],
): Promise<'installed' | 'updated'> {
  const source = joinWorkspacePath(workspaceRoot, entry.file)
  if (!source) throw new Error('无法从工作区根拼出插件包的绝对路径。')
  const status = marketplaceEntryStatus(entry, installed)
  if (status.state === 'update') {
    await deps.uninstall(entry.id)
    await deps.install(source)
    return 'updated'
  }
  await deps.install(source)
  return 'installed'
}
