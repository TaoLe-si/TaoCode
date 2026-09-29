import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { ROW_H } from './vcsLogGraph'
export function useLogViewport(element: Ref<HTMLElement | undefined>, count: Ref<number>, more: () => void) {
  const top = ref(0), height = ref(0), width = ref(0)
  const start = computed(() => Math.max(0, Math.min(count.value, Math.floor(top.value / ROW_H) - 8)))
  const end = computed(() => Math.min(count.value, start.value + Math.ceil(height.value / ROW_H) + 16))
  function update() {
    const node = element.value
    if (!node) return
    top.value = node.scrollTop; height.value = node.clientHeight
    if (height.value > 0 && top.value + height.value >= count.value * ROW_H - ROW_H * 6) more()
  }
  let observer: ResizeObserver | undefined
  onMounted(() => { observer = new ResizeObserver(update); if (element.value) observer.observe(element.value); update() })
  watch(count, async (value, previous) => {
    if (value < previous && element.value) element.value.scrollTop = 0
    await nextTick(); update()
  })
  onBeforeUnmount(() => observer?.disconnect())
  async function reveal(index: number) {
    const node = element.value
    if (!node || index < 0) return
    if (index * ROW_H < node.scrollTop) node.scrollTop = index * ROW_H
    else if ((index + 1) * ROW_H > node.scrollTop + node.clientHeight) node.scrollTop = (index + 1) * ROW_H - node.clientHeight
    update(); await nextTick()
  }
  return { start, end, update, reveal, width }
}
