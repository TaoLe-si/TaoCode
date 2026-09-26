// IDEA's "a content with a running process is being closed" confirmation, ported from
// TerminateRemoteProcessDialog. The setting is GeneralSettings.processCloseConfirmation
// (GeneralSettings.kt:137-142 -> state.processCloseConfirmation, default ASK at :261).
//
//   TerminateRemoteProcessDialog.java:53-64   the part answered without a dialog
//   :66-71                                    the dialog's buttons — Disconnect only when allowed
//   :105                                      which button is default
//   :116-118                                  every process already gone => nothing gets killed
//   :148-151                                  button index -> result
//   :74-84                                    the "don't ask again" write-back
//   TerminalTabCloseListener.kt:87            a terminal marks its process with
//   TerminalCloseConfirmation.kt:19           ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY, which is
//                                             exactly what makes canDisconnect false for it
//   ExecutionBundle.properties:94-100         the titles, the message and the button labels

export type ProcessCloseConfirmation = 'ASK' | 'TERMINATE' | 'DISCONNECT'
export type ProcessCloseResult = 'TERMINATE' | 'DISCONNECT' | 'LEAVE_RUNNING'
export type ProcessCloseChoice = 'terminate' | 'disconnect' | 'cancel'

/**
 * `canDisconnect(handler)` = `!ALWAYS_USE_DEFAULT_STOPPING_BEHAVIOUR_KEY`
 * (TerminateRemoteProcessDialog.java:134-136). A terminal always sets that key
 * (TerminalTabCloseListener.kt:87, TerminalCloseConfirmation.kt:19), so the terminal dialog
 * only ever offers Terminate/Cancel.
 */
export const TERMINAL_CAN_DISCONNECT = false

/**
 * The decision that needs no dialog (:57-64). Returns `'ASK'` when the user has to be asked.
 * Note the source's operator order: `DISCONNECT && !canDisconnect` falls back to TERMINATE.
 */
export function resolveProcessClose(
  setting: ProcessCloseConfirmation,
  canDisconnect: boolean,
): ProcessCloseResult | 'ASK' {
  if (setting === 'ASK') return 'ASK'
  if (setting === 'TERMINATE' || (setting === 'DISCONNECT' && !canDisconnect)) return 'TERMINATE'
  return 'DISCONNECT'
}

/** The buttons of :66-71, in order: Terminate, Disconnect (only when allowed), Cancel. */
export function confirmationChoices(canDisconnect: boolean): ProcessCloseChoice[] {
  return canDisconnect ? ['terminate', 'disconnect', 'cancel'] : ['terminate', 'cancel']
}

/** :105 — `canDisconnect && defaultDisconnect ? 1 : 0`, i.e. Disconnect only by default when it exists. */
export function defaultConfirmationChoice(canDisconnect: boolean, detachIsDefault: boolean): ProcessCloseChoice {
  return canDisconnect && detachIsDefault ? 'disconnect' : 'terminate'
}

/** :148-151 — button 0 terminates, button 1 disconnects when that button exists, else leave running. */
export function confirmationResult(choice: ProcessCloseChoice, canDisconnect: boolean): ProcessCloseResult {
  if (choice === 'terminate') return 'TERMINATE'
  if (choice === 'disconnect' && canDisconnect) return 'DISCONNECT'
  return 'LEAVE_RUNNING'
}

/**
 * :74-84 — "don't ask again" only remembers a real decision: leaving the processes running is
 * not a preference, so it changes nothing.
 */
export function rememberedSetting(result: ProcessCloseResult): ProcessCloseConfirmation | null {
  if (result === 'TERMINATE') return 'TERMINATE'
  if (result === 'DISCONNECT') return 'DISCONNECT'
  return null
}

/**
 * :116-118 — when every process had already terminated while the dialog was open, IDEA answers
 * DISCONNECT: the close proceeds and nothing is killed.
 */
export function resultWhenAllProcessesExited(): ProcessCloseResult {
  return 'DISCONNECT'
}

/** ExecutionBundle.properties:94-100. `null` when there is nothing to ask about. */
export function processClosePromptText(labels: readonly string[]): { title: string; message: string } | null {
  if (!labels.length) return null
  if (labels.length === 1) {
    return {
      title: `进程 “${labels[0]}” 正在运行`,
      message: `要终止进程 “${labels[0]}” 吗？`,
    }
  }
  return {
    title: '进程正在运行',
    message: `要终止以下进程吗：${labels.map(label => `“${label}”`).join('、')}？`,
  }
}

/** `button.terminate` / `button.disconnect` / the shared Cancel string (:97-98, :71). */
export const PROCESS_CLOSE_LABELS: Record<ProcessCloseChoice, string> = {
  terminate: '终止',
  disconnect: '断开连接',
  cancel: '取消',
}
