<script setup lang="ts">
// 调试控制台（从 `DebugPanel.vue` 拆出 —— 面板贴着机检上限，与断点区/源文件清单同一拆法）。
//
// 本轮补的是上游控制台工具栏上的「Pause output」——
// `platform/execution-impl/src/com/intellij/execution/actions/PauseOutputAction.java:18`
// （ToggleAction）/ `:29-40`（读 `ConsoleView.isOutputPaused` `:31` / 写 `setOutputPaused` `:38`）/
// `:48-65`（可用与「有延迟输出」判据，`:64` 是 `setEnabledAndVisible` ⇒ 不可用就整格不出现）/
// `platform/execution-impl/resources/intellij.platform.execution.impl.actions.xml:72`（`id="PauseOutput"`）。
// 后两组行号是 dap3 逐行重数过参考树的订正（原写法指歪了，留痕见 `docs/batch-2026-10-06-dap3.md`，
// 钉住内容的判据在 `tests/debug-console-freeze.test.mjs`）。
// 调试器标签页里的控制台就是这一个 ConsoleView（`XDebugSessionTab` 的内容面板），
// 所以它记在 dbg/actions 判词里。规则在 `src/debugConsoleFreeze.ts`。
//
// 语义照搬：**冻结的是跟随滚动，不是收数据** —— `dapConsole` 继续长，暂停期间新到的行
// 数在标题上写出来（上游 `hasDeferredOutput()`），恢复跟随的那一刻滚到底。
//
// 行的**严重度分档**在 `src/dapOutputSeverity.ts`（DAP `output` 事件的 `category` → 四档 +
// 呈现档），这里只按它给的类名画、并按它给的阈值数「要用户看一眼」的那两条。
// 之前模板是把适配器给的原始 `category` 直接当类名用 —— 撞上一条 CSS 才算一档，
// `important`/`stdout`/`output` 与任何自造名字全塌成一级。
import { computed, nextTick, ref, watch } from 'vue'
import { CornerDownRight, Pause, Play } from 'lucide-vue-next'
import { dapConsole, dapState } from '../bridge'
import { iconSize } from '../uiIcons'
import { countDapOutputAttention, dapOutputLineClass } from '../dapOutputSeverity'
// 输出行的**可跳位置**：bridge 的 output 事件丢了 `path/line/column`，由 src/dapEventRelay.ts
// 的第二监听者补出（规则在 src/dapEventFields.ts 的 outputJumpTarget）。宿主是 App 的 jump 通道。
import { dapEventRelay } from '../dapEventRelay'
import type { DapJumpTarget } from '../dapEventFields'
import {
  CONSOLE_CAN_PAUSE, PAUSE_OUTPUT_LABEL, deferredOutputNote, deferredLines,
  markForPause, pauseOutputVisible, shouldFollowOutput, shouldRevealOnResume,
} from '../debugConsoleFreeze'

const consoleBox = ref<HTMLElement>()
const paused = ref(false)
// 按下暂停时记下当时的行数，之后差值就是「没跟着滚过去」的那几行。
const markedAt = ref<number | null>(null)

const emit = defineEmits<{ jump: [target: { path: string; line: number; column?: number }] }>()
/**
 * 一行输出可不可跳（结构化地拿了 `path/line`）。`dapEventRelay.outputs` 下标 = dapConsole 下标；
 * 只渲染**有位置**的那些行的按钮，其余行仍是纯文本。
 */
const outputTargets = computed<Record<number, DapJumpTarget>>(() => dapEventRelay.outputs)
function jumpOutput(target: DapJumpTarget) {
  emit('jump', { path: target.path, line: target.line, column: target.column })
}

const note = computed(() => deferredOutputNote(dapConsole.length, markedAt.value))
const pending = computed(() => deferredLines(dapConsole.length, markedAt.value))
// 上游 `PauseOutputAction.update()` 走的是 `setEnabledAndVisible`（`:64`）：会话已结束、
// 也没有暂停中的积压时，这一格**不出现**（本仓 `canPause()` 恒真，见 src/debugConsoleFreeze.ts）。
const pauseAvailable = computed(() => pauseOutputVisible({
  processRunning: dapState.running, hasDeferred: pending.value > 0,
}))
// 「要用户看一眼」的那两档各有几条（阈值与 `src/lspServerMessages.ts` 的 `handleLogMessage` 同一口径：`severity <= 2`）。
const attention = computed(() => countDapOutputAttention(dapConsole))
const attentionNote = computed(() => {
  const parts: string[] = []
  if (attention.value.error) parts.push(`错误 ${attention.value.error}`)
  if (attention.value.warning) parts.push(`重要 ${attention.value.warning}`)
  return parts.join(' · ')
})

function scrollToBottom() {
  if (consoleBox.value) consoleBox.value.scrollTop = consoleBox.value.scrollHeight
}

watch(() => dapConsole.length, async () => {
  await nextTick()
  if (shouldFollowOutput(paused.value)) scrollToBottom()
})

function togglePause() {
  const next = !paused.value
  // 上游 `canPause()` 在本仓恒真（见 src/debugConsoleFreeze.ts）；「会话结束且无积压」那一档
  // 在上游是 `setEnabledAndVisible(false)` ⇒ 按钮根本不存在，走不到这里（见模板的 `v-if`）。
  if (!CONSOLE_CAN_PAUSE || !pauseAvailable.value) return
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
    <!-- 上游 PauseOutputAction：控制台工具栏的「暂停输出」开关（冻结跟随滚动，不拦数据）。
         开关的出不出走 `pauseOutputVisible`（上游 `:53-64`：`canPause()` 与「进程没结束 或 有延迟输出」，末行 `setEnabledAndVisible`）。 -->
    <button v-if="pauseAvailable" class="chip-x debug-console-action" :class="{ active: paused }"
            :title="paused ? '恢复输出（跟随滚动到底部）' : '暂停输出（不再跟随滚动，调试器仍在收）'"
            :aria-label="paused ? '恢复输出' : PAUSE_OUTPUT_LABEL" :aria-pressed="paused" @click="togglePause">
      <Play v-if="paused" :size="iconSize.chip" /><Pause v-else :size="iconSize.chip" />
    </button>
    <span v-if="paused && pending" class="debug-console-deferred" role="status">{{ note }}</span>
    <!-- 分档计数只在真有「要看一眼」的行时出现（上游那格没有计数，本仓自己加的呈现；
         没有错误/重要行时这里什么都不画 —— 不留一个恒为 0 的假读数）。 -->
    <span v-if="attentionNote" class="debug-console-severity" role="status"
          :title="`错误 / 重要（其余档只画颜色，不占标题）`">{{ attentionNote }}</span>
  </div>
  <div ref="consoleBox" class="debug-console" aria-label="调试器输出">
    <!-- 有 `path/line` 的输出行带一个跳转按钮（上游构建控制台把 `path:line` 做成可点超链接）；
         其余行照旧只画文本。 -->
    <div v-for="(entry, index) in dapConsole" :key="index" class="debug-console-line" :class="dapOutputLineClass(entry.category)">
      <span class="debug-console-text">{{ entry.text }}</span>
      <button v-if="outputTargets[index]" class="debug-console-jump" :title="`跳到 ${outputTargets[index].path}:${outputTargets[index].line + 1}`" :aria-label="`跳到输出位置 ${outputTargets[index].path}:${outputTargets[index].line + 1}`" @click="jumpOutput(outputTargets[index])"><CornerDownRight :size="iconSize.inline" /></button>
    </div>
    <span v-if="!dapConsole.length" class="debug-console-line sev-muted">调试器输出与程序 stdout/stderr 会显示在这里。</span>
  </div>
</template>

<style scoped>
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; display: flex; align-items: center; gap: var(--space-1); }
.debug-console { border-bottom: 1px solid var(--line); padding: var(--space-1) var(--space-3); min-height: 72px; max-height: 220px; overflow: auto; white-space: pre-wrap; font: 11px/1.6 var(--font-mono); }
.debug-console-line { display: flex; align-items: baseline; gap: var(--space-1); overflow-wrap: anywhere; }
.debug-console-text { min-width: 0; }
/* 输出跳转按钮：只在有位置的行出现；默认低调，hover 才明显（不吃行高）。
   行用 `align-items: baseline` 让两行文字基线对齐，而按钮的基线取自其内 svg 的下沿 ——
   直接跟着 baseline 走图标会沉到文字基线上。所以按钮自己 `align-self: center`，
   图标用 `inline-flex` 定心，与旁边 11px 等宽正文同一行高。 */
.debug-console-jump { flex-shrink: 0; display: inline-flex; align-items: center; align-self: center; border: 0; padding: 0 2px; background: transparent; color: var(--accent); cursor: pointer; }
.debug-console-jump > svg { flex-shrink: 0; }
.debug-console-jump:hover { color: var(--bright); }
/* 呈现档由 src/dapOutputSeverity.ts 给出（sev-*），不再拿适配器的原始 category 当类名。
   error/warning = 上游 MessageEvent.Kind 的那两档；system = 调试器自己的消息（SYSTEM_OUTPUT）；
   normal = debuggee 的 stdout；muted = telemetry（协议说不展示给用户）。 */
.debug-console-line.sev-error { color: var(--error); }
.debug-console-line.sev-warning { color: var(--warning); font-weight: 600; }
.debug-console-line.sev-system { color: var(--muted); }
.debug-console-line.sev-muted { color: var(--muted); opacity: .7; }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--bright); background: var(--hover); }
.chip-x svg { flex-shrink: 0; }
.debug-console-action { min-height: 16px; text-transform: none; letter-spacing: 0; }
.debug-console-action.active { color: var(--accent); }
.debug-console-deferred { color: var(--warning); font-size: 10px; text-transform: none; letter-spacing: 0; }
.debug-console-severity { color: var(--error); font-size: 10px; text-transform: none; letter-spacing: 0; }
</style>
