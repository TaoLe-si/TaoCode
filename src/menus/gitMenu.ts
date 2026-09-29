// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入，成员先用 any。
import type { MenuRow } from './types'

export interface GitMenuContext {
  active: any
  activePath: any
  gitAvailable: any
  working: any
  workspace: any
  isDesktop: boolean
  beginProject: (mode: any) => any
  gitMenuAction: (method: any) => any
  openSettings: (arg?: any) => any
  /** 「Git › 分支…」：打开分支弹窗（IDEA GitBranchesPopup）。 */
  openBranchPopup: () => void
  openSubmodules: () => any
  openWorktrees: () => any
  pushWithConfirm: () => any
  resetHeadDialog: () => any
  showBlame: () => any
  /** 「追溯」是否开着（`AnnotateToggleAction` 的 `isSelected`，`:117`）。 */
  blameEnabled: () => boolean
  showFileHistory: (path: any) => any
  showView: (id: any) => any
  updateProject: () => any
  toolWindow: (view: any, title: any, keywords: any, needsDesktop?: any) => MenuRow
  /** 本地历史是 IDEA 的 ShowHistoryAction **对话框**（不是工具窗口）。 */
  localHistoryDialog: MenuRow
}

// Git 菜单（IDEA Git.MainMenu，intellij.vcs.git.backend.xml 的 TaoCode 对应物）。
export function createGitMenuRows(ctx: GitMenuContext): MenuRow[] {
  return [
    { id: 'git.commit', title: '提交项目…', keys: 'Ctrl K', keywords: 'commit checkin message 提交', enabled: () => Boolean(ctx.workspace.value) && ctx.gitAvailable.value, run: () => ctx.showView('git') },
    { id: 'git.push', title: '推送…', keys: 'Ctrl Shift K', keywords: 'push remote upload 推送', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.pushWithConfirm() },
    { id: 'git.update', title: '更新项目', keys: 'Ctrl T', keywords: 'update project pull merge incoming 更新', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.updateProject() },
    { id: 'git.pull', title: '拉取（Pull）', keywords: 'pull fetch integrate 拉取', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.gitMenuAction('git.pull') },
    { id: 'git.fetch', title: '获取（Fetch）', keywords: 'fetch remote refs prune 获取', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.gitMenuAction('git.fetch') },
    { id: 'git.rule1', rule: true },
    { id: 'git.rebase', title: '变基当前分支到上游（Rebase）', keywords: 'rebase upstream onto 变基', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.gitMenuAction('git.rebase') },
    // IDEA Git menu (real 2026.2 UI): 重置 HEAD… follows 新建标记.
    { id: 'git.resetHead', title: '重置 HEAD…', keywords: 'reset head soft mixed hard 重置', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.resetHeadDialog() },
    // IDEA 的 GitBranchesAction 打开的是**分支弹窗**（`GitBranchesPopup`），不是工具窗口。
    { id: 'git.branches', title: '分支…', keys: 'Ctrl Shift `', keywords: 'branches popup checkout switch widget 分支', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => ctx.openBranchPopup() },
    { id: 'git.newBranch', title: '新建分支…', keywords: 'new branch create checkout 新建分支', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => ctx.showView('git') },
    { id: 'git.tag', title: '标签…（Tag）', keywords: 'tag create delete lightweight 标签', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => ctx.showView('git') },
    { id: 'git.rule2', rule: true },
    { id: 'git.stash', title: '储藏（Stash）', keywords: 'stash shelve save changes 储藏', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.gitMenuAction('git.stash.save') },
    { id: 'git.unstash', title: '取出储藏（Unstash）', keywords: 'unstash pop shelf 弹出储藏', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.gitMenuAction('git.stash.pop') },
    { id: 'git.log', title: '显示日志', keywords: 'show log history graph 日志', enabled: () => Boolean(ctx.workspace.value) && ctx.gitAvailable.value, run: () => ctx.showView('vcslog') },
    { id: 'git.fileHistory', title: '当前文件的历史（--follow）', keywords: 'file history follow rename log 文件历史', enabled: () => ctx.isDesktop && ctx.gitAvailable.value && Boolean(ctx.activePath.value), run: () => { const path = ctx.activePath.value; if (path) void ctx.showFileHistory(path) } },
    { id: 'git.worktrees', title: '管理工作树…', keywords: 'worktree linked checkout 工作树', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.openWorktrees() },
    { id: 'git.submodules', title: '管理子模块…', keywords: 'submodule update init 子模块', enabled: () => ctx.isDesktop && ctx.gitAvailable.value, run: () => void ctx.openSubmodules() },
    ctx.localHistoryDialog,
    { id: 'code.blame.git', title: '追溯当前文件', keywords: 'blame annotate 追溯', checked: () => ctx.blameEnabled(), enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.showBlame() },
    { id: 'git.rule3', rule: true },
    { id: 'git.clone', title: '从版本控制系统检出…', keywords: 'checkout from version control clone vcs 检出', enabled: () => !ctx.working.value, run: () => ctx.beginProject('clone') },
    { id: 'app.settings.git', title: '版本控制与编辑器设置…', keys: 'Ctrl Alt S', keywords: 'vcs git settings 版本控制设置', enabled: () => ctx.isDesktop, run: () => void ctx.openSettings() },
  ]
}
