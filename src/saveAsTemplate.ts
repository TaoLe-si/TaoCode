// 「选中文本另存为实时模板」—— 上游 `SaveAsTemplateAction` 的纯逻辑层（2026-10-07 按真文件重核）。
//
// 出处（参考树逐行核过，坐标为真）：
//   · `platform/lang-impl/src/com/intellij/codeInsight/template/actions/SaveAsTemplateAction.java`
//     `:56` `suggestTemplateText`（选区文本的引用规范化）、`:124` `actionPerformed`（建模板 + 弹设置页）、
//     `:167-171` `update()`（可用性门禁）。
//   · 门禁原文（`:171`）：`project != null && editor != null && hasSelection()
//     && !EditorUtil.contextMenuInvokedOutsideOfSelection(e)`。
//     **没有**语言判据、**没有** isWritable/isEventSystemEnabled —— 本仓等价物只有一条：有选区。
//   · `suggestTemplateText`（`:56-115`）做的是**引用规范化**：跳过带限定符的引用、把 canonicalText
//     里的泛型 `<…>` 削掉（仅当选区原文没有 `<`）、XML 时削命名空间前缀，最后 `trim()` 返回。
//     它**不**生成 `$VAR$` 变量。本仓无 PSI ⇒ 选区仅 `trim()`，不做任何引用改写。
//   · `actionPerformed`（`:124-155`）：`new TemplateImpl(TemplateListPanel.ABBREVIATION /* "<abbreviation>" */,
//     text, TemplateSettings.USER_GROUP_NAME /* "user" */)` + `setToReformat(true)`，按光标处文件算出
//     适用上下文并启用，然后弹**非模态**的 Live Templates 设置页，`showNotify` 时把模板加进列表 ——
//     缩写是 `<abbreviation>` 占位符，**留给用户填**。所以本仓草稿的 `key` 同样给空串占位。
//   · 本仓差异（如实登记）：`CustomTemplate`（`src/templates.ts:21`）没有 reformat 槽位，该位丢失；
//     description 上游不设（留空串）；`suggestAbbreviation`/重名加序号是本仓补充的预填便利，
//     供设置页输入框做初始值，不是上游行为。
//   · 模板存储复用本仓 `src/templates.ts` 的 `CustomTemplate` 形状（`{ key, body, description, languages }`）。

import type { Language } from './templates.ts'

/** 一场「另存为模板」的可用性判定输入 —— 上游 `:171` 的本仓等价物。 */
export interface SaveAsTemplateInput {
  /** 选区文本（空串 = 没选东西；上游 `hasSelection()` 对纯空白也放行，这里同上游放行）。 */
  selection: string
}

/** 可用性结论 + 置灰理由（给菜单项的 `title`）。 */
export type SaveAsTemplateAvailability =
  | { available: true }
  | { available: false; reason: 'no-selection' }

/**
 * 上游 `SaveAsTemplateAction.java:171` 门禁的本仓等价物：只有「有选区」一条。
 * 本仓差异（如实登记）：上游还要求 `project != null` 与 `!contextMenuInvokedOutsideOfSelection`，
 * 前者在本仓恒真（单项目宿主），后者属于菜单弹出上下文，本仓菜单系统没有该信号。
 */
export function saveAsTemplateAvailable(input: SaveAsTemplateInput): SaveAsTemplateAvailability {
  if (!input.selection) return { available: false, reason: 'no-selection' }
  return { available: true }
}

/** 上游把选区正文 `trim()` 后入库（`:115` `document.getText().trim()`）；本仓同。 */
export function suggestTemplateText(selection: string): string {
  return selection.trim()
}

/** 模板草稿 —— 形状对齐 `src/templates.ts:21` 的 `CustomTemplate`。 */
export interface TemplateDraft {
  /** 上游 `TemplateListPanel.ABBREVIATION` = `"<abbreviation>"` 占位 ⇒ 本仓给空串，用户在设置页填。 */
  key: string
  body: string
  /** 上游不设描述（`actionPerformed` 里没有 setDescription）⇒ 空串。 */
  description: string
  /** 上游按文件算适用上下文（`:137-146`）⇒ 本仓等价物 = 当前文件的语言档。 */
  languages: Language[]
}

/** 本仓补充：语言 id → `src/templates.ts:10` 的四档（未知落 `other`）。 */
export function templateLanguageFor(language: string): Language {
  return language === 'java' || language === 'cpp' || language === 'typescript' ? language : 'other'
}

/**
 * 从选区造一份模板草稿。正文 = 选区 `trim()`（上游 `:115`）；`key`/`description` 按上游留空。
 * `existingAbbreviations` 供本仓补充的预填缩写避让重名 —— 只影响建议值，不影响草稿本身。
 */
export function buildTemplateDraft(selection: string, language: string, suggestedAbbreviation: string): TemplateDraft {
  return { key: suggestedAbbreviation, body: suggestTemplateText(selection), description: '', languages: [templateLanguageFor(language)] }
}

/**
 * 本仓补充的预填缩写（上游让用户手填，这里给设置页输入框一个初始值）：
 * 取选区前三个词的小写拼接，截 30 字；与既有缩写重名时追加序号。
 */
export function suggestAbbreviation(selection: string, existingAbbreviations: readonly string[]): string {
  const words = suggestTemplateText(selection).replace(/[^\p{L}\p{N}\s_-]/gu, ' ').split(/\s+/).filter(Boolean)
  const base = (words.slice(0, 3).map(word => word.toLowerCase()).join('') || 'template').slice(0, 30)
  let abbreviation = base
  let suffix = 2
  while (existingAbbreviations.includes(abbreviation)) {
    abbreviation = `${base}${suffix}`
    suffix += 1
  }
  return abbreviation
}
