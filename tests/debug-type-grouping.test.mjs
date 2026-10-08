// 调试器「按类型分组的树节点 + XValue 节点动作」的判据（`src/debugTypeGrouping.ts`）。
//
// 上游这一族的真实形状（坐标在模块注释里逐条给出，这里守的是**可观察行为**）：
//   · `XValueChildrenList` 的五格孩子与 `XValueContainerNode.getChildren()` 的渲染顺序；
//   · `XValueGroup` 的四个字段 + 各插件里真实存在的组的**确切规格**（Java 静态组 / Python 三组 /
//     错误组 / 行内监视组）；
//   · `XValueGroupNodeImpl` 的初始展开态与写回；
//   · `XValuePresentation` 五档 + `XValueNodeImpl.buildText` 的行文本；
//   · `XDebugger.ValueGroup` 那一串节点动作的**顺序**与**可用性/可见性判据**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  GROUP_SEPARATOR, MAX_CHILDREN_TO_SHOW, MAX_NAME_LENGTH, MAX_VALUE_LENGTH, NAME_VALUE_SEPARATOR,
  NODE_STATE_TEXTS, PROTECTED_ATTRS_EXCLUDED, VALUE_SEPARATOR, X_VALUE_ACTION_TEXTS,
  actionVisibleInPopup, chunkChildren, configurePresentation, ellipsisText, emptyCapabilities, emptyChildSlots,
  errorsGroupSpec,
  escapeInvisible, groupExpansionToStore, groupInitialExpanded, groupNodeText, inlineWatchesGroupSpec,
  isProtectedAttribute, isSlotBeforeValues, modifyingNodeText, orderedChildren, pagedEllipsisNode,
  pendingNodeText, protectedAttributesGroupSpec, renderValueText, returnValuesGroupSpec,
  specialVariablesGroupSpec, staticGroupSpec, staticGroupVisible, textPopupActions, truncateName,
  unknownRemainingEllipsisNode, valueLineText, valueNameChanged, xValueNodeActions,
} from '../src/debugTypeGrouping.ts'
import { variablePageInfo } from '../src/debugPaging.ts'

const withCaps = (over = {}) => ({ ...emptyCapabilities(), hasName: true, ...over })
const ids = list => list.map(entry => entry.id)
const item = (list, id) => list.find(entry => entry.id === id)

test('五格孩子与渲染顺序：topValues → topGroups → values → bottomGroups（XValueContainerNode:291-299）', () => {
  const slots = emptyChildSlots()
  slots.topValues.push('top-value')
  slots.topGroups.push('top-group')
  slots.values.push('value')
  slots.bottomGroups.push('bottom-group')
  assert.deepEqual(orderedChildren(slots), ['top-value', 'top-group', 'value', 'bottom-group'])
  assert.equal(isSlotBeforeValues('top'), true)
  assert.equal(isSlotBeforeValues('bottom'), false)
  // 空容器什么都不报（XValueContainer.java:26-28）。
  assert.deepEqual(orderedChildren(emptyChildSlots()), [])
})

test('Java 静态组：top 槽、名字 "static"、注释 " members of 类型名"、分隔符空串', () => {
  const spec = staticGroupSpec('com.example.Foo')
  assert.equal(spec.name, 'static', 'StaticDescriptorImpl.java:37-40')
  assert.equal(spec.comment, ' members of com.example.Foo', 'JavaStaticGroup.java:45-51')
  assert.equal(spec.separator, '', 'JavaStaticGroup.java:53-56 —— 所以组行文本是 "static members of Foo"')
  assert.equal(spec.slot, 'top', 'JavaStackFrame.java:263 用 topGroups')
  assert.equal(groupNodeText(spec), 'static members of com.example.Foo')
  // 类型名为空 ⇒ 上游 getComment() 返回 null（JavaStaticGroup.java:48-50），本仓落空串、不画分隔符。
  assert.equal(groupNodeText(staticGroupSpec('  ')), 'static')
})

test('静态组的出现条件：不是实例帧且类型有静态字段（JavaStackFrame.java:256 / :261）', () => {
  assert.equal(staticGroupVisible(false, true), true)
  assert.equal(staticGroupVisible(true, true), false, '有 this 对象就不加静态组')
  assert.equal(staticGroupVisible(false, false), false, '没有静态字段不加')
})

test('Python 三个组：受保护属性（bottom）/ 返回值（bottom）/ 特殊变量（bottom），名字逐字', () => {
  const protectedSpec = protectedAttributesGroupSpec()
  assert.equal(protectedSpec.name, 'Protected Attributes', 'PydevBundle.properties:4')
  assert.equal(protectedSpec.slot, 'bottom', 'PyDebugValueGroups.kt:96 用 bottomGroup')
  const ret = returnValuesGroupSpec()
  assert.equal(ret.name, 'Return Values', 'PyBundle.properties:876')
  assert.equal(ret.slot, 'bottom', 'PyStackFrame.java:172-175')
  const special = specialVariablesGroupSpec()
  assert.equal(special.name, 'Special Variables', 'PyBundle.properties:875')
  assert.equal(special.slot, 'bottom', 'PyStackFrame.java:176-179')
  // 三个组都没有注释与自定义分隔符 ⇒ 组行文本就是名字。
  for (const spec of [protectedSpec, ret, special]) {
    assert.equal(spec.comment, '')
    assert.equal(spec.separator, GROUP_SEPARATOR)
    assert.equal(spec.autoExpand, false)
    assert.equal(spec.restoreExpansion, false)
    assert.equal(groupNodeText(spec), spec.name)
  }
})

test('受保护属性的判定：下划线开头且不在 {__len__, __exception__} 里（PyDebugValue.java:583 + :14-16）', () => {
  assert.deepEqual(PROTECTED_ATTRS_EXCLUDED, ['__len__', '__exception__'])
  assert.equal(isProtectedAttribute('_private'), true)
  assert.equal(isProtectedAttribute('__len__'), false, '排除表里的不算')
  assert.equal(isProtectedAttribute('__exception__'), false)
  assert.equal(isProtectedAttribute('public'), false)
  assert.equal(isProtectedAttribute('x_y'), false)
})

test('错误组与行内监视组：名字逐字、槽位照上游（ArrayRenderer:409-411 / InlineWatchesRootNode:47）', () => {
  assert.equal(errorsGroupSpec().name, 'Errors', 'ErrorsValueGroup.java:21-23')
  assert.equal(errorsGroupSpec().slot, 'bottom', 'ArrayRenderer.java:409-411 用 bottomGroup')
  assert.equal(inlineWatchesGroupSpec().name, 'Inline Watches', 'XDebuggerBundle.properties:298')
})

test('组的初始展开态：restoreExpansion + 存档有该组名 ⇒ 用存档，否则 autoExpand（XValueGroupNodeImpl:34-42）', () => {
  const restoring = { ...protectedAttributesGroupSpec(), restoreExpansion: true, autoExpand: false }
  assert.equal(groupInitialExpanded(restoring, { 'Protected Attributes': true }), true, '存档说展开过')
  assert.equal(groupInitialExpanded(restoring, { 'Protected Attributes': false }), false)
  assert.equal(groupInitialExpanded(restoring, {}), false, '存档里没有 ⇒ 退回 autoExpand')
  assert.equal(groupInitialExpanded(restoring, null), false)
  const auto = { ...restoring, autoExpand: true }
  assert.equal(groupInitialExpanded(auto, {}), true, '没有存档时用 isAutoExpand()')
  assert.equal(groupInitialExpanded(auto, { 'Protected Attributes': false }), false, '存档优先于 autoExpand')
  // 不跨会话存的组永远用 autoExpand（本仓现有的组都 restoreExpansion=false）。
  const plain = protectedAttributesGroupSpec()
  assert.equal(groupInitialExpanded(plain, { 'Protected Attributes': true }), false)
})

test('展开态写回：只有 restoreExpansion 且组名非空的组才写（XValueGroupNodeImpl:44-52）', () => {
  const restoring = { ...protectedAttributesGroupSpec(), restoreExpansion: true }
  assert.deepEqual(groupExpansionToStore(restoring, true), { name: 'Protected Attributes', expanded: true })
  assert.deepEqual(groupExpansionToStore(restoring, false), { name: 'Protected Attributes', expanded: false })
  assert.equal(groupExpansionToStore(protectedAttributesGroupSpec(), true), null, '不跨会话存的不写')
  assert.equal(groupExpansionToStore({ ...restoring, name: '' }, true), null, '组名为空不写（上游判 isEmpty）')
})

test('值呈现五档：regular 直出、string 套引号，两档都做不可见字符转义', () => {
  assert.equal(renderValueText('abc'), 'abc')
  assert.equal(renderValueText('abc', 'regular'), 'abc')
  assert.equal(renderValueText('abc', 'numeric'), 'abc')
  assert.equal(renderValueText('abc', 'keyword'), 'abc')
  assert.equal(renderValueText('abc', 'error'), 'abc')
  assert.equal(renderValueText('a\nb', 'string'), '"a\\nb"', 'XStringValuePresentation.java:32-34 + XValueTextRendererImpl.java:51-58')
  assert.equal(renderValueText('a\tb'), 'a\\tb', 'regular 也转义（XValueTextRendererImpl.java:38-41）')
})

test('不可见字符转义表照 XValuePresentationUtil.getEscapingSymbol（:126-139）', () => {
  assert.equal(escapeInvisible('\n\r\t\b\f'), '\\n\\r\\t\\b\\f')
  assert.equal(escapeInvisible('\u0007\u000b'), '\\a\\v')
  assert.equal(escapeInvisible('plain'), 'plain')
})

test('值文本长度上限 1000（XValueNode.MAX_VALUE_LENGTH，XValueNode.java:36）', () => {
  assert.equal(MAX_VALUE_LENGTH, 1000)
  assert.equal(renderValueText('x'.repeat(1500)).length, 1000)
  assert.equal(renderValueText('x'.repeat(1500), 'string').length, 1002, '引号在截断之外')
})

test('行文本 = 分隔符 + {类型} + 值；类型为空就不画那一段（XValueNodeImpl.buildText:261-274）', () => {
  assert.equal(VALUE_SEPARATOR, ' = ')
  assert.equal(valueLineText('42', 'int'), ' = {int} 42')
  assert.equal(valueLineText('42'), ' = 42')
  assert.equal(valueLineText('hi', 'String', 'string'), ' = {String} "hi"')
})

test('渲染配置入口：三要素 → 文本，过期节点丢弃这次呈现（XValueNodePresentationConfigurator.java:64-98）', () => {
  assert.deepEqual(configurePresentation({ value: '42', type: 'int' }), { drop: false, text: ' = {int} 42' })
  assert.deepEqual(configurePresentation({ value: 'hi', type: 'String', kind: 'string' }), { drop: false, text: ' = {String} "hi"' })
  assert.deepEqual(configurePresentation({ value: '42', separator: ': ' }), { drop: false, text: ': 42' }, '换分隔符的重载（:77-80）')
  assert.deepEqual(configurePresentation({ value: '42', obsolete: true }), { drop: true, text: '' }, '过期节点丢弃（:96-98）')
})

test('名字上限 100（XValueNodeImpl.MAX_NAME_LENGTH，XValueNodeImpl.java:55）', () => {
  assert.equal(MAX_NAME_LENGTH, 100)
  assert.equal(truncateName('a'.repeat(50)), 'a'.repeat(50))
  assert.equal(truncateName('a'.repeat(150)).length, 100)
})

test('未算完/改值中的节点文本照上游三处状态文案', () => {
  assert.equal(NODE_STATE_TEXTS.collecting, 'Collecting data\u2026', 'XDebuggerBundle.properties:130')
  assert.equal(NODE_STATE_TEXTS.modifying, 'Modifying value\u2026', 'XDebuggerBundle.properties:131')
  assert.equal(NODE_STATE_TEXTS.evaluating, 'Evaluating\u2026', 'XDebuggerBundle.properties:132')
  assert.equal(NAME_VALUE_SEPARATOR, ' = ', 'XDebuggerUIConstants.java:34 的 EQ_TEXT')
  assert.equal(pendingNodeText('user', 'collecting'), 'user = Collecting data\u2026')
  assert.equal(pendingNodeText(null, 'collecting'), 'Collecting data\u2026', '没有名字就不画名字与分隔符（XValueNodeImpl.java:84-90）')
  assert.equal(modifyingNodeText('user'), 'user = Modifying value\u2026', 'XValueNodeImpl.java:352-361')
})

test('改过值的名字要换高亮（XValueNodeImpl.java:237 + XDebuggerUIConstants.java:26-30）', () => {
  assert.equal(valueNameChanged(true), true)
  assert.equal(valueNameChanged(false), false)
})

test('省略号节点文案：知道条数报条数、不知道是「更多项」（MessageTreeNode:100-113）', () => {
  assert.equal(ellipsisText(-1), '... (Double-click to see more items)', 'XDebuggerBundle.properties:134')
  assert.equal(ellipsisText(1), '... (1 more item. Double-click to see)', '单数（XDebuggerBundle.properties:133 的 choice）')
  assert.equal(ellipsisText(5), '... (5 more items. Double-click to see)')
  assert.equal(unknownRemainingEllipsisNode().remaining, -1)
  assert.equal(unknownRemainingEllipsisNode().kind, 'ellipsis')
})

test('省略号节点接本仓分页：取完就不画（复用 debugPaging 的计数，只补节点形状）', () => {
  const total10 = variablePageInfo({ namedVariables: 10 })
  assert.equal(total10.paged, true)
  assert.equal(pagedEllipsisNode(4, total10).remaining, 6)
  assert.equal(pagedEllipsisNode(4, total10).text, ellipsisText(6))
  assert.equal(pagedEllipsisNode(10, total10), null, '取完了 ⇒ 不画一个点不动的假节点')
  assert.equal(pagedEllipsisNode(12, total10), null)
  const unknown = variablePageInfo(undefined)
  assert.equal(unknown.paged, false)
  assert.equal(pagedEllipsisNode(0, unknown), null, '适配器没报总量 ⇒ 不知道还有多少，不假装有省略号')
})

test('一批一批地加孩子：按 MAX_CHILDREN_TO_SHOW=100 切块（XCompositeNode.java:20）', () => {
  assert.equal(MAX_CHILDREN_TO_SHOW, 100)
  assert.deepEqual(chunkChildren([1, 2, 3]), [[1, 2, 3]])
  const big = Array.from({ length: 250 }, (unused, index) => index)
  const chunks = chunkChildren(big)
  assert.deepEqual(chunks.map(chunk => chunk.length), [100, 100, 50], 'JavaStaticGroup.java:80-89 的分块口径')
  assert.deepEqual(chunkChildren([], 10), [])
  assert.deepEqual(chunkChildren([1, 2], 0).map(c => c.length), [2], '非法块大小退回缺省')
})

test('节点动作的顺序逐条照 XDebugger.ValueGroup（actions.xml:134-150 + :152-154）', () => {
  assert.deepEqual(ids(xValueNodeActions(withCaps())), [
    'inspect', 'mark-object', 'set-value', 'copy-value', 'compare-clipboard', 'copy-name',
    'evaluate-expression', 'evaluate-in-console', 'add-to-watch', 'show-referring',
    'jump-to-source', 'jump-to-type-source', 'pin-to-top', 'view-as', 'toggle-sort-values',
  ])
  // 文案与上游原文逐条对上（bundle 键也在表里）。
  assert.equal(X_VALUE_ACTION_TEXTS.inspect.upstreamText, 'Inspect\u2026')
  assert.equal(X_VALUE_ACTION_TEXTS['copy-value'].upstreamText, 'Copy Value')
  assert.equal(X_VALUE_ACTION_TEXTS['jump-to-type-source'].upstreamText, 'Jump To Type Source')
  assert.equal(X_VALUE_ACTION_TEXTS['pin-to-top'].key, 'action.XDebugger.PinToTop.text')
})

test('复制值一族要有算完的值（AbstractXFetchValueAction.java:40-46）', () => {
  const cold = xValueNodeActions(withCaps())
  for (const id of ['copy-value', 'compare-clipboard']) {
    assert.equal(item(cold, id).enabled, false)
    assert.equal(item(cold, id).hint, '值还没算出来')
  }
  const ready = xValueNodeActions(withCaps({ computed: true }))
  assert.equal(item(ready, 'copy-value').enabled, true)
  assert.equal(item(ready, 'compare-clipboard').enabled, true)
  // 监视节点即使没算完也算「可复制」。
  const watch = xValueNodeActions(withCaps({ isWatchNode: true }))
  assert.equal(item(watch, 'copy-value').enabled, true)
})

test('设置值：监视节点隐藏并禁用，其余可见但要有 modifier（XSetValueAction.java:25-36）', () => {
  const noModifier = xValueNodeActions(withCaps())
  assert.equal(item(noModifier, 'set-value').enabled, false)
  assert.equal(item(noModifier, 'set-value').visible, true, '不可改时上游仍可见（只有监视节点才隐藏）')
  assert.equal(item(noModifier, 'set-value').hint, '这个值不可改')
  const modifier = xValueNodeActions(withCaps({ modifier: true }))
  assert.equal(item(modifier, 'set-value').enabled, true)
  const watchNode = xValueNodeActions(withCaps({ modifier: true, isWatchNode: true }))
  assert.equal(item(watchNode, 'set-value').visible, false, 'XSetValueAction.java:25-30')
  assert.equal(item(watchNode, 'set-value').hint, '监视节点不能就地改值')
})

test('添加到监视要有监视视图；在控制台求值还要控制台可执行（XAddToWatchesTreeAction.java:19-21）', () => {
  assert.equal(item(xValueNodeActions(withCaps()), 'add-to-watch').enabled, false)
  assert.equal(item(xValueNodeActions(withCaps()), 'add-to-watch').hint, '没有监视视图')
  const view = xValueNodeActions(withCaps({ watchesView: true }))
  assert.equal(item(view, 'add-to-watch').enabled, true)
  assert.equal(item(view, 'evaluate-in-console').enabled, false)
  assert.equal(item(view, 'evaluate-in-console').visible, false, '没有控制台动作时上游直接隐藏（EvaluateInConsoleFromTreeAction.java:18-27）')
  const console = xValueNodeActions(withCaps({ watchesView: true, consoleExecutable: true }))
  assert.equal(item(console, 'evaluate-in-console').enabled, true)
  assert.equal(item(console, 'evaluate-in-console').visible, true)
})

test('上游「不可用就隐藏」的三条：显示引用对象 / 跳到类型源码 / 置顶（+ 查看为）', () => {
  const cold = xValueNodeActions(withCaps())
  assert.equal(item(cold, 'show-referring').visible, false, 'ShowReferringObjectsAction.java:31-36')
  assert.equal(item(cold, 'pin-to-top').visible, false, 'XDebuggerPinToTopAction.kt:65-73')
  assert.equal(item(cold, 'view-as').visible, false, 'ViewAsGroup.kt:89-91')
  // 跳到类型源码可见但不可用（它不在「不可用就隐藏」那一族里，判据是 canNavigateToTypeSource）。
  assert.equal(item(cold, 'jump-to-type-source').visible, true)
  assert.equal(item(cold, 'jump-to-type-source').enabled, false)
  assert.equal(item(cold, 'jump-to-type-source').hint, '这个值没有类型源码位置')
  const hot = xValueNodeActions(withCaps({ referrersProvider: true, canBePinned: true, applicableRenderers: true, backendCounterpart: true, canNavigateToTypeSource: true }))
  assert.equal(item(hot, 'show-referring').enabled, true)
  assert.equal(item(hot, 'show-referring').visible, true)
  assert.equal(item(hot, 'pin-to-top').enabled, true)
  assert.equal(item(hot, 'view-as').enabled, true)
  assert.equal(item(hot, 'jump-to-type-source').enabled, true)
})

test('跳转要后端有对应值（XJumpToSourceActionBase.kt:34-36）', () => {
  const value = withCaps({ canNavigateToSource: true, canNavigateToTypeSource: true })
  const cold = xValueNodeActions(value)
  assert.equal(item(cold, 'jump-to-source').enabled, false)
  assert.equal(item(cold, 'jump-to-type-source').enabled, false)
  const hot = xValueNodeActions({ ...value, backendCounterpart: true })
  assert.equal(item(hot, 'jump-to-source').enabled, true)
  assert.equal(item(hot, 'jump-to-type-source').enabled, true)
})

test('标记对象：要有值标记通道 + 可标记 + 后端对应值；没通道就整条隐藏（XMarkObjectActionHandler.kt:48-66）', () => {
  const noMarkers = xValueNodeActions(withCaps({ backendCounterpart: true, canMarkValue: true }))
  assert.equal(item(noMarkers, 'mark-object').visible, false)
  assert.equal(item(noMarkers, 'mark-object').hint, '会话没有值标记通道')
  const canMark = xValueNodeActions(withCaps({ valueMarkers: true, canMarkValue: true, backendCounterpart: true }))
  assert.equal(item(canMark, 'mark-object').enabled, true)
  const cannot = xValueNodeActions(withCaps({ valueMarkers: true, canMarkValue: false, backendCounterpart: true }))
  assert.equal(item(cannot, 'mark-object').visible, true)
  assert.equal(item(cannot, 'mark-object').enabled, false)
  assert.equal(item(cannot, 'mark-object').hint, '这个值不能被标记')
})

test('求值表达式：要有会话与求值器，不可用时按 hide-disabled-in-popup 不画（EvaluateAction.java:12-14）', () => {
  const cold = xValueNodeActions(withCaps())
  assert.equal(item(cold, 'evaluate-expression').enabled, false)
  assert.equal(item(cold, 'evaluate-expression').visible, false)
  assert.equal(item(cold, 'evaluate-expression').hint, '没有调试会话')
  const session = xValueNodeActions(withCaps({ session: true }))
  assert.equal(item(session, 'evaluate-expression').enabled, false)
  assert.equal(item(session, 'evaluate-expression').hint, '当前帧不支持求值')
  const hot = xValueNodeActions(withCaps({ session: true, evaluator: true }))
  assert.equal(item(hot, 'evaluate-expression').enabled, true)
  assert.equal(item(hot, 'evaluate-expression').visible, true)
})

test('按名字排序：有会话且视图没被自定义排序过才可用（SortValuesToggleAction.kt:17-22）', () => {
  assert.equal(item(xValueNodeActions(withCaps()), 'toggle-sort-values').enabled, false)
  assert.equal(item(xValueNodeActions(withCaps({ session: true })), 'toggle-sort-values').enabled, true)
  const custom = xValueNodeActions(withCaps({ session: true, valuesCustomSorted: true }))
  assert.equal(item(custom, 'toggle-sort-values').enabled, false)
  assert.equal(item(custom, 'toggle-sort-values').hint, '这个视图已被自定义排序')
})

test('没有名字时整组动作不可用（XDebuggerTreeSplitActionBase.kt:46-48）', () => {
  const anonymous = xValueNodeActions({ ...emptyCapabilities(), hasName: false, computed: true, modifier: true, watchesView: true, referrersProvider: true })
  for (const id of ['inspect', 'copy-name', 'add-to-watch', 'show-referring', 'set-value']) {
    assert.equal(item(anonymous, id).enabled, false, `${id} 要有名字`)
  }
})

test('调试器支持总闸：一个支持都没有时整组停用（XDebuggerActionBase.kt:38-41 / :57-59）', () => {
  const all = xValueNodeActions(withCaps({ computed: true, modifier: true, session: true, evaluator: true }), true)
  assert.ok(all.some(entry => entry.enabled))
  const none = xValueNodeActions(withCaps({ computed: true, modifier: true, session: true, evaluator: true }), false)
  assert.ok(none.every(entry => entry.enabled === false))
  assert.ok(none.every(entry => entry.hint === '没有可用的调试器支持，调试动作全部停用'))
})

test('右键菜单里隐藏不可用项（XDebuggerActionBase.kt:29-35 的 myHideDisabledInPopup）', () => {
  const list = xValueNodeActions(withCaps())
  const addToWatch = item(list, 'add-to-watch')
  assert.equal(actionVisibleInPopup(addToWatch, false), true, '不隐藏时不可用项也画（置灰）')
  assert.equal(actionVisibleInPopup(addToWatch, true), false, '隐藏禁用项时就不画')
  // 上游已判「不可用就隐藏」的项，两种模式下都不画。
  const referring = item(list, 'show-referring')
  assert.equal(actionVisibleInPopup(referring, false), false)
  assert.equal(actionVisibleInPopup(referring, true), false)
})

test('值文本弹层工具条：Show as Object 恒可点，Set 要「文本提供者 + 可改」（XDebuggerTextPopup.java:249-256 / :308-321）', () => {
  assert.deepEqual(ids(textPopupActions(withCaps())), ['show-as-object', 'set-text-value'])
  assert.equal(item(textPopupActions(withCaps()), 'show-as-object').enabled, true)
  const cold = item(textPopupActions(withCaps()), 'set-text-value')
  assert.equal(cold.enabled, false)
  assert.equal(cold.visible, false, 'update 里 setEnabledAndVisible(canSetTextValue(...))')
  assert.equal(item(textPopupActions(withCaps({ textProvider: true })), 'set-text-value').enabled, false, '还要 modifier')
  assert.equal(item(textPopupActions(withCaps({ textProvider: true, modifier: true })), 'set-text-value').enabled, true)
})

test('模块是纯逻辑：零 Vue import、只从 debugPaging 取值、每个坐标都带文件名', () => {
  const source = readFileSync('src/debugTypeGrouping.ts', 'utf8')
  assert.ok(!/from\s+['"]vue['"]/.test(source), '本模块不许引 Vue')
  assert.ok(!/from\s+['"]\.\/bridge['"]/.test(source), '不许引 bridge 的值（保持 node --test 可加载）')
  assert.ok(source.includes("from './debugPaging.ts'"), '值 import 必须带 .ts')
  // 引用的上游文件都要在注释里出现（防止坐标被换成"上游一般是…"这种经验值）。
  for (const path of [
    'XValueChildrenList.java', 'XValueContainer.java', 'XValueGroup.java', 'XValueGroupNodeImpl.java',
    'XValueContainerNode.java', 'XValueNodeImpl.java', 'XValueNodePresentationConfigurator.java',
    'JavaStackFrame.java', 'JavaStaticGroup.java', 'StaticDescriptorImpl.java', 'PyDebugValue.java',
    'PyDebugValueGroups.kt', 'PyStackFrame.java', 'ErrorsValueGroup.java', 'ArrayRenderer.java',
    'InlineWatchesRootNode.java', 'MessageTreeNode.java', 'XCompositeNode.java',
    'XDebuggerTreeActionBase.kt', 'XDebuggerTreeSplitActionBase.kt', 'XSetValueAction.java',
    'XAddToWatchesTreeAction.java', 'EvaluateInConsoleFromTreeAction.java', 'ShowReferringObjectsAction.java',
    'XJumpToTypeSourceAction.kt', 'XMarkObjectActionHandler.kt', 'XDebuggerPinToTopAction.kt',
    'ViewAsGroup.kt', 'SortValuesToggleAction.kt', 'XDebuggerTextPopup.java', 'XDebuggerActionBase.kt',
  ]) assert.ok(source.includes(path), `注释里要引 ${path}`)
})