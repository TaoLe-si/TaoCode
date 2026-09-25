<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../markdown'

// IDEA's Markdown preview renders the live document beside the editor; the same
// buffer text is rendered here, so unsaved edits show up immediately.
const props = defineProps<{ path: string; content: string }>()
const html = computed(() => renderMarkdown(props.content))
</script>

<template>
  <div class="markdown-preview" :aria-label="`Markdown 预览 ${path}`">
    <div class="markdown-body" v-html="html" />
  </div>
</template>

<style scoped>
.markdown-preview { overflow: auto; height: 100%; background: var(--bg); }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 20px 28px 48px; color: var(--text); line-height: 1.65; font-size: 14px; }
.markdown-body :deep(h1) { font-size: 1.7em; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
.markdown-body :deep(h2) { font-size: 1.4em; margin: 1em 0 0.4em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
.markdown-body :deep(h3) { font-size: 1.18em; margin: 1em 0 0.35em; }
.markdown-body :deep(h4), .markdown-body :deep(h5), .markdown-body :deep(h6) { font-size: 1.02em; margin: 0.9em 0 0.3em; }
.markdown-body :deep(p) { margin: 0.55em 0; }
.markdown-body :deep(a) { color: var(--accent); }
.markdown-body :deep(code) { font-family: var(--mono, monospace); background: var(--bg-inset, rgba(127,127,127,0.12)); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.92em; }
.markdown-body :deep(pre) { background: var(--bg-inset, rgba(127,127,127,0.12)); padding: 12px 14px; border-radius: 6px; overflow: auto; margin: 0.7em 0; }
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 1.6em; margin: 0.5em 0; }
.markdown-body :deep(li) { margin: 0.2em 0; }
.markdown-body :deep(blockquote) { border-left: 3px solid var(--border-strong, var(--border)); margin: 0.7em 0; padding: 0.1em 1em; color: var(--secondary); }
.markdown-body :deep(table) { border-collapse: collapse; margin: 0.8em 0; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--border); padding: 5px 12px; }
.markdown-body :deep(th) { background: var(--bg-inset, rgba(127,127,127,0.12)); }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 1.4em 0; }
.markdown-body :deep(img) { max-width: 100%; }
</style>
