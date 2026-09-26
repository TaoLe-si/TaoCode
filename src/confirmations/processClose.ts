// 进程关闭确认：对应 IDEA 的 TerminateRemoteProcessDialog（由终端经
// TerminalCloseConfirmation.kt:15-22 进入）。终端不能断开（TerminalTabCloseListener.kt:87
// 置 ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY），所以对话框只有 终止 / 取消，
// 「不再询问」把 TERMINATE 写回 GeneralSettings.processCloseConfirmation（:74-84）。
// 纯决策函数（resolveProcessClose 等）在 `src/processClose.ts` 并有独立测试；
// 这里只承载带状态的流程。从 App.vue 拆出，依赖经 ctx 注入。
import { ref, type Ref } from 'vue'
import { request } from '../bridge'
import type { GeneralSettingsState } from '../bridge'
import { errorMessage } from '../errors'
import { confirmationResult, rememberedSetting, resolveProcessClose, TERMINAL_CAN_DISCONNECT, type ProcessCloseChoice, type ProcessCloseConfirmation, type ProcessCloseResult } from '../processClose'

export interface ProcessCloseContext {
  generalSettings: Ref<GeneralSettingsState>
  notify: (message: string, error?: boolean) => void
}

export function createProcessCloseConfirmation(ctx: ProcessCloseContext) {
  const terminalClosePrompt = ref<{ labels: string[] } | null>(null)
  const terminalCloseDontAsk = ref(false)
  let terminalCloseResolver: ((result: ProcessCloseResult) => void) | null = null
  async function saveProcessCloseConfirmation(value: ProcessCloseConfirmation) {
    const previous = ctx.generalSettings.value
    ctx.generalSettings.value = { ...previous, processCloseConfirmation: value }
    try {
      ctx.generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: ctx.generalSettings.value })
    } catch (error) {
      ctx.generalSettings.value = previous
      ctx.notify(`关闭进程的设置没有保存成功：${errorMessage(error)}`, true)
    }
  }
  /** Answers whether the terminal may be closed now. */
  async function requestTerminalClose(label: string): Promise<boolean> {
    const decision = resolveProcessClose(ctx.generalSettings.value.processCloseConfirmation, TERMINAL_CAN_DISCONNECT)
    if (decision === 'TERMINATE') return true
    // A terminal never allows disconnecting, so this branch cannot be reached from here; it is
    // kept because that is what the source algorithm says when it can.
    if (decision === 'DISCONNECT') return false
    terminalCloseDontAsk.value = false
    terminalClosePrompt.value = { labels: [label] }
    const result = await new Promise<ProcessCloseResult>(resolve => { terminalCloseResolver = resolve })
    return result !== 'LEAVE_RUNNING'
  }
  function resolveTerminalClose(choice: ProcessCloseChoice) {
    const result = confirmationResult(choice, TERMINAL_CAN_DISCONNECT)
    const dontAsk = terminalCloseDontAsk.value
    terminalClosePrompt.value = null
    const resolve = terminalCloseResolver
    terminalCloseResolver = null
    if (dontAsk) {
      const remembered = rememberedSetting(result)
      if (remembered) void saveProcessCloseConfirmation(remembered)
    }
    resolve?.(result)
  }
  return { terminalClosePrompt, terminalCloseDontAsk, requestTerminalClose, resolveTerminalClose }
}
