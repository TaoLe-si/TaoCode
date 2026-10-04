<script setup lang="ts">
// 合并冲突导航条（上游 `MergeThreesideViewer` 的按钮与导航在本仓的落点）。
//
// 上游是三栏合并工具，读 VCS 给的三份内容；本仓走标记文本那条路（同一场景的另一种入口，
// 见 `src/mergeConflicts.ts` 的文件头）。条上四样：未决计数 · 上一个 · 下一个 · 接受左侧/接受右侧。
// **没有「接受两者」**：上游那个工具里也没有这个按钮，做了就是发明（想两边都要就在缓冲区里手编）。
//
// 冲突清单由宿主（`CodeEditor.vue`）从**实时文档**解析好传进来 —— 不在这里读 `props.content`：
// 父级的 tab.content 只在读盘/存盘时更新，编辑期间是打开时那一份，计数会停在旧值上。
import { computed } from 'vue'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { ACCEPT_LEFT_TEXT, ACCEPT_RIGHT_TEXT, CONFLICTS_BANNER, conflictStatus, type Conflict } from '../mergeConflicts'

const props = defineProps<{
  /** 当前文档里的冲突（宿主从实时文档解析）。 */
  conflicts: readonly Conflict[]
  /** 光标所在行（0 基）—— 计数显示"第几条"。 */
  line: number
}>()
const emit = defineEmits<{ accept: [side: 'left' | 'right']; next: [backwards: boolean] }>()

const status = computed(() => conflictStatus(props.conflicts, props.line))
</script>

<template>
  <div v-if="props.conflicts.length" class="merge-bar" role="status" aria-label="合并冲突">
    <span class="merge-bar-title">{{ CONFLICTS_BANNER }}</span>
    <span class="merge-bar-count" aria-live="polite">{{ status }}</span>
    <button class="find-icon-button" type="button" title="上一个冲突" aria-label="上一个冲突" @click="emit('next', true)"><ChevronUp :size="iconSize.control" /></button>
    <button class="find-icon-button" type="button" title="下一个冲突" aria-label="下一个冲突" @click="emit('next', false)"><ChevronDown :size="iconSize.control" /></button>
    <span class="find-sep" role="separator" />
    <button class="merge-bar-action" type="button" :title="ACCEPT_LEFT_TEXT" @click="emit('accept', 'left')">{{ ACCEPT_LEFT_TEXT }}</button>
    <button class="merge-bar-action" type="button" :title="ACCEPT_RIGHT_TEXT" @click="emit('accept', 'right')">{{ ACCEPT_RIGHT_TEXT }}</button>
  </div>
</template>
