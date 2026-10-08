<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, watch } from 'vue'
import { Brain, ChevronDown } from 'lucide-vue-next'
import { isNoThoughtLevel } from '../agentComposerControls.ts'
import { useRelativePopupAnchor } from '../popupAnchor.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  levels: readonly { value: string; label: string }[]
  value: string
  placeholder: string
  label: string
  open: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  select: [value: string]
}>()

const trigger = ref<HTMLElement | null>(null)
const listbox = ref<HTMLElement | null>(null)
const activeIndex = shallowRef(0)
const listboxId = `agent-thought-level-${useId()}`
const selectedIndex = computed(() => props.levels.findIndex(level => level.value === props.value))
const selectedLevel = computed(() => props.levels[selectedIndex.value])
const fixedLevel = computed(() => props.levels.length === 1 && selectedIndex.value === 0)
const thinkingLevels = computed(() => props.levels.filter(level => !isNoThoughtLevel(level)))
const activeDotCount = computed(() => {
  if (!selectedLevel.value || isNoThoughtLevel(selectedLevel.value)) return 0
  return thinkingLevels.value.findIndex(level => level.value === selectedLevel.value.value) + 1
})
const progressPercent = computed(() => activeDotCount.value / Math.max(1, thinkingLevels.value.length) * 100)
const canOpen = computed(() => props.levels.length > 0 && !props.disabled && !fixedLevel.value)
const activeOptionId = computed(() => `${listboxId}-option-${activeIndex.value}`)
const triggerText = computed(() => selectedLevel.value?.label ?? props.placeholder)
const { style: listboxStyle, refresh: refreshListbox } = useRelativePopupAnchor(
  listbox,
  () => trigger.value?.getBoundingClientRect() ?? null,
  { order: ['top', 'bottom', 'left', 'right'], gap: 4 },
)

function focusTrigger() {
  void nextTick(() => trigger.value?.focus())
}

function close(restoreFocus = false) {
  emit('update:open', false)
  if (restoreFocus) focusTrigger()
}

function setOpen(nextOpen: boolean) {
  if (nextOpen && !canOpen.value) return
  emit('update:open', nextOpen)
}

function focusListbox() {
  const index = selectedIndex.value >= 0 ? selectedIndex.value : 0
  activeIndex.value = Math.min(index, props.levels.length - 1)
  void nextTick(() => {
    refreshListbox()
    listbox.value?.focus()
  })
}

watch(selectedIndex, index => {
  if (props.open) activeIndex.value = index >= 0 ? index : 0
})

function selectActive() {
  const level = props.levels[activeIndex.value]
  if (!level) return
  emit('select', level.value)
  close(true)
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (!canOpen.value || props.open) return
  event.preventDefault()
  setOpen(true)
}

function onListboxKeydown(event: KeyboardEvent) {
  const count = props.levels.length
  if (!count) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    if (event.key === 'Home') activeIndex.value = 0
    else if (event.key === 'End') activeIndex.value = count - 1
    else if (event.key === 'ArrowDown') activeIndex.value = (activeIndex.value + 1) % count
    else activeIndex.value = (activeIndex.value - 1 + count) % count
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectActive()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  if (trigger.value?.contains(target) || listbox.value?.contains(target)) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  close(true)
}

watch(
  [() => props.open, canOpen],
  ([isOpen, isAvailable], _previous, onCleanup) => {
    if (!isOpen) return
    if (!isAvailable) {
      emit('update:open', false)
      return
    }

    focusListbox()
    const refresh = () => refreshListbox()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    void nextTick(() => {
      if (listbox.value) observer?.observe(listbox.value)
    })
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeydown)
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    onCleanup(() => {
      observer?.disconnect()
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onDocumentKeydown)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    })
  },
  { flush: 'post', immediate: true },
)

</script>

<template>
  <span v-if="props.levels.length" class="agent-thought-level">
    <span
      v-if="fixedLevel && selectedLevel"
      ref="trigger" class="agent-thought-trigger agent-thought-fixed" tabindex="-1"
      :title="props.label" :aria-label="selectedLevel.label" data-thought-level-fixed="true"
      data-composer-thought-control="true" data-composer-collapse-priority="3"
    >
      <Brain :size="iconSize.action" aria-hidden="true" />
      <span class="agent-thought-progress" aria-hidden="true"><span class="agent-thought-progress-fill" :class="{ 'has-progress': progressPercent > 0 }" :style="{ height: `${progressPercent}%` }" /></span>
      <span class="agent-thought-label">{{ selectedLevel.label }}</span>
    </span>
    <button
      v-else
      ref="trigger" type="button" role="combobox" aria-haspopup="listbox"
      class="agent-thought-trigger" :title="props.label" :aria-label="triggerText"
      :aria-expanded="props.open" :aria-controls="listboxId"
      data-composer-thought-control="true" data-composer-collapse-priority="3"
      :disabled="props.disabled" @click="setOpen(!props.open)" @keydown="onTriggerKeydown"
    >
      <Brain :size="iconSize.action" aria-hidden="true" />
      <span class="agent-thought-progress" aria-hidden="true"><span class="agent-thought-progress-fill" :class="{ 'has-progress': progressPercent > 0 }" :style="{ height: `${progressPercent}%` }" /></span>
      <span class="agent-thought-label">{{ triggerText }}</span>
      <ChevronDown :size="iconSize.control" aria-hidden="true" />
    </button>
  </span>
  <Teleport to="body">
    <div
      v-if="props.open && canOpen" ref="listbox" :id="listboxId" class="agent-thought-listbox"
      role="listbox" tabindex="-1" :aria-label="props.label" :aria-activedescendant="activeOptionId" :style="listboxStyle"
      @keydown="onListboxKeydown"
    >
      <button
        v-for="(level, index) in props.levels" :id="`${listboxId}-option-${index}`" :key="level.value"
        type="button" role="option" tabindex="-1" class="agent-thought-option"
        :aria-selected="level.value === props.value" :data-active="index === activeIndex || undefined"
        :title="level.label" @pointerdown.prevent @pointerenter="activeIndex = index"
        @click="emit('select', level.value); close(true)"
      >{{ level.label }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-thought-level { display: inline-flex; min-width: 0; }
.agent-thought-trigger { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; max-width: min(160px, calc(100vw - var(--space-6))); height: var(--ctrl-height); padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: 14px/1.5 var(--font-ui); text-align: left; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-thought-trigger:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.agent-thought-trigger:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-thought-trigger:disabled { opacity: .5; cursor: default; }
.agent-thought-fixed { cursor: default; }
.agent-thought-progress { display: none; position: relative; width: var(--space-1); align-self: stretch; overflow: hidden; border-radius: var(--radius-pill); background: var(--line); }
.agent-thought-progress-fill { position: absolute; right: 0; bottom: 0; left: 0; min-height: 0; border-radius: inherit; background: var(--success); transition: height var(--dur-2) var(--ease); }
.agent-thought-progress-fill.has-progress { min-height: var(--space-1); }
.agent-thought-trigger[data-composer-compact="true"] .agent-thought-progress { display: inline-flex; }
.agent-thought-trigger[data-composer-compact="true"] .agent-thought-label,
.agent-thought-trigger[data-composer-compact="icon"] .agent-thought-progress,
.agent-thought-trigger[data-composer-compact="icon"] .agent-thought-label,
.agent-thought-trigger[data-composer-compact="icon"] > svg:last-of-type { display: none; }
.agent-thought-trigger[data-composer-compact="icon"] { width: var(--ctrl-height); padding: 0; justify-content: center; gap: 0; }
.agent-thought-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-thought-listbox { position: fixed; z-index: 30; display: flex; flex-direction: column; width: max-content; min-width: min(12rem, calc(100vw - var(--space-4))); max-width: calc(100vw - var(--space-4)); max-height: min(18rem, calc(100vh - var(--space-6))); overflow: auto; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.agent-thought-listbox:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-thought-option { display: flex; align-items: center; min-width: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font: 14px/1.5 var(--font-ui); text-align: left; cursor: pointer; }
.agent-thought-option:hover, .agent-thought-option[data-active="true"] { background: var(--hover); }
.agent-thought-option[aria-selected="true"] { color: var(--bright); }
</style>
