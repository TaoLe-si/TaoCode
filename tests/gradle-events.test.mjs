// Gradle 同步通道（src/gradleEvents.ts）与终端事件通道（src/terminalEvents.ts）的行为测试。
//
// 这两条通道是从 src/bridge.ts 拆出来的（2026-09-27 接 Gradle 时 bridge.ts 顶到机检上限），
// 拆出去的东西必须仍然"真的被消费"，所以这里直接驱动它们，而不是只看源码里有没有字符串。
import test from 'node:test'
import assert from 'node:assert/strict'

import { fromBase64, toBase64 } from '../src/base64.ts'
import { GRADLE_OUTPUT_LIMIT, gradleSync, handleGradleEvent } from '../src/gradleEvents.ts'
import { deliverTermOutput, emitTermExit, subscribeTerm, subscribeTermExit } from '../src/terminalEvents.ts'
import * as bridge from '../src/bridge.ts'

const encode = text => toBase64(new TextEncoder().encode(text))

test('base64 往返（含 >127 的字节）', () => {
  const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xe5, 0xa5, 0xbd])
  assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes])
  assert.equal(new TextDecoder().decode(fromBase64(toBase64(new TextEncoder().encode('好 a')))), '好 a')
  // 大缓冲（超过 0x8000 分块边界）也要能往返
  const big = new Uint8Array(0x8000 * 2 + 5).map((_, index) => index % 251)
  assert.deepEqual([...fromBase64(toBase64(big))], [...big])
})

test('bridge 仍然转出这两个模块的东西（既有调用方不用改路径）', () => {
  assert.equal(bridge.gradleSync, gradleSync, 'gradleSync 必须是同一个对象')
  assert.equal(bridge.GRADLE_OUTPUT_LIMIT, GRADLE_OUTPUT_LIMIT)
  assert.equal(typeof bridge.subscribeTerm, 'function')
  assert.equal(typeof bridge.subscribeTermExit, 'function')
})

test('gradle.started 建立状态并清掉上一轮输出', () => {
  gradleSync.output = '上一轮残留'
  gradleSync.exit = 3
  assert.equal(handleGradleEvent('gradle.started', { command: 'gradlew.bat --console=plain projects tasks --all' }), true)
  assert.equal(gradleSync.running, true)
  assert.equal(gradleSync.command, 'gradlew.bat --console=plain projects tasks --all')
  assert.equal(gradleSync.output, '')
  assert.equal(gradleSync.exit, null)
  assert.equal(gradleSync.cancelled, false)
  assert.ok(gradleSync.at > 0)
  // 形状不对的事件不认领
  assert.equal(handleGradleEvent('gradle.started', {}), false)
})

test('gradle.output 按字节流解码，跨块的多字节字符不变成乱码', () => {
  handleGradleEvent('gradle.started', { command: 'gradle projects' })
  // 「好」的 UTF-8 是 e5 a5 bd，故意切成两块
  assert.equal(handleGradleEvent('gradle.output', { dataB64: toBase64(new Uint8Array([0xe5])) }), true)
  assert.equal(handleGradleEvent('gradle.output', { dataB64: toBase64(new Uint8Array([0xa5, 0xbd])) }), true)
  handleGradleEvent('gradle.output', { dataB64: encode(' world') })
  assert.equal(gradleSync.output, '好 world')
  // 没有 dataB64 的事件不认领
  assert.equal(handleGradleEvent('gradle.output', {}), false)
})

test('gradle.exit 结束状态并记下退出码 / 取消标记', () => {
  handleGradleEvent('gradle.started', { command: 'gradle tasks' })
  handleGradleEvent('gradle.output', { dataB64: encode('BUILD SUCCESSFUL') })
  assert.equal(handleGradleEvent('gradle.exit', { code: 0 }), true)
  assert.equal(gradleSync.running, false)
  assert.equal(gradleSync.exit, 0)
  assert.equal(gradleSync.cancelled, false)
  assert.equal(gradleSync.output, 'BUILD SUCCESSFUL')

  handleGradleEvent('gradle.started', { command: 'gradle tasks' })
  handleGradleEvent('gradle.exit', { code: 143, cancelled: true })
  assert.equal(gradleSync.cancelled, true)
  assert.equal(gradleSync.exit, 143)
  assert.equal(handleGradleEvent('gradle.exit', { code: 'x' }), false)
})

test('gradle.output 超上限时丢掉最旧的一半（同步日志可以是几十 MB）', () => {
  handleGradleEvent('gradle.started', { command: 'gradle tasks' })
  const chunk = 'x'.repeat(GRADLE_OUTPUT_LIMIT)
  handleGradleEvent('gradle.output', { dataB64: encode(chunk) })
  assert.equal(gradleSync.output.length, GRADLE_OUTPUT_LIMIT)
  handleGradleEvent('gradle.output', { dataB64: encode('TAIL') })
  assert.ok(gradleSync.output.length <= GRADLE_OUTPUT_LIMIT, '第二次写入后必须回到上限之内')
  assert.ok(gradleSync.output.endsWith('TAIL'), '保留的是尾部（最新的输出）')
  assert.equal(gradleSync.output.length, GRADLE_OUTPUT_LIMIT / 2, '裁掉后正好留一半')
})

test('不认识的 event 明确不认领（别的分支要继续处理）', () => {
  assert.equal(handleGradleEvent('run.output', { dataB64: encode('x') }), false)
  assert.equal(handleGradleEvent(undefined, {}), false)
})

test('终端输出：没有订阅者时先缓冲，订阅时一次性冲出来', () => {
  const session = 9001
  const seen = []
  assert.equal(deliverTermOutput(session, encode('early')), true)
  assert.equal(deliverTermOutput(session, encode('-late')), true)
  const off = subscribeTerm(session, bytes => seen.push(new TextDecoder().decode(bytes)))
  assert.deepEqual(seen, ['early', '-late'], '订阅时必须把订阅前的输出冲给订阅者')
  deliverTermOutput(session, encode('live'))
  assert.deepEqual(seen, ['early', '-late', 'live'])
  off()
  deliverTermOutput(session, encode('after-off'))
  assert.deepEqual(seen, ['early', '-late', 'live'], '退订后不再收到')
  // 缓冲上限是 256 块，最早的那些会被丢掉
  const flooded = 9002
  for (let index = 0; index < 300; ++index) deliverTermOutput(flooded, encode(String(index % 10)))
  const flushed = []
  const offFlood = subscribeTerm(flooded, bytes => flushed.push(new TextDecoder().decode(bytes)))
  offFlood()
  assert.equal(flushed.length, 256)
  // 形状不对的 payload 不认领
  assert.equal(deliverTermOutput('x', 'y'), false)
  assert.equal(deliverTermOutput(1, undefined), false)
})

test('终端退出：订阅者收到退出码，退订后不再收到', () => {
  const session = 9003
  const codes = []
  const off = subscribeTermExit(session, code => codes.push(code))
  emitTermExit(session, 0)
  off()
  emitTermExit(session, 1)
  assert.deepEqual(codes, [0])
  // 没有订阅者时静默（不能让宿主那边崩）
  emitTermExit(9999, 0)
})
