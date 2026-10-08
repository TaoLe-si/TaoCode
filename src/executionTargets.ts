// 执行目标（上游 `ExecutionTarget` / `ExecutionTargetManager` / `TargetEnvironment` 的**有界子集**）。
//
// 上游：目标是一个带 id/显示名/图标的对象；`TargetEnvironmentsManager` 管可配置的目标环境
// （TargetEnvironmentWizard 建、ManageTargetEnvironmentsAction 管）；Java 侧的具体目标是
// JDK（`JavaLanguageRuntime`/`JavaLanguageRuntimeUI`），运行配置在模板上选「Run on target」。
// 还有 `RunTargetsEnabled` 注册表开关：关掉就退回单一本机目标。
//
// 本仓没有远程/容器后端（宿主只做本机 CreateProcess，见 exec/wsl 判 `[-]`），所以这里可移植的
// 目标只有**本机**、**本机探测到的 JDK**（`app.jdks`）与**用户在目标管理里建的本机目标**
// （`src/targetEnvironments.ts` + `src/components/TargetEnvironmentsDialog.vue`）。语义边界：
//   · 目标列表 = 本机 + 每个 JDK 一个 + 每个自定义目标一项；
//   · 「Run on target」出现在**模板**上（与上游一致：只有模板编辑器有这一行，
//     `ConfigurationSettingsEditorWrapper.java:49-59`），旁边挂「管理目标…」链接
//     （上游同位置是 ActionLink，`RunOnTargetPanel.java:51-61`）；
//   · 新建配置时选了目标 ⇒ 用该目标运行时解析出的可执行文件作为程序（这正是上游
//     LanguageRuntime 目标的作用：换运行时）。程序形态不属于该运行时就只记录目标、不动命令。
//   · 注册表开关存 localStorage（上游是注册表项 RunTargetsEnabled）。
// 不做：远程/容器/WSL 目标（无宿主通道）、运行时在目标上的探测（`createIntrospector` 要
//   「在目标上执行脚本」）、`TargetPaths` 的上传/下载卷模型（要文件传输通道）。
//
// 纯函数 + localStorage 读写，判据 tests/run-config-templates.test.mjs（目标模型那一条）
// 与 tests/target-environments.test.mjs（用户自定义目标那条）。

import type { JdkInfo } from './buildHost.ts'
import { JAVA_RUNTIME_ID, languageRuntimeType, runtimeExecutable, runtimeOwnsProgram, type LanguageRuntimeEntry } from './languageRuntimes.ts'
import { currentTargetPlatform, targetPlatformOfPath, type TargetPlatform } from './targetPlatform.ts'
import { LOCAL_TARGET_TYPE_ID, type TargetEnvironment } from './targetEnvironments.ts'
// 运行目标那一族的 EP 宿主（上游 `com.intellij.executionTargetType` /
// `com.intellij.executionTargetProvider` / `com.intellij.executionTargetLanguageRuntimeType` /
// `com.intellij.runConfigurationTargetEnvironmentAdjusterFactory`，id 逐字见那边文件头）：
// 下面三处就是这些 EP 的**真实消费点**（目标列表、自定义目标的可执行文件解析、模板折算）。
import {
  adjustViaTargetEnvironmentFactories, executableViaLanguageRuntimeType, executionTargetsFromProviders,
  executionTargetsFromRegisteredTypes, isKnownTargetTypeId,
} from './executionTargetExtensionPoints.ts'

export type ExecutionTargetKind = 'local' | 'jdk' | 'custom'

export interface ExecutionTarget {
  id: string
  name: string
  kind: ExecutionTargetKind
  description: string
  /** JDK 目标的 java 可执行文件（run on target 时用它替换程序）。 */
  javaExecutable?: string
  /** 自定义目标（`TargetEnvironmentConfiguration`）挂在哪个运行时上。 */
  runtime?: LanguageRuntimeEntry
  /** 自定义目标的 uuid（回写默认目标与查找管理器用）。 */
  uuid?: string
  /** 该目标的可执行文件解析用的平台（`TargetPlatform` 的显式平台）。 */
  platform?: TargetPlatform
}

export const LOCAL_TARGET_ID = 'local'
export const RUN_TARGETS_ENABLED_KEY = 'taocode.runTargetsEnabled'
/** 自定义目标在 id 里的前缀（`jdk:` 是探测出来的 JDK，`target:` 是用户在目标管理里建的）。 */
export const CUSTOM_TARGET_PREFIX = 'target:'

export function localExecutionTarget(): ExecutionTarget {
  return { id: LOCAL_TARGET_ID, name: '本地机器', kind: 'local', description: '在本机运行（默认目标）' }
}

/**
 * 把 JDK 列表折成目标（`JavaLanguageRuntime` 的显示名形状：版本 + home）。
 * 可执行文件按**平台**拼（`src/targetPlatform.ts`）：Windows 是 `bin\java.exe`，Unix 是 `bin/java`。
 * 上一版无条件加 `.exe` 且靠 home 里有没有反斜杠猜分隔符，在非 Windows 宿主上会指向不存在的文件。
 */
export function jdkExecutionTargets(jdks: readonly JdkInfo[], platform: TargetPlatform = currentTargetPlatform()): ExecutionTarget[] {
  return jdks.filter(jdk => !!jdk.home).map(jdk => {
    const targetPlatform = targetPlatformOfPath(jdk.home!)
    const label = jdk.version || jdk.name || jdk.home
    return {
      id: `jdk:${jdk.home}`,
      name: `JDK ${label}`,
      kind: 'jdk' as const,
      description: jdk.home!,
      javaExecutable: runtimeExecutable({ typeId: JAVA_RUNTIME_ID, homePath: jdk.home! }, targetPlatform),
      runtime: { typeId: JAVA_RUNTIME_ID, homePath: jdk.home! },
      platform: targetPlatform,
    }
  })
}

/**
 * 自定义目标（上游 `TargetEnvironmentConfiguration`）：一个目标环境可以挂多个运行时，
 * 本仓的目标列表按「每个运行时一项」展开 —— 上游的「运行于」下拉同样用显示名列出目标
 * （RunOnTargetPanel.java:139-145 的 initModel + MasterDetails:330-334 的运行时摘要）。
 * 没配运行时的目标仍然列出来（标成未配好），因为上游也把校验不过的目标留在树里，
 * 只是图标换成 InvalidRunConfigurationIcon（MasterDetails.kt:336-346）。
 *
 * 类型过滤走**目标环境类型注册表**（`isKnownTargetTypeId`）：内建的只有 `LocalTarget`，
 * 所以无插件时与之前逐字一致；第三方按 `com.intellij.executionTargetType` 注册一个新类型后，
 * 该类型的环境才会被列进来（原来是写死 `=== LOCAL_TARGET_TYPE_ID`）。
 */
export function customExecutionTargets(environments: readonly TargetEnvironment[], platform: TargetPlatform = currentTargetPlatform()): ExecutionTarget[] {
  return environments.filter(environment => isKnownTargetTypeId(environment.typeId)).map(environment => {
    const runtimes = environment.runtimes.filter(runtime => runtime.homePath.trim())
    const first = runtimes[0]
    const targetPlatform = first ? targetPlatformOfPath(first.homePath) : platform
    // 可执行文件解析归属：注册表里认领该运行时类型的贡献优先（上游由该类型的
    // `createIntrospector` 在目标机上解析），没有则回落本机的 `runtimeExecutable`（默认档）。
    const executable = first
      ? (executableViaLanguageRuntimeType(first, targetPlatform) ?? runtimeExecutable(first, targetPlatform))
      : ''
    return {
      id: `${CUSTOM_TARGET_PREFIX}${environment.uuid}`,
      name: environment.displayName,
      kind: 'custom' as const,
      description: executable || environment.projectRootOnTarget,
      javaExecutable: first?.typeId === JAVA_RUNTIME_ID ? executable : undefined,
      runtime: first,
      uuid: environment.uuid,
      platform: targetPlatform,
    }
  })
}

/**
 * 目标全表（`ExecutionTargetManager.getTargets` 的收集步）：
 * 内建三档（本机 / `app.jdks` 探测的 JDK / 用户自定义目标）+ EP 贡献的两档
 * （`com.intellij.executionTargetProvider` 的提供者给的、`com.intellij.executionTargetType`
 * 的非本机类型自报的）。**按 id 去重、内建在前**：内建默认提供者（上游
 * `DefaultExecutionTargetProvider`）给的就是本机目标那条 ⇒ 无插件时结果与之前逐字一致。
 * `options.project`/`options.profile` 是提供者看到的项目/配置面（消费点 `src/runActions.ts`）。
 */
export function listExecutionTargets(
  jdks: readonly JdkInfo[],
  options: {
    custom?: readonly TargetEnvironment[]
    platform?: TargetPlatform
    project?: { root?: string | null; name?: string | null }
    profile?: { name: string; type?: string; program?: string; command?: string }
  } = {},
): ExecutionTarget[] {
  const platform = options.platform ?? currentTargetPlatform()
  const base = [localExecutionTarget(), ...jdkExecutionTargets(jdks, platform), ...customExecutionTargets(options.custom ?? [], platform)]
  const project = { root: options.project?.root ?? null, name: options.project?.name ?? null }
  const profile = options.profile ?? { name: '' }
  const contributed = [
    ...executionTargetsFromRegisteredTypes(project),
    ...executionTargetsFromProviders(project, profile),
  ]
  const seen = new Set(base.map(target => target.id))
  const out = [...base]
  for (const target of contributed) {
    if (!target?.id || seen.has(target.id)) continue
    seen.add(target.id)
    out.push(target)
  }
  return out
}

export function targetById(targets: readonly ExecutionTarget[], id: string | undefined): ExecutionTarget | undefined {
  if (!id) return undefined
  return targets.find(target => target.id === id)
}


export interface TargetStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** `RunTargetsEnabled` 注册表开关（缺省开；关掉时 UI 只给本机目标）。 */
export function readRunTargetsEnabled(store?: TargetStore): boolean {
  try {
    const source = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    return source?.getItem(RUN_TARGETS_ENABLED_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeRunTargetsEnabled(store: TargetStore | undefined, enabled: boolean): void {
  try {
    const target = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    target?.setItem(RUN_TARGETS_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch { /* 存储不可用时只影响持久化 */ }
}

/**
 * 目标对配置初值的作用（上游「Run on target」选中的运行时决定执行环境）：
 * 目标挂的运行时若与配置现有程序同形态（Java 目标的 `java`/`javaw`、Gradle 目标的 `gradle`、
 * Python 目标的 `python`…），把程序换成该运行时的可执行文件；其余情况只保留目标记录。
 * 判据是 `LanguageRuntimeTypeDef.matches`（src/languageRuntimes.ts），与上游「配置类型自己
 * `findLanguageRuntime` 查自己的运行时数据」是同一条路：只有配了对应语言的配置才被换。
 * 上游对没有匹配运行时的配置不换、也不报错（`CompoundRunConfiguration.kt:150` 回落默认目标），
 * 这里保持同样语义：返回空对象表示「不动」。
 */
/**
 * 目标对配置初值的作用（上游「Run on target」选中的运行时决定执行环境）：
 * 目标挂的运行时若与配置现有程序同形态（Java 目标的 `java`/`javaw`、Gradle 目标的 `gradle`、
 * Python 目标的 `python`…），把程序换成该运行时的可执行文件；其余情况只保留目标记录。
 * 判据是 `LanguageRuntimeTypeDef.matches`（src/languageRuntimes.ts），与上游「配置类型自己
 * `findLanguageRuntime` 查自己的运行时数据」是同一条路：只有配了对应语言的配置才被换。
 * 上游对没有匹配运行时的配置不换、也不报错（`CompoundRunConfiguration.kt:150` 回落默认目标），
 * 这里保持同样语义：返回空对象表示「不动」。
 *
 * 顺序照上游：先问**目标环境请求调节器工厂**（`com.intellij.runConfigurationTargetEnvironmentAdjusterFactory`
 * 的 `Factory.isEnabledFor` → `createAdjuster` → `adjust`，上游在拿请求之前调它），没人认领再走
 * 内建的「运行时归属」判定。没有工厂时（上游平台内的默认档）与之前逐字一致。
 */
export function applyTargetToTemplateProgram(
  template: { program?: string; command?: string }, target: ExecutionTarget | undefined,
): { program?: string; command?: string } {
  if (!target || target.kind === 'local') return {}
  const adjusted = adjustViaTargetEnvironmentFactories(template, {
    id: target.id, name: target.name, runtimeTypeId: target.runtime?.typeId, homePath: target.runtime?.homePath,
  })
  if (adjusted) {
    return {
      ...(adjusted.program !== undefined ? { program: adjusted.program } : {}),
      ...(adjusted.command !== undefined ? { command: adjusted.command } : {}),
    }
  }
  if (!target.runtime) return {}
  const executable = runtimeExecutable(target.runtime, target.platform ?? currentTargetPlatform())
  if (!executable) return {}
  const type = languageRuntimeType(target.runtime.typeId)
  if (!type) return {}
  if (!runtimeOwnsProgram(type, template.program, template.command)) return {}
  return { program: executable }
}

/** 目标在 UI 上的完整标题（选择器 option 用）。 */
export function describeExecutionTarget(target: ExecutionTarget): string {
  return target.kind === 'local' ? target.name : `${target.name} — ${target.description}`
}

// ── ExecutionTargetsToolbarGroup（上游 `intellij.platform.execution.impl.actions.xml:127-129`）──
//
// 那一组是 `searchable="false" popup="false"`，里面**只有**一个 `ExecutionTargets`
// （`ExecutionTargetComboBoxAction`，`intellij.platform.execution.impl.actions.xml:47`），
// 由 `ExecutionActions.xml:133-135` 挂在 `MainToolbarRight` 上、`NewUiRunWidget` 之前
// （后者 `:117-119` 是 `anchor="first"`，所以目标组实际排在运行 widget 最前面）。
//
// 行为逐条对 `platform/execution-impl/.../actions/ExecutionTargetComboBoxAction.kt`：
//   · `:48-63` `update` —— 活动目标是 `DefaultExecutionTarget`（本机）或外部托管时
//     **整个格子隐藏**；所以「本机目标时不占一格」是上游行为，不是本仓偷懒；
//   · `:66-69` 可见时：文字 = 活动目标显示名（`trimMiddle` 到 80 字）、图标、描述；
//   · `:87-107` 弹层：先列**无分组**的目标（`groupName == null`），再按分组名**排序**列有分组的，
//     每组前插一个带组名的分隔条（`:101-104` + `:114-117`）；
//   · `:118` 每个目标一条，标题是显示名、描述是 `ExecutionBundle.properties:484` 的
//     `select.0=Select {0}`、可用性 = `target.isReady`（`:158-160`）—— 所以不可用的目标
//     **留在列表里但点不动**（`:141-142` `shouldShowDisabledActions() = true`），
//     不是隐藏，也不是可点。
//   · `:59` 活动目标来自 `ExecutionTargetManager.getActiveTarget(project)`；本仓的落点是
//     localStorage（与 `RunTargetsEnabled` 同一策略），键 `taocode.activeExecutionTarget`。

export const ACTIVE_EXECUTION_TARGET_KEY = 'taocode.activeExecutionTarget'
/** `:34` `MAX_TARGET_DISPLAY_LENGTH = 80`：`StringUtil.trimMiddle` 的上限。 */
export const EXECUTION_TARGET_TEXT_MAX = 80

/** `select.0=Select {0}`（ExecutionBundle.properties:484）。 */
export function selectTargetDescription(target: ExecutionTarget): string {
  return `Select ${target.name}`
}

/** `StringUtil.trimMiddle(text, 80)`：超长时中间省略，两头各留一半。 */
export function trimTargetText(text: string, max = EXECUTION_TARGET_TEXT_MAX): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  return `${text.slice(0, head)}...${text.slice(text.length - (max - 1 - head))}`
}

/** 活动目标 id（`ExecutionTargetManager.getActiveTarget`）。没设过 = 本机。 */
export function readActiveExecutionTargetId(store?: TargetStore): string {
  try {
    const source = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    return source?.getItem(ACTIVE_EXECUTION_TARGET_KEY) ?? LOCAL_TARGET_ID
  } catch {
    return LOCAL_TARGET_ID
  }
}

export function writeActiveExecutionTargetId(store: TargetStore | undefined, id: string): void {
  try {
    const source = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    source?.setItem(ACTIVE_EXECUTION_TARGET_KEY, id)
  } catch { /* 存储不可用只影响持久化，本会话内仍能切 */ }
}

/** 目标能不能选（`target.isReady`，`:158-160`）。本仓：没有可执行文件的自定义目标不可选。 */
export function isTargetReady(target: ExecutionTarget): boolean {
  return target.kind === 'local' || !!target.javaExecutable || !!target.runtime?.homePath.trim()
}

/** 活动目标（`getActiveTarget`）。列里没有就回落本机。 */
export function activeExecutionTarget(targets: readonly ExecutionTarget[], activeId: string): ExecutionTarget {
  return targetById(targets, activeId) ?? localExecutionTarget()
}

export interface ExecutionTargetsToolbarEntry {
  /** 活动目标是本机/外部托管时**整格隐藏**（`:60-63`）。 */
  visible: boolean
  text: string
  description: string
  target: ExecutionTarget
}

/** 那一格显示什么（`update`，`:48-70`）。 */
export function executionTargetsToolbarEntry(
  targets: readonly ExecutionTarget[], activeId: string,
): ExecutionTargetsToolbarEntry {
  const target = activeExecutionTarget(targets, activeId)
  if (target.kind === 'local') return { visible: false, text: target.name, description: target.description, target }
  return { visible: true, text: trimTargetText(target.name), description: target.description, target }
}

export interface ExecutionTargetPopupRow {
  /** 分隔条 = 该组第一个目标的名字（`Separator.create(targetGroupName)`，`:115`）。 */
  kind: 'separator'
  label: string
}
export interface ExecutionTargetPopupItem {
  kind: 'target'
  id: string
  label: string
  description: string
  selected: boolean
  disabled: boolean
  target: ExecutionTarget
}
export type ExecutionTargetPopupEntry = ExecutionTargetPopupRow | ExecutionTargetPopupItem

/**
 * 弹层条目（`getTargetActions` + `getTargetGroupActions`，`:87-120`）。
 * 本仓的分组键 = 目标种类（本地 / JDK / 自定义）—— 上游是 `ExecutionTarget.getGroupName()`
 * 由各个 provider 自报，本仓的目标只有这三类来源，编不出一张自报表，按种类分组最贴近。
 * 顺序：无分组的那一批在前（`:96-99`），有分组的按组名排序（`:101-104`）。
 */
export function executionTargetPopupEntries(
  targets: readonly ExecutionTarget[], activeId: string,
): ExecutionTargetPopupEntry[] {
  const active = activeExecutionTarget(targets, activeId)
  const plain = targets.filter(target => target.kind === 'local')
  const grouped = targets.filter(target => target.kind !== 'local')
  const groupOrder = [...new Set(grouped.map(target => target.kind))].sort()
  const out: ExecutionTargetPopupEntry[] = []
  for (const target of plain)
    out.push({ kind: 'target', id: target.id, label: target.name, description: selectTargetDescription(target),
               selected: target.id === active.id, disabled: !isTargetReady(target), target })
  for (const kind of groupOrder) {
    out.push({ kind: 'separator', label: kind === 'jdk' ? 'JDK' : '自定义目标' })
    for (const target of grouped.filter(item => item.kind === kind))
      out.push({ kind: 'target', id: target.id, label: target.name, description: selectTargetDescription(target),
                 selected: target.id === active.id, disabled: !isTargetReady(target), target })
  }
  return out
}

