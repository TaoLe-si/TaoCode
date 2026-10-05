// 窗口外观：背景图与左右侧栏的排布 —— 从 App.vue 搬出的一域（186 行，29 个依赖）。
//
// 判据：这一族都在处理"窗口看起来什么样" —— 背景图（选图/透明度/填充/保持比例/清除）与
// 左右侧栏的并排（leftSideBySide / rightSideBySide）。状态（背景图相关）由设置持有，
// 这里只负责把它们应用到 DOM 与提供开关动作。
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { request, runOutput, setNativeDirty, type EditorSettings } from './bridge.ts'
import { errorMessage } from './errors.ts'
import { applicationActivation } from './applicationActivation.ts'
import { useMergedMainMenu } from './mergedMainMenu.ts'
import { TOOL_MNEMONIC_BINDINGS } from './toolWindowMeta.ts'

export interface AppearanceActionsDeps {
  // 工具条提示与"按编号切工具窗口"也在这一块里（它们和菜单开合状态耦合），
  // 所以下面的依赖比"纯外观"要多 —— 这是**如实**的记录，不是把职责混在一起：
  // 它们是同一批交互（打开汉堡菜单 → 切换工具窗口/侧栏）。
  toolDisabled: (id: any) => boolean
  showView: (id: any) => void
  gitHead: Ref<any>
  dirty: Ref<any>
  help: Ref<any>
  helpClose: Ref<any>
  leavePrompt: Ref<any>
  leaveCancel: any
  menu: Ref<string | null>
  menus: any
  palette: Ref<any>
  paletteIndex: Ref<any>
  query: Ref<any>
  queryInput: Ref<any>
  runLog: Ref<any>
  save: () => unknown
  testRunnerRef: Ref<any>
  notify: (message: string, error?: boolean) => void
  isDesktop: boolean
  generalSettings: Ref<any>
  zenMode: Ref<any>
  /** 面板尺寸（宿主是个普通对象，不是 ref）。 */
  panelSizes: { explorer: number; trace: number; output: number }
  setPanelSize: (which: any, size: number) => void
  saveSettingsPatch: (patch: Partial<EditorSettings>) => Promise<unknown>
  editorSettings: Ref<EditorSettings>
  settingsBusy: Ref<any>
  settingsError: Ref<any>
  /** 上次运行的参数（宿主在启动后要写它，所以留在宿主）。 */
  lastRunParams: Ref<any>
  /** 侧条宽度的重置（`src/toolWindowStripes.ts` 的 `applyShowNamesWidths`；可选 —— 纯外观测试不需要它）。 */
  applyShowNamesWidths?: (showNames: boolean) => void
  theme: Ref<any>
  workspace: Ref<any>
  explorer: Ref<any>
  saveGeneralSettings: (...args: any[]) => Promise<unknown>
}

export function createAppearanceActions(deps: AppearanceActionsDeps) {
  const isDesktop = deps.isDesktop
  // 全量解构：块内的用法保持原样（`.value` 照旧），ctx 里有什么就取什么。
  const { generalSettings, zenMode, panelSizes, setPanelSize, saveSettingsPatch, editorSettings, settingsBusy,
          settingsError, theme, workspace, explorer, saveGeneralSettings, lastRunParams,
          toolDisabled, showView, gitHead, dirty, help, helpClose,
          leavePrompt, leaveCancel, menu, menus, palette, paletteIndex, query, queryInput,
          runLog, save, testRunnerRef } = deps
  const hamburgerOpen = ref(false)
  // merged 档的顶层菜单溢出折叠：菜单与主工具栏抢同一行，抢不过就把尾部折进溢出按钮
  // （IDEA MainMenuWithButton.kt:62-131，算术与缓存在 src/mergedMainMenu.ts）。
  const mergedMenu = useMergedMainMenu({
    mode: () => editorSettings.value.mainMenuDisplayMode,
    expanded: () => hamburgerOpen.value,
    mounted: () => !!workspace.value,
  })
  watch(() => editorSettings.value.mainMenuDisplayMode, mode => {
    // 缺值时按上游的默认档回退：UISettingsState.kt:207 `by string(UNDER_HAMBURGER_BUTTON.name)`，
    // 且 `MainMenuDisplayMode.valueOf` 对认不出的值同样回退到它（MainMenuDisplayMode.kt:20）。
    document.documentElement.dataset.mainMenu = mode || 'hamburger'
    // 汉堡与 merged 两档的溢出按钮打开的都是**同一个**完整菜单弹层（ExpandableMenu），
    // 所以换到 merged 时不能把已展开的弹层判成非法状态关掉。
    if (mode !== 'hamburger' && mode !== 'merged') hamburgerOpen.value = false
  }, { immediate: true })
  // IDEA 的顶栏底色随**窗口激活态**换值（CustomHeader.kt:166-168 记 `isActive = window.isActive`，
  // ToolbarFrameHeader.kt:424-427 用它取 mainToolbarBackground(active)）；这里把它摊成一个根节点属性，
  // 与磁盘同步（diskSync 的 focus 监听）、LSP 暂停（lspNavigation 的 blur 监听）各走各的，互不依赖。
  const markWindowActive = (active: boolean) => { document.documentElement.dataset.windowActive = active ? 'active' : 'inactive' }
  // 窗口焦点也是 `ApplicationActivationListener` 的信号（上游 TOPIC 的 app 级广播）：
  // 顶栏底色与监听器在同一处分发，谁想响应激活/失活都往 src/applicationActivation.ts 注册。
  const onWindowActivated = () => { markWindowActive(true); applicationActivation.applicationActivated() }
  const onWindowDeactivated = () => { markWindowActive(false); applicationActivation.applicationDeactivated() }
  window.addEventListener('focus', onWindowActivated)
  window.addEventListener('blur', onWindowDeactivated)
  markWindowActive(document.hasFocus())
  if (document.hasFocus()) applicationActivation.applicationActivated()
  onBeforeUnmount(() => {
    window.removeEventListener('focus', onWindowActivated)
    window.removeEventListener('blur', onWindowDeactivated)
  })
  // IDEA ExpandableMenu.isShowing: the expanded menu bar is an overlay of the real
  // IdeJMenuBar, so the flag only drives layout — the menu markup stays the same one.
  // switchState selects the first menu once the bar is shown (ExpandableMenu.kt:133-136), and
  // hiding drops the selection with it.
  watch(hamburgerOpen, open => {
    if (open) document.documentElement.dataset.menuExpanded = 'on'
    else delete document.documentElement.dataset.menuExpanded
    if (open && !menu.value) menu.value = menus[0]?.menu ?? null
    if (!open) menu.value = null
  }, { immediate: true })
  // menuSelectionListener (ExpandableMenu.kt:62-76): once no menu is selected any more
  // (Escape, click outside, an action picked) the expanded bar hides itself.
  watch(menu, value => { if (!value && hamburgerOpen.value) hamburgerOpen.value = false })
  // IDEA "Support screen readers": notifications are announced through a live region
  // and hover tooltips are suppressed (the IDEA checkbox says tooltips "will be disabled").
  // IDEA's checkbox says tooltips "will be disabled" while accessibility names stay:
  // every title attribute is copied into aria-label (when there is none) and removed,
  // and a MutationObserver keeps doing that for anything rendered later.
  let screenReaderObserver: MutationObserver | null = null
  function stripHoverTitles(root: ParentNode) {
    for (const element of root.querySelectorAll<HTMLElement>('[title]')) {
      if (!element.getAttribute('aria-label')) element.setAttribute('aria-label', element.getAttribute('title') ?? '')
      element.removeAttribute('title')
    }
  }
  // GeneralSettings.isSupportScreenReaders (GeneralSettings.kt:179-186): the state lives in
  // ide.general.xml, not the editor settings — AppearanceConfigurable.kt:363-372 is its row.
  watch(() => generalSettings.value.supportScreenReaders, on => {
    document.documentElement.dataset.screenReader = on ? 'on' : 'off'
    if (screenReaderObserver) { screenReaderObserver.disconnect(); screenReaderObserver = null }
    if (!on) return
    stripHoverTitles(document)
    screenReaderObserver = new MutationObserver(records => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement) {
            if (node.hasAttribute('title')) {
              if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', node.getAttribute('title') ?? '')
              node.removeAttribute('title')
            }
            stripHoverTitles(node)
          }
    })
    screenReaderObserver.observe(document.body, { childList: true, subtree: true })
  }, { immediate: true })
  onBeforeUnmount(() => screenReaderObserver?.disconnect())
  // IDEA's "Bracket matching highlight" (editor setting): CodeMirror's basicSetup
  // keeps the matcher installed, so the setting controls the highlight itself —
  // switching it off removes the matching-bracket emphasis in every editor.
  watch(() => editorSettings.value.bracketMatching, on => {
    document.documentElement.dataset.bracketMatching = on ? 'on' : 'off'
  }, { immediate: true })
  watch(() => editorSettings.value.useContrastScrollbars, on => {
    document.documentElement.dataset.scrollbars = on ? 'contrast' : 'default'
  }, { immediate: true })
  // IDEA's colour-vision deficiency filter: an feColorMatrix applied to the whole UI.
  watch(() => editorSettings.value.colorBlindness, mode => {
    document.documentElement.dataset.colorBlind = mode && mode !== 'none' ? mode : 'off'
  }, { immediate: true })
  // IDEA "Use custom font": the UI font stack (the editor font is its own setting).
  watch([() => editorSettings.value.uiFontFamily, () => editorSettings.value.uiFontSize], ([family, size]) => {
    const root = document.documentElement.style
    if (family) root.setProperty('--font-ui', `'${family.replace(/'/g, '')}', 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif`)
    else root.removeProperty('--font-ui')
    root.setProperty('--ui-font-size', `${size || 13}px`)
    document.documentElement.dataset.uiFontSize = String(size || 13)
  }, { immediate: true })
  // IDEA AppearanceConfigurable, applied for real:
  //  - ideScale: the whole UI scales (IDEA zooms the Swing hierarchy; a web UI does it
  //    with a rem multiplier, so every spacing tied to a token follows).
  //  - compactMode (IDEA "Compact mode - UI elements take up less screen space"):
  //    control heights and paddings shrink through density variables.
  watch(() => editorSettings.value.uiZoomPercent, percent => {
    document.documentElement.style.fontSize = `${(percent ?? 100) / 100 * 16}px`
  }, { immediate: true })

  // IDEA Images.SetBackgroundImage: the chosen image is painted behind the editor
  // stage; fill/opacity/keep-ratio come from the same dialog IDEA shows.
  const backgroundImage = ref('')
  watch([() => editorSettings.value.backgroundImagePath, () => editorSettings.value.backgroundImageOpacity,
         () => editorSettings.value.backgroundImageFill, () => editorSettings.value.backgroundImageKeepRatio],
    async ([path, opacity, fill, keepRatio]) => {
      if (!path) { backgroundImage.value = ''; applyBackground(''); return }
      // The bytes are re-read on startup; a path that no longer exists just means
      // "no background" (the setting stays so it comes back if the file returns).
      try {
        const image = await request<{ dataUrl: string } | null>('app.readImage', { path })
        backgroundImage.value = image?.dataUrl ?? ''
      } catch { backgroundImage.value = '' }
      applyBackground(backgroundImage.value)
      const stage = document.documentElement.style
      stage.setProperty('--bg-image-opacity', String((opacity ?? 100) / 100))
      stage.setProperty('--bg-image-size', fill === 'tile' ? 'auto' : fill === 'center' ? 'auto' : keepRatio ? 'contain' : '100% 100%')
      stage.setProperty('--bg-image-repeat', fill === 'tile' ? 'repeat' : 'no-repeat')
      stage.setProperty('--bg-image-position', fill === 'tile' ? 'top left' : 'center')
      document.documentElement.dataset.background = backgroundImage.value ? 'on' : 'off'
    }, { immediate: true })
  function applyBackground(dataUrl: string) {
    if (dataUrl) document.documentElement.style.setProperty('--bg-image-url', `url("${dataUrl}")`)
    else document.documentElement.style.removeProperty('--bg-image-url')
  }
  // IDEA presentation mode (UISettingsState.presentationMode + presentationModeFontSize):
  // hides the chrome and enlarges the text for screen sharing.
  watch([() => editorSettings.value.presentationMode, () => editorSettings.value.presentationModeFontSize], ([on, size]) => {
    zenMode.value = on
    document.documentElement.dataset.presentation = on ? 'on' : 'off'
    if (on) document.documentElement.style.fontSize = `${Math.min(72, Math.max(12, size || 24))}px`
  }, { immediate: true })
  async function chooseBackgroundImage() {
    try {
      const image = await request<{ dataUrl: string; path: string } | null>('dialog.pickImage')
      if (!image) return
      await saveSettingsPatch({ backgroundImagePath: image.path })
      deps.notify('已设置背景图像。')
    } catch (error) { deps.notify(errorMessage(error), true) }
  }
  async function clearBackgroundImage() {
    await saveSettingsPatch({ backgroundImagePath: '' })
    deps.notify('已移除背景图像。')
  }
  watch(() => editorSettings.value.compactMode, compact => {
    document.documentElement.dataset.density = compact ? 'compact' : 'regular'
  }, { immediate: true })
  // IDEA "Smooth scrolling" (UISettings.smoothScrolling): the entire interface
  // scrolls smoothly instead of line by line — scroll-behavior on the root.
  watch([() => editorSettings.value.smoothScrolling, () => editorSettings.value.powerSaveMode], ([smooth, powerSave]) => {
    // IDEA's power save mode stops animations too (JBAnimator/ScrollSettings), so the
    // effective scrolling is "smooth AND not saving power".
    document.documentElement.style.scrollBehavior = smooth && !powerSave ? 'smooth' : 'auto'
    document.documentElement.dataset.motion = powerSave ? 'reduced' : 'full'
  }, { immediate: true })
  // IDEA "Side-by-side layout on the left": the project view keeps a pane of its own.
  const leftSideBySide = computed(() => editorSettings.value.leftSideBySide && Boolean(workspace.value))
  // The same option for the right stripe.
  const rightSideBySide = computed(() => editorSettings.value.rightSideBySide && Boolean(workspace.value))
  watch(() => editorSettings.value.wideScreenSupport, () => {
    setPanelSize('output', panelSizes.output)
  }, { immediate: false })
  // IDEA "Show tool window bars" / "Show tool window names": the stripe rail can be
  // hidden entirely, and its buttons can carry the window's name under the icon.
  watch(() => editorSettings.value.showToolWindowBars, show => {
    document.documentElement.dataset.toolStripes = show ? 'on' : 'off'
  }, { immediate: true })
  // IDEA "Display icons in menu items" (UISettings.showIconsInMenus): menus keep their
  // leading icon column only while this is on.
  watch(() => editorSettings.value.showIconsInMenus, show => {
    document.documentElement.dataset.menuIcons = show ? 'on' : 'off'
  }, { immediate: true })
  watch(() => editorSettings.value.showToolWindowNames, show => {
    document.documentElement.dataset.toolNames = show ? 'on' : 'off'
  }, { immediate: true })
  // 名称开关一变就把侧条宽度重置（`ResizeStripeManager.applyShowNames`，`ResizeStripeManager.kt:215-228`）。
  // 这一条**故意不是 immediate**：上游 applyShowNames 由设置页 onApply / 动作触发，启动时读的是存下来的
  // 宽度 —— immediate 会把用户拖出来的宽度每次重启都抹掉。
  watch(() => editorSettings.value.showToolWindowNames, show => deps.applyShowNamesWidths?.(show))
  // IDEA "Show tool window numbers": the stripe buttons wear Alt+1..9 mnemonics and
  // those shortcuts really do focus the window (same order as the stripe).
  watch(() => editorSettings.value.showToolWindowNumbers, show => {
    document.documentElement.dataset.toolNumbers = show ? 'on' : 'off'
  }, { immediate: true })
  function focusToolWindowByNumber(event: KeyboardEvent) {
    // IDEA: ActivateToolWindowAction always answers Alt+N — showToolWindowsNumbers only
    // decides whether the stripe button prints the number (StripeButton.kt:287-296),
    // so the shortcut must not depend on that setting.
    if (!event.altKey) return
    const id = TOOL_MNEMONIC_BINDINGS[event.key]
    if (!id) return
    // An unavailable tool window has its action disabled (:131-137), so the shortcut does
    // nothing at all — it must never fall through and open some *other* tool window.
    if (toolDisabled(id)) return
    event.preventDefault()
    showView(id)
  }
  // IDEA's welcome page shows each recent project's git branch (RecentProjectPanel
  // reads it from persisted project state). TaoCode records the branch the status
  // bar already polled, keyed by root, and the welcome page reads it back.
  watch(gitHead, head => {
    const root = workspace.value?.root
    if (!root || !head) return
    try { localStorage.setItem(`taocode.branch:${root}`, head) } catch { /* storage unavailable: the line is simply absent */ }
  })
  watch(dirty, value => setNativeDirty(value))
  watch(query, () => { paletteIndex.value = 0 })
  watch(palette, async value => { if (value) { paletteIndex.value = 0; await nextTick(); queryInput.value?.focus() } })
  watch(help, async value => { if (value) { await nextTick(); helpClose.value?.focus() } })
  watch(leavePrompt, async value => { if (value) { await nextTick(); leaveCancel.value?.focus() } })
  watch(() => runOutput.length, async () => {
    await nextTick(); if (runLog.value) runLog.value.scrollTop = runLog.value.scrollHeight
    // Feed the streamed lines to the test runner so per-test results accumulate
    // (IDEA's test tree fills while the process runs, not after it exits).
    for (const line of runOutput.slice(pumpedRunLines)) testRunnerRef.value?.ingest(line)
    pumpedRunLines = runOutput.length
  })
  let pumpedRunLines = 0
  // Run an arbitrary command from a panel (e.g. the test runner's rerun command).
  // IDEA's Rerun (Ctrl+F5): relaunch the last run content with the same parameters.

  return {
    focusToolWindowByNumber,
    hamburgerOpen, stripHoverTitles,
    menuVisibleCount: mergedMenu.visibleCount, menuButtonVisible: mergedMenu.menuButtonVisible,
    backgroundImage, applyBackground, chooseBackgroundImage, clearBackgroundImage,
    leftSideBySide, rightSideBySide,
  }
}
