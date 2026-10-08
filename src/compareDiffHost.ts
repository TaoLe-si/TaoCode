// 「查看全部差异…」的取数与组装（上游 `CombinedDiffViewer` 的**输入侧**：把多个文件的差异块
// 交给同一张查看器，见 `src/diffCombined.ts` 文件头）。
//
// 上游那块窗口吃一份 `CombinedDiffRequest`（一串 `CombinedBlockContent`）。本仓的"多个文件"来自
// 两个既有列表：
//   · 变更面板的「与 <分支> 比较」结果（`git.compare` 的 `files`，每项一个 `git.diffSides`）；
//   · 变更列表本身（已暂存 + 更改，每项一个 `git.diffSides`）。
// 两处都是"一堆 (path, base/staged)"，所以本模块只做一件事：**并行取每份对齐行表与补丁文本**，
// 组装成 `CombinedDiffFile[]` 交给 `DiffView` 的 `files` prop。取不到的文件跳过（不整份失败）。
import { request, type DiffSides } from './bridge.ts'
import type { CombinedDiffFile } from './diffCombined.ts'

export interface CombinedDiffTarget {
  path: string
  /** 已暂存那一侧（`git diff --cached`）。 */
  staged?: boolean
  /** 与某分支比较的基线（`git diff HEAD <base>`）。 */
  base?: string
  /** 行上的副标题（缺省按 staged/base 推）。 */
  subtitle?: string
  /** git 的两列状态记号。 */
  status?: string
}

/** 行上那句副标题（与单文件视图 `SourceControl.vue` 的传参同一口径）。 */
export function targetSubtitle(target: CombinedDiffTarget): string {
  if (target.subtitle) return target.subtitle
  if (target.base) return `（与 ${target.base} 的比较）`
  return target.staged ? '（已暂存）' : '（工作区）'
}

/**
 * 取一份文件的对齐行表 + 补丁文本（与单文件视图走**同一条**请求，两个模式不会各说各话）。
 * `context` = diff 设置里的上下文行数（0 = git 默认）。取不到时返回 null（调用侧跳过这个文件）。
 */
export async function loadCombinedFile(target: CombinedDiffTarget, context = 0): Promise<CombinedDiffFile | null> {
  const params = target.base
    ? { path: target.path, staged: target.staged === true, base: target.base, context }
    : { path: target.path, staged: target.staged === true, context }
  try {
    const [unified, sides] = await Promise.all([
      request<{ diff: string }>('git.diff', params),
      request<DiffSides>('git.diffSides', params),
    ])
    return {
      path: target.path,
      subtitle: targetSubtitle(target),
      rows: sides.rows ?? [],
      unified: unified.diff ?? '',
      truncated: sides.truncated === true,
      status: target.status,
    }
  } catch {
    return null
  }
}

/** 并行取一批文件；取不到的那些**跳过**（一个文件读失败不该让整张合成视图打不开）。 */
export async function loadCombinedFiles(targets: readonly CombinedDiffTarget[], context = 0): Promise<CombinedDiffFile[]> {
  const loaded = await Promise.all(targets.map(target => loadCombinedFile(target, context)))
  return loaded.filter((file): file is CombinedDiffFile => file !== null)
}

/** 「与 <分支> 比较」结果 → 合成差异的入参（每项一个 `base`）。 */
export function targetsForCompare(files: readonly { path: string; status: string }[], base: string): CombinedDiffTarget[] {
  return files.map(file => ({ path: file.path, base, status: file.status }))
}

/**
 * 变更列表 → 合成差异的入参。已暂存那一档取 `indexStatus`、工作区那一档取 `workStatus`
 * （与变更行上那个记号同一口径，见 `SourceControl.vue` 的变更行）。
 */
export function targetsForChanges(changes: readonly { path: string; staged: boolean; indexStatus?: string; workStatus?: string }[]): CombinedDiffTarget[] {
  return changes.map(change => ({ path: change.path, staged: change.staged, status: change.staged ? change.indexStatus : change.workStatus }))
}
