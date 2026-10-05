// 「文本筛选器设置」那两个开关的模型（上游 `Vcs.Log.TextFilterSettings` 那一组）。
//
// 上游把它做成**贴着文本筛选框**的一条内联工具条：`VcsLogClassicFilterUi.createTextActionsToolbar`
// （`ui/filter/VcsLogClassicFilterUi.kt:287-311`）装的就是 `Vcs.Log.TextFilterSettings`
// （`intellij.platform.vcs.log.impl.xml:266-269`，只有两条：`Regex` + `MatchCase`），
// 并且用 `FieldInplaceActionButtonLook`（`:307`）⇒ 框内就地按钮，不是独立工具条。
// 两条动作都是 `BooleanPropertyToggleAction`（`ui/actions/EnableFilterByRegexAction.java:24`、
// `EnableMatchCaseAction.java:25`），属性分别是 `MainVcsLogUiProperties.TEXT_FILTER_REGEX`
// 与 `TEXT_FILTER_MATCH_CASE`（`impl/MainVcsLogUiProperties.java:18-19`），
// 缺省都存放在 `VcsLogUiPropertiesImpl.TextFilterSettings` 里，**都是 false**。
//
// 语义落到本仓：`text` 走原生的 `--grep`。`Regex` 关 ⇒ `--fixed-strings`（字面量），
// 开 ⇒ `--extended-regexp`；`MatchCase` 关 ⇒ `--regexp-ignore-case`（忽略大小写），
// 开 ⇒ 不加。上游是在内存索引上用 Java 正则过一遍（`VcsLogTextFilterImpl`），
// 本仓没有那份索引，落到 git 的 grep 是等价的功能面（判据见 native/git_log.cpp 的注释）。
// 换档只改 query 的两个布尔，**立刻重查**（上游 `TextFilterModel` 的
// `PropertiesChangeListener`：档位一变就 `notifyFiltersChanged`，`TextFilterModel.kt:28-38`）。

import type { GitLogQuery } from './bridge'

/** `group.Vcs.Log.TextFilterSettings.text` = 文本筛选器设置。 */
export const TEXT_FILTER_SETTINGS_TITLE = '文本筛选器设置'
/** `group.Vcs.Log.TextFilterSettings.description` = 选择文本筛选器选项。 */
export const TEXT_FILTER_SETTINGS_DESCRIPTION = '选择文本筛选器选项'
/** `action.Vcs.Log.EnableFilterByRegexAction.text` = 正则表达式。 */
export const TEXT_FILTER_REGEX_TITLE = '正则表达式'
/** `action.Vcs.Log.MatchCaseAction.text` = 区分大小写。 */
export const TEXT_FILTER_MATCH_CASE_TITLE = '区分大小写'

export interface TextFilterSettingRow {
  id: string
  /** 上游动作 id。 */
  action: string
  title: string
  description: string
  checked: boolean
  run: () => void
}

export interface TextFilterSettingsState {
  textRegex: boolean
  matchCase: boolean
}

export interface TextFilterSettingsActions {
  setRegex: (value: boolean) => void
  setMatchCase: (value: boolean) => void
}

/** 两条勾选项，顺序照 `intellij.platform.vcs.log.impl.xml:268-269`（Regex 在前）。 */
export function textFilterSettingsModel(state: TextFilterSettingsState, actions: TextFilterSettingsActions): TextFilterSettingRow[] {
  return [
    { id: 'regex', action: 'Vcs.Log.EnableFilterByRegexAction', title: TEXT_FILTER_REGEX_TITLE, checked: state.textRegex,
      description: '把搜索词当作正则表达式，而不是逐字匹配的文本。', run: () => actions.setRegex(!state.textRegex) },
    { id: 'matchCase', action: 'Vcs.Log.MatchCaseAction', title: TEXT_FILTER_MATCH_CASE_TITLE, checked: state.matchCase,
      description: '关着时搜索忽略大小写。', run: () => actions.setMatchCase(!state.matchCase) },
  ]
}

/** 这两个开关在 `GitLogQuery` 上的落法：只有 true 才写（缺省 false，见文件头）。 */
export function textFilterSettingsQuery(state: TextFilterSettingsState): Partial<GitLogQuery> {
  const patch: Partial<GitLogQuery> = {}
  if (state.textRegex) patch.textRegex = true
  if (state.matchCase) patch.matchCase = true
  return patch
}

/** 从 query 反读（存档读回与渲染共用一份判据）。 */
export function textFilterSettingsState(query: GitLogQuery): TextFilterSettingsState {
  return { textRegex: query.textRegex === true, matchCase: query.matchCase === true }
}
