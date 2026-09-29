// 工具窗口列表的**速度搜索**（IDEA `SpeedSearch`）。纯逻辑，无 DOM。
//
// 上游三块，缺一不可：
//   1) 动作 `SpeedSearchAction`（`platform/platform-impl/src/com/intellij/ide/actions/speedSearch/SpeedSearchAction.kt`）：
//      `update` 里 **`isVisible = 有 handler`**、`isEnabled = 有 handler && 可用 && 未激活`（`:29-37`），
//      所以列表不在场时这一行根本不该出现（本仓据此决定 Ctrl+F 走谁）。
//   2) 键位：`use-shortcut-of="Find"`（`platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:157-160`）
//      ⇒ 与 Find in Path **同一个 Ctrl+F**。两者同时可触发时靠 `SpeedSearchActionPromoter`
//      （`.../speedSearch/SpeedSearchActionPromoter.kt:9-11`，`sortedBy { it is SpeedSearchAction }`）
//      把速度搜索排在前面 —— 也就是**焦点在列表上时 Ctrl+F 归速度搜索**，在编辑器里才归 Find in Path。
//   3) 匹配与键盘：`SpeedSearchBase.java` —— 用 `MinusculeMatcher`（驼峰子串，见下）判定命中；
//      键盘归属 `:958-1002`：Enter/PageUp/PageDown/左右键**交给列表**（非 sticky 时先收起搜索框）、
//      Esc 隐藏搜索框、Backspace 在空串时**吞掉**（不把焦点弹出去）、上下键永远归列表。
//
// 命中后是**选中那一行**（`SpeedSearchBase.java:679` `selectElement(findElement(query)…)`），
// 不是把不匹配的行藏起来 —— 树侧装的是 `TreeSpeedSearch`
// （`platform/platform-impl/src/com/intellij/ui/TreeSpeedSearch.java:204`，项目视图在
// `platform/lang-impl/src/com/intellij/ide/projectView/impl/AbstractProjectViewPaneWithAsyncSupport.java:177` 装它），
// `selectElement` 还会把折叠的祖先**展开**再选中。本仓树是扁平化的可见行列表，所以"展开"落在 `reveal` 回调上。

/**
 * `MinusculeMatcher` 的判定（`platform/util/text-matching/src/com/intellij/psi/codeStyle/MinusculeMatcherImpl.kt`）：
 * 大小写不敏感的子序列，但**大写字母必须落在词首**（`isWordStart`，`:303-305`），
 * 换句话说 `abc` 命中 `aBc`/`Abc`/`abc`，`aB` 命中 `aB`/`aBC` 却**不**命中 `abC`。
 * `*` 是通配：`SpeedSearchComparator` 默认 `shouldMatchFromTheBeginning = false`
 * （`platform/platform-impl/src/com/intellij/ui/SpeedSearchComparator.java:30-32`），
 * 也就是 pattern 前面自动补一个 `*`（`:59-61`）—— 于是"从中间开始匹配"是默认行为。
 */
export function isWordStartAt(text: string, index: number): boolean {
  if (index <= 0) return true
  const previous = text[index - 1]!
  const current = text[index]!
  if (!/[A-Za-z0-9]/.test(previous)) return true
  return /[A-Z]/.test(current) && /[a-z0-9]/.test(previous)
}

/** `MinusculeMatcher.match(name)`（`:112-125`）：命中返回 true。空 pattern 命中一切（`SpeedSearchBase` 的空串语义）。 */
export function speedSearchMatches(pattern: string, text: string): boolean {
  const query = pattern.trim()
  if (!query) return true
  if (query === '*') return true
  let cursor = 0
  for (const character of query) {
    if (character === '*') continue
    let found = -1
    for (let index = cursor; index < text.length; index++) {
      if (text[index]!.toLowerCase() !== character.toLowerCase()) continue
      // 大写字母必须落在词首（`:303-305` 的 isUpperCaseOrDigit 分支）。
      if (/[A-Z]/.test(character) && !isWordStartAt(text, index)) continue
      found = index
      break
    }
    if (found < 0) return false
    cursor = found + 1
  }
  return true
}

/** 在一列文本里找**第一条**命中的下标；没有则 -1（`SpeedSearchBase.findElement`，`:519`）。 */
export function firstSpeedSearchHit(labels: readonly string[], pattern: string): number {
  const query = pattern.trim()
  if (!query) return -1
  return labels.findIndex(label => speedSearchMatches(query, label))
}

/** `SpeedSearchBase.findFirstElement`（`:696-706` 的 Home/End 分支）：从头/从尾起找第一条命中。 */
export function lastSpeedSearchHit(labels: readonly string[], pattern: string): number {
  const query = pattern.trim()
  if (!query) return -1
  for (let index = labels.length - 1; index >= 0; index--) if (speedSearchMatches(query, labels[index]!)) return index
  return -1
}

/**
 * 从当前行继续找下一条命中，**先迈一步再找、走完一圈回绕**（`SpeedSearchBase.findNextElement`，
 * `:476-516`）。`from < 0`（还没有当前项）时从列表头/尾起步。
 * 只有当前这一条命中时，绕完一圈仍会回到它 —— 这与上游"找不着就停在原地"的表现一致。
 */
export function nextSpeedSearchHit(labels: readonly string[], pattern: string, from: number, delta: 1 | -1): number {
  const query = pattern.trim()
  const count = labels.length
  if (!query || !count) return -1
  const origin = from < 0 ? (delta > 0 ? -1 : 0) : from
  for (let step = 1; step <= count; step++) {
    const index = (((origin + delta * step) % count) + count) % count
    if (speedSearchMatches(query, labels[index]!)) return index
  }
  return -1
}

/**
 * `SpeedSearchBase.java:958-1002` + `:683-706` —— 按键归谁。
 * - 上下键/Home/End：**搜索框自己处理**（`:684-691`），在命中项之间移动（Home/End = 第一条/最后一条）。
 * - Enter / PageUp / PageDown / 左右键：把搜索框收起来、焦点交回列表（`:964-975`）。
 * - Esc：只隐藏搜索框（`:976-980`）。
 * - 空串上的退格：吞掉，不让焦点从搜索框弹回列表（`:960-963`）。
 */
export type SpeedSearchKeyAction = 'navigate' | 'hide' | 'accept' | 'ignore'

export function speedSearchKeyAction(key: string, query: string): SpeedSearchKeyAction {
  if (key === 'Escape') return 'hide'
  if (key === 'Enter' || key === 'PageUp' || key === 'PageDown' || key === 'ArrowLeft' || key === 'ArrowRight') return 'accept'
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') return 'navigate'
  // 空串上的退格要吞掉：不然焦点会从搜索框弹回列表（`:960-963`）。
  if (key === 'Backspace' && !query) return 'ignore'
  return 'ignore'
}

/** `findTargetElement`（`:695-706`）—— 上下/Home/End 各自要去的位置。 */
export type SpeedSearchStep = { kind: 'next' } | { kind: 'previous' } | { kind: 'first' } | { kind: 'last' }

export function speedSearchStepForKey(key: string): SpeedSearchStep | null {
  if (key === 'ArrowDown') return { kind: 'next' }
  if (key === 'ArrowUp') return { kind: 'previous' }
  if (key === 'Home') return { kind: 'first' }
  if (key === 'End') return { kind: 'last' }
  return null
}

/** 搜索框里的空提示 = `editorsearch.search.hint`（`ApplicationBundle.properties:661` = `Search`）。 */
export const SPEED_SEARCH_HINT = '搜索'
