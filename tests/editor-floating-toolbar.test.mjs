// 编辑器浮动工具条的纯逻辑（src/editorFloatingToolbar.ts）—— 触发条件 / 位置 / 内容表 / 关闭条件。
//
// 上游两族同名物（本测试两族都钉）：
//   A. 选区浮条 `CodeFloatingToolbar`（platform/platform-impl/src/com/intellij/ui/codeFloatingToolbar/
//      CodeFloatingToolbar.kt）+ `FloatingToolbar`（.../openapi/actionSystem/impl/FloatingToolbar.kt）；
//   B. 右上角浮条 `EditorFloatingToolbar`（.../openapi/editor/toolbar/floating/EditorFloatingToolbar.kt）
//      + 几何在 `EditorImpl.java:5747-5765` 的 `PanelWithFloatingToolbar.doLayout`。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripLiterals } from '../.tools/strip-literals.mjs'
import {
  EDITOR_CONTEXT_BAR_MENU_GROUP,
  EDITOR_CONTEXT_BAR_MENU_MEMBERS,
  EDITOR_FLOATING_TOOLBAR_FLOW_GAP,
  EDITOR_FLOATING_TOOLBAR_INSET,
  FLOATING_CODE_TOOLBAR_GROUP,
  FLOATING_TOOLBAR_BACKGROUND_ALPHA,
  FLOATING_TOOLBAR_BUTTON_SIZE,
  FLOATING_TOOLBAR_DEBOUNCE_MS,
  FLOATING_TOOLBAR_HIDE_BY_ESCAPE,
  FLOATING_TOOLBAR_HIDING_MS,
  FLOATING_TOOLBAR_HIDE_SETTING,
  FLOATING_TOOLBAR_RETENTION_MS,
  FLOATING_TOOLBAR_SHOWING_MS,
  FLOATING_TOOLBAR_SHOW_BELOW_DEFAULT,
  FLOATING_TOOLBAR_SHOW_WITHOUT_SELECTION_KEY,
  FLOATING_TOOLBAR_TRANSLUCENT_ALPHA,
  FLOATING_TOOLBAR_UPDATE_BY_SCROLLING,
  FLOATING_TOOLBAR_VERTICAL_OFFSET,
  canShowFloatingToolbar,
  defaultFloatingToolbarState,
  editorCornerToolbarPlacement,
  escapeSuppressionContains,
  escapeSuppressionRect,
  firstNonWhitespaceColumn,
  floatingToolbarAnchorLine,
  floatingToolbarKeyReleasedReaction,
  floatingToolbarMouseMovedReaction,
  floatingToolbarMouseReleasedReaction,
  floatingToolbarPlacementNote,
  floatingToolbarReaction,
  floatingToolbarRows,
  floatingToolbarSelectionChanged,
  floatingToolbarSelectionRequired,
  floatingToolbarShowRequested,
  getLineByVisualStart,
  isFloatingToolbarOnHold,
  isOneLineSelection,
  mayShowEditorFloatingToolbar,
  resolveFloatingToolbarPlacement,
  renderableFloatingToolbarRows,
  shouldBeUnderSelection,
} from '../src/editorFloatingToolbar.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

// ── 常量：值直接对着上游那几行 ──────────────────────────────────────────────────────────

test('常量逐条对上游（registry / animator / 布局 / alpha）', () => {
  // platform/util/resources/misc/registry.properties:1041 / :1043
  assert.equal(FLOATING_TOOLBAR_VERTICAL_OFFSET, 2, 'registry.properties:1041')
  assert.equal(FLOATING_TOOLBAR_SHOW_BELOW_DEFAULT, true, 'registry.properties:1043')
  // TransparentComponentAnimator.kt:94-96
  assert.equal(FLOATING_TOOLBAR_SHOWING_MS, 500)
  assert.equal(FLOATING_TOOLBAR_HIDING_MS, 1000)
  assert.equal(FLOATING_TOOLBAR_RETENTION_MS, 1500)
  // FloatingToolbar.kt:85 debounce(50.milliseconds)
  assert.equal(FLOATING_TOOLBAR_DEBOUNCE_MS, 50)
  // EditorImpl.java:5761 的 20 与 AbstractFloatingToolbarComponent.kt:45 的 (20, 20)
  assert.equal(EDITOR_FLOATING_TOOLBAR_INSET, 20)
  assert.equal(EDITOR_FLOATING_TOOLBAR_FLOW_GAP, 20)
  // JBUI.java:1367 = Popup.DEFAULT_HINT_OPACITY（JBUI.java:1633 = 0.55f）/ :1368 = 0.9f
  assert.equal(FLOATING_TOOLBAR_BACKGROUND_ALPHA, 0.55)
  assert.equal(FLOATING_TOOLBAR_TRANSLUCENT_ALPHA, 0.9)
  // AbstractFloatingToolbarComponent.kt:48 minimumButtonSize = Dimension(22, 22)
  assert.equal(FLOATING_TOOLBAR_BUTTON_SIZE, 22)
  // HintManager.java:33 / :40
  assert.equal(FLOATING_TOOLBAR_HIDE_BY_ESCAPE, 0x01)
  assert.equal(FLOATING_TOOLBAR_UPDATE_BY_SCROLLING, 0x80)
  // FloatingToolbarCustomizer.kt:21 / DefaultFloatingToolbarProvider.kt:12
  assert.equal(FLOATING_CODE_TOOLBAR_GROUP, 'Floating.CodeToolbar')
  assert.equal(EDITOR_CONTEXT_BAR_MENU_GROUP, 'EditorContextBarMenu')
  // DisableCodeFloatingToolbarAction.kt:13 / FloatingToolbarCustomizer.kt:79
  assert.equal(FLOATING_TOOLBAR_HIDE_SETTING, 'floating.codeToolbar.hide')
  assert.equal(FLOATING_TOOLBAR_SHOW_WITHOUT_SELECTION_KEY, 'floating.codeToolbar.show.without.selection')
})

// ── 触发条件 ──────────────────────────────────────────────────────────────────────────

test('canShowFloatingToolbar：默认状态放行（有选区 + 可写 + 语言已注册）', () => {
  assert.deepEqual(canShowFloatingToolbar(defaultFloatingToolbarState()), { ok: true })
})

test('canShowFloatingToolbar：每条否决都有上游出处且各自独立', () => {
  const base = defaultFloatingToolbarState()
  const cases = [
    [{ languageRegistered: false }, 'language-not-registered'],
    [{ minimalLanguageToolbar: true, primaryLanguageHasToolbar: false }, 'minimal-without-primary'],
    [{ customizationAvailable: false }, 'customization-unavailable'],
    [{ advancedHidden: true }, 'advanced-hidden'],
    [{ documentWritable: false }, 'document-read-only'],
    [{ temporarilyDisabled: true }, 'temporarily-disabled'],
    [{ disabledCount: 1 }, 'popup-conflict'],
    [{ psiCommitted: false }, 'psi-not-committed'],
    [{ elementsWritable: false }, 'ignored-parent'],
    [{ remoteDevHost: true }, 'remote-dev-host'],
    [{ hasSelection: false, selectionRequired: true }, 'selection-required'],
  ]
  for (const [patch, reason] of cases) {
    assert.deepEqual(canShowFloatingToolbar({ ...base, ...patch }), { ok: false, reason }, reason)
  }
})

test('minimal 语言但有主语言完整浮条 ⇒ 仍可显示（FloatingToolbarCustomizer.kt:32-37）', () => {
  const state = { ...defaultFloatingToolbarState(), minimalLanguageToolbar: true, primaryLanguageHasToolbar: true }
  assert.deepEqual(canShowFloatingToolbar(state), { ok: true })
})

test('show.without.selection 关着时恒需选区（FloatingToolbarCustomizer.kt:78-85）', () => {
  assert.equal(floatingToolbarSelectionRequired(false, false), true, 'registry 默认 false ⇒ 恒 true')
  assert.equal(floatingToolbarSelectionRequired(true, true), true, '开着时看 bean 的 selectionRequired')
  assert.equal(floatingToolbarSelectionRequired(true, false), false, 'bean 说不要选区就不要')
})

test('scheduleShow 的两道闸：isEnabled 与 preventHintFromShowing（FloatingToolbar.kt:161-165）', () => {
  const state = defaultFloatingToolbarState()
  assert.equal(floatingToolbarShowRequested(state, false), true)
  assert.equal(floatingToolbarShowRequested(state, true), false, '双击选区置位后不许显示')
  assert.equal(floatingToolbarShowRequested({ ...state, documentWritable: false }, false), false)
})

test('选区变化的判定（updateOnProbablyChangedSelection，FloatingToolbar.kt:279-287）', () => {
  assert.equal(floatingToolbarSelectionChanged(null, 'abc'), false, 'null 走 hide 那一支，不算"变了"')
  assert.equal(floatingToolbarSelectionChanged('abc', 'abc'), false)
  assert.equal(floatingToolbarSelectionChanged('abcd', 'abc'), true)
})

test('mouseReleased：null→hide / 同文本→keep / 变了→shown?reposition:show（:290-298）', () => {
  assert.equal(floatingToolbarMouseReleasedReaction({ selectedText: null, lastSelection: 'x', shown: true }), 'hide')
  assert.equal(floatingToolbarMouseReleasedReaction({ selectedText: 'x', lastSelection: 'x', shown: true }), 'keep')
  assert.equal(floatingToolbarMouseReleasedReaction({ selectedText: 'xy', lastSelection: 'x', shown: true }), 'reposition')
  assert.equal(floatingToolbarMouseReleasedReaction({ selectedText: 'xy', lastSelection: 'x', shown: false }), 'show')
})

test('keyReleased：选区变了就 hide，键盘不浮出工具条（:301-311）', () => {
  assert.equal(floatingToolbarKeyReleasedReaction({ selectedText: null, lastSelection: 'x' }), 'hide')
  assert.equal(floatingToolbarKeyReleasedReaction({ selectedText: 'x', lastSelection: 'x' }), 'keep')
  assert.equal(floatingToolbarKeyReleasedReaction({ selectedText: 'xy', lastSelection: 'x' }), 'hide')
})

test('mouseMoved：指针在选区内→show，移出且未显示→解除抑制（:314-322）', () => {
  assert.equal(floatingToolbarMouseMovedReaction({ hoverSelected: true, shown: false }), 'show')
  assert.equal(floatingToolbarMouseMovedReaction({ hoverSelected: false, shown: false }), 'allow-show')
  assert.equal(floatingToolbarMouseMovedReaction({ hoverSelected: false, shown: true }), 'keep')
})

// ── 位置计算 ──────────────────────────────────────────────────────────────────────────

test('isOneLineSelection：起止在同一行（CodeFloatingToolbar.kt:154-160）', () => {
  assert.equal(isOneLineSelection(3, 3), true)
  assert.equal(isOneLineSelection(3, 4), false)
})

test('shouldBeUnderSelection：四个组合（CodeFloatingToolbar.kt:144-152）', () => {
  // showBelow 默认 true ⇒ 一律"想往下"；锚点可见就保持下方。
  assert.equal(shouldBeUnderSelection({ caretAtSelectionEnd: false, showBelow: true, endAnchorVisible: true, startAnchorVisible: true }), true)
  // 下方锚点不可见 ⇒ 翻到上方。
  assert.equal(shouldBeUnderSelection({ caretAtSelectionEnd: false, showBelow: true, endAnchorVisible: false, startAnchorVisible: true }), false)
  // showBelow 关着且光标不在选区末端 ⇒ 想往上；上方锚点可见 ⇒ 保持上方。
  assert.equal(shouldBeUnderSelection({ caretAtSelectionEnd: false, showBelow: false, endAnchorVisible: true, startAnchorVisible: true }), false)
  // 想往上但上方锚点不可见 ⇒ 翻到下方。
  assert.equal(shouldBeUnderSelection({ caretAtSelectionEnd: false, showBelow: false, endAnchorVisible: true, startAnchorVisible: false }), true)
  // 光标在选区末端时即使 showBelow 关着也往下（selectionEnd == caretModel.offset 那一支）。
  assert.equal(shouldBeUnderSelection({ caretAtSelectionEnd: true, showBelow: false, endAnchorVisible: true, startAnchorVisible: true }), true)
})

test('getLineByVisualStart：列 0 且允许退行时退一行，夹到 0（:172-178）', () => {
  assert.equal(getLineByVisualStart(5, 0, true), 4)
  assert.equal(getLineByVisualStart(5, 3, true), 5, '列非 0 不退')
  assert.equal(getLineByVisualStart(5, 0, false), 5, '不允许退就不退')
  assert.equal(getLineByVisualStart(0, 0, true), 0, 'maxOf(line-1, 0)')
})

test('firstNonWhitespaceColumn：缩进后第一个非空白列，整行空白退 0（:162-170）', () => {
  assert.equal(firstNonWhitespaceColumn('    const x = 1'), 4)
  assert.equal(firstNonWhitespaceColumn('const x = 1'), 0)
  assert.equal(firstNonWhitespaceColumn('   \t  '), 0)
  assert.equal(firstNonWhitespaceColumn(''), 0)
})

test('floatingToolbarAnchorLine：上游 when 的四支，顺序不可换（:126-131）', () => {
  // ① 单行选区 ⇒ 选区起点行，不退行。
  assert.equal(floatingToolbarAnchorLine({
    startLine: 4, endLine: 4, below: true, edgesOutsideVisibleRange: false,
    caretVisualLine: 9, caretVisualColumn: 0, startVisualLine: 4, endVisualLine: 4, caretAtLineStart: true,
  }), 4)
  // ② 两端都在可视区外 ⇒ 光标行，允许退一行。
  assert.equal(floatingToolbarAnchorLine({
    startLine: 1, endLine: 8, below: true, edgesOutsideVisibleRange: true,
    caretVisualLine: 9, caretVisualColumn: 0, startVisualLine: 1, endVisualLine: 8, caretAtLineStart: true,
  }), 8)
  // ③ 浮在下方 ⇒ 选区终点行，允许退一行。
  assert.equal(floatingToolbarAnchorLine({
    startLine: 1, endLine: 8, below: true, edgesOutsideVisibleRange: false,
    caretVisualLine: 3, caretVisualColumn: 2, startVisualLine: 1, endVisualLine: 8, caretAtLineStart: false,
  }), 7)
  // ④ 否则 ⇒ 选区起点行，不退行（即使光标在行首）。
  assert.equal(floatingToolbarAnchorLine({
    startLine: 1, endLine: 8, below: false, edgesOutsideVisibleRange: false,
    caretVisualLine: 3, caretVisualColumn: 0, startVisualLine: 1, endVisualLine: 8, caretAtLineStart: true,
  }), 1)
})

test('resolveFloatingToolbarPlacement：下方 = lineHeight + gap，只动 y（:135-140）', () => {
  const placed = resolveFloatingToolbarPlacement({
    anchor: { x: 120, y: 200 }, lineHeight: 16, width: 200, height: 40,
    viewport: { width: 800, height: 600 }, below: true, verticalOffset: 2,
  })
  assert.deepEqual(placed, { x: 120, y: 218, below: true })
})

test('resolveFloatingToolbarPlacement：上方 = -(height + gap)（:135-139）', () => {
  const placed = resolveFloatingToolbarPlacement({
    anchor: { x: 120, y: 200 }, lineHeight: 16, width: 200, height: 40,
    viewport: { width: 800, height: 600 }, below: false, verticalOffset: 2,
  })
  assert.deepEqual(placed, { x: 120, y: 158, below: false })
})

test('resolveFloatingToolbarPlacement：末尾只夹取、不翻转（ScreenUtil.moveToFit，:371-393）', () => {
  // 下方越出视口下沿 ⇒ 夹到 y = 600 - 40，而**不是**翻到上方。
  const bottom = resolveFloatingToolbarPlacement({
    anchor: { x: 100, y: 590 }, lineHeight: 16, width: 200, height: 40,
    viewport: { width: 800, height: 600 }, below: true, verticalOffset: 2,
  })
  assert.equal(bottom.y, 560)
  assert.equal(bottom.below, true, 'below 标记不变 —— 没有翻转')
  // 上方越出视口上沿 ⇒ 夹到 0。
  const top = resolveFloatingToolbarPlacement({
    anchor: { x: 100, y: 20 }, lineHeight: 16, width: 200, height: 40,
    viewport: { width: 800, height: 600 }, below: false, verticalOffset: 2,
  })
  assert.equal(top.y, 0)
  // 右侧越界 ⇒ x 夹回。
  const right = resolveFloatingToolbarPlacement({
    anchor: { x: 780, y: 100 }, lineHeight: 16, width: 40, height: 30,
    viewport: { width: 800, height: 600 }, below: true, verticalOffset: 2,
  })
  assert.equal(right.x, 760)
})

test('editorCornerToolbarPlacement：右缘内缩滚动条 + 20（EditorImpl.java:5760-5762）', () => {
  assert.deepEqual(editorCornerToolbarPlacement({
    containerWidth: 1000, toolbarWidth: 80, scrollbarWidth: 12, mirroredGutterWidth: 0, inset: EDITOR_FLOATING_TOOLBAR_INSET,
  }), { x: 888, y: 20 })
  // 镜像布局时再让开装订线。
  assert.deepEqual(editorCornerToolbarPlacement({
    containerWidth: 1000, toolbarWidth: 80, scrollbarWidth: 12, mirroredGutterWidth: 40, inset: 20,
  }), { x: 848, y: 20 })
})

test('mayShowEditorFloatingToolbar：非单行 + 非 diff + 有效 VirtualFile（EditorImpl.java:1718-1720）', () => {
  assert.equal(mayShowEditorFloatingToolbar({ oneLineMode: false, diffEditor: false, hasValidVirtualFile: true }), true)
  assert.equal(mayShowEditorFloatingToolbar({ oneLineMode: true, diffEditor: false, hasValidVirtualFile: true }), false)
  assert.equal(mayShowEditorFloatingToolbar({ oneLineMode: false, diffEditor: true, hasValidVirtualFile: true }), false)
  assert.equal(mayShowEditorFloatingToolbar({ oneLineMode: false, diffEditor: false, hasValidVirtualFile: false }), false)
})

// ── 内容表 ────────────────────────────────────────────────────────────────────────────

test('floatingToolbarRows：顺序 = 意图 → Extract → Surround → Additional → 配置组', () => {
  const rows = floatingToolbarRows(defaultFloatingToolbarState())
  assert.deepEqual(rows.map(row => row.id), [
    'editorFloatingToolbar.intention',
    'editorFloatingToolbar.extract',
    'editorFloatingToolbar.surround',
    'editorFloatingToolbar.commentLine',
    'editorFloatingToolbar.reformat',
    'editorFloatingToolbar.configure',
  ])
})

test('floatingToolbarRows：Extract 组内 ExtractMethod 在前（LangActions.xml:374-376 anchor=first）', () => {
  const extract = floatingToolbarRows(defaultFloatingToolbarState()).find(row => row.id === 'editorFloatingToolbar.extract')
  assert.deepEqual(extract.children.map(row => row.upstreamAction), [
    'ExtractMethod', 'IntroduceVariable', 'IntroduceConstant',
  ])
})

test('floatingToolbarRows：Surround 三项的顺序与文案（LangActions.xml:215-220 / ActionsBundle:2312-2314）', () => {
  const surround = floatingToolbarRows(defaultFloatingToolbarState()).find(row => row.id === 'editorFloatingToolbar.surround')
  assert.deepEqual(surround.children.map(row => row.title), ['try / catch', 'try / catch / finally', 'if'])
  assert.deepEqual(surround.children.map(row => row.template), ['try / catch', 'try / catch / finally', 'if 条件'])
})

test('floatingToolbarRows：Extract 整组随 minimal 关掉（RefactorDropdownActionGroup.kt:33）', () => {
  const minimal = { ...defaultFloatingToolbarState(), minimalLanguageToolbar: true }
  const extract = floatingToolbarRows(minimal).find(row => row.id === 'editorFloatingToolbar.extract')
  assert.equal(extract.enabled, false)
  for (const child of extract.children) assert.equal(child.enabled, false)
})

test('floatingToolbarRows：Surround 随 surroundContext 关掉（SurroundWithActionBase.kt:45）', () => {
  const noContext = { ...defaultFloatingToolbarState(), surroundContext: false }
  const surround = floatingToolbarRows(noContext).find(row => row.id === 'editorFloatingToolbar.surround')
  assert.equal(surround.enabled, false)
  for (const child of surround.children) assert.equal(child.enabled, false)
})

test('floatingToolbarRows：有活动 lookup 时意图行置灰（BaseCodeInsightAction.java:70-75）', () => {
  const lookup = { ...defaultFloatingToolbarState(), lookupActive: true }
  const intention = floatingToolbarRows(lookup).find(row => row.id === 'editorFloatingToolbar.intention')
  assert.equal(intention.enabled, false)
})

test('floatingToolbarRows：语言 bean 的两个 hide 开关各摘掉一整块（FloatingToolbarCustomizer.kt:108/111）', () => {
  const hidden = floatingToolbarRows(defaultFloatingToolbarState(), { hideIntentionsGroup: true, hideConfigurationsGroup: true })
  assert.equal(hidden.some(row => row.id === 'editorFloatingToolbar.intention'), false)
  assert.equal(hidden.some(row => row.id === 'editorFloatingToolbar.configure'), false)
})

test('floatingToolbarRows：每行的上游 id 或组 id 至少有一个（不写无出处行）', () => {
  const walk = rows => {
    for (const row of rows) {
      assert.ok(row.upstreamAction || row.upstreamGroup, `${row.id} 缺上游出处`)
      if (row.children) walk(row.children)
    }
  }
  walk(floatingToolbarRows(defaultFloatingToolbarState()))
})

test('renderableFloatingToolbarRows：没本仓落点的行被丢掉（不画假控件，惯例见 editorPopupMenu.ts:73-91）', () => {
  const all = floatingToolbarRows(defaultFloatingToolbarState())
  const renderable = renderableFloatingToolbarRows(all)
  assert.deepEqual(renderable.map(row => row.id), [
    'editorFloatingToolbar.intention',
    'editorFloatingToolbar.extract',
    'editorFloatingToolbar.surround',
    'editorFloatingToolbar.commentLine',
    'editorFloatingToolbar.reformat',
  ], '配置组两个成员都没有本仓 action ⇒ 整组被丢掉')
  // 保留下来的行都带 action（或是有子行的组）。
  const walk = rows => {
    for (const row of rows) {
      if (row.children) walk(row.children)
      else assert.ok(row.action, `${row.id} 应带本仓 action`)
    }
  }
  walk(renderable)
})

test('内容表里登记的每个本仓 action id 都真实存在（源码级 grep，防假 id）', () => {
  // 只在菜单/命令表里找 id —— 这些 id 是本仓 `runEditor(name)` 的键。
  const haystack = [
    'src/menus/editorPopupMenu.ts', 'src/menus/editMenu.ts', 'src/menus/codeMenu.ts',
    'src/menus/refactorMenu.ts', 'src/gutterMenu.ts',
  ].map(read).join('\n')
  const collect = rows => rows.flatMap(row => (row.children ? collect(row.children) : row.action ? [row.action] : []))
  for (const id of collect(floatingToolbarRows(defaultFloatingToolbarState()))) {
    assert.ok(haystack.includes(`'${id}'`), `${id} 在菜单表里找不到 —— 不该登记`)
  }
})

test('EditorContextBarMenu 的成员登记（PlatformActions.xml:1136-1141 + jsonpath plugin.xml:86-87）', () => {
  assert.deepEqual(EDITOR_CONTEXT_BAR_MENU_MEMBERS.map(entry => entry.upstreamAction), [
    'EditorToggleUseSoftWrapsInPreview', 'RestoreFontPreviewTextAction',
    'fontEditorPreview.ToggleBoldFont', 'JsonPathExportEvaluateResultAction',
  ])
})

// ── 关闭条件 ──────────────────────────────────────────────────────────────────────────

test('floatingToolbarReaction：每条事件的上游反应与出处', () => {
  assert.deepEqual(floatingToolbarReaction('escape').reaction, 'hide')
  assert.deepEqual(floatingToolbarReaction('scroll').reaction, 'reposition', 'UPDATE_BY_SCROLLING 是跟着走')
  assert.deepEqual(floatingToolbarReaction('selection-cleared').reaction, 'hide')
  assert.deepEqual(floatingToolbarReaction('key-released').reaction, 'hide')
  assert.deepEqual(floatingToolbarReaction('document-changed').reaction, 'hide', 'shouldSurviveDocumentChange=false')
  assert.deepEqual(floatingToolbarReaction('popup-conflict').reaction, 'hide')
  assert.deepEqual(floatingToolbarReaction('disabled').reaction, 'hide')
  assert.deepEqual(floatingToolbarReaction('double-click-selection').reaction, 'suppress-show')
  assert.deepEqual(floatingToolbarReaction('mouse-left-selection').reaction, 'allow-show')
  assert.deepEqual(floatingToolbarReaction('retention-timeout').reaction, 'hide')
  for (const event of ['escape', 'scroll', 'retention-timeout', 'double-click-selection']) {
    assert.ok(floatingToolbarReaction(event).source.includes('.kt:'), `${event} 的出处应带行号`)
  }
})

test('isFloatingToolbarOnHold：鼠标在上面或焦点祖先就保活（TransparentComponentAnimator.kt:82-86）', () => {
  assert.equal(isFloatingToolbarOnHold({ underMouse: true, focusAncestor: false }), true)
  assert.equal(isFloatingToolbarOnHold({ underMouse: false, focusAncestor: true }), true)
  assert.equal(isFloatingToolbarOnHold({ underMouse: false, focusAncestor: false }), false)
  // B 族的父容器口径（EditorFloatingToolbar.kt:74-77）在本模块里收敛成同一谓词。
  assert.equal(isFloatingToolbarOnHold({ underMouse: true, focusAncestor: false, measureParent: true }), true)
})

test('escapeSuppression：Esc 后鼠标还在浮条那块矩形里就不再冒出来（EditorFloatingToolbar.kt:91/104）', () => {
  const rect = escapeSuppressionRect({ x: 100, y: 200 }, { width: 60, height: 30 })
  assert.deepEqual(rect, { x: 100, y: 200, width: 60, height: 30 })
  assert.equal(escapeSuppressionContains(rect, { x: 100, y: 200 }), true, '左闭')
  assert.equal(escapeSuppressionContains(rect, { x: 159, y: 229 }), true)
  assert.equal(escapeSuppressionContains(rect, { x: 160, y: 200 }), false, '右开')
  assert.equal(escapeSuppressionContains(rect, { x: 100, y: 230 }), false)
  assert.equal(escapeSuppressionContains(null, { x: 100, y: 200 }), false, '没有那块矩形就不抑制')
})

// ── 与既有 popup 模块的关系（判词钉住，防止下一位又去复用语义不同的模块） ────────────────

test('与 popup 模块的关系：复用 clampPopupLocation，不复用 placeMenu/usePopupAnchor', () => {
  assert.match(floatingToolbarPlacementNote, /clampPopupLocation/)
  assert.match(floatingToolbarPlacementNote, /do not reuse placeMenu/)
  const source = read('src/editorFloatingToolbar.ts')
  // 真的 import 了夹取那一个（而不是又抄一份 clamp）。
  assert.match(source, /import \{ clampPopupLocation \} from '\.\/popupBounds\.ts'/)
  // 没有把带翻转的 placeMenu 引进来。
  assert.equal(/from '\.\/menuPlacement\.ts'/.test(source), false, 'placeMenu 有翻转 + margin，不能复用')
  assert.equal(/from '\.\/popupAnchor\.ts'/.test(source), false, 'usePopupAnchor 内部走 placeMenu')
})

test('模块零 Vue / 零 DOM（纯逻辑），且不写死像素以外的令牌', () => {
  // 必须剥注释/字符串再扫 —— 注释里引用上游 `document.isWritable` / `window` 是正常的
  // （`.tools/strip-literals.mjs` 就是仓库既有的剥离器，`.tools/find-ts-in-mjs.mjs` 用的同一个）。
  const code = stripLiterals(read('src/editorFloatingToolbar.ts'))
  assert.equal(/from 'vue'/.test(code), false)
  assert.equal(/\bdocument\./.test(code), false)
  assert.equal(/\bwindow\./.test(code), false)
})