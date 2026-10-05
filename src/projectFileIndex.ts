// 项目文件索引的**查询面**（上游 `ProjectFileIndex` / `WorkspaceFileIndex` 一族的可移植子集）。
//
// 上游形状（逐条核过）：
//   · `ProjectFileIndex.isInContent(file)` / `getSourceRootForFile` / `getModuleForFile`：
//     内容根之下算 in-content；源根是配置在模块上的（`ModuleRootManager.getSourceRoots`），
//     没有源根的文件（例如内容根直属文件）返回 null；
//   · `ExcludedRootFileIndexContributor`（`core/fileIndex/impl/ExcludedRootFileIndexContributor.kt`）：
//     排除根本身可见、但 `isInContent` 为假 —— 即"排除"是内容根里被挖掉的子树；
//   · `ProjectRootTestSourcesFilter.isTestSources`：测试源根（`JavaTestSourceRootEditHandler`）
//     之下的文件算测试内容，运行配置据此区分 main/test；
//   · `WorkspaceFileIndexDataImpl` 的增量：文件增删只动索引里的那一条，不重扫全盘。
//
// 本仓的输入是 `workspace.files` 的全量相对路径清单 + `JavaProjectSettings.sourcePaths`
// （配置的源根）+ `ProjectSettings.excludedDirs`（排除的目录名）+ 工作区名（单隐式模块的名字，
// 与 `src/scopes.ts` 的 `ScopeContext.moduleName` 同一口径）。**单根工作区**：内容根就是工作区根，
// 所以 `getContentRootForFile` 命中时返回 `contentRoot`（默认空串 = 工作区根，调用方自己拼绝对路径）；
// `getModuleForFile` 对内容里的文件返回模块名、对项目外（库/排除）返回 null —— 这条查询不造假对象。
//
// **与上游的偏差（如实）**：上游 `getSourceRootForFile` 只认**配置的**源根；本仓的渲染层拿不到
// 项目设置时（标签页右键菜单就是这种场合）退到**目录约定**（Maven/Gradle 布局）推导。有配置就用配置，
// 没配置才按约定 —— `sourceRootForPath` 的注释里写明了这条。
//
// 消费链路：`src/copyPathActions.ts` 的「来自源根的路径」（上游 `CopySourceRootPathProvider`，
// `CopyPathProvider.kt:143-148`：相对源根的路径，没有源根就不出这一条），宿主是
// `src/components/TabContextMenu.vue`（编辑器标签右键的「复制路径/引用…」子菜单）。

/** 索引的输入。 */
export interface ProjectFileIndexInput {
  /** `workspace.files` 的全量清单（工作区相对路径，正斜杠）。 */
  files: readonly string[]
  /** `JavaProjectSettings.sourcePaths` —— 配置的源根（工作区相对路径）。 */
  sourceRoots?: readonly string[]
  /** `ProjectSettings.excludedDirs` —— 按目录名排除（段匹配，大小写敏感，与桥接/原生一致）。 */
  excludedDirs?: readonly string[]
  /** 单隐式模块的名字（默认取工作区名；空串表示没有模块维度）。 */
  moduleName?: string
  /** 内容根（工作区相对路径；默认空串 = 工作区根）。 */
  contentRoot?: string
}

/** 一个文件/目录在索引里的归属。 */
export interface FileLocation {
  inProject: boolean
  inContent: boolean
  /** 命中的排除目录名；不在排除子树里为 null。 */
  excludedRoot: string | null
  /** 配置或按约定推出来的源根（工作区相对路径）；没有为 null。 */
  sourceRoot: string | null
  /** 内容根（单根工作区恒为 `contentRoot`）；项目外为 null。 */
  contentRoot: string | null
  /** 单隐式模块的名字；项目外为 null。 */
  module: string | null
  /** 文件在测试源根之下（`ProjectRootTestSourcesFilter`）。 */
  inTestSource: boolean
}

/** 规范化：反斜杠换正斜杠、去掉 `./` 前缀与尾部斜杠。 */
export function normalizeIndexPath(path: string): string {
  return (path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/** 上游 `ProjectRootsUtil.isExcludedFromProject`：任一路径段命中排除目录名就算排除。 */
function excludedSegment(path: string, excludedDirs: readonly string[]): string | null {
  if (!excludedDirs.length) return null
  for (const segment of normalizeIndexPath(path).split('/')) if (excludedDirs.includes(segment)) return segment
  return null
}

/** 目录约定里能被识别的源根后缀（顺序 = 最长优先）。 */
const CONVENTIONAL_ROOTS: readonly string[] = [
  'src/main/java', 'src/main/kotlin', 'src/main/groovy', 'src/main/scala',
  'src/test/java', 'src/test/kotlin', 'src/test/groovy', 'src/test/scala',
  'src/main/resources', 'src/test/resources', 'src',
]

function longestPrefixRoot(path: string, roots: readonly string[]): string | null {
  const normalized = normalizeIndexPath(path)
  let best: string | null = null
  for (const raw of roots) {
    const root = normalizeIndexPath(raw)
    if (!root) continue
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (!best || root.length > best.length) best = root
    }
  }
  return best
}

/**
 * 按目录约定从**路径本身**推源根（`getSourceRootForFile` 的约定侧；没有配置可用时用）。
 * 先按已知布局后缀匹配（`src/main/java` 等）；命中不到再向上找最近的
 * `.../<main|test>/<java|kotlin|groovy|scala|resources>` 形态；最后认顶层 `src`。
 * 推不出时返回 null（上游对"不在任何源根下"同样返回 null）。
 */
export function sourceRootFromConvention(path: string): string | null {
  const normalized = normalizeIndexPath(path)
  if (!normalized) return null
  const direct = longestPrefixRoot(normalized, CONVENTIONAL_ROOTS.filter(root => root !== 'src'))
  if (direct) return direct
  const segments = normalized.split('/')
  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const last = segments[index]!
    const parent = segments[index - 1]!
    if ((last === 'java' || last === 'kotlin' || last === 'groovy' || last === 'scala' || last === 'resources')
      && (parent === 'main' || parent === 'test')) {
      return segments.slice(0, index + 1).join('/')
    }
  }
  return longestPrefixRoot(normalized, ['src'])
}

/** `getSourceRootForFile` 的独立形态：有配置用配置，没有才按约定。 */
export function sourceRootFor(path: string, configuredRoots: readonly string[] = []): string | null {
  return longestPrefixRoot(path, configuredRoots) ?? sourceRootFromConvention(path)
}

/** 测试源根判定（`ProjectRootTestSourcesFilter`）：路径里有 `test`/`tests` 段且不是 `test-resources` 之外的资源根。 */
export function isTestSourceRoot(root: string): boolean {
  const segments = normalizeIndexPath(root).split('/')
  return segments.some(segment => segment === 'test' || segment === 'tests')
}

/** 索引实例（含一条文件的增量增删）。 */
export interface ProjectFileIndex {
  readonly moduleName: string
  readonly contentRoot: string
  readonly files: readonly string[]
  /** 上游 `ProjectFileIndex.isInProject`：工作区清单里能找到它（目录按前缀算）。 */
  isInProject(path: string): boolean
  /** 上游 `ProjectFileIndex.isInContent`：内容根之下且不在排除子树里。 */
  isInContent(path: string): boolean
  /** `ExcludedRootFileIndexContributor`：排除根之下。 */
  isExcluded(path: string): boolean
  /** 命中的排除目录名（没有为 null）。 */
  getExcludedRoot(path: string): string | null
  /** 上游 `getSourceRootForFile`。 */
  getSourceRootForFile(path: string): string | null
  /** 单根工作区的内容根；项目外为 null。 */
  getContentRootForFile(path: string): string | null
  /** 单隐式模块名；内容外为 null。 */
  getModuleForFile(path: string): string | null
  /** 测试源根之下的文件（`ProjectRootTestSourcesFilter.isTestSources`）。 */
  isInTestSourceContent(path: string): boolean
  /** 一次查询拿全部归属（查询面是只读的；索引内部可变是为了增量）。 */
  locate(path: string): FileLocation
  /** 增量：加一条（已存在则原样）。 */
  addFile(path: string): void
  /** 增量：删一条。 */
  removeFile(path: string): void
}

export function createProjectFileIndex(input: ProjectFileIndexInput): ProjectFileIndex {
  const sourceRoots = [...(input.sourceRoots ?? [])]
  const excludedDirs = [...(input.excludedDirs ?? [])]
  const moduleName = input.moduleName ?? ''
  const contentRoot = normalizeIndexPath(input.contentRoot ?? '')
  const files = new Set<string>()
  for (const raw of input.files ?? []) {
    const path = normalizeIndexPath(raw)
    if (path) files.add(path)
  }
  const listed = (path: string) => {
    const normalized = normalizeIndexPath(path)
    if (!normalized) return true
    if (files.has(normalized)) return true
    const prefix = `${normalized}/`
    for (const file of files) if (file.startsWith(prefix)) return true
    return false
  }
  const locate = (path: string): FileLocation => {
    const normalized = normalizeIndexPath(path)
    const excluded = excludedSegment(normalized, excludedDirs)
    const inProject = listed(normalized)
    const underContentRoot = contentRoot === '' || normalized === contentRoot || normalized.startsWith(`${contentRoot}/`)
    const inContent = inProject && excluded === null && underContentRoot
    // 上游只对内容里的文件算源根；项目外/排除子树里的一律 null。
    const sourceRoot = inContent ? sourceRootFor(normalized, sourceRoots) : null
    return {
      inProject,
      inContent,
      excludedRoot: excluded,
      sourceRoot,
      contentRoot: inContent ? contentRoot : null,
      module: inContent ? moduleName : null,
      inTestSource: inContent && sourceRoot !== null && isTestSourceRoot(sourceRoot),
    }
  }
  return {
    moduleName,
    contentRoot,
    get files() { return [...files] },
    isInProject: path => locate(path).inProject,
    isInContent: path => locate(path).inContent,
    isExcluded: path => locate(path).excludedRoot !== null,
    getExcludedRoot: path => locate(path).excludedRoot,
    getSourceRootForFile: path => locate(path).sourceRoot,
    getContentRootForFile: path => locate(path).contentRoot,
    getModuleForFile: path => locate(path).module,
    isInTestSourceContent: path => locate(path).inTestSource,
    locate,
    addFile(path: string) { const normalized = normalizeIndexPath(path); if (normalized) files.add(normalized) },
    removeFile(path: string) { files.delete(normalizeIndexPath(path)) },
  }
}
