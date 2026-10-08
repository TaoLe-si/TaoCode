<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { History as HistoryIcon, RotateCcw, FileCode2, Files, Clock, Tag, Plus, X } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import { BridgeError, isDesktop, request, type AppState, type DiffRow, type DocumentData, type GitChange, type GitStatus, type HistoryContent, type HistoryDiff, type HistoryDiffSides, type HistoryEntry, type HistoryList, type SaveResult } from '../bridge'
import { mergeHistory, renameChain, type HistoryFollowGroup } from '../historyFollow'
import { HISTORY_SESSION_PATH_LIMIT, buildSessionFiles, filterSessionFiles, missingFromDiskPaths, revertRouteFor, revertSkipFor, sessionCandidatePaths, sessionRevertPlan, sessionRevertReport, tallyRevertSkips, type HistorySessionFile, type RevertRoute, type RevertSkipReason } from '../historySessions'
import { HISTORY_PERIOD_LABELS, timelineRows, type HistoryPeriod } from '../historyTimeline'
import { labelEntry, labelRowText, loadLabels, normalizeLabelName, putLabel, removeLabel, type HistoryLabel } from '../historyLabels'
import { saveFailureFor } from '../appSaveFailure.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{ path: string; ready: boolean }>()
const emit = defineEmits<{ revert: [entry: HistoryEntry] }>()

// 每个路径一组（当前路径 + 重命名前的旧路径链，见 src/historyFollow.ts 的来龙去脉）。
const groups = ref<HistoryFollowGroup[]>([])
// 会话视图（`DirectoryHistoryDialog.java:52,57` / `RecentChangesAction.java:18` 的本仓等价物）：
// 一行一个文件的快照，跨文件按各自最新快照排；目录输入框就是上游"传一个目录进对话框"的那条路。
const mode = ref<'file' | 'session'>('file')
const directory = ref('')
const sessionFiles = ref<HistorySessionFile[]>([])
const sessionNote = ref('')
// 时段标题按读取时刻判 12 小时窗口（`RevisionsList.java:63,133-146,222-224`）。
const nowMillis = ref(Date.now())
const selected = ref<{ path: string; followed: boolean; entry: HistoryEntry } | null>(null)
const diff = ref('')
const diffRows = ref<DiffRow[]>([])
const diffTruncated = ref(false)
const diffHeader = ref('')
const loading = ref(false)
const diffLoading = ref(false)
const error = ref('')
const restoring = ref(false)
const restoreMessage = ref('')
const reverting = ref(false)
// 已经不在磁盘上的路径（重命名前身 / 被删除的行）：单行回滚据此禁用，见 `revertRouteFor`。
const goneFromDisk = ref<ReadonlySet<string>>(new Set())
// 标签位（`PutLabelAction` 的等价物，见 src/historyLabels.ts）：工程级的时间点，独立于文件。
const labels = ref<HistoryLabel[]>([])
const labelPrompt = ref(false)
const labelDraft = ref('')
const labelError = ref('')
// 当前项目根：标签按项目分桶（`Label.affectsProject`），宿主的 `app.state` 给的是 `lastProject`。
const projectRoot = ref('')

const filteredSessionFiles = computed(() => filterSessionFiles(sessionFiles.value, directory.value))
const total = computed(() => mode.value === 'file'
  ? groups.value.reduce((sum, group) => sum + group.entries.length, 0)
  : filteredSessionFiles.value.reduce((sum, file) => sum + file.entries.length, 0))
// The list is keyed to a file and the diff to one snapshot, so each keeps a token:
// an answer that arrives after the subject changed belongs to nothing on screen.
let listToken = 0
let diffToken = 0

/** 一节 = 一个路径的时间线；`items` 里带着该行的时段标题。 */
interface TimelineItem { path: string; followed: boolean; entry: HistoryEntry; period: HistoryPeriod | null }
interface TimelineSection { key: string; label: string; versions: number; items: TimelineItem[] }

// 文件模式：当前路径那一节没有标题（沿用原形状），重命名前的节标「重命名前」。
// 会话模式：一节一个文件，标题带路径 + 版本数 —— 上游会话行的「N files」那一列
// （`RevisionsList.java:390,442`，键 `revisions.table.filesCount`）在本仓是"这个文件有几个版本"。
const sections = computed<TimelineSection[]>(() => {
  const sources = mode.value === 'file'
    ? groups.value.map(group => ({ path: group.path, followed: group.followed, entries: group.entries }))
    : filteredSessionFiles.value.map(file => ({ path: file.path, followed: file.path !== props.path, entries: file.entries }))
  return sources.map(source => ({
    key: `${mode.value}:${source.path}`,
    label: mode.value === 'file'
      ? (source.followed ? `${source.path} · 重命名前` : '')
      : `${source.path} · ${source.followed ? '变更文件' : '当前文件'}`,
    versions: source.entries.length,
    items: timelineRows(source.entries, nowMillis.value)
      .map(row => ({ path: source.path, followed: source.followed, entry: row.entry, period: row.period })),
  }))
})

// Git 的重命名检测给的是"当前路径的旧名字"链；Git 不可用（非仓库）时静默返回空链，
// 本地历史照常按当前路径显示。
async function followAncestors(token: number): Promise<Array<{ path: string; entries: HistoryEntry[] }>> {
  try {
    const status = await request<GitStatus>('git.status')
    if (token !== listToken) return []
    const chain = renameChain(status.changes ?? [], props.path)
    const ancestors: Array<{ path: string; entries: HistoryEntry[] }> = []
    for (const path of chain) {
      const listed = await request<HistoryList>('history.list', { path })
      if (token !== listToken) return []
      if (listed.entries?.length) ancestors.push({ path, entries: listed.entries })
    }
    return ancestors
  } catch {
    return []
  }
}

// 会话视图的候选路径来自 Git 变更集（含重命名前身）+ 当前文件，逐路径 `history.list`。
// 宿主没有跨文件的会话索引（`native/history.hpp:35` 的 `list()` 只收一个 path），所以这是
// N 次请求，N 有上限，被截掉的部分如实写在状态行里。
let changedPaths: GitChange[] = []
async function loadSession(token: number) {
  const paths = sessionCandidatePaths(changedPaths, props.path)
  const listed: Array<{ path: string; entries: HistoryEntry[] }> = []
  for (const path of paths) {
    const result = await request<HistoryList>('history.list', { path })
    if (token !== listToken) return
    if (result.entries?.length) listed.push({ path, entries: result.entries })
  }
  sessionFiles.value = buildSessionFiles(listed)
  sessionNote.value = changedPaths.length >= HISTORY_SESSION_PATH_LIMIT
    ? `变更文件多于 ${HISTORY_SESSION_PATH_LIMIT} 个，会话视图只列了前 ${HISTORY_SESSION_PATH_LIMIT} 个路径。` : ''
}

async function load() {
  const token = ++listToken
  selected.value = null
  diff.value = ''
  diffRows.value = []
  diffHeader.value = ''
  error.value = ''
  groups.value = []
  sessionFiles.value = []
  sessionNote.value = ''
  restoreMessage.value = ''
  if (!isDesktop || !props.path || !props.ready) return
  loading.value = true
  nowMillis.value = Date.now()
  try {
    const listed = await request<HistoryList>('history.list', { path: props.path })
    if (token !== listToken) return // a stale answer must not replace the new file's list
    const ancestors = await followAncestors(token)
    if (token !== listToken) return
    groups.value = mergeHistory(props.path, listed.entries ?? [], ancestors)
    changedPaths = []
    goneFromDisk.value = new Set()
    // 标签按项目根分桶；拿不到根（未打开项目）时不显示标签，也不误存。
    try {
      const state = await request<AppState>('app.state')
      if (token !== listToken) return
      projectRoot.value = state.lastProject ?? ''
      labels.value = projectRoot.value ? loadLabels(projectRoot.value) : []
    } catch { projectRoot.value = ''; labels.value = [] }
    try {
      const status = await request<GitStatus>('git.status')
      if (token !== listToken) return
      changedPaths = status.changes ?? []
      // 重命名前身与删除行都不在磁盘上了：上游靠 `RenameChange`/`DeleteChange` 事件复原它们
      // （`platform/lvcs-impl/src/com/intellij/history/integration/revertion/DifferenceReverter.kt:50-52`
      // 的 `doRevert()`），本仓宿主没有那个通道 ⇒ 这两类行不可单行回滚。
      goneFromDisk.value = missingFromDiskPaths(changedPaths)
    } catch { changedPaths = [] } // 非仓库：会话视图只剩当前文件
    if (mode.value === 'session') await loadSession(token)
    if (token !== listToken) return
    const first = groups.value.find(group => group.entries.length > 0)
    if (first) await select(first.path, first.entries[0]!, first.followed)
  } catch (caught) { if (token === listToken) error.value = message(caught) }
  finally { if (token === listToken) loading.value = false }
}
async function select(path: string, entry: HistoryEntry, followed: boolean) {
  selected.value = { path, entry, followed }
  const token = ++diffToken
  if (!isDesktop || !props.path) { diff.value = ''; diffRows.value = []; return }
  diffLoading.value = true
  try {
    // Unified text for the patch view, aligned rows for the side-by-side one; both
    // come from the same snapshot so the two modes cannot disagree. 快照按**这一行所属的
    // 路径**取（重命名前的条目在旧路径的时间线里，会话模式里的条目在各文件自己的时间线里）。
    const [unified, sides] = await Promise.all([
      request<HistoryDiff>('history.diff', { path, id: entry.id }),
      request<HistoryDiffSides>('history.diffSides', { path, id: entry.id }),
    ])
    if (token !== diffToken) return
    diff.value = unified.diff ?? ''
    diffRows.value = sides.rows ?? []
    diffTruncated.value = sides.truncated === true
    diffHeader.value = sides.header ?? ''
  }
  catch (caught) {
    if (token !== diffToken) return
    diff.value = ''; diffRows.value = []; error.value = message(caught)
  }
  finally { if (token === diffToken) diffLoading.value = false }
}
function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }
function label(entry: HistoryEntry) {
  return `${entry.time.replace('T', ' ').replace('Z', '')}  ·  ${entry.reason}  ·  ${entry.bytes} B`
}
// 回滚落点三档（`revertRouteFor`，上游坐标在 src/historySessions.ts 的那段注释里）：
// 活动文件仍走宿主链，会话里**其它仍在磁盘上的**文件由本面板直写 —— 上游目录对话框的
// Revert 本来就作用于所选版本涉及的这些文件，启用条件也只是"选了版本"；
// 已经不在磁盘上的（重命名前身 / 被删除）保持禁用。
const revertRoute = computed<RevertRoute>(() => revertRouteFor(selected.value, props.path, goneFromDisk.value))
const canRevert = computed(() => revertRoute.value !== 'none')
const revertTitle = computed(() => {
  if (!selected.value) return '先在左侧选出一个版本'
  if (revertRoute.value === 'host') return '把当前文件回滚到所选版本（会作为新版本保存）'
  if (revertRoute.value === 'direct') return `把 ${selected.value.path} 回滚到所选版本（直接写磁盘，回滚本身也会被记为一版）`
  return '这一条对应的文件已不在磁盘上（重命名前身或被删除）；宿主的回退只按当前路径写，直接写旧路径会凭空造出一个文件'
})

/**
 * 回滚一个**非活动**文件：读快照 → 读磁盘 → 写盘。写之前先做上游
 * `platform/lvcs-impl/src/com/intellij/history/integration/revertion/Reverter.kt:24-29`
 * 那一步 `checkCanRevert()`（它唯一的检查项就是只读），所以只读文件在这儿被挡下、
 * 不去撞宿主那句 `READ_ONLY`（`native/workspace.cpp:933-934`）。写失败由调用方按错误码分类。
 *
 * 本面板看不到标签页（Tab 归 App.vue，它没有把缓冲传进来的通道），所以别的文件若有
 * **未保存改动**，这里写的仍是磁盘版本：用户随后保存会撞宿主那句 `CONFLICT`
 * （`native/workspace.cpp:928`）并由 `src/appSaveFailure.ts` 提示重载/保留 —— 上游是
 * 在 revert 前后各 `saveAllUnsavedDocuments()`
 * （`platform/lvcs-impl/src/com/intellij/history/integration/revertion/Reverter.kt:42-47`）
 * 来避免这一步，本仓没有那个"先存全部"的入口，落成了冲突提示而不是静默覆盖。
 */
async function revertOneFile(path: string, entry: HistoryEntry): Promise<RevertSkipReason | null> {
  const [snapshot, current] = await Promise.all([
    request<HistoryContent>('history.content', { path, id: entry.id }),
    request<DocumentData>('file.read', { path }),
  ])
  const blocker = revertSkipFor({ readOnly: current.readOnly, unchanged: current.content === snapshot.content })
  if (blocker) return blocker
  // 只读与"内容已一致"在上面就挡住了；这里剩下的失败（版本冲突 / 路径已消失 / …）
  // 由调用方按宿主错误码归类，不在这儿吞掉。
  await request<SaveResult>('file.write', {
    path, content: snapshot.content, expectedVersion: current.version, encoding: current.encoding, bom: current.bom,
  })
  void request('lsp.change', { path, text: snapshot.content }).catch(() => undefined)
  return null
}

/** 错误码 → 跳过原因（catch 里一定给出原因，不留 null）。 */
function skipReasonFrom(caught: unknown): RevertSkipReason {
  const code = caught instanceof BridgeError ? caught.code : null
  return revertSkipFor({ code }) ?? 'failed'
}

// 单行「回滚此版本」：活动文件交宿主（它会重建编辑器缓冲并重记历史），其它在盘上的文件
// 由本面板直写；只读被前置检查挡下时，文案沿用 `src/appSaveFailure.ts:26-28` 那一句（本仓唯一权威位）。
// 结果**必须落在 `await load()` 之后** —— `load()` 一开头就把 `error`/`restoreMessage` 清空，
// 先写后刷等于什么都没写（这条是本批自查发现自己埋进去的坑，判据见 tests/history-revert.test.mjs）。
async function revertSelected() {
  const row = selected.value
  if (!row || reverting.value || revertRoute.value === 'none') return
  if (revertRoute.value === 'host') { emit('revert', row.entry); return }
  reverting.value = true
  error.value = ''
  try {
    const reason = await revertOneFile(row.path, row.entry).catch(skipReasonFrom)
    await load()
    if (reason === 'read-only') error.value = saveFailureFor('READ_ONLY', row.path, '').message
    else if (reason === 'conflict') error.value = saveFailureFor('CONFLICT', row.path, '').message
    else if (reason === 'unchanged') restoreMessage.value = `${row.path} 已经就是这个版本，无需回滚。`
    else if (reason === 'failed') error.value = `回滚 ${row.path} 失败。`
    else restoreMessage.value = `已回滚 ${row.path} 到 ${row.entry.time.replace('T', ' ').replace('Z', '')}`
  } finally {
    reverting.value = false
  }
}

// 「恢复整个会话」：以上面选中的那一版为时间边界，把列出的每个文件回退到
// 该时刻**之前**的最后一版（`sessionRevertPlan`）。活动文件仍交给宿主那条链
// （emit revert：它会更新标签页缓冲并重记一次历史），其余文件走 `revertOneFile`；
// 每个没动的文件都记下**原因**（只读 / 磁盘已变 / 内容已一致 / 写不进去），
// 不再和"本来就不用动"混成一句 —— 上游
// `platform/lvcs-impl/src/com/intellij/history/integration/ui/views/HistoryDialog.java:371-373`
// 正是把 `checkCanRevert()` 的原因单独报出来的（`message.cannot.revert.because` +
// `revert.error.files.are.read.only`）。
async function restoreSession() {
  if (!selected.value || restoring.value) return
  const sources = mode.value === 'session' ? filteredSessionFiles.value : groups.value
  const plan = sessionRevertPlan(sources.map(item => ({ path: item.path, entries: item.entries })), selected.value.entry.timeMillis)
  if (!plan.length) { restoreMessage.value = '这个时刻之前没有更早的版本可回退。'; return }
  restoring.value = true
  error.value = ''
  const reasons: RevertSkipReason[] = []
  let done = 0
  const own = plan.find(step => step.path === props.path)
  for (const step of plan) {
    if (step.path === props.path) continue // 留给宿主，最后再发（它会重建本面板）
    try {
      const reason = await revertOneFile(step.path, step.entry)
      if (reason) reasons.push(reason)
      else done++
    } catch (caught) { reasons.push(skipReasonFrom(caught)) }
  }
  restoring.value = false
  const readOnly = tallyRevertSkips(reasons)['read-only'] ?? 0
  const note = sessionRevertReport(done, reasons)
  const blocker = readOnly ? saveFailureFor('READ_ONLY', `${readOnly} 个文件`, '').message : ''
  if (own) {
    // 活动文件也在清单里：宿主那条回滚会 `historyEpoch++` 重挂本面板（`src/App.vue:2375` 的 :key），
    // 提示位在这里写了也留不住，结果交给宿主自己的 notify（`App.vue` 的 `revertHistory`）。
    emit('revert', own.entry)
    return
  }
  // `load()` 一开头就把 error/restoreMessage 清空 ⇒ 汇总必须落在它之后，否则等于什么都没报。
  await load()
  if (blocker) error.value = blocker
  restoreMessage.value = note
}

/**
 * 打一个标签（`PutLabelAction.java:29-57` + `LocalHistoryFacade.kt:113-116` 的 `putUserLabel`）。
 * 上游弹输入框 + `NonEmptyInputValidator`；本仓用面板里那一行内联输入（同一件事的 DOM 形态）。
 * 时间戳 = 此刻，路径 = 当前文件（只用于列表里显示"在哪打的"）。
 */
function createLabel() {
  if (!projectRoot.value) { labelError.value = '没有打开的项目，标签按项目保存，无法落位。'; return }
  const name = normalizeLabelName(labelDraft.value)
  if (!name) { labelError.value = '标签名不能为空。'; return }
  const next = putLabel(projectRoot.value, name, Date.now(), props.path)
  if (!next) { labelError.value = '标签名不能为空。'; return }
  labels.value = next
  labelDraft.value = ''
  labelError.value = ''
  labelPrompt.value = false
  restoreMessage.value = `已放置标签「${name}」`
}

function deleteLabel(name: string) {
  if (!projectRoot.value) return
  labels.value = removeLabel(projectRoot.value, name)
  restoreMessage.value = `已删除标签「${name}」`
}

/**
 * 「恢复到此标签」：标签是一个**时间边界**，不是某条快照（`PutLabelChange` 不挂路径）。
 * 所以把当前模式下列出的每个文件回退到该时刻之前的最后一版 —— 复用 `sessionRevertPlan`
 * 与会话恢复同一条链（活动文件交宿主、其余直写、逐个记原因）。
 */
async function restoreToLabel(label: HistoryLabel) {
  if (restoring.value) return
  const sources = mode.value === 'session' ? filteredSessionFiles.value : groups.value
  // 标签时刻那条快照存在才算「可恢复」；一条都对不上就是标签比最早的快照还早。
  const anchor = sources.find(item => item.entries.length && labelEntry(item.entries, label))
  if (!anchor) { restoreMessage.value = `标签「${label.name}」的时刻之前没有可回退的版本。`; return }
  const plan = sessionRevertPlan(sources.map(item => ({ path: item.path, entries: item.entries })), label.timeMillis)
  if (!plan.length) { restoreMessage.value = `所有文件都已经在标签「${label.name}」的时刻或之后，无需回退。`; return }
  restoring.value = true
  error.value = ''
  const reasons: RevertSkipReason[] = []
  let done = 0
  const own = plan.find(step => step.path === props.path)
  for (const step of plan) {
    if (step.path === props.path) continue // 留给宿主，最后再发
    try {
      const reason = await revertOneFile(step.path, step.entry)
      if (reason) reasons.push(reason)
      else done++
    } catch (caught) { reasons.push(skipReasonFrom(caught)) }
  }
  restoring.value = false
  const readOnly = tallyRevertSkips(reasons)['read-only'] ?? 0
  const note = sessionRevertReport(done, reasons)
  const blocker = readOnly ? saveFailureFor('READ_ONLY', `${readOnly} 个文件`, '').message : ''
  if (own) { emit('revert', own.entry); return }
  await load()
  if (blocker) error.value = blocker
  restoreMessage.value = `恢复标签「${label.name}」：${note}`
}

watch(() => [props.path, props.ready], () => void load(), { immediate: true })
watch(mode, value => {
  selected.value = null; diff.value = ''; diffRows.value = []; diffHeader.value = ''
  if (value === 'session' && isDesktop && props.ready && !sessionFiles.value.length) {
    void loadSession(++listToken).catch(caught => { error.value = message(caught) })
  }
})
watch(directory, () => { selected.value = null })
</script>

<template>
  <div class="hist-panel">
    <div class="panel-heading"><span><HistoryIcon :size="iconSize.control" />本地历史</span><span class="heading-count">{{ total }}</span></div>
    <div v-if="path && ready && isDesktop" class="hist-tools">
      <button class="hist-tool" :class="{ on: mode === 'file' }" title="只看当前文件（含重命名前的路径）" aria-label="只看当前文件" :aria-pressed="mode === 'file'" @click="mode = 'file'"><FileCode2 :size="iconSize.menu" /></button>
      <button class="hist-tool" :class="{ on: mode === 'session' }" aria-label="变更文件的会话视图" :aria-pressed="mode === 'session'" @click="mode = 'session'"><Files :size="iconSize.menu" /></button>
      <input v-if="mode === 'session'" v-model="directory" class="hist-directory" aria-label="按目录过滤会话" placeholder="只列这个目录 / 路径前缀…" spellcheck="false" />
      <button class="subtle-button hist-restore" :disabled="restoring || !selected" :title="selected ? '把列出的文件都回退到所选时刻之前的版本' : '先在左侧选一个版本作为回滚边界'" @click="restoreSession"><Clock aria-hidden="true" :size="iconSize.menu" />恢复到此时刻</button>
      <button class="hist-tool" type="button" :disabled="!projectRoot" :aria-expanded="labelPrompt" aria-controls="hist-label-add" aria-label="放置标签" @click="labelPrompt = !labelPrompt"><Tag :size="iconSize.menu" /></button>
    </div>
    <div v-if="labelPrompt && projectRoot" id="hist-label-add" class="hist-label-add">
      <input v-model="labelDraft" class="hist-label-input" aria-label="标签名" placeholder="标签名…" spellcheck="false" @keydown.enter="createLabel" />
      <button class="subtle-button" :disabled="!labelDraft.trim()" @click="createLabel"><Plus aria-hidden="true" :size="iconSize.menu" />放置</button>
      <button class="hist-tool" aria-label="取消" @click="labelPrompt = false; labelError = ''"><X :size="iconSize.menu" /></button>
    </div>
    <p v-if="labelError" class="hist-error">{{ labelError }}</p>
    <div v-if="labels.length" class="hist-labels" role="list" aria-label="标签">
      <div v-for="tag in labels" :key="tag.name" class="hist-label-row" role="listitem">
        <Tag :size="iconSize.menu" aria-hidden="true" />
        <span class="hist-label-name" :title="tag.path ? `打在 ${tag.path}` : ''">{{ labelRowText(tag) }}</span>
        <button class="subtle-button hist-label-go" :disabled="restoring" title="把列出的文件都回退到这个标签的时刻之前" @click="restoreToLabel(tag)">恢复</button>
        <button class="hist-tool" aria-label="删除标签" @click="deleteLabel(tag.name)"><X :size="iconSize.menu" /></button>
      </div>
    </div>
    <p v-if="!path" class="hist-empty">选择一个文件查看其本地历史。</p>
    <p v-else-if="!isDesktop || !ready" class="hist-empty">浏览器预览没有本地历史，请在桌面端使用。</p>
    <p v-if="error" class="hist-error">{{ error }}</p>
    <p v-if="sessionNote || restoreMessage" class="hist-note" aria-live="polite">{{ sessionNote }}{{ restoreMessage }}</p>
    <div v-if="loading" class="hist-empty">读取中…</div>
    <template v-else-if="path && ready && isDesktop">
      <div v-if="!total" class="hist-empty">{{ mode === 'session' ? '变更列表里的文件都还没有保存过的历史版本。' : '此文件（及其重命名前的路径）还没有保存过的历史版本。' }}</div>
      <div v-else class="hist-body">
        <div class="hist-list" role="list" aria-label="历史版本">
          <template v-for="section in sections" :key="section.key">
            <p v-if="section.label" class="hist-group">{{ section.label }} · {{ section.versions }} 个版本</p>
            <template v-for="item in section.items" :key="`${item.path}:${item.entry.id}`">
              <p v-if="item.period" class="hist-period">{{ HISTORY_PERIOD_LABELS[item.period] }}</p>
              <button class="hist-item" role="listitem"
                      :class="{ selected: selected?.path === item.path && selected?.entry.id === item.entry.id }"
                      :aria-current="selected?.path === item.path && selected?.entry.id === item.entry.id ? 'true' : undefined"
                      @click="select(item.path, item.entry, item.followed)">{{ label(item.entry) }}</button>
            </template>
          </template>
        </div>
        <div class="hist-actions">
          <button class="subtle-button" :disabled="reverting || !canRevert" :title="revertTitle" @click="revertSelected"><RotateCcw aria-hidden="true" :size="iconSize.menu" />回滚此版本</button>
        </div>
        <p v-if="diffLoading" class="hist-empty">正在读取所选版本的差异…</p>
        <DiffView v-else-if="diffRows.length || diff" :path="selected?.path ?? props.path" :subtitle="diffHeader" :rows="diffRows" :unified="diff" :truncated="diffTruncated" />
        <p v-else-if="selected" class="hist-empty">与当前内容一致，无差异。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hist-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.heading-count { margin-left: auto; color: var(--muted); font-size: 10px; }
.hist-tools { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.hist-tool { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); flex-shrink: 0; padding: 0; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.hist-tool:hover { background: var(--hover); color: var(--text); }
.hist-tool.on { color: var(--accent); background: var(--selected); border-color: var(--line-strong); }
.hist-directory { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.hist-directory:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.hist-restore { flex-shrink: 0; gap: var(--space-1); }
/* 标签位（`PutLabelAction` 的等价物）：一行放置 + 一列已放的标签。 */
.hist-label-add { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.hist-label-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.hist-label-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.hist-labels { flex: 0 0 auto; max-height: 30%; overflow: auto; border-bottom: 1px solid var(--line); }
.hist-label-row { display: flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-3); color: var(--secondary); font: 11px var(--font-mono); }
.hist-label-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-label-go { flex-shrink: 0; }
.hist-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.hist-list { flex: 0 1 auto; max-height: 40%; overflow: auto; border-bottom: 1px solid var(--line); }
.hist-item { display: block; width: 100%; padding: 3px var(--space-3); border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--text); text-align: left; font: 11px/1.6 var(--font-mono); cursor: pointer; }
.hist-item:hover { background: var(--hover); }
.hist-item.selected { background: var(--selected); color: var(--bright); }
/* 重命名前的分组标题：旧路径的时间线跟在当前路径之后。 */
.hist-group { margin: 0; padding: 2px var(--space-3); color: var(--muted); background: var(--rail); font: 10px var(--font-mono); border-bottom: 1px solid var(--line); }
/* 时段标题：`RevisionsList.java:222-224` 的三档（最近 12 小时 / 更早 / 旧的更改）。 */
.hist-period { margin: 0; padding: 2px var(--space-3); color: var(--secondary); background: var(--panel); font-size: 10px; font-weight: 600; border-bottom: 1px solid var(--line); }
.hist-actions { display: flex; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.hist-error { margin: 0; padding: var(--space-2) var(--space-3); color: var(--error); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.hist-note { margin: 0; padding: 2px var(--space-3); color: var(--secondary); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.hist-empty { padding: var(--space-4) var(--space-3); color: var(--muted); font-size: 11px; line-height: 1.7; }
</style>
