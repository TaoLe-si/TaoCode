// 文件类型注册表 —— 上游 `FileTypeManager`/`FileTypeRegistry` 门面与
// `FileTypeRegistrar`/`FileTypeFactory`/`FileTypeConsumer`/`FileTypeEvent`/`FileTypeListener`
// 一族在本仓的对应物（`platform/ide-core/src/com/intellij/openapi/fileTypes` 与
// `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java`）。
//
// 上游语义（逐条对齐，测试在 `tests/file-type-registry.test.mjs`）：
//   · 三条关联表分开存：扩展名（**大小写不敏感**，`FileTypeAssocTable.myExtensionMappings`）、
//     精确文件名（大小写敏感 + 忽略大小写两张）、通配模式（`WildcardFileNameMatcher`）；
//   · `getFileTypeByFileName` 的优先级照 `FileTypeAssocTable.findAssociatedFileType`（:159-175）：
//     精确名（含忽略大小写）→ 通配模式（**更具体的在前**，同长时 `?` 先于 `*`）→ 扩展名；
//   · `getFileTypeByExtension` 查不到回 Unknown（本仓回 null，调用方自己决定兜底）；
//   · 变更广播 `beforeFileTypesChanged` / `fileTypesChanged`（`FileTypeEvent` 带 added/removed）；
//   · 忽略清单 `getIgnoredFilesList`/`setIgnoredFilesList` 是分号分隔的掩码
//     （`IgnoredPatternSet`：`*.pyc;*.class`），`isFileIgnored` 按同一张模式表判定；
//   · `FileTypeConsumer.consume(type, "java;kt")` 分号分隔的扩展名/文件名一条条认领
//     （`FileTypeConsumer.EXTENSION_DELIMITER = ";"`）。
//
// 本仓的消费链：`src/fileTypeDetection.ts` 的 `detectFileType`/`resolveEditorLanguage` 按这张表
// 认类型（编辑器 `:language` prop 的真实入口，App.vue 的 `associationOf`），注册/注销会立刻
// 改变编辑器语言判定 —— 类型集合不再只是设置页的静态字典。
//
// `ic/file-types` 判词剩下的那一半（**冲突审批**）落在 `src/fileTypeRemovedMappings.ts`，
// 这里是它的四处消费点，逐条对应 `FileTypeManagerImpl.java`：
//   · `:1591-1595` 新类型自己名下有「已摘除」记录 ⇒ 这条匹配器**不认领**；
//   · `:1597-1603` 旧类型名下有「已摘除」记录 ⇒ 「不算冲突，新类型赢」（用户已明确说过把它拿走）；
//   · `:1615-1619` 冲突判完且已获批准 ⇒ 给落败的旧类型记一条 approved 的摘除记录；
//   · `:1849-1852` 真正认领成功 ⇒ 删掉该类型名下这条摘除记录（认领就是撤销摘除）。
// 上游的 `removeAssociation`（`:1864-1874`）本身不记表，记账由调用方做
// （冲突通知里的 `myRemovedMappingTracker.add(matcher, oldFtd.getName(), true)`，
// `ConflictingFileTypeMappingTracker.java:161`；装载设置时的 `:1353` 记未批准的）。
// 所以本仓把「记不记、批准与否」做成 `removeAssociation` 的显式第三参，由设置页传 `approved`。

// 「这条关联是从哪个类型**摘掉**的」的账本与审批规则（上游 `RemovedMappingTracker` 一族）。
// 循环依赖的注意：本模块在**模块底部**建 `fileTypeManager` 单例，而 `fileTypeRemovedMappings.ts`
// 反过来用本模块的 `presentableMatcher` —— 所以账本必须是**懒建**的（见 `FileTypeManager.removedMappings()`），
// 否则从 `fileTypeRemovedMappings.ts` 先入口时类绑定还在 TDZ 里，单例会构造失败。
import { RemovedMappingTracker, type RemovedMapping } from './fileTypeRemovedMappings.ts'

/** 一条文件名匹配器（`FileNameMatcher` 的可判别联合）。 */
export type FileNameMatcher =
  | { kind: 'extension'; extension: string }
  | { kind: 'exact'; fileName: string; ignoreCase?: boolean }
  | { kind: 'wildcard'; pattern: string }

export interface FileTypeDescriptor {
  /** 稳定 id（上游 `FileType.getName()`，同一 id 重复注册按覆盖处理）。 */
  id: string
  /** 展示名（设置页/状态栏给人看的，如 `C/C++`）。 */
  name: string
  /** 本仓编辑器语言 id（`src/languages.ts` 的 `EDITOR_LANGUAGES` 之一）。 */
  language: string
  /** 二进制类型（`UserBinaryFileType`/`NativeFileType` 的 isBinary）：本仓只作标记。 */
  binary?: boolean
  /** 注册时认领的匹配器（`FileTypeRegistrar.initFileType` 的等价物）。 */
  matchers?: readonly FileNameMatcher[]
  /**
   * 声明来源（上游 `FileTypeBean implements PluginAware` 的 `pluginDescriptor`：
   * 冲突审批要靠它分出 bundled / core / 第三方）。本仓没有插件宿主，所以只有
   * **进程内注册表的标准表**把它标成 bundled+core（等价于平台自带），其余调用方
   * 不给这三个字段 = 第三方声明。判定规则见 `resolveFileTypeConflict`。
   */
  bundled?: boolean
  /** 平台自带的核心类型（上游 `isCorePlugin`，`ConflictingFileTypeMappingTracker.java:122`）。 */
  core?: boolean
  /** 声明方厂商（上游 `PluginDescriptor.getVendor`，`:107-108` 比 JetBrains 与否）。 */
  vendor?: string
  /**
   * 这个类型的内容来自文件模板（上游 `TemplateLanguageFileType` 只是一个标记接口，
   * `TemplateLanguageFileType.java:4` —— 没有方法，所以这里也只能是个标记）。
   */
  template?: boolean
}

export interface FileTypeEvent {
  /** 本次变更新增的类型（删除事件里为 null）。 */
  added: FileTypeDescriptor | null
  /** 本次变更移除的类型（新增事件里为 null）。 */
  removed: FileTypeDescriptor | null
  /**
   * 本次变更里**同一匹配器被两个类型认领**的判定结果（上游
   * `ConflictingFileTypeMappingTracker.resolveConflict` 的 `ResolveConflictResult`，:67-71）。
   * 一次 `register` 可以带多条（`FileTypeEvent` 每次只带一个文件类型）。
   */
  conflicts?: readonly FileTypeConflict[]
}

/** 一条关联冲突的判定结果（上游 `ResolveConflictResult`，`ConflictingFileTypeMappingTracker.java:67-71`）。 */
export interface FileTypeConflict {
  /** 被两个类型抢的那条匹配器。 */
  matcher: FileNameMatcher
  /** 胜出的类型 id（上游 `resolved`）：关联留在它名下。 */
  resolved: string
  /** 落败的类型 id（上游那一侧）：本次 `associate` 不会把关联给它。 */
  overridden: string
  /**
   * 是否**已获批准**（上游 `approved`）。`false` 表示上游会走
   * `ApproveRemovedMappingsActivity` 那条要用户点头的路；本仓没有那个活动，
   * 所以只把结论挂在事件上（见 `getConflicts()`），不改胜者。
   */
  approved: boolean
  /** 给用户看的一句话（上游 `FileTypesBundle.message("notification.content.file.pattern.was.reassigned.to", …)`，:101/:111/:117）。 */
  message: string
}

export interface FileTypeListener {
  beforeFileTypesChanged?: (event: FileTypeEvent) => void
  fileTypesChanged?: (event: FileTypeEvent) => void
}

/**
 * 一条 hashbang 改判的撞车结果（上游 `FileTypeConfigurable.HashBangConflict`，`:818-821` 那个 record：
 * `fileType` / `exact` / `writeable` / `existingHashBang` 四个字段）。
 * `exact` 决定用哪一条文案（`filetype.edit.hashbang.exists.exact.*` vs `.similar.*`，
 * `FileTypesBundle.properties:25-28`），`writable` 决定是错误框还是确认框（`:779-795`）。
 */
export interface HashBangConflict {
  /** 撞车的那条**已存在**模式（上游 `existingHashBang`）。 */
  pattern: string
  typeId: string
  /** 持有方的展示名（上游 `existingFileType.getDescription()`）。 */
  typeName: string
  exact: boolean
  writable: boolean
}

/** 把一条字符串模式解析成匹配器：`*.foo`（且尾段无点/通配）扩展名、带 `*`/`?` 的通配、其余精确名。 */
export function parseFileNameMatcher(pattern: string): FileNameMatcher {
  const text = pattern.trim()
  // 上游 `FileNameMatcherFactoryImpl.createMatcher`：`*.ext` 还要求 ext 段里没有 `*`、`.`、`?`，
  // 所以 `*.d.ts` 落在通配分支而不是扩展名分支。
  if (text.startsWith('*.') && !text.slice(2).includes('*') && !text.slice(2).includes('.') && !text.slice(2).includes('?'))
    return { kind: 'extension', extension: text.slice(2).toLowerCase() }
  if (text.includes('*') || text.includes('?')) return { kind: 'wildcard', pattern: text }
  return { kind: 'exact', fileName: text }
}

/** 通配模式 → 正则（`*` 任意串、`?` 一个字符；上游 `PatternUtil.fromMask` 的等价物）。 */
function maskToRegExp(pattern: string): RegExp {
  let source = ''
  for (const character of pattern) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

/** 模式的具体度排序（上游 IJPL-149806 的比较器：模式串长的在前，同长时 `?` 先于 `*`）。 */
function specificityScore(matcher: FileNameMatcher): string {
  const text = matcher.kind === 'wildcard' ? matcher.pattern : ''
  return text.length.toString().padStart(6, '0') + text.replace(/\?/g, '\uFFFE').replace(/\*/g, '\uFFFF')
}

/** `FileNameMatcher.getPresentableString()` 的等价物（冲突提示里给人看的那一段）。 */
export function presentableMatcher(matcher: FileNameMatcher): string {
  return matcher.kind === 'extension' ? `*.${matcher.extension}` : matcher.kind === 'exact' ? matcher.fileName : matcher.pattern
}

/** `NativeFileType` 的类型 id（`NativeFileType.java:24-26` 的 `getName()` 返回 `Native`）。 */
export const NATIVE_FILE_TYPE_ID = 'NATIVE'

/**
 * 同一匹配器被两个类型认领时**谁赢** —— 逐行照
 * `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/ConflictingFileTypeMappingTracker.java`
 * 的 `resolveConflict`（:73-120）走，连顺序也照它：
 *   1. `:78-83` 先把 bundled/core 的一方挪到"旧"侧；
 *   2. `:93-98` 新方不是 bundled（或旧方是 core 而新方不是）→ **新方赢**，approved = 旧方是否 bundled；
 *   3. `:99-103` 旧方是 `NativeFileType` → **新方赢**，approved = true（上游注释：覆盖它总是好的）；
 *   4. `:107-114` 两边都是 bundled 时比厂商：JetBrains 方赢；
 *   5. `:117-119` 其余平局 → **旧方赢**，approved = false（上游注释：保留旧方，免得同一次改判通知两遍）。
 */
export function resolveFileTypeConflict(matcher: FileNameMatcher, oldType: FileTypeDescriptor, newType: FileTypeDescriptor): FileTypeConflict {
  const pattern = presentableMatcher(matcher)
  let oldFtd = oldType
  let newFtd = newType
  if (newFtd.bundled && (!oldFtd.bundled || (newFtd.core && !oldFtd.core))) { const swap = oldFtd; oldFtd = newFtd; newFtd = swap }
  const pick = (winner: FileTypeDescriptor, approved: boolean): FileTypeConflict => ({
    matcher,
    resolved: winner.id,
    overridden: winner.id === newFtd.id ? oldFtd.id : newFtd.id,
    approved,
    // 上游三条文案都取 `notification.content.file.pattern.was.reassigned.to`（:101/:111/:117），
    // 只有 :96 那条带插件名（`…reassigned.plugin`）—— 本仓没有插件名可填，取短的那条。
    message: `文件模式 ${pattern} 已改判给「${winner.name}」。`,
  })
  if (!newFtd.bundled || (oldFtd.core && !newFtd.core)) return pick(newFtd, Boolean(oldFtd.bundled))
  if (oldType.id === NATIVE_FILE_TYPE_ID) return pick(newFtd, true)
  // 上游比的是 `PluginManagerCore.isVendorJetBrains(notNullize(plugin.getVendor()))`（:107-108）。
  const isJetBrains = (type: FileTypeDescriptor) => (type.vendor ?? '').toLowerCase().includes('jetbrains')
  if (isJetBrains(oldFtd) !== isJetBrains(newFtd)) return pick(isJetBrains(oldFtd) ? newFtd : oldFtd, true)
  return pick(oldFtd, false)
}

// ── `FileTypeBean`：`<fileType …>` 声明式注册的等价物 ───────────────────────────────────

/**
 * `<fileType name="…" language="…" extensions="…" fileNames="…" patterns="…"
 *            fileNamesCaseInsensitive="…" hashBangs="…" …/>` 的形状
 * （上游 `FileTypeBean` 的 `@Attribute` 逐个对应：:72/:84/:93/:101/:108/:116/:123/:132/:144）。
 */
export interface FileTypeBeanSpec {
  name?: string
  language?: string
  /** 分号分隔的扩展名（`:101`；类注释里的示例 `extensions="py;pyw"`，`:32`）。 */
  extensions?: string
  /** 分号分隔的**精确**文件名，大小写敏感（`:108`）。 */
  fileNames?: string
  /** 分号分隔的通配模式（`:116`）。 */
  patterns?: string
  /** 分号分隔的精确文件名，忽略大小写（`:123`）。 */
  fileNamesCaseInsensitive?: string
  /** 分号分隔的 shebang 解释器（`:144`；**不是**文件名匹配器，交给内容探测）。 */
  hashBangs?: string
  /** 上游用类加载拿实例（`:72`/`:84`）；本仓没有类加载，登记但不消费。 */
  implementationClass?: string
  fieldName?: string
}

export interface ParsedFileTypeBean {
  descriptor: FileTypeDescriptor
  /** `hashBangs` 原样带出：它匹配的是**首行**而不是文件名（上游 `FileTypeBean` 的 javadoc :46-48 说
   *  关联属性只按文件名匹配，所以 shebang 只能另走内容探测这条路）。 */
  hashBangs: string[]
}

const splitAttribute = (value: string | undefined): string[] =>
  (value ?? '').split(';').map(token => token.trim()).filter(Boolean)

/**
 * 把一条 `<fileType>` 声明翻成描述符 + 匹配器。
 * 缺 `name` 抛错（`:93` 是 `@RequiredElement`；`:51-54` 说平台装载时会报 `PluginException`）。
 */
export function parseFileTypeBean(bean: FileTypeBeanSpec): ParsedFileTypeBean {
  const name = (bean.name ?? '').trim()
  if (!name) throw new Error('fileType 声明缺少必填属性 name（上游 FileTypeBean.name 是 @RequiredElement）。')
  const matchers: FileNameMatcher[] = []
  for (const extension of splitAttribute(bean.extensions)) matchers.push({ kind: 'extension', extension: extension.replace(/^\./, '').toLowerCase() })
  for (const fileName of splitAttribute(bean.fileNames)) matchers.push({ kind: 'exact', fileName })
  for (const pattern of splitAttribute(bean.patterns)) matchers.push(parseFileNameMatcher(pattern))
  for (const fileName of splitAttribute(bean.fileNamesCaseInsensitive)) matchers.push({ kind: 'exact', fileName, ignoreCase: true })
  return { descriptor: { id: name, name, language: bean.language ?? 'other', matchers }, hashBangs: splitAttribute(bean.hashBangs) }
}

export class FileTypeManager {
  private readonly types = new Map<string, FileTypeDescriptor>()
  private readonly extensions = new Map<string, string>()   // 扩展名（小写）→ 类型 id
  private readonly exactNames = new Map<string, string>()
  private readonly exactNamesIgnoreCase = new Map<string, string>()
  private wildcards: { matcher: FileNameMatcher; id: string; regex: RegExp; score: string }[] = []
  /**
   * HashBang（shebang）模式表：模式 → 类型（上游 `FileTypeAssocTable.addHashBangPattern`，
   * 由 `FileTypeManagerImpl.java:644-647` / `:1374-1389` 灌；`standard` 那一档对应
   * `FileTypeConfigurable.java:824-825` 的 `isStandardFileType` —— 平台自带的模式**不让改判**）。
   */
  private readonly hashBangs: { pattern: string; id: string; standard: boolean }[] = []
  private readonly listeners = new Set<FileTypeListener>()
  private ignoredMasks: string[] = []
  private readonly conflicts: FileTypeConflict[] = []
  /** 懒建（见文件头「循环依赖的注意」）。 */
  private removedTracker: RemovedMappingTracker | null = null

  constructor(initial: readonly FileTypeDescriptor[] = []) {
    for (const type of initial) this.register(type)
  }

  addFileTypeListener(listener: FileTypeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 本进程登记过的关联冲突（上游 `ConflictingFileTypeMappingTracker.java:126-130` 里
   * 与 `myRemovedMappingTracker` 并列的那张判定结果）。`approved === false` 的那些
   * 在上游要等 `ApproveRemovedMappingsActivity.kt:19-24`（启动活动 + `runWhenSmart`）整批批准；
   * 本仓的等价时机是设置页装载完关联表后显式调 `approveUnapprovedMappings()`
   * （见 `src/fileTypeRemovedMappings.ts` 的 `approveUnapprovedAfterLoad`）。
   */
  getConflicts(): readonly FileTypeConflict[] {
    return this.conflicts
  }

  /**
   * `FileTypeManagerImpl.getRemovedMappingTracker()`（`:1914-1918`）：
   * 那张「某匹配器已从某类型摘除」的账本，四处判定都用它（文件头列的 :1591/:1597/:1617/:1851）。
   * 懒建是为了避开与本模块底部单例的初始化环（见文件头的循环依赖注释）。
   */
  removedMappings(): RemovedMappingTracker {
    if (!this.removedTracker) this.removedTracker = new RemovedMappingTracker()
    return this.removedTracker
  }

  /** 账本快照（`RemovedMappingTracker.getRemovedMappings()`，`:184-186`）。 */
  getRemovedMappings(): RemovedMapping[] {
    return this.removedMappings().getRemovedMappings()
  }

  /** 这条匹配器当前归谁（没有就 null）。 */
  private ownerOf(matcher: FileNameMatcher): string | null {
    if (matcher.kind === 'extension') return this.extensions.get(matcher.extension.toLowerCase()) ?? null
    if (matcher.kind === 'exact') return matcher.ignoreCase
      ? this.exactNamesIgnoreCase.get(matcher.fileName.toLowerCase()) ?? null
      : this.exactNames.get(matcher.fileName) ?? null
    return this.wildcards.find(entry => entry.matcher.kind === 'wildcard' && entry.matcher.pattern === matcher.pattern)?.id ?? null
  }

  /**
   * 「这条模式现在归谁」（设置页改判前要先问它）—— 上游
   * `FileTypeConfigurable.findExistingFileType`（`:433-443`）：先查临时表，
   * 再回查**已注册**的表，并且 `FileTypes.UNKNOWN` 那一档不算持有方。
   * 本仓的「认不出」位是 `NATIVE`（`nativeFileType()`），同样排除。
   */
  findMatcherOwner(matcher: FileNameMatcher): FileTypeDescriptor | null {
    const id = this.ownerOf(matcher)
    if (!id || id === NATIVE_FILE_TYPE_ID) return null
    return this.types.get(id) ?? null
  }

  /**
   * 这个类型能不能被抢走关联（上游 `FileType.isReadOnly()`：
   * `platform/core-api/src/com/intellij/openapi/fileTypes/FileType.java:69-71` 是个 default false，
   * 语义写在 `:65-68` —— 只读类型「不出现在 File Types 设置页、用户不能改它的关联」，
   * `FileTypeConfigurable.java:393-398` 用它决定「错误框」还是「确认框」（`:399-404` 那一条才是
   * 用户点「重新指派」才摘走关联）。
   * **口径差异（如实记）**：上游整个 `openapi/fileTypes` 包里唯一覆盖它的是
   * `platform/core-api/src/com/intellij/openapi/fileTypes/ex/FakeFileType.java:29`；
   * 上游**没有** `ReadOnlyFileType` 这个类（已核实，两个目录都翻过），二进制那一族
   * （`NativeFileType.java:48-51`、`UserBinaryFileType.java:16-19`）覆盖的是 `isBinary()` 不是它。
   * 本仓把「二进制 / 认不出」当成不可抢的那一档，因为本仓没有「只读类型不进设置页」这条 ——
   * 谁能出现在设置页由注册表自己决定（`bundled`/`core` 那两位）。
   */
  isReadOnlyType(descriptor: FileTypeDescriptor | null): boolean {
    if (!descriptor) return false
    return descriptor.binary || descriptor.id === NATIVE_FILE_TYPE_ID
  }

  private fire(before: boolean, event: FileTypeEvent) {
    for (const listener of [...this.listeners]) {
      try {
        if (before) listener.beforeFileTypesChanged?.(event)
        else listener.fileTypesChanged?.(event)
      } catch { /* 监听器自己的错误不打断注册流程（上游 Topic 广播同口径） */ }
    }
  }

  /** `FileTypeRegistrar.initFileType`：注册类型并认领它的匹配器（已存在则先移除再注册）。 */
  register(type: FileTypeDescriptor): void {
    const previous = this.types.get(type.id) ?? null
    if (previous) this.remove(type.id, false)
    this.types.set(type.id, type)
    // 关联先落表再广播 before/after：冲突判定要看到"自己已经不在表里"的旧归属，
    // 否则同 id 重注册会被自己的旧关联判成冲突。
    const conflicts: FileTypeConflict[] = []
    for (const matcher of type.matchers ?? []) {
      // 注册路径带 fromRegistrar=true：上游 `initializeMatchers` 才是会被摘除记录挡住的那条。
      const conflict = this.associate(type.id, matcher, false, true)
      if (conflict) conflicts.push(conflict)
    }
    const event: FileTypeEvent = { added: type, removed: previous, conflicts }
    this.fire(true, event)
    this.fire(false, event)
  }

  /** 注销类型并清掉它认领的全部关联（上游 `doUnregisterFileType`）。 */
  unregister(id: string): void {
    this.remove(id, true)
  }

  private remove(id: string, notify: boolean): void {
    const type = this.types.get(id)
    if (!type) return
    const event: FileTypeEvent = { added: null, removed: type }
    if (notify) this.fire(true, event)
    this.types.delete(id)
    for (const [key, value] of [...this.extensions]) if (value === id) this.extensions.delete(key)
    for (const [key, value] of [...this.exactNames]) if (value === id) this.exactNames.delete(key)
    for (const [key, value] of [...this.exactNamesIgnoreCase]) if (value === id) this.exactNamesIgnoreCase.delete(key)
    this.wildcards = this.wildcards.filter(entry => entry.id !== id)
    // 类型注销 ⇒ 它名下的 hashbang 一起走（上游 `FileTypeAssocTable` 里 hashbang 也是按 ftd 存的，
    // `FileTypeManagerImpl.java:1522` 那份 `getHashBangPatterns(ftd)` 随 ftd 消失）。
    for (let index = this.hashBangs.length - 1; index >= 0; index--) if (this.hashBangs[index].id === id) this.hashBangs.splice(index, 1)
    if (notify) this.fire(false, event)
  }

  /**
   * `FileTypeManager.associate`：给类型加一条关联（不经变更广播 —— 与上游 associate 的调用点一致）。
   *
   * 同一匹配器已经有主时走 `resolveFileTypeConflict`（上游 `ConflictingFileTypeMappingTracker.resolveConflict`）：
   * 落败的一方**拿不到**这条关联，判定结果记进 `getConflicts()` 并随 `notify` 事件带出去。
   * 返回本次的冲突（没有冲突返回 null），所以调用方能直接拿去做提示。
   *
   * 摘除账本的三处判定（上游 `FileTypeManagerImpl.java:1591-1621` 与 `:1849-1852`，逐条对应）：
   *   1. `:1591-1595` 这条匹配器**已被从本类型摘掉** ⇒ 直接不认领（返回 null，不记冲突）；
   *   2. `:1597-1603` 已被从**旧持有方**摘掉 ⇒ 「不算冲突，新类型赢」，`approved` 为真；
   *   3. `:1615-1619` 判完且已批准 ⇒ 给落败的旧类型记一条 approved 的摘除记录；
   *      旧类型是**用户自定义类型**时（上游 `oldFileType instanceof AbstractFileType`，`:1621-1623`；
   *      本仓的等价标记是 `bundled === false`，即非平台自带那一档）两边都认领 ——
   *      上游注释的意图是「自定义类型抢走关联不需要用户批准，直接给它」。
   *   4. 认领成功后（`:1849-1852`）删掉本类型名下这条摘除记录：认领就是把「摘除」撤销。
   */
  associate(id: string, matcher: FileNameMatcher, notify = false, fromRegistrar = false): FileTypeConflict | null {
    const newType = this.types.get(id)
    if (!newType) return null
    const tracker = this.removedMappings()
    // 1. **声明式注册**那条路（上游 `initializeMatchers`，`:1591-1595`）：本类型名下已有摘除记录
    //    ⇒ 这条匹配器不认领。显式的 `associate`（上游 `:1849-1852`）不带这道闸 —— 它就是
    //    「用户/冲突通知里点了头」的那一步，要把记录撤掉。
    if (fromRegistrar && tracker.wasRemovedFrom(matcher, newType.name)) return null
    const owner = this.ownerOf(matcher)
    const oldType = owner && owner !== id ? this.types.get(owner) ?? null : null
    let conflict: FileTypeConflict | null = null
    // 上游 `FileTypeManagerImpl.java:1600-1603`：旧类型名下有「已摘除」记录时
    // `warnAndResolveConflict` **压根不被调用**（`result` 直接=newFtd、approved=true、文案为空），
    // 于是 `:1610` 那个「未批准才上报」的消费者收不到东西 —— 本仓同样**不进冲突表**。
    const releasedByUser = oldType !== null && tracker.wasRemovedFrom(matcher, oldType.name)
    if (oldType && !releasedByUser) conflict = resolveFileTypeConflict(matcher, oldType, newType)
    if (conflict && conflict.resolved !== id) {
      // 落败者不认领：上游 resolveConflict 返回的 `resolved` 才是真正持有方。
      // 例外是上面第 3 条：旧类型是用户自定义类型且已批准时，两边都要认领。
      const oldIsUserType = Boolean(oldType) && oldType?.bundled === false
      if (!(oldIsUserType && conflict.approved)) {
        this.conflicts.push(conflict)
        if (notify) { this.fire(true, { added: null, removed: null, conflicts: [conflict] }); this.fire(false, { added: null, removed: null, conflicts: [conflict] }) }
        return conflict
      }
    }
    if (notify) this.fire(true, { added: null, removed: null })
    if (matcher.kind === 'extension') this.extensions.set(matcher.extension.toLowerCase(), id)
    else if (matcher.kind === 'exact') {
      if (matcher.ignoreCase) this.exactNamesIgnoreCase.set(matcher.fileName.toLowerCase(), id)
      else this.exactNames.set(matcher.fileName, id)
    } else {
      this.wildcards = this.wildcards.filter(entry => entry.matcher.kind !== 'wildcard' || entry.matcher.pattern !== matcher.pattern)
      this.wildcards.push({ matcher, id, regex: maskToRegExp(matcher.pattern), score: specificityScore(matcher) })
      this.wildcards.sort((a, b) => a.score < b.score ? 1 : a.score > b.score ? -1 : 0)
    }
    // 3. 关联换了主人且这次判定**已获批准** ⇒ 给旧持有方记账（`RemovedMappingTracker.add`，`:98-114`）。
    if (conflict?.approved && oldType && conflict.resolved === id) tracker.add(matcher, oldType.name, true)
    // 4. 本类型名下的「已摘除」记录随这次认领作废（`:1851-1852` 的 removeIf）。
    tracker.removeIf(mapping => mapping.typeName === newType.name
      && presentableMatcher(mapping.matcher) === presentableMatcher(matcher))
    if (conflict) this.conflicts.push(conflict)
    if (notify) this.fire(false, { added: null, removed: null, conflicts: conflict ? [conflict] : [] })
    return conflict
  }

  /**
   * `FileTypeManager.removeAssociation`（按 matcher 摘掉一条；同 matcher 被后者占用时不误删）。
   *
   * 第三参 `approved` = 上游那两条记账路径：
   *   · 用户在冲突通知上点了「拿走」（`ConflictingFileTypeMappingTracker.java:161` 的 `add(…, true)`）
   *     或在设置页亲手删了一条关联 ⇒ `true`；
   *   · 装载外部设置时才「重检测到」的摘除（`FileTypeManagerImpl.java:1353`）⇒ `false`，
   *     等 `ApproveRemovedMappingsActivity` 那一轮批准。
   * 不传 = 不记账（与上游 `removeAssociation` 本身一致 —— 它只管摘表，记账是调用方的事）。
   */
  removeAssociation(id: string, matcher: FileNameMatcher, approved?: boolean): void {
    const type = this.types.get(id)
    if (type && approved !== undefined) this.removedMappings().add(matcher, type.name, approved)
    if (matcher.kind === 'extension') {
      if (this.extensions.get(matcher.extension.toLowerCase()) === id) this.extensions.delete(matcher.extension.toLowerCase())
    } else if (matcher.kind === 'exact') {
      const map = matcher.ignoreCase ? this.exactNamesIgnoreCase : this.exactNames
      const key = matcher.ignoreCase ? matcher.fileName.toLowerCase() : matcher.fileName
      if (map.get(key) === id) map.delete(key)
    } else {
      this.wildcards = this.wildcards.filter(entry => !(entry.id === id && entry.matcher.kind === 'wildcard' && entry.matcher.pattern === matcher.pattern))
    }
  }

  /**
   * `FileTypeConsumer.consume(type, semicolonDelimited)`：分号分隔的**扩展名**一条条认领
   * （上游 `FileTypeManagerImpl.parseExtensions` 对每个词条建 `ExtensionFileNameMatcher`）。
   * 上游对空词条抛 `InvalidDataException`；这里跳过（宿主设置里的手写清单不该让应用起不来）。
   */
  consume(type: FileTypeDescriptor, semicolonDelimited: string): void {
    if (!this.types.has(type.id)) this.register({ ...type, matchers: [] })
    for (const token of semicolonDelimited.split(';')) {
      const extension = token.trim()
      if (!extension) continue
      this.associate(type.id, { kind: 'extension', extension: extension.toLowerCase() }, false, true)
    }
  }

  /** `FileTypeFactory.createFileTypes` 的宿主侧：注册工厂并把它的认领一次性落表。 */
  registerFactory(factory: (consumer: { consume: (type: FileTypeDescriptor, patterns: string) => void }) => void): void {
    factory({ consume: (type, patterns) => this.consume(type, patterns) })
  }

  getRegisteredTypes(): FileTypeDescriptor[] {
    return [...this.types.values()]
  }

  getType(id: string): FileTypeDescriptor | null {
    return this.types.get(id) ?? null
  }

  /** 按文件名认类型（精确 → 通配 → 扩展名；认不出回 null，调用方按 Unknown 处理）。 */
  getFileTypeByFileName(fileName: string): FileTypeDescriptor | null {
    const exact = this.exactNames.get(fileName)
    if (exact) return this.types.get(exact) ?? null
    const ignoreCase = this.exactNamesIgnoreCase.get(fileName.toLowerCase())
    if (ignoreCase) return this.types.get(ignoreCase) ?? null
    for (const entry of this.wildcards) if (entry.regex.test(fileName)) return this.types.get(entry.id) ?? null
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
    return extension ? this.getFileTypeByExtension(extension) : null
  }

  /** 按扩展名认类型（大小写不敏感；上游查不到回 UnknownFileType，本仓回 null）。 */
  getFileTypeByExtension(extension: string): FileTypeDescriptor | null {
    const id = this.extensions.get(extension.toLowerCase())
    return id ? this.types.get(id) ?? null : null
  }

  /** 某类型认领的全部匹配器（`FileTypeManager.getAssociations`）。 */
  getAssociations(id: string): FileNameMatcher[] {
    if (!this.types.has(id)) return []
    const result: FileNameMatcher[] = []
    for (const [extension, value] of this.extensions) if (value === id) result.push({ kind: 'extension', extension })
    for (const [fileName, value] of this.exactNames) if (value === id) result.push({ kind: 'exact', fileName })
    for (const [fileName, value] of this.exactNamesIgnoreCase) if (value === id) result.push({ kind: 'exact', fileName, ignoreCase: true })
    for (const entry of this.wildcards) if (entry.id === id && entry.matcher.kind === 'wildcard') result.push(entry.matcher)
    return result
  }

  // ── HashBang patterns（设置页那个「HashBang patterns:」小表，`FileTypeConfigurable.java:695-807`）──

  /**
   * 某类型当前持有的 shebang 模式（`FileTypeAssocTable.getHashBangPatterns(ftd)`，
   * `FileTypeManagerImpl.java:1522`；面板按 `ContainerUtil.sorted` 显示，`FileTypeConfigurable.java:745`）。
   */
  getHashBangPatterns(id: string): string[] {
    return this.hashBangs.filter(entry => entry.id === id).map(entry => entry.pattern).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }

  /**
   * 这段文本的第 2 行以内是否含某个模式 —— `FileUtil.isHashBangLine`
   * （`platform/util/src/com/intellij/openapi/util/io/FileUtil.java:1300-1310`）逐条照抄：
   * 必须 `#!` 开头，且**首行内**（`\n` 之前，从下标 2 起）出现该模式；首行没有换行符时上游判 false。
   */
  static matchesHashBang(firstChars: string, marker: string): boolean {
    if (!firstChars.startsWith('#!') || !marker) return false
    const lineBreak = firstChars.indexOf('\n', 2)
    return lineBreak >= 0 && firstChars.indexOf(marker, 2) !== -1 && firstChars.indexOf(marker, 2) < lineBreak
  }

  /**
   * 按内容首段找类型（`HashBangFileTypeDetector.detect`，
   * `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/HashBangFileTypeDetector.kt:14-16`；
   * 它只看 256 个字符，`:19-25` 的 `getDesiredContentPrefixLength` —— 本仓同样只截 256）。
   */
  findFileTypeByHashBang(firstChars: string): FileTypeDescriptor | null {
    const head = firstChars.slice(0, 256)
    for (const entry of this.hashBangs) {
      if (FileTypeManager.matchesHashBang(head, entry.pattern)) return this.types.get(entry.id) ?? null
    }
    return null
  }

  /**
   * 一次 hashbang 改判会撞到谁（上游 `FileTypeConfigurable.checkHashBangConflict`，
   * `platform/lang-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeConfigurable.java:827-850`）：
   * 遍历整张表，**子串重叠**（新串含旧串、或旧串含新串）即冲突，只返回第一个命中的（`:830`）；
   * `exact` = 两边完全相同（`:832`），`writable` = `!fileType().isReadOnly() && !isStandardFileType(...)`
   * （`:833`，`isStandardFileType` 在 `:822-824`）。上游还有第二个循环（`:837-848`）：内置的
   * `HashBangFileTypeDetector` 标记一律 `writeable = false`（`:843`）—— 本仓把那一档并进
   * `entry.standard`，同一条纪律。
   * 注：上游 `FileType.isReadOnly()` 是 `FileType.java:69-71` 那条 default false，
   * `openapi/fileTypes` 包里唯一的覆盖是 `ex/FakeFileType.java:29`；本仓的 `binary`/`NATIVE`
   * 那一档是**本仓自己的**不可抢口径（上游没有 `ReadOnlyFileType` 这个类，别再照它写）。
   */
  checkHashBangConflict(pattern: string): HashBangConflict | null {
    const value = pattern.trim()
    if (!value) return null
    for (const entry of this.hashBangs) {
      if (!value.includes(entry.pattern) && !entry.pattern.includes(value)) continue
      const holder = this.types.get(entry.id)
      const readOnly = entry.standard || !holder || holder.binary || holder.id === NATIVE_FILE_TYPE_ID
      return {
        pattern: entry.pattern,
        typeId: entry.id,
        typeName: holder?.name ?? entry.id,
        exact: entry.pattern === value,
        writable: !readOnly,
      }
    }
    return null
  }

  /**
   * 认领一条 hashbang（`FileTypeAssocTable.addHashBangPattern`，经 `FileTypeConfigurable.java:796-803` 那条路）：
   * 有冲突且调用方没点头 ⇒ **不改判**，只把冲突返回（上游 `:779-785` 走错误框、`:786-795` 走确认框，
   * 点 Cancel 就 return）。点头时先把撞上的那条从它名下摘掉，再认领 —— 与上游
   * `removeHashBangPattern(hashbang, existingFtd)` + `removeHashBangPattern(conflict.existingHashBang, …)` 同一对动作。
   */
  addHashBangPattern(id: string, pattern: string, reassign = false, standard = false): HashBangConflict | null {
    const value = pattern.trim()
    if (!value || !this.types.has(id)) return null
    const conflict = this.checkHashBangConflict(value)
    if (conflict && !conflict.writable) return conflict
    if (conflict && !reassign) return conflict
    if (conflict) {
      this.removeHashBangPattern(conflict.typeId, conflict.pattern)
      if (conflict.pattern !== value) this.removeHashBangPattern(id, conflict.pattern)
    }
    if (this.hashBangs.some(entry => entry.pattern === value && entry.id === id)) return conflict
    this.fire(true, { added: null, removed: null })
    this.hashBangs.push({ pattern: value, id, standard })
    this.fire(false, { added: null, removed: null })
    return conflict
  }

  /** `removeHashBangPattern(pattern, ftd)`（`FileTypeConfigurable.java:457-467` 的那一步）。 */
  removeHashBangPattern(id: string, pattern: string): boolean {
    const index = this.hashBangs.findIndex(entry => entry.id === id && entry.pattern === pattern)
    if (index < 0) return false
    this.fire(true, { added: null, removed: null })
    this.hashBangs.splice(index, 1)
    this.fire(false, { added: null, removed: null })
    return true
  }

  /** 某条模式是否平台自带（页面据此决定「删除」按钮点不点得动）。 */
  isStandardHashBang(pattern: string): boolean {
    return this.hashBangs.some(entry => entry.pattern === pattern && entry.standard)
  }

  /**
   * 装载期灌入 hashbang（`FileTypeManagerImpl.java:644-647`：`<fileType hashBangs="bash;sh;zsh">`
   * 的每个词条**直接** `addHashBangPattern`，不走设置页那套改判确认 —— 所以 `bash` 与 `sh`
   * 互为子串也不会互相顶掉）。重复灌同一条不追加。
   */
  seedHashBang(id: string, patterns: readonly string[]): void {
    if (!this.types.has(id)) return
    for (const raw of patterns) {
      const pattern = raw.trim()
      if (!pattern) continue
      if (this.hashBangs.some(entry => entry.pattern === pattern && entry.id === id)) continue
      this.hashBangs.push({ pattern, id, standard: true })
    }
  }

  /** 整张 hashbang 表（按注册顺序；设置页的「已被占用」排查用）。 */
  allHashBangPatterns(): { pattern: string; id: string; standard: boolean }[] {
    return this.hashBangs.map(entry => ({ ...entry }))
  }

  /** 分号分隔的忽略掩码（`getIgnoredFilesList`）。 */
  getIgnoredFilesList(): string {
    return this.ignoredMasks.join(';')
  }

  /** `setIgnoredFilesList`：整表替换，去重保序（`IgnoredPatternSet.setIgnoreMasks`）。 */
  setIgnoredFilesList(list: string): void {
    const seen = new Set<string>()
    this.ignoredMasks = []
    for (const token of list.split(';')) {
      const mask = token.trim()
      if (!mask || seen.has(mask)) continue
      seen.add(mask)
      this.ignoredMasks.push(mask)
    }
  }

  /** `isFileIgnored(name)`：掩码表按同一套匹配规则判（精确名 / 通配 / 扩展名）。 */
  isFileIgnored(fileName: string): boolean {
    for (const mask of this.ignoredMasks) {
      const matcher = parseFileNameMatcher(mask)
      if (matcher.kind === 'extension' && fileName.toLowerCase().endsWith(`.${matcher.extension}`)) return true
      if (matcher.kind === 'exact' && fileName === matcher.fileName) return true
      if (matcher.kind === 'wildcard' && maskToRegExp(matcher.pattern).test(fileName)) return true
    }
    return false
  }

  /**
   * 按一条 `<fileType>` 声明注册（上游 `FileTypeBean` 的两种用法，`FileTypeBean.java:26-43`）：
   *   · 带 `implementationClass` = 声明一个新类型；
   *   · 只有 `name` + 关联属性 = 给**别的**类型加关联（`:36-41`：被引用的类型必须已由别的标签注册，
   *     标签顺序无所谓）。本仓没有类加载，所以两种用法合流成同一条路 ——
   *     目标类型不在表里就当新类型建（`userFileType` 那一档），在表里就只加关联。
   * 返回本次的冲突（上游 `ConflictingFileTypeMappingTracker` 那条链的结果）。
   */
  registerBean(bean: FileTypeBeanSpec, options: { language?: string; bundled?: boolean; core?: boolean; vendor?: string } = {}): FileTypeConflict[] {
    const parsed = parseFileTypeBean(bean)
    const existing = this.types.get(parsed.descriptor.id)
    const descriptor: FileTypeDescriptor = existing
      ? { ...existing, matchers: [...(existing.matchers ?? []), ...(parsed.descriptor.matchers ?? [])] }
      : {
        ...parsed.descriptor,
        // `FileTypeBean.java:29-30` vs `:36-41`：带 `implementationClass` 才是「声明一个新类型」
        // （上游由某个插件的 EP 贡献，落 bundled/core 那一侧）；只给 name + 关联是「给别的类型加关联」，
        // 上游要求目标已由别的标签注册。本仓没有类加载，目标不在表里时只能合成一个 ——
        // 那不是任何插件声明的类型，所以落**非 bundled**（与 `userFileType` 同一档），
        // 否则它在 `resolveFileTypeConflict` 里会白占 `:78-83` 的 bundled 侧、白拿 `:93-98` 的胜位。
        bundled: options.bundled ?? bean.implementationClass !== undefined,
        core: options.core,
        vendor: options.vendor,
        template: parsed.hashBangs.length > 0 || undefined,
      }
    const before = this.conflicts.length
    this.register(descriptor)
    return this.conflicts.slice(before)
  }
}

// ── 上游那五个具名类型在本仓的等价工厂（`ic/file-types` 缺的「各自的类与工厂」）────────
//
// 上游它们是五个独立的类；本仓的注册表只吃 `FileTypeDescriptor`，所以每个类落成一个
// 工厂函数，把该类的**特有那几个属性**（名字、默认扩展名、isBinary、是否模板语言）
// 固定下来 —— 这正是它们在 `FileType` 接口之外唯一多出来的东西。

/**
 * `UserFileType<T>`（`platform/ide-core/src/com/intellij/openapi/fileTypes/UserFileType.java:13`）：
 * 用户可配置的类型，名字/描述由设置页给（`:37`/`:42`/`:46-52`），默认扩展名**从它认领的
 * 扩展名关联里取**（`:55-58`），所以这里 `matchers` 是它的核心参数。
 */
export function userFileType(id: string, name: string, language: string, matchers: readonly FileNameMatcher[] = []): FileTypeDescriptor {
  return { id, name, language, matchers, bundled: false }
}

/**
 * `UserBinaryFileType`（`UserBinaryFileType.java:6-7` 继承 `UserFileType`，`:17-19` `isBinary()` 恒为 true）。
 */
export function userBinaryFileType(id: string, name: string, matchers: readonly FileNameMatcher[] = []): FileTypeDescriptor {
  return { ...userFileType(id, name, 'other', matchers), binary: true }
}

/**
 * `NativeFileType`（`NativeFileType.java:18-19` 终类 + 单例 `INSTANCE`）：`getName()` 恒为
 * `Native`（`:24-26`）、**没有默认扩展名**（`:39-41`）、`isBinary()` 恒为 true（`:48-51`）——
 * 它是"本机文件、认不出扩展名"那一档。它在表里**不认领任何匹配器**（`getFileTypeByFileName`
 * 永远回不到它），但 `resolveFileTypeConflict` 的 `:99-103` 那条规则要拿它当判据，
 * 所以必须真的在注册表里。
 */
export function nativeFileType(): FileTypeDescriptor {
  return { id: NATIVE_FILE_TYPE_ID, name: 'Native', language: 'other', matchers: [], binary: true, bundled: true, core: true }
}

/**
 * `TemplateLanguageFileType`（`TemplateLanguageFileType.java:4`）上游只是个**标记接口**，
 * 没有类型本体、也没有方法 —— 所以本仓的等价物是在描述符上多一个 `template` 标记，
 * 用来区分"这个类型的内容是从文件模板生成的"。判据表在 `src/templates.ts`。
 */
export function templateLanguageFileType(id: string, name: string, language: string, matchers: readonly FileNameMatcher[] = []): FileTypeDescriptor {
  return { id, name, language, matchers, template: true, bundled: true, core: true }
}

/**
 * `MockLanguageFileType`（`MockLanguageFileType.java:9-10` 终类 + `INSTANCE`）：
 * `getName()` = `Mock`（`:17-19`）、`getDescription()` 也是 `Mock`（`:22-25`）、
 * 默认扩展名 `.mockExtensionThatProbablyWon'tEverExist`（`:28-30`）、无图标（`:32-35`）。
 * 本仓没有图标字段，所以那部分落不下来；名字/扩展名照抄。
 */
export function mockFileType(): FileTypeDescriptor {
  return {
    id: 'Mock', name: 'Mock', language: 'other',
    matchers: [{ kind: 'extension', extension: "mockExtensionThatProbablyWon'tEverExist" }],
    bundled: true, core: true,
  }
}

/**
 * 本仓的标准类型表（上游 `StdFileTypes`/`FileTypes` 常量的等价物）。
 * 语言 id 对齐 `src/languages.ts` 的 `EDITOR_LANGUAGES`；探测到的 JSON/HTML 这些本仓没有
 * 专属词法层，语言落 `other`（类型名照实给出）。
 *
 * 全部标 `bundled + core`（`vendor: 'JetBrains'`）：它们是**平台自带**的类型，
 * 冲突审批时该占上游 `:78-83` 那一侧 —— 见 `resolveFileTypeConflict`。
 */
export const STANDARD_FILE_TYPES: readonly FileTypeDescriptor[] = [
  { id: 'JAVA', name: 'Java', language: 'java', matchers: [{ kind: 'extension', extension: 'java' }], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'C_CPP', name: 'C/C++', language: 'cpp', matchers: [
    { kind: 'extension', extension: 'c' }, { kind: 'extension', extension: 'h' },
    { kind: 'extension', extension: 'cpp' }, { kind: 'extension', extension: 'hpp' },
    { kind: 'extension', extension: 'cc' }, { kind: 'extension', extension: 'cxx' } ], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'TypeScript', name: 'TypeScript', language: 'typescript', matchers: [
    { kind: 'extension', extension: 'ts' }, { kind: 'extension', extension: 'tsx' }, { kind: 'extension', extension: 'mts' } ], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'Kotlin', name: 'Kotlin', language: 'other', matchers: [{ kind: 'extension', extension: 'kt' }, { kind: 'extension', extension: 'kts' }], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'Python', name: 'Python', language: 'other', matchers: [{ kind: 'extension', extension: 'py' }], bundled: true, core: true, vendor: 'JetBrains' },
  // 上游 Shell Script 类型自带的那三条扩展名（`plugins/sh/core/resources/intellij.sh.core.xml:41`
  // 的 `extensions="bash;sh;zsh"`）；本仓没有 shell 词法层，语言落 `other`，但**类型名与扩展名照抄**。
  { id: 'Shell Script', name: 'Shell Script', language: 'other', matchers: [
    { kind: 'extension', extension: 'bash' }, { kind: 'extension', extension: 'sh' }, { kind: 'extension', extension: 'zsh' } ],
    bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'JavaScript', name: 'JavaScript', language: 'other', matchers: [
    { kind: 'extension', extension: 'js' }, { kind: 'extension', extension: 'mjs' }, { kind: 'extension', extension: 'cjs' } ], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'JSON', name: 'JSON', language: 'other', matchers: [{ kind: 'extension', extension: 'json' }], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'XML', name: 'XML', language: 'other', matchers: [{ kind: 'extension', extension: 'xml' }], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'HTML', name: 'HTML', language: 'other', matchers: [{ kind: 'extension', extension: 'html' }, { kind: 'extension', extension: 'htm' }], bundled: true, core: true, vendor: 'JetBrains' },
  { id: 'Markdown', name: 'Markdown', language: 'other', matchers: [{ kind: 'extension', extension: 'md' }], bundled: true, core: true, vendor: 'JetBrains' },
  // 上游 `PlainTextFileType extends LanguageFileType`（`platform/core-impl/src/com/intellij/openapi/fileTypes/PlainTextFileType.java:11`），
  // **不是** `UserFileType` —— 所以这里保持普通语言类型，不套用户类型工厂。
  { id: 'PLAIN_TEXT', name: 'Plain text', language: 'other', matchers: [{ kind: 'extension', extension: 'txt' }], bundled: true, core: true, vendor: 'JetBrains' },
  // 本机文件那一档：见 `nativeFileType()`。
  nativeFileType(),
]


/** 进程内单例（上游 `FileTypeManager.getInstance()`）。 */
export const fileTypeManager = new FileTypeManager(STANDARD_FILE_TYPES)

// 平台自带的 hashbang 模式（装载期灌入，见 `seedHashBang` 的注释）。三条都有出处：
//   · `java` ← `java/java-frontback-psi-impl/resources/intellij.java.frontback.psi.impl.xml:21`
//     的 `hashBangs="java"`；
//   · `python` ← `python/python-parser/resources/intellij.python.parser.xml:16` 的 `hashBangs="python"`；
//   · `bash;sh;zsh` ← `plugins/sh/core/resources/intellij.sh.core.xml:41` 的 `hashBangs="bash;sh;zsh"`。
// `plugins/groovy/resources/META-INF/plugin.xml:412` 的 `hashBangs="groovy"` 没有灌 ——
// 本仓没有 Groovy 类型，灌了就是一个指向不存在类型的模式。
fileTypeManager.seedHashBang('JAVA', ['java'])
fileTypeManager.seedHashBang('Python', ['python'])
fileTypeManager.seedHashBang('Shell Script', ['bash', 'sh', 'zsh'])

/** `FileTypes.UNKNOWN.getDescription()` 的等价文案（认不出类型时的展示名）。 */
export const UNKNOWN_FILE_TYPE_NAME = '未知文件类型'

/** 编辑器/状态栏展示用的类型名（认不出时按上游回 Unknown）。 */
export function fileTypeName(fileName: string): string {
  return fileTypeManager.getFileTypeByFileName(fileName)?.name ?? UNKNOWN_FILE_TYPE_NAME
}
