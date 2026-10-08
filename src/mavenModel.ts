// Maven 侧工程模型 —— `es/project-model` 判词第 ② 条（「Maven 侧工程模型（本仓只有 Maven 设置页，
// 无同步链）」）在本仓**模型层**的落点。
//
// 上游依据（相对参考树根，逐条开过）：
//   · `MavenProject.kt:241` 的 `mavenId: MavenId`、`:249` 的 `parentId`、`:252` 的 `packaging`、
//     `:255` 的 `finalName`、`:258` 的 `defaultGoal`、`:261` 的 `buildDirectory`、`:269` 的
//     `outputDirectory`、`:272` 的 `testOutputDirectory`、`:230-237` 的 `name`（空则退回 artifactId）；
//   · `plugins/maven/model/src/main/java/org/jetbrains/idea/maven/model/MavenId.java:24-42`
//     的 `(groupId, artifactId, version)` 三元与 `:42-48` 的 `groupId:artifactId:version` 串；
//   · 多工程结构来自 `MavenProjectsManager` 的导入（本仓没有 Maven 同步后端 ⇒ 见下面「有界」）。
//
// **有界**：上游那套值来自 `mvn` 的 effective-pom 求值（父 POM 继承、`<properties>` 展开、
// profile 激活、BOM 导入）。本仓**不跑 mvn**、**不求值**，只读磁盘上真实存在的 `pom.xml` 正文里
// 直接写着的那几项：坐标、`packaging`、`<parent>`、`<modules>`、`<dependencies>`（含 `<scope>`）。
// 凡是靠求值才知道的（继承来的 groupId/version、`${...}` 属性、依赖的实际解析版本、profile），
// 本仓**如实留空或原样带出**（`${...}` 不猜、继承项标 `inherited: true`），不编一个看起来对的值。
//
// 消费链路：`src/externalSystemModel.ts` 的 `externalProjectInfoOf` 把这里的
// `GradleProjectNode`/`GradleDependencyScope` 形状折成 `ExternalProjectInfo`（`MAVEN_SYSTEM`），
// 再由 `src/externalSystemDataStorage.ts` 按 (systemId, path) 跨会话持久化 —— 与 Gradle 同一条
// 模型/存储链，只是数据来源是 pom 正文而不是 `gradle projects` 输出。
//
// 明确不做（判词里同样点名）：Maven 的**同步/导入后端**（没有 `mvn` 调用、没有 effective pom、
// 没有 profile 激活）、Maven 工具窗口（`MavenProjectsTree` 的 Swing 树本体）、依赖解析与下载、
// 运行目标自动发现里的 Maven 侧插件目标（`exec:java`/`spring-boot:run` 那一族）。

import type { GradleDependencyScope, GradleProjectNode } from './gradle.ts'
import { externalProjectInfoOf, MAVEN_SYSTEM, type ExternalProjectInfo } from './externalSystemModel.ts'

/** 上游 `MavenId`：`groupId`/`artifactId`/`version` 都可能缺（`:24-42`）。 */
export interface MavenId {
  groupId: string
  artifactId: string
  version: string
}

/** 上游 `MavenId.toString()`（`:42-48` 的 `groupId:artifactId:version`，缺项留空）。 */
export function mavenIdText(id: MavenId): string {
  return [id.groupId, id.artifactId, id.version].join(':')
}

/** 依赖的一条（`<dependency>` 直接写着的字段；解析版本要 effective pom ⇒ 不猜）。 */
export interface MavenDependencyDecl {
  groupId: string
  artifactId: string
  version: string
  /** `<scope>`；缺省是 `compile`（Maven 的默认 scope）。 */
  scope: string
  optional: boolean
}

/** 一份 pom 里直接写着的字段（求值才有的项按 `inherited`/空表示）。 */
export interface MavenPomModel {
  /** 工作区相对路径（`pom.xml` 或 `sub/pom.xml`）。 */
  path: string
  /** 所在目录（工作区相对；根 pom ⇒ 空串）。 */
  directory: string
  /** 上游 `MavenProject.mavenId`；靠父 POM 继承的项为空串（不求值）。 */
  id: MavenId
  /** 上游 `MavenProject.name`（`<name>` 缺省退回 artifactId，`:230-237`）。 */
  name: string
  /** 上游 `MavenProject.parentId`（`<parent>` 的坐标；没有就是 null）。 */
  parentId: MavenId | null
  /** 上游 `MavenProject.packaging`（缺省 `jar`，Maven 的默认打包）。 */
  packaging: string
  /** `<modules>` 里声明的子模块目录名（**原样**，不拼路径）。 */
  modules: string[]
  /** `<dependencies>` 直接声明的坐标。 */
  dependencies: MavenDependencyDecl[]
  /** `<artifactId>`/`<groupId>`/`<version>` 里含 `${...}` 的项名（属性未展开，如实登记）。 */
  unresolved: string[]
}

const POM_FILE = 'pom.xml'

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

const directoryOf = (path: string): string => {
  const slash = normalize(path).lastIndexOf('/')
  return slash < 0 ? '' : normalize(path).slice(0, slash)
}

/** 去掉 XML 注释与 CDATA 之外无关紧要的空白；保留正文供正则按标签取值。 */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '')
}

/** 取某个标签（**第一个**）的直接文本；找不到返回空串。命名空间前缀（`mvn:`）一并容忍。 */
function tagText(xml: string, tag: string): string {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i')
  const match = pattern.exec(xml)
  return match ? decodeEntities(match[1]!.trim()) : ''
}

/** 取某个标签在给定片段里的**直接子**文本（`<parent>` 里的 `<groupId>` 与根级同名标签要分开）。 */
function childText(fragment: string, tag: string): string {
  // 去掉嵌套的同名容器再取，避免 `<dependencies>` 里出现 `<groupId>` 时取到错误层级。
  return tagText(fragment, tag)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** 所有同名标签的正文（`<module>`/`<dependency>` 要多条）。 */
function tagBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'gi')
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) out.push(match[1]!)
  return out
}

/** 是否含未展开的属性占位（`${...}`）。 */
const hasPlaceholder = (value: string): boolean => /\$\{[^}]*\}/.test(value)

/**
 * 解析一份 `pom.xml` 的**直接字段**（`MavenProject` 那一族里不用求值就能读到的项）。
 * 入参 `path` 是工作区相对路径，用来算 `directory` 与 `modules` 的归属。
 */
export function parsePomModel(path: string, text: string): MavenPomModel {
  const xml = stripComments(text)
  // 根级 `groupId`/`version` 可能是继承来的：Maven 里它们常常只写在 `<parent>` 下，
  // 所以先把 `<parent>` 整段取出来，再从**没有 parent 段**的正文里取根级坐标 —— 否则会把
  // parent 的坐标误当成这个工程的坐标。
  const parentBlock = tagBlocks(xml, 'parent')[0] ?? ''
  const parentId: MavenId | null = parentBlock ? {
    groupId: childText(parentBlock, 'groupId'),
    artifactId: childText(parentBlock, 'artifactId'),
    version: childText(parentBlock, 'version'),
  } : null
  const withoutParent = xml.replace(/<(?:[A-Za-z0-9_.-]+:)?parent\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?parent>/i, '')
  const artifactId = tagText(withoutParent, 'artifactId')
  const groupId = tagText(withoutParent, 'groupId')
  const version = tagText(withoutParent, 'version')
  const name = tagText(withoutParent, 'name')
  const packaging = tagText(withoutParent, 'packaging') || 'jar'

  const unresolved: string[] = []
  for (const [field, value] of [['groupId', groupId], ['artifactId', artifactId], ['version', version]] as const) {
    if (value && hasPlaceholder(value)) unresolved.push(field)
  }

  // `<modules>` 只认 `<project><modules>` 下那一层：`tagBlocks(xml, 'modules')` 先取容器再取 `module`。
  const modules: string[] = []
  for (const container of tagBlocks(withoutParent, 'modules')) {
    for (const module of tagBlocks(container, 'module')) {
      const value = decodeEntities(module.trim())
      if (value && !modules.includes(value)) modules.push(value)
    }
  }

  const dependencies: MavenDependencyDecl[] = []
  for (const container of tagBlocks(withoutParent, 'dependencies')) {
    for (const block of tagBlocks(container, 'dependency')) {
      const depGroup = childText(block, 'groupId')
      const depArtifact = childText(block, 'artifactId')
      if (!depGroup && !depArtifact) continue
      const depVersion = childText(block, 'version')
      if (depGroup && hasPlaceholder(depGroup)) unresolved.push('dependency.groupId')
      if (depArtifact && hasPlaceholder(depArtifact)) unresolved.push('dependency.artifactId')
      if (depVersion && hasPlaceholder(depVersion)) unresolved.push('dependency.version')
      dependencies.push({
        groupId: depGroup, artifactId: depArtifact, version: depVersion,
        // Maven 默认 scope 是 `compile`（`MavenProject.DEFAULT_SCOPE` 的语义）。
        scope: childText(block, 'scope') || 'compile',
        optional: childText(block, 'optional').toLowerCase() === 'true',
      })
    }
  }

  return {
    path: normalize(path), directory: directoryOf(path),
    // 继承来的 groupId/version 留空（不求值）；artifactId 一般直接写着。
    id: { groupId, artifactId, version },
    name: name || artifactId,
    parentId, packaging, modules, dependencies,
    unresolved: [...new Set(unresolved)],
  }
}

/** 从文件清单里挑出 pom 路径（工作区相对、`/` 分隔）。 */
export function pomPaths(files: readonly string[]): string[] {
  return files
    .map(normalize)
    .filter(path => path === POM_FILE || path.endsWith(`/${POM_FILE}`))
}

/**
 * 读 pom 的端口（生产端是宿主 `file.read`；测试给一个从内存表取的回调）。
 * 读不到（返回 null）时那一份 pom 被跳过 —— **不编**它的坐标。
 */
export type PomReader = (path: string) => Promise<string | null> | string | null

/**
 * 把磁盘上的 pom 清单读成模型。读不到的 pom 跳过；没有任何 pom 时返回空数组。
 */
export async function readMavenPoms(files: readonly string[], read: PomReader): Promise<MavenPomModel[]> {
  const models: MavenPomModel[] = []
  for (const path of pomPaths(files)) {
    let text: string | null
    try { text = await read(path) } catch { text = null }
    if (text === null || text === undefined) continue
    models.push(parsePomModel(path, text))
  }
  return models
}

/**
 * 模块树（`GradleProjectNode` 形状，供 `externalSystemModel.externalProjectInfoOf` 复用同一条建树）：
 * 根 pom ⇒ `path = ':'`，子模块 ⇒ `:<目录名>`（Maven 的 reactor 里模块 id 就是相对目录）。
 * 深度按目录层数算，与 Gradle 那侧 `parseGradleProjects` 的 depth 同义。
 */
export function mavenProjectNodes(poms: readonly MavenPomModel[]): GradleProjectNode[] {
  const nodes: GradleProjectNode[] = []
  const sorted = [...poms].sort((left, right) => left.directory.length - right.directory.length || left.path.localeCompare(right.path))
  for (const pom of sorted) {
    const segments = pom.directory ? pom.directory.split('/') : []
    const path = pom.directory ? `:${segments.join(':')}` : ':'
    nodes.push({
      path,
      name: pom.name || pom.id.artifactId || segments[segments.length - 1] || path,
      depth: segments.length,
    })
  }
  return nodes
}

/**
 * 依赖作用域：Maven 的一条 `<dependency>` 归到它的 `<scope>`（`compile`/`test`/`provided`/`runtime`），
 * 每个 scope 出一个 `GradleDependencyScope`（形状与 Gradle 那侧同一份，好让模型层与视图共用）。
 * `resolved` 用 pom 里直接写着的 `<version>`；`${...}` 属性未展开时**原样带出**（不猜）。
 */
export function mavenDependencyScopes(poms: readonly MavenPomModel[]): GradleDependencyScope[] {
  const scopes: GradleDependencyScope[] = []
  for (const pom of poms) {
    for (const dep of pom.dependencies) {
      let scope = scopes.find(entry => entry.configuration === dep.scope)
      if (!scope) {
        scope = {
          configuration: dep.scope,
          project: pom.name || pom.id.artifactId || pom.directory || '(根项目)',
          description: `Maven ${dep.scope} 依赖（pom 直接声明）`,
          empty: false, unresolved: false, dependencies: [],
        }
        scopes.push(scope)
      }
      scope.dependencies.push({
        name: mavenIdText({ groupId: dep.groupId, artifactId: dep.artifactId, version: dep.version }),
        depth: 0,
        duplicate: false,
        constraint: dep.optional,
        // 版本靠父 POM/BOM 继承（pom 里没写）时不算「解析失败」——上游那叫 managed version。
        unresolved: false,
        resolved: dep.version,
      })
    }
  }
  return scopes
}

/** 一份 pom 有没有「靠继承才知道」的坐标（供面板如实提示「这里显示的是 pom 里直接写着的那部分」）。 */
export function pomNeedsEvaluation(pom: MavenPomModel): boolean {
  return pom.unresolved.length > 0 || (!pom.id.groupId && pom.parentId !== null)
}

/**
 * Maven 侧的一次「导入」：把读到的 pom 模型折成 `ExternalProjectInfo`（与 Gradle 同一条模型链，
 * 只是数据来源是 pom 正文）。`systemId` 固定 `MAVEN_SYSTEM`；`previous` 与失败保留语义交给
 * `externalProjectInfoOf`。这就是 `es/project-model` 判词里「Maven 侧对等模型」的落点：
 * 面板/存储读的是同一份 `ExternalProjectInfo`，不再只有 Gradle 一条链。
 */
export function mavenProjectInfoOf(input: {
  projectPath: string
  poms: readonly MavenPomModel[]
  importedAt: number
  error?: string
  previous?: ExternalProjectInfo | null
}): ExternalProjectInfo {
  return externalProjectInfoOf({
    systemId: MAVEN_SYSTEM,
    projectPath: input.projectPath,
    projects: mavenProjectNodes(input.poms),
    tasks: [],
    dependencies: mavenDependencyScopes(input.poms),
    importedAt: input.importedAt,
    error: input.error,
    previous: input.previous,
  })
}