// 层级视图的**范围收窄**（`lp/hierarchy` 判词里的 `HierarchyBrowserScopes`）。
//
// 上游依据（逐条）：
//   · 五档范围名的常量表：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserScopes.java:8-12`
//     —— `SCOPE_PROJECT="Production"` / `SCOPE_ALL="All"` / `SCOPE_CLASS="This Class"` /
//     `SCOPE_MODULE="This Module"` / `SCOPE_TEST="Test"`；
//     `HierarchyBrowserBaseEx.java:109-113` 原样转名，`:237-241` 给每档的**呈现名**
//     （那一份是 `getPresentableNameMap()`，只管按钮上的当前档名；**下拉里的先后**是
//     `getValidScopes()`，`:770-776`，见下面 `HIERARCHY_SCOPES` 的头注）
//     （Production/Tests/All 走 scope 对象的 `getPresentableName()`，
//     「本类」「本模块」走 `platform/lang-api/resources/messages/LangBundle.properties:348`/`:349`
//     = "This Class" / "This Module"；「全部」= `platform/analysis-api/resources/messages/AnalysisBundle.properties:206`
//     `all.scope.name=All`）。
//   · 真正生效的过滤谓词：`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyTreeStructure.java:159-199`
//     的 `isInScope(baseClass, srcElement, scopeType)`：
//       — `This Class` → `PsiTreeUtil.isAncestor(baseClass, srcElement, true)`（`:161-164`）；
//       — `This Module` → 该元素所在文件在基类的模块作用域里（`:165-169`）；
//       — `Production` → **工程内**且**不是测试源**（`:170-177`，`!TestSourcesFilter.isTestSources`）；
//       — `Test` → 是测试源（`:178-181`）；
//       — `All` → 一律 true（`:182-184`）；
//       — 其它字符串 → 命名作用域（`NamedScopesHolder`，`:185-199`）。本仓没有命名作用域宿主
//         （那张表在桶 13 名下 `src/scopes.ts`），所以本模块**只实现上面五档**，不假装有第六档。
//   · 范围切换的入口：`HierarchyBrowserBaseEx.java:775` 把 `This Class` 作为一个本地 scope 加进下拉。
//
//   · 默认档：**All** —— 上游 `HierarchyBrowserManager.State` 没有默认范围字段，`HierarchyTreeStructure`
//     构造时的 scopeType 就是 `SCOPE_ALL`（`getSearchScope` 开头那句 `GlobalSearchScope.allScope`
//     是默认值 `HierarchyTreeStructure.java:133-134`，`SCOPE_ALL` 在那一半根本没有分支，
//     落到 `:147` 的 else 里 `namedScope == null` 什么也不改），屏上那一档由
//     `HierarchyBrowserBaseEx.java:165` 的 `state.SCOPE == null ? SCOPE_ALL : state.SCOPE` 定。
//   · **控件挂在谁身上**（本批 W-2 补的那一半）：基类不加 —— `HierarchyBrowserBaseEx.java:489-490`
//     的 `prependActions` 是空实现，由子类逐个加，所以"哪一档界面有范围下拉"是**逐视图**的事：
//       — 调用层次：`platform/lang-impl/src/com/intellij/ide/hierarchy/CallHierarchyBrowserBase.java:61`；
//         两个方向都真吃范围（`java/java-impl/src/com/intellij/ide/hierarchy/call/CallerMethodsTreeStructure.java:90`
//         查询侧；`.../call/CalleeMethodsTreeStructure.java:73,80` 查询 + 逐节点，`:51` 构造器那一支）；
//       — 方法层次：`.../hierarchy/MethodHierarchyBrowserBase.java:85`；
//       — 类型层次：`platform/lang-impl/src/com/intellij/ide/hierarchy/TypeHierarchyBrowserBase.java:89-94`
//         **不加**；Java 自己在 `java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:47-54`
//         加了一个匿名 `ChangeScopeAction`（加在 `:49`），`isEnabled()`（`:51-52`）= `!当前视图类型 == getSupertypesHierarchyType()`
//         ⇒ **「父类型」那一向的上拉是显式禁用的**，Kotlin 同写法
//         （`plugins/kotlin/code-insight/kotlin.code-insight.k2/src/org/jetbrains/kotlin/idea/k2/codeinsight/hierarchy/types/KotlinTypeHierarchyBrowser.kt:34-40`，
//         加在 `:36`、`isEnabled` 在 `:37-39`）；
//         判定源也对得上：`.../type/SubtypesHierarchyTreeStructure.java:47` 用 `getSearchScope(myCurrentScopeType,…)`，
//         而 `.../type/SupertypesHierarchyTreeStructure.java` 全文**零** scope 引用
//         （只有 `:35` 的 `psiClass.getResolveScope()`，那是解析域不是搜索范围）；
//       — LSP 路径（= 本仓唯一的数据源）：**两种层次都不画**——
//         `platform/lsp-impl/src/impl/features/hierarchy/call/LspCallHierarchyBrowser.kt:30-35` 调完 super
//         之后把所有 `ChangeScopeAction` remove 掉，`platform/lsp-impl/src/impl/features/hierarchy/type/LspTypeHierarchyBrowser.kt:33-37`
//         根本不调 super（自己只加父类型/子类型/排序三个动作）；
//         `platform/lsp-impl/src/impl/features/hierarchy/LspAbstractHierarchyTreeStructure.kt:20-30`
//         的 `buildChildren` 也从未调 `isInScope`/`getSearchScope`（全树里 `isInScope` 的调用点只有
//         `CalleeMethodsTreeStructure.java:51,80`、`KotlinCalleeTreeStructure.kt:63,78`、
//         `PyCallHierarchyTreeStructureBase.java:53`）。
//     ⇒ 本仓的取舍（留痕，供主代理复核）：严格按 LSP 路径 = 整条下拉都不出现，那 `nodeInScope` 那五档
//     判据（桶 4 交付、真会滤行）就成了死码；本批取"有判定源的方向保留、上游显式禁用的那一向撤掉"，
//     即 `hierarchyScopeSupport()` 只对**类型层次·父类型**返回不支持。整条撤或整条留都由宿主那一行决定，
//     模块不再自作主张地把五档塞给所有视图。
//
// 架构不等价处（本仓用本仓架构还原用户可见功能）：
//   · 上游判"在不在范围内"用的是 PSI 元素 + 模块/测试源根索引；本仓的层级节点只有
//     `{path, line, name, kind}`（LSP `HierarchyItem`，见 `src/bridge.ts` 的 `LspHierarchyItem`），
//     所以：
//       — `This Class` = **与根节点同一文件**（本仓的层级节点没有"祖先元素"概念，
//         `isAncestor` 的最粗等价就是同文件；差异如实写在这里）；
//       — `This Module` = **与根节点同一个一级目录**（本仓工作区是单根，`src/bridge.ts` 的
//         `Workspace{name, root, entries}` 没有 Module 表 ⇒ 用路径第一级近似）；
//       — `Production` / `Test` = 复用 `src/navGotoTest.ts` 的 `isTestPath`（同一份上游依据：
//         `TestSourcesFilter.isTestSources` 的路径形态），两处不会出现"一个算测试一个算生产"的分歧。
//   · 默认档：**All** —— 上游 `HierarchyBrowserManager.State` 没有默认范围字段，`HierarchyTreeStructure`
//     构造时的 scopeType 就是 `SCOPE_ALL`（`getSearchScope` 的兜底分支 `GlobalSearchScope.allScope`，
//     `HierarchyTreeStructure.java:161` 之前那两行），本仓同档。
//
// 消费链路：`src/hierarchyView.ts`（面板的状态与行过滤都调这里）；判据 `tests/hierarchy-scopes.test.mjs`。
import { isTestPath } from './navGotoTest.ts'
// 「工程内」那一半的判定源：层级节点的 `path` 由 native 的 `uri_to_relative` 给出
// （`native/lsp_host_bootstrap.cpp:18-31`）—— 落在工作区根**内**才剥成相对路径，根**外**
// （JDK、依赖、jar 里的类）原样返回绝对路径。绝对性判定走已有那一份
// `src/filenameWidget.ts:145` 的 `isAbsolutePath`（盘符 / 前导 `/` / UNC 三形），不再拼第三份
// （`src/moduleScopes.ts:151` 那份私有的暂不在本批范围内，登记在报告 §6）。
import { isAbsolutePath } from './filenameWidget.ts'

/** 五档范围（键 = 上游常量值，别翻成中文键：判据与请求都按上游字符串对齐）。 */
export type HierarchyScopeId = 'Production' | 'All' | 'This Class' | 'This Module' | 'Test'

/**
 * 范围下拉的**顺序与呈现名**。
 *
 * 留痕（原写 X、实际 Y）：这一份原先照 `HierarchyBrowserBaseEx.java:235-243` 排，
 * 那个位置其实是 `getPresentableNameMap()` —— 它往 `HashMap` 里 put，**Map 的装入序根本不是
 * 下拉的顺序**（`:235-241`），下拉真正画的是 `getValidScopes()` 那一份
 * （`platform/lang-impl/src/com/intellij/ide/hierarchy/HierarchyBrowserBaseEx.java:770-776`
 * 建列表、`:811-813` 一条一条 `group.add(new MenuAction(namedScope))`）。本批按后者改：
 *   1. Production —— `:772` `ProjectProductionScope.INSTANCE`，呈现名 =
 *      `platform/analysis-api/src/com/intellij/psi/search/scope/ProjectProductionScope.java:36`
 *      → `AnalysisBundle.properties:127` `predefined.scope.production.name=Production`；
 *   2. Tests —— `:773` `TestsScope.INSTANCE`，呈现名 = `TestsScope.java:22` 的
 *      `AnalysisBundle.properties:205` `tests.scope.name=Tests`（**注意**：常量是 `"Test"`，
 *      屏上写的是 `"Tests"`，`HierarchyBrowserScopes.java:12` 与 `AnalysisBundle.properties:205`
 *      两处不是一个字符串）；
 *   3. All —— `:774` `CustomScopesProviderEx.getAllScope()`，呈现名 = `AnalysisBundle.properties:206`
 *      `all.scope.name=All`；
 *   4. This Class —— `:775`，呈现名 = `LangBundle.properties:348` `this.class.scope.name=This Class`；
 *   5. This Module —— `:776`，呈现名 = `LangBundle.properties:349` `this.module.scope.name=This Module`。
 * 其后才是命名作用域（`:778-782`）与 `ConfigureScopesAction`（`:815`）—— 本仓没有命名作用域宿主，
 * 那两条不给（宁缺毋假），逐条登记在 `docs/source-todo.md`。
 * id 用的仍是 `HierarchyBrowserScopes.java:8-12` 那五个常量原值（下拉项的 `getScopeId()`）。
 */
export const HIERARCHY_SCOPES: readonly { id: HierarchyScopeId; label: string }[] = [
  { id: 'Production', label: '生产代码' },
  { id: 'Test', label: '测试' },
  { id: 'All', label: '全部' },
  { id: 'This Class', label: '本类' },
  { id: 'This Module', label: '本模块' },
]

/** 默认档：上游 `HierarchyBrowserBaseEx.java:165` —— `state.SCOPE == null ? SCOPE_ALL : state.SCOPE`。 */
export const DEFAULT_HIERARCHY_SCOPE: HierarchyScopeId = 'All'

/** 节点的最小形状（`src/bridge.ts` 的 `LspHierarchyItem` 子集）。 */
export interface HierarchyScopedNode { path: string }

/** 路径归一 + 取第一级目录（`This Module` 的近似依据）。 */
function topLevelDirectory(path: string): string {
  const segments = (path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').split('/')
  return segments.length > 1 ? segments[0]! : ''
}

/**
 * `isInScope`（`HierarchyTreeStructure.java:159-199`）的本仓形态。
 * `base` 为 null 时（还没根节点）一律放行 —— 上游的 `thisClass == null` 那一支同样不收窄（`:161`）。
 */
export function nodeInScope(node: HierarchyScopedNode, scope: HierarchyScopeId, base: HierarchyScopedNode | null): boolean {
  if (!node || !node.path) return false
  switch (scope) {
    case 'All':
      return true
    case 'Production':
      // 上游这一档有两个条件（`HierarchyTreeStructure.java:170-177`）：
      //   ① 编译元素（库/JAR 里的那些）必须**在工程内**才留 —— `:175`
      //      `if (srcElement.getContainingFile() instanceof PsiCompiledElement && !PsiManager…isInProject(srcElement)) return false;`
      //      （注释原文说的是 Kotlin 声明被 Java 引用时那种"工程内的编译包装"要留下，真库里的要滤掉）；
      //   ② 不是测试源 —— `:177` `!TestSourcesFilter.isTestSources(virtualFile, project)`。
      // 本仓的对应物：①= 路径是工作区相对路径（根外的库文件由 `uri_to_relative` 原样给出绝对路径，
      // 见文件头那条 import 说明）；②= `isTestPath`。两半都齐 ⇒ 库/JDK 类型不再混在「生产代码」里。
      return !isAbsolutePath(node.path) && !isTestPath(node.path)
    case 'Test':
      return isTestPath(node.path)
    case 'This Class':
      return base !== null && node.path === base.path
    case 'This Module':
      return base === null || topLevelDirectory(node.path) === topLevelDirectory(base.path)
    default:
      // 未知档位 = 命名作用域，本仓没有宿主 ⇒ 与上游 `namedScope == null` 的那一条一致：不收。
      return false
  }
}

/** 这一档认不认（未知档 = 命名作用域，本仓没有宿主）。 */
export function isKnownHierarchyScope(scope: string): scope is HierarchyScopeId {
  return HIERARCHY_SCOPES.some(entry => entry.id === scope)
}

/** 认不出来的档位一律退回默认档（与 `HierarchyBrowserBaseEx.java:165` 那句 `state.SCOPE == null` 的兜底同一形状）。 */
export function resolveHierarchyScope(scope: string): HierarchyScopeId {
  return isKnownHierarchyScope(scope) ? scope : DEFAULT_HIERARCHY_SCOPE
}

/**
 * **范围求值的纯函数**（W-2 要的宿主契约：`scopeFilterFor(scope, item)`）。
 * 求值全在这里，宿主（`src/App.vue` 的那个下拉）只负责"选了哪一档"和"把这一档交回来"，
 * 不在模板里写任何判断：
 *   · `scope` 是下拉的**当前值**（字符串，认不出来就按默认档走，不清空列表）；
 *   · `item` 是一个层级节点（只需要 `path`，即 `src/bridge.ts:168` 的 `LspHierarchyItem` 子集）；
 *   · `base` 是这次层级的**根**（`This Class` / `This Module` 要按它来收窄；
 *     上游那两档同样要 base —— `HierarchyTreeStructure.java:161-169` 里的 `baseClass`）。
 * 返回的是**判断谓词**而不是过滤好的数组：面板画一棵树时要逐节点问，
 * 而 `filterNodesByScope` 是同一份求值在"一批"上的样子。
 */
export function scopeFilterFor(
  scope: string,
  base: HierarchyScopedNode | null,
): (item: HierarchyScopedNode) => boolean {
  const effective = resolveHierarchyScope(scope)
  return item => nodeInScope(item, effective, base)
}

/** 一批节点的范围过滤（保持原序；范围非法就退回默认档而不是清空列表）。 */
export function filterNodesByScope<T extends HierarchyScopedNode>(nodes: readonly T[], scope: HierarchyScopeId, base: HierarchyScopedNode | null): T[] {
  const filter = scopeFilterFor(scope, base)
  return nodes.filter(filter)
}

/** 一级目录（判据与面板提示用）。 */
export function moduleDirectoryOf(path: string): string {
  return topLevelDirectory(path)
}

/** 范围切换后的计数提示（面板标题尾巴；不参与判定）。 */
export function scopeNotice(scope: HierarchyScopeId, kept: number, total: number): string {
  // 认不出来的档位按**默认档**的呈现名报（与 `resolveHierarchyScope`/`filterNodesByScope` 同一条兜底；
  // 原来取的是 `HIERARCHY_SCOPES[0]`，那是下拉的第一项而不是默认档，两件事不该混在一个位置上）。
  const label = HIERARCHY_SCOPES.find(entry => entry.id === resolveHierarchyScope(scope))?.label ?? ''
  return `${label}：${kept} / ${total}`
}

// ---------------------------------------------------------------- 范围的适用面（哪一个视图真有这一档控件）

/** 面板的两个视图（`src/hierarchyView.ts` 的 `hierKind`）。 */
export type HierarchyViewKind = 'call' | 'type'

/** 四个方向（`src/hierarchyView.ts` 的 `hierDirection`）。 */
export type HierarchyViewDirection = 'incoming' | 'outgoing' | 'supertypes' | 'subtypes'

/** 一个视图/方向组合上「范围」那一档的适用面（宿主按 `supported` 决定画不画，模块不画控件）。 */
export interface HierarchyScopeSupport {
  /** 这一档界面上到底有没有范围下拉。 */
  readonly supported: boolean
  /** 下拉的档位（不支持就是**空表** —— 空表不是"退回全部五档"，给了就是假控件）。 */
  readonly tiers: readonly { id: HierarchyScopeId; label: string }[]
  /** 为什么（上游坐标，逐条可从参考树打开）。 */
  readonly reason: string
}

/** 「父类型」方向：上游显式禁用这个控件，且其结构类零判定源。 */
const SUPERTYPES_UNSUPPORTED: HierarchyScopeSupport = {
  supported: false,
  tiers: [],
  reason: '上游在类型层次里把范围动作的 isEnabled() 定为「当前视图类型 != supertypes」'
    + '（java/java-impl/src/com/intellij/ide/hierarchy/type/TypeHierarchyBrowser.java:49-52、'
    + 'KotlinTypeHierarchyBrowser.kt:36-39），而 SupertypesHierarchyTreeStructure.java 全文没有任何 scope 引用'
    + '（只有 :35 的 getResolveScope，那是解析域）⇒ 这一向没有真判定源，不给档。',
}

/** 支持时的档位表：**就是** `HIERARCHY_SCOPES` 那一份（不复制、不重排）。 */
const SUPPORTED_TIERS: readonly { id: HierarchyScopeId; label: string }[] = HIERARCHY_SCOPES

/**
 * 「范围」这一档控件在**哪个视图、哪个方向**上真的存在（本批 W-2 补的模块侧契约）。
 *
 * 上游的注册面是逐个视图的（`HierarchyBrowserBaseEx.java:489-490` 的 `prependActions` 是空的）：
 *   · 调用层次两个方向都有 —— `CallHierarchyBrowserBase.java:61` 加动作，
 *     `CallerMethodsTreeStructure.java:90` / `CalleeMethodsTreeStructure.java:73,80` 真的按范围查/滤；
 *   · 类型层次的**子类型**有 —— `TypeHierarchyBrowser.java:47-54` 加动作且 `isEnabled()` 只禁父类型，
 *     `SubtypesHierarchyTreeStructure.java:47` 真的用 `getSearchScope(myCurrentScopeType,…)`；
 *   · 类型层次的**父类型**没有（`SUPERTYPES_UNSUPPORTED` 那条 reason）；
 *   · 方法层次（`MethodHierarchyBrowserBase.java:85`）本仓没有这个视图，不在这里给档。
 *
 * 与本仓架构的取舍（留痕）：本仓数据源只有 LSP，而上游 LSP 路径**两种层次都把该动作摘掉**
 * （`LspCallHierarchyBrowser.kt:30-35` remove、`LspTypeHierarchyBrowser.kt:33-37` 不调 super，
 * `LspAbstractHierarchyTreeStructure.kt:20-30` 也从不调 `isInScope`）。严格照抄 = 整条下拉都不出现；
 * 本批按派单的"没有真判定源的那一档宁可不出现"只撤**上游自己也禁用**的那一向，
 * 其余保留（本仓的路径过滤是真判定源，按了确实改屏）。不同意这条取舍就整条撤，
 * 撤的话 `nodeInScope` 一族与它的判据一并退回 —— 这点写进报告 §6 交给主代理判。
 */
export function hierarchyScopeSupport(kind: HierarchyViewKind, direction: HierarchyViewDirection): HierarchyScopeSupport {
  if (kind === 'type' && direction === 'supertypes') return SUPERTYPES_UNSUPPORTED
  return {
    supported: true,
    tiers: SUPPORTED_TIERS,
    reason: kind === 'call'
      ? 'CallHierarchyBrowserBase.java:61 注册 ChangeScopeAction；两个方向都真吃范围'
        + '（CallerMethodsTreeStructure.java:90 查询侧、CalleeMethodsTreeStructure.java:73,80 查询+逐节点）'
      : 'TypeHierarchyBrowser.java:47-54 注册动作且 isEnabled() 只禁父类型；'
        + 'SubtypesHierarchyTreeStructure.java:47 用 getSearchScope(myCurrentScopeType,…)',
  }
}

/** 这一档在当前视图/方向上**能不能被用户选中**（不支持的视图里任何档都不该被写进状态）。 */
export function isHierarchyScopeSelectable(scope: string, kind: HierarchyViewKind, direction: HierarchyViewDirection): boolean {
  const support = hierarchyScopeSupport(kind, direction)
  return support.tiers.some(entry => entry.id === scope)
}

