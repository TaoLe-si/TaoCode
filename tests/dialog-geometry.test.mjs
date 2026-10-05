// 对话框尺寸记忆的判据（实现：src/dialogGeometry.ts，上游 DialogWrapper DimensionService 子集）。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DIALOG_VIEWPORT_MARGIN,
  MIN_DIALOG_SIZE,
  clampDialogSize,
  dialogGeometryKey,
  loadDialogSize,
  parseDialogSize,
  saveDialogSize,
  sizeFromRect,
} from '../src/dialogGeometry.ts'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, value) },
    dump: () => Object.fromEntries(values),
  }
}

test('key 按对话框名稳定生成；坏数据一律不还原', () => {
  assert.equal(dialogGeometryKey('project-dialog'), 'taocode.dialog.project-dialog')
  assert.equal(parseDialogSize(null), null)
  assert.equal(parseDialogSize({ width: '610', height: 400 }), null)
  assert.equal(parseDialogSize({ width: 0, height: 400 }), null)
  assert.equal(parseDialogSize({ width: NaN, height: 400 }), null)
  assert.deepEqual(parseDialogSize({ width: 610.4, height: 400.6 }), { width: 610, height: 401 })
})

test('夹进视口：保最小尺寸，也保不越出视口留白；冲突时最小尺寸优先', () => {
  assert.deepEqual(clampDialogSize({ width: 200, height: 100 }, { width: 1200, height: 800 }),
    { width: MIN_DIALOG_SIZE.width, height: MIN_DIALOG_SIZE.height })
  assert.deepEqual(clampDialogSize({ width: 5000, height: 5000 }, { width: 1200, height: 800 }),
    { width: 1200 - 2 * DIALOG_VIEWPORT_MARGIN, height: 800 - 2 * DIALOG_VIEWPORT_MARGIN })
  assert.deepEqual(clampDialogSize({ width: 400, height: 300 }, { width: 200, height: 150 }),
    { width: MIN_DIALOG_SIZE.width, height: MIN_DIALOG_SIZE.height }, '视口比最小尺寸还小时不再压小')
})

test('存取：写进 storage 的尺寸能读回来；坏 JSON 返回 null 而不是抛', () => {
  const storage = memoryStorage()
  const key = dialogGeometryKey('project-dialog')
  saveDialogSize(storage, key, { width: 720, height: 480 })
  assert.deepEqual(loadDialogSize(storage, key), { width: 720, height: 480 })
  assert.equal(saveDialogSize(storage, key, { width: -1, height: 480 }), undefined)
  assert.deepEqual(loadDialogSize(memoryStorage({ [key]: '{oops' }), key), null)
  assert.equal(loadDialogSize(null, key), null, '存储不可用（无 localStorage）时不炸')
})

test('storage.setItem 抛异常（配额/隐私模式）时静默失败', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  saveDialogSize(storage, 'k', { width: 400, height: 300 })
})

test('从元素矩形取尺寸：未布局（0 宽高）返回 null', () => {
  assert.deepEqual(sizeFromRect({ width: 610, height: 400 }), { width: 610, height: 400 })
  assert.equal(sizeFromRect({ width: 0, height: 0 }), null)
})
