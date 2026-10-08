// 配置备份（上游 `ConfigBackup`）—— `pf/lifecycle` 判词里那条「工程配置迁移与备份」的**可执行子集**。
//
// 上游事实（逐条核过，行号可复现）：
//   · `ConfigBackup.kt:24` —— `MAX_BACKUPS_NUMBER = 10`；`DATE_FORMAT = "yyyy-MM-dd-HH-mm"`（`:60`）；
//   · `ConfigBackup.kt:75` —— 备份目录 = `configDir.resolveSibling(configDir.name + "-backup")`
//     （配置目录的**兄弟**目录，不是子目录）；
//   · `getNextBackupPath`（`:63-75`）—— `backupDir/<日期>`；该目录已存在时退到
//     `backupDir/<日期>-<uuid>`（同一分钟内第二次备份**不覆盖**第一次）；
//   · `cleanupOldBackups`（`:46-58`）—— 子项按**名字**排序，`size >= MAX_BACKUPS_NUMBER` 时
//     删掉 `children[0 .. size-MAX]`（**闭区间** ⇒ 删的条数是 `size-MAX+1`）；
//   · 消费点：`DefaultSettingsHelper.kt:39-45` 恢复默认前先算 `getNextBackupPath()`（`:53`）并把
//     它写进确认正文（`ConfigurationStoreBundle.properties` 的
//     `restore.default.settings.confirmation.message` = "The current settings will be backed up to {0}"）。
//
// 本仓的落法（按本仓架构还原用户可见功能，差异逐条写清）：
//   · 上游备份的是**整个配置目录**（`NioFiles.copyRecursively` + `deleteRecursively`）。
//     本仓的配置就是**一个文件**（`projects.json`，见 `native/projects.cpp` 顶部注释），
//     而宿主已有的「把设置打包成一个 zip」通道正是 `app.exportSettings`
//     （`native/settings_transfer.cpp`，与「导出设置」同一个包格式）⇒ 一次备份 = 写一个 zip。
//     于是路径是 `<profile>-backup/<日期>.zip`（上游是目录，本仓是文件；语义等价：一档一个可还原的包）。
//   · 「这一档文件名被占了吗」需要一个**绝对路径存在性**通道，本仓没有（`file.readOnly` 一类
//     只吃工作区相对路径）。所以本仓**总是**带唯一后缀：宁可多一个后缀，也绝不覆盖已有备份
//     （上游在碰撞时才加 UUID；本仓把它提到常开，是"没有存在性通道"的如实映射）。
//   · 旧档清理需要**枚举并删除工作区之外的绝对路径**，本仓没有这条通道（`file.delete` 只吃
//     工作区相对路径，`native/` 由别的 lane 持有）⇒ 本仓用一份**本 IDE 自建的备份账**
//     （`localStorage`）来兑现"只保留最近 N 档"这条用户可见语义：账上超出的那些被遗忘并如实告知
//     「更早的备份仍在磁盘上，可用 帮助 › 显示特殊目录 自行清理」——不假装删了文件。
//
// 纯逻辑在这里（可单测），写盘走 `app.exportSettings`（`src/settingsTransfer.ts`）。

/** `ConfigBackup.kt:24`。 */
export const MAX_BACKUPS_NUMBER = 10
/** `ConfigBackup.kt:60` `DATE_FORMAT = "yyyy-MM-dd-HH-mm"`。 */
export const BACKUP_DATE_FORMAT = 'yyyy-MM-dd-HH-mm'
/** 本仓的状态文件名（`native/projects.cpp` 的 `state_file_`）。 */
export const STATE_FILE_NAME = 'projects.json'
/** `ConfigBackup.kt:75` 的后缀（`configDir.name + "-backup"`）。 */
export const BACKUP_DIR_SUFFIX = '-backup'
/** 本仓一档备份的扩展名（zip —— 与 `app.exportSettings` 的包格式一致）。 */
export const BACKUP_EXTENSION = '.zip'

/** `ConfigBackup.getBackupDir`（`:75`）：配置目录的**兄弟**目录（保留原分隔符风格）。 */
export function configBackupDir(profile: string): string {
  const trimmed = profile.replace(/[\\/]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const parent = separator < 0 ? '' : trimmed.slice(0, separator + 1)
  const name = separator < 0 ? trimmed : trimmed.slice(separator + 1)
  return `${parent}${name}${BACKUP_DIR_SUFFIX}`
}

/** 一档的日期戳（`DATE_FORMAT`；用**本地**时间，与上游 `LocalDateTime.now()` 同口径）。 */
export function backupDateStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `-${pad(now.getHours())}-${pad(now.getMinutes())}`
}

/** 唯一后缀：优先 `crypto.randomUUID()`，取不到退回"毫秒 + 随机"（绝不产生同名档）。 */
export function backupUniqueSuffix(): string {
  try {
    const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (cryptoLike?.randomUUID) return cryptoLike.randomUUID()
  } catch { /* 没有 crypto：走下面的退路 */ }
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 0x10000).toString(36)}`
}

/**
 * 这一档备份的绝对路径：`<备份目录>/<日期>-<唯一后缀>.zip`。
 * 为什么后缀常开：本仓没有"绝对路径存在性"通道（见模块头），常开后缀是唯一能保证不覆盖的写法。
 */
export function nextBackupPath(profile: string, now: Date = new Date(), unique = backupUniqueSuffix()): string {
  return `${configBackupDir(profile)}/${backupDateStamp(now)}-${unique}${BACKUP_EXTENSION}`
}

/**
 * `cleanupOldBackups`（`:46-58`）的规则部分：按名字排序后，从最老的开始该丢掉几条。
 * 上游那个 `0..size-MAX` 是**闭区间**，所以条数是 `size-MAX+1`（恰好让删完后 = MAX-1，
 * 紧接着新备份补回第 MAX 条）。
 */
export function backupsToDelete(names: readonly string[], max = MAX_BACKUPS_NUMBER): string[] {
  const sorted = [...names].sort()
  if (sorted.length < max) return []
  return sorted.slice(0, sorted.length - max + 1)
}

// ── 本 IDE 自建的备份账（`localStorage`）────────────────────────────────────────────

/** 账的键（按配置目录分；与 `src/vcsLogFilterStore.ts` 同一套"按根分键"口径）。 */
export function backupLedgerKey(profile: string): string {
  return `taocode.configBackups.${encodeURIComponent(profile)}`
}

export interface BackupLedgerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 浏览器里能拿到的存储；拿不到（隐私模式 / 无 `localStorage`）返回 null。 */
export function backupLedgerStorage(): BackupLedgerStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** 读账：坏存档/坏条目一律丢掉，返回的一定是字符串数组（永不抛）。 */
export function readBackupLedger(profile: string, storage: BackupLedgerStorage | null = backupLedgerStorage()): string[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(backupLedgerKey(profile)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  } catch { return [] }
}

/** 记一档（新的在最前）。 */
export function rememberBackup(profile: string, path: string, storage: BackupLedgerStorage | null = backupLedgerStorage()): string[] {
  const next = [path, ...readBackupLedger(profile, storage).filter(entry => entry !== path)]
  if (storage) { try { storage.setItem(backupLedgerKey(profile), JSON.stringify(next)) } catch { /* 存不下只影响下次的账。 */ } }
  return next
}

/**
 * 把账收到 `max` 档以内：**被丢掉的那些仍在磁盘上**（本仓删不了工作区外的文件），
 * 所以返回 `{kept, forgotten}` —— 调用方据 `forgotten` 如实告知用户，而不是假装删了。
 */
export function pruneBackupLedger(profile: string, entries: readonly string[], max = MAX_BACKUPS_NUMBER, storage: BackupLedgerStorage | null = backupLedgerStorage()): { kept: string[]; forgotten: string[] } {
  const forgotten = backupsToDelete(entries, max)
  const dropped = new Set(forgotten)
  const kept = entries.filter(entry => !dropped.has(entry))
  if (storage) { try { storage.setItem(backupLedgerKey(profile), JSON.stringify(kept)) } catch { /* 同上。 */ } }
  return { kept, forgotten }
}

/**
 * 恢复默认前的确认正文里那一段（`DefaultSettingsHelper.kt:39-45` +
 * `restore.default.settings.confirmation.message` = "The current settings will be backed up to {0}"）。
 * 中文按 key 直译（本地化包不在参考树里），英文原文留在上一行。
 */
export function backupNotice(backupPath: string | null): string {
  return backupPath ? `当前设置会被备份到 ${backupPath}` : '当前设置会被备份（拿不到配置目录，备份路径未知）'
}

/** 账上被遗忘但仍在磁盘上的那些档，给用户的如实提示（上游没有这一句：本仓删不掉，所以要说清）。 */
export function forgottenBackupsNotice(forgotten: readonly string[]): string | null {
  if (!forgotten.length) return null
  return `更早的 ${forgotten.length} 档备份仍在磁盘上（本仓不能删除工作区之外的路径），可在「帮助 › 显示特殊目录」里自行清理。`
}