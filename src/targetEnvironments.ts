// 用户自定义目标环境（上游 `TargetEnvironmentConfiguration` + `TargetEnvironmentsManager` + 目标类型表）。
//
// 上游出处：
//   platform/execution/src/com/intellij/execution/target/TargetEnvironmentConfiguration.kt:20-58
//       一份目标环境 = typeId + uuid(:30) + runtimes(:33，语言运行时清单) + projectRootOnTarget(:41)；
//       `validateConfiguration()`(:47-58)：runtimes 为空 ⇒ RuntimeConfigurationWarning
//       "Language runtime is not configured"（ExecutionBundle.properties:626），否则逐个交给运行时自己校验。
//   platform/execution/src/com/intellij/execution/target/TargetEnvironmentType.kt:22-32
//       目标类型贡献 isLocalTarget() / isSystemCompatible()；本仓只有本机这一档（没有远程后端）。
//   platform/execution/src/com/intellij/execution/target/TargetEnvironmentsManager.kt:18-20/30-39/57-74
//       项目级服务，`@State(name="RemoteTargetsManager", storages=[Storage("remote-targets.xml")])`；
//       持有 targets 列表 + projectDefaultTargetUuid（默认目标为空 = 本机，:30-39）；
//       addTarget 先 ensureUniqueName(:57-62)，ensureUniqueName 用 UniqueNameGenerator 取唯一显示名(:68-74)。
//   platform/execution/src/com/intellij/execution/target/TargetEnvironmentType.kt:86-96
//       `duplicateTargetConfiguration`：复制类型配置，并把每个 runtime 换成 duplicateConfig 后的副本。
//   platform/execution-impl/.../RunOnTargetPanel.java:140-143
//       「运行于」下拉的模型 = manager 里的目标，按 isSystemCompatible() 过滤。
//
// 存储位置：本仓按设计不在用户项目里写 `.idea` XML（`native/projects_test.cpp:281/:442-443` 两条断言），
//   `remote-targets.xml` 也一样不进项目目录，所以与 `src/runConfigTemplates.ts` 一样存 localStorage、
//   按项目根分键。这是有意的等价物选择，不是遗漏。
//
// 纯函数 + 可注入的 StorageLike，判据 tests/target-environments.test.mjs。

import { languageRuntimeType, type LanguageRuntimeEntry } from './languageRuntimes.ts'

/** 上游 `TargetEnvironmentType` 的本机一档（isLocalTarget() = true，TargetEnvironmentType.kt:27）。 */
export const LOCAL_TARGET_TYPE_ID = 'LocalTarget'
export const LOCAL_TARGET_TYPE_NAME = '本机'

export const TARGET_ENVIRONMENTS_KEY = 'taocode.targetEnvironments'

export interface TargetEnvironment {
  /** 上游 `TargetEnvironmentConfiguration.uuid`（:30）——默认目标按 uuid 记（Manager :30/:36）。 */
  uuid: string
  typeId: string
  displayName: string
  /** 上游 `projectRootOnTarget`（:41）。本机目标的「目标上根」就是本项目根。 */
  projectRootOnTarget: string
  runtimes: LanguageRuntimeEntry[]
}

export interface TargetEnvironmentsState {
  defaultTargetUuid: string
  targets: TargetEnvironment[]
}

export interface TargetStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 每项目一把键（root 为空退回应用级，与 runConfigTemplates 的分键方式一致）。 */
export function targetEnvironmentsStoreKey(root: string): string {
  return root ? `${TARGET_ENVIRONMENTS_KEY}.${root}` : TARGET_ENVIRONMENTS_KEY
}

const MAX_TARGETS = 32
const MAX_DISPLAY_NAME = 80
const MAX_HOME_PATH = 1024

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\r\n\u0000]/.test(value)
}

function sanitizeRuntime(raw: unknown): LanguageRuntimeEntry | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entry = raw as Partial<LanguageRuntimeEntry>
  const typeId = entry.typeId
  const homePath = entry.homePath ?? ''
  if (typeof typeId !== 'string' || !languageRuntimeType(typeId)) return undefined
  if (!text(homePath, MAX_HOME_PATH)) return undefined
  const out: LanguageRuntimeEntry = { typeId, homePath }
  const version = entry.version ?? ''
  if (text(version, 80) && version) out.version = version
  return out
}

function sanitizeTarget(raw: unknown): TargetEnvironment | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Partial<TargetEnvironment>
  const uuid = value.uuid
  const typeId = value.typeId
  const displayName = value.displayName ?? ''
  const projectRootOnTarget = value.projectRootOnTarget ?? ''
  if (!text(uuid, 64) || !uuid) return undefined
  if (!text(typeId, 80) || typeId !== LOCAL_TARGET_TYPE_ID) return undefined
  if (!text(displayName, MAX_DISPLAY_NAME)) return undefined
  if (!text(projectRootOnTarget, MAX_HOME_PATH)) return undefined
  const runtimes = Array.isArray(value.runtimes) ? value.runtimes.map(sanitizeRuntime).filter((entry): entry is LanguageRuntimeEntry => !!entry) : []
  // 一个类型在一个目标上只留一格（上游 `runtimes.findByType()` 的形状，见 JavaLanguageRuntimeType.kt:54-56）。
  const byType = new Map<string, LanguageRuntimeEntry>()
  for (const entry of runtimes) if (!byType.has(entry.typeId)) byType.set(entry.typeId, entry)
  return { uuid, typeId, displayName, projectRootOnTarget, runtimes: [...byType.values()] }
}

export function loadTargetEnvironments(store: TargetStore | undefined, root: string): TargetEnvironmentsState {
  try {
    const raw = store?.getItem(targetEnvironmentsStoreKey(root))
    if (!raw) return { defaultTargetUuid: '', targets: [] }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { defaultTargetUuid: '', targets: [] }
    const value = parsed as Partial<TargetEnvironmentsState>
    const targets = Array.isArray(value.targets)
      ? value.targets.slice(0, MAX_TARGETS).map(sanitizeTarget).filter((entry): entry is TargetEnvironment => !!entry)
      : []
    const stored = typeof value.defaultTargetUuid === 'string' ? value.defaultTargetUuid : ''
    // 默认目标指向一个已经被删掉的目标时按「本机」处理（上游 `defaultTarget` getter 是
    // `targets.resolvedConfigs().firstOrNull { it.uuid == uuid }`，找不到就是 null，Manager :36）。
    const defaultTargetUuid = text(stored, 64) && targets.some(target => target.uuid === stored) ? stored : ''
    return { defaultTargetUuid, targets }
  } catch {
    return { defaultTargetUuid: '', targets: [] }
  }
}

function persist(store: TargetStore | undefined, root: string, state: TargetEnvironmentsState): TargetEnvironmentsState {
  try { store?.setItem(targetEnvironmentsStoreKey(root), JSON.stringify(state)) } catch { /* 存储不可用只影响持久化 */ }
  return state
}

export function newTargetEnvironment(uuid: string, displayName: string, projectRoot: string): TargetEnvironment {
  return { uuid, typeId: LOCAL_TARGET_TYPE_ID, displayName, projectRootOnTarget: projectRoot, runtimes: [] }
}

/** `UniqueNameGenerator.generateUniqueName`（Manager :68-74 / MasterDetails:250-254）：占用就加数字。 */
export function uniqueTargetDisplayName(targets: readonly TargetEnvironment[], base: string): string {
  const used = new Set(targets.map(target => target.displayName))
  const stem = base.trim() || LOCAL_TARGET_TYPE_NAME
  if (!used.has(stem)) return stem
  for (let index = 2; ; index++) {
    const candidate = `${stem} ${index}`
    if (!used.has(candidate)) return candidate
  }
}

/** `TargetEnvironmentsManager.addTarget`：先取唯一名再入列（:57-62）。 */
export function addTargetEnvironment(
  store: TargetStore | undefined, root: string, target: TargetEnvironment,
): TargetEnvironmentsState {
  const state = loadTargetEnvironments(store, root)
  if (state.targets.some(entry => entry.uuid === target.uuid)) return state
  const targets = [...state.targets, { ...target, displayName: uniqueTargetDisplayName(state.targets, target.displayName) }]
  return persist(store, root, { ...state, targets })
}

export function updateTargetEnvironment(
  store: TargetStore | undefined, root: string, target: TargetEnvironment,
): TargetEnvironmentsState {
  const state = loadTargetEnvironments(store, root)
  const index = state.targets.findIndex(entry => entry.uuid === target.uuid)
  if (index < 0) return addTargetEnvironment(store, root, target)
  const targets = [...state.targets]
  targets[index] = { ...target, runtimes: target.runtimes.map(entry => ({ ...entry })) }
  return persist(store, root, { ...state, targets })
}

/** `removeTarget`（Manager :64-66）；默认目标指向被删的 uuid 时一并清空（Manager :35-39 的语义）。 */
export function removeTargetEnvironment(store: TargetStore | undefined, root: string, uuid: string): TargetEnvironmentsState {
  const state = loadTargetEnvironments(store, root)
  const targets = state.targets.filter(entry => entry.uuid !== uuid)
  const defaultTargetUuid = state.defaultTargetUuid === uuid ? '' : state.defaultTargetUuid
  return persist(store, root, { defaultTargetUuid, targets })
}

/** 设置项目默认目标（Manager :30-39）；`''` = 本机（对应上游 combo 里那个 `null` 项，MasterDetails:80-90）。 */
export function setProjectDefaultTarget(store: TargetStore | undefined, root: string, uuid: string): TargetEnvironmentsState {
  const state = loadTargetEnvironments(store, root)
  const defaultTargetUuid = uuid && state.targets.some(target => target.uuid === uuid) ? uuid : ''
  return persist(store, root, { ...state, defaultTargetUuid })
}

export function projectDefaultTarget(state: TargetEnvironmentsState): TargetEnvironment | undefined {
  return state.targets.find(target => target.uuid === state.defaultTargetUuid)
}

/**
 * 复制目标（`TargetEnvironmentType.duplicateTargetConfiguration`，:86-96）：
 * 换新 uuid，runtimes 逐个复制（上游调 `getRuntimeType().duplicateConfig(next)`）。
 */
export function duplicateTargetEnvironment(target: TargetEnvironment, uuid: string): TargetEnvironment {
  return { ...target, uuid, runtimes: target.runtimes.map(entry => ({ ...entry })) }
}

/**
 * 目标环境的校验（`TargetEnvironmentConfiguration.validateConfiguration`，:47-58）。
 * 返回 null = 合法；否则是给用户看的中文原因。上游在这里只管「运行时配了没」，
 * 每个运行时自己再校验自己那份数据（本仓的逐条规则见下），所以这里也是两层。
 */
export function validateTargetEnvironment(target: TargetEnvironment): string | null {
  if (!target.runtimes.length) return '未配置语言运行时'
  for (const entry of target.runtimes) {
    if (!entry.homePath.trim()) {
      // `JavaLanguageRuntimeConfiguration.validateConfiguration()`（:36-42）按类型给不同的话；
      // 其余类型的上游主路径字段同理，只是没单独一句 bundle。
      return entry.typeId === 'JavaLanguageRuntime' ? '需要目标上的 JDK 主路径' : `${languageRuntimeType(entry.typeId)?.displayName ?? entry.typeId} 主路径不能为空`
    }
  }
  return null
}
