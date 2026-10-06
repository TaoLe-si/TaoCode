// 「忽略的文件与目录」清单 —— 上游
// `platform/lang-impl/src/com/intellij/openapi/fileTypes/impl/IgnoredFilesAndFoldersPanel.java`
// 那个面板 + `platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java`
// 的那三处 API（`getIgnoredFilesList` / `setIgnoredFilesList` / `isIgnoredFilesListEqualToCurrent`）的等价物。
//
// 用户可见行为（逐条对应上游行号）：
//   · 清单是**一列模式**，工具条只有 增 / 改 / 删，**没有上下移动**
//     （`IgnoredFilesAndFoldersPanel.java:53-58` 的 `disableUpDownActions()`）；
//   · 增与改都走同一个内联输入框：进入编辑时列表禁用、Enter 提交、Escape 放弃
//     （`:146-152` 的 KeyAdapter + `:205-218` 的 `startEdit`/`stopEdit`）；
//   · 提交时三条判定（`:159-190` 的 `trySave`）：与旧值相同 → 直接成功；
//     非法 → `filetype.ignore.error.invalid`「Invalid file pattern」；
//     清单里已有同值 → `filetype.ignore.error.already.exists`「The value already exists」；
//   · 每次写入后**整表重排**（`fillList` 的 `.sorted()`，`:104`），并把刚写入的那条重新选中
//     （`:183-185` + `reorderList` 的 `:106-118`）；
//   · 删除后选中位置跟着上移，越界时回到最后一条（`removePattern`，`:76-87`）；
//   · 存储形态是**分号分隔的一串**（`getValues` 的 `String.join(";")`，`:98-100`；
//     `setValues` 的 `split(";")`，`:102`），与 `IgnoredPatternSet.setIgnoreMasks`
//     （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/copy1/IgnoredPatternSet.java:46-53`）
//     同一套 StringTokenizer 语义；
//     **订正**：原先引的「`IgnoredPatternSet.java:43-49`」既没写包路径、行号又指到别处 ——
//     `FileTypeManagerImpl.java:47` 显式 import 的是 `impl.copy1` 那一份（`jps/model-impl` 下还有一份同名的，
//     `setIgnoreMasks` 在它的 `:38-45`），两份的 StringTokenizer 循环都不是 43-49；
//   · 清单**按模式遮蔽去重**（同一文件 `addIgnoreMask`，`:47-53`）：新词条先拿它自己当文件名去问现有掩码表
//     （`:49` 的 `findAssociatedFileType(ignoredFile) == null`），已被盖住就连清单都不进 ——
//     所以 `*.pyc` 在场时加 `foo.pyc`，`foo.pyc` 根本不留痕（编辑期不报错，落盘时才消失，
//     与上游一致：面板只管往 model 里放，`apply()` 写进 FileTypeManager 后 `reset()` 再读回来）；
//   · 生效与「有没有改动」按**集合**比，不按串比（`FileTypeManagerImpl.java:1154-1163`
//     的 `isIgnoredFilesListEqualToCurrent`：`StringTokenizer` 拆完丢进 `HashSet` 再比）；
//   · 默认清单（`FileTypeManagerImpl.java:142-144` 的 `DEFAULT_IGNORED`，17 条，`:139` 那句
//     `// must be sorted` + `FileTypesTest.java:1127-1130` 断言它必须已排序）在用户从没改过时就是它；
//   · **和默认表一样时不持久化**（`getState`：整表 `sort(null)` 后 `isEqualToDefaultIgnoreMasks` 为真就
//     连 `ignoreFiles` 这个元素都不写，`FileTypeManagerImpl.java:1434-1438`；
//     比法是「排序后逐位 `equalsIgnoreCase`」，同文件 `:1494-1504`）——
//     本仓的等价物：`writeStored` 在这种时候**清掉**存储键，读回来就是 `DEFAULT_IGNORED_FILES`。
//
// **匹配口径**（订正「文件名称模式 vs 路径模式」这条待办）：上游只按**文件名**判
// （`IgnoredFileCache.java:80-82` 的 `calcIgnored` 把 `file.getNameSequence()` 交给判定），
// 带 `/` 的模式在编辑期就被判非法（`PathUtilRt.isValidFileNameChar` 第一条就是分隔符，
// `platform/util-rt/src/com/intellij/util/PathUtilRt.java:221-223`）。所以本仓同样只有
// 「文件名称模式」一档，**没有**路径模式；上游真按路径判类型的那条是
// `FileTypeIdentifiableByVirtualFile`（`FileTypeBean.java:46-48` 明确写它是 last resort），
// 本仓没有 PSI/虚拟文件层，接不上（见报告的「做不到」）。
//
// 持久化：宿主设置表（`native/settings_schema.cpp`）的已知键里没有这一段，
// 本仓沿用同桶的既有做法（`src/fileTypeOverrides.ts` 的 `FILE_SETS_KEY`、`src/macros.ts`、
// `src/externalToolsRecords.ts`）—— 应用级 localStorage 一条键，值是**分号分隔的一串**
// （`ignoreListText`，与上游 `getIgnoredFilesList()` 同形）；与默认表逐位相同时**不留键**（见 `writeStored`）。
import { fileTypeManager } from './fileTypeRegistry.ts'

/** `FileTypeManagerImpl.DEFAULT_IGNORED`（`:142-144`）逐条照抄，顺序也照它（上游断言它已排序）。 */
export const DEFAULT_IGNORED_FILES: readonly string[] = [
  '*.pyc', '*.pyo', '*.rbc', '*.yarb', '*~', '.DS_Store', '.git', '.hg',
  '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.svn', 'CVS', '__pycache__', '_svn', 'vssver.scc', 'vssver2.scc',
]

/** 存储键（应用级：上游那份 `filetypes.xml` 也是应用级组件，`FileTypeManagerImpl.java:146` 的 `FILE_SPEC`）。 */
export const IGNORED_LIST_KEY = 'taocode.fileTypeIgnoredFiles'

/** 上游文案（`platform/platform-impl/resources/messages/FileTypesBundle.properties:58-61`）。 */
export const IGNORED_TEXT = '被忽略的文件与目录在 IDE 里不可见，也不会被索引。'
export const IGNORE_ERROR_EXISTS = '这个值已经有了。'
export const IGNORE_ERROR_INVALID = '无效的文件模式。'

/** `WINDOWS_INVALID_CHARS`（`PathUtilRt.java:231`）。 */
const WINDOWS_INVALID_CHARS = '<>:"|?*'
/** `WINDOWS_RESERVED_NAMES`（`PathUtilRt.java:233-236`，23 个名字）。 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/**
 * 一条模式是否合法 —— 上游 `PatternValueEditor.isValid`（`IgnoredFilesAndFoldersPanel.java:238-243`）：
 * 先把 `*`/`?` 各换成一个 `a`（通配符本身不是文件名字符），再按
 * `PathUtil.isValidFileName(text, true)`（strict=true）判。strict 那一条的规则在
 * `PathUtilRt.java:199-227`：空串 / `.` / `..` 不行，分隔符不行，控制字符与 `<>:"|?*` 不行，`;` 不行，
 * 3-4 长且是 Windows 保留名不行。本仓是 Windows 宿主（win32），所以按 WINDOWS 那一档判。
 */
export function isValidIgnorePattern(value: string): boolean {
  // 上游第一条：`if (value.isBlank()) return false`（`:239`）—— 全空格也不算合法。
  if (!value || !value.trim()) return false
  const withoutWildcards = value.trim().replaceAll('*', 'a').replaceAll('?', 'a')
  return isValidFileNameStrict(withoutWildcards)
}

/** `PathUtilRt.isValidFileName(name, WINDOWS, strict=true, cs)`（`:199-227`）的等价物。 */
export function isValidFileNameStrict(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  for (const character of name) {
    // `isValidFileNameChar`（`:221-227`）：分隔符 → 控制字符/Windows 非法字符 → 分号。
    if (character === '/' || character === '\\') return false
    if (character.codePointAt(0)! < 32 || WINDOWS_INVALID_CHARS.includes(character)) return false
    if (character === ';') return false
  }
  // 保留名判定只在长度 3-4 时做（`:214-216`）。
  if (name.length >= 3 && name.length <= 4 && WINDOWS_RESERVED_NAMES.has(name.toUpperCase())) return false
  return true
}

/**
 * 一串模式 → 数组（`IgnoredPatternSet.setIgnoreMasks`，`:43-49`：`StringTokenizer(";")` 逐条 `addIgnoreMask`，
 * 空词条 tokenizer 自然跳过，重复词条被 `findAssociatedFileType(...) == null` 那道闸挡掉）。
 */
export function ignorePatternsFromList(list: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of list.split(';')) {
    const mask = token.trim()
    if (!mask || seen.has(mask)) continue
    seen.add(mask)
    out.push(mask)
  }
  return out
}

/** `getIgnoredFilesList()`（`FileTypeManagerImpl.java:1142-1145`）：空清单回空串，不是回 `;`。 */
export function ignoreListText(patterns: readonly string[]): string {
  return patterns.length ? patterns.join(';') : ''
}

/**
 * 「清单有没有改动」（`isIgnoredFilesListEqualToCurrent`，`:1154-1163`）：
 * 两边都拆成**集合**再比 —— 所以顺序不同、重复词条都算「没改」。
 */
export function isIgnoreListEqualToCurrent(list: string, current: readonly string[]): boolean {
  const incoming = new Set(ignorePatternsFromList(list))
  const stored = new Set(current)
  if (incoming.size !== stored.size) return false
  for (const value of incoming) if (!stored.has(value)) return false
  return true
}

/** `fillList` 的 `.sorted()`（`IgnoredFilesAndFoldersPanel.java:104`）：Java 的 `String::compareTo` = 码元序。 */
export function sortIgnoredPatterns(patterns: readonly string[]): string[] {
  return [...patterns].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

/**
 * 整表排序后与**上游默认表逐位比大小写不敏感** —— 上游 `FileTypeManagerImpl.isEqualToDefaultIgnoreMasks`
 * （`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeManagerImpl.java:1494-1504`）：
 *   · 先比条数（`:1495-1497`），条数不同直接 false；
 *   · 再按下标逐位 `DEFAULT_IGNORED.get(i).equalsIgnoreCase(newList.get(i))`（`:1499-1502`）。
 * 注意它**不是**「按集合比」：位置也要对上（调用方 `getState` 传进来的已经 `sort(null)` 过，
 * 同文件 `:1434-1436`），大小写不同仍算默认表（`cvs` 与 `CVS` 算一样）。
 * 消费点只有一个：`writeStored` 据此决定「要不要持久化」—— 与上游「相等就不写 `ignoreFiles` 元素」同一条纪律。
 */
export function isEqualToDefaultIgnoreList(patterns: readonly string[]): boolean {
  const sorted = sortIgnoredPatterns(patterns)
  if (sorted.length !== DEFAULT_IGNORED_FILES.length) return false
  for (let index = 0; index < sorted.length; index++) {
    if (DEFAULT_IGNORED_FILES[index].toLowerCase() !== sorted[index].toLowerCase()) return false
  }
  return true
}

/** 一次编辑的结果：新清单 + 有没有被拒（拒时带上游那句文案）+ 该选中哪条。 */
export interface IgnoredEditOutcome {
  patterns: string[]
  accepted: boolean
  problem: string
  /** 提交后应选中的模式（被拒/无变化时是原来那条）。 */
  selected: string
  /** 选中项的下标（-1 = 没有）。 */
  index: number
}

/**
 * `PatternEditField.trySave()`（`:159-190`）：`oldValue === null` 是「新增」，否则是「改这条」。
 * 三条判定顺序也照它：先「与旧值相同直接放过」，再 `isValid`，最后 `myModel.contains(newValue)`。
 */
export function editIgnoredPattern(
  patterns: readonly string[],
  oldValue: string | null,
  value: string,
): IgnoredEditOutcome {
  const noChange = (selected: string): IgnoredEditOutcome => ({
    patterns: [...patterns], accepted: true, problem: '', selected, index: patterns.indexOf(selected),
  })
  if (oldValue !== null && value === oldValue) return noChange(value)
  if (!isValidIgnorePattern(value)) {
    return { patterns: [...patterns], accepted: false, problem: IGNORE_ERROR_INVALID, selected: oldValue ?? '', index: patterns.indexOf(oldValue ?? '') }
  }
  if (patterns.includes(value)) {
    return { patterns: [...patterns], accepted: false, problem: IGNORE_ERROR_EXISTS, selected: oldValue ?? '', index: patterns.indexOf(oldValue ?? '') }
  }
  const next = oldValue === null ? [...patterns, value] : patterns.map(item => (item === oldValue ? value : item))
  const sorted = sortIgnoredPatterns(next)
  return { patterns: sorted, accepted: true, problem: '', selected: value, index: sorted.indexOf(value) }
}

/**
 * `removePattern()`（`:76-87`）：按下标删一条，然后把选中位置**跟着走**——
 * 删完越界时退到最后一条，清单空了就没有选中项。
 */
export function removeIgnoredPattern(patterns: readonly string[], index: number): IgnoredEditOutcome {
  if (index < 0 || index >= patterns.length) {
    return { patterns: [...patterns], accepted: false, problem: '', selected: '', index: -1 }
  }
  const next = [...patterns.slice(0, index), ...patterns.slice(index + 1)]
  const selected = next.length === 0 ? '' : next[Math.min(index, next.length - 1)]
  return { patterns: next, accepted: true, problem: '', selected, index: next.indexOf(selected) }
}

// ── 存储与生效 ─────────────────────────────────────────────────────────────────

function readStored(): string[] | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(IGNORED_LIST_KEY)
    if (raw === null) return null
    return sortIgnoredPatterns(ignorePatternsFromList(raw))
  } catch {
    return null
  }
}

/**
 * 落盘。**两条上游纪律**：
 *   1. 传进来的必须是**生效后**的那张表（`applyIgnoredPatterns` 从注册表读回来，见那儿）——
 *      上游 `getState` 存的就是 `ignoredPatterns.getIgnoreMasks()`（`FileTypeManagerImpl.java:1434`），
 *      被遮蔽闸挡掉的词条从来没进过那张表；
 *   2. 与默认表逐位相同 ⇒ **不写存储**（清掉键；上游 `:1436-1438` 连 `ignoreFiles` 元素都不加）。
 *      读回来即 `DEFAULT_IGNORED_FILES`，等价于上游「没存过就用 `DEFAULT_IGNORED`」（`:165`）。
 */
function writeStored(patterns: readonly string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (isEqualToDefaultIgnoreList(patterns)) localStorage.removeItem(IGNORED_LIST_KEY)
    else localStorage.setItem(IGNORED_LIST_KEY, ignoreListText(patterns))
  } catch {
    // 存储不可用只影响跨会话持久化，本次会话的忽略照常生效。
  }
}

/** 当前清单：没存过 ⇒ 上游那份默认清单（`ignoredPatterns = new IgnoredPatternSet(DEFAULT_IGNORED)`，`:165`）。 */
export function ignoredPatterns(): string[] {
  return readStored() ?? [...DEFAULT_IGNORED_FILES]
}

/** 把清单推给注册表（`setIgnoredFilesList`，`:1148-1152`：先清缓存再换表）。 */
function applyToManager(patterns: readonly string[]): void {
  fileTypeManager.setIgnoredFilesList(ignoreListText(patterns))
}

/**
 * 应用一次改动（设置页的 OK 只做这一件事）：与当前生效清单按集合相同就什么都不做
 * （上游 `apply()` 的 `:200-202` 也是先问 `isIgnoredFilesListEqualToCurrent` 才写）。
 * **落盘的是注册表里真正生效的那张表**，不是传进来的那份：`setIgnoredFilesList` 逐词条过遮蔽闸
 * （`IgnoredPatternSet.addIgnoreMask`，`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/copy1/IgnoredPatternSet.java:47-53`），
 * 被现有掩码盖住的那条在上游连清单都进不去，所以也不该被持久化 ——
 * 与 `getState` 存 `getIgnoreMasks()`（`FileTypeManagerImpl.java:1434`）同一口径。
 * 返回**是否真的写进了注册表**。
 */
export function applyIgnoredPatterns(patterns: readonly string[]): boolean {
  const sorted = sortIgnoredPatterns(patterns)
  const changed = !isIgnoreListEqualToCurrent(ignoreListText(sorted), ignorePatternsFromList(fileTypeManager.getIgnoredFilesList()))
  if (changed) applyToManager(sorted)
  writeStored(ignorePatternsFromList(fileTypeManager.getIgnoredFilesList()))
  return changed
}

/** 恢复默认清单（页面上的「恢复默认」；上游的默认值就是 `DEFAULT_IGNORED`）。返回恢复后的清单。 */
export function restoreDefaultIgnoredPatterns(): string[] {
  applyIgnoredPatterns(DEFAULT_IGNORED_FILES)
  return [...DEFAULT_IGNORED_FILES]
}

/** 装载（应用启动时调一次，把存储里的清单灌进注册表；本仓的注册表是进程内的）。 */
export function loadIgnoredPatterns(): string[] {
  const patterns = ignoredPatterns()
  applyToManager(patterns)
  return patterns
}

/** 一个名字会不会被忽略（`isFileIgnored(String)`，`:1166-1167`）。 */
export function isIgnoredName(fileName: string): boolean {
  return fileTypeManager.isFileIgnored(fileName)
}

/**
 * 路径里**任何一段**被忽略 ⇒ 整个路径不参与（上游没有这一条，是 `src/fileChooserModel.ts:432-467`
 * 已经在用的那套「逐段问注册表」口径的显式化，供文件树/搜索这类按路径过滤的消费方直接用）。
 */
export function isPathIgnored(path: string): boolean {
  return normalizePathSegments(path).some(segment => fileTypeManager.isFileIgnored(segment))
}

function normalizePathSegments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean)
}
