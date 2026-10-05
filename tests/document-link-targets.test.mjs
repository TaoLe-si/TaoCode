// `src/documentLinks.ts` 的**打开方式**补测：`file:` URI 的 UNC 共享形式。
//
// 与 `tests/document-links.test.mjs` 同一模块，但那个文件锁的是 Unix/盘符/相对路径；
// 这里锁本轮补的「`file://<主机>/<共享>` → `\\主机\共享\...`」—— 不还原的话
// `server/share/x` 会被 App.vue 的 `openDocumentLink` 当成工作区里的相对路径，
// Ctrl+Click 打开一个完全不相干的位置。

import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyLinkTarget, filePathFromUri } from '../src/documentLinks.ts'

test('UNC 共享：file://server/share/x 还原成 \\\\server\\share\\x', () => {
  assert.deepEqual(filePathFromUri('file://server/share/dir/a.ts'),
    { path: '\\\\server\\share\\dir\\a.ts', line: 0 })
  assert.deepEqual(filePathFromUri('file://server/share/dir/a.ts#L7'),
    { path: '\\\\server\\share\\dir\\a.ts', line: 7 })
  // 服务器名/共享名里的百分号转义各自解，不能先解再分段（%2F 会造出假分隔符）。
  assert.equal(filePathFromUri('file://my%20host/share/a%20b.ts').path, '\\\\my host\\share\\a b.ts')
  // 共享根本身没有尾巴时也不许多出反斜杠。
  assert.equal(filePathFromUri('file://server/share').path, '\\\\server\\share')
})

test('localhost 只是本机写法，不能当成共享名', () => {
  assert.deepEqual(filePathFromUri('file://localhost/C:/work/a.ts'), { path: 'C:/work/a.ts', line: 0 })
  assert.deepEqual(filePathFromUri('file://LOCALHOST/home/dev/a.ts'), { path: '/home/dev/a.ts', line: 0 })
})

test('常见的三斜杠形式不受影响（回归）', () => {
  assert.deepEqual(filePathFromUri('file:///C:/work/a.ts'), { path: 'C:/work/a.ts', line: 0 })
  assert.deepEqual(filePathFromUri('file:///C:/work/a.ts#L12-L15'), { path: 'C:/work/a.ts', line: 12 })
  assert.deepEqual(filePathFromUri('file:///home/dev/a.ts'), { path: '/home/dev/a.ts', line: 0 })
})

test('classifyLinkTarget 把 UNC 当文件（不是 external，也不是 none）', () => {
  assert.deepEqual(classifyLinkTarget('file://server/share/a.ts#L3'),
    { kind: 'file', path: '\\\\server\\share\\a.ts', line: 3 })
  assert.deepEqual(classifyLinkTarget('\\\\server\\share\\a.ts'),
    { kind: 'file', path: '\\\\server\\share\\a.ts', line: 0 })
})
