<script setup lang="ts">
// 「内部错误」指示器（上游 `FatalErrorWidgetFactory`，显示器名 `status.bar.fatal.error.widget.name`
// = 中文包「内部错误」）。宿主 `native/diagnostics.cpp` 的 `event(..., "ERROR", ...)` 顺手记一笔，
// `app.internalErrors` 报出 `{ count, latest }`。
//
// 抽成组件而不是留在 App.vue：那一层贴着机检上限，而这一块自带状态 + 轮询 + 弹层，
// 是"一个完整的指示器"，本来就该独立。
//
// **用户不可开关**是上游的规定（`isConfigurable() = false` 且 `canBeEnabledOn(statusBar) = false`），
// 所以它不进状态栏的勾选清单，只按"有没有错误"自己显形。
//
// 点开的是**错误对话框**（上游 `IdeErrorsDialog`，见 src/components/InternalErrorsDialog.vue +
// src/errorReport.ts 的逐条对照），不是一行弹层 —— 上游那个芯片点开就是重建整个对话框
// （`FatalErrorWidgetFactory` → `IdeErrorsDialog`）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { request } from '../bridge'
import { INTERNAL_ERROR_WIDGET_NAME, internalErrorLabel, latestInternalError, shouldShowInternalErrors, type InternalErrors } from '../internalErrors'
import InternalErrorsDialog from './InternalErrorsDialog.vue'

const props = defineProps<{
  /** 有没有打开工作区（没有就不必问宿主）。 */
  active: boolean
  isDesktop: boolean
  /** 「显示日志」（`ShowLogAction.showLog()`）—— 由宿主注入，指示器自己不碰宿主通道那一层。 */
  showLog: () => unknown
}>()

const errors = ref<InternalErrors | null>(null)
const open = ref(false)
const visible = computed(() => shouldShowInternalErrors(errors.value, props.isDesktop) && props.active)
let timer: number | undefined

/** 只涨不跌的计数：工作区一变拉一次，之后 30s 一次（"IDE 出错了"不需要秒级反馈）。 */
async function refresh() {
  if (!props.isDesktop) return
  try { errors.value = await request<InternalErrors>('app.internalErrors') } catch { /* 旧宿主/预览没有这条路由 */ }
}
watch(() => props.active, () => { void refresh() })
onMounted(() => { void refresh(); timer = window.setInterval(() => void refresh(), 30000) })
onBeforeUnmount(() => { if (timer !== undefined) window.clearInterval(timer) })
</script>

<template>
  <button
    v-if="visible" class="status-chip status-internal-errors"
    :title="`${INTERNAL_ERROR_WIDGET_NAME}：${latestInternalError(errors)}`"
    aria-label="内部错误" :aria-expanded="open"
    @click.stop="open = true; void refresh()"
  >
    <TriangleAlert :size="iconSize.dense" />{{ internalErrorLabel(errors!.count) }}
  </button>
  <InternalErrorsDialog v-if="open && visible && errors" :errors="errors" :show-log="showLog" @close="open = false" />
</template>
