<script setup lang="ts">
// 「包依赖分析」对话框 —— 上游 `packageDependencies` 的 `PackageDependenciesView` +
// `PackageDependenciesProjectService`（PSI 引用图上建包图、找循环）的对应物。
//
// 数据链：`workspace.files` 拿文件清单 → `search.run` 用 IMPORT_SCAN_QUERY 扫导入行 →
// src/packageDeps.ts 建目录级图并跑 Tarjan 找循环；范围（项目/测试/生成/全部）、视图选项
// （只看循环/显示文件/按范围分组/仅显示非法依赖）与依赖闭包（正向/反向）在 src/packageDepsView.ts ——
// 上游分别是 `DefaultScopesProvider`/`TestScopeProvider`/`GeneratedFilesScopeProvider`、
// `DependencyUISettings` 与 `FindDependencyUtil`。点一条边跳到产生它的导入行。
//
// 依赖规则（「编辑规则」那一节）：规则本体与判定在 `src/dependencyRules.ts`
// （上游 `DependencyValidationManagerImpl` + `DependencyRule`），作用域选择项的 id/显示名映射在
// `src/scopeIdMapper.ts`（上游 `ScopeIdMapper`）。入口按钮与上游同一处：依赖视图的工具条上有
// `EditDependencyRulesAction`（`DependenciesPanel.java:748-760`，文案 `action.edit.rules` = 编辑规则），
// 点它打开 `DependencyConfigurable`（表头文案 = `dependency.configurable.*`，CodeInsightBundle:440-444）。
// 只读：不做「排除依赖/忽略循环」这类会改工程的动作（上游那是 packageDependencies 的设置面，
// 本仓没有对应设置存储）。
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, RefreshCw, Settings, Trash2, X } from 'lucide-vue-next'
import { isDesktop, request, type ProjectFileList, type ProjectSettings, type SearchMatch, type SearchResult } from '../bridge'
import { buildPackageGraph, collectImports, findDependencyCycles, IMPORT_SCAN_QUERY, type ImportRef, type PackageEdge } from '../packageDeps'
import {
  applyPackageDepsSettings, dependencyClosure, directDependencies, groupEdgesByScope, loadPackageDepsSettings,
  PACKAGE_SCOPES, packageDisplay, savePackageDepsSettings, SCOPE_KIND_TITLES, scopeUniverse,
  type PackageDepsSettings, type PackageScopeId,
} from '../packageDepsView'
import {
  findDependencyViolations, hasDependencyRules, isIllegalEdge, loadDependencyRules,
  NO_ILLEGAL_DEPENDENCIES_TEXT, ruleDisplayText, saveDependencyRules, scopeRefFromId,
  type DependencyRuleContext, type DependencyRule, type DependencyScopeRef,
} from '../dependencyRules'
import { DEPENDENCY_SCOPE_OPTIONS } from '../scopeIdMapper'
import { iconSize } from '../uiIcons'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ (event: 'open', payload: { path: string; line: number }): void; (event: 'close'): void }>()

const imports = ref<ImportRef[]>([])
const allFiles = ref<string[]>([])
const scope = ref<PackageScopeId>('project')
const settings = ref<PackageDepsSettings>(loadPackageDepsSettings())
const focus = ref('')
const truncated = ref(false)
const running = ref(false)
const scanned = ref(false)
const error = ref('')
const showEdges = ref(false)
/** 规则编辑那一节是不是展开着（上游 `EditDependencyRulesAction` 开的是同一个 `DependencyConfigurable`）。 */
const editingRules = ref(false)
/** 工程里的命名作用域（`ProjectSettings.scopes`）—— 规则的两个 scope 从这里面选。 */
const namedScopes = ref<{ name: string; pattern: string }[]>([])
const rules = ref<DependencyRule[]>([])
/** 新增那一行的草稿：两个 scope 的序列化 id + 是否 deny（`DependencyRule.java:13-22` 的三段）。 */
const draft = ref<{ from: string; to: string; deny: boolean }>({ from: 'Project Files', to: 'Generated Files', deny: true })
const rulesNote = ref('')

const universe = computed(() => scopeUniverse(allFiles.value, scope.value))
const graph = computed(() => buildPackageGraph(imports.value, universe.value))
const cycles = computed(() => findDependencyCycles(graph.value))
const ruleContext = computed<DependencyRuleContext>(() => ({ namedScopes: namedScopes.value }))
/** 规则跑在**过滤前**的整图上（上游 `DependenciesBuilder` 也是先建全图再标非法项）。 */
const violations = computed(() => findDependencyViolations(rules.value, graph.value.edges, ruleContext.value))
const view = computed(() => {
  const filtered = applyPackageDepsSettings(graph.value, cycles.value, settings.value)
  // 「仅显示非法依赖」= 上游工具条上的 `FilterLegalsAction`（UI_FILTER_LEGALS）。
  if (!settings.value.filterLegals || !violations.value.length) return filtered
  const illegal = filtered.edges.filter(edge => isIllegalEdge(edge, violations.value))
  const packages = [...new Set(illegal.flatMap(edge => [edge.from, edge.to]))].sort()
  return { ...filtered, edges: illegal, packages }
})
const groupedEdges = computed(() => groupEdgesByScope(view.value.edges))
const focusView = computed(() => (focus.value ? directDependencies(graph.value, focus.value) : null))
const closureView = computed(() => (focus.value
  ? { forward: dependencyClosure(graph.value, focus.value, 'forward'), backward: dependencyClosure(graph.value, focus.value, 'backward') }
  : null))
/** 规则选择项：预定义档（`DEPENDENCY_SCOPE_OPTIONS`）+ 工程里的命名作用域，值就是序列化 id。 */
const scopeChoices = computed(() => [
  ...DEPENDENCY_SCOPE_OPTIONS.map(option => ({ id: option.id, title: option.title, description: option.description })),
  ...namedScopes.value.map(named => ({ id: named.name, title: named.name, description: named.pattern })),
])
/** 违规按发起文件聚合的那一份（面板上那一节的每一行 = 一条违规边）。 */
const violationRows = computed(() => violations.value.map(item => ({
  ...item, key: `${item.fromPath}:${item.line}->${item.toPath}:${item.ruleText}`,
})))
const rulesSummary = computed(() => (hasDependencyRules(rules.value)
  ? `${rules.value.length} 条规则 / ${violations.value.length} 处违规`
  : '还没有依赖规则'))

const edgeIndex = computed(() => {
  const index = new Map<string, PackageEdge[]>()
  for (const edge of view.value.edges) {
    const key = `${edge.from} → ${edge.to}`
    index.set(key, [...(index.get(key) ?? []), edge])
  }
  return index
})
const cycleRows = computed(() => cycles.value.map(members => {
  const edges: PackageEdge[] = []
  for (let index = 0; index < members.length; ++index) {
    const from = members[index]!
    const to = members[(index + 1) % members.length]!
    edges.push(...(edgeIndex.value.get(`${from} → ${to}`) ?? []))
  }
  return { members, edges }
}))

watch(settings, value => savePackageDepsSettings(value), { deep: true })
// 换范围后清掉聚焦的包（它可能不在新范围里了）。
watch(scope, () => { focus.value = '' })

/** 规则一改就落盘（上游 `DependencyConfigurable.apply:118-146` 同样是"点应用才写"，
 *  本仓没有那个 OK/Cancel 对话框宿主，就地保存与 `commitOptions` 同一口径）。 */
function persistRules() { saveDependencyRules(props.root, rules.value) }

/** 草稿的两个 id → 真引用（认不出来就报错，不悄悄丢：同上游 `readRule:289-296` 丢整条的口径，但这里给用户一句话）。 */
function refOf(id: string): DependencyScopeRef | null {
  return scopeRefFromId(id, ruleContext.value, [])
}

function addDraftRule() {
  const from = refOf(draft.value.from)
  const to = refOf(draft.value.to)
  if (!from || !to) { rulesNote.value = '规则的作用域认不出来，请重新选择。'; return }
  rules.value = [...rules.value, { from, to, deny: draft.value.deny }]
  rulesNote.value = ''
  persistRules()
}

function removeRule(index: number) {
  rules.value = rules.value.filter((_, position) => position !== index)
  persistRules()
}

async function loadScopeSettings() {
  try {
    const loaded = await request<ProjectSettings>('project.settings.get')
    namedScopes.value = (loaded?.scopes ?? []).map(item => ({ name: item.name, pattern: item.pattern }))
  } catch {
    namedScopes.value = []
  }
  // 规则从存档读回：读的那一段在 `dependencyRules.loadDependencyRules`（与写出同一套字段名）。
  rules.value = loadDependencyRules(props.root, ruleContext.value)
}

async function scan() {
  if (!isDesktop || !props.root || running.value) return
  running.value = true
  error.value = ''
  try {
    const [listing, result] = await Promise.all([
      request<ProjectFileList>('workspace.files', { root: props.root }),
      request<SearchResult>('search.run', { query: IMPORT_SCAN_QUERY, regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '' }),
    ])
    imports.value = collectImports((result.matches ?? []) as SearchMatch[])
    allFiles.value = listing.files ?? []
    truncated.value = result.truncated === true
    scanned.value = true
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  } finally {
    running.value = false
  }
}

onMounted(() => { void scan(); void loadScopeSettings() })
const label = (name: string) => packageDisplay(name)
function openEdge(edge: PackageEdge) { emit('open', { path: edge.path, line: edge.line }) }
function toggleSetting<K extends keyof PackageDepsSettings>(key: K) {
  settings.value = { ...settings.value, [key]: !settings.value[key] }
}
/** 规则行上的「来源/去向」两段表头（`dependency.configurable.*`，CodeInsightBundle:441-444）。 */
const rulesDraftLabels = computed<readonly [string, string]>(() => (draft.value.deny
  ? ['拒绝使用', '位置']        // deny.table.column1 / column2
  : ['允许使用', '仅位于']))    // allow.table.column1 / column2
/** 节标题 = `dependency.configurable.display.name`（CodeInsightBundle:440）。 */
const DEPENDENCY_VALIDATION_TITLE = '依赖验证'
/** 「仅显示非法依赖」那一条的说明 = `action.show.illegals.only.description`（CodeInsightBundle:410）。 */
const onlyIllegalsDescription = '只显示文件非法依赖'
/** 规则行文案（`DependencyRule.getDisplayText:47-54`）。 */
const ruleTitle = (rule: DependencyRule) => ruleDisplayText(rule)
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="command-palette deps-dialog" role="dialog" aria-modal="true" aria-label="包依赖分析">
      <div class="palette-input">
        <span class="deps-heading">包依赖分析</span>
        <span class="deps-summary" aria-live="polite">
          {{ scanned ? `${view.packages.length} 个包 / ${view.edges.length} 条依赖 / ${cycles.length} 组循环 / ${imports.length} 处导入` : '尚未分析' }}
          <template v-if="view.external">，外部导入 {{ view.external }} 处</template>
          <template v-if="allFiles.length">，范围 {{ universe.length }}/{{ allFiles.length }} 个文件</template>
          ，{{ rulesSummary }}
        </span>
        <button class="icon-button" :disabled="running" title="重新分析" aria-label="重新分析" @click="void scan()"><RefreshCw :size="iconSize.menu" /></button>
        <button class="icon-button" :aria-expanded="editingRules" :title="'编辑规则（依赖规则：哪些作用域之间禁止/仅允许依赖）'" aria-label="编辑规则" @click="editingRules = !editingRules"><Settings :size="iconSize.action" /></button>
        <button class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="iconSize.action" /></button>
      </div>
      <p v-if="!isDesktop" class="deps-note">浏览器预览不能扫描工程。</p>
      <p v-else-if="error" class="deps-error">{{ error }}</p>
      <p v-else-if="running" class="deps-note">正在扫描导入…</p>
      <template v-else>
        <div v-if="editingRules" class="deps-rules">
          <h3 class="deps-rules-title">{{ DEPENDENCY_VALIDATION_TITLE }}</h3>
          <p class="deps-note">依赖规则：某一作用域里的文件依赖另一作用域里的文件时算违规。规则本体见 src/dependencyRules.ts。</p>
          <ul v-if="rules.length" class="deps-rule-list">
            <li v-for="(rule, index) in rules" :key="`rule-${index}`" class="deps-rule">
              <span class="deps-rule-text">{{ ruleTitle(rule) }}</span>
              <button class="icon-button" title="删除这条规则" :aria-label="`删除规则 ${index + 1}`" @click="removeRule(index)"><Trash2 :size="iconSize.menu" /></button>
            </li>
          </ul>
          <p v-else class="deps-note">还没有规则。</p>
          <div class="deps-rule-draft">
            <label class="deps-option"><span>{{ rulesDraftLabels[0] }}</span>
              <select v-model="draft.from" :aria-label="rulesDraftLabels[0]">
                <option v-for="choice in scopeChoices" :key="`from-${choice.id}`" :value="choice.id" :title="choice.description">{{ choice.title }}</option>
              </select>
            </label>
            <label class="deps-option"><span>{{ rulesDraftLabels[1] }}</span>
              <select v-model="draft.to" :aria-label="rulesDraftLabels[1]">
                <option v-for="choice in scopeChoices" :key="`to-${choice.id}`" :value="choice.id" :title="choice.description">{{ choice.title }}</option>
              </select>
            </label>
            <label class="deps-option"><input v-model="draft.deny" type="checkbox" />拒绝（不勾就是「仅允许」）</label>
            <button class="deps-clear" @click="addDraftRule"><Plus :size="iconSize.rail" />添加</button>
          </div>
          <p v-if="rulesNote" class="deps-error">{{ rulesNote }}</p>
        </div>
        <div class="deps-toolbar">
          <label class="deps-option"><span>范围</span>
            <select v-model="scope" aria-label="分析范围">
              <option v-for="option in PACKAGE_SCOPES" :key="option.id" :value="option.id" :title="option.description">{{ option.title }}</option>
            </select>
          </label>
          <label class="deps-option"><input type="checkbox" :checked="settings.filterOutOfCyclePackages" @change="toggleSetting('filterOutOfCyclePackages')" />只看循环</label>
          <label class="deps-option"><input type="checkbox" :checked="settings.showFiles" @change="toggleSetting('showFiles')" />显示文件</label>
          <label class="deps-option"><input type="checkbox" :checked="settings.groupByScopeType" @change="toggleSetting('groupByScopeType')" />按范围分组</label>
          <!-- 上游 `FilterLegalsAction`：action.show.illegals.only（CodeInsightBundle:409）。
               中文包那条是「仅显示非法移民」（明显错译），这里按英文原文取「仅显示非法依赖」。 -->
          <label class="deps-option" :title="onlyIllegalsDescription">
            <input type="checkbox" :checked="settings.filterLegals" @change="toggleSetting('filterLegals')" />仅显示非法依赖
          </label>
        </div>
        <p v-if="truncated" class="deps-note">扫描结果被截断：下面只是已扫到的部分。</p>
        <div v-if="focus" class="deps-focus">
          <p class="deps-focus-head"><code>{{ label(focus) }}</code> 的依赖
            <button class="deps-clear" @click="focus = ''">清除聚焦</button>
          </p>
          <p class="deps-note">正向 {{ closureView?.forward.packages.length ?? 0 }} 个包 · 反向 {{ closureView?.backward.packages.length ?? 0 }} 个包（跳转不传屏，下面是直接一跳）</p>
          <button v-for="edge in focusView?.outgoing ?? []" :key="`out-${edge.path}:${edge.line}`" class="deps-edge" :class="{ 'deps-illegal': isIllegalEdge(edge, violations) }" @click="openEdge(edge)">
            <code>→ {{ label(edge.to) }}</code>
            <span v-if="settings.showFiles">{{ edge.path }}:{{ edge.line + 1 }}</span>
            <span class="deps-specifier">{{ edge.specifier }}</span>
          </button>
          <button v-for="edge in focusView?.incoming ?? []" :key="`in-${edge.path}:${edge.line}`" class="deps-edge" :class="{ 'deps-illegal': isIllegalEdge(edge, violations) }" @click="openEdge(edge)">
            <code>← {{ label(edge.from) }}</code>
            <span v-if="settings.showFiles">{{ edge.path }}:{{ edge.line + 1 }}</span>
            <span class="deps-specifier">{{ edge.specifier }}</span>
          </button>
        </div>
        <div class="deps-body">
          <div v-if="hasDependencyRules(rules)" class="deps-section">
            <h3>非法依赖 <span class="deps-badge">{{ violationRows.length }}</span></h3>
            <!-- 空态文案 = LangBundle `status.text.no.illegal.dependencies.found`（上游 `setEmptyText`，DependenciesPanel.java:742-747） -->
            <p v-if="!violationRows.length" class="deps-note">{{ NO_ILLEGAL_DEPENDENCIES_TEXT }}</p>
            <div v-for="row in violationRows" :key="row.key" class="deps-edge-row">
              <button class="deps-edge deps-illegal" @click="emit('open', { path: row.fromPath, line: row.line })">
                <code>{{ row.message }}</code>
                <span>{{ row.fromPath }}:{{ row.line + 1 }} → {{ label(row.toPath) }}</span>
              </button>
              <button class="deps-focus-button" title="聚焦这个包" @click="focus = row.toPath">聚焦</button>
            </div>
          </div>
          <div class="deps-section">
            <h3>循环依赖 <span class="deps-badge">{{ cycleRows.length }}</span></h3>
            <p v-if="!cycleRows.length" class="deps-note">没有发现目录级循环依赖。</p>
            <div v-for="(row, index) in cycleRows" :key="`cycle-${index}`" class="deps-cycle">
              <p class="deps-cycle-path">{{ row.members.map(label).join(' → ') }} → {{ label(row.members[0]!) }}</p>
              <div v-for="edge in row.edges" :key="`${edge.path}:${edge.line}`" class="deps-edge-row">
                <button class="deps-edge" :class="{ 'deps-illegal': isIllegalEdge(edge, violations) }" @click="openEdge(edge)">
                  <code>{{ label(edge.from) }} → {{ label(edge.to) }}</code>
                  <span v-if="settings.showFiles">{{ edge.path }}:{{ edge.line + 1 }}</span>
                  <span class="deps-specifier">{{ edge.specifier }}</span>
                </button>
                <button class="deps-focus-button" title="聚焦这个包" @click="focus = edge.from">聚焦</button>
              </div>
            </div>
          </div>
          <div class="deps-section">
            <h3><button class="deps-toggle" :aria-expanded="showEdges" @click="showEdges = !showEdges">全部依赖边 <span class="deps-badge">{{ view.edges.length }}</span></button></h3>
            <template v-if="showEdges">
              <template v-if="settings.groupByScopeType">
                <div v-for="bucket in groupedEdges" :key="`bucket-${bucket.scope}`" class="deps-bucket">
                  <p class="deps-bucket-head">{{ SCOPE_KIND_TITLES[bucket.scope] }} <span class="deps-badge">{{ bucket.edges.length }}</span></p>
                  <button v-for="edge in bucket.edges" :key="`${edge.from}-${edge.to}-${edge.path}:${edge.line}`" class="deps-edge" :class="{ 'deps-illegal': isIllegalEdge(edge, violations) }" @click="openEdge(edge)">
                    <code>{{ label(edge.from) }} → {{ label(edge.to) }}</code>
                    <span v-if="settings.showFiles">{{ edge.path }}:{{ edge.line + 1 }}</span>
                    <span class="deps-specifier">{{ edge.specifier }}</span>
                  </button>
                </div>
              </template>
              <template v-else>
                <button v-for="edge in view.edges" :key="`${edge.from}-${edge.to}-${edge.path}:${edge.line}`" class="deps-edge" :class="{ 'deps-illegal': isIllegalEdge(edge, violations) }" @click="openEdge(edge)">
                  <code>{{ label(edge.from) }} → {{ label(edge.to) }}</code>
                  <span v-if="settings.showFiles">{{ edge.path }}:{{ edge.line + 1 }}</span>
                  <span class="deps-specifier">{{ edge.specifier }}</span>
                </button>
              </template>
            </template>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.deps-dialog { width: 720px; max-width: 92vw; max-height: 80vh; }
.deps-heading { color: var(--bright); font-weight: 500; }
.deps-summary { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deps-note { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: 12px; }
.deps-error { margin: 0; padding: var(--space-2) var(--space-3); color: var(--error); font-size: 12px; }
.deps-toolbar { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-1) var(--space-3); border-bottom: 1px solid var(--line); }
.deps-option { display: flex; align-items: center; gap: var(--space-1); color: var(--secondary); font-size: 11px; }
.deps-option select { color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs, 3px); font-size: 11px; }
.deps-focus { margin: 0 var(--space-3); padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs, 3px); }
.deps-focus-head { margin: 0 0 var(--space-1); color: var(--secondary); font-size: 12px; }
.deps-clear { margin-left: var(--space-2); padding: 0; border: 0; background: transparent; color: var(--accent); font-size: 11px; }
.deps-body { flex: 1; min-height: 0; overflow: auto; padding: 0 var(--space-3) var(--space-3); }
.deps-section { margin-top: var(--space-2); }
.deps-section h3 { margin: 0 0 var(--space-1); color: var(--secondary); font-size: 12px; font-weight: 500; }
.deps-badge { margin-left: var(--space-1); color: var(--muted); font-size: 11px; }
.deps-cycle { margin-bottom: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs, 3px); }
.deps-cycle-path { margin: 0 0 var(--space-1); color: var(--warning, var(--error)); font: 12px var(--font-mono); overflow-wrap: anywhere; }
.deps-bucket { margin-bottom: var(--space-1); }
.deps-bucket-head { margin: var(--space-1) 0 0; color: var(--muted); font-size: 11px; }
.deps-edge-row { display: flex; align-items: baseline; gap: var(--space-2); }
.deps-edge-row .deps-edge { flex: 1; min-width: 0; }
.deps-edge { display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: 1px var(--space-1); border: 0; background: transparent; color: var(--text); text-align: left; font-size: 11px; }
.deps-edge:hover { background: var(--hover); }
.deps-edge code { flex-shrink: 0; color: var(--bright); font-family: var(--font-mono); }
.deps-edge span { min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deps-specifier { flex-shrink: 0; }
.deps-focus-button { flex-shrink: 0; padding: 0 var(--space-1); border: 0; background: transparent; color: var(--accent); font-size: 10px; }
.deps-toggle { padding: 0; border: 0; background: transparent; color: var(--secondary); font-size: 12px; font-weight: 500; }
.deps-rules { margin: var(--space-1) var(--space-3) 0; padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs, 3px); }
.deps-rules-title { margin: 0 0 var(--space-1); color: var(--secondary); font-size: 12px; font-weight: 500; }
.deps-rule-list { margin: 0 0 var(--space-1); padding: 0; list-style: none; }
.deps-rule { display: flex; align-items: center; gap: var(--space-2); font-size: 11px; }
.deps-rule-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.deps-rule-draft { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
/* 违规那条边：与循环那一节同一条告警色（上游用 AllIcons 的红点标记非法节点，本仓只有颜色可映射）。 */
.deps-illegal code { color: var(--error); }
</style>
