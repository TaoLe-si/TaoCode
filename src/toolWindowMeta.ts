// 工具窗口元数据：标题 / 图标 / Alt+数字助记符顺序。
// 从 App.vue 拆出（桃 2026-09-26：模块化）；纯数据 + 纯函数，无状态依赖。
import { Bell, Bookmark as BookmarkIcon, Boxes, Bug, Files, FolderTree, GitBranch, GitGraph, ListChecks, Search } from 'lucide-vue-next'
import { mnemonicBindings, mnemonicOf } from './toolWindows.ts'
// 与 App 的 `typeof leftView.value` 同值域（那边是 ref 推导，模块内显式写出，结构兼容）。
// 'gradle' = IDEA 的 Gradle 工具窗口（`plugins/gradle/plugin-resources/intellij.gradle.xml:228`
// `<toolWindow id="Gradle" anchor="right" …>` —— 默认停靠**右侧**）。
// 'notifications' = IDEA 的 Notifications 工具窗口（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:1210`：
// `<toolWindow id="Notifications" anchor="right" secondary="true" …>`）—— 本仓原先只有状态栏的计数入口。
// 'history' 不在列：IDEA 的 Local History 是 ShowHistoryAction 打开的**对话框**，不是工具窗口
//（ToolWindowId.java / 各 <toolWindow> 注册里都没有它）；TaoCode 同款改为对话框（App.vue 的
// LocalHistoryDialog）。'tests' 同理已移除：IDEA 没有 Tests 工具窗口，测试树长在 **Run 控制台**里
//（SM test runner 渲染在 Run 工具窗口内容区），TestRunnerPanel 挂到底部 run 标签。
export type ToolWindowId = 'files' | 'git' | 'vcslog' | 'search' | 'todo' | 'outline' | 'bookmarks' | 'debug' | 'gradle' | 'notifications'

export const toolTitles: Record<ToolWindowId, string> = {
  files: '项目', git: '源代码管理', vcslog: 'VCS 日志', search: '搜索', todo: '任务',
  outline: '结构', bookmarks: '书签', debug: '调试',
  gradle: 'Gradle', notifications: '通知',
}

export const toolIcons: Record<ToolWindowId, unknown> = {
  files: Files, git: GitBranch, vcslog: GitGraph, search: Search, todo: ListChecks,
  outline: FolderTree, bookmarks: BookmarkIcon, debug: Bug,
  // lucide 没有 Gradle 图标；用"模块/构件"语义的 Boxes 表示工程结构树。
  gradle: Boxes, notifications: Bell,
}

// IDEA binds Alt+<digit> to a tool window through the *keymap* — ActivateToolWindowAction
// .Manager.getMnemonicForToolWindow reads the shortcut of `Activate<Id>ToolWindow`
// (ActivateToolWindowAction.kt:88-111) and StripeButton prints it as "<digit>: <title>"
// (StripeButton.kt:287-298). The number therefore belongs to the tool window and never to
// its position on the stripe: dragging stripe buttons around must not renumber anything.
// TaoCode keeps one stable order for the mnemonics, separate from the draggable
// `toolOrder` that only decides where a button is drawn.
// 工具窗口的**枚举顺序**（三条磁贴、底部分页条、状态栏弹窗都按它列）—— 与助记符顺序解耦，
// 见下面 `TOOL_MNEMONIC_ORDER`。
export const toolWindowOrder: ToolWindowId[] = ['files', 'git', 'vcslog', 'search', 'todo', 'outline', 'bookmarks', 'debug', 'gradle', 'notifications']

/**
 * 每个停靠边的**默认顺序**（条纹上的排列）。
 *
 * **单一来源**：原先这张表在四处各写了一份（`toolWindowStripes` 的 `toolOrder`、
 * `toolLayouts` 的 `DEFAULT_TOOL_ORDER`，还有两份 `BOTTOM_TABS`），而且内容**互不一致** ——
 * `toolWindowStripes` 里把 `vcslog/todo/debug` 列在 `left` 下、`bottom` 却是空的，
 * `toolLayouts` 那份则是另一套旧顺序。改一处漏三处，正是"表抄多份"的典型代价。
 * 现在只在这里定义，且**必须与 `toolAnchors` 的默认值一致**。
 */
export type ToolWindowAnchor = 'left' | 'right' | 'bottom'

/**
 * 每个工具窗口的**默认停靠边** —— 唯一来源。依据是 IDEA 的 `<toolWindow id="…" anchor="…">` 注册：
 * Project/Commit/Bookmarks/Structure=`left`（`intellij.platform.lang.impl.xml:1329`、`bookmarks.xml:47`）、
 * TODO/Version/Problems/Terminal/Debug/Tests=`bottom`、Gradle/Notifications=`right`
 * （`intellij.gradle.xml:228`、`intellij.platform.ide.impl.xml:1210`）。
 *
 * 原先这张表在 `toolWindowStripes`（正确）与 `toolLayouts`（**全写成 left**）里各有一份，
 * 后者会让"工厂默认布局"把所有窗口都摆在左侧。
 */
export const DEFAULT_TOOL_ANCHORS: Record<ToolWindowId, ToolWindowAnchor> = {
  // search = IDEA 的 Find：`defaultToolWindowlayoutProvider.kt:246` 把它配在 **bottom**
  // （V1 默认布局 Bottom = Version Control / Find / Run / Debug / Inspection）。
  files: 'left', git: 'left', outline: 'left', bookmarks: 'left',
  vcslog: 'bottom', search: 'bottom', todo: 'bottom', debug: 'bottom',
  gradle: 'right', notifications: 'right',
}

export const DEFAULT_TOOL_ORDER: Record<'left' | 'right' | 'bottom', ToolWindowId[]> = {
  // IDEA V2 左栏默认顺序 = Project → Commit → Structure（`defaultToolWindowlayoutProvider.kt:257-267`），
  // 注册在 left 的 Bookmarks（`bookmarks.xml:47`）排在其后。
  left: ['files', 'git', 'outline', 'bookmarks'],
  // IDEA：Gradle(right) `intellij.gradle.xml:228`、Notifications(right) `ide.impl.xml:1210`
  right: ['gradle', 'notifications'],
  // IDEA V1 底部 = Version Control → Find → Run → Debug（`defaultToolWindowlayoutProvider.kt:244-249`），
  // TODO/Debug 按 `todo.xml:60`、`:248` 的注册停靠底部。
  bottom: ['vcslog', 'search', 'todo', 'debug'],
}

/**
 * 底部面板的**标签顺序**：前面几个是固定的内容标签，后面跟着"停靠在底部的工具窗口"。
 *
 * `'about'` **不在**这里 —— IDEA 的「关于」是「帮助 › 关于」的**对话框**（`AboutAction`），
 * 不是工具窗口；本仓把它塞进底部面板是一处错放，已删除（`AboutDialog.vue` 本来就有）。
 *
 * `'blame'` 同样**不在**这里（2026-09-27 修正）—— IDEA 的「Annotate」不是内容标签：
 * `AnnotateToggleAction.java:139-153` 的 `doAnnotate(editor, …)` 拿到的是 `Editor`，注解由
 * `TextAnnotationGutterProvider`（同文件 `:18` 直接 import）画在**编辑器装订线**上；
 * `intellij.platform.ide.impl.xml` 的 `<toolWindow>` 清单里根本没有 Annotate，
 * 它出现在底部面板是一处错放。现在走 `src/editorBlameAnnotations.ts` 的 gutter，
 * 由 `CodeEditor.vue` 的 `:blame` 属性消费。
 */
export const BOTTOM_TABS = ['output', 'run', 'problems', 'references', 'hierarchy', 'terminal'] as const
export type BottomTabId = (typeof BOTTOM_TABS)[number]

/**
 * 助记符只用**有 Alt+数字 动作的那些**窗口。
 *
 * Gradle 工具窗口在 IDEA 里没有 `ActivateGradleToolWindow` 动作（插件注册里只有
 * `toolWindow id="Gradle" anchor="right"`，没有任何快捷键绑定），所以它不该出现在
 * Alt+数字 的编号里 —— 否则界面上会多出一个 IDEA 里不存在的 "Alt+11"。
 */
// 只有 IDEA 里真有 `Activate<Id>ToolWindow` 动作的窗口才占编号：Gradle 与 Notifications 都没有
// （Notifications 是 `secondary` 工具窗口，见 intellij.platform.ide.impl.xml:1210）。
export const TOOL_MNEMONIC_ORDER: ToolWindowId[] = toolWindowOrder.filter(id => id !== 'gradle' && id !== 'notifications')

// IDEA's keymap also binds Alt+0 to the Commit tool window; TaoCode's 源代码管理 panel
// *is* the commit tool window (message box + changes + commit actions), so it answers
// Alt+0 in addition to its own stripe number (ActivateToolWindowAction.kt:88-111).
export const TOOL_MNEMONIC_ALIASES: Record<string, ToolWindowId> = { '0': 'git' }

export const TOOL_MNEMONIC_BINDINGS = mnemonicBindings(TOOL_MNEMONIC_ORDER, TOOL_MNEMONIC_ALIASES)

export function toolWindowMnemonic(id: ToolWindowId): string | undefined {
  return mnemonicOf(TOOL_MNEMONIC_ORDER, id)
}
