// `agent/conversation-chrome` 判据：把 src/agentConversationChrome.ts 的每条形状 / 派生 / 状态机
// **逐条对回 .tools/ZCode 源码**。
//
// 三层：
//   ① 文案表：每条键在 zh-CN.ts 里逐字存在、行号指得对（指错 = 后来人扑空）；
//   ② 引用锚点：注释里的 `文件:行号` 真实存在、行号在文件长度内、锚点内容对得上；
//   ③ 纯函数：queue 拖拽锚点 / queue-guide 分流 / 待办引导行 / Todo 折叠窗 / 胶囊兜底链 /
//      轮次导航目录与活动项 / 额度条消息键，逐条断言真实语义。
//
// 「不许出现 X」型的门都配了阳性对照 —— 本仓吃过空判据的亏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENT_CHROME_TEXTS,
  AGENT_CHROME_HEADER_ELEMENTS,
  AGENT_CHROME_UI_SRC,
  AGENT_CHROME_SHARED_SRC,
  AGENT_CHROME_LOCALE_FILE,
  AGENT_INTERACTION_BEHAVIORS,
  AGENT_INPUT_ROUTING_MODES,
  AGENT_QUEUE_DELIVERY_ADMITTED,
  AGENT_QUEUE_DELIVERY_REQUESTED,
  AGENT_QUEUE_DISPATCH_STATES,
  AGENT_QUEUE_INTENT_DISPATCH_STATES,
  AGENT_QUEUE_KINDS,
  AGENT_QUEUE_PAUSE_REASONS,
  AGENT_QUEUE_STEER_STATES,
  AGENT_SESSION_PHASES,
  AGENT_HELD_QUEUE_DISPOSITIONS,
  AGENT_BACKGROUND_WORK_KINDS,
  AGENT_RUNNING_SUBAGENT_STATUSES,
  AGENT_PENDING_GUIDE_STATUS_KEY,
  AGENT_STATUS_PANEL_VARIANTS,
  AGENT_STATUS_SECTIONS,
  AGENT_STATUS_SECTION_DEFAULT_OPEN,
  AGENT_STATUS_SECTION_SCROLL,
  AGENT_STATUS_SECTION_TITLE_KEYS,
  AGENT_STATUS_SUMMARY_BRANCHES,
  AGENT_STATUS_COMPACT_TODO_THRESHOLD,
  AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE,
  AGENT_GOAL_STATUSES,
  AGENT_WORKFLOW_RUN_STATUSES,
  AGENT_BACKGROUND_WORK_STATUSES,
  agentChromeText,
  headerHasFloatingActions,
  headerBadgeAttributes,
  queueRowLocked,
  queueRowLabel,
  queueSendNowLabelKey,
  queueRowCanEdit,
  queuePausedMessageKey,
  queuePanelVisible,
  resolveQueueReorderAnchor,
  canResumePausedQueue,
  canEditQueueItem,
  queueEditBlockedReason,
  shouldRestoreQueueItemToComposer,
  resolveAppFollowupMode,
  resolveOppositeFollowupDelivery,
  resolveFollowupModifierTooltip,
  projectPendingGuideQueue,
  inputRoutingAllowsSend,
  showStopControl,
  composerSendLabelKey,
  requiresHeldQueueConfirmation,
  pendingGuideRow,
  pendingGuideListVisible,
  resolveStatusPanelVariant,
  shouldUseStatusPanelInlineLayout,
  statusPanelMenuValue,
  statusPanelMenuChange,
  statusPanelDataState,
  statusPanelVisible,
  canRenderEndedWorkflows,
  canRenderEndedAgents,
  statusSectionVisibility,
  runningWorkCount,
  runningSummaryIconKind,
  resolveStatusSummaryBranch,
  getCurrentPlanItem,
  getCompletedPlanItem,
  isPausableGoalStatus,
  isActiveGoalStatus,
  goalControlFor,
  planItemIconKind,
  planTodoFocusWindow,
  todoFoldMessageKey,
  planIsCompleted,
  formatStatusDurationParts,
  hasGitMiniSummary,
  planModelVisible,
  isSessionPlanRow,
  isActiveWorkflowRunStatus,
  workflowRunStatusTextKey,
  workflowRunDisplayName,
  workflowRunCanStop,
  workflowRunCanOpen,
} from '../src/agentConversationChrome.ts'

import {
  AGENT_TURN_NAVIGATOR_ASSISTANT_PREVIEW_KINDS,
  AGENT_TURN_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS,
  AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX,
  AGENT_TURN_NAVIGATOR_MAX_PREVIEW_CHARS,
  turnNavigatorVisible,
  turnNavigatorItemKey,
  buildTurnNavigatorItems,
  resolveTurnNavigatorActiveUnitIndex,
  resolveTurnNavigatorActiveQueryRowId,
  resolveTurnNavigatorBarVisualState,
  resolveTurnNavigatorVisualFocusItemIndex,
  turnNavigatorJumpBehavior,
  shouldHydrateTurnNavigatorDirectory,
  turnNavigatorHydrationRetryDelayMs,
} from '../src/agentTurnNavigator.ts'

import {
  AGENT_QUOTA_BANNER_KINDS,
  AGENT_QUOTA_MESSAGE_IDS,
  AGENT_QUOTA_PRIORITY,
  AGENT_QUOTA_LOW_RATIO_THRESHOLD,
  resolveQuotaMessageId,
  isQuotaVeryLow,
  quotaBannerVisible,
  shouldOfferQuotaUpgrade,
  quotaBannerDismissible,
} from '../src/agentQuotaBanner.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ui = join(root, AGENT_CHROME_UI_SRC)
const shared = join(root, AGENT_CHROME_SHARED_SRC)

/** ZCode 源码树在不在：不在就跳过依赖它的断言（与 tests/source-citations.test.mjs 同处理）。 */
const hasZCode = existsSync(ui) && existsSync(shared)
const skipIfNoZCode = { skip: hasZCode ? false : 'ZCode 参考树不在本机' }

// ZCode 树在本机是 CRLF（Windows clone），统一折成 LF 再切行，否则行号会偏。
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const lines = p => read(p).split('\n')
const uiFile = p => join(ui, p.replace(`${AGENT_CHROME_UI_SRC}/`, ''))

/** 解 `文件:行号` 或 `文件:行号,行号-行号`（与 tests/agent-composer-layout.test.mjs 同款）。 */
function parseCitation(at) {
  const m = /^(.+?):([\d,\-]+)$/.exec(at)
  assert.ok(m, `引用形状不对：${at}`)
  const nums = []
  for (const part of m[2].split(',')) {
    const r = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    assert.ok(r, `行号段不对：${part}（在 ${at}）`)
    for (let n = Number(r[1]); n <= Number(r[2] ?? r[1]); n++) nums.push(n)
  }
  return { file: m[1], nums }
}

/** 引用的文件必须存在、行号必须在长度内。返回该文件的行数组。 */
function loadCitation(at) {
  const { file, nums } = parseCitation(at)
  const abs = join(root, file)
  assert.ok(existsSync(abs), `引用的文件不存在：${file}（来自 ${at}）`)
  const body = lines(abs)
  for (const n of nums) {
    assert.ok(n >= 1 && n <= body.length, `${at} 的行号 ${n} 超出 ${file} 长度 ${body.length}`)
  }
  return body
}

// ── ① 文案表 ───────────────────────────────────────────────────────────────

test('文案表：每条键在 zh-CN.ts 里逐字存在，行号指得对', skipIfNoZCode, () => {
  const locale = uiFile('i18n/locales/zh-CN.ts')
  assert.ok(existsSync(locale), 'zh-CN 词条文件必须在')
  const body = lines(locale)
  const whole = read(locale)
  assert.ok(AGENT_CHROME_TEXTS.length >= 90, `词条表太薄（${AGENT_CHROME_TEXTS.length} 条），疑似被删空`)

  for (const entry of AGENT_CHROME_TEXTS) {
    assert.ok(entry.at.startsWith(`${AGENT_CHROME_LOCALE_FILE}:`), `${entry.key} 的 at 必须指 zh-CN.ts`)
    const lineNumber = Number(entry.at.split(':').pop())
    const line = body[lineNumber - 1] ?? ''
    assert.ok(line.includes(`"${entry.key}"`), `${entry.key} 的行号 ${entry.at} 指到了别处：${line.trim()}`)
    // 值可能折到下一行（长句），所以在键之后 200 字符内找原文，别只看本行。
    const keyIndex = whole.indexOf(`"${entry.key}"`)
    const window = whole.slice(keyIndex, keyIndex + 200)
    assert.ok(window.includes(entry.zh), `${entry.key} 的原文与 zh-CN.ts 不一致：表里「${entry.zh}」`)
  }
})

test('文案表：无重复键，且 agentChromeText 命中表内键、对表外键返回空串', () => {
  const keys = AGENT_CHROME_TEXTS.map(entry => entry.key)
  assert.equal(new Set(keys).size, keys.length, '文案表有重复键')
  assert.equal(agentChromeText('chat.queue.resume'), '继续')
  assert.equal(agentChromeText('chat.queue.paused.stopped'), '由于你中断了当前响应，队列已暂停')
  // 阳性对照：表外键必须返回空串（不猜）。
  assert.equal(agentChromeText('chat.definitely.not.a.key'), '')
})

test('文案表：交互行为两档的词条原文与 zh-CN 一致', skipIfNoZCode, () => {
  assert.deepEqual([...AGENT_INTERACTION_BEHAVIORS], ['queue', 'guide'])
  assert.equal(agentChromeText('settings.zcodeInteractionBehavior.option.queue'), '队列')
  assert.equal(agentChromeText('settings.zcodeInteractionBehavior.option.guide'), '引导')
})

// ── ② 引用锚点 ─────────────────────────────────────────────────────────────

test('文案表：consumer 标注与全树消费方事实一致（不许把零消费方键当活 UI）', skipIfNoZCode, () => {
  const zcode = join(root, '.tools/ZCode')
  // 只扫 apps + packages 的代码文件，排除 locales（词条文件本身不算消费方）。
  const codeFiles = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (!['node_modules', 'dist', 'build', '.git'].includes(name)) walk(p); continue }
      if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !p.includes('i18n')) codeFiles.push(p)
    }
  }
  walk(join(zcode, 'apps'))
  walk(join(zcode, 'packages'))
  assert.ok(codeFiles.length > 1000, `扫到的代码文件太少（${codeFiles.length}），walk 可能没走对`)
  const bodies = codeFiles.map(f => readFileSync(f, 'utf8'))
  const hasLiteral = key => bodies.some(body => body.includes(`"${key}"`) || body.includes(`'${key}'`))

  let checked = 0
  for (const entry of AGENT_CHROME_TEXTS) {
    const literal = hasLiteral(entry.key)
    if (entry.consumer === 'literal') {
      assert.ok(literal, `${entry.key} 标成 literal，但全树没有字面量消费方`)
    } else if (entry.consumer === 'none') {
      assert.equal(literal, false, `${entry.key} 标成 none，但全树其实有字面量消费方 —— 标注过时了`)
    } else {
      // dynamic：键由模板串拼出，字面量扫不到；只允许两条已知动态键族。
      assert.ok(
        entry.key.startsWith('chat.toolCall.workflow.run.status.') || entry.key.startsWith('settings.zcodeInteractionBehavior.option.'),
        `${entry.key} 标成 dynamic，但它不在两条已知的动态键族里`,
      )
      assert.equal(literal, false, `${entry.key} 是动态键，不该有字面量消费方`)
    }
    checked += 1
  }
  assert.ok(checked >= 90, `consumer 标注只核了 ${checked} 条，疑似表被删薄`)
  // 阳性对照：workflowRunStatusTextKey 拼出的键确实与 dynamic 条目同族。
  assert.equal(workflowRunStatusTextKey('running'), 'chat.toolCall.workflow.run.status.running')
  assert.equal(AGENT_CHROME_TEXTS.some(e => e.key === workflowRunStatusTextKey('running') && e.consumer === 'dynamic'), true)
})

test('模块注释里的 `文件:行号` 全部指向真实存在的行', skipIfNoZCode, () => {
  // 短名 → 真实路径（模块注释里按上游文件名短写）。
  const MAP = {
    'ConversationHeader.tsx': 'v4/ConversationHeader.tsx',
    'ConversationQueuePanel.tsx': 'v4/ConversationQueuePanel.tsx',
    'ConversationPendingGuideList.tsx': 'v4/ConversationPendingGuideList.tsx',
    'ConversationStatusPanel.tsx': 'v4/ConversationStatusPanel.tsx',
    'ConversationTurnNavigator.tsx': 'v4/ConversationTurnNavigator.tsx',
    'ConversationQuotaBanner.tsx': 'v4/ConversationQuotaBanner.tsx',
    'ConversationComposer.tsx': 'v4/ConversationComposer.tsx',
    'SessionPane.tsx': 'v4/SessionPane.tsx',
    'conversationStatusPanelModel.ts': 'v4/conversationStatusPanelModel.ts',
    'conversationLayout.ts': 'v4/conversationLayout.ts',
    'conversationTurnNavigatorHelpers.ts': 'v4/conversationTurnNavigatorHelpers.ts',
    'conversationTurnRenderUnits.ts': 'v4/conversationTurnRenderUnits.ts',
    'sessionQuotaBannerState.ts': 'v4/sessionQuotaBannerState.ts',
    'pendingGuideProjection.ts': 'v4/pendingGuideProjection.ts',
    'followupModeSettings.ts': 'v4/composer/followupModeSettings.ts',
    'settingsPageHelpers.tsx': 'settingsPageHelpers.tsx',
    'helpers': 'v4/conversationTurnNavigatorHelpers.ts',
  }
  const SHARED = {
    'input-intent.ts': 'zcode-protocol-v4/input-intent.ts',
    'snapshot.ts': 'zcode-protocol-v4/snapshot.ts',
    'command.ts': 'zcode-protocol-v4/command.ts',
    'workflow-runs.ts': 'zcode-protocol-v4/workflow-runs.ts',
    'protocol.ts': 'protocol.ts',
    'validationAppSettings.ts': 'validationAppSettings.ts',
    'test-ids.ts': 'test-ids.ts',
  }
  const module = read(join(root, 'src/agentConversationChrome.ts'))
  const re = /([A-Za-z][\w.\-]*\.(?:tsx|ts)|helpers):(\d+)(?:-(\d+))?/g
  const lengths = new Map()
  const lengthOf = abs => {
    if (!lengths.has(abs)) lengths.set(abs, lines(abs).length)
    return lengths.get(abs)
  }
  let count = 0
  for (const match of module.matchAll(re)) {
    const [, name, startRaw, endRaw] = match
    const rel = MAP[name] ? join(ui, MAP[name]) : SHARED[name] ? join(shared, SHARED[name]) : null
    assert.ok(rel, `模块注释里出现未知短名 ${name}（${match[0]}）`)
    assert.ok(existsSync(rel), `${match[0]} 的文件不存在`)
    const total = lengthOf(rel)
    const start = Number(startRaw)
    const end = endRaw ? Number(endRaw) : start
    assert.ok(start >= 1 && start <= total, `${match[0]} 首行越界（文件 ${total} 行）`)
    assert.ok(end >= start && end <= total, `${match[0]} 末行越界（文件 ${total} 行）`)
    count += 1
  }
  assert.ok(count >= 60, `模块注释里只核到 ${count} 处引用，疑似注释被删空`)
})

test('头部元素表：每条 testId 在 shared/test-ids.ts 里有常量，且 online 标记与源码一致', skipIfNoZCode, () => {
  const testIds = read(join(shared, 'test-ids.ts'))
  const header = read(uiFile('v4/ConversationHeader.tsx'))
  assert.ok(AGENT_CHROME_HEADER_ELEMENTS.length >= 5, '头部元素表太薄')

  for (const element of AGENT_CHROME_HEADER_ELEMENTS) {
    assert.ok(testIds.includes(`"${element.testId}"`), `${element.testId} 在 test-ids.ts 里没有定义`)
    loadCitation(element.at)
  }
  // 阳性对照：会话标题与关闭窗格确实在源码里（:45 / :98）。
  assert.ok(header.includes('TID_V4_SESSION_TITLE'), '标题投影必须在源码里')
  assert.ok(header.includes('TID_V4_SPLIT_CLOSE'), '关闭窗格按钮必须在源码里')
  // 下线判定：两个拆分入口整段在 JSX 块注释里（:64 开始，:92 结束）。
  const onlineSplits = AGENT_CHROME_HEADER_ELEMENTS.filter(e => e.id === 'splitRight' || e.id === 'splitDown')
  assert.equal(onlineSplits.every(e => e.online === false), true, '拆分入口必须标成下线')
  const headerLines = header.split('\n')
  const commentStart = headerLines.findIndex(line => line.includes('产品侧暂时下线 pane chrome 拆分入口'))
  // 注释块到 `{onClosePane` 之前为止（两段 JSX 块注释都在这一段里）。
  const commentEnd = headerLines.findIndex((line, i) => i > commentStart && line.includes('{onClosePane ? ('))
  assert.ok(commentStart >= 0 && commentEnd > commentStart, '下线注释块必须在源码里')
  const commented = headerLines.slice(commentStart, commentEnd + 1).join('\n')
  assert.ok(commented.includes('TID_V4_SPLIT_OPEN'), 'TID_V4_SPLIT_OPEN 在下线注释块里')
  assert.ok(commented.includes('TID_V4_SPLIT_DOWN'), 'TID_V4_SPLIT_DOWN 在下线注释块里')
  // 阳性对照：注释块之外没有第二处 SPLIT_OPEN 用法。
  const outside = headerLines.filter((line, i) => !(i >= commentStart && i <= commentEnd) && line.includes('TID_V4_SPLIT_OPEN'))
  assert.deepEqual(outside, [], 'TID_V4_SPLIT_OPEN 只该出现在下线注释块里')
})

test('队列闭集：与 snapshot.ts / input-intent.ts 的 z.enum 逐字一致', skipIfNoZCode, () => {
  const snapshotSrc = read(join(shared, 'zcode-protocol-v4/snapshot.ts'))
  const intentSrc = read(join(shared, 'zcode-protocol-v4/input-intent.ts'))

  assert.ok(snapshotSrc.includes('z.enum(["queued", "reserved", "promoting"])'), 'queueItem dispatch 闭集')
  assert.deepEqual([...AGENT_QUEUE_DISPATCH_STATES], ['queued', 'reserved', 'promoting'])
  assert.ok(intentSrc.includes('z.enum(["admitted", "queued", "reserved", "promoting", "drained"])'), 'intent dispatch 闭集')
  assert.ok(intentSrc.includes('z.enum(["sendText", "sendGoalCommand", "compact"])'), 'kind 闭集')
  assert.deepEqual([...AGENT_QUEUE_KINDS], ['sendText', 'sendGoalCommand', 'compact'])
  assert.ok(snapshotSrc.includes('z.enum(["stopped", "manual", "error"])'), 'pauseReason 闭集')
  assert.deepEqual([...AGENT_QUEUE_PAUSE_REASONS], ['stopped', 'manual', 'error'])
  assert.ok(intentSrc.includes('z.enum(["auto", "startNow", "queue", "guide"])'), 'requested 闭集')
  assert.ok(intentSrc.includes('z.enum(["startNow", "queue", "guide"])'), 'admitted 闭集')
  assert.deepEqual([...AGENT_QUEUE_DELIVERY_ADMITTED], ['startNow', 'queue', 'guide'])
  assert.ok(
    intentSrc.includes('z.enum(["notRequested", "submitting", "steering", "guided", "fellBack"])'),
    'steer 相位闭集',
  )
  assert.deepEqual([...AGENT_QUEUE_STEER_STATES], ['notRequested', 'submitting', 'steering', 'guided', 'fellBack'])
})

test('状态/路由/phase 闭集：与 snapshot.ts、protocol.ts 一致', skipIfNoZCode, () => {
  const snapshotSrc = read(join(shared, 'zcode-protocol-v4/snapshot.ts'))
  const protocolSrc = read(join(shared, 'protocol.ts'))
  const workflowSrc = read(join(shared, 'zcode-protocol-v4/workflow-runs.ts'))

  assert.ok(snapshotSrc.includes('z.enum(["startNow", "enqueue", "guide", "reject", "choice"])'), 'inputRouting 闭集')
  assert.deepEqual([...AGENT_INPUT_ROUTING_MODES], ['startNow', 'enqueue', 'guide', 'reject', 'choice'])
  assert.ok(
    snapshotSrc.includes('z.enum(["active", "paused", "verifying", "verified", "notSatisfied", "failed"])'),
    'goal status 闭集',
  )
  assert.deepEqual([...AGENT_GOAL_STATUSES], ['active', 'paused', 'verifying', 'verified', 'notSatisfied', 'failed'])
  assert.ok(
    snapshotSrc.includes('z.enum(["running", "resultPending", "failed", "cancelled"])'),
    'background work status 闭集',
  )
  assert.deepEqual([...AGENT_BACKGROUND_WORK_STATUSES], ['running', 'resultPending', 'failed', 'cancelled'])
  assert.ok(
    workflowSrc.includes('z.enum(["pending", "running", "completed", "errored", "stopped"])'),
    'workflow run status 闭集',
  )
  assert.deepEqual([...AGENT_WORKFLOW_RUN_STATUSES], ['pending', 'running', 'completed', 'errored', 'stopped'])
  assert.ok(protocolSrc.includes('export type ZCodeInteractionBehavior = "queue" | "guide";'), '交互行为两档')
  assert.ok(snapshotSrc.includes('"draft",') && snapshotSrc.includes('"completedInterrupted",'), 'session phase 闭集')
  // 其余三个闭集逐字核（全量断言，不是抽样）。
  assert.deepEqual([...AGENT_QUEUE_INTENT_DISPATCH_STATES], ['admitted', 'queued', 'reserved', 'promoting', 'drained'])
  assert.deepEqual([...AGENT_QUEUE_DELIVERY_REQUESTED], ['auto', 'startNow', 'queue', 'guide'])
  assert.deepEqual([...AGENT_SESSION_PHASES], ['draft', 'prewarming', 'running', 'completedSuccess', 'completedInterrupted', 'error'])
  assert.ok(snapshotSrc.includes('"prewarming",') && snapshotSrc.includes('"completedSuccess",') && snapshotSrc.includes('"error",'))
  assert.deepEqual([...AGENT_BACKGROUND_WORK_KINDS], ['bash', 'subagent', 'workflow'])
  assert.ok(snapshotSrc.includes('z.enum(["bash", "subagent", "workflow"])'), 'background work kind 闭集')
  assert.deepEqual([...AGENT_RUNNING_SUBAGENT_STATUSES], ['running', 'waiting', 'blocked'])
  assert.ok(snapshotSrc.includes('z.enum(["running", "waiting", "blocked"])'), 'subagent 运行态闭集')
  assert.deepEqual([...AGENT_HELD_QUEUE_DISPOSITIONS], ['clearQueueAndSend', 'keepQueueAndSend'])
  assert.ok(read(join(shared, 'zcode-protocol-v4/command.ts')).includes('z.enum(["clearQueueAndSend", "keepQueueAndSend"])'))
  assert.deepEqual([...AGENT_STATUS_PANEL_VARIANTS], ['auto', 'mini', 'panel'])
  assert.ok(read(uiFile('v4/legacyChatViewTypes.ts')).includes('"mini"'), '面板变体取值')
  assert.deepEqual([...AGENT_TURN_NAVIGATOR_ASSISTANT_PREVIEW_KINDS], ['empty', 'running', 'text'])
  assert.ok(read(uiFile('v4/conversationTurnNavigatorHelpers.ts')).includes('"empty" | "running" | "text"'))
  assert.equal(AGENT_TURN_NAVIGATOR_MAX_PREVIEW_PARAGRAPHS, 2)
  assert.equal(AGENT_PENDING_GUIDE_STATUS_KEY, 'chat.message.turnSteer.pending')
})

test('状态面板分区：标题键 / 限高 / 默认展开三张表在源码里指得对', skipIfNoZCode, () => {
  const panel = read(uiFile('v4/ConversationStatusPanel.tsx'))
  assert.deepEqual([...AGENT_STATUS_SECTIONS], ['environment', 'goal', 'sessionPlans', 'plan', 'terminal', 'workflow', 'agent'])
  assert.deepEqual(AGENT_STATUS_SECTION_SCROLL, {
    environment: null, goal: 'max-h-48', sessionPlans: 'max-h-48', plan: 'max-h-80',
    terminal: 'max-h-48', workflow: 'max-h-48', agent: 'max-h-48',
  })
  assert.ok(panel.includes('plan: "max-h-80"'), 'plan 的限高必须与源码一致')
  assert.deepEqual(AGENT_STATUS_SECTION_DEFAULT_OPEN, {
    environment: true, goal: true, sessionPlans: true, plan: true,
    terminal: false, workflow: false, agent: false,
  })
  for (const key of Object.values(AGENT_STATUS_SECTION_TITLE_KEYS)) {
    assert.ok(panel.includes(`id: "${key}"`), `分区标题键 ${key} 在面板源码里没有消费方`)
  }
  // 三类实时活动分区 defaultOpen={false} 各一处（阳性对照：plan 的分区不带该 prop）。
  const falseOccurrences = panel.split('defaultOpen={false}').length - 1
  assert.ok(falseOccurrences >= 3, `terminal/workflow/agent 三处 defaultOpen={false}，实际 ${falseOccurrences}`)
})

test('轮次导航：常量与预览口径在 helpers 里指得对', skipIfNoZCode, () => {
  const helpers = read(uiFile('v4/conversationTurnNavigatorHelpers.ts'))
  assert.equal(AGENT_TURN_NAVIGATOR_MIN_WIDTH_PX, 864)
  assert.ok(helpers.includes('CONVERSATION_TURN_NAVIGATOR_MIN_WIDTH_PX = 864'), '最小宽常量')
  assert.equal(AGENT_TURN_NAVIGATOR_MAX_PREVIEW_CHARS, 220)
  assert.ok(helpers.includes('DEFAULT_MAX_PREVIEW_CHARS = 220'), '预览字符上限')
  assert.ok(helpers.includes('DEFAULT_MAX_PREVIEW_PARAGRAPHS = 2'), '预览段落上限')
})

test('额度条：种类闭集与优先级在 sessionQuotaBannerState 里指得对', skipIfNoZCode, () => {
  const state = read(uiFile('v4/sessionQuotaBannerState.ts'))
  const banner = read(uiFile('v4/ConversationQuotaBanner.tsx'))
  assert.deepEqual([...AGENT_QUOTA_BANNER_KINDS], [
    'model-very-low', 'model-exhausted', 'daily-exhausted', 'concurrent-limit',
    'provider-limited', 'mcp-quota-exhausted', 'mcp-plan-required',
  ])
  for (const kind of AGENT_QUOTA_BANNER_KINDS) {
    assert.ok(state.includes(`"${kind}"`), `额度种类 ${kind} 在源码里没有`)
  }
  // 优先级字面量（:125,148,173,199,220,238,264）。
  assert.ok(state.includes('priority: 60'), '并发限制 60')
  assert.ok(state.includes('priority: 45'), 'provider-limited 45')
  assert.ok(state.includes('priority: 40'), 'model-exhausted 40')
  assert.ok(state.includes('priority: 30'), 'model-very-low 30')
  assert.ok(state.includes('priority: mcpQuotaExhausted ? 6 : 8'), 'MCP 两档 6 / 8')
  assert.equal(AGENT_QUOTA_PRIORITY['mcp-quota-exhausted'], 6)
  assert.equal(AGENT_QUOTA_PRIORITY['mcp-plan-required'], 8)
  assert.equal(AGENT_QUOTA_PRIORITY['concurrent-limit'], 60)
  assert.equal(AGENT_QUOTA_PRIORITY['daily-exhausted'], 50)
  assert.equal(AGENT_QUOTA_PRIORITY['provider-limited'], 45)
  assert.equal(AGENT_QUOTA_PRIORITY['model-exhausted'], 40)
  assert.equal(AGENT_QUOTA_PRIORITY['model-very-low'], 30)
  assert.equal(AGENT_QUOTA_LOW_RATIO_THRESHOLD, 0.1)
  assert.ok(state.includes('ratio > 0.1'), '低额度阈值必须与源码一致')
  for (const key of Object.values(AGENT_QUOTA_MESSAGE_IDS)) {
    assert.ok(banner.includes(key), `额度文案键 ${key} 在 banner 源码里没有消费方`)
  }
})

// ── ③ 纯函数 ───────────────────────────────────────────────────────────────

test('头部：浮层条件只看两个布尔，徽标 tooltip 是完整路径', () => {
  assert.equal(headerHasFloatingActions(null, false), false)
  assert.equal(headerHasFloatingActions({ label: 'w', workspacePath: '/w', remote: false }, false), true)
  assert.equal(headerHasFloatingActions(null, true), true)
  const badge = { label: 'w', workspacePath: '/home/me/w', remote: true }
  assert.deepEqual(headerBadgeAttributes(badge), { title: '/home/me/w', dataRemote: 'true', showsRemoteLabel: true })
  assert.deepEqual(headerBadgeAttributes({ ...badge, remote: false }), {
    title: '/home/me/w', dataRemote: 'false', showsRemoteLabel: false,
  })
})

test('队列行：锁 / 文本 / 立即发送键 / 编辑缺席', () => {
  const item = kind => ({ kind, dispatch: { state: 'queued' }, text: 'hello' })
  assert.equal(queueRowLocked({ dispatch: { state: 'queued' } }, false), false)
  assert.equal(queueRowLocked({ dispatch: { state: 'queued' } }, true), true, '编辑等待中锁这一行')
  assert.equal(queueRowLocked({ dispatch: { state: 'reserved' } }, false), true, 'reserved 整行锁')
  assert.equal(queueRowLocked({ dispatch: { state: 'promoting' } }, false), true, 'promoting 整行锁')

  assert.equal(queueRowLabel(item('sendText')), 'hello')
  assert.equal(queueRowLabel(item('compact')), '/compact', 'compact 不显示用户文本')
  assert.equal(queueSendNowLabelKey(item('compact')), 'chat.queue.runNow')
  assert.equal(queueSendNowLabelKey(item('sendText')), 'chat.queue.sendNow')
  // 阳性对照：两个键的原文都是「立即」（源码注释说清了这次合并）。
  assert.equal(agentChromeText('chat.queue.runNow'), agentChromeText('chat.queue.sendNow'))

  assert.equal(queueRowCanEdit(item('compact'), true), false, 'compact 没有编辑入口')
  assert.equal(queueRowCanEdit(item('sendText'), true), true)
  assert.equal(queueRowCanEdit(item('sendText'), false), false, '缺回调时按钮不出现')
})

test('队列面板：空即不渲染；暂停原因三分支', () => {
  assert.equal(queuePanelVisible(0), false)
  assert.equal(queuePanelVisible(1), true)
  assert.equal(queuePausedMessageKey('stopped'), 'chat.queue.paused.stopped')
  assert.equal(queuePausedMessageKey('error'), 'chat.queue.paused.error')
  assert.equal(queuePausedMessageKey('manual'), 'chat.queue.paused.generic', 'manual 走通用文案')
  assert.equal(queuePausedMessageKey(undefined), 'chat.queue.paused.generic', '旧快照缺 pauseReason 也走通用')
})

test('队列拖拽锚点：上拖插到 over 前、下拖插到 over 的下一条、同 id 不动', () => {
  const items = ['a', 'b', 'c', 'd'].map(queueItemId => ({ queueItemId }))
  // 上拖：d 落到 b 之前。
  assert.deepEqual(resolveQueueReorderAnchor(items, 'd', 'b'), { queueItemId: 'd', beforeQueueItemId: 'b' })
  // 下拖：a 落到 c 之后（= d 之前）。
  assert.deepEqual(resolveQueueReorderAnchor(items, 'a', 'c'), { queueItemId: 'a', beforeQueueItemId: 'd' })
  // 下拖到队尾：a 落到 d 之后 = null。
  assert.deepEqual(resolveQueueReorderAnchor(items, 'a', 'd'), { queueItemId: 'a', beforeQueueItemId: null })
  // 同 id 与不存在的 id 都不动。
  assert.equal(resolveQueueReorderAnchor(items, 'a', 'a'), null)
  assert.equal(resolveQueueReorderAnchor(items, 'zz', 'a'), null)
  assert.equal(resolveQueueReorderAnchor(items, 'a', 'zz'), null)
})

test('队列命令前置条件：恢复 / 撤回编辑 / 冲突 / ACK 判定', () => {
  assert.equal(canResumePausedQueue({ autoDrain: false, itemCount: 2 }), true)
  assert.equal(canResumePausedQueue({ autoDrain: true, itemCount: 2 }), false, '已在自动消费就不动')
  assert.equal(canResumePausedQueue({ autoDrain: false, itemCount: 0 }), false, '空队列不恢复')

  assert.equal(canEditQueueItem({ kind: 'sendText' }), true)
  assert.equal(canEditQueueItem({ kind: 'compact' }), false, 'compact 不可撤回编辑')
  assert.equal(canEditQueueItem(null), false)
  assert.equal(canEditQueueItem(undefined), false)

  assert.equal(queueEditBlockedReason({ hasContent: false, busy: false }), null)
  assert.equal(queueEditBlockedReason({ hasContent: true, busy: false }), 'chat.queue.editDraftConflict')
  assert.equal(queueEditBlockedReason({ hasContent: false, busy: true }), 'chat.queue.editDraftConflict')

  assert.equal(shouldRestoreQueueItemToComposer('accepted'), true)
  assert.equal(shouldRestoreQueueItemToComposer('duplicate'), true, 'duplicate 也恢复（幂等重放）')
  assert.equal(shouldRestoreQueueItemToComposer('rejected'), false)
  assert.equal(shouldRestoreQueueItemToComposer('stale'), false)
})

test('queue / guide 两档：设置映射、反向投递、修饰键提示', () => {
  assert.equal(resolveAppFollowupMode(null), null, '无设置时不猜')
  assert.equal(resolveAppFollowupMode({ zcodeInteractionBehavior: 'guide' }), 'guide')
  assert.equal(resolveAppFollowupMode({ zcodeInteractionBehavior: 'queue' }), 'queue')
  // 阳性对照：缺键 / 未知值一律归 queue（默认档）。
  assert.equal(resolveAppFollowupMode({}), 'queue')
  assert.equal(resolveAppFollowupMode({ zcodeInteractionBehavior: 'nonsense' }), 'queue')

  assert.equal(resolveOppositeFollowupDelivery('queue'), 'startNow', 'queue 档下修饰键 = 立即发送')
  assert.equal(resolveOppositeFollowupDelivery('guide'), 'queue', 'guide 档下修饰键 = 加入队列')

  assert.equal(resolveFollowupModifierTooltip({
    enabled: false, canSend: true, modifierPressed: true, followupMode: 'queue', isApplePlatform: false,
  }), null, '未启用时无提示')
  assert.deepEqual(resolveFollowupModifierTooltip({
    enabled: true, canSend: true, modifierPressed: true, followupMode: 'queue', isApplePlatform: true,
  }), { delivery: 'startNow', shortcut: '⌘ + Enter', titleId: 'chat.followup.sendNow' })
  assert.deepEqual(resolveFollowupModifierTooltip({
    enabled: true, canSend: true, modifierPressed: true, followupMode: 'guide', isApplePlatform: false,
  }), { delivery: 'queue', shortcut: 'Ctrl + Enter', titleId: 'chat.followup.addToQueue' })
  assert.equal(resolveFollowupModifierTooltip({
    enabled: true, canSend: true, modifierPressed: true, followupMode: null, isApplePlatform: false,
  }), null, '没有 followupMode 投影时不出提示')
})

test('queue / guide 分流：admitted=guide 进时间线尾部，其余留在队列面板', () => {
  const make = (queueItemId, admitted) => ({
    queueItemId, sourceCommandId: `c-${queueItemId}`, clientId: 'cl', kind: 'sendText', text: queueItemId,
    admittedAt: '2026-10-07T00:00:00.000Z', order: { admissionSeq: 0 },
    delivery: { requested: 'auto', admitted }, steer: { state: 'notRequested' }, dispatch: { state: 'queued' },
  })
  const split = projectPendingGuideQueue({ items: [make('q1', 'queue'), make('g1', 'guide'), make('q2', 'queue')] })
  assert.deepEqual(split.pendingGuides.map(i => i.queueItemId), ['g1'])
  assert.deepEqual(split.visibleQueue.items.map(i => i.queueItemId), ['q1', 'q2'])
  assert.equal(split.visibleQueue.changed, true)

  // 阳性对照：一条 guide 都没有时列表原样（changed=false，不重建）。
  const untouched = projectPendingGuideQueue({ items: [make('q1', 'queue')] })
  assert.deepEqual(untouched.pendingGuides, [])
  assert.equal(untouched.visibleQueue.changed, false)
})

test('输入路由：guide 可提交、reject 不可；停止键与发送键互斥；enqueue 文案', () => {
  assert.equal(inputRoutingAllowsSend('startNow', false), true)
  assert.equal(inputRoutingAllowsSend('enqueue', false), true)
  assert.equal(inputRoutingAllowsSend('guide', false), true, 'guide 是已授权的 busy 路由，不是不可提交')
  assert.equal(inputRoutingAllowsSend('choice', false), true)
  assert.equal(inputRoutingAllowsSend('reject', false), false)
  assert.equal(inputRoutingAllowsSend('reject', true), true, 'draft 模式不受 reject 影响')

  assert.equal(showStopControl(true, false), true, '流式且空草稿 → Stop')
  assert.equal(showStopControl(true, true), false, '有草稿 → 发送键')
  assert.equal(showStopControl(false, false), false, '不能停时不出 Stop')

  assert.equal(composerSendLabelKey('enqueue'), 'chat.queue.enqueue')
  assert.equal(composerSendLabelKey('startNow'), 'chat.send')
  assert.equal(composerSendLabelKey('guide'), 'chat.send')
})

test('held 队列确认框：只截获普通输入与 /goal，且带 disposition 时不弹', () => {
  const base = { routingMode: 'choice', heldQueueDisposition: null, inputKind: 'plain' }
  assert.equal(requiresHeldQueueConfirmation(base), true)
  assert.equal(requiresHeldQueueConfirmation({ ...base, inputKind: 'goal' }), true, '/goal 也走确认')
  assert.equal(requiresHeldQueueConfirmation({ ...base, inputKind: 'other' }), false, '/compact 等控制命令不截获')
  assert.equal(requiresHeldQueueConfirmation({ ...base, heldQueueDisposition: 'clearQueueAndSend' }), false)
  assert.equal(requiresHeldQueueConfirmation({ ...base, heldQueueDisposition: 'keepQueueAndSend' }), false)
  // 阳性对照：非 choice 路由一律不弹。
  assert.equal(requiresHeldQueueConfirmation({ ...base, routingMode: 'enqueue' }), false)
  assert.equal(requiresHeldQueueConfirmation({ ...base, routingMode: 'guide' }), false)
})

test('待办引导行：rowId 取负数、entityId 用 queueItemId、createdAtSeq 保序', () => {
  const item = {
    queueItemId: 'qi-7', sourceCommandId: 'cmd-7', clientId: 'cl-1', kind: 'sendText', text: '接着改这里',
    admittedAt: '2026-10-07T01:02:03.000Z', order: { admissionSeq: 4 },
    delivery: { requested: 'guide', admitted: 'guide' }, steer: { state: 'submitting' }, dispatch: { state: 'queued' },
  }
  const row = pendingGuideRow(item, 'turn-9')
  assert.equal(row.rowId, -5, '-(admissionSeq + 1)：负数与真 user row 的正数空间不相交')
  assert.equal(row.entityId, 'qi-7')
  assert.equal(row.kind, 'userInput')
  assert.equal(row.origin, 'realUser')
  assert.equal(row.sourceCommandId, 'cmd-7')
  assert.equal(row.clientId, 'cl-1')
  assert.equal(row.turnId, 'turn-9')
  assert.equal(row.productTurnId, 'turn-9')
  assert.equal(row.createdAt, '2026-10-07T01:02:03.000Z')
  assert.equal(row.createdAtSeq, 4)
  // 阳性对照：admissionSeq=0 时 rowId = -1（仍为负）。
  assert.equal(pendingGuideRow({ ...item, order: { admissionSeq: 0 } }, 't').rowId, -1)
  assert.equal(pendingGuideListVisible(0), false)
  assert.equal(pendingGuideListVisible(1), true)
})

test('状态面板：变体 / 内联 / 菜单 / 数据属性', () => {
  assert.equal(resolveStatusPanelVariant(null), 'auto')
  assert.equal(resolveStatusPanelVariant(undefined), 'auto')
  assert.equal(resolveStatusPanelVariant('panel'), 'panel')
  assert.equal(shouldUseStatusPanelInlineLayout({ hasContent: true, variant: 'auto' }), true)
  assert.equal(shouldUseStatusPanelInlineLayout({ hasContent: true, variant: 'mini' }), false, '胶囊不占正文列')
  assert.equal(shouldUseStatusPanelInlineLayout({ hasContent: false, variant: 'panel' }), false)
  assert.equal(statusPanelMenuValue(true, 'auto'), 'auto')
  assert.equal(statusPanelMenuValue(false, 'mini'), 'mini')
  assert.equal(statusPanelMenuChange('auto'), null)
  assert.equal(statusPanelMenuChange('panel'), 'panel')
  assert.equal(statusPanelMenuChange('mini'), 'mini')
  assert.equal(statusPanelMenuChange('nonsense'), undefined, '未知值不改 override')
  assert.equal(statusPanelDataState('mini'), 'collapsed')
  assert.equal(statusPanelDataState('auto'), 'expanded')
  assert.equal(statusPanelDataState('panel'), 'expanded')
})

test('状态面板：卸载闸门与两个目录入口的门', () => {
  assert.equal(statusPanelVisible(true, false), true)
  assert.equal(statusPanelVisible(false, false), false, '无内容且无终态 workflow 时整块消失')
  assert.equal(statusPanelVisible(false, true), true, '只剩已结束 run 也要保住目录入口')
  assert.equal(canRenderEndedWorkflows({ endedWorkflowRunCount: 1, hasParentSession: true, hasDirectoryHandler: true }), true)
  assert.equal(canRenderEndedWorkflows({ endedWorkflowRunCount: 0, hasParentSession: true, hasDirectoryHandler: true }), false)
  assert.equal(canRenderEndedWorkflows({ endedWorkflowRunCount: 1, hasParentSession: false, hasDirectoryHandler: true }), false)
  assert.equal(canRenderEndedWorkflows({ endedWorkflowRunCount: 1, hasParentSession: true, hasDirectoryHandler: false }), false)
  assert.equal(canRenderEndedAgents({ endedSubagentCount: 2, hasParentSession: true, hasDirectoryHandler: true }), true)
  assert.equal(canRenderEndedAgents({ endedSubagentCount: 0, hasParentSession: true, hasDirectoryHandler: true }), false)
})

test('状态面板：分区可见性、运行计数与图标、胶囊兜底链', () => {
  const model = {
    hasContent: true, hasGit: true, hasGoal: false, hasSessionPlans: false, hasPlan: true,
    runningBashCount: 0, runningSubagentCount: 0, runningWorkflowCount: 0,
  }
  assert.deepEqual(statusSectionVisibility(model, false, false), {
    environment: true, goal: false, sessionPlans: false, plan: true,
    terminal: false, workflow: false, agent: false,
  })
  // workflow / agent 分区由「活动数 > 0 或 已结束目录可渲染」开门。
  assert.equal(statusSectionVisibility(model, true, false).workflow, true)
  assert.equal(statusSectionVisibility(model, false, true).agent, true)

  assert.equal(runningWorkCount({ runningBashCount: 1, runningSubagentCount: 2, runningWorkflowCount: 3 }), 6)
  // 恰好一类沿用该类图标；混合才是 Activity（两类矩阵在 workflow 加入后不够用）。
  assert.equal(runningSummaryIconKind({ runningBashCount: 1, runningSubagentCount: 0, runningWorkflowCount: 0 }), 'terminal')
  assert.equal(runningSummaryIconKind({ runningBashCount: 0, runningSubagentCount: 2, runningWorkflowCount: 0 }), 'agent')
  assert.equal(runningSummaryIconKind({ runningBashCount: 0, runningSubagentCount: 0, runningWorkflowCount: 1 }), 'workflow')
  assert.equal(runningSummaryIconKind({ runningBashCount: 1, runningSubagentCount: 0, runningWorkflowCount: 1 }), 'activity')

  const none = {
    hasCurrentPlanItem: false, hasGoalTitle: false, isActiveGoal: false, hasGitMiniSummary: false,
    isDoneGoal: false, hasCompletedPlanItem: false, hasPlan: false, hasLatestSessionPlan: false,
    runningCount: 0, endedWorkflowRunCount: 0,
  }
  assert.equal(resolveStatusSummaryBranch(none), null, '各分支全空时胶囊不渲染')
  assert.equal(resolveStatusSummaryBranch({ ...none, endedWorkflowRunCount: 3 }), 'endedWorkflows', '末条兜底终态')
  assert.equal(resolveStatusSummaryBranch({ ...none, runningCount: 2, endedWorkflowRunCount: 3 }), 'runningCount', '活动计数优先于终态')
  assert.equal(resolveStatusSummaryBranch({ ...none, hasPlan: true, runningCount: 2 }), 'planCounts', 'Todo 优先于活动计数')
  assert.equal(resolveStatusSummaryBranch({ ...none, hasCurrentPlanItem: true, hasPlan: true }), 'currentPlanItem')
  // 阳性对照：goal 有题名但既不 active 也不 done 时，不占胶囊（落到后面的分支）。
  assert.equal(resolveStatusSummaryBranch({ ...none, hasGoalTitle: true, hasPlan: true }), 'planCounts')
  assert.deepEqual([...AGENT_STATUS_SUMMARY_BRANCHES].length, 9)
})

test('状态面板：Todo 当前/已完成项、目标控制、行图标', () => {
  const items = [
    { status: 'completed', content: 'a' },
    { status: 'pending', content: 'b' },
    { status: 'inProgress', content: 'c' },
  ]
  assert.equal(getCurrentPlanItem(items).content, 'c', '优先 inProgress')
  assert.equal(getCurrentPlanItem([{ status: 'pending', content: 'b' }]).content, 'b')
  assert.equal(getCurrentPlanItem([]), null)
  assert.equal(getCompletedPlanItem(items).content, 'a')
  assert.equal(getCompletedPlanItem([{ status: 'pending', content: 'b' }]), null)

  assert.equal(isPausableGoalStatus('active'), true)
  assert.equal(isPausableGoalStatus('verifying'), true)
  assert.equal(isPausableGoalStatus('notSatisfied'), true)
  assert.equal(isPausableGoalStatus('paused'), false)
  assert.equal(isActiveGoalStatus('notSatisfied'), true, 'notSatisfied 是合法开放态，曾漏掉')
  assert.equal(isActiveGoalStatus('verified'), false)
  assert.equal(goalControlFor('active'), 'pause')
  assert.equal(goalControlFor('paused'), 'resume')
  assert.equal(goalControlFor('verified'), 'done')
  assert.equal(goalControlFor('failed'), null)
  assert.equal(planItemIconKind('completed'), 'check')
  assert.equal(planItemIconKind('inProgress'), 'arrow')
  assert.equal(planItemIconKind('pending'), 'circle')
})

test('状态面板：Todo 折叠窗（阈值 6 / 窗口 3 / 前补 / 原序）', () => {
  assert.equal(AGENT_STATUS_COMPACT_TODO_THRESHOLD, 6)
  assert.equal(AGENT_STATUS_TODO_FOCUS_WINDOW_SIZE, 3)
  const six = Array.from({ length: 6 }, (_, i) => ({ status: 'pending', content: `t${i}` }))
  const small = planTodoFocusWindow(six)
  assert.equal(small.compact, false, '不超阈值不精简')
  assert.equal(small.focusItems.length, 6)
  assert.deepEqual(small.precedingItems, [])

  // 9 条、第 7 条在跑：窗口应回补到「当前 + 后两条」且保持原序。
  const nine = Array.from({ length: 9 }, (_, i) => ({ status: 'pending', content: `t${i}` }))
  nine[6] = { status: 'inProgress', content: 't6' }
  const win = planTodoFocusWindow(nine)
  assert.equal(win.compact, true)
  assert.deepEqual(win.focusItems.map(i => i.content), ['t6', 't7', 't8'], '窗口 = 当前 + 后两条')
  assert.deepEqual(win.precedingItems.map(i => i.content), ['t0', 't1', 't2', 't3', 't4', 't5'])
  assert.deepEqual(win.followingItems, [])
  // 靠末尾的当前项从前面回补，始终三条。
  const late = nine.map(item => ({ ...item, status: 'pending' }))
  late[8] = { status: 'inProgress', content: 't8' }
  const lateWin = planTodoFocusWindow(late)
  assert.deepEqual(lateWin.focusItems.map(i => i.content), ['t6', 't7', 't8'])
  assert.equal(lateWin.focusItems.length, 3)
  // 全完成时焦点落到末尾三条。
  const allDone = nine.map(item => ({ ...item, status: 'completed' }))
  assert.deepEqual(planTodoFocusWindow(allDone).focusItems.map(i => i.content), ['t6', 't7', 't8'])

  assert.equal(todoFoldMessageKey('preceding', [{ status: 'completed' }, { status: 'completed' }]), 'chat.statusPanel.todoCompletedFold')
  assert.equal(todoFoldMessageKey('preceding', [{ status: 'completed' }, { status: 'pending' }]), 'chat.statusPanel.todoEarlierFold')
  assert.equal(todoFoldMessageKey('following', [{ status: 'pending' }, { status: 'pending' }]), 'chat.statusPanel.todoWaitingFold')
  assert.equal(todoFoldMessageKey('following', [{ status: 'pending' }, { status: 'completed' }]), 'chat.statusPanel.todoLaterFold')
})

test('状态面板：完成判定、用时拆分、git / plan / 会话计划 / workflow 行', () => {
  assert.equal(planIsCompleted({ totalCount: 3, completedCount: 3 }), true)
  assert.equal(planIsCompleted({ totalCount: 3, completedCount: 2 }), false)
  assert.equal(planIsCompleted({ totalCount: 0, completedCount: 0 }), false, '空计划不算完成')

  assert.deepEqual(formatStatusDurationParts(0), { hours: 0, minutes: 0, seconds: 0, showsSeconds: true }, '全零补一个 0 秒')
  assert.deepEqual(formatStatusDurationParts(59), { hours: 0, minutes: 0, seconds: 59, showsSeconds: true })
  assert.deepEqual(formatStatusDurationParts(60), { hours: 0, minutes: 1, seconds: 0, showsSeconds: false }, '整分不写 0 秒')
  assert.deepEqual(formatStatusDurationParts(3661), { hours: 1, minutes: 1, seconds: 1, showsSeconds: true })
  assert.deepEqual(formatStatusDurationParts(-5), { hours: 0, minutes: 0, seconds: 0, showsSeconds: true }, '负数归零')

  assert.equal(hasGitMiniSummary(0, 0), false, 'clean repo 不挂 Git 卡')
  assert.equal(hasGitMiniSummary(1, 0), true)
  assert.equal(hasGitMiniSummary(0, 2), true)
  assert.equal(planModelVisible(0), false)
  assert.equal(planModelVisible(1), true)

  assert.equal(isSessionPlanRow({ toolName: 'ExitPlanMode', status: 'success' }), true)
  assert.equal(isSessionPlanRow({ toolName: 'ExitPlanMode', status: 'error' }), true)
  assert.equal(isSessionPlanRow({ toolName: 'ExitPlanMode', status: 'cancelled' }), true)
  assert.equal(isSessionPlanRow({ toolName: 'ExitPlanMode', status: 'running' }), false, '运行中不进目录')
  assert.equal(isSessionPlanRow({ toolName: 'Read', status: 'success' }), false)

  assert.equal(isActiveWorkflowRunStatus('pending'), true, 'pending 也是活动态')
  assert.equal(isActiveWorkflowRunStatus('running'), true)
  assert.equal(isActiveWorkflowRunStatus('completed'), false)
  assert.equal(workflowRunStatusTextKey('errored'), 'chat.toolCall.workflow.run.status.errored')
  assert.equal(workflowRunDisplayName('我的脚本', 'run-1', '工作流脚本'), '我的脚本')
  assert.equal(workflowRunDisplayName('run-1', 'run-1', '工作流脚本'), '工作流脚本', 'title ≡ runId 即未命名')
  assert.equal(workflowRunDisplayName(undefined, 'run-1', '工作流脚本'), '工作流脚本')
  assert.equal(workflowRunCanStop({ workId: 'w1', cancellable: true, workStatus: 'running' }), true)
  assert.equal(workflowRunCanStop({ workId: 'w1', cancellable: undefined, workStatus: 'running' }), true, '缺省即可停')
  assert.equal(workflowRunCanStop({ workId: 'w1', cancellable: true, workStatus: 'resultPending' }), false, '已结束的 work 没有可取消的东西')
  assert.equal(workflowRunCanStop({ cancellable: true, workStatus: 'running' }), false, '没有 workId 停不了')
  assert.equal(workflowRunCanOpen('tc-1'), true)
  assert.equal(workflowRunCanOpen(undefined), false, '降级行没有可开的详情页')
})

test('轮次导航：目录按 query 拆、timelineOnly 与系统来源被跳过、running 只给最后一条', () => {
  assert.equal(turnNavigatorVisible(0), false)
  assert.equal(turnNavigatorVisible(1), false)
  assert.equal(turnNavigatorVisible(2), true)

  const units = [
    {
      key: 'u0', turnId: 't0', timelineOnly: false, isRunning: false,
      visibleUserInputs: [
        { rowId: 10, entityId: 'e10', text: '第一个问题', origin: 'realUser' },
        { rowId: 11, entityId: 'e11', text: '系统注入', origin: 'backgroundResult' },
      ],
      assistantTextRows: [{ text: '回答一' }],
    },
    {
      key: 'u1', turnId: 't1', timelineOnly: false, isRunning: true,
      visibleUserInputs: [
        { rowId: 20, entityId: 'e20', text: '第二个问题', origin: 'realUser' },
        { rowId: 21, entityId: 'e21', text: '引导补充', origin: 'realUser' },
      ],
      assistantTextRows: [],
    },
    {
      key: 'u2', turnId: 't2', timelineOnly: true, isRunning: false,
      visibleUserInputs: [{ rowId: 30, entityId: 'e30', text: '只进时间线', origin: 'realUser' }],
      assistantTextRows: [{ text: '不该出现' }],
    },
  ]
  const previews = { assistantEmptyPreview: '暂无助手正文', assistantRunningPreview: '助手仍在工作', userFallbackPreview: '用户输入' }
  const items = buildTurnNavigatorItems(units, previews)
  assert.deepEqual(items.map(i => i.key), ['u0:query:e10', 'u1:query:e20', 'u1:query:e21'])
  assert.deepEqual(items.map(i => i.rowId), [10, 20, 21])
  assert.equal(items[0].assistantPreviewKind, 'text')
  assert.equal(items[0].assistantPreview, '回答一')
  assert.equal(items[1].assistantPreviewKind, 'running', '无正文且在跑 → running 预览')
  assert.equal(items[1].assistantPreview, '助手仍在工作')
  assert.equal(items[1].isRunning, false, '同一 running turn 只有最后一条 query 带 running')
  assert.equal(items[2].isRunning, true)
  // 阳性对照：timelineOnly 单元整条不出现。
  assert.ok(!items.some(i => i.key.startsWith('u2:')))

  assert.equal(turnNavigatorItemKey('u9', { entityId: 'e9', rowId: 9 }), 'u9:query:e9')
  assert.equal(turnNavigatorItemKey('u9', { rowId: 9 }), 'u9:query:9', '缺 entityId 时退回 rowId')
  assert.equal(buildTurnNavigatorItems([], previews).length, 0)
})

test('轮次导航：活动单元 / 活动 query / 视觉态 / 跳转与滚动行为', () => {
  const items = [
    { unitIndex: 0, rowId: 1 }, { unitIndex: 1, rowId: 2 }, { unitIndex: 2, rowId: 3 },
  ]
  // 视口盖住第二项（start 100..200），视口从 120 起。
  const active = resolveTurnNavigatorActiveUnitIndex({
    items, virtualItems: [{ index: 1, start: 100, size: 100 }], scrollOffsetPx: 120, viewportHeightPx: 400,
  })
  assert.equal(active, 1)
  // 全部不相交时退回首项的 unitIndex（视口在 0..100，虚拟项整段在 900 之后）。
  const fallback = resolveTurnNavigatorActiveUnitIndex({
    items, virtualItems: [{ index: 2, start: 900, size: 50 }], scrollOffsetPx: 0, viewportHeightPx: 100,
  })
  assert.equal(fallback, 0)
  assert.equal(resolveTurnNavigatorActiveUnitIndex({ items: [], virtualItems: [], scrollOffsetPx: 0, viewportHeightPx: 0 }), undefined)

  const positions = [
    { rowId: 1, start: 0, end: 40 },
    { rowId: 2, start: 200, end: 240 },
  ]
  assert.equal(resolveTurnNavigatorActiveQueryRowId({ positions, scrollOffsetPx: 10, viewportHeightPx: 100 }), 1)
  assert.equal(resolveTurnNavigatorActiveQueryRowId({ positions, scrollOffsetPx: 210, viewportHeightPx: 100 }), 2)
  assert.equal(resolveTurnNavigatorActiveQueryRowId({ positions, scrollOffsetPx: 120, viewportHeightPx: 20 }), 1, '视口夹在两段之间取前面那条')
  assert.equal(resolveTurnNavigatorActiveQueryRowId({ positions: [], scrollOffsetPx: 0, viewportHeightPx: 0 }), undefined)

  assert.deepEqual(resolveTurnNavigatorBarVisualState({ itemIndex: 3, visualFocusItemIndex: 3 }), { colorTone: 'focus', opacity: 1, scaleX: 2.6, tone: 'peak' })
  assert.deepEqual(resolveTurnNavigatorBarVisualState({ itemIndex: 4, visualFocusItemIndex: 3 }).tone, 'near')
  assert.deepEqual(resolveTurnNavigatorBarVisualState({ itemIndex: 5, visualFocusItemIndex: 3 }).tone, 'mid')
  assert.deepEqual(resolveTurnNavigatorBarVisualState({ itemIndex: 9, visualFocusItemIndex: 3 }).tone, 'idle')
  assert.deepEqual(resolveTurnNavigatorBarVisualState({ itemIndex: 0, visualFocusItemIndex: undefined }), { colorTone: 'muted', opacity: 0.58, scaleX: 1, tone: 'idle' })

  assert.equal(resolveTurnNavigatorVisualFocusItemIndex(undefined), undefined)
  assert.equal(resolveTurnNavigatorVisualFocusItemIndex(4), 4)
  assert.equal(turnNavigatorJumpBehavior(true), 'auto', 'reduced motion 下不要平滑动画')
  assert.equal(turnNavigatorJumpBehavior(false), 'smooth')

  assert.equal(shouldHydrateTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 864, hasLoadHandler: true, loadingOlder: false }), true)
  assert.equal(shouldHydrateTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 863, hasLoadHandler: true, loadingOlder: false }), false, '窄屏不水合')
  assert.equal(shouldHydrateTurnNavigatorDirectory({ canLoadOlder: false, containerWidthPx: 2000, hasLoadHandler: true, loadingOlder: false }), false)
  assert.equal(shouldHydrateTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 2000, hasLoadHandler: false, loadingOlder: false }), false)
  assert.equal(shouldHydrateTurnNavigatorDirectory({ canLoadOlder: true, containerWidthPx: 2000, hasLoadHandler: true, loadingOlder: true }), false)
  assert.equal(turnNavigatorHydrationRetryDelayMs(1), 250)
  assert.equal(turnNavigatorHydrationRetryDelayMs(2), 1000)
  assert.equal(turnNavigatorHydrationRetryDelayMs(3), null, '两次之后放弃')
  assert.equal(turnNavigatorHydrationRetryDelayMs(0), null)
})

test('额度条：消息键三分支 / 阈值 / 升级入口 / 关闭', () => {
  assert.equal(resolveQuotaMessageId({ kind: 'model-very-low', quotaPeriod: 'daily' }), 'chat.quota.startPlan.bucketDailyLow')
  assert.equal(resolveQuotaMessageId({ kind: 'model-very-low', quotaPeriod: 'one_time' }), 'chat.quota.startPlan.bucketActivityLow')
  assert.equal(resolveQuotaMessageId({ kind: 'model-very-low', quotaPeriod: 'monthly' }), 'chat.quota.startPlan.modelVeryLow')
  assert.equal(resolveQuotaMessageId({ kind: 'model-very-low' }), 'chat.quota.startPlan.modelVeryLow')
  assert.equal(
    resolveQuotaMessageId({ kind: 'concurrent-limit', concurrentLimitReason: 'retry-exhausted-busy' }),
    'chat.quota.startPlan.concurrentLimit.retryExhausted',
  )
  assert.equal(resolveQuotaMessageId({ kind: 'concurrent-limit' }), 'chat.quota.startPlan.concurrentLimit')
  assert.equal(resolveQuotaMessageId({ kind: 'mcp-plan-required' }), 'chat.quota.mcp.codingPlanRequired')
  assert.equal(resolveQuotaMessageId({ kind: null }), '')

  assert.equal(isQuotaVeryLow(0.1), true, '恰好 10% 算低')
  assert.equal(isQuotaVeryLow(0.1001), false)
  assert.equal(isQuotaVeryLow(0), false, '已耗尽走另一档，不是「很低」')
  assert.equal(isQuotaVeryLow(null), false)

  assert.equal(quotaBannerVisible({ visible: true, kind: 'daily-exhausted' }), true)
  assert.equal(quotaBannerVisible({ visible: true, kind: null }), false)
  assert.equal(quotaBannerVisible({ visible: false, kind: 'daily-exhausted' }), false)

  assert.equal(shouldOfferQuotaUpgrade('mcp-plan-required'), true, '缺权益才是升级能解决的')
  assert.equal(shouldOfferQuotaUpgrade('mcp-quota-exhausted'), false, '额度用完只能等自然日重置，升级是误导')
  assert.equal(shouldOfferQuotaUpgrade(null), true)
  assert.equal(quotaBannerDismissible({ dismissible: true }), true)
  assert.equal(quotaBannerDismissible({ dismissible: false }), false)

  // 优先级：并发限制最高、MCP 额度耗尽最低。
  assert.ok(AGENT_QUOTA_PRIORITY['concurrent-limit'] > AGENT_QUOTA_PRIORITY['daily-exhausted'])
  assert.ok(AGENT_QUOTA_PRIORITY['daily-exhausted'] > AGENT_QUOTA_PRIORITY['model-very-low'])
  assert.ok(AGENT_QUOTA_PRIORITY['model-very-low'] > AGENT_QUOTA_PRIORITY['mcp-plan-required'])
  assert.ok(AGENT_QUOTA_PRIORITY['mcp-plan-required'] > AGENT_QUOTA_PRIORITY['mcp-quota-exhausted'])
})
