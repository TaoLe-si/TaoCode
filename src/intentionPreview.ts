// 意图预览 —— 上游 `platform/lang-impl/src/com/intellij/codeInsight/intention/preview/` 一族
// （`IntentionPreviewUtils`/`IntentionPreviewInfo`/`IntentionPreviewInfoDiff`：把动作的编辑
// 先算成"改完的文件"，在应用前给用户看一眼 before/after）。
//
// 本仓的有界子集：LSP 的代码操作本来就带完整编辑载荷（`LspFileEdits`），不需要跑 PSI 才能
// 算出结果 —— 直接按编辑算"改哪几行、改成什么"，给菜单一行摘要 + 每条改动的前后文本。
// 与上游 `IntentionPreviewInfoDiff` 的差别（如实记）：
//   · 只算**编辑落点**（按原始坐标切出的旧文本 vs 新文本），不重排后续行号 —— 同一文件里
//     多个编辑时，第 2 条的行号仍是原文件坐标（LSP 编辑本来就按原坐标给，语义一致）；
//   · 不做整文件 diff 算法（没有"被移动的行"这种判定），预览长度有上限，超出标 `truncated`；
//   · 文件内容拿不到的条目落 `unavailable`（上游的预览也只在能拿到文档时画）。
import type { LspFileEdits } from './bridge'
import { offsetOf } from './editorText.ts'

/** 预览里一条改动的对照（行号是**原文件**的 1 基行号，直接给界面印）。 */
export interface PreviewChange {
  line: number
  /** 被替换掉的原文行（空数组 = 纯插入）。 */
  before: string[]
  /** 替换成的新文本行（空数组 = 纯删除）。 */
  after: string[]
}

export interface FilePreview {
  path: string
  /** 改动条数（不受 `PREVIEW_MAX_CHANGES` 截断影响，计数总是全量）。 */
  changedLines: number
  added: number
  removed: number
  changes: PreviewChange[]
  /** 文件内容拿不到（没打开、读失败）：只报改动条数，不给前后文本。 */
  unavailable: boolean
}

export interface IntentionPreview {
  files: FilePreview[]
  changedFiles: number
  changedLines: number
  added: number
  removed: number
  truncated: boolean
  /** 菜单副标题用的一行摘要（中文，直接可印）。 */
  summary: string
}

/** 预览里最多列几条改动（超出只计数、标 truncated；上游预览也有长度控制）。 */
export const PREVIEW_MAX_CHANGES = 40

/**
 * 行拆分：末尾的换行是**分隔符**不是空行（`'B\n'` 是一行；`''` 是零行），
 * 否则每个以换行结尾的编辑载荷都会被多算一行。
 */
function splitLines(text: string): string[] {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body === '' ? [] : body.split('\n')
}

/** 单条 LSP 编辑的对照：按原始坐标切旧文本，新文本就是编辑载荷（`\r` 保留，如实呈现）。 */
function changeOf(source: string, edit: { text: string; startLine: number; startChar: number; endLine: number; endChar: number }): { change: PreviewChange; added: number; removed: number } {
  const lines = source.split('\n')
  const start = offsetOf(lines, edit.startLine, edit.startChar)
  const end = offsetOf(lines, edit.endLine, edit.endChar)
  const before = splitLines(source.slice(start, Math.max(start, end)))
  const after = splitLines(edit.text)
  return {
    change: { line: edit.startLine + 1, before, after },
    added: after.length,
    removed: before.length,
  }
}

/**
 * 把一组文件编辑算成预览。`textFor` 返回文件当前文本，拿不到（null/undefined）时该文件落
 * `unavailable`（仍然计数）。没有任何编辑时返回 null —— 调用方据此不出「预览」入口。
 */
export function previewOfEdits(
  files: readonly LspFileEdits[],
  textFor: (path: string) => string | null | undefined,
): IntentionPreview | null {
  const previews: FilePreview[] = []
  let changes = 0
  let added = 0
  let removed = 0
  let truncated = false
  for (const file of files) {
    const edits = file.textEdits ?? []
    if (!edits.length) continue
    const source = textFor(file.path)
    const changesForFile: PreviewChange[] = []
    let addedForFile = 0
    let removedForFile = 0
    // 编辑按起点排序只影响列表顺序；每条按原坐标独立取对照，互不影响。
    const ordered = [...edits].sort((a, b) => a.startLine - b.startLine || a.startChar - b.startChar)
    for (const edit of ordered) {
      if (typeof source === 'string') {
        const result = changeOf(source, edit)
        addedForFile += result.added
        removedForFile += result.removed
        if (changes + changesForFile.length < PREVIEW_MAX_CHANGES) changesForFile.push(result.change)
        else truncated = true
      }
    }
    changes += ordered.length
    added += addedForFile
    removed += removedForFile
    previews.push({
      path: file.path,
      changedLines: ordered.length,
      added: addedForFile,
      removed: removedForFile,
      changes: changesForFile,
      unavailable: typeof source !== 'string',
    })
  }
  if (!previews.length) return null
  const summary = `将修改 ${previews.length} 个文件：${added} 行新增 / ${removed} 行删除`
  return { files: previews, changedFiles: previews.length, changedLines: changes, added, removed, truncated, summary }
}
