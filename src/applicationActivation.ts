// 应用激活事件 —— 上游 `ApplicationActivationListener`（platform/ide-core/src/com/intellij/openapi/application）
// 在本仓的对应物。
//
// 上游形状：`Topic.AppLevel` 的监听器，三个回调（:20-40）：
//   · `applicationActivated(IdeFrame)`：焦点回到应用；
//   · `applicationDeactivated(IdeFrame)`：焦点离开应用；
//   · `delayedApplicationDeactivated(Window)`：更精确但**有延迟**的一次通知，延迟由
//     registry key `app.deactivation.timeout` 控制（默认 1000ms，源码注释点出这个键）。
//
// 本仓的接线：`src/appearanceActions.ts` 的 `window` focus/blur 监听器（它本来就在维护
// 顶栏激活态）在这里广播；`src/lspNavigation.ts` 的保存链仍走自己那一条，两者互不依赖。
// 监听器注册表与激活状态是纯函数/纯状态，判据在 `tests/application-activation.test.mjs`。

export interface ApplicationActivationListener {
  applicationActivated?: () => void
  applicationDeactivated?: () => void
  delayedApplicationDeactivated?: () => void
}

/** 上游 registry key `app.deactivation.timeout` 的默认值（毫秒）。 */
export const DEACTIVATION_TIMEOUT_MS = 1000

export interface ApplicationActivationState {
  active: boolean
  activations: number
  deactivations: number
  lastActivatedAt: number
  lastDeactivatedAt: number
}

export function createApplicationActivation(now: () => number = () => Date.now()) {
  const listeners = new Set<ApplicationActivationListener>()
  let delayedTimer: ReturnType<typeof setTimeout> | undefined
  const state: ApplicationActivationState = { active: false, activations: 0, deactivations: 0, lastActivatedAt: 0, lastDeactivatedAt: 0 }

  function addApplicationActivationListener(listener: ApplicationActivationListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** 广播一次；监听器自己的异常不打断别人（与 `FileTypeListener` 的广播同口径）。 */
  function broadcast(kind: keyof ApplicationActivationListener) {
    for (const listener of [...listeners]) {
      try { listener[kind]?.() } catch { /* 监听器自己的错误 */ }
    }
  }

  function applicationActivated() {
    if (delayedTimer !== undefined) { clearTimeout(delayedTimer); delayedTimer = undefined }
    state.active = true
    state.activations += 1
    state.lastActivatedAt = now()
    broadcast('applicationActivated')
  }

  function applicationDeactivated() {
    state.active = false
    state.deactivations += 1
    state.lastDeactivatedAt = now()
    broadcast('applicationDeactivated')
    // 延迟通知：窗口又在 1 秒内激活就撤掉（上游 `delayedApplicationDeactivated` 的语义：
    // 短暂失焦不算真正离开，避免误触发重活）。
    if (delayedTimer !== undefined) clearTimeout(delayedTimer)
    delayedTimer = setTimeout(() => {
      delayedTimer = undefined
      if (!state.active) broadcast('delayedApplicationDeactivated')
    }, DEACTIVATION_TIMEOUT_MS)
  }

  function dispose() {
    if (delayedTimer !== undefined) clearTimeout(delayedTimer)
    delayedTimer = undefined
    listeners.clear()
  }

  return { state, addApplicationActivationListener, applicationActivated, applicationDeactivated, dispose }
}

/** 进程内单例（上游 `ApplicationManager` 的 TOPIC 是应用级）。 */
export const applicationActivation = createApplicationActivation()
