// 外部系统工程数据的**跨会话存储** —— 上游
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/ExternalProjectsDataStorage.java`
// 的可移植子集（`es/project-model` 判词第 ⑤ 条：「`ExternalProjectsDataStorage` 的跨会话结构持久化
// —— 外部工程数据缓存这一角仍缺」）。
//
// 用户可见行为（上游这一层到底改变了什么）：
//   · 打开一个已经同步过的工程时，Gradle 面板**先**拿出上次的工程结构与任务树（而不是等 CLI 跑完
//     才有一棵树），并标出这份数据是上次的（`load()`，`:129-184`）；
//   · 缓存里的结构**校验不过**（根节点的 `linkedExternalProjectPath` 与登记路径不一致，或结构为空）
//     ⇒ 这份不要，并且把该工程标脏、等着重导入（`validate`，`:203-209` + `:152-167`）；
//   · 已经拿到过「成功导入」的数据时，**旧缓存不许覆盖它**（`:146-157` 的 merge 规则）；
//   · `lastImportTimestamp != lastSuccessfulImportTimestamp` ⇒ 上次导入是失败的，标脏（`:158-160`）；
//   · 更新时新数据没有成功时间戳（-1）就沿用旧的（`:252-255`）；
//   · 存储文件不存在 ⇒ 空清单（不是「坏了」）；被判定失效 ⇒ 返回 null，调用方整批标脏
//     （`load(Project)`，`:417-428`）。
//   · 只有真变过才排一次保存（`changed` 的 CAS，`:212-229` + `:318-322`）。
//
// 架构不等价处（如实）：上游写的是 `VersionedFile`（`STORAGE_VERSION = 13`，`:86`）落在
// `PathManager` 的外部工程缓存目录；本仓没有宿主文件通道给这一层用（`file.write` 只写工作区内路径，
// 缓存目录在工作区外），所以落 `localStorage`，**按工作区根分键**（与
// `src/externalProjectModel.ts` 的任务激活表同一口径），版本号仍写进载荷（`STORAGE_VERSION`）。
// 反序列化只做**白名单键**（`PROJECT_KEYS` 里那十个的 dataClass），认不出的键整条丢弃 ——
// 上游 `SerializationException` 那条路径（`:226-228` catch + `LOG.error`）在本仓退成「这份不要」。

import {
  DataNode, PROJECT_KEYS, canonicalExternalPath, findProjectSystemId, projectSystemId, sameKey,
  type ExternalProjectInfo, type Key, type ProjectData,
} from './externalSystemModel.ts'
import type { ExternalProjectStore } from './externalProjectModel.ts'

/** 载荷版本（对齐上游 `ExternalProjectsDataStorage.STORAGE_VERSION`，`:86`；本仓从 1 起算）。 */
export const EXTERNAL_PROJECTS_STORAGE_VERSION = 1

export const externalProjectsDataKey = (workspaceRoot: string) =>
  `taocode.externalSystem.projectsData.${workspaceRoot.replace(/\\/g, '/')}`

/** 一条缓存条目（上游 `InternalExternalProjectInfo` 的可序列化投影）。 */
export interface StoredExternalProjectInfo {
  systemId: string
  externalProjectPath: string
  lastImportTimestamp: number
  lastSuccessfulImportTimestamp: number
  buildNumber: string
  /** 序列化后的结构（根节点为 PROJECT 键的那棵树）；null = 上次导入没拿到结构。 */
  structure: StoredDataNode | null
}

interface StoredDataNode {
  k: string
  d: Record<string, unknown>
  i?: true
  c?: StoredDataNode[]
}

const keyByName = new Map<string, Key<unknown>>()
for (const key of Object.values(PROJECT_KEYS)) keyByName.set(key.dataClass, key)

/** `ExternalProjectInfo` → 条目。owner 只存 id（`ProjectSystemId` 是 intern 过的，回来按 id 取）。 */
export function toStoredInfo(info: ExternalProjectInfo): StoredExternalProjectInfo {
  return {
    systemId: info.systemId.id,
    externalProjectPath: info.externalProjectPath,
    lastImportTimestamp: info.lastImportTimestamp,
    lastSuccessfulImportTimestamp: info.lastSuccessfulImportTimestamp,
    buildNumber: info.buildNumber,
    structure: info.structure ? serializeNode(info.structure) : null,
  }
}

function serializeNode(node: DataNode<unknown>): StoredDataNode {
  // `node.data` 是 `unknown`（`DataNode<unknown>`）：先按记录收窄再浅拷贝，
  // 否则 TS2698「spread 只能来自对象类型」——拷贝出来的仍是同一批字段。
  const data = { ...(node.data as Record<string, unknown>) }
  // owner 是对象（intern 过的 ProjectSystemId），存 id 就够。
  if (data.owner && typeof data.owner === 'object') data.owner = (data.owner as { id: string }).id
  const out: StoredDataNode = { k: node.key.dataClass, d: data }
  if (node.isIgnored()) out.i = true
  const children = node.children.map(serializeNode)
  if (children.length) out.c = children
  return out
}

/** 条目 → `ExternalProjectInfo`；认不出的键 / 缺字段 / owner 不是已注册的系统 ⇒ 返回 null（这份不要）。 */
export function fromStoredInfo(stored: StoredExternalProjectInfo): ExternalProjectInfo | null {
  if (!stored || typeof stored !== 'object') return null
  const system = findProjectSystemId(String(stored.systemId ?? '')) ?? null
  if (!system) return null
  const path = canonicalExternalPath(String(stored.externalProjectPath ?? ''))
  if (!path) return null
  const structure = stored.structure ? deserializeNode(stored.structure, system, null) : null
  // 上游 `validate`（`:203-209`）：结构存在时它的根数据必须指向同一个工程路径。
  if (structure && structure.data.linkedExternalProjectPath !== path) return null
  return {
    systemId: system,
    externalProjectPath: path,
    structure,
    lastImportTimestamp: Number.isFinite(stored.lastImportTimestamp) ? stored.lastImportTimestamp : 0,
    lastSuccessfulImportTimestamp: Number.isFinite(stored.lastSuccessfulImportTimestamp) ? stored.lastSuccessfulImportTimestamp : 0,
    buildNumber: typeof stored.buildNumber === 'string' ? stored.buildNumber : '',
  }
}

function deserializeNode(raw: StoredDataNode, system: ReturnType<typeof projectSystemId>, parent: DataNode<unknown> | null): DataNode<ProjectData> | null {
  const key = keyByName.get(String(raw.k ?? ''))
  if (!key) return null
  const data = { ...(raw.d && typeof raw.d === 'object' ? raw.d : {}) }
  data.owner = system
  const node = new DataNode<ProjectData>(key as Key<ProjectData>, data as unknown as ProjectData, parent)
  if (raw.i === true) node.setIgnored(true)
  for (const child of Array.isArray(raw.c) ? raw.c : []) {
    const next = deserializeNode(child, system, node)
    if (next) node.addChild(next)
  }
  return node
}

/**
 * 那份存储本体。与上游一致的两条纪律：
 *   · **merge 不许覆盖已成功的导入**（`:146-157`）；
 *   · 只有真变过才算 changed（`:318-322` 的 CAS 等价物：本仓用 `changed` 布尔 + 写入时比对）。
 */
export interface ExternalProjectsDataStorage {
  /** `load`：把存储里那份读进内存，返回**失效**的条目（调用方按上游 `markDirty` 处理）。 */
  load(store: ExternalProjectStore | null, workspaceRoot: string): { restored: ExternalProjectInfo[]; invalid: ExternalProjectInfo[] }
  /** `update(ExternalProjectInfo)`（`:231-261`）：合并 + 记 changed。 */
  update(info: ExternalProjectInfo): ExternalProjectInfo
  get(systemId: string, externalProjectPath: string): ExternalProjectInfo | null
  list(systemId?: string): ExternalProjectInfo[]
  /** `remove`（`:329-334`）。 */
  remove(systemId: string, externalProjectPath: string): boolean
  /** 结构校验（`:203-209`）：有结构、且根数据指向同一路径。 */
  validate: (info: ExternalProjectInfo) => boolean
  hasChanges(): boolean
  /** `doSave`（`:212-229`）：CAS 语义 —— 没变过就不写；写入前逐条 `validate`，不过的从清单里剔掉。 */
  save(store: ExternalProjectStore | null, workspaceRoot: string): boolean
  clear(): void
}

const entryKey = (systemId: string, externalProjectPath: string) =>
  `${systemId}::${canonicalExternalPath(externalProjectPath)}`

/** 结构校验（`validate`，`:203-209`）：有结构、且根数据指向同一个工程路径。 */
function validateInfo(info: ExternalProjectInfo): boolean {
  const structure = info.structure
  if (!structure) return false
  return canonicalExternalPath(structure.data.linkedExternalProjectPath ?? '') === canonicalExternalPath(info.externalProjectPath)
}

export function createExternalProjectsDataStorage(): ExternalProjectsDataStorage {
  const infos = new Map<string, ExternalProjectInfo>()
  let changed = false

  const touch = () => { changed = true }

  return {
    load(store, workspaceRoot) {
      infos.clear()
      changed = false
      const restored: ExternalProjectInfo[] = []
      const invalid: ExternalProjectInfo[] = []
      if (!store || !workspaceRoot) return { restored, invalid }
      let raw: string | null = null
      try { raw = store.getItem(externalProjectsDataKey(workspaceRoot)) } catch { return { restored, invalid } }
      if (!raw) return { restored, invalid }
      let parsed: { version?: number; projects?: unknown } | null = null
      try { parsed = JSON.parse(raw) } catch { parsed = null }
      // 载荷读坏（上游的 `SerializationException` / `isInvalidated` 两条路）⇒ 整批判失效。
      if (!parsed || !Array.isArray(parsed.projects)) return { restored, invalid: [] }
      for (const candidate of parsed.projects as StoredExternalProjectInfo[]) {
        const info = fromStoredInfo(candidate)
        if (!info || !validateInfo(info)) {
          if (info) invalid.push(info)
          continue
        }
        // `:146-157`：内存里已经有「成功导入过」的同键数据时，缓存那份不得覆盖它。
        const key = entryKey(info.systemId.id, info.externalProjectPath)
        const existing = infos.get(key)
        if (existing && existing.lastSuccessfulImportTimestamp > 0) continue
        infos.set(key, info)
        if (info.lastImportTimestamp !== info.lastSuccessfulImportTimestamp) invalid.push(info)
        restored.push(info)
      }
      return { restored, invalid }
    },
    update(info) {
      const key = entryKey(info.systemId.id, info.externalProjectPath)
      const old = infos.get(key)
      if (!old) infos.set(key, info)
      else {
        // `:245-257` 的 merge：结构取新的（新的没有就留旧的），
        // lastImport 取新的，成功时间戳为 -1/0 时沿用旧的。
        const merged: ExternalProjectInfo = {
          systemId: info.systemId,
          externalProjectPath: info.externalProjectPath,
          structure: info.structure ?? old.structure,
          lastImportTimestamp: info.lastImportTimestamp,
          lastSuccessfulImportTimestamp: info.lastSuccessfulImportTimestamp > 0 ? info.lastSuccessfulImportTimestamp : old.lastSuccessfulImportTimestamp,
          buildNumber: info.buildNumber || old.buildNumber,
        }
        infos.set(key, merged)
      }
      touch()
      return infos.get(key) ?? info
    },
    get(systemId, externalProjectPath) { return infos.get(entryKey(systemId, externalProjectPath)) ?? null },
    list(systemId) {
      const all = [...infos.values()].filter(info => !systemId || info.systemId.id === systemId)
      return all.sort((left, right) => left.externalProjectPath.localeCompare(right.externalProjectPath))
    },
    remove(systemId, externalProjectPath) {
      if (!infos.delete(entryKey(systemId, externalProjectPath))) return false
      touch()
      return true
    },
    validate: validateInfo,
    hasChanges() { return changed },
    save(store, workspaceRoot) {
      if (!changed || !store || !workspaceRoot) return false
      const valid = [...infos.values()].filter(info => validateInfo(info))
      // 与上游 `doSave`（`:393-403`）同一件事：写之前把不合法的那几条从内存清单里也剔掉。
      for (const info of [...infos.values()]) if (!validateInfo(info)) infos.delete(entryKey(info.systemId.id, info.externalProjectPath))
      changed = false
      try {
        store.setItem(externalProjectsDataKey(workspaceRoot), JSON.stringify({
          version: EXTERNAL_PROJECTS_STORAGE_VERSION,
          projects: valid.map(toStoredInfo),
        }))
        return true
      } catch {
        // 存不进去只是丢了跨会话缓存，本次会话的模型仍在（上游是 LOG.error，不让保存失败冒到 UI）。
        return false
      }
    },
    clear() { infos.clear(); changed = false },
  }
}

// ── 缓存 → 视图形状（上游：这份缓存喂的是 `ExternalProjectsViewImpl` 的那棵树）──────────
//
// 本仓的消费点是 `src/gradleHost.ts`：打开工程时把缓存里的结构直接灌进面板的
// `projects / tasks / dependencies` 三个视图数据，于是**同步还没跑完就有一棵树**
// （上游 `ExternalProjectsDataStorage.load` 的就是这件事；面板上另有一句「上次会话的结构」）。

// `PROJECT_KEYS` 与 `findDataNodes` / `visitDataNodes` 之外都在这里；`PROJECT_KEYS`、
// `DataNode` 已由文件头那一组 import 带进来（重复声明会让整个模块加载失败）。
import { findDataNodes, visitDataNodes, type DependencyCoordinateData, type DependencyScopeData, type ModuleData, type TaskData } from './externalSystemModel.ts'
import type { GradleDependency, GradleDependencyScope, GradleProjectNode, GradleTaskNode } from './gradle.ts'

/** 工程树：根工程 + 各模块（`ModuleData.id` 就是 Gradle 的 `:path`）。 */
export function restoredProjects(info: ExternalProjectInfo): GradleProjectNode[] {
  const out: GradleProjectNode[] = []
  const root = info.structure
  if (!root) return out
  out.push({ path: ':', name: root.data.externalName, depth: 0 })
  for (const node of findDataNodes(root, PROJECT_KEYS.MODULE)) {
    const module = node.data as unknown as ModuleData
    out.push({ path: module.id, name: module.externalName, depth: module.depth })
  }
  return out
}

/** 任务清单（`TaskData.name` 本来就是 `:app:build` 这种全名）。 */
export function restoredTasks(info: ExternalProjectInfo): GradleTaskNode[] {
  const out: GradleTaskNode[] = []
  if (!info.structure) return out
  visitDataNodes(info.structure, node => {
    if (node.key !== PROJECT_KEYS.TASK) return
    const task = node.data as unknown as TaskData
    out.push({ name: task.name, description: task.description, group: task.group })
  })
  return out
}

/** 依赖：作用域节点 + 它的坐标子树（层级按**树深**还原，不信存下来的 depth 字段）。 */
export function restoredDependencies(info: ExternalProjectInfo): GradleDependencyScope[] {
  const out: GradleDependencyScope[] = []
  if (!info.structure) return out
  for (const scopeNode of findDataNodes(info.structure, PROJECT_KEYS.DEPENDENCIES_GRAPH)) {
    const scope = scopeNode.data as unknown as DependencyScopeData
    const dependencies: GradleDependency[] = []
    const walk = (children: readonly DataNode<unknown>[], level: number) => {
      for (const child of children) {
        if (!sameKey(child.key, PROJECT_KEYS.LIBRARY_DEPENDENCY)) continue
        const coordinate = child.data as unknown as DependencyCoordinateData
        dependencies.push({
          name: coordinate.coordinate, depth: level, duplicate: Boolean(coordinate.duplicate),
          constraint: Boolean(coordinate.constraint), unresolved: coordinate.resolutionState === 'UNRESOLVED',
          resolved: coordinate.selectionReason ?? '',
        })
        walk(child.children, level + 1)
      }
    }
    walk(scopeNode.children, 0)
    out.push({
      configuration: scope.name, description: scope.description ?? '', unresolved: Boolean(scope.unresolved),
      empty: Boolean(scope.empty), project: scope.project, dependencies,
    })
  }
  return out.sort((left, right) => left.configuration.localeCompare(right.configuration))
}
