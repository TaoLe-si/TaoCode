// LSP `textDocument/moniker` —— 符号的**稳定标识**。
//
// IDEA 侧的用户可见落点是 **Copy Reference**：
//   · `CopyReferenceAction`（`platform/lang-impl/src/com/intellij/ide/actions/CopyReferenceAction.java:41`）
//   · 复制到剪贴板走 `actionPerformed`（`:104`）
//   · 要复制的那串标识由 `getQualifiedName`（`:128`）给出
// 两者语义不完全等同（moniker 是跨工具认同的标识，Copy Reference 是 IDE 内部引用串），
// 但**用户可见结果一致**：拿到一个能定位到这个符号的字符串并复制走。
//
// 关键取舍：`unique` 必须当真。`unique: true` 才是"能唯一定位"的引用；
// `unique: false` 表示同名符号可能有多个 —— 可以复制，但**必须告诉用户它不唯一**，
// 不能假装它是精确引用。

export interface Moniker {
  /** 标识本身（`CopyReferenceAction.getQualifiedName` 那串）。没有它就没有可复制的东西。 */
  identifier: string
  /** 标识体系（如 `taocode` / `ts`）。 */
  scheme?: string
  /** 是否在整个方案里唯一。 */
  unique?: boolean
}

export interface MonikerResult {
  available: boolean
  monikers?: Moniker[]
}

/**
 * 复制哪一个：优先 `unique: true` 的第一条（那才是精确引用），
 * 没有就退回第一条（并在提示里说明它不唯一）。
 */
export function primaryMoniker(monikers: readonly Moniker[] | undefined): Moniker | undefined {
  if (!Array.isArray(monikers)) return undefined
  const usable = monikers.filter(moniker => moniker && typeof moniker.identifier === 'string' && moniker.identifier !== '')
  return usable.find(moniker => moniker.unique === true) ?? usable[0]
}

/** 复制到剪贴板的文本。 */
export function referenceText(moniker: Moniker | undefined): string {
  return moniker?.identifier ?? ''
}

/** 复制后的提示。IDEA 的 Copy Reference 也有确认（剪贴板状态用户看不见）。 */
export function describeCopiedReference(moniker: Moniker | undefined): string {
  if (!moniker?.identifier) return ''
  const suffix = moniker.unique === false ? '（注意：这个标识不唯一，可能有同名符号）' : ''
  return `已复制引用 ${moniker.identifier}${suffix}`
}
