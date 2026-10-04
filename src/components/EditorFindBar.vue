<script setup lang="ts">
// 编辑器内查找栏 —— 上游 `SearchReplaceComponent`（`platform/lang-impl/src/com/intellij/find/SearchReplaceComponent.java`）
// 由 `EditorSearchSession` 驱动（`EditorSearchSession.java:137-157`），挂在 `editor.setHeaderComponent(...)` 上。
//
// **它不是 `FindPopupPanel`**（那是工程内查找对话框）。本仓早先只有 F3/Shift+F3 两条
// CodeMirror 命令，而那两条在"它自己的查找面板没开"时是空操作 —— 等于编辑器内查找整体缺席。
//
// 行内顺序照 `EditorSearchSession.java:238-265`（新 UI 的主动作组）：
//   状态文案 · 上一个 · 下一个 · 过滤组（在所选内容中搜索 打头）· 更多 · 关闭
// 第二行只在替换模式出现（`SwitchToReplace`），左侧是替换输入框，右侧是替换 / 全部替换
// （字段顺序照 `FindPopupPanel.java:786/791`：搜索框那侧是「区分大小写 / 单词 / 正则」，
//   替换框那侧是「保留大小写」—— 保留大小写只作用于替换结果，本仓的替换走字面量保留原样，
//   所以那一档在下面以**禁用态不出现在栏里**，而不是做成点了没反应的开关）。
//
// 文案全部取本机随 IDE 发货的中文语言包（`plugins/localization-zh/lib/localization-zh.jar`
// 的 `messages/FindBundle.properties`），不是自己译的：
//   区分大小写(&C) `:10` · 关闭 `:11` · 正则表达式(&X) `:65` · 搜索历史记录 `:96` ·
//   在所选内容中搜索 `:101` · 单词(&W) `:124`
// 导航两条取 `ActionsBundle.properties`：下一个匹配项(_X) `:1398` · 上一个匹配项(_O) `:1497`。
import { CaseSensitive, ChevronDown, ChevronUp, CornerDownLeft, History, Regex, Replace, ReplaceAll, Search, TextSelect, WholeWord, X } from 'lucide-vue-next'
import { nextTick, onMounted, ref, watch } from 'vue'
import { ICON_STROKE, iconSize } from '../uiIcons'
import type { SearchOptions } from '../editorSearch'

const props = defineProps<{
  query: string
  options: SearchOptions
  /** 「第 n / 共 m 条」（`StatusTextAction` 的等价物）。空串 = 不显示。 */
  status: string
  /** 查询词是坏正则（`PatternUtil` 报错的等价物）：输入框画红底。 */
  invalid: boolean
  /** 替换模式（`SwitchToReplace`）：多出第二行。 */
  replaceMode: boolean
  replaceText: string
  /** 历史下拉的候选（上游 `FindInProjectSettings.getRecentFindStrings`，`SearchTextArea.java:408-409`）。 */
  history: string[]
}>()
const emit = defineEmits<{
  update: [patch: Partial<SearchOptions>]
  /** 查询词变化（组件只报"用户改了什么"，写进 CodeMirror 由宿主做）。 */
  query: [value: string]
  replace: [value: string]
  next: []; previous: []
  close: []
  toggleReplace: []
  /** 切换「在所选内容中搜索」（Ctrl+Alt+E，栏里与编辑器里各有一条键位）。 */
  toggleInSelection: []
  replaceOne: []; replaceAll: []
}>()

const searchInput = ref<HTMLInputElement | null>(null)
const replaceInput = ref<HTMLInputElement | null>(null)
const historyOpen = ref(false)
// 打开栏即把光标放进搜索框（上游 SearchReplaceComponent 的输入框是 main-field）。
watch(() => props.replaceMode, async mode => {
  await nextTick()
  ;(mode ? replaceInput.value : searchInput.value)?.focus()
})
onMounted(() => searchInput.value?.focus())
defineExpose({
  focus: () => (props.replaceMode ? replaceInput.value : searchInput.value)?.focus(),
})

function onSearchKeydown(event: KeyboardEvent) {
  // Enter / Shift+Enter 就是 F3 / Shift+F3（上游输入框同样接管这两个键）。
  if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) emit('previous'); else emit('next'); return }
  // F3 / Shift+F3 在输入框里也要管（上游 `SearchReplaceComponent` 把动作组注册在整条栏上）。
  if (event.key === 'F3') { event.preventDefault(); if (event.shiftKey) emit('previous'); else emit('next'); return }
  // ToggleFindInSelection = Ctrl+Alt+E（`$default.xml`）。**必须在这里也接一份**：编辑器那张
  // keymap 只管 `.cm-editor` 内部，焦点在搜索框时按它等于没按（真机实测过）。
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'e') { event.preventDefault(); emit('toggleInSelection'); return }
  // Alt+Down 开搜索历史（`ShowSearchHistory` = alt DOWN，`$default.xml:1205-1206`）。
  if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); historyOpen.value = true; return }
  // Esc 两段式（上游 `SearchReplaceComponent.CloseAction` + `EscapeHandler`）：先收历史下拉，
  // 再关整条栏。输入框里的 Esc 由组件自己处理，不会冒泡到窗口级的其他 Esc 语义。
  if (event.key === 'Escape') {
    event.preventDefault()
    if (historyOpen.value) historyOpen.value = false
    else emit('close')
  }
}
function onReplaceKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') { event.preventDefault(); emit('replaceOne'); return }
  // 替换框里 F3 同样是"下一个匹配"（与搜索框、编辑器同一个语义）。
  onSearchKeydown(event)
}
function pickHistory(value: string) {
  historyOpen.value = false
  emit('query', value)
  searchInput.value?.focus()
}
</script>

<template>
  <div class="editor-find-bar" role="search" aria-label="在文件中查找">
    <div class="find-row">
      <span class="find-icon" aria-hidden="true"><Search :size="iconSize.control" :stroke-width="ICON_STROKE" /></span>
      <div class="find-field-wrap">
        <input
          ref="searchInput"
          class="find-field"
          :class="{ invalid }"
          type="text"
          role="searchbox"
          aria-label="搜索"
          placeholder="搜索"
          :value="query"
          @input="emit('query', ($event.target as HTMLInputElement).value)"
          @keydown="onSearchKeydown"
        />
        <button
          v-if="history.length"
          class="find-icon-button"
          type="button"
          title="搜索历史记录"
          aria-label="搜索历史记录"
          :aria-expanded="historyOpen"
          @click="historyOpen = !historyOpen"
        ><History :size="iconSize.menu" :stroke-width="ICON_STROKE" /></button>
        <div v-if="historyOpen" class="find-history" role="listbox" aria-label="搜索历史记录">
          <button v-for="row in history" :key="row" class="menu-button find-history-row" role="option" :aria-selected="false" @click="pickHistory(row)">{{ row }}</button>
        </div>
      </div>
      <span v-if="status" class="find-status" aria-live="polite">{{ status }}</span>
      <button class="find-icon-button" type="button" title="上一个匹配项 (Shift F3)" aria-label="上一个匹配项" @click="emit('previous')"><ChevronUp :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-icon-button" type="button" title="下一个匹配项 (F3)" aria-label="下一个匹配项" @click="emit('next')"><ChevronDown :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <span class="find-sep" role="separator" />
      <button class="find-toggle" type="button" :class="{ active: options.inSelection }" title="在所选内容中搜索" aria-label="在所选内容中搜索" :aria-pressed="options.inSelection" @click="emit('update', { inSelection: !options.inSelection })"><TextSelect :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-toggle" type="button" :class="{ active: options.caseSensitive }" title="区分大小写 (C)" aria-label="区分大小写" :aria-pressed="options.caseSensitive" @click="emit('update', { caseSensitive: !options.caseSensitive })"><CaseSensitive :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-toggle" type="button" :class="{ active: options.wholeWords }" title="单词 (W)" aria-label="单词" :aria-pressed="options.wholeWords" @click="emit('update', { wholeWords: !options.wholeWords })"><WholeWord :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-toggle" type="button" :class="{ active: options.regex }" title="正则表达式 (X)" aria-label="正则表达式" :aria-pressed="options.regex" @click="emit('update', { regex: !options.regex })"><Regex :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <span class="find-sep" role="separator" />
      <button class="find-icon-button" type="button" :class="{ active: replaceMode }" title="替换 (Ctrl R)" aria-label="切换替换" :aria-pressed="replaceMode" @click="emit('toggleReplace')"><Replace :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-icon-button" type="button" title="关闭 (Esc)" aria-label="关闭" @click="emit('close')"><X :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
    </div>
    <div v-if="replaceMode" class="find-row find-replace-row">
      <span class="find-icon" aria-hidden="true"><Replace :size="iconSize.control" :stroke-width="ICON_STROKE" /></span>
      <input
        ref="replaceInput"
        class="find-field find-replace-field"
        type="text"
        aria-label="替换为"
        placeholder="替换为"
        :value="replaceText"
        @input="emit('replace', ($event.target as HTMLInputElement).value)"
        @keydown="onReplaceKeydown"
      />
      <button class="find-icon-button" type="button" title="替换 (Enter)" aria-label="替换" @click="emit('replaceOne')"><CornerDownLeft :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
      <button class="find-icon-button" type="button" title="全部替换" aria-label="全部替换" @click="emit('replaceAll')"><ReplaceAll :size="iconSize.control" :stroke-width="ICON_STROKE" /></button>
    </div>
  </div>
</template>