// 浏览器预览态下 `settings.update` 的**键表与取值校验**。
//
// 从 `src/bridge.ts` 拆出（那个文件贴着机检上限，而这一段是纯逻辑、可单测）。
// 它不是"另一份白名单"——它是**同一条规则的第二道关卡**：桌面端的真源是
// `native/settings_schema.cpp` 的 `validate_editor_patch`，预览态没有原生那一侧，
// 这一份就是它的等价物。两份规则漂了的后果在项目里真实发生过（界面能勾、永远存不下来，
// 见 `tests/settings-keys-parity.test.mjs` 的文件头），所以那条门禁读的正是本文件。
//
// 返回 `null` = 通过；否则返回给用户看的那一句话（调用方负责包成 `BridgeError`）。
export function previewSettingsError(key: string, value: unknown, languages: readonly string[]): string | null {
  const accepted = key === 'fontSize' || key === 'tabSize' || key === 'wordWrap' ||
      key === 'lineNumbers' ||
      key === 'showIndentGuides' || key === 'bracketMatching' || key === 'tabLimit' || key === 'tabsInOneRow' || key === 'hideTabsIfNeeded' || key === 'sortBookmarks' ||
      key === 'useTabCharacter' || key === 'showWhitespaces' || key === 'formatOnSave' ||
      key === 'uiZoomPercent' || key === 'compactMode' || key === 'fullPathsInWindowHeader' ||
      key === 'showTreeIndentGuides' || key === 'compactTreeIndents' ||
      key === 'showBreadcrumbs' || key === 'breadcrumbsPlacement' || key === 'breadcrumbsLanguages' ||
      key === 'collapseImports' || key === 'collapseCustomRegions' || key === 'showStickyLines' || key === 'stickyLinesLimit' || key === 'diffContextLines' ||
      key === 'showDiagnostics' || key === 'showErrorStripe' || key === 'reformatOnPaste' || key === 'bidiTextDirection' || key === 'showGutterIcons' || key === 'fileColorsEnabled' || key === 'fileColorsForTabs' || key === 'fileColorsForProjectView' || // 文件颜色两层开关见 IDEA `FileColorManagerImpl`（FileColorsEnabled / FileColorsForTabsEnabled）
      key === 'smoothScrolling' || key === 'showIconsInMenus' ||
      key === 'rememberSizeForEachToolWindow' || key === 'showToolWindowNames' || key === 'showToolWindowBars' ||
      key === 'leftSideBySide' || key === 'wideScreenSupport' || key === 'rightSideBySide' ||
      key === 'showToolWindowNumbers' ||
      key === 'keepPopupsForToggles' || key === 'dndWithPressedAltOnly' || key === 'powerSaveMode' ||
      key === 'useContrastScrollbars' || key === 'colorBlindness' || key === 'uiFontFamily' || key === 'uiFontSize' ||
      key === 'backgroundImagePath' || key === 'backgroundImageOpacity' || key === 'backgroundImageFill' ||
      key === 'backgroundImageKeepRatio' || key === 'presentationMode' || key === 'presentationModeFontSize' ||
      key === 'showStatusBar' || key === 'rightMargin' ||
      key === 'mainMenuDisplayMode' || key === 'differentiateProjects' || key === 'expandNodesWithSingleClick' || key === 'maximizeEditorOnTabDoubleClick' || key === 'pinnedTabsInSeparateRow'
    if (!accepted) return `无效设置：${key}`
    if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < 10 || Number(value) > 32
      : key === 'tabSize' ? ![2, 4, 8].includes(Number(value)) || typeof value !== 'number'
      : key === 'tabLimit' ? !Number.isInteger(value) || Number(value) < 1 || Number(value) > 100
      : key === 'uiZoomPercent' ? !Number.isInteger(value) || Number(value) < 50 || Number(value) > 400
      : key === 'uiFontSize' ? !Number.isInteger(value) || Number(value) < 9 || Number(value) > 24
      : key === 'backgroundImageOpacity' ? !Number.isInteger(value) || Number(value) < 0 || Number(value) > 100
      : key === 'presentationModeFontSize' ? !Number.isInteger(value) || Number(value) < 12 || Number(value) > 72
      : key === 'backgroundImagePath' ? typeof value !== 'string' || value.length > 512
      : key === 'backgroundImageFill' ? !['scale', 'tile', 'center'].includes(String(value))
      : key === 'mainMenuDisplayMode' ? !['hamburger', 'merged', 'separate'].includes(String(value))
      : key === 'uiFontFamily' ? typeof value !== 'string' || value.length > 120
      : key === 'colorBlindness' ? !['none', 'deuteranopia', 'protanopia', 'tritanopia'].includes(String(value))
      : key === 'stickyLinesLimit' ? !Number.isInteger(value) || Number(value) < 0 || Number(value) > 10
      : key === 'diffContextLines' ? !Number.isInteger(value) || Number(value) < 1 || Number(value) > 100
      // 与原生 validate_language_flags 同一套规则：键必须是已知语言 id，值是布尔。
      : key === 'breadcrumbsLanguages' ? !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.entries(value).some(([id, flag]) => !(languages as readonly string[]).includes(id) || typeof flag !== 'boolean')
      : typeof value !== 'boolean')
      return `无效设置：${key}`
  return null
}
