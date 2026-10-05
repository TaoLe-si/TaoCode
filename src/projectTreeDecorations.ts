// 项目视图的节点装饰 —— 上游 `ProjectViewNodeDecorator`（`pv/project-view` 族）的等价物。
//
// 上游把「节点长什么样」与「节点是什么」分开：`ProjectViewNodeDecorator` 是挂在
// `ProjectViewImpl` 上的一条扩展点，出厂实现里与本域相关的这条是：
//   · 有错误/警告的**文件**在项目树里换色 —— 项目视图设置 "Highlight files with errors"
//     （`ProjectViewSharedSettings`，IDEA 2021.3 起把编辑器的错误状态带进项目视图，
//     默认开）；
//   · VCS 状态装饰（`VcsProjectViewNodeDecorator`，位于 vcs-impl，不属于本域）——
//     本仓的变更颜色由用户文件颜色承担（`src/fileColorsHost.ts`），这里不重复。
//
// 这一层只输出**呈现**（类名 + title 后缀），不动树结构：数据源是 `src/bridge.ts` 的
// `lspDiagnostics`（reactive Map），配色在 FileTree.vue 的 `.tree-decoration-*` 里。
// 与 `src/problems.ts` 共用「严重度 1 = 错误 / 2 = 警告」的口径。
import type { LspDiagnostic } from './bridge'

/** 节点的装饰档：错误 > 警告 > 无。 */
export type TreeDecoration = 'error' | 'warning' | 'none'

export interface SeverityCounts {
  errors: number
  warnings: number
}

/** 一个文件下所有诊断的严重度计数（LSP：1 错误 / 2 警告，其余不算装饰）。 */
export function severityCounts(items: readonly Pick<LspDiagnostic, 'severity'>[]): SeverityCounts {
  let errors = 0
  let warnings = 0
  for (const item of items) {
    if (item.severity === 1) ++errors
    else if (item.severity === 2) ++warnings
  }
  return { errors, warnings }
}

/** 装饰档位选择（错误压过警告，与问题面板的严重度排序同一口径）。 */
export function decorationOf(errors: number, warnings: number): TreeDecoration {
  if (errors > 0) return 'error'
  if (warnings > 0) return 'warning'
  return 'none'
}

/**
 * title（tooltip）后缀：把颜色说明白（上游 `getTooltipText` 在文件名后补错误状态）。
 * 无装饰时返回空串，调用方直接拼接。
 */
export function decorationTitle(errors: number, warnings: number): string {
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} 个错误`)
  if (warnings > 0) parts.push(`${warnings} 个警告`)
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

/** 渲染用的类名后缀（FileTree.vue 的 scoped CSS）；`none` 不加类。 */
export function decorationClass(decoration: TreeDecoration): string {
  return decoration === 'none' ? '' : `tree-decoration-${decoration}`
}
