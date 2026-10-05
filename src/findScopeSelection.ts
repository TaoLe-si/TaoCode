// 作用域下拉的选择解析（上游 `FindPopupScopeUIImpl` 的 `ScopeChooserCombo` +
// `NamedScopesHolder.getScope`，`platform/lang-impl/src/com/intellij/find/impl/FindPopupScopeUIImpl.java:137-176`）。
//
// 两处边界（上游靠组合框与 `InvalidPackageSet` 兜住，本仓要自己在解析层说清楚）：
//   1. **名字已经不在表里**（作用域被删/改名）：`NamedScopesHolder.getScope` 返回 null ⇒ 上游显示为空、
//      等价于「项目」范围。本仓解析成 `name: ''`，组件据此把下拉拨回「项目」，**不是**悄悄按旧模式搜。
//   2. **名字在、模式解析不了**：上游 `NamedPackageSetReference.contains` 恒 false（`scopes.ts:483-495`
//      的 `scopeLookup` 同一口径）—— 显示 0 命中也不退回"全项目"；错误消息与位置留着给界面提示
//      （`ScopeEditorPanel.onTextChange`，`scopes.ts:496-507` 的 `compileScopeText` 已给）。

import { compileScopeText, type ScopeSet } from './scopes.ts'

export interface ScopeResolution {
  /** 实际使用的名字；空串 = 「项目」（不限定）。名字失配时回落为空串。 */
  name: string
  /** 求值用集合；null = 不限定（项目）。坏模式是 `invalid` 集合（恒不匹配），不是 null。 */
  set: ScopeSet | null
  /** 模式解析错误（坏模式时非 null）。 */
  error: string | null
  /** 错误位置（上游 `label.scope.editor.caret.position` 用的那个下标）。 */
  position: number | null
}

export function resolveScopeSelection(
  name: string,
  entries: readonly { name: string; pattern: string }[],
): ScopeResolution {
  if (!name) return { name: '', set: null, error: null, position: null }
  const entry = entries.find(item => item.name === name)
  if (!entry) return { name: '', set: null, error: null, position: null }
  const compiled = compileScopeText(entry.pattern)
  return { name, set: compiled.set, error: compiled.error, position: compiled.position }
}

/** 坏模式那行提示（本仓呈现；上游是作用域编辑器里的红色状态栏）。 */
export function scopeWarningText(resolution: ScopeResolution): string {
  if (!resolution.error) return ''
  const at = resolution.position === null ? '' : `（位置 ${resolution.position + 1}）`
  return `作用域的模式无法解析${at}：${resolution.error}；本次结果为空。`
}
