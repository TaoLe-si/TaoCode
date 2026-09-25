<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { GitBranch, GitCommitIcon, GitMerge, RefreshCw, Plus, Minus, Check, X, CircleSlash, Download, Upload, Archive, History, Tag, Ban, GitPullRequestArrow, CloudDownload, RotateCcw, Trash2 } from 'lucide-vue-next'
import DiffView from './DiffView.vue'
import { request, type DiffRow, type DiffSides, type GitAheadBehind, type GitChange, type GitCommit, type GitCompare, type GitCompareFile, type GitHunks, type GitLog, type GitStash, type GitStatus, type GitTags } from '../bridge'

const props = defineProps<{ root: string; active: boolean }>()
const status = ref<GitStatus>({ available: true, changes: [] })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const amend = ref(false)
interface DiffState { path: string; staged: boolean; base: string; text: string; rows: DiffRow[]; truncated: boolean; hunks?: GitHunks; hunkPicked?: Set<number> }
const diff = ref<DiffState | null>(null)
const compareBase = ref('')
const compareTo = ref('')
const compared = ref<GitCompareFile[]>([])

const changes = computed(() => status.value.changes ?? [])
const staged = computed(() => changes.value.filter(change => change.staged))
const unstaged = computed(() => changes.value.filter(change => !change.staged))
const branches = computed(() => status.value.branches ?? [])
const ahead = ref<GitAheadBehind>({ available: false, ahead: 0, behind: 0 })
const stashCount = ref(0)
const historyOpen = ref(false)
const commits = ref<GitCommit[]>([])
const newBranch = ref('')
const mergeBranch = ref('')

function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }
async function load() {
  loading.value = true
  error.value = ''
  try { status.value = await request<GitStatus>('git.status'); void refreshExtras() }
  catch (caught) { error.value = errorText(caught) }
  finally { loading.value = false }
  void loadTags()
}
async function refreshExtras() {
  try { ahead.value = await request<GitAheadBehind>('git.aheadBehind') } catch { ahead.value = { available: false, ahead: 0, behind: 0 } }
  try { stashCount.value = (await request<GitStash>('git.stash')).entries.length } catch { stashCount.value = 0 }
}
async function act(operation: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await operation(); await load() }
  catch (caught) { error.value = errorText(caught) }
  finally { busy.value = false }
}
const stage = (path: string) => act(() => request('git.stage', { path }))
const unstage = (path: string) => act(() => request('git.unstage', { path }))
const commit = () => {
  const text = message.value.trim()
  // Amending with no message keeps the previous subject, like IDEA's "Amend".
  if (!text && !amend.value) return
  void act(async () => {
    await request('git.commit', { message: text, amend: amend.value })
    message.value = ''
    amend.value = false
  })
}
const checkout = (branch: string) => act(() => request('git.checkout', { branch }))
const pull = () => act(() => request('git.pull'))
const push = () => act(() => request('git.push'))
// IDEA Git menu rows: Fetch (refresh remotes), Rebase onto upstream, branch delete,
// the Tag dialog, "Add to .gitignore" for untracked rows.
const fetch = () => act(() => request('git.fetch'))
const rebaseUpstream = () => act(() => request('git.rebase', {}))
const deleteBranch = () => { const name = mergeBranch.value.trim(); if (!name || name === status.value.head) return; void act(() => request('git.branch.delete', { name })) }
const ignore = (path: string) => act(() => request('git.ignore', { path }))
const tagName = ref('')
const createTag = () => { const name = tagName.value.trim(); if (!name) return; void act(async () => { await request('git.tag.create', { name }); tagName.value = '' }) }
async function deleteTag(name: string) { await act(() => request('git.tag.delete', { name })) }
const tags = ref<string[]>([])
async function loadTags() {
  try { tags.value = (await request<GitTags>('git.tags')).tags } catch { tags.value = [] }
}
async function applyHunks(reverse: boolean) {
  if (!diff.value || !diff.value.hunks) return
  const selectedIndexes = diff.value.hunks.hunks.filter(hunk => diff.value?.hunkPicked?.has(hunk.index)).map(hunk => hunk.index)
  if (!selectedIndexes.length) return
  const target = { path: diff.value.path, staged: diff.value.staged }
  await act(async () => {
    await request('git.applyHunks', { ...target, hunks: selectedIndexes, reverse })
    await showDiff(target)
  })
}
function toggleHunk(index: number) {
  if (!diff.value) return
  diff.value.hunkPicked ??= new Set()
  if (diff.value.hunkPicked.has(index)) diff.value.hunkPicked.delete(index)
  else diff.value.hunkPicked.add(index)
  // Set mutation needs a fresh Set to stay reactive for the checkbox binding.
  diff.value.hunkPicked = new Set(diff.value.hunkPicked)
}
const stash = () => act(() => request('git.stash.save', { message: message.value.trim() || 'TaoCode 储藏' }))
const stashPop = () => act(() => request('git.stash.pop'))
const createBranch = () => { const name = newBranch.value.trim(); if (!name) return; void act(async () => { await request('git.branch.create', { name, checkout: true }); newBranch.value = '' }) }
const mergeBranchInto = () => { const name = mergeBranch.value.trim(); if (!name) return; void act(() => request('git.merge', { branch: name })) }
async function toggleHistory() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value && !commits.value.length) {
    try { commits.value = (await request<GitLog>('git.log')).commits } catch (caught) { error.value = errorText(caught) }
  }
}
async function showDiff(target: { path: string; staged: boolean; base?: string }) {
  const base = target.base ?? ''
  const params = base ? { path: target.path, staged: target.staged, base } : { path: target.path, staged: target.staged }
  try {
    // Both views come from the same `git diff`; the aligned rows are parsed natively
    // from that text, so the two modes can never disagree.
    const [unified, sides] = await Promise.all([
      request<{ diff: string }>('git.diff', params),
      request<DiffSides>('git.diffSides', params),
    ])
    // Compare views have no side to stage into; only the working/index diff carries
    // selectable hunks (IDEA's commit viewer).
    let hunks: GitHunks | undefined
    if (!base) {
      try { hunks = await request<GitHunks>('git.diffHunks', { path: target.path, staged: target.staged }) }
      catch { hunks = undefined }
    }
    diff.value = {
      path: target.path, staged: target.staged, base,
      text: unified.diff || '（无差异；可能是未跟踪文件）',
      rows: sides.rows ?? [], truncated: sides.truncated === true,
      hunks, hunkPicked: new Set(),
    }
  } catch (caught) { error.value = errorText(caught) }
}
function runCompare() {
  const base = compareBase.value
  if (!base) { compared.value = []; compareTo.value = ''; return }
  void act(async () => {
    const result = await request<GitCompare>('git.compare', { base })
    compared.value = result.files
    compareTo.value = base
  })
}
function clearCompare() {
  compareBase.value = ''
  compared.value = []
  compareTo.value = ''
}

onMounted(load)
watch(() => [props.root, props.active] as const, () => { if (props.active) void load() })
</script>

<template>
  <div class="sc-panel">
    <div class="sc-header">
      <GitBranch :size="14" />
      <select class="sc-branch" :value="status.head" :disabled="busy || !branches.length" aria-label="当前分支" @change="checkout(($event.target as HTMLSelectElement).value)">
        <option v-if="status.head" :value="status.head">{{ status.head }}</option>
        <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
      </select>
      <button class="icon-button" title="刷新" aria-label="刷新 Git 状态" :disabled="loading || busy" @click="load"><RefreshCw :size="14" /></button>
    </div>
    <div v-if="!status.available" class="sc-empty"><CircleSlash :size="22" /><p>未找到 Git</p><span>安装 Git 并加入 PATH 后可使用版本控制。</span></div>
    <template v-else>
      <div class="sc-commit">
        <textarea v-model="message" rows="3" :placeholder="amend ? '留空则沿用上次的提交信息' : '提交信息（Ctrl+Enter 提交）'" aria-label="提交信息" :disabled="busy || (!staged.length && !amend)" @keydown.ctrl.enter.prevent="commit" />
        <label class="sc-amend"><input v-model="amend" type="checkbox" :disabled="busy" /><span>修改上次提交（Amend）</span></label>
        <button class="primary-button sc-commit-button" :disabled="busy || (!staged.length && !amend) || (!message.trim() && !amend)" @click="commit">{{ amend ? '改写上次提交' : '暂存 ' + staged.length + ' 项并提交' }}</button>
      </div>
      <div class="sc-toolbar">
        <button class="sc-tool" :disabled="busy" title="拉取（--ff-only）" @click="pull"><Download :size="13" />拉取<span v-if="ahead.available && ahead.behind" class="sc-badge">{{ ahead.behind }}</span></button>
        <button class="sc-tool" :disabled="busy" title="获取（fetch，不合并）" aria-label="获取" @click="fetch"><CloudDownload :size="13" />获取</button>
        <button class="sc-tool" :disabled="busy" title="推送当前分支" @click="push"><Upload :size="13" />推送<span v-if="ahead.available && ahead.ahead" class="sc-badge">{{ ahead.ahead }}</span></button>
        <button class="sc-tool" :disabled="busy" title="变基到上游（rebase）" aria-label="变基" @click="rebaseUpstream"><RotateCcw :size="13" />变基</button>
        <button class="sc-tool" :disabled="busy || !changes.length" title="储藏当前更改" @click="stash"><Archive :size="13" />储藏</button>
        <button class="sc-tool" :disabled="busy || !stashCount" title="弹出最近的储藏" @click="stashPop">弹出<span v-if="stashCount" class="sc-badge">{{ stashCount }}</span></button>
        <button class="sc-tool" :class="{ on: historyOpen }" title="提交历史" @click="toggleHistory"><History :size="13" />历史</button>
      </div>
      <div class="sc-branch-ops">
        <input v-model="newBranch" class="sc-input" placeholder="新分支名" aria-label="新分支名" :disabled="busy" @keydown.enter.prevent="createBranch" />
        <button class="sc-tool" :disabled="busy || !newBranch.trim()" title="新建并切换到分支" aria-label="新建分支" @click="createBranch"><Plus :size="13" /></button>
        <select v-model="mergeBranch" class="sc-input sc-select" aria-label="选择要合并的分支">
          <option value="">合并…</option>
          <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
        </select>
        <button class="sc-tool" :disabled="busy || !mergeBranch" title="合并所选分支到当前分支" aria-label="合并分支" @click="mergeBranchInto"><GitMerge :size="13" /></button>
        <button class="sc-tool" :disabled="busy || !mergeBranch || mergeBranch === status.head" title="删除所选分支（git branch -D）" aria-label="删除分支" @click="deleteBranch"><Trash2 :size="13" /></button>
      </div>
      <div class="sc-branch-ops">
        <input v-model="tagName" class="sc-input" placeholder="新标签名" aria-label="新标签名" :disabled="busy" @keydown.enter.prevent="createTag" />
        <button class="sc-tool" :disabled="busy || !tagName.trim()" title="在当前提交打标签" aria-label="新建标签" @click="createTag"><Tag :size="13" /></button>
        <div v-if="tags.length" class="sc-tags">
          <span v-for="tag in tags" :key="tag" class="sc-tag" :title="`删除标签 ${tag}`">
            {{ tag }}
            <button class="sc-tag-x" :disabled="busy" aria-label="删除标签" @click="deleteTag(tag)"><X :size="10" /></button>
          </span>
        </div>
      </div>
      <div class="sc-branch-ops">
        <select v-model="compareBase" class="sc-input sc-select" aria-label="选择要比较的分支" :disabled="busy">
          <option value="">与分支比较…</option>
          <option v-for="branch in branches.filter(name => name !== status.head)" :key="branch" :value="branch">{{ branch }}</option>
        </select>
        <button class="sc-tool" :disabled="busy || !compareBase" title="列出该分支相对此处多出的文件" aria-label="开始比较" @click="runCompare"><History :size="13" />比较</button>
        <button v-if="compareTo || compared.length" class="sc-tool" :disabled="busy" title="清除比较结果" aria-label="清除比较" @click="clearCompare"><X :size="13" />清除</button>
      </div>
      <p v-if="error" class="sc-error">{{ error }}</p>
      <div class="sc-scroll">
        <section v-if="staged.length" class="sc-section">
          <h3>已暂存 <span class="sc-count">{{ staged.length }}</span></h3>
          <div v-for="change in staged" :key="'s' + change.path" class="sc-row">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.indexStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button class="icon-button" title="取消暂存" aria-label="取消暂存" :disabled="busy" @click="unstage(change.path)"><Minus :size="14" /></button>
          </div>
        </section>
        <section v-if="unstaged.length" class="sc-section">
          <h3>更改 <span class="sc-count">{{ unstaged.length }}</span></h3>
          <div v-for="change in unstaged" :key="'u' + change.path" class="sc-row">
            <button class="sc-file" :title="change.path" @click="showDiff(change)"><span class="sc-status">{{ change.untracked ? '?' : change.workStatus }}</span><span class="sc-path">{{ change.path }}</span></button>
            <button v-if="change.untracked" class="icon-button" title="加入 .gitignore" aria-label="加入 .gitignore" :disabled="busy" @click="ignore(change.path)"><Ban :size="13" /></button>
            <button class="icon-button" title="暂存" aria-label="暂存" :disabled="busy" @click="stage(change.path)"><Plus :size="14" /></button>
          </div>
        </section>
        <div v-if="!changes.length" class="sc-empty"><Check :size="22" /><p>工作区干净</p><span>没有需要提交的更改。</span></div>
        <section v-if="compareTo" class="sc-section">
          <h3>与 {{ compareTo }} 的比较 <span class="sc-count">{{ compared.length }}</span></h3>
          <div v-for="file in compared" :key="'c' + file.path" class="sc-row">
            <button class="sc-file" :title="`${file.status} · ${file.path}`" @click="showDiff({ path: file.path, staged: false, base: compareTo })"><span class="sc-status">{{ file.status }}</span><span class="sc-path">{{ file.path }}</span></button>
          </div>
          <p v-if="!compared.length" class="sc-empty-line">该分支相对此处没有多出的文件。</p>
        </section>
        <section v-if="historyOpen" class="sc-section">
          <h3><GitCommitIcon :size="12" /> 提交历史 <span class="sc-count">{{ commits.length }}</span></h3>
          <div v-for="entry in commits" :key="entry.hash" class="sc-commit-row" :title="`${entry.subject} · ${entry.author} · ${entry.date}`">
            <span class="sc-hash">{{ entry.shortHash }}</span><span class="sc-subject">{{ entry.subject }}</span><span class="sc-meta">{{ entry.author }}</span>
          </div>
          <p v-if="!commits.length" class="sc-empty-line">尚无提交。</p>
        </section>
      </div>
    </template>
    <div v-if="diff" class="modal-backdrop" @click.self="diff = null">
      <section class="diff-dialog" role="dialog" aria-modal="true" :aria-label="`差异 ${diff.path}`">
        <!-- IDEA's commit viewer: each hunk of the diff is selectable and the
             toolbar stages/unstages exactly the picked hunks. -->
        <div v-if="diff.hunks?.hunks.length" class="sc-hunks">
          <button class="sc-tool" :disabled="busy" title="把勾选的改动块暂存（git apply --cached）" @click="applyHunks(false)"><Plus :size="12" />暂存所选块</button>
          <button class="sc-tool" :disabled="busy" title="把勾选的已暂存块退回工作区（reverse apply）" @click="applyHunks(true)"><Minus :size="12" />取消暂存所选块</button>
          <span class="sc-hunk-hint">{{ diff.staged ? '已暂存差异' : '工作区差异' }} · {{ diff.hunks.hunks.length }} 块</span>
        </div>
        <div v-if="diff.hunks?.hunks.length" class="sc-hunk-list">
          <label v-for="hunk in diff.hunks.hunks" :key="hunk.index" class="sc-hunk">
            <input type="checkbox" :checked="diff.hunkPicked?.has(hunk.index)" @change="toggleHunk(hunk.index)" />
            <code class="sc-hunk-header">{{ hunk.header.trim() }}</code>
            <span class="sc-hunk-counts">+{{ hunk.additions }} −{{ hunk.deletions }}</span>
          </label>
        </div>
        <DiffView closable :path="diff.path" :subtitle="diff.base ? `（与 ${diff.base} 的比较）` : diff.staged ? '（已暂存）' : '（工作区）'" :rows="diff.rows" :unified="diff.text" :truncated="diff.truncated" @close="diff = null" />
      </section>
    </div>
  </div>
</template>
