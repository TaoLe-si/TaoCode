// 「诊断 → IDEA 检查项」的身份解析 —— 本域主杠杆的那一环。
//
// 上游这条链的原文（逐环给坐标）：
//   · LSP 诊断 → 注解：`platform/lsp/src/api/customization/LspDiagnosticsCustomizer.kt:47-75`
//     （`createAnnotation` 用 `holder.newAnnotation(severity, message)`，severity 见 `:80-85`，
//     特殊高亮类型见 `:93-96`：tags 含 `Unnecessary` → `LIKE_UNUSED_SYMBOL`、含 `Deprecated` → `LIKE_DEPRECATED`）。
//   · 检查项身份 = `HighlightInfo` 的 **problemGroup 优先、inspectionToolId 其次**：
//     `platform/problemsView/ui/src/com/intellij/analysis/problemsView/toolWindow/HighlightingProblem.kt:85-89`
//     （`val id = info?.problemGroup?.problemName ?: info?.inspectionToolId ?: return null`
//       → `HighlightDisplayKey.getDisplayNameByKey(HighlightDisplayKey.find(id))`）；
//     `problemGroup` 的语义见 `platform/analysis-api/src/com/intellij/lang/annotation/ProblemGroup.java:6-13`
//     ——「同一组的所有问题有相同的 getProblemName()，用来**把一条检查拆成几个伪检查项**」；
//     外部注解器那一支的 problemName 就是外部检查名：
//     `platform/analysis-api/src/com/intellij/codeInspection/ExternalSourceProblemGroup.kt:13-18`
//     （`getExternalCheckName()`）+ `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfo.java:477-481`
//     （`getExternalSourceId()`），工具短名见同文件 `:473-475`（`getInspectionToolId()`）。
//   · 「未使用 / 已废弃」这两档在上游**本身就是注册出来的检查项**（有 id、有显示名）：
//     `platform/analysis-impl/src/com/intellij/codeInsight/daemon/impl/HighlightInfoType.java:30`
//     （`UNUSED_SYMBOL_SHORT_NAME = "unused"`）、`:49-50`（UNUSED_SYMBOL 用
//     `HighlightDisplayKey.findOrRegister(UNUSED_SYMBOL_SHORT_NAME, getUnusedSymbolDisplayName(), …)`）、
//     `:216-218`（显示名 = `AnalysisBundle.message("inspection.dead.code.display.name")`）、
//     `platform/analysis-api/resources/messages/AnalysisBundle.properties:19` = `Unused declaration`；
//     `:53-55`（DEPRECATED 用 `DeprecationUtil.DEPRECATION_SHORT_NAME`）+
//     `platform/analysis-impl/src/com/intellij/codeInspection/DeprecationUtil.java:13,15,22-24`
//     （短名 `Deprecation`、id `deprecation`、显示名 = `inspection.deprecated.display.name`）+
//     `platform/analysis-api/resources/messages/AnalysisBundle.properties:68` = `Deprecated API usage`。
//   · 启停的粒度也是同一个 key：`platform/analysis-impl/src/com/intellij/codeInspection/ex/InspectionProfileImpl.java:804`
//     （`isToolEnabled(HighlightDisplayKey key, PsiElement element)`）。
//
// 本仓用什么承接上游的什么（架构不等价，按 2026-10-05 指示还原用户可见功能）：
//   · 上游没有 PSI，也没有 `HighlightDisplayKey` 注册表；本仓的检查项身份由 **(source, code, tags)** 三列折出来：
//     `tags` 那档直接复用上游注册出来的 id/显示名（`KIND_INSPECTIONS`），
//     `code` 对应 `getExternalSourceId()`（外部检查名），`source` 对应 `getInspectionToolId()`；
//   · 候选键按「具体 → 宽泛」排（`keys`），`src/inspectionProfile.ts` 的门控按序取第一个命中的设置 ——
//     这就是「按诊断码停用某个检查项、同时还能整检查器停用」两档并存的落点；
//   · **订正一处旧判词**：`docs/inventory/verdict-daemon.md` 的 `dm/highlight` 行写着
//     「`code`/`tags` 不透传（`native/lsp_support.cpp:127-145`）」—— 实测已透传
//     （`native/lsp_support.cpp:148-149`），宿主类型也在 `src/bridge.ts:118`。
//     真正没透传的是 `relatedInformation`（`platform/analysis-api/.../ProblemDescriptor.java` 的关联问题面），
//     那条已写进接线请求。
//
// 与 `src/annotatorHighlights.ts` 的分工：那边是**编辑器装饰层**（画灰掉/删除线），
// 吃的是原始 `lspDiagnostics` 表；这里是**问题视图/配置面**的身份模型，吃 `ProblemRow`。
// 两者共用本模块的 `problemKindOf`，不再各写一份 tags 判定。
import type { ProblemRow } from './problems.ts'
// 诊断身份键 → 检查项合并后的键（`com.intellij.inspectionElementsMerger` EP 的消费面）。
import { mergedToolNamesFor } from './daemonExtensionPoints.ts'

/** LSP `DiagnosticTag.Unnecessary` 的线上取值（上游消费点 `LspDiagnosticsCustomizer.kt:94`）。 */
export const DIAGNOSTIC_TAG_UNNECESSARY = 1
/** LSP `DiagnosticTag.Deprecated` 的线上取值（上游消费点 `LspDiagnosticsCustomizer.kt:95`）。 */
export const DIAGNOSTIC_TAG_DEPRECATED = 2

/** 由 tags 定出的「伪检查项」两档（上游 `ProblemGroup.java:6-9` 说的就是这种拆分）。 */
export type ProblemKind = 'unusedSymbol' | 'deprecated'

/**
 * tags → 高亮类型（`LspDiagnosticsCustomizer.kt:93-96` 的 `getSpecialHighlightType` 等价物）。
 * 顺序照上游：`Unnecessary` 先判，两个 tag 同时在场时取「未使用」。
 */
export function problemKindOf(tags?: readonly number[] | null): ProblemKind | null {
  if (!Array.isArray(tags)) return null
  if (tags.includes(DIAGNOSTIC_TAG_UNNECESSARY)) return 'unusedSymbol'
  if (tags.includes(DIAGNOSTIC_TAG_DEPRECATED)) return 'deprecated'
  return null
}

/**
 * 两档在上游注册出来的检查项身份（id 与显示名逐字取自上游，见文件头的坐标）。
 * id 用作候选键的后缀，显示名用作问题视图的分组标题（= 上游 `HighlightDisplayKey` 的显示名）。
 */
export const KIND_INSPECTIONS: Readonly<Record<ProblemKind, { id: string; displayName: string }>> = {
  unusedSymbol: { id: 'unused', displayName: 'Unused declaration' },
  deprecated: { id: 'Deprecation', displayName: 'Deprecated API usage' },
}

/** 面板芯片的文案（本仓 UI 全中文；上游的显示名留在 `KIND_INSPECTIONS` 里不翻译）。 */
export const KIND_LABEL_ZH: Readonly<Record<ProblemKind, string>> = {
  unusedSymbol: '未使用声明',
  deprecated: '已废弃 API',
}

/** 没有检查器也没有诊断码时的分组/清单标题（与 `src/problemsView.ts` 的既有文案同一份）。 */
export const NO_CHECKER_LABEL = '（无来源）'

export interface DiagnosticIdentityInput {
  /** LSP `Diagnostic.source`（检查器名）。 */
  source?: string | null
  /** LSP `Diagnostic.code`（数字或字符串，统一折成字符串）。 */
  code?: string | number | null
  /** LSP `Diagnostic.tags`。 */
  tags?: readonly number[] | null
}

/** 一条诊断的完整检查项身份。 */
export interface InspectionIdentity {
  kind: ProblemKind | null
  /** 检查器名（已 trim；没有则空串）。 */
  checker: string
  /** 诊断码（已 trim 成字符串；没有则空串）。 */
  code: string
  /** 最具体的那把键（`src/inspectionProfile.ts` 的 `tools` 表用它落新条目）。 */
  key: string
  /** 候选键，具体 → 宽泛；门控按序取第一个有登记的。 */
  keys: readonly string[]
  /** 分组标题 / 清单名 —— 上游那一步 `HighlightDisplayKey.getDisplayNameByKey` 的等价物。 */
  displayName: string
  /** 面板可直接画的名字：`displayName` 为空时落到「（无来源）」。 */
  label: string
  /** 行上的芯片文案；null = 这条诊断不是「未使用 / 已废弃」，不画芯片（不放假控件）。 */
  kindLabel: string | null
}

/**
 * (source, code, tags) → 检查项身份。
 *
 * 键的层级（对应上游 `HighlightingProblem.kt:87` 的两级回退 + 本仓多出来的诊断码粒度）：
 *   1. `#<kind id>`      —— 问题被拆成伪检查项（`ProblemGroup.getProblemName()`；
 *                          `HighlightInfoType.java:49-55` 注册的就是 `unused` / `Deprecation`）；
 *   2. `<检查器>::<码>`  —— 外部检查名（`HighlightInfo.java:477-481` 的 `getExternalSourceId()`）；
 *   3. `<检查器>`        —— 工具短名（`HighlightInfo.java:473-475` 的 `getInspectionToolId()`），
 *                          **也是本仓旧存档里唯一的键形状**，留着才不会把已有 profile 判成空；
 *   4. `<码>`            —— 只有码没有检查器时，码自己就是身份。
 */
export function inspectionIdentityOf(input: DiagnosticIdentityInput): InspectionIdentity {
  const kind = problemKindOf(input.tags)
  const checker = typeof input.source === 'string' ? input.source.trim() : ''
  const code = input.code === undefined || input.code === null ? '' : String(input.code).trim()
  const keys: string[] = []
  if (kind) keys.push(`#${KIND_INSPECTIONS[kind].id}`)
  if (checker && code) keys.push(`${checker}::${code}`)
  if (checker) keys.push(checker)
  else if (code) keys.push(code)
  // 既没有来源也没有码：留一把空键当最后一级 —— 旧存档里「（无来源）」那一条就是登记在空键上的，
  // 不登记的话这一类诊断会变成「无法停用」（上游此时 group=null，但启停仍然要有落点）。
  else keys.push('')
  let displayName: string
  if (kind) displayName = KIND_INSPECTIONS[kind].displayName
  else if (checker && code) displayName = `${checker} (${code})`
  else displayName = checker || code
  return {
    kind, checker, code,
    key: keys[0] ?? '',
    keys,
    displayName,
    label: displayName || NO_CHECKER_LABEL,
    kindLabel: kind ? KIND_LABEL_ZH[kind] : null,
  }
}

/** `ProblemRow` 的身份（面板、分组、profile 清单都用这一把入口）。 */
export function identityOfRow(row: Pick<ProblemRow, 'source' | 'code' | 'tags'>): InspectionIdentity {
  return inspectionIdentityOf({ source: row.source, code: row.code, tags: row.tags })
}

/**
 * 候选键的**展开版**：在内建候选键之后，追加 `com.intellij.inspectionElementsMerger` EP 给出的
 * 「旧检查项短名 → 新合并短名」（上游 `InspectionElementsMerger.getMergedToolNames(id)`，
 * `platform/analysis-api/src/com/intellij/codeInspection/ex/InspectionElementsMerger.java:74-78`）。
 *
 * 为什么需要：上游把几个旧检查项并进一个新检查项时，用户 profile 里存的还是旧短名
 * （`InspectionElementsMerger.java:20-27` 的类注释：「keeps existing @SuppressWarnings annotations
 * working … without the user needing to configure it again」）。本仓的 profile 也是按旧键存的，
 * 所以 `src/inspectionProfile.ts` 的门控要能把「诊断身份键」补上合并后的新键，老设置才继续生效。
 * 没有登记合并器时返回 `identity.keys` 的副本（行为与展开前完全一致）。
 */
export function inspectionKeyCandidates(identity: InspectionIdentity): string[] {
  const out = [...identity.keys]
  for (const key of identity.keys) {
    for (const merged of mergedToolNamesFor(key)) if (!out.includes(merged)) out.push(merged)
  }
  return out
}
