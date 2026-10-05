// 随处搜索的作用域选择（B6：`ScopeChooserAction` + `TextSearchContributor.ScopeAction`）。
//
// 上游把那一格按钮挂在 `TextSearchContributor` 与 `AbstractGotoSEContributor` 上 ——
// 也就是**只作用于文字搜索与 Goto（文件/符号）两类**；命令与运行配置与作用域无关。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PROJECT_SCOPE_NAME, canToggleEverywhere, filterByScope, scopeChoices } from '../src/searchEverywhereScope.ts'
import { searchEverywhereResults } from '../src/searchEverywhere.ts'

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const item = (id, source, path) => ({ id, title: id, source, fuzzyPath: path, open: () => {} })

// 候选 = 「项目」+ 用户定义的作用域（上游 `createScopes()` 还会挂预定义作用域，本仓没有那套 provider）。
test('the choices are the project scope plus the named ones', () => {
  const choices = scopeChoices([{ name: '我的作用域', pattern: 'file[proj]:src//*', shared: false }])
  assert.deepEqual(choices.map(c => c.name), [PROJECT_SCOPE_NAME, '我的作用域'])
  assert.equal(choices[0].expression, null, '项目档不过滤')
  assert.equal(choices[1].expression, 'file[proj]:src//*')
})

test('no named scopes means a single choice', () => {
  assert.equal(scopeChoices([]).length, 1)
})

// 项目档原样放行；命名档按 `scopeMatches` 筛。
test('the project scope keeps everything, a named one filters', () => {
  const items = [item('a', 'project', 'src/main/A.java'), item('b', 'project', 'test/B.java')]
  assert.equal(filterByScope(items, i => i.fuzzyPath, null).length, 2)
  const filtered = filterByScope(items, i => i.fuzzyPath, 'file:*src*//*')
  assert.deepEqual(filtered.map(i => i.id), ['a'])
})

// 坏表达式放行而不是清空（列表来自设置页，那里的校验与这里同一套；绕过设置才会出现坏值）。
test('an invalid expression does not silently drop everything', () => {
  const items = [item('a', 'project', 'src/main/A.java')]
  assert.equal(filterByScope(items, i => i.fuzzyPath, 'file:[').length, 1)
})

// 上游 `canToggleEverywhere()`（`ScopeChooserAction.java:264-266`）：everywhere 与 project
// 是同一个作用域时**恒不可切换**。本仓没有库索引 ⇒ 两档是同一个集合 ⇒ 那格按钮不渲染。
test('the everywhere toggle is unavailable because both scopes are the same set here', () => {
  assert.equal(canToggleEverywhere(), false)
  const dialog = read('src/components/SearchEverywhereDialog.vue')
  // 只看**控件**：不许有那个"在项目/所有位置之间切换"的按钮（文案与类名两路都查一遍）。
  assert.doesNotMatch(dialog, /toggle-scope|se-scope-toggle|切换到所有位置/, '不可切换就不许有那个控件')
})

// 作用域只作用于文件与符号；命令与运行配置不受影响（上游只把 ScopeChooserAction 挂在两类贡献者上）。
test('the scope only filters files and symbols', () => {
  const items = [
    item('file:a', 'project', 'src/main/A.java'),
    item('sym:b', 'symbols', 'src/main/A.java'),
    item('cmd:c', 'commands', ''),
    item('run:d', 'runConfigs', ''),
  ]
  const inScope = (entry) => entry.source === 'commands' || entry.source === 'runConfigs' || entry.fuzzyPath.startsWith('src/')
  const all = searchEverywhereResults(items, '', 'all', 100, false, inScope)
  assert.deepEqual(all.map(i => i.id).sort(), ['cmd:c', 'file:a', 'run:d', 'sym:b'])
  // 只留一个"什么都不在作用域里"的谓词：文件与符号被筛掉，命令与运行配置留下。
  const none = searchEverywhereResults(items, '', 'all', 100, false, () => false)
  assert.deepEqual(none.map(i => i.id).sort(), ['cmd:c', 'run:d'])
})

test('the default predicate is "everything in scope"', () => {
  const items = [item('a', 'project', 'x')]
  assert.equal(searchEverywhereResults(items, '', 'all').length, 1, '不传谓词时行为与之前一致')
})

// —— 接线 ——

test('the dialog offers the scope selector only when there is a choice', () => {
  const dialog = read('src/components/SearchEverywhereDialog.vue')
  // 头部动作按上游顺序 [作用域, 预览, 类型] 渲染（`SeTargetsFilterEditor.kt:72-74`），
  // 作用域那一格仍然只在真有第二个候选时才出现。
  assert.match(dialog, /action === 'scope' && scopeOptions\.length > 1/, '只有一个候选时不渲染那个下拉')
  assert.match(dialog, /v-model="scopeName"/)
  assert.match(dialog, /scopeChoices\(props\.scopes \?\? \[\]\)/)
})

test('the host passes the project scopes down', () => {
  assert.match(read('src/App.vue'), /:scopes="projectSettings\.scopes"/)
})
