// 某**修订的某文件**的整份内容 —— 上游两处缺口共同缺的那条通道：
//   · `CompareWithLocalDialog`（`platform/vcs-impl/src/com/intellij/vcs/CompareWithLocalDialog.java:53-55`）
//     要的是"某个修订里这个文件的内容"，拿去和**工作区版本**对照；
//   · 三方合并（`MergeThreesideViewer`）的 stage1/2/3 要的是索引里冲突三阶段的 blob
//     （1 = base 共同祖先、2 = ours 我们的、3 = theirs 他们的）。
//
// **零 native 改动**：现有 `git.showCommit`（native `show_commit` = `git show <revision>`，
// `native/git_log.cpp:533-542`）在 revision 位置上接受 git 的 **`<rev>:<path>` 对象说明符**，
// 对 blob 说明符它直接输出整份文件内容（`--format=` 空、`-m`/`--first-parent` 对 blob 无效）。
// `checked_ref`（`native/git.cpp:223-230`）用的是 `git rev-parse --verify --end-of-options <spec>`，
// 对 `<rev>:<path>` 与 `:<n>:<path>` 同样成立 —— 已用真仓库核过（`:1:`/`:2:`/`:3:` 只在冲突期解析得出，
// 无冲突时 rev-parse 失败 ⇒ 这里如实回 `available:false`，不伪造基线）。
//
// 判据 `tests/revision-content.test.mjs`（纯规则 + 注入式 fake request 驱动真往返）。
import { BridgeError, request, type GitShowCommit } from './bridge.ts'

/** 一份修订内容：读不到时 `available:false`（调用方据此画"这一侧没有内容"，不抛错）。 */
export interface RevisionFile {
  available: boolean
  content: string
}

/** 与 native `checked_ref` 的长度上限一致（超过会被 native 判非法）。 */
export const MAX_REVISION_LENGTH = 200

/**
 * `<revision>:<path>` 说明符。非法时回空串（调用方据此不打往返）：
 * 空、前导 `-`（会被 git 当选项）、含 CR/LF、超长。
 */
export function revisionPathSpec(revision: string, path: string): string {
  const rev = revision.trim()
  const file = path.trim()
  if (!rev || !file) return ''
  if (rev.startsWith('-') || /[\r\n]/.test(rev) || /[\r\n]/.test(file)) return ''
  const spec = `${rev}:${file}`
  return spec.length > MAX_REVISION_LENGTH ? '' : spec
}

/** 索引里的冲突阶段号（1 = 基线 / 2 = 我们的 / 3 = 他们的，git 的定义）。 */
export type MergeStage = 1 | 2 | 3
export const MERGE_STAGES: MergeStage[] = [1, 2, 3]
/** 三阶段的栏标题（与 `src/mergeEditor.ts` 的 `MERGE_TITLES` 同一套措辞）。 */
export const MERGE_STAGE_TITLES: Record<MergeStage, string> = { 1: '基线', 2: '我们的版本', 3: '他们的版本' }
/** git 的索引阶段说明符 `:<n>:<path>`。 */
export function stagePathSpec(stage: MergeStage, path: string): string {
  return revisionPathSpec(`:${stage}`, path)
}

/** 读某修订某文件的整份内容；读不到（该修订没有这个文件 / 不是该阶段）时 `available:false`。 */
export async function loadRevisionFile(revision: string, path: string): Promise<RevisionFile> {
  const spec = revisionPathSpec(revision, path)
  if (!spec) return { available: false, content: '' }
  try {
    const result = await request<GitShowCommit>('git.showCommit', { revision: spec })
    return { available: true, content: result.patch ?? '' }
  } catch (caught) {
    // BridgeError = native 判了非法/找不到（rev-parse 失败）。这不是"网络异常"，而是
    // "这一侧没有内容"的正常一支 —— 比较视图要能这么显示。
    if (caught instanceof BridgeError) return { available: false, content: '' }
    throw caught
  }
}

/** 冲突三阶段的真内容（`:1:`/`:2:`/`:3:`）。哪一阶段读不到就哪一侧 `available:false`。 */
export async function loadMergeStages(path: string): Promise<{ base: RevisionFile; ours: RevisionFile; theirs: RevisionFile }> {
  const [base, ours, theirs] = await Promise.all([
    loadRevisionFile(':1', path),
    loadRevisionFile(':2', path),
    loadRevisionFile(':3', path),
  ])
  return { base, ours, theirs }
}

/** 三阶段是否齐（齐才拿真内容替掉冲突标记派生出的三栏）。 */
export function stagesComplete(stages: { base: RevisionFile; ours: RevisionFile; theirs: RevisionFile }): boolean {
  return stages.base.available && stages.ours.available && stages.theirs.available
}

/**
 * 真三阶段内容 → 三栏文本行数组（上游 `ThreesideMergeRequest.getContents()` 的 left/middle/right：
 * 左 = ours、中 = base、右 = theirs）。任一阶段缺失时回 `null`（不拿半份当真）。
 */
export function stagePanes(stages: { base: RevisionFile; ours: RevisionFile; theirs: RevisionFile }): { left: string[]; base: string[]; right: string[] } | null {
  if (!stagesComplete(stages)) return null
  return { left: stages.ours.content.split('\n'), base: stages.base.content.split('\n'), right: stages.theirs.content.split('\n') }
}
