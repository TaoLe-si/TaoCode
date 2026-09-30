// 提交面板里**逐字取自中文包**的文案（值 = 随 IDE 发货的 `localization-zh` 里的取值，逐条给 key）。
//
// 为什么单独放一个模块：这些字不是"我们写的 UI 文案"，而是**上游资源包的值**，
// 改动它们等于改上游的说法。集中一处 + 判据锁住（`tests/scm-panel-strings.test.mjs`），
// 免得再出现"看起来像 IDEA 的说法"其实是自己编的（第四十五/四十六批各抓到过一处）。

/** `VcsBundle` `checkbox.amend` = `修正(_M)` —— 下划线是助记符，界面上就是「修正(M)」。 */
export const AMEND_CHECKBOX_TEXT = '修正(M)'
/** `VcsBundle` `commit.message.placeholder` —— 提交信息框的占位文本（非模态面板传的就是这一条）。 */
export const COMMIT_MESSAGE_PLACEHOLDER = '提交消息'
/** `ActionsBundle` `action.Vcs.ShowMessageHistory.text` —— 「提交消息历史记录」那个动作的名字。 */
export const MESSAGE_HISTORY_TEXT = '提交消息历史记录'
/** `ActionsBundle` `action.Vcs.ShowMessageHistory.description`（同动作的说明）。 */
export const MESSAGE_HISTORY_DESCRIPTION = '显示提交消息历史记录'
/** `Vcs.ToggleAmendCommitMode` 的键位：`$default.xml:1057-1059` = `alt M`。 */
export const AMEND_SHORTCUT_TEXT = 'Alt+M'
/**
 * 非模态面板那枚复选框的浮层：上游是 `HelpTooltip().setTitle(动作文案).setShortcut(...)`，
 * **没有描述**（`ToggleAmendCommitModeAction.kt:30` 把 presentation 的 description 清成 null，
 * 而动作注册里也没有 description 属性）—— 所以这里只有"标题 + 快捷键"。
 */
export const AMEND_TOOLTIP = `${AMEND_CHECKBOX_TEXT}（${AMEND_SHORTCUT_TEXT}）`

/** `ActionsBundle` `action.ExpandAll.text` —— 变更树头部那对按钮（上图标、无快捷键进提示）。 */
export const EXPAND_ALL_TEXT = '全部展开'
/** `ActionsBundle` `action.CollapseAll.text` —— 注意包里是「收起」不是「折叠」。 */
export const COLLAPSE_ALL_TEXT = '全部收起'
