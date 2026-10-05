import { nextTick } from 'vue'

export type ThemeTarget = 'light' | 'dark'

type ThemeTransition = {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition(): void
}

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => ThemeTransition
}

let activeTransition: ThemeTransition | undefined
let generation = 0

/** 涟漪从点击点扩到能盖住整个视口所需的半径（含边角的一像素容差）。 */
export function rippleRadius(point: { x: number; y: number }, viewport: { width: number; height: number }): number {
  const dx = Math.max(point.x, viewport.width - point.x)
  const dy = Math.max(point.y, viewport.height - point.y)
  return Math.hypot(dx, dy) + 1
}

/** 键盘触发或无有效点击位置时从中心展开。 */
function normalizePoint(event: { clientX: number; clientY: number; detail?: number } | null, viewport: { width: number; height: number }) {
  const valid = event && event.detail !== 0
    && Number.isFinite(event.clientX) && event.clientX >= 0 && event.clientX <= viewport.width
    && Number.isFinite(event.clientY) && event.clientY >= 0 && event.clientY <= viewport.height
  return valid ? { x: event.clientX, y: event.clientY } : { x: viewport.width / 2, y: viewport.height / 2 }
}

/**
 * 两道降级闸，**都要看**：
 *   1. 系统偏好 `prefers-reduced-motion`（CSS 侧对应 `@media (prefers-reduced-motion: reduce)`）；
 *   2. 应用内省电模式 `html[data-motion='reduced']`（`appearanceActions.ts:224` 写这个属性，
 *      CSS 侧对应 `style.css` 里 `html[data-motion='reduced']` 的全局降级）。
 * 只看第 1 道会漏掉"用户在设置里开了省电"这条路径 —— 水纹是 `startViewTransition` 驱动的一次
 * 560ms 全屏 clip-path 揭示（`style.css` 的 `theme-reveal`），正是省电要停的那种重绘。
 * 省电是用户在应用内能点到的开关，所以它与系统偏好是**同一条语义**，不是两个可叠加的档。
 */
function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.motion === 'reduced') return true
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 揭示真正的新主题快照，而非用纯色圆遮住界面。
 * 调用方必须把主题赋值放进 applyTheme，不能在调用前改变主题。
 * 返回 true 表示已请求原生过渡；API 不可用/减少动态效果时仍立即应用主题。
 */
export function themeRipple(
  event: { clientX: number; clientY: number; detail?: number } | null,
  target: ThemeTarget,
  applyTheme: () => void,
): boolean {
  const current = ++generation
  activeTransition?.skipTransition()
  activeTransition = undefined
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    applyTheme()
    return false
  }

  const root = document.documentElement
  const clear = () => {
    root.classList.remove('theme-transition')
    root.style.removeProperty('--theme-reveal-x')
    root.style.removeProperty('--theme-reveal-y')
    root.style.removeProperty('--theme-reveal-radius')
  }
  clear()
  const transitionDocument = document as TransitionDocument
  if (!transitionDocument.startViewTransition || prefersReducedMotion() || root.dataset.theme === target) {
    applyTheme()
    return false
  }

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const point = normalizePoint(event, viewport)
  root.style.setProperty('--theme-reveal-x', `${point.x}px`)
  root.style.setProperty('--theme-reveal-y', `${point.y}px`)
  root.style.setProperty('--theme-reveal-radius', `${rippleRadius(point, viewport)}px`)
  root.classList.add('theme-transition')

  const update = async () => {
    // skipTransition 不取消待执行的更新回调；旧点击不能覆盖更新的主题选择。
    if (current !== generation) return
    applyTheme()
    // 等 Vue 的主题 watcher、子组件和编辑器样式更新完再捕获新快照。
    await nextTick()
  }

  let transition: ThemeTransition
  try {
    transition = transitionDocument.startViewTransition(update)
  } catch {
    clear()
    applyTheme()
    return false
  }
  activeTransition = transition
  const cleanup = () => {
    if (current !== generation) return
    activeTransition = undefined
    clear()
  }
  // 页面隐藏、快速重入等都可能使 ready 拒绝；主题更新仍由原生更新回调执行。
  void transition.ready.catch(() => transition.skipTransition())
  void transition.updateCallbackDone.catch(() => transition.skipTransition())
  void transition.finished.then(cleanup, cleanup)
  return true
}
