// Ctrl+Shift+T「转到测试 / 转到被测对象」（`lp/navigation` 判词里的 `GotoTest`/`GotoTestUtil`）。
//
// 上游依据（逐条）：
//   · 键位与动作：`platform/platform-resources/src/keymaps/$default.xml:254-256`
//     —— `<action id="GotoTest"><keyboard-shortcut first-keystroke="control shift T"/></action>`；
//     动作本体 `platform/lang-impl/src/com/intellij/testIntegration/GotoTestOrCodeAction.java`，
//     处理逻辑 `platform/lang-impl/src/com/intellij/testIntegration/GotoTestOrCodeHandler.java:42-99`。
//   · 方向判定：`GotoTestOrCodeHandler.java:50-60` —— `isTest(光标处)` 就找**被测类**，
//     否则找**测试**；两个方向共用同一套候选名生成。
//   · 「测试 → 被测对象」的候选名表：`TestFinderHelper.collectPossibleClassNamesWithWeights`
//     （`platform/lang-impl/src/com/intellij/testIntegration/TestFinderHelper.java:115-127`）——
//     把测试名按驼峰拆词，取**所有连续词段**拼起来当候选类名，权重 = `词数 - from + to`；
//     调用方按权重**降序**排（`java/java-impl/src/com/intellij/testIntegration/JavaTestFinder.java:62`）。
//   · 「被测对象 → 测试」的匹配式：`JavaTestFinder.java:110` ——
//     `NameUtil.buildMatcher("*" + klassName, MatchingMode.IGNORE_CASE)`，即**大小写不敏感的"包含"**；
//     排序按 `TestFinderHelper.calcTestNameProximity`（`TestFinderHelper.java:85-90`：
//     `testName.indexOf(className) + testName.length() - className.length()`）**升序**
//     （`JavaTestFinder.java:95` 的 `getSortedElements(…, true)`）。
//   · 候选名先剥代码风格的前后缀：`JavaTestFinder.java:105-106`（`SUBCLASS_NAME_PREFIX`/`_SUFFIX`，
//     出厂默认 = `""` 与 `"Impl"`，见
//     `java/java-frontback-impl/src/com/intellij/psi/codeStyle/JavaCodeStyleSettings.java:49`/`:56`）；
//     剥完为空就退回原名（`JavaTestFinder.java:107-109`）。
//   · 谁算测试 / 谁算被测：`JavaTestFinder.java:122-124`（`isTestClass(每条) || isPotentialTestClass`）
//     与 `JavaTestFinder.java:76-82`（被测 = **不是** annotation、**不是**测试类、必须是物理文件里的）；
//     "潜在测试类" = 在测试源根里（`java/java-impl/src/com/intellij/testIntegration/JavaTestFramework.java:151-159`
//     的 `isUnderTestSources`，走 `ProjectFileIndex.isInTestSourceContent`；
//     `plugins/junit/src/com/intellij/execution/junit/JUnit4Framework.java:55-58` 的
//     `canBePotential` 分支同一条）。
//   · 一条结果直接跳、多条开弹层、零条给文案：`GotoTestOrCodeHandler.java:111-134`
//     （标题 `CodeInsightBundle.properties:111` "Choose Test for {0} ({1} found)"、
//     `:113` "Choose Test Subject for {0} ({1} found)"，未找到 `:115` "No test subjects found"）；
//     动作标题两档：`ActionsBundle.properties:701-707`（Go to Test / Go to Test Subject）。
//   · 同一条规则也被 GotoRelated 复用：`platform/lang-impl/src/com/intellij/testIntegration/GotoTestRelatedProvider.java:23-44`。
//
// 架构不等价处（本仓用本仓架构还原用户可见功能）：
//   · 上游比对的是 **PSI 类**（索引里的 `PsiClass`），本仓比对的是**工作区文件清单里的文件名主干**
//     （`workspace.entries`）。Java/Kotlin/C# 这类"公有类 = 文件名"的语言里两者同解；
//     C++/TS/Python 一个文件可能有多个类，本仓按文件级给出目标（差异：可能落到文件首行而不是类声明行，
//     宿主若能取到目标文件的 `documentSymbol` 就把它对准类声明行 —— `deps.lineOf`）。
//   · 上游"是不是测试类"看注解 + 测试源根；本仓没有 PSI，也没有模块源根表，
//     用**路径里的测试目录标记** + **名字前后缀**两档判定（`TEST_SOURCE_MARKERS`/`TEST_NAME_MARKERS`，
//     形状抄 `isUnderTestSources` + `canBePotential`，标记清单本身是**本仓自定**，逐条写在这里）。
//   · "创建新测试"那一项（`GotoTestOrCodeHandler.java:74-95` 的 `LanguageTestCreators`）没有接：
//     本仓没有测试生成器后端（`src/generateRefactor.ts` 属桶 1，且没有 JUnit 骨架生成路径）⇒ 不放假按钮。
//
// 消费链路：`src/navGotoRelated.ts`（把这一族当成 GotoRelated 的第一个 provider）与
// `src/menus/navigateMenu.ts` 的菜单行；判据 `tests/nav-goto-test.test.mjs`。
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'

/** 工作区文件清单的最小形状（`src/bridge.ts` 的 `Entry` 的子集，不 import 桥接层免得拖进 Vue）。 */
export interface RecentFileEntry { path: string; kind: 'file' | 'directory' }
/** 测试源根的路径标记（本仓自定清单；判定形状 = 上游 `isUnderTestSources`）。 */
export const TEST_SOURCE_MARKERS: readonly string[] = [
  '/src/test/', '/test/', '/tests/', '/testing/', '/__tests__/', '/spec/', '/it/ut/', '/ut/',
]

/** 名字上的测试标记：后缀（`FooTest`/`FooTests`/`FooIT`/`FooSpec`/`foo_test`）与前缀（`TestFoo`/`test_foo`）。 */
export const TEST_NAME_SUFFIXES: readonly string[] = ['Tests', 'Test', 'TestCase', 'Spec', 'IT', '_test', '.test']
export const TEST_NAME_PREFIXES: readonly string[] = ['Test', 'test_', 'spec_']

/** 剥掉的前后缀：`JavaTestFinder.java:105-106` 用的是代码风格设置，出厂默认 = 空前缀 + `Impl` 后缀。
 *  标成 `string` 而不是字面量：这是**设置值**（出厂默认恰好是空串），窄成 `''` 会让下面的
 *  「非空才剥」判据被 TS 判成恒假。 */
export const SUBCLASS_NAME_PREFIX: string = ''
export const SUBCLASS_NAME_SUFFIX: string = 'Impl'

/** 路径归一（`\` → `/`，去掉 `./`）。 */
function normalize(path: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/** 文件主干名（去目录、去扩展名）。 */
export function baseNameOfPath(path: string): string {
  const leaf = normalize(path).split('/').pop() ?? ''
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(0, dot) : leaf
}

/** 扩展名（小写，不带点；没有返回空串）。 */
export function extensionOf(path: string): string {
  const leaf = normalize(path).split('/').pop() ?? ''
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : ''
}

/**
 * `JavaTestFinder.java:105-109`：剥代码风格前后缀，剥空退回原名。
 * （上游读 `JavaCodeStyleSettings`；本仓没有该设置项的宿主 ⇒ 用出厂常量。）
 */
export function stripSubclassAffixes(name: string): string {
  let stripped = name
  if (SUBCLASS_NAME_PREFIX && stripped.startsWith(SUBCLASS_NAME_PREFIX)) stripped = stripped.slice(SUBCLASS_NAME_PREFIX.length)
  if (SUBCLASS_NAME_SUFFIX && stripped.endsWith(SUBCLASS_NAME_SUFFIX)) stripped = stripped.slice(0, -SUBCLASS_NAME_SUFFIX.length)
  return stripped || name
}

/** 一个路径是不是测试文件（路径标记 ∨ 名字标记）。 */
export function isTestPath(path: string): boolean {
  const normalized = normalize(path).toLowerCase()
  if (TEST_SOURCE_MARKERS.some(marker => normalized.includes(marker))) return true
  const base = baseNameOfPath(path)
  if (!base) return false
  if (TEST_NAME_SUFFIXES.some(suffix => base.endsWith(suffix))) return true
  return TEST_NAME_PREFIXES.some(prefix => base.startsWith(prefix))
}

/**
 * `NameUtilCore.splitNameIntoWordList` 的等价物：驼峰 + 分隔符拆词。
 * 规则：先按 `_`/`-`/`.`/空格切开，再在每段里按"小写→大写"与"字母→数字"的边界切；
 * 连续大写（缩写 `URL`）算一个词，末位小写归下一词（`HTTPServer` → `HTTP`,`Server`）。
 */
export function nameWords(name: string): string[] {
  const chunks = (name ?? '').split(/[_\-.\s/]+/).filter(Boolean)
  const words: string[] = []
  for (const chunk of chunks) {
    let current = ''
    for (let index = 0; index < chunk.length; ++index) {
      const char = chunk[index]!
      const previous = index > 0 ? chunk[index - 1]! : ''
      const next = index + 1 < chunk.length ? chunk[index + 1]! : ''
      const startsWord = index > 0
        && ((previous !== previous.toUpperCase() && char === char.toUpperCase())
            || (/[0-9]/.test(char) !== /[0-9]/.test(previous))
            || (previous === previous.toUpperCase() && char === char.toUpperCase() && next === next.toLowerCase()))
      if (startsWord && current) words.push(current)
      if (startsWord && current) current = ''
      current += char
    }
    if (current) words.push(current)
  }
  return words
}

/**
 * `TestFinderHelper.java:115-127`：测试名 → 所有连续词段拼成的候选类名 + 权重。
 * 权重公式照抄 `words.size() - from + to`（上游用它做降序排序，`JavaTestFinder.java:62`）。
 */
export function possibleSubjectNames(testName: string): Array<{ name: string; weight: number }> {
  const words = nameWords(testName)
  const out: Array<{ name: string; weight: number }> = []
  for (let from = 0; from < words.length; from++) {
    for (let to = from; to < words.length; to++) {
      out.push({ name: words.slice(from, to + 1).join(''), weight: words.length - from + to })
    }
  }
  return out
}

/** `TestFinderHelper.java:85-90` 的原式：`indexOf(className) + (testName.length - className.length)`。 */
export function testNameProximity(className: string, testName: string): number {
  return testName.indexOf(className) + testName.length - className.length
}

/**
 * `getSortedElements`（`TestFinderHelper.java:97-110`）：权重先按方向排，同权重比名字。
 * `descending=false` 对应"被测对象 → 测试"的升序（`JavaTestFinder.java:95`），
 * `descending=true` 对应"测试 → 被测对象"的降序（`JavaTestFinder.java:62`）。
 */
export function sortWeighted<T extends { weight: number; name: string }>(items: readonly T[], descending: boolean): T[] {
  return [...items].sort((left, right) => {
    const byWeight = descending ? right.weight - left.weight : left.weight - right.weight
    if (byWeight !== 0) return byWeight
    return left.name.localeCompare(right.name)
  })
}

/** 被测对象的条件（`JavaTestFinder.java:76-82`：不是测试文件、且不是 annotation/接口声明文件）。 */
function isSubjectFile(entry: RecentFileEntry): boolean {
  return entry.kind === 'file' && !isTestPath(entry.path)
}

/**
 * 「被测对象 → 测试」：`JavaTestFinder.java:98-120` 的文件级等价物 ——
 * 名字**大小写不敏感的包含**（`:110` 的 `"*" + klassName` + IGNORE_CASE）+ 测试判定 + 邻近度升序。
 */
export function findTestTargets(entries: readonly RecentFileEntry[], path: string): Array<{ path: string; name: string; weight: number }> {
  const base = stripSubclassAffixes(baseNameOfPath(path))
  if (!base) return []
  const needle = base.toLowerCase()
  const hits: Array<{ path: string; name: string; weight: number }> = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !isTestPath(entry.path)) continue
    const name = baseNameOfPath(entry.path)
    if (!name.toLowerCase().includes(needle)) continue
    hits.push({ path: entry.path, name, weight: testNameProximity(base, name) })
  }
  return sortWeighted(hits, false)
}

/**
 * 「测试 → 被测对象」：`JavaTestFinder.java:42-62` 的文件级等价物 ——
 * 候选名表（`possibleSubjectNames`，权重降序）逐个与工作区文件的**名字主干全等**比对
 * （上游 `cache.getClassesByName(name)` 也是全等命中），再过滤掉测试文件本身。
 */
export function findSubjectTargets(entries: readonly RecentFileEntry[], path: string): Array<{ path: string; name: string; weight: number }> {
  const base = baseNameOfPath(path)
  if (!base) return []
  const byName = new Map<string, RecentFileEntry>()
  for (const entry of entries) {
    if (!isSubjectFile(entry)) continue
    const name = baseNameOfPath(entry.path)
    // 同名文件（不同目录）只留第一条：上游的 `getClassesByName` 会返回全部，
    // 但本仓的文件级候选没有"包名"可比，留多条只会让弹层重复同一行。
    if (name && !byName.has(name)) byName.set(name, entry)
  }
  const hits: Array<{ path: string; name: string; weight: number }> = []
  for (const candidate of possibleSubjectNames(base)) {
    const entry = byName.get(candidate.name)
    if (!entry) continue
    hits.push({ path: entry.path, name: candidate.name, weight: candidate.weight })
  }
  return sortWeighted(hits, true)
}

/** 方向：当前文件是测试就找被测对象，否则找测试（`GotoTestOrCodeHandler.java:50-60`）。 */
export type TestOrCodeDirection = 'toTest' | 'toSubject'

export function gotoTestDirection(path: string): TestOrCodeDirection {
  return isTestPath(path) ? 'toSubject' : 'toTest'
}

/** 一次 Ctrl+Shift+T 的目标表。 */
export function gotoTestTargets(entries: readonly RecentFileEntry[], path: string): { direction: TestOrCodeDirection; targets: Array<{ path: string; name: string; weight: number }> } {
  const direction = gotoTestDirection(path)
  return { direction, targets: direction === 'toTest' ? findTestTargets(entries, path) : findSubjectTargets(entries, path) }
}

/**
 * 弹层标题（`GotoTestOrCodeHandler.java:111-119` → `CodeInsightBundle.properties:111`/`:113`：
 * "Choose Test for {0} ({1} found)" / "Choose Test Subject for {0} ({1} found)"）。
 * 上游还有 `{2}` = `" so far"`（增量搜索未完成时的尾巴）—— 本仓一次算完，永远传空串。
 */
export function gotoTestChooserTitle(direction: TestOrCodeDirection, name: string, found: number): string {
  return direction === 'toTest' ? `选择“${name}”的测试（找到 ${found} 个）` : `选择“${name}”的被测对象（找到 ${found} 个）`
}

/** 未找到的文案（`CodeInsightBundle.properties:115` "No test subjects found"）。 */
export function gotoTestNotFoundMessage(direction: TestOrCodeDirection): string {
  return direction === 'toTest' ? '没有找到测试。' : '没有找到被测对象。'
}

/** 动作/菜单标题两档（`ActionsBundle.properties:701`/`:705`；主菜单短形式 `:703`/`:706`）。 */
export function gotoTestActionLabel(direction: TestOrCodeDirection, mainMenu = false): string {
  if (direction === 'toTest') return mainMenu ? '测试' : '转到测试'
  return mainMenu ? '被测对象' : '转到被测对象'
}

/**
 * 目标文件的落点行：有符号表时对准**最外层的类声明行**（上游 `EditSourceUtil.navigateToPsiElement`
 * 跳的是类本身），没有就退回文件首行（差异见文件头）。
 */
export function targetLineOfSymbol(symbols: readonly { kind: number; startLine: number }[] | null | undefined): number {
  if (!symbols || !symbols.length) return 0
  const classLike = symbols.filter(symbol => CLASS_LIKE_SYMBOL_KINDS.has(symbol.kind))
  const chosen = classLike.length ? classLike[0] : symbols[0]
  return chosen ? Math.max(0, chosen.startLine) : 0
}
