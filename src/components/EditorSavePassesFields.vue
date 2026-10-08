<script setup lang="ts">
// 「编辑器 › 常规」里**保存时两条 pass** 的那三格 —— 上游面板
// `platform/lang-impl/src/com/intellij/application/options/editor/EditorOptionsPanel.kt`：
//   · :156-157 `cdStripTrailingSpacesEnabled`，文案键 `combobox.strip.trailing.spaces.on.save`
//     （`platform/ide-core/resources/messages/ApplicationBundle.properties:359`
//     "Remove trailing spaces on:"）；上游是「复选框 + 下拉」两段（`:322-340`：复选框关掉时
//     `StripTrailingSpacesProxy.setScope` 写 `STRIP_TRAILING_SPACES_NONE`，见 `:523`），
//     两档文案 = ApplicationBundle.properties:242 "Modified lines" / :243 "All lines"。
//     本仓把三段合成一个下拉（`None` / `Changed` / `Whole` = 上游常量字面值，
//     `platform/ide-core-impl/src/com/intellij/openapi/editor/ex/EditorSettingsExternalizable.java:216-218`），
//     少一次"复选框勾着但范围没选"的无效态；值域与默认值一个字没改。
//   · :147-149 `cdEnsureBlankLineBeforeCheckBox`，文案键 `editor.options.line.feed`
//     （ApplicationBundle.properties:815 "Ensure every saved file ends with a line break"）。
//   · :153-155 `cdKeepTrailingSpacesOnCaretLine`，文案键
//     `editor.settings.keep.trailing.spaces.on.caret.line`（ApplicationBundle.properties:689
//     "Keep trailing spaces on caret line"）。
// 默认值逐条对上游 `EditorSettingsExternalizable.java`：:73 Changed、:74 false、:142 true。
// 执行体在 `src/editorSaveTransforms.ts`（`saveTrimOptionsFromSettings` 读这三条，
// `applySaveTextTransforms` 落文本），不是这里新造的行为。
//
// **不落**上游的 `REMOVE_TRAILING_BLANK_LINES`（同文件 :75）：本仓还没有它的执行体，
// 落了就是一格没有消费链路的假控件。
//
// `settings` 是对话框那份**同一个** editor 草稿对象，保存仍由对话框的「应用」统一做。
import { useId } from 'vue'
import type { EditorSettings } from '../settingsModel'

defineProps<{ settings: EditorSettings; busy?: boolean }>()
// 下拉的 id：`label for` 与 `aria-describedby` 都要指得准，组件自己生成，不跟对话框抢 id 前缀。
const selectId = useId()

// 三档的标签：`None` 与 `Changed`/`Whole` 是上游常量（:216-218），文案是那两个键的英文原文直译。
const OPTIONS = [
  { value: 'None', label: '不去除' },
  { value: 'Changed', label: '只清改动过的行' },
  { value: 'Whole', label: '整个文件' },
] as const
</script>

<template>
  <div class="input-row">
    <label :for="selectId">保存时去除行尾空白</label>
    <select :id="selectId" v-model="settings.stripTrailingSpaces">
      <option v-for="option in OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </div>
  <label class="checkbox-row"><input v-model="settings.ensureNewLineAtEof" type="checkbox" /><span>确保每个保存的文件都以换行结尾</span></label>
  <label class="checkbox-row"><input v-model="settings.keepTrailingSpacesOnCaretLine" type="checkbox" /><span>光标所在行保留行尾空白</span></label>
</template>
