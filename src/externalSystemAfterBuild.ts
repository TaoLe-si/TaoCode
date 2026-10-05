// 外部系统任务的**构建后**阶段执行（上游
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/manage/`）：
//   · `ExternalSystemTaskActivator.Phase`（`ExternalSystemTaskActivator.java:375-398`）的
//     `AFTER_COMPILE` / `AFTER_REBUILD` 两档；
//   · `doExecuteBuildPhaseTriggers(myBefore, context)`（`:92-129`）：before 走 BEFORE_REBUILD +
//     BEFORE_COMPILE，after 走 **AFTER_REBUILD + AFTER_COMPILE**（重建的那档先跑）；
//   · 触发点是 `ProjectTaskManagerListener.afterRun`（`ExternalProjectTaskManagerListener.kt:14-15`）
//     → `ExternalProjectsManagerImpl.projectTasksAfterRun`（`:310-318`）；
//   · **只在构建成功时跑**：`ProjectTaskManagerImpl.ResultConsumer.accept` 的
//     `if (!result.isAborted() && !result.hasErrors())`（`platform/lang-impl/.../ProjectTaskManagerImpl.java:450`）；
//   · 串行、首个失败就停：`runTasksQueue`（`ExternalSystemTaskActivator.java:223-254`）用 `TaskCallback`
//     的 onSuccess 递归下一条、onFailure 直接结束；失败文案 `dialog.message.after.build.triggering.task.failed`
//     = "After build triggering task failed"（`platform/external-system-api/resources/messages/
//     ExternalSystemBundle.properties:192`）。
//
// 本仓的等价物：构建走 `run.start` 拿一个运行实例，**实例退出就是 afterRun 钩子**（宿主唯一能观察到的
// 「构建结束」）。`src/runActions.ts` 的 `startBuild` 在启动成功后调本模块：退出码 0 才跑激活任务，
// 逐条串行、非零即停并提示。命令与命名由 `src/runActions.ts` 的 `activatedSteps` 算好传进来
// （与 before 三档共用同一张激活表）。
//
// 本模块不碰桥也不碰 vue：等退出与启动进程都由调用方注入（`awaitBuildExit` / `runStep`），
// 这样「成功才跑 / 串行 / 首个失败即停」这三条口径是可单测的纯逻辑。

/** 一条激活任务的执行步骤（`ExternalSystemTaskExecutionSettings` 折成的命令行 + 运行配置名）。 */
export interface ActivatedTaskStep {
  name: string
  command: string
}

/** 重建对应 AFTER_REBUILD、编译对应 AFTER_COMPILE（`doExecuteBuildPhaseTriggers` 的 after 分支）。 */
export function afterBuildPhase(rebuild: boolean): 'afterCompile' | 'afterRebuild' {
  return rebuild ? 'afterRebuild' : 'afterCompile'
}

export interface AfterBuildRunDeps {
  /** 跑一条激活任务（`run.start`）；返回空/false 或抛错都当失败。 */
  runStep: (step: ActivatedTaskStep) => Promise<unknown>
  notify: (message: string, error?: boolean) => void
}

export type AfterBuildOutcome = 'skipped' | 'ok' | 'failed'

/**
 * 构建结束后跑激活的 AFTER_COMPILE / AFTER_REBUILD 任务。
 * `awaitBuildExit` 由调用方给（宿主运行实例的退出码）。
 * 返回 `skipped` = 没有激活任务**或**构建没成功（上游 `!isAborted() && !hasErrors()` 的另一半）。
 */
export async function runActivatedAfterBuild(
  awaitBuildExit: Promise<number>,
  steps: readonly ActivatedTaskStep[],
  deps: AfterBuildRunDeps,
): Promise<AfterBuildOutcome> {
  if (!steps.length) return 'skipped'
  const buildExit = await awaitBuildExit
  if (buildExit !== 0) return 'skipped'
  for (const step of steps) {
    try {
      if (!await deps.runStep(step)) {
        deps.notify(`构建后的触发任务失败：${step.name}`, true)
        return 'failed'
      }
    } catch {
      deps.notify(`构建后的触发任务失败：${step.name}`, true)
      return 'failed'
    }
  }
  return 'ok'
}
