// **projectviews 域余下的项目视图扩展点宿主**（第二批；`src/ideViewExtensionPoints.ts` 已 760 行，
// 单文件 ≤900 行的约束下独立成册）。这里装的是上游**本来就是 EP** 的四条项目视图接口，
// 按同名方法面登记，让原版 IDEA 插件按同一 id 挂进来并被真实消费链路调用。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明）：
//   · `com.intellij.patternDialectProvider` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:251`
//     （`interface="com.intellij.packageDependencies.ui.PatternDialectProvider"`）；
//     `EP_NAME` 在 `PatternDialectProvider.java:24`；方法面 `createTreeModel`/`getDisplayName`/
//     `getShortName`/`createActions`/`createPackageSet`/`getIcon`/`getHintMessage`（`:33-61`）。
//     出厂两支：`ProjectPatternProvider`（shortName `file`，同 xml `:1026`）与
//     `PackagePatternProvider`（shortName `package`，`java/java-backend/resources/META-INF/JavaPlugin.xml:674`）。
//   · `com.intellij.projectViewNestingRulesProvider` —— `platform/lang-api/resources/intellij.platform.lang.xml:177`
//     （`interface="com.intellij.ide.projectView.ProjectViewNestingRulesProvider"`）；方法面
//     `addFileNestingRules(consumer)` 与 `consumer.addNestingRule(parentFileSuffix, childFileSuffix)`
//     （`ProjectViewNestingRulesProvider.java:40-43`）；消费方
//     `ProjectViewFileNestingService.java:47-54`（把各 provider 的规则并成一张表）。
//   · `com.intellij.projectView.externalLibraries.workspaceModelNodesProvider` ——
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:317`（`interface=
//     "com.intellij.ide.projectView.impl.nodes.ExternalLibrariesWorkspaceModelNodesProvider"`）；
//     `EP` 在 `ExternalLibrariesWorkspaceModelNodesProvider.java:16`；方法面 `getWorkspaceClass()`
//     （`:20`）与 `createNode(entity, project, settings)`（`:26`）；消费方
//     `ExternalLibrariesNode.java` 的子节点那一支（四类子节点之末）。
//   · `com.intellij.projectViewPaneSelectionHelper` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:315`
//     （`interface="com.intellij.ide.projectView.impl.ProjectViewPaneSelectionHelper"`）；
//     `EP_NAME` 在 `ProjectViewPaneSelectionHelper.java:21`；方法面 `computeAdjustedPaths(descriptor)`
//     （`:30`）与 `computeAdjustedNodes(nodes)`（`:32`），消费方 `:40-52` 的 `getAdjustedPaths`/`getAdjustedNodes`。
//
// **已核过上游没有、不造假的两条**（协调单点名要 grep 的）：
//   · `com.intellij.structureView.newExtension` —— 全树零命中。结构视图真 EP 见
//     `platform/editor-ui-api/resources/intellij.platform.editor.ui.xml:40-47`（`lang.psiStructureViewFactory`/
//     `structureViewBuilder`/`treeStructureProvider`）与 `platform/structure-view-impl/resources/intellij.platform.structureView.xml:36-40`
//     （`lang.logicalStructureTreeElementProvider`/`lang.logicalStructureElementsProvider`/`structurePopupProvider`）—— 无 `newExtension`。
//   · `com.intellij.projectViewCustomizer` —— 全树零命中。项目视图真 EP 是上面这四条加
//     `projectViewPane`/`projectViewNodeDecorator`/`projectViewPaneExtractor`/`projectViewNestingRulesProvider`。
//
// 与上游的如实差异：本仓没有 `Project`/`VirtualFile`/`PsiFile`，所以
// `createTreeModel` 的输入收成 `{files, declared, settings}`、输出是本仓的 `PackageNode[]`；
// `createPackageSet` 的 `PackageSet` 收成路径 glob 串；`addNestingRule` 的后缀对折成
// `*<suffix>` 模式（上游按后缀匹配文件名，两者对点号后缀逐条等价）；外部库 provider 的
// workspace entity 收成声明类的名字串；窗格选择 helper 的 `TreePath` 收成窗格 id 串。
//
// 纯数据层：只 import `extensionPoints` / `symbolModel` / `projectTreeNesting`，
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/project-view-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { packageTreeOf, type PackageNode, type PackageViewSettings } from './symbolModel.ts'
import { nestingRulesFromPairs, type NestingPair, type NestingRule } from './projectTreeNesting.ts'

/** 包/项目依赖树的方言（上游 `PatternDialectProvider.EP_NAME`，`PatternDialectProvider.java:24`）。 */
export const PATTERN_DIALECT_PROVIDER_EP = 'com.intellij.patternDialectProvider'
/** 文件嵌套规则提供者（上游 `ProjectViewNestingRulesProvider`，`lang.xml:177`）。 */
export const PROJECT_VIEW_NESTING_RULES_PROVIDER_EP = 'com.intellij.projectViewNestingRulesProvider'
/** 外部库的 workspace-model 节点提供者（上游 `ExternalLibrariesWorkspaceModelNodesProvider`，`lang.impl.xml:317`）。 */
export const PROJECT_VIEW_EXTERNAL_LIBRARIES_NODES_PROVIDER_EP =
  'com.intellij.projectView.externalLibraries.workspaceModelNodesProvider'
/** 项目视图选中项助手（上游 `ProjectViewPaneSelectionHelper`，`lang.impl.xml:315`）。 */
export const PROJECT_VIEW_PANE_SELECTION_HELPER_EP = 'com.intellij.projectViewPaneSelectionHelper'

/** 四条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareProjectViewExtensionPoints(): void {
  for (const [id, name] of [
    [PATTERN_DIALECT_PROVIDER_EP, '包依赖方言提供者'],
    [PROJECT_VIEW_NESTING_RULES_PROVIDER_EP, '文件嵌套规则提供者'],
    [PROJECT_VIEW_EXTERNAL_LIBRARIES_NODES_PROVIDER_EP, '外部库 workspace 节点提供者'],
    [PROJECT_VIEW_PANE_SELECTION_HELPER_EP, '项目视图选中项助手'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareProjectViewExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖）；EP 未声明时抛错（与 `registerIdeViewExtension` 同一口径）。 */
export function registerProjectViewExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterProjectViewExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── ① 包依赖方言（`PatternDialectProvider`） ────────────────────────────────────────────────

/** 出厂的两支 shortName（逐字取上游：`ProjectPatternProvider.FILE` / `PackagePatternProvider.PACKAGE`）。 */
export const FILE_PATTERN_DIALECT = 'file'
export const PACKAGE_PATTERN_DIALECT = 'package'

/** `createTreeModel` 的输入（上游 `createTreeModel(project, deps, marker, settings)` 的可移植子集）。 */
export interface PatternDialectTreeInput {
  files: readonly string[]
  declared: ReadonlyMap<string, string | null>
  settings: PackageViewSettings
}

/**
 * 一条方言（`PatternDialectProvider` 的方法面，名字与上游逐字相同）。
 * `createTreeModel` 的返回就是本仓的包/目录树（上游 `TreeModel`）。
 */
export interface PatternDialectProviderContribution {
  id: string
  /** 上游 `getShortName()`（`file` / `package` / 第三方自定义）。 */
  getShortName: () => string
  /** 上游 `getDisplayName()`。 */
  getDisplayName: () => string
  /** 上游 `createTreeModel(project, deps, marker, settings)`（本仓给文件清单 + 声明包名表）。 */
  createTreeModel: (input: PatternDialectTreeInput) => readonly PackageNode[]
  /** 上游 `createPackageSet(node, recursively)`（本仓给路径 glob，缺省不提供）。 */
  createPackageSet?: (input: { node: string; recursively: boolean }) => readonly string[]
  /** 上游 `getHintMessage()`（搜索框下的提示，缺省不提供）。 */
  getHintMessage?: () => string
}

/** `PatternDialectProvider.EP_NAME.getExtensionList()` 的等价物。 */
export function patternDialectProviders(scope: string = APPLICATION_SCOPE): PatternDialectProviderContribution[] {
  return EXTENSIONS.extensionsOf<PatternDialectProviderContribution>(PATTERN_DIALECT_PROVIDER_EP, scope)
}

/**
 * 按 shortName 取一支方言 —— 逐句对位上游 `PatternDialectProvider.getInstance(shortName)`
 * （`PatternDialectProvider.java:26-31`）：先按 shortName 精确找；找不到且 requested 不是 `file` 时
 * 回落 `file`；`file` 本身找不到就给 null（上游对 `FILE` 那一支也回 null）。
 */
export function patternDialectProvider(
  shortName: string, scope: string = APPLICATION_SCOPE,
): PatternDialectProviderContribution | null {
  const list = patternDialectProviders(scope)
  const shortNameOf = (provider: PatternDialectProviderContribution): string => {
    try { return provider.getShortName() } catch { return '' }
  }
  const exact = list.find(provider => shortNameOf(provider) === shortName)
  if (exact) return exact
  if (shortName === FILE_PATTERN_DIALECT) return null
  return list.find(provider => shortNameOf(provider) === FILE_PATTERN_DIALECT) ?? null
}

/**
 * 用某支方言建一棵包/目录树。找不到方言（含请求 `file` 而没人提供）时**回落到本仓默认的
 * 包树**（`packageTreeOf`），一个坏方言也不把视图清空。
 */
export function patternDialectTree(
  input: PatternDialectTreeInput, shortName: string = PACKAGE_PATTERN_DIALECT, scope: string = APPLICATION_SCOPE,
): PackageNode[] {
  const provider = patternDialectProvider(shortName, scope)
  if (!provider) return packageTreeOf(input.files, input.declared, input.settings)
  try { return [...provider.createTreeModel(input)] }
  catch { return packageTreeOf(input.files, input.declared, input.settings) }
}

/** `createPackageSet(node, recursively)` 的消费面（方言没提供该方法时给空集）。 */
export function patternDialectPackageSet(
  shortName: string, node: string, recursively: boolean, scope: string = APPLICATION_SCOPE,
): string[] {
  const provider = patternDialectProvider(shortName, scope)
  if (!provider?.createPackageSet) return []
  try { return [...provider.createPackageSet({ node, recursively })] } catch { return [] }
}

/** 「项目文件」那一支：按目录分层建树（上游 `ProjectPatternProvider` 的口径）。 */
function fileDialectTree(input: PatternDialectTreeInput): PackageNode[] {
  const nodes = new Map<string, PackageNode>()
  const ensure = (dir: string): PackageNode => {
    const existing = nodes.get(dir)
    if (existing) return existing
    const node: PackageNode = { name: dir, files: [], children: [], middle: false }
    nodes.set(dir, node)
    if (dir) {
      const slash = dir.lastIndexOf('/')
      const parent = ensure(slash < 0 ? '' : dir.slice(0, slash))
      if (!parent.children.some(child => child.name === dir)) parent.children.push(node)
    }
    return node
  }
  ensure('')
  for (const raw of input.files) {
    const path = raw.replace(/\\/g, '/').replace(/^\.?\//, '')
    const slash = path.lastIndexOf('/')
    ensure(slash < 0 ? '' : path.slice(0, slash)).files.push(path)
  }
  const markMiddle = (node: PackageNode): void => {
    for (const child of node.children) markMiddle(child)
    node.middle = node.files.length === 0 && node.children.length > 0
  }
  const roots = [...nodes.values()].filter(node => node.name === '')
  roots.forEach(markMiddle)
  return roots.filter(node => node.files.length > 0 || node.children.length > 0)
}

/** 随本仓发货的两支方言（shortName 逐字取上游）。 */
export const BUNDLED_PATTERN_DIALECTS: readonly PatternDialectProviderContribution[] = [
  {
    id: FILE_PATTERN_DIALECT,
    getShortName: () => FILE_PATTERN_DIALECT,
    getDisplayName: () => '项目文件',
    createTreeModel: fileDialectTree,
    createPackageSet: ({ node, recursively }) => {
      const dir = node.replace(/\\/g, '/').replace(/\/+$/, '')
      if (!dir) return []
      return [recursively ? `${dir}/**` : `${dir}/*`]
    },
  },
  {
    id: PACKAGE_PATTERN_DIALECT,
    getShortName: () => PACKAGE_PATTERN_DIALECT,
    getDisplayName: () => '包',
    // 声明的包名按 `.` 分段、目录归属按 `/` 分段，`packageTreeOf` 两种都还原成同一棵树。
    createTreeModel: input => packageTreeOf(input.files, input.declared, input.settings),
    createPackageSet: ({ node, recursively }) => {
      const base = node.includes('.') ? node.split('.').join('/') : node
      if (!base) return []
      return [recursively ? `**/${base}/**` : `**/${base}/*`]
    },
  },
]

let dialectsRegistered = false

/** 把两支内建方言注册进 EP（幂等：只做一次）。第三方按同一 shortName 挂的方言覆盖内建那一支。 */
export function registerBundledPatternDialects(): void {
  if (dialectsRegistered) return
  dialectsRegistered = true
  for (const dialect of BUNDLED_PATTERN_DIALECTS) {
    registerProjectViewExtension(PATTERN_DIALECT_PROVIDER_EP, dialect.id, dialect, { source: 'bundled' })
  }
}

registerBundledPatternDialects()

// ── ② 文件嵌套规则（`ProjectViewNestingRulesProvider`） ────────────────────────────────────

/** 上游 `ProjectViewNestingRulesProvider.Consumer` 的方法面（`ProjectViewNestingRulesProvider.java:42-44`）。 */
export interface NestingRulesConsumer {
  addNestingRule: (parentFileSuffix: string, childFileSuffix: string) => void
}

/** 一条嵌套规则提供者（`addFileNestingRules(consumer)` 的同名方法面）。 */
export interface ProjectViewNestingRulesProviderContribution {
  id: string
  addFileNestingRules: (consumer: NestingRulesConsumer) => void
}

/** `EP_NAME.getExtensionList()` 的等价物。 */
export function projectViewNestingRulesProviders(
  scope: string = APPLICATION_SCOPE,
): ProjectViewNestingRulesProviderContribution[] {
  return EXTENSIONS.extensionsOf<ProjectViewNestingRulesProviderContribution>(PROJECT_VIEW_NESTING_RULES_PROVIDER_EP, scope)
}

/**
 * 把各 provider 的后缀对收成 `NestingPair`。上游的一条规则是「后缀 → 后缀」
 * （`parentFileSuffix` / `childFileSuffix`），本仓的模式是 `*<后缀>`（`FileNestingBuilder.java:91`
 * 的 `endsWithIgnoreCase` 与本仓 `matchNamePattern` 对点号后缀逐条等价）；空后缀与父子相等
 * 的对丢掉（上游 `FileNestingBuilder.java:58-59` 同口径）。坏 provider 只跳过它自己。
 */
export function projectViewNestingRulePairs(scope: string = APPLICATION_SCOPE): NestingPair[] {
  const pairs: NestingPair[] = []
  const seen = new Set<string>()
  const consumer: NestingRulesConsumer = {
    addNestingRule(parentFileSuffix, childFileSuffix) {
      const parent = String(parentFileSuffix ?? '')
      const child = String(childFileSuffix ?? '')
      if (!parent || !child || parent === child) return
      const key = `${parent}\u0000${child}`
      if (seen.has(key)) return
      seen.add(key)
      pairs.push({ parent: `*${parent}`, child: `*${child}` })
    },
  }
  for (const provider of projectViewNestingRulesProviders(scope)) {
    try { provider.addFileNestingRules(consumer) } catch { /* 坏 provider 不吞掉别人的规则 */ }
  }
  return pairs
}

/** 各 provider 的规则折成规则表（没有 provider 时给空表）。 */
export function projectViewNestingRules(scope: string = APPLICATION_SCOPE): NestingRule[] {
  const pairs = projectViewNestingRulePairs(scope)
  return pairs.length ? nestingRulesFromPairs(pairs) : []
}

/**
 * 把 EP 的规则并进一张基准规则表（本仓消费点：`src/projectTreeModel.ts` 的 `nestingRules()`）。
 * 没有第三方 provider 时**原样返回 base 的副本** ⇒ 既有行为零改动。
 */
export function withExtensionNestingRules(
  base: readonly NestingRule[], scope: string = APPLICATION_SCOPE,
): NestingRule[] {
  const extra = projectViewNestingRules(scope)
  const merged = base.map(rule => ({ parent: rule.parent, children: [...rule.children] }))
  if (!extra.length) return merged
  for (const rule of extra) {
    const hit = merged.find(candidate => candidate.parent === rule.parent)
    if (hit) {
      for (const child of rule.children) if (!hit.children.includes(child)) hit.children.push(child)
    } else {
      merged.push({ parent: rule.parent, children: [...rule.children] })
    }
  }
  return merged
}

// ── ③ 外部库的 workspace-model 节点（`ExternalLibrariesWorkspaceModelNodesProvider`） ──────

/** 一条外部库合成行（上游 `AbstractTreeNode` 的呈现面：名字 + 不落盘的合成路径）。 */
export interface ExternalLibrariesNodeView {
  id: string
  name: string
  path: string
}

/**
 * 一条 provider（`getWorkspaceClass()` / `createNode(entity, project, settings)` 的同名方法面）。
 * 上游的 `entity` 是 workspace-model 实体；本仓没有实体模型，故按 provider 自己声明的
 * workspace 类给**一个**该类的占位实体（`entity` = 类名字串），由 provider 决定要不要出节点。
 */
export interface ExternalLibrariesWorkspaceModelNodesProviderContribution {
  id: string
  getWorkspaceClass: () => string
  createNode: (input: { entity: string; files: readonly string[] }) => ExternalLibrariesNodeView | null
}

/** `ExternalLibrariesWorkspaceModelNodesProvider.EP.getExtensionList()` 的等价物。 */
export function externalLibrariesNodesProviders(
  scope: string = APPLICATION_SCOPE,
): ExternalLibrariesWorkspaceModelNodesProviderContribution[] {
  return EXTENSIONS.extensionsOf<ExternalLibrariesWorkspaceModelNodesProviderContribution>(
    PROJECT_VIEW_EXTERNAL_LIBRARIES_NODES_PROVIDER_EP, scope)
}

/** 逐个 provider 取它给出的合成行（`createNode` 返回 null 的不收；坏 provider 只跳过它自己）。 */
export function externalLibrariesProviderNodes(
  files: readonly string[], scope: string = APPLICATION_SCOPE,
): ExternalLibrariesNodeView[] {
  const out: ExternalLibrariesNodeView[] = []
  for (const provider of externalLibrariesNodesProviders(scope)) {
    let entity = ''
    try { entity = provider.getWorkspaceClass() } catch { continue }
    try {
      const node = provider.createNode({ entity, files })
      if (node) out.push(node)
    } catch { /* 坏 provider 不出节点 */ }
  }
  return out
}

// ── ④ 项目视图选中项助手（`ProjectViewPaneSelectionHelper`） ───────────────────────────────

/** 选中描述（上游 `SelectionDescriptor` 的可移植子集：候选路径 + 目标）。 */
export interface ProjectViewPaneSelectionDescriptor {
  /** 候选（本仓是窗格 id 列表；上游是 `TreePath` 列表）。 */
  paths: readonly string[]
  /** 目标 id（本仓 `select(id)` 的入参；上游是 targetPsiElement/targetVirtualFile）。 */
  target?: string
}

/** 一条助手（`computeAdjustedPaths(descriptor)` / `computeAdjustedNodes(nodes)` 的同名方法面）。 */
export interface ProjectViewPaneSelectionHelperContribution {
  id: string
  computeAdjustedPaths: (descriptor: ProjectViewPaneSelectionDescriptor) => readonly string[] | null
  computeAdjustedNodes?: (nodes: readonly string[]) => readonly string[] | null
}

/** `EP_NAME.getExtensionList()` 的等价物。 */
export function projectViewPaneSelectionHelpers(
  scope: string = APPLICATION_SCOPE,
): ProjectViewPaneSelectionHelperContribution[] {
  return EXTENSIONS.extensionsOf<ProjectViewPaneSelectionHelperContribution>(PROJECT_VIEW_PANE_SELECTION_HELPER_EP, scope)
}

/**
 * `ProjectViewPaneSelectionHelper.getAdjustedPaths(descriptor)` 的等价物（`:39-47`）：
 * 取**第一条**返回非 null 的助手的路径；没有助手接手时原样返回候选（上游 `descriptor.originalTreePaths`）。
 */
export function adjustedProjectViewPaneSelection(
  descriptor: ProjectViewPaneSelectionDescriptor, scope: string = APPLICATION_SCOPE,
): string[] {
  for (const helper of projectViewPaneSelectionHelpers(scope)) {
    try {
      const adjusted = helper.computeAdjustedPaths(descriptor)
      if (adjusted) return [...adjusted]
    } catch { /* 坏助手不接手，问下一支 */ }
  }
  return [...descriptor.paths]
}
