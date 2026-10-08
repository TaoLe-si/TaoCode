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
// **不渲染**上游那些本仓没有对应物的行：按语言分组的清单节点、`cases` 的逐条明细 ——
// 它们都要求「多个 provider / PSI 文件类型」这一层，而本仓只有 LSP 一个来源。
//
// 参数提示的**排除清单**（`ParameterHintsSettingsPanel.kt:18-22` 的 `settings.inlay.java.exclude.list`
// 那一行、面板本体 `ExcludeListPanel.kt`）在本批（2026-10-08 lane lp-editor）**落成本页的一格编辑框**：
// 键 `parameterHintExcludeList` 此前只活在读侧（`src/inlayHints.ts` 的
// `INLAY_HINT_EXCLUDE_LIST_SETTING_KEY`），因为落盘那三处（`EditorSettings` 类型 +
// `defaultEditorSettings` + native 白名单/默认值/校验 + 预览白名单）没登记 —— 页面放一个写不进去的
// 输入框就是假控件。现在六处都齐了（判据 `tests/inlay-hints-settings.test.mjs` 与
// `native/settings_editor_keys_test.cpp`），所以这一格真的能写进盘。
// 坏行按上游 `HintUtils.kt:44-53 getExcludeListInvalidLineNumbers` 的口径标出来并**禁用应用**
// （上游那一格同样用它禁「确定」）；盘上万一有坏行（手改文件），它只会被
// `compileExcludePatterns` 静默丢掉（上游 `ParameterHintExcludeListService.kt:96` 的 `mapNotNull`），
// 不会让整份设置存不下去。
//
// `settings` 是对话框那份**同一个** editor 草稿对象，保存仍由对话框的「应用」统一做。
// 本页不需要额外的运行时同步：编辑器侧是从同一份草稿直接读的
// （`src/components/CodeEditor.vue:223` 的 `toggles: () => inlayHintToggles(props.settings)`，
// 重画链是 `:920` 那个按 `inlayHintTogglesKey` 的 watch）。
import { computed, ref, watch } from 'vue'
import {
  INLAY_HINT_EXCLUDE_LIST_SETTING_KEY, INLAY_HINT_SETTING_KEYS,
  type InlayHintGroup, type InlayHintSettingKey,
} from '../inlayHints'
import { invalidExcludePatternLines, parseExcludeListText, renderExcludeListText } from '../inlayHintExcludeList'
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

// ── 参数提示的排除清单：编辑框用本地文本，按「应用清单」才写进草稿（半句模式不该被当成清单） ──
const excludeText = ref(renderExcludeListText(props.settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]))
// 草稿被别处改动（打开对话框时读盘、或「清空」按钮）⇒ 编辑框跟着走。写回的是同一份内容时
// `renderExcludeListText` 的结果逐字相同，不会自激。
watch(() => props.settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY], value => {
  excludeText.value = renderExcludeListText(value)
})
/** 坏行行号（0 起，与上游一致）；显示时 +1。非空 ⇒ 不许应用。 */
const invalidLines = computed(() => invalidExcludePatternLines(excludeText.value))
const excludeDirty = computed(() =>
  excludeText.value !== renderExcludeListText(props.settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY]))

function applyExcludeList() {
  if (invalidLines.value.length > 0) return
  props.settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY] = parseExcludeListText(excludeText.value)
}
/** 清空清单 = 出厂档（上游那份默认清单是 per-language FQN，本仓取空，见 inlayHintExcludeList.ts 口径差 3）。 */
function clearExcludeList() {
  props.settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY] = []
}
</script>

<template>
  <h3>编辑器 › 内联提示</h3>
  <fieldset class="settings-fields" :disabled="busy">
    <label v-for="group in GROUPS" :key="group.id" class="checkbox-row">
      <input
        type="checkbox"
        :checked="settings[INLAY_HINT_SETTING_KEYS[group.id]]"
        @change="toggle(INLAY_HINT_SETTING_KEYS[group.id], ($event.target as HTMLInputElement).checked)"
      /><span>{{ group.label }}</span>
    </label>
    <p class="field-hint">参数提示的排除清单：一行一条模式（glob），写 <code>key</code> 命中调用点的 <code>key:</code> 提示；<code>*</code> 只能在首/尾、一条最多两个，写错的行会被标出来。</p>
    <textarea
      v-model="excludeText"
      class="input-row"
      rows="4"
      spellcheck="false"
      placeholder="一行一条，例如：&#10;println&#10;log*"
      aria-label="参数提示排除清单"
    />
    <p v-if="invalidLines.length > 0" class="field-hint" role="alert">
      第 {{ invalidLines.map(number => number + 1).join('、') }} 行不是合法模式，改好之前不能应用。
    </p>
    <p v-else-if="!excludeDirty" class="field-hint">
      当前清单 {{ settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY].length }} 条；保存由本对话框的「应用」统一做。
    </p>
    <div class="input-row">
      <button type="button" :disabled="busy || invalidLines.length > 0 || !excludeDirty" @click="applyExcludeList">应用清单</button>
      <button
        type="button"
        :disabled="busy || settings[INLAY_HINT_EXCLUDE_LIST_SETTING_KEY].length === 0"
        @click="clearExcludeList"
      >清空</button>
    </div>
  </fieldset>
</template>
