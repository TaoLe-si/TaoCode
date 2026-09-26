// Tool-window numbering and ordering, ported from IDEA.
//
// IDEA binds Alt+<digit> to a tool window through the *keymap*: the mnemonic shown on a
// stripe button is the digit of the shortcut registered for `Activate<Id>ToolWindow`
// (ActivateToolWindowAction.kt:88-111) and StripeButton prints it as "<digit>: <title>"
// (StripeButton.kt:287-298). The number therefore belongs to the tool window itself and
// never to its position on a stripe, so dragging stripe buttons around must not renumber
// anything — which is why the mnemonic order is a separate, constant list rather than the
// draggable order the layout renders with.

/** The Alt+<digit> a tool window answers to, or undefined when it is not numbered. */
export function mnemonicOf(order: readonly string[], id: string): string | undefined {
  const index = order.indexOf(id)
  return index === -1 ? undefined : String(index + 1)
}

/** Alt+<digit> → tool window. Aliases win over the positional numbers. */
export function mnemonicBindings<T extends string>(order: readonly T[], aliases: Readonly<Record<string, T>> = {}): Record<string, T> {
  const bindings: Record<string, T> = { ...aliases }
  order.forEach((id, index) => {
    const digit = String(index + 1)
    if (!(digit in bindings)) bindings[digit] = id
  })
  return bindings
}

/**
 * StringUtil.naturalCompare: digit runs compare as numbers, everything else compares as
 * plain code units. It is deliberately not a collation (no pinyin, no accents), because
 * that is what IDEA sorts stripe titles with (ToolWindowsWidget.java:168).
 */
export function naturalCompare(a: string, b: string): number {
  const parts = (value: string): string[] => value.match(/\d+|\D+/g) ?? []
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index]
    const y = right[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numeric = /^\d/.test(x) && /^\d/.test(y)
    const compared = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0
    if (compared !== 0) return compared
  }
  return 0
}

/** The order the ToolWindowsWidget popup lists windows in: by stripe title (:163-168). */
export function sortedByTitle<T>(items: readonly T[], title: (item: T) => string): T[] {
  return [...items].sort((left, right) => naturalCompare(title(left), title(right)))
}
