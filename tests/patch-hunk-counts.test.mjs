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
import { applyHunksFlexible, applyHunksToText, isAlreadyApplied, parseUnifiedPatch, planPatchApplication } from '../src/patchApply.ts'

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
  // 本机 git 配置不许参与判据：这台机器的全局配置是 `core.autocrlf=true`（实测 `git --version` 2.55.0.windows.5），
  // 不钉死的话 `git apply` 会把工作区内容换成 CRLF，同一条断言在别的机器上就换了答案。
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'core.eol', 'lf'])
  git(['config', 'user.email', 'patch3@invalid'])
  git(['config', 'user.name', 'patch3'])
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

// —— 边界形状：真 `git diff` 产出的补丁，本仓收块与应用的结果必须与真 `git apply` 逐字节相同 ——————
//
// 这里的裁判是 git 自己（派单 ③：补丁形态按 git 的 unified diff 规范，`man git-diff` 的 `@@ -l,s +l,s @@`
// 语义），不是本仓的记账：每条用例都先用真 git 生成补丁、用真 git 检查并应用，再拿同一份补丁喂本仓的
// `parseUnifiedPatch` + `applyHunksToText` + `planPatchApplication`，要求**逐字节相同**。
// 覆盖派单点名的边界：文件首 hunk、文件尾 hunk、两块、纯删除、零上下文（`-U0`）、新增文件、CRLF、
// 无结尾换行、删空文件。

/** 正文两侧实收的行数（上游 `PatchHunkUtil.kt:13-28` 的数法；`\` 那行不是内容，两侧都不加，`PatchReader.java:371-373`）。 */
function bodyCounts(body) {
  let before = 0
  let after = 0
  for (const line of body) {
    if (line.startsWith('\\')) continue
    if (line[0] !== '+') before++
    if (line[0] !== '-') after++
  }
  return [before, after]
}

/** 一行是不是块正文（表头 / 文件头 / 空行都不是）。 */
function isPatchBodyLine(line) {
  if (line === '') return false
  if (HUNK_HEADER.test(line)) return false
  return !/^(?:--- |\+\+\+ |diff --git |index [0-9a-f]{7,}|new file mode|deleted file mode|rename (?:from|to) |copy (?:from|to) |similarity |Binary files |GIT )/.test(line)
}

/** 逐块核对「块头声明的行数」与「正文实际的行数」——不借本仓的解析器，自己按上游数法数一遍。 */
function assertDeclaredEqualsBody(patch, where) {
  const lines = patch.split('\n')
  let hunks = 0
  for (let index = 0; index < lines.length; index++) {
    const match = HUNK_HEADER.exec(lines[index])
    if (!match) continue
    hunks++
    const declared = [match[2] === undefined ? 1 : Number(match[2]), match[4] === undefined ? 1 : Number(match[4])]
    const body = []
    let cursor = index + 1
    while (cursor < lines.length && isPatchBodyLine(lines[cursor])) { body.push(lines[cursor]); cursor++ }
    const actual = bodyCounts(body)
    assert.deepEqual(actual, declared, `${where}：第 ${hunks} 块「${lines[index]}」声明 ${declared.join('/')} 行，正文实际 ${actual.join('/')} 行`)
    index = cursor - 1
  }
  assert.ok(hunks > 0, `${where}：补丁里一个块头都没有`)
  return hunks
}

/** 把 x.txt 写成 before，提交，改成 after，让真 git 出补丁；返回补丁原文与工作区两侧的内容。 */
function gitAuthoredPatch(t, before, after, diffArgs) {
  const repo = gitRepo(t)
  if (!repo) return null
  writeFileSync(join(repo.dir, 'x.txt'), before, 'binary')
  repo.git(['add', '-A'])
  repo.git(['commit', '-qm', 'patch3 基线'])
  writeFileSync(join(repo.dir, 'x.txt'), after, 'binary')
  const patch = repo.git(['diff', ...diffArgs, '--', 'x.txt'])
  return { repo, patch }
}

// 每条形状各自的 git 侧口径：`-U0` 那种**零上下文**补丁必须带 `--unidiff-zero` 交给 git ——
// 不带时 `git apply` 会把纯插入块挪到文件末尾（实测本机的 git 2.55.0：`@@ -4,0 +5 @@ l4` + `+NEW`
// 打到 `l1..l10` 上，不带这个选项得到的是 `l1..l10 NEW`，带了才是 `l4 NEW l5`）。
// 这是 git 自己文档里的规矩（`man git-apply` 的 `--unidiff-zero`），不是本仓的口径问题。
const SHAPES = [
  { name: '文件首 hunk（改第 1 行）', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', after: 'X1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', args: [], apply: [] },
  { name: '文件尾 hunk（改最后一行）', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', after: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nX10\n', args: [], apply: [] },
  { name: '两块（文件首 + 文件尾）', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nl19\nl20\n', after: 'TOP\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\nl13\nl14\nl15\nl16\nl17\nl18\nl19\nBOTTOM\n', args: [], apply: [] },
  { name: '纯删除（中间三行）', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', after: 'l1\nl2\nl3\nl7\nl8\nl9\nl10\n', args: [], apply: [] },
  { name: '零上下文（-U0）中间插入', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', after: 'l1\nl2\nl3\nl4\nNEW\nl5\nl6\nl7\nl8\nl9\nl10\n', args: ['-U0'], apply: ['--unidiff-zero'] },
  { name: '零上下文（-U0）两块插入', before: 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n', after: 'l1\nl2\nA\nl3\nl4\nNEW\nl5\nl6\nl7\nl8\nl9\nl10\n', args: ['-U0'], apply: ['--unidiff-zero'] },
  { name: '零上下文（-U0）文件尾插入', before: 'l1\nl2\nl3\nl4\nl5\n', after: 'l1\nl2\nl3\nl4\nl5\nTAIL1\nTAIL2\n', args: ['-U0'], apply: ['--unidiff-zero'] },
  { name: '零上下文（-U0）删除', before: 'l1\nl2\nl3\nl4\nl5\n', after: 'l1\nl2\nl4\nl5\n', args: ['-U0'], apply: ['--unidiff-zero'] },
  { name: 'CRLF 文件（行尾原样进补丁）', before: 'c1\r\nc2\r\nc3\r\nc4\r\n', after: 'c1\r\nC2\r\nc3\r\nc4\r\n', args: [], apply: [] },
  { name: '没有结尾换行的文件', before: 'a\nb\nc', after: 'a\nB\nc', args: [], apply: [] },
  { name: '删空整个文件内容', before: 'l1\nl2\nl3\n', after: '', args: [], apply: [] },
]

test('边界形状：真 git 生成的补丁，本仓收块 + 本仓应用的结果必须与真 `git apply` 逐字节相同', (t) => {
  if (!gitRepo(t)) return
  for (const shape of SHAPES) {
    const made = gitAuthoredPatch(t, shape.before, shape.after, shape.args)
    assert.ok(made !== null, `${shape.name}：临时仓库建不出来`)
    const { repo, patch } = made
    const where = shape.name
    assert.match(patch, /^diff --git a\/x\.txt b\/x\.txt$/m, `${where}：补丁要带文件头`)
    assertDeclaredEqualsBody(patch, where)
    // 还原旧内容，然后把这份补丁交给真 git 与本仓各打一遍。
    writeFileSync(join(repo.dir, 'x.txt'), shape.before, 'binary')
    writeFileSync(join(repo.dir, 'case.patch'), patch, 'binary')
    const check = repo.git(['apply', '--check', ...shape.apply, 'case.patch'])
    assert.equal(check.trim(), '', `${where}：git apply --check 应当无输出，实际：${check}`)
    repo.git(['apply', ...shape.apply, 'case.patch'])
    const gitPatched = readFileSync(join(repo.dir, 'x.txt'), 'utf8')
    assert.equal(gitPatched, shape.after, `${where}：真 git apply 的结果应当就是新内容`)
    const parsed = parseUnifiedPatch(patch)
    assert.deepEqual(parsed.problems, [], `${where}：解析不该报问题`)
    assert.equal(parsed.files.length, 1, `${where}：应当正好一份文件`)
    const applied = applyHunksToText(shape.before, parsed.files[0].hunks)
    assert.equal(applied.ok, true, `${where}：本仓应用失败 —— ${applied.ok ? '' : applied.reason}`)
    assert.equal(applied.text, gitPatched, `${where}：本仓应用的结果必须与真 git 逐字节相同`)
    const plan = planPatchApplication(parsed, new Map([['x.txt', shape.before]]))
    assert.equal(plan.ok, true, `${where}：执行计划应当是绿的`)
    assert.equal(plan.files[0].content, gitPatched, `${where}：执行计划的内容必须与真 git 逐字节相同`)
  }
})

test('反向验证：把任一边界形状的块头行数改错一位 ⇒ 本仓必须红、真 `git apply --check` 也必须红', (t) => {
  if (!gitRepo(t)) return
  const mutated = []
  for (const shape of SHAPES) {
    for (const delta of [-1, 1]) {
      const made = gitAuthoredPatch(t, shape.before, shape.after, shape.args)
      assert.ok(made !== null, `${shape.name}：临时仓库建不出来`)
      const { repo, patch } = made
      const lines = patch.split('\n')
      const at = lines.findIndex(line => HUNK_HEADER.test(line))
      assert.ok(at >= 0, `${shape.name}：补丁里要找得到块头，实际补丁是 ${JSON.stringify(patch)}`)
      const match = HUNK_HEADER.exec(lines[at])
      const tail = lines[at].slice(match[0].length)   // 块头 `@@` 之后的函数上下文（git 会带上，本仓与 git 都忽略它）
      const declaredBefore = match[2] === undefined ? 1 : Number(match[2])
      const wrongBefore = declaredBefore + delta
      if (wrongBefore < 0) continue
      const afterSide = match[4] === undefined ? `+${match[3]}` : `+${match[3]},${match[4]}`
      const lie = [...lines]
      lie[at] = `@@ -${match[1]},${wrongBefore} ${afterSide} @@${tail}`
      const lieText = lie.join('\n')
      assert.notEqual(lieText, patch, `${shape.name}：注入必须真的改到块头（delta ${delta}）`)
      mutated.push(`${shape.name}#${delta}`)
      writeFileSync(join(repo.dir, 'x.txt'), shape.before, 'binary')
      writeFileSync(join(repo.dir, 'lie.patch'), lieText, 'binary')
      // 1) 真 git：必须拒绝（这条判据有牙的直接证明）。
      const check = repo.gitTry(['apply', '--check', ...shape.apply, 'lie.patch'])
      assert.notEqual(check.status, 0, `${shape.name}（声明改 ${delta > 0 ? '大' : '小'}一位）：git apply --check 必须红，实际 stderr=${JSON.stringify(check.stderr)}`)
      // 2) 本仓：要么拒绝，要么给出的**不是**忠实应用（静默少改/多改同样算红）。
      const parsed = parseUnifiedPatch(lieText)
      const applied = applyHunksToText(shape.before, parsed.files[0]?.hunks ?? [])
      const faithful = applied.ok && applied.text === shape.after
      assert.equal(faithful, false, `${shape.name}（声明改 ${delta > 0 ? '大' : '小'}一位）：本仓不许把它当忠实应用收下 —— ${JSON.stringify(applied.ok ? applied.text : applied.reason)}`)
      const flexible = applyHunksFlexible(shape.before, parsed.files[0]?.hunks ?? [])
      assert.equal(flexible.ok && flexible.text === shape.after, false, `${shape.name}：偏移搜索那条路也不许救回来`)
    }
  }
  // 11 条形状 × ±1，其中三条「原文 0 行」的 `-U0` 纯插入块减不出违规（0-1 是负数）⇒ 19 例。
  assert.equal(mutated.length, 19, `应当注入 19 例违规，实际 ${mutated.length}：${mutated.join(' | ')}`)
})

// —— 其余边界：块头账目的「应用侧」核对、新增文件、CRLF 三种配对、生成侧的 CRLF ——————————————

/** 手构一个块（绕过解析器，直接查应用侧的账目核对）。 */
function hunk(beforeStart, beforeCount, afterStart, afterCount, lines) {
  return { beforeStart, beforeCount, afterStart, afterCount, lines: lines.map(([type, text]) => ({ type, text, noNewline: false })) }
}

test('应用侧核对：手构的块「声明行数 ≠ 正文行数」必须拒绝，偏移搜索那条路也不许救（上游 PlainSimplePatchApplier:117-122）', () => {
  // 上游文案是 `patch.simple.apply.hunk.base.body.error`（期望 - 实际），本仓给同样的两个数：
  const lying = hunk(1, 3, 1, 1, [['remove', 'a']])
  const exact = applyHunksToText('a\nb\nc\n', [lying])
  assert.equal(exact.ok, false, `声明 3 行、正文 1 行的块不许被当成能应用 —— ${JSON.stringify(exact)}`)
  assert.match(exact.reason, /块头声明原文 3 行，正文实际 1 行/)
  assert.equal(applyHunksFlexible('a\nb\nc\n', [lying]).ok, false, '偏移搜索只救「行号偏了」，不救「行数对不上」')
  // 新文那一侧同样要核（上游的 `.patched.body.error` 那一条）。
  const lyingAfter = hunk(1, 1, 1, 2, [['remove', 'a'], ['add', 'A']])
  assert.match(String(applyHunksToText('a\n', [lyingAfter]).reason), /块头声明新文 2 行，正文实际 1 行/)
  // 反向对照：同一块把账目写对就应当能应用（证明上面那两条红的是「账目」而不是别的东西）。
  const honest = hunk(1, 1, 1, 1, [['remove', 'a'], ['add', 'A']])
  assert.deepEqual([applyHunksToText('a\n', [honest]).ok, applyHunksToText('a\n', [honest]).text], [true, 'A\n'])
  assert.equal(applyHunksFlexible('a\n', [honest]).ok, true)
})

test('新增文件（`--- /dev/null` + `@@ -0,0 +1,n @@`）：真 git 建出来的文件必须等于本仓计划的 create 内容', (t) => {
  const repo = gitRepo(t)
  if (!repo) return
  const added = ['n1', 'n2', 'n3']
  // `generateUnifiedDiff` 的两条路径行是界面标签（`当前文件` / `剪贴板`），不是 git 路径：
  // 这里只把它们换成 git 认的新增形状，`@@` 块头与正文一个字都不动 —— 要验的就是那份账。
  const patch = generateUnifiedDiff([], added).split('\n')
    .map(line => (line.startsWith('--- ') ? '--- /dev/null' : line.startsWith('+++ ') ? '+++ b/x.txt' : line)).join('\n')
  assert.match(patch, /^@@ -0,0 \+1,3 @@$/m, '新增文件的块头必须是 `-0,0 +1,3`')
  assertDeclaredEqualsBody(patch, '新增文件（生成侧）')
  writeFileSync(join(repo.dir, 'new.patch'), `${patch}\n`, 'binary')
  assert.equal(readFileSync(join(repo.dir, 'new.patch'), 'utf8').includes('x.txt'), true)
  const check = repo.git(['apply', '--check', 'new.patch'])
  assert.equal(check.trim(), '', `git apply --check 应当无输出，实际：${check}`)
  repo.git(['apply', 'new.patch'])
  const gitMade = readFileSync(join(repo.dir, 'x.txt'), 'utf8')
  assert.equal(gitMade, `${added.join('\n')}\n`, '真 git 建出来的文件内容')
  const parsed = parseUnifiedPatch(patch)
  assert.equal(parsed.files[0].kind, 'add', '本仓把它判成新增')
  assert.deepEqual(parsed.problems, [])
  const plan = planPatchApplication(parsed, new Map([['x.txt', null]]))
  assert.equal(plan.ok, true, JSON.stringify(plan))
  assert.equal(plan.files[0].action, 'create')
  assert.equal(plan.files[0].content, gitMade, '本仓计划的内容必须与真 git 逐字节相同')
})

test('CRLF 三种配对：本仓按上游口径（两侧都归一行尾）应用，结果保留原文件的主行尾', () => {
  const crlfBefore = 'c1\r\nc2\r\nc3\r\n'
  const crlfAfter = 'c1\r\nC2\r\nc3\r\n'
  // 1) CRLF 行尾的补丁 × CRLF 文件（真 git 也是绿的，见上面形状表那条 CRLF 用例）。
  const crlfPatch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,3 @@', ' c1\r', '-c2\r', '+C2\r', ' c3\r'].join('\n')
  const one = parseUnifiedPatch(crlfPatch)
  assert.deepEqual(one.problems, [], 'CRLF 补丁不该报问题')
  assertDeclaredEqualsBody(crlfPatch.replace(/\r/g, ''), 'CRLF 补丁（归一后核账）')
  const applied = applyHunksToText(crlfBefore, one.files[0].hunks)
  assert.equal(applied.ok, true, applied.ok ? '' : applied.reason)
  assert.equal(applied.text, crlfAfter, '未被补丁改动的行必须保留 CRLF')
  // 2) LF 行尾的补丁 × CRLF 文件：上游两侧都过 `LineTokenizer.tokenize(text, false)` ⇒ 行内容相等就能对上
  //    （真 `git apply` 在这里更严：实测 git 2.55.0 报 `patch does not apply` —— 本仓跟上游，不跟 git 的严）。
  const lfPatch = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,3 @@', ' c1', '-c2', '+C2', ' c3'].join('\n')
  const two = applyHunksToText(crlfBefore, parseUnifiedPatch(lfPatch).files[0].hunks)
  assert.equal(two.ok, true, two.ok ? '' : two.reason)
  assert.equal(two.text, crlfAfter, 'LF 补丁打到 CRLF 文件：内容按补丁走，行尾仍按文件走')
  // 3) CRLF 行尾的补丁 × LF 文件：同一口径，行尾保持 LF。
  const three = applyHunksToText('c1\nc2\nc3\n', parseUnifiedPatch(crlfPatch).files[0].hunks)
  assert.equal(three.ok, true, three.ok ? '' : three.reason)
  assert.equal(three.text, 'c1\nC2\nc3\n')
})

test('生成侧的 CRLF：`generateUnifiedDiff` 的行里带 CR 时，块头账目仍与正文一致且真 git 能打上', (t) => {
  const a = ['c1\r', 'c2\r', 'c3\r', 'c4\r']
  const b = ['c1\r', 'C2\r', 'c3\r', 'c4\r', 'c5\r']
  const patch = withRealPaths(generateUnifiedDiff(a, b), 'x.txt')
  assertDeclaredEqualsBody(patch, '生成侧 CRLF')
  const repo = gitRepo(t)
  if (!repo) return
  writeFileSync(join(repo.dir, 'x.txt'), `${a.join('\n')}\n`, 'binary')
  writeFileSync(join(repo.dir, 'crlf.patch'), `${patch}\n`, 'binary')
  assert.equal(repo.git(['apply', '--check', 'crlf.patch']).trim(), '', 'git apply --check 应当无输出')
  repo.git(['apply', 'crlf.patch'])
  const gitPatched = readFileSync(join(repo.dir, 'x.txt'), 'binary').toString('utf8')
  assert.equal(gitPatched, `${b.join('\n')}\n`, '真 git 打完就是新内容（CRLF 逐行）')
  const mine = applyHunksToText(`${a.join('\n')}\n`, parseUnifiedPatch(patch).files[0].hunks)
  assert.equal(mine.ok, true, mine.ok ? '' : mine.reason)
  assert.equal(mine.text, gitPatched, '本仓与真 git 必须逐字节相同')
})

test('零上下文（-U0）在文件最前面插入：本仓落在第一行之前（`@@ -0,0 +1,n @@` 的 0 就是「第 0 行之后」）', () => {
  const patch = ['--- a/x.txt', '+++ b/x.txt', '@@ -0,0 +1,2 @@', '+N1', '+N2'].join('\n')
  assertDeclaredEqualsBody(patch, '-U0 文件首插入')
  const parsed = parseUnifiedPatch(patch)
  assert.deepEqual([parsed.files[0].hunks[0].beforeStart, parsed.files[0].hunks[0].beforeCount], [0, 0])
  const applied = applyHunksToText('a\nb\n', parsed.files[0].hunks)
  assert.equal(applied.ok, true, applied.ok ? '' : applied.reason)
  assert.equal(applied.text, 'N1\nN2\na\nb\n', '插到最前面，不是插到第二行后面')
  // 说明（不钉死 git 的行为）：真 git 2.55.0 对它自己的这份 `-U0` 输出是**拒绝**的
  // （`git apply --unidiff-zero` 报 `patch failed: x.txt:0`），所以这一档只有本仓侧的判据；
  // 非 0 起始的 `-U0` 插入块（形状表里那三条）是真 git 认可并逐字节对表过的。
})

test('删空整个文件：本仓给空文件而不是一个空行；只留一个空行时那个换行必须留着', (t) => {
  // 1) 删空：`@@ -1,3 +0,0 @@`（形状表里那条用例已经用真 git 对过表，这里钉的是**行尾**那一笔）。
  const empty = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +0,0 @@', '-l1', '-l2', '-l3'].join('\n')
  assertDeclaredEqualsBody(empty, '删空文件')
  const emptied = applyHunksToText('l1\nl2\nl3\n', parseUnifiedPatch(empty).files[0].hunks)
  assert.equal(emptied.ok, true, emptied.ok ? '' : emptied.reason)
  assert.equal(emptied.text, '', '`@@ -1,3 +0,0 @@` 之后文件是空的：不许补出一个空行')
  // 2) 反向对照（同样由本仓生成侧产出，块头是 `-1,1 +1,1`）：新内容是一个空行 ⇒ 结果必须正好是 `\n`。
  const repo = gitRepo(t)
  if (!repo) return
  const oneBlank = generateUnifiedDiff(['l1'], [''])
  assert.match(oneBlank, /^@@ -1,1 \+1,1 @@$/m, '一块：删掉那一行、加回一个空行')
  assertDeclaredEqualsBody(oneBlank, '只留一个空行')
  const kept = applyHunksToText('l1\n', parseUnifiedPatch(oneBlank).files[0].hunks)
  assert.equal(kept.ok, true, kept.ok ? '' : kept.reason)
  assert.equal(kept.text, '\n', '一个空行的文件就是 `\\n`，不是空字符串')
  writeFileSync(join(repo.dir, 'x.txt'), 'l1\n', 'binary')
  writeFileSync(join(repo.dir, 'blank.patch'), `${withRealPaths(oneBlank, 'x.txt')}\n`, 'binary')
  repo.git(['apply', 'blank.patch'])
  assert.equal(readFileSync(join(repo.dir, 'x.txt'), 'binary').toString('utf8'), kept.text, '真 git 对这份补丁给的是同一个字节序列')
})

// —— 「已应用」那条路也在同一道账目闸后面 ————————————————————————————————————————————
//
// 上游的 ALREADY_APPLIED 只可能出自 `GenericPatchApplier.execute()` **成功**的那一侧：
// 块体放不下块头声明的跨度时 `myNotExact` 非空（`apply/GenericPatchApplier.java:186` 由
// `SplitHunk.read(hunk)` 填，`:1241-1251` 的落位算的就是 `hunk.getStartLineBefore()` /
// `getStartLineAfter()` —— 即块头声明的那两个数），于是 `getStatus()` 在 `:121-122` 直接给
// FAILURE（排在 `:124`/`:134` 那两条 ALREADY_APPLIED 之前），`execute()` 在 `:225`/`:235` 返回 false
// ⇒ `apply()` 返回 null（`:82`）⇒ `apply/ApplyTextFilePatch.java:55` 给 FAILURE。
// 也就是说：**账目不对的块在上游永远到不了「已经应用」这一档**。
// 本仓 `isAlreadyApplied` 原先只逐行比正文、不核账，于是「块头多报一行」的补丁（真实输入 = 半截补丁文件）
// 会被判成 alreadyApplied ⇒ `plan.ok = true` ⇒ 宿主照常落盘（`src/patchApplyHost.ts:64` 的
// 「计划不 ok 时一个字节都不写」直接被绕过）；改名那一档更狠：动作是 `rename`、内容是**没打过补丁**的原文，
// 于是文件被改了名而改动整块静默丢失。

test('已应用判定：账目不符的块不许被判成「已经应用」（上游 GenericPatchApplier:121-122 的 FAILURE 优先）', () => {
  // 原文那一侧：声明 3 行、正文只有 1 行 ⇒ after 侧是空的，旧的「逐行比对」全过。
  const lying = hunk(1, 3, 1, 1, [['remove', 'a']])
  assert.equal(isAlreadyApplied('a\nb\nc\n', [lying]), false, '声明 3 行、正文 1 行的块不许走「已应用」那条路')
  // 新文那一侧同样要核（上游的 `.patched.body.error` 那一条，`PlainSimplePatchApplier.java:120-122`）。
  const lyingAfter = hunk(1, 1, 1, 2, [['remove', 'a'], ['add', 'A']])
  assert.equal(isAlreadyApplied('A\n', [lyingAfter]), false, '新文声明 2 行、正文 1 行同样不许判成已应用')
  // 反向对照：账目写对、且**确实已经应用过**的块仍然要判 true —— 证明上面两条红的是「账目」而不是这条功能。
  const honest = hunk(1, 2, 1, 2, [['context', 'A'], ['remove', 'b'], ['add', 'B']])
  assert.equal(isAlreadyApplied('A\nB\n', [honest]), true, '账目对 + 内容已是新文 ⇒ 仍判已应用')
  assert.equal(isAlreadyApplied('A\nb\n', [honest]), false, '账目对但内容还是旧文 ⇒ 不判已应用')
})

test('执行计划：半截补丁（块头声明 3 行 / 正文 1 行）⇒ 整批不许落盘，改名那一档不许写出未打补丁的内容', () => {
  // 真实输入路径：截断的补丁文件，走 `parseUnifiedPatch` 而不是手构块。
  const truncated = parseUnifiedPatch(['--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,1 @@', '-a'].join('\n'))
  const hunks = truncated.files[0].hunks
  assert.equal(hunks.length, 1, '一块')
  assert.equal(hunks[0].beforeCount, 3, '块头声明原文 3 行')
  assert.deepEqual(hunks[0].lines.map(line => line.text), ['a'], '正文实际只收到 1 行')
  const textPlan = planPatchApplication(truncated, new Map([['x.txt', 'a\nb\nc\n']]))
  assert.equal(textPlan.files[0].status, 'failure', `半截补丁要判失败，实际 ${JSON.stringify(textPlan.files[0])}`)
  assert.match(String(textPlan.files[0].reason), /块头声明原文 3 行，正文实际 1 行/)
  assert.equal(textPlan.ok, false, 'plan.ok 必须是假：宿主按它决定整批落不落盘（src/patchApplyHost.ts:64）')
  assert.equal(textPlan.status, 'failure', '整批档位：`alreadyApplied` 算绿，这条必须是 failure')
  // 改名 + 账目不符：原先判 alreadyApplied ⇒ action 'rename' ⇒ 真把 x.txt 写成 y.txt 且一个字都不改。
  const moved = parseUnifiedPatch(['rename from x.txt', 'rename to y.txt', '--- a/x.txt', '+++ b/y.txt', '@@ -1,3 +1,1 @@', '-a'].join('\n'))
  assert.equal(moved.files[0].kind, 'rename', '这补丁确实被认成改名（否则这条用例测不到东西）')
  const renamePlan = planPatchApplication(moved, new Map([['x.txt', 'a\nb\nc\n'], ['y.txt', null]]))
  assert.equal(renamePlan.files[0].status, 'failure', `改名档也要失败，实际 ${JSON.stringify(renamePlan.files[0])}`)
  assert.equal(renamePlan.files[0].action, 'none', '不许产出 rename 动作')
  assert.equal(renamePlan.files[0].content, null, '不许把没打过补丁的原文写去新路径')
  assert.equal(renamePlan.ok, false, '整批不落盘')
  // 反向对照：账目对的补丁、文件已经是新文 ⇒ 仍判 alreadyApplied 且 plan.ok 为真（这条功能没被收紧误伤）。
  const already = planPatchApplication(
    parseUnifiedPatch(['--- a/x.txt', '+++ b/x.txt', '@@ -1,2 +1,2 @@', ' a', '-b', '+B'].join('\n')),
    new Map([['x.txt', 'a\nB\n']]),
  )
  assert.equal(already.files[0].status, 'alreadyApplied', JSON.stringify(already.files[0]))
  assert.equal(already.ok, true, '账目对 + 内容已是新文 ⇒ 仍旧算「已经应用过」，这条没动')
})
