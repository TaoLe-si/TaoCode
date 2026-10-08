// 提交信息检查与 amend 改写的一节（上游 `BaseCommitMessageInspection` 一族 + `AmendCommitHandlerImpl`
// 的 `setAmendMessage` / `restoreBeforeAmendMessage`）。从 `SourceControl.vue` 拆出来
// （那个文件贴着 900 行机检上限）。
//
// 三件事：
//   · `problems`  —— 当前信息过一遍检查（纯规则在 `src/commitMessageInspection.ts`）；
//   · `focusProblem`/`applyFix` —— 点某条问题选中它的区间、套用它的快捷修复；
//   · `amend` 观察 —— 进 amend 模式把「上次提交的信息」填进输入框，退出时还原草稿
//     （判据 `tests/amend-message.test.mjs` 钉着那两条纯规则）。
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import { request, type GitCommitDetails } from './bridge.ts'
import {
  addBlankLineAfterSubject, inspectCommitMessage, messageLines, reformatCommitMessage, wrapLine,
  type CommitMessageFix, type CommitMessageInspectionSettings, type CommitMessageProblem,
} from './commitMessageInspection.ts'
import { amendMessagePlan, restoreBeforeAmendMessage } from './amendMessage.ts'

export interface CommitMessageSectionDeps {
  /** 当前提交信息。 */
  message: Ref<string>
  /** 进 amend 模式的开关（上游那枚复选框）。 */
  amend: Ref<boolean>
  /** 检查设置（「设置 › 版本控制 › 提交」）。 */
  settings: () => CommitMessageInspectionSettings
  /** 信息编辑框（焦点/选区要落到它上面）。 */
  box: () => HTMLTextAreaElement | null
  /** 读 `HEAD` 的提交信息失败时的一句提示。 */
  onError: (message: string) => void
}

export interface CommitMessageSection {
  problems: ComputedRef<CommitMessageProblem[]>
  focusProblem: (problem: CommitMessageProblem) => void
  applyFix: (problem: CommitMessageProblem, fix: CommitMessageFix) => void
  reformat: () => void
}

export function createCommitMessageSection(deps: CommitMessageSectionDeps): CommitMessageSection {
  const problems = computed(() => inspectCommitMessage(deps.message.value, deps.settings()))
  // IDEA reports the problem on the offending range and offers the fixes that range can take
  // (BaseCommitMessageInspection.checkRightMargin takes `vararg fixes`, :146).
  function focusProblem(problem: CommitMessageProblem) {
    const box = deps.box()
    if (!box) return
    // Document offset of the problem's range start: every earlier line plus its separator.
    const offset = messageLines(deps.message.value)
      .slice(0, problem.line)
      .reduce((total, line) => total + line.length + 1, 0)
    box.focus()
    box.setSelectionRange(offset + problem.start, offset + problem.end)
  }
  function applyFix(problem: CommitMessageProblem, fix: CommitMessageFix) {
    if (fix === 'blankLine') { deps.message.value = addBlankLineAfterSubject(deps.message.value); return }
    if (fix === 'reformat') { deps.message.value = reformatCommitMessage(deps.message.value, deps.settings()); return }
    // WrapLineQuickFix (:75-81) wraps the range of the reported line only.
    const lines = messageLines(deps.message.value)
    lines.splice(problem.line, 1, ...wrapLine(lines[problem.line] ?? '', deps.settings().bodyRightMargin))
    deps.message.value = lines.join('\n')
  }
  // IDEA's ReformatCommitMessageAction (ReformatCommitMessageAction.java:54-59) runs the reformat of
  // every enabled inspection: the separation check inserts the missing blank line, the body limit
  // wraps the body lines to its margin. It does not touch the subject (SubjectLimitInspection has no
  // reformat) and it does not tidy whitespace — `CommitMessage.getComment()` only trims the trailing
  // whitespace of the whole message (:300-302), which the commit itself already does.
  function reformat() { deps.message.value = reformatCommitMessage(deps.message.value, deps.settings()) }

  let amendDraft: string | null = null
  let beforeAmendMessage: string | null = null
  watch(deps.amend, value => {
    if (!value) {
      const restored = restoreBeforeAmendMessage(deps.message.value, amendDraft, beforeAmendMessage)
      amendDraft = null
      beforeAmendMessage = null
      if (restored !== null) deps.message.value = restored
      return
    }
    void (async () => {
      try {
        const details = await request<GitCommitDetails>('git.commitDetails', { revision: 'HEAD' })
        const plan = amendMessagePlan(deps.message.value, details.message)
        if (plan.fill === null) return
        amendDraft = plan.fill
        beforeAmendMessage = plan.before
        deps.message.value = plan.fill
        void nextTick(() => deps.box()?.focus())
      } catch (caught) {
        // 还没有 HEAD（新仓库）就没有可改写的提交信息 —— 上游那边也是空手回来。
        deps.onError(caught instanceof Error ? caught.message : String(caught))
      }
    })()
  })

  return { problems, focusProblem, applyFix, reformat }
}
