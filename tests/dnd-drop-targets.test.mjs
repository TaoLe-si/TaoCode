// 「外部文件拖进目录」的落点 —— `src/dragAndDropTargets.ts`。
// 上游：`platform/platform-impl/src/com/intellij/ide/dnd/Highlighters.java` +
// `DropTargetHighlighter.java` + `DroppedFileCopy.kt`。
//
// 判决表 `pf/dnd` 的缺口原文是「**文件拖入的 drop target** —— 复制计划与 uri-list 解析已就位，
// 但编辑器与文件树都还没有 `dragover`/`drop` 挂点，外部文件拖进项目没有入口」。
// 这个模块就是那个**挂点**（写盘、确认框、进度登记全靠注入），所以这个文件钉的是
// 整条链路的行为，而不只是几何：
//   · 四个箭头图标 16×16 ⇒ H_ARROWS 四边各撑开一格、V_ARROWS 只撑上下（`Highlighters.java:247-249/271-272`）；
//   · 提示气泡落在目标矩形**右缘、垂直居中**，且整条被 `Registry.is("ide.dnd.textHints")` 门住
//     （`:148`、`:158`、`:140`）；
//   · 离开即撤（`DropTargetHighlighter.vanish()`，`:117-124`）；
//   · 复制：取不到文件名的跳过、已存在的先问一次、**用户拒绝就整批不复制**、逐项报进度、
//     **第一个失败就中断整批**、收尾刷新目标目录（`DroppedFileCopy.kt:58-98`、`:117-120`）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backgroundTaskManager } from '../src/progressTasks.ts'
import {
  ARROW_ICON_SIZE,
  BOTTOM_HIGHLIGHT_BORDER,
  COPY_ERROR_TITLE,
  COPY_OVERWRITE_TITLE,
  COPY_PROGRESS_TITLE,
  copyErrorMessage,
  copyOverwriteMessageMany,
  copyOverwriteMessageOne,
  copyProgressItem,
  createFileDropTarget,
  externalFileDropAction,
  highlighterBounds,
  highlighterIsBalloon,
  hintAnchor,
  hintVisible,
  useFileDropTarget,
} from '../src/dragAndDropTargets.ts'
import { DND_HIGHLIGHT } from '../src/dndModel.ts'

const RECT = { x: 10, y: 20, width: 100, height: 30 }

test('高亮几何：矩形/实心/下边框照 setBounds；H_ARROWS 四边撑开、V_ARROWS 只撑上下', () => {
  assert.equal(ARROW_ICON_SIZE, 16, '四个箭头图标都是 16×16，撑开量不是猜的')
  assert.equal(BOTTOM_HIGHLIGHT_BORDER, 2, 'Highlighters.java:292 的 customLine(..., 0, 0, 2, 0)')

  // 三个都是 `setBounds(目标矩形)`，只是画法不同。
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.RECTANGLE, RECT), [{ name: 'rectangle', bounds: RECT }])
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.FILLED_RECTANGLE, RECT), [{ name: 'filledRectangle', bounds: RECT }])
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.BOTTOM, RECT), [{ name: 'bottom', bounds: RECT }])
  // 掩码一个位都不命中 ⇒ 空数组（没有对应的高亮器就别画）。
  assert.deepEqual(highlighterBounds(0, RECT), [])

  // :247-249 —— 四边各撑开一格（左/上/下用 ArrowRight、右用 ArrowLeft，都是 16×16）。
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.H_ARROWS, RECT), [{
    name: 'horizontalLines',
    bounds: { x: 10 - 16, y: 20 - 16, width: 100 + 16 + 16, height: 30 + 16 },
  }])
  // :271-272 —— 只在上/下各撑开一格，左右不撑。
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.V_ARROWS, RECT), [{
    name: 'verticalLines',
    bounds: { x: 10, y: 20 - 16, width: 100, height: 30 + 16 + 16 },
  }])
  // 掩码可以同时命中多个（DndEvent.setHighlighting 传的就是一串）。
  assert.deepEqual(highlighterBounds(DND_HIGHLIGHT.FILLED_RECTANGLE | DND_HIGHLIGHT.BOTTOM, RECT).map(b => b.name),
    ['filledRectangle', 'bottom'])
})

test('提示气泡：落在目标矩形右缘、垂直居中，且整条被 ide.dnd.textHints 门住', () => {
  // BaseTextHighlighter.show（Highlighters.java:139-160）：:148 的
  // `rec.x + rec.width, rec.y + rec.height / 2`，:158 的 `Balloon.Position.atRight`。
  assert.deepEqual(hintAnchor([], RECT), { x: 110, y: 35, side: 'right' })
  // 有别的（组件型）高亮器就用它那一块的右缘。
  assert.deepEqual(hintAnchor([{ x: 0, y: 0, width: 50, height: 100 }], RECT), { x: 50, y: 50, side: 'right' })

  // :140 `if (!Registry.is("ide.dnd.textHints")) return` —— 没开这个开关什么都不显示。
  assert.equal(hintVisible(DND_HIGHLIGHT.TEXT, '复制 3 个文件', false), false)
  // 开了也只对气球那两种掩码生效。
  assert.equal(hintVisible(DND_HIGHLIGHT.RECTANGLE, '复制 3 个文件', true), false)
  assert.equal(highlighterIsBalloon(DND_HIGHLIGHT.TEXT | DND_HIGHLIGHT.ERROR_TEXT), true)
  // :143 没有预期结果就没有可显示的文字（空串也不行）。
  assert.equal(hintVisible(DND_HIGHLIGHT.TEXT, '', true), false)
  assert.equal(hintVisible(DND_HIGHLIGHT.TEXT, null, true), false)
  assert.equal(hintVisible(DND_HIGHLIGHT.TEXT, '复制 3 个文件', true), true)
})

test('落点动作恒为 copy；effectAllowed 不含 copy 时如实降级且不越权', () => {
  // DroppedFileCopy.copy（:58-98）只复制；类注释 :29-33 写明 move 不能跨文件系统。
  assert.equal(externalFileDropAction('copy'), 'copy')
  assert.equal(externalFileDropAction('copyMove'), 'copy')
  assert.equal(externalFileDropAction('all'), 'copy')
  // 浏览器不允许 dropEffect 超出 effectAllowed（同 dropActionFor 的约束）⇒ 降级。
  assert.equal(externalFileDropAction('move'), 'move')
  assert.equal(externalFileDropAction('link'), 'link')
  assert.equal(externalFileDropAction('none'), null, '什么也不允许 ⇒ 这个落点不接受')
  assert.equal(externalFileDropAction(undefined), null)
})

test('dragover 给出装饰与预期结果并 preventDefault；离开即撤', () => {
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: () => {},
  })
  const event = { dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\nfile:///src/b.txt\n' } }
  let prevented = 0
  const over = target.dragover({ ...event, preventDefault: () => { prevented++ } })
  assert.ok(over, '有效载荷 + 有效落点 ⇒ 接受')
  assert.equal(prevented, 1, '不接受这一拍浏览器就不会派发 drop')
  assert.equal(event.dataTransfer.dropEffect, 'copy')
  assert.equal(over.action, 'copy')
  assert.deepEqual(over.rect, RECT)
  assert.match(over.expectedResult, /2/, '预期结果要说出有几个文件')
  assert.equal(over.hint, false, 'ide.dnd.textHints 默认没开')
  assert.equal(target.plan().items.length, 2)

  // DropTargetHighlighter.vanish()（:117-124）：离开即撤，不留残影。
  target.dragleave()
  assert.equal(target.decoration.value, null)
  assert.equal(target.plan(), null)

  // 取不出落点矩形 / 载荷里没有文件 ⇒ 也不接受。
  const noRect = createFileDropTarget({ destinationDir: () => '/dst', targetRect: () => null, copy: () => {} })
  assert.equal(noRect.dragover(event), null)
  const noFiles = createFileDropTarget({ destinationDir: () => '/dst', targetRect: () => RECT, copy: () => {} })
  assert.equal(noFiles.dragover({ dataTransfer: { effectAllowed: 'copy', getData: () => '' } }), null)
  assert.equal(noFiles.dragover({ dataTransfer: { effectAllowed: 'none', getData: () => 'file:///a' } }), null)
})

test('drop：逐项复制并报进度，收尾刷新目标目录', async () => {
  const copied = []
  const refreshed = []
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: items => { copied.push(...items.map(item => item.name)) },
    refreshDestination: dir => { refreshed.push(dir) },
    progressTaskId: 'test.dnd.copy',
  })
  target.dragover({ dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\nfile:///src/b.txt\n' } })
  assert.equal(backgroundTaskManager.get('test.dnd.copy'), null, '没开始复制前不该有一行进度')
  const done = await target.drop({ dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\nfile:///src/b.txt\n' } })
  assert.deepEqual(copied, ['a.txt', 'b.txt'])
  assert.deepEqual(done.map(item => item.name), ['a.txt', 'b.txt'])
  assert.deepEqual(refreshed, ['/dst'], '复制收尾要刷新目标目录（VfsUtil.markDirtyAndRefresh）')
  assert.equal(backgroundTaskManager.get('test.dnd.copy'), null, '收尾必须把那一行收掉')
  assert.equal(target.progressTitle(), COPY_PROGRESS_TITLE)
})

test('同名冲突：先问一次；用户拒绝 ⇒ 整批不复制（上游 :66 return emptyList()）', async () => {
  const questions = []
  const copied = []
  const make = answer => {
    copied.length = 0
    return createFileDropTarget({
      destinationDir: () => '/dst',
      targetRect: () => RECT,
      exists: target => target === '/dst/b.txt',
      copy: items => { copied.push(...items.map(item => item.name)) },
      confirmOverwrite: (question, names) => { questions.push([question, [...names]]); return answer },
    })
  }
  const payload = { dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\nfile:///src/b.txt\n' } }
  /** 浏览器只有在 dragover 答应过（preventDefault）之后才派发 drop，所以先走一拍。 */
  const dragThenDrop = async target => { target.dragover(payload); return target.drop(payload) }

  await dragThenDrop(make(true))
  assert.deepEqual(copied, ['a.txt', 'b.txt'], '同意 ⇒ 整批复制')
  assert.deepEqual(questions[0], [copyOverwriteMessageOne('b.txt'), ['b.txt']], '只问一次，且只报冲突的那一个名字')

  copied.length = 0
  await dragThenDrop(make(false))
  assert.deepEqual(copied, [], '拒绝 ⇒ **一个都不复制**')
  assert.deepEqual(questions[1][1], ['b.txt'])

  // 没给 confirmOverwrite 回调 ⇒ 不复制（宁可不复制也不静默覆盖）。
  copied.length = 0
  await dragThenDrop(createFileDropTarget({
    destinationDir: () => '/dst', targetRect: () => RECT,
    exists: target => target === '/dst/b.txt', copy: items => { copied.push(...items.map(item => item.name)) },
  }))
  assert.deepEqual(copied, [])
})

test('多个同名冲突用复数那条文案（dnd.copy.overwrite.message.many）', () => {
  assert.equal(copyOverwriteMessageOne('b.txt'), `“b.txt”已存在于目标目录。要覆盖它吗？`)
  assert.equal(copyOverwriteMessageMany(2), '目标目录里已有 2 个同名文件。要覆盖它们吗？')
  assert.equal(COPY_OVERWRITE_TITLE, '复制文件')
  assert.equal(COPY_ERROR_TITLE, '无法复制文件')
  assert.equal(copyProgressItem('a.txt'), '正在复制“a.txt”')
})

test('第一项失败就中断整批，并报出失败的那一项（上游 :78-96）', async () => {
  const copied = []
  const failures = []
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: items => {
      const name = items[0].name
      if (name === 'b.txt') throw new Error('磁盘满了')
      copied.push(name)
    },
    onError: (item, error) => failures.push([item.name, error.message]),
    refreshDestination: () => {},
    progressTaskId: 'test.dnd.fail',
  })
  const payload = { dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\nfile:///src/b.txt\nfile:///src/c.txt\n' } }
  target.dragover(payload)
  const done = await target.drop(payload)
  assert.deepEqual(copied, ['a.txt'], 'b 失败之后 c 不该再复制')
  assert.deepEqual(done.map(item => item.name), ['a.txt'], '返回的是已复制的那部分（上游 :97）')
  assert.deepEqual(failures, [['b.txt', '磁盘满了']])
  assert.equal(copyErrorMessage('b.txt', '磁盘满了'), '无法复制“b.txt”：磁盘满了')
  assert.equal(backgroundTaskManager.get('test.dnd.fail'), null, '失败也要收掉那一行')
})

test('取不到文件名的源被跳过（上游 mapNotNull），其它项照常复制', async () => {
  const copied = []
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: items => { copied.push(...items.map(item => item.name)) },
  })
  const payload = { dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///\nfile:///src/a.txt\n' } }
  target.dragover(payload)
  const done = await target.drop(payload)
  assert.deepEqual(copied, ['a.txt'], 'file:/// 取不到文件名 ⇒ 跳过，不影响其它项')
  assert.equal(done.length, 1)
})

test('没有 dragover 答应过就不复制：drop 只在上一拍接受过时才动手', async () => {
  // 浏览器只有在某个 dragover 调过 preventDefault 之后才派发 drop；上游那一侧对应
  // `DropHandler` 是 update 阶段挂上的。这里把这条契约钉住 —— 直接调 drop 不会写盘。
  const copied = []
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: items => { copied.push(...items.map(item => item.name)) },
  })
  const payload = { dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\n' } }
  assert.deepEqual(await target.drop(payload), [])
  assert.deepEqual(copied, [], '没走过 dragover 就不复制')
  // 载荷为空 ⇒ 同样什么都不做。
  target.dragover(payload)
  assert.deepEqual(await target.drop({ dataTransfer: { effectAllowed: 'copy', getData: () => '' } }), [])
  assert.deepEqual(copied, [])
})

test('useFileDropTarget：把三个挂点接到元素上，destroy 摘干净', () => {
  const listeners = {}
  const el = {
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: type => { delete listeners[type] },
  }
  const events = []
  const target = createFileDropTarget({
    destinationDir: () => '/dst',
    targetRect: () => RECT,
    exists: () => false,
    copy: items => { events.push(items[0].name) },
  })
  const binding = useFileDropTarget({ value: el }, target)
  assert.deepEqual(Object.keys(listeners).sort(), ['dragleave', 'dragover', 'drop'])

  listeners.dragover({ dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\n' } })
  assert.equal(binding.activeClass.value, 'dnd-drop-target', '拖到上面 ⇒ 挂上高亮类')
  assert.equal(binding.expectedResult.value.includes('a.txt') || Boolean(binding.expectedResult.value), true)
  assert.deepEqual(binding.boundsOf().map(b => b.name), ['filledRectangle', 'bottom'])

  listeners.dragleave()
  assert.equal(binding.activeClass.value, null, '离开 ⇒ 类摘掉')
  assert.equal(binding.boundsOf(), null)
  assert.equal(binding.expectedResult.value, null)

  listeners.dragover({ dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\n' } })
  listeners.drop({ dataTransfer: { effectAllowed: 'copy', getData: () => 'file:///src/a.txt\n' }, preventDefault: () => {} })

  binding.destroy()
  assert.deepEqual(Object.keys(listeners), [], 'destroy 要摘掉三个监听')
  assert.equal(target.decoration.value, null, 'destroy 还要撤掉高亮（vanish 的清理）')
  return new Promise(resolve => setImmediate(() => {
    assert.deepEqual(events, ['a.txt'], 'drop 真的复制了')
    resolve()
  }))
})
