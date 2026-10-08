// **projectviews 域的扩展点宿主接线** —— 把「TODO 索引器 / 结构视图 / 项目视图窗格 /
// 通知组 / 撤销提供者」这几族上游本来就是 EP 的接口，按 `src/extensionPoints.ts` 的 `EXTENSIONS`
// 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.todoIndexer` —— `platform/core-api/resources/intellij.platform.core.xml:69`
//     （`beanClass="com.intellij.openapi.fileTypes.FileTypeExtensionPoint"` dynamic="true"）；
//     接口 `TodoIndexer` 的方法面 `map(FileContent)`（`com.intellij.psi.impl.cache.impl.todo`）。
//   · `com.intellij.structureViewBuilder` —— `platform/editor-ui-api/resources/intellij.platform.editor.ui.xml:44`
//     （`beanClass="com.intellij.openapi.extensions.KeyedFactoryEPBean"` dynamic="true"）；
//     `StructureViewBuilder.kt:27-47` 的方法面 `createStructureView(fileEditor, project)` 与
//     `createStructureViewSuspend(...)`。
//   · `com.intellij.projectViewPane` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:314`
//     （`interface="com.intellij.ide.projectView.impl.AbstractProjectViewPane"` area="IDEA_PROJECT"
//     dynamic="true"）；`AbstractProjectViewPane` 的方法面 `getTitle()` / `isInitiallyVisible()` /
//     `getGroup()` / `getWeight()` / `getId()` / `isAvailable(project)`。
//   · `com.intellij.notificationGroup` —— `platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:27`
//     （`beanClass="com.intellij.notification.impl.NotificationGroupEP"` dynamic="true"）；
//     `NotificationGroup.kt:24-30` 的字段面 `displayId` / `displayType` / `isLogByDefault` /
//     `toolWindowId` / `title`。
//   · `com.intellij.undoProvider` —— `platform/platform-impl/resources/intellij.platform.ide.impl.xml:197`
//     （`interface="com.intellij.openapi.command.impl.UndoProvider"` dynamic="true"）；`UndoProvider.java`
//     的方法面 `undo(project)` / `redo(project)` / `isUndoAvailable(project)` / `isRedoAvailable(project)` /
//     `getUndoActionName(project)` / `getRedoActionName(project)`。
//
// 本仓此前：这几族各有私有实现（`src/todoView.ts` 的模式匹配、`src/outlineView.ts` 的符号折层、
// `src/projectTreeModel.ts` 的单窗格树、`src/notificationGroups.ts` 的内建组表、
// `src/pvCommandProcessor.ts` / `src/pvFileUndoProvider.ts` 的文件命令栈），但**没有一条能被
// 第三方按 id 挂进去**。本文件补上那一层：声明 EP + 与上游同名的方法面 + consume 函数；
// 内建的几支在各自消费侧作为 bundled 贡献登记（见各 `registerBundled*` 的调用点）。
//
// 与上游的如实差异：本仓没有 PSI/`VirtualFile`，`TodoIndexer.map(FileContent)` 的输入是
// `{ path, text }`；`StructureViewBuilder.createStructureView` 的输入是 LSP `documentSymbol`
// 折出来的节点；`ProjectViewPane` 的 `isAvailable(Project)` 收成 `isAvailable(root)`（工作区根字符串）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// **第二批（2026-10-07 epclose2）**：又登记了七条上游本来就是 EP 的接口 —— `treeStructureProvider` /
// `projectViewNodeDecorator` / `fileIconProvider` / `usageGroupingRuleProvider` /
// `lang.structureViewExtension` / `lang.psiStructureViewFactory` / `editorNotificationProvider`，
// 外加 `todoExtraPlaces`（共 13 条声明，见本文件后半「第二批」那一节的出处与同名方法面）。
//
// 判据：`tests/ide-view-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionEntry, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 五条 EP 的 id（逐字取自上游 qualifiedName，见文件头）。 */
export const TODO_INDEXER_EP = 'com.intellij.todoIndexer'
export const STRUCTURE_VIEW_BUILDER_EP = 'com.intellij.structureViewBuilder'
export const PROJECT_VIEW_PANE_EP = 'com.intellij.projectViewPane'
export const NOTIFICATION_GROUP_EP = 'com.intellij.notificationGroup'
export const UNDO_PROVIDER_EP = 'com.intellij.undoProvider'

// ── 第二批：pv/ 与 dm/ 余下的上游 EP（2026-10-07 epclose2） ─────────────────────────────────
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.treeStructureProvider` —— `platform/editor-ui-api/resources/intellij.platform.editor.ui.xml:47`
//     （`interface="com.intellij.ide.projectView.TreeStructureProvider"` area="IDEA_PROJECT" dynamic="true"）；
//     方法面 `modify(parent, children, settings)` / `getData(selected, dataId)` / `uiDataSnapshot(...)`
//     （`TreeStructureProvider.java:42-69`）。
//   · `com.intellij.projectViewNodeDecorator` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:316`
//     （`interface="com.intellij.ide.projectView.ProjectViewNodeDecorator"` area="IDEA_PROJECT" dynamic="true"）；
//     方法面 `decorate(node, data)`（`ProjectViewNodeDecorator.kt:20-22`）。
//   · `com.intellij.fileIconProvider` —— `platform/core-api/resources/META-INF/Core.analyzer.xml:31`
//     （`interface="com.intellij.ide.FileIconProvider"` dynamic="true"）；方法面
//     `getIcon(file, flags, project)`（`FileIconProvider.java:21`）。
//   · `com.intellij.usageGroupingRuleProvider` —— `platform/usageView/resources/intellij.platform.usageView.xml:33`
//     （`interface="com.intellij.usages.rules.UsageGroupingRuleProvider"` dynamic="true"）；方法面
//     `getActiveRules(project)`（`UsageGroupingRuleProvider.java:22`）。**如实差异**：协调单里写的
//     `com.intellij.moduleGroupingRuleProvider` 在上游**不是 EP**（零命中）；`ModuleGroupingRule`
//     是 usageView-impl 的一条**内建规则**（`.../rules/ModuleGroupingRule.java:32`），装它的 EP 就是这条
//     `usageGroupingRuleProvider`（`.../rules/ActiveRules.java:42` 在 `isGroupByModule()` 时装它），故按真名落。
//   · `com.intellij.lang.structureViewExtension` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:234`
//     （`interface="com.intellij.ide.structureView.StructureViewExtension"` dynamic="true"）；方法面
//     `getType()` / `getChildren(parent)` / `getCurrentEditorElement(editor, parent)` / `filterChildren(...)`
//     （`StructureViewExtension.java:13-24`）。**如实差异**：协调单里的 `com.intellij.structureViewExtension`
//     少一层 `lang.` —— 上游 qualifiedName 是 `com.intellij.lang.structureViewExtension`（lombok 以
//     `<lang.structureViewExtension>` 相对名挂它），按真名落。
//   · `com.intellij.lang.psiStructureViewFactory` —— `platform/editor-ui-api/resources/intellij.platform.editor.ui.xml:40`
//     （`beanClass="…LanguageExtensionPoint"`，`with attribute="implementationClass" implements="…PsiStructureViewFactory"`）；
//     方法面 `getStructureViewBuilder(psiFile)`（`PsiStructureViewFactory.java:20`）。
//   · `com.intellij.editorNotificationProvider` —— `platform/platform-api/resources/intellij.platform.ide.xml:99`
//     （`interface="com.intellij.ui.EditorNotificationProvider"` area="IDEA_PROJECT" dynamic="true"）；方法面
//     `collectNotificationData(project, file)`（`EditorNotificationProvider.java:34-35`）。

/** 树结构提供者（`TreeStructureProvider`，上游 `editor.ui.xml:47`）。 */
export const TREE_STRUCTURE_PROVIDER_EP = 'com.intellij.treeStructureProvider'
/** 项目视图节点装饰（`ProjectViewNodeDecorator`，上游 `lang.impl.xml:316`）。 */
export const PROJECT_VIEW_NODE_DECORATOR_EP = 'com.intellij.projectViewNodeDecorator'
/** 文件图标提供者（`FileIconProvider`，上游 `Core.analyzer.xml:31`）。 */
export const FILE_ICON_PROVIDER_EP = 'com.intellij.fileIconProvider'
/** 用法分组规则提供者（真名；上游 `usageView.xml:33`，见上面的订正）。 */
export const USAGE_GROUPING_RULE_PROVIDER_EP = 'com.intellij.usageGroupingRuleProvider'
/** 结构视图扩展（真名带 `lang.`；上游 `lang.impl.xml:234`）。 */
export const STRUCTURE_VIEW_EXTENSION_EP = 'com.intellij.lang.structureViewExtension'
/** PSI 结构视图工厂（`PsiStructureViewFactory`，上游 `editor.ui.xml:40`）。 */
export const PSI_STRUCTURE_VIEW_FACTORY_EP = 'com.intellij.lang.psiStructureViewFactory'
/** 编辑器顶部通知提供者（`EditorNotificationProvider`，上游 `ide.xml:99`）。 */
export const EDITOR_NOTIFICATION_PROVIDER_EP = 'com.intellij.editorNotificationProvider'
/**
 * TODO 的「额外位置」检查器（`TodoIndexers$ExtraPlaceChecker`，上游 `analysis.impl.xml:52`
 * `interface="com.intellij.psi.impl.cache.impl.todo.TodoIndexers$ExtraPlaceChecker"` dynamic="true"）。
 * **如实差异**：协调单里写的 `com.intellij.todoCustomPatternProvider` 在上游**不是 EP**（零命中）——
 * TODO 的自定义模式（`TodoPattern`）是**设置项**（`TodoConfigurable` 的 PatternTable），本仓等价物是
 * `src/todoPatterns.ts` + `src/settingsModel.ts` 的 `TodoPattern`；决定「哪些额外位置也要建 TODO 索引」
 * 的 EP 是这条 `todoExtraPlaces`（`TodoIndexers.java:23` 的 `EP_NAME`、`:51-53` 的消费点，方法面
 * `accept(project, file)`），故按真名落。
 */
export const TODO_EXTRA_PLACES_EP = 'com.intellij.todoExtraPlaces'

/** 一条 TODO 条目（`TodoIndexEntry` 的可移植形状：模式 + 文本 + 行）。 */
export interface TodoIndexEntry {
  /** 命中的模式（上游 `TodoIndexEntry.getPattern()`）。 */
  pattern: string
  /** 条目文本（上游 `TodoIndexEntry.getText()`，模式之后到行尾的那一段）。 */
  text: string
  /** 0 基行号（本仓给的行坐标；上游索引不含位置，位置由 `IndexPatternSearcher` 事后定位）。 */
  line: number
}

/**
 * 一条 TODO 索引器（`TodoIndexer` 的可移植子集）。
 * `map` ↔ 上游 `map(FileContent inputData): Map<TodoIndexEntry, Integer>`：把一份文件的内容
 * 折成 TODO 条目；本仓返回条目数组（去重/计数由消费方按模式身份做）。
 */
export interface TodoIndexerContribution {
  id: string
  /** 上游 `FileTypeExtensionPoint` 的 `fileType` 限定（本仓按文件扩展名，空 = 任意文件类型）。 */
  fileType?: string
  /** 上游 `TodoIndexer.map(FileContent)`。 */
  map: (content: { path: string; text: string }) => readonly TodoIndexEntry[]
}

/** 结构视图的一行（`StructureView` 节点的可移植形状；与 `src/outlineView.ts` 的 `OutlineEntry` 兼容）。 */
export interface StructureViewRow {
  name: string
  kind: number
  depth: number
  /** 起止位置（0 基行列），弹层跳转用。 */
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/**
 * 一条结构视图构建器（`StructureViewBuilder` 的可移植子集）。
 * `createStructureView` ↔ 上游 `createStructureView(fileEditor, project)`；
 * `createStructureViewSuspend` 是上游的挂起版（`:47`），本仓同步给定（缺省复用 `createStructureView`，同上游缺省实现）。
 */
export interface StructureViewBuilderContribution {
  id: string
  createStructureView: (input: { path: string; symbols: readonly StructureViewSymbol[] }) => readonly StructureViewRow[]
  createStructureViewSuspend?: (input: { path: string; symbols: readonly StructureViewSymbol[] }) => readonly StructureViewRow[]
}

/** 传给结构视图构建器的符号（LSP `documentSymbol` 的最小面）。 */
export interface StructureViewSymbol {
  name: string
  kind: number
  detail?: string
  startLine: number
  startChar: number
  endLine: number
  endChar: number
  children?: readonly StructureViewSymbol[]
}

/**
 * 一条项目视图窗格（`AbstractProjectViewPane` 的方法面，名字与上游逐字相同）。
 * 本仓单窗格，但这些方法就是第三方多窗格/定制窗格贡献要实现的接口。
 */
export interface ProjectViewPaneContribution {
  id: string
  /** `AbstractProjectViewPane.getTitle()`（窗格标签）。 */
  getTitle: () => string
  /** `isInitiallyVisible()`（默认显示哪一个窗格）。 */
  isInitiallyVisible: () => boolean
  /** `getGroup()`（窗格分组标题，同组排一起）。 */
  getGroup: () => string
  /** `getWeight()`（排序权重，大的在前）。 */
  getWeight: () => number
  /** `isAvailable(project)`（本仓给工作区根字符串；没有工作区时跳过）。 */
  isAvailable: (root: string) => boolean
}

/**
 * 一条通知组注册项（`NotificationGroupEP` 的字段面；`NotificationGroup.kt:24-30`）。
 * 用 getter 命名对上上游的属性：`getDisplayId` / `getDisplayType` / `isLogByDefault` /
 * `getToolWindowId` / `getTitle`。
 */
export interface NotificationGroupContribution {
  id: string
  getDisplayId: () => string
  getDisplayType: () => 'BALLOON' | 'STICKY_BALLOON' | 'TOOL_WINDOW' | 'NONE'
  isLogByDefault: () => boolean
  getToolWindowId?: () => string | undefined
  getTitle: () => string
}

/**
 * 一条撤销提供者（`UndoProvider` 的方法面，名字与上游逐字相同）。
 *
 * **订正（2026-10-07 epmount2）**：上游 `UndoProvider`（`platform/platform-impl/src/com/intellij/
 * openapi/command/impl/UndoProvider.java:21-27`）的方法面只有 **`commandStarted(project)`** 与
 * **`commandFinished(project)`** 两个通知（`UndoManagerImpl.java:280-290` 在命令起止时逐个回调；
 * 本仓此前那六个 `undo/redo/isUndoAvailable/…` 名字不是这条 EP 的方法面 —— 那是 `UndoManager`
 * 的，已保留为兼容面但**不是上游口径**，新贡献应按下面两个 hook 实现）。
 * 本仓的 `root` 是工作区根（没有 `Project`）。
 */
export interface UndoProviderContribution {
  id: string
  /** 上游 `UndoProvider.commandStarted(Project)`：一条命令开始（本仓：一次撤销/重做/文件操作前）。 */
  commandStarted?: (root: string) => void
  /** 上游 `UndoProvider.commandFinished(Project)`：命令结束（本仓：那一步之后，无论成败）。 */
  commandFinished?: (root: string) => void
  /** 非上游口径的兼容面（旧本仓口径，第三方新贡献不要依赖）。 */
  undo?: (root: string) => Promise<boolean>
  redo?: (root: string) => Promise<boolean>
  isUndoAvailable?: (root: string) => boolean
  isRedoAvailable?: (root: string) => boolean
  getUndoActionName?: (root: string) => string | null
  getRedoActionName?: (root: string) => string | null
}

/**
 * `UndoProvider.EP_NAME.getExtensionList()` 的等价物（不过滤可撤性）—— 上游
 * `getUndoProviders()` 拿到的是**全部** provider，逐个调 `commandStarted`/`commandFinished`。
 */
export function allUndoProviders(scope: string = APPLICATION_SCOPE): UndoProviderContribution[] {
  return EXTENSIONS.extensionsOf<UndoProviderContribution>(UNDO_PROVIDER_EP, scope)
}

/**
 * 一条命令起止时通知全部撤销提供者（`UndoManagerImpl.onCommandStarted/onCommandFinished`
 * `:278-290` 的等价物）。一个坏 provider 抛错只跳过它自己。
 */
export function notifyUndoProviders(root: string, phase: 'started' | 'finished', scope: string = APPLICATION_SCOPE): void {
  for (const provider of allUndoProviders(scope)) {
    try {
      if (phase === 'started') provider.commandStarted?.(root)
      else provider.commandFinished?.(root)
    } catch {
      // 坏 provider 不吃掉别人的通知。
    }
  }
}

/** 十二条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareIdeViewExtensionPoints(): void {
  for (const [id, name] of [
    [TODO_INDEXER_EP, 'TODO 索引器'],
    [STRUCTURE_VIEW_BUILDER_EP, '结构视图构建器'],
    [PROJECT_VIEW_PANE_EP, '项目视图窗格'],
    [NOTIFICATION_GROUP_EP, '通知组'],
    [UNDO_PROVIDER_EP, '撤销提供者'],
    [TREE_STRUCTURE_PROVIDER_EP, '树结构提供者'],
    [PROJECT_VIEW_NODE_DECORATOR_EP, '项目视图节点装饰'],
    [FILE_ICON_PROVIDER_EP, '文件图标提供者'],
    [USAGE_GROUPING_RULE_PROVIDER_EP, '用法分组规则提供者'],
    [STRUCTURE_VIEW_EXTENSION_EP, '结构视图扩展'],
    [PSI_STRUCTURE_VIEW_FACTORY_EP, 'PSI 结构视图工厂'],
    [EDITOR_NOTIFICATION_PROVIDER_EP, '编辑器通知提供者'],
    [TODO_EXTRA_PLACES_EP, 'TODO 额外位置检查器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareIdeViewExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖）。 */
export function registerIdeViewExtension<T>(
  extensionPoint: string,
  id: string,
  value: T,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterIdeViewExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── 消费面 ──────────────────────────────────────────────────────────────────────────────

/** `TodoIndexers` 按文件类型取索引器（本仓按扩展名；空 `fileType` 的贡献对任何文件都适用）。 */
export function todoIndexersFor(path: string, scope: string = APPLICATION_SCOPE): TodoIndexerContribution[] {
  return todoIndexerEntriesFor(path, scope).map(entry => entry.value)
}

/**
 * 同上的**完整条目版**（带 `source`）—— 消费方要区分「随包发货的内建索引器」与「第三方按 id 挂的」
 * 时用它（`src/todoIndexerEntries.ts` 的 `providerTodoIndexerPaths` 就是只认 `source: 'user'` 那几支，
 * 于是没有第三方索引器时不会去为每个文件多读一遍）。过滤口径与 `todoIndexersFor` 逐字一致。
 */
export function todoIndexerEntriesFor(
  path: string, scope: string = APPLICATION_SCOPE,
): ExtensionEntry<TodoIndexerContribution>[] {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXTENSIONS.entriesFor<TodoIndexerContribution>(TODO_INDEXER_EP, scope)
    .filter(entry => !entry.value.fileType || entry.value.fileType.toLowerCase() === ext)
}

/** 全部 TODO 索引器合起来扫一份文件（上游把每类文件的 `TodoIndexer` 结果并起来）。 */
export function indexTodoEntries(path: string, text: string, scope: string = APPLICATION_SCOPE): TodoIndexEntry[] {
  const out: TodoIndexEntry[] = []
  for (const indexer of todoIndexersFor(path, scope)) {
    try {
      out.push(...indexer.map({ path, text }))
    } catch {
      // 一个索引器坏了不该吃掉别人的条目。
    }
  }
  return out
}

/** `StructureViewBuilder.EP_NAME` 按语言/文件类型取构建器（本仓取第一支，与 `getProvider().getBuilder` 同义）。 */
export function structureViewBuilders(scope: string = APPLICATION_SCOPE): StructureViewBuilderContribution[] {
  return EXTENSIONS.extensionsOf<StructureViewBuilderContribution>(STRUCTURE_VIEW_BUILDER_EP, scope)
}

/** 折一份文件的结构视图（没有贡献者时返回空，调用方回落到 `src/outlineView.ts` 的默认折层）。 */
export function structureViewRows(
  input: { path: string; symbols: readonly StructureViewSymbol[] },
  scope: string = APPLICATION_SCOPE,
): StructureViewRow[] {
  // 先问 `com.intellij.lang.psiStructureViewFactory`（上游按语言取 `PsiStructureViewFactory`
  // 拿到构建器），再回落到 `com.intellij.structureViewBuilder`（KeyedFactory 那一档）。两条 EP
  // 都能给构建器 —— 上游 `LanguageStructureViewBuilder` 也是先按语言找 factory、再退到 builder EP。
  const builder = structureViewBuilderFor(input.path, undefined, scope) ?? structureViewBuilders(scope)[0]
  if (!builder) return []
  const run = builder.createStructureViewSuspend ?? builder.createStructureView
  return [...run(input)]
}

/** `ProjectViewPane.EP_NAME` 的全部窗格（按 `getWeight()` 从大到小排，权重相同按注册序）。 */
export function projectViewPanes(scope: string = APPLICATION_SCOPE): ProjectViewPaneContribution[] {
  return EXTENSIONS.extensionsOf<ProjectViewPaneContribution>(PROJECT_VIEW_PANE_EP, scope)
    .slice()
    .sort((left, right) => right.getWeight() - left.getWeight())
}

/** 当前工作区可用的窗格（`isAvailable(root)` 为真的那些）。 */
export function availableProjectViewPanes(root: string, scope: string = APPLICATION_SCOPE): ProjectViewPaneContribution[] {
  return projectViewPanes(scope).filter(pane => {
    try { return pane.isAvailable(root) } catch { return false }
  })
}

/** `NotificationGroupManager.getRegisteredNotificationGroups()` 的等价物。 */
export function notificationGroupContributions(scope: string = APPLICATION_SCOPE): NotificationGroupContribution[] {
  return EXTENSIONS.extensionsOf<NotificationGroupContribution>(NOTIFICATION_GROUP_EP, scope)
}

/** 按 displayId 取通知组（`NotificationGroupManager.getNotificationGroup(id)` 的等价物）。 */
export function notificationGroupContribution(
  displayId: string,
  scope: string = APPLICATION_SCOPE,
): NotificationGroupContribution | undefined {
  return notificationGroupContributions(scope).find(group => group.getDisplayId() === displayId)
}

/** `UndoProvider.EP_NAME` 的全部撤销提供者（本仓按工作区根过滤可撤性；没有兼容面方法的按可撤算）。 */
export function undoProvidersFor(root: string, scope: string = APPLICATION_SCOPE): UndoProviderContribution[] {
  return allUndoProviders(scope).filter(provider => {
    try {
      // 上游 `UndoProvider` 没有可撤性查询（只有 commandStarted/commandFinished）——本仓那两个
      // 兼容面方法是可选的：没实现的 provider 一律算"可撤"，交给下面那趟通知按 phase 过滤。
      if (!provider.isUndoAvailable && !provider.isRedoAvailable) return true
      return provider.isUndoAvailable?.(root) === true || provider.isRedoAvailable?.(root) === true
    } catch { return false }
  })
}

// ── bundled：把本仓在跑的几支作为贡献登记进来（消费侧调用，重复调用只覆盖同 id） ──────────────

/** 注册一条 TODO 索引器贡献（内建的文本扫描在 `src/todoScan.ts` / `src/todoView.ts`）。 */
export function registerTodoIndexer(
  contribution: TodoIndexerContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(TODO_INDEXER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条结构视图构建器贡献（内建的符号折层在 `src/outlineView.ts`）。 */
export function registerStructureViewBuilder(
  contribution: StructureViewBuilderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(STRUCTURE_VIEW_BUILDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条项目视图窗格贡献（内建的「项目」窗格在 `src/projectTreeModel.ts`）。 */
export function registerProjectViewPane(
  contribution: ProjectViewPaneContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(PROJECT_VIEW_PANE_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条通知组贡献（内建组表在 `src/notificationGroups.ts`）。 */
export function registerNotificationGroup(
  contribution: NotificationGroupContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(NOTIFICATION_GROUP_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条撤销提供者贡献（内建的文件命令栈在 `src/pvFileUndoProvider.ts` / `src/pvCommandProcessor.ts`）。 */
export function registerUndoProvider(
  contribution: UndoProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(UNDO_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

// ── 第二批 EP：贡献形状 / 消费面 / bundled 登记（2026-10-07 epclose2） ────────────────────────

/** ① `TreeStructureProvider.modify` 的节点形状（`AbstractTreeNode` 的可移植子集）。 */
export interface TreeStructureProviderNode {
  /** 稳定身份（上游 `AbstractTreeNode` 的 `getValue`；本仓用路径或合成 id）。 */
  id: string
  /** 显示名（上游 `getPresentableText`）。 */
  name: string
  /** 是不是目录（本仓树只有文件/目录两档 + 合成根）。 */
  isDirectory: boolean
  /** 工作区相对路径；合成节点形如 `\u0000libraries`。 */
  path: string
  /** 合成来源（本仓合成节点的标记，上游没有这个词）。 */
  synthetic?: string
}

/** `ViewSettings` 的可移植子集（上游 `ViewSettings`，`TreeStructureProvider.modify` 的第三个参数）。 */
export interface ProjectViewSettingsLike {
  flattenPackages?: boolean
  hideEmptyMiddlePackages?: boolean
  abbreviatePackageNames?: boolean
  showMembers?: boolean
  [key: string]: unknown
}

/** 一条树结构提供者（`TreeStructureProvider` 的方法面，名字与上游逐字相同）。 */
export interface TreeStructureProviderContribution {
  id: string
  /** 上游 `modify(parent, children, settings)` —— 返回这一层要显示的节点。 */
  modify: (input: {
    parent: TreeStructureProviderNode | null
    children: readonly TreeStructureProviderNode[]
    settings: ProjectViewSettingsLike
  }) => readonly TreeStructureProviderNode[]
  /** 上游 `getData(selected, dataId)`（旧口径，缺省不提供）。 */
  getData?: (selection: readonly TreeStructureProviderNode[], dataId: string) => string | null
}

/** `TreeStructureProvider.EP.getExtensions()` 的等价物（已按 LoadingOrder 排序）。 */
export function treeStructureProviders(scope: string = APPLICATION_SCOPE): TreeStructureProviderContribution[] {
  return EXTENSIONS.extensionsOf<TreeStructureProviderContribution>(TREE_STRUCTURE_PROVIDER_EP, scope)
}

/**
 * 折叠一层子节点：**按注册序**逐个 provider 过（上游 `CompoundTreeStructureProvider` 同形，一个的
 * 输出当下一个的输入）。没有 provider 时**原样返回入参** ⇒ 本仓既有行为零改动；一个 provider 抛错
 * 只跳过它自己，不把这一层清空。
 */
export function modifyProjectTreeChildren(
  parent: TreeStructureProviderNode | null,
  children: readonly TreeStructureProviderNode[],
  settings: ProjectViewSettingsLike = {},
  scope: string = APPLICATION_SCOPE,
): TreeStructureProviderNode[] {
  let current: TreeStructureProviderNode[] = [...children]
  for (const provider of treeStructureProviders(scope)) {
    try {
      current = [...provider.modify({ parent, children: current, settings })]
    } catch {
      // 坏的 provider 不改这一层：保持上一步的结果。
    }
  }
  return current
}

/** ② 项目视图节点的**呈现**（上游 `PresentationData` 的可移植子集：类名 / 提示后缀 / 文本 / 图标名）。 */
export interface ProjectViewNodeDecoration {
  /** 附加样式类后缀（本仓是 DOM；上游是颜色/字体）。 */
  className?: string
  /** tooltip 后缀。 */
  tooltipSuffix?: string
  /** 呈现文本替换（上游 `setPresentableText`）；不给 = 不改名。 */
  presentableText?: string
  /** 图标名（本仓是图标名串；上游是 `Icon`）。 */
  icon?: string
}

/** 被装饰的节点（`ProjectViewNode.getValue()` 的可移植形状）。 */
export interface ProjectViewNodeView {
  id: string
  name: string
  path: string
  isDirectory: boolean
  /** 这个文件当前的错误数（本仓从 `lspDiagnostics` 折出来；上游由节点自己带 `HighlightInfo`）。 */
  errors?: number
  /** 这个文件当前的警告数。 */
  warnings?: number
}

/** 一条节点装饰器（`ProjectViewNodeDecorator.decorate(node, data)` 的同名方法面）。 */
export interface ProjectViewNodeDecoratorContribution {
  id: string
  decorate: (input: { node: ProjectViewNodeView; data: ProjectViewNodeDecoration }) => void
}

/** `ProjectViewNodeDecorator.EP.getExtensions()` 的等价物。 */
export function projectViewNodeDecorators(scope: string = APPLICATION_SCOPE): ProjectViewNodeDecoratorContribution[] {
  return EXTENSIONS.extensionsOf<ProjectViewNodeDecoratorContribution>(PROJECT_VIEW_NODE_DECORATOR_EP, scope)
}

/**
 * 逐个装饰器就地叠在呈现上（上游 `CompoundProjectViewNodeDecorator` 同形：每个 `decorate` 改同一个
 * `PresentationData`）。没有装饰器时返回 `base` 的副本。一个坏装饰器不抹掉已叠好的呈现。
 */
export function decorateProjectViewNode(
  node: ProjectViewNodeView,
  base: ProjectViewNodeDecoration = {},
  scope: string = APPLICATION_SCOPE,
): ProjectViewNodeDecoration {
  const data: ProjectViewNodeDecoration = { ...base }
  for (const decorator of projectViewNodeDecorators(scope)) {
    try {
      decorator.decorate({ node, data })
    } catch {
      // 坏装饰器跳过：已叠好的呈现留着。
    }
  }
  return data
}

/** ③ `Iconable.IconFlags` 的三位（`platform/util/.../Iconable.java:11-15`）。 */
export const ICON_FLAG_READ_STATUS = 1
export const ICON_FLAG_VISIBILITY = 2
export const ICON_FLAG_OPEN = 8

/** 一条文件图标提供者（`FileIconProvider.getIcon(file, flags, project)` 的同名方法面）。 */
export interface FileIconProviderContribution {
  id: string
  /**
   * 上游 `getIcon(VirtualFile, int flags, Project)` —— 不认这个文件返回 null
   * （本仓没有 `Icon`，返回一个图标名串；由宿主决定怎么画）。
   */
  getIcon: (input: { path: string; isDirectory: boolean; flags: number; root: string }) => string | null
}

/** `FileIconProvider.EP_NAME.getExtensions()` 的等价物。 */
export function fileIconProviders(scope: string = APPLICATION_SCOPE): FileIconProviderContribution[] {
  return EXTENSIONS.extensionsOf<FileIconProviderContribution>(FILE_ICON_PROVIDER_EP, scope)
}

/** 第一个给出图标的 provider 赢（上游按 order/priority 取第一个非 null 的图标）。 */
export function fileIconFor(
  input: { path: string; isDirectory: boolean; flags?: number; root?: string },
  scope: string = APPLICATION_SCOPE,
): string | null {
  const shaped = { path: input.path, isDirectory: input.isDirectory, flags: input.flags ?? 0, root: input.root ?? '' }
  for (const provider of fileIconProviders(scope)) {
    try {
      const icon = provider.getIcon(shaped)
      if (icon) return icon
    } catch {
      // 坏 provider 跳过，问下一支。
    }
  }
  return null
}

/** ④ 一条用法分组规则（`UsageGroupingRule` 的可移植子集）。 */
export interface UsageGroupingRuleContribution {
  id: string
  /** 组号（上游 `UsageGroupingRulesDefaultRanks`：目录结构 400、文件结构 500；小的在前）。 */
  rank: number
  /** 一条用法落进哪个组；null = 不归本规则（交给下一档）。 */
  groupKeyOf: (usage: { path: string; line: number; symbol?: string | null }) => string | null
  /** 组行的显示名（上游 `UsageGroup.getPresentableGroupText()`）。 */
  labelOf: (groupKey: string) => string
}

/** 一条用法分组规则提供者（`UsageGroupingRuleProvider.getActiveRules(project)` 的同名方法面）。 */
export interface UsageGroupingRuleProviderContribution {
  id: string
  getActiveRules: (root: string) => readonly UsageGroupingRuleContribution[]
}

/** `UsageGroupingRuleProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function usageGroupingRuleProviders(scope: string = APPLICATION_SCOPE): UsageGroupingRuleProviderContribution[] {
  return EXTENSIONS.extensionsOf<UsageGroupingRuleProviderContribution>(USAGE_GROUPING_RULE_PROVIDER_EP, scope)
}

/** 全部提供者的规则并起来，按 rank 升序（上游 `ActiveRules` 把各 provider 的规则按档号装进那棵树）。 */
export function activeUsageGroupingRules(root: string, scope: string = APPLICATION_SCOPE): UsageGroupingRuleContribution[] {
  const out: UsageGroupingRuleContribution[] = []
  for (const provider of usageGroupingRuleProviders(scope)) {
    try {
      out.push(...provider.getActiveRules(root))
    } catch {
      // 坏的 provider 不出规则，不拖垮别的档。
    }
  }
  return out.sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
}

/** ⑤ 一条结构视图扩展（`StructureViewExtension` 的方法面，名字与上游逐字相同）。 */
export interface StructureViewExtensionContribution {
  id: string
  /** 上游 `getType()` —— 本仓按 LSP `SymbolKind` 收窄适用的父符号（空数组 = 任意）。 */
  getType: () => readonly number[]
  /** 上游 `getChildren(parent)` —— 给父符号补子行（本仓行形状 = `StructureViewRow`）。 */
  getChildren: (parent: { path: string; symbol: StructureViewSymbol; depth: number }) => readonly StructureViewRow[]
  /** 上游 `getCurrentEditorElement(editor, parent)`（缺省不提供）。 */
  getCurrentEditorElement?: (caret: { line: number; character: number }) => string | null
  /** 上游 `filterChildren(baseChildren, extensionChildren)`（缺省 = 直接追加）。 */
  filterChildren?: (base: readonly StructureViewRow[], extension: readonly StructureViewRow[]) => readonly StructureViewRow[]
}

/** `StructureViewExtensions.EP_NAME.getExtensions()` 的等价物。 */
export function structureViewExtensions(scope: string = APPLICATION_SCOPE): StructureViewExtensionContribution[] {
  return EXTENSIONS.extensionsOf<StructureViewExtensionContribution>(STRUCTURE_VIEW_EXTENSION_EP, scope)
}

/** 把一个父符号的扩展子行并进来（上游按 `getType()` 过滤后调 `getChildren`；`filterChildren` 可拦截）。 */
export function applyStructureViewExtensions(
  rows: readonly StructureViewRow[],
  parent: { path: string; symbol: StructureViewSymbol; depth: number },
  scope: string = APPLICATION_SCOPE,
): StructureViewRow[] {
  let out = [...rows]
  for (const extension of structureViewExtensions(scope)) {
    try {
      const kinds = extension.getType()
      if (kinds.length && !kinds.includes(parent.symbol.kind)) continue
      const extra = extension.getChildren(parent)
      out = extension.filterChildren ? [...extension.filterChildren(out, extra)] : [...out, ...extra]
    } catch {
      // 坏扩展不吞掉原行。
    }
  }
  return out
}

/** ⑥ 一条 PSI 结构视图工厂（`PsiStructureViewFactory.getStructureViewBuilder(psiFile)` 的同名方法面）。 */
export interface PsiStructureViewFactoryContribution {
  id: string
  /** 语言/文件类型限定（上游是 language extension；本仓按扩展名，空 = 任意）。 */
  fileType?: string
  /** 上游 `getStructureViewBuilder(psiFile)` —— 认领这个文件就返回一个构建器，否则 null。 */
  getStructureViewBuilder: (input: { path: string; language?: string }) => StructureViewBuilderContribution | null
}

/** `PsiStructureViewFactory.EP_NAME` 的等价物。 */
export function psiStructureViewFactories(scope: string = APPLICATION_SCOPE): PsiStructureViewFactoryContribution[] {
  return EXTENSIONS.extensionsOf<PsiStructureViewFactoryContribution>(PSI_STRUCTURE_VIEW_FACTORY_EP, scope)
}

/** 按文件类型取第一支认领的工厂的构建器（上游 `LanguageStructureViewBuilder` 按语言取）。 */
export function structureViewBuilderFor(
  path: string,
  language?: string,
  scope: string = APPLICATION_SCOPE,
): StructureViewBuilderContribution | null {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  for (const factory of psiStructureViewFactories(scope)) {
    if (factory.fileType && factory.fileType.toLowerCase() !== ext) continue
    try {
      const builder = factory.getStructureViewBuilder({ path, language })
      if (builder) return builder
    } catch {
      // 坏工厂跳过。
    }
  }
  return null
}

/** ⑦ 一条编辑器通知面板（上游是 `Function<FileEditor, JComponent>`；本仓给 id + 文案 + 动作）。 */
export interface EditorNotificationContribution {
  id: string
  text: string
  actions?: readonly { id: string; text: string }[]
}

/** 一条编辑器通知提供者（`EditorNotificationProvider.collectNotificationData(project, file)` 的同名方法面）。 */
export interface EditorNotificationProviderContribution {
  id: string
  collectNotificationData: (input: { path: string; root: string; text: string }) => EditorNotificationContribution | null
}

/** `EditorNotificationProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function editorNotificationProviders(scope: string = APPLICATION_SCOPE): EditorNotificationProviderContribution[] {
  return EXTENSIONS.extensionsOf<EditorNotificationProviderContribution>(EDITOR_NOTIFICATION_PROVIDER_EP, scope)
}

/** 全部提供者给出的面板（上游 `EditorNotifications.updateNotifications` 逐 provider 收集；null 的不收）。 */
export function editorNotificationsFor(
  input: { path: string; root: string; text: string },
  scope: string = APPLICATION_SCOPE,
): EditorNotificationContribution[] {
  const out: EditorNotificationContribution[] = []
  for (const provider of editorNotificationProviders(scope)) {
    try {
      const data = provider.collectNotificationData(input)
      if (data) out.push(data)
    } catch {
      // 坏 provider 不吞掉别的面板。
    }
  }
  return out
}

// ── 第二批 EP 的 bundled 登记（内建几支在各自消费侧调用；重复调用只覆盖同 id） ──────────────

/** ⑧ 一条「TODO 额外位置」检查器（`TodoIndexers$ExtraPlaceChecker.accept(project, file)` 的同名方法面）。 */
export interface TodoExtraPlaceCheckerContribution {
  id: string
  /** 上游 `accept(project, file)` —— 这个额外位置要不要建 TODO 索引（本仓给 `{ path, root }`）。 */
  accept: (input: { path: string; root: string }) => boolean
}

/** `TodoIndexers.EP_NAME`（`com.intellij.todoExtraPlaces`）的等价物。 */
export function todoExtraPlaceCheckers(scope: string = APPLICATION_SCOPE): TodoExtraPlaceCheckerContribution[] {
  return EXTENSIONS.extensionsOf<TodoExtraPlaceCheckerContribution>(TODO_EXTRA_PLACES_EP, scope)
}

/**
 * 这份文件在不在「额外位置」里（上游 `TodoIndexers.needsTodoIndex`：内容根之外的额外位置由这些
 * 检查器裁决，**任一**为真即真；本仓没有内容根模型，调用方把 root 给进来）。没有检查器时返回 false。
 */
export function todoExtraPlaceAccepts(path: string, root: string, scope: string = APPLICATION_SCOPE): boolean {
  for (const checker of todoExtraPlaceCheckers(scope)) {
    try {
      if (checker.accept({ path, root })) return true
    } catch {
      // 坏检查器当作不认，问下一支。
    }
  }
  return false
}

/** 注册一条 TODO 额外位置检查器（内建的「被忽略文件也不扫」口径在 `src/todoFilters.ts`）。 */
export function registerTodoExtraPlaceChecker(
  contribution: TodoExtraPlaceCheckerContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(TODO_EXTRA_PLACES_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条树结构提供者（内建的折叠算法在 `src/projectTreeNesting.ts`）。 */
export function registerTreeStructureProvider(
  contribution: TreeStructureProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(TREE_STRUCTURE_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条节点装饰器（内建的诊断装饰在 `src/projectTreeDecorations.ts`）。 */
export function registerProjectViewNodeDecorator(
  contribution: ProjectViewNodeDecoratorContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(PROJECT_VIEW_NODE_DECORATOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条文件图标提供者（内建的合成根图标在 `src/projectExtras.ts`）。 */
export function registerFileIconProvider(
  contribution: FileIconProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(FILE_ICON_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条用法分组规则提供者（内建的目录/文件分组在 `src/usageViewGrouping.ts`）。 */
export function registerUsageGroupingRuleProvider(
  contribution: UsageGroupingRuleProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(USAGE_GROUPING_RULE_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条结构视图扩展。 */
export function registerStructureViewExtension(
  contribution: StructureViewExtensionContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(STRUCTURE_VIEW_EXTENSION_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条 PSI 结构视图工厂（内建的符号折层在 `src/outlineView.ts`）。 */
export function registerPsiStructureViewFactory(
  contribution: PsiStructureViewFactoryContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(PSI_STRUCTURE_VIEW_FACTORY_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条编辑器通知提供者（内建的双向文本提示在 `src/bidiNotification.ts`）。 */
export function registerEditorNotificationProvider(
  contribution: EditorNotificationProviderContribution,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeViewExtension(EDITOR_NOTIFICATION_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}
