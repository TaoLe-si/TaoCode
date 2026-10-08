// 调试器「按类型分组的树节点 + XValue 节点动作」的纯规则（上游 `XValueContainer` / `XValueChildrenList` /
// `XValueGroup` / `XValueGroupNodeImpl` / `XValueNodePresentationConfigurator` 与 tree/actions 那一族）。
//
// 本模块零 Vue、零 bridge 值依赖，只从 `src/debugPaging.ts` 取分页计数（值 import，带 .ts）。
//
// ── 上游「孩子按什么分组」的真实规则（逐条核过，注释里给 文件:行号）────────────────────────────
//   · 分组**由值容器自己决定**：`XValueContainer.computeChildren(XCompositeNode)` 是容器实现的
//     （`platform/xdebugger-api/src/com/intellij/xdebugger/frame/XValueContainer.java:26-28` 只是缺省：
//     `addChildren(XValueChildrenList.EMPTY, true)`）。
//   · 容器能报的孩子有**五格**，不是一个扁平表：`XValueChildrenList` 持有
//     `myTopValues` / `myTopGroups` / `myNames`+`myValues` / `myBottomGroups`
//     （`platform/xdebugger-api/src/com/intellij/xdebugger/frame/XValueChildrenList.java:31-36`），
//     写入器 `addTopValue` / `addTopGroup` / `add` / `addBottomGroup`（`:92-105`），
//     读取器 `getTopValues` / `getTopGroups` / `getBottomGroups`（`:119-129`）。
//   · 树上的**渲染顺序**由 `XValueContainerNode.getChildren()` 定死：
//     临时编辑节点 → 消息节点 → topNodes（top values 再 top groups，`:101-102`）→ valueChildren
//     → bottomNodes（bottom groups，`:103`）→ 临时消息节点
//     （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/nodes/XValueContainerNode.java:280-305`）。
//   · 组节点文本 = 名字 + 分隔符 + 注释（注释是灰字）
//     （`.../nodes/XValueGroupNodeImpl.java:17-22`）；分隔符缺省 `" = "`（`XValueGroup.java:46-48`），
//     组名 `getName()`（`:20-22`）、注释 `getComment()`（`:53-55`）、初始展开 `isAutoExpand()`（`:31-33`）、
//     是否跨会话记展开态 `isRestoreExpansion()`（`:39-41`）。
//   · 组节点的初始展开态：`isRestoreExpansion()` 且组名非空且存档里有这个键 ⇒ 读存档，否则 `isAutoExpand()`
//     （`XValueGroupNodeImpl.java:34-42`）；展开态变化时按**组名**写回（`:44-52`）。
//
// ── 上游真实存在的组（每一个都能指到）─────────────────────────────────────────────────────
//   · Java 静态字段组：`JavaStackFrame.addStaticGroup` → `XValueChildrenList.topGroups(List.of(new JavaStaticGroup(...)))`
//     （`java/debugger/impl/src/com/intellij/debugger/engine/JavaStackFrame.java:254-267`，挂在 `:263`）；
//     组名 = `StaticDescriptorImpl.getName()` 的 `"static"`（`.../ui/impl/watch/StaticDescriptorImpl.java:37-40`）、
//     注释 = `" members of " + 类型名`（`.../engine/JavaStaticGroup.java:45-51`）、
//     分隔符 = `""`（`:53-56`）、图标 = static（`:58-61`）；
//     出现条件 = `location != null && getThisObject() == null` 且 `staticDescriptor.isExpandable()`
//     （`JavaStackFrame.java:256`/`:261`，`isExpandable` = 有静态字段，`StaticDescriptorImpl.java:43-45`）。
//   · Python 受保护属性组（**bottom**）：`isSimplifiedView()` 时把 `name.startsWith("_")` 的孩子抽出来
//     （`python/pydevSrc/src/com/jetbrains/python/debugger/PyDebugValue.java:581-585`），
//     组名 `Protected Attributes`、排除 `{__len__, __exception__}`
//     （`.../PyDebugValueGroups.kt:14-16`），经 `XValueChildrenList.bottomGroup(group)` 挂上（`:96`）。
//   · Python 返回值 / 特殊变量组（**bottom**）：`PyStackFrame.java:172-179`，
//     组名 `Return Values` / `Special Variables`（`python/pluginResources/messages/PyBundle.properties:875-876`），
//     出现条件 `!isReturnEmpty` / `!isSpecialEmpty`（`PyStackFrame.java:154-179`）。
//   · 求值失败的错误组（**bottom**）：`ErrorsValueGroup` 组名 `"Errors"`（`ErrorsValueGroup.java:21-23`），
//     在数组元素求值抛异常时挂上（`java/debugger/impl/src/com/intellij/debugger/ui/tree/render/ArrayRenderer.java:409-411`）。
//   · 行内监视组：组名取自 `debugger.inline.watches.group.name` = `Inline Watches`
//     （`platform/xdebugger-api/resources/messages/XDebuggerBundle.properties:298`），
//     用在 `InlineWatchesRootNode.java:47`。
//
// ── 与「按类型分组」用户开关的关系 ────────────────────────────────────────────────────────
// 上游没有「按 type 聚合同层兄弟」这个开关 —— 分组是容器自报的。本仓 DAP 只有扁平 `variables`，
// 所以 DAP 等价物是**用户开关把同层 type 相同的兄弟聚成一个组**（聚合派生已在
// `src/debugFrameTree.ts` 的 `groupChildrenByType`，组的展开态存档也在那里）。本模块不重复那份聚合，
// 只补它没覆盖的上游那一半：**五格孩子的槽位与渲染顺序**、**已知组的确切规格（名字/注释/分隔符/槽位）**、
// **组的初始展开态规则**，以及**节点动作表**。
//
// 判据 tests/debug-type-grouping.test.mjs。

import { hasMoreVariableChildren, remainingVariableChildren, type VariablePageInfo } from './debugPaging.ts'

// ── 一、孩子槽位与渲染顺序（XValueChildrenList 的五格 + XValueContainerNode.getChildren 的顺序）──────

/** 一个组挂在哪一格：`topGroups` 还是 `bottomGroups`（`XValueChildrenList.java:92-105`）。 */
export type XValueGroupSlot = 'top' | 'bottom'

/** 容器能报的四类孩子（消息/临时节点是树自己的，不属于容器报的这四类）。 */
export interface ChildSlots<Value, Group> {
  /** `addTopValue` —— 排在普通孩子之前的具名值（`XValueChildrenList.java:96-98`）。 */
  topValues: Value[]
  /** `addTopGroup` —— 排在普通孩子之前的组（`:92-94`）。 */
  topGroups: Group[]
  /** `add` —— 普通具名孩子（`:74-82`）。 */
  values: Value[]
  /** `addBottomGroup` —— 排在普通孩子之后的组（`:103-105`）。 */
  bottomGroups: Group[]
}

/** 空五格（缺省容器什么都不报，`XValueContainer.java:26-28`）。 */
export function emptyChildSlots<Value, Group>(): ChildSlots<Value, Group> {
  return { topValues: [], topGroups: [], values: [], bottomGroups: [] }
}

/**
 * 树上的渲染顺序，逐格照 `XValueContainerNode.getChildren()`：
 * top values → top groups → 普通值 → bottom groups（`:291-299`）。
 * 树自己的「临时编辑节点 / 消息节点 / 临时消息节点」不在这里（它们不属于容器报的孩子）。
 */
export function orderedChildren<Value, Group>(slots: ChildSlots<Value, Group>): Array<Value | Group> {
  return [...slots.topValues, ...slots.topGroups, ...slots.values, ...slots.bottomGroups]
}

/** 这一格是不是排在普通孩子之前（`top` ⇒ 真）。 */
export function isSlotBeforeValues(slot: XValueGroupSlot): boolean {
  return slot === 'top'
}

// ── 二、已知组的确切规格 ────────────────────────────────────────────────────────────────

/** 组节点的静态规格（`XValueGroup` 的四个可观察字段 + 槽位 + 出处）。 */
export interface XValueGroupSpec {
  /** 组名（`XValueGroup.getName()`，`:20-22`）。 */
  name: string
  /** 注释，显示在组名之后（`getComment()`，`:53-55`）；空串 = 上游返回 null，不画分隔符与注释。 */
  comment: string
  /** 名字与注释之间的分隔符（`getSeparator()`，`:46-48`）。 */
  separator: string
  /** 初始展开态（`isAutoExpand()`，`:31-33`）。 */
  autoExpand: boolean
  /** 展开态是否跨会话记（`isRestoreExpansion()`，`:39-41`）。 */
  restoreExpansion: boolean
  /** 挂在哪一格。 */
  slot: XValueGroupSlot
}

/** 组名与注释之间的缺省分隔符（`XValueGroup.getSeparator()` 的缺省值，`:46-48`）。 */
export const GROUP_SEPARATOR = ' = '

/** Python 受保护属性组要排除的两个名字（`PyDebugValueGroups.kt:14-16`）。 */
export const PROTECTED_ATTRS_EXCLUDED: readonly string[] = ['__len__', '__exception__']

/** 受保护属性组的判定：名字以 `_` 开头且不在排除表里（`PyDebugValue.java:583` + `:14-16`）。 */
export function isProtectedAttribute(name: string): boolean {
  return name.startsWith('_') && !PROTECTED_ATTRS_EXCLUDED.includes(name)
}

/**
 * Java 静态字段组（top 槽，`JavaStackFrame.java:263`）。名字恒为 `"static"`
 * （`StaticDescriptorImpl.java:37-40`），注释 = `" members of " + 类型名`（`JavaStaticGroup.java:45-51`），
 * 分隔符是空串（`:53-56`）—— 所以组行文本就是 `static members of Foo`。
 * 类型名为空时上游返回 null 注释（`JavaStaticGroup.java:48-50`），这里落成空串。
 */
export function staticGroupSpec(typeName: string): XValueGroupSpec {
  const trimmed = typeName.trim()
  return {
    name: 'static',
    comment: trimmed ? ` members of ${trimmed}` : '',
    separator: '',
    autoExpand: false,
    restoreExpansion: false,
    slot: 'top',
  }
}

/** 静态组是否出现：不是实例帧且类型有静态字段（`JavaStackFrame.java:256`/`:261`）。 */
export function staticGroupVisible(hasThisObject: boolean, hasStaticFields: boolean): boolean {
  return !hasThisObject && hasStaticFields
}

/** Python 受保护属性组（bottom 槽，`PyDebugValueGroups.kt:96`；名字取自 `PydevBundle.properties:4`）。 */
export function protectedAttributesGroupSpec(): XValueGroupSpec {
  return {
    name: 'Protected Attributes',
    comment: '',
    separator: GROUP_SEPARATOR,
    autoExpand: false,
    restoreExpansion: false,
    slot: 'bottom',
  }
}

/** Python 返回值组（bottom 槽，`PyStackFrame.java:172-175`；名字取自 `PyBundle.properties:876`）。 */
export function returnValuesGroupSpec(): XValueGroupSpec {
  return { name: 'Return Values', comment: '', separator: GROUP_SEPARATOR, autoExpand: false, restoreExpansion: false, slot: 'bottom' }
}

/** Python 特殊变量组（bottom 槽，`PyStackFrame.java:176-179`；名字取自 `PyBundle.properties:875`）。 */
export function specialVariablesGroupSpec(): XValueGroupSpec {
  return { name: 'Special Variables', comment: '', separator: GROUP_SEPARATOR, autoExpand: false, restoreExpansion: false, slot: 'bottom' }
}

/** 求值失败的错误组（bottom 槽，`ArrayRenderer.java:409-411`；名字 `ErrorsValueGroup.java:21-23`）。 */
export function errorsGroupSpec(): XValueGroupSpec {
  return { name: 'Errors', comment: '', separator: GROUP_SEPARATOR, autoExpand: false, restoreExpansion: false, slot: 'bottom' }
}

/** 行内监视组（`InlineWatchesRootNode.java:47`；名字取自 `XDebuggerBundle.properties:298`）。 */
export function inlineWatchesGroupSpec(): XValueGroupSpec {
  return { name: 'Inline Watches', comment: '', separator: GROUP_SEPARATOR, autoExpand: false, restoreExpansion: false, slot: 'top' }
}

/**
 * 组行文本 = 名字 + 分隔符 + 注释（`XValueGroupNodeImpl.java:17-22`）。
 * 注释为空时只剩名字 —— 上游 `getComment()` 返回 null 就不画分隔符与注释（`:18-22`）。
 */
export function groupNodeText(spec: XValueGroupSpec): string {
  if (!spec.comment) return spec.name
  return `${spec.name}${spec.separator}${spec.comment}`
}

/**
 * 组的初始展开态（`XValueGroupNodeImpl.isExpand`，`:34-42`）：
 * `isRestoreExpansion()` 且组名非空且存档里有这个**组名**的键 ⇒ 用存档值；否则用 `isAutoExpand()`。
 * `stored` 是「组名 → 上次是否展开」（上游存在 `PropertiesComponent` 里，`:37-38`）。
 */
export function groupInitialExpanded(
  spec: XValueGroupSpec, stored: Readonly<Record<string, boolean>> | null | undefined,
): boolean {
  if (spec.restoreExpansion && spec.name) {
    const saved = stored?.[spec.name]
    if (typeof saved === 'boolean') return saved
  }
  return spec.autoExpand
}

/**
 * 展开态变化时要写回的存档项（`XValueGroupNodeImpl.onExpansion`，`:44-52`）：
 * 只有 `isRestoreExpansion()` 且组名非空的组才写；其余返回 null（不写）。
 */
export function groupExpansionToStore(spec: XValueGroupSpec, expanded: boolean): { name: string; expanded: boolean } | null {
  if (!spec.restoreExpansion || !spec.name) return null
  return { name: spec.name, expanded }
}

// ── 三、值的呈现档位（XValueNodePresentationConfigurator + XValuePresentation 的五种实现）──────────

/** 值的呈现档位 —— 上游 `XValuePresentation` 的五个标准实现（`XValuePresentation.java:11-14`）。 */
export type ValuePresentationKind = 'regular' | 'string' | 'numeric' | 'keyword' | 'error'

/** 值文本的截断上限（`XValueNode.MAX_VALUE_LENGTH`，`XValueNode.java:36`）。 */
export const MAX_VALUE_LENGTH = 1000

/** 名字的截断上限（`XValueNodeImpl.MAX_NAME_LENGTH`，`XValueNodeImpl.java:55`）。 */
export const MAX_NAME_LENGTH = 100

/**
 * 渲染配置的**入口** —— `XValueNodePresentationConfigurator` 的四个 `setPresentation` 重载
 * （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/ui/tree/nodes/XValueNodePresentationConfigurator.java`）：
 *   · `(icon, type, value, hasChildren)` ⇒ 包成 `new XRegularValuePresentation(value, type)`（`:69-75`）；
 *   · `(icon, type, separator, value, hasChildren)` ⇒ 同一个类但换分隔符（`:77-80`）；
 *   · `(icon, type, value, valuePresenter, hasChildren)` ⇒ 有 `valuePresenter` 函数时换成
 *     `XValuePresentationAdapter`（`:82-90`、适配器 `:115-135`）；
 *   · `(icon, presentation, hasChildren)` ⇒ 原样透传（`:64-67`）。
 * 另外 `doSetPresentation` 先查 `DebuggerUIUtil.isObsolete(node)`，过期的节点**直接丢弃这次呈现**
 * （`:96-98`）；不在 EDT 上时排到节点更新队列（`:100-112`）。
 * DAP 侧没有「换呈现函数」这一位，所以本仓的等价物是：**三要素（值 / 类型 / 分隔符）→ 档位 + 文本**。
 */
export interface ValuePresentationParts {
  value: string
  type?: string
  separator?: string
  kind?: ValuePresentationKind
  /** 节点过期时这次呈现被丢弃（`:96-98`）—— 调用方据此不更新行。 */
  obsolete?: boolean
}

/** 一次呈现的落点：`drop` 为真时什么都不画（过期节点，`:96-98`）。 */
export function configurePresentation(parts: ValuePresentationParts): { drop: boolean; text: string } {
  if (parts.obsolete) return { drop: true, text: '' }
  const separator = parts.separator ?? VALUE_SEPARATOR
  const prefix = parts.type ? `{${parts.type}} ` : ''
  return { drop: false, text: `${separator}${prefix}${renderValueText(parts.value, parts.kind ?? 'regular')}` }
}

/** 名字与值之间的分隔符（`XDebuggerUIConstants.EQ_TEXT`，`XDebuggerUIConstants.java:34`）。 */
export const NAME_VALUE_SEPARATOR = ' = '

/** 名字与值之间的缺省分隔符（`XValuePresentation.DEFAULT_SEPARATOR`，`XValuePresentation.java:18`）。 */
export const VALUE_SEPARATOR = ' = '

/**
 * 每个档位怎么渲染值文本 —— 逐条照上游实现：
 *   · regular —— `XRegularValuePresentation.renderValue` 直出（`XRegularValuePresentation.java:37-39`）；
 *   · string —— `XStringValuePresentation` 走 `renderStringValue(value, "\"\\", MAX_VALUE_LENGTH)`
 *     （`XStringValuePresentation.java:32-34`），`XValueTextRendererImpl.renderStringValue` 给它套一对引号
 *     （`XValueTextRendererImpl.java:51-58`）；
 *   · numeric / keyword —— `renderNumericValue` / `renderKeywordValue`
 *     （`XNumericValuePresentation.java:27-30` / `XKeywordValuePresentation.java:27-30`）；
 *   · error —— `renderError` 直出（`XErrorValuePresentation.java:32-35`）。
 * 上游由插件在 `computePresentation` 里挑实现类；DAP 的 `variables` 没有这一位，所以缺省走 `regular`。
 * 不可见字符的转义对**每一档**都做：`XValueTextRendererImpl.renderValue`（regular）与
 * `renderStringValue` 都经 `XValuePresentationUtil.renderValue`，那里的转义不区分档位
 * （`XValueTextRendererImpl.java:38-41` / `:51-58`，转义在 `XValuePresentationUtil.java:44-61`）。
 */
export function renderValueText(value: string, kind: ValuePresentationKind = 'regular'): string {
  const text = escapeInvisible(value.slice(0, MAX_VALUE_LENGTH))
  return kind === 'string' ? `"${text}"` : text
}

/**
 * 不可见字符的转义（`XValuePresentationUtil.getEscapingSymbol`，`:126-139`）。
 * `renderValue` 遇到这些字符会先补一个反斜杠（`:55-59`）。
 */
export function escapeInvisible(text: string): string {
  let out = ''
  for (const ch of text) {
    switch (ch) {
      case '\n': out += '\\n'; break
      case '\r': out += '\\r'; break
      case '\t': out += '\\t'; break
      case '\b': out += '\\b'; break
      case '\f': out += '\\f'; break
      case '\u0007': out += '\\a'; break
      case '\u000b': out += '\\v'; break
      default: out += ch
    }
  }
  return out
}

/**
 * 一行值的文本拼法：分隔符 → `{类型} `（灰字）→ 值
 * （`XValueNodeImpl.buildText`，`XValueNodeImpl.java:261-274`；类型为空就不画那一段，`:269-272`）。
 * `XValueNodePresentationConfigurator` 的那几个重载只是把三要素包成 `XValuePresentation`，
 * 落点文本同这一条（见 `configurePresentation`）。
 */
export function valueLineText(value: string, type?: string, kind: ValuePresentationKind = 'regular'): string {
  const prefix = type ? `{${type}} ` : ''
  return `${VALUE_SEPARATOR}${prefix}${renderValueText(value, kind)}`
}

/**
 * 名字按上限截断（`XValueNodeImpl.appendName` 用 `MAX_NAME_LENGTH`，`:234-240`；
 * 截断算法在 `XValuePresentationUtil.renderName`，`:73-108`）。这里落的是它的可观察结果：
 * 超过上限就切到上限，不补省略号（上游也只是停止追加，`:92-94`）。
 */
export function truncateName(name: string, maxLength = MAX_NAME_LENGTH): string {
  return name.length <= maxLength ? name : name.slice(0, maxLength)
}

/**
 * 节点的三种「值还没出来」文本（上游三处状态各自的文案，见下）。
 * 行号指 `platform/xdebugger-impl/shared/src/com/intellij/xdebugger/impl/ui/XDebuggerUIConstants.java`。
 */
export interface NodeStateTexts {
  /** 正在取孩子（`XDebuggerUIConstants.getCollectingDataMessage`，`:48-50`；文案 `XDebuggerBundle.properties:130`）。 */
  collecting: string
  /** 正在改值（`getModifyingValueMessage`，`:56-58`；文案 `:131`）。 */
  modifying: string
  /** 正在求值（`getEvaluatingExpressionMessage`，`:52-54`；文案 `:132`）。 */
  evaluating: string
}

export const NODE_STATE_TEXTS: NodeStateTexts = {
  collecting: 'Collecting data\u2026',
  modifying: 'Modifying value\u2026',
  evaluating: 'Evaluating\u2026',
}

/** 未算完的节点文本：名字 + ` = ` + 状态（`XValueNodeImpl.initializePresentation`，`:84-90`）。 */
export function pendingNodeText(name: string | null, state: keyof NodeStateTexts): string {
  const head = name ? `${name}${NAME_VALUE_SEPARATOR}` : ''
  return `${head}${NODE_STATE_TEXTS[state]}`
}

/**
 * 改值中的节点文本：清空后只剩名字 + 分隔符 + 状态（`XValueNodeImpl.setValueModificationStarted`，`:352-361`）。
 * 与 `pendingNodeText` 的差别只有「名字必在」（上游这里 `appendName()` 不带条件，`:356`）。
 */
export function modifyingNodeText(name: string): string {
  return `${name}${NAME_VALUE_SEPARATOR}${NODE_STATE_TEXTS.modifying}`
}

/** 值被就地改过要换高亮（`XValueNodeImpl.appendName` 里 `isChanged()` 分支，`XValueNodeImpl.java:237`；
 *  两个属性 `CHANGED_VALUE_ATTRIBUTES` / `VALUE_NAME_ATTRIBUTES` 在 `XDebuggerUIConstants.java:26-30`）。 */
export function valueNameChanged(isChanged: boolean): boolean {
  return isChanged
}

// ── 四、孩子太多的省略号节点 + 与 src/debugPaging.ts 的关系 ──────────────────────────────────

/** 一次最多报多少孩子（`XCompositeNode.MAX_CHILDREN_TO_SHOW`，`XCompositeNode.java:20`）。 */
export const MAX_CHILDREN_TO_SHOW = 100

/**
 * 省略号节点的文本（`MessageTreeNode.createEllipsisNode`，`:100-113`）：
 * `remaining === -1` = 不知道还有多少（`XDebuggerBundle.properties:134`），否则报条数（`:133`）。
 * 上游 `{0}` 是同一个数出现两次（条数 + 单复数选择），这里照它的可观察文本落。
 */
export function ellipsisText(remaining: number): string {
  if (remaining < 0) return '... (Double-click to see more items)'
  return `... (${remaining} more ${remaining === 1 ? 'item' : 'items'}. Double-click to see)`
}

/** 一个省略号节点（值取完就没了 —— `addChildren(…, last=true)` 会移除临时消息节点，`XValueContainerNode.java:106-112`）。 */
export interface EllipsisNode {
  kind: 'ellipsis'
  text: string
  remaining: number
}

/**
 * 把上游的省略号节点语义接到本仓的分页规则上。
 *
 * **关系（复用还是补缺）**：分页的**计数**复用 `src/debugPaging.ts` ——
 * `hasMoreVariableChildren` / `remainingVariableChildren` 已经把「适配器报的总量减已取回」算好了
 * （本仓是 DAP 的 `start`/`count` 分页；上游是 `MAX_CHILDREN_TO_SHOW` 一批一批加、加不完就挂省略号节点，
 * 两条路要的「还有多少」是同一个量）。本模块只补上游那一半：
 * **省略号节点的存在条件与文案**（`XCompositeNode.tooManyChildren`，`:43-45`；
 * `XValueContainerNode.tooManyChildren`，`:162-174`）。取完了就返回 null —— 不画一个点不动的假节点。
 */
export function pagedEllipsisNode(loaded: number, info: VariablePageInfo): EllipsisNode | null {
  if (!hasMoreVariableChildren(loaded, info)) return null
  const remaining = remainingVariableChildren(loaded, info)
  return { kind: 'ellipsis', text: ellipsisText(remaining), remaining }
}

/** 适配器没报总量时的省略号节点（上游 `remaining === -1` 那一支，`MessageTreeNode.java:104`）。 */
export function unknownRemainingEllipsisNode(): EllipsisNode {
  return { kind: 'ellipsis', text: ellipsisText(-1), remaining: -1 }
}

/**
 * 一批一批地加孩子（上游 Java 侧的切块口径）：`DebuggerUtilsImpl.partition(children, MAX_CHILDREN_TO_SHOW)`
 * 然后每块 `addChildren(chunk, false)`、最后 `addChildren(EMPTY, true)`
 * （`java/debugger/impl/src/com/intellij/debugger/engine/JavaStaticGroup.java:80-89`；
 * 字段那条同口径 `ClassRenderer.java:249-254`）。
 */
export function chunkChildren<T>(children: readonly T[], size = MAX_CHILDREN_TO_SHOW): T[][] {
  const batch = Number.isFinite(size) && size > 0 ? Math.trunc(size) : MAX_CHILDREN_TO_SHOW
  const chunks: T[][] = []
  for (let index = 0; index < children.length; index += batch) chunks.push(children.slice(index, index + batch))
  return chunks
}

// ── 五、XValue 节点动作表（platform/xdebugger-impl/ui/src/.../tree/actions 那一族）──────────────

/**
 * 动作 id。前十二个逐字对应 `intellij.platform.debugger.impl.ui.actions.xml` 的
 * `XDebugger.ValueGroup` 组（`:134-150`）与组外的两条（`:20-30`、`:152-154`）。
 */
export type XValueNodeActionId =
  | 'inspect' | 'mark-object' | 'set-value' | 'copy-value' | 'compare-clipboard' | 'copy-name'
  | 'evaluate-expression' | 'evaluate-in-console' | 'add-to-watch' | 'show-referring'
  | 'jump-to-source' | 'jump-to-type-source' | 'pin-to-top' | 'view-as' | 'toggle-sort-values'
  | 'show-as-object' | 'set-text-value'

/** 每条动作的上游文案（bundle 键 + 原文），用于文案 parity 核对。 */
export interface XValueNodeActionText {
  /** bundle 键（`XDebuggerUiBundle.properties` 或 `XDebuggerBundle.properties` 里的 key）。 */
  key: string
  /** 上游英文原文（本仓界面上按仓内惯例用中文，这里保留原文以便逐字核对）。 */
  upstreamText: string
  /** 本仓界面文案。 */
  label: string
}

/**
 * 文案表。行号指 `platform/xdebugger-impl/ui/resources/messages/XDebuggerUiBundle.properties`
 * （前十六条）与 `platform/xdebugger-api/resources/messages/XDebuggerBundle.properties`（后两条）。
 */
export const X_VALUE_ACTION_TEXTS: Record<XValueNodeActionId, XValueNodeActionText> = {
  'inspect': { key: 'action.XDebugger.Inspect.text', upstreamText: 'Inspect\u2026', label: '检查' },
  'mark-object': { key: 'action.Debugger.MarkObject.text', upstreamText: 'Mark Object\u2026', label: '标记对象' },
  'set-value': { key: 'action.XDebugger.SetValue.text', upstreamText: 'Set Value\u2026', label: '设置值' },
  'copy-value': { key: 'action.XDebugger.CopyValue.text', upstreamText: 'Copy Value', label: '复制值' },
  'compare-clipboard': { key: 'action.XDebugger.CompareValueWithClipboard.text', upstreamText: 'Compare Value with Clipboard', label: '与剪贴板比较' },
  'copy-name': { key: 'action.XDebugger.CopyName.text', upstreamText: 'Copy Name', label: '复制名称' },
  'evaluate-expression': { key: 'XDebugger.EvaluateExpression', upstreamText: 'Evaluate Expression', label: '求值表达式' },
  'evaluate-in-console': { key: 'action.Debugger.Tree.EvaluateInConsole.text', upstreamText: 'Evaluate In Console', label: '在控制台中求值' },
  'add-to-watch': { key: 'action.Debugger.AddToWatch.text', upstreamText: 'Add to Watches', label: '添加到监视' },
  'show-referring': { key: 'action.Debugger.ShowReferring.text', upstreamText: 'Show Referring Objects\u2026', label: '显示引用对象' },
  'jump-to-source': { key: 'action.XDebugger.JumpToSource.text', upstreamText: 'Jump To Source', label: '跳转到源' },
  'jump-to-type-source': { key: 'action.XDebugger.JumpToTypeSource.text', upstreamText: 'Jump To Type Source', label: '跳到类型源码' },
  'pin-to-top': { key: 'action.XDebugger.PinToTop.text', upstreamText: 'Pin to Top', label: '置顶' },
  'view-as': { key: 'Debugger.ViewAsGroup', upstreamText: 'View as', label: '查看为' },
  'toggle-sort-values': { key: 'action.XDebugger.ToggleSortValues.text', upstreamText: 'Sort Variables Alphabetically', label: '按名字排序变量' },
  'show-as-object': { key: 'action.Debugger.XDebuggerTextPopup.ShowAsObject.text', upstreamText: 'Show as Object', label: '按对象显示' },
  'set-text-value': { key: 'xdebugger.set.text.value.action.title', upstreamText: 'Set', label: '设置文本值' },
}

/**
 * 节点能力 —— 每个字段都是上游一条 `isEnabled` 判据在 DAP 侧的等价物。
 * 判定「这条通道在不在」而不是「按钮该不该亮」：没有通道的动作按上游口径**隐藏**（不是置灰）。
 */
export interface XValueNodeCapabilities {
  /** 节点有名字（所有树动作的基类判据，`XDebuggerTreeActionBase.kt:52-54` / `XDebuggerTreeSplitActionBase.kt:46-48`）。 */
  hasName: boolean
  /** 值已经算出来了，或是监视节点（复制值一族的 `isEnabled`，`AbstractXFetchValueAction.java:40-46`）。 */
  computed: boolean
  /** 这一行是监视节点（`XSetValueAction` 对监视节点隐藏并禁用，`XSetValueAction.java:25-30`）。 */
  isWatchNode: boolean
  /** 值可改（`XValue.getModifier() != null`，`XSetValueAction.java:34-36`）。 */
  modifier: boolean
  /** 有监视视图可加（`DebuggerUIUtil.getWatchesView(e) != null`，`XAddToWatchesTreeAction.java:19-21`）。 */
  watchesView: boolean
  /** 控制台可执行（`getConsoleExecuteAction != null`，`EvaluateInConsoleFromTreeAction.java:14-16`）。 */
  consoleExecutable: boolean
  /** 有引用查询提供者（`getReferrersProvider() != null`，`ShowReferringObjectsAction.java:39-41`）。 */
  referrersProvider: boolean
  /** 能跳到值的源码（`canNavigateToSource()`，`XJumpToSourceAction.kt:14-16`）。 */
  canNavigateToSource: boolean
  /** 能跳到类型的源码（`canNavigateToTypeSource()`，`XJumpToTypeSourceAction.kt:14-16`）。 */
  canNavigateToTypeSource: boolean
  /** 后端有对应值（`hasBackendCounterpart`，`XJumpToSourceActionBase.kt:34-36`；对象标记也读它）。 */
  backendCounterpart: boolean
  /** 会话有值标记通道（`session.valueMarkers`，`XMarkObjectActionHandler.kt:48-53`）。 */
  valueMarkers: boolean
  /** 这个值可被标记（`markers.canMarkValue(value)`，`XMarkObjectActionHandler.kt:53`）。 */
  canMarkValue: boolean
  /** 这个值现在已被标记（`markers.getMarkup(value) != null`，`XMarkObjectActionHandler.kt:56-62`）。 */
  marked: boolean
  /** 会话可求值（`session.getCurrentEvaluator() != null`，`XDebuggerEvaluateActionHandler.java:57-64`）。 */
  evaluator: boolean
  /** 可置顶（`PinToTopMemberValue` + `isPinToTopSupported` + `canBePinned`，`XDebuggerPinToTopAction.kt:60-77`）。 */
  canBePinned: boolean
  /** 现在已置顶（`pinToTopManager.isItemPinned(node)`，`XDebuggerPinToTopAction.kt:76-77`）。 */
  pinned: boolean
  /** 这个值有适用的呈现器（Java 侧 `View as` 的子项非空，`ViewAsGroup.kt:89-91` / `:94-107`）。 */
  applicableRenderers: boolean
  /** 有调试会话（`SortValuesToggleAction` 的判据，`SortValuesToggleAction.kt:17-22`）。 */
  session: boolean
  /** 这个视图的值已经被自定义排序（同上：`isValuesCustomSorted` 为真时该动作不可用）。 */
  valuesCustomSorted: boolean
  /** 值是文本提供者且文本可见（`XValueTextProvider.shouldShowTextValue()`，`XDebuggerTextPopup.java:312-321`）。 */
  textProvider: boolean
}

/** 除 `hasName` 外全部为假的缺省能力（新节点刚建出来时的形状）。 */
export function emptyCapabilities(): XValueNodeCapabilities {
  return {
    hasName: false, computed: false, isWatchNode: false, modifier: false, watchesView: false,
    consoleExecutable: false, referrersProvider: false, canNavigateToSource: false,
    canNavigateToTypeSource: false, backendCounterpart: false, valueMarkers: false, canMarkValue: false,
    marked: false, evaluator: false, canBePinned: false, pinned: false, applicableRenderers: false,
    session: false, valuesCustomSorted: false, textProvider: false,
  }
}

/** 一条动作的判定结果：`visible` 假 = 按上游口径不该画（不是画个点不动的）。 */
export interface XValueNodeActionItem {
  id: XValueNodeActionId
  label: string
  /** 上游英文原文（逐字核文案用）。 */
  upstreamText: string
  enabled: boolean
  visible: boolean
  /** 不可用的原因（进 `title`）。 */
  hint?: string
}

/**
 * 上游「不可用就隐藏」的三处：`ShowReferringObjectsAction.update` 把 visible 设成 enabled
 * （`ShowReferringObjectsAction.java:31-36`）、`EvaluateInConsoleFromTreeAction.update` 在没有控制台动作时
 * 直接 `setEnabledAndVisible(false)`（`EvaluateInConsoleFromTreeAction.java:18-27`）、
 * `XDebuggerPinToTopAction.update` 在不是可置顶值时 `isEnabledAndVisible = false`
 * （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/pinned/items/actions/XDebuggerPinToTopAction.kt:65-73`）。
 * 这三条按上游就该**不画**，所以 `visible: false`。
 */
function item(id: XValueNodeActionId, enabled: boolean, visible = true, hint?: string): XValueNodeActionItem {
  const text = X_VALUE_ACTION_TEXTS[id]
  const entry: XValueNodeActionItem = { id, label: text.label, upstreamText: text.upstreamText, enabled, visible }
  if (!enabled && hint) entry.hint = hint
  return entry
}

const NO_NAME = '这一行没有名字'
const NOT_COMPUTED = '值还没算出来'

/**
 * 节点动作清单，**顺序照 `XDebugger.ValueGroup` 组**（`intellij.platform.debugger.impl.ui.actions.xml:134-150`）：
 * Inspect → MarkObject → SetValue → CopyValue → CompareValueWithClipboard → CopyName →
 * EvaluateExpression → EvaluateInConsole → AddToWatch → ShowReferring → JumpToSource → JumpToTypeSource，
 * 末尾 `XDebugger.PinToTop`（`:152-154`，`anchor="last"`）。`View as` 是 Java 插件挂在同一组末尾的
 * （`intellij.java.debugger.impl.shared.content.xml:63-65`），这里跟在置顶之后。
 *
 * `debuggerSupported` 是上游 `XDebuggerActionBase` 那条总闸的等价物：没有可解析的 `DebuggerSupport`
 * 时整组动作不可用（`XDebuggerActionBase.kt:38-41`/`:57-59`）。缺省当真（活链路里内建 dap 支持一直在）。
 */
export function xValueNodeActions(caps: XValueNodeCapabilities, debuggerSupported = true): XValueNodeActionItem[] {
  const items = xValueNodeActionItems(caps)
  if (debuggerSupported) return items
  return items.map(entry => ({ ...entry, enabled: false, hint: '没有可用的调试器支持，调试动作全部停用' }))
}

function xValueNodeActionItems(caps: XValueNodeCapabilities): XValueNodeActionItem[] {
  const base = caps.hasName
  const fetchValue = caps.isWatchNode || caps.computed
  const markEnabled = caps.valueMarkers && caps.canMarkValue && caps.backendCounterpart
  const jumpBase = base && caps.backendCounterpart
  return [
    // 基类判据只有 node.name != null（XDebuggerTreeSplitActionBase.kt:46-48）。
    item('inspect', base, true, NO_NAME),
    // 没有值标记通道时上游直接隐藏（XMarkObjectActionHandler.kt:64-66）；文案随 marked 切换（MarkObjectAction.java:29-35）。
    item('mark-object', markEnabled, caps.valueMarkers, caps.valueMarkers ? '这个值不能被标记' : '会话没有值标记通道'),
    // 监视节点隐藏并禁用（XSetValueAction.java:25-30），其余可见但要有 modifier（:34-36）。
    item('set-value', base && !caps.isWatchNode && caps.modifier, !caps.isWatchNode,
      caps.isWatchNode ? '监视节点不能就地改值' : '这个值不可改'),
    item('copy-value', fetchValue, true, NOT_COMPUTED),
    item('compare-clipboard', fetchValue, true, NOT_COMPUTED),
    item('copy-name', base, true, NO_NAME),
    // 没有会话/求值器时 XDebuggerSplitActionHandler.isEnabled 为假（XDebuggerSplitActionHandler.kt:31-35）；
    // 这条动作 hide-disabled-in-popup（EvaluateAction.java:12-14），所以不可用时不画。
    item('evaluate-expression', base && caps.session && caps.evaluator, caps.session && caps.evaluator,
      caps.session ? '当前帧不支持求值' : '没有调试会话'),
    item('evaluate-in-console', base && caps.watchesView && caps.consoleExecutable, caps.consoleExecutable,
      '控制台不可执行'),
    item('add-to-watch', base && caps.watchesView, true, '没有监视视图'),
    item('show-referring', base && caps.referrersProvider, caps.referrersProvider, '这个值没有引用查询通道'),
    item('jump-to-source', jumpBase && caps.canNavigateToSource, true, '这个值没有源码位置'),
    item('jump-to-type-source', jumpBase && caps.canNavigateToTypeSource, true, '这个值没有类型源码位置'),
    item('pin-to-top', caps.canBePinned, caps.canBePinned, '这个值不能置顶'),
    item('view-as', caps.applicableRenderers, caps.applicableRenderers, '没有适用的呈现器'),
    // 有会话且视图没被自定义排序过才可用（SortValuesToggleAction.kt:17-22）。
    item('toggle-sort-values', caps.session && !caps.valuesCustomSorted, true, '这个视图已被自定义排序'),
  ]
}

/**
 * 值文本弹层（快速求值提示）工具条上的两条 —— `XDebuggerTextPopup.getToolbarActions`
 * （`platform/xdebugger-impl/ui/src/com/intellij/xdebugger/impl/evaluate/quick/common/XDebuggerTextPopup.java:249-256`）：
 * `ShowAsObject`（`:329-344`，永远可点）与 `SetTextValueAction`（`:346-357`，
 * `update` 里 `setEnabledAndVisible(canSetTextValue(...))`，`:353-357`）。
 * `canSetTextValue` = 值是 `XValueTextProvider` 且 `shouldShowTextValue()` 且 `getModifier() != null`
 * （`:308-321`）。
 */
export function textPopupActions(caps: XValueNodeCapabilities): XValueNodeActionItem[] {
  const canSetText = caps.textProvider && caps.modifier
  return [
    item('show-as-object', true, true),
    item('set-text-value', canSetText, canSetText, '这个值不是可改的文本值'),
  ]
}

/**
 * 这条动作该不该在**右键菜单**里出现。上游 `XDebuggerActionBase.update` 的口径：
 * `myHideDisabledInPopup` 为真且事件来自右键菜单时，不可用就不画（`XDebuggerActionBase.kt:29-35`）。
 * 本仓没有 Swing 菜单，等价物是弹层里是否渲染这一条。
 */
export function actionVisibleInPopup(entry: XValueNodeActionItem, hideDisabledInPopup: boolean): boolean {
  if (!entry.visible) return false
  return hideDisabledInPopup ? entry.enabled : true
}