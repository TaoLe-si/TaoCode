// 冲突自动解决的**宿主执行链**（上游 `MergeThreesideViewer.applyResolvableConflictedChanges`
// 与 `applyNonConflictedChanges` 的落盘那一半，纯算法在 `src/mergeResolve.ts`）。
//
// 上游那条链是：三栏窗口里点按钮 → 改**结果缓冲区** → 用户接受后写到文件。
// 本仓没有那张窗口，所以入口在**变更面板的右键菜单**（`src/changesMenuActions.ts` 的两行，
// `src/components/SourceControl.vue` 分派），写盘直接走工作区通道：
//
//     file.read（取内容 + 版本 + 编码 + BOM）→ resolveConflictsInText → file.write
//
// 写盘带 `expectedVersion`（读之后文件被别人改过就写不进去，`native/workspace.cpp` 的
// `Workspace::write`）与 **safe write**（`replace_safely`，临时文件 + 备份 + 原子替换）。
// 为什么不碰编辑器缓冲区：那要 `App.vue` / `CodeEditor.vue` 的文档通道（上一批已冻结），
// 而这条动作的语义就是"把这个文件按合并结果落盘"—— 与「应用补丁」那条链同构。
//
// 文案：两条自动合的取 `platform/platform-resources-en/src/messages/ActionsBundle.properties` 的 `action.Diff.*`（随 IDE 发货的
// `localization-zh.jar`），两条整文件接受的取 `GitBundle.properties` 的
// `conflicts.accept.*.action.text`（英文原文在 `plugins/git4idea/shared/resources/messages/`）。
import { request } from './bridge.ts'
import { acceptSide, conflictsIn, parseConflicts, type ConflictSide } from './mergeConflicts.ts'
import { APPLY_NON_CONFLICTS_TEXT, RESOLVE_SIMPLE_CONFLICTS_TEXT, resolveConflictsInText } from './mergeResolve.ts'
import { gitErrorHint } from './vcsFileUtil.ts'

export interface MergeResolveDeps {
  /** 一句结果/失败提示（`error = true` 时是失败）。 */
  notify: (message: string, error?: boolean) => void
  /** 落盘后刷新（变更列表）。 */
  onApplied?: () => void | Promise<void>
}

interface FileFacts { content: string; version: string; encoding: string; bom: boolean }

/** `conflicts.accept.yours.action.text` = 接受您的更改。 */
const ACCEPT_YOURS_TEXT = '接受您的更改'
/** `conflicts.accept.theirs.action.text` = 接受他们的更改。 */
const ACCEPT_THEIRS_TEXT = '接受他们的更改'

/** 「解决简单的冲突」：能自动合的全合掉，真冲突留着。 */
export async function resolveSimpleConflicts(path: string, deps: MergeResolveDeps): Promise<boolean> {
  return applyResolution(path, false, deps, `${RESOLVE_SIMPLE_CONFLICTS_TEXT}：${path}`)
}

/** 「接受所有不冲突的更改」：只落"一侧没动"的那一半。 */
export async function applyNonConflictingChanges(path: string, deps: MergeResolveDeps): Promise<boolean> {
  return applyResolution(path, true, deps, `${APPLY_NON_CONFLICTS_TEXT}：${path}`)
}

/**
 * 整文件接受一侧（上游 `Git.ChangesView.AcceptYours` / `AcceptTheirs` →
 * `GitConflictsUtil.acceptConflictSide`）：**每一个**冲突块都取那一侧，等于整文件回到 ours/theirs。
 *
 * 逐块替换用 `acceptSide`（`src/mergeConflicts.ts`，编辑器里逐条接受同款），从**最后一条往前**做 ——
 * 前面各条的行号因此一直有效，不用重算。
 */
export async function acceptConflictSide(path: string, side: ConflictSide, deps: MergeResolveDeps): Promise<boolean> {
  const label = side === 'left' ? ACCEPT_YOURS_TEXT : ACCEPT_THEIRS_TEXT
  try {
    const read = await request<FileFacts>('file.read', { path })
    const conflicts = conflictsIn(read.content ?? '')
    if (!conflicts.length) { deps.notify(`${path}：没有未解决的冲突。`); return false }
    let text = read.content
    let remaining = parseConflicts(text).length
    while (remaining > 0) {
      text = acceptSide(text, parseConflicts(text)[remaining - 1]!, side)
      remaining--
    }
    await request('file.write', {
      path, content: text, expectedVersion: read.version ?? '',
      encoding: read.encoding ?? 'utf-8', bom: read.bom === true,
    })
    deps.notify(`${label}：${path} —— ${conflicts.length} 处冲突全部取了${side === 'left' ? '左侧' : '右侧'}。`)
    await deps.onApplied?.()
    return true
  } catch (caught) {
    deps.notify(gitErrorHint(caught instanceof Error ? caught.message : String(caught)), true)
    return false
  }
}

/** 两条动作的共同实现：读 → 逐块解决 → 有变化才写。 */
async function applyResolution(path: string, onlyNonConflicts: boolean, deps: MergeResolveDeps, title: string): Promise<boolean> {
  try {
    const read = await request<FileFacts>('file.read', { path })
    const conflicts = conflictsIn(read.content ?? '')
    if (!conflicts.length) { deps.notify(`${path}：没有未解决的冲突。`); return false }
    const result = resolveConflictsInText(read.content, onlyNonConflicts)
    if (!result.resolved) {
      deps.notify(onlyNonConflicts
        ? `${path}：${conflicts.length} 处冲突都要人来定，没有能自动并入的不冲突更改。`
        : `${path}：${conflicts.length} 处冲突都不是"简单冲突"（两侧改得不一样），需要逐条选择。`)
      return false
    }
    await request('file.write', {
      path, content: result.text, expectedVersion: read.version ?? '',
      encoding: read.encoding ?? 'utf-8', bom: read.bom === true,
    })
    const left = result.remaining > 0 ? `，还剩 ${result.remaining} 处待处理` : '，冲突已全部解决'
    deps.notify(`${title} —— 已解决 ${result.resolved} 处${left}。`)
    await deps.onApplied?.()
    return true
  } catch (caught) {
    deps.notify(gitErrorHint(caught instanceof Error ? caught.message : String(caught)), true)
    return false
  }
}
