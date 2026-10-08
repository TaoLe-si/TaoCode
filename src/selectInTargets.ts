// **Select In 目标的扩展点**（上游 `com.intellij.ide.SelectInTarget` / EP
// `com.intellij.selectInTarget` 在本仓的等价物）。
//
// 上游是什么：`platform/platform-api/resources/intellij.platform.ide.xml:40-43` 声明
// `<extensionPoint qualifiedName="com.intellij.selectInTarget" interface="com.intellij.ide.SelectInTarget"
// area="IDEA_PROJECT" dynamic="true"/>`；接口（`platform/platform-api/src/com/intellij/ide/SelectInTarget.java`）
// 有 `isAvailable(project)`、`canSelect(SelectInContext)`、`selectIn(SelectInContext, requestFocus)`、
// `getToolWindowId()`、`getMinorViewId()`、`getWeight()`（`:49-51` 缺省 0）。平台侧
// `SelectInManager`/`SelectInAction` 收集全部目标、按 `getWeight()` **升序**排、置灰不可选的。
//
// 本仓此前：六个目标的表与 `selectable` 判据**写死在** `src/editorSideViews.ts` 的
// `selectInRows` 里，第三方挂不进来（判词 lp/ide-shell 那条「`SelectInTarget` 缺 EP 宿主」）。
// 本文件把它接进 `src/extensionPoints.ts`：
//   · EP id `com.intellij.selectInTarget`（逐字取自上游）；
//   · 贡献形状 = 上游接口的可移植子集（`id` 是上游的 `toString()` 身份，`label` 是显示名，
//     `weight` 排序，`canSelect(context)` 决定是否置灰，`selectIn(context)` 做什么）；
//   · 六个内置目标按 **bundled 贡献**登记（谓词与权重逐条照 `src/editorSideViews.ts` 原有注释里的
//     上游行号），第三方的目标（不带 `selectIn` 的只入表、有 `selectIn` 的可执行）按 EP id 挂；
//   · `selectInTargetRows(context)` 产弹层行、`selectInTargetById(context, id)` 取可执行目标。
//
// 与上游的如实差异：上游 EP 是 `area="IDEA_PROJECT"`（按项目作用域可见），本仓 EP 宿主的作用域是
// 字符串，这里按**应用级**声明（本仓单工作区，等价）；`SelectInContext` 收成 DOM 宿主能给出的字段
// （没有 `VirtualFile`/`PsiElement` 载具），`selectIn` 的副作用回调用宿主注入的回调表达。
//
// 判据：`tests/select-in-targets.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { planSelectIn, type SelectInRow, type SelectInTargetSpec } from './selectIn.ts'
// 目标**来源**那条外围 EP（`com.intellij.projectViewSelectInTargetProvider`）：声明与出处见
// `src/ideShellExtensionPoints.ts`，这里的 `availableSelectInTargets` 是它的真实消费点，
// 文件末尾的 `legacyProjectViewProvider` 是它的 bundled 贡献者。
import {
  legacyProjectViewSelectInTargetProvider, projectViewSelectInTargets, registerProjectViewSelectInTargetProvider,
  type ProjectViewSelectInTargetLike,
} from './ideShellExtensionPoints.ts'

/** EP id（逐字取自上游 `intellij.platform.ide.xml:40` 的 `qualifiedName`）。 */
export const SELECT_IN_TARGET_EP = 'com.intellij.selectInTarget'

/**
 * `SelectInContext`（上游 `com.intellij.ide.SelectInContext`）的文本宿主子集：DOM 宿主能给出的
 * 上下文事实 + 宿主注入的副作用回调（上游是 `VirtualFile`/`PsiElement` 载具 + 平台动作）。
 */
export interface SelectInContext {
  /** 当前有打开文件的编辑器。 */
  hasActiveFile: boolean
  /** 当前文件有一个非空路径。 */
  hasPath: boolean
  /** 当前文件是真文件（非合成条目）且在树里。 */
  inTree: boolean
  /** 桌面端（有原生对话框/资源管理器通道）。 */
  isDesktop: boolean
  /** 当前文件的面包屑可见（`UISettings.getShowNavigationBar()`）。 */
  hasBreadcrumbs: boolean
  /** 当前文件有本地更改（提交窗口那一格）。 */
  hasChange: boolean
  /** 有工作区。 */
  hasWorkspace: boolean
  /** 宿主副作用：选中项目视图。 */
  selectProjectView?: () => void
  /** 宿主副作用：显示导航栏（面包屑）。 */
  showNavBar?: () => void
  /** 宿主副作用：聚焦某个工具窗口（`outline`/`git`…）。 */
  focusToolWindow?: (id: string) => void
  /** 宿主副作用：打开项目结构。 */
  openProjectStructure?: () => void
  /** 宿主副作用：在资源管理器中显示当前文件。 */
  revealInExplorer?: () => void | Promise<void>
}

/** 一个 Select In 目标（上游 `SelectInTarget` 的可移植子集）。 */
export interface SelectInTarget {
  /** 目标身份（上游 `toString()`）。 */
  id: string
  /** 弹层里显示的标题（上游 `toString()` 的 @Nls 返回值）。 */
  label: string
  /** 排序权重（上游 `getWeight()`，小的在前）。 */
  weight: number
  /** `isAvailable(project)`（缺省可用）。 */
  isAvailable?: (context: SelectInContext) => boolean
  /** `canSelect(context)` —— false = 表里置灰。 */
  canSelect: (context: SelectInContext) => boolean
  /** `selectIn(context, requestFocus)`。 */
  selectIn: (context: SelectInContext, requestFocus?: boolean) => void | Promise<void>
  /** `getToolWindowId()`。 */
  toolWindowId?: string | null
  /** `getMinorViewId()`。 */
  minorViewId?: string | null
}

/** 声明 EP（幂等）。 */
export function declareSelectInExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: SELECT_IN_TARGET_EP, name: 'Select In 目标', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 注册一条目标（同 id 覆盖）。 */
export function registerSelectInTarget(target: SelectInTarget, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(SELECT_IN_TARGET_EP, target.id, target, options)
}

/** 注销一条目标。 */
export function unregisterSelectInTarget(id: string): boolean {
  return EXTENSIONS.unregisterExtension(SELECT_IN_TARGET_EP, id)
}

/** 当前作用域下的全部目标（已按 `LoadingOrder` 排）。 */
export function selectInTargets(scope: string = APPLICATION_SCOPE): SelectInTarget[] {
  return EXTENSIONS.extensionsOf<SelectInTarget>(SELECT_IN_TARGET_EP, scope)
}

/** 通过 `isAvailable` 过滤后的目标（上游 `SelectInManager` 取表时先过 `isAvailable`）。 */
export function availableSelectInTargets(context: SelectInContext, scope: string = APPLICATION_SCOPE): SelectInTarget[] {
  // 目标来源的两条 EP 合起来（上游 `getProjectViewSelectInTargets(project)` 的等价物，
  // `ProjectViewSelectInTargetProvider.kt:24-35`）：
  //   · `com.intellij.selectInTarget` —— 目标**本体**（本文件声明的第一条，第三方按 id 挂一个目标）；
  //   · `com.intellij.projectViewSelectInTargetProvider` —— 目标**来源**（另一条外围 EP，
  //     声明与出处见 `src/ideShellExtensionPoints.ts`，第三方按 id 挂一个"给一批目标"的来源）。
  // **同 id 去重、先出现的说了算** —— 上游那两条来源也是按身份去重收集的
  // （`ProjectViewSelectInTargetProvider.kt:41-49` 的 `buildSet`），本仓的 bundled 来源
  // （下面的 `legacyProjectViewProvider`）给的正是那六个内建目标，靠这一步收成一份。
  // 没有来源贡献时 `projectViewSelectInTargets` 是空数组 ⇒ 既有六个目标的行为逐字不变。
  const fromProviders = projectViewSelectInTargets({
    workspaceRoot: context.hasWorkspace ? 'workspace' : '',
    // 上游 `:40-41`：项目视图分屏时那条 legacy 来源给空表。本仓的 Select In 弹层没有分屏态，
    // 固定 false（分屏那一格本仓不存在，如实固定而不是编一个状态源）。
    splitView: false,
  }, scope)
  const seen = new Set<string>()
  const merged: SelectInTarget[] = []
  for (const target of [...selectInTargets(scope), ...fromProviders] as SelectInTarget[]) {
    if (seen.has(target.id)) continue
    seen.add(target.id)
    if (!target.isAvailable || target.isAvailable(context)) merged.push(target)
  }
  return merged
}

/** 弹层行：`weight` 升序 + 助记符编号，置灰由 `canSelect(context)` 决定（与 `src/selectIn.ts` 的口径一致）。 */
export function selectInTargetRows(context: SelectInContext, scope: string = APPLICATION_SCOPE): SelectInRow[] {
  const specs: SelectInTargetSpec[] = availableSelectInTargets(context, scope).map(target => ({
    id: target.id, label: target.label, weight: target.weight, selectable: target.canSelect(context),
  }))
  return planSelectIn(specs)
}

/** 取某 id 的可执行目标（不可选/不存在都给 null —— 置灰的行点了不该有动作）。 */
export function selectInTargetById(context: SelectInContext, id: string, scope: string = APPLICATION_SCOPE): SelectInTarget | null {
  const target = availableSelectInTargets(context, scope).find(candidate => candidate.id === id)
  if (!target || !target.canSelect(context)) return null
  return target
}

/* ── bundled：本仓原有那六个目标（`src/editorSideViews.ts` 的表原样搬来） ──────────── */

/** 六个内置目标 id（宿主那一侧按 id 派发过，保留成常量以免拼错）。 */
export const PROJECT_VIEW_TARGET_ID = 'project'
export const FILE_STRUCTURE_TARGET_ID = 'structure'
export const NAVBAR_TARGET_ID = 'navbar'
export const COMMIT_TARGET_ID = 'commit'
export const EXPLORER_TARGET_ID = 'explorer'
export const PROJECT_STRUCTURE_TARGET_ID = 'settings'

/**
 * 六个内置目标。权重与置灰判据逐条照 `src/editorSideViews.ts` 原有注释里的上游行号：
 *   · `ProjectViewSelectInGroupTarget.java:58-60` → 权重 0（接口缺省）；
 *   · `StructureViewSelectInTarget.java:35-41` → 4；
 *   · `SelectInNavBarTarget.java:41-43` → 8；
 *   · `SelectInChangesViewTarget.java:29-38` → 9；
 *   · `ProjectViewSelectInExplorerTarget.java:29-37` → 9.5；
 *   · `ProjectStructureSelectInTarget` → 10。
 */
export function bundledSelectInTargets(): SelectInTarget[] {
  return [
    {
      id: PROJECT_VIEW_TARGET_ID, label: '项目视图', weight: 0,
      canSelect: context => context.hasActiveFile && context.inTree,
      selectIn: context => context.selectProjectView?.(),
    },
    {
      id: FILE_STRUCTURE_TARGET_ID, label: '文件结构', weight: 4,
      canSelect: context => context.hasActiveFile,
      selectIn: context => context.focusToolWindow?.('outline'),
      toolWindowId: 'outline',
    },
    {
      id: NAVBAR_TARGET_ID, label: '导航栏', weight: 8,
      canSelect: context => context.hasPath && context.hasBreadcrumbs,
      selectIn: context => context.showNavBar?.(),
    },
    {
      id: COMMIT_TARGET_ID, label: '提交', weight: 9,
      canSelect: context => context.hasActiveFile && context.hasChange,
      selectIn: context => context.focusToolWindow?.('git'),
      toolWindowId: 'git',
    },
    {
      id: EXPLORER_TARGET_ID, label: '在资源管理器中显示', weight: 9.5,
      canSelect: context => context.isDesktop && context.inTree,
      selectIn: context => context.revealInExplorer?.(),
    },
    {
      id: PROJECT_STRUCTURE_TARGET_ID, label: '项目结构', weight: 10,
      canSelect: context => context.hasWorkspace,
      selectIn: context => context.openProjectStructure?.(),
    },
  ]
}

declareSelectInExtensionPoints()
for (const target of bundledSelectInTargets())
  EXTENSIONS.registerExtension(SELECT_IN_TARGET_EP, target.id, target, { source: 'bundled' })

/**
 * 把内建目标送进那条 EP 的形状（`ProjectViewSelectInTargetLike` 的 `canSelect`/`selectIn`
 * 收 `unknown` —— 第三方来源的目标不该假定宿主给什么上下文）。
 *
 * 为什么需要一个显式适配而不是直接交回：`SelectInTarget` 的这两个方法收**窄类型**
 * `SelectInContext`，而 EP 那一侧声明的是 `unknown`。函数参数是逆变的，窄的收不了宽的，
 * 所以这里把边界收窄一次 —— 谁在边界上转型，谁就得写出来（`as` 只出现在这一处）。
 * 内建目标本来就是给本仓宿主用的，必然拿得到 `SelectInContext`。
 */
function asProjectViewTargets(targets: SelectInTarget[]): ProjectViewSelectInTargetLike[] {
  return targets.map(target => ({
    id: target.id,
    label: target.label,
    weight: target.weight,
    toolWindowId: target.toolWindowId,
    minorViewId: target.minorViewId,
    canSelect: (context: unknown) => target.canSelect(context as SelectInContext),
    selectIn: (context: unknown, requestFocus?: boolean) => target.selectIn(context as SelectInContext, requestFocus),
  }))
}

/**
 * **bundled 来源贡献** —— 上游 `LegacyProjectViewSelectInTargetProvider`
 * （`ProjectViewSelectInTargetProvider.kt:37-50`）的等价物：分屏时给空表（`:40-41`），
 * 否则给「项目视图自己那几个 target」。本仓那六个内建目标就是这一档，原样交回
 * （`availableSelectInTargets` 按 id 去重，故它们不会因为两边都有而重复出现）。
 * 它存在的意义：让 `com.intellij.projectViewSelectInTargetProvider` 有一条 bundled 贡献
 * （判据①），第三方的来源排在它后面仍能被消费点取到（判据②）。
 */
export const legacyProjectViewProvider = legacyProjectViewSelectInTargetProvider(() => asProjectViewTargets(bundledSelectInTargets()))
registerProjectViewSelectInTargetProvider(legacyProjectViewProvider, { source: 'bundled' })
