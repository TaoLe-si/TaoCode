// 「转到哈希/分支/标记」的补全判据（日志面，桶 13 遗留的 §C 第 12 条）。
//
// 上游（逐条实读，不是"IDEA 一般是这样"）：
//   · 动作与弹层：`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/GoToHashOrRefAction.java:44-51`
//     （把 `dataPack.getRefs()` 交给 `GoToHashOrRefPopup`）、`GoToHashOrRefPopup.java:67`；
//   · 候选的**范围**：`VcsLogDataPack.java:29` 的 `VcsLogAggregatedStoredRefs getRefs()` +
//     `platform/vcs-log/api/src/com/intellij/vcs/log/VcsLogAggregatedStoredRefs.kt:24`
//     （"a set of stored references for **all** VCS roots"）⇒ 不是"已加载那一页上的引用"；
//   · 候选的**两批**：`ui/actions/VcsRefCompletionProvider.java:26-28`（`collectSync` = 分支）与
//     `:31-34`（`collectAsync` = 非分支引用 = 标签等），驱动在
//     `ui/actions/TwoStepCompletionProvider.java:36-64`：先把同步那批 `addValues` 画出去（`:41`），
//     再每 `TIMEOUT = 100`（`:32`）取一轮后台那批、回来就**追加**（`:46-48`），
//     `ProgressManager.checkCanceled()`（`:44`）与 `future.cancel(true)`（`:61`）负责作废迟到的批次，
//     `ExecutionException` ⇒ 记日志然后 `break`（`:52-55`，已经画出去的留着）。
//   · 订正留痕：`docs/batch-2026-10-06-verdict-vcs.md:43` 把这一条写成「先补字段名再补值」，
//     实际读上游后核对：这个类做的是**同步批先出 + 后台批续补**，没有任何"字段名"补全 ⇒ 按实际行为做。
//
// 跳转顺序（引用先、哈希后）与形状判据沿用 `src/vcsLogGoToRef.ts` 已有的那一条，未放松。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  goToRefAccepts, goToRefCandidates, goToRefMatches, looksLikeHash, notAHashMessage, runRefCompletion,
} from '../src/vcsLogGoToRef.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const commit = (hash, refs = []) => ({ hash, shortHash: hash.slice(0, 7), author: 'a', date: '2026-10-06T00:00:00Z', subject: 's', parents: [], refs })

// —— 已有的那一份：已加载页的引用（不等待的那一批）——

test('候选 = 已加载页上出现过的引用，去重后按名字排', () => {
  const list = [commit('h1', [{ name: 'main', type: 'local' }, { name: 'v1.0', type: 'tag' }]),
    commit('h2', [{ name: 'main', type: 'local' }, { name: '  ', type: 'head' }])]
  assert.deepEqual(goToRefCandidates(list), ['main', 'v1.0'], '重复的并掉、空白名字不收（否则会画一行空白候选）')
  assert.deepEqual(goToRefCandidates([]), [])
})

test('补全只认前缀，并截到上限（上游 result.getPrefixMatcher()）', () => {
  const all = ['feature/a', 'feature/b', 'main', 'release/1']
  assert.deepEqual(goToRefMatches(all, 'feature/'), ['feature/a', 'feature/b'])
  assert.deepEqual(goToRefMatches(all, ''), [], '空前缀不画候选（上游不弹空补全）')
  assert.deepEqual(goToRefMatches(all, '  main  '), ['main'], '前后空白不算')
  assert.equal(goToRefMatches(all, 'f', 1).length, 1, '上限是真的在截')
})

test('哈希形状：4..64 位十六进制；报出来的那句文案取 VcsBundle 原文', () => {
  assert.equal(looksLikeHash('abc'), false, '3 位不算（git 的缩写下限是 4）')
  assert.equal(looksLikeHash('abcd'), true)
  assert.equal(looksLikeHash('a'.repeat(40)), true, 'sha-1')
  assert.equal(looksLikeHash('a'.repeat(64)), true, 'sha-256 的前缀也认')
  assert.equal(looksLikeHash('zzzz'), false)
  assert.equal(notAHashMessage('nope'), "'nope' 不像是一个提交哈希")
})

// —— 两批补全（§C-12 的实际行为）——

const settled = values => () => Promise.resolve(values)

test('第一批先出、第二批追加：分支那批不等，标签那批回来才并入', async () => {
  const drawn = []
  const order = []
  const tags = () => new Promise(resolve => { setTimeout(() => resolve(['v9.9']), 0) })
  const outcome = await runRefCompletion({
    prefix: '', sync: ['main'], limit: 12,
    loadBranches: settled(['feature/x']), loadTags: tags,
    isStale: () => false, emit: (matches, known) => { drawn.push(matches); order.push(known.slice()) },
  })
  assert.equal(outcome, 'done')
  assert.deepEqual(drawn, [[], [], []], '空前缀一条候选都不画（上游不弹空补全），但每一批都画了一次')
  assert.deepEqual(order, [['main'], ['main', 'feature/x'], ['main', 'feature/x', 'v9.9']],
    '累积顺序 = 内存那一份 → 分支 → 标签')
})

test('输 "v1"：本仓原来只有已加载页 ⇒ 一个候选都没有；接上标签那批就补得出来', async () => {
  const page = ['main', 'v1.0']
  const before = []
  await runRefCompletion({ prefix: 'v1', sync: page, loadBranches: settled(['feature/x']), isStale: () => false, emit: m => before.push(m) })
  assert.deepEqual(before, [['v1.0'], ['v1.0']], '没给标签来源时 = 已加载页那一份（画两次：一次进第一批、一次并完分支）')
  const after = []
  await runRefCompletion({
    prefix: 'v1', sync: page, loadBranches: settled(['feature/x']), loadTags: settled(['v1.1', 'v2.0']),
    isStale: () => false, emit: m => after.push(m),
  })
  assert.deepEqual(after, [['v1.0'], ['v1.0'], ['v1.0', 'v1.1']],
    '第二页之外的标签也进了候选；顺序是"先来先占位"（上游 addValues 先同步批、后异步批），不是重排')
})

test('分支在标签前面（collectSync 的那一批先占位），上限按这个顺序截', async () => {
  const drawn = []
  await runRefCompletion({
    prefix: 'r', sync: [], loadBranches: settled(['refs-a', 'main']), loadTags: settled(['release/1', 'rc/2']),
    limit: 2, isStale: () => false, emit: m => drawn.push(m),
  })
  assert.deepEqual(drawn, [[], ['refs-a'], ['refs-a', 'release/1']],
    '第一笔是"内存里那一份"（这里为空），分支那批回来才有第一条；上限 2 条时分支优先占位、标签补剩下的格（本仓选择：上游没有 12/2 这一档，条数上限在 lookup 自己那一侧）')
})

test('迟到的一批必须作废：改了一个字（令牌变了）就不许盖到新的一轮上', async () => {
  let stale = false
  const drawn = []
  // 分支那批一被调用就说明用户又敲了一个字（本仓的令牌在这一刻翻转）。
  const branches = () => { stale = true; return Promise.resolve(['feature/x']) }
  const outcome = await runRefCompletion({
    prefix: 'v', sync: ['main'], loadBranches: branches, loadTags: settled(['v1.0']),
    isStale: () => stale, emit: m => drawn.push(m),
  })
  assert.equal(outcome, 'stale', '上游 ProgressManager.checkCanceled() 那一档')
  assert.deepEqual(drawn, [[]], '过期的那一批一条都不许画（只画了第一次那一笔空候选）')
  assert.equal(drawn.length, 1)
  const drawn2 = []
  // 第一次画之前就发现这一轮已经不是当前轮（关弹层那一档）⇒ 一笔都不画。
  await runRefCompletion({
    prefix: 'v', sync: ['main'], loadBranches: settled(['feature/x']),
    isStale: () => true, emit: m => drawn2.push(m),
  })
  assert.deepEqual(drawn2, [], 'isStale 在第一次画之前就把这一轮拦掉')
})

test('一批取不到就到此为止，已经画出去的留着（上游 ExecutionException ⇒ LOG.error + break）', async () => {
  const drawn = []
  const failing = () => Promise.reject(new Error('git.status 失败'))
  const tags = settled(['v1.0'])
  const outcome = await runRefCompletion({
    prefix: 'v', sync: ['v0.1'], loadBranches: failing, loadTags: tags, isStale: () => false, emit: m => drawn.push(m),
  })
  assert.equal(outcome, 'done')
  assert.deepEqual(drawn, [['v0.1']], '分支那批抛错 ⇒ 后面的标签批也不再补（与上游 break 同序），第一画留着')
})

test('宿主没接两批来源时 = 逐字退回"已加载页"那一份', async () => {
  const drawn = []
  const known = []
  await runRefCompletion({ prefix: 'ma', sync: ['main', 'dev'], isStale: () => false, emit: (m, k) => { drawn.push(m); known.push(k) } })
  assert.deepEqual(drawn, [['main']], '只画一次')
  assert.deepEqual(known, [['main', 'dev']], '候选集就是已加载页那一份，没被编出来')
})

test('「转到」那一半认的是两批合起来的候选集（jumpToRefOrHash 先当引用试）', () => {
  assert.equal(goToRefAccepts(['main', 'v1.0'], 'main'), true)
  assert.equal(goToRefAccepts(['main', 'v1.0'], 'v1'), true, '前缀命中就算引用（上游 startsWith）')
  assert.equal(goToRefAccepts(['main', 'v1.0'], 'nope'), false)
  assert.equal(goToRefAccepts(['main'], ''), false, '空输入不认，交给 submit() 的前置判空')
  assert.equal(goToRefAccepts(['main'], '  main  '), true, '两侧空白不算进名字里')
})

// —— 接线：两批来源真的接到了宿主已有的两个方法上（不放只过自己测试的死模块）——

test('接线：来源走 git.status 的分支与 git.tags，缓存随仓库根与打标签作废', () => {
  const data = read('src/vcsLogData.ts')
  // 原写「loadBranchNames 里直接 `await request<GitStatus>('git.status')`」：这一批把 status 收成一处
  // `loadGitStatus()` 内存快照（首屏/刷新时读，`currentBranch` / `isOnBranch` / 分支列表共用同一份），
  // 判据按不变量改写 —— 分支来源仍然是 `git.status` 的 `branches` 字段，只是那一份现在经 loadGitStatus 拿。
  assert.match(data, /request<GitStatus>\('git\.status', \{\}\)/, '分支来源真的打 git.status')
  assert.match(data, /const data = await loadGitStatus\(\)[\s\S]*const names = data\.branches \?\? \[\]/,
    '分支 = git.status 的 branches（native/main.cpp:1135 那句 taocode::git::branches）')
  assert.match(data, /const data = await request<GitTags>\('git\.tags', \{\}\)[\s\S]*const names = data\.tags \?\? \[\]/,
    '标签 = git.tags（native/git.hpp:102）')
  assert.match(data, /if \(branchNames\.value\.length\) return branchNames\.value/, '取一次就缓存')
  assert.match(data, /if \(tagNames\.value\.length\) return tagNames\.value/)
  assert.match(data, /branchNames\.value = \[\]; tagNames\.value = \[\]/, '换仓库根就作废（否则切项目还在补上一个项目的分支）')
  assert.equal((data.match(/forgetRefCompletionCache\(\)/g) ?? []).length, 3, '定义一次 + 建标签/删标签两处失效')
  assert.match(data, /await request\('git\.tag\.create', \{ name, target: hash \}\)\s*forgetRefCompletionCache\(\)/,
    '刚打的标签下一次补全就该出现')
  assert.match(data, /await request\('git\.tag\.delete', \{ name \}\)\s*forgetRefCompletionCache\(\)/,
    '刚删的标签不该还在补全里')
  assert.match(data, /return \{[\s\S]*loadBranchNames, loadTagNames/, '两条来源要真的交出去（同一个 return 对象）')
})

test('接线：日志窗口把两条来源交给查找框，查找框用令牌跑两批', () => {
  const log = read('src/components/VcsLog.vue')
  assert.match(log, /<VcsLogGoToRef :commits="commits" :navigating="navigating" :load-branches="loadBranchNames" :load-tags="loadTagNames" @go-to="jump" \/>/)
  assert.match(log, /resetTo, uncommit, createTagOn, deleteTag, loadBranchNames, loadTagNames,[\s\S]*\} =\s*\n\s*useVcsLogData\(/,
    '两条来源是从数据层解构出来的（同一个 useVcsLogData），不是组件里另编一份')
  const popup = read('src/components/VcsLogGoToRef.vue')
  assert.match(popup, /loadBranches\?: \(\) => Promise<readonly string\[\]>\n\s*loadTags\?: \(\) => Promise<readonly string\[\]>/,
    '两条都是**可选** prop：宿主没接就退回已加载页那一份，不编来源')
  assert.match(popup, /let round = 0/, '取消令牌')
  assert.match(popup, /const token = \+\+round/, '每跑一轮换一次令牌')
  assert.match(popup, /emit: \(found, all\) => \{ if \(isStale\(\)\) return;/, '迟到的那一批在写状态之前再过一次令牌')
  assert.match(popup, /watch\(text, \(\) => \{ if \(open\.value\) void refresh\(\) \}\)/, '每敲一个字重跑一轮')
  assert.match(popup, /watch\(open, value => \{ if \(value\) void refresh\(\); else round\+\+ \}\)/, '关弹层把在途的那一轮作废')
  assert.match(popup, /if \(!goToRefAccepts\(known\.value, target\) && !looksLikeHash\(target\)\)/,
    '「转到」认的是两批合起来的那一份（先当引用、再当哈希）')
  assert.doesNotMatch(popup, /request\(/, '查找框自己不发消息：来源由宿主注入')
})

test('模块侧没有只过自己测试的死出口：runRefCompletion 与 goToRefAccepts 都有消费方', () => {
  const popup = read('src/components/VcsLogGoToRef.vue')
  assert.match(popup, /import \{[^}]*runRefCompletion \} from '\.\.\/vcsLogGoToRef'/)
  assert.match(popup, /await runRefCompletion\(\{/)
  assert.match(popup, /goToRefAccepts/)
  // 被搬走的旧出口（computed 那一版的 goToRefMatches 调用）不该留在查找框里绕开两批。
  assert.doesNotMatch(popup, /goToRefMatches/)
})
