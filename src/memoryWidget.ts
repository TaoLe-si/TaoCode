// 内存状态栏部件（IDEA MemoryUsagePanel："NNN of MMM M"，定时刷新）。
// 从 App.vue 拆出（桃 2026-09-26：模块化）；读取宿主进程，浏览器预览下不显示。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { request } from './bridge'
import type { ProcessMemory } from './bridge'

export interface MemoryWidgetContext {
  isDesktop: boolean
  powerSaveEnabled: () => boolean
}

export function createMemoryWidget(ctx: MemoryWidgetContext) {
  const processMemory = ref<ProcessMemory | null>(null)
  let memoryTimer: number | undefined
  async function refreshMemory() {
    if (!ctx.isDesktop || document.hidden || ctx.powerSaveEnabled()) return
    try {
      const memory = await request<ProcessMemory>('app.memory')
      if (memory.available) processMemory.value = memory
    } catch { /* the widget simply keeps its last value */ }
  }
  onMounted(() => { if (ctx.isDesktop) { void refreshMemory(); memoryTimer = window.setInterval(() => void refreshMemory(), 5000) } })
  onBeforeUnmount(() => { if (memoryTimer !== undefined) window.clearInterval(memoryTimer) })
  return { processMemory, refreshMemory }
}
