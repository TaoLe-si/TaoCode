// 动效令牌的 **JS 侧读出口**。数值真源仍然只有 src/tokens.css 一处 —— CSS 那边直接写
// var(--dur-2)；但 motion-v 是跑在 JS 里的，`transition: { duration }` 收不到 `var()`，
// 以前 App.vue 是手抄的 `0.1` / `0.16` / `[0.16, 1, 0.3, 1]`，令牌一改它就悄悄对不上。
// 这里在模块加载时从 computed style 取一次真值，转成 motion-v 要的单位（秒 / 四元组）。
//
// 为什么不是每次读：getComputedStyle 会触发样式重算，而 motion-v 的 transition 对象在
// 渲染路径上被反复构造，没有理由每次都付这个代价 —— 令牌在一个进程的生命周期里不变。

const FALLBACK_MS = {
  '--dur-1': 120,
  '--dur-2': 180,
  '--dur-submenu': 160,
  '--dur-theme-reveal': 560,
  '--dur-spin': 1100,
} as const

/** 读一个时长自定义属性，返回**秒**（motion-v 的单位）。取不到就退回 fallbacks[name]。 */
function cssSeconds(name: keyof typeof FALLBACK_MS): number {
  const fallback = FALLBACK_MS[name]
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback / 1000
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback / 1000
  // tokens.css 里写的是 `120ms` / `1.1s` 两种单位，都按后缀换算。
  const value = raw.endsWith('ms')
    ? Number.parseFloat(raw)
    : raw.endsWith('s')
      ? Number.parseFloat(raw) * 1000
      : Number.parseFloat(raw)
  return Number.isFinite(value) && value >= 0 ? value / 1000 : fallback / 1000
}

function cssBezier(name: string, fallback: readonly [number, number, number, number]) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(raw)
  if (!m) return fallback
  const nums = m.slice(1, 5).map(Number)
  return nums.every(n => Number.isFinite(n)) ? (nums as [number, number, number, number]) : fallback
}

/**
 * 反馈类两档，语义与 tokens.css 里写的一致：
 * - `feedback`（--dur-1，120ms）：hover / 按下这类**用户已经等过**的微交互。
 * - `state`（--dur-2，180ms）：状态切换（浮层进出、箭头翻转、面板入场）。
 *
 * 进场用 state、离场用 feedback 是有意的：离场比进场快一档是通行做法 —— 关闭的瞬间就该
 * 让开，走满进场时长会让人觉得"没关掉"。
 */
export const motionDurations = {
  feedback: cssSeconds('--dur-1'),
  state: cssSeconds('--dur-2'),
  submenu: cssSeconds('--dur-submenu'),
  themeReveal: cssSeconds('--dur-theme-reveal'),
  spin: cssSeconds('--dur-spin'),
} as const

/** 与 `--ease` 同源的缓动四元组（motion-v 收数组，不收字符串）。 */
export const motionEase = cssBezier('--ease', [0.16, 1, 0.3, 1])

/** 循环动效的匀速档；配套 `--ease-linear`，理由见 tokens.css。 */
export const motionEaseLinear = cssBezier('--ease-linear', [0, 0, 1, 1])