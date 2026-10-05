// B1 判决的覆盖面门禁（`ui/tabs` + `ui/popup`）。
//
// 为什么要它：B1 的 107 行原表是"当时枚举到多少就判多少"，之后按包后缀重枚举带进来 20 类，
// 判决书里补了一节；2026-10-04 复核时**又发现 4 个类从未出现过**（`ComponentPopupBuilderImpl` /
// `FileColorsOptionsTopHitProvider` / `ListPopupWrapper` / `TreePopupImpl`）。人眼比对一次能发现，
// 但没人保证下一次还会比对 —— 所以把查法固定下来。
//
// 口径（可复算、不依赖参考源码树）：判据只读**已提交的** `docs/inventory/ui.txt`。那份清单是
// `scripts/enumerate_inventory.py` 的产物（按包后缀枚举、排除 testSrc/testData），所以它既能离线跑，
// 又和"源码里有什么"是同一来源。3 个 `package-info.java` 是包级文档桩、不是类，**不算**在里面 ——
// 旧文档把 127 行写成"127 类"就是这一处口径错误。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** `ui.txt` 里这两个包的类名（去掉扩展名），`package-info` 不算类。 */
function b1Classes() {
  return read('docs/inventory/ui.txt')
    .split(/\r?\n/)
    .filter(line => line.includes('/com/intellij/ui/tabs/') || line.includes('/com/intellij/ui/popup/'))
    .map(line => line.trim().split('/').pop())
    .filter(name => name && !name.startsWith('package-info.'))
    .map(name => name.replace(/\.(java|kt)$/, ''))
}

test('两个包的规范类数是 124（63 + 61），且 package-info 不计入', () => {
  const classes = b1Classes()
  assert.equal(classes.length, 124, `ui/tabs + ui/popup 的类数应为 124，实际 ${classes.length}`)
  const lines = read('docs/inventory/ui.txt').split(/\r?\n/)
    .filter(line => line.includes('/com/intellij/ui/tabs/') || line.includes('/com/intellij/ui/popup/'))
  assert.equal(lines.length - classes.length, 3, '清单里应有 3 行 package-info（不是类）')
})

test('判决书覆盖每一个类（少一个就红）', () => {
  const verdict = read('docs/inventory/verdict-ui-tabs-popup.md')
  const missing = b1Classes().filter(name => !verdict.includes(name))
  assert.deepEqual(missing, [], `这些类没有出现在 B1 判决书里：${missing.join('、')}`)
})

test('判决书不再写"127 类"那种把 package-info 当类的口径', () => {
  const verdict = read('docs/inventory/verdict-ui-tabs-popup.md')
  assert.match(verdict, /=\s*\*\*124 类\*\*/, '标题要写 124 类（可复算的那个数）')
  assert.match(verdict, /package-info[^\n]*不是类/, '要写明 package-info 不是类')
  assert.doesNotMatch(verdict, /^# B1 判决：`ui\/tabs`（53）/m, '旧标题（107 类那版）不能再留着')
})

// 2026-10-04 处置：最后 20 个 `[ ]` 逐条改判（11 个 `[~]`、9 个 `[-]`），本域归零。
// 这条把"归零"锁住：判决格里不许再出现空的 `[ ]`（§D 统计表里那行 `[ ]` 未移植 | 0` 不是判决格，不误伤）。
test('未移植（[ ]）的判决格已清空', () => {
  const blanks = read('docs/inventory/verdict-ui-tabs-popup.md').split(/\r?\n/)
    .filter(line => /\|\s*`\[ \]`\s*\|/.test(line))
  assert.deepEqual(blanks, [], `还有 [ ] 判决格：${blanks.join(' / ')}`)
})

// 四档计数冻结（2026-10-04 本轮：`ScrollableTabsRow.kt` `[~]` → `[x]`，7/59 → 8/58）。
// B1 的表不是单一 §G，而是按族分几张表，所以这里以 §D 统计表为准：四个数字要能对上和数，
// 改判（升 `[x]` / 降 `[~]`）必须同时改文档与这条门禁。
test('四档计数自洽且已冻结（8 + 58 + 0 + 59 = 125）', () => {
  const section = read('docs/inventory/verdict-ui-tabs-popup.md').split('## D. 统计')[1].split('## E.')[0]
  const countOf = label => {
    const match = new RegExp(`^\\|\\s*\`\\[${label}\\]\`[^|]*\\|\\s*(\\d+)`, 'm').exec(section)
    assert.ok(match, `§D 里找不到 \`[${label}]\` 那一行`)
    return Number(match[1])
  }
  const done = countOf('x')
  const partial = countOf('~')
  const todo = countOf(' ')
  const na = countOf('-')
  assert.equal(done, 8)
  assert.equal(partial, 58)
  assert.equal(todo, 0)
  assert.equal(na, 59)
  assert.equal(done + partial + todo + na, 125)
  assert.match(section, /合计 \| 125 格/, '§D 的合计行要写 125')
})
