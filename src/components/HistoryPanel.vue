<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { History as HistoryIcon, RotateCcw, FileCode2, Files, Clock } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import { isDesktop, request, type DiffRow, type DocumentData, type GitChange, type GitStatus, type HistoryContent, type HistoryDiff, type HistoryDiffSides, type HistoryEntry, type HistoryList, type SaveResult } from '../bridge'
import { mergeHistory, renameChain, type HistoryFollowGroup } from '../historyFollow'
import { HISTORY_SESSION_PATH_LIMIT, buildSessionFiles, filterSessionFiles, sessionCandidatePaths, sessionRevertPlan, type HistorySessionFile } from '../historySessions'
import { HISTORY_PERIOD_LABELS, timelineRows, type HistoryPeriod } from '../historyTimeline'
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
let changedPaths: Array<Pick<GitChange, 'path' | 'renameFrom'>> = []
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
    try {
      const status = await request<GitStatus>('git.status')
      if (token !== listToken) return
      changedPaths = status.changes ?? []
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
// 回滚写的是当前路径，重命名前/会话里其它文件的快照不能走这条路（App.vue 的回退动作
// 只按活动文件落盘并刷新它的编辑器缓冲）。
const canRevert = computed(() => selected.value ? !selected.value.followed : false)
const revertTitle = computed(() => {
  if (!selected.value) return '先在左侧选出一个版本'
  if (!selected.value.followed) return '把当前文件回滚到所选版本（会作为新版本保存）'
  return '这一条属于另一个路径；宿主的回退只写当前活动文件，请先打开该文件再看它的历史'
})

// 「恢复整个会话」：以上面选中的那一版为时间边界，把列出的每个文件回退到
// 该时刻**之前**的最后一版（`sessionRevertPlan`）。活动文件仍交给宿主那条链
// （emit revert：它会更新标签页缓冲并重记一次历史），其余文件走本仓已有的
// file.read + file.write，编辑器缓冲由 `src/diskSync.ts` 的磁盘同步刷新；
// 写不进去的（版本冲突 / 文件已删）计入跳过并如实报数，不静默。
async function restoreSession() {
  if (!selected.value || restoring.value) return
  const sources = mode.value === 'session' ? filteredSessionFiles.value : groups.value
  const plan = sessionRevertPlan(sources.map(item => ({ path: item.path, entries: item.entries })), selected.value.entry.timeMillis)
  if (!plan.length) { restoreMessage.value = '这个时刻之前没有更早的版本可回退。'; return }
  restoring.value = true
  error.value = ''
  let done = 0
  let skipped = 0
  const own = plan.find(step => step.path === props.path)
  for (const step of plan) {
    if (step.path === props.path) continue // 留给宿主，最后再发（它会重建本面板）
    try {
      const [snapshot, current] = await Promise.all([
        request<HistoryContent>('history.content', { path: step.path, id: step.entry.id }),
        request<DocumentData>('file.read', { path: step.path }),
      ])
      if (current.content === snapshot.content) { skipped++; continue }
      await request<SaveResult>('file.write', {
        path: step.path, content: snapshot.content, expectedVersion: current.version,
        encoding: current.encoding, bom: current.bom,
      })
      void request('lsp.change', { path: step.path, text: snapshot.content }).catch(() => undefined)
      done++
    } catch { skipped++ }
  }
  restoring.value = false
  restoreMessage.value = `会话回滚：已回退 ${done} 个文件，跳过 ${skipped} 个（无更早版本、内容已一致或写不进去）。`
  if (own) emit('revert', own.entry)
  else void load()
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
      <button class="hist-tool" :class="{ on: mode === 'session' }" title="变更文件的会话视图" aria-label="变更文件的会话视图" :aria-pressed="mode === 'session'" @click="mode = 'session'"><Files :size="iconSize.menu" /></button>
      <input v-if="mode === 'session'" v-model="directory" class="hist-directory" aria-label="按目录过滤会话" placeholder="只列这个目录 / 路径前缀…" spellcheck="false" />
      <button class="subtle-button hist-restore" :disabled="restoring || !selected" :title="selected ? '把列出的文件都回退到所选时刻之前的版本' : '先在左侧选一个版本作为回滚边界'" @click="restoreSession"><Clock :size="iconSize.menu" />恢复到此时刻</button>
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
          <button class="subtle-button" :disabled="!canRevert" :title="revertTitle" @click="selected && canRevert && emit('revert', selected.entry)"><RotateCcw :size="iconSize.menu" />回滚此版本</button>
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
.hist-tool { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: 22px; flex-shrink: 0; padding: 0; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
.hist-tool:hover { background: var(--hover); color: var(--text); }
.hist-tool.on { color: var(--accent); background: var(--selected); border-color: var(--line-strong); }
.hist-directory { flex: 1; min-width: 0; min-height: 22px; padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: 11px; }
.hist-directory:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.hist-restore { flex-shrink: 0; gap: var(--space-1); }
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
