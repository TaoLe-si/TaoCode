// 内部错误对话框的数据与文案 —— 上游 `IdeErrorsDialog` + `ErrorMessageClustering` 的等价物
// （`platform/platform-impl/src/com/intellij/diagnostic/`）。
//
// 上游形状（逐条对照）：
//   · `ErrorMessageClustering.clusterMessages()`（`ErrorMessageClustering.kt:29-37`）把
//     `MessagePool.getFatalErrors(true, true)` 按 `hashMessage` 分组；`hashMessage`
//     （`IdeErrorsDialog.kt:1049-1053`）= throwable 文本的 CRC32，**去重键是栈，不是消息**。
//     开关是 `ErrorMessageClusteringSettings.DEDUPLICATE_REPORTS`（`"ide.errors.deduplicate"`，默认开）。
//   · 面板是「一屏一个簇」：标题 `error.list.title`（`DiagnosticBundle.properties:9`，中文包「IDE 内部错误」）、
//     序号 `error.list.message.index.count`（`:11`，中文包 `{0}/{1}`）、
//     概况 `error.list.message.info`（`:19`，中文包 `{0}，发生 {1} 次`）、
//     底部按钮 `CommonBundle.close.action.name`（中文包「关闭」，`IdeErrorsDialog.kt:155`）。
//
// 本仓的对应：数据源是宿主 `native/diagnostics.cpp` 的 `internal_errors()`
// （`Json internal_errors()` 报 `{count, latest:[{time, message}]}`）。**与上游的差别（如实）**：
// 账本里只有一行消息，没有栈 —— 崩溃钩子把栈写进了 `taocode.log`（`native/crash_log.hpp:9-11`），
// 不进这张账。所以去重键退化成消息文本：两条**同消息不同栈**的错误在本仓会被并成一簇
// （上游不会）。没有栈可看、没有插件归因（`ErrorMessageCluster.pluginId` 要 `PluginUtil.findPluginId(throwable)`）、
// 也没有提交通道（`ErrorReportSubmitter`）。
import type { InternalError } from './internalErrors'

/** 上游 `DiagnosticBundle.properties:9`（中文包取值）。 */
export const ERRORS_DIALOG_TITLE = 'IDE 内部错误'
/** `CommonBundle.close.action.name`（中文包取值）—— `IdeErrorsDialog.kt:155` 的取消按钮。 */
export const ERRORS_DIALOG_CLOSE = '关闭'
/** `ErrorMessageClusteringSettings.DEDUPLICATE_REPORTS` 的注册键（上游 `Registry` 的键名）。 */
export const DEDUPLICATE_REPORTS_KEY = 'ide.errors.deduplicate'

/** 一个错误簇（上游 `ErrorMessageCluster` 的最小形状：同一去重键下的若干条消息）。 */
export interface ErrorCluster {
  /** 去重键（本仓 = 归一后的消息文本；上游 = 栈文本的 CRC32）。 */
  key: string
  /** 簇的代表消息（上游取 `messages.first()`，即最早那条的文本）。 */
  message: string
  messages: InternalError[]
}

/**
 * 归一：把随每次运行变化的部分抹掉，让"同一个错"在一张表里聚成一条。
 * 上游不需要这步（它按栈去重，栈是稳定的）；本仓只有一行消息，所以退而求其次。
 * 规则保守：只把连续的数字段折成 `#`、裁掉首尾空白，其余原样（避免把不同的错并成一条）。
 */
export function normalizeErrorMessage(message: string): string {
  return message.trim().replace(/\d+/g, '#')
}

/**
 * 聚类（`ErrorMessageClustering.clusterMessages`）：按归一消息分组，保留每簇的原始顺序。
 * `deduplicate === false` 时每条自成一簇（对应上游那个 registry 开关关掉的口径）。
 * 簇的顺序 = 最早一次出现的顺序（上游 `Map` 的插入序：`groupBy` 保序）。
 */
export function clusterInternalErrors(errors: readonly InternalError[], deduplicate = true): ErrorCluster[] {
  if (!deduplicate) {
    return errors.map((error, index) => ({ key: `${index}`, message: error.message, messages: [error] }))
  }
  const clusters = new Map<string, ErrorCluster>()
  for (const error of errors) {
    const key = normalizeErrorMessage(error.message)
    const existing = clusters.get(key)
    if (existing) existing.messages.push(error)
    else clusters.set(key, { key, message: error.message, messages: [error] })
  }
  return [...clusters.values()]
}

/** 序号（`error.list.message.index.count`；中文包 `{0}/{1}`）。从 1 起，与上游 `myIndex + 1` 一致。 */
export function clusterIndexLabel(index: number, total: number): string {
  return `${index + 1}/${total}`
}

/**
 * 概况（`error.list.message.info`；中文包 `{0}，发生 {1} 次`）。
 * 时间取簇里**最后一条**（上游 `cluster.messages[count - 1].date`，`IdeErrorsDialog.kt:545`）。
 */
export function clusterInfoLabel(cluster: ErrorCluster): string {
  const last = cluster.messages.at(-1)
  return `${last?.time ?? ''}，发生 ${cluster.messages.length} 次`
}

/** 整份账的纯文本（给「复制全部」用）：簇标题 + 每条消息的时间，一行一条。 */
export function errorClustersText(clusters: readonly ErrorCluster[]): string {
  const lines: string[] = []
  for (const cluster of clusters) {
    lines.push(`${cluster.message}（${cluster.messages.length} 次）`)
    for (const error of cluster.messages) lines.push(`  ${error.time} ${error.message}`)
  }
  return lines.join('\n')
}
