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
// 本仓四组 provider 出厂都是开 ⇒ 界面上只会写 `codeVisionDisabledGroups`；
// `codeVisionEnabledGroups`（`:50`）由 `codeVisionSettingsPatch()` 存盘、`restoreCodeVisionSettings()` 读回，
// 等出现「出厂关着的 provider」时才有写入方 —— 现在没有，就不假装有一个勾选框。
//
// 消费链路（逐条点名，不是本页自造的行为）：
//   · 总闸与每组的开关 → `shouldShowCodeVisionEntry`（`src/codeLensSettings.ts`），
//     渲染侧的过滤点是 `src/codeLensExtension.ts` 的 `buildDecorations` 里那一行
//     `lenses.filter(lens => shouldShowCodeVisionEntry(codeVisionGroupId(lens.item)))`；
//     订正留痕（2026-10-06 codelens2）：原写「那一行还没接、只有导入没有调用点」是 K-4 之前的状态，
//     现在调用点在，并且有**渲染结果级**的判据（`tests/code-lens-grouping.test.mjs` 逐组关一遍、
//     数装饰集里还剩哪几条，不是读源码文本）。
//   · 每行可见条数 → `groupAnchoredLenses(visible, codeVisionVisibleEntryLimit())`（`src/codeLens.ts:149-150`，
//     出厂 `CODE_LENS_VISIBLE_MAX = 5`，`src/codeLens.ts:127`），调用点在 `codeLensExtension.ts` 的 `buildDecorations`；
//     本页 `syncRuntime()` 也刷这一格（2026-10-06 codelens2 落 `docs/wiring-requests-2026-10-06-lensgate.md` 的 L-3）。
//   · 右键「隐藏这一组 / 全部隐藏」→ `handleCodeVisionExtraAction`（`src/codeLensExtension.ts` 在用）。
import { onMounted, watch } from 'vue'
import { useId } from 'vue'
import {
  CODE_VISION_GROUP_IDS,
  codeVisionGroupName, codeVisionSettings, codeVisionVisibleEntryLimit, setCodeVisionGroupEnabled,
} from '../codeLensSettings.ts'
import type { EditorSettings } from '../settingsModel'

const props = defineProps<{ settings: EditorSettings; busy?: boolean }>()

// 本仓的四个 provider 组：**取渲染侧那一份白名单**（`CODE_VISION_GROUP_IDS`），页面不自己列。
// 自己列就会少 —— 原来只列了两组，而 `src/codeVisionProviders.ts` 的注册表其实会产出
// `references`（用法计数）与 `inheritors`（继承者计数）两组的条目：那两组既能由右键
// 「隐藏这一组」写进运行时表，又会被这里的 `syncRuntime()` 按白名单**重新打开**
// （旧实现只刷两组 ⇒ 用户右键隐藏了用法计数，一回到本页就被勾回来）。
// 组名走 `codeVisionGroupName`，页面不自己拼字符串。
const GROUPS = CODE_VISION_GROUP_IDS
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

/** 运行时表按草稿对象刷一遍（打开页面时、以及四把键任何一个变了之后）。 */
function syncRuntime() {
  codeVisionSettings.enabled = props.settings.codeVisionEnabled
  for (const id of GROUPS) setCodeVisionGroupEnabled(id, groupOn(id))
  // 每锚点条数也刷（`docs/wiring-requests-2026-10-06-lensgate.md` 的 L-3）：没有这一句，
  // 这一格要等重启才见效（读盘那一份由 `src/workspaceLifecycle.ts` 的 `restoreCodeVisionSettings` 灌）。
  // 坏值（清空输入框 = 0 / NaN / 小数）由 `codeVisionVisibleEntryLimit` 自己兜回出厂 5，
  // 页面不再发明第二条兜底口径；界 1..10 的原生校验在 `native/settings_editor_keys.hpp`。
  codeVisionSettings.visibleEntries = codeVisionVisibleEntryLimit(
    { ...codeVisionSettings, visibleEntries: props.settings.codeVisionVisibleEntries })
}
onMounted(syncRuntime)
watch(() => `${props.settings.codeVisionEnabled}|${props.settings.codeVisionDisabledGroups.join(',')}|${props.settings.codeVisionEnabledGroups.join(',')}|${String(props.settings.codeVisionVisibleEntries)}`, syncRuntime)
</script>

<template>
  <h3>编辑器 › Code Vision</h3>
  <fieldset class="settings-fields" :disabled="busy">
    <label class="checkbox-row"><input v-model="settings.codeVisionEnabled" type="checkbox" /><span>启用 Code Vision</span></label>
    <label v-for="id in GROUPS" :key="id" class="checkbox-row">
      <input type="checkbox" :checked="groupOn(id)" @change="toggleGroup(id, ($event.target as HTMLInputElement).checked)"
      /><span>显示 {{ codeVisionGroupName(id) }} 嵌入提示</span>
    </label>
    <div class="input-row">
      <label :for="spinnerId">声明上方可见的条数</label>
      <input :id="spinnerId" v-model.number="settings.codeVisionVisibleEntries" type="number" min="1" max="10" step="1" />
    </div>
  </fieldset>
</template>
