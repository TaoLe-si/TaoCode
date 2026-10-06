<script setup lang="ts">
// 「编辑器 › Code Vision」页 —— 上游 `CodeVisionConfigurable`（页名与总闸文案在
// `platform/lang-impl/resources/messages/CodeVisionBundle.properties:2-3`：
// `CodeVisionConfigurable.configurable.name.code.vision=Code Vision`、
// `CodeVisionConfigurable.checkbox.enable.code.vision=Enable Code Vision`）＋
// `platform/lang-impl/src/com/intellij/codeInsight/codeVision/settings/CodeVisionGlobalSettingsProvider.kt:38-47`
// 那两行 spinner（`spinner(1..10, 1)` 在 `:43` 与 `:46`，出厂值 5 =
// `platform/lang-api/src/com/intellij/codeInsight/codeVision/settings/CodeVisionSettings.kt:38-39`）。
// 分组名 `settings.hints.new.group.code.vision` = "Code vision"
// （`platform/ide-core/resources/messages/ApplicationBundle.properties:725-726`）——
// 上游把它挂在 Inlay Hints 页里当一个**分组**；本仓的设置树按页组织，于是单列一页（位置、
// 键值、默认值都不变，只是树上少绕一层）。文案是英文原文直译（本地化包不在本地树）。
//
// 这份设置的本仓真值表在 `src/codeLensSettings.ts`（`codeVisionSettings`，会话内 reactive），
// 磁盘那一份是 `EditorSettings` 的四把键（`codeVisionEnabled` / `codeVisionDisabledGroups` /
// `codeVisionEnabledGroups` / `codeVisionVisibleEntries`）。本页把两侧接起来：
//   · 打开页面 ⇒ `syncRuntime()` 按盘上那一份刷一遍运行时表；
//   · 每次改动 ⇒ 同时写草稿对象（保存由对话框的「应用」统一做）与运行时表（立刻生效）。
// 上游那两个集合**只装"与出厂相反"的那一半**（`CodeVisionSettings.kt:41-50` 的注释），
// 本仓两组 provider 出厂都是开 ⇒ 界面上只会写 `codeVisionDisabledGroups`；
// `codeVisionEnabledGroups`（`:50`）由 `codeVisionSettingsPatch()` 存盘、`restoreCodeVisionSettings()` 读回，
// 等出现「出厂关着的 provider」时才有写入方 —— 现在没有，就不假装有一个勾选框。
//
// 消费链路（逐条点名，不是本页自造的行为）：
//   · 总闸与每组的开关 → `shouldShowCodeVisionEntry`（`src/codeLensSettings.ts:119-124`），
//     渲染侧的过滤点是 `src/codeLensExtension.ts` 的 `buildDecorations` —— 那一行还没接
//     （`shouldShowCodeVisionEntry` 今天只有导入、没有调用点，接线请求 K-4 给可照抄的那一条）；
//   · 每行可见条数 → `groupAnchoredLenses(lenses, limit)`（`src/codeLens.ts:149-150`，出厂
//     `CODE_LENS_VISIBLE_MAX = 5`，`src/codeLens.ts:127`），调用点同样在 `codeLensExtension.ts:238`；
//   · 右键「隐藏这一组 / 全部隐藏」→ `handleCodeVisionExtraAction`（`src/codeLensExtension.ts:136` 在用）。
import { onMounted, watch } from 'vue'
import { useId } from 'vue'
import {
  LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID,
  codeVisionGroupName, codeVisionSettings, setCodeVisionGroupEnabled,
} from '../codeLensSettings.ts'
import type { EditorSettings } from '../settingsModel'

const props = defineProps<{ settings: EditorSettings; busy?: boolean }>()

// 本仓的两个 provider 组（`src/codeLensSettings.ts:48-50` 的两个 id；组名走
// `codeVisionGroupName`，页面不自己拼字符串）。
const GROUPS = [LSP_CODE_VISION_GROUP_ID, PROBLEMS_CODE_VISION_GROUP_ID] as const
const spinnerId = useId()

/** 某一组现在是不是开着：出厂开，被写进 `codeVisionDisabledGroups` 才是关（上游 :45 的语义）。 */
function groupOn(id: string): boolean {
  return !props.settings.codeVisionDisabledGroups.includes(id)
}

/** 勾/去勾一组：写盘上那一份（数组形态）+ 刷运行时那一份，两边同一个判据。 */
function toggleGroup(id: string, checked: boolean) {
  const disabled = props.settings.codeVisionDisabledGroups
  const at = disabled.indexOf(id)
  if (checked) { if (at >= 0) disabled.splice(at, 1) }
  else if (at < 0) disabled.push(id)
  setCodeVisionGroupEnabled(id, checked)
}

/** 运行时表按草稿对象刷一遍（打开页面时、以及三把键任何一个变了之后）。 */
function syncRuntime() {
  codeVisionSettings.enabled = props.settings.codeVisionEnabled
  for (const id of GROUPS) setCodeVisionGroupEnabled(id, groupOn(id))
}
onMounted(syncRuntime)
watch(() => `${props.settings.codeVisionEnabled}|${props.settings.codeVisionDisabledGroups.join(',')}|${props.settings.codeVisionEnabledGroups.join(',')}`, syncRuntime)
</script>

<template>
  <h3>编辑器 › Code Vision</h3>
  <p class="section-description">
    对应 IDEA Settings › Editor › Code Vision（页名与 “Enable Code Vision” 见
    <code>CodeVisionBundle.properties:2-3</code>；可见条数那一行见
    <code>CodeVisionGlobalSettingsProvider.kt:38-47</code> 的 <code>spinner(1..10, 1)</code>）。
    行上方的提示条目（引用数、问题计数…）上游叫 Code Vision，本仓的条目来自语言服务的
    <code>textDocument/codeLens</code> 与本地 problems provider。
  </p>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="settings.codeVisionEnabled" type="checkbox" aria-describedby="cv-enabled-hint" /><span>启用 Code Vision</span></label>
    <p id="cv-enabled-hint" class="field-hint restore-hint">上游 “Enable Code Vision”（<code>CodeVisionSettings.kt:36</code> 的 <code>isEnabled = true</code>，门面 <code>:55-60</code>）。关掉后行上方不再画任何条目；右键「隐藏所有 Code Vision 嵌入提示」写的就是同一把总闸。</p>
    <label v-for="id in GROUPS" :key="id" class="checkbox-row">
      <input type="checkbox" :checked="groupOn(id)" :aria-describedby="`cv-group-${id}-hint`" @change="toggleGroup(id, ($event.target as HTMLInputElement).checked)"
      /><span>显示 {{ codeVisionGroupName(id) }} 嵌入提示</span>
    </label>
    <p id="cv-group-LspCodeVisionProvider-hint" class="field-hint">两组开关 = 上游按 provider 分组的那一档（<code>CodeVisionSettings.kt:45</code> 的 <code>disabledCodeVisionProviderIds</code>，只装与出厂相反的那一半）。服务端下发的条目全归 <code>LspCodeVisionProvider</code> 一组、本地问题计数归 <code>problems</code> 一组，两组出厂都是开。</p>
    <p id="cv-group-problems-hint" class="field-hint restore-hint">右键某一组条目 →「隐藏 <code>Code Vision: …</code> 嵌入提示」写的也是这一格（<code>src/codeLensExtension.ts:134-136</code> 的 <code>handleCodeVisionExtraAction</code>）。</p>
    <div class="input-row">
      <label :for="spinnerId">声明上方可见的条数</label>
      <input :id="spinnerId" v-model.number="settings.codeVisionVisibleEntries" type="number" min="1" max="10" step="1" aria-describedby="cv-visible-count-hint" />
    </div>
    <p id="cv-visible-count-hint" class="field-hint">上游 “Visible metrics above declaration:”（<code>CodeVisionBundle.properties:17</code>）那一格，范围 <code>1..10</code>（<code>CodeVisionGlobalSettingsProvider.kt:43</code>），出厂 5（<code>CodeVisionSettings.kt:38-39</code>）。本仓的条目一律画在行**上方**，所以上游那两档（上方 / 旁边）在本仓只剩一档。</p>
  </fieldset>
</template>
