// 补丁块头**声明的行数**必须等于正文里实际的行数 —— 生成侧（`src/diffText.ts` 的
// `generateUnifiedDiff`）与读侧（`src/patchApply.ts` 的 `parseUnifiedPatch`）同一份账。
//
// 上游口径（三条都是亲自打开过的真文件）：
//   · 写头 `UnifiedDiffWriter.writeHunkStart`，
//     `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/UnifiedDiffWriter.java:220-225`
//     —— `@@ -起始,行数 +起始,行数 @@`，那两个「行数」是块的两侧尾下标减头下标；
//   · 数行 `PatchHunkUtil.getRange`，
//     `platform/vcs-api/vcs-api-core/src/com/intellij/openapi/diff/impl/patch/PatchHunkUtil.kt:10-30`
//     —— REMOVE 只加 before 侧、ADD 只加 after 侧、CONTEXT 两侧都加；
//   · 收块 `PatchReader.readNextHunkUnified`，
//     `platform/vcs-impl/src/com/intellij/openapi/diff/impl/patch/PatchReader.java:335-392`
//     —— `:375` 用 `before < linesBefore || after < linesAfter` 决定「这一行还算块内容」，
//     凑满了 `:376-379` 把当前行**退回去**按表头重判，所以声明行数之外多塞的行不会进块。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { generateUnifiedDiff } from '../src/diffText.ts'
import { applyHunksToText, parseUnifiedPatch } from '../src/patchApply.ts'

/** 临时仓库的父目录：本仓 `build/`（已 gitignore），不是系统 tmp。 */
function scratchRoot() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
  mkdirSync(root, { recursive: true })
  return root
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** 块正文按上游 getRange 的数法得到的两侧行数。 */
function countsOf(body) {
  let before = 0
  let after = 0
  for (const line of body) {
    if (line[0] !== '+') before++
    if (line[0] !== '-') after++
  }
  return [before, after]
}

/** 生成补丁的前三行是文件头 + 块头，第 4 行起是块正文（既有测试钉死的形状）。 */
function splitPatch(patch) {
  const lines = patch.split('\n')
  return { head: lines[0], plus: lines[1], hunk: lines[2], body: lines.slice(3) }
}

test('生成侧：@@ 声明的行数 = 正文实际的行数（改一行 / 增 / 删 / 全同）', () => {
  const cases = [
    { a: ['keep', 'old one', 'old two', 'tail', 'tail2'], b: ['keep', 'new one', 'tail', 'tail2', 'added'] },
    { a: ['a', 'b'], b: ['a', 'B'] },
    { a: [], b: ['only new'] },
    { a: ['only old'], b: [] },
    { a: ['same', 'same'], b: ['same', 'same'] },
    { a: ['x'], b: ['x', 'y', 'z'] },
  ]
  for (const { a, b } of cases) {
    const { hunk, body } = splitPatch(generateUnifiedDiff(a, b))
    const match = HUNK_HEADER.exec(hunk)
    assert.ok(match, `块头要能解析，实际是「${hunk}」`)
    const declaredBefore = match[2] === undefined ? 1 : Number(match[2])
    const declaredAfter = match[4] === undefined ? 1 : Number(match[4])
    const [actualBefore, actualAfter] = countsOf(body)
    assert.deepEqual([declaredBefore, declaredAfter, actualBefore, actualAfter], [actualBefore, actualAfter, a.length, b.length],
      `声明的行数必须与正文一致（正文又必须与两侧文件一致）：${hunk}`)
  }
})

test('生成侧：纯增 / 纯删那一侧按 git 惯例报 0 基插入点（与本仓 native/history_diff.cpp:116-121 同口径）', () => {
  assert.equal(splitPatch(generateUnifiedDiff([], ['b'])).hunk, '@@ -0,0 +1,1 @@')
  assert.equal(splitPatch(generateUnifiedDiff(['a'], [])).hunk, '@@ -1,1 +0,0 @@')
})

test('读侧：生成的补丁整块收满，应用回旧内容就得到新内容（往返）', () => {
  const a = ['keep', 'old one', 'old two', 'tail', 'tail2']
  const b = ['keep', 'new one', 'tail', 'tail2', 'added']
  const patch = parseUnifiedPatch(generateUnifiedDiff(a, b))
  assert.deepEqual(patch.problems, [], '声明与实际一致 ⇒ 一块都不该短收')
  assert.equal(patch.files.length, 1)
  const hunks = patch.files[0].hunks
  assert.equal(hunks.length, 1)
  assert.deepEqual([hunks[0].beforeCount, hunks[0].afterCount], countsOf(splitPatch(generateUnifiedDiff(a, b)).body))
  const applied = applyHunksToText(`${a.join('\n')}\n`, hunks)
  assert.equal(applied.ok, true, applied.ok ? '' : applied.reason)
  assert.equal(applied.text, `${b.join('\n')}\n`)
})

// —— 失败用例（故意多塞一行）——

test('失败用例：故意把声明写成旧的 `@@ -1 +1 @@`（正文 6 行）⇒ 读侧只收 1 行，剩下的正文不进块', () => {
  const a = ['keep', 'old one', 'old two', 'tail', 'tail2']
  const b = ['keep', 'new one', 'tail', 'tail2', 'added']
  const real = generateUnifiedDiff(a, b)
  // 这就是本次要修的写法：头声明两侧各 1 行，正文却是整份文件。
  const lying = real.split('\n').map(line => (line.startsWith('@@ ') ? '@@ -1 +1 @@' : line)).join('\n')
  assert.notEqual(lying, real, '注入必须真的改到块头')
  const patch = parseUnifiedPatch(lying)
  const hunk = patch.files[0].hunks[0]
  assert.deepEqual([hunk.beforeCount, hunk.afterCount], [1, 1], '省略第二个数就是 1（上游 PatchReader.java:359）')
  assert.equal(hunk.lines.length, 1, '凑满声明就停手，多余的正文行不许留在块里')
  const truncated = applyHunksToText(`${a.join('\n')}\n`, patch.files[0].hunks)
  assert.equal(truncated.ok, true, truncated.ok ? '' : truncated.reason)
  assert.equal(truncated.text, `${a.join('\n')}\n`, '只收 1 行 ⇒ 整份改动静默丢失，落盘的还是旧内容')
  assert.notEqual(truncated.text, `${b.join('\n')}\n`)
})

test('失败用例：块凑满后又多塞一行，紧跟第二块 ⇒ 多余行被丢掉、下一块不被吸进来', () => {
  const patch = parseUnifiedPatch([
    'diff --git a/x b/x', '--- a/x', '+++ b/x',
    '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', '+SURPLUS 声明之外多塞的一行',
    '@@ -9,1 +9,1 @@', '-nine', '+NINE',
  ].join('\n'))
  assert.equal(patch.files.length, 1)
  const hunks = patch.files[0].hunks
  assert.equal(hunks.length, 2, '第二块不许被吸进第一块（第一块声明 2/2，收满就结束）')
  assert.deepEqual(hunks[0].lines.map(line => line.text), ['one', 'two', 'TWO'], '多余那行不进块')
  assert.deepEqual(hunks[0].lines.map(line => line.type), ['context', 'remove', 'add'])
  assert.deepEqual([hunks[1].beforeStart, hunks[1].beforeCount, hunks[1].afterStart, hunks[1].afterCount], [9, 1, 9, 1])
  assert.deepEqual(hunks[1].lines.map(line => [line.type, line.text]), [['remove', 'nine'], ['add', 'NINE']])
})

test('失败用例：同一份多塞一行的补丁，真 git apply --check 必须红（声明与正文不符）', (t) => {
  const repo = gitRepo(t)
  if (!repo) return
  writeFileSync(join(repo.dir, 'x.txt'), 'one\ntwo\nthree\n')
  writeFileSync(join(repo.dir, 'bad.patch'), [
    '--- a/x.txt', '+++ b/x.txt',
    '@@ -1,2 +1,2 @@', ' one', '-two', '+TWO', '+SURPLUS', ' three',
  ].join('\n') + '\n')
  const result = repo.gitTry(['apply', '--check', 'bad.patch'])
  assert.notEqual(result.status, 0, `块头少报一行，git 应当拒绝：${result.stderr}`)
  assert.match(result.stderr || result.stdout, /corrupt patch|does not apply|unrecovered/, `失败理由要写清：${result.stderr}`)
})

// —— 真 git 实测（有 git 就跑；没有 git 记 skip，不算放松断言）——

function gitRepo(t) {
  try {
    execFileSync(gitBin(), ['--version'], { encoding: 'utf8' })
  } catch {
    t.skip('这台机器上没有 git，跳过真 apply 实测')
    return null
  }
  // 临时目录放 build/（已 gitignore），测试结束删干净。
  const dir = mkdtempSync(join(scratchRoot(), 'patch-hunk-counts-'))
  t.after(() => { rmSync(dir, { recursive: true, force: true }) })
  const git = (args) => execFileSync(gitBin(), args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  /** 不抛错的那一侧：`git apply --check` 失败是这条测试要的结果。 */
  const gitTry = (args) => spawnSync(gitBin(), args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q'])
  return { dir, git, gitTry }
}

function gitBin() { return process.platform === 'win32' ? 'git.exe' : 'git' }

/** 把生成补丁的两条路径行换成真路径（`@@` 块头一个字都不动：那才是这次要验的东西）。 */
function withRealPaths(patch, path) {
  return patch.split('\n')
    .map(line => line.startsWith('--- ') ? `--- a/${path}` : line.startsWith('+++ ') ? `+++ b/${path}` : line)
    .join('\n')
}

test('真 git apply --check：本仓生成的补丁（旧内容 → 新内容）是绿的，真应用后文件等于新内容', (t) => {
  const repo = gitRepo(t)
  if (!repo) return
  const a = ['keep', 'old one', 'old two', 'tail', 'tail2']
  const b = ['keep', 'new one', 'tail', 'tail2', 'added']
  writeFileSync(join(repo.dir, 'x.txt'), `${a.join('\n')}\n`)
  const patch = withRealPaths(generateUnifiedDiff(a, b), 'x.txt')
  writeFileSync(join(repo.dir, 'change.patch'), `${patch}\n`)
  const check = repo.git(['apply', '--check', 'change.patch'])
  assert.equal(check.trim(), '', `git apply --check 应当无输出，实际：${check}`)
  repo.git(['apply', 'change.patch'])
  assert.equal(readFileSync(join(repo.dir, 'x.txt'), 'utf8').replace(/\r\n/g, '\n'), `${b.join('\n')}\n`)
})

test('真 git apply --check：把块头改回旧的 `@@ -1 +1 @@` 立刻变红（反向验证这条判据有牙）', (t) => {
  const repo = gitRepo(t)
  if (!repo) return
  const a = ['keep', 'old one', 'old two', 'tail', 'tail2']
  const b = ['keep', 'new one', 'tail', 'tail2', 'added']
  writeFileSync(join(repo.dir, 'x.txt'), `${a.join('\n')}\n`)
  const lying = withRealPaths(generateUnifiedDiff(a, b), 'x.txt')
    .split('\n').map(line => (line.startsWith('@@ ') ? '@@ -1 +1 @@' : line)).join('\n')
  writeFileSync(join(repo.dir, 'lie.patch'), `${lying}\n`)
  let failed = false
  try {
    repo.git(['apply', '--check', 'lie.patch'])
  } catch (caught) {
    failed = true
    assert.match(String(caught.stderr ?? caught.message), /corrupt patch|does not apply|unrecovered/)
  }
  assert.equal(failed, true, '声明 1 行、正文 11 行的补丁必须被 git 拒绝')
})
