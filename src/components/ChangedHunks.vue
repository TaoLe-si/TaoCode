<script setup lang="ts">
// 变更 diff 的**逐块暂存**（IDEA 提交查看器里"每一块都可以勾选、按块暂存/退回"那一层）。
//
// 从 `SourceControl.vue` 拆出来（那个文件贴着 900 行的机检上限，而这一段与变更列表无关 ——
// 它只吃一份 `hunks`、自己做选择与请求）。
//
// 上游口径：暂存 = `git apply --cached`、退回 = 反向 apply（`VcsActions.xml` 的 `Git.Stage.Hunk`
// 一族），本仓经 `git.applyHunks` 落到原生；勾选状态是**本组件的本地状态**，
// `hunks` 一换（换文件/换方向）就清空 —— 与面板原来 `showDiff` 里重建 `hunkPicked` 同义。
import { ref, watch } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import type { GitHunks } from '../bridge'
import { request } from '../bridge'
import { iconSize } from '../uiIcons'

const props = defineProps<{ path: string; staged: boolean; hunks?: GitHunks }>()
const emit = defineEmits<{ changed: [] }>()

const picked = ref<Set<number>>(new Set())
const error = ref('')
const busy = ref(false)
// `hunks` 换了就把勾选清掉（本组件是同一个实例复用的：面板换文件时不重建组件）。
watch(() => props.hunks, () => { picked.value = new Set(); error.value = '' })

function toggle(index: number) {
  const next = new Set(picked.value)
  if (next.has(index)) next.delete(index); else next.add(index)
  picked.value = next
}
function errorText(caught: unknown) { return caught instanceof Error ? caught.message : String(caught) }

/** 把勾选的块暂存（`reverse` = 把已暂存的块退回工作区）。 */
async function apply(reverse: boolean) {
  const list = props.hunks?.hunks ?? []
  if (!list.length || busy.value) return
  const indexes = list.filter(hunk => picked.value.has(hunk.index)).map(hunk => hunk.index)
  if (!indexes.length) return
  busy.value = true
  error.value = ''
  try {
    await request('git.applyHunks', { path: props.path, staged: props.staged, hunks: indexes, reverse })
    picked.value = new Set()
    emit('changed')
  } catch (caught) { error.value = errorText(caught) } finally { busy.value = false }
}
</script>

<template>
  <!-- IDEA 的提交查看器：diff 的每一块都可勾选，工具条只暂存/退回勾中的那些块。 -->
  <div v-if="hunks?.hunks.length" class="sc-hunks">
    <button class="sc-tool" :disabled="busy" title="把勾选的改动块暂存（git apply --cached）" @click="apply(false)"><Plus aria-hidden="true" :size="iconSize.control" />暂存勾选块</button>
    <button class="sc-tool" :disabled="busy" title="把勾选的已暂存块退回工作区（reverse apply）" @click="apply(true)"><Minus aria-hidden="true" :size="iconSize.control" />退回勾选块</button>
    <span class="sc-hunk-hint">{{ staged ? '已暂存差异' : '工作区差异' }} · {{ hunks.hunks.length }} 块</span>
  </div>
  <p v-if="error" class="sc-warning sc-hunk-error" role="status">{{ error }}</p>
  <div v-if="hunks?.hunks.length" class="sc-hunk-list">
    <label v-for="hunk in hunks.hunks" :key="hunk.index" class="sc-hunk">
      <input type="checkbox" :checked="picked.has(hunk.index)" @change="toggle(hunk.index)" />
      <code class="sc-hunk-header">{{ hunk.header.trim() }}</code>
      <span class="sc-hunk-counts">+{{ hunk.additions }} −{{ hunk.deletions }}</span>
    </label>
  </div>
</template>
