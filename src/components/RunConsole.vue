<script setup lang="ts">
// 运行控制台的**实例标签 + 输出区**（IDEA Run 工具窗口的多个 Content）。
//
// 对照源码（`platform/execution-impl/src/com/intellij/execution/ui/`）：
//   · 每个运行实例在 Run 工具窗口里是一个 **Content**（`RunContentDescriptor`），所以标签数 = 实例数；
//   · 标签上的关闭按钮 = 停止该实例（这里用 `×`，语义是 `run.stop {instance}`）；
//   · 控制台正文沿用原来的渲染：识别出的编译诊断可点击跳转（`jumpToIssue`），
//     连续相同行折叠显示次数（IDEA Console 的折叠规则，`src/consoleFold.ts`）。
//
// 本组件只渲染：实例清单、当前实例输出、停止/跳转事件都交给宿主。
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import type { RunInstanceRecord } from '../runInstances.ts'
import type { RunIssue } from '../buildOutput.ts'
import { iconSize } from '../uiIcons'
import RunningDot from './RunningDot.vue'

/** 控制台里的一行（已由宿主折叠/识别过：见 `src/consoleFold.ts` 与 `src/buildOutput.ts`）。 */
export interface RunConsoleLine {
  text: string
  /** 连续相同行合并后的条数（`consoleFold.ts`）。 */
  count?: number
  /** 识别出的编译诊断（可点击跳转）；没有就是 null。 */
  issue?: RunIssue | null
}

const props = defineProps<{
  instances: readonly RunInstanceRecord[]
  /** 当前选中的实例 id（0 = 还没有实例）。 */
  active: number
  lines: readonly RunConsoleLine[]
  isDesktop: boolean
}>()
const emit = defineEmits<{
  select: [instance: number]
  stop: [instance: number]
  jump: [issue: RunIssue]
}>()

/** 标签标题：配置名，没有名字就用「运行 N」（N = 起跑顺序）。 */
function title(instance: RunInstanceRecord, index: number): string {
  return instance.label || `运行 ${index + 1}`
}

/** 标签右侧的状态：在跑是实心点，结束显示退出码。 */
function exitLabel(instance: RunInstanceRecord): string {
  return instance.running || instance.exit === null ? '' : `exit ${instance.exit}`
}

const anyRunning = computed(() => props.instances.some(instance => instance.running))
</script>

<template>
  <div class="run-console">
    <!-- 实例标签条：IDEA 的 Run 工具窗口就是按实例开 Content 的。
         单个实例时不占地方（不渲染标签条），保持面板干净。 -->
    <div v-if="instances.length > 1" class="run-tabs" role="tablist" aria-label="运行实例">
      <div v-for="(instance, index) in instances" :key="instance.id" class="run-tab" :class="{ selected: instance.id === active }">
        <button role="tab" :aria-selected="instance.id === active" :title="`${title(instance, index)}${instance.running ? '（正在运行）' : ''}`" @click="emit('select', instance.id)">
          <span class="run-tab-title">{{ title(instance, index) }}</span>
          <RunningDot v-if="instance.running" />
          <span v-if="exitLabel(instance)" class="run-tab-badge">{{ exitLabel(instance) }}</span>
        </button>
        <button v-if="instance.running" class="run-tab-close" :aria-label="`停止 ${title(instance, index)}`" :title="`停止 ${title(instance, index)}`" @click="emit('stop', instance.id)"><X :size="iconSize.inline" /></button>
      </div>
    </div>
    <!-- IDEA's build console: recognised compiler diagnostics are clickable and
         jump to the offending line instead of being read as plain text. -->
    <div class="run-log" aria-label="运行输出">
      <template v-if="lines.length">
        <div v-for="(line, index) in lines" :key="index" class="run-line" :class="{ 'run-issue': line.issue }">
          <button v-if="line.issue" class="run-issue-link" :title="`跳转到 ${line.issue.path}:${line.issue.line}`" @click="emit('jump', line.issue)">{{ line.text }}</button>
          <span v-else>{{ line.text }}</span>
          <!-- 折叠计数（IDEA Console 的折叠行显示重复次数） -->
          <span v-if="line.count && line.count > 1" class="run-fold-count" :title="`合并了 ${line.count} 条相同行`">×{{ line.count }}</span>
        </div>
      </template>
      <p v-else class="run-placeholder">{{ isDesktop ? '点击“运行”在项目根目录执行命令；输出与退出码会实时显示。' : '浏览器预览不能运行命令，请在桌面端使用。' }}</p>
    </div>
    <p v-if="anyRunning && instances.length > 1" class="run-hint">每个实例一个标签；`×` 只停那一个（工具栏的「停止」停当前实例）。</p>
  </div>
</template>

<style scoped>
.run-console { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.run-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px 4px 0; border-bottom: 1px solid var(--line); }
.run-tab { display: inline-flex; align-items: center; border: 1px solid transparent; border-bottom: 0; border-radius: var(--radius-xs) var(--radius-xs) 0 0; }
.run-tab.selected { border-color: var(--line); background: var(--panel); }
/* `display: inline-flex` 是补的 —— 这是 `<button>`，UA 默认 inline-block，align-items / gap 全都失效
   （同款陷阱见 src/style.css:135 的说明与第八十四批的记录）。不补的话 RunningDot 会按基线
   沉到 11px 的标题文字下面，而不是与它居中对齐。gap 收在这里，.run-tab-badge 的 margin-left 就多余了。 */
.run-tab > button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.run-tab.selected > button { color: var(--bright); }
.run-tab-title { padding: 3px 6px; }
.run-tab-badge { font-size: 10px; opacity: .8; }
.run-tab-close { padding: 3px 4px; line-height: 0; }
.run-log { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2) var(--space-3); font: 12px/1.6 var(--font-mono); }
.run-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.run-issue-link { border: 0; padding: 0; background: transparent; color: var(--accent); font: inherit; text-align: left; cursor: pointer; text-decoration: underline dotted; }
.run-fold-count { margin-left: var(--space-2); color: var(--muted); font-size: 10px; }
.run-placeholder { color: var(--muted); font-size: 11px; }
.run-hint { margin: 0; padding: var(--space-1) var(--space-3); color: var(--muted); font-size: 10px; border-top: 1px solid var(--line); }
</style>
