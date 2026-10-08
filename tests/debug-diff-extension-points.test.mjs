// 判据 · 调试 / 差异 / 变更列表三域的扩展点宿主接线（`src/debugDiffExtensionPoints.ts`）——
// 上游本来就是 EP 的那几族（`XBreakpointType` / `DiffTool` / `MergeTool` / `DiffExtension` /
// `ChangeListDecorator`）以及它们的同名方法面。
//
// 钉五件事：
//   ① 五条 EP 的 id 逐字等于上游 qualifiedName，且都已在宿主里声明；
//   ② 每条 EP 的贡献能按 id 注册/覆盖/注销，消费函数看得见（第三方挂的不是死代码）；
//   ③ 上游方法面逐字保留（`getId`/`getTitle`/`getName`/`canShow`/`onViewerCreated`/
//      `decorateChangeList`）；
//   ④ `order="first"` 的插件贡献排在 bundled 之前（插件能覆盖内建）；
//   ⑤ bundled 默认贡献（行断点 / 并排差异 / 三方合并）如实出现在 EP 里。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUNDLED_DIFF_VIEW_ID, BUNDLED_LINE_BREAKPOINT_ID, BUNDLED_MERGE_EDITOR_ID,
  CHANGE_LIST_DECORATOR_EP, DEBUG_BREAKPOINT_TYPE_EP, DIFF_EXTENSION_EP, DIFF_TOOL_EP,
  MERGE_TOOL_EP,
  applyDiffExtensions, breakpointTypes, canShowDiffTool, changeListDecorators,
  decorateChangeListRow, declareDebugDiffExtensionPoints, diffExtensions, diffTools,
  findBreakpointType, firstDiffToolFor, firstMergeToolFor, mergeTools,
  registerBundledChangeListDecorator, registerBundledDebugDiffDefaults,
  registerDebugDiffExtension, unregisterDebugDiffExtension,
} from '../src/debugDiffExtensionPoints.ts'
import { EXTENSIONS } from '../src/extensionPoints.ts'

test('五条 EP 的 id 逐字取自上游 qualifiedName，且已声明', () => {
  assert.equal(DEBUG_BREAKPOINT_TYPE_EP, 'com.intellij.xdebugger.breakpointType')
  assert.equal(DIFF_TOOL_EP, 'com.intellij.diff.DiffTool')
  assert.equal(MERGE_TOOL_EP, 'com.intellij.diff.merge.MergeTool')
  assert.equal(DIFF_EXTENSION_EP, 'com.intellij.diff.DiffExtension')
  assert.equal(CHANGE_LIST_DECORATOR_EP, 'com.intellij.vcs.changeListDecorator')
  for (const id of [DEBUG_BREAKPOINT_TYPE_EP, DIFF_TOOL_EP, MERGE_TOOL_EP, DIFF_EXTENSION_EP, CHANGE_LIST_DECORATOR_EP]) {
    assert.ok(EXTENSIONS.hasExtensionPoint(id), `${id} 应已声明`)
  }
  declareDebugDiffExtensionPoints()   // 幂等，不抛
})

test('bundled 默认贡献：行断点 / 并排差异 / 三方合并都出现在 EP 里', () => {
  registerBundledDebugDiffDefaults()   // 幂等
  assert.ok(breakpointTypes().some(type => type.getId() === BUNDLED_LINE_BREAKPOINT_ID), '行断点是贡献之一')
  assert.ok(diffTools().some(tool => tool.id === BUNDLED_DIFF_VIEW_ID), '并排差异是贡献之一')
  assert.ok(mergeTools().some(tool => tool.id === BUNDLED_MERGE_EDITOR_ID), '三方合并是贡献之一')
})

test('XBreakpointType：上游方法面 getId/getTitle，order=first 的插件排在内建之前', () => {
  const handle = registerDebugDiffExtension(DEBUG_BREAKPOINT_TYPE_EP, 'plugin.exception', {
    id: 'plugin.exception',
    getId: () => 'java-exception',
    getTitle: () => 'Java 异常',
    isSuspendThreadSupported: () => true,
    getDefaultSuspendPolicy: () => 'THREAD',
  }, { order: 'first', source: 'user' })
  try {
    assert.equal(breakpointTypes()[0].id, 'plugin.exception', 'order=first 的贡献排最前')
    assert.equal(breakpointTypes()[0].getId(), 'java-exception')
    assert.equal(breakpointTypes()[0].getTitle(), 'Java 异常')
    assert.equal(breakpointTypes()[0].getDefaultSuspendPolicy(), 'THREAD')
    // 按断点类型 id（getId，不是注册 id）能找到。
    assert.equal(findBreakpointType('java-exception')?.id, 'plugin.exception')
    assert.equal(findBreakpointType('不存在'), undefined)
  } finally { handle.dispose() }
  assert.equal(findBreakpointType('java-exception'), undefined, '注销后消费函数看不见')
  assert.ok(breakpointTypes().some(type => type.getId() === BUNDLED_LINE_BREAKPOINT_ID), '内建那条还在')
})

test('DiffTool：getName/canShow + order=first 覆盖内建；二进制内建不认、插件可认领', () => {
  const binary = { title: 'a.bin', binary: true }
  assert.equal(firstDiffToolFor({ path: 'a.bin' }, binary), null, '内建并排差异不认二进制 ⇒ 没有工具')
  const handle = registerDebugDiffExtension(DIFF_TOOL_EP, 'plugin.hex', {
    id: 'plugin.hex',
    getName: () => '十六进制差异',
    canShow: (_context, request) => request.binary === true,
  }, { order: 'first', source: 'user' })
  try {
    const chosen = firstDiffToolFor({ path: 'a.bin' }, binary)
    assert.equal(chosen?.id, 'plugin.hex', '插件的 order=first 先赢')
    assert.equal(chosen?.getName(), '十六进制差异')
    // 文本内容：插件不认（binary!==true）⇒ 回落内建。
    assert.equal(firstDiffToolFor({ path: 'a.txt' }, { title: 'a.txt', contents: ['x'] })?.id, BUNDLED_DIFF_VIEW_ID)
  } finally { handle.dispose() }
  assert.equal(firstDiffToolFor({ path: 'a.bin' }, binary), null, '注销后回到"没有工具"')
})

test('DiffTool.canShow 抛错 = 不认这一对，不拖垮其余工具', () => {
  const boom = { id: 'plugin.boom', getName: () => '坏的', canShow: () => { throw new Error('x') } }
  assert.equal(canShowDiffTool(boom, {}, {}), false)
  const handle = registerDebugDiffExtension(DIFF_TOOL_EP, boom.id, boom, { order: 'first', source: 'user' })
  try {
    // 坏工具排最前但不认 ⇒ 仍能选到后面的内建。
    assert.equal(firstDiffToolFor({ path: 'a.txt' }, { contents: ['x'] })?.id, BUNDLED_DIFF_VIEW_ID)
  } finally { handle.dispose() }
})

test('MergeTool：canShow/createComponent 同名方法面', () => {
  assert.equal(firstMergeToolFor({ path: 'a.java' }, { path: 'a.java' })?.id, BUNDLED_MERGE_EDITOR_ID)
  const handle = registerDebugDiffExtension(MERGE_TOOL_EP, 'plugin.merge', {
    id: 'plugin.merge',
    canShow: (_context, request) => request.path === 'special.java',
    createComponent: () => ({ kind: 'special' }),
  }, { order: 'first', source: 'user' })
  try {
    const chosen = firstMergeToolFor({}, { path: 'special.java' })
    assert.equal(chosen?.id, 'plugin.merge')
    assert.deepEqual(chosen?.createComponent?.({}, { path: 'special.java' }), { kind: 'special' })
    // 别的文件：插件不认 ⇒ 回落内建。
    assert.equal(firstMergeToolFor({}, { path: 'other.java' })?.id, BUNDLED_MERGE_EDITOR_ID)
  } finally { handle.dispose() }
})

test('DiffExtension：onViewerCreated 按序通知，抛错吞掉不影响其余', () => {
  const calls = []
  const first = registerDebugDiffExtension(DIFF_EXTENSION_EP, 'plugin.ext1', {
    id: 'plugin.ext1', onViewerCreated: viewer => calls.push(['one', viewer.viewerKind]),
  }, { order: 'first', source: 'user' })
  const boom = registerDebugDiffExtension(DIFF_EXTENSION_EP, 'plugin.extboom', {
    id: 'plugin.extboom', onViewerCreated: () => { throw new Error('x') },
  }, { order: 'last', source: 'user' })
  const handle = registerDebugDiffExtension(DIFF_EXTENSION_EP, 'plugin.ext2', {
    id: 'plugin.ext2', onViewerCreated: () => calls.push(['two']),
  }, { source: 'user' })
  try {
    assert.equal(diffExtensions().length, 3)
    applyDiffExtensions({ path: 'a.java', viewerKind: 'side-by-side' }, { path: 'a.java' }, { title: 'a' })
    assert.deepEqual(calls[0], ['one', 'side-by-side'])
    assert.ok(calls.some(call => call[0] === 'two'), '坏扩展后面的扩展仍被通知')
  } finally { first.dispose(); boom.dispose(); handle.dispose() }
  assert.deepEqual(diffExtensions(), [])
})

test('ChangeListDecorator：就地改 cell，多装饰器按序叠加（上游渲染器语义）', () => {
  const handleA = registerBundledChangeListDecorator({
    id: 'test.prefix',
    decorateChangeList: (list, cell) => { cell.text = `[${list.name}] ${cell.text}` },
  })
  const handleB = registerBundledChangeListDecorator({
    id: 'test.suffix',
    decorateChangeList: (_list, cell, selected) => { if (selected) cell.attributes = { ...(cell.attributes ?? {}), bold: true } },
  })
  try {
    const cell = decorateChangeListRow({ id: 'l1', name: '变更' }, { text: '文件' }, true, true, false)
    assert.equal(cell.text, '[变更] 文件')
    assert.deepEqual(cell.attributes, { bold: true })
    // 未选中：第二条不动
    const plain = decorateChangeListRow({ id: 'l1', name: '变更' }, { text: '文件' }, false, false, false)
    assert.equal(plain.text, '[变更] 文件')
    assert.equal(plain.attributes, undefined)
  } finally { handleA.dispose(); handleB.dispose() }
  assert.deepEqual(changeListDecorators(), [])
})

test('unregister 对未注册过的 id 返回 false（与宿主同口径）', () => {
  assert.equal(unregisterDebugDiffExtension(DIFF_TOOL_EP, 'never.registered'), false)
})
