<script setup lang="ts">
// 调试会话的**启动/附加**块（配置展示 + 两个按钮 + 附加目标输入 + 最近附加），
// 从 `DebugPanel.vue` 拆出 —— 面板贴着机检上限，而这一块自成一体：它只做"用当前配置
// 起一次 DAP 会话"，与调用栈/变量树的渲染不共一个职责域（同一拆法见 DebugConsolePane/
// DebugBreakpointsPane/DebugProgressPane）。
//
// 装配链（本仓现状，逐字照搬面板里原来的那两段）：
//   · 启动：`dapStart({ command:'', args:[], kind, program, cwd, stopOnEntry:false })`
//     —— 命令取自 `TaoCode.dap.json` 里对应 kind（宿主侧解析）；
//   · 附加：同上但带 `configuration:{request:'attach', processId|pipeName}`（见 src/debugAttach.ts）；
//   · 起来后：记住适配器的能力位里与异常过滤器有关的那几格（`rememberFilters`），
//     再按当前勾选把异常断点发给适配器，最后喊宿主重取调用栈（emit `refresh`）。
import { computed, ref } from 'vue'
import { Bug, Crosshair } from 'lucide-vue-next'
import { dapStart } from '../bridge'
import { applyExceptionFilters, parseExceptionFilters, sendExceptionBreakpoints } from '../exceptionBreakpoints'
import { attachGuidance, attachSelectorError, loadAttachHistory, parseAttachSelector, pushAttachTarget, saveAttachHistory } from '../debugAttach'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  /** 当前运行配置的适配器类型（App 透传；空则退回 cppvsdbg）。 */
  adapterKind?: string
  /** 要调试的程序路径。 */
  program?: string
  /** 工作目录。 */
  cwd?: string
  /** 宿主就绪（桌面端才发得出请求）。 */
  ready: boolean
  /** 会话已在跑 ⇒ 两个按钮都禁掉（不重复起会话）。 */
  running: boolean
}>()
const emit = defineEmits<{ refresh: [] }>()

const kind = computed(() => props.adapterKind?.trim() || 'cppvsdbg')
const program = computed(() => props.program?.trim() ?? '')
const cwd = computed(() => props.cwd?.trim() || '.')
// 附加说明（本机 PID / 连接标识怎么解释 + 远程附加的真实前提）在 src/debugAttach.ts。
const attachText = computed(() => attachGuidance(kind.value))
const attachId = ref('')
// 最近附加过的目标（上游 `AttachToProcessDialog` 的「最近使用」栏）：进程列表要宿主枚举通道
// （本仓没有，见 dbg/attach 判词），最近填过的标识是纯前端事实，存 localStorage。
const storage = typeof localStorage === 'undefined' ? null : localStorage
const attachHistory = ref<string[]>(loadAttachHistory(storage))
const busy = ref(false)
const error = ref('')
function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

/** 适配器能力位里与异常过滤器有关的那几格（`filters` 声明）。 */
function rememberFilters(capabilities: Record<string, unknown> | undefined) {
  applyExceptionFilters(parseExceptionFilters(capabilities))
}

async function start() {
  error.value = ''
  if (!program.value.trim()) { error.value = '请填写要调试的程序路径。'; return }
  try {
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: program.value.trim(), cwd: cwd.value.trim() || '.', stopOnEntry: false })
    rememberFilters(result.capabilities)
    await sendExceptionBreakpoints()
    emit('refresh')
  } catch (caught) { error.value = message(caught) }
}
// IDEA's Attach to Process: no program of our own, the adapter joins a running one
// via its selector (processId for cppvsdbg/lldb-dap, pipeName for others).
async function attach() {
  error.value = ''
  const selector = attachId.value.trim()
  const problem = attachSelectorError(selector)
  if (problem) { error.value = problem; return }
  const parsed = parseAttachSelector(selector)!
  try {
    const configuration = parsed.kind === 'pid' ? { processId: parsed.processId } : { pipeName: parsed.pipeName }
    const result = await dapStart({ command: '', args: [], kind: kind.value.trim() || 'cppvsdbg', program: '', cwd: cwd.value.trim() || '.', stopOnEntry: false, configuration: { request: 'attach', ...configuration } })
    attachHistory.value = pushAttachTarget(attachHistory.value, selector)
    saveAttachHistory(storage, attachHistory.value)
    rememberFilters(result.capabilities)
    await sendExceptionBreakpoints()
    emit('refresh')
  } catch (caught) { error.value = message(caught) }
}
// 宿主（DebugPanel）的「重新运行」在适配器不声明 `supportsRestartRequest` 时要退化成
// 「停止 + 重新启动」——那段重启要复用的正是这里的 `start`（配置解析、异常过滤器重发、
// 起来后 emit refresh 都在这条链上），所以把它暴露出去，别在面板里再抄一份。
defineExpose({ start, attach })
</script>

<template>
  <div class="debug-config">
    <p class="debug-field"><span>kind</span><strong>{{ kind }}</strong></p>
    <p class="debug-field"><span>program</span><strong>{{ program || '（未填写）' }}</strong></p>
    <p class="debug-field"><span>cwd</span><strong>{{ cwd }}</strong></p>
    <p class="debug-hint">这些值来自「运行」面板的当前配置，改配置即生效（避免两处各存一份）。</p>
    <div class="debug-config-buttons">
      <button class="debug-btn primary" :disabled="!ready || busy || running" title="启动调试会话（command 取自 TaoCode.dap.json 对应 kind）" @click="start"><Bug aria-hidden="true" :size="iconSize.menu" />启动</button>
      <!-- IDEA's Attach to Process: the same handshake with the `attach` request. -->
      <button class="debug-btn" :disabled="!ready || busy || running" title="附加到正在运行的进程（进程 PID 或管道名）" @click="attach"><Crosshair aria-hidden="true" :size="iconSize.menu" />附加</button>
    </div>
    <label class="debug-field"><span>附加到</span><input v-model="attachId" list="debug-attach-history" class="debug-input" aria-label="要附加的进程 PID 或管道名" placeholder="PID（如 4242）或 pipeName" spellcheck="false" @keydown.enter.prevent="attach" /></label>
    <datalist id="debug-attach-history">
      <option v-for="entry in attachHistory" :key="`attach:${entry}`" :value="entry">最近附加</option>
    </datalist>
    <p v-if="attachHistory.length" class="debug-hint">最近附加过：{{ attachHistory.slice(0, 3).join('、') }}</p>
    <p class="debug-hint">{{ attachText }}</p>
    <p v-if="error" class="debug-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.debug-config { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); }
.debug-config-buttons { display: flex; gap: var(--space-1); }
.debug-field { display: flex; align-items: center; gap: var(--space-1); min-width: 0; font-size: 11px; color: var(--muted); }
.debug-field > span { flex-shrink: 0; width: 48px; }
.debug-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.debug-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.debug-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.debug-btn:hover:not(:disabled) { background: var(--hover); color: var(--bright); }
.debug-btn:disabled { color: var(--muted); opacity: .5; }
.debug-btn.primary { border-color: var(--accent); color: var(--accent); }
.debug-hint { margin: 0; color: var(--muted); font-size: 11px; }
.debug-error { margin: 0; color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
</style>
