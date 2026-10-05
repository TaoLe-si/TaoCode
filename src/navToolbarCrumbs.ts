// 面包屑的呈现与扩展面 —— 上游 `pf/breadcrumbs` 那一族里
// 「符号链之外的另一半」：
//   · `platform/platform-api/src/com/intellij/xml/breadcrumbs/BreadcrumbsPresentationProvider.java`
//     （EP `com.intellij.breadcrumbsPresentationProvider`，`:24-25`）
//   · `.../xml/breadcrumbs/CrumbPresentation.java`（`:20-22`，只有一个 `getBackgroundColor`）
//   · `platform/platform-impl/src/com/intellij/xml/breadcrumbs/DefaultCrumbsPresentation.java`（`:20-25`）
//   · `platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsComponent.java:639-661`
//     （`ButtonSettings` 的两处背景色判定 + `PainterSettings.getKey`，`:622-631`）
//   · `platform/platform-api/src/com/intellij/xml/breadcrumbs/LazyTooltipCrumb.java:9-15`
//   · `platform/editor-ui-api/src/com/intellij/ui/breadcrumbs/BreadcrumbsProvider.java:21-103`
//     （EP `com.intellij.breadcrumbsInfoProvider`）
//   · `platform/platform-impl/src/com/intellij/xml/breadcrumbs/BreadcrumbsForceShownSettings.java:16-26`
//
// 链模型与扩展优先级在 `src/breadcrumbs.ts` + `src/navBarModel.ts`（符号段、兄弟下拉、段跳转）。
// 这里补的是判词里列的 ②③④ 三条：按语言的 provider 注册面、呈现细节（图标/背景/懒 tooltip）、
// 按文件强制显示。
//
// **背景色不落 hex**：上游给的是 `EditorColors.BREADCRUMBS_*` 四个**语义键**（`:641-647`），
// 本仓对应 `src/tokens.css` 的语义 class，所以本模块返回的是**令牌名**而不是颜色值
// （playbook §5：禁裸 hex）。上游那四个键的取舍顺序是本文件的核心规则，逐字照抄。

/** 上游 `EditorColors` 的四个语义键（`BreadcrumbsComponent.java:641-647`）。 */
export type CrumbColorKey = 'BREADCRUMBS_HOVERED' | 'BREADCRUMBS_CURRENT' | 'BREADCRUMBS_INACTIVE' | 'BREADCRUMBS_DEFAULT'

/** 一个段此刻的样子（`Crumb.isSelected/isHovered/isLight` + `Crumb instanceof NavigationCrumb`）。 */
export interface CrumbState {
  selected: boolean
  hovered: boolean
  /** `isLight()`：段是否处于「浅色」形态（上游指非当前段、非导航段的普通段）。 */
  light: boolean
  /** `c instanceof NavigationCrumb`（`:628`、`:645`）：导航段不吃 INACTIVE 那一档。 */
  navigation: boolean
}

/**
 * `BreadcrumbsComponent.ButtonSettings.getBackgroundColor(selected, hovered, light, navigationCrumb)`
 * （`:639-648`）的判定顺序，**逐级照抄**：
 *   hovered → HOVERED；否则 selected → CURRENT；
 *   否则 `light && !navigationCrumb` → INACTIVE；否则 DEFAULT。
 * 注意 `navigationCrumb` **只**影响 INACTIVE 那一档（`:645`）——
 * 导航段在 light 态落回 DEFAULT，而不是升到 CURRENT。
 */
export function crumbColorKey(state: CrumbState): CrumbColorKey {
  if (state.hovered) return 'BREADCRUMBS_HOVERED'
  if (state.selected) return 'BREADCRUMBS_CURRENT'
  if (state.light && !state.navigation) return 'BREADCRUMBS_INACTIVE'
  return 'BREADCRUMBS_DEFAULT'
}

/**
 * 本仓的令牌名映射（`src/tokens.css` 的语义层）。**这是本仓的映射，不是上游的值** ——
 * 上游给的是编辑器配色方案的键，跨架构不照抄像素，只照抄「选哪一档」。
 */
export const CRUMB_TOKEN_CLASS: Record<CrumbColorKey, string> = {
  BREADCRUMBS_HOVERED: 'crumb-bg-hovered',
  BREADCRUMBS_CURRENT: 'crumb-bg-current',
  BREADCRUMBS_INACTIVE: 'crumb-bg-inactive',
  BREADCRUMBS_DEFAULT: 'crumb-bg-default',
}

/**
 * `CrumbPresentation`（`CrumbPresentation.java:20-22`）只有一个方法：
 * `getBackgroundColor(selected, hovered, light)`。注意它**没有** `navigation` 参数 ——
 * 也就是说自定义呈现拿到的是三态，拿不到 `NavigationCrumb` 那个区分。
 */
export interface CrumbPresentation {
  background: (selected: boolean, hovered: boolean, light: boolean) => CrumbColorKey
}

/**
 * `DefaultCrumbsPresentation`（`DefaultCrumbsPresentation.java:20-25`）：
 * 委托给 `ButtonSettings.getBackgroundColor(..., navigationCrumb = false)`（`:23` 末位那个 `false`）。
 * 也就是说**默认呈现永远把 navigationCrumb 当 false**，`crumbColorKey` 里的 INACTIVE 判定
 * 在默认路径上不受 `NavigationCrumb` 影响。
 */
export const defaultCrumbPresentation: CrumbPresentation = {
  background: (selected, hovered, light) => crumbColorKey({ selected, hovered, light, navigation: false }),
}

/**
 * `BreadcrumbsPresentationProvider.getCrumbPresentations(PsiElement[] element)`（`:27`）：
 * 返回的数组**与传入的元素数组按位对齐**，某一格可以是 null（那一段就走默认呈现）。
 * 本仓的元素是「段」而不是 `PsiElement`，规则不变。
 */
export interface BreadcrumbsPresentationProvider {
  /** 贡献哪些段的呈现（按位对齐；贡献不到的段留空）。 */
  presentations: (crumbs: readonly CrumbInput[]) => readonly (CrumbPresentation | null)[]
}

/** 一段的最小形状：`BreadcrumbsProvider` 那一族共同认的东西。 */
export interface CrumbInput {
  /** `getElementInfo`（`BreadcrumbsProvider.java:43-44`）：段上显示的文字。 */
  text: string
  /** 该段的稳定身份（`path` 或符号的 name+kind），用来在 provider 之间对齐。 */
  key: string
}

/**
 * 逐位合并各 provider 的呈现（`:27` 的按位对齐语义）：
 * 后面的 provider 只能填**还空着**的格子 —— 上游是多个 provider 按 EP 顺序取第一个非 null，
 * 这里同口径（EP 顺序 = 注入顺序）。
 */
export function resolveCrumbPresentations(
  providers: readonly BreadcrumbsPresentationProvider[],
  crumbs: readonly CrumbInput[],
): (CrumbPresentation | null)[] {
  const out: (CrumbPresentation | null)[] = crumbs.map(() => null)
  for (const provider of providers) {
    const given = provider.presentations(crumbs)
    for (let index = 0; index < out.length && index < given.length; ++index) {
      if (out[index] === null && given[index]) out[index] = given[index]
    }
  }
  return out
}

/**
 * `ButtonSettings.getBackgroundColor(Crumb c)`（`:652-661`）的**分流**：
 * 段自带 `CrumbPresentation` 就用它（`:655-658`），否则退回
 * `PainterSettings.getBackgroundColor` → `getAttributes(getKey(c))`（`:603-605`、`:622-631`）。
 * `getKey`（`:622-631`）的判定比 `ButtonSettings` 那个静态版**多一条**：它先看
 * `c instanceof NavigationCrumb` 之前是 `isLight()`，但 `light` 档同样带 `&& !(c instanceof NavigationCrumb)`。
 * 两处规则实质一致，这里统一走 `crumbColorKey`。
 */
export function crumbColor(presentation: CrumbPresentation | null, state: CrumbState): CrumbColorKey {
  return presentation
    ? presentation.background(state.selected, state.hovered, state.light)
    : crumbColorKey(state)
}

// ——— 段状态（`Crumb.isSelected`/`isLight` 的赋值）———

/**
 * 逐段算出 `selected` / `hovered` / `light` 三个态 —— 上游那四档判定（`:43-48`）的输入，
 * 上一轮只落了判定本身、没人算状态，这里补上。
 *
 * 两条上游依据：
 *   · `platform/navbar/frontend/src/vm/impl/NavBarVmImpl.kt:211-213`
 *     `isInactive() = _selectedIndex.value != -1 && _selectedIndex.value < index`
 *     ⇒ **light（inactive）= 选中段之后的所有段**；没选中（-1）时没有一段是 light；
 *   · `platform/platform-impl/.../breadcrumbs/BreadcrumbsComponent.java:199-228`
 *     `setSelectedCrumb` 的同一口径：`light` 从 false 起，走过选中段后置 true（`:216-219`），
 *     即「选中段**之前**是 DEFAULT，之后是 INACTIVE」。
 *
 * 取证边界（不实现的一条）：`BreadcrumbsComponent.java:206-208` 那个「同一个 `item` 再出现就把
 * light 拉回 false」的分支，本仓**照不出来也没有可观测后果** —— 依据 `:212-214`，`light` 为 true 时
 * 根本不往 `items` 里记 key，所以换行后左半段重复出现的元素查不到，条件恒不成立。故按上面两条
 * 更直接的口径实现。
 *
 * `navigation`（`c instanceof NavigationCrumb`）不在这里判：它是**段的类属**，由调用方按段传入，
 * 没有段是导航段时统一传 false（`DefaultCrumbsPresentation.java:23` 的默认呈现也这么干）。
 */
export function crumbStates(count: number, selectedIndex: number, hoveredIndex = -1, navigation = false): CrumbState[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    selected: index === selectedIndex,
    hovered: index === hoveredIndex,
    light: selectedIndex !== -1 && index > selectedIndex,
    navigation,
  }))
}

/**
 * 四档判定的批量入口：逐段取档（`ButtonSettings.getBackgroundColor(c)`，`:652-661`）。
 * `presentations[i]` 非 null 就走自定义呈现，否则走 `crumbColorKey` 的默认分流（`:655-658`）。
 */
export function crumbColorKeys(
  states: readonly CrumbState[],
  presentations: readonly (CrumbPresentation | null)[] = [],
): CrumbColorKey[] {
  return states.map((state, index) => crumbColor(presentations[index] ?? null, state))
}

// ——— LazyTooltipCrumb（`LazyTooltipCrumb.java:9-15`）———

/**
 * `needCalculateTooltip()` 的协议（`:10-14`）：tooltip 慢、**第一次**取之前返回 true
 * （好让平台挪到后台线程算），一旦 `getTooltip()` **非取消**地算过一次就必须返回 false
 * （否则会一直往后推）。本仓把它落成一个小状态机：`resolveTooltip` 调一次即置位。
 */
export interface LazyTooltipCrumb {
  tooltip: () => string | null
  /** 供 UI 判「要不要延后算」；`LazyTooltipCrumb` 自己会维护这个状态。 */
  needCalculateTooltip: () => boolean
}

export function createLazyTooltipCrumb(compute: () => string | null): LazyTooltipCrumb {
  let calculated = false
  return {
    needCalculateTooltip: () => !calculated,
    tooltip: () => {
      // 上游只认「非取消」的调用（`:12-13`）：本仓的 compute 返回 null 即当取消，
      // 此时不置位，下一次仍然可以后台算。
      const value = compute()
      if (value !== null) calculated = true
      return value
    },
  }
}

// ——— BreadcrumbsProvider（EP `com.intellij.breadcrumbsInfoProvider`）———

/**
 * `BreadcrumbsProvider`（`BreadcrumbsProvider.java:21-103`）在本仓的子集。
 * 上游是语言插件按 `getLanguages()`（`:29`）注册、逐元素 `acceptElement`（`:35`）——
 * 本仓没有语言插件运行时，所以「注册面」= 往这张表里加一条。
 *
 * 逐条对应：
 *   · `getLanguages`（`:29`）→ `languages`；
 *   · `acceptElement`（`:35`）→ `accept`；
 *   · `getElementInfo`（`:43-44`）→ `info`；
 *   · `getElementIcon`（`:50-52`，default null）→ `icon`；
 *   · `getElementTooltip`（`:58-60`，default null）→ `tooltip`；
 *   · `getParent`（`:66-68`，default `element.getParent()`）→ `parentKey`，null = 到顶；
 *   · `getChildren`（`:76-78`，default 空）→ `children`；
 *   · `getContextActions`（`:84-86`，default 空）→ `contextActions`；
 *   · `isShownByDefault`（`:92-94`，default true）→ `shownByDefault`；
 *   · `acceptStickyElement`（`:100-102`，default 委托 `acceptElement`）→ 缺省即 `accept`。
 */
export interface BreadcrumbsProvider {
  /** 这个 provider 负责哪几种语言（`getLanguages`，`:29`）。 */
  languages: readonly string[]
  accept: (crumb: CrumbInput) => boolean
  info: (crumb: CrumbInput) => string
  icon?: (crumb: CrumbInput) => string | null
  tooltip?: (crumb: CrumbInput) => string | null
  parentKey?: (crumb: CrumbInput) => string | null
  children?: (crumb: CrumbInput) => readonly CrumbInput[]
  contextActions?: (crumb: CrumbInput) => readonly string[]
  /** `isShownByDefault`（`:92-94`）：false = 默认隐藏，只能在设置里打开。 */
  shownByDefault?: boolean
}

/** `acceptStickyElement`（`:100-102`）：默认实现就是 `acceptElement`，所以没单独字段。 */
export function providerAcceptsSticky(provider: BreadcrumbsProvider, crumb: CrumbInput): boolean {
  return provider.accept(crumb)
}

/**
 * 给定语言，列出**负责这个语言**的 provider（`getLanguages`，`:29`），EP 顺序 = 注入顺序。
 * 注意这里**只**按语言筛，不看 `isShownByDefault` —— 上游那条（`:92-94`）是每个 provider
 * 各自的默认可见性，没有「同一语言下多条 provider 怎么合并」的成文规则。
 * 合并口径见下面的 `showByDefaultOf`（那是**本仓**的映射，已标注）。
 */
export function providersForLanguage(providers: readonly BreadcrumbsProvider[], language: string): BreadcrumbsProvider[] {
  return providers.filter(provider => provider.languages.includes(language))
}

/**
 * 这个语言的面包屑**默认**显不显示。
 *
 * 取证边界：上游 `isShownByDefault`（`BreadcrumbsProvider.java:92-94`）是**每个 provider 各自**
 * 的默认值，「同一语言下多条 provider 怎么合成一个『默认显示』」在上游**没有成文规则** ——
 * 真正做这个合成的是 `BreadcrumbsConfigurable`（`platform/platform-impl/.../BreadcrumbsConfigurable.java`）
 * 那张按语言的设置表，而设置项的默认值来自各 provider 逐个 `isShownByDefault`。
 *
 * 所以下面这条「全票通过才算开」是**本仓的映射**，不是照抄：`isShownByDefault` 的 default 是
 * true（`:93`），所以只有显式写了 `shownByDefault: false` 的那条会把它拉成关。
 * 没有任何 provider 负责这个语言时返回 false —— 那一语言**没有**面包屑，不是「有但默认关」。
 */
export function showByDefaultOf(providers: readonly BreadcrumbsProvider[], language: string): boolean {
  const forLanguage = providersForLanguage(providers, language)
  return forLanguage.length > 0 && forLanguage.every(provider => provider.shownByDefault !== false)
}

// ——— BreadcrumbsForceShownSettings（`:16-26`）———

/**
 * `FORCED_BREADCRUMBS`（`:16`）是**三态**：null = 没强制。
 * `setForcedShown(selected, editor)`（`:18-22`）返回的是「**值变了没有**」
 * （`!Objects.equals(old, selected)`），不是「新值」—— 调用方拿它决定要不要重算可见性。
 * 本仓没有 `Editor`，按键（= 按标签/文件）存。
 */
export type ForcedShown = boolean | null

/** `getForcedShown`（`:24-26`）。 */
export function forcedShown(store: Readonly<Record<string, ForcedShown>>, key: string): ForcedShown {
  return store[key] ?? null
}

/**
 * `setForcedShown`（`:18-22`）：返回**是否变化**。
 * `selected` 为 null 时 `putUserData(key, null)` 等于**摘掉**这个键（不是存一个 null），
 * 所以这里 null → 删键，读取侧 `forcedShown` 再把「没有键」与「null」都归成三态的 null。
 */
export function setForcedShown(store: Record<string, ForcedShown>, key: string, selected: ForcedShown): boolean {
  const old = forcedShown(store, key)
  if (selected === null) delete store[key]
  else store[key] = selected
  return old !== selected
}
