// 版本控制动作 —— 从 App.vue 搬出的一域（122 行，11 个依赖）。
//
// 判据：IDEA 把 Git 的**用户可见动作**放在 `VcsActions.xml` 的菜单 + 各 popup 里，TaoCode 的对应物
// 就是这一组：分支弹窗（`GitBranchesPopup`）、分支操作（checkout/create/delete/rebase/merge/compare）、
// 追溯（Annotate = `git.blame`）、与剪贴板比较（Compare with Clipboard）、以及 Git 菜单的
// 更新项目 / 重置 HEAD / 推送 / 储藏。它们共享 `branchPopupOpen` / `blameLines` / `clipboardDiff`
// 三类结果状态，并且都走同一条 `git.*` 原生通道。
// 状态栏的分支 widget（`refreshGitWidget`）留在 App.vue：它是 30 秒轮询的常驻部件，不是动作。
import { computed, nextTick, ref } from 'vue'
import { request, type DiffRow, type GitAheadBehind, type GitBlame, type GitBlameLine } from './bridge'
import { blameAnnotations, type BlameAnnotation } from './blameAnnotations'
import { buildDiffRows, generateUnifiedDiff } from './diffText'
import { errorMessage } from './errors'
import type { Tab } from './editorTab'

export interface VcsActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  workspace: any
  gitAvailable: any
  /** 状态栏的分支/变更指示器（宿主自有轮询）。 */
  refreshGitWidget: () => Promise<void>
  /** 文件树代次（分支切换后要刷新树）。 */
  treeVersion: any
  activePath: { readonly value: string }
  active: { readonly value: Tab | undefined }
  bottom: any
  showOutput: (id: any) => void
  showView: (id: any) => void
  /**
   * 一次 VCS 更新成功了（拉取/切换分支/变基/合并/重置）。
   * IDEA 的 `ExternalSystemProjectTracker` 把「VCS 更新」也算成构建脚本的一次变化 ——
   * `AutoReloadType.SELECTIVE` 的语义正是「VCS 更新 **或** IDE 之外的构建脚本改动」
   * （ExternalSystemProjectTrackerSettings.kt:18-21）。这里只发信号，判定在 src/gradleHost.ts。
   */
  onVcsUpdated: () => void
}

export function createVcsActions(deps: VcsActionsDeps) {
  const { notify, isDesktop, workspace, gitAvailable, refreshGitWidget, treeVersion, activePath, active,
          showView } = deps
  // 一次成功的 VCS 更新（见 deps.onVcsUpdated 的说明）。
  function noteVcsUpdate() { deps.onVcsUpdated() }
// IDEA 的分支弹窗（`GitBranchesPopup`）：工具栏分支 widget 与「Git › 分支…」都打开它，
// 而不是切到源代码管理工具窗口（那是旧行为，位置上也不对）。
const branchPopupOpen = ref(false)
function openBranchPopup() {
  if (!isDesktop || !workspace.value || !gitAvailable.value) { notify('桌面端打开 Git 仓库后才能切换分支。', true); return }
  branchPopupOpen.value = true
  void refreshGitWidget()
}
/** 弹窗里的动作 → 原生命令（动作清单与对应关系在 src/branchPopup.ts，逐条有 IDEA 出处）。 */
async function onBranchAction(payload: { action: string; branch?: string; name?: string }) {
  const branch = payload.branch ?? payload.name ?? ''
  try {
    // checkout / create / delete 的结果**立即可见**（状态栏的分支指示器、分支列表都会变），
    // 所以按「只有无法直接感知的操作才提示」不再弹提示；rebase/merge/push 保留 —— 它们的结果
    // （历史被改写、远端状态）不直观，属于规范里"异步完成需要明确反馈"那一档。
    if (payload.action === 'checkout') { await request('git.checkout', { branch }); noteVcsUpdate() }
    else if (payload.action === 'create') { await request('git.branch.create', { name: branch, checkout: true }); noteVcsUpdate() }
    else if (payload.action === 'delete') {
      if (!window.confirm(`删除分支 ${branch}？未合并的提交会丢失。`)) return
      await request('git.branch.delete', { name: branch })
    } else if (payload.action === 'compare') { await compareWithBranch(branch); return }
    else if (payload.action === 'rebase') { await request('git.rebase', { branch }); notify(`已把当前分支变基到 ${branch}。`); noteVcsUpdate() }
    else if (payload.action === 'merge') { await request('git.merge', { branch }); notify(`已把 ${branch} 合并到当前分支。`); noteVcsUpdate() }
    else if (payload.action === 'push') { await request('git.push'); notify('已推送。') }
    else return
    branchPopupOpen.value = false
    await refreshGitWidget()
    refreshTreeVersion()
  } catch (error) { notify(errorMessage(error), true) }
}
function refreshTreeVersion() { treeVersion.value++ }
// 「与分支比较」交给源代码管理面板执行（它已经有 base 输入 + 文件列表），这里只把目标传过去。
const gitCompareWith = ref('')
async function compareWithBranch(branch: string) {
  await request('git.compare', { base: branch })
  gitCompareWith.value = ''
  await nextTick()
  gitCompareWith.value = branch
  showView('git')
  branchPopupOpen.value = false
  notify(`正在与 ${branch} 比较。`)
}
const blameLines = ref<GitBlameLine[]>([])
const blamePath = ref('')
/** 「追溯」开着没有 —— IDEA 的 `AnnotateToggleAction` 是一个 **Toggle**（`:18` 继承 `ToggleAction`）。 */
const blameEnabled = ref(false)
/**
 * 「追溯」的注解文本。**IDEA 把注解画在编辑器装订线上**（`AnnotateToggleAction.java:139-153` 的
 * `doAnnotate(editor, …)` 拿到的是 `Editor`，注解由 `TextAnnotationGutterProvider` 提供），
 * 不是底部面板的一个 tab —— 本仓原先做成底部 tab 是错放，2026-09-27 改成编辑器 gutter。
 */
const blameAnnotationsForPath = computed(() => blameAnnotations(blameLines.value))
/** 身份稳定的空数组：不匹配的文件必须拿到**同一个**空数组，否则 CodeEditor 会反复收到新引用。 */
const NO_BLAME: BlameAnnotation[] = []
/** 某个文件当前的注解（只有「追溯」开着、且就是这个文件时才有内容）。 */
function blameOf(path: string): BlameAnnotation[] {
  return blameEnabled.value && blamePath.value === path ? blameAnnotationsForPath.value : NO_BLAME
}
const clipboardDiff = ref<{ path: string; rows: DiffRow[]; unified: string } | null>(null)
async function showBlame() {
  const path = activePath.value
  if (!isDesktop || !path) { notify('请在桌面端为当前文件使用「追溯」。', true); return }
  // 再点一次就关掉（ToggleAction 的语义），并且**不重新拉数据** —— 关掉再开才有新请求。
  if (blameEnabled.value && blamePath.value === path) { blameEnabled.value = false; return }
  blamePath.value = path
  blameEnabled.value = true
  blameLines.value = []
  try { blameLines.value = (await request<GitBlame>('git.blame', { path })).lines ?? [] }
  catch (error) { notify(errorMessage(error), true) }
}
async function compareWithClipboard() {
  const tab = active.value
  if (!tab) return
  try {
    const clipText = await navigator.clipboard.readText()
    if (!clipText) { notify('剪贴板为空或非文本。', true); return }
    const currentLines = tab.content.split('\n')
    const clipLines = clipText.split('\n')
    clipboardDiff.value = { path: tab.path, rows: buildDiffRows(currentLines, clipLines), unified: generateUnifiedDiff(currentLines, clipLines) }
  } catch { notify('无法读取剪贴板。', true) }
}
// The Git menu drives the same bridge methods as the 源代码管理 tool window. Stash
// without a message would use git's default; keep IDEA's "Stash" dialog out of scope
// and pass a timestamped label instead.
// Vcs.UpdateProject: refresh remotes first, then integrate (pull). Distinct from
// Git.Pull, which just integrates.
async function updateProject() {
  if (!workspace.value || !isDesktop) return
  try {
    await request('git.fetch')
    await request('git.pull')
    noteVcsUpdate()
    notify('已获取远端并合并到当前分支。')
    showView('git')
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA Git menu: 重置 HEAD… (Reset Current Branch). The two IDEA-visible choices
// are the mode and the target; a hard reset gets a second confirm because it
// discards commits and edits alike.
async function resetHeadDialog() {
  if (!workspace.value || !isDesktop) return
  const target = window.prompt('重置到哪个提交？（分支名、哈希或 HEAD~N）', 'HEAD~1')
  if (!target?.trim()) return
  const mode = window.prompt('重置模式：\n  soft — 保留更改在暂存区\n  mixed — 保留更改在工作区\n  hard — 丢弃全部更改', 'mixed')
  const chosen = (mode ?? '').trim().toLowerCase()
  if (!chosen) return
  if (!['soft', 'mixed', 'hard'].includes(chosen)) { notify('模式只能是 soft、mixed 或 hard。', true); return }
  if (chosen === 'hard' && !window.confirm(`硬重置将丢弃 ${target.trim()} 之后的全部提交与未提交修改，且无法撤销。继续？`)) return
  try {
    const result = await request<{ head: string }>('git.reset', { target: target.trim(), mode: chosen })
    notify(`已重置到 ${result.head}（${chosen}）。`)
    showView('git')
  } catch (error) { notify(errorMessage(error), true) }
}
// IDEA's Push dialog confirms before any remote write; the confirm names the
// branch so a push to the wrong remote is at least visible.
async function pushWithConfirm() {
  if (!workspace.value || !isDesktop) return
  try {
    const status = await request<{ head?: string }>('git.status')
    const ahead = await request<GitAheadBehind>('git.aheadBehind')
    const branch = status.head || '（游离 HEAD）'
    const count = ahead.available ? ahead.ahead : 0
    if (!window.confirm(`确认推送 ${branch} 到远端？${ahead.available ? `（领先 ${count} 个提交）` : '（未跟踪上游，将推送并设置上游）'}`)) return
    await request('git.push')
    notify('已推送。')
    showView('git')
  } catch (error) { notify(errorMessage(error), true) }
}
async function gitMenuAction(method: 'git.push' | 'git.pull' | 'git.fetch' | 'git.rebase' | 'git.stash.save' | 'git.stash.pop') {
  if (!workspace.value || !isDesktop) return
  try {
    if (method === 'git.stash.save') await request(method, { message: `TaoCode 储藏 ${new Date().toISOString().slice(0, 19).replace('T', ' ')}` })
    else await request(method)
    // 拉取/变基/弹出储藏都会改工作区；获取远端引用不改，但那一步通常紧跟一次集成。
    if (method === 'git.pull' || method === 'git.rebase' || method === 'git.stash.pop') noteVcsUpdate()
    notify(method === 'git.push' ? '已推送。' : method === 'git.pull' ? '已拉取（--ff-only）。' : method === 'git.fetch' ? '已获取远端引用（未合并）。' : method === 'git.rebase' ? '已变基到上游。' : method === 'git.stash.save' ? '已储藏当前更改。' : '已弹出最近的储藏。')
    showView('git')
  } catch (error) { notify(errorMessage(error), true) }
}
  return {
    branchPopupOpen, openBranchPopup, onBranchAction, refreshTreeVersion, gitCompareWith, compareWithBranch,
    blameLines, blamePath, blameEnabled, blameOf, clipboardDiff, showBlame, compareWithClipboard,
    updateProject, resetHeadDialog, pushWithConfirm, gitMenuAction,
  }
}
