<script setup lang="ts">
// 「配置任务激活」对话框 —— 上游
// `platform/external-system-impl/.../service/task/ui/ConfigureTasksActivationDialog.java` 的 DOM 子集。
//
// 上游形态：项目下拉框选一个外部工程 → 树里按 Phase 分组列出已激活的任务，工具条给
// 添加 / 移除 / 上移 / 下移。上游的树**只显示有任务的阶段**（`buildProjectPhasesNodes` 对空阶段
// 返回 null）；本仓为了能往空阶段添加，7 个阶段都渲染，每个阶段带自己的「添加」行。
// 树的折叠与命令在 `src/externalTasksActivation.ts`，状态与持久化在 `src/externalProjectModel.ts`；
// 宿主是 Gradle 工具窗口的任务右键（`src/components/GradlePanel.vue`）。
//
// 说明：本仓目前把激活状态作为**任务归属登记**（任务节点 tooltip 显示阶段串，
// `ExternalSystemTaskActivator.getDescription` 的行为），按阶段自动执行（`doExecuteBuildPhaseTriggers`）
// 还没有落点 —— 运行控制台的配置只有命令与标签两个字段。
import { computed, ref, watch } from 'vue'
// 上游这一族的四个按钮是 `ToolbarDecorator` 的 `CommonActionsPanel.Buttons`：
// `ConfigureTasksActivationDialog.java:193-201` 挂 removeAction / moveUpAction / moveDownAction
// （setAddAction 在 :165），由 `ToolbarDecorator.java:489-493` 装进 `CommonActionsPanel`。
// 图标全部是 **16x16 矢量 SVG**，逐个来自 `CommonActionsPanel.java`：
//   · REMOVE `AllIcons.General.Remove` (:67) → `AllIcons.java:655` → `expui/general/remove.svg`
//     （一条横杠，不是叉 —— 删一行是减法不是叉）
//   · UP     `IconUtil.getMoveUpIcon()`   (:79) → `IconUtil.kt:255-256` → `AllIcons.Actions.MoveUp`
//     → `AllIcons.java:135` → `expui/general/moveUp.svg`（箭头 + **下方**一条基线）
//   · DOWN   `IconUtil.getMoveDownIcon()` (:85) → `IconUtil.kt:258-259` → `AllIcons.Actions.MoveDown`
//     → `AllIcons.java:120` → `expui/general/moveDown.svg`（**上方**一条基线 + 箭头）
// 三个 SVG 的 width/height 都写死 16（moveUp.svg:2），所以这一档取 `iconSize.action`。
// 原来这里是 `↑` `↓` `✕` 三个**字体字形**：形状三条全错（叉≠横杠、裸箭头≠带基线的箭头），
// 且字号由字体决定，换字体就变形 —— 违反 `src/uiIcons.ts:13` 的第 2 条硬规则。
import { ArrowDownFromLine, ArrowUpFromLine, Minus, X } from 'lucide-vue-next'
import { activationTaskOptions, type ActivationBuildNode } from '../externalTasksActivation.ts'
import type { TaskPhase } from '../externalProjectModel.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{ builds: ActivationBuildNode[]; summary: string }>()
const emit = defineEmits<{
  (event: 'close'): void
  (event: 'add', directory: string, phase: TaskPhase, task: string): void
  (event: 'remove', directory: string, phase: TaskPhase, task: string): void
  (event: 'move', directory: string, phase: TaskPhase, task: string, delta: number): void
}>()

const selected = ref(props.builds[0]?.directory ?? '')
const query = ref('')
const picked = ref<Record<string, string>>({})
watch(() => props.builds, builds => {
  if (!builds.some(build => build.directory === selected.value)) selected.value = builds[0]?.directory ?? ''
}, { immediate: true })
const build = computed(() => props.builds.find(item => item.directory === selected.value) ?? null)
const options = computed(() => (build.value ? activationTaskOptions(build.value, query.value) : []))
function add(phase: TaskPhase) {
  const task = picked.value[phase]
  if (!build.value || !task) return
  emit('add', build.value.directory, phase, task)
  picked.value = { ...picked.value, [phase]: '' }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette activation-dialog" role="dialog" aria-modal="true" aria-label="配置任务激活">
      <div class="palette-input">
        <span class="activation-heading">配置任务激活</span>
        <span class="activation-summary" aria-live="polite">{{ summary }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <p v-if="!builds.length" class="activation-note">还没有链接的 Gradle 工程；链接并同步后任务才会出现在这里。</p>
      <template v-else>
        <div v-if="builds.length > 1" class="activation-builds" role="radiogroup" aria-label="选择工程">
          <label v-for="item in builds" :key="item.directory" class="activation-build">
            <input type="radio" :checked="item.directory === selected" @change="selected = item.directory" />
            {{ item.label }}<span v-if="item.count" class="activation-badge">{{ item.count }}</span>
          </label>
        </div>
        <label class="activation-search">筛选可用任务
          <input v-model="query" type="search" placeholder="任务名" aria-label="筛选可用任务" />
        </label>
        <div v-if="build" class="activation-body">
          <p v-if="build.missingTasks.length" class="activation-stale">
            当前任务表里找不到：{{ build.missingTasks.join('、') }}（改名或被删；重新同步后仍留在这里，可手动移除）
          </p>
          <section v-for="phase in build.phases" :key="phase.phase" class="activation-phase">
            <h3>{{ phase.label }}<span class="activation-badge">{{ phase.tasks.length }}</span></h3>
            <p v-if="!phase.tasks.length" class="activation-note">没有激活的任务。</p>
            <ul v-else>
              <li v-for="(task, index) in phase.tasks" :key="`${phase.phase}-${task}-${index}`">
                <code>{{ task }}</code>
                <button class="icon-button" title="上移" aria-label="上移" :disabled="index === 0"
                        @click="emit('move', build.directory, phase.phase, task, -1)"><ArrowUpFromLine :size="iconSize.action" /></button>
                <button class="icon-button" title="下移" aria-label="下移" :disabled="index === phase.tasks.length - 1"
                        @click="emit('move', build.directory, phase.phase, task, 1)"><ArrowDownFromLine :size="iconSize.action" /></button>
                <button class="icon-button" title="移除" aria-label="移除"
                        @click="emit('remove', build.directory, phase.phase, task)"><Minus :size="iconSize.action" /></button>
              </li>
            </ul>
            <div class="activation-add">
              <select v-model="picked[phase.phase]" :aria-label="`向${phase.label}添加任务`">
                <option value="">选择任务…</option>
                <option v-for="task in options" :key="task" :value="task">{{ task }}</option>
              </select>
              <button class="subtle-button" :disabled="!picked[phase.phase]" @click="add(phase.phase)">添加</button>
            </div>
          </section>
        </div>
        <p class="activation-hint">激活把任务登记到阶段上：任务节点会显示它被激活在哪些阶段。按阶段自动执行尚未接进同步/运行链。</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.activation-dialog { width: 560px; max-width: 92vw; max-height: 80vh; }
.activation-heading { color: var(--bright); font-weight: 500; }
.activation-summary { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activation-note { margin: 0; padding: 2px var(--space-3); color: var(--muted); font-size: 11px; }
.activation-stale { margin: 0; padding: 2px var(--space-3); color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
.activation-builds { display: flex; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.activation-build { display: flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.activation-search { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); color: var(--secondary); font-size: 11px; }
.activation-search input { flex: 1; min-width: 0; color: var(--text); background: var(--editor); border: 1px solid var(--line); font-size: 11px; }
.activation-body { flex: 1; min-height: 0; overflow: auto; padding: 0 var(--space-3) var(--space-3); }
.activation-phase { margin-top: var(--space-2); border-top: 1px solid var(--line); padding-top: 2px; }
.activation-phase h3 { margin: 0; color: var(--secondary); font-size: 12px; font-weight: 500; }
.activation-phase ul { margin: 0; padding: 0; list-style: none; }
.activation-phase li { display: flex; align-items: center; gap: var(--space-1); padding: 1px 0; font-size: 11px; }
.activation-phase li code { flex: 1; min-width: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 这三颗按钮的盒子沿用全局 `.icon-button`（style.css:254，28x28 + `padding: 0`）——
   原来写的 `padding: 0 3px` 与 `font-size: 11px` 是给三个**文本字形**调的，字形换掉后
   这两条只会把 16px 图标挤进一个 22px 内容盒（`ui-icons.test.mjs:152` 那条门禁管的就是
   「定尺按钮归零内边距」），所以一并删掉。 */
.activation-phase .icon-button { color: var(--secondary); }
.activation-phase .icon-button:disabled { opacity: 0.35; }
.activation-add { display: flex; align-items: center; gap: var(--space-1); margin: 2px 0 var(--space-1); }
.activation-add select { flex: 1; min-width: 0; color: var(--text); background: var(--editor); border: 1px solid var(--line); font-size: 11px; }
.activation-badge { margin-left: var(--space-1); color: var(--muted); font-size: 10px; }
.activation-hint { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 11px; border-top: 1px solid var(--line); }
</style>
