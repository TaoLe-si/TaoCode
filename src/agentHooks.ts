// Agent 设置「钩子」节（ZCode section id `hooks`，图标 Anchor）的配置面。
//
// 为什么单独一个文件：ZCode 的设置面板每一节都存自己那份形状（见 `src/agentSettingsStore.ts`
// 的文件头）。钩子这一节尤其不能塞进 `src/agentSettings.ts` —— 它有**自己的信任模型**
// （工作区 hook 的逐条内联信任），和「模型/权限/预算」那节不是一件事。混在一起会逼着
// `normalizeAgentSettings` 认识钩子的七态信任枚举，最后两边互相污染。
//
// 字段出处（ZCode，只读参照 `.tools/ZCode`）：
//   · `event` —— 七个事件逐字取 `packages/shared/src/hooks.ts:4-11` 的 `HookEvent`，
//     与 `packages/ui/src/settings/HookForm.tsx:35-43` 的 `HOOK_EVENTS` 同序同值
//     （那份是 UI 下拉表，这一份是类型真源；`workspace-hook-config.ts:9-17`
//     的 `WORKSPACE_HOOK_EVENT_NAMES` 是第三份同值副本，协议侧对齐用）。
//   · `type` —— `hooks.ts:13` 的 `HookType = "command" | "process"`（`HookForm.tsx:212`
//     的下拉顺序是 process / command，本模块的 `AGENT_HOOK_TYPES` 照抄那份 UI 顺序）。
//   · `matcher` —— `HookForm.tsx:98`（`hook?.matcher ?? ""`）。语义取自 zh-CN
//     `settings.hooks.matcherHint` = 「留空时匹配该事件的所有输入」、
//     `matcherPlaceholder` = 「例如 Write, Edit, Bash」。
//   · `command` —— `HookForm.tsx:99`；表单的可保存条件就是 `command.trim()` 非空
//     （`HookForm.tsx:116` 的 `canSave`、`:119` 的早退）。
//   · `args` —— `HookForm.tsx:100`（多行文本，每行一个 argv，`handleSave` 的 `:142-148`
//     按 `\n` 切、trim、丢空行）；**只有 type=process 才有**。
//   · `async` / `shell` —— `HookForm.tsx:101-102`；**只有 type=command 才有**
//     （`:142` 的三元分支把 args 与 async/shell 互斥）。
//   · `statusMessage` —— `HookForm.tsx:103`。
//   · `timeout` —— `HookForm.tsx:104`（`String(hook?.timeout ?? 60)`，**单位秒**，
//     与 `settings.hooks.timeout` = 「超时时间（秒）」一致）。折算成毫秒的规则见
//     `packages/shared/src/workspace-hook-config.ts:113-123` 的 `resolveWorkspaceHookTimeoutMs`：
//     command 型的 `timeout` 是秒、process 型用 `timeoutMs`，本模块统一只存秒。
//   · `enabled` —— `HookForm.tsx:155`（`hook?.enabled ?? true`，新建即开）。
//   · `scope` —— `HookForm.tsx:90-95` 的 `storageLevel: "user" | "project"`
//     （`HookConfig.storageLevel`，`hooks.ts:64`）。
//   · `trust` —— 工作区 hook 的信任态，枚举七值逐字取
//     `packages/shared/src/zcode-protocol-v4/workspace-hook-review.ts:9-17` 的
//     `workspaceHookReviewTrustStateSchema`。挂在 `WorkspaceHookDiscoveryState.trustState`
//     （`hooks.ts:30`），判定「要不要走 Trust 审核」见
//     `packages/ui/src/settings/WorkspaceHookTrustNotice.tsx:7-9` 的 `requiresWorkspaceHookTrust`。
//   · `review.reasonCodes` —— 11 个 reasonCode 逐字取
//     `packages/ui/src/settings/workspaceHookTrustState.ts:25-37`，中文文案取
//     zh-CN `settings.hooks.review.reason.*`（`zh-CN.ts:4020-4031`）。
//     审核命令本体在 `workspaceHookReviewCommands.ts`（`requestWorkspaceHookReview` /
//     `respondWorkspaceHookReview`），依赖 runtime RPC —— 本仓没有。
//
// **本仓只做配置面，不做执行面**：钩子真正的执行要走宿主 `run.start`
// （`src/runActions.ts` / `src/bridge.ts:109` 的 Method union）。本模块**不** import bridge、
// **不**起进程、**不** import Vue —— 它只回答「这份配置长什么样、能不能存、这条钩子
// 在某个事件上该不该触发」。触发与否的判定与 ZCode 的开关门控对齐
// （`HooksList.tsx:299-302`：需要信任的 hook，开关被强制置灰并显示为关）。
import {
  defaultSettingsStorage, readSettingsJson, writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'
import { parseRunArguments } from './runConfigTree.ts'

/** 存储键。与 `src/agentSettings.ts` 同一族（localStorage），但**独立成键**：钩子有独立生命周期。 */
export const AGENT_HOOKS_STORAGE_KEY = 'taocode.agent.hooks'

/** ZCode `HookEvent` 逐字（`packages/shared/src/hooks.ts:4-11`）。顺序照 `HookForm.tsx:35-43`。 */
export const AGENT_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
  'PostToolUse', 'PostToolUseFailure', 'Stop',
] as const

export type AgentHookEvent = (typeof AGENT_HOOK_EVENTS)[number]

/** ZCode `HookType`（`hooks.ts:13`）。顺序照 `HookForm.tsx:212` 的下拉（process 在前）。 */
export const AGENT_HOOK_TYPES = ['process', 'command'] as const

export type AgentHookType = (typeof AGENT_HOOK_TYPES)[number]

/** ZCode `HookScope`（`HooksList.tsx:14`）/ `HookConfig.storageLevel`（`hooks.ts:64`）。 */
export const AGENT_HOOK_SCOPES = ['user', 'project'] as const

export type AgentHookScope = (typeof AGENT_HOOK_SCOPES)[number]

/**
 * 工作区 hook 的信任态，七值逐字取
 * `packages/shared/src/zcode-protocol-v4/workspace-hook-review.ts:9-17`。
 *
 * 这七态是本节**除命令外**最要紧的字段：工作区里的 hook 来自仓库的 `zcode.json`，
 * 谁都能往里写命令，ZCode 因此要求逐条信任后才允许启用。
 */
export const AGENT_HOOK_TRUST_STATES = [
  'not_applicable', 'pending_trust', 'trusted_persistent', 'blocked_untrusted',
  'blocked_policy', 'revoked', 'stale_digest',
] as const

export type AgentHookTrustState = (typeof AGENT_HOOK_TRUST_STATES)[number]

/**
 * 审核被拒的原因码 → 中文文案。
 * 码表逐字取 `packages/ui/src/settings/workspaceHookTrustState.ts:25-37`，
 * 文案取 zh-CN `settings.hooks.review.reason.*`（`zh-CN.ts:4020-4031`）。
 *
 * 为什么在这里保留码表：`workspaceHookTrustState.ts:19-24` 的注释说明了原因 ——
 * 缺 key 会把原始枚举字面量（如 `workspace_hooks_review_superseded`）直接渲染给用户，
 * 中英文都不可读。未知码必须回退到「操作被拒绝」，**不许**回退到原始 id。
 */
export const AGENT_HOOK_REVIEW_REASON_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  workspace_hooks_review_superseded: '审核已更新，请重新确认',
  workspace_hooks_snapshot_mismatch: 'Hook 配置已变化，需要重新审核',
  workspace_hooks_bundle_changed: 'Hook 配置已变化，需要重新审核',
  workspace_hooks_config_unreadable: 'Hook 配置无法读取，请检查文件内容',
  workspace_hooks_config_write_failed: 'Hook 配置写入失败，请检查文件权限',
  workspace_hooks_config_rebuild_failed: 'Hook 配置重建失败，请重试',
  workspace_hooks_trust_store_corrupt: '信任存储损坏，请重新审核',
  workspace_hooks_blocked_by_policy: '策略禁止此操作',
  workspace_hooks_policy_requires_pretrust: '策略要求预先信任此 Hook',
  workspace_hooks_interaction_timeout: '审核已超时',
  workspace_hooks_require_trust_capable_host: '当前连接不支持审核此 Hook',
})

/** 未知/缺省 reasonCode 的回退文案（`workspaceHookTrustState.ts:39` 的 fallback id）。 */
export const AGENT_HOOK_REVIEW_FALLBACK_MESSAGE = '操作被拒绝'

/** 超时下限。ZCode 表单是 `<input type="number" min={1}>`（`HookForm.tsx:322`）。 */
export const AGENT_HOOK_TIMEOUT_MIN_SECONDS = 1

/**
 * 超时上限是**本仓自定**的：ZCode 只有 min=1、没有上限（`HookForm.tsx:320-323`），
 * 而它那边的 `timeoutMs` 只在 `resolveWorkspaceHookTimeoutMs` 里做了 `Math.max(1, ...)`
 * 下限（`workspace-hook-config.ts:122`）。不设上限的话一个手滑的 999999 会让一条
 * 卡死的钩子永远占着宿主进程。**这是本仓的取舍，不是 ZCode 的行为。**
 */
export const AGENT_HOOK_TIMEOUT_MAX_SECONDS = 3600

/** 出厂超时，逐字取 `HookForm.tsx:104` 的 `hook?.timeout ?? 60`。 */
export const AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS = 60

/** 命令长度上限**本仓自定**（ZCode 表单没有 maxlength，`HookForm.tsx:250-261`）。 */
export const AGENT_HOOK_COMMAND_MAX_CHARS = 512

/** 状态消息与匹配器各自的长度上限，同样是本仓自定的护栏（ZCode 无）。 */
export const AGENT_HOOK_STATUS_MESSAGE_MAX_CHARS = 200
export const AGENT_HOOK_MATCHER_MAX_CHARS = 200

/** 钩子条目数上限**本仓自定**（ZCode 的 Hooks 页面没有条目数限制）。 */
export const AGENT_HOOKS_MAX_ENTRIES = 50

/** 一条 hook 的配置。字段含义与出处见文件头。 */
export interface AgentHook {
  id: string
  event: AgentHookEvent
  type: AgentHookType
  /** 工具名匹配。空串 = 匹配该事件的所有输入（zh-CN `settings.hooks.matcherHint`）。 */
  matcher: string
  command: string
  /** argv。仅 type=process 有意义（`HookForm.tsx:142-148`）。 */
  args: string[]
  /** 后台运行。仅 type=command 有意义（`HookForm.tsx:294-303`）。 */
  async: boolean
  /** shell 可执行文件。空串 = 系统默认（zh-CN `settings.hooks.shellPlaceholder`）。仅 type=command。 */
  shell: string
  statusMessage: string
  /** 单位秒（zh-CN `settings.hooks.timeout`）。 */
  timeoutSeconds: number
  enabled: boolean
  scope: AgentHookScope
  /**
   * 信任态。`not_applicable` = 这不是一条工作区 hook（用户自己在设置里建的），
   * 按 `requiresWorkspaceHookTrust`（`WorkspaceHookTrustNotice.tsx:7`）不需要审核。
   */
  trust: AgentHookTrustState
  /** 工作区来源的 hook 不可就地编辑，只能逐条 Trust —— 依据 `HooksSection.tsx:54-56` 的 `isReadOnlyZCodeHook`。 */
  readOnly: boolean
}

/** 钩子节的状态面。 */
export interface AgentHooksSettings {
  hooks: AgentHook[]
}

/** 出厂默认：空列表。ZCode 也不预置任何钩子（`HooksSection.tsx` 无 seed）。 */
export function defaultAgentHooks(): AgentHooksSettings {
  return { hooks: [] }
}

function isHookEvent(value: unknown): value is AgentHookEvent {
  return typeof value === 'string' && (AGENT_HOOK_EVENTS as readonly string[]).includes(value)
}

function isHookType(value: unknown): value is AgentHookType {
  return value === 'process' || value === 'command'
}

function isTrustState(value: unknown): value is AgentHookTrustState {
  return typeof value === 'string' && (AGENT_HOOK_TRUST_STATES as readonly string[]).includes(value)
}

const text = (value: unknown, fallback: string, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : fallback

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** 数字夹到区间并取整。非法值退 fallback（不夹 —— 非法不是越界）。 */
function seconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(AGENT_HOOK_TIMEOUT_MAX_SECONDS, Math.max(AGENT_HOOK_TIMEOUT_MIN_SECONDS, Math.round(value)))
}

/**
 * 把任意输入归一成一份合法设置。**永不抛、永不返回坏值**。
 *
 * 逐字段救（能救的救：数字夹区间、字符串截长、枚举退默认），救不了的退**该字段**的默认
 * —— 不按字段数量判损坏（本仓铁律，真出过把用户锁在项目外的事故）。
 * 垃圾条目只丢自己：一条 `null` 不会带走整张表。
 */
export function normalizeAgentHooks(input: unknown): AgentHooksSettings {
  const defaults = defaultAgentHooks()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>
  const list = Array.isArray(raw.hooks) ? raw.hooks : []
  const hooks: AgentHook[] = []
  for (const item of list) {
    if (hooks.length >= AGENT_HOOKS_MAX_ENTRIES) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const hook = item as Record<string, unknown>
    // 事件非法时退 PreToolUse：ZCode 新建表单的初值就是它（`HookForm.tsx:96`）。
    const event = isHookEvent(hook.event) ? hook.event : 'PreToolUse'
    const type = isHookType(hook.type) ? hook.type : 'process'
    const id = typeof hook.id === 'string' && hook.id.trim()
      ? hook.id
      : `hook-${hooks.length + 1}`
    const argsRaw: unknown[] = Array.isArray(hook.args) ? hook.args : []
    // argv 只保留字符串项（`HookForm.tsx:145-147` 本来就只切字符串行）。
    const args = argsRaw
      .filter((arg): arg is string => typeof arg === 'string')
      .map(arg => arg.trim())
      .filter(Boolean)
    hooks.push({
      id,
      event,
      // process 型的 async/shell 无意义（`HookForm.tsx:142` 的互斥分支），落 0/false 不留脏值。
      type,
      matcher: text(hook.matcher, '', AGENT_HOOK_MATCHER_MAX_CHARS),
      command: text(hook.command, '', AGENT_HOOK_COMMAND_MAX_CHARS),
      args: type === 'process' ? args : [],
      async: type === 'command' ? flag(hook.async, false) : false,
      shell: type === 'command' ? text(hook.shell, '', AGENT_HOOK_COMMAND_MAX_CHARS) : '',
      statusMessage: text(hook.statusMessage, '', AGENT_HOOK_STATUS_MESSAGE_MAX_CHARS),
      timeoutSeconds: seconds(hook.timeoutSeconds, AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS),
      enabled: flag(hook.enabled, true),
      scope: hook.scope === 'project' ? 'project' : 'user',
      trust: isTrustState(hook.trust) ? hook.trust : 'not_applicable',
      readOnly: flag(hook.readOnly, false),
    })
  }
  return { hooks }
}

/** 命令解析结果。`argv` 永远非空数组（失败时为空）。 */
export interface HookCommandParse {
  /** 拆分出的 argv，第一项是可执行程序。失败时为空数组。 */
  argv: string[]
  /** 失败原因（中文）。成功时为 null。 */
  reason: string | null
}

/**
 * 把用户敲的命令行解析成 argv。
 *
 * **复用本仓既有的拆分实现**，不另造一套：`parseRunArguments`（`src/runConfigTree.ts:64`）。
 * 它按 Windows CRT 的双引号/反斜杠规则切分，与运行配置的 `formatRunArguments`
 * （`runConfigTree.ts:56`）成对可逆 —— 钩子命令和运行配置参数是同一种「要交给宿主
 * `run.start` 的 argv」，两处各写一份必然会漂（反斜杠转义尤其容易）。
 *
 * 本函数额外补的是 `parseRunArguments` 不管的那层：**它只切，不管切出来的结果能不能用**。
 */
export function parseHookCommand(command: string): HookCommandParse {
  const trimmed = command.trim()
  if (!trimmed) return { argv: [], reason: '命令不能为空。' }
  // 引号未闭合：parseRunArguments 会把剩下全部当成一个 token，这里要拦住
  // —— 否则用户会得到一条看起来配好了、实际永远等不到闭合引号的命令。
  let quoted = false
  for (let index = 0; index < trimmed.length; ++index) {
    const character = trimmed[index]!
    if (character === '\\') {
      // 与 parseRunArguments 同规则：反斜杠成对时是转义，跳过两个。
      let end = index
      while (trimmed[end] === '\\') ++end
      if (trimmed[end] === '"') {
        // 与 parseRunArguments（runConfigTree.ts:75-79）逐字同规则：
        // 反斜杠**奇数**个时 `\"` 是被转义的字面引号（不改变引号状态）；
        // **偶数**个时这个 `"` 才是真正的定界引号。
        if ((end - index) % 2 === 0) quoted = !quoted
        index = end
      } else {
        index = end - 1
      }
      continue
    }
    if (character === '"') quoted = !quoted
  }
  if (quoted) return { argv: [], reason: '命令里的引号没有闭合。' }
  const argv = parseRunArguments(trimmed)
  if (!argv.length) return { argv: [], reason: '命令不能为空。' }
  return { argv, reason: null }
}

/**
 * 「不可执行」的判据。**这是本仓自定的保守检查，不是 ZCode 的行为** ——
 * ZCode 的表单只判 `command.trim()` 非空（`HookForm.tsx:116`），能不能跑是 runtime 的事。
 *
 * 判据只挡「显然不是程序名」的三种：含 Windows 路径非法字符、含控制字符、全是点。
 * 不做「文件是否存在」判断 —— 那是宿主的活（`run.start` 会回失败），纯逻辑模块碰不到文件系统。
 */
const NON_EXECUTABLE_PROGRAM = /[<>|]/

export function hookProgramProblem(argv: readonly string[]): string | null {
  const program = argv[0]
  if (program === undefined || !program.trim()) return '命令里没有可执行程序。'
  if (program === '.' || program === '..') return '可执行程序不能是「.」或「..」。'
  if (NON_EXECUTABLE_PROGRAM.test(program)) return '可执行程序名不能包含 <、> 或 |。'
  // eslint-disable-next-line no-control-regex -- 这里就是要找控制字符
  if (/[\u0000-\u001f]/.test(program)) return '可执行程序名不能包含控制字符。'
  return null
}

/**
 * 保存前校验：返回问题清单（空数组 = 可以保存）。
 *
 * 与 `normalizeAgentHooks` 的分工（照 `src/agentSettings.ts:214-220` 的口径）：
 * 那边是「读进来的坏数据要能救回来」，这边是「用户敲进去的坏数据要当场拦下并说清楚」。
 * 只归一化会让用户以为填的 3601 秒生效了（其实被夹到 3600）。
 */
export function validateAgentHooks(settings: AgentHooksSettings): string[] {
  const problems: string[] = []
  if (settings.hooks.length > AGENT_HOOKS_MAX_ENTRIES) {
    problems.push(`钩子最多 ${AGENT_HOOKS_MAX_ENTRIES} 条，当前 ${settings.hooks.length} 条。`)
  }
  const seen = new Set<string>()
  settings.hooks.forEach((hook, index) => {
    const at = `第 ${index + 1} 条`
    if (seen.has(hook.id)) problems.push(`${at}：id「${hook.id}」重复。`)
    seen.add(hook.id)
    if (!isHookEvent(hook.event)) problems.push(`${at}：事件不是七个合法事件之一。`)
    if (!isHookType(hook.type)) problems.push(`${at}：运行方式只能是进程或 Shell 命令。`)
    if (hook.command.trim().length === 0) {
      problems.push(`${at}：命令不能为空。`)
    } else {
      if (hook.command.length > AGENT_HOOK_COMMAND_MAX_CHARS) {
        problems.push(`${at}：命令最长 ${AGENT_HOOK_COMMAND_MAX_CHARS} 个字符。`)
      }
      const parsed = parseHookCommand(hook.command)
      if (parsed.reason) problems.push(`${at}：${parsed.reason}`)
      else {
        const programProblem = hookProgramProblem(parsed.argv)
        if (programProblem) problems.push(`${at}：${programProblem}`)
      }
    }
    if (!Number.isInteger(hook.timeoutSeconds)) {
      problems.push(`${at}：超时时间必须是整数秒。`)
    } else if (hook.timeoutSeconds < AGENT_HOOK_TIMEOUT_MIN_SECONDS || hook.timeoutSeconds > AGENT_HOOK_TIMEOUT_MAX_SECONDS) {
      problems.push(`${at}：超时时间必须在 ${AGENT_HOOK_TIMEOUT_MIN_SECONDS} 到 ${AGENT_HOOK_TIMEOUT_MAX_SECONDS} 秒之间。`)
    }
    // 只读行（工作区来源）不允许在设置里改启停：依据 `HooksList.tsx:302` 的
    // `disabled={... || readOnly}` —— ZCode 那边也不给写入口。
    if (hook.readOnly && hook.enabled) problems.push(`${at}：工作区来源的钩子不可直接启用，需先完成信任审核。`)
  })
  return problems
}

/** 从存储读钩子（缺省走 `localStorage`；坏存档/旧形状退回默认，永不抛）。 */
export function loadAgentHooks(storage: SettingsStorage | null = defaultSettingsStorage()): AgentHooksSettings {
  return readSettingsJson(storage, AGENT_HOOKS_STORAGE_KEY, normalizeAgentHooks)
}

/** 写钩子。存不下（配额满/隐私模式）时静默降级 —— 只丢持久化，不打断本次会话。 */
export function saveAgentHooks(settings: AgentHooksSettings, storage: SettingsStorage | null = defaultSettingsStorage()): boolean {
  return writeSettingsJson(storage, AGENT_HOOKS_STORAGE_KEY, settings)
}

/**
 * 这条 hook 是不是工作区来源、需要走 Trust 审核。
 * 逐字对齐 `WorkspaceHookTrustNotice.tsx:7-9` 的 `requiresWorkspaceHookTrust`：
 * 「是工作区 hook」且「信任态不是 trusted_persistent」。
 *
 * 本仓用 `readOnly` 表达「工作区来源」（`HooksSection.tsx:54-56` 的 `isReadOnlyZCodeHook`
 * 是 `editable === false && source === "zcode"`；本仓没有 runtime discovery 那套来源标记，
 * 只保留「只读工作区 hook」这一支，不造假 source）。
 */
export function requiresWorkspaceHookTrust(hook: AgentHook): boolean {
  return hook.readOnly && hook.trust !== 'trusted_persistent'
}

/** reasonCode → 中文文案。未知码回退「操作被拒绝」，**不回退原始 id**（`workspaceHookTrustState.ts:19-24`）。 */
export function hookReviewReasonMessage(reasonCode: string | undefined | null): string {
  if (!reasonCode) return AGENT_HOOK_REVIEW_FALLBACK_MESSAGE
  return AGENT_HOOK_REVIEW_REASON_MESSAGES[reasonCode] ?? AGENT_HOOK_REVIEW_FALLBACK_MESSAGE
}

/**
 * 一次被拒的命令要不要静默收敛（不弹错误）。
 * 逐字对齐 `workspaceHookTrustState.ts:65-71`：只有「superseded 类」**且**本地已无
 * live pending binding（审核已终结）才静默 —— 真正的 superseded 必须显示。
 */
export function shouldSilenceStaleHookRejection(input: {
  reasonCode: string | undefined | null
  hasLivePendingBinding: boolean
}): boolean {
  if (input.reasonCode !== 'workspace_hooks_review_superseded') return false
  return !input.hasLivePendingBinding
}

/** 触发判定的现场。工具名只在 PreToolUse/PostToolUse/PermissionRequest 这类事件下有意义。 */
export interface HookEventContext {
  /** 事件名。 */
  event: string
  /** 工具名。matcher 非空时按它匹配。 */
  toolName?: string
}

/**
 * 这条 hook 在这个事件上该不该触发。
 *
 * 判定的三道门，逐条对齐 ZCode：
 *   1. 信任门 —— 需要 Trust 审核的 hook 一律不触发，且**看起来是关的**
 *      （`HooksList.tsx:299-302`：开关被强制置灰、checked 恒为 false）。
 *   2. 启用门 —— `hook.enabled`。
 *   3. 事件 + 匹配器 —— 事件名相等；matcher 为空则匹配全部输入
 *      （zh-CN `settings.hooks.matcherHint`），否则按逗号分隔的工具名列表匹配。
 *
 * **无法核实的部分**：matcher 的真实求值在 ZCode 的 runtime（工作区 hook 的执行器）里，
 * 本仓浅克隆的 `.tools/ZCode` **没有**那部分源码（`packages/services/src/hooks/` 下只有
 * 配置模型 `workspaceHookSettingsModel.ts` 与服务壳，没有 matcher 的匹配器）。
 * 上面这条「逗号分隔、精确匹配工具名」的规则是从 zh-CN 的
 * `matcherHint`（留空匹配全部）与 `matcherPlaceholder`（「例如 Write, Edit, Bash」）反推的
 * **文案口径**，不是从实现读出来的。若 ZCode 支持 glob/正则，本函数会判窄。
 */
export function hookEventOf(hook: AgentHook, context: HookEventContext): boolean {
  if (requiresWorkspaceHookTrust(hook)) return false
  if (!hook.enabled) return false
  if (hook.event !== context.event) return false
  const matcher = hook.matcher.trim()
  if (!matcher) return true
  const tool = (context.toolName ?? '').trim().toLowerCase()
  if (!tool) return false
  return matcher
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(tool)
}
