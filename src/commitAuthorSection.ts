// 提交作者一节的宿主状态（上游 `CommitAuthorComponent` + `CommitAuthorTracker` 的输入侧）。
//
// 面板上「By <author>」那一行、以及提交选项弹层里的作者输入/候选，共用这一份状态：
//   · `repositoryAuthor` = 仓库配置（`git.user`），`authorOverride` = 本次覆盖（`--author`）；
//   · 输入框两半（名/邮箱）在 `splitAuthorInput` 里合回上游的「Name <email>」；
//   · 候选表 = 日志见过的作者 + `taocode.commitAuthor:<root>` 里存过的。
// 从 `SourceControl.vue` 拆出来（那个文件贴死 900 行上限），行为一字未改。
import { computed, reactive, ref } from 'vue'
import { request } from './bridge.ts'
import {
  authorEmailPart, authorNamePart, extendsBeyondDefault, fullName, knownAuthors, readSavedAuthors,
  saveUsedAuthor as saveUsedAuthorIn, splitAuthorInput, type CommitAuthor,
} from './commitAuthor.ts'

export interface CommitAuthorSectionDeps {
  /** 当前工作区根（按根存「用过的作者」）。 */
  root: () => string
  /** 「打开提交选项弹层」时同步动作（`CommitOptionsPanel` 的 author 行在弹层里）。 */
  onOpenOptions?: () => void
}

export function createCommitAuthorSection(deps: CommitAuthorSectionDeps) {
  const repositoryAuthor = ref<CommitAuthor>({ name: '', email: '' })
  const authorOverride = ref<CommitAuthor | null>(null)
  const authorDraft = reactive<CommitAuthor>({ name: '', email: '' })
  const effectiveAuthor = computed(() => authorOverride.value ?? repositoryAuthor.value)
  const knownAuthorEntries = ref<string[]>([])

  // GitCommitOptionsUi.kt:259 — the field completes over `getAllUsers(project) + settings.commitAuthors`.
  function saveUsedAuthor(entry: string) {
    saveUsedAuthorIn(deps.root(), entry)
    knownAuthorEntries.value = knownAuthors(knownAuthorEntries.value, [entry])
  }
  // The two fields replace IDEA's single "Name <email>" text field, so the log's exact strings
  // are split back into the halves the inputs edit (VcsUserUtil.getString :24-28).
  const knownNames = computed(() => [...new Set(knownAuthorEntries.value.map(authorNamePart).filter(Boolean))])
  const knownEmails = computed(() => [...new Set(knownAuthorEntries.value.map(authorEmailPart).filter(Boolean))])

  async function loadAuthor() {
    try {
      const user = await request<CommitAuthor>('git.user')
      repositoryAuthor.value = { name: user.name ?? '', email: user.email ?? '' }
    } catch { repositoryAuthor.value = { name: '', email: '' } }
    knownAuthorEntries.value = knownAuthors([], readSavedAuthors(deps.root()))
    try {
      const listed = await request<{ authors?: string[] }>('git.authors')
      knownAuthorEntries.value = knownAuthors(listed.authors ?? [], readSavedAuthors(deps.root()))
    } catch { /* completion is a convenience: a repo without a log just has none */ }
  }

  // The options popup owns the input, so opening it seeds the draft the way setAuthor (:205-213)
  // does: from the current author, empty when there is none (it is deliberately not pre-filled
  // with the repository default — IDEA leaves the field blank until you type something).
  function openOptions() {
    deps.onOpenOptions?.()
    authorDraft.name = authorOverride.value?.name ?? ''
    authorDraft.email = authorOverride.value?.email ?? ''
  }
  // Enter applies, exactly like the popup's VcsUserEditor keyboard action (:111-113).
  function applyAuthorEditor() {
    const draft = splitAuthorInput(authorDraft.name, authorDraft.email)
    // GitCommitOptionsUi.kt:205-213 — a null or default author leaves the field empty, so
    // re-entering the repository's own person (in any casing) is not an override.
    authorOverride.value = extendsBeyondDefault(draft, repositoryAuthor.value) ? draft : null
    if (authorOverride.value) saveUsedAuthor(fullName(authorOverride.value))
  }
  // VcsDateViewer's close button removes the author and the date again (:117-120).
  function clearAuthorOverride() {
    authorOverride.value = null
    authorDraft.name = ''
    authorDraft.email = ''
  }
  /** 换项目时把覆盖与草稿清掉（作者属于仓库配置，不能跨仓库泄漏）。 */
  function reset() {
    authorOverride.value = null
    authorDraft.name = ''
    authorDraft.email = ''
  }

  // GitCommitOptionsUi.kt:238-251 — the warning ("Author differs from default",
  // GitBundle.properties:50) shows under the field whenever an override is in effect.
  const authorWarning = computed(() => extendsBeyondDefault(authorOverride.value, repositoryAuthor.value))

  return {
    repositoryAuthor, authorOverride, authorDraft, effectiveAuthor, knownAuthorEntries,
    saveUsedAuthor, knownNames, knownEmails, loadAuthor, openOptions, applyAuthorEditor,
    clearAuthorOverride, authorWarning, reset,
  }
}
