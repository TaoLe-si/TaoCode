// B9 判决（`settings-run` 域 3247 类）自身的门控。
//
// 这份判决要防的假判词有三类：
//   ① 拿「类名在本仓注释里出现过」当「已移植」；
//   ② 判了 `[x]`/`[~]` 却指不到磁盘上真实存在的本仓文件；
//   ③ 与 B7（find/diff 域）重叠的 630 类：说「继承」却档位不一致，或档位一致却没人核对过。
// 所以本文件不看散文，只看 §G 那张逐条表 + 与 B7 §G 的逐条交叉核对。
//
// 与 `tests/b11-verdict.test.mjs` 的分工（2026-10-06 对账，两份门禁查的是**同一份文档**）：
//   · 和数/已判行数：b11 逐档核 + 核「当前已判 N 行」，这里再核一遍并额外要求**每档非 0**；
//     头部那句允许「带档位标签」与「不带标签」两种同族合法写法（原来只认后者，比文档写法更死）。
//   · `[x]`/`[~]` 落点：这里用更宽的引用正则（反引号内外都抓），下限由数据推导；
//     「`[~]` 必须写缺：」「`[-]` 必须带六种标记并与机械事实互证」两条只在 b11 里跑（更强的那一组）。
//   · 测试源码/生成码：b11 按枚举路径正向强制 `[-]`，这里按类名+路径的启发式再兜一遍。
//
// 枚举基准：docs/inventory/settings-run.txt（scripts/enumerate_inventory.py 的产物，3247 行）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// `B9_VERDICT` 只为**反向验证**存在：把改坏的副本（绝对路径）喂进来，确认「头部数字漂移 /
// 假引用 / 同档不声明继承 / 档位乱改」各自都能变红。默认读仓库里的真表。
const read = relative => readFileSync(isAbsolute(relative) ? relative : join(root, relative), 'utf8')

const listing = read('docs/inventory/settings-run.txt').split('\n').map(line => line.trim()).filter(Boolean)
const verdict = read(process.env.B9_VERDICT || 'docs/inventory/verdict-settings-run.md')

/**
 * §G 表行：`| \`类\` | \`上游路径\` | \`[x]\` | 依据 |`。
 * 只取 `## G. 逐条总表` 之后的部分，避免把 §A–§F 的说明表算进来。
 */
export function appendixRows(text) {
  const section = text.split('## G. 逐条总表')[1]
  assert.ok(section, '判决文件缺 §G 逐条总表')
  const rows = []
  const pattern = /^\| `([^`]+)` \| `([^`]+)` \| `(\[[x~ -]\])` \| (.*) \|$/gm
  let match
  while ((match = pattern.exec(section)) !== null) {
    rows.push({ name: match[1], path: match[2], verdict: match[3], why: match[4] })
  }
  return rows
}

/** B7 的 §G（find + diff 630 类）：继承来的档位必须与它一致。 */
export function b7Rows() {
  const text = read('docs/inventory/verdict-find-diff.md')
  const section = text.split('## G. 逐条总表')[1]
  assert.ok(section, 'B7 判决缺 §G（docs/inventory/verdict-find-diff.md）')
  const out = new Map()
  const pattern = /^\| `([^`]+)` \| `([^`]+)` \| `(\[[x~ -]\])` \| (.*) \|$/gm
  let match
  while ((match = pattern.exec(section)) !== null) {
    out.set(match[2], { name: match[1], verdict: match[3], why: match[4] })
  }
  return out
}

const rows = appendixRows(verdict)

/** 依据列里出现的本仓文件（去掉 `:12` / `:12-15` 这种行号后缀）。 */
function repoFiles(why) {
  return [...why.matchAll(/`?((?:src|native)\/[A-Za-z0-9_./-]+?\.(?:ts|cpp|hpp|vue|css))(?::\d+(?:-\d+)?)?`?/g)]
    .map(match => match[1])
}

const isTestSource = row =>
  /testsources|\/test\/|\/tests\/|teststrc|\/testdata\//i.test(row.path) || /(?:Test|Tests|TestCase)$/.test(row.name)

const isGenerated = row =>
  /\/gen\/|\/pico-gen\/|\/testEntities\/|\/resources\//.test(row.path) || /(^|\/)package-info\.(java|kt)$/.test(row.path)

test('枚举基准 3247 类，§G 逐条覆盖：每条路径恰有一行，类名与路径都对得上', () => {
  assert.equal(listing.length, 3247, `清单应有 3247 行，实为 ${listing.length}`)
  assert.equal(rows.length, 3247, `§G 应有 3247 行，实为 ${rows.length}`)
  const expected = new Map()
  for (const entry of listing) {
    const name = entry.split('/').pop().replace(/\.(java|kt)$/, '')
    expected.set(`${name}\u0000${entry}`, 0)
  }
  for (const row of rows) {
    const key = `${row.name}\u0000${row.path}`
    assert.ok(expected.has(key), `§G 多了一行或路径不对：${row.name} @ ${row.path}`)
    expected.set(key, expected.get(key) + 1)
  }
  const duplicated = [...expected].filter(([, count]) => count > 1).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(duplicated, [], `§G 里出现多次的类：${duplicated.join(', ')}`)
  const missing = [...expected].filter(([, count]) => count === 0).map(([key]) => key.split('\u0000')[0])
  assert.deepEqual(missing, [], `§G 漏了这些类：${missing.join(', ')}`)
})

test('四档相加等于总数，且文档头部的和数与表一致', () => {
  const count = letter => rows.filter(row => row.verdict === letter).length
  const x = count('[x]'), partial = count('[~]'), todo = count('[ ]'), na = count('[-]')
  assert.equal(x + partial + todo + na, 3247, `四档相加 ${x + partial + todo + na} ≠ 3247`)
  // 每一档都不能是 0（0 意味着整族没判）
  assert.ok(x > 0 && partial > 0 && todo > 0 && na > 0, `有档位为 0：x=${x} ~=${partial} [ ]=${todo} -=${na}`)
  // 头部那句的两种**同族合法写法**都要收：带档位标签的 `四档合计 **[x] a + [~] b + [ ] c + [-] d = N**`
  // （本域文档 + `tests/b11-verdict.test.mjs` 用的就是这一种）和不带标签的 `四档合计 **a + b + c + d = N**`
  // （`tests/b10-verdict.test.mjs`、`tests/b12-verdict.test.mjs` 那两份文档用的写法）。
  // 原来这里只认后一种，且把 a/b/c/d 直接拼进正则 ⇒ 门禁比文档的合法排版更死：
  // 2026-10-06 复核过，文档当时的 `6 + 46 + 2927 + 268 = 3247` 与 §G 实数逐档相等、总数也对，却照样红。
  // 改后仍然逐个核数：四个数字必须与 §G 逐条统计**分别相等**，总数必须是 3247，四档相加必须等于它。
  // 反向验证：把头部任一数字改成 ±1 → 本用例红（见 `docs/batch-2026-10-06-verdict-reconcile.md`）。
  const labeled = verdict.match(/四档合计 \*\*\[x\] (\d+) \+ \[~\] (\d+) \+ \[ \] (\d+) \+ \[-\] (\d+) = (\d+)\*\*/)
  const plain = verdict.match(/四档合计 \*\*(\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)\*\*/)
  const header = labeled ?? plain
  assert.ok(header, '头部要么写「四档合计 **[x] a + [~] b + [ ] c + [-] d = N**」，要么写「四档合计 **a + b + c + d = N**」')
  assert.deepEqual(
    [Number(header[1]), Number(header[2]), Number(header[3]), Number(header[4])],
    [x, partial, todo, na],
    `头部和数没跟着改：头部 ${header[1]} + ${header[2]} + ${header[3]} + ${header[4]}，§G 实为 ${x} + ${partial} + ${todo} + ${na}`,
  )
  assert.equal(Number(header[5]), 3247, `头部总数写的是 ${header[5]}，枚举基准是 3247`)
  assert.equal(x + partial + todo + na, Number(header[5]), '头部四档相加不等于头部总数')
  const counts = { x, partial, todo, na }
  return counts
})

test('每个 [x]/[~] 行的依据必须指到真实存在的 src/ 或 native/ 文件（防「注释里提过就算移植」）', () => {
  const referenced = []
  for (const row of rows) {
    if (row.verdict !== '[x]' && row.verdict !== '[~]') continue
    const files = repoFiles(row.why)
    assert.ok(files.length > 0, `${row.name} 判了 ${row.verdict} 却没指到任何本仓文件`)
    referenced.push(...files)
  }
  // 这条判据自身要有意义：被核对的引用不能只有一两条。
  // 原下限写死 `>= 1000`，那是照别的域（每条 [x]/[~] 行平均引用十几条文件）拍的数：
  // 本域 §G 的 [x]+[~] 改判前只有 6+46 = 52 行，逐行至少 1 条 ⇒ 数学上永远够不到 1000，
  // 一条只能靠「把文档写歪」才能过的死数（同一份文档在 `tests/b11-verdict.test.mjs` 里
  // 用的是数据推导的下限，那边一直是绿的 —— 两份门禁对同一文档的期望互相矛盾本身就是缺陷）。
  // 现在按数据推导：引用条数 >= [x]/[~] 行数（每行至少一条被核对的引用），
  // 并另加「不同落点文件数 >= 40」防空转（实测 80 个不同文件；同族 b10 用 30、b12 用 400）。
  // 假引用/漏引用仍由上面的逐行 assert 与下面的 existsSync 拦（反向验证：把某个落点改成
  // `src/doesNotExist.ts` → 本用例红）。
  const judgedBehavior = rows.filter(row => row.verdict === '[x]' || row.verdict === '[~]').length
  assert.ok(referenced.length >= judgedBehavior, `被核对的引用（${referenced.length}）比 [x]/[~] 行数（${judgedBehavior}）还少`)
  assert.ok(new Set(referenced).size >= 40, `落点只有 ${new Set(referenced).size} 个不同文件，覆盖太薄（这条判据会空转）`)
  const missing = referenced.filter(path => !existsSync(join(root, path)))
  assert.deepEqual(missing, [], `判决引用了不存在的文件：${[...new Set(missing)].join(', ')}`)
})

test('上游测试源码一律 [-]（路径在测试源码集里，或类名是 *Test/*Tests/*TestCase）', () => {
  const tests = rows.filter(isTestSource)
  assert.ok(tests.length >= 100, `测试源码行只有 ${tests.length} 条，口径没跑通`)
  for (const row of tests) {
    assert.equal(row.verdict, '[-]', `${row.name}（${row.path}）是上游测试源码，必须判 [-]，实为 ${row.verdict}`)
  }
})

test('生成物 / 夹具 / package-info 一律 [-]', () => {
  const gens = rows.filter(isGenerated)
  assert.ok(gens.length >= 30, `生成物行只有 ${gens.length} 条`)
  for (const row of gens) {
    assert.equal(row.verdict, '[-]', `${row.name} 是生成物/夹具，必须判 [-]，实为 ${row.verdict}`)
  }
})

test('每个 [-] 与 [ ] 行都写了具体理由，且 [-]/[ ] 不许假装已有落点', () => {
  for (const row of rows) {
    if (row.verdict === '[-]') {
      // 24 字是同一份文档在 `tests/b11-verdict.test.mjs` 里的下限；原来这里写 12，
      // 两个门禁对同一文档要求不一致 ⇒ 取更强的那个。
      assert.ok(row.why.length >= 24, `${row.name} 的 [-] 理由太空：${row.why}`)
      assert.ok(!/已有 (src|native)\//.test(row.why), `${row.name} 判 [-] 却写着已有本仓落点`)
    }
    if (row.verdict === '[ ]') {
      // 原来只要求 `TODO` 开头。本域 §G 的合法措辞是「证据：… 从未出现；缺：…」（那是
      // `tests/b11-verdict.test.mjs` 强制要求的「缺：」写法），本轮又新增了
      // 「B7 判 [-]；…」这一族跨域核开头 ⇒ 旧正则会把整族合法行判红（2927 行全灭）。
      // 这里不放松语义，改为三段齐验：状态前缀 + 缺哪一环 + 不许假称已有落点。
      // 反向验证：去掉「缺：」→ 红；把落点写成「已有 src/xxx.ts」→ 红；开头换成散文 → 红。
      assert.ok(
        /^(证据：|TODO|B7 判 \[-\])/u.test(row.why),
        `${row.name} 的 [ ] 行要以「证据：」「TODO」或「B7 判 [-]」开头说明缺什么`,
      )
      assert.ok(/缺：|还差/u.test(row.why), `${row.name} 判 [ ] 却没写「缺：」——未移植要说清差哪一环`)
      assert.ok(
        /从未出现|无对应|没有|未移植|不覆盖|无法核实|无实现落点|无落点|同名不同义|只出现在本仓对照注释/u.test(row.why),
        `${row.name} 判 [ ] 却没交代本仓缺在哪一侧`,
      )
      assert.ok(!/已有 (src|native)\//.test(row.why), `${row.name} 判 [ ] 却写着已有本仓落点`)
    }
  }
})

test('每个 [~] 行都写清「还差什么」（缺/还差/未/没有…），或明确标注继承 B7', () => {
  const gapPattern = /缺|还差|未|没有|不是|差异|只落了|不含|只做|继承 B7/
  const silent = rows.filter(row => row.verdict === '[~]' && !gapPattern.test(row.why))
  assert.deepEqual(silent.map(row => row.name), [], `这些 [~] 行没写缺口：${silent.map(r => r.name).join(', ')}`)
})

/**
 * 与 B7 的交叉核对。本域清单（`settings-run.txt`）与 find/diff 域清单重叠 630 个上游路径，
 * 所以这 630 行**逐条**核，不再只核「嘴上说继承」的那些行：
 *   · 档位与 B7 相同 ⇒ 必须就地写「继承 B7 判决」，否则一致只是巧合，没人核对过；
 *   · 档位与 B7 不同 ⇒ 只允许三种机械可核的漂移：
 *     (a) B7 判 `[-]` 而本域的 `[-]` 六个理由标记核对不上（§B 收紧：接口/抽象类按行为判，
 *         控件本体必须点名本仓 DOM 落点）⇒ 本行必须写「B7 判 [-]」并保留行为档；
 *     (b) B9 判 `[-]` 而 B7 判行为档，且本行路径确实落在测试源码集/生成目录里（机械硬标记优先）；
 *     (c) **已登记的跨批升档未同步**（`REGISTERED_DRIFT`，2026-10-06 b89 新增）：别的批次把 B7 那一行
 *         按行为升了档，而 B9 的镜像行还停在旧档，且 B9 那张文档不在本次可改面 ⇒ 逐条登记 +
 *         证据机械复核（见下面那张表的注释），漂移修好后必须删条目，否则本用例红。
 * 原来的写法是「只核 why 里出现『继承 B7 判决』的行 + 下限 600 条」，而文档一条都没声明 ⇒
 * 实际交叉核对 0 条（下限把它判红，等于这条判据从来没跑过）；现在核对数由枚举重叠数决定，
 * 只增不减。反向验证：把某同档行的「继承 B7 判决」删掉 → 红；把某行档位乱改成 [~] → 红。
 */

// —— 上面 (c) 档用的登记表：不是豁免名单，是「带证据、必须仍然成立、修好就失效」的待办 ——
const UPSTREAM_ROOT = process.env.B9_UPSTREAM || 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const fileCache = new Map()
const linesOf = relative => {
  if (!fileCache.has(relative)) {
    let text = null
    try { text = read(relative).split('\n') } catch { text = null }
    fileCache.set(relative, text)
  }
  return fileCache.get(relative)
}
const upstreamAvailable = existsSync(UPSTREAM_ROOT)
const upstreamLines = relative => linesOf(join(UPSTREAM_ROOT, relative))
/** 把一条 `路径:行号` 证据钉成「那一行必须含这个符号」。 */
const EVIDENCE_SHAPE = ['file', 'line', 'token']
function checkEvidence(name, evidence, source, label) {
  for (const item of evidence) {
    assert.deepEqual(Object.keys(item).sort(), EVIDENCE_SHAPE,
      `${name}: ${label}证据 ${JSON.stringify(item)} 必须是 {file, line, token} 三件套（不许只写「见某文件」）`)
    assert.ok(Number.isInteger(item.line) && item.line > 0, `${name}: ${label}证据的行号不是正整数：${item.file}:${item.line}`)
    assert.ok(item.token.length >= 6, `${name}: ${label}证据的符号太短（${item.token}），锚不住那一行`)
    const text = source(item.file)
    assert.ok(text, `${name}: ${label}证据读不到文件 ${item.file}`)
    assert.ok(text.length >= item.line,
      `${name}: ${label}证据 ${item.file}:${item.line} 超出文件长度（${text.length} 行）`)
    const line = text[item.line - 1]
    assert.ok(line.includes(item.token),
      `${name}: ${label}证据 ${item.file}:${item.line} 那一行是「${line.trim().slice(0, 70)}」，不含钉住的符号「${item.token}」`)
  }
}

/**
 * 已登记的跨域漂移。每条都由本用例逐条机械复核：
 *   ① B7/B9 的档位必须仍然等于登记的这一对（任一侧再改判 ⇒ 登记失效 ⇒ 红，逼来人重登记或删条目）；
 *   ② B9 那一行必须仍然写着「继承 B7 判决」（它是 B7 的镜像行，不是本域的独立判决）；
 *   ③ `repo` 里每条 `文件:行号` 都要在磁盘上、且那一行仍含钉住的符号；
 *   ④ `upstream` 里每条 `路径:行号` 同样逐行核（基准树不在本机时按本仓惯例跳过这一小步，①②③⑤照跑）；
 *   ⑤ `batch` 要写清是哪一批升的档、`pending` 要指向一份**真实存在**的 wiring 请求（没同步的原因与补丁在哪儿）。
 * 没被任何漂移命中的条目也判红 ⇒ 镜像行修好后，这张表必须跟着删干净。
 */
const REGISTERED_DRIFT = [
]

test('与 B7 的 630 条重叠类逐条交叉核对（同档必须声明继承，异档必须给本域机械理由）', () => {
  const b7 = b7Rows()
  assert.equal(b7.size, 630, `B7 §G 应有 630 行，实为 ${b7.size}`)
  const shared = rows.filter(row => b7.has(row.path))
  assert.ok(shared.length >= 600, `与 B7 的枚举重叠只有 ${shared.length} 条，交叉核对覆盖太薄`)
  let declared = 0
  let justified = 0
  let registered = 0
  const hitDrift = new Set()
  assert.deepEqual(
    REGISTERED_DRIFT.map(item => item.path).filter((path, index, all) => all.indexOf(path) !== index),
    [], '登记表里同一个上游路径登记了两遍（重复条目会让漂移只核一次）')
  for (const row of shared) {
    const upstream = b7.get(row.path)
    assert.equal(upstream.name, row.name, `${row.path} 在两份判决里类名不一致`)
    if (upstream.verdict === row.verdict) {
      assert.ok(
        row.why.includes('继承 B7 判决'),
        `${row.name} 与 B7 同判 ${row.verdict}，却没写「继承 B7 判决」⇒ 这条一致没有任何核对来源`,
      )
      declared += 1
      continue
    }
    if (upstream.verdict === '[-]') {
      assert.ok(
        /B7 判 \[-\]/u.test(row.why),
        `${row.name}: B7 判 [-]、B9 判 ${row.verdict}，却没写「B7 判 [-]」说明本域为何不沿用 [-]`,
      )
      assert.ok(
        row.verdict === '[ ]' || row.verdict === '[~]' || row.verdict === '[x]',
        `${row.name}: 漂移只能落在行为档，实为 ${row.verdict}`,
      )
      justified += 1
      continue
    }
    if (row.verdict === '[-]' && (isTestSource(row) || isGenerated(row))) {
      assert.ok(
        /\[(上游测试类|上游测试源码集|上游生成物|无声明体 package-info)/u.test(row.why),
        `${row.name}: B7 判 ${upstream.verdict}、B9 判 [-]，却没给硬标记理由`,
      )
      justified += 1
      continue
    }
    // (c) 已登记的跨批升档未同步：逐条机械复核，不给「写句理由就放行」的口子。
    const drift = REGISTERED_DRIFT.find(item => item.path === row.path && item.name === row.name)
    if (drift) {
      assert.equal(upstream.verdict, drift.b7,
        `${row.name}: 登记的 B7 档位是 ${drift.b7}，现值 ${upstream.verdict} ⇒ B7 又改判了，这条登记要么重写要么删掉`)
      assert.equal(row.verdict, drift.b9,
        `${row.name}: 登记的 B9 档位是 ${drift.b9}，现值 ${row.verdict} ⇒ 本域这一侧也变了，重新核对后再登记`)
      // 只允许「镜像行落后于较新的一边」这一种方向：反过来用这张表就是拿登记表给降档擦屁股。
      const RANK = { '[ ]': 0, '[~]': 1, '[x]': 2 }
      assert.ok(RANK[drift.b9] < RANK[drift.b7],
        `${row.name}: 登记的漂移方向不对（B9=${drift.b9} 必须严格低于 B7=${drift.b7}）⇒ B7 被降档不是「未同步」，要单独复核`)
      assert.ok(row.why.includes('继承 B7 判决'),
        `${row.name}: 登记为 B7 的镜像行，可 why 里没写「继承 B7 判决」⇒ 那它是本域独立判决，不该走这张登记表`)
      assert.ok(drift.repo.length >= 2, `${row.name}: 本仓证据少于两条（登记表在空转）`)
      assert.ok(drift.upstream.length >= 1, `${row.name}: 上游证据少于一条（登记表必须钉住上游那一行）`)
      checkEvidence(row.name, drift.repo, rel => linesOf(rel), '本仓')
      if (upstreamAvailable) checkEvidence(row.name, drift.upstream, rel => upstreamLines(rel), '上游')
      assert.match(drift.batch, /^\d{4}-\d{2}-\d{2} /u, `${row.name}: batch 要以日期开头（哪一批升的档）`)
      assert.ok(drift.reason.length >= 60, `${row.name}: 漂移理由不足 60 字 ⇒ 那是空口豁免，不是登记`)
      assert.match(drift.pending, /^docs\/wiring-requests-/u, `${row.name}: pending 要指向一份 wiring 请求文档`)
      assert.ok(existsSync(join(root, drift.pending)),
        `${row.name}: 登记的未同步落点 ${drift.pending} 不存在 ⇒ 补丁没交接就不能算「已登记的漂移」`)
      registered += 1
      hitDrift.add(drift.name)
      continue
    }
    assert.fail(
      `${row.name}: 与 B7 档位漂移且无本域机械理由（B7=${upstream.verdict} B9=${row.verdict}）`,
    )
  }
  assert.deepEqual(
    REGISTERED_DRIFT.filter(item => !hitDrift.has(item.name)).map(item => item.name),
    [], '这些登记已经不再对应任何真实漂移（镜像行同步好了、或档位又变了）⇒ 把条目从 REGISTERED_DRIFT 删掉：'
      + REGISTERED_DRIFT.filter(item => !hitDrift.has(item.name)).map(item => item.name).join(', '))
  assert.equal(
    declared + justified + registered,
    shared.length,
    `交叉核对没跑满：${declared} 条声明继承 + ${justified} 条有据漂移 + ${registered} 条已登记未同步 != ${shared.length} 条重叠`,
  )
  assert.ok(declared >= 300, `只有 ${declared} 条真的继承了 B7 的逐类判决，覆盖太薄`)
  return { declared, justified, registered, shared: shared.length }
})

test('判决把「三态」写进信号总账（引用注释 ≠ 移植）', () => {
  const section = verdict.split('## 0.')[1].split('## A.')[0]
  assert.match(section, /真实代码/, '缺「本仓真实代码引用」那一态')
  assert.match(section, /只在本仓.{0,4}\*\*注释\*\*|只被注释/, '缺「只被注释提到」那一态')
  assert.match(section, /从未出现/, '缺「从未出现」那一态')
  // 总账里的三个数必须与脚本产物一致（不是手写的）
  const signals = JSON.parse(read('docs/inventory/settings-run_signals.json'))
  for (const key of ['in_code', 'in_comment_only', 'never']) {
    assert.ok(section.includes(`| ${signals.counts[key]} |`), `总账里 ${key} 应为 ${signals.counts[key]}`)
  }
})
