// 判据 · ① UTF-8 BOM 的写入条件（本轮批次：docs/batch-2026-10-06-encod2.md）
//
// 钉的是三件事，任何一件漂了都必须红：
//   1. 「哪几档编码有 BOM」—— 与宿主字节表 `encoding_list` 同源，
//      不靠这里的手写清单（上游同一条规则：`CharsetToolkit.java:579` `getPossibleBom`）。
//   2. 切换编码时 BOM 状态的派生 —— 上游 `VirtualFile.java:507-511` `setCharset`：
//      新编码容不下 BOM 就 `setBOM(null)`，不是留着状态骗用户。
//   3. `src/App.vue` 那个 BOM 复选框的置灰清单与本规则**必须同一份**（保留文件改不了，
//      所以用它来反向约束规则模块）。
//
// 2026-10-06：编码表、BOM 判定与 UTF-16/UTF-32 转换整段从 `native/workspace.cpp` 搬进
// `native/workspace_codec.hpp`（workspace.cpp 只 include），`encoding_list` 也补上了 UTF-32
// 两档。所以这里**两份源码都扫**、并且认带显式长度的 `std::string_view{"…", N}` 形态 ——
// UTF-32BE 的 BOM 以 NUL 开头，旧形态 `"\x00\x00\xFE\xFF"` 用 strlen 量出来是 0，量不到。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { encodingKeys } from '../src/bridge.ts'
import { bomAfterEncodingSwitch, encodingBomToggleable, encodingHasPossibleBom } from '../src/fileEncodingRules.ts'

/** 宿主编码表的源码：`workspace.cpp` 的 `encoding_list` 已搬进 `workspace_codec.hpp`。 */
const NATIVE_ENCODING_SOURCES = ['native/workspace.cpp', 'native/workspace_codec.hpp']

/** 宿主 `encoding_list` 里 BOM 字面量非空的编码档 —— 从源码里抠，不手写。 */
function bomCapableFromNative() {
  let block = null
  for (const file of NATIVE_ENCODING_SOURCES) {
    block = /const Encoding encoding_list\[\] = \{([\s\S]*?)\n\};/.exec(readFileSync(file, 'utf8'))
    if (block) break
  }
  assert.ok(block, 'native 的 encoding_list 不见了（宿主字节表换了形状或搬了文件？）')
  const capable = new Set()
  // 第三条字段是 BOM：没有 BOM 的档写作 `{}`，有的档写作 `std::string_view{"…", N}`（显式长度）。
  const entries = [...block[1].matchAll(/\{"([^"]+)",\s*[^,]+,\s*(?:\{\}|std::string_view\{("(?:[^"\\]|\\.)*"),\s*(\d+)\})\}/g)]
  assert.ok(entries.length >= 4, `encoding_list 至少该有 4 条，实际 ${entries.length} 条`)
  for (const [, key, , bomLength] of entries) if (bomLength && Number(bomLength) > 0) capable.add(key)
  return { capable, count: entries.length, keys: entries.map(entry => entry[1]) }
}

test('BOM 能力清单 = 宿主 encoding_list 里 BOM 字面量非空的那几档（两份清单不许漂移）', () => {
  const { capable, keys } = bomCapableFromNative()
  assert.deepEqual(keys, [...encodingKeys], 'encoding_list 的档数必须与 bridge 的 encodingKeys 同')
  for (const key of encodingKeys) {
    assert.equal(encodingHasPossibleBom(key), capable.has(key), `${key} 的 BOM 能力与宿主不一致`)
  }
  // 上游 CharsetToolkit.java:86-92 + :579：UTF-8 可选、UTF-16/UTF-32 强制、gbk/cp1252/system 根本没有 BOM。
  assert.deepEqual([...capable].sort(), ['utf-16be', 'utf-16le', 'utf-32be', 'utf-32le', 'utf-8'])
})

test('切到没有 BOM 的编码 ⇒ 状态必须抹掉（上游 VirtualFile.setCharset:509-511）', () => {
  for (const key of ['gbk', 'cp1252', 'system']) {
    assert.equal(bomAfterEncodingSwitch(key, true), false, `${key} 留着 bom=true 就是说谎`)
    assert.equal(bomAfterEncodingSwitch(key, false), false)
  }
})

test('切到 UTF-8 ⇒ 原状态保留；切到 UTF-16 ⇒ BOM 强制（上游 getMandatoryBom + setCharset:507-511）', () => {
  assert.equal(bomAfterEncodingSwitch('utf-8', true), true, 'UTF-8 是可选档，原本带着就继续带')
  assert.equal(bomAfterEncodingSwitch('utf-8', false), false, 'UTF-8 没带也不会自动补')
  // 上游 `CharsetToolkit.java:86-92` 给 UTF-16LE/BE 的是**强制** BOM，`VirtualFile.setCharset`
  // 先取强制值、根本不看原状态 ⇒ 用户没有「关掉 UTF-16 的 BOM」这一选（字节序全靠它标记）。
  // 复选框那一头因此同时被 `encodingBomToggleable` 关掉（见下一条），两边必须同批，
  // 否则就是「界面说能关、写出去还是带」的假控件。
  for (const key of ['utf-16le', 'utf-16be']) {
    assert.equal(bomAfterEncodingSwitch(key, true), true, key)
    assert.equal(bomAfterEncodingSwitch(key, false), true, `${key} 的强制 BOM 不能被"取消勾选"抹掉`)
  }
})

test('BOM 复选框的置灰取自规则模块，且只放开 UTF-8 一档（编码档清单只有一份）', () => {
  const source = readFileSync('src/App.vue', 'utf8')
  const line = source.split('\n').find(text => text.includes('encoding-bom') && text.includes(':disabled'))
  assert.ok(line, 'App.vue 里那行 BOM 复选框不见了')
  assert.match(line, /:disabled="!encodingBomToggleable\(encodingPrompt\.encoding\)"/,
    '置灰条件必须走 fileEncodingRules（强制档 + 无 BOM 概念档都不开放），模板里不许再写一遍编码清单')
  assert.doesNotMatch(line, /encodingPrompt\.encoding ===/, '模板里残留的手写编码清单正是会漂的那一半')
  // 规则本身：可勾的只有「有 BOM 概念又不强制」的 UTF-8。
  assert.deepEqual(encodingKeys.filter(encodingBomToggleable), ['utf-8'])
  assert.deepEqual(encodingKeys.filter(key => !encodingBomToggleable(key)).sort(),
    ['cp1252', 'gbk', 'system', 'utf-16be', 'utf-16le', 'utf-32be', 'utf-32le'],
    '强制 BOM 的四档（UTF-16/UTF-32 两对，关不掉）与根本没有 BOM 概念的三档（勾了没反应）都不该给勾')
  // 换编码时那一次派生也必须由模板发起，否则 `openEncoding` 里派生过一次、用户之后改档就没人管了。
  const select = source.split('\n').find(text => text.includes('encoding-select'))
  assert.ok(select, '编码下拉那一行不见了')
  assert.match(select, /@change="encodingPrompt\.bom = bomAfterEncodingSwitch\(encodingPrompt\.encoding, encodingPrompt\.bom\)"/,
    '改档当下就要按规则重派生 BOM，残留的勾会让通知与状态栏都说「带 BOM」')
})

test('两个编码动作都走规则，且被抹掉 BOM 时通知里要说为什么（不许只报「带 BOM」）', () => {
  const source = readFileSync('src/editorFileOps.ts', 'utf8')
  const open = /function openEncoding\(\) \{[\s\S]*?\n\}/.exec(source)
  assert.ok(open, 'openEncoding 找不到了')
  assert.match(open[0], /bomAfterEncodingSwitch\(tab\.encoding, tab\.bom\)/,
    '弹层初始值必须按规则派生，否则置灰的复选框会显示残留的 true')
  const apply = /function applyEncodingChoice\(\) \{[\s\S]*?\n\}/.exec(source)
  assert.ok(apply, 'applyEncodingChoice 找不到了')
  assert.match(apply[0], /const bom = bomAfterEncodingSwitch\(choice\.encoding, wantedBom\)/)
  assert.match(apply[0], /tab\.bom = bom/, '写回 tab.bom 的地方必须用派生值')
  assert.match(apply[0], /wantedBom && !bom/, '抹掉 BOM 时通知里必须解释，不能继续说「带 BOM」')
  assert.doesNotMatch(apply[0], /choice\.bom \? '（带 BOM）'/, '不许再直接拿 choice.bom 当结论')
})
