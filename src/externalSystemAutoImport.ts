// 外部系统自动导入 API（上游 `platform/external-system-api/.../autoimport` 与 `autolink` 一族的可移植子集）。
//
// 上游逐类（本文件按类名对照，语义差异都写在方法上）：
//   · `ExternalSystemModificationType.kt`：EXTERNAL / INTERNAL / HIDDEN / UNKNOWN —— HIDDEN 语义上
//     近 INTERNAL，但**即使选「任何更改」也不自动重载**。
//   · `ExternalSystemProjectId.kt`：`(ProjectSystemId, externalProjectPath)`，`projectName` = 路径末段，
//     `toString()` = `<系统可读名> (<项目名>)`。
//   · `ExternalSystemProjectListener.kt`：`onProjectReloadStart` / `onProjectReloadFinish(status)` /
//     `onSettingsFilesListChange`。
//   · `ExternalSystemProjectAware.kt`：插件/构建系统的登记项 —— `projectId`、`settingsFiles`、
//     `reloadProject(context)`，以及四个可覆写钩子：`isIgnoredSettingsFileEvent`（默认忽略
//     JUST_STARTED 与「JUST_FINISHED 且 CREATE」）、`adjustModificationType`、`isDisabledReload`、
//     `isDisabledAutoReload`。
//   · `ExternalSystemProjectTracker.kt`：`register`/`activate`/`remove`/`markDirty`/
//     `markDirtyAllProjects`/`markDirtyInternal`/`scheduleProjectRefresh`。调度口径：
//       markDirty（未定义修改）→ ALL/SELECTIVE 排重载，NONE 出通知；
//       markDirtyInternal（内部修改）→ 只有 ALL 排重载，SELECTIVE/NONE 出通知；
//       scheduleProjectRefresh 不看设置（强制只刷已脏的）。
//   · `ExternalSystemProjectTrackerSettings.kt`：`AutoReloadType` 三档。
//   · `ExternalSystemRefreshStatus.kt`：SUCCESS / FAILURE / CANCEL。
//   · `ExternalSystemSettingsFilesModificationContext.kt`：事件聚合（CREATE+UPDATE→CREATE、
//     UPDATE+DELETE→DELETE）与 ReloadStatus（IDLE/IN_PROGRESS/JUST_STARTED/JUST_FINISHED）。
//   · `ExternalSystemSettingsFilesReloadContext.kt`：自上轮重载以来的 created/updated/deleted 路径集合。
//   · `ExternalSystemProjectNotificationAware.kt`：通知面 —— notify/expire/expire(id)/isNotificationVisible
//     /getSystemIds，变化时广播（本仓用回调，没有 message bus）。
//   · `ExternalSystemAutoImportAwareListener.kt`：一次「自动导入相关操作」的开始/结束（上游给 LSP 等
//     长操作当临时看门狗用）。
//   · `autolink/ExternalSystemUnlinkedProjectAware.kt`：按 systemId 的未链接工程登记项 ——
//     `isBuildFile`/`isLinkedProject`/`linkAndLoadProject`/`unlinkProject`/`subscribe`，
//     以及 `unlinkOtherLinkedProjects`（链接一个系统时把同一路径上别的系统的链接解除）。
//   · `autolink/ExternalSystemProjectLinkListener.kt`：onProjectLinked/onProjectUnlinked。
//   · `autolink/ExternalSystemUnlinkedProjectSettings.kt`：`isEnabledAutoLink` 总开关。
//   · `autolink/ExtensionPointUtil.kt`：逐个扩展 try/catch 的调用器（`runExtensionSafe` 一族）。
//
// 本仓没有插件扩展点宿主（esa/service 判 `[-]`），所以登记项与扩展列表都由宿主代码直接构造；
// 但状态机本身照上游语义实现，真实消费链路是 `src/gradleHost.ts` —— 构建脚本改动经 tracker 决定
// 「自动重载 / 出通知（NONE 或选择性下的 IDE 内改动）」，重载开始/结束驱动监听器；未链接工程的
// 链接/解除也走 autolink 登记表。设置存储（`ExternalSystemUnlinkedProjectSettings` 的持久化）本仓
// 还没有 —— 由调用方传布尔（见 gradleHost 的注释）。

/** `ExternalSystemModificationType`。 */
export type AutoImportModificationType = 'EXTERNAL' | 'INTERNAL' | 'HIDDEN' | 'UNKNOWN'

/** `ExternalSystemProjectTrackerSettings.AutoReloadType`（与 `src/gradle.ts` 的同名档位结构一致）。 */
export type ExternalAutoReloadType = 'ALL' | 'SELECTIVE' | 'NONE'

/** `ExternalSystemRefreshStatus`。 */
export type ExternalRefreshStatus = 'SUCCESS' | 'FAILURE' | 'CANCEL'

/** `ExternalSystemSettingsFilesModificationContext.Event` / `ReloadStatus`。 */
export type SettingsFileEvent = 'CREATE' | 'UPDATE' | 'DELETE'
export type ReloadStatus = 'IDLE' | 'IN_PROGRESS' | 'JUST_STARTED' | 'JUST_FINISHED'

export interface SettingsFileModificationContext {
  event: SettingsFileEvent
  modificationType: AutoImportModificationType
  reloadStatus: ReloadStatus
}

export interface SettingsFilesReloadContext {
  updated: string[]
  created: string[]
  deleted: string[]
}

export interface ProjectReloadContext {
  isExplicitReload: boolean
  hasUndefinedModifications: boolean
  settingsFilesContext: SettingsFilesReloadContext
}

/** `ExternalSystemProjectId.kt`：路径末段当项目名；`toString()` 供通知文案。 */
export interface ExternalProjectId {
  systemId: string
  externalProjectPath: string
}

export function projectIdOf(systemId: string, externalProjectPath: string): ExternalProjectId {
  return { systemId, externalProjectPath: normalizeProjectPath(externalProjectPath) }
}

export function projectIdKey(id: ExternalProjectId): string {
  return `${id.systemId}\u0000${id.externalProjectPath}`
}

export function projectIdEquals(left: ExternalProjectId, right: ExternalProjectId): boolean {
  return left.systemId === right.systemId && left.externalProjectPath === right.externalProjectPath
}

/** 路径归一：反斜杠换正斜杠、去尾部斜杠（登记表按归一化路径寻址）。 */
export function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized === '' ? '' : normalized
}

/** `ExternalSystemProjectId.projectName`（`PathUtil.getFileName`）。 */
export function projectNameOf(id: ExternalProjectId): string {
  return id.externalProjectPath.split('/').filter(Boolean).pop() ?? id.externalProjectPath
}

/** `ExternalSystemProjectId.toString()`：`<系统可读名> (<项目名>)`。 */
export function projectIdLabel(id: ExternalProjectId, readableName = ''): string {
  const name = readableName || id.systemId
  return `${name} (${projectNameOf(id)})`
}

export interface ExternalSystemProjectListener {
  onProjectReloadStart?(): void
  onProjectReloadFinish?(status: ExternalRefreshStatus): void
  onSettingsFilesListChange?(): void
}

/** `ExternalSystemProjectAware.kt` 的可移植形状（钩子都是可选的，默认语义与上游一致）。 */
export interface ExternalSystemProjectAware {
  projectId: ExternalProjectId
  /** 会被监视的设置文件（归一化路径）。 */
  settingsFiles(): readonly string[]
  /** 排一次工程重载（上游不阻塞调用线程；本仓由调用方决定同步/异步）。 */
  reloadProject(context: ProjectReloadContext): void
  subscribe?(listener: ExternalSystemProjectListener): void
  /** 上游默认实现：忽略 JUST_STARTED 与「JUST_FINISHED 且 CREATE」。 */
  isIgnoredSettingsFileEvent?(path: string, context: SettingsFileModificationContext): boolean
  /** 上游默认：原样返回。 */
  adjustModificationType?(path: string, type: AutoImportModificationType): AutoImportModificationType
  isDisabledReload?(context: ProjectReloadContext): boolean
  isDisabledAutoReload?(context: ProjectReloadContext): boolean
}

/** 上游 `ExternalSystemProjectAware.isIgnoredSettingsFileEvent` 的默认实现。 */
export function isIgnoredSettingsFileEventDefault(_path: string, context: SettingsFileModificationContext): boolean {
  return context.reloadStatus === 'JUST_STARTED'
    || (context.reloadStatus === 'JUST_FINISHED' && context.event === 'CREATE')
}

/**
 * 事件聚合（`ExternalSystemSettingsFilesModificationContext.kt` 的类注释）：
 * CREATE+UPDATE 合并成 CREATE，UPDATE+DELETE 合并成 DELETE；其余取后到的。
 * 返回 null 表示「互相抵消」：CREATE+DELETE（文件回到不存在），DELETE 后再 CREATE 是 UPDATE 语义由调用方定。
 */
export function mergeSettingsFileEvent(previous: SettingsFileEvent | null, next: SettingsFileEvent): SettingsFileEvent | null {
  if (previous === null) return next
  if (previous === next) return next
  if (previous === 'CREATE' && next === 'UPDATE') return 'CREATE'
  if (previous === 'UPDATE' && next === 'CREATE') return 'CREATE'
  if (previous === 'UPDATE' && next === 'DELETE') return 'DELETE'
  if (previous === 'DELETE' && next === 'UPDATE') return 'DELETE'
  if (previous === 'CREATE' && next === 'DELETE') return null
  if (previous === 'DELETE' && next === 'CREATE') return 'UPDATE'
  return next
}

/** `markDirty`/`markDirtyInternal` 之后的调度结论。 */
export type AutoReloadDecision = 'reload' | 'notify' | 'ignore'

/**
 * 上游调度口径（`ExternalSystemProjectTracker` 的注释逐条）：
 *   · markDirty（未定义/外部改动）：ALL/SELECTIVE 重载；NONE 出通知；
 *   · markDirtyInternal（IDE 内部改动）：只有 ALL 重载；SELECTIVE/NONE 出通知；
 *   · HIDDEN：任何档位都不自动重载（语义近 INTERNAL 但不触发），只登记为脏；
 *   · UNKNOWN：按外部改动处理（上游 markDirty 的语义）。
 */
export function autoReloadDecision(type: ExternalAutoReloadType, modification: AutoImportModificationType, internal: boolean): AutoReloadDecision {
  if (modification === 'HIDDEN') return 'ignore'
  if (type === 'NONE') return 'notify'
  if (internal || modification === 'INTERNAL') return type === 'ALL' ? 'reload' : 'notify'
  return 'reload'
}

export interface ExternalSystemProjectTracker {
  register(aware: ExternalSystemProjectAware): void
  remove(id: ExternalProjectId): void
  activate(id: ExternalProjectId): void
  registeredProjects(): ExternalProjectId[]
  activatedProjects(): ExternalProjectId[]
  /** 未定义修改：登记并把调度结论返回给调用方（上游内部还会排队，本仓交给宿主）。 */
  markDirty(id: ExternalProjectId): AutoReloadDecision
  markDirtyInternal(id: ExternalProjectId): AutoReloadDecision
  markDirtyAllProjects(): ExternalProjectId[]
  /** 不看设置，只刷已脏的（上游 `scheduleProjectRefresh`）。 */
  scheduleProjectRefresh(): ExternalProjectId[]
  /** 设置文件改动：聚合事件、跑 ignore/adjust 钩子，再按类型 markDirty。 */
  settingsFileChanged(id: ExternalProjectId, path: string, event: SettingsFileEvent, modification: AutoImportModificationType): AutoReloadDecision
  /** 重载生命周期：开始/结束驱动监听器与 settings-files 上下文。 */
  beginReload(id: ExternalProjectId): void
  finishReload(id: ExternalProjectId, status: ExternalRefreshStatus): void
  reloadContext(id: ExternalProjectId, explicit?: boolean): ProjectReloadContext
  /** 有没有需要重载的项目（通知面的 `isNotificationVisible`）。 */
  isNotificationVisible(systemId?: string): boolean
  /** 通知面：显式要求显示/隐藏（`notificationNotify`/`notificationExpire`）。 */
  notificationNotify(id: ExternalProjectId): void
  notificationExpire(): void
  notificationExpireFor(id: ExternalProjectId): void
  /** 一次性「自动导入相关操作」的计数（`ExternalSystemAutoImportAwareListener`）。 */
  operationStarted(): void
  operationCompleted(): void
  operationInProgress(): boolean
}

interface ProjectState {
  aware: ExternalSystemProjectAware
  activated: boolean
  dirty: boolean
  notified: boolean
  /** 长操作期间攒下的改动类型（operationCompleted 时按它调度）。 */
  pending: AutoImportModificationType | null
  reloadStatus: ReloadStatus
  events: Map<string, SettingsFileEvent>
  created: Set<string>
  updated: Set<string>
  deleted: Set<string>
  listeners: ExternalSystemProjectListener[]
}

export function createExternalSystemProjectTracker(options: {
  /** 每档读一次设置（上游 `ExternalSystemProjectTrackerSettings.getInstance(project)`）。 */
  autoReloadType: () => ExternalAutoReloadType
  /** 通知面变化（显示/隐藏）时回调，宿主据此刷新 UI（上游 message bus 的 TOPIC）。 */
  onNotificationChanged?: () => void
}): ExternalSystemProjectTracker {
  const projects = new Map<string, ProjectState>()
  let operations = 0

  const stateOf = (id: ExternalProjectId): ProjectState | null => projects.get(projectIdKey(id)) ?? null
  const notifyChanged = () => options.onNotificationChanged?.()

  function mark(state: ProjectState, modification: AutoImportModificationType, internal: boolean): AutoReloadDecision {
    state.dirty = true
    const context = reloadContextOf(state, false)
    if (state.aware.isDisabledReload?.(context)) return 'ignore'
    const decision = autoReloadDecision(options.autoReloadType(), modification, internal)
    if (decision === 'notify') {
      state.notified = true
      notifyChanged()
      return decision
    }
    if (decision === 'reload') {
      // 上游还要过 `isDisabledAutoReload`；被禁但仍是脏的，等显式刷新。
      if (state.aware.isDisabledAutoReload?.(context)) return 'ignore'
      state.dirty = false
      state.notified = false
      notifyChanged()
      state.aware.reloadProject(context)
    }
    return decision
  }

  function reloadContextOf(state: ProjectState, explicit: boolean): ProjectReloadContext {
    return {
      isExplicitReload: explicit,
      hasUndefinedModifications: state.dirty,
      settingsFilesContext: {
        updated: [...state.updated].sort(),
        created: [...state.created].sort(),
        deleted: [...state.deleted].sort(),
      },
    }
  }

  function clearFileContext(state: ProjectState): void {
    state.events.clear()
    state.created.clear()
    state.updated.clear()
    state.deleted.clear()
  }

  return {
    register(aware) {
      const key = projectIdKey(aware.projectId)
      const existing = projects.get(key)
      projects.set(key, existing
        ? { ...existing, aware }
        : {
            aware, activated: false, dirty: false, notified: false, pending: null, reloadStatus: 'IDLE',
            events: new Map(), created: new Set(), updated: new Set(), deleted: new Set(), listeners: [],
          })
      if (existing) for (const listener of existing.listeners) aware.subscribe?.(listener)
    },
    remove(id) {
      const state = stateOf(id)
      if (!state) return
      projects.delete(projectIdKey(id))
      if (state.notified) notifyChanged()
    },
    activate(id) {
      const state = stateOf(id)
      if (state) state.activated = true
    },
    registeredProjects: () => [...projects.values()].map(state => state.aware.projectId),
    activatedProjects: () => [...projects.values()].filter(state => state.activated).map(state => state.aware.projectId),
    markDirty(id) {
      const state = stateOf(id)
      if (!state) return 'ignore'
      return mark(state, 'UNKNOWN', false)
    },
    markDirtyInternal(id) {
      const state = stateOf(id)
      if (!state) return 'ignore'
      return mark(state, 'INTERNAL', true)
    },
    markDirtyAllProjects() {
      const dirty: ExternalProjectId[] = []
      for (const state of projects.values()) {
        state.dirty = true
        dirty.push(state.aware.projectId)
      }
      notifyChanged()
      return dirty
    },
    scheduleProjectRefresh() {
      const dirty: ExternalProjectId[] = []
      for (const state of projects.values()) {
        if (!state.dirty && !state.notified) continue
        state.dirty = false
        state.notified = false
        dirty.push(state.aware.projectId)
      }
      if (dirty.length) notifyChanged()
      // 强制刷新不看设置：调用方对每个返回值跑一次 reloadProject。
      for (const id of dirty) {
        const state = stateOf(id)!
        state.aware.reloadProject(reloadContextOf(state, true))
      }
      return dirty
    },
    settingsFileChanged(id, path, event, modification) {
      const state = stateOf(id)
      if (!state) return 'ignore'
      const context: SettingsFileModificationContext = { event, modificationType: modification, reloadStatus: state.reloadStatus }
      if (state.aware.isIgnoredSettingsFileEvent?.(path, context) ?? isIgnoredSettingsFileEventDefault(path, context)) return 'ignore'
      const adjusted = state.aware.adjustModificationType?.(path, modification) ?? modification
      const next: SettingsFileModificationContext = { ...context, modificationType: adjusted }
      if (state.aware.isIgnoredSettingsFileEvent?.(path, next) ?? isIgnoredSettingsFileEventDefault(path, next)) return 'ignore'
      const merged = mergeSettingsFileEvent(state.events.get(path) ?? null, event)
      if (merged === null) {
        state.events.delete(path)
        state.created.delete(path); state.updated.delete(path); state.deleted.delete(path)
      } else {
        state.events.set(path, merged)
        if (merged === 'CREATE') { state.created.add(path); state.updated.delete(path); state.deleted.delete(path) }
        else if (merged === 'UPDATE') { state.updated.add(path); state.created.delete(path); state.deleted.delete(path) }
        else { state.deleted.add(path); state.created.delete(path); state.updated.delete(path) }
      }
      if (operations > 0) {
        // 自动导入相关操作进行中（上游 ExternalSystemAutoImportAwareListener 的用场）：
        // 只登记为脏，操作结束（operationCompleted）时再按档位调度。
        state.dirty = true
        state.pending = adjusted
        return 'ignore'
      }
      return mark(state, adjusted, adjusted === 'INTERNAL')
    },
    beginReload(id) {
      const state = stateOf(id)
      if (!state) return
      state.reloadStatus = 'JUST_STARTED'
      for (const listener of state.listeners) listener.onProjectReloadStart?.()
      state.reloadStatus = 'IN_PROGRESS'
    },
    finishReload(id, status) {
      const state = stateOf(id)
      if (!state) return
      state.reloadStatus = 'JUST_FINISHED'
      for (const listener of state.listeners) listener.onProjectReloadFinish?.(status)
      // 上一轮的文件事件账在重载结束后清空（ExternalSystemSettingsFilesReloadContext 的
      // 「自上轮重载以来」语义）；状态回到 IDLE 前再广播一次设置文件清单变化。
      for (const listener of state.listeners) listener.onSettingsFilesListChange?.()
      clearFileContext(state)
      state.reloadStatus = 'IDLE'
      state.dirty = false
    },
    reloadContext(id, explicit = false) {
      const state = stateOf(id)
      if (!state) return { isExplicitReload: explicit, hasUndefinedModifications: false, settingsFilesContext: { updated: [], created: [], deleted: [] } }
      return reloadContextOf(state, explicit)
    },
    isNotificationVisible(systemId) {
      return [...projects.values()].some(state => state.notified && (systemId === undefined || state.aware.projectId.systemId === systemId))
    },
    notificationNotify(id) {
      const state = stateOf(id)
      if (!state || state.notified) return
      state.notified = true
      state.dirty = true
      notifyChanged()
    },
    notificationExpire() {
      let changed = false
      for (const state of projects.values()) if (state.notified) { state.notified = false; changed = true }
      if (changed) notifyChanged()
    },
    notificationExpireFor(id) {
      const state = stateOf(id)
      if (!state?.notified) return
      state.notified = false
      notifyChanged()
    },
    operationStarted() { ++operations },
    operationCompleted() {
      operations = Math.max(0, operations - 1)
      if (operations > 0) return
      // 长操作期间攒下的脏项目，在操作结束时按当时的改动类型调度一次。
      for (const state of projects.values()) {
        if (!state.dirty) continue
        const pending = state.pending
        state.pending = null
        mark(state, pending ?? 'UNKNOWN', pending === 'INTERNAL')
      }
    },
    operationInProgress: () => operations > 0,
  }
}

// ---------------------------------------------------------------- autolink（未链接工程）

export interface ExternalSystemProjectLinkListener {
  onProjectLinked?(externalProjectPath: string): void
  onProjectUnlinked?(externalProjectPath: string): void
}

/** `ExternalSystemUnlinkedProjectAware.kt` 的可移植形状。 */
export interface ExternalSystemUnlinkedProjectAware {
  systemId: string
  /** `buildFileExtensions()`：按扩展名判「像不像这个系统的构建文件」。 */
  buildFileExtensions?(): readonly string[]
  isBuildFile(path: string): boolean
  isLinkedProject(projectState: { linkedProjects: readonly string[] }, externalProjectPath: string): boolean
  linkAndLoadProject(externalProjectPath: string): void
  unlinkProject(externalProjectPath: string): void
  subscribe(listener: ExternalSystemProjectLinkListener): void
}

export interface UnlinkedProjectRegistry {
  register(aware: ExternalSystemUnlinkedProjectAware): void
  get(systemId: string): ExternalSystemUnlinkedProjectAware | null
  /** `unlinkOtherLinkedProjects`：链接一个系统时解除同路径上别的系统的链接。 */
  unlinkOtherLinkedProjects(linkedProjects: readonly string[], externalProjectPath: string, systemId: string): string[]
  /** 用户可见的「未链接工程」提示该不该出现（上游由 `ExternalSystemUnlinkedProjectSettings.isEnabledAutoLink` 总开关门控）。 */
  shouldShowUnlinkedNotification(systemId: string, autoLinkEnabled: boolean): boolean
}

interface RegisteredAware {
  aware: ExternalSystemUnlinkedProjectAware
  listeners: ExternalSystemProjectLinkListener[]
}

export function createUnlinkedProjectRegistry(): UnlinkedProjectRegistry {
  const awares = new Map<string, RegisteredAware>()
  return {
    register(aware) {
      const existing = awares.get(aware.systemId)
      awares.set(aware.systemId, { aware, listeners: existing?.listeners ?? [] })
      for (const listener of existing?.listeners ?? []) aware.subscribe(listener)
    },
    get(systemId) { return awares.get(systemId)?.aware ?? null },
    unlinkOtherLinkedProjects(linkedProjects, externalProjectPath, systemId) {
      const path = normalizeProjectPath(externalProjectPath)
      const unlinked: string[] = []
      for (const [id, entry] of awares) {
        if (id === systemId) continue
        if (!entry.aware.isLinkedProject({ linkedProjects }, path)) continue
        entry.aware.unlinkProject(path)
        unlinked.push(id)
      }
      return unlinked
    },
    shouldShowUnlinkedNotification(systemId, autoLinkEnabled) {
      return autoLinkEnabled && awares.has(systemId)
    },
  }
}

/** `ExtensionPointUtil.kt` 的 `runExtensionSafe`/`forEachExtensionSafeAsync`：逐个扩展 try/catch。 */
export function runExtensionsSafely<E, R>(extensions: readonly E[], action: (extension: E) => R, onError?: (error: unknown, extension: E) => void): R[] {
  const results: R[] = []
  for (const extension of extensions) {
    try { results.push(action(extension)) }
    catch (error) { onError?.(error, extension) }
  }
  return results
}

/** `ExternalSystemUnlinkedProjectSettings.isEnabledAutoLink` 的默认值（上游实现默认 true）。 */
export const AUTO_LINK_DEFAULT = true
