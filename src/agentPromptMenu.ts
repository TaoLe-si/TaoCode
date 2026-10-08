// ZCode 斜杠命令 / @ 上下文面板的**交互层纯逻辑**（零 Vue / 零 DOM / 零 Lexical）。
//
// 事实来源：.tools/ZCode/packages/ui/src。每条规则、字段、文案都带 文件:行号。
// 判据：tests/agent-prompt-menu.test.mjs —— 逐条回源码核（含「行号指得对」）。
//
// 分工：`/` 命令的**表**在 src/agentCommands.ts（本批只读）。本模块不登记任何命令，
// 只做 ZCode 那套触发词解析、候选过滤、分组顺序、键盘导航与选中后的插入语义；
// 候选由调用方（AgentPanel.vue）喂进来，命令来源仍是 agentCommands.ts 那张表。
import { ZCODE_UI_SRC } from './agentComposerLayout.ts'

export { ZCODE_UI_SRC }

/** zh-CN 词条文件（相对仓库根）。 */
export const ZCODE_LOCALE_FILE = `${ZCODE_UI_SRC}/i18n/locales/zh-CN.ts`

/** ZCode 共享包源码根（test-id 常量在这里）。 */
export const ZCODE_SHARED_SRC = '.tools/ZCode/packages/shared/src'

// ── 文案表 ────────────────────────────────────────────────────────────────
// 只收「有真实消费方」的键：键在 zh-CN.ts 的行 + 中文 + 消费方（`路径:行号`，逗号分隔）。
// 零消费方的键（如 chat.mention.subagents.title）不进表，列在 PROMPT_MENU_UNVERIFIABLE。

export interface PromptMenuText {
  readonly key: string
  readonly zh: string
  /** 键在 zh-CN.ts 的行号。 */
  readonly at: number
  /** 消费方（相对 ZCODE_UI_SRC 的 `路径:行号`）。 */
  readonly consumers: string
}

export const PROMPT_MENU_TEXTS: readonly PromptMenuText[] = [
  // @ / # / $ 提及面板（mentions/MentionPlugin.tsx）
  { key: 'chat.mention.title', zh: '提及', at: 5448, consumers: 'mentions/MentionPlugin.tsx:693' },
  { key: 'chat.mention.searchHint', zh: '输入内容以搜索插件、文件或对话', at: 5451, consumers: 'mentions/MentionPlugin.tsx:700' },
  { key: 'chat.mention.emptyResults', zh: '没有匹配的提及结果', at: 5453, consumers: 'mentions/MentionPlugin.tsx:702' },
  { key: 'chat.mention.category.loading', zh: '搜索中...', at: 5458, consumers: 'mentions/MentionPlugin.tsx:352,slashCommandPanelSections.tsx:65' },
  { key: 'chat.mention.files.title', zh: '文件', at: 5460, consumers: 'mentions/MentionPlugin.tsx:189,prompt-editor/ChatPromptActionMenu.tsx:97' },
  { key: 'chat.mention.files.empty', zh: '没有匹配的文件', at: 5461, consumers: 'mentions/MentionPlugin.tsx:188,prompt-editor/ChatPromptActionMenu.tsx:96' },
  { key: 'chat.mention.skills.title', zh: '技能', at: 5462, consumers: 'mentions/MentionPlugin.tsx:178' },
  { key: 'chat.mention.skills.empty', zh: '没有匹配的技能', at: 5463, consumers: 'mentions/MentionPlugin.tsx:177' },
  { key: 'chat.mention.skills.searchHint', zh: '输入内容以搜索技能', at: 5464, consumers: 'mentions/MentionPlugin.tsx:699' },
  { key: 'chat.mention.whiteboards.title', zh: '画板', at: 5467, consumers: 'mentions/MentionPlugin.tsx:198' },
  { key: 'chat.mention.whiteboards.empty', zh: '没有匹配的画板', at: 5468, consumers: 'mentions/MentionPlugin.tsx:197' },
  { key: 'chat.mention.whiteboards.strokeCount', zh: '{count} 条笔画', at: 5469, consumers: 'mentions/MentionPlugin.tsx:339' },
  { key: 'chat.mention.plugins.title', zh: '插件', at: 5470, consumers: 'mentions/MentionPlugin.tsx:219,prompt-editor/ChatPromptActionMenu.tsx:87' },
  { key: 'chat.mention.plugins.empty', zh: '没有可引用的插件', at: 5471, consumers: 'mentions/MentionPlugin.tsx:218,prompt-editor/ChatPromptActionMenu.tsx:86' },
  { key: 'chat.mention.plugins.conflict', zh: '同名插件冲突，暂不可引用', at: 5472, consumers: 'mentions/providers/pluginsMentionProvider.ts:123' },
  { key: 'chat.mention.sessions.title', zh: '会话', at: 5473, consumers: 'mentions/MentionPlugin.tsx:208,prompt-editor/ChatPromptActionMenu.tsx:108' },
  { key: 'chat.mention.sessions.empty', zh: '没有匹配的近期会话', at: 5474, consumers: 'mentions/MentionPlugin.tsx:207,prompt-editor/ChatPromptActionMenu.tsx:107' },
  { key: 'chat.mention.sessions.searchHint', zh: '输入内容以搜索近期会话', at: 5475, consumers: 'mentions/MentionPlugin.tsx:697' },

  // / 命令与能力面板（SlashCommandPlugin.tsx + slashCommandPanelSections.tsx）
  { key: 'chat.slash.title', zh: '命令与能力', at: 5476, consumers: 'SlashCommandPlugin.tsx:426' },
  { key: 'chat.slash.searchHint', zh: '输入内容以搜索命令、技能或子智能体', at: 5477, consumers: 'SlashCommandPlugin.tsx:430' },
  { key: 'chat.slash.app.side.description', zh: '新建并打开一个辅助对话', at: 5478, consumers: 'v4/SessionPane.tsx:2090' },
  { key: 'chat.slash.commands.title', zh: '命令', at: 5479, consumers: 'slashCommandPanelSections.tsx:24' },
  { key: 'chat.slash.skills.title', zh: '技能', at: 5480, consumers: 'slashCommandPanelSections.tsx:48' },
  { key: 'chat.slash.skills.empty', zh: '没有匹配的技能', at: 5481, consumers: 'slashCommandPanelSections.tsx:66' },
  { key: 'chat.slash.subagents.title', zh: '子智能体', at: 5482, consumers: 'slashCommandPanelSections.tsx:71' },
  { key: 'chat.slash.subagents.empty', zh: '没有匹配的子智能体', at: 5483, consumers: 'slashCommandPanelSections.tsx:88' },
  { key: 'chat.slash.emptyUnavailable', zh: '没有匹配的命令', at: 5484, consumers: 'slashCommandPanelSections.tsx:43' },
  { key: 'chat.slash.emptyResults', zh: '没有匹配的 slash command', at: 5485, consumers: 'slashCommandPanelSections.tsx:44' },

  // 「添加」面板 / 工具条（prompt-editor/ChatPromptActionMenu.tsx + ChatPromptEditor.tsx）
  { key: 'chat.composer.actionMenu', zh: '添加上下文', at: 5440, consumers: 'prompt-editor/ChatPromptEditor.tsx:173' },
  { key: 'chat.composer.addSection', zh: '添加', at: 145, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:129' },
  { key: 'chat.composer.attachment', zh: '附件', at: 147, consumers: 'v4/ConversationComposer.tsx:1644' },
  { key: 'chat.composer.addWorkflow', zh: '工作流', at: 146, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:31' },
  { key: 'chat.goalBanner.label', zh: '目标', at: 4438, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:30' },
  { key: 'chat.composer.contextShortcut', zh: '添加上下文', at: 142, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:312' },
  { key: 'chat.composer.capabilityShortcut', zh: '选择能力', at: 143, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:313' },
  { key: 'chat.composer.skillShortcut', zh: '选择技能', at: 144, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:314' },
  { key: 'chat.composer.contextSearchHint', zh: '输入内容以搜索插件、文件和对话', at: 141, consumers: 'prompt-editor/ChatPromptActionMenu.tsx:326' },
  { key: 'chat.composer.workspaceFileDragHint', zh: '松开以引用此文件或目录', at: 4270, consumers: 'prompt-editor/ChatPromptEditor.tsx:176' },
]

// ── 触发词 ────────────────────────────────────────────────────────────────
// 出处：lib/promptInputTriggers.ts。

/** 四个触发词（`¥`/`￥` 是 `$` 的输入法别名，归一后不单独存在）。 */
export type PromptMenuTrigger = '/' | '@' | '$' | '#'

/** 通用触发：`(^|\s)` 前缀 —— 触发符必须在行首或空白之后，且紧贴光标。 */
export const ACTIVE_TRIGGER_RE = /(^|\s)([/@$#¥￥])([^\s/@$#¥￥]*)$/

/** `@` 放宽前缀：中文输入通常不在句中插空格，额外允许汉字与中文/全角标点紧邻 `@`。 */
export const ACTIVE_MENTION_TRIGGER_RE =
  /(^|[\s\p{Script=Han}\u3000-\u303f\uff00-\uffef])(@)([^\s/@$#¥￥]*)$/u

/** 邮箱/域名形态：汉字紧邻 `@` 且 query 形如 `x.y` 时拒绝触发（`联系邮箱@example.com`）。 */
export const DOMAIN_LIKE_QUERY_RE = /\S\.\S/
export const HAN_PREFIX_RE = /\p{Script=Han}/u
/** 光标后 tail 的取值域：到下一个空白/触发符为止。 */
export const ACTIVE_TRIGGER_TAIL_RE = /^[^\s/@$#¥￥]*/

export interface ActivePromptMenuTrigger {
  readonly trigger: PromptMenuTrigger
  /** 触发符与光标之间的已输入查询（可为空串）。 */
  readonly query: string
}

/** `¥` / `￥` 只归一触发语义，不改写用户输入字符（promptInputTriggers.ts:42-49）。 */
export function normalizePromptMenuTriggerAlias(trigger: string): PromptMenuTrigger {
  if (trigger === '¥' || trigger === '￥') return '$'
  return trigger as PromptMenuTrigger
}

/** 面板重开判据用的签名：trigger + query 组合，两个触发器同名查询不会互相压住。 */
export function promptMenuTriggerSignature(trigger: ActivePromptMenuTrigger | null): string | null {
  return trigger ? `${trigger.trigger}:${trigger.query}` : null
}

/**
 * 从「光标前文本」解析当前活跃触发词。
 * 先试 `@` 放宽规则，再退通用规则；命中放宽规则但 query 是域名形态时**直接拒绝**（不回退）。
 */
export function extractActivePromptMenuTrigger(textBeforeCursor: string): ActivePromptMenuTrigger | null {
  const match = ACTIVE_MENTION_TRIGGER_RE.exec(textBeforeCursor) ?? ACTIVE_TRIGGER_RE.exec(textBeforeCursor)
  if (!match) return null
  if (HAN_PREFIX_RE.test(match[1] ?? '') && DOMAIN_LIKE_QUERY_RE.test(match[3] ?? '')) return null
  return { trigger: normalizePromptMenuTriggerAlias(match[2] ?? ''), query: match[3] ?? '' }
}

/**
 * 选中候选时要一并替换掉的「光标后 tail」长度。
 * query 为空 → 0（光标后的正文不属于本 token）；否则只删「候选值未输入后缀」对得上的那一小段。
 */
export function promptMenuTokenTailLength(
  activeTrigger: ActivePromptMenuTrigger,
  textAfterCursor: string,
  replacementCandidates: string | readonly string[],
): number {
  if (activeTrigger.query.length === 0) return 0
  const tailText = ACTIVE_TRIGGER_TAIL_RE.exec(textAfterCursor)?.[0] ?? ''
  if (!tailText) return 0

  const normalizedQuery = activeTrigger.query.toLowerCase()
  const candidates = Array.isArray(replacementCandidates) ? replacementCandidates : [replacementCandidates]
  let matchedTailLength = 0

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.trim().replace(/^[/@$#¥￥]+/, '')
    if (!candidate || !candidate.toLowerCase().startsWith(normalizedQuery)) continue
    const expectedTail = candidate.slice(activeTrigger.query.length)
    if (!expectedTail) continue
    const comparableLength = Math.min(tailText.length, expectedTail.length)
    const typedTail = tailText.slice(0, comparableLength)
    if (expectedTail.toLowerCase().startsWith(typedTail.toLowerCase())) {
      matchedTailLength = Math.max(matchedTailLength, comparableLength)
    }
  }
  return matchedTailLength
}

// ── token 快照与替换区间 ──────────────────────────────────────────────────
// 出处：mentions/activePromptInputToken.ts。面板打开期间选区会丢，靠快照回填。

export interface PromptMenuTextSelection {
  readonly cursorOffset: number
  readonly nodeKey: string
  readonly text: string
  readonly textBeforeCursor: string
}

export interface PromptMenuTokenSnapshot extends ActivePromptMenuTrigger {
  readonly nodeKey: string
  readonly tokenEnd: number
  readonly tokenStart: number
  readonly tokenText: string
}

/** 光标是否落在 token 内部（tokenStart 是触发符本身，所以下界 +1）。 */
export function isCaretInsidePromptMenuToken(snapshot: PromptMenuTokenSnapshot, cursorOffset: number): boolean {
  return cursorOffset >= snapshot.tokenStart + 1 && cursorOffset <= snapshot.tokenEnd
}

export function createPromptMenuTokenSnapshot(selection: PromptMenuTextSelection): PromptMenuTokenSnapshot | null {
  const activeTrigger = extractActivePromptMenuTrigger(selection.textBeforeCursor)
  if (!activeTrigger) return null
  const tokenStart = selection.cursorOffset - activeTrigger.query.length - 1
  const tokenEnd = selection.cursorOffset
  return { ...activeTrigger, nodeKey: selection.nodeKey, tokenEnd, tokenStart, tokenText: selection.text.slice(tokenStart, tokenEnd) }
}

/**
 * 只有「仅选区变化」且 token 文本原样时才复用旧快照 —— 左右方向键不该重算 query、
 * 重置 selectedIndex 并重建虚拟列表。
 */
export function reconcilePromptMenuTokenSnapshot(
  previous: PromptMenuTokenSnapshot | null,
  selection: PromptMenuTextSelection,
  selectionOnly: boolean,
): PromptMenuTokenSnapshot | null {
  if (!selectionOnly || !previous) return createPromptMenuTokenSnapshot(selection)
  if (previous.nodeKey !== selection.nodeKey) return null
  if (selection.text.slice(previous.tokenStart, previous.tokenEnd) !== previous.tokenText) {
    return createPromptMenuTokenSnapshot(selection)
  }
  if (!isCaretInsidePromptMenuToken(previous, selection.cursorOffset)) return null
  return previous
}

/** 待替换区间；快照失效（节点换过 / 文本被改 / 光标已出 token）时返回 null。 */
export function promptMenuTokenReplacementRange(
  snapshot: PromptMenuTokenSnapshot | null,
  selection: PromptMenuTextSelection,
): { readonly end: number; readonly start: number } | null {
  if (
    !snapshot ||
    snapshot.nodeKey !== selection.nodeKey ||
    !isCaretInsidePromptMenuToken(snapshot, selection.cursorOffset) ||
    selection.text.slice(snapshot.tokenStart, snapshot.tokenEnd) !== snapshot.tokenText
  ) {
    return null
  }
  return { end: snapshot.tokenEnd, start: snapshot.tokenStart }
}

/** 面板归属：`/` 是独立插件，`@`/`#`/`$` 共用 MentionPlugin。 */
export function promptMenuOwner(trigger: PromptMenuTrigger): { readonly panel: string; readonly source: string } {
  if (trigger === '/') return { panel: 'SlashCommandPlugin', source: `${ZCODE_UI_SRC}/SlashCommandPlugin.tsx:211` }
  return { panel: 'MentionPlugin', source: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:158-162` }
}

/** 历史导航回填时不得重开面板（否则 CRITICAL 方向键处理器会吞掉历史翻阅键）。 */
export const HISTORY_NAVIGATION_UPDATE_TAG = 'zcode-history-navigation'
export const PROGRAMMATIC_UPDATE_TAG = 'zcode-programmatic'

export function shouldPromptMenuProcessUpdate(tags: ReadonlySet<string>): boolean {
  return !tags.has(HISTORY_NAVIGATION_UPDATE_TAG)
}

// ── @ 上下文来源 ──────────────────────────────────────────────────────────
// 出处：mentions/mentionPanelRouting.ts（顺序）+ mentions/MentionPlugin.tsx（挂载）+ 各 provider。

export type PromptMenuCategory = 'files' | 'skills' | 'commands' | 'subagents' | 'whiteboards' | 'sessions' | 'plugins'

/** @ 面板分组顺序：Plugin → 文件 → 对话 → 画板（mentionPanelRouting.ts:6-11,19-32）。 */
export const CONTEXT_GROUP_ORDER = ['plugins', 'files', 'sessions', 'whiteboards'] as const
export const SESSION_GROUP_ORDER = ['sessions'] as const
export const SKILL_GROUP_ORDER = ['skills'] as const

export type PromptMenuGroupId = (typeof CONTEXT_GROUP_ORDER)[number] | 'skills'

/** 触发词 → 分组顺序；未识别的触发词给空数组（不出面板）。 */
export function promptMenuGroupOrder(trigger: PromptMenuTrigger | null | undefined): readonly PromptMenuGroupId[] {
  if (trigger === '@') return CONTEXT_GROUP_ORDER
  if (trigger === '#') return SESSION_GROUP_ORDER
  if (trigger === '$') return SKILL_GROUP_ORDER
  return []
}

export type SessionMentionWorkspaceScope = 'current-workspace' | 'same-authority-workspaces'

/** `#` 才扩到同 authority 的 workspace；`@` 只搜当前 workspace。 */
export function sessionMentionWorkspaceScope(trigger: PromptMenuTrigger | null | undefined): SessionMentionWorkspaceScope {
  return trigger === '#' ? 'same-authority-workspaces' : 'current-workspace'
}

export interface ContextMenuSource {
  readonly id: PromptMenuGroupId
  readonly category: PromptMenuCategory
  /** item id 前缀（provider 里写死）。 */
  readonly idPrefix: string
  /** 哪些触发词会启用这一组。 */
  readonly enabledFor: readonly PromptMenuTrigger[]
  /** 分组标题 / 空态文案键。 */
  readonly titleKey: string
  readonly emptyKey: string
  /** 面板行图标（ZCode 用的图标组件名）+ 出处。 */
  readonly icon: string
  readonly iconSource: string
  /** provider（数据来源）出处 + canonical markdown 构造出处。 */
  readonly providerSource: string
  readonly markdownSource: string
  /** 额外启用条件。 */
  readonly extraCondition?: string
}

export const CONTEXT_MENU_SOURCES: readonly ContextMenuSource[] = [
  { id: 'plugins', category: 'plugins', idPrefix: 'plugin:', enabledFor: ['@'],
    titleKey: 'chat.mention.plugins.title', emptyKey: 'chat.mention.plugins.empty',
    icon: 'PluginIcon', iconSource: `${ZCODE_UI_SRC}/mentions/components/PluginMentionOptionContent.tsx:7`,
    providerSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:212-220`, markdownSource: `${ZCODE_UI_SRC}/mentions/mentionMarkdown.ts:90` },
  { id: 'files', category: 'files', idPrefix: 'file:', enabledFor: ['@'],
    titleKey: 'chat.mention.files.title', emptyKey: 'chat.mention.files.empty',
    icon: 'FileDisplayInline（按 file/directory 取图标）', iconSource: `${ZCODE_UI_SRC}/mentions/components/ContextMentionOptionContent.tsx:12-25`,
    providerSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:183-191`, markdownSource: `${ZCODE_UI_SRC}/mentions/mentionMarkdown.ts:59` },
  { id: 'sessions', category: 'sessions', idPrefix: 'session:', enabledFor: ['@', '#'],
    titleKey: 'chat.mention.sessions.title', emptyKey: 'chat.mention.sessions.empty',
    icon: 'MessagesSquare', iconSource: `${ZCODE_UI_SRC}/mentions/components/ContextMentionOptionContent.tsx:28`,
    providerSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:200-209`, markdownSource: `${ZCODE_UI_SRC}/mentions/mentionMarkdown.ts:80` },
  { id: 'whiteboards', category: 'whiteboards', idPrefix: 'whiteboard:', enabledFor: ['@'],
    titleKey: 'chat.mention.whiteboards.title', emptyKey: 'chat.mention.whiteboards.empty',
    icon: 'PaletteIcon', iconSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:333`,
    providerSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:192-199`, markdownSource: `${ZCODE_UI_SRC}/mentions/providers/whiteboardMentionProvider.ts:16`,
    extraCondition: '仅当宿主提供 onWhiteboardMentionSelected' },
  { id: 'skills', category: 'skills', idPrefix: 'skill:', enabledFor: ['$'],
    titleKey: 'chat.mention.skills.title', emptyKey: 'chat.mention.skills.empty',
    icon: 'WandSparkles', iconSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:323`,
    providerSource: `${ZCODE_UI_SRC}/mentions/MentionPlugin.tsx:169-179`, markdownSource: `${ZCODE_UI_SRC}/mentions/mentionMarkdown.ts:68` },
]

/** 面板打开时的描述行（无 query 才显示）：`#`/`$` 各有专属提示，其余走通用。 */
export function mentionPanelSearchHintKey(trigger: PromptMenuTrigger | null | undefined): string {
  if (trigger === '#') return 'chat.mention.sessions.searchHint'
  if (trigger === '$') return 'chat.mention.skills.searchHint'
  return 'chat.mention.searchHint'
}

/** 提及类 chip 图标（Lexical 节点内自绘 SVG）；files 走 fileDisplay，不在此表。 */
export const MENTION_CHIP_ICONS: Readonly<Record<string, string>> = {
  skills: 'SKILL_MENTION_ICON_NODE', subagents: 'SUBAGENT_MENTION_ICON_NODE',
  whiteboards: 'WHITEBOARD_MENTION_ICON_NODE', commands: 'COMMAND_MENTION_ICON_NODE',
  sessions: 'SESSION_MENTION_ICON_NODE', plugins: 'PLUGIN_MENTION_ICON_NODE',
}
export const MENTION_CHIP_ICONS_SOURCE = `${ZCODE_UI_SRC}/mentions/nodes/mentionIconDom.ts:12-94`

// ── 「添加」面板（`+`）────────────────────────────────────────────────────
// 出处：prompt-editor/ChatPromptActionMenu.tsx。它不是打字触发，是按钮菜单。

export type ActionMenuQuickCommand = 'goal' | 'workflow'

export interface ActionMenuQuickCommandSpec {
  readonly id: string
  readonly labelKey: string
  readonly icon: string
}

export const ACTION_MENU_QUICK_COMMANDS: Readonly<Record<ActionMenuQuickCommand, ActionMenuQuickCommandSpec>> = {
  goal: { id: 'add-goal', labelKey: 'chat.goalBanner.label', icon: 'GoalIcon' },
  workflow: { id: 'add-workflow', labelKey: 'chat.composer.addWorkflow', icon: 'Workflow' },
}

/** 面板底部三个触发词提示（`+` 菜单里列出来的）。 */
export const ACTION_MENU_FOOTER_TRIGGERS: readonly { readonly trigger: string; readonly labelKey: string }[] = [
  { trigger: '@', labelKey: 'chat.composer.contextShortcut' },
  { trigger: '/', labelKey: 'chat.composer.capabilityShortcut' },
  { trigger: '$', labelKey: 'chat.composer.skillShortcut' },
]

/**
 * 快捷命令的可用性：只在**严格空草稿**提供（两条命令都只在消息开头展开）。
 * goal 还要求是新建草稿（会话级目标）；workflow 还要求 CLI catalog 里有它。
 */
export function actionMenuQuickCommands(options: {
  readonly emptyDraft: boolean
  readonly sessionId: string | null
  readonly slashCommandNames: readonly string[]
  readonly excludedNames?: readonly string[]
}): readonly ActionMenuQuickCommand[] {
  const offered = (command: ActionMenuQuickCommand, available: boolean): boolean =>
    options.emptyDraft && available && !options.excludedNames?.includes(command)
  const hasWorkflow = options.slashCommandNames.some(name => normalizeSlashCommandValue(name) === 'workflow')
  return [
    ...(offered('goal', options.sessionId === null) ? (['goal'] as const) : []),
    ...(offered('workflow', hasWorkflow) ? (['workflow'] as const) : []),
  ]
}

/** `+` 菜单的扁平索引 → 落点（附件固定占第 0 位）。 */
export function actionMenuSelectTarget(
  index: number,
  options: { readonly hasAttachment: boolean; readonly quickCommands: readonly ActionMenuQuickCommand[]; readonly mentionItemCount: number },
): { readonly kind: 'attachment' } | { readonly kind: 'command'; readonly command: ActionMenuQuickCommand } | { readonly kind: 'mention'; readonly itemIndex: number } | null {
  const attachmentCount = options.hasAttachment ? 1 : 0
  if (options.hasAttachment && index === 0) return { kind: 'attachment' }
  const command = options.quickCommands[index - attachmentCount]
  if (command) return { kind: 'command', command }
  const itemIndex = index - attachmentCount - options.quickCommands.length
  if (itemIndex < 0 || itemIndex >= options.mentionItemCount) return null
  return { kind: 'mention', itemIndex }
}

// ── 菜单项 / 分组形状 ─────────────────────────────────────────────────────
// 出处：mentions/components/MentionPanel.tsx:20-40（形状）、:83-132（行序）、:74-76（行高）。

export interface PromptMenuOption {
  readonly id: string
  readonly label: string
  readonly description: string
  /** 面板行的自定义渲染内容（图标 + 主文案 + 弱信息）。 */
  readonly content?: unknown
  readonly meta?: unknown
  readonly disabled?: boolean
  readonly disabledReason?: string
}

export interface PromptMenuSection {
  readonly id: string
  readonly title: string
  readonly options: readonly PromptMenuOption[]
  readonly emptyText: string
  readonly loadingText?: string
  readonly loading?: boolean
  readonly errorText?: string | null
}

/** 虚拟行高（px）：选项 34 / 状态 40 / 分组标题 34。 */
export const MENU_PANEL_METRICS = { option: 34, status: 40, sectionHeader: 34 } as const

/** 选项 / 分组字段全集（照 MentionPanelOption 与 MentionPanelSection）。 */
export const MENU_OPTION_FIELDS = ['id', 'label', 'description', 'content', 'meta', 'disabled', 'disabledReason'] as const
export const MENU_SECTION_FIELDS = ['id', 'title', 'options', 'emptyText', 'loadingText', 'loading', 'errorText'] as const

export type PromptMenuRow =
  | { readonly kind: 'section-header'; readonly sectionId: string; readonly title: string }
  | { readonly kind: 'status'; readonly sectionId: string; readonly content: 'error' | 'loading' | 'empty'; readonly text: string }
  | { readonly kind: 'option'; readonly sectionId: string; readonly option: PromptMenuOption; readonly flatOptionIndex: number }

/**
 * 扁平行序（键盘索引 = option 行的 flatOptionIndex，且只数**真的渲染出来**的选项）。
 * 分组标题只在多于一个分组且标题非空时插入。
 */
export function buildPromptMenuRows(sections: readonly PromptMenuSection[]): readonly PromptMenuRow[] {
  const rows: PromptMenuRow[] = []
  let flatOptionIndex = 0
  const shouldRenderSectionHeader = sections.length > 1

  for (const section of sections) {
    if (shouldRenderSectionHeader && section.title.trim().length > 0) {
      rows.push({ kind: 'section-header', sectionId: section.id, title: section.title })
    }
    if (section.errorText) {
      rows.push({ kind: 'status', sectionId: section.id, content: 'error', text: section.errorText })
    } else if (section.loading) {
      rows.push({ kind: 'status', sectionId: section.id, content: 'loading', text: section.loadingText ?? section.emptyText })
    } else if (section.options.length === 0) {
      rows.push({ kind: 'status', sectionId: section.id, content: 'empty', text: section.emptyText })
    } else {
      for (const option of section.options) {
        rows.push({ kind: 'option', sectionId: section.id, option, flatOptionIndex })
        flatOptionIndex += 1
      }
    }
  }
  return rows
}

/** 只留「有内容 / 在加载 / 出错」的分组（mentionSearch.ts:37-43）。 */
export function visiblePromptMenuSections<T extends { readonly loading: boolean; readonly errorText: string | null; readonly options: readonly unknown[] }>(
  sections: readonly T[],
): readonly T[] {
  return sections.filter(section => section.loading || section.errorText !== null || section.options.length > 0)
}

/** 面板标题/描述/空态三者的显隐（MentionPanel.tsx:308-319）。 */
export function promptMenuChrome(input: {
  readonly hasActiveQuery: boolean
  readonly hasFooter: boolean
  readonly hasDescription: boolean
  readonly hasEmptyText: boolean
}): { readonly showEmptyText: boolean; readonly showFooter: boolean; readonly showDescription: boolean } {
  return {
    showEmptyText: input.hasActiveQuery && input.hasEmptyText,
    showFooter: !input.hasActiveQuery && input.hasFooter,
    showDescription: !input.hasActiveQuery && input.hasDescription,
  }
}

// ── 键盘导航 ──────────────────────────────────────────────────────────────
// 出处：mentions/MentionPlugin.tsx:70-120,592-691（循环 + 跳禁选）、
//       SlashCommandPlugin.tsx:330-358（夹紧，不循环）。

/** 循环取模：上键从第一项跳到末项。 */
export function wrappedMenuIndex(currentIndex: number, delta: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return (currentIndex + delta + itemCount) % itemCount
}

/** 循环基础上跳过禁选项；全禁时原地不动（Enter/Tab 的选择守卫会拒绝插入）。 */
export function nextEnabledMenuIndex(
  currentIndex: number,
  delta: number,
  items: readonly { readonly disabled?: boolean }[],
): number {
  if (items.length === 0) return 0
  let next = wrappedMenuIndex(currentIndex, delta, items.length)
  for (let step = 0; step < items.length; step++) {
    if (!items[next]?.disabled) return next
    next = wrappedMenuIndex(next, delta >= 0 ? 1 : -1, items.length)
  }
  return currentIndex
}

/** 候选更新后把选中收敛到可选条目（冲突 Plugin 可能占住第 0 位）。 */
export function coerceEnabledMenuIndex(currentIndex: number, items: readonly { readonly disabled?: boolean }[]): number {
  if (items.length === 0) return 0
  const boundedIndex = Math.min(Math.max(currentIndex, 0), items.length - 1)
  if (!items[boundedIndex]?.disabled) return boundedIndex
  const firstEnabledIndex = items.findIndex(item => !item.disabled)
  return firstEnabledIndex >= 0 ? firstEnabledIndex : boundedIndex
}

/** `/` 面板方向键：夹紧到 [0, len-1]，不循环。 */
export function clampedMenuIndex(currentIndex: number, delta: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(currentIndex + delta, 0), itemCount - 1)
}

/** `/` 面板候选变短后把选中夹回范围内。 */
export function clampMenuIndexToLength(currentIndex: number, itemCount: number): number {
  if (itemCount === 0) return 0
  return Math.min(currentIndex, itemCount - 1)
}

/** 三个面板各自认的确认键（`+` 菜单多认空格）。 */
export const MENU_SELECT_KEYS: Readonly<Record<'mention' | 'slash' | 'action', readonly string[]>> = {
  mention: ['Enter', 'Tab'],
  slash: ['Enter', 'Tab'],
  action: ['Enter', 'Tab', ' '],
}

// ── 候选过滤 ──────────────────────────────────────────────────────────────
// 两套打分形状不同，别混用：
//   · @ 面板 → mentions/mentionSearch.ts:49-88,150-195（中文 query 不做子序列）
//   · / 面板 → lib/promptInputTriggers.ts:52-87,182-229（无中文特例）

export const MENTION_DISPLAY_CAP = 1000
export const MENTION_DEFAULT_GROUP_PREVIEW_LIMIT = 3
export const MENTION_FILES_ONLY_DEFAULT_PREVIEW_LIMIT = 10

export const HAN_QUERY_RE = /\p{Script=Han}/u

export function hasPromptMenuQuery(query: string): boolean {
  return query.trim().length > 0
}

/** 空 query 给分组预览条数；有 query 时不设组内上限。 */
export function mentionGroupLimitForQuery(query: string, defaultLimit = MENTION_DEFAULT_GROUP_PREVIEW_LIMIT): number | undefined {
  return hasPromptMenuQuery(query) ? undefined : defaultLimit
}

/**
 * 提及候选打分。`cjkSubsequence: true` 时中文 query 只走前缀/子串两级
 * （逐字符子序列对 CJK 过宽：「浏器」会命中「浏览器操作」）。
 */
export function scoreMentionFuzzy(text: string, query: string, cjkSubsequence = false): number | null {
  const normalizedText = text.trim().toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedText) return null
  if (!normalizedQuery) return 0
  if (normalizedText.startsWith(normalizedQuery)) return normalizedText.length - normalizedQuery.length

  const substringIndex = normalizedText.indexOf(normalizedQuery)
  if (substringIndex !== -1) return 100 + substringIndex

  if (cjkSubsequence && HAN_QUERY_RE.test(normalizedQuery)) return null

  let score = 200
  let searchStart = 0
  for (const char of normalizedQuery) {
    const foundIndex = normalizedText.indexOf(char, searchStart)
    if (foundIndex === -1) return null
    score += foundIndex - searchStart
    searchStart = foundIndex + 1
  }
  return score + (normalizedText.length - normalizedQuery.length)
}

/** `@` 面板的候选（mentions/mentionTypes.ts:24-43 的 MentionItem 子集）。 */
export interface PromptMenuItem {
  readonly id: string
  readonly category: PromptMenuCategory
  readonly label: string
  readonly description: string
  readonly value: string
  readonly markdown: string
  readonly keywords?: readonly string[]
  readonly data?: {
    readonly kind?: 'file' | 'directory' | 'whiteboard'
    readonly path?: string
    readonly relativePath?: string
    readonly boardId?: string
    readonly scope?: 'built-in' | 'workspace' | 'user' | 'plugin'
    readonly source?: 'built-in' | 'user' | 'plugin'
    readonly model?: string
    readonly pluginId?: string
    readonly icon?: string
  }
  readonly displayLabel?: string
  readonly disabled?: boolean
  readonly disabledReason?: string
}

/** `/` 面板的候选（lib/promptInputTriggers.ts:14-27 的 PromptInputSuggestionItem）。 */
export interface PromptMenuSuggestion {
  readonly id: string
  readonly trigger: PromptMenuTrigger
  readonly value: string
  readonly label: string
  readonly description: string
  readonly keywords?: readonly string[]
  readonly data?: {
    readonly path?: string
    readonly scope?: 'built-in' | 'workspace' | 'user' | 'plugin'
    readonly source?: 'built-in' | 'user' | 'plugin'
    readonly model?: string
  }
}

/** 空 query 时的默认优先级：文件在文件夹之前，其余按原序（稳定）。 */
function defaultMentionPriority(item: PromptMenuItem): number {
  if (item.category !== 'files') return 0
  return item.data?.kind === 'directory' ? 1 : 0
}

function sortDefaultMentionItems(items: readonly PromptMenuItem[]): PromptMenuItem[] {
  return items
    .map((item, index) => ({ index, item, priority: defaultMentionPriority(item) }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(entry => entry.item)
}

function applyMentionItemLimit(items: readonly PromptMenuItem[], limit?: number): PromptMenuItem[] {
  if (!Number.isFinite(limit)) return [...items]
  return items.slice(0, Math.max(0, Math.trunc(limit ?? 0)))
}

/** 提及打分权重：label 基准 / value +25 / description +100（plugins 不参与）/ keywords +300。 */
export function scorePromptMenuItem(item: PromptMenuItem, query: string): number | null {
  const labelScore = scoreMentionFuzzy(item.label, query, true)
  const descriptionScore = item.category === 'plugins' ? null : scoreMentionFuzzy(item.description, query, true)
  const valueScore = scoreMentionFuzzy(item.value, query, true)
  const keywordScore = Math.min(
    ...(item.keywords ?? []).map(keyword => {
      const score = scoreMentionFuzzy(keyword, query, true)
      return score === null ? Number.POSITIVE_INFINITY : score + 300
    }),
    Number.POSITIVE_INFINITY,
  )
  const bestScore = Math.min(
    labelScore ?? Number.POSITIVE_INFINITY,
    valueScore !== null ? valueScore + 25 : Number.POSITIVE_INFINITY,
    descriptionScore !== null ? descriptionScore + 100 : Number.POSITIVE_INFINITY,
    keywordScore,
  )
  return Number.isFinite(bestScore) ? bestScore : null
}

/**
 * `@` 面板过滤。空 query：requireQuery 为真给空表，否则按默认优先级排序后截断。
 * 有 query：按分数排序（同分比原序，再比 label localeCompare）后截断。
 */
export function filterMentionMenuItems(
  items: readonly PromptMenuItem[],
  query: string,
  options: { readonly limit?: number; readonly requireQuery?: boolean } = {},
): readonly PromptMenuItem[] {
  const effectiveLimit = options.limit ?? MENTION_DISPLAY_CAP
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return options.requireQuery ? [] : applyMentionItemLimit(sortDefaultMentionItems(items), effectiveLimit)
  }

  const scored = items
    .map((item, index) => ({ index, item, score: scorePromptMenuItem(item, normalizedQuery) }))
    .filter((entry): entry is { index: number; item: PromptMenuItem; score: number } => entry.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      if (left.index !== right.index) return left.index - right.index
      return left.item.label.localeCompare(right.item.label)
    })
    .map(entry => entry.item)

  return applyMentionItemLimit(scored, effectiveLimit)
}

/** `/` 面板打分权重：value 基准 / label +50 / description +250 / keywords +450。 */
export function scorePromptMenuSuggestion(suggestion: PromptMenuSuggestion, query: string): number | null {
  const valueScore = scoreMentionFuzzy(suggestion.value, query)
  const labelScore = scoreMentionFuzzy(suggestion.label, query)
  const descriptionScore = scoreMentionFuzzy(suggestion.description, query)
  const keywordScore = Math.min(
    ...(suggestion.keywords ?? []).map(keyword => {
      const score = scoreMentionFuzzy(keyword, query)
      return score === null ? Number.POSITIVE_INFINITY : score + 450
    }),
    Number.POSITIVE_INFINITY,
  )
  const bestScore = Math.min(
    valueScore ?? Number.POSITIVE_INFINITY,
    labelScore !== null ? labelScore + 50 : Number.POSITIVE_INFINITY,
    descriptionScore !== null ? descriptionScore + 250 : Number.POSITIVE_INFINITY,
    keywordScore,
  )
  return Number.isFinite(bestScore) ? bestScore : null
}

/** `/` 面板过滤。query 为 null（无触发词）给空表；空串给全表（顺序不变）。 */
export function filterPromptMenuSuggestions(
  suggestions: readonly PromptMenuSuggestion[],
  query: string | null,
): readonly PromptMenuSuggestion[] {
  if (query === null) return []
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...suggestions]

  return suggestions
    .map((suggestion, index) => ({ index, suggestion, score: scorePromptMenuSuggestion(suggestion, normalizedQuery) }))
    .filter((entry): entry is { index: number; suggestion: PromptMenuSuggestion; score: number } => entry.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      if (left.index !== right.index) return left.index - right.index
      return left.suggestion.label.localeCompare(right.suggestion.label)
    })
    .map(entry => entry.suggestion)
}

/** 默认选中项：全局最高分（分组展示顺序不变），空 query 落第 0 项。 */
export function bestPromptMenuSuggestionIndex(suggestions: readonly PromptMenuSuggestion[], query: string | null): number {
  const normalizedQuery = query?.trim().toLowerCase() ?? ''
  if (!normalizedQuery) return 0

  let bestIndex = 0
  let bestScore = Number.POSITIVE_INFINITY
  suggestions.forEach((suggestion, index) => {
    const score = scorePromptMenuSuggestion(suggestion, normalizedQuery)
    if (score === null) return
    if (score < bestScore) {
      bestScore = score
      bestIndex = index
    }
  })
  return bestIndex
}

/** `/` 命令值归一：远端可能直接返回 `/init`，去掉前导斜杠避免插入成 `//init`。 */
export function normalizeSlashCommandValue(name: string): string {
  return name.trim().replace(/^\/+/, '')
}

export const APP_SLASH_SUGGESTION_ID_PREFIX = 'app-slash:'

/** App 层命令「选中即执行」：只移除输入里的 `/xxx` token，不插入 mention、不发送。 */
export function isAppSlashCommandSuggestion(suggestion: PromptMenuSuggestion): boolean {
  return suggestion.id.startsWith(APP_SLASH_SUGGESTION_ID_PREFIX)
}

// ── 选中后的插入语义 ──────────────────────────────────────────────────────
// 出处：SlashCommandPlugin.tsx:246-310、mentions/MentionPlugin.tsx:455-573、
//       lib/slashApplyMentionPayload.ts:10-46、mentions/mentionMarkdown.ts:59-92、
//       LexicalChatInput.tsx:1231-1256（插入节点 + 一个尾随空格）。

/** 插入后固定补一个空格并把光标落到其后。 */
export const PROMPT_MENU_INSERT_TRAILING_TEXT = ' '

export interface PromptMentionPayload {
  readonly id: string
  readonly category: PromptMenuCategory
  readonly label: string
  readonly value: string
  readonly markdown: string
  readonly description?: string
  readonly data?: PromptMenuItem['data']
}

export type PromptMenuInsertionPlan =
  | { readonly kind: 'mention'; readonly payload: PromptMentionPayload; readonly trailingText: string }
  | { readonly kind: 'remove-only' }
  | null

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

function escapeMarkdownDestination(destination: string): string {
  return destination.replaceAll('\\', '\\\\').replaceAll('>', '\\>')
}

/** 裸路径会被渲染层当成自定义协议，补成 `./` 明确相对路径。 */
function normalizeMarkdownDestination(destination: string): string {
  if (
    destination.startsWith('/') || destination.startsWith('./') || destination.startsWith('../') ||
    destination.startsWith('#') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(destination)
  ) {
    return destination
  }
  return `./${destination}`
}

/** 文件/文件夹：`[basename](./relative/path)`，目录目标以斜杠结尾。 */
export function buildFileMentionMarkdown(relativePath: string, label: string, kind: 'file' | 'directory' = 'file'): string {
  const trimmed = relativePath.trim()
  const normalized = kind === 'directory' ? `${trimmed.replace(/[\\/]+$/, '')}/` : trimmed
  return `[${escapeMarkdownLabel(label)}](${escapeMarkdownDestination(normalizeMarkdownDestination(normalized))})`
}

/** 技能：无路径时裸 `$name`，有路径时 `[$name](path)`。 */
export function buildSkillMentionMarkdown(label: string, skillPath?: string): string {
  if (!skillPath) return `$${label}`
  return `[${escapeMarkdownLabel(`$${label}`)}](${escapeMarkdownDestination(normalizeMarkdownDestination(skillPath))})`
}

/** 子智能体：裸 `@name`。 */
export function buildSubagentMentionMarkdown(label: string): string {
  return `@${label}`
}

/** 会话：`#sess_xxx`，有可读标题时 `[#title](#sess_xxx)`。 */
export function buildSessionMentionMarkdown(sessionId: string, label?: string): string {
  const trimmedLabel = label?.trim()
  if (!trimmedLabel || trimmedLabel === sessionId) return `#${sessionId}`
  return `[${escapeMarkdownLabel(`#${trimmedLabel}`)}](#${escapeMarkdownDestination(sessionId)})`
}

/** 插件：`[@Label](plugin://stable-id)`，身份只在 destination。 */
export function buildPluginMentionMarkdown(label: string, pluginId: string): string {
  return `[${escapeMarkdownLabel(`@${label}`)}](plugin://${escapeMarkdownDestination(pluginId)})`
}

/**
 * `/` 面板选中项的 mention 载荷：skill / subagent 复用 `$skill` 与 `@agent` 语义，
 * 其余按命令插 `/value`。
 */
export function slashApplyMentionPayload(suggestion: PromptMenuSuggestion): PromptMentionPayload {
  if (suggestion.id.startsWith('skill:')) {
    return {
      id: suggestion.id, category: 'skills', label: suggestion.value, value: suggestion.value,
      markdown: buildSkillMentionMarkdown(suggestion.value, suggestion.data?.path),
      description: suggestion.description, data: suggestion.data,
    }
  }
  if (suggestion.id.startsWith('subagent:')) {
    return {
      id: suggestion.id, category: 'subagents', label: suggestion.value, value: suggestion.value,
      markdown: buildSubagentMentionMarkdown(suggestion.value),
      description: suggestion.description, data: suggestion.data,
    }
  }
  const commandValue = normalizeSlashCommandValue(suggestion.value)
  return {
    id: suggestion.id, category: 'commands', label: commandValue, value: commandValue,
    markdown: `/${commandValue}`, description: suggestion.description,
  }
}

/** `/` 面板选中后的计划：App 命令只删 token；其余插 mention + 尾随空格。 */
export function promptMenuInsertionForSuggestion(suggestion: PromptMenuSuggestion): PromptMenuInsertionPlan {
  if (isAppSlashCommandSuggestion(suggestion)) return { kind: 'remove-only' }
  return { kind: 'mention', payload: slashApplyMentionPayload(suggestion), trailingText: PROMPT_MENU_INSERT_TRAILING_TEXT }
}

/** `@` 面板选中后的计划：画板走宿主回调（只删 token）；其余插 mention + 尾随空格。 */
export function promptMenuInsertionForMentionItem(
  item: PromptMenuItem,
  options: { readonly onWhiteboardMentionSelected?: boolean } = {},
): PromptMenuInsertionPlan {
  if (item.category === 'whiteboards' && options.onWhiteboardMentionSelected) return { kind: 'remove-only' }
  return {
    kind: 'mention',
    payload: {
      id: item.id, category: item.category, label: item.label, value: item.value,
      markdown: item.markdown, description: item.description, data: item.data,
    },
    trailingText: PROMPT_MENU_INSERT_TRAILING_TEXT,
  }
}

/** 显示名：从 markdown 链接里取可读 label，再按分类剥掉前导触发符。 */
export function normalizePromptMentionDisplayLabel(category: PromptMenuCategory, label: string, value: string): string {
  const matched = /^\[((?:\\.|[^\\\]])*)\]\((?:<((?:\\.|[^>])*?)>|((?:\\.|[^)])*))\)$/.exec(label.trim())
  let displayLabel = matched?.[1] ? matched[1].replace(/\\(.)/g, '$1') : label

  if (category === 'skills' && displayLabel.startsWith('$')) displayLabel = displayLabel.slice(1)
  else if (category === 'sessions' && displayLabel.startsWith('#')) displayLabel = displayLabel.slice(1)
  else if ((category === 'files' || category === 'subagents' || category === 'whiteboards' || category === 'plugins') && displayLabel.startsWith('@')) {
    displayLabel = displayLabel.slice(1)
  }
  return displayLabel.trim() || value
}

// ── 无法核实 ──────────────────────────────────────────────────────────────

export interface PromptMenuUnverifiable {
  readonly what: string
  readonly why: string
}

export const PROMPT_MENU_UNVERIFIABLE: readonly PromptMenuUnverifiable[] = [
  { what: 'chat.mention.back / selectItem / searching / category.empty / category.files(+.description/.searching) / category.results',
    why: 'zh-CN.ts:5449-5459 有条目，但 ui/src 排除 locales 后零消费方 —— 不是本仓可见交互面的一部分' },
  { what: 'chat.mention.subagents.title / chat.mention.subagents.empty',
    why: 'zh-CN.ts:5465-5466 有条目，零消费方；子智能体只在 / 面板出现（读的是 chat.slash.subagents.*）' },
  { what: 'chat.composer.insertMentionShortcut / insertSessionShortcut / insertSlashShortcut / insertSkillShortcut',
    why: 'zh-CN.ts:5441-5444 四条都在，但全树（apps/ + packages/，排除 locales）零消费方；占位符文案实际读的是 chat.placeholder.newTask（:4264）' },
  { what: 'chat.command.* / chat.context*（菜单相关）',
    why: 'zh-CN.ts 里没有 chat.command. 前缀的键；chat.context* 只有 contextUsage / contextOptimization / contextCompaction 三族，与提示菜单无关' },
  { what: 'ZCode 用 Tailwind 尺寸类（size-4 / size-3.5 / h-8）到本仓 iconSize.* 的映射',
    why: '两边不是同一套度量，映射属本仓设计决定，不是 ZCode 事实' },
  { what: '各元素在本仓 AgentPanel.vue 的落点组件',
    why: '属接线说明（见回复），不是 ZCode 事实；本模块只描述 ZCode 的交互规则' },
]
