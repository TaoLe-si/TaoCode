// 作用域下拉的选择解析（上游 `FindPopupScopeUIImpl` 的 ScopeChooserCombo + `NamedScopesHolder.getScope`）。
//
// 两条边界：名字不在表里 ⇒ 回落「项目」（getScope 返回 null）；名字在但模式坏 ⇒ InvalidPackageSet
// 恒不匹配 + 错误消息与位置（`ScopeEditorPanel.onTextChange`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveScopeSelection, scopeWarningText } from '../src/findScopeSelection.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const scopes = [
  { name: '主体', pattern: 'file:src/**' },
  { name: '空表', pattern: '' },
  { name: '坏模式', pattern: 'src/(**' },
]

test('an empty name means the project scope', () => {
  assert.deepEqual(resolveScopeSelection('', scopes), { name: '', set: null, error: null, position: null })
})

test('a name that is no longer in the table falls back to the project scope', () => {
  // NamedScopesHolder.getScope 查不到 ⇒ 空选择（上游组合框也随之落回「项目」）。
  assert.deepEqual(resolveScopeSelection('已删除', scopes), { name: '', set: null, error: null, position: null })
})

test('a valid name resolves to its compiled set', () => {
  const resolution = resolveScopeSelection('主体', scopes)
  assert.equal(resolution.name, '主体')
  assert.equal(resolution.set?.kind, 'file')
  assert.equal(resolution.error, null)
  assert.deepEqual(resolution.set, { kind: 'file', modulePattern: null, pattern: 'src/**', projectFiles: true })
})

test('an empty pattern is an InvalidPackageSet, not the project scope', () => {
  // compileScopeText('')：空文本不算错误（`ScopeEditorPanel.onTextChange`），但集合恒不匹配。
  const resolution = resolveScopeSelection('空表', scopes)
  assert.equal(resolution.name, '空表')
  assert.equal(resolution.set?.kind, 'invalid')
  assert.equal(resolution.error, null)
})

test('a broken pattern keeps the name, reports the error and position', () => {
  const resolution = resolveScopeSelection('坏模式', scopes)
  assert.equal(resolution.name, '坏模式', '不退回"全项目"')
  assert.equal(resolution.set?.kind, 'invalid')
  assert.ok(resolution.error)
  assert.ok(resolution.position !== null, '位置给界面提示用')
  assert.match(scopeWarningText(resolution), /位置 \d+/)
  assert.equal(scopeWarningText({ name: '', set: null, error: null, position: null }), '')
})

test('SearchPanel uses the resolver instead of open-coding the lookup', () => {
  const panel = read('src/components/SearchPanel.vue')
  assert.match(panel, /resolveScopeSelection\(scopeName\.value, props\.scopes\)/)
  assert.match(panel, /watch\(scopeResolution, resolution => \{ if \(resolution\.name !== scopeName\.value\) scopeName\.value = resolution\.name \}\)/, '失配要拨回下拉')
  assert.match(panel, /v-if="scopeWarning"/, '坏模式要有可见提示')
  assert.doesNotMatch(panel, /compileScopeText/, '不再自己 compile（解析统一走 findScopeSelection.ts）')
})
