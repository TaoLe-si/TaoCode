<script setup lang="ts">
// 分支弹窗（IDEA `GitBranchesPopup`）：顶部 speed-search 输入框 + 顶层动作区 + 分支列表。
//
// 源码：plugins/git4idea/shared/src/com/intellij/vcs/git/branch/popup/GitBranchesPopup.kt、
// GitBranchesPopupBase.kt:352（speed search 装在输入框上）、GitBranchesPopupActions.kt（动作组 id）、
// backend/resources/intellij.vcs.git.backend.xml:303-333（动作成员）。
// 触发点有两个：顶部工具栏的**分支 widget**（`main.toolbar.git.Branches`，
// git4idea/shared/resources/intellij.vcs.git.shared.xml:35-38 挂在 MainToolbarLeft）
// 与「Git › 分支…」动作（Ctrl+Shift+`）。
//
// 动作与原生命令的对应在 src/branchPopup.ts 里（纯数据，可测）；组件只负责渲染与派发。
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronRight, GitBranch, Plus, Trash2, X } from 'lucide-vue-next'
import { BRANCH_ROW_ACTIONS, BRANCH_TOP_ACTIONS, filterBranches, sortBranches, validateBranchName } from '../branchPopup'
import { popupCancelKeyAction } from '../popupCancel'

const props = defineProps<{
  branches: string[]
  current: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'action', payload: { action: string; branch?: string; name?: string }): void
  (event: 'close'): void
}>()

const query = ref('')
const searchInput = ref<HTMLInputElement>()
const expanded = ref('')
const draft = ref('')
const note = ref('')
const ordering = computed(() => sortBranches(props.branches, props.current))
const visible = computed(() => filterBranches(ordering.value, query.value))
const other = computed(() => visible.value.filter(branch => branch !== props.current))

watch(() => props.branches, () => { note.value = '' })
void nextTick(() => searchInput.value?.focus())

function pick(branch: string) {
  if (branch === props.current) { note.value = `已经在 ${branch} 上。`; return }
  emit('action', { action: 'checkout', branch })
}
function run(action: string, branch?: string) {
  if (action === 'create' || action === 'checkoutInput') {
    const problem = validateBranchName(draft.value)
    if (problem) { note.value = problem; return }
    const name = draft.value.trim()
    if (action === 'create') emit('action', { action: 'create', name })
    else emit('action', { action: 'checkout', branch: name })
    draft.value = ''
    note.value = ''
    return
  }
  emit('action', { action, branch })
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    // 两段式（`AbstractPopup.dispatchKeyEvent:3003-3010`）：搜索框里有字先清它，空了才关
    // （上游那个分支比的正是 `mySpeedSearch.isHoldingFilter()`）。
    if (popupCancelKeyAction(query.value) === 'reset-filter') { query.value = ''; return }
    emit('close')
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    // 输入框里的回车优先当作「从输入检出」（IDEA 的 GitCheckoutFromInputAction 就是这个用途）。
    if (draft.value.trim()) run('checkoutInput')
    else if (visible.value[0]) pick(visible.value[0])
  }
}
</script>

<template>
  <div class="branch-popup" role="dialog" aria-modal="false" aria-label="Git 分支" @keydown="onKeydown">
    <div class="bp-search">
      <GitBranch :size="14" aria-hidden="true" />
      <input ref="searchInput" v-model="query" placeholder="搜索分支…" aria-label="搜索分支" spellcheck="false" />
      <button type="button" class="icon-button" title="关闭" aria-label="关闭分支弹窗" @click="emit('close')"><X :size="14" /></button>
    </div>

    <div class="bp-input">
      <input v-model="draft" placeholder="分支名（回车检出 / 新建）" aria-label="分支名" spellcheck="false" :aria-invalid="Boolean(note)" />
      <button v-for="action in BRANCH_TOP_ACTIONS" :key="action.id" type="button" class="subtle-button" :title="action.title" :disabled="busy" @click="run(action.id)">{{ action.id === 'create' ? '新建' : '检出' }}</button>
    </div>
    <p v-if="note" class="bp-note" role="alert">{{ note }}</p>

    <div class="bp-list" role="listbox" aria-label="分支列表">
      <p v-if="current" class="bp-current" role="option" :aria-selected="true">
        <span class="bp-check" aria-hidden="true">✓</span>
        <span class="bp-name">{{ current }}</span>
        <span class="bp-tag">当前</span>
      </p>
      <button v-for="branch in other" :key="branch" type="button" class="bp-row" role="option" :aria-selected="false" @click="pick(branch)">
        <span class="bp-check" aria-hidden="true" />
        <span class="bp-name">{{ branch }}</span>
        <span class="bp-actions">
          <button type="button" class="icon-button" :aria-expanded="expanded === branch" :title="`${branch} 的动作`" :aria-label="`${branch} 的动作`" @click.stop="expanded = expanded === branch ? '' : branch"><ChevronRight :size="12" /></button>
        </span>
      </button>
      <p v-if="!visible.length" class="bp-empty">没有匹配的分支。</p>
    </div>

    <!-- 每个分支行的动作（Git.Branch.Backend 里有原生落点的那几个） -->
    <div v-if="expanded" class="bp-menu" role="menu" :aria-label="`${expanded} 的分支动作`">
      <p class="bp-menu-title">{{ expanded }}</p>
      <button v-for="action in BRANCH_ROW_ACTIONS" :key="action.id" type="button" role="menuitem" :disabled="busy" :title="action.ideaAction" @click="run(action.id, expanded)">
        <Trash2 v-if="action.id === 'delete'" :size="13" /><Plus v-else :size="13" /><span>{{ action.title }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.branch-popup { position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; display: flex; flex-direction: column; gap: var(--space-1); width: 340px; max-height: 60vh; padding: var(--space-2); overflow: auto; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.bp-search { display: flex; align-items: center; gap: var(--space-1); padding-bottom: var(--space-1); border-bottom: 1px solid var(--line); color: var(--muted); }
.bp-search input, .bp-input input { flex: 1; min-width: 0; padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: inherit; font-size: 12px; }
.bp-input { display: flex; align-items: center; gap: var(--space-1); }
.bp-input input[aria-invalid='true'] { border-color: var(--error); }
.bp-note { margin: 0; color: var(--error); font-size: 11px; }
.bp-list { display: flex; flex-direction: column; gap: 1px; overflow: auto; }
.bp-current, .bp-row { display: flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-1); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; }
.bp-row:hover { background: var(--hover); }
.bp-check { width: 12px; flex-shrink: 0; color: var(--accent); }
.bp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-tag { color: var(--muted); font-size: 10px; }
.bp-actions { display: flex; }
.bp-empty { margin: 0; padding: var(--space-2); color: var(--muted); font-size: 11px; }
.bp-menu { display: flex; flex-direction: column; gap: 1px; padding-top: var(--space-1); border-top: 1px solid var(--line); }
.bp-menu-title { margin: 0; padding: 2px var(--space-1); color: var(--muted); font-size: 10px; }
.bp-menu button { display: flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-1); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; }
.bp-menu button:hover { background: var(--hover); }
</style>
