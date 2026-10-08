// 项目部件（标题栏左侧那个项目切换按钮）的**动作过滤扩展点** —— IDEA
// `com.intellij.projectWidgetActionsFilter` 在本仓的等价物。
//
// 上游是什么（逐条开过参考树）：
//   · EP 声明：`platform/platform-impl/resources/intellij.platform.ide.impl.xml:371`
//     的 `<extensionPoint qualifiedName="com.intellij.projectWidgetActionsFilter"
//     interface="com.intellij.openapi.wm.impl.headertoolbar.ProjectWidgetActionsFilter" dynamic="true"/>`；
//   · 接口：`platform/platform-impl/src/com/intellij/openapi/wm/impl/headertoolbar/ProjectWidgetActionsFilter.kt`
//     —— **只有一个方法** `shouldHideProjectSwitchingActions(event: AnActionEvent): Boolean`，
//     companion 里的 `EP_NAME` 就是上面那条 qualifiedName；插件在 plugin.xml 里
//     `<com.intellij.projectWidgetActionsFilter implementation="…"/>` 挂一条，返回 true 时
//     `ProjectToolbarWidgetAction` 就把「切换项目」那一组动作摘掉（例如在受限环境下不让用户切项目）。
//
// 本仓此前的判决（`docs/inventory/verdict-toolwindow-openapi.md` 的 `ProjectWidgetActionsFilter` 行）
// 记的是「本仓没有插件运行时 ⇒ 无该 EP（不造只被自己调的接口）」。2026-10-06 的规约变更
// （用户规则 3：**缺失能力要暴露成与 IDEA 相同的方法给第三方插件使用**，目标是原版 IDEA 插件
// 能在本仓跑）把这条理由作废了：没有插件运行时不等于不该有 EP —— 恰恰相反，第三方要能按
// **同名 id + 同名方法**挂进来。于是这里补上声明面 + 注册面 + 一条与上游同名的聚合问法。
//
// **本仓的等价交换**：上游的入参是 `AnActionEvent`（带 `Presentation`/`Place`/`Project`）。
// 本仓的项目部件不是 `AnAction` 体系，而是 `src/projectWidget.ts` 那份**最近项目行**，
// 所以事件对象给的是广告牌能理解的那几个字段（项目路径 / 项目名 / 当前项目根）——
// 语义对齐的是「这一次项目切换动作是不是该被藏起来」，不是 `AnActionEvent` 的结构本身。
//
// 消费链路（真在跑的那条）：`src/projectWidget.ts` 的 `filterProjects` 在速度搜索过滤之后
// 逐条问一次 `shouldHideProjectSwitchingActions`，被藏掉的项目不出现在
// `src/menuUi.ts` 的项目部件分组里（`menuUi.ts` 的 `projectWidgetGroups` 就是项目部件的行源）。
// 没有任何 provider 时恒为 false ⇒ 既有行为一字不变（判据
// `tests/project-widget-actions-filter.test.mjs` 与 `tests/project-widget.test.mjs` 同时钉住）。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），以便 `node --test` 直测。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/**
 * EP id（逐字取自上游 `ProjectWidgetActionsFilter.kt` 的 `EP_NAME`
 * `ExtensionPointName.create("com.intellij.projectWidgetActionsFilter")`，
 * 声明在 `intellij.platform.ide.impl.xml:371`）。
 */
export const PROJECT_WIDGET_ACTIONS_FILTER_EP = 'com.intellij.projectWidgetActionsFilter'

/**
 * 一次「项目切换动作」判定的事件（上游 `AnActionEvent` 的可移植子集）。
 * 本仓没有 `AnAction`/`Presentation`，给的是项目部件那一行自己知道的东西。
 */
export interface ProjectWidgetSwitchEvent {
  /** 这一行代表的项目路径（上游从 `Project`/`VirtualFile` 上取）。 */
  projectPath: string
  /** 项目显示名（速度搜索用的同一个名字）。 */
  projectName: string
  /** 当前打开的项目根；没有打开项目时是空串（上游 `event.project == null` 那档）。 */
  currentRoot: string
}

/**
 * 一条过滤贡献（上游 `ProjectWidgetActionsFilter` 的方法面，名字逐字相同）。
 * 返回 true = 这一次切换动作要藏起来。
 */
export interface ProjectWidgetActionsFilter {
  /** 贡献 id（注销与诊断用；上游是 plugin 的扩展描述）。 */
  id: string
  /** `ProjectWidgetActionsFilter.shouldHideProjectSwitchingActions(event)`。 */
  shouldHideProjectSwitchingActions: (event: ProjectWidgetSwitchEvent) => boolean
}

/** 声明 EP（幂等：重复调用只是覆盖同名声明）。 */
export function declareProjectWidgetActionsFilterExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({
    id: PROJECT_WIDGET_ACTIONS_FILTER_EP,
    name: '项目部件动作过滤器',
    scope: APPLICATION_SCOPE,
    dynamic: true,
  })
}

/** 插件贡献一条过滤（等价于 plugin.xml 里的一条 `<com.intellij.projectWidgetActionsFilter/>`）。 */
export function registerProjectWidgetActionsFilterExtension(
  filter: ProjectWidgetActionsFilter,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  // 声明后再挂：独立使用本模块（测试/宿主）时先声明，避免 UnknownExtensionPointError。
  if (!EXTENSIONS.hasExtensionPoint(PROJECT_WIDGET_ACTIONS_FILTER_EP)) declareProjectWidgetActionsFilterExtensionPoint()
  return EXTENSIONS.registerExtension(PROJECT_WIDGET_ACTIONS_FILTER_EP, filter.id, filter, options)
}

/** 注销一条过滤贡献。返回是否真的删掉了。 */
export function unregisterProjectWidgetActionsFilterExtension(id: string): boolean {
  return EXTENSIONS.unregisterExtension(PROJECT_WIDGET_ACTIONS_FILTER_EP, id)
}

/** 当前 EP 上的全部过滤贡献（bundled + 第三方）。 */
export function projectWidgetActionsFilters(scope: string = APPLICATION_SCOPE): ProjectWidgetActionsFilter[] {
  return EXTENSIONS.extensionsOf<ProjectWidgetActionsFilter>(PROJECT_WIDGET_ACTIONS_FILTER_EP, scope)
}

/**
 * 聚合问法（上游 `ProjectWidgetActionsFilter` 的消费点：`ProjectToolbarWidgetAction` 遍历
 * EP 上每一条，**任一条答 true 就藏**）。没有 provider 时恒为 false。
 */
export function shouldHideProjectSwitchingActions(event: ProjectWidgetSwitchEvent): boolean {
  for (const filter of projectWidgetActionsFilters()) {
    if (filter.shouldHideProjectSwitchingActions(event)) return true
  }
  return false
}

// 模块加载即声明（与 `src/findUsagesProvider.ts` 同一约定：EP 在 import 时就位）。
declareProjectWidgetActionsFilterExtensionPoint()
