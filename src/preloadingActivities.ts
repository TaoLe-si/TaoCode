// 预加载活动 —— 上游 `PreloadingActivity`（platform/ide-core/src/com/intellij/openapi/application/
// PreloadingActivity.kt，已标注 deprecated → 建议迁 `ApplicationInitializedListener`）在本仓的对应物。
//
// 上游语义：应用初始化后、项目打开前跑一批「预热」活动（典型是提前读索引/探测环境，别让第一次
// 交互等）。活动之间互不依赖，单个失败不该拖垮启动。
//
// 本仓的接线：`src/workspaceLifecycle.ts` 的 `bootstrap` 在读完应用状态后 `void runPreloadingActivities(...)`
// （不阻塞加载；热路径在 `src/buildHost.ts` 的 `availableJdks`）。判据在 `tests/application-activation.test.mjs`。

export interface PreloadingActivity {
  id: string
  /** 预热；异步、可抛错。 */
  preload: () => void | Promise<void>
}

const registry = new Map<string, PreloadingActivity>()

export function registerPreloadingActivity(activity: PreloadingActivity): void {
  registry.set(activity.id, activity)
}

export function registeredPreloadingActivities(): PreloadingActivity[] {
  return [...registry.values()]
}

/** 测试用：清空注册表。 */
export function resetPreloadingActivities(): void {
  registry.clear()
}

/**
 * 顺序跑全部预加载活动；每个独立 try/catch（上游「预热失败只记日志」的口径），
 * 返回真正跑过的 id 与失败清单。
 */
export async function runPreloadingActivities(onError?: (activity: PreloadingActivity, error: unknown) => void):
    Promise<{ ran: string[]; failed: { id: string; error: unknown }[] }> {
  const result: { ran: string[]; failed: { id: string; error: unknown }[] } = { ran: [], failed: [] }
  for (const activity of registry.values()) {
    result.ran.push(activity.id)
    try {
      await activity.preload()
    } catch (error) {
      result.failed.push({ id: activity.id, error })
      onError?.(activity, error)
    }
  }
  return result
}
