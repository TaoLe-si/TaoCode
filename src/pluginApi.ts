// **插件 API 面（upstream-named API face）** —— 本 lane 的收口件：把已经还原的能力全部做成
// **与上游同名**的扩展点 / 服务面，目标是「原版 IDEA 能跑的插件在我们的 IDE 上也能挂上并跑」。
//
// 三条判据（本文件与 `tests/plugin-api.test.mjs` 一起钉住）：
//   ① **bundled 默认贡献者仍在**：本仓随包发货的窗格 / 大文件编辑器 / 四个服务仍注册在表里；
//   ② **第三方按 id 注册后能被消费**：按同一 EP id 挂一条贡献，既有消费端（`serviceOf` /
//      `editorProviderFor` / `availableProjectViewPanes` / `projectViewPanes`）看得到；
//   ③ **EP id 与上游逐字一致**：`UPSTREAM_EXTENSION_POINTS` 把每条 id 连同上游 `plugin.xml`
//      的出处（文件:行）登记下来，`assertUpstreamExtensionPointIds()` 在运行期做一致性自检，
//      测试再拿**上游字面量**逐条断言（id 写错一个字符，插件就挂不上，这不是风格问题是功能问题）。
//
// ── EP id 的来处（逐字取自上游 `<extensionPoint qualifiedName="…">`）────────────────────────
//   本文件把各域的 EP 常量聚到一处，出处写在 `UPSTREAM_EXTENSION_POINTS` 每一行上；声明仍分在
//   各自域（`src/extensionPoints.ts` / `src/ideViewExtensionPoints.ts`），避免重复声明同一条。
//
// ── 服务面（`com.intellij.service`）──────────────────────────────────────────────────────────
//   上游按 FQN 取服务（`ApplicationManager.getService(Class)`）。`src/pluginServices.ts` 已暴露
//   `HttpVirtualFileSystem` / `RemoteFileManager` / `FileEditorManager`(+Listener) /
//   `ShelveChangesManager`(+Listener) / `JavaPsiFacade`(+PsiManager)。本文件再补四样（协调者点名的
//   那几格，按**参考树里的真名**暴露）：
//     · `com.intellij.platform.recentFiles.shared.FileSwitcherApi` —— 最近文件/切换器那一档，
//       映射到 `src/switcher.ts`（纯模型）—— 上游它是 `@Rpc` 接口，本仓单进程，按同步方法暴露；
//     · `com.intellij.openapi.fileEditor.impl.EditorWindow` —— 多窗口/浮层编辑器
//       （上游 `EditorWindow` 是抽象类，不是 `@Service`；协调者点名的 `EditorWindowService`
//       在参考树里**不存在**，已 grep 确认），映射到 `src/editorWindows.ts`；
//     · `com.intellij.openapi.vcs.changes.savedPatches.SavedPatchesProvider`（含 `ShelfProvider`
//       实现）—— 搁架的补丁列表与 apply/pop 两个动作，映射到 `src/shelfTree.ts`；
//     · `com.intellij.ide.projectView.ProjectView` —— 项目视图的多窗格（`getPanes`），
//       映射到 `src/projectViewPanes.ts` + `src/ideViewExtensionPoints.ts` 的 `PROJECT_VIEW_PANE_EP`。
//
// 判据：`tests/plugin-api.test.mjs`。

import {
  ACTION_EP, ANNOTATOR_EP, APPLICATION_SCOPE, COMPLETION_CONTRIBUTOR_EP, EXTENSIONS,
  FILE_EDITOR_MANAGER_LISTENER_EP, FILE_EDITOR_PROVIDER_EP, FILE_EDITOR_PROVIDER_SUPPRESSOR_EP,
  INLAY_PROVIDER_EP, SERVICE_EP, SHELVE_CHANGES_MANAGER_LISTENER_EP,
  declareBundledExtensionPoints, type ExtensionHandle, type RegisterExtensionOptions,
} from './extensionPoints.ts'
import {
  createPluginServices, pluginServiceCatalog, registerPluginServices, SHELF_POP_ACTION_ID,
  type PluginService, type PluginServiceCatalogEntry, type PluginServiceDeps,
} from './pluginServices.ts'
import {
  NOTIFICATION_GROUP_EP, PROJECT_VIEW_PANE_EP, STRUCTURE_VIEW_BUILDER_EP, TODO_INDEXER_EP,
  UNDO_PROVIDER_EP, availableProjectViewPanes, projectViewPanes,
} from './ideViewExtensionPoints.ts'
import {
  fileEditorProviderCatalog, editorProviderFor, fileEditorProviders,
  type FileEditorProviderContribution, type FileEditorProviderInput,
} from './fileEditorProviders.ts'
import { projectViewPaneChoices, type ProjectViewPaneChoice } from './projectViewPanes.ts'
import {
  collectSwitcherItems, filterSwitcherItems, initialSwitcherIndex,
  type SwitcherItem, type SwitcherItemList, type SwitcherSources,
} from './switcher.ts'
import {
  canDetachEditor, detachTab, detachedWindowUrl, reattachTab,
  type DetachedEditor, type DetachedWindowCapability,
} from './editorWindows.ts'
import { shelfRows, type ShelfRow } from './shelfTree.ts'
import type { GitStashEntry } from './vcsLogTypes.ts'
import {
  AUTOMATIC_RENAMER_FACTORY_EP, NAME_SUGGESTION_PROVIDER_EP, QUALIFIED_NAME_PROVIDER_EP,
  REFACTORING_HELPER_EP, RENAME_HANDLER_EP, RENAME_INPUT_VALIDATOR_EP,
  VETO_RENAME_CONDITION_EP, VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP,
  declareRefactorRenameExtensionPoints,
} from './refactorRenameExtensionPoints.ts'
import {
  DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, DOC_TOOL_WINDOW_MANAGER_EP,
  DOCUMENTATION_ACTION_PROVIDER_EP, DOCUMENTATION_CSS_PROVIDER_EP,
  declareDocumentationExtensionPoints,
} from './documentationExtensionPoints.ts'
import {
  EDITOR_COMPOSITE_PROVIDER_EP, EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, EDITOR_FILE_SWAPPER_EP,
  declareFileEditorExtensionPoints,
} from './fileEditorExtensionPoints.ts'
import {
  INLINE_COMPLETION_PROVIDER_EP, INLINE_PARTIAL_ACCEPT_HANDLER_EP, INLINE_SUPPRESS_STATE_SUPPLIER_EP,
  declareInlineCompletionExtensionPoints,
} from './inlineCompletionExtensionPoints.ts'
import {
  SE_ITEMS_PROVIDER_FACTORY_EP, SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP,
  SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, SE_TARGET_PRESENTATION_PROVIDER_EP,
  declareSearchEverywhereExtensionPoints,
} from './searchEverywhereExtensionPoints.ts'
import {
  ERROR_OPTIONS_PROVIDER_EP, PRINT_OPTION_EP, declareInspectionPrintingExtensionPoints,
} from './inspectionPrintingExtensionPoints.ts'
import {
  CHECKIN_HANDLER_FACTORY_EP, LOCAL_COMMIT_EXECUTOR_EP, VCS_CHECKIN_HANDLER_FACTORY_EP,
} from './checkinHandlers.ts'
import {
  BREADCRUMBS_INFO_PROVIDER_EP, declareBreadcrumbsExtensionPoints,
} from './breadcrumbsExtensionPoints.ts'
// daemon 域的十三条上游同名 EP（`com.intellij.highlightVisitor` / `localInspection` /
// `inspectionToolProvider` / `intentionAction` / `errorQuickFixProvider` / `problemHighlightFilter` /
// `problemsProvider` / `inspectionElementsMerger` / `daemon.changeLocalityDetector` /
// `problemsViewPanelProvider` / `problemsViewHighlightingProblemFactory` /
// `frontendProblemsViewContentProvider` / `problemsViewBridge`）。
// **这条 import 是补的**（2026-10-07）：此前 `installPluginApi()` 不声明 daemon 域任何一条 EP ——
// 插件宿主按插件 API 面装配（`installPluginApi()` 就是那条路）时，这十三条一条都不在
// `EXTENSIONS.extensionPointIds()` 里，第三方按 id 挂过来直接 `UnknownExtensionPointError`。
// 它们此前只被 App.vue 的消费链（`src/problems.ts` / `src/inspectionIdentity.ts`）间接带进来，
// 那是「碰巧」而不是保证。声明调用放在下面 `installPluginApi()` 里，与其余七个域的
// `declareXxxExtensionPoints()` 并排。
import { declareDaemonExtensionPoints } from './daemonExtensionPoints.ts'

// ── EP id 出处表（上游文件:行；id 一律逐字）──────────────────────────────────────────────────

export interface UpstreamExtensionPointRef {
  /** EP 的 qualifiedName（逐字）。 */
  id: string
  /** 上游声明它的文件（参考树路径）。 */
  upstreamFile: string
  /** 上游声明它的行号。 */
  upstreamLine: number
  /** 这一条在本仓的消费端（写清落点，便于"挂了没生效"排查）。 */
  consumer: string
}

/**
 * 本仓已声明、且 id 必须与上游逐字一致的 EP 清单。
 * 行号是参考树当前的行号（`intellij-community-master`）；文件漂了不影响 id 的字面断言。
 */
export const UPSTREAM_EXTENSION_POINTS: readonly UpstreamExtensionPointRef[] = [
  { id: COMPLETION_CONTRIBUTOR_EP, upstreamFile: 'platform/analysis-api/resources/intellij.platform.analysis.xml', upstreamLine: 75, consumer: 'src/completionContributors.ts' },
  { id: INLAY_PROVIDER_EP, upstreamFile: 'platform/lang-api/resources/intellij.platform.lang.xml', upstreamLine: 54, consumer: 'src/inlayProviderRegistry.ts' },
  { id: ANNOTATOR_EP, upstreamFile: 'platform/lang-api/resources/intellij.platform.lang.xml', upstreamLine: 31, consumer: 'src/annotatorRegistry.ts' },
  { id: ACTION_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 1, consumer: 'src/actionRegistry.ts（`<actions>` 块的等价面）' },
  { id: FILE_EDITOR_PROVIDER_EP, upstreamFile: 'platform/analysis-api/resources/intellij.platform.analysis.xml', upstreamLine: 17, consumer: 'src/fileEditorProviders.ts' },
  { id: FILE_EDITOR_PROVIDER_SUPPRESSOR_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 187, consumer: 'src/fileEditorProviders.ts' },
  { id: FILE_EDITOR_MANAGER_LISTENER_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 1, consumer: 'src/pluginServices.ts（FileEditorManager 订阅）' },
  { id: SHELVE_CHANGES_MANAGER_LISTENER_EP, upstreamFile: 'platform/vcs-impl/resources/META-INF/VcsExtensions.xml', upstreamLine: 1, consumer: 'src/pluginServices.ts（ShelveChangesManager 订阅）' },
  { id: PROJECT_VIEW_PANE_EP, upstreamFile: 'platform/lang-impl/resources/intellij.platform.lang.impl.xml', upstreamLine: 314, consumer: 'src/projectViewPanes.ts' },
  { id: TODO_INDEXER_EP, upstreamFile: 'platform/core-api/resources/intellij.platform.core.xml', upstreamLine: 69, consumer: 'src/ideViewExtensionPoints.ts' },
  { id: STRUCTURE_VIEW_BUILDER_EP, upstreamFile: 'platform/editor-ui-api/resources/intellij.platform.editor.ui.xml', upstreamLine: 44, consumer: 'src/ideViewExtensionPoints.ts' },
  { id: NOTIFICATION_GROUP_EP, upstreamFile: 'platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml', upstreamLine: 27, consumer: 'src/notificationGroups.ts' },
  { id: UNDO_PROVIDER_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 197, consumer: 'src/pvFileUndoProvider.ts' },
  // 重命名/重构一族（2026-10-06 platform_rest 剩余族收口 lane）：id 逐字取自各类的
  // `ExtensionPointName.create`，声明在 `src/refactorRenameExtensionPoints.ts`，消费端同上文件。
  { id: RENAME_INPUT_VALIDATOR_EP, upstreamFile: 'platform/refactoring/src/com/intellij/refactoring/rename/RenameInputValidator.java', upstreamLine: 19, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: NAME_SUGGESTION_PROVIDER_EP, upstreamFile: 'platform/refactoring/src/com/intellij/refactoring/rename/NameSuggestionProvider.java', upstreamLine: 17, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: RENAME_HANDLER_EP, upstreamFile: 'platform/refactoring/src/com/intellij/refactoring/rename/RenameHandler.java', upstreamLine: 13, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: VETO_RENAME_CONDITION_EP, upstreamFile: 'platform/refactoring/resources/intellij.platform.refactoring.xml', upstreamLine: 40, consumer: 'src/refactorRenameExtensionPoints.ts（限定名见 PsiElementRenameHandler.java:49）' },
  { id: AUTOMATIC_RENAMER_FACTORY_EP, upstreamFile: 'platform/refactoring/src/com/intellij/refactoring/rename/naming/AutomaticRenamerFactory.java', upstreamLine: 19, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: REFACTORING_HELPER_EP, upstreamFile: 'platform/refactoring/src/com/intellij/refactoring/RefactoringHelper.java', upstreamLine: 18, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: QUALIFIED_NAME_PROVIDER_EP, upstreamFile: 'platform/refactoring/src/com/intellij/ide/actions/QualifiedNameProvider.java', upstreamLine: 15, consumer: 'src/refactorRenameExtensionPoints.ts' },
  { id: VIRTUAL_FILE_QUALIFIED_NAME_PROVIDER_EP, upstreamFile: 'platform/refactoring/src/com/intellij/ide/actions/VirtualFileQualifiedNameProvider.java', upstreamLine: 14, consumer: 'src/refactorRenameExtensionPoints.ts' },
  // 快速文档一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在 `src/documentationExtensionPoints.ts`。
  { id: DOCUMENTATION_ACTION_PROVIDER_EP, upstreamFile: 'platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationActionProvider.java', upstreamLine: 13, consumer: 'src/documentationExtensionPoints.ts' },
  { id: DOCUMENTATION_CSS_PROVIDER_EP, upstreamFile: 'platform/lang-impl/src/com/intellij/codeInsight/documentation/DocumentationCssProvider.java', upstreamLine: 12, consumer: 'src/documentationExtensionPoints.ts' },
  { id: DOC_TOOL_WINDOW_MANAGER_EP, upstreamFile: 'platform/lang-impl/src/com/intellij/codeInsight/documentation/DocToolWindowManager.java', upstreamLine: 48, consumer: 'src/documentationExtensionPoints.ts' },
  { id: DOC_RENDER_ITEM_UPDATE_PROVIDER_EP, upstreamFile: 'platform/lang-impl/src/com/intellij/codeInsight/documentation/render/DocRenderItemUpdateProvider.kt', upstreamLine: 13, consumer: 'src/documentationExtensionPoints.ts' },
  // 文件编辑器一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在 `src/fileEditorExtensionPoints.ts`。
  { id: EDITOR_EMPTY_STATE_COMPONENT_PROVIDER_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 148, consumer: 'src/fileEditorExtensionPoints.ts（限定名见 EditorEmptyStateComponentProvider.kt:70）' },
  { id: EDITOR_FILE_SWAPPER_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 224, consumer: 'src/fileEditorExtensionPoints.ts（限定名见 FileEditorManagerImpl.kt:2223）' },
  { id: EDITOR_COMPOSITE_PROVIDER_EP, upstreamFile: 'platform/platform-impl/resources/intellij.platform.ide.impl.xml', upstreamLine: 226, consumer: 'src/fileEditorExtensionPoints.ts（限定名见 FileEditorManagerImpl.kt:495）' },
  // 行内补全一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在 `src/inlineCompletionExtensionPoints.ts`。
  { id: INLINE_COMPLETION_PROVIDER_EP, upstreamFile: 'platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/InlineCompletionProvider.kt', upstreamLine: 121, consumer: 'src/inlineCompletionExtensionPoints.ts' },
  { id: INLINE_PARTIAL_ACCEPT_HANDLER_EP, upstreamFile: 'platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/suggestion/InlineCompletionPartialAcceptHandler.kt', upstreamLine: 35, consumer: 'src/inlineCompletionExtensionPoints.ts' },
  { id: INLINE_SUPPRESS_STATE_SUPPLIER_EP, upstreamFile: 'platform/platform-impl/codeinsight-inline/src/com/intellij/codeInsight/inline/completion/suppress/InlineCompletionSuppressStateSupplier.kt', upstreamLine: 19, consumer: 'src/inlineCompletionExtensionPoints.ts' },
  // Search Everywhere 一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在
  // `src/searchEverywhereExtensionPoints.ts`（相对名 + defaultExtensionNs 前缀展开）。
  { id: SE_ITEMS_PROVIDER_FACTORY_EP, upstreamFile: 'platform/searchEverywhere/shared/resources/intellij.platform.searchEverywhere.xml', upstreamLine: 37, consumer: 'src/searchEverywhereExtensionPoints.ts（限定名见 SeItemsProviderFactory.kt:25）' },
  { id: SE_LEGACY_ITEM_PRESENTATION_PROVIDER_EP, upstreamFile: 'platform/searchEverywhere/shared/resources/intellij.platform.searchEverywhere.xml', upstreamLine: 41, consumer: 'src/searchEverywhereExtensionPoints.ts' },
  { id: SE_TARGET_PRESENTATION_PROVIDER_EP, upstreamFile: 'platform/searchEverywhere/shared/resources/intellij.platform.searchEverywhere.xml', upstreamLine: 45, consumer: 'src/searchEverywhereExtensionPoints.ts' },
  { id: SE_TARGET_ITEM_SELECTION_PROCESSOR_EP, upstreamFile: 'platform/searchEverywhere/shared/resources/intellij.platform.searchEverywhere.xml', upstreamLine: 49, consumer: 'src/searchEverywhereExtensionPoints.ts' },
  // 检查与打印/HTML 导出一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在
  // `src/inspectionPrintingExtensionPoints.ts`。
  { id: ERROR_OPTIONS_PROVIDER_EP, upstreamFile: 'platform/lang-impl/resources/intellij.platform.lang.impl.xml', upstreamLine: 126, consumer: 'src/inspectionPrintingExtensionPoints.ts' },
  { id: PRINT_OPTION_EP, upstreamFile: 'platform/lang-impl/resources/intellij.platform.lang.impl.xml', upstreamLine: 260, consumer: 'src/inspectionPrintingExtensionPoints.ts（限定名见 PrintOption.java:15）' },
  // 面包屑一族（2026-10-06 platform_rest 剩余族收口 lane）：声明在 `src/breadcrumbsExtensionPoints.ts`。
  { id: BREADCRUMBS_INFO_PROVIDER_EP, upstreamFile: 'platform/editor-ui-api/resources/intellij.platform.editor.ui.xml', upstreamLine: 48, consumer: 'src/breadcrumbsExtensionPoints.ts（限定名见 BreadcrumbsProvider.java:24）' },
  // 提交期的三条（2026-10-06 b1b7verdict lane）：声明与消费端都在 `src/checkinHandlers.ts`
  // （提交前闸接在 `src/sourceControlCommitChecks.ts` 的 `passedCommitCheck()`）。
  { id: CHECKIN_HANDLER_FACTORY_EP, upstreamFile: 'platform/vcs-api/resources/intellij.platform.vcs.xml', upstreamLine: 24, consumer: 'src/checkinHandlers.ts（限定名见 CheckinHandlerFactory.java:17）' },
  { id: VCS_CHECKIN_HANDLER_FACTORY_EP, upstreamFile: 'platform/vcs-api/resources/intellij.platform.vcs.xml', upstreamLine: 27, consumer: 'src/checkinHandlers.ts' },
  { id: LOCAL_COMMIT_EXECUTOR_EP, upstreamFile: 'platform/vcs-api/src/com/intellij/openapi/vcs/changes/CommitExecutor.java', upstreamLine: 23, consumer: 'src/checkinHandlers.ts（ProjectExtensionPointName，限定名见该行）' },
]

/**
 * 运行期自检：`UPSTREAM_EXTENSION_POINTS` 里每条 id 是否真的在 EP 宿主里声明了。
 * 返回不匹配清单（空 = 全部对得上）。这是"插件按 id 挂却挂不上"那类问题的第一道诊断。
 */
export function assertUpstreamExtensionPointIds(): { ok: boolean; missing: string[] } {
  const missing = UPSTREAM_EXTENSION_POINTS.map(ref => ref.id).filter(id => !EXTENSIONS.hasExtensionPoint(id))
  return { ok: missing.length === 0, missing }
}

// ── 上游服务面补的四样（FQN 键，逐字）────────────────────────────────────────────────────────

/** 上游 `com.intellij.platform.recentFiles.shared.FileSwitcherApi`。 */
export const FILE_SWITCHER_API = 'com.intellij.platform.recentFiles.shared.FileSwitcherApi'
/** 上游 `com.intellij.openapi.fileEditor.impl.EditorWindow`（抽象类；协调者点名的 `EditorWindowService` 参考树里不存在）。 */
export const EDITOR_WINDOW = 'com.intellij.openapi.fileEditor.impl.EditorWindow'
/** 上游 `com.intellij.openapi.vcs.changes.savedPatches.SavedPatchesProvider`。 */
export const SAVED_PATCHES_PROVIDER = 'com.intellij.openapi.vcs.changes.savedPatches.SavedPatchesProvider'
/** 上游 `com.intellij.openapi.vcs.changes.savedPatches.ShelfProvider`（`SavedPatchesProvider` 的搁架实现）。 */
export const SHELF_PROVIDER = 'com.intellij.openapi.vcs.changes.savedPatches.ShelfProvider'
/** 上游 `com.intellij.ide.projectView.ProjectView`（项目工具窗口的多窗格宿主）。 */
export const PROJECT_VIEW = 'com.intellij.ide.projectView.ProjectView'

/** `RecentFileKind`（`FileSwitcherApi.kt:60-64` 三值，逐字）。 */
export type RecentFileKind = 'RECENTLY_EDITED' | 'RECENTLY_OPENED' | 'RECENTLY_OPENED_UNPINNED'

/** `RecentFilesBackendRequest` 的可移植形状（`FileSwitcherApi.kt:33-50` 四个子类）。 */
export type RecentFilesBackendRequest =
  | { request: 'FetchMetadata'; filesKind: RecentFileKind; files: readonly string[]; forceAddToModel: boolean }
  | { request: 'FetchFiles'; filesKind: RecentFileKind; files: readonly string[] }
  | { request: 'HideFiles'; filesKind: RecentFileKind; filesToHide: readonly string[] }
  | { request: 'ScheduleRehighlighting' }

/** 插件 API 的宿主端口（比 `PluginServiceDeps` 多出切换器 / 多窗口 / 项目视图那几格）。 */
export interface PluginApiDeps extends PluginServiceDeps {
  /** 当前工作区根（项目视图窗格可用性要用）。 */
  workspaceRoot?: () => string
  /** 某类最近文件（最近编辑 / 最近打开 / 未钉住），最近在前。 */
  recentFiles?: (kind: RecentFileKind) => readonly string[]
  /** 编辑器选择历史（`EditorHistoryManager`）。 */
  openEditors?: () => readonly string[]
  /** 工具窗口条目（切换器第二张表）。 */
  toolWindows?: () => readonly { id: string; title: string }[]
  /** 当前标签路径（切换器初始选中要跳过它）。 */
  currentPath?: () => string | undefined
  /** 编辑器栏表（多窗口/分栏那一档）。 */
  editorGroups?: () => readonly (readonly string[])[]
  /** 这个环境能不能真的开独立窗口（浏览器档 = 能，WebView2 宿主 = 被取消）。 */
  detachedCapability?: () => DetachedWindowCapability
  /** 读一次储藏列表（`git stash list`）。 */
  stashList?: () => Promise<GitStashEntry[]>
  /** 存一条储藏（`git stash push -m`）。 */
  stashSave?: (message: string) => Promise<void>
  /** 取回一条储藏（按 ref）。 */
  stashPop?: (ref: string) => Promise<void>
  /**
   * 「与本地比较」的取数口（上游 `SavedPatchesProvider.PatchObject.createDiffWithLocalRequestProducer`）。
   * 本仓的纯规则在 `src/compareWithLocal.ts`、取内容在 `src/revisionContent.ts`（另一条 lane 的实现）；
   * 这里按上游方法名转发给装配层注入的实现，插件按上游名字调用时能得到宿主真正的比较结果。
   */
  savedPatchCompare?: (input: { ref: string; path: string; useBeforeVersion: boolean }) => Promise<unknown>
}

// ── 服务实现 ─────────────────────────────────────────────────────────────────────────────────

/** `FileSwitcherApi`（最近文件 / 切换器）。 */
function fileSwitcherApi(deps: PluginApiDeps): PluginService {
  const hidden = new Set<string>()
  const recentOf = (kind: RecentFileKind): string[] => [...(deps.recentFiles?.(kind) ?? [])].filter(path => !hidden.has(path))
  const impl = {
    /** 本仓的同步读（上游 `getRecentFileEvents` 是 Flow；单进程下按当前值给数组）。 */
    getRecentFiles: (kind: unknown) => recentOf(String(kind ?? 'RECENTLY_OPENED') as RecentFileKind),
    /** 切换器的两张表（`src/switcher.ts` 的纯模型）。 */
    getSwitcherItems: (sources: unknown): SwitcherItemList => collectSwitcherItems(normalizeSources(deps, sources)),
    /** 按前缀过滤（速度搜索）。 */
    filterItems: (items: unknown, prefix: unknown) => filterSwitcherItems((items ?? []) as readonly SwitcherItem[], String(prefix ?? '')),
    /** 初始选中（跳过当前标签）。 */
    filesSelectedIndex: (items: unknown, forward: unknown) =>
      initialSwitcherIndex((items ?? []) as readonly SwitcherItem[], deps.currentPath?.(), forward !== false),
    /**
     * `updateRecentFilesBackendState(request)`（`FileSwitcherApi.kt:28`）。
     * 本仓只兑现 `HideFiles`（把文件从最近列表里去掉）与两个 Fetch（返回当前模型：单进程无后端）；
     * `ScheduleRehighlighting` 无对应物，返回 true（成功但不做事）—— 如实写在注释里，不假装。
     */
    updateRecentFilesBackendState: (request: unknown): boolean => {
      const value = (request ?? {}) as Partial<RecentFilesBackendRequest> & { request?: string; filesToHide?: readonly string[] }
      if (value.request === 'HideFiles') for (const path of value.filesToHide ?? []) hidden.add(path)
      return true
    },
  }
  return {
    id: FILE_SWITCHER_API,
    scope: APPLICATION_SCOPE,
    upstream: 'com.intellij.platform.recentFiles.shared.FileSwitcherApi（映射 src/switcher.ts）',
    methods: ['getRecentFiles', 'getSwitcherItems', 'filterItems', 'filesSelectedIndex', 'updateRecentFilesBackendState'],
    impl,
  }
}

function normalizeSources(deps: PluginApiDeps, sources: unknown): SwitcherSources {
  if (sources && typeof sources === 'object') return sources as SwitcherSources
  return {
    openEditors: deps.openEditors?.() ?? [],
    recentFiles: deps.recentFiles?.('RECENTLY_OPENED') ?? [],
    onlyEditedFiles: deps.recentFiles?.('RECENTLY_EDITED') ?? [],
    toolWindows: deps.toolWindows?.() ?? [],
    currentPath: deps.currentPath?.(),
  }
}

/** `EditorWindow`（多窗口 / 浮层编辑器）。 */
function editorWindow(deps: PluginApiDeps): PluginService {
  const groups = () => deps.editorGroups?.() ?? []
  const impl = {
    /** 上游 `EditorWindow.split(...)`：把文件摘到新窗口/右分栏（本仓 = `detachTab`，返回新窗口描述）。 */
    split: (path: unknown, pane: unknown): DetachedEditor | null =>
      detachTab(groups(), String(path ?? ''), Number(pane) || 0).detached,
    /** 上游 `EditorWindow.getFiles()`：这一栏里的文件。 */
    getFiles: (pane: unknown) => [...(groups()[Number(pane ?? 0)] ?? [])],
    /** 上游 `EditorWindow.closeAll(...)` 的等价物：把浮层放回原栏（`reattachTab`）。 */
    closeAll: (detached: unknown) => reattachTab(groups(), detached as DetachedEditor),
    /** 能不能开独立窗口（`detachedWindowCapability`；宿主答不出时按"不能"——不放假控件）。 */
    canDetach: () => canDetachEditor(deps.detachedCapability?.() ?? { overlayHostPresent: false, browserWindowSupported: false }),
    /** 独立窗口地址（浏览器档）。 */
    detachedUrl: (baseUrl: unknown, path: unknown) => detachedWindowUrl(String(baseUrl ?? ''), String(path ?? '')),
  }
  return {
    id: EDITOR_WINDOW,
    scope: APPLICATION_SCOPE,
    upstream: 'com.intellij.openapi.fileEditor.impl.EditorWindow（映射 src/editorWindows.ts）',
    methods: ['split', 'getFiles', 'closeAll', 'canDetach', 'detachedUrl'],
    impl,
  }
}

/** `SavedPatchesProvider` / `ShelfProvider`（搁架）。 */
function savedPatchesProvider(deps: PluginApiDeps): PluginService {
  const listeners = new Set<() => void>()
  const load = async (): Promise<ShelfRow[]> => shelfRows(deps.stashList ? await deps.stashList() : [])
  const notify = () => { for (const listener of listeners) listener() }
  const impl = {
    /** 上游 `ShelveChangesManager.allLists` / `ShelfProvider.mainLists()`：本仓 = `git stash list` 整形。 */
    getSavedPatches: load,
    /** 兼容既有消费端（`src/pluginServices.ts` 同一份数据）。 */
    getAllLists: load,
    shelveChanges: async (message: unknown) => { await deps.stashSave?.(String(message ?? '')); notify() },
    unshelveChanges: async (ref: unknown, remove: unknown) => {
      await deps.stashPop?.(String(ref ?? ''))
      if (remove !== false) notify()
    },
    /** `SavedPatchesProvider.subscribeToPatchesListChanges`（`:26`）。 */
    subscribeToPatchesListChanges: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    /** 上游 `SavedPatchesProvider.applyAction` / `popAction`（`:23-24`，值是动作 id `Vcs.Shelf.*`）。 */
    applyAction: () => 'Vcs.Shelf.Apply',
    popAction: () => SHELF_POP_ACTION_ID,
    /** `isEmpty()`（`:27`）。 */
    isEmpty: async () => (await load()).length === 0,
    /**
     * 上游 `SavedPatchesProvider.PatchObject.createDiffWithLocalRequestProducer(project, useBeforeVersion)`
     * （`SavedPatchesProvider.kt:45`）—— 名字逐字保留。本仓纯规则在 `src/compareWithLocal.ts`、
     * 取在某个修订/搁架里某文件的内容在 `src/revisionContent.ts`；装配层通过 `savedPatchCompare` 注入，
     * 没注入时返回 null（如实说"这一格没接上"，不给假结果）。
     */
    createDiffWithLocalRequestProducer: (ref: unknown, path: unknown, useBeforeVersion: unknown): Promise<unknown> =>
      deps.savedPatchCompare
        ? deps.savedPatchCompare({ ref: String(ref ?? ''), path: String(path ?? ''), useBeforeVersion: useBeforeVersion === true })
        : Promise.resolve(null),
  }
  return {
    id: SAVED_PATCHES_PROVIDER,
    scope: APPLICATION_SCOPE,
    upstream: 'com.intellij.openapi.vcs.changes.savedPatches.SavedPatchesProvider(+ ShelfProvider)（映射 src/shelfTree.ts）',
    methods: ['getSavedPatches', 'getAllLists', 'shelveChanges', 'unshelveChanges', 'subscribeToPatchesListChanges', 'applyAction', 'popAction', 'isEmpty', 'createDiffWithLocalRequestProducer'],
    impl,
  }
}

/** `ProjectView`（项目视图多窗格）。 */
function projectView(deps: PluginApiDeps): PluginService {
  const root = () => deps.workspaceRoot?.() ?? ''
  const impl = {
    /** 上游 `ProjectView.getPanes()` 过滤 `isAvailable` 之后那一档（`ProjectViewImpl.java:1684`）。 */
    getPanes: (): ProjectViewPaneChoice[] => projectViewPaneChoices(root()),
    /** 全部贡献（不过滤可用性；诊断用）。 */
    getAllPanes: (): ProjectViewPaneChoice[] => projectViewPanes().map(pane => ({
      id: pane.id,
      title: safeCall(() => pane.getTitle(), pane.id),
      group: safeCall(() => pane.getGroup(), ''),
      weight: pane.getWeight(),
    })),
    /** `AbstractProjectViewPane.isAvailable(root)` 的逐窗格问法。 */
    isAvailable: (id: unknown): boolean => availableProjectViewPanes(root()).some(pane => pane.id === String(id ?? '')),
  }
  return {
    id: PROJECT_VIEW,
    scope: APPLICATION_SCOPE,
    upstream: 'com.intellij.ide.projectView.ProjectView（映射 src/projectViewPanes.ts + com.intellij.projectViewPane）',
    methods: ['getPanes', 'getAllPanes', 'isAvailable'],
    impl,
  }
}

function safeCall<T>(run: () => T, fallback: T): T {
  try { return run() } catch { return fallback }
}

// ── 注册 / 装配 ──────────────────────────────────────────────────────────────────────────────

/** 建出本文件补的四个服务（顺序即注册顺序）。 */
export function createPluginApiServices(deps: PluginApiDeps = {}): PluginService[] {
  return [fileSwitcherApi(deps), editorWindow(deps), savedPatchesProvider(deps), projectView(deps)]
}

export interface PluginApiInstallDeps extends PluginServiceDeps, PluginApiDeps {}

export interface PluginApiInstallResult {
  /** 已注册的服务贡献句柄（含 `src/pluginServices.ts` 的四样）。 */
  services: ExtensionHandle[]
  /** 本仓声明且 id 与上游逐字一致的 EP。 */
  extensionPoints: string[]
}

/**
 * 装配：声明全部 bundled EP，注册基础服务（`src/pluginServices.ts`）与本文件补的四样。
 *
 * 幂等：`EXTENSIONS.registerExtension` 对同 id 是**覆盖**，所以装配层可以放心重复调用。
 * 这是"插件按 FQN `getService` 拿到东西"的启动点（上游 `ApplicationManager.getService` 的等价物）。
 */
export function installPluginApi(deps: PluginApiInstallDeps = {}): PluginApiInstallResult {
  declareBundledExtensionPoints()
  // 重命名/重构一族的 EP 声明（`src/refactorRenameExtensionPoints.ts`）：装插件 API 时一并声明，
  // 让第三方按同一 id 挂校验器/建议器/限定名提供方时能挂上。
  declareRefactorRenameExtensionPoints()
  declareDocumentationExtensionPoints()
  declareFileEditorExtensionPoints()
  declareInlineCompletionExtensionPoints()
  declareSearchEverywhereExtensionPoints()
  declareInspectionPrintingExtensionPoints()
  declareBreadcrumbsExtensionPoints()
  // daemon 域的十三条 EP（见文件头那条 import 的注释）：插件宿主装 API 面时一并声明，
  // 于是第三方按 `com.intellij.problemHighlightFilter` / `com.intellij.implicitUsageProvider`
  // 一类 id 挂贡献时，EP 一定已在宿主里。
  declareDaemonExtensionPoints()
  const services = [
    ...createPluginServices(deps as PluginServiceDeps),
    ...createPluginApiServices(deps),
  ]
  return {
    services: registerPluginServices(services),
    extensionPoints: UPSTREAM_EXTENSION_POINTS.map(ref => ref.id),
  }
}

/** 诊断目录：基础服务 + 本文件补的四样，合起来按 FQN 排（插件页/日志显示"缺哪一格"）。 */
export function pluginApiServiceCatalog(): PluginServiceCatalogEntry[] {
  const merged = new Map<string, PluginServiceCatalogEntry>()
  for (const entry of pluginServiceCatalog()) merged.set(entry.id, entry)
  for (const service of EXTENSIONS.extensionsOf<PluginService>(SERVICE_EP)) {
    if (!merged.has(service.id)) merged.set(service.id, { id: service.id, methods: service.methods.join(', '), upstream: service.upstream })
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** 诊断目录：编辑器提供者（第三方挂了但没被选中时，看这张表）。 */
export function pluginApiEditorProviders(): { id: string; editorTypeId: string; policy: string }[] {
  return fileEditorProviderCatalog()
}

// 让"第三方按 id 挂、既有消费端看得见"这条判据有单一入口（测试直接调它们）。
export {
  editorProviderFor, fileEditorProviders, availableProjectViewPanes, projectViewPanes,
  type FileEditorProviderContribution, type FileEditorProviderInput, type RegisterExtensionOptions,
}
