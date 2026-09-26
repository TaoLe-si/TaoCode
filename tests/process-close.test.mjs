import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROCESS_CLOSE_LABELS, TERMINAL_CAN_DISCONNECT, confirmationChoices, confirmationResult,
  defaultConfirmationChoice, processClosePromptText, rememberedSetting, resolveProcessClose,
  resultWhenAllProcessesExited,
} from '../src/processClose.ts'

// TerminateRemoteProcessDialog.java:134-136 + TerminalTabCloseListener.kt:87.
test('a terminal can never be disconnected', () => {
  assert.equal(TERMINAL_CAN_DISCONNECT, false)
})

// :57-64 — the three answers that need no dialog, including the source's operator order
// (DISCONNECT without the ability to disconnect falls back to TERMINATE).
test('the setting answers without a dialog except when it asks', () => {
  assert.equal(resolveProcessClose('ASK', true), 'ASK')
  assert.equal(resolveProcessClose('ASK', false), 'ASK')
  assert.equal(resolveProcessClose('TERMINATE', true), 'TERMINATE')
  assert.equal(resolveProcessClose('TERMINATE', false), 'TERMINATE')
  assert.equal(resolveProcessClose('DISCONNECT', true), 'DISCONNECT')
  assert.equal(resolveProcessClose('DISCONNECT', false), 'TERMINATE', 'DISCONNECT && !canDisconnect terminates')
})

// :66-71 — the Disconnect button only exists when the process allows it.
test('the dialog offers Disconnect only when it is allowed', () => {
  assert.deepEqual(confirmationChoices(true), ['terminate', 'disconnect', 'cancel'])
  assert.deepEqual(confirmationChoices(false), ['terminate', 'cancel'])
  assert.deepEqual(confirmationChoices(TERMINAL_CAN_DISCONNECT), ['terminate', 'cancel'], 'the terminal dialog')
})

// :105 — `canDisconnect && defaultDisconnect ? 1 : 0`.
test('the default button is Disconnect only when it exists and the process prefers detaching', () => {
  assert.equal(defaultConfirmationChoice(true, true), 'disconnect')
  assert.equal(defaultConfirmationChoice(true, false), 'terminate')
  assert.equal(defaultConfirmationChoice(false, true), 'terminate')
  assert.equal(defaultConfirmationChoice(false, false), 'terminate')
})

// :148-151 — button index to result, where index 1 is Cancel once Disconnect is gone.
test('the chosen button maps onto the result', () => {
  assert.equal(confirmationResult('terminate', true), 'TERMINATE')
  assert.equal(confirmationResult('terminate', false), 'TERMINATE')
  assert.equal(confirmationResult('disconnect', true), 'DISCONNECT')
  assert.equal(confirmationResult('disconnect', false), 'LEAVE_RUNNING', 'no such button without canDisconnect')
  assert.equal(confirmationResult('cancel', true), 'LEAVE_RUNNING')
  assert.equal(confirmationResult('cancel', false), 'LEAVE_RUNNING')
})

// :74-84 — "don't ask again" remembers a decision, and leaving them running is not one.
test('only a real decision is remembered from the dialog', () => {
  assert.equal(rememberedSetting('TERMINATE'), 'TERMINATE')
  assert.equal(rememberedSetting('DISCONNECT'), 'DISCONNECT')
  assert.equal(rememberedSetting('LEAVE_RUNNING'), null)
})

// :116-118 — everything finished while the dialog was open: the close proceeds, nothing is killed.
test('processes that finished while the dialog was open are not killed', () => {
  assert.equal(resultWhenAllProcessesExited(), 'DISCONNECT')
})

// ExecutionBundle.properties:94-100 — the singular and plural wordings.
test('the prompt uses the source wording for one process and for several', () => {
  assert.deepEqual(processClosePromptText(['终端 1']), {
    title: '进程 “终端 1” 正在运行',
    message: '要终止进程 “终端 1” 吗？',
  })
  assert.deepEqual(processClosePromptText(['终端 1', '运行']), {
    title: '进程正在运行',
    message: '要终止以下进程吗：“终端 1”、“运行”？',
  })
  assert.equal(processClosePromptText([]), null, 'nothing running means no dialog at all')
})

test('the buttons carry the source labels', () => {
  assert.equal(PROCESS_CLOSE_LABELS.terminate, '终止')
  assert.equal(PROCESS_CLOSE_LABELS.disconnect, '断开连接')
  assert.equal(PROCESS_CLOSE_LABELS.cancel, '取消')
})
