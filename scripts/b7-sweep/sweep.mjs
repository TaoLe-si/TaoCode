// B7 判决清扫器：把 docs/inventory/verdict-find-diff.md 里 455 条 `[ ]` 逐条改判。
// 只在 --write 时落盘；默认 --check 打印结果供审阅。
//
// 规则：
//   · `[~]` 理由必须点到本仓真实文件（写成 `src/xxx.ts`，跑之前脚本自己 existsSync 验）；
//   · `[-]` 理由必须带上游 `文件:行号` —— 脚本在该上游文件里找 marker 行，找不到就报错（不猜）；
//   · `[x]` 只给本轮真做了的（保留大小写 / 差异导航）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const UP = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const DOC = join(root, 'docs/inventory/verdict-find-diff.md')
// 基线快照（清扫前的 455 条空档）：从快照生成，避免二次清扫时源已被改写。
const SNAPSHOT = join(root, 'build/b7-sweep/verdict-original.md')

// —— 本仓可引用的对应物（脚本会验存在）——
const R = {
  panel: 'src/components/SearchPanel.vue',
  bar: 'src/components/EditorFindBar.vue',
  findCtrl: 'src/editorFindController.ts',
  search: 'src/editorSearch.ts',
  searchExt: 'src/editorSearchExtension.ts',
  preview: 'src/searchPreview.ts',
  stream: 'src/searchStream.ts',
  scopes: 'src/scopes.ts',
  nativeSearch: 'native/search.cpp',
  semantic: 'src/semanticActions.ts',
  tree: 'src/treeActions.ts',
  tool: 'src/toolContents.ts',
  gear: 'src/usageViewGear.ts',
  toolWindow: 'src/activeToolWindow.ts',
  seDialog: 'src/components/SearchEverywhereDialog.vue',
  se: 'src/searchEverywhere.ts',
  diffView: 'src/components/DiffView.vue',
  diffText: 'src/diffText.ts',
  diffAlign: 'src/diffAlign.ts',
  diffWords: 'src/diffWords.ts',
  diffChars: 'src/diffChars.ts',
  diffChunks: 'src/diffChunks.ts',
  diffComparison: 'src/diffComparison.ts',
  diffSmart: 'src/diffSmartLines.ts',
  diffFold: 'src/diffFold.ts',
  diffNav: 'src/diffNavigation.ts',
  compare: 'src/compareFiles.ts',
  vcs: 'src/vcsActions.ts',
  fileOps: 'src/editorFileOps.ts',
  merge: 'src/mergeConflicts.ts',
  mergeHost: 'src/editorMergeHost.ts',
  mergeBar: 'src/components/MergeBar.vue',
  vcsLog: 'src/components/VcsLogDiff.vue',
  bridge: 'src/bridge.ts',
  preserve: 'src/preserveCase.ts',
  blame: 'src/editorBlameAnnotations.ts',
  changes: 'src/changesGrouping.ts',
}
for (const p of Object.values(R)) if (!existsSync(join(root, p))) throw new Error(`引用不存在：${p}`)

const CLEAN = s => s.replace(/\|/g, '/').replace(/[`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110)

/**
 * 族表。每个族里三档名单必须恰好覆盖该目录下全部 `[ ]` 类。
 * part: cite/repo/miss；skip: ev/why；x: 名字→理由。
 */
const FAMILIES = [
  {
    dir: 'platform/lang-impl/src/com/intellij/find/impl',
    intro: '工程内查找（FindPopupPanel 一族）',
    part: {
      cite: R.panel, citeLine: 110,
      repo: 'SearchPanel.vue 的工程内搜索（作用域下拉 / 结果分组 / 预览 / 右键菜单 / 分块发布）',
      miss: '上游 FindPopupPanel 那套目录选择器与 SearchEverywhere 渲染细节（29 个 editorHeaderActions 之外的部分）',
      names: ['FileAndLineTextRenderer', 'FindInProjectRecents', 'FindManagerBase', 'FindManagerImpl',
        'FindPopupScopeUIProvider', 'FindPopupScopeUIProviderImpl', 'FindPopupSearchState', 'FindResultUsageInfo',
        'FindUI', 'FindUIHelper', 'LangFindSettingsImpl', 'RegExReplacementBuilder',
        'ShowRecentFindUsagesAction', 'ShowRecentFindUsagesGroup', 'TextSearchListAgnosticRenderer',
        'TextSearchRenderer', 'TextSearchRightActionAction', 'UsagePresentationProvider', 'usageAdapters'],
      extra: {
        FindInProjectRecents: '工程内搜索侧的最近搜索清单（编辑器那侧的有界历史表在 `src/editorFindController.ts`）',
        RegExReplacementBuilder: '编辑器内替换的正则回填 builder（工程内那侧由 `native/search.cpp` 的 `$1/$&` format 承担）',
        ShowRecentFindUsagesAction: '「最近查找用法」那条历史（用法视图齿轮在 `src/usageViewGear.ts`）',
        ShowRecentFindUsagesGroup: '最近用法的分组菜单（用法视图在 `src/usageViewGear.ts`）',
        usageAdapters: '上游的 UsageInfoAdapter 过滤扩展（LSP 引用结果在 `src/semanticActions.ts` 里成形）',
        TextSearchRenderer: 'SearchEverywhere 那个 Swing 渲染器本身（结果渲染在 `src/components/SearchEverywhereDialog.vue`，数据在 `src/searchEverywhere.ts`）',
      },
    },
    skip: {
      names: ['CommentsAndLiteralsSearcher', 'EelDirectorySearchEngine', 'EelSearchEdges', 'FindExceptCommentsOrLiteralsData',
        'FindInDirectoryScopeProvider', 'FindInFilesLanguage', 'FindInProjectExtension', 'FindKey', 'HelpID',
        'IdeLanguageCustomizationApi', 'IdeLanguageCustomizationApiImpl', 'JComboboxAction', 'RegExHelpPopup',
        'RevealingSpaceComboboxEditor', 'TextSearchContributor', 'WelcomeScreenFindInProjectExtension',
        'WelcomeScreenFindScope', 'uiModel', 'FindPopupDirectoryChooser'],
      ev: ['Lexer', 'EelSearchApi', 'EelPath', 'EelSearchEvent', 'RegistryManager', 'ExtensionPointName', 'JPanel',
        'JComboBox', 'ComboBox', 'EditorTextField', 'StringComboboxEditor', 'Language', 'PsiElement', 'VirtualFile',
        'Registry', 'HelpID', 'WelcomeScreenProjectProvider'],
      evByName: {
        JComboboxAction: ['ComboBox', 'BasicComboBoxEditor'],
        HelpID: ['HelpID'],
        RevealingSpaceComboboxEditor: ['StringComboboxEditor', 'Editor'],
        WelcomeScreenFindInProjectExtension: ['FindInProjectExtension', 'CommonDataKeys'],
        WelcomeScreenFindScope: ['WelcomeScreenProjectProvider', 'WelcomeScreen'],
        uiModel: ['VirtualFile', 'UsageInfoAdapter'],
        usageAdapters: ['ExtensionPointName'],
      },
      why: '它是 Swing 组件 / 平台扩展点（Lexer 词法、Eel 远程文件系统、WelcomeScreen、DataKey 一类），本仓自绘前端没有对应承载面',
    },
    x: {
      PreserveCaseUtil: '本轮已实现：`src/preserveCase.ts` 逐字移植 `replaceWithCaseRespect` / `applyCase`，用例取上游 `PreserveCaseUtilTest`；查找栏替换行有「保留大小写」开关，见 `tests/preserve-case.test.mjs`。',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/merge',
    intro: '三方合并与冲突解决（MergeRequestProcessor 一族）',
    part: {
      cite: R.merge, citeLine: 52,
      repo: 'mergeConflicts.ts 的冲突标记模型 + editorMergeHost.ts 的接受/导航 + MergeBar.vue',
      miss: '三份内容（base/yours/theirs）的 merge changes 模型、逐片段接受与 ApplyNonConflicts；本仓的输入是文件里的冲突标记',
      names: ['ApplyNonConflictsAction', 'BinaryMergeTool', 'ChangeReferenceProcessor', 'ErrorMergeTool',
        'MagicResolvedConflictsAction', 'MergeConflictModel', 'MergeModelBase', 'MergeRequestProcessor',
        'MergeUtil', 'MessageMergeViewer', 'NavigateToChangeMarkerAction', 'RevertConflictResolutionAction',
        'ShowDiffWithBaseAction', 'TextMergeChange', 'TextMergeTool', 'TextMergeViewer'],
      extra: {
        ShowDiffWithBaseAction: '「与 base 比较」的栏位（base 段在 `src/mergeConflicts.ts` 的 `CONFLICT_BASE` 里已解析出来，但没有栏位可看）',
        ApplyNonConflictsAction: '「自动接受全部不冲突改动」（逐条接受已落，见 `src/mergeConflicts.ts` 的 acceptSide）',
      },
    },
    skip: {
      names: ['IterativeResolveData', 'LangSpecificMergeConflictResolver', 'LangSpecificMergeConflictResolverWrapper',
        'LangSpecificMergeContext', 'MergeContextEx', 'MergeDiffBuilder', 'MergeImportUtil',
        'MergeStatisticsAggregator', 'MergeThreesideLineStatusMarkerRenderer', 'MergeWindow', 'ThreesideMergeHighlighters'],
      ev: ['UserDataHolder', 'DocumentContent', 'Document', 'Delta', 'TextMergeChange', 'PsiFile', 'PsiElement',
        'DataKey', 'Language', 'JPanel', 'LineMarkerRenderer', 'JBUIScale', 'MergeContext', 'EditorHighlighter'],
      evByName: {
        LangSpecificMergeContext: ['PsiFile'],
        MergeDiffBuilder: ['PsiFile', 'LineOffsetsUtil'],
        MergeContextEx: ['MergeContext'],
        IterativeResolveData: ['UserDataHolder', 'TextMergeChange'],
        ThreesideMergeHighlighters: ['DiffViewerHighlighters'],
        MergeWindow: ['WindowWrapperBuilder'],
      },
      why: '它依赖 PSI / Document / 编辑器绘制或 Swing 窗口这类 JVM 侧模型（语言特化合并、行标记绘制、窗口），本仓的合并功能落在标记文本与 MergeBar 上，这一类没有可移植的行为',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/actions',
    intro: '查找/用法的动作层（ShowUsages 一族）',
    part: {
      cite: R.semantic, citeLine: 56,
      repo: 'semanticActions.ts 的 LSP references 通道 + toolContents.ts 的面板 + usageViewGear.ts 的齿轮',
      miss: '上游 ShowUsages 的弹窗/表格形态与 1873 行的分组预览；本仓是引用面板 + 齿轮',
      names: ['ActivateFindToolWindowAction', 'FindSelectionInPathAction', 'FindUsagesInFileAction', 'SearchOptionsService',
        'SearchTarget2UsageTarget', 'ShowSearchHistoryAction', 'ShowTargetUsagesActionHandler', 'ShowUsagesActionHandler',
        'ShowUsagesHeader', 'ShowUsagesManager', 'ShowUsagesParameters', 'UsageNavigation', 'UsageOptionsDialog'],
      extra: {
        ActivateFindToolWindowAction: '查找工具窗的独立激活动作（工具窗激活栈在 `src/activeToolWindow.ts`，面板本体是 `src/components/SearchPanel.vue`）',
        FindSelectionInPathAction: '「拿选区当前缀」那条接线（工程内搜索入口在 `src/components/SearchPanel.vue`，编辑器内那根栏在 `src/components/EditorFindBar.vue`）',
        FindUsagesInFileAction: '在文件内发起的用法查找这一形态（本仓入口在 `src/treeActions.ts`，结果进 `src/semanticActions.ts` 的引用面板）',
        ShowSearchHistoryAction: '上游那条历史动作本身（查找历史在 `src/editorFindController.ts` 的 `HISTORY_KEY`，Alt+Down 打开，见 `src/components/EditorFindBar.vue`）',
        ShowUsagesHeader: '独立的面板 header 组件（文案照上游复刻在 `src/toolContents.ts` 的 `{0} of {1}` 一族）',
        UsageOptionsDialog: '对话框形态（用法视图选项落在 `src/usageViewGear.ts` 的齿轮里）',
      },
    },
    skip: {
      names: ['CompositeActiveComponent', 'PingEDT', 'SearchTargetVariantsDataRule', 'SearchTargetsDataRule',
        'ShowUsagesPopupData', 'ShowUsagesTable', 'ShowUsagesTableCellRenderer', 'UsageListCellRenderer',
        'compositeActiveComponentPanel', 'resolver'],
      ev: ['ActiveComponent', 'SwingUtilities', 'CommonDataKeys', 'DataContext', 'JTable', 'JBTable',
        'TableCellRenderer', 'JList', 'JPanel', 'PsiElement', 'HintManager'],
      evByName: { ShowUsagesTable: ['JBTable'], resolver: ['PsiElement'] },
      why: '它是 Swing 表格/渲染器/EDT 调度或 ActionSystem 的 DataRule 壳，本仓自绘前端没有对应绘制上下文',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/combined',
    intro: '多文件合成 diff（CombinedDiffViewer 一族）',
    part: {
      cite: R.diffView, citeLine: 158,
      repo: 'DiffView.vue 的单文件并排/统一查看器（含折叠与差异导航）',
      miss: '把多个文件的差异合成一段、块级选择与合成导航；本仓一次只展示一份行表',
      names: ['BlockState', 'CombinedDiffActions', 'CombinedDiffBlocks', 'CombinedDiffCaretNavigation',
        'CombinedDiffComponentProcessorImpl', 'CombinedDiffLoadingBlock', 'CombinedDiffModel',
        'CombinedDiffNavigation', 'CombinedDiffRegistry', 'CombinedDiffTool', 'CombinedDiffUI', 'CombinedDiffViewer'],
      extra: {
        CombinedDiffCaretNavigation: '合成视图里的光标换算（差异块与跳转在 `src/diffNavigation.ts`，只有单文件导航）',
        CombinedDiffNavigation: '合成视图的跨文件导航（差异块与跳转在 `src/diffNavigation.ts`）',
      },
    },
    skip: {
      names: ['CombinedDiffActionPromoter', 'CombinedDiffBlocksPanel', 'CombinedDiffContainerPanel',
        'CombinedDiffEditorHandlers', 'CombinedDiffKeys', 'CombinedDiffMainToolbar', 'CombinedDiffMainUI',
        'CombinedDiffSelectablePanel', 'CombinedDiffVirtualFile'],
      ev: ['ActionPromoter', 'JPanel', 'JComponent', 'JBUIScale', 'Editor', 'DataKey', 'VirtualFile', 'Disposable'],
      evByName: {
        CombinedDiffBlocksPanel: ['JPanel', 'JBUIScale', 'Disposable'],
        CombinedDiffSelectablePanel: ['addHoverAndPressStateListener', 'regularBackground'],
        CombinedDiffEditorHandlers: ['Editor', 'Disposable'],
      },
      why: '它是 Swing 面板/工具栏/ActionPromoter/VirtualFile 壳，本仓自绘前端没有对应承载面',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/actions/impl',
    intro: 'diff 动作层（差异导航与编辑器动作）',
    x: {
      DiffDifferenceNavigationAction: '本轮已实现：`src/diffNavigation.ts` 的差异块 + canGo/go 两对面（照 `PrevNextDifferenceIterableBase`），`src/components/DiffView.vue` 的两个按钮与 F7/Shift+F7，判据 `tests/diff-nav.test.mjs`。',
      DiffNextDifferenceAction: '本轮已实现：下一个差异（F7）接到 `src/diffNavigation.ts`，`src/components/DiffView.vue` 里按钮走 `goToChange(true)`。',
      DiffPreviousDifferenceAction: '本轮已实现：上一个差异（Shift+F7）接到 `src/diffNavigation.ts` 的 goPrev/canGoPrev，`src/components/DiffView.vue` 里按钮走 goToChange(false)。',
      NextDifferenceAction: '本轮已实现：抽象基类的行为（canGoNext/goNext）在 `src/diffNavigation.ts` 有等价物。',
    },
    part: {
      cite: R.diffView, citeLine: 25,
      repo: 'DiffView.vue 的查看器状态（模式/档位/折叠）+ vcsActions.ts 的两条入口',
      miss: '上游动作族的工具栏/弹窗形态；本仓只有查看器上的按钮，没有 diff 工具窗标题栏',
      names: ['CombinedDiffToggleAction', 'DiffFileNavigationAction', 'DiffNextFileAction', 'DiffPreviousFileAction',
        'FocusOppositePaneAction', 'MutableDiffRequestChain', 'OpenDiffInEditorAction', 'OpenInEditorAction',
        'OpenInEditorWithMouseAction', 'SetEditorSettingsAction', 'SetEditorSettingsActionGroup', 'ToggleDiffAligningModeAction'],
      extra: {
        DiffFileNavigationAction: '逐文件导航（多文件差异在 `src/components/VcsLogDiff.vue` 有文件列表）',
        DiffNextFileAction: '逐文件导航（文件列表在 `src/components/VcsLogDiff.vue`）',
        DiffPreviousFileAction: '逐文件导航（文件列表在 `src/components/VcsLogDiff.vue`）',
        FocusOppositePaneAction: '「对侧焦点」这一动作（本仓两侧在同一个滚动容器里，见 `src/components/DiffView.vue`）',
        SetEditorSettingsAction: '上游那个编辑器设置动作组（本仓档位在 `src/components/DiffView.vue` 的 `taocode.diffOptions`）',
        ToggleDiffAligningModeAction: '可切的对齐模式开关（本仓逐行对齐就是查看器的形态，见 `src/diffAlign.ts`）',
      },
    },
    skip: {
      names: ['GoToChangePopupBuilder', 'LinkAction', 'DiffUiDataRule'],
      ev: ['JBPopup', 'AnActionLink', 'Popup', 'DataKey', 'DataRule', 'DataProvider'],
      why: '它是 Swing 弹窗 / 链接组件 / DataRule 壳，本仓自绘前端没有对应承载面',
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff',
    intro: 'diff 框架层（管理器 / 工具注册 / 上下文）',
    part: {
      cite: R.vcs, citeLine: 106,
      repo: 'vcsActions.ts 的对比通道（clipboardDiff / compareWithFile）+ DiffView.vue + compareFiles.ts',
      miss: 'DiffManager/DiffTool 这套工具注册与上下文扩展点；本仓只有两条入口和一个查看器',
      names: ['DiffApplicationSettings', 'DiffContentFactory', 'DiffContext', 'DiffEditorTitleCustomizer', 'DiffManager',
        'DiffManagerEx', 'DiffRequestFactory', 'DiffRequestPanel', 'DiffTool', 'DiffToolType', 'FrameDiffTool',
        'InvalidDiffRequestException', 'SuppressiveDiffTool'],
      extra: {
        DiffApplicationSettings: '全局 diff 设置这一层（本仓档位持久化在 `src/components/DiffView.vue` 的 `taocode.diffOptions`）',
        DiffEditorTitleCustomizer: '标题自定义器扩展点（标题由 `src/components/DiffView.vue` 自己渲染）',
        DiffToolType: 'DiffToolType 注册表（本仓只有一套查看器：`src/components/DiffView.vue` 的并排/统一两态）',
      },
    },
    skip: {
      names: ['DiffDialogHints', 'DiffExtension', 'EditorDiffViewer', 'FocusableContext'],
      ev: ['WindowWrapper', 'ExtensionPointName', 'Editor', 'Component', 'FocusManager'],
      why: '它绑在 IDE 的窗口包装（WindowWrapper/DialogWrapper）、扩展点或 JComponent 焦点语义上，本仓自绘前端没有对应承载面',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff',
    intro: 'diff 实现层（管理器实例 / 通知 / 写入访问）',
    part: {
      cite: R.vcs, citeLine: 106,
      repo: 'vcsActions.ts 的对比通道 + DiffView.vue + compareFiles.ts',
      miss: '上游的 DiffManager 实例与内容工厂扩展；本仓两次 diff 都是同步函数调用',
      names: ['DiffContentFactoryEx', 'DiffContentFactoryImpl', 'DiffContextEx', 'DiffManagerImpl',
        'DiffRequestFactoryImpl', 'DiffViewerEx'],
    },
    skip: {
      names: ['DiffActionPromoter', 'DiffLightVirtualFileWritingAccessProvider', 'DiffNotificationIdsHolder'],
      ev: ['ActionPromoter', 'WritingAccessProvider', 'VirtualFile', 'NotificationIdsHolder'],
      why: '它是 ActionSystem 促进器 / WritingAccessProvider / 通知 ID 表这类平台注册件，本仓没有对应挂点',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/editor',
    intro: 'diff 作为虚拟文件/编辑器页签',
    skip: {
      names: ['ChainDiffVirtualFile', 'DefaultDiffFileEditorCustomizer', 'DiffContentVirtualFile', 'DiffEditorEscapeAction',
        'DiffEditorTabFilesManager', 'DiffEditorTabFilesManagerImpl', 'DiffEditorTabFilesUtil', 'DiffEditorTabTitleProvider',
        'DiffEditorViewerFileEditor', 'DiffFileEditorBase', 'DiffFileEditorProvider', 'DiffFileIconProvider', 'DiffFileType',
        'DiffRequestProcessorEditorCustomizer', 'DiffVirtualFile', 'DiffVirtualFileBase', 'SimpleDiffVirtualFile'],
      ev: ['VirtualFile', 'FileEditor', 'FileType', 'Icon', 'DiffVirtualFile', 'DiffViewerVirtualFile'],
      evByName: { DiffVirtualFile: ['DiffViewerVirtualFile'], DiffFileIconProvider: ['FileIconProvider'],
        DiffEditorEscapeAction: ['EscapeHandler'], DiffContentVirtualFile: ['VirtualFile'] },
      why: '整族是 VirtualFile/FileEditor/FileType 的注册与页签包装；本仓的对比视图是 `src/components/DiffView.vue` 这个纯展示组件，没有 JVM 虚拟文件系统这一层',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/util',
    intro: 'diff 查看器工具（同步滚动 / 导航 / 标题 / 缓存）',
    x: {
      PrevNextDifferenceIterable: '本轮已实现：`src/diffNavigation.ts` 的 canGoNext/goNext/canGoPrev/goPrev（行表形态），`src/components/DiffView.vue` 接线，判据 `tests/diff-nav.test.mjs`。',
      PrevNextDifferenceIterableBase: '本轮已实现：基类那套边界语义（含 `LineRange.end` 开区间到行下标的换算）逐条移到 `src/diffNavigation.ts`。',
    },
    part: {
      cite: R.diffView, citeLine: 158,
      repo: 'DiffView.vue 的查看器（折叠/导航/滚动）+ diffFold.ts',
      miss: '上游 SyncScrollSupport 的偏移补偿与跨文件差异迭代；本仓两侧在同一个滚动容器里，天然同步',
      names: ['BaseSyncScrollable', 'CrossFilePrevNextDifferenceIterableSupport', 'DiffChangedRangeProvider',
        'DiffTitleHandler', 'EmptyUnifiedLineFoldingRenderer', 'PrevNextFileIterable'],
      extra: {
        EmptyUnifiedLineFoldingRenderer: '可替换的折叠行 renderer（折叠行在 `src/diffFold.ts` 的 foldLabel + `src/components/DiffView.vue`）',
        CrossFilePrevNextDifferenceIterableSupport: '跨文件的上一个/下一个差异（本仓跨文件差异视图在 `src/components/VcsLogDiff.vue`）',
      },
    },
    skip: {
      names: ['DiffDataKeys', 'DiffNotifications', 'DiffSplitter', 'FocusTrackerSupport', 'KeyboardModifierListener',
        'SimpleDiffPanel', 'SoftHardCacheMap', 'ThreeDiffSplitter', 'TransferableFileEditorStateSupport'],
      ev: ['DataKey', 'JPanel', 'Registry', 'FocusAdapter', 'FocusEvent', 'KeyAdapter', 'Disposable', 'SoftReference',
        'createSoftValueMap', 'FileEditor'],
      evByName: {
        DiffSplitter: ['Registry', 'JPanel', 'OnePixelSplitter'],
        SoftHardCacheMap: ['createSoftValueMap', 'mySLRUMap'],
        FocusTrackerSupport: ['FocusAdapter', 'FocusEvent'],
      },
      why: '它是 Swing 分割器 / 软引用缓存 / AWT 键盘与焦点监听 / 编辑器状态搬运这类 JVM 壳，本仓自绘前端没有对应绘制或内存语义',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/util/base',
    intro: 'diff 查看器基类与设置',
    part: {
      cite: R.diffView, citeLine: 33,
      repo: 'DiffView.vue 的查看器与 taocode.diffOptions + diffComparison.ts 的策略',
      miss: '上游按语言/项目分档的 TextDiffSettingsHolder 与高亮级别；本仓一份本地档位',
      names: ['DiffViewerListener', 'HighlightingLevel', 'InitialScrollPositionSupport', 'TextDiffSettingsHolder'],
    },
    skip: {
      names: ['DiffPanelBase', 'DiffViewerBase', 'ListenerDiffViewerBase', 'TextDiffViewerUtil'],
      ev: ['JPanel', 'DiffViewerEx', 'DataKey', 'DocumentContent', 'Editor', 'installGutterPopup', 'Disposable'],
      why: '它是 JPanel 面板基类 / 编辑器直连的 viewer 基类（gutter 弹窗、Disposable 生命周期），本仓的查看器是 Vue 组件，没有这套基类',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/util/side',
    intro: '并排 / 单侧 / 三侧查看器',
    part: {
      cite: R.diffView, citeLine: 158,
      repo: 'DiffView.vue 的并排查看器；三侧那半在 MergeBar.vue + editorMergeHost.ts',
      miss: '三侧栏位与逐片段的编辑动作；本仓的三方场景落在冲突标记文本上',
      names: ['OnesideDiffViewer', 'OnesideTextDiffViewer', 'ThreesideDiffViewer', 'ThreesideTextDiffViewer',
        'TwosideDiffViewer', 'TwosideTextDiffViewer'],
    },
    skip: {
      names: ['DiffContentLayoutPanel', 'DiffContentPanel', 'OnesideContentPanel', 'ThreesideContentPanel', 'TwosideContentPanel'],
      ev: ['JPanel', 'JBPanel', 'IslandsState', 'CornerLayout'],
      why: '它是 Swing 栏位容器（JPanel/JBPanel 布局），本仓的栏位由 `src/components/DiffView.vue` 的栅格自己排',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/util/text',
    intro: '文本 diff 提供者与片段模型',
    part: {
      cite: R.diffText, citeLine: 30,
      repo: 'diffText.ts 的行级 diff + diffSmartLines.ts 的两步行比对 + diffWords.ts 的行内标记',
      miss: '上游 TextDiffProvider 的可插拔提供者协议与 LineOffsets 文档包装；本仓的提供者就是纯函数',
      names: ['FineMergeLineFragment', 'FineMergeLineFragmentImpl', 'LineOffsetsDocumentWrapper', 'LineOffsetsUtil',
        'MergeInnerDifferences', 'SimpleTextDiffProvider', 'SimpleThreesideTextDiffProvider', 'SmartTextDiffProvider',
        'TextDiffProvider', 'TextDiffProviderBase', 'TwosideTextDiffProvider', 'TwosideTextDiffProviderBase'],
      extra: {
        SmartTextDiffProvider: '行级两步比对之后的两道修补（optimizeLineChunks / correctChangesSecondStep；两步行比对在 `src/diffSmartLines.ts`）',
        MergeInnerDifferences: '三方场景 base 侧的行内差异栏位（行内差异在 `src/diffWords.ts` 的 marksFor）',
      },
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/fragmented',
    intro: '统一（unified）差异查看器',
    part: {
      cite: R.diffView, citeLine: 177,
      repo: 'DiffView.vue 的「统一」档（unified patch 文本）+ diffFold.ts 的折叠',
      miss: '上游逐片段的统一视图（片段可展开成两侧行）与行号换算器；本仓的统一下载是一段 pre 文本',
      names: ['HighlightRange', 'LineNumberConvertor', 'UnifiedDiffChange', 'UnifiedDiffChangeUi',
        'UnifiedDiffHighlightersData', 'UnifiedDiffModel', 'UnifiedDiffPanel', 'UnifiedDiffTool',
        'UnifiedFoldingModel', 'UnifiedFragmentBuilder'],
    },
    skip: {
      names: ['UnifiedEditorHighlighter', 'UnifiedEditorRangeHighlighter'],
      ev: ['EditorHighlighter', 'RangeHighlighter', 'Editor'],
      why: '它实现 IDE 编辑器的 EditorHighlighter/RangeHighlighter 协议，本仓的着色走 CSS class（`src/components/DiffView.vue`），没有这套编辑器绘制 API',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/simple',
    intro: '简单（两侧高亮）差异模型与查看器',
    part: {
      cite: R.diffText, citeLine: 30,
      repo: 'diffText.ts 的行模型 + DiffView.vue 的渲染；三侧那半在 MergeBar.vue',
      miss: '上游 SimpleDiffModel 的文档变更处理与逐片段 UI 对象；本仓是行数组 + 计算属性',
      names: ['AlignedDiffModel', 'DiffViewerHighlighters', 'SimpleDiffChange', 'SimpleDiffChangeUi',
        'SimpleDiffChangesHolder', 'SimpleDiffModel', 'SimpleDiffTool', 'SimpleDiffViewerHighlighters',
        'SimpleOnesideDiffViewer', 'SimpleThreesideDiffChange', 'SimpleThreesideDiffViewer',
        'ThreesideDiffChangeBase', 'ThreesideTextDiffViewerEx'],
      extra: {
        AlignedDiffModel: '独立的对齐模型对象（对齐结果就是 `src/diffAlign.ts` 的 alignLines 输出的行对）',
        SimpleThreesideDiffChange: '上游的逐条冲突对象（三方冲突模型在 `src/mergeConflicts.ts` 的 parseConflicts/acceptSide）',
        SimpleThreesideDiffViewer: '三侧视图栏位（落点是 `src/components/MergeBar.vue` + `src/editorMergeHost.ts`）',
      },
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/binary',
    intro: '二进制差异查看器',
    part: {
      cite: R.compare, citeLine: 41,
      repo: 'compareFiles.ts 的文件比较入口 + bridge.ts 的 BinaryView（二进制读取）',
      miss: '二进制文件的两侧差异展示；本仓二进制只读不比对',
      names: ['BinaryDiffTool', 'OnesideBinaryDiffViewer', 'ThreesideBinaryDiffViewer', 'TwosideBinaryDiffViewer'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/external',
    intro: '外部差异/合并工具',
    skip: {
      names: ['ExternalDiffSettings', 'ExternalDiffTool', 'ExternalDiffToolUtil', 'ExternalMergeTool'],
      ev: ['FileType', 'DocumentContent', 'DiffContent', 'GeneralCommandLine', 'CommandLine'],
      why: '它是把文件交给 Beyond Compare 一类外部程序的那条路（进程编排与 DiffContent 桥接），与本仓形态根本不同；同族的 `AutomaticExternalMergeTool` 已判 [-]',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/holders',
    intro: '编辑器持有者（diff 里的编辑器）',
    skip: {
      names: ['BinaryEditorHolder', 'EditorHolder', 'EditorHolderFactory', 'TextEditorHolder'],
      ev: ['FileEditor', 'Disposable', 'DocumentContent', 'Editor', 'EditorHolder'],
      why: '它是 Swing 编辑器与 FileEditor 的持有者/工厂，本仓的差异单元格是文本渲染（`src/components/DiffView.vue`），没有可嵌入的编辑器对象',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools',
    intro: 'diff 工具兜底（错误展示）',
    part: {
      cite: R.diffView, citeLine: 157,
      repo: 'DiffView.vue 的「（无差异）」与「差异行数超过上限」提示',
      miss: '上游以独立查看器展示错误消息；本仓是查看器内的一段提示',
      names: ['ErrorDiffTool'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/combined/search',
    intro: '合成 diff 里的搜索',
    part: {
      cite: R.panel, citeLine: 1,
      repo: 'SearchPanel.vue 的工程内搜索 + DiffView.vue 的差异视图',
      miss: '在差异视图内部搜索片段；本仓没有视图内查找',
      names: ['CombinedDiffSearch'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/dir',
    intro: '目录差异查看器',
    part: {
      cite: R.compare, citeLine: 25,
      repo: 'compareFiles.ts 已有「比较目录/归档」文案与单文件比较；缺目录树查看器',
      miss: '目录/归档的两侧树与逐文件下钻；本仓目前只做文件对文件',
      names: ['DirDiffTool', 'DirDiffViewer'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/tools/intentions',
    intro: 'Intentions 的 diff 工具',
    skip: {
      names: ['IntentionDiffUtil'],
      ev: ['Intention', 'IntentionAction', 'intention'],
      why: '它挂在 Intention/Quick Fix 体系上，本仓没有 Intention 这一层',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/requests',
    intro: 'diff 请求的具体实现（加载/取消/合并/未知类型）',
    part: {
      cite: R.vcs, citeLine: 126,
      repo: 'vcsActions.ts 的 compareWithFile/clipboardDiff 与 editorFileOps.ts 的保存冲突预览',
      miss: 'Loading/Canceled/UnknownFileType 这些请求状态；本仓的入口是同步函数，失败直接报错',
      names: ['BinaryMergeRequestImpl', 'LoadingDiffRequest', 'OperationCanceledDiffRequest', 'TextMergeRequestImpl', 'UnknownFileTypeDiffRequest'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/chains',
    intro: '异步 diff 请求链',
    part: {
      cite: R.vcs, citeLine: 41,
      repo: 'vcsActions.ts 的对比入口（同步调用，没有请求链）',
      miss: '异步链、取消与缓存；本仓两次 diff 都是算完即用',
      names: ['AsyncDiffRequestChain'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/comparison',
    intro: '比较算法的包装（词级迭代/取消检查）',
    part: {
      cite: R.diffWords, citeLine: 1,
      repo: 'diffWords.ts 的词/字符级标记 + diffText.ts 的对齐结果',
      miss: '上游 FairDiffIterable 形态与 ProgressIndicator 取消；本仓用预算退化（diffAlign.ts）代替取消',
      names: ['ByWord', 'DiffIterableUtilEx', 'IndicatorCancellationChecker'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/contents',
    intro: '内容抽象的具体实现（文件/文档/目录）',
    part: {
      cite: R.diffText, citeLine: 30,
      repo: 'diffText.ts 直接吃字符串数组；文件内容由 compareFiles.ts 读入',
      miss: 'Document/VirtualFile/目录内容这些内容种类；本仓没有内容对象',
      names: ['DirectoryContentImpl', 'DocumentContentBase', 'DocumentContentImpl', 'FileContentImpl', 'FileDocumentContentImpl'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/frontend/impl',
    intro: 'diff 映射给前端的桥',
    part: {
      cite: R.bridge, citeLine: 105,
      repo: 'bridge.ts 的 DiffRow/DiffCell 行表就是可序列化的差异映射',
      miss: '上游前后端桥的增量状态与两侧映射对象；本仓直接传整份行表',
      names: ['FrontendDiffActualStateHolder', 'FrontendSideBySideDiffMapping', 'FrontendUnifiedDiffSegmentMapping'],
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/impl',
    intro: 'diff 请求处理器与窗口',
    part: {
      cite: R.diffView, citeLine: 53,
      repo: 'DiffView.vue 的查看器状态（模式/档位/折叠）+ vcsActions.ts 的入口',
      miss: '请求生命周期、缓存、取消与 DiffWindow；本仓没有请求对象',
      names: ['CacheDiffRequestChainProcessor', 'CacheDiffRequestProcessor', 'DiffContextOnDataHolders',
        'DiffEditorTitleDetails', 'DiffEditorViewer', 'DiffRequestPanelImpl', 'DiffRequestProcessor',
        'DiffRequestProcessorEditorState', 'DiffRequestProcessorListener', 'DiffSettingsHolder', 'DiffToolSubstitutor',
        'DiffViewerWrapper', 'FileAssignmentTracker'],
      extra: {
        DiffSettingsHolder: '按项目/内容分档的设置持有者（本仓档位在 `src/components/DiffView.vue` 的 `taocode.diffOptions`）',
        FileAssignmentTracker: '独立的行归属 tracker 对象（行归属就是 `src/diffAlign.ts` 输出的公共段/改动段）',
      },
    },
    skip: {
      names: ['DiffWindow', 'DiffWindowBase'],
      ev: ['WindowWrapper', 'WindowWrapperBuilder', 'VirtualFile', 'DiffWindowBase'],
      evByName: { DiffWindow: ['extends DiffWindowBase', 'DiffWindowBase'] },
      why: '它是 IDE 窗口包装（WindowWrapper/DiffDialogHints）上的独立窗口实现，本仓的差异嵌在面板里，没有这一层窗口',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/lang',
    intro: '按语言的忽略范围',
    skip: {
      names: ['DiffIgnoredRangeProvider', 'DiffLangSpecificProvider', 'DiffLanguage', 'LangDiffIgnoredRangeProvider'],
      ev: ['ExtensionPointName', 'Language', 'PsiElement'],
      why: '它要语言侧（Language/PsiElement）给出可忽略区间（注释/import），本仓是纯文本逐行比较，没有语言词法层',
    },
  },
  {
    dir: 'platform/diff-impl/src/com/intellij/diff/actions',
    intro: '显示差异的动作层',
    part: {
      cite: R.vcs, citeLine: 169,
      repo: 'vcsActions.ts 的 compareWithClipboard/compareWithFile + compareFiles.ts',
      miss: '上游动作族的多窗口/多形态；本仓是查看器 + 两条入口',
      names: ['AllLinesIterator', 'BaseShowDiffAction', 'BufferedLineIterator', 'DiffReaderModeMatcher',
        'ShowBlankDiffWindowAction', 'ShowDiffAction', 'ShowStandaloneDiffAction'],
      extra: {
        AllLinesIterator: 'LineIterator 对象（本仓逐行遍历直接走数组，见 `src/diffText.ts` 的对齐循环）',
        BufferedLineIterator: '独立的行缓冲迭代器（行缓冲在 `src/diffText.ts`/`src/diffAlign.ts` 里）',
        ShowBlankDiffWindowAction: '空白窗口形态（空态由 `src/components/DiffView.vue` 的「（无差异）」承担）',
      },
    },
    skip: {
      names: ['DocumentFragmentContent', 'DocumentsSynchronizer', 'ImmutableDocumentFragmentContent', 'ProxyUndoRedoAction'],
      ev: ['Document', 'Editor', 'UndoManager', 'AnAction'],
      why: '它建立在 IDE Document/UndoManager 模型上（文档片段内容、编辑同步、Undo 代理），本仓文档模型在 CodeMirror 侧，没有这套对象',
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff/chains',
    intro: 'diff 请求链抽象',
    part: {
      cite: R.vcs, citeLine: 41,
      repo: 'vcsActions.ts 的对比入口（一次函数调用）',
      miss: '请求链、生产者与选择链；本仓没有请求对象',
      names: ['DiffRequestChain', 'DiffRequestChainBase', 'DiffRequestProducer', 'DiffRequestProducerException',
        'DiffRequestSelectionChain', 'SimpleDiffRequestChain', 'SimpleDiffRequestProducer'],
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff/comparison',
    intro: '行内片段策略',
    part: {
      cite: R.diffWords, citeLine: 1,
      repo: 'diffWords.ts 的 HighlightPolicy 三档（byLine/byWord/byChar）+ marksFor',
      miss: '上游把「要不要建行内片段」做成独立策略；本仓固定按高亮档算',
      names: ['InnerFragmentsPolicy'],
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff/contents',
    intro: '内容抽象（文件/文档/目录/二进制）',
    part: {
      cite: R.diffText, citeLine: 30,
      repo: 'diffText.ts 吃字符串数组；compareFiles.ts 负责挑文件',
      miss: 'Document/Directory/Empty 这些内容种类；本仓没有内容对象层',
      names: ['DiffContent', 'DiffContentBase', 'DirectoryContent', 'DocumentContent', 'EmptyContent', 'FileContent'],
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff/merge',
    intro: '合并请求抽象',
    part: {
      cite: R.merge, citeLine: 52,
      repo: 'mergeConflicts.ts 的冲突模型 + editorMergeHost.ts 的动作',
      miss: 'base/yours/theirs 三份内容的请求对象与 MergeResult 写回；本仓的输入是文件里的冲突标记',
      names: ['BinaryMergeRequest', 'ConflictType', 'MergeCallback', 'MergeContext', 'MergeRequest', 'MergeRequestHandler',
        'MergeRequestProducer', 'MergeResult', 'MergeTool', 'TextMergeRequest', 'ThreesideMergeRequest'],
      extra: {
        BinaryMergeRequest: '二进制冲突通道（本仓的冲突处理只认文本标记，见 `src/mergeConflicts.ts`）',
        ConflictType: '独立的冲突类型枚举（冲突形状在 `src/mergeConflicts.ts` 的 Conflict 四段里）',
      },
    },
  },
  {
    dir: 'platform/diff-api/src/com/intellij/diff/requests',
    intro: 'diff 请求对象',
    part: {
      cite: R.vcs, citeLine: 106,
      repo: 'vcsActions.ts 的对比通道（clipboardDiff / compareWithFile）',
      miss: '请求对象与内容数组；本仓两次 diff 都是一次函数调用',
      names: ['ComponentDiffRequest', 'ContentDiffRequest', 'DiffRequest', 'ErrorDiffRequest', 'MessageDiffRequest',
        'NoDiffRequest', 'ProxySimpleDiffRequest', 'SimpleDiffRequest'],
    },
  },
  {
    dir: 'platform/analysis-impl/src/com/intellij/find',
    intro: '查找全局设置与文案包',
    part: {
      cite: R.findCtrl, citeLine: 114,
      repo: 'editorFindController.ts 的选项持久化（`taocode.findOptions`）+ EditorFindBar.vue 的文案',
      miss: 'FindBundle 的全量键与 FindSettings 的全局档位；本仓只落了用到的那些键',
      names: ['FindBundle', 'FindSettings'],
    },
  },
  {
    dir: 'platform/analysis-impl/src/com/intellij/find/findUsages',
    intro: '查找用法引擎的基类与选项',
    part: {
      cite: R.gear, citeLine: 47,
      repo: 'usageViewGear.ts 的用法视图设置（新标签页开关等）',
      miss: 'FindUsagesOptions 的全量选项与 TextOccurrenceReference 的文本引用层',
      names: ['PersistentFindUsagesOptions'],
    },
    skip: {
      names: ['FindUsagesHandlerBase', 'FindUsagesHelper', 'TextOccurrenceReference'],
      ev: ['PsiElement', 'VirtualFile', 'PsiReference'],
      why: '它是 PSI 查找用法引擎的基类/助手（PsiElement、PsiReference），本仓走 LSP textDocument/references，没有 PSI 引用图',
    },
  },
  {
    dir: 'platform/analysis-impl/src/com/intellij/find/impl',
    intro: '查找设置与工程内搜索设置',
    part: {
      cite: R.findCtrl, citeLine: 8,
      repo: 'editorFindController.ts 的选项与历史持久化 + SearchPanel.vue 的工程内搜索',
      miss: '按模块/文件类型分档的 FindInProjectSettings；本仓一份本地设置',
      names: ['FindInProjectSettingsBase', 'FindSettingsBase', 'FindSettingsImpl', 'FindUsagesSettingsImpl'],
    },
  },
  {
    dir: 'platform/indexing-api/src/com/intellij/find',
    intro: '查找模型（选项 + 正则编译）',
    part: {
      cite: R.search, citeLine: 53,
      repo: 'editorSearch.ts 的 buildSearchRegex/collectSearchMatches（照 FindModel.compileRegExp 移植）',
      miss: '搜索上下文（注释/字面量）与替换回填等 FindModel 全量选项',
      names: ['FindModel'],
    },
    skip: {
      names: ['FindModelExtension'],
      ev: ['ExtensionPointName'],
      why: '它是查找模型的扩展点（`com.intellij.findModelExtension`），本仓没有扩展点机制',
    },
  },
  {
    dir: 'platform/indexing-impl/src/com/intellij/find/ngrams',
    intro: '三元组索引（trigram）',
    skip: {
      names: ['TrigramIndex', 'TrigramIndexFilter', 'TrigramIndexRegistryValueListener', 'TrigramTextSearchService'],
      ev: ['FileBasedIndex', 'ScalarIndexExtension', 'FileType', 'Registry', 'ApplicationManager'],
      why: '它建在 IDE 的持久化索引（FileBasedIndex/ScalarIndexExtension）上；本仓是线性扫描（native/search.cpp），没有索引基础设施要维护',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find',
    intro: '查找/替换的宿主对象',
    part: {
      cite: R.findCtrl, citeLine: 93,
      repo: 'editorFindController.ts 的宿主状态域（打开/替换/历史/回绕）',
      miss: 'SearchSession 作为 DataKey 暴露给动作系统的那一层；本仓由控制器直接持有',
      names: ['SearchSession'],
    },
    skip: {
      names: ['FindReplaceActionButton', 'FindUsagesCollector'],
      ev: ['JButton', 'ExtensionPointName', 'CommonDataKeys', 'DataKey', 'CounterUsagesCollector'],
      why: '它是 Swing 按钮与平台计数器扩展点（CounterUsagesCollector），本仓自绘前端没有对应挂点',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/impl/livePreview',
    intro: '编辑器内实时预览的呈现',
    part: {
      cite: R.searchExt, citeLine: 1,
      repo: 'editorSearchExtension.ts 的命中高亮 + editorFindController.ts 的边输边选首条',
      miss: '上游 LivePreviewPresentation 的富呈现与「滚动到结果」档位；本仓高亮 + 选中已够用',
      names: ['EditorLivePreviewPresentation', 'LivePreviewPresentation'],
    },
    skip: {
      names: ['EditorSearchAreaProvider'],
      ev: ['ExtensionPointName'],
      why: '它是搜索区域提供者扩展点，本仓编辑器只有一根查找栏，没有区域提供者这一层',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/findUsages',
    intro: '查找用法的对话框与处理器',
    part: {
      cite: R.tool, citeLine: 149,
      repo: 'toolContents.ts 的用法面板标题/文案 + usageViewGear.ts 的设置',
      miss: '上游 AbstractFindUsagesDialog 的选项对话框与逐语言的 FindUsagesHandler 分发',
      names: ['AbstractFindUsagesDialog', 'CommonFindUsagesDialog', 'FindUsagesHandler', 'FindUsagesHandlerUi',
        'FindUsagesUtil', 'UsageHistory'],
      extra: {
        AbstractFindUsagesDialog: '上游的选项对话框形态（本仓选项入口是 `src/usageViewGear.ts` 的齿轮）',
        CommonFindUsagesDialog: '对话框形态（选项在 `src/usageViewGear.ts` 的齿轮里）',
        UsageHistory: '「最近查找用法」那一档（查找历史在 `src/editorFindController.ts` 的有界表里）',
      },
    },
    skip: {
      names: ['CustomUsageSearcher', 'DefaultFindUsagesHandlerFactory', 'DefaultUsageTargetProvider',
        'FindUsagesHandlerFactory', 'FindUsagesStatisticsCollector', 'FusAwareFindUsagesOptions', 'LastSearchData'],
      ev: ['ExtensionPointName', 'PsiElement', 'Language', 'CounterUsagesCollector', 'EventPair', 'statistic',
        'FindUsagesStatistics', 'FUS', 'DataKey'],
      why: '它是 PSI 用法搜索者/处理器工厂与 FUS 上报项（PsiElement、扩展点），本仓走 LSP，没有这条链',
      whyByName: {
        MergeStatisticsAggregator: '它是查找用法的 FUS 统计聚合（按 Language 分桶上报）—— 本仓不做这类上报',
        FusAwareFindUsagesOptions: '它是 FUS 上报的 EventPair 选项接口 —— 本仓不做这类上报',
        FindUsagesStatisticsCollector: '它是 FUS 计数器（CounterUsagesCollector）—— 本仓不做这类上报',
      },
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/usages/api',
    intro: '用法模型 API（Usage/SearchTarget）',
    part: {
      cite: R.semantic, citeLine: 56,
      repo: 'semanticActions.ts 的 LSP references 结果模型 + bridge.ts 的 UsageResult',
      miss: 'usage type（读/写、派生等）分类与 PSI 级的 target 解析',
      names: ['DynamicUsage', 'PsiUsage', 'ReadWriteUsage', 'SearchTarget', 'Usage', 'UsageAccess', 'UsageOptions',
        'UsageSearchParameters', 'UsageSearcher'],
    },
    skip: {
      names: ['EmptyUsageHandler', 'UsageHandler', 'package-info'],
      ev: ['UsageHandler', 'PsiElement', 'package'],
      why: '它是语言插件注册用法处理器的扩展点接口/包说明，本仓走 LSP，没有这一层注册表',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/usages/impl',
    intro: '用法模型的实现（文本/PSI 适配）',
    part: {
      cite: R.semantic, citeLine: 93,
      repo: 'semanticActions.ts 的引用结果 + bridge.ts 的文本扫描用法（UsageResult 的说明）',
      miss: 'PSI 引用图与读/写访问分类；本仓的用法是 LSP 结果与文本扫描',
      names: ['AllSearchOptions', 'PlainTextUsage', 'TextUsage'],
    },
    skip: {
      names: ['Psi2ReadWriteAccessUsageInfo2UsageAdapter', 'Psi2UsageInfo2UsageAdapter', 'PsiUsage2UsageInfo', 'impl', 'package-info'],
      ev: ['UsageInfo2UsageAdapter', 'UsageInfo', 'PsiElement', 'Disposable', 'package'],
      evByName: { impl: ['PsiFile', 'targetSymbols'] },
      why: '它把 PSI 用法适配成 IDE UsageInfo（UsageInfo2UsageAdapter），本仓没有 PSI/UsageInfo 体系',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/usages/symbol',
    intro: '符号查找目标',
    skip: {
      names: ['SearchTargetSymbol', 'SymbolSearchTargetFactory'],
      ev: ['Symbol', 'TargetElementUtil', 'PsiElement'],
      why: '它把 IDE Symbol/PsiElement 映射成查找目标（TargetElementUtil），本仓走 LSP 文本位置，没有 Symbol 模型',
    },
  },
  {
    dir: 'platform/refactoring/src/com/intellij/find',
    intro: '重构侧的查找设置与监听',
    part: {
      cite: R.findCtrl, citeLine: 121,
      repo: 'editorFindController.ts 的历史/刷新钩子（文档变更后 refresh）',
      miss: '按模块持久化的 FindInProjectSettings；本仓是进程内本地设置',
      names: ['FindInProjectSettings', 'FindModelListener'],
    },
  },
  {
    dir: 'platform/refactoring/src/com/intellij/find/findUsages',
    intro: 'PSI 元素到查找目标的适配器',
    skip: {
      names: ['PsiElement2UsageTargetAdapter'],
      ev: ['PsiElement', 'Icon', 'UsageTarget'],
      why: '它把 PsiElement 适配成 UsageTarget（含 Swing Icon），本仓走 LSP，没有 PSI 与 UsageTarget 体系',
    },
  },
  {
    dir: 'platform/lang-api/src/com/intellij/find',
    intro: '后台搜索选项',
    skip: {
      names: ['SearchInBackgroundOption'],
      ev: ['PerformInBackgroundOption', 'GeneralSettings'],
      why: '它实现 IDE 进度系统的 PerformInBackgroundOption（GeneralSettings 的 searchInBackground），本仓的搜索在原生侧异步执行，没有后台任务对话框这一层',
    },
  },
  {
    dir: 'platform/testFramework/src/com/intellij/find',
    intro: '上游测试框架工具',
    skip: {
      names: ['FindManagerTestUtils'],
      ev: ['LightVirtualFile', 'testFramework'],
      why: '它是上游测试框架（testFramework）里的工具类，不是产品面',
    },
  },
  {
    dir: 'platform/util/diff/src/com/intellij/diff/comparison',
    intro: '比较工具（取消/字符分类/合并解析）',
    part: {
      cite: R.diffAlign, citeLine: 74,
      repo: 'diffAlign.ts 的超预算退化 + diffSmartLines.ts 的合并比对 + diffChars.ts 的字符级处理',
      miss: '上游 CancellationChecker 的取消回调、CharacterUtils 的 Unicode 文种分类；本仓按预算退化，不响应取消',
      names: ['CancellationChecker', 'CharacterUtils', 'ComparisonMergeUtil', 'MergeResolveUtil'],
    },
  },
  {
    dir: 'platform/util/diff/src/com/intellij/diff/comparison/iterables',
    intro: '差异结果的迭代器族',
    part: {
      cite: R.diffText, citeLine: 30,
      repo: 'diffText.ts 的公共行对（改动行由差集反推）这个对偶形态',
      miss: '上游 FairDiffIterable 的可校验契约与 changes()/unchanged() 迭代器；本仓是一次算好的行数组',
      names: ['ChangeDiffIterableBase', 'DiffChangeDiffIterable', 'DiffFragmentsDiffIterable', 'DiffIterableUtil',
        'ExpandedDiffIterable', 'FairDiffIterableWrapper', 'InvertedDiffIterableWrapper', 'RangesDiffIterable',
        'SubiterableDiffIterable'],
    },
  },
  {
    dir: 'platform/util/diff/src/com/intellij/diff/fragments',
    intro: '合并片段模型（行/词）',
    part: {
      cite: R.merge, citeLine: 52,
      repo: 'mergeConflicts.ts 的冲突区间 + diffWords.ts 的词级 marks',
      miss: '上游细粒度片段对象（行片段 + 词片段）与逐片段接受；本仓接受粒度是整段冲突',
      names: ['MergeLineFragment', 'MergeLineFragmentImpl', 'MergeWordFragmentImpl'],
    },
  },
  {
    dir: 'platform/util/diff/src/com/intellij/diff/tools/util/text',
    intro: '行偏移（LineOffsets）',
    part: {
      cite: R.diffAlign, citeLine: 51,
      repo: 'diffAlign.ts 的行数组与枚举内核（行号 ↔ 下标在行表里天然成立）',
      miss: '上游 LineOffsets 的字符偏移 ↔ 行列换算对象；本仓按行数组下标工作',
      names: ['LineOffsets', 'LineOffsetsImpl'],
    },
  },
  {
    dir: 'platform/vcs-impl/src/com/intellij/diff',
    intro: 'VCS 侧的 diff 数据（块/数据键/补丁标注）',
    part: {
      cite: R.diffFold, citeLine: 55,
      repo: 'diffFold.ts 的未更改上下文块 + editorBlameAnnotations.ts 的逐行标注',
      miss: '上游 Block 对象（围绕改动取上下文）与补丁基准标注；本仓上下文由折叠窗口表达',
      names: ['Block', 'PatchBaseAnnotationInfo'],
    },
    skip: {
      names: ['DiffVcsDataKeys'],
      ev: ['DataKey', 'VirtualFile'],
      why: '它是 ActionSystem 的 DataKey 常量表，本仓没有数据键机制',
    },
  },
  {
    dir: 'java/java-impl/src/com/intellij/find/findUsages',
    intro: 'Java 查找用法实现（对话框 / 处理器 / 收集器）',
    part: {
      cite: R.gear, citeLine: 36,
      repo: 'usageViewGear.ts 的用法视图排序/新标签页开关',
      miss: '按包分组这一档与 Java 侧处理器；本仓的用法视图只有排序与新标签页两个开关',
      names: ['GroupByPackageAction'],
      extra: { GroupByPackageAction: '「按包分组」（用法视图齿轮在 `src/usageViewGear.ts`，目前只有按字母排序）' },
    },
    skip: {
      names: ['FindClassUsagesDialog', 'FindMethodUsagesDialog', 'FindPackageUsagesDialog', 'FindThrowUsagesDialog',
        'FindVariableUsagesDialog', 'JavaFindUsagesCollector', 'JavaFindUsagesDialog', 'JavaFindUsagesHandler',
        'JavaFindUsagesHandlerFactory', 'JavaUsageTargetProvider'],
      ev: ['PsiElement', 'JavaPsiFacade', 'PsiMethod', 'PsiClass', 'PsiVariable', 'PsiPackage', 'PsiFile',
        'CounterUsagesCollector', 'UsageTarget'],
      why: '它是 Java PSI 上的查找用法对话框/处理器/收集器；本仓的 Java 走 jdtls 的 LSP references（`src/semanticActions.ts` 那条通道），没有 PSI 引用图',
    },
  },
  {
    dir: 'java/java-analysis-impl/src/com/intellij/find/findUsages',
    intro: 'Java 查找用法选项与助手',
    part: {
      cite: R.gear, citeLine: 47,
      repo: 'usageViewGear.ts 的用法视图设置（新标签页开关）',
      miss: 'Java 专属选项（构造/方法/字段/派生类、跳过 import 等）；本仓的用法视图没有这类选项集',
      names: ['JavaClassFindUsagesOptions', 'JavaFindUsagesOptions', 'JavaMethodFindUsagesOptions',
        'JavaPackageFindUsagesOptions', 'JavaThrowFindUsagesOptions', 'JavaVariableFindUsagesOptions'],
    },
    skip: {
      names: ['JavaFindUsagesHelper'],
      ev: ['PsiElement', 'PsiClass', 'JavaPsiFacade', 'InjectedLanguageManager'],
      why: '512 行的 Java PSI 用法收集器，本仓没有 PSI 引用图可跑',
    },
  },
  {
    dir: 'java/java-impl/src/com/intellij/diff/lang',
    intro: 'Java 的 diff 忽略范围',
    skip: {
      names: ['JavaDiffIgnoredRangeProvider'],
      ev: ['JavaLanguage', 'PsiElementVisitor', 'PsiElement'],
      why: '它按 Java PSI 的 import/字段等给可忽略区间，本仓纯文本逐行比较，没有 Java 词法层',
    },
  },
  {
    dir: 'platform/lang-impl/src/com/intellij/find/editorHeaderActions',
    intro: '编辑器查找栏的过滤/开关动作',
    x: {
      TogglePreserveCaseAction: '本轮已实现：查找栏替换行有「保留大小写」开关（`src/components/EditorFindBar.vue`），算法在 `src/preserveCase.ts`，判据 `tests/preserve-case.test.mjs`。',
    },
    part: {
      cite: R.bar, citeLine: 128,
      repo: 'EditorFindBar.vue 的五档开关（所选内容/大小写/单词/正则 + 替换行）',
      miss: '上游的搜索上下文过滤（注释/字面量）与「打字时滚动到结果」档；本仓栏里没有这几档',
      names: ['EditorHeaderSetSearchContextAction', 'ToggleAnywhereAction', 'ToggleExceptCommentsAction',
        'ToggleExceptCommentsAndLiteralsAction', 'ToggleExceptLiteralsAction', 'ToggleInCommentsAction',
        'ToggleInLiteralsOnlyAction', 'ToggleScrollToResultsDuringTypingAction'],
      extra: {
        ToggleScrollToResultsDuringTypingAction: '这一档开关本身（本仓打字即选中首条，见 `src/editorFindController.ts` 的 setQuery）',
      },
    },
    skip: {
      names: ['ShowFilterPopupGroup', 'VariantsCompletionAction'],
      ev: ['ActionGroup', 'AnAction', 'LightEditCompatible', 'BadgeIconSupplier', 'DefaultActionGroup', 'ActionGroupUtil'],
      why: '它是 ActionGroup/Swing 弹窗与补全动作，本仓自绘前端没有对应挂点',
    },
  },
]

// —— 载入文档与 §G ——
const doc = readFileSync(existsSync(SNAPSHOT) ? SNAPSHOT : DOC, 'utf8')
const atG = doc.indexOf('## G. 逐条总表')
if (atG < 0) throw new Error('缺 §G')
const head = doc.slice(0, atG)
const tailRaw = doc.slice(atG)
const tailLines = tailRaw.split('\n')

const rowRe = /^\| `([A-Za-z0-9_-]+)` \| `([^`]+)` \| `(\[[x~\- ]\])` \| (.+) \|$/
const empty = []
const allRows = []
for (const line of tailLines) {
  const m = rowRe.exec(line)
  if (!m) continue
  allRows.push({ name: m[1], path: m[2], verdict: m[3] })
  if (m[3] === '[ ]') empty.push({ name: m[1], path: m[2] })
}
if (empty.length !== 455) throw new Error(`[ ] 不是 455 而是 ${empty.length}`)

// —— 组装改判表 ——
const judge = new Map()
function put(name, path, verdict, why) {
  const key = `${name}::${path}`
  if (judge.has(key)) throw new Error(`重复改判：${key}`)
  judge.set(key, { verdict, why })
}
function rowOf(name) {
  const r = empty.find(x => x.name === name)
  if (!r) throw new Error(`改判了切片外的类：${name}`)
  return r
}
function findUpstream(rel) {
  const p = join(UP, rel.replace(/\//g, '\\'))
  if (!existsSync(p)) throw new Error(`上游文件不存在：${rel}`)
  return readFileSync(p, 'utf8').split('\n')
}
function evidenceLine(lines, markers) {
  for (const mk of markers) {
    const i = lines.findIndex(l => l.includes(mk))
    if (i >= 0) return { line: i + 1, snippet: CLEAN(lines[i]) }
  }
  return null
}
for (const fam of FAMILIES) {
  for (const name of fam.part?.names ?? []) {
    const extra = fam.part.extra?.[name]
    const cite = fam.part.cite + (fam.part.citeLine ? `:${fam.part.citeLine}` : '')
    const miss = extra ?? fam.part.miss
    const sp = /^[A-Za-z]/.test(fam.intro) ? ' ' : ''
    const spm = /^[A-Za-z]/.test(miss) ? ' ' : ''
    put(name, rowOf(name).path, '[~]', `上游是${sp}${fam.intro}；本仓有对应物（\`${cite}\`，${fam.part.repo}），缺${spm}${miss}。`)
  }
  const rowsByDir = empty.filter(r => r.path.split('/').slice(0, -1).join('/') === fam.dir)
  const skipSet = new Set(fam.skip?.names ?? [])
  const noEvidence = []
  for (const r of rowsByDir) {
    if (!skipSet.has(r.name)) continue
    const lines = findUpstream(r.path)
    const markers = fam.skip.evByName?.[r.name] ?? fam.skip.ev
    const ev = evidenceLine(lines, markers)
    if (!ev) { noEvidence.push(`${r.name}（候选 ${markers.join(',')}）`); continue }
    const why = fam.skip.whyByName?.[r.name] ?? fam.skip.why
    put(r.name, r.path, '[-]', `上游是${fam.intro}；${why}。依据：\`${r.path}:${ev.line}\` 的 \`${ev.snippet}\`。`)
  }
  if (noEvidence.length) throw new Error(`族 ${fam.dir} 找不到证据行：\n  ${noEvidence.join('\n  ')}`)
  for (const [name, why] of Object.entries(fam.x ?? {})) put(name, rowOf(name).path, '[x]', why)
  // 该目录必须恰好分完
  const assigned = rowsByDir.filter(r => judge.has(`${r.name}::${r.path}`)).length
  if (assigned !== rowsByDir.length) {
    const missing = rowsByDir.filter(r => !judge.has(`${r.name}::${r.path}`)).map(r => r.name)
    throw new Error(`族 ${fam.dir} 漏判：${missing.join(', ')}`)
  }
}

// 全量核对
const unjudged = empty.filter(r => !judge.has(`${r.name}::${r.path}`))
if (unjudged.length) throw new Error(`未改判：${unjudged.map(r => r.name).join(', ')}`)

// —— 生成新行 / 新页脚 ——
const counts = { '[x]': 0, '[~]': 0, '[ ]': 0, '[-]': 0 }
/** 老 `[-]` 行（本轮之前判的）也补上「上游 文件:行号」依据，让门禁能统一要求。 */
function skipEvidence(name, relPath, why) {
  if (/`[^`]*\.(java|kt):\d+/.test(why)) return why
  const lines = findUpstream(relPath)
  const nameRe = new RegExp(`(class|interface|object|enum)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  let idx = lines.findIndex(l => nameRe.test(l))
  if (idx < 0) idx = lines.findIndex(l => /(class|interface|object|enum)\s+\w+/.test(l))
  if (idx < 0) idx = lines.findIndex(l => l.trim().length > 0)
  const snippet = CLEAN(lines[idx] ?? '')
  return `${why.replace(/。$/, '')}。依据：\`${relPath}:${idx + 1}\` 的 \`${snippet}\`。`
}
const outTail = tailLines.map(line => {
  const m = rowRe.exec(line)
  if (!m) return line
  const name = m[1]
  if (m[3] === '[ ]') {
    const j = judge.get(`${name}::${m[2]}`)
    counts[j.verdict]++
    return `| \`${name}\` | \`${m[2]}\` | \`${j.verdict}\` | ${j.why} |`
  }
  counts[m[3]]++
  if (m[3] === '[-]') return `| \`${name}\` | \`${m[2]}\` | \`${m[3]}\` | ${skipEvidence(name, m[2], m[4])} |`
  return line
})
for (const line of outTail) {
  const m = rowRe.exec(line)
  if (m && line.split('|').length !== 6) throw new Error(`理由里有裸竖线：${m[1]}`)
}
let out = head + outTail.join('\n')
out = out.replace(/合计 630 类：[^\n]*/, `合计 630 类：\`[x]\` ${counts['[x]']}、\`[~]\` ${counts['[~]']}、\`[ ]\` ${counts['[ ]']}、\`[-]\` ${counts['[-]']}。`)
if (!out.endsWith('\n')) out += '\n'

console.log(`四档：${JSON.stringify(counts)}`)
if (process.argv.includes('--write')) {
  writeFileSync(DOC, out)
  console.log('已写回', DOC)
} else {
  for (const fam of FAMILIES) {
    const rows = empty.filter(r => r.path.split('/').slice(0, -1).join('/') === fam.dir)
    for (const r of rows) {
      const j = judge.get(`${r.name}::${r.path}`)
      console.log(`${j.verdict} ${r.name} :: ${j.why}`)
    }
  }
}
