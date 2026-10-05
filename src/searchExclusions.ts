// 搜索排除与工程排除目录的贯通 —— 上游 `FindInProjectSettings` 的作用域/排除语义在本仓的补齐。
//
// 背景：宿主扫描（`native/search.cpp`）只认三样东西 —— 面板上的 include/exclude 两个过滤框、
// 参数里已经切好的 glob 列表（`parse_patterns` 在 `search.cpp:370-382`：逗号/分号/空白分隔），
// 以及它**自带的**默认目录表（`.git`/`node_modules`/`build`/`dist`…，`search.cpp:46-49`）。
// 工程结构里配置的排除目录（`ProjectSettings.excludedDirs`，编辑面在
// src/components/ProjectStructurePane.vue，树与预览已经按它过滤）不在这张默认表里 ——
// 于是"在文件中查找"仍会扫进用户明确排除掉的目录。
//
// 这里把那份目录名折成排除模式（`**/<dir>/**`，带路径段的 glob 与原生 `glob_body` 的
// `**` 语义一致），SearchPanel 在拼 `search.*` 参数时并入 exclude 文本框的内容。
//
// **明确不做**：`.gitignore` 一类文件级排除源（上游靠 VCS 的 ignore 通道，本仓没有过滤层）；
// 按文件类型的排除（上游 PSI 的 `FindModel` 用 FileTypeIndex，本仓是文本扫描）。
import type { ProjectSettings } from './bridge'

/** 一个排除目录名 → 排除 glob（名字里带路径分隔符的条目按无效丢弃，与 bridge 的校验同一口径）。 */
export function projectExclusionPatterns(excludedDirs: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const dir of excludedDirs ?? []) {
    const name = dir.trim()
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) continue
    out.push(`**/${name}/**`)
  }
  return [...new Set(out)]
}

/**
 * 面板的 exclude 文本 + 工程排除模式 → 交给原生 `parse_patterns` 的一个字符串。
 * 用户自己写的规则保留在前（原样，不重排），工程模式去重后追加。
 */
export function mergeSearchExclude(excludeText: string, patterns: readonly string[]): string {
  const user = excludeText.trim()
  const merged = [...new Set(patterns.filter(pattern => pattern && !user.includes(pattern)))]
  return [user, ...merged].filter(Boolean).join(',')
}

/** 从项目设置里取排除目录（找不到/形状不对时给空表）。 */
export function excludedDirsOf(settings: ProjectSettings | null | undefined): string[] {
  const dirs = settings?.excludedDirs
  return Array.isArray(dirs) ? dirs.filter((dir): dir is string => typeof dir === 'string') : []
}
