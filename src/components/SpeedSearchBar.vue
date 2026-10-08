<script setup lang="ts">
// 速度搜索的**搜索框**（IDEA `SpeedSearchBase` 里那条浮在列表上的小输入框）。
// 除了展示与回抛，它自己负责「打开时把焦点收进框、关闭时交回列表」这一档 ——
// 这是上游搜索框的生命周期：打开后逐字符**追加**（`SpeedSearchBase.java:730-744` +
// `SpeedSearch.java:43-45` `updatePattern(myString + letter)`），收起时焦点交回列表
// （`:964-975`/`:976-980`）。原先这一档散在宿主里（FileTree 手动 `.focus()` 一次），
// 书签/日志两处「打字即开」漏了这一步 ⇒ 焦点仍留在列表容器，每敲一个字符都重新走容器的
// keydown 把 `:value` 覆盖成**最后一个**字符，多字符的追加丢掉。收进共享件后一并补上。
import { nextTick, ref, watch } from 'vue'
import { SPEED_SEARCH_HINT } from '../speedSearch'

const props = defineProps<{ open: boolean; query: string }>()
defineEmits<{ input: [value: string]; keydown: [event: KeyboardEvent] }>()

const input = ref<HTMLInputElement>()
/** 打开前焦点所在的元素（通常是那一张列表容器）：关闭时把焦点交回它（上游「收起即回列表」）。 */
let returnFocus: HTMLElement | null = null
watch(() => props.open, async opened => {
  // SSR / 无 DOM 环境（渲染判据）里不碰 document，否则 renderToString 会抛。
  if (typeof document === 'undefined') return
  if (opened) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    const el = input.value
    if (!el) return
    el.focus()
    // 光标放到串尾：书签/日志的「打字即开」已把第一个字符塞进 `:value`，光标在尾才接得上后续输入（追加）。
    const end = el.value.length
    el.setSelectionRange(end, end)
  } else {
    // 关闭时输入框随 `v-if` 移除，焦点掉回 body —— 把它交回打开前那一张列表（上游「收起即回列表」）。
    // 只在焦点确实掉空时才回，避免与已在框外显式安排焦点的宿主（FileTree 的 model.focus）抢焦点。
    const active = document.activeElement
    if (returnFocus?.isConnected && (active === document.body || active === null)) returnFocus.focus()
    returnFocus = null
  }
})
</script>

<template>
  <div v-if="open" class="speed-search">
    <input
      ref="input"
      class="speed-search-input" :value="query" :placeholder="SPEED_SEARCH_HINT" :aria-label="SPEED_SEARCH_HINT"
      spellcheck="false" @input="$emit('input', ($event.target as HTMLInputElement).value)"
      @keydown="$emit('keydown', $event)"
    />
  </div>
</template>

<style scoped>
.speed-search { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); background: var(--panel); }
.speed-search-input { width: 100%; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font-size: 11px; }
</style>
