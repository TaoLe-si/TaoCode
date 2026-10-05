// 文件嵌套的**规则编辑器**（`pv/project-view-nodes` 族）—— 上游
// `FileNestingInProjectViewDialog`
// （`platform/lang-impl/src/com/intellij/ide/projectView/impl/FileNestingInProjectViewDialog.java`）
// 的纯逻辑：规则表 ⇄ 表格行，以及 `doValidate` 的三条校验。
//
// 上游那张表一行是 `CombinedNestingRule`（`:248-256`）：`parentSuffix` + **分号拼起来**的
// `childSuffixes`（`createTable` 的两列各读一个字段，`:137-160`）。规则本身
// （`NestingRule`）是一行一对父子后缀，所以这张表是「一对多」的折叠形态：
//   · 规则 → 行：`resetTable`（`:217-230`）先按 `RULE_COMPARATOR`
//     （`parent + " " + child`，`:45-46`）排序，再按父后缀塞进 `TreeMap`，
//     同一个父的第 2..n 条子后缀用 `"; "` 追加（`:226`）；
//   · 行 → 规则：`apply`（`:232-246`）按 `;` 切开、去空白、丢空项，塞进
//     `TreeSet<RULE_COMPARATOR>` —— 这一步顺带**去重并排序**；
//   · 父后缀在**编辑时**就 trim（`setValue`，`:143`），子后缀不（`:159`），
//     校验与切分时才 trim —— 所以「相等」判定比的是 `parentSuffix == child.trim()`。
//   · 上/下移两格按钮被显式关掉（`ToolbarDecorator...disableUpDownActions()`，`:114`），
//     表里没有那两格；本模块也不提供排序操作。
//   · 新增一行是空的 `("", "")`（`createElement`，`:110-112`）。
//
// 开关那一侧在 `ProjectViewState.useFileNestingRules`
// （`ProjectViewState.kt:49`），默认 **true**（`ProjectViewSettings.java:29-31`，
// `platform-tests/.../ProjectViewSettingsTest.kt:54` 也断言它是 true）；关掉时
// `NestingTreeStructureProvider.modify` 直接原样返回 children（`:48`）——
// 消费点在 `src/projectTreeModel.ts` 的 `nestingEnabled`。
//
// 文案抄中文语言包（`plugins/localization-zh/lib/localization-zh.jar` 的
// `messages/LangBundle.properties`），键与英文包一一对应。
import type { NestingRule } from './projectTreeNesting'

/** 表格里的一行 = 上游的 `CombinedNestingRule`（父后缀 + 分号拼起来的子后缀）。 */
export interface NestingRuleRow { parentSuffix: string; childSuffixes: string }

/**
 * `RULE_COMPARATOR`（`:45-46`）：`parentFileSuffix + " " + childFileSuffix`。
 * Java 的 `String.compareTo` 与 JS 的 `<` 都是 UTF-16 码元序，比的是同一个东西。
 */
function compareRules(aParent: string, aChild: string, bParent: string, bChild: string): number {
  const a = `${aParent} ${aChild}`
  const b = `${bParent} ${bChild}`
  return a < b ? -1 : a > b ? 1 : 0
}

/** 规则表 → 表格行（`resetTable`，`:217-230`）：父后缀升序，同一父的子后缀按排序后的次序用 `"; "` 拼。 */
export function nestingRowsOf(rules: readonly NestingRule[]): NestingRuleRow[] {
  const pairs: Array<{ parent: string; child: string }> = []
  for (const rule of rules) for (const child of rule.children ?? []) pairs.push({ parent: rule.parent, child })
  pairs.sort((a, b) => compareRules(a.parent, a.child, b.parent, b.child))
  const rows = new Map<string, string[]>()
  for (const { parent, child } of pairs) {
    const list = rows.get(parent)
    if (list) list.push(child)
    else rows.set(parent, [child])
  }
  return [...rows.entries()].map(([parentSuffix, children]) => ({ parentSuffix, childSuffixes: children.join('; ') }))
}

/** 表格行 → 规则表（`apply`，`:232-246`）：切分、去空白、丢空项，再按同一个次序去重排序。 */
export function nestingRulesOf(rows: readonly NestingRuleRow[]): NestingRule[] {
  const merged = new Map<string, string[]>()
  for (const row of rows) {
    const parent = row.parentSuffix.trim()
    merged.set(parent, (merged.get(parent) ?? []).concat(row.childSuffixes.split(';')))
  }
  const pairs: Array<{ parent: string; child: string }> = []
  const seen = new Set<string>()
  for (const [parent, children] of merged) {
    for (const child of children.map(value => value.trim()).filter(Boolean)) {
      const key = `${parent} ${child}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ parent, child })
    }
  }
  pairs.sort((a, b) => compareRules(a.parent, a.child, b.parent, b.child))
  return pairs.map(({ parent, child }) => ({ parent, children: [child] }))
}

/** 新增一行（`createElement`，`:110-112`）：两个字段都空。 */
export function newNestingRow(): NestingRuleRow { return { parentSuffix: '', childSuffixes: '' } }

/**
 * `doValidate`（`:185-208`）。开关关着时**不校验**（`:186` 直接 return null）。
 * 父空 / 子空 / 父与某个子相等 —— 三条都带**行号**（表里第几行，1 起）。
 * 父后缀在编辑时已 trim（`setValue`，`:143`），所以这里不再重复 trim。
 */
export function validateNestingRows(rows: readonly NestingRuleRow[], enabled: boolean): string {
  if (!enabled) return ''
  for (const [index, row] of rows.entries()) {
    const at = index + 1
    if (!row.parentSuffix) return `父文件后缀不得为空(请参见行 ${at})`
    if (!row.childSuffixes) return `子文件后缀不得为空(请参见行 ${at})`
    for (const child of row.childSuffixes.split(';')) {
      if (row.parentSuffix === child.trim()) return `父文件和子文件后缀不能相等('${row.parentSuffix}'，请参见行 ${at})`
    }
  }
  return ''
}
