<script setup lang="ts">
// 「记忆」节（ZCode section id `memory`，`settingsPageConfig.ts:76-81`，图标 Brain）的界面。
//
// 本节只做**接线**：形状 / 归一化 / 校验 / 注入清单全在 `src/agentMemoryFiles.ts`
// （文件形态、三档作用域、路径模板、`~` 展开、大小上限都在那边，判据在
// `tests/agent-memory-files.test.mjs`）。组件里不另写一句业务判断。
//
// 诚实的缺口（Rule: 不放假成功）：本仓没有「把记忆正文注入模型调用」的通道
// （`injectedMemoryFiles` 目前没有消费方，宿主的 `agent.memory.*` 只做列目录/读文件），
// 所以这一节如实写成「保存选择」，不画成已经生效的注入开关。
import { reactive, ref } from 'vue'
import { Save, Trash2 } from 'lucide-vue-next'
import { iconSize } from '../../uiIcons'
import AgentSettingsSectionShell from './AgentSettingsSectionShell.vue'
import {
  AGENT_MEMORY_SCOPES, AGENT_MEMORY_PATH_TEMPLATES, agentMemoryScopeLabel,
  loadAgentMemoryFiles, normalizeAgentMemoryFiles, saveAgentMemoryFiles, validateAgentMemoryFiles,
  type AgentMemoryScope,
} from '../../agentMemoryFiles'

/** 草稿：本节自管（`reactive(normalize(load()))`，不与别的节共享页面那份 draft）。 */
const draft = reactive(normalizeAgentMemoryFiles(loadAgentMemoryFiles()))
const problems = ref<string[]>([])
const status = ref('')

/** 三档作用域的中文名。**用模块导出的那套**，不在组件里另写一句。 */
function scopeLabel(scope: AgentMemoryScope): string {
  return agentMemoryScopeLabel(scope)
}

/** 路径模板：模块给的占位（智能体那档留 `<name>`），点了只填路径，不替用户写死名字。 */
function templateFor(scope: AgentMemoryScope): string {
  return AGENT_MEMORY_PATH_TEMPLATES.find(item => item.scope === scope)?.template ?? ''
}

function addEntry(): void {
  draft.files.push({ scope: 'workspace', path: templateFor('workspace'), enabled: true, sizeLimitChars: 0 })
}

function removeEntry(index: number): void {
  draft.files.splice(index, 1)
}

function applyTemplate(index: number): void {
  const entry = draft.files[index]
  if (!entry) return
  entry.path = templateFor(entry.scope)
}

/** 保存：先 validate 再 save。有 problems 就不写，并逐条显示。 */
function save(): void {
  const found = validateAgentMemoryFiles(draft)
  problems.value = found
  if (found.length) { status.value = ''; return }
  status.value = saveAgentMemoryFiles(draft)
    ? '已保存到本机设置。'
    : '本次会话仍生效，但没有存下来（本机存储不可用）。'
}

/** 这一节的说明：交给共用外壳渲染（`AgentSettingsSectionShell.vue` 的 `description`）。 */
const SECTION_DESCRIPTION = '管理 Agent 的记忆文件：查看、编辑与删除。'
</script>

<template>
  <AgentSettingsSectionShell title="记忆" :description="SECTION_DESCRIPTION">
    <label class="checkbox-row">
      <input v-model="draft.enabled" type="checkbox" />
      <span>启用记忆（新会话生效）</span>
    </label>

    <section class="settings-box">
      <h4 class="settings-box-title">记忆文件</h4>
      <ul v-if="draft.files.length" class="memory-file-list">
        <li v-for="(entry, index) in draft.files" :key="`${entry.scope}:${entry.path}:${index}`" class="memory-file-row">
          <select v-model="entry.scope" :aria-label="`第 ${index + 1} 条的作用域`">
            <option v-for="scope in AGENT_MEMORY_SCOPES" :key="scope" :value="scope">{{ scopeLabel(scope) }}</option>
          </select>
          <input v-model="entry.path" type="text" :aria-label="`第 ${index + 1} 条的路径`" placeholder="~/.minimax/memory/user.md" />
          <label class="memory-file-limit">
            <span>上限</span>
            <input v-model.number="entry.sizeLimitChars" type="number" min="0" step="256" :aria-label="`第 ${index + 1} 条的字符上限（0 = 不限）`" />
          </label>
          <label class="memory-file-enabled">
            <input v-model="entry.enabled" type="checkbox" :aria-label="`第 ${index + 1} 条参与注入`" />
            <span>参与注入</span>
          </label>
          <button type="button" class="settings-button" @click="applyTemplate(index)">按模板填</button>
          <button
            type="button" class="settings-icon-button settings-icon-button-danger"
            :title="`删除第 ${index + 1} 条记忆文件`" :aria-label="`删除第 ${index + 1} 条记忆文件`"
            @click="removeEntry(index)"
          ><Trash2 :size="iconSize.dense" aria-hidden="true" /></button>
        </li>
      </ul>
      <p v-else class="field-hint">还没有条目：下面「新增条目」会按工作区模板起一条。</p>
      <div class="settings-actions">
        <button type="button" class="settings-button" @click="addEntry">新增条目</button>
        <button type="button" class="settings-button settings-button-primary" @click="save">
          <Save :size="iconSize.control" aria-hidden="true" />保存
        </button>
        <span v-if="status" class="settings-status" role="status">{{ status }}</span>
      </div>
    </section>

    <ul v-if="problems.length" class="settings-problems" role="alert">
      <li v-for="(problem, index) in problems" :key="index">{{ problem }}</li>
    </ul>
  </AgentSettingsSectionShell>
</template>

<style scoped>
.memory-file-list { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.memory-file-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); min-width: 0; }
.memory-file-row > select { flex: 0 0 auto; }
.memory-file-row > input[type='text'] { flex: 1 1 220px; min-width: 0; font-family: var(--font-mono); }
.memory-file-limit, .memory-file-enabled { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text); font-size: 12px; }
.memory-file-limit > input[type='number'] { width: 96px; }
.memory-file-row > :is(input, select) { min-height: var(--ctrl-height-sm); }
</style>
