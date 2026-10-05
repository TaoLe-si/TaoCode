// 「这条关联是从哪个类型**摘掉**的」账本 —— 上游
// `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/RemovedMappingTracker.java` 的等价物
//（`ic/file-types` / `pf/file-types` 两族判词里点名的「冲突审批（ApproveRemovedMappingsActivity）」那一半）。
//
// 为什么需要这张表（上游注释原话，`ConflictingFileTypeMappingTracker.java:34-42`）：
// 用户在设置页把 `*.foo` 从类型 A 摘掉、给类型 B，下一次 A 重新注册（换插件、改设置、
// 从别的方案导入）时又会来抢这条匹配器。上游靠这张表记住「A 名下的 foo 是被**显式摘掉**的」：
//   · `FileTypeManagerImpl.java:1591-1595` —— 新类型自己名下有摘除记录 ⇒ **这条匹配器直接不认领**；
//   · `FileTypeManagerImpl.java:1597-1603` —— 旧类型名下有摘除记录 ⇒ 「不算冲突，新类型赢」，
//     因为用户已经明确说过「把它从旧类型拿走」；
//   · `FileTypeManagerImpl.java:1615-1619` —— 冲突判完且**已获批准**时，给落败的旧类型记一条 approved；
//   · `FileTypeManagerImpl.java:1849-1852` —— 真正 associate 成功时删掉这条「已从该类型摘掉」的记录；
//   · `ApproveRemovedMappingsActivity.kt:19-24` —— 项目进入 smart 模式后把**未经用户点头**的那些
//     整批置为 approved（上游注释：这是启动活动，不在测试模式跑）。
//
// 上游那三条文案/字段名逐条照抄（`AbstractFileType.java:297-299` 的 `ext` / `pattern` / `type`
// 与 `RemovedMappingTracker.java:87-90` 的 `removed_mapping` / `approved`）；
// **存储形态**本仓不同：上游是 JDOM `Element` 属性，本仓是 localStorage 里的一份 JSON，
// 但**字段名与判定顺序一致**（架构不等价时按本仓架构还原功能，见 playbook §2）。
//
// 消费链路（都是本桶名下的文件）：
//   · `src/fileTypeRegistry.ts` 的 `associate` / `removeAssociation` —— 上面 :1591-1619 那四处判定；
//   · `src/components/FileTypesPage.vue` —— 摘除/恢复关联时写这张表，并把「待确认」的行显式列出来。
//
// **依赖方向**：本模块只**类型**依赖 `fileTypeRegistry.ts`（`import type` 会被擦除），
// 不能运行时 import 它 —— 注册表反过来要在运行时 new 这个类，两边都在运行时互相 import 时，
// 只要有一侧先被加载就会在模块初始化期撞上「Cannot access 'X' before initialization」。
// 所以这里自带一份 presentable 文本（与 `FileTypeManager.presentableMatcher` 同一口径）。

import type { FileNameMatcher } from './fileTypeRegistry.ts'

/** `FileNameMatcher.getPresentableString()`（`fileTypeRegistry.ts:122-124` 的同一份规则）。 */
function presentable(matcher: FileNameMatcher): string {
  return matcher.kind === 'extension' ? `*.${matcher.extension}` : matcher.kind === 'exact' ? matcher.fileName : matcher.pattern
}

/** 一条摘除记录（`RemovedMappingTracker.RemovedMapping`，`:34-83`）。 */
export interface RemovedMapping {
  matcher: FileNameMatcher
  /** 被摘掉这条关联的**类型名**（上游 `myFileTypeName`，`:36`）。 */
  typeName: string
  /** 用户是否点过头（`myApproved`，`:37`）。 */
  approved: boolean
}

/** 相等判定**不看 approved**（上游 `:65-75` 的注释「must not look at myApproved」）。 */
export function sameRemovedMapping(left: RemovedMapping, right: RemovedMapping): boolean {
  return presentable(left.matcher) === presentable(right.matcher) && left.typeName === right.typeName
}

/** `RemovedMapping.toString()`（`:61-63`）：`Removed mapping '<matcher>' -> <type>`。 */
export function removedMappingText(mapping: RemovedMapping): string {
  return `Removed mapping '${presentable(mapping.matcher)}' -> ${mapping.typeName}`
}

/** 同一匹配器 + 同一类型的哈希语义键（上游 `:77-82` 用 matcher 与类型名两个 hashCode）。 */
function mappingKey(matcher: FileNameMatcher, typeName: string): string {
  return `${presentable(matcher)}\u0000${typeName}`
}

function matcherKey(matcher: FileNameMatcher): string {
  return presentable(matcher)
}

export class RemovedMappingTracker {
  /** 按 (matcher, typeName) 存；同一 matcher 可以有多个类型各一条（上游 `MultiMap`，`:85`）。 */
  private readonly mappings = new Map<string, RemovedMapping>()

  /** `add`（`:98-114`）：同 (matcher, typeName) 的旧记录**整条替换**（approved 也跟着换），不是并存。 */
  add(matcher: FileNameMatcher, fileTypeName: string, approved: boolean): RemovedMapping {
    const mapping: RemovedMapping = { matcher, typeName: fileTypeName, approved }
    this.mappings.set(mappingKey(matcher, fileTypeName), mapping)
    return mapping
  }

  /** `hasRemovedMapping`（`:174-176`）：这条匹配器在**任何**类型名下有摘除记录吗。 */
  hasRemovedMapping(matcher: FileNameMatcher): boolean {
    const key = matcherKey(matcher)
    for (const mapping of this.mappings.values()) if (matcherKey(mapping.matcher) === key) return true
    return false
  }

  /** `isApproved`（`:178-181`）：该 (matcher, 类型) 那条记录是否已被用户点头。 */
  isApproved(matcher: FileNameMatcher, fileTypeName: string): boolean {
    return this.mappings.get(mappingKey(matcher, fileTypeName))?.approved === true
  }

  /** `getRemovedMappings`（`:184-186`）：一份快照（上游返回 `new ArrayList<>(values())`）。 */
  getRemovedMappings(): RemovedMapping[] {
    return [...this.mappings.values()]
  }

  /** `getMappingsForFileType`（`:189-194`）：某类型名下被摘掉的匹配器列表（`associate` 的两处判据用它）。 */
  getMappingsForFileType(fileTypeName: string): FileNameMatcher[] {
    return [...this.mappings.values()].filter(mapping => mapping.typeName === fileTypeName).map(mapping => mapping.matcher)
  }

  /** 这条匹配器是否已被显式从该类型摘掉（`getMappingsForFileType(...).contains(matcher)` 的直接写法）。 */
  wasRemovedFrom(matcher: FileNameMatcher, fileTypeName: string): boolean {
    return this.mappings.has(mappingKey(matcher, fileTypeName))
  }

  /** `removeIf`（`:197-215`）：按判据整批删除，**返回被删掉的那些**（上游同样返回清单，供回滚/日志）。 */
  removeIf(predicate: (mapping: RemovedMapping) => boolean): RemovedMapping[] {
    const removed: RemovedMapping[] = []
    for (const [key, mapping] of [...this.mappings]) {
      if (!predicate(mapping)) continue
      this.mappings.delete(key)
      removed.push(mapping)
    }
    return removed
  }

  /** 删掉单条（`myRemovedMappings.remove(matcher, mapping)`，`:220`）。 */
  remove(matcher: FileNameMatcher, fileTypeName: string): boolean {
    return this.mappings.delete(mappingKey(matcher, fileTypeName))
  }

  /**
   * `approveUnapprovedMappings`（`:217-224`）：把**未经用户点头**的记录整批置为 approved。
   * 上游是「先 remove 再 putValue 一条新的」—— 因为 `RemovedMapping` 不可变且 equals 不看 approved，
   * 这里等价地换成一条新记录。返回被置上的那些（本仓的设置页要按它给一句提示；上游是 void）。
   */
  approveUnapprovedMappings(): RemovedMapping[] {
    const approved: RemovedMapping[] = []
    for (const mapping of [...this.mappings.values()]) {
      if (mapping.approved) continue
      this.mappings.set(mappingKey(mapping.matcher, mapping.typeName), { ...mapping, approved: true })
      approved.push(mapping)
    }
    return approved
  }

  /** 还没被点头的那些（设置页的「待确认」列表；上游没有这个 getter，是 `:218-219` 那个筛选条件）。 */
  unapprovedMappings(): RemovedMapping[] {
    return this.getRemovedMappings().filter(mapping => !mapping.approved)
  }

  /** `clear`（`:92-95`），仅测试与「恢复默认关联表」用。 */
  clear(): void { this.mappings.clear() }

  /**
   * `save`（`:151-160`）：按 presentable matcher、再按类型名排序（`:153` 的比较器）后逐条写。
   * 上游写的是 `<removed_mapping ext|pattern type="…" approved="true"/>`；
   * 本仓写同名字段的 JSON（缺 approved = false，与上游 `:234-236`「只在 true 时才写属性」一致）。
   */
  serialize(): RemovedMappingRecord[] {
    return [...this.mappings.values()]
      // 上游是 `Comparator.comparing(...getPresentableString()).thenComparing(RemovedMapping::getFileTypeName)`
      // （`:153`）—— 那是 `String.compareTo` 的**码元序**，不是 locale 序：`*`(U+002A) 排在字母前面。
      .sort((left, right) => compareText(presentable(left.matcher), presentable(right.matcher))
        || compareText(left.typeName, right.typeName))
      .map(mapping => toRecord(mapping))
  }

  /**
   * `load`（`:116-127`）：同一 (matcher, 类型) 出现第二次时**后写的覆盖先写的**并告警
   * （上游 `LOG.warn(new InvalidDataException("Duplicate <removed_mapping> tag …"))`，`:120-122`）；
   * 没有 `type` 的条目整条跳过（`:143` 的 `if (fileTypeName == null) continue`）。
   * `onDuplicate` 是本仓的告警出口（没有 Logger）。
   */
  static load(records: readonly unknown[], onDuplicate?: (text: string) => void): RemovedMappingTracker {
    const tracker = new RemovedMappingTracker()
    const seen = new Set<string>()
    for (const record of Array.isArray(records) ? records : []) {
      const mapping = fromRecord(record)
      if (!mapping) continue
      const key = mappingKey(mapping.matcher, mapping.typeName)
      if (seen.has(key) && onDuplicate) onDuplicate(`重复的 removed_mapping 记录：${removedMappingText(mapping)}`)
      seen.add(key)
      tracker.mappings.set(key, mapping)
    }
    return tracker
  }
}

/** 存储里的一条记录（字段名照上游的三个属性，`:89-90` + `AbstractFileType.java:297-299`）。 */
export interface RemovedMappingRecord {
  ext?: string
  pattern?: string
  type: string
  approved?: true
}

/** `writeRemovedMapping`（`:226-242`）→ 记录：扩展名写 `ext`，其余写 `pattern`（`:332-345`）。 */
export function toRecord(mapping: RemovedMapping): RemovedMappingRecord {
  const base: RemovedMappingRecord = { type: mapping.typeName }
  if (mapping.matcher.kind === 'extension') return { ext: mapping.matcher.extension, ...base, ...(mapping.approved ? { approved: true as const } : {}) }
  return { pattern: presentable(mapping.matcher), ...base, ...(mapping.approved ? { approved: true as const } : {}) }
}

/**
 * `readRemovedMappings`（`:129-149`）：`ext` 优先（`:137-140` 与 `AbstractFileType.java:312` 同一顺序），
 * 否则按 `pattern` 解析；缺 `type` 返回 null（调用方跳过）。
 */
export function fromRecord(record: unknown): RemovedMapping | null {
  if (!record || typeof record !== 'object') return null
  const raw = record as { ext?: unknown; pattern?: unknown; type?: unknown; approved?: unknown }
  if (typeof raw.type !== 'string' || !raw.type) return null
  const matcher = parseRemovedMatcher(raw)
  if (!matcher) return null
  // `:141` 是 `Boolean.parseBoolean(attribute)` —— 只有字面 "true" 为真，本仓同样只认 true。
  return { matcher, typeName: raw.type, approved: raw.approved === true }
}

/** 码元序比较（上游 `String.compareTo` 的等价物；`localeCompare` 会忽略 `*` 这类标点，排序结果就变了）。 */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseRemovedMatcher(raw: { ext?: unknown; pattern?: unknown }): FileNameMatcher | null {
  if (typeof raw.ext === 'string' && raw.ext) return { kind: 'extension', extension: raw.ext.toLowerCase() }
  if (typeof raw.pattern !== 'string' || !raw.pattern) return null
  const text = raw.pattern.trim()
  // 空白 pattern 不是一条模式（上游收到空串会把它当坏标签，本仓同样整条丢掉）。
  if (!text) return null
  if (text.startsWith('*.')) return { kind: 'wildcard', pattern: text }
  if (text.includes('*') || text.includes('?')) return { kind: 'wildcard', pattern: text }
  return { kind: 'exact', fileName: text }
}

/**
 * `ApproveRemovedMappingsActivity.kt:19-24` 的时机等价物：上游是「项目启动活动 + `runWhenSmart`」，
 * 本仓没有 dumb/smart 状态 —— 等价条件是**注册表这一轮装载已经完成**（内置类型与用户关联都落表之后），
 * 早于它的批准会把用户还没看到过的冲突直接判死。所以这里把「什么时候批」交给调用方，
 * 只保证：批的是未确认的那些，且批完计数为 0。
 */
export function approveUnapprovedAfterLoad(tracker: RemovedMappingTracker): RemovedMapping[] {
  return tracker.approveUnapprovedMappings()
}
