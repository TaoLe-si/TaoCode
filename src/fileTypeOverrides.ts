// 按文件覆盖文件类型 —— 上游 `platform/lang-impl/src/com/intellij/openapi/file/exclude/` 一族。
//
// 用户可见行为：右键一个文件 → Override File Type → 从**已注册的类型表**里挑一个（上游
// `OverrideFileTypeAction.java:53-76`：列的是 `FileTypeManager.getRegisteredFileTypes()`，
// 按显示名大小写不敏感排序，只列 `isAvailableForOverride` 的那些，重名时附
// 「bundled 插件 / 来自某插件」的提示，`:64-72`），这个文件就按覆盖后的类型走
// （`UserFileTypeOverrider.java:17-24` 把覆盖值 `findFileTypeByName` 之后交给 FileTypeManager）；
// `ReverteOverrideFileTypeAction` 撤销。持久化是 `PersistentFileSetManager` 的
// `<file url="file:///…" value="…"/>` 形态（value 缺省 = PlainText，`:104-118`）。
//
// 本仓落成：
//   · 存储 —— localStorage 里一份按名字分空间的文件集（`FILE_SETS_KEY`），默认集
//     `plainTextFiles`；条目就是 `{ url, value }`（url 用 file:// 形态，value 缺省 PLAIN_TEXT），
//     `parseFileSet` 对坏数据整份丢弃（与 analysisIgnore 同一口径）。
//   · 判定 —— `isFileTypeOverridden(path)` 是诊断聚合前的门控（src/problems.ts）；
//     `overrideTargetOf(path)` 给覆盖后的**类型描述符**，由 `src/fileTypeDetection.ts` 的
//     `detectFileType`/`resolveEditorLanguage` 消费（编辑器语言就是那条链）。
//   · 入口 —— 问题面板逐行的「纯文本」按钮与工具栏的覆盖清单；
//     设置 › 编辑器 › 文件类型页（`src/components/FileTypesPage.vue`）列已覆盖的文件、
//     可把目标改成注册表里任何一个类型、可撤销（文件树右键菜单在禁改的 App.vue 里，本批不碰）。
//
// **明确不做**（如实登记，别当成漏抄）：`CachedFileType.clearCache()` 本仓没有那层缓存
// （宿主 VFS 不缓存类型探测），它的等价物是 `src/fileTypeDetection.ts` 的探测缓存失效 +
// `reparseFileTypes()` 的版本号自增；上游排除的 `InternalFileType`/`DirectoryFileType`/
// `FakeFileType`/`FileTypeIdentifiableByVirtualFile`（`OverrideFileTypeManager.java:69-90`）
// 在本仓注册表里没有对应的标记位，所以没有那四条排除项 —— 本仓只排掉「认不出」那一档
// （`NATIVE`，上游的 `UnknownFileType` 位）。
import { ref } from 'vue'
import { fileTypeManager, type FileTypeDescriptor } from './fileTypeRegistry.ts'

/** 覆盖值：上游缺省值就是 `PlainTextFileType`（`PersistentFileSetManager.java:112/:131`）。 */
export const PLAIN_TEXT_TYPE = 'PLAIN_TEXT'

export const FILE_SETS_KEY = 'taocode.fileTypeOverrideSets'
export const DEFAULT_FILE_SET = 'plainTextFiles'

export interface FileSetEntry { url: string; value: string }

/** 工作区相对或绝对路径 → 键（绝对路径用 `file://`，相对路径原样 —— 上游 `VfsUtilCore.pathToUrl` 的等价物）。 */
export function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`
  if (normalized.startsWith('/')) return `file://${normalized}`
  return normalized
}

/** 反向换算：`file:///C:/…` 去三斜杠，不是 `file://` 开头时原样返回。 */
export function fileUrlToPath(url: string): string {
  if (!url.startsWith('file://')) return url
  const rest = decodeURIComponent(url.slice('file://'.length))
  return /^\/[A-Za-z]:\//.test(rest) ? rest.slice(1) : rest
}

/** `PersistentFileSetManager.getState()`：按 url 排序、PlainText 不写 value 属性。 */
export function serializeFileSet(entries: readonly FileSetEntry[]): string {
  return JSON.stringify([...entries]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map(entry => (entry.value && entry.value !== PLAIN_TEXT_TYPE ? { url: entry.url, value: entry.value } : { url: entry.url })))
}

/** `PersistentFileSetManager.loadState()`：坏行整份丢弃，缺 value 的条目按 PlainText 解。 */
export function parseFileSet(raw: unknown): FileSetEntry[] {
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(data)) return []
  const out: FileSetEntry[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const url = (item as { url?: unknown }).url
    if (typeof url !== 'string' || !url) continue
    const value = (item as { value?: unknown }).value
    out.push({ url, value: typeof value === 'string' && value ? value : PLAIN_TEXT_TYPE })
  }
  return out
}

interface StoredFileSets { [name: string]: FileSetEntry[] }

function readSets(): StoredFileSets {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FILE_SETS_KEY)
    if (!raw) return {}
    return parseSetsObject(JSON.parse(raw))
  } catch {
    return {}
  }
}

function parseSetsObject(value: unknown): StoredFileSets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: StoredFileSets = {}
  for (const [name, entries] of Object.entries(value as Record<string, unknown>)) out[name] = parseFileSet(entries)
  return out
}

function writeSets(sets: StoredFileSets) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FILE_SETS_KEY, JSON.stringify(sets))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的覆盖照常生效。
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 能覆盖的文件：非空、不是目录（无尾 `/`）、不是合成节点（`\0` 前缀）。 */
export function isOverridableFile(path: string, isDirectory = false): boolean {
  return Boolean(path) && !isDirectory && !path.startsWith('\0') && !normalize(path).endsWith('/')
}

/**
 * `OverrideFileTypeManager.isOverridable`（`:69-78`）：**当前**类型能不能被覆盖走。
 * 上游排除 `InternalFileType`/`DirectoryFileType`/`UnknownFileType`/`FakeFileType`/
 * `FileTypeIdentifiableByVirtualFile` 五类；本仓的注册表只有「认不出」那一档是同类
 * （`NATIVE`，上游的 `UnknownFileType` 位，`NativeFileType.java:18-19`），
 * 其余四类在本仓没有对应标记 —— 少掉的四条不是漏抄，见文件头。
 * 描述符查不到（例如文件根本没有类型）时**允许**覆盖：上游 `isMyFileType` 那条只在
 * 类型确实存在时才限制。
 */
export function isOverridableType(descriptor: FileTypeDescriptor | null): boolean {
  if (!descriptor) return true
  return descriptor.id !== NATIVE_TYPE_ID
}

/** `OverrideFileTypeManager.isAvailableForOverride`（`:83-90`）：能不能**当成覆盖目标**。 */
export function isAvailableForOverride(descriptor: FileTypeDescriptor): boolean {
  if (descriptor.id === NATIVE_TYPE_ID) return false
  // 上游的 `DirectoryFileType` 那一档：本仓的类型全是文件类型，目录由文件树自己画。
  return !descriptor.binary
}

/** 上游 `NativeFileType` 在本仓注册表里的 id（`fileTypeRegistry.ts:127`）。 */
export const NATIVE_TYPE_ID = 'NATIVE'

/** 一个可当覆盖目标的类型行（`OverrideFileTypeAction.java:59-76` 的那张弹出列表）。 */
export interface OverrideTargetOption {
  id: string
  /** 列表里显示的那行：显示名 + 重名时的来源提示（`:74` 的 `displayText`）。 */
  label: string
  language: string
  /** 重名提示（`:64-72`：`" (bundled plugin)"` / `" (from plugin X)"` —— 本仓没有插件宿主，见下）。 */
  duplicateHint: string
}

/**
 * 「Override File Type」那个列表（上游 `OverrideFileTypeAction.actionPerformed`，`:48-81`）：
 * 取 `getRegisteredFileTypes()`、按显示名**大小写不敏感**排序（`:59-60`）、
 * 只留 `isAvailableForOverride` 的（`:62`）、显示名重复时附上来源提示（`:64-72`）。
 *
 * 提示那段本仓现在填得出来了：插件声明的类型（`src/fileTypePluginBeans.ts` 灌进注册表时把
 * 插件名写进 `descriptor.vendor`，上游是 `findPluginDescriptor` 的那一步）在重名时标
 * 「来自插件 X」；平台自带的标「bundled 插件」（`ActionsBundle` 的
 * `group.OverrideFileTypeAction.bundledPlugin`）。既不是 bundled 又没有厂商的（用户自己
 * 在设置页建的类型）留空串 —— 上游此时也不加提示。
 */
export function overridableFileTypes(): OverrideTargetOption[] {
  const types = fileTypeManager.getRegisteredTypes().filter(isAvailableForOverride)
  const duplicates = new Map<string, number>()
  for (const type of types) {
    const key = type.name.toLowerCase()
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1)
  }
  return types
    .slice()
    .sort((left, right) => {
      const a = left.name.toLowerCase()
      const b = right.name.toLowerCase()
      return a < b ? -1 : a > b ? 1 : 0
    })
    .map(type => {
      const duplicate = (duplicates.get(type.name.toLowerCase()) ?? 0) > 1
      const duplicateHint = !duplicate ? '' : type.bundled ? '（bundled 插件）' : (type.vendor ? `（来自插件 ${type.vendor}）` : '')
      return { id: type.id, label: duplicateHint ? `${type.name} ${duplicateHint}` : type.name, language: type.language, duplicateHint }
    })
}

/** 覆盖目标 → 类型描述符（上游 `FileTypeManager.findFileTypeByName(overriddenType)`，`UserFileTypeOverrider.java:21`）。 */
export function fileTypeDescriptorOfOverride(value: string | null): FileTypeDescriptor | null {
  if (!value) return null
  return fileTypeManager.getType(value)
}

/** 一个文件当前**生效**的覆盖类型（没有覆盖返回 null；`UserFileTypeOverrider.java:17-24`）。 */
export function overrideTargetOf(path: string): FileTypeDescriptor | null {
  return fileTypeDescriptorOfOverride(fileTypeOverrideOf(path))
}

/** 覆盖清单里给人看的一行：路径 + 目标类型名（目标被注销时如实标「已失效」而不是猜）。 */
export interface FileTypeOverrideRow {
  path: string
  value: string
  /** 目标类型还在注册表里吗（不在 = 这条覆盖没有可生效的类型）。 */
  resolved: boolean
  typeLabel: string
  /** 这条覆盖现在是否**生效**于编辑器（目标语言在本仓有专属词法层，或目标是纯文本）。 */
  effective: boolean
}

/** 已覆盖文件清单（设置页与问题面板的「覆盖清单」都用它）。 */
export function fileTypeOverrideRows(overrides: readonly FileSetEntry[] = fileSetEntries.value): FileTypeOverrideRow[] {
  return overrides.map(entry => {
    const value = entry.value || PLAIN_TEXT_TYPE
    const descriptor = fileTypeDescriptorOfOverride(value)
    return {
      path: fileUrlToPath(entry.url),
      value,
      resolved: descriptor !== null,
      typeLabel: descriptor?.name ?? `【已注销的类型 ${value}】`,
      effective: descriptor !== null && (value === PLAIN_TEXT_TYPE || EDITOR_OVERRIDE_LANGUAGES.has(descriptor.language)),
    }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

/** 与 `src/fileTypeDetection.ts` 的 `EDITOR_FORCED_LANGUAGES` 同一档：本仓编辑器只认这三种语言。 */
const EDITOR_OVERRIDE_LANGUAGES = new Set(['java', 'cpp', 'typescript'])


/** 覆盖集（当前会话的权威来源；后端是上面那份 localStorage）。 */
export const fileSetEntries = ref<FileSetEntry[]>(readSets()[DEFAULT_FILE_SET] ?? [])

function save(entries: FileSetEntry[]) {
  fileSetEntries.value = entries
  const sets = readSets()
  sets[DEFAULT_FILE_SET] = entries
  writeSets(sets)
}

export function fileSetPaths(entries: readonly FileSetEntry[] = fileSetEntries.value): string[] {
  return entries.map(entry => fileUrlToPath(entry.url))
}

/** 给一个文件设覆盖值（缺省 PlainText）。重复设置不追加第二条。 */
export function overrideFileType(path: string, value = PLAIN_TEXT_TYPE): boolean {
  if (overrideFailureReason(path, value)) return false
  const url = pathToFileUrl(normalize(path))
  const entries = fileSetEntries.value.filter(entry => entry.url !== url)
  entries.push({ url, value })
  save(entries)
  return true
}

/**
 * 「为什么这条覆盖设不下去」（上游 `OverrideFileTypeManager.addFile`，`:48-54` 那段
 * `IllegalArgumentException` 的三种原因拆成可读文案，本仓不抛错、设置页直接显示）：
 *   · 目标类型不在注册表 / 不允许当覆盖目标（`:83-90` 的 `isAvailableForOverride`）；
 *   · 文件本身不能覆盖（目录、合成节点，`PersistentFileSetManager.java:57-60`）；
 *   · 文件当前类型不允许被覆盖走（`:69-78` 的 `isOverridable`，本仓只有「认不出」那一档）。
 * 返回空串 = 可以设。
 */
export function overrideFailureReason(path: string, value = PLAIN_TEXT_TYPE): string {
  if (!isOverridableFile(path)) return '只有工作区里的普通文件能覆盖文件类型。'
  const descriptor = fileTypeManager.getType(value)
  if (!descriptor) return `注册表里没有「${value}」这个文件类型，覆盖不会生效。`
  if (!isAvailableForOverride(descriptor)) return `「${descriptor.name}」不能当覆盖目标（上游 isAvailableForOverride 排除的那几类）。`
  const name = path.replace(/^.*[\\/]/, '')
  if (!isOverridableType(fileTypeManager.getFileTypeByFileName(name)))
    return `「${name}」当前是「认不出」那一档，上游不允许从它覆盖成别的类型（OverrideFileTypeManager.isOverridable）。`
  return ''
}

/**
 * 改一条**已存在**的覆盖的目标类型（设置页那行的下拉）。
 * 上游没有这个动作（它靠「撤销 + 重新覆盖」），但存的就是同一个 `value` 属性
 * （`PersistentFileSetManager.java:104-118`），所以本仓的等价物是原地换值并同样触发重解析。
 * 返回 false = 新目标不合法（原因见 `overrideFailureReason`）或这条路径本来没覆盖过。
 */
export function changeFileTypeOverride(path: string, value: string): boolean {
  const url = pathToFileUrl(normalize(path))
  if (!fileSetEntries.value.some(entry => entry.url === url)) return false
  if (overrideFailureReason(path, value)) return false
  save(fileSetEntries.value.map(entry => (entry.url === url ? { url, value } : entry)))
  return true
}

/** `ReverteOverrideFileTypeAction`：撤销一个文件的覆盖；本来就没覆盖返回 false。 */
export function revertFileType(path: string): boolean {
  const url = pathToFileUrl(normalize(path))
  const entries = fileSetEntries.value
  const next = entries.filter(entry => entry.url !== url)
  if (next.length === entries.length) return false
  save(next)
  return true
}

export function fileTypeOverrideOf(path: string): string | null {
  const url = pathToFileUrl(normalize(path))
  return fileSetEntries.value.find(entry => entry.url === url)?.value ?? null
}

/** 诊断聚合前的门控：true ⇒ 这个文件已退出语言分析。 */
export function isFileTypeOverridden(path: string): boolean {
  return fileTypeOverrideOf(path) === PLAIN_TEXT_TYPE
}

/** 恢复全部（面板的「恢复全部」与测试用）。 */
export function clearFileTypeOverrides(): void {
  save([])
}
