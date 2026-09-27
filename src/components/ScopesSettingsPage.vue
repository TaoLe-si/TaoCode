<script setup lang="ts">
// 设置 › 外观与行为 › 作用域（IDEA `project.scopes`，`ScopeChooserConfigurable`）。
//
// 逐条对照：
//   ScopeChooserConfigurable.java:65-529  主从编辑器本体
//     :92-109   createActions —— 添加 / 删除 / 复制 / 另存为 / 上移 / 下移
//     :111-131  reset        —— 先加载共享作用域再加载本地作用域，最后按 myOrder 排序
//     :134-145  apply        —— 查重名/空名 + 查预定义名，然后写回两个持有者
//     :178-197  isModified   —— 顺序 + 名字 + 明细页改动
//     :300-310  createUniqueName —— 默认名「未命名」「未命名1」…
//     :320-349  addNewScope / createScope（输入框 + 校验）
//   ScopeConfigurable.java:33-176           明细页：通过 VCS 共享 + 模式
//   ScopeEditorPanel.java:126-1035          模式框、错误位置、匹配计数、文件树、四个按钮、图例
//   ScopeEditorPanel.java:583-609 / :545-574   Include / Exclude 的集合合并（在 ../scopes.ts 里）
//
// 与 IDEA 的差异（属于单隐式模块带来的映射，不是省事）：
//   * 模块只有隐式一个，名字取工作区目录名；Include/Exclude 生成的模式里带 `[模块名]`
//     （`ProjectPatternProvider.createPackageSet` :82-121 用 `module.getName()`），
//     因此重命名项目目录会让旧作用域失效 —— 与 IDEA 重命名模块同效。
//   * 预定义作用域（Project Files / Problems / …）由 `CustomScopesProvider` 提供，本仓没有这些
//     提供者，故列表里只有用户自定义的作用域；查询不到名字的 `$引用` 恒不匹配（源码同）。
import { computed, ref, watch } from 'vue'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleHelp, Copy, FileText, Folder, Plus, Save, Trash2,
} from 'lucide-vue-next'
import { request, type NamedScopeSetting, type ProjectFileList } from '../bridge'
import {
  compileScopeText, excludeFrom, includeInto, scopeLookup, scopeMatches, scopeText, type ScopeContext, type ScopeSet,
} from '../scopes'
// 文件颜色（IDEA `FileColorsConfigurable`）：七色与判定规则都在 src/fileColors.ts。
import {
  FILE_COLOR_HEX, FILE_COLOR_NAMES, normalizeFileColors, type FileColorName, type FileColorSetting,
} from '../fileColors'

const props = defineProps<{
  /** null = 没有打开项目（整页只读）。 */
  scopes: NamedScopeSetting[] | null
  root: string | null
  /** 单隐式模块的名字（`ProjectPatternProvider` 生成的模式里用它）。 */
  moduleName: string
  /** 已保存的文件颜色（IDEA `FileColorConfiguration` = scopeName + colorID）。 */
  fileColors: FileColorSetting[]
  busy: boolean
}>()
const emit = defineEmits<{ save: [scopes: NamedScopeSetting[]]; saveColors: [fileColors: FileColorSetting[]] }>()

// ---- 文件颜色（IDEA `com.intellij.ui.tabs.FileColorsConfigurable`）----
// 草稿按**列表顺序**存：数组下标即优先级（`FileColorsModel.findConfigurationWithScopeFilter`
// 顺着迭代器首个命中就返回），所以颜色跟着作用域的顺序走，不需要另存一份顺序。
const colorDraft = ref<FileColorSetting[]>([])
function fillColors() {
  colorDraft.value = normalizeFileColors(props.fileColors, props.scopes ?? [])
}
function colorOf(scope: string): FileColorName | '' {
  return colorDraft.value.find(entry => entry.scope === scope)?.color ?? ''
}
function setColor(scope: string, color: FileColorName | '') {
  colorDraft.value = colorDraft.value.filter(entry => entry.scope !== scope)
  // 配了色的排在同位置，顺序由作用域列表决定；这里只记「谁有颜色」。
  if (color) colorDraft.value = [...colorDraft.value, { scope, color }]
}
function applyColors() {
  // 按作用域列表的当前顺序重排 —— 那个顺序就是优先级（与 setColor 里记的顺序无关）。
  const order = new Map(draft.value.map((entry, index) => [entry.name, index]))
  const ordered = colorDraft.value
    .filter(entry => order.has(entry.scope))
    .sort((a, b) => (order.get(a.scope) ?? 0) - (order.get(b.scope) ?? 0))
    .map(entry => ({ ...entry }))
  emit('saveColors', ordered)
}

interface ScopeTreeNode { name: string; path: string; directory: boolean; children: ScopeTreeNode[] }

const draft = ref<NamedScopeSetting[]>([])
const selected = ref(0)
const snapshot = ref('')
const note = ref('')
const files = ref<string[]>([])
const filesNote = ref('')
const chosen = ref<Set<string>>(new Set())
const open = ref<Set<string>>(new Set())
let filesToken = 0

const shape = () => JSON.stringify(draft.value)
const dirty = computed(() => shape() !== snapshot.value)
const current = computed<NamedScopeSetting | null>(() => draft.value[selected.value] ?? null)

function fillFrom(next: NamedScopeSetting[] | null) {
  draft.value = (next ?? []).map(entry => ({ ...entry }))
  snapshot.value = shape()
  note.value = ''
  selected.value = Math.min(selected.value, Math.max(0, draft.value.length - 1))
  chosen.value = new Set()
}

watch(() => [props.scopes, props.root, props.fileColors] as const, ([next, root]) => {
  fillFrom(next)
  fillColors()
  selected.value = 0
  if (root) void loadFiles()
  else { files.value = []; filesNote.value = '' }
}, { immediate: true })

async function loadFiles() {
  const token = ++filesToken
  filesNote.value = ''
  try {
    const result = await request<ProjectFileList>('workspace.files')
    if (token !== filesToken) return
    files.value = result.files
    if (result.truncated) filesNote.value = '项目文件过多，清单被截断，下面的计数是下限。'
  } catch (error) {
    if (token !== filesToken) return
    files.value = []
    filesNote.value = error instanceof Error ? error.message : String(error)
  }
}

// ---------------------------------------------------------------- 求值

// `$名字` 引用另一个命名作用域（NamedPackageSetReference.java:19-44）；找不到就恒假。
const context = computed<ScopeContext>(() => ({ moduleName: props.moduleName, lookup: scopeLookup(draft.value) }))
// `ScopeEditorPanel.onTextChange`（:432-452）：解析失败时当前集合就是一个 InvalidPackageSet，
// 而不是「保留上一次的集合」——所以后面的 Include/Exclude 走的是源码里那条 invalid 分支。
const compiled = computed(() => compileScopeText(current.value?.pattern ?? ''))
const matched = computed(() => {
  if (!current.value || compiled.value.error) return 0
  return files.value.filter(path => scopeMatches(compiled.value.set, path, false, context.value)).length
})

// ---------------------------------------------------------------- 文件树（FileTreeModelBuilder 的等价物）

const tree = computed<ScopeTreeNode[]>(() => {
  const root: ScopeTreeNode = { name: '', path: '', directory: true, children: [] }
  const index = new Map<string, ScopeTreeNode>([['', root]])
  for (const path of files.value) {
    const parts = path.split('/')
    let parent = root
    let prefix = ''
    parts.forEach((part, position) => {
      prefix = prefix ? `${prefix}/${part}` : part
      let node = index.get(prefix)
      if (!node) {
        node = { name: part, path: prefix, directory: position < parts.length - 1, children: [] }
        index.set(prefix, node)
        parent.children.push(node)
      }
      parent = node
    })
  }
  const sort = (nodes: ScopeTreeNode[]): void => {
    nodes.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    nodes.forEach(node => sort(node.children))
  }
  sort(root.children)
  return root.children
})

/** 每个节点的「命中 / 总数」，用来画 IDLE 的全包含（绿）与部分包含（蓝）。 */
const marks = computed(() => {
  const map = new Map<string, { matched: number; total: number }>()
  if (current.value && !compiled.value.error) {
    for (const path of files.value) {
      const hit = scopeMatches(compiled.value.set, path, false, context.value)
      const parts = path.split('/')
      let prefix = ''
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part
        const entry = map.get(prefix) ?? { matched: 0, total: 0 }
        entry.total += 1
        if (hit) entry.matched += 1
        map.set(prefix, entry)
      }
    }
  }
  return map
})

function markOf(node: ScopeTreeNode): 'none' | 'some' | 'all' {
  const entry = marks.value.get(node.path)
  if (!entry || entry.matched === 0) return 'none'
  return entry.matched === entry.total ? 'all' : 'some'
}

/** 展平成「按当前展开状态可见的行」——递归深度不受模板限制。 */
const visible = computed(() => {
  const rows: Array<{ node: ScopeTreeNode; depth: number }> = []
  const walk = (nodes: ScopeTreeNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({ node, depth })
      if (node.directory && open.value.has(node.path)) walk(node.children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return rows
})

// 多选（IDEA 的 `myPackageTree.getSelectionPaths()`）：普通点击替换选择，Ctrl/⌘ 点击增删。
function pick(node: ScopeTreeNode, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey) {
    const next = new Set(chosen.value)
    if (next.has(node.path)) next.delete(node.path)
    else next.add(node.path)
    chosen.value = next
    return
  }
  chosen.value = new Set([node.path])
}
function toggle(node: ScopeTreeNode) {
  if (!node.directory) return
  const next = new Set(open.value)
  if (next.has(node.path)) next.delete(node.path)
  else next.add(node.path)
  open.value = next
}

// `ProjectPatternProvider.createPackageSet`（:82-121）逐个分支的等价物。
function packageSetFor(node: ScopeTreeNode, recursive: boolean): ScopeSet | null {
  const modulePattern = props.moduleName || null
  if (!node.directory) {
    if (recursive) return null          // 源码里对 FileNode 递归返回 null
    return { kind: 'file', modulePattern, pattern: node.path, projectFiles: true }
  }
  const pattern = node.path === ''
    ? (recursive ? '*/' : '*')
    : `${node.path}${recursive ? '//*' : '/*'}`
  return { kind: 'file', modulePattern, pattern, projectFiles: true }
}

/** `ScopeEditorPanel.includeSelected/excludeSelected`（:576-609 / :538-574）。 */
function applyNodes(recursive: boolean, include: boolean) {
  if (!current.value || chosen.value.size === 0) return
  const targets: ScopeTreeNode[] = []
  for (const path of chosen.value) {
    const node = findNode(tree.value, path)
    if (node) targets.push(node)
  }
  let set: ScopeSet | null = compiled.value.set
  let applied = 0
  for (const node of targets) {
    const add = packageSetFor(node, recursive)
    if (add === null) continue
    set = include ? includeInto(set, add) : excludeFrom(set, add)
    applied += 1
  }
  if (!applied) { note.value = '递归包含对单个文件没有意义（源码这里的 createPackageSet 返回 null）。'; return }
  note.value = ''
  draft.value[selected.value] = { ...current.value, pattern: set === null ? '' : scopeText(set) }
}
function findNode(nodes: ScopeTreeNode[], path: string): ScopeTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    const nested = findNode(node.children, path)
    if (nested) return nested
  }
  return null
}

// ---------------------------------------------------------------- 主从动作

// `createUniqueName`（:300-310）：基名「未命名」，重名时追加 1、2、3…
function uniqueName(): string {
  const used = new Set(draft.value.map(entry => entry.name))
  const base = '未命名'
  if (!used.has(base)) return base
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`
}
function validateName(name: string, skip: number): string {
  if (!name.trim()) return '作用域名不能为空。'
  if (name.length > 80) return '作用域名不能超过 80 个字符。'
  if (/[\r\n\t]/.test(name)) return '作用域名不能包含换行或制表符。'
  if (draft.value.some((entry, index) => index !== skip && entry.name === name)) return `作用域名不能重复：${name}`
  return ''
}
function addScope(shared: boolean) {
  const name = window.prompt(shared ? '新建共享作用域（随 .idea 一起提交）' : '新建本地作用域（只存在本机）', uniqueName())
  if (name === null) return
  const problem = validateName(name, -1)
  if (problem) { note.value = problem; return }
  draft.value.push({ name: name.trim(), pattern: '', shared })
  selected.value = draft.value.length - 1
  note.value = ''
}
function removeScope() {
  if (!current.value) return
  draft.value.splice(selected.value, 1)
  selected.value = Math.min(selected.value, Math.max(0, draft.value.length - 1))
  chosen.value = new Set()
}
// MyCopyAction（:460-486）：复制选中项，名字重新取唯一名。
function copyScope() {
  if (!current.value) return
  draft.value.push({ ...current.value, name: uniqueName() })
  selected.value = draft.value.length - 1
}
// MySaveAsAction（:488-522）：把当前模式另存到**另一个**持有者里。
function saveAs() {
  if (!current.value) return
  const shared = !current.value.shared
  const name = window.prompt(shared ? '另存为共享作用域' : '另存为本地作用域', uniqueName())
  if (name === null) return
  const problem = validateName(name, -1)
  if (problem) { note.value = problem; return }
  draft.value.push({ name: name.trim(), pattern: current.value.pattern, shared })
  selected.value = draft.value.length - 1
  note.value = ''
}
// MyMoveAction（:420-458）：上下移动选中项；`myOrder` 就是数组顺序。
function move(direction: -1 | 1) {
  const from = selected.value
  const to = from + direction
  if (to < 0 || to >= draft.value.length) return
  const [item] = draft.value.splice(from, 1)
  draft.value.splice(to, 0, item)
  selected.value = to
}
function rename(index: number, value: string) {
  draft.value[index] = { ...draft.value[index], name: value }
}
function localProblem(index: number): string {
  return draft.value.some((entry, other) => other !== index && entry.name === draft.value[index].name)
    ? '作用域名不能重复。'
    : ''
}

function apply() {
  for (let index = 0; index < draft.value.length; index++) {
    const problem = validateName(draft.value[index].name, index)
    if (problem) { note.value = problem; selected.value = index; return }
  }
  emit('save', draft.value.map(entry => ({ ...entry })))
  applyColors()
  snapshot.value = shape()
  note.value = ''
}
function reset() {
  fillFrom(props.scopes)
  fillColors()
}
</script>

<template>
  <section class="scope-page">
    <p v-if="!root" class="field-hint">先打开一个项目才能编辑作用域：作用域随项目保存。</p>
    <p v-else-if="filesNote" class="field-hint">{{ filesNote }}</p>

    <div class="scope-split">
      <div class="scope-master">
        <!-- ScopeChooserConfigurable.createActions（:92-109）：添加（本地/共享）· 删除 · 复制 · 另存为 · 上移 · 下移 -->
        <div class="scope-actions">
          <button type="button" :disabled="!root" title="添加本地作用域" @click="addScope(false)"><Plus :size="14" />本地</button>
          <button type="button" :disabled="!root" title="添加共享作用域（随 .idea 提交）" @click="addScope(true)"><Plus :size="14" />共享</button>
          <button type="button" :disabled="!current" title="删除" @click="removeScope()"><Trash2 :size="14" /></button>
          <button type="button" :disabled="!current" title="复制" @click="copyScope()"><Copy :size="14" /></button>
          <button type="button" :disabled="!current" title="另存为另一个持有者" @click="saveAs()"><Save :size="14" /></button>
          <button type="button" :disabled="selected <= 0" title="上移" @click="move(-1)"><ArrowUp :size="14" /></button>
          <button type="button" :disabled="selected >= draft.length - 1" title="下移" @click="move(1)"><ArrowDown :size="14" /></button>
        </div>
        <ul class="scope-list" aria-label="作用域列表">
          <li v-for="(entry, index) in draft" :key="index" :class="{ active: index === selected }">
            <span :class="['scope-dot', entry.shared ? 'shared' : 'local']" :title="entry.shared ? '共享作用域（.idea）' : '本地作用域（workspace）'" />
            <input
              :value="entry.name"
              :aria-label="`作用域名 ${index + 1}`"
              :aria-invalid="!!localProblem(index)"
              spellcheck="false"
              @focus="selected = index"
              @input="rename(index, ($event.target as HTMLInputElement).value)"
              @click="selected = index"
            />
            <span v-if="localProblem(index)" class="scope-warn" :title="localProblem(index)">!</span>
            <!-- 文件颜色（IDEA `FileColorsConfigurable`，`intellij.platform.lang.impl.xml:1341-1343` 注册在
                 appearance 组 112）：给作用域配颜色，落在该作用域里的文件在编辑器标签页上显示这个底色。
                 IDEA 把它单独做成一页；本仓并在这里 —— 配色的对象就是作用域本身，同处配置少一次跳转。
                 **数组顺序即优先级**（`FileColorsModel.findConfigurationWithScopeFilter` 首个命中就返回），
                 正好复用上面那两个上移/下移按钮的顺序。判定逻辑见 src/fileColors.ts。 -->
            <span class="scope-colors" role="group" :aria-label="`${entry.name} 的文件颜色`">
              <button
                v-for="name in FILE_COLOR_NAMES"
                :key="name"
                type="button"
                class="scope-color-dot"
                :class="{ picked: colorOf(entry.name) === name }"
                :style="{ background: `var(--file-color-${name.toLowerCase()})` }"
                :title="`${name}（${FILE_COLOR_HEX[name].light} / ${FILE_COLOR_HEX[name].dark}）`"
                :aria-pressed="colorOf(entry.name) === name"
                @click="setColor(entry.name, colorOf(entry.name) === name ? '' : name)"
              />
            </span>
          </li>
        </ul>
        <!-- scopes.no.scoped（IdeBundle:914） -->
        <p v-if="!draft.length" class="field-hint">尚未添加作用域。</p>
      </div>

      <div class="scope-detail">
        <p v-if="!current" class="field-hint">选择一个作用域以查看或编辑它的明细。</p>
        <template v-else>
          <h4>作用域“{{ current.name || '（未命名）' }}”</h4>
          <!-- ScopeConfigurable.createTopRightComponent（:103-108）：Share through VCS + 问号 -->
          <label class="checkbox-row">
            <input v-model="current.shared" type="checkbox" />
            <span>通过 VCS 共享</span>
          </label>
          <p class="field-hint">
            <CircleHelp :size="13" aria-hidden="true" />
            共享作用域保存在 <code>.idea</code> 目录里，可以随版本控制分享给其他人；本地作用域只存在本机。
          </p>

          <!-- ScopeEditorPanel:220 label.scope.pattern -->
          <label class="field-row scope-pattern">
            <span>模式：</span>
            <input
              :value="current.pattern"
              class="mono"
              spellcheck="false"
              aria-label="作用域模式"
              :aria-invalid="!!compiled.error"
              @input="draft[selected] = { ...current, pattern: ($event.target as HTMLInputElement).value }"
            />
          </label>
          <!-- updateStatusMessage（:465-476）+ label.scope.contains.files（:796） -->
          <p class="field-hint" :class="{ bad: !!compiled.error }">
            <template v-if="compiled.error">{{ compiled.error }}</template>
            <template v-else>作用域包含 {{ matched }} / 共 {{ files.length }} 个文件</template>
            <span v-if="compiled.position !== null" class="scope-pos">pos:{{ compiled.position }}</span>
          </p>
          <p v-if="note" class="field-hint bad">{{ note }}</p>
          <!-- rerun 时 ScopeEditorPanel:713-715 把 provider 的提示放在模式框下面 -->
          <p class="field-hint">
            用 <code>file:*.txt</code> 匹配项目里所有 txt 文件；用 <code>file:路径//*</code> 递归匹配某个内容根目录下的全部文件；
            用 <code>projectPath:路径//*</code> 从项目根递归匹配某个目录。组合符：<code>||</code> 并、<code>&amp;&amp;</code> 交、<code>!</code> 非、
            <code>( )</code> 分组、<code>$名称</code> 引用另一个作用域。
          </p>

          <div class="scope-tree-row">
            <div class="scope-tree" role="tree" aria-label="项目文件">
              <div
                v-for="row in visible"
                :key="row.node.path"
                class="scope-node"
                role="treeitem"
                :aria-level="row.depth + 1"
                :aria-selected="chosen.has(row.node.path)"
                :aria-expanded="row.node.directory ? open.has(row.node.path) : undefined"
                :class="[`mark-${markOf(row.node)}`, { chosen: chosen.has(row.node.path) }]"
                :style="{ paddingLeft: `${row.depth * 12}px` }"
                @click="pick(row.node, $event)"
                @dblclick="toggle(row.node)"
              >
                <button v-if="row.node.directory" type="button" class="scope-caret" :title="open.has(row.node.path) ? '折叠' : '展开'" @click.stop="toggle(row.node)">
                  <ChevronDown v-if="open.has(row.node.path)" :size="12" />
                  <ChevronRight v-else :size="12" />
                </button>
                <span v-else class="scope-caret" />
                <Folder v-if="row.node.directory" :size="13" />
                <FileText v-else :size="13" />
                <span>{{ row.node.name }}</span>
              </div>
              <p v-if="!visible.length" class="field-hint">没有可显示的文件。</p>
            </div>
            <!-- createActionsPanel（:478-492）：Include / Include Recursively / Exclude / Exclude Recursively -->
            <div class="scope-buttons">
              <button type="button" :disabled="!chosen.size" @click="applyNodes(false, true)">包含</button>
              <button type="button" :disabled="!chosen.size" @click="applyNodes(true, true)">递归包含</button>
              <button type="button" :disabled="!chosen.size" @click="applyNodes(false, false)">排除</button>
              <button type="button" :disabled="!chosen.size" @click="applyNodes(true, false)">递归排除</button>
            </div>
          </div>
          <!-- MyTreeCellRenderer 的两个颜色（:873-875） -->
          <p class="field-hint scope-legend">
            <span class="scope-dot all" />递归包含
            <span class="scope-dot some" />部分包含
          </p>
        </template>
      </div>
    </div>

    <div class="scope-footer">
      <button type="button" class="primary" :disabled="!root || busy || !dirty" @click="apply()">应用</button>
      <button type="button" :disabled="!root || busy || !dirty" @click="reset()">重置</button>
      <span class="field-hint">{{ dirty ? '有未应用的作用域改动' : '作用域已与项目同步' }}</span>
    </div>
  </section>
</template>

<style scoped>
.scope-page { display: flex; flex-direction: column; gap: 8px; }
.scope-split { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(320px, 1.6fr); gap: 12px; align-items: start; }
.scope-master { border: 1px solid var(--line); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 6px; }
.scope-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.scope-actions button { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; padding: 2px 6px; }
.scope-list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto; }
.scope-list li { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 4px; }
.scope-list li.active { background: var(--selection, rgba(127, 127, 127, 0.18)); }
.scope-list input { flex: 1; min-width: 0; border: 1px solid transparent; background: transparent; color: inherit; font: inherit; padding: 2px 4px; border-radius: 3px; }
.scope-list input:focus { border-color: var(--line); background: var(--panel, transparent); }
.scope-list input[aria-invalid='true'] { border-color: #c0392b; }
.scope-warn { color: #c0392b; font-weight: 700; }
.scope-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.scope-dot.local { background: #4a7ebb; }
.scope-dot.shared { background: #3f9142; }
.scope-dot.all { background: #0a7700; }
.scope-dot.some { background: #0032a0; }
.scope-detail { display: flex; flex-direction: column; gap: 4px; }
.scope-detail h4 { margin: 0; font-size: 13px; }
.scope-pattern input { flex: 1; }
.scope-pattern .mono, .field-row .mono { font-family: ui-monospace, Consolas, monospace; }
.scope-tree-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; }
.scope-tree { border: 1px solid var(--line); border-radius: 6px; padding: 4px; max-height: 260px; overflow: auto; }
.scope-tree ul { list-style: none; margin: 0; padding-left: 12px; }
.scope-tree > ul { padding-left: 0; }
.scope-node { display: flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: 3px; cursor: default; }
.scope-node.chosen { background: var(--selection, rgba(127, 127, 127, 0.22)); }
.scope-node.mark-all > span:last-child { color: #0a7700; }
.scope-node.mark-some > span:last-child { color: #0032a0; }
.scope-caret { width: 14px; border: 0; background: transparent; color: inherit; padding: 0; display: inline-flex; align-items: center; }
.scope-buttons { display: flex; flex-direction: column; gap: 4px; }
.scope-legend { display: flex; align-items: center; gap: 6px; }
.field-hint.bad { color: #c0392b; }
.scope-pos { margin-left: 6px; opacity: 0.75; }
.scope-footer { display: flex; align-items: center; gap: 8px; }
</style>
