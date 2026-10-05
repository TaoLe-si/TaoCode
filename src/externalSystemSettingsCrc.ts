// 设置文件的**内容 CRC** 判定（上游 `platform/external-system-impl/src/com/intellij/openapi/
// externalSystem/autoimport/AutoImportProjectSettingsFilesTracker.kt`）：
//   · `calculateSettingsFilesCRC(settingsFiles)`（`:56-66`）：对设置文件清单逐个算 CRC，
//     算不出（`crc == 0L`，文件不存在/二进制/目录）的直接丢掉，不进表；
//   · `SettingsFilesStatus(oldCRC, newCRC)`（`:264-285`）：
//       updated = 两表交集里 **CRC 不同**的（所以「保存了但内容没变」不算改动）；
//       created = 新表减旧表；deleted = 旧表减新表；
//   · 待比较的集合是「当前设置文件清单 ∪ 上次表里的键」
//     （`SettingsFilesAsyncSupplier.supply`：`consumer(it + settingsFilesStatus.get().oldCRC.keys)`，`:378-382`）；
//   · 事件顺序：updated → created → deleted（`adjustCrc` 的三段循环，`:112-146`）。
//
// CRC 本体取 `VirtualFile.calculateCrc()`（`util/CrcUtils.kt:34-38`：`java.util.zip.CRC32` over
// 文件字节）。上游还有一个按文件类型归一化文本再算的 `AbstractCrcCalculator`（`:22-27`，走 PSI 的
// `ParserDefinition`）—— 那条本仓没有对等物（无 PSI），所以这里按**原文**算，与「文件内容变了」这一
// 用户可见语义一致。
//
// 本仓的取数通道：没有 VFS/`Document`，由调用方把内容读出来（`file.read`）传进来；读不到的文件
// 等价于上游 `findFileByPath` 返回 null（`:60`），即不进新表 → 落进 `deleted`（与上游同一取舍）。

/** CRC-32（IEEE 802.3 / zlib，与 `java.util.zip.CRC32` 同多项式 0xEDB88320）。 */
const CRC32_POLYNOMIAL = 0xedb88320

let crcTable: Uint32Array | null = null

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; ++index) {
    let value = index
    for (let bit = 0; bit < 8; ++bit) value = value & 1 ? CRC32_POLYNOMIAL ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  crcTable = table
  return table
}

/** 文件内容的 CRC-32（`CrcUtils.kt:34-38` 的等价物；空内容算出来是 0，与上游的「跳过 0」同口径）。 */
export function settingsFileCrc(content: string): number {
  const table = crc32Table()
  let crc = 0xffffffff
  for (const byte of new TextEncoder().encode(content)) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type SettingsFileCrcMap = ReadonlyMap<string, number>

export interface SettingsFilesStatus {
  /** 同路径、内容 CRC 变了。 */
  readonly updated: readonly string[]
  /** 新出现的路径。 */
  readonly created: readonly string[]
  /** 消失的路径。 */
  readonly deleted: readonly string[]
  readonly hasChanges: boolean
}

/** `SettingsFilesStatus`（`:264-285`）：两张 CRC 表比出三类事件。 */
export function settingsFilesStatus(oldCrc: SettingsFileCrcMap, newCrc: SettingsFileCrcMap): SettingsFilesStatus {
  const updated: string[] = []
  const created: string[] = []
  const deleted: string[] = []
  for (const [path, crc] of newCrc) {
    if (!oldCrc.has(path)) created.push(path)
    else if (oldCrc.get(path) !== crc) updated.push(path)
  }
  for (const path of oldCrc.keys()) if (!newCrc.has(path)) deleted.push(path)
  return {
    updated: updated.sort(), created: created.sort(), deleted: deleted.sort(),
    hasChanges: updated.length + created.length + deleted.length > 0,
  }
}

export type SettingsFileEvent = 'CREATE' | 'UPDATE' | 'DELETE'

/** 事件表：updated → created → deleted（`adjustCrc` 的顺序，`:118-135`）。 */
export function settingsFileEvents(status: SettingsFilesStatus): Array<{ path: string; event: SettingsFileEvent }> {
  return [
    ...status.updated.map(path => ({ path, event: 'UPDATE' as const })),
    ...status.created.map(path => ({ path, event: 'CREATE' as const })),
    ...status.deleted.map(path => ({ path, event: 'DELETE' as const })),
  ]
}

/**
 * 读一张新的 CRC 表（`calculateSettingsFilesCRC`，`:56-66`）：逐个读内容，CRC 为 0 的不进表。
 * `read` 返回 null = 文件读不到（不存在/无权），与上游 `findFileByPath` 为 null 同一处理。
 */
export async function calculateSettingsFilesCrc(
  paths: readonly string[],
  read: (path: string) => Promise<string | null>,
): Promise<Map<string, number>> {
  const crc = new Map<string, number>()
  for (const path of paths) {
    const content = await read(path)
    if (content === null) continue
    const value = settingsFileCrc(content)
    if (value !== 0) crc.set(path, value)
  }
  return crc
}

/**
 * 待比较的路径集合（`SettingsFilesAsyncSupplier.supply`，`:378-382`）：
 * 当前设置文件清单 ∪ 上次表里的键 —— 后者让「被删掉的设置文件」也能被认出来。
 */
export function settingsFilesCrcPaths(settingsFiles: readonly string[], oldCrc: SettingsFileCrcMap): string[] {
  return [...new Set([...settingsFiles, ...oldCrc.keys()])]
}

/**
 * `adjustCrc`（`:112-146`）里「事件被 aware 判为忽略时把新 CRC 收下来」的那一半：
 * 被忽略的 updated/created 收下新 CRC，deleted 摘掉键。返回新的旧表。
 */
export function acceptIgnoredSettingsFiles(oldCrc: SettingsFileCrcMap, newCrc: SettingsFileCrcMap, status: SettingsFilesStatus): Map<string, number> {
  const next = new Map(oldCrc)
  for (const path of status.updated) if (newCrc.has(path)) next.set(path, newCrc.get(path)!)
  for (const path of status.created) if (newCrc.has(path)) next.set(path, newCrc.get(path)!)
  for (const path of status.deleted) next.delete(path)
  return next
}
