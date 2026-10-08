// 链接进来的构建工程（Gradle / Maven）→ 模块的**内容根**与**排除根**：合并、去重（祖先规则）、排除优先。
//
// 这一域要补的是「链接了工程，根模型却不知道那些目录是内容根」：本仓的面板与查询面过去只有
// 一条隐式内容根（工作区根），链接进来的 Gradle 目录（`.idea/gradle.xml` 的那张表 ⇄
// `ProjectSettings.buildTools.gradle.linkedProjects`）与 Maven 的 pom 目录对根模型**不可见**，
// 于是多工程仓库（AE2 那种「工作区根目录没有构建脚本、工程在子目录」的形态）在树上只有一行根。
//
// 上游依据（本轮逐条打开数过行号，相对 `D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · Maven 的内容根 = **pom 所在目录**，且**已有外层内容根时不再加**：
//     `plugins/maven/src/main/java/org/jetbrains/idea/maven/importing/MavenRootModelAdapterLegacyImpl.java:100-103`
//     （`initContentRoots()`：`toUrl(myMavenProject.getDirectory())` → `if (getContentRootFor(url) != null) return;`
//     → `addContentEntry(...)`）与同文件 `:106-109`（`getContentRootFor` 用
//     `VfsUtilCore.isEqualOrAncestor(entryUrl, url)` 判「已有一条是它的祖先或它自己」⇒ 命中就不加）。
//     **所以嵌套的 pom 目录不会各出一条内容根** —— 外层那条已经把它整棵盖住了（本模块 `mergeContentRoots` 的祖先规则就是这条）。
//   · Maven 的 pom 文件名：`plugins/maven-server-api/src/main/java/org/jetbrains/idea/maven/model/MavenConstants.java:21`
//     （`public static final String POM_XML = "pom.xml";`）。
//   · Gradle 的内容根与排除根来自 Tooling API：
//     `plugins/gradle/src/org/jetbrains/plugins/gradle/service/project/CommonGradleProjectResolverExtension.java:296`
//     （`populateModuleContentRoots`）、`:310`（`gradleModule.getContentRoots()`）、`:315`（`getRootDirectory()`）、
//     `:330-334`（`getExcludeDirectories()` 的每一项 `storePath(ExternalSystemSourceType.EXCLUDED, …)`）。
//   · **编译输出目录是排除根**（不是内容根的一部分）：同文件 `:396-408`
//     （`buildDirPath` = 工程的 build 目录；`FileUtil.isAncestor(path, buildDirPath, true)` ⇒
//     `storePath(EXCLUDED, buildDirPath)`），Maven 侧同一件事由 `…setExcludeOutput(true)` 表达
//     （`MavenRootModelAdapterLegacyImpl.java:96` 与 `:274`/`:278`），且**默认就是 true**：
//     `platform/workspace/jps/src/com/intellij/platform/workspace/jps/bridge/impl/java/JpsJavaModuleExtensionBridge.kt:43`
//     （`isExcludeOutput(): Boolean = javaSettingsEntity?.excludeOutput ?: true`）。
//   · 「排除」的语义是「内容根里被挖掉的子树」：`platform/projectModel-impl/src/com/intellij/workspaceModel/core/fileIndex/impl/ExcludedRootFileIndexContributor.kt`
//     （本体存在，语义沿用 `src/projectFileIndex.ts:7-8` 已核对的那条：排除根之下 `isInContent` 为假）。
//
// **与上游的两处不等价**（本仓后端给的约束，写清楚免得被当抄漏）：
//   1. 上游链接工程时把**绝对路径**存进 `.idea/gradle.xml`，本仓存的是工作区相对路径
//      （`src/gradle.ts:787` 的 `linkedProjects`）；所以这里的输入与输出都按相对路径算，跨工作区的工程链接本仓表达不了。
//   2. 上游 Maven 的多工程结构来自 `mvn` 导入（本仓没有 Maven 同步后端，`docs/batch-2026-10-06-bucket15.md`
//      的 es/* 行已判 `[-]`）⇒ 这里只从磁盘清单上**真实存在的 `pom.xml`** 求出工程目录，
//      不去解析 pom 的 `<modules>`/`<parent>`（那要读正文并按 Maven 语义求值，猜不得）。

import { isUsableRootPath, normalizeRootPath } from './projectRoots.ts'

/** `MavenConstants.POM_XML`（`MavenConstants.java:21`）—— 只按**文件名**判，不认 `pom.scala` 那一族（`:23` 的 `POM_NAMES` 是别的构建系统用的）。 */
export const MAVEN_POM_FILE = 'pom.xml'

/** 一条排除根（`ContentEntry.getExcludeFolders()` 的一条，或输出目录那条）。 */
export interface ExcludeRootEntry {
  readonly path: string
  /** 命中它的那个目录名（`projectRoots.excludedByNames` 的口径）或规则名（输出目录那档）。 */
  readonly name: string
  /** 排除的来源，面板据此说清「按目录名排除」还是「编译输出目录」。 */
  readonly rule: 'name' | 'output'
}

/** 路径的前缀（祖先）判定：`isEqualOrAncestor(ancestor, path)` 的工作区相对路径版。 */
export function isAncestorPath(ancestor: string, path: string): boolean {
  const a = normalizeRootPath(ancestor)
  const p = normalizeRootPath(path)
  if (!a) return true            // 工作区根（空串）是所有路径的祖先
  return a === p || p.startsWith(`${a}/`)
}

/**
 * 内容根的合并：规范化 → 去重 → **祖先规则**（已有内容根是它的祖先或它自己时不再加，
 * `MavenRootModelAdapterLegacyImpl.java:102/:108`）。
 *
 * 保持**先来者赢**与输入顺序：上游 `initContentRoots()` 也是「先看现有条目里有没有盖住它的」，
 * 所以同一批目录谁先进来由调用方决定（这里按传入顺序处理）。
 */
export function mergeContentRoots(candidates: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of candidates) {
    const path = normalizeRootPath(raw)
    if (path && !isUsableRootPath(path)) continue   // 绝对路径 / `..` / 空段：不能当根（同 `projectRoots.isUsableRootPath`）
    if (out.some(accepted => isAncestorPath(accepted, path))) continue
    out.push(path)
  }
  return out
}

/** 清单里每个 `pom.xml` 的**所在目录**（根 pom ⇒ 空串）；顺序稳定、去重。 */
export function mavenProjectDirs(files: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of files) {
    const path = normalizeRootPath(raw)
    const slash = path.lastIndexOf('/')
    const name = slash < 0 ? path : path.slice(slash + 1)
    if (name !== MAVEN_POM_FILE) continue
    const dir = slash < 0 ? '' : path.slice(0, slash)
    if (!out.includes(dir)) out.push(dir)
  }
  return out
}

export interface BuildContentRootsInput {
  /** `ProjectSettings.buildTools.gradle.linkedProjects`（工作区相对目录，`''` = 工作区根）。 */
  linkedGradleDirs?: readonly string[]
  /** `workspace.files` 的全量清单：Maven 的 pom 目录由它求。 */
  files?: readonly string[]
  /** 关掉 Maven 那一半（默认开：清单里真有 pom 才算，没有就一条都不出）。 */
  maven?: boolean
}

/**
 * 链接进来的构建工程目录（Gradle 链接表 + Maven 的 pom 目录），已按祖先规则合并。
 * 一条都没有时返回**空数组** —— 调用方决定怎么兜底（`rootsModel.buildRootModel` 保留「工作区根当唯一内容根」
 * 这条既有地板，见那边文件头的第 2 条不等价）。
 */
export function buildContentRoots(input: BuildContentRootsInput): string[] {
  const gradle = (input.linkedGradleDirs ?? []).map(normalizeRootPath)
  const maven = input.maven === false ? [] : mavenProjectDirs(input.files ?? [])
  return mergeContentRoots([...gradle, ...maven])
}

export interface OutputExcludeInput {
  /** `JavaProjectSettings.outputPath`（生产输出；空串 = 没配）。 */
  outputPath?: string
  /** 测试输出（本仓没有存储字段，调用方给了才算，见 `src/rootsModel.ts` 文件头第 4 条）。 */
  testOutput?: string
  /** 内容根集合：输出目录必须在某条内容根之下，否则谈不上「从内容里挖掉」。 */
  contentRoots?: readonly string[]
  /** `CompilerModuleExtension.isExcludeOutput()`：上游默认 true（`JpsJavaModuleExtensionBridge.kt:43`）。 */
  excludeOutput?: boolean
}

/**
 * 编译输出目录当排除根（`CommonGradleProjectResolverExtension.java:407-408` 把 build 目录
 * `storePath(EXCLUDED, …)`；Maven 侧 `setExcludeOutput(true)` 同一件事）。
 *
 * 只认**配置里写下的输出路径**：没配就不猜 `build`/`out`/`target`（那是目录名表那条路，
 * 见 `src/projectRoots.ts:66-70`，两条各自的出处不同，不能混着编）。
 */
export function outputExcludeRoots(input: OutputExcludeInput): ExcludeRootEntry[] {
  if (input.excludeOutput === false) return []
  const roots = input.contentRoots ?? []
  const out: ExcludeRootEntry[] = []
  for (const raw of [input.outputPath ?? '', input.testOutput ?? '']) {
    const path = normalizeRootPath(raw)
    if (!path || !isUsableRootPath(path)) continue
    if (!roots.some(root => isAncestorPath(root, path))) continue
    if (out.some(entry => entry.path === path)) continue
    const slash = path.lastIndexOf('/')
    out.push({ path, name: slash < 0 ? path : path.slice(slash + 1), rule: 'output' })
  }
  return out
}

/** 排除优先：路径落在任一条排除根之下（含它自己）就是「被排除」。 */
export function excludedBy(path: string, excludeRoots: readonly ExcludeRootEntry[]): ExcludeRootEntry | null {
  const normalized = normalizeRootPath(path)
  // 最深的那条优先（多条排除根嵌套时，说得出"被哪一条直接盖住"）。
  let hit: ExcludeRootEntry | null = null
  for (const entry of excludeRoots) {
    if (!isAncestorPath(entry.path, normalized)) continue
    if (!hit || entry.path.length > hit.path.length) hit = entry
  }
  return hit
}

/**
 * 「这条路径在不在模块内容里」—— 上游 `ProjectFileIndex.isInContent` 的根集合版：
 * **必须落在某条内容根之下，且不落在任何排除根之下**（排除优先，见文件头 `ExcludedRootFileIndexContributor` 那条）。
 */
export function isInModuleContent(path: string, contentRoots: readonly string[], excludeRoots: readonly ExcludeRootEntry[]): boolean {
  const normalized = normalizeRootPath(path)
  if (!contentRoots.some(root => isAncestorPath(root, normalized))) return false
  return excludedBy(normalized, excludeRoots) === null
}
