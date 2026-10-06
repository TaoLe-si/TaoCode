// 会话级信任**只有一份**（接线请求 `docs/wiring-requests-2026-10-06-welcome2.md` 的 R4 落地判据）。
//
// 落之前是两处：宿主 `src/workspaceLifecycle.ts` 自留一个 `ref<TrustedPathEntry[]>`、
// 模块 `src/trustedProjects.ts` 里还有一份 `sessionTrustedLocations`，两边互不可见 ⇒
//   · 对话框答「这次信任」（宿主那一份）在设置页那张表里**看不见**；
//   · 设置页改/删会话项（模块那一份）**不影响**执行侧门禁（门禁吃宿主的并集）。
// 上游本来就只有一份 per 存储，两侧读写同一个单例：
//   · `platform/platform-impl/src/com/intellij/ide/impl/TrustedPaths.kt:25-28`（`getInstance()` = `service()`），
//     确认框那一路写它（`platform/platform-impl/src/com/intellij/ide/trustedProjects/TrustedProjectsDialog.kt:64-71`），
//     设置页读它（`platform/platform-impl/src/com/intellij/ide/impl/TrustedHostsConfigurable.kt:66-71`）；
//   · 应用改动时按差集**各回各家**（同文件 `:80-89`），一条会话项不会把用户手管的那条一起删掉。
// 本仓落点：真源 = `trustedProjects.ts` 的 `sessionTrustedLocations`；宿主只读它、只写它。
//
// 判据口径：**按来源**（路径根 / URL 所属项目根）判，不是整串字面量 ——
// 上游 `TrustedPaths.kt:46-49` 与 `TrustedPathsSettings.kt:44-47` 都把清单建成
// `PrefixTreeMap<Path, Boolean>`（`PathPrefixTree`），问的是「最近祖先」，所以
// `d:/work/pro` 被信任**不该**放行 `d:/work/proj`（字符串前缀会误放行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  applyTrustDecision, browseWithTrustCheck, isProjectTrusted, mergeTrustEntries, rememberSessionTrust,
  rememberTrust, replaceSessionTrust, sessionTrustEntries, trustDecisionPaths, trustedLocationRows,
} from '../src/trustedProjects.ts'

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const lifecycle = read('../src/workspaceLifecycle.ts')
const reset = () => { replaceSessionTrust([]) }

/** 门禁吃的那份并集 = 宿主的 `trustEntries()` 换完之后的同一行写法（持久 + 会话真源）。 */
const gateEntries = persisted => mergeTrustEntries(persisted, sessionTrustEntries())

test('宿主那份已经并进模块那份：读写点各只剩一条，旧的 ref 不在盘上', () => {
  assert.ok(!/const sessionTrust = ref<TrustedPathEntry\[\]>\(\[\]/.test(lifecycle),
    '宿主的自留数组必须删掉（留着就是两份）')
  assert.ok(!/sessionTrust\.value/.test(lifecycle), '宿主不再读写自己的那一份')
  assert.match(lifecycle, /return mergeTrustEntries\(generalSettings\.value\?\.trustedPaths, sessionTrustEntries\(\)\)/,
    '门禁的会话档取自模块真源')
  assert.match(lifecycle, /else rememberSessionTrust\(root, choice === 'trust'\)/,
    '对话框没勾「以后不再询问」的那一句答话写进模块真源')
  assert.match(lifecycle, /import \{ isProjectTrusted, mergeTrustEntries, needsTrustPrompt, rememberSessionTrust, rememberTrust,/,
    '两个新名字是真的 import 进来的（不是同名局部函数）')
  assert.match(lifecycle, /sessionTrustEntries, trustBlockReason,/, 'import 表里带 sessionTrustEntries')
})

test('旧位置写入 → 新真源读得到：门禁与设置页那张表同时看得见（R4 的迁移判据）', () => {
  reset()
  // 老写法（宿主那份数组的更新式）与新写法的**输入**相同：一次「这次信任」的答话。
  rememberSessionTrust('D:/Work/Proj', true)
  const gate = gateEntries([])
  assert.deepEqual(gate, [{ path: 'd:/work/proj', trusted: true }], '门禁读到的就是这一条')
  assert.equal(isProjectTrusted('d:/work/proj/src/Main.java', gate), true, '执行侧放行（老行为保留）')
  // 同一份数据现在也出现在设置页那张表里（这正是 R4 修的那半边）。
  const rows = trustedLocationRows([])
  assert.deepEqual(rows.map(row => `${row.path}/${row.source}`), ['d:/work/proj/explicit'],
    '设置页按并集默认吃会话真源（TrustedHostsConfigurable.kt:66-71）')
  reset()
})

test('迁移不丢东西：一串答话按老写法与新写法各跑一遍，得到同一张表', () => {
  reset()
  const answers = [
    ['D:/Work/Alpha', true], ['D:/Work/Beta', false], ['D:/Work/Alpha', false],
    ['D:\\Work\\Gamma\\', true], ['', true], ['   ', true],
  ]
  // 老：宿主那份是 `sessionTrust.value = rememberTrust(sessionTrust.value, root, choice === 'trust')`
  let old = []
  for (const [path, trusted] of answers) old = rememberTrust(old, path, trusted)
  // 新：`rememberSessionTrust(root, choice === 'trust')`
  for (const [path, trusted] of answers) rememberSessionTrust(path, trusted)
  const fresh = sessionTrustEntries()
  const asText = list => list.map(entry => `${entry.path}:${entry.trusted}`).sort()
  assert.deepEqual(asText(fresh), asText(old),
    '同一串写入 ⇒ 同一个条目集合（空路径两边都不记、覆盖口径两边都是「同一路径只留最后一次的答话」）')
  assert.deepEqual(asText(fresh), ['d:/work/alpha:false', 'd:/work/beta:false', 'd:/work/gamma:true'])
  // 如实登记的一处形状差别：老写法把「改过答案」的那条挪到表尾，新写法就地更新留在原位。
  assert.deepEqual(fresh.map(entry => entry.path), ['d:/work/alpha', 'd:/work/beta', 'd:/work/gamma'],
    '新真源是就地覆盖（原位在表头）')
  assert.deepEqual(old.map(entry => entry.path), ['d:/work/beta', 'd:/work/alpha', 'd:/work/gamma'],
    '老写法把覆盖过的那条挪到了尾部 ⇒ 只有顺序差，没有内容差')
  // 顺序差不会改判：判定读的是**最近祖先**（`closestTrustEntry`），并集里同一路径也不可能出现两次。
  for (const probe of ['d:/work', 'd:/work/alpha', 'd:/work/alpha/src/Main.java', 'd:/work/beta',
                       'd:/work/gamma', 'd:/work/gamma/sub', 'd:/work/proj', 'z:/nothing']) {
    assert.equal(isProjectTrusted(probe, fresh), isProjectTrusted(probe, old), `判定因顺序漂了：${probe}`)
  }
  assert.equal(isProjectTrusted('d:/work/gamma/sub', fresh), true)
  assert.equal(isProjectTrusted('d:/work/alpha/sub', fresh), false, '改口不信任要赢过先前的信任')
  reset()
})

test('设置页删一条会话项现在真的影响门禁（原来两份互不相干）', () => {
  reset()
  rememberSessionTrust('D:/Session/Only', true)
  assert.equal(isProjectTrusted('d:/session/only', gateEntries([{ path: 'd:/persisted', trusted: true }])), true)
  // 设置页的移除：按差集回写（`applyMergedLocations` 的产物灌回真源用的就是 replaceSessionTrust）。
  replaceSessionTrust([])
  assert.equal(isProjectTrusted('d:/session/only', gateEntries([{ path: 'd:/persisted', trusted: true }])), false,
    '删掉的会话项不能继续放行（上游差集回写后靠 onProjectUntrusted 刷新门禁）')
  assert.equal(isProjectTrusted('d:/persisted', gateEntries([{ path: 'd:/persisted', trusted: true }])), true,
    '持久那一份不受影响（:80-89 的「各回各家」）')
  reset()
})

test('会失败的边界：按段判来源，不是整串字面量的前缀', () => {
  reset()
  rememberSessionTrust('D:/Work/Pro', true)
  const gate = gateEntries([])
  assert.equal(isProjectTrusted('d:/work/pro/src', gate), true, '真子目录放行')
  assert.equal(isProjectTrusted('d:/work/proj', gate), false,
    '兄弟目录名字以它开头也不算落在来源内（PrefixTreeMap 按段，字符串 startsWith 会误放行）')
  assert.equal(isProjectTrusted('d:/work', gate), false, '父目录不能被子目录的信任带上去')
  // 盘符根是「整盘来源」：补回尾斜杠的那一步（normalizeTrustedPath）保证 `c:` 不误配 `c:foo`。
  replaceSessionTrust([{ path: 'C:\\', trusted: true }])
  const rooted = gateEntries([])
  assert.equal(isProjectTrusted('c:/anything/here', rooted), true)
  assert.equal(isProjectTrusted('c:evil', rooted), false, '裸 `c:evil` 不是盘符根之下的路径')
  reset()
})

test('URL 那一路也按来源（所属项目根）判，不是每条 URL 各判一次字面量', async () => {
  reset()
  rememberSessionTrust('D:/Work/P', true)
  const asked = []
  const opened = []
  // 「这次信任」过之后，同一个项目根下的任意 URL 都不该再问（上游 canBrowse 问的是项目信任）。
  for (const url of ['https://a.example/x', 'https://b.example/y']) {
    const result = await browseWithTrustCheck(url, {
      root: () => 'D:/Work/P', entries: () => gateEntries([]),
      ask: async prompt => { asked.push(prompt.url); return 'open' },
      save: () => undefined, open: url => { opened.push(url) },
    })
    assert.equal(result, 'opened')
  }
  assert.deepEqual(asked, [], '已信任的来源下面的链接一次都不问（BrowserLauncherImpl.kt:69-71）')
  // 换一个没被信任的项目根：同一串 URL 就要问 —— 证明钉的不是 URL 字面量。
  reset()
  const elsewhere = []
  await browseWithTrustCheck('https://a.example/x', {
    root: () => 'D:/Other/P', entries: () => gateEntries([]),
    ask: async prompt => { elsewhere.push(prompt.url); return 'cancel' },
    save: () => undefined, open: () => undefined,
  })
  assert.deepEqual(elsewhere, ['https://a.example/x'], 'URL 相同但来源不同 ⇒ 照问')
  reset()
})

test('「始终信任此来源」的落库形状与上游一致：父目录一条、值为真', () => {
  reset()
  // 上游 `TrustedProjectsDialog.kt:66-70`：勾了 trust-all 才 `addTrustedPath(projectRoot.parent.toString())`，
  // 而 `TrustedPathsSettings.kt:34-48` 那一档存的是字符串清单、每一条隐式为 true ⇒ 本仓写成 {path, trusted:true}。
  const decision = trustDecisionPaths('trust', 'D:/Work/Proj', true, 'C:/Users/me/.taocode')
  assert.deepEqual(decision, [{ path: 'd:/work/proj', trusted: true }, { path: 'd:/work', trusted: true }])
  const persisted = applyTrustDecision([{ path: 'e:/keep', trusted: false }], decision)
  assert.deepEqual(persisted, [
    { path: 'e:/keep', trusted: false },
    { path: 'd:/work/proj', trusted: true },
    { path: 'd:/work', trusted: true },
  ], '显式不信任的旧条目不因写入被洗掉')
  // 同一来源下的别的项目：靠「最近祖先」直接放行，不需要再问一次。
  replaceSessionTrust([{ path: 'd:/work', trusted: true }])
  assert.equal(isProjectTrusted('d:/work/other-project', gateEntries(persisted)), true)
  // 落在 IDE 配置目录里的来源不给这一项（TrustedProjects.kt:103-107）。
  assert.deepEqual(trustDecisionPaths('trust', 'C:/Users/me/.taocode/projects/mirror', true, 'C:/Users/me/.taocode'),
    [{ path: 'c:/users/me/.taocode/projects/mirror', trusted: true }])
  reset()
})
