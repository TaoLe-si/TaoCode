// Editor ▸ Color Scheme 的**纯规则**判据：颜色项清单的每一行都有真实消费方、方案继承链与合并、
// 覆盖表 diff（等于继承值即不落覆盖）、可编辑副本命名（_@user_ 前缀）、搜索过滤、
// 重置/删除/复制、以及 .icls 骨架的导出形状。依据坐标全部写在 src/colorScheme.ts 文件头，这里钉行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  COLOR_ATTRIBUTE_BY_KEY,
  COLOR_ATTRIBUTE_ITEMS,
  EDITABLE_COPY_PREFIX,
  attributeMatchesSearch,
  duplicateScheme,
  editableCopyName,
  ensureEditableScheme,
  filterColorAttributeItems,
  isValidSchemeName,
  removeScheme,
  resetSchemeOverrides,
  resolveOverrides,
  revertAttributeOverride,
  schemeChain,
  schemeDisplayName,
  schemeThemeOf,
  schemeToXml,
  setAttributeOverride,
} from '../src/colorScheme.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(join(root, rel), 'utf8')

const baseLight = { name: 'TaoCode Light', inheritFrom: null, theme: 'light', readOnly: true, overrides: {} }
const baseDark = { name: 'TaoCode Dark', inheritFrom: null, theme: 'dark', readOnly: true, overrides: {} }
const copy = (overrides, name = `${EDITABLE_COPY_PREFIX}TaoCode Light`) => (
  { name, inheritFrom: 'TaoCode Light', theme: 'light', readOnly: false, overrides }
)

// ── 颜色项清单本身 ─────────────────────────────────────────────────────────

test('每个颜色项都必须有 var() 消费方与上游依据（假控件禁令的机检面）', () => {
  assert.ok(COLOR_ATTRIBUTE_ITEMS.length >= 15, `清单塌了：${COLOR_ATTRIBUTE_ITEMS.length}`)
  for (const item of COLOR_ATTRIBUTE_ITEMS) {
    assert.match(item.cssVar, /^--[a-z-]+$/, `${item.id} 必须挂在一个 CSS 变量上`)
    assert.ok(!item.cssVar.includes('#'), 'cssVar 不许是色值')
    assert.match(item.upstream, /^platform\/.+:\d+/, `${item.id} 缺上游坐标`)
    assert.match(item.consumer, /^src\//, `${item.id} 缺本仓消费方证据`)
    // 消费方证据指向的真文件里必须真的在用这个变量（防止判据过期）。
    const file = item.consumer.split('；')[0].split(':')[0]
    const mentions = read(file).includes(item.cssVar)
    assert.ok(mentions, `${item.id} 的 ${item.cssVar} 没在 ${file} 中被消费`)
  }
})

test('九档语法色与 tokens.css 同名；十档通用色也在 tokens.css 里', () => {
  const tokens = read('src/tokens.css')
  for (const item of COLOR_ATTRIBUTE_ITEMS) assert.ok(tokens.includes(`${item.cssVar}:`), `${item.cssVar} 不在 tokens.css`)
})

test('键表按 externalKey 索引且与清单一致', () => {
  assert.equal(COLOR_ATTRIBUTE_BY_KEY.DEFAULT_KEYWORD.cssVar, '--syntax-keyword')
  assert.equal(COLOR_ATTRIBUTE_BY_KEY.CARET_ROW_COLOR.cssVar, '--active-line')
  assert.equal(Object.keys(COLOR_ATTRIBUTE_BY_KEY).length, COLOR_ATTRIBUTE_ITEMS.length)
})

// ── 继承链与合并 ───────────────────────────────────────────────────────────

test('继承链从基座到自己；未注册名字得到空链；循环继承自动断链', () => {
  const loopA = { name: 'A', inheritFrom: 'B', theme: 'light', readOnly: false, overrides: {} }
  const loopB = { name: 'B', inheritFrom: 'A', theme: 'light', readOnly: false, overrides: {} }
  assert.deepEqual(schemeChain([baseLight, copy({ DEFAULT_KEYWORD: '#ff0000' })], `${EDITABLE_COPY_PREFIX}TaoCode Light`)
    .map(s => s.name), ['TaoCode Light', `${EDITABLE_COPY_PREFIX}TaoCode Light`])
  assert.deepEqual(schemeChain([baseLight], 'nope'), [])
  assert.deepEqual(schemeChain([loopA, loopB], 'A').map(s => s.name).length, 2)
})

test('合并覆盖：后者胜；沿链到根取主题', () => {
  const grand = copy({ DEFAULT_KEYWORD: '#111111', DEFAULT_STRING: '#222222' }, `${EDITABLE_COPY_PREFIX}TaoCode Light`)
  const child = { name: 'child', inheritFrom: grand.name, theme: 'light', readOnly: false, overrides: { DEFAULT_STRING: '#333333' } }
  const merged = resolveOverrides([baseLight, grand, child], 'child')
  assert.deepEqual(merged, { DEFAULT_KEYWORD: '#111111', DEFAULT_STRING: '#333333' })
  assert.equal(schemeThemeOf([baseLight, grand, child], 'child'), 'light')
  assert.equal(schemeThemeOf([baseDark], 'TaoCode Dark'), 'dark')
})

// ── 覆盖表写入即 diff（上游 writeAttribute 的 equals-parent 短路）──────────

test('写入等于「继承生效值」的覆盖直接不落（上游 equals-parent 短路）', () => {
  const parent = copy({ DEFAULT_KEYWORD: '#111111' })
  const child = { name: 'child', inheritFrom: parent.name, theme: 'light', readOnly: false, overrides: { DEFAULT_NUMBER: '#444444' } }
  const start = [baseLight, parent, child]
  // 子级写回与父级生效值相同的键 ⇒ 这条覆盖被删（回到继承）。
  const same = setAttributeOverride(start, 'child', 'DEFAULT_KEYWORD', '#111111')
  assert.deepEqual(same.find(s => s.name === 'child').overrides, { DEFAULT_NUMBER: '#444444' }, '等值覆盖不该落，异值覆盖不该丢')
  // 基座没有默认值时，副本写任何色都是「异值」⇒ 正常落下。
  const changed = setAttributeOverride([baseLight, copy({})], `${EDITABLE_COPY_PREFIX}TaoCode Light`, 'DEFAULT_NUMBER', '#444444')
  assert.equal(changed.find(s => s.name === `${EDITABLE_COPY_PREFIX}TaoCode Light`).overrides.DEFAULT_NUMBER, '#444444')
})

test('只读基座永远写不进覆盖', () => {
  const after = setAttributeOverride([baseLight], 'TaoCode Light', 'DEFAULT_KEYWORD', '#111111')
  assert.deepEqual(after.find(s => s.name === 'TaoCode Light').overrides, {})
})

test('单项还原与整方案重置各管各的档位', () => {
  const start = [baseLight, copy({ DEFAULT_KEYWORD: '#111111', DEFAULT_STRING: '#222222' })]
  const reverted = revertAttributeOverride(start, `${EDITABLE_COPY_PREFIX}TaoCode Light`, 'DEFAULT_KEYWORD')
  assert.deepEqual(reverted.find(s => !s.readOnly).overrides, { DEFAULT_STRING: '#222222' })
  const reset = resetSchemeOverrides(start, `${EDITABLE_COPY_PREFIX}TaoCode Light`)
  assert.deepEqual(reset.find(s => !s.readOnly).overrides, {})
  assert.deepEqual(resetSchemeOverrides(start, 'TaoCode Light'), start, '只读基座不许被重置流程改动')
})

// ── 可编辑副本（上游 _@user_ 前缀与「副本存在即复用」）─────────────────────

test('可编辑副本名 = 前缀 + 基座名；显示名剥前缀', () => {
  assert.equal(EDITABLE_COPY_PREFIX, '_@user_')
  assert.equal(editableCopyName('TaoCode Light'), '_@user_TaoCode Light')
  assert.equal(schemeDisplayName('_@user_TaoCode Light'), 'TaoCode Light')
  assert.equal(schemeDisplayName('TaoCode Light'), 'TaoCode Light')
})

test('编辑只读基座：先派生副本并选中；副本已在就复用（不再造第二份）', () => {
  const first = ensureEditableScheme([baseLight], 'TaoCode Light')
  assert.equal(first.name, '_@user_TaoCode Light')
  assert.equal(first.schemes.length, 2)
  const again = ensureEditableScheme(first.schemes, 'TaoCode Light')
  assert.equal(again.name, '_@user_TaoCode Light')
  assert.equal(again.schemes.length, 2, '可编辑副本不该重复创建')
  const editCopy = ensureEditableScheme(again.schemes, '_@user_TaoCode Light')
  assert.equal(editCopy.name, '_@user_TaoCode Light', '非只读方案原样返回')
})

test('复制方案：覆盖表整表带走、继承位保持；重名时追加计数', () => {
  const start = [baseLight, copy({ DEFAULT_KEYWORD: '#111111' })]
  const dup = duplicateScheme(start, `${EDITABLE_COPY_PREFIX}TaoCode Light`)
  assert.equal(dup.name, '_@user_TaoCode Light 2')
  const made = dup.schemes.find(s => s.name === dup.name)
  assert.deepEqual(made.overrides, { DEFAULT_KEYWORD: '#111111' })
  assert.equal(made.inheritFrom, 'TaoCode Light')
})

test('删除只删可编辑副本；子方案挂回被删者的父方案', () => {
  const child = { name: 'child', inheritFrom: `${EDITABLE_COPY_PREFIX}TaoCode Light`, theme: 'light', readOnly: false, overrides: {} }
  const start = [baseLight, copy({ DEFAULT_KEYWORD: '#111111' }), child]
  assert.deepEqual(removeScheme(start, 'TaoCode Light'), start, '只读基座不许删')
  const removed = removeScheme(start, `${EDITABLE_COPY_PREFIX}TaoCode Light`)
  assert.equal(removed.find(s => s.name === 'child').inheritFrom, 'TaoCode Light')
  assert.ok(!removed.some(s => s.name === `${EDITABLE_COPY_PREFIX}TaoCode Light`))
})

test('方案名：空/重名不接受；与「副本显示名」撞名也拒绝', () => {
  assert.equal(isValidSchemeName('  ', [baseLight]), false)
  assert.equal(isValidSchemeName('TaoCode Light', [baseLight]), false)
  // 已有 `_@user_X`（显示名就是 X）时再建 X 会串列表 ⇒ 拒绝。
  assert.equal(isValidSchemeName('X', [baseLight, copy({}, '_@user_X')]), false)
  assert.equal(isValidSchemeName('我的方案', [baseLight]), true)
})

// ── 搜索（颜色项树的速度搜索面）───────────────────────────────────────────

test('搜索匹配标签、外部键与变量名；空查询全量', () => {
  const kw = COLOR_ATTRIBUTE_ITEMS.find(i => i.id === 'keyword')
  assert.equal(attributeMatchesSearch(kw, ''), true)
  assert.equal(attributeMatchesSearch(kw, 'key'), true, 'DEFAULT_KEYWORD 子串')
  assert.equal(attributeMatchesSearch(kw, 'KEYWORD'), true, '大小写不敏感')
  assert.equal(attributeMatchesSearch(kw, '--syntax-keyword'), true, 'cssVar 子串')
  assert.equal(attributeMatchesSearch(kw, '不存在xyz'), false)
})

test('过滤后的分组保持「常规在前、默认语言在后」，空组不出现', () => {
  const groups = filterColorAttributeItems(COLOR_ATTRIBUTE_ITEMS, 'string')
  assert.deepEqual(groups.map(g => g.group), ['language'])
  const all = filterColorAttributeItems(COLOR_ATTRIBUTE_ITEMS, ' ')
  assert.deepEqual(all.map(g => g.group), ['general', 'language'])
})

// ── 导出形状（.icls 骨架）──────────────────────────────────────────────────

test('导出 XML：根属性 name/version/parent_scheme，attributes 按键排序，色值去 # 小写', () => {
  const xml = schemeToXml(copy({ DEFAULT_STRING: '#ABCD12', DEFAULT_KEYWORD: '#112233' }))
  const lines = xml.split('\n')
  assert.equal(lines[0], '<scheme name="_@user_TaoCode Light" version="1" parent_scheme="TaoCode Light">')
  assert.equal(lines[1], '  <attributes>')
  assert.ok(xml.includes('<option name="DEFAULT_KEYWORD">'), '键序应为排序后')
  assert.ok(xml.indexOf('DEFAULT_KEYWORD') < xml.indexOf('DEFAULT_STRING'))
  assert.ok(xml.includes('<option name="FOREGROUND" value="112233" />'), '色值不带 # 且小写')
  assert.equal(lines[lines.length - 1], '</scheme>')
})

test('导出：无覆盖不写 attributes 节点；基座导出也不带空壳', () => {
  assert.equal(schemeToXml(baseLight), '<scheme name="TaoCode Light" version="1">\n</scheme>')
})

test('导出：名字里的 XML 特殊字符转义', () => {
  const weird = { ...copy({}, 'a<b>&"c"'), inheritFrom: 'p<1>' }
  const xml = schemeToXml(weird)
  assert.ok(xml.includes('<scheme name="a&lt;b&gt;&amp;&quot;c&quot;" version="1" parent_scheme="p&lt;1&gt;">'))
})
