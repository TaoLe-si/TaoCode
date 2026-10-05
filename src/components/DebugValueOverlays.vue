<script setup lang="ts">
// 变量行的两个**值浮窗**，共一个挂载点：
//   · 检查值 —— 上游 `XInspectAction.java:22-30` → `XInspectDialog`（`DebugInspectWindow.vue`）；
//   · 与剪贴板比较 —— 上游 `XCompareWithClipboardAction.java:31-36`（`DebugClipboardCompare.vue`）。
//
// 为什么合成一个组件：两个动作的**入口**都在变量行的行动作弹层（`src/debugRowActions.ts`），
// 而弹层的宿主是 `DebugPanel.vue` —— 那个文件贴着机检上限（900），不该为两个浮窗各背一份
// 状态与两段模板。所以本组件只做一件事：**给定一个 overlay 描述，挂出对应那个浮窗**。
// 描述的字段直接从行动作的目标里来（同一个 `DebugRowActionTarget`），
// 于是 DebugPanel 那边只要一个 `ref`，`pickRowAction` 里两行 `return`。
//
// 「检查」与「比较」互斥：上游两个动作都是从右键菜单各开各的，本仓把它们收成同一档
// （弹层本身一次只开一个，所以同一时刻最多一个 overlay 是真的，不需要额外的仲裁状态）。
import DebugInspectWindow from './DebugInspectWindow.vue'
import DebugClipboardCompare from './DebugClipboardCompare.vue'
import type { DebugDataViewOptions } from '../debugDataView'

/** 与 `src/debugRowActions.ts` 的 `DebugRowActionTarget` 里 `inspect`/`compare-clipboard` 两档对齐。 */
export type DebugValueOverlayMode = 'inspect' | 'compare-clipboard'
export interface DebugValueOverlay {
  mode: DebugValueOverlayMode
  /** 节点显示名（检查值窗口的标题、`DiffView` 的标题都用它）。 */
  name: string
  /** 行上的值文本 —— 「与剪贴板比较」拿它做右侧。 */
  value: string
  /** 检查值窗口的根：DAP `variablesReference`（适配器给的值容器）。 */
  reference: number
}

const props = defineProps<{
  overlay: DebugValueOverlay | null
  /** 数据视图选项（隐藏 null / 排序 / 分组 / 按数组显示），与 Variables 视图同一份。 */
  options?: DebugDataViewOptions | null
  /** 停住次数：每次暂停 +1 ⇒ 检查值窗口重建树（上游 `XInspectDialog.java:59-63`）。 */
  generation?: number
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <DebugInspectWindow
    v-if="overlay?.mode === 'inspect'" :reference="overlay.reference" :name="overlay.name"
    :options="props.options" :generation="props.generation" @close="emit('close')"
  />
  <DebugClipboardCompare
    v-else-if="overlay?.mode === 'compare-clipboard'" :name="overlay.name" :value="overlay.value"
    @close="emit('close')"
  />
</template>
