<script setup lang="ts">
// 项目视图齿轮里「外观」+「排序」两组的渲染（`pv/project-view` 族）。
//
// 上游成员表：`platform/projectView/shared/resources/intellij.platform.projectView.xml`
//   · `ProjectView.ToolWindow.Appearance.Actions`（`:56-105`）—— 本组件放**上游这一格里本仓真按得动**的三项：
//     `ProjectView.ShowScratchesAndConsoles`（`:81-84`，管树里那条合成根）、
//     `ProjectView.CompactDirectories`（`:98-99`）、`ProjectView.FileNesting`（`:101-102`），
//     次序也照这三行在 XML 里的先后（`:81` → `:98` → `:101`，上游在它们之间各放了一道 `<separator/>`）。
//     同组其余项按上游自己的能力位（`AbstractProjectViewPane.java:1025-1039` 四个 `supportsXxx` 默认 false）
//     逐条判定，不渲染点了没反应的项：
//       – `ShowLibraryContents`（`:76-80`）：**订正**（原写「本仓没有对应数据源」，实际是上游 Project 窗格
//         不支持这一格）—— `ProjectViewPane.java:143-145` 把值硬写成 true、
//         `AbstractProjectViewPane.java:1029-1031` 的 `supportsShowLibraryContents()` 是 false，
//         `ProjectViewImpl.java:491-495` 再按能力位决定这一项可不可点 ⇒ Project 窗格里它就是灰的。
//       – `ShowExcludedFiles`（`:68-71`，能力位 `ProjectViewPane.java:167-170` **支持**、默认 true
//         `ProjectViewSettings.java:11-13`）：这一格上游真按得动，本仓按不了 ——
//         被排除的目录在宿主那一层就从列举里剪掉了（`native/workspace.cpp:479` 的 `ignored_directory`），
//         前端拿不到「被排除的那些行」，也就无从「显示」。已登记接线请求（要宿主列举带出排除项 + 灰显）。
//       – `ShowMembers`/`ShowVisibilityIcons`/`ShowModules`/`FlattenModules`/`FlattenPackages`/
//         `AbbreviatePackageNames`/`HideEmptyMiddlePackages`/`ViewInplaceComments`/`CustomizeTrees`：
//         要 PSI / 模块模型 / 窗格贡献点，逐条理由见 `docs/batch-2026-10-06-bucket14a.md` 与
//         `docs/batch-2026-10-06-projecttree.md`。
//   · `ProjectView.ToolWindow.Sort.Actions`（`:106-130`）—— 本组件已有的 name/type/目录置顶。
//     上游的 `ProjectView.ManualOrder`（`:107-109`）与两条 SortByTime（`:119-126`）没有做：
//     `Entry`（`src/bridge.ts` 的 workspace.list 载荷）里没有 mtime，也没有手工排序的持久位。
//   · 组的**次序**照上游：Appearance 组（`:56`）在 Sort 组（`:106`）之前。
// 「文件嵌套…」这一格按 `ConfigureFilesNestingAction.update`（`.kt:30-32` + `:38-47`）的规矩办：
// 取不到当前窗格宿主就整格不渲染（上游是 `isEnabledAndVisible = false`）。
import { computed, ref } from 'vue'
import type { ProjectTreeSortSettings } from '../projectTreeSort'
import { Check } from 'lucide-vue-next'
import { iconSize } from '../uiIcons'
import { projectTreeHostFor } from '../projectTreeState'
import FileNestingSettings from './FileNestingSettings.vue'

const props = defineProps<{ settings: Readonly<ProjectTreeSortSettings>; persistenceError?: string }>()
const emit = defineEmits<{ update: [patch: Partial<ProjectTreeSortSettings>] }>()

// 只有拿到宿主（那个项目的 `ProjectViewState` 等价物）才谈得上改嵌套规则。
const host = computed(() => projectTreeHostFor(props.settings))
const nestingOpen = ref(false)
// 上游默认档：`ViewSettings.java:54-56`（缺键 = 显示）。
const showScratches = computed(() => props.settings.showScratchesAndConsoles ?? true)
</script>

<template>
  <!-- ProjectView.ToolWindow.Appearance.Actions: Scratches and Consoles / Compact Directories / File Nesting….
       Only the items this repository actually has a backend for, in the XML's order. -->
  <div v-if="host" role="group" aria-label="外观">
    <div class="menu-section-label" role="presentation">外观</div>
    <button class="menu-item" role="menuitemcheckbox" :aria-checked="showScratches" title="在树里显示或隐藏「临时文件与控制台」那一条合成根" @click="emit('update', { showScratchesAndConsoles: !showScratches })"><span class="menu-item-icon"><Check v-if="showScratches" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">显示临时文件和控制台</span></button>
    <div class="menu-rule" role="separator" />
    <button class="menu-item" role="menuitemcheckbox" :aria-checked="settings.compactDirectories ?? false" title="把只有一个子目录的目录与那个子目录并成一行" @click="emit('update', { compactDirectories: !(settings.compactDirectories ?? false) })"><span class="menu-item-icon"><Check v-if="settings.compactDirectories" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">压缩目录</span></button>
    <div class="menu-rule" role="separator" />
    <button class="menu-item" role="menuitem" title="配置文件嵌套规则" @click="nestingOpen = true"><span class="menu-item-icon" aria-hidden="true" /><span class="menu-item-title">文件嵌套…</span></button>
  </div>
  <!-- ProjectView.ToolWindow.Sort.Actions: name, type, [unsupported time],
       separator, folders always on top. No placeholder unsupported actions. -->
  <div role="group" aria-label="排序">
    <div class="menu-section-label" role="presentation">排序</div>
    <button class="menu-item" role="menuitemradio" :aria-checked="settings.sortKey === 'BY_NAME'" @click="emit('update', { sortKey: 'BY_NAME' })"><span class="menu-item-icon"><Check v-if="settings.sortKey === 'BY_NAME'" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">按名称</span></button>
    <button class="menu-item" role="menuitemradio" :aria-checked="settings.sortKey === 'BY_TYPE'" @click="emit('update', { sortKey: 'BY_TYPE' })"><span class="menu-item-icon"><Check v-if="settings.sortKey === 'BY_TYPE'" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">按类型</span></button>
    <div class="menu-rule" role="separator" />
    <button class="menu-item" role="menuitemcheckbox" :aria-checked="settings.foldersAlwaysOnTop" @click="emit('update', { foldersAlwaysOnTop: !settings.foldersAlwaysOnTop })"><span class="menu-item-icon"><Check v-if="settings.foldersAlwaysOnTop" :size="iconSize.menu" aria-hidden="true" /></span><span class="menu-item-title">目录始终在前</span></button>
  </div>
  <p v-if="persistenceError" class="persistence-warning" role="status">{{ persistenceError }}</p>
  <FileNestingSettings
    v-if="host && nestingOpen"
    :enabled="host.nesting.enabled"
    :rules="host.nesting.rules"
    :persistence-error="host.status.persistenceError"
    @apply="patch => host?.updateNesting(patch)"
    @close="nestingOpen = false"
  />
</template>

<style scoped>
.persistence-warning { max-width: 250px; padding: 4px 12px; color: var(--muted); font-size: 11px; }
</style>
