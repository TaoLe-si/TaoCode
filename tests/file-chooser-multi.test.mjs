// 文件选择器**多选**的判据（`pf/file-chooser` 判词里原写「缺：多选」的那条）。
//
// 上游依据：
//   · `platform/ide-core/src/com/intellij/openapi/fileChooser/FileChooserDescriptor.java:137`
//     `isChooseMultiple()`；`:88-99` 构造器的 `chooseMultiple`；
//   · `platform/platform-impl/src/com/intellij/openapi/fileChooser/ex/FileSystemTreeImpl.java:116`
//     `isChooseMultiple() ? TreeSelectionModel.DISCONTIGUOUS_TREE_SELECTION : SINGLE_TREE_SELECTION`；
//   · `…/ex/FileChooserDialogImpl.java:418`（拖入多个文件时多选保留全部、单选只取第一个）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  emptyChooserSelection, selectOnly, selectRange, selectionPaths, toggleSelection,
} from '../src/fileChooserModel.ts'
import { multiDirsDescriptor, singleFileDescriptor } from '../src/fileChooserDescriptor.ts'

const ROWS = ['a', 'b', 'c', 'd']

test('单选描述件：任何点选都替换整个选择集（SINGLE_TREE_SELECTION）', () => {
  const descriptor = singleFileDescriptor()
  let selection = emptyChooserSelection(descriptor)
  selection = selectOnly(selection, 'a')
  selection = toggleSelection(selection, 'b')
  assert.deepEqual(selection.paths, ['b'], '单选下 toggle 退化成替换')
  selection = selectRange(selection, 'd', ROWS)
  assert.deepEqual(selection.paths, ['d'])
})

test('多选描述件：普通点替换、Ctrl 点切换（DISCONTIGUOUS）', () => {
  const descriptor = multiDirsDescriptor()
  assert.equal(descriptor.chooseMultiple, true)
  let selection = emptyChooserSelection(descriptor)
  assert.equal(selection.multiple, true)
  selection = selectOnly(selection, 'a')
  selection = toggleSelection(selection, 'c')
  assert.deepEqual(selection.paths, ['a', 'c'])
  selection = toggleSelection(selection, 'a')
  assert.deepEqual(selection.paths, ['c'], '再点一次取消该项')
  selection = selectOnly(selection, 'b')
  assert.deepEqual(selection.paths, ['b'], '普通点替换')
})

test('多选描述件：Shift 点按行表顺序取一段（含反向）', () => {
  let selection = selectOnly(emptyChooserSelection(multiDirsDescriptor()), 'a')
  selection = selectRange(selection, 'c', ROWS)
  assert.deepEqual(selection.paths, ['a', 'b', 'c'])
  // 反向：锚点在 c、目标是 a
  selection = selectRange(selectOnly(selection, 'c'), 'a', ROWS)
  assert.deepEqual(selection.paths, ['a', 'b', 'c'])
})

test('没有锚点时 Shift 退化成替换；目标不在行表里也退化成替换', () => {
  const selection = emptyChooserSelection(multiDirsDescriptor())
  assert.deepEqual(selectRange(selection, 'b', ROWS).paths, ['b'])
  assert.deepEqual(selectRange(selectOnly(selection, 'a'), 'zzz', ROWS).paths, ['zzz'])
})

test('selectionPaths 按行表顺序返回（上游 getSelectedFiles 的顺序）', () => {
  let selection = selectOnly(emptyChooserSelection(multiDirsDescriptor()), 'c')
  selection = toggleSelection(selection, 'a')
  assert.deepEqual(selectionPaths(selection, ROWS), ['a', 'c'])
})

test('接线：FileChooserDialog 用选择集渲染 aria-selected 并交出一组路径', () => {
  const vue = readFileSync(new URL('../src/components/FileChooserDialog.vue', import.meta.url), 'utf8')
  assert.match(vue, /selectOnly|toggleSelection|selectRange/, '要按修饰键走选择集')
  assert.match(vue, /selection\.paths\.includes\(row\.node\.path\)/, 'aria-selected 读选择集')
  assert.match(vue, /pickMultiple/, '多选要有交出整组路径的接口')
})