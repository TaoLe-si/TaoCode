<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { detectLineSeparator } from '../vcsFileUtil'
import {
  isSpeedSearchTypeable,
  speedSearchElement,
  speedSearchHitForStep,
  speedSearchKeyAction,
  speedSearchNextInput,
  speedSearchStepForKey,
  type SpeedSearchInputState,
} from '../speedSearch'
import { usePopupLayer } from '../popupStack'
import AnchoredMenu from './AnchoredMenu.vue'

type Separator = 'crlf' | 'lf' | 'cr'
const options: ReadonlyArray<{ value: Separator; label: string }> = [
  { value: 'crlf', label: 'Windows (CRLF)' },
  { value: 'lf', label: 'Unix and macOS (LF)' },
  { value: 'cr', label: 'Classic Mac OS (CR)' },
]

const props = defineProps<{ content: string; editable: boolean }>()
const emit = defineEmits<{ select: [separator: Separator] }>()
const open = ref(false)
const anchor = ref<HTMLButtonElement>()
const menuBox = ref<HTMLElement | null>(null)
const point = ref({ x: 0, y: 0 })
const search = ref<SpeedSearchInputState>({ pattern: '', shown: false })
const searchInput = ref<HTMLInputElement>()
const active = ref<Separator | null>(null)
const hasSeparator = computed(() => props.content.includes('\r') || props.content.includes('\n'))
const separator = computed(() => {
  const value = detectLineSeparator(props.content)
  return value === '\r\n' ? 'crlf' : value === '\r' ? 'cr' : 'lf'
})
const enabledOptions = computed(() => options.filter(option => !hasSeparator.value || option.value !== separator.value))
const label = computed(() => separator.value.toUpperCase())

function bindMenuBox(value: unknown) {
  menuBox.value = (value as { box?: HTMLElement } | null)?.box ?? null
}

function closePopup() {
  open.value = false
  void nextTick(() => anchor.value?.focus())
}

usePopupLayer(menuBox, open, closePopup, {
  cancelOnClickOutside: true,
  holdingFilter: () => search.value.pattern !== '',
  resetFilter: () => { search.value = { ...search.value, pattern: '' } },
})

watch(open, async opened => {
  if (!opened) {
    search.value = { pattern: '', shown: false }
    active.value = null
    return
  }
  await nextTick()
  focusOption(active.value)
})

watch(() => search.value.shown, async shown => {
  if (shown && open.value) {
    await nextTick()
    searchInput.value?.focus()
  } else if (open.value) {
    await nextTick()
    focusOption(active.value)
  }
})

function focusOption(value: Separator | null) {
  const buttons = [...(menuBox.value?.querySelectorAll<HTMLButtonElement>('.line-separator-option') ?? [])]
  const target = buttons.find(button => button.dataset.separator === value && !button.disabled)
    ?? buttons.find(button => !button.disabled)
  target?.focus()
}

function selectSearchMatch() {
  const candidates = enabledOptions.value
  const from = candidates.findIndex(option => option.value === active.value)
  const index = speedSearchElement(candidates.map(option => option.label), search.value.pattern, from)
  if (index >= 0) active.value = candidates[index]!.value
}

function onSearchInput(event: Event) {
  search.value = { pattern: (event.target as HTMLInputElement).value, shown: true }
  selectSearchMatch()
}

function moveSelection(kind: 'next' | 'previous' | 'first' | 'last') {
  const candidates = enabledOptions.value
  if (!candidates.length) return
  const from = candidates.findIndex(option => option.value === active.value)
  const index = search.value.pattern
    ? speedSearchHitForStep(candidates.map(option => option.label), search.value.pattern, from, kind)
    : kind === 'first' ? 0
      : kind === 'last' ? candidates.length - 1
        : (from < 0 ? (kind === 'next' ? 0 : candidates.length - 1) : (from + (kind === 'next' ? 1 : -1) + candidates.length) % candidates.length)
  if (index >= 0) active.value = candidates[index]!.value
}

function closeSearch() {
  search.value = speedSearchNextInput(search.value, { kind: 'hide' })
}

function onPopupKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return

  const step = speedSearchStepForKey(event.key)
  if (step) {
    event.preventDefault()
    moveSelection(step.kind)
    return
  }

  const action = speedSearchKeyAction(event.key, search.value.pattern)
  if (search.value.shown && action === 'accept') {
    event.preventDefault()
    if (event.key === 'Enter') {
      const option = enabledOptions.value.find(candidate => candidate.value === active.value)
      if (option) select(option.value)
    } else closeSearch()
    return
  }

  if (search.value.shown) {
    if (event.target === searchInput.value) {
      if (action === 'ignore' && event.key === 'Backspace' && !search.value.pattern) event.preventDefault()
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && isSpeedSearchTypeable(event.key, true)) {
      event.preventDefault()
      search.value = speedSearchNextInput(search.value, { kind: 'type', character: event.key })
      selectSearchMatch()
    }
    return
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && isSpeedSearchTypeable(event.key, null)) {
    event.preventDefault()
    search.value = speedSearchNextInput(search.value, { kind: 'type', character: event.key })
    selectSearchMatch()
  }
}

function toggle() {
  if (open.value) { closePopup(); return }
  const box = anchor.value?.getBoundingClientRect()
  if (box) point.value = { x: box.left, y: box.top }
  open.value = true
}

function select(value: Separator) {
  closePopup()
  emit('select', value)
}
</script>

<template>
  <button v-if="editable" ref="anchor" type="button" class="status-chip" :aria-label="`行分隔符 ${label}`" :aria-expanded="open" @click.stop="toggle">{{ label }}</button>
  <span v-else class="status-chip" :aria-label="`行分隔符 ${label}`">{{ label }}</span>
  <Teleport to="body">
    <div v-if="editable && open" class="tree-menu-backdrop" @click="closePopup" @contextmenu.prevent="closePopup" />
    <AnchoredMenu v-if="editable && open" :ref="bindMenuBox" class="line-separator-popup" :x="point.x" :y="point.y" @keydown="onPopupKeydown">
      <div v-if="search.shown" class="line-separator-speed-search">
        <input
          id="line-separator-search" ref="searchInput" class="line-separator-search-input" type="text"
          :value="search.pattern" aria-label="行分隔符" aria-controls="line-separator-actions"
          :aria-activedescendant="active ? `line-separator-option-${active}` : undefined"
          autocomplete="off" spellcheck="false" @input="onSearchInput"
        />
      </div>
      <div id="line-separator-actions" class="line-separator-actions" role="menu" aria-label="行分隔符">
        <button
          v-for="option in enabledOptions" :id="`line-separator-option-${option.value}`" :key="option.value"
          type="button" class="menu-button line-separator-option" role="menuitem"
          :data-separator="option.value" :class="{ 'is-active': active === option.value }"
          @focus="active = option.value" @mouseenter="active = option.value" @click="select(option.value)"
        ><span class="menu-item-icon" />{{ option.label }}</button>
      </div>
    </AnchoredMenu>
  </Teleport>
</template>

<style scoped>
.line-separator-speed-search { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); background: var(--panel); }
.line-separator-search-input { box-sizing: border-box; width: 100%; min-height: var(--ctrl-height-sm); padding: 2px var(--space-2); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); font: 12px var(--font-ui); }
.line-separator-search-input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.line-separator-actions { display: flex; flex-direction: column; }
.line-separator-actions > .line-separator-option { text-align: left; background: transparent; border: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-xs); color: var(--text); font-size: 12px; }
.line-separator-actions > .line-separator-option:hover:not(:disabled), .line-separator-actions > .line-separator-option.is-active:not(:disabled) { background: var(--hover); color: var(--bright); }
.line-separator-actions > .line-separator-option:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
</style>
