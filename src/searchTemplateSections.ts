// 模板下拉那三段（内置 / 我的 / 最近）怎么拼、每行取模板的哪几个字段。
//
// 上游：`ExistingTemplatesComponent` 的模板树 + `ConfigurationManager` 的收藏与最近使用。
// 面板只把两个 ref 递进来（保存的 / 最近的），这里做纯映射 —— 不碰搜索状态，
// 因此三段有什么、每段有没有「删除模板」按钮都能单测。
import { BUILTIN_STRUCTURAL_TEMPLATES, type StructuralSearchConfig, type StructuralTemplate } from './structuralSearchConfigs.ts'

/** 下拉里的一行：模板本体 + 它来自哪一段（`saved` 决定画不画「删除模板」）。 */
export type TemplateRow = StructuralTemplate & { saved?: boolean; recent?: boolean }

export interface TemplateSection { title: string; items: TemplateRow[] }

export function templateSectionsOf(
  saved: readonly StructuralSearchConfig[],
  recent: readonly StructuralSearchConfig[],
): TemplateSection[] {
  return [
    { title: '内置模板', items: BUILTIN_STRUCTURAL_TEMPLATES },
    {
      title: '我的模板',
      items: saved.map(config => ({ name: config.name, description: config.query, query: config.query, replacement: config.replacement, saved: true })),
    },
    {
      title: '最近',
      items: recent.map(config => ({ name: config.name, description: config.query, query: config.query, replacement: config.replacement, recent: true })),
    },
  ]
}
