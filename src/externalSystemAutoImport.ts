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

// ---------------------------------------------------------------- 未链接工程通知（UPN）的文案
//
// 上游本体：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/autolink/
// UnlinkedProjectStartupActivity.kt:141-197`（`installUnlinkedProjectScanner` → `updateNotification`
// 的三分支 `:172-181`：已链接 ⇒ expire、有构建文件 ⇒ notify、否则 expire；`hasBuildFiles` 在
// `:266-271`，**只看工程目录的直接子项**）与 `UnlinkedProjectNotificationAware.kt:42-74`
// （`:60` INFORMATION + `:62` `setSuggestionType(true)`、`:63` help、`:64` link 动作、`:65` skip 动作、
// `:61` 一个 displayId ⇒ 同一个工程只挂一条）。
// 文案全部来自 `platform/external-system-api/resources/messages/ExternalSystemBundle.properties`，
// 逐条打开数过：
//   · `:14` `unlinked.project.notification.title={0} ''{1}'' build scripts found`
//   · `:15` `unlinked.project.notification.load.action=Load {0} Project`
//   · `:16` `unlinked.project.notification.skip.action=Skip`
//   · `:17-21` `unlinked.project.notification.help.text=` 那四行
//     （“The IDE can import project information (e.g. sources and dependencies) from the {0} build script.
//       If you are unsure or this is not a {0} project, press 'Skip'.
//       You'll be able to import the {0} project later from context menu of {0} build script.”）
// 取文案的那一层是 `platform/external-system-api/src/com/intellij/openapi/externalSystem/ui/
// ExternalSystemTextProvider.kt:20-45`（Gradle **没有**覆盖它 —— 全树只有
// `plugins/ant/src/com/intellij/lang/ant/config/impl/AntTextProvider.kt:12` 覆盖了 link 动作那一档），
// 所以下面这套就是 Gradle 实际显示的那套。

/**
 * 这条通知的 displayId —— 上游给的是**真字面量**，不是本仓自取（本轮逐条开文件核过）：
 *   · `UnlinkedProjectNotificationAware.kt:61` `.setDisplayId(UNLINKED_NOTIFICATION_ID)`
 *   · 同文件 `:143` `private const val UNLINKED_NOTIFICATION_ID = "external.system.autolink.unlinked.project.notification"`
 *   · 同一个字符串还登记在 `platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:51-53`：
 *     那条 `notificationGroup id="External System Auto-Link Notification Group" displayType="STICKY_BALLOON"`
 *     的 `notificationIds=` 白名单里（上游的 id 白名单就是这个 XML 属性，本仓/native 侧没有另一套表可查）。
 * 本仓的兑现面：同一个 displayId 顶替旧的那条（`src/notices.ts:87-91`），与上游 `:40` 的
 * `notifiedNotifications`「同一个工程只挂一条」同形；它也当「不再显示」那条的记账 id
 * （`src/notificationDoNotAsk.ts:161-163` 走 `configureDoNotAskOption` 的 displayId 分支）。
 * 那个上游组**没有**登记进 `src/notificationGroups.ts`（本 lane 不改那张注册表）⇒ 这条通知落进
 * 「未分组」，行为与 `displayType="STICKY_BALLOON"` 一致（弹气球 + 进通知中心）；组的登记请求另文提。
 */
export const UNLINKED_PROJECT_DISPLAY_ID = 'external.system.autolink.unlinked.project.notification'

/** 一条未链接工程通知要的四段话（`UnlinkedProjectNotificationAware.kt:55/:63/:64/:65` 的四个取文案点）。 */
export interface UnlinkedProjectNotice {
  readonly title: string
  readonly helpText: string
  readonly linkAction: string
  readonly skipAction: string
}

/**
 * 按上游那四条 bundle 原文直译（`{0}` = 构建系统可读名、`{1}` = 工程名）。
 * `systemReadableName` 传 `ProjectSystemId.readableName`（本仓 Gradle 那条 = `externalSystemModel.ts` 的
 * `GRADLE_SYSTEM`，`readableName` = “Gradle”）。
 */
export function unlinkedProjectNotice(systemReadableName: string, projectName: string): UnlinkedProjectNotice {
  return {
    title: `找到 ${systemReadableName} 工程「${projectName}」的构建脚本`,
    helpText: `IDE 可以从 ${systemReadableName} 构建脚本导入项目信息（例如源码与依赖）。`
      + `如果不确定，或这不是一个 ${systemReadableName} 工程，请按「跳过」。`
      + `之后你也可以从 ${systemReadableName} 构建脚本的右键菜单里导入这个工程。`,
    linkAction: `加载 ${systemReadableName} 工程`,
    skipAction: '跳过',
  }
}

// ---------------------------------------------------------------- 自动重载的合并窗（esa/autoimport 缺项 ④）
//
// 上游不是「脏了就立刻重载」：`AutoImportProjectTracker.kt`（platform/external-system-impl/
// src/com/intellij/openapi/externalSystem/autoimport/）把改动先攒进一条 `MergingUpdateQueue`
// （`:89-96`，合并跨度 `mergingTimeSpan = 300.milliseconds`，`:549`），自动重载再晚一整段
// `autoReloadDelay = 3.seconds`（`:551`）才跑 —— 具体延迟 = `smartProjectReloadDelay`
// （各 aware 自报的延迟取最大，没有就用 3s 兜底，`:161-162`）折算成**跨度数**，
// 并且扣掉已经在队里等的那一拍：`effectiveDispatchIterations = max(delay/span - 1, 1)`（`:163-166`）。
// 用户显式点「同步更改」走 `scheduleProjectRefresh`（`:137-142`，priority 0，不等这个延迟；
// `PriorityEatUpdate` `:171-196` 让显式刷新把待着的延迟重载整个吃掉）。

/** `AutoImportProjectTracker.kt:549`：合并跨度 300ms。 */
export const AUTO_RELOAD_MERGING_TIME_SPAN_MS = 300

/** `AutoImportProjectTracker.kt:551`：默认自动重载延迟 3s（`smartProjectReloadDelay` 没人报时的兜底 `:161-162`）。 */
export const AUTO_RELOAD_DELAY_MS = 3000

/** `AutoImportProjectTracker.kt:163-166` 的折算：`max(round(delay/span) - 1, 1) * span`（3s → 2700ms）。 */
export function effectiveReloadDelayMs(
  delayMs: number = AUTO_RELOAD_DELAY_MS,
  spanMs: number = AUTO_RELOAD_MERGING_TIME_SPAN_MS,
): number {
  const iterations = Math.max(Math.round(delayMs / spanMs) - 1, 1)
  return iterations * spanMs
}

export interface AutoReloadWindow {
  /** 记一条待重载；窗口没开就开一窗，开了就并进同一窗（返回 true = 这次是开窗的那一条）。 */
  schedule(key: string): boolean
  /** 显式刷新把待着的延迟重载吃掉（`PriorityEatUpdate` 的 0 档语义）；不传 key = 清全部。 */
  eatPending(key?: string): void
  /** 立刻放行（测试/紧急重同步用）；没有待项就不触发。 */
  flushNow(): void
  pending(): string[]
  /** 换工程：待项与计时器全部作废（上一根窗不该打到新工程上）。 */
  dispose(): void
}

/**
 * `MergingUpdateQueue` + `scheduleDelayedProjectReload` 的 DOM 等价物：
 * 首条改动开一窗（`effectiveReloadDelayMs()`），窗内的后续改动**合并**为同一次触发；
 * `fire` 收到的是这一窗攒下的 key（构建目录）清单。计时器可注入（判据测试用假时钟）。
 */
export function createAutoReloadWindow(
  fire: (keys: string[]) => void,
  options: { delayMs?: number; startTimer?: (ms: number, run: () => void) => () => void } = {},
): AutoReloadWindow {
  const delayMs = options.delayMs ?? effectiveReloadDelayMs()
  const startTimer = options.startTimer
    ?? ((ms: number, run: () => void) => { const handle = setTimeout(run, ms); return () => clearTimeout(handle) })
  let keys: string[] = []
  let cancelTimer: (() => void) | null = null
  function dispatch(): void {
    cancelTimer = null
    const batch = keys
    keys = []
    if (batch.length) fire(batch)
  }
  return {
    schedule(key) {
      const opened = cancelTimer === null
      if (!keys.includes(key)) keys.push(key)
      if (opened) cancelTimer = startTimer(delayMs, dispatch)
      return opened
    },
    eatPending(key) {
      if (key === undefined) { keys = [] } else { keys = keys.filter(item => item !== key) }
      if (!keys.length && cancelTimer) { cancelTimer(); cancelTimer = null }
    },
    flushNow() { dispatch() },
    pending: () => [...keys],
    dispose() { if (cancelTimer) cancelTimer(); cancelTimer = null; keys = [] },
  }
}
