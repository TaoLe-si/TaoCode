// 「记忆」节的**本机存储面**：目录形状、清单、读正文、搜索、条数、时间 —— 2026-10-08。
//
// 为什么是本机存储而不是宿主通道：ZCode 的记忆走主进程 `IMemoryService`
// （`packages/services/src/memory/memory.ts:24-33` 只有 list/read，没有删除也没有写入），
// 它的文件在磁盘上。本仓宿主没有这条通道，所以这里用 `localStorage` 里的一份目录
// （`taocode.agent.memoryStore`）复刻**同一条语义**：清单、读正文、5 MiB 预览上限、
// 读取期间文件已变的复核。这样界面拿到的是真数据（有就有、没有就空），不是假成功。
//
// 逐条对齐的 ZCode 出处（`.tools/ZCode`，只读参照）：
//   · `packages/services/src/memory/memory.ts:8-22`            清单形状
//   · `packages/services/src/memory/memoryService.ts:11-12`    MEMORY.md / memory
//   · `memoryService.ts:23-44`                                 路径段与文件名校验、label 还原
//   · `memoryService.ts:102-110`                               文件排序（index 在前）
//   · `memoryService.ts:113-199, 201-232`                      清单（跳空工作区）+ 读文件
//   · `projectMemoryStableRead.ts:8,27-97`                     5 MiB 上限 + 读取期复核两个错误码
//   · `packages/ui/src/settings/MemorySettingsViewer.tsx:52-66` 条数文案与搜索过滤
//   · `packages/ui/src/settings/MemorySettingsSection.tsx:15-40,104-125` 显示名 slug / 顺序
//   · `packages/ui/src/settings/memoryUpdatedAt.ts:62-120`     更新时间分支
//   · `packages/ui/src/i18n/locales/zh-CN.ts:2012-2051,3702`   文案原文
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 存储键。与 `taocode.agent.settings` 同一族（localStorage）。 */
export const AGENT_MEMORY_STORE_STORAGE_KEY = 'taocode.agent.memoryStore'

/** 索引文件名与目录名（`memoryService.ts:11-12`）。 */
export const PROJECT_MEMORY_INDEX_FILE_NAME = 'MEMORY.md'
export const PROJECT_MEMORY_DIRECTORY_NAME = 'memory'

/** 预览上限 5 MiB（`projectMemoryStableRead.ts:8`）—— 这是**预览**上限，与注入无关。 */
export const PROJECT_MEMORY_PREVIEW_MAX_BYTES = 5 * 1024 * 1024

/** 两个错误码逐字取自 `memory.ts:4-6` / `projectMemoryStableRead.ts` 的两条分支。 */
export const PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE = 'PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED'
export const PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE = 'PROJECT_MEMORY_FILE_CHANGED'

/**
 * 这一节的文案表（逐字取自 `zh-CN.ts:2012-2051,3702`）。
 * 单独一张表是为了让判据能逐键对原文 —— 组件里不许再写第二份。
 */
export const MEMORY_SETTINGS_TEXT: Record<string, string> = {
  'settings.memory': '记忆',
  'settings.memory.workspaceMemory': '工作区记忆',
  'settings.memoryDescription': '在工作区中保存并复用长期上下文，新会话生效。开启后可能增加模型调用和 Token 成本。',
  'settings.memory.viewer.localOnly': '记忆详情仅支持在本地桌面端查看，请前往本地桌面端的“记忆”设置。',
  'settings.memory.viewer.title': '已保存的工作区记忆',
  'settings.memory.viewer.description': '查看此设备上按工作区保存的记忆。',
  'settings.memory.viewer.projectsDescription': '选择一个项目，查看该项目保存的全部记忆。',
  'settings.memory.viewer.refresh': '刷新',
  'settings.memory.viewer.loading': '正在加载记忆…',
  'settings.memory.viewer.empty': '暂无已保存的工作区记忆',
  'settings.memory.viewer.workspaces': '工作区',
  'settings.memory.viewer.files': '文件',
  'settings.memory.viewer.searchPlaceholder': '搜索记忆文件…',
  'settings.memory.viewer.searchEmpty': '没有匹配的记忆文件。',
  'settings.memory.viewer.workspaceSearchPlaceholder': '搜索工作区…',
  'settings.memory.viewer.workspaceSearchEmpty': '没有匹配的工作区。',
  'settings.memory.viewer.itemCount.one': '{count} 条',
  'settings.memory.viewer.itemCount.other': '{count} 条',
  'settings.memory.viewer.memoryCount.one': '{count} 条记忆',
  'settings.memory.viewer.memoryCount.other': '{count} 条记忆',
  'settings.memory.viewer.updated.justNow': '刚刚',
  'settings.memory.viewer.updated.minutesAgo': '{count} 分钟前',
  'settings.memory.viewer.updated.today': '今天 {time}',
  'settings.memory.viewer.updated.yesterday': '昨天 {time}',
  'settings.memory.viewer.updated.weekday': '{weekday} {time}',
  'settings.memory.viewer.updated.weekdayZh': '周{weekday}',
  'settings.memory.viewer.updated.date': '{date} {time}',
  'settings.memory.viewer.updated.dateMonthDay': '{month} 月 {day} 日',
  'settings.memory.viewer.updated.dateYearMonthDay': '{year} 年 {month} 月 {day} 日',
  'settings.memory.viewer.tree': '记忆文件',
  'settings.memory.viewer.indexMissing': 'MEMORY.md（未生成）',
  'settings.memory.viewer.collapse': '收起记忆条目',
  'settings.memory.viewer.expand': '展开记忆条目',
  'settings.memory.viewer.fileLoading': '正在加载文件…',
  'settings.memory.viewer.fileDeleted': '该记忆文件已被删除，请刷新文件列表。',
  'settings.memory.viewer.fileTooLarge': '该记忆文件超过 5 MiB 预览上限。',
  'settings.memory.viewer.fileChanged': '该记忆文件在读取期间已更新，请重新打开或刷新文件列表。',
  'settings.memory.viewer.noSelection': '选择一个记忆文件以查看内容。',
  'settings.search.clear': '清空搜索',
}

/** 同一张表的读取口（键不存在时原样返回键名，便于排查漏译）。 */
export function memoryText(id: string): string {
  return MEMORY_SETTINGS_TEXT[id] ?? id
}

/** 缺省格式化：只替换调用方给的占位，没给的占位保持原样（缺键原样返回 id）。 */
export function defaultMemoryFormatMessage(
  descriptor: { id: string },
  values: Record<string, string> = {},
): string {
  const template = MEMORY_SETTINGS_TEXT[descriptor?.id ?? '']
  if (template === undefined) return descriptor?.id ?? ''
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

// ── 目录形状 ─────────────────────────────────────────────────────────────────

/** 目录里一条文件（正文与时间戳都存在**本机存储**里，不是磁盘）。 */
export interface ProjectMemoryFileRecord {
  name: string
  content: string
  updatedAt: number
}

export interface ProjectMemoryWorkspaceRecord {
  id: string
  files: ProjectMemoryFileRecord[]
}

export interface MemoryCatalog {
  workspaces: ProjectMemoryWorkspaceRecord[]
}

/** 清单里一条文件（给界面看的形状）。 */
export interface ProjectMemoryFileSummary {
  name: string
  path: string
  kind: 'index' | 'item'
  size: number
  updatedAt: number
}

export interface ProjectMemoryWorkspaceSummary {
  id: string
  label: string
  updatedAt: number
  files: ProjectMemoryFileSummary[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 路径段校验（`memoryService.ts:23-39`）：只认字母数字与 `._-`，`.` / `..` 不算。 */
export function isValidMemoryPathSegment(segment: unknown): boolean {
  if (typeof segment !== 'string' || !segment) return false
  if (segment === '.' || segment === '..') return false
  return /^[A-Za-z0-9._-]+$/.test(segment)
}

/** 文件名白名单：`MEMORY.md` 或除它以外的 `*.md`（`MEMORY.MD` 不算 —— 大小写敏感）。 */
export function isProjectMemoryFileName(name: unknown): boolean {
  if (typeof name !== 'string' || !name.endsWith('.md')) return false
  const base = name.slice(0, -'.md'.length)
  return isValidMemoryPathSegment(base)
}

/** 工作区标签：剥掉尾部 `-` + 正好 16 位 hex（`memoryService.ts:41-44`），后缀不匹配就原样返回。 */
export function resolveWorkspaceLabel(workspaceId: string): string {
  const id = typeof workspaceId === 'string' ? workspaceId : ''
  const match = /^(.+)-[0-9a-fA-F]{16}$/.exec(id)
  return match ? match[1]! : id
}

/** 展示路径：`<id>/memory/<name>`（`memoryService.ts:182-197` 的布局）。 */
export function deriveMemoryFilePath(workspaceId: string, fileName: string): string {
  return `${workspaceId}/${PROJECT_MEMORY_DIRECTORY_NAME}/${fileName}`
}

/** 文件排序：index 在前，其余按名称 en 排序（`memoryService.ts:102-110`）。 */
export function compareProjectMemoryFiles(
  a: { kind?: string; name?: string },
  b: { kind?: string; name?: string },
): number {
  const rank = (item: { kind?: string; name?: string }) =>
    item?.kind === 'index' || item?.name === PROJECT_MEMORY_INDEX_FILE_NAME ? 0 : 1
  const byKind = rank(a) - rank(b)
  if (byKind !== 0) return byKind
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'en')
}

/** UTF-8 字节数（ZCode 取磁盘文件 size；这里是同一口径的字符串版本）。 */
export function memoryFileByteSize(text: unknown): number {
  const value = typeof text === 'string' ? text : ''
  if (!value) return 0
  if (typeof TextEncoder === 'undefined') return value.length
  return new TextEncoder().encode(value).length
}

// ── 归一化与持久化 ───────────────────────────────────────────────────────────

/**
 * 任意输入 → 一份合法目录。**永不抛**：垃圾条目只丢自己，同名文件 / 同 id 工作区只留第一条
 * （哪条生效说不清就是坏数据），`content` 非字符串退空串，`updatedAt` 非法退 0。
 */
export function normalizeMemoryCatalog(input: unknown): MemoryCatalog {
  if (!isRecord(input) || !Array.isArray(input.workspaces)) return { workspaces: [] }
  const workspaces: ProjectMemoryWorkspaceRecord[] = []
  const seen = new Set<string>()
  for (const item of input.workspaces) {
    if (!isRecord(item)) continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!isValidMemoryPathSegment(id) || seen.has(id)) continue
    seen.add(id)
    const files: ProjectMemoryFileRecord[] = []
    const names = new Set<string>()
    const rawFiles = Array.isArray(item.files) ? item.files : []
    for (const file of rawFiles) {
      if (!isRecord(file)) continue
      const name = typeof file.name === 'string' ? file.name : ''
      if (!isProjectMemoryFileName(name) || names.has(name)) continue
      names.add(name)
      const updatedAt = typeof file.updatedAt === 'number' && Number.isFinite(file.updatedAt) ? file.updatedAt : 0
      files.push({ name, content: typeof file.content === 'string' ? file.content : '', updatedAt })
    }
    workspaces.push({ id, files })
  }
  return { workspaces }
}

export function loadMemoryCatalog(storage: SettingsStorage | null = defaultSettingsStorage()): MemoryCatalog {
  return readSettingsJson(storage, AGENT_MEMORY_STORE_STORAGE_KEY, normalizeMemoryCatalog)
}

export function saveMemoryCatalog(catalog: MemoryCatalog, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_MEMORY_STORE_STORAGE_KEY, catalog)
}

// ── 清单 ─────────────────────────────────────────────────────────────────────

/**
 * 工作区清单（`memoryService.ts:113-199`）：跳空工作区；文件 index 在前；
 * 工作区按 updatedAt 降序、同值按 id 升序；label 由 id 还原。
 */
export function listProjectMemories(storage: SettingsStorage | null = defaultSettingsStorage()): ProjectMemoryWorkspaceSummary[] {
  const catalog = loadMemoryCatalog(storage)
  const summaries: ProjectMemoryWorkspaceSummary[] = []
  for (const workspace of catalog.workspaces) {
    if (!workspace.files.length) continue
    const files: ProjectMemoryFileSummary[] = workspace.files
      .map(file => ({
        name: file.name,
        path: deriveMemoryFilePath(workspace.id, file.name),
        kind: file.name === PROJECT_MEMORY_INDEX_FILE_NAME ? 'index' as const : 'item' as const,
        size: memoryFileByteSize(file.content),
        updatedAt: file.updatedAt,
      }))
      .sort(compareProjectMemoryFiles)
    summaries.push({
      id: workspace.id,
      label: resolveWorkspaceLabel(workspace.id),
      updatedAt: Math.max(...workspace.files.map(file => file.updatedAt)),
      files,
    })
  }
  return summaries.sort((a, b) => (b.updatedAt - a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 搜索过滤（`MemorySettingsViewer.tsx:59-66`）：空查询命中全部；查询 trim + 小写，文件名也小写。 */
export function filterMemoryFiles<T extends { name: string }>(files: T[] | undefined, query: unknown): T[] {
  const list = Array.isArray(files) ? files : []
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!needle) return [...list]
  return list.filter(file => String(file?.name ?? '').toLowerCase().includes(needle))
}

// ── 显示名与排序（`MemorySettingsSection.tsx:15-40, 104-125`）──────────────────

/** 显示名 → slug：小写、非字母数字压成 `-`、最多 48 字符；空则 `project`。 */
export function normalizeWorkspaceDisplayName(name: unknown): string {
  const slug = (typeof name === 'string' ? name : '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'project'
}

/** slug → 显示名；**slug 相同但显示名不同的整条删除**（歧义 slug 不能用来定位工作区）。 */
export function buildWorkspaceDisplayNameMap(names: unknown): Map<string, string> {
  const bySlug = new Map<string, Set<string>>()
  const list = Array.isArray(names) ? names : []
  for (const name of list) {
    const text = typeof name === 'string' ? name : ''
    if (!text) continue
    const slug = normalizeWorkspaceDisplayName(text)
    const bucket = bySlug.get(slug) ?? new Set<string>()
    bucket.add(text)
    bySlug.set(slug, bucket)
  }
  const map = new Map<string, string>()
  for (const [slug, values] of bySlug) {
    if (values.size === 1) map.set(slug, [...values][0]!)
  }
  return map
}

/** 名单内的工作区按名单顺序在前（label 换成显示名），名单外的排在后面、保持原 label。 */
export function orderMemoryWorkspaces<
  T extends { id: string; label: string; updatedAt: number; files: ProjectMemoryFileSummary[] },
>(workspaces: T[] | undefined, names: unknown): T[] {
  const list = Array.isArray(workspaces) ? workspaces : []
  const wanted = (Array.isArray(names) ? names : []).filter((name): name is string => typeof name === 'string' && name.length > 0)
  const used = new Set<number>()
  const ordered: T[] = []
  for (const name of wanted) {
    const slug = normalizeWorkspaceDisplayName(name)
    for (const [index, workspace] of list.entries()) {
      if (used.has(index)) continue
      if (normalizeWorkspaceDisplayName(workspace?.label) !== slug) continue
      used.add(index)
      ordered.push({ ...workspace, label: name })
    }
  }
  list.forEach((workspace, index) => { if (!used.has(index)) ordered.push(workspace) })
  return ordered
}

// ── 条数与时间 ───────────────────────────────────────────────────────────────

/** 条数文案（`MemorySettingsViewer.tsx:52-58`）：单复数两个 id 在 zh-CN 里同文。 */
export function formatMemoryCount(
  count: number,
  format: (descriptor: { id: string; count: number }, values?: Record<string, string>) => string = defaultMemoryFormatMessage,
): string {
  const value = typeof count === 'number' && Number.isFinite(count) ? count : 0
  const id = `settings.memory.viewer.memoryCount.${value === 1 ? 'one' : 'other'}`
  return format({ id, count: value }, { count: String(value) })
}

function formatClock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function formatDate(date: Date, locale: string, withYear: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    ...(withYear ? { year: 'numeric' } : {}),
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

/**
 * 更新时间（`memoryUpdatedAt.ts:62-120` 的分支顺序）：
 * 非有限值 / 不足 1 分钟 ⇒ 刚刚；30 分钟以内 ⇒ N 分钟前；
 * 今天 / 昨天 / 本周（周一为一周之始）/ 更早（同年不带年，跨年带年）。
 * 非 zh-CN 走 Intl 日期分支（`:29-34, 41-56`）。
 */
export function formatMemoryUpdatedAt(input: { locale: string; now: number; updatedAt: number }): string {
  const locale = typeof input?.locale === 'string' && input.locale ? input.locale : 'zh-CN'
  const now = input?.now
  const updatedAt = input?.updatedAt
  const immediately = () => defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.justNow' })
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return immediately()
  const elapsed = (typeof now === 'number' ? now : 0) - updatedAt
  if (elapsed < 60_000) return immediately()
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 30) return defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.minutesAgo' }, { count: String(minutes) })

  const date = new Date(updatedAt)
  const time = formatClock(date, locale)
  if (locale !== 'zh-CN') {
    return `${formatDate(date, locale, date.getFullYear() !== new Date(now).getFullYear())} ${time}`
  }
  const today = new Date(now)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  if (dateStart === todayStart) return defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.today' }, { time })
  const yesterday = new Date(todayStart)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dateStart === yesterday.getTime()) return defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.yesterday' }, { time })
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  if (dateStart >= weekStart.getTime()) {
    const weekday = defaultMemoryFormatMessage(
      { id: 'settings.memory.viewer.updated.weekdayZh' },
      { weekday: '日一二三四五六'[date.getDay()] ?? '' },
    )
    return defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.weekday' }, { weekday, time })
  }
  const sameYear = date.getFullYear() === today.getFullYear()
  const dateText = sameYear
    ? defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.dateMonthDay' }, {
      month: String(date.getMonth() + 1), day: String(date.getDate()),
    })
    : defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.dateYearMonthDay' }, {
      year: String(date.getFullYear()), month: String(date.getMonth() + 1), day: String(date.getDate()),
    })
  return defaultMemoryFormatMessage({ id: 'settings.memory.viewer.updated.date' }, { date: dateText, time })
}

// ── 读正文（带 5 MiB 预览上限与读取期复核）────────────────────────────────────

/** 带错误码的错误（调用方按 `error.code` 分支：EINVAL / ENOENT / 两个专用码）。 */
function memoryError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

/**
 * 读一条记忆文件的正文。
 *
 * 顺序不可调换（`memoryService.ts:201-232` + `projectMemoryStableRead.ts:27-97`）：
 *   1. 路径段 / 文件名非法 ⇒ EINVAL；
 *   2. 工作区或文件不存在（含存储不可用）⇒ ENOENT；
 *   3. 超过 5 MiB 预览上限 ⇒ PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED；
 *   4. 复核：读第二遍，正文或时间戳变了（或文件没了）⇒ PROJECT_MEMORY_FILE_CHANGED。
 */
export function readProjectMemoryFile(
  params: { workspaceId: string; fileName: string },
  storage: SettingsStorage | null = defaultSettingsStorage(),
): { content: string; updatedAt: number } {
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const fileName = typeof params?.fileName === 'string' ? params.fileName : ''
  if (!isValidMemoryPathSegment(workspaceId) || !isProjectMemoryFileName(fileName)) {
    throw memoryError('EINVAL', '工作区或文件名非法。')
  }
  const notFound = () => memoryError('ENOENT', '找不到该记忆文件。')
  const find = (catalog: MemoryCatalog): ProjectMemoryFileRecord | null => {
    const workspace = catalog.workspaces.find(item => item.id === workspaceId)
    return workspace?.files.find(file => file.name === fileName) ?? null
  }
  const first = find(loadMemoryCatalog(storage))
  if (!first) throw notFound()
  if (memoryFileByteSize(first.content) > PROJECT_MEMORY_PREVIEW_MAX_BYTES) {
    throw memoryError(PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE, '该记忆文件超过 5 MiB 预览上限。')
  }
  const second = find(loadMemoryCatalog(storage))
  if (!second || second.content !== first.content || second.updatedAt !== first.updatedAt) {
    throw memoryError(PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE, '该记忆文件在读取期间已更新。')
  }
  return { content: first.content, updatedAt: first.updatedAt }
}
