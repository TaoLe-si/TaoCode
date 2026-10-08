<!-- 「编辑器 › 常规 › 编辑器标签页」页 —— 上游 `EditorTabsConfigurable.kt`（注册 id
     `editor.preferences.tabs`，标签页上限那条是 `:109` 的 `editbox.tab.limit`）。
     从 `SettingsDialog.vue` 拆出来：宿主贴着机检上限（1381 行），而这一页的取舍需要写清楚 ——
     「标签显示在哪」在上游 New UI 是**三选一**（`:59-71` 的 `buttonsGroup`），不是两个独立复选框。
     `settings` 是对话框那份**同一个** editor 设置对象：改的就是它的字段，保存仍由对话框的「应用」统一做。 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { EditorSettings } from '../settingsModel'

const props = defineProps<{ settings: EditorSettings; busy?: boolean; invalidTabLimit?: boolean; idPrefix: string }>()
const emit = defineEmits<{ (e: 'reset'): void }>()

/**
 * **两组**单选，不是一个三选一 —— 这一点照上游 `EditorTabsConfigurable.kt:59-71` 的结构：
 *   buttonsGroup("在以下位置显示标签页") {          ← 外组，绑 `scrollTabLayoutInEditor`
 *     radioButton("一行，如果标签页不适合：", value = true)
 *     buttonsGroup(indent = true) {               ← 内组（缩进），绑 `hideTabsIfNeeded`
 *       radioButton("滚动标签页面板", value = true) / radioButton("挤压标签页", value = false)
 *     }
 *     radioButton("多行", value = false)
 *   }
 * 两组的 `name` 必须不同，否则浏览器会把它们当成一个组、互相干扰（本批第一版就是那样写成
 * 一个三选一，真机上点"挤压"还会留着"一行"被选中 —— 那个值重复的写法根本选不中）。
 * 三种组合各对应 `src/tabStripLayout.ts` 里一条**真的**布局（对照表在那个文件头）。
 */
const oneRow = computed({
  get: () => props.settings.tabsInOneRow,
  set: (value: boolean) => { props.settings.tabsInOneRow = value },
})
const squeeze = computed({
  get: () => !props.settings.hideTabsIfNeeded,
  set: (value: boolean) => { props.settings.hideTabsIfNeeded = !value },
})
</script>

<template>
  <h3>编辑器 › 常规 › 编辑器标签页</h3>
  <div class="editor-page-head">
    <button type="button" class="subtle-button" @click="emit('reset')">恢复默认</button>
  </div>
  <fieldset class="settings-fields" :disabled="busy">
    <div class="input-row">
      <label :for="`${idPrefix}-tab-limit`">每个编辑器组的标签页上限</label>
      <input :id="`${idPrefix}-tab-limit`" v-model.number="settings.tabLimit" type="number" min="1" max="100" step="1" required :aria-invalid="invalidTabLimit || undefined" />
    </div>
    <fieldset class="input-row tabs-placement">
      <legend>在以下位置显示标签页：</legend>
      <label class="settings-radio"><input v-model="oneRow" type="radio" name="tab-one-row" :value="true" /><span>一行，如果标签页不适合：</span></label>
      <div class="settings-radio-indent">
        <label class="settings-radio"><input v-model="squeeze" type="radio" name="tab-squeeze" :value="false" :disabled="!oneRow" /><span>滚动标签页面板</span></label>
        <label class="settings-radio"><input v-model="squeeze" type="radio" name="tab-squeeze" :value="true" :disabled="!oneRow" /><span>挤压标签页</span></label>
      </div>
      <label class="settings-radio"><input v-model="oneRow" type="radio" name="tab-one-row" :value="false" /><span>多行</span></label>
    </fieldset>
    <div class="input-row">
      <label :for="`${idPrefix}-pinned-separate-row`">在单独一行中显示固定标签</label>
      <input :id="`${idPrefix}-pinned-separate-row`" v-model="settings.pinnedTabsInSeparateRow" type="checkbox" :disabled="settings.tabsInOneRow" />
    </div>
  </fieldset>
</template>

<style scoped>
.tabs-placement { display: flex; flex-direction: column; gap: var(--space-1); border: 0; padding: 0; }
.tabs-placement > legend { color: var(--secondary); font-size: 12px; }
.settings-radio { display: flex; align-items: center; gap: var(--space-2); }
.settings-radio-indent { display: flex; flex-direction: column; gap: var(--space-1); margin-left: var(--space-4); }
</style>
