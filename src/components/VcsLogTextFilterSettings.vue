<script setup lang="ts">
import { computed } from 'vue'
import { CaseSensitive, ChevronDown } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
// 菜单行的勾选记号 = `AllIcons.Actions.Checked`（`expui/actions/checked.svg`），不是 lucide 的 24 格图。
import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'
import { TEXT_FILTER_SETTINGS_DESCRIPTION, TEXT_FILTER_SETTINGS_TITLE, textFilterSettingsModel } from '../vcsLogTextFilterSettings'

const props = defineProps<{ regex: boolean; matchCase: boolean }>()
// 两条动作都是**带值**的开关（`vcsLogTextFilterSettings.ts` 的 `TextFilterSettingRow.run`
// 调 `actions.setRegex(!state.textRegex)`），父组件的 `setTextRegex(value: boolean)` 也按值收 ——
// 所以 emit 形状必须带一个 boolean，与 `VcsLogGraphOptions.vue` 那种「不带值、父组件自己取反」不同。
const emit = defineEmits<{ toggleRegex: [value: boolean]; toggleMatchCase: [value: boolean] }>()
const rows = computed(() => textFilterSettingsModel(
  { textRegex: props.regex, matchCase: props.matchCase },
  { setRegex: value => emit('toggleRegex', value), setMatchCase: value => emit('toggleMatchCase', value) }))
</script>

<template>
  <details class="filter text-settings">
    <summary class="text-settings-summary" :class="{ applied: regex || matchCase }" :title="`${TEXT_FILTER_SETTINGS_TITLE}（${TEXT_FILTER_SETTINGS_DESCRIPTION}）`" :aria-label="TEXT_FILTER_SETTINGS_TITLE">
      <CaseSensitive :size="iconSize.dense" aria-hidden="true" /><ChevronDown :size="iconSize.dense" class="caret" aria-hidden="true" />
    </summary>
    <form class="popup" @submit.prevent>
      <button v-for="row in rows" :key="row.id" type="button" class="menu-button row" role="menuitemcheckbox"
        :aria-checked="row.checked" :title="row.description" @click="row.run()">
        <span class="menu-item-icon"><IdeaCheckedIcon v-if="row.checked" :size="iconSize.menu" /></span><span>{{ row.title }}</span>
      </button>
    </form>
  </details>
</template>

<style scoped>
.filter { flex-shrink: 0; font-size: 11px; }
.text-settings-summary { display: inline-flex; align-items: center; gap: var(--space-1); list-style: none; cursor: pointer; padding: var(--space-1); }
.text-settings-summary::-webkit-details-marker { display: none; }
.caret { flex-shrink: 0; color: var(--muted); }
.text-settings-summary.applied { color: var(--accent); }
.popup { position: absolute; top: 29px; right: 0; z-index: 5; width: max-content; min-width: 180px; display: flex; flex-direction: column; gap: 2px; padding: var(--space-1); border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.row { display: flex; align-items: center; gap: var(--space-2); width: 100%; justify-content: flex-start; text-align: left; white-space: nowrap; }
</style>
