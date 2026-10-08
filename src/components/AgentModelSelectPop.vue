<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { MANAGE_MODELS_LABEL, type ModelSelectGroup } from '../agentModelSelection'
import { useRelativePopupAnchor } from '../popupAnchor'
import { iconSize } from '../uiIcons'
import { IdeaCheckedIcon } from './icons/toolWindowIcons'

const props = defineProps<{
  groups: readonly ModelSelectGroup[]
  value: string
}>()
const emit = defineEmits<{ select: [value: string]; manageModels: [] }>()
const openGroup = ref<string | null>(null)
const groupTriggers = new Map<string, HTMLElement>()
const modelItems = new Map<string, HTMLElement>()
const rootMenu = ref<HTMLElement | null>(null)
const submenu = ref<HTMLElement | null>(null)
const activeGroup = computed(() => props.groups.find(group => group.key === openGroup.value) ?? null)
const { style: submenuStyle, refresh: refreshSubmenu } = useRelativePopupAnchor(submenu, () => {
  const key = openGroup.value
  const trigger = key ? groupTriggers.get(key) : undefined
  return trigger?.getBoundingClientRect() ?? null
})

watch(openGroup, key => { if (key) refreshSubmenu() }, { flush: 'post' })

onMounted(() => {
  void nextTick(() => rootMenu.value?.querySelector<HTMLElement>('[data-agent-model-menu-item]')?.focus())
})

function setGroupTrigger(key: string, element: unknown): void {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) groupTriggers.set(key, element)
  else groupTriggers.delete(key)
}

function setModelItem(key: string, element: unknown): void {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) modelItems.set(key, element)
  else modelItems.delete(key)
}

function modelItemRef(itemKey: string): (element: unknown) => void {
  const groupKey = activeGroup.value?.key
  return element => {
    if (groupKey) setModelItem(`${groupKey}:${itemKey}`, element)
  }
}

function isSelectedGroup(group: ModelSelectGroup): boolean {
  return group.items.some(item => item.value === props.value)
}

function toggleGroup(key: string): void {
  if (openGroup.value === key) closeGroup()
  else focusSelectedOrFirstModel(key)
}

function focusSelectedOrFirstModel(key: string): void {
  openGroup.value = key
  const group = props.groups.find(group => group.key === key)
  const initialItemKey = group?.items.find(item => item.value === props.value)?.key ?? group?.items[0]?.key
  if (initialItemKey) void nextTick(() => modelItems.get(`${key}:${initialItemKey}`)?.focus())
}

function closeGroup(): void {
  const key = openGroup.value
  openGroup.value = null
  if (key) void nextTick(() => groupTriggers.get(key)?.focus())
}

function moveMenuFocus(container: HTMLElement | null, event: KeyboardEvent): void {
  if (!container || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = [...container.querySelectorAll<HTMLElement>('[data-agent-model-menu-item]:not(:disabled)')]
  if (!items.length) return
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-agent-model-menu-item]')
    : null
  const current = target ? items.indexOf(target) : -1
  let next = current
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  event.preventDefault()
  items[next]?.focus()
}

function onRootMenuKeydown(event: KeyboardEvent): void {
  moveMenuFocus(rootMenu.value, event)
}

function onSubmenuKeydown(event: KeyboardEvent): void {
  moveMenuFocus(submenu.value, event)
}

</script>

<template>
  <div ref="rootMenu" class="agent-pop agent-model-pop" role="menu" @keydown="onRootMenuKeydown">
    <div v-for="group in props.groups" :key="group.key" class="agent-model-group" role="presentation">
      <template v-if="group.directItems">
        <div class="agent-model-group-items" role="group" :aria-label="group.label">
          <div class="agent-model-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items" :key="item.key" class="agent-pop-item" type="button" role="menuitemradio"
            data-agent-model-menu-item
            :aria-checked="item.value === props.value" :title="item.name" @click="emit('select', item.value)"
          >
            <span class="agent-pop-item-label">{{ item.name }}</span>
            <span v-if="item.badgeLabel" class="agent-model-badge">{{ item.badgeLabel }}</span>
            <IdeaCheckedIcon v-if="item.value === props.value" :size="iconSize.dense" aria-hidden="true" />
          </button>
        </div>
      </template>
      <template v-else>
        <button
          :ref="element => setGroupTrigger(group.key, element)"
          type="button" class="agent-pop-item agent-model-provider" role="menuitem" aria-haspopup="menu"
          data-agent-model-menu-item
          :aria-expanded="openGroup === group.key" :aria-label="group.label"
          @click="toggleGroup(group.key)" @keydown.right.stop.prevent="focusSelectedOrFirstModel(group.key)"
        >
          <span class="agent-pop-item-label">{{ group.label }}</span>
          <IdeaCheckedIcon v-if="isSelectedGroup(group)" :size="iconSize.dense" aria-hidden="true" />
          <ChevronRight :size="iconSize.dense" aria-hidden="true" />
        </button>
      </template>
    </div>
    <div v-if="props.groups.some(group => group.items.length > 0)" class="agent-model-divider" role="separator" />
    <button class="agent-pop-item agent-model-manage" type="button" role="menuitem" data-agent-model-menu-item @click="emit('manageModels')">
      <span class="agent-pop-item-label">{{ MANAGE_MODELS_LABEL }}</span>
    </button>
  </div>
  <Teleport to="body">
    <div v-if="activeGroup" ref="submenu" class="agent-model-submenu" :style="submenuStyle" role="menu" :aria-label="activeGroup.label" @keydown="onSubmenuKeydown" @keydown.esc.stop.prevent="closeGroup" @keydown.left.stop.prevent="closeGroup">
      <button
        v-for="item in activeGroup.items" :key="item.key" :ref="modelItemRef(item.key)"
        class="agent-pop-item" type="button" role="menuitemradio" data-agent-model-menu-item :aria-checked="item.value === props.value"
        :title="item.name" @click="emit('select', item.value)"
      >
        <span class="agent-pop-item-label">{{ item.name }}</span>
        <span v-if="item.badgeLabel" class="agent-model-badge">{{ item.badgeLabel }}</span>
        <IdeaCheckedIcon v-if="item.value === props.value" :size="iconSize.dense" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.agent-pop.agent-model-pop { left: auto; right: 0; width: max-content; min-width: min(12rem, calc(100cqi - var(--space-6))); max-width: min(calc(100vw - var(--space-6) - var(--space-2)), calc(100cqi - var(--space-6))); max-height: calc(100vh - var(--space-6)); gap: 2px; }
.agent-model-group-label { display: flex; align-items: center; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 14px; font-weight: 600; }
.agent-model-group + .agent-model-group { margin-top: var(--space-1); }
.agent-model-provider { width: 100%; }
.agent-model-provider[aria-expanded="true"] { background: var(--hover); }
.agent-model-provider > svg:not(:last-child) { color: var(--secondary); }
.agent-model-provider > svg:last-child { flex-shrink: 0; }
.agent-model-submenu { position: fixed; z-index: 30; display: flex; flex-direction: column; gap: 2px; width: max-content; min-width: min(12rem, calc(100vw - var(--space-2) - var(--space-2))); max-width: calc(100vw - var(--space-2) - var(--space-2)); max-height: 18rem; overflow: auto; padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); color: var(--popup-foreground); }
.agent-model-divider { height: 1px; margin: var(--space-1) calc(-1 * var(--space-1)); background: var(--line); }
.agent-model-manage { position: sticky; bottom: 0; z-index: 1; padding: var(--space-1) var(--space-2); border-radius: var(--radius-md); background: var(--elevated); }
.agent-pop-item { display: flex; align-items: center; gap: var(--space-2); min-width: 0; min-height: var(--ctrl-height-lg); padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font: 14px/1.5 var(--font-ui); text-align: left; cursor: pointer; transition: background-color var(--dur-1) var(--ease); }
.agent-pop-item:hover:not(:disabled) { background: var(--hover); }
.agent-pop-item:focus-visible { background: var(--hover); outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-pop-item:disabled { opacity: .5; cursor: default; }
.agent-pop-item[aria-checked="true"] > svg { color: var(--secondary); }
.agent-pop-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-model-badge { flex-shrink: 0; padding: 0 var(--space-1); border-radius: var(--radius-pill); background: var(--panel); color: var(--secondary); font-size: 11px; line-height: 1.4; }
</style>
