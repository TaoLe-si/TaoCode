// 内存状态栏部件（IDEA `MemoryUsagePanel`："NNN of MMM M" + 两段进度条，定时刷新）。
// 从 App.vue 拆出（桃 2026-09-26：模块化）；读取宿主进程，浏览器预览下不显示。
//
// 上游读数与画法（`MemoryUsagePanel.java`）：
//   · 文字 = `memory.usage.panel.message.text` = `{0,number,####} of {1,number,####}M`
//     （UIBundle.properties:67），`{0}` = used、`{1}` = max（开了
//     `idea.memory.usage.show.total.memory.estimation` 才是"估算总量"，默认关）。
//   · 进度条：`usedBarLength = maxMem > 0 ? barWidth * usedMem / maxMem : 0`（`:174-176`），
//     下面再垫一条 `allocatedBarLength`（`:175`）——used 段画在 allocated 段之上。
//   · `maxMem == 0`（第一次异步读数还没回来）**不画条**，避免除零（`:174` 的注释）。
//
// 宿主差异（如实登记，见 docs/inventory/verdict-toolwindow-openapi.md 的 MemoryUsagePanel 行）：
// 本仓进程没有 JVM 堆，"used/allocated/max"三个量映射到 `ProcessMemory` 的
// `workingSetMb / privateMb / peakWorkingSetMb`。分母取**历史峰值**而不是堆上限 —— 宿主
// 没有上限这个量，峰值是唯一能当"截至目前用到的最高水位"的量，tooltip 里写明它不是上限。
// 单击强制 GC 那一支**不做**：宿主没有 JVM，也没有等价的强制回收 API（native 侧只有
// `app.memory` 读数，`native/main.cpp:1428-1431`），做一个点了没反应的按钮就是假控件。
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue'
import { request } from './bridge.ts'
import type { ProcessMemory } from './bridge.ts'

export interface MemoryWidgetContext {
  isDesktop: boolean
  powerSaveEnabled: () => boolean
}

/** 进度条的两段占比（0–100）。上游是整数像素除法（`:174-176`），这里取百分比。 */
export interface MemoryGauge {
  usedPercent: number
  allocatedPercent: number
}

/**
 * `MemoryUsagePanel.MemoryUsagePanelImpl.paintComponent`（`:170-177`）的两段条：
 * `maxMem == 0` 时两段都是 0（不画）；allocated 不少于 used（上游先画 allocated 再叠 used）。
 */
export function memoryGauge(used: number, allocated: number, max: number): MemoryGauge {
  if (!(max > 0)) return { usedPercent: 0, allocatedPercent: 0 }
  const clamp = (value: number) => Math.max(0, Math.min(100, (value / max) * 100))
  return { usedPercent: clamp(used), allocatedPercent: clamp(Math.max(allocated, used)) }
}

/** `{0} of {1}M`（UIBundle.properties:67）；数字为空/NaN 时当 0（上游格式化同理）。 */
export function memoryLabel(used: number, max: number): string {
  const clean = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return `${clean(used)} of ${clean(max)}M`
}

/** 三个 host 读数 → 条的分母：工作集、私有提交、历史峰值取最大（峰值通常最大）。 */
export function memoryCeiling(memory: Pick<ProcessMemory, 'workingSetMb' | 'privateMb' | 'peakWorkingSetMb'>): number {
  return Math.max(memory.workingSetMb, memory.privateMb, memory.peakWorkingSetMb)
}

export interface MemoryWidget {
  processMemory: Ref<ProcessMemory | null>
  /** 条的两段占比；没有读数时 null（模板据此不画条）。 */
  memoryBar: ComputedRef<MemoryGauge | null>
  /** 芯片文案（`NNN of MMMM`）。 */
  memoryText: ComputedRef<string>
  refreshMemory: () => Promise<void>
}

export function createMemoryWidget(ctx: MemoryWidgetContext): MemoryWidget {
  const processMemory = ref<ProcessMemory | null>(null)
  let memoryTimer: number | undefined
  async function refreshMemory() {
    if (!ctx.isDesktop || document.hidden || ctx.powerSaveEnabled()) return
    try {
      const memory = await request<ProcessMemory>('app.memory')
      if (memory.available) processMemory.value = memory
    } catch { /* the widget simply keeps its last value */ }
  }
  const memoryBar = computed<MemoryGauge | null>(() => {
    const memory = processMemory.value
    return memory ? memoryGauge(memory.workingSetMb, memory.privateMb, memoryCeiling(memory)) : null
  })
  const memoryText = computed(() => {
    const memory = processMemory.value
    return memory ? memoryLabel(memory.workingSetMb, memoryCeiling(memory)) : ''
  })
  onMounted(() => { if (ctx.isDesktop) { void refreshMemory(); memoryTimer = window.setInterval(() => void refreshMemory(), 5000) } })
  onBeforeUnmount(() => { if (memoryTimer !== undefined) window.clearInterval(memoryTimer) })
  return { processMemory, memoryBar, memoryText, refreshMemory }
}
