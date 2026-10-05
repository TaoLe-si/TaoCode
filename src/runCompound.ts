// 复合配置（IDEA `CompoundRunConfiguration`）的**运行顺序**：整组预检 → 依次启动 → 失败只回滚自己启动的实例。
//
// 为什么单独一个模块：这段是纯顺序逻辑，之前埋在 `src/runActions.ts` 的宿主里（要 `request`/`notify`/`workspace`），
// 于是一条判据都写不出来 —— 而它恰恰有"顺序、预检、回滚"三件容易写错的事：
//   · **预检必须在启动第一个成员之前**做完（含嵌套成员）：半路失败会让已经跑起来的成员白跑；
//   · 回滚**只能停自己启动的那些**（IDEA `ExecutionManagerImpl` 的实例归属语义），
//     停多了会顺手杀掉用户早就在跑的实例；
//   · debug 成员要拒绝：`CompoundRunConfiguration` 可以含调试配置，而本仓的 DAP 通道只有一个会话。
//
// 上游戏义：`CompoundRunConfiguration.kt` + `ExecutionManagerImpl.kt:613-619`（按配置决定并行/先停同名）、
// `RunConfigurationBase.getBeforeRunTasks`（成员各自的启动前链由宿主按实例跑）。
import { compoundRunMembers } from './runConfigTree.ts'
import type { RunConfig } from './settingsModel'

export interface CompoundRunPlan {
  /** 按启动顺序摊平的成员（嵌套的复合配置展开、共享成员只出现一次）。 */
  members: RunConfig[]
  /** 预检失败的原因（非 null 时 `members` 不该被启动）。 */
  error: string | null
}

/**
 * 整组预检（**不启动任何东西**）：把闭环摊平、逐个成员查能不能跑。
 * 与 `src/runConfigTree.ts` 的 `runConfigClosure` 同一套规则（那里查成员存在性/环/成员自身的字段），
 * 这里再补两条**只对"运行"成立**的约束：debug 成员、以及复合配置自己的 `allowRunningInParallel` 之外
 * 不需要的状态（本仓没有 per-member 的并行开关）。
 */
export function planCompoundRun(config: RunConfig, configs: readonly RunConfig[]): CompoundRunPlan {
  let members: RunConfig[]
  try {
    members = compoundRunMembers(config, configs)
  } catch (error) {
    return { members: [], error: error instanceof Error ? error.message : String(error) }
  }
  for (const member of members) {
    if (member.type === 'debug')
      return { members: [], error: `成员「${member.name}」是调试配置，不能作为运行成员（本仓的调试通道只有一个会话）。` }
    if (!member.command.trim() && !member.program?.trim())
      return { members: [], error: `成员「${member.name}」没有可执行的命令或程序。` }
    for (const entry of member.env ?? [])
      if (!entry.includes('=') || entry.startsWith('='))
        return { members: [], error: `成员「${member.name}」的环境变量要写成 KEY=VALUE：「${entry}」不合法。` }
  }
  if (!members.length) return { members: [], error: '复合配置没有可运行的成员。' }
  return { members, error: null }
}

export interface CompoundRunDeps {
  /** 启动一个成员，成功返回实例号；失败/工作区已换返回 null。 */
  start: (member: RunConfig) => Promise<number | null>
  /** 停一个实例（回滚用）。 */
  stop: (instance: number) => Promise<void>
  /** 每个成员启动前调用；返回 false 表示"工作区已经换了，别再往下启动"（默认恒 true）。 */
  stillCurrent?: () => boolean
}

/**
 * 依次启动成员。任一成员启动失败 ⇒ 停掉**本次已经启动**的那些并返回失败原因。
 * 返回 `{ started, failed }`：`failed` 为 null 表示整组都起来了。
 */
export async function runCompound(config: RunConfig, configs: readonly RunConfig[], deps: CompoundRunDeps): Promise<{ started: number[]; failed: string | null }> {
  const plan = planCompoundRun(config, configs)
  if (plan.error) return { started: [], failed: plan.error }
  const started: number[] = []
  for (const member of plan.members) {
    if (deps.stillCurrent && !deps.stillCurrent()) break
    const instance = await deps.start(member)
    if (instance === null) {
      // 启动失败不是"整组成功"：只停本次启动的实例（别动用户自己在跑的）。
      for (const id of started) {
        try {
          await deps.stop(id)
        } catch {
          /* 成员可能已经自己退出了 —— 停不掉不是错误。 */
        }
      }
      return { started, failed: `成员「${member.name}」启动失败，已停止本次启动的 ${started.length} 个成员。` }
    }
    started.push(instance)
  }
  return { started, failed: null }
}
