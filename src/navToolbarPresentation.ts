// 导航栏扩展的**呈现面** —— 上游
// `platform/platform-impl/src/com/intellij/ide/navigationToolbar/NavBarModelExtension.java`（EP `com.intellij.navbar`）
// 与 `NavBarLeftSideExtension.java`（EP `com.intellij.navbarLeftSide`）。
//
// 链模型与扩展优先级已经在 `src/navBarModel.ts`（presentableText / parent / adjustElement /
// additionalRoots / processChildren 五项）。这里补的是**同一接口上没被覆盖的那一半**，
// 逐条对 `NavBarModelExtension.java` 的行号：
//   · `getIcon(object)`（`:36`）—— 段图标；`:38-40` 的 `getPresentableText(object, forPopup)`
//     是同一个名字的**弹层重载**（非弹层时委托给单参版），两者分开建模。
//   · `getPopupMenuGroup(dataContext)`（`:59`）—— 右键菜单走哪个组。
//   · `normalizeChildren()`（`:79-81`）—— 子元素要不要归一（默认 true = 放行）。
//   · `shouldExpandOnClick(psiElement)`（`:84-86`）—— **三态**：null = 由调用方走默认；
//     true/false 才是扩展的明确意见（这正是「点段弹兄弟列表 vs 直接跳转」那个开关）。
//   · `IGNORE_IN_NAVBAR`（`:34`）—— `Key<Boolean>`，把某个对象从导航栏里剔掉。
//
// `NavBarLeftSideExtension`（`:12-16`）在本版本只有 `process(panel, project)` 一个方法：
// **没有任何 getter/setter 契约**，实现自己往左侧那块面板里画东西。
// 取证结果：EP 声明在 `platform/platform-impl/resources/intellij.platform.ide.impl.xml:378`，
// 但本 checkout 里**没有任何一处注册实现**（全树只有那一条声明与接口自身）。
// ⇒ 左侧根切换面板画的是什么、列出哪些根，**无法核实**。这里只把「扩展往左侧贡献根」这件事
// 建模成一张可注入的根表（`NavBarLeftSideRoots`），不臆造上游没有的 switchRoot 之类的 API。
//
// 消费链现状：面包屑那一行是 `src/App.vue` 内联的模板（本批冻结），所以本模块与
// `src/navBarModel.ts` 一样是**规则层**，只被测试消费（playbook §3：没有消费链路就不渲染）。

import type { NavBarElement } from './navBarModel'

/** 上游 `NavBarModelExtension` 在本仓的呈现面。`src/navBarModel.ts` 已覆盖链与优先级，这里只补剩下的。 */
export interface NavBarPresentationExtension {
  /** `getIcon(object)`（`:36`）：null = 让下一个扩展/默认处理。 */
  getIcon?: (element: NavBarElement) => string | null
  /** `getPresentableText(object)` 的**弹层重载**（`:38-40`）：只作用于弹层里的那一行。 */
  getPopupPresentableText?: (element: NavBarElement) => string | null
  /** `getPopupMenuGroup(dataContext)`（`:59`）：null = 不挂自定义菜单组。 */
  getPopupMenuGroup?: (element: NavBarElement) => string | null
  /** `normalizeChildren()`（`:79-81`）：false = 该扩展接管子元素的归一。 */
  normalizeChildren?: () => boolean
  /** `shouldExpandOnClick(psiElement)`（`:84-86`）：**null = 走调用方默认**。 */
  shouldExpandOnClick?: (element: NavBarElement) => boolean | null
}

/**
 * 扩展遍历顺序与 `src/navBarModel.ts` 一致：自定义在前、默认扩展兜底
 * （`NavBarModelExtension.java:23-26` 的类注释：默认实现「normally registered as last」）。
 * 呈现面没有默认扩展（`getIcon` 等的 default 实现就是 `return null`，`:36`、`:59`、`:84-86`），
 * 所以这里只有扩展表，兜底是各方法自己的 `null`。
 */
function firstNonNull<T>(extensions: readonly NavBarPresentationExtension[], pick: (extension: NavBarPresentationExtension) => T | null | undefined): T | null {
  for (const extension of extensions) {
    const value = pick(extension)
    if (value !== null && value !== undefined) return value
  }
  return null
}

/** `getIcon`（`:36`）：首个非 null 命中；全都没有就是「这一段没有图标」。 */
export function navBarIcon(extensions: readonly NavBarPresentationExtension[], element: NavBarElement): string | null {
  return firstNonNull(extensions, extension => extension.getIcon?.(element) ?? null)
}

/**
 * 弹层里那一行的文字（`getPresentableText(object, forPopup=true)`，`:38-40`）。
 * 上游那行 default 方法的实现是 `return getPresentableText(object)` ——
 * 也就是**没重载就退回普通标签**。这里同口径：没有弹层重载时用 `fallback`（由调用方传
 * `src/navBarModel.ts` 的 `presentableText` 结果）。
 */
export function navBarPopupText(extensions: readonly NavBarPresentationExtension[], element: NavBarElement, fallback: string): string {
  return firstNonNull(extensions, extension => extension.getPopupPresentableText?.(element) ?? null) ?? fallback
}

/** `getPopupMenuGroup`（`:59`）：null = 右键没有自定义组。 */
export function navBarPopupMenuGroup(extensions: readonly NavBarPresentationExtension[], element: NavBarElement): string | null {
  return firstNonNull(extensions, extension => extension.getPopupMenuGroup?.(element) ?? null)
}

/**
 * `normalizeChildren()`（`:79-81`）：默认方法返回 `true`。
 * **首个 false 即接管**（上游语义是「返回 false 表示这一层不由平台归一」）。
 */
export function navBarNormalizeChildren(extensions: readonly NavBarPresentationExtension[]): boolean {
  for (const extension of extensions) if (extension.normalizeChildren?.() === false) return false
  return true
}

/**
 * `shouldExpandOnClick`（`:84-86`）：返回 `Boolean` 而不是 `boolean` ——
 * null 是「扩展没意见，调用方自己定」，所以**不能**用 `?? false` 把它折叠掉。
 * 首个**非 null** 命中生效。
 */
export function navBarShouldExpandOnClick(extensions: readonly NavBarPresentationExtension[], element: NavBarElement): boolean | null {
  for (const extension of extensions) {
    const value = extension.shouldExpandOnClick?.(element)
    if (value !== null && value !== undefined) return value
  }
  return null
}

/**
 * 点这一段是**导航**还是**弹子项下拉**（`platform/navbar/backend/src/NavBarItem.kt:50-54`
 * 的 `navigateOnClick()`，默认 `false` = 「弹下一层 children」）。
 *
 * 判定照抄 `platform/navbar/backend/src/impl/DefaultNavBarItem.kt:188-198` 的三步：
 *   1. 旧扩展给了明确意见（`shouldExpandOnClick(data)` 非 null）⇒ 取它的**反**（`:191-193`）；
 *   2. 否则按元素类型：目录（`data is PsiDirectory` / `PsiDirectoryContainer`）⇒ **不**导航（`:197`）；
 *   3. 其它（文件、PSI 命名元素）⇒ 导航。
 *
 * 本仓的等价物：面包屑的 `dir` 段（以及作为目录的 `root` 段）就是 `PsiDirectory`，
 * `file` 段对应「其它」。没有 PSI 目录对象，`kind` 就是唯一的判据。
 */
export function navBarNavigatesOnClick(extensions: readonly NavBarPresentationExtension[], element: NavBarElement): boolean {
  const shouldExpand = navBarShouldExpandOnClick(extensions, element)
  if (shouldExpand !== null) return !shouldExpand
  return element.kind === 'file'
}

/** `IGNORE_IN_NAVBAR`（`:34`）的 `Key<Boolean>`：把某个对象从导航栏里剔掉。 */
export const IGNORE_IN_NAVBAR = 'IGNORE_IN_NAVBAR'

/** 剔除判定：`Key` 的值存在就是 true；上游是 `Key<Boolean>`，用 `contains` 判存在。 */
export function navBarIgnored(element: NavBarElement, userData: Readonly<Record<string, boolean>>): boolean {
  return userData[`${IGNORE_IN_NAVBAR}:${element.path}`] === true
}

// ——— NavBarLeftSideExtension（EP `com.intellij.navbarLeftSide`）———

/**
 * 左侧根表的**注入形状**。上游 `NavBarLeftSideExtension.process(panel, project)`（`:15`）
 * 没有返回根的契约 —— 扩展直接往 Swing 面板上画，所以「有哪些根」这件事在上游是**不可查询**的。
 * 本仓把它翻成数据：一个扩展贡献若干根，按注入顺序合并、路径去重。
 *
 * 取证边界：本 checkout 里 `com.intellij.navbarLeftSide` **只有 EP 声明没有实现**
 * （`platform/platform-impl/resources/intellij.platform.ide.impl.xml:378`），
 * 所以「上游默认画哪几个根」**无法核实**，这里的初始表留空由调用方注入 ——
 * 本仓单根工作区，默认只有工作区根一个（与 `src/navBarModel.ts` 的 `roots()` 兜底一致）。
 */
export interface NavBarLeftSideExtension {
  /** 扩展贡献的根（工作区相对路径；根是空串）。 */
  roots: () => readonly NavBarElement[]
}

/** 合并后的左侧根表：注入顺序在前，工作区根兜底在后，路径去重。 */
export function navBarLeftSideRoots(extensions: readonly NavBarLeftSideExtension[], workspaceRoot: NavBarElement): NavBarElement[] {
  const seen = new Set<string>([workspaceRoot.path])
  const out: NavBarElement[] = [workspaceRoot]
  for (const extension of extensions) {
    for (const root of extension.roots()) {
      if (seen.has(root.path)) continue
      seen.add(root.path)
      out.push(root)
    }
  }
  return out
}
