// Composer 草稿空态的问候语：按时段选一句 + 按可用宽度收缩字号。
//
// 为什么单独一个模块：`AgentPanel.vue` 顶在 900 行机检上限（`tests/module-size.test.mjs`），
// 而「问候语什么时候换、字号能多大」与「面板怎么接线」不共一个职责域 —— 这一层只认
// 「现在几点」「容器有多宽」，不碰消息流、会话库与宿主。
//
// 上游出处：`ConversationDraftEmptyState.tsx:29-35`（六个时段边界 + office 覆盖，
// 键表见 `src/agentComposerLayout.ts` 的 COMPOSER_EMPTY_STATES.draftGreeting）；字号贴合
// 是本仓的测量实现（空态标题 30px 起步，最窄缩到 20px，量不出来就退回 30px）。
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'

/** 字号初值 / 上限（够宽时就是它）。 */
const GREETING_FONT_MAX = 30
/** 字号下限：更窄宁可换行（截断成 19px 反而读不清）。 */
const GREETING_FONT_MIN = 20

export interface AgentComposerGreeting {
  /** 按时段算出的问候语（无项目时用 office 那一句）。 */
  text: ComputedRef<string>
  /** 贴合后的字号（px），模板写成 `--greeting-font-size`。 */
  fontSize: Ref<number>
  /** 量可用宽度的容器与量自然宽度的那一份（模板 ref）。 */
  container: Ref<HTMLParagraphElement | undefined>
  measurement: Ref<HTMLSpanElement | undefined>
  /** 挂载时调用：起时段定时器（测量观察者随模板 ref 自动接管）。 */
  start(): void
  /** 卸载时调用：定时器 / 观察者 / 待处理帧全部收摊。 */
  stop(): void
}

/**
 * 建一份问候语状态机。
 * `projectRoot` 传 getter：换工作区时「有没有项目」直接影响用哪句文案。
 * `copy` 是文案表查询（键不存在给 undefined，这里不编文案）。
 */
export function createAgentComposerGreeting(input: {
  projectRoot: () => string
  copy: (key: string) => string | undefined
}): AgentComposerGreeting {
  const date = ref(new Date())
  const text = computed(() => {
    if (!input.projectRoot()) return input.copy('chat.empty.greeting.office') ?? ''
    const hour = date.value.getHours()
    const key = (hour >= 5 && hour < 9) ? 'chat.empty.greeting.morningEarly'
      : (hour >= 9 && hour < 12) ? 'chat.empty.greeting.morning'
        : (hour >= 12 && hour < 14) ? 'chat.empty.greeting.noon'
          : (hour >= 14 && hour < 18) ? 'chat.empty.greeting.afternoon'
            : (hour >= 18 && hour < 23) ? 'chat.empty.greeting.evening' : 'chat.empty.greeting.lateNight'
    return input.copy(key) ?? ''
  })
  const fontSize = ref(GREETING_FONT_MAX)
  const container = ref<HTMLParagraphElement>()
  const measurement = ref<HTMLSpanElement>()
  let timer: number | undefined
  let frame: number | null = null
  let observer: ResizeObserver | undefined
  let resizeFallback = false

  /** 到下一个时段边界还要多久（跨天取明早 5 点）。 */
  function nextDelay(now: Date): number {
    const boundary = [5, 9, 12, 14, 18, 23].map(hour => {
      const candidate = new Date(now)
      candidate.setHours(hour, 0, 0, 0)
      return candidate
    }).find(candidate => candidate.getTime() > now.getTime())
    if (boundary) return Math.max(1, boundary.getTime() - now.getTime())
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(5, 0, 0, 0)
    return Math.max(1, tomorrow.getTime() - now.getTime())
  }

  function scheduleUpdate() {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      date.value = new Date()
      scheduleUpdate()
    }, nextDelay(date.value))
  }

  function measure() {
    frame = null
    const box = container.value
    const naturalSpan = measurement.value
    if (!box || !naturalSpan) return
    const style = window.getComputedStyle(box)
    const available = Math.max(0, box.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    const natural = naturalSpan.getBoundingClientRect().width
    fontSize.value = !Number.isFinite(available) || !Number.isFinite(natural) || available <= 0 || natural <= 0 || available >= natural
      ? GREETING_FONT_MAX
      : Math.max(GREETING_FONT_MIN, Math.min(GREETING_FONT_MAX, Math.floor(GREETING_FONT_MAX * available / natural)))
  }

  function scheduleMeasure() {
    if (frame !== null) return
    frame = window.requestAnimationFrame(measure)
  }

  watch([container, measurement, text], async () => {
    await nextTick()
    const box = container.value
    const naturalSpan = measurement.value
    observer?.disconnect()
    if (resizeFallback) window.removeEventListener('resize', scheduleMeasure)
    resizeFallback = false
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
    if (!box || !naturalSpan) return
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer ??= new ResizeObserver(scheduleMeasure)
      observer.observe(box)
      observer.observe(naturalSpan)
    } else {
      window.addEventListener('resize', scheduleMeasure)
      resizeFallback = true
    }
  }, { flush: 'post', immediate: true })
  watch(input.projectRoot, () => { date.value = new Date() })

  return {
    text,
    fontSize,
    container,
    measurement,
    start() { scheduleUpdate() },
    stop() {
      window.clearTimeout(timer)
      observer?.disconnect()
      if (resizeFallback) window.removeEventListener('resize', scheduleMeasure)
      if (frame !== null) window.cancelAnimationFrame(frame)
    },
  }
}
