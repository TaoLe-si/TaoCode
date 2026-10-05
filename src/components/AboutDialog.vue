<script setup lang="ts">
// 「关于 TaoCode」对话框 —— IDEA `AboutDialog`（`com.intellij.ide.actions.AboutDialog`）的信息面板。
// 数据来自宿主 `app.info`（native/main.cpp 的 `app.info` 路由 + native/diagnostics.cpp）。
//
// **显示与复制同源**（上游 `myInfo` 那条纪律，见 `src/aboutInfo.ts` 的模块头）：
// 下面这一列 `dt/dd` 渲染 `aboutRows(...)`，复制按钮写出去的是 `extendedAboutText(...)` ——
// 两者都由 `src/aboutInfo.ts` 从同一个 `AppInfo` 算出来，所以屏幕上的和粘给支持的那份
// 永远说同一件事，不会各说各话。行标签、占位符口径、扩展行、按钮文案全部取自该模块的常量，
// 这里不重写第二份。
import { computed, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'
import type { AppInfo } from '../helpActions'
import { iconSize } from '../uiIcons'
import { ABOUT_APP_NAME, ABOUT_COPIED, ABOUT_COPY_BUTTON, ABOUT_COPY_DESCRIPTION, ABOUT_COPY_FEEDBACK_MS,
         aboutRows, extendedAboutText } from '../aboutInfo'
// 走 `src/clipboard.ts` 的 `copyToClipboard`（`CopyPasteManager.setContents` 的等价物）而不是裸调
// `navigator.clipboard.writeText`：这样复制进去的「关于」信息也会进剪贴板环，
// 之后能用 Ctrl+Shift+V 从历史里再取回来 —— 与上游同一份 `CopyPasteManager` 单一入口一致。
import { copyToClipboard } from '../clipboard'

const props = defineProps<{ info: AppInfo | null }>()
const emit = defineEmits<{ (event: 'close'): void }>()

// IDEA's About 有 `Build #IC-…` 这一行；本仓的对应物是**页面自己引用的入口包名**。
// 它比 exe 的时间戳可靠：原生层没改时 exe 不重链，而界面是启动时从 `<exe>/ui` 读的。
// `typeof document` 守卫是为了让本组件能在无 DOM 的 SSR 下被真渲染（`tests/about-dialog-copy.test.mjs`）。
const entryScript = typeof document === 'undefined'
  ? ''
  : (document.querySelector<HTMLScriptElement>('script[src]')?.src.split('/').pop() ?? '')

/** `aboutRows`（`aboutInfo.ts:48`）—— 缺值那一列自己写 `—`，不写空串。 */
const rows = computed(() => aboutRows(props.info, entryScript))

// 「配置目录」是唯一可能很长的一行，给它换行（原先是手写模板里单独给它挂的类）。
const PATH_LABEL = '配置目录'

// 上游 `Cores: <availableProcessors>`（`getExtendedAboutText` :342）只在拿得到时写，
// 拿不到就不写这一行、不写 0。`extendedAboutText` 内部已判过 `cores > 0`。
const cores = typeof navigator === 'undefined' ? null : (navigator.hardwareConcurrency ?? null)

const copied = ref(false)
const copyLabel = computed(() => (copied.value ? ABOUT_COPIED : ABOUT_COPY_BUTTON))
let closeTimer: number | undefined
/**
 * 复制动作挂在唯一的动作按钮上（上游 `createDefaultActions` :140-155：那个按钮的文案就是
 * `button.copy.and.close` = `ABOUT_COPY_BUTTON`）。先给「已复制」反馈再关，让用户看见
 * 复制真的发生了；`ABOUT_COPY_FEEDBACK_MS` 是这一下反馈的时长。
 */
async function copyAndClose() {
  await copyToClipboard(extendedAboutText(props.info, entryScript, cores))
  copied.value = true
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => emit('close'), ABOUT_COPY_FEEDBACK_MS)
}
onBeforeUnmount(() => { if (closeTimer !== undefined) window.clearTimeout(closeTimer) })
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette about-dialog" role="dialog" aria-modal="true" :aria-label="`关于 ${ABOUT_APP_NAME}`">
      <div class="palette-input">
        <span class="about-heading">关于 {{ ABOUT_APP_NAME }}</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <dl class="about-list">
        <template v-for="row in rows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd :class="{ 'about-path': row.label === PATH_LABEL }">{{ row.value }}</dd>
        </template>
      </dl>
      <p class="about-foot">宿主为 C++20 + WebView2，界面为 Vue 3；语言智能与调试分别走 LSP 与 DAP。</p>
      <div class="dialog-actions">
        <button class="primary-button about-copy" type="button" :title="ABOUT_COPY_DESCRIPTION" :aria-label="ABOUT_COPY_DESCRIPTION" @click="copyAndClose">{{ copyLabel }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.about-dialog { width: 520px; }
.about-heading { flex: 1; color: var(--bright); font-weight: 500; }
.about-list { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; padding: var(--space-3); font-size: 13px; }
.about-list dt { color: var(--muted); }
.about-list dd { margin: 0; color: var(--text); }
.about-path { word-break: break-all; }
.about-foot { margin: 0; padding: 0 var(--space-3); color: var(--muted); font-size: 12px; }
.about-copy { margin-top: 0; }
</style>
