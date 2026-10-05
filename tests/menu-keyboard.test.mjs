// B6（`verdict-actions.md`）`ActionMenu` 一族的键盘导航判据。
//
// 上游 Swing 菜单由 `MenuSelectionManager` 管活动路径：↑↓ 在可选行间环绕、→ 展开子段 / ← 收起、
// Enter 执行活动项。本仓编辑器右键浮层（`src/components/EditorPopupMenu.vue`）原先只有 Esc ——
// 纯逻辑拆在 `src/menuKeyboard.ts`（组件不可单测），这里钉住三件事：
//   ① 可选行/展开子段的行走表；
//   ② 环绕与"没选中时向下从第一条/向上从最后一条"；
//   ③ 组件真的把键接上了（源码断言，与 B1/B4 的"门禁读源码"同一口径）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextMenuIndex, rowActivatable, visibleMenuRows } from '../src/menuKeyboard.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const rows = [
  { id: 'cut', title: '剪切' },
  { id: 'rule', rule: true },
  { id: 'refactor', title: '重构', children: [{ id: 'rename', title: '重命名' }, { id: 'rule2', rule: true }] },
  { id: 'disabled', title: '不可用', enabled: () => false },
  { id: 'copy', title: '复制' },
]

test('行走表：规则线跳过；子段展开时子行接在父行之后', () => {
  assert.deepEqual(visibleMenuRows(rows, null).map(row => row.id), ['cut', 'refactor', 'disabled', 'copy'])
  assert.deepEqual(visibleMenuRows(rows, 'refactor').map(row => row.id),
    ['cut', 'refactor', 'rename', 'disabled', 'copy'])
})

test('环绕：向下到头回第一条、向上到头回最后一条；没选中时给出起点', () => {
  assert.equal(nextMenuIndex(4, -1, 1), 0, '没选中时 ↓ 从第一条开始')
  assert.equal(nextMenuIndex(4, -1, -1), 3, '没选中时 ↑ 从最后一条开始')
  assert.equal(nextMenuIndex(4, 3, 1), 0, '最后一条 ↓ 环绕')
  assert.equal(nextMenuIndex(4, 0, -1), 3, '第一条 ↑ 环绕')
  assert.equal(nextMenuIndex(0, -1, 1), -1, '没有可选行')
})

test('可激活：父行（有子段）永远能展开，普通行看 enabled()', () => {
  assert.equal(rowActivatable(rows[2]), true, '父行')
  assert.equal(rowActivatable(rows[3]), false, 'enabled() 为 false')
  assert.equal(rowActivatable({ id: 'x', title: 'x' }), true, '没有 enabled 的行默认可点')
})

test('EditorPopupMenu 真的把键盘导航接上了（源码断言）', () => {
  const component = read('src/components/EditorPopupMenu.vue')
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'ArrowRight'", "'ArrowLeft'", "'Enter'"]) {
    assert.ok(component.includes(key), `组件缺按键 ${key}`)
  }
  assert.ok(component.includes('moveActive(1)') && component.includes('moveActive(-1)'), '↑↓ 要走 moveActive')
  assert.ok(component.includes('activateActive()'), 'Enter 要执行活动行')
  assert.ok(component.includes("is-active"), '活动行要有可见样式类')
  assert.ok(component.includes('nextMenuIndex') && component.includes('visibleMenuRows'), '必须复用 src/menuKeyboard.ts 的纯逻辑')
  // 没走过键盘时不抢 Enter（编辑器里它还是换行）。
  assert.match(component, /if \(activeIndex\(\) < 0\) return/, 'Enter 要有"无活动项不拦截"的栅栏')
  const css = read('src/style.css')
  assert.match(css, /\.tree-menu > button\.is-active/, 'style.css 要给活动行同一套悬停观感')
})
