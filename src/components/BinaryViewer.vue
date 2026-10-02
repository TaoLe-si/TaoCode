<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, FolderOpen, X } from 'lucide-vue-next'
import type { BinaryView } from '../bridge'
import { iconSize } from '../uiIcons'

const props = defineProps<{ path: string; data: BinaryView }>()
const emit = defineEmits<{ close: []; reveal: [] }>()

// The host sends raw bytes as base64; decoding once here keeps the hex dump and the
// ASCII gutter reading from the same buffer instead of re-decoding per row.
const bytes = computed<Uint8Array>(() => {
  const binary = props.data.base64 ?? ''
  if (!binary) return new Uint8Array(0)
  const raw = atob(binary)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
})

const perRow = ref(16)
const rowCount = computed(() => Math.ceil(bytes.value.length / perRow.value))
// A 16 MiB dump is ~1M rows; windowing keeps the DOM at a few hundred rows instead of
// locking the UI. Scrolling recomputes the window.
const maxRows = 512
const firstRow = ref(0)
const visibleRows = computed(() => Array.from(
  { length: Math.min(maxRows, Math.max(0, rowCount.value - firstRow.value)) },
  (_, i) => firstRow.value + i,
))
function onScroll(event: Event) {
  const target = event.target as HTMLElement
  const rowHeight = 20
  firstRow.value = Math.max(0, Math.min(Math.max(0, rowCount.value - maxRows), Math.floor(target.scrollTop / rowHeight)))
}

const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
function rowBytes(row: number): number[] {
  const start = row * perRow.value
  return Array.from(bytes.value.subarray(start, Math.min(start + perRow.value, bytes.value.length)))
}
// Printable ASCII only; everything else is a dot so the gutter stays aligned.
const ascii = (value: number) => (value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : '.')
const offset = (row: number) => (row * perRow.value).toString(16).padStart(8, '0').toUpperCase()

const imageKinds = new Set(['png', 'jpeg', 'gif', 'bmp', 'webp'])
const isImage = computed(() => imageKinds.has(props.data.kind))
const mime = computed(() => props.data.kind === 'jpeg' ? 'image/jpeg'
  : props.data.kind === 'gif' ? 'image/gif'
  : props.data.kind === 'bmp' ? 'image/bmp'
  : props.data.kind === 'webp' ? 'image/webp' : 'image/png')
const dataUrl = computed(() => isImage.value ? `data:${mime.value};base64,${props.data.base64}` : '')
const kindLabel = computed(() => ({
  png: 'PNG 图片', jpeg: 'JPEG 图片', gif: 'GIF 图片', bmp: 'BMP 图片', webp: 'WebP 图片',
  riff: 'RIFF 容器（WAV/AVI 等）', pdf: 'PDF 文档', binary: '二进制文件',
}[props.data.kind] ?? '二进制文件'))
function saveAs() {
  const link = document.createElement('a')
  link.href = `data:application/octet-stream;base64,${props.data.base64}`
  link.download = props.path.split('/').pop() || 'download.bin'
  link.click()
}
</script>

<template>
  <div class="binary-view">
    <div class="binary-head">
      <span class="binary-title" :title="path">{{ path.split('/').pop() }}</span>
      <span class="binary-kind">{{ kindLabel }}</span>
      <span class="binary-size">{{ data.size.toLocaleString() }} 字节</span>
      <span v-if="data.truncated" class="binary-truncated">已截断预览</span>
      <div class="binary-actions">
        <button class="icon-button" title="在文件管理器中显示" aria-label="在文件管理器中显示" @click="emit('reveal')"><FolderOpen :size="iconSize.control" /></button>
        <button class="icon-button" title="另存为…" aria-label="另存为" @click="saveAs"><Download :size="iconSize.control" /></button>
        <button class="icon-button" title="关闭" aria-label="关闭二进制查看" @click="emit('close')"><X :size="iconSize.control" /></button>
      </div>
    </div>
    <div v-if="isImage" class="binary-image">
      <img :src="dataUrl" :alt="path" />
    </div>
    <div v-else-if="!bytes.length" class="binary-empty">文件为空。</div>
    <div v-else class="binary-hex" @scroll="onScroll">
      <div class="hex-spacer" :style="{ height: `${rowCount * 20}px` }" />
      <div class="hex-window" :style="{ transform: `translateY(${firstRow * 20}px)` }">
        <div v-for="row in visibleRows" :key="row" class="hex-row">
          <span class="hex-offset">{{ offset(row) }}</span>
          <span class="hex-bytes"><span v-for="(byte, index) in rowBytes(row)" :key="index" class="hex-byte">{{ hex(byte) }}</span></span>
          <span class="hex-ascii">{{ rowBytes(row).map(ascii).join('') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.binary-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.binary-head { flex-shrink: 0; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); background: var(--rail); }
.binary-title { color: var(--text); font: 12px var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.binary-kind, .binary-size { flex-shrink: 0; color: var(--muted); font-size: 11px; }
.binary-truncated { flex-shrink: 0; color: var(--warning); font-size: 11px; }
.binary-actions { margin-left: auto; display: flex; gap: var(--space-1); }
.binary-image { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; padding: var(--space-3); background: var(--editor); }
.binary-image img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
.binary-empty { padding: var(--space-4); color: var(--muted); font-size: 12px; }
.binary-hex { flex: 1; min-height: 0; overflow: auto; position: relative; font: 12px/20px var(--font-mono); }
.hex-spacer { width: 1px; }
.hex-window { position: absolute; top: 0; left: 0; right: 0; }
.hex-row { display: flex; gap: var(--space-3); height: 20px; padding: 0 var(--space-3); white-space: pre; }
.hex-offset { color: var(--muted); }
.hex-bytes { display: inline-flex; gap: 4px; }
.hex-byte { color: var(--text); }
.hex-ascii { color: var(--secondary); }
</style>
