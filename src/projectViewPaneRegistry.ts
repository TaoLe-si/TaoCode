// **项目视图窗格注册表 + 窗格切换语义 + VFS 协议注册面**（HANDOFF 缺口③ 的纯逻辑一半）。
// 零 Vue、零 DOM、零 bridge；只 import 类型（无值 import），便于 `node --test` 直测。
//
// 与 `src/projectViewPanes.ts` 的分工（那里是 Vue 响应式宿主 + 本仓三个 bundled 贡献）：
// 本文件落的是**上游 EP 与窗格描述子的真实属性面**、**`ProjectViewImpl.changeView` 的真实结果语义**、
// 以及 **`com.intellij.virtualFileSystem` 的协议注册面** —— 也就是「窗格该有哪些字段、切窗格到底发生什么、
// 一个 URL 属于哪个协议」这三件在 `src/projectViewPanes.ts` 里没有出处可依的事。
//
// ── 上游依据（逐条核过，行号可复现） ────────────────────────────────────────────────────────
//
// ① EP 本体：`com.intellij.projectViewPane`
//   · 声明 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:314`
//     （`interface="com.intellij.ide.projectView.impl.AbstractProjectViewPane"` area="IDEA_PROJECT" dynamic="true"）。
//   · `AbstractProjectViewPane.EP`（`platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPane.java:151-152`）。
//
// ② 窗格方法面（`AbstractProjectViewPane.java`，逐条行号）：
//   `getTitle():225` / `getIcon():227` / `getId():229` / `isDefaultPane(project):231`（默认 false，`:232`）/
//   `isInitiallyVisible():249`（默认 true，`:250`）/ `supportsManualOrder():253` / `getSubIds():265` /
//   `getPresentableSubIdName(subId):269` / `getPresentableSubIdIcon(subId):273` / `isFileNestingEnabled():427`
//   （默认 false，`:428`）/ `getWeight():487`（"used for sorting tabs in the tabbed pane" `:486`）/
//   `createSelectInTarget():489`。
//   **订正**：这条 EP 上**没有** `getGroup()`、**没有** `isAvailable(...)`、**没有** `getTooltip()`、**没有** `position`。
//   三条路都搜过（见报告「无法核实」），`grep -rn "getGroup" AbstractProjectViewPane.java` 与
//   `grep -rn "isAvailable"` 在整条窗格继承链（AbstractProjectViewPane / AbstractProjectViewPaneWithAsyncSupport /
//   ProjectViewPane / PackageViewPane / ScopeViewPane / ProjectViewImpl）上**零命中**。
//   ⇒ 本仓 `src/projectViewPanes.ts` 的 `ProjectViewPaneContribution.getGroup` / `isAvailable(root)` 是**本仓自造**，
//   不是上游 EP 方法面（不改那个文件，只在此登记）。
//
// ③ 内置窗格（legacy 三支 + 欢迎页一支），声明顺序 = 各自 plugin.xml 里的出现顺序：
//   · `ProjectViewPane`：`ID = "ProjectPane"`（`platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewPane.java:40`）；
//     `getTitle()` → `IdeBundle.message("title.project")`（`:54`；值 `Project` 在
//     `platform/platform-api/resources/messages/IdeBundle.properties:497`）；`getIcon()` → `AllIcons.General.ProjectTab`（`:64`）；
//     `getWeight()` → `0`（`:123`，注释 "should be first" `:121`）；`isFileNestingEnabled()` → true（`:117`）；
//     树根 `ProjectViewProjectNode`（`:134`；类 `.../impl/nodes/ProjectViewProjectNode.java:31`，
//     子节点是模块 / 模块组 `:48`、`:105`、`:122-123`）；贡献 `idea/customization/min/resources/intellij.platform.customization.min.xml:15`。
//   · `PackageViewPane`：`ID = "PackagesPane"`（`java/java-impl/src/com/intellij/ide/projectView/impl/PackageViewPane.java:52`）；
//     `getTitle()` → `JavaBundle.message("title.packages")`（`:67`；值 `Packages` 在
//     `java/openapi/resources/messages/JavaBundle.properties:1337`）；`getIcon()` → `AllIcons.Nodes.CopyOfFolder`（`:72`）；
//     `getWeight()` → `1`（`:188`）；树根 `PackageViewProjectNode`（`:163`；类
//     `java/java-impl/src/com/intellij/ide/projectView/impl/nodes/PackageViewProjectNode.java:27`，子节点 `:49`）；
//     贡献 `java/java-backend/resources/META-INF/JavaPlugin.xml:397`。
//   · `ScopeViewPane`：`ID = "Scope"`（`platform/lang-impl/src/com/intellij/ide/scopeView/ScopeViewPane.java:78`）；
//     `getWeight()` → `4`（`:162`）；`getTitle()` → `IdeBundle.message("scope.view.title")`（`:167`；值 `Scopes` 在
//     `IdeBundle.properties:909`）；`getIcon()` → `AllIcons.Ide.LocalScope`（`:172`）；`isFileNestingEnabled()` → true（`:176`）；
//     `getSubIds()` = 具名范围名（`:397-403`），`getPresentableSubIdName(subId)` = 范围显示名（`:406-409`）；
//     贡献 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1387`。
//   · `WelcomeScreenLeftPanel`：`class ... : ProjectViewPane(project)`（`platform/non-modal-welcome-screen/src/
//     com/intellij/platform/ide/nonModalWelcomeScreen/leftPanel/WelcomeScreenLeftPanel.kt:43`）；`ID` =
//     `"NonModalWelcomeScreenProjectPane"`（`:160`）；`getWeight()` → `-10`（`:58`，注释 "TODO: Increase weight?"）；
//     `isInitiallyVisible()` = `project.isWelcomeExperienceProjectSync() && isNonModalWelcomeScreenEnabled`（`:52`）；
//     `isDefaultPane(project)` = `project.isWelcomeExperienceProjectSync()`（`:54-56`）；`getTitle()` →
//     `NonModalWelcomeScreenBundle.message("welcome.screen.project.view.title")`（`:46`；值 `Projects and Files` 在
//     `platform/non-modal-welcome-screen/resources/messages/NonModalWelcomeScreenBundle.properties:6`）；
//     `getIcon()` → `PlatformIcons.Folder`（`:50`）；
//     贡献 `platform/non-modal-welcome-screen/resources/intellij.platform.ide.nonModalWelcomeScreen.xml:55`。
//
// ④ 现代窗格描述子（`platform/projectView/**`，与 legacy EP 并存，靠 `ProjectViewPaneId` 去重）：
//   · `ProjectViewPaneDescriptorBuilder`：`setDefault(isDefault)` / `setIcon(icon)` /
//     `addSelectInTarget(id, presentableName, weight)` / `build(id, presentableName, order)`
//     （`platform/projectView/shared/src/pane/ProjectViewPaneDescriptor.kt:32`、`:34`、`:36-40`、`:42`）。
//   · `ProjectViewPaneDescriptorImpl` 字段 `id / kind / presentableName / order / isDefault / icon /
//     selectInTargetDescriptors`（`.../ProjectViewPaneDescriptorImpl.kt:21-29`）；`ProjectViewPaneKind` = BACKEND / LIGHT /
//     UI_ONLY（`:68-72`）。
//   · `SelectInTargetDescriptor(id, presentableName, weight)`（`.../ProjectViewPaneSelectInImpl.kt:18-22`）。
//   · 三个新模型：`ProjectPaneModel` id = `ProjectViewPane.ID`、`presentableName()` =
//     `ProjectViewBundle.message("project.view.pane.project.title")`、`order()` = 0、`supportsFileNesting()` = true
//     （`platform/projectView/shared/src/impl/project/ProjectPaneModel.kt:34`、`:43`、`:45`、`:68`；
//     值 `Project` 在 `platform/projectView/shared/resources/messages/ProjectViewBundle.properties`）；
//     `PackageViewPaneModel` id = `"PackagesPane"`、`presentableName()` = `JavaBundle.message("title.packages")`、
//     `order()` = 1（`java/java-impl/src/com/intellij/ide/projectView/impl/PackageViewPaneModel.kt:52`、`:54`、`:56`）；
//     `ScopePaneModel` id = `"${ScopeViewPane.ID}:$filter"`、`presentableName()` = 范围显示名、`order()` = 4、
//     `supportsFileNesting()` = true（`platform/projectView/backend/src/impl/scope/ScopePaneModel.kt:163`、`:68`、`:70`、`:143`）。
//   · 提供者接口 `ProjectViewPaneProvider.createPanes(project)`（`.../pane/ProjectViewPaneService.kt:59`）——
//     这就是「窗格是运行时可增删的」那一层：`ProjectViewPaneServiceBase.managePanes` 按实例身份判增删
//     （`:103-147`），重复 id 只留第一个（`:120-127`）。
//   · 排序：描述子集合 `sortedBy { it.order }`（`platform/projectView/frontend/src/pane/FrontendProjectViewPaneAggregator.kt:119`）。
//
// ⑤ 窗格切换语义 `ProjectViewImpl.changeView`：
//   · `changeView(viewId)` → `changeView(viewId, null)`（`platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewImpl.java:1576-1578`）；
//     `changeView(viewId, subId)` → `changeViewCB(viewId, subId)`（`:1581-1583`）。
//   · `changeViewCB`（`:1586`）：`getProjectViewPaneById(viewId)`（`:1587`，找不到时 `LOG.assertTrue` 失败，`:1588`）；
//     有子视图且 subId==null ⇒ **沿用当前 subId**（`:1590-1597`）；无子视图却给了 subId ⇒ `LOG.error`
//     "View doesn't have subviews"（`:1598-1600`）；`viewId` 与 subId 都和当前相同 ⇒ `ActionCallback.REJECTED`
//     （`:1602-1604`）；否则按 (id, subId) 找 Content 并 `setSelectedContentCB`（`:1613-1617`），找不到 ⇒ REJECTED（`:1619`）。
//   · `setSelectedView(id, subId)`（`:1349-1369`）：与当前相同直接 return（`:1350-1352`）；pane 找不到 return（`:1354-1357`）；
//     `newPane.setSubId(subId)` + `showPane(newPane)`（`:1359-1360`）。
//   · `showPane`（`:1070-1117`）：换 pane 前 `currentPane.saveExpandedPaths()`（`:1074-1076`）；`currentViewId = newPane.getId()`（`:1087`）；
//     `currentViewSubId = newPane.getSubId()`（`:1088`）；`restoreExpandedPaths()`（`:1100`）；广播 `paneShown(newPane, currentPane)`（`:1114`）。
//   · `getCurrentViewId()` 返回字段 `currentViewId`（`:1510-1512`；字段 `:579`，subId `:580`）。
//   · `getDefaultViewId()`（`:1683-1690`）：**按 EP 注册序**取第一支 `isDefaultPane(project)` 为真的 pane 的 id，
//     一支都没有 ⇒ 回落 `ProjectViewPane.ID`（`:1689`）。注意它**不按 weight 排序**（对比 `loadPanes` 的排序，`:1311-1314`）。
//   · 排序比较器 `PANE_WEIGHT_COMPARATOR = Comparator.comparingInt(AbstractProjectViewPane::getWeight)`（`:604`），
//     `loadPanes()` 用它升序（`:1313-1314`）并**要求 weight 互不相同**（`doAddPane` 的断言 `:1032-1034`）。
//   · `getPaneIds()` = `idToPane.keySet()`（`:2172-2174`）；`idToPane` 字段 `:590`。
//
// ⑥ 持久化：
//   · legacy：`@State(name = "ProjectView", storages = @Storage(StoragePathMacros.PRODUCT_WORKSPACE_FILE), getStateRequiresEdt = true)`
//     （`ProjectViewImpl.java:156`）；元素/属性常量 `ELEMENT_NAVIGATOR="navigator"`（`:596`）、`ELEMENT_PANES="panes"`（`:597`）、
//     `ELEMENT_PANE="pane"`（`:598`）、`ATTRIBUTE_CURRENT_VIEW="currentView"`（`:599`）、
//     `ATTRIBUTE_CURRENT_SUBVIEW="currentSubView"`（`:600`）、`ATTRIBUTE_ID="id"`（`:602`）；
//     `getState()` 把 `currentView` = 当前 pane id、`currentSubView` = subId 写进 navigator（`:1721-1732`）；
//     `loadState()` 读回 `savedPaneId` / `savedPaneSubId`（`:1656-1666`）。
//   · 现代：属性 `selectedPaneId`（`platform/projectView/frontend/src/window/ProjectViewToolWindowServiceImpl.kt:718` 写、
//     `:736` 读）；缺省 = `projectViewPaneId(ProjectViewPane.ID)`（`:752-753`）；每个窗格的树状态在
//     `<panes><pane pane="<id>">` 里（`:722-728` 写、`:742-749` 读）。
//
// ⑦ VFS 协议注册面：
//   · EP `com.intellij.virtualFileSystem`：声明 `platform/core-impl/resources/META-INF/CoreImpl.analyzer.xml:14`
//     （`beanClass="com.intellij.openapi.vfs.impl.VirtualFileManagerImpl$VirtualFileSystemBean"` dynamic="true"，
//     `implementationClass` implements `com.intellij.openapi.vfs.VirtualFileSystem`）。
//   · `VirtualFileSystem.EP_NAME = ExtensionPointName.create("com.intellij.virtualFileSystem")`
//     （`platform/core-api/src/com/intellij/openapi/vfs/VirtualFileSystem.java:28`）；
//     `getProtocol()` 抽象（`:40`，"Should be the same as corresponding KeyedLazyInstanceEP#key" `:33`）；
//     `findFileByPath(path)`（`:51`）；`isLocal()` 默认 false（`:183`）。
//   · bean 的 `physical` 属性：`VirtualFileSystemBean extends KeyedLazyInstanceEP<VirtualFileSystem>`，
//     `@Attribute public boolean physical`（`platform/core-impl/src/com/intellij/openapi/vfs/impl/VirtualFileManagerImpl.java:62-65`）；
//     `getPhysicalFileSystems()` 只收 physical 为真的 bean（`:93-106`）。
//   · 查协议：`VirtualFileManager.getFileSystem(protocol)`（`platform/core-api/src/com/intellij/openapi/vfs/VirtualFileManager.java:65`）
//     → `VirtualFileManagerImpl.getFileSystem`（`:118-130`，`getFileSystemsForProtocol` 走 `myCollector.forKey`，`:132-134`；
//     同协议注册超过一支就 `LOG.error`，`:126-128`）。
//   · URL 与协议互转（`VirtualFileManager`）：`constructUrl(protocol, path)` = `protocol + "://" + path`（`:227-229`）；
//     `extractProtocol(url)` 取 "://" 之前那一段，没有 "://" 给 null（`:238-242`）；`extractPath(url)`（`:247-249`）。
//   · `findFileByUrl(url)` → `findByUrl`（`VirtualFileManagerImpl.java:398-413`）：按 "://" 切协议头，取不到 FS 给 null
//     （`:409-410`），否则 `fileSystem.findFileByPath(path)`（`:412`）。⇒ **裸路径不是合法 URL**（无 "://" ⇒ null）。
//   · 协议常量 `platform/util/src/com/intellij/util/io/URLUtil.java`：`SCHEME_SEPARATOR="://"`（`:33`）、
//     `FILE_PROTOCOL="file"`（`:34`）、`HTTP_PROTOCOL="http"`（`:35`）、`HTTPS_PROTOCOL="https"`（`:36`）、
//     `JAR_PROTOCOL="jar"`（`:37`）、`JRT_PROTOCOL="jrt"`（`:38`）、`JAR_SEPARATOR="!/"`（`:39`）。
//   · `StandardFileSystems`（`platform/core-api/src/com/intellij/openapi/vfs/StandardFileSystems.java`）：
//     `FILE_PROTOCOL:10` / `FILE_PROTOCOL_PREFIX:11` / `JAR_PROTOCOL:13` / `JAR_PROTOCOL_PREFIX:14` /
//     `JRT_PROTOCOL:16` / `JRT_PROTOCOL_PREFIX:17`。
//   · 本仓侧的协议现状（如实）：`src/rootsJarEntries.ts:134` 的 `jarUrl(archive, entry)` = `jar://<档案>!/<条目>`、
//     `:140` 的 `parseJarUrl`（字符串形态的上游 `ArchiveFileSystem`，出处 `platform/analysis-api/src/com/intellij/
//     openapi/vfs/newvfs/ArchiveFileSystem.java:39`、`:56`、`:65`、`:50-51`、`:68`、`:92`），
//     以及 `src/pluginServices.ts:129` 的 `getProtocol: () => 'http'`（HTTP 只读 FS 的桩）。
//     **没有**一张统一的「协议 → 文件系统」注册表 —— 本文件补的就是那一层。
//
// 判据：`tests/project-view-pane-registry.test.mjs`。

// ── ① 窗格 id 与 EP 属性面 ────────────────────────────────────────────────────────────────

/** `com.intellij.projectViewPane`（`AbstractProjectViewPane.java:151-152` / `intellij.platform.lang.impl.xml:314`）。 */
export const PROJECT_VIEW_PANE_EP = 'com.intellij.projectViewPane'

/** `ProjectViewPane.ID`（`ProjectViewPane.java:40`）。 */
export const PROJECT_PANE_ID = 'ProjectPane'
/** `PackageViewPane.ID`（`PackageViewPane.java:52`）。 */
export const PACKAGES_PANE_ID = 'PackagesPane'
/** `ScopeViewPane.ID`（`ScopeViewPane.java:78`）。 */
export const SCOPE_PANE_ID = 'Scope'
/** `WelcomeScreenLeftPanel.ID`（`WelcomeScreenLeftPanel.kt:160`）。 */
export const WELCOME_PANE_ID = 'NonModalWelcomeScreenProjectPane'

/**
 * `getDefaultViewId()` 的兜底（`ProjectViewImpl.java:1689`）：没有任何 `isDefaultPane` 的窗格时用它。
 */
export const DEFAULT_PROJECT_VIEW_PANE_ID = PROJECT_PANE_ID

/** `ProjectViewPaneKind`（`ProjectViewPaneDescriptorImpl.kt:68-72`）：窗格实现住在哪一层。 */
export type ProjectViewPaneKind = 'BACKEND' | 'LIGHT' | 'UI_ONLY'

/**
 * 窗格给什么**树形状**（本仓词；上游没有这个词，是三种 `createStructure` 根节点的归纳）：
 *   · `directory` = `ProjectViewProjectNode`（目录/模块树，`ProjectViewPane.java:134`）；
 *   · `package`   = `PackageViewProjectNode`（包树，`PackageViewPane.java:163`）；
 *   · `scope`     = `ScopeViewTreeModel` 按具名范围过滤（`ScopeViewPane.java:184`）；
 *   · `directory-with-search` = 欢迎页：继承项目窗格但顶部带搜索框（`WelcomeScreenLeftPanel.kt:43-44`）。
 */
export type ProjectViewTreeShape = 'directory' | 'package' | 'scope' | 'directory-with-search'

/** `isDefaultPane(project)` 要的上下文（上游那个 `Project` 的可移植子集）。 */
export interface ProjectViewPaneContext {
  /** `project.isWelcomeExperienceProjectSync()`（`WelcomeScreenLeftPanel.kt:54-56`）。 */
  welcomeExperience?: boolean
  /** `isNonModalWelcomeScreenEnabled`（`WelcomeScreenLeftPanel.kt:52`）。 */
  nonModalWelcomeScreen?: boolean
}

/**
 * 一条窗格描述子 —— 字段逐条对上游，来源分两代：
 *   `id` / `title` / `order` / `isDefault` / `icon` / `tree` / `selectInTargetId` 对 **legacy EP**（`AbstractProjectViewPane.java:225-489`）；
 *   `kind` / `order` / `presentableName` 对**现代描述子**（`ProjectViewPaneDescriptorImpl.kt:21-29`）。
 * 两代的 order 值一致（Project 0 / Packages 1 / Scope 4）。
 */
export interface ProjectViewPaneDescriptor {
  /** `getId()`（`AbstractProjectViewPane.java:229`）；现代 `ProjectViewPaneId.idString`（`ProjectViewPaneDescriptor.kt:19`）。 */
  readonly id: string
  /** `getTitle()`（`:225`）的**上游字面值**（bundle 译文）。 */
  readonly title: string
  /** `getTitle()` 用的 bundle 键（出处行见文件头）。 */
  readonly titleKey: string
  /** `getWeight()`（`:487`）＝ 现代 `order()`（`ProjectViewPaneDescriptorImpl.kt:25`）；小的在前。 */
  readonly order: number
  /** `isDefaultPane(project)`（`:231`）。 */
  readonly isDefault: (context: ProjectViewPaneContext) => boolean
  /** 上游图标常量（`getIcon()`，`:227`）—— 记上游常量名，不画字形。 */
  readonly icon: string
  /** 树形状（见 `ProjectViewTreeShape`）。 */
  readonly tree: ProjectViewTreeShape
  /** `createSelectInTarget()`（`:489`）给的目标 id；`SelectInTarget.getMinorViewId()` 通常等于窗格 id。 */
  readonly selectInTargetId: string
  /** `isFileNestingEnabled()`（`:427`）。 */
  readonly supportsFileNesting: boolean
  /** `getSubIds()`（`:265`）非空 ⇒ 现代 id 形如 `<id>:<subId>`（`ScopePaneModel.kt:163`）。 */
  readonly hasSubIds: boolean
  /** 这条贡献声明在哪个 plugin.xml（可复现出处）。 */
  readonly declaredAt: string
}

/**
 * 随包发货的四支，**按 EP 注册序**（不是按 weight）—— `getDefaultViewId` 就是按这个顺序扫的
 * （`ProjectViewImpl.java:1684`，注释见文件头⑤）。
 */
export const BUILTIN_PROJECT_VIEW_PANES: readonly ProjectViewPaneDescriptor[] = [
  {
    id: PROJECT_PANE_ID,
    title: 'Project',
    titleKey: 'title.project',
    order: 0,
    isDefault: () => false,
    icon: 'AllIcons.General.ProjectTab',
    tree: 'directory',
    selectInTargetId: PROJECT_PANE_ID,
    supportsFileNesting: true,
    hasSubIds: false,
    declaredAt: 'idea/customization/min/resources/intellij.platform.customization.min.xml:15',
  },
  {
    id: PACKAGES_PANE_ID,
    title: 'Packages',
    titleKey: 'title.packages',
    order: 1,
    isDefault: () => false,
    icon: 'AllIcons.Nodes.CopyOfFolder',
    tree: 'package',
    selectInTargetId: PACKAGES_PANE_ID,
    supportsFileNesting: false,
    hasSubIds: false,
    declaredAt: 'java/java-backend/resources/META-INF/JavaPlugin.xml:397',
  },
  {
    id: SCOPE_PANE_ID,
    title: 'Scopes',
    titleKey: 'scope.view.title',
    order: 4,
    isDefault: () => false,
    icon: 'AllIcons.Ide.LocalScope',
    tree: 'scope',
    selectInTargetId: SCOPE_PANE_ID,
    supportsFileNesting: true,
    hasSubIds: true,
    declaredAt: 'platform/lang-impl/resources/intellij.platform.lang.impl.xml:1387',
  },
  {
    id: WELCOME_PANE_ID,
    title: 'Projects and Files',
    titleKey: 'welcome.screen.project.view.title',
    order: -10,
    isDefault: context => context.welcomeExperience === true,
    icon: 'PlatformIcons.Folder',
    tree: 'directory-with-search',
    selectInTargetId: WELCOME_PANE_ID,
    supportsFileNesting: true,
    hasSubIds: false,
    declaredAt: 'platform/non-modal-welcome-screen/resources/intellij.platform.ide.nonModalWelcomeScreen.xml:55',
  },
]

// ── ② 窗格注册表：排序 / 默认 / 去重 ────────────────────────────────────────────────────────

/**
 * 按 `PANE_WEIGHT_COMPARATOR` 升序（`ProjectViewImpl.java:604`、`:1313-1314`）。
 * **稳定**：order 相同保持注册序（上游 `doAddPane` 断言 weight 互不相同，`:1032-1034`；这里不抛，
 * 只把同 order 的保持原序 —— 上游新描述子侧正是靠「同一 provider 内可等 order 预排序」，`ProjectViewPaneService.kt:111`）。
 */
export function sortPanesByOrder(panes: readonly ProjectViewPaneDescriptor[]): ProjectViewPaneDescriptor[] {
  return panes
    .map((pane, index) => ({ pane, index }))
    .sort((left, right) => left.pane.order - right.pane.order || left.index - right.index)
    .map(item => item.pane)
}

/**
 * 上游 `loadPanes()` 的等价物（`:1311-1326`）：按 id 去重（**先到先得**，重复 id 只留第一支，
 * `:1317-1320` 的 `computeIfAbsent` 语义），返回 id → 窗格。
 */
export function indexPanesById(panes: readonly ProjectViewPaneDescriptor[]): Map<string, ProjectViewPaneDescriptor> {
  const map = new Map<string, ProjectViewPaneDescriptor>()
  for (const pane of panes) if (!map.has(pane.id)) map.set(pane.id, pane)
  return map
}

/**
 * `getDefaultViewId()`（`ProjectViewImpl.java:1683-1690`）：**按注册序**（不是 weight 序）取第一支
 * `isDefaultPane(context)` 为真的；一支都没有 ⇒ `ProjectViewPane.ID`（`:1689`）。
 */
export function defaultProjectViewPaneId(
  panes: readonly ProjectViewPaneDescriptor[] = BUILTIN_PROJECT_VIEW_PANES,
  context: ProjectViewPaneContext = {},
): string {
  for (const pane of panes) {
    try {
      if (pane.isDefault(context)) return pane.id
    } catch {
      // 一个坏窗格不吃掉整张表的默认选择（上游逐个 try/catch 登记，`ProjectViewImpl.java:1295-1303`）。
    }
  }
  return DEFAULT_PROJECT_VIEW_PANE_ID
}

/** `isInitiallyVisible()`（`:249`）：本仓四支里只有欢迎页是条件真，其余恒真（上游默认 true，`:250`）。 */
export function initiallyVisiblePanes(
  panes: readonly ProjectViewPaneDescriptor[] = BUILTIN_PROJECT_VIEW_PANES,
  context: ProjectViewPaneContext = {},
): ProjectViewPaneDescriptor[] {
  return panes.filter(pane => pane.id !== WELCOME_PANE_ID || (context.welcomeExperience === true && context.nonModalWelcomeScreen === true))
}

// ── ③ 窗格切换语义（`ProjectViewImpl.changeView` 的真实结果） ────────────────────────────────

/**
 * 切窗格的结果 —— 上游 `ActionCallback` 的三档（`changeViewCB`，`ProjectViewImpl.java:1586-1620`）：
 *   · `changed`       = 真的换了（上游 `ActionCallback.DONE`，`:1608`/`:1615`）；
 *   · `rejected`      = 与当前 (id, subId) 相同 ⇒ 不动（上游 `ActionCallback.REJECTED`，`:1602-1604`、`:1619`）；
 *   · `unknown-pane`  = `getProjectViewPaneById` 找不到（上游 `LOG.assertTrue` 失败，`:1587-1588`）；
 *   · `unknown-subview` = 无子视图却给了 subId（上游 `LOG.error`，`:1598-1600`）。
 */
export type PaneSwitchOutcome = 'changed' | 'rejected' | 'unknown-pane' | 'unknown-subview'

/** 当前窗格状态（上游 `currentViewId` / `currentViewSubId`，`ProjectViewImpl.java:579-580`）。 */
export interface ProjectViewPaneState {
  readonly viewId: string | null
  readonly subId: string | null
}

/** 一次切换请求（`changeView(viewId, subId)`，`:1581`）。 */
export interface PaneSwitchRequest {
  readonly viewId: string
  readonly subId?: string | null
}

/**
 * subId 的解析（`changeViewCB` 的 `:1590-1600`）：有子视图且请求未给 subId ⇒ **沿用当前 subId**
 * （"we try not to change subview" `:1593`）；无子视图时结果恒为 null。
 * 返回值里 `invalid: true` 表示「无子视图却给了 subId」（上游 `LOG.error` 那一支）。
 */
export function resolvePaneSubId(
  pane: ProjectViewPaneDescriptor,
  request: PaneSwitchRequest,
  currentSubId: string | null,
): { subId: string | null; invalid: boolean } {
  if (!pane.hasSubIds) return { subId: null, invalid: request.subId != null }
  if (request.subId == null) return { subId: currentSubId, invalid: false }
  return { subId: request.subId, invalid: false }
}

/**
 * 一次 `changeView` 的结果（纯函数；调用方把结果写回自己的状态）。
 * 语义逐条对 `changeViewCB`：未知 pane 不动（`:1587-1588`）；无子视图给 subId 不动（`:1598-1600`）；
 * 与当前 (id, subId) 相同不动（`:1602-1604`）；否则换（`:1613-1617`）。
 */
export function changeView(
  current: ProjectViewPaneState,
  request: PaneSwitchRequest,
  panes: readonly ProjectViewPaneDescriptor[] = BUILTIN_PROJECT_VIEW_PANES,
): { outcome: PaneSwitchOutcome; state: ProjectViewPaneState } {
  const pane = indexPanesById(panes).get(request.viewId)
  if (!pane) return { outcome: 'unknown-pane', state: current }
  const { subId, invalid } = resolvePaneSubId(pane, request, current.subId)
  if (invalid) return { outcome: 'unknown-subview', state: current }
  if (request.viewId === current.viewId && subId === current.subId) return { outcome: 'rejected', state: current }
  return { outcome: 'changed', state: { viewId: request.viewId, subId } }
}

/**
 * 现代窗格 id 的形状（`LegacyBackendProjectViewPaneModel.kt:170`、`ScopePaneModel.kt:163`）：
 * 有 subId ⇒ `<paneId>:<subId>`，否则就是 paneId。
 */
export function composePaneId(paneId: string, subId?: string | null): string {
  return subId == null ? paneId : `${paneId}:${subId}`
}

// ── ④ 持久化键（legacy `navigator` + 现代 `selectedPaneId`） ────────────────────────────────

/** legacy 的 XML 元素/属性名（`ProjectViewImpl.java:596-602`）。 */
export const PROJECT_VIEW_STATE_KEYS = {
  /** `ELEMENT_NAVIGATOR`（`:596`）。 */
  navigator: 'navigator',
  /** `ELEMENT_PANES`（`:597`）。 */
  panes: 'panes',
  /** `ELEMENT_PANE`（`:598`）。 */
  pane: 'pane',
  /** `ATTRIBUTE_CURRENT_VIEW`（`:599`）。 */
  currentView: 'currentView',
  /** `ATTRIBUTE_CURRENT_SUBVIEW`（`:600`）。 */
  currentSubView: 'currentSubView',
  /** `ATTRIBUTE_ID`（`:602`）。 */
  id: 'id',
  /** 现代：`selectedPaneId`（`ProjectViewToolWindowServiceImpl.kt:718`）。 */
  selectedPaneId: 'selectedPaneId',
  /** `@State(name = "ProjectView")`（`ProjectViewImpl.java:156`）。 */
  stateName: 'ProjectView',
} as const

/**
 * 把当前窗格编成上游 getState 的形状（`ProjectViewImpl.java:1721-1732`）：
 * `currentView` = pane id，`currentSubView` 只在 subId 非空时出现（`:1729-1731`）。
 * 返回 null 表示没有当前窗格（上游 `:1726` 的 `if (currentPane != null)`）。
 */
export function encodeSelectedPane(state: ProjectViewPaneState): Record<string, string> | null {
  if (state.viewId == null) return null
  const attributes: Record<string, string> = { [PROJECT_VIEW_STATE_KEYS.currentView]: state.viewId }
  if (state.subId != null) attributes[PROJECT_VIEW_STATE_KEYS.currentSubView] = state.subId
  return attributes
}

/**
 * 反解（`loadState`，`ProjectViewImpl.java:1656-1666`）：没有 `currentView` ⇒ 两个都是 null（`:1660-1663`）。
 */
export function decodeSelectedPane(attributes: Record<string, string | undefined>): ProjectViewPaneState {
  const viewId = attributes[PROJECT_VIEW_STATE_KEYS.currentView] ?? null
  if (viewId == null) return { viewId: null, subId: null }
  return { viewId, subId: attributes[PROJECT_VIEW_STATE_KEYS.currentSubView] ?? null }
}

// ── ⑤ VFS 协议注册面（`com.intellij.virtualFileSystem`） ─────────────────────────────────────

/** `VirtualFileSystem.EP_NAME` 的 qualifiedName（`VirtualFileSystem.java:28` / `CoreImpl.analyzer.xml:14`）。 */
export const VIRTUAL_FILE_SYSTEM_EP = 'com.intellij.virtualFileSystem'
/** `URLUtil.SCHEME_SEPARATOR`（`URLUtil.java:33`）。 */
export const URL_SCHEME_SEPARATOR = '://'
/** `URLUtil.JAR_SEPARATOR`（`URLUtil.java:39`）。 */
export const JAR_SEPARATOR = '!/'
/** `URLUtil.FILE_PROTOCOL`（`URLUtil.java:34`）。 */
export const FILE_PROTOCOL = 'file'
/** `URLUtil.JAR_PROTOCOL`（`URLUtil.java:37`）。 */
export const JAR_PROTOCOL = 'jar'

/** 一条协议注册（EP 属性 + `getProtocol()` 的实现约束）。 */
export interface FileSystemProtocol {
  /** EP 的 `key` 属性 = `VirtualFileSystem.getProtocol()`（`VirtualFileSystem.java:33`、`:40`）。 */
  readonly protocol: string
  /** bean 的 `physical` 属性（`VirtualFileManagerImpl.java:64`）；只有它为真的参与全量 refresh（`:93-106`）。 */
  readonly physical: boolean
  /** EP 的 `implementationClass`（`CoreImpl.analyzer.xml:15`）。 */
  readonly implementationClass: string
  /** 这条注册在哪个 xml（可复现出处）。 */
  readonly declaredAt: string
}

/**
 * 平台内置的协议注册（逐条 `platform/**` 与 `java/**` 的 `<virtualFileSystem>` 声明，含 `physical`）。
 * **不按平台过滤**：上游这些 EP 在哪个 plugin.xml 就决定它装不装，这里如实列全，由消费方按需筛。
 */
export const BUILTIN_FILE_SYSTEMS: readonly FileSystemProtocol[] = [
  { protocol: FILE_PROTOCOL, physical: true, implementationClass: 'com.intellij.openapi.vfs.impl.local.AsyncableLocalFileSystemImpl', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:685' },
  { protocol: JAR_PROTOCOL, physical: true, implementationClass: 'com.intellij.openapi.vfs.impl.jar.JarFileSystemImpl', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:686' },
  { protocol: 'temp', physical: true, implementationClass: 'com.intellij.openapi.vfs.ex.temp.TempFileSystem', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:687' },
  { protocol: 'http', physical: false, implementationClass: 'com.intellij.openapi.vfs.impl.http.HttpFileSystemImpl', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1208' },
  { protocol: 'https', physical: false, implementationClass: 'com.intellij.openapi.vfs.impl.http.HttpsFileSystem', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1209' },
  { protocol: 'tool-window-editor-tab', physical: false, implementationClass: 'com.intellij.openapi.wm.impl.tabInEditor.ToolWindowEditorTabFileSystem', declaredAt: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml:1242' },
  { protocol: 'dummy', physical: false, implementationClass: 'com.intellij.openapi.vfs.ex.dummy.DummyFileSystem', declaredAt: 'platform/analysis-impl/resources/intellij.platform.analysis.impl.xml:113' },
  { protocol: 'jrt', physical: true, implementationClass: 'com.intellij.openapi.vfs.impl.jrt.JrtFileSystemImpl', declaredAt: 'java/java-backend/resources/META-INF/JavaPlugin.xml:81' },
  { protocol: 'vcs', physical: false, implementationClass: 'com.intellij.openapi.vcs.vfs.VcsFileSystem', declaredAt: 'platform/vcs-impl/resources/META-INF/VcsExtensions.xml:256' },
  { protocol: 'vcs-log', physical: false, implementationClass: 'com.intellij.vcs.log.ui.editor.VcsLogVirtualFileSystem', declaredAt: 'platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:152' },
  { protocol: 'lazyAttachVfs', physical: false, implementationClass: 'com.intellij.xdebugger.attach.fs.LazyAttachVirtualFS', declaredAt: 'platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml:41' },
]

/**
 * `VirtualFileManager.getFileSystem(protocol)`（`VirtualFileManager.java:65` → `VirtualFileManagerImpl.java:118-134`）。
 * 同协议多支上游 `LOG.error` 只取第一支（`:126-129`）；这里同样只返回第一支。
 */
export function fileSystemForProtocol(
  protocol: string,
  fileSystems: readonly FileSystemProtocol[] = BUILTIN_FILE_SYSTEMS,
): FileSystemProtocol | null {
  return fileSystems.find(entry => entry.protocol === protocol) ?? null
}

/** 这个协议是不是物理文件系统（bean 的 `physical`，`VirtualFileManagerImpl.java:64`）。 */
export function isPhysicalProtocol(
  protocol: string,
  fileSystems: readonly FileSystemProtocol[] = BUILTIN_FILE_SYSTEMS,
): boolean {
  return fileSystemForProtocol(protocol, fileSystems)?.physical === true
}

/** `VirtualFileManager.extractProtocol(url)`（`:238-242`）：没有 "://" 给 null。 */
export function extractProtocol(url: string): string | null {
  const index = url.indexOf(URL_SCHEME_SEPARATOR)
  return index < 0 ? null : url.slice(0, index)
}

/** `VirtualFileManager.extractPath(url)` / `URLUtil.extractPath`（`:247-249` / `URLUtil.java:340-342`）。 */
export function extractPath(url: string): string {
  const index = url.indexOf(URL_SCHEME_SEPARATOR)
  return index < 0 ? url : url.slice(index + URL_SCHEME_SEPARATOR.length)
}

/** `VirtualFileManager.constructUrl(protocol, path)`（`:227-229`）。 */
export function constructUrl(protocol: string, path: string): string {
  return `${protocol}${URL_SCHEME_SEPARATOR}${path}`
}

/**
 * `VirtualFileManager.findFileByUrl(url)` → `findByUrl`（`VirtualFileManagerImpl.java:398-413`）的**解析那一半**：
 * 按 "://" 切协议、查协议注册、把剩下那段当 `findFileByPath` 的 path。
 * 没有 "://"（裸路径）⇒ 上游直接给 null（`:408-410`），**不**当本地文件 —— 本仓要判「裸路径属于哪个协议」用
 * `classifyPath`（见下）。
 */
export function resolveFileByUrl(
  url: string,
  fileSystems: readonly FileSystemProtocol[] = BUILTIN_FILE_SYSTEMS,
): { protocol: string; path: string; fileSystem: FileSystemProtocol } | null {
  const protocol = extractProtocol(url)
  if (protocol == null) return null
  const fileSystem = fileSystemForProtocol(protocol, fileSystems)
  if (!fileSystem) return null
  return { protocol, path: extractPath(url), fileSystem }
}

/** 一条路径的协议判定结果（本仓词；把上游「URL 必须带协议」补上「裸路径 = 本地」这一档）。 */
export interface PathProtocolInfo {
  /** `file` / `jar` / 其它已注册协议；判不出（合成路径）给 null。 */
  readonly protocol: string | null
  readonly physical: boolean
  /** 是不是归档内路径（含 `!/`，`ArchiveFileSystem.java:39`）。 */
  readonly inArchive: boolean
  /** 归档内路径的宿主档案路径（`ArchiveFileSystem.getLocalByEntry`，`:68` 的字符串形态）。 */
  readonly archive: string | null
  /** 档案内条目路径（`jar://…!/<条目>` 里 `!/` 之后那段）。 */
  readonly entry: string | null
}

/**
 * 「一个路径属于哪个协议」—— 上游没有这个函数（上游只认显式带协议的 URL，`VirtualFileManagerImpl.java:408-410`），
 * 这里是**本仓需要的推断**，规则都指得到上游：
 *   · 带 "://" ⇒ 走 `extractProtocol`（`:238-242`）；
 *   · `jar://…!/…` 或 `…!/…` ⇒ `jar`（`URLUtil.JAR_SEPARATOR` `:39`，`ArchiveFileSystem.java:39` 的
 *     `file:///path/to/jar.jar => jar:///path/to/jar.jar!/`）；
 *   · 其余非空、非合成（不以 `\u0000` 开头）的路径 ⇒ `file`（本地协议名 `LocalFileSystem.PROTOCOL`
 *     = `StandardFileSystems.FILE_PROTOCOL`，`LocalFileSystem.java:29`）—— **本仓推断，非上游函数**；
 *   · 空串 / 以 `\u0000` 开头的合成路径（本仓 `src/projectTreeModel.ts:217` 的伪库条目）⇒ protocol null。
 */
export function classifyPath(
  path: string,
  fileSystems: readonly FileSystemProtocol[] = BUILTIN_FILE_SYSTEMS,
): PathProtocolInfo {
  const explicit = extractProtocol(path)
  if (explicit != null) {
    const inArchive = explicit === JAR_PROTOCOL || path.includes(JAR_SEPARATOR)
    return {
      protocol: explicit,
      physical: isPhysicalProtocol(explicit, fileSystems),
      inArchive,
      archive: inArchive ? extractPath(path).split(JAR_SEPARATOR)[0] ?? null : null,
      entry: inArchive ? extractPath(path).split(JAR_SEPARATOR).slice(1).join(JAR_SEPARATOR) : null,
    }
  }
  if (path.length === 0 || path.startsWith('\u0000')) {
    return { protocol: null, physical: false, inArchive: false, archive: null, entry: null }
  }
  const slash = path.indexOf(JAR_SEPARATOR)
  if (slash >= 0) {
    return {
      protocol: JAR_PROTOCOL,
      physical: isPhysicalProtocol(JAR_PROTOCOL, fileSystems),
      inArchive: true,
      archive: path.slice(0, slash),
      entry: path.slice(slash + JAR_SEPARATOR.length),
    }
  }
  return {
    protocol: FILE_PROTOCOL,
    physical: isPhysicalProtocol(FILE_PROTOCOL, fileSystems),
    inArchive: false,
    archive: null,
    entry: null,
  }
}

/**
 * 诊断：协议注册表的稳定快照（排查「某协议的窗格/文件为何找不到」用）。按注册序，不改动入参。
 */
export function fileSystemCatalog(
  fileSystems: readonly FileSystemProtocol[] = BUILTIN_FILE_SYSTEMS,
): { protocol: string; physical: boolean; declaredAt: string }[] {
  return fileSystems.map(entry => ({ protocol: entry.protocol, physical: entry.physical, declaredAt: entry.declaredAt }))
}