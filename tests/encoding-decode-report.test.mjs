// 判据 · ③「无法解码 / 编码冲突」必须说话（本轮批次：docs/batch-2026-10-06-encod2.md）
//
// 上游的同一条底线不是「报错」而是「不静默」：`CharsetToolkit.java:242-261` 猜不出编码会退回
// 项目默认编码继续读（注释 `:225-226`），`EncodingUtil.java:279-293` 把不能换编码的**原因**
// 写进 tooltip，`RemoveBomAction.java:100-106` 去不掉强制 BOM 时弹 ERROR 通知。
// 本仓读侧是严格的（`native/workspace.cpp:141-142`），所以唯一的等价物就是**把失败讲出来**：
// 这里钉的是「哪些码算编码类失败」「那句话有没有真的发出去」，以及「不许凭空发明宿主没有的码」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { decodeFailureKey, decodeFailureNotice, isDecodeFailureCode } from '../src/fileEncodingRules.ts'

// 宿主真会抛的编码类错误码：从 `fail("…")` 里抠。**两份源码都要扫** —— 2026-10-06 把编码表、
// BOM 判定与 UTF-16/UTF-32 转换整段搬进了 `native/workspace_codec.hpp`（`workspace.cpp` 只 include），
// 只读 `.cpp` 会把 ENCODING_MISMATCH / ENCODING_LOSS / ENCODING_FAILED 三条误判成「宿主不抛」。
const NATIVE_CODE_SOURCES = ['native/workspace.cpp', 'native/workspace_codec.hpp']

function nativeCodes() {
  const codes = new Set()
  for (const file of NATIVE_CODE_SOURCES) {
    for (const match of readFileSync(file, 'utf8').matchAll(/fail\("([A-Z0-9_]+)"/g)) codes.add(match[1])
  }
  return codes
}

test('编码类失败的码都是宿主真会抛的（不许有不存在的码）', () => {
  const codes = nativeCodes()
  assert.ok(codes.size > 8, `native 的 fail 码没抠出来（${codes.size} 个）—— 形状变了先去改判据的来源`)
  for (const code of ['INVALID_UTF8', 'ENCODING_MISMATCH', 'BINARY_FILE', 'ENCODING_LOSS', 'ENCODING_FAILED']) {
    assert.ok(codes.has(code), `宿主并不抛 ${code}`)
    assert.equal(isDecodeFailureCode(code), true, code)
  }
})

test('不是编码问题的失败不许被当成编码问题（NOT_FOUND / CONFLICT / READ_ONLY…）', () => {
  for (const code of ['NOT_FOUND', 'NOT_FILE', 'CONFLICT', 'READ_ONLY', 'FILE_TOO_LARGE', 'INVALID_PATH', 'INVALID_ENCODING', 'DESKTOP_REQUIRED']) {
    assert.equal(isDecodeFailureCode(code), false, code)
  }
  for (const value of [undefined, null, 7, '', 'encoding_mismatch']) assert.equal(isDecodeFailureCode(value), false)
})

test('那句话：编码类失败才有，带上路径、用的哪档编码和宿主原话；非编码失败返回 null', () => {
  const notice = decodeFailureNotice('src/Gbk.java', 'utf-8', 'INVALID_UTF8', '文件不是有效的 UTF-8 文本；若是中文旧文件，请用 GBK 编码重新打开。')
  assert.ok(notice)
  assert.match(notice, /src\/Gbk\.java/)
  assert.match(notice, /按 utf-8 读不出来/)
  assert.match(notice, /请用 GBK 编码重新打开/, '宿主的原话（含下一步怎么办）必须一起给出去')
  assert.match(notice, /旧内容/)
  const bare = decodeFailureNotice('a.txt', 'gbk', 'ENCODING_MISMATCH')
  assert.ok(bare && bare.includes('ENCODING_MISMATCH'), '没有 reason 时至少报出错误码')
  assert.equal(decodeFailureNotice('a.txt', 'gbk', 'NOT_FOUND', '不存在'), null, '文件被删不是编码事故，别混报')
  assert.equal(decodeFailureNotice('a.txt', 'gbk', undefined), null)
})

test('去重键按「路径 + 磁盘版本」算：同一版本只说一次，版本变了要重新有机会说', () => {
  assert.equal(decodeFailureKey('a.txt', '7'), decodeFailureKey('a.txt', '7'))
  assert.notEqual(decodeFailureKey('a.txt', '7'), decodeFailureKey('a.txt', '8'))
  assert.notEqual(decodeFailureKey('a.txt', '7'), decodeFailureKey('b.txt', '7'))
  assert.equal(decodeFailureKey('a.txt', undefined), 'a.txt|undefined')
})

test('磁盘同步那趟的静默 catch 已经换成了会说话的分支，并且真的去重', () => {
  const source = readFileSync('src/diskSync.ts', 'utf8')
  const fn = /async function syncOneTabFromDisk\(tab: Tab, quiet = false\) \{[\s\S]*?\n  \}/.exec(source)
  assert.ok(fn, 'syncOneTabFromDisk 找不到了')
  assert.doesNotMatch(fn[0], /catch \{ \/\* deleted or unreadable/, '静默的 catch 回来了：读不出来时必须说话')
  assert.match(fn[0], /decodeFailureNotice\(tab\.path, tab\.encoding, \(error as \{ code\?: string \}\)\?\.code, errorMessage\(error\)\)/)
  assert.match(fn[0], /deps\.notify\(notice, true\)/, '必须按 error 级发，不是普通提示')
  assert.match(fn[0], /decodeFailuresReported\.has\(key\)/, '同一版本重复触发时不许刷屏')
  assert.match(fn[0], /decodeFailuresReported\.delete\(decodeFailureKey\(tab\.path, tab\.version\)\)/,
    '读成功了就得把键放下，下次真出问题还要能再说')
  // 保存/重读/回滚那三条链路本来就在报（本轮实读核过的现状，改动它们要回来看这条）
  const ops = readFileSync('src/editorFileOps.ts', 'utf8')
  assert.match(ops, /catch \(error\) \{ notify\(errorMessage\(error\), true\) \}/)
})
