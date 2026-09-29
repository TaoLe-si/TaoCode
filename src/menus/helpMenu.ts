// 帮助菜单（HelpMenu，PlatformActions.xml:746-775 的 TaoCode 对应物）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
//
// IDEA HelpMenu 的完整成员与 TaoCode 的落点（**逐条**）：
//   GotoAction                       → ✅ 查找操作（与 Edit / 主工具栏同一入口）
//   HelpTopics / OnlineDocAction     → 待办：TaoCode 没有官方文档站点（缺的能力：一份可打开的本地/在线帮助）
//   Help.JetBrainsTV                 → 待办：同名视频站不存在
//   Help.KeymapReference             → ✅ 内置帮助面板（含快捷键与框架说明）
//   LearnGroup                       → 待办：IDEA 的「学习」插件体系（缺的能力：交互式教程）
//   TechnicalSupport / ReportProblem → 待办：没有工单系统
//   SendFeedback                     → 待办：没有反馈渠道
//   ShowLog                          → ✅ 显示日志（宿主 `app.logPaths` + `file.reveal`）
//   CollectZippedLogs                → ✅ 收集日志并打包（宿主 `app.collectLogs`，最小 ZIP store）
//   HelpDiagnosticTools 子菜单：
//       BrowseSpecialPaths          → ✅ 浏览特殊目录…
//       CollectTroubleshootingInformation → ✅ 复制排障信息（宿主 `app.troubleshooting`）
//       Performance.ActivityMonitor  → 待办：需要采样器（IDEA 是插件式性能快照）
//       Performance.DumpThreads      → 待办：需要宿主线程栈 dump 通道（Win32 `StackWalk`/`MiniDump`）
//       Performance.MemTester        → 待办：IDEA 的内存压力测试工具
//       LogDebugConfigure            → 待办：需要 logging 配置文件与级别切换通道
//       ResetWindowsDefenderNotification → 待办：Windows Defender 通知是 JetBrains 特有的集成
//   About                            → ✅ 关于 TaoCode（宿主 `app.info`）
import type { MenuRow } from './types'

export interface HelpMenuContext {
  // 参数统一 any：参数逆变下 App 的窄签名函数才能赋进来（后续批次可收紧）。
  openActionSearch: any
  showKeymap: any
  showLog: any
  collectLogs: any
  collectBusy: any
  browseSpecialPaths: any
  copyTroubleshooting: any
  showAbout: any
  isDesktop: any
}

export function createHelpMenuRows(ctx: HelpMenuContext): MenuRow[] {
  return [
    // HelpMenu 的第一项就是 `GotoAction`（PlatformActions.xml:747）。
    { id: 'help.gotoAction', title: '查找操作', keys: 'Ctrl Shift A', keywords: 'find action search everywhere 查找操作', run: () => ctx.openActionSearch() },
    { id: 'help.rule1', rule: true },
    // `Help.KeymapReference` 指向 JetBrains 的键盘映射页；本仓的等价物是内置帮助面板。
    { id: 'help.keymapReference', title: '快捷键与键盘映射', keywords: 'keymap reference shortcuts 快捷键 键盘映射', run: () => ctx.showKeymap() },
    { id: 'help.rule2', rule: true },
    { id: 'help.showLog', title: '显示日志', keywords: 'show log idea.log 显示日志 排查', enabled: () => ctx.isDesktop, run: () => void ctx.showLog() },
    { id: 'help.collectLogs', title: '收集日志并打包…', keywords: 'collect zipped logs pack 收集日志 打包 zip', enabled: () => ctx.isDesktop && !ctx.collectBusy.value, run: () => void ctx.collectLogs() },
    { id: 'help.rule3', rule: true },
    // HelpMenu › HelpDiagnosticTools（PlatformActions.xml:760-771）—— 本仓能落地的两项先做。
    { id: 'help.diagnosticTools', title: '诊断工具', keywords: 'diagnostic tools special paths troubleshooting 诊断 特殊目录 排障', children: [
      { id: 'help.browseSpecialPaths', title: '浏览特殊目录…', keywords: 'browse special paths log config plugins 特殊目录 日志 配置 插件', enabled: () => ctx.isDesktop, run: () => void ctx.browseSpecialPaths() },
      { id: 'help.copyTroubleshooting', title: '复制排障信息', keywords: 'collect troubleshooting information copy 排障 信息 复制', enabled: () => ctx.isDesktop, run: () => void ctx.copyTroubleshooting() },
    ] },
    { id: 'help.rule4', rule: true },
    { id: 'help.about', title: '关于 TaoCode', keywords: 'about version 关于 版本', run: () => void ctx.showAbout() },
  ]
}
