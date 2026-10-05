<script setup lang="ts">
// 一个归档（jar/zip）的**条目清单**那一片画面 —— 上游是「归档当一个目录」：
// `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9-12` 的 `jar://` + `!/`，
// `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:92`
// （`composeRootPath`：`"/x/y.jar" -> "/x/y.jar!/"`）与 `:86`（`extractLocalPath`，反函数）。
//
// 行的形状、排序、层级、`jar://` url 全在 `src/rootsJarEntries.ts` 那一份规则里，
// 取数与"通道在不在"在 `src/jarEntriesSource.ts`。这个组件**只画**：
//   · 拿不到清单（宿主没这条通道 / 归档读不出）⇒ `rows` 是空 ⇒ `v-if` 整块不渲染，
//     不画「（空）」、不画占位行（上游没有 VFS 就没有这些行，画出来就是假数据）；
//   · 一行都读不了（本仓没有"读任意档案内条目"的通道，上游 `ArchiveFileSystem.java:99-100`
//     对归档的写操作也一律抛）⇒ 这里就不给点击、不给按钮。行是 `role="treeitem"` 的**文本**。
import { computed, ref, watch } from 'vue'
import { FileCode2, FileText, Folder } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { loadJarListing, type ArchiveLister, type JarListing } from '../jarEntriesSource.ts'
import { jarUrl } from '../rootsJarEntries.ts'

const props = defineProps<{ archive: string; lister?: ArchiveLister }>()
const listing = ref<JarListing | null>(null)

async function reload() {
  listing.value = await loadJarListing(props.archive, props.lister)
}
watch(() => [props.archive, props.lister] as const, () => { void reload() }, { immediate: true })

const rows = computed(() => listing.value?.rows ?? [])
const truncated = computed(() => listing.value?.truncated === true)
/** 缩进按 `depth`（档案内层级）走，间距只用 token，不写像素魔数。 */
const rowStyle = (depth: number) => ({ paddingLeft: `calc(var(--space-2) + var(--space-3) * ${depth + 1})` })
</script>

<template>
  <div v-if="rows.length" class="jar-entries">
    <p v-if="truncated" class="jar-note">条目过多，清单已截断。</p>
    <div role="tree" aria-label="档案条目" class="jar-tree">
      <div
        v-for="row in rows"
        :key="row.key"
        class="jar-row"
        :class="{ 'jar-dir': row.directory }"
        :style="rowStyle(row.depth)"
        role="treeitem"
        :aria-level="row.depth + 1"
        :title="jarUrl(archive, row.path)"
      >
        <Folder v-if="row.directory" :size="iconSize.toolbar" class="jar-icon" aria-hidden="true" />
        <FileCode2 v-else-if="row.source" :size="iconSize.toolbar" class="jar-icon" aria-hidden="true" />
        <FileText v-else :size="iconSize.toolbar" class="jar-icon" aria-hidden="true" />
        <span class="jar-name">{{ row.name }}</span>
        <span v-if="row.className" class="jar-class">{{ row.className }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jar-entries { display: flex; flex-direction: column; gap: var(--space-1); }
.jar-tree { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--editor); overflow: hidden; }
.jar-row { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); font: 12px/1.6 var(--font-mono); color: var(--text); overflow-wrap: anywhere; }
.jar-row:last-child { border-bottom: 0; }
.jar-dir { color: var(--secondary); font-weight: 500; }
.jar-icon { flex-shrink: 0; color: var(--syntax-meta); align-self: center; }
.jar-class { margin-left: auto; color: var(--muted); font: 11px var(--font-mono); }
.jar-note { margin: 0; color: var(--muted); font-size: 11px; }
</style>
