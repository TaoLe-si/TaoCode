// `src/components/icons/**` 的统一入口。
//
// 本仓有**两条**图标通道，各有明确边界（判据 `tests/idea-icons.test.mjs` 钉住）：
//
//   1. **IDEA expui**（本目录）—— 上游有同名 SVG 的那些位置：工具窗口条（`ToolStripe.vue`）、
//      工具窗口内容标签（`ContentComboLabel.vue`）、状态栏工具窗口弹层（`App.vue`）。
//      这些位置在 IDEA 里画的是 16/20 格双形态图，用 lucide 顶替等于换了图形。
//   2. **lucide**（`lucide-vue-next`）—— 上游没有对应图标、或语义对不上（如 Gradle 之外的
//      第三方动作、本仓自有控件）。全仓 98 个 .vue 里绝大多数图标属于这一档，**不迁移**。
//
// 所以这个入口不是"把所有图标收成一处"（那会把 lucide 也拖进来、白白多一层间接），
// 而是把**IDEA 原样图标**这件事收成一处：名字 → `IdeaIcon` 组件 + 上游出处。
import { IdeaIcon } from './IdeaIcon.ts'
import { IDEA_ICON_16, IDEA_ICON_20, IDEA_ICON_20_NAMES, IDEA_ICON_NAMES, IDEA_ICON_STATUS, IDEA_ICON_STATUS_NAMES, ideaIconShape, ideaStatusIconShape, ideaStatusIconSvg, type IdeaIconShape } from './ideaIconData.ts'

export { IdeaIcon, IDEA_ICON_16, IDEA_ICON_20, IDEA_ICON_20_NAMES, IDEA_ICON_NAMES, IDEA_ICON_STATUS, IDEA_ICON_STATUS_NAMES, ideaIconShape, ideaStatusIconShape, ideaStatusIconSvg }
export type { IdeaIconShape }

/**
 * 工具窗口 id → IDEA 图标名。上游依据是各插件的 `<toolWindow … icon="…">` 注册：
 *   · `intellij.platform.lang.impl.xml:1329` Project → `AllIcons.Toolwindows.ToolWindowProject`（`expui/toolwindows/project.svg`）
 *   · `VcsExtensions.xml:185` Commit → `ToolWindowCommit`（`expui/toolwindows/commit.svg`）
 *   · `VcsExtensions.xml:193` Version Control → `ToolWindowChanges`（`expui/toolwindows/vcs.svg`）
 *   · `intellij.platform.todo.xml:60` TODO → `ToolWindowTodo`
 *   · `intellij.platform.structureView.xml:55` Structure → `ToolWindowStructure`
 *   · `intellij.platform.bookmarks.xml:47` Bookmarks → `ToolWindowBookmarks`
 *   · `intellij.platform.ide.impl.xml:1211` Notifications → `AllIcons.Toolwindows.Notifications`
 *   · `intellij.platform.lang.impl.actions` Find（`ActivateFindToolWindowAction.kt:32`）→ `ToolWindowFind`
 *   · `ActivateDebugToolWindowAction.kt:18` Debug → `ToolWindowDebugger`（`expui/toolwindows/debug.svg`）
 *   · `intellij.gradle.xml:228` Gradle → `GradleIcons.ToolWindowGradle`（`gradle/resources/icons/expui/gradle.svg`）
 *
 * `AllIcons.Toolwindows.ToolWindowChanges` 在图标表里映射到的**就是** `expui/toolwindows/vcs.svg`
 * （`AllIcons.java:1497`），不是同名文件 —— 这一条是最容易取错的一个。
 */
export const TOOL_WINDOW_IDEA_ICON: Record<string, string> = {
  files: 'project',
  git: 'commit',
  vcslog: 'vcs',
  search: 'find',
  todo: 'todo',
  outline: 'structure',
  bookmarks: 'bookmarks',
  debug: 'debug',
  gradle: 'gradle',
  notifications: 'notifications',
  // Agent 对话（**本仓自有窗口**，上游 IDEA 没有对应物）：取上游 AI 助手的工具窗口图标
  // `AllIcons.ToolWindowAskAI`（`platform/util/ui/src/com/intellij/icons/AllIcons.java:1494`
  // = `expui/toolwindows/toolWindowAskAI.svg`，三叶扇形）。
  // 上一版这里拿 lucide 的机器人顶替，等于把工具窗口条的 16/20 格双形态换成了 24 格描边图 ——
  // `tests/idea-icons.test.mjs` 的「注册表不许退回 lucide」与「toolWindowMeta 不许 import lucide」两条门就是冲它去的。
  agent: 'askAI',
}

/**
 * 底部固定内容 id → IDEA 图标名。这几格在 IDEA 里不是 `<toolWindow>` 注册，而是
 * `changesViewContent` / 各自的 ContentManager 内容，图标取内容自己的：
 *   · `output`  → 上游没有"操作输出"这一格（本仓自有），取 Messages 工具窗口的图标
 *     （`AllIcons.Toolwindows.ToolWindowMessages`，`expui/toolwindows/messages.svg`）；
 *   · `run`     → `ToolWindowRun`（`expui/toolwindows/run.svg`）；
 *   · `problems`→ `ToolWindowProblems`（`expui/toolwindows/problems.svg`）；
 *   · `references` → 用法视图（Find 窗口里的内容），取 Find 的图标（`ToolWindowFind`）；
 *   · `hierarchy` → `ToolWindowHierarchy`（`expui/toolwindows/hierarchy.svg`）；
 *   · `terminal`  → `TerminalIcons.OpenTerminal_13x13`（`terminal/resources/icons/expui/toolwindow/terminal.svg`，
 *     `terminal.xml:4` 就是用它注册 Terminal 窗口的）。
 */
export const BOTTOM_CONTENT_IDEA_ICON: Record<string, string> = {
  output: 'messages',
  run: 'run',
  problems: 'problems',
  references: 'find',
  hierarchy: 'hierarchy',
  terminal: 'terminal',
}