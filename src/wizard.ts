// 多步向导框架 —— 上游 `com.intellij.ide.wizard` 的 `Wizard`/`AbstractWizardStepEx` 与
// `com.intellij.ide.util.projectWizard.WizardContext`/`SettingsStep` 的纯逻辑子集。
//
// 上游坐标：
//   · `AbstractWizardStepEx.java:15-70`：每步有稳定 id、标题、`commit(CommitType)`，
//     提交失败抛异常（本仓用 `commit` 的返回值 + 回调表达）；`fireStateChanged()` 广播变更。
//   · `Wizard.java`（`platform/ide-core/.../wizard`）：上一步/下一步/完成的导航与
//     「当前步能否离开」的门禁。
//   · `WizardContext.java:30-75`：向导内共享的属性袋（项目名/路径/构建器），
//     带监听器列表 —— 本仓用 `createWizardContext` 的键值袋 + 订阅。
//
// 本仓落点：`src/components/ProjectDialog.vue` 的新建流程（模板 → 名称与位置 → 审阅），
// 每步用 `src/dialogValidation.ts` 的 ValidationInfo 做门禁；克隆流程仍是单页（没有可分的步）。

import { type ValidationInfo, validateAll } from './dialogValidation.ts'

export type CommitType = 'prev' | 'next' | 'finish'

/** 向导内共享的属性袋（上游 `WizardContext` 的 `get/set` + 监听器）。 */
export interface WizardContext {
  get<T>(key: string): T | undefined
  put<T>(key: string, value: T): void
  has(key: string): boolean
  keys(): string[]
  /** 任何一次 put 都会通知订阅者（上游 `WizardContext` 的 Listener 列表）。 */
  subscribe(listener: () => void): () => void
}

export function createWizardContext(initial: Record<string, unknown> = {}): WizardContext {
  const values = new Map<string, unknown>(Object.entries(initial))
  const listeners = new Set<() => void>()
  return {
    get: key => values.get(key) as never,
    put(key, value) {
      values.set(key, value)
      for (const listener of [...listeners]) listener()
    },
    has: key => values.has(key),
    keys: () => [...values.keys()],
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export interface WizardStep {
  /** 稳定 id（上游 `getStepId()`）；重排步骤时 id 不变，恢复状态才可锚定。 */
  id: string
  title: string
  /** 当前步数据是否合法；null = 可以离开。 */
  validate?(context: WizardContext): ValidationInfo | null
  /** 离开该步时调用（上游 `_commit`/`_commitPrev`）；prev 用于「上一步也要提交」的步骤。 */
  commit?(context: WizardContext, type: CommitType): void
  /** 该步在当前上下文下是否可见（可见步才参与导航）。 */
  isVisible?(context: WizardContext): boolean
}

export interface Wizard {
  readonly context: WizardContext
  /** 当前步的下标（对可见步序列而言）。 */
  current: number
  visibleSteps(): WizardStep[]
  currentStep(): WizardStep
  isFirst(): boolean
  isLast(): boolean
  /** 当前步的校验结果（null = 通过）。 */
  validation(): ValidationInfo | null
  /** 当前步能否点「下一步」/「完成」。 */
  canGoNext(): boolean
  canGoBack(): boolean
  /** 前进（含提交）；不能前进时返回 false 且不动。 */
  next(): boolean
  /** 后退。 */
  back(): boolean
  /** 在最后一步完成。 */
  finish(): boolean
  /** 跳转到指定可见步（越界/不可达时返回 false）。 */
  goTo(index: number): boolean
  /** 当前步标题（每步可覆盖；随导航变化）。 */
  stepTitle(): string
  /** 导航或上下文变化时通知（上游 `StepListener.stateChanged`）。 */
  onChange(listener: () => void): () => void
}

export function createWizard(steps: readonly WizardStep[], context: WizardContext = createWizardContext()): Wizard {
  let current = 0
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of [...listeners]) listener() }
  const visible = () => steps.filter(step => step.isVisible?.(context) !== false)
  const clamp = () => {
    const list = visible()
    if (!list.length) return
    if (current >= list.length) current = list.length - 1
    if (current < 0) current = 0
  }
  const validation = (): ValidationInfo | null => {
    const step = visible()[current]
    return step?.validate?.(context) ?? null
  }
  const report = () => validateAll([validation()])
  clamp()
  context.subscribe(() => { clamp(); notify() })
  return {
    context,
    get current() { clamp(); return current },
    visibleSteps: visible,
    currentStep: () => visible()[current]!,
    isFirst: () => current <= 0,
    isLast: () => current >= visible().length - 1,
    validation,
    canGoNext: () => report().okEnabled,
    canGoBack: () => current > 0,
    next() {
      const step = visible()[current]
      if (!step || !report().okEnabled) return false
      step.commit?.(context, 'next')
      if (current < visible().length - 1) { ++current; notify() }
      return true
    },
    back() {
      if (current <= 0) return false
      visible()[current]?.commit?.(context, 'prev')
      --current
      notify()
      return true
    },
    finish() {
      const step = visible()[current]
      if (!step || !this.isLast() || !report().okEnabled) return false
      step.commit?.(context, 'finish')
      notify()
      return true
    },
    goTo(index) {
      const list = visible()
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return false
      current = index
      notify()
      return true
    },
    stepTitle: () => visible()[current]?.title ?? '',
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
