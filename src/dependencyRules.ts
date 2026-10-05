// 依赖规则校验 —— 上游 `platform/analysis-impl/src/com/intellij/packageDependencies/DependencyValidationManagerImpl.java`
// （`DependencyValidationManager` 的实现）+ `platform/analysis-api/src/com/intellij/packageDependencies/DependencyRule.java`
// 的规则语义，判词里点名的那条缺口：「`DependencyValidationManagerImpl` 的依赖规则校验
// （from scope / to scope / deny 三段，存在 `.idea/scopes` 的 `DependencyValidationManager` 状态里）」。
//
// **规则形状**（`DependencyRule.java:13-22`）：`myFromScope` + `myToScope` + `myDenyRule` 三段，
// 两个 scope 都是 `NamedScope`（可以是命名作用域，也可以是"匿名作用域"= 一段裸模式文本，
// 见 `DependencyValidationManagerImpl.java:163-170` 的 `appendUnnamedScope` 与 `:61` 的 `unnamed_scope`）。
//
// **判定语义**（`DependencyRule.isForbiddenToUse:24-34`，逐条对照）：
//   · deny 规则（「在作用域 {to} 拒绝作用域 {from} 的用法」）：`fromSet.contains(from) && toSet.contains(to)`；
//   · allow 规则（「在作用域 {to} 启用作用域 {from} 的使用」）：
//     `new ComplementPackageSet(fromSet).contains(from) && toSet.contains(to)`
//     —— from 取**补集**后再判：不在 from 里的文件依赖了 from 里的东西 ⇒ 该条边违规。
//   `isApplicable:36-45` 是同一式子只看 from 那一半（上游用它决定这个文件要不要跑检查，
//   `DependencyInspection.kt:25`）。
//
// **管理器面**（`DependencyValidationManagerImpl.java`）：`hasRules:90-92`、
// `getViolatorDependencyRule:95-101`（第一条命中即返回）、`getViolatorDependencyRules:104-112`（全部）、
// `getApplicableRules:115-123`、匿名作用域只在**没有同名命名作用域**时才用（`getScope:264-276`）。
//
// **持久化**：上游 `@State(name = "DependencyValidationManager", storages = @Storage("scopes"))`（`:40-43`），
// 元素/属性名 = `deny_rule` / `from_scope` / `to_scope` / `is_deny` / `unnamed_scope` / `value`（`:57-62`）；
// 读一条规则要三个属性都在，缺任何一个整条丢掉（`readRule:289-296`）；写的时候两个 scope 任一为 null
// 就不写那条（`writeRule:277-286`）。本仓沿用**同一套字段名**（形状对齐），
// 存储通道用 `localStorage`（按工作区根分键）——本仓的项目设置里 `NamedScopeSetting` 只有
// name/pattern/shared 三个字段，加"规则"要动保留文件 `src/settingsModel.ts` + 原生校验
// `native/settings_schema.cpp`（桶 7 名下），已按接线请求提出。
//
// **与上游的架构差**（都是"本仓没有那个东西"，不是省事）：
//   · 上游按 `PsiFile` 判定，本仓按**工作区相对路径**判定：`Project Files` / `Project Test Files` /
//     `Generated Files` 这三档走 `src/packageDepsView.ts` 的路径分类（与"分析依赖"的范围选择同一条口径）；
//     命名/匿名作用域走 `src/scopes.ts` 的模式语言（`file:`/`ext:`/`projectPath:`/`$引用`）。
//   · 上游的边是 PSI 引用（同包内符号引用也算），本仓的边是 `src/packageDeps.ts` 的**目录级 import 图**，
//     所以 to 侧常是目录（按 `scopes.ts:384` 的目录口径补 `/`）。
//   · `skipImportStatements`（`DependencyValidationManagerImpl.java:126-133`，UI 是
//     `skip.import.statements.checkbox.title`）**本仓不做**：上游它跳过的是 import 语句这一种*引用*，
//     PSI 还有别的引用点；本仓的依赖边**只**来自 import 行扫描（`src/packageDeps.ts` 的 `IMPORT_SCAN_QUERY`），
//     照搬这条开关等于把整张图清空 —— 那是个一按就没结果的假控件。

import { compileScopeText, scopeLookup, scopeMatches, type ScopeContext, type ScopeSet } from './scopes.ts'
import { classifyFile } from './packageDepsView.ts'
import { scopePresentableName } from './scopeIdMapper.ts'

/** 规则里对一个作用域的引用（上游 `NamedScope`：预定义 id / 命名 / 匿名（裸模式））。 */
export type DependencyScopeRef =
  | { kind: 'standard'; id: string }
  | { kind: 'named'; name: string }
  | { kind: 'unnamed'; pattern: string }

/** 一条依赖规则（`DependencyRule.java:13-22` 的三段）。 */
export interface DependencyRule {
  from: DependencyScopeRef
  to: DependencyScopeRef
  /** true = deny 规则；false = allow 规则（`DependencyRule.myDenyRule`）。 */
  deny: boolean
}

/** 求值上下文：命名作用域表 +「当前文件」（`Current File` 那一档用）。 */
export interface DependencyRuleContext {
  namedScopes: readonly { name: string; pattern: string }[]
  currentFile?: string
  /** 单隐式模块的名字（`scopes.ts` 的 `file[模块名]:` 用）。 */
  moduleName?: string
}

/** 一个引用解析成的模式（解析不出来 = 恒不匹配，同 `scopes.ts:519-526` 的"查不到即假"）。 */
function compiledRef(ref: DependencyScopeRef, context: DependencyRuleContext): ReturnType<typeof compileScopeText>['set'] | null {
  if (ref.kind !== 'named' && ref.kind !== 'unnamed') return null
  const pattern = ref.kind === 'named'
    ? (context.namedScopes.find(scope => scope.name === ref.name)?.pattern ?? '')
    : ref.pattern
  if (!pattern) return null
  const compiled = compileScopeText(pattern)
  return compiled.error ? null : compiled.set
}

/**
 * 一个作用域引用是否包含这个路径。预定义档走路径分类（理由见文件头的架构差那一段），
 * 命名/匿名档走 `src/scopes.ts` 的模式求值（`$引用` 的解析表就是工程里那批命名作用域）。
 */
export function scopeRefContains(
  ref: DependencyScopeRef, path: string, isDirectory: boolean, context: DependencyRuleContext,
): boolean {
  if (ref.kind === 'standard') {
    switch (ref.id) {
      case 'All': case 'All Places': return true
      // 上游 ProjectFilesScope = `fileIndex.isInContent(file)`（`ProjectFilesScope.java:26-31`）：
      // 本仓的"内容内"= 工作区清单里除生成物之外的文件（生成目录那一族在 `packageDepsView.ts:37-40`）。
      case 'Project Files': return classifyFile(path) !== 'generated'
      case 'Project Test Files': case 'Tests': return classifyFile(path) === 'test'
      case 'Generated Files': return classifyFile(path) === 'generated'
      case 'Current File': return path === (context.currentFile ?? '')
      // 认识的 id 但本仓没有对应实体（`Project and Libraries` / `Scratches and Consoles`）⇒ 不匹配，
      // 与上游"找不到作用域就不匹配"一致（`DependencyValidationManagerImpl.java:264-276`）。
      default: return false
    }
  }
  const set = compiledRef(ref, context)
  if (!set) return false
  const scopeContext: ScopeContext = { moduleName: context.moduleName, lookup: scopeLookup(context.namedScopes) }
  return scopeMatches(set, path, isDirectory, scopeContext)
}

/** 目标那一侧在本仓是不是目录（目录级图的 `to` 是目录名；带点号的按文件处理）。 */
function targetIsDirectory(to: string): boolean {
  return to === '' || !to.includes('.')
}

/** `DependencyRule.isApplicable:36-45`：这个文件是不是该按这条规则看。 */
export function ruleIsApplicable(rule: DependencyRule, path: string, context: DependencyRuleContext): boolean {
  const inFrom = scopeRefContains(rule.from, path, false, context)
  return rule.deny ? inFrom : !inFrom
}

/** `DependencyRule.isForbiddenToUse:24-34`：from→to 这一条依赖是否**违反**这条规则。 */
export function ruleForbidsPair(
  rule: DependencyRule, fromPath: string, toPath: string, context: DependencyRuleContext,
): boolean {
  // deny：from 侧必须命中；allow：from 侧必须**不**命中（`ComplementPackageSet`，`:32`）。
  const fromHit = scopeRefContains(rule.from, fromPath, false, context)
  if (rule.deny ? !fromHit : fromHit) return false
  return scopeRefContains(rule.to, toPath, targetIsDirectory(toPath), context)
}

/** 界面上一条规则的「来源/去向」标签（预定义档走 `ScopeIdMapper` 的中文显示名）。 */
export function scopeRefTitle(ref: DependencyScopeRef): string {
  if (ref.kind === 'standard') return scopePresentableName(ref.id)
  if (ref.kind === 'named') return ref.name
  return ref.pattern
}

/** `DependencyRule.getDisplayText:47-54`：中文模板把 `{1}`（from）放在前面，
 *  上游传参顺序是 `(toScopeName, fromScopeName)` —— 两条 key 的占位符逐字照 bundle：
 *  · `scope.display.name.deny.scope` = 在作用域 ''{1}'' 拒绝作用域 ''{0}'' 的用法
 *  · `scope.display.name.allow.scope` = 在作用域''{1}''启用作用域''{0}''的使用
 */
export function ruleDisplayText(rule: DependencyRule): string {
  const from = scopeRefTitle(rule.from)
  const to = scopeRefTitle(rule.to)
  return rule.deny
    ? `在作用域 '${from}' 拒绝作用域 '${to}' 的用法`
    : `在作用域'${from}'启用作用域'${to}'的使用`
}

/** 一条违规的说明（`jvm.inspections.dependency.violator.problem.descriptor`，JvmAnalysisBundle:69）。 */
export function violationMessage(displayText: string): string {
  return `违反依赖关系规则 '${displayText}.'`
}

/** `DependencyValidationManager.hasRules:90-92`。 */
export function hasDependencyRules(rules: readonly DependencyRule[]): boolean {
  return rules.length > 0
}

/** `getApplicableRules:115-123`：对这个文件生效的规则（全部，按声明顺序）。 */
export function applicableDependencyRules(
  rules: readonly DependencyRule[], path: string, context: DependencyRuleContext,
): DependencyRule[] {
  return rules.filter(rule => ruleIsApplicable(rule, path, context))
}

/** `getViolatorDependencyRules:104-112`：这一对 from/to 违反了哪些规则（全部）。 */
export function violatorRules(
  rules: readonly DependencyRule[], fromPath: string, toPath: string, context: DependencyRuleContext,
): DependencyRule[] {
  return rules.filter(rule => ruleForbidsPair(rule, fromPath, toPath, context))
}

/** `getViolatorDependencyRule:95-101`：第一条命中的规则，没有就 null。 */
export function firstViolatorRule(
  rules: readonly DependencyRule[], fromPath: string, toPath: string, context: DependencyRuleContext,
): DependencyRule | null {
  for (const rule of rules) if (ruleForbidsPair(rule, fromPath, toPath, context)) return rule
  return null
}

/** 一条违规边（上游 `DependenciesPanel.myIllegalDependencies:116`：文件 → 规则 → 违规的目标集合）。 */
export interface DependencyViolation {
  rule: DependencyRule
  /** 发起依赖的文件（`PackageEdge.path`）。 */
  fromPath: string
  /** 被依赖的那一侧（本仓 = 包目录，`PackageEdge.to`）。 */
  toPath: string
  line: number
  ruleText: string
  message: string
}

/**
 * 在目录级依赖图上跑一遍规则：每条边的「发起文件 → 目标目录」按 `isForbiddenToUse` 判定，
 * 命中的规则各记一条（上游 `DependencyInspection.kt:30-37` 也是逐条规则各出一条问题）。
 * 门控同 `DependencyInspection.kt:25`：`hasRules()` 为假、或这个文件**没有任何适用规则**时整条跳过
 * （违规必然蕴含"该规则对此文件适用"，所以这道门只省算力、不改结论 —— 判据测试守着这句）。
 */
export function findDependencyViolations(
  rules: readonly DependencyRule[],
  edges: readonly { from: string; to: string; path: string; line: number }[],
  context: DependencyRuleContext,
): DependencyViolation[] {
  if (!rules.length) return []
  const out: DependencyViolation[] = []
  for (const edge of edges) {
    if (!applicableDependencyRules(rules, edge.path, context).length) continue
    for (const rule of rules) {
      if (!ruleForbidsPair(rule, edge.path, edge.to, context)) continue
      const ruleText = ruleDisplayText(rule)
      out.push({ rule, fromPath: edge.path, toPath: edge.to, line: edge.line, ruleText, message: violationMessage(ruleText) })
    }
  }
  return out
}

/**
 * `UI_FILTER_LEGALS`（`DependencyUISettings.java:21`，默认 false）：只看非法依赖。
 * 上游那个开关是依赖工具窗口里的「Show Illegals Only」（`DependenciesPanel.java:716-740` 的
 * `FilterLegalsAction`，文案 `action.show.illegals.only` = CodeInsightBundle:409），
 * 空态文案 `status.text.no.illegal.dependencies.found`（`setEmptyText`，`:742-747`）。
 */
export const NO_ILLEGAL_DEPENDENCIES_TEXT = '未找到非法依赖项'

/** 违规涉及的目标包集合（上游 `myIllegalsInRightTree`，`DependenciesPanel.java:127`、`:390-413`）。 */
export function illegalTargets(violations: readonly DependencyViolation[]): Set<string> {
  return new Set(violations.map(item => item.toPath))
}

/**
 * 「仅显示非法依赖」：只留非法的那几条边（连同它们两端的包）。
 * **规则为空时不过滤** —— 上游没有规则时 `myIllegalDependencies` 恒空，
 * 这个开关若照常过滤就会把整张图清空（假控件）。
 */
export function filterLegalEdges<E extends { from: string; to: string; path: string; line: number }>(
  edges: readonly E[], violations: readonly DependencyViolation[], filterLegals: boolean,
): { edges: E[]; packages: string[] } {
  const keep = filterLegals && violations.length > 0
    ? edges.filter(edge => violations.some(item =>
      item.fromPath === edge.path && item.toPath === edge.to && item.line === edge.line))
    : [...edges]
  const packages = [...new Set(keep.flatMap(edge => [edge.from, edge.to]))].sort()
  return { edges: keep, packages }
}

/** 边是否违法（渲染层用它给那条边上色）。 */
export function isIllegalEdge(
  edge: { path: string; to: string; line: number }, violations: readonly DependencyViolation[],
): boolean {
  return violations.some(item => item.fromPath === edge.path && item.toPath === edge.to && item.line === edge.line)
}

// ---------------------------------------------------------------- 存档（形状照上游 XML 的字段名）

/** 上游 `DependencyValidationManagerImpl.java:57-62` 的六个名字，本仓存档沿用。 */
const DENY_RULE_KEY = 'deny_rule'
const FROM_SCOPE_KEY = 'from_scope'
const TO_SCOPE_KEY = 'to_scope'
const IS_DENY_KEY = 'is_deny'
const UNNAMED_SCOPE_KEY = 'unnamed_scope'
const VALUE_KEY = 'value'

/** 引用 → 序列化 id（命名作用域存名字、匿名作用域存模式文本，同上游 `writeRule:277-286`）。 */
export function scopeRefId(ref: DependencyScopeRef): string {
  if (ref.kind === 'standard') return ref.id
  if (ref.kind === 'named') return ref.name
  return ref.pattern
}

/**
 * 序列化 id → 引用（`DependencyValidationManagerImpl.getScope:264-276` 的三步：
 * 先看命名作用域，再看匿名作用域表，都没有 ⇒ 这条规则读不出来，`readRule:289-296` 直接丢）。
 */
export function scopeRefFromId(id: string, context: DependencyRuleContext, unnamed: readonly string[]): DependencyScopeRef | null {
  if (!id) return null
  if (context.namedScopes.some(scope => scope.name === id)) return { kind: 'named', name: id }
  if (unnamed.includes(id)) return { kind: 'unnamed', pattern: id }
  if (id === 'Project Files' || id === 'Project Test Files' || id === 'Generated Files' || id === 'All'
    || id === 'All Places' || id === 'Tests' || id === 'Current File') return { kind: 'standard', id }
  // 模式文本认得出来（含 `file:`/`ext:`/`projectPath:` 前缀）就当匿名作用域收下，
  // 与上游 `appendUnnamedScope:163-170` 的"没在命名表里就进 unnamed_scope"同一口径。
  if (/^(file|ext|projectPath)[\s]*[\[!:]/.test(id) || id.startsWith('[') || id.includes(':')) return { kind: 'unnamed', pattern: id }
  return null
}

interface StoredRule { [key: string]: unknown }

/**
 * 稳定序列化：`{deny_rule:[{from_scope,to_scope,is_deny}], unnamed_scope:[{value}]}`。
 * 两个 scope 任一解析不出来就不写那条（`writeRule:281-283` 的 null 分支）。
 */
export function serializeDependencyRules(rules: readonly DependencyRule[]): string {
  const stored: StoredRule[] = []
  const unnamed: string[] = []
  for (const rule of rules) {
    const from = scopeRefId(rule.from)
    const to = scopeRefId(rule.to)
    if (!from || !to) continue
    stored.push({ [FROM_SCOPE_KEY]: from, [TO_SCOPE_KEY]: to, [IS_DENY_KEY]: rule.deny })
    if (rule.from.kind === 'unnamed' && !unnamed.includes(rule.from.pattern)) unnamed.push(rule.from.pattern)
    if (rule.to.kind === 'unnamed' && !unnamed.includes(rule.to.pattern)) unnamed.push(rule.to.pattern)
  }
  if (!stored.length && !unnamed.length) return ''
  // 匿名作用域按上游 `getState:245-251` 的口径排序后写出。
  return JSON.stringify({ [DENY_RULE_KEY]: stored, [UNNAMED_SCOPE_KEY]: [...unnamed].sort().map(value => ({ [VALUE_KEY]: value })) })
}

/** 读回存档：坏数据一律退回空表（永不抛）；缺任一字段的规则整条丢（`readRule:289-296`）。 */
export function parseDependencyRules(raw: string | null | undefined, context: DependencyRuleContext): DependencyRule[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { deny_rule?: unknown; unnamed_scope?: unknown }
    const unnamed: string[] = Array.isArray(parsed?.unnamed_scope)
      ? parsed.unnamed_scope
        .map(entry => (entry as { value?: unknown })?.value)
        .filter((value): value is string => typeof value === 'string' && value !== '')
      : []
    const rules: DependencyRule[] = []
    for (const entry of Array.isArray(parsed?.deny_rule) ? parsed.deny_rule : []) {
      const item = entry as { from_scope?: unknown; to_scope?: unknown; is_deny?: unknown }
      if (typeof item?.from_scope !== 'string' || typeof item.to_scope !== 'string' || typeof item.is_deny !== 'boolean') continue
      const from = scopeRefFromId(item.from_scope, context, unnamed)
      const to = scopeRefFromId(item.to_scope, context, unnamed)
      if (!from || !to) continue
      rules.push({ from, to, deny: item.is_deny })
    }
    return rules
  } catch {
    return []
  }
}

/** 存档键：按工作区根分（与 `taocode.commitOptions:<root>` / `taocode.vcs.changesView.<root>` 同一族）。 */
export function dependencyRulesKey(workspaceRoot: string): string {
  return `taocode.dependencyRules.${encodeURIComponent(workspaceRoot)}`
}

/** 存储通道（`localStorage` 的窄接口；测试传内存实现，同 `src/commitOptions.ts` 的口径）。 */
export interface DependencyRulesStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

function globalStorage(): DependencyRulesStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 从存档读回规则（`storage` 缺省走 `localStorage`；坏数据退回空表）。 */
export function loadDependencyRules(workspaceRoot: string, context: DependencyRuleContext, storage?: DependencyRulesStorage): DependencyRule[] {
  return parseDependencyRules((storage ?? globalStorage())?.getItem(dependencyRulesKey(workspaceRoot)), context)
}

/** 写回存档：全空时删掉键，不在存档里留空壳（与 `commitOptions` 同一口径）。 */
export function saveDependencyRules(workspaceRoot: string, rules: readonly DependencyRule[], storage?: DependencyRulesStorage): void {
  const target = storage ?? globalStorage()
  if (!target) return
  const key = dependencyRulesKey(workspaceRoot)
  const text = serializeDependencyRules(rules)
  try {
    if (text) target.setItem(key, text)
    else target.removeItem?.(key)
  } catch {
    // 存不下只影响下次会话，本次分析照常按内存里的规则跑。
  }
}
