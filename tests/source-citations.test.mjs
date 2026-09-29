// 带路径的上游引用必须真的指得到 —— 这一族的判据。
//
// 为什么要有：本仓的规矩是"每一条界面/行为断言都指到 intellij-community 的具体文件与行号"。
// 那句话一旦写错（文件改名、整段搬家、行号数错），后来人按图索骥会扑空，而**其它断言全都还是绿的** ——
// 这正是"看起来通过"的那类缺陷。写这一批时手抄错三处行号、一处文件名（`intellij.lang.impl.xml`
// 实际叫 `intellij.platform.lang.impl.xml`），是靠人肉发现的；人肉不该是唯一的防线。
//
// 参考树不在本仓里，所以树不在时那一条**跳过**（与 tests/tool-tabs.test.mjs 同样的处理）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
/** 只有从参考树根开始的完整路径才核；`platform/util/.../Foo.java` 那种省略写法不核（省了就没法核）。 */
const TOP_DIRS = ['platform', 'plugins', 'java', 'kotlin', 'python', 'wire', 'tools']
const CITATION = /([A-Za-z0-9_.$/-]+\.(?:kt|java|xml|properties|gradle|html|py)):(\d+)(?:-(\d+))?/g

/** 从一段文本里取出**可核对**的引用：`{ path, from, to }`。 */
export function citationsOf(text) {
  const found = []
  for (const match of text.matchAll(CITATION)) {
    const path = match[1]
    if (!path.includes('/') || !TOP_DIRS.includes(path.split('/')[0])) continue
    if (path.includes('...') || path.includes('…')) continue
    found.push({ path, from: Number(match[2]), to: Number(match[3] ?? match[2]) })
  }
  return found
}

/** 读参考树里某个文件的行数；读不到（不存在/没权限）返回 null。行号按 `split('\n')` 数，与其它门控一致。 */
export function refLineReader(refRoot) {
  const cache = new Map()
  return path => {
    if (cache.has(path)) return cache.get(path)
    const file = join(refRoot, path)
    const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').length : null
    cache.set(path, lines)
    return lines
  }
}

/** 核一组引用，返回**不成立**的那些（空数组 = 全对）。`readLines` 可注入，所以下面能自证。 */
export function verifyCitations(items, readLines) {
  const bad = []
  for (const item of items) {
    const lines = readLines(item.path)
    if (lines === null) { bad.push({ ...item, why: '参考树里没有这个文件' }); continue }
    if (item.to > lines) bad.push({ ...item, why: `行号超出文件长度（${item.to} > ${lines}）` })
  }
  return bad
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'build-validation'].includes(entry.name)) continue
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) { sourceFiles(rel, out); continue }
    if (/\.(ts|vue|css|cpp|hpp|mjs|md)$/.test(entry.name)) out.push(rel)
  }
  return out
}

test('解析器：只收完整路径带行号的上游引用，其余不收', () => {
  const text = '见 platform/util/lib/Util.java:120-133 与 platform/util/.../Util.java:5；'
    + 'src/App.vue:7 与 native/lsp_session.cpp:9 是本仓自己的文件；ProcessPopup.java 没有行号。'
  assert.deepEqual(citationsOf(text), [{ path: 'platform/util/lib/Util.java', from: 120, to: 133 }],
    '多收一条 = 把本仓的文件也当成上游来核（假失败）；少收一条 = 门控悄悄空转')
})

test('门控要真的会失败：不存在的文件与越界的行号都拦得住', () => {
  const fake = new Map([['platform/x/Real.java', 40]])
  const bad = verifyCitations([
    { path: 'platform/x/Real.java', from: 41, to: 41 },
    { path: 'platform/x/Missing.java', from: 1, to: 1 },
  ], path => fake.get(path) ?? null)
  assert.deepEqual(bad.map(b => b.path).sort(), ['platform/x/Missing.java', 'platform/x/Real.java'],
    '反证：喂两条假引用，必须两条都被判出来')
  assert.match(bad.find(b => b.path.endsWith('Real.java')).why, /超出文件长度/)
  assert.match(bad.find(b => b.path.endsWith('Missing.java')).why, /没有这个文件/)
})

test('仓里每一条带路径的上游引用都指得到（参考树在时）', () => {
  if (!existsSync(REF)) return
  const items = []
  // 不扫 tests/：本文件（以及别的用例）里**必须**放着几条编造的引用才能自证门控会响，
  // 把它们当断言核就成了自己绊自己。界面/行为的断言都写在 src/ native/ docs/ 里，那三处才是查证点。
  for (const dir of ['src', 'native', 'docs']) {
    for (const file of sourceFiles(dir)) {
      for (const item of citationsOf(readFileSync(join(root, file), 'utf8'))) items.push({ ...item, file })
    }
  }
  assert.ok(items.length >= 150, `只核到 ${items.length} 条引用：多半是正则或目录清单坏了，门控正在空转`)
  const bad = verifyCitations(items, refLineReader(REF))
  assert.deepEqual(bad.map(b => `${b.file} :: ${b.path}:${b.from}-${b.to} —— ${b.why}`), [],
    '这些引用按图索骥会扑空')
})
