// **提交期的插件面** —— 上游 `vcs/commit` 三条 EP 在本仓的等价物与消费点接线。
//
// 上游是什么（逐字开过 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `com.intellij.checkinHandlerFactory` —— `platform/vcs-api/resources/intellij.platform.vcs.xml:24-26`
//     （`interface="com.intellij.openapi.vcs.checkin.CheckinHandlerFactory"` dynamic="true"），
//     `CheckinHandlerFactory.java:17` 的 `EP_NAME`、`:27` 的
//     `createHandler(CheckinProjectPanel, CommitContext)`。工厂产出的 `CheckinHandler`
//     （`CheckinHandler.java`）方法面：`ReturnResult` 三档（`:38-41` 的 `COMMIT`/`CANCEL`/`CLOSE_WINDOW`）、
//     `beforeCheckin()`（`:90-92`，缺省 `COMMIT`）、`checkinSuccessful()`（`:101`）、
//     `checkinFailed(List<VcsException>)`（`:114`）。调用点：提交前
//     `AbstractCommitWorkflow.kt:559` 逐个问 `beforeCheckin(...)`，提交结果
//     `CheckinHandlersNotifier.kt:15`/`:24`（`onSuccess` → `checkinSuccessful()`；`onCancel`/`onFailure`
//     → `checkinFailed(commitErrors)`）。
//   · `com.intellij.vcsCheckinHandlerFactory` —— 同 xml `:27-29`（`VcsCheckinHandlerFactory`，
//     只对特定 VCS 生效的工厂；本仓一种 VCS（git），故两张表同构，按 EP 分开登记）。
//   · `com.intellij.vcs.changes.localCommitExecutor` —— `CommitExecutor.java:23-24` 的
//     `LOCAL_COMMIT_EXECUTOR`（`ProjectExtensionPointName`）。方法面 `:28` 的 `getActionText()`、
//     `:35-37` 的 `useDefaultAction()`、`:43` 的 `getId()`、`:50` 的 `areChangesRequired()`、
//     `:60` 的 `supportsPartialCommit()`、`:70` 的 `requiresSyncCommitChecks()`；执行面
//     `CommitSession.java:41` 的 `execute(Collection<? extends Change>, String)` ——
//     上游把"提交"这一步留给执行器（本地提交是缺省执行器，第三方可加"提交到 X"）。
//
// 本仓此前：提交前后没有任何插件口（判词 `CheckinHandlersNotifier` 行写"缺 checkin handler 的
// 提交前后回调（没有插件）"、`CommitExecutor` 行写"缺执行器抽象"）。本文件补上那一层：
// 三条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明；贡献形状是上游
// 接口的**可移植子集**（本仓没有 `Project`/`Change`/`CommitContext`，换成 `CheckinProjectPanelLike`
// 与 `CommitContextLike`：工作区根 + 信息 + 这次包含的路径 + amend + 空判结论）；
// 内建的两支作为 bundled 贡献登记 —— ① 空判/空信息那道闸（`src/commitCheck.ts` 的
// `commitBlockMessage`）② 缺省本地提交执行器（`taocode.localCommit`），于是 EP 里看得见的就是
// 真实在跑的那两条；**消费点**在 `src/sourceControlCommitChecks.ts` 的 `passedCommitCheck()`
// （提交路径上的真实闸，第三方 handler 能真的挡下提交并给出自己的说明文字）。
//
// 与上游的如实差异：① `beforeCheckin(executor, consumer)` 的第二个参数（跨插件传数据的
// `PairConsumer`）本仓没有消费者，收成 `executorId`；② `CheckinProjectPanel` 的 Swing 面板
// 面（`getComponent()`/`getCommitMessage()` 的编辑框）在本仓是 `CheckinPanelLike` 的只读字段；
// ③ `CommitExecutor.execute(project, session)` 收成 `execute(input)` 返回结果（本仓没有 `Change`
// 对象，给路径表）；④ `checkinSuccessful`/`checkinFailed` 的**派发口**在本文件，
// 面板那一步接线见 `docs/wiring-requests-2026-10-06-b1b7verdict.md` 的 W-1（`reportCommitResult`
// 两行旁边各加一行，`src/components/SourceControl.vue` 是保留文件）。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与 `src/commitCheck.ts`（都是纯模块），
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/checkin-handlers.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import { commitBlockMessage, type CommitBlockReason } from './commitCheck.ts'

/** 三条 EP 的 id（逐字取自上游 xml / `EP_NAME`，见文件头）。 */
export const CHECKIN_HANDLER_FACTORY_EP = 'com.intellij.checkinHandlerFactory'
export const VCS_CHECKIN_HANDLER_FACTORY_EP = 'com.intellij.vcsCheckinHandlerFactory'
export const LOCAL_COMMIT_EXECUTOR_EP = 'com.intellij.vcs.changes.localCommitExecutor'

/** 内建的两条 bundled 贡献的 id（缺省提交执行器与空判闸）。 */
export const BUILTIN_EMPTY_COMMIT_HANDLER_ID = 'taocode.checkinHandler.emptyCommit'
export const BUILTIN_LOCAL_COMMIT_EXECUTOR_ID = 'taocode.localCommit'

/** `CheckinHandler.ReturnResult` 三档（`CheckinHandler.java:38-41`，逐字同名）。 */
export type CheckinReturnResult = 'COMMIT' | 'CANCEL' | 'CLOSE_WINDOW'

/**
 * 一次提交的只读上下文（上游 `CheckinProjectPanel` + `CommitContext` 的可移植子集）。
 * `blockReason` 是内建那道空判闸的结论（`null` = 这次提交有内容、信息也非空），
 * bundled 的 handler 直接读它 —— 于是内建行为与第三方行为走同一条闸。
 */
export interface CheckinPanelLike {
  /** 上游 `CheckinProjectPanel.getProject()`（本仓没有 `Project`，给工作区根）。 */
  root: string
  /** 上游 `getCommitMessage()`。 */
  message: string
  /** 这次包含的变更路径（上游 `getIncludedChanges()` 的路径投影）。 */
  paths: readonly string[]
  /** amend 那一档（上游 `CommitContext.isAmendCommit()`）。 */
  amend: boolean
  /** 内建空判闸的结论（`src/commitCheck.ts` 的 `commitBlockReason`）；`null` = 通过。 */
  blockReason: CommitBlockReason | null
}

/** 一条 checkin handler（上游 `CheckinHandler` 的可移植子集，方法名逐字相同）。 */
export interface CheckinHandler {
  /** 贡献 id（本仓给 `CheckinHandler` 加的，便于判据与日志定位是哪条 handler 挡的）。 */
  id: string
  /** 上游 `beforeCheckin(executor, additionalDataConsumer)` —— `COMMIT` = 放行；
   * `CANCEL`/`CLOSE_WINDOW` 挡下这次提交（本仓给 `executorId`，没有 `PairConsumer`）。 */
  beforeCheckin?: (executorId: string | null) => CheckinReturnResult | null
  /** 上游 `checkinSuccessful()`。 */
  checkinSuccessful?: () => void
  /** 上游 `checkinFailed(List<VcsException>)`（本仓给消息表）。 */
  checkinFailed?: (errors: readonly string[]) => void
  /** 上游 `CheckinHandler.showConfirmation()`：挡下之前先问用户一句（缺省不问）。 */
  showConfirmation?: () => boolean
  /** 挡下时给用户看的说明（本仓给的面；上游把说明放在 Swing 对话框里）。 */
  cancelMessage?: () => string
}

/** 一条 checkin handler 工厂（上游 `CheckinHandlerFactory.createHandler(panel, context)`）。 */
export interface CheckinHandlerFactory {
  id: string
  /** 上游 `createHandler(CheckinProjectPanel, CommitContext)`；返回 null 表示这次不参与。 */
  createHandler: (panel: CheckinPanelLike) => CheckinHandler | null
}

/** `beforeCheckin` 的聚合结果（上游 `AbstractCommitWorkflow.kt:559` 的逐个问法）。 */
export interface BeforeCheckinOutcome {
  result: CheckinReturnResult
  /** 挡下这次提交的那条 handler 的 id（`COMMIT` = null）。 */
  handlerId: string | null
  /** 给用户看的说明（内建闸给 `commitBlockMessage`，第三方给 `cancelMessage`）。 */
  message: string | null
}

/**
 * 一条本地提交执行器（上游 `CommitExecutor` 的方法面，名字逐字相同）。
 * 上游 `execute(project, session)` 是抽象的提交动作；本仓给 `execute(input)`。
 */
export interface LocalCommitExecutor {
  id: string
  /** 上游 `getActionText()` —— 提交按钮/动作那一行文字。 */
  getActionText: () => string
  /** 上游 `useDefaultAction()`。 */
  useDefaultAction?: () => boolean
  /** 上游 `getId()`（本仓的 id 字段就是它，缺省取 id）。 */
  getId?: () => string | null
  /** 上游 `areChangesRequired()`。 */
  areChangesRequired?: () => boolean
  /** 上游 `supportsPartialCommit()`。 */
  supportsPartialCommit?: () => boolean
  /** 上游 `requiresSyncCommitChecks()`。 */
  requiresSyncCommitChecks?: () => boolean
  /**
   * 上游 `CommitExecutor.execute(project, CommitSession)`：把这次提交交出去。
   * 本仓给 `CommitExecutionInput`（根 + 信息 + 路径 + amend + 执行器 id），返回结果或抛错。
   */
  execute: (input: CommitExecutionInput) => Promise<CommitExecutionResult> | CommitExecutionResult
}

/** 一次执行的入参（上游 `CommitSession` 的可移植子集：`CommitSession.java:41`）。 */
export interface CommitExecutionInput {
  root: string
  message: string
  paths: readonly string[]
  amend: boolean
}

/** 一次执行的结果（上游 `Committer.execute` 的成败两档；本仓给消息表）。 */
export interface CommitExecutionResult {
  ok: boolean
  /** 上游 `committer.commitErrors`（`CheckinHandlersNotifier.kt:23` 读它）。 */
  errors?: readonly string[]
}

declareBundledExtensionPoints()

/** 三条 EP 的声明（模块加载即声明，第三方按同一 id 挂贡献）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: CHECKIN_HANDLER_FACTORY_EP, name: '提交前/后处理器工厂', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: VCS_CHECKIN_HANDLER_FACTORY_EP, name: 'VCS 提交前/后处理器工厂', scope: APPLICATION_SCOPE, dynamic: true })
  EXTENSIONS.declareExtensionPoint({ id: LOCAL_COMMIT_EXECUTOR_EP, name: '本地提交执行器', scope: APPLICATION_SCOPE, dynamic: true })
  registerBundledContributions()
}

function register<T extends { id: string }>(ep: string, value: T, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(ep, value.id, value, { scope: APPLICATION_SCOPE, source: 'bundled', ...options })
}

/**
 * 内建的两条 bundled 贡献 —— 与上游把自家 handler/executor 也挂 EP（`VcsExtensions.xml:228-229`
 * 的 `MultipleChangeListsCheckFactory`/`UnresolvedMergeCheckFactory`）同一口径：
 *   ① 空判/空信息闸：读 `panel.blockReason`，命中就 `CANCEL` 并给 `commitBlockMessage` 的文案；
 *   ② 缺省本地提交执行器：`taocode.localCommit`，就是面板那条 `git.commit` 路径。
 */
export function registerBundledContributions(): void {
  register(CHECKIN_HANDLER_FACTORY_EP, {
    id: BUILTIN_EMPTY_COMMIT_HANDLER_ID,
    createHandler: (panel: CheckinPanelLike): CheckinHandler => ({
      id: BUILTIN_EMPTY_COMMIT_HANDLER_ID,
      // 上游 `checkCommit()` 的空判不是"检查"，是前置闸（`NonModalCommitWorkflowHandler.kt:177-184`）。
      beforeCheckin: () => (panel.blockReason === null ? 'COMMIT' : 'CANCEL'),
      cancelMessage: () => (panel.blockReason === null ? '' : commitBlockMessage(panel.blockReason)),
    }),
  })
  register(LOCAL_COMMIT_EXECUTOR_EP, {
    id: BUILTIN_LOCAL_COMMIT_EXECUTOR_ID,
    getActionText: () => '提交',
    useDefaultAction: () => true,
    getId: () => BUILTIN_LOCAL_COMMIT_EXECUTOR_ID,
    areChangesRequired: () => true,
    supportsPartialCommit: () => true,
    requiresSyncCommitChecks: () => false,
    // 缺省执行器由面板那条提交路径承担（`git.commit`），这里不重复实现执行体。
    execute: (input: CommitExecutionInput) => ({ ok: false, errors: [`缺省本地提交执行器由面板承担（${input.paths.length} 个路径）`] }),
  }, { priority: -1 })
}

/** 全部 checkin handler 工厂（上游 `CheckinHandlerFactory.EP_NAME.extensionList` 的等价物）。 */
export function checkinHandlerFactories(scope: string = APPLICATION_SCOPE): CheckinHandlerFactory[] {
  return EXTENSIONS.extensionsOf<CheckinHandlerFactory>(CHECKIN_HANDLER_FACTORY_EP, scope)
}

/** 全部 VCS checkin handler 工厂（只对特定 VCS 生效的那张表，本仓与上一张同构）。 */
export function vcsCheckinHandlerFactories(scope: string = APPLICATION_SCOPE): CheckinHandlerFactory[] {
  return EXTENSIONS.extensionsOf<CheckinHandlerFactory>(VCS_CHECKIN_HANDLER_FACTORY_EP, scope)
}

/**
 * 按这次提交造出 handler 表（上游 `AbstractCommitWorkflow.kt` 的 `initCommitHandlers()`：
 * 两张工厂表都问一遍，返回 null 的丢掉）。
 */
export function createCheckinHandlers(panel: CheckinPanelLike, scope: string = APPLICATION_SCOPE): CheckinHandler[] {
  const out: CheckinHandler[] = []
  for (const factory of [...checkinHandlerFactories(scope), ...vcsCheckinHandlerFactories(scope)]) {
    const handler = factory.createHandler(panel)
    if (handler) out.push(handler)
  }
  return out
}

/**
 * 提交前逐个问（上游 `AbstractCommitWorkflow.kt:559` 的循环）：**第一条不返回 `COMMIT` 的
 * 就挡下**，把它的 id 与说明带回去；全放行才 `COMMIT`。`showConfirmation()` 为 false 的那条
 * 跳过（上游 `CheckinHandler.showConfirmation` 的语义：让 handler 自己说"这次别问我"）。
 */
export function runBeforeCheckin(handlers: readonly CheckinHandler[], executorId: string | null = null): BeforeCheckinOutcome {
  for (const handler of handlers) {
    if (handler.beforeCheckin === undefined) continue
    if (handler.showConfirmation?.() === false) continue
    const result = handler.beforeCheckin(executorId) ?? 'COMMIT'
    if (result !== 'COMMIT') {
      return { result, handlerId: handler.id, message: handler.cancelMessage?.() ?? null }
    }
  }
  return { result: 'COMMIT', handlerId: null, message: null }
}

/** 提交成功之后逐个通知（`CheckinHandlersNotifier.kt:15` 的 `onSuccess`）。 */
export function runCheckinSuccessful(handlers: readonly CheckinHandler[]): void {
  for (const handler of handlers) handler.checkinSuccessful?.()
}

/** 提交取消/失败之后逐个通知（同文件 `:19-24`：`onCancel` 与 `onFailure` 同一条路）。 */
export function runCheckinFailed(handlers: readonly CheckinHandler[], errors: readonly string[]): void {
  for (const handler of handlers) handler.checkinFailed?.(errors)
}

/** 全部本地提交执行器（上游 `CommitExecutor.LOCAL_COMMIT_EXECUTOR` 的 list 面）。 */
export function commitExecutors(scope: string = APPLICATION_SCOPE): LocalCommitExecutor[] {
  return EXTENSIONS.extensionsOf<LocalCommitExecutor>(LOCAL_COMMIT_EXECUTOR_EP, scope)
}

/** 缺省那条（内建的 `taocode.localCommit`；`useDefaultAction()` 为真的第一条）。 */
export function defaultCommitExecutor(scope: string = APPLICATION_SCOPE): LocalCommitExecutor | null {
  return commitExecutors(scope).find(executor => executor.useDefaultAction?.() === true) ?? null
}

/**
 * 第三方挂进来的执行器（bundled 的缺省那条不算）—— 面板/菜单要给它们各出一行，
 * 这一条决定渲染面有没有内容；`getId()` 缺省取 `id`（上游 `CommitExecutor.getId()` 缺省 null）。
 */
export function userCommitExecutors(scope: string = APPLICATION_SCOPE): LocalCommitExecutor[] {
  return commitExecutors(scope)
    .filter(executor => !executor.id.startsWith('taocode.'))
    .map(executor => ({ ...executor, getId: executor.getId ?? (() => executor.id) }))
}

/**
 * 把一次提交交给某条执行器（上游 `CommitExecutor.execute(project, session)` 的落点）。
 * 找不到执行器 ⇒ 明确报错，不静默回落（回落会让"提交到 X"变成一次本地提交）。
 */
export async function executeCommit(
  executorId: string,
  input: CommitExecutionInput,
  scope: string = APPLICATION_SCOPE,
): Promise<CommitExecutionResult> {
  const executor = commitExecutors(scope).find(candidate => candidate.id === executorId)
  if (!executor) return { ok: false, errors: [`找不到提交执行器：${executorId}`] }
  return await executor.execute(input)
}
