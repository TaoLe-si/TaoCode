// 启动活动流水线 —— 上游 `com.intellij.ide.startup` 一族在本仓的对应物：
//   · `StartupManagerImpl` 的活动调度：按阶段跑、每个活动**独立** try/catch（`runOldActivity`
//     把异常记日志后继续，:498-510）、一个项目只跑一次（本仓的 token 等价物是「工作区代次」）；
//   · `StartupActivityTracker`（ActivityTracker）：启动活动没跑完时对外报「startup-activities
//     进行中」，`awaitConfiguration` 等全部跑完；
//   · `CheckKeysStartupActivity`（:28-45）：**只在 headless** 时检查必需环境键，缺一个就用
//     `MissingEnvironmentKeyException` 文案报出来（用 `!!!___***undefined***___!!!` 哨兵区分
//     「缺键」与「键值就是空串」）。
//
// 本仓的消费链：`src/workspaceLifecycle.ts` 的 `bootstrap` 跑 `configuration` 阶段、
// `activateWorkspace` 跑 `projectOpened`/`postStartup` 阶段（每次打开新工作区一个新 token）。
// 没有插件宿主的对应物：上游的活动来自 EP，本仓是模块内显式注册（`registerStartupActivity`）。
import { missingEnvironmentKeyMessage } from './environmentKeys.ts'
import type { EnvironmentKey, EnvironmentKeyProvider, EnvironmentService } from './environmentKeys.ts'

export type StartupActivityPhase = 'configuration' | 'projectOpened' | 'postStartup'

export interface StartupActivityContext {
  /** 活动自己的错误不打断别人：宿主给一个出口（上游 `LOG.error` 的等价物）。 */
  onError?: (activity: StartupActivity, error: unknown) => void
}

export interface StartupActivity {
  id: string
  phase: StartupActivityPhase
  run: (context: StartupActivityContext) => void | Promise<void>
}

/** `CheckKeysStartupActivity.UNDEFINED` 的哨兵值。 */
export const ENV_KEY_UNDEFINED = '!!!___***undefined***___!!!'

const registry = new Map<string, StartupActivity>()
/** 每个 token 已跑过的活动（同一项目重入不重跑；失败也标记 —— 上游只记日志不重试）。 */
const ranByToken = new WeakMap<object, Set<string>>()

/** 注册一个启动活动（重复 id 覆盖，便于热更新；上游 EP 由插件宿主管理）。 */
export function registerStartupActivity(activity: StartupActivity): void {
  registry.set(activity.id, activity)
}

export function registeredStartupActivities(): StartupActivity[] {
  return [...registry.values()]
}

/** 测试用：清空注册表（不动已跑标记）。 */
export function resetStartupActivities(): void {
  registry.clear()
}

/**
 * 跑一个阶段的活动：顺序执行、逐个隔离异常、同一 token 每个活动最多一次。
 * 返回本次真正跑过的活动 id 与失败清单。
 */
export async function runStartupActivities(phase: StartupActivityPhase, context: StartupActivityContext = {},
                                           token: object = applicationToken): Promise<{ ran: string[]; failed: { id: string; error: unknown }[] }> {
  let ran = ranByToken.get(token)
  if (!ran) { ran = new Set<string>(); ranByToken.set(token, ran) }
  const result: { ran: string[]; failed: { id: string; error: unknown }[] } = { ran: [], failed: [] }
  for (const activity of registry.values()) {
    if (activity.phase !== phase || ran.has(activity.id)) continue
    ran.add(activity.id)
    result.ran.push(activity.id)
    try {
      await activity.run(context)
    } catch (error) {
      result.failed.push({ id: activity.id, error })
      context.onError?.(activity, error)
    }
  }
  if (phase === 'postStartup') markPostStartupPassed()
  return result
}

/** 应用级 token：不打开工作区也要跑的活动（配置阶段）用它。 */
export const applicationToken: object = { application: true }

// —— StartupActivityTracker：启动活动是否还在跑 ——
let postStartupPassed = false
let waiters: (() => void)[] = []

export function markPostStartupPassed(): void {
  if (postStartupPassed) return
  postStartupPassed = true
  const pending = waiters
  waiters = []
  for (const resolve of pending) resolve()
}

/** 关项目/换项目时复位（上游每个 Project 一份 StartupManager，本仓单窗口用全局标志）。 */
export function resetStartupProgress(): void {
  postStartupPassed = false
  waiters = []
}

export function startupActivityPassed(): boolean {
  return postStartupPassed
}

export function awaitStartupActivities(): Promise<void> {
  if (postStartupPassed) return Promise.resolve()
  return new Promise<void>(resolve => { waiters.push(resolve) })
}

/** 上游 `StartupActivityTracker`：`presentableName` = startup-activities。 */
export function createStartupActivityTracker(): {
  presentableName: string
  isInProgress: () => boolean
  awaitConfiguration: () => Promise<void>
} {
  return { presentableName: 'startup-activities', isInProgress: () => !postStartupPassed, awaitConfiguration: awaitStartupActivities }
}

/**
 * `CheckKeysStartupActivity`：只在 headless 里检查必需环境键（全缺了就把缺失文案合起来报一次）。
 * 上游 `delay(5.seconds)` 是等其它启动活动落地；本仓由调用方决定摆放的阶段，不内置延时。
 */
export function checkRequiredEnvironmentKeysActivity(options: {
  headless: () => boolean
  service: EnvironmentService
  providers: readonly EnvironmentKeyProvider[]
  report: (message: string) => void
}): StartupActivity {
  return {
    id: 'taocode.checkRequiredEnvironmentKeys',
    phase: 'configuration',
    run: () => {
      if (!options.headless()) return
      const missing: string[] = []
      for (const provider of options.providers) {
        for (const key of provider.requiredKeys?.() ?? []) {
          if (options.service.getEnvironmentValueOrDefault(key, ENV_KEY_UNDEFINED) === ENV_KEY_UNDEFINED)
            missing.push(missingEnvironmentKeyMessage(key))
        }
      }
      if (missing.length) options.report(missing.join('\n'))
    },
  }
}

/** 当前（单窗口）应用的必需键检查只针对 headless 预览模式：宿主自己会给真实键值。 */
export function requiredKeysOf(providers: readonly EnvironmentKeyProvider[]): EnvironmentKey[] {
  return providers.flatMap(provider => [...(provider.requiredKeys?.() ?? [])])
}
