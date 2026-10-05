// 标签上的**提醒态**（IDEA `TabInfo.alert` / `blink`）—— 上游 `ui/tabs` 里唯一还没落的那组可见态。
//
// 上游语义（逐行对到本机参考树）：
//   · `TabInfo.fireAlert()`（`:301-304`）：置 `isAlertRequested = true` 并 fire `ALERT_STATUS`
//     → `JBTabsImpl.updateAttraction(tabInfo, true)`（`:1810-1813`）把它加进 `attractions`
//     集合并启动动画（`Animator`，2 帧 / 500ms，`JBTabsImpl.kt:399-409`）。
//   · `TabLabel.repaintAttraction()`（`:640-690`）逐帧实现两段预算：
//       前 5 次（`maxInitialBlinkCount`）闪烁，到第 5 次 `resetAlertRequest()`（只清 requested，
//       不清 blinkCount，也不离开 attractions）→ 图标层被 `setLayerEnabled(1, true)` **常亮**；
//       之后若再 `fireAlert()`，blinkCount 从 5 续到 7（`maxReFireBlinkCount`）再闪两次，
//       到 7 时把计数**拨回 5** —— 这是"再次提醒只闪两下"的出处。
//   · `TabInfo.stopAlerting()`（`:306-309`）：清 requested 并 fire `ALERT_STATUS false`
//     → `updateAttraction(tabInfo, false)`（`:1910-1925`）移出集合、`blinkCount = 0`、图标层关闭。
//     真实调用点是**选中该标签时**（`GridCellImpl.selectionChanged`，`:100-107`）。
//   · 触发者是内容标签的**输出/完成**：`RunnerContentUi.processBounce`（`:587-603`）与
//     `DebuggerSessionTabBase.attachNotificationTo`（`:65-70`）—— 所以本仓把提醒接在
//     底部面板的「运行 / 调试」内容标签上：进程结束、调试器停下且那两个内容**没被选中**时提醒，
//     选中即停（与上游 `newSelection.stopAlerting()` 同一处语义）。
//
// 这里只放状态机与注册表（纯函数可单测）；渲染在 `App.vue` 的底部标签上。
import { ref, type Ref } from 'vue'

/** `TabLabel.repaintAttraction` 的两个预算（`:660-661`）。 */
export const MAX_INITIAL_BLINK_COUNT = 5
export const MAX_RE_FIRE_BLINK_COUNT = 7
/** `JBTabsImpl` 的 `Animator("JBTabs Attractions", totalFrames = 2, cycleDuration = 500)`：两帧 = 一次亮/灭。 */
export const BLINK_CYCLE_MS = 500
export const BLINK_FRAME_MS = BLINK_CYCLE_MS / 2

export interface TabAlertState {
  /** 在 `JBTabsImpl.attractions` 集合里（决定图标层是否参与重绘）。 */
  attraction: boolean
  /** `TabInfo.isAlertRequested`：预算没用完时逐帧取反。 */
  requested: boolean
  /** `TabInfo.blinkCount`：跨 `stopAlerting` 归零；`resetAlertRequest` **不**动它。 */
  blinkCount: number
  /** `icon.isLayerEnabled(1)`：提醒图标此刻画不画。 */
  layerEnabled: boolean
}

export function idleTabAlert(): TabAlertState {
  return { attraction: false, requested: false, blinkCount: 0, layerEnabled: false }
}

/** `TabInfo.fireAlert` + `updateAttraction(start=true, :1911-1921)`。 */
export function requestTabAlert(state: TabAlertState = idleTabAlert()): TabAlertState {
  // 已在 attractions 里再 fire：只把 requested 置回 true，**blinkCount 不重置**
  // —— 于是续到 7 就停（`maxReFireBlinkCount` 那支）。
  return { ...state, attraction: true, requested: true }
}

/** `TabInfo.stopAlerting` + `updateAttraction(start=false, :1914-1917)`：计数归零、层关闭。 */
export function stopTabAlert(state: TabAlertState = idleTabAlert()): TabAlertState {
  return { attraction: false, requested: false, blinkCount: 0, layerEnabled: false }
}

/**
 * 一次动画帧（`TabLabel.repaintAttraction`，`:642-690`）。
 * 不在 attractions 里时只做"把层关掉"这一步（`:643-651`）。
 */
export function blinkTabAlert(state: TabAlertState): TabAlertState {
  if (!state.attraction) return state.layerEnabled ? { ...state, layerEnabled: false } : state
  let { requested, blinkCount } = state
  let layerEnabled = state.layerEnabled
  if (blinkCount < MAX_INITIAL_BLINK_COUNT && requested) {
    layerEnabled = !layerEnabled
    blinkCount += 1
    if (blinkCount === MAX_INITIAL_BLINK_COUNT) requested = false
  } else if (blinkCount < MAX_RE_FIRE_BLINK_COUNT && requested) {
    layerEnabled = !layerEnabled
    blinkCount += 1
    if (blinkCount === MAX_RE_FIRE_BLINK_COUNT) { blinkCount = MAX_INITIAL_BLINK_COUNT; requested = false }
  } else {
    // 预算用完：图标层常亮（`icon.setLayerEnabled(1, true)`，`:687-689`）。
    layerEnabled = true
  }
  return { attraction: true, requested, blinkCount, layerEnabled }
}

/** 提醒是否还在闪烁（attractions 里有它且还有待消耗的帧）。 */
export function tabAlertBlinking(state: TabAlertState): boolean {
  return state.attraction && state.requested
}

export interface TabAlertRegistry {
  /** `fireAlert()`：开一次提醒（已在提醒中就续两次闪）。 */
  alert: (key: string) => void
  /** `stopAlerting()`：选中该内容时调用。 */
  stop: (key: string) => void
  /** 当前状态快照（响应式：模板里读它会被动画帧驱动重渲）。 */
  state: (key: string) => TabAlertState
  /** 图标此刻画不画（`layerEnabled`）。 */
  visible: (key: string) => boolean
  /** 是否仍在闪烁（渲染可据此加 class）。 */
  blinking: (key: string) => boolean
  dispose: () => void
}

/**
 * 多标签共用的提醒注册表：只有存在待闪的标签时才跑那条 250ms 的动画定时器
 * （对应上游"`attractions` 空了就 `animator.suspend()`"，`JBTabsImpl.kt:1918-1925`）。
 */
export function createTabAlertRegistry(options: { intervalMs?: number } = {}): TabAlertRegistry {
  const intervalMs = options.intervalMs ?? BLINK_FRAME_MS
  const states = new Map<string, TabAlertState>()
  const version = ref(0)
  // `globalThis` 两种宿主都有：浏览器里是 number，Node（单测）里是 Timeout 对象。
  let timer: ReturnType<typeof setInterval> | undefined

  function stopTimer() {
    if (timer !== undefined) { clearInterval(timer); timer = undefined }
  }
  function frame() {
    let anyAttraction = false
    for (const [key, state] of states) {
      const next = blinkTabAlert(state)
      states.set(key, next)
      if (next.attraction) anyAttraction = true
    }
    version.value++
    if (!anyAttraction) stopTimer()
  }
  function ensureTimer() {
    if (timer === undefined) timer = setInterval(frame, intervalMs)
  }
  function alert(key: string) {
    states.set(key, requestTabAlert(states.get(key) ?? idleTabAlert()))
    version.value++
    ensureTimer()
  }
  function stop(key: string) {
    const state = states.get(key)
    if (!state) return
    states.set(key, stopTabAlert(state))
    version.value++
  }
  const read = (key: string) => { void version.value; return states.get(key) ?? idleTabAlert() }
  return {
    alert,
    stop,
    state: read,
    visible: (key: string) => read(key).layerEnabled,
    blinking: (key: string) => tabAlertBlinking(read(key)),
    dispose: () => { stopTimer(); states.clear(); version.value++ },
  }
}
