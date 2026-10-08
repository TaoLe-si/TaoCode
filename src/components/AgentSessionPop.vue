<script setup lang="ts">
// Agent 面板的**会话库弹层**（切换 / 新建 / 删除）。
//
// 为什么单独一个组件：`AgentPanel.vue` 顶在 900 行机检上限（`tests/module-size.test.mjs`），
// 而这一块是自成一体的（数据来自 `src/agentSessions.ts`，动作全走 emit），拆出来不牵动别的。
// 判定与落盘仍在 `src/agentSessions.ts`，这里只渲染 + 派发。
import { nextTick, ref } from 'vue'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { AGENT_SESSION_LIMIT } from '../agentSessions.ts'

export interface AgentSessionRow { id: string; name: string; entries: number; updatedAt: string }

const props = defineProps<{
  /** 全部会话（`store.summaries()` 的产出，已按 `updatedAt` 倒序）。 */
  sessions: AgentSessionRow[]
  /** 当前会话 id（高亮那一行）。 */
  activeId: string | null
}>()

const emit = defineEmits<{
  /** 切到某一场。 */
  open: [id: string]
  /** 开一场新的（不传名字 = 库自己按「会话 N」命名）。 */
  create: []
  /** 删掉某一场。 */
  remove: [id: string]
  /** 重命名某一场。 */
  rename: [id: string, name: string]
}>()

const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement>()
const compositionActive = ref(false)

async function startRename(entry: AgentSessionRow) {
  renamingId.value = entry.id
  renameDraft.value = entry.name
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function cancelRename() {
  renamingId.value = null
  renameDraft.value = ''
  compositionActive.value = false
}

function confirmRename(id: string) {
  const name = renameDraft.value.trim()
  if (!name || name === props.sessions.find(entry => entry.id === id)?.name) {
    cancelRename()
    return
  }
  emit('rename', id, name)
  cancelRename()
}

function onRenameKeydown(event: KeyboardEvent, id: string) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
    return
  }
  if (event.key !== 'Enter') return
  if (compositionActive.value || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  confirmRename(id)
}

/** 列表里的时间戳：`2026-10-07T09:31:22.000Z` → `10-07 09:31`。 */
function rowMeta(entry: AgentSessionRow): string {
  return `${entry.entries} 条 · ${entry.updatedAt.slice(5, 16).replace('T', ' ')}`
}
function rowTitle(entry: AgentSessionRow): string {
  return `切到「${entry.name}」（${entry.entries} 条，${entry.updatedAt.slice(0, 16).replace('T', ' ')}）`
}
</script>

<template>
  <div class="agent-session-pop">
    <div class="agent-session-pop-head">
      <span>会话（{{ sessions.length }} / {{ AGENT_SESSION_LIMIT }}）</span>
      <button class="agent-session-add" title="开一场新会话" @click="emit('create')"><Plus :size="iconSize.inline" aria-hidden="true" />新会话</button>
    </div>
    <div v-for="item in sessions" :key="item.id" class="agent-session-row" :class="{ active: item.id === activeId }">
      <div v-if="renamingId === item.id" class="agent-session-open agent-session-edit">
        <input
          ref="renameInput"
          v-model="renameDraft"
          class="agent-session-input"
          aria-label="重命名会话"
          placeholder="重命名会话…"
          @compositionstart="compositionActive = true"
          @compositionend="compositionActive = false"
          @keydown="onRenameKeydown($event, item.id)"
        />
        <span class="agent-session-row-meta">{{ rowMeta(item) }}</span>
      </div>
      <button v-else class="agent-session-open" :title="rowTitle(item)" @click="emit('open', item.id)">
        <span class="agent-session-row-name">{{ item.name }}</span>
        <span class="agent-session-row-meta">{{ rowMeta(item) }}</span>
      </button>
      <button v-if="renamingId === item.id" type="button" class="agent-session-action agent-session-confirm" title="确认" aria-label="确认" @click="confirmRename(item.id)"><Check :size="iconSize.inline" aria-hidden="true" /></button>
      <button v-if="renamingId === item.id" type="button" class="agent-session-action" title="取消" aria-label="取消" @click="cancelRename"><X :size="iconSize.inline" aria-hidden="true" /></button>
      <button v-if="renamingId !== item.id" type="button" class="agent-session-action agent-session-rename" title="重命名会话" aria-label="重命名会话" @click="startRename(item)"><Pencil :size="iconSize.inline" aria-hidden="true" /></button>
      <button v-if="renamingId !== item.id" type="button" class="agent-session-action agent-session-del" :title="`删除会话「${item.name}」`" :aria-label="`删除会话 ${item.name}`" @click="emit('remove', item.id)"><Trash2 :size="iconSize.inline" aria-hidden="true" /></button>
    </div>
  </div>
</template>

<style scoped>
.agent-session-pop { position: absolute; top: 100%; right: var(--space-2); z-index: 20; display: flex; flex-direction: column; gap: var(--space-1); width: min(260px, calc(100% - var(--space-4))); max-height: 320px; overflow: auto; padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); color: var(--popup-foreground); }
.agent-session-pop-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-1); padding: var(--space-1) var(--space-2); color: var(--secondary); font-size: 12px; }
.agent-session-add { display: inline-flex; align-items: center; gap: var(--space-1); padding: 0 var(--space-2); height: var(--ctrl-height-sm); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font-size: 12px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-session-add:hover { background: var(--hover); color: var(--text); }
.agent-session-row { display: flex; align-items: stretch; gap: var(--space-1); border-radius: var(--radius-lg); }
.agent-session-row.active { background: var(--selected); }
@media (hover: hover) { .agent-session-row:not(.active):hover { background: var(--hover); } }
.agent-session-open { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.agent-session-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-session-row-meta { color: var(--muted); font: 10px/1.4 var(--font-mono); }
.agent-session-edit { cursor: default; }
.agent-session-input { width: 100%; min-width: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--text); font: inherit; font-size: 12px; }
.agent-session-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-session-action { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 var(--ctrl-height-sm); width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--muted); cursor: pointer; opacity: 0; pointer-events: none; transition: color var(--dur-1) var(--ease), opacity var(--dur-1) var(--ease); }
.agent-session-row:hover .agent-session-action,
.agent-session-row:focus-within .agent-session-action { opacity: 1; pointer-events: auto; }
.agent-session-confirm { color: var(--accent); }
.agent-session-action:hover { background: var(--hover); color: var(--text); }
.agent-session-del:hover { color: var(--error); }
@media (hover: none) { .agent-session-action { opacity: 1; pointer-events: auto; } }
</style>
