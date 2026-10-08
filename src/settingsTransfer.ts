// 设置的导出 / 导入 / 恢复默认（IDEA 文件菜单 `ExportImportGroup` 的对应物）—— 前端一侧。
//
// 逐条对照 `platform/platform-impl/resources/idea/PlatformActions.xml:419-424`：
// ```
// <group id="ExportImportGroup" popup="true">
//   <reference ref="ImportSettings"/>
//   <reference ref="ExportSettings"/>
//   <separator/>
//   <reference ref="RestoreDefaultSettings"/>
// </group>
// ```
// 三个动作的实现分别在 `platform/configuration-store-impl/src/`：
//   · `ExportSettingsAction.kt:54-100` —— 先 `ApplicationManager.getApplication().saveSettings()`，
//     再用保存对话框拿路径，把"可导出组件"打成**一个归档**写进去（`:57-61`）。
//   · `ImportSettingsAction.kt:47-...` —— 用文件选择器拿一个 zip/目录（`:58-70` 会校验
//     `ConfigImportHelper.isConfigDirectory`），导入后提示**重启 IDE**。
//   · `RestoreDefaultSettingsAction` —— 把设置恢复出厂值。
//
// TaoCode 的差异（都是"单进程、设置本来就是一个 JSON 文件"带来的映射，不是省事）：
//   · 归档是**一个 zip + 一份 JSON**（native/settings_transfer.cpp），不是 IDEA 那样每个组件一个文件 ——
//     本仓的应用状态本来就只有一个文件（见 projects.cpp 顶部的注释）。
//   · 导入**不需要重启**：设置是在内存里读写的，导入后直接刷新界面状态即可。
//   · 校验在**写盘之前**做（native `read_archive` 复用 settings_schema 的补丁校验器），
//     所以"坏归档"不会把好配置弄坏 —— 这一点比 IDEA "先落盘、重启时才发现" 更强。
//
// 纯逻辑（文件名 / 文案 / 结果摘要）在这一层，请求与状态刷新在 `createSettingsTransfer` 里。
import { request, type AppState } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { backupNotice, forgottenBackupsNotice, nextBackupPath, pruneBackupLedger, readBackupLedger, rememberBackup } from './configBackup.ts'

/** 文件对话框的过滤器串（native `parse_file_filters` 的格式：`名称|通配符|名称|通配符`）。 */
export const SETTINGS_ARCHIVE_FILTERS = '设置归档 (*.zip)|*.zip|所有文件|*.*'

/** 归档扩展名（IDEA 的 `ExportSettingsAction` 也建议 `*.zip`）。 */
export const SETTINGS_ARCHIVE_EXTENSION = '.zip'

/** 建议的文件名：带日期，用户一眼能分出哪个包是新的。 */
export function settingsArchiveName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  return `taocode-settings-${stamp}.zip`
}

/** 导出成功后的提示（含路径与字节数 —— "到底写了什么、写到哪"要能看见）。 */
export function exportResultMessage(result: { path?: string; bytes?: number; components?: string[] }): string {
  const size = typeof result.bytes === 'number' ? `（${Math.max(1, Math.round(result.bytes / 1024))} KB）` : ''
  const parts = (result.components ?? []).map(sectionLabel)
  const what = parts.length ? `包含${parts.join('、')}` : '已导出设置'
  return `已导出设置${size}到 ${result.path ?? ''}：${what}。`
}

/** 段名 → 人话（native 给的是 JSON 键名）。 */
export function sectionLabel(section: string): string {
  switch (section) {
    // native `empty_document()` 的键名就是 `general`；`preferences.general` 是设置树里的页键，
    // 老版本的摘要可能用过它，一并认下（两处都映到「系统设置」，免得导出提示里露出生键名）。
    case 'general':
    case 'preferences.general': return '系统设置'
    case 'settings': return '编辑器设置'
    case 'perProject': return '每个项目的设置'
    default: return section
  }
}

/**
 * 归档路径的**前置校验**：本仓的导入/导出都只认 zip（`native/settings_transfer.cpp` 写的就是
 * 它），选错文件在这里就报清楚，不必等原生返回一句"这不是一个可读的设置归档"。
 */
export function archivePathProblem(path: string): string | null {
  const target = path.trim()
  if (!target) return '请选择设置归档。'
  return target.toLowerCase().endsWith(SETTINGS_ARCHIVE_EXTENSION)
    ? null
    : `设置归档应当是 ${SETTINGS_ARCHIVE_EXTENSION} 文件。`
}

/** 用户在保存对话框里把 `.zip` 删掉时补回来（对话框的过滤器带扩展名，手打的名字不一定）。 */
export function ensureArchiveExtension(path: string): string {
  return path.toLowerCase().endsWith(SETTINGS_ARCHIVE_EXTENSION) ? path : path + SETTINGS_ARCHIVE_EXTENSION
}

/**
 * 读回来的归档摘要的形状校验（`app.readSettingsArchive` 的返回）—— 在确认框**之前**跑，
 * 形状不对的摘要不进确认、更不进写盘。原生已经保证了归档内容本身合法（坏包在那里就抛错），
 * 这里防的是"桥接层返回了缺字段/字段类型不对的东西"时用户看到一句假的"将覆盖：设置"。
 */
export function validateTransferSummary(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return '归档摘要格式不对。'
  const value = summary as Partial<SettingsTransferSummary>
  if (typeof value.path !== 'string' || !value.path.trim()) return '摘要里没有归档路径。'
  if (!Array.isArray(value.components) || value.components.length === 0)
    return '归档里没有任何可导入的设置段（可能是别的工具写的 zip）。'
  if (value.components.some(section => typeof section !== 'string' || !section.trim()))
    return '摘要里的设置段名不合法。'
  if (typeof value.projects !== 'number' || !Number.isInteger(value.projects) || value.projects < 0)
    return '摘要里的项目数不合法。'
  if (typeof value.exportedAt !== 'string') return '摘要里的导出时间不合法。'
  return null
}

/** 导入前的确认文案：先说清"会覆盖什么、不会覆盖什么"（最近项目不动，与源码一致）。 */
export function importConfirmMessage(summary: { path: string; components: string[]; projects: number; exportedAt: string }): string {
  const what = summary.components.length ? summary.components.map(sectionLabel).join('、') : '设置'
  const when = summary.exportedAt ? `（导出于 ${summary.exportedAt}）` : ''
  const projects = summary.projects > 0 ? `，其中 ${summary.projects} 个项目的设置` : ''
  return `导入 ${summary.path}${when}？\n\n将覆盖：${what}${projects}。\n不会动：最近项目列表。\n\n当前设置会被替换，此操作不可撤销。`
}

/** 导入完成后的提示。 */
export function importResultMessage(summary: { components: string[]; projects: number }): string {
  const what = summary.components.length ? summary.components.map(sectionLabel).join('、') : '设置'
  return `已导入${what}${summary.projects > 0 ? `（含 ${summary.projects} 个项目的设置）` : ''}；界面已按新设置刷新。`
}

/** 恢复默认前的确认文案（上游 `DefaultSettingsHelper.kt:39-45`：正文里带**备份路径**）。 */
export function restoreConfirmMessage(backupPath: string | null = null): string {
  return `恢复默认设置？\n\n编辑器设置与系统设置会回到出厂值，每个项目的设置会被清空。\n最近项目列表不受影响。此操作不可撤销。\n${backupNotice(backupPath)}`
}

/** 恢复默认完成后的提示。 */
export function restoreResultMessage(): string {
  return '已恢复默认设置。'
}

export interface SettingsTransferSummary {
  path: string
  components: string[]
  projects: number
  exportedAt: string
}

export interface SettingsTransferDeps {
  isDesktop: boolean
  notify: (message: string, error?: boolean) => void
  /** 原生写完状态文件后，宿主把 `app.state` 重新读进界面的那一趟（骨架提供）。 */
  refreshAppState: () => Promise<unknown>
  /** 当前项目的设置要跟着刷新（导入可能换了它），没有打开项目时为空操作。 */
  refreshProjectSettings: () => Promise<unknown>
  /** 确认框（默认 `window.confirm`；测试可以换掉它）。 */
  confirm?: (message: string) => boolean
  /**
   * IDE 自己的配置目录（`app.info` 的 `profile`，`native/diagnostics.cpp` 的 `app_info`）。
   * 恢复默认前要拿它算备份路径（上游 `DefaultSettingsHelper.getNextBackupPath()` 读
   * `PathManager.getOriginalConfigDir()` —— 那是进程级全局，本仓的等价物就是 `app.info`）。
   * **不传**时本模块自己问一次 `app.info`（宿主装配层是冻结文件，这条不许它多传一个实参）；
   * 给 `null` 表示明确不备份（浏览器预览），给字符串则直接用。
   */
  profileDir?: string | null
}

/**
 * 三个动作。返回的对象直接接进文件菜单的 ctx。
 *
 * 注意"取消"的语义：文件对话框取消（null）与用户确认框取消都不发请求、不提示错误 —— 取消不是失败。
 */
export function createSettingsTransfer(deps: SettingsTransferDeps) {
  const confirm = deps.confirm ?? ((message: string) => window.confirm(message))
  // 两个文件对话框由本模块自己发（它们只是两条桥接请求；取消时原生返回 null）。
  const pickSettingsFile = () => request<string | null>('dialog.pickFile', { title: '导入设置', filters: SETTINGS_ARCHIVE_FILTERS })
  const saveSettingsFile = () => request<string | null>('dialog.saveFile', { title: '导出设置', filters: SETTINGS_ARCHIVE_FILTERS, name: settingsArchiveName() })
  /**
   * 配置目录（`app.info` 的 `profile`）。问不到就返回 null ⇒ 恢复默认时跳过备份。
   * 为什么不把这一问放装配层：`src/App.vue` 是冻结文件（只许减行），而 `app.info` 是
   * 本模块自己就能发的两条请求之一 —— 与上面两个文件对话框同一口径。
   */
  const profileFromHost = async (): Promise<string | null> => {
    try {
      const info = await request<{ profile?: string }>('app.info')
      return typeof info?.profile === 'string' && info.profile ? info.profile : null
    } catch { return null }
  }

  async function exportSettings(): Promise<void> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能导出设置，请在桌面端使用。', true); return }
    const path = await saveSettingsFile()
    if (!path) return
    try {
      // 补扩展名后再交给原生（用户手打掉 `.zip` 时归档仍能被下次导入认出）。
      const result = await request<{ path: string; bytes: number; components: string[] }>('app.exportSettings', { path: ensureArchiveExtension(path) })
      deps.notify(exportResultMessage(result))
    } catch (error) { deps.notify(`导出设置失败：${errorMessage(error)}`, true) }
  }

  async function importSettings(): Promise<void> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能导入设置，请在桌面端使用。', true); return }
    const path = await pickSettingsFile()
    if (!path) return
    // 只认 zip：选错文件在这里就说清，别让原生的"不是归档"当第一句提示。
    const pathProblem = archivePathProblem(path)
    if (pathProblem) { deps.notify(pathProblem, true); return }
    // 先让原生把包读出来校验（**不写盘**），拿到摘要再问用户 —— 免得确认完才发现包是坏的。
    let summary: SettingsTransferSummary
    try {
      summary = await request<SettingsTransferSummary>('app.readSettingsArchive', { path })
    } catch (error) { deps.notify(`无法读取这个设置归档：${errorMessage(error)}`, true); return }
    // 摘要形状不对同样停在确认框之前（`validateTransferSummary` 只认字段形状，内容校验在原生）。
    const summaryProblem = validateTransferSummary(summary)
    if (summaryProblem) { deps.notify(`这个设置归档读不出内容：${summaryProblem}`, true); return }
    if (!confirm(importConfirmMessage(summary))) return
    try {
      await request('app.importSettings', { path })
      await deps.refreshAppState()
      await deps.refreshProjectSettings()
      deps.notify(importResultMessage(summary))
    } catch (error) { deps.notify(`导入设置失败：${errorMessage(error)}`, true) }
  }

  /**
   * 恢复默认（上游 `RestoreDefaultSettingsAction` → `DefaultSettingsHelper.restoreDefaultSettings`）。
   * 上游在复位**之前**把当前配置备份到 `ConfigBackup.getNextBackupPath()`（`:39-45`），
   * 本仓同一处：先算路径 → 让用户看到"备份到哪" → 备份 → 复位。
   *
   * 备份本身走**已有的导出通道**（`app.exportSettings`，`native/settings_transfer.cpp`）——
   * 与「导出设置」同一个包格式，所以那一档随时能用「导入设置」还原回来。
   * 备份失败**不阻止**复位（上游 `DefaultSettingsHelper` 也没把备份当闸门），但会如实报出来。
   */
  async function restoreDefaultSettings(): Promise<void> {
    if (!deps.isDesktop) { deps.notify('浏览器预览不能恢复默认设置，请在桌面端使用。', true); return }
    // 备份路径：上游 `getNextBackupPath` 只做整形（本仓的 `nextBackupPath` 带常开唯一后缀，
    // 理由见 `src/configBackup.ts` 的模块头 —— 没有"绝对路径存在性"通道）。
    const profile = deps.profileDir === undefined ? await profileFromHost() : deps.profileDir
    const backupPath = profile ? nextBackupPath(profile) : null
    if (!confirm(restoreConfirmMessage(backupPath))) return
    if (profile && backupPath) {
      try {
        await request('app.exportSettings', { path: backupPath })
        rememberBackup(profile, backupPath)
        // 「只保留最近 N 档」（上游 `cleanupOldBackups`）：本仓删不了工作区外的文件，
        // 所以只收账并如实告知被遗忘的那些仍在磁盘上。
        const { forgotten } = pruneBackupLedger(profile, readBackupLedger(profile))
        const notice = forgottenBackupsNotice(forgotten)
        if (notice) deps.notify(notice)
      } catch (error) {
        deps.notify(`恢复默认前没能备份当前设置（${errorMessage(error)}），继续恢复默认。`, true)
      }
    }
    try {
      await request<AppState>('app.resetSettings')
      await deps.refreshAppState()
      await deps.refreshProjectSettings()
      deps.notify(restoreResultMessage())
    } catch (error) { deps.notify(`恢复默认设置失败：${errorMessage(error)}`, true) }
  }

  return { exportSettings, importSettings, restoreDefaultSettings }
}
