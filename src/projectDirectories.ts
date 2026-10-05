// 项目级路径与实例目录 —— 上游 `ide-core-impl/openapi/project/ex` 一族的 DOM/宿主侧等价物。
//
// 逐条对照（上游 `platform/ide-core-impl/src/com/intellij/openapi/project/ex/`）：
//   · `P3PathsEx.kt:16-46`：`PER_PROJECT_FOLDER = "INTERNAL_P3_FOLDER"`；
//     `projectLocationHash(dir) = dir.name + "_" + Integer.toHexString(dir.invariantSeparatorsPathString.hashCode())`
//     （注释里点名与 `com.intellij.configurationStore.ProjectStoreBase.getLocationHash` 同一算法）；
//     config/system/log/plugins 四类目录 = `${base}/INTERNAL_P3_FOLDER/${hash}`（plugins 是全局的）。
//   · `PerProjectInstancePaths.kt:18-96`：`PER_PROJECT_SUFFIX = "INTERNAL_perProject"`（`ProjectManagerEx.kt:41`），
//     实例目录 = `${base}/${PER_PROJECT_SUFFIX}/${项目路径去掉盘符根的相对路径}`；
//     子进程模式下把"当前项目目录"从基目录里剥掉再拼（`toBaseDirFromProject` 那一族）。
//   · `BaseProjectDirectoriesImpl.kt:26`：项目的基础目录集合（内容根的去重根集）——本仓单根工作区，
//     等价物就是工作区根（`src/workspaceLifecycle.ts` 的 workspace.root）。
//   · `ProjectNameProvider.java`：项目显示名的默认来源 = 目录名；本模块给同规则的纯函数。
//
// 本仓差异（如实写在族判词里）：状态与项目设置由宿主持有（`native/project_settings_state.cpp`
// 的 JSON），前端不按实例目录分家；这里落的是**模型与判据**，供面板/对话框取项目名与
// "按项目路径可复算的实例目录"（同一路径永远映射到同一个目录，与上游 hash 规则一致）。

/** `P3PathsEx.PER_PROJECT_FOLDER`。 */
export const PER_PROJECT_FOLDER = 'INTERNAL_P3_FOLDER'
/** `ProjectManagerEx.PER_PROJECT_SUFFIX`（`ProjectManagerEx.kt:41`）。 */
export const PER_PROJECT_SUFFIX = 'INTERNAL_perProject'

/** 路径归一：反斜杠转正斜杠、去掉重复分隔符与末尾斜杠（保留盘符根 `C:`）。 */
export function normalizeProjectPath(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (slashed === '/') return '/'
  return slashed.replace(/\/+$/, '')
}

/** `Path.name`：最后一段；盘符根（`C:`/`C:/`）返回 `C:`；根 `/` 返回空串。 */
export function projectDirectoryName(path: string): string {
  const normalized = normalizeProjectPath(path)
  if (!normalized || normalized === '/') return ''
  const parts = normalized.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * `ProjectNameProvider.getDefaultName(project)` 的默认规则：项目名 = 基础目录的目录名。
 * 目录名取不到（根/空串）时退回归一后的路径本身 —— 与上游"没有名字就用路径"同口径。
 */
export function defaultProjectName(path: string): string {
  return projectDirectoryName(path) || normalizeProjectPath(path)
}

/** Java `String.hashCode()`（32 位有符号整数，溢出按 int32 环绕）。 */
export function javaStringHashCode(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0
  return hash
}

/** `Integer.toHexString`：无符号十六进制、无前导零（32 位）。 */
export function toHexString(value: number): string {
  return (value >>> 0).toString(16)
}

/**
 * `P3PathsEx.projectLocationHash`：`目录名_路径hash`。同一路径永远同一结果，
 * 不同路径撞名也只多一位后缀（与上游同算法，便于对齐日志/迁移）。
 */
export function projectLocationHash(projectBaseDir: string): string {
  const absolute = normalizeProjectPath(projectBaseDir)
  return `${projectDirectoryName(absolute)}_${toHexString(javaStringHashCode(absolute))}`
}

/** 项目实例的四类目录（`P3PathsEx` 的 getConfigDir/getSystemDir/getLogDir/getPluginsDir）。 */
export interface ProjectInstancePaths {
  /** 项目自身的基础目录（工作区根）。 */
  projectBaseDir: string
  /** `<config>/INTERNAL_P3_FOLDER/<hash>`。 */
  configDir: string
  /** `<system>/INTERNAL_P3_FOLDER/<hash>`。 */
  systemDir: string
  /** `<log>/INTERNAL_P3_FOLDER/<hash>`。 */
  logDir: string
  /** 插件目录是全局的（`P3PathsEx.getPluginsDir` 返回 `PathManager.getPluginsDir()`）。 */
  pluginsDir: string
  /** 这套目录的 hash 段（判据与日志用）。 */
  locationHash: string
}

/**
 * `P3PathsEx` 的实例目录：四类基目录 + 项目路径 hash。`pluginsDir` 原样返回
 * （上游就是全局插件目录，不按项目分家）。
 */
export function perProjectP3Paths(
  projectBaseDir: string,
  baseDirs: { configDir: string; systemDir: string; logDir: string; pluginsDir: string },
): ProjectInstancePaths {
  const locationHash = projectLocationHash(projectBaseDir)
  return {
    projectBaseDir: normalizeProjectPath(projectBaseDir),
    configDir: joinProjectPath(joinProjectPath(baseDirs.configDir, PER_PROJECT_FOLDER), locationHash),
    systemDir: joinProjectPath(joinProjectPath(baseDirs.systemDir, PER_PROJECT_FOLDER), locationHash),
    logDir: joinProjectPath(joinProjectPath(baseDirs.logDir, PER_PROJECT_FOLDER), locationHash),
    pluginsDir: normalizeProjectPath(baseDirs.pluginsDir),
    locationHash,
  }
}

/** 目录拼接（像 `Path.resolve` 那样，不碰盘）。 */
export function joinProjectPath(base: string, child: string): string {
  const head = normalizeProjectPath(base)
  const tail = child.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!head) return tail
  if (!tail) return head
  return `${head}/${tail}`
}

/** `Path.root.relativize(absolute)`：去掉根之后的相对路径（`/home/x` → `home/x`；`C:/p` → `C:/p` 无根则原样）。 */
export function projectPathWithoutRoot(path: string): string {
  const absolute = normalizeProjectPath(path)
  if (/^[A-Za-z]:\//.test(absolute)) return absolute.slice(3)
  if (absolute.startsWith('/')) return absolute.replace(/^\/+/, '')
  return absolute
}

/**
 * `PerProjectInstancePaths.toPerProjectDir`：`${base}/${PER_PROJECT_SUFFIX}/${去掉根的相对路径}`。
 * 与 `P3PathsEx` 的 hash 方案是上游的两代实现，这里两个都留（旧实现仍被 `PerProjectInstancePaths`
 * 的调用方使用，日志与迁移要对得上）。
 */
export function perProjectInstancePath(baseDir: string, projectBaseDir: string): string {
  const relative = projectPathWithoutRoot(projectBaseDir)
  return joinProjectPath(joinProjectPath(baseDir, PER_PROJECT_SUFFIX), relative)
}

/**
 * `PerProjectInstancePaths.getLogDir` 的"日志在 system 之下"分支：log 以 system 为前缀时，
 * 先按新项目算出新的 system，再把相对部分接上去（上游 `:80-88`）。
 * 其余情况各自算（`adjustPathForNewProject` 的两支）。
 */
export function perProjectLogDir(
  projectBaseDir: string,
  baseDirs: { systemDir: string; logDir: string },
): string {
  const system = normalizeProjectPath(baseDirs.systemDir)
  const log = normalizeProjectPath(baseDirs.logDir)
  if (log === system || log.startsWith(`${system}/`)) {
    const nested = log.slice(system.length).replace(/^\/+/, '')
    const nextSystem = perProjectInstancePath(system, projectBaseDir)
    return nested ? joinProjectPath(nextSystem, nested) : nextSystem
  }
  return perProjectInstancePath(log, projectBaseDir)
}

/**
 * `BaseProjectDirectories` 的去重根集：一组内容根去掉互为祖先的重复项
 * （上游 `VirtualFilePrefixTree.getRoots()` 的语义：只留没有祖先在集合里的那些根）。
 */
export function baseProjectDirectories(roots: readonly string[]): string[] {
  const normalized = [...new Set(roots.map(normalizeProjectPath).filter(Boolean))].sort()
  return normalized.filter((root, index) => {
    for (let other = 0; other < normalized.length; other++) {
      if (other === index) continue
      const candidate = normalized[other]
      if (root === candidate) continue
      if (root.startsWith(`${candidate}/`)) return false
    }
    return true
  })
}
