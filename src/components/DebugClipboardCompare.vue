<script setup lang="ts">
// 「与剪贴板比较」窗口 —— 上游 `XCompareWithClipboardAction`
// （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/actions/XCompareWithClipboardAction.java:31-36`）
// 的等价物：节点的 value 文本 vs 剪贴板，开一个 diff。
//
// 比对规则在 `src/debugCompareClipboard.ts`（切行 + 复用 `src/diffText.ts` 的行级引擎），
// 呈现直接交给既有的 `DiffView.vue`（保存冲突预览与「对比」视图用的同一个组件）——
// 不另写一套 diff 界面。
import { computed, ref, watch } from 'vue'
import DiffView from './DiffView.vue'
import { readClipboardText } from '../clipboard'
import { generateUnifiedDiff } from '../diffText'
import { clipboardCompare } from '../debugCompareClipboard'

const props = defineProps<{ name: string; value: string; fullValue?: string }>()

const clipboard = ref('')
const note = ref('')

/** 剪贴板在挂载与每次打开时读一次（上游的 `createClipboardVsValue` 也是一次性取值）。 */
async function load() {
  note.value = ''
  try { clipboard.value = await readClipboardText() } catch (caught) {
    clipboard.value = ''
    note.value = caught instanceof Error ? caught.message : String(caught)
  }
}
watch(() => [props.value, props.fullValue], () => { void load() }, { immediate: true })

const compared = computed(() => clipboardCompare({
  clipboard: clipboard.value, value: props.value, name: props.name, fullValue: props.fullValue,
}))
/** unified 视图要的文本形式：左边剪贴板、右边值（同一份切行，别处再切一次就会两处口径打架）。 */
const unified = computed(() => {
  const right = props.fullValue ?? props.value
  return generateUnifiedDiff(
    clipboard.value === '' ? [] : clipboard.value.split('\n'),
    right === '' ? [] : right.split('\n'),
  )
})
</script>

<template>
  <div class="debug-compare">
    <p v-if="note" class="debug-compare-note">{{ note }}</p>
    <DiffView
      :path="compared.title" :rows="compared.rows" :unified="unified"
      :left-text="clipboard" :right-text="fullValue ?? value" closable
      @close="$emit('close')"
    />
  </div>
</template>

<style scoped>
.debug-compare { position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; background: var(--panel); }
.debug-compare-note { margin: 0; padding: var(--space-1) var(--space-2); color: var(--warning); font-size: 11px; }
</style>
