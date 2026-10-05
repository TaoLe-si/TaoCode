// 行内监视的**接线**（状态 + 推进编辑器），规则在 `src/debugInlineWatch.ts`。
//
// 为什么单独成模块：Debug 面板有 900 行机检上限（`tests/module-size.test.mjs`），
// 而行内监视要接的面有五处（面板的监视列表、当前帧锚点、每次停住重算、会话结束清空、
// 编辑器扩展的推进），全塞进组件会把组件顶爆。这里只留「面板要提供哪几个输入」的契约。
//
// 挂点说明：编辑器组件本轮冻结，推进走的是它**已经**装好的 `debugLineExtension`
// （`src/editorDebugLine.ts` 的 `setDebugInlineWatches`），所以不需要改 CodeEditor.vue。
//
// 与上游的如实差异：上游 `InlineWatch` 的重锚靠 `RangeMarker` 跟着文档偏移走
// （`InlineWatch.kt:70-72`），本仓编辑器与面板之间没有 RangeMarker 通道，
// 所以文档改动后**不重锚**（行号变了就画错位置的风险由 `line > state.doc.lines` 的上界挡住，
// 超出即不画）。这是如实的能力边界，不是假装支持。
import { ref, type Ref } from 'vue'
import { setDebugInlineWatches, setInlineWatchExpressionEditor } from './editorDebugLine.ts'
import {
  addInlineWatch, inlineWatchText, removeInlineWatch, visibleInlineWatches, type InlineWatchSpec,
} from './debugInlineWatch.ts'

export interface InlineWatchDeps {
  /** 面板的监视列表（表达式 + 已算出的值）。按表达式匹配取值，所以同一表达式只有一条。 */
  watches: Ref<readonly { text: string; value: string }[]>
  /**
   * 当前帧的锚点（文件 + 1 基行号）；**没停住 / 没有当前帧就是 null** ——
   * 这与上游「只在同一文件暂停时求值」同一口径（`InlineWatch.kt:13-16`），
   * 也让 `sync()` 在会话结束时把行内监视一并清掉。
   */
  anchor: () => { path: string; line: number } | null
  /**
   * 就地编辑提交后改监视的名字（上游 `InlineWatchInplaceEditor.doOKAction` 走的就是
   * Watches 管理器那条改名路，`InlineWatchInplaceEditor.java:77-96`）。
   * 面板没给这条 ⇒ 行内监视依旧**不可点**（`canEditInlineWatch()` 为假），不画假编辑面。
   */
  renameWatch?: (from: string, to: string) => void
}

export function useInlineWatches(deps: InlineWatchDeps) {
  const inlineWatches = ref<InlineWatchSpec[]>([])

  /** 这条表达式此刻是不是画在某处（用来给按钮切「行内」高亮态）。 */
  function isShown(expression: string): boolean {
    const at = deps.anchor()
    if (!at) return false
    return inlineWatches.value.some(watch => watch.expression === expression && watch.path === at.path && watch.line === at.line)
  }

  /**
   * 行内监视的加/删（上游把监视画进编辑器的那一步）：在**当前帧**的位置加一条，
   * 已经在同一位置的同一条则移除。越限/去重由 `addInlineWatch` 判（`INLINE_WATCH_LIMIT`）。
   */
  function toggle(expression: string): void {
    const at = deps.anchor()
    const trimmed = expression.trim()
    if (!at || !trimmed) return
    const spec: InlineWatchSpec = { expression: trimmed, path: at.path, line: at.line }
    inlineWatches.value = isShown(trimmed)
      ? removeInlineWatch(inlineWatches.value, spec)
      : addInlineWatch(inlineWatches.value, spec)
    sync()
  }

  /**
   * 就地编辑一条行内监视的表达式（上游点行内监视 ⇒ `EditInlineWatch` ⇒
   * `showInplaceEditor(...)`，`XDebuggerTreeInlayPopup.java:53-61`/`:107-118`）：
   * 改的是**同一条监视的名字**，所以行内规格与面板的监视列表要一起改，改完重算。
   */
  function rename(from: string, to: string): void {
    const expression = to.trim()
    if (!expression) return
    inlineWatches.value = inlineWatches.value.map(watch =>
      watch.expression === from ? { ...watch, expression } : watch)
    deps.renameWatch?.(from, expression)
    sync()
  }

  /**
   * 把当前该画的那几条推进编辑器。每次停住后重算监视值时调一次即可 ——
   * 行的位置来自锚点，文本来自面板刚算出的监视值，两者都是这条通道上已有的数据。
   */
  function sync(): void {
    const at = deps.anchor()
    if (!at) { setDebugInlineWatches(null); return }
    const visible = visibleInlineWatches({ watches: inlineWatches.value, pausedPath: at.path })
    const items = visible.map(watch => ({
      line: watch.line,
      expression: watch.expression,
      text: inlineWatchText(watch, deps.watches.value.find(entry => entry.text === watch.expression)?.value),
    }))
    setDebugInlineWatches(items.length ? { path: at.path, items } : null)
  }

  /** 会话结束 / 面板卸载：清掉编辑器里的行内监视（锚点已是 null，`sync()` 亦可，但这里显式清）。 */
  function clear(): void {
    inlineWatches.value = []
    setDebugInlineWatches(null)
  }

  // 面板给了改名通道才把「点击即编辑」打开（没有通道时行内监视不可点 —— 不画假控件）。
  if (deps.renameWatch) setInlineWatchExpressionEditor((from, to) => rename(from, to))

  return { inlineWatches, isShown, toggle, rename, sync, clear }
}
