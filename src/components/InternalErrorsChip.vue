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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TriangleAlert } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { request } from '../bridge'
import { INTERNAL_ERROR_WIDGET_NAME, internalErrorLabel, latestInternalError, shouldShowInternalErrors, type InternalErrors } from '../internalErrors'

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
    @click.stop="open = !open; void refresh()"
  >
    <TriangleAlert :size="iconSize.dense" />{{ internalErrorLabel(errors!.count) }}
  </button>
  <div v-if="open && visible" class="status-widget-menu internal-errors-menu" role="menu" aria-label="内部错误">
    <span class="status-widget-title">{{ INTERNAL_ERROR_WIDGET_NAME }}</span>
    <p v-for="(row, i) in errors?.latest ?? []" :key="i" class="internal-error-row"><span class="internal-error-time">{{ row.time }}</span><span>{{ row.message }}</span></p>
    <div class="menu-rule" role="separator" />
    <button class="menu-button status-widget-item" role="menuitem" @click="open = false; void showLog()"><span class="menu-item-icon" /><span>显示日志</span></button>
  </div>
  <div v-if="open && visible" class="status-widget-backdrop" @click="open = false" @contextmenu.prevent="open = false" />
</template>
