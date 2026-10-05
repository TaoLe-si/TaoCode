// 归档条目清单的**取数面** —— 宿主 `file.archiveEntries`（`native/file_queries.cpp` 的
// `archive_entries`，实机跑 `bsdtar -tf <archive>`）给一份档案内路径清单，这里把它交给
// `src/rootsJarEntries.ts` 整成可渲染的行。
//
// 分工是死的：**这一侧只有"要清单 + 缓存 + 判通道在不在"**，排序、层级、目录判定、
// `jar://` url 全在 `rootsJarEntries.ts` 那一份规则里（宿主不重复算一遍，否则两处会漂）。
//
// 上游对应「归档当一个目录」那一族：
//   · `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9-12`
//     `JarFileSystem extends ArchiveFileSystem …`，`PROTOCOL` / `PROTOCOL_PREFIX` / `JAR_SEPARATOR`；
//     `JAR_SEPARATOR` 的真值在 `platform/util/src/com/intellij/util/io/URLUtil.java:39` = **`!/`**
//     （`:37` `JAR_PROTOCOL = "jar"`）—— 上一轮这里记成单个 `!`，已在 `rootsJarEntries.ts` 头里订正；
//   · `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:92`
//     `composeRootPath`（`"/x/y.jar" -> "/x/y.jar!/"`）＝本仓 `jarUrl()` 那条；
//   · `ArchiveFileSystem.java:86` `extractLocalPath` 是反函数 ＝ `parseJarUrl()`；
//   · `ArchiveFileSystem.java:99-100`（`copyFile`）与 `:114-115`（`deleteFile`）对归档**一律抛**
//     "jar.modification.not.supported.error" —— 所以这一面只有"看"，本模块也就只有读，
//     不给任何写入口，也不给"看起来能改"的控件。
//
// 为什么"拿不到"必须是 null 而不是 `[]`：上游没有 VFS 就没有这些行；本仓要是把
// 「宿主没接线 / 归档读不出」画成「这个 jar 是空的」，那就是拿空数据糊弄真数据。

import { request, type Method } from './bridge.ts'
import { jarRowsFromListing, type JarRow } from './rootsJarEntries.ts'

/** 宿主 `file.archiveEntries` 的答复（形状见 native/file_queries.hpp 的注释）。 */
export interface ArchiveListingReply {
  available: boolean
  archive?: string
  lines?: string[]
  truncated?: boolean
  /** 拿不到时的一句话，不猜。 */
  reason?: string
}

/**
 * `file.archiveEntries` 已登记进 `src/bridge.ts` 的 `Method` 联合（2026-10-06 主代理接线，
 * 请求见 docs/wiring-requests-2026-10-06-bucket15j.md）⇒ 调用点直接写字面量、不带 cast：
 * `tests/routing-parity.test.mjs` 的「原生实现了前端从不发送的方法名」那条门就是抓这种漂移的。
 */
/** 清单来源：默认走宿主，测试与别的宿主（内存桩）可以注入一份。 */
export type ArchiveLister = (archive: string) => Promise<ArchiveListingReply>

export const hostArchiveLister: ArchiveLister = archive =>
  request<ArchiveListingReply>('file.archiveEntries', { archive })

export interface JarListing {
  /** 已经排好序、带 depth 的行；空数组只可能是"归档里真没条目"。 */
  rows: JarRow[]
  /** 宿主按上限截断过（`kMaxArchiveEntries`）。 */
  truncated: boolean
}

/** 桥上那条通道在不在：`unknown` = 还没问过，`absent` = 问过且宿主不认这个方法。 */
export type JarChannelStatus = 'unknown' | 'live' | 'absent'

let channelStatus: JarChannelStatus = 'unknown'
const cache = new Map<string, JarListing | null>()
const CACHE_LIMIT = 64

export function jarChannelStatus(): JarChannelStatus {
  return channelStatus
}

/** 换项目 / 宿主升级后要重新探一次通道，并丢掉上一份档案清单（判据 `tests/ext-jar-entries-channel.test.mjs` 也用它隔离状态）。 */
export function resetJarListings(): void {
  channelStatus = 'unknown'
  cache.clear()
}

/**
 * 工作区根 + 项目内相对路径 → 宿主那条通道要的绝对路径。
 * `file.archiveEntries` 与 `shell.reveal` 用的是 `reveal_absolute` 那一档口径（绝对路径、
 * 不在 `Workspace` 的沙箱里），因为外部库的 jar 路径本来就是前端从 `workspace.files` 拼出来的。
 */
export function archiveAbsolutePath(root: string, relative: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const tail = relative.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!base) return tail
  if (!tail) return base
  return `${base}/${tail}`
}

/**
 * 一个归档的行清单。**拿不到就返回 null**（宿主没这条通道、归档不是归档、读不出），
 * 调用方据此整块不渲染。只有"通道在、这个归档也确实列出了零条"才会是 `rows: []`。
 */
export async function loadJarListing(archive: string, lister: ArchiveLister = hostArchiveLister): Promise<JarListing | null> {
  if (!archive) return null
  if (cache.has(archive)) return cache.get(archive) ?? null
  let reply: ArchiveListingReply
  try {
    reply = await lister(archive)
  } catch {
    // 桥直接抛 = 分派表里没有这个方法（宿主还没登记这条通道）。
    channelStatus = 'absent'
    return null
  }
  channelStatus = 'live'
  if (!reply || reply.available !== true || !Array.isArray(reply.lines)) return null
  const listing: JarListing = { rows: jarRowsFromListing(reply.lines, archive), truncated: reply.truncated === true }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(archive, listing)
  return listing
}
