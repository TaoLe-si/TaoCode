// 平台消息面的纯模型（`src/messageDialog.ts`）：按钮表 / 模型 / 图标语义 / 「不再询问」的落库规则。
// 上游：`MessageDialogBuilder.kt`、`DoNotAskOption.java`、`MessageType.java`、`ExitActionType.kt`。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DO_NOT_ASK_DEFAULT_LABEL,
  MESSAGE_BUTTON_TEXT,
  MESSAGE_TYPE_ICON,
  messageButtons,
  messageDialogModel,
  shouldRememberChoice,
} from '../src/messageDialog.ts'

test('按钮表：按 ExitActionType 给默认文案，顺序保持给定顺序，文案可覆盖', () => {
  assert.deepEqual(messageButtons(['yes', 'no', 'cancel']), [
    { exit: 'yes', text: '是' }, { exit: 'no', text: '否' }, { exit: 'cancel', text: '取消' },
  ])
  assert.deepEqual(MESSAGE_BUTTON_TEXT, { yes: '是', no: '否', cancel: '取消', ok: '确定' })
  assert.deepEqual(messageButtons(['ok'], { ok: '信任并打开' }), [{ exit: 'ok', text: '信任并打开' }])
})

test('模型：缺省 question 类型、无「不再询问」、不改调用方的数组', () => {
  const buttons = messageButtons(['ok', 'cancel'])
  const model = messageDialogModel({ title: '标题', message: '正文', buttons })
  assert.equal(model.type, 'question')
  assert.equal(model.doNotAsk, null)
  assert.equal(model.saveDoNotAskOnCancel, false)
  assert.deepEqual(model.buttons, buttons)
  assert.notEqual(model.buttons, buttons, '模型持有副本，外部改数组不影响它')
  const warning = messageDialogModel({ title: 't', message: 'm', buttons, type: 'warning', doNotAsk: DO_NOT_ASK_DEFAULT_LABEL, saveDoNotAskOnCancel: false })
  assert.equal(warning.type, 'warning')
  assert.equal(warning.doNotAsk, DO_NOT_ASK_DEFAULT_LABEL)
})

test('图标语义：四种 MessageType 对到四个不同的图标名', () => {
  const names = Object.values(MESSAGE_TYPE_ICON)
  assert.equal(new Set(names).size, 4)
  assert.equal(MESSAGE_TYPE_ICON.error, 'CircleAlert')
  assert.equal(MESSAGE_TYPE_ICON.warning, 'TriangleAlert')
})

test('「不再询问」：没勾/没有框不记；取消默认不记；带 saveOnCancel 的才记', () => {
  const base = { title: 't', message: 'm', buttons: messageButtons(['ok', 'cancel']), doNotAsk: DO_NOT_ASK_DEFAULT_LABEL }
  const plain = messageDialogModel(base)
  assert.equal(shouldRememberChoice(plain, false, 'ok'), false, '没勾选不记')
  assert.equal(shouldRememberChoice(plain, true, 'ok'), true)
  assert.equal(shouldRememberChoice(plain, true, 'cancel'), false, '取消关掉默认不记（DialogWrapper.close 口径）')
  const savable = messageDialogModel({ ...base, saveDoNotAskOnCancel: true })
  assert.equal(shouldRememberChoice(savable, true, 'cancel'), true, 'shouldSaveOptionsOnCancel 才在取消时记')
  const without = messageDialogModel({ title: 't', message: 'm', buttons: messageButtons(['ok']) })
  assert.equal(shouldRememberChoice(without, true, 'ok'), false, 'canBeHidden=false 的框不记')
})
