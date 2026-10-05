<script setup lang="ts">
// 「工具 › 外部工具」页 —— 上游 `ToolConfigurable`（`preferences.externalTools`）的**结构化编辑面**。
//
// 上游的编辑面是 `ToolEditorDialog.java`：字段顺序与文案在 `ToolEditorDialog.java:103-119`
// （`getData`）/ `:137-158`（`setData`）+ `ToolEditorDialogPanel.kt` + `ToolsBundle.properties`，
// 列表侧的「启用」勾选框在 `BaseToolsPanel.java:248`/`:270`（新建工具默认启用 `:116`），
// 分组在 `BaseToolManager.java:89-113`（每个 ToolsGroup 注册成一个 delegate group），
// 停用的工具不进菜单在 `BaseToolManager.java:164`。
//
// 本仓的分层（**只画有消费链路的控件**，playbook §3）：
//   · `name` / `command` —— 宿主 `native/settings_schema.cpp:262-270` 只认这两个键，走 `emit('change')`；
//   · `description` / `group` / `enabled` / `program` / `parameters` —— 存 `src/externalToolsRecords.ts`
//     的 localStorage 详情表（与文件类型覆盖、宏表同一先例），消费方分别是本页的描述行、
//     「工具 › 外部工具」子菜单的分组与可见性（`src/menus/toolsMenu.ts`）、
//     以及命令串本身（`hostCommandOf()` 把 program + parameters 投影回 `command`）。
//   · 其余上游字段列在页脚那张表里，逐条写明「存得下但没有消费者」的具体卡点与接线请求号。
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-vue-next'
import { TOOL_MACROS } from '../toolMacros.ts'
import { formatExternalToolsText, parseExternalToolsText } from '../generalSettingsTextModels.ts'
import {
  EXTERNAL_TOOL_FIELDS, insertToolMacro, toolMacroUses, validatedTools,
  type ExternalToolEntry,
} from '../externalToolsModel.ts'
import {
  DEFAULT_TOOL_GROUP, dropToolDetail, hostCommandOf, outputFiltersMissingFilePathMacro,
  patchToolDetail, renameToolDetail, toolRecords,
  type ExternalToolDetail, type ExternalToolRecord,
} from '../externalToolsRecords.ts'
import { iconSize } from '../uiIcons'
import type { GeneralSettingsState } from '../settingsModel'

const props = defineProps<{ settings: GeneralSettingsState; busy?: boolean }>()
const emit = defineEmits<{ change: [patch: Partial<GeneralSettingsState>] }>()

const tools = computed<ExternalToolEntry[]>(() => props.settings.externalTools ?? [])
const knownMacroNames = computed(() => TOOL_MACROS.map(macro => macro.name))

/** 逐条校验结果（重名、空命令、未知宏、落单 `$`）。 */
const rows = computed(() => validatedTools(tools.value, knownMacroNames.value))
const invalid = computed(() => rows.value.filter(row => !row.validation.valid).length)

/** 宿主条目 + 详情表合并出来的完整记录（页面上半部分的「分组/说明/启用」读它）。 */
const records = computed<ExternalToolRecord[]>(() => toolRecords(tools.value))

/** 正在编辑的那条（上游是「选中节点 → Edit」，`BaseToolsPanel.java:385`）。 */
const selected = ref(0)
const selectedRecord = computed<ExternalToolRecord | null>(() => records.value[selected.value] ?? null)
function selectRow(index: number) { selected.value = index }

function commit(next: ExternalToolEntry[]) {
  if (props.busy) return
  emit('change', { externalTools: next })
}
function update(index: number, patch: Partial<ExternalToolEntry>) {
  const before = tools.value[index]
  if (!before) return
  const after = { ...before, ...patch }
  // 改名要跟着搬详情表的键，否则旧名字那份详情永远不会被命中（孤儿详情）。
  if (patch.name !== undefined && patch.name !== before.name) renameToolDetail(before.name, patch.name)
  commit(tools.value.map((tool, at) => (at === index ? after : tool)))
}
function removeAt(index: number) {
  const gone = tools.value[index]
  if (gone) dropToolDetail(gone.name)
  commit(tools.value.filter((_, at) => at !== index))
  if (selected.value >= tools.value.length) selected.value = Math.max(0, tools.value.length - 1)
}
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= tools.value.length) return
  const next = [...tools.value]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  commit(next)
  selected.value = target
}
function addTool() {
  const base = '新工具'
  let name = base
  for (let n = 2; tools.value.some(tool => tool.name.trim() === name); n++) name = `${base} ${n}`
  commit([...tools.value, { name, command: '' }])
  selected.value = tools.value.length
}

/**
 * 改一条工具的详情。`program` / `parameters` 动了要把宿主那条 `command` 一起重新投影
 * （上游 `Tool.java:75-76` 是两段，本仓的运行通道只有合成后的一条命令串）。
 */
function patchDetail(index: number, patch: Partial<ExternalToolDetail>) {
  const record = records.value[index]
  const entry = tools.value[index]
  if (!record || !entry) return
  const merged = patchToolDetail(record.name, patch, entry.command)
  if (patch.program === undefined && patch.parameters === undefined) return
  const command = hostCommandOf({ name: record.name, ...merged })
  commit(tools.value.map((tool, at) => (at === index ? { ...tool, command } : tool)))
}

/** 每行的宏用法（用来标出命令里到底有哪些宏）。 */
const macroUses = (command: string) => toolMacroUses(command).map(use => use.token)

/** 插入宏：落在命令框的光标处；没聚焦命令框就追加到末尾。 */
const commandRefs: Record<number, HTMLInputElement | undefined> = {}
function setCommandRef(index: number, element: unknown) {
  if (element instanceof HTMLInputElement) commandRefs[index] = element
}
function insertMacro(index: number, macro: string, withArg: boolean) {
  const tool = tools.value[index]
  if (!tool) return
  const caret = commandRefs[index]?.selectionStart ?? tool.command.length
  const next = insertToolMacro(tool.command, withArg ? `${macro}(` : macro, caret)
  update(index, { command: next.command })
  commandRefs[index]?.setSelectionRange(next.caret, next.caret)
}

/** 已有的分组名（上游 `setData` 的那个 combo 项就是现存分组，`ToolEditorDialog.java:141-145`）。 */
const existingGroups = computed(() => [...new Set(records.value.map(record => record.group || DEFAULT_TOOL_GROUP))])

/** 过滤式里缺 `$FILE_PATH$` 的那几条（`ToolEditorDialogPanel.kt:135` 引的那句校验）。 */
const badFilters = computed(() => (selectedRecord.value ? outputFiltersMissingFilePathMacro(selectedRecord.value.outputFilters) : []))

const filterDraft = ref('')
function addFilter() {
  const record = selectedRecord.value
  const value = filterDraft.value.trim()
  if (!record || !value) return
  patchDetail(selected.value, { outputFilters: [...record.outputFilters, value] })
  filterDraft.value = ''
}
function removeFilter(at: number) {
  const record = selectedRecord.value
  if (!record) return
  patchDetail(selected.value, { outputFilters: record.outputFilters.filter((_, index) => index !== at) })
}

// 页脚的纯文本导入/导出：与 `src/generalSettingsTextModels.ts` 同一份解析。
const textDraft = ref(formatExternalToolsText(props.settings.externalTools))
const textDiffers = computed(() => textDraft.value !== formatExternalToolsText(props.settings.externalTools))
function importText() {
  if (props.busy) return
  commit(parseExternalToolsText(textDraft.value))
  textDraft.value = formatExternalToolsText(props.settings.externalTools)
}

/** 页脚那张表：存得下但**还没有运行时消费者**的字段，逐条写清缺哪一层。 */
const unconsumedFields = computed(() => EXTERNAL_TOOL_FIELDS.filter(field => !field.consumed))
</script>

<template>
  <h3>工具 › 外部工具</h3>
  <p class="section-description">对应 IDEA Settings › Tools › External Tools（注册证据 <code>intellij.platform.lang.impl.xml:1013</code> 的 <code>preferences.externalTools</code>）。字段顺序照 <code>ToolEditorDialog.java:103-119</code>；这里定义的工具出现在「工具 › 外部工具」子菜单，运行时复用构建的同一条输出通道。</p>

  <div class="tools-list" role="list" aria-label="外部工具列表">
    <div v-for="(row, index) in rows" :key="index" class="tools-row" :class="{ 'tools-row-bad': !row.validation.valid, 'tools-row-selected': index === selected }" role="listitem">
      <label class="tools-enable" :title="`启用（上游 BaseToolsPanel.java:248 的那个勾选框；停用的工具不进菜单，BaseToolManager.java:164）`">
        <input type="checkbox" :checked="records[index]?.enabled ?? true" :disabled="busy" :aria-label="`启用工具 ${row.tool.name}`" @change="patchDetail(index, { enabled: ($event.target as HTMLInputElement).checked })" />
      </label>
      <input
        class="tools-name"
        :value="row.tool.name"
        :aria-label="`第 ${index + 1} 条工具的名称`"
        :aria-invalid="row.validation.problems.some(problem => problem.field === 'name')"
        maxlength="80"
        placeholder="工具名"
        @focus="selectRow(index)"
        @input="update(index, { name: ($event.target as HTMLInputElement).value })"
      />
      <input
        :ref="element => setCommandRef(index, element)"
        class="tools-command"
        :value="row.tool.command"
        :aria-label="`第 ${index + 1} 条工具的命令`"
        :aria-invalid="row.validation.problems.some(problem => problem.field === 'command')"
        maxlength="2000"
        placeholder="clang-format -i $FilePath$"
        spellcheck="false"
        @focus="selectRow(index)"
        @input="update(index, { command: ($event.target as HTMLInputElement).value })"
      />
      <div class="tools-macros">
        <button
          v-for="macro in TOOL_MACROS"
          :key="macro.name"
          class="tools-macro"
          type="button"
          :disabled="busy"
          :title="`插入 $${macro.name}$ —— ${macro.description}`"
          :aria-label="`插入宏 ${macro.name}`"
          @click="insertMacro(index, macro.name, macro.name === 'FileDirPathFromParent')"
        >{{ macro.name }}</button>
      </div>
      <div class="tools-row-actions">
        <button class="icon-button" type="button" :disabled="busy || index === 0" title="上移" aria-label="上移这条工具" @click="move(index, -1)"><ArrowUp :size="iconSize.dense" /></button>
        <button class="icon-button" type="button" :disabled="busy || index === rows.length - 1" title="下移" aria-label="下移这条工具" @click="move(index, 1)"><ArrowDown :size="iconSize.dense" /></button>
        <button class="icon-button" type="button" :disabled="busy" title="删除这条工具" aria-label="删除这条工具" @click="removeAt(index)"><Trash2 :size="iconSize.dense" /></button>
      </div>
      <p v-if="row.validation.problems.length" class="tools-error" role="alert">{{ row.validation.problems.map(problem => problem.message).join(' ') }}</p>
      <p v-else-if="row.validation.unknownMacros.length" class="tools-warn" role="status">未知宏会按原文传给命令：{{ row.validation.unknownMacros.map(name => `$${name}$`).join('、') }}</p>
      <p v-else-if="row.validation.danglingDollars" class="tools-warn" role="status">命令里有 {{ row.validation.danglingDollars }} 个落单的 <code>$</code>（宏要写成 <code>$Name$</code> 成对形式）。</p>
      <p v-else-if="macroUses(row.tool.command).length" class="tools-hint">这条命令用到：{{ macroUses(row.tool.command).join('、') }}</p>
    </div>
    <p v-if="!rows.length" class="tools-empty">还没有外部工具。工具是应用级的命令收藏，会出现在「工具 › 外部工具」子菜单里。</p>
  </div>

  <div class="tools-actions">
    <button class="subtle-button" type="button" :disabled="busy" @click="addTool"><Plus :size="iconSize.menu" />新增工具</button>
    <span v-if="invalid" class="tools-warn" role="alert">{{ invalid }} 条工具还没填完，保存时会原样保留但不会出现在菜单标题里。</span>
  </div>

  <fieldset v-if="selectedRecord" class="tool-settings" :aria-label="`工具设置：${selectedRecord.name}`">
    <legend>工具设置（上游 <code>ToolEditorDialog</code> 的 <code>border.title.tool.settings</code>）</legend>
    <label class="tool-field">
      <span>说明：</span>
      <input :value="selectedRecord.description" :disabled="busy" maxlength="200" :aria-label="`工具 ${selectedRecord.name} 的说明`" placeholder="显示在设置页与菜单提示里" @input="patchDetail(selected, { description: ($event.target as HTMLInputElement).value })" />
    </label>
    <label class="tool-field">
      <span>分组：</span>
      <input :value="selectedRecord.group" list="external-tool-groups" :disabled="busy" maxlength="60" :aria-label="`工具 ${selectedRecord.name} 的分组`" placeholder="外部工具" @input="patchDetail(selected, { group: ($event.target as HTMLInputElement).value })" />
      <datalist id="external-tool-groups">
        <option v-for="name in existingGroups" :key="name" :value="name" />
      </datalist>
    </label>
    <p class="tool-hint">分组决定这条工具落在「工具 › 外部工具」下的哪一层子菜单（<code>BaseToolManager.java:89-113</code>）。</p>
    <label class="tool-field">
      <span>程序：</span>
      <input :value="selectedRecord.program" :disabled="busy" spellcheck="false" maxlength="1000" :aria-label="`工具 ${selectedRecord.name} 的程序`" placeholder="clang-format" @input="patchDetail(selected, { program: ($event.target as HTMLInputElement).value })" />
    </label>
    <label class="tool-field">
      <span>参数：</span>
      <input :value="selectedRecord.parameters" :disabled="busy" spellcheck="false" maxlength="1000" :aria-label="`工具 ${selectedRecord.name} 的参数`" placeholder="-i $FilePath$" @input="patchDetail(selected, { parameters: ($event.target as HTMLInputElement).value })" />
    </label>
    <p class="tool-hint">这两栏合成上面那条命令（<code>Tool.java:75-76</code> 的两个字段 → 本仓 <code>run.start</code> 的单条命令）。</p>

    <div class="tool-filters">
      <span>输出过滤：<code>$FILE_PATH$</code>、<code>$LINE$</code>、<code>$COLUMN$</code> 可用</span>
      <ul v-if="selectedRecord.outputFilters.length">
        <li v-for="(filter, at) in selectedRecord.outputFilters" :key="`${filter}-${at}`">
          <code :class="{ 'tool-filter-bad': outputFiltersMissingFilePathMacro([filter]).length }">{{ filter }}</code>
          <button class="icon-button" type="button" :disabled="busy" :aria-label="`删除第 ${at + 1} 条过滤式`" title="删除这条过滤式" @click="removeFilter(at)"><Trash2 :size="iconSize.dense" /></button>
        </li>
      </ul>
      <p v-else class="tool-hint">还没有过滤式。</p>
      <p v-if="badFilters.length" class="tools-error" role="alert">每条输出过滤式都必须含 <code>$FILE_PATH$</code>（<code>ToolEditorDialogPanel.kt:135</code>）。</p>
      <div class="tool-filter-add">
        <input v-model="filterDraft" :disabled="busy" spellcheck="false" maxlength="200" aria-label="新增输出过滤式" placeholder="^(.+):(\d+):(\d+): (.*)$" @keydown.enter="addFilter" />
        <button class="subtle-button" type="button" :disabled="busy || !filterDraft.trim()" @click="addFilter"><Plus :size="iconSize.menu" />添加过滤式</button>
      </div>
    </div>
  </fieldset>

  <details class="tools-text">
    <summary>批量编辑（每行一条「名称|命令」）</summary>
    <textarea v-model="textDraft" rows="4" spellcheck="false" aria-label="批量编辑外部工具" placeholder="名称|命令" />
    <button class="subtle-button" type="button" :disabled="busy || !textDiffers" @click="importText">应用到上面的列表</button>
  </details>

  <details class="tools-missing">
    <summary>上游 <code>Tool</code> 的这些字段本仓存得下，但还没有运行时消费者</summary>
    <ul>
      <li v-for="field in unconsumedFields" :key="field.field">
        <strong>{{ field.label }}</strong>（<code>{{ field.field }}</code>，<code>{{ field.upstream }}</code>）—— {{ field.consumer }}
      </li>
    </ul>
  </details>
</template>

<style scoped>
.tools-list { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; }
.tools-row { display: grid; grid-template-columns: auto minmax(6em, 14em) 1fr auto auto; gap: var(--space-1) var(--space-2); align-items: center; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
.tools-row-selected { border-color: var(--accent); }
.tools-row-bad { border-color: var(--error); }
.tools-enable { display: flex; align-items: center; }
.tools-name, .tools-command { min-width: 0; min-height: var(--ctrl-height); padding: 0 var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.tools-command { font: 12px var(--font-mono); }
.tools-macros { display: flex; flex-wrap: wrap; gap: 2px; max-width: 22em; }
.tools-macro { padding: 1px var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--elevated); color: var(--muted); font: 10px var(--font-mono); cursor: pointer; }
.tools-macro:hover:not([disabled]) { color: var(--accent); border-color: var(--accent); }
.tools-row-actions { display: flex; gap: 2px; }
.tools-error, .tools-warn, .tools-hint { grid-column: 1 / -1; margin: 0; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.tools-error { color: var(--error); }
.tools-warn { color: var(--muted); }
.tools-hint { color: var(--muted); }
.tools-hint code, .tools-warn code { font: 11px var(--font-mono); }
.tools-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; }
.tools-actions { display: flex; align-items: center; gap: var(--space-2); }
.tools-text, .tools-missing { margin-top: var(--space-2); color: var(--secondary); font-size: 11px; }
.tools-text textarea { display: block; width: 100%; margin: var(--space-1) 0; padding: var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: 12px/1.6 var(--font-mono); resize: vertical; }
.tools-missing ul { margin: var(--space-1) 0 0; padding-left: var(--space-4); line-height: 1.7; }
.tools-missing code { font: 10px var(--font-mono); color: var(--muted); }
.tool-settings { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-3) 0 0; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); font-size: 11px; color: var(--secondary); }
.tool-settings legend { padding: 0 var(--space-1); color: var(--muted); font-size: 11px; }
.tool-field { display: grid; grid-template-columns: minmax(6em, 8em) 1fr; gap: var(--space-2); align-items: center; }
.tool-field input { min-width: 0; min-height: var(--ctrl-height); padding: 0 var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 12px; }
.tool-field input:not([spellcheck="false"]) { font-size: 12px; }
.tool-hint { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.tool-hint code { font: 10px var(--font-mono); }
.tool-filters { display: flex; flex-direction: column; gap: var(--space-1); padding-top: var(--space-1); border-top: 1px solid var(--line); }
.tool-filters ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-1); }
.tool-filters li { display: flex; align-items: center; gap: var(--space-1); }
.tool-filters li code { flex: 1; min-width: 0; padding: var(--space-1); overflow-wrap: anywhere; color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 11px var(--font-mono); }
.tool-filter-bad { border-color: var(--error); color: var(--error); }
.tool-filter-add { display: flex; gap: var(--space-1); }
.tool-filter-add input { flex: 1; min-width: 0; min-height: var(--ctrl-height); padding: 0 var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: 12px var(--font-mono); }
</style>
