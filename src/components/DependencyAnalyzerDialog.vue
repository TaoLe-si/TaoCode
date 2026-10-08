<script setup lang="ts">
// 依赖分析器对话框 —— 上游 `DependencyAnalyzerViewImpl` 的可移植子集
// （`DependencyAnalyzerAction` 打开的编辑器页，`DependencyAnalyzerVirtualFile`）。
//
// 视图结构照源码：
//   · 头部：工程选择器（本仓每个 build 各自打开一次，由宿主决定传入哪一个）；
//   · 第一行工具条：文本过滤（`dependencyDataFilterProperty`）、「显示 groupId」开关
//     （`showDependencyGroupIdProperty`）、列表/树切换（`showDependencyTreeProperty`）、
//     「只看告警」（`toggleAction(showDependencyWarningsProperty)`）；
//   · 配置过滤器（`SearchScopeSelector` + `ScopeItem`）：标准配置在前、自定义在后，默认全选；
//   · 左列表：按坐标成组的依赖行 —— 组文本取 `getDisplayText`，后跟 `(N 个配置)` 或唯一配置名
//     （`DependencyUiUtil.kt:62-67`），有告警的组用告警色（`:49-51` 的 Warning 图标口径）；
//   · 右 usages 树：选中组的所有出现位置 = 根到叶的 parent 链（`:350-365 getTreePath`）。
//
// 上游的 Omitted 状态、声明位置跳转（GoTo）与「重新同步」通知在 `src/dependencyAnalyzer.ts`
// 文件头写明为什么本仓没有数据源，这里不画假按钮。
import { computed, ref } from 'vue'
import { AlertTriangle, ChevronRight, X } from 'lucide-vue-next'
import type { GradleDependencyScope } from '../gradle.ts'
import {
  analyzerDisplayText, analyzerScopeItems, analyzerSummary, analyzerTreePath, analyzerUsagesTree,
  buildAnalyzerDependencies, createDependencyGroups, filterAnalyzerGroups,
  type AnalyzerDependencyGroup,
} from '../dependencyAnalyzer.ts'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  scopes: GradleDependencyScope[]
  /** 根模块名（上游 `DAModule(moduleData.moduleName)`）。 */
  moduleName: string
  /** 工程显示名（列表头用）。 */
  projectLabel: string
}>()
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const showGroupId = ref(false)
const showAsTree = ref(false)
const warningsOnly = ref(false)
const unselectedScopes = ref(new Set<string>())
const selectedIndex = ref(0)

const dependencies = computed(() => buildAnalyzerDependencies(props.scopes, props.moduleName))
const groups = computed(() => createDependencyGroups(dependencies.value))
const scopeItems = computed(() => analyzerScopeItems(props.scopes))
const activeScopes = computed(() => scopeItems.value.filter(item => !unselectedScopes.value.has(item.name)).map(item => item.name))
const filtered = computed(() => filterAnalyzerGroups(groups.value, {
  dataFilter: query.value, scopes: activeScopes.value, showWarningsOnly: warningsOnly.value, showGroupId: showGroupId.value,
}))
const selected = computed<AnalyzerDependencyGroup | null>(() => filtered.value[Math.min(selectedIndex.value, filtered.value.length - 1)] ?? null)
const summary = computed(() => analyzerSummary(groups.value))
const usages = computed(() => selected.value ? analyzerUsagesTree(selected.value) : [])
/** 列表形态：把每条依赖按 parent 链缩进（上游的 DependencyTree 视图）。 */
const treeRows = computed(() => filtered.value.flatMap(group => group.variances.map((variance, index) => ({
  group, index, variance, path: analyzerTreePath(variance),
}))))

function toggleScope(name: string) {
  const next = new Set(unselectedScopes.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  unselectedScopes.value = next
}
const emptyText = computed(() => warningsOnly.value ? '没有带告警的依赖。' : '没有匹配的依赖。')
</script>

<template>
  <div class="analyzer-backdrop" role="dialog" aria-modal="true" aria-label="依赖分析">
    <div class="analyzer">
      <header class="analyzer-header">
        <strong>依赖分析 · {{ projectLabel }}</strong>
        <span class="analyzer-summary">{{ summary.groups }} 个坐标 / {{ summary.dependencies }} 条出现<template v-if="summary.conflicts"> · {{ summary.conflicts }} 个版本冲突</template><template v-if="summary.unresolved"> · {{ summary.unresolved }} 个无法解析</template></span>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.control" /></button>
      </header>
      <div class="analyzer-toolbar">
        <input v-model="query" type="search" aria-label="依赖过滤" placeholder="坐标、版本" />
        <label><input v-model="showGroupId" type="checkbox" />显示 groupId</label>
        <label><input v-model="showAsTree" type="checkbox" />树形列表</label>
        <label><input v-model="warningsOnly" type="checkbox" />只看告警</label>
      </div>
      <div class="analyzer-scopes" role="group" aria-label="配置过滤">
        <button v-for="scope in scopeItems" :key="scope.name" class="scope-chip"
          :class="{ off: unselectedScopes.has(scope.name) }" :title="scope.type === 'STANDARD' ? '标准配置' : '自定义配置'"
          :aria-pressed="!unselectedScopes.has(scope.name)" @click="toggleScope(scope.name)">{{ scope.name }}</button>
      </div>
      <div class="analyzer-body">
        <ul v-if="!showAsTree" class="analyzer-list" role="listbox" aria-label="已解析依赖">
          <li v-for="(group, index) in filtered" :key="index" role="option" :aria-selected="group === selected"
            :class="{ selected: group === selected, warning: group.hasWarnings }" @click="selectedIndex = index">
            <AlertTriangle v-if="group.hasWarnings" :size="iconSize.inline" />
            <span class="name">{{ analyzerDisplayText(group.data, showGroupId) }}</span>
            <span class="scope-count">{{ group.scopes.length === 1 ? group.scopes[0].name : `${group.scopes.length} 个配置` }}</span>
            <span v-for="warning in group.warnings.slice(0, 1)" :key="warning.title" class="warning-text" :title="warning.message">{{ warning.title }}</span>
          </li>
        </ul>
        <ul v-else class="analyzer-list" role="tree" aria-label="依赖树">
          <li v-for="row in treeRows" :key="`${row.group.dependency.data.kind}:${row.index}`" role="treeitem"
            :class="{ warning: row.group.hasWarnings }" :style="{ paddingLeft: `${4 + row.path.length * 14}px` }">
            <ChevronRight :size="iconSize.dense" />
            <span class="name">{{ analyzerDisplayText(row.variance.data, showGroupId) }}</span>
            <span class="scope-count">{{ row.variance.scope.name }}</span>
          </li>
        </ul>
        <div class="analyzer-usages">
          <h4 v-if="selected">{{ analyzerDisplayText(selected.data, true) }} 的出现位置</h4>
          <p v-if="!selected" class="analyzer-empty">{{ emptyText }}</p>
          <ul v-else role="tree" aria-label="依赖用法">
            <li v-for="(path, index) in usages" :key="index" role="treeitem">
              <template v-for="(step, depth) in path" :key="depth">
                <span :style="{ paddingLeft: `${depth * 14}px` }" class="usage-step">{{ analyzerDisplayText(step.data, showGroupId) }}<span class="usage-scope">{{ step.scope.name }}</span></span>
              </template>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analyzer-backdrop { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:var(--backdrop); }
.analyzer { display:flex; flex-direction:column; width:min(920px,92vw); height:min(620px,86vh); background:var(--popup-background); color:var(--popup-foreground); border:var(--popup-border); border-radius:var(--popup-radius); box-shadow:var(--popup-shadow); }
.analyzer-header { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-2); border-bottom:1px solid var(--line); font-size:12px; }
.analyzer-summary { color:var(--muted); font-size:11px; }
.analyzer-header .icon-button { margin-left:auto; }
.analyzer-toolbar { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-2); font-size:11px; }
.analyzer-toolbar input[type="search"] { flex:1; min-width:80px; background:var(--editor); color:var(--text); border:1px solid var(--line); }
.analyzer-toolbar label { display:flex; align-items:center; gap:3px; white-space:nowrap; color:var(--muted); }
.analyzer-scopes { display:flex; flex-wrap:wrap; gap: var(--space-1); padding:0 var(--space-2) var(--space-2); }
.scope-chip { border:1px solid var(--line); background:var(--editor); color:var(--text); font-size:10px; padding:1px 6px; cursor:pointer; }
.scope-chip.off { color:var(--muted); text-decoration:line-through; }
.analyzer-body { display:flex; flex:1; min-height:0; border-top:1px solid var(--line); }
.analyzer-list { flex:1; min-width:0; margin:0; padding:2px; overflow:auto; list-style:none; font:11px/1.7 var(--font-mono); }
.analyzer-list li { display:flex; align-items:center; gap: var(--space-1); padding: 1px var(--space-1); cursor:pointer; transition: background-color var(--dur-1) var(--ease); }
.analyzer-list li:hover { background:var(--hover); }
.analyzer-list li.selected { background:var(--selected); }
.analyzer-list li.warning .name { color:var(--warning, var(--error)); }
.analyzer-list .name { color:var(--text); }
.scope-count, .usage-scope { color:var(--muted); font-size:10px; }
.warning-text { margin-left:auto; color:var(--error); font-size:10px; }
.analyzer-usages { width:44%; min-width:0; overflow:auto; border-left:1px solid var(--line); padding:var(--space-2); }
.analyzer-usages h4 { margin:0 0 var(--space-1); font-size:11px; color:var(--bright); overflow-wrap:anywhere; }
.analyzer-usages ul { margin:0; padding:0; list-style:none; font:10px/1.8 var(--font-mono); }
.usage-step { display:block; color:var(--text); }
.analyzer-empty { color:var(--muted); font-size:11px; }
</style>
