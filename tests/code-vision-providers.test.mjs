// Code Vision 的本地提供者注册表（`src/codeVisionProviders.ts`）：problems 提供者把诊断按
// 最内层作用域符号认领，产「N 个错误 / M 个警告」条目；注册表按语言过滤；与服务端 lens 合流去重。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateProviders, createCodeVisionRegistry, mergeCodeVisionEntries, problemInsideSymbol, problemsVisionProvider,
} from '../src/codeVisionProviders.ts'

const symbol = (kind, name, startLine, endLine) => ({ kind, name, startLine, endLine })
const problem = (line, severity) => ({ line, severity })
const context = overrides => ({
  path: 'src/A.java',
  language: 'java',
  outline: [],
  problems: [],
  ...overrides,
})

test('problemInsideSymbol：0 基闭区间', () => {
  assert.ok(problemInsideSymbol(problem(3, 1), symbol(5, 'A', 3, 9)))
  assert.ok(problemInsideSymbol(problem(9, 1), symbol(5, 'A', 3, 9)))
  assert.ok(!problemInsideSymbol(problem(10, 1), symbol(5, 'A', 3, 9)))
})

test('problems 提供者：最内层符号认领，错误与警告分开计数', () => {
  const outline = [symbol(5, 'A', 0, 20), symbol(6, 'm', 5, 10)]
  const problems = [problem(6, 1), problem(7, 1), problem(8, 2), problem(15, 2)]
  const entries = problemsVisionProvider().computeForDocument(context({ outline, problems }))
  const byLine = Object.fromEntries(entries.map(entry => [entry.line, entry]))
  assert.equal(byLine[5].title, '2 个错误，1 个警告', '方法内的 2 错 1 警记在方法上')
  assert.equal(byLine[0].title, '1 个警告', '类里没被方法认领的那条记在类上')
  assert.equal(byLine[0].command, 'codeVision.showProblems')
  assert.deepEqual(byLine[5].arguments, [{ path: 'src/A.java', line: 5 }])
})

test('problems 提供者：没有诊断就没有条目，也不认非作用域符号', () => {
  const provider = problemsVisionProvider()
  assert.deepEqual(provider.computeForDocument(context({ outline: [symbol(5, 'A', 0, 9)], problems: [] })), [])
  assert.deepEqual(provider.computeForDocument(context({ outline: [symbol(8, 'field', 0, 9)], problems: [problem(2, 1)] })), [])
})

test('可用性：outline/problems 都是数组且确有诊断', () => {
  const provider = problemsVisionProvider()
  assert.ok(!provider.isAvailableFor(context({ problems: [] })))
  assert.ok(provider.isAvailableFor(context({ problems: [problem(1, 1)] })))
})

test('注册表：按语言过滤，同 id 覆盖注册', () => {
  const custom = {
    id: 'usages-from-server',
    languages: ['typescript'],
    isAvailableFor: () => true,
    computeForDocument: () => [{ line: 1, title: '3 usages', command: 'showUsages' }],
  }
  const registry = createCodeVisionRegistry([custom])
  assert.equal(registry.compute(context({ language: 'java' })).length, 0, '语言不匹配的提供者不算')
  assert.equal(registry.compute(context({ language: 'typescript' })).length, 1)
  registry.register({ ...custom, languages: [], computeForDocument: () => [{ line: 2, title: '重注册', command: 'x' }] })
  assert.equal(registry.providers().length, 1, '同 id 是覆盖不是追加')
  assert.equal(registry.compute(context({})).length, 1)
})

test('candidateProviders：无 languages 的提供者对所有语言可用', () => {
  const provider = problemsVisionProvider()
  assert.deepEqual(candidateProviders([provider], context({ problems: [problem(1, 1)] })), [provider])
  assert.deepEqual(candidateProviders([provider], context({ problems: [] })), [])
})

test('合流：本地优先、同行同标题去重、按行稳定排序', () => {
  const local = [{ line: 5, title: '1 个错误', command: 'local' }, { line: 2, title: '本地2', command: 'local' }]
  const server = [{ line: 5, title: '1 个错误', command: 'server' }, { line: 1, title: '服务端', command: 'server' }, { line: 5, title: '5 usages', command: 'server' }]
  const merged = mergeCodeVisionEntries(local, server)
  assert.deepEqual(merged.map(entry => entry.command), ['server', 'local', 'local', 'server'], '第 1 行服务端 → 第 2 行本地 → 第 5 行本地在前、服务端同名被去重')
  assert.equal(merged.filter(entry => entry.line === 5).length, 2)
})
