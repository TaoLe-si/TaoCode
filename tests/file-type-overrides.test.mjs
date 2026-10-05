// 按文件覆盖文件类型（`src/fileTypeOverrides.ts`）—— 上游 `PersistentFileSetManager` 的
// `<file url value/>` 形态、`OverrideFileTypeAction`/`ReverteOverrideFileTypeAction` 的往返，
// 以及诊断门控（`src/problems.ts` 消费）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearFileTypeOverrides, fileSetPaths, fileTypeOverrideOf, fileUrlToPath, isFileTypeOverridden,
  isOverridableFile, overrideFileType, parseFileSet, pathToFileUrl, PLAIN_TEXT_TYPE, revertFileType, serializeFileSet,
} from '../src/fileTypeOverrides.ts'

test('路径 ↔ file:// URL 往返（Windows 盘符带三斜杠，工作区相对路径原样）', () => {
  assert.equal(pathToFileUrl('src/main.cpp'), 'src/main.cpp')
  assert.equal(pathToFileUrl('C:\\proj\\a.ts'), 'file:///C:/proj/a.ts')
  assert.equal(pathToFileUrl('/home/u/a.ts'), 'file:///home/u/a.ts')
  assert.equal(fileUrlToPath('file:///C:/proj/a.ts'), 'C:/proj/a.ts')
  assert.equal(fileUrlToPath('file:///home/u/a.ts'), '/home/u/a.ts')
  assert.equal(fileUrlToPath('src/a.ts'), 'src/a.ts')
})

test('文件集的序列化：按 url 排序，PlainText 省略 value 属性（上游 getState）', () => {
  const entries = [{ url: 'file:///b.ts', value: PLAIN_TEXT_TYPE }, { url: 'file:///a.ts', value: 'JSON' }]
  assert.equal(serializeFileSet(entries), '[{"url":"file:///a.ts","value":"JSON"},{"url":"file:///b.ts"}]')
})

test('文件集的解析：坏数据整份丢弃，缺 value 按 PlainText（上游 loadState）', () => {
  assert.deepEqual(parseFileSet('not json'), [])
  assert.deepEqual(parseFileSet({ url: 'x' }), [])
  assert.deepEqual(parseFileSet([{ url: 'file:///a' }, { nope: 1 }, { url: 2 }]), [
    { url: 'file:///a', value: PLAIN_TEXT_TYPE },
  ])
})

test('覆盖与撤销往返；重复覆盖不追加第二条', () => {
  clearFileTypeOverrides()
  assert.equal(overrideFileType('src/a.ts'), true)
  assert.equal(overrideFileType('src/a.ts'), true)
  assert.equal(fileSetPaths().length, 1)
  assert.equal(isFileTypeOverridden('src/a.ts'), true)
  assert.equal(fileTypeOverrideOf('src\\a.ts'), PLAIN_TEXT_TYPE, '反斜杠路径归一后命中同一条')
  assert.equal(revertFileType('src/a.ts'), true)
  assert.equal(revertFileType('src/a.ts'), false, '本来就没覆盖 → false')
  assert.equal(isFileTypeOverridden('src/a.ts'), false)
})

test('不可覆盖的输入被拒：空路径、目录、合成节点', () => {
  clearFileTypeOverrides()
  assert.equal(isOverridableFile(''), false)
  assert.equal(isOverridableFile('src'), true)
  assert.equal(isOverridableFile('src/', true), false)
  assert.equal(isOverridableFile('\0External Libraries/x.ts'), false)
  assert.equal(overrideFileType(''), false)
  assert.equal(fileSetPaths().length, 0)
})
