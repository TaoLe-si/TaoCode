// 文件类型的内容探测（上游 `OpenFileDescriptor` 的 `DetectedByContentFileType` 一族：
// 扩展名关联不上时按内容认类型 —— shebang（`#!`）是最典型的一例；`FileTypeDetector` EP 还可以
// 逐语言加探测器，本仓没有 EP 宿主，落成一张纯探测表）。
//
// 本仓现状：`src/fileTypes.ts` 只做扩展名关联的校验与落盘，`templates.ts` 的 `languageFor`
// 按扩展名给编辑器语言；**没有**任何按内容探测。这个模块补纯规则：
//   · `detectByShebang`：`#!/usr/bin/env python3` 这类首行；
//   · `detectByContent`：XML 序言 / `<!DOCTYPE html>` / JSON / `#include` / Java 类型声明 / markdown 标题；
//   · `detectFileType`：扩展名关联与内容探测的合成（内容高置信度时**内容赢**，与上游一致）。
//
// 语言 id 对齐 `src/languages.ts` 的 `EDITOR_LANGUAGES`（java/cpp/typescript/other）：
// 探测到的 shell/python/json 这些本仓没有专属词法层，语言落 `other`，但**类型名**照实给出
// （设置页里给用户看的「探测到：JSON」不该被抹平）。

import { ref } from 'vue'
import { EDITOR_LANGUAGES } from './languages.ts'
import { fileTypeManager } from './fileTypeRegistry.ts'
import { looksBinary } from './vcsFileUtil.ts'
// 按文件覆盖类型（`lp/exclude` 的 `OverrideFileTypeManager`）：上游 `getFileTypeByFile` 在
// **任何**按名字/内容的判定之前先问覆盖表（`FileTypeManagerImpl.java:916-923` 的 `getByOverrides`，
// 实现是 `UserFileTypeOverrider.java:17-24` 的 `findFileTypeByName`），本仓同序。
import { fileTypeOverrideOf, fileTypeDescriptorOfOverride, PLAIN_TEXT_TYPE } from './fileTypeOverrides.ts'

/** 一张探测器：`type` 是给人看的类型名，`language` 是本仓编辑器语言 id。 */
export interface FileTypeGuess {
  kind: 'extension' | 'shebang' | 'content' | 'binary' | 'override' | 'none'
  /** 探测到的文件类型名（`Java`/`JSON`/`Shell`…；none/binary 时为空串）。 */
  type: string
  /** 编辑器语言（`EDITOR_LANGUAGES` 之一；`other` 表示只按纯文本处理）。 */
  language: string
  /** 置信度：shebang 与 XML/DOCTYPE/JSON 这类强特征为 high，Java/TS 这类弱特征为 low。 */
  confidence: 'high' | 'low'
}

/**
 * 一条**可注册的内容探测器**（上游 `com.intellij.openapi.fileTypes.FileTypeDetector` 的等价物）。
 *
 * 上游那个类在本仓判词里被点名，但**上游树里没有这个文件**（已核实，见报告）—— 能核实的
 * 最近物是 `FileTypeBean` 的 `hashBangs` 属性（`platform/platform-impl/src/com/intellij/openapi/fileTypes/impl/FileTypeBean.java:144`）：
 * 上游把"按内容认类型"这件事做成了**声明式的属性**，不是一段硬编码的 if 链。本仓照这个形状做：
 * 一张有序的探测器表，先注册/先声明的先判（`order` 小的优先），first-match-wins。
 * 内置探测器就是这张表的默认内容，所以这个"EP"是被真实消费的，不是空注册点。
 */
export interface ContentDetector {
  /** 探测器 id（提示与排查用）。 */
  id: string
  /** 优先级，**小的先判**。 */
  order: number
  /** 判内容（只给文件开头一段就够，调用方负责截断）。认不出回 null。 */
  match: (head: string) => { type: string; language: string; confidence: 'high' | 'low' } | null
}

const SHEBANG_INTERPRETERS: ReadonlyArray<{ match: RegExp; type: string; language: string }> = [
  { match: /(?:^|\/)(?:python[0-9.]*)$/, type: 'Python', language: 'other' },
  { match: /(?:^|\/)(?:node|nodejs)$/, type: 'JavaScript', language: 'other' },
  { match: /(?:^|\/)(?:ts-node|deno|bun)$/, type: 'TypeScript', language: 'typescript' },
  { match: /(?:^|\/)(?:bash|sh|zsh|dash|ksh)$/, type: 'Shell', language: 'other' },
  { match: /(?:^|\/)(?:ruby|perl|php)$/, type: 'Script', language: 'other' },
]

/** 首行的 shebang（`#!/usr/bin/env python3 -u` 也认：只取解释器那一段）。 */
export function detectByShebang(firstLine: string): { type: string; language: string } | null {
  const match = /^#!\s*([^\s]+)(?:\s+([^\s]+))?/.exec(firstLine.trimStart())
  if (!match) return null
  const binary = match[1]
  const argument = match[2]
  const probe = /(?:^|\/)(?:env)$/.test(binary) && argument ? argument : binary
  for (const entry of SHEBANG_INTERPRETERS) if (entry.match.test(probe)) return { type: entry.type, language: entry.language }
  return { type: 'Script', language: 'other' }
}

/**
 * 二进制判定 —— 探测**必须在它上面短路**（`lp/file-types` 判词里「二进制与编码判定」那一项）。
 *
 * 上游把这件事交给 `BinaryFileType.isBinary()`（`platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java:48-51`
 * 与 `UserBinaryFileType.java:16-19` 都是恒 true 的那一档）；本仓已经有一份字节级判据
 * （`src/vcsFileUtil.ts` 的 `looksBinary`，给补丁应用用的），这里直接复用，不另写一套。
 * 短路之后探测不再看内容：否则一个 PNG 开头撞上 `<?xml` 就会被认成 XML。
 */
export function isBinaryContent(content: string): boolean {
  return looksBinary(content)
}

const DEFAULT_DETECTORS: readonly ContentDetector[] = [
  { id: 'xml-prolog', order: 10, match: head => (/^<\?xml\b/i.test(head.trimStart()) || /^\s*<!\[CDATA\[/.test(head.trimStart()))
    ? { type: 'XML', language: 'other', confidence: 'high' } : null },
  { id: 'html-doctype', order: 10, match: head => (/^<!DOCTYPE\s+html/i.test(head.trimStart()) || /<html[\s>]/i.test(head))
    ? { type: 'HTML', language: 'other', confidence: 'high' } : null },
  { id: 'json-document', order: 10, match: head => {
    const body = head.trim()
    if (!/^\{[\s\S]*\}$/.test(body) && !/^\[[\s\S]*\]$/.test(body)) return null
    try { JSON.parse(body); return { type: 'JSON', language: 'other', confidence: 'high' } } catch { return null }
  } },
  { id: 'cpp-include', order: 10, match: head => (/^#include\s*[<"]/.test(head.trimStart()) || /^#pragma\s+once/.test(head.trimStart()))
    ? { type: 'C/C++', language: 'cpp', confidence: 'high' } : null },
  { id: 'java-type-declaration', order: 20, match: head => (/^\s*(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\s+[A-Za-z_$]/.test(head.trimStart()))
    ? { type: 'Java', language: 'java', confidence: 'low' } : null },
  { id: 'typescript-module', order: 20, match: head => (/^\s*(?:import|export)\s+.+\s+from\s+['"][^'"]+['"]|^\s*(?:interface|type)\s+[A-Za-z_$][\w$]*\s*[={<]/m.test(head))
    ? { type: 'TypeScript', language: 'typescript', confidence: 'low' } : null },
  { id: 'markdown-heading', order: 20, match: head => (/^\s*#{1,6}\s+\S/m.test(head) && /\[[^\]]+\]\([^)]+\)/.test(head))
    ? { type: 'Markdown', language: 'other', confidence: 'low' } : null },
]

const detectorTable: ContentDetector[] = [...DEFAULT_DETECTORS]

/**
 * 追加一条内容探测器（`order` 小的先判；同 order 按注册顺序）。
 * 返回一个注销函数 —— 上游 EP 注销就是从 `ExtensionPointImpl` 的列表里摘掉。
 */
export function registerContentDetector(detector: ContentDetector): () => void {
  detectorTable.push(detector)
  detectorTable.sort((a, b) => a.order - b.order)
  return () => {
    const index = detectorTable.indexOf(detector)
    if (index >= 0) detectorTable.splice(index, 1)
  }
}

/** 恢复内置探测器表（测试与「改完设置想回默认」用）。 */
export function resetContentDetectors(): void {
  detectorTable.splice(0, detectorTable.length, ...DEFAULT_DETECTORS)
}

/** 当前这张表（按判定的实际顺序）。 */
export function contentDetectors(): readonly ContentDetector[] {
  return detectorTable
}

/** 按内容探测（走探测器表；返回 null 表示认不出，不猜）。 */
export function detectByContent(content: string): { type: string; language: string; confidence: 'high' | 'low' } | null {
  const head = content.slice(0, 4096)
  for (const detector of detectorTable) {
    const hit = detector.match(head)
    if (hit) return hit
  }
  return null
}

/** 扩展名 → 关联语言（设置里的表优先，其次进程内注册表 `src/fileTypeRegistry.ts`）。 */
function associatedFor(fileName: string, extension: string, associations: Record<string, string>):
    { type: string; language: string } | null {
  const registered = fileTypeManager.getFileTypeByFileName(fileName)
  const configured = associations[extension]
  // 设置里的关联只覆盖**语言**，类型名仍按注册表给（上游 FileTypeConfigurable 只改关联不改类型）。
  if (configured) return { type: registered?.name ?? '', language: configured }
  return registered ? { type: registered.name, language: registered.language } : null
}

/** 内容高置信度的类型里，哪些允许覆盖扩展名关联（IDEA 的 DetectedByContentFileType 口径）。 */
const CONTENT_OVERRIDES_EXTENSION = true

/**
 * 一个文件的**显式覆盖**（`OverrideFileTypeManager` 存的那一档）。
 * 上游 `getByOverrides` 找不到对应类型时就当没有覆盖、继续往下判
 * （`FileTypeManagerImpl.java:950-956` 那个 for 循环只在非 null 时 return），本仓同一条：
 * 覆盖值写着注册表里已经不存在的类型 ⇒ 忽略，不猜。
 */
export function overrideGuess(fileName: string): FileTypeGuess | null {
  const value = fileTypeOverrideOf(fileName)
  if (!value) return null
  const descriptor = fileTypeDescriptorOfOverride(value)
  if (!descriptor) return null
  // 覆盖成二进制类型：不接文本编辑器（与 `isBinaryContent` 那条同一处理）。
  if (descriptor.binary) return { kind: 'binary', type: '', language: 'other', confidence: 'high' }
  // 覆盖成纯文本 ⇒ 明确「没有语言」，`editorLanguage.ts` 的 `language === 'other'` 分支返回空扩展
  // （上游覆盖成 PlainTextFileType 就是这个效果：退出语言分析、只剩纯文本编辑器）。
  const language = value === PLAIN_TEXT_TYPE || !EDITOR_LANGUAGES.includes(descriptor.language as typeof EDITOR_LANGUAGES[number])
    ? 'other' : descriptor.language
  return { kind: 'override', type: descriptor.name, language, confidence: 'high' }
}

/**
 * 合成探测：**覆盖 > 二进制 > shebang > 内容（高置信度）> 扩展名 > 内容（低置信度）> none**。
 * 传入的 `associations` 是设置页里的扩展名表（`{ java: 'java' }`），只覆盖语言，不给类型名。
 *
 * 覆盖排在最前是上游的顺序（`FileTypeManagerImpl.java:916-923`）；
 * 二进制**排在其余之前**：上游的 `BinaryFileType`/`NativeFileType`
 * （`platform/ide-core/src/com/intellij/openapi/fileTypes/NativeFileType.java:48-51`）
 * 是一等类型，按内容认类型的探测器没有理由在它上面跑 —— 也不该跑（PNG 开头撞上 `<?xml` 就认成 XML 了）。
 */
export function detectFileType(fileName: string, content = '', associations: Record<string, string> = {}): FileTypeGuess {
  const override = overrideGuess(fileName)
  if (override) return override
  if (content && isBinaryContent(content)) return { kind: 'binary', type: '', language: 'other', confidence: 'high' }
  const dot = fileName.lastIndexOf('.')
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  const associated = associatedFor(fileName, extension, associations)
  const associatedLanguage = associated?.language
  const associatedType = associated?.type ?? associatedLanguage ?? ''
  // shebang 是最强特征（IDEA 也把它单列成一条探测）：`script` 无扩展名时全靠它。
  // 先查**注册表里登记的 hashbang 模式**（上游 `<fileType hashBangs="…">` 那一条，
  // `FileTypeBean.java:138-144` + `FileTypeManagerImpl.java:644-647`，判定用
  // `FileUtil.isHashBangLine`，探测器是 `HashBangFileTypeDetector.kt:14-16`）：
  // 那是显式声明，比本仓那张内置解释器表（猜的）优先，所以用户在设置页给某个类型加一条
  // `HashBang patterns` 就当场改变判定。
  const head = content ? content.replace(/^\s+/, '') : ''
  const declared = head.startsWith('#!') ? fileTypeManager.findFileTypeByHashBang(head) : null
  if (declared) {
    return { kind: 'shebang', type: declared.name, language: declared.binary ? 'other' : declared.language, confidence: 'high' }
  }
  const shebang = head ? detectByShebang(head.split('\n')[0] ?? '') : null
  if (shebang) return { kind: 'shebang', type: shebang.type, language: shebang.language, confidence: 'high' }
  const byContent = content ? detectByContent(content) : null
  if (byContent && byContent.confidence === 'high' && CONTENT_OVERRIDES_EXTENSION && extension !== '')
    return { kind: 'content', type: byContent.type, language: byContent.language, confidence: 'high' }
  if (associatedLanguage && EDITOR_LANGUAGES.includes(associatedLanguage as (typeof EDITOR_LANGUAGES)[number]))
    return { kind: 'extension', type: associatedType || associatedLanguage, language: associatedLanguage, confidence: 'high' }
  if (byContent) return { kind: 'content', type: byContent.type, language: byContent.language, confidence: byContent.confidence }
  if (associatedLanguage) return { kind: 'extension', type: associatedType || associatedLanguage, language: associatedLanguage, confidence: 'low' }
  return { kind: 'none', type: '', language: 'other', confidence: 'low' }
}

/** 状态栏/提示里的一句话（探测不到时说明按纯文本打开）。 */
export function detectedSummary(guess: FileTypeGuess): string {
  if (guess.kind === 'binary') return '二进制文件，不做内容类型探测。'
  if (guess.kind === 'none') return '未识别文件类型，按纯文本打开。'
  if (guess.kind === 'override') return `按用户覆盖识别为 ${guess.type}。`
  const how = guess.kind === 'extension' ? '扩展名' : guess.kind === 'shebang' ? 'shebang' : '内容'
  return `按${how}识别为 ${guess.type}${guess.confidence === 'low' ? '（低置信度）' : ''}。`
}

/** 编辑器只认识这三种有专属词法层的语言（`CodeEditor.loadLanguage` 的 forced 分支）。 */
const EDITOR_FORCED_LANGUAGES = new Set(['java', 'cpp', 'typescript'])

/**
 * 编辑器语言 prop 的判定（`App.vue` 的 `associationOf` 调它）：
 * **按文件覆盖 > 设置里的关联 > 内容探测 > undefined**。
 *
 * 常规路径只回 `java`/`cpp`/`typescript`/`other` 里的**三种**—— 其余（JSON/HTML/CSS/Vue）交给
 * `CodeEditor.loadLanguage` 现有的路径规则，别用内容探测去覆盖它更细的判断。
 * 唯一能回 `other` 的是**用户显式覆盖成纯文本**：那不是探测猜出来的，是用户说「这个文件按纯文本处理」，
 * 上游 `OverrideFileTypeManager` 的效果就是它（`UserFileTypeOverrider.java:17-24`）。
 * 返回 `undefined` 表示「扩展名与关联都没说出个所以然」，编辑器按老路径自己认。
 *
 * **二进制先退出**：一个 `.java` 名下塞进 PNG 的情况极少，但 `.h` 名下的图片不少 ——
 * 上游给二进制文件开的是 `BinaryFileType`（`NativeFileType.java:48-51` 那一档），没有词法层，
 * 所以这里一律不接编辑器，让二进制查看器那条路（`file.readBinary`）接管。
 */
export function resolveEditorLanguage(fileName: string, content: string, associations: Record<string, string> = {}): string | undefined {
  const override = overrideGuess(fileName)
  if (override) return override.kind === 'binary' ? undefined : override.language
  if (content && isBinaryContent(content)) return undefined
  const dot = fileName.lastIndexOf('.')
  const extension = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
  const associated = associations[extension]
  if (associated) return associated
  const guess = detectFileType(fileName, content, associations)
  return EDITOR_FORCED_LANGUAGES.has(guess.language) ? guess.language : undefined
}

// ── 探测缓存与「重新解析」（`FileTypeDetectionService` 的缓存 + `ReparseUtil.kt` 的重解析）──
//
// 上游那两层都在干同一件事的两端：
//   · `FileTypeDetectionService.java:401` `cacheAutoDetectedFileType(file, fileType)` —— 按文件缓存
//     内容探测的结果；`:330-337 clearCaches()` 整批作废；`:338-340 onDetectorListChange` 是它的触发点
//     （探测器表一变，缓存立刻不可信）。
//   · `PersistentFileSetManager.java:90-96 onFileSettingsChanged` —— 覆盖表一变就
//     `CachedFileType.clearCache()` + `FileContentUtilCore.reparseFiles(files)`；
//     `ReparseUtil.kt:11-17` 就是那个重解析的协程包装（后台写动作里重解析变更的文件）。
//
// 本仓没有 `CachedFileType`（宿主的 VFS 不缓存类型），等价物是下面这份**前端探测缓存**：
// 键含「路径 + 内容指纹 + 覆盖值 + 关联表指纹 + 版本号」，任何一项变了都自然 miss，
// 不需要上游那套 stamp 记账。`reparseFileTypes()` 是 `FileContentUtilCore.reparseFiles` 的等价动作：
// 清缓存 + 版本号自增，App 的 `associationOf(path, tab.content)` 在模板里读这个 ref，
// 于是**已打开的标签页当场按新规则重算语言**（这就是用户可见的「重新解析」）。

/** 缓存条数上限：探测输入是「打开过的文件」，超过就是把不再看的文件也留在内存里。 */
const MAX_DETECTION_CACHE = 512

/** 变更代数（上游 clearCache 的等价物；渲染层读它，所以它是响应式的）。 */
export const fileTypeRevision = ref(0)

const detectionCache = new Map<string, FileTypeGuess>()

/** 内容指纹（长度 + 采样和）：上游用 `VirtualFile.getModificationStamp()`，本仓只有字符串。 */
function contentStamp(content: string): string {
  if (!content) return '0'
  let sum = 0
  const step = Math.max(1, Math.floor(content.length / 64))
  for (let index = 0; index < content.length; index += step) sum = (sum * 31 + content.charCodeAt(index)) | 0
  return `${content.length}:${sum}`
}

/** 关联表的指纹（对象键值排序后拼接）—— 设置页改一条关联就该让全部缓存作废。 */
function associationStamp(associations: Record<string, string>): string {
  const keys = Object.keys(associations).sort()
  return keys.length ? keys.map(key => `${key}=${associations[key]}`).join(';') : '-'
}

/** 带缓存的探测（同输入同结果；缓存满时按插入顺序淘汰最旧的一条）。 */
export function detectFileTypeCached(fileName: string, content = '', associations: Record<string, string> = {}): FileTypeGuess {
  void fileTypeRevision.value
  const key = `${fileName}\u0000${contentStamp(content)}\u0000${fileTypeOverrideOf(fileName) ?? ''}\u0000${associationStamp(associations)}`
  const cached = detectionCache.get(key)
  if (cached) return cached
  const guess = detectFileType(fileName, content, associations)
  if (detectionCache.size >= MAX_DETECTION_CACHE) {
    const oldest = detectionCache.keys().next()
    if (!oldest.done) detectionCache.delete(oldest.value)
  }
  detectionCache.set(key, guess)
  return guess
}

/** `FileTypeDetectionService.clearCaches()`（`:330-337`）：整批作废，返回被丢掉几条。 */
export function clearFileTypeDetectionCache(): number {
  const dropped = detectionCache.size
  detectionCache.clear()
  return dropped
}

/**
 * 「重新解析文件类型」（上游 `ReparseUtil.kt:11-17` → `FileContentUtilCore.reparseFiles`）：
 * 清探测缓存 + 版本号自增。返回这一轮清掉了几条、版本号是多少（设置页显示「已重解析 N 个文件」用）。
 */
export function reparseFileTypes(): { revision: number; dropped: number } {
  const dropped = clearFileTypeDetectionCache()
  fileTypeRevision.value += 1
  return { revision: fileTypeRevision.value, dropped }
}

/** 当前缓存条数（测试与诊断用）。 */
export function fileTypeDetectionCacheSize(): number { return detectionCache.size }

// 类型注册表一变（注册/注销/改关联），探测缓存立刻不可信 —— 上游 `FileTypeDetectionService.java:338-340`
// 的 `onDetectorListChange → clearCaches()`，加上 `FileTypeManagerImpl.java:263-273` 那个
// 「overrider 变了就把 fileTypeOverriderCache 置 null」的同一条纪律。
fileTypeManager.addFileTypeListener({
  fileTypesChanged: () => { clearFileTypeDetectionCache(); fileTypeRevision.value += 1 },
})
