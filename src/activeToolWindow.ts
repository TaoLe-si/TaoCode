// Which tool window F12 brings back, ported from IDEA's `ActiveStack` + `JumpToLastWindowAction`.
//
// IDEA keeps *two* stacks of activated tool windows (`ActiveStack.java:15-95`): a short one that
// is cleared whenever the editor is activated (it only serves "reactivate after a sibling was
// closed") and a persistent one that is never cleared. `JumpToLastWindowAction` reads the
// persistent one — `ToolWindowManagerImpl.kt:746-747`, `lastActiveToolWindowId` — so that is the
// only stack ported here; the short one has no consumer in TaoCode.
//
// The rules below are the source's, not invented:
// - `push` moves an id that is already in the stack to the top instead of adding a second copy
//   (`ActiveStack.push` :64-68 removes it first, then pushes onto both stacks).
// - Hiding a tool window does *not* drop it from the persistent stack: `setHiddenState`
//   (:711-718) calls `remove(entry, false)`, and `false` means "leave the persistent stack
//   alone". F12 therefore has to reopen a window the user closed, which is the whole point of
//   `action.JumpToLastWindow.description` ("Activate the last focused tool window").
// - Only unregistering a tool window removes it for good (`:1217`, `remove(entry, true)`).
// - The target is the top-most *available* id, not simply the top id: `:746-747` takes the first
//   of `getLastActiveToolWindows()`, which filters on `it.isAvailable` (:749-753). The action's
//   own `update()` (`JumpToLastWindowAction.java:32-44`) disables itself with the same test.
//
// An empty stack means "no tool window has been activated yet in this session", so F12 must do
// nothing at all rather than guess — same as the action being disabled.

/**
 * `ActiveStack.push` (:64-68). Returns a new array whose last element is the newest activation,
 * mirroring `peekPersistent(0)` = `stack.get(size - 1)`.
 */
export function pushActive(stack: readonly string[], id: string): string[] {
  const next = stack.filter(entry => entry !== id)
  next.push(id)
  return next
}

/** `ActiveStack.remove` (:89-94) — order of the survivors is preserved. */
export function removeActive(stack: readonly string[], id: string): string[] {
  return stack.filter(entry => entry !== id)
}

/**
 * `lastActiveToolWindowId` (`ToolWindowManagerImpl.kt:746-753`): walk the persistent stack from
 * the top down and return the first id that is still available, or `undefined` when none is.
 */
export function lastActiveId(stack: readonly string[], available: (id: string) => boolean): string | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const id = stack[index]
    if (available(id)) return id
  }
  return undefined
}

/**
 * The index `ContentManagerImpl.selectNextContent` / `selectPreviousContent` (:621-646) would
 * select. Both are pure arithmetic on the content count and the current index, and both wrap; the
 * `-1` in the source is "nothing selected", which is why the first *previous* press lands on
 * `count - 2` rather than on the last tab (:626 with `index = -1`). `undefined` mirrors the
 * `LOG.assertTrue(contentCount > 1)` the source asserts on, and the `content == null` bail-out.
 */
export function nextContentIndex(count: number, current: number | undefined, step: 1 | -1): number | undefined {
  if (count <= 1) return undefined
  const index = current === undefined || current < 0 || current >= count ? -1 : current
  const next = step === 1 ? index + 1 : index - 1 + count
  return next % count
}

/**
 * `TabNavigationActionBase`（`platform-impl/.../actions/TabNavigationActionBase.java`）的**目标路由**：
 * 焦点在哪，NextTab / PreviousTab 就在哪里生效，**永不跨 dock**。
 *
 * 上游 `actionPerformed`（`:57-65`）只有两支：
 *   · `toolWindowManager.isEditorComponentActive()` → 走编辑器（`:130-147` 的 `composites`）；
 *   · 否则 `PlatformDataKeys.NONEMPTY_CONTENT_MANAGER.getData(...)`（`:64`）→ 走**当前聚焦那个**
 *     工具窗口自己的 ContentManager（`InternalDecoratorImpl.kt:648` 把它塞进 data context）。
 *
 * 可用性判据（`:106` 与 `:81-87`）是 `contentCount > 1 && isSingleSelection()`：
 * **侧栏窗口只有一条内容**，所以那一支的 count 恒为 1 ⇒ 动作灰着。本仓原来是
 * "不是编辑器就当底部" ⇒ 焦点在项目树里按 Alt+→ 会去切底部 dock 的标签（用户没在看的面板）。
 */
export type TabNavigationTarget = 'editor' | 'side' | 'bottom'

/**
 * 该目标上有几个可切的标签（上游 `getContentCount()`）。
 * 侧栏恒 1（单内容窗口 ⇒ 动作灰着，与 `:106` 的 `contentCount > 1` 一致），
 * 编辑器是当前分组的标签数，底部是那排内容标签数。
 */
export function tabNavigationCount(focused: TabNavigationTarget, editorTabs: number, bottomTabs: number): number {
  if (focused === 'editor') return editorTabs
  if (focused === 'side') return 1
  return bottomTabs
}
