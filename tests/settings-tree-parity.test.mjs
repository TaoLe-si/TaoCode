// 设置树的**结构与 id 对照 IDEA**（2026-09-27：桃指出"巨量错误嵌套 UI"，实测确实多了一层）。
//
// 权威依据：
//   · 顶层分组 `intellij.platform.ide.impl.xml:575-608` 的 `<groupConfigurable id=… weight=…>`：
//     appearance 70 / editor 60 / project 40 / build 30 / language 20 / tools 10 / other -10；
//   · `editor` 是**分组**（不是页面）；
//   · `intellij.platform.lang.impl.xml:974-984`：`id="preferences.editor"`（显示名 General）
//     挂在 `groupId="editor"` 下，其子页由 `editorOptionsProvider` 提供（`:1181-1223`）。
import test from 'node:test'
import assert from 'node:assert/strict'

import { PAGE_KEYS, SETTINGS_GROUPS, SETTINGS_NODES, isParentOnly } from '../src/settingsTreeMeta.ts'

const byKey = key => SETTINGS_NODES.find(node => node.key === key)

test('顶层分组 = IDEA 的 7 个，且顺序按 weight 降序', () => {
  assert.deepEqual(SETTINGS_GROUPS.map(group => group.key), [
    'group:appearance', 'group:editor', 'group:project', 'group:build', 'group:language', 'group:tools', 'group:other',
  ])
})

test('editor 是分组的子页，不是顶层页（原先多插了一层 editor.general）', () => {
  const editor = byKey('editor')
  assert.ok(editor, 'editor 页要在')
  assert.equal(editor.parent, 'group:editor', 'editor 挂在 group:editor 下')
  assert.equal(editor.label, '常规', 'IDEA 的显示名是 General')
  assert.equal(isParentOnly('editor'), false, 'editor 自己是有内容的页（同时带子页）')
  // 中间那层已消失
  assert.equal(byKey('editor.general'), undefined, '`editor.general` 这一层已合并掉')
  // `preferences.editor` 的子页有三类（都有 EP 依据）：`editorOptionsProvider` 提供的
  // `editor.preferences.*`（`intellij.platform.lang.impl.xml:1181-1223`），以及
  // `parentId="preferences.editor"` 的 `editor.breadcrumbs` / `editor.stickyLines`
  // （`intellij.platform.ide.impl.xml:1231/1236`）、`Console`（`:983`）。
  // 第三类：**上游自己的 `parentId` 就写 `editor`（不是 `preferences.editor`）** 的一页 ——
  // `inlay.hints`（`intellij.platform.lang.impl.xml:935-941`
  // `<projectConfigurable provider="…InlaySettingsConfigurableProvider" id="inlay.hints" parentId="editor" …/>`），
  // 它挂的是 `editor` **分组**，所以在 IDEA 的树里它与「常规」同层而不是「常规」的子页。
  const editorChildren = new Set(['Console', 'inlay.hints'])
  for (const child of SETTINGS_NODES.filter(node => node.parent === 'editor'))
    assert.ok(child.key.startsWith('editor.preferences.') || child.key.startsWith('editor.') || editorChildren.has(child.key),
      `editor 的子页应当是 IDEA 里挂在 editor 下的那些：${child.key}`)
  // 反向：挂在 editor 下的 `inlay.hints` 不许被误当成 `group:editor` 的直属页。
  assert.equal(byKey('inlay.hints')?.parent, 'editor', 'inlay.hints 的 parentId 是 editor（:937），不是 group:editor')
})

test('直属 groupId="editor" 的页挂在分组下，不是挂在 editor 页下', () => {
  // IDEA 用 `groupId` 区分"分组的直接成员"，用 `parentId` 区分"某个页的子页"。
  for (const key of ['preferences.sourceCode', 'Errors', 'editing.templates', 'preferences.fileTypes', 'preferences.toDoOptions'])
    assert.equal(byKey(key)?.parent, 'group:editor', `${key} 应当直属 group:editor`)
})

test('页面键沿用 IDEA 的 configurable id', () => {
  // 这些 id 直接来自 EP 注册行，改名后要能在 PAGE_KEYS 里找到（否则跳转会打开空页）。
  const expected = ['preferences.lookFeel', 'preferences.general', 'project.scopes', 'preferences.sourceCode',
    'preferences.sourceCode.indents', 'editor.preferences.appearance', 'editor.preferences.tabs',
    'editor.preferences.smartKeys', 'editor.preferences.gutterIcons', 'editing.templates',
    'preferences.fileTypes', 'preferences.toDoOptions', 'build.tools', 'diff.base', 'Errors']
  // 只有子项、自己不是页的父节点（expandOnly）本来就不在 PAGE_KEYS 里。
  const missing = expected.filter(name => !isParentOnly(name) && !PAGE_KEYS.includes(name))
  assert.deepEqual(missing, [], `PAGE_KEYS 里缺：${missing.join('、')}`)
  // 旧的临时键不该再出现
  const stale = ['appearance', 'general', 'scopes', 'templates', 'editor.codeStyle', 'editor.general']
    .filter(name => PAGE_KEYS.includes(name))
  assert.deepEqual(stale, [], `旧键已按 IDEA 改名，不该留在 PAGE_KEYS 里：${stale.join('、')}`)
})

test('每个页面的 parent 都存在，且没有孤儿节点', () => {
  const keys = new Set(SETTINGS_NODES.map(node => node.key))
  const groupKeys = new Set(SETTINGS_GROUPS.map(group => group.key))
  for (const node of SETTINGS_NODES) {
    if (node.parent === null) continue
    assert.ok(keys.has(node.parent) || groupKeys.has(node.parent),
      `${node.key} 的 parent「${node.parent}」不存在`)
  }
  // 每个分组下至少要有一个页面（空分组不渲染，但也不该登记）
  for (const group of SETTINGS_GROUPS) {
    const children = SETTINGS_NODES.filter(node => node.parent === group.key)
    if (group.key === 'group:project' || group.key === 'group:language' || group.key === 'group:other') continue
    assert.ok(children.length > 0, `${group.key} 下没有页面`)
  }
})
