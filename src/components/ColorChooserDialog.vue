<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { FILE_COLOR_HEX, FILE_COLOR_NAMES, isFileColorName, normalizeFileColor } from '../fileColors'

const MODE_KEY = 'taocode.colorChooser.hsb'
const RECENT_KEY = 'taocode.colorChooser.recent'
const MAX_RECENT = 20
function readRecentColors(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, MAX_RECENT) : [] } catch { return [] }
}
function saveRecentColor(color: string) {
  const next = [color, ...readRecentColors().filter(item => item !== color)].slice(0, MAX_RECENT)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* unavailable */ }
}
const props = withDefaults(defineProps<{ initial: string; enableOpacity?: boolean }>(), { enableOpacity: false })
const emit = defineEmits<{ confirm: [color: string]; cancel: [] }>()
const id = useId()
const dialog = ref<HTMLDialogElement>()
const canvas = ref<HTMLCanvasElement>()
const hexInput = ref<HTMLInputElement>()
const hex = ref('#ffffff')
const mode = ref<'rgb' | 'hsb'>(readMode())
function readMode(): 'rgb' | 'hsb' {
  try { return localStorage.getItem(MODE_KEY) === 'true' ? 'hsb' : 'rgb' } catch { return 'rgb' }
}
watch(mode, value => { try { localStorage.setItem(MODE_KEY, String(value === 'hsb')) } catch { /* unavailable */ } })
const dark = ref(false)
const normalized = computed(() => {
  const color = normalizeFileColor(hex.value.trim())
  return color && !isFileColorName(color) ? (props.enableOpacity ? color : color.slice(0, 7)) : null
})
const rgb = computed(() => normalized.value?.slice(0, 7) ?? '#ffffff')
const rgbValues = computed(() => [0, 1, 2].map(index => parseInt(rgb.value.slice(1 + index * 2, 3 + index * 2), 16)))
const hsb = computed(() => {
  const [r, g, b] = rgbValues.value.map(value => value / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let hue = 0
  if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return [Math.round((hue * 60 + 360) % 360), Math.round((max ? delta / max : 0) * 100), Math.round(max * 100)]
})
const alpha = computed(() => normalized.value?.length === 9 ? parseInt(normalized.value.slice(7), 16) : 255)
let previousFocus: HTMLElement | null = null
function colorFromRgb(values: number[]) { return `#${values.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}` }
function setRgb(value: string) { hex.value = value + (props.enableOpacity && alpha.value < 255 ? alpha.value.toString(16).padStart(2, '0') : '') }
function setChannel(index: number, event: Event) {
  const values = [...rgbValues.value]; values[index] = Number((event.target as HTMLInputElement).value); setRgb(colorFromRgb(values))
}
function setHsb(index: number, event: Event) {
  const values = [...hsb.value]; values[index] = Number((event.target as HTMLInputElement).value)
  const h = values[0] / 60, s = values[1] / 100, v = values[2] / 100, c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c
  const rgbMap = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  setRgb(colorFromRgb(rgbMap.map(value => (value + m) * 255))); drawWheel()
}
function setAlpha(event: Event) { const value = Number((event.target as HTMLInputElement).value); hex.value = rgb.value + value.toString(16).padStart(2, '0') }
function drawWheel() {
  const context = canvas.value?.getContext('2d'); if (!context) return
  const size = 230, center = size / 2, radius = 105, image = context.createImageData(size, size)
  const value = hsb.value[2] / 100
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - center, dy = y - center, distance = Math.sqrt(dx * dx + dy * dy), offset = (y * size + x) * 4
    if (distance > radius) { image.data[offset + 3] = 0; continue }
    const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, saturation = distance / radius
    const c = value * saturation, h = hue / 60, x2 = c * (1 - Math.abs(h % 2 - 1)), m = value - c
    const rgb = h < 1 ? [c, x2, 0] : h < 2 ? [x2, c, 0] : h < 3 ? [0, c, x2] : h < 4 ? [0, x2, c] : h < 5 ? [x2, 0, c] : [c, 0, x2]
    image.data[offset] = Math.round((rgb[0] + m) * 255); image.data[offset + 1] = Math.round((rgb[1] + m) * 255); image.data[offset + 2] = Math.round((rgb[2] + m) * 255); image.data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
}
function pickWheel(event: MouseEvent) {
  const rect = canvas.value?.getBoundingClientRect(); if (!rect) return
  const x = event.clientX - rect.left - 115, y = event.clientY - rect.top - 115, radius = Math.min(105, Math.sqrt(x * x + y * y)); if (!radius) return
  const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, saturation = radius / 105, value = hsb.value[2] / 100
  setHsbValue(hue, saturation * 100, value * 100)
}
function setHsbValue(hue: number, saturation: number, value: number) {
  const h = hue / 60, c = value / 100 * saturation / 100, x = c * (1 - Math.abs(h % 2 - 1)), m = value / 100 - c
  const rgbMap = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  setRgb(colorFromRgb(rgbMap.map(value => (value + m) * 255))); drawWheel()
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const style = getComputedStyle(previousFocus ?? document.documentElement)
  const reference = style.getPropertyValue('--file-color-blue').trim().toLowerCase()
  dark.value = reference === FILE_COLOR_HEX.Blue.dark
  hex.value = isFileColorName(props.initial)
    ? style.getPropertyValue(`--file-color-${props.initial.toLowerCase()}`).trim() || FILE_COLOR_HEX[props.initial][dark.value ? 'dark' : 'light']
    : normalizeFileColor(props.initial) ?? '#ffffff'
  if (!props.enableOpacity) hex.value = hex.value.slice(0, 7)
  void nextTick(() => { dialog.value?.showModal(); hexInput.value?.focus(); hexInput.value?.select(); drawWheel() })
})
function selectRecent(color: string) { hex.value = props.enableOpacity ? color : color.slice(0, 7) }
function confirm() {
  if (!normalized.value) return
  saveRecentColor(normalized.value)
  emit('confirm', normalized.value)
}
function close() { emit('cancel') }
onBeforeUnmount(() => { dialog.value?.close(); if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <dialog ref="dialog" class="color-chooser" :aria-labelledby="`${id}-title`" @cancel.prevent="close">
    <form @submit.prevent="confirm">
      <h3 :id="`${id}-title`">选择颜色</h3>
      <div class="preview" aria-label="颜色预览"><span :style="{ background: normalized ?? 'transparent' }" /></div>
      <div class="color-fields">
        <template v-if="mode === 'rgb'"><label v-for="(channel, index) in ['红', '绿', '蓝']" :key="channel">{{ channel }}<input type="number" min="0" max="255" :value="rgbValues[index]" @input="setChannel(index, $event)" /></label></template>
        <template v-else><label v-for="(channel, index) in ['色相', '饱和度', '亮度']" :key="channel">{{ channel }}<input type="number" :min="index ? 0 : 0" :max="index ? 100 : 359" :value="hsb[index]" @input="setHsb(index, $event)" /></label></template>
        <select v-model="mode" aria-label="颜色格式"><option value="rgb">RGB</option><option value="hsb">HSB</option></select>
      </div>
      <div class="hex-row"><label>Hex<input ref="hexInput" v-model="hex" spellcheck="false" :aria-invalid="!normalized" /></label></div>
      <div class="picker-row"><canvas ref="canvas" width="230" height="230" aria-label="色轮" @mousedown="pickWheel" /></div>
      <label class="brightness">亮度<input type="range" min="0" max="100" :value="hsb[2]" @input="setHsb(2, $event)" /></label>
      <div class="swatches" aria-label="预设颜色"><button v-for="name in FILE_COLOR_NAMES" :key="name" type="button" :title="`${dark ? '深色' : '浅色'}主题下使用 ${name}`" :aria-label="`${dark ? '深色' : '浅色'}主题下使用 ${name}`" :style="{ background: FILE_COLOR_HEX[name][dark ? 'dark' : 'light'] }" @click="setRgb(FILE_COLOR_HEX[name][dark ? 'dark' : 'light'])" /></div>
      <div class="recent" v-if="readRecentColors().length"><button v-for="color in readRecentColors()" :key="color" type="button" :title="`最近使用 ${color}`" :aria-label="`最近使用 ${color}`" :style="{ background: color }" @click="selectRecent(color)" /></div>
      <label v-if="enableOpacity" class="alpha">Alpha<input type="range" min="0" max="255" :value="alpha" @input="setAlpha" /></label>
      <p>{{ enableOpacity ? 'RGB / RGBA 十六进制。' : 'RGB 十六进制；输入 Alpha 时按不透明 RGB 保存。' }}</p><p v-if="!normalized" class="error">请输入有效颜色。</p>
      <footer><button type="submit" :disabled="!normalized">确定</button><button type="button" @click="close">取消</button></footer>
    </form>
  </dialog>
</template>

<style scoped>
.color-chooser { width: 360px; max-width: calc(100vw - 32px); padding: 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-lg); background: var(--panel); color: var(--text); }
/* 遮罩走 --backdrop 令牌（IDEA DialogWrapper 的 dim 层同理），原先写死 #0005 换主题不跟随。
   下面 .preview 的棋盘格**保留固定双色**：它是 alpha 通道的数据可视化，不是主题色 ——
   IDEA 同样用两个固定色画（AlphaSliderComponent.kt:61 paintCheckeredBackground）。 */
.color-chooser::backdrop { background: var(--backdrop); } form { display: flex; flex-direction: column; gap: 9px; } h3, p { margin: 0; } p { color: var(--muted); font-size: 11px; }
.preview { height: 28px; background: repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 / 12px 12px; border: 1px solid var(--line); } .preview span { display: block; height: 100%; }
.color-fields { display: flex; align-items: end; gap: 5px; } .color-fields label, .hex-row label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; } .color-fields input { width: 54px; } .color-fields select { height: var(--ctrl-height-sm); }
.hex-row input { width: 100%; box-sizing: border-box; } .picker-row { display: flex; justify-content: center; } canvas { cursor: crosshair; border-radius: 50%; } .brightness, .alpha { display: flex; gap: var(--space-2); align-items: center; } .brightness input, .alpha input { flex: 1; }
.swatches, .recent { display: flex; gap: 5px; flex-wrap: wrap; } .swatches button, .recent button { width: 24px; height: 20px; border: 1px solid var(--line); } .recent button { border-radius: 50%; } .error { color: var(--error); } footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
</style>
