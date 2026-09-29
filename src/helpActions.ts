// 「帮助」菜单的动作 —— IDEA HelpMenu 里能落地的那些（其余在模块尾注与 docs 里登记为待办）。
//
// 逐条对照的源码（`D:\Backup\Downloads\intellij-community-master\intellij-community-master`）：
//   · 菜单结构 `platform/platform-impl/resources/idea/PlatformActions.xml:746-775`
//     （GotoAction · HelpTopics · LearnGroup · OnlineDoc/JetBrainsTV/KeymapReference ·
//      TechnicalSupport/ReportProblem/SendFeedback · ShowLog · CollectZippedLogs ·
//      HelpDiagnosticTools 子菜单 · About）
//   · 「显示日志」`ide/actions/ShowLogAction.java:33-40` `showLog()`：能定位文件就 openFile，
//     否则退回 openDirectory（`RevealFileAction`）—— 本仓对应 `file.reveal`
//   · 「浏览特殊目录」`diagnostic/specialPaths/BrowseSpecialPathsAction.kt` + `ApplicationSpecialPathsProvider.kt`
//   · 「关于」`ide/actions/AboutAction.java`
//   · 「收集日志」`ide/actions/CollectZippedLogsAction.kt:42-110`：先弹敏感信息确认（可"不再询问"），
//     再打包日志并在文件管理器里显示
//
// 本仓的宿主通道：`app.info` / `app.logPaths` / `app.specialPaths` / `app.collectLogs`（native/diagnostics.cpp）。
import { ref } from 'vue'
import { request } from './bridge'
import { copyToClipboard } from './clipboard'
import { errorMessage } from './errors'

export interface AppInfo { version: string; platform: string; arch: string; webview2: string; profile: string }
export interface LogPaths { dir: string; file: string; exists: boolean; size: number }
export interface SpecialPath { id: string; label: string; path: string; exists: boolean }

export interface HelpActionsDeps {
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  /** 「快捷键与键盘映射」：打开既有的帮助对话框（IDEA 的 `Help.KeymapReference` 在本仓的落点）。 */
  helpPanel: { value: boolean }
  /** HelpMenu 的第一项就是 `GotoAction`（查找操作），与 Edit/主工具栏入口同一条。 */
  openActionSearch: () => void
}

export function createHelpActions(deps: HelpActionsDeps) {
  const aboutOpen = ref(false)
  const aboutInfo = ref<AppInfo | null>(null)
  const specialPathsOpen = ref(false)
  const specialPaths = ref<SpecialPath[]>([])
  const collectBusy = ref(false)

  /** `ShowLogAction.showLog()`：文件的定位优先，取不到就打开日志目录。 */
  async function showLog() {
    if (!deps.isDesktop) { deps.notify('桌面端才能打开日志。', true); return }
    try {
      const paths = await request<LogPaths>('app.logPaths')
      // 日志文件在启动时就已经写过一行（`diagnostics::init`），所以正常情况下它一定存在；
      // 万一被清掉，就退回打开目录（源码的 `openDirectory(PathManager.getLogDir())`）。
      await request('file.reveal', { path: paths.exists ? paths.file : paths.dir })
    } catch (error) { deps.notify(errorMessage(error), true) }
  }

  /** `AboutAction`：版本 / 平台 / WebView2 版本 / 配置目录。 */
  async function showAbout() {
    try {
      aboutInfo.value = await request<AppInfo>('app.info')
      aboutOpen.value = true
    } catch (error) { deps.notify(errorMessage(error), true) }
  }

  /** `BrowseSpecialPathsAction`：列出特殊目录，点一项就在文件管理器里打开。 */
  async function browseSpecialPaths() {
    if (!deps.isDesktop) { deps.notify('桌面端才能浏览特殊目录。', true); return }
    try {
      specialPaths.value = await request<SpecialPath[]>('app.specialPaths')
      specialPathsOpen.value = true
    } catch (error) { deps.notify(errorMessage(error), true) }
  }

  async function openSpecialPath(path: string) {
    specialPathsOpen.value = false
    try { await request('file.reveal', { path }) } catch (error) { deps.notify(errorMessage(error), true) }
  }

  /** `CollectZippedLogsAction.perform`：确认（敏感信息提示）→ 打包 → 显示。 */
  async function collectLogs() {
    if (!deps.isDesktop) { deps.notify('桌面端才能收集日志。', true); return }
    if (collectBusy.value) return
    // 源码里这段确认可以"不再询问"，本仓没有 PropertiesComponent 那套，因此每次都问（更保守）。
    if (!window.confirm('日志可能包含源码片段、文件路径等信息。确认打包并在文件管理器中显示吗？')) return
    collectBusy.value = true
    try {
      const result = await request<{ path: string; files: number }>('app.collectLogs')
      deps.notify(`已打包 ${result.files} 个日志文件。`)
      await request('file.reveal', { path: result.path })
    } catch (error) { deps.notify(errorMessage(error), true) }
    finally { collectBusy.value = false }
  }

  /** `CollectTroubleshootingInformationAction`：把排障文本复制到剪贴板（用户可直接粘进工单/聊天）。 */
  async function copyTroubleshooting() {
    try {
      const info = await request<{ text: string }>('app.troubleshooting')
      await copyToClipboard(info.text)
      deps.notify('排障信息已复制到剪贴板。')
    } catch (error) { deps.notify(errorMessage(error), true) }
  }

  /** `Help.KeymapReference`：本仓没有在线键盘映射页，落点是内置的帮助面板（含快捷键说明）。 */
  function showKeymap() { deps.helpPanel.value = true }

  return {
    aboutOpen, aboutInfo, specialPathsOpen, specialPaths, collectBusy,
    showLog, showAbout, browseSpecialPaths, openSpecialPath, collectLogs, copyTroubleshooting, showKeymap,
  }
}
