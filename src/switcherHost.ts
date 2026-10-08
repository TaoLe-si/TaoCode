// **Ctrl+Tab 切换器的宿主** —— 把 `src/switcher.ts` 的纯模型接到 UI 上的那一层：
// 开/关、Tab 走位、速度搜索、Ctrl 松手提交、Esc 取消。
//
// 上游那套是 `Switcher.SwitcherPanel`（Swing 弹窗）+ `SwitcherKeyReleaseListener`
// （`SwitcherActions.kt` 末尾：Alt/Ctrl/Meta **松手**就提交）+ `SwitcherSpeedSearch`。
// 本仓的按键与弹窗组件由装配层（`src/keymap.ts` 的手势 + 一个弹层组件）提供，
// 这一模块只保留**可测的状态机**，让判据不必依赖 DOM。
//
// 按键语义（逐条对齐上游）：
//   · `start(forward)` —— 上游 `ShowSwitcherForwardAction`/`Backward`：打开并选中"不是当前标签"的
//     那一个（`getFilesSelectedIndex`），所以按一下 Ctrl+Tab 立刻松手 = 切到上一个文件；
//   · `go(forward)` —— 上游 `SwitcherIterateThroughItemsAction`（按住 Ctrl 连按 Tab）；
//   · `commit()` —— 上游 `SwitcherKeyReleaseListener.keyReleased`：Ctrl 松手即切；
//   · `cancel()` —— 上游 `SwitcherPanel.cancel()`（Esc / 点空白）。
//
// 判据：`tests/switcher-host.test.mjs`。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  collectSwitcherItems, currentSwitcherItem, filterSwitcherItems, initialSwitcherIndex, switcherStep,
  type SwitcherItem, type SwitcherItemList, type SwitcherCursor, type SwitcherSources,
} from './switcher.ts'

export interface SwitcherHostDeps {
  /** 每次打开时取当前来源（编辑器历史 / 最近文件 / 工具窗口）。 */
  sources: () => SwitcherSources
  /** 提交：切到选中的条目（文件走打开、工具窗口走 showView）。 */
  commit: (item: SwitcherItem) => void
}

export interface SwitcherHost {
  /** 弹层是否打开。 */
  open: Ref<boolean>
  /** 速度搜索输入（上游 `SpeedSearch` 的前缀）。 */
  query: Ref<string>
  /** 「只看已编辑」（recent-files 切换器的复选框；本仓记在宿主里，跨打开保留）。 */
  onlyEdited: Ref<boolean>
  /** 当前两张表的条目（已按 `query` 过滤）。 */
  files: ComputedRef<SwitcherItem[]>
  toolWindows: ComputedRef<SwitcherItem[]>
  /** 光标（在哪张表、第几项）。 */
  cursor: Ref<SwitcherCursor>
  /** 当前选中的条目（null = 空表）。 */
  current: ComputedRef<SwitcherItem | null>
  start: (forward: boolean) => void
  go: (forward: boolean) => void
  setQuery: (prefix: string) => void
  toggleOnlyEdited: () => void
  /** 提交（Ctrl 松手 / 回车）：切到当前条目并关闭。 */
  commitSelection: () => SwitcherItem | null
  /** 取消（Esc / 点空白）：关闭且不切换。 */
  cancel: () => void
}

export function createSwitcherHost(deps: SwitcherHostDeps): SwitcherHost {
  const open = ref(false)
  const query = ref('')
  const onlyEdited = ref(false)
  const cursor = ref<SwitcherCursor>({ list: 'files', index: 0 })
  const raw = ref<SwitcherItemList>({ items: [], toolWindows: [] })

  const files = computed(() => filterSwitcherItems(raw.value.items, query.value))
  const toolWindows = computed(() => filterSwitcherItems(raw.value.toolWindows, query.value))
  const current = computed(() => currentSwitcherItem({ items: files.value, toolWindows: toolWindows.value }, cursor.value))

  function reload(forward: boolean) {
    const sources = deps.sources()
    const options: SwitcherSources = onlyEdited.value ? { ...sources, onlyEditedFiles: sources.onlyEditedFiles } : sources
    raw.value = collectSwitcherItems(options)
    const index = initialSwitcherIndex(raw.value.items, sources.currentPath, forward)
    cursor.value = { list: 'files', index: index > -1 ? index : 0 }
  }

  function start(forward: boolean) {
    query.value = ''
    reload(forward)
    open.value = true
  }

  function go(forward: boolean) {
    if (!open.value) return
    cursor.value = switcherStep(cursor.value, files.value.length, toolWindows.value.length, forward)
  }

  /** 速度搜索：过滤后原索引可能越界，夹回表内（上游 `FilteringListModel` 过滤后选区自动收拢）。 */
  function setQuery(prefix: string) {
    query.value = prefix
    const items = files.value
    const windows = toolWindows.value
    const count = cursor.value.list === 'files' ? items.length : windows.length
    if (cursor.value.index >= count) cursor.value = { list: cursor.value.list, index: Math.max(count - 1, 0) }
  }

  function toggleOnlyEdited() {
    onlyEdited.value = !onlyEdited.value
    reload(true)
  }

  function commitSelection(): SwitcherItem | null {
    const item = current.value
    open.value = false
    if (item) deps.commit(item)
    return item
  }

  function cancel() {
    open.value = false
  }

  return { open, query, onlyEdited, files, toolWindows, cursor, current, start, go, setQuery, toggleOnlyEdited, commitSelection, cancel }
}
