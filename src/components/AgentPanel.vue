<script setup lang="ts">
// Agent 对话工具窗口（右侧边栏）：消息流 + 计划 + 审批 + 待决改动 + 输入区工具条。
// 本组件只做接线与渲染：状态机在 `src/agentSession.ts`、台账在 `src/agentEdits.ts`、
// 装配在 `src/agentHost.ts`、设置形状在 `src/agentSettings.ts`。
// 工具条分区与顺序取自 `src/agentComposerLayout.ts` 的 TOOLBAR_ROWS（出处逐条在该模块）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import darkEmptyStateLogoUrl from '../assets/zcode-empty-state.svg'
import {
  ArrowUp, Brain, CheckCheck, ChevronDown, FileCode2, History, Loader2,
  Package, Plus, Settings2, Square, Trash2, Undo2,
} from 'lucide-vue-next'
// 勾选记号走 IDEA 的 `AllIcons.Actions.Checked` 副本（`expui/actions/checked.svg`）——
// 全仓菜单/按钮槽位不许再从 lucide 取 `Check`（`tests/menu-check-icon.test.mjs` 门禁）；
// 对话头像与工具窗口条同形：上游 `AllIcons.ToolWindowAskAI`（`AllIcons.java:1494`）。
import { IdeaCheckedIcon } from './icons/toolWindowIcons.ts'
import { iconSize } from '../uiIcons'
import { closeAgentPopsOnOutsidePointer, createAgentPopState } from '../agentPanelPops.ts'
import { isAgentComposerShortcutTarget, resolveAgentComposerShortcut } from '../agentComposerShortcuts.ts'
import AgentSessionPop from './AgentSessionPop.vue'
import AgentModelSelectPop from './AgentModelSelectPop.vue'
import AgentThoughtLevelSelect from './AgentThoughtLevelSelect.vue'
import AgentMessageContent from './AgentMessageContent.vue'
import { installAgentComposerToolbarFit } from '../agentComposerToolbarFit.ts'
import { describeEditFailure, type AgentHost, type AgentToolResult } from '../agentHost'
import type { AgentChatMessage, AgentApprovalRequest } from '../agentSession'
import { parseAgentMessage, type AgentMessageSegment } from '../agentMessages'
import type { AgentEditSummary } from '../agentEdits'
import { AGENT_SESSION_LIMIT, createAgentSessionStore, setSessionModelSelection, type AgentSessionModelSelection } from '../agentSessions'
// 正文草稿的持久化在 `src/agentComposerDrafts.ts`（独立键空间，scope = 会话 id / `__draft__`；
// 与上游 `composerDraftStore.ts` 同口径）。模型选择那一格仍归会话库（`agentSessions.ts`）。
import { AGENT_DRAFT_SCOPE_ROOT, createAgentComposerDraftStore } from '../agentComposerDrafts.ts'
import { AGENT_COMMANDS, matchAgentCommands, parseAgentCommand } from '../agentCommands'
import { effectiveKeysOf, onOverridesChanged } from '../keymapEditor.ts'
// 斜杠/@ 面板的**交互规则**在 `src/agentPromptMenu.ts`、**面板侧状态**在 `src/agentPanelPromptMenu.ts`；
// 本面板留「有哪些命令、能不能用、怎么派发」，并把面板出口接到模板上。
import { ACTION_MENU_FOOTER_TRIGGERS, MENU_PANEL_METRICS, actionMenuSelectTarget, type PromptMenuSuggestion } from '../agentPromptMenu.ts'
import { createAgentPanelPromptMenu } from '../agentPanelPromptMenu.ts'
import { COMPOSER_ELEMENTS, COMPOSER_EMPTY_STATES, COMPOSER_INPUT, COMPOSER_TEXTS, TOOLBAR_ROWS } from '../agentComposerLayout.ts'
import { createAgentComposerGreeting } from '../agentComposerGreeting.ts'
import {
  MANAGE_MODELS_LABEL, MODEL_TRIGGER_FALLBACK_LABEL,
  buildAgentModelSelectGroups, decodeCustomModelValue, resolveModelSelectTriggerDisplay,
  type ModelSelectGroup,
} from '../agentModelSelection.ts'
import { ZCODE_AGENT_PROVIDER, getThoughtLevelLabelText } from '../agentComposerControls.ts'
import {
  AGENT_PERMISSION_TEXTS, buildAgentPermissionRows, canConfirmAgentPermissionSelection,
  createAgentPermissionDecision, createAgentPermissionFeedbackDecision, describeAgentSaveWorkflowPrompt,
  describeAgentToolPermissionShape, getAgentPermissionFeedbackCopy, readAgentSaveWorkflowInput,
  resolveAgentPermissionBlockKind, type AgentPermissionRequest,
} from '../agentPermissionPrompt.ts'

const props = defineProps<{
  /** 装配层。未接上（浏览器预览、没打开项目）时为 null —— 面板显示不可用态，不放假控件。 */
  host: AgentHost | null
  /** 当前项目名（自动读取，没有选择器）。 */
  projectName: string
  /** 当前工作区根。 */
  projectRoot: string
}>()
const emit = defineEmits<{ openSettings: [section?: 'modelProvider']; notify: [message: string, error?: boolean] }>()

// 装配层是普通对象（不是响应式），每次调用后 +1 让模板重算。
const revision = ref(0)
const draft = ref('')
const streamingReply = ref('')
const streamingSegments = computed<AgentMessageSegment[]>(() => streamingReply.value ? parseAgentMessage(streamingReply.value) : [])
const busy = ref(false)
const lastResults = ref<AgentToolResult[]>([])
const scrollBox = ref<HTMLDivElement>()
const toolbarRoot = ref<HTMLDivElement>()
const composerInput = ref<HTMLTextAreaElement>()
const ready = computed(() => props.host !== null)
const messages = computed<AgentChatMessage[]>(() => { revision.value; return props.host?.session().messages() ?? [] })
const plan = computed(() => { revision.value; return props.host?.session().plan() ?? [] })
// ZCode `messageStreamShowTodos`（`settingsPageHelpers.tsx` 的 GeneralSectionContent）。
const showTodos = computed(() => props.host?.settings().general.messageStreamShowTodos !== false)
const approvals = computed(() => { revision.value; return props.host?.session().approvals() ?? [] })
const edits = computed<AgentEditSummary[]>(() => { revision.value; return props.host?.allEdits() ?? [] })
const pendingEdits = computed(() => edits.value.filter(edit => edit.state === 'pending'))
const statusLine = computed(() => { revision.value; return props.host?.statusLine() ?? '' })
function bump() { revision.value += 1 }
function segmentsOf(message: AgentChatMessage): AgentMessageSegment[] {
  revision.value
  return props.host?.segments(message) ?? [{ kind: 'text', text: message.text }]
}
function rowsOf(id: number) { revision.value; return props.host?.ledger().rows(id) ?? [] }
function toggleStep(index: number) { props.host?.session().toggleStep(index); bump() }
async function scrollToEnd() {
  await nextTick()
  const box = scrollBox.value
  if (box) box.scrollTop = box.scrollHeight
}
let streamingScrollFrame: number | null = null
function scheduleStreamingScroll() {
  if (streamingScrollFrame !== null) return
  streamingScrollFrame = window.requestAnimationFrame(() => {
    streamingScrollFrame = null
    void scrollToEnd()
  })
}
watch(() => messages.value.length, () => { void scrollToEnd() })

// ── 输入区文案（`COMPOSER_TEXTS` 的键→zh 逐条核过）──────────────────────────────────
const composerTextTable = new Map(COMPOSER_TEXTS.map(entry => [entry.key, entry.zh]))
function composerText(key: string): string | undefined { return composerTextTable.get(key) }
const composerPlaceholder = computed(() => {
  const key = !messages.value.length
    ? 'chat.placeholder.newTask'
    : busy.value ? 'chat.placeholder.followUpQueue' : 'chat.placeholder.followUpAsk'
  return composerText(key) ?? ''
})
// `LexicalChatInput.tsx:1456-1458`：composer 输入区 40px 起步、最高 160px。
function resizeComposerInput() {
  const input = composerInput.value
  if (!input) return
  input.style.height = 'auto'
  const naturalHeight = input.scrollHeight
  input.style.height = `${Math.max(40, Math.min(160, naturalHeight))}px`
  input.style.overflowY = naturalHeight > 160 ? 'auto' : 'hidden'
}
watch(draft, async () => {
  // 每改一次正文就写进当前 scope（上游 `updateComposerContent` 每次都 `persistV4ComposerDraft`）。
  // scope 在回调里现取：切会话是同步改 activeId 的，`flush: 'post'` 时读到的已是新 scope。
  drafts.write(draftScopeId(), draft.value)
  await nextTick()
  resizeComposerInput()
}, { flush: 'post' })
/** COMPOSER_ELEMENTS 的 labelKey → 文案（工具条按钮 title/aria-label 的单一来源）。 */
const toolbarText = new Map(COMPOSER_ELEMENTS.map(element => [element.id, element.labelKey ? (composerText(element.labelKey) ?? '') : '']))
const draftGreetingState = COMPOSER_EMPTY_STATES.find(state => state.id === 'draftGreeting')
// 问候语（时段文案 + 贴合字号）整块在 `src/agentComposerGreeting.ts`：面板只搬四个绑定，
// 并在挂载/卸载时各调一次 start/stop（原来是这里的 ref + 定时器 + ResizeObserver）。
const greeting = createAgentComposerGreeting({ projectRoot: () => props.projectRoot, copy: composerText })
const { text: greetingText, fontSize: greetingFontSize, container: greetingContainer, measurement: greetingMeasurement } = greeting
let composerInputObserver: ResizeObserver | undefined
let composerInputWidth = 0

// ── 工具条 · 模型选择（`src/agentModelSelection.ts`；顺序见 V4ComposerToolbar.tsx:1023-1073）──
// 仅显示设置页维护且已启用的供应商模型。
const modelGroups = computed<ModelSelectGroup[]>(() => {
  revision.value
  return buildAgentModelSelectGroups(props.host?.settings().providers ?? [])
})
// Composer 选模是下次提交的草稿（会话库的最小选择对象：模型值 + 可选推理档位）；不提前改写 Agent 全局设置。
const draftSelection = ref<AgentSessionModelSelection | null>(null)
const currentModelValue = computed(() => {
  revision.value
  return props.host?.settings().model ?? ''
})
const selectedModelValue = computed(() => draftSelection.value?.model ?? currentModelValue.value)
const modelTrigger = computed(() => resolveModelSelectTriggerDisplay(selectedModelValue.value, modelGroups.value, true, MANAGE_MODELS_LABEL))
const modelTriggerLabel = computed(() => {
  const selectedValue = modelTrigger.value.value
  if (selectedValue) {
    for (const group of modelGroups.value) {
      const selected = group.items.find(item => item.value === selectedValue)
      if (selected) return `${group.label}/${selected.name}`
    }
  }
  return modelTrigger.value.placeholder ?? MODEL_TRIGGER_FALLBACK_LABEL
})
const modelTriggerParts = computed(() => {
  const selectedValue = modelTrigger.value.value
  if (selectedValue) {
    for (const group of modelGroups.value) {
      const selected = group.items.find(item => item.value === selectedValue)
      if (selected) return { provider: group.label, model: selected.name }
    }
  }
  return { provider: '', model: modelTriggerLabel.value }
})
const modelShortcutLabel = computed(() => {
  revision.value
  return effectiveKeysOf('openModelMenu').replace(/(Ctrl|Alt|Shift|Cmd)(?=[A-Z0-9])/gu, '$1+')
})
const modelTriggerTitle = computed(() => modelShortcutLabel.value
  ? `${modelTriggerLabel.value} · ${modelShortcutLabel.value}`
  : modelTriggerLabel.value)
/** 一份新的会话选择：同时写面板状态与库里那一场（或草稿）；换模型清档位的规则收在 `setSessionModelSelection` 里。 */
function applyModelSelection(next: AgentSessionModelSelection | null) {
  draftSelection.value = next
  const sessionId = sessions.activeId()
  if (sessionId) sessions.saveModelSelection(sessionId, next)
  else sessions.saveDraftModelSelection(next)
}
function selectModel(value: string) {
  const host = props.host
  if (!host || busy.value || !modelGroups.value.some(group => group.items.some(item => item.value === value))) return
  applyModelSelection(setSessionModelSelection(draftSelection.value, { model: value }))
  closePops()
}

// ── 工具条 · 推理档位（`ThoughtLevelCycleControl.tsx`；挂载与可见性见 V4ComposerToolbar.tsx:1074-1090）──
// 档位只属于自己声明了推理配置的模型：档位表 + 映射都读设置里那条模型记录。没有映射就没有请求字段
// 落点（`agentHost.ts` 的 resolveReasoningLevelPatch 会原样保留请求体），画了也是假控件。
const thoughtLevels = computed<readonly string[]>(() => {
  revision.value
  const decoded = decodeCustomModelValue(selectedModelValue.value)
  const model = decoded?.modelName ? props.host?.settings().providers.find(item => item.id === decoded.providerId)?.models.find(item => item.id === decoded.modelName) : undefined
  return model?.reasoningLevels?.length && model.reasoningLevelMap?.trim() ? model.reasoningLevels : []
})
const thoughtLevelOptions = computed(() => thoughtLevels.value.map(value => ({ value, label: thoughtLevelText(value) })))
/** 档位值 → 文案：别名表在 `src/agentComposerControls.ts`（逐字照 `thoughtLevelOptions.ts:18-40`），表外值原样显示（`:88` 的回退）。 */
function thoughtLevelText(level: string): string { return getThoughtLevelLabelText(level, level) }
// 当前档位只认「选过且仍在模型档位表里」；没选或已失效给空串 → 触发器显示占位文案，不补隐式默认
// （`draftWorkspaceDefaults.ts:36-48` 的 resolveDraftThoughtCurrentValue 同样只认选择结果）。
const thoughtLevelValue = computed(() => { const level = draftSelection.value?.options?.reasoningLevel?.trim() ?? ''; return thoughtLevels.value.includes(level) ? level : '' })
// 档位弹层的开关住在面板里（`AgentPop` 联合没有 'thought'，而 `agentPanelPops.ts` 不在本次改动范围）；
// 同屏一个弹层这条靠 closePops/togglePop 两个出口统一收口（见下文）。
const thoughtOpen = ref(false)
function updateThoughtPop(open: boolean) {
  if (!open) { thoughtOpen.value = false; return }
  closePops()
  thoughtOpen.value = true
}
/** 选中的档位与模型一起进会话选择对象 —— 档位随它所属的那个模型走。 */
function selectThoughtLevel(level: string) {
  if (busy.value || !thoughtLevels.value.includes(level)) return
  applyModelSelection(setSessionModelSelection(draftSelection.value, { model: selectedModelValue.value, reasoningLevel: level }))
  closePops()
}
watch(() => props.host, (host, _previous, onCleanup) => {
  if (host) onCleanup(host.onSettingsChange(() => { revision.value += 1 }))
}, { immediate: true })

// ── 工具条快捷键（`toolbarShortcuts.ts:27-40,115-133`）─────────────────────────────
// 点面板外关弹层（上游 DropdownMenu 的 onPointerDownOutside）。
onMounted(() => {
  greeting.start()
  resizeComposerInput()
  if (composerInput.value && typeof ResizeObserver !== 'undefined') {
    composerInputObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0
      if (Math.abs(width - composerInputWidth) < 0.5) return
      composerInputWidth = width
      resizeComposerInput()
    })
    composerInputObserver.observe(composerInput.value)
  }
  if (toolbarRoot.value) detachToolbarFit = installAgentComposerToolbarFit(toolbarRoot.value)
  detachOutside = closeAgentPopsOnOutsidePointer('.agent, .agent-model-submenu, .agent-thought-listbox', () => closePops())
  detachKeymapOverrides = onOverridesChanged(() => { revision.value += 1 })
  window.addEventListener('keydown', onPanelKeydown, true)
})
onBeforeUnmount(() => {
  greeting.stop()
  composerInputObserver?.disconnect()
  detachToolbarFit?.()
  detachOutside?.()
  detachKeymapOverrides?.()
  window.removeEventListener('keydown', onPanelKeydown, true)
})
let detachOutside: (() => void) | undefined
let detachKeymapOverrides: (() => void) | undefined
let detachToolbarFit: (() => void) | undefined

function onPanelKeydown(event: KeyboardEvent) {
  if (!isAgentComposerShortcutTarget(event.target) || event.defaultPrevented || event.repeat || event.isComposing) return
  // Esc 关弹层（不要求修饰键）——上游 DropdownMenu 的 Escape 语义。
  if (event.key === 'Escape' && (openPop.value || thoughtOpen.value)) { event.preventDefault(); closePops(); return }
  if (busy.value) return
  const action = resolveAgentComposerShortcut(event)
  if (action !== 'openModelMenu') return
  event.preventDefault()
  if (openPop.value !== 'model') togglePop('model')
}

watch(busy, value => { if (value && (openPop.value === 'model' || thoughtOpen.value)) closePops() })

// ── 审批行（`src/agentPermissionPrompt.ts`；「怎么问」那一半）────────────────────────
function toolLabel(tool: string): string {
  if (tool === 'read_file') return '读取文件'
  if (tool === 'write_file') return '写入文件'
  if (tool === 'run_command') return '执行命令'
  return '网络请求'
}
/** 把一条卡在门上的调用整形为 PermissionDialog 的请求形状（选项集照 `agent.ts` 的档位）。 */
function approvalRequest(entry: AgentApprovalRequest): AgentPermissionRequest {
  const shape = describeAgentToolPermissionShape(entry.call.tool)
  return {
    requestId: `call-${entry.call.id}`, kind: toolLabel(entry.call.tool), title: toolLabel(entry.call.tool),
    description: JSON.stringify(entry.call.params), freeText: shape.scope === 'command',
    options: [
      { optionId: 'allowOnce', kind: 'allowOnce', name: 'Allow' },
      { optionId: 'allowAlways', kind: 'allowAlways', name: shape.scope === 'generic' ? 'Always allow' : 'Always allow in this project' },
      { optionId: 'deny', kind: 'deny', name: 'Deny' },
    ],
    raw: entry.call.params,
  }
}
const approvalSelection = ref(0)
const approvalFeedback = ref('')
const approvalBusy = ref(false)
watch(() => approvals.value.length, () => { approvalSelection.value = 0; approvalFeedback.value = '' })
function approvalRows(entry: AgentApprovalRequest) { return buildAgentPermissionRows(approvalRequest(entry), ZCODE_AGENT_PROVIDER) }
function approvalFeedbackCopy(entry: AgentApprovalRequest) { return getAgentPermissionFeedbackCopy(approvalRequest(entry)) }
function isFeedbackSelected(entry: AgentApprovalRequest): boolean {
  return approvalRows(entry)[approvalSelection.value]?.kind === 'feedback'
}
/** saveWorkflow 的覆盖/新建是两句不同问句（`SaveWorkflowPermissionBlock.tsx:131-135`）。 */
function approvalBlockTitle(entry: AgentApprovalRequest): string {
  const request = approvalRequest(entry)
  if (resolveAgentPermissionBlockKind(request) === 'saveWorkflow') {
    return describeAgentSaveWorkflowPrompt(readAgentSaveWorkflowInput(entry.call.params)).title
  }
  return toolLabel(entry.call.tool)
}
async function confirmApproval(entry: AgentApprovalRequest) {
  const host = props.host
  if (!host || approvalBusy.value) return
  const request = approvalRequest(entry)
  if (!canConfirmAgentPermissionSelection(request, approvalSelection.value, approvalFeedback.value, approvalBusy.value)) return
  const row = approvalRows(entry)[approvalSelection.value]
  approvalBusy.value = true
  try {
    if (row?.kind === 'feedback') {
      const decision = createAgentPermissionFeedbackDecision(request, approvalFeedback.value)
      if (decision && await host.reject(entry.call.id)) { persistSession(); emit('notify', `${AGENT_PERMISSION_TEXTS.deny}：${decision.feedback}`) }
    } else if (row?.option) {
      const decision = createAgentPermissionDecision(request, row.option, approvalFeedback.value)
      if (row.displayKind === 'rejectOnce' || row.displayKind === 'rejectAlways') {
        if (await host.reject(entry.call.id)) {
          persistSession()
          emit('notify', decision.feedback ? `${AGENT_PERMISSION_TEXTS.deny}：${decision.feedback}` : AGENT_PERMISSION_TEXTS.deny)
        }
      } else {
        const result = await host.approve(entry.call.id)
        if (result) { persistSession(); lastResults.value = [result, ...lastResults.value]; if (!result.ok) emit('notify', result.detail, true) }
      }
    }
  } finally {
    approvalBusy.value = false
    approvalFeedback.value = ''
    bump()
  }
}

// ── 发送 / 停止（stop 与 send 同槽互斥，`ConversationComposer.tsx:2064-2098`）─────────
const showStopControl = computed(() => busy.value)
const canSend = computed(() => !busy.value && draft.value.trim().length > 0)
let sendToken = 0
async function send() {
  const host = props.host
  if (!host || busy.value) return
  const text = draft.value.trim()
  if (!text) return
  const token = ++sendToken
  // 发出去的是**这个** scope 的草稿：中途换过会话就不许清当前输入框（上游 `updateComposerDraft`
  // 的 scope 守卫），但那一场的草稿还是要清掉 —— 只清已发送会话这一条。
  const sentScope = draftScopeId()
  busy.value = true; streamingReply.value = ''
  try {
    if (runCommand(text)) { clearSentDraft(sentScope); resetPromptMenu(); return }
    const { results } = await host.send(text, delta => {
      if (token !== sendToken) return
      streamingReply.value += delta
      bump()
      scheduleStreamingScroll()
    }, draftSelection.value ?? undefined)
    if (token !== sendToken) return
    streamingReply.value = ''
    lastResults.value = results
    clearSentDraft(sentScope)
    persistSession()
    bump()
    for (const result of results) { if (!result.ok) emit('notify', result.detail, true) }
  } catch (error) {
    if (token === sendToken) {
      streamingReply.value = ''
      emit('notify', error instanceof Error ? error.message : String(error), true)
    }
  } finally {
    if (token === sendToken) { busy.value = false; void scrollToEnd() }
  }
}
function stopGeneration() { props.host?.cancel(); sendToken += 1; streamingReply.value = ''; busy.value = false; bump() }
/** 发完只清这一个 scope 的正文（上游 `updateComposerContent({ text: "" })`）；换过会话就不动输入框。 */
function clearSentDraft(scopeId: string) {
  drafts.write(scopeId, '')
  if (scopeId === draftScopeId()) draft.value = ''
}
async function doAll() {
  const host = props.host
  if (!host) return
  const { applied, failed } = await host.doAllEdits()
  bump()
  if (failed.length) emit('notify', `已保留 ${applied} 处，${failed.length} 处写入失败。`, true)
  else emit('notify', `已保留全部 ${applied} 处修改。`)
}
/** Do / Undo 的共同出口：把结果如实说出去（尤其撤回被拒时的原因）。 */
async function decide(action: 'do' | 'undo', id: number) {
  const host = props.host
  if (!host) return
  const outcome = action === 'do' ? await host.doEdit(id) : await host.undoEdit(id)
  bump()
  if (outcome.ok) { emit('notify', action === 'do' ? '已保留这处修改。' : '已撤回这处修改。'); return }
  emit('notify', describeEditFailure(outcome), true)
}
function openFile(path: string, line: number | null) { props.host?.revealFile(path, line) }
function revealEdit(id: number) { if (props.host?.revealEdit(id)) bump() }
const stateLabel: Record<AgentEditSummary['state'], string> = { pending: '待决', applied: '已保留', reverted: '已撤回' }
// ── 会话库（`src/agentSessions.ts`）────────────────────────────────────────────────
let sessions = createAgentSessionStore(undefined, undefined, props.projectRoot)
let drafts = createAgentComposerDraftStore(undefined, props.projectRoot)
if (!sessions.activeId()) draftSelection.value = sessions.draftSessionModelSelection()
/** 当前正文草稿的 scope：绑了会话用会话 id，没绑用 `__draft__`（上游 `composerDraftStore.ts` 的 scope 口径）。 */
function draftScopeId(): string { return sessions.activeId() ?? AGENT_DRAFT_SCOPE_ROOT }
/** 把某个 scope 的正文装回输入框（切会话/换工作区时；程序化改正文要顺手收掉斜杠/@ 面板）。 */
function restoreDraftText(scopeId: string) { draft.value = drafts.read(scopeId); resetPromptMenu() }
draft.value = drafts.read(draftScopeId())
function sessionSummaries() { revision.value; return sessions.summaries() }
const activeSessionId = computed(() => { revision.value; return sessions.activeId() })
const activeSessionName = computed(() => sessionSummaries().find(item => item.id === activeSessionId.value)?.name ?? '当前会话')
/** 把当前这一场存回库里（每轮对话之后 + 每条会话命令之后都存一次）。 */
function persistHostSession(host: AgentHost | null, createIfMissing = true) {
  if (!host) return
  const activeId = sessions.activeId()
  if (!activeId && !createIfMissing) {
    sessions.saveDraftModelSelection(draftSelection.value)
    return
  }
  const id = activeId ?? sessions.create().id
  sessions.saveModelSelection(id, draftSelection.value)
  sessions.saveDraftModelSelection(null)
  // 草稿作用域的正文随第一场会话升格（上游 `promoteComposerDraft`：先写目标、再清来源）。
  if (!activeId) drafts.write(AGENT_DRAFT_SCOPE_ROOT, '')
  sessions.saveTranscript(id, host.session().transcript())
  revision.value += 1
}
function persistSession(createIfMissing = true) { persistHostSession(props.host, createIfMissing) }
/** 切到库里某一场：先把当前这场存回去，再把目标那场的转写装回活会话。 */
function openSession(id: string) {
  persistSession(false)
  if (!sessions.open(id)) return
  draftSelection.value = sessions.sessionModelSelection(id)
  restoreDraftText(id)
  props.host?.session().restore(sessions.activeEntries())
  closePops()
  bump()
}
function createSession(name?: string) {
  const selectedBeforeCreate = sessions.activeId() ? null : draftSelection.value
  persistSession(false)
  const created = sessions.create(name)
  draftSelection.value = selectedBeforeCreate
  if (selectedBeforeCreate) sessions.saveModelSelection(created.id, selectedBeforeCreate)
  sessions.saveDraftModelSelection(null)
  restoreDraftText(created.id)
  props.host?.session().clear()
  closePops()
  bump()
}
function removeSession(id: string) {
  persistSession(false)
  if (!sessions.remove(id)) return
  const nextActiveId = sessions.activeId()
  draftSelection.value = nextActiveId ? sessions.sessionModelSelection(nextActiveId) : sessions.draftSessionModelSelection()
  restoreDraftText(nextActiveId ?? AGENT_DRAFT_SCOPE_ROOT)
  props.host?.session().restore(sessions.activeEntries())
  closePops()
  bump()
}
function renameSession(id: string, name: string) {
  if (sessions.rename(id, name)) bump()
}
/** 工作区各用自己的会话库与草稿库；换宿主前先存旧转写，再恢复新工作区的当前会话。 */
watch(() => [props.projectRoot, props.host] as const, ([projectRoot, host], [previousRoot, previousHost]) => {
  if (previousHost && (previousRoot !== projectRoot || previousHost !== host)) persistHostSession(previousHost, false)
  if (previousRoot !== projectRoot) {
    sessions = createAgentSessionStore(undefined, undefined, projectRoot)
    // 草稿库也要一起换成新工作区那份：两份键都带工作区后缀（`storageKeyForProject`），
    // 只换会话库会让新工作区里敲的正文写进旧工作区的键。
    drafts = createAgentComposerDraftStore(undefined, projectRoot)
  }
  restoreDraftText(sessions.activeId() ?? AGENT_DRAFT_SCOPE_ROOT)
  if (!host) return
  const id = sessions.activeId()
  if (id) {
    host.session().restore(sessions.activeEntries())
    draftSelection.value = sessions.sessionModelSelection(id)
  } else draftSelection.value = sessions.draftSessionModelSelection()
  bump()
})
// ── 斜杠 / @ 面板（规则在 `src/agentPromptMenu.ts`；命令表仍走 `src/agentCommands.ts`）────────
// 触发词、分组、过滤、选中、插入这一整套状态在 `src/agentPanelPromptMenu.ts`；本面板只留
// 「有哪些命令、能不能用、怎么派发」—— `send()` 要先拦一道斜杠命令，那属于发送链不属于面板 UI。
function commandContext() {
  return { hasMessages: messages.value.length > 0, hasPendingEdits: pendingEdits.value.length > 0 }
}
function commandEnabled(id: string): boolean {
  const command = AGENT_COMMANDS.find(item => item.id === id)
  return !command?.enabledWhen || command.enabledWhen(commandContext())
}
/** `/` 候选由命令表产出（label / description / argumentHint 逐条取自 `AGENT_COMMANDS`）。 */
function slashSuggestionsFor(query: string): PromptMenuSuggestion[] {
  return matchAgentCommands(query).map(command => ({
    id: `slash:${command.id}`, trigger: '/' as const, value: command.id, label: command.label,
    description: command.description, keywords: command.argumentHint ? [command.argumentHint] : undefined,
  }))
}
const {
  text: promptMenuText, sync: syncPromptMenu, handleKeydown: handlePromptMenuKeys, reset: resetPromptMenu,
  menuOpen, menuRows, menuIndex, menuHint, selectMenuOption,
} = createAgentPanelPromptMenu({
  draft, input: composerInput, projectRoot: () => props.projectRoot, host: () => props.host,
  sessions: () => sessionSummaries(), slashSuggestions: slashSuggestionsFor,
  isCommandEnabled: commandEnabled, runCommand,
})
// 四个弹层共用一个状态（同屏只允许一个）；状态机与"点外面关掉"在 src/agentPanelPops.ts。
const pops = createAgentPopState()
const openPop = pops.open
// 档位弹层不在 `AgentPop` 联合里（`agentPanelPops.ts` 不在本次改动范围）：同屏只允许一个弹层这条
// 在下面两个出口统一收口 —— 开/关任何一个弹层都先关掉档位弹层。
const togglePop: typeof pops.toggle = pop => { thoughtOpen.value = false; pops.toggle(pop) }
function closePops() { thoughtOpen.value = false; pops.close() }
const actionMenuTriggers = computed(() => ACTION_MENU_FOOTER_TRIGGERS.filter(item => item.trigger === '@' || item.trigger === '/'))
function selectActionMenuIndex(index: number) {
  const target = actionMenuSelectTarget(index, { hasAttachment: false, quickCommands: [], mentionItemCount: actionMenuTriggers.value.length })
  if (target?.kind !== 'mention') return
  const entry = actionMenuTriggers.value[target.itemIndex]
  if (!entry) return
  draft.value = `${draft.value}${entry.trigger}`
  closePops()
  void nextTick(() => { const element = composerInput.value; if (element) { element.focus(); element.setSelectionRange(draft.value.length, draft.value.length); syncPromptMenu() } })
}
const pendingOnly = ref(false)
const visibleEdits = computed(() => (pendingOnly.value ? edits.value.filter(edit => edit.state === 'pending') : edits.value))
/** 跑一条斜杠命令。返回 true = 已经处理掉了（不该再当消息发出去）。 */
function runCommand(text: string): boolean {
  const parsed = parseAgentCommand(text)
  if (!parsed) return false
  const command = AGENT_COMMANDS.find(item => item.id === parsed.id)
  if (!command) { emit('notify', `认不出命令：/${parsed.id}`, true); return true }
  if (command.enabledWhen && !command.enabledWhen(commandContext())) {
    emit('notify', `${command.label} 暂不可用。`, true)
    return true
  }
  switch (parsed.id) {
    case 'new': createSession(parsed.argument || undefined); break
    case 'clear':
      props.host?.session().clear(); persistSession(); pendingOnly.value = false
      emit('notify', '已清空当前这场对话。')
      break
    case 'review': pendingOnly.value = !pendingOnly.value; emit('notify', pendingOnly.value ? '改动列表只看待决条目。' : '改动列表显示全部条目。'); break
    case 'keep-all': void doAll(); break
    case 'settings': emit('openSettings'); break
    default: return false
  }
  bump()
  return true
}
/** 输入框键盘：面板开着时先吃面板键（Enter/Tab 确认、上下导航、Esc 关），否则 Enter 提交。 */
function onComposerKeydown(event: KeyboardEvent) {
  if (handlePromptMenuKeys(event)) return
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}
function onComposerInput() {
  syncPromptMenu()
  resizeComposerInput()
}
</script>

<template>
  <div v-if="!ready" class="agent agent-unavailable">
    <p class="agent-empty-title">Agent 对话不可用</p>
  </div>
  <div v-else class="agent" :aria-busy="busy">
    <!-- 标题栏 = 当前项目（自动读取）+ 状态 + 设置入口。没有项目选择器。 -->
    <div class="agent-header">
      <div class="agent-project" :title="projectRoot">
        <FileCode2 :size="iconSize.dense" aria-hidden="true" />
        <span class="agent-project-name">{{ projectName }}</span>
      </div>
      <button class="agent-session-button" :title="`会话库（最多 ${AGENT_SESSION_LIMIT} 场）：${activeSessionName}`" aria-haspopup="true" :aria-expanded="openPop === 'sessions'" @click="togglePop('sessions')">
        <History :size="iconSize.dense" aria-hidden="true" /><span class="agent-session-name">{{ activeSessionName }}</span><span class="agent-session-count">{{ sessionSummaries().length }}</span>
      </button>
      <span v-if="statusLine" class="agent-status">{{ statusLine }}</span>
      <button class="agent-icon-button" title="Agent 设置" aria-label="Agent 设置" @click="emit('openSettings')"><Settings2 :size="iconSize.menu" /></button>
      <!-- 会话库弹层：切换 / 新建 / 删除（落盘在 src/agentSessions.ts，渲染在 AgentSessionPop）。 -->
      <AgentSessionPop v-if="openPop === 'sessions'" :sessions="sessionSummaries()" :active-id="activeSessionId" @open="openSession" @create="createSession()" @rename="renameSession" @remove="removeSession" />
    </div>
    <div ref="scrollBox" class="agent-scroll">
      <div v-if="!messages.length" class="agent-empty-state" :data-testid="draftGreetingState?.testId">
        <svg class="agent-empty-logo agent-empty-logo-light" aria-hidden="true" viewBox="0 0 400 320" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M398.97 0.5L147.576 319.5H1.03027L37.5996 273.081L120.167 169.603L120.171 169.598L215.342 47.5605L215.343 47.5615L252.424 0.5H398.97ZM264.544 273.271H372.527L336.082 319.498H189.886L202.642 303.307C217.584 284.34 240.398 273.271 264.544 273.271ZM209.164 0.5L202.786 8.58887C183.782 32.6885 154.782 46.752 124.091 46.752H25.9805L62.4268 0.5H209.164Z" stroke="currentColor" />
        </svg>
        <img class="agent-empty-logo agent-empty-logo-dark" :src="darkEmptyStateLogoUrl" alt="" aria-hidden="true" />
        <p ref="greetingContainer" class="agent-greeting" :style="{ '--greeting-font-size': `${greetingFontSize}px` }">
          <span ref="greetingMeasurement" class="agent-greeting-measure" aria-hidden="true">{{ greetingText }}</span>
          <span>{{ greetingText }}</span>
        </p>
      </div>
      <article v-for="message in messages" :key="message.id" class="agent-message" :class="`agent-${message.role}`">
        <AgentMessageContent :segments="segmentsOf(message)" @open-file="openFile" />
      </article>
      <article v-if="busy && streamingReply" class="agent-message agent-assistant">
        <AgentMessageContent :segments="streamingSegments" @open-file="openFile" />
      </article>
      <!-- 计划（AG-02）：当前这一轮的待办清单。 -->
      <section v-if="plan.length && showTodos" class="agent-section">
        <h4 class="agent-section-title">计划</h4>
        <ul class="agent-plan">
          <li v-for="step in plan" :key="step.index" class="agent-plan-step" :class="{ done: step.done }">
            <button class="agent-plan-toggle" :title="step.done ? '标记为未完成' : '标记为已完成'" :aria-label="step.done ? '标记为未完成' : '标记为已完成'" :aria-pressed="step.done" @click="toggleStep(step.index)"><IdeaCheckedIcon :size="iconSize.dense" aria-hidden="true" /></button>
            <span>{{ step.text }}</span>
          </li>
        </ul>
      </section>
      <!-- 工具调用审批（AG-04）：选项集与问句照 src/agentPermissionPrompt.ts 逐行渲染。 -->
      <section v-if="approvals.length" class="agent-section">
        <h4 class="agent-section-title">{{ AGENT_PERMISSION_TEXTS.title }}</h4>
        <div v-for="entry in approvals" :key="entry.call.id" class="agent-approval">
          <div class="agent-approval-body">
            <span class="agent-approval-tool">{{ approvalBlockTitle(entry) }}</span>
            <code class="agent-approval-params">{{ JSON.stringify(entry.call.params) }}</code>
          </div>
          <div class="agent-permission-rows" role="radiogroup" :aria-label="AGENT_PERMISSION_TEXTS.title">
            <button v-for="row in approvalRows(entry)" :key="row.index" class="agent-permission-row" :class="{ selected: row.index === approvalSelection }" role="radio" :aria-checked="row.index === approvalSelection" :aria-label="row.label ?? approvalFeedbackCopy(entry).ariaLabel" @click="approvalSelection = row.index">
              <span class="agent-permission-label">{{ row.label ?? approvalFeedbackCopy(entry).ariaLabel }}</span>
              <span v-if="row.description" class="agent-permission-desc">{{ row.description }}</span>
            </button>
            <input v-if="isFeedbackSelected(entry)" v-model="approvalFeedback" class="agent-permission-feedback" type="text" :placeholder="approvalFeedbackCopy(entry).placeholder" :aria-label="approvalFeedbackCopy(entry).ariaLabel" />
          </div>
          <div class="agent-approval-actions">
            <button class="agent-button agent-primary" :disabled="!canConfirmAgentPermissionSelection(approvalRequest(entry), approvalSelection, approvalFeedback, approvalBusy)" @click="confirmApproval(entry)">
              <IdeaCheckedIcon :size="iconSize.menu" aria-hidden="true" />{{ AGENT_PERMISSION_TEXTS.confirm }}
            </button>
          </div>
        </div>
      </section>
      <!-- 待决改动（AG-05）：对话里的红绿 + Do / Undo；顶部一条 Do All。 -->
      <section v-if="edits.length" class="agent-section">
        <h4 class="agent-section-title">
          改动
          <button class="agent-filter-toggle" :aria-pressed="pendingOnly" :title="pendingOnly ? '现在只看待决条目，点一下显示全部' : '只看待决条目'" @click="pendingOnly = !pendingOnly">只看待决</button>
          <button v-if="pendingEdits.length > 1" class="agent-do-all" @click="doAll"><CheckCheck :size="iconSize.menu" aria-hidden="true" />全部保留（{{ pendingEdits.length }}）</button>
        </h4>
        <div v-for="edit in visibleEdits" :key="edit.id" class="agent-edit" :class="`agent-edit-${edit.state}`">
          <div class="agent-edit-head">
            <button class="agent-file-link" :title="`在编辑器中查看 ${edit.path} 的差异`" @click="revealEdit(edit.id)"><FileCode2 :size="iconSize.inline" aria-hidden="true" /><span>{{ edit.path }}</span></button>
            <span class="agent-edit-counts"><b class="agent-added">+{{ edit.added }}</b> <b class="agent-removed">−{{ edit.removed }}</b></span>
            <span class="agent-edit-state">{{ stateLabel[edit.state] }}</span>
          </div>
          <!-- 红绿行：与左侧编辑器读的是台账里的同一份数据。 -->
          <div v-if="edit.state !== 'reverted'" class="agent-diff">
            <div v-for="(row, index) in rowsOf(edit.id)" :key="index" class="agent-diff-row" :class="`agent-diff-${row.kind}`">
              <span class="agent-diff-no">{{ row.kind === 'delete' ? row.left?.no : row.right?.no }}</span>
              <span class="agent-diff-sign">{{ row.kind === 'delete' ? '−' : '+' }}</span>
              <span class="agent-diff-text">{{ row.kind === 'delete' ? row.left?.text : row.right?.text }}</span>
            </div>
          </div>
          <div v-if="edit.state === 'pending'" class="agent-edit-actions">
            <button class="agent-button agent-primary" title="保留这处修改（写入磁盘）" @click="decide('do', edit.id)"><IdeaCheckedIcon :size="iconSize.menu" aria-hidden="true" />保留</button>
            <button class="agent-button" title="撤回 Agent 的这处修改" @click="decide('undo', edit.id)"><Undo2 :size="iconSize.menu" aria-hidden="true" />撤回</button>
          </div>
          <div v-else-if="edit.state === 'applied'" class="agent-edit-actions">
            <!-- 已落盘仍可撤回；若盘上被外部改过，撤回会被拒并说明原因。 -->
            <button class="agent-button" title="撤回这处修改（文件被其他程序改过时会拒绝，以免覆盖你的改动）" @click="decide('undo', edit.id)"><Undo2 :size="iconSize.menu" aria-hidden="true" />撤回</button>
          </div>
        </div>
      </section>
    </div>
    <!-- 斜杠 / @ 面板：行序由 buildPromptMenuRows 产出，行高走 MENU_PANEL_METRICS。 -->
    <div v-if="menuOpen" class="agent-command-menu" :style="{ maxHeight: `${MENU_PANEL_METRICS.option * 7}px` }">
      <p class="agent-menu-hint">{{ menuHint }}</p>
      <template v-for="(row, rowIndex) in menuRows" :key="`${rowIndex}:${row.kind}`">
        <p v-if="row.kind === 'section-header'" class="agent-menu-section">{{ row.title }}</p>
        <p v-else-if="row.kind === 'status'" class="agent-menu-status">{{ row.text }}</p>
        <button
          v-else
          class="agent-command-item"
          :class="{ selected: row.flatOptionIndex === menuIndex }"
          :aria-selected="row.flatOptionIndex === menuIndex"
          :disabled="row.option.disabled"
          @click="selectMenuOption(row.flatOptionIndex)"
        >
          <span class="agent-command-label">{{ row.option.label }}</span>
        </button>
      </template>
    </div>
    <!-- 「+」独立的「添加上下文」菜单（不是斜杠面板，`ChatPromptActionMenu.tsx`）。 -->
    <div v-if="openPop === 'actionMenu'" class="agent-action-menu">
      <button v-for="(entry, index) in actionMenuTriggers" :key="entry.trigger" class="agent-command-item" @click="selectActionMenuIndex(index)">
        <span class="agent-command-label">{{ entry.trigger }}</span><span class="agent-command-desc">{{ promptMenuText(entry.labelKey) }}</span>
      </button>
    </div>
    <form class="agent-composer" @submit.prevent="send">
      <textarea ref="composerInput" v-model="draft" class="agent-input" rows="2" :data-testid="COMPOSER_INPUT.testId" :placeholder="composerPlaceholder" aria-label="给 Agent 的消息" @keydown="onComposerKeydown" @input="onComposerInput" @click="syncPromptMenu(true)" @keyup="syncPromptMenu(true)" />
      <!-- 工具条顺序/分区取自 src/agentComposerLayout.ts 的 TOOLBAR_ROWS。 -->
      <div ref="toolbarRoot" class="agent-toolbar">
        <div v-for="row in TOOLBAR_ROWS.filter(row => row.side === 'leading')" :key="row.id" class="agent-toolbar-leading" data-composer-leading-actions>
          <div class="agent-toolbar-leading-content" data-composer-leading-content>
            <template v-for="elementId in row.elementIds" :key="elementId">
              <!-- cuaEntry / backgroundWorkTrigger：本仓没有对应系统（visibleWhen 恒假），不放假控件。 -->
              <button v-if="elementId === 'actionMenu'" type="button" class="agent-toolbar-button" :title="toolbarText.get('actionMenu')" :aria-label="toolbarText.get('actionMenu')" aria-haspopup="true" :aria-expanded="openPop === 'actionMenu'" @click="togglePop('actionMenu')"><Plus :size="iconSize.menu" aria-hidden="true" /></button>
            </template>
          </div>
        </div>
        <div v-for="row in TOOLBAR_ROWS.filter(row => row.side === 'trailing')" :key="row.id" class="agent-toolbar-trailing" data-composer-trailing-actions>
          <template v-for="elementId in row.elementIds" :key="elementId">
            <span v-if="elementId === 'modelSelect'" class="agent-model-wrap">
              <button type="button" class="agent-toolbar-button" :title="modelTriggerTitle" :aria-label="modelTriggerLabel" aria-haspopup="true" :aria-expanded="openPop === 'model'" :disabled="busy" @click="togglePop('model')">
                <Package class="agent-model-icon" :size="iconSize.menu" aria-hidden="true" /><span class="agent-toolbar-label"><span v-if="modelTriggerParts.provider" class="composer-provider-prefix">{{ modelTriggerParts.provider }}/</span>{{ modelTriggerParts.model }}</span><ChevronDown class="agent-model-indicator" :size="iconSize.dense" aria-hidden="true" />
              </button>
              <AgentModelSelectPop v-if="openPop === 'model' && !busy" :groups="modelGroups" :value="selectedModelValue" @select="selectModel" @manage-models="emit('openSettings', 'modelProvider'); closePops()" />
            </span>
            <AgentThoughtLevelSelect v-else-if="elementId === 'thoughtLevel' && thoughtLevelOptions.length" :levels="thoughtLevelOptions" :value="thoughtLevelValue" :placeholder="composerText('chat.toolbar.thoughtLevel.placeholder') ?? ''"
              :label="toolbarText.get('thoughtLevel') ?? ''" :open="thoughtOpen" :disabled="busy" @update:open="updateThoughtPop" @select="selectThoughtLevel" />
            <button v-else-if="elementId === 'stop' && showStopControl" type="button" class="agent-toolbar-button agent-stop" :title="composerText('chat.stop')" :aria-label="composerText('chat.stop')" @click="stopGeneration"><Square :size="iconSize.menu" aria-hidden="true" /></button>
            <button v-else-if="elementId === 'send' && !showStopControl" class="agent-send" type="submit" :disabled="!canSend" :title="composerText('chat.send')" :aria-label="composerText('chat.send')">
              <Loader2 v-if="busy" :size="iconSize.menu" class="agent-spin" aria-hidden="true" /><ArrowUp v-else :size="iconSize.menu" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.agent { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; container-type: inline-size; }
.agent-unavailable { padding: var(--space-3); gap: var(--space-2); }
.agent-empty-title { color: var(--secondary); font-size: 12px; font-weight: 600; margin: 0; }
/* 标题栏 + 会话库按钮/弹层 */
.agent-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "project settings" "session status"; align-items: center; gap: var(--space-1) var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); flex-shrink: 0; position: relative; }
.agent-project { grid-area: project; display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; padding-left: var(--space-2); border-left: 2px solid var(--accent); color: var(--secondary); }
.agent-project-name { color: var(--text); font-size: 12px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-status { grid-area: status; justify-self: end; color: var(--muted); font: 12px/1.4 var(--font-mono); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-icon-button { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height-sm); height: var(--ctrl-height-sm); border: 0; background: transparent; border-radius: var(--radius-xs); color: var(--secondary); cursor: pointer; transition: background-color var(--dur-1) var(--ease); }
.agent-icon-button { grid-area: settings; }
.agent-icon-button:hover { background: var(--hover); color: var(--text); }
.agent-session-button { grid-area: session; display: inline-flex; align-items: center; gap: var(--space-1); justify-self: start; min-width: 0; max-width: 100%; height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font-size: 12px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-session-button:hover { background: var(--hover); color: var(--text); }
.agent-session-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-session-count { color: var(--muted); font: 10px/1 var(--font-mono); flex-shrink: 0; }
/* 消息流 */
.agent-scroll { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) 0; display: flex; flex-direction: column; gap: var(--space-5); }
.agent-empty-state { position: relative; display: flex; flex: 1; min-height: 0; align-items: center; align-items: safe center; justify-content: flex-start; padding: var(--space-4) var(--space-6); }
.agent-empty-logo { position: absolute; top: 50%; left: 62%; width: min(68cqi, 25rem); aspect-ratio: 5 / 4; transform: translate(-50%, -50%); pointer-events: none; }
/* ConversationDraftEmptyState.tsx:180-202 */
.agent-empty-logo-light { color: var(--muted); opacity: .22; -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 70%, transparent 100%); mask-image: linear-gradient(to bottom, black 0%, transparent 70%, transparent 100%); -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-size: 100% 100%; mask-size: 100% 100%; }
.agent-empty-logo-dark { display: none; }
:global(:root[data-theme='dark']) .agent-empty-logo-light { display: none; }
:global(:root[data-theme='dark']) .agent-empty-logo-dark { display: block; }
.agent-greeting { position: relative; z-index: 1; width: min(100%, 34rem); max-width: 100%; min-width: 0; margin: 0; padding: 0 0 0 var(--space-3); border-left: 2px solid var(--accent); color: var(--text); font-size: min(var(--greeting-font-size, 30px), 1.8rem); font-weight: 500; line-height: 1.2; text-align: left; text-wrap: balance; overflow-wrap: anywhere; }
.agent-greeting-measure { position: absolute; visibility: hidden; white-space: nowrap; font-size: 30px; line-height: 1.2; pointer-events: none; }
.agent-message { display: flex; flex-direction: column; gap: var(--space-2); max-width: 100%; padding: 0 var(--space-4); }
.agent-user { align-self: flex-end; width: fit-content; max-width: min(88%, 42rem); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-strong); border-right: 2px solid var(--accent); border-radius: var(--radius-sm) var(--radius-xs) var(--radius-xs) var(--radius-sm); background: var(--panel); }
.agent-assistant { align-self: flex-start; width: calc(100% - var(--space-3)); max-width: 58rem; margin-left: var(--space-3); padding-left: var(--space-3); border-left: 1px solid var(--line-strong); }
/* 长路径：`min-width: 0` 才让 inline-flex 按钮肯缩，否则整行被路径撑宽（省略号在里面的 span 上）。 */
.agent-file-link { display: inline-flex; align-items: center; gap: var(--space-1); align-self: flex-start; max-width: 100%; min-width: 0; padding: 0 var(--space-1); border: 0; background: transparent; border-radius: var(--radius-xs); color: var(--accent); font: 12px/1.6 var(--font-mono); cursor: pointer; text-align: left; }
.agent-file-link:hover { background: var(--hover); color: var(--accent-hover); text-decoration: underline; }
.agent-file-link > span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 分区（计划 / 审批 / 改动） */
.agent-section { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-4) 0; border-top: 1px solid var(--line); }
/* 分区标题行带动作钮（只看待决 / 全部保留）：挤不下时换行，不许横向溢出。 */
.agent-section-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; min-width: 0; color: var(--secondary); font-size: 12px; font-weight: 600; }
.agent-plan { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.agent-plan-step { display: flex; align-items: flex-start; gap: var(--space-1); min-width: 0; color: var(--text); font-size: 12px; line-height: 1.6; }
.agent-plan-step.done { color: var(--muted); text-decoration: line-through; }
/* 长词（长路径 / 无空格标识符）：在步骤文字里就地断行，不许撑宽计划列表。 */
.agent-plan-step > span { min-width: 0; overflow-wrap: anywhere; }
.agent-plan-toggle { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 16px; height: 16px; margin-top: 1px; border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: transparent; color: transparent; cursor: pointer; }
.agent-plan-step.done .agent-plan-toggle { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.agent-approval { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2); background: var(--warning-bg); border: 1px solid var(--warning); border-radius: var(--radius-xs); }
.agent-approval-body { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.agent-approval-tool { color: var(--text); font-size: 12px; font-weight: 600; }
.agent-approval-params { color: var(--secondary); font: 12px/1.5 var(--font-mono); overflow-wrap: anywhere; }
.agent-approval-actions, .agent-edit-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); min-width: 0; }
/* 审批选项行（PermissionDialog 的行模型） */
.agent-permission-rows { display: flex; flex-direction: column; gap: var(--space-1); }
.agent-permission-row { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--elevated); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; text-align: left; transition: background-color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.agent-permission-row:hover { background: var(--hover); }
.agent-permission-row.selected { border-color: var(--accent); background: var(--accent-soft, var(--hover)); }
.agent-permission-label { font-weight: 600; }
.agent-permission-desc { color: var(--muted); font-size: 12px; }
.agent-permission-feedback { min-height: var(--ctrl-height-sm); padding: var(--space-1) var(--space-2); background: var(--editor); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); color: var(--text); font: 12px/1.5 var(--font-ui); }
.agent-permission-feedback:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-button { display: inline-flex; align-items: center; gap: var(--space-1); height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: var(--elevated); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; transition: background-color var(--dur-1) var(--ease); }
.agent-button:hover { background: var(--hover); }
.agent-button.agent-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.agent-button.agent-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.agent-button:disabled { opacity: .5; cursor: default; }
.agent-filter-toggle { display: inline-flex; align-items: center; height: var(--ctrl-height-sm); padding: 0 var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-xs); background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-filter-toggle[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.agent-do-all { margin-left: auto; display: inline-flex; align-items: center; gap: var(--space-1); border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; }
.agent-do-all:hover { color: var(--accent-hover); text-decoration: underline; }
.agent-edit { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--panel); }
.agent-edit-reverted { opacity: .6; }
.agent-edit-head { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.agent-edit-counts { margin-left: auto; flex-shrink: 0; font: 10px/1 var(--font-mono); display: inline-flex; gap: var(--space-1); }
.agent-added { color: var(--success); }
.agent-removed { color: var(--error); }
.agent-edit-state { color: var(--muted); font-size: 12px; flex-shrink: 0; }
.agent-diff { display: flex; flex-direction: column; background: var(--editor); border: 1px solid var(--line); border-radius: var(--radius-xs); overflow: hidden; max-height: 220px; overflow-y: auto; }
.agent-diff-row { display: flex; align-items: baseline; gap: var(--space-1); padding: 0 var(--space-1); font: 12px/1.6 var(--font-mono); white-space: pre; }
.agent-diff-insert { background: var(--success-bg); }
.agent-diff-delete { background: var(--error-bg); }
.agent-diff-no { flex-shrink: 0; min-width: 26px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.agent-diff-sign { flex-shrink: 0; width: 8px; text-align: center; }
.agent-diff-insert .agent-diff-sign { color: var(--success); }
.agent-diff-delete .agent-diff-sign { color: var(--error); }
.agent-diff-text { overflow: hidden; text-overflow: ellipsis; }
/* 斜杠命令补全 */
.agent-command-menu { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; max-width: 100%; margin: 0 var(--space-2) var(--space-1); padding: var(--space-1); overflow-y: auto; overscroll-behavior: contain; background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); color: var(--popup-foreground); }
.agent-command-item { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-xs); background: transparent; color: var(--text); font-size: 12px; cursor: pointer; text-align: left; transition: background-color var(--dur-1) var(--ease); }
.agent-command-item:hover { background: var(--hover); }
.agent-command-label { min-width: 0; max-width: 100%; font-family: var(--font-mono); color: var(--accent); overflow-wrap: anywhere; }
.agent-command-desc { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-command-item.selected { background: var(--hover); }
.agent-menu-hint, .agent-menu-section, .agent-menu-status { margin: 0; padding: var(--space-1) var(--space-2); color: var(--muted); font-size: 12px; line-height: 1.5; }
.agent-menu-section { color: var(--secondary); font-weight: 600; }
.agent-action-menu { position: absolute; bottom: 100%; left: var(--space-2); z-index: 20; display: flex; flex-direction: column; gap: var(--space-1); min-width: min(180px, calc(100cqi - var(--space-6))); max-width: min(20rem, calc(100cqi - var(--space-6))); max-height: min(320px, calc(100vh - var(--space-6))); overflow-y: auto; overscroll-behavior: contain; margin-bottom: var(--space-1); padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); color: var(--popup-foreground); }
/* 输入区与单行工具条 */
.agent-composer { position: relative; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--panel); flex-shrink: 0; transition: border-color var(--dur-1) var(--ease), background-color var(--dur-1) var(--ease); }
.agent-composer:hover { border-color: var(--line-strong); }
.agent-composer:focus-within { border-color: var(--accent); outline: var(--focus-ring); outline-offset: var(--focus-ring-offset-inset); }
.agent-input { display: block; width: 100%; min-width: 0; height: 40px; max-height: 160px; min-height: 40px; overflow-y: hidden; resize: none; padding: 0; background: transparent; border: 0; border-radius: 0; color: var(--text); font: 1rem/20px var(--font-ui); }
.agent-input:focus-visible { outline: none; }
.agent-toolbar { display: flex; align-items: center; gap: var(--space-3); min-height: var(--ctrl-height); min-width: 0; }
.agent-toolbar-leading { display: flex; flex: 1 1 auto; align-items: center; min-width: 0; }
.agent-toolbar-leading-content { display: flex; flex: 0 0 auto; align-items: center; gap: var(--space-1); }
.agent-toolbar-trailing { display: flex; flex: 0 0 auto; align-items: center; gap: var(--space-1); margin-left: auto; }
.agent-toolbar-button { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; max-width: 160px; height: var(--ctrl-height); padding: 0 var(--space-2); border: 1px solid transparent; border-radius: var(--radius-xs); background: transparent; color: var(--secondary); font: 14px/1.5 var(--font-ui); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-toolbar-button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.agent-toolbar-button:disabled { opacity: .5; cursor: default; }
.agent-toolbar-button.off { color: var(--muted); }
.agent-toolbar-button > svg:first-child:not(.lucide):not(.idea-icon) { width: var(--icon-size-action); height: var(--icon-size-action); }
.agent-toolbar-button > svg:last-child:not(:first-child):not(.lucide):not(.idea-icon) { width: var(--icon-size-control); height: var(--icon-size-control); }
.agent-toolbar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.agent-mode-wrap, .agent-model-wrap { position: relative; display: inline-flex; min-width: 0; }
.agent-model-icon { display: none; }
.agent-toolbar[data-composer-provider-compact="true"] .composer-provider-prefix { display: none; }
.agent-toolbar[data-composer-model-icon="true"] .agent-toolbar-label,
.agent-toolbar[data-composer-model-icon="true"] .agent-model-indicator { display: none; }
.agent-toolbar[data-composer-model-icon="true"] .agent-model-icon { display: block; }
.agent-toolbar[data-composer-model-icon="true"] .agent-toolbar-button { width: var(--ctrl-height); padding: 0; justify-content: center; gap: 0; }
/* 锚定弹层：坐标系是最近的 position:relative 祖先（.agent-mode-wrap / .agent-model-wrap）。
   `max-width` 必须受容器约束 —— 面板可能只有 180px 宽，固定 min-width 会横向压住编辑器。 */
.agent-pop { position: absolute; bottom: 100%; left: 0; z-index: 20; display: flex; flex-direction: column; gap: var(--space-1); min-width: min(220px, calc(100cqi - var(--space-6))); max-width: min(20rem, calc(100cqi - var(--space-6))); max-height: 320px; overflow: auto; margin-bottom: var(--space-1); padding: var(--space-1); background: var(--elevated); border: var(--popup-border); border-radius: var(--popup-radius); box-shadow: var(--popup-shadow); color: var(--popup-foreground); }
.agent-stop { width: var(--ctrl-height); padding: 0; border-radius: var(--radius-md); background: var(--panel); color: var(--text); }
.agent-stop:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.agent-stop > svg { fill: currentColor; }
.agent-send { display: inline-flex; align-items: center; justify-content: center; width: var(--ctrl-height); height: var(--ctrl-height); border: 1px solid transparent; border-radius: var(--radius-xs); background: var(--accent); color: var(--on-accent); cursor: pointer; transition: background-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.agent-send > svg:not(.lucide):not(.idea-icon) { width: var(--icon-size-action); height: var(--icon-size-action); }
.agent-send:hover:not(:disabled) { background: var(--accent-hover); }
.agent-send:disabled { opacity: .5; cursor: default; }
.agent-spin { animation: agent-spin var(--dur-spin) var(--ease-linear) infinite; }
@keyframes agent-spin { to { transform: rotate(360deg); } }
</style>
