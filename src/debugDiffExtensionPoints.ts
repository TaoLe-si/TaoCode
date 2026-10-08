// **调试 / 差异 / 变更列表三域的扩展点宿主接线** —— 把上游本来就是 EP 的那几族接口，按
// `src/extensionPoints.ts` 的 `EXTENSIONS` 宿主登记出来，给出与上游**同名的方法面**，
// 于是按上游接口写的第三方插件（原版 IDEA 插件）能原样挂进来，并在本仓被消费。
//
// 与 `src/daemonExtensionPoints.ts` / `src/ideViewExtensionPoints.ts` 同一形状：
// 「EP 声明 + 注册/注销 + 消费方从注册表取 + bundled 默认贡献者」。
//
// 上游依据（qualifiedName **逐字**取自各 plugin.xml 的 `<extensionPoint>` 声明；本文件不发明 id）：
//   · `com.intellij.xdebugger.breakpointType` ——
//     `platform/xdebugger-api/resources/intellij.platform.debugger.content.xml:10`
//     （`interface="com.intellij.xdebugger.breakpoints.XBreakpointType"` dynamic="true"）；
//     接口在 `platform/xdebugger-api/src/com/intellij/xdebugger/breakpoints/XBreakpointType.java:39`
//     （`EXTENSION_POINT_NAME`）；方法面 `getId()`（`:96`）/ `getTitle()`（`:100`）/
//     `isSuspendThreadSupported()`（`:68`）/ `isTemporaryBreakpointSupported()`（`:75`）/
//     `getDefaultSuspendPolicy()`（`:79`）。行断点走它的子类 `XLineBreakpointType`，**同一个 EP**。
//   · `com.intellij.diff.DiffTool` —— `platform/diff-api/resources/intellij.platform.diff.xml:17`；
//     接口 `platform/diff-api/src/com/intellij/diff/DiffTool.java:19`
//     （`EP_NAME`）；方法面 `getName()`（`:24`）/ `canShow(DiffContext, DiffRequest)`（`:26`）。
//   · `com.intellij.diff.merge.MergeTool` —— 同 xml `:19`；接口
//     `platform/diff-api/src/com/intellij/diff/merge/MergeTool.kt`（`canShow(MergeContext, MergeRequest)` /
//     `createComponent(MergeContext, MergeRequest)` + 内部 `MergeViewer`）。
//   · `com.intellij.diff.DiffExtension` —— 同 xml `:21`；接口
//     `platform/diff-api/src/com/intellij/diff/DiffExtension.java`（`onViewerCreated(viewer, context, request)`）。
//   · `com.intellij.vcs.changeListDecorator` —— `platform/vcs-api/shared/src/com/intellij/openapi/vcs/changes/ChangeListDecorator.java:16`
//     （`ProjectExtensionPointName`，**项目级**）；方法面
//     `decorateChangeList(LocalChangeList, ColoredTreeCellRenderer, selected, expanded, hasFocus)`。
//
// 如实边界（**不发明上游没有的东西**）：
//   · 上游 **没有** `XDebuggerExtension` 这个类/EP（本参考树里整树 grep 零命中，见本批报告）；
//     调试器扩展面就是上面那几个真实 EP。任务书里那个名字按"调试域扩展"理解，落到
//     `breakpointType` 这条真 EP 上。
//   · 上游 **没有** `VcsAnnotationProvider` 这个 EP —— `AnnotationProvider`
//     （`platform/vcs-api/src/com/intellij/openapi/vcs/annotate/AnnotationProvider.java:15`）
//     是**每个 VCS 一个**、由 `AbstractVcs.getAnnotationProvider()` 现取（`AbstractVcs.java`），
//     不是插件 EP。本仓没有多 VCS 后端 ⇒ 不登记假 EP（如实记在这条）。
//   · `createComponent()` 返回的是 Swing `JComponent`；本仓是 Vue/DOM，没有 Swing 树 ⇒ 这一格
//     收成 `unknown`（查看器描述），插件仍可挂 `canShow` 参与选择 —— 方法名逐字保留。
//
// 纯数据层：只 import `src/extensionPoints.ts`（不 import vue/DOM/bridge），`node --test` 直测。
//
// 判据：`tests/debug-diff-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 五条 EP 的 id（逐字取自上游 qualifiedName，见文件头）。 */
export const DEBUG_BREAKPOINT_TYPE_EP = 'com.intellij.xdebugger.breakpointType'
export const DIFF_TOOL_EP = 'com.intellij.diff.DiffTool'
export const MERGE_TOOL_EP = 'com.intellij.diff.merge.MergeTool'
export const DIFF_EXTENSION_EP = 'com.intellij.diff.DiffExtension'
export const CHANGE_LIST_DECORATOR_EP = 'com.intellij.vcs.changeListDecorator'

// ── 调试：断点类型（`XBreakpointType`）──────────────────────────────────────────

/** 上游 `XBreakpointType.SuspendPolicy`（`ALL` / `NONE` / `THREAD`）。 */
export type SuspendPolicy = 'ALL' | 'NONE' | 'THREAD'

/**
 * 一个断点类型（`XBreakpointType` 的可移植子集，方法名与上游逐字相同）。
 * 行断点与异常断点都挂在这条 EP 下（上游同此：`XLineBreakpointType` 也是 `XBreakpointType`）。
 */
export interface XBreakpointTypeContribution {
  /** 贡献 id（本仓注册身份）。 */
  id: string
  /** `XBreakpointType.getId()` —— 断点类型 id（会话内唯一，与 DAP 断点声明对照）。 */
  getId: () => string
  /** `XBreakpointType.getTitle()` —— 断点对话框里那一栏的标题。 */
  getTitle: () => string
  /** `isSuspendThreadSupported()`（缺省 false，照上游 `:68` 的字段默认）。 */
  isSuspendThreadSupported?: () => boolean
  /** `isTemporaryBreakpointSupported()`（上游缺省 false，`:75`）。 */
  isTemporaryBreakpointSupported?: () => boolean
  /** `getDefaultSuspendPolicy()`（上游缺省 `ALL`，`:79`）。 */
  getDefaultSuspendPolicy?: () => SuspendPolicy
}

// ── 差异：工具与查看器扩展（`DiffTool` / `MergeTool` / `DiffExtension`）──────────

/** 上游 `DiffContext` 的最小面（本仓没有 Swing 上下文/项目对象，按可判定的字段给）。 */
export interface DiffContextLike {
  /** 这一对内容来自哪个路径（工作区相对）。 */
  path?: string
  /** 项目根（工作区），供插件按项目分流。 */
  projectRoot?: string
  /** 是不是已暂存那一侧（`git diff --cached`）。 */
  staged?: boolean
  /** 比较基线（分支/修订），没有就是与工作区比。 */
  base?: string
}

/** 上游 `DiffRequest` 的最小面（标题 + 两/三份内容 + 二进制位）。 */
export interface DiffRequestLike {
  title?: string
  /** 参与比较的内容（左右两栏或三栏）。 */
  contents?: readonly string[]
  /** 二进制（上游按 `FileType.isBinary`；本仓由调用方判好传进来）。 */
  binary?: boolean
}

/** 一条差异工具（`DiffTool` 的方法面）。 */
export interface DiffToolContribution {
  id: string
  /** `DiffTool.getName()`。 */
  getName: () => string
  /** `DiffTool.canShow(context, request)` —— 这个工具能不能显示这一对内容。 */
  canShow: (context: DiffContextLike, request: DiffRequestLike) => boolean
}

/** 上游 `MergeRequest` 的最小面。 */
export interface MergeRequestLike {
  path?: string
  title?: string
}

/** 一条合并工具（`MergeTool` 的方法面）。 */
export interface MergeToolContribution {
  id: string
  /** `MergeTool.canShow(context, request)`。 */
  canShow: (context: DiffContextLike, request: MergeRequestLike) => boolean
  /** `MergeTool.createComponent(context, request)` —— 本仓收成"创建查看器"的描述（Swing 面收成 unknown）。 */
  createComponent?: (context: DiffContextLike, request: MergeRequestLike) => unknown
}

/** 上游 `DiffViewer` 的最小面（`DiffExtension.onViewerCreated` 的入参）。 */
export interface DiffViewerLike {
  path?: string
  /** 查看器种类（本仓给一个字符串标记，替代 Swing 类名）。 */
  viewerKind?: string
}

/** 一条查看器扩展（`DiffExtension` 的方法面）。 */
export interface DiffExtensionContribution {
  id: string
  /** `DiffExtension.onViewerCreated(viewer, context, request)`。 */
  onViewerCreated: (viewer: DiffViewerLike, context: DiffContextLike, request: DiffRequestLike) => void
}

// ── 变更列表：装饰器（`ChangeListDecorator`）──────────────────────────────────

/** 上游 `LocalChangeList` 的最小面。 */
export interface ChangeListLike {
  id: string
  name: string
  comment?: string
  isDefault?: boolean
  changeCount?: number
}

/**
 * 上游 `ColoredTreeCellRenderer` 的可移植面：装饰器就地改这几格（本仓渲染层再把它涂出来）。
 * 与上游一样是**就地改**（`cellRenderer.append(...)` / `setIcon`），不是返回新对象。
 */
export interface ColoredCellLike {
  text: string
  /** 图标名（本仓的矢量图标键；不是 Swing `Icon`）。 */
  icon?: string
  /** 附加属性（颜色/加粗等），渲染层按它涂。 */
  attributes?: Record<string, unknown>
}

/** 一条变更列表装饰器（`ChangeListDecorator.decorateChangeList` 的方法面）。 */
export interface ChangeListDecoratorContribution {
  id: string
  decorateChangeList: (
    changeList: ChangeListLike, cell: ColoredCellLike, selected: boolean, expanded: boolean, hasFocus: boolean,
  ) => void
}

// ── EP 声明（幂等）────────────────────────────────────────────────────────────

/** 声明五条 EP（重复调用只覆盖同名声明，与宿主同口径）。 */
export function declareDebugDiffExtensionPoints(): void {
  for (const [id, name] of [
    [DEBUG_BREAKPOINT_TYPE_EP, '断点类型'],
    [DIFF_TOOL_EP, '差异工具'],
    [MERGE_TOOL_EP, '合并工具'],
    [DIFF_EXTENSION_EP, '差异查看器扩展'],
    [CHANGE_LIST_DECORATOR_EP, '变更列表装饰器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareDebugDiffExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与宿主同口径）。 */
export function registerDebugDiffExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterDebugDiffExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

// ── 消费面 ────────────────────────────────────────────────────────────────────

/** `XBreakpointType.EXTENSION_POINT_NAME.getExtensions()` 的等价物。 */
export function breakpointTypes(scope: string = APPLICATION_SCOPE): XBreakpointTypeContribution[] {
  return EXTENSIONS.extensionsOf<XBreakpointTypeContribution>(DEBUG_BREAKPOINT_TYPE_EP, scope)
}

/** 按断点类型 id 取一条（`getId()` 是会话内身份，不是注册 id）。 */
export function findBreakpointType(typeId: string, scope: string = APPLICATION_SCOPE): XBreakpointTypeContribution | undefined {
  return breakpointTypes(scope).find(type => safeCall(() => type.getId()) === typeId)
}

/** `DiffTool.EP_NAME.getExtensions()` 的等价物。 */
export function diffTools(scope: string = APPLICATION_SCOPE): DiffToolContribution[] {
  return EXTENSIONS.extensionsOf<DiffToolContribution>(DIFF_TOOL_EP, scope)
}

/** 一条工具能不能显示这一对内容（插件抛错 = 不能显示，**不拖垮**其余工具，与 `daemonExtensionPoints` 同口径）。 */
export function canShowDiffTool(
  tool: DiffToolContribution, context: DiffContextLike, request: DiffRequestLike,
): boolean {
  return safeCall(() => tool.canShow(context, request)) === true
}

/**
 * 挑第一支能显示这一对内容的差异工具（按宿主排序：插件 `order="first"` 先赢）。
 * 一支都没有（全部插件都不认）时返回 `null`，调用方回落到本仓内建渲染器。
 */
export function firstDiffToolFor(context: DiffContextLike, request: DiffRequestLike, scope: string = APPLICATION_SCOPE): DiffToolContribution | null {
  for (const tool of diffTools(scope)) if (canShowDiffTool(tool, context, request)) return tool
  return null
}

/** `MergeTool` 那一批。 */
export function mergeTools(scope: string = APPLICATION_SCOPE): MergeToolContribution[] {
  return EXTENSIONS.extensionsOf<MergeToolContribution>(MERGE_TOOL_EP, scope)
}

/** 挑第一支能处理的合并工具（语义同 `firstDiffToolFor`）。 */
export function firstMergeToolFor(context: DiffContextLike, request: MergeRequestLike, scope: string = APPLICATION_SCOPE): MergeToolContribution | null {
  for (const tool of mergeTools(scope)) if (safeCall(() => tool.canShow(context, request)) === true) return tool
  return null
}

/** `DiffExtension` 那一批。 */
export function diffExtensions(scope: string = APPLICATION_SCOPE): DiffExtensionContribution[] {
  return EXTENSIONS.extensionsOf<DiffExtensionContribution>(DIFF_EXTENSION_EP, scope)
}

/** 查看器创建后逐个通知（插件抛错吞掉，不影响其余扩展与查看器本身）。 */
export function applyDiffExtensions(
  viewer: DiffViewerLike, context: DiffContextLike, request: DiffRequestLike, scope: string = APPLICATION_SCOPE,
): void {
  for (const extension of diffExtensions(scope)) safeCall(() => extension.onViewerCreated(viewer, context, request))
}

/** `ChangeListDecorator` 那一批（上游是项目级 EP，本仓按 scope 参数区分，缺省 application）。 */
export function changeListDecorators(scope: string = APPLICATION_SCOPE): ChangeListDecoratorContribution[] {
  return EXTENSIONS.extensionsOf<ChangeListDecoratorContribution>(CHANGE_LIST_DECORATOR_EP, scope)
}

/**
 * 把一个变更列表行交给全部装饰器就地改（上游 `ChangeListDecorator.getDecorators(project)` +
 * 渲染器逐个 `decorateChangeList`）。返回改过的 `cell`（同一个对象，便于调用方直接渲染）。
 */
export function decorateChangeListRow(
  changeList: ChangeListLike, cell: ColoredCellLike, selected: boolean, expanded: boolean, hasFocus: boolean,
  scope: string = APPLICATION_SCOPE,
): ColoredCellLike {
  for (const decorator of changeListDecorators(scope)) {
    safeCall(() => decorator.decorateChangeList(changeList, cell, selected, expanded, hasFocus))
  }
  return cell
}

/** 读一个贡献方法：抛错当"没有/不认"（第三方坏实现不该让整个视图炸掉）。 */
function safeCall<T>(read: () => T): T | undefined {
  try { return read() } catch { return undefined }
}

// ── bundled：把本仓在跑的那几支作为默认贡献登记进来（消费侧调用，重复调用只覆盖同 id）──────

/** 本仓内建的行断点类型 id（`DebugBreakpointsPane` / DAP `setBreakpoints` 用同一份清单）。 */
export const BUNDLED_LINE_BREAKPOINT_ID = 'dap-line'
/** 本仓内建的并排差异查看器 id（`DiffView.vue`）。 */
export const BUNDLED_DIFF_VIEW_ID = 'taocode.diffView'
/** 本仓内建的三方合并编辑器 id（`MergeEditor.vue`）。 */
export const BUNDLED_MERGE_EDITOR_ID = 'taocode.mergeEditor'

export function registerBundledBreakpointType(
  contribution: XBreakpointTypeContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDebugDiffExtension(DEBUG_BREAKPOINT_TYPE_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

export function registerBundledDiffTool(
  contribution: DiffToolContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDebugDiffExtension(DIFF_TOOL_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

export function registerBundledMergeTool(
  contribution: MergeToolContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDebugDiffExtension(MERGE_TOOL_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

export function registerBundledChangeListDecorator(
  contribution: ChangeListDecoratorContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerDebugDiffExtension(CHANGE_LIST_DECORATOR_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/**
 * 登记本仓在跑的那几支默认贡献（幂等：同 id 覆盖）。
 * 内建差异/合并查看器与行断点都**如实**出现在 EP 里 —— 插件按 `order="first"` 即可覆盖它们。
 */
export function registerBundledDebugDiffDefaults(): void {
  registerBundledBreakpointType({
    id: BUNDLED_LINE_BREAKPOINT_ID,
    getId: () => BUNDLED_LINE_BREAKPOINT_ID,
    getTitle: () => '行断点',
    // DAP 的断点下没有"只挂起一个线程"这条位（`stopped.allThreadsStopped` 是会话级）⇒ 如实 false。
    isSuspendThreadSupported: () => false,
    isTemporaryBreakpointSupported: () => true,
    getDefaultSuspendPolicy: () => 'ALL',
  })
  registerBundledDiffTool({
    id: BUNDLED_DIFF_VIEW_ID,
    getName: () => '并排差异',
    // 文本两/三栏都能画；二进制没有本仓渲染器（交给插件的工具认领）。
    canShow: (_context, request) => request.binary !== true,
  })
  registerBundledMergeTool({
    id: BUNDLED_MERGE_EDITOR_ID,
    canShow: () => true,
  })
}

registerBundledDebugDiffDefaults()
