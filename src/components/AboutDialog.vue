<script setup lang="ts">
// 「关于 TaoCode」对话框 —— IDEA `AboutAction` 的信息面板（版本 / 构建号 / 平台 / 运行时 / 配置目录）。
// 数据来自宿主 `app.info`（native/main.cpp 的 `app.info` 路由 + native/diagnostics.cpp）。
import { X } from 'lucide-vue-next'
import type { AppInfo } from '../helpActions'
import { iconSize } from '../uiIcons'

defineProps<{ info: AppInfo | null }>()
const emit = defineEmits<{ (event: 'close'): void }>()

// IDEA 的 About 有 `Build #IC-…` 这一行；本仓的对应物是**页面自己引用的入口包名**。
// 它比 exe 的时间戳可靠：原生层没改时 exe 不重链，而界面是启动时从 `<exe>/ui` 读的。
const entryScript = document.querySelector<HTMLScriptElement>('script[src]')?.src.split('/').pop() ?? ''
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette about-dialog" role="dialog" aria-modal="true" aria-label="关于 TaoCode">
      <div class="palette-input">
        <span class="about-heading">关于 TaoCode</span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <dl class="about-list">
        <dt>版本</dt><dd>{{ info?.version ?? '—' }}</dd>
        <dt>构建</dt><dd>{{ entryScript || '—' }}</dd>
        <dt>平台</dt><dd>{{ info ? `${info.platform} ${info.arch}` : '—' }}</dd>
        <dt>WebView2</dt><dd>{{ info?.webview2 || '—' }}</dd>
        <dt>配置目录</dt><dd class="about-path">{{ info?.profile || '—' }}</dd>
      </dl>
      <p class="about-foot">宿主为 C++20 + WebView2，界面为 Vue 3；语言智能与调试分别走 LSP 与 DAP。</p>
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
.about-foot { margin: 0; padding: 0 var(--space-3) var(--space-3); color: var(--muted); font-size: 12px; }
</style>
