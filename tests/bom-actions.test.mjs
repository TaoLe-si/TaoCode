// 判据 · BOM 的两条动作（上游 `AddBomAction` / `RemoveBomAction` 的纯规则）。
//
// 钉的是四件事，任何一件漂了都必须红：
//   1. **两条动作的可用性判据**（上游 `update` 里的三条与 / 那条不对称的 `getBOM() != null`）；
//   2. **执行后 bom 位与提示**（上游 `doAddBOM` / `doRemoveBOM` 的早退与 `setBOM`，以及强制档那条 ERROR）；
//   3. **编码清单只有一份** —— 本模块不许自己列 UTF-8/UTF-16，必须走 `src/fileEncodingRules.ts`
//      （那份对着 `CharsetToolkit.java:86-92/:579/:584` 写，`tests/encoding-bom.test.mjs` 已钉它）；
//   4. **菜单两行的形状与顺序**（`LangActions.xml:517-522`：移除在前、添加在后，都跟在「文件编码…」之后；
//      `$default.xml` 一族没有 BOM 键位 ⇒ 不带 keys）。
//
// 上游坐标（2026-10-07 逐行实读，树根 D:\Backup\...\intellij-community-master，只读）：
//   AddBomAction.java:31-43 update / :46-50 actionPerformed / :52-68 doAddBOM
//   RemoveBomAction.java:43-50 update / :52-69 computeFromWhere / :71-109 actionPerformed
//                        / :111-113 isBOMMandatory / :115-125 doRemoveBOM
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ADD_BOM_TEXT, REMOVE_BOM_TEXT, REMOVING_BOM_PROGRESS,
  addBomDescription, addBomOutcome, addBomState, createBomMenuRows,
  removeBomDescription, removeBomFailedTitle, removeBomMandatoryContent,
  removeBomOutcome, removeBomState,
} from '../src/bomActions.ts'
import { encodingHasPossibleBom, encodingMandatoryBom } from '../src/fileEncodingRules.ts'
import { encodingKeys } from '../src/bridge.ts'

/** 一个目标文件的假件（`Tab` 的 BOM 相关四项）。 */
function target(overrides = {}) {
  return { name: 'a.txt', bom: false, encoding: 'utf-8', ...overrides }
}

// ---------------------------------------------------------------- ① 可用性

test('添加：三条与缺一即置灰（上游 AddBomAction.java:33/35/37-38）', () => {
  // 没有文件 —— :33 `file != null`
  assert.deepEqual(addBomState(undefined), {
    enabled: false, disabledBecause: 'no-file', description: addBomDescription(undefined),
  })
  // 已经有 BOM —— :35 `file.getBOM() == null`
  assert.equal(addBomState(target({ bom: true })).disabledBecause, 'already-has-bom')
  assert.equal(addBomState(target({ bom: true })).enabled, false)
  // 编码没有 BOM 概念 —— :37-38 `getPossibleBom(charset) != null`（gbk / cp1252 / system）
  for (const encoding of ['gbk', 'cp1252', 'system']) {
    assert.equal(addBomState(target({ encoding })).disabledBecause, 'encoding-has-no-bom', encoding)
    assert.equal(addBomState(target({ encoding })).enabled, false, encoding)
  }
  // UTF-8 无 BOM：唯一可用档
  assert.deepEqual(addBomState(target()), {
    enabled: true, disabledBecause: null, description: addBomDescription('a.txt'),
  })
  // UTF-16/UTF-32 无 BOM 时**也**可用：上游只看 getPossibleBom（强制档它非 null）
  for (const encoding of ['utf-16le', 'utf-16be', 'utf-32be', 'utf-32le']) {
    assert.equal(addBomState(target({ encoding })).enabled, true, `${encoding} 的 getPossibleBom 非 null ⇒ 可加`)
  }
})

test('移除：只看有没有 BOM，**不看**编码是否强制（上游 RemoveBomAction.java:63 与 :43-50）', () => {
  assert.equal(removeBomState(undefined).disabledBecause, 'no-file')
  assert.equal(removeBomState(undefined).enabled, false)
  assert.equal(removeBomState(target({ bom: false })).disabledBecause, 'no-bom')
  assert.equal(removeBomState(target({ bom: false })).enabled, false)
  assert.deepEqual(removeBomState(target({ bom: true })), {
    enabled: true, disabledBecause: null, description: removeBomDescription('a.txt'),
  })
  // 关键不对称：UTF-16 带 BOM 时「移除」照样**可用**（强制档去不掉，是执行时报 ERROR，
  // 不是置灰 —— 上游 computeFromWhere 里没有 getMandatoryBom 这一问）。
  for (const encoding of ['utf-16le', 'utf-16be', 'utf-32be', 'utf-32le']) {
    assert.equal(removeBomState(target({ bom: true, encoding })).enabled, true, encoding)
  }
})

test('只读档不参与置灰（上游 update 三条与里没有可写性；AddBomAction.java:31-43）', () => {
  assert.equal(addBomState(target({ readOnly: true })).enabled, true)
  assert.equal(removeBomState(target({ bom: true, readOnly: true })).enabled, true)
})

test('两条动作都**不看**有没有打开文件以外的东西 —— 置灰理由就是那五种之一或 null', () => {
  const reasons = new Set([
    addBomState(undefined).disabledBecause, addBomState(target({ bom: true })).disabledBecause,
    addBomState(target({ encoding: 'gbk' })).disabledBecause, addBomState(target()).disabledBecause,
    removeBomState(undefined).disabledBecause, removeBomState(target()).disabledBecause,
    removeBomState(target({ bom: true })).disabledBecause,
  ])
  assert.deepEqual([...reasons].sort(), [null, 'already-has-bom', 'encoding-has-no-bom', 'no-bom', 'no-file'].sort())
})

// ---------------------------------------------------------------- ② 执行后

test('添加成功 = 标记翻 true、正文不动、要标脏（上游 doAddBOM:59-64）', () => {
  const out = addBomOutcome(target())
  assert.equal(out.changed, true)
  assert.equal(out.bom, true)
  assert.equal(out.dirty, true)
  assert.equal(out.error, false)
  assert.match(out.notice, /添加字节顺序标记/)
  assert.match(out.notice, /未保存/, '上游是立刻写盘，本仓落盘在保存 ⇒ 必须说未保存（模块头的如实差异）')
})

test('添加的早退与上游 doAddBOM 的两条 if 一一对应（:54-55、:56-57）', () => {
  const already = addBomOutcome(target({ bom: true }))
  assert.equal(already.changed, false)
  assert.equal(already.bom, true)
  assert.equal(already.dirty, false)
  const noConcept = addBomOutcome(target({ encoding: 'gbk' }))
  assert.equal(noConcept.changed, false)
  assert.equal(noConcept.bom, false)
  assert.equal(noConcept.dirty, false)
})

test('移除成功 = 标记翻 false（上游 doRemoveBOM:116）', () => {
  const out = removeBomOutcome(target({ bom: true }))
  assert.equal(out.changed, true)
  assert.equal(out.bom, false)
  assert.equal(out.dirty, true)
  assert.equal(out.error, false)
  assert.match(out.notice, /移除字节顺序标记/)
  assert.match(out.notice, /未保存/)
})

test('强制 BOM 档去不掉：不改标记 + error 级（上游 :91-93 进 filesUnableToProcess，:100-106 发 ERROR）', () => {
  for (const encoding of ['utf-16le', 'utf-16be', 'utf-32be', 'utf-32le']) {
    const out = removeBomOutcome(target({ bom: true, encoding }))
    assert.equal(out.changed, false, encoding)
    assert.equal(out.bom, true, `${encoding} 的强制 BOM 必须原样留着`)
    assert.equal(out.dirty, false, encoding)
    assert.equal(out.error, true, `${encoding} 那条是 ERROR 通知`)
    assert.match(out.notice, /无法移除/)
    assert.match(out.notice, /强制性 BOM/)
  }
  // 非强制档（UTF-8）不报错 —— 对照组
  assert.equal(removeBomOutcome(target({ bom: true, encoding: 'utf-8' })).error, false)
})

test('没有 BOM 时移除是无操作（上游 :78 收集为空直接 return）', () => {
  const out = removeBomOutcome(target({ bom: false }))
  assert.equal(out.changed, false)
  assert.equal(out.bom, false)
  assert.equal(out.dirty, false)
  assert.equal(out.error, false)
})

test('只读档只在成功档被提一句（上游不置灰、写盘失败只记 warn；本仓不静默）', () => {
  assert.match(addBomOutcome(target({ readOnly: true })).notice, /只读/)
  assert.match(removeBomOutcome(target({ bom: true, readOnly: true })).notice, /只读/)
  assert.doesNotMatch(addBomOutcome(target()).notice, /只读/)
  assert.doesNotMatch(removeBomOutcome(target({ bom: true })).notice, /只读/)
})

// ---------------------------------------------------------------- ③ 编码清单只有一份

test('本模块不许自带编码清单 —— 判定必须走 fileEncodingRules（单一来源）', () => {
  const source = readFileSync('src/bomActions.ts', 'utf8')
  for (const key of ['utf-16le', 'utf-16be', 'utf-32be', 'utf-32le', 'utf-8']) {
    // 注释里可以提，代码里不许出现编码字面量（`'utf-16le'` 这种字符串）
    assert.doesNotMatch(source, new RegExp(`['"]${key}['"]`), `${key} 被硬编码进了 bomActions.ts`)
  }
  assert.match(source, /encodingHasPossibleBom, encodingMandatoryBom \} from '\.\/fileEncodingRules\.ts'/)
})

test('两条动作的编码判据 = fileEncodingRules 的同一份（逐档交叉核对）', () => {
  for (const encoding of encodingKeys) {
    const capable = encodingHasPossibleBom(encoding)
    const mandatory = encodingMandatoryBom(encoding)
    // 添加：能力来自 getPossibleBom（AddBomAction.java:37）
    assert.equal(addBomState(target({ encoding })).enabled, capable, `添加·${encoding}`)
    // 移除：不看能力也不看强制，只看 getBOM（RemoveBomAction.java:63）
    assert.equal(removeBomState(target({ bom: true, encoding })).enabled, true, `移除·${encoding}`)
    // 执行：强制档拒绝（RemoveBomAction.java:112）
    if (mandatory) assert.equal(removeBomOutcome(target({ bom: true, encoding })).error, true, encoding)
  }
})

// ---------------------------------------------------------------- ④ 菜单两行

test('菜单顺序：移除在前、添加在后（LangActions.xml:517-522 的 add-to-group 链）', () => {
  const rows = createBomMenuRows({ active: { value: target() }, addBom: () => {}, removeBom: () => {} })
  assert.deepEqual(rows.map(row => row.id), ['file.removeBom', 'file.addBom'])
  assert.deepEqual(rows.map(row => row.title), [REMOVE_BOM_TEXT, ADD_BOM_TEXT])
  assert.deepEqual(rows.map(row => row.title), ['移除 BOM', '添加 BOM'])
})

test('两行不带快捷键：10 份键位表里一个 Bom 条目都没有（$default.xml 1308 行实测）', () => {
  const rows = createBomMenuRows({ active: { value: target() }, addBom: () => {}, removeBom: () => {} })
  for (const row of rows) assert.equal(row.keys, undefined, `${row.id} 不许写 keys`)
})

test('两行常驻、置灰靠 enabled()（上游 setVisible(enabled || isMainMenuOrActionSearch(place))）', () => {
  const ctx = { active: { value: undefined }, addBom: () => {}, removeBom: () => {} }
  const rows = createBomMenuRows(ctx)
  // 没有文件时两行仍在（可见但置灰），不是条件渲染掉
  assert.equal(rows.length, 2)
  assert.equal(rows[0].enabled(), false)
  assert.equal(rows[1].enabled(), false)
  ctx.active.value = target()
  assert.equal(rows[0].enabled(), false, 'UTF-8 无 BOM 时「移除」灰')
  assert.equal(rows[1].enabled(), true, 'UTF-8 无 BOM 时「添加」亮')
  ctx.active.value = target({ bom: true })
  assert.equal(rows[0].enabled(), true, '带 BOM 时「移除」亮')
  assert.equal(rows[1].enabled(), false, '带 BOM 时「添加」灰')
})

test('两行各自触发自己那条动作，不串（run 只调对应回调）', () => {
  const calls = []
  const rows = createBomMenuRows({
    active: { value: target() },
    addBom: () => calls.push('add'), removeBom: () => calls.push('remove'),
  })
  rows[0].run()
  rows[1].run()
  assert.deepEqual(calls, ['remove', 'add'])
})

// ---------------------------------------------------------------- 文案（资源包原文）

test('文案是资源包原文（中文包取到就用中文，坐标写在模块注释里）', () => {
  assert.equal(ADD_BOM_TEXT, '添加 BOM')          // ActionsBundle.properties:32（zh）
  assert.equal(REMOVE_BOM_TEXT, '移除 BOM')       // ActionsBundle.properties:1640（zh）
  assert.equal(REMOVING_BOM_PROGRESS, '正在移除 BOM')  // IdeBundle.properties:2222（zh）
  assert.equal(addBomDescription('a.txt'), '向 a.txt 添加字节顺序标记')   // IdeBundle.properties:360（zh）
  assert.equal(removeBomDescription('a.txt'), '从 a.txt 中移除字节顺序标记')  // :2221（zh）
  assert.equal(removeBomFailedTitle(1), '无法移除 1 文件中的 BOM')        // :1693（zh，两分支同词）
  assert.equal(removeBomMandatoryContent(['a.txt']), '此文件具有强制性 BOM：a.txt')       // :1624（zh）
  assert.equal(removeBomMandatoryContent(['a.txt', 'b.txt']), '这些文件具有强制性 BOM：a.txt、b.txt')
})

test('禁用档的说明不带文件名（上游传 null 进同一条消息；AddBomAction.java:42）', () => {
  assert.equal(addBomState(undefined).description, addBomDescription(undefined))
  assert.doesNotMatch(addBomState(undefined).description, /a\.txt/)
  assert.equal(removeBomState(undefined).description, removeBomDescription(undefined))
})