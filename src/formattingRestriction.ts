// 格式化的准入限制 —— 上游 `platform/lang-impl/src/com/intellij/formatting/` 的两条限制在本仓的落点。
//
// 逐条对照：
//   · `ExcludedFileFormattingRestriction.java:16-25` —— 文件落在 `CodeStyleSettings.getExcludedFiles()`
//     （代码风格 › 格式化程序 › 不格式化的文件）里就不允许格式化。本仓没有代码风格设置模型，
//     落成一份「不格式化」glob 清单（`formatter.excluded` 的语义；IDEA 默认空表，
//     `ExcludedFiles.java` 没有预置项），存 localStorage，供格式化入口在发请求前问一次。
//   · `service/UntrustedFileFormattingServiceSuppressor.kt` —— 不受信任的项目里不格式化
//     （上游用户可见原因是「Project is not trusted」）。判据用本仓的 `src/trustedProjects.ts`，
//     与构建/运行/终端同一条信任链。
// 消费方：`src/semanticActions.ts` 的 `runFormatting`（重排当前文件 / 选区两条路都从那里走）。
//
// **明确不做**（上游有、本仓没有）：`AlignmentInColumnsHelper`/`AlignmentStrategy` 的
// 按列对齐（格式化模型的一部分，需要 PSI 级空白与换行模型）；`FormattingProgressTaskFactory`
// 的每文件独立进度条（本仓是一次请求，进度只登记一行后台任务）。
import { ref } from 'vue'
import { globToRegExp } from './analysisIgnore.ts'

/** 「不格式化」清单的存储键（`CodeStyleSettings` 里 `ExcludedFiles` 的那份状态）。 */
export const FORMAT_EXCLUDED_KEY = 'taocode.formatterExcluded'

function read(): string[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FORMAT_EXCLUDED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === 'string' && line.trim() !== '') : []
  } catch {
    return []
  }
}

function write(patterns: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FORMAT_EXCLUDED_KEY, JSON.stringify(patterns))
  } catch {
    // 存储不可用时只影响持久化，本次会话内照常生效。
  }
}

/** 当前「不格式化」清单（每行一条 glob；`#` 注释与空行在写入时丢掉）。 */
export const formatExcludedPatterns = ref<string[]>(read())

/**
 * `ExcludedFiles.addDescriptor` 的编辑器形态：从多行文本写清单。
 * 返回落下的条数（设置面据此给反馈）。
 */
export function setFormatExcludedPatterns(text: string): number {
  const parsed = text.split(/\r?\n/).map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  formatExcludedPatterns.value = parsed
  write(parsed)
  return parsed.length
}

/** `ExcludedFileFormattingRestriction.isFormatterAllowed`：命中清单即不允许。 */
export function isFileExcludedFromFormatting(path: string, patterns: readonly string[] = formatExcludedPatterns.value): boolean {
  const normalized = path.replace(/\\/g, '/')
  return patterns.some(pattern => globToRegExp(pattern).test(normalized))
}

/**
 * 格式化入口的准入判定：`null` = 放行，字符串 = 挡下并把它当提示。
 * `trusted` 为 false 时按 `UntrustedFileFormattingServiceSuppressor` 拦截。
 */
export function formattingRestrictionFor(
  path: string,
  options: { patterns?: readonly string[]; trusted?: boolean } = {},
): string | null {
  if (options.trusted === false) return '安全模式：项目尚未被信任，已阻止格式化。信任项目后才能重排代码。'
  if (isFileExcludedFromFormatting(path, options.patterns)) return `${path} 在「不格式化」清单里，已跳过格式化。`
  return null
}
