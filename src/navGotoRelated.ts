// Ctrl+Alt+Home「相关符号」（`lp/navigation` 判词里的 `GotoRelated`/`GotoTest`）。
//
// 上游依据（逐条）：
//   · 键位：`platform/platform-resources/src/keymaps/$default.xml:257-259` ——
//     `<action id="GotoRelated"><keyboard-shortcut first-keystroke="control alt HOME"/></action>`。
//   · 动作：`platform/lang-impl/src/com/intellij/ide/actions/GotoRelatedSymbolAction.kt:43-83`。
//     三档结果就是这一族的**全部用户可见行为**：
//       — 空 → 一个错误气泡，文案 `hint.text.no.related.symbols`
//         （`:69`，文本在 `platform/lang-api/resources/messages/LangBundle.properties:138` = "No related symbols"）；
//       — 恰好一条 → 直接导航（`:77-79` `items[0].navigate()`，**不出现任何弹层**）；
//       — 多条 → 弹层，标题 `popup.title.choose.target`（`:81`，
//         `LangBundle.properties:350` = "Choose Target"）。
//   · 条目形状：`platform/lang-api/src/com/intellij/navigation/GotoRelatedItem.java:23-43` ——
//     每条带一个 **group**（`:24`，弹层里的分隔标题；`:27` 的 `DEFAULT_GROUP_NAME = ""` = 不加分隔）。
//   · provider 契约：`platform/lang-api/src/com/intellij/navigation/GotoRelatedProvider.java:20-25`
//     （`getItems(PsiElement)` / `getItems(DataContext)`），EP 声明
//     `platform/lang-api/resources/intellij.platform.lang.xml:124`；社区树里注册的实现有
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:1126`、
//     `plugins/devkit/devkit-core/resources/intellij.devkit.core.xml:99-101`、
//     `plugins/junit/resources/META-INF/plugin.xml:125-126`、
//     `plugins/properties/resources/intellij.properties.backend.xml:135` ——
//     **本仓没有 EP 宿主**，所以 provider 表写成本模块里的一个数组（架构不等价处，见下）。
//   · 第一个 provider 就是"测试 ↔ 被测对象"：
//     `platform/lang-impl/src/com/intellij/testIntegration/GotoTestRelatedProvider.java:23-44`，
//     分组标题 `separator.goto.tests` / `separator.goto.tested.classes`
//     （`CodeInsightBundle.properties:561-562` = "Tests" / "Tested classes"）—— 规则本体复用
//     `src/navGotoTest.ts`（同一份上游依据在那个回答里）。
//
// 架构不等价处（本仓用本仓架构还原用户可见功能）：
//   · 上游 provider 靠 PSI 解析关系（注解、XML bean、i18n key）；本仓能真拿到后端的只有
//     **文件清单**（`workspace.entries`）这一种关系来源，所以表里只有两个 provider：
//     ①「测试 ↔ 被测对象」（名字规则，上游 `GotoTestRelatedProvider`）；
//     ②「同名不同扩展名的兄弟文件」（`Foo.h` ↔ `Foo.cpp` 这一对）—— 这一条在上游社区树里
//     **没有对应实现**（C/C++ 的 `GotoRelatedProvider` 在商业版 CLion，本 checkout 搜不到 ⇒
//     判词里按"无法核实上游依据、本仓自定"登记），但它的后端是真的（工作区文件清单），
//     不是假控件。
//   · 其余上游 provider（devkit 的 `*_TestData`、junit 的 `@Parameters` 源、properties 的 i18n、
//     Kotlin 的 expect/actual）都需要 PSI 或语言专属索引 ⇒ **不做**，卡点见报告。
//
// 消费链路：`src/menus/navigateMenu.ts` 的「相关符号…」行 + 宿主装配（接线请求见
// `docs/wiring-requests-2026-10-06-bucket4.md`）；判据 `tests/nav-goto-related.test.mjs`。
import { gotoTestDirection, findSubjectTargets, findTestTargets, baseNameOfPath, extensionOf, type RecentFileEntry } from './navGotoTest.ts'

/** 一个相关项（`GotoRelatedItem` 的文件级等价物：目标路径 + 分组标题 + 显示名）。 */
export interface RelatedItem {
  path: string
  /** 弹层里的分组标题；空串 = 不加分隔（上游 `DEFAULT_GROUP_NAME`，`GotoRelatedItem.java:27`）。 */
  group: string
  /** 显示名（上游 `getCustomName()`，`GotoRelatedItem.java:50`）。 */
  name: string
  /** provider 标识（判据与调试用，不进界面）。 */
  provider: string
}

/** `separator.goto.tests` / `separator.goto.tested.classes`（`CodeInsightBundle.properties:561-562`）。 */
export const RELATED_GROUP_TESTS = '测试'
export const RELATED_GROUP_TESTED_CLASSES = '被测类'

/** provider ①：测试 ↔ 被测对象（`GotoTestRelatedProvider.java:26-42` 的两分支）。 */
export function testRelatedItems(entries: readonly RecentFileEntry[], path: string): RelatedItem[] {
  const direction = gotoTestDirection(path)
  const targets = direction === 'toTest' ? findTestTargets(entries, path) : findSubjectTargets(entries, path)
  const group = direction === 'toTest' ? RELATED_GROUP_TESTS : RELATED_GROUP_TESTED_CLASSES
  return targets.map(target => ({ path: target.path, group, name: target.name, provider: 'test' }))
}

/** C/C++ 一类的"声明/实现"扩展名对：`.h` ↔ `.cpp/.cc/.cxx/.c/.hpp/.tpp/.ipp`。 */
const HEADER_EXTENSIONS: readonly string[] = ['h', 'hpp', 'hh', 'hxx', 'inl']
const SOURCE_EXTENSIONS: readonly string[] = ['c', 'cc', 'cpp', 'cxx', 'c++']

/**
 * provider ②：同名兄弟文件（`Foo.h` ↔ `Foo.cpp`）。
 * 方向与上游同构：当前是头文件就找实现文件，反之找声明文件；
 * 同类扩展名之间互不相关（`Foo.cpp` 的兄弟只有 `Foo.h`/`Foo.tpp`，不含 `Foo.cc`）。
 */
export function siblingFileItems(entries: readonly RecentFileEntry[], path: string): RelatedItem[] {
  const base = baseNameOfPath(path)
  const own = extensionOf(path)
  if (!base) return []
  const wanted = HEADER_EXTENSIONS.includes(own) ? SOURCE_EXTENSIONS
    : SOURCE_EXTENSIONS.includes(own) ? HEADER_EXTENSIONS
    : ['tpp', 'ipp', 'inl'].includes(own) ? [...HEADER_EXTENSIONS, ...SOURCE_EXTENSIONS]
    : null
  if (!wanted) return []
  const out: RelatedItem[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || entry.path === path) continue
    if (baseNameOfPath(entry.path) !== base) continue
    if (!wanted.includes(extensionOf(entry.path))) continue
    out.push({ path: entry.path, group: '实现 / 声明', name: base, provider: 'sibling' })
  }
  return out.sort((left, right) => left.path.localeCompare(right.path))
}

/** provider 表（上游 `gotoRelatedProvider` EP 的等价物；顺序 = 分组在弹层里的顺序）。 */
export const RELATED_PROVIDERS: readonly ((entries: readonly RecentFileEntry[], path: string) => RelatedItem[])[] = [
  testRelatedItems,
  siblingFileItems,
]

/** 收集全部 provider 的结果（上游 `collectRelatedItems`：按 provider 顺序累加，不做去重以外的加工）。 */
export function collectRelatedItems(entries: readonly RecentFileEntry[], path: string): RelatedItem[] {
  const seen = new Set<string>()
  const items: RelatedItem[] = []
  for (const provider of RELATED_PROVIDERS) {
    for (const item of provider(entries, path)) {
      const key = `${item.path}\u0000${item.group}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

/** 弹层分组（上游 `GotoRelatedItem.getGroup()` 的分段呈现）：按首次出现的组序，组内保持 provider 顺序。 */
export function groupRelatedItems(items: readonly RelatedItem[]): Array<{ group: string; items: RelatedItem[] }> {
  const out: Array<{ group: string; items: RelatedItem[] }> = []
  for (const item of items) {
    const bucket = out.find(entry => entry.group === item.group)
    if (bucket) bucket.items.push(item)
    else out.push({ group: item.group, items: [item] })
  }
  return out
}

/** 结果三档（`GotoRelatedSymbolAction.kt:63-82`）。 */
export type RelatedOutcome = 'none' | 'navigate' | 'popup'

export function relatedOutcome(items: readonly RelatedItem[]): RelatedOutcome {
  if (!items.length) return 'none'
  return items.length === 1 ? 'navigate' : 'popup'
}

/** `LangBundle.properties:138`（`GotoRelatedSymbolAction.kt:69`）—— 空结果的气泡文案。 */
export const NO_RELATED_SYMBOLS_MESSAGE = '没有相关符号。'

/** `LangBundle.properties:350`（`GotoRelatedSymbolAction.kt:81`）—— 多结果的弹层标题。 */
export const CHOOSE_TARGET_TITLE = '选择目标'

/** 动作标题（`ActionsBundle.properties:712-713` "_Related Symbol…" / 描述）。 */
export const GOTO_RELATED_ACTION_LABEL = '相关符号…'
