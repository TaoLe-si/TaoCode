// 统一 DnD 模型（`src/dndModel.ts`）的判据 —— 对照上游 `com.intellij.ide.dnd`。
//
// 覆盖四块：① `DnDAction` 与平台动作的映射（含 alt-only 反转，`DnDManagerImpl.java:656-663`）；
// ② target 注册表沿链找最近目标（`DnDManagerImpl.registerTarget`/`getTarget`）；
// ③ `DnDEventImpl` 的 drop 判定、委派与高亮掩码（`Highlighters` 的七个位）；
// ④ 载荷与复制计划（`FileFlavorProvider`/`LinuxDragAndDropSupport.toUriList`/`DroppedFileCopy`）。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  DND_ACTION_ID, DND_ACTION_COPY_OR_MOVE, DND_HIGHLIGHT, DND_HIGHLIGHTERS,
  actionIdOf, actionFromActionId, actionForPlatformAction, dropEffectOf,
  allowedActions, effectAllowedFor, preferredActionFor, dropActionFor, dropActionForEvent,
  beginDrag, acceptDrop,
  canStartDragging, isEmptyDragBean,
  DnDTargetRegistry, DnDEventModel, HighlighterRegistry, highlightersForMask,
  toUriList, uriListToPaths, filePathsFromDragData, transferableListText, transferableListHtml,
  fileNameOf, joinPath, droppedFileCopyPlan, applyOverwriteAnswer,
} = await import('../src/dndModel.ts')

/** 假的 DataTransfer：只实现本模型读写的几个成员。 */
function fakeDataTransfer(initial = {}) {
  const store = { ...initial }
  return {
    store,
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    getData: type => store[type] ?? '',
    setData(type, value) { store[type] = value },
  }
}

test('动作 id 与 DnDConstants 对齐，且能原样往返', () => {
  assert.equal(DND_ACTION_ID.move, 2)
  assert.equal(DND_ACTION_ID.copy, 1)
  assert.equal(DND_ACTION_ID.link, 0x40000000)
  assert.equal(DND_ACTION_COPY_OR_MOVE, 3)
  for (const action of ['move', 'copy', 'link']) {
    assert.equal(actionFromActionId(actionIdOf(action)), action)
    assert.equal(dropEffectOf(action), action)
    assert.equal(effectAllowedFor(action), action)
  }
  assert.equal(actionFromActionId(999), null)
})

test('平台动作映射：alt-only 反转 COPY/MOVE，LINK 不动（上游 :656-663）', () => {
  assert.equal(actionForPlatformAction(DND_ACTION_ID.copy, false), 'copy')
  assert.equal(actionForPlatformAction(DND_ACTION_ID.move, false), 'move')
  assert.equal(actionForPlatformAction(DND_ACTION_ID.copy, true), 'move')
  assert.equal(actionForPlatformAction(DND_ACTION_ID.move, true), 'copy')
  assert.equal(actionForPlatformAction(DND_ACTION_ID.link, true), 'link')
  assert.equal(actionForPlatformAction(DND_ACTION_COPY_OR_MOVE, false), null)
})

test('落点动作：首选动作必须在 effectAllowed 里，否则退回允许的第一个', () => {
  assert.deepEqual(allowedActions('copyMove'), ['copy', 'move'])
  assert.deepEqual(allowedActions('none'), [])
  assert.deepEqual(allowedActions(undefined), [])
  // Ctrl = 复制，但源只允许 move → 退回 move，不是凭空 copy。
  assert.equal(dropActionFor('move', { ctrlKey: true }), 'move')
  assert.equal(dropActionFor('copyMove', { ctrlKey: true }), 'copy')
  assert.equal(dropActionFor('copyMove', { shiftKey: true }), 'move')
  assert.equal(dropActionFor('copyMove', { ctrlKey: true, shiftKey: true }), 'move')  // link 不在允许集里 → 退回
  assert.equal(dropActionFor('all', { ctrlKey: true, shiftKey: true }), 'link')
  assert.equal(dropActionFor('all', { altKey: true }), 'link')
  // 源什么都没允许 = 这个落点不接受。
  assert.equal(dropActionFor('none'), null)
  assert.equal(preferredActionFor({}), 'move')
})

test('beginDrag/acceptDrop 只经模型写 dataTransfer', () => {
  const data = fakeDataTransfer()
  beginDrag({ dataTransfer: data }, { text: 'a/b.ts', action: 'move' })
  assert.equal(data.store['text/plain'], 'a/b.ts')
  assert.equal(data.effectAllowed, 'move')
  let prevented = 0
  acceptDrop({ dataTransfer: data, preventDefault: () => { prevented++ } }, 'copy')
  assert.equal(prevented, 1)
  assert.equal(data.dropEffect, 'copy')
  // effectAllowed 是 move 时，Ctrl 也解析不出 copy。
  assert.equal(dropActionForEvent({ dataTransfer: data, ctrlKey: true }), 'move')
})

test('drag bean：空载荷不该起拖（DnDSource.canStartDragging 的等价判断）', () => {
  assert.equal(canStartDragging(null), false)
  assert.equal(canStartDragging({ kind: 'tab', payload: '' }), false)
  assert.equal(canStartDragging({ kind: 'tab', payload: [] }), false)
  assert.equal(canStartDragging({ kind: 'tab', payload: 'a.ts' }), true)
  assert.equal(canStartDragging({ kind: 'tool', payload: { id: 'x' } }), true)
  assert.equal(isEmptyDragBean({ kind: 'tab', payload: 'a.ts', empty: true }), true)
  assert.equal(isEmptyDragBean({ kind: 'tab', payload: 'a.ts' }), false)
})

test('target 注册表沿父链找最近的注册目标', () => {
  const registry = new DnDTargetRegistry()
  const calls = []
  const inner = { update: () => false, drop: () => calls.push('inner') }
  const outer = { update: () => true, drop: () => calls.push('outer') }
  const off = registry.register('inner', inner)
  registry.register('outer', outer)
  assert.equal(registry.size, 2)
  // 链 = 从落点往上：最近的注册目标赢。
  assert.equal(registry.targetForChain(['leaf', 'inner', 'outer']), inner)
  assert.equal(registry.targetForChain(['leaf', 'outer']), outer)
  assert.equal(registry.targetForChain(['leaf']), null)
  // 注销后同一个 id 落回外层；被顶替的注销请求不应误删新目标。
  const replacement = { update: () => true, drop: () => {} }
  registry.register('inner', replacement)
  off()
  assert.equal(registry.get('inner'), replacement)
  registry.unregister('inner')
  assert.equal(registry.targetForChain(['inner', 'outer']), outer)
  registry.clear()
  assert.equal(registry.size, 0)
})

test('DnDEventModel：drop 可行性两态、handler、委派', () => {
  const event = new DnDEventModel({ action: 'move', attachedObject: { kind: 'tab' }, point: { x: 3, y: 4 } })
  assert.equal(event.isDropPossible(), false)
  assert.equal(event.canHandleDrop(), false)
  event.setDropPossible(true, '移动到此处')
  assert.equal(event.isDropPossible(), true)
  assert.equal(event.expectedDropResult, '移动到此处')
  assert.equal(event.canHandleDrop(), false)      // 纯布尔态没有落地动作
  event.setDropPossible(false)
  assert.equal(event.dropPossible, false)
  const performed = []
  event.acceptDrop('拆分', item => performed.push(item.getAction()))
  assert.equal(event.isDropPossible(), true)
  assert.equal(event.canHandleDrop(), true)
  event.handleDrop()
  assert.deepEqual(performed, ['move'])
  // 委派：记下目标并转发；清空后不再算委派过。
  const target = { update: () => false, drop: () => performed.push('delegated') }
  assert.equal(event.delegateUpdateTo(target), false)
  assert.equal(event.wasDelegated(), true)
  assert.equal(event.getDelegatedTarget(), target)
  event.delegateDropTo(target)
  assert.deepEqual(performed, ['move', 'delegated'])
  event.clearDelegatedTarget()
  assert.equal(event.wasDelegated(), false)
  event.cleanUp()
  assert.equal(event.canHandleDrop(), false)
  assert.equal(event.highlighting, 0)
})

test('高亮：掩码命中七个高亮器，hideAllBut/isVisibleExcept 与上游一致', () => {
  assert.equal(DND_HIGHLIGHTERS.length, 7)
  assert.deepEqual(highlightersForMask(DND_HIGHLIGHT.RECTANGLE | DND_HIGHLIGHT.TEXT), ['rectangle', 'text'])
  assert.deepEqual(highlightersForMask(0), [])
  const registry = new HighlighterRegistry()
  assert.equal(registry.isVisible(), false)
  registry.show(DND_HIGHLIGHT.BOTTOM | DND_HIGHLIGHT.V_ARROWS)
  assert.deepEqual(registry.visibleNames(), ['verticalLines', 'bottom'])
  assert.equal(registry.isVisible(), true)
  assert.equal(registry.isVisibleExcept(DND_HIGHLIGHT.BOTTOM), true)
  assert.equal(registry.isVisibleExcept(DND_HIGHLIGHT.BOTTOM | DND_HIGHLIGHT.V_ARROWS), false)
  registry.hideAllBut(DND_HIGHLIGHT.BOTTOM)
  assert.deepEqual(registry.visibleNames(), ['bottom'])
  registry.hide(DND_HIGHLIGHT.BOTTOM)
  assert.equal(registry.isVisible(), false)
  registry.show(DND_HIGHLIGHT.ERROR_TEXT)
  registry.hideAll()
  assert.equal(registry.isVisible(), false)
})

test('uri-list 编解码：file:// 行、注释与非法行跳过、百分号还原', () => {
  const list = toUriList(['C:/dir/a b.ts', 'D:/x/y.txt'])
  assert.equal(list, 'file:///C:/dir/a%20b.ts\nfile:///D:/x/y.txt\n')
  assert.deepEqual(uriListToPaths(list), ['C:/dir/a b.ts', 'D:/x/y.txt'])
  assert.deepEqual(uriListToPaths('# comment\n\nfile:///E:/z.rs\nnot-a-uri'), ['E:/z.rs'])
  assert.deepEqual(uriListToPaths('file://localhost/E:/ok.txt'), ['E:/ok.txt'])
  assert.deepEqual(uriListToPaths('file://other-host/share/x'), [])
})

test('载荷取文件清单：Files 优先，退回 text/uri-list', () => {
  assert.deepEqual(filePathsFromDragData(null), [])
  assert.deepEqual(filePathsFromDragData({ files: [{ name: 'a', path: 'C:\\p\\a.ts' }] }), ['C:/p/a.ts'])
  assert.deepEqual(
    filePathsFromDragData({ getData: () => 'file:///E:/z.rs\n' }),
    ['E:/z.rs'],
  )
  // 标签拖拽的文本载荷**不是**文件，不能被当成拖入文件。
  assert.deepEqual(filePathsFromDragData({ getData: () => 'src/a.ts' }), [])
})

test('TransferableList 的文本/HTML 形态', () => {
  assert.equal(transferableListText(['a', 'b']), 'a\nb')
  assert.equal(transferableListText(['a']), 'a')
  assert.equal(transferableListHtml(['a']), '<ul>\n  <li>a</li>\n</ul>')
})

test('DroppedFileCopy 的计划：同名冲突要问，拒绝就整批不复制', () => {
  assert.equal(fileNameOf('C:\\p\\a.ts'), 'a.ts')
  assert.equal(fileNameOf('/p/q/'), 'q')
  assert.equal(joinPath('E:/dest/', 'a.ts'), 'E:/dest/a.ts')
  const existing = new Set(['E:/dest/b.ts'])
  const plan = droppedFileCopyPlan(['C:/p/a.ts', 'C:/p/b.ts', ''], 'E:/dest', target => existing.has(target))
  assert.equal(plan.skipped, 1)
  assert.deepEqual(plan.conflicts, ['b.ts'])
  assert.deepEqual(plan.items.map(item => item.target), ['E:/dest/a.ts', 'E:/dest/b.ts'])
  assert.deepEqual(applyOverwriteAnswer(plan, false), [])
  assert.deepEqual(applyOverwriteAnswer(plan, true), plan.items)
  // 没有冲突时不问也照做（上游 confirmOverwrite 只在 existing 非空时弹）。
  const clean = droppedFileCopyPlan(['C:/p/a.ts'], 'E:/dest')
  assert.deepEqual(clean.conflicts, [])
  assert.deepEqual(applyOverwriteAnswer(clean, false), clean.items)
})
