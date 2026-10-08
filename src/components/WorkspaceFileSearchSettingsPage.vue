<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  readWorkspaceFileSearchIgnoreForSettings,
  saveWorkspaceFileSearchIgnore,
  transformWorkspaceFileSearchIgnore,
  type WorkspaceFileIgnoreSnapshot,
} from '../workspaceFileSearchIgnore.ts'

const props = defineProps<{ root: string | null }>()
const snapshot = ref<WorkspaceFileIgnoreSnapshot | null>(null)
const content = ref('')
const loading = ref(false)
const saving = ref(false)
const status = ref('')
const error = ref('')
const dirty = computed(() => snapshot.value !== null && content.value !== snapshot.value.content)
const editable = computed(() => Boolean(props.root && snapshot.value?.mode && !loading.value && !saving.value))
const canSave = computed(() => editable.value && (dirty.value || snapshot.value?.mode === 'new'))
let loadToken = 0

async function load() {
  const token = ++loadToken
  const root = props.root
  status.value = ''
  error.value = ''
  content.value = ''
  snapshot.value = null
  if (!root) { loading.value = false; return }
  loading.value = true
  try {
    const result = await readWorkspaceFileSearchIgnoreForSettings(root)
    if (token !== loadToken) return
    snapshot.value = result
    content.value = result.content
    error.value = result.error ?? ''
    status.value = ''
  } catch (cause) {
    if (token === loadToken) error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function save() {
  const current = snapshot.value
  if (!current || !canSave.value) return
  saving.value = true
  error.value = ''
  status.value = ''
  try {
    snapshot.value = await saveWorkspaceFileSearchIgnore(content.value, current)
    status.value = '已保存'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}

async function transform(kind: 'sync-gitignore' | 'reset-defaults') {
  if (!props.root || !editable.value) return
  error.value = ''
  status.value = ''
  try {
    content.value = await transformWorkspaceFileSearchIgnore(props.root, content.value, kind)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

watch(() => props.root, () => { void load() }, { immediate: true })
</script>

<template>
  <div class="workspace-file-search-settings">
    <h3>工作区搜索范围</h3>
    <label class="ignore-label" for="workspace-file-search-ignore">忽略规则</label>
    <textarea
      id="workspace-file-search-ignore"
      v-model="content"
      rows="24"
      spellcheck="false"
      :disabled="!editable"
      :aria-busy="loading || saving"
    />
    <div class="ignore-actions">
      <button type="button" class="subtle-button" :disabled="!editable" @click="transform('sync-gitignore')">从 .gitignore 同步</button>
      <button type="button" class="subtle-button" :disabled="!editable" @click="transform('reset-defaults')">恢复默认规则</button>
      <button type="button" class="primary-button" :disabled="!canSave" @click="save">保存</button>
      <span v-if="!props.root" class="ignore-status" role="status">未打开工作区</span>
      <span v-else-if="loading" class="ignore-status" role="status">读取中</span>
      <span v-else-if="error" class="ignore-status is-error" role="alert">{{ error }}</span>
      <span v-else-if="status" class="ignore-status" role="status">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
.workspace-file-search-settings { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.workspace-file-search-settings h3 { margin: 0; color: var(--bright); font-size: 14px; font-weight: 700; }
.ignore-label { color: var(--text); font-size: 12px; font-weight: 500; }
.workspace-file-search-settings textarea {
  width: 100%; min-width: 0; min-height: 16rem; padding: var(--space-2);
  color: var(--text); background: var(--editor); border: 1px solid var(--line-strong);
  border-radius: var(--radius-xs); font: 12px/1.6 var(--font-mono); resize: vertical;
}
.workspace-file-search-settings textarea:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
.ignore-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.ignore-status { color: var(--muted); font-size: 12px; }
.ignore-status.is-error { color: var(--error); }
</style>
