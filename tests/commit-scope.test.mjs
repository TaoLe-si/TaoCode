// 部分提交（「提交文件…」）的范围层判据：选择 → pathspec → 结果判定。
//
// 这一族只管"这一次要提交哪些路径"，不管提交前检查（那条 lane 在 `commitChecksResult.ts` /
// `sourceControlCommitChecks.ts`），也不管 git 那一头真正跑成什么样 —— 后者的判据是可执行的
// 原生用例 `native/git_test.cpp` 那四条（"partial commit: …"，跑真 git、专用临时仓库）。
// 这里钉的是纯规则：四条边界（空选择 / 未跟踪 / 重命名对 / 混用暂存与未暂存）+ 前后端同一道闸。
//
// 2026-10-06 partialcommit 收尾（本文件随之改三处，实现侧的对应改动都在注释里）：
//  · 边界三不再钉 `commitScopeProblem`/`COMMIT_SCOPE_EMPTY` —— 那两个符号在仓里**没有生产消费方**，
//    同一句「选择要提交的文件」的真源是 `src/commitCheck.ts:106`（`commitBlockMessage('no-changes')`），
//    跑的那条链是 `commitIncludedCount` ⇒ `commitBlockReason` ⇒ 提交按钮 + 错误行。
//    这里改钉**真跑的那条链**（判据只增不减：空选择、全对不上、目录、重命名另一头各一档）；
//  · 覆盖判定并成一份（`commitScopeCovers`）⇒ 新增一条"三把尺子同一答案"的判据；
//  · 那道闸多两条：长度按 **UTF-8 字节**（native 是 `path.size()`），pathspec 通配/魔术前端先拒
//    （native 那一半是接线请求 W3，`docs/wiring-requests-2026-10-06-partialcommit.md`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commitScopeCovers, committedChangeCount, expandCommitSelection,
  leftBehindStagedCount, normalizeCommitSelection, renamePartnerCount,
  COMMIT_SCOPE_LABEL } from '../src/commitScope.ts'
import { commitRequestParams, MAX_COMMIT_PATH_LENGTH, MAX_COMMIT_PATHS } from '../src/commitChecks.ts'
import { commitBlockMessage, commitBlockReason, commitIncludedCount } from '../src/commitCheck.ts'
import { changesMenuRows } from '../src/changesMenuActions.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const row = (path, extra = {}) => ({ path, untracked: false, ...extra })

// ── 边界一：重命名对 ──────────────────────────────────────────────────────────────
// 上游一条 `ChangedPath` 同时带 beforePath/afterPath（`GitCheckinEnvironment.kt:403-404`）。
// 单边提交在 git 那一头写出的是坏历史（native 那四条 case 里逐条实测：只给新路径 ⇒ `A` + HEAD 里
// 旧路径还在；只给旧路径 ⇒ `D` + 新内容留在 index；两朵一起 ⇒ `R100`）。⇒ 前端补全，native 兜底拒。
test('选中一次重命名 ⇒ pathspec 带上旧路径那一半，顺序紧跟其后', () => {
  const rows = [row('keep.ts'), row('new/name.ts', { renameFrom: 'old/name.ts' })]
  assert.deepEqual(expandCommitSelection(['new/name.ts'], rows), ['new/name.ts', 'old/name.ts'],
    '只选新路径时补齐旧路径（两朵一起给才是 R100）')
  // 反向：从宿主那条通道进来的可能是**旧**路径（面板的行以新路径为键，别处不一定）。
  assert.deepEqual(expandCommitSelection(['old/name.ts'], rows), ['old/name.ts', 'new/name.ts'],
    '只给旧路径时补出新路径 —— 两个方向都要补，否则同样是坏历史')
  assert.deepEqual(expandCommitSelection(['new/name.ts', 'old/name.ts'], rows),
    ['new/name.ts', 'old/name.ts'], '两半都给 ⇒ 一个字不动（不能补出第三条）')
  assert.equal(renamePartnerCount(['new/name.ts', 'old/name.ts'], rows), 1, '这一对算一对')
  assert.equal(renamePartnerCount(['new/name.ts', 'old/name.ts'], [row('keep.ts')]), 0, '没有重命名就没有对')
})

test('补全后的 pathspec 通过请求体：旧路径那一半不被当成"没有可提交的变更"误拒', () => {
  const rows = [row('new/name.ts', { renameFrom: 'old/name.ts' })]
  const base = { message: '做点事', amend: false, signoff: false, author: '', authorEmail: '' }
  assert.deepEqual(commitRequestParams({ ...base, paths: ['new/name.ts'], changes: rows }).paths,
    ['new/name.ts', 'old/name.ts'], '请求体里就是成对的两朵（这一步在 commitRequestParams 里面做，界面上只有一条通道）')
  // 少了成对这一档就会假绿：单独把旧路径给一个**没有**这一行的列表，仍要按"陌生路径"拒掉。
  assert.throws(() => commitRequestParams({ ...base, paths: ['old/name.ts'], changes: [row('other.ts')] }),
    /没有可提交的变更/)
})

// ── 边界二：未跟踪 ────────────────────────────────────────────────────────────────
// `CheckinActionUtil.kt:104-105` + `:153-167` 把未版本管理的被选项并进"这次包含的变更"；
// git 那一头不认陌生 pathspec（实测 `did not match any file(s) known to git`）⇒ native 只对未跟踪的
// 那几条先 add。范围层要做的是：**不要**把未跟踪的当"没有可提交的变更"拒掉，也**不要**替它展开目录。
test('未跟踪的被选项照原样进 pathspec（新文件也是这次提交的一部分）', () => {
  const rows = [row('new.ts', { untracked: true }), row('m.ts')]
  assert.deepEqual(expandCommitSelection(['new.ts'], rows), ['new.ts'], '未跟踪 = 保留，不是拒绝')
  assert.deepEqual(expandCommitSelection(['m.ts', 'new.ts'], rows), ['m.ts', 'new.ts'], '按选中顺序原样发')
  assert.equal(commitIncludedCount(rows, ['new.ts']), 1, '只选一个新文件不是空提交（上游 isCommitEmpty 把 unversioned 也算进来）')
  assert.equal(committedChangeCount(['new.ts'], rows), 1, '它计入"这次提交包含的变更"那一个数')
})

// ── 边界三：空选择 / 全对不上 ──────────────────────────────────────────────────────
// 上游对空选择是**动作不启用**（`CommonCheckinFilesAction.kt:33` 要求 `pathsToCommit.any { isActionEnabled }`），
// 而不是悄悄提交整份暂存区。本仓请求体那一档仍是"空 = 不发键"（`tests/commit-checks.test.mjs` 钉着），
// 所以"我确实选了但一个都没落上"这句话由**真跑的那条链**来说：
// `commitIncludedCount`（`src/commitCheck.ts:75-84`）⇒ `commitBlockReason` ⇒ `commitBlockMessage`（同文件 `:106`），
// 落点是提交按钮的禁用 + 面板那条错误行；请求体那一头 `commitPathsToSubmit` 同一批还有一道 throw 兜底
// （宿主直接递进来的非法子集走那条）。上一版在这里钉的 `commitScopeProblem` 没有生产消费方，已删。
test('空选择 / 全对不上 ⇒ 说「选择要提交的文件」，而不是静默降级成全量', () => {
  const rows = [row('a.ts')]
  // 那句话的唯一真源（上游 `error.no.changes.to.commit`：英文 `VcsBundle.properties:17`，
  // 中文包 `localization-zh.jar!messages/VcsBundle.properties:519` 逐字 = 选择要提交的文件）。
  assert.equal(commitBlockMessage('no-changes'), '选择要提交的文件')
  // 没有范围 ⇒ 不发 `paths` 键（面板那个 computed 给空数组）：
  // 而"有没有内容"退回整份暂存区（`includedCount = null`），这是历史行为，不是降级。
  assert.equal(commitIncludedCount(rows, []), null, '空范围 = 没有范围这一档（不发 paths 键）')
  assert.deepEqual(commitRequestParams({ message: 'm', amend: false, signoff: false, author: '', authorEmail: '', paths: [], changes: rows }),
    { message: 'm', amend: false, signoff: false, author: '', authorEmail: '' }, '空选择 ⇒ 请求体与历史逐字一致')
  // 选了、但对不上：这一档必须说话，不能悄悄提交整份暂存区。
  assert.equal(commitIncludedCount(rows, ['ghost.ts']), 0, '对不上任何变更行 = 这次真的没内容')
  assert.equal(commitBlockReason({ hasStagedChanges: true, hasMessage: true, amend: false, includedCount: 0 }), 'no-changes',
    '暂存区里有东西也不给点：范围里没落上 = 空提交')
  assert.throws(() => commitRequestParams({ message: 'm', amend: false, signoff: false, author: '', authorEmail: '',
    paths: ['ghost.ts'], changes: rows }), /没有可提交的变更/, '请求体那一头的第二道兜底（宿主直接递进来的子集）')
  // 空白项不算一次选择（前端把空串当"没选"，native 那道闸则直接把空串判非法）。
  assert.equal(commitIncludedCount(rows, [' ', '']), null)
  assert.deepEqual(commitRequestParams({ message: 'm', amend: false, signoff: false, author: '', authorEmail: '',
    paths: [' ', ''], changes: rows }).paths, undefined, '全空白 = 没选 ⇒ 不发 paths 键')
})

test('目录选择算得中它下面的变更行（git 的 pathspec 就是这个语义）', () => {
  const rows = [row('src/a.ts'), row('src/deep/b.ts')]
  assert.equal(commitScopeCovers('src', rows[0]), true, '目录 pathspec 覆盖它下面的每一行')
  assert.equal(commitScopeCovers('src', row('other.ts')), false, '目录外的不算进来')
  assert.equal(commitIncludedCount(rows, ['src']), 2, '目录下面有变更就不是空提交')
  assert.equal(committedChangeCount(['src'], rows), 2, '两个变更都算进"这次包含的"')
  assert.equal(committedChangeCount(['src'], [row('src/a.ts'), row('other.ts')]), 1, '目录只算它自己那一支')
})

test('覆盖判定只有一份：范围层、请求体、提交按钮那把空判同一答案', () => {
  // 三处各自写过一遍"这条 pathspec 覆得到这一行吗"，2026-10-06 partialcommit 收尾并成
  // `commitScopeCovers` 一份。这里钉的是**并之前会漂的那两档**：
  const base = { message: 'm', amend: false, signoff: false, author: '', authorEmail: '' }
  // ① 重命名的另一头：面板补全出两朵 pathspec，`commitPathsToSubmit` 认旧路径那一半，
  //    而 `commitIncludedCount` 原来不认 ⇒ 按钮被「选择要提交的文件」按住，是一次假拒。
  const rows = [row('keep.ts'), row('new/name.ts', { renameFrom: 'old/name.ts' })]
  const pair = expandCommitSelection(['old/name.ts'], rows)
  assert.deepEqual(pair, ['old/name.ts', 'new/name.ts'], '宿主只给旧路径时也补全成对')
  assert.deepEqual(commitRequestParams({ ...base, paths: pair, changes: rows }).paths, pair, '请求体不拒（这一档原来就对）')
  assert.equal(commitIncludedCount(rows, pair), 1, '空判也只数一条变更（重命名是一条、不是两条）')
  assert.equal(committedChangeCount(pair, rows), 1, '结果计数与它同一个数')
  // ② 被忽略的行：`isActionEnabled`（`CommonCheckinFilesAction.kt:75-78`）对 IGNORED 不启用 ⇒
  //    既不能进请求体，也不能算成"这次有内容 / 这次提交了几篇"。
  const noisy = [row('src/a.ts', { ignored: true }), row('src/b.ts', { ignored: true })]
  assert.throws(() => commitRequestParams({ ...base, paths: ['src/a.ts'], changes: noisy }), /被忽略的文件不参与提交/)
  assert.equal(commitIncludedCount(noisy, ['src']), 0, '目录下面只有被忽略的行 ⇒ 这次没内容')
  assert.equal(committedChangeCount(['src'], noisy), 0, '结果计数也不数被忽略的')
  assert.equal(committedChangeCount([], [...noisy, row('m.ts', { staged: true })]), 1,
    '没范围那一档同样滤掉被忽略的（两档口径一致）')
  // ③ 上游 `CountChangesIgnoringChangeLists`（ShowNotificationCommitResultHandler.kt:128）的
  //    `HashSet(changes).size`：同一个路径出现两次只数一次（这条判据原来钉在 `countCommittedPaths` 上，
  //    那个函数没有生产消费方、已删 ⇒ 判据搬到这里）。
  assert.equal(committedChangeCount(['dup.ts'], [row('dup.ts'), row('dup.ts')]), 1, '同一路径两行只算一个变更')
  assert.equal(MAX_COMMIT_PATHS, 500, '条数上限（native `paths.size() > 500` 同一个数）')
})

// ── 边界四：混用暂存 / 未暂存 ─────────────────────────────────────────────────────
// 实测（native 那四条 case 的第一条）：`--only` 取被选项的**工作区内容** ⇒ 一篇 `MM` 的文件两半一起进
// 这次提交；没被选的 `M ` 文件提交后仍留在暂存区。范围层不改变这个形状，它要保证**报出去的数**是对的。
test('混用暂存/未暂存：计数数变更、不数 pathspec，也不把没进的算成功', () => {
  const rows = [
    row('pick.ts', { staged: true, renameFrom: undefined }),
    row('staged-only.ts', { staged: true }),
    row('new.ts', { untracked: true }),
    row('renamed.ts', { staged: true, renameFrom: 'old.ts' }),
  ]
  const paths = expandCommitSelection(['renamed.ts', 'pick.ts'], rows)
  assert.deepEqual(paths, ['renamed.ts', 'old.ts', 'pick.ts'], '成对补齐后是三条 pathspec')
  assert.equal(committedChangeCount(paths, rows), 2, '两条 pathspec 补出来的一对重命名只算一个变更')
  assert.equal(leftBehindStagedCount(paths, rows), 1, '没被选的 sc 那一篇留在暂存区（实测它一条不动）')
  assert.equal(leftBehindStagedCount(paths, rows) + committedChangeCount(paths, rows),
    2 + 1, '两边加起来要说清一共几篇已暂存（不许有第三种数法）')
  assert.equal(committedChangeCount([], rows), 3,
    '没有范围时数的是整份暂存区的**三篇**变更（`pick.ts` + `staged-only.ts` + `renamed.ts`，重命名那一对只算一篇，未跟踪的 `new.ts` 不算）——与本用例上面那两条 `leftBehind 1 + committed 2 = 3` 同一个总数')
})

// ── 前端镜像与 native 同一道闸 ────────────────────────────────────────────────────
// native 那道闸的本体：`checked_path()` 五道（空串 / >512 字节 / 以 `-` 开头 / 含 CR|LF / 含 `..`）
// + `checked_pathspec()` 在它之上再加四道（任意控制字符或反斜杠 / 绝对路径 / 带盘符 / 通配与魔术）。
// 前端 `commitPathProblem` 是它的一份镜像：**八道同源**（native 那道多一个空串），
// 两条收尾口径（2026-10-06 commitpaths 收口，原来这两条"只有前端有"）：
//  · 长度按 **UTF-8 字节**数（native 是 `path.size()`，字节；原来这里按 UTF-16 码元数 ⇒ 同一句
//    注释、两个数，中文路径就会前端放行 native 拒）；
//  · pathspec 通配/魔术（`*` `?` `[` / `:(` / 开头的 `:`）现在**两侧都拒**：native 那一头原来只有前端拒，
//    是 `docs/wiring-requests-2026-10-06-partialcommit.md` W3，本批（commitpaths 的派单明确允许改
//    `native/git.cpp`）落进 `checked_pathspec()`。实测它不是纸面风险 —— 临时仓里
//    `git commit --only -m x -- 'foo[1].ts'` 一次提交走了 `foo[1].ts` **和** `foo1.ts` 两篇，
//    `-- '*.ts'` 更是把所有 `.ts` 都提交走。前端那道闸挡得住面板这条路，挡不住**宿主直接递进来**的
//    同一份形状（不走 `commitRequestParams` 的调用方），所以本体必须在 native。
//  唯一还留着的不对称是**空串**：native 判非法、前端当"没选"滤掉（有意不同，见上面 W5.1 与边界三）。
test('前端的 pathspec 闸与 native 逐条对得上：八道同源 + 空串那一档有意不同（改一边就得改另一边）', () => {
  const base = { message: '做点事', amend: false, signoff: false, author: '', authorEmail: '' }
  const native = read('native/git.cpp')
  assert.equal(MAX_COMMIT_PATH_LENGTH, 512, '长度上限与 native 的字面量必须同一个数')
  assert.match(native, /path\.size\(\) > 512/, 'native 那边也是 512')
  assert.match(native, /if \(path\.empty\(\)/, 'native 还拒空串（前端把空串当"没选"滤掉，不报错）')
  for (const [path, reason] of [
    ['-rf.ts', '以 - 开头'],
    ['../out.ts', '含 ..'],
    ['a.ts\nb.ts', '含控制字符'],
    ['\u0000a.ts', '含控制字符（NUL 到 git 那一头把 argv 截断）'],
    ['a\tb.ts', '含制表符（同一条控制字符口径，native 是 `< 0x20`）'],
    ['C:/repo/a.ts', '带盘符的绝对路径'],
    ['/abs/a.ts', '绝对路径'],
    ['sub\\a.ts', '反斜杠分隔符'],
    ['x'.repeat(513) + '.ts', '超长'],
  ]) {
    assert.throws(() => commitRequestParams({ ...base, paths: [path] }), /不合法|相对|盘符|分隔符|控制字符|过长/,
      `前端要拒掉这种 pathspec：${reason}`)
  }
  // 同一道闸、同一个错误码：native 那三条新增的字面量在这儿逐条比（改了 native 就要改这里）。
  assert.match(native, /static_cast<unsigned char>\(character\) < 0x20 \|\| character == '\\\\'/,
    '控制字符与反斜杠在 native 那道里是同一个分支')
  assert.match(native, /if \(path\.front\(\) == '\/'\) throw WorkspaceError\("INVALID_REQUEST", "提交路径不能是绝对路径。"\);/)
  assert.match(native, /path\[1\] == ':'/, '盘符那一档 native 按第二个字符是冒号判')
  // 长度数的是字节：512 个 ASCII 恰好放过，同样的 512 个**字符**（汉字 = 3 字节/篇）要拒。
  assert.doesNotThrow(() => commitRequestParams({ ...base, paths: ['x'.repeat(MAX_COMMIT_PATH_LENGTH)] }),
    '512 字节（= 512 个 ASCII）正好在上限内')
  assert.throws(() => commitRequestParams({ ...base, paths: ['中'.repeat(171)] }), /过长/,
    '171 个汉字 = 513 字节 ⇒ 按 native 的 `path.size()` 就该拒（原来按字符数是 171，放行了）')
  // pathspec 通配/魔术：**两侧都拒**（native 那一半 = W3，本批落地）。
  for (const [path, reason] of [
    ['*.ts', '星号会匹配到没选的文件（实测一次提交走两篇）'],
    ['a?.ts', '问号同理'],
    ['foo[1].ts', '字符类同理（实测 `foo[1].ts` 连 `foo1.ts` 一起提交走）'],
    [':(exclude)a.ts', 'pathspec 魔术：反向把选中的排除掉'],
    [':!a.ts', '魔术前缀的简写'],
  ]) {
    assert.throws(() => commitRequestParams({ ...base, paths: [path] }), /通配|魔术/,
      `前端要拒掉这种 pathspec：${reason}`)
  }
  // native 本体那一道的四个条件，与前端 PATHSPEC_MAGIC_RE = /[*?[]|:\(|^:/ 一字不差（改了任一边就要改这里）。
  assert.match(native, /path\.find_first_of\("\*\?\["\) != std::string::npos \|\| path\.front\(\) == ':' \|\|\s*\n\s*path\.find\(":\("\) != std::string::npos/,
    'native 的 checked_pathspec 必须同样拒通配与魔术（W3 已落地；这一道挡的是**宿主直接递进来**的形状，前端那道挡不住）')
  assert.match(native, /:\(literal\)/,
    'native 里记着"包成 :(literal) 也能解"这条替代路线（原写 doesNotMatch 钉"还没接"，本批按它自己的说明翻成 match）')
  assert.equal(read('src/commitChecks.ts').match(/^const PATHSPEC_MAGIC_RE = .*/m)[0],
    'const PATHSPEC_MAGIC_RE = /[*?[]|:\\(|^:/',
    '前端那道闸的正则形状钉住：native 的四个条件与它逐条对应，任一边单独放宽都会漏一面')
  // 合法形状一条不掉：仓库相对的 POSIX 写法。
  assert.deepEqual(commitRequestParams({ ...base, paths: ['src/a.ts', 'README.md'] }).paths,
    ['src/a.ts', 'README.md'])
})

// ── 菜单那一行的可见性（上游 isActionEnabled 的两档） ──────────────────────────────
test('右键菜单里的「提交文件…」：被忽略的行不给点，其余都给（`CommonCheckinFilesAction.kt:75-78`）', () => {
  assert.equal(COMMIT_SCOPE_LABEL, '提交文件…', '上游 action.name.checkin.file + ELLIPSIS（VcsBundle.properties:110、:5）')
  const tracked = changesMenuRows({ staged: false, untracked: false }).map(r => r.id)
  assert.ok(tracked.includes('commitFile'), '已跟踪的变更上有这一行')
  assert.equal(tracked[0], 'commitFile', '它是非冲突那一档的第一行（上游 CheckinFiles 挂在 ChangesViewPopupMenu 最上面）')
  assert.ok(changesMenuRows({ staged: true }).map(r => r.id).includes('commitFile'), '已暂存的也有')
  assert.ok(!changesMenuRows({ ignored: true }).map(r => r.id).includes('commitFile'), '被忽略的不给点')
})

// ── normalize 口径（与 commitChecks 的集合语义一致） ───────────────────────────────
test('去空白、并重复、保顺序', () => {
  assert.deepEqual(normalizeCommitSelection(['b.ts', ' a.ts ', 'b.ts', '']), ['b.ts', 'a.ts'])
  assert.deepEqual(expandCommitSelection(['a.ts', 'a.ts'], [row('a.ts')]), ['a.ts'], '重复的并掉')
})
