// **生成型**判决表的门禁：`execution`（B8）、`xdebugger`（B8）、`projectviews`（B9）。
//
// 与 B1–B7 的逐条手写判决不同，这几个域太大（2243 + 755 类），判决表由
// `scripts/verdict_table.py` 生成：族判词写在脚本里（逐族读过源码），档位落到每个类，
// 机械信号来自 `scripts/verdict_signals.py`。门禁要保证"生成物与它声称的一致"：
//   ① 规模 = 枚举文件行数（不许多不许少）；
//   ② 逐类覆盖且不重复；
//   ③ 四档计数自洽，且**文档里印的数字**与 JSON 一致（B6 那类"文档写 36、表里 40"的漂移）；
//   ④ `[x]`/`[~]` 族的判词必须指出**真实存在**的本仓落点；
//   ⑤ `[-]` 族的判词必须给得出依据（不是空话）；
//   ⑥ Swing 组件本体的类不许判 `[~]`（机械降级规则真的在跑）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const DOMAINS = [['execution', 1608], ['xdebugger', 635], ['projectviews', 755], ['daemon', 659], ['platform_rest', 20574]]
const table = domain => JSON.parse(read(`docs/inventory/${domain}_verdict_table.json`))
const listing = domain => read(`docs/inventory/${domain}.txt`).split(/\r?\n/).filter(Boolean)

test('规模：判决行数 = 枚举文件行数，逐类覆盖且不重复', () => {
  for (const [domain, expected] of DOMAINS) {
    const payload = table(domain)
    assert.equal(payload.counts.total, expected, `${domain} 判决类数应为 ${expected}`)
    const rows = listing(domain)
    assert.equal(payload.rows.length, rows.length, `${domain} 判决行数要等于枚举行数`)
    const seen = new Set(payload.rows.map(row => row.path))
    assert.equal(seen.size, rows.length, `${domain} 有重复或漏判`)
    for (const path of rows) assert.ok(seen.has(path), `${domain} 漏判：${path}`)
  }
})

test('四档计数自洽，且文档里印的合计与 JSON 一致', () => {
  for (const [domain] of DOMAINS) {
    const payload = table(domain)
    const counts = payload.counts
    assert.equal(counts.x + counts['~'] + counts.blank + counts['-'], counts.total, `${domain} 四档之和要等于合计`)
    for (const tier of ['x', '~', 'blank', '-']) {
      const key = tier === 'blank' ? ' ' : tier
      assert.equal(payload.rows.filter(row => row.tier === key).length, counts[tier], `${domain} 的 ${tier} 计数与逐类表不符`)
    }
    const doc = read(`docs/inventory/verdict-${domain}.md`)
    assert.match(doc, new RegExp(`\\[x\\]\` ${counts.x} \\+ \`\\[~\\]\` ${counts['~']} \\+ \`\\[ \\]\` ${counts.blank} \\+ \`\\[-\\]\` ${counts['-']} = \\*\\*${counts.total}\\*\\*`),
      `${domain} 判决书的合计那行与 JSON 不一致`)
  }
})

test('[x]/[~] 族的判词必须指出真实存在的本仓落点', () => {
  const missing = []
  for (const [domain] of DOMAINS) {
    const payload = table(domain)
    const used = new Set(payload.rows.map(row => row.family))
    for (const [family, entry] of Object.entries(payload.families)) {
      if (!used.has(family)) continue
      if (entry.tier !== 'x' && entry.tier !== '~') continue
      const refs = [...entry.reason.matchAll(/(?:src|native)\/[A-Za-z0-9_./-]+\.(?:ts|vue|cpp|hpp)/g)].map(match => match[0])
      assert.ok(refs.length > 0, `${domain}/${family} 判 ${entry.tier} 却没有任何本仓落点`)
      for (const ref of refs) if (!existsSync(`${root}${ref}`)) missing.push(`${domain}/${family} → ${ref}`)
    }
  }
  assert.deepEqual(missing, [], `判词引用的文件不存在：\n${missing.join('\n')}`)
})

test('[-] 族的判词必须给得出依据', () => {
  for (const [domain] of DOMAINS) {
    const payload = table(domain)
    for (const [family, entry] of Object.entries(payload.families)) {
      if (entry.tier !== '-') continue
      assert.ok(entry.reason.trim().length >= 30, `${domain}/${family} 判 [-] 但理由太短`)
      assert.ok(/[A-Z][A-Za-z]+/.test(entry.reason), `${domain}/${family} 的理由里点不出上游的类/包名`)
    }
  }
})

test('Swing 组件本体不许判 [~]，且降级规则确有命中', () => {
  for (const [domain] of DOMAINS) {
    const rows = table(domain).rows
    const bad = rows.filter(row => row.swing && row.tier === '~' && !row.presence.includes('真实代码'))
    assert.equal(bad.length, 0, `${domain} 还有 ${bad.length} 个 Swing 组件类判着 [~]`)
    if (domain !== 'projectviews') continue
    assert.ok(rows.some(row => row.swing && row.tier === '-'), 'projectviews 一个 Swing 降级都没有')
  }
})
