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
import { request, type ProcessMemory } from './bridge.ts'
import { copyToClipboard } from './clipboard.ts'
import { errorMessage } from './errors.ts'
import { collectTroubleshootingReport, describeScreens, type ProjectTroubleContext } from './troubleshootingCollectors.ts'
import type { PluginList } from './pluginGroups.ts'
import {
  installBundledGeneralTroubleInfoCollectors, installBundledProjectSpecialPathsProvider,
  installBundledSpecialPathsProvider, specialPathEntries, troubleshootingReportFromExtensions,
} from './diagnosticsExtensionPoints.ts'

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
  /**
   * 当前工作区（上游把 `Project` 直接传给每个 `GeneralTroubleInfoCollector.collectInfo(project)`；
   * 本仓没有容器，改由宿主注入）。没有打开工作区时返回 null —— 那时「Project」段整段省略。
   */
  projectContext?: () => ProjectTroubleContext | null
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

  /**
   * `BrowseSpecialPathsAction`：列出特殊目录，点一项就在文件管理器里打开。
   *
   * 上游这张表由 `SpecialPathsProvider` EP 收上来（应用级 + 项目级两条内置实现），本仓同样
   * 走 EP：宿主 `app.specialPaths` 的那一张与当前工作区根各登记成一条 bundled 贡献
   * （`src/diagnosticsExtensionPoints.ts` 的 `installBundledSpecialPathsProvider` /
   * `installBundledProjectSpecialPathsProvider`），第三方插件按同一 EP id 挂的提供者一并出现。
   * 第三方路径的前端无法做存在性判定（宿主只对自建的那几张算 `exists`），故它们按「存在」显示。
   */
  async function browseSpecialPaths() {
    if (!deps.isDesktop) { deps.notify('桌面端才能浏览特殊目录。', true); return }
    try {
      const native = await request<SpecialPath[]>('app.specialPaths')
      const byPath = new Map(native.map(entry => [entry.path.toLowerCase(), entry]))
      const root = deps.projectContext?.()?.root ?? null
      installBundledSpecialPathsProvider(() =>
        native.map(entry => ({ name: entry.label, path: entry.path, kind: 'folder' as const })))
      installBundledProjectSpecialPathsProvider(() => root)
      specialPaths.value = specialPathEntries(root).map(entry => {
        const known = byPath.get(entry.path.toLowerCase())
        return {
          id: known?.id ?? entry.path,
          label: entry.name,
          path: entry.path,
          exists: known ? known.exists : true,
        }
      })
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
      const host = await request<{ text: string }>('app.troubleshooting')
      // 上游是 `CompositeGeneralTroubleInfoCollector` 逐项收集（`TroubleInfoCollector` EP）；
      // 本仓宿主给进程侧固定字段，前端按 `src/troubleshootingCollectors.ts` 的五条通用收集器
      // （About/System/Plugins/Displays/Project）补一段 —— 每条数据抓不到就省略该段，不写空话。
      // `project` 那一段的数据源就是宿主注入的 `deps.projectContext`（上游把 `Project` 传给每个
      // 收集器；本仓没有容器）：没打开工作区时它返回 null，Project 段整段省略。
      const appInfo = await request<AppInfo>('app.info').catch(() => null)
      const memory = await request<ProcessMemory>('app.memory').catch(() => null)
      const plugins = deps.isDesktop ? await request<PluginList>('plugin.list').catch(() => null) : null
      const report = collectTroubleshootingReport(() => ({
        info: appInfo,
        memory: memory?.available ? memory : null,
        plugins: plugins?.plugins ?? null,
        screens: describeScreens(),
        cpuCount: navigator.hardwareConcurrency,
        project: deps.projectContext?.() ?? null,
      }))
      await copyToClipboard(report ? `${host.text}\n\n${report}` : host.text)
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
