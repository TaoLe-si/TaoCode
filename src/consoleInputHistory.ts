// 控制台输入框的历史（上游 `CommandHistory` + `HistoryKeyListener`，
// `platform/lang-impl/src/com/intellij/execution/console/history/`）。
//
// 上游的行为（HistoryKeyListener.kt:44-102）：上键从「还没回看」的位置（history.size）往回翻，
// 第一次翻之前把当前输入记为「未完成的命令」；翻到顶再按上键停住；下键翻回，越过最后一条时
// 恢复「未完成的命令」；有新条目进来时游标重置到末尾、未完成命令清空。
// 本仓的 stdin 输入框在 App.vue（本批冻结），所以这里做成**可挂到元素上的监听器**，
// 由 `src/runActions.ts`（它持有 runInput ref）在元素出现时挂上、发送时 push —— 不需要改 App.vue。
//
// 纯函数（createCommandHistory）与 DOM 绑定（attachInputHistory）分开，判据 tests/console-input.test.mjs。

/** 历史条目上限（上游没有硬上限；本仓按控制台缓冲的同一思路限长，防止长会话吃内存）。 */
export const INPUT_HISTORY_LIMIT = 200

export interface CommandHistory {
  readonly size: number
  at(index: number): string
  /** 记一条（空串不记）；游标重置到末尾（上游 onNewEntry）。 */
  push(entry: string): void
  /** 上键：返回要显示的文本；未回看时先记下 unfinished。没有历史返回 null。 */
  up(current: string): string | null
  /** 下键：返回要显示的文本；已在末尾返回 null（调用方保持原值）。 */
  down(): string | null
  /** 当前游标（测试/调试用；等于 size 表示"不在历史里"）。 */
  readonly position: number
  readonly unfinished: string
}

export function createCommandHistory(limit = INPUT_HISTORY_LIMIT): CommandHistory {
  const entries: string[] = []
  let position = 0
  let unfinished = ''
  const history: CommandHistory = {
    get size() { return entries.length },
    get position() { return position },
    get unfinished() { return unfinished },
    at(index) { return entries[index] ?? '' },
    push(entry) {
      if (!entry.trim()) return
      entries.push(entry)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
      // 上游 onNewEntry：新条目进来时游标回到末尾，未完成命令作废。
      position = entries.length
      unfinished = ''
    },
    up(current) {
      if (!entries.length) return null
      if (position === entries.length) unfinished = current
      position = Math.max(position - 1, 0)
      return entries[position] ?? null
    },
    down() {
      if (position === entries.length) return null
      position = Math.min(position + 1, entries.length)
      return position === entries.length ? unfinished : entries[position] ?? null
    },
  }
  return history
}

/** 监听器要的元素面（便于测试传桩；真实调用传 input 元素）。 */
export interface ConsoleInputElement {
  value: string
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void
}

/** 把 up/down 绑到输入框；返回解绑函数（元素被替换时调用）。 */
export function attachInputHistory(input: ConsoleInputElement, history: CommandHistory): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    // 带修饰键的上下键另有含义（选择/滚动），不抢（上游 keyExactMatch 分支的同义取舍）。
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const next = event.key === 'ArrowUp' ? history.up(input.value) : history.down()
    if (next === null) return
    event.preventDefault()
    input.value = next
    // 光标放到末尾：单行输入里与上游 `moveCaretToEndOnUp` / document 末尾一致。
    const selection = (input as { setSelectionRange?: (start: number, end: number) => void }).setSelectionRange
    if (typeof selection === 'function') selection.call(input, next.length, next.length)
  }
  input.addEventListener('keydown', onKeydown)
  return () => input.removeEventListener('keydown', onKeydown)
}
