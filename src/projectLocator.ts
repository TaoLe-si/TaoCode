// 项目定位 —— 上游 `platform/projectModel-impl/src/com/intellij/openapi/project/ProjectLocatorImpl.java`
// （按文件路径找它属于哪个打开的项目：候选按 base path 从长到短试，最近的祖先赢）与
// `com/intellij/project/project.kt` 的 `Project` 标识面（basePath/name 是项目身份）。
//
// 本仓是单根工作区（`native/workspace.cpp` + `src/workspaceLifecycle.ts`），但「这个路径属于哪个项目」
// 这件事在几处各写各的：`src/projectWidget.ts` 用 `project.path === currentRoot` 分组已打开项目、
// `src/filenameWidget.ts` 的 `insideContentRoot` 自己切前缀。这个模块把项目身份落成纯规则：
//   · `normalizeProjectRoot`（Windows 分隔符/尾斜杠/大小写归一）；
//   · `isSameProjectPath`（项目身份比较，Windows 大小写不敏感）；
//   · `locateProject`/`locateAllProjects`（最近的祖先赢，与 `ProjectLocatorImpl` 的路径序一致）；
//   · `projectNameFromRoot`（最近项目缺 displayName 时的目录名兜底）与 `projectRelativePath`。
//
// 明确不做（上游有、本仓没有）：多项目窗口与 `ProjectManager.openProjects` 的注册表
// （本仓单例工作区）、`.idea` 项目文件探测（`ProjectUtil.guessProjectDir` 沿目录找 `.idea`；
// 本仓打开目录即工作区）、`Project.isDisposed` 的生命周期对象。

/** 项目根归一：反斜杠 → 正斜杠、去掉尾部分隔符（保留盘符根 `D:/`）。 */
export function normalizeProjectRoot(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

/** 项目身份比较：Windows 大小写不敏感；两侧空值都视为「没有项目」。 */
export function isSameProjectPath(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) return false
  return normalizeProjectRoot(left).toLowerCase() === normalizeProjectRoot(right).toLowerCase()
}

/** 项目名：根路径的末段（上游 `RecentProjectMetaInfo.displayName` 缺省时也是这么兜底）。 */
export function projectNameFromRoot(path: string): string {
  const normalized = normalizeProjectRoot(path)
  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length) return normalized
  return segments[segments.length - 1]
}

/** `filePath` 是否在项目根之下（同根也算；大小写不敏感）。 */
export function projectContains(root: string, filePath: string): boolean {
  const base = normalizeProjectRoot(root).toLowerCase()
  const full = normalizeProjectRoot(filePath).toLowerCase()
  return full === base || full.startsWith(`${base}/`)
}

/** 项目内相对路径；不在项目里返回 null（上游 `VfsUtil.getRelativePath` 的对等物）。 */
export function projectRelativePath(root: string, filePath: string): string | null {
  if (!projectContains(root, filePath)) return null
  const base = normalizeProjectRoot(root)
  const full = normalizeProjectRoot(filePath)
  return full === base ? '' : full.slice(base.length + 1)
}

/**
 * 按文件路径定位项目（`ProjectLocatorImpl` 的等价物）：最长（最近）的根赢。
 * 传入的 roots 不要求已打开 —— 调用方决定候选集（本仓是最近项目/打开的工作区）。
 */
export function locateProject(filePath: string, roots: readonly string[]): string | null {
  return locateAllProjects(filePath, roots)[0] ?? null
}

/** 所有包含该路径的根，按「最近（最长）在前」排序（上游按 base path 长度试候选项）。 */
export function locateAllProjects(filePath: string, roots: readonly string[]): string[] {
  return roots
    .filter(root => projectContains(root, filePath))
    .sort((left, right) => normalizeProjectRoot(right).length - normalizeProjectRoot(left).length)
}

/** 去重后的项目根列表（归一后同名只留一个，保留首次出现的原文）。 */
export function uniqueProjectRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const root of roots) {
    const key = normalizeProjectRoot(root).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
}
