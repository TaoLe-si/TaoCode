// `agent/row-model` 判据：把一条对话记录分类成 ZCode 的行类型并给出渲染描述。
//
// 起因：ZCode 的 ConversationRowView 是 9 种行的分发 switch（`rows.ts:420-430` 的判别 union），
// 本仓 AgentPanel 现在按 `role` 二分渲染 —— 工具行、思考行、时间线标记这些类型没有出口。
// 这里钉的是**分类判据**与**每类行的渲染描述**（角色样式键 / 图标 / 可折叠性 / 动作按钮），
// 以及工具分组（Explore / Terminal / Changes）的真实规则。
//
// 每条规则都对应 `.tools/ZCode` 的源码行；出处写在 `src/agentRowModel.ts` 的注释里。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ZCODE_ROW_KINDS,
  ROW_KIND_LITERAL_LINES,
  ROW_VIEW_ANCHORS,
  ERROR_RIDES_ON,
  TRAJECTORY_VISUAL_ROLES,
  TRAJECTORY_ROLE_TEXT_CLASSES,
  TRAJECTORY_ROLE_COLOR_TOKENS,
  ROW_LUCIDE_ICONS,
  LEAF_LUCIDE_ICONS,
  VISIBILITY_DEFAULTS,
  TOOL_GROUPING_DEFAULTS,
  SUBAGENT_TOOL_NAMES,
  OFFICIAL_CUA_TOOL_PREFIXES,
  TOOL_GROUP_MIN_ROWS,
  TOOL_FAMILY_BY_NAME,
  UNVERIFIED,
  isZcodeRowKind,
  trajectoryRoleTextClass,
  trajectoryRoleForRowKind,
  markerIconName,
  rowActionsForKind,
  isCollapsibleRow,
  isUserInputOverflowing,
  splitUserInputEpilogue,
  isConversationReasoningRowVisible,
  isTodoToolRow,
  isTodoToolRowVisible,
  rowVisibilityGate,
  toolFamily,
  resolveToolFamily,
  extractToolCommands,
  isExploreToolRow,
  isExecuteToolRow,
  isChangesToolRow,
  isShellToolCallAwaitingCommand,
  shouldDeferUnclassifiedShellToolRow,
  isAgentToolRow,
  toolGroupingFor,
  resolveGroupStageStatus,
  groupToolRows,
  pairAgentToolAndSubagentRows,
  classifyConversationRow,
  markerRenderDecision,
  compactMarkerLabelKey,
  goalVerifyLabelKey,
  modelChangeLabelKey,
} from '../src/agentRowModel.ts'

const toolRow = (rowId, toolName, extra = {}) => ({
  rowId,
  toolName,
  status: 'success',
  ...extra,
})

// ── 行类型 ──────────────────────────────────────────────────────────────────

test('行类型：9 种，闭集，且每种都指得到渲染叶子', () => {
  assert.equal(ZCODE_ROW_KINDS.length, 9, 'rows.ts:420-430 的判别 union 有 9 个成员')
  assert.deepEqual([...ZCODE_ROW_KINDS], [
    'turnHeader', 'userInput', 'assistantText', 'reasoning', 'toolCall',
    'artifact', 'subagent', 'hookInvocation', 'timelineMarker',
  ])
  for (const kind of ZCODE_ROW_KINDS) {
    assert.ok(ROW_VIEW_ANCHORS[kind], `${kind} 要有渲染叶子锚点`)
    assert.ok(ROW_VIEW_ANCHORS[kind].line > 0, `${kind} 的锚点行号要真实`)
    assert.ok(ROW_KIND_LITERAL_LINES[kind] > 0, `${kind} 的 kind 字面量要有定义行`)
  }
})

test('行类型：错误不是第 10 种行（它是 toolCall.status 与 assistantText.state 的取值）', () => {
  assert.equal(ERROR_RIDES_ON.toolCallStatus, 'error')
  assert.equal(ERROR_RIDES_ON.assistantTextState, 'failed')
  assert.ok(!ZCODE_ROW_KINDS.includes('error'), 'ZCode 的闭集里没有 error 行')
  // 阳性对照：转写里的 error 确实被映射到 toolCall 行，不是被丢掉。
  assert.equal(classifyConversationRow({ transcriptKind: 'error' }).kind, 'toolCall')
})

test('行类型守卫：只认闭集，别的一律不是行', () => {
  assert.equal(isZcodeRowKind('toolCall'), true)
  assert.equal(isZcodeRowKind('error'), false)
  assert.equal(isZcodeRowKind(''), false)
  assert.equal(isZcodeRowKind(undefined), false)
  assert.equal(isZcodeRowKind(42), false)
})

// ── 角色样式键 ──────────────────────────────────────────────────────────────

test('角色样式键：与 ModelTrajectoryRoleStyles.ts 逐字一致', () => {
  assert.deepEqual([...TRAJECTORY_VISUAL_ROLES], [
    'system', 'user', 'assistant', 'reasoning', 'tool-call', 'tool-result',
  ])
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES.system, 'text-foreground-subtle')
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES.user, 'text-trajectory-user/80')
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES.assistant, 'text-trajectory-assistant/80')
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES.reasoning, 'text-trajectory-reasoning/80')
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES['tool-call'], 'text-trajectory-tool-call/80')
  assert.equal(TRAJECTORY_ROLE_TEXT_CLASSES['tool-result'], 'text-trajectory-tool-result/80')
  assert.equal(trajectoryRoleTextClass('reasoning'), 'text-trajectory-reasoning/80')
})

test('角色样式键：色值 token 取 styles.css 的真实值（亮/暗两套）', () => {
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS.user.light, '#2563eb')
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS.user.dark, '#60a5fa')
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS.assistant.light, '#0f766e')
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS.reasoning.light, '#7c3aed')
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS['tool-call'].light, '#d97706')
  assert.equal(TRAJECTORY_ROLE_COLOR_TOKENS['tool-result'].light, '#0284c7')
})

test('行类型 → 轨迹角色：没有对应物的行返回 null，不猜', () => {
  assert.equal(trajectoryRoleForRowKind('userInput'), 'user')
  assert.equal(trajectoryRoleForRowKind('assistantText'), 'assistant')
  assert.equal(trajectoryRoleForRowKind('reasoning'), 'reasoning')
  assert.equal(trajectoryRoleForRowKind('toolCall'), 'tool-call')
  // artifact / subagent / turnHeader / timelineMarker 在 ModelTrajectory 面板里没有行。
  for (const kind of ['artifact', 'subagent', 'turnHeader', 'timelineMarker', 'hookInvocation']) {
    assert.equal(trajectoryRoleForRowKind(kind), null, `${kind} 不应被硬塞一个角色`)
  }
})

// ── 图标 ────────────────────────────────────────────────────────────────────

test('图标：lucide 名来自 ConversationRowView 的 import 行', () => {
  assert.equal(ROW_LUCIDE_ICONS.copy, 'CopyIcon')
  assert.equal(ROW_LUCIDE_ICONS.copyDone, 'CheckIcon')
  assert.equal(ROW_LUCIDE_ICONS.edit, 'PencilIcon')
  assert.equal(ROW_LUCIDE_ICONS.fork, 'TrendingUpDownIcon')
  assert.equal(ROW_LUCIDE_ICONS.like, 'ThumbsUpIcon')
  assert.equal(ROW_LUCIDE_ICONS.dislike, 'ThumbsDownIcon')
  assert.equal(ROW_LUCIDE_ICONS.rewindWorkspace, 'FileClockIcon')
  assert.equal(ROW_LUCIDE_ICONS.removeAttachment, 'XIcon')
  assert.equal(ROW_LUCIDE_ICONS.artifact, 'FileIcon')
  assert.equal(LEAF_LUCIDE_ICONS.reasoning, 'BrainIcon')
})

test('图标：marker 按类型分流，未渲染的类型没有图标', () => {
  assert.equal(markerIconName('compact'), 'ArchiveIcon')
  assert.equal(markerIconName('forkNotice'), 'GitBranchIcon')
  assert.equal(markerIconName('goalVerify'), 'GoalIcon')
  assert.equal(markerIconName('modelChange'), 'ArrowRightLeftIcon')
  assert.equal(markerIconName('goalSet'), null, 'goalSet 已在投影层停产，没有图标')
  assert.equal(markerIconName('retryNotice'), null, 'retryNotice 无 UI')
  assert.equal(markerIconName('checkpointRestored'), null)
})

// ── 动作按钮 ────────────────────────────────────────────────────────────────

test('用户行动作：复制 + 编辑；编辑入口有 entityId 门', () => {
  const actions = rowActionsForKind('userInput')
  assert.deepEqual(actions.map((a) => a.id), ['copy', 'edit'])
  assert.equal(actions[0].labelKey, 'chat.message.copy')
  assert.equal(actions[0].icon, 'CopyIcon')
  assert.equal(actions[1].labelKey, 'chat.message.edit')
  assert.equal(actions[1].gate, 'onEdit && row.entityId', 'ConversationRowView.tsx:1295 的门要如实带出')
})

test('用户行动作：编辑态多出提交/取消/重置工作区/删附件', () => {
  const ids = rowActionsForKind('userInput', { showEditMode: true }).map((a) => a.id)
  assert.deepEqual(ids, ['copy', 'edit', 'submitEdit', 'cancelEdit', 'rewindWorkspace', 'removeAttachment'])
  const byId = new Map(rowActionsForKind('userInput', { showEditMode: true }).map((a) => [a.id, a]))
  assert.equal(byId.get('submitEdit').labelKey, 'chat.send')
  assert.equal(byId.get('cancelEdit').labelKey, 'common.cancel')
  assert.equal(byId.get('rewindWorkspace').labelKey, 'chat.edit.resetConversationAndFiles')
  assert.equal(byId.get('removeAttachment').labelKey, 'chat.attachments.remove')
})

test('助手行动作：复制/赞/踩/分叉/钩子详情，retry 只登记不画', () => {
  const actions = rowActionsForKind('assistantText')
  assert.deepEqual(actions.map((a) => a.id), ['copy', 'like', 'dislike', 'fork', 'retry', 'hookDetails'])
  const byId = new Map(actions.map((a) => [a.id, a]))
  assert.equal(byId.get('like').labelKey, 'chat.message.like')
  assert.equal(byId.get('dislike').labelKey, 'chat.message.dislike')
  assert.equal(byId.get('fork').labelKey, 'chat.message.fork')
  assert.equal(byId.get('fork').gate, 'onFork && entityId')
  assert.equal(byId.get('like').gate, 'entityId && onFeedbackChange')
  // ConversationRowView.tsx:251-252 注释：产品 UI 不渲染普通重试入口。
  assert.equal(byId.get('retry').gate, 'never-rendered')
  assert.equal(byId.get('hookDetails').gate, 'turnId && hookInvocations')
})

test('动作按钮：思考行/工具行/子代理行/产物行都没有动作（叶子无 MessageActions）', () => {
  for (const kind of ['reasoning', 'toolCall', 'subagent', 'artifact', 'turnHeader', 'hookInvocation']) {
    assert.deepEqual(rowActionsForKind(kind), [], `${kind} 不应凭空长出动作按钮`)
  }
})

test('动作按钮：只有 forkNotice 标记可点（跳父会话），其余标记没有动作', () => {
  const fork = rowActionsForKind('timelineMarker', { markerType: 'forkNotice' })
  assert.deepEqual(fork.map((a) => a.id), ['navigateToForkParent'])
  assert.equal(fork[0].gate, 'context.onNavigateToRow')
  assert.deepEqual(rowActionsForKind('timelineMarker', { markerType: 'compact' }), [])
  assert.deepEqual(rowActionsForKind('timelineMarker'), [])
})

// ── 可折叠性 ────────────────────────────────────────────────────────────────

test('可折叠性：行级只有思考行默认收起', () => {
  assert.equal(isCollapsibleRow('reasoning'), true)
  for (const kind of ['userInput', 'assistantText', 'toolCall', 'artifact', 'subagent']) {
    assert.equal(isCollapsibleRow(kind), false, `${kind} 的展开由内容/renderer 决定，不是行级折叠`)
  }
})

test('用户行正文：超过 120px（含 1px 容差）才算溢出，才出现展开按钮', () => {
  assert.equal(isUserInputOverflowing(120), false)
  assert.equal(isUserInputOverflowing(121), false, '容差 1px')
  assert.equal(isUserInputOverflowing(122), true)
  assert.equal(isUserInputOverflowing(0), false)
})

test('用户行尾注：epilogueStart 切分，越界或缺席时宁可多显示也不吃正文', () => {
  const text = '正文\n---\n引擎尾注'
  assert.deepEqual(splitUserInputEpilogue(text, 2), { body: '正文', epilogue: '\n---\n引擎尾注' })
  assert.deepEqual(splitUserInputEpilogue(text, undefined), { body: text })
  assert.deepEqual(splitUserInputEpilogue(text, -1), { body: text })
  assert.deepEqual(splitUserInputEpilogue(text, text.length + 1), { body: text })
  // 边界：0 表示整条都是引擎文本（nudge 轮），正文为空但尾注在场。
  const whole = splitUserInputEpilogue(text, 0)
  assert.equal(whole.body, '')
  assert.equal(whole.epilogue, text)
})

// ── 思考行 vs 待办行 ────────────────────────────────────────────────────────

test('可见性默认值：思考开、待办关', () => {
  assert.equal(VISIBILITY_DEFAULTS.messageStreamShowReasoning, true)
  assert.equal(VISIBILITY_DEFAULTS.messageStreamShowTodos, false)
})

test('思考行：关掉完整思考时，本轮首条 reasoning 仍必须显示', () => {
  const off = { messageStreamShowReasoning: false, messageStreamFirstReasoningRowId: 42 }
  assert.equal(isConversationReasoningRowVisible(42, off), true, '首条是最小必要思考提示')
  assert.equal(isConversationReasoningRowVisible(43, off), false)
  assert.equal(isConversationReasoningRowVisible(43, { messageStreamShowReasoning: true }), true)
  // 开关缺席（旧快照）且没有首条记录 → 不显示，不默认放行。
  assert.equal(isConversationReasoningRowVisible(43, {}), false)
})

test('待办行：开关关掉时整条不渲染（不留空壳）', () => {
  assert.equal(isTodoToolRow({ toolName: 'TodoWrite' }), true)
  assert.equal(isTodoToolRow({ toolName: 'TodoRead' }), true)
  assert.equal(isTodoToolRow({ toolName: 'todowrite' }), true, '名字比对大小写不敏感')
  assert.equal(isTodoToolRow({ toolName: 'update_plan' }), true, '名字形状也命中')
  assert.equal(isTodoToolRow({ toolName: 'Read' }), false)
  assert.equal(isTodoToolRow({ toolName: 'Task' }), false)

  assert.equal(isTodoToolRowVisible({ toolName: 'TodoWrite' }, false), false)
  assert.equal(isTodoToolRowVisible({ toolName: 'TodoWrite' }, true), true)
  assert.equal(isTodoToolRowVisible({ toolName: 'Read' }, false), true, '只裁待办，不误伤别的工具')
})

test('可见性门：思考与待办各自走自己的开关，其余行恒可见', () => {
  const off = { messageStreamShowReasoning: false, messageStreamFirstReasoningRowId: 1 }
  assert.equal(rowVisibilityGate('reasoning', { rowId: 1, reasoning: off }), true)
  assert.equal(rowVisibilityGate('reasoning', { rowId: 2, reasoning: off }), false)
  assert.equal(
    rowVisibilityGate('toolCall', { rowId: 3, reasoning: off, toolName: 'TodoWrite', messageStreamShowTodos: false }),
    false,
  )
  assert.equal(
    rowVisibilityGate('toolCall', { rowId: 3, reasoning: off, toolName: 'TodoWrite', messageStreamShowTodos: true }),
    true,
  )
  assert.equal(rowVisibilityGate('assistantText', { rowId: 4, reasoning: off }), true)
  assert.equal(rowVisibilityGate('userInput', { rowId: 5, reasoning: off }), true)
})

// ── 工具家族 ────────────────────────────────────────────────────────────────

test('工具家族表：逐条对上 shared 的 TOOL_FAMILY_BY_NAME', () => {
  assert.equal(TOOL_FAMILY_BY_NAME.Read, 'file-read')
  assert.equal(TOOL_FAMILY_BY_NAME.Write, 'file-write')
  assert.equal(TOOL_FAMILY_BY_NAME.Edit, 'file-write')
  assert.equal(TOOL_FAMILY_BY_NAME.ApplyPatch, 'file-write')
  assert.equal(TOOL_FAMILY_BY_NAME.Bash, 'shell')
  assert.equal(TOOL_FAMILY_BY_NAME.Glob, 'search')
  assert.equal(TOOL_FAMILY_BY_NAME.Grep, 'search')
  assert.equal(TOOL_FAMILY_BY_NAME.WebFetch, 'search')
  assert.equal(TOOL_FAMILY_BY_NAME.TodoWrite, 'todo')
  assert.equal(TOOL_FAMILY_BY_NAME.Agent, 'agent')
  assert.equal(TOOL_FAMILY_BY_NAME.Task, 'agent')
  assert.equal(TOOL_FAMILY_BY_NAME.CreateWorkflow, 'workflow')
  assert.equal(TOOL_FAMILY_BY_NAME.AmendWorkflow, 'workflow')
  assert.equal(TOOL_FAMILY_BY_NAME.submit_result, 'workflow')
  assert.equal(toolFamily('read'), 'file-read', '查表大小写不敏感')
  assert.equal(toolFamily('nope'), null)
  assert.equal(toolFamily(''), null)
  assert.equal(toolFamily(null), null)
})

test('家族解析：legacy kind 前缀也认（旧投影身份常只写在 kind 上）', () => {
  assert.equal(resolveToolFamily({ toolName: 'Bash' }), 'shell')
  assert.equal(resolveToolFamily({ toolName: '', kind: 'read_file' }), 'file-read')
  assert.equal(resolveToolFamily({ kind: 'explore' }), 'explore', 'kind==="explore" 有前置特判')
  assert.equal(resolveToolFamily({ kind: 'multi_edit' }), 'file-write')
  assert.equal(resolveToolFamily({ kind: 'execute_command' }), 'shell')
  assert.equal(resolveToolFamily({ kind: 'web_search' }), 'search')
  assert.equal(resolveToolFamily({ kind: 'inspect' }), 'explore')
  assert.equal(resolveToolFamily({ kind: 'whatever' }), null, '认不出来就是 null，不硬塞')
})

// ── 工具分组：Explore / Terminal / Changes ──────────────────────────────────

test('分组默认值：探索开、终端开、文件更改关、CUA 开', () => {
  assert.equal(TOOL_GROUPING_DEFAULTS.explore, true)
  assert.equal(TOOL_GROUPING_DEFAULTS.terminal, true)
  assert.equal(TOOL_GROUPING_DEFAULTS.changes, false)
  assert.equal(TOOL_GROUPING_DEFAULTS.cua, true)
  assert.equal(TOOL_GROUP_MIN_ROWS, 2, '单项不建组')
  assert.deepEqual([...SUBAGENT_TOOL_NAMES], ['Agent', 'Task', 'subagent'])
  assert.deepEqual([...OFFICIAL_CUA_TOOL_PREFIXES], [
    'mcp__computer-use__', 'mcp__plugin_zcode-cua_computer-use__',
  ])
})

test('explore 判据：只读工具与只读命令进 Explore，写入与重定向不进', () => {
  assert.equal(isExploreToolRow(toolRow(1, 'Read')), true)
  assert.equal(isExploreToolRow(toolRow(2, 'Grep')), true)
  assert.equal(isExploreToolRow(toolRow(3, 'Glob')), true)
  assert.equal(isExploreToolRow(toolRow(4, 'WebSearch')), true)
  assert.equal(isExploreToolRow(toolRow(5, 'Write')), false, 'file-write 永远不是 explore')
  assert.equal(isExploreToolRow(toolRow(6, 'Edit')), false)

  // shell：命令决定归属。
  assert.equal(isExploreToolRow(toolRow(7, 'Bash', { input: { command: 'rg foo src' } })), true)
  assert.equal(isExploreToolRow(toolRow(8, 'Bash', { input: { command: 'git status' } })), true)
  assert.equal(isExploreToolRow(toolRow(9, 'Bash', { input: { command: 'npm test' } })), false)
  assert.equal(isExploreToolRow(toolRow(10, 'Bash', { input: { command: 'rm -rf build' } })), false)
  assert.equal(isExploreToolRow(toolRow(11, 'Bash', { input: { command: 'ls > out.txt' } })), false, '重定向写不是只读')
  assert.equal(isExploreToolRow(toolRow(12, 'Bash', { input: { command: 'cat a && rm b' } })), false, '任一段是写就不算')
  assert.equal(
    isExploreToolRow(toolRow(13, 'Bash', { input: { command: 'for f in *; do cat "$f"; done' } })),
    true,
    '包在 for 里的只读探查仍算 explore',
  )
})

test('execute 判据：非只读 shell 才是终端组，等待命令的不算', () => {
  assert.equal(isExecuteToolRow(toolRow(1, 'Bash', { input: { command: 'npm test' } })), true)
  assert.equal(isExecuteToolRow(toolRow(2, 'Bash', { input: { command: 'rg foo' } })), false, '只读命令归 explore')
  assert.equal(isExecuteToolRow(toolRow(3, 'Read')), false, '非 shell 不进终端组')
  assert.equal(isExecuteToolRow(toolRow(4, 'Bash', { input: {} })), false, '还没拿到命令')
  assert.equal(isShellToolCallAwaitingCommand(toolRow(4, 'Bash', { input: {} })), true)
  assert.equal(isShellToolCallAwaitingCommand(toolRow(5, 'Read', { input: {} })), false)
})

test('changes 判据：family 为 file-write', () => {
  assert.equal(isChangesToolRow(toolRow(1, 'Write')), true)
  assert.equal(isChangesToolRow(toolRow(2, 'Edit')), true)
  assert.equal(isChangesToolRow(toolRow(3, 'ApplyPatch')), true)
  assert.equal(isChangesToolRow(toolRow(4, 'Read')), false)
})

test('命令抽取：认 command/cmd/script/parsed_cmd 与 -lc 数组，剥包装与分段', () => {
  assert.deepEqual(extractToolCommands({ command: 'rg foo' }), ['rg foo'])
  assert.deepEqual(extractToolCommands({ cmd: 'ls -la' }), ['ls -la'])
  assert.deepEqual(extractToolCommands({ script: 'pwd' }), ['pwd'])
  assert.deepEqual(extractToolCommands({ parsed_cmd: [{ cmd: 'git log' }, { cmd: 'git diff' }] }), ['git log', 'git diff'])
  assert.deepEqual(extractToolCommands({ command: '/bin/bash -lc "rg foo src"' }), ['rg foo src'])
  assert.deepEqual(extractToolCommands({ command: 'ls && cat a.txt' }), ['ls', 'cat a.txt'], '按 && 分段')
  assert.deepEqual(extractToolCommands({ command: 'a; b || c' }), ['a', 'b', 'c'])
  assert.deepEqual(extractToolCommands({ command: '  ' }), [])
  assert.deepEqual(extractToolCommands(undefined), [])
  assert.deepEqual(extractToolCommands({}), [])
})

test('分组档位：explore 优先于 changes/terminal，开关关掉就不分组', () => {
  assert.equal(toolGroupingFor(toolRow(1, 'Read')), 'exploreGroup')
  assert.equal(toolGroupingFor(toolRow(2, 'Write')), null, 'Changes 默认关')
  assert.equal(toolGroupingFor(toolRow(2, 'Write'), { changes: true }), 'changesGroup')
  assert.equal(toolGroupingFor(toolRow(3, 'Bash', { input: { command: 'npm test' } })), 'executeGroup')
  assert.equal(toolGroupingFor(toolRow(4, 'Read'), { explore: false }), null)
  assert.equal(
    toolGroupingFor(toolRow(5, 'Bash', { input: { command: 'npm test' } }), { terminal: false }),
    null,
  )
  assert.equal(toolGroupingFor(toolRow(6, 'Task')), null, 'Agent 行不属于这三档')
})

test('分组状态：阶段尾部在跑 → in_progress；有取消 → stopped；Changes 只有两态', () => {
  assert.equal(resolveGroupStageStatus([toolRow(1, 'Read')], true), 'in_progress')
  assert.equal(resolveGroupStageStatus([toolRow(1, 'Read')], false), 'completed')
  assert.equal(
    resolveGroupStageStatus([toolRow(1, 'Read', { status: 'cancelled' })], false),
    'stopped',
  )
  assert.equal(
    resolveGroupStageStatus([toolRow(1, 'Write', { status: 'cancelled' })], false, 'changes'),
    'completed',
    'Changes 是 UI 阶段容器，子项取消只留在明细',
  )
})

test('分组：连续两个只读工具合并成 Explore，单项保持原样', () => {
  const items = groupToolRows([
    toolRow(1, 'Read'),
    toolRow(2, 'Grep'),
    toolRow(3, 'Bash', { input: { command: 'npm test' } }),
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'exploreGroup')
  assert.deepEqual(items[0].rows.map((r) => r.rowId), [1, 2])
  assert.equal(items[0].key, 'explore:1', 'key 锚定首个 tool call，流式追加不重建')
  assert.equal(items[0].rowId, 1)
  assert.equal(items[0].groupTitle, 'Explore')
  assert.equal(items[1].kind, 'row', '单个非只读 shell 不成组')
  assert.deepEqual(items[1].rows.map((r) => r.rowId), [3])
})

test('分组：单项不升级为父分组（避免只有一条子项的容器）', () => {
  const items = groupToolRows([toolRow(1, 'Read')])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'row')
  assert.equal(items[0].key, 'row:1')
})

test('分组：终端组把连续非只读 shell 收在一起，遇只读命令断开', () => {
  const items = groupToolRows([
    toolRow(1, 'Bash', { input: { command: 'npm run build' } }),
    toolRow(2, 'Bash', { input: { command: 'npm test' } }),
    toolRow(3, 'Bash', { input: { command: 'rg foo' } }),
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'executeGroup')
  assert.deepEqual(items[0].rows.map((r) => r.rowId), [1, 2])
  assert.equal(items[0].groupTitle, 'Execute')
  assert.equal(items[1].kind, 'row', '第三条是只读，单独成行')
})

test('分组：Changes 开关打开才聚合连续写入', () => {
  const rows = [toolRow(1, 'Write'), toolRow(2, 'Edit')]
  assert.deepEqual(groupToolRows(rows).map((i) => i.kind), ['row', 'row'])
  const grouped = groupToolRows(rows, { enableChangesGrouping: true })
  assert.deepEqual(grouped.map((i) => i.kind), ['changesGroup'])
  assert.equal(grouped[0].groupTitle, 'Changes')
  assert.equal(grouped[0].key, 'changes:1')
})

test('分组：等待命令的 shell 先剔除，不占位置把前一个 Explore 误判成已结束', () => {
  const rows = [
    toolRow(1, 'Read'),
    toolRow(2, 'Bash', { status: 'running', input: {} }),
    toolRow(3, 'Grep'),
  ]
  const items = groupToolRows(rows)
  assert.equal(items.length, 1, '等待命令的 shell 不进数组')
  assert.equal(items[0].kind, 'exploreGroup')
  assert.deepEqual(items[0].rows.map((r) => r.rowId), [1, 3])
})

test('分组：待办行按开关裁掉，关掉时不产生任何 Todo DOM', () => {
  const rows = [toolRow(1, 'TodoWrite'), toolRow(2, 'Read'), toolRow(3, 'Grep')]
  const off = groupToolRows(rows, { showTodos: false })
  assert.deepEqual(off.map((i) => i.kind), ['exploreGroup'])
  assert.deepEqual(off[0].rows.map((r) => r.rowId), [2, 3])
  const on = groupToolRows(rows, { showTodos: true })
  assert.deepEqual(on.map((i) => i.kind), ['row', 'exploreGroup'])
  assert.equal(on[0].rows[0].toolName, 'TodoWrite')
})

test('分组：阶段尾部在跑时父阶段是 in_progress（不是子项状态的汇总）', () => {
  const rows = [toolRow(1, 'Read'), toolRow(2, 'Grep')]
  assert.equal(groupToolRows(rows, { stageTailIsRunning: true })[0].stageStatus, 'in_progress')
  assert.equal(groupToolRows(rows)[0].stageStatus, 'completed')
  // 尾部不在跑但后面还有内容时，父阶段必须结束。
  const withTail = groupToolRows([...rows, toolRow(3, 'Task')], { stageTailIsRunning: true })
  assert.equal(withTail[0].stageStatus, 'completed', '后面已有别的可见内容，阶段结束')
})

// ── Agent ↔ subagent 配对 ───────────────────────────────────────────────────

test('配对：按 parentToolCallId 精确配对，并发顺序不同也不会串错', () => {
  const agents = [
    toolRow(10, 'Agent', { turnId: 't1', toolCallId: 'call-a' }),
    toolRow(11, 'Agent', { turnId: 't1', toolCallId: 'call-b' }),
  ]
  // 事件到达顺序与模型输出顺序相反（异步调度）。
  const subagents = [
    { rowId: 21, turnId: 't1', parentToolCallId: 'call-b' },
    { rowId: 20, turnId: 't1', parentToolCallId: 'call-a' },
  ]
  const { byAgentToolRowId, claimedSubagentRowIds } = pairAgentToolAndSubagentRows(agents, subagents)
  assert.equal(byAgentToolRowId.get(10), 20)
  assert.equal(byAgentToolRowId.get(11), 21, '不能按 FIFO 把标题与 childSessionId 拼错')
  assert.deepEqual([...claimedSubagentRowIds].sort((a, b) => a - b), [20, 21])
})

test('配对：缺 parentToolCallId 的历史数据，仅当该轮恰好剩一对时才配', () => {
  const agents = [toolRow(10, 'Agent', { turnId: 't1', toolCallId: 'call-a' })]
  const legacy = [{ rowId: 20, turnId: 't1' }]
  assert.equal(pairAgentToolAndSubagentRows(agents, legacy).byAgentToolRowId.get(10), 20)

  // 同轮两个未配对 Agent 工具 → 有歧义，不配（宁可不配对也不猜）。
  const twoAgents = [
    toolRow(10, 'Agent', { turnId: 't1', toolCallId: 'a' }),
    toolRow(11, 'Agent', { turnId: 't1', toolCallId: 'b' }),
  ]
  const ambiguous = pairAgentToolAndSubagentRows(twoAgents, legacy)
  assert.equal(ambiguous.byAgentToolRowId.size, 0)
  assert.equal(ambiguous.claimedSubagentRowIds.size, 0)
})

test('配对：跨 turn 不配（parentToolCallId 只在同 turn 内成立）', () => {
  const agents = [toolRow(10, 'Agent', { turnId: 't1', toolCallId: 'call-a' })]
  const subagents = [{ rowId: 20, turnId: 't2', parentToolCallId: 'call-a' }]
  assert.equal(pairAgentToolAndSubagentRows(agents, subagents).byAgentToolRowId.size, 0)
})

test('分组：只有配对成功的 Agent 行才成为 agentToolCall 项', () => {
  const agents = [toolRow(10, 'Agent', { turnId: 't1', toolCallId: 'call-a' })]
  const paired = groupToolRows(agents, {
    subagentRows: [{ rowId: 20, turnId: 't1', parentToolCallId: 'call-a' }],
  })
  assert.deepEqual(paired.map((i) => i.kind), ['agentToolCall'])
  assert.equal(paired[0].key, 'agent:10')

  const unpaired = groupToolRows(agents)
  assert.deepEqual(unpaired.map((i) => i.kind), ['row'], '未配对就按普通工具行渲染')
})

test('Agent 行判定：按 toolName 字面量（大小写敏感，与上游 Set.has 一致）', () => {
  assert.equal(isAgentToolRow({ toolName: 'Agent' }), true)
  assert.equal(isAgentToolRow({ toolName: 'Task' }), true)
  assert.equal(isAgentToolRow({ toolName: 'subagent' }), true)
  assert.equal(isAgentToolRow({ toolName: 'agent' }), false)
  assert.equal(isAgentToolRow({ toolName: 'Read' }), false)
})

test('延迟分类：只在 inputStreaming/running 且命令未出现时推迟', () => {
  assert.equal(shouldDeferUnclassifiedShellToolRow(toolRow(1, 'Bash', { status: 'running', input: {} })), true)
  assert.equal(shouldDeferUnclassifiedShellToolRow(toolRow(2, 'Bash', { status: 'inputStreaming', input: {} })), true)
  assert.equal(shouldDeferUnclassifiedShellToolRow(toolRow(3, 'Bash', { status: 'success', input: {} })), false)
  assert.equal(
    shouldDeferUnclassifiedShellToolRow(toolRow(4, 'Bash', { status: 'running', input: { command: 'ls' } })),
    false,
    '命令已经到了就不该再推迟',
  )
})

// ── 分类 ────────────────────────────────────────────────────────────────────

test('分类：显式 kind 优先，直接落 9 种行类型', () => {
  const row = classifyConversationRow({ kind: 'toolCall', toolName: 'Read' })
  assert.equal(row.kind, 'toolCall')
  assert.equal(row.role, 'tool-call')
  assert.equal(row.styleKey, 'text-trajectory-tool-call/80')
  assert.equal(row.view, 'ToolCallRowView')
  assert.equal(row.collapsible, false)
  assert.deepEqual(row.actions, [])
})

test('分类：本仓 role 映射到 userInput / assistantText', () => {
  const user = classifyConversationRow({ role: 'user', text: '你好' })
  assert.equal(user.kind, 'userInput')
  assert.equal(user.role, 'user')
  assert.equal(user.styleKey, 'text-trajectory-user/80')
  assert.equal(user.view, 'UserInputRowView')
  assert.deepEqual(user.actions.map((a) => a.id), ['copy', 'edit'])

  const assistant = classifyConversationRow({ role: 'assistant', text: '好的' })
  assert.equal(assistant.kind, 'assistantText')
  assert.equal(assistant.styleKey, 'text-trajectory-assistant/80')
  assert.equal(assistant.view, 'AssistantTextRowView')
  assert.ok(assistant.actions.some((a) => a.id === 'fork'))
})

test('分类：本仓转写 kind 映射（tool/error → toolCall，approval/note 无对应物）', () => {
  assert.equal(classifyConversationRow({ transcriptKind: 'user' }).kind, 'userInput')
  assert.equal(classifyConversationRow({ transcriptKind: 'assistant' }).kind, 'assistantText')
  assert.equal(classifyConversationRow({ transcriptKind: 'tool' }).kind, 'toolCall')
  assert.equal(classifyConversationRow({ transcriptKind: 'error' }).kind, 'toolCall')

  const approval = classifyConversationRow({ transcriptKind: 'approval' })
  assert.equal(approval.unmappedReason !== undefined, true, '无对应物要说清，不硬塞行类型')
  assert.equal(approval.role, null)
  assert.equal(approval.styleKey, null)
  assert.deepEqual(approval.actions, [])
  assert.equal(classifyConversationRow({ transcriptKind: 'note' }).unmappedReason !== undefined, true)
})

test('分类：思考行可折叠、带 Brain 图标；时间线标记按 marker 取图标', () => {
  const reasoning = classifyConversationRow({ kind: 'reasoning' })
  assert.equal(reasoning.collapsible, true)
  assert.equal(reasoning.icon, 'BrainIcon')
  assert.equal(reasoning.styleKey, 'text-trajectory-reasoning/80')

  const marker = classifyConversationRow({ kind: 'timelineMarker', markerType: 'compact' })
  assert.equal(marker.icon, 'ArchiveIcon')
  assert.equal(marker.role, null, '时间线标记在轨迹面板里没有行')
  assert.deepEqual(marker.actions, [])

  const fork = classifyConversationRow({ kind: 'timelineMarker', markerType: 'forkNotice' })
  assert.deepEqual(fork.actions.map((a) => a.id), ['navigateToForkParent'])
})

test('分类：产物行有文件图标且没有动作按钮', () => {
  const artifact = classifyConversationRow({ kind: 'artifact' })
  assert.equal(artifact.icon, 'FileIcon')
  assert.equal(artifact.view, 'ArtifactRowView')
  assert.deepEqual(artifact.actions, [])
})

// ── timelineMarker 分流 ─────────────────────────────────────────────────────

test('标记分流：只有 compact/forkNotice/modelChange/goalVerify 画分隔线', () => {
  for (const type of ['compact', 'forkNotice', 'modelChange', 'goalVerify']) {
    assert.equal(markerRenderDecision(type).renders, true, `${type} 要渲染`)
    assert.ok(markerRenderDecision(type).labelKey, `${type} 要有文案键`)
  }
  // 投影层停产 / 无 UI 的类型一律不渲染（default 兜底）。
  for (const type of ['goalSet', 'forkCreated', 'retryNotice', 'checkpointRestored', 'nope']) {
    const decision = markerRenderDecision(type)
    assert.equal(decision.renders, false, `${type} 不该渲染`)
    assert.equal(decision.icon, null)
    assert.equal(decision.labelKey, null)
  }
})

test('compact 文案：状态词与 auto 口径', () => {
  assert.equal(compactMarkerLabelKey('running', 'manual'), 'chat.contextCompaction.started')
  assert.equal(compactMarkerLabelKey('noop', 'manual'), 'chat.contextCompaction.skipped')
  assert.equal(compactMarkerLabelKey('cancelled', 'manual'), 'chat.contextCompaction.interrupted')
  assert.equal(compactMarkerLabelKey('failed', 'manual'), 'chat.contextCompaction.failed')
  assert.equal(compactMarkerLabelKey('success', 'auto'), 'chat.contextCompaction.completedAuto')
  assert.equal(compactMarkerLabelKey('success', 'manual'), 'chat.contextCompaction.completed')
  // office 模式下 auto 走「上下文优化」的另一套文案。
  assert.equal(compactMarkerLabelKey('success', 'auto', true), 'chat.contextOptimization.completed')
  assert.equal(compactMarkerLabelKey('running', 'auto', true), 'chat.contextOptimization.started')
})

test('goalVerify 文案：running/pass/其余（notSatisfied 与 failed 同归未完成）', () => {
  assert.equal(goalVerifyLabelKey('running'), 'chat.goalVerification.checking')
  assert.equal(goalVerifyLabelKey('pass'), 'chat.goalVerification.complete')
  assert.equal(goalVerifyLabelKey('notSatisfied'), 'chat.goalVerification.incomplete')
  assert.equal(goalVerifyLabelKey('failed'), 'chat.goalVerification.incomplete')
})

test('modelChange 文案：无来源（首次使用模型）走 using 且不显示切换箭头', () => {
  assert.equal(modelChangeLabelKey(true), 'chat.modelChange.switched')
  assert.equal(modelChangeLabelKey(false), 'chat.modelChange.using')
  assert.equal(markerRenderDecision('modelChange').icon, 'ArrowRightLeftIcon')
})

// ── 无法核实清单 ────────────────────────────────────────────────────────────

test('无法核实清单：非空、每条都指名了文件或字段', () => {
  assert.ok(UNVERIFIED.length >= 5)
  for (const entry of UNVERIFIED) {
    assert.ok(entry.length > 20, `条目要说得清：${entry}`)
    assert.ok(
      entry.includes('.tsx') || entry.includes('.ts') || entry.includes('行'),
      `条目要指到源码或明确说「行级」：${entry}`,
    )
  }
})
