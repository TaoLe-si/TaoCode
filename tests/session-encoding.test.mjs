// 会话快照里的**按文件编码记忆**（`pf/vfs` 的 `encoding` 一族在本仓的落点）：
//   · 快照侧 `sessionTabEntry` 把合法的 `EncodingKey` 写进条目；
//   · 恢复侧 `restoredReadParams` 按它读盘 —— 否则崩溃后恢复 GBK 文件会被当 UTF-8 读成乱码。
// 上游对照：按文件编码记忆在 `EncodingProjectManagerImpl`（`.idea/encodings.xml`），
// `ChangeFileEncodingAction` 的"重新按编码读取"在 `src/editorFileOps.ts`；本仓没有
// 工程级编码存储，会话快照是跨重启能留存这一笔的唯一通道。
import test from 'node:test'
import assert from 'node:assert/strict'

import { restoredReadParams, sessionEncoding, sessionTabEntry, SESSION_ENCODINGS } from '../src/sessionEncodings.ts'
import { encodingKeys } from '../src/bridge.ts'

test('合法编码清单与 bridge 的 encodingKeys 是同一份（两份清单不许漂移）', () => {
  assert.deepEqual([...SESSION_ENCODINGS].sort(), [...encodingKeys].sort())
})

test('合法编码写进条目；不认识的键丢掉（不把任意串喂给宿主）', () => {
  assert.equal(sessionEncoding('gbk'), 'gbk')
  assert.equal(sessionEncoding('utf-16le'), 'utf-16le')
  assert.equal(sessionEncoding('latin-1'), undefined)
  assert.equal(sessionEncoding(undefined), undefined)
  assert.equal(sessionEncoding(7), undefined)
  for (const key of encodingKeys) assert.equal(sessionEncoding(key), key)
})
test('条目形状：位置/草稿/编码都在，缺编码时不写字段', () => {
  assert.deepEqual(sessionTabEntry({ path: 'src/a.java', line: 3, column: 5, encoding: 'gbk' }, 1, 'draft'), {
    path: 'src/a.java', line: 3, column: 5, pane: 1, draft: 'draft', encoding: 'gbk',
  })
  assert.deepEqual(sessionTabEntry({ path: 'src/b.java', line: 1, column: 1 }, 0), {
    path: 'src/b.java', line: 1, column: 1, pane: 0,
  })
  assert.deepEqual(sessionTabEntry({ path: 'src/c.java', line: 2, column: 2, encoding: 'nope' }, 0), {
    path: 'src/c.java', line: 2, column: 2, pane: 0,
  }, '非法编码按"没记住"处理')
})

test('恢复读盘：带编码就按它读，没带就按宿主默认', () => {
  assert.deepEqual(restoredReadParams({ path: 'src/a.java', line: 1, column: 1, pane: 0, encoding: 'gbk' }), { path: 'src/a.java', encoding: 'gbk' })
  assert.deepEqual(restoredReadParams({ path: 'src/b.java', line: 1, column: 1, pane: 0 }), { path: 'src/b.java' })
})
