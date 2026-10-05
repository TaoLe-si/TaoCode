// 「附加到进程」的标识解析与远程附加说明（`src/debugAttach.ts` + `DebugPanel.vue` 的接线）。
//
// 上游：`XAttachDebuggerProvider` 一族（`XLocalAttachDebugger` 管本机 PID、`WslAttachHost` 管
// WSL 主机）。本仓只有本机通道（`exec/wsl`/`pf/remote` 判 `[-]`），所以界面上要**如实写清**
// 远程附加靠 `TaoCode.dap.json` 里配置的适配器自己连过去，而不是暗示本仓有远程后端。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { attachGuidance, attachSelectorError, parseAttachSelector } = await import('../src/debugAttach.ts')

test('纯数字 = 本机 PID；超出安全整数或 0 按非法处理', () => {
  assert.deepEqual(parseAttachSelector('4242'), { kind: 'pid', processId: 4242 })
  assert.deepEqual(parseAttachSelector(' 4242 '), { kind: 'pid', processId: 4242 }, 'trim 后解析')
  assert.equal(parseAttachSelector('0'), null, 'PID 0 是空闲进程，不是可附加目标')
  assert.equal(parseAttachSelector('99999999999999999999'), null)
  assert.equal(parseAttachSelector(''), null)
})

test('非数字 = 适配器约定的连接标识（管道名 / host:port）', () => {
  assert.deepEqual(parseAttachSelector('\\\\.\\pipe\\dbg'), { kind: 'pipe', pipeName: '\\\\.\\pipe\\dbg' })
  assert.deepEqual(parseAttachSelector('127.0.0.1:5678'), { kind: 'pipe', pipeName: '127.0.0.1:5678' })
})

test('就地错误文案：空串与非法 PID 说清各自的原因', () => {
  assert.match(attachSelectorError(''), /请填写/)
  assert.match(attachSelectorError('0'), /大于 0 的整数/)
  assert.equal(attachSelectorError('4242'), '')
  assert.equal(attachSelectorError('127.0.0.1:5678'), '')
})

test('提示逐适配器给真实形态，并点明本仓没有远程后端', () => {
  assert.match(attachGuidance('cppvsdbg'), /本机进程 PID/)
  assert.match(attachGuidance('lldb-dap'), /lldb-server/)
  assert.match(attachGuidance('java'), /jdwp/)
  for (const kind of ['cppvsdbg', 'lldb-dap', 'java', 'debugpy', 'whatever', ''])
    assert.match(attachGuidance(kind), /远程附加：.+TaoCode\.dap\.json/s, `${kind} 的说明要写清远程附加的前提`)
  assert.ok(!attachGuidance('cppvsdbg').includes('WSL 可用'), '不许暗示本仓有 WSL 通道')
})

// —— 面板接线 ——

const panel = readFileSync('src/components/DebugPanel.vue', 'utf8')

test('附加走解析后的 processId / pipeName，非法输入就地报错', () => {
  assert.match(panel, /const problem = attachSelectorError\(selector\)/)
  assert.match(panel, /parsed\.kind === 'pid' \? \{ processId: parsed\.processId \} : \{ pipeName: parsed\.pipeName \}/)
  assert.match(panel, /configuration: \{ request: 'attach', \.\.\.configuration \}/)
})

test('界面渲染适配器相关的附加说明', () => {
  assert.match(panel, /attachGuidance\(kind\.value\)/)
  assert.match(panel, /\{\{ attachText \}\}/)
})
