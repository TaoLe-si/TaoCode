<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isDesktop, request, type BinaryView } from '../bridge'
import { renderMarkdown } from '../markdown'

// IDEA's Markdown preview renders the live document beside the editor; the same
// buffer text is rendered here, so unsaved edits show up immediately.
const props = defineProps<{ path: string; content: string }>()
// Relative links point at files inside the workspace, which only the editor can
// open; the parent wires this to its own open routine.
const emit = defineEmits<{ open: [path: string]; error: [message: string] }>()

const body = ref<HTMLElement>()
const imageError = ref('')
// The directory of the rendered file: every relative reference is resolved against
// it into a workspace path, which is the only way to address project files.
const basePath = computed(() => {
  const path = props.path.replace(/\\/g, '/')
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
})
const html = computed(() => renderMarkdown(props.content, { basePath: basePath.value }))

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }
const MAX_BYTES = 4 * 1024 * 1024
// Image bytes live behind the bridge, not behind a URL: the WebView's virtual host
// serves only the compiled UI, so `file.readBinary` is how a picture is fetched and
// then handed to the <img> as a data: URL (the CSP allows data: images).
async function resolveImages() {
  const host = body.value
  if (!host) return
  const pending = [...host.querySelectorAll<HTMLElement>('[data-md-src]')]
  if (!pending.length) { imageError.value = ''; return }
  if (!isDesktop) {
    for (const slot of pending) replace(slot, '浏览器预览不能读取图片；请在桌面端查看。')
    return
  }
  const problems: string[] = []
  for (const slot of pending) {
    const path = slot.dataset.mdSrc ?? ''
    const alt = slot.dataset.mdAlt ?? ''
    try {
      const view = await request<BinaryView>('file.readBinary', { path, limit: MAX_BYTES })
      const type = IMAGE_TYPES[view.kind === 'jpg' ? 'jpeg' : view.kind] ?? ''
      if (!type) { replace(slot, `不是受支持的图片格式（${view.kind}）：${path}`); problems.push(path); continue }
      const image = document.createElement('img')
      image.src = `data:${type};base64,${view.base64}`
      image.alt = alt
      slot.replaceWith(image)
    } catch (caught) {
      replace(slot, `无法读取图片：${path}（${caught instanceof Error ? caught.message : String(caught)}）`)
      problems.push(path)
    }
  }
  imageError.value = problems.length ? `${problems.length} 张图片无法显示，详见正文中的占位说明。` : ''
}
function replace(slot: HTMLElement, message: string) {
  const note = document.createElement('span')
  note.className = 'md-image-broken'
  note.textContent = message
  slot.replaceWith(note)
}
// A relative link would otherwise leave the app entirely, since the UI's virtual
// host has no route for workspace files.
function onClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-md-open]')
  if (!anchor) return
  const path = anchor.dataset.mdOpen
  if (!path) return
  event.preventDefault()
  emit('open', path)
}
// The render replaces the body HTML wholesale, so images are resolved after that
// update has landed (flush: 'post') rather than racing it.
watch(() => [html.value, props.path] as const, () => void resolveImages(), { flush: 'post', immediate: true })
onBeforeUnmount(() => { body.value = undefined })
</script>

<template>
  <div class="markdown-preview" :aria-label="`Markdown 预览 ${path}`">
    <p v-if="imageError" class="md-image-error" role="status">{{ imageError }}</p>
    <div ref="body" class="markdown-body" v-html="html" @click="onClick" />
  </div>
</template>

<style scoped>
.markdown-preview { overflow: auto; height: 100%; background: var(--editor); }
.md-image-error { margin: 0; padding: 6px 28px 0; color: var(--error); font-size: 11px; overflow-wrap: anywhere; }
.markdown-body { max-width: 860px; margin: 0 auto; padding: var(--space-5) 28px 48px; color: var(--text); line-height: 1.65; font-size: 14px; }
.markdown-body :deep(h1) { font-size: 1.7em; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--line); padding-bottom: 0.25em; }
.markdown-body :deep(h2) { font-size: 1.4em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--line); padding-bottom: 0.2em; }
.markdown-body :deep(h3) { font-size: 1.18em; margin: 1em 0 0.35em; }
.markdown-body :deep(h4), .markdown-body :deep(h5), .markdown-body :deep(h6) { font-size: 1.02em; margin: 0.9em 0 0.3em; }
.markdown-body :deep(p) { margin: 0.55em 0; }
.markdown-body :deep(a) { color: var(--accent); }
.markdown-body :deep(code) { font-family: var(--font-mono, monospace); background: var(--rail); padding: 0.1em 0.35em; border-radius: var(--radius-xs); font-size: 0.92em; }
.markdown-body :deep(pre) { background: var(--rail); padding: var(--space-3) 14px; border-radius: var(--radius-md); overflow: auto; margin: 0.7em 0; }
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 1.6em; margin: 0.5em 0; }
.markdown-body :deep(li) { margin: 0.2em 0; }
.markdown-body :deep(blockquote) { border-left: 3px solid var(--line-strong); margin: 0.7em 0; padding: 0.1em 1em; color: var(--secondary); }
.markdown-body :deep(table) { border-collapse: collapse; margin: 0.8em 0; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--line); padding: 5px var(--space-3); }
.markdown-body :deep(th) { background: var(--rail); }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 1.4em 0; }
.markdown-body :deep(img) { max-width: 100%; }
.markdown-body :deep(.md-image-pending) { display: inline-block; padding: 2px 6px; border: 1px dashed var(--line-strong); border-radius: var(--radius-xs); color: var(--secondary); font-size: 0.9em; }
.markdown-body :deep(.md-image-broken) { display: inline; padding: 1px var(--space-1); border-radius: var(--radius-xs); background: var(--error-bg); color: var(--error); font-size: 0.9em; overflow-wrap: anywhere; }
</style>
