<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, FileCode2, WrapText } from 'lucide-vue-next'
import { isDesktop, request, type BinaryView } from '../bridge'
import { openExternalUrl } from '../externalLinkLauncher'
import { recordClipboardText } from '../clipboard'
import { renderMarkdown } from '../markdown'
import type { AgentMessageSegment } from '../agentMessages'
import { iconSize } from '../uiIcons'

const props = defineProps<{ segments: readonly AgentMessageSegment[] }>()
const emit = defineEmits<{ openFile: [path: string, line: number | null] }>()

const root = ref<HTMLElement>()
const copiedCodeIndex = ref<number | null>(null)
const wrappedCodeIndices = ref<Set<number>>(new Set())
let copiedCodeTimer: ReturnType<typeof setTimeout> | undefined
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }
const MAX_BYTES = 4 * 1024 * 1024

function renderedText(text: string) {
  return renderMarkdown(text)
}

function codeFenceText(text: string): string {
  return text.replace(/\n+$/, '')
}

async function copyCode(text: string, index: number) {
  const code = codeFenceText(text)
  if (!code || !navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(code)
    recordClipboardText(code)
    copiedCodeIndex.value = index
    if (copiedCodeTimer !== undefined) clearTimeout(copiedCodeTimer)
    copiedCodeTimer = setTimeout(() => { copiedCodeIndex.value = null; copiedCodeTimer = undefined }, 2000)
  } catch {}
}

function toggleCodeWrap(index: number) {
  const next = new Set(wrappedCodeIndices.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  wrappedCodeIndices.value = next
}

function onMarkdownClick(event: MouseEvent) {
  const target = event.target
  const current = event.currentTarget
  if (!(target instanceof Element) || !(current instanceof Element)) return
  const anchor = target.closest<HTMLAnchorElement>('a[data-md-open]')
  if (anchor && current.contains(anchor)) {
    const path = anchor.dataset.mdOpen
    if (!path) return
    event.preventDefault()
    emit('openFile', path, null)
    return
  }
  if (!isDesktop) return
  const externalAnchor = target.closest<HTMLAnchorElement>('a[href]')
  if (!externalAnchor || !current.contains(externalAnchor)) return
  let url: URL
  try { url = new URL(externalAnchor.href) } catch { return }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  event.preventDefault()
  void openExternalUrl(url.href).catch(() => undefined)
}

async function resolveImages() {
  const host = root.value
  if (!host) return
  const pending = [...host.querySelectorAll<HTMLElement>('[data-md-src]')]
  if (!pending.length) return
  if (!isDesktop) {
    for (const slot of pending) replace(slot, '浏览器预览不能读取图片；请在桌面端查看。')
    return
  }
  for (const slot of pending) {
    const path = slot.dataset.mdSrc ?? ''
    const alt = slot.dataset.mdAlt ?? ''
    try {
      const view = await request<BinaryView>('file.readBinary', { path, limit: MAX_BYTES })
      const type = IMAGE_TYPES[view.kind === 'jpg' ? 'jpeg' : view.kind] ?? ''
      if (!type) { replace(slot, `不是受支持的图片格式（${view.kind}）：${path}`); continue }
      const image = document.createElement('img')
      image.src = `data:${type};base64,${view.base64}`
      image.alt = alt
      slot.replaceWith(image)
    } catch (caught) {
      replace(slot, `无法读取图片：${path}（${caught instanceof Error ? caught.message : String(caught)}）`)
    }
  }
}

function replace(slot: HTMLElement, message: string) {
  const note = document.createElement('span')
  note.className = 'md-image-broken'
  note.textContent = message
  slot.replaceWith(note)
}

watch(() => props.segments, () => void resolveImages(), { deep: true, flush: 'post', immediate: true })
onMounted(() => void resolveImages())
onBeforeUnmount(() => {
  root.value = undefined
  if (copiedCodeTimer !== undefined) clearTimeout(copiedCodeTimer)
})
</script>

<template>
  <div ref="root" class="agent-message-content">
    <template v-for="(segment, index) in segments" :key="`${segment.kind}-${index}`">
      <div v-if="segment.kind === 'text'" class="agent-message-markdown" v-html="renderedText(segment.text)" @click="onMarkdownClick" />
      <div v-else-if="segment.kind === 'code'" class="agent-code-block">
        <div class="agent-code-header">
          <span>{{ segment.language.trim() || 'text' }}</span>
          <div class="agent-code-actions">
            <button type="button" aria-label="自动换行" title="自动换行" :aria-pressed="wrappedCodeIndices.has(index)" @click="toggleCodeWrap(index)">
              <WrapText :size="iconSize.control" aria-hidden="true" />
            </button>
            <button type="button" aria-label="复制代码" title="复制代码" @click="copyCode(segment.text, index)">
              <Check v-if="copiedCodeIndex === index" :size="iconSize.control" aria-hidden="true" />
              <Copy v-else :size="iconSize.control" aria-hidden="true" />
            </button>
          </div>
        </div>
        <pre class="agent-code" :class="{ 'is-wrapped': wrappedCodeIndices.has(index) }" :data-language="segment.language"><code>{{ codeFenceText(segment.text) }}</code></pre>
      </div>
      <ul v-else-if="segment.kind === 'plan'" class="agent-plan-steps"><li v-for="(step, stepIndex) in segment.steps" :key="stepIndex">{{ step }}</li></ul>
      <button v-else class="agent-file-link" :title="segment.line === null ? `在编辑器中打开 ${segment.path}` : `在编辑器中打开 ${segment.path} 并定位到第 ${segment.line} 行`" @click="emit('openFile', segment.path, segment.line)">
        <FileCode2 :size="iconSize.inline" aria-hidden="true" /><span>{{ segment.path }}</span><span v-if="segment.line !== null" class="agent-file-line">:{{ segment.line }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.agent-message-content { min-width: 0; color: var(--text); font-size: var(--ui-font-size, 14px); line-height: 1.75; letter-spacing: 0.025em; overflow-wrap: anywhere; }
.agent-message-markdown { min-width: 0; }
.agent-message-markdown :deep(> :first-child) { margin-block-start: 0; }
.agent-message-markdown :deep(> :last-child) { margin-block-end: 0; }
.agent-message-markdown :deep(h1) { margin: var(--space-6) 0 var(--space-4); font-size: calc(var(--ui-font-size, 14px) + 4px); font-weight: 600; }
.agent-message-markdown :deep(h2) { margin: var(--space-6) 0 var(--space-4); font-size: calc(var(--ui-font-size, 14px) + 2px); font-weight: 600; }
.agent-message-markdown :deep(h3), .agent-message-markdown :deep(h4) { margin: var(--space-6) 0 var(--space-4); font-size: var(--ui-font-size, 14px); font-weight: 600; }
.agent-message-markdown :deep(h5) { margin: var(--space-6) 0 var(--space-4); font-size: var(--ui-font-size, 14px); font-weight: 500; }
.agent-message-markdown :deep(h6) { margin: var(--space-6) 0 var(--space-4); font-size: var(--ui-font-size, 14px); font-weight: 400; }
.agent-message-markdown :deep(p) { margin-block: var(--space-3); }
.agent-message-markdown :deep(strong) { font-weight: 500; }
.agent-message-markdown :deep(a) { color: var(--accent); }
.agent-message-markdown :deep(code) { font-family: var(--font-mono, monospace); background: var(--rail); padding: 0.125rem 0.375rem; margin-inline: 0.125rem; border-radius: var(--radius-sm); font-size: max(11px, calc(var(--ui-font-size, 14px) - 1px)); }
.agent-message-markdown :deep(pre), .agent-code { background: var(--editor); padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-xs); color: var(--text); font-family: var(--font-mono); font-size: max(12px, calc(var(--ui-font-size, 14px) - 1px)); line-height: 1.5; overflow: auto; margin: var(--space-4) 0; }
.agent-message-markdown :deep(pre code) { background: none; padding: 0; margin: 0; font-size: inherit; }
.agent-code-block { margin: var(--space-4) 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--editor); }
.agent-code-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: var(--ctrl-height); padding: 0 var(--space-2) 0 var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); color: var(--muted); font: 12px/1.4 var(--font-mono, monospace); }
.agent-code-actions { display: inline-flex; align-items: center; gap: var(--space-1); }
.agent-code-actions button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 var(--ctrl-height-sm); width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); padding: 0; border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-code-actions button:hover, .agent-code-actions button[aria-pressed='true'] { background: var(--hover); color: var(--text); }
.agent-code-actions button:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-code-block > .agent-code { margin: 0; border: 0; border-radius: 0; }
.agent-code.is-wrapped { white-space: pre-wrap; overflow-wrap: anywhere; }
.agent-message-markdown :deep(ul), .agent-plan-steps { list-style: disc outside; padding-inline-start: var(--space-5); margin-block: var(--space-3); }
.agent-message-markdown :deep(ol) { list-style: decimal inside; padding-inline-start: 0; margin-block: var(--space-3); }
.agent-message-markdown :deep(ul ul), .agent-message-markdown :deep(ul ol), .agent-message-markdown :deep(ol ul), .agent-message-markdown :deep(ol ol) { margin-block: calc(var(--space-1) * 1.5); }
.agent-message-markdown :deep(li), .agent-plan-steps > li { padding-inline-start: var(--space-1); margin: 0; }
.agent-message-markdown :deep(li + li), .agent-plan-steps > li + li { margin-block-start: calc(var(--space-1) * 1.5); }
.agent-message-markdown :deep(li > p) { margin: 0; }
.agent-message-markdown :deep(blockquote) { border-left: 2px solid var(--line); margin: var(--space-4) 0; padding-left: var(--space-3); color: var(--secondary); }
.agent-message-markdown :deep(blockquote p) { margin: 0; }
.agent-message-markdown :deep(blockquote p + p) { margin-block-start: var(--space-2); }
.agent-message-markdown :deep(table) { border-collapse: collapse; margin: var(--space-3) 0; }
.agent-message-markdown :deep(th), .agent-message-markdown :deep(td) { border: 1px solid var(--line); padding: var(--space-1) var(--space-3); }
.agent-message-markdown :deep(th) { background: var(--rail); }
.agent-message-markdown :deep(hr) { border: none; border-top: 1px solid var(--line); margin: var(--space-5) 0; }
.agent-message-markdown :deep(img) { max-width: 100%; }
.agent-message-markdown :deep(.md-image-pending) { display: inline-block; padding: var(--space-1) var(--space-2); border: 1px dashed var(--line-strong); border-radius: var(--radius-xs); color: var(--secondary); font-size: 0.9em; }
.agent-message-markdown :deep(.md-image-broken) { display: inline; padding: 1px var(--space-1); border-radius: var(--radius-xs); background: var(--error-bg); color: var(--error); font-size: 0.9em; overflow-wrap: anywhere; }
.agent-file-link { display: inline-flex; align-items: baseline; gap: var(--space-1); max-width: 100%; padding: 0 var(--space-1); border: 0; background: transparent; border-radius: var(--radius-xs); color: var(--accent); font-family: var(--font-ui); font-size: var(--ui-font-size, 14px); line-height: inherit; cursor: pointer; text-align: left; }
.agent-file-link:hover { background: var(--hover); color: var(--accent-hover); text-decoration: underline; }
.agent-file-link > span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-file-line { color: var(--muted); flex-shrink: 0; }
</style>
