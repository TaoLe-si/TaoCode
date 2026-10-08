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
import {
  decorateProjectViewNode, registerProjectViewNodeDecorator,
  type ProjectViewNodeDecoration, type ProjectViewNodeDecoratorContribution, type ProjectViewNodeView,
} from './ideViewExtensionPoints.ts'

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

// ── 扩展点接线（2026-10-07 epclose2） ──────────────────────────────────────────────────────
//
// 上游「节点长什么样」是 `ProjectViewNodeDecorator`（`com.intellij.projectViewNodeDecorator`，
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:316`）—— 上面那几档诊断装饰在本仓
// 是**内建的实现**，于是把它作为 bundled 贡献登记进同名 EP（第三方（原版 IDEA 插件）按同一 id 挂的
// 装饰器与内建那支走**同一条消费路径**）。与上游的如实差异：上游 `decorate(node, data)` 就地改
// `PresentationData`（颜色/字体/文本/图标），本仓没有那个对象，收成 `ProjectViewNodeDecoration`
// （类名后缀 / tooltip 后缀 / 呈现文本 / 图标名）。

// `ProjectViewNodeDecorator`（`com.intellij.projectViewNodeDecorator`，
// `platform/lang-impl/resources/intellij.platform.lang.impl.xml:316`）—— 上面那几档诊断装饰在本仓
// 是**内建的实现**，于是把它作为 bundled 贡献登记进同名 EP（第三方（原版 IDEA 插件）按同一 id 挂的
// 装饰器与内建那支走**同一条消费路径**）。与上游的如实差异：上游 `decorate(node, data)` 就地改
// `PresentationData`（颜色/字体/文本/图标），本仓没有那个对象，收成 `ProjectViewNodeDecoration`
// （类名后缀 / tooltip 后缀 / 呈现文本 / 图标名）。

/** 内建诊断装饰器的贡献 id（本仓自己的名字，不是上游类名 —— 上游那支是 `ProjectViewImpl` 内部的默认装饰）。 */
export const DIAGNOSTIC_DECORATOR_ID = 'TaoCode.diagnosticNodeDecorator'

/**
 * 内建装饰器：按节点的 error/warning 计数给出类名与 tooltip 后缀。
 * 计数为 0/缺省时**什么都不设**（不覆盖别的装饰器已经叠好的呈现）。
 */
export function diagnosticNodeDecoratorContribution(): ProjectViewNodeDecoratorContribution {
  return {
    id: DIAGNOSTIC_DECORATOR_ID,
    decorate: ({ node, data }) => {
      const errors = node.errors ?? 0
      const warnings = node.warnings ?? 0
      const decoration = decorationOf(errors, warnings)
      if (decoration === 'none') return
      data.className = decorationClass(decoration)
      data.tooltipSuffix = decorationTitle(errors, warnings)
    },
  }
}

// 模块加载即登记（与 `src/extensionPoints.ts` 末尾同一纪律：bundled 贡献必须真的在表里）。
registerProjectViewNodeDecorator(diagnosticNodeDecoratorContribution())

/**
 * 一个节点最终要画的呈现：先跑内建那支与第三方挂的装饰器（按注册序就地叠），返回值给宿主。
 * 没有装饰器命中时返回空对象（调用方按空处理 = 不加类、不加 tooltip）。
 */
export function nodeDecorationFor(node: ProjectViewNodeView): ProjectViewNodeDecoration {
  return decorateProjectViewNode(node)
}

/** 把「一个文件当前的诊断」折成装饰器的输入 + 呈现，一处组装（宿主不用自己拼）。 */
export function decorationForDiagnostics(
  node: ProjectViewNodeView, items: readonly Pick<LspDiagnostic, 'severity'>[],
): ProjectViewNodeDecoration {
  const counts = severityCounts(items)
  return nodeDecorationFor({ ...node, errors: counts.errors, warnings: counts.warnings })
}
