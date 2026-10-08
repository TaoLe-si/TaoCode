// 工具窗口条 / 内容标签用的 IDEA 原样图标，包成"只吃 `size`"的组件。
//
// 薄壳的生成逻辑在 `./IdeaIcon.ts` 的 `ideaIconComponent`（为什么要包一层见那里的注释）；
// 这里只做一件事：**把图标名与上游出处绑在一起**。每一个名字下面都写着它的
// `<toolWindow … icon="…">` 注册出处 —— 名字拼错在这里就看得出来，
// 而不是等到渲染时静默画空。
import { ideaIconComponent, ideaStatusIconComponent } from './IdeaIcon.ts'

// 工具窗口条那一族（注册表 `src/toolWindowMeta.ts` 的 `icon` 字段用）。
// 出处见 `./index.ts` 的 `TOOL_WINDOW_IDEA_ICON`。
export const IdeaProjectIcon = ideaIconComponent('project')
export const IdeaCommitIcon = ideaIconComponent('commit')
export const IdeaVcsIcon = ideaIconComponent('vcs')
export const IdeaFindIcon = ideaIconComponent('find')
export const IdeaTodoIcon = ideaIconComponent('todo')
export const IdeaStructureIcon = ideaIconComponent('structure')
export const IdeaBookmarksIcon = ideaIconComponent('bookmarks')
export const IdeaDebugIcon = ideaIconComponent('debug')
export const IdeaGradleIcon = ideaIconComponent('gradle')
export const IdeaNotificationsIcon = ideaIconComponent('notifications')
// Agent 对话窗口：上游 `AllIcons.ToolWindowAskAI`（`AllIcons.java:1494`）——
// IDEA 里 AI 助手的工具窗口图标就是这一枚，不是本仓发明的机器人形状。
export const IdeaAskAIIcon = ideaIconComponent('askAI')

// 底部内容标签那一族（`ContentComboLabel.vue` 的固定内容）。
// 出处见 `./index.ts` 的 `BOTTOM_CONTENT_IDEA_ICON`。
export const IdeaMessagesIcon = ideaIconComponent('messages')
export const IdeaRunIcon = ideaIconComponent('run')
export const IdeaProblemsIcon = ideaIconComponent('problems')
export const IdeaHierarchyIcon = ideaIconComponent('hierarchy')
export const IdeaTerminalIcon = ideaIconComponent('terminal')
export const IdeaBuildIcon = ideaIconComponent('build')

// 侧条的「更多」按钮（上游 `MoreSquareStripeButton.kt:94` 用的是
// `AllIcons.Actions.MoreHorizontal` = `expui/general/moreHorizontal.svg`，
// 20px 时按 `loadIconCustomVersionOrScale` 去取 `moreHorizontal@20x20.svg`）。
export const IdeaMoreHorizontalIcon = ideaIconComponent('moreHorizontal')

// 菜单行的勾选记号：上游是 `AllIcons.Actions.Checked` = `expui/actions/checked.svg`
// （`AllIcons.java:39`，`PlatformIcons.CHECK_ICON:65`）。16 格那一份，**没有** 20 格变体
// （`loadIconCustomVersion` 找不到 `checked@20x20.svg` 就退回 16 格，见 `ideaIconData.ts`）。
// 挂法见 `JBCefMenuAdapter.kt:51`：菜单项 `checked` 为真时画它，否则留一个 16 格空位。
export const IdeaCheckedIcon = ideaIconComponent('checked')

// 「全部后台任务已完成」那条标签的图标：`AllIcons.Status.Success` = `expui/status/success.svg`
// （`AllIcons.java:1432`），挂法见 `TasksFinishedDecorator.kt:36` 的 `icon = AllIcons.Status.Success`。
// 语义色表那一支（绿盘 + 白勾），所以走 `ideaStatusIconComponent`。
export const IdeaSuccessIcon = ideaStatusIconComponent('success')

// 状态栏进程部件的**空闲**态：上游 `AsyncProcessIcon`（`AsyncProcessIcon.java:22`）挂起的图标是
// `AllIcons.Process.Step_passive`（`AllIcons.java:1269` = `process/step_passive.svg`），
// `InfoAndProgressPanel.updateProgressIcon`（`:562-571`）在没有任务或省电模式下调 `suspend()` 切到它。
export const IdeaStepPassiveIcon = ideaIconComponent('stepPassive')

// 通知/气泡的信息图标：`MessageType.INFO` 的默认图标是 `AllIcons.General.BalloonInformation`
// （`MessageType.java:19`）= `expui/status/info.svg`（`AllIcons.java:544`）。语义色表那一支。
export const IdeaInfoIcon = ideaStatusIconComponent('info')

// 气泡的错误图标：`MessageType.ERROR` 的默认图标是 `AllIcons.General.BalloonError`
// （`MessageType.java:14`）= `expui/status/error.svg`（`AllIcons.java:543`）。语义色表那一支。
export const IdeaErrorIcon = ideaStatusIconComponent('error')

// 主菜单按钮（汉堡）的两态：上游 `MainMenuWithButton.getButtonIcon()`（`:142`）在
// 未合并主菜单时返回 `AllIcons.General.WindowsMenu_20x20`（`AllIcons.java:683`），
// 合并时返回 `AllIcons.General.ChevronRight`（`:550`，16 格那份）。
// 尺寸由 `JBUI.burgerMenuButtonIconSize()`（`:1313`）定为 20 —— 本仓调用点写 `iconSize.rail`。
export const IdeaMainMenuIcon = ideaIconComponent('mainMenu')
export const IdeaChevronRightIcon = ideaIconComponent('chevronRight')

// 主工具栏右端两颗（`MainToolbarNewUI` 的 SearchEverywhere + SettingsEntryPoint）：
// `AllIcons.Actions.Find`（`AllIcons.java:67` = `expui/general/search.svg`）与
// `AllIcons.General.Settings`（`:660` = `expui/general/settings.svg`），两者都有 `@20x20` 变体。
export const IdeaSearchIcon = ideaIconComponent('search')
export const IdeaSettingsIcon = ideaIconComponent('settings')

// 三方合并编辑器「接受左侧 / 接受右侧」的两颗：上游 `intellij.platform.ide.actions.xml:54-55`
// 的 `Diff.ApplyLeftSide` = `AllIcons.Diff.ArrowRight`、`Diff.ApplyRightSide` = `AllIcons.Diff.Arrow`
// （`AllIcons.java:424/427`）—— 方向箭头，不是勾（原先本仓画勾，是发明形状）。
export const IdeaApplyLeftSideIcon = ideaIconComponent('applyLeftSide')
export const IdeaApplyRightSideIcon = ideaIconComponent('applyRightSide')

// 工具窗口标题栏的齿轮（New UI）：上游 `ToolWindowImpl.kt:848-852` 的 `GearActionGroup`
// 在 `isNewUi` 时用 `AllIcons.Actions.More`（`AllIcons.java:117` = `expui/general/moreVertical.svg`）
// —— 竖排三点，不是齿轮（老 UI 那一支才是 `General.GearPlain` = `settings.svg`）。
export const IdeaMoreVerticalIcon = ideaIconComponent('moreVertical')