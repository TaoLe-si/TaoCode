// 平台消息面（`Messages`/`MessageDialogBuilder` + `DoNotAskOption`/`MessageType`/`ExitActionType`）
// 的纯模型 —— 上游坐标：
//   · `MessageDialogBuilder.kt:11-52`：标题 + 正文 + 图标 + 按钮 + `doNotAsk`，
//     静态入口 `yesNo`/`okCancel`/`yesNoCancel` 默认 question 图标、`asWarning()` 换警告图标；
//   · `DoNotAskOption.java:11-88`：复选框文案 `getDoNotShowMessage`（IdeCoreBundle
//     `dialog.options.do.not.ask` = Do not ask again）、`canBeHidden`、`shouldSaveOptionsOnCancel`，
//     以及 `DialogWrapper.close(int)` 的调用规则 —— **取消关掉时默认不记**；
//   · `MessageType.java:15-49`：ERROR/INFO/WARNING/QUESTION 四种图标语义（另有通知配色，
//     本仓的通知配色在 `src/notices.ts`，不在这里重复）；
//   · `ExitActionType.kt:4`：YES/NO/CANCEL/OK/UNDEFINED（UNDEFINED 是「没按按钮」的缺省档，
//     消息框不产生它，故这里不收）。
//
// 本仓现状：对话框逐处手写 `role="alertdialog"` 模态（如 `src/components/TrustedProjectDialog.vue`），
// 没有 `Messages` 服务宿主。这个模块把「标题-正文-按钮-不再询问」的模型与规则抽出来，
// 供各处对话框共用；图标语义给的是 **lucide 组件名**，由消费组件映射成组件（纯模块不引 Vue）。

export type MessageDialogType = 'error' | 'info' | 'warning' | 'question'

/** 上游 `ExitActionType`（去掉 UNDEFINED：消息框不会产生「没按按钮」）。 */
export type ExitActionType = 'yes' | 'no' | 'cancel' | 'ok'

export interface MessageDialogButton {
  text: string
  exit: ExitActionType
}

export interface MessageDialogModel {
  title: string
  message: string
  type: MessageDialogType
  /** 按钮按给定顺序排列，默认按钮由调用方标记（本仓的对话框都是显式按钮顺序）。 */
  buttons: MessageDialogButton[]
  /** 「不再询问」的复选框文案；null = 这个框没有该复选框（上游 `canBeHidden() == false`）。 */
  doNotAsk: string | null
  /** 上游 `shouldSaveOptionsOnCancel()`：取消关掉时也把勾选状态记下来。 */
  saveDoNotAskOnCancel: boolean
}

/** `CommonBundle` 的四个按钮文案（本仓界面语言）。 */
export const MESSAGE_BUTTON_TEXT: Record<ExitActionType, string> = {
  yes: '是', no: '否', cancel: '取消', ok: '确定',
}

/** 上游 `DoNotAskOption.Adapter.getDoNotShowMessage` 的默认文案。 */
export const DO_NOT_ASK_DEFAULT_LABEL = '不再询问'

/** 消息类型 → 默认图标（lucide 组件名；`MessageType` 的四种语义）。 */
export const MESSAGE_TYPE_ICON: Record<MessageDialogType, string> = {
  error: 'CircleAlert', info: 'Info', warning: 'TriangleAlert', question: 'CircleHelp',
}

/** 按 `ExitActionType` 列表造按钮（`MessageDialogBuilder.yesNoCancel()` 一族的等价物），文案可覆盖。 */
export function messageButtons(exits: readonly ExitActionType[], text: Partial<Record<ExitActionType, string>> = {}): MessageDialogButton[] {
  return exits.map(exit => ({ exit, text: text[exit] ?? MESSAGE_BUTTON_TEXT[exit] }))
}

/** 组一个消息框模型：`type` 缺省 question（上游 `yesNo`/`okCancel`/`yesNoCancel` 的默认图标）。 */
export function messageDialogModel(options: {
  title: string
  message: string
  buttons: readonly MessageDialogButton[]
  type?: MessageDialogType
  doNotAsk?: string | null
  saveDoNotAskOnCancel?: boolean
}): MessageDialogModel {
  return {
    title: options.title,
    message: options.message,
    type: options.type ?? 'question',
    buttons: [...options.buttons],
    doNotAsk: options.doNotAsk ?? null,
    saveDoNotAskOnCancel: options.saveDoNotAskOnCancel === true,
  }
}

/**
 * `DialogWrapper.close(int)` 对 `DoNotAskOption.rememberChoice` 的调用规则：
 * 没勾 / 没有这个复选框 → 不记；**取消关掉时不记**（除非 `shouldSaveOptionsOnCancel`）。
 * 返回值 = 这次选择要不要写进持久状态。
 */
export function shouldRememberChoice(model: MessageDialogModel, selected: boolean, exit: ExitActionType): boolean {
  if (!model.doNotAsk || !selected) return false
  if (exit === 'cancel' && !model.saveDoNotAskOnCancel) return false
  return true
}
