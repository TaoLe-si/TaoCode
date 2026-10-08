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
//     唯一的映射差异是**超集**：上游把复选框**只放在模板上**（`ConfigurationSettingsEditorWrapper.java:73-74`
//     `setVisible(settings.isTemplate() && factory.getSingletonPolicy().isPolicyConfigurable())`），
//     本仓模板与配置上各有一份 —— 模板那份随 `src/runConfigTemplates.ts` 的 `applyTemplate` 给新配置取初值，
//     配置那份让已存的配置能改。
//   * 「Store as project file」**语义已核、控件不补**（2026-10-06 第四批，逐行实读
//     `platform/execution-impl/src/com/intellij/execution/impl/RunConfigurationStorageUi.java`）：
//     上游那一格**不是一档而是三档**（`:530` `enum RCStorageType {Workspace, DotIdeaFolder, ArbitraryFileInProject}`），
//     不勾 = `Workspace`（`.idea/workspace.xml`，**本地工作区文件**，不是可共享的项目文件）；
//     勾上 = 后两档之一，默认档位按 `:281-346` 那条 UX-1126 流程算（已共享过就保持、非 VCS 工程走
//     `.idea/runConfigurations`、该目录被 VCS 忽略时改走 `<项目根>/.run`…，`:344-345` 是默认那一步）；
//     文件名 = `MODERN_NAME_CONVERTER(名字) + ".run.xml"`（`:227-229`），
//     复选框与齿轮只对 `type.isManaged` 的配置启用（`:391/:403/:406`）。
//     本仓不渲染这两格的原因不变：要往用户项目里写文件，而 `native/projects_test.cpp:281`
//     那条断言（`"Configuration may not be stored in the user project"`）锁住这个设计，
//     配置随应用状态文件走；接后端要新增 native 模块 + 改 `src/bridge.ts` 的方法联合 + 改
//     `native/main.cpp` 分派表（三处都在别人名下）⇒ 见 docs/wiring-requests-2026-10-06-runcfg4.md W3。
//   * 同一格上的「Manage File Location」齿轮与路径校验六条（`:130-142` 与 `:232-269`）同样不补，理由同上。
//   * 「Run on target」也只在模板上（wrapper `settings.isTemplate()` 才建 `RunOnTargetPanel`），
//     已在 src/executionTargets.ts 接上（本机 + app.jdks 探测的 JDK 目标）。
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDown, ChevronRight, Copy, FolderPlus, Minus, Plus, Save, X } from 'lucide-vue-next'
import { request } from '../bridge'
import type { JdkInfo } from '../buildHost.ts'
import {
  applyTemplate, hasTemplateContent, loadRunConfigTemplates, removeRunConfigTemplate,
  saveRunConfigTemplate, templateFor, type RunConfigTemplate, type RunConfigTemplates,
} from '../runConfigTemplates.ts'
import {
  applyTargetToTemplateProgram, describeExecutionTarget, listExecutionTargets, readRunTargetsEnabled,
  targetById, writeRunTargetsEnabled,
} from '../executionTargets.ts'
import { checkRunConfiguration, runConfigEditorFor, runConfigFieldsFor, type RunConfigFieldId } from '../runConfigEditors.ts'
// 「启动时打开运行面板 / 启动时把焦点移到运行面板」这两个开关：唯一的存放处是**这条运行配置记录**
// （上游 `RunnerAndConfigurationSettings.java:235/:242/:249/:256` + `RunnerAndConfigurationSettingsImpl.kt:108-109/:212-222/:243-244/:317-321`），
// 本面板是它唯一的**写**点（对应上游 Before launch 那两格：`BeforeRunStepsPanel.java:170-171/:214-217/:238-243`
// 经 `ConfigurationSettingsEditorWrapper.java:143-144` 落回记录；新 UI 的两个 tag 在 `BeforeRunFragment.java:28-42`）。
// 补默认与「只落非默认」都走 `src/runStartupFocus.ts` 那一个入口，本组件不自己写规则。
import {
  runStartupFocusFlagsOf, withRunStartupFocusFlags,
} from '../runStartupFocus.ts'
import {
  loadTargetEnvironments, projectDefaultTarget, targetEnvironmentsStoreKey, validateTargetEnvironment,
  type TargetEnvironment, type TargetEnvironmentsState,
} from '../targetEnvironments.ts'
import { runtimeExecutable } from '../languageRuntimes.ts'
import { currentTargetPlatform, targetPlatformOfPath } from '../targetPlatform.ts'
import TargetEnvironmentsDialog from './TargetEnvironmentsDialog.vue'
import type { RuntimeRunConfig as RunConfig } from '../runTargets.ts'
import {
  RUN_CONFIG_TYPES as TYPES, RUN_CONFIG_UNNAMED_NAME, buildRunConfigTree, formatRunArguments, parseRunArguments,
  nodeKey, runConfigNameProblem, runConfigReferrers, uniqueRunConfigName, validateFolderName, type RunConfigSaveOrigin,
} from '../runConfigTree'
import EnvironmentVariablesEditor from './EnvironmentVariablesEditor.vue'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  configs: RunConfig[]
  /** 当前编辑的草稿（由父组件持有，保存时回写）。 */
  draft: RunConfig
  busy?: boolean
}>()

const emit = defineEmits<{
  /**
   * `origin` 带的是「这条草稿的前身」（见 `src/runConfigTree.ts` 的 `RunConfigSaveOrigin`）：
   * 上游没有这一参 —— 它手里那条 `RunnerAndConfigurationSettings` 就是身份本身，
   * 改名字段动的是同一条（`RunConfigurable.kt:659-666` 只在 apply 时拦重名）、
   * 副本插在被复制的那条之后（同文件 `:900-911`）。
   * 本仓的草稿是扁平记录、名字就是键 ⇒ 不带这一参就是「改名 = 新增一条、旧的那条留在盘上」。
   * `src/App.vue:2563` 那句 `@save="saveRunConfigFromDialog"` 会把两个参数都传过去（保留文件，不动它）。
   */
  (event: 'save', config: RunConfig, origin?: RunConfigSaveOrigin): void
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
/**
 * 面板的 reset 侧：把那两个开关**补成显式布尔**再交给复选框。
 * 上游同一件事在 `BeforeRunStepsPanel.java:214-217`（`setSelected(settings.isActivateToolWindowBeforeRun())`）——
 * 那里读的已经是补过默认的值，所以「记录里没这个键」的旧配置在界面上显示成**勾着打开面板**（默认 true，
 * `RunnerAndConfigurationSettingsImpl.kt:108`）、焦点那格不勾（`:109`）。
 * 只补在**表单**上：保存时 `withRunStartupFocusFlags` 又把默认值收掉，配置记录不会因此长出新键。
 */
function withStartupFocusDefaults(config: RunConfig): RunConfig {
  const flags = runStartupFocusFlagsOf(config)
  return { ...config, activateToolWindowBeforeRun: flags.activateToolWindowBeforeRun, focusToolWindowBeforeRun: flags.focusToolWindowBeforeRun }
}

const form = ref<RunConfig>(withStartupFocusDefaults({ ...props.draft }))
const hint = ref('')
/**
 * 表单当前**载入自**哪条记录（上游没有这个东西：那里改的是同一条 settings，见 `defineEmits` 上那段）。
 * 只在「草稿换人」时更新（父组件 select/载入新记录 ⇒ `props.draft` 变），
 * 新建（`addConfig`）当场清空 —— 否则「新建」会被当成把当前选中那条改名。
 */
const originName = ref(props.draft.name?.trim() ?? '')

watch(() => props.draft, value => {
  form.value = withStartupFocusDefaults({ ...value })
  originName.value = value.name?.trim() ?? ''
  if (value.name) selected.value = nodeKey('config', value.name)
}, { deep: true })

// ── 模板配置（上游 `RunManagerImpl.getConfigurationTemplate` / `TemplateConfigurable`）──
// 选中类型节点时右侧是模板编辑器（与上游一致：RunOnTarget 等行只挂在模板上）；新建配置时
// 由 `applyTemplate` 从模板取初值。模板存 localStorage、按项目根分键（项目根取自 app.state
// 的 lastProject —— 上游模板是项目级设置；本仓的共享配置落盘由设计禁止，模板同样不写进用户项目）。
// 运行目标（`ExecutionTarget`）：本机 + `app.jdks` 探测到的 JDK；注册表开关 RunTargetsEnabled
// 关掉时只留本机目标。详见 src/runConfigTemplates.ts 与 src/executionTargets.ts。
const projectRoot = ref('')
const jdks = ref<JdkInfo[]>([])
const templates = ref<RunConfigTemplates>({})
const targetsEnabled = ref(readRunTargetsEnabled())
// 初值 = 上游那两个开关的默认（activate true / focus false，`RunnerAndConfigurationSettingsImpl.kt:108-109`）；
// 选中类型节点时由 `loadTemplateIntoForm` 用盘上的模板覆盖（缺键同样补这两个默认）。
const templateForm = ref<RunConfigTemplate>({ ...runStartupFocusFlagsOf(undefined) })
const templateHint = ref('')
// 用户自定义目标环境（上游 `TargetEnvironmentsManager`）：存 localStorage、按项目根分键。
const targetEnvs = ref<TargetEnvironmentsState>({ defaultTargetUuid: '', targets: [] })
const manageTargetsOpen = ref(false)
const selectedType = computed(() => selected.value.startsWith('type:') ? selected.value.slice(5) : '')
function storage(): Storage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}
function loadTemplateIntoForm(type: string) {
  const saved = templateFor(templates.value, type)
  // 上游 `RunOnTargetPanel.reset()`（:102-107）把「运行于」重置成配置自己记的默认目标名；
  // 模板没记过时用**项目默认目标**（上游 `ExecutionTargetManager.getActiveTarget`，见
  // CompoundRunConfiguration.kt:146 的 activeTarget/defaultTarget 两个取值）——本仓照此预填。
  const fallback = projectDefaultTarget(targetEnvs.value)?.uuid
  // 模板那两个开关同样要补默认再上复选框（与配置那一格同一条规则，见 `withStartupFocusDefaults`）：
  // `runStartupFocusFlagsOf` 认的就是「记录里缺键 ⇒ 上游默认」，模板记录与配置记录形状一致。
  const startup = runStartupFocusFlagsOf(saved)
  templateForm.value = {
    ...(saved ?? {}),
    activateToolWindowBeforeRun: startup.activateToolWindowBeforeRun,
    focusToolWindowBeforeRun: startup.focusToolWindowBeforeRun,
    ...(!saved?.target && fallback ? { target: `target:${fallback}` } : {}),
  }
  templateHint.value = ''
}
watch(selectedType, type => { if (type) loadTemplateIntoForm(type) }, { immediate: true })
const templateTargets = computed(() => {
  const all = listExecutionTargets(jdks.value, { custom: targetEnvs.value.targets })
  return targetsEnabled.value ? all : all.filter(target => target.kind === 'local')
})
/** 「运行于」那一行当前目标的问题（上游校验不过的目标仍留在列表里，只是图标带告警）。 */
const templateTarget = computed<TargetEnvironment | undefined>(() => {
  const id = templateForm.value.target
  return targetEnvs.value.targets.find(entry => `target:${entry.uuid}` === id)
})
const templateTargetProblem = computed(() => {
  const id = templateForm.value.target ?? ''
  if (!id) return ''
  if (id === 'local' || id.startsWith('jdk:')) return ''
  if (!templateTarget.value) return `找不到运行目标 '${id}'；将按本机目标运行。`
  const problem = validateTargetEnvironment(templateTarget.value)
  return problem ? `运行目标「${templateTarget.value.displayName}」${problem}，将按本机目标运行。` : ''
})
/** 目标里那个运行时解析出来的可执行文件（给用户看清楚「这个目标到底会用什么程序跑」）。 */
const templateTargetExecutable = computed(() => {
  const id = templateForm.value.target ?? ''
  const target = targetById(templateTargets.value, id)
  if (!target?.runtime) return ''
  return runtimeExecutable(target.runtime, target.platform ?? (id.startsWith('jdk:') ? targetPlatformOfPath(target.runtime.homePath) : currentTargetPlatform()))
})
/** 把编辑器发回的行数组写回表单（`env` 的持久形状不变：`KEY=VALUE` 行）。 */
function setFormEnv(lines: string[]) {
  form.value = { ...form.value, env: lines }
}
function setTemplateEnv(lines: string[]) {
  templateForm.value = { ...templateForm.value, env: lines }
}
const templateBeforeText = computed({
  get: () => (templateForm.value.beforeLaunch ?? []).map(step => `${step.name}|${step.command}`).join('\n'),
  set: (value: string) => {
    const steps = value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [name, ...rest] = line.split('|')
      return { name: (name ?? '').trim(), command: rest.join('|').trim() }
    }).filter(step => step.name && step.command)
    templateForm.value = { ...templateForm.value, beforeLaunch: steps }
  },
})
const templateArgsText = computed({
  get: () => formatRunArguments(templateForm.value.args ?? []),
  set: (value: string) => { templateForm.value = { ...templateForm.value, args: parseRunArguments(value) } },
})
function saveTemplate() {
  const type = selectedType.value
  if (!type) return
  templates.value = saveRunConfigTemplate(storage(), projectRoot.value, type, templateForm.value)
  templateHint.value = '已保存模板：新建这个类型的配置会从模板取初值。'
}
function clearTemplate() {
  const type = selectedType.value
  if (!type) return
  templates.value = removeRunConfigTemplate(storage(), projectRoot.value, type)
  // 清空后表单回到**上游默认**（activate=true / focus=false，`RunnerAndConfigurationSettingsImpl.kt:108-109`），
  // 不是两个都不勾 —— 否则「清除模板」会把界面显示成一个不存在的 false。
  templateForm.value = { ...runStartupFocusFlagsOf(undefined) }
  templateHint.value = '模板已清除，新建配置回到空表单。'
}
function toggleTargetsEnabled(checked: boolean) {
  targetsEnabled.value = checked
  writeRunTargetsEnabled(storage(), checked)
  if (!checked && templateForm.value.target) templateForm.value = { ...templateForm.value, target: '' }
}
/** 目标管理对话框点「应用」：落盘 + 刷新下拉（上游 `RunOnTargetPanel` 收到 openForEditing()=true 后
 *  `resetRunOnComboBox(selectedName)`，见 RunOnTargetPanel.java:57-59）。 */
function applyTargetEnvironments(state: TargetEnvironmentsState) {
  targetEnvs.value = state
  try { storage()?.setItem(targetEnvironmentsStoreKey(projectRoot.value), JSON.stringify(state)) } catch { /* 存储不可用只影响持久化 */ }
  if (selectedType.value) loadTemplateIntoForm(selectedType.value)
  templateHint.value = '目标已更新。'
}
onMounted(() => {
  void (async () => {
    try {
      const state = await request<{ lastProject?: string | null }>('app.state')
      projectRoot.value = state?.lastProject ?? ''
    } catch { projectRoot.value = '' }
    templates.value = loadRunConfigTemplates(storage(), projectRoot.value)
    targetEnvs.value = loadTargetEnvironments(storage(), projectRoot.value)
    try { jdks.value = (await request<{ jdks?: JdkInfo[] }>('app.jdks')).jdks ?? [] }
    catch { jdks.value = [] }
    if (selectedType.value) loadTemplateIntoForm(selectedType.value)
  })()
})

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
  // IDEA 点类型节点时右栏是**模板编辑器**（本仓已实现，见下面 selectedType 分支）；
  // 文件夹节点没有自己的编辑器，给一句操作说明。
  hint.value = key.startsWith('type:')
    ? ''
    : '文件夹：用工具条的「新建文件夹」把选中的配置移进来，或在右侧直接改「文件夹」。'
}
function toggleNode(key: string) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

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
/**
 * 「启动前」标题上的条数后缀 = 上游 `BeforeRunStepsPanel.updateText()`（`:222-227`）那一条：
 * `count == 0 || isVisible() ? "" : message("before.launch.panel.title.suffix", count)`
 * ⇒ **展开着不挂、0 条不挂**，只有折叠起来当摘要时才挂（文案 `ExecutionBundle.properties:302`
 * = `: {0,choice,1#1 task|2#{0} tasks}`，标题本体 `:301` = `&Before launch`）。
 * 英文那条 choice 形分单复数（1 task / 2 tasks），中文不分 ⇒ 后缀对 1 和 N 是同一句（如实登记）。
 */
const beforeLaunchCount = computed(() => (form.value.beforeLaunch ?? []).length)
const beforeLaunchSuffix = computed(() =>
  !beforeOpen.value && beforeLaunchCount.value > 0 ? `：${beforeLaunchCount.value} 项任务` : '')
// IDEA 的 CompoundRunConfiguration editor 只有一张成员多选表（`CompositeSettingsEditor`）——
// 选中的成员在运行时可被单独启动，所以这里禁止把成员选成自己或另一个复合配置的**空环**，
// 环形/缺失引用由 src/runConfigTree.ts 的整组校验在启动前拒绝（保存也拦一次）。
const RUNNABLE_MEMBERS = computed(() => props.configs.filter(config => config.name !== form.value.name).map(config => ({ name: config.name, type: config.type ?? 'shell' })))
function toggleMember(name: string, checked: boolean) {
  const members = new Set(form.value.configurations ?? [])
  if (checked) members.add(name); else members.delete(name)
  form.value = { ...form.value, configurations: [...members] }
}

const argsText = computed({
  get: () => formatRunArguments(form.value.args ?? []),
  set: (value: string) => { form.value = { ...form.value, args: parseRunArguments(value) } },
})

// ── 逐类型的设置编辑器（上游 `getConfigurationEditor()`：每种类型一套，页签集合由类型决定，
// 见 ConfigurationSettingsEditor.java:59-88 与 CompoundRunConfiguration.kt:113）──
// 字段集合与顺序来自 src/runConfigEditors.ts 的 RUN_CONFIG_EDITORS；本仓的成员表还留在
// 成员勾选块里（`CompositeSettingsEditor` 的对应物）。
const configEditor = computed(() => runConfigEditorFor(form.value.type))
const configFields = computed(() => runConfigFieldsFor(form.value.type, form.value))
const hasField = (id: RunConfigFieldId) => configFields.value.some(field => field.id === id)
/** 逐类型校验的实时结果（上游 checkConfiguration 每敲一个字都跑一遍，RunConfiguration.java:158）。 */
const configProblem = computed(() => checkRunConfiguration(form.value, props.configs))

const uniqueName = (base: string) => uniqueRunConfigName(props.configs, base)
/**
 * 依赖这条配置的复合配置（「任务依赖」图里的入边）。上游成员按 `(type, name)` 记
 * （`CompoundRunConfiguration.kt:160`），本仓用名字当键 ⇒ 查的是**盘上那个名字**
 * （正在改名时表单里的新名字还没写回去，拿它查不到引用者）。
 * 两个真实消费点：改名时成员引用一起回写（`src/runConfigTree.ts` 的 `applyRunConfigSave`）、
 * 删除时把成员一起摘掉或如实拦下（`planRunConfigRemoval`）—— 本仓的 schema 把「成员不存在」
 * 判成整份坏档（`src/runConfigurationSchema.ts` 的整组校验），所以删除必须处理这张图。
 */
const referrers = computed(() => {
  const stored = originName.value || form.value.name.trim()
  return stored ? runConfigReferrers(stored, props.configs) : []
})
/** IDEA 的 add 按钮：在**选中的类型**下新建（`RunConfigurable` 用类型节点决定工厂）。 */
function addConfig(type: RunConfig['type']) {
  const folder = selected.value.startsWith('folder:') ? selected.value.slice(7).split('\u0000')[1] ?? '' : ''
  // 基名 = 上游 `createUniqueName` 的回落那一档（`ExecutionBundle.properties:266` = `Unnamed` 的直译）：
  // 上游先问 `LocatableConfiguration.suggestedName()`（`RunConfigurable.kt:942-949`），本仓没有「建议名」
  // 这一层 ⇒ 直接落回落档。编号形状由 `uniqueRunConfigName` 按上游 `RunManager.kt:51-65` 给（`名 (1)`）。
  const name = uniqueName(RUN_CONFIG_UNNAMED_NAME)
  // 新建没有前身：不清的话「保存」会被父组件当成把当前选中那条改名（`originName` 的口径见它的声明处）。
  originName.value = ''
  // 新配置从模板取初值（上游 createConfiguration 把模板字段拷进新配置）。
  const template = type ? templateFor(templates.value, type) : undefined
  const seeded = applyTemplate({ name, type, command: '', program: '', args: [], cwd: '', env: [], beforeLaunch: [], folder }, template, name)
  // Run on target：模板里选的 JDK 目标作用到程序上（Java 形态才替换；见 src/executionTargets.ts）。
  const patch = applyTargetToTemplateProgram(template ?? {}, targetById(templateTargets.value, template?.target))
  form.value = { ...seeded, ...patch }
  selected.value = nodeKey('config', name)
  hint.value = ''
}
/**
 * `MyCopyAction`（`platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt:1129-1160`）：
 * 副本名 = `createUniqueName(typeNode, configuration.nameText, …)`（`:1142`）——**基名就是源配置自己的名字**，
 * 上游没有任何「副本 / Copy of」后缀（那句是原实现自造的，已订正）；副本落在源后面那一格（`:902`）。
 * 上游那条 `type.isManaged` 的可用性门（`:1161-1163`）本仓**不补**：`ConfigurationType.java:83-85` 默认 true，
 * 全树只有 `UnknownConfigurationType.java:42` 返回 false，而本仓的 schema 直接拒未知类型
 * （`src/runConfigurationSchema.ts` 那条类型清单门）⇒ 没有「坏配置」这一档，补上就是一张假门。
 */
function copyConfig() {
  const source = props.configs.find(config => config.name === selectedConfigName.value)
  if (!source) { hint.value = '先选中一个配置再复制。'; return }
  // `ModuleBasedConfiguration.java:175-178` 特意把 `isAllowRunningInParallel` 一起复制过去。
  const copy: RunConfig = { ...source, name: uniqueName(source.name), args: [...(source.args ?? [])], env: [...(source.env ?? [])], beforeLaunch: (source.beforeLaunch ?? []).map(step => ({ ...step })) }
  emit('save', copy, { copyOf: source.name })
  selected.value = nodeKey('config', copy.name)
  form.value = { ...copy }
  // 副本自己成了表单的前身：写盘成功时父组件会把草稿载回这条（`watch` 那边同样置上），
  // 万一这条写入失败（项目没打开 / 宿主拒档），下一次「保存」也不该把**源**那条改名掉。
  originName.value = copy.name
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
  let next: RunConfig = { ...form.value, name: form.value.name.trim() }
  if (next.type === 'compound') {
    // RunConfigurationBase: a compound has no executable of its own — its members do.
    if (!next.configurations?.length) { hint.value = '复合配置至少要选择一个成员。'; return }
    const { command: _command, program: _program, args: _args, cwd: _cwd, env: _env, beforeLaunch: _before, ...rest } = next
    next = { ...rest, command: '' }
  } else if (!next.command.trim() && !next.program?.trim()) { hint.value = '请填写命令或可执行程序。'; return }
  const problem = validateFolderName(folder)
  if (problem) { hint.value = problem; return }
  // 逐类型校验（`checkConfiguration()` 的等价物）：前面几条 guard 是本仓既有的文案，
  // 这里补上它们没覆盖的 —— 环境变量/启动前步骤的格式与复合成员的整组校验
  // （上游这两条分别落在编辑器 apply 与成员表的环检测上）。
  const checked = checkRunConfiguration({ ...next, name: next.name.trim() }, props.configs)
  if (checked?.severity === 'error') { hint.value = checked.message; return }
  // 重名拦下：上游也是排在**各编辑器 apply 之后**（`RunConfigurable.kt:649-666` 先 `applyConfiguration`
  // 再 `names.add`），所以这条判据放在逐类型校验后面，顺序与它一致。
  const conflict = runConfigNameProblem(props.configs, next.name, originName.value)
  if (conflict) { hint.value = conflict; return }
  if (folder) next.folder = folder
  else delete next.folder
  // 面板的 apply 侧（上游 `ConfigurationSettingsEditorWrapper.java:143-144` 的两行 set），
  // 落盘规则也照上游：只有**非默认**的值才留在配置记录里（`RunnerAndConfigurationSettingsImpl.kt:317-321`）。
  next = withRunStartupFocusFlags(next, {
    activateToolWindowBeforeRun: form.value.activateToolWindowBeforeRun === true,
    focusToolWindowBeforeRun: form.value.focusToolWindowBeforeRun === true,
  })
  // 带上前身：改名 = 就地替换那一条（`src/runConfigurations.ts` 的 `saveRunConfigFromDialog`），
  // 新建与「名字没动」都传 undefined ⇒ 走原来的追加/就地覆盖。
  emit('save', next, originName.value && originName.value !== next.name ? { from: originName.value } : undefined)
  selected.value = nodeKey('config', next.name)
  hint.value = ''
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="help-dialog run-configs-dialog" role="dialog" aria-modal="true" aria-label="运行/调试配置">
      <header class="run-configs-head">
        <h2>运行/调试配置</h2>
        <button type="button" class="icon-button" aria-label="关闭" title="关闭" @click="emit('close')"><X :size="iconSize.action" aria-hidden="true" /></button>
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
                <button type="button" class="rc-caret" :aria-label="collapsed.has(nodeKey('type', node.id)) ? '展开' : '折叠'" :title="collapsed.has(nodeKey('type', node.id)) ? '展开' : '折叠'" @click.stop="toggleNode(nodeKey('type', node.id))">
                  <ChevronRight v-if="collapsed.has(nodeKey('type', node.id))" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
                </button>
                <span>{{ node.label }}</span>
                <!-- 该类型已设置模板（新建配置会从模板取初值） -->
                <span v-if="hasTemplateContent(templateFor(templates, node.id))" class="rc-template-badge">模板</span>
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
                    <button type="button" class="rc-caret" :aria-label="collapsed.has(nodeKey('folder', node.id, group.name)) ? '展开' : '折叠'" :title="collapsed.has(nodeKey('folder', node.id, group.name)) ? '展开' : '折叠'" @click.stop="toggleNode(nodeKey('folder', node.id, group.name))">
                      <ChevronRight v-if="collapsed.has(nodeKey('folder', node.id, group.name))" :size="iconSize.dense" /><ChevronDown v-else :size="iconSize.dense" />
                    </button>
                    <FolderPlus :size="iconSize.dense" aria-hidden="true" />
                    <span>{{ group.name }}</span>
                  </div>
                  <ul v-if="!collapsed.has(nodeKey('folder', node.id, group.name))" class="rc-children">
                    <li v-for="config in group.configs" :key="config.name">
                      <div class="rc-node rc-config" role="treeitem" :aria-selected="selected === nodeKey('config', config.name)" :class="{ 'is-selected': selected === nodeKey('config', config.name) }" @click="pickConfig(config.name)">
                        <span class="rc-caret" />
                        <span class="rc-name">{{ config.name }}</span><span v-if="config.temporary" class="rc-temporary">临时</span>
                      </div>
                    </li>
                  </ul>
                </li>
                <li v-for="config in node.configs" :key="config.name">
                  <div class="rc-node rc-config" role="treeitem" :aria-selected="selected === nodeKey('config', config.name)" :class="{ 'is-selected': selected === nodeKey('config', config.name) }" @click="pickConfig(config.name)">
                    <span class="rc-caret" />
                    <span class="rc-name">{{ config.name }}</span><span v-if="config.temporary" class="rc-temporary">临时</span>
                  </div>
                </li>
              </ul>
            </li>
          </ul>
          <p v-if="!configs.length" class="rc-empty">还没有保存的配置。</p>
          <!-- RunConfigurable 的树工具条：添加 / 删除 / 复制 / 保存配置 / 新建文件夹 -->
          <div class="rc-toolbar" role="toolbar" aria-label="运行配置工具条">
            <div class="rc-add">
              <Plus :size="iconSize.control" aria-hidden="true" /><span>添加</span>
              <div class="rc-add-menu">
                <button v-for="entry in TYPES" :key="entry.id" type="button" :disabled="busy" @click="addConfig(entry.id)">{{ entry.label }}</button>
              </div>
            </div>
            <button type="button" class="icon-button" aria-label="删除配置" title="删除配置" :disabled="busy || !selectedConfigName" @click="emit('remove', selectedConfigName)"><Minus :size="iconSize.toolbar" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="复制配置" title="复制配置" :disabled="busy || !selectedConfigName" @click="copyConfig"><Copy :size="iconSize.control" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="保存配置" title="保存配置" :disabled="busy || !form.name.trim()" @click="save"><Save :size="iconSize.control" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="新建文件夹" title="新建文件夹" :disabled="busy" @click="createFolder"><FolderPlus :size="iconSize.control" aria-hidden="true" /></button>
          </div>
        </div>

        <div class="rc-pane">
          <p v-if="hint" class="rc-hint" role="status">{{ hint }}</p>
          <!-- 类型节点选中：模板编辑器（上游 ConfigurationSettingsEditorWrapper 的模板行：
               启动前 / 允许并行 / Run on target 都挂在模板上）。 -->
          <template v-else-if="selectedType">
            <div class="rc-tabs" role="tablist" aria-label="模板页签">
              <button type="button" class="rc-tab" role="tab" aria-selected="true">模板</button>
            </div>
            <div class="rc-tabpanel" role="tabpanel">
              <label class="field-row"><span>命令</span><input v-model="templateForm.command" aria-label="模板命令" placeholder="cmake --build build" /></label>
              <label class="field-row"><span>程序</span><input v-model="templateForm.program" aria-label="模板程序" placeholder="build/app.exe" /></label>
              <label class="field-row"><span>参数</span><input v-model="templateArgsText" aria-label="模板参数" placeholder="--flag value" /></label>
              <label class="field-row"><span>工作目录</span><input v-model="templateForm.cwd" aria-label="模板工作目录" placeholder="项目根" /></label>
              <div class="rc-target-row">
                <label class="field-row"><span>运行目标</span>
                  <select v-model="templateForm.target" aria-label="运行目标">
                    <option value="">本地机器（默认）</option>
                    <option v-for="target in templateTargets" :key="target.id" :value="target.id">{{ describeExecutionTarget(target) }}</option>
                  </select>
                </label>
                <!-- 上游同一个位置挂一个 ActionLink「管理目标…」，点了开 TargetEnvironmentsConfigurable
                     （RunOnTargetPanel.java:51-61；文案 edit.run.configuration.run.configuration.manage.targets.label）。 -->
                <button type="button" class="subtle-button rc-manage-targets" :disabled="busy" @click="manageTargetsOpen = true">管理目标…</button>
              </div>
              <p v-if="templateTargetExecutable" class="field-hint">这个目标会用 <code>{{ templateTargetExecutable }}</code> 起程序（新建配置时替换同形态的程序名）。</p>
              <p v-if="templateTargetProblem" class="rc-warn" role="status">{{ templateTargetProblem }}</p>
              <label class="checkbox-row">
                <input type="checkbox" :checked="targetsEnabled" aria-label="启用多运行目标" @change="toggleTargetsEnabled(($event.target as HTMLInputElement).checked)" />
                <span>启用多运行目标（RunTargetsEnabled 注册表开关；关掉只留本机）</span>
              </label>
              <!-- 模板的环境变量用同一套行编辑器（模板记录的 `env` 形状与配置记录一致，
                   新建配置时由 `applyTemplate` 拷初值）。上游的「包含系统环境变量」勾选不渲染：
                   本仓运行通道永远在继承来的环境之上叠（native/runner.hpp:30）。 -->
              <div class="field-row field-row-block">
                <span>环境变量</span>
                <EnvironmentVariablesEditor :model-value="templateForm.env ?? []" :busy="busy" label-prefix="模板环境变量" @update:model-value="setTemplateEnv" />
              </div>
              <label class="field-row field-row-block"><span>启动前</span><textarea v-model="templateBeforeText" rows="3" aria-label="模板启动前步骤" placeholder="构建|cmake --build build（每行 name|command）" /></label>
              <label class="checkbox-row">
                <input v-model="templateForm.allowRunningInParallel" type="checkbox" />
                <span>允许并行运行多个实例</span>
              </label>
              <!-- 模板也带这两个初值：上游新建配置时把模板记录上的同两个字段拷进来
                   （`RunnerAndConfigurationSettingsImpl.kt:455-461` 的 `importRunnerAndConfigurationSettings`，
                   另两个字段是 `isEditBeforeRun` 与 activate/focus ⇒ 本仓承接的是 activate/focus 这两行 `:460-461`）。
                   这**不是第二处存放**：模板只当「新配置的初值」，配置一旦落成记录就只读记录那一份，
                   合并规则在 `src/runConfigTemplates.ts` 的 `applyTemplate` 里（走同一个 `runStartupFocusFlagsOf` 入口）。 -->
              <label class="checkbox-row">
                <input v-model="templateForm.activateToolWindowBeforeRun" type="checkbox" />
                <span>启动时打开运行/调试工具窗口（新建配置的初值）</span>
              </label>
              <label class="checkbox-row">
                <input v-model="templateForm.focusToolWindowBeforeRun" type="checkbox" />
                <span>启动时把焦点移到运行/调试工具窗口（新建配置的初值）</span>
              </label>
              <div class="rc-template-actions">
                <button type="button" class="primary-button" :disabled="busy" @click="saveTemplate">保存模板</button>
                <button type="button" class="subtle-button" :disabled="busy" @click="clearTemplate">清除模板</button>
                <span v-if="templateHint" class="field-hint" role="status">{{ templateHint }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <!-- row3：配置编辑器标签页容器。IDEA 只有一个内建标签（ConfigurationSettingsEditor.java:86），
                 其余标签由插件提供 —— 本仓没有插件提供的标签，所以只有一个。 -->
            <div class="rc-tabs" role="tablist" aria-label="配置页签">
              <button type="button" class="rc-tab" role="tab" aria-selected="true">{{ configEditor.tabTitle }}</button>
            </div>
            <p v-if="configProblem" class="rc-problem" :class="{ 'rc-warn': configProblem.severity === 'warning' }" role="status">{{ configProblem.message }}</p>
            <div class="rc-tabpanel" role="tabpanel">
              <label class="field-row"><span>名称</span><input v-model="form.name" aria-label="配置名称" /></label>
              <label class="field-row"><span>类型</span>
                <select v-model="form.type" aria-label="配置类型">
                  <option v-for="entry in TYPES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
                </select>
              </label>
              <label class="field-row"><span>文件夹</span><input v-model="form.folder" list="rc-folders" aria-label="配置所在文件夹" placeholder="留空表示直接在类型节点下" /></label>
              <datalist id="rc-folders"><option v-for="name in folderNames" :key="name" :value="name.split(' / ')[1]" /></datalist>
              <!-- 「谁依赖这条配置」——复合成员那条依赖边在界面上的投影（不是新状态：真源是
                   `props.configs` 里的成员表；改名回写与删除摘链都以它为准）。 -->
              <p v-if="referrers.length" class="field-hint rc-referrers" role="status">
                依赖它的配置：{{ referrers.map(entry => entry.name).join('、') }}（改名会一起回写成员引用；删除会把它从这些成员里移除）。
              </p>
              <!-- 逐类型的字段（上游 `getConfigurationEditor()`：每种类型一套编辑器，
                   ConfigurationSettingsEditor.java:59-88 + CompoundRunConfiguration.kt:113）。
                   字段集合/顺序来自 src/runConfigEditors.ts 的 RUN_CONFIG_EDITORS，
                   「启动前」那一行在下面单独的折叠块里（row4）。 -->
              <template v-for="field in configFields" :key="field.id">
                <label v-if="field.id === 'command'" class="field-row"><span>命令</span><input v-model="form.command" aria-label="Shell 命令" :placeholder="field.placeholder" /></label>
                <label v-else-if="field.id === 'program'" class="field-row"><span>程序</span><input v-model="form.program" aria-label="程序" :placeholder="field.placeholder" /></label>
                <label v-else-if="field.id === 'args'" class="field-row"><span>参数</span><input v-model="argsText" aria-label="程序参数" :placeholder="field.placeholder" /></label>
                <label v-else-if="field.id === 'cwd'" class="field-row"><span>工作目录</span><input v-model="form.cwd" aria-label="工作目录" :placeholder="field.placeholder" /></label>
                <label v-else-if="field.id === 'adapter'" class="field-row"><span>适配器</span><input v-model="form.adapter" aria-label="调试适配器" :placeholder="field.placeholder" /></label>
                <!-- 环境变量：行编辑器（上游用户变量表的 DOM 形式，规则/文案在
                     src/runEnvironmentVariables.ts）。替代原来的整块文本框 —— 逐行可改、
                     非法行当场点名，持久形状仍是 `KEY=VALUE` 行（宿主按同一形状收）。 -->
                <div v-else-if="field.id === 'env'" class="field-row field-row-block">
                  <span>环境变量</span>
                  <EnvironmentVariablesEditor :model-value="form.env ?? []" :busy="busy" label-prefix="环境变量" @update:model-value="setFormEnv" />
                </div>
                <!-- CompoundRunConfiguration 的编辑器：只列成员，命令/参数/工作目录都在成员自己身上
                     （`CompositeSettingsEditor` + `RunConfigurationBase` 的 WithoutOwnBeforeRunSteps）。 -->
                <fieldset v-else-if="field.id === 'members'" class="rc-members">
                  <legend>成员配置</legend>
                  <label v-for="member in RUNNABLE_MEMBERS" :key="member.name" class="checkbox-row">
                    <input type="checkbox" :checked="form.configurations?.includes(member.name)" @change="toggleMember(member.name, ($event.target as HTMLInputElement).checked)" />
                    <span>{{ member.name }}</span>
                    <span class="field-hint">{{ member.type }}</span>
                  </label>
                  <p v-if="!RUNNABLE_MEMBERS.length" class="field-hint">还没有可选的成员：先建一个普通配置。</p>
                </fieldset>
              </template>
            </div>
            <!-- row4：可折叠的 Before launch（ConfigurationSettingsEditorPanel.kt:60-69，
                 展开状态持久化；标签用 before.launch.panel.title）。复合配置没有自己的启动前
                 （WithoutOwnBeforeRunSteps，ConfigurationSettingsEditorWrapper.java:71）。 -->
            <div v-if="hasField('beforeLaunch')" class="rc-before">
              <button type="button" class="rc-before-head" :aria-expanded="beforeOpen" @click="toggleBefore">
                <ChevronDown aria-hidden="true" v-if="beforeOpen" :size="iconSize.menu" /><ChevronRight aria-hidden="true" v-else :size="iconSize.menu" />
                <span>启动前</span><span v-if="beforeLaunchSuffix" class="rc-before-count">{{ beforeLaunchSuffix }}</span>
              </button>
              <div v-if="beforeOpen" class="rc-before-body">
                <textarea v-model="beforeText" rows="3" aria-label="启动前步骤" placeholder="构建|cmake --build build（每行 name|command）" />
                <!-- 上游那两格就长在这个面板里（`BeforeRunStepsPanel.java:170-171` 建勾、`:183-184` 加进
                     checkboxPanel），文案取新 UI 那两个 tag 的措辞（`ExecutionBundle.properties:175-176`，
                     提示语 `:578-579`）。它们写的值是**这条配置**的字段（`ConfigurationSettingsEditorWrapper.java:143-144`），
                     消费点在 `src/runActions.ts` 的 `startRun` ⇒ 不是装饰控件。
                     复合配置没有这一格：上游对 `WithoutOwnBeforeRunSteps` 把整行藏掉
                     （wrapper `:71`），本仓的 `hasField('beforeLaunch')` 是同一个门。 -->
                <label class="checkbox-row">
                  <input v-model="form.activateToolWindowBeforeRun" type="checkbox" />
                  <span>启动时打开运行/调试工具窗口</span>
                </label>
                <label class="checkbox-row">
                  <input v-model="form.focusToolWindowBeforeRun" type="checkbox" />
                  <span>启动时把焦点移到运行/调试工具窗口</span>
                </label>
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
          </fieldset>
        </div>
      </div>
      <footer class="rc-footer">
        <div class="rc-footer-actions">
          <button type="button" class="primary-button" :disabled="busy || !form.name.trim()" @click="save">确定</button>
          <button type="button" class="subtle-button" @click="emit('close')">取消</button>
        </div>
      </footer>
    </section>
    <!-- 目标环境管理（上游 RunOnTargetPanel 里那个 ActionLink → TargetEnvironmentsConfigurable，
         RunOnTargetPanel.java:51-61 / TargetEnvironmentsConfigurable.kt:54-56）。 -->
    <TargetEnvironmentsDialog
      v-if="manageTargetsOpen"
      :state="targetEnvs"
      :project-root="projectRoot"
      :busy="busy"
      @apply="applyTargetEnvironments"
      @close="manageTargetsOpen = false"
    />
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
.rc-tree > ul { flex: 1; min-height: 0; margin: 0; padding: var(--space-1); overflow: auto; list-style: none; }
.rc-children { margin: 0; padding-left: 14px; list-style: none; }
.rc-node { display: flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-1); border-radius: var(--radius-xs); cursor: default; }
.rc-node.is-selected { background: var(--selected); color: var(--bright); }
.rc-type { font-weight: 600; }
.rc-template-badge { padding: 0 var(--space-1); border-radius: var(--radius-xs); background: var(--hover); color: var(--muted); font-size: 10px; font-weight: 400; }
.rc-template-actions { display: flex; align-items: center; gap: var(--space-2); }
.rc-caret { width: 14px; flex-shrink: 0; display: inline-flex; align-items: center; border: 0; padding: 0; background: transparent; color: inherit; }
.rc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-empty { margin: 0; padding: var(--space-3); color: var(--muted); font-size: 11px; }
.rc-toolbar { display: flex; align-items: center; gap: 2px; padding: var(--space-1); border-top: 1px solid var(--line); }
.rc-add { position: relative; display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: var(--radius-xs); transition: background-color var(--dur-1) var(--ease); }
.rc-add:hover { background: var(--hover); }
.rc-add-menu { position: absolute; left: 0; bottom: 100%; z-index: 20; display: none; flex-direction: column; min-width: 140px; padding: 2px; border: var(--popup-border); border-radius: var(--popup-radius); background: var(--elevated); color: var(--popup-foreground); box-shadow: var(--popup-shadow); }
.rc-add:hover .rc-add-menu, .rc-add:focus-within .rc-add-menu { display: flex; }
.rc-add-menu button { text-align: left; }
.rc-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: var(--space-3) var(--space-1) 0 15px; overflow: auto; }
.rc-hint { margin: 0; color: var(--muted); font-size: 12px; }
/* 「运行于」那一行 + 右侧的「管理目标…」按钮（上游 RunOnTargetPanel 的 combo + ActionLink 并排）。 */
.rc-target-row { display: flex; align-items: center; gap: var(--space-2); }
.rc-target-row .field-row { flex: 1; min-width: 0; }
.rc-manage-targets { flex-shrink: 0; margin-top: 0; white-space: nowrap; }
/* checkConfiguration() 的实时结论（RunConfiguration.java:156-167 的两档：error / warning）。 */
.rc-problem { margin: var(--space-2) 0 0; padding: var(--space-1) var(--space-2); border-radius: var(--radius-xs); background: var(--error-bg); color: var(--error); font-size: 11px; line-height: 1.6; }
.rc-problem.rc-warn { background: var(--warning-bg); color: var(--warning); }
.rc-warn { margin: 0; color: var(--warning); font-size: 11px; }
.rc-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); }
.rc-tab { padding: var(--space-1) 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--secondary); font-size: 12px; }
.rc-tab[aria-selected='true'] { color: var(--bright); border-bottom-color: var(--accent); }
.rc-tabpanel { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) 0; }
.field-row { display: flex; align-items: center; gap: var(--space-2); }
.field-row > span { flex-shrink: 0; width: 72px; color: var(--muted); font-size: 11px; }
.field-row input, .field-row select, .field-row textarea { flex: 1; min-width: 0; padding: var(--space-1) var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: inherit; font-size: 12px; }
.field-row-block { align-items: flex-start; }
.rc-before { border-top: 1px solid var(--line); padding-top: var(--space-2); }
.rc-before-head { display: flex; align-items: center; gap: var(--space-1); border: 0; padding: 2px 0; background: transparent; color: var(--secondary); font-size: 12px; }
.rc-before-count { color: var(--muted); font-size: 11px; }
.rc-before-body { display: flex; flex-direction: column; gap: var(--space-1); padding-top: var(--space-1); }
.rc-before-body textarea { width: 100%; padding: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--editor); color: var(--bright); font: 12px/1.6 var(--font-mono); }
.rc-footer { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.rc-footer .field-hint { flex: 1; margin: 0; }
.rc-footer-actions { display: flex; gap: var(--space-2); }
@media (max-width: 760px) { .rc-body { grid-template-columns: minmax(0, 1fr); max-height: none; } .rc-tree { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
