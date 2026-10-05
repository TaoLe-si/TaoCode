// 原生回调的**捕获语义**门禁。
//
// 为什么需要它（2026-10-04 真机崩溃，已修复）：`native/gradle.cpp` 的 `start_sync` 把调用方传进来的
// 临时 `std::function` 用 `[&emit]` 捕获，然后交给后台同步线程 —— 处理器一返回捕获就悬空。
// Gradle 推第一批输出时调到已死对象 → `std::bad_function_call` → `terminate` → `abort()` →
// 进程以 0xC0000409 退出（症状：打开带 Gradle 工程的工程一秒内崩；还原出的调用链见 HANDOFF）。
//
// **为什么用源码级判据而不是行为用例**：悬空调用是 UB，行为用例在"内存刚好没被复用"时会**假绿**。
// 我写过那条行为用例（native/gradle_test.cpp 里"临时 emit 回调…"），把捕获改回 `[&emit]` 后它照样
// 通过 —— 所以守卫放在这里：能读到源码，就在改回引用捕获的那一秒变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const nativeFiles = readdirSync(join(root, 'native')).filter(name => name.endsWith('.cpp') && !/_test\.cpp$/.test(name))

test('没有任何原生回调被按引用捕获（emit/done/sender 这组名字都要按值）', () => {
  // 这些名字在本仓的约定是"交给后台线程/长生命周期对象的回调"：它们必须按值捕获，否则调用方
  // 一返回就悬空。`[&emit]` 是这次事故的原样；其余几个是同一族，一起挡住。
  const offenders = []
  for (const file of nativeFiles) {
    const text = readFileSync(join(root, 'native', file), 'utf8')
    for (const name of ['emit', 'done', 'sender', 'on_chunk', 'on_exit']) {
      if (text.includes(`[&${name}]`)) offenders.push(`${file}: [&${name}]`)
    }
  }
  assert.deepEqual(offenders, [], `这些回调按引用捕获了：\n${offenders.join('\n')}\n` +
    '按值捕获（`[sink = emit]`）：后台线程可能在调用方返回之后才调到它。')
})

test('gradle::start_sync 的两个后台回调确实是按值捕获', () => {
  const text = readFileSync(join(root, 'native', 'gradle.cpp'), 'utf8')
  assert.equal((text.match(/\[sink = emit\]/g) ?? []).length, 2,
    'start_sync 的 output/exit 两个回调都要 `[sink = emit]`（少一个就是又漏了）')
  assert.doesNotMatch(text, /\[&emit\]/, '不能回到按引用捕获 —— 那是 0xC0000409 的成因')
})
