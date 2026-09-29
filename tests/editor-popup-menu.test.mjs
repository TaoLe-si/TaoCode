// 编辑器右键菜单（IDEA `EditorPopupMenu`）的判重：引用清单、整形规则、接线。
//
// 为什么要有"每个 id 都解析得到"这条：这个组按 IDEA 的做法只存**引用**（`<reference ref="ID"/>`），
// 行本身在各菜单里。`editorPopupRows` 对解析不到的 id 是"静默丢掉"（不渲染假控件），
// 所以一旦某个动作被改名，右键菜单就会悄悄少一行而所有断言仍然绿 —— 这条门禁专门堵这个洞。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EDITOR_POPUP_SPEC, editorPopupRows } from '../src/menus/editorPopupMenu.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 结构摘要：`action:<id>` / `popup:<组>` / `rule`，用来对照上游的引用顺序。 */
const shape = entry => 'rule' in entry ? 'rule' : ('popup' in entry ? `popup:${entry.popup}` : `action:${entry.action}`)
const shapes = EDITOR_POPUP_SPEC.map(shape)

test('引用顺序照 PlatformActions.xml:857-878 与各处 add-to-group', () => {
  assert.deepEqual(shapes, [
    'action:codeAction',                                   // ShowIntentionActions（anchor=first）
    'rule',
    'action:cut', 'action:copy', 'action:edit.paste',      // $Cut / $Copy / $Paste
    'popup:Copy.Paste.Special',
    'action:edit.columnSelect',                            // EditorToggleColumnMode
    'rule',
    'action:references',                                   // EditorPopupMenu1.FindRefactor › FindUsages
    'popup:EditorPopupMenu.GoTo',
    'rule',
    'popup:FoldingGroup',
    'rule',
    'action:tools.externalTools',                          // ExternalToolsGroup（before Compare…）
    'action:code.compareClipboard',                        // CompareClipboardWithSelection
    'action:gradle.link',                                  // Gradle.ImportExternalProject（anchor=last）
  ])
  // popup 组的成员顺序也照源码，不是随手列的。
  const group = name => EDITOR_POPUP_SPEC.find(entry => 'popup' in entry && entry.popup === name)
  assert.deepEqual(group('Copy.Paste.Special').members, ['edit.pasteSimple', 'edit.pasteMultiple'])
  // Go To 只有上游六项里本仓存在的那三项（GotoSuperMethod/GotoRelated/GotoTest 没有对应动作）。
  assert.deepEqual(group('EditorPopupMenu.GoTo').members, ['definition', 'implementation', 'navigate.typeDeclaration'])
  // FoldingGroup：Expand → ExpandAll → Collapse → CollapseAll（本仓没有"递归"那一档）。
  assert.deepEqual(group('FoldingGroup').members, ['unfold', 'unfoldAll', 'fold', 'foldAll'])
})

test('三个 popup 组的标题都取自 bundle 文案，不是编的', () => {
  const titles = Object.fromEntries(EDITOR_POPUP_SPEC
    .filter(entry => 'popup' in entry).map(entry => [entry.popup, entry.title]))
  // 源码坐标：platform-resources-en/src/messages/ActionsBundle.properties
  //   :452 group.Copy.Paste.Special.text=Copy / Paste Special
  //   :1359 group.EditorPopupMenu.GoTo.text=Go To
  //   :621 group.FoldingGroup.text=Folding
  assert.deepEqual(titles, { 'Copy.Paste.Special': '复制 / 特殊粘贴', 'EditorPopupMenu.GoTo': '转到', FoldingGroup: '折叠' })
})

/** 把各菜单模块里出现过的动作 id 全找出来（三种写法：`id: 'x'`、ctx.editable('x'、ctx.semantic('x'）。 */
function knownActionIds() {
  const found = new Set()
  for (const file of readdirSync(join(root, 'src/menus'))) {
    const source = readFileSync(join(root, 'src/menus', file), 'utf8')
    for (const match of source.matchAll(/id:\s*'([^']+)'/g)) found.add(match[1])
    // `ctx.editable('cut', …)` / `ctx.semantic('codeAction', …)` 的 id 就是第一个实参
    //（App.vue 里这两个工厂写的是 `id: name`）—— 不连 `ctx.` 前缀，别按前缀找。
    for (const match of source.matchAll(/\b(?:editable|semantic)\('(\w[\w.]*)'/g)) found.add(match[1])
  }
  // gradle.link 不在任何主菜单里：它由 App.vue 的 popupExtras 现场贡献（上游也只挂两个弹出组）。
  const app = read('src/App.vue')
  assert.match(app, /id: 'gradle\.link'/, 'App.vue 的 popupExtras 不再贡献 gradle.link，编辑器右键那一行会静默消失')
  found.add('gradle.link')
  return found
}

test('引用清单里每个 id 都真的存在（改过名就会在这里响）', () => {
  const known = knownActionIds()
  const referenced = []
  for (const entry of EDITOR_POPUP_SPEC) {
    if ('action' in entry) referenced.push(entry.action)
    if ('members' in entry) referenced.push(...entry.members)
  }
  const missing = referenced.filter(id => !known.has(id))
  assert.deepEqual(missing, [], `这些 id 在各菜单里找不到，右键菜单会静默少行：${missing.join(', ')}`)
  // 判据本身不能空转。
  assert.ok(referenced.length >= 14, `只数到 ${referenced.length} 个引用，扫描器多半失准了`)
})

test('整形：缺动作就丢行、空组不占位、分隔线不叠不出头尾', () => {
  const all = id => ({ id, title: `标题-${id}`, run: () => {} })
  const full = editorPopupRows(all)
  assert.equal(full.filter(row => row.rule).length, 4, '四条分隔线：意图后 / 粘贴段后 / GoTo 后 / 折叠后')
  assert.ok(!full[0]?.rule && !full[full.length - 1]?.rule, '首尾都不该是分隔线')
  const popups = full.filter(row => row.children)
  assert.equal(popups.length, 3)
  assert.deepEqual(popups.map(row => row.children.length), [2, 3, 4])

  // 全部取不到 ⇒ 空菜单（这时宿主不该弹浮层）。
  assert.deepEqual(editorPopupRows(() => undefined), [])
  // 只少一个动作 ⇒ 少一行，分隔线自动收拢（不留下空段）。
  const partial = editorPopupRows(id => id === 'edit.paste' ? undefined : all(id))
  assert.equal(partial.filter(row => row.id === 'edit.paste').length, 0)
  assert.equal(partial.filter(row => row.rule).length, 4, '仍有四段，段内少一行')
  // 整段引用都取不到 ⇒ 该段不该出现（Go To 的三个 id 全去掉）。
  const noGoTo = editorPopupRows(id => ['definition', 'implementation', 'navigate.typeDeclaration'].includes(id) ? undefined : all(id))
  assert.equal(noGoTo.filter(row => row.id === 'editor.EditorPopupMenu.GoTo').length, 0,
    '成员全丢的 popup 组会留下一行点开什么都没有的空组')
  // 反例（判据自证）：留着空组的形状必须被上面这条抓到。
  const broken = [{ id: 'editor.EditorPopupMenu.GoTo', title: '转到', children: [] }]
  assert.equal(broken.filter(row => row.id === 'editor.EditorPopupMenu.GoTo' && !row.children.length).length, 1)
  // 连续的 rule 合并成一条。
  const merged = editorPopupRows(all, [{ rule: true }, { action: 'cut' }, { rule: true }, { rule: true }, { action: 'copy' }, { rule: true }])
  assert.deepEqual(merged.map(row => row.rule ? 'rule' : row.id), ['cut', 'rule', 'copy'])
})

test('接线：右键开浮层、点击走 runAction（可用性检查 + 宏记录都在那条链上）', () => {
  const app = read('src/App.vue')
  assert.match(app, /@contextmenu\.prevent="openEditorPopup\(\$event\)"/,
    '编辑器上的右键必须换成我们自己的菜单，而不是 WebView2 的原生右键')
  assert.match(app, /<Teleport v-if="editorPopup" to="body"><EditorPopupMenu/,
    '浮层要 Teleport 到 body：编辑器容器是 overflow:hidden，弹在里面会被裁')
  assert.match(app, /@pick="pickEditorPopup\(\$event\)"/)

  const ui = read('src/menuUi.ts')
  // 按 id 取行：先翻主菜单（含子组），再翻 popupExtras。
  assert.match(ui, /for \(const group of allMenuGroups\.value\) \{ const found = search\(group\.rows\); if \(found\) return found \}/)
  assert.match(ui, /return search\(popupExtras\?\.\(\) \?\? \[\]\)/)
  // 执行必须复用 runAction —— 那里有「不可用要说明」与「执行前记宏步骤」（IDEA 的 AnActionListener）。
  assert.match(ui, /runAction\(\{ id: row\.id, title: rowTitle\(row\)[^\n]*run: row\.run \}\)/)
  assert.match(ui, /if \(!editorPopupRows\.value\.length\) return/, '一行都没有时不该弹一个空浮层')

  // 样式：复用 .tree-menu 的浮层规格（自带前景色，见 popup-foreground 判据），只换定位。
  const css = read('src/style.css')
  const rule = css.match(/\.editor-popup-menu \{([^}]*)\}/)
  assert.ok(rule, '没有 .editor-popup-menu 定位规则：浮层会贴在父容器下沿而不是光标处')
  assert.match(rule[1], /position: fixed/)
  assert.match(read('src/components/EditorPopupMenu.vue'), /class="tree-menu editor-popup-menu"/)
})
