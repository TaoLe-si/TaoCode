// **执行器**（上游 `com.intellij.execution.Executor` + `ExecutorRegistry` + `com.intellij.executor` EP）
// 在本仓的落地：一张按 id 的注册表 + 两条内建执行器（Run / Debug）+ 与上游**同名的方法面**。
//
// 上游依据（逐条开文件核过）：
//   · `platform/execution/src/com/intellij/execution/Executor.java`
//     —— `EXECUTOR_EXTENSION_NAME = new ExtensionPointName<>("com.intellij.executor")`（`:31`）；
//     方法面 `getToolWindowId()`（`:35`）、`getIcon()`（`:40`）、`getRerunIcon()`（`:44`）、
//     `getDisabledIcon()`（`:49`）、`getDescription()`（`:54`）、`getActionName()`（`:56`）、
//     `getToolWindowTitle()`（`:61`，默认 = `getActionName()`）、`getId()`（`:66`）、
//     `getStartActionText()`（`:71`）、`getContextActionId()`（`:73`）、`getHelpId()`（`:75`）、
//     `getStartActionText(configurationName)`（`:82-85`，默认实现 = 动作文案后接 ` '配置名'`）、
//     `isApplicable(project)`（`:90`，默认 true，「返回 false 就不显示这条动作」）、
//     `isSupportedOnTarget()`（`:96`，默认 false）、`shortenNameIfNeeded(name)`（`:101-103`，
//     读注册表键 `run.configuration.max.name.length`，默认 80，中间省略）。
//   · `platform/execution/src/com/intellij/execution/ExecutorRegistry.java` —— 抽象服务，
//     `getExecutorById(executorId)`（`:20`）与（已废弃的）`getRegisteredExecutors()`（`:16`，
//     直接返回 EP 的全部贡献）。
//   · 两条内建：`platform/execution/src/com/intellij/execution/executors/DefaultRunExecutor.java`
//     （`EXECUTOR_ID = ToolWindowId.RUN` = `"Run"`，`getToolWindowId()` 同值，`getContextActionId()`
//     = `RunClass`，`getHelpId()` = `ideaInterface.run`，`isSupportedOnTarget()` 恒真）
//     与 `platform/xdebugger-api/src/com/intellij/execution/executors/DefaultDebugExecutor.java`
//     （`EXECUTOR_ID = ToolWindowId.DEBUG` = `"Debug"`，`getContextActionId()` = `DebugClass`，
//     `getHelpId()` = `debugging.DebugWindow`，`isSupportedOnTarget()` 恒真）。
//   · 内建那两条的登记处（上游 plugin.xml）：
//     `platform/execution/resources/intellij.platform.execution.xml:48`
//     `<executor implementation="…DefaultRunExecutor" order="first" id="run"/>` 与
//     `platform/xdebugger-impl/resources/intellij.platform.debugger.impl.content.xml:36`
//     `<executor implementation="…DefaultDebugExecutor" order="first,after run" id="debug"/>`。
//
// **本仓的落地口径（如实差异）**：
//   ① 上游 `Executor` 是抽象类（图标 + NLS 资源束 + Swing）；本仓没有 Swing 也没有资源束，
//      可移植的是**方法面与选择语义**：id / 动作名 / 启动文案 / 说明 / 工具窗口 id / 上下文动作 id /
//      帮助 id / isApplicable / isSupportedOnTarget。`getIcon()` 一族不在本仓口径内（图标表在
//      `src/uiIcons.ts`，与执行器无关），**不假装有**。
//   ② 上游 `isApplicable(Project)` 收 `Project`；本仓没有 Project 对象，收 `ExecutorProject`
//      （工作区根 + 名字两个可读字段，可空），消费点 `src/runActions.ts` 传工作区。
//   ③ 上游 ToolWindowId 是 `Run` / `Debug` 两个字符串常量（`platform/platform-api/src/com/intellij/openapi/wm/ToolWindowId.java`），
//      本仓的工具窗口路由就是「打开运行面板 vs 切到调试视图」⇒ `getToolWindowId()` 是**真实消费点**
//      （`toolWindowForExecutor`）。
//   ④ 上游内建两条带 `order="first"` / `order="first,after run"`；本仓的内建在模块加载时登记
//      （序号最小 ⇒ 天然排在最前），**不写 order 属性** —— 这样第三方 `order="first"` 的贡献能真的排到
//      最前（上游多个 `first` 之间没有相对约束，只按加载顺序），并且第三方用同 id 登记会**覆盖**内建那条
//      （EP 宿主的 `registerExtension` 同 id 覆盖，等价上游 `replaceExtension`）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，不 import vue/DOM/bridge ⇒ `node --test` 直测。
//
// 判据：`tests/executor-registry.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `Executor.EXECUTOR_EXTENSION_NAME`，声明见 `intellij.platform.execution.xml:32`）。 */
export const EXECUTOR_EP = 'com.intellij.executor'

/** `ExecutorProject`：上游 `Project` 在本仓的可移植子集（消费点只读这两格）。 */
export interface ExecutorProject {
  /** 工作区根（可空 = 没有打开的项目）。 */
  root?: string | null
  /** 工作区名字（可空）。 */
  name?: string | null
  /** 当前活动的运行目标是不是**非本机**目标（消费 `isSupportedOnTarget()`；缺省 false）。 */
  onTarget?: boolean
}

/**
 * 一条执行器（上游 `Executor` 的方法面，名字逐字相同）。
 *
 * 身份的锚是 `id`（= 上游 `getId()`）；这里做成**数据字段**是为了让注册表按 id 建表，
 * 第三方照 IDEA 写法只实现 `getId()` 时由 `registerExecutor` 归一（见 `normalizeExecutor`）。
 */
export interface ExecutorContribution {
  /** `Executor.getId()`（本仓的锚；`DefaultRunExecutor.EXECUTOR_ID = "Run"` / `DefaultDebugExecutor.EXECUTOR_ID = "Debug"`）。 */
  id: string
  /**
   * `Executor.getId()` 的**上游写法**（与 `id` 同值）。归一的贡献（`normalizeExecutor`）一定带这一格，
   * 于是消费点可以照上游代码写 `executor.getId()`；手写贡献只给 `id` 也能挂。
   */
  getId?: () => string
  /** `Executor.getActionName()`（工具条按钮/工具窗口的显示名，如 `Run` / `Debug`）。 */
  getActionName: () => string
  /** `Executor.getStartActionText(configurationName?)`（菜单/提示里的启动文案；上游默认 = 文案 + ` '配置名'`）。 */
  getStartActionText: (configurationName?: string) => string
  /** `Executor.getDescription()`（状态栏/工具提示的说明）。 */
  getDescription?: () => string
  /** `Executor.getToolWindowId()`（内容进哪个工具窗口；`ToolWindowId.RUN` / `ToolWindowId.DEBUG`）。 */
  getToolWindowId?: () => string
  /** `Executor.getToolWindowTitle()`（默认 = `getActionName()`）。 */
  getToolWindowTitle?: () => string
  /** `Executor.getContextActionId()`（上下文动作 id，如 `RunClass` / `DebugClass`）。 */
  getContextActionId?: () => string
  /** `Executor.getHelpId()`。 */
  getHelpId?: () => string
  /** `Executor.isApplicable(project)`：返回 false 时这条动作对当前项目不显示。 */
  isApplicable?: (project: ExecutorProject) => boolean
  /** `Executor.isSupportedOnTarget()`：这条执行器能不能跑在（远程）运行目标上。 */
  isSupportedOnTarget?: () => boolean
}

/**
 * 照 IDEA 写法写出来的执行器（`getId()` 一族方法）。插件照 `Executor` 子类的形状写就能挂进来，
 * `registerExecutor` 会把它归一成 `ExecutorContribution`。
 */
export interface IdeaStyleExecutor {
  getId: () => string
  getActionName: () => string
  getStartActionText: (configurationName?: string) => string
  getDescription?: () => string
  getToolWindowId?: () => string
  getToolWindowTitle?: () => string
  getContextActionId?: () => string
  getHelpId?: () => string
  isApplicable?: (project: ExecutorProject) => boolean
  isSupportedOnTarget?: () => boolean
}

/**
 * 归一后的执行器：`ExecutorContribution` 加上**必定存在**的 `getId()`（上游写法的那一格）。
 * 注册表交回来的东西一律是这个形状 ⇒ 消费点可以照上游代码写 `executor.getId()`。
 */
export interface NormalizedExecutor extends ExecutorContribution {
  getId: () => string
}

/** 注册表接受的两种形状（本仓数据形状 / 上游方法形状）。 */
export type ExecutorLike = ExecutorContribution | IdeaStyleExecutor

/** 把两种形状归一成 `ExecutorContribution`（上游方法形状的 `getId()` 成为 `id`）。 */
export function normalizeExecutor(executor: ExecutorLike): NormalizedExecutor {
  const shaped = executor as IdeaStyleExecutor & Partial<ExecutorContribution>
  if (typeof shaped.getId !== 'function' && (typeof shaped.id !== 'string' || !shaped.id)) {
    throw new Error('执行器贡献必须有 id（`id` 字段或照上游实现 `getId()`）。')
  }
  if (typeof shaped.getActionName !== 'function') throw new Error('执行器贡献必须实现 getActionName()。')
  if (typeof shaped.getStartActionText !== 'function') throw new Error('执行器贡献必须实现 getStartActionText()。')
  const idValue = typeof shaped.id === 'string' && shaped.id ? shaped.id : shaped.getId()
  return {
    id: idValue,
    getId: () => idValue,
    getActionName: shaped.getActionName,
    getStartActionText: shaped.getStartActionText,
    getDescription: shaped.getDescription,
    getToolWindowId: shaped.getToolWindowId,
    getToolWindowTitle: shaped.getToolWindowTitle,
    getContextActionId: shaped.getContextActionId,
    getHelpId: shaped.getHelpId,
    isApplicable: shaped.isApplicable,
    isSupportedOnTarget: shaped.isSupportedOnTarget,
  }
}

/**
 * `Executor.shortenNameIfNeeded(name)` 的等价物（`Executor.java:101-103`）：
 * 上游读注册表键 `run.configuration.max.name.length`（默认 80）并按 `StringUtil.trimMiddle`
 * 做**中间省略**。本仓的默认值与「中间省略」语义照抄；省略号两侧的分半策略按本仓实现
 * （左多右少，`maxlength` 含省略号）—— 逐字符复刻 `trimMiddle` 没有可移植性收益。
 */
export function shortenNameIfNeeded(name: string, maxLength = 80): string {
  const text = String(name ?? '')
  if (text.length <= maxLength) return text
  const keep = Math.max(0, maxLength - 3)
  const left = Math.ceil(keep / 2)
  const right = keep - left
  return text.slice(0, left) + '...' + (right > 0 ? text.slice(text.length - right) : '')
}

/**
 * `Executor.getStartActionText(configurationName)` 的等价物（`Executor.java:82-85` 的默认实现）：
 * 没给配置名/给空串 ⇒ 就是 `getStartActionText()`；给了 ⇒ `getStartActionText(name)`。
 * 上游默认实现是「动作文案 + 短名」，本仓的内建两条直接给带名字的完整句子（与上游
 * `DefaultRunExecutor.getStartActionText(name)` 覆写后的效果同形：`Run 'Foo'`）。
 */
export function executorStartActionText(executor: ExecutorContribution | undefined, configurationName?: string): string {
  if (!executor) return ''
  const name = shortenNameIfNeeded((configurationName ?? '').trim())
  if (!name) return executor.getStartActionText()
  return executor.getStartActionText(name)
}

/** `Executor.getToolWindowTitle()`（默认 = `getActionName()`，见 `Executor.java:61`）。 */
export function executorToolWindowTitle(executor: ExecutorContribution): string {
  return executor.getToolWindowTitle?.() ?? executor.getActionName()
}

/** 本仓的工具窗口路由档（上游 `ToolWindowId.RUN` / `ToolWindowId.DEBUG` 两个常量）。 */
export const RUN_TOOL_WINDOW_ID = 'Run'
export const DEBUG_TOOL_WINDOW_ID = 'Debug'

/**
 * 这个执行器的内容该进哪个工具窗口（上游 `Executor.getToolWindowId()` 的消费点）。
 * 内建 `Run` ⇒ 运行面板；`Debug` ⇒ 调试视图；认不出的执行器按 `Run` 兜底
 * （与 `runSelectedConfig` 里调试那条硬编码路径在只内建时逐字一致）。
 */
export function toolWindowForExecutor(executor: ExecutorContribution | undefined): string {
  const id = executor?.getToolWindowId?.()
  return id && id.trim() ? id : RUN_TOOL_WINDOW_ID
}

/** 内建两条执行器的 id（逐字取自 `DefaultRunExecutor.EXECUTOR_ID` / `DefaultDebugExecutor.EXECUTOR_ID`）。 */
export const RUN_EXECUTOR_ID = 'Run'
export const DEBUG_EXECUTOR_ID = 'Debug'

/**
 * 运行 / 调试两条内建执行器（上游 `DefaultRunExecutor` / `DefaultDebugExecutor` 的可移植面）。
 *
 * 与上游逐条对位的格子：id、`getToolWindowId`、`getActionName`、`getStartActionText`、
 * `getContextActionId`、`getHelpId`、`isSupportedOnTarget`（上游两条都只对自己 id 为真 ⇒ 恒真）、
 * `isApplicable`（上游默认 true）。文案是上游资源束的直译（`ExecutionBundle` 的
 * `tool.window.name.run` / `default.runner.start.action.text` 与 `UIBundle` 的
 * `tool.window.name.debug` / `XDebuggerBundle` 的 `debugger.runner.start.action.text`）。
 */
export const BUILTIN_EXECUTORS: readonly NormalizedExecutor[] = [
  {
    id: RUN_EXECUTOR_ID,
    getId: () => RUN_EXECUTOR_ID,
    getActionName: () => 'Run',
    getStartActionText: (configurationName?: string) => (configurationName ? `Run '${configurationName}'` : 'Run'),
    getDescription: () => '运行当前配置',
    getToolWindowId: () => RUN_TOOL_WINDOW_ID,
    getToolWindowTitle: () => 'Run',
    getContextActionId: () => 'RunClass',
    getHelpId: () => 'ideaInterface.run',
    isApplicable: () => true,
    isSupportedOnTarget: () => true,
  },
  {
    id: DEBUG_EXECUTOR_ID,
    getId: () => DEBUG_EXECUTOR_ID,
    getActionName: () => 'Debug',
    getStartActionText: (configurationName?: string) => (configurationName ? `Debug '${configurationName}'` : 'Debug'),
    getDescription: () => '调试当前配置',
    getToolWindowId: () => DEBUG_TOOL_WINDOW_ID,
    getToolWindowTitle: () => 'Debug',
    getContextActionId: () => 'DebugClass',
    getHelpId: () => 'debugging.DebugWindow',
    isApplicable: () => true,
    isSupportedOnTarget: () => true,
  },
]

/** 执行器解析结果：拿到执行器，或拿到一句「为什么用不了」（上游是动作被隐藏，本仓要能说出来）。 */
export type ExecutorSelection =
  | { executor: NormalizedExecutor; executorId: string; reason: null }
  | { executor: null; executorId: string; reason: string }

/**
 * 执行器注册表（上游 `ExecutorRegistry` + `Executor.EXECUTOR_EXTENSION_NAME` 的可移植子集）。
 *
 * 与 `src/programRunners.ts` 的 `ProgramRunnerRegistry` 同一纪律：
 *   · `register` 写内部表**并**写 EP（于是第三方与内建走同一条消费路径）；
 *   · `unregister` / 句柄 `dispose()` 两处一起删（不会出现「注销了还被 find 翻出来」）；
 *   · `adoptFromExtensions()` 把插件直接挂 EP、没走本注册表的那些收编进来；
 *   · `find` / `getExecutorById` 先看 EP（插件同 id 覆盖内建），再看内部表。
 *
 * **内建两条不在内部表里**：它们在模块加载时作为 bundled 贡献挂进 EP（`registerBundledExecutors`），
 * 所以第三方把它们注销掉之后 `find()` 就真的看不见了（与上游 `unregisterExtension` 同口径）。
 */
export class ExecutorRegistry {
  private readonly items = new Map<string, NormalizedExecutor>()
  private readonly external?: () => ExecutorContribution[]

  // 显式字段 + 赋值，不写 TS 参数属性（`node --test` 直载 .ts 会 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX）。
  constructor(external?: () => ExecutorContribution[]) {
    this.external = external
  }

  /** 按 id 注册（同 id 覆盖，句柄 `dispose()` 与 `unregister()` 同语义）。 */
  register(executor: ExecutorLike, options: RegisterExtensionOptions = {}): ExtensionHandle {
    const item = normalizeExecutor(executor)
    this.items.set(item.id, item)
    const handle = EXTENSIONS.registerExtension<ExecutorContribution>(EXECUTOR_EP, item.id, item, options)
    return {
      id: handle.id,
      extensionPoint: EXECUTOR_EP,
      dispose: () => {
        const removedInternal = this.items.delete(item.id)
        const removedExtension = handle.dispose()
        return removedInternal || removedExtension
      },
    }
  }

  /** 注销（内部表 + EP 表）。返回是否真的删掉了。 */
  unregister(id: string): boolean {
    const removedInternal = this.items.delete(id)
    const removedExtension = EXTENSIONS.unregisterExtension(EXECUTOR_EP, id)
    return removedInternal || removedExtension
  }

  /**
   * 收编 EP 里未登记进内部表的贡献（插件直接挂 EP 的那些）。返回新增条数。
   *
   * 口径与 `src/programRunners.ts` 的 `ProgramRunnerRegistry.adoptFromExtensions` 同档：
   * 收编只看**内部表**（EP 里的项 `find()` 本来就取得到，拿 find 判重会把所有贡献都当成「已收编」）。
   * 副作用如实写在这里：收编之后要摘掉这条贡献，请走 `unregister()`/句柄 `dispose()`
   * —— 直接 `EXTENSIONS.unregisterExtension()` 只是摘掉 EP 那一份，内部表里的副本还在。
   */
  adoptFromExtensions(): number {
    let adopted = 0
    for (const raw of this.external?.() ?? []) {
      let item: NormalizedExecutor
      try { item = normalizeExecutor(raw) } catch { continue }
      // 只看**内部表**：EP 里的项 `find()` 本来就取得到，拿 find 判重会把所有贡献都当成"已收编"。
      if (this.items.has(item.id)) continue
      this.items.set(item.id, item)
      adopted += 1
    }
    return adopted
  }

  /** 按 id 取（上游 `ExecutorRegistry.getExecutorById`）。EP 里的贡献优先（插件可覆盖内建同 id）。 */
  getExecutorById(id: string): NormalizedExecutor | undefined {
    return this.find(id)
  }

  /** 同 `getExecutorById`（内部名与本仓其它注册表一致）。 */
  find(id: string): NormalizedExecutor | undefined {
    if (!id) return undefined
    for (const raw of this.external?.() ?? []) {
      if (!raw) continue
      let item: NormalizedExecutor
      try { item = normalizeExecutor(raw) } catch { continue }
      if (item.id === id) return item
    }
    return this.items.get(id)
  }

  /** 全部执行器（上游 `getRegisteredExecutors()`；EP 顺序 = LoadingOrder 排好的，内部表里的接在后面）。 */
  all(): NormalizedExecutor[] {
    const seen = new Set<string>()
    const out: NormalizedExecutor[] = []
    for (const raw of this.external?.() ?? []) {
      if (!raw) continue
      let item: NormalizedExecutor
      try { item = normalizeExecutor(raw) } catch { continue }
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    for (const item of this.items.values()) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    return out
  }

  /** 内部表里的项（不含只在 EP 表里的贡献；排查/断言用）。 */
  registered(): NormalizedExecutor[] {
    return [...this.items.values()]
  }

  /** 全部 id（上游 `getRegisteredExecutors().map(getId)` 的等价物）。 */
  ids(): string[] {
    return this.all().map(executor => executor.id)
  }

  /**
   * 解析一条执行器（上游的动作可见性判定 + `ExecutorRegistry.getExecutorById` 的组合）：
   *   ① 没注册 ⇒ 「执行器「X」没有注册」；
   *   ② `isApplicable(project)` 为假 ⇒ 上游是**隐藏动作**，本仓给出可见原因；
   *   ③ 活动目标不是本机、而 `isSupportedOnTarget()` 为假 ⇒ 「这条执行器不支持运行目标」。
   * 三条都过才返回执行器。
   */
  resolve(id: string, project: ExecutorProject = {}): ExecutorSelection {
    const executor = this.find(id)
    if (!executor) return { executor: null, executorId: id, reason: `执行器「${id}」没有注册，无法启动。` }
    try {
      if (executor.isApplicable && executor.isApplicable(project) === false) {
        return { executor: null, executorId: id, reason: `执行器「${executor.getActionName()}」不适用于当前项目。` }
      }
    } catch { /* 一个坏执行器不该把启动链打断：按上游默认档（true）继续 */ }
    try {
      if (project.onTarget === true && executor.isSupportedOnTarget && executor.isSupportedOnTarget() === false) {
        return { executor: null, executorId: id, reason: `执行器「${executor.getActionName()}」不支持在运行目标上执行。` }
      }
    } catch { /* 同上 */ }
    return { executor, executorId: id, reason: null }
  }
}

/** 进程内唯一的执行器注册表：EP 贡献（内建 Run/Debug 以 bundled 贡献登记）由 EP 提供。 */
export const executorRegistry = new ExecutorRegistry(
  () => EXTENSIONS.extensionsOf<ExecutorContribution>(EXECUTOR_EP),
)

/** 全部执行器（内建 + 第三方）。消费点见 `src/runActions.ts` 与 `src/runToolbar.ts`。 */
export function executors(): NormalizedExecutor[] {
  return executorRegistry.all()
}

/** 按 id 找执行器（上游 `ExecutorRegistry.getExecutorById`）。 */
export function executorById(id: string): NormalizedExecutor | undefined {
  return executorRegistry.getExecutorById(id)
}

/** 解析一条执行器（注册 + isApplicable + isSupportedOnTarget 三道门）。 */
export function resolveExecutor(id: string, project: ExecutorProject = {}): ExecutorSelection {
  return executorRegistry.resolve(id, project)
}

/** 注册一条执行器（内建用 `{ source: 'bundled' }`，插件默认 user）。 */
export function registerExecutor(executor: ExecutorLike, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return executorRegistry.register(executor, options)
}

/** 注册一条 bundled 执行器（内建两条的自登记入口，见文件头差异 ④）。 */
export function registerBundledExecutor(executor: ExecutorLike): ExtensionHandle {
  return registerExecutor(executor, { source: 'bundled' })
}

/** 声明 EP（幂等）—— 上游 `intellij.platform.execution.xml:32` 的那一条。 */
export function declareExecutorExtensionPoint(): void {
  EXTENSIONS.declareExtensionPoint({
    id: EXECUTOR_EP, name: '执行器', scope: APPLICATION_SCOPE, dynamic: true,
  })
}

// bundled 自登记：两条内建执行器（上游 `DefaultRunExecutor` / `DefaultDebugExecutor`，
// id 逐字 `Run`/`Debug`）。放在这里而不是消费侧，是因为它们的 id/文案就是上游常量、没有第二份真源可漂移。
declareExecutorExtensionPoint()
registerBundledExecutor(BUILTIN_EXECUTORS[0])
registerBundledExecutor(BUILTIN_EXECUTORS[1])
