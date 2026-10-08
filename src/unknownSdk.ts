// 「未知 / 失效 SDK」的检测与修复建议 —— 上游 `platform/lang-impl/src/com/intellij/openapi/projectRoots/impl/`
// 的 `UnknownSdkCollector` / `UnknownMissingSdk` / `UnknownInvalidSdk` / `UnknownSdkFix` 一族里
// 可移植的那一半（lp/roots ③）。
//
// 上游依据（逐条核过本机上游树）：
//   · `UnknownSdkCollector.kt:139-176` `collectSdksUnderReadAction`：遍历项目 SDK 与各模块的 JDK
//     序根条目，**名字在、实体不在**的收进 `sdkToTypes`；`sdkToTypes` 里同一个名字对应**多个不同
//     类型** ⇒ 进 `totallyUnknownSdks`（连类型都定不了，给不出修复建议），类型唯一 ⇒ 进
//     `resolvableSdks`（`MissingSdkInfo(name, type)`）。最后按 `TreeSet(CASE_INSENSITIVE_ORDER)` 排序。
//   · `UnknownSdkCollector.kt:31-45` `UnknownSdkSnapshot` 三个字段（`totallyUnknownSdks`/
//     `resolvableSdks`/`knownSdks`）与 `:46-75` 的 `equals`/`hashCode`（按名字集合 + 已知 SDK 状态哈希判等）。
//   · `UnknownMissingSdk.java:23-56`：`createMissingSdkFix` —— **本地已探测到的 SDK 优先**，
//     没有才谈下载；两者都没有时 `getSuggestedFixAction()` 返 null（`UnknownSdkFix.java:29-30`）。
//   · `UnknownInvalidSdk.java:33-59`：`UnknownInvalidSdk(sdk, sdkType)`，`getSdkName`/`getExpectedVersionString`
//     取已有 SDK 的名字/版本；`:59-70` `copySdk(versionString, home)` 就是「修复」的动作面。
//   · `UnknownSdkFix.java:18-42` 的文案面：`getNotificationText`/`getSdkTypeAndNameText`/
//     `getIntentionActionText`/`getConfigureActionText`/`getSuggestedFixAction`。
//   · 文案键：`platform/ide-core/resources/messages/ProjectBundle.properties:187`
//     `notification.text.config.unknown.sdk={0} "{1}" is missing`、`:188` 的 invalid 版
//     `... is not found on the disk or corrupted`、`:196` `config.unknown.sdk.local=Use existing {0} {1}`、
//     `:197` `config.unknown.sdk.configure.missing=Configure missing {0} "{1}"`、
//     `:198` invalid 版、`:282` `dialog.text.resolving.sdks.item={0} "{1}"`、`:283`
//     `unknown.sdk.with.no.name=<unknown>`。
//
// **本仓用什么承接了上游的什么**（架构不等价 ⇒ 用本仓架构还原用户可见功能）：
//   · 上游遍历 `ModuleManager` 的各模块 JDK 序根 → 本仓只有**一个隐式模块**，所以「要求某个
//     名字的 SDK」的来源是 `ProjectSettings.java.jdkHome`/`jdkName`（项目设置里那个字符串）。
//     检测面 = 「设置的 jdkHome 在磁盘上不存在」⇒ invalid；「设置写了 jdkName 但表里/机器上都没有」⇒ missing。
//   · 上游的 `UnknownSdkLocalSdkFix` 来自各 `SdkType` 的探测器（`JavaHomeFinder*`）→ 本仓的等价物是
//     `app.jdks` 探测结果（`src/rootsSdkTable.ts` 的 `SdkTable` 已承接）。
//   · 修复动作：本地有可用 SDK ⇒ 给「使用已探测到的 X」（写回 `jdkHome`）；没有 ⇒ 只给「配置…」
//     （打开项目结构面板）—— **下载那一档本仓没有通道**（与 `pf/update` 同因），如实不给假按钮。
//
// 纯逻辑（检测 + 建议 + 文案），不 import bridge，可单测（`tests/unknown-sdk.test.mjs`）。
// 消费点是 `src/components/ProjectStructurePane.vue` 的 SDK 行告警（`src/rootAppearance.ts` 的 `sdkMissing` 图标）。
import { JAVA_SDK_TYPE, compareSdkVersions, type Sdk } from './rootsSdkTable.ts'

/** 一个「要求了某个 SDK」的诉求（上游 `UnknownSdk` 的 `getSdkName`/`getSdkType` 两格）。 */
export interface UnknownSdkRequest {
  /** 要求的 SDK 名（可空 —— 上游 `UnknownSdk.getSdkName` 允许 null，界面显示 `<unknown>`）。 */
  name: string | null
  /** 要求的类型名（上游 `getSdkType().getName()`）。本仓只有 JavaSDK 一种。 */
  type: string
  /** 期望的版本串（上游 `UnknownSdk.getExpectedVersionString`）；没有就不限。 */
  expectedVersion?: string | null
}

/** 本地探测到的一个候选（上游 `UnknownSdkLocalSdkFix` 的 `getExistingSdkHome`/`getVersionString` 两格）。 */
export interface LocalSdkCandidate {
  home: string
  version: string
  /** 建议名（上游 `getSuggestedSdkName`）；缺省用家目录末段。 */
  suggestedName?: string
}

/** 上游 `UnknownSdkFixConfigurator`/`UnknownSdkFix` 的用户可见面（`:18-42`）。 */
export interface UnknownSdkFix {
  /** `getNotificationText()`：`{0} "{1}" is missing`（`:187`）。 */
  notificationText: string
  /** `getSdkTypeAndNameText()`：`{0} "{1}"`（`:282`）。 */
  sdkTypeAndNameText: string
  /** `getIntentionActionText()`：`Configure missing {0} "{1}"`（`:197`）。 */
  intentionActionText: string
  /** `getConfigureActionText()`：「配置…」（`:189`）。 */
  configureActionText: string
  /** `getSuggestedFixAction()` 的等价物：本地候选（null = 没有本地可用的，只剩「配置…」）。 */
  suggested: LocalSdkCandidate | null
  /** 候选按钮文案（`config.unknown.sdk.local=Use existing {0} {1}`，`:196`）；没有候选时是空串。 */
  suggestedLabel: string
}

/** 检测结果（上游 `UnknownSdkSnapshot` 的三格，`:31-45`）。 */
export interface UnknownSdkSnapshot {
  /** 连类型都定不了的（名字对应多个类型）：给不出建议（`totallyUnknownSdks`）。 */
  totallyUnknownSdks: string[]
  /** 类型唯一的可解析诉求（`resolvableSdks`）。 */
  resolvableSdks: UnknownSdkRequest[]
  /** 已登记/已探测到的（`knownSdks`，按名排序）。 */
  knownSdks: Sdk[]
}

/** `unknown.sdk.with.no.name`（`:283`）。 */
export const UNKNOWN_SDK_NO_NAME = '<unknown>'

/** `getSdkNameForUi`（`UnknownMissingSdk.java:60-64`）：没名字显示 `<unknown>`。 */
export function sdkNameForUi(request: UnknownSdkRequest): string {
  const name = (request.name ?? '').trim()
  return name || UNKNOWN_SDK_NO_NAME
}

/** `notification.text.config.unknown.sdk`（`:187`）与 invalid 版（`:188`）的 zh 措辞（本仓自拟）。 */
export function unknownSdkNotificationText(request: UnknownSdkRequest, sdkTypeLabel = 'SDK'): string {
  return `${sdkTypeLabel}「${sdkNameForUi(request)}」缺失。`
}

/** `notification.text.config.invalid.sdk`（`:188`）：磁盘上不存在或已损坏。 */
export function invalidSdkNotificationText(request: UnknownSdkRequest, sdkTypeLabel = 'SDK'): string {
  return `${sdkTypeLabel}「${sdkNameForUi(request)}」在磁盘上不存在或已损坏。`
}

/** `dialog.text.resolving.sdks.item`（`:282`）= `{0} "{1}"`。 */
export function sdkTypeAndNameText(request: UnknownSdkRequest, sdkTypeLabel = 'SDK'): string {
  return `${sdkTypeLabel}「${sdkNameForUi(request)}」`
}

/** `config.unknown.sdk.configure.missing`（`:197`）/ invalid 版（`:198`）。 */
export function configureMissingSdkText(request: UnknownSdkRequest, sdkTypeLabel = 'SDK'): string {
  return `配置缺失的${sdkTypeLabel}「${sdkNameForUi(request)}」`
}

/** `action.text.config.unknown.sdk.configure`（`:189`）。 */
export const CONFIGURE_SDK_ACTION_TEXT = '配置…'

/** `config.unknown.sdk.local`（`:196`）= `Use existing {0} {1}`。 */
export function useExistingSdkText(candidate: LocalSdkCandidate, sdkTypeLabel = 'SDK'): string {
  const version = candidate.version ? ` ${candidate.version}` : ''
  return `使用已探测到的${sdkTypeLabel}${version}`
}

/**
 * `UnknownSdkCollector.kt:158-175` 的收集：把「要求了但没实体」的诉求按名字聚合。
 *   · 同名对应**多个不同类型** ⇒ `totallyUnknownSdks`（`:160-163`）；
 *   · 类型唯一 ⇒ `resolvableSdks`（`:169-171`）；
 *   · 名字大小写不敏感归并（`:140` 的 `TreeSet(CASE_INSENSITIVE_ORDER)`）。
 * `known` 是已经登记/探测到的 SDK（名字 + 类型都对上就不算 unknown，`：152-156` 的 `knownSdks.add`）。
 */
export function collectUnknownSdks(requests: readonly UnknownSdkRequest[], known: readonly Sdk[]): UnknownSdkSnapshot {
  const byName = new Map<string, { display: string; types: Set<string>; request: UnknownSdkRequest }>()
  for (const request of requests) {
    const name = (request.name ?? '').trim()
    if (!name) continue
    // 名字 + 类型都对上已知的 ⇒ 不是 unknown（上游 `knownSdks.add(projectSdk)` 那一支）。
    if (known.some(sdk => sdk.name === name && sdk.type === request.type)) continue
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) existing.types.add(request.type)
    else byName.set(key, { display: name, types: new Set([request.type]), request })
  }
  const totallyUnknownSdks: string[] = []
  const resolvableSdks: UnknownSdkRequest[] = []
  for (const entry of byName.values()) {
    if (entry.types.size > 1) totallyUnknownSdks.push(entry.display)
    else resolvableSdks.push({ ...entry.request, name: entry.display })
  }
  // 上游两个集合都按大小写不敏感的名字序（`:158` 的 TreeSet；knownSdks 在 `:175` 按名排）。
  const compare = (a: string, b: string) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0
  totallyUnknownSdks.sort(compare)
  resolvableSdks.sort((a, b) => compare(sdkNameForUi(a), sdkNameForUi(b)))
  return { totallyUnknownSdks, resolvableSdks, knownSdks: [...known].sort((a, b) => compare(a.name, b.name)) }
}

/**
 * `UnknownMissingSdk.createMissingSdkFix`（`:23-56`）的判定顺序：**本地候选优先**，没有就 null
 * （下载那一档本仓没有通道，`getSuggestedFixAction()` 返 null ⇒ 界面只留「配置…」）。
 * 候选匹配（上游 `UnknownSdk.getSdkVersionStringPredicate`）：给了期望版本就按**同主版本**筛
 * （`compareSdkVersions` 的第一段相等），没给就取版本最高的那个（`SdkTable.findMostRecentSdkOfType` 同口径）。
 */
export function localFixFor(request: UnknownSdkRequest, candidates: readonly LocalSdkCandidate[]): LocalSdkCandidate | null {
  const usable = candidates.filter(candidate => candidate.home.trim())
  if (!usable.length) return null
  const expected = (request.expectedVersion ?? '').trim()
  if (expected) {
    const major = expected.split(/[.\-_]/)[0] ?? ''
    const sameMajor = usable.filter(candidate => (candidate.version.split(/[.\-_]/)[0] ?? '') === major)
    if (sameMajor.length) return sameMajor.reduce((best, item) => compareSdkVersions(item.version, best.version) > 0 ? item : best)
  }
  return usable.reduce((best, item) => compareSdkVersions(item.version, best.version) > 0 ? item : best)
}

/** 组装一条 `UnknownSdkFix`（`UnknownSdkFix.java:18-42` 的文案面 + `:29-30` 的建议动作）。 */
export function unknownSdkFix(request: UnknownSdkRequest, candidates: readonly LocalSdkCandidate[], invalid = false, sdkTypeLabel = 'SDK'): UnknownSdkFix {
  const suggested = localFixFor(request, candidates)
  return {
    notificationText: invalid ? invalidSdkNotificationText(request, sdkTypeLabel) : unknownSdkNotificationText(request, sdkTypeLabel),
    sdkTypeAndNameText: sdkTypeAndNameText(request, sdkTypeLabel),
    intentionActionText: configureMissingSdkText(request, sdkTypeLabel),
    configureActionText: CONFIGURE_SDK_ACTION_TEXT,
    suggested,
    suggestedLabel: suggested ? useExistingSdkText(suggested, sdkTypeLabel) : '',
  }
}

/**
 * 本仓的**检测入口**：项目设置里写的 `jdkHome` 与机器上探测到的候选，折成一个 snapshot。
 *   · `jdkHome` 非空、不在候选里、且磁盘上没有它 ⇒ 一条 invalid 诉求（`UnknownInvalidSdk`：
 *     「设置指向的那个 SDK 在磁盘上不存在」，名字取 `jdkName` 或家目录末段）。
 *   · **没有 missing（按名）这一支**：上游的 `getSdkName` 是「某个模块/项目按名要求的 SDK」，
 *     本仓只有一个隐式模块，`jdkName` 在这里是**语言级别标签**（`JavaSE-17`，见
 *     `src/rootAppearance.ts` 的 `sdkAppearance`），不是要求的 SDK 名 —— 拿它当名字要求会
 *     每个健康项目都报「缺失」，那是假告警。所以这一支如实不做。
 * 两者都为空（没配路径）⇒ 没有 unknown（用语言服务自动检测，与 `sdkAppearance` 同口径）。
 */
export interface ProjectSdkInput {
  jdkHome: string
  jdkName: string
  /** 机器上探测到的候选（`app.jdks`）。 */
  detected: readonly LocalSdkCandidate[]
  /** 已知/已登记的 SDK（`SdkTable`）。 */
  known: readonly Sdk[]
  /** 家目录在磁盘上是否真的存在（调用方按工作区清单/探测结果判）；缺省 true。 */
  homeExists?: (home: string) => boolean
}

export function projectUnknownSdkSnapshot(input: ProjectSdkInput): UnknownSdkSnapshot {
  const home = input.jdkHome.trim()
  const name = input.jdkName.trim()
  const requests: UnknownSdkRequest[] = []
  const exists = input.homeExists ?? (() => true)
  if (home) {
    const candidate = input.detected.find(item => item.home.replace(/[\\/]+$/, '').toLowerCase() === home.replace(/[\\/]+$/, '').toLowerCase())
    if (!candidate && !exists(home)) requests.push({ name: name || home.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null, type: JAVA_SDK_TYPE, expectedVersion: null })
  }
  return collectUnknownSdks(requests, input.known)
}

/**
 * 修复动作的落点：把选中的本地候选写回项目设置（`jdkHome`/`jdkName`）。
 * 上游 `UnknownInvalidSdk.copySdk`（`:59-70`）改的是已有 SDK 的 version/home 并 `commitChanges`；
 * 本仓没有可写锁的 SDK 实体，等价物是写 `ProjectSettings.java` 那两个字段。
 * 返回要给 `project.settings.update` 的 `java` 补丁（**不含**其他字段，调用方自己合）。
 */
export function sdkFixPatch(candidate: LocalSdkCandidate): { jdkHome: string; jdkName: string } {
  return { jdkHome: candidate.home, jdkName: candidate.suggestedName ?? (candidate.home.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '') }
}