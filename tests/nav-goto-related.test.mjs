// 「相关符号」的 provider 表与三档结果（`src/navGotoRelated.ts`）+ 三个导航动作的宿主接线
// （`src/lspNavigation.ts` 的 `gotoSuper` / `gotoTest` / `gotoRelated`）。
//
// 上游依据（逐条，已在本地树按行核过）：
//   · 三档结果：`platform/lang-impl/src/com/intellij/ide/actions/GotoRelatedSymbolAction.kt:63-82`
//     —— 空 → 气泡（`:69`，文案 `platform/lang-api/resources/messages/LangBundle.properties:138`
//     "No related symbols"）；恰好一条 → `items[0].navigate()`（`:77-79`，**不出现弹层**）；
//     多条 → 弹层，标题 `LangBundle.properties:350`（"Choose Target"，`:81`）。
//   · 条目带分组：`platform/lang-api/src/com/intellij/navigation/GotoRelatedItem.java:23-43`
//     （`:24` `getGroup()`，`:27` `DEFAULT_GROUP_NAME = ""` = 不加分隔）。
//   · 第一个 provider 是「测试 ↔ 被测对象」：
//     `platform/lang-impl/src/com/intellij/testIntegration/GotoTestRelatedProvider.java:23-44`，
//     分组标题 `CodeInsightBundle.properties:561-562`（"Tests" / "Tested classes"）。
//   · 键位：GotoRelated = Ctrl+Alt+Home（`platform/platform-resources/src/keymaps/$default.xml:257-259`）、
//     GotoSuperMethod = Ctrl+U（`:251-253`）、GotoTest = Ctrl+Shift+T（`:254-256`）；
//     菜单位次：`platform/platform-impl/resources/idea/LangActions.xml:194-196`（`GoToCodeGroup` 内
//     依次是 GotoSuperMethod / GotoTest / GotoRelated）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHOOSE_TARGET_TITLE, NO_RELATED_SYMBOLS_MESSAGE, RELATED_GROUP_TESTS, RELATED_GROUP_TESTED_CLASSES,
  collectRelatedItems, groupRelatedItems, relatedOutcome, siblingFileItems, testRelatedItems,
} from '../src/navGotoRelated.ts'
import { createNavigateMenuRows } from '../src/menus/navigateMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const file = path => ({ kind: 'file', path })
const ENTRIES = [
  file('src/main/java/Foo.java'), file('src/main/java/FooImpl.java'), file('src/test/java/FooTest.java'),
  file('native/foo.cpp'), file('native/foo.h'), file('native/bar.cpp'),
]

test('provider ①：源码找测试（分组「测试」），测试反过来找被测对象（分组「被测类」）', () => {
  assert.deepEqual(testRelatedItems(ENTRIES, 'src/main/java/Foo.java').map(item => [item.path, item.group]),
    [['src/test/java/FooTest.java', RELATED_GROUP_TESTS]])
  const back = testRelatedItems(ENTRIES, 'src/test/java/FooTest.java')
  assert.deepEqual(back.map(item => [item.path, item.group]), [['src/main/java/Foo.java', RELATED_GROUP_TESTED_CLASSES]],
    '候选名按权重降序，FooTest → Foo 命中在前')
})

test('provider ②：同名兄弟文件只跨「声明 ↔ 实现」两类扩展名', () => {
  assert.deepEqual(siblingFileItems(ENTRIES, 'native/foo.cpp').map(item => item.path), ['native/foo.h'])
  assert.deepEqual(siblingFileItems(ENTRIES, 'native/foo.h').map(item => item.path), ['native/foo.cpp'])
  assert.deepEqual(siblingFileItems(ENTRIES, 'src/main/java/Foo.java').map(item => item.path), [],
    'java 不在 C/C++ 的那三组扩展名里 → 一条都不编')
})

test('collectRelatedItems：两个 provider 的结果合并，按 path+group 去重，不乱序', () => {
  const items = collectRelatedItems(ENTRIES, 'native/foo.cpp')
  assert.deepEqual(items.map(item => item.provider), ['test', 'sibling'], 'provider 顺序 = 表顺序')
  assert.equal(relatedOutcome(items), 'popup', '多于一条 = 弹层（上游 :81 那条）')
})

test('三档结果：空 → none（气泡文案），恰好一条 → navigate（不弹层），多条 → popup（标题 Choose Target）', () => {
  assert.equal(relatedOutcome([]), 'none')
  assert.equal(NO_RELATED_SYMBOLS_MESSAGE, '没有相关符号。')
  assert.equal(relatedOutcome([{ path: 'a', group: '', name: 'a', provider: 'test' }]), 'navigate')
  assert.equal(CHOOSE_TARGET_TITLE, '选择目标')
})

test('groupRelatedItems：组按首次出现排，组内保持条目顺序（GotoRelatedItem.getGroup 的分段呈现）', () => {
  const grouped = groupRelatedItems([
    { path: 'a', group: 'B', name: 'a', provider: 'test' },
    { path: 'b', group: 'A', name: 'b', provider: 'test' },
    { path: 'c', group: 'B', name: 'c', provider: 'sibling' },
  ])
  assert.deepEqual(grouped.map(entry => [entry.group, entry.items.map(item => item.path).join(',')]), [['B', 'a,c'], ['A', 'b']])
})

test('接线：三个动作都住在 lspNavigation，菜单行只在宿主真的给了函数时才出现', () => {
  const nav = read('src/lspNavigation.ts')
  assert.match(nav, /from '\.\/navGotoSuper\.ts'/, '值 import 必须带扩展名')
  assert.match(nav, /from '\.\/navGotoTest\.ts'/)
  assert.match(nav, /from '\.\/navGotoRelated\.ts'/)
  assert.match(nav, /return runGotoSuper\(\{/, 'Ctrl+U 的规则层真的被调用')
  assert.match(nav, /const \{ direction, targets \} = gotoTestTargets\(entries, path\)/, 'Ctrl+Shift+T 走规则层')
  assert.match(nav, /const ordered = groupRelatedItems\(collectRelatedItems\(entries, path\)\)/, 'Ctrl+Alt+Home 走 provider 表')
  assert.match(nav, /if \(outcome === 'none'\) \{ deps\.notify\(NO_RELATED_SYMBOLS_MESSAGE, true\)/, '空结果的气泡档')
  assert.match(nav, /if \(outcome === 'navigate'\)/, '单条直接导航，不弹层')
  assert.match(nav, /openTargetChooser\(ordered\.map\(item => \(\{ path: item\.path, line: 0, character: 0 \}\)\), CHOOSE_TARGET_TITLE\)/, '多条才弹层')
  assert.match(nav, /gotoSuper, gotoTest, gotoRelated,?/, '三个动作都从 createLspNavigation 交出去（等宿主并进 ctx）')

  const menu = read('src/menus/navigateMenu.ts')
  assert.match(menu, /id: 'navigate\.related', title: GOTO_RELATED_ACTION_LABEL, keys: 'Ctrl Alt Home'/)
  // 没有动作就没有行（不放假控件）：宿主没给 ctx 时三行都不出现。
  assert.deepEqual(createNavigateMenuRows({}).filter(row => ['navigate.super', 'navigate.test', 'navigate.related'].includes(row.id)).map(row => row.id), [])
  const wired = createNavigateMenuRows({ gotoSuper: () => 0, gotoTest: () => 0, gotoRelated: () => 0, active: { value: { path: 'a' } }, workspace: { value: {} } })
  assert.deepEqual(wired.filter(row => ['navigate.super', 'navigate.test', 'navigate.related'].includes(row.id)).map(row => row.id),
    ['navigate.super', 'navigate.test', 'navigate.related'], '上游 GoToCodeGroup 的位次：Super → Test → Related')
})
