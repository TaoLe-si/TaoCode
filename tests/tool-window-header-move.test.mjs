import test from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadSfc } from './vue-sfc-loader.mjs'

// 上游 `ToolWindowHeader` 的 ⋮ 菜单走 `ActiveToolwindowGroup` / `MoveToolWindow` 的三边移动
// （UIBundle `tool.window.move.to.action.group.name`：Left / Right / Bottom）。DEFAULT_TOOL_ANCHORS
// 里 vcslog/todo/debug/tests/gradle/notifications 停在 bottom 或 right，没有 Bottom 这一项时它们
// 只能停在初始位置。
const { component } = loadSfc('src/components/ToolWindowHeader.vue')

async function menu(anchor, extraRows = []) {
  const context = {}
  const html = await renderToString(createSSRApp({
    render: () => h(component, { id: 'files', title: '项目', anchor, maximized: false, menuOpen: true, extraRows }),
  }), context)
  // 批次 87-C 起这张菜单 Teleport 到 body —— 它比标题栏本身还宽，长在 `overflow: hidden` 的
  // 侧栏里会被裁掉（实测左边缘落到 x = -14.5，图标与"×"整列不见）。SSR 把 Teleport 的内容放进
  // `context.teleports`，主输出里只留一对注释标记，所以行文本断言要把那份拼回来 ——
  // 断言的仍然是**渲染出来的那张菜单**，只是换了读取位置。
  return html + Object.values(context.teleports ?? {}).join('')
}
const rows = html => [...html.matchAll(/>(移动到[^<]*)</g)].map(m => m[1].trim())

test('the header offers all three docks to move the window to', async () => {
  assert.deepEqual(rows(await menu('left')), ['移动到左侧', '移动到右侧', '移动到底部'])
})

test('the current dock is the disabled one, bottom included', async () => {
  const atBottom = await menu('bottom')
  assert.ok(atBottom.includes('移动到底部'), 'bottom 窗口的菜单里仍要列出 Bottom')
  const row = (html, label) => {
    const i = html.indexOf(label)
    assert.ok(i >= 0, `菜单缺少「${label}」`)
    return html.slice(html.lastIndexOf('<button', i), i)
  }
  assert.ok(/disabled/.test(row(atBottom, '移动到底部')), '已在底部时「移动到底部」必须禁用')
  assert.ok(!/disabled/.test(row(atBottom, '移动到左侧')), '底部窗口仍要能移回左侧')
  const atLeft = await menu('left')
  assert.ok(!/disabled/.test(row(atLeft, '移动到底部')), '左侧窗口必须能移到底部')
})

// 齿轮组里"属于工具窗口自己"的那几项（ToolWindowImpl.kt:874-887）由 menuUi 按 id 解析后传进来，
// 标题栏只负责渲染：组行（ResizeActionGroup）的成员摊在下层并缩进一档 —— `.tool-menu` 里不再开一层浮层。
test('齿轮追加的行动作可用时渲染、组行成员缩进，一条都没有时整段不出现', async () => {
  const rows = [
    { id: 'window.toggleContentUiType', title: '合并标签页', enabled: () => true },
    { id: 'window.resizeToolWindow', title: '调整工具窗口', children: [
      { id: 'window.resizeToolWindowLeft', title: '向左拉伸', keys: 'Ctrl Alt Shift ArrowLeft', enabled: () => false },
    ] },
  ]
  const withGear = await menu('left', rows)
  assert.ok(withGear.includes('合并标签页') && withGear.includes('调整工具窗口') && withGear.includes('向左拉伸'))
  assert.ok(/class="menu-button tool-menu-item is-child"[^>]*disabled/.test(withGear), '不可用的成员要禁用而不是消失')
  assert.ok(withGear.includes('Ctrl Alt Shift ArrowLeft'), '快捷键沿用主菜单那一份，不在这里复制')
  // 一条都没有 ⇒ 整段（含分隔线）都不出现，不留一个空 section。
  assert.ok(!(await menu('left', [])).includes('is-child'))
})
