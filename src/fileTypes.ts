// 文件类型关联（IDEA `preferences.fileTypes` / FileTypeConfigurable 的「已注册模式」）的校验。
//
// 三处必须同规则，所以抽成纯函数：设置页（`FileTypesPage.vue`）、浏览器预览的
// `project.settings.update`（src/bridge.ts）、原生 `validate_file_associations`
// （native/settings_schema.cpp:476-492）。
//
// 规则：键是小写字母数字（不含点），最长 16 字符；值是 TaoCode 能高亮的四种语言之一。
import { EDITOR_LANGUAGES } from './languages.ts'

export interface AssociationEntry { extension: string; language: string }

export const EXTENSION_MAX = 16

/** 键规则：与原生一致（`^[a-z0-9]{1,16}$`，不含点）。 */
export function validExtension(extension: string): boolean {
  return /^[a-z0-9]{1,16}$/.test(extension)
}

export function validLanguage(language: string): boolean {
  return (EDITOR_LANGUAGES as readonly string[]).includes(language)
}

/** 返回第一条不合法的说明；全部合法时返回 null。 */
export function validateFileAssociations(entries: Record<string, string>): string | null {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return '文件类型关联必须是一个对象。'
  const seen = new Set<string>()
  for (const [extension, language] of Object.entries(entries)) {
    if (!validExtension(extension)) return `扩展名只能是小写字母或数字（不含点），最长 ${EXTENSION_MAX} 个字符：${extension}`
    if (!validLanguage(language)) return `未知语言：${language}`
    if (seen.has(extension)) return `扩展名重复：${extension}`
    seen.add(extension)
  }
  return null
}

/** 行表 → 存储对象（键排序，便于比较与展示）。 */
export function associationsFromRows(rows: readonly AssociationEntry[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) result[row.extension.trim()] = row.language
  return result
}

/** 存储对象 → 行表（按扩展名排序，与 IDEA 的 File Types 列表一致）。 */
export function rowsFromAssociations(entries: Record<string, string> | null | undefined): AssociationEntry[] {
  return Object.entries(entries ?? {}).map(([extension, language]) => ({ extension, language }))
    .sort((a, b) => a.extension.localeCompare(b.extension))
}
