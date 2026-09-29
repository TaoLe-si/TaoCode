<script setup lang="ts">
// 运行/调试配置对话框（IDEA `EditConfigurationsDialog` + `RunConfigurable` +
// `ConfigurationSettingsEditorWrapper`）。逐条对照的源码：
//
//   EditConfigurationsDialog.java:50-140   外壳（标题 run.debug.dialog.title="Run/Debug Configurations"、
//                                          Enter=默认按钮、createActions）
//   RunConfigurable.kt:520-586             splitter：左树（右边框）+ 右面板（padding 15,5,0,15）；
//                                          最小尺寸 800×600
//   RunConfigurable.kt:170-183             节点种类 RunConfigurableNodeKind：
//                                          CONFIGURATION / TEMPORARY_CONFIGURATION / CONFIGURATION_TYPE /
//                                          FOLDER（userObject 是文件夹名字符串）/ UNKNOWN
//   RunConfigurable.kt:989/1129/1173/1229  工具条动作：Remove Configuration /
//                                          Copy Configuration / Save Configuration / Create New Folder
//   ConfigurationSettingsEditorWrapper.java:36-89
//                                          右栏自上而下：启动前步骤行 → isAllowRunningInParallel →
//                                          RunOnTarget（仅模板）→ RunConfigurationStorageUi（仅模板）→
//                                          配置编辑器标签页
//   ConfigurationSettingsEditorPanel.kt:34-67
//                                          右栏四行：row1 复选框（+存储）+ row2 运行目标 + row3 配置主体
//                                          （可最大化）+ row4 可折叠的 "Before launch"
//   ConfigurationSettingsEditor.java:86    唯一内建标签页 = run.configuration.configuration.tab.title="Configuration"
//
// 与 IDEA 的差异（都登记在 docs/class-parity-todo.md，不造假控件）：
//   * 「Allow multiple instances」**已实现**（2026-09-27）：宿主支持多实例（native/run_host.cpp），
//     语义照 `RunConfigurationOptions.kt:54-56` + `ExecutionManagerImpl.kt:613-619`。
//     唯一的映射差异：IDEA 把复选框**只放在模板上**（`ConfigurationSettingsEditorWrapper.java:73-74`
//     `setVisible(settings.isTemplate() && factory.getSingletonPolicy().isPolicyConfigurable())`），
//     而本仓还没有模板配置体系，所以它是配置上的一个复选框（而不是每个配置从模板复制初值）。
//   * 「Store as project file」不渲染：TaoCode 的项目级配置写在应用状态文件里（并由原生测试锁住
//     "不在用户项目里建配置"），改成写 .idea/runConfigurations 是独立工程。
//   * 「Run on target」只在模板配置上出现（wrapper 里 `settings.isTemplate()` 才创建），本仓没有
//     模板配置体系，故不渲染。
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Copy, FolderPlus, Minus, Plus, Save, X } from 'lucide-vue-next'
import type { RunConfig } from '../bridge'
import { RUN_CONFIG_TYPES as TYPES, buildRunConfigTree, formatRunArguments, parseRunArguments, nodeKey, uniqueRunConfigName, validateFolderName } from '../runConfigTree'

const props = defineProps<{
  configs: RunConfig[]
  /** 当前编辑的草稿（由父组件持有，保存时回写）。 */
  draft: RunConfig
  busy?: boolean
}>()

const emit = defineEmits<{
  (event: 'save', config: RunConfig): void
  (event: 'remove', name: string): void
  (event: 'select', name: string): void
  (event: 'close'): void
}>()

// IDEA 用 PropertiesComponent 存 "ExpandBeforeRunStepsPanel"（ConfigurationSettingsEditorPanel.kt:66-69），
// TaoCode 没有 PropertiesComponent，用 localStorage 等价。
const BEFORE_KEY = 'taocode.expandBeforeRunSteps'
const beforeOpen = ref(readBeforeOpen())
function readBeforeOpen() {
  try { return localStorage.getItem(BEFORE_KEY) !== 'false' } catch { return true }
}
function toggleBefore() {
  beforeOpen.value = !beforeOpen.value
  try { localStorage.setItem(BEFORE_KEY, String(beforeOpen.value)) } catch { /* 本次会话内保留 */ }
}

/** 树里被选中的节点：类型节点（`type:`）、文件夹（`folder:类型/文件夹`）或配置（`config:名字`）。 */
const selected = ref(props.draft.name ? nodeKey('config', props.draft.name) : '')
const collapsed = ref(new Set<string>())
const form = ref<RunConfig>({ ...props.draft })
const hint = ref('')

watch(() => props.draft, value => {
  form.value = { ...value }
  if (value.name) selected.value = nodeKey('config', value.name)
}, { deep: true })

const selectedConfigName = computed(() => selected.value.startsWith('config:') ? selected.value.slice(7) : '')

// 左树（RunConfigurable 的树模型）：类型 → 文件夹 → 配置；分组规则在 src/runConfigTree.ts。
const tree = computed(() => buildRunConfigTree(props.configs))
const folderNames = computed(() => tree.value.flatMap(node => node.folders.map(group => `${node.label} / ${group.name}`)))

function pickConfig(name: string) {
  selected.value = nodeKey('config', name)
  hint.value = ''
  emit('select', name)
}
function pickNode(key: string) {
  selected.value = key
  if (key.startsWith('config:')) { emit('select', key.slice(7)); return }
  // IDEA 点类型节点时右侧显示"在此处添加新配置"的提示面板（drawPressAddButtonMessage，RunConfigurable.kt:525-539）。
  hint.value = key.startsWith('type:')
    ? '点左上角的「添加」在这个类型下新建配置。'
    : '文件夹：用工具条的「新建文件夹」把选中的配置移进来，或在右侧直接改「文件夹」。'
}
function toggleNode(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

const envText = computed({
  get: () => (form.value.env ?? []).join('\n'),
  set: (value: string) => { form.value = { ...form.value, env: value.split('\n').map(line => line.trim()).filter(Boolean) } },
})
const beforeText = computed({
  get: () => (form.value.beforeLaunch ?? []).map(step => `${step.name}|${step.command}`).join('\n'),
  set: (value: string) => {
    const steps = value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [name, ...rest] = line.split('|')
      return { name: (name ?? '').trim(), command: rest.join('|').trim() }
    }).filter(step => step.name && step.command)
    form.value = { ...form.value, beforeLaunch: steps }
  },
})
const argsText = computed({
  get: () => formatRunArguments(form.value.args ?? []),
  set: (value: string) => { form.value = { ...form.value, args: parseRunArguments(value) } },
})

const uniqueName = (base: string) => uniqueRunConfigName(props.configs, base)
/** IDEA 的 add 按钮：在**选中的类型**下新建（`RunConfigurable` 用类型节点决定工厂）。 */
function addConfig(type: RunConfig['type']) {
  const folder = selected.value.startsWith('folder:') ? selected.value.slice(7).split('\u0000')[1] ?? '' : ''
  const name = uniqueName('新配置')
  form.value = { name, type, command: '', program: '', args: [], cwd: '', env: [], beforeLaunch: [], folder }
  selected.value = nodeKey('config', name)
  hint.value = ''
}
/** MyCopyAction（RunConfigurable.kt:1129）：复制选中配置并取唯一名。 */
function copyConfig() {
  const source = props.configs.find(config => config.name === selectedConfigName.value)
  if (!source) { hint.value = '先选中一个配置再复制。'; return }
  // `ModuleBasedConfiguration.java:175-178` 特意把 `isAllowRunningInParallel` 一起复制过去。
  const copy: RunConfig = { ...source, name: uniqueName(`${source.name} 副本`), args: [...(source.args ?? [])], env: [...(source.env ?? [])], beforeLaunch: (source.beforeLaunch ?? []).map(step => ({ ...step })) }
  emit('save', copy)
  selected.value = nodeKey('config', copy.name)
  form.value = { ...copy }
}
/** MyCreateFolderAction（RunConfigurable.kt:1229）：新建文件夹并把选中配置移进去。 */
function createFolder() {
  const name = window.prompt('新文件夹名称', '新文件夹')?.trim()
  if (!name) return
  const problem = validateFolderName(name)
  if (problem) { hint.value = problem; return }
  const source = props.configs.find(config => config.name === selectedConfigName.value)
  if (!source) { hint.value = '先选中一个配置，新建的文件夹会把它移进去（本仓没有拖放，无法留下空文件夹）。'; return }
  const moved: RunConfig = { ...source, folder: name }
  emit('save', moved)
  form.value = { ...moved }
  hint.value = ''
}
function save() {
  if (props.busy) return
  if (!form.value.name.trim()) { hint.value = '配置名不能为空。'; return }
  const folder = (form.value.folder ?? '').trim()
  const next: RunConfig = { ...form.value, name: form.value.name.trim() }
  if (folder) next.folder = folder
  else delete next.folder
  emit('save', next)
  selected.value = nodeKey('config', next.name)
  hint.value = ''
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog run-configs-dialog" role="dialog" aria-modal="true" aria-label="运行/调试配置">
      <header class="run-configs-head">
        <h2>运行/调试配置</h2>
        <button type="button" class="icon-button" title="关闭" aria-label="关闭" @click="emit('close')"><X :size="16" aria-hidden="true" /></button>
      </header>
      <!-- IDEA 的 splitter（RunConfigurable.kt:563-575）：左树带右边框，右面板 padding 15,5,0,15。 -->
      <div class="rc-body">
        <div class="rc-tree">
          <ul role="tree" aria-label="运行配置树">
            <li v-for="node in tree" :key="node.id">
              <div
                class="rc-node rc-type"
                role="treeitem"
                :aria-expanded="!collapsed.has(nodeKey('type', node.id))"
                :aria-selected="selected === nodeKey('type', node.id)"
                :class="{ 'is-selected': selected === nodeKey('type', node.id) }"
                @click="pickNode(nodeKey('type', node.id))"
              >
                <button type="button" class="rc-caret" :title="collapsed.has(nodeKey('type', node.id)) ? '展开' : '折叠'" @click.stop="toggleNode(nodeKey('type', node.id))">
                  <ChevronRight v-if="collapsed.has(nodeKey('type', node.id))" :size="12" /><ChevronDown v-else :size="12" />
                </button>
                <span>{{ node.label }}</span>
              </div>
              <ul v-if="!collapsed.has(nodeKey('type', node.id))" class="rc-children">
                <!-- 文件夹节点（RunConfigurableNodeKind.FOLDER，userObject 是名字） -->
                <li v-for="group in node.folders" :key="`${node.id}/${group.name}`">
                  <div
                    class="rc-node rc-folder"
                    role="treeitem"
                    :aria-expanded="!collapsed.has(nodeKey('folder', node.id, group.name))"
                    :class="{ 'is-selected': selected === nodeKey('folder', node.id, group.name) }"
                    @click="pickNode(nodeKey('folder', node.id, group.name))"
                  >
                    <button type="button" class="rc-caret" @click.stop="toggleNode(nodeKey('folder', node.id, group.name))">
                      <ChevronRight v-if="collapsed.has(nodeKey('folder', node.id, group.name))" :size="12" /><ChevronDown v-else :size="12" />
                    </button>
                    <FolderPlus :size="12" aria-hidden="true" />
                    <span>{{ group.name }}</span>
                  </div>
                  <ul v-if="!collapsed.has(nodeKey('folder', node.id, group.name))" class="rc-children">
                    <li v-for="config in group.configs" :key="config.name">
                      <div class="rc-node rc-config" role="treeitem" :aria-selected="selected === nodeKey('config', config.name)" :class="{ 'is-selected': selected === nodeKey('config', config.name) }" @click="pickConfig(config.name)">
                        <span class="rc-caret" />
                        <span class="rc-name">{{ config.name }}</span>
                      </div>
                    </li>
                  </ul>
                </li>
                <li v-for="config in node.configs" :key="config.name">
                  <div class="rc-node rc-config" role="treeitem" :aria-selected="selected === nodeKey('config', config.name)" :class="{ 'is-selected': selected === nodeKey('config', config.name) }" @click="pickConfig(config.name)">
                    <span class="rc-caret" />
                    <span class="rc-name">{{ config.name }}</span>
                  </div>
                </li>
              </ul>
            </li>
          </ul>
          <p v-if="!configs.length" class="rc-empty">还没有保存的配置，点「添加」新建一个。</p>
          <!-- RunConfigurable 的树工具条：添加 / 删除 / 复制 / 保存配置 / 新建文件夹 -->
          <div class="rc-toolbar" role="toolbar" aria-label="运行配置工具条">
            <div class="rc-add">
              <Plus :size="14" aria-hidden="true" /><span>添加</span>
              <div class="rc-add-menu">
                <button v-for="entry in TYPES" :key="entry.id" type="button" :disabled="busy" @click="addConfig(entry.id)">{{ entry.label }}</button>
              </div>
            </div>
            <button type="button" class="icon-button" title="删除配置" aria-label="删除配置" :disabled="busy || !selectedConfigName" @click="emit('remove', selectedConfigName)"><Minus :size="15" aria-hidden="true" /></button>
            <button type="button" class="icon-button" title="复制配置" aria-label="复制配置" :disabled="busy || !selectedConfigName" @click="copyConfig"><Copy :size="14" aria-hidden="true" /></button>
            <button type="button" class="icon-button" title="保存配置" aria-label="保存配置" :disabled="busy || !form.name.trim()" @click="save"><Save :size="14" aria-hidden="true" /></button>
            <button type="button" class="icon-button" title="新建文件夹" aria-label="新建文件夹" :disabled="busy" @click="createFolder"><FolderPlus :size="14" aria-hidden="true" /></button>
          </div>
        </div>

        <div class="rc-pane">
          <p v-if="hint" class="rc-hint" role="status">{{ hint }}</p>
          <template v-else>
            <!-- row3：配置编辑器标签页容器。IDEA 只有一个内建标签（ConfigurationSettingsEditor.java:86），
                 其余标签由插件提供 —— 本仓没有插件提供的标签，所以只有一个。 -->
            <div class="rc-tabs" role="tablist" aria-label="配置页签">
              <button type="button" class="rc-tab" role="tab" aria-selected="true">Configuration</button>
            </div>
            <div class="rc-tabpanel" role="tabpanel">
              <label class="field-row"><span>名称</span><input v-model="form.name" aria-label="配置名称" /></label>
              <label class="field-row"><span>类型</span>
                <select v-model="form.type" aria-label="配置类型">
                  <option v-for="entry in TYPES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
                </select>
              </label>
              <label class="field-row"><span>文件夹</span><input v-model="form.folder" list="rc-folders" aria-label="配置所在文件夹" placeholder="留空表示直接在类型节点下" /></label>
              <datalist id="rc-folders"><option v-for="name in folderNames" :key="name" :value="name.split(' / ')[1]" /></datalist>
              <label class="field-row"><span>命令</span><input v-model="form.command" aria-label="Shell 命令" placeholder="cmake --build build" /></label>
              <label class="field-row"><span>程序</span><input v-model="form.program" aria-label="程序" placeholder="build/app.exe" /></label>
              <label class="field-row"><span>参数</span><input v-model="argsText" aria-label="程序参数" placeholder="--flag value" /></label>
              <label class="field-row"><span>工作目录</span><input v-model="form.cwd" aria-label="工作目录" placeholder="项目根" /></label>
              <label v-if="form.type === 'debug'" class="field-row"><span>适配器</span><input v-model="form.adapter" aria-label="调试适配器" placeholder="来自 TaoCode.dap.json 的 kind" /></label>
              <label class="field-row field-row-block"><span>环境变量</span><textarea v-model="envText" rows="3" aria-label="环境变量" placeholder="KEY=value（每行一个）" /></label>
            </div>
            <!-- row4：可折叠的 Before launch（ConfigurationSettingsEditorPanel.kt:60-69，
                 展开状态持久化；标签用 before.launch.panel.title） -->
            <div class="rc-before">
              <button type="button" class="rc-before-head" :aria-expanded="beforeOpen" @click="toggleBefore">
                <ChevronDown v-if="beforeOpen" :size="13" /><ChevronRight v-else :size="13" />
                <span>启动前</span>
                <span class="rc-before-count">{{ (form.beforeLaunch ?? []).length }} 步</span>
              </button>
              <div v-if="beforeOpen" class="rc-before-body">
                <textarea v-model="beforeText" rows="3" aria-label="启动前步骤" placeholder="构建|cmake --build build（每行 name|command）" />
                <p class="field-hint">对应 IDEA 的「Before launch」：步骤按顺序执行，某一步非零退出会中止整个配置。</p>
              </div>
            </div>
          </template>
          <!-- `CommonTags.parallelRun():9-18`：复选框属于「操作系统」组（`group.operating.system`），
               提示文案 `allow.running.multiple.instances.of.the.application.simultaneously`。 -->
          <fieldset class="rc-os-group">
            <legend>操作系统</legend>
            <label class="checkbox-row">
              <input v-model="form.allowRunningInParallel" type="checkbox" />
              <span>允许并行运行多个实例</span>
            </label>
            <p class="field-hint">关闭（IDEA 默认）时，再启动同一个配置会**先停掉上一个实例**；打开则两个并存，运行工具窗口里各占一个标签。</p>
          </fieldset>
        </div>
      </div>
      <footer class="rc-footer">
        <p class="field-hint">配置随项目保存。运行 / 调试用 Shift+F10 / Shift+F9。</p>
        <div class="rc-footer-actions">
          <button type="button" class="primary-button" :disabled="busy || !form.name.trim()" @click="save">确定</button>
          <button type="button" class="subtle-button" @click="emit('close')">取消</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* IDEA 的对话框最小尺寸（RunConfigurable.kt:577-579：宽 ≥800、高 ≥600）。 */
.run-configs-dialog { width: min(880px, 94vw); }
.run-configs-head { display: flex; align-items: center; gap: var(--space-2); }
.run-configs-head h2 { flex: 1; margin: 0; }
.rc-body { display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); min-height: 420px; max-height: 62vh; }
/* 左边框（SideBorder.RIGHT）+ 右面板 padding 15,5,0,15 */
.rc-tree { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.rc-tree > ul { flex: 1; min-height: 0; margin: 0; padding: 4px; overflow: auto; list-style: none; }
.rc-children { margin: 0; padding-left: 14px; list-style: none; }
.rc-node { display: flex; align-items: center; gap: 4px; padding: 2px 4px; border-radius: var(--radius-xs); cursor: default; }
.rc-node.is-selected { background: var(--selected); color: var(--bright); }
.rc-type { font-weight: 600; }
.rc-caret { width: 14px; flex-shrink: 0; display: inline-flex; align-items: center; border: 0; padding: 0; background: transparent; color: inherit; }
.rc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; }
.rc-toolbar { display: flex; align-items: center; gap: 2px; padding: 4px; border-top: 1px solid var(--line); }
.rc-add { position: relative; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: var(--radius-xs); }
.rc-add:hover { background: var(--hover); }
.rc-add-menu { position: absolute; left: 0; bottom: 100%; z-index: 20; display: none; flex-direction: column; min-width: 140px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); box-shadow: var(--popup-shadow); }
.rc-add:hover .rc-add-menu, .rc-add:focus-within .rc-add-menu { display: flex; }
.rc-add-menu button { text-align: left; }
.rc-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 4px 0 15px; overflow: auto; }
.rc-hint { margin: 0; color: var(--muted); font-size: 12px; }
.rc-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); }
.rc-tab { padding: 4px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--secondary); font-size: 12px; }
.rc-tab[aria-selected='true'] { color: var(--bright); border-bottom-color: var(--accent); }
.rc-tabpanel { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) 0; }
.field-row { display: flex; align-items: center; gap: var(--space-2); }
.field-row > span { flex-shrink: 0; width: 72px; color: var(--muted); font-size: 11px; }
.field-row input, .field-row select, .field-row textarea { flex: 1; min-width: 0; padding: 4px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: inherit; font-size: 12px; }
.field-row-block { align-items: flex-start; }
.rc-before { border-top: 1px solid var(--line); padding-top: var(--space-2); }
.rc-before-head { display: flex; align-items: center; gap: 4px; border: 0; padding: 2px 0; background: transparent; color: var(--secondary); font-size: 12px; }
.rc-before-count { color: var(--muted); font-size: 11px; }
.rc-before-body { display: flex; flex-direction: column; gap: var(--space-1); padding-top: var(--space-1); }
.rc-before-body textarea { width: 100%; padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: 12px/1.6 var(--font-mono); }
.rc-footer { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.rc-footer .field-hint { flex: 1; margin: 0; }
.rc-footer-actions { display: flex; gap: var(--space-2); }
@media (max-width: 760px) { .rc-body { grid-template-columns: minmax(0, 1fr); max-height: none; } .rc-tree { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
