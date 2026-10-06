<script setup lang="ts">
// 断点区（标题栏 + 芯片 + 三类额外属性 + 批量动作），从 `DebugPanel.vue` 拆出 ——
// 面板贴着机检上限，而本块的状态与 DAP 调用自成一体。
//
// 上游对应：`XBreakpointManager` 的断点属性（条件/命中次数/日志）、
// `XDebuggerMuteBreakpointsHandler.java:27-37`（静音不删断点：`session.muteBreakpoints(state)`）、
// `RemoveAllBreakpointsAction`（真删）、临时断点（命中一次自删，`XBreakpointBase.java:493-499` 的错误位同理是断点自己的状态）、
// 依赖断点（`XDependentBreakpointManager.java:112` `setMasterBreakpoint` / `:141` `clearMasterBreakpoint`）。
// 纯规则在 `src/debugBreakpointExtras.ts`（可单测）；**下发给 DAP 只有一个口**：`src/dbgBreakpointUpdate.ts`
// （合并同一文件的多次改动 + 全量重发，见其文件头）。本组件只算状态与画界面。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PenLine, Trash2, Volume2, VolumeX, X } from 'lucide-vue-next'
import { dapBreakpoints, dapState } from '../bridge'
import {
  allBreakpointFiles, breakpointMarkersOf, breakpointRef, dependentsToEnable, loadBreakpointExtras, parseBreakpointRef,
  propertiesForRef, saveBreakpointExtras, setBreakpointProperties, shouldAutoUnmute, temporaryHit,
  type BreakpointDependencies, type BreakpointPropertiesState,
} from '../debugBreakpointExtras'
// 断点下发口：属性并入、按依赖/勾选过滤、同文件合并（上游那道 300ms 窗）、全量重发，全在 `src/dbgBreakpointUpdate.ts`。
import {
  breakpointFileSend, breakpointSendPlan, breakpointUpdater, provideBreakpointSendRules, resendAllFromRoot,
  type BreakpointQueueOptions, type BreakpointSendRules, type BreakpointPoint,
} from '../dbgBreakpointUpdate'
// 逐断点的「组 / 谁被停用」共享状态（上游树上的复选框 = setEnabled）：对话框写、这里读。
import {
  assignBreakpointsToGroup, defaultGroupName, groupNameOf, groupNames, isBreakpointEnabled, loadGroupState,
  saveGroupState, setBreakpointsEnabled, setDefaultBreakpointGroup,
} from '../breakpointGroups'
// 断点富编辑（上游 XLightBreakpointPropertiesPanel + BreakpointEditor；规则在 src/debugBreakpointEditor.ts）。
import { breakpointEditModel, breakpointEditPatch, type BreakpointEditModel } from '../debugBreakpointEditor'
// 「查看断点…」对话框的宿主在 App.vue（`breakpointsOpen` / `openBreakpoints` 都在 `src/runConfigurations.ts:194`
// 那份 App 状态里，本组件拿不到；组件树上还隔着 `DebugPanel.vue` → `ToolWindowView.vue`，后者不是本桶名下）
// ⇒ 走本仓既有的宿主登记表写法（同 `src/chooseTargetHost.ts` 那一族）：App.vue 注册一行 opener 即通。
// 接线请求：docs/wiring-requests-2026-10-06-bucket12c.md（X1）。
import { requestBreakpointsDialog } from '../dbgBreakpointsDialogHost'
import DebugBreakpointEditDialog from './DebugBreakpointEditDialog.vue'
import { iconSize } from '../uiIcons'

const props = defineProps<{
  activePath: string
  /** 移除前确认（设置 `debuggerConfirmBreakpointRemoval`）。 */
  confirmRemoval: boolean
  /** 停在断点时自动取消静音（设置 `debuggerUnmuteOnStop`）。 */
  unmuteOnStop: boolean
  /** 项目根：断点的逐断点属性按项目存（见 src/debugBreakpointExtras.ts 的文件头）。 */
  root?: string
}>()

// `logMessage` 是 DAP `setBreakpoints` 的字段，native 早已透传（见 dbg/breakpoints 判词），
// 但 `src/bridge.ts` 的 `DapBreakpoint` 接口本轮冻结、没有这个字段 ⇒ 类型投影在
// `src/dbgBreakpointUpdate.ts`（`BreakpointPoint`），本组件与下发口共用同一份。

const error = ref('')
const newBreak = ref<number | null>(null)
const newBreakTemporary = ref(false)
const muted = ref(false)
// 临时断点与依赖随项目保存（上游逐断点属性：`BreakpointState.myTemporary` / `myDependencyState`，
// BreakpointState.java:20 / :27）。静音是**会话**开关（`XDebuggerMuteBreakpointsHandler.java:28-31`），
// 刻意不落盘。
const storage = typeof localStorage === 'undefined' ? null : localStorage
loadGroupState(storage, props.root ?? '')
const saved = loadBreakpointExtras(storage, props.root ?? '')
const temporary = ref<string[]>(saved.temporary)
const dependencies = ref<BreakpointDependencies>(saved.dependencies)
/** 逐断点属性表（条件/命中次数/日志 + 条件启用位）：随项目走，见 src/debugBreakpointExtras.ts。 */
const properties = ref<Record<string, BreakpointPropertiesState>>(saved.properties ?? {})
const enabledDependents = ref<string[]>([])
watch([temporary, dependencies, properties], () => saveBreakpointExtras(storage, props.root ?? '', {
  temporary: temporary.value,
  dependencies: dependencies.value,
  properties: properties.value,
}), { deep: true })

/** 正在富编辑的那条断点（null = 对话框没开）。 */
const editing = ref<{ ref: string; model: BreakpointEditModel } | null>(null)
/** 全仓断点 ref：依赖选择器与组候选的数据源（上游那两个下拉框读的是同一份断点清单）。 */
const allRefs = computed<string[]>(() => {
  const refs: string[] = []
  for (const [path, points] of dapBreakpoints) {
    for (const point of points) refs.push(breakpointRef(path, point.line))
  }
  return refs
})

const activeBreaks = computed<BreakpointPoint[]>(() => (props.activePath ? dapBreakpoints.get(props.activePath) ?? [] : []))
/**
 * 芯片上那一行的三个字段 + 三个标记。为什么不能直接读断点对象：`dapSetBreakpoints` 把册子
 * **按这轮发出去的那份**重写（`src/bridge.ts:750`），而「条件启用位」关掉时 `sendableBreakpoints`
 * 恰恰会把 `condition` 从发出去的那份里扣掉（`src/debugBreakpointExtras.ts:205-221`）——
 * 于是文本只剩在属性表里。上游的断点显示读的是断点自己的状态（`XBreakpointBase.java:515-547`
 * 那份 tooltip 逐条列条件/日志/依赖），所以这里以**属性表为原文**、册子为当前生效值：
 * 标记位用 `breakpointMarkersOf`（`XBreakpointUIUtil.kt:590-599`：条件是空表达式才不打问号角标），
 * 输入框回填 `表里的 x ?? point.x`。
 */
function fieldOf(ref: string, point: BreakpointPoint, key: 'condition' | 'hitCondition' | 'logMessage'): string {
  return propertiesForRef(properties.value, ref)?.[key] ?? point[key] ?? ''
}
const breakChips = computed(() => activeBreaks.value.map(point => {
  const ref = refOf(props.activePath, point.line)
  return {
    point,
    ref,
    markers: breakpointMarkersOf(point, properties.value, ref),
    temporary: temporary.value.includes(ref),
    condition: fieldOf(ref, point, 'condition'),
    hitCondition: fieldOf(ref, point, 'hitCondition'),
    log: fieldOf(ref, point, 'logMessage'),
    dependency: dependencies.value[ref] ?? '',
  }
}))
const refOf = (path: string, line: number) => breakpointRef(path, line)
/** 这一轮下发要用的前端状态（属性表 / 依赖表 / 已启用的依赖 / 静音）。 */
function sendRules(): BreakpointSendRules {
  return { properties: properties.value, dependencies: dependencies.value, enabledDependents: enabledDependents.value, muted: muted.value }
}
// 登记给下发口：本组件是仓里唯一持有属性表/依赖表/已启用依赖/静音这四位的组件，登记之后
// 别的写点（「查看断点…」对话框、App.vue 的装订线 —— 后者见接线请求 docs/wiring-requests-2026-10-06-dap.md 的 D1）
// 不必自己再拿一份前端状态，发的就是同一份口径 —— 否则「被依赖挡住的那条」会在装订线随手一下之后
// 被重新发给适配器（两套口径分叉）。面板重挂时这里会覆盖成新的那份闭包。
provideBreakpointSendRules(() => sendRules())
// 卸载就撤销登记：留下的会是**已销毁组件**的那份状态，别的写点会照着旧口径发。
onBeforeUnmount(() => { provideBreakpointSendRules(null) })
/**
 * 发一份断点给适配器 —— 只有**一个**出口：`breakpointUpdater.queue`
 * （`src/dbgBreakpointUpdate.ts`，上游 `JavaBreakpointHandler.java:31-44` 的 register/unregister
 *  + `FrontendXLineBreakpointVisualizationManager.kt:291-315` 的合并队列）。
 * 静音时只发空数组、**不碰**册子；依赖未启用的那条先不发，但册子里仍留着，否则取消依赖后找不回来。
 * `options.now` = 上游 `updateBreakpointNow`（`:291-294`）那一档「不等 300ms」：装订线/加/删这类
 * 用户就在那一下点的动作要立刻发；逐字符进来的（条件、命中次数、日志、依赖）与停在断点时的一串规则走合并窗。
 */
async function syncBreakAt(path: string, points: BreakpointPoint[], options: BreakpointQueueOptions = {}) {
  error.value = ''
  const item = breakpointFileSend(path, points, sendRules())
  const round = await breakpointUpdater.queue(item, options)
  if (round.error) { error.value = round.error; return }
  // 这一份载荷被后来的改动合并掉了 ⇒ 那轮的 verifiedLines 不是它的，拿别人的结果判自己会误报。
  if (!round.applied) return
  const result = round.result
  if (!result || result.deferred || !item.send.length) return
  if (result.verifiedLines.length !== item.send.length) error.value = '部分断点未被调试器验证。'
  const note = result.messages?.[0]
  if (note) error.value = `第 ${note.line} 行断点：${note.message}`
}
async function syncBreak(points: BreakpointPoint[], options: BreakpointQueueOptions = {}) {
  if (!props.activePath) return
  await syncBreakAt(props.activePath, points, options)
}
function addBreakpoint() {
  const line = newBreak.value
  if (!props.activePath || !line || line < 1 || activeBreaks.value.some(point => point.line === line)) return
  const ref = refOf(props.activePath, line)
  if (newBreakTemporary.value) temporary.value = [...temporary.value, ref]
  // 新断点落进默认组（上游 `XBreakpointManagerImpl` 给新断点 `state.setGroup(myDefaultGroup)`，
  // 见 src/breakpointGroups.ts 文件头；默认格本身在「查看断点…」里设）。
  const group = defaultGroupName()
  if (group) { assignBreakpointsToGroup([ref], group); saveGroupState(storage, props.root ?? '') }
  void syncBreak([...activeBreaks.value, { line }], { now: true })
  newBreak.value = null
}
/** 移除一个断点（受「移除前确认」设置门控，上游 `isConfirmBreakpointRemoval`）。 */
function removeBreakpoint(line: number) {
  if (props.confirmRemoval && !window.confirm(`移除第 ${line} 行的断点？`)) return
  void syncBreak(activeBreaks.value.filter(point => point.line !== line), { now: true })
}
// IDEA edits breakpoint properties from the gutter popup; the panel is the equivalent here.
// `undefined` 从字段里删掉（DAP 里缺字段 = 没有该属性），空串同样按删除处理。
type BreakpointPatch = { condition?: string; hitCondition?: string; logMessage?: string }
function setBreakpointFields(line: number, patch: BreakpointPatch) {
  const ref = props.activePath ? refOf(props.activePath, line) : ''
  // 芯片上的三个输入也进属性表（否则重启就只剩行号，见 src/debugBreakpointExtras.ts 的注释）。
  if (ref) properties.value = setBreakpointProperties(properties.value, ref, {
    ...properties.value[ref], ...patch,
    conditionEnabled: properties.value[ref]?.conditionEnabled ?? true,
  })
  void syncBreak(activeBreaks.value.map(point => {
    if (point.line !== line) return point
    const next: BreakpointPoint = { ...point }
    for (const [key, value] of Object.entries(patch)) {
      const text = (value ?? '').trim()
      const target = next as unknown as Record<string, unknown>
      if (text) target[key] = text
      else delete target[key]
    }
    return next
  }))
}
/**
 * 打开富编辑对话框：初始状态 = 断点对象上的三个字段 + 存下来的属性 + 本仓侧的
 * 启用/临时/依赖/组四格（上游那份是断点自己的状态，同一套字段）。
 */
function openEditor(point: BreakpointPoint) {
  if (!props.activePath) return
  const ref = refOf(props.activePath, point.line)
  const stored = properties.value[ref]
  const merged: BreakpointPoint = { ...point }
  if (stored?.conditionEnabled === false) merged.condition = stored.condition ?? merged.condition
  const model = breakpointEditModel({
    point: merged,
    enabled: isBreakpointEnabled(ref),
    conditionEnabled: stored?.conditionEnabled !== false,
    temporary: temporary.value.includes(ref),
    dependency: dependencies.value[ref] ?? '',
    group: groupNameOf(ref),
  })
  editing.value = { ref, model }
}
/** 对话框提交：四份状态各写各的，最后统一重发这一份文件。 */
function applyEditor(model: BreakpointEditModel) {
  const target = editing.value
  if (!target || !props.activePath) return
  const ref = target.ref
  const at = parseBreakpointRef(ref)
  if (!at || at.path !== props.activePath) return
  properties.value = setBreakpointProperties(properties.value, ref, {
    condition: model.condition, hitCondition: model.hitCondition, logMessage: model.logMessage,
    conditionEnabled: model.conditionEnabled,
  })
  if (model.temporary && !temporary.value.includes(ref)) temporary.value = [...temporary.value, ref]
  if (!model.temporary) temporary.value = temporary.value.filter(entry => entry !== ref)
  const nextDependencies = { ...dependencies.value }
  if (model.dependency && model.dependency !== ref) nextDependencies[ref] = model.dependency
  else delete nextDependencies[ref]
  dependencies.value = nextDependencies
  setBreakpointsEnabled([ref], model.enabled)
  assignBreakpointsToGroup([ref], model.group)
  saveGroupState(storage, props.root ?? '')
  // 三个字段先清空再并上 `breakpointEditPatch(model)` 给的那份：
  // 用户把条件删空 / 关掉启用位时，点上的旧文本必须真的消失（`{...point, ...patch}` 不会覆盖成「没有」）。
  const patch = breakpointEditPatch(model)
  void syncBreak(activeBreaks.value.map(point => point.line === at.line
    ? { ...point, condition: undefined, hitCondition: undefined, logMessage: undefined, ...patch }
    : point))
}
/**
 * 「更多选项」⇒ 打开「查看断点…」（上游断点编辑框里那条 More 链接，`BreakpointEditor.java:65-77`）。
 * 宿主（App.vue）没注册 opener 时把话写进本区那行错误位，不静默失败；
 * 编辑框里那条链接本身在没宿主时就不渲染（`breakpointsDialogAvailable`，见宿主模块头）。
 */
function openBreakpointsDialog() {
  error.value = requestBreakpointsDialog() ? '' : '「查看断点…」的宿主还没接上（App.vue 未注册 opener）。'
}
/**
 * 「设为默认」：之后新建的断点都落进这一组（上游 `XBreakpointManagerImpl` 的 `myDefaultGroup`，
 * 新断点 `state.setGroup(...)` 那条）。默认组本身也要落盘，否则重开项目就丢。
 */
function pickDefaultGroup(name: string | null) {
  setDefaultBreakpointGroup(name)
  saveGroupState(storage, props.root ?? '')
}
/** 依赖表达式：`文件:行` 或裸行号（裸行号 = 当前文件）。空串 = 解除依赖。 */
function parseDependency(text: string, currentPath: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >= 1 ? breakpointRef(currentPath, Number(trimmed)) : null
  const at = parseBreakpointRef(trimmed)
  return at ? breakpointRef(at.path, at.line) : null
}
function setDependency(line: number, text: string) {
  if (!props.activePath) return
  const dependent = refOf(props.activePath, line)
  const trigger = parseDependency(text, props.activePath)
  const next = { ...dependencies.value }
  if (trigger && trigger !== dependent) next[dependent] = trigger
  else delete next[dependent]
  dependencies.value = next
  void syncBreak(activeBreaks.value)
}
/** 「移除所有断点」（上游 `RemoveAllBreakpointsAction`）：逐文件发空断点。
 *  清单来自 `allBreakpointFiles`（规则层），不再是这里手抄一遍 `keys().filter(Boolean)`。 */
async function removeAllBreakpoints() {
  const paths = allBreakpointFiles(dapBreakpoints)
  if (!paths.length) return
  if (props.confirmRemoval && !window.confirm(`移除全部 ${paths.length} 个文件的断点？`)) return
  error.value = ''
  const rounds = await Promise.all(paths.map(path => breakpointUpdater.queue(breakpointFileSend(path, [], { ...sendRules(), muted: false }), { now: true })))
  const failed = rounds.map(round => round.error).filter(Boolean)
  if (failed.length) error.value = failed[0] ?? ''
  temporary.value = []; enabledDependents.value = []
}
/** 断点静音/取消静音（上游 `XDebuggerMuteBreakpointsHandler.java:27-37` → `session.muteBreakpoints(state)`）：
 *  静音给每个有断点的文件发空数组、册子不动；取消静音按**全量**重发（依赖/勾选仍生效）。 */
async function toggleMute() {
  const next = !muted.value
  muted.value = next
  const plan = breakpointSendPlan(dapBreakpoints, { ...sendRules(), muted: next })
  const rounds = await Promise.all(plan.map(item => breakpointUpdater.queue(item, { now: true })))
  const failed = rounds.map(round => round.error).filter(Boolean)
  if (failed.length) error.value = failed[0] ?? ''
}
/**
 * 会话起来后的**全量重发**（`FrontendXLineBreakpointVisualizationManager.kt:306-315`
 * `queueAllBreakpointsUpdate` 的等价物：`for (breakpoint in manager.getAllBreakpoints())` 逐个重算）。
 * 为什么必须有：native 只记得「上一次收到的那份清单」（`native/dap.hpp:185`），而静音、断点树上取消勾选、
 * 依赖挡住这三条位只存在于本仓前端 —— 不重发就会出现「界面说静音了、适配器却还带着全部断点」。
 * 由宿主 `DebugPanel.vue` 在 `dapState.running` 变 true、把适配器记得的清单读回来之后调用。
 */
async function resendRemembered() {
  const errors = await resendAllFromRoot(dapBreakpoints, sendRules())
  error.value = errors[0] ?? ''
  return errors
}
/** 停在断点处时的三条规则：临时断点自删、依赖断点启用、可选自动取消静音。
 *  由宿主（DebugPanel）在每次 refreshStack 落定当前执行点后调用（defineExpose）。 */
async function applyStopRules() {
  const location = dapState.currentLocation
  if (!location) return
  const hit = refOf(location.path, location.line)
  const temp = temporaryHit(temporary.value, location)
  if (temp) {
    temporary.value = temporary.value.filter(entry => entry !== temp)
    const points = (dapBreakpoints.get(location.path) ?? []).filter(point => point.line !== location.line)
    await syncBreakAt(location.path, points)
  }
  const enable = dependentsToEnable(dependencies.value, hit)
  if (enable.length) {
    enabledDependents.value = [...new Set([...enabledDependents.value, ...enable])]
    for (const dependent of enable) {
      const at = parseBreakpointRef(dependent)
      if (at) await syncBreakAt(at.path, dapBreakpoints.get(at.path) ?? [])
    }
  }
  if (shouldAutoUnmute(muted.value, true, props.unmuteOnStop)) await toggleMute()
}
defineExpose({ applyStopRules, resendRemembered })
</script>

<template>
  <!-- 标题栏 / 错误行 / 芯片区三块外面套一层：宿主 `DebugPanel.vue` 用
       `ref="breakpointsPane"` 调本组件的 `applyStopRules`，而本仓门禁要求
       **被 ref 用到的组件必须是单根**（多根时 ref 拿到的是 fragment 锚点，
       见 tests/sfc-single-root.test.mjs）。 -->
  <div class="debug-breakpoints-pane">
    <div class="debug-section-title">
      断点 · {{ activePath ? activePath.split('/').pop() : '（无当前文件）' }}
      <!-- 上游 `MuteBreakpointsAction` / `RemoveAllBreakpointsAction`：静音不删断点、全清是真删。 -->
      <button class="chip-x debug-break-action" :class="{ active: muted }" :title="muted ? '取消断点静音' : '静音所有断点（不断点，只是让调试器忽略）'" :aria-label="muted ? '取消断点静音' : '静音所有断点'" @click="toggleMute">
        <Volume2 v-if="muted" :size="iconSize.chip" /><VolumeX v-else :size="iconSize.chip" />
      </button>
      <button class="chip-x debug-break-action" :disabled="!dapBreakpoints.size" title="移除所有断点" aria-label="移除所有断点" @click="removeAllBreakpoints"><Trash2 :size="iconSize.chip" /></button>
      <span v-if="muted" class="debug-break-muted">已静音</span>
    </div>
    <p v-if="error" class="debug-error">{{ error }}</p>
    <div class="debug-breaks">
      <label class="debug-field"><span>行</span><input v-model.number="newBreak" type="number" min="1" class="debug-input debug-input-narrow" aria-label="断点行号（1 起）" @keydown.enter.prevent="addBreakpoint" /></label>
      <button class="debug-btn" :disabled="!activePath || !newBreak" @click="addBreakpoint">添加</button>
      <!-- 临时断点（`ToggleTemporaryLineBreakpointAction`）：命中一次自动删。 -->
      <label class="debug-exception" title="临时断点：命中一次后自动移除"><input v-model="newBreakTemporary" type="checkbox" />临时</label>
      <span v-if="!activeBreaks.length" class="debug-empty-inline">无</span>
      <span v-for="chip in breakChips" :key="chip.point.line" class="debug-break-chip" :class="{ unverified: chip.point.verified === false, muted, temporary: chip.temporary }"
            :title="chip.point.verified === false ? `第 ${chip.point.line} 行：调试器未验证（可能被移到别的行）` : undefined">
        {{ chip.point.line }}<span v-if="chip.markers.condition" class="debug-break-cond" :title="`条件：${chip.condition}`">?</span><span v-if="chip.markers.hit" class="debug-break-cond" :title="`命中次数：${chip.hitCondition}`">#</span><span v-if="chip.markers.log" class="debug-break-cond" :title="`日志：${chip.log}`">L</span>
        <button class="chip-x" title="移除此断点" :aria-label="`移除断点 ${chip.point.line}`" @click="removeBreakpoint(chip.point.line)"><X :size="iconSize.chip" /></button>
        <input class="debug-break-condition" type="text" :value="chip.condition" :aria-label="`第 ${chip.point.line} 行断点条件`" placeholder="条件" spellcheck="false" @keydown.enter.prevent="setBreakpointFields(chip.point.line, { condition: ($event.target as HTMLInputElement).value })" @change="setBreakpointFields(chip.point.line, { condition: ($event.target as HTMLInputElement).value })" />
        <input class="debug-break-condition" type="text" :value="chip.hitCondition" :aria-label="`第 ${chip.point.line} 行断点命中次数`" placeholder="命中次数" spellcheck="false" @keydown.enter.prevent="setBreakpointFields(chip.point.line, { hitCondition: ($event.target as HTMLInputElement).value })" @change="setBreakpointFields(chip.point.line, { hitCondition: ($event.target as HTMLInputElement).value })" />
        <input class="debug-break-condition" type="text" :value="chip.log" :aria-label="`第 ${chip.point.line} 行断点日志`" placeholder="日志消息" spellcheck="false" @keydown.enter.prevent="setBreakpointFields(chip.point.line, { logMessage: ($event.target as HTMLInputElement).value })" @change="setBreakpointFields(chip.point.line, { logMessage: ($event.target as HTMLInputElement).value })" />
        <input class="debug-break-condition" type="text" :value="chip.dependency" :aria-label="`第 ${chip.point.line} 行断点依赖`" placeholder="依赖（文件:行）" spellcheck="false" @keydown.enter.prevent="setDependency(chip.point.line, ($event.target as HTMLInputElement).value)" @change="setDependency(chip.point.line, ($event.target as HTMLInputElement).value)" />
        <!-- 富编辑（上游点断线出来的那一页：XLightBreakpointPropertiesPanel + BreakpointEditor）。 -->
        <button class="chip-x" title="编辑这条断点（条件 / 命中次数 / 日志 / 临时 / 依赖 / 组）" :aria-label="`编辑第 ${chip.point.line} 行断点`" @click="openEditor(chip.point)"><PenLine :size="iconSize.chip" /></button>
      </span>
    </div>
    <DebugBreakpointEditDialog v-if="editing" :breakpoint-ref="editing.ref" :initial="editing.model"
                               :groups="groupNames(allRefs)" :dependency-choices="allRefs" :default-group="defaultGroupName()"
                               @apply="applyEditor" @close="editing = null" @more="openBreakpointsDialog"
                               @set-default-group="pickDefaultGroup" />
  </div>
</template>

<style scoped>
.debug-section-title { margin: var(--space-3) var(--space-3) var(--space-1); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
.debug-error { margin: 0; padding: var(--space-1) var(--space-3); color: var(--error); font-size: 11px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.debug-breaks { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: 0 var(--space-3); }
.debug-field { display: flex; align-items: center; gap: var(--space-1); min-width: 0; font-size: 11px; color: var(--muted); }
.debug-field > span { flex-shrink: 0; width: 48px; }
.debug-input { flex: 1; min-width: 0; min-height: var(--ctrl-height-sm); padding: 2px var(--space-1); color: var(--text); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); font: 11px/1.4 var(--font-mono); }
.debug-input-narrow { flex: 0 0 60px; }
.debug-btn { display: inline-flex; align-items: center; gap: var(--space-1); padding: 3px var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--elevated); color: var(--text); font-size: 11px; }
.debug-btn:disabled { color: var(--muted); opacity: .5; }
.debug-exception { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text); }
.debug-empty-inline { color: var(--muted); font-size: 11px; }
.debug-break-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px var(--space-1) 1px var(--space-2); border-radius: var(--radius-pill); background: var(--elevated); border: 1px solid var(--line-strong); font: 11px var(--font-mono); }
.debug-break-chip.unverified { border-style: dashed; color: var(--muted); }
.debug-break-chip.muted { opacity: .6; border-style: dotted; }
.debug-break-chip.temporary { border-style: dashed; }
.debug-break-cond { color: var(--accent); }
.chip-x { display: inline-flex; border: 0; background: transparent; color: var(--muted); padding: 1px; border-radius: var(--radius-xs); }
.chip-x:hover { color: var(--error); background: var(--hover); }
.debug-break-action { min-height: 16px; }
.debug-break-action.active { color: var(--accent); }
.debug-break-action:disabled { color: var(--muted); opacity: .5; }
.debug-break-muted { margin-left: var(--space-1); color: var(--warning); font-size: 10px; text-transform: none; letter-spacing: 0; }
.debug-break-condition { width: 64px; padding: 0 2px; color: var(--text); background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); font: 10px var(--font-mono); }
</style>
