// 「与本地比较」的规则层（上游 `CompareWithLocalDialog`，
// `platform/vcs-impl/src/com/intellij/vcs/CompareWithLocalDialog.java:53-55`：类 + `showChanges(project, …)`）。
//
// 上游做的事：拿某个修订里这个文件的整份内容，和**工作区当前版本**摆成两栏对照。
// 取内容的那条通道在 `src/revisionContent.ts`（零 native 改动，走现有 `git.showCommit` 的
// `<rev>:<path>` 说明符）；这里只留"两份文本 → 对齐行 + 补丁文本 + 栏标题"的纯规则
// （行级算法复用 `src/diffText.ts`，与 Git 变更视图同一个入口，两处判决不会分叉）。
//
// 判据 `tests/revision-content.test.mjs`。
import type { DiffRow } from './bridge.ts'
import { buildDiffRows, generateUnifiedDiff } from './diffText.ts'
import type { ComparisonPolicy } from './diffComparison.ts'

export interface CompareWithLocalSides {
  rows: DiffRow[]
  unified: string
  truncated: boolean
  /** 两侧至少有一侧有内容才值得画（都空 = 这条比较没有对象）。 */
  available: boolean
}

/** 本地侧栏标题（右）—— 上游那里是 `FileDocumentManager` 取的工作区文本。 */
export const LOCAL_SIDE_LABEL = '工作区'
/** 修订侧栏标题（左）：修订号原样显示，空则如实说没指定。 */
export function revisionSideLabel(revision: string): string {
  return revision.trim() || '（未指定修订）'
}
/** 视图标题（上游 `CompareWithLocalDialog` 标题那一格）。 */
export function compareWithLocalTitle(path: string, revision: string): string {
  return `与本地比较：${path} ↔ ${LOCAL_SIDE_LABEL}`
}

/**
 * 两份文本 → 对齐行 + 补丁文本。修订侧读不到内容时传空串（左栏就是空的，
 * 与"这个修订里没有这个文件"的事实一致，不拿工作区的内容冒充）。
 */
export function compareWithLocalSides(
  revisionText: string, localText: string, policy: ComparisonPolicy = 'default',
): CompareWithLocalSides {
  const left = revisionText.length ? revisionText.split('\n') : []
  const right = localText.length ? localText.split('\n') : []
  return {
    rows: buildDiffRows(left, right, { comparison: policy }),
    unified: generateUnifiedDiff(left, right),
    truncated: false,
    available: left.length > 0 || right.length > 0,
  }
}
