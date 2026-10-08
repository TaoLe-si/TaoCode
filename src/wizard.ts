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

/**
 * 提交被拒绝（上游 `CommitStepException` / `CommitStepCancelledException`）：
 * 上游 `AbstractWizardEx.doNextAction`（`platform/platform-impl/src/com/intellij/ide/wizard/
 * AbstractWizardEx.java:71-92`）在 `_commit` 抛异常时**不前进**，`CommitStepException` 弹错误框、
 * `CommitStepCancelledException` 静默返回。本仓把这两档折成一个带 `silent` 的拒绝对象：
 * `silent === true` 等价于「用户自己取消」（上游 `CommitStepCancelledException`），不报错只停住。
 * `message` 缺省取上游 `unknown.error` 的中文形态（`CommitStepException.java:16-18`）。
 */
export interface CommitStepRejection {
  /** 给用户看的话；`silent` 为真时可省。 */
  message?: string
  /** 静默取消（上游 `CommitStepCancelledException`）：不报错、只是不前进。 */
  silent?: boolean
}

export const COMMIT_UNKNOWN_ERROR = '未知错误'
export const COMMIT_USER_CANCELLED = '用户取消了这一步的提交'

/**
 * 把 `commit` 的返回值归一成拒绝对象（null/undefined = 允许离开）。
 * 只有**带 `message` 或 `silent` 的对象**才算拒绝 —— 上游 `commit` 返回 void，
 * 本仓允许步骤返回一个拒绝对象；其它返回值（例如回调里 `push` 返回的长度）一律当"没拒绝"。
 */
function asRejection(result: void | CommitStepRejection | null | undefined): CommitStepRejection | null {
  if (!result || typeof result !== 'object') return null
  if (result.message === undefined && result.silent === undefined) return null
  return result
}

/** 提交失败时 `next`/`finish` 的结论（上游 `doNextAction` 不前进那两档）。 */
export interface WizardAdvance {
  /** 导航真的发生了吗。 */
  moved: boolean
  /** 提交被拒绝时的拒绝对象（`moved === false` 且提交抛了才有值）。 */
  rejection?: CommitStepRejection
  /** 拒绝时给用户看的话（静默取消为 null）—— 上游 `Messages.showErrorDialog` 那一句。 */
  error: string | null
}

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
  /**
   * 离开该步时调用（上游 `_commit`/`_commitPrev`）；prev 用于「上一步也要提交」的步骤。
   * **返回 `CommitStepRejection` 表示这次提交被拒绝**（上游抛 `CommitStepException`）：
   * 导航不发生，`next`/`back`/`finish` 返回 false 并把拒绝原因带出来。
   */
  commit?(context: WizardContext, type: CommitType): void | CommitStepRejection | null
  /** 该步在当前上下文下是否可见（可见步才参与导航）。 */
  isVisible?(context: WizardContext): boolean
}

/**
 * 一组**互相切换**的子步骤（上游 `AbstractNewProjectWizardMultiStep` /
 * `AbstractNewProjectWizardMultiStepBase`，`platform/platform-impl/src/com/intellij/ide/wizard/`）：
 * 在向导的某一步位置上挂一个「分段按钮」，点哪个就换成哪个子步骤的面板。
 *
 * 上游语义（`:init` 那段 `stepsProperty.afterChange`）：
 *   · 子步骤表变了（插件增删、`isEnabled` 翻转）时重算；
 *   · 新选中的那一档：**新增的档优先**（`oldSteps.isNotEmpty() && addedSteps.isNotEmpty()`），
 *     否则保持当前档、当前档没了才退到第一档（`step !in steps -> steps.keys.first()`）；
 *   · `step` 存在 `PropertiesComponent` 里（`bindStorage("${javaClass.name}.selectedStep")`），
 *     所以换会话还记着上次选的分支。
 *
 * 本仓落点：新建项目向导的「选择模板」步本质就是这一档（模板就是互斥的分支），
 * 但那一处是单列表不是分段按钮 —— 这里把**模型**落下来，供需要分支的步骤复用，
 * 并让 `createWizard` 能把它当一个普通步插进链里（`resolveSubStep`）。
 */
export interface WizardSubSteps {
  /** 子步骤标签（上游 `steps.keys`，顺序即按钮顺序）。 */
  labels: readonly string[]
  /** 当前选中的子步骤标签；空串 = 还没选（上游 `step` 初值 `""`）。 */
  selected: string
  /** 换一个子步骤（上游分段按钮的 `bind(stepProperty)`）；标签不在表里返回 false。 */
  select(label: string): boolean
}

/**
 * 按上游那段 `afterChange` 的判定选下一档：
 * 新增档优先 → 当前档还在就保持 → 否则退第一档。
 * 空表返回空串（上游 `steps.keys.first()` 在空表上会抛，这里如实返回空串不抛）。
 */
export function resolveSubStepSelection(
  previous: readonly string[],
  next: readonly string[],
  current: string,
): string {
  if (!next.length) return ''
  const added = next.filter(label => !previous.includes(label))
  if (previous.length > 0 && added.length > 0) return added[0]!
  if (!current) return next[0]!
  if (!next.includes(current)) return next[0]!
  return current
}

/** 建一个子步骤表（上游 `stepsProperty` + `stepProperty` 的最小面）。 */
export function createSubSteps(initialLabels: readonly string[] = [], selected = ''): WizardSubSteps {
  let labels = [...initialLabels]
  let current = selected || resolveSubStepSelection([], labels, '')
  return {
    get labels() { return labels },
    get selected() { return current },
    select(label) {
      if (!labels.includes(label)) return false
      current = label
      return true
    },
  }
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
  /** 最近一次提交被拒的原因（成功或没提交过为 null）；UI 拿它弹错误框。 */
  lastRejection(): CommitStepRejection | null
  /**
   * 带结论的前进/后退（上游 `doNextAction`/`doPreviousAction` 的等价物）：
   * 提交被拒时 `moved=false` 且 `error` 是给用户的那句话（静默取消为 null）。
   */
  advance(type: CommitType): WizardAdvance
  /** 跳转到指定可见步（越界/不可达时返回 false）。 */
  goTo(index: number): boolean
  /** 当前步标题（每步可覆盖；随导航变化）。 */
  stepTitle(): string
  /** 导航或上下文变化时通知（上游 `StepListener.stateChanged`）。 */
  onChange(listener: () => void): () => void
}

export function createWizard(steps: readonly WizardStep[], context: WizardContext = createWizardContext()): Wizard {
  let current = 0
  let rejection: CommitStepRejection | null = null
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
  /**
   * 跑当前步的提交（上游 `_commit`/`_commitPrev`）：返回 null = 允许离开，
   * 返回拒绝对象 = 这次提交被拒（`CommitStepException` / `CommitStepCancelledException`）。
   */
  const runCommit = (type: CommitType): CommitStepRejection | null => {
    const step = visible()[current]
    if (!step?.commit) return null
    const result = asRejection(step.commit(context, type))
    rejection = result
    return result
  }
  const rejectionError = (rejected: CommitStepRejection): string | null =>
    rejected.silent ? null : rejected.message ?? COMMIT_UNKNOWN_ERROR
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
    next() { return this.advance('next').moved },
    back() { return this.advance('prev').moved },
    finish() { return this.advance('finish').moved },
    lastRejection: () => rejection,
    advance(type) {
      if (type !== 'prev' && !report().okEnabled) return { moved: false, error: null }
      const step = visible()[current]
      if (!step) return { moved: false, error: null }
      if (type === 'prev' && current <= 0) return { moved: false, error: null }
      if (type === 'finish' && !this.isLast()) return { moved: false, error: null }
      const rejected = runCommit(type)
      if (rejected) return { moved: false, rejection: rejected, error: rejectionError(rejected) }
      if (type === 'prev') { --current } else if (current < visible().length - 1) { ++current }
      notify()
      return { moved: true, error: null }
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
