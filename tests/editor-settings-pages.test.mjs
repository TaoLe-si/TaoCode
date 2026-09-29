import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TODO_PATTERNS, duplicateTodoPatterns, validateTodoPatterns } from '../src/todoPatterns.ts'
import { associationsFromRows, rowsFromAssociations, validExtension, validateFileAssociations } from '../src/fileTypes.ts'

// IDEA TodoConfigurable 的 PatternTable 校验 + 原生 validate_todo_patterns（settings_schema.cpp:320-338）。
test('a todo pattern needs a marker and a description', () => {
  assert.equal(validateTodoPatterns([]), null, 'an empty table is valid')
  assert.equal(validateTodoPatterns([{ pattern: 'TODO', description: '待办' }]), null)
  assert.match(validateTodoPatterns([{ pattern: '  ', description: '待办' }]), /标记文字不能为空/)
  assert.match(validateTodoPatterns([{ pattern: 'TODO', description: ' ' }]), /说明不能为空/)
  assert.match(validateTodoPatterns([{ pattern: 'A\nB', description: 'x' }]), /不能包含换行/)
  assert.match(validateTodoPatterns([{ pattern: 'T'.repeat(201), description: 'x' }]), /200 个字符/)
  assert.match(validateTodoPatterns([{ pattern: 'TODO', description: 'd'.repeat(61) }]), /60 个字符/)
})

test('markers must be unique and the table is bounded', () => {
  assert.match(validateTodoPatterns([{ pattern: 'TODO', description: 'a' }, { pattern: 'TODO', description: 'b' }]), /重复/)
  const many = Array.from({ length: MAX_TODO_PATTERNS + 1 }, (_, index) => ({ pattern: `M${index}`, description: 'd' }))
  assert.match(validateTodoPatterns(many), new RegExp(`最多 ${MAX_TODO_PATTERNS} 条`))
  assert.equal(validateTodoPatterns(many.slice(0, MAX_TODO_PATTERNS)), null, 'the largest accepted table is valid')
})

// caseSensitive 是可选的（TodoPattern.isCaseSensitive 默认 false），给了就必须是布尔值。
test('caseSensitive is optional but typed when present', () => {
  assert.equal(validateTodoPatterns([{ pattern: 'TODO', description: 'd', caseSensitive: true }]), null)
  assert.equal(validateTodoPatterns([{ pattern: 'TODO', description: 'd', caseSensitive: false }]), null)
  assert.match(validateTodoPatterns([{ pattern: 'TODO', description: 'd', caseSensitive: 'yes' }]), /必须是布尔值/)
})

test('duplicate markers are reported for the inline warning', () => {
  assert.deepEqual(duplicateTodoPatterns([{ pattern: 'A', description: '' }, { pattern: 'B', description: '' }, { pattern: 'A', description: '' }]), ['A'])
  assert.deepEqual(duplicateTodoPatterns([]), [])
})

// FileTypeConfigurable 的注册模式：键是小写字母数字（不含点），值是四种语言之一。
test('an association key is a bare lowercase extension', () => {
  assert.equal(validExtension('conf'), true)
  assert.equal(validExtension('ts'), true)
  assert.equal(validExtension('a1'), true)
  assert.equal(validExtension(''), false)
  assert.equal(validExtension('.conf'), false, 'a leading dot is not part of the key')
  assert.equal(validExtension('conf.json'), false)
  assert.equal(validExtension('Conf'), false, 'uppercase is rejected, the key is lowercased before storing')
  assert.equal(validExtension('a'.repeat(17)), false)
})

test('associations are validated the same way the native side does', () => {
  assert.equal(validateFileAssociations({}), null)
  assert.equal(validateFileAssociations({ conf: 'typescript' }), null)
  assert.match(validateFileAssociations({ 'a/b': 'java' }), /扩展名/)
  assert.match(validateFileAssociations({ conf: 'kotlin' }), /未知语言/)
  assert.match(validateFileAssociations({ Conf: 'java' }), /扩展名/)
  assert.match(validateFileAssociations(null), /必须是一个对象/)
  assert.match(validateFileAssociations([]), /必须是一个对象/)
})

test('the rows and the stored object round-trip in sorted order', () => {
  const rows = [{ extension: 'ts', language: 'typescript' }, { extension: 'conf', language: 'typescript' }]
  const stored = associationsFromRows(rows)
  assert.deepEqual(stored, { ts: 'typescript', conf: 'typescript' })
  assert.deepEqual(rowsFromAssociations(stored), [
    { extension: 'conf', language: 'typescript' },
    { extension: 'ts', language: 'typescript' },
  ], 'rows come back sorted by extension')
  assert.deepEqual(rowsFromAssociations(null), [], 'a project without associations has no rows')
  assert.deepEqual(associationsFromRows([]), {})
})
