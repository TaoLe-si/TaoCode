// `ls/code-lens` 的补齐判据：Code Vision 条目在**点击之前**就校验命令能不能真发出去。
//
// 依据：LSP `ExecuteCommandParams.arguments?: LSPAny[]` —— 参数要原样过桥做 JSON 序列化；
// 函数/循环引用/`undefined`（数组位）/`NaN` 这类值要么在桥接层炸，要么被静默变成 null，
// 也就是「执行一条和用户看到的不一样的命令」。这里钉住校验与两处消费（渲染过滤 + 点击拒绝）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODE_LENS_COMMAND_MAX, anchoredLenses, codeLensArgumentsProblem, codeLensCommand, codeLensItemProblem } from '../src/codeLens.ts'

const lens = (line, extra = {}) => ({
  title: 'x', command: 'cmd', range: { startLine: line, startChar: 0, endLine: line, endChar: 1 }, ...extra,
})

test('参数必须是 JSON 值数组：合法的一律放行（含 undefined 整个缺省）', () => {
  assert.equal(codeLensArgumentsProblem(undefined), null)
  assert.equal(codeLensArgumentsProblem([]), null)
  assert.equal(codeLensArgumentsProblem(['a', 1, true, null, { k: [1, { nested: 'v' }] }]), null)
  assert.equal(codeLensArgumentsProblem([{ drop: undefined }]), null, '对象里的 undefined 会被 JSON 丢掉，不改语义')
})

test('非 JSON 参数按第一个问题拒绝：非数组、函数、循环、NaN/Infinity、数组里的 undefined', () => {
  assert.match(codeLensArgumentsProblem('nope'), /数组/)
  assert.match(codeLensArgumentsProblem([() => 1]), /不能序列化/)
  assert.match(codeLensArgumentsProblem([Number.NaN]), /非有限数值/)
  assert.match(codeLensArgumentsProblem([Number.POSITIVE_INFINITY]), /非有限数值/)
  assert.match(codeLensArgumentsProblem([undefined]), /不能序列化/)
  const cyclic = {}
  cyclic.self = cyclic
  assert.match(codeLensArgumentsProblem([cyclic]), /嵌套过深/)
})

test('条目校验：空命令/纯空白/超长命令名都拦下，正常条目放行', () => {
  assert.equal(codeLensItemProblem(lens(0)), null)
  assert.match(codeLensItemProblem(lens(0, { command: '   ' })), /命令名为空/)
  assert.match(codeLensItemProblem(lens(0, { command: 'c'.repeat(CODE_LENS_COMMAND_MAX + 1) })), /命令名过长/)
  assert.match(codeLensItemProblem(undefined), /没有条目/)
})

test('渲染过滤：参数带函数的条目根本不渲染（不会出现「点了没反应」的行）', () => {
  const items = [lens(0), lens(1, { arguments: [() => 1] }), lens(2, { arguments: ['ok'] })]
  assert.deepEqual(anchoredLenses(items).map(entry => entry.line), [0, 2])
})

test('点击路径复用同一校验：坏条目的 codeLensCommand 是 null', () => {
  assert.equal(codeLensCommand(lens(0, { arguments: [() => 1] })), null)
  assert.deepEqual(codeLensCommand(lens(0, { arguments: ['ok'] })), { command: 'cmd', arguments: ['ok'] })
})

test('接线：CodeMirror 落点确实调 codeLensCommand（校验在渲染与点击两条路都生效）', () => {
  const extension = readFileSync('src/codeLensExtension.ts', 'utf8')
  assert.ok(extension.includes('const payload = codeLensCommand(this.lens.item)'), '点击没有复用 codeLensCommand')
  assert.ok(extension.includes('anchorLenses') || extension.includes('anchoredLenses(result.items)'), '渲染没有过滤条目')
})
