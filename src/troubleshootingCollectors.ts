// 排障信息收集器 —— 上游 `com.intellij.troubleshooting` 一族在本仓的对应物：
//   · `GeneralTroubleInfoCollector`（`getTitle()` + `collectInfo()`）与
//     `CompositeGeneralTroubleInfoCollector.collectInfo` 的拼接格式：
//     `=== <Title> ===\n<info.trim()>\n\n`（platform-impl/.../ide/troubleshooting/CompositeGeneralTroubleInfoCollector.java:25-36）；
//   · 各收集器的内容口径照 ide/troubleshooting 下同名类：`SystemTroubleInfoCollector`
//     （CPU/内存）、`PluginTroubleInfoCollector`（Custom plugins / Disabled plugins）、
//     `DisplayTroubleInfoCollector`（`Display N: WxH; scale: P%, bounds: WxH @ (x; y)`）。
//
// 本仓的消费链：帮助菜单「复制排障信息」（`src/helpActions.ts` 的 `copyTroubleshooting`）
// 在宿主文本 `app.troubleshooting` 后面拼上这些收集器的一段段（宿主给的是进程侧固定字段，
// 这里补前端侧能看到的：版本/内存/插件/显示器/项目）。
//
// 没有做的（如实）：`GCTroubleInfoCollector`（`GCTroubleInfoCollector.kt:13-17` 走
// `ManagementFactory.getGarbageCollectorMXBeans()` —— JS 侧没有 GC MXBean，
// `performance.memory` 在 Chromium 已弃用且非标准，不能拿它冒充 GC 统计）与
// `DimensionServiceTroubleInfoCollector`（`DimensionServiceTroubleInfoCollector.kt:14-23` 依赖
// `DimensionService`/`WindowStateService` 的窗口几何持久化 —— 本仓的 WebView2 宿主窗口几何
// 没有前端可读的服务，前端也没有对话框尺寸持久化）。
// `TroubleInfoCollector` 的插件贡献点（`TroubleInfoCollector.java:15` 的 EP）没有宿主：收集器是内置五条。

import type { PluginInfo } from './pluginGroups.ts'
import type { ProcessMemory } from './bridge'

export interface GeneralTroubleInfoCollector {
  title: string
  collectInfo: () => string
}

/** `DisplayTroubleInfoCollector` 的一行所需字段（浏览器里只有一块屏）。 */
export interface ScreenDescription {
  width: number
  height: number
  scalePercent: number
}

/**
 * 项目上下文（上游 `ProjectTroubleInfoCollector.collectInfo(project)` 需要的那个 `project` 参数）。
 * 由调用方注入 —— 上游是容器把 `Project` 传给每个收集器，本仓没有容器，就由
 * `src/helpActions.ts` 从工作区状态里取（`HelpActionsDeps.projectContext`）。
 */
export interface ProjectTroubleContext {
  name: string
  root: string
  /** 受信任状态（`TrustedProjects.isProjectTrusted` 的等价物，见 src/trustedProjects.ts）。 */
  trusted: boolean
}

export interface TroubleshootingSnapshot {
  info?: { version: string; platform: string; arch: string; webview2: string; profile: string } | null
  memory?: Pick<ProcessMemory, 'workingSetMb' | 'peakWorkingSetMb' | 'privateMb'> | null
  plugins?: readonly PluginInfo[] | null
  screens?: readonly ScreenDescription[]
  cpuCount?: number
  project?: ProjectTroubleContext | null
}

/** 当前显示器（浏览器只有一块；node 判据里 `screen` 不存在时回空）。 */
export function describeScreens(): ScreenDescription[] {
  const screen = (globalThis as { screen?: { width: number; height: number } }).screen
  if (!screen) return []
  const devicePixelRatio = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1
  return [{ width: screen.width, height: screen.height, scalePercent: Math.round(devicePixelRatio * 100) }]
}

/** `CompositeGeneralTroubleInfoCollector` 的拼接：每个收集器一段，空段跳过。 */
export function compositeCollectInfo(collectors: readonly GeneralTroubleInfoCollector[]): string {
  let report = ''
  for (const collector of collectors) {
    const info = collector.collectInfo().trim()
    if (!info) continue
    report += `=== ${collector.title} ===\n${info}\n\n`
  }
  return report.trimEnd()
}

/** 本仓的五条通用收集器（About/System/Plugins/Displays/Project）。数据由调用方抓（可为 null → 该段省略）。 */
export function createGeneralTroubleInfoCollectors(get: () => TroubleshootingSnapshot): GeneralTroubleInfoCollector[] {
  return [
    {
      title: 'About',
      collectInfo: () => {
        const info = get().info
        if (!info) return ''
        return `Build version: TaoCode ${info.version}\n` +
          `Operating System: ${info.platform} (${info.arch})\n` +
          `WebView2: ${info.webview2 || 'unknown'}\n` +
          `Config directory: ${info.profile}\n`
      },
    },
    {
      title: 'System',
      collectInfo: () => {
        const snapshot = get()
        const memory = snapshot.memory
        if (!memory) return ''
        const cpu = snapshot.cpuCount ?? (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 0
        return `Number of CPU: ${cpu}\n` +
          `Working set: ${memory.workingSetMb}Mb\n` +
          `Peak working set: ${memory.peakWorkingSetMb}Mb\n` +
          `Private memory: ${memory.privateMb}Mb\n`
      },
    },
    {
      title: 'Plugins',
      collectInfo: () => {
        const plugins = get().plugins
        if (!plugins) return ''
        // 上游分「已启用的非内置插件」（Custom plugins）与「停用的插件」（Disabled plugins）；
        // 本仓插件目录里装的就是用户插件（没有 bundled 标记），所以启用即 Custom。
        const custom = plugins.filter(plugin => plugin.enabled)
          .map(plugin => plugin.version ? `${plugin.name} (${plugin.version})` : plugin.name)
        const disabled = plugins.filter(plugin => !plugin.enabled)
          .map(plugin => plugin.version ? `${plugin.name} (${plugin.version})` : plugin.name)
        return `Custom plugins: [${custom.join(', ')}]\nDisabled plugins:[${disabled.join(', ')}]\n`
      },
    },
    {
      title: 'Displays',
      collectInfo: () => {
        const screens = get().screens ?? []
        return screens.map((screen, index) =>
          `Display ${index}: ${screen.width}x${screen.height}; scale: ${screen.scalePercent}%, ` +
          `bounds: ${screen.width}x${screen.height} @ (0; 0)`).join('\n')
      },
    },
    {
      // 上游 `ProjectTroubleInfoCollector.java:11-18`：标题 "Project"，
      // 内容 `Project trusted: ` + `TrustedProjects.isProjectTrusted(project)`。
      // 本仓多给两行定位信息（名字与根目录），排障时人看得懂是哪份工作区；没打开工作区就整段省略。
      title: 'Project',
      collectInfo: () => {
        const project = get().project
        if (!project) return ''
        return `Project: ${project.name || project.root}\n` +
          `Project root: ${project.root}\n` +
          `Project trusted: ${project.trusted}`
      },
    },
  ]
}

/** 一段完整的排障文本（默认收集器 + 复合拼接）。没有可用数据时回空串。 */
export function collectTroubleshootingReport(get: () => TroubleshootingSnapshot): string {
  return compositeCollectInfo(createGeneralTroubleInfoCollectors(get))
}
