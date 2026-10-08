// Agent 面板里「输入框上方的斜杠 / @ 面板」在面板侧的那一半：触发词快照、分组行序、选中索引、插入。
//
// 为什么要单独一个模块：`AgentPanel.vue` 顶在 900 行机检上限（`tests/module-size.test.mjs`），
// 而这一段是**一整套自成一体的交互状态** —— 触发词只在行首或空白之后且紧贴光标成立、
// Esc 关掉后同签名不再自动弹回、方向键只在启用项之间走、插入要连带吃掉光标后对得上的 tail；
// 它与「命令表有哪些命令、怎么派发」「输入框多高」「消息怎么发」都不共一个职责域。
//
// 边界（另一半留在 AgentPanel.vue）：
//   · 命令表与派发 —— `AGENT_COMMANDS` / `matchAgentCommands` / `parseAgentCommand` 与 `runCommand`
//     留在面板：`send()` 要先拦一道斜杠命令，那属于发送链不属于菜单 UI。
//   · 输入框几何（40/160px 自适应）与消息发送留在面板。
// 交互规则本身（打分、分组顺序、插入计划、Esc 抑制的签名）仍在 `src/agentPromptMenu.ts`；
// 这里只把那些规则接到 Vue 的响应式状态与真实 DOM 输入框上，不重新实现规则。
import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { WorkspaceSearchFileEntry } from './bridge.ts'
import { loadWorkspaceFileSearchEntries, workspaceFileIgnoreChanged } from './workspaceFileSearchIgnore.ts'
import {
  CONTEXT_MENU_SOURCES, MENU_SELECT_KEYS, PROMPT_MENU_TEXTS,
  bestPromptMenuSuggestionIndex, buildFileMentionMarkdown, buildPromptMenuRows, buildSessionMentionMarkdown,
  clampedMenuIndex, coerceEnabledMenuIndex, filterMentionMenuItems, filterPromptMenuSuggestions,
  hasPromptMenuQuery, mentionGroupLimitForQuery, mentionPanelSearchHintKey, nextEnabledMenuIndex,
  normalizePromptMentionDisplayLabel, promptMenuGroupOrder, promptMenuInsertionForMentionItem,
  promptMenuInsertionForSuggestion, promptMenuTokenReplacementRange, promptMenuTokenTailLength,
  promptMenuTriggerSignature, reconcilePromptMenuTokenSnapshot, visiblePromptMenuSections,
  type ActivePromptMenuTrigger, type PromptMenuItem, type PromptMenuOption, type PromptMenuRow,
  type PromptMenuSection, type PromptMenuSuggestion, type PromptMenuTextSelection, type PromptMenuTokenSnapshot,
} from './agentPromptMenu.ts'

/** `@` 的 sessions 分组只取三个字段 —— 面板传 `sessionSummaries()`，本模块不依赖会话库的类型。 */
export interface AgentPromptMenuSession { readonly id: string; readonly name: string; readonly entries: number }

export interface AgentPanelPromptMenuContext {
  /** 草稿正文；插入 / 替换会写回这里。 */
  readonly draft: Ref<string>
  /** 输入框元素：光标位置从它读，插入后焦点落回它。 */
  readonly input: Ref<HTMLTextAreaElement | undefined>
  /** 当前工作区根（`@` 的文件清单按它重载）。 */
  readonly projectRoot: () => string
  /** 宿主（面板传 `props.host`）：与工作区根一起决定文件清单什么时候重载。 */
  readonly host: () => unknown
  /** 会话库里每一场（`@` 的 sessions 分组）。 */
  readonly sessions: () => readonly AgentPromptMenuSession[]
  /** `/` 候选：面板从命令表（`matchAgentCommands`）产出 —— 本模块不认命令表。 */
  readonly slashSuggestions: (query: string) => readonly PromptMenuSuggestion[]
  /** `/` 某条命令现在能不能用（`AGENT_COMMANDS` 的 `enabledWhen` 判据）。 */
  readonly isCommandEnabled: (id: string) => boolean
  /** 命中 `remove-only` 的命令由面板派发（命令表与执行都在面板）。 */
  readonly runCommand: (text: string) => void
}

/** 面板要的那几个出口：`menu*` 是模板直接绑定的，其余是输入区事件入口。 */
export interface AgentPanelPromptMenu {
  /** 面板文案（分组标题 / 空态 / 搜索提示）；面板「+」菜单也用同一张键表。 */
  text(key: string): string
  /** 输入 / 光标变化后重解析触发词；`selectionOnly` = 只是挪了光标。 */
  sync(selectionOnly?: boolean): void
  /** 输入框键盘里"面板优先"的那一半：返回 true = 这次按键已被面板吃掉（不用再当消息提交）。 */
  handleKeydown(event: KeyboardEvent): boolean
  /** 面板自己接管了输入（发送 / 跑命令）时，把面板状态一起清掉。 */
  reset(): void
  readonly menuOpen: ComputedRef<boolean>
  readonly menuRows: ComputedRef<readonly PromptMenuRow[]>
  readonly menuIndex: Ref<number>
  readonly menuHint: ComputedRef<string>
  /** 选中第 index 个扁平选项（禁用项与越界一律忽略）。 */
  selectMenuOption(index: number): void
}

function selectionFor(element: HTMLTextAreaElement | undefined, text: string): PromptMenuTextSelection {
  const caret = element?.selectionStart ?? text.length
  return { cursorOffset: caret, nodeKey: 'agent-composer', text, textBeforeCursor: text.slice(0, caret) }
}

export function createAgentPanelPromptMenu(ctx: AgentPanelPromptMenuContext): AgentPanelPromptMenu {
  // 触发词只在「行首或空白之后、且紧贴光标」成立 —— 判定在 extractActivePromptMenuTrigger。
  const draftTrigger = ref<ActivePromptMenuTrigger | null>(null)
  const promptMenuSnapshot = ref<PromptMenuTokenSnapshot | null>(null)
  /** Esc 关掉后用 trigger+query 签名记住，同签名不再自动弹回（`promptMenuTriggerSignature`）。 */
  const dismissedMenuSignature = ref<string | null>(null)
  const menuIndex = ref(0)
  const promptMenuTexts = new Map(PROMPT_MENU_TEXTS.map(entry => [entry.key, entry.zh]))
  function text(key: string): string { return promptMenuTexts.get(key) ?? '' }

  const slashQuery = computed(() => (draftTrigger.value?.trigger === '/' ? draftTrigger.value.query : null))
  const slashSuggestions = computed<readonly PromptMenuSuggestion[]>(() => {
    const query = slashQuery.value
    return query === null ? [] : ctx.slashSuggestions(query)
  })
  const filteredSlashSuggestions = computed(() => filterPromptMenuSuggestions(slashSuggestions.value, slashQuery.value))
  const slashOptions = computed<PromptMenuOption[]>(() => filteredSlashSuggestions.value.map(suggestion => ({
    id: suggestion.id, label: suggestion.label, description: suggestion.description,
    disabled: !ctx.isCommandEnabled(suggestion.value),
  })))

  // @ 上下文：files 走工作区文件清单、sessions 走会话库；plugin/whiteboard 本仓无数据源，不渲染。
  const workspaceFileEntries = ref<WorkspaceSearchFileEntry[]>([])
  let workspaceFileLoadToken = 0
  async function loadWorkspaceFiles() {
    const token = ++workspaceFileLoadToken
    const root = ctx.projectRoot()
    if (!root) { workspaceFileEntries.value = []; return }
    try {
      const candidates = await loadWorkspaceFileSearchEntries(root)
      if (token === workspaceFileLoadToken && root === ctx.projectRoot()) workspaceFileEntries.value = candidates
    } catch {
      if (token === workspaceFileLoadToken && root === ctx.projectRoot()) workspaceFileEntries.value = []
    }
  }
  watch(() => [ctx.host(), ctx.projectRoot()], () => { void loadWorkspaceFiles() }, { immediate: true })
  watch(() => workspaceFileIgnoreChanged.revision, () => {
    if (workspaceFileIgnoreChanged.root === ctx.projectRoot()) void loadWorkspaceFiles()
  })
  function mentionItemsFor(category: 'files' | 'sessions'): PromptMenuItem[] {
    if (category === 'files') return workspaceFileEntries.value.map(entry => ({
      id: `file:${entry.path}`, category: 'files' as const,
      label: entry.path.split('/').pop() ?? entry.path, description: entry.path, value: entry.path,
      markdown: buildFileMentionMarkdown(entry.path, entry.path.split('/').pop() ?? entry.path, entry.type),
      data: { kind: entry.type, path: entry.path, relativePath: entry.path },
    }))
    return ctx.sessions().map(item => ({
      id: `session:${item.id}`, category: 'sessions' as const, label: item.name, description: `${item.entries} 条`,
      value: item.id, markdown: buildSessionMentionMarkdown(item.id, item.name),
    }))
  }
  const contextSections = computed<readonly PromptMenuSection[]>(() => {
    const trigger = draftTrigger.value?.trigger
    if (trigger !== '@' && trigger !== '#') return []
    const query = draftTrigger.value?.query ?? ''
    const sections: Array<PromptMenuSection & { readonly loading: boolean; readonly errorText: string | null }> = []
    for (const groupId of promptMenuGroupOrder(trigger)) {
      if (groupId !== 'files' && groupId !== 'sessions') continue
      const source = CONTEXT_MENU_SOURCES.find(candidate => candidate.id === groupId)
      if (!source) continue
      const items = filterMentionMenuItems(mentionItemsFor(groupId), query, { limit: mentionGroupLimitForQuery(query) })
      sections.push({
        id: groupId, title: text(source.titleKey), emptyText: text(source.emptyKey),
        loading: false, errorText: null,
        options: items.map(item => ({
          id: item.id, label: normalizePromptMentionDisplayLabel(item.category, item.label, item.value), description: item.description,
        })),
      })
    }
    return visiblePromptMenuSections(sections)
  })
  const contextFlatItems = computed(() => contextSections.value.flatMap(section =>
    section.options.map(option => mentionItemsFor(section.id as 'files' | 'sessions').find(item => item.id === option.id)!)))
  const menuIsSlash = computed(() => draftTrigger.value?.trigger === '/')
  const flatOptions = computed<readonly PromptMenuOption[]>(() => (menuIsSlash.value ? slashOptions.value : contextSections.value.flatMap(section => section.options)))
  const menuRows = computed<readonly PromptMenuRow[]>(() => {
    if (menuIsSlash.value) {
      return buildPromptMenuRows([{ id: 'commands', title: text('chat.slash.commands.title'), options: slashOptions.value, emptyText: text('chat.slash.emptyResults'), loading: false, errorText: null }])
    }
    return buildPromptMenuRows(contextSections.value)
  })
  const menuOpen = computed(() => {
    const signature = promptMenuTriggerSignature(draftTrigger.value)
    if (!signature || signature === dismissedMenuSignature.value) return false
    return flatOptions.value.length > 0 || hasPromptMenuQuery(draftTrigger.value?.query ?? '')
  })
  const menuHint = computed(() => text(draftTrigger.value?.trigger === '@' ? mentionPanelSearchHintKey('@') : 'chat.slash.searchHint'))

  /** 输入/光标变化后重解析触发词；签名变了才重置选中并解除 Esc 抑制。 */
  function sync(selectionOnly = false) {
    const selection = selectionFor(ctx.input.value, ctx.draft.value)
    const snapshot = reconcilePromptMenuTokenSnapshot(promptMenuSnapshot.value, selection, selectionOnly)
    promptMenuSnapshot.value = snapshot
    const trigger = snapshot ? { trigger: snapshot.trigger, query: snapshot.query } : null
    const previousSignature = promptMenuTriggerSignature(draftTrigger.value)
    draftTrigger.value = trigger
    if (promptMenuTriggerSignature(trigger) === previousSignature) return
    dismissedMenuSignature.value = null
    menuIndex.value = trigger?.trigger === '/' ? bestPromptMenuSuggestionIndex(filteredSlashSuggestions.value, trigger.query) : 0
    menuIndex.value = coerceEnabledMenuIndex(menuIndex.value, flatOptions.value)
  }
  function moveSelection(delta: number) {
    if (menuIsSlash.value) menuIndex.value = clampedMenuIndex(menuIndex.value, delta, flatOptions.value.length)
    else menuIndex.value = nextEnabledMenuIndex(menuIndex.value, delta, flatOptions.value)
  }
  /** 把当前 token 换成 insertText（连带吃掉光标后对得上的 tail），光标落到其后。 */
  function replaceMenuToken(insertText: string) {
    const element = ctx.input.value
    const trigger = draftTrigger.value
    if (!element || !trigger) return
    const selection = selectionFor(element, ctx.draft.value)
    const range = promptMenuTokenReplacementRange(promptMenuSnapshot.value, selection)
    if (!range) return
    const tailLength = promptMenuTokenTailLength(trigger, ctx.draft.value.slice(selection.cursorOffset), insertText)
    ctx.draft.value = ctx.draft.value.slice(0, range.start) + insertText + ctx.draft.value.slice(range.end + tailLength)
    const nextCaret = range.start + insertText.length
    dismissedMenuSignature.value = null
    draftTrigger.value = null
    promptMenuSnapshot.value = null
    menuIndex.value = 0
    void nextTick(() => { element.focus(); element.setSelectionRange(nextCaret, nextCaret) })
  }
  function selectMenuOption(index: number) {
    const option = flatOptions.value[index]
    if (!option || option.disabled) return
    if (menuIsSlash.value) {
      const suggestion = filteredSlashSuggestions.value.find(item => item.id === option.id)
      if (!suggestion) return
      const plan = promptMenuInsertionForSuggestion(suggestion)
      if (plan?.kind === 'mention') replaceMenuToken(`/${plan.payload.value}${plan.trailingText}`)
      else if (plan?.kind === 'remove-only') { const id = suggestion.value; replaceMenuToken(''); ctx.runCommand(`/${id}`) }
      return
    }
    const item = contextFlatItems.value[index]
    if (!item) return
    const plan = promptMenuInsertionForMentionItem(item)
    if (plan?.kind === 'mention') replaceMenuToken(plan.payload.markdown + plan.trailingText)
  }
  function closeMenu() {
    dismissedMenuSignature.value = promptMenuTriggerSignature(draftTrigger.value)
    draftTrigger.value = null
    promptMenuSnapshot.value = null
  }
  function handleKeydown(event: KeyboardEvent): boolean {
    if (!menuOpen.value) return false
    if (MENU_SELECT_KEYS.slash.includes(event.key)) { event.preventDefault(); selectMenuOption(menuIndex.value); return true }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1); return true }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return true }
    return false
  }
  function reset() {
    draftTrigger.value = null
    dismissedMenuSignature.value = null
  }

  return { text, sync, handleKeydown, reset, menuOpen, menuRows, menuIndex, menuHint, selectMenuOption }
}
