// Agent 审批对话框复刻的判据。
//
// 每条断言都对着 .tools/ZCode 的 `文件:行号`（见 src/agentPermissionPrompt.ts 的出处注释）：
// 选项集合 / 排序 / 反馈行的应答目标 / 分类（scope + block kind）/ 保存工作流语义 /
// 电脑操控授权 / 与 src/agent.ts 的档位对接。文案全部是 zh-CN 原文。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_PERMISSION_FULL_ACCESS_OPTION_ID,
  AGENT_PERMISSION_MAX_FEEDBACK_CHARS,
  AGENT_PERMISSION_NON_USER_FACING_REASONS,
  AGENT_PERMISSION_OFFICIAL_CUA_RULE_TOOL_NAME,
  AGENT_PERMISSION_TEXTS,
  AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID,
  buildAgentPermissionRows,
  canConfirmAgentPermissionSelection,
  createAgentPermissionDecision,
  createAgentPermissionFeedbackDecision,
  decideAgentToolPermission,
  describeAgentCuaPermissionPrompt,
  describeAgentPermissionPrompt,
  describeAgentSaveWorkflowPrompt,
  describeAgentToolPermissionShape,
  formatAgentPermissionRuleScope,
  getAgentPermissionBlockInteraction,
  getAgentPermissionFeedbackCopy,
  getAgentPermissionFeedbackIndex,
  getAgentMcpPermissionToolName,
  getAgentPermissionOptionDisplayKind,
  getAgentPermissionToolFamily,
  hasAgentSaveWorkflowRefineOption,
  isAgentOfficialCuaProjectOption,
  isAgentSaveWorkflowToolCall,
  isAgentSwitchModePermissionRequest,
  isAgentWorkflowRefineOption,
  readAgentPermissionDisplayReason,
  readAgentPermissionFileChanges,
  readAgentPermissionFilePaths,
  readAgentPermissionRuleScopes,
  readAgentPermissionScope,
  readAgentSaveWorkflowInput,
  requiredAgentCuaPermissions,
  resolveAgentPermissionBlockKind,
  resolveAgentPermissionOptionDescription,
  resolveAgentPermissionOptionLabel,
  resolveAgentSaveWorkflowTitle,
  shouldPreferAgentPermissionOptionName,
  sortAgentPermissionOptions,
} from '../src/agentPermissionPrompt.ts'

// ── 测试夹具 ─────────────────────────────────────────────────────────

/** PermissionDialog.tsx:178-191：四个已知 name 的选项 + 一条自定义。 */
function baseOptions() {
  return [
    { optionId: 'o1', kind: 'allowOnce', name: 'Allow' },
    { optionId: 'o2', kind: 'allowAlways', name: 'Always allow in this project' },
    { optionId: 'o3', kind: 'deny', name: 'Deny' },
  ]
}

function requestWith(overrides = {}) {
  return {
    requestId: 'req-1',
    kind: 'Bash',
    title: 'Bash',
    description: '跑一条命令',
    options: baseOptions(),
    raw: { input: { command: 'git status' } },
    ...overrides,
  }
}

// ── 选项集合 / 分类 ─────────────────────────────────────────────────

test('display kind 按 kind 文本分类（permissionRequest.ts:30-53）', () => {
  assert.equal(getAgentPermissionOptionDisplayKind('allow_once'), 'allowOnce')
  assert.equal(getAgentPermissionOptionDisplayKind('allow_always'), 'allowAlways')
  assert.equal(getAgentPermissionOptionDisplayKind('deny'), 'rejectOnce')
  assert.equal(getAgentPermissionOptionDisplayKind('rejectAlways'), 'rejectAlways')
  assert.equal(getAgentPermissionOptionDisplayKind('approve'), 'allowOnce')
  // custom：既不含 allow/approve 也不含 deny/reject。
  assert.equal(getAgentPermissionOptionDisplayKind('switch_mode'), 'custom')
})

test('排序：允许一次 < 允许总是 < 拒绝一次 < 拒绝总是；fullAccess 落 1.5（permissionRequest.ts:71-106）', () => {
  const options = [
    { optionId: 'rejectAlways', kind: 'denyAlways', name: 'Always deny' },
    { optionId: 'allowAlways', kind: 'allowAlways', name: 'Always allow' },
    { optionId: 'allowOnce', kind: 'allowOnce', name: 'Allow' },
    { optionId: 'rejectOnce', kind: 'deny', name: 'Deny' },
  ]
  assert.deepEqual(
    sortAgentPermissionOptions(options).map((option) => option.optionId),
    ['allowOnce', 'allowAlways', 'rejectOnce', 'rejectAlways'],
  )
  const withFull = [
    { optionId: AGENT_PERMISSION_FULL_ACCESS_OPTION_ID, kind: 'custom', name: 'Full access' },
    { optionId: 'allowOnce', kind: 'allowOnce', name: 'Allow' },
    { optionId: 'allowAlways', kind: 'allowAlways', name: 'Always allow' },
    { optionId: 'rejectOnce', kind: 'deny', name: 'Deny' },
  ]
  // fullAccess 的 1.5 落在 allowAlways(1) 与 rejectOnce(2) 之间。
  assert.deepEqual(
    sortAgentPermissionOptions(withFull).map((option) => option.optionId),
    ['allowOnce', 'allowAlways', AGENT_PERMISSION_FULL_ACCESS_OPTION_ID, 'rejectOnce'],
  )
})

test('Refine 不是按钮：从行里剔除，只在反馈行做应答目标（PermissionDialog.tsx:452-460, 511）', () => {
  const refine = { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', name: 'Refine' }
  const request = requestWith({ options: [...baseOptions(), refine] })
  assert.equal(isAgentWorkflowRefineOption(refine), true)
  const rows = buildAgentPermissionRows(request)
  assert.equal(rows.filter((row) => row.kind === 'option').length, 3)
  const feedbackRow = rows.find((row) => row.kind === 'feedback')
  assert.equal(feedbackRow.option.optionId, AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID)
  assert.equal(feedbackRow.index, 3)
  assert.equal(getAgentPermissionFeedbackIndex(request), 3)
})

test('freeText=true 且无 Refine：反馈行的应答目标是第一个 reject 选项（PermissionDialog.tsx:500-511）', () => {
  const request = requestWith({ freeText: true })
  const rows = buildAgentPermissionRows(request)
  const feedbackRow = rows.find((row) => row.kind === 'feedback')
  assert.equal(feedbackRow.option.optionId, 'o3')
  assert.equal(feedbackRow.option.kind, 'deny')
})

test('freeText 缺席且无 Refine：没有反馈行（PermissionDialog.tsx:511-512）', () => {
  const rows = buildAgentPermissionRows(requestWith())
  assert.equal(rows.some((row) => row.kind === 'feedback'), false)
  assert.equal(getAgentPermissionFeedbackIndex(requestWith()), null)
})

// ── 文案 ─────────────────────────────────────────────────────────────

test('选项标签：officialCua > 命令项目授权 > 已知 name > kind 推导（PermissionDialog.tsx:736-767）', () => {
  const cuaOption = {
    optionId: 'cua',
    kind: 'allowAlways',
    name: 'Anything',
    permissionUpdates: [
      {
        type: 'addRules',
        behavior: 'allow',
        rules: [{ toolName: AGENT_PERMISSION_OFFICIAL_CUA_RULE_TOOL_NAME }],
      },
    ],
  }
  assert.equal(isAgentOfficialCuaProjectOption(cuaOption), true)
  assert.equal(
    resolveAgentPermissionOptionLabel(cuaOption, 'generic'),
    AGENT_PERMISSION_TEXTS.cuaAllowForProject,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(cuaOption, 'generic'),
    AGENT_PERMISSION_TEXTS.cuaAllowForProjectDescription,
  )

  const projectOption = { optionId: 'p', kind: 'allowAlways', name: 'Always allow in this project' }
  // scope=command 时同一选项换「始终允许此命令」（PermissionDialog.tsx:742-744）。
  assert.equal(
    resolveAgentPermissionOptionLabel(projectOption, 'command'),
    AGENT_PERMISSION_TEXTS.allowCommand,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(projectOption, 'command'),
    AGENT_PERMISSION_TEXTS.allowCommandDescription,
  )
  assert.equal(
    resolveAgentPermissionOptionLabel(projectOption, 'file'),
    AGENT_PERMISSION_TEXTS.allowForProject,
  )

  const fullAccess = { optionId: AGENT_PERMISSION_FULL_ACCESS_OPTION_ID, kind: 'custom', name: 'Full access' }
  assert.equal(
    resolveAgentPermissionOptionLabel(fullAccess, 'generic'),
    AGENT_PERMISSION_TEXTS.fullAccess,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(fullAccess, 'generic'),
    AGENT_PERMISSION_TEXTS.fullAccessDescription,
  )

  const sessionOption = { optionId: 's', kind: 'allowAlways', name: 'Always allow in this session' }
  assert.equal(
    resolveAgentPermissionOptionLabel(sessionOption, 'generic'),
    AGENT_PERMISSION_TEXTS.workflowAllowForSession,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(sessionOption, 'generic'),
    AGENT_PERMISSION_TEXTS.workflowAllowForSessionDescription,
  )

  // 通用 name（"Always allow"）走 kind 推导（PermissionDialog.tsx:747-767）。
  assert.equal(
    resolveAgentPermissionOptionLabel({ optionId: 'g', kind: 'allowAlways', name: 'Always allow' }, 'file'),
    AGENT_PERMISSION_TEXTS.approveAlways,
  )
  assert.equal(
    resolveAgentPermissionOptionLabel({ optionId: 'd', kind: 'deny', name: 'Deny' }, 'generic'),
    AGENT_PERMISSION_TEXTS.deny,
  )
})

test('描述按 scope 分档（PermissionDialog.tsx:208-221；zh-CN.ts:5627-5633）', () => {
  const option = { optionId: 'o', kind: 'allowAlways', name: 'Always allow' }
  assert.equal(
    resolveAgentPermissionOptionDescription(option, 'command'),
    AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionCommand,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(option, 'file'),
    AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionFile,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription(option, 'generic'),
    AGENT_PERMISSION_TEXTS.allowAlwaysDescriptionGeneric,
  )
  const denyAlways = { optionId: 'o2', kind: 'denyAlways', name: 'Always deny' }
  assert.equal(
    resolveAgentPermissionOptionDescription(denyAlways, 'generic'),
    AGENT_PERMISSION_TEXTS.denyAlwaysDescriptionGeneric,
  )
  assert.equal(
    resolveAgentPermissionOptionDescription({ optionId: 'o3', kind: 'deny', name: 'Deny' }, 'generic'),
    AGENT_PERMISSION_TEXTS.denyOnceDescription,
  )
})

test('自定义 name 优先直出且不出描述（permissionRequest.ts:55-69；PermissionDialog.tsx:768-771）', () => {
  const custom = { optionId: 'x', kind: 'allowAlways', name: 'switch_mode' }
  assert.equal(shouldPreferAgentPermissionOptionName(custom), true)
  assert.equal(resolveAgentPermissionOptionLabel(custom, 'generic'), 'switch_mode')
  assert.equal(resolveAgentPermissionOptionDescription(custom, 'generic'), null)
  // 通用 name 不优先（permissionRequest.ts:18-24 的白名单）。
  assert.equal(
    shouldPreferAgentPermissionOptionName({ kind: 'allowOnce', name: 'Allow once' }),
    false,
  )
})

test('反馈行文案：Refine 窗换 Refine 文案，其余窗是拒绝反馈（PermissionDialog.tsx:858-867）', () => {
  const refine = { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', name: 'Refine' }
  const refineCopy = getAgentPermissionFeedbackCopy(requestWith({ options: [...baseOptions(), refine] }))
  assert.equal(refineCopy.isRefine, true)
  assert.equal(refineCopy.ariaLabel, AGENT_PERMISSION_TEXTS.workflowRefine)
  assert.equal(refineCopy.placeholder, AGENT_PERMISSION_TEXTS.workflowRefinePlaceholder)
  const denyCopy = getAgentPermissionFeedbackCopy(requestWith({ freeText: true }))
  assert.equal(denyCopy.isRefine, false)
  assert.equal(denyCopy.ariaLabel, AGENT_PERMISSION_TEXTS.feedbackAriaLabel)
  assert.equal(denyCopy.placeholder, AGENT_PERMISSION_TEXTS.feedbackPlaceholder)
})

// ── 请求分类：scope / block kind ────────────────────────────────────

test('scope：command > file > generic（permission-request-preview.ts:352-356）', () => {
  assert.equal(readAgentPermissionScope(requestWith()), 'command')
  assert.equal(
    readAgentPermissionScope({ raw: { input: { file_path: '/a/b.ts' } } }),
    'file',
  )
  assert.equal(readAgentPermissionScope({ raw: { input: { foo: 1 } } }), 'generic')
})

test('命令与文件参数解析（permission-request-preview.ts:19-37, 85-111）', () => {
  // command + args 拼接。
  assert.deepEqual(readAgentPermissionFilePaths({ input: { path: '/x.ts' } }), ['/x.ts'])
  assert.deepEqual(
    readAgentPermissionFilePaths({ input: { paths: ['/a.ts', '/b.ts'], cwd: '/ignored' } }),
    ['/a.ts', '/b.ts'],
  )
  assert.equal(
    readAgentPermissionScope({ raw: { input: { command: 'ls', args: ['-la'] } } }),
    'command',
  )
  // fileChanges（permission-request-preview.ts:286-336）。
  assert.deepEqual(
    readAgentPermissionFileChanges({ changes: { '/a.ts': { type: 'add' }, '/b.ts': { type: 'update' } } }),
    [{ path: '/a.ts', type: 'add' }, { path: '/b.ts', type: 'update' }],
  )
})

test('block kind：SaveWorkflow 最先，其次 edit / mcp / skill / workflow / search / execute / fallback（PermissionDialog.tsx:265-312）', () => {
  // SaveWorkflow 按工具名最先判定，哪怕入参带 path（PermissionDialog.tsx:273-275）。
  assert.equal(isAgentSaveWorkflowToolCall({ kind: 'SaveWorkflow' }), true)
  assert.equal(isAgentSaveWorkflowToolCall({ kind: 'save_workflow' }), true)
  assert.equal(isAgentSaveWorkflowToolCall({ kind: 'Bash' }), false)
  assert.equal(
    resolveAgentPermissionBlockKind(requestWith({ kind: 'SaveWorkflow' })),
    'saveWorkflow',
  )
  // 有文件变更 → edit。
  assert.equal(
    resolveAgentPermissionBlockKind(requestWith({ raw: { changes: { '/a.ts': { type: 'add' } } } })),
    'edit',
  )
  // mcp__ 前缀 → mcp。
  assert.equal(
    getAgentMcpPermissionToolName({ kind: 'mcp__node_repl__js' }),
    'mcp__node_repl__js',
  )
  assert.equal(resolveAgentPermissionBlockKind(requestWith({ kind: 'mcp__foo__bar' })), 'mcp')
  // family 分流（tool-identity.ts:57-92）。
  assert.equal(getAgentPermissionToolFamily('Skill'), 'skill')
  assert.equal(getAgentPermissionToolFamily('CreateWorkflow'), 'workflow')
  assert.equal(getAgentPermissionToolFamily('WebFetch'), 'search')
  assert.equal(getAgentPermissionToolFamily('Bash'), 'shell')
  assert.equal(getAgentPermissionToolFamily('NoSuchTool'), null)
  assert.equal(resolveAgentPermissionBlockKind(requestWith({ kind: 'Skill' })), 'skill')
  assert.equal(resolveAgentPermissionBlockKind(requestWith({ kind: 'CreateWorkflow' })), 'workflow')
  assert.equal(resolveAgentPermissionBlockKind(requestWith({ kind: 'WebFetch' })), 'search')
  // 有 command → execute；无 command 无文件 → fallback。
  assert.equal(resolveAgentPermissionBlockKind(requestWith()), 'execute')
  assert.equal(
    resolveAgentPermissionBlockKind(requestWith({ kind: 'TodoWrite', raw: { input: {} } })),
    'fallback',
  )
})

test('权限块不可折叠（PermissionDialog.tsx:314-336）', () => {
  assert.deepEqual(getAgentPermissionBlockInteraction('edit'), { canToggle: false, forceOpen: false })
  for (const kind of ['mcp', 'skill', 'search', 'execute', 'workflow', 'saveWorkflow', 'fallback']) {
    assert.deepEqual(getAgentPermissionBlockInteraction(kind), { canToggle: false, forceOpen: true })
  }
})

test('switch-mode 用占位符而不是 displayReason（PermissionDialog.tsx:685-687）', () => {
  assert.equal(isAgentSwitchModePermissionRequest(requestWith({ kind: 'ExitPlanMode' })), true)
  assert.equal(isAgentSwitchModePermissionRequest(requestWith({ kind: 'Bash' })), false)
})

test('displayReason 丢弃非用户可见原因（PermissionDialog.tsx:75-78, 227-232）', () => {
  for (const reason of AGENT_PERMISSION_NON_USER_FACING_REASONS) {
    assert.equal(readAgentPermissionDisplayReason(requestWith({ description: reason })), null)
  }
  assert.equal(
    readAgentPermissionDisplayReason(requestWith({ raw: { input: { description: '要改配置文件' } } })),
    '要改配置文件',
  )
  // input 优先于 request.description（PermissionDialog.tsx:234-245）。
  assert.equal(
    readAgentPermissionDisplayReason(
      requestWith({ description: '外层说明', raw: { input: { reason: '内层说明' } } }),
    ),
    '内层说明',
  )
})

test('规则前缀只认 bash + `:*`，最多 5 条且截断到 160（PermissionDialog.tsx:80-105）', () => {
  const option = {
    optionId: 'a',
    kind: 'allowAlways',
    name: 'Always allow',
    permissionUpdates: [
      {
        type: 'addRules',
        behavior: 'allow',
        rules: [
          { toolName: 'Bash', ruleContent: 'git status:*' },
          { toolName: 'Bash', ruleContent: 'npm run build' },
          { toolName: 'Write', ruleContent: 'x:*' },
        ],
      },
    ],
  }
  const scopes = readAgentPermissionRuleScopes(option)
  assert.equal(scopes.length, 1)
  assert.equal(scopes[0].display, 'git status …')
  assert.equal(scopes[0].truncated, false)
  const long = formatAgentPermissionRuleScope('a'.repeat(200))
  assert.equal(long.truncated, true)
  assert.equal(long.display.endsWith(' …'), true)
})

// ── 决策结果 ────────────────────────────────────────────────────────

test('拒绝顺带把草稿当理由发出；允许不带（PermissionDialog.tsx:559-571）', () => {
  const request = requestWith({ freeText: true })
  const deny = createAgentPermissionDecision(request, request.options[2], '  换个做法  ')
  assert.deepEqual(deny, { optionId: 'o3', kind: 'deny', feedback: '换个做法' })
  const allow = createAgentPermissionDecision(request, request.options[0], 'ignored')
  assert.deepEqual(allow, { optionId: 'o1', kind: 'allowOnce' })
})

test('工作流窗点 Deny 是普通拒绝：草稿属于 Refine（PermissionDialog.tsx:562-567）', () => {
  const refine = { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', name: 'Refine' }
  const request = requestWith({ options: [...baseOptions(), refine], freeText: true })
  const decision = createAgentPermissionDecision(request, request.options[2], '这段修改意见')
  assert.deepEqual(decision, { optionId: 'o3', kind: 'deny' })
})

test('反馈提交：纯空白不算反馈（PermissionDialog.tsx:573-580）', () => {
  const refine = { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', name: 'Refine' }
  const request = requestWith({ options: [...baseOptions(), refine] })
  assert.equal(createAgentPermissionFeedbackDecision(request, '   '), null)
  assert.deepEqual(
    createAgentPermissionFeedbackDecision(request, '把并发降到 2'),
    { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', feedback: '把并发降到 2' },
  )
  // 超长反馈被拒（snapshot.ts:227 MAX_PERMISSION_FEEDBACK_CHARS）。
  assert.equal(
    createAgentPermissionFeedbackDecision(request, 'x'.repeat(AGENT_PERMISSION_MAX_FEEDBACK_CHARS + 1)),
    null,
  )
})

test('键盘：确认按钮的 disabled 与选中判据（PermissionDialog.tsx:905-915）', () => {
  const request = requestWith({ freeText: true })
  assert.equal(canConfirmAgentPermissionSelection(request, 0, '', false), true)
  assert.equal(canConfirmAgentPermissionSelection(request, 3, '  ', false), false)
  assert.equal(canConfirmAgentPermissionSelection(request, 3, '说明', false), true)
  assert.equal(canConfirmAgentPermissionSelection(request, 0, '', true), false)
  assert.equal(canConfirmAgentPermissionSelection(request, 9, '', false), false)
})

// ── SaveWorkflow 保存确认 ───────────────────────────────────────────

test('保存确认：覆盖与新建是两句不同的问句（SaveWorkflowPermissionBlock.tsx:131-135）', () => {
  assert.equal(
    resolveAgentSaveWorkflowTitle(readAgentSaveWorkflowInput({ overwrite: true })),
    AGENT_PERMISSION_TEXTS.workflowSaveOverwriteTitle,
  )
  assert.equal(
    resolveAgentSaveWorkflowTitle(readAgentSaveWorkflowInput({})),
    AGENT_PERMISSION_TEXTS.workflowSaveTitle,
  )
})

test('保存入参：只有显式 true 才是覆盖；名称回退；参数表（save-workflow.tsx:84-104）', () => {
  const input = readAgentSaveWorkflowInput({
    name: '  发布检查  ',
    path: '/w/.zcode/workflows/x.md',
    overwrite: 'true',
    script: 'export default 1',
    args: {
      target: { type: 'string', required: true, description: '目标分支' },
      dry: { type: 'boolean', default: false },
    },
  })
  assert.equal(input.name, '发布检查')
  assert.equal(input.overwrite, false, '字符串 "true" 不是覆盖')
  assert.equal(input.args.length, 2)
  assert.equal(input.args[0].required, true)
  assert.equal(input.args[0].description, '目标分支')
  assert.equal(input.args[1].hasDefault, true, 'default:false 与「没有默认值」必须可分辨')
  assert.equal(input.args[1].defaultValue, false)
  const prompt = describeAgentSaveWorkflowPrompt(input)
  assert.equal(prompt.title, AGENT_PERMISSION_TEXTS.workflowSaveTitle)
  assert.equal(prompt.overwriteBadge, null)
  assert.equal(prompt.argsLabel, AGENT_PERMISSION_TEXTS.workflowSaveArgs)
  const overwrite = describeAgentSaveWorkflowPrompt(readAgentSaveWorkflowInput({ overwrite: true }))
  assert.equal(overwrite.overwriteBadge, AGENT_PERMISSION_TEXTS.workflowSaveOverwriteBadge)
  assert.equal(overwrite.overwriteHint, AGENT_PERMISSION_TEXTS.workflowSaveOverwriteHint)
  assert.equal(overwrite.name, AGENT_PERMISSION_TEXTS.workflowFallbackName)
})

test('保存 gate 刻意不接 Refine（SaveWorkflowPermissionBlock.tsx:110-116）', () => {
  assert.equal(hasAgentSaveWorkflowRefineOption(requestWith({ kind: 'SaveWorkflow' })), false)
  const refine = { optionId: AGENT_PERMISSION_WORKFLOW_REFINE_OPTION_ID, kind: 'deny', name: 'Refine' }
  assert.equal(
    hasAgentSaveWorkflowRefineOption(requestWith({ options: [...baseOptions(), refine] })),
    true,
  )
})

// ── 电脑操控 ────────────────────────────────────────────────────────

test('电脑操控授权：缺哪项补哪项（cuaPermission.ts:16-27）', () => {
  assert.deepEqual(
    requiredAgentCuaPermissions({ accessibility: 'denied', screenRecording: 'denied' }),
    ['accessibility', 'screen_recording'],
  )
  assert.deepEqual(
    requiredAgentCuaPermissions({ accessibility: 'stale', screenRecording: 'unknown' }),
    ['accessibility'],
  )
  assert.deepEqual(
    requiredAgentCuaPermissions({ accessibility: 'granted', screenRecording: 'granted' }),
    [],
  )
  const copy = describeAgentCuaPermissionPrompt()
  assert.equal(copy.title, AGENT_PERMISSION_TEXTS.cuaLiveTitle)
  assert.equal(copy.description, AGENT_PERMISSION_TEXTS.cuaLiveDescription)
  assert.equal(copy.confirmLabel, AGENT_PERMISSION_TEXTS.cuaLiveConfirm)
  assert.equal(copy.cancelLabel, AGENT_PERMISSION_TEXTS.cuaLiveCancel)
})

// ── 与 src/agent.ts 的对接 ─────────────────────────────────────────

test('档位映射与判定逐字对齐 src/agent.ts:35-38', () => {
  const levels = { read: 'allow', write: 'ask', run: 'ask', network: 'never' }
  assert.equal(decideAgentToolPermission('read_file', levels), 'allow')
  assert.equal(decideAgentToolPermission('write_file', levels), 'ask')
  assert.equal(decideAgentToolPermission('run_command', levels), 'ask')
  assert.equal(decideAgentToolPermission('fetch_network', levels), 'deny')
  assert.deepEqual(
    ['read_file', 'write_file', 'run_command', 'fetch_network'].map((tool) =>
      describeAgentToolPermissionShape(tool).slot),
    ['read', 'write', 'run', 'network'],
  )
})

test('工具 → 审批形状（PermissionDialog.tsx:265-312）', () => {
  assert.deepEqual(describeAgentToolPermissionShape('write_file'), {
    slot: 'write', blockKind: 'edit', scope: 'file',
  })
  assert.deepEqual(describeAgentToolPermissionShape('run_command'), {
    slot: 'run', blockKind: 'execute', scope: 'command',
  })
  // tool-identity.ts:62-66：WebFetch / WebSearch 都归 search。
  assert.deepEqual(describeAgentToolPermissionShape('fetch_network'), {
    slot: 'network', blockKind: 'search', scope: 'generic',
  })
})

test('describeAgentPermissionPrompt：一次给全「怎么问」的形状', () => {
  const prompt = describeAgentPermissionPrompt('run_command', requestWith({ freeText: true }))
  assert.equal(prompt.scope, 'command')
  assert.equal(prompt.blockKind, 'execute')
  assert.equal(prompt.displayReason, '跑一条命令')
  assert.equal(prompt.interaction.forceOpen, true)
  assert.equal(prompt.isSwitchMode, false)
  assert.equal(prompt.feedback.isRefine, false)
  assert.equal(prompt.rows.length, 4, '3 个选项 + 1 个反馈行')
})
