// 判据：一条问题带的「相关位置」（LSP `Diagnostic.relatedInformation`）——
// 折叠规则（排序 / 去重 / 越界丢弃 / 两种线上形态 / 跨文件口径）与面板的接线点。
// 上游依据见 src/problemRelatedInformation.ts 的文件头（LSP 宿主原样保留该字段那一步）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relatedLocationText, relatedLocationsOf, relatedOf } from '../src/problemRelatedInformation.ts'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const row = (path = 'src/a.ts', extra = {}) => ({ path, line: 10, character: 4, severity: 1,
                                                  message: 'x', source: 'eslint', ...extra })

// —— 折叠规则 ——
test('没有关联位置就是空数组（面板据此不渲染那一节，不放假控件）', () => {
  assert.deepEqual(relatedLocationsOf(row(), undefined), [])
  assert.deepEqual(relatedLocationsOf(row(), []), [])
  assert.deepEqual(relatedOf(row()), [])
  assert.deepEqual(relatedOf(row(undefined, { related: [] })), [])
})

test('同文件的多条相关位置按行号升序，同一行再按列升序', () => {
  const list = relatedLocationsOf(row(), [
    { line: 20, character: 0, message: '第二十行第一个位置' },
    { line: 3, character: 7, message: '第三行' },
    { line: 20, character: 2, message: '第二十行第二个位置' },
  ])
  assert.deepEqual(list.map(item => item.message), ['第三行', '第二十行第一个位置', '第二十行第二个位置'])
  assert.deepEqual(list.map(item => item.line), [3, 20, 20])
  assert.deepEqual(list.map(item => item.foreign), [false, false, false])
})

test('越界与非整数坐标整条丢掉（不画「第 NaN 行」）', () => {
  const list = relatedLocationsOf(row(), [
    { line: -1, character: 0, message: '负行' },
    { line: 2.5, character: 0, message: '小数行' },
    { character: 0, message: '没有行' },
    { line: 5, character: -3, message: '负列' },
    { line: 6, character: 1.5, message: '小数列' },
    { line: 7, message: '保留：列缺失按 0' },
    { line: 8, character: 0, message: '   ' },
    { line: 9, character: 0 },
    null,
  ])
  assert.equal(list.length, 1, JSON.stringify(list))
  assert.deepEqual(list[0], { path: 'src/a.ts', line: 7, character: 0, message: '保留：列缺失按 0', foreign: false })
})

test('完全相同的位置只留一条（服务端把同一位置报两遍）', () => {
  const list = relatedLocationsOf(row(), [
    { line: 4, character: 1, message: '同一个位置' },
    { line: 4, character: 1, message: '同一个位置' },
    { line: 4, character: 2, message: '同一行不同列' },
    { line: 5, character: 1, message: '同一个位置' },
  ])
  assert.deepEqual(list.map(item => `${item.line}:${item.character}`), ['4:1', '4:2', '5:1'])
})

// —— LSP 原样形态 ——
test('LSP 原样形态（location.range.start）折得动，带消息即可', () => {
  const list = relatedLocationsOf(row(), [
    { location: { range: { start: { line: 12, character: 6 } } }, message: '声明在这里' },
  ])
  assert.deepEqual(list.map(item => `${item.line}:${item.character}:${item.message}`), ['12:6:声明在这里'])
  assert.equal(list[0].foreign, false)
})

test('只有 file URI、没有宿主映射的相关位置一律丢掉（猜错位置比少列一行更糟）', () => {
  const list = relatedLocationsOf(row(), [
    { location: { uri: 'file:///D:/other/b.java', range: { start: { line: 3, character: 0 } } }, message: '别的文件' },
    { line: 4, character: 0, message: '保留：宿主已折出工作区相对路径' },
    { path: 'src/other.ts', line: 9, character: 2, message: '跨文件：带路径才进表' },
  ])
  assert.deepEqual(list.map(item => `${item.path}:${item.line}:${item.foreign}`),
                   ['src/a.ts:4:false', 'src/other.ts:9:true'], JSON.stringify(list))
  // 跨文件的排在同文件的后面（多数相关位置在本文件里）。
  assert.equal(list[0].foreign, false)
  assert.equal(list[1].foreign, true)
})

// —— 文案 ——
test('相关位置的一行文案：同文件报行号，跨文件带路径（0 基渲染成 1 基）', () => {
  assert.equal(relatedLocationText({ path: 'src/a.ts', line: 4, character: 0, message: '这里也有一处', foreign: false }),
               '第 5 行：这里也有一处')
  assert.equal(relatedLocationText({ path: 'src/b.ts', line: 0, character: 0, message: '定义在这', foreign: true }),
               'src/b.ts:1：定义在这')
})

// —— 聚合链：问题表原样带出来，本地检查不编造相关位置 ——
test('聚合表把宿主透传的关联位置原样带出来', () => {
  const src = read('../src/problems.ts')
  assert.match(src, /related\?: RelatedLocationInput\[\]/)
  assert.match(src, /const related = relatedFrom\(item\)/)
  assert.match(src, /function relatedFrom\(item: object\)/)
  // 两种线上形态都认（接线请求 R1 给宿主的实现上传的是 relatedInformation）。
  assert.match(src, /\.relatedInformation/)
  assert.match(src, /\?\? \(item as \{ related\?: unknown \}\)\.related/)
  // 只有认得出数组才写这一格（不是数组就不写，面板不渲染那一节）。
  assert.match(src, /return Array\.isArray\(raw\) \? raw as RelatedLocationInput\[\] : undefined/)
  assert.match(src, /\.\.\.\(related \? \{ related \} : \{\}\)/)
})

test('本地检查那一路不写 related（纯文本规则给不出另一个位置，不编造）', () => {
  const src = read('../src/problems.ts')
  const start = src.indexOf('of localDiagnostics')
  assert.ok(start > 0, '本地检查那一段的循环要在')
  const push = src.slice(src.indexOf('result.push({', start), src.indexOf('result.push({', start) + 400)
  assert.match(push, /code: item\.source/, '先看准是本地检查那一路的 push')
  assert.doesNotMatch(push, /related/, '本地检查那一路不该带 related')
})

// —— 面板接线 ——
test('面板把相关位置接进行菜单，条目点一下走既有 reveal 通道', () => {
  const panel = read('../src/components/ProblemsPanel.vue')
  assert.match(panel, /import \{ relatedLocationText, relatedLocationsOf, type RelatedLocation \}/)
  assert.match(panel, /const menuRelated = computed<RelatedLocation\[\]>\(\(\) => \{/)
  assert.match(panel, /return row \? relatedLocationsOf\(row, row\.related\) : \[\]/)
  assert.match(panel, /<template v-if="menuRelated\.length">/)
  assert.match(panel, /相关位置（\{\{ menuRelated\.length \}\}）/)
  assert.match(panel, /v-for="\(loc, li\) in menuRelated"/)
  assert.match(panel, /relatedLocationText\(loc\)/)
  // 点一条 = 跳过去（与问题行本身的跳源同一条通道），并关掉菜单。
  assert.match(panel, /@click="revealRelated\(loc\); closeRowMenu\(\)"/)
  assert.match(panel, /function revealRelated\(loc: RelatedLocation\) \{/)
  assert.match(panel, /emit\('reveal', \{ path: loc\.path, line: loc\.line \}\)/)
})

test('聚焦的问题行就是「选中」：有出口给动作层，动作抛 focusChange 给状态栏', () => {
  const panel = read('../src/components/ProblemsPanel.vue')
  assert.match(panel, /@focusin="rememberSelectedRow\(p, \$event\)"/)
  assert.match(panel, /const selectedRow = ref<ProblemRow \| null>\(null\)/)
  assert.match(panel, /function openMenuForSelected\(\) \{/)
  assert.match(panel, /defineExpose\(\{ openMenuForSelected \}\)/)
  assert.match(panel, /focusChange: \[focus: \{ grouping: ProblemGrouping; key: string; label: string \} \| null\]/)
  assert.match(panel, /emit\('focusChange', value \? \{ grouping: grouping\.value, key: value\.key, label: value\.label \} : null\)/)
  // 状态栏那颗芯片的数据面早就有：profile 清单按身份给条数，标签用上游注册出来的显示名。
  const profile = read('../src/inspectionProfile.ts')
  assert.match(profile, /export function inspectionItems\(/)
  const identity = read('../src/inspectionIdentity.ts')
  assert.match(identity, /displayName: 'Unused declaration'/)
})

test('既有的精确断言没被放松（组头停用键那一行的形状仍按原文钉）', () => {
  const panel = read('../src/components/ProblemsPanel.vue')
  assert.match(panel, /muteKeys: groupMute\.value \? muteKeysFor\(group\) : \[\]/)
  assert.match(panel, /@click\.stop="openRowMenu\(p, \$event\)"/)
})
