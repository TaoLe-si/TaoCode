// 运行器调度 —— 上游 `ProgramRunner` / `RunnerRegistry` / `Executor` 的**可移植子集**。
//
// 上游依据：
//   · `platform/execution/src/com/intellij/execution/runners/ProgramRunner.java:52-71`
//     —— `getRunner(executorId, settings)` = 第一个 `canRun(executorId, profile)` 为真的 runner；
//     `getRunnerId()`（`:74-78`）是稳定 id；`canRun`（`:80-88`）自报能跑哪些（配置 × 执行器）组合。
//   · `platform/execution/src/com/intellij/execution/Executor.java` 一族 —— 执行器是「怎么跑」那一维
//     （Run / Debug / Profile / Coverage…），`DefaultRunExecutor.EXECUTOR_ID = "Run"`、
//     `DefaultDebugExecutor.EXECUTOR_ID = "Debug"`。
//   · `platform/lang-api/src/com/intellij/execution/RunnerRegistry.java` —— 注册表，`getRunner` 按序问。
//
// 本仓的现状与这个模块的关系（写清楚，不冒充）：
//   · 上游每个 runner 是插件贡献点（`com.intellij.programRunner`），每种 runner 自报能跑哪些配置；
//     本仓**没有插件贡献点宿主**，所以注册表是**内建清单**（Run/Debug 两条 + 由配置类型决定的
//     适用性），这就是可移植的那一半：`canRun` 的判定链、`getRunner` 的「第一个认下的赢」、
//     找不到 runner 时给得出理由。
//   · 消费点 `src/runActions.ts` 的 `runSelectedConfig`：本批把「选哪个执行器路径」从写死的
//     `if (debug) … else …` 改成问这张表（`pickRunner`），两条内建 runner 的行为与之前逐字一致。
//
// 判据 `tests/run-program-runner.test.mjs`。

import type { RunConfig } from './settingsModel.ts'
import { APPLICATION_SCOPE, EXTENSIONS } from './extensionPoints.ts'

/** EP id（逐字取自上游 `platform/execution/resources/intellij.platform.execution.xml:31` 的
 *  `qualifiedName="com.intellij.programRunner"`，`interface=ProgramRunner` `dynamic="true"`）。 */
export const PROGRAM_RUNNER_EP = 'com.intellij.programRunner'

/** 插件贡献一个运行器（等价于上游 plugin.xml 的 `<com.intellij.programRunner implementation="..."/>`）。 */
export function registerProgramRunner(runner: ProgramRunner, id?: string): () => void {
  const handle = programRunnerRegistry.register(runner, id)
  return () => { handle() }
}

/** 内建运行器 + 插件贡献的运行器（内建在前 ⇒ 「第一个认下的赢」与只内建时逐字一致）。 */
export function allProgramRunners(): readonly ProgramRunner[] {
  return programRunnerRegistry.all()
}

/** 执行器 id（上游 `Executor.getId()`；本仓只两条，见 `src/keymap.ts` 的 Run/Debug 路径）。 */
export type ExecutorId = 'Run' | 'Debug'

/** 上游 `DefaultRunExecutor.EXECUTOR_ID`。 */
export const RUN_EXECUTOR_ID: ExecutorId = 'Run'
/** 上游 `DefaultDebugExecutor.EXECUTOR_ID`。 */
export const DEBUG_EXECUTOR_ID: ExecutorId = 'Debug'

/** 运行器要判的配置面：`RunConfig` 的 type/name 加临时标记（`RuntimeRunConfig` 的超集，
 *  见 `src/runTargets.ts:19-22`）。用窄接口而不是直接吃 `RunConfig`，是为了让纯函数能被
 *  单测构造最小对象（也不需要 import settingsModel 的整张联合）。 */
export interface RunnerProfile {
  name: string
  type?: RunConfig['type']
  /** `RuntimeRunConfig.temporary`：上下文生成的临时配置（走各自的链路）。 */
  temporary?: boolean
}

/** 一个运行器（上游 `ProgramRunner` 的 id + canRun + 一句不可跑的理由）。 */
export interface ProgramRunner {
  /** 稳定 id（上游 `getRunnerId()`）。 */
  runnerId: string
  /** 这个 runner 服务哪个执行器（本仓的 runner 与执行器一一对应；上游由 canRun 隐式表达）。 */
  executorId: ExecutorId
  /** 能跑哪些（执行器 × 配置）组合（上游 `canRun(executorId, profile)`）。 */
  canRun(executorId: ExecutorId, config: RunnerProfile): boolean
  /** 认不下时给一句理由（上游没有这一格，本仓面板要能说清为什么被挡）。 */
  refusalReason(executorId: ExecutorId, config: RunnerProfile): string
}

/**
 * 内建运行器表（顺序 = 询问顺序，第一个认下的赢 —— 上游 `getRunner` 的 `findFirstSafe`）。
 * 与 `src/runActions.ts` 改之前的两条路径逐字一致：
 *   · `GenericProgramRunner`（Run）：任何非 debug 类型的配置都能起进程；debug 类型的配置要用户
 *     显式用 Shift+F9（配置里勾了调试），用 Run 跑它会被挡；
 *   · `DebugProgramRunner`（Debug）：debug 类型、或临时配置（上下文生成的 Java 配置走
 *     `runJavaContext`）、或复合配置（成员各自跑）能调试；其余要用户先把配置勾成调试类型。
 */
export const BUILTIN_PROGRAM_RUNNERS: readonly ProgramRunner[] = [
  {
    runnerId: 'GenericProgramRunner',
    executorId: RUN_EXECUTOR_ID,
    canRun: (executorId, config) => executorId === RUN_EXECUTOR_ID && config.type !== 'debug',
    refusalReason: (executorId, config) => executorId === RUN_EXECUTOR_ID && config.type === 'debug'
      ? `配置「${config.name}」是调试类型；用 Shift+F9 调试它。`
      : `运行器不适用于执行器 ${executorId}。`,
  },
  {
    runnerId: 'DebugProgramRunner',
    executorId: DEBUG_EXECUTOR_ID,
    canRun: (executorId, config) => executorId === DEBUG_EXECUTOR_ID
      && (config.type === 'debug' || config.temporary === true || config.type === 'compound'),
    refusalReason: (executorId, config) => executorId === DEBUG_EXECUTOR_ID
      ? `配置「${config.name}」不是调试类型；在运行配置里勾选“调试”后才会交给 DAP。`
      : `运行器不适用于执行器 ${executorId}。`,
  },
]

/**
 * 选运行器（上游 `ProgramRunner.getRunner` 的等价物）：按注册顺序问第一个 `canRun` 为真的。
 * 复合配置与临时 Java 配置由调用方在选之前分流（它们各自的链路不同），所以这里只判类型。
 */
export function pickRunner(
  executorId: ExecutorId, config: RunnerProfile, runners: readonly ProgramRunner[] = allProgramRunners(),
): ProgramRunner | null {
  return runners.find(runner => runner.canRun(executorId, config)) ?? null
}

/**
 * 选运行器，认不下时给出理由（面板拿它显示错误；上游是 `ExecutionUtil.handleExecutionError` 那条路）。
 * 返回 `{ runner }` 或 `{ reason }` 二选一。
 */
export function resolveRunner(
  executorId: ExecutorId, config: RunnerProfile, runners: readonly ProgramRunner[] = allProgramRunners(),
): { runner: ProgramRunner; reason: null } | { runner: null; reason: string } {
  const runner = pickRunner(executorId, config, runners)
  if (runner) return { runner, reason: null }
  // 找不到就按**同执行器**的那个 runner 问一句理由（它最清楚该执行器下为什么不行）。
  const sameExecutor = runners.find(candidate => candidate.executorId === executorId) ?? runners[0]
  return { runner: null, reason: sameExecutor.refusalReason(executorId, config) }
}

/** 按 id 找运行器（上游 `findRunnerById`）。 */
export function runnerById(id: string, runners: readonly ProgramRunner[] = allProgramRunners()): ProgramRunner | undefined {
  return runners.find(runner => runner.runnerId === id)
}

/**
 * 这条配置在这个执行器下会交给哪个 runner（上游 `ProgramRunner.getRunner(executorId, profile)` 之后
 * 取 `getRunnerId()` 的那一步）。找不到就用第一条内建 runner 的 id 兜底 —— 与
 * `resolveRunner` 的「认不下时问同执行器那条 runner」同一口径，不凭空造一个新 id。
 * 消费点：`src/runActions.ts` 把 runnerId 交给运行配置扩展（`patchCommandLine` 的第四格）。
 */
export function runnerIdFor(
  executorId: string,
  config: { name: string; type?: string; temporary?: boolean },
  runners: readonly ProgramRunner[] = allProgramRunners(),
): string {
  // `canRun` 只比字符串（`config.type !== 'debug'` 那几档）⇒ 宽类型传进去是安全的；
  // 这里 cast 一次，免得让调用方（运行配置扩展那条路）为「type 是不是封闭联合」买单。
  return pickRunner(executorId as ExecutorId, config as RunnerProfile, runners)?.runnerId
    ?? (runners[0]?.runnerId ?? BUILTIN_PROGRAM_RUNNERS[0].runnerId)
}

/** 这个配置有没有**任意**执行器能跑它（面板判断「能不能启动」时用；上游没有这一格，是本仓的便利函数）。 */
export function hasAnyRunner(config: RunnerProfile, runners: readonly ProgramRunner[] = allProgramRunners()): boolean {
  return (['Run', 'Debug'] as const).some(executorId => pickRunner(executorId, config, runners) !== null)
}

// ── 注册表：上游 `RunnerRegistry` 的可移植子集（`register/unregister/adoptFromExtensions/find/all`） ──
/**
 * 运行器注册表。内建那两条在构造时给定（顺序 = 询问顺序），插件贡献走 `com.intellij.programRunner` EP。
 * `all()` 把内建放在**前面**、EP 贡献接在后面并按 runnerId 去重 —— 于是「第一个认下的赢」在只内建时
 * 与重构前逐字一致，插件想覆盖内建同名 runner 时后注册的同类不会被内建抢走（用同 id 覆盖 EP 里的那条）。
 */
export class ProgramRunnerRegistry {
  private readonly builtins: readonly ProgramRunner[]
  private readonly items = new Map<string, ProgramRunner>()
  private readonly external?: () => ProgramRunner[]

  // 显式字段 + 赋值，不写 TS 参数属性（node --test 直载 .ts 会 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX）。
  constructor(builtins: readonly ProgramRunner[], external?: () => ProgramRunner[]) {
    this.builtins = builtins
    this.external = external
  }

  /** 注册一个运行器（写 EP + 内部表）。返回注销函数（与重构前 `registerProgramRunner` 同形状）。 */
  register(runner: ProgramRunner, id?: string): () => void {
    const key = id ?? `programRunner.${runner.runnerId}`
    this.items.set(runner.runnerId, runner)
    const handle = EXTENSIONS.registerExtension<ProgramRunner>(PROGRAM_RUNNER_EP, key, runner, { source: 'user' })
    return () => { this.items.delete(runner.runnerId); handle.dispose() }
  }

  /** 注销（内部表 + EP 表）。返回是否真的删掉了。 */
  unregister(id: string): boolean {
    const removedInternal = this.items.delete(id)
    // EP 里的贡献键是 `programRunner.<id>` 或自定义 id，两种都试。
    const removedExtension = EXTENSIONS.unregisterExtension(PROGRAM_RUNNER_EP, id)
      || EXTENSIONS.unregisterExtension(PROGRAM_RUNNER_EP, `programRunner.${id}`)
    return removedInternal || removedExtension
  }

  /** 收编 EP 里未登记进内部表的贡献（插件直接挂 EP 的那些）。返回新增条数。 */
  adoptFromExtensions(): number {
    let adopted = 0
    for (const runner of this.external?.() ?? []) {
      if (!runner?.runnerId || this.items.has(runner.runnerId)) continue
      this.items.set(runner.runnerId, runner)
      adopted += 1
    }
    return adopted
  }

  /** 按 id 找运行器（上游 `findRunnerById`）。 */
  find(id: string): ProgramRunner | undefined {
    const fromExtensions = (this.external?.() ?? []).find(runner => runner.runnerId === id)
    return fromExtensions ?? this.items.get(id) ?? this.builtins.find(runner => runner.runnerId === id)
  }

  /** 全部运行器：内建在前，再 EP 贡献，再内部表，按 runnerId 去重。 */
  all(): readonly ProgramRunner[] {
    const seen = new Set<string>()
    const out: ProgramRunner[] = []
    for (const runner of [...this.builtins, ...(this.external?.() ?? []), ...this.items.values()]) {
      if (seen.has(runner.runnerId)) continue
      seen.add(runner.runnerId)
      out.push(runner)
    }
    return out
  }
}

/** 进程内唯一注册表：内建两条 + `com.intellij.programRunner` EP 贡献。 */
export const programRunnerRegistry = new ProgramRunnerRegistry(
  BUILTIN_PROGRAM_RUNNERS,
  () => EXTENSIONS.extensionsOf<ProgramRunner>(PROGRAM_RUNNER_EP),
)

// 声明 EP（幂等）—— 上游这条 EP 让插件贡献自己的 `ProgramRunner`。
EXTENSIONS.declareExtensionPoint({
  id: PROGRAM_RUNNER_EP, name: '程序运行器', scope: APPLICATION_SCOPE, dynamic: true,
})