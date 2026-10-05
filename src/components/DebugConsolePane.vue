<script setup lang="ts">
// 调试控制台（从 `DebugPanel.vue` 拆出 —— 面板贴着机检上限，与断点区/源文件清单同一拆法）。
//
// 本轮补的是上游控制台工具栏上的「Pause output」——
// `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:19`
// （ToggleAction）/ `:31-43`（读写 `ConsoleView.isOutputPaused` / `setOutputPaused`）/
// `:44-52`（可用与「有延迟输出」判据）/
// `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:72`（`id="PauseOutput"`）。
// 调试器标签页里的控制台就是这一个 ConsoleView（`XDebugSessionTab` 的内容面板），
// 所以它记在 dbg/actions 判词里。规则在 `src/debugConsoleFreeze.ts`。
//
// 语义照搬：**冻结的是跟随滚动，不是收数据** —— `dapConsole` 继续长，暂停期间新到的行
// 数在标题上写出来（上游 `hasDeferredOutput()`），恢复跟随的那一刻滚到底。
import { computed, nextTick, ref, watch } from 'vue'
import { Pause, Play } from 'lucide-vue-next'
import { dapConsole } from '../bridge'
import { iconSize } from '../uiIcons'
import {
  CONSOLE_CAN_PAUSE, PAUSE_OUTPUT_LABEL, deferredOutputNote, deferredLines,
  markForPause, shouldFollowOutput, shouldRevealOnResume,
} from '../debugConsoleFreeze'

const consoleBox = ref<HTMLElement>()
const paused = ref(false)
// 按下暂停时记下当时的行数，之后差值就是「没跟着滚过去」的那几行。
const markedAt = ref<number | null>(null)

const note = computed(() => deferredOutputNote(dapConsole.length, markedAt.value))
const pending = computed(() => deferredLines(dapConsole.length, markedAt.value))

function scrollToBottom() {
  if (consoleBox.value) consoleBox.value.scrollTop = consoleBox.value.scrollHeight
}

watch(() => dapConsole.length, async () => {
  await nextTick()
  if (shouldFollowOutput(paused.value)) scrollToBottom()
})

function togglePause() {
  const next = !paused.value
  // 上游 `canPause()` 在本仓恒真（见 src/debugConsoleFreeze.ts），所以没有「点不动」的形态。
  if (!CONSOLE_CAN_PAUSE) return
  if (shouldRevealOnResume(dapConsole.length, markedAt.value) && !next) {
    paused.value = false
    markedAt.value = markForPause(false, dapConsole.length)
    void nextTick(scrollToBottom)
    return
  }
  paused.value = next
  markedAt.value = markForPause(next, dapConsole.length)
}
</script>

<template>
  <div class="debug-section-title">
    调试控制台
    <!-- 上游 PauseOutputAction：控制台工具栏的「暂停输出」开关（冻结跟随滚动，不拦数据）。 -->
    <button class="chip-x debug-console-action" :class="{ active: paused }"
            :title="paused ? '恢复输出（跟随滚动到底部）' : '暂停输出（不再跟随滚动，调试器仍在收）'"
            :aria-label="paused ? '恢复输出' : PAUSE_OUTPUT_LABEL" :aria-pressed="paused" @click="togglePause">
      <Play v-if="paused" :size="iconSize.chip" /><Pause v-else :size="iconSize.chip" />
    </button>
    <span v-if="paused && pending" class="debug-console-deferred" role="status">{{ note }}</span>
  </div>
  <div ref="consoleBox" class="debug-console" aria-label="调试器输出">
    <span v-for="(entry, index) in dapConsole" :key="index" class="debug-console-line" :class="entry.category">{{ entry.text }}</span>
    <span v-if="!dapConsole.length" class="debug-console-line telemetry">调试器输出与程序 stdout/stderr 会显示在这里。</span>
  </div>
</template>

<style scoped>
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; display: flex; align-items: center; gap: var(--space-1); }
.debug-console { border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); min-height: 72px; max-height: 220px; overflow: auto; white-space: pre-wrap; font: 11px/1.6 var(--font-mono); }
.debug-console-line { display: block; overflow-wrap: anywhere; }
.debug-console-line.stderr { color: var(--error); }
.debug-console-line.telemetry { color: var(--muted); }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--bright); background: var(--hover); }
.chip-x svg { flex-shrink: 0; }
.debug-console-action { min-height: 16px; text-transform: none; letter-spacing: 0; }
.debug-console-action.active { color: var(--accent); }
.debug-console-deferred { color: var(--warning); font-size: 10px; text-transform: none; letter-spacing: 0; }
</style>
