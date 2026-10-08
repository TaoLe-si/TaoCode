// 族级判决产物 ↔ 判词真源的门禁（B8 `execution`/`xdebugger` 这一族生成物）。
//
// 要防的缺陷（2026-10-06 实测到的一份，见 `docs/batch-2026-10-06-verdict-sync.md`）：
// `docs/inventory/verdict-execution-debug.md` 在 HEAD 就与 `scripts/verdict_table.py` 的
// `FAMILIES` 差着 6 行族判词，`python scripts/verdict_table.py --check` 一直报
// 「不一致 1 / 7」，但 `npm test` 里**没有任何一条**会去跑那个 `--check` ——
// `tests/verdict-generated.test.mjs` 读的是 `*_verdict_table.json`（JSON 与真源同步），
// 族级 md 文档没人核，于是这条门存在却不在回归里。
//
// 本文件的取舍（为什么不写成「python 把结论落一份 JSON、node 只读那份 JSON」）：
//   · 只读快照的门必然假绿 —— 真源改了而 python 没重跑时，快照与真源一起漂，node 看不出差别；
//     要让快照有牙就得在 node 里重实现生成器（`write_verdict_doc` 的分族/排序/计数/合计），
//     那就是第二份真源，与本仓「判词真源只留一份」的口径冲突。
//   · 所以这里两件事分开做：
//     ① **不依赖 python 的硬断言**（test 1）：md 里每一族那一格必须逐字等于同名 JSON 的
//        `families[族].reason` + 该族行数 —— HEAD 那份漂移就是被这条抓住的（它不需要生成器）；
//     ② **真源 ↔ JSON ↔ md 的字节级比对**（test 2）直接调 `python … --check`，
//        这是唯一能核到 `FAMILIES` 本体的路子。python 缺席时记 `t.skip` 而不是悄悄放过，
//        口径与 `tests/patch-hunk-counts.test.mjs` 对真 git 的处理一致。
//   · test 3 是反向验证的门禁化：在 `build/`（已 gitignore）的临时副本里真改一个字，
//     门必须红；改回必须绿。副本里跑，不碰仓库的生成物。
//   · test 4 核「手写 §G 逐类表」护栏还挡着（同样在副本里跑，不拿真判决书冒险）。
//
// 2026-10-06 T-4 扩面（本轮踩到的第二条同一个洞，见 `docs/batch-2026-10-06-ledgerfix.md` §3）：
//   默认 `--check` 只比 execution+xdebugger 那 7 条产物，于是 `--check platform_rest` / `--check daemon`
//   这种**逐域**红，`npm test` 一条也看不见（两条 lane 各撞过一次并上报）。现在：
//     ②b 逐域跑每一族：域清单**从 `docs/inventory/` 现算**（有 `<域>.txt` 且有 `<域>_signals.json` 才算），
//        并且断言这个现算集合 == 门里声明的集合 ⇒「新增一族却没人给它跑门」这条路被封死；
//        手写 §G 的域（actions / find-diff）断言它只核 2 条产物**且**打印那句「判决书不参与比对」；
//     ②c 同名产物属主是别人的两个域（settings-run = `enumerate_inventory.py`、vcs = 手写逐类账本，
//        都被 b10/b11 当判据读）必须由脚本明说「不属于本生成器的产物 + 属主」，写盘档必须拒绝覆盖；
//        谁把那份 json 换成本生成器的 schema，这条就红并要求把它搬进真比对清单；
//     ⑤ 反向验证专门打 B12 专属的两张表（`PLATFORM_FAMILIES` / `MODULE_JUDGMENTS`）：改一处 ⇒
//        逐域档必须红，而默认档必须**还是绿的**（那就是那个洞的形状），还原 ⇒ 回绿。
//   ① 也顺手扩到 daemon / projectviews / platform_rest 三份判决书（这一档不依赖 python）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const inv = rel => join(root, 'docs', 'inventory', rel)
const digest = text => createHash('sha256').update(text).digest('hex')
const read = path => readFileSync(path, 'utf8')

/** python 解释器：本机 `python` → `py -3` → `python3`。找不到返回 null（调用侧记 skip）。 */
function findPython() {
  const candidates = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]]
  for (const [bin, prefix] of candidates) {
    const probe = spawnSync(bin, [...prefix, '--version'], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0) return { bin, prefix }
  }
  return null
}
const PY = findPython()

/** 跑 `python scripts/verdict_table.py <args>`；cwd 可指向临时副本（脚本按自身位置认仓库根）。 */
function verdictPy(args, cwd = root) {
  return spawnSync(PY.bin, [...PY.prefix, join(cwd, 'scripts', 'verdict_table.py'), ...args],
    { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
}

// ── ① 不依赖 python：族级 md 的判词必须逐字等于同名 JSON 的 families[族].reason ──────
// 生成器的 `write_verdict_doc` 就是按 `| \`族\` | \`[档]\` | reason | 行数 |` 印这一格的，
// 所以「md 被人手改过」或「md 是旧版生成物」都表现为：这一格在 md 里找不到。
const DOC_SOURCES = [
  ['verdict-execution.md', ['execution_verdict_table.json']],
  ['verdict-xdebugger.md', ['xdebugger_verdict_table.json']],
  ['verdict-execution-debug.md', ['execution_verdict_table.json', 'xdebugger_verdict_table.json']],
  // T-4 扩面（2026-10-06）：这三份判决书以前只被 `--check <域>` 覆盖，python 缺席时就没人核。
  // 这一档不依赖 python，所以「族级 md 被手改 / 是旧版生成物」在任何机器上都当场红。
  ['verdict-daemon.md', ['daemon_verdict_table.json']],
  ['verdict-projectviews.md', ['projectviews_verdict_table.json']],
  ['verdict-platform_rest.md', ['platform_rest_verdict_table.json']],
]

function familyRows(payload) {
  const counts = new Map()
  for (const row of payload.rows) counts.set(row.family, (counts.get(row.family) ?? 0) + 1)
  return [...counts.entries()].map(([family, count]) => {
    const entry = payload.families[family]
    assert.ok(entry, `${payload.domain} 的族 ${family} 在 families 表里没有判词`)
    return { family, tier: entry.tier, reason: entry.reason, count }
  })
}

test('族级判决书的每一格判词都逐字等于 JSON 真源映射（防手改 / 防旧版生成物）', () => {
  const offenders = []
  for (const [docName, jsonNames] of DOC_SOURCES) {
    const doc = read(inv(docName))
    // 这份文档只由这几个域的 JSON 生成：文档里印出的族必须全部能在 JSON 里逐字对上。
    const printed = [...doc.matchAll(/^\| `([^`]+)` \| `\[(.)\]` \| (.*) \| (\d+) \|$/gm)]
    assert.ok(printed.length > 0, `${docName} 里没解析到任何族级行（生成器格式变了？）`)
    const sources = jsonNames.map(name => JSON.parse(read(inv(name))))
    for (const [, family, tier, reason, count] of printed) {
      const hit = sources.map(payload => familyRows(payload).find(row => row.family === family)).flat()
        .find(row => row && row.family === family)
      if (!hit) { offenders.push(`${docName}: 族 ${family} 在 JSON 里没有对应条目`); continue }
      // 生成器对 `module/*` 有一处**合法的**现算分岔：整族落表行都被机械降级（上游测试源码/生成物）时，
      // 判决书那一格改印 `[-]` + 那句「机械降级：…」，而 JSON 的 `families` 仍留母族档与长判词
      // （见 `write_verdict_doc` 里 `family.startswith("module/") and tier == " "` 那一段）。
      // 所以这一格允许等于两者之一 —— 但只允许这两个精确串，别的手改照样红。
      const rowsAllDowngraded = sources.some(payload => payload.rows.some(r => r.family === family))
        && sources.some(payload => {
          const rows = payload.rows.filter(r => r.family === family)
          return rows.length > 0 && rows.every(r => r.tier === '-')
        })
      const degraded = family.startsWith('module/') && rowsAllDowngraded
        ? [`| \`${family}\` | \`[-]\` | 机械降级：本族落表行全部是上游测试源码/生成物（逐类理由见 \`*_verdict_table.md\` 的逐类表）。 | ${hit.count} |`]
        : []
      const expected = `| \`${family}\` | \`[${hit.tier}]\` | ${hit.reason} | ${hit.count} |`
      if (!doc.includes(expected) && !degraded.some(cell => doc.includes(cell))) {
        offenders.push(`${docName}: ${family} 那格与 JSON 不符（磁盘判词 ${reason.length} 字 / 真源 ${hit.reason.length} 字）`)
      }
    }
  }
  assert.deepEqual(offenders, [], `族级判决书与判词真源脱钩：\n${offenders.join('\n')}`)
})

// ── ② 真源（FAMILIES）↔ 全部生成物：唯一能核到 FAMILIES 本体的口径 ──────────────────
test('python scripts/verdict_table.py --check 必须一致，且它自己一个字节都不写', (t) => {
  if (!PY) { t.skip('这台机器上没有 python：判词真源的字节级核对没法做（CI 必须装 python 才覆盖得到这条）'); return }
  const first = verdictPy(['--check'])
  assert.equal(first.status, 0, `--check 应当退出 0，实际 ${first.status}\n--- stdout ---\n${first.stdout}\n--- stderr ---\n${first.stderr}`)
  const match = /一致 (\d+) \/ (\d+) 条产物/.exec(first.stdout)
  assert.ok(match, `--check 没打印「一致 N / M 条产物」的结论：\n${first.stdout}`)
  assert.equal(match[1], match[2], `${match[2]} 条产物里有 ${Number(match[2]) - Number(match[1])} 条与真源不符`)
  assert.ok(Number(match[2]) >= 7, `默认比对（execution + xdebugger）应当覆盖 7 条产物，实际 ${match[2]}`)
  // 比对档不许改动被核的对象（2026-10-05 事故：验收员把只读复核当写盘跑了）。
  const names = [...first.stdout.matchAll(/(?:一致|不一致|仅行尾不同|磁盘上没有该文件)\s+(docs\/inventory\/[^\s（]+)/g)].map(m => m[1])
  assert.ok(names.length >= 7, `--check 输出里解析不出被比对的产物清单：\n${first.stdout}`)
  const onDisk = names.filter(name => existsSync(join(root, name)))
  const before = new Map(onDisk.map(name => [name, digest(read(join(root, name)))]))
  const second = verdictPy(['--check'])
  assert.equal(second.status, 0, '第二次 --check 也应当是绿的')
  for (const [name, sum] of before) {
    assert.equal(digest(read(join(root, name))), sum, `${name} 被 --check 改动了：比对档必须只读`)
  }
  assert.ok(onDisk.length >= 7, `被比对的产物应当都在磁盘上，实际 ${onDisk.length}/${names.length}`)
})

// ── ②b T-4 扩面：默认 `--check` 只覆盖 execution+xdebugger 那 7 条产物，
//      `--check platform_rest` 这类**逐域**红以前只有跑到它的人才看得见（两条 lane 各撞过一次）。
//      这里把脚本**能产出的每一族**都拉进门：域名不写死，从 `docs/inventory/<域>.txt` +
//      `<域>_signals.json` 的配对里现算，所以「新增一族却没人给它跑门」这条路被封死。
//      两个同名产物属主的域（settings-run = `enumerate_inventory.py` 的逐类事实表、vcs = 手写逐类账本，
//      都被 b10/b11 当判据读）**不是**本生成器的产物：脚本自己拒认领，这里核的是「它必须明说属主」
//      这条声明还在、且那份 json 的 schema 确实不是 `families`+`rows` —— 谁把它转成本生成器的产物，
//      这条就会红并要求把它搬进 OWNED_DOMAINS 真跑一遍比对。
const GUARDED_DOCS = ['actions', 'find-diff']      // 判决书有手写 §G：比对只核该域 json+md（2 条）
const FOREIGN_DOMAINS = ['settings-run', 'vcs']    // 同名产物属主是别的工具/手写账本
const UNGUARDED_OWNED = ['execution', 'xdebugger', 'platform_rest', 'projectviews', 'daemon']

function domainsOnDisk() {
  const names = readdirSync(inv('.')).filter(n => n.endsWith('.txt')).map(n => n.slice(0, -4))
  return names.filter(name => existsSync(inv(`${name}_signals.json`))).sort()
}

test('T-4 扩面：脚本能产出的每一族都要跑自己的 --check，且必须是绿的', (t) => {
  if (!PY) { t.skip('这台机器上没有 python，逐域比对跑不了'); return }
  const discovered = domainsOnDisk()
  const expected = [...UNGUARDED_OWNED, ...GUARDED_DOCS, ...FOREIGN_DOMAINS].sort()
  assert.deepEqual(discovered, expected,
    `docs/inventory 里「有 .txt 且有 _signals.json」的域集合变了：\n盘上 = ${discovered.join(', ')}\n门里 = ${expected.join(', ')}\n`
    + '新增一族 ⇒ 把它加进本文件顶部的清单；删一族 ⇒ 同步删掉（这条不许放宽成「存在即可」）')

  const offenders = []
  for (const domain of UNGUARDED_OWNED) {
    const run = verdictPy(['--check', domain])
    const hit = /一致 (\d+) \/ (\d+) 条产物/.exec(run.stdout)
    if (run.status !== 0 || !hit || hit[1] !== hit[2] || hit[2] !== '3') {
      offenders.push(`${domain}：status=${run.status} 结论=${hit ? hit[0] : '（没打印「一致 N / M」）'}\n${run.stdout.slice(-1200)}`)
    }
  }
  for (const domain of GUARDED_DOCS) {
    const run = verdictPy(['--check', domain])
    const hit = /一致 (\d+) \/ (\d+) 条产物/.exec(run.stdout)
    // 手写 §G 的判决书不参与比对 ⇒ 该域只有 2 条产物（json + 逐类 md），且必须打印那句「不参与比对」。
    if (run.status !== 0 || !hit || hit[1] !== hit[2] || hit[2] !== '2' || !/有手写 §G 逐类表：判决书那条不参与比对/.test(run.stdout)) {
      offenders.push(`${domain}（手写 §G 护栏档）：status=${run.status} 结论=${hit ? hit[0] : '（没打印「一致 N / M」）'}\n${run.stdout.slice(-1200)}`)
    }
  }
  assert.deepEqual(offenders, [], `逐域 --check 有红：\n${offenders.join('\n---\n')}`)
})

test('T-4 扩面：非本生成器产物的两个域必须由脚本明说属主（不许悄悄当绿放过）', (t) => {
  if (!PY) { t.skip('这台机器上没有 python，属主声明核不了'); return }
  for (const domain of FOREIGN_DOMAINS) {
    const payload = JSON.parse(read(inv(`${domain}_verdict_table.json`)))
    assert.ok(!('families' in payload) || !('rows' in payload),
      `${domain}_verdict_table.json 已经是本生成器的 schema 了 ⇒ 把它从 FOREIGN_DOMAINS 搬进 OWNED 清单真跑比对`)
    const run = verdictPy(['--check', domain])
    assert.equal(run.status, 0, `${domain} 的 --check 不该红（它不认领这个域）：\n${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, new RegExp(`${domain}_verdict_table\\.json 不属于本生成器的产物（属主：`),
      `${domain}：脚本必须打印「不属于本生成器的产物 + 属主」，不能静默 0/0`)
    assert.match(run.stdout, /一致 0 \/ 0 条产物/, `${domain}：不认领 ⇒ 比对集合必须是空的 0/0，不能假装核过`)
    const write = verdictPy([domain])
    assert.equal(write.status, 1, `${domain}：写盘档必须拒绝覆盖别人的账本（实际 ${write.status}）\n${write.stdout}`)
    assert.match(write.stdout, /拒绝生成/, `${domain}：拒绝要打印理由`)
  }
})


// ── ③ 反向验证：改一个字门必须红，改回必须绿（在 build/ 的副本里跑，不碰仓库）────────
const SCRATCH_FILES = ['scripts/verdict_table.py', 'scripts/check_verdict_tables.py',
  'docs/inventory/execution.txt', 'docs/inventory/execution_signals.json',
  'docs/inventory/xdebugger.txt', 'docs/inventory/xdebugger_signals.json']
const MUTATE_FROM = '没有 JVM 对象模型可移植；用户可见面已在上面几族覆盖'
const MUTATE_TO = '真 JVM 对象模型可移植；用户可见面已在上面几族覆盖'

// 副本目录名带 pid + 随机后缀：本仓是多 lane 并行编辑 `scripts/verdict_table.py` 的，
// 同一个 `node --test tests/verdict-table-check.test.mjs` 可能被两条 lane 同时跑。
// 固定名（`verdict-table-check-t4` 那种）会让 A 的 `rmSync` 把 B 正在用的目录连根拔掉 ——
// 在 Windows 上表现为 EPERM 残留或「生成到一半的判决书」被读走（torn read，见 2026-10-06 实测）。
// 唯一名之后，两条 lane 的副本互不相干，`--check` 也就稳定了。
function scratchName(name) {
  return `verdict-table-check-${name}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

function makeScratch(name) {
  const scratch = join(root, 'build', scratchName(name))
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(join(scratch, 'scripts'), { recursive: true })
  mkdirSync(join(scratch, 'docs', 'inventory'), { recursive: true })
  for (const rel of SCRATCH_FILES) {
    copyFileSync(join(root, ...rel.split('/')), join(scratch, ...rel.split('/')))
  }
  return scratch
}
const cleanScratch = scratch => rmSync(scratch, { recursive: true, force: true })

test('反向验证：FAMILIES 改一个字 ⇒ --check 必须红；改回 ⇒ 必须绿', (t) => {
  if (!PY) { t.skip('这台机器上没有 python，反向验证跑不了（不是放松断言：① 那条与它无关）'); return }
  const scratch = makeScratch('mutation')
  try {
    const src = join(scratch, 'scripts', 'verdict_table.py')
    const original = read(src)
    assert.ok(original.includes(MUTATE_FROM), '变异锚点在 FAMILIES 里找不到了（这条测试自己失效，必须改）')
    // 基线：副本先按真源生成一次，--check 必须是绿的（否则下面的红就不是「改一个字」造成的）。
    assert.equal(verdictPy(['execution', 'xdebugger'], scratch).status, 0, '副本里按真源生成应当成功')
    assert.equal(verdictPy(['--check'], scratch).status, 0, '副本的基线 --check 必须是绿的')
    // 改一个字（exec/misc 的判词）。
    writeFileSync(src, original.replace(MUTATE_FROM, MUTATE_TO), 'utf8')
    assert.notEqual(read(src), original, '变异没落进副本')
    const bad = verdictPy(['--check'], scratch)
    assert.equal(bad.status, 1, `改一个字之后 --check 必须非零退出，实际 ${bad.status}\n${bad.stdout}`)
    const drift = /不一致 (\d+) \/ (\d+) 条产物/.exec(bad.stdout)
    assert.ok(drift, `红的输出里必须点名「不一致 N / M 条产物」：\n${bad.stdout}`)
    assert.ok(Number(drift[1]) >= 1, '至少一条产物要被判成不一致')
    assert.match(bad.stdout, /exec\/misc/, '差异行里必须能看到被动的那一族')
    // 改回 ⇒ 绿（证明这条门不是单向的）。
    writeFileSync(src, original, 'utf8')
    const back = verdictPy(['--check'], scratch)
    assert.equal(back.status, 0, `改回原文之后 --check 必须回绿，实际 ${back.status}\n${back.stdout}`)
  } finally {
    cleanScratch(scratch)
  }
})

// ── ⑤ T-4 扩面的反向验证：`PLATFORM_FAMILIES` / `MODULE_JUDGMENTS` 里的漂移**默认档看不见**。
// 为什么偏偏挑这两张表：`main()` 只在 `domain == "platform_rest"` 时才把 `PLATFORM_FAMILIES`
// 并进来（见 `family_of` 的 `platform_sub`），`MODULE_JUDGMENTS` 更是只对 B12 的 `module/*` 族生效
// ⇒ 改这两处之一，`python scripts/verdict_table.py --check`（默认 = execution+xdebugger 那 7 条）
// 依旧全绿，只有 `--check platform_rest` 会红。以前这条红没人看得见；②b 把它拉进了 npm test。
// 这里在 `build/`（已 gitignore）的副本里真造一处不一致 ⇒ 逐域档必须红、默认档必须还是绿的（= 那个洞的形状）、
// 还原后必须回绿。探针 token 在**运行时**拼装（`'LEDGER' + 'FIX-PROBE'`），源码里不出现那个连写字面量 ——
// 否则收工的全树逐字扫描会把这条门的判据自己当成残留（dapclose/vcsloge 的连字符留痕是同一号问题的既有解法）。
const T4_FILES = ['scripts/verdict_table.py', 'scripts/check_verdict_tables.py',
  'docs/inventory/platform_rest.txt', 'docs/inventory/platform_rest_signals.json',
  'docs/inventory/execution.txt', 'docs/inventory/execution_signals.json',
  'docs/inventory/xdebugger.txt', 'docs/inventory/xdebugger_signals.json']
const T4_PROBE = 'LEDGER' + 'FIX-PROBE'
const T4_PROBES = [
  { label: 'PLATFORM_FAMILIES 的 lp/completion', domain: 'platform_rest',
    from: '补全（`CompletionContributor`/`CompletionService`',
    to: `补全（${T4_PROBE} \`CompletionContributor\`/\`CompletionService\`` },
  { label: 'MODULE_JUDGMENTS 的 progress（msgverdict 收编进来的那张表）', domain: 'platform_rest',
    from: 'B 堆默认档**误判', to: `B 堆默认档**${T4_PROBE} 误判` },
]

test('反向验证 ⑤：B12 专属判词表改一处 ⇒ 逐域档红、默认档仍绿（那个洞的形状），还原 ⇒ 回绿', (t) => {
  if (!PY) { t.skip('这台机器上没有 python，逐域反向验证跑不了'); return }
  const scratch = join(root, 'build', scratchName('t4'))
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(join(scratch, 'scripts'), { recursive: true })
  mkdirSync(join(scratch, 'docs', 'inventory'), { recursive: true })
  for (const rel of T4_FILES) copyFileSync(join(root, ...rel.split('/')), join(scratch, ...rel.split('/')))
  try {
    // 基线：副本里按真源生成一次，逐域与默认两档都必须是绿的（否则下面的红不是「改一处」造成的）。
    assert.equal(verdictPy(['platform_rest'], scratch).status, 0, '副本里生成 platform_rest 应当成功')
    assert.equal(verdictPy(['execution', 'xdebugger'], scratch).status, 0, '副本里生成 execution+xdebugger 应当成功')
    assert.equal(verdictPy(['--check', 'platform_rest'], scratch).status, 0, '基线逐域 --check platform_rest 必须是绿的')
    assert.equal(verdictPy(['--check'], scratch).status, 0, '基线默认 --check 必须是绿的')
    const src = join(scratch, 'scripts', 'verdict_table.py')
    const original = read(src)
    for (const probe of T4_PROBES) {
      assert.equal(original.includes(probe.from), true, `探针锚点找不到了（这条测试自己失效）：${probe.label}`)
      writeFileSync(src, original.replace(probe.from, probe.to), 'utf8')
      assert.notEqual(read(src), original, `探针没落进副本：${probe.label}`)
      const perDomain = verdictPy(['--check', probe.domain], scratch)
      assert.equal(perDomain.status, 1, `${probe.label}：逐域档必须非零退出，实际 ${perDomain.status}\n${perDomain.stdout.slice(-1500)}`)
      const drift = /不一致 (\d+) \/ (\d+) 条产物/.exec(perDomain.stdout)
      assert.ok(drift && Number(drift[1]) >= 1, `${probe.label}：红的输出必须点名「不一致 N / M 条产物」：\n${perDomain.stdout.slice(-1500)}`)
      assert.match(perDomain.stdout, new RegExp(`${probe.domain}_verdict_table\\.json`),
        `${probe.label}：差异清单里必须点到该域的产物文件`)
      const viaDefault = verdictPy(['--check'], scratch)
      assert.equal(viaDefault.status, 0,
        `${probe.label}：这条探针本该证明「默认档看不见 B12 专属表的漂移」——默认档却红了，说明它现在也覆盖了这个域，`
        + '此时应把本条断言按实况改掉（不许删）\n' + viaDefault.stdout.slice(-1200))
      writeFileSync(src, original, 'utf8')
      assert.equal(verdictPy(['--check', probe.domain], scratch).status, 0, `${probe.label}：改回原文之后逐域档必须回绿`)
    }
  } finally {
    cleanScratch(scratch)
  }
})

// ── ④ 「手写 §G 逐类表」护栏仍然挡着（不许为了让产物变绿而放宽）─────────────────────
test('§G 护栏仍然有效：判决书里有手写 §G ⇒ 写盘档必须拒绝且不动磁盘', (t) => {
  if (!PY) { t.skip('这台机器上没有 python，护栏行为核不了'); return }
  const scratch = makeScratch('guard')
  try {
    const docPath = join(scratch, 'docs', 'inventory', 'verdict-stub.md')
    writeFileSync(join(scratch, 'docs', 'inventory', 'stub.txt'), 'platform/whatever/src/com/intellij/Foo.java\n', 'utf8')
    writeFileSync(join(scratch, 'docs', 'inventory', 'stub_signals.json'), '{"rows":[]}\n', 'utf8')
    const handwritten = '# 判决：stub\n\n## G. 逐条总表\n\n| 类 | 档 | 依据 |\n|---|---|---|\n| `Foo` | `[~]` | 手写的逐类判决 |\n'
    writeFileSync(docPath, handwritten, 'utf8')
    const run = verdictPy(['stub'], scratch)
    assert.equal(run.status, 1, `含手写 §G 的判决书，写盘档必须 exit 1，实际 ${run.status}\n${run.stdout}`)
    assert.match(run.stdout, /拒绝生成/, '必须打印拒绝原因（不是静默失败）')
    assert.equal(read(docPath), handwritten, '护栏拒绝之后那份手写判决书必须一字节不动')
    // 比对档（--check/--dry-run）不写盘，只把手写那份从比对里摘出去，真仓产物不受影响。
    const dry = verdictPy(['--dry-run', 'stub'], scratch)
    assert.equal(read(docPath), handwritten, '--dry-run 也不许碰手写判决书')
    assert.match(dry.stdout + dry.stderr, /手写|不核|§G|没有该文件|不一致/, `--dry-run 要说清那份判决书没参与比对：\n${dry.stdout}`)
  } finally {
    cleanScratch(scratch)
  }
  // 仓库里那两份手写逐类表还在（有人 --force 覆盖了会立刻在这里红）。
  for (const doc of ['verdict-find-diff.md', 'verdict-actions.md', 'verdict-settings-run.md']) {
    if (!existsSync(inv(doc))) continue
    assert.ok(read(inv(doc)).includes('## G. 逐条总表'), `${doc} 的手写 §G 逐类表不见了（被覆盖过？）`)
  }
})
