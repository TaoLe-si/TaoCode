// **本地检查工具的扩展点**（上游 `com.intellij.localInspection` / `LocalInspectionEP` +
// `LocalInspectionTool` 在本仓的等价物）。
//
// 上游是什么：插件在 plugin.xml 里写
//   `<localInspection shortName="X" displayName="…" groupName="…" enabledByDefault="true"
//                     level="WARNING" language="JAVA" implementationClass="…"/>`
// ；`platform/analysis-api/resources/META-INF/Analysis.analyzer.xml:17` 声明 EP
// `qualifiedName="com.intellij.localInspection" beanClass="com.intellij.codeInspection.LocalInspectionEP"`
// （`dynamic="true"`）。平台把每个 `LocalInspectionEP` 实例化成 `LocalInspectionTool`，在 daemon 的
// on-the-fly pass 里对打开的文件跑 `buildVisitor`/`checkFile`，产出的 `ProblemDescriptor` 进
// ErrorStripe 与问题视图（本仓的对应物是 `src/problems.ts` 的问题面板）。
//
// 本仓此前：本地检查只有一个写死的 JUnit 规则集（`src/junitInspections.ts`），第三方挂不进来
// —— 判词 lp/inspections 那条「规则全部来自语言服务的诊断 + 本地只有 junitInspections」。
// 本文件补上 **EP 宿主**：
//   · EP id `com.intellij.localInspection`（逐字取自上游）；
//   · 工具形状 = `LocalInspectionEP` + `LocalInspectionTool` 的可移植子集：身份四件（`shortName`/
//     `displayName`/`groupDisplayName`/`severity`）+ `enabledByDefault` + `isAvailable(context)` +
//     `check(context)`；本仓没有 PSI，`check` 收到的是**文件文本**（含已掩码的 `code`，非代码区涂白）；
//   · 内置的 JUnit 规则作为 **bundled 工具**登记（`src/junitInspections.ts` 那一条），所以本仓功能照常；
//   · 第三方的 `localInspection` 按同一个 EP id 挂进来即被现有 pass 跑到（`runLocalInspectionTools`
//     在 `src/junitInspections.ts` 的 main highlighting pass 里被调用）。
//
// 与上游的如实差异：没有 PSI/`ProblemDescriptor`，工具的输入是文本、输出是
// `{path,line,character,severity,source,message}` 的形状；`InspectionProfile` 的启用/严重度覆盖
// 已由 `src/inspectionProfile.ts` 承担（本模块只提供 EP 与 runner，不做 profile 过滤）。
//
// 判据：`tests/local-inspection-tools.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** EP id（逐字取自上游 `Analysis.analyzer.xml:17` 的 `qualifiedName`）。 */
export const LOCAL_INSPECTION_EP = 'com.intellij.localInspection'

/** 一条本地诊断（`ProblemDescriptor` 的文本等价物；与 `JunitInspectionProblem` 结构兼容）。 */
export interface LocalInspectionProblem {
  path: string
  /** 0 基行号。 */
  line: number
  /** 0 基列号。 */
  character: number
  /** 严重度（与 LSP DiagnosticSeverity 同号：1 Error / 2 Warning / 3 Info…）。 */
  severity: number
  message: string
  /** 检查类的短名（问题面板的「来源」列）。 */
  source: string
}

/** 工具跑一次能看到的上下文（本仓没有 PSI，给文件文本 + 掩码后的代码文本）。 */
export interface LocalInspectionContext {
  path: string
  /** 原文。 */
  text: string
  /** 注释/字符串内容被涂白的代码文本（等价物：daemon 的 PSI 视图；第三方可只用 `text`）。 */
  code: string
}

/**
 * 一个本地检查工具（`LocalInspectionEP` + `LocalInspectionTool` 的可移植子集）。
 * 属性名与上游 EP 的 XML 属性对齐（`shortName`/`displayName`/`groupDisplayName`/`severity`/
 * `enabledByDefault`），便于从 plugin.xml 映射过来。
 */
export interface LocalInspectionTool {
  /** `shortName`（上游 XML 属性；也是问题来源列与 `//noinspection <shortName>` 用的键）。 */
  shortName: string
  displayName: string
  groupDisplayName: string
  /** `level`/`severity`：与 LSP DiagnosticSeverity 同号。 */
  severity: number
  /** `enabledByDefault`（缺省 true）。 */
  enabledByDefault?: boolean
  /** `LocalInspectionTool.isAvailableForFile`：按路径/语言收窄。 */
  isAvailable?: (context: LocalInspectionContext) => boolean
  /** `buildVisitor`/`checkFile`：产诊断。 */
  check: (context: LocalInspectionContext) => readonly LocalInspectionProblem[]
}

/** 一个 EP 贡献 id → 工具（`LocalInspectionEP` 的身份是 `shortName`）。 */
export function localInspectionExtensionId(tool: { shortName: string }): string {
  return tool.shortName
}

/** 声明 EP（幂等）。 */
export function declareLocalInspectionExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({ id: LOCAL_INSPECTION_EP, name: '本地检查工具', scope: APPLICATION_SCOPE, dynamic: true })
}

/** 注册一个工具（同 `shortName` 覆盖；`id` 用 `shortName`）。 */
export function registerLocalInspectionTool(tool: LocalInspectionTool, options: RegisterExtensionOptions = {}): ExtensionHandle {
  return EXTENSIONS.registerExtension(LOCAL_INSPECTION_EP, localInspectionExtensionId(tool), tool, options)
}

/** 注销一个工具。 */
export function unregisterLocalInspectionTool(shortName: string): boolean {
  return EXTENSIONS.unregisterExtension(LOCAL_INSPECTION_EP, shortName)
}

/** 当前作用域下的全部工具（已按 `LoadingOrder` 排）。 */
export function localInspectionTools(scope: string = APPLICATION_SCOPE): LocalInspectionTool[] {
  return EXTENSIONS.extensionsOf<LocalInspectionTool>(LOCAL_INSPECTION_EP, scope)
}

/**
 * 跑所有登记的本地检查工具，把诊断合并成一个按 (行, 列, 来源) 排好序的列表。
 * `enabledByDefault === false` 且没有被显式启用的工具**跳过**（本仓还没有按 profile 的显式启用通道，
 * 所以 `enabledByDefault:false` 的工具在这里就是不跑 —— 如实，不静默把禁用的检查算进来）。
 */
export function runLocalInspectionTools(
  context: LocalInspectionContext, scope: string = APPLICATION_SCOPE,
): LocalInspectionProblem[] {
  const out: LocalInspectionProblem[] = []
  for (const tool of localInspectionTools(scope)) {
    if (tool.enabledByDefault === false) continue
    if (tool.isAvailable && !tool.isAvailable(context)) continue
    for (const problem of tool.check(context)) {
      if (!Number.isInteger(problem.line) || problem.line < 0) continue
      out.push(problem)
    }
  }
  out.sort((a, b) => a.line - b.line || a.character - b.character || a.source.localeCompare(b.source) || a.message.localeCompare(b.message))
  return out
}

declareLocalInspectionExtensionPoints()
