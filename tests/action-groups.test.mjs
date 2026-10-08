// 判据 · **动作组贡献通道**（`src/actionGroups.ts`，上游 `DefaultActionGroup` + `<add-to-group>`）
// 以及它接上的真实消费者（`src/appMainMenu.ts` 的主菜单装配）。
//
// 钉三件事：
//   ① `parseAddToGroup` 的四档锚、缺省 last、before/after 必须有 relative-to-action、缺 group-id 报错；
//   ② `applyGroupMembers` 的插入语义（first 头插 / last 尾加 / before|after 按相对 id 找位、
//      前向引用挂起重试、悬空进 errors、同 id 重复先移除再加）；
//   ③ 第三方按 `com.intellij.action` EP 挂一条带 `addToGroup` 的动作，`mergeGroupRows` 真把它
//      并进组里（不是死代码），且主菜单装配点真的调了它。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ACTION_EP, EXTENSIONS } from '../src/extensionPoints.ts'
import {
  applyGroupMembers, groupMembersFromExtensions, mainMenuGroupId, mergeGroupRows, parseAddToGroup,
  registerActionWithGroup,
} from '../src/actionGroups.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const row = (id, over = {}) => ({ id, ...over })

test('parseAddToGroup：四档锚、缺省 last、缺 relative-to-action 与坏锚报错', () => {
  // 缺 group-id：上游 "attribute group-id should be defined"。
  assert.equal(parseAddToGroup(undefined).ok, false)
  assert.equal(parseAddToGroup({ anchor: 'last' }).ok, false)
  // 缺省锚 = last（ActionManagerXmlSupport.kt:231）。
  assert.deepEqual(parseAddToGroup({ groupId: 'ViewMenu' }), {
    ok: true, placement: { groupId: 'ViewMenu', anchor: 'last' },
  })
  // 大小写不敏感（上游 equals(ignoreCase = true)）。
  assert.equal(parseAddToGroup({ groupId: 'G', anchor: 'FIRST' }).placement?.anchor, 'first')
  assert.equal(parseAddToGroup({ groupId: 'G', anchor: 'Last' }).placement?.anchor, 'last')
  // before/after 带相对 id。
  assert.deepEqual(parseAddToGroup({ groupId: 'G', anchor: 'after', relativeTo: 'a' }), {
    ok: true, placement: { groupId: 'G', anchor: 'after', relativeTo: 'a' },
  })
  // before/after 缺相对 id：上游 :787-790 报错。
  assert.equal(parseAddToGroup({ groupId: 'G', anchor: 'before' }).ok, false)
  // 认不出的锚报错，不静默。
  assert.equal(parseAddToGroup({ groupId: 'G', anchor: 'middle' }).ok, false)
})

test('applyGroupMembers：first/last/before/after 的插入位置', () => {
  const base = [row('b'), row('c'), row('d')]
  const member = (id, placement) => ({ row: row(id), placement })
  const { rows, errors } = applyGroupMembers(base, [
    member('e', { groupId: 'G', anchor: 'last' }),
    member('a', { groupId: 'G', anchor: 'first' }),
    member('x', { groupId: 'G', anchor: 'before', relativeTo: 'c' }),
    member('y', { groupId: 'G', anchor: 'after', relativeTo: 'd' }),
  ])
  // e 先按 last 追加到尾；随后 y 按 after d 插到 d 的正后方 ⇒ 落在 e 之前（逐条 addAction 的
  // 位置就是「当时的相对位置」，上游 DefaultActionGroup 同款）。
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'x', 'c', 'd', 'y', 'e'])
  assert.deepEqual(errors, [])
  // base 不被改写。
  assert.deepEqual(base.map(r => r.id), ['b', 'c', 'd'])
})

test('applyGroupMembers：前向引用挂起重试，悬空进 errors', () => {
  // 贡献按声明顺序处理：第一条 relative 指向后一条插入的 id ⇒ 首轮挂起，末轮补上。
  const { rows, errors } = applyGroupMembers([row('z')], [
    { row: row('afterZ'), placement: { groupId: 'G', anchor: 'after', relativeTo: 'z' } },
    { row: row('beforeZ'), placement: { groupId: 'G', anchor: 'before', relativeTo: 'z' } },
  ])
  assert.deepEqual(rows.map(r => r.id), ['beforeZ', 'z', 'afterZ'])
  assert.deepEqual(errors, [])
  // 相对 id 始终不出现 ⇒ 不硬塞，进 errors。
  const dangling = applyGroupMembers([row('a')], [
    { row: row('q'), placement: { groupId: 'G', anchor: 'before', relativeTo: 'missing' } },
  ])
  assert.deepEqual(dangling.rows.map(r => r.id), ['a'])
  assert.equal(dangling.errors.length, 1)
  assert.match(dangling.errors[0], /missing/)
})

test('applyGroupMembers：同 id 重复先移除再加（last 尾加、first 头插）', () => {
  const { rows } = applyGroupMembers([row('a'), row('b'), row('c')], [
    { row: row('a', { title: '新' }), placement: { groupId: 'G', anchor: 'last' } },
  ])
  assert.deepEqual(rows.map(r => r.id), ['b', 'c', 'a'])
  assert.equal(rows[2].title, '新')
})

test('EP → 组：第三方按 com.intellij.action 挂带 addToGroup 的动作，mergeGroupRows 真并进组', () => {
  const handle = EXTENSIONS.registerExtension(ACTION_EP, 'demo.contributed', {
    id: 'demo.contributed', title: '演示贡献', run: () => {},
    addToGroup: { groupId: 'ViewMenu', anchor: 'after', relativeTo: 'view.appearance' },
  })
  try {
    const base = [row('view.appearance'), row('view.statusBar')]
    const merged = mergeGroupRows('ViewMenu', base)
    assert.deepEqual(merged.map(r => r.id), ['view.appearance', 'demo.contributed', 'view.statusBar'])
    assert.equal(merged[1].title, '演示贡献')
    // 别的组看不到它。
    assert.deepEqual(mergeGroupRows('HelpMenu', base).map(r => r.id), ['view.appearance', 'view.statusBar'])
    // 读成员时带出的解析错误为空。
    assert.deepEqual(groupMembersFromExtensions('ViewMenu').errors, [])
  } finally {
    handle.dispose()
  }
  // 注销后不再出现。
  assert.deepEqual(mergeGroupRows('ViewMenu', [row('view.appearance')]).map(r => r.id), ['view.appearance'])
})

test('插件 API：registerActionWithGroup 注册即进组、坏 placement 抛错、dispose 注销', () => {
  // 坏 placement 在**注册时**就抛（不静默造出"写了却没生效"的假贡献）。
  assert.throws(() => registerActionWithGroup({ id: 'demo.bad', run: () => {} }, { anchor: 'first' }), /group-id/)
  assert.throws(() => registerActionWithGroup({ id: 'demo.bad', run: () => {} }, { groupId: 'HelpMenu', anchor: 'before' }), /relative-to-action/)
  const handle = registerActionWithGroup(
    { id: 'demo.pluginAction', title: '插件动作', run: () => {} },
    { groupId: 'ToolsMenu', anchor: 'first' },
  )
  try {
    const merged = mergeGroupRows('ToolsMenu', [row('tools.a')])
    assert.deepEqual(merged.map(r => r.id), ['demo.pluginAction', 'tools.a'])
  } finally {
    handle.dispose()
  }
  assert.deepEqual(mergeGroupRows('ToolsMenu', [row('tools.a')]).map(r => r.id), ['tools.a'])
})

test('接线：appMainMenu 真的把各档并进对应上游组 id', () => {
  assert.equal(mainMenuGroupId('view'), 'ViewMenu')
  assert.equal(mainMenuGroupId('file'), 'FileMenu')
  assert.equal(mainMenuGroupId('help'), 'HelpMenu')
  // 表里没有的键用键本身兜底。
  assert.equal(mainMenuGroupId('custom'), 'custom')
  const source = read('src/appMainMenu.ts')
  assert.match(source, /mergeGroupRows\(mainMenuGroupId\(group\.menu\)/)
  // 静态字面量必须仍在（`tests/main-menu-parity.test.mjs` 按它切片）。
  assert.match(source, /const menus: \{[^}]*\}\[\] = \[/)
})
