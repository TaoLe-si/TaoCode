// **xdebugger 域的扩展点宿主接线** —— 把「断点类型 / 调试器设置 / 设置页提供者 / 文本值可视化 /
// 附加调试器提供者 / 断点分组规则」这几族上游本来就是 EP 的接口，按 `src/extensionPoints.ts`
// 的 `EXTENSIONS` 宿主登记出来，并给出与上游**同名的方法面**。
//
// 上游依据（qualifiedName 逐字取自各 plugin.xml 的 `<extensionPoint>` 声明或 `EP_NAME` 常量）：
//   · `com.intellij.xdebugger.breakpointType` —— `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpointType.java:39`
//     （`XBreakpointType.EXTENSION_POINT_NAME`）；方法面 `getId()` / `getTitle()` / `isSuspendThreadSupported()`
//     / `isTemporaryBreakpointSupported()` / `getDefaultSuspendPolicy()` / `createProperties()`（`:63-99`）。
//     上游每种断点类型（java-line / java-exception / java-field…）是它的一条贡献。
//   · `com.intellij.xdebugger.settings` —— `platform/xdebugger-api/resources/intellij.platform.debugger.content.xml:9`
//     （`interface="com.intellij.xdebugger.settings.XDebuggerSettings" dynamic="true"`）；方法面
//     `getId()` / `createConfigurables(category)` / `generalApplied(category)`（`XDebuggerSettings.java:31-42`）。
//   · `com.intellij.xdebugger.configurableProvider` —— 同文件 `:12`，接口 `DebuggerConfigurableProvider`
//     （`DebuggerConfigurableProvider.java:16` 的 `EXTENSION_POINT`）；方法面 `getConfigurables(category)`（`:18`）。
//   · `com.intellij.xdebugger.textValueVisualizer` —— 同文件 `:18`
//     （`interface="com.intellij.xdebugger.ui.TextValueVisualizer" dynamic="true"`）；方法面
//     `visualize(value)` / `detectFileType(value)`（`TextValueVisualizer.kt:20-31`）。**这是「值呈现」那一族的真实 EP**
//     —— 任务书写的 `com.intellij.xdebugger.xvaluePresenter` / `framePresentationProvider` 上游**不存在**；
//     上游值呈现的可插件面是 `TextValueVisualizer`（本文件落的）与 Java 侧的 `java.debugger.valueRenderer`
//     （`java/debugger/impl` 的 `XValuePresentationProvider` 不是 EP）。
//   · `com.intellij.xdebugger.attachDebuggerProvider` —— `platform/xdebugger-impl/src/com/intellij/xdebugger/attach/XAttachDebuggerProvider.java:19`
//     （`XAttachDebuggerProvider.EP`）；方法面 `isAttachHostApplicable(host)`（`:53`）、
//     `getAvailableDebuggers(project, process, host, ...)`（`:68`）、`getPresentationGroup()`。
//   · `com.intellij.xdebugger.breakpointGroupingRule` —— `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/ui/XBreakpointGroupingRule.java:14`
//     （`XBreakpointGroupingRule.EP`）；方法面 `getId()` / `getPresentableName()` / `getPriority()` /
//     `getGroup(breakpoint)` / `isAlwaysEnabled()`（`:25-46`）。
//
// **任务书里其余四个名字如实对照（都不是上游 EP）**：
//   · `com.intellij.xdebugger.debugProcessListener` —— 上游 `DebugProcessListener` 是**每进程**监听，
//     不是 EP；本仓已把它暴露成同名 EP，落在 `src/debugProcessListeners.ts`（不在本文件重复）。
//   · `com.intellij.xdebugger.xdebuggerExtension` / `xvaluePresenter` / `framePresentationProvider` /
//     `suspendContextProvider` —— 上游全树没有这几个 `qualifiedName`，也没有同名接口。值呈现的插件面
//     落成 `com.intellij.xdebugger.textValueVisualizer`；没有名字可照抄的就不造一个假 EP。
//     **2026-10-07 epclose3 复验**（整树 `rg` 逐名零命中，含 `XValuePresenter` / `XDebuggerExtension` /
//     `SuspendContextProvider`）：确认为**不存在的 EP 名**。最接近的两个都不是 EP ——
//     `XValuePresentationProvider`（`java/debugger/impl/src/com/intellij/debugger/ui/tree/render/XValuePresentationProvider.java:8`）
//     是 Java 调试器**内部接口**，由 `NodeRendererSettings.java:461` 实现、`JavaValue.java:316` 消费，
//     不经 plugin.xml；`XValuePresentation`（`platform/xdebugger-api/src/com/intellij/xdebugger/frame/presentation/XValuePresentation.java`）
//     是**呈现数据的抽象类**（值节点画成什么），也不是 EP。本仓值呈现的可插件面同上是
//     `textValueVisualizer`；**不造假 EP**。
//
// **本仓此前**：断点能力在 `src/breakpointLocations.ts`、异常断点在 `src/exceptionBreakpoints.ts`、
// 设置页在 `src/components/DebuggerSettingsPage.vue`、值呈现散在 `src/debugValueCopy.ts` 等 ——
// 都是写死的，没有插件入口。本文件补上 EP 宿主 + 同名方法面 + consume；内建的两三种断点类型/
// 设置/可视化在各自消费侧作为 bundled 贡献登记。
//
// 与上游的如实差异：本仓没有 `Project`/`XBreakpoint`/`XValue` 对象，方法面的参数收成字符串/最小形状；
// 附加提供者的 `ProcessInfo` 收成 `{ pid, name }`。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），便于 `node --test` 直测。
//
// 判据：`tests/xdebugger-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle } from './extensionPoints.ts'
import { EPExtensionRegistry } from './executionExtensionPoints.ts'

/** 六条 EP 的 id（逐字取自上游，见文件头）。 */
export const XBREAKPOINT_TYPE_EP = 'com.intellij.xdebugger.breakpointType'
export const XDEBUGGER_SETTINGS_EP = 'com.intellij.xdebugger.settings'
export const DEBUGGER_CONFIGURABLE_PROVIDER_EP = 'com.intellij.xdebugger.configurableProvider'
export const TEXT_VALUE_VISUALIZER_EP = 'com.intellij.xdebugger.textValueVisualizer'
export const XATTACH_DEBUGGER_PROVIDER_EP = 'com.intellij.xdebugger.attachDebuggerProvider'
export const XBREAKPOINT_GROUPING_RULE_EP = 'com.intellij.xdebugger.breakpointGroupingRule'

// ── epclose3（2026-10-07）：xdebugger 余下的两条**真实** EP ─────────────────────────────────
//
// 上游依据（qualifiedName 逐字取自 `platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml`）：
//   · `com.intellij.xdebugger.debuggerSupport` —— 同文件 `:9`
//     （`interface="com.intellij.xdebugger.impl.DebuggerSupport" dynamic="true"`）。**如实差异**：
//     上游那个类在参考树里是**空且 @Deprecated** 的（`platform/xdebugger-impl/shared/src/com/intellij/xdebugger/impl/DebuggerSupport.java:4-6`
//     整类就是 `@Deprecated public class DebuggerSupport {}`），所以**没有方法面可照搬**；它仍被
//     调试动作的 `DebuggerActionHandler.getHandler(DebuggerSupport)` 当参数类型用（如
//     `platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/actions/ToggleLineBreakpointAction.java:47`）。
//     本仓给一张**身份表**（`{ id }`）：插件按同一 EP id 挂自己的支持项，消费方按 id 取。
//   · `com.intellij.xdebugger.attachHostProvider` —— 同文件 `:11`
//     （`interface="com.intellij.xdebugger.attach.XAttachHostProvider" dynamic="true"`）；接口在
//     `platform/xdebugger-impl/src/com/intellij/xdebugger/attach/XAttachHostProvider.kt`，方法面
//     `getAvailableHosts(project)`（`:38`，另有 `getAvailableHostsAsync` 缺省复用同步版 `:46`）
//     与 `getPresentationGroup()`（`:33`）。本仓把每个 host 收成 `{ id, host, displayName }`。
export const XDEBUGGER_SUPPORT_EP = 'com.intellij.xdebugger.debuggerSupport'
export const XATTACH_HOST_PROVIDER_EP = 'com.intellij.xdebugger.attachHostProvider'

/** 八条 EP 的声明（幂等）。 */
export function declareXdebuggerExtensionPoints(): void {
  for (const [id, name] of [
    [XBREAKPOINT_TYPE_EP, '断点类型'],
    [XDEBUGGER_SETTINGS_EP, '调试器设置'],
    [DEBUGGER_CONFIGURABLE_PROVIDER_EP, '调试器设置页提供者'],
    [TEXT_VALUE_VISUALIZER_EP, '文本值可视化'],
    [XATTACH_DEBUGGER_PROVIDER_EP, '附加调试器提供者'],
    [XBREAKPOINT_GROUPING_RULE_EP, '断点分组规则'],
    [XDEBUGGER_SUPPORT_EP, '调试器支持'],
    [XATTACH_HOST_PROVIDER_EP, '附加主机提供者'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareXdebuggerExtensionPoints()

/** 按 id 注册一条贡献到指定 EP（等价于 plugin.xml 的一条 `<extensionPoint>` 贡献）。 */
export function registerXdebuggerExtension<T>(
  extensionPoint: string, id: string, value: T, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销某 EP 上的一条贡献（返回是否真的删掉了，与宿主同口径）。 */
export function unregisterXdebuggerExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── ① 断点类型（`com.intellij.xdebugger.breakpointType`） ────────────────────────────────────

/**
 * 一条断点类型（上游 `XBreakpointType` 的方法面）。
 * `isSuspendThreadSupported()` / `isTemporaryBreakpointSupported()` / `getDefaultSuspendPolicy()` 是上游
 * 面板据此显示哪些标准面板的判据（`XBreakpointType.java:70-91`）。
 */
export interface XBreakpointTypeContribution {
  /** `XBreakpointType.getId()`。 */
  id: string
  /** `XBreakpointType.getTitle()`。 */
  getTitle: () => string
  /** `isSuspendThreadSupported()`（缺省 true，照上游默认）。 */
  isSuspendThreadSupported?: () => boolean
  /** `isTemporaryBreakpointSupported()`（缺省 false，照上游 `:77-79` 的抽象类默认）。 */
  isTemporaryBreakpointSupported?: () => boolean
  /** `getDefaultSuspendPolicy()`（本仓给档位名串：`'NONE' | 'THREAD' | 'ALL'`）。 */
  getDefaultSuspendPolicy?: () => 'NONE' | 'THREAD' | 'ALL'
}

export const xbreakpointTypeRegistry = new EPExtensionRegistry<XBreakpointTypeContribution>(XBREAKPOINT_TYPE_EP)

/** 全部断点类型（内建 line/exception + 第三方）。 */
export function xbreakpointTypes(): XBreakpointTypeContribution[] {
  return xbreakpointTypeRegistry.all()
}

/** 按 id 找断点类型（上游按 `getId()` 找）。 */
export function xbreakpointTypeById(id: string): XBreakpointTypeContribution | undefined {
  return xbreakpointTypeRegistry.find(id)
}

/** 注册一条断点类型。 */
export function registerXBreakpointType(
  type: XBreakpointTypeContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return xbreakpointTypeRegistry.register(type, { source: 'user', ...options })
}

// ── ② 调试器设置（`com.intellij.xdebugger.settings`） ────────────────────────────────────────

/** 设置分类（上游 `DebuggerSettingsCategory` 的四档：GENERAL / DATA_VIEWS / STEPPING / HOT_SWAP）。 */
export type DebuggerSettingsCategory = 'GENERAL' | 'DATA_VIEWS' | 'STEPPING' | 'HOT_SWAP'

/** 一条调试器设置（上游 `XDebuggerSettings` 的方法面）。本仓的设置页只有一格，`createConfigurables` 给一组页 id。 */
export interface XDebuggerSettingsContribution {
  /** `XDebuggerSettings.getId()`。 */
  id: string
  /** `createConfigurables(category)`（本仓给设置页 id 数组）。 */
  createConfigurables?: (category: DebuggerSettingsCategory) => readonly string[]
  /** `generalApplied(category)`（应用设置后回调；本仓给一个通知钩子）。 */
  generalApplied?: (category: DebuggerSettingsCategory) => void
}

export const xdebuggerSettingsRegistry = new EPExtensionRegistry<XDebuggerSettingsContribution>(XDEBUGGER_SETTINGS_EP)

/** 全部调试器设置贡献。 */
export function xdebuggerSettingsContributions(): XDebuggerSettingsContribution[] {
  return xdebuggerSettingsRegistry.all()
}

/** 按 id 取设置贡献。 */
export function xdebuggerSettingsById(id: string): XDebuggerSettingsContribution | undefined {
  return xdebuggerSettingsRegistry.find(id)
}

/** 注册一条调试器设置。 */
export function registerXDebuggerSettings(
  settings: XDebuggerSettingsContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return xdebuggerSettingsRegistry.register(settings, { source: 'user', ...options })
}

// ── ③ 调试器设置页提供者（`com.intellij.xdebugger.configurableProvider`） ─────────────────────

/** 一条设置页提供者（上游 `DebuggerConfigurableProvider.getConfigurables(category)`）。 */
export interface DebuggerConfigurableProviderContribution {
  id: string
  getConfigurables: (category: DebuggerSettingsCategory) => readonly string[]
}

export const debuggerConfigurableProviderRegistry =
  new EPExtensionRegistry<DebuggerConfigurableProviderContribution>(DEBUGGER_CONFIGURABLE_PROVIDER_EP)

/** 全部设置页提供者。 */
export function debuggerConfigurableProviders(): DebuggerConfigurableProviderContribution[] {
  return debuggerConfigurableProviderRegistry.all()
}

/** 某一分类下的全部设置页 id（上游 `DebuggerConfigurableProvider` 的合并结果）。 */
export function debuggerConfigurablesFor(category: DebuggerSettingsCategory): string[] {
  const out: string[] = []
  for (const provider of debuggerConfigurableProviderRegistry.all()) {
    try { out.push(...provider.getConfigurables(category)) } catch { /* 容错 */ }
  }
  return [...new Set(out)]
}

/** 注册一条设置页提供者。 */
export function registerDebuggerConfigurableProvider(
  provider: DebuggerConfigurableProviderContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return debuggerConfigurableProviderRegistry.register(provider, { source: 'user', ...options })
}

// ── ④ 文本值可视化（`com.intellij.xdebugger.textValueVisualizer`） ───────────────────────────

/** 一个可视化页（上游 `VisualizedContentTab` 的可移植子集：名字 + 内部 id + 产出的文本）。 */
export interface VisualizedContentTab {
  name: string
  id: string
  /** 本仓没有 Swing 组件；可视化结果直接给文本（格式化后的 JSON/XML 等）。 */
  content: string
}

/**
 * 一条文本值可视化（上游 `TextValueVisualizer.visualize(value)`）。
 * 返回空数组 = 这个值它可视化不了（上游 `:22-24`）。
 */
export interface TextValueVisualizerContribution {
  id: string
  visualize: (value: string) => readonly VisualizedContentTab[]
  /** `detectFileType(value)`（本仓给文件扩展名或空）。 */
  detectFileType?: (value: string) => string | null
}

export const textValueVisualizerRegistry = new EPExtensionRegistry<TextValueVisualizerContribution>(TEXT_VALUE_VISUALIZER_EP)

/** 全部文本值可视化贡献。 */
export function textValueVisualizers(): TextValueVisualizerContribution[] {
  return textValueVisualizerRegistry.all()
}

/** 把一个文本值交给全部可视化贡献，收拢各页（上游 `XValue` 右键「View as …」的等价物）。 */
export function visualizeTextValue(value: string): VisualizedContentTab[] {
  const out: VisualizedContentTab[] = []
  for (const visualizer of textValueVisualizerRegistry.all()) {
    try { out.push(...visualizer.visualize(value)) } catch { /* 容错 */ }
  }
  return out
}

/** 注册一条文本值可视化。 */
export function registerTextValueVisualizer(
  visualizer: TextValueVisualizerContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return textValueVisualizerRegistry.register(visualizer, { source: 'user', ...options })
}

// ── ⑤ 附加调试器提供者（`com.intellij.xdebugger.attachDebuggerProvider`） ────────────────────

/** 附加主机（上游 `XAttachHost` 的可移植子集；本仓只有 Local 一档）。 */
export type AttachHost = 'Local' | 'WSL' | 'Remote'

/** 进程信息（上游 `ProcessInfo` 的可移植子集）。 */
export interface AttachProcessInfo {
  pid: number
  name: string
}

/** 一条可附加的调试器（上游 `XAttachDebugger` 的可移植子集）。 */
export interface AttachDebuggerLike {
  id: string
  displayName: string
}

/** 一条附加调试器提供者（上游 `XAttachDebuggerProvider` 的方法面）。 */
export interface XAttachDebuggerProviderContribution {
  id: string
  isAttachHostApplicable: (host: AttachHost) => boolean
  getAvailableDebuggers: (process: AttachProcessInfo) => readonly AttachDebuggerLike[]
  /** 展示分组名（上游 `getPresentationGroup().getGroupName()`）。 */
  getGroupName?: () => string
}

export const xattachDebuggerProviderRegistry =
  new EPExtensionRegistry<XAttachDebuggerProviderContribution>(XATTACH_DEBUGGER_PROVIDER_EP)

/** 全部附加提供者。 */
export function xattachDebuggerProviders(): XAttachDebuggerProviderContribution[] {
  return xattachDebuggerProviderRegistry.all()
}

/** 某个主机上适用的附加提供者（上游 `getAvailableDebuggers` 之前先按 host 过滤）。 */
export function xattachDebuggerProvidersFor(host: AttachHost): XAttachDebuggerProviderContribution[] {
  return xattachDebuggerProviderRegistry.all().filter(provider => {
    try { return provider.isAttachHostApplicable(host) } catch { return false }
  })
}

/** 注册一条附加调试器提供者。 */
export function registerXAttachDebuggerProvider(
  provider: XAttachDebuggerProviderContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return xattachDebuggerProviderRegistry.register(provider, { source: 'user', ...options })
}

// ── ⑥ 断点分组规则（`com.intellij.xdebugger.breakpointGroupingRule`） ────────────────────────

/** 一个断点分组（上游 `XBreakpointGroup` 的可移植子集：组名 + 图标名）。 */
export interface XBreakpointGroupLike {
  name: string
  icon?: string
}

/** 一条分组规则（上游 `XBreakpointGroupingRule` 的方法面）。 */
export interface XBreakpointGroupingRuleContribution {
  /** `XBreakpointGroupingRule.getId()`。 */
  id: string
  /** `getPresentableName()`。 */
  getPresentableName: () => string
  /** `getPriority()`（大的在前，照 `PRIORITY_COMPARATOR`）。 */
  getPriority?: () => number
  /** `isAlwaysEnabled()`（`:25-27`，缺省 false）。 */
  isAlwaysEnabled?: () => boolean
  /** `getGroup(breakpoint)`（本仓给断点的最小形状；返回 null = 这个断点不归它分组）。 */
  getGroup: (breakpoint: { id: string; path?: string; line?: number; groupName?: string }) => XBreakpointGroupLike | null
}

export const xbreakpointGroupingRuleRegistry =
  new EPExtensionRegistry<XBreakpointGroupingRuleContribution>(XBREAKPOINT_GROUPING_RULE_EP)

/** 全部分组规则（按 priority 降序，与上游 `PRIORITY_COMPARATOR` 同口径）。 */
export function xbreakpointGroupingRules(): XBreakpointGroupingRuleContribution[] {
  return xbreakpointGroupingRuleRegistry.all()
    .slice()
    .sort((left, right) => (right.getPriority?.() ?? 0) - (left.getPriority?.() ?? 0))
}

/** 注册一条断点分组规则。 */
export function registerXBreakpointGroupingRule(
  rule: XBreakpointGroupingRuleContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return xbreakpointGroupingRuleRegistry.register(rule, { source: 'user', ...options })
}

// ── ⑦ 调试器支持（`com.intellij.xdebugger.debuggerSupport`）────────────────────────────────
//
// 上游 `DebuggerSupport` 是**空且 @Deprecated** 的类（见上面常量旁的出处），所以这一条 EP 没有
// 方法面 —— 本仓如实收成一张身份表。插件按同一 EP id 挂自己的支持项，消费方 `debuggerSupports()`
// 按 id 取（`src/debugRowActions.ts` 的调试行动作可用性就是这条判定的真实消费点：一个支持项都
// 没注册时，调试动作一律禁用 —— 上游 `DebuggerActionHandler` 同样要求有一个 `DebuggerSupport`）。

/** 一条调试器支持（上游 `DebuggerSupport` 是空类 ⇒ 只有身份）。 */
export interface DebuggerSupportContribution {
  id: string
}

export const debuggerSupportRegistry = new EPExtensionRegistry<DebuggerSupportContribution>(XDEBUGGER_SUPPORT_EP)

/** 全部调试器支持（内建 dap + 第三方）。 */
export function debuggerSupports(): DebuggerSupportContribution[] {
  return debuggerSupportRegistry.all()
}

/** 有没有登记过至少一个调试器支持（调试动作可用性的总闸，上游 `DebuggerActionHandler` 同口径）。 */
export function hasDebuggerSupport(): boolean {
  return debuggerSupportRegistry.all().length > 0
}

/** 注册一条调试器支持。 */
export function registerDebuggerSupport(
  support: DebuggerSupportContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return debuggerSupportRegistry.register(support, { source: 'user', ...options })
}

/** 注册一条 bundled 调试器支持（内建的 DAP 支持在这里登记）。 */
export function registerBundledDebuggerSupport(support: DebuggerSupportContribution): ExtensionHandle {
  return registerDebuggerSupport(support, { source: 'bundled' })
}

// ── ⑧ 附加主机提供者（`com.intellij.xdebugger.attachHostProvider`）───────────────────────────
//
// 上游 `XAttachHostProvider.getAvailableHosts(project)` 列出一类可附加的**主机/环境**
// （本机 `LocalAttachHost`、SSH 远端…），`getPresentationGroup()` 给分组名。本仓只有本机通道
// （`exec/wsl`、`pf/remote` 判 `[-]`），bundled 一条 `Local`；真实消费点是
// `src/debugAttach.ts` 的 `attachHostSummary()`（附加提示里如实列出可用目标）。

/** 一个可附加的主机（上游 `XAttachHost` 的可移植子集：id + 档位 + 显示名）。 */
export interface AttachHostEntry {
  id: string
  host: AttachHost
  displayName: string
}

/** 一条附加主机提供者（上游 `XAttachHostProvider` 的方法面）。 */
export interface XAttachHostProviderContribution {
  id: string
  /** 上游 `getPresentationGroup()`（本仓给组名字符串，缺省 = 无分组）。 */
  getPresentationGroup?: () => string
  /** 上游 `getAvailableHosts(project)`（本仓给工作区根字符串，可空）。 */
  getAvailableHosts: (root: string | null) => readonly AttachHostEntry[]
}

export const xattachHostProviderRegistry = new EPExtensionRegistry<XAttachHostProviderContribution>(XATTACH_HOST_PROVIDER_EP)

/** 全部附加主机提供者。 */
export function xattachHostProviders(): XAttachHostProviderContribution[] {
  return xattachHostProviderRegistry.all()
}

/** 合计全部提供者列出的主机（上游 `getAvailableHosts` 的并集；坏提供者不吞别的主机）。 */
export function availableAttachHosts(root: string | null = null): AttachHostEntry[] {
  const out: AttachHostEntry[] = []
  for (const provider of xattachHostProviderRegistry.all()) {
    try { out.push(...provider.getAvailableHosts(root)) } catch { /* 容错 */ }
  }
  return out
}

/** 可用目标的显示名串（附加提示里那一句「可用目标：…」）。 */
export function attachHostSummary(root: string | null = null): string {
  const names = availableAttachHosts(root).map(host => host.displayName).filter(Boolean)
  return names.length ? names.join('、') : '（无）'
}

/** 注册一条附加主机提供者。 */
export function registerXAttachHostProvider(
  provider: XAttachHostProviderContribution, options: { source?: 'bundled' | 'user' } = {},
): ExtensionHandle {
  return xattachHostProviderRegistry.register(provider, { source: 'user', ...options })
}

/** 注册一条 bundled 附加主机提供者。 */
export function registerBundledXAttachHostProvider2(provider: XAttachHostProviderContribution): ExtensionHandle {
  return registerXAttachHostProvider(provider, { source: 'bundled' })
}

// ── bundled：把本仓在跑的那几支作为贡献登记进来（消费侧调用，重复调用只覆盖同 id） ──────────────

/** 注册一条 bundled 断点类型（内建 line/exception 在 `src/breakpointLocations.ts` / `src/exceptionBreakpoints.ts` 登记）。 */
export function registerBundledXBreakpointType(type: XBreakpointTypeContribution): ExtensionHandle {
  return registerXBreakpointType(type, { source: 'bundled' })
}

/** 注册一条 bundled 调试器设置（内建设置在 `src/debugSettingsStore.ts` 登记）。 */
export function registerBundledXDebuggerSettings(settings: XDebuggerSettingsContribution): ExtensionHandle {
  return registerXDebuggerSettings(settings, { source: 'bundled' })
}

/** 注册一条 bundled 附加提供者（内建 DAP 附加在 `src/debugAttach.ts` 登记）。 */
export function registerBundledXAttachDebuggerProvider(provider: XAttachDebuggerProviderContribution): ExtensionHandle {
  return registerXAttachDebuggerProvider(provider, { source: 'bundled' })
}

/** 注册一条 bundled 断点分组规则（内建的按文件分组在 `src/breakpointGroups.ts` 登记）。 */
export function registerBundledXBreakpointGroupingRule(rule: XBreakpointGroupingRuleContribution): ExtensionHandle {
  return registerXBreakpointGroupingRule(rule, { source: 'bundled' })
}

// bundled 自登记：本仓在跑的那几支（id/文案是本仓的，不冒充上游插件贡献）。
//   · 断点类型 line/exception —— `src/breakpointLocations.ts`（行断点）/`src/exceptionBreakpoints.ts`（异常断点）。
//   · 调试器设置 + 设置页提供者 —— `src/debugSettingsStore.ts`（「构建、执行、部署 › 调试器」那一页）。
//   · 文本值可视化 plainText —— `src/debugValueCopy.ts` 的值呈现。
//   · 附加提供者 dap —— `src/debugAttach.ts`（DAP 附加）。
//   · 断点分组规则 byFile —— `src/breakpointGroups.ts`（按文件分组）。
registerBundledXBreakpointType({
  id: 'line', getTitle: () => '行断点',
  isSuspendThreadSupported: () => true, isTemporaryBreakpointSupported: () => true, getDefaultSuspendPolicy: () => 'ALL',
})
registerBundledXBreakpointType({
  id: 'exception', getTitle: () => '异常断点',
  isSuspendThreadSupported: () => true, isTemporaryBreakpointSupported: () => false, getDefaultSuspendPolicy: () => 'ALL',
})
registerBundledXDebuggerSettings({
  id: 'taocode.debugger',
  createConfigurables: (category: DebuggerSettingsCategory) => (category === 'GENERAL' ? ['taocode.debugger.general'] : []),
})
registerDebuggerConfigurableProvider({
  id: 'taocode.debugger',
  getConfigurables: (category: DebuggerSettingsCategory) => (category === 'GENERAL' ? ['taocode.debugger.general'] : []),
}, { source: 'bundled' })
registerTextValueVisualizer({
  id: 'plainText',
  visualize: (value: string) => [{ name: '纯文本', id: 'plainText', content: value }],
  detectFileType: () => null,
}, { source: 'bundled' })
registerBundledXAttachDebuggerProvider({
  id: 'dap', isAttachHostApplicable: (host: AttachHost) => host === 'Local',
  getAvailableDebuggers: () => [{ id: 'dap', displayName: 'TaoCode DAP' }],
  getGroupName: () => 'DAP',
})
registerBundledXBreakpointGroupingRule({
  id: 'byFile', getPresentableName: () => '按文件', getPriority: () => 10,
  getGroup: breakpoint => (breakpoint.path ? { name: breakpoint.path } : null),
})

// epclose3 的两条 bundled（id/文案是本仓的，不冒充上游插件贡献）：
//   · 调试器支持 dap —— 本仓唯一后端是 DAP（`native/dap.cpp` + `src/bridge.ts` 的 dapState）。
//   · 附加主机 local —— 本仓只有本机通道（远程走适配器自己连，见 `src/debugAttach.ts`）。
registerBundledDebuggerSupport({ id: 'dap' })
registerBundledXAttachHostProvider2({
  id: 'taocode.local',
  getPresentationGroup: () => '本机',
  getAvailableHosts: () => [{ id: 'local', host: 'Local', displayName: '本机（Local）' }],
})
