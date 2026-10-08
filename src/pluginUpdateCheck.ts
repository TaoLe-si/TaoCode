// 插件更新检查的**策略层** —— 上游 `StandalonePluginUpdateChecker.kt` 里与平台无关的那一半：
// 「什么时候该去查更新」「查出来有更新怎么提示」「失败怎么记」。真正的取数通道本仓没有
// （远程仓库要网络，见 `src/pluginMarket.ts` 文件头的三条理由），所以这里把上游的**判定与
// 缓存/退避策略**落成纯函数，取数由调用方注入 —— 本地仓库那一份实现就是现成的取数器。
//
// 上游依据（逐条核过本机上游树）：
//   · `platform/platform-impl/src/com/intellij/ide/plugins/StandalonePluginUpdateChecker.kt`
//     `:26-40` 的 `PluginUpdateStatus` 三态：`LatestVersionInstalled`（对象）/ `Update`（带
//     新版本描述符 + downloader）/ `CheckFailed`（带 message 与可选 detail），
//     `:43-47` 的 `fromException(message, e)` 把异常折成 `CheckFailed`（detail = 栈）。
//   · 同文件 `:60` `INITIAL_UPDATE_DELAY = 2000L`、`:61` `CACHED_REQUEST_DELAY = 1 天`
//     （`TimeUnit.DAYS.toMillis(1)`）；`:69-75` `pluginUsed()`：开关关着或 headless 就**不查**；
//     上次查过且距今不到一天也**不查**；`:84` `queueUpdateCheck` 每次 `updateDelay *= 2`
//     （指数退避）；`:152-156` `recordSuccessfulUpdateCheck` 把时间戳写回并把退避重置为初值。
//   · 同文件 `:174-196` `notifyPluginUpdateAvailable`：标题 = 插件名，正文 =
//     `plugin.updater.notification.message`（`IdeBundle.properties` = 「{0} update is available」，
//     zh 语言包不在社区树里 ⇒ 中文措辞是本仓自拟的，见下面的注释），带一个
//     `plugin.updater.install` 动作与 suggestionType。
//   · 同文件 `:218-228` `notifyNotInstalled`：没装成功时的两条文案
//     （`plugin.updater.not.installed` / `plugin.updater.not.installed.misc`，带「看日志」动作）。
//
// 纯逻辑（判定 / 文案 / 退避），不 import bridge，可单测（`tests/plugin-update-check.test.mjs`）。
// 取数与提示的宿主接线在 `src/components/PluginMarketPanel.vue`。
import { compareVersions } from './pluginMarket.ts'
import type { PluginInfo } from './pluginGroups.ts'

/** 更新检查的结果（`PluginUpdateStatus`，`:26-40` 三态的本仓形态）。 */
export type PluginUpdateStatus =
  | { kind: 'latest' }
  | { kind: 'update'; pluginId: string; name: string; currentVersion: string; newVersion: string }
  | { kind: 'failed'; message: string; detail?: string }

/** `:43-47` `fromException` 的等价物：异常 → `failed`（detail 保留原文，不吞）。 */
export function updateStatusFromError(message: string, error: unknown): PluginUpdateStatus {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return { kind: 'failed', message, detail }
}

/** `:60` `INITIAL_UPDATE_DELAY`（首次请求前的延迟，毫秒）。 */
export const INITIAL_UPDATE_DELAY = 2000
/** `:61` `CACHED_REQUEST_DELAY`（同一次成功检查的缓存期，一天）。 */
export const CACHED_REQUEST_DELAY = 24 * 60 * 60 * 1000

/**
 * `:69-75` `pluginUsed()` 的门控：要不要现在去查。
 *   · `checkNeeded === false`（`UpdateSettings.isPluginsCheckNeeded` 关着）⇒ 不查；
 *   · 上次查过且距今**不到一天** ⇒ 不查（`:72` 的 `lastUpdateTime == 0L || now - last > CACHED_REQUEST_DELAY`
 *     取反）；
 *   · 从没查过（0）⇒ 查。
 * 上游另有一条 headless 判据（`:71`），本仓没有 headless 档，调用方按「有没有桌面宿主」自行决定。
 */
export function shouldCheckForUpdates(lastCheckMs: number, nowMs: number, checkNeeded = true): boolean {
  if (!checkNeeded) return false
  if (!Number.isFinite(lastCheckMs) || lastCheckMs <= 0) return true
  return nowMs - lastCheckMs > CACHED_REQUEST_DELAY
}

/**
 * `:84` 的指数退避：每次排队把延迟翻倍。返回**下一次**的延迟
 * （上游是 `updateDelay *= 2` 之后不再改，成功时由 `:152-156` 重置回初值）。
 */
export function nextUpdateDelay(currentDelayMs: number): number {
  return currentDelayMs * 2
}

/** 把退避重置为初值（`:155` `updateDelay = INITIAL_UPDATE_DELAY`）。 */
export function resetUpdateDelay(): number {
  return INITIAL_UPDATE_DELAY
}

/**
 * 一条更新检查的结果 → 用户可见的那句话。上游把「有更新」与「检查失败」分成两条文案
 * （`:180-183` 与 `:78-81`）；本仓的措辞自拟（zh 语言包不在基准树里，如实记）。
 * `latest` 没有文案（上游同样什么都不发，`:83` 的 `else -> Unit`）。
 */
export function pluginUpdateMessage(status: PluginUpdateStatus): string {
  if (status.kind === 'latest') return ''
  if (status.kind === 'update')
    return `「${status.name}」有可用更新：v${status.currentVersion} → v${status.newVersion}。`
  return `检查「${status.message}」的更新失败，可在日志里看细节。`
}

/** 「安装更新」那个动作的文案（`IdeBundle.properties` 的 `plugin.updater.install`）。 */
export const PLUGIN_UPDATE_INSTALL_LABEL = '更新'

/** 没装成功时的文案（`:218-228` 两条）。`detail` 为 null 时用第一条。 */
export function pluginUpdateInstallFailure(detail?: string | null): string {
  return detail ? `插件更新未安装：${detail}` : '插件更新未安装。'
}

/**
 * 把一次检查的结果折成一条**通知中心的条目形状**（本仓 `src/notices.ts` 的 `NoticeEntry` 子集）。
 * 上游用 `notificationGroup.createNotification(...).addAction(...)`（`:174-196`），
 * 本仓通知的动作面是 `NoticeAction`，所以这里只给「标题/正文/一个动作」三格，由宿主决定挂到哪。
 * `latest` 返回 null（不发通知）。
 */
export interface PluginUpdateNotice {
  message: string
  /** 动作标签（`plugin.updater.install`）。 */
  actionLabel: string
  /** 要更新的那个插件 id（动作执行时用）。 */
  pluginId: string
}

export function pluginUpdateNotice(status: PluginUpdateStatus): PluginUpdateNotice | null {
  if (status.kind !== 'update') return null
  return { message: pluginUpdateMessage(status), actionLabel: PLUGIN_UPDATE_INSTALL_LABEL, pluginId: status.pluginId }
}

/**
 * 从「已装插件」与「仓库里该插件的可用版本」算出这个插件要报的状态。
 * 与 `src/pluginMarket.ts` 的 `marketplaceEntryStatus` 同一份版本比较口径
 * （`compareVersions`），不复制第二份规则 —— 差别只在返回形状：这里要的是**更新检查**
 * 的那三态（`latest`/`update`/`failed`），不是市场条目的四态。
 */
export function updateStatusFor(plugin: PluginInfo, availableVersion: string | undefined): PluginUpdateStatus {
  if (plugin.error) return { kind: 'failed', message: plugin.name || plugin.id, detail: plugin.error }
  const current = plugin.version || '0'
  if (!availableVersion || compareVersions(availableVersion, current) <= 0) return { kind: 'latest' }
  return { kind: 'update', pluginId: plugin.id, name: plugin.name || plugin.id, currentVersion: current, newVersion: availableVersion }
}

/**
 * 跑一轮更新检查（`pluginUsed()` + `updateCheck()` 的合成）：逐个已装插件问「有没有新版」。
 * `available` 是注入的取数器（本仓的实现：从本地仓库清单里按 id 找版本）。
 * 返回每个插件的状态；`failed` 的那几条要记日志（上游 `:78-81`）。
 * **成功（非 failed）时刷新时间戳**（`:152-156`）。
 */
export interface UpdateCheckDeps {
  available: (pluginId: string) => Promise<string | undefined>
  /** 上次成功检查的时间戳（毫秒）；0 = 从没查过。 */
  lastCheckMs: number
  nowMs: number
  checkNeeded?: boolean
  /** 覆盖单次检查失败的文案前缀（默认用插件名）。 */
  failMessage?: (plugin: PluginInfo) => string
}

export interface UpdateCheckResult {
  /** 这次到底查没查（门控没过就是 false，`statuses` 为空）。 */
  ran: boolean
  statuses: PluginUpdateStatus[]
  /** 下一次该用的时间戳（ran 且有成功项时 = nowMs，否则沿用传入值）。 */
  lastCheckMs: number
}

export async function runPluginUpdateCheck(plugins: readonly PluginInfo[], deps: UpdateCheckDeps): Promise<UpdateCheckResult> {
  if (!shouldCheckForUpdates(deps.lastCheckMs, deps.nowMs, deps.checkNeeded ?? true))
    return { ran: false, statuses: [], lastCheckMs: deps.lastCheckMs }
  const statuses: PluginUpdateStatus[] = []
  let anySuccess = false
  for (const plugin of plugins) {
    try {
      statuses.push(updateStatusFor(plugin, await deps.available(plugin.id)))
      anySuccess = true
    } catch (error) {
      statuses.push(updateStatusFromError(deps.failMessage?.(plugin) ?? (plugin.name || plugin.id), error))
    }
  }
  return { ran: true, statuses, lastCheckMs: anySuccess ? deps.nowMs : deps.lastCheckMs }
}