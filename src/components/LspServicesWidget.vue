<script setup lang="ts">
// 状态栏的「语言服务」部件 —— 上游 `lsWidget` 那一族的落点（请求见
// `docs/wiring-requests-2026-10-06-bucket3b.md` 的 W3）。
//   · 汇总条目：`platform/lsp-impl/src/impl/lsWidget/LspWidgetItemsProvider.kt:15-16`
//     （本仓每种语言一条，`src/lsFeaturesWidget.ts:202` 的 `lspWidgetItems`）；
//   · 标签/tooltip/错误标记/存活徽章：`platform/lsp/src/api/lsWidget/LspClientWidgetItem.kt:43-90`、
//     `platform/lang-api/src/com/intellij/platform/lang/lsWidget/LanguageServiceWidgetItem.kt:43-71`；
//   · 分「正在当前文件上运行 / 正在其他文件上运行」两段：`LanguageServiceWidgetItem.kt:53` 的
//     `widgetActionLocation`（本仓 `section`，规则在 `src/lsFeaturesWidget.ts:156`）；
//   · 动作（重启/停止）：`LspClientWidgetItem.kt:115-127` 的 `createStopOrRestartAction()`，
//     执行面在 `src/lsSessionHost.ts:265` 的 `runLspWidgetItemAction`。
// 两处如实的偏差（不装成一致）：
//   · 上游图标是 `LayeredIcon`（错误标记叠在主图标上，`LanguageServiceWidgetItem.kt:57-63`），
//     本仓没有叠图标的等价物 ⇒ 异常停机那一档换成 `CircleAlert`，其余用 `Plug`；
//   · 上游 `createAdditionalInlineActions` 的「看错误输出」（`:129-133`）本部件不画：
//     `item.showErrorOutput` 目前没有宿主通道可跳（语言服务日志在 `showLog`，但那是内部错误面板的动作面），
//     不放假按钮。
import { computed, ref } from 'vue'
import { CircleAlert, Plug, RefreshCw, Square } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import AnchoredMenu from './AnchoredMenu.vue'
import { lspSessionStates } from '../lsSessionState'
import { runLspWidgetItemAction, syncedDocuments, lspWidgetItemFor } from '../lsSessionHost'
import { lspWidgetLine, lspWidgetTooltip, NO_SERVICES, SECTION_CURRENT_FILE, SECTION_OTHER_FILES } from '../lsFeaturesWidget'
import { request } from '../bridge'

const props = defineProps<{ activePath: string | null }>()
const emit = defineEmits<{ (event: 'notify', message: string, error?: boolean): void }>()

const open = ref(false)
const anchor = ref<HTMLButtonElement>()
const point = ref({ x: 0, y: 0 })
const busy = ref(false)

// 一台语言服务一条（状态表 `src/lsSessionState.ts` 的 `lspSessionStates`，写入口两处：
// `src/lspCompletionStartup.ts:41-44` 与 `src/quickDocHost.ts`）⇒ 读得到真状态，不是空壳。
const items = computed(() => {
  const documents = syncedDocuments()
  const options = {
    currentFile: props.activePath,
    content: { isInContent: (path: string) => documents.some(document => document.path === path) },
  }
  return Object.keys(lspSessionStates).map(language => lspWidgetItemFor(language, undefined, options))
})
const line = computed(() => lspWidgetLine(items.value))
const tooltip = computed(() => lspWidgetTooltip(items.value))
const currentSection = computed(() => items.value.filter(item => item.section === 'forCurrentFile'))
const otherSection = computed(() => items.value.filter(item => item.section === 'other'))

function toggle() {
  const box = anchor.value?.getBoundingClientRect()
  if (box) point.value = { x: box.left, y: box.top }
  open.value = !open.value
}
async function run(item: (typeof items.value)[number]) {
  // `stopOrRestart === null` 那一档不发请求、也不画这颗按钮（`src/lsSessionHost.ts:265-266`）。
  if (busy.value) return
  busy.value = true
  try {
    const outcome = await runLspWidgetItemAction(item, {
      request: (method, params) => request(method, params),
      notify: message => emit('notify', message),
    })
    if (outcome === 'failed') open.value = false
  } finally { busy.value = false }
}
</script>

<template>
  <button ref="anchor" class="status-chip status-lsp-services" :class="{ 'has-error': items.some(item => item.isError) }" :aria-expanded="open" :title="tooltip || `语言服务：${NO_SERVICES}`" :aria-label="`语言服务：${line}`" @click.stop="toggle"><CircleAlert aria-hidden="true" v-if="items.some(item => item.isError)" :size="iconSize.dense" /><Plug aria-hidden="true" v-else :size="iconSize.dense" />{{ line }}</button>
  <Teleport to="body">
    <div v-if="open" class="tree-menu-backdrop" @click="open = false" @contextmenu.prevent="open = false" />
    <AnchoredMenu v-if="open" :x="point.x" :y="point.y" role="dialog" aria-label="语言服务">
      <p v-if="!items.length" class="lsp-empty">{{ NO_SERVICES }}</p>
      <template v-else>
        <template v-for="[section, rows] in [[SECTION_CURRENT_FILE, currentSection], [SECTION_OTHER_FILES, otherSection]]" :key="section">
          <template v-if="rows.length">
            <span class="lsp-section">{{ section }}</span>
            <div v-for="item in rows" :key="item.language" class="lsp-row">
              <span class="lsp-name" :title="item.tooltip">{{ item.presentableName }}</span>
              <span class="lsp-state">{{ item.actionText }}</span>
              <button v-if="item.stopOrRestart" class="icon-button" :disabled="busy" :title="item.stopOrRestart === 'restart' ? '重启服务器' : '停止服务器'" :aria-label="`${item.stopOrRestart === 'restart' ? '重启' : '停止'}：${item.presentableName}`" @click="void run(item)"><RefreshCw v-if="item.stopOrRestart === 'restart'" :size="iconSize.dense" /><Square v-else :size="iconSize.dense" /></button>
            </div>
          </template>
        </template>
      </template>
    </AnchoredMenu>
  </Teleport>
</template>

<style scoped>
.status-lsp-services { display: inline-flex; align-items: center; gap: var(--space-1); }
.status-lsp-services.has-error { color: var(--error); }
.lsp-empty { color: var(--muted); padding: var(--space-2); }
/* 小标题：与 `.panel-heading` 同一档（11px）。原先写的是 `var(--font-dense)` —— 那个令牌
   本仓**根本没有定义**（`tokens.css` 只有 `--font-ui/brand/mono` 三个字族令牌，没有字号阶梯），
   于是这条 font-size 声明一直是个空操作，字号实际继承自宿主（12px）。 */
.lsp-section { color: var(--muted); font-size: 11px; padding: var(--space-1) var(--space-2); }
.lsp-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); max-width: 360px; }
.lsp-name { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lsp-state { flex: 1; color: var(--muted); }
</style>
