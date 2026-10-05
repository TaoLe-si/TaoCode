// `src/debugSources.ts`：DAP `readMemory` 的字节（base64）→ hex+ASCII 表。
// 重点：地址算不出来时**不造地址**（符号化 memoryReference 是合法的）、不足一行的补齐让 ASCII 列对齐、
// 坏 base64 不抛异常（回空表，由调用方显示"没有数据"）。

import test from 'node:test'
import assert from 'node:assert/strict'

const { parseMemoryAddress, memoryRows } = await import('../src/debugSources.ts')

test('地址解析：0x… 与十进制认得，符号地址回 null（不造地址）', () => {
  assert.equal(parseMemoryAddress('0x1000'), 4096)
  assert.equal(parseMemoryAddress('0X1f'), 31)
  assert.equal(parseMemoryAddress('4096'), 4096)
  assert.equal(parseMemoryAddress('&var'), null)
  assert.equal(parseMemoryAddress('rbp-8'), null)
  assert.equal(parseMemoryAddress(''), null)
  assert.equal(parseMemoryAddress(undefined), null)
})

test('8 字节的 hex+ASCII 行（假适配器的 A..H 负载）', () => {
  // "QUJDREVGR0g=" 解码就是 ABCDEFGH；不足 16 字节的行补空格占位（列宽固定）。
  const rows = memoryRows('QUJDREVGR0g=', '0x1000')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].address, '0x1000')
  assert.equal(rows[0].hex.trimEnd(), '41 42 43 44 45 46 47 48')
  assert.equal(rows[0].hex.length, 47)
  assert.equal(rows[0].ascii, 'ABCDEFGH')
})

test('跨行：地址按行首递进，最后一行补齐空格让 ASCII 对齐', () => {
  // 20 个字节：0x00..0x13，可打印的只有 0x0A 之后的一小段 —— 其余显示为点。
  const bytes = Uint8Array.from({ length: 20 }, (_, index) => index)
  const base64 = Buffer.from(bytes).toString('base64')
  const rows = memoryRows(base64, '0x2000')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].address, '0x2000')
  assert.equal(rows[1].address, '0x2010', '第二行地址 = 基地址 + 16')
  assert.equal(rows[0].hex.length, 47, '16 个字节 → 16×2 + 15 个分隔符')
  assert.equal(rows[1].hex.length, 47, '不足一行的 hex 也要补齐到固定宽度（ASCII 列才对得齐）')
  assert.equal(rows[1].hex.slice(0, 11), '10 11 12 13')
  assert.ok(rows[1].hex.endsWith('  '), '缺的字节位是空格占位')
  assert.equal(rows[1].ascii.length, 4, 'ASCII 只统计真实字节')
})

test('可打印判定：0x20 与 0x7E 原样，0x1F/0x7F 与高位字节是点', () => {
  const bytes = Uint8Array.from([0x1f, 0x20, 0x7e, 0x7f, 0xc3, 0xa9])
  const rows = memoryRows(Buffer.from(bytes).toString('base64'))
  assert.equal(rows[0].ascii, '. ~...')
  assert.equal(rows[0].address, '', '没有地址时 address 是空串而不是假地址')
})

test('坏输入不抛：坏 base64 / 空载荷都没有行', () => {
  assert.deepEqual(memoryRows(undefined), [])
  assert.deepEqual(memoryRows(''), [])
  assert.deepEqual(memoryRows('!!!not-base64!!!'), [])
  assert.deepEqual(memoryRows('QUJD', undefined, 0), memoryRows('QUJD'), '非法列宽回落到 16')
})
