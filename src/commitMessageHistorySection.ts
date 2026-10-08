// 提交信息历史弹层的宿主状态（上游 `ShowMessageHistoryAction` 的输入/预览/提交三段）。
//
// 从 `SourceControl.vue` 拆出来（那个文件贴死 900 行机检上限，加搁架树之前必须先腾地方），
// 行为逐字未改：
//   · 打开时拉一次 `git log` 主题，与内存 MRU 合并成"新 → 旧"的一列（`loadMessageHistory`）；
//   · 悬停**预览**（把信息临时填进编辑框），离开还原草稿（`ShowMessageHistoryAction.kt:66-88`）；
//   · 点一行**落定**并收起弹层；
//   · 提交成功后把这条信息记进 MRU（`VcsConfiguration.saveCommitMessage`）。
//
// 纯规则（MRU 上限、去重、预览单行化）在 `src/commitMessageHistory.ts`，本模块只持有"当前面板的
// 那一份状态"与三件事之间的次序，不碰 DOM 也不碰请求体。
import { ref, type Ref } from 'vue'
import { loadMessageHistory, messageHistoryRows, saveRecentMessage } from './commitMessageHistory.ts'

export interface CommitMessageHistoryDeps {
  /** 取 `git log` 的主题列表（读不到时应自行吞掉错误或抛出，`loadMessageHistory` 会兜底）。 */
  fetchSubjects: () => Promise<readonly string[] | null | undefined>
  /** 编辑框里的文本（预览要临时改写它）。 */
  message: Ref<string>
  /** 读历史失败时的一句提示。 */
  onError?: (message: string) => void
  /** 弹层一列的上限（默认 12，见 `messageHistoryRows`）。 */
  limit?: number
}

export function createCommitMessageHistory(deps: CommitMessageHistoryDeps) {
  const open = ref(false)
  const rows = ref<string[]>([])
  const loading = ref(false)
  /** 内存 MRU（旧 → 新，与 `getRecentMessages()` 同序）。 */
  const recent = ref<string[]>([])
  let previewDraft: string | null = null

  function toggle() {
    open.value = !open.value
    if (!open.value) return
    loading.value = true
    void loadMessageHistory(deps.fetchSubjects, recent.value)
      .then(next => { rows.value = next })
      .catch(caught => { deps.onError?.(caught instanceof Error ? caught.message : String(caught)) })
      .finally(() => { loading.value = false })
  }

  function preview(subject: string) {
    if (previewDraft === null) previewDraft = deps.message.value
    deps.message.value = subject
  }

  function endPreview() {
    if (previewDraft !== null && open.value) deps.message.value = previewDraft
    previewDraft = null
  }

  function pick(subject: string) {
    previewDraft = null
    deps.message.value = subject
    open.value = false
  }

  /** 提交成功后记一笔（`saveRecentMessage`：空白不进、去重、满了丢最旧）。 */
  function remember(text: string) {
    recent.value = saveRecentMessage(recent.value, text)
  }

  /** 换项目时清空（弹层一列与 MRU 都是上一个仓库的事实）。 */
  function reset() {
    open.value = false
    rows.value = []
    previewDraft = null
  }

  /** 供判据/外部读的当前列（MRU 在前）。 */
  const currentRows = () => messageHistoryRows(recent.value, rows.value, deps.limit ?? 12)

  return { open, rows, loading, recent, toggle, preview, endPreview, pick, remember, reset, currentRows }
}
