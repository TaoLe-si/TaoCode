// 「浏览器控制」+「电脑控制」两节（ZCode section id `browser` / `computerUse`）的
// **可用性判定层** —— 2026-10-07。
//
// 为什么单独一个文件：这两节是 ZCode 设置里**唯一不能靠开关表达**的两节 ——
// 它们的可用性由「平台 + 工作区位置 + 系统授权」三层共同决定，ZCode 自己也是先算
// `resolveComputerUseAvailability` 再决定渲染不渲染（`ComputerUseSection.tsx:88-95, 686-700`）。
// 把判定散进组件，等于每处都重写一遍「远端 → 不可用」，迟早在某一处漏掉并画出假开关。
// 所以本模块**只出判定与准备步骤**，不出控件。**不许放假控件**是这一节的硬要求。
//
// 判定依据与 ZCode 出处（逐条）：
//   · 八种 kind 与判定顺序 —— `computerUseAvailability.ts:4-12, 28-59`：
//     **远端优先**（任一 remote 信号成立就直接判不可用，`:36-54`）→ 非桌面判 `web`
//     （`:55`）→ macOS 桌面判可用（`:56`）→ Windows 桌面判可用（`:57`）→ 其余 `local-linux` 不可用（`:58`）。
//   · 「远端或 Linux」这一支的判定 —— `computerUseAvailability.ts:69-71`（不可用且 kind 不是 web）。
//   · 不可用文案分「远端」与「Linux」两句 —— `zh-CN.ts:6484-6487`，由
//     `ComputerUseSection.tsx:692-698` 按 `isComputerUseRemoteOrLinux` 选。
//   · 权限态四值 `granted | stale | denied | unknown` —— `zcode-cua/broker.d.ts:95`。
//   · 「可用」的谓词是 `available === true` —— `zcode-cua/broker-ports.js:1-3`。
//   · 一键授权只认**新鲜**状态里的 `denied` / `stale`；`unknown` 不算缺权限
//     —— `cuaPermissionPreparation.ts:4-6, 12-24`（`:8-11` 的注释：功能探针失败与 unknown
//     只能进验证/重试，不能反推为系统权限缺失）。顺序固定 accessibility → screen_recording（`:16-23`）。
//   · 重启 Helper 后的复查：脱离 `stale`（granted/denied/unknown）即视为已解决；
//     持续 `stale` / unavailable / 抛错直到超时才升级到「重启 ZCode」—— `cuaPermissionRestartVerify.ts:25-56`。
//     默认总超时 6000ms、轮询间隔 500ms（`:20-21`）。
//   · Chrome 登录状态导入的错误码 → 文案映射与「部分成功」分支 —— `browserImportSummary.ts:9-56`。
//   · 浏览器控制总开关 = 官方 `browser-use@zcode-plugins-official` 插件的启用态
//     —— `BrowserSettingsSection.tsx:30, 153-157`。
//
// **诚实登记（本节为什么不渲染开关）**：
//   这两节依赖 `packages/zcode-cua` 的 CUA Helper（macOS TCC 授权 + AXIsProcessTrusted，
//   `cuaPermissionRestartVerify.ts:1-8`）与内置浏览器（WebView guest + Chrome 登录状态导入，
//   走 `platform.importChromeBrowserData` / `clearEmbeddedBrowserData`，
//   `BrowserSettingsSection.tsx:107-110`）。**本仓没有这两条通道**（宿主是 WebView2，
//   无 CUA Helper、无内置浏览器 guest），也没有 marketplace 去装 `browser-use` 插件。
//   所以本模块的产出是「诚实的不可用 + 缺什么 + 准备步骤」，不是开关。
//   判定层本身是真逻辑、可单测；渲染层只照着 `missing` 数组显示缺口文案。
import {
  defaultSettingsStorage,
  readSettingsJson,
  writeSettingsJson,
  type SettingsStorage,
} from './agentSettingsStore.ts'

/** 「电脑控制」节的存储键（只存判定输入的**快照**，用于让页面记住上次看到的结论，不是授权本身）。 */
export const AGENT_COMPUTER_USE_STORAGE_KEY = 'taocode.agent.computerUse.state'

/** 节标题（ZCode `zh-CN.ts:2267` / `:6474`）。 */
export const AGENT_BROWSER_CONTROL_TITLE = '浏览器控制'
export const AGENT_COMPUTER_USE_TITLE = '电脑控制'

/** 节 id（`settingsPageConfig.ts:125-138`：`browser` / icon `Globe2`，`computerUse` / icon `Monitor`）。 */
export const AGENT_BROWSER_SECTION_ID = 'browser'
export const AGENT_COMPUTER_USE_SECTION_ID = 'computerUse'

/** ZCode 官方浏览器控制插件 id（`BrowserSettingsSection.tsx:30`）。 */
export const ZCODE_BROWSER_USE_PLUGIN_ID = 'browser-use@zcode-plugins-official'

/** ZCode 电脑控制插件 id —— 见 `ComputerUseSection.tsx:125-128`（总开关 = 该插件的启用态），本仓**无法核实**具体字符串。 */
export const ZCODE_COMPUTER_USE_PLUGIN_ID_UNVERIFIED = 'zcode-cua@zcode-plugins-official'

// ---- 可用性判定 -------------------------------------------------------------

/** 八种环境（ZCode `computerUseAvailability.ts:4-12`，逐字照抄）。 */
export type AgentComputerUseKind =
  | 'local-macos'
  | 'local-windows'
  | 'local-linux'
  | 'remote-ssh'
  | 'remote-wsl'
  | 'remote-docker'
  | 'remote-server'
  | 'web'

/** 宿主平台输入（ZCode `computerUseAvailability.ts:19-22` 的前三个字段）。 */
export interface AgentComputerUsePlatform {
  isDesktop?: boolean
  isMacDesktop?: boolean
  isWindowsDesktop?: boolean
}

/** 工作区/远端输入（ZCode `computerUseAvailability.ts:23-25`）。 */
export interface AgentComputerUseState {
  remoteSessionId?: string | null
  /** `ssh` / `wsl` / `docker` / 其他（ZCode `computerUseAvailability.ts:43-49` 的三分支 + 兜底）。 */
  remoteTarget?: { kind?: string } | null
  /** `remote:ssh:host:port:user:/path` 形态的 workspace identity。 */
  workspaceIdentity?: string | null
  /** 该插件当前是否启用（ZCode `ComputerUseSection.tsx:125-128`；缺省视为未启用）。 */
  pluginEnabled?: boolean
  /** macOS 版本门槛（ZCode `platform.ts:506-517` `CuaOsSupport`；缺省 = 查询中或非 macOS → 按无门槛处理）。 */
  osSupport?: { kind: 'supported' | 'macos-below-minimum' | 'not-applicable'; minimumMacOs?: string; currentMacOs?: string } | null
}

export interface AgentComputerUseAvailability {
  kind: AgentComputerUseKind
  /**
   * 平台层判定，**逐字等于** ZCode `resolveComputerUseAvailability` 的 `supported`
   * （`computerUseAvailability.ts:55-58`）：只看「是不是桌面 / 哪种桌面」，不含插件与授权。
   * ZCode 把插件与 TCC 授权另判（`ComputerUseSection.tsx:87, 123, 125-128`），本模块照旧分开，
   * 免得改掉一个被别处引用的谓词。
   */
  supported: boolean
  /** 缺什么（有序）。`ready === true` 时为空数组。 */
  missing: string[]
  /** 平台可用 **且** 没有阻塞缺口 = 真能开。渲染层请读这个，不要只读 `supported`。 */
  ready: boolean
  /** 一句话结论（中文 UI 直接渲染）。 */
  reason: string
  /** ZCode 那一支的不可用文案 key（`zh-CN.ts:6484-6487`），交给渲染层查表。 */
  unsupportedMessageId: 'settings.computerUse.unsupported.linuxDescription' | 'settings.computerUse.unsupported.remoteDescription' | null
}

/** 远程 workspace identity 前缀（ZCode `remote-workspace-identity.ts:23`）。 */
const REMOTE_IDENTITY_PREFIX = 'remote:'

/** authority 必选段数（ZCode `remote-workspace-identity.ts:25-30`）。 */
const AUTHORITY_SEGMENTS: Record<string, number> = { ssh: 3, wsl: 1, docker: 1 }

/**
 * `workspaceIdentity` 是不是远程 identity（ZCode `isRemoteWorkspaceIdentity`，
 * `remote-workspace-identity.ts:111-113`，判据是 `parseRemoteWorkspaceIdentity(...) !== null`）。
 * 这里只实现那个解析器（`:68-108`）里与「是不是远程」有关的段数约束。
 */
export function isRemoteWorkspaceIdentity(identity: string): boolean {
  if (!identity.startsWith(REMOTE_IDENTITY_PREFIX)) return false
  const rest = identity.slice(REMOTE_IDENTITY_PREFIX.length)
  const kindEnd = rest.indexOf(':')
  if (kindEnd <= 0) return false
  const kind = rest.slice(0, kindEnd)
  const segments = AUTHORITY_SEGMENTS[kind]
  if (segments === undefined) return false
  let cursor = kindEnd + 1
  // 逐段消费 authority；path 段可能含 ":"（posix 合法字符），所以不能整体 split
  // —— 按段推进后取剩余整段为 path（ZCode `:83-92`）。
  for (let index = 0; index < segments; index += 1) {
    const next = rest.indexOf(':', cursor)
    if (next <= cursor) return false
    cursor = next + 1
  }
  // WSL 多一个可选 user 段：旧解析器只消费 distro，会把 user 误判成路径。
  // 远端路径必以 "/" 开头，所以能无歧义地区分 legacy 无 user 与显式 user（ZCode `:93-102`）。
  if (kind === 'wsl' && rest[cursor] !== '/') {
    const userEnd = rest.indexOf(':', cursor)
    if (userEnd <= cursor) return false
    cursor = userEnd + 1
  }
  return rest.slice(cursor).startsWith('/')
}

/** 远端信号（ZCode `computerUseAvailability.ts:36-40`，逐字平移）。 */
function isRemote(state: AgentComputerUseState): boolean {
  if (state.remoteSessionId) return true
  if (state.remoteTarget) return true
  const identity = state.workspaceIdentity?.trim()
  return Boolean(identity && isRemoteWorkspaceIdentity(identity))
}

type AgentComputerUseRemoteKind = 'remote-ssh' | 'remote-wsl' | 'remote-docker' | 'remote-server'

/** 远端 kind（ZCode `computerUseAvailability.ts:42-49`：ssh / wsl / docker，其余兜底 `remote-server`）。 */
function remoteKind(state: AgentComputerUseState): AgentComputerUseRemoteKind {
  const kind = state.remoteTarget?.kind
  if (kind === 'ssh') return 'remote-ssh'
  if (kind === 'wsl') return 'remote-wsl'
  if (kind === 'docker') return 'remote-docker'
  return 'remote-server'
}

/** 四种远端的展示名。ZCode 那侧只用一句合并文案（`zh-CN.ts:6484-6485`），这里按 kind 拆开只为说清「缺的是哪一种远端」。 */
const REMOTE_LABEL: Record<AgentComputerUseRemoteKind, string> = {
  'remote-ssh': 'SSH 远端',
  'remote-wsl': 'WSL 远端',
  'remote-docker': 'Docker 远端',
  'remote-server': '远端环境',
}

/**
 * 电脑控制可用性（ZCode `resolveComputerUseAvailability`，`computerUseAvailability.ts:28-59`）。
 *
 * 判定顺序**不可调换**：远端优先于一切，然后才是「是不是桌面 / 哪种桌面」。
 * `supported` 逐字照抄 ZCode 的平台判定（macOS/Windows 桌面为真，Linux 桌面与 web 为假）。
 *
 * ZCode 那一侧另外两件事**不**并进 `supported`，这里同样分开：
 *   · 插件总开关（`ComputerUseSection.tsx:87, 125-128`）；
 *   · macOS 版本地板（`ComputerUseSection.tsx:123` 的 `macOsBelowCuaFloor`）。
 * 它们进 `missing` / `ready`。ZCode 只有一句 `unsupported.title` + 一句按环境分支的描述
 * （`:686-700`），不足以让用户知道下一步该做什么，所以本模块把它展开成有序缺口清单。
 */
export function computerUseAvailability(
  platform: AgentComputerUsePlatform = {},
  state: AgentComputerUseState = {},
): AgentComputerUseAvailability {
  const isDesktop = platform.isDesktop === true
  const isMacDesktop = platform.isMacDesktop === true
  const isWindowsDesktop = platform.isWindowsDesktop === true

  if (isRemote(state)) {
    const kind = remoteKind(state)
    return {
      kind,
      supported: false,
      missing: [
        `当前工作区在${REMOTE_LABEL[kind]}里，Computer Use 只在本机 macOS 或 Windows 工作区可用。`,
        '需要切换到一个本机工作区（本仓没有远端工作区功能，所以本节在当前宿主上恒不可用）。',
      ],
      ready: false,
      reason: `当前环境不可用：${REMOTE_LABEL[kind]}不支持电脑控制。`,
      unsupportedMessageId: 'settings.computerUse.unsupported.remoteDescription',
    }
  }
  if (!isDesktop) {
    return {
      kind: 'web',
      supported: false,
      missing: [
        '当前不是桌面宿主，Computer Use 需要桌面端的 CUA Helper（本仓宿主是 WebView2，没有 CUA Helper）。',
        '需要桌面版宿主 + 本机 macOS 或 Windows 工作区。',
      ],
      ready: false,
      reason: '当前环境不可用：非桌面宿主不支持电脑控制。',
      unsupportedMessageId: 'settings.computerUse.unsupported.remoteDescription',
    }
  }
  if (isMacDesktop) {
    const missing = macMissing(state)
    return {
      kind: 'local-macos',
      supported: true,
      missing,
      ready: missing.length === 0,
      reason: missing.length === 0 ? '当前环境支持电脑控制。' : '当前环境暂不支持电脑控制。',
      unsupportedMessageId: missing.length === 0 ? null : 'settings.computerUse.unsupported.linuxDescription',
    }
  }
  if (isWindowsDesktop) {
    // ZCode 侧 Windows 只复用插件总开关（`ComputerUseSection.tsx:81` 注释：macOS 才具备
    // TCC 权限与 Helper 状态能力），所以这里不查 TCC。
    const missing = state.pluginEnabled === true ? [] : ['电脑控制插件未启用（ZCode 侧总开关 = zcode-cua 插件的启用态）。']
    return {
      kind: 'local-windows',
      supported: true,
      missing,
      ready: missing.length === 0,
      reason: missing.length === 0 ? '当前环境支持电脑控制。' : '当前环境暂不支持电脑控制。',
      unsupportedMessageId: missing.length === 0 ? null : 'settings.computerUse.unsupported.linuxDescription',
    }
  }
  return {
    kind: 'local-linux',
    supported: false,
    missing: [
      '当前是 Linux 桌面宿主，ZCode 的 Computer Use 不支持 Linux（`ComputerUseSection.tsx:694-696` 单独给这一支文案）。',
      '需要本机 macOS 或 Windows 工作区。',
    ],
    ready: false,
    reason: '当前环境不可用：Linux 桌面不支持电脑控制。',
    unsupportedMessageId: 'settings.computerUse.unsupported.linuxDescription',
  }
}

/** macOS 桌面额外缺口：版本地板 + 插件总开关。 */
function macMissing(state: AgentComputerUseState): string[] {
  const missing: string[] = []
  // 版本地板：低于 Helper 的 LSMinimumSystemVersion 时 Helper 会被 LaunchServices 拒启
  // （ZCode `platform.ts:510-511`）。查询失败按无门槛处理（`ComputerUseSection.tsx:105`）。
  if (state.osSupport?.kind === 'macos-below-minimum') {
    missing.push(
      `macOS 版本低于 CUA Helper 地板 ${state.osSupport.minimumMacOs ?? '12.0'}（当前 ${state.osSupport.currentMacOs ?? '未知'}），`
      + 'Helper 会被系统拒启（ZCode `platform.ts:510-511`）。',
    )
  }
  if (state.pluginEnabled !== true) {
    missing.push('电脑控制插件未启用（ZCode 侧总开关 = zcode-cua 插件的启用态，`ComputerUseSection.tsx:125-128`）。')
  }
  return missing
}

// ---- 权限准备步骤 -----------------------------------------------------------

/** 两种系统权限（ZCode `shared/src/cuaAccessibilitySettings.ts:1`，逐字照抄）。 */
export type CuaPermissionKind = 'accessibility' | 'screen_recording'

/** 权限态四值（ZCode `zcode-cua/broker.d.ts:95`）。 */
export type CuaPermissionStateValue = 'granted' | 'stale' | 'denied' | 'unknown'

/** 权限快照。`available` 不是 `true` 就是不可用（ZCode `zcode-cua/broker-ports.js:1-3`）。 */
export interface CuaPermissionStatusLike {
  available?: true
  accessibility: CuaPermissionStateValue
  screenRecording: CuaPermissionStateValue
  reason?: string
}

export interface CuaPermissionPreparation {
  /** 还需要用户去授权的权限（ZCode `requiredCuaPermissionsForFreshStatus` 的逐字平移，顺序固定）。 */
  required: CuaPermissionKind[]
  /** 有序准备步骤（渲染层按序渲染，已满足的划掉）。 */
  steps: CuaPermissionPreparationStep[]
  /** 全部满足 = 可以进入下一步（重启 Helper / 重启应用）。 */
  ready: boolean
}

export interface CuaPermissionPreparationStep {
  id: 'permission:accessibility' | 'permission:screen_recording' | 'restart-helper' | 'verify' | 'restart-app'
  title: string
  detail: string
  /** 已满足（不需要用户做任何事）。 */
  satisfied: boolean
}

/** 可操作的权限态（ZCode `cuaPermissionPreparation.ts:4-6`）：**只有** `denied` / `stale` 算缺权限。 */
function actionablePermissionState(state: CuaPermissionStateValue | undefined): boolean {
  return state === 'denied' || state === 'stale'
}

/**
 * 准备步骤序列。
 *
 * `required` 是 ZCode `cuaPermissionPreparation.ts:12-24` 的逐字平移：
 * 只有 `denied` / `stale` 进清单，`unknown` 与探针失败**不**算系统权限缺失
 * （那条规则的注释在 `cuaPermissionPreparation.ts:8-11`，本仓照抄 —— 把 unknown 当成缺权限
 * 会让用户去系统设置里找一个根本不存在的授权项）。
 * `steps` 是在这之上展开的有序序列，后两步（重启 Helper / 复查 / 升级到重启应用）
 * 来自 `cuaPermissionRestartVerify.ts:1-8` 描述的那条链路。
 */
export function cuaPermissionPreparation(status: CuaPermissionStatusLike | null | undefined): CuaPermissionPreparation {
  const required: CuaPermissionKind[] = []
  if (status) {
    if (actionablePermissionState(status.accessibility)) required.push('accessibility')
    if (actionablePermissionState(status.screenRecording)) required.push('screen_recording')
  }
  const steps: CuaPermissionPreparationStep[] = [
    {
      id: 'permission:accessibility',
      title: '授予「辅助功能」权限',
      detail: 'macOS TCC 的 accessibility 项；CUA Helper 靠它发键鼠事件。',
      satisfied: !required.includes('accessibility'),
    },
    {
      id: 'permission:screen_recording',
      title: '授予「屏幕录制」权限',
      detail: 'macOS TCC 的 screen_recording 项；CUA Helper 靠它抓屏。',
      satisfied: !required.includes('screen_recording'),
    },
    {
      id: 'restart-helper',
      title: '重启 CUA Helper',
      detail: '授权后运行中 Helper 的 AXIsProcessTrusted 是进程级缓存，必须出新进程才吃得到（`cuaPermissionRestartVerify.ts:3-4`）。',
      satisfied: false,
    },
    {
      id: 'verify',
      title: '复查辅助功能状态',
      detail: 'tccd 传播有几秒 lag，重启后轮询 accessibility 直到脱离 stale（`cuaPermissionRestartVerify.ts:5, 7`）。',
      satisfied: false,
    },
    {
      id: 'restart-app',
      title: '重启应用（兜底）',
      detail: '直到超时仍 stale 才升级到这一条（`cuaPermissionRestartVerify.ts:8, 29`）。',
      satisfied: false,
    },
  ]
  return { required, steps, ready: required.length === 0 }
}

// ---- 重启后复查 -------------------------------------------------------------

/** 默认总超时 6000ms（ZCode `cuaPermissionRestartVerify.ts:20`）。 */
export const CUA_RESTART_VERIFY_TIMEOUT_MS = 6000
/** 默认轮询间隔 500ms（ZCode `cuaPermissionRestartVerify.ts:21`）。 */
export const CUA_RESTART_VERIFY_INTERVAL_MS = 500

export interface CuaRestartVerificationInput {
  /** 本次查询结果。可用则带两格权限态；不可用时给 `null`（等价于 ZCode 的 `unavailable` / 抛错分支）。 */
  result: CuaPermissionStatusLike | null
  /** 已经过去多少毫秒。**本模块不碰时钟**，由宿主算。 */
  elapsedMs: number
  timeoutMs?: number
  intervalMs?: number
}

export interface CuaRestartVerification {
  outcome: 'resolved' | 'pending' | 'escalate'
  /** 是否还要继续轮询（ZCode `:44-55` 的 `for(;;)`）。 */
  continuePolling: boolean
  /** 是否升级到「重启应用」兜底。 */
  shouldEscalate: boolean
  /** 权限是否已解决（`granted` / `denied` / `unknown` 都算脱离 stale）。 */
  resolved: boolean
  detail: string
  intervalMs: number
  timeoutMs: number
}

/**
 * 重启 Helper 之后的复查判定（ZCode `cuaPermissionRestartVerify.ts:37-56` 的纯函数化）。
 *
 * ZCode 那份是 async + 自己 sleep；这里不碰时钟、不碰 Promise，把「继续轮询 / 升级兜底」
 * 这一个决策提成纯函数，由宿主按返回的 `intervalMs` 自己排下一次查询。
 *
 * 三条判定逐字照抄 ZCode 的注释（`:31-35`）：
 *   · `granted` → 重启吃到授权了，**解决**，不升级。
 *   · `denied` / `unknown` → 是真实权限缺口（用户没授权），**不是重启失败**，不升级。
 *   · 持续 `stale` → tccd 缓存没刷新 / 重启机制卡住 → **升级**。
 *   · unavailable / 抛错 → 重启中途瞬时态，继续轮询；超时仍未恢复 → 升级。
 */
export function cuaRestartVerification(input: CuaRestartVerificationInput): CuaRestartVerification {
  const timeoutMs = input.timeoutMs ?? CUA_RESTART_VERIFY_TIMEOUT_MS
  const intervalMs = input.intervalMs ?? CUA_RESTART_VERIFY_INTERVAL_MS
  const elapsed = Number.isFinite(input.elapsedMs) && input.elapsedMs > 0 ? input.elapsedMs : 0
  // `isCuaPermissionStatusAvailable(result) && result.accessibility !== "stale"` —— ZCode `:47`。
  const notStale = input.result !== null && input.result.available === true && input.result.accessibility !== 'stale'
  if (notStale) {
    return {
      outcome: 'resolved',
      continuePolling: false,
      shouldEscalate: false,
      resolved: true,
      detail: `辅助功能状态已脱离 stale（当前 ${input.result?.accessibility}），无需升级到「重启应用」。`,
      intervalMs,
      timeoutMs,
    }
  }
  if (elapsed >= timeoutMs) {
    return {
      outcome: 'escalate',
      continuePolling: false,
      shouldEscalate: true,
      resolved: false,
      detail: input.result === null
        ? `重启后 ${timeoutMs}ms 内始终拿不到可用的权限状态，升级到「重启应用」兜底。`
        : `重启后 ${timeoutMs}ms 内辅助功能仍是 stale，升级到「重启应用」兜底。`,
      intervalMs,
      timeoutMs,
    }
  }
  return {
    outcome: 'pending',
    continuePolling: true,
    shouldEscalate: false,
    resolved: false,
    detail: `继续轮询辅助功能状态（已过 ${elapsed}ms / 上限 ${timeoutMs}ms）。`,
    intervalMs,
    timeoutMs,
  }
}

// ---- 浏览器登录状态导入摘要 --------------------------------------------------

/** Chrome 登录状态导入结果（ZCode `ChromeBrowserDataImportResult` 的用得到的那些格）。 */
export interface ChromeBrowserDataImportResultLike {
  success: boolean
  error?: string
  cookies?: { imported?: number; skipped?: number }
  localStorage?: { originsImported?: number; entriesImported?: number }
  issues?: string[]
}

export interface BrowserImportSummary {
  /** i18n message id（渲染层交给 `intl.formatMessage({ id }, values)`）。 */
  id: string
  values: Record<string, string>
  success: boolean
  /** 是不是「部分成功」—— 用户需要知道自己没拿到全部 Cookie。 */
  partial: boolean
}

/** 错误码 → 文案 key（ZCode `browserImportSummary.ts:9-33` 的那条链，逐字照抄）。 */
const IMPORT_ERROR_MESSAGE_IDS: Record<string, string> = {
  chrome_profile_not_found: 'settings.browser.import.notFound',
  chrome_default_profile_not_found: 'settings.browser.import.notFound',
  chrome_profile_ambiguous: 'settings.browser.import.ambiguous',
  chrome_executable_not_found: 'settings.browser.import.executableNotFound',
  chrome_cookie_access_denied: 'settings.browser.import.accessDenied',
  chrome_cookie_elevation_required: 'settings.browser.import.elevationRequired',
  chrome_cookie_elevation_cancelled: 'settings.browser.import.elevationCancelled',
  chrome_cookie_helper_verification_failed: 'settings.browser.import.helperVerificationFailed',
  chrome_cookie_app_bound_decryption_failed: 'settings.browser.import.appBoundFailed',
  chrome_cookie_protection_unsupported: 'settings.browser.import.cookieProtected',
  chrome_profile_locked: 'settings.browser.import.profileLocked',
  chrome_local_storage_import_failed: 'settings.browser.import.localStorageFailed',
}

/** 兜底文案 key（ZCode `browserImportSummary.ts:33`）。 */
const IMPORT_FAILED_MESSAGE_ID = 'settings.browser.import.failed'

/** 命中这四个 issue 就走「部分成功」（ZCode `browserImportSummary.ts:42-53`，逐字照抄那张表）。 */
const APP_BOUND_ISSUE_KEYS = [
  'chrome_cookie_elevation_required',
  'chrome_cookie_elevation_cancelled',
  'chrome_cookie_helper_verification_failed',
  'chrome_cookie_app_bound_decryption_failed',
]

/**
 * Chrome 登录状态导入的摘要（ZCode `formatImportSummary`，`browserImportSummary.ts:4-56`）。
 *
 * ZCode 那份接 `intl.formatMessage`；本模块不引 i18n 运行时，所以返回 `{ id, values }`
 * 让渲染层自己格式化 —— 判定分支与取值口径一字未改。
 */
export function browserImportSummary(raw: ChromeBrowserDataImportResultLike | null | undefined): BrowserImportSummary {
  const result = raw
  if (!result || result.success !== true) {
    const id = (result?.error && IMPORT_ERROR_MESSAGE_IDS[result.error]) || IMPORT_FAILED_MESSAGE_ID
    return { id, values: {}, success: false, partial: false }
  }
  const values = {
    cookies: String(result.cookies?.imported ?? 0),
    origins: String(result.localStorage?.originsImported ?? 0),
    entries: String(result.localStorage?.entriesImported ?? 0),
    skipped: String(result.cookies?.skipped ?? 0),
  }
  // App-Bound 授权/校验失败是用户刚显式确认的动作，单独保留部分成功提示，
  // 避免用户误以为 Cookie 已导入（ZCode 注释，`browserImportSummary.ts:54-56`）。
  const partial = (result.issues ?? []).some((issue) => APP_BOUND_ISSUE_KEYS.includes(issue))
  return {
    id: partial ? 'settings.browser.import.partialAppBound' : 'settings.browser.import.success',
    values,
    success: true,
    partial,
  }
}

// ---- 浏览器控制的可用性 -----------------------------------------------------

export interface AgentBrowserControlAvailability extends AgentComputerUseAvailability {
  /** 官方插件是否已启用（ZCode `BrowserSettingsSection.tsx:153-157` 的判据）。 */
  pluginEnabled: boolean
  /** 原生通道（导入/清缓存/清全部）是否在（ZCode `BrowserSettingsSection.tsx:107-110`）。 */
  nativeActionsAvailable: boolean
}

/**
 * 「浏览器控制」节的可用性（ZCode `BrowserSettingsSection.tsx:30, 107-110, 242-243, 302-339`）。
 *
 * ZCode 那边这一节的开关**就是** `browser-use@zcode-plugins-official` 的启用态（`:30, 153`），
 * 数据管理区在非桌面宿主上整块换成一句「浏览器数据只能在 ZCode 桌面端管理。」（`:335-339`，
 * i18n `zh-CN.ts:2280`）。本仓两样都没有：没有 marketplace 装那个插件，也没有内置浏览器 guest
 * 与 `importChromeBrowserData` / `clearEmbeddedBrowserData` 通道。
 *
 * 与电脑控制同口径：`supported` 只承载 ZCode 的平台判定，插件/通道这两条硬依赖进 `missing` / `ready`。
 */
export function browserControlAvailability(
  platform: AgentComputerUsePlatform = {},
  state: AgentComputerUseState = {},
): AgentBrowserControlAvailability {
  const base = computerUseAvailability(platform, state)
  const pluginEnabled = state.pluginEnabled === true
  const nativeActionsAvailable = base.kind === 'local-macos' || base.kind === 'local-windows'
  const missing = [...base.missing]
  if (!pluginEnabled) {
    missing.push(`浏览器控制依赖官方插件 ${ZCODE_BROWSER_USE_PLUGIN_ID}，本仓没有 marketplace，无法安装或启用。`)
  }
  if (!nativeActionsAvailable) {
    missing.push('导入 Chrome 登录状态 / 清除内置浏览器数据需要桌面端的内置浏览器通道，本仓宿主没有。')
  }
  return {
    ...base,
    missing,
    ready: base.ready && pluginEnabled && nativeActionsAvailable,
    reason: base.ready && pluginEnabled && nativeActionsAvailable
      ? '浏览器控制可用。'
      : '当前环境不可用：缺少内置浏览器通道与官方 Browser Use 插件。',
    pluginEnabled,
    nativeActionsAvailable,
  }
}

// ---- 状态快照的持久化 -------------------------------------------------------

/** 落盘的那份快照。**不是授权本身** —— 只是让页面在重开后还能显示上次那条诚实结论。 */
export interface AgentComputerUseStoredState {
  kind: AgentComputerUseKind
  supported: boolean
  missing: string[]
  pluginEnabled: boolean
}

export function defaultAgentComputerUseState(): AgentComputerUseStoredState {
  return { kind: 'web', supported: false, missing: [], pluginEnabled: false }
}

function normalizeKind(value: unknown): AgentComputerUseKind {
  const kinds: AgentComputerUseKind[] = [
    'local-macos', 'local-windows', 'local-linux', 'remote-ssh', 'remote-wsl', 'remote-docker', 'remote-server', 'web',
  ]
  return kinds.includes(value as AgentComputerUseKind) ? value as AgentComputerUseKind : 'web'
}

function normalizeStoredState(input: unknown): AgentComputerUseStoredState {
  const defaults = defaultAgentComputerUseState()
  if (!input || typeof input !== 'object') return defaults
  const raw = input as Record<string, unknown>
  const missing = Array.isArray(raw.missing)
    ? raw.missing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  return {
    kind: normalizeKind(raw.kind),
    supported: raw.supported === true,
    missing,
    pluginEnabled: raw.pluginEnabled === true,
  }
}

export function loadAgentComputerUseState(
  storage: SettingsStorage | null = defaultSettingsStorage(),
): AgentComputerUseStoredState {
  return readSettingsJson(storage, AGENT_COMPUTER_USE_STORAGE_KEY, normalizeStoredState)
}

export function saveAgentComputerUseState(
  state: AgentComputerUseStoredState,
  storage: SettingsStorage | null = defaultSettingsStorage(),
): boolean {
  return writeSettingsJson(storage, AGENT_COMPUTER_USE_STORAGE_KEY, state)
}
