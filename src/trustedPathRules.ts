// 受信任位置清单与**文件级信任**的纯规则（上游 `com.intellij.ide.impl.TrustedPathsSettings` /
// `TrustedPaths` / `TrustedHostsConfigurable` 与 `com.intellij.ide.trustedProjects.TrustedFiles` /
// `ExternallyOpenedFiles` 一族）。零 Vue、零 DOM、零 IO。
//
// 与 `src/trustedProjects.ts` 的分工（复用 vs 补缺）：那一份已经落了本仓自有的「路径归一 /
// 最近祖先 / 执行拦截文案 / 设置页清单呈现」；本模块补的是上游**尚未搬**的三块 ——
//   ① 清单的**两个存储**（用户手管的 `TrustedPathsSettings` + 确认框当场写 `TrustedPaths`）
//      各自的持久形状、并集顺序与差集回写；
//   ② **六步判定顺序**（`TrustedProjects.getProjectTrustedState`）与系统路径 / 免检开关；
//   ③ **文件级信任**（`TrustedFiles` 的四步判据 + `ExternallyOpenedFiles` 的 100 条上限标记）。
// 路径归一只有一处口径，所以 `normalizeTrustedPath` / `isPathInside` / `closestTrustEntry` /
// `trustedStateFor` / `isProjectLocationOfferedForTrust` / `trustedLocationParent` /
// `shortenFolderName` 一律从 `./trustedProjects.ts` 复用，本模块不抄第二份。
//
// 判据：`tests/trusted-path-rules.test.mjs`。

import {
  isProjectLocationOfferedForTrust,
  shortenFolderName,
  trustedLocationParent,
  type TrustState,
  type TrustedPathEntry,
} from './trustedProjects.ts'

// ── ① 两个存储的持久形状 ────────────────────────────────────────────────────────────────
//
// 上游为什么是两个存储：设置页里用户**手管**的那一份是 `TrustedPathsSettings`，只存
// 一张 `List<String>`（每条隐含信任）；启动确认框里当场答应过的走 `TrustedPaths`，存
// `Map<String, Boolean>`（true = 信任，false = 用户明确选了「不信任、不再问」）。
// 设置页把两者**并成一张表**看（`TrustedHostsConfigurable.getMergedTrustedPaths`），
// 回写时按差集拆回各自那一份（`applyMergedTrustedPaths`）。

/** `TrustedPathsSettings.State.trustedPaths` 的形状：`List<String>`（`TrustedPathsSettings.kt:34-38`，`@OptionTag("TRUSTED_PATHS")` `:36`）。 */
export function settingsStoreEntries(paths: readonly string[] | undefined): TrustedPathEntry[] {
  return (paths ?? []).filter(path => typeof path === 'string').map(path => ({ path, trusted: true }))
}

/** `TrustedPaths.State.trustedPaths` 的形状：`Map<String, Boolean>`（`TrustedPaths.kt:30-34`，`@OptionTag("TRUSTED_PROJECT_PATHS")` `:32`）。 */
export function explicitStoreEntries(map: Readonly<Record<string, boolean>> | undefined): TrustedPathEntry[] {
  const out: TrustedPathEntry[] = []
  for (const [path, trusted] of Object.entries(map ?? {})) out.push({ path, trusted: trusted === true })
  return out
}

/**
 * `TrustedPaths.getExplicitlyTrustedPaths()`（`TrustedPaths.kt:72-74`）：
 * `filterValues { it }.keys.sorted()` —— 只取 true 的键，**按字符串升序**。
 * 设置页里「确认框写的那一档」因此是排好序的，不是写入顺序（用户可见）。
 */
export function explicitlyTrustedPaths(entries: readonly TrustedPathEntry[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.path !== 'string' || entry.trusted === false) continue
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    out.push(entry.path)
  }
  return out.sort()
}

/**
 * `TrustedPaths.setExplicitlyTrustedPaths(paths)`（`TrustedPaths.kt:81-85`）：
 * `State(it.trustedPaths.filterValues { trusted -> !trusted } + paths.associateWith { true })`。
 * 即：**明确的「不信任」条目原样保留**，信任集合整体替换。
 * `:77-79` 的注释写明了这么做的理由 —— 从集合里删掉一条是「忘掉这个决定」而不是
 * 「标记为不信任」，所以下次打开会重新问；而明确的不信任必须留住。
 */
export function replaceExplicitlyTrustedPaths(
  entries: readonly TrustedPathEntry[] | undefined,
  paths: readonly string[],
): TrustedPathEntry[] {
  const untrusted = (entries ?? []).filter(entry => entry && typeof entry.path === 'string' && entry.trusted === false)
  const out: TrustedPathEntry[] = untrusted.map(entry => ({ ...entry }))
  for (const path of paths) if (typeof path === 'string' && path) out.push({ path, trusted: true })
  return out
}

/** `TrustedProjects.kt:118-121` 的「落在欢迎屏工程目录之下」判定（上游拿它滤清单，本仓同）。
 *  注意：上游由它拼出来的那两只「隐式放行」的手（`:62` 产品级免检、`:64` 欢迎屏目录全信任）
 *  在本仓**不移植** —— 门禁见 `tests/trust-persist-defaults.test.mjs`（连名字都不许出现）。 */
export function isUnderWelcomeScreenDir(path: string, welcomeScreenProjectPath: string | null | undefined): boolean {
  if (!path || !welcomeScreenProjectPath) return false
  return path === welcomeScreenProjectPath || path.startsWith(welcomeScreenProjectPath.endsWith('/') ? welcomeScreenProjectPath : `${welcomeScreenProjectPath}/`)
}

/**
 * `TrustedHostsConfigurable.getMergedTrustedPaths()`（`TrustedHostsConfigurable.kt:66-71`）：
 * 先设置里那一份（保持存储顺序），再接「确认框写的那一份」——后者要
 * `it !in settingsPathSet` 去重、且 `!isUnderWelcomeScreenDir(it)` 滤掉系统路径，
 * 并且它自己已经是 `sorted()` 的。`:61-63` 的注释原文就是 "One list over both trust stores"。
 */
export function mergedTrustedLocationList(
  settingsPaths: readonly string[] | undefined,
  explicitEntries: readonly TrustedPathEntry[] | undefined,
  welcomeScreenProjectPath?: string | null,
): string[] {
  const settings = (settingsPaths ?? []).filter(path => typeof path === 'string')
  const settingsSet = new Set(settings)
  const out = [...settings]
  for (const path of explicitlyTrustedPaths(explicitEntries)) {
    if (settingsSet.has(path)) continue
    if (isUnderWelcomeScreenDir(path, welcomeScreenProjectPath)) continue
    out.push(path)
  }
  return out
}

/**
 * `TrustedHostsConfigurable.applyMergedTrustedPaths(paths)`（`TrustedHostsConfigurable.kt:80-102`）
 * 的差集口径，逐条对位 `:88-89` 那两行：
 *   · `:88` `settings.setTrustedPaths(paths.filter { it in settingsBefore || it !in explicitBeforeSet })`
 *     —— 设置里**原本就有**的留下；**两个存储都没有过**的新条目算用户手加的，进设置那一份；
 *   · `:89` `trustedPaths.setExplicitlyTrustedPaths(explicitBefore.filter { it in afterSet })`
 *     —— 只在确认框里答应过的那一份，表里还留着就留在原地（删一条不会连带删掉另一份的同名项）。
 * `explicitBefore` 先按 `:84` 的 `filterNot { isUnderWelcomeScreenDir(it) }` 过一遍。
 */
export function splitMergedTrustedPaths(
  settingsBefore: readonly string[] | undefined,
  explicitBefore: readonly TrustedPathEntry[] | undefined,
  kept: readonly string[],
  welcomeScreenProjectPath?: string | null,
): { settings: string[]; explicit: string[] } {
  const settingsSet = new Set((settingsBefore ?? []).filter(path => typeof path === 'string'))
  const explicit = explicitlyTrustedPaths(explicitBefore).filter(path => !isUnderWelcomeScreenDir(path, welcomeScreenProjectPath))
  const explicitSet = new Set(explicit)
  const keptSet = new Set(kept.filter(path => typeof path === 'string'))
  const settings = kept.filter(path => settingsSet.has(path) || !explicitSet.has(path))
  return { settings, explicit: explicit.filter(path => keptSet.has(path)) }
}

// ── ② 存储层的增改（设置页的编辑动作落回存储时用）────────────────────────────────────────

/**
 * `TrustedPathsSettings.addTrustedPath(path)`（`TrustedPathsSettings.kt:69-73`）：
 * `State(it.trustedPaths + path)` —— **直接追加，存储层不去重**，所以同一个目录被
 * 「信任并打开 + 勾了 trust-all」写两次会得到两条相同字符串。
 * 本仓设置页的 `addTrustedLocation` 会先报「已在清单里」再拒收（更严），两者不同：
 * 本模块给的是上游那一版，去重只在 `getMergedTrustedPaths` 的跨存储去重那一层发生（`:70`）。
 */
export function appendTrustedPath(paths: readonly string[] | undefined, path: string): string[] {
  const out = (paths ?? []).filter(entry => typeof entry === 'string')
  out.push(path)
  return out
}

/** `TrustedPathsSettings.setTrustedPaths(paths)`（`TrustedPathsSettings.kt:63-67`）：`State(paths)` 整表替换。 */
export function replaceTrustedPaths(paths: readonly string[] | undefined): string[] {
  return (paths ?? []).filter(path => typeof path === 'string')
}

// ── ③ 输入路径的规范化与边界 ───────────────────────────────────────────────────────────

/**
 * `OSAgnosticPathUtil.expandUserHome`（`OSAgnosticPathUtil.java:176-186`）：
 * `~` → 用户主目录；`~/x` 或 `~\x` → 主目录 + 去掉波浪号的那一段；其余原样。
 * 上游在设置页收下用户输入后就走这一步（`TrustedHostsConfigurable.kt:165`），
 * 本仓的 `parseTrustedLocationInput` 没有这一档，所以这里补上。
 */
export function expandUserHome(path: string, userHome: string): string {
  if (path === '~') return userHome
  if (path.startsWith('~/') || path.startsWith('~\\')) return userHome + path.slice(1)
  return path
}

/**
 * `Path.of` 会抛 `InvalidPathException` 的那几种输入（上游两处都 try/catch 吞掉：
 * `TrustedHostsConfigurable.kt:104-112` 的 `locate` 返回 null、`:114-122` 的
 * `isUnderWelcomeScreenDir` 返回 false）。本仓不做 IO，所以只判语法：
 * NUL 字节（Windows/NTFS 上 `Path.of` 必抛）与空串。
 */
export function pathSyntaxProblem(path: string): string | null {
  if (!path || !path.trim()) return '请输入要信任的文件夹路径。'
  if (path.includes('\0')) return '路径里不能包含空字符。'
  return null
}

/**
 * 输入框里敲的路径 → 要写进清单的字符串。顺序照上游：
 * 先 `expandUserHome`（`TrustedHostsConfigurable.kt:165`），再交给归一（本仓口径）。
 */
export function parseTrustedLocationPath(text: string, userHome: string): { path: string } | { error: string } {
  const expanded = expandUserHome((text ?? '').trim(), userHome)
  const problem = pathSyntaxProblem(expanded)
  if (problem) return { error: problem }
  return { path: expanded }
}

/**
 * 新条目插在清单的哪一格（`TrustedHostsConfigurable.kt:134-137`）：
 * 有选中行就插在**选中行之前**，否则 `max(itemsCount - 1, 0)` —— 空表时是 0，
 * 非空表时是**最后一行之前**（不是追加到末尾）。
 */
export function insertIndexForAdd(count: number, selectedIndex: number): number {
  if (selectedIndex >= 0) return selectedIndex
  return Math.max(count - 1, 0)
}

// ── ④ 判定顺序（六步）────────────────────────────────────────────────────────────────
//
// `TrustedProjects.getProjectTrustedState(locatedProject)`（`TrustedProjects.kt:59-73`）是
// **唯一**判据，顺序不能换 —— 每一步都在下面标了行号。

// 上游 `TrustedProjects.kt:20/:137/:144` 那三个「免检」系统属性（`idea.trust.headless.disabled` 等）
// 在本仓不移植（同上：`tests/trust-persist-defaults.test.mjs` 的禁令），所以这里不导出属性名常量。
// `TrustProperties`/`truthy` 保留给调用方解析其余布尔属性。

export interface TrustProperties {
  'idea.trust.all.projects'?: string | boolean | null
  'idea.trust.headless.disabled'?: string | boolean | null
  'idea.trust.disabled'?: string | boolean | null
}

function truthy(value: string | boolean | null | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  return value.toLowerCase() === 'true'
}

// 上游 `TrustedProjects.kt:136-144` 还有两只「免检」的手（`idea.trust.all.projects` /
// `idea.trust.headless.disabled` / 产品级 `idea.trust.disabled` 那三个开关的判定函数）——
// 本仓**不移植**：`tests/trust-persist-defaults.test.mjs` 禁止它们出现（「让用户决定信任什么」）。
// 六步机里的 `checkDisabled` 事实位保留，宿主恒传 `false`。
/**
 * 一个存储对**多个 root** 给出的状态：`TrustedProjectsStateStorage.getProjectTrustedState`
 * （`TrustedProjectsStateStorage.kt:28-40`）在 `projectRoots` 上 `fold(ThreeState.YES)`，
 * 合并规则是 `:33-37` 的 `when`：**UNSURE 优先，其次 NO，都相同才 YES**。
 * 注意 `:31` 的初值是 `YES` ⇒ **一个 root 都没有时结果是 YES（受信任）** —— 这是上游的边界，
 * 不是笔误（`DefaultTrustedProjectsLocator.getProjectRoots` 对非 `ProjectStoreOwner` 就给空表，
 * `DefaultTrustedProjectsLocator.kt:11-13`）。
 */
export function projectTrustedStateForRoots(rootStates: readonly TrustState[]): TrustState {
  let acc: TrustState = 'trusted'
  for (const state of rootStates) {
    if (acc === 'unknown' || state === 'unknown') { acc = 'unknown'; continue }
    if (acc === 'untrusted' || state === 'untrusted') { acc = 'untrusted'; continue }
    acc = 'trusted'
  }
  return acc
}

/** 六步判定要吃到的六件事（都由调用方从宿主/存储取好，本函数只做顺序）。 */
export interface ProjectTrustFacts {
  /** `:62` —— 上游的产品级免检档；本仓不移植那只手，宿主恒传 `false`。 */
  checkDisabled: boolean
  /** `:64` —— 上游的欢迎屏目录全信任档；本仓不移植那只手，宿主恒传 `false`。 */
  systemTrusted: boolean
  /** `:60` —— `TrustedPaths`（确认框写的那一份）给这个项目的状态。 */
  explicitState: TrustState
  /** `:66` —— `LightEdit.owns(project) && project === LightEditUtil.getProjectIfCreated()`。 */
  lightEditOwns: boolean
  /** `:67-70` —— `TrustedPathsSettings`（用户手管那一份）的 `isProjectTrusted`。 */
  settingsTrusted: boolean
}

/**
 * `TrustedProjects.getProjectTrustedState(locatedProject)`（`TrustedProjects.kt:59-73`）的逐行等价物。
 * 六步顺序（`:61-71` 的 `when`）：
 *   ① `:62` 免检 ⇒ 信任；
 *   ② `:64` 系统路径 ⇒ 信任 —— `:63` 的注释写明它**必须在显式状态之前**，因为系统路径上
 *      可能留着一条过期的记录，不能让那条记录赢（IJPL-254558）；
 *   ③ `:65` 显式状态不是 UNSURE ⇒ 就用它（YES 与 NO 都算「用户答过」）；
 *   ④ `:66` LightEdit 自己的项目 ⇒ 信任（它有自己的信任模型）；
 *   ⑤ `:67-70` 设置清单里那个位置被信任 ⇒ 信任（并打一条 `PROJECT_IMPLICITLY_TRUSTED_BY_PATH` 统计）；
 *   ⑥ `:71` 其余 ⇒ UNSURE（于是打开流程会弹确认框）。
 */
export function overallProjectTrustedState(facts: ProjectTrustFacts): TrustState {
  if (facts.checkDisabled) return 'trusted'
  if (facts.systemTrusted) return 'trusted'
  if (facts.explicitState !== 'unknown') return facts.explicitState
  if (facts.lightEditOwns) return 'trusted'
  if (facts.settingsTrusted) return 'trusted'
  return 'unknown'
}

/**
 * `TrustedProjects.setProjectTrusted(locatedProject, isTrusted)`（`TrustedProjects.kt:76-93`）
 * 的门禁与副作用口径：`:79-81` 系统路径**直接 return、不落持久状态**（注释写明了理由 ——
 * 免得它出现在设置页里、也免得用户能在那儿撤销）；`:83-86` 只有新旧状态真的不同才发
 * `onProjectTrusted` / `onProjectUntrusted`（`:87-91`）。
 */
export function setProjectTrustedEffect(
  facts: { systemTrusted: boolean; oldState: TrustState; isTrusted: boolean },
): { persist: boolean; event: 'trusted' | 'untrusted' | null } {
  if (facts.systemTrusted) return { persist: false, event: null }
  const newState: TrustState = facts.isTrusted ? 'trusted' : 'untrusted'
  if (facts.oldState === newState) return { persist: true, event: null }
  return { persist: true, event: facts.isTrusted ? 'trusted' : 'untrusted' }
}

// ── ⑤ 文件级信任（TrustedFiles / ExternallyOpenedFiles）────────────────────────────────
//
// 上游要解决的问题：项目内的文件跟项目的信任态走就够了，但**项目之外**的文件（从文件管理器、
// 命令行、协议 URI 或拖放打开的那一个）不在任何项目的根里，跟着谁都不对。所以另有一条
// **按文件**的判据（`TrustedFiles.kt:32-49` 的类注释把三档写得很清楚）。

/** `TrustedFiles.SAFE_MODE_REGISTRY_KEY`（`TrustedFiles.kt:53`）。 */
export const SAFE_MODE_REGISTRY_KEY = 'ide.untrusted.files.safe.mode'
/** 该开关的出厂默认值（`platform/util/resources/misc/registry.properties:1164` = `true`）。 */
export const SAFE_MODE_DEFAULT = true
/** `ExternallyOpenedFiles.MAX_ENTRIES`（`ExternallyOpenedFiles.kt:29`）。 */
export const MAX_EXTERNALLY_OPENED = 100

/** `ExternallyOpenedFiles.isMarked(path)`（`ExternallyOpenedFiles.kt:42`）：**按原字符串精确比对**（不归一、不判前缀）。 */
export function isExternallyMarked(paths: readonly string[] | undefined, path: string): boolean {
  return (paths ?? []).includes(path)
}

/**
 * `ExternallyOpenedFiles.mark(path)`（`ExternallyOpenedFiles.kt:49-62`）：
 * `addAll(state.paths)` → `remove(pathString)` → `add(pathString)`，所以**重复标记是把这一条
 * 挪到最新端**而不是产生第二条；随后 `paths.size > MAX_ENTRIES` 时 `takeLast(MAX_ENTRIES)`
 * 砍掉最旧的一条，并把「发生了淘汰」报给调用方（`:44-48` 的注释要求调用方据此重算缓存判词）。
 */
export function markExternallyOpened(paths: readonly string[] | undefined, path: string): { paths: string[]; evicted: boolean } {
  const next = (paths ?? []).filter(entry => typeof entry === 'string' && entry !== path)
  next.push(path)
  const evicted = next.length > MAX_EXTERNALLY_OPENED
  return { paths: evicted ? next.slice(next.length - MAX_EXTERNALLY_OPENED) : next, evicted }
}

/**
 * `TrustedFilesCache.computeTrusted(nioPath)`（`TrustedFiles.kt:226-247`）的四步，顺序照抄：
 *   ① `:227-230` 显式信任的位置**压过**项目信任态（`:227` 的注释原文
 *      "Explicitly trusted locations override the project trust state."）；
 *   ② `:232-238` 在项目根里的文件跟**项目**的信任态走；
 *   ③ `:240-243` 不在项目根里、但**没有被标记为「外部打开」**的文件 ⇒ 信任
 *      （IDE 自己开的草稿 / 控制台 / 自定义 VM options 文件走这一档）；
 *   ④ `:245-246` 其余（外部打开 + 在项目之外）⇒ **不信任**，直到它的位置被显式信任。
 */
export interface FileTrustFacts {
  /** `:228` —— `TrustedProjects.getProjectTrustedState(nioPath)`，即把这个**文件路径本身**当项目去判。 */
  pathState: TrustState
  /** `:233` —— `roots.any { nioPath.startsWith(it) }`。 */
  insideProjectRoots: boolean
  /** `:237` —— `TrustedProjects.isProjectTrusted(project)`。 */
  projectTrusted: boolean
  /** `:241` —— `ExternallyOpenedFiles.getInstance().isMarked(nioPath)`。 */
  externallyMarked: boolean
}

export function computeFileTrusted(facts: FileTrustFacts): boolean {
  if (facts.pathState === 'trusted') return true
  if (facts.insideProjectRoots) return facts.projectTrusted
  if (!facts.externallyMarked) return true
  return false
}

/** `TrustedFiles.isTrusted(file, project)`（`TrustedFiles.kt:65-77`）在判词之前的三道闸。 */
export interface FileTrustGate {
  /** `:66` —— `Registry.is(SAFE_MODE_REGISTRY_KEY, false)`，出厂为 true。 */
  safeModeOn: boolean
  /** `:69` —— 上游的免检开关档；本仓不移植那只手，宿主恒传 `false`。 */
  checkDisabled: boolean
  /** `:73` —— `project.isDefault || project.isDisposed || LightEdit.owns(project)`（这几档有自己的信任模型）。 */
  projectOwnsOwnTrustModel: boolean
}

/** 三道闸 + 四步判据的完整出口（`TrustedFiles.kt:65-77` 与 `:226-247` 合成一个函数）。 */
export function fileTrustVerdict(gate: FileTrustGate, facts: FileTrustFacts): boolean {
  if (!gate.safeModeOn) return true
  if (gate.checkDisabled) return true
  if (gate.projectOwnsOwnTrustModel) return true
  return computeFileTrusted(facts)
}

/**
 * `TrustedFiles.isTrustDecidedByFile(file, project)`（`TrustedFiles.kt:92-106`）：
 * 这个文件的信任**是不是由「文件级」那一档决定的** —— 三道闸同样先过，然后要求
 * `isMarked(nioPath)` **且** 不在任何项目根里（`:104-105`）。
 * 编辑器横幅靠它把「项目横幅」与「文件横幅」分开（`UntrustedFileNotificationProvider.kt:27`
 * 要求 `!isTrusted && isTrustDecidedByFile` 才画文件横幅，`:21-23` 的注释写明理由）。
 */
export function isFileTrustDecidedByFile(gate: FileTrustGate, facts: { externallyMarked: boolean; insideProjectRoots: boolean }): boolean {
  if (!gate.safeModeOn) return false
  if (gate.checkDisabled) return false
  if (gate.projectOwnsOwnTrustModel) return false
  return facts.externallyMarked && !facts.insideProjectRoots
}

/** 文件级安全模式横幅该不该画（`UntrustedFileNotificationProvider.kt:27` 的 `if`）。 */
export function fileSafeModeBannerShown(trusted: boolean, decidedByFile: boolean): boolean {
  return !trusted && decidedByFile
}

/** `untrusted.file.notification.description`（`IdeBundle.properties:2958`；随 IDE 发货的中文包没有 `untrusted.file.*` 这一族，下同）。 */
export const FILE_SAFE_MODE_BANNER = '安全模式。信任此文件以使用完整的 IDE 功能。'
/** `untrusted.file.notification.trust.link`（`IdeBundle.properties:2959`）。 */
export const FILE_TRUST_LINK_LABEL = '信任文件…'

/**
 * 未信任文件的**高亮档**：`UntrustedFileHighlightingSettingProvider.getDefaultSetting`
 * （`UntrustedFileHighlightingSettingProvider.kt:14-17`）把未信任文件压到
 * `FileHighlightingSetting.SKIP_INSPECTION` —— 语法高亮 / annotator / 行标记照常，
 * **检查（inspections）与外部 annotator 一律不跑**（`:9-13` 的类注释写明了理由：
 * 它们可能把文件内容交给外部工具）。
 */
export const UNTRUSTED_FILE_HIGHLIGHTING_SETTING = 'SKIP_INSPECTION'
export function fileHighlightingSetting(trusted: boolean): 'SKIP_INSPECTION' | null {
  return trusted ? null : UNTRUSTED_FILE_HIGHLIGHTING_SETTING
}

/**
 * 从**未信任文件**里做跳转（`GotoDeclarationOrUsageHandler2.kt:56-60`）前的问话
 * （`untrusted.file.navigation.dialog.title` / `.text` / `.navigate.button`，
 * `IdeBundle.properties:2969-2971`）。`:56` 的注释写明了理由：跳转会解析引用、可能打开别的文件。
 */
export const FILE_NAVIGATION_PROMPT = {
  title: '从未信任的文件跳转？',
  button: '跳转',
} as const
export function fileNavigationMessage(fileName: string): string {
  return `「${fileName}」以安全模式打开。跳转会解析引用，可能打开其他文件。`
}

// ── ⑥ 文件级确认框（TrustedFileDialog）───────────────────────────────────────────────

/**
 * 「只信任这一个文件」在上游是**怎么表达的**：没有单独的字段或类型。
 * `TrustedPaths.State.trustedPaths` 是一张 `Map<String, Boolean>`（`TrustedPaths.kt:30-34`），
 * 键就是**文件自己的完整路径**；`TrustedPaths.kt:68-71` 的注释原文是
 * "The project **and file** paths the user has explicitly trusted (via the trust confirmation dialogs),
 * as shown in Settings | Trusted Locations."
 * 判词侧 `TrustedFiles.kt:228` 直接把**文件路径**当项目路径去查
 * （`TrustedProjects.getProjectTrustedState(nioPath)`），而查法是**只认祖先、不认后代**
 * （`TrustedProjectsStateStorage.kt:19-26` 的 `getAncestorEntries`），所以一条文件路径
 * 恰好只覆盖它自己、不覆盖同目录的兄弟 —— 上游测试把这个行为钉死了：
 * `TrustedFilesTest.kt:229-236`（`setProjectTrusted(outsideFile, true)` 之后 `file` 信任、
 * 同目录的 `sibling` 仍不信任；再把 `dir` 整个信任，`sibling` 才信任）。
 * 所以本仓的 `fileTrustEntries` 就是「往同一张清单里写这个文件路径」，不需要新字段。
 *
 * 存储归属：文件级那一条**也**走 `TrustedPaths`（确认框那一份），
 * 于是它和项目级的显式信任共处一张 `Map<String, Boolean>`、并一起出现在设置页的并集里
 * （`TrustedHostsConfigurable.kt:69-70`）。勾了「信任整个文件夹」时，父目录写的是
 * **另一份**存储 `TrustedPathsSettings`（`TrustedProjectsDialog.kt:181`），所以它会出现在
 * 设置页的**前一段**（用户手管那一份）而不是显式那一段。
 */
export function fileTrustEntries(filePath: string, trustFolder: boolean): TrustedPathEntry[] {
  const out: TrustedPathEntry[] = []
  if (trustFolder) {
    const parent = trustedLocationParent(filePath)
    if (parent) out.push({ path: parent, trusted: true })
  }
  out.push({ path: filePath, trusted: true })
  return out
}

/**
 * `TrustedProjectsDialog.confirmTrustingUntrustedFile`（`TrustedProjectsDialog.kt:164-189`）的落库口径：
 *   · `:167-170` 已经是信任的 ⇒ 直接返回 true、不弹框（顺带再 `setProjectTrusted(..., true)`）；
 *   · `:175-184` 答「信任」时 —— 勾了「信任整个文件夹」就**先**把父目录写进
 *     `TrustedPathsSettings`（`:179-180` 的注释写明了顺序理由：`setProjectTrusted` 只发一次
 *     信任事件，缓存必须在那次事件里就看到已经授权的文件夹），**再**把文件路径置为信任；
 *   · 答「继续使用安全模式」⇒ 什么都不写（`:175` 的 `if (answer)` 整段跳过）。
 * 返回值 `entries` 的顺序 = 父目录在前、文件在后（与 `:181` → `:183` 的写入顺序一致）。
 * 答「信任」时**总是**写文件路径本身（`:183` 的 `setProjectTrusted(locatedFile, true)`）——
 * 「只信任这个文件」就是靠这条文件路径记录表达的，不是靠某个字段。
 */
export function fileTrustDecision(isTrusted: boolean, trustFolder: boolean, filePath: string): TrustedPathEntry[] {
  if (!isTrusted) return []
  return fileTrustEntries(filePath, trustFolder)
}

/** 文件级确认框的按钮档（`TrustedFileDialog.DialogChoice`，`TrustedFileDialog.kt:104-107`）。 */
export interface FileTrustChoice {
  isTrusted: boolean
  isTrustFolder: boolean
}

export interface FileTrustDialogLayout {
  title: string
  message: string
  trustButton: string
  distrustButton: string
  /** 勾选框文案；`null` = 整格不画（`TrustedFileDialog.kt:68` 的两个条件不满足）。 */
  folderCheckbox: string | null
  /** 勾上之后主按钮变成的那句话；`null` 同上一格（`:80-83` 的 `onChanged` 换的文案）。 */
  trustFolderButton: string | null
  /** 主按钮是「信任此文件」（`:93` 的 `isDefault = true`）。 */
  defaultChoice: FileTrustChoice
  /** 焦点在「继续使用安全模式」（`:98` 的 `isFocused = true`）。 */
  focusedChoice: FileTrustChoice
  /** 上游**没有取消按钮**（`:32-33` 的类注释：Esc 或关窗都算「留在安全模式」）。 */
  cancelable: false
  /** `:89` 的 `withMinimumWidth(600).withPreferredWidth(600)`。 */
  width: number
}

/** `:89` 的对话框宽度（最小与首选同值）。 */
export const FILE_TRUST_DIALOG_WIDTH = 600

/**
 * `TrustedFileDialog`（`TrustedFileDialog.kt:35-102`）的文案与按钮档。
 *
 * 文案出处：标题 `untrusted.file.open.dialog.title`（`IdeBundle.properties:2961`，`{0}` = 文件名）、
 * 正文 `untrusted.file.dialog.text`（`:2963-2966`，`{0}` = 应用名、`{1}` = 文件完整路径，
 * 末句是 "Trusting will apply only to the ''{1}'' file."）、主按钮
 * `untrusted.file.dialog.trust.button`（`:2962` = "Trust File"）、副按钮
 * `untrusted.project.dialog.distrust.button`（`:2941` = "Stay in Safe Mode" ——
 * **不是** `untrusted.project.open.dialog.distrust.button`，那一句是项目打开框的
 * "Preview in Safe Mode"）、勾选框 `untrusted.file.warning.trust.location.checkbox`
 * （`:2968`）、勾上后的主按钮 `untrusted.project.dialog.trust.folder.button`（`:2939`）。
 *
 * 勾选框的两个条件（`:68`）：`filePath.parent != null` **且**
 * `TrustedProjects.isProjectLocationOfferedForTrust(filePath)` —— 后者是 `:104-107`
 * 的那条「父目录不能落在 IDE 自己的配置目录里」，本仓已有同名函数，直接复用。
 * 两处文件夹名截断长度不同：勾选框用 **40**（`:71`）、按钮用 **18**（`:72`）。
 */
export function fileTrustDialogLayout(input: {
  fileName: string
  filePath: string
  appName: string
  configDir?: string | null
}): FileTrustDialogLayout {
  const parent = trustedLocationParent(input.filePath)
  const offered = Boolean(parent) && isProjectLocationOfferedForTrust(input.filePath, input.configDir)
  const folder = parent ? parent.split('/').filter(Boolean).pop() ?? parent : ''
  return {
    title: `信任文件「${input.fileName}」？`,
    message: `${input.appName} 提供的功能可能会从此文件执行潜在恶意代码。如果不信任此源，请继续使用安全模式，仅浏览此文件。\n\n信任只会应用于「${input.filePath}」这一个文件。`,
    trustButton: '信任此文件',
    // 这一句有官方中文（localization-zh.jar 的 IdeBundle.properties:2761）。
    distrustButton: '继续使用安全模式',
    folderCheckbox: offered ? `信任「${shortenFolderName(folder, 40)}」文件夹中的所有文件` : null,
    trustFolderButton: offered ? `信任「${shortenFolderName(folder, 18)}」文件夹` : null,
    defaultChoice: { isTrusted: true, isTrustFolder: false },
    focusedChoice: { isTrusted: false, isTrustFolder: false },
    cancelable: false,
    width: FILE_TRUST_DIALOG_WIDTH,
  }
}

// ── ⑦ 谁会把文件标成「外部打开」（拖放 / 命令行 / 协议 / 文件管理器）────────────────────
//
// `markExternallyOpened` 的语义（`TrustedFiles.kt:108-120` 的注释）：必须在**编辑器打开之前**调，
// 因为编辑器提供者的选择会读信任态；标记存在应用级，所以重启后、以及从 Recent Files 重开时
// 仍然是安全模式候选。下面六个调用点就是上游「外部来源」的全部入口。

/** `TrustedFiles.markExternallyOpened` 的六个调用点（`文件:行号` 是调用那一行）。 */
export const EXTERNALLY_OPENED_SOURCES: ReadonlyArray<{ what: string; where: string }> = [
  { what: '编辑器里落下外部文件（拖放 / 粘贴）', where: 'platform/platform-impl/src/com/intellij/openapi/editor/FileDropManager.kt:116' },
  { what: '欢迎屏上落下外部文件', where: 'platform/non-modal-welcome-screen/src/com/intellij/platform/ide/nonModalWelcomeScreen/FileDragAndDropHandler.kt:35' },
  { what: '命令行打开文件', where: 'platform/platform-impl/src/com/intellij/ide/CommandLineProcessor.kt:146' },
  { what: 'Open File 动作', where: 'platform/platform-impl/src/com/intellij/ide/actions/OpenFileAction.kt:244' },
  { what: 'ProjectUtil 打开文件', where: 'platform/platform-impl/src/com/intellij/ide/impl/ProjectUtil.kt:629' },
  { what: '平台项目打开器（协议 URI）', where: 'platform/platform-impl/src/com/intellij/platform/PlatformProjectOpenProcessor.kt:464' },
]

/**
 * 拖放进来的文件**一定**会被标成「外部打开」（`FileDropManager.kt:111-117` 的
 * `openFiles` 在打开前 `.onEach(TrustedFiles::markExternallyOpened)`；
 * 欢迎屏那条在 `FileDragAndDropHandler.kt:35`）。所以拖放与信任的接口是：
 * 落进来的文件先打标记 → 判词按 `computeFileTrusted` 走 → 在项目之外就落进安全模式。
 */
export function dropMarksExternallyOpened(): boolean {
  return true
}

// ── ⑧ 拖放：传输类型与目标可用性判据 ───────────────────────────────────────────────────
//
// `ic/dnd` 与 `pf/dnd` 判词里点名的「跨窗口拖放」缺口的**可移植那一半**就是这一节：
// 上游没有 `DragAndDropUtil` 这个类（按文件名、按包路径 `com.intellij.ide.dnd`、
// 按 XML 里的 id 三条路都搜不到 —— 见报告「无法核实」），真正决定「哪种类别能落到哪个目标」
// 的是 `FileCopyPasteUtil.isFileListFlavorAvailable` 这一族判据；跨窗口那一半由
// `DockManager` 的 `DragSession`（`DockManagerImpl.kt:258-327`）承担，本仓单窗口，见报告。

/**
 * `LinuxDragAndDropSupport.uriListFlavor`（`LinuxDragAndDropSupport.java:33`）：
 * `text/uri-list`。这是**唯一**能直接映射到 DOM `DataTransfer.getData(type)` 的那一种。
 */
export const URI_LIST_FLAVOR = 'text/uri-list'
/** `LinuxDragAndDropSupport.gnomeFileListFlavor`（`:34`）：`x-special/gnome-copied-files`。 */
export const GNOME_FILE_LIST_FLAVOR = 'x-special/gnome-copied-files'
/** `LinuxDragAndDropSupport.kdeCutMarkFlavor`（`:35`）：`application/x-kde-cutselection`。 */
export const KDE_CUT_MARK_FLAVOR = 'application/x-kde-cutselection'
/**
 * `DataFlavor.javaFileListFlavor` —— 一个 **JVM 本地对象** flavor（装 `List<File>`），
 * 没有 MIME 字符串可对应。DOM 侧的等价物是 `DataTransfer.files`（`FileList`），
 * 所以本仓把「这个 flavor 在不在」判成「`files` 非空」。
 */
export const JAVA_FILE_LIST_FLAVOR = 'application/x-java-file-list'

/**
 * `FileCopyPasteUtil.FLAVORS`（`FileCopyPasteUtil.java:26-28`）：
 * `filter(..., flavor -> flavor != null)` 之后的三个，顺序就是
 * `javaFileListFlavor` → `uriListFlavor` → `gnomeFileListFlavor`
 * （`kdeCutMarkFlavor` **不在**这张表里 —— 它只用来判「这是不是剪切操作」，
 * `LinuxDragAndDropSupport.isMoveOperation` `:86-87`）。
 */
export const FILE_LIST_FLAVORS: readonly string[] = [
  JAVA_FILE_LIST_FLAVOR,
  URI_LIST_FLAVOR,
  GNOME_FILE_LIST_FLAVOR,
]

/** DOM 侧一次拖拽能声明的传输类型（`DataTransfer.types` 的子集 + `files`）。 */
export interface TransferableLike {
  /** `DataTransfer.types`（`DOMStringList`/`string[]` 都收）。 */
  types?: ArrayLike<string> | readonly string[]
  /** `DataTransfer.files`（`FileList`；只取 `length`）。 */
  files?: ArrayLike<unknown> | null
}

function typesOf(transferable: TransferableLike | null | undefined): string[] {
  const types = transferable?.types
  if (!types) return []
  const out: string[] = []
  const length = typeof types.length === 'number' ? types.length : 0
  for (let index = 0; index < length; index++) {
    const value = (types as ArrayLike<string>)[index]
    if (typeof value === 'string') out.push(value.toLowerCase())
  }
  return out
}

function hasFiles(transferable: TransferableLike | null | undefined): boolean {
  const files = transferable?.files
  return Boolean(files && typeof files.length === 'number' && files.length > 0)
}

/**
 * `FileCopyPasteUtil.isFileListFlavorAvailable(DataFlavor[])`（`FileCopyPasteUtil.java:72-75`）：
 * `Set.of(FLAVORS)` 里**任意一个**在对方声明的 flavor 里出现即真。
 * DOM 版：`files` 非空（= javaFileListFlavor 那一档）或 `types` 里含 `text/uri-list` /
 * `x-special/gnome-copied-files`。空数组、`null` 元素都不算（上游测试
 * `FileCopyPasteUtilTest.kt:14-24` 正是拿 `dataFlavors(null, stringFlavor)` 判 false、
 * `dataFlavors(null, javaFileListFlavor)` 判 true）。
 */
export function isFileListFlavorAvailable(transferable: TransferableLike | null | undefined): boolean {
  if (hasFiles(transferable)) return true
  const types = typesOf(transferable)
  return FILE_LIST_FLAVORS.some(flavor => flavor !== JAVA_FILE_LIST_FLAVOR && types.includes(flavor))
}

/**
 * `FileCopyPasteUtil.getFiles`（`FileCopyPasteUtil.java:82-97`）的**优先级**：
 * 先看 `DataFlavor.javaFileListFlavor`（`:84-87`），取到了就直接返回；只有它不在时才走
 * `LinuxDragAndDropSupport.getFiles`（`:88-90`）—— 即 uri-list / gnome 那一族。
 * DOM 版：`files` 非空就用它，否则才看 `types` 里的 uri-list 族。
 * 返回 `'files' | 'uri-list' | null`（null = 两种都没有，上游这里返回 null）。
 */
export function fileSourcePreference(transferable: TransferableLike | null | undefined): 'files' | 'uri-list' | null {
  if (hasFiles(transferable)) return 'files'
  const types = typesOf(transferable)
  if (types.includes(URI_LIST_FLAVOR) || types.includes(GNOME_FILE_LIST_FLAVOR)) return 'uri-list'
  return null
}

/**
 * `LinuxDragAndDropSupport.getFiles(String)`（`LinuxDragAndDropSupport.java:53-71`）的逐行跳过规则：
 * `Strings.isEmptyOrSpaces(uriString)`（`:60` 前半个条件）、`uriString.startsWith("#")`（`:60` 中）、
 * `!uriString.startsWith("file:/")`（`:60` 后半个 —— 注意是 `file:/` **带斜杠**，
 * 比本仓 `src/dndModel.ts` 的 `line.toLowerCase().startsWith('file:')` 严一档）。
 * 能解析成 URI 的行 `new File(uri).toPath()`；`URISyntaxException` 静默跳过（`:67`）。
 */
export function isDroppableUriLine(line: string): boolean {
  if (!line || !line.trim()) return false
  if (line.startsWith('#')) return false
  return line.startsWith('file:/')
}

/**
 * `LinuxDragAndDropSupport.isMoveOperation`（`LinuxDragAndDropSupport.java:77-91`）：
 * gnome 那一档看内容是不是 `cut\n` 开头（`:82`），kde 那一档只要 flavor 在就算移动（`:86-87`）。
 * 这就是「拖进来的是剪切还是复制」的判据 —— 决定落点该走移动还是复制。
 */
export function isMoveOperation(input: { gnomeContent?: string | null; hasKdeCutMark?: boolean }): boolean {
  if (input.hasKdeCutMark) return true
  return typeof input.gnomeContent === 'string' && input.gnomeContent.startsWith('cut\n')
}

// ── 目标可用性：哪种类别能落到哪个目标 ──────────────────────────────────────────────
//
// 上游每个落点的 `update(event)` 第一句几乎都是同一个判据（`isFileListFlavorAvailable`），
// 不通过就 `return false`（= 本目标处理不了、交给父组件）。下面这张表把
// **每一类目标用什么判据**列全 —— 全部逐行打开确认过。

/** 一个落点类别：它用什么判据决定「能不能接这次拖拽」。 */
export interface DropTargetKind {
  /** 落点是什么（本仓的界面名）。 */
  kind: string
  /** 判据的类别。 */
  check: 'file-list' | 'internal-paths' | 'tree-paths'
  /** 上游 `文件:行号`（判据那一行）。 */
  where: string
  /** 这一档要不要先看 `TransferableWrapper`（IDE 内部拖拽）。 */
  internalFirst: boolean
}

/**
 * 落点类别表。三档判据的来源：
 *   · `file-list` —— `FileCopyPasteUtil.isFileListFlavorAvailable`（外部文件）；
 *   · `internal-paths` —— `FileCopyPasteUtil.getPathListFromAttachedObject`（`FileCopyPasteUtil.java:118-121`，
 *     `PathFlavorProvider.asPathList()` 那一档：另一个环境里的文件没有本地 `File` 形态）；
 *   · `tree-paths` —— `TransferableWrapper.getTreePaths()`（`TransferableWrapper.java:19-21`，IDE 内部拖的树节点）。
 */
export const DROP_TARGET_KINDS: readonly DropTargetKind[] = [
  // 项目视图树：先看 IDE 内部拖的 treePaths（`getSourcePaths` `:205-208`），没有才判外部文件
  // （`isFileDropPossible` `:141-144` = pathList 非空 或 file-list flavor 在）。
  { kind: '项目视图树', check: 'tree-paths', where: 'platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewDropTarget.java:205-208', internalFirst: true },
  { kind: '项目视图树（外部文件那一档）', check: 'file-list', where: 'platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewDropTarget.java:141-144', internalFirst: false },
  // 可拆装的工具窗口面板：只看外部文件。
  { kind: '工具窗口面板（停靠条）', check: 'file-list', where: 'platform/lang-impl/src/com/intellij/ide/projectView/impl/AttachableProjectViewPane.java:195-197', internalFirst: false },
  // 书签视图：先看 attachedObject 的文件清单（`:100`），Mac 上取不到时退回只看 flavor（`:103-106`）。
  { kind: '书签视图', check: 'file-list', where: 'platform/bookmarks/src/com/intellij/ide/bookmark/ui/DragAndDropHandler.kt:100-106', internalFirst: true },
  // 编辑器：拖进编辑区 = 打开这些文件（`FileDropManager.kt:33-35` 的 `containsFileDropTargets`）。
  { kind: '编辑器编辑区', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/openapi/editor/FileDropManager.kt:33-35', internalFirst: false },
  // 轻量编辑器（LightEdit）的落点。
  { kind: 'LightEdit 窗口', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/ide/lightEdit/LightEditDropHandler.java:18-21', internalFirst: false },
  // 欢迎屏左栏 + 最近项目页。
  { kind: '欢迎屏左栏', check: 'file-list', where: 'platform/non-modal-welcome-screen/src/com/intellij/platform/ide/nonModalWelcomeScreen/leftPanel/WelcomeScreenLeftPanel.kt:62-68', internalFirst: false },
  { kind: '欢迎屏最近项目页', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/ProjectsTabFactory.kt:356-362', internalFirst: false },
  // 文件选择器的三种实现（通用树 / 新对话框 / 旧对话框）。
  { kind: '文件选择器（通用树）', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/openapi/fileChooser/universal/NioFileSystemTree.kt:122-127', internalFirst: false },
  { kind: '文件选择器（新对话框）', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/openapi/fileChooser/impl/NewFileChooserDialogImpl.java:147-152', internalFirst: false },
  { kind: '文件选择器（旧对话框的粘贴门）', check: 'file-list', where: 'platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileChooserDialogImpl.java:540-542', internalFirst: false },
  // 空差异窗口：把拖进来的文件两两比。
  { kind: '空差异窗口', check: 'file-list', where: 'platform/diff-impl/src/com/intellij/diff/actions/ShowBlankDiffWindowAction.kt:366-368', internalFirst: false },
  // 两个插件自己的树（Ant / Maven）：同一句 `canImport`。
  { kind: 'Ant 结构树', check: 'file-list', where: 'plugins/ant/src/com/intellij/lang/ant/config/explorer/AntExplorer.java:1049-1051', internalFirst: false },
  { kind: 'Maven 项目树', check: 'file-list', where: 'plugins/maven/src/main/java/org/jetbrains/idea/maven/navigator/structure/MavenProjectsNavigatorPanel.java:346-348', internalFirst: false },
]

/**
 * 按类别算「这次拖拽能不能落到这个目标」。
 *
 * `tree-paths` 那一档的判据照 `ProjectViewDropTarget.update`（`:84-93`）：
 * `getSourcePaths`（`:205-208`，即 `attachedObject instanceof TransferableWrapper` 时的
 * `getTreePaths()`）非 null 就走内部那一支（`:88-90`）；为 null 时才判
 * `isFileDropPossible`（`:91`，`:141-144`）。所以外部文件落点与内部拖拽落点是**互斥的两支**，
 * 不是叠着判 —— `internalPaths` 传 `null` 表示「不是 IDE 内部拖的树节点」。
 */
export function dropTargetAccepts(
  target: DropTargetKind,
  input: { transferable: TransferableLike | null | undefined; internalPaths?: readonly string[] | null },
): boolean {
  if (target.internalFirst && (input.internalPaths ?? null) !== null) return true
  return isFileListFlavorAvailable(input.transferable)
}

/**
 * `ProjectViewDropTarget.getDropHandler`（`ProjectViewDropTarget.java:244-252`）：
 * 动作 id 是 `ACTION_COPY`（1）⇒ 复制处理器；是 `ACTION_COPY_OR_MOVE`（3）或
 * `ACTION_MOVE`（2）⇒ 移动处理器；**其余（含 LINK）一律 null = 这个落点不接受**。
 * `DnDConstants` 的两个常量与 `src/dndModel.ts` 的 `DND_ACTION_ID` 同一数值
 * （copy=1 / move=2 / link=0x40000000，`DnDAction.java:26-28`）。
 */
export function projectViewDropHandlerKind(actionId: number | null | undefined): 'copy' | 'move' | null {
  if (actionId === 1) return 'copy'
  if (actionId === 2 || actionId === 3) return 'move'
  return null
}

/** `DnDConstants.ACTION_COPY_OR_MOVE`（`ProjectViewDropTarget.java:250` 的那一档）；数值已在 `src/dndModel.ts` 定义，转出复用不另立一份。 */
export { DND_ACTION_COPY_OR_MOVE } from './dndModel.ts'

/**
 * 跨窗口那一档的判据（`DockManagerImpl.kt:258-273` 的 `getResponse`）：
 * 逐个容器问 `getContentResponse`，**第一个 `canAccept()`（即不是 DENY）的赢**；
 * 一个都没有就 `ContentResponse.DENY`（`:272`）。三档枚举在 `DockContainer.java:19-25`
 * （`ACCEPT_MOVE` / `ACCEPT_COPY` / `DENY`，`canAccept()` = `this != DENY`）。
 *
 * 松手时（`:302-326`）：`currentOverContainer == null`（没有任何容器认领）⇒
 * **新建一个容器**（`:313` 的 `createNewDockContainerFor`，即拖出成新窗口），
 * 并 `e.consume()` 标记「这不是标签重排」（`:315` 的注释原文
 * "Marker for DragHelper: drag into a separate window is not tabs reordering"）；
 * 有容器认领 ⇒ 落到它里面（`:319`）。标签条那一条另有 Ctrl 的例外
 * （`EditorTabbedContainer.kt:515`：按住 Ctrl **或** 容器答 ACCEPT_COPY ⇒ 不关源标签，即复制而非移动）。
 */
export const DOCK_CONTENT_RESPONSE = { ACCEPT_MOVE: 'ACCEPT_MOVE', ACCEPT_COPY: 'ACCEPT_COPY', DENY: 'DENY' } as const
export type DockContentResponse = (typeof DOCK_CONTENT_RESPONSE)[keyof typeof DOCK_CONTENT_RESPONSE]

/** `DockContainer.ContentResponse.canAccept()`（`DockContainer.java:22-24`）。 */
export function dockResponseCanAccept(response: DockContentResponse): boolean {
  return response !== DOCK_CONTENT_RESPONSE.DENY
}

/** `getResponse` 的择优（`DockManagerImpl.kt:258-273`）：第一个能接的赢，都不接 = DENY。 */
export function dockResponseFor(responses: readonly DockContentResponse[]): DockContentResponse {
  for (const response of responses) if (dockResponseCanAccept(response)) return response
  return DOCK_CONTENT_RESPONSE.DENY
}

/**
 * 松手之后走哪条路（`DockManagerImpl.kt:302-326`）：
 * `null` = 没有任何容器认领 ⇒ 新建容器（拖出成新窗口，统计 id `OpenElementInNewWindow`，
 * `DockableEditorTabbedContainer.kt:239`）。
 */
export function dockDropOutcome(overContainer: DockContentResponse | null): 'into-container' | 'new-window' {
  return overContainer === null ? 'new-window' : 'into-container'
}

/** 标签被拖出时源标签关不关（`EditorTabbedContainer.kt:515`）：Ctrl 按下 **或** 容器答复制 ⇒ 不关（复制）。 */
export function dragOutKeepsSource(ctrlDown: boolean, response: DockContentResponse): boolean {
  return ctrlDown || response === DOCK_CONTENT_RESPONSE.ACCEPT_COPY
}