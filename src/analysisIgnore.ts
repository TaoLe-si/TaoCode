// 分析忽略（上游 `platform/lang-impl/src/com/intellij/ide/analysisignore/`：
// `AnalysisIgnoreService` 把工程里每个 `.analysisignore` 的规则按 baseDir（文件自己所在目录）存进
// Workspace Model，`AnalysisIgnoreMatcher`/`AnalysisIgnorePattern` 决定哪些路径不参与高亮/检查；
// 文件本身还是个带词法分析器的独立文件类型 —— 那是 PSI 侧的形态，本仓不搬运）。
//
// 本仓的等价物：问题/整工程检查这两条**诊断消费链**在聚合前问一次本模块，
// 命中的文件不进问题面板。来源有三类：
//   · 用户显式忽略的文件（`toggleIgnoredFile`，编辑器/面板里点亮的那一个）—— 上游
//     `AnalysisIgnoreService` 的 per-file 口径（本仓是显式清单，上游是索引层的一次查询）；
//   · 用户写的 glob 规则（每行一条，`**` 跨目录、`*` 段内、`?` 单字符，`#` 开头是注释）——
//     本仓自己的来源，走 `globToRegExp`（与 `.analysisignore` 是**两套**格式语义，见
//     `src/editorConfig.ts:62` 的同口径说明）；`.analysisignore` 的规则是另一条来源，
//     格式与匹配见 `src/analysisIgnoreFile.ts`；
//   · **工程里的 `.analysisignore` 文件**（本批补的接线）：从 `workspace.files` 的清单里挑出所有
//     `.analysisignore`（每个管自己那棵子树，上游没有"就近取一个"这回事），逐个 `file.read` 读进来。
//     读盘是异步的，所以第一次问门控时**顺带把加载发出去**，结果落到 `projectIgnoreRecords` 这个 ref 上；
//     消费方（`src/problems.ts` 的 `allProblems`）在门控里读了这个 ref，于是加载完成后自动重算。
// 持久化沿用本仓应用级用户数据的口径：`localStorage`（与 `taocode.findOptions` 同族）。
//
// 重新加载的时机：诊断表被清空（`lsp.close`/换工程时 `lspDiagnostics` 归零）时把记录丢掉并重新武装，
// 另有 `refreshProjectAnalysisIgnore()` 给知道得更准的宿主显式调用。读盘失败一律当"没有规则"——
// 诊断不能因为读不到一个可选文件而消失。
//
// **明确不做**（上游有、本子集没有，判词里同样点名）：`.analysisignore` 作为独立文件类型
// （词法/解析/高亮）、`AnalysisIgnoreIndexableFileScanner` 的索引层联动（上游靠 Workspace File Index
// 排除，本仓是聚合前的一道同步门控，没有索引可挂）。
import { computed, ref, watch } from 'vue'
// 桥：读工程文件清单与文件内容（`workspace.files` / `file.read`）。
// 显式 `.ts` 后缀：这是**运行时**导入（不是 `import type`），Node 直跑 .ts 时不做扩展名推断，
// 少了后缀 `tests/analysis-ignore.test.mjs` / `tests/analysis-scope.test.mjs` /
// `tests/workspace-diagnostics.test.mjs` 三个门禁会 ERR_MODULE_NOT_FOUND。
import { lspDiagnostics, request, type ProjectFileList } from './bridge.ts'
// `.analysisignore` 的格式与匹配（与上面手动 glob 是两套语义）。
import { analysisIgnoreFilesIn, analysisIgnoreRecord, isAnalysisIgnoredByRecords, type AnalysisIgnoreRecord } from './analysisIgnoreFile.ts'

const FILES_KEY = 'taocode.analysisIgnore.files'
const PATTERNS_KEY = 'taocode.analysisIgnore.patterns'

function readStored(key: string): string[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStored(key: string, value: string[]) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的忽略照常生效。
  }
}

/** 显式忽略的文件（路径按 `/` 归一化后存放）。 */
export const ignoredFiles = ref<string[]>(readStored(FILES_KEY))
/** 忽略规则（glob），按行保存。 */
export const ignorePatterns = ref<string[]>(readStored(PATTERNS_KEY))

/**
 * 工程里读到的 `.analysisignore` 记录（每条 = 一个文件 + 它自己所在的目录）。
 * 门控读这个 ref，所以加载完成会自动触发消费方重算（`src/problems.ts` 的 `allProblems`）。
 */
export const projectIgnoreRecords = ref<readonly AnalysisIgnoreRecord[]>([])

let projectLoadPending = false

/**
 * 宿主读盘出口。**默认走 `bridge.request`；测试可替换** ——
 * 这是本仓的既有惯例（`toolMacros` / `inspectionProfileHost` 同样把宿主做成可注入 deps），
 * 而不是加一个 `__setXxxForTests` 全局钩子（那种钩子上一个轮次凭空发明过一个，
 * 导致整个测试文件加载失败，因为 `bridge.ts` 里根本没有那个导出）。
 */
export interface AnalysisIgnoreHost {
  /** 列出工程里的文件（工作区相对路径）。抛错 = 没有打开工作区。 */
  listFiles: () => Promise<{ files: string[] } | { files?: string[] } | null | undefined>
  /** 读一个文件。抛错 = 该文件不存在 / 读不到。 */
  readFile: (path: string) => Promise<{ content: string }>
}

const defaultHost: AnalysisIgnoreHost = {
  listFiles: () => request<ProjectFileList>('workspace.files'),
  readFile: (path: string) => request<{ content: string }>('file.read', { path }),
}

let host: AnalysisIgnoreHost = defaultHost

/** 替换宿主（**只给测试用**）；传 `undefined` 回到默认的 `bridge.request`。 */
export function setAnalysisIgnoreHost(next: AnalysisIgnoreHost | undefined): void {
  host = next ?? defaultHost
}

/** 丢掉已读记录并重新武装下一次加载（换工程/重新读盘用）。 */
export function resetProjectAnalysisIgnore(): void {
  projectIgnoreRecords.value = []
  projectLoadPending = false
}

/** 显式重读工程里的 `.analysisignore`（宿主知道文件变了时调；返回读到的记录数）。
 *
 *  ⚠️ 必须先清 `projectLoadPending`：它既是「已武装」标志又是 `loadProjectAnalysisIgnore` 的
 *  幂等短路条件（`:83` `if (projectLoadPending) return ...`）。若这里先置 true 再调，
 *  那个函数**立刻返回旧记录、一次盘都不读** —— 换工程后重读会静默失效。
 */
export async function refreshProjectAnalysisIgnore(): Promise<number> {
  projectLoadPending = false
  return loadProjectAnalysisIgnore()
}

async function loadProjectAnalysisIgnore(): Promise<number> {
  if (projectLoadPending) return projectIgnoreRecords.value.length
  projectLoadPending = true
  try {
    const list = await host.listFiles()
    const records: AnalysisIgnoreRecord[] = []
    for (const file of analysisIgnoreFilesIn(list?.files ?? [])) {
      try {
        const document = await host.readFile(file)
        records.push(analysisIgnoreRecord(file, document?.content ?? ''))
      } catch {
        // 单个文件读不到就跳过它：不能因为一个可选文件读失败而丢掉其它规则。
      }
    }
    projectIgnoreRecords.value = records
  } catch {
    // 没有打开工作区 / 宿主不可用：没有工程规则，显式忽略与手动 glob 照常生效。
    projectIgnoreRecords.value = []
  }
  return projectIgnoreRecords.value.length
}

/** 门控第一次被问时把加载发出去（幂等；`projectIgnoreRecords` 一变消费方就会重算）。 */
function ensureProjectAnalysisIgnore(): readonly AnalysisIgnoreRecord[] {
  if (!projectLoadPending) void loadProjectAnalysisIgnore()
  return projectIgnoreRecords.value
}

// 诊断表被清空 = 换工程或关掉工作区（`lsp.close` / `workspace.close` 都走这条路）：
// 上一份工程的规则不能留到下一个工程用。
watch(() => lspDiagnostics.size, size => { if (!size) resetProjectAnalysisIgnore() })

const normalize = (path: string) => path.replace(/\\/g, '/')

/** 规则文本（编辑器里的多行文本）。注释行与空行在解析时丢掉。 */
export function parseIgnorePatterns(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
}

export function formatIgnorePatterns(patterns: string[] = ignorePatterns.value): string {
  return patterns.join('\n')
}

export const ignorePatternsText = computed(() => formatIgnorePatterns())

/** 把一条 glob 规则编成整串匹配的正则（`**` 跨目录，`*` 段内，`?` 单字符）。 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = normalize(pattern).replace(/^\.?\//, '')
  let source = ''
  for (let index = 0; index < normalized.length; ++index) {
    const char = normalized[index]!
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        // `**/` 吃掉任意层目录（含零层），单独的 `**` 匹配任意字符（含 `/`）。
        if (normalized[index + 2] === '/') { source += '(?:[^/]+/)*'; index += 2 }
        else { source += '.*'; ++index }
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`(?:^|/)${source}$`)
}

/** 路径是否命中显式忽略列表或任一条手动 glob 规则（不含 `.analysisignore`，见 `isAnalysisIgnored`）。 */
export function matchesAnalysisIgnore(path: string, files: string[] = ignoredFiles.value, patterns: string[] = ignorePatterns.value): boolean {
  const normalized = normalize(path)
  if (files.includes(normalized)) return true
  return patterns.some(pattern => globToRegExp(pattern).test(normalized))
}

/**
 * 诊断聚合前的门控：true ⇒ 这个文件的诊断不进问题面板。
 * 三条来源取并集：显式忽略清单、手动 glob 规则、工程里的 `.analysisignore`
 * （`AnalysisIgnoreService` 的那条；第一次问时顺带把读盘发出去，见文件头）。
 */
export function isAnalysisIgnored(path: string): boolean {
  if (matchesAnalysisIgnore(path)) return true
  const records = ensureProjectAnalysisIgnore()
  return records.length > 0 && isAnalysisIgnoredByRecords(records, path)
}

/** 忽略/恢复一个文件。返回忽略后的状态（true = 现在被忽略）。 */
export function toggleIgnoredFile(path: string): boolean {
  const normalized = normalize(path)
  const next = ignoredFiles.value.filter(item => item !== normalized)
  const ignored = next.length === ignoredFiles.value.length
  if (ignored) next.push(normalized)
  ignoredFiles.value = next
  writeStored(FILES_KEY, next)
  return ignored
}

/** 覆盖忽略规则；返回解析后的规则条数（面板用它给反馈）。 */
export function saveIgnorePatterns(text: string): number {
  const parsed = parseIgnorePatterns(text)
  ignorePatterns.value = parsed
  writeStored(PATTERNS_KEY, parsed)
  return parsed.length
}

/** 清空所有忽略（文件 + 规则 + 工程里读到的 `.analysisignore` 记录）。测试与「恢复全部」用。 */
export function clearAnalysisIgnore() {
  ignoredFiles.value = []
  ignorePatterns.value = []
  writeStored(FILES_KEY, [])
  writeStored(PATTERNS_KEY, [])
  resetProjectAnalysisIgnore()
}
