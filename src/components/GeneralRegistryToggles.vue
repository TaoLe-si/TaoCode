<script setup lang="ts">
// 「常规」页里那两项**上游只用注册表键、没有设置页入口**的开关。
//
// 抽出来是因为它们共用一条口径（IDEA 把它们放在 registry 里，TaoCode 没有注册表对话框，
// 按全量移植要求升格为持久化设置），而 SettingsDialog.vue 已经贴着模块大小门禁 ——
// 每加一行都要重新掂量要不要拆，拆到这里就顺手了。
//
// 属性是对象，子组件直接改它的字段（与父组件里 `v-model="general.xxx"` 同一口径）：
// 设置草稿靠 `props.general` 的引用收集脏标记，改字段就能被 `createSettingsDraftActions` 看到。
import type { GeneralSettingsState } from '../settingsModel'

const props = defineProps<{ general: GeneralSettingsState }>()
void props
</script>

<template>
  <!-- IDEA 用注册表键 ide.windowSystem.autoShowProcessPopup（registry.properties:209-210，默认
       false），没有设置页入口；TaoCode 没有注册表对话框，按全量移植要求升格为持久化设置。 -->
  <label class="checkbox-row"><input v-model="general.autoShowProcessPopup" type="checkbox" aria-describedby="general-autoshow-hint" /><span>有进程开始时自动弹出进度面板</span></label>
  <p id="general-autoshow-hint" class="field-hint restore-hint">对应 IDEA 的 ide.windowSystem.autoShowProcessPopup：Git、克隆或构建/运行开始时自动打开后台任务列表。</p>
  <!-- 注册表键 search.everywhere.fuzzy.files.enabled（SeFuzzyFileSearchProviderFactory.kt:28-31，默认
       false）同样没有设置页入口；默认不勾选时「随处搜索」的文件排序与移植前完全一致。 -->
  <label class="checkbox-row"><input v-model="general.fuzzyFileSearch" type="checkbox" aria-describedby="general-fuzzy-hint" /><span>随处搜索用模糊匹配排序文件</span></label>
  <p id="general-fuzzy-hint" class="field-hint restore-hint">对应 IDEA 的 search.everywhere.fuzzy.files.enabled：文件来源改用 Smith-Waterman 本地对齐打分（连续、驼峰、分隔符加分）。</p>
</template>
