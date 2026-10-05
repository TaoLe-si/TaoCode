// 对话框校验的 DSL —— 上游 `com.intellij.openapi.ui.ValidationInfo` 与
// `openapi/ui/validation/validations.kt`、`OperationUtil.kt`、`ValidationUtil.kt` 的纯逻辑子集。
//
// 上游语义（逐条对齐）：
//   · `ValidationInfo.java:20-70`：message 为空串表示「确实有问题但没什么可显示」；
//     `warning = true` 只是警告；`okEnabled` 决定 OK 按钮是否可用（默认错误档不可用）。
//   · `OperationUtil.kt:14` 的 `and`：前一个校验通过才跑后一个，返回第一个非 null。
//   · `OperationUtil.kt:102-112`：`asWarning()` / `withOKEnabled()` 包一层。
//   · `ValidationUtil.kt:14-28`：`validationErrorFor` 由「取错误消息的函数」造校验。
//
// 本仓落点：`src/wizard.ts` 的每步校验与 `src/components/ProjectDialog.vue` 的
// OK/下一步门禁都走这里；`DialogWrapper.doValidateAll()` 的「多字段错误列表 + OK 可用性」
// 由 `validateAll` 承担。`requestors.kt`（Swing 的 whenTextChanged 订阅面）在本仓由
// Vue 的 computed/watch 直接承担，没有单独的 requestor 对象。

export type ValidationLevel = 'ERROR' | 'WARNING' | 'INFO'

export interface ValidationInfo {
  /** 展示给用户的消息；空串 = 有错但不显示（上游同义）。 */
  message: string
  level: ValidationLevel
  /** OK/下一步是否可用。错误默认 false；警告默认 true。 */
  okEnabled: boolean
}

/** 校验器：数据合法返回 null；不合法返回一条 ValidationInfo。 */
export type Validator<T> = (value: T) => ValidationInfo | null

export function validationError(message: string): ValidationInfo {
  return { message, level: 'ERROR', okEnabled: false }
}

export function validationWarning(message: string): ValidationInfo {
  return { message, level: 'WARNING', okEnabled: true }
}

export function validationInfo(message: string): ValidationInfo {
  return { message, level: 'INFO', okEnabled: true }
}

export function asWarning(info: ValidationInfo): ValidationInfo {
  return { ...info, level: 'WARNING', okEnabled: true }
}

/** 上游 `withOKEnabled()`：即使有这条问题，OK 也可用（用于「提示但不拦」）。 */
export function withOKEnabled(info: ValidationInfo): ValidationInfo {
  return { ...info, okEnabled: true }
}

/** `validationErrorFor`：取消息的函数返回 null 即通过。 */
export function validationErrorFor<T>(getMessage: (value: T) => string | null | undefined): Validator<T> {
  return value => {
    const message = getMessage(value)
    return message ? { message, level: 'ERROR', okEnabled: false } : null
  }
}

/** `validationErrorIf`：谓词为真即失败。 */
export function validationErrorIf<T>(message: string, isInvalid: (value: T) => boolean): Validator<T> {
  return validationErrorFor<T>(value => (isInvalid(value) ? message : null))
}

/** `and`：短路，返回第一条失败（上游 `validate() ?: validation.validate()`）。 */
export function and<T>(...validators: Validator<T>[]): Validator<T> {
  return value => {
    for (const validator of validators) {
      const info = validator(value)
      if (info) return info
    }
    return null
  }
}

export interface ValidationReport {
  /** 全部非空结果，按传入顺序。 */
  infos: ValidationInfo[]
  /** 有阻断性错误（okEnabled === false）时为 false。 */
  okEnabled: boolean
  /** 第一条阻断性错误（没有则第一条任意信息）；全通过为 null。 */
  blocking: ValidationInfo | null
}

/**
 * `DialogWrapper.doValidateAll()` 的等价物：把各字段的校验结果汇成
 * 「错误列表 + OK 是否可用」。警告不拦 OK；`withOKEnabled` 过的错误也不拦。
 */
export function validateAll(infos: (ValidationInfo | null | undefined)[]): ValidationReport {
  const present = infos.filter((info): info is ValidationInfo => Boolean(info))
  return {
    infos: present,
    okEnabled: present.every(info => info.okEnabled),
    blocking: present.find(info => !info.okEnabled) ?? null,
  }
}

/** 只取要显示的消息（空串不显示，上游「blank message」语义）。 */
export function validationMessages(report: ValidationReport): string[] {
  return report.infos.map(info => info.message).filter(Boolean)
}
