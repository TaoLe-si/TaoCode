// **项目视图的多窗格**（上游 `com.intellij.ide.projectView.impl.AbstractProjectViewPane` 一族）——
// 把「项目视图能切成哪几个窗格、切到哪一个、切完以后选中谁」这一层从单窗格树里分出来。
//
// 上游是什么：项目工具窗口的**内容**不是一张树，而是一组可切换的窗格，各自一个类：
//   · `ProjectViewPane`（`platform/lang-impl/.../ProjectViewPane.java:40` `ID = "ProjectPane"`，
//     `getWeight()` = 0「should be first」，标题 `IdeBundle.title.project`）；
//   · `PackageViewPane`（`java/java-impl/.../PackageViewPane.java:52` `ID = "PackagesPane"`，
//     `getWeight()` = 1，标题 `JavaBundle.title.packages`）；
//   · `ScopeViewPane`（`platform/lang-impl/.../scopeView/ScopeViewPane.java:78` `ID = "Scope"`，
//     `getWeight()` = 4，标题 `IdeBundle.scope.view.title`）。
// 它们都作为 `<projectViewPane implementation="…"/>` 贡献挂到 EP `com.intellij.projectViewPane`
// （`platform/lang-impl/resources/intellij.platform.lang.impl.xml:314`，
// `interface="…AbstractProjectViewPane"` area="IDEA_PROJECT" dynamic="true"；三处 bundled 贡献分别在
// `idea/customization/min/resources/intellij.platform.customization.min.xml:15`、
// `java/java-backend/resources/META-INF/JavaPlugin.xml:397`、
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1387`）。
// 消费端是 `ProjectViewImpl`：`getPanes()` 收集 EP 并按 area 过滤（`ProjectViewImpl.java:1313`
// `AbstractProjectViewPane.EP.getExtensions(project)` 收集后交给 `toSort`），
// `:1684` 再按 `isAvailable(project)` 过滤出可用的那一档；切窗格 = 把当前 pane 换成另一个 id。
//
// 本仓此前：项目视图只有一张树（`src/projectTreeModel.ts`），`PROJECT_VIEW_PANE_EP` 这条 EP 虽然
// 声明了（`src/ideViewExtensionPoints.ts`）但**没有任何 bundled 贡献**，也没有"切到哪个窗格"的状态
// —— 于是第三方即使按 id 挂一个窗格，也没有被选中的那一刻（EP 是死的）。
// 本文件补两头：
//   ① bundled 三支（项目 / 包 / 范围）按上游 id 与 weight 注册进 `PROJECT_VIEW_PANE_EP`；
//   ② 一个可测的**窗格选择宿主**（当前窗格、可用窗格、切下一个），让"被选中的窗格"有落点。
//
// 与上游的如实差异：本仓没有 `Project`/`VirtualFile`，`isAvailable(root)` 收成工作区根字符串；
// 三个窗格目前渲染的是**同一张树**（`src/projectTreeModel.ts`），差别在"按目录 / 按包 / 按范围"
// 三种折叠口径 —— 包口径已由 `src/symbolModel.ts` 的包树承担，范围口径还没有（见报告）。
//
// 纯数据层 + 一个响应式宿主：只 import vue 与 `src/ideViewExtensionPoints.ts`，便于 `node --test` 直测。
//
// 判据：`tests/project-view-panes.test.mjs`。

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  PROJECT_VIEW_PANE_EP, availableProjectViewPanes, projectViewPanes, registerProjectViewPane,
  type ProjectViewPaneContribution,
} from './ideViewExtensionPoints.ts'

// ── bundled 三支（id / weight 逐字取上游，标题取上游 bundle 的对应译文） ──────────────────────

/** 上游 `ProjectViewPane.java:40`。 */
export const PROJECT_PANE_ID = 'ProjectPane'
/** 上游 `PackageViewPane.java:52`。 */
export const PACKAGES_PANE_ID = 'PackagesPane'
/** 上游 `ScopeViewPane.java:78`。 */
export const SCOPE_PANE_ID = 'Scope'

/**
 * 本仓随包发货的三个项目视图窗格。
 *
 * `getWeight()` 逐条对上游：项目 0（「should be first」`ProjectViewPane.java:123`）、
 * 包 1（`PackageViewPane.java:188`）、范围 4（`ScopeViewPane.java:161`）。
 * `isInitiallyVisible()` 只有项目那一支为真（上游 `ProjectViewPane.isInitiallyVisible` = true，
 * 包/范围 = false）—— 这与 `ProjectViewPaneHost` 的初始选择一致。
 */
export const BUNDLED_PROJECT_VIEW_PANES: readonly ProjectViewPaneContribution[] = [
  {
    id: PROJECT_PANE_ID,
    getTitle: () => '项目',
    isInitiallyVisible: () => true,
    getGroup: () => '项目',
    getWeight: () => 0,
    // 没有工作区（空根）时项目视图不显示 ⇒ 窗格也不可用（上游 `isAvailable(project)` 同义）。
    isAvailable: (root: string) => root.length > 0,
  },
  {
    id: PACKAGES_PANE_ID,
    getTitle: () => '包',
    isInitiallyVisible: () => false,
    getGroup: () => '项目',
    getWeight: () => 1,
    isAvailable: (root: string) => root.length > 0,
  },
  {
    id: SCOPE_PANE_ID,
    getTitle: () => '范围',
    isInitiallyVisible: () => false,
    getGroup: () => '范围',
    getWeight: () => 4,
    isAvailable: (root: string) => root.length > 0,
  },
]

let bundledRegistered = false

/**
 * 把三支 bundled 窗格注册进 `com.intellij.projectViewPane`（幂等：只做一次，重复调用是空操作）。
 * bundled 的 `source` 是 `bundled`，与第三方按 id 挂的 `user` 贡献在同一张 EP 表里共存
 * （消费端 `projectViewPanes()` / `availableProjectViewPanes()` 不区分来源，只按 weight 排序）。
 */
export function registerBundledProjectViewPanes(): void {
  if (bundledRegistered) return
  bundledRegistered = true
  for (const pane of BUNDLED_PROJECT_VIEW_PANES) {
    registerProjectViewPane(pane, { source: 'bundled' })
  }
}

// 模块加载即注册（与 `src/extensionPoints.ts` 末尾 `declareBundledExtensionPoints()` 同一纪律：
// EP 的 bundled 贡献者必须真的在表里，否则消费端拿到的是一张空表）。
registerBundledProjectViewPanes()

// ── 窗格选择宿主 ──────────────────────────────────────────────────────────────────────────

/** 一个窗格在"选择器"里的可见形状（id + 标题 + 分组 + 权重）。 */
export interface ProjectViewPaneChoice {
  id: string
  title: string
  group: string
  weight: number
}

/** 把一个窗格贡献折成选择器行。`getTitle()` 抛错时退回 id（不让一个坏贡献吃掉整张表）。 */
export function paneChoiceOf(pane: ProjectViewPaneContribution): ProjectViewPaneChoice {
  let title = pane.id
  let group = ''
  try { title = pane.getTitle() } catch { /* 坏贡献退回 id */ }
  try { group = pane.getGroup() } catch { /* 分组答不出就当空 */ }
  return { id: pane.id, title, group, weight: pane.getWeight() }
}

/**
 * 当前工作区**可用**的窗格（按 weight 从大到小，与 `availableProjectViewPanes` 同一口径）——
 * 这是选择器要渲染的行表（上游 `ProjectViewImpl.getPanes()` 之后按 `isAvailable` 过滤的那一档）。
 */
export function projectViewPaneChoices(root: string): ProjectViewPaneChoice[] {
  return availableProjectViewPanes(root).map(paneChoiceOf)
}

/** 上游 `isInitiallyVisible()` 为真的第一支；没有就用 weight 最大的一支；再没有给 null。 */
export function initialProjectViewPaneId(root: string): string | null {
  const panes = availableProjectViewPanes(root)
  const preferred = panes.find(pane => {
    try { return pane.isInitiallyVisible() } catch { return false }
  })
  return (preferred ?? panes[0])?.id ?? null
}

export interface ProjectViewPaneHostDeps {
  /** 当前工作区根（空 = 没有工作区，窗格表为空）。 */
  root: () => string
  /** 上次选中的窗格 id（跨会话恢复用；答不出给 null）。 */
  load?: () => string | null
  /** 记住新选择（跨会话持久化用）。 */
  persist?: (id: string) => void
}

export interface ProjectViewPaneHost {
  /** 当前选中的窗格 id（没有可用窗格时是空串）。 */
  activeId: Ref<string>
  /** 选择器行表（随 `root()` 变化重建）。 */
  choices: ComputedRef<ProjectViewPaneChoice[]>
  /** 当前窗格的贡献对象（被禁用/删掉时回落到第一支，找不到给 null）。 */
  current: ComputedRef<ProjectViewPaneContribution | null>
  /** 切到指定 id（不在可用表里则忽略）。 */
  select: (id: string) => void
  /** 按选择器顺序切上/下一个（越界环绕）。 */
  cycle: (forward: boolean) => void
}

/**
 * 窗格选择宿主（上游 `ProjectViewImpl.changeView(id)` 那一层）。
 *
 * 语义：
 *   · 初始值 = `deps.load()` 给出的 id（若它在可用表里），否则 `initialProjectViewPaneId(root)`；
 *   · `root()` 变到一个没有该窗格的工作区时，`current` 回落到第一支（不把选中项悬在空处）；
 *   · `select(id)` 只接受可用表里的 id —— 上游 `changeView` 找不到 pane 时不动当前视图。
 */
export function createProjectViewPaneHost(deps: ProjectViewPaneHostDeps): ProjectViewPaneHost {
  const activeId = ref('')
  const choices = computed(() => projectViewPaneChoices(deps.root()))
  const current = computed<ProjectViewPaneContribution | null>(() => {
    const list = availableProjectViewPanes(deps.root())
    if (!list.length) return null
    const wanted = activeId.value || initialProjectViewPaneId(deps.root()) || ''
    return list.find(pane => pane.id === wanted) ?? list[0] ?? null
  })
  // 初始化：先读持久化的选择，缺省用 isInitiallyVisible 那一支。
  const stored = deps.load?.() ?? null
  const initial = stored && availableProjectViewPanes(deps.root()).some(pane => pane.id === stored)
    ? stored
    : initialProjectViewPaneId(deps.root())
  activeId.value = initial ?? ''

  return {
    activeId,
    choices,
    current,
    select(id: string) {
      if (!availableProjectViewPanes(deps.root()).some(pane => pane.id === id)) return
      activeId.value = id
      deps.persist?.(id)
    },
    cycle(forward: boolean) {
      const list = availableProjectViewPanes(deps.root())
      if (!list.length) return
      const at = list.findIndex(pane => pane.id === activeId.value)
      const next = at < 0 ? 0 : (at + (forward ? 1 : -1) + list.length) % list.length
      const id = list[next]!.id
      activeId.value = id
      deps.persist?.(id)
    },
  }
}

/** 诊断：当前 EP 里一共有几支窗格、各是什么（排查"第三方挂了但没生效"用）。 */
export function projectViewPaneCatalog(): ProjectViewPaneChoice[] {
  return projectViewPanes().map(paneChoiceOf)
}

export { PROJECT_VIEW_PANE_EP }
