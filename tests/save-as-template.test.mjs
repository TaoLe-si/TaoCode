// 「选中文本另存为实时模板」判据（`src/saveAsTemplate.ts`）。
// 出处核法：每条断言把上游 `文件:行号` 钉死 —— 行内容变了这里会红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { saveAsTemplateAvailable, suggestTemplateText, suggestAbbreviation, buildTemplateDraft,
         templateLanguageFor } from '../src/saveAsTemplate.ts'

const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const ACTION = `${REF}/platform/lang-impl/src/com/intellij/codeInsight/template/actions/SaveAsTemplateAction.java`

test('可用性门禁：只有「无选区」一条（上游 :171 没有语言/只读判据）', () => {
  assert.deepEqual(saveAsTemplateAvailable({ selection: '' }), { available: false, reason: 'no-selection' })
  assert.equal(saveAsTemplateAvailable({ selection: '   ' }).available, true, '上游 hasSelection() 对纯空白也放行')
  assert.equal(saveAsTemplateAvailable({ selection: 'x' }).available, true)
})

test('上游出处行真实存在（参考树在时核；不在则跳过）', () => {
  if (!existsSync(ACTION)) return
  const text = readFileSync(ACTION, 'utf8')
  assert.ok(text.includes('hasSelection()'), 'hasSelection 判据不在了')
  assert.ok(text.includes('contextMenuInvokedOutsideOfSelection'), ':171 的 contextMenu 判据不在了')
  assert.ok(!text.includes('isEventSystemEnabled'), '门禁里不该有 isEventSystemEnabled（旧注释编造）')
  assert.ok(text.includes('suggestTemplateText'), 'suggestTemplateText 不在了')
  assert.ok(text.includes('setToReformat(true)'), 'setToReformat 不在了')
  assert.ok(text.includes('SingleConfigurableEditor'), '非模态设置页弹窗不在了')
})

test('正文 = 选区 trim()（上游 :115）；本仓无 PSI 不做引用改写', () => {
  assert.equal(suggestTemplateText('  int x = 0;  \n'), 'int x = 0;')
})

test('草稿：key/description 按上游留占位，语言映射四档', () => {
  assert.deepEqual(buildTemplateDraft(' int x = 0; ', 'java', 'intx0'),
                   { key: 'intx0', body: 'int x = 0;', description: '', languages: ['java'] })
  assert.deepEqual(templateLanguageFor('kotlin'), 'other')
  assert.deepEqual(templateLanguageFor('cpp'), 'cpp')
})

test('预填缩写：前三词小写、截 30、重名加序号（本仓补充，非上游行为）', () => {
  assert.equal(suggestAbbreviation('Linked List Node body', []), 'linkedlistnode')
  assert.equal(suggestAbbreviation('!!! ???', []), 'template', '无词可选时给兜底名')
  assert.equal(suggestAbbreviation('foo', ['foo']), 'foo2')
  assert.equal(suggestAbbreviation('a'.repeat(80), []).length, 30)
})
