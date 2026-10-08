// ZCode 输入区 / 工具条「可见结构」表（纯数据，零 Vue / 零 DOM / 零 import）。
//
// 事实来源：.tools/ZCode 源码树。每条元素给 文件:行号。
// 文案：只收 i18n/locales/zh-CN.ts 里**真的有消费方**的键（键:值 逐条核）。
// 判据：tests/agent-composer-layout.test.mjs —— 逐条断言本文件与 ZCode 源码/词条一致。
//
// 用法（主代理照此改 AgentPanel.vue 模板）：按 TOOLBAR_ROWS 的分区与顺序渲染，
// 每个 elementId 到 COMPOSER_ELEMENTS 取 kind / labelKey / iconGroups / visibleWhen / disabledWhen。
//
// 为什么现在零生产消费方（find-orphan-modules --gate）：本模块是**交付给主代理的接线数据**，
// 派单明确「禁止改任何已有文件」（AgentPanel.vue 由主代理独占）。主代理照本表改
// AgentPanel.vue 模板后即获得生产消费方；在那之前只有 tests/agent-composer-layout.test.mjs 引用它。

/** ZCode UI 源码根（相对仓库根）。 */
export const ZCODE_UI_SRC = '.tools/ZCode/packages/ui/src'

/** zh-CN 词条文件（相对仓库根），判据用它反查每条文案。 */
export const ZCODE_LOCALE_FILE = `${ZCODE_UI_SRC}/i18n/locales/zh-CN.ts`

/** ZCode 共享包源码根（test-id 常量、命令表在这里）。 */
export const ZCODE_SHARED_SRC = '.tools/ZCode/packages/shared/src'

// ── 词条表 ───────────────────────────────────────────────────────────────
// at = 该键在 zh-CN.ts 的行号（多行值给首行）。

export interface ComposerTextEntry {
  readonly key: string
  readonly zh: string
  readonly at: string
  /** 动态键前缀：消费方是模板串 `${prefix}${...}` 而不是字面量键。字面量消费时为 undefined。 */
  readonly dynamicPrefix?: string
}

export const COMPOSER_TEXTS: readonly ComposerTextEntry[] = [
  // 输入框 placeholder（lib/chatPlaceholder.ts:1-5 定义键域）
  { key: 'chat.placeholder.newTask', zh: '向 ZCode 提问，使用 @ 添加上下文，使用 / 选择命令或能力', at: `${ZCODE_LOCALE_FILE}:4264` },
  { key: 'chat.placeholder.newTaskMobile', zh: '向 ZCode 提问…', at: `${ZCODE_LOCALE_FILE}:4265` },
  { key: 'chat.placeholder.followUpAsk', zh: '提出后续修改要求', at: `${ZCODE_LOCALE_FILE}:4266` },
  { key: 'chat.placeholder.followUpQueue', zh: '继续输入以排队后续修改', at: `${ZCODE_LOCALE_FILE}:4267` },

  // 发送 / 停止
  { key: 'chat.send', zh: '发送', at: `${ZCODE_LOCALE_FILE}:4271` },
  { key: 'chat.queue.enqueue', zh: '加入队列', at: `${ZCODE_LOCALE_FILE}:4341` },
  { key: 'chat.stop', zh: '停止生成', at: `${ZCODE_LOCALE_FILE}:4330` },

  // 添加上下文（+ 菜单）
  { key: 'chat.composer.actionMenu', zh: '添加上下文', at: `${ZCODE_LOCALE_FILE}:5440` },
  { key: 'chat.composer.attachment', zh: '附件', at: `${ZCODE_LOCALE_FILE}:147` },
  { key: 'chat.composer.addSection', zh: '添加', at: `${ZCODE_LOCALE_FILE}:145` },
  { key: 'chat.composer.addWorkflow', zh: '工作流', at: `${ZCODE_LOCALE_FILE}:146` },
  { key: 'chat.goalBanner.label', zh: '目标', at: `${ZCODE_LOCALE_FILE}:4438` },
  { key: 'chat.composer.contextShortcut', zh: '添加上下文', at: `${ZCODE_LOCALE_FILE}:142` },
  { key: 'chat.composer.capabilityShortcut', zh: '选择能力', at: `${ZCODE_LOCALE_FILE}:143` },
  { key: 'chat.composer.skillShortcut', zh: '选择技能', at: `${ZCODE_LOCALE_FILE}:144` },
  { key: 'chat.composer.contextSearchHint', zh: '输入内容以搜索插件、文件和对话', at: `${ZCODE_LOCALE_FILE}:141` },

  // 上下文用量（context usage）
  { key: 'chat.contextUsage', zh: '上下文已用 {used} / 总量 {total}', at: `${ZCODE_LOCALE_FILE}:4373` },
  { key: 'chat.contextUsage.title', zh: '上下文容量', at: `${ZCODE_LOCALE_FILE}:4374` },
  { key: 'sidebar.usage.plan.title', zh: '剩余额度', at: `${ZCODE_LOCALE_FILE}:3312` },
  { key: 'settings.modelProvider.startPlan.balance.title', zh: '今日余额', at: `${ZCODE_LOCALE_FILE}:2636` },

  // 模型选择
  { key: 'chat.toolbar.model.label', zh: '选择模型', at: `${ZCODE_LOCALE_FILE}:4502` },
  { key: 'chat.toolbar.model.manageModels', zh: '管理模型', at: `${ZCODE_LOCALE_FILE}:4505` },
  { key: 'chat.toolbar.model.loadFailedRetry', zh: '模型加载失败，重试', at: `${ZCODE_LOCALE_FILE}:965` },
  { key: 'chat.toolbar.model.remoteWaiting', zh: '等待远程模型', at: `${ZCODE_LOCALE_FILE}:966` },
  { key: 'chat.toolbar.model.targetMissing', zh: '暂无模型目标', at: `${ZCODE_LOCALE_FILE}:967` },
  { key: 'chat.toolbar.modelSwitch.lockedByRunningTask', zh: '当前有任务运行中，完成后可切换模型供应商。', at: `${ZCODE_LOCALE_FILE}:4514` },

  // 思考档位
  { key: 'chat.toolbar.thoughtLevel.tooltip', zh: '思考级别', at: `${ZCODE_LOCALE_FILE}:4544` },
  { key: 'chat.toolbar.thoughtLevel.placeholder', zh: '选择思考档位', at: `${ZCODE_LOCALE_FILE}:4545` },
  { key: 'chat.toolbar.thoughtLevel.value.off', zh: '关闭', at: `${ZCODE_LOCALE_FILE}:4548` },
  { key: 'chat.toolbar.thoughtLevel.value.on', zh: '开启', at: `${ZCODE_LOCALE_FILE}:4549` },
  { key: 'chat.toolbar.thoughtLevel.value.minimal', zh: '极低', at: `${ZCODE_LOCALE_FILE}:4550` },
  { key: 'chat.toolbar.thoughtLevel.value.low', zh: '低', at: `${ZCODE_LOCALE_FILE}:4551` },
  { key: 'chat.toolbar.thoughtLevel.value.medium', zh: '中', at: `${ZCODE_LOCALE_FILE}:4552` },
  { key: 'chat.toolbar.thoughtLevel.value.high', zh: '高', at: `${ZCODE_LOCALE_FILE}:4553` },
  { key: 'chat.toolbar.thoughtLevel.value.xhigh', zh: '极高', at: `${ZCODE_LOCALE_FILE}:4554` },
  { key: 'chat.toolbar.thoughtLevel.value.max', zh: '最高', at: `${ZCODE_LOCALE_FILE}:4555` },
  { key: 'chat.toolbar.thoughtLevel.value.ultra', zh: '极致', at: `${ZCODE_LOCALE_FILE}:4556` },

  // 模式 / Plan
  { key: 'chat.toolbar.mode.label', zh: '切换模式', at: `${ZCODE_LOCALE_FILE}:4531` },
  { key: 'chat.plan.removeMarker', zh: '关闭计划模式', at: `${ZCODE_LOCALE_FILE}:174` },
  { key: 'mode.plan', zh: '计划', at: `${ZCODE_LOCALE_FILE}:5641` },
  { key: 'mode.label.glm.build', zh: '变更前确认', at: `${ZCODE_LOCALE_FILE}:5642` },
  { key: 'mode.label.glm.edit', zh: '自动编辑', at: `${ZCODE_LOCALE_FILE}:5643` },
  { key: 'mode.label.glm.plan', zh: '计划模式', at: `${ZCODE_LOCALE_FILE}:5644` },
  { key: 'mode.label.glm.yolo', zh: '完全访问', at: `${ZCODE_LOCALE_FILE}:5645` },
  { key: 'mode.description.glm.build', zh: '改文件前先问我。', at: `${ZCODE_LOCALE_FILE}:5646` },
  { key: 'mode.description.glm.edit', zh: '自动编辑文件。', at: `${ZCODE_LOCALE_FILE}:5647` },
  { key: 'mode.description.glm.plan', zh: '编辑前先出计划。', at: `${ZCODE_LOCALE_FILE}:5648` },
  { key: 'mode.description.glm.yolo', zh: '减少确认次数。', at: `${ZCODE_LOCALE_FILE}:5649` },

  // 电脑操作（CUA）
  { key: 'chat.toolbar.computerUse.label', zh: '电脑操作', at: `${ZCODE_LOCALE_FILE}:4533` },
  { key: 'chat.toolbar.computerUse.tooltip.idle', zh: '电脑操作空闲——首次使用时自动启动', at: `${ZCODE_LOCALE_FILE}:4534` },
  { key: 'chat.toolbar.computerUse.tooltip.starting', zh: '正在启用电脑操作插件…', at: `${ZCODE_LOCALE_FILE}:4535` },
  { key: 'chat.toolbar.computerUse.tooltip.ready', zh: '电脑操作已就绪 · 直接描述你想让 ZCode 做的事', at: `${ZCODE_LOCALE_FILE}:4536` },
  { key: 'chat.toolbar.computerUse.tooltip.permissionRequired', zh: '缺少 macOS 权限，点击完成授权', at: `${ZCODE_LOCALE_FILE}:4537` },
  { key: 'chat.toolbar.computerUse.tooltip.error', zh: '电脑操作启用失败 · 重启 ZCode 应用后重试，或让 ZCode 排查日志', at: `${ZCODE_LOCALE_FILE}:4538` },
  { key: 'chat.toolbar.computerUse.tooltip.sessionBusy', zh: '会话进行中，暂不能切换电脑操作；任务结束后可再试', at: `${ZCODE_LOCALE_FILE}:4540` },

  // 后台任务入口
  { key: 'chat.composer.backgroundWorks.tooltipTerminal', zh: '运行中的终端', at: `${ZCODE_LOCALE_FILE}:4463` },
  { key: 'chat.composer.backgroundWorks.tooltipAgent', zh: '打开运行中的智能体', at: `${ZCODE_LOCALE_FILE}:4464` },
  { key: 'chat.composer.backgroundWorks.tooltipWorkflow', zh: '打开运行中的工作流', at: `${ZCODE_LOCALE_FILE}:4467` },
  { key: 'chat.composer.backgroundWorks.tooltipWorkflowDetails', zh: '打开工作流详情', at: `${ZCODE_LOCALE_FILE}:4469` },
  { key: 'chat.composer.backgroundWorks.tooltipMixed', zh: '打开运行中的终端与智能体', at: `${ZCODE_LOCALE_FILE}:4470` },
  { key: 'chat.composer.backgroundWorks.ariaLabel', zh: '打开运行中的后台任务：Bash {bashCount} 个，工作流 {workflowCount} 个，子智能体 {subagentCount} 个，共 {count} 个', at: `${ZCODE_LOCALE_FILE}:4471` },

  // 输入区上方告警：消费方是模板串 `chat.selections.limit.${reason}`
  // (v4/ConversationComposer.tsx:2245)，三个键都在取值域里（非字面量消费）。
  { key: 'chat.selections.limit.single', zh: '单条引用最多 8,000 个字符。', at: `${ZCODE_LOCALE_FILE}:934`, dynamicPrefix: 'chat.selections.limit.' },
  { key: 'chat.selections.limit.count', zh: '最多可添加 8 条对话引用。', at: `${ZCODE_LOCALE_FILE}:935`, dynamicPrefix: 'chat.selections.limit.' },
  { key: 'chat.selections.limit.total', zh: '对话引用总计最多 16,000 个字符。', at: `${ZCODE_LOCALE_FILE}:936`, dynamicPrefix: 'chat.selections.limit.' },

  // 空态（草稿）问候语
  { key: 'chat.empty.greeting.office', zh: '今天有什么工作，交给我吧', at: `${ZCODE_LOCALE_FILE}:1911` },
  { key: 'chat.empty.greeting.morningEarly', zh: '早上好呀，新的一天开始啦', at: `${ZCODE_LOCALE_FILE}:4221` },
  { key: 'chat.empty.greeting.morning', zh: '上午好呀，有什么想让我帮忙的吗', at: `${ZCODE_LOCALE_FILE}:4222` },
  { key: 'chat.empty.greeting.noon', zh: '中午好呀，要不要先休息一下', at: `${ZCODE_LOCALE_FILE}:4223` },
  { key: 'chat.empty.greeting.afternoon', zh: '下午好呀，接下来交给我吧', at: `${ZCODE_LOCALE_FILE}:4224` },
  { key: 'chat.empty.greeting.evening', zh: '晚上好呀，今天辛苦啦', at: `${ZCODE_LOCALE_FILE}:4225` },
  { key: 'chat.empty.greeting.lateNight', zh: '夜深啦，别忘了照顾好自己哦', at: `${ZCODE_LOCALE_FILE}:4226` },

  // 工作区切换菜单（空态里那个「选择项目」下拉）
  { key: 'chat.empty.workspaceMenu', zh: '选择项目', at: `${ZCODE_LOCALE_FILE}:4248` },
  { key: 'chat.empty.selectProject', zh: '选择项目', at: `${ZCODE_LOCALE_FILE}:4249` },
  { key: 'chat.empty.workOutsideProject', zh: '不在项目中工作', at: `${ZCODE_LOCALE_FILE}:4250` },
  { key: 'chat.empty.detachProject', zh: '取消选择当前项目', at: `${ZCODE_LOCALE_FILE}:4251` },
  { key: 'chat.empty.workspaceSearchPlaceholder', zh: '搜索工作区', at: `${ZCODE_LOCALE_FILE}:4252` },
  { key: 'chat.empty.workspaceSearchEmpty', zh: '没有匹配的工作区', at: `${ZCODE_LOCALE_FILE}:4253` },
  { key: 'chat.empty.home', zh: '主目录', at: `${ZCODE_LOCALE_FILE}:4255` },
  { key: 'workspace.openFolder', zh: '打开文件夹', at: `${ZCODE_LOCALE_FILE}:1490` },
  { key: 'remote.trigger', zh: '远程连接', at: `${ZCODE_LOCALE_FILE}:1601` },
]

// ── 工具条分区与顺序 ──────────────────────────────────────────────────────

export interface ComposerRow {
  readonly id: string
  readonly side: 'leading' | 'trailing'
  /** 从左到右的元素 id。 */
  readonly elementIds: readonly string[]
  readonly source: string
}

export const TOOLBAR_ROWS: readonly ComposerRow[] = [
  {
    id: 'leading',
    side: 'leading',
    elementIds: ['actionMenu', 'modeSwitch', 'cuaEntry', 'backgroundWorkTrigger'],
    source: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:389-412`,
  },
  {
    id: 'trailing',
    side: 'trailing',
    elementIds: ['contextUsage', 'modelSelect', 'thoughtLevel', 'stop', 'send'],
    source: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:413-449`,
  },
]

/** 工具条行容器（leading 与 trailing 同一 flex 行）。 */
export const TOOLBAR_ROW_SOURCE = `${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:388`

// ── 元素表 ───────────────────────────────────────────────────────────────

export type ComposerElementKind = 'usage' | 'select' | 'button' | 'toggle'

/** 一组图标 + 它们共同的 import 行（同一元素的图标可能来自多个文件）。 */
export interface ComposerIconGroup {
  readonly icons: readonly string[]
  /** 图标 import 行（文件:行号）；自绘 svg 时写 `自绘`。 */
  readonly at: string
}

export interface ComposerElement {
  readonly id: string
  readonly kind: ComposerElementKind
  /** 主文案键（tooltip / aria-label）；无文案时 null。 */
  readonly labelKey: string | null
  /** 额外文案键（菜单项、状态文案、备用标签）。 */
  readonly textKeys: readonly string[]
  /** ZCode 用的图标，按 import 来源分组；动态解析的给候选全集。 */
  readonly iconGroups: readonly ComposerIconGroup[]
  /** 渲染处出处。 */
  readonly source: string
  /** 挂载处出处（父组件里调这个元素的那几行）。 */
  readonly mountSource: string
  readonly testId: string | null
  readonly testIdSource: string | null
  /** 可见性规则（照源码表达式转写）。 */
  readonly visibleWhen: string
  /** 禁用规则；恒不禁用写 null。 */
  readonly disabledWhen: string | null
  /** 快捷键（默认键位）；无绑定写 null。 */
  readonly shortcut: string | null
  readonly shortcutSource: string | null
  /** 互斥槽位：同槽元素只渲染其一。 */
  readonly exclusiveSlot?: string
}

export const COMPOSER_ELEMENTS: readonly ComposerElement[] = [
  {
    id: 'actionMenu',
    kind: 'button',
    labelKey: 'chat.composer.actionMenu',
    textKeys: [
      'chat.composer.attachment',
      'chat.composer.addSection',
      'chat.composer.addWorkflow',
      'chat.goalBanner.label',
      'chat.composer.contextShortcut',
      'chat.composer.capabilityShortcut',
      'chat.composer.skillShortcut',
      'chat.composer.contextSearchHint',
    ],
    iconGroups: [
      { icons: ['PlusIcon', 'PaperclipIcon', 'GoalIcon', 'Workflow', 'Info'], at: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptActionMenu.tsx:12` },
    ],
    source: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptActionMenu.tsx:246-261`,
    mountSource: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:391-405`,
    testId: 'chat-attachment-button',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:232`,
    visibleWhen:
      'hasActionMenu = Boolean(attachmentAction) || showMentionButton || showSlashButton'
      + ` (${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:178)`,
    disabledWhen: `disabled (${ZCODE_UI_SRC}/prompt-editor/ChatPromptActionMenu.tsx:256)`,
    shortcut: null,
    shortcutSource: null,
  },
  {
    id: 'modeSwitch',
    kind: 'select',
    labelKey: 'chat.toolbar.mode.label',
    textKeys: [
      'chat.plan.removeMarker',
      'mode.plan',
      'mode.label.glm.build',
      'mode.label.glm.edit',
      'mode.label.glm.plan',
      'mode.label.glm.yolo',
      'mode.description.glm.build',
      'mode.description.glm.edit',
      'mode.description.glm.plan',
      'mode.description.glm.yolo',
    ],
    iconGroups: [
      { icons: ['ChevronDownIcon', 'HandIcon', 'NotepadText', 'ShieldAlertIcon', 'ShieldCheckIcon'], at: `${ZCODE_UI_SRC}/chat-input-toolbar/display.tsx:36-42` },
      { icons: ['LightbulbIcon', 'XIcon', 'ChevronDownIcon'], at: `${ZCODE_UI_SRC}/v4/composer/V4ComposerModeControls.tsx:2` },
    ],
    source: `${ZCODE_UI_SRC}/v4/composer/V4ComposerModeControls.tsx:99-215`,
    mountSource: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2142-2151`,
    testId: 'chat-mode-select-trigger',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:478`,
    visibleWhen: `if (!selected) return null (${ZCODE_UI_SRC}/v4/composer/V4ComposerModeControls.tsx:97)`,
    disabledWhen: `disabled (${ZCODE_UI_SRC}/v4/composer/V4ComposerModeControls.tsx:114,200)`,
    shortcut: 'Ctrl+Shift+m',
    shortcutSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:81`,
  },
  {
    id: 'cuaEntry',
    kind: 'button',
    labelKey: 'chat.toolbar.computerUse.label',
    textKeys: [
      'chat.toolbar.computerUse.tooltip.idle',
      'chat.toolbar.computerUse.tooltip.starting',
      'chat.toolbar.computerUse.tooltip.ready',
      'chat.toolbar.computerUse.tooltip.permissionRequired',
      'chat.toolbar.computerUse.tooltip.error',
      'chat.toolbar.computerUse.tooltip.sessionBusy',
    ],
    iconGroups: [{ icons: ['MonitorCogIcon'], at: `${ZCODE_UI_SRC}/v4/composer/V4ComposerCuaEntry.tsx:8` }],
    source: `${ZCODE_UI_SRC}/v4/composer/V4ComposerCuaEntry.tsx:53-88`,
    mountSource: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2154-2159`,
    testId: 'v4-composer-cua-entry',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:537`,
    visibleWhen:
      'view.visible 四道门：平台(mac/win 本地桌面) · 设置未隐藏 · mac 需 permissionService · 插件已启用或切换中'
      + ` (${ZCODE_UI_SRC}/lib/cuaComposerEntryState.ts:81-100)`,
    disabledWhen: null,
    shortcut: null,
    shortcutSource: null,
  },
  {
    id: 'backgroundWorkTrigger',
    kind: 'button',
    labelKey: 'chat.composer.backgroundWorks.ariaLabel',
    textKeys: [
      'chat.composer.backgroundWorks.tooltipTerminal',
      'chat.composer.backgroundWorks.tooltipAgent',
      'chat.composer.backgroundWorks.tooltipWorkflow',
      'chat.composer.backgroundWorks.tooltipWorkflowDetails',
      'chat.composer.backgroundWorks.tooltipMixed',
    ],
    iconGroups: [{ icons: ['SquareTerminalIcon', 'Workflow', 'BotIcon', 'ActivityIcon'], at: `${ZCODE_UI_SRC}/v4/composer/ConversationBackgroundWorkTrigger.tsx:2` }],
    source: `${ZCODE_UI_SRC}/v4/composer/ConversationBackgroundWorkTrigger.tsx:83-145`,
    mountSource: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2160-2165`,
    testId: 'v4-composer-background-work-trigger',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:535`,
    visibleWhen:
      `!onOpen || counts.totalCount === 0 → null (${ZCODE_UI_SRC}/v4/composer/ConversationBackgroundWorkTrigger.tsx:65)`,
    disabledWhen: null,
    shortcut: null,
    shortcutSource: null,
  },
  {
    id: 'contextUsage',
    kind: 'usage',
    labelKey: 'chat.contextUsage',
    textKeys: ['chat.contextUsage.title', 'sidebar.usage.plan.title', 'settings.modelProvider.startPlan.balance.title'],
    iconGroups: [
      { icons: ['Loader2'], at: `${ZCODE_UI_SRC}/components/ai-elements/context.tsx:14` },
      // 常态触发器不是 lucide 图标，是自绘环形 svg（ContextIcon，无图标名可引）。
      { icons: [], at: `${ZCODE_UI_SRC}/components/ai-elements/context.tsx:74-107` },
    ],
    source: `${ZCODE_UI_SRC}/chat-input-toolbar/contextUsage.tsx:235,817-925`,
    mountSource: `${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1013-1022`,
    testId: 'chat-context-usage-trigger',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:482`,
    visibleWhen:
      '!(renderableTaskUsage || contextUsageLabel) && !hasCodingPlanUsageRemaining && !hasStartPlanBalance → null'
      + ` (${ZCODE_UI_SRC}/chat-input-toolbar/contextUsage.tsx:817-822)`,
    disabledWhen:
      `压缩按钮 disabled || recoveryPending (${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1021)；触发器本身不禁用`,
    shortcut: null,
    shortcutSource: null,
  },
  {
    id: 'modelSelect',
    kind: 'select',
    labelKey: 'chat.toolbar.model.label',
    textKeys: [
      'chat.toolbar.model.manageModels',
      'chat.toolbar.model.loadFailedRetry',
      'chat.toolbar.model.remoteWaiting',
      'chat.toolbar.model.targetMissing',
      'chat.toolbar.modelSwitch.lockedByRunningTask',
    ],
    iconGroups: [{ icons: ['PackageIcon', 'ChevronDownIcon', 'LoaderIcon'], at: `${ZCODE_UI_SRC}/ModelConfigSelect.tsx:36` }],
    source: `${ZCODE_UI_SRC}/ModelConfigSelect.tsx:482-521`,
    mountSource: `${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1023-1073`,
    testId: 'chat-model-select-trigger',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:468`,
    visibleWhen:
      'modelSelectionState=error → 重试按钮；unavailable → 文案；否则 modelMenuVisible = modelSelectGroups.length > 0 || showManageModelsAction'
      + ` (${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:971,1023-1042)`,
    disabledWhen:
      `disabled || recoveryPending || modelSelectionState.status !== "ready" (${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1058)`,
    shortcut: 'Ctrl+m',
    shortcutSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:80`,
  },
  {
    id: 'thoughtLevel',
    kind: 'select',
    labelKey: 'chat.toolbar.thoughtLevel.tooltip',
    textKeys: [
      'chat.toolbar.thoughtLevel.placeholder',
      'chat.toolbar.thoughtLevel.value.off',
      'chat.toolbar.thoughtLevel.value.on',
      'chat.toolbar.thoughtLevel.value.minimal',
      'chat.toolbar.thoughtLevel.value.low',
      'chat.toolbar.thoughtLevel.value.medium',
      'chat.toolbar.thoughtLevel.value.high',
      'chat.toolbar.thoughtLevel.value.xhigh',
      'chat.toolbar.thoughtLevel.value.max',
      'chat.toolbar.thoughtLevel.value.ultra',
    ],
    iconGroups: [{ icons: ['BrainIcon', 'ChevronDownIcon'], at: `${ZCODE_UI_SRC}/chat-input-toolbar/ThoughtLevelCycleControl.tsx:9` }],
    source: `${ZCODE_UI_SRC}/chat-input-toolbar/ThoughtLevelCycleControl.tsx:27,194-330`,
    mountSource: `${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1074-1090`,
    testId: 'chat-thought-level-select-trigger',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:474`,
    visibleWhen:
      'thoughtOption !== null；单档模型（entries.length === 1）渲染非 Select 的固定档位 span'
      + ` (${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1074, ${ZCODE_UI_SRC}/chat-input-toolbar/ThoughtLevelCycleControl.tsx:105,244-263)`,
    disabledWhen: `disabled || recoveryPending (${ZCODE_UI_SRC}/v4/composer/V4ComposerToolbar.tsx:1081)`,
    shortcut: 'Ctrl+t',
    shortcutSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:82`,
  },
  {
    id: 'stop',
    kind: 'button',
    labelKey: 'chat.stop',
    textKeys: [],
    iconGroups: [{ icons: ['SquareIcon'], at: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:52-59` }],
    source: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2064-2077`,
    mountSource: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2064`,
    testId: 'v4-stop',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:553`,
    visibleWhen:
      'showStopControl = canStop && !hasDraftToSubmit；canStop = Boolean(snapshot?.control.canStop)'
      + ` (${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:1098,1136)`,
    disabledWhen: null,
    shortcut: 'Esc',
    shortcutSource: `${ZCODE_UI_SRC}/v4/SessionPane.tsx:3599-3612`,
    exclusiveSlot: 'submitControl.tail',
  },
  {
    id: 'send',
    kind: 'button',
    labelKey: 'chat.send',
    textKeys: ['chat.queue.enqueue'],
    iconGroups: [
      { icons: ['ArrowUpIcon'], at: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:52-59` },
      { icons: ['Spinner'], at: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:82` },
    ],
    source: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2085-2096`,
    mountSource: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2078-2098`,
    testId: 'v4-composer-send',
    testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:539`,
    visibleWhen:
      '!showStopControl（与 stop 同槽互斥）；label 在 mode === "enqueue" 时用 chat.queue.enqueue'
      + ` (${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:1607-1609,2064,2078)`,
    disabledWhen:
      '!canSend = !(!disabled && !pending && hasDraftToSubmit && routingAllowsSend && attachmentsReady && submissionReady)'
      + ` (${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:1128-1134,2088)`,
    shortcut: 'Enter',
    shortcutSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:91`,
    exclusiveSlot: 'submitControl.tail',
  },
]

// ── 输入框区 ─────────────────────────────────────────────────────────────

export interface ComposerPlaceholderRule {
  readonly key: string
  readonly when: string
}

export interface ComposerInputSpec {
  readonly testId: string
  readonly testIdSource: string
  readonly shellSource: string
  readonly editorSource: string
  readonly enter: { readonly command: string; readonly binding: string; readonly source: string }
  readonly shiftEnter: { readonly command: string; readonly binding: string; readonly source: string }
  readonly enterSubmitPredicate: string
  readonly placeholders: readonly ComposerPlaceholderRule[]
  /** 输入框上方（自上而下）的分区 id。 */
  readonly aboveRegions: readonly string[]
  /** 输入壳内、编辑框之上。 */
  readonly topRegion: string
}

export const COMPOSER_INPUT: ComposerInputSpec = {
  testId: 'v4-composer-input',
  testIdSource: `${ZCODE_SHARED_SRC}/test-ids.ts:533`,
  shellSource: `${ZCODE_UI_SRC}/prompt-editor/ChatPromptEditor.tsx:335-452`,
  editorSource: `${ZCODE_UI_SRC}/LexicalChatInput.tsx:1-30,504-560`,
  enter: { command: 'composerSend', binding: 'Enter', source: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:91` },
  shiftEnter: { command: 'composerInsertNewline', binding: 'Shift+Enter', source: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:93-94` },
  enterSubmitPredicate:
    'shouldSubmitLexicalEnter：enterSubmits && !shiftKey && !ctrlKey && !metaKey && !isComposing && (text.trim() || allowSubmitWhenEmpty)'
    + ` (${ZCODE_UI_SRC}/LexicalChatInput.tsx:128-144)`,
  placeholders: [
    { key: 'chat.placeholder.newTask', when: '无历史消息' },
    { key: 'chat.placeholder.newTaskMobile', when: '无历史消息 + compactNewTask' },
    { key: 'chat.placeholder.followUpAsk', when: '有历史消息且任务空闲' },
    { key: 'chat.placeholder.followUpQueue', when: '有历史消息且任务处理中' },
  ],
  aboveRegions: ['errorBanner', 'contextHeader', 'selectionLimitAlert'],
  topRegion: 'topContent（附件网格 + 代码评论/网页/画板引用 chip）',
}

/** placeholder 分流的纯函数出处。 */
export const PLACEHOLDER_RESOLVER_SOURCE = `${ZCODE_UI_SRC}/lib/chatPlaceholder.ts:7-23`

/** 输入框上方三个分区的渲染出处。 */
export const ABOVE_REGION_SOURCES: Readonly<Record<string, string>> = {
  errorBanner: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2216-2228`,
  contextHeader: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2235-2238`,
  selectionLimitAlert: `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:2239-2248`,
}

/** 输入壳内 topContent 的渲染出处。 */
export const TOP_CONTENT_SOURCE = `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:1689-1699,2274`

/** 发送按钮点击的语义（只置标记，由 submit() 读取）。 */
export const SEND_CLICK_SOURCE = `${ZCODE_UI_SRC}/v4/ConversationComposer.tsx:1560-1571`

// ── 空态 ─────────────────────────────────────────────────────────────────

export interface ComposerEmptyStateSpec {
  readonly id: string
  readonly component: string
  readonly source: string
  readonly mountSource: string
  readonly testId: string | null
  readonly testIdSource: string | null
  readonly parts: readonly string[]
  readonly textKeys: readonly string[]
  readonly iconGroups: readonly ComposerIconGroup[]
}

export const COMPOSER_EMPTY_STATES: readonly ComposerEmptyStateSpec[] = [
  {
    id: 'draftGreeting',
    component: 'ConversationDraftEmptyState',
    source: `${ZCODE_UI_SRC}/v4/ConversationDraftEmptyState.tsx:80-247`,
    mountSource: `${ZCODE_UI_SRC}/v4/SessionPane.tsx:4786-4790`,
    testId: 'chat-empty',
    testIdSource: `${ZCODE_UI_SRC}/v4/SessionPane.tsx:4786`,
    parts: ['logo（自绘 svg + 夜间 img）', '问候语 p'],
    textKeys: [
      'chat.empty.greeting.office',
      'chat.empty.greeting.morningEarly',
      'chat.empty.greeting.morning',
      'chat.empty.greeting.noon',
      'chat.empty.greeting.afternoon',
      'chat.empty.greeting.evening',
      'chat.empty.greeting.lateNight',
    ],
    iconGroups: [],
  },
  {
    id: 'workspacePreviewMenu',
    component: 'ChatEmptyWorkspacePreviewMenu',
    source: `${ZCODE_UI_SRC}/ChatEmptyState.tsx:169-463`,
    mountSource: `${ZCODE_UI_SRC}/app-shell/WorkspaceShellLayout.tsx:1171`,
    testId: null,
    testIdSource: null,
    parts: ['workspace trigger（当前项目名 + 图标 + chevron）', '搜索框', '工作区复选列表', '分隔符', '打开文件夹', '远程连接', '不在项目中工作'],
    textKeys: [
      'chat.empty.workspaceMenu',
      'chat.empty.selectProject',
      'chat.empty.home',
      'chat.empty.workspaceSearchPlaceholder',
      'chat.empty.workspaceSearchEmpty',
      'workspace.openFolder',
      'remote.trigger',
      'chat.empty.workOutsideProject',
      'chat.empty.detachProject',
    ],
    iconGroups: [
      { icons: ['ChevronDownIcon', 'Cloud', 'Folder', 'FolderPlus', 'House', 'MessageCircle', 'SearchIcon', 'X'], at: `${ZCODE_UI_SRC}/ChatEmptyState.tsx:19-28` },
    ],
  },
]

/** 问候语按时段分流的边界（hour 判定）。 */
export const GREETING_HOUR_RULES_SOURCE = `${ZCODE_UI_SRC}/v4/ConversationDraftEmptyState.tsx:29-35`

// ── 工具条热键 ───────────────────────────────────────────────────────────

export interface ComposerShortcut {
  readonly command: string
  readonly binding: string
  readonly action: string
  readonly source: string
  readonly commandSource: string
}

export const COMPOSER_SHORTCUTS: readonly ComposerShortcut[] = [
  {
    command: 'openModelMenu',
    binding: 'Ctrl+m',
    action: '打开模型菜单',
    source: `${ZCODE_UI_SRC}/v4/composer/toolbarShortcuts.ts:115-121`,
    commandSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:80`,
  },
  {
    command: 'cycleSessionMode',
    binding: 'Ctrl+Shift+m',
    action: '循环下一次 Submission 的模式',
    source: `${ZCODE_UI_SRC}/v4/composer/toolbarShortcuts.ts:122-127`,
    commandSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:81`,
  },
  {
    command: 'cycleThoughtLevel',
    binding: 'Ctrl+t',
    action: '循环下一次 Submission 的思考深度',
    source: `${ZCODE_UI_SRC}/v4/composer/toolbarShortcuts.ts:128-133`,
    commandSource: `${ZCODE_SHARED_SRC}/shortcutCommands.ts:82`,
  },
]

/** 热键归属：按 config option 的 category 分配槽位。 */
export const SHORTCUT_CATEGORY_MAP_SOURCE = `${ZCODE_UI_SRC}/v4/composer/toolbarShortcuts.ts:27-40`

// ── 无法核实 ─────────────────────────────────────────────────────────────

export interface UnverifiableItem {
  readonly what: string
  readonly why: string
}

export const UNVERIFIABLE: readonly UnverifiableItem[] = [
  {
    what: 'chat.empty.title / chat.empty.description / .beforeWorkspace / .afterWorkspace',
    why: 'zh-CN.ts:4217-4220 有条目，但全树（apps/ + packages/，排除 locales）零消费方 —— 不是可见结构的一部分',
  },
  {
    what: 'chat.toolbar.thoughtLevel.label（"推理强度"）',
    why: 'zh-CN.ts:4543 有条目，全树排除 locales 后零消费方；思考档触发器实际读的是 chat.toolbar.thoughtLevel.tooltip（ThoughtLevelCycleControl.tsx:115）',
  },
  {
    what: 'chat.contextUsage.compress / .compressDescription',
    why: 'zh-CN.ts:4385-4386 有条目，零消费方；contextUsage.tsx:224 的 getContextCompressionCommand 只返回命令名，不读这两个键',
  },
  {
    what: '工具条的数值宽度 / 折叠断点（data-composer-compact、useComposerToolbarFit）',
    why: '行为在源码里（prompt-editor/useComposerToolbarFit.ts、各控件 data-composer-collapse-priority），但没有可映射到本仓 --icon-size / 间距令牌的数值口径',
  },
  {
    what: '图标像素尺寸（ZCode 的 size-4 / size-3.5）到本仓 iconSize.* 的映射',
    why: 'ZCode 用 Tailwind 尺寸类，本仓用 src/uiIcons.ts 的角色表；两边不是同一套度量，映射属本仓设计决定，不是 ZCode 事实',
  },
  {
    what: '模式选择器在非 glm provider 下的文案',
    why: 'ZCODE_MODE_OPTION_LABEL_IDS 只有 glm 一个键（chat-input-toolbar/display-help.ts:3-10），其它 provider 回落 entry.name（英文），无 zh-CN 词条可引',
  },
  {
    what: '各元素在本仓 AgentPanel.vue 的落点组件',
    why: '属接线说明（见回复），不是 ZCode 事实；本表只描述 ZCode 的可见结构',
  },
]
