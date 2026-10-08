// **文件编辑器与标签的扩展点**（上游 `platform/platform-impl` 的 `EditorEmptyStateComponentProvider` /
// `EditorFileSwapper` / `EditorCompositeProvider` 一族在本仓的等价物）。
//
// 上游是什么：编辑器这一族有三条 EP，id 逐字取自各处的 `ExtensionPointName`：
//   · `com.intellij.editorEmptyStateComponentProvider` ——
//     `EditorEmptyStateComponentProvider.kt:70` 的 `EP_NAME`，声明在
//     `platform/platform-impl/resources/intellij.platform.ide.impl.xml:148-150`；接口方法面
//     `getKind()`（`:16`，RICH/LIGHT）、`isAvailable(splitters)`（`:18`）、`isFullContent(splitters)`（`:20`）、
//     `createComponent(splitters)`（`:35`）、`claimsFocus(splitters)`（`:51`）—— 没有标签时编辑器区里
//     显示什么（欢迎页/空文本）。bundled 那一条是 `EditorEmptyTextComponentProvider`
//     （`:527` 以 `order="last"` 挂）。
//   · `com.intellij.editorFileSwapper` —— `FileEditorManagerImpl.kt:2223` 的 `EDITOR_FILE_SWAPPER_EP_NAME`，
//     声明在 `intellij.platform.ide.impl.xml:224`；接口方法面
//     `Pair<VirtualFile,Integer> getFileToSwapTo(Project, EditorComposite)`（`EditorFileSwapper.java:18`）
//     —— 在分割器里点「切换到对应文件」（如 .class ⇄ .java）。
//   · `com.intellij.editorCompositeProvider` —— `FileEditorManagerImpl.kt:495`，声明在
//     `intellij.platform.ide.impl.xml:226`；给一个 `EditorComposite` 的提供方（自定义标签页容器）。
//
// 本仓此前：标签与编辑器句柄在 `src/editorTab.ts`、两栏模型在 `src/editorGroups.ts`、分屏在
// `src/editorSplits.ts`、标签条在 `src/tabStripView.ts`，**没有插件 EP 宿主** —— 第三方无法按 id 挂
// 一个「空状态提供方」/「文件切换器」。本文件补上那一层：
//   · 三条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；
//   · 贡献形状 = 上游接口的**可移植子集**（本仓没有 Swing `JComponent`/`EditorsSplitters`/
//     `EditorComposite`，换成 `EditorSurroundings`（有没有标签、标签数、活动栏）与
//     `EmptyStateView`（令牌类 + 文本 + 焦点意图））；
//   · 本仓内建的「没有打开文件」空状态 **作为 bundled 贡献**以 `order="last"` 挂进
//     `editorEmptyStateComponentProvider`（对齐上游 `:527` 的 `order="last"`），使第三方挂的
//     更高优先级空状态能压过它、而它仍是兜底。
//
// 与上游的如实差异：① `getKind` 的 `RICH`/`LIGHT` 两档逐字保留；② `createComponent` 是 `suspend`
// 的，本仓同步（没有协程）；③ `EditorFileSwapper` 的返回 `Pair<VirtualFile,Integer>` 在本仓是
// `{ path, line }`（本仓 VirtualFile 用路径表示）；④ `EditorCompositeProvider` 的
// `EditorComposite`（Swing 容器）在本仓是「标签栏 + 句柄列表」的数据形状。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/file-editor-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 三条 EP 的 id（逐字取自上游各自的 `ExtensionPointName`，见文件头逐行出处）。 */
export const EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP = 'com.intellij.editorEmptyStateComponentProvider'
export const EDITOR_FILE_SWAPPER_EP = 'com.intellij.editorFileSwapper'
export const EDITOR_COMPOSITE_PROVIDER_EP = 'com.intellij.editorCompositeProvider'

/** 空状态档（上游 `EditorEmptyStateComponentProvider.Kind`，`:16` 两值逐字）。 */
export type EditorEmptyStateKind = 'RICH' | 'LIGHT'

/** 编辑器现在的处境（上游 `EditorsSplitters` 的可移植替代：标签情况 + 活动栏）。 */
export interface EditorSurroundings {
  /** 编辑器区里有没有打开的标签。 */
  hasTabs: boolean
  /** 标签数（`hasTabs` 为真时的更细一档）。 */
  tabCount: number
  /** 有几栏（分割器里有几条编辑器栏）。 */
  columnCount: number
  /** 活动栏的下标。 */
  activeColumn: number
}

/** 空状态视图（上游 `JComponent` 的可移植替代：令牌类 + 文本 + 焦点意图 + 是不是满内容）。 */
export interface EmptyStateView {
  /** 令牌类名（本仓不落 hex，交给样式表按令牌上色）。 */
  tokenClass: string
  /** 显示文本（可空：纯插画）。 */
  text?: string
  /** 是不是「整块内容」（上游 `isFullContent`，`:20`）。 */
  fullContent: boolean
  /** 该不该抢焦点（上游 `claimsFocus`，`:51`）。 */
  claimsFocus: boolean
}

/** 上游 `EditorEmptyStateComponentProvider`（`EditorEmptyStateComponentProvider.kt:15-61`）的可移植子集。 */
export interface EditorEmptyStateComponentProvider {
  id: string
  getKind?: () => EditorEmptyStateKind
  isAvailable?: (surroundings: EditorSurroundings) => boolean
  isFullContent?: (surroundings: EditorSurroundings) => boolean
  /** 造一块空状态（上游是 `suspend createComponent`，本仓同步；返回 null = 这一档管不了）。 */
  createComponent: (surroundings: EditorSurroundings) => EmptyStateView | null
  claimsFocus?: (surroundings: EditorSurroundings) => boolean
}

/** 上游 `EditorFileSwapper.getFileToSwapTo(Project, EditorComposite)` 的返回值（本仓用路径 + 行）。 */
export interface SwapTarget {
  path: string
  line: number | null
}

/** 上游 `EditorComposite` 的可移植替代：活动栏 + 该栏的标签路径。 */
export interface EditorCompositeLike {
  /** 活动栏下标。 */
  activeColumn: number
  /** 活动栏里的标签路径（顺序即标签顺序）。 */
  tabPaths: readonly string[]
}

/** 上游 `EditorFileSwapper`（`EditorFileSwapper.java:14-18`）的可移植子集。 */
export interface EditorFileSwapper {
  id: string
  /** 换到哪个文件（返回 null = 这一档不接手）。 */
  getFileToSwapTo: (composite: EditorCompositeLike) => SwapTarget | null
}

/** 上游 `EditorCompositeProvider`：给一条编辑器栏造一个自定义容器（本仓只保留「认不认领」+ 标识）。 */
export interface EditorCompositeProvider {
  id: string
  /** 认领这一栏吗（本仓没有 Swing 容器，`containerId` 是给宿主的标识）。 */
  accepts: (composite: EditorCompositeLike) => boolean
  containerId: string
}

/** 三条 EP 的声明（幂等）。 */
export function declareFileEditorExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, name: '编辑器空状态提供方', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: EDITOR_FILE_SWAPPER_EP, name: '编辑器文件切换器', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: EDITOR_COMPOSITE_PROVIDER_EP, name: '编辑器栏容器提供方', scope: APPLICATION_SCOPE, dynamic: true })
}

declareFileEditorExtensionPoints()

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, options)
}

export function registerEditorEmptyStateComponentProvider(value: EditorEmptyStateComponentProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, value, options)
}
export function registerEditorFileSwapper(value: EditorFileSwapper, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(EDITOR_FILE_SWAPPER_EP, value, options)
}
export function registerEditorCompositeProvider(value: EditorCompositeProvider, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return register(EDITOR_COMPOSITE_PROVIDER_EP, value, options)
}

/** 全部空状态提供方（顺序即 EP 顺序；`order="last"` 的兜底排最后）。 */
export function editorEmptyStateProviders(scope: string = APPLICATION_SCOPE): EditorEmptyStateComponentProvider[] {
  return EXTENSIONS.extensionsOf<EditorEmptyStateComponentProvider>(EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, scope)
}

/** 可用性判定（缺省可用，照上游 `isAvailable` 的缺省 `true`）。 */
function stateAvailable(provider: EditorEmptyStateComponentProvider, surroundings: EditorSurroundings): boolean {
  return provider.isAvailable ? provider.isAvailable(surroundings) : true
}

/**
 * 选中的空状态（上游 `FileEditorManagerImpl` 取第一个 `isAvailable` 的 provider 建组件）。
 * 返回 null = 没有提供方接手（调用方就不渲染空状态）。
 */
export function editorEmptyStateFor(
  surroundings: EditorSurroundings, scope: string = APPLICATION_SCOPE,
): { provider: EditorEmptyStateComponentProvider; view: EmptyStateView } | null {
  for (const provider of editorEmptyStateProviders(scope)) {
    if (!stateAvailable(provider, surroundings)) continue
    const view = provider.createComponent(surroundings)
    if (view) {
      const fullContent = provider.isFullContent ? provider.isFullContent(surroundings) : false
      const claimsFocus = provider.claimsFocus ? provider.claimsFocus(surroundings) : false
      return { provider, view: { ...view, fullContent, claimsFocus } }
    }
  }
  return null
}

/** 换文件目标（上游 `FileEditorManagerImpl` 取第一个给非空返回的 swapper）。 */
export function fileToSwapTo(
  composite: EditorCompositeLike, scope: string = APPLICATION_SCOPE,
): { swapper: EditorFileSwapper; target: SwapTarget } | null {
  for (const swapper of EXTENSIONS.extensionsOf<EditorFileSwapper>(EDITOR_FILE_SWAPPER_EP, scope)) {
    const target = swapper.getFileToSwapTo(composite)
    if (target) return { swapper, target }
  }
  return null
}

/** 认领这一栏的容器提供方（上游取第一个认领的；没认领返回 null）。 */
export function editorCompositeProviderFor(
  composite: EditorCompositeLike, scope: string = APPLICATION_SCOPE,
): EditorCompositeProvider | null {
  for (const provider of EXTENSIONS.extensionsOf<EditorCompositeProvider>(EDITOR_COMPOSITE_PROVIDER_EP, scope)) {
    if (provider.accepts(composite)) return provider
  }
  return null
}

/* ── bundled：本仓内建的兜底空状态（`EditorEmptyTextComponentProvider` 的等价物）────────────── */

export const BUILTIN_EMPTY_STATE_ID = 'taocode.editorEmptyState.builtin'
/** 上游 `EditorEmptyTextComponentProvider` 的 `getKind()` 是 `LIGHT`（编辑器区的浅提示）。 */
export const BUILTIN_EMPTY_STATE_TOKEN = 'editor-empty-state'

/**
 * 本仓内建的兜底空状态：没有打开文件时给一段提示。
 * 以 `order="last"` 挂（对齐上游 `intellij.platform.ide.impl.xml:527`），
 * 所以任何第三方提供的空状态都排在它前面。
 */
export function builtinEditorEmptyStateProvider(promptText: string): EditorEmptyStateComponentProvider {
  return {
    id: BUILTIN_EMPTY_STATE_ID,
    getKind: () => 'LIGHT',
    isAvailable: surroundings => !surroundings.hasTabs,
    isFullContent: () => false,
    createComponent: surroundings => surroundings.hasTabs
      ? null
      : { tokenClass: BUILTIN_EMPTY_STATE_TOKEN, text: promptText, fullContent: false, claimsFocus: false },
  }
}

/** 把内建兜底空状态以 `order="last"` 挂上（返回注销函数）。 */
export function registerBundledEditorEmptyState(promptText: string): () => void {
  const handle = registerEditorEmptyStateComponentProvider(builtinEditorEmptyStateProvider(promptText), {
    source: 'bundled', order: 'last',
  })
  return () => handle.dispose()
}
