<script setup lang="ts">
// 「编辑器 › 内联提示」页 —— 上游 `InlaySettingsConfigurable`（`inlay.hints`）。
//
// 注册证据：`platform/lang-impl/resources/intellij.platform.lang.impl.xml:935-941`
//   `<projectConfigurable provider="com.intellij.codeInsight.hints.settings.InlaySettingsConfigurableProvider"
//      id="inlay.hints" parentId="editor" key="settings.hints" bundle="messages.ApplicationBundle"
//      dynamic="true" groupWeight="1"/>` —— 挂在「编辑器」下（`parentId="editor"`）。
//   页面类同款 id 见 `InlaySettingsConfigurable.kt:15`（`const val INLAY_ID = "inlay.hints"`）与 `:51`。
//
// 上游面板（`InlaySettingsPanel.kt`）是**按 provider 的清单树**：每个 `InlayProviderSettingsModel`
// 一个节点，节点上 `isEnabled` 是那个 provider 的总开关（`platform/lang-api/.../InlayProviderSettingsModel.kt:26`），
// 节点下再挂 `cases`（`:127`）。
// 本仓的 provider 只有**一个** —— LSP 的 `textDocument/inlayHint`（宿主转发见
// `native/lsp_session.cpp:829-854`，它把 `kind` 也带上来）。所以「清单树」在本仓等价于
// **按 LSP `kind` 分的三档**（规范：1 = Type，2 = Parameter；其余归第三档）：
// 上游语言插件按 provider 分的那几行，在 LSP 世界里就是 kind 的那几个取值。
// 三把键与分组的唯一定义处是 `src/inlayHints.ts` 的 `INLAY_HINT_SETTING_KEYS`（与本页同一个源）。
//
// **不渲染**上游那些本仓没有对应物的行：按语言分组的清单节点、`cases` 的逐条明细、
// 排除清单链接（`ParameterHintsSettingsPanel.kt:18-22` 的 `settings.inlay.java.exclude.list`）——
// 它们都要求「多个 provider / PSI 文件类型」这一层，而本仓只有 LSP 一个来源。
//
// `settings` 是对话框那份**同一个** editor 草稿对象，保存仍由对话框的「应用」统一做。
import { INLAY_HINT_SETTING_KEYS, type InlayHintGroup, type InlayHintSettingKey } from '../inlayHints'
import type { EditorSettings } from '../settingsModel'

const props = defineProps<{ settings: EditorSettings; busy?: boolean }>()

/** 三档的标签与说明。分组 id 与 `inlayHints.ts` 的 `InlayHintGroup` 一一对应（不是另编一套）。 */
const GROUPS: { id: InlayHintGroup; label: string; hint: string }[] = [
  { id: 'type', label: '类型提示', hint: '推断出的类型（LSP inlayHint 的 kind = 1）。' },
  { id: 'parameter', label: '参数名提示', hint: '调用点的参数名（LSP inlayHint 的 kind = 2）—— 对应上游的 Parameter Hints。' },
  { id: 'other', label: '其它提示', hint: '语言服务给了 kind 或没给 kind 的那些。' },
]

/** 写回那三格之一（键名由 `INLAY_HINT_SETTING_KEYS` 给，页面不自己拼字符串）。 */
function toggle(key: InlayHintSettingKey, checked: boolean) {
  props.settings[key] = checked
}
</script>

<template>
  <h3>编辑器 › 内联提示</h3>
  <p class="section-description">
    对应 IDEA Settings › Editor › Inlay Hints（注册证据 <code>intellij.platform.lang.impl.xml:935-941</code>，
    <code>parentId="editor" id="inlay.hints" groupWeight="1"</code>）。
  </p>
  <fieldset class="settings-fields" :disabled="busy">
    <label v-for="group in GROUPS" :key="group.id" class="checkbox-row">
      <input
        type="checkbox"
        :checked="settings[INLAY_HINT_SETTING_KEYS[group.id]]"
        @change="toggle(INLAY_HINT_SETTING_KEYS[group.id], ($event.target as HTMLInputElement).checked)"
      /><span>{{ group.label }}</span>
    </label>
    <p class="field-hint">
      上游这一页是**按 provider 的清单树**（<code>InlaySettingsPanel.kt</code> +
      <code>InlayProviderSettingsModel.isEnabled</code>，<code>platform/lang-api/…/InlayProviderSettingsModel.kt:26</code>），
      本仓只有一个 provider（LSP 的 <code>textDocument/inlayHint</code>），于是那棵树塌成上面三格
      （<code>kind</code> 1 = Type、2 = Parameter，其余归第三档）。提示的来源与渲染见
      <code>src/editorInlayHints.ts</code>；按语言分组的清单节点、逐条 case 明细与排除清单需要
      「多个 provider / 文件类型」这一层，本仓没有，故不渲染。
    </p>
  </fieldset>
</template>
