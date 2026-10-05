// 状态栏 Smart Mode 指示器的文案规则 —— App.vue 的 `smartModeLabel` computed 主体
// （原 670-685 行）2026-10-06 逐字搬入本文件。
//
// 为什么能搬：它是五个布尔输入到一段文案的纯映射，不读 ref、不碰 DOM、不发宿主请求；
// 「活动文件配没配语言服务 / 跑起来没有」这些取值仍由装配根算好后传进来。
// IDEA's SmartModeIndicatorWidgetFactory shows a "dumb/scanning" icon while indexing
// has not finished and hides itself in smart mode. TaoCode's equivalent state is
// "the active file has a live language server"; while it is starting or absent an
// index state of 就绪/未就绪 is shown, and nothing is shown once everything is ready.
export type SmartModeFlags = {
  /** 有没有活动编辑器。 */
  hasActive: boolean
  /** 设置仍在载入（装配根的 `editingSettingsLoading`）。 */
  loadingSettings: boolean
  /** 活动文件的语言服务已经跑起来。 */
  lspRunning: boolean
  /** 桌面宿主。 */
  isDesktop: boolean
  /** 活动文件的语言配过服务。 */
  lspConfigured: boolean
}

/** 指示器文案；空串 = 不显示。判定顺序与装配根原来的 if 链逐字一致。 */
export function smartModeLabelOf(flags: SmartModeFlags): string {
  if (!flags.hasActive) return ''
  if (flags.loadingSettings) return '正在载入设置'
  if (flags.lspRunning) return ''
  if (!flags.isDesktop) return ''
  // A language without a configured server is a normal state for this IDE (no server
  // is bundled), not 'indexing in progress' — IDEA also hides the indicator once the
  // project is smart, and never shows it for an unsupported file.
  if (!flags.lspConfigured) return ''
  return '语言服务未就绪'
}
