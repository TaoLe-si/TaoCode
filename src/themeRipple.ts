// 主题切换的水纹：从**点击位置**扩散的一圈，逐渐把界面变亮（切到月之亮面）或变暗（切到月之暗面）。
//
// 为什么自己写而不是用现成的：项目里已装的 motion-v 有过渡，但那套是"元素自己动"，
// 而这里是**整屏底色**从点击点扩散 —— 需要一个 fixed 定位、盖住视口的圆，
// 动画结束后自己删掉。现成的库没有这个形状。
//
// 无障碍：尊重 `prefers-reduced-motion` —— 用户在系统里关了动画，这里就**什么都不做**，
// 不是"缩短一点"，是不做（硬规则：本仓对可访问性不省事）。
export type ThemeTarget = 'light' | 'dark'

/** 涟漪从点击点扩到"能盖住整个视口"所需的半径。 */
export function rippleRadius(point: { x: number; y: number }, viewport: { width: number; height: number }): number {
  const dx = Math.max(point.x, viewport.width - point.x)
  const dy = Math.max(point.y, viewport.height - point.y)
  // 四个角里最远的那个在「远的那一侧 x」×「远的那一侧 y」上，距离就是 hypot(dx, dy)
  // —— 不是 max(dx,dy)：后者在视口不是正方形时盖不住角。
  // +1 容差把最后一像素也盖住，免得边角漏出旧主题。
  return Math.hypot(dx, dy) + 1
}

/** 点击落在视口外（理论上不会）时退化到中心，避免算出 NaN 半径。 */
function normalizePoint(event: { clientX: number; clientY: number }, viewport: { width: number; height: number }) {
  const x = Number.isFinite(event.clientX) ? event.clientX : viewport.width / 2
  const y = Number.isFinite(event.clientY) ? event.clientY : viewport.height / 2
  return { x, y }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function targetBackground(): string {
  if (typeof document === 'undefined') return '#ffffff'
  // 换完主题再取：`:root[data-theme=…]` 里的 `--editor` 已经是**目标主题**的底色，
  // 所以圆圈用的就是这个色 —— 亮色主题铺亮底（看起来在变亮），暗色主题铺暗底（在变暗）。
  // 不在这里硬编码两套色值，主题改了也不用同步。
  const value = getComputedStyle(document.documentElement).getPropertyValue('--editor').trim()
  return value || (document.documentElement.getAttribute('data-theme') === 'dark' ? '#22252c' : '#f7f8fa')
}

/**
 * 播一圈水纹。`event` 给点击位置，`target` 决定这一圈是"变亮"还是"变暗"。
 *
 * 返回 true 表示真的播了动画（便于测试与调用方判断），false 表示被 reduced-motion 挡掉了。
 */
export function themeRipple(event: { clientX: number; clientY: number } | null, target: ThemeTarget): boolean {
  if (typeof document === 'undefined') return false
  if (prefersReducedMotion()) return false

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const point = normalizePoint(event ?? { clientX: Number.NaN, clientY: Number.NaN }, viewport)
  const size = rippleRadius(point, viewport) * 2

  const circle = document.createElement('div')
  circle.className = `theme-ripple to-${target}`
  circle.setAttribute('aria-hidden', 'true')
  circle.style.left = `${point.x}px`
  circle.style.top = `${point.y}px`
  circle.style.width = `${size}px`
  circle.style.height = `${size}px`
  circle.style.background = targetBackground()
  // 动画可能因为页面隐藏/节流没跑完 —— 留个兜底移除，别把一个满屏的 div 留在 DOM 里。
  const drop = () => circle.remove()
  circle.addEventListener('animationend', drop, { once: true })
  setTimeout(drop, 900)
  document.body.appendChild(circle)
  return true
}
