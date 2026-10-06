// 浏览器预览态下 `settings.update` 的**键表与取值校验**。
//
// 从 `src/bridge.ts` 拆出（那个文件贴着机检上限，而这一段是纯逻辑、可单测）。
// 它不是"另一份白名单"——它是**同一条规则的第二道关卡**：桌面端的真源是
// `native/settings_schema.cpp` 的 `validate_editor_patch`，预览态没有原生那一侧，
// 这一份就是它的等价物。两份规则漂了的后果在项目里真实发生过（界面能勾、永远存不下来，
// 见 `tests/settings-keys-parity.test.mjs` 的文件头），所以那条门禁读的正是本文件。
//
// 返回 `null` = 通过；否则返回给用户看的那一句话（调用方负责包成 `BridgeError`）。
import { MIN_EDITOR_FONT_SIZE, MAX_EDITOR_FONT_SIZE } from './editorFontSize.ts'
// 终端基准字号的界与桌面端（settings_editor_keys.hpp）、设置页那一格用同一对数：
// 上游 EditorFontsConstants.java:11-13（scale(4)）/ :15-17（ide.editor.max.font.size 默认 40）。
// terminalFontSize.ts 不 import 任何东西 ⇒ 这里没有环。
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from './terminalFontSize.ts'
import { isBidiDirection } from './bidiTextDirection.ts'

export function previewSettingsError(key: string, value: unknown, languages: readonly string[]): string | null {
  const accepted = key === 'fontSize' || key === 'tabSize' || key === 'wordWrap' ||
      key === 'lineNumbers' ||
      key === 'showIndentGuides' || key === 'bracketMatching' || key === 'lineNumeration' || key === 'tabLimit' || key === 'tabsInOneRow' || key === 'hideTabsIfNeeded' || key === 'sortBookmarks' ||
      key === 'useTabCharacter' || key === 'showWhitespaces' || key === 'formatOnSave' ||
      key === 'uiZoomPercent' || key === 'compactMode' || key === 'fullPathsInWindowHeader' ||
      key === 'showTreeIndentGuides' || key === 'compactTreeIndents' ||
      key === 'showBreadcrumbs' || key === 'breadcrumbsPlacement' || key === 'breadcrumbsLanguages' || key === 'showMembersInNavigationBar' ||
      key === 'collapseImports' || key === 'collapseCustomRegions' || key === 'showStickyLines' || key === 'stickyLinesLimit' || key === 'diffContextLines' ||
      key === 'showDiagnostics' || key === 'showErrorStripe' || key === 'reformatOnPaste' || key === 'bidiTextDirection' || key === 'showGutterIcons' || key === 'fileColorsEnabled' || key === 'fileColorsForTabs' || key === 'fileColorsForProjectView' || // 文件颜色两层开关见 IDEA `FileColorManagerImpl`（FileColorsEnabled / FileColorsForTabsEnabled）
      // InlaySettingsConfigurable（`inlay.hints`）：按 LSP `kind` 分的三档（Type / Parameter / 其它）。
      key === 'showTypeInlayHints' || key === 'showParameterInlayHints' || key === 'showOtherInlayHints' ||
      key === 'smoothScrolling' || key === 'showIconsInMenus' ||
      key === 'rememberSizeForEachToolWindow' || key === 'showToolWindowNames' || key === 'showToolWindowBars' ||
      key === 'leftSideBySide' || key === 'wideScreenSupport' || key === 'rightSideBySide' ||
      key === 'showToolWindowNumbers' ||
      key === 'keepPopupsForToggles' || key === 'dndWithPressedAltOnly' || key === 'powerSaveMode' ||
      key === 'useContrastScrollbars' || key === 'colorBlindness' || key === 'uiFontFamily' || key === 'uiFontSize' ||
      key === 'backgroundImagePath' || key === 'backgroundImageOpacity' || key === 'backgroundImageFill' ||
      key === 'backgroundImageKeepRatio' || key === 'presentationMode' || key === 'presentationModeFontSize' ||
      key === 'showStatusBar' || key === 'rightMargin' ||
      // 保存时的两条 pass（EditorSettingsExternalizable.java:73-74,142）+ 回车与引号的三个开关
      // （CodeInsightSettings.java:130,132,140）+ Code Vision 的四把（CodeVisionSettings.kt:36,38-39,45,50）。
      key === 'stripTrailingSpaces' || key === 'ensureNewLineAtEof' || key === 'keepTrailingSpacesOnCaretLine' ||
      key === 'autoInsertPairQuote' || key === 'closeCommentOnEnter' || key === 'insertBraceOnEnter' ||
      key === 'codeVisionEnabled' || key === 'codeVisionDisabledGroups' || key === 'codeVisionEnabledGroups' || key === 'codeVisionVisibleEntries' ||
      // 快速文档两档（都是布尔；键名见 src/docHoverPolicy.ts 的 DOC_HOVER_SETTING_KEYS）。
      key === 'showQuickDocOnMouseHover' || key === 'autoUpdateDocumentation' ||
      // 终端字号两把：总闸是布尔（上游 EditorSettingsExternalizable.java:124 默认 false），
      // 基准字号是整数 4..40（EditorFontsConstants.java:11-13 / :15-17）。
      key === 'wheelFontChangeEnabled' || key === 'terminalBaseFontSize' ||
      key === 'mainMenuDisplayMode' || key === 'differentiateProjects' || key === 'expandNodesWithSingleClick' || key === 'maximizeEditorOnTabDoubleClick' || key === 'pinnedTabsInSeparateRow'
    if (!accepted) return `无效设置：${key}`
    if (key === 'fontSize' ? !Number.isInteger(value) || Number(value) < MIN_EDITOR_FONT_SIZE || Number(value) > MAX_EDITOR_FONT_SIZE
      // 终端基准字号与编辑器字号同一套界（EditorFontsConstants.java:11-13 / :15-17 = 4 / 40）。
      // 漏这一支 = 它掉进末尾 `typeof value !== 'boolean'` 的兜底 ⇒ 浏览器预览能勾、永远存不下。
      : key === 'terminalBaseFontSize' ? !Number.isInteger(value) || Number(value) < MIN_TERMINAL_FONT_SIZE || Number(value) > MAX_TERMINAL_FONT_SIZE
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
      : key === 'bidiTextDirection' ? !isBidiDirection(value)
      : key === 'reformatOnPaste' ? !['none', 'indentBlock', 'indentEachLine', 'reformatBlock'].includes(String(value))
      : key === 'breadcrumbsPlacement' ? !['top', 'bottom'].includes(String(value))
      : key === 'lineNumeration' ? !['absolute', 'relative', 'hybrid'].includes(String(value))
      // 保存 pass 的三档（EditorSettingsExternalizable.java:216-218 的字面值）。
      : key === 'stripTrailingSpaces' ? !['None', 'Changed', 'Whole'].includes(String(value))
      // Code Vision 的可见条数：界 1..10 = 上游 spinner(1..10, 1)（CodeVisionGlobalSettingsProvider.kt:43）。
      : key === 'codeVisionVisibleEntries' ? !Number.isInteger(value) || Number(value) < 1 || Number(value) > 10
      // Code Vision 的两个组集合（CodeVisionSettings.kt:45/:50，只装与出厂相反的那一半）：
      // 条目必须是本仓已知的组 id（src/codeLensSettings.ts:48-50 的 LspCodeVisionProvider / problems）。
      : key === 'codeVisionDisabledGroups' || key === 'codeVisionEnabledGroups' ? !Array.isArray(value) || value.length > 8 ||
        value.some(id => id !== 'LspCodeVisionProvider' && id !== 'problems')
      // 与原生 validate_language_flags 同一套规则：键必须是已知语言 id，值是布尔。
      : key === 'breadcrumbsLanguages' ? !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.entries(value).some(([id, flag]) => !(languages as readonly string[]).includes(id) || typeof flag !== 'boolean')
      : typeof value !== 'boolean')
      return `无效设置：${key}`
  return null
}
