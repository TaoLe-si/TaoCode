// 统一差异补丁的解析与应用（上游 `patch/` 一族：`GitPatchParser`/`PatchReader`/
// `ApplyTextFilePatch`/`PlainSimplePatchApplier`/`formove/*`/`ApplyPatchStatus`）的纯逻辑判据。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  andStatus, applyHunksToText, isAlreadyApplied, parseUnifiedPatch, planPatchApplication, verifyPatchPath,
} from '../src/patchApply.ts'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const x = 1',
  '-const y = 2',
  '+const y = 3',
  '+const z = 4',
  ' const w = 5',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+hello',
  '+world',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-old line',
  '-second line',
  'diff --git a/old/name.ts b/new/name.ts',
  'rename from old/name.ts',
  'rename to new/name.ts',
].join('\n')

test('解析 unified diff：文本 / 新增 / 删除 / 改名四档与块头计数', () => {
  const patch = parseUnifiedPatch(PATCH)
  assert.deepEqual(patch.problems, [])
  assert.equal(patch.files.length, 4)
  const [text, add, del, rename] = patch.files
  assert.equal(text.kind, 'text')
  assert.equal(text.oldPath, 'src/a.ts')
  assert.equal(text.newPath, 'src/a.ts')
  assert.deepEqual(text.hunks.map(h => [h.beforeStart, h.beforeCount, h.afterStart, h.afterCount]), [[1, 3, 1, 4]])
  assert.deepEqual(text.hunks[0].lines.map(l => [l.type, l.text]), [
    ['context', 'const x = 1'],
    ['remove', 'const y = 2'],
    ['add', 'const y = 3'],
    ['add', 'const z = 4'],
    ['context', 'const w = 5'],
  ])
  assert.equal(add.kind, 'add')
  assert.equal(add.oldPath, null)
  assert.equal(add.newPath, 'new.txt')
  assert.equal(del.kind, 'delete')
  assert.equal(del.oldPath, 'gone.txt')
  assert.equal(del.newPath, null)
  assert.equal(rename.kind, 'rename')
  assert.equal(rename.oldPath, 'old/name.ts')
  assert.equal(rename.newPath, 'new/name.ts')
  assert.equal(rename.hunks.length, 0)
})

test('块里的 \\ No newline at end of file 挂在上一行上', () => {
  const patch = parseUnifiedPatch([
    'diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new', '\\ No newline at end of file',
  ].join('\n'))
  const lines = patch.files[0].hunks[0].lines
  assert.equal(lines[0].noNewline, true)
  assert.equal(lines[1].noNewline, true)
})

test('应用块：逐块核对上下文，任一块对不上就整文件失败（不 fuzz）', () => {
  const hunks = parseUnifiedPatch(PATCH).files[0].hunks
  const ok = applyHunksToText('const x = 1\nconst y = 2\nconst w = 5\n', hunks)
  assert.equal(ok.ok, true)
  assert.equal(ok.text, 'const x = 1\nconst y = 3\nconst z = 4\nconst w = 5\n')
  // 上下文行差一行：起点对不上 ⇒ 失败，且报第几块。
  const bad = applyHunksToText('const x = 1\nconst Y = 2\nconst w = 5\n', hunks)
  assert.equal(bad.ok, false)
  assert.equal(bad.hunk, 1)
  assert.match(bad.reason, /上下文对不上/)
  // 不做 fuzz：就算把目标行挪到别处（上下文在文件中别处存在）也不去找。
  const shifted = applyHunksToText('// lead\nconst x = 1\nconst y = 2\nconst w = 5\n', hunks)
  assert.equal(shifted.ok, false, '起点不匹配时报错，不按偏移搜索')
})

test('已应用检测：文件内容已经是补丁后的样子', () => {
  const hunks = parseUnifiedPatch(PATCH).files[0].hunks
  assert.equal(isAlreadyApplied('const x = 1\nconst y = 3\nconst z = 4\nconst w = 5\n', hunks), true)
  assert.equal(isAlreadyApplied('const x = 1\nconst y = 2\nconst w = 5\n', hunks), false)
})

test('行尾保留：原文有结尾换行就保留，没有就不补', () => {
  const hunks = parseUnifiedPatch([
    'diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b',
  ].join('\n')).files[0].hunks
  assert.equal(applyHunksToText('a', hunks).text, 'b', '原文没有结尾换行，结果也不应该有')
  assert.equal(applyHunksToText('a\n', hunks).text, 'b\n')
})

test('执行计划：四档动作与内容', () => {
  const patch = parseUnifiedPatch(PATCH)
  const files = new Map([
    ['src/a.ts', 'const x = 1\nconst y = 2\nconst w = 5\n'],
    ['gone.txt', 'old line\nsecond line\n'],
    ['old/name.ts', 'console.log(1)\n'],
  ])
  const plan = planPatchApplication(patch, files)
  assert.equal(plan.ok, true, JSON.stringify(plan.files))
  const byPath = new Map(plan.files.map(f => [f.path, f]))
  assert.deepEqual(
    [byPath.get('src/a.ts').action, byPath.get('src/a.ts').status, byPath.get('src/a.ts').content],
    ['update', 'success', 'const x = 1\nconst y = 3\nconst z = 4\nconst w = 5\n'],
  )
  assert.deepEqual([byPath.get('new.txt').action, byPath.get('new.txt').status, byPath.get('new.txt').content], ['create', 'success', 'hello\nworld\n'])
  assert.deepEqual([byPath.get('gone.txt').action, byPath.get('gone.txt').status], ['delete', 'success'])
  assert.deepEqual([byPath.get('new/name.ts').action, byPath.get('new/name.ts').fromPath, byPath.get('new/name.ts').content], ['rename', 'old/name.ts', 'console.log(1)\n'])
})

test('执行计划：路径逃逸 / 二进制 / 目标已存在一律判失败或跳过', () => {
  const unsafe = parseUnifiedPatch([
    'diff --git a/../outside.txt b/../outside.txt', '--- a/../outside.txt', '+++ b/../outside.txt', '@@ -1 +1 @@', '-a', '+b',
  ].join('\n'))
  const escaped = planPatchApplication(unsafe, new Map([['../outside.txt', 'a\n']]))
  assert.equal(escaped.ok, false)
  assert.equal(escaped.files[0].reason, '路径不安全：路径含 ..')

  const binary = parseUnifiedPatch(['diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ'].join('\n'))
  const skipped = planPatchApplication(binary, new Map([['img.png', '\u0000']]))
  assert.equal(skipped.files[0].status, 'skip')
  assert.match(skipped.files[0].reason, /二进制补丁/)

  const alreadyThere = planPatchApplication(parseUnifiedPatch(PATCH).files.length ? parseUnifiedPatch([
    'diff --git a/new.txt b/new.txt', 'new file mode 100644', '--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1 @@', '+x',
  ].join('\n')) : { files: [], problems: [] }, new Map([['new.txt', 'existing\n']]))
  assert.equal(alreadyThere.files[0].status, 'failure')
  assert.match(alreadyThere.files[0].reason, /已存在/)
})

test('执行计划：源文件缺失 / 上下文对不上 ⇒ 整批 ok=false，不落盘', () => {
  const patch = parseUnifiedPatch(PATCH)
  const plan = planPatchApplication(patch, new Map([['src/a.ts', 'anything\n'], ['gone.txt', 'old line\nsecond line\n'], ['old/name.ts', 'x\n']]))
  assert.equal(plan.ok, false)
  const textPlan = plan.files.find(f => f.path === 'src/a.ts')
  assert.equal(textPlan.status, 'failure')
  assert.equal(textPlan.action, 'none')
  const missing = planPatchApplication(parseUnifiedPatch(PATCH), new Map([['gone.txt', 'old line\nsecond line\n'], ['old/name.ts', 'x\n']]))
  assert.equal(missing.ok, false)
})

test('已应用不算失败：整批 ok 仍为 true，档位合并出 partial', () => {
  const patch = parseUnifiedPatch(PATCH)
  const files = new Map([
    ['src/a.ts', 'const x = 1\nconst y = 3\nconst z = 4\nconst w = 5\n'],  // 已经应用过
    ['gone.txt', 'old line\nsecond line\n'],
    ['old/name.ts', 'x\n'],
  ])
  const plan = planPatchApplication(patch, files)
  assert.equal(plan.ok, true)
  assert.equal(plan.status, 'partial', 'success + alreadyApplied = partial（ApplyPatchStatus.and）')
  assert.equal(plan.files.find(f => f.path === 'src/a.ts').action, 'none')
})

test('档位合并照上游排序，success+alreadyApplied 归 partial', () => {
  assert.equal(andStatus('success', 'alreadyApplied'), 'partial')
  assert.equal(andStatus('success', 'success'), 'success')
  assert.equal(andStatus('failure', 'success'), 'failure')
  assert.equal(andStatus('skip', 'success'), 'success')
  assert.equal(andStatus('alreadyApplied', 'failure'), 'failure')
})

test('verifyPatchPath：绝对路径与 .. 拒绝，普通相对路径放行', () => {
  assert.equal(verifyPatchPath('src/a.ts'), null)
  assert.equal(verifyPatchPath('C:/x.txt'), '绝对路径')
  assert.equal(verifyPatchPath('/etc/passwd'), '绝对路径')
  assert.equal(verifyPatchPath('a/../../b'), '路径含 ..')
  assert.equal(verifyPatchPath(''), '空路径')
})

test('解析失败不吞：坏块头与认不出的行进 problems，好文件照常', () => {
  const patch = parseUnifiedPatch(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ nonsense @@', ' ctx'].join('\n'))
  assert.equal(patch.files.length, 1, '文件头仍然解析出来了')
  assert.ok(patch.problems.length >= 1, '坏块头进了 problems')
  const plan = planPatchApplication(patch, new Map([['x', 'ctx\n']]))
  assert.equal(plan.files[0].status, 'skip')
  assert.match(plan.files[0].reason, /没有块/)
})
