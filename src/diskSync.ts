// 磁盘同步与后台刷新（IDEA 的 Synchronize / 外部改动检测 / 焦点与可见性钩子）——
// 从 App.vue 搬出的一域（150 行，15 个依赖）。
//
// 判据：这一族处理"磁盘与内存不一致"这件事 —— 手动同步、从磁盘重载、外部改动检测（fs watch）、
// 窗口失焦/隐藏时的节流、以及三个计时器（fsWatchTimer / backgroundTimer / lastActivityAt）。
// 状态（计时器、上次版本号、最近活动时间）全部由本模块自持。
import { nextTick, ref, watch, type Ref } from 'vue'
import { watchStopped, fsChanges, lspEdited, request, setNativeTheme, termOpened, type DocumentData, type Entry,
         type Workspace, historyNotes } from './bridge.ts'
import type { Tab } from './editorTab'
import type { Theme } from './appearance'
import { errorMessage } from './errors.ts'
import { decodeFailureKey, decodeFailureNotice } from './fileEncodingRules.ts'
// 正文被程序性改写也要给那一篇换修订号 —— 见 src/documentRevisions.ts 与下面每处 bumpDocumentRevision 的注释。
import { bumpDocumentRevision } from './documentRevisions.ts'

export interface DiskSyncDeps {
  notify: (message: string, error?: boolean) => void
  /** 切到底部输出面板（同步失败要把它打开）。 */
  showOutput: (id: any) => void
  /** 桌面端才有文件监听与原生重载。 */
  isDesktop: boolean
  /** 编辑器引用（按 path 取）。 */
  editorFor: (path: string) => any
  /** 标签查找（判断某个文件是否打开着）。 */
  findTab: (path: string) => any
  refreshTree: () => unknown
  menu: Ref<string | null>
  activity: Ref<boolean>
  theme: Ref<Theme>
  generalSettings: Ref<{ autoSyncFiles: boolean; backgroundSyncFiles: boolean; [key: string]: unknown }>
  /**
   * 一批外部改动交给「构建工具」（IDEA `build.tools` 的自动重载）判定：
   * `paths` 是工作区相对路径，**空数组表示这一批溢出了、具体文件未知**。
   * 由 src/gradleHost.ts 按 `autoReloadType` 的三档语义决定要不要重同步。
   */
  onBuildFilesChanged: (paths: readonly string[]) => void
  workspace: Ref<Workspace | null>
  /** 打开的标签（磁盘同步要检查它们是否有未保存改动、以及是否与磁盘不同）。 */
  /** 打开的标签（用共享类型 `Tab`，不再写结构化近似 —— 那会变成漂移点）。 */
  allTabs: { readonly value: Tab[] }
  treeVersion: Ref<number>
  dirty: Ref<boolean>
  /** 同步进行中（宿主是 `let`，读写作惰性注入）。 */
  syncing: () => boolean
  setSyncing: (value: boolean) => void
  /** 单文件同步上限（宿主是个常量）。 */
  syncLimit: number
  terminalPanelRef: Ref<any>
}

/**
 * 这一标签该不该读盘同步：有未保存改动的不动（否则会丢用户的字），超大文件跳过
 * （`:63` 原来写死在同一处，现在抽出来是为了能单独核）。
 */
export function shouldSyncTabFromDisk(tab: { dirty: boolean; content: string }, syncLimit: number): boolean {
  return !tab.dirty && tab.content.length <= syncLimit
}

/** 磁盘内容要不要覆盖缓冲区：版本一致就没必要整篇换掉（IDEA 也是比了 version 才动）。 */
export function diskSupersedesBuffer(tab: { version: unknown }, disk: { version: unknown }): boolean {
  return disk.version !== tab.version
}

export function createDiskSync(deps: DiskSyncDeps) {
  // 同步的本体，不带任何触发条件（`quiet` 让后台那一趟保持安静）。
  // 手动「同步」与后台自动刷新都走它 —— 所以它不能自己判断该不该跑。
  const isDesktop = deps.isDesktop
  const { menu, activity, theme, generalSettings, workspace, allTabs, treeVersion, dirty, syncLimit,
          editorFor, findTab, refreshTree, terminalPanelRef } = deps
  const showOutput = deps.showOutput
  // 已经说过的「按这档编码读不出来」：磁盘同步每次切标签、每次外部改动都会再跑一趟，
  // 同一个标签的同一个磁盘版本只报一次（读成功了就把键放下，下次真变了还要报）。
  const decodeFailuresReported = new Set<string>()
  async function performDiskSync(quiet = false) {
    if (!isDesktop || !workspace.value || deps.syncing()) return
    deps.setSyncing(true)
    try {
      workspace.value = { ...workspace.value, entries: await request<Entry[]>('workspace.list', { path: '' }) }
      treeVersion.value++
    } catch { /* the project may have closed mid-flight */ }
    for (const tab of allTabs.value) await syncOneTabFromDisk(tab, quiet)
    deps.setSyncing(false)
  }
  /**
   * 单个标签的磁盘同步 —— 抽出来是因为它有两个触发点：整批（窗口聚焦 / 后台刷新 / 手动）
   * 与**切到这一标签时**（`EditorWindow.kt:210-219` 的 `selectionChanged`：新选中的文件若
   * `GeneralSettings.isSyncOnFrameActivation` 为真就 `VfsUtil.markDirtyAndRefresh`，即"切标签时
   * 从磁盘重新同步这一个文件"）。未保存改动与大文件照旧跳过（`:63` 的第一道闸）。
   */
  async function syncOneTabFromDisk(tab: Tab, quiet = false) {
    if (!shouldSyncTabFromDisk(tab, syncLimit)) return
    try {
      const disk = await request<DocumentData>('file.read', { path: tab.path, encoding: tab.encoding })
      // A lock set outside the IDE must reach the buffer even when content is unchanged.
      if (disk.readOnly !== tab.readOnly) {
        tab.readOnly = disk.readOnly
        editorFor(tab.path)?.setReadOnly(Boolean(disk.readOnly))
      }
      if (!diskSupersedesBuffer(tab, disk)) return
      Object.assign(tab, { content: disk.content, version: disk.version, encoding: disk.encoding, bom: disk.bom })
      editorFor(tab.path)?.setDraft(disk.content)
      // 磁盘内容盖进编辑器 = 上游**第一个** listener 那一档（VFS 变化，
      // `NonModalCommitWorkflowHandler.kt:203-213`）⇒ 这一篇的正文真的变过一版，必须换号；
      // 不换号 ⇒ 提交检查的指纹逐字不变 ⇒ 上一轮的 PASSED 永远不作废（假复用）。
      bumpDocumentRevision(tab.path)
      if (tab.lspRunning) void request('lsp.change', { path: tab.path, text: disk.content }).catch(() => undefined)
      decodeFailuresReported.delete(decodeFailureKey(tab.path, tab.version))
      if (!quiet) deps.notify(`磁盘上的 ${tab.path} 已变化，编辑器已同步`)
    } catch (error) {
      // 「删了 / 暂时读不到」继续留着旧缓冲（那条另有归属，见上面的 deleted 注释与本文件的 fs watch 分支）；
      // 但**按这一档编码解不开字节**必须说话：本仓读侧是严格的（`native/workspace.cpp:141-142`
      // "never a '?' written over the user's text"），上游同场景至少按默认编码读下去
      // （`CharsetToolkit.java:242-261` 的 `INVALID_UTF8 ⇒ defaultCharset`）。两边都不该让缓冲区
      // 悄悄停在旧内容上 —— 静默的旧文本和静默的问号一样坏。
      const notice = decodeFailureNotice(tab.path, tab.encoding, (error as { code?: string })?.code, errorMessage(error))
      if (notice) {
        const key = decodeFailureKey(tab.path, tab.version)
        if (!decodeFailuresReported.has(key)) { decodeFailuresReported.add(key); deps.notify(notice, true) }
      }
    }
  }
  /**
   * 切编辑器标签：**只同步切过去的那个文件**（上游那条 `selectionChanged` 就是这么做的 ——
   * 它按 `newSelection` 拿文件，不遍历所有打开的编辑器）。开关是同一个 `autoSyncFiles`。
   */
  async function syncTabOnActivation(path: string) {
    if (!isDesktop || !generalSettings.value.autoSyncFiles) return
    const tab = findTab(path)
    if (tab) await syncOneTabFromDisk(tab, true)
  }
  // Frame activation / editor-tab activation: GeneralSettings.isSyncOnFrameActivation, i.e. the
  // `autoSyncFiles` key (see its own comment above).
  async function syncFromDisk() {
    if (!generalSettings.value.autoSyncFiles) return
    await performDiskSync()
  }
  // IDEA's periodic background VFS refresh, a different switch on a different trigger:
  // GeneralSettings.isBackgroundSync (GeneralSettings.kt:67-71) gates both controllers
  // (SaveAndSyncHandlerImpl.kt:610 idle, :649 unfocused). Which one runs is the registry key
  // `vfs.background.refresh.on.idle`, whose default is **true** and whose own description says to
  // "refresh VFS periodically while there is no user activity in the IDE instead of when window
  // is not focused" (intellij.platform.ide.core.impl.xml:77-80). So this is the idle variant: the
  // delay is `vfs.background.refresh.interval` (registry.properties:1656 = 15s, read at
  // SaveAndSyncHandlerImpl.kt:750-752), the window starts after that much inactivity and stops
  // again on any activity (:596-611).
  const backgroundRefreshInterval = 15_000
  let backgroundTimer: number | undefined
  let lastActivityAt = Date.now()
  function noteActivity() { lastActivityAt = Date.now() }
  async function backgroundRefreshOnce() {
    if (!generalSettings.value.backgroundSyncFiles || !isDesktop) return
    // "no user activity for one interval" is exactly the source's `debounce(interval)`.
    if (Date.now() - lastActivityAt < backgroundRefreshInterval) return
    await performDiskSync(true)
  }
  function startBackgroundRefresh() {
    stopBackgroundRefresh()
    if (!isDesktop) return
    backgroundTimer = window.setInterval(() => { void backgroundRefreshOnce() }, backgroundRefreshInterval)
  }
  function stopBackgroundRefresh() { if (backgroundTimer) { window.clearInterval(backgroundTimer); backgroundTimer = undefined } }
  function onWindowFocus() { void syncFromDisk() }
  function onVisibility() { if (document.visibilityState === 'visible') void syncFromDisk() }
  // IDEA File menu: 从磁盘全部重新加载 (Reload All from Disk, Ctrl+Alt+Y). The same
  // sync as frame activation, plus an explicit confirmation toast.
  async function forceReloadFromDisk() {
    if (!isDesktop || !workspace.value) { deps.notify('请先打开一个项目。', true); return }
    await syncFromDisk()
    await refreshTree()
    deps.notify('已从磁盘重新加载全部未修改文件。')
  }
  // IDE-03 live file watching: the native watcher already debounced the OS noise, so
  // this handler only coalesces UI work — refresh the tree once per batch and let
  // syncFromDisk pull the changed buffers (dirty ones are never touched).
  let fsWatchTimer: number | undefined
  let lastFsVersion = 0
  async function onFsChanges() {
    if (!isDesktop || !workspace.value) return
    // 构建工具（IDEA `build.tools`）的自动重载：判定在三档语义那边（src/gradleHost.ts），
    // 这一层只把"这一批变了哪些文件"转交过去。**VFS 刷新本身与自动重载是两个独立机制**
    // —— 前者（下面的文件树/缓冲区刷新）照旧无条件做，后者只对构建脚本生效。
    deps.onBuildFilesChanged(fsChanges.paths)
    if (fsWatchTimer !== undefined) return
    fsWatchTimer = window.setTimeout(async () => {
      fsWatchTimer = undefined
      if (!workspace.value) return
      // Ignore our own writes: the version snapshot only changes for external edits.
      try {
        workspace.value = { ...workspace.value, entries: await request<Entry[]>('workspace.list', { path: '' }) }
        treeVersion.value++
      } catch { /* the project may have closed mid-flight */ }
      await syncFromDisk()
    }, 400)
  }
  watch(() => fsChanges.version, value => { if (value !== lastFsVersion) { lastFsVersion = value; void onFsChanges() } })
  // `workspace/applyEdit` (a quick fix or organize-imports) writes the file natively:
  // the buffer must follow, or the editor keeps showing text that is no longer on disk.
  watch(() => lspEdited.version, async () => {
    const path = lspEdited.path
    if (!path) return
    const tab = findTab(path)
    if (!tab) return
    try {
      const doc = await request<DocumentData>('file.read', { path })
      tab.content = doc.content
      tab.version = doc.version
      tab.readOnly = doc.readOnly
      tab.dirty = false
      editorFor(path)?.setDraft(doc.content)
      // 语言服务改了正文（上游 documentChanged 的那一档，程序性改写照样换号）⇒ 这一篇要换号。
      bumpDocumentRevision(path)
      deps.notify(`「${path}」已被语言服务修改，编辑器已重新载入。`)
    } catch (error) { deps.notify(`语言服务改动了「${path}」，但重新载入失败：${errorMessage(error)}`, true) }
  })
  // A terminal the debug adapter opened (runInTerminal) belongs in the Terminal tool
  // window — the host already spawned it, the UI just has to show it.
  watch(() => termOpened.version, async () => {
    if (!termOpened.id) return
    showOutput('terminal')
    await nextTick()
    const panel = terminalPanelRef.value as unknown as { adopt?: (id: number, label?: string) => void } | null
    panel?.adopt?.(termOpened.id, termOpened.cwd ? `调试终端 · ${termOpened.cwd.split(/[\\/]/).pop() || termOpened.cwd}` : undefined)
  })
  // The directory watcher died and was restarted (or gave up): say so instead of letting
  // the file tree silently go stale.
  watch(() => watchStopped.version, () => {
    if (!watchStopped.reason) return
    deps.notify(watchStopped.restarting
      ? `文件监听已重启（原因：${watchStopped.reason}，第 ${watchStopped.attempt} 次）。`
      : `文件监听已停止：${watchStopped.reason}。文件树不再自动刷新，重新打开项目可恢复。`, !watchStopped.restarting)
  })
  // Local-history snapshot failures arrive as events (file.write must not block on
  // them); surface the newest one as a non-error toast.
  watch(() => historyNotes.length, () => {
    const note = historyNotes[historyNotes.length - 1]
    if (note) deps.notify(`本地历史快照失败（${note.path}）：${note.message}。本次保存不受影响。`, true)
  })
  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return
    const controls = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  watch(theme, value => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
    setNativeTheme(value)
  }, { immediate: true })
  // IDEA "Use contrast scrollbars": a thicker, high-contrast scrollbar.
  // IDEA mainMenuDisplayMode: one markup, three layouts — the menu bar stays where it
  // is and CSS decides whether it sits inline, wraps to its own row, or is hidden
  // behind a hamburger button.
  // IDEA's hamburger menu: one button that opens every menu group in a single popup.

  // 计时器的清理属于本域（宿主原来在 onBeforeUnmount 里直接清 `fsWatchTimer`，
  // 那是本模块私有的变量 —— 现在由这里负责）。
  function dispose() {
    stopBackgroundRefresh()
    if (fsWatchTimer !== undefined) { window.clearTimeout(fsWatchTimer); fsWatchTimer = undefined }
  }

  return {
    dispose,
    performDiskSync, syncFromDisk, syncTabOnActivation, forceReloadFromDisk, noteActivity, backgroundRefreshOnce,
    startBackgroundRefresh, stopBackgroundRefresh, onWindowFocus, onVisibility, onFsChanges, trapFocus,
  }
}
