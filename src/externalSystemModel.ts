// 外部系统工程模型 —— 上游 `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/`
// 那一层：`ProjectSystemId`（按 id 注册的构建系统身份）、`Key`/`DataNode`（可按键寻址的数据树）、
// `ProjectKeys`（键注册表）、`ProjectData`/`ModuleData`/`TaskData`/`ProjectDependencies`（实体）、
// `ExternalProjectInfo`（一次导入后的工程信息，带导入时间戳）。
//
// 本仓现状（判决原文）：Gradle 的依赖/任务数据是 `src/gradleHost.ts` 里的普通对象，没有按
// `ProjectSystemId` 可寻址的模型，也没有 `DataNode` 数据树。这个模块把那份数据**建模**成上游的形状，
// 并让 `gradleHost` 在每次同步/依赖加载后登记：工具窗口渲染的 `taskGroups`/`dependencyGroups`
// 改为从模型读出（无模型时回退到原始纯函数），这样模型不是摆设而是渲染数据的来源。
//
// 明确不做（写在判词里的缺口）：`ExternalProject` 的服务端注册表（`ExternalProjectManager` 由
// `ExternalSystemManager` 扩展点驱动，本仓没有构建系统插件宿主）、Maven 侧的对等实现
// （本仓只有 Gradle 一条同步链）、`ExternalProjectRefresh` 的通用刷新队列（es/project-model 族）。
import { gradleTaskProject, type GradleDependency, type GradleDependencyScope, type GradleProjectNode, type GradleTaskNode } from './gradle.ts'

/** 上游 `ExternalSystemApiUtil.toCanonicalPath`：反斜杠归一、去尾部分隔符。比较与查表都用这个口径。 */
export function canonicalExternalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized === '' && path !== '' ? '/' : normalized
}

/** 上游 `ProjectSystemId`：按 id 单例（`ourExistingIds` 的 intern 语义）。 */
export interface ProjectSystemId {
  readonly id: string
  readonly readableName: string
}

const systemIds = new Map<string, ProjectSystemId>()

/** 上游两个构造器：只给 id 时 readableName = 首字母大写的 id（`StringUtil.capitalize(toLowerCase)`）。 */
export function projectSystemId(id: string, readableName?: string): ProjectSystemId {
  const existing = systemIds.get(id)
  if (existing) return existing
  const created: ProjectSystemId = { id, readableName: readableName ?? id.charAt(0).toUpperCase() + id.slice(1).toLowerCase() }
  systemIds.set(id, created)
  return created
}

/** 上游 `ProjectSystemId.findById`；没注册过返回 null（不隐式创建）。 */
export function findProjectSystemId(id: string): ProjectSystemId | null {
  return systemIds.get(id) ?? null
}

/** 本仓真正有导入链路的两个系统；`IDE` 是上游给 IDE 自身的保留 id，只登记不使用。 */
export const GRADLE_SYSTEM = projectSystemId('GRADLE', 'Gradle')
export const MAVEN_SYSTEM = projectSystemId('MAVEN', 'Maven')
export const IDE_SYSTEM = projectSystemId('IDE', 'IDE')

/** 上游 `Key`：`dataClass` + 处理权重；`equals` 只比 dataClass（不比较权重）。 */
export interface Key<T> {
  readonly dataClass: string
  readonly weight: number
  /** 只为 TS 端把 `Key<T>` 与数据形状绑起来；运行时不存在。 */
  readonly dataType?: T
}

export function createKey<T>(dataClass: string, weight: number): Key<T> {
  return { dataClass, weight }
}

export function sameKey(left: Key<unknown>, right: Key<unknown>): boolean {
  return left.dataClass === right.dataClass
}

/** 上游 `ProjectKeys` 的十条键（权重照抄，决定同层数据的处理顺序）。 */
export const PROJECT_KEYS = {
  MODULE: createKey<ModuleData>('ModuleData', 50),
  PROJECT: createKey<ProjectData>('ProjectData', 70),
  // 本仓没有 Library/ContentRoot/Configuration/Test 实体，这四条只作键注册表的一部分保留（不建节点）。
  LIBRARY: createKey<unknown>('LibraryData', 90),
  CONTENT_ROOT: createKey<unknown>('ContentRootData', 110),
  MODULE_DEPENDENCY: createKey<unknown>('ModuleDependencyData', 130),
  LIBRARY_DEPENDENCY: createKey<DependencyCoordinateData>('LibraryDependencyData', 150),
  TASK: createKey<TaskData>('TaskData', 250),
  CONFIGURATION: createKey<unknown>('ConfigurationData', 350),
  TEST: createKey<unknown>('TestData', 450),
  DEPENDENCIES_GRAPH: createKey<DependencyScopeData>('ProjectDependencies', 500),
} as const

/**
 * 上游 `DataNode`：parent/children + 按键向上查找数据。本仓没有 `UserDataHolder`，
 * 所以省掉用户数据与 `visitData`，保留建模需要的：createChild/addChild/getChildren/
 * getData(key)/getDataNode(key)/isIgnored 与深度优先访问。
 */
export class DataNode<T> {
  readonly key: Key<T>
  private value: T
  private parentNode: DataNode<unknown> | null
  private childNodes: DataNode<unknown>[] = []
  private ignored = false

  constructor(key: Key<T>, data: T, parent: DataNode<unknown> | null = null) {
    this.key = key
    this.value = data
    this.parentNode = parent
  }

  get data(): T { return this.value }
  setData(next: T): void { this.value = next }
  get parent(): DataNode<unknown> | null { return this.parentNode }
  get children(): readonly DataNode<unknown>[] { return this.childNodes }
  isIgnored(): boolean { return this.ignored }
  setIgnored(ignored: boolean): void { this.ignored = ignored }

  createChild<C>(key: Key<C>, data: C): DataNode<C> {
    const child = new DataNode(key, data, this)
    this.childNodes.push(child)
    return child
  }

  addChild(child: DataNode<unknown>): void {
    child.parentNode = this
    this.childNodes.push(child)
  }

  /** 上游 `getData(key)`：本节点或任一祖先上该键的数据。 */
  getData<C>(key: Key<C>): C | null {
    if (sameKey(this.key, key)) return this.value as unknown as C
    for (let node = this.parentNode; node; node = node.parentNode) {
      if (sameKey(node.key, key)) return node.data as C
    }
    return null
  }

  /** 上游 `getDataNode(key)`：本节点或任一祖先上该键的节点。 */
  getDataNode<C>(key: Key<C>): DataNode<C> | null {
    if (sameKey(this.key, key)) return this as unknown as DataNode<C>
    for (let node = this.parentNode; node; node = node.parentNode) {
      if (sameKey(node.key, key)) return node as DataNode<C>
    }
    return null
  }
}

/** 深度优先（前序）访问；visitor 返回 false 时不进入该节点的子树。 */
export function visitDataNodes(node: DataNode<unknown>, visitor: (node: DataNode<unknown>) => boolean | void): void {
  if (visitor(node) === false) return
  for (const child of node.children) visitDataNodes(child, visitor)
}

/** 整个子树上某个键的节点（前序）。 */
export function findDataNodes<C>(root: DataNode<unknown>, key: Key<C>): DataNode<C>[] {
  const out: DataNode<C>[] = []
  visitDataNodes(root, node => { if (sameKey(node.key, key)) out.push(node as unknown as DataNode<C>) })
  return out
}

// ── 实体（字段口径照上游，去掉本仓没有对应物的部分）─────────────────────────────

/** 上游 `AbstractExternalEntityData`：每条数据都带 owner（哪个构建系统）。 */
export interface ExternalEntityData { readonly owner: ProjectSystemId }

/** 上游 `ProjectData`。`ideProjectFileDirectoryPath` 在本仓等于链接目录（没有 .idea 目录概念）。 */
export interface ProjectData extends ExternalEntityData {
  externalName: string
  linkedExternalProjectPath: string
  ideProjectFileDirectoryPath: string
}

/** 上游 `ModuleData` 的可建模子集：id/path/名字/配置路径。 */
export interface ModuleData extends ExternalEntityData {
  id: string
  externalName: string
  linkedExternalProjectPath: string
  moduleFileDirectoryPath: string
  /** 树深度（Gradle `projects` 输出里的缩进），0 = 根工程。 */
  depth: number
}

/** 上游 `TaskData`：名字/描述/分组 + 所属工程路径。 */
export interface TaskData extends ExternalEntityData {
  name: string
  description: string
  group: string
  linkedExternalProjectPath: string
}

/** 上游 `ResolutionState`（RESOLVED/UNRESOLVED）；本仓再加 Gradle 的约束/重复标记。 */
export interface DependencyCoordinateData extends ExternalEntityData {
  coordinate: string
  /** `-> x.y` 的解析结果；没有就是空串（`DependencyNode.getSelectionReason` 的位置）。 */
  selectionReason: string
  resolutionState: 'RESOLVED' | 'UNRESOLVED'
  constraint: boolean
  duplicate: boolean
  depth: number
}

/** 上游 `ComponentDependencies` + `DependencyScopeNode` 的可建模子集：一个配置作用域。 */
export interface DependencyScopeData extends ExternalEntityData {
  /** 配置名（`compileClasspath`…）。 */
  name: string
  /** Gradle 原始工程头（`Root project 'demo'` / `:app`），渲染时直接显示。 */
  project: string
  description: string
  empty: boolean
  unresolved: boolean
  /** 输入里的序号：用它还原 `dependenciesByProject` 的“先见者先出”分组顺序。 */
  inputIndex: number
}

/** 上游 `ExternalProjectInfo`：一次导入的结果 + 两个时间戳。 */
export interface ExternalProjectInfo {
  systemId: ProjectSystemId
  externalProjectPath: string
  structure: DataNode<ProjectData> | null
  lastImportTimestamp: number
  lastSuccessfulImportTimestamp: number
  buildNumber: string
}

/** 上游 `ExternalProjectPojo`：按名字排序的 (name, path) 摘要（`compareTo` 只比 name）。 */
export interface ExternalProjectPojo { name: string; path: string }

export interface ExternalProjectStructureInput {
  systemId: ProjectSystemId
  projectPath: string
  projects: readonly GradleProjectNode[]
  tasks: readonly GradleTaskNode[]
  dependencies: readonly GradleDependencyScope[]
  /** 本次导入完成时刻（`gradleSync.at`）。 */
  importedAt: number
  /** 失败时的错误文本：结构与 `lastSuccessfulImportTimestamp` 保留上一次的。 */
  error?: string
  /** 上一次登记的信息（失败导入要保留成功导入的结构与时间戳）。 */
  previous?: ExternalProjectInfo | null
}

function moduleForScope(root: DataNode<ProjectData>, scope: GradleDependencyScope): DataNode<ModuleData> | null {
  const modules = findDataNodes(root, PROJECT_KEYS.MODULE)
  // Gradle 的 `Root project 'x'` 给名字、`Project ':app'` 给路径 —— 两种都要认。
  return modules.find(node => node.data.id === scope.project) ?? modules.find(node => node.data.externalName === scope.project) ?? null
}

function buildStructure(input: ExternalProjectStructureInput): DataNode<ProjectData> {
  const path = canonicalExternalPath(input.projectPath)
  const rootProject = input.projects.find(project => project.path === ':') ?? input.projects[0]
  const name = rootProject?.name || path.replace(/^.*\//, '') || path
  const root = new DataNode<ProjectData>(PROJECT_KEYS.PROJECT, {
    owner: input.systemId, externalName: name, linkedExternalProjectPath: path, ideProjectFileDirectoryPath: path,
  })
  const modules = new Map<string, DataNode<ModuleData>>()
  for (const project of input.projects) {
    const module: ModuleData = {
      owner: input.systemId, id: project.path, externalName: project.name,
      linkedExternalProjectPath: path, moduleFileDirectoryPath: project.path, depth: project.depth,
    }
    modules.set(project.path, root.createChild(PROJECT_KEYS.MODULE, module))
  }
  // 任务挂到 `gradleTaskProject` 判出的模块下（与 src/gradle.ts 的任务归属同一规则）；模块缺失时挂根。
  for (const task of input.tasks) {
    const owner = modules.get(gradleTaskProject(task.name)) ?? root
    const data: TaskData = {
      owner: input.systemId, name: task.name, description: task.description, group: task.group, linkedExternalProjectPath: path,
    }
    owner.createChild(PROJECT_KEYS.TASK, data)
  }
  // 依赖：作用域节点 + 按 depth 还原的坐标子树（上游 `ComponentDependencies` → `DependencyScopeNode`）。
  input.dependencies.forEach((scope, index) => {
    const parent = moduleForScope(root, scope) ?? root
    const scopeNode = parent.createChild(PROJECT_KEYS.DEPENDENCIES_GRAPH, {
      owner: input.systemId, name: scope.configuration, project: scope.project, description: scope.description,
      empty: scope.empty, unresolved: scope.unresolved, inputIndex: index,
    } satisfies DependencyScopeData)
    const stack: DataNode<DependencyCoordinateData>[] = []
    for (const dependency of scope.dependencies) {
      const data: DependencyCoordinateData = {
        owner: input.systemId, coordinate: dependency.name, selectionReason: dependency.resolved,
        resolutionState: dependency.unresolved ? 'UNRESOLVED' : 'RESOLVED',
        constraint: dependency.constraint, duplicate: dependency.duplicate, depth: dependency.depth,
      }
      const node = new DataNode(PROJECT_KEYS.LIBRARY_DEPENDENCY, data)
      const at = Math.max(0, Math.min(dependency.depth, stack.length))
      if (at === 0) scopeNode.addChild(node)
      else stack[at - 1]!.addChild(node)
      stack[at] = node
    }
  })
  return root
}

/**
 * 构造 `ExternalProjectInfo`（上游 `ExternalProjectDataService`/`ExternalProjectsDataStorage`
 * 在导入完成时做的登记）。失败导入不覆盖上一次成功的结构与 `lastSuccessfulImportTimestamp`
 * （上游 `ExternalSystemTaskNotificationListenerAdapter.onFailure` 保留成功导入的数据）。
 */
export function externalProjectInfoOf(input: ExternalProjectStructureInput): ExternalProjectInfo {
  const previous = input.previous ?? null
  const failed = Boolean(input.error)
  return {
    systemId: input.systemId,
    externalProjectPath: canonicalExternalPath(input.projectPath),
    structure: failed ? previous?.structure ?? null : buildStructure(input),
    lastImportTimestamp: input.importedAt,
    lastSuccessfulImportTimestamp: failed ? previous?.lastSuccessfulImportTimestamp ?? 0 : input.importedAt,
    // `ExternalProjectInfo.getBuildNumber`：本仓的导入输出里没有构建号，登记为空串而不是编造。
    buildNumber: '',
  }
}

/** 模型里的任务，按树的前序顺序（= 导入时的输出顺序）。 */
export function externalProjectTasks(info: ExternalProjectInfo): TaskData[] {
  if (!info.structure) return []
  return findDataNodes(info.structure, PROJECT_KEYS.TASK).map(node => node.data)
}

/** 与 `tasksByGroup` 同形：分组按首次出现排序（模型驱动渲染时用这个，不再过原始数组）。 */
export function externalProjectTaskGroups(info: ExternalProjectInfo): Array<{ group: string; tasks: GradleTaskNode[] }> {
  const groups = new Map<string, GradleTaskNode[]>()
  for (const task of externalProjectTasks(info)) {
    const row: GradleTaskNode = { name: task.name, description: task.description, group: task.group }
    const list = groups.get(task.group)
    if (list) list.push(row)
    else groups.set(task.group, [row])
  }
  return [...groups.entries()].map(([group, tasks]) => ({ group, tasks }))
}

/** 模型里的依赖作用域，按导入序号；坐标子树按前序还原成 `GradleDependency[]`。 */
export function externalProjectDependencyScopes(info: ExternalProjectInfo): GradleDependencyScope[] {
  if (!info.structure) return []
  const scopes = findDataNodes(info.structure, PROJECT_KEYS.DEPENDENCIES_GRAPH).map(node => {
    const dependencies: GradleDependency[] = []
    const walk = (parent: DataNode<unknown>, depthFromScope: number) => {
      for (const child of parent.children) {
        if (!sameKey(child.key, PROJECT_KEYS.LIBRARY_DEPENDENCY)) continue
        const coordinate = child.data as DependencyCoordinateData
        dependencies.push({
          name: coordinate.coordinate, depth: depthFromScope, duplicate: coordinate.duplicate,
          constraint: coordinate.constraint, unresolved: coordinate.resolutionState === 'UNRESOLVED',
          resolved: coordinate.selectionReason,
        })
        walk(child, depthFromScope + 1)
      }
    }
    walk(node, 0)
    const data = node.data
    return {
      configuration: data.name, description: data.description, unresolved: data.unresolved, empty: data.empty,
      project: data.project, dependencies, inputIndex: data.inputIndex,
    }
  })
  return scopes.sort((left, right) => left.inputIndex - right.inputIndex).map(({ inputIndex, ...scope }) => scope)
}

/** 与 `dependenciesByProject` 同形：工程分组按该工程最小序号排（“先见者先出”）。 */
export function externalProjectDependencyGroups(info: ExternalProjectInfo): Array<{ project: string; scopes: GradleDependencyScope[] }> {
  const grouped = new Map<string, { first: number; scopes: GradleDependencyScope[] }>()
  for (const scope of externalProjectDependencyScopes(info)) {
    const entry = grouped.get(scope.project)
    if (entry) entry.scopes.push(scope)
    else grouped.set(scope.project, { first: grouped.size, scopes: [scope] })
  }
  return [...grouped.entries()].map(([project, entry]) => ({ project, scopes: entry.scopes }))
}

/** 上游 `ExternalProjectPojo`：按名字排序的工程摘要（供“已链接的工程”列表用）。 */
export function externalProjectPojos(info: ExternalProjectInfo): ExternalProjectPojo[] {
  return externalProjectModules(info).map(module => ({ name: module.externalName, path: module.id }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** 模型里的模块（Gradle 的 `projects` 输出，根工程 depth 0）。 */
export function externalProjectModules(info: ExternalProjectInfo): ModuleData[] {
  if (!info.structure) return []
  return findDataNodes(info.structure, PROJECT_KEYS.MODULE).map(node => node.data)
}

/**
 * 上游 `ExternalProjectsDataStorage` 的前端等价物：按 (systemId, canonical path) 登记
 * `ExternalProjectInfo`。`gradleHost` 每次导入后往里写，视图数据从这里读。
 */
export interface ExternalProjectRegistry {
  setExternalProjectInfo(info: ExternalProjectInfo): void
  getExternalProjectInfo(systemId: ProjectSystemId | string, projectPath: string): ExternalProjectInfo | null
  getExternalProjects(systemId?: ProjectSystemId | string): ExternalProjectInfo[]
  removeExternalProjectInfo(systemId: ProjectSystemId | string, projectPath: string): void
  clear(): void
}

const registryKey = (systemId: ProjectSystemId | string, projectPath: string) =>
  `${typeof systemId === 'string' ? systemId : systemId.id}::${canonicalExternalPath(projectPath)}`

export function createExternalProjectRegistry(): ExternalProjectRegistry {
  const infos = new Map<string, ExternalProjectInfo>()
  return {
    setExternalProjectInfo(info) { infos.set(registryKey(info.systemId, info.externalProjectPath), info) },
    getExternalProjectInfo(systemId, projectPath) { return infos.get(registryKey(systemId, projectPath)) ?? null },
    getExternalProjects(systemId) {
      const all = [...infos.values()].filter(info => !systemId || info.systemId.id === (typeof systemId === 'string' ? systemId : systemId.id))
      return all.sort((left, right) => left.externalProjectPath.localeCompare(right.externalProjectPath))
    },
    removeExternalProjectInfo(systemId, projectPath) { infos.delete(registryKey(systemId, projectPath)) },
    clear() { infos.clear() },
  }
}
