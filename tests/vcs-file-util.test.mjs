// VCS 工具层（上游 `vcsUtil/VcsFileUtil` / `FilesProgress` / `RollbackUtil` / `VcsSelection`）的纯逻辑判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOM, FILE_PATH_LIMIT, chunkArguments, chunkPaths, createFilesProgress, detectLineSeparator, fileProgressText,
  gitErrorHint, hasBom, isAncestor, isOctal, looksBinary, makeVcsSelection, normalizeLineSeparators, normalizePath,
  relativePath, relativePathOrFull, rollbackOperationName, selectionLines, stripBom, unescapeGitPath,
} from '../src/vcsFileUtil.ts'

test('FILE_PATH_LIMIT 照上游 7600', () => {
  assert.equal(FILE_PATH_LIMIT, 7600, 'VcsFileUtil.java:45')
})

test('chunkArguments：按总长切块，组不拆散，单组超限独占一块', () => {
  const args = Array.from({ length: 10 }, () => 'x'.repeat(1000))
  const chunks = chunkArguments(args)
  assert.equal(chunks.length, 2, '10000 字符分两块')
  assert.deepEqual(chunks.map(c => c.length), [7, 3])
  assert.deepEqual(chunks.flat(), args, '顺序与内容不许变')
  // groupSize=2：「名字 + 值」成组，块的元素个数永远是偶数。
  const grouped = chunkArguments(args, 2)
  assert.deepEqual(grouped.map(c => c.length), [6, 4])
  // 单组本身就超上限：独占一块，不死循环、不丢参数。
  const huge = ['y'.repeat(FILE_PATH_LIMIT + 1), 'small']
  assert.deepEqual(chunkArguments(huge), [['y'.repeat(FILE_PATH_LIMIT + 1)], ['small']])
  assert.deepEqual(chunkPaths(['a', 'b']), [['a', 'b']])
})

test('路径归一与祖先判定', () => {
  assert.equal(normalizePath('a\\b\\c/'), 'a/b/c')
  assert.equal(normalizePath('/'), '/')
  assert.equal(isAncestor('C:/repo', 'C:/repo/src/a.ts', false), true)
  assert.equal(isAncestor('C:/repo', 'C:/repo', false), true)
  assert.equal(isAncestor('C:/repo', 'C:/repo', true), false, 'strict 时相等不算')
  assert.equal(isAncestor('C:/repo', 'C:/repository/a', false), false, '前缀相同但不是祖先')
})

test('relativePath 必须真在根下；relativePathOrFull 不在就原样给', () => {
  assert.equal(relativePath('C:/repo', 'C:/repo/src/a.ts'), 'src/a.ts')
  assert.equal(relativePath('C:/repo', 'C:/repo'), '.')
  assert.throws(() => relativePath('C:/repo', 'C:/other/a.ts'), /不在仓库根下/)
  assert.equal(relativePathOrFull('C:/repo', 'C:/other/a.ts'), 'C:/other/a.ts')
})

test('unescapeGitPath：引号与八进制字节（UTF-8）还原', () => {
  assert.equal(unescapeGitPath('plain/path.ts'), 'plain/path.ts')
  assert.equal(unescapeGitPath('"src/a b.ts"'), 'src/a b.ts')
  // `\303\251` = UTF-8 的 é（上游按默认编码解码，本仓按 UTF-8）。
  assert.equal(unescapeGitPath('"caf\\303\\251.txt"'), 'café.txt')
  assert.equal(unescapeGitPath('a\\tb'), 'a\tb')
  assert.equal(unescapeGitPath('a\\\\b'), 'a\\b')
  assert.throws(() => unescapeGitPath('bad\\'), /没有收尾/)
  assert.throws(() => unescapeGitPath('bad\\q'), /无法识别/)
})

test('行尾/BOM/二进制判定', () => {
  // 主行尾按**分隔符计数**取多数，不是「出现过 CRLF 就算 CRLF」——照上游
  // `platform/core-impl/src/com/intellij/openapi/fileEditor/impl/LoadTextUtil.java:801-815` 的
  // `ConvertResult.majorLineSeparator()`：crlf 严格多于另两者才是 `\r\n`，否则 cr 严格多于 lf 才是 `\r`，
  // 再否则只要 lf 出现过就是 `\n`。所以「CRLF 1 个 + LF 1 个」的平局判 `\n`。
  assert.equal(detectLineSeparator('a\r\nb\n'), '\n', '平局（CRLF 1 / LF 1）按上游落 LF')
  assert.equal(detectLineSeparator('a\r\nb\r\nc\nd'), '\r\n', 'CRLF 多数才是 CRLF')
  assert.equal(detectLineSeparator('a\rb'), '\r')
  assert.equal(detectLineSeparator('a\rb\rc\nd'), '\r', 'CR 多数是 CR')
  assert.equal(detectLineSeparator('a\nb'), '\n')
  assert.equal(normalizeLineSeparators('a\r\nb\rc\nd', '\n'), 'a\nb\nc\nd')
  assert.equal(hasBom(BOM + 'x'), true)
  assert.equal(stripBom(BOM + 'x'), 'x')
  assert.equal(stripBom('x'), 'x')
  assert.equal(looksBinary('a\u0000b'), true)
  assert.equal(looksBinary('a\nb'), false)
  assert.equal(isOctal('7'), true)
  assert.equal(isOctal('8'), false)
})

test('FilesProgress：文字是「名字（父目录）」，fraction 先算后加', () => {
  assert.equal(fileProgressText('src/a.ts'), 'a.ts (src)')
  assert.equal(fileProgressText('a.ts'), 'a.ts')
  const progress = createFilesProgress(2, '前缀：')
  progress.update('src/a.ts')
  assert.equal(progress.count, 1)
  assert.equal(progress.fraction, 0.5)
  assert.equal(progress.text, '前缀：a.ts (src)')
  progress.update('b.ts')
  assert.equal(progress.fraction, 1)
  assert.equal(createFilesProgress(0, '').fraction, 0, 'total 为 0 不除零')
})

test('回滚名与 git 错误本地化', () => {
  assert.equal(rollbackOperationName(), '回滚')
  assert.match(gitErrorHint('fatal: not a git repository (or any of the parent directories)'), /不是 Git 仓库/)
  assert.match(gitErrorHint('error: pathspec \'x\' did not match'), /找不到匹配的路径/)
  assert.equal(gitErrorHint('fatal: something else'), 'fatal: something else', '其余原样带回')
})

test('选区行号换算与动作名（VcsSelection 的模板）', () => {
  const text = 'a\nbb\nccc'
  assert.deepEqual(selectionLines(text, 0, 1), { startLine: 0, endLine: 0 })
  assert.deepEqual(selectionLines(text, 2, 4), { startLine: 1, endLine: 1 })
  assert.deepEqual(selectionLines(text, 3, text.length), { startLine: 1, endLine: 2 }, 'endOffset 落在文本末尾钳到最后一行')
  const selection = makeVcsSelection(text, 0, 1, 'foo()')
  assert.deepEqual([selection.startLine, selection.endLine], [0, 0])
  assert.equal(selection.actionName, '显示 foo() 的历史…')
  assert.equal(selection.dialogTitle, 'foo() 的历史')
})
