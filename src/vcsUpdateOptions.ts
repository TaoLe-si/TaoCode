// 「更新项目」的**选项档位 + 默认值 + 对话框形状 + 命令行映射**。纯逻辑，零 Vue、零 DOM。
//
// 上游这一件事由两层拼成，缺一层都解释不通用户看到的东西：
//
//  1) 平台侧骨架 `platform/vcs-impl/src/com/intellij/openapi/vcs/update/`
//     · `UpdateOptionsDialog.kt`（38 行）只加三样东西：对话框尺寸键的后缀 `update-v2`
//       （`:19-21`）、「不再显示」的文案（`:23-25`）、以及**显示开关读写哪个选项**
//       （`:27-37`，读 `StandardOption.UPDATE`）。真正的选项内容它一个字都没写。
//     · `UpdateOrStatusOptionsDialog.java` 是标题/选项卡/OK-Cancel-Help 那一层：
//       单 VCS ⇒ 直接铺一个面板 + 10px 竖撑（`:41-45`），多 VCS ⇒ 按 VCS 显示名排序的
//       选项卡（`:46-51`）；OK 逐个 `apply()`，`ConfigurationException` 弹
//       `message.text.cannot.save.settings`（`:69-83`）；取消时**不保存**（`:96-99`）。
//     · `VcsUpdateProcess.kt:42` 与 `AbstractCommonUpdateAction.kt:37` 决定"这次要不要弹"：
//       `showOptions(project) || OptionsDialog.shiftIsPressed(e.modifiers)` ——
//       **按住 Shift 点「更新项目」无条件弹**，这是用户在 IDEA 里最常用的一条捷径。
//     · `ActionInfo.java:17-58` 给出标题与动作名：标题 `action.display.name.update.scope`
//       （"Update {0}"，`{0}` = 作用域名），动作名 `action.name.update`（"_Update"）；
//       `ScopeInfo.java:30-57` 的 PROJECT 档给作用域名 `update.project.scope.name`（"Project"）。
//
//  2) Git 侧那一页 `plugins/git4idea/backend/src/update/`
//     · `GitUpdateOptionsPanel.kt:29-35` 的**全部内容**就是一个 `buttonsGroup` 里的两个单选，
//       条目来自 `getUpdateMethods()`（`:45`）= `listOf(MERGE, REBASE)`；外面套
//       `JBUI.Borders.empty(8, 8, 2, 8)`（`:36`）。
//     · `GitUpdateOptionsDialog.kt:24-29` 在左下角**前置**一枚「重置到远程分支」
//       （仅当仓库恰好一个时），它先关对话框、弹警告确认，再直接跑 `UpdateMethod.RESET`
//       （`:31-59`）。所以 RESET 是**按钮**，不是单选。
//
// ⚠️ 别把这一页与 `Git.Pull` 的对话框混为一谈：`GitPullDialog` 另有六个 git 参数选项
// （`plugins/git4idea/backend/src/pull/GitPullOption.kt:11-16` 的
// `--rebase/--ff-only/--no-ff/--squash/--no-commit/--no-verify`），缺省**一个都不选**
// （`backend/src/config/GitPullSettings.java:20` `OPTIONS = none()`）。那一页是
// 「Git › 拉取（Pull）」那个动作，与本文件这页是两条不同的路。

/** 上游 `UpdateMethod`（`plugins/git4idea/shared/src/git4idea/config/UpdateMethod.java:12-30`）。 */
export type UpdateMethodId = 'BRANCH_DEFAULT' | 'MERGE' | 'REBASE' | 'RESET'

/** 上游 `GitSaveChangesPolicy`（`shared/src/git4idea/config/GitSaveChangesPolicy.java:9-21`）。 */
export type SaveChangesPolicyId = 'STASH' | 'SHELVE'

/** 一档更新方式在界面上长什么样。文案 zh 取自 `localization-zh.jar` 的
 *  `messages/GitBundle.properties`（见各条的 `zhLine`），en 取自上游
 *  `plugins/git4idea/shared/resources/messages/GitBundle.properties`。 */
export interface UpdateMethodTier {
  id: UpdateMethodId
  /** 短名资源键；单选/菜单用它。 */
  nameKey: string
  name: string
  /** 说明资源键；**选项对话框的单选标签用的是这一条**（不是短名）。 */
  presentationKey: string
  presentation: string
  /** zh 包里的行号（`localization-zh.jar:messages/GitBundle.properties`），取不到则为 null。 */
  zhLine: number | null
  /** 会出现在「更新项目」选项对话框的单选组里吗。 */
  inOptionsDialog: boolean
  /** 会出现在「设置 › 版本控制 › Git › 更新」的单选组里吗（同一份 `getUpdateMethods()`）。 */
  inSettingsRadio: boolean
  /** 语义一句话（照 `GitUpdater.getUpdater` 的分派写，不编）。 */
  semantics: string
}

/**
 * 四档，逐条照 `UpdateMethod.java`：
 * · `BRANCH_DEFAULT`（`:16-17`）：照分支/全局 git 配置现算，**不出现在任何单选组里**
 *   —— `getUpdateMethods()`（`GitUpdateOptionsPanel.kt:45`）只给 MERGE/REBASE 两个。
 *   它作为**存档缺省之外的一个合法值**存在（`GitPushOperation.java:499` 会读它，
 *   并在写回时"不覆盖 branch default 设置"，`:506` 处再解析）。
 * · `MERGE`（`:21-22`）/ `REBASE`（`:26-27`）：选项页的两个单选。
 * · `RESET`（`:29-30`）：左下角那枚按钮（`GitUpdateOptionsDialog.kt:52-59`）。
 */
export const UPDATE_METHOD_TIERS: readonly UpdateMethodTier[] = [
  {
    id: 'BRANCH_DEFAULT',
    nameKey: 'settings.git.update.method.branch.default',
    name: 'Branch Default',
    presentationKey: 'settings.git.update.method.branch.default',
    presentation: 'Branch Default',
    zhLine: 1477,
    inOptionsDialog: false,
    inSettingsRadio: false,
    semantics: '不预设 merge/rebase，按 branch.<name>.rebase → pull.rebase → merge 的顺序现算（GitUpdater.java:81-115）。',
  },
  {
    id: 'MERGE',
    nameKey: 'settings.git.update.method.merge',
    name: 'Merge',
    presentationKey: 'settings.git.update.method.merge.description',
    presentation: 'Merge incoming changes into the current branch',
    zhLine: 1479,
    inOptionsDialog: true,
    inSettingsRadio: true,
    semantics: '取回后 git merge（GitMergeUpdater.java:83-85）。',
  },
  {
    id: 'REBASE',
    nameKey: 'settings.git.update.method.rebase',
    name: 'Rebase',
    presentationKey: 'settings.git.update.method.rebase.description',
    presentation: 'Rebase the current branch on top of incoming changes',
    zhLine: 1481,
    inOptionsDialog: true,
    inSettingsRadio: true,
    semantics: '取回后 git rebase（GitRebaseUpdater.java:68-69）。',
  },
  {
    id: 'RESET',
    nameKey: 'action.Git.Update.Reset.To.Remote.Branch.text',
    name: 'Reset to the Remote Branch',
    presentationKey: 'action.Git.Update.Reset.To.Remote.Branch.description',
    presentation: 'Checks out the corresponding remote branch',
    zhLine: 202,
    inOptionsDialog: false,
    inSettingsRadio: false,
    semantics: '把本地分支重置到跟踪的远程分支，本地提交被丢掉（GitResetUpdater.kt:28-34、GitUpdateOptionsDialog.kt:31-48 的警告确认）。',
  },
]

/** 单选组的**顺序与成员** = `getUpdateMethods()`（`GitUpdateOptionsPanel.kt:45`）：MERGE 在前，REBASE 在后。 */
export const UPDATE_OPTIONS_RADIO_ORDER: readonly UpdateMethodId[] = ['MERGE', 'REBASE']

/**
 * 存档缺省 = MERGE（`shared/src/git4idea/config/GitVcsOptions.kt:30`
 * `var updateMethod: UpdateMethod by enum(UpdateMethod.MERGE)`）。
 * 选项对话框**自己不带缺省** —— 它绑的就是这一份设置（`GitUpdateOptionsPanel.kt:35`
 * `.bind({ settings.updateMethod }, { settings.updateMethod = it })`），
 * 所以"第一次打开时选中哪一档"= 这里。
 */
export const DEFAULT_UPDATE_METHOD: UpdateMethodId = 'MERGE'

/**
 * 「用以下方法清理工作树」的两档（`GitSaveChangesPolicy.java:10-21`）。
 * ⚠️ 这两档**不在更新选项对话框里**：它们在「设置 › 版本控制 › Git › 更新」组里
 * （`backend/src/config/GitVcsPanel.kt:294-299`，标签 `settings.clean.working.tree`）。
 * 对话框只管 merge/rebase，清理策略是**工程级设置**（`GitVcsOptions.kt:26`）。
 */
export interface SaveChangesPolicyTier {
  id: SaveChangesPolicyId
  textKey: string
  text: string
  zhLine: number
  /** 保存/恢复分别落到什么命令；`SHELVE` 不是 git 命令，如实标注。 */
  saveCommand: readonly string[] | null
  restoreCommand: readonly string[] | null
  why: string
}

export const SAVE_CHANGES_POLICIES: readonly SaveChangesPolicyTier[] = [
  {
    id: 'STASH',
    textKey: 'local.changes.save.policy.stash',
    text: 'Stash',
    zhLine: 917,
    saveCommand: ['stash', 'push', '-m', '<message>'],
    restoreCommand: ['stash', 'pop'],
    why: 'GitImpl.java:276-281 的 stashSave（`git stash push -m <msg>`）；取回 GitStashChangesSaver.java:114-118（`git stash pop`，开了暂存区再补 `--index`）。',
  },
  {
    id: 'SHELVE',
    textKey: 'local.changes.save.policy.shelve',
    text: 'Shelve',
    zhLine: 916,
    saveCommand: null,
    restoreCommand: null,
    why: 'IDE 自己的搁架（GitShelveChangesSaver.java:48-53 委托 VcsShelveChangesSaver），**不发任何 git 命令** ⇒ 没有可映射的参数。',
  },
]

/** 存档缺省 = SHELVE（`GitVcsOptions.kt:26` `by enum(GitSaveChangesPolicy.SHELVE)`）。 */
export const DEFAULT_SAVE_CHANGES_POLICY: SaveChangesPolicyId = 'SHELVE'

// ── 对话框上的字面文案（zh 全部取自 `localization-zh.jar:messages/*.properties`）──────────
/** `update.options.display.name`（GitBundle.properties:565；zh GitBundle:1710）= Git 更新设置。 */
export const UPDATE_OPTIONS_PAGE_TITLE = 'Git 更新设置'
/** `update.checkbox.don.t.show.again`（VcsBundle.properties:1184；zh VcsBundle:1149）= 不再显示。 */
export const UPDATE_OPTIONS_DON_T_SHOW_AGAIN = '不再显示'
/** `action.name.update`（VcsBundle.properties:203 "_Update"；zh VcsBundle:76）= 更新(_U)。 */
export const UPDATE_ACTION_NAME = '更新(_U)'
/** `action.display.name.update.scope`（VcsBundle.properties:206；zh VcsBundle:46）= 更新{0}。 */
export const UPDATE_DIALOG_TITLE_TEMPLATE = '更新{0}'
/** `update.project.scope.name`（VcsBundle.properties:214；zh VcsBundle:1183）= 项目。 */
export const UPDATE_SCOPE_PROJECT = '项目'
/** `action.Git.Update.Reset.To.Remote.Branch.text`（GitBundle.properties:683；zh :202）。 */
export const RESET_TO_REMOTE_BRANCH_TITLE = '重置到远程分支'
/** `action.Git.Update.Reset.To.Remote.Branch.confirmation`（GitBundle.properties:685；zh :200）。 */
export const RESET_TO_REMOTE_BRANCH_CONFIRMATION = '是否要将本地分支 {0} 重置为 {1}? 本地提交将被删除'
/** 帮助主题（`GitUpdateConfigurable.java:26-28`）；`null` 时 Help 按钮**禁用**（UpdateOrStatusOptionsDialog.java:130-133）。 */
export const UPDATE_OPTIONS_HELP_TOPIC = 'reference.VersionControl.Git.UpdateProject'
/** 面板四周内边距 8/8/2/8（`GitUpdateOptionsPanel.kt:36` 的 `JBUI.Borders.empty(8, 8, 2, 8)`）。 */
export const UPDATE_OPTIONS_PANEL_BORDER = [8, 8, 2, 8] as const
/** 单 VCS 时面板下方那条竖撑（`UpdateOrStatusOptionsDialog.java:44` `Box.createVerticalStrut(10)`）。 */
export const UPDATE_OPTIONS_BOTTOM_STRUT = 10

/**
 * 这次「更新项目」要不要先弹选项对话框（`VcsUpdateProcess.kt:42` +
 * `AbstractCommonUpdateAction.kt:37`）：**选项开关为真，或按住 Shift**。
 * 开关本身缺省为真 —— `OptionsAndConfirmations.java:77-81` 的 `getOptionValue`
 * 在没存过值时 `return true`。
 */
export function updateOptionsDialogShown(storedOptionValue: boolean | undefined, shiftPressed = false): boolean {
  return (storedOptionValue ?? true) || shiftPressed
}

/**
 * 动作名末尾那个省略号（`AbstractCommonUpdateAction.kt:60-64`）：只有"点了会弹对话框"时才加。
 * 注意它判的是**开关或 Shift**，所以按住 Shift 时菜单项当场就带 `...`。
 */
export function updateActionLabel(actionName: string, willShowOptions: boolean): string {
  return willShowOptions ? `${actionName}...` : actionName
}

/** 单选组里那一行。 */
export interface UpdateOptionRow {
  id: UpdateMethodId
  title: string
  checked: boolean
  run: () => void
}

/** 对话框的**形状**：单 VCS 直接铺一组；多 VCS 每 VCS 一个选项卡（按显示名排序）。 */
export interface UpdateOptionsDialogModel {
  title: string
  /** 只有多于一个 VCS 才 >1（`UpdateOrStatusOptionsDialog.java:46-51`）。 */
  tabs: Array<{ title: string; rows: UpdateOptionRow[] }>
  /** 左下角动作（`GitUpdateOptionsDialog.kt:24-29`）；单仓库时才有「重置到远程分支」。 */
  leftActions: Array<{ id: 'reset-to-remote-branch'; title: string; run: () => void }>
  doNotShowAgain: { title: string; checked: boolean }
  helpTopic: string | null
}

export interface UpdateOptionsState {
  method: UpdateMethodId
  /** 「不再显示」勾着的状态（上游读 `StandardOption.UPDATE`）。 */
  showDialog: boolean
}

export interface UpdateOptionsActions {
  setMethod: (id: UpdateMethodId) => void
  setShowDialog: (value: boolean) => void
  resetToRemoteBranch: () => void
}

export interface UpdateOptionsContext {
  /** 作用域名（PROJECT 档 = 「项目」）；多 VCS 时每个 VCS 一个选项卡，标题用 VCS 显示名。 */
  scopeName?: string
  /** 参与更新的 VCS 显示名列表（`envToConfMap` 的 value 排序后的显示名）。 */
  vcsDisplayNames?: readonly string[]
  /** 仓库数量；恰好 1 时才有「重置到远程分支」（`GitUpdateOptionsDialog.kt:26` 的 `singleOrNull()`）。 */
  repositoryCount?: number
}

/**
 * 选项对话框的模型。三条上游规则落在这里：
 * 1. 单选组成员与顺序 = `getUpdateMethods()`（`GitUpdateOptionsPanel.kt:45`），
 *    **标签用 `presentation`（带助记符的说明句），不是短名**（同文件 `:32` `radioButton(method.presentation, method)`）；
 * 2. 多 VCS 时按**显示名**排序成选项卡（`UpdateOrStatusOptionsDialog.java:48-50`）；
 * 3. 「重置到远程分支」只在**恰好一个仓库**时出现，且在**基础动作之前**
 *    （`GitUpdateOptionsDialog.kt:28` `arrayOf(ResetToRemoteBranchAction(repository), *baseLeft)`）。
 */
export function updateOptionsDialogModel(
  state: UpdateOptionsState,
  actions: UpdateOptionsActions,
  context: UpdateOptionsContext = {},
): UpdateOptionsDialogModel {
  const rows: UpdateOptionRow[] = UPDATE_OPTIONS_RADIO_ORDER.map(id => {
    const tier = updateMethodTier(id)
    return { id, title: tier.presentation, checked: state.method === id, run: () => actions.setMethod(id) }
  })
  const names = context.vcsDisplayNames && context.vcsDisplayNames.length > 1
    ? [...context.vcsDisplayNames].sort((left, right) => left.localeCompare(right))
    : null
  const tabs = names
    ? names.map(title => ({ title, rows }))
    : [{ title: UPDATE_OPTIONS_PAGE_TITLE, rows }]
  const leftActions: UpdateOptionsDialogModel['leftActions'] = (context.repositoryCount ?? 1) === 1
    ? [{ id: 'reset-to-remote-branch', title: RESET_TO_REMOTE_BRANCH_TITLE, run: () => actions.resetToRemoteBranch() }]
    : []
  return {
    title: UPDATE_DIALOG_TITLE_TEMPLATE.replace('{0}', context.scopeName ?? UPDATE_SCOPE_PROJECT),
    tabs,
    leftActions,
    doNotShowAgain: { title: UPDATE_OPTIONS_DON_T_SHOW_AGAIN, checked: !state.showDialog },
    helpTopic: UPDATE_OPTIONS_HELP_TOPIC,
  }
}

/** 按 id 取一档；id 不合法时抛（比返回 undefined 早暴露接线错误）。 */
export function updateMethodTier(id: UpdateMethodId): UpdateMethodTier {
  const tier = UPDATE_METHOD_TIERS.find(item => item.id === id)
  if (!tier) throw new Error(`未知的更新方式：${id}`)
  return tier
}

/** `GitSaveChangesPolicy.getText()` 的等价物（`GitSaveChangesPolicy.java:29-31`）。 */
export function saveChangesPolicyTier(id: SaveChangesPolicyId): SaveChangesPolicyTier {
  const tier = SAVE_CHANGES_POLICIES.find(item => item.id === id)
  if (!tier) throw new Error(`未知的清理策略：${id}`)
  return tier
}

/**
 * `GitConfigUtil.getBooleanValue`（`backend/src/config/GitConfigUtil.java:137-143`）：
 * true/yes/on/1 ⇒ true；false/no/off/0/空串 ⇒ false；其余（含 null）⇒ null（"不认得"）。
 * 大小写不敏感（同文件 `:139` 先 `toLowerCase`）。
 */
export function gitConfigBoolean(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1') return true
  if (normalized === 'false' || normalized === 'no' || normalized === 'off' || normalized === '0' || normalized === '') return false
  return null
}

/**
 * `GitUpdater.isRebaseValue`（`backend/src/update/GitUpdater.java:117-121`）：
 * 布尔真，或字面量 `interactive` / `preserve`（大小写不敏感）。
 */
export function isRebaseConfigValue(value: string): boolean {
  return gitConfigBoolean(value) === true
    || value.toLowerCase() === 'interactive'
    || value.toLowerCase() === 'preserve'
}

export interface BranchDefaultConfig {
  /** `branch.<name>.rebase` 的原始值；读不到给 null。 */
  branchRebase: string | null
  /** `pull.rebase` 的原始值；读不到给 null。 */
  pullRebase: string | null
  /** git 版本是否 ≥ 1.7.9（`GitVersionSpecialty.kt:43` `KNOWS_PULL_REBASE(1,7,9,0)`）。 */
  knowsPullRebase: boolean
}

/**
 * `BRANCH_DEFAULT` 到底解析成 merge 还是 rebase（`GitUpdater.java:81-115`），逐档照抄：
 * 1. `branch.<name>.rebase` 存在时**先**判是不是 rebase 值（`:88-91`）；
 * 2. 否则显式布尔假就**立刻**回 MERGE —— 原文注释说这是"对更宽的 `pull.rebase` 的显式覆盖"
 *    （`:92-95`）；
 * 3. 都不成立才看 `pull.rebase`，且**要求 git ≥ 1.7.9**（`:104-108`）；
 * 4. 兜底 MERGE（`:114`）。
 * 认不出的值会 `LOG.warn` 后继续往下走（`:96`），所以本函数不抛。
 */
export function resolveBranchDefaultUpdateMethod(config: BranchDefaultConfig): 'MERGE' | 'REBASE' {
  if (config.branchRebase !== null) {
    if (isRebaseConfigValue(config.branchRebase)) return 'REBASE'
    if (gitConfigBoolean(config.branchRebase) === false) return 'MERGE'
  }
  if (config.knowsPullRebase && config.pullRebase !== null && isRebaseConfigValue(config.pullRebase)) return 'REBASE'
  return 'MERGE'
}

export interface SaveNeededInput {
  /** 暂存区里有没有东西（`GitUtil.hasLocalChanges(true, …)`，`GitMergeUpdater.java:139`）。 */
  stagedCount: number
  /** 本地改过的路径（`ChangeListManager.getAffectedPaths()`，`GitMergeUpdater.java:159`）。 */
  locallyChangedPaths: readonly string[]
  /** 远端改过的路径（`GitUtil.getPathsDiffBetweenRefs`，`GitMergeUpdater.java:157-158`）。 */
  remotelyChangedPaths: readonly string[]
  /** 这个仓库是不是「游离 HEAD 的子模块」（`GitUpdateProcess.java:327-335` 那一档）。 */
  submoduleInDetachedHead?: boolean
}

/**
 * 这次更新要不要先保存本地更改（`GitUpdater.isSaveNeeded`，`:135-141` 的文档 + 三个实现）：
 * · REBASE 一律要（`GitRebaseUpdater.java:48-58`：有任何本地更改就 true）；
 * · MERGE 只在这两种情况下要（`GitMergeUpdater.java:137-171`）：暂存区非空，
 *   **或**某个本地改过的路径同时也被远端改了；
 * · RESET 不要（`GitResetUpdater.kt:26` `isSaveNeeded() = false`）—— 反正要丢弃；
 * · 游离 HEAD 的子模块一律要（`GitSubmoduleUpdater.kt:24`）。
 * 读不出本地状态时上游一律"保守地当作要保存"（`GitMergeUpdater.java:143-146`、
 * `GitRebaseUpdater.java:54-57` 的 fail safe），本函数用 `stagedCount`/列表表达，
 * 由调用方决定读失败时传什么。
 */
export function isSaveNeeded(method: UpdateMethodId, input: SaveNeededInput): boolean {
  if (input.submoduleInDetachedHead) return true
  if (method === 'RESET') return false
  if (method === 'REBASE') return input.stagedCount > 0 || input.locallyChangedPaths.length > 0
  if (input.stagedCount > 0) return true
  const remote = new Set(input.remotelyChangedPaths)
  return input.locallyChangedPaths.some(path => remote.has(path))
}

/** 计划里的一步：`git` 后面跟的参数，以及**为什么**是这些参数（指到上游行）。 */
export interface PlannedCommand {
  step: string
  args: readonly string[]
  /** 从哪个根目录跑（子模块那一步是从**父**仓库根跑，见 `GitSubmoduleUpdater.kt:30`）。 */
  from?: 'root' | 'parent'
  why: string
}

export interface UpdateCommandContext {
  localBranch: string
  remoteBranch: string
  /** 需要保存本地更改吗（见 `isSaveNeeded`）。 */
  saveLocalChanges?: boolean
  savePolicy?: SaveChangesPolicyId
  stashMessage?: string
  /** 暂存区开着时 `git stash pop` 要补 `--index`（`GitStashChangesSaver.java:117-119`）。 */
  stagingAreaEnabled?: boolean
  /** 游离 HEAD 的子模块根（相对父仓库的路径）。 */
  submoduleRoots?: readonly string[]
}

export interface UpdateCommandPlan {
  /** `BRANCH_DEFAULT` 时为 true —— 调用方得先用 `resolveBranchDefaultUpdateMethod` 定档。 */
  needsResolution: boolean
  commands: readonly PlannedCommand[]
}

/** 取回的步骤（上游所有档位共用的第一步，`GitUpdateProcess.java:157` 的 `fetchAndNotify`）。 */
const FETCH_STEP: PlannedCommand = {
  step: 'fetch',
  args: ['fetch'],
  why: 'GitUpdateProcess.java:357-370：先 fetchRemotes，再交给 updater；所以"更新项目"里没有 pull 这一层。',
}

/**
 * 把一档更新方式翻成**真正会跑的 git 命令**。上游不发 `git pull`：
 * 它先 `fetch`，再按档位分派到 merge / rebase / checkout -B（`GitUpdater.java:63-79`）。
 * 所以这里也按"fetch + 分派"给，而不是硬凑一条 `git pull`。
 *
 * 落法逐条：
 * · MERGE：`git merge <remoteBranch> --no-stat -v`（`GitMergeUpdater.java:83-85`；
 *   参数顺序 = 分支名在前、附加参数在后，见 `GitImpl.java:293-302`）。
 * · REBASE：`git rebase <remoteBranch>`，前面带 `-c core.commentChar=<x>`
 *   （`GitRebaser.java:68-70` + `GitImpl.java:90` 的 `REBASE_CONFIG_PARAMS`；
 *   `-c` 是**前置**到命令之前的，`GitHandler.java:145-148`）。字符值是 U+0001
 *   （`GitUtil.java:110` `COMMENT_CHAR = "\u0001"`）。
 * · RESET：`git checkout -B <localBranch> <remoteBranch>`（`GitResetUpdater.kt:49` 走
 *   `checkoutNewBranchStartingFrom(local, remote, overwriteIfNeeded = true, …)`
 *   → `GitBranchWorker.java:95-99` → `GitImpl.java:346-349` 的 `withReset ? "-B" : "-b"`）。
 * · 子模块（游离 HEAD）：从**父**仓库根跑 `git submodule update --recursive <path>`
 *   （`GitSubmoduleUpdater.kt:28-33`）。
 *
 * ⚠️ 上游**没有** `--autostash`（`grep -rn autostash plugins/git4idea` 零命中）：本地更改
 * 由 IDE 自己 stash/搁架（见 `SAVE_CHANGES_POLICIES`），不是交给 git 的 `pull --autostash`。
 * 也没有 `--no-ff` / `--squash` / `--no-commit` —— 那三个是 `Git.Pull` 那一页的
 * （`GitPullOption.kt:13-15`），不在本页。
 */
export function updateCommandPlan(method: UpdateMethodId, context: UpdateCommandContext): UpdateCommandPlan {
  if (method === 'BRANCH_DEFAULT') return { needsResolution: true, commands: [FETCH_STEP] }
  const commands: PlannedCommand[] = [FETCH_STEP]

  if (context.saveLocalChanges && (context.savePolicy ?? DEFAULT_SAVE_CHANGES_POLICY) === 'STASH') {
    const message = context.stashMessage ?? 'Update'
    commands.push({
      step: 'stash.push',
      args: ['stash', 'push', '-m', message],
      why: 'GitImpl.java:276-281 stashSave（`git stash push -m <msg>`）；只有 STASH 策略才发这条，SHELVE 是 IDE 搁架。',
    })
  }

  if (method === 'REBASE') {
    if (context.saveLocalChanges) {
      commands.push({
        step: 'merge.ff-only',
        args: ['merge', context.remoteBranch, '--ff-only'],
        why: 'GitRebaseUpdater.java:102-136：本地有改动时先试 `git merge --ff-only` 抄近路，成功就不必 stash+rebase（GitUpdateProcess.java:297-313 只在有本地更改时试）。',
      })
    }
    commands.push({
      step: 'rebase',
      args: ['-c', 'core.commentChar=\u0001', 'rebase', context.remoteBranch],
      why: 'GitRebaser.java:68-70 + GitImpl.java:90（REBASE_CONFIG_PARAMS）+ GitHandler.java:145-148（`-c` 前置）；字符 U+0001 见 GitUtil.java:110。',
    })
  } else if (method === 'RESET') {
    commands.push({
      step: 'checkout.reset',
      args: ['checkout', '-B', context.localBranch, context.remoteBranch],
      why: 'GitResetUpdater.kt:42-54 → GitBranchWorker.java:95-99 → GitImpl.java:346-349 的 `-B` 分支。',
    })
  } else {
    commands.push({
      step: 'merge',
      args: ['merge', context.remoteBranch, '--no-stat', '-v'],
      why: 'GitMergeUpdater.java:83-85（`asList("--no-stat", "-v")`）+ GitImpl.java:293-302 的参数顺序（分支名先加）。',
    })
  }

  if (context.saveLocalChanges && (context.savePolicy ?? DEFAULT_SAVE_CHANGES_POLICY) === 'STASH') {
    commands.push({
      step: 'stash.pop',
      args: context.stagingAreaEnabled ? ['stash', 'pop', '--index'] : ['stash', 'pop'],
      why: 'GitStashChangesSaver.java:112-121：恢复在更新之后（GitUpdateProcess.java:270-275 用 `GitPreservingProcess.execute`），暂存区开着补 `--index`。',
    })
  }

  for (const path of context.submoduleRoots ?? []) {
    commands.push({
      step: 'submodule.update',
      args: ['submodule', 'update', '--recursive', path],
      from: 'parent',
      why: 'GitSubmoduleUpdater.kt:28-33：游离 HEAD 的子模块由父仓库根跑 `git submodule update --recursive <path>`。',
    })
  }

  return { needsResolution: false, commands }
}

/**
 * 「这一档等价于 `git pull` 的哪些参数」—— 只给**能指到源码**的那些：
 * · REBASE ⇒ `--rebase`：`GitPullOption.kt:11` 就是 `REBASE("--rebase", …)`，
 *   语义与 `GitRebaseUpdater` 同（后者用 `git rebase` 而不是 `git pull --rebase`，见上）。
 * · MERGE ⇒ `--no-rebase`：**上游源码里没有这个字面量**
 *   （`grep -rn "no-rebase" plugins/git4idea` 零命中，只有 hg 的测试数据里有）。
 *   这里给它是"语义等价"，不是"上游发过这个参数" —— 上游根本不发 pull。
 * · RESET / BRANCH_DEFAULT ⇒ `null`：前者是 `checkout -B`、后者要先解析，
 *   都不是 pull 参数。
 */
export function pullEquivalentArgs(method: UpdateMethodId): readonly string[] | null {
  if (method === 'REBASE') return ['--rebase']
  if (method === 'MERGE') return ['--no-rebase']
  return null
}

/**
 * 「重置到远程分支」那一档要问用户什么（`GitUpdateOptionsDialog.kt:31-48`）：
 * 先要本地分支与跟踪的远程分支，缺任一个就发通知**不做**（`:32-39`），
 * 齐了才弹警告确认（`:44-47`）。返回值 `null` = 不该弹确认。
 */
export function resetToRemoteBranchPrompt(
  localBranch: string | null,
  remoteBranch: string | null,
): { title: string; message: string } | null {
  if (!localBranch || !remoteBranch) return null
  return {
    title: RESET_TO_REMOTE_BRANCH_TITLE,
    message: RESET_TO_REMOTE_BRANCH_CONFIRMATION.replace('{0}', localBranch).replace('{1}', remoteBranch),
  }
}

/**
 * 「更新项目」不成立的两个理由（`GitUpdateProcess.java:377-436`）：游离 HEAD、
 * 或当前分支没有跟踪分支。上游在这两种情况下会**通知并中止**（`:398-401`/`:423-428`），
 * 只在"多根且不是同步模式"时才退化成"跳过这个根"并记下原因（`:403-406`/`:429-433`）。
 * 原因串 = `update.skip.root.reason.detached.head` / `.no.tracked.branch`
 * （en GitBundle.properties:568-569；zh GitBundle.properties:1719-1720）。
 */
export const UPDATE_SKIP_REASONS = {
  detachedHead: { en: 'detached HEAD', zh: '游离的 HEAD' },
  noTrackedBranch: { en: 'no tracked branch', zh: '无跟踪分支' },
} as const

/** 上游那两种"跳过一个根"的原因串。 */
export type UpdateSkipReason = typeof UPDATE_SKIP_REASONS[keyof typeof UPDATE_SKIP_REASONS]

// ══ VCS 日志的速度搜索（`VcsLogSpeedSearch.java`，86 行）══════════════════════════════════
// 与上面更新选项同处一文件，只因本批只允许新建这两个文件（见批次报告的接线请求）。
// 这一段是**纯模型**：哪些列参与、每列的值是什么、哪几列画命中底色。
//
// 三条规则，逐条指到源码：
//
//  1) **逐列比，不是把整行文本拼起来比。** `getElementText` 直接抛异常，原文是
//     "Getting row text in a Log is unsupported since we match columns separately."
//     （`VcsLogSpeedSearch.java:39-41`）；`isMatchingElement` 走
//     `isMatchingMetadata`（`:44-46`），后者对每一列 `compare(column.getValue(...), pattern)`
//     取**任一命中**（`:52-57` 的 `ContainerUtil.exists`）。
//     这和树/列表那类"有一个 getElementText"的速度搜索是**两条路**。
//  2) **参与比的是「可见的元数据列」**：`getColumnsForSpeedSearch`（`:65-67`）
//     = `filterIsInstance(myComponent.getVisibleColumns(), VcsLogMetadataColumn)`。
//     `VcsLogMetadataColumn` 只有四个实现（`ui/table/column/VcsLogDefaultColumn.kt`）：
//     Commit（`:89-90`）、Author（`:154-155`）、Date（`:167`）、Hash（`:202`）；
//     Root 列**不是** metadata 列（`:59`，没实现那个接口）⇒ 根名不参与搜索。
//     默认列序 Root, Commit, Author, Date, Hash（`VcsLogColumnManager.kt:32`）。
//  3) **元数据还没加载的行不命中**：`getCommitMetadata` 在
//     `metadata instanceof LoadingDetails` 时回 null（`:59-63`），而
//     `isMatchingMetadata` 对 null 一律 false（`:55`）。
//
// 命中之后是**选中并滚过去**（`:70-73` `selectElement` → `jumpToGraphRow(row, true)`，
// `VcsLogGraphTable.java:626-630`），不是把不匹配的行藏起来。

/** 参与速度搜索的四列；顺序 = 默认列序去掉 Root（`VcsLogColumnManager.kt:32`）。 */
export type LogSpeedSearchColumn = 'commit' | 'author' | 'date' | 'hash'

export interface LogSpeedSearchColumnRule {
  id: LogSpeedSearchColumn
  /** 上游列对象。 */
  upstreamColumn: 'Commit' | 'Author' | 'Date' | 'Hash'
  /** 这一格的**值**怎么来（逐条指到 `VcsLogDefaultColumn.kt`）。 */
  value: string
  /** 这一列画不画命中底色。 */
  highlights: boolean
  why: string
}

/**
 * 四列的取值与高亮规则。
 *
 * **高亮只画三列**（提交/日期/哈希），三处来源各不相同：
 * · Date（`VcsLogDefaultColumn.kt:186-196`）与 Hash（`:207-211`）把
 *   `withSpeedSearchHighlighting = true` 传进 `VcsLogStringCellRenderer`；
 * · Commit 走**自己的**渲染器（`GraphCommitCellRenderer.kt:265` 里那句
 *   `SpeedSearchUtil.applySpeedSearchHighlighting(table, this, false, isSelected)`），
 *   不是 `VcsLogStringCellRenderer`。
 * · **Author 不画**：`:161` 的 `VcsLogStringCellRenderer(true)` 里那个 `true` 是
 *   **`contentSampleProvider` 位置**的参数（`VcsLogStringCellRenderer.kt:26` 的副构造器
 *   把 `withSpeedSearchHighlighting` 落成 `false`）—— 容易误读成"作者列高亮"。
 * · Root 列不画（`RootCellRenderer.java:46` 是 `SimpleColoredRenderer`，没调高亮）。
 */
export const LOG_SPEED_SEARCH_COLUMNS: readonly LogSpeedSearchColumnRule[] = [
  {
    id: 'commit', upstreamColumn: 'Commit', highlights: true,
    value: '主题（VcsLogDefaultColumn.kt:105 `commit.subject`）。',
    why: '高亮在 GraphCommitCellRenderer.kt:265，不走 VcsLogStringCellRenderer。',
  },
  {
    id: 'author', upstreamColumn: 'Author', highlights: false,
    value: '作者短名，作者与提交者不是同一人时补一个 `*`（:157 → CommitPresentationUtil.java:69-76）。',
    why: '不画命中底色 —— :161 的 `true` 是 contentSampleProvider 参数位，不是高亮开关（VcsLogStringCellRenderer.kt:26）。',
  },
  {
    id: 'date', upstreamColumn: 'Date', highlights: true,
    value: '美化日期时间（:172-177 `DateFormatUtil.formatPrettyDateTime`）。',
    why: 'VcsLogStringCellRenderer(withSpeedSearchHighlighting = true, …)（:186-196）。',
  },
  {
    id: 'hash', upstreamColumn: 'Hash', highlights: true,
    value: '**短**哈希（:204 `commit.id.toShortString()`）。',
    why: 'VcsLogStringCellRenderer(withSpeedSearchHighlighting = true, …)（:207-211）。',
  },
]

/** 参与搜索的列 id（按列序）；勾掉/不可见的列不参与（`:65-67` 取的是 visibleColumns）。 */
export function logSpeedSearchColumnIds(hidden: readonly LogSpeedSearchColumn[] = []): LogSpeedSearchColumn[] {
  return LOG_SPEED_SEARCH_COLUMNS.filter(rule => !hidden.includes(rule.id)).map(rule => rule.id)
}

/** 画命中底色的列 id（**只有** commit/date/hash，见 `LOG_SPEED_SEARCH_COLUMNS` 的说明）。 */
export function logSpeedSearchHighlightColumns(): LogSpeedSearchColumn[] {
  return LOG_SPEED_SEARCH_COLUMNS.filter(rule => rule.highlights).map(rule => rule.id)
}

/**
 * `isMatchingMetadata`（`VcsLogSpeedSearch.java:48-57`）：元数据为空 ⇒ false；
 * 否则**任一**列命中即命中。`matches` 就是 `SpeedSearchBase.compare`
 * （`platform-impl/src/com/intellij/ui/SpeedSearchBase.java:450-452`
 * `pattern != null && myComparator.matchingFragments(pattern, text) != null`）。
 * 本仓的等价物是 `src/speedSearch.ts` 的 `speedSearchMatches`。
 */
export function logRowMatches(
  pattern: string,
  values: Partial<Record<LogSpeedSearchColumn, string | null | undefined>>,
  matches: (pattern: string, text: string) => boolean,
  hidden: readonly LogSpeedSearchColumn[] = [],
): boolean {
  return logSpeedSearchColumnIds(hidden).some(column => {
    const value = values[column]
    return value !== null && value !== undefined && matches(pattern, value)
  })
}

/**
 * 「现在该不该画命中底色」——`SpeedSearchBase.matchingFragments`（`:343-349`）的门：
 * `if (!isPopupActive()) return null`（搜索框不在场就一个区间都不给），
 * 且用的是比较器里**记住的那个** pattern（`:347` `comparator.getRecentSearchText()`），
 * 不是调用方手头那个可能已经改了的串。空串同样没有区间。
 *
 * 切区间那一步本仓已有共享件（`src/searchPreview.ts` 的 `previewSegments` 一族按命中区间切段），
 * 这里只出**门**这一条，避免在组件里再抄一遍。
 */
export function logSpeedSearchHighlights(pattern: string, popupActive: boolean): boolean {
  return popupActive && pattern !== ''
}

/**
 * 日志速度搜索的**总开关**：`Registry.is("vcs.log.speedsearch")` **且** 索引可用
 * （`ui/frame/VcsLogMainGraphTable.java:41-45` 覆写 `isSpeedSearchEnabled`）。
 * ⚠️ 这个注册表项**缺省是 false**（`platform/util/resources/misc/registry.properties:737`，
 * 描述原文 "warning: performance is not excellent"）—— 也就是说上游**默认不开**日志速度搜索，
 * 本仓把它无条件开着，是**有意的偏差**（登记在批次报告里）。
 */
export const LOG_SPEED_SEARCH_REGISTRY_KEY = 'vcs.log.speedsearch'
export const LOG_SPEED_SEARCH_DEFAULT_ENABLED = false

/**
 * 文本筛选器命中高亮是**另一件事**（`registry.properties:745-746`
 * `vcs.log.filter.text.highlight.matches`，缺省 **true**）：它画的是**文本筛选**命中的区间
 * （`GraphCommitCellRenderer.kt:266-271` 用 `textFilter.matchingRanges(text)`），
 * 与速度搜索的 `matchingFragments` 是两套区间。这里只登记键与缺省，不合并两者。
 */
export const LOG_TEXT_FILTER_HIGHLIGHT_KEY = 'vcs.log.filter.text.highlight.matches'
export const LOG_TEXT_FILTER_HIGHLIGHT_DEFAULT = true

/**
 * 作者列的值（`CommitPresentationUtil.java:69-76`）：短名 + 作者≠提交者时的 `*`
 * （机器人报告者也算"同一个人"，`:74`）。本仓没有 committer 字段
 * （`src/vcsLogTypes.ts:7` 的 `GitCommit` 只有 `author`）⇒ 调用方传 committer 为 null 时
 * 不加星号，这是**已登记的偏差**。
 */
export function logAuthorPresentation(author: string, committer: string | null): string {
  if (committer === null || committer === author) return author
  return `${author}*`
}
