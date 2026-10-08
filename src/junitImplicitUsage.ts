// JUnit 5 的**隐式使用**判定（词法子集）—— 上游 `JUnit5ImplicitUsageProvider`
// （`plugins/junit/src/com/intellij/execution/junit/codeInspection/deadCode/JUnit5ImplicitUsageProvider.kt`）
// 在本仓的等价物：一条 `com.intellij.implicitUsageProvider` 的 bundled 贡献。
//
// 上游逐条（方法名与判断对象逐字对位）：
//   · `isImplicitUsage(element)` 的 `when (element)`：
//       – `PsiParameter` → `parameterIsUsedByParameterizedTest`（看 `@ParameterizedTest(name="…{0}…")`，
//         要算常量表达式的值 ⇒ 本仓**不做**：`JavaConstantExpressionEvaluator` 那一步没有对应物）；
//       – `PsiEnumConstant` → `enumReferenceIsUsedByParameterizedTest`（整个建立在 `ReferencesSearch`
//         的索引查询上 ⇒ 本仓**不做**）；
//       – `PsiMethod` → `methodSourceIsImplicitlyUsed`（**做词法子集**：文件里有
//         `@MethodSource("名字")` 指向它）；
//       – `PsiField` → `fieldSourceIsImplicitlyUsed`（**做词法子集**：`@FieldSource("名字")`）；
//       – `PsiClass` → `nestedClassIsImplicitlyUsed`（**做**：`MetaAnnotationUtil.isMetaAnnotated(element, setOf(ORG_JUNIT_JUPITER_API_NESTED))`
//         ⇒ 本仓看声明行/紧邻上方有没有 `@Nested`）；
//   · `isImplicitRead(element)`: `element is PsiField && fieldSourceIsImplicitlyUsed(element)`（**做**）；
//   · `isImplicitWrite(element)`: `element is PsiField && MetaAnnotationUtil.isMetaAnnotated(element, setOf(TEMPDIR))`
//     ⇒ **做**：字段声明行/紧邻上方有 `@TempDir`；
//   · `isImplicitlyNotNullInitialized(element) = isImplicitWrite(element)`（**做**，逐字照抄）；
//   · 上游这支 provider **不实现** `isClassWithCustomizedInitialization` / `isReferencedByAlternativeNames`
//     （用接口的 default false）⇒ 本仓贡献也不实现那两个方法面，口径一致。
//
// 三处**如实差异**（词法 vs PSI，判词里同样点名）：
//   ① 上游 `MetaAnnotationUtil.isMetaAnnotated` 认「元注解」——即自定义注解 X 自己被 @Nested/@TempDir
//      标注时，用 @X 的地方也算。本仓只看**直接**注解名（`@Nested` / `@a.b.Nested`），不看元注解链。
//   ② 上游 `methodSourceIsImplicitlyUsed` 还要求：那个方法自己不带 `@MethodSource`、形参个数为 0、
//      且引用它的那个方法**同时**带 `@MethodSource` 与 `@ParameterizedTest`（MetaAnnotationUtil 两次）。
//      本仓按「`@MethodSource`/`@FieldSource` 的字符串实参等于这个名字，且附近（±`SOURCE_ANNOTATION_WINDOW`
//      行）有 `@ParameterizedTest`」判；形参个数那一格不做（不做常量表达式求值，也就不假装知道）。
//      另外「声明自己带不带某个注解」按**紧邻注解块**判（`declarationAnnotationText`），
//      不用固定行窗口 —— 那会把上一个方法的注解算到下一个声明头上。
//   ③ `PsiMethod` / `PsiField` 的**归属类**（`containingClass.allMethods`）本仓不解析：不看名字在
//      哪个类里出现的，只看整份文件里的注解文本 —— 同文件里同名的私有方法会被一起判成隐式使用。
//      这是「宁可少报未使用，也不误报」的方向（上游 provider 的语义就是这个方向）。
//
// 纯函数、只 import `src/daemonAnalysisExtensionPoints.ts` 的**类型**（零运行时依赖），
// 便于 `node --test` 直测。
// 判据：`tests/daemon-analysis-extension-points.test.mjs`。

import type { ImplicitUsageElement, ImplicitUsageProviderContribution } from './daemonAnalysisExtensionPoints.ts'

/** 上游 `JUnitCommonClassNames.java` 的常量（逐字，行号见注释）。 */
export const JUNIT_NESTED = 'org.junit.jupiter.api.Nested'                        // :63
export const JUNIT_TEMP_DIR = 'org.junit.jupiter.api.io.TempDir'                  // :89
export const JUNIT_PARAMETERIZED_TEST = 'org.junit.jupiter.params.ParameterizedTest'            // :34
export const JUNIT_METHOD_SOURCE = 'org.junit.jupiter.params.provider.MethodSource'            // :35
export const JUNIT_FIELD_SOURCE = 'org.junit.jupiter.params.provider.FieldSource'              // :36

/** 本仓贡献的 id（`source: 'bundled'`；按 id 覆盖，与 EP 宿主同口径）。 */
export const JUNIT5_IMPLICIT_USAGE_PROVIDER_ID = 'taocode.junit5ImplicitUsage'

/** 引用它的方法要与数据源注解挨得多近才算同一个注解块（上游是按「同一个方法」，词法只能按行距）。 */
export const SOURCE_ANNOTATION_WINDOW = 4

/**
 * 一行文本里有没有这个注解（简名或全限定名都认；`@Nested` 不匹配 `@NestedFoo` —— 名字后必须是
 * 非标识符字符，靠 `\b` 保证）。
 */
export function annotationHolds(lineText: string, simpleName: string): boolean {
  if (!lineText) return false
  return new RegExp(`@(?:[\\w$]+\\.)*${simpleName}\\b`).test(lineText)
}

/**
 * 声明**自己**的那些注解文本（上游看 `modifierList` 的注解链）。规则是**紧邻的注解块**：
 * 从声明行的上一行往上走，空行跳过、连续以 `@` 开头的行收下，遇到第一行不是注解的行就停。
 *
 * 为什么不用「固定几行窗口」：`@ParameterizedTest` / `@MethodSource` 写在上一个方法头上时，
 * 固定窗口会把**上一个方法**的注解算到这个方法头上（本仓判据里当场抓到过这条：数据源方法被
 * 当成「自己带 @MethodSource」，于是它自己的隐式使用判定被否定掉）。紧邻块的口径与 PSI 的
 * `modifierList` 一致：注解与声明之间可以空行，但不能隔着别的东西。
 */
export function declarationAnnotationText(element: ImplicitUsageElement): string {
  const lines = element.text.split(/\r?\n/)
  const parts: string[] = []
  for (let index = element.line - 1; index >= 0; --index) {
    const raw = lines[index] ?? ''
    const trimmed = raw.trim()
    if (!trimmed) {
      // 声明与它自己的注解之间允许空行；已经开始收注解之后再遇空行 = 这一块到头了。
      if (parts.length) break
      continue
    }
    if (!trimmed.startsWith('@')) break
    parts.push(raw)
  }
  return parts.join(' ')
}

/**
 * 声明上有没有这个注解：本行（`@Nested class X {` 这种同行写法）或**紧邻的注解块**里有没有。
 * 与上游 `MetaAnnotationUtil.isMetaAnnotated` 的差异（本仓只看直接注解、不看元注解链）写在文件头。
 */
export function declarationHoldsAnnotation(element: ImplicitUsageElement, simpleName: string): boolean {
  if (annotationHolds(element.lineText, simpleName)) return true
  return annotationHolds(declarationAnnotationText(element), simpleName)
}

/** 字符串字面量的内容（单双引号都认，转义不展开 —— 上游也只比字面量的值）。 */
function stringLiteralsIn(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)) out.push(match[1] ?? match[2] ?? '')
  return out
}

/**
 * 文件里有没有 `@MethodSource`/`@FieldSource` 指向 `name`：
 * 逐行找注解，取该行（含续行，最多 3 行）里的字符串字面量；实参为空（`@MethodSource`）时
 * 上游按「注解值等于方法名」处理（`isAnnotationMemberContainsName` 的 `initializers.isEmpty()` 分支），
 * 本仓同样认。
 */
export function referencedByDataSourceAnnotation(
  element: ImplicitUsageElement, simpleName: string,
): boolean {
  if (!element.name) return false
  const lines = element.text.split(/\r?\n/)
  for (let index = 0; index < lines.length; ++index) {
    if (!annotationHolds(lines[index], simpleName)) continue
    // 注解可能跨行：把注解行与往下两行拼起来取实参。
    const block = [lines[index]]
    for (let next = index + 1; next < lines.length && next <= index + 2; ++next) block.push(lines[next])
    const text = block.join(' ')
    const open = text.indexOf('(')
    const values = open < 0 ? [] : stringLiteralsIn(text.slice(open))
    if (!values.length) {
      // `@MethodSource` 不带实参：等于「数据源方法/字段与测试方法同名」（上游的空值分支）。
      if (nearParameterizedTest(lines, index)) return true
      continue
    }
    if (!values.some(value => value === element.name)) continue
    if (nearParameterizedTest(lines, index)) return true
  }
  return false
}

/** `@ParameterizedTest` 是否出现在 `line` 附近（同一个注解块的词法近似，见文件头差异②）。 */
export function nearParameterizedTest(lines: readonly string[], line: number): boolean {
  const from = Math.max(0, line - SOURCE_ANNOTATION_WINDOW)
  const to = Math.min(lines.length - 1, line + SOURCE_ANNOTATION_WINDOW)
  for (let index = from; index <= to; ++index) {
    if (annotationHolds(lines[index], 'ParameterizedTest')) return true
  }
  return false
}

/** `nestedClassIsImplicitlyUsed`：`@Nested` 标注的类。 */
function nestedClassIsImplicitlyUsed(element: ImplicitUsageElement): boolean {
  return element.kind === 'class' && declarationHoldsAnnotation(element, 'Nested')
}

/** `methodSourceIsImplicitlyUsed` 的词法子集。 */
function methodSourceIsImplicitlyUsed(element: ImplicitUsageElement): boolean {
  if (element.kind !== 'method') return false
  // 上游第一句：自己带 `@MethodSource` 的那个方法不算（它是数据源本身，不是被引用的那个）。
  if (declarationHoldsAnnotation(element, 'MethodSource')) return false
  return referencedByDataSourceAnnotation(element, 'MethodSource')
}

/** `fieldSourceIsImplicitlyUsed` 的词法子集。 */
function fieldSourceIsImplicitlyUsed(element: ImplicitUsageElement): boolean {
  if (element.kind !== 'field') return false
  return referencedByDataSourceAnnotation(element, 'FieldSource')
}

/** `@TempDir` 标注的字段（`isImplicitWrite` 那一格）。 */
function tempDirField(element: ImplicitUsageElement): boolean {
  return element.kind === 'field' && declarationHoldsAnnotation(element, 'TempDir')
}

/**
 * 这条 bundled 贡献（注册进 `com.intellij.implicitUsageProvider`，消费点见
 * `src/annotatorHighlights.ts` 的 `unusedDeclarationAnnotator`）。
 */
export const junit5ImplicitUsageProvider: ImplicitUsageProviderContribution = {
  id: JUNIT5_IMPLICIT_USAGE_PROVIDER_ID,
  isImplicitUsage: element =>
    nestedClassIsImplicitlyUsed(element)
    || methodSourceIsImplicitlyUsed(element)
    || fieldSourceIsImplicitlyUsed(element),
  isImplicitRead: element => fieldSourceIsImplicitlyUsed(element),
  isImplicitWrite: element => tempDirField(element),
  // 上游那一条逐字照抄：`isImplicitlyNotNullInitialized(element): Boolean = isImplicitWrite(element)`。
  isImplicitlyNotNullInitialized: element => tempDirField(element),
}
