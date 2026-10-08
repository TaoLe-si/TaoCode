<script setup lang="ts">
// 设置 › 构建、执行、部署 › 构建工具（IDEA `build.tools`，`ExternalSystemGroupConfigurable`）。
//
// 逐条对照 `platform/external-system-impl/.../service/settings/ExternalSystemGroupConfigurable.kt`：
//   :22-26  BoundSearchableConfigurable，id = `build.tools`，BackedByPersistentState
//   :28-29  backing component = ExternalSystemProjectTrackerSettings（**项目级**）
//   :31-40  一个复选框「自动重新加载项目」（`...radio.button.group.title`）
//   :41-50  「全部(ALL) / 选择性(SELECTIVE)」单选 + 选择性那行的说明；`.enabledIf(cbReload.selected)`
//   :51-54  onApply：`autoReloadType = enabled ? value : NONE`，并把 value 记进 `PREVIOUS_KEY`
//   :58     PREVIOUS_KEY = "settings.build.tools.auto.reload"
// 三档语义见 `ExternalSystemProjectTrackerSettings.kt:12-28`（src/gradle.ts 的 AutoReloadType）。
import { computed } from 'vue'
import {
  AUTO_RELOAD_ALL_LABEL, AUTO_RELOAD_GROUP_TITLE, AUTO_RELOAD_SELECTIVE_LABEL,
  DEFAULT_BUILD_TOOLS, type AutoReloadType, type BuildToolsSettings,
} from '../gradle.ts'

const props = defineProps<{
  /** 项目级状态；没有项目时传 null（控件全部禁用）。 */
  buildTools: BuildToolsSettings | null
  busy: boolean
}>()
const emit = defineEmits<{ save: [patch: Partial<BuildToolsSettings>] }>()

const current = computed<BuildToolsSettings>(() => props.buildTools ?? DEFAULT_BUILD_TOOLS)
const disabled = computed(() => !props.buildTools || props.busy)
const enabled = computed(() => current.value.autoReloadType !== 'NONE')
/** 复选框关闭时显示/沿用上一次的那一档（源码 :35 的三元表达式）。 */
const choice = computed<AutoReloadType>(() => enabled.value ? current.value.autoReloadType : current.value.previousAutoReloadType)
function apply(next: boolean, value: AutoReloadType = choice.value) {
  emit('save', { autoReloadType: next ? value : 'NONE', previousAutoReloadType: value })
}
</script>

<template>
  <!-- IDEA ExternalSystemProjectTrackerSettings.AutoReloadType：复选框 + 「全部/选择性」单选（:31-55）。 -->
  <label class="checkbox-row"><input type="checkbox" :checked="enabled" :disabled="disabled" @change="apply(($event.target as HTMLInputElement).checked)" /><span>{{ AUTO_RELOAD_GROUP_TITLE }}</span></label>
  <div class="checkbox-row" role="radiogroup" :aria-label="AUTO_RELOAD_GROUP_TITLE" :aria-disabled="!enabled">
    <label><input type="radio" name="build-tools-auto-reload" value="ALL" :checked="choice === 'ALL'" :disabled="disabled || !enabled" @change="apply(true, 'ALL')" /><span>{{ AUTO_RELOAD_ALL_LABEL }}</span></label>
    <label><input type="radio" name="build-tools-auto-reload" value="SELECTIVE" :checked="choice === 'SELECTIVE'" :disabled="disabled || !enabled" @change="apply(true, 'SELECTIVE')" /><span>{{ AUTO_RELOAD_SELECTIVE_LABEL }}</span></label>
  </div>
</template>
