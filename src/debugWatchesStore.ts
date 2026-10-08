// 监视列表的**状态与操作**（从 `DebugPanel.vue` 抽出来的一层）——
// 上游 `XWatchesView` / `XWatchesViewImpl` 里"列表本身"的那一半：
// 新增/移除/上移/下移/全清/暂停求值/改名（就地编辑行内监视走同一条改名路），
// 加上跨会话持久化（`XDebuggerWatchesManagerImpl.saveState/loadState`，见 `src/debugWatches.ts`）。
//
// 为什么单独成模块：`DebugPanel.vue` 贴着 900 行机检上限，本批要补四个动作
// （`XMoveWatchUp`/`XMoveWatchDown`/`XRemoveAllWatchesAction`/`XPauseWatchAction`，
// 规则在 `src/debugWatchActions.ts`）。这里只留"面板要提供哪几个输入"的契约。
import { ref, watch, type Ref } from 'vue'
import { DEBUG_WATCHES_LIMIT, loadWatches, saveWatches } from './debugWatches.ts'
import { moveWatchDown, moveWatchUp, removeAllWatches, toggleWatchPause, type WatchEntry } from './debugWatchActions.ts'

export interface DebugWatchDeps {
  /** localStorage（`typeof localStorage === 'undefined'` 时为 null）。 */
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null
  /** 项目根（持久化分键用；空 = 应用级一份）。 */
  root: () => string
  /** 停住时对每条监视求一次值（`DebugPanel.refreshWatches`）。 */
  recompute: () => void
  /** 清空时顺带撤掉行内监视（`XWatchesViewImpl.removeAllWatches` 连行内一起清）。 */
  onClear?: () => void
}

export function useDebugWatches(deps: DebugWatchDeps) {
  const watches = ref<WatchEntry[]>(loadWatches(deps.storage, deps.root()).map(text => ({ text, value: '' })))
  // 只存表达式文本（值随会话变），与 `src/debugWatches.ts` 同一口径。
  watch(watches, list => saveWatches(deps.storage, deps.root(), list.map(entry => entry.text).slice(0, DEBUG_WATCHES_LIMIT)), { deep: true })

  /** 加一条（`XNewWatchAction` / `XAddToWatchesTreeAction`）：去重、非空、加完立刻求值。 */
  function add(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed || watches.value.some(entry => entry.text === trimmed)) return false
    watches.value.push({ text: trimmed, value: '' })
    deps.recompute()
    return true
  }
  /** 移除一条（`XRemoveWatchAction`）。 */
  function remove(text: string) { watches.value = watches.value.filter(entry => entry.text !== text) }
  /** 上移/下移（`XMoveWatchUp`/`XMoveWatchDown`）。 */
  function move(text: string, direction: 'up' | 'down') {
    watches.value = direction === 'up' ? moveWatchUp(watches.value, text) : moveWatchDown(watches.value, text)
  }
  /** 全清（`XRemoveAllWatchesAction`）。 */
  function removeAll() {
    deps.onClear?.()
    watches.value = removeAllWatches()
  }
  /** 暂停/恢复一条的求值（`XPauseWatchAction`）：恢复时立刻重算。 */
  function togglePause(text: string) {
    watches.value = toggleWatchPause(watches.value, text)
    deps.recompute()
  }
  /** 就地编辑行内监视提交后改名（上游 `InlineWatchInplaceEditor.doOKAction` 走 Watches 管理器那条改名路）。 */
  function rename(from: string, to: string): boolean {
    const trimmed = to.trim()
    if (!trimmed || watches.value.some(entry => entry.text === trimmed)) return false
    watches.value = watches.value.map(entry => entry.text === from ? { text: trimmed, value: '' } : entry)
    deps.recompute()
    return true
  }
  /** 值回填（`refreshWatches` 算完一条后写回；暂停的那条不动）。 */
  function setValue(text: string, value: string) {
    const entry = watches.value.find(item => item.text === text)
    if (entry) entry.value = value
  }
  return { watches, add, remove, move, removeAll, togglePause, rename, setValue }
}

export type DebugWatches = ReturnType<typeof useDebugWatches>
/** 供组件声明类型用（`Ref<WatchEntry[]>`）。 */
export type WatchListRef = Ref<WatchEntry[]>