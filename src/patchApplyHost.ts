// 补丁应用的**宿主执行链**（上游 `ChangesView.ApplyPatch` / `ChangesView.ApplyPatchFromClipboard`，
// 注册在 `platform/vcs-impl/resources/META-INF/VcsActions.xml:110-111`，
// 实现类 `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/patch/ApplyPatchAction.java:29` 与
// `ApplyPatchFromClipboardAction.java:34`）：选/取补丁文本 → 解析 → 逐文件核对 → 落盘 → 进度 → 结果通知。
//
// 纯规则在 `src/patchApply.ts`（解析/计划），路径与进度工具在 `src/vcsFileUtil.ts`。
// **本仓的通道约束（如实记）**：宿主的工作区读写（`file.read`/`file.write`/`file.create`/`file.delete`）
// 只接受**工作区相对路径**（`native/workspace.cpp` 的 `parse_relative` 拒绝绝对路径与盘符），
// 而文件选择器给的是绝对路径 ⇒ 「从文件应用补丁」只支持项目内的 `.patch`；项目外的补丁
// 走「从剪贴板应用补丁」（`navigator.clipboard`，不需要宿主通道）。
import { request } from './bridge.ts'
import { isBinaryPatchText, parseUnifiedPatch, planPatchApplication, type PatchFilePlan, type PatchPlan } from './patchApply.ts'
import { createFilesProgress, isAncestor, normalizePath, relativePath, rollbackOperationName } from './vcsFileUtil.ts'

/** 补丁文件的选择器过滤（上游 `PatchFileType` 的扩展名）。 */
export const PATCH_FILE_FILTERS = [{ name: '补丁文件', pattern: '*.patch;*.diff' }]
/** `action.ChangesView.ApplyPatch.text`。 */
export const APPLY_PATCH_TEXT = '应用补丁…'
/** `action.ChangesView.ApplyPatchFromClipboard.text`。 */
export const APPLY_PATCH_CLIPBOARD_TEXT = '从剪贴板应用补丁'

export interface ApplyPatchDeps {
  /** 工作区根（用来判断选中的补丁文件是否在项目内）。 */
  root: string
  notify: (message: string, error?: boolean) => void
  /** 状态栏文字（批量进度用；结束时传 null 清掉）。 */
  setStatus: (text: string | null) => void
  /** 落盘后刷新（变更列表/编辑器标签）。 */
  onApplied?: () => void | Promise<void>
}

interface FileFacts { content: string; version: string; encoding: string; bom: boolean }

/** 读一个工作区文件；不存在/读不了给 null（补丁的 delete/新增目标就靠它区分）。 */
async function readWorkspaceFile(path: string): Promise<FileFacts | null> {
  try {
    const result = await request<FileFacts>('file.read', { path })
    return { content: result.content, version: result.version, encoding: result.encoding ?? 'utf-8', bom: result.bom === true }
  } catch {
    return null
  }
}

/** 收集计划涉及的全部路径（改名要看源与目标两侧）。 */
function planPaths(plan: PatchPlan): string[] {
  const paths = new Set<string>()
  for (const file of plan.files) {
    if (file.path) paths.add(file.path)
    if (file.fromPath) paths.add(file.fromPath)
    if (file.action === 'rename' && file.fromPath) paths.add(file.fromPath)
  }
  return [...paths]
}

/** 失败原因汇总成一行（错误行/通知都短）。 */
function failureSummary(plan: PatchPlan): string {
  const failed = plan.files.filter(file => file.status === 'failure')
  const first = failed[0]
  return `${failed.length} 个文件无法应用${first ? `：${first.path}（${first.reason ?? '未知原因'}）` : ''}`
}

/** 应用一个已经算好的计划（IO 全在这里；计划不 ok 时一个字节都不写）。 */
export async function applyPatchPlan(plan: PatchPlan, deps: ApplyPatchDeps): Promise<boolean> {
  if (!plan.ok) { deps.notify(`补丁未应用：${failureSummary(plan)}`, true); return false }
  const targets = plan.files.filter(file => file.action !== 'none')
  if (!targets.length) { deps.notify('补丁已经应用过，没有需要改动的文件。'); return false }
  const progress = createFilesProgress(targets.length, '正在应用补丁：')
  const facts = new Map<string, FileFacts | null>()
  for (const path of planPaths(plan)) facts.set(path, await readWorkspaceFile(path))
  try {
    for (const file of targets) {
      progress.update(file.path)
      deps.setStatus(`${progress.text}（${progress.count}/${targets.length}）`)
      await applySingle(file, facts)
    }
  } catch (caught) {
    deps.setStatus(null)
    deps.notify(`应用补丁失败：${caught instanceof Error ? caught.message : String(caught)}。已应用的部分保留在工作区，可用「${rollbackOperationName()}」逐文件回退。`, true)
    return false
  }
  deps.setStatus(null)
  const applied = targets.filter(file => file.action !== 'none').length
  const already = plan.files.filter(file => file.status === 'alreadyApplied').length
  deps.notify(`已应用补丁：${applied} 个文件${already > 0 ? `，${already} 个此前已应用` : ''}。`)
  await deps.onApplied?.()
  return true
}

/** 单个文件的落盘：新增/改动/改名/删除四条路。 */
async function applySingle(file: PatchFilePlan, facts: Map<string, FileFacts | null>): Promise<void> {
  if (file.action === 'delete') {
    await request('file.delete', { path: file.path, trash: false })
    return
  }
  if (file.content === null) return
  if (file.action === 'create') {
    await request('file.create', { path: file.path })
    const created = await readWorkspaceFile(file.path)
    await request('file.write', { path: file.path, content: file.content, expectedVersion: created?.version ?? '', encoding: created?.encoding ?? 'utf-8', bom: created?.bom ?? false, safeWrite: false })
    return
  }
  if (file.action === 'rename') {
    const from = file.fromPath ?? ''
    await request('file.create', { path: file.path })
    const created = await readWorkspaceFile(file.path)
    await request('file.write', { path: file.path, content: file.content, expectedVersion: created?.version ?? '', encoding: created?.encoding ?? 'utf-8', bom: created?.bom ?? false, safeWrite: false })
    await request('file.delete', { path: from, trash: false })
    return
  }
  const current = facts.get(file.path)
  await request('file.write', { path: file.path, content: file.content, expectedVersion: current?.version ?? '', encoding: current?.encoding ?? 'utf-8', bom: current?.bom ?? false, safeWrite: false })
}

/** 「应用补丁…」（选一个**项目内**的补丁文件）。 */
export async function applyPatchFromFile(deps: ApplyPatchDeps): Promise<void> {
  try {
    const picked = await request<{ path?: string | null } | string | null>('dialog.pickFile', { title: APPLY_PATCH_TEXT, filters: PATCH_FILE_FILTERS, initial: initialPatchDirectory(deps.root) })
    const absolute = typeof picked === 'string' ? picked : picked?.path ?? null
    if (!absolute) return
    if (!isAncestor(deps.root, absolute, false)) {
      deps.notify('补丁文件在项目外：本仓宿主只能读取工作区内文件，请改用「从剪贴板应用补丁」。', true)
      return
    }
    const relative = relativePath(deps.root, absolute)
    const read = await readWorkspaceFile(relative)
    if (!read) { deps.notify(`读不到补丁文件：${relative}`, true); return }
    await applyPatchText(read.content, deps)
  } catch (caught) {
    deps.notify(`应用补丁失败：${caught instanceof Error ? caught.message : String(caught)}`, true)
  }
}

/** 「从剪贴板应用补丁」。 */
export async function applyPatchFromClipboard(deps: ApplyPatchDeps): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) { deps.notify('剪贴板为空，没有可应用的补丁。', true); return }
    await applyPatchText(text, deps)
  } catch (caught) {
    deps.notify(`读取剪贴板失败：${caught instanceof Error ? caught.message : String(caught)}`, true)
  }
}

/** 解析 + 计划 + 落盘的共同尾巴（两个入口都走它）。 */
export async function applyPatchText(text: string, deps: ApplyPatchDeps): Promise<void> {
  if (isBinaryPatchText(text)) { deps.notify('补丁文本是二进制，无法应用。', true); return }
  const patch = parseUnifiedPatch(text)
  if (!patch.files.length) { deps.notify(`补丁里没有可应用的文件${patch.problems.length ? `（${patch.problems[0]}）` : ''}`, true); return }
  // 「文件是否存在」得看真实磁盘：把补丁牵涉到的路径逐个读回来，再算最终计划。
  const paths = new Set<string>()
  for (const file of patch.files) {
    if (file.newPath) paths.add(file.newPath)
    if (file.oldPath) paths.add(file.oldPath)
  }
  const contents = new Map<string, string | null>()
  for (const path of paths) contents.set(path, (await readWorkspaceFile(path))?.content ?? null)
  await applyPatchPlan(planPatchApplication(patch, contents), deps)
}

/** 选补丁文件时的初始目录（工作区根；选择器给绝对路径，`normalizePath` 统一分隔符）。 */
export function initialPatchDirectory(root: string): string {
  return normalizePath(root)
}
