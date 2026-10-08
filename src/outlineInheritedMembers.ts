// **结构视图的「继承成员」与来源灰显** —— 上游 `JavaInheritedMembersNodeProvider` +
// `SuperTypesGrouper` + `JavaClassTreeElementBase.getTextAttributesKey` 那一族的纯逻辑子集。
//
// 上游逐条（行号都在上游树里逐行打开确认过）：
//   · 继承成员从哪来：`java/java-structure-view/src/com/intellij/ide/structureView/impl/java/
//     JavaInheritedMembersNodeProvider.java:27-61` —— 只对 `JavaClassTreeElement` 生效（`:28`），
//     用 `aClass.processDeclarations(new AddAllMembersProcessor(inherited, aClass), …)`（`:36`）
//     沿**父类型链**收集成员，然后 `inherited.removeAll(ownChildren)`（`:37`）剔掉自己的成员；
//     每个元素用 `inherited=true` 包一层（`:47-58` 的 `new JavaClassTreeElement(child, true)` /
//     `new PsiFieldTreeElement(child, true)` / `new PsiMethodTreeElement(child, true)`）。
//   · 可见性过滤：`AddAllMembersProcessor.java:102-108` 的
//     `!isInheritedConstructor(element, psiClass) && PsiUtil.isAccessible(element, psiClass, null)`
//     —— 构造器不继承、父类 private 不可见；
//     `:44` 接口跳过 `Object` 的成员；`:75-84` 同名同签名的方法只留**最派生**的那一个。
//   · 灰显：结构视图那一份走 `JavaClassTreeElementBase.java:100-101`
//     `getTextAttributesKey()` = `isInherited() ? CodeInsightColors.NOT_USED_ELEMENT_ATTRIBUTES : …`，
//     由 `platform/platform-api/src/com/intellij/ide/util/treeView/NodeRenderer.java:197-198`
//     读 `ColoredItemPresentation.getTextAttributesKey()`；色值在
//     `platform/platform-resources/src/DefaultColorSchemesManager.xml:541-543` 的 `FOREGROUND = 808080`。
//     来源类名走 `JavaClassTreeElementBase.java:59-79` 的 `getLocationString()`：
//     `UIUtil.rightArrow()`（= `→`，`platform/util/ui/src/com/intellij/util/FontUtil.java:55-57`）
//     + `PsiClass.getName()`，受 Registry 键 `show.method.base.class.in.java.file.structure` 控制，
//     默认 **true**（`java/java-structure-view/resources/META-INF/RegistryKeysStructureView.xml:4-5`）。
//   · 另一份渲染器：`java/java-impl/src/com/intellij/ide/structureView/impl/StructureNodeRenderer.java`
//     `:38-45` 在 `isInheritedMember` 为真时拼成「名字 + 来源类名」两段，名字用
//     `SimpleTextAttributes.DARK_TEXT`（`platform/core-ui/src/ui/SimpleTextAttributes.java:67`
//     = `new Color(112, 112, 164)`），来源类名用 `GRAY_ATTRIBUTES`（`:63` = `JBColor.GRAY`）；
//     `isInheritedMember` 的判据是 `:54-57` 的 `getTreeParentClass(node) != psiClass`
//     —— **树的父类 ≠ 成员的宿主类** 就是继承来的。
//     ⚠️ 这一份渲染器在本仓移植里的消费方只有 `java/execution/impl/src/com/intellij/execution/
//     MethodListDlg.java:59,66`（方法列表对话框），结构视图本身用的是 `NodeRenderer`
//     （`StructureViewComponent.java:311`）。两处说的**用户可见**是同一件事：名字去强调 + 来源类名。
//   · 分组：`SuperTypesGrouper.java:32-74` 把 `isInherited()` 的成员按 `member.getContainingClass()`
//     收进一个 `SuperTypeGroup`（`:37-44`，ownership = `INHERITS`），组标签 = 超类型名
//     （`SuperTypeGroup.java:67-70`），组图标按 ownership 分三档（`:54-58`）；
//     自己的覆写/实现走 `:47-70`，ownership 由 `methodOverridesSuper` 决定（`:96-98`）。
//   · 排序：`KindSorter.java:43-44` 给 `SuperTypeGroup` 权重 **20**；成员的权重照种类
//     （`:34-57`，本仓已有映射在 `src/outlineView.ts` 的 `symbolKindRank`）；
//     可见性主序 = `VisibilityComparator.java:34` 的 `accessLevel * 2 + subLevel`
//     （`GROUP_ACCESS_SUBLEVEL = 1`，`:12`），组的 subLevel = 1（`SuperTypeGroup.java:98-99`）、
//     成员的 subLevel = 0（`JavaClassTreeElementBase.java:54-56`），组的 accessLevel 取超类型自己的
//     （`SuperTypeGroup.java:91-95`）。
//   · 开关：`InheritedMembersNodeProvider.java:19` 的 `ID = "SHOW_INHERITED"`，复选框文案
//     `platform/structure-view-impl/resources/messages/StructureViewBundle.properties:8`
//     = `file.structure.toggle.show.inherited` = `Inherited members`。
//     **默认关**：结构工具窗口看 `StructureViewFactoryImpl.java:51` 的 `ACTIVE_ACTIONS = ""`
//     + `:145-147` 的 `isActionActive`；文件结构弹层看 `FileStructurePopup.java:938-942`
//     的 `getDefaultValue`（只有 `ALPHA_SORTER` 恒真 + `TreeActionWithDefaultState` 才默认开，
//     而 `InheritedMembersNodeProvider.java:18` 只 implements `FileStructureNodeProvider` +
//     `ActionShortcutProvider`，**没有** `TreeActionWithDefaultState`）⇒ 两边都默认 false。
//   · 可见性档位过滤：`PublicElementsFilter.java:14-24,38-40`（`ID = "SHOW_NON_PUBLIC"`，
//     `isVisible` = `isPublic()`，`isReverted() = true`）与 `FieldsFilter.java:15,18-20`
//     （`ID = "SHOW_FIELDS"`，`isVisible` = 不是字段）；两个过滤器都注册在
//     `JavaFileTreeModel.java:41-43`。`isPublic()` 的定义在
//     `JavaClassTreeElementBase.java:37-40`（有 `public` 修饰符），
//     `JavaClassTreeElement.java:92-95` 再补一条「文件顶层的类型算 public」。
//
// **本仓的继承成员来源能做到哪一档（如实）**：本仓没有 PSI，语言服务也不给「这个类的父类型是谁」
// 这一项。能走的**唯一已核实的通道**是 `prepareTypeHierarchy` + `typeHierarchySupertypes`
// 两跳拿到父类型清单，再对每个父类型的文件发 `documentSymbol` 取它的成员 ——
// 这正是 `src/navGotoSuper.ts:208-237` 已经在跑的链路（`:233` 就是
// `{ kind: 'documentSymbol', path: item.path }`）。所以本模块**只做纯逻辑**：入参是调用方
// （宿主）取回来的「父类型 → 其成员」表，本模块负责合并/去重/分组/排序/灰显判定；
// 发请求那一跳不在本模块（见报告末尾的接线请求）。**没有**这条数据时不要调本模块编成员出来。
//
// 纯逻辑：不 import vue/DOM/bridge，入参用结构类型，便于 `node --test` 直测。

import { symbolKindRank } from './outlineView.ts'
import { ACCESS_LEVEL, visibilityAccessLevel } from './structureFollow.ts'

/** 一个成员（`PsiMember` 的结构子集：LSP `documentSymbol` 的字段 + 所在文件）。 */
export interface InheritedMember {
  name: string
  /** LSP `SymbolKind` 编号（spec，native 原样透传）。 */
  kind: number
  /** 声明文本（`AddAllMembersProcessor` 判签名/修饰符时用的那一份）。 */
  detail?: string
  /** 声明所在文件的工作区相对路径（跨文件时 `PsiMember.getContainingClass()` 的等价物）。 */
  path: string
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

/**
 * 一个父类型及其成员。`name` = `PsiClass.getName()`（组标签就是它，`SuperTypeGroup.java:67-70`）；
 * `detail` 是**父类型自己的**声明文本，`SuperTypeGroup.getAccessLevel()` 取的就是它的修饰符
 * （`SuperTypeGroup.java:91-95`）。
 */
export interface SuperTypeMembers {
  name: string
  detail?: string
  members: readonly InheritedMember[]
}

/** 合并后的成员：多一栏「是不是继承来的」与「从哪个父类型来」。 */
export interface MergedMember extends InheritedMember {
  /** 上游 `JavaClassTreeElementBase.isInherited()`（`:33-35`）。 */
  inherited: boolean
  /** 继承成员的来源类名（上游 `getLocationString()` 拼在 `→` 后面的那个名字）。 */
  sourceClass: string | null
}

/** `StructureViewBundle.properties:8` 的复选框文案（`file.structure.toggle.show.inherited`）。 */
export const INHERITED_MEMBERS_LABEL = 'Inherited members'

/** `InheritedMembersNodeProvider.java:19` 的 `ID`。 */
export const INHERITED_PROVIDER_ID = 'SHOW_INHERITED'

/** `SuperTypesGrouper.java:29` 的 `ID`（分组动作名）。 */
export const SUPERTYPES_GROUPER_ID = 'SHOW_INTERFACES'

/** `SuperTypesGrouper.java:102-103` 的呈现文案（`action.structureview.group.methods.by.defining.type`）。 */
export const SUPERTYPES_GROUPER_LABEL = 'Members by Defining Type'

/** `PublicElementsFilter.java:14` / `FieldsFilter.java:15` 的两个过滤器 ID。 */
export const PUBLIC_ELEMENTS_FILTER_ID = 'SHOW_NON_PUBLIC'
export const FIELDS_FILTER_ID = 'SHOW_FIELDS'

/** `JavaClassTreeElementBase.java:70` 的来源前缀箭头（`FontUtil.java:55-57` 的 `\u2192`）。 */
export const INHERITED_SOURCE_ARROW = '\u2192'

/** `KindSorter.java:43-44` 给 `SuperTypeGroup` 的权重原值。 */
export const SUPERTYPE_GROUP_WEIGHT = 20

/** `VisibilityComparator.java:12` 的 `GROUP_ACCESS_SUBLEVEL`。 */
export const GROUP_ACCESS_SUBLEVEL = 1

/**
 * 「显示继承成员」这一档的出厂状态。
 *
 * **默认 false**，两条独立依据（见文件头）：工具窗口 `StructureViewFactoryImpl.java:51`
 * 的 `ACTIVE_ACTIONS = ""` 不含 `SHOW_INHERITED`；弹层 `FileStructurePopup.java:938-942`
 * 只对 `ALPHA_SORTER` 与 `TreeActionWithDefaultState` 给 true，而 `InheritedMembersNodeProvider`
 * 两个都不是。本仓面板出厂不显示继承成员，与上游一致。
 */
export function inheritedMembersDefaultOn(): boolean {
  return false
}

/**
 * 上游 `InheritedMembersNodeProvider.java:54-57`（经由 `StructureNodeRenderer.java:54-57`
 * 的 `isInheritedMember`）的判据：**树的父类 ≠ 成员的宿主类**。
 * 本仓没有「树的父类」这一层，等价输入是「这一行挂在哪个类型下」（`treeParentClass`，
 * 就是当前正在展开的那个类型）与「成员的宿主类」（`memberClass`，LSP 侧来自
 * `typeHierarchySupertypes` 给的那一项）。两者不同 = 继承来的。
 */
export function isInheritedMember(memberClass: string | null | undefined, treeParentClass: string | null | undefined): boolean {
  return memberClass !== treeParentClass
}

/**
 * 继承成员那一行的两段文本（`StructureNodeRenderer.java:38-45` 的
 * `addText(name, DARK_TEXT)` + `addComment(psiClass.getName(), GRAY_ATTRIBUTES)`）。
 * `tone` 是**语义**不是色值：组件把它映到 `src/tokens.css` 的令牌（见 `INHERITED_TEXT_TOKEN`）。
 * 非继承成员只有一段、`tone = 'regular'`。
 */
export interface MemberTextSegment {
  text: string
  /** `'muted'` = 上游的灰显（`NOT_USED_ELEMENT_ATTRIBUTES` / `GRAY_ATTRIBUTES` 同一角色）。 */
  tone: 'regular' | 'muted'
}

/** 继承成员的文本色令牌：上游 `NOT_USED_ELEMENT_ATTRIBUTES` 灰（`DefaultColorSchemesManager.xml:541-543`）。 */
export const INHERITED_TEXT_TOKEN = '--muted'
/** 来源类名那一档同色（上游 `NodeRenderer.java:144` 用 `GRAYED_ATTRIBUTES`）。 */
export const INHERITED_SOURCE_TOKEN = '--muted'

/**
 * 一行要画的文本段。继承成员 = 名字 + `→来源类名`（两段都去强调）；
 * 自己的成员 = 只有名字、常规色。**不编**来源：`sourceClass` 为空时只画名字。
 */
export function memberTextSegments(member: { name: string; inherited: boolean; sourceClass?: string | null }): MemberTextSegment[] {
  const name: MemberTextSegment = { text: member.name, tone: member.inherited ? 'muted' : 'regular' }
  if (!member.inherited || !member.sourceClass) return [name]
  return [name, { text: `${INHERITED_SOURCE_ARROW}${member.sourceClass}`, tone: 'muted' }]
}

/** 成员的稳定身份键（`inherited.removeAll(ownChildren)` 的对账口径：同一元素同一定位）。 */
export function memberIdentity(member: InheritedMember): string {
  return [member.name, member.kind, member.path, member.startLine, member.startChar, member.endLine, member.endChar].join('\u0000')
}

/**
 * 方法签名的文本键（`AddAllMembersProcessor.java:71-73,75-84` 用 `PsiMethod.getSignature` 去重）。
 * 本仓没有 `PsiType`，等价物是 `detail` 里**括号内**的参数表（LSP 的 `detail` 装的就是签名那一半，
 * 见 `src/outlineView.ts` 的 `symbolPresentableName` 注释）。取不到参数表的方法**不给键**
 * （返回 null ⇒ 不参与去重，不编一个签名出来）。
 */
export function signatureKey(member: InheritedMember): string | null {
  if (!isMethodKind(member.kind)) return null
  const text = member.detail ?? ''
  const open = text.indexOf('(')
  if (open < 0) return null
  const close = text.lastIndexOf(')')
  const params = (close > open ? text.slice(open + 1, close) : text.slice(open + 1)).replace(/\s+/g, ' ').trim().toLowerCase()
  return `${member.name}(${params})`
}

/** 方法档的 LSP kind：Method(6) / Constructor(9) / Function(12)。 */
function isMethodKind(kind: number): boolean {
  return kind === 6 || kind === 9 || kind === 12
}

/** 字段档的 LSP kind：Field(8) / Variable(13) / Constant(14) / EnumMember(22)。 */
function isFieldKind(kind: number): boolean {
  return kind === 8 || kind === 13 || kind === 14 || kind === 22
}

/**
 * 构造器不继承（`AddAllMembersProcessor.java:106-108` 的 `isInheritedConstructor`：
 * `method.isConstructor() && method.getContainingClass() != psiClass`）。
 * 本模块的入参已经是「父类型给的成员」，来源类必然 ≠ 当前类，所以这里只判 `isConstructor()` 那一位
 * （kind = Constructor(9)）。
 */
export function isInheritedConstructor(member: InheritedMember): boolean {
  return member.kind === 9
}

/**
 * 父类 private 成员不可见（`AddAllMembersProcessor.java:102-104` 的 `PsiUtil.isAccessible`）。
 * 本仓从 `detail` 判档（复用 `src/structureFollow.ts` 的 `visibilityAccessLevel`，那是
 * `PsiUtil.getAccessLevel` 的等价物）：`private`/`fileprivate` 一档就挡掉。
 * 判不出档位（`unknown`）时**放行** —— 上游 `isAccessible` 对无修饰符的成员是放行的
 * （Java 默认包级、同包可继承），本仓拿不到包信息，挡掉会漏掉本该显示的成员。
 */
export function isAccessibleFromSubclass(member: InheritedMember): boolean {
  return visibilityAccessLevel(member.detail ?? '') !== ACCESS_LEVEL.private
}

/** 继承成员候选：非构造器 + 对子类可见（`AddAllMembersProcessor.java:45` 的 `isVisible`）。 */
export function isInheritableMember(member: InheritedMember): boolean {
  if (isInheritedConstructor(member)) return false
  return isAccessibleFromSubclass(member)
}

export interface MergeInheritedInput {
  /** 当前类型自己的成员（LSP 该类型节点的 children）。 */
  own: readonly InheritedMember[]
  /**
   * 父类型及其成员，**由近到远**排列（上游 `processDeclarations` 先给最近一层；
   * `typeHierarchySupertypes` 的顺序 = 父类在前、接口在后，见 `src/navGotoSuper.ts:225`）。
   */
  superTypes: readonly SuperTypeMembers[]
}

export interface MergeInheritedResult {
  /** 自己的成员（`inherited = false`，原次序不动）。 */
  own: MergedMember[]
  /** 继承来的成员（`inherited = true`，去重后按父类型近→远、组内原次序）。 */
  inherited: MergedMember[]
  /** 自己的 + 继承的，按上游节点提供顺序：**先自己的，后继承的**（`NodeProvider.java:14-22`）。 */
  all: MergedMember[]
}

/**
 * 合并自己的成员与父类型的成员（`JavaInheritedMembersNodeProvider.provideNodes` 的等价物）。
 *
 * 逐条对位：
 *   · `:36` 收集父类型链上的成员 → 入参 `superTypes`（由近到远）；
 *   · `:37` `inherited.removeAll(ownChildren)` → 先剔掉与 `own` 身份相同的项
 *     （同文件同定位 = 同一个元素，`memberIdentity`）；
 *   · `AddAllMembersProcessor.java:45,102-108` → `isInheritableMember`（构造器不继承、private 挡掉）；
 *   · `:75-84` 同签名只留最派生 → `dedupeInheritedBySignature`（父类型由近到远 ⇒ 先到的更派生）；
 *   · `:47-58` 每项打 `inherited = true` + 来源类名。
 *
 * **不能做的**（见报告「无法核实」）：接口跳过 `Object` 成员（`:44,59-69` 要 `java.lang.Object`
 * 的全限定名与类图）、跨分支的 `isInheritor` 精确判定（`:79-83` 要类之间的继承关系）——
 * 本模块只按「父类型由近到远」取第一个同签名者。
 */
export function mergeInheritedMembers(input: MergeInheritedInput): MergeInheritedResult {
  const ownIds = new Set(input.own.map(memberIdentity))
  const own: MergedMember[] = input.own.map(member => ({ ...member, inherited: false, sourceClass: null }))

  const collected: MergedMember[] = []
  for (const superType of input.superTypes) {
    for (const member of superType.members) {
      if (ownIds.has(memberIdentity(member))) continue
      if (!isInheritableMember(member)) continue
      collected.push({ ...member, inherited: true, sourceClass: superType.name })
    }
  }

  const inherited = dedupeInheritedBySignature(collected)
  return { own, inherited, all: [...own, ...inherited] }
}

/**
 * 同签名只留最派生（`AddAllMembersProcessor.java:75-84` 的 `shouldAdd`/`isInheritor`）。
 * 入参顺序即优先级（父类型由近到远、组内保持文档序）⇒ 第一个同签名者胜。
 * 没有签名键的方法（`signatureKey` 返回 null）不参与去重，原样保留。
 */
export function dedupeInheritedBySignature(members: readonly MergedMember[]): MergedMember[] {
  const out: MergedMember[] = []
  const seen = new Set<string>()
  for (const member of members) {
    const key = signatureKey(member)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(member)
  }
  return out
}

/** `SuperTypesGrouper.java:42,66-67` 的三种归属（`SuperTypeGroup.OwnershipType`）。 */
export type SuperTypeOwnership = 'IMPLEMENTS' | 'OVERRIDES' | 'INHERITS'

/**
 * 一个「按定义类型」分组（`SuperTypeGroup`）。组标签 = 超类型名，权重 = 20，subLevel = 1。
 */
export interface SuperTypeGroupModel {
  name: string
  ownership: SuperTypeOwnership
  /** `KindSorter.java:43-44` 的 20。 */
  kindWeight: number
  /** `SuperTypeGroup.java:98-99` 的 1。 */
  subLevel: number
  /** 超类型自己的可见性档（`SuperTypeGroup.java:91-95`）；判不出 = `ACCESS_LEVEL.unknown`。 */
  accessLevel: number
  members: MergedMember[]
}

/**
 * `SuperTypesGrouper.group`（`:32-74`）的等价物：**只**把继承成员按宿主类分组
 * （`:37-44` 的 `isInherited() && member.getContainingClass()`）；自己的成员不进组
 * （自己的覆写/实现走 `:47-70`，那一条要 superMethods 数据，见 `ownershipForMember`）。
 * 组按**首次出现**顺序（上游 `groups` 是 `HashMap`，`:73` 返回 `keySet()`；
 * 本仓取父类型入参顺序，即「近的在前」，与界面上的稳定次序一致）。
 */
export function groupInheritedBySuperType(members: readonly MergedMember[]): SuperTypeGroupModel[] {
  const byName = new Map<string, SuperTypeGroupModel>()
  for (const member of members) {
    if (!member.inherited || !member.sourceClass) continue
    let group = byName.get(member.sourceClass)
    if (!group) {
      group = { name: member.sourceClass, ownership: 'INHERITS', kindWeight: SUPERTYPE_GROUP_WEIGHT, subLevel: 1, accessLevel: ACCESS_LEVEL.unknown, members: [] }
      byName.set(member.sourceClass, group)
    }
    group.members.push(member)
  }
  return [...byName.values()]
}

/**
 * 给分组补上超类型自己的可见性档（`SuperTypeGroup.getAccessLevel()`，`:91-95`：
 * 取的是**超类型的修饰符**，取不到给 `ACCESS_LEVEL_PUBLIC`）。本仓从超类型的 `detail` 判，
 * 判不出仍留 `unknown`（`SuperTypeGroup.java:94` 的「修饰符为 null → PUBLIC」本仓做不到：
 * LSP 没给「这个类型有没有修饰符」这一位，见报告）。
 */
export function withSuperTypeAccess(groups: readonly SuperTypeGroupModel[], superTypes: readonly SuperTypeMembers[]): SuperTypeGroupModel[] {
  const detailByName = new Map(superTypes.map(entry => [entry.name, entry.detail ?? '']))
  return groups.map(group => ({ ...group, accessLevel: visibilityAccessLevel(detailByName.get(group.name) ?? '') }))
}

/**
 * `SuperTypesGrouper.methodOverridesSuper`（`:96-98`）的等价物：
 * 自己抽象 **或** 父方法非抽象 ⇒ 视为覆写，否则视为实现。
 * 入参要调用方从层级通道取（本仓 `prepareTypeHierarchy`/`typeHierarchySupertypes` 只给类型，
 * 方法的 abstract 位要从父类型的 `documentSymbol` 成员里读 —— 见接线请求）。
 */
export function methodOverridesSuper(abstract: boolean, superAbstract: boolean): boolean {
  return abstract || !superAbstract
}

/** 归属判定（`SuperTypesGrouper.java:66-67`）：继承来的固定 `INHERITS`，自己的看有没有父方法。 */
export function ownershipForMember(input: { inherited: boolean; overrides?: boolean }): SuperTypeOwnership {
  if (input.inherited) return 'INHERITS'
  return input.overrides ? 'OVERRIDES' : 'IMPLEMENTS'
}

/**
 * 可见性主序的排序键（`VisibilityComparator.java:32-35`）：
 * `accessLevel * (GROUP_ACCESS_SUBLEVEL + 1) + subLevel`。
 * 组用 `subLevel = 1`（`SuperTypeGroup.java:98-99`）、成员用 0（`JavaClassTreeElementBase.java:54-56`）
 * ⇒ 同一可见性档里**组排在成员之前**（上游那一行 `*2` 就是为这个）。
 */
export function accessRank(accessLevel: number, subLevel: number): number {
  return accessLevel * (GROUP_ACCESS_SUBLEVEL + 1) + subLevel
}

/** 成员的种类权重（`KindSorter.java:34-57`）—— 转发既有映射，本模块不建第二张表。 */
export function memberKindWeight(kind: number, popup = false): number {
  return symbolKindRank(kind, popup)
}

/**
 * `JavaClassTreeElementBase.isPublic()`（`:37-40`）的等价物：有 `public` 修饰符。
 * `JavaClassTreeElement.java:92-95` 再补一条：**文件顶层的类型**算 public（Java 里
 * 顶层类型即使不写 `public` 也是「文件级公开」，上游就是这么判的）。
 * `topLevelType` 由调用方给（该符号的父节点是不是文件根）。
 */
export function isPublicMember(detail: string, topLevelType = false): boolean {
  return topLevelType || visibilityAccessLevel(detail) === ACCESS_LEVEL.public
}

/**
 * `PublicElementsFilter.isVisible`（`:17-24`）：只留 public。注意上游 `isReverted() = true`
 * （`:38-40`），即「Show non-public」复选框**选中**时才应用这个过滤（`TreeModelWrapper.java:125-127`
 * 的 `shouldRevert`）。本函数给的是**谓词本身**，勾选态到谓词的换算由调用方按 `reverted` 做。
 */
export function publicElementsVisible(member: InheritedMember, topLevelType = false): boolean {
  return isPublicMember(member.detail ?? '', topLevelType)
}

/** `FieldsFilter.isVisible`（`:18-20`）：不是字段就可见（同样 `isReverted() = true`，`:34-36`）。 */
export function fieldsVisible(member: InheritedMember): boolean {
  return !isFieldKind(member.kind)
}

export interface MemberFilterOptions {
  /** 应用 `PublicElementsFilter`（`SHOW_NON_PUBLIC` 勾选态经 `isReverted` 换算后的结果）。 */
  onlyPublic?: boolean
  /** 应用 `FieldsFilter`（`SHOW_FIELDS` 勾选态经 `isReverted` 换算后的结果）。 */
  hideFields?: boolean
  /** 顶层类型算 public（`JavaClassTreeElement.java:92-95`）。 */
  topLevelType?: boolean
}

/** 两个过滤器（`JavaFileTreeModel.java:41-43`）的合并谓词。 */
export function memberPassesFilters(member: InheritedMember, options: MemberFilterOptions = {}): boolean {
  if (options.onlyPublic && !publicElementsVisible(member, options.topLevelType ?? false)) return false
  if (options.hideFields && !fieldsVisible(member)) return false
  return true
}
