<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean
  accessibleName: string
  color?: 'accent' | 'success'
  size?: 'default' | 'sm' | 'compact'
}>(), {
  color: 'accent',
  size: 'default',
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    class="agent-setting-switch"
    :class="[`is-${props.color}`, `is-${props.size}`]"
    type="button"
    role="switch"
    :aria-checked="props.modelValue"
    :aria-label="props.accessibleName"
    :title="props.accessibleName"
    @click="emit('update:modelValue', !props.modelValue)"
  ><span aria-hidden="true" /></button>
</template>

<style scoped>
.agent-setting-switch { position: relative; display: inline-flex; flex: 0 0 auto; align-items: center; width: 36px; height: 20px; padding: 0; border: 0; border-radius: var(--radius-pill); background: var(--line-strong); cursor: pointer; transition: background-color var(--dur-1) var(--ease); }
.agent-setting-switch.is-sm { width: 32px; height: 16px; }
.agent-setting-switch.is-compact { width: 32px; height: 18px; }
.agent-setting-switch[aria-checked="true"].is-accent { background: var(--accent); }
.agent-setting-switch[aria-checked="true"].is-success { background: var(--success); }
.agent-setting-switch > span { position: absolute; left: 1px; width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--panel); transition: left var(--dur-1) var(--ease); }
.agent-setting-switch.is-sm > span { left: 1px; }
.agent-setting-switch.is-compact > span { left: 1px; width: 16px; height: 16px; }
.agent-setting-switch[aria-checked="true"] > span { left: 18px; background: var(--on-accent); }
.agent-setting-switch.is-sm[aria-checked="true"] > span { left: 17px; }
.agent-setting-switch.is-compact[aria-checked="true"] > span { left: 15px; }
.agent-setting-switch:hover { box-shadow: 0 0 0 2px var(--line-strong); }
.agent-setting-switch:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }
</style>
