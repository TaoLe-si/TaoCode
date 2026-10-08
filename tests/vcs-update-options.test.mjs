// 「更新项目」选项档位 —— 上游 `UpdateOptionsDialog` / `GitUpdateOptionsPanel` / `UpdateMethod`
// / `GitSaveChangesPolicy` / `GitUpdater` 的移植。每条断言都指到源码行（见 `src/vcsUpdateOptions.ts` 的注释）。
//
// 这个文件只做两件事：把**档位与默认值**钉死，把**命令行映射**钉死。
// 它不测对话框组件（本仓还没有那层组件；接线请求见批次报告），也不重复测速度搜索的匹配算法
// （那在 `tests/speed-search.test.mjs`）—— 这里只做一条**跨模块一致性**断言：
// 日志速度搜索喂给匹配器的字段集，必须与上游 `getColumnsForSpeedSearch` 取到的那一列一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SAVE_CHANGES_POLICY, DEFAULT_UPDATE_METHOD, LOG_SPEED_SEARCH_COLUMNS,
  LOG_SPEED_SEARCH_DEFAULT_ENABLED, LOG_SPEED_SEARCH_REGISTRY_KEY, LOG_TEXT_FILTER_HIGHLIGHT_DEFAULT,
  LOG_TEXT_FILTER_HIGHLIGHT_KEY, RESET_TO_REMOTE_BRANCH_CONFIRMATION,
  RESET_TO_REMOTE_BRANCH_TITLE, SAVE_CHANGES_POLICIES, UPDATE_ACTION_NAME,
  UPDATE_DIALOG_TITLE_TEMPLATE, UPDATE_METHOD_TIERS, UPDATE_OPTIONS_BOTTOM_STRUT,
  UPDATE_OPTIONS_DON_T_SHOW_AGAIN, UPDATE_OPTIONS_HELP_TOPIC, UPDATE_OPTIONS_PAGE_TITLE,
  UPDATE_OPTIONS_PANEL_BORDER, UPDATE_OPTIONS_RADIO_ORDER, UPDATE_SCOPE_PROJECT, UPDATE_SKIP_REASONS,
  gitConfigBoolean, isRebaseConfigValue, isSaveNeeded, logAuthorPresentation, logRowMatches,
  logSpeedSearchColumnIds, logSpeedSearchHighlightColumns, logSpeedSearchHighlights,
  pullEquivalentArgs, resetToRemoteBranchPrompt, resolveBranchDefaultUpdateMethod,
  saveChangesPolicyTier, updateActionLabel, updateCommandPlan, updateMethodTier,
  updateOptionsDialogModel, updateOptionsDialogShown,
} from '../src/vcsUpdateOptions.ts'
import { logSpeedSearchColumns } from '../src/vcsLogPresentation.ts'

test('更新方式四档：成员、顺序、谁进单选组（UpdateMethod.java:12-30 + GitUpdateOptionsPanel.kt:45）', () => {
  assert.deepEqual(UPDATE_METHOD_TIERS.map(tier => tier.id), ['BRANCH_DEFAULT', 'MERGE', 'REBASE', 'RESET'])
  assert.deepEqual(UPDATE_OPTIONS_RADIO_ORDER, ['MERGE', 'REBASE'], '选项页只有两个单选，且 MERGE 在前')
  assert.equal(updateMethodTier('BRANCH_DEFAULT').inOptionsDialog, false, 'Branch Default 不是单选（只在存档里合法）')
  assert.equal(updateMethodTier('RESET').inOptionsDialog, false, 'RESET 是左下角按钮，不是单选')
  assert.deepEqual(
    UPDATE_METHOD_TIERS.filter(tier => tier.inOptionsDialog).map(tier => tier.id),
    ['MERGE', 'REBASE'],
    '进对话框的就是 getUpdateMethods() 那两个',
  )
  assert.deepEqual(
    UPDATE_METHOD_TIERS.filter(tier => tier.inSettingsRadio).map(tier => tier.id),
    ['MERGE', 'REBASE'],
    '设置页用的是同一个 getUpdateMethods()（GitVcsPanel.kt:288）',
  )
})

test('更新方式文案：单选标签用 presentation（带助记符那句），不是短名', () => {
  assert.equal(updateMethodTier('MERGE').presentation, 'Merge incoming changes into the current branch')
  assert.equal(updateMethodTier('REBASE').presentation, 'Rebase the current branch on top of incoming changes')
  assert.equal(updateMethodTier('MERGE').name, 'Merge')
  assert.equal(updateMethodTier('REBASE').name, 'Rebase')
  assert.equal(updateMethodTier('BRANCH_DEFAULT').name, 'Branch Default')
  assert.equal(updateMethodTier('RESET').name, 'Reset to the Remote Branch')
  assert.equal(updateMethodTier('RESET').nameKey, 'action.Git.Update.Reset.To.Remote.Branch.text')
  assert.throws(() => updateMethodTier('NOPE'), /未知的更新方式/)
})

test('默认档：更新方式 MERGE（GitVcsOptions.kt:30），清理策略 SHELVE（同文件 :26）', () => {
  assert.equal(DEFAULT_UPDATE_METHOD, 'MERGE')
  assert.equal(DEFAULT_SAVE_CHANGES_POLICY, 'SHELVE')
  assert.equal(saveChangesPolicyTier('SHELVE').text, 'Shelve')
  assert.equal(saveChangesPolicyTier('STASH').text, 'Stash')
  assert.throws(() => saveChangesPolicyTier('NOPE'), /未知的清理策略/)
})

test('清理工作树两档：只有 Stash 能映射到 git 命令，Shelve 是 IDE 搁架（如实为 null）', () => {
  assert.deepEqual(SAVE_CHANGES_POLICIES.map(tier => tier.id), ['STASH', 'SHELVE'])
  assert.deepEqual(saveChangesPolicyTier('STASH').saveCommand, ['stash', 'push', '-m', '<message>'])
  assert.deepEqual(saveChangesPolicyTier('STASH').restoreCommand, ['stash', 'pop'])
  assert.equal(saveChangesPolicyTier('SHELVE').saveCommand, null, '搁架不发 git 命令')
  assert.equal(saveChangesPolicyTier('SHELVE').restoreCommand, null)
})

test('对话框上的字面文案（zh 取自 localization-zh.jar）', () => {
  assert.equal(UPDATE_OPTIONS_PAGE_TITLE, 'Git 更新设置')
  assert.equal(UPDATE_OPTIONS_DON_T_SHOW_AGAIN, '不再显示')
  assert.equal(UPDATE_ACTION_NAME, '更新(_U)')
  assert.equal(UPDATE_DIALOG_TITLE_TEMPLATE, '更新{0}')
  assert.equal(UPDATE_SCOPE_PROJECT, '项目')
  assert.equal(RESET_TO_REMOTE_BRANCH_TITLE, '重置到远程分支')
  assert.equal(RESET_TO_REMOTE_BRANCH_CONFIRMATION, '是否要将本地分支 {0} 重置为 {1}? 本地提交将被删除')
  assert.equal(UPDATE_OPTIONS_HELP_TOPIC, 'reference.VersionControl.Git.UpdateProject')
  assert.deepEqual(UPDATE_OPTIONS_PANEL_BORDER, [8, 8, 2, 8])
  assert.equal(UPDATE_OPTIONS_BOTTOM_STRUT, 10)
})

test('弹不弹对话框：开关缺省为真（OptionsAndConfirmations.java:77-81），Shift 无条件弹（VcsUpdateProcess.kt:42）', () => {
  assert.equal(updateOptionsDialogShown(undefined), true, '没存过值时上游给 true')
  assert.equal(updateOptionsDialogShown(undefined, true), true)
  assert.equal(updateOptionsDialogShown(true), true)
  assert.equal(updateOptionsDialogShown(false), false)
  assert.equal(updateOptionsDialogShown(false, true), true, '按住 Shift 点「更新项目」必弹')
})

test('动作名末尾的省略号只在"点了会弹"时加（AbstractCommonUpdateAction.kt:60-64）', () => {
  assert.equal(updateActionLabel('更新项目', true), '更新项目...')
  assert.equal(updateActionLabel('更新项目', false), '更新项目')
})

test('对话框形状：单选组两个、单仓库才有「重置到远程分支」且在基础动作之前', () => {
  const calls = []
  const actions = {
    setMethod: id => calls.push(['method', id]),
    setShowDialog: value => calls.push(['show', value]),
    resetToRemoteBranch: () => calls.push(['reset']),
  }
  const single = updateOptionsDialogModel({ method: 'MERGE', showDialog: true }, actions, { repositoryCount: 1 })
  assert.equal(single.title, '更新项目', 'action.display.name.update.scope 的 {0} 填作用域名')
  assert.equal(single.tabs.length, 1, '单 VCS 直接铺面板，不建选项卡')
  assert.deepEqual(single.tabs[0].rows.map(row => row.title), [
    'Merge incoming changes into the current branch',
    'Rebase the current branch on top of incoming changes',
  ])
  assert.deepEqual(single.tabs[0].rows.map(row => row.checked), [true, false], '选中的是存档里的 MERGE')
  assert.deepEqual(single.leftActions.map(action => action.id), ['reset-to-remote-branch'])
  assert.equal(single.doNotShowAgain.title, '不再显示')
  assert.equal(single.doNotShowAgain.checked, false, 'showDialog=true ⇒ 没勾"不再显示"')

  single.tabs[0].rows[1].run()
  single.leftActions[0].run()
  assert.deepEqual(calls, [['method', 'REBASE'], ['reset']], '点单选/左按钮都要真的回调')

  const manyRepos = updateOptionsDialogModel({ method: 'REBASE', showDialog: false }, actions, { repositoryCount: 3 })
  assert.deepEqual(manyRepos.leftActions, [], '多仓库时上游 singleOrNull() 为 null ⇒ 不出现这枚按钮')
  assert.deepEqual(manyRepos.tabs[0].rows.map(row => row.checked), [false, true])
  assert.equal(manyRepos.doNotShowAgain.checked, true)
})

test('多 VCS：按显示名排序成选项卡（UpdateOrStatusOptionsDialog.java:48-50）', () => {
  const actions = { setMethod: () => {}, setShowDialog: () => {}, resetToRemoteBranch: () => {} }
  const model = updateOptionsDialogModel({ method: 'MERGE', showDialog: true }, actions, {
    vcsDisplayNames: ['Subversion', 'Git'], scopeName: '项目', repositoryCount: 2,
  })
  assert.deepEqual(model.tabs.map(tab => tab.title), ['Git', 'Subversion'], '排序按显示名，不是传入顺序')
  assert.equal(model.tabs.length, 2)
  const one = updateOptionsDialogModel({ method: 'MERGE', showDialog: true }, actions, { vcsDisplayNames: ['Git'] })
  assert.equal(one.tabs.length, 1, '只有一个 VCS 时仍然不建选项卡')
})

test('gitConfigBoolean 照 GitConfigUtil.java:137-143 的表', () => {
  for (const value of ['true', 'yes', 'on', '1', 'TRUE', 'Yes', 'ON']) assert.equal(gitConfigBoolean(value), true, `${value} 为真`)
  for (const value of ['false', 'no', 'off', '0', '', 'FALSE', 'No']) assert.equal(gitConfigBoolean(value), false, `${value} 为假`)
  for (const value of ['maybe', 'interactive', 'preserve', '2']) assert.equal(gitConfigBoolean(value), null, `${value} 认不出`)
  assert.equal(gitConfigBoolean(null), null)
  assert.equal(gitConfigBoolean(undefined), null)
})

test('isRebaseConfigValue：布尔真 + interactive / preserve（GitUpdater.java:117-121）', () => {
  assert.equal(isRebaseConfigValue('true'), true)
  assert.equal(isRebaseConfigValue('yes'), true)
  assert.equal(isRebaseConfigValue('interactive'), true)
  assert.equal(isRebaseConfigValue('INTERACTIVE'), true, '上游 equalsIgnoreCase')
  assert.equal(isRebaseConfigValue('preserve'), true)
  assert.equal(isRebaseConfigValue('false'), false)
  assert.equal(isRebaseConfigValue(''), false)
  assert.equal(isRebaseConfigValue('maybe'), false)
})

test('BRANCH_DEFAULT 的解析顺序（GitUpdater.java:81-115）', () => {
  // branch.<name>.rebase 命中 rebase 值 ⇒ REBASE，不看 pull.rebase
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: 'true', pullRebase: 'false', knowsPullRebase: true }), 'REBASE')
  // branch.<name>.rebase 显式假 ⇒ 立刻 MERGE，**覆盖**更宽的 pull.rebase=true
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: 'false', pullRebase: 'true', knowsPullRebase: true }), 'MERGE')
  // 认不出的值 ⇒ 继续往下走，看 pull.rebase
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: 'maybe', pullRebase: 'true', knowsPullRebase: true }), 'REBASE')
  // 没有 branch 配置时才看 pull.rebase，且要求 git >= 1.7.9
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: null, pullRebase: 'true', knowsPullRebase: true }), 'REBASE')
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: null, pullRebase: 'true', knowsPullRebase: false }), 'MERGE',
    '老 git 不认识 pull.rebase ⇒ 兜底 MERGE')
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: null, pullRebase: null, knowsPullRebase: true }), 'MERGE')
  assert.equal(resolveBranchDefaultUpdateMethod({ branchRebase: null, pullRebase: 'preserve', knowsPullRebase: true }), 'REBASE')
})

test('要不要先保存本地更改（GitUpdater.java:135-141 + 三个实现）', () => {
  const noChanges = { stagedCount: 0, locallyChangedPaths: [], remotelyChangedPaths: [] }
  assert.equal(isSaveNeeded('RESET', { ...noChanges, locallyChangedPaths: ['a.ts'] }), false, 'RESET 一律不保存（GitResetUpdater.kt:26）')
  assert.equal(isSaveNeeded('REBASE', noChanges), false, '没有本地改动就不必保存')
  assert.equal(isSaveNeeded('REBASE', { ...noChanges, locallyChangedPaths: ['a.ts'] }), true, 'REBASE 有本地改动就保存')
  assert.equal(isSaveNeeded('MERGE', noChanges), false)
  assert.equal(isSaveNeeded('MERGE', { ...noChanges, stagedCount: 1 }), true, '暂存区非空 ⇒ 保存')
  assert.equal(isSaveNeeded('MERGE', { ...noChanges, locallyChangedPaths: ['a.ts'], remotelyChangedPaths: ['b.ts'] }), false,
    '改了但远端没动同一个文件 ⇒ 不保存')
  assert.equal(isSaveNeeded('MERGE', { ...noChanges, locallyChangedPaths: ['a.ts'], remotelyChangedPaths: ['a.ts'] }), true,
    '同一个文件本地远端都改了 ⇒ 保存')
  assert.equal(isSaveNeeded('BRANCH_DEFAULT', noChanges), false, 'BRANCH_DEFAULT 自己不需要保存判定，交由解析后的档位')
  assert.equal(isSaveNeeded('MERGE', { ...noChanges, submoduleInDetachedHead: true }), true,
    '游离 HEAD 的子模块一律保存（GitSubmoduleUpdater.kt:24）')
})

test('命令行映射：MERGE / REBASE / RESET 三档的参数逐字照上游', () => {
  const base = { localBranch: 'feature', remoteBranch: 'origin/main' }
  const merge = updateCommandPlan('MERGE', base)
  assert.equal(merge.needsResolution, false)
  assert.deepEqual(merge.commands.map(command => command.step), ['fetch', 'merge'])
  assert.deepEqual(merge.commands[1].args, ['merge', 'origin/main', '--no-stat', '-v'],
    'GitMergeUpdater.java:83-85 的参数 + GitImpl.java:293-302 的顺序（分支名先加）')
  assert.equal(merge.commands[0].args.join(' '), 'fetch', '上游先 fetch，不发 git pull（GitUpdateProcess.java:157）')

  const rebase = updateCommandPlan('REBASE', base)
  assert.deepEqual(rebase.commands.map(command => command.step), ['fetch', 'rebase'])
  assert.deepEqual(rebase.commands[1].args, ['-c', 'core.commentChar=\u0001', 'rebase', 'origin/main'],
    'GitRebaser.java:68-70 + GitImpl.java:90 + GitHandler.java:145-148（-c 前置）；字符 U+0001 见 GitUtil.java:110')

  const reset = updateCommandPlan('RESET', base)
  assert.deepEqual(reset.commands.map(command => command.step), ['fetch', 'checkout.reset'])
  assert.deepEqual(reset.commands[1].args, ['checkout', '-B', 'feature', 'origin/main'],
    'GitResetUpdater.kt:49 → GitImpl.java:346-349 的 -B 分支')

  const branchDefault = updateCommandPlan('BRANCH_DEFAULT', base)
  assert.equal(branchDefault.needsResolution, true, '得先 resolveBranchDefaultUpdateMethod')
  assert.deepEqual(branchDefault.commands.map(command => command.step), ['fetch'])
})

test('命令行映射：保存/恢复本地更改与抄近路的 --ff-only', () => {
  const base = { localBranch: 'feature', remoteBranch: 'origin/main', saveLocalChanges: true }
  const merge = updateCommandPlan('MERGE', { ...base, savePolicy: 'STASH', stashMessage: 'Update' })
  assert.deepEqual(merge.commands.map(command => command.step), ['fetch', 'stash.push', 'merge', 'stash.pop'])
  assert.deepEqual(merge.commands[1].args, ['stash', 'push', '-m', 'Update'])
  assert.deepEqual(merge.commands[3].args, ['stash', 'pop'])
  assert.deepEqual(updateCommandPlan('MERGE', { ...base, savePolicy: 'STASH', stagingAreaEnabled: true }).commands[3].args,
    ['stash', 'pop', '--index'], '暂存区开着补 --index（GitStashChangesSaver.java:117-119）')
  assert.deepEqual(updateCommandPlan('MERGE', { ...base, savePolicy: 'SHELVE' }).commands.map(command => command.step),
    ['fetch', 'merge'], 'Shelve 不发 git 命令，所以没有 stash 那两步')

  const rebase = updateCommandPlan('REBASE', { ...base, savePolicy: 'STASH' })
  assert.deepEqual(rebase.commands.map(command => command.step), ['fetch', 'stash.push', 'merge.ff-only', 'rebase', 'stash.pop'])
  assert.deepEqual(rebase.commands[2].args, ['merge', 'origin/main', '--ff-only'], 'GitRebaseUpdater.java:121')
  const noSave = updateCommandPlan('REBASE', { localBranch: 'f', remoteBranch: 'origin/m' })
  assert.deepEqual(noSave.commands.map(command => command.step), ['fetch', 'rebase'],
    '没有本地更改时不试 --ff-only（GitUpdateProcess.java:304-309 只在有改动时试）')
})

test('命令行映射：子模块那一步从**父**仓库根跑（GitSubmoduleUpdater.kt:28-33）', () => {
  const plan = updateCommandPlan('MERGE', {
    localBranch: 'main', remoteBranch: 'origin/main', submoduleRoots: ['libs/foo'],
  })
  const submodule = plan.commands.find(command => command.step === 'submodule.update')
  assert.deepEqual(submodule.args, ['submodule', 'update', '--recursive', 'libs/foo'])
  assert.equal(submodule.from, 'parent')
})

test('上游没有 --autostash / --no-ff / --squash / --no-commit 这些参数', () => {
  const allArgs = ['MERGE', 'REBASE', 'RESET', 'BRANCH_DEFAULT'].flatMap(method =>
    updateCommandPlan(method, { localBranch: 'f', remoteBranch: 'origin/m', saveLocalChanges: true }).commands.flatMap(command => [...command.args]))
  for (const forbidden of ['--autostash', '--no-ff', '--squash', '--no-commit', '--no-verify', 'pull']) {
    assert.equal(allArgs.includes(forbidden), false, `${forbidden} 不该出现（那是 Git.Pull 那一页的选项，GitPullOption.kt:11-16）`)
  }
})

test('等价 pull 参数：只有 REBASE 有字面出处，MERGE 那条是语义等价', () => {
  assert.deepEqual(pullEquivalentArgs('REBASE'), ['--rebase'], 'GitPullOption.kt:11 的字面量')
  assert.deepEqual(pullEquivalentArgs('MERGE'), ['--no-rebase'], '语义等价；上游源码里没有这个字面量')
  assert.equal(pullEquivalentArgs('RESET'), null, 'RESET 是 checkout -B，不是 pull 参数')
  assert.equal(pullEquivalentArgs('BRANCH_DEFAULT'), null, '得先解析')
})

test('「重置到远程分支」：缺本地/远程分支就不该弹确认（GitUpdateOptionsDialog.kt:31-48）', () => {
  assert.deepEqual(resetToRemoteBranchPrompt('feature', 'origin/main'), {
    title: '重置到远程分支',
    message: '是否要将本地分支 feature 重置为 origin/main? 本地提交将被删除',
  })
  assert.equal(resetToRemoteBranchPrompt(null, 'origin/main'), null, '游离 HEAD ⇒ 发通知、不弹确认')
  assert.equal(resetToRemoteBranchPrompt('feature', null), null, '没有跟踪分支 ⇒ 发通知、不弹确认')
  assert.equal(resetToRemoteBranchPrompt('', ''), null)
})

test('跳过一个根的两条原因串（GitBundle.properties:568-569 / zh :1719-1720）', () => {
  assert.equal(UPDATE_SKIP_REASONS.detachedHead.en, 'detached HEAD')
  assert.equal(UPDATE_SKIP_REASONS.detachedHead.zh, '游离的 HEAD')
  assert.equal(UPDATE_SKIP_REASONS.noTrackedBranch.en, 'no tracked branch')
  assert.equal(UPDATE_SKIP_REASONS.noTrackedBranch.zh, '无跟踪分支')
})

test('跨模块一致性：日志速度搜索的字段集 = 上游 getColumnsForSpeedSearch 取到的那一列', () => {
  // VcsLogSpeedSearch.java:65-67 = filterIsInstance(getVisibleColumns(), VcsLogMetadataColumn)；
  // 四个 metadata 列是 Commit(:89-90) / Author(:154-155) / Date(:167) / Hash(:202)，
  // 默认列序 Root, Commit, Author, Date, Hash（VcsLogColumnManager.kt:32）⇒ 去掉 Root 就是这四列。
  // 本仓喂给 speedSearchMatches 的正是这四格（vcsLogPresentation.ts:434-439）；
  // 哈希那一格取**短哈希**（上游 Hash 列的值就是 `commit.id.toShortString()`，VcsLogDefaultColumn.kt:204）。
  const row = { subject: 'subject', author: 'author', date: 'date', hash: 'hash', shortHash: 'short' }
  assert.deepEqual(logSpeedSearchColumns(row, []), ['subject', 'author', 'date', 'short'])
  assert.deepEqual(logSpeedSearchColumns(row, ['author', 'hash']), ['subject', 'date'],
    '勾掉的列与上游"不可见列不参与"同一口径')
})

// ── 速度搜索（VcsLogSpeedSearch.java）──────────────────────────────────────────────────
test('参与搜索的四列与默认列序（VcsLogColumnManager.kt:32 去掉 Root）', () => {
  assert.deepEqual(LOG_SPEED_SEARCH_COLUMNS.map(rule => rule.id), ['commit', 'author', 'date', 'hash'])
  assert.deepEqual(LOG_SPEED_SEARCH_COLUMNS.map(rule => rule.upstreamColumn), ['Commit', 'Author', 'Date', 'Hash'])
  assert.equal(LOG_SPEED_SEARCH_COLUMNS.some(rule => rule.id === 'root'), false, 'Root 不是 metadata 列（:59）⇒ 根名不参与搜索')
  assert.deepEqual(logSpeedSearchColumnIds(), ['commit', 'author', 'date', 'hash'])
  assert.deepEqual(logSpeedSearchColumnIds(['author']), ['commit', 'date', 'hash'], '不可见列不参与（:65-67）')
})

test('命中底色只画三列；作者列那个 `true` 是别的参数位（VcsLogStringCellRenderer.kt:26）', () => {
  assert.deepEqual(logSpeedSearchHighlightColumns(), ['commit', 'date', 'hash'])
  assert.equal(LOG_SPEED_SEARCH_COLUMNS.find(rule => rule.id === 'author').highlights, false,
    'Author 的 VcsLogStringCellRenderer(true) 里 true 是 contentSampleProvider 位置（VcsLogDefaultColumn.kt:161）')
  assert.equal(LOG_SPEED_SEARCH_COLUMNS.find(rule => rule.id === 'date').highlights, true)
  assert.equal(LOG_SPEED_SEARCH_COLUMNS.find(rule => rule.id === 'hash').highlights, true)
  assert.equal(LOG_SPEED_SEARCH_COLUMNS.find(rule => rule.id === 'commit').highlights, true,
    '提交列走 GraphCommitCellRenderer.kt:265，不走 VcsLogStringCellRenderer')
  assert.match(LOG_SPEED_SEARCH_COLUMNS.find(rule => rule.id === 'hash').value, /短/, '哈希列是短哈希（:204）')
})

test('逐列比、任一命中即命中，元数据为空不命中（VcsLogSpeedSearch.java:44-63）', () => {
  const matches = (pattern, text) => text.toLowerCase().includes(pattern.toLowerCase())
  const row = { commit: '修折叠', author: 'Tao', date: '2026-09-29 10:00', hash: 'aaaaaaa' }
  assert.equal(logRowMatches('tao', row, matches), true, '作者列命中')
  assert.equal(logRowMatches('折叠', row, matches), true, '提交列命中')
  assert.equal(logRowMatches('zzz', row, matches), false)
  assert.equal(logRowMatches('tao', { ...row, author: null }, matches), false, '元数据缺失的行不命中（:55）')
  assert.equal(logRowMatches('tao', row, matches, ['author']), false, '作者列勾掉后就不参与')
  // 逐列比：拼起来的整行能命中、但单列都命中不了的串不该算命中（上游不拼整行，:39-41 直接抛异常）
  assert.equal(logRowMatches('tao 2026', row, matches), false, '不会把两列拼起来比')
})

test('命中底色的门：搜索框不在场 / 空串就不画（SpeedSearchBase.java:343-349）', () => {
  assert.equal(logSpeedSearchHighlights('tao', true), true)
  assert.equal(logSpeedSearchHighlights('tao', false), false, 'popup 不在场 ⇒ 没有区间可画')
  assert.equal(logSpeedSearchHighlights('', true), false, '空串没有区间')
})

test('日志速度搜索的总开关缺省是 false（registry.properties:737）', () => {
  assert.equal(LOG_SPEED_SEARCH_REGISTRY_KEY, 'vcs.log.speedsearch')
  assert.equal(LOG_SPEED_SEARCH_DEFAULT_ENABLED, false, '上游默认**不开**日志速度搜索')
  assert.equal(LOG_TEXT_FILTER_HIGHLIGHT_KEY, 'vcs.log.filter.text.highlight.matches')
  assert.equal(LOG_TEXT_FILTER_HIGHLIGHT_DEFAULT, true, '文本筛选高亮是另一件事，缺省 true（:745-746）')
})

test('作者列的星号：作者≠提交者才补（CommitPresentationUtil.java:69-76）', () => {
  assert.equal(logAuthorPresentation('Tao', 'Tao'), 'Tao')
  assert.equal(logAuthorPresentation('Tao', null), 'Tao', '本仓没有 committer 字段（vcsLogTypes.ts:7）⇒ 不加星号')
  assert.equal(logAuthorPresentation('Tao', 'Other'), 'Tao*')
})
