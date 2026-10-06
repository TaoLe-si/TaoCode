// 工具窗口注册链的**装配规则** —— IDEA `com.intellij.toolWindow` 扩展点（`ToolWindowEP`）
// 到 `ToolWindowFactory`，再到 `RegisterToolWindowTask`，最后落到 `WindowInfo` 的那一段
// 在本仓的等价物。本模块只有**类型与纯函数**：注册表住在 `src/toolWindowMeta.ts`，
// 查询门面住在 `src/toolWindowManager.ts`，三者不互换职责，也不重算对方那份量。
//
// 上游坐标（参考树 intellij-community-master，行号逐条数过）：
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowEP.java`
//     `:18`（EP_NAME = `com.intellij.toolWindow`）、`:22-24`（`id`，@RequiredElement）、
//     `:29-30`（`anchor`，注释原文 "left", "right" or "bottom"）、`:49-50`（`icon`）、
//     `:60-61`（`doNotActivateOnStart`）、`:67-69`（`factoryClass`，@RequiredElement）、
//     `:78-79`（`secondary`）、`:81-82`（`canCloseContents`）、
//     `:96-118`（`getToolWindowFactory`：懒实例化并缓存，`factoryClass` 为空抛 PluginException `:102-104`）、
//     `:120-125`（`getCondition`：旧 `conditionClass`，为空返回 null）；
//   · `platform/platform-api/src/com/intellij/openapi/wm/ToolWindowFactory.kt`
//     `:23-30`（`isApplicableAsync` → 旧 `isApplicable`，默认 true）、`:33`（`createToolWindowContent`）、
//     `:38`（`init`）、`:42`（`manage`）、`:54`（`shouldBeAvailable`，默认 true）、
//     `:58`（`isDoNotActivateOnStart`，已废弃，改由 EP 属性给）、`:64-66`（`anchor`：返回 null 才用注册表/用户的）、
//     `:68-70`（`icon`）；
//   · `platform/platform-impl/src/com/intellij/toolWindow/ToolWindowSetInitializer.kt`
//     `:340-342`（`getToolWindowAnchor`：`factory.anchor ?: ToolWindowAnchor.fromText(bean.anchor ?: LEFT)`）、
//     `:344-356`（`beanToTask`：先按 `suppressedToolWindowIds` 丢，再问 `isApplicableAsync`，
//     **不过关就压根不注册** —— 与 `shouldBeAvailable` 的"注册了但灰着"是两道不同的闸）、
//     `:358-376`（字段映射，逐条见下面 `beanToTask` 的注释）、
//     `:379-409`（`computeToolWindowBeans`：EP 序列 + `conditionClass` 那道旧闸在 `:390-392`）；
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/DesktopLayout.kt`
//     `:42-55`（`create(task)`：`info.isSplit = task.sideTool`（`:46`）、`toolWindowPaneId` 给默认 pane（`:49`）、
//     再用 `task.contentFactory?.anchor` 覆盖锚点（`:51-53`））；
//   · `platform/platform-api/src/com/intellij/openapi/wm/RegisterToolWindowTask.kt:12-25`（`RegisterToolWindowTaskData` 的字段面）。
//
// 本仓没有插件运行时（`.tools/agent-rules.md` §3 的硬规则 2），所以**没有 XML 解析**这一层：
// "EP 声明" = `toolWindowMeta.ts` 注册表里那一条，"factoryClass 懒实例化" = 同一条里的 `factory`。
// 这条链值得留下的原因是它把**三件不同的事**分开了，而它们过去混在一个 `available` 谓词里：
//   1) 这个窗口在**这个项目里根本不该存在**（`isApplicable` ⇒ 不注册，条纹上没有它）；
//   2) 它存在但**此刻给不出内容**（`shouldBeAvailable` ⇒ 注册了，条纹上灰着）；
//   3) 它的**内容能不能被关掉**（`canCloseContents` ⇒ 关标签那条链的第一道闸，
//      见 `ContentManagerImpl.java:139-141`/`:473`、`ContentTabLabel.java:170`、`CloseActiveTabAction.java:25/46`、
//      `ToolWindowCloseOtherTabsAction.kt:25`、`TabbedContentAction.java:87/114`）。
// 第 3 条以前在本仓没有任何落点， Close All 只看"有几条内容"。

import type { ToolWindowAnchor, ToolWindowAvailability } from './toolWindowMeta.ts'

/**
 * `ToolWindowEP` 声明侧（`<toolWindow>` 的 XML 属性）在本仓的形状。
 * 属性缺省值照上游 Java 字段：三个 boolean 都是 Java 字段，XML 没写就是 false；
 * `anchor` 没写时由 `getToolWindowAnchor` 退到 LEFT（`ToolWindowSetInitializer.kt:341`）。
 */
export interface ToolWindowBean {
  /** `ToolWindowEP.java:22-24` 的 `id`（@RequiredElement）。 */
  id: string
  /** `ToolWindowEP.java:29-30` 的 `anchor`。 */
  anchor?: ToolWindowAnchor
  /** `ToolWindowEP.java:49-50` 的 `icon`（上游是图标**资源路径**，本仓直接放组件）。 */
  icon?: unknown
  /** `ToolWindowEP.java:78-79` 的 `secondary` —— 上游 `beanToTask` 把它写成 `sideTool`（`:368`）。 */
  secondary?: boolean
  /** `ToolWindowEP.java:81-82` 的 `canCloseContents` —— 上游写成 `canCloseContent`（`:369`）。 */
  canCloseContents?: boolean
  /** `ToolWindowEP.java:60-61` 的 `doNotActivateOnStart` —— 决定 `WindowInfo.isActiveOnStart`。 */
  doNotActivateOnStart?: boolean
}

/**
 * `ToolWindowFactory`（`ToolWindowFactory.kt:17-71`）在本仓的面。
 * `createToolWindowContent`（`:33`）那一半**没有**数据化：本仓每个视图组件的 props 各不相同，
 * 内容挂载仍是 `ToolWindowView.vue` 的模板链（同一件事登记在 `docs/source-todo.md` §12），
 * 这里只给它留一个名字（`contentView`），用来回答"这个窗口挂的是哪个视图"，不假装能凭它造内容。
 */
export interface ToolWindowFactory {
  /**
   * `isApplicableAsync`/`isApplicable`（`:23-30`，默认 true）：**不通过 = 压根不注册**。
   * 上游的例子是 `ToolWindowSetInitializer.kt:355`；本仓目前没有返回 false 的窗口，
   * 这道闸先按机制立着（有了它，第 1 件事与第 2 件事才不会被后来的人合并回同一个谓词）。
   */
  isApplicable?: (deps: ToolWindowAvailability) => boolean
  /** `shouldBeAvailable`（`:54`，默认 true）：注册了但条纹上灰着。 */
  shouldBeAvailable?: (deps: ToolWindowAvailability) => boolean
  /** `anchor`（`:64-66`）：给了就覆盖 EP 的 anchor（`ToolWindowSetInitializer.kt:340-342`、`DesktopLayout.kt:51-53`）。 */
  anchor?: ToolWindowAnchor
  /** `icon`（`:68-70`）：给了就覆盖 EP 的 icon（`ToolWindowSetInitializer.kt:366` 的 `findIconFromBean`）。 */
  icon?: unknown
  /** 本仓的视图挂载点名（`createToolWindowContent` 的等价标记，不参与渲染决策）。 */
  contentView?: string
}

/**
 * `RegisterToolWindowTaskData`（`RegisterToolWindowTask.kt:12-25`）在本仓的那一份：
 * EP 声明与工厂回答合成一条**注册任务**，`DesktopLayout.create` 从这里取 `WindowInfo` 的初值。
 * 上游有而这里没有的字段各有原因：`component`（Swing）、`canWorkInDumbMode`（本仓没有 dumb 模式，
 * 语言服务未就绪时各视图自己给空态）、`pluginDescriptor`（没有插件）、`hideOnEmptyContent`/`emptyText`
 * （另族，见 `ToolWindow.java:215` 的注释）。
 */
export interface RegisterToolWindowTask {
  /** `RegisterToolWindowTaskData.id`。 */
  id: string
  /** `RegisterToolWindowTaskData.icon`。 */
  icon?: unknown
  /** `RegisterToolWindowTaskData.anchor`（已经过了工厂覆盖）。 */
  anchor: ToolWindowAnchor
  /** `RegisterToolWindowTaskData.sideTool` ← EP `secondary`（`:368`）。 */
  sideTool: boolean
  /**
   * `RegisterToolWindowTaskData.canCloseContent` ← EP `canCloseContents`（`:369`）。
   * 注意任务类自己的默认是 true（`RegisterToolWindowTask.kt:17`），但 EP 那条路显式传 bean 的值，
   * 所以**XML 里没写这个属性的窗口就是 false**（`ToolWindowEP.java:81-82` 是 Java boolean 字段）。
   */
  canCloseContent: boolean
  /** `RegisterToolWindowTaskData.shouldBeAvailable` ← `factory.shouldBeAvailable(project)`（`:371`）。 */
  shouldBeAvailable: boolean
  /** `RegisterToolWindowTaskData.stripeTitle`（`:373`）：本仓就是注册表里的标题。 */
  stripeTitle: string
  /** `WindowInfo.isActiveOnStart`：EP `doNotActivateOnStart` 取反（`WindowInfoImpl.kt:165-170`，判据在 `:169`）。 */
  isActiveOnStart: boolean
  /** `WindowInfo.isSplit` 的初值：`DesktopLayout.kt:46` 的 `info.isSplit = task.sideTool`。 */
  isSplit: boolean
  /** `RegisterToolWindowTaskData.contentFactory`（`:372`）。 */
  factory?: ToolWindowFactory
}

/**
 * `ToolWindowSetInitializer.kt:340-342` 的 `getToolWindowAnchor`：
 * 工厂的 anchor 优先，其次 EP 的 anchor，都没有才是 LEFT。
 * `ToolWindowAnchor.fromText` 认不出时也只 warn 并退到 LEFT（`WindowInfoImpl.kt:155-160`），
 * 本仓类型层已经挡掉了非法值，所以这里不需要那一步。
 */
export function toolWindowAnchorOf(bean: ToolWindowBean, factory?: ToolWindowFactory): ToolWindowAnchor {
  return factory?.anchor ?? bean.anchor ?? 'left'
}

/** `WindowInfoImpl.kt:169` 的那一句：EP 缺席或没写 `doNotActivateOnStart` 才允许启动即亮。 */
export function canActivateOnStart(bean: Pick<ToolWindowBean, 'doNotActivateOnStart'>): boolean {
  return bean.doNotActivateOnStart !== true
}

/**
 * EP + 工厂 + 项目状态 → 注册任务；`null` = **这一条不注册**。
 * 两道闸的顺序照上游：先 `suppressedToolWindowIds`（`:350-352`，档案里 `register=false` 的那些，
 * 本仓由调用方算好传进来，见 `toolLayoutProfiles.ts`），再 `isApplicableAsync`（`:355`）。
 * 两道闸都在"注册"这一层，与 `shouldBeAvailable`（`:371`，注册了但灰着）不同层 —— 这是本模块存在的理由。
 */
export function beanToTask(input: {
  bean: ToolWindowBean
  factory?: ToolWindowFactory
  deps: ToolWindowAvailability
  /** `ToolWindowSetInitializer.kt:350` 的 `suppressedToolWindowIds`（档案压掉的 id）。 */
  suppressedIds?: readonly string[]
  /** `RegisterToolWindowTaskData.stripeTitle`：上游从 `toolwindow.stripe.<id>` 资源键取（`ToolWindowFactory.kt:13`），本仓由注册表给。 */
  stripeTitle: string
}): RegisterToolWindowTask | null {
  const { bean, factory, deps, stripeTitle } = input
  if (input.suppressedIds?.includes(bean.id)) return null
  // `ToolWindowSetInitializer.kt:355`：`factory.isApplicableAsync(project)` 为假 ⇒ 这条任务不存在。
  if (factory?.isApplicable && !factory.isApplicable(deps)) return null
  const sideTool = bean.secondary === true
  return {
    id: bean.id,
    // `:366` 图标：工厂给的就覆盖 EP 给的。
    icon: factory?.icon ?? bean.icon,
    // `:367` = `getToolWindowAnchor(factory, bean)`。
    anchor: toolWindowAnchorOf(bean, factory),
    // `:368` `sideTool = bean.secondary || bean.side`；`side` 已废弃（`ToolWindowEP.java:42-44`）且本仓没有它。
    sideTool,
    // `:369` `canCloseContent = bean.canCloseContents`（Java boolean 字段：没写 = false）。
    canCloseContent: bean.canCloseContents === true,
    // `:371` `shouldBeAvailable = factory.shouldBeAvailable(project)`（没有工厂谓词 = 恒可用）。
    shouldBeAvailable: factory?.shouldBeAvailable ? factory.shouldBeAvailable(deps) : true,
    stripeTitle,
    isActiveOnStart: canActivateOnStart(bean),
    // `DesktopLayout.kt:46`：`WindowInfo.isSplit` 的**初值**就是 `sideTool`；
    // 上游之后用户可以把它拖成另一档（`AbstractDroppableStripe.kt:254-255` 的 `setSideToolAndAnchor`），
    // 那一档住在项目布局里（`toolLayoutProfiles.ts`），不在这条任务里。
    isSplit: sideTool,
    ...(factory ? { factory } : {}),
  }
}
