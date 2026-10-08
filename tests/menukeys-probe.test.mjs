// MENUKEYS-PROBE —— Code 菜单「展开到级别」子菜单的快捷键印显判据（lane `menukeys`）。
//
// 盯三件事：
//  ① caret 族（`unfold.level1..5`）在菜单上**必须**印出两段式 chord，并且那串是从注册表
//     （`src/foldingKeymap.ts` 的 `foldingLevelChords`）经既有格式化函数（`src/presentationAssistant.ts`
//     的 `windowsKeystroke`）推出来的 —— 菜单里手抄一份字面量就红；
//  ② `ExpandAllToLevel1..5` 那五条**不许**印键位（本仓按不到，印了就是假加速键）；
//  ③ 显示串的口径照上游（两段、逗号分隔），不出现 CodeMirror 匹配不到的 `NumPad` 写法。
//
// 上游依据（本 lane 逐行开过基准树，不是照抄任务书）：
//   · 两段式键位：`platform/platform-resources/src/keymaps/$default.xml:385-404`
//     （`ExpandToLevel1..5` = `first-keystroke="control MULTIPLY"` + `second-keystroke="1".."5"`）
//     与 `:405-424`（`ExpandAllToLevel1..5` = `control shift MULTIPLY` + 1..5）；
//     原写作 `:385-403` 是尾界差一行 —— `<action id="ExpandToLevel5">` 的 `</action>` 在 404。
//   · 菜单**确实**显示第二键：`platform/platform-api/src/com/intellij/openapi/keymap/KeymapTextContext.java:43-73`
//     的 `getShortcutText(Shortcut)` 先取第一键文本、再 `s += ", " + 第二键文本`（`, ` 在 :55）；
//     `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionMenuItem.kt:188-194`
//     把它接到 `platform/platform-impl/src/com/intellij/ui/plaf/beg/BegMenuItemUI.java:259-262`
//     的右栏绘制（`getKeyStrokeText(JMenuItem)` 对 `ActionMenuItem` 走 `getFirstShortcutText()`）。
//   · 任务书给的类名 `ActionUtil.getPresentation().getShortcutSet()` / `KeyEventUtil.getShortcutTextView`
//     在基准树里**搜不到**（`grep -rln "getShortcutTextView"` 空、`find -iname "KeyEventUtil*"` 空）：
//     真名是 `KeymapUtil`（`platform/platform-api/src/com/intellij/openapi/keymap/KeymapUtil.kt:77`
//     `getShortcutText(Shortcut)`、`:170-172` `getFirstKeyboardShortcutText(action)`）
//     与 `KeymapTextContext`；显示用的键位集合来自 `KeymapUtil.kt:525-529` 的 `getShortcutSetForDisplay(action)`
//     （注册过的动作读**活动键位表**，不读 `action.shortcutSet` —— 该行为由
//     `platform/platform-tests/testSrc/com/intellij/openapi/actionSystem/ActionPresentationShortcutTextTest.kt:16-38` 钉着）。
//     上游 `VK_MULTIPLY` 的键名文本是 `NumPad *`（`KeymapTextContext.java:269`），本仓那把绑的是
//     CodeMirror 的 `*` 字符键（`Ctrl-*`，`tests/editor-folding.test.mjs:399-401` 已禁止 `NumPad` 写法），
//     所以显示串取**本仓注册表**的写法，不冒充上游的 `NumPad *`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCodeMenuRows } from '../src/menus/codeMenu.ts'
import { foldingLevelChords } from '../src/foldingKeymap.ts'
import { windowsKeystroke } from '../src/presentationAssistant.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 与 `src/App.vue:1416-1419` 的 `editable` / `semantic` 同形状的最小替身（只关心 keys 从哪儿来）。 */
const stub = {
  hasEditor: () => true,
  isDesktop: true,
  active: { value: undefined },
  lspReady: { value: false },
  workspace: { value: null },
  caretPayload: () => null,
  openCodeActions: () => {},
  runWorkspaceInspection: () => {},
  openPackageDeps: () => {},
  openTemplateChooser: () => {},
  openSurround: () => {},
  openGeneratePopup: () => {},
  showQuickDoc: () => {},
  copyReference: () => {},
  runOrganizeImports: () => {},
  showBlame: () => {},
  blameEnabled: () => false,
  compareWithClipboard: () => {},
  compareWithFile: () => {},
  copyFilePath: () => {},
  editable: (name, title, keys, keywords) => ({ id: name, title, keys, keywords, enabled: () => true, run: () => {} }),
  semantic: (kind, title, keys, keywords) => ({ id: kind, title, keys, keywords, enabled: () => true, run: () => {} }),
}

/** Code 菜单 ▸ 折叠 里那两个「展开到级别」子菜单的行（按 id 取，不靠位置）。 */
function levelRows() {
  const folding = createCodeMenuRows(stub).find(row => row.id === 'code.folding')
  assert.ok(folding, 'Code 菜单里没有「折叠」子菜单')
  const byId = id => {
    const group = folding.children.find(child => child.id === id)
    assert.ok(group, `折叠子菜单里缺 ${id}`)
    return group.children
  }
  return { caret: byId('code.folding.caretLevels'), all: byId('code.folding.allLevels') }
}

// ── ① caret 族印出 chord，且与注册表同源 ────────────────────────────────────────────
test('MENUKEYS-PROBE 展开到级别 1–5 的菜单键位 = foldingLevelChords 经 windowsKeystroke 推出（同源）', () => {
  const { caret } = levelRows()
  assert.equal(caret.length, 5)
  assert.deepEqual(caret.map(row => row.id), ['unfold.level1', 'unfold.level2', 'unfold.level3', 'unfold.level4', 'unfold.level5'])
  for (const [index, row] of caret.entries()) {
    const binding = foldingLevelChords[index]
    assert.equal(binding.command, row.id, `注册表第 ${index} 条的命令名与菜单行漂开`)
    // 真源推导：CM 键名按空格分段 → 每段交 `windowsKeystroke` → 段间用上游的 `, `。
    const expected = binding.key.split(' ').map(stroke => windowsKeystroke(stroke.replace(/-/g, ' '))).join(', ')
    assert.equal(row.keys, expected, `${row.id} 的菜单键位必须等于注册表推导出的显示串`)
    assert.notEqual(row.keys, '', `${row.id} 的键位栏不能是空串（上游菜单印这把 chord）`)
  }
})

// 形状钉：两段、逗号分隔、第一段是 Ctrl+*（换字面量或漏第二段就红）。
test('MENUKEYS-PROBE 展开到级别的显示串是两段式（上游 ", " 口径），不是单段', () => {
  const { caret } = levelRows()
  for (const [index, row] of caret.entries()) {
    assert.match(row.keys, /^Ctrl\+\*, [1-5]$/, `${row.id} 的键位应是「Ctrl+*, N」两段式显示串（上游 KeymapTextContext.java:43-73）`)
    assert.equal(row.keys.split(', ')[1], String(index + 1), `${row.id} 的第二段必须是级别号`)
    assert.ok(!/NumPad/i.test(row.keys), `${row.id} 不许印 CodeMirror 匹配不到的 NumPad 写法`)
  }
})

// ── ② 不可触发的动作不印键位 ────────────────────────────────────────────────────────
test('MENUKEYS-PROBE 全部展开到级别 1–5 不印键位（Ctrl-Shift-* 与 Ctrl-* 在浏览器里分不开 ⇒ 假加速键）', () => {
  const { all } = levelRows()
  assert.deepEqual(all.map(row => row.id), ['unfold.all.level1', 'unfold.all.level2', 'unfold.all.level3', 'unfold.all.level4', 'unfold.all.level5'])
  // 注册表里根本没有这一族（`src/foldingKeymap.ts:49-55` 只有 caret 族）⇒ 菜单无键可印。
  for (const row of all) {
    assert.equal(foldingLevelChords.find(binding => binding.command === row.id), undefined, `${row.id} 不该出现在 chord 键位表里`)
    assert.equal(row.keys ?? '', '', `${row.id} 不可被键位触发 ⇒ 菜单键位栏必须是空串`)
  }
  // 两族共用同一个 `ctx.editable` 工厂，但分别落到「可触发=印 / 不可触发=不印」两档。
  assert.notEqual(caretKeys(), allKeys(), 'caret 族与 all 族的键位档不能写成同一份')
  function caretKeys() { return levelRows().caret.map(row => row.keys).join('|') }
  function allKeys() { return levelRows().all.map(row => row.keys).join('|') }
})

// ── ③ 菜单里没有手抄的 chord 字面量 ─────────────────────────────────────────────────
test('MENUKEYS-PROBE codeMenu 的级别行只许查注册表（chordKeys），不许在菜单里手抄键位字符串', () => {
  const source = read('src/menus/codeMenu.ts')
  for (let level = 1; level <= 5; level++) {
    const caretPattern = new RegExp(`ctx\\.editable\\('unfold\\.level${level}', '${level}', chordKeys\\('unfold\\.level${level}'\\)`)
    assert.match(source, caretPattern, `unfold.level${level} 必须走 chordKeys('unfold.level${level}')`)
  }
  // 那五条 all 行仍然显式传空串（不是漏写参数 —— 漏写会走 actionRow 的注册表兜底，语义不同）。
  for (let level = 1; level <= 5; level++) {
    assert.match(source, new RegExp(`ctx\\.editable\\('unfold\\.all\\.level${level}', '${level}', ''`),
      `unfold.all.level${level} 必须显式传空串并留理由`)
  }
  // 手抄检测：caret 那五行里不许出现任何 `'Ctrl…'` 字面量（真源在 foldingKeymap.ts）。
  const caretBlock = source.slice(source.indexOf(`id: 'code.folding.caretLevels'`), source.indexOf(`id: 'code.folding.allLevels'`))
  assert.ok(caretBlock.length > 0, '没找到 caret 级别子菜单那一段')
  assert.ok(!/'Ctrl[^']*'/s.test(caretBlock), '菜单里出现了手抄的 Ctrl 字面量：应改为从 foldingLevelChords 推导')
  // chordKeys 用现成的格式化函数，而不是自己拼修饰键表；键位来源必须是那张权威表。
  assert.match(source, /windowsKeystroke\(/, 'chordKeys 必须复用既有的 windowsKeystroke 格式化函数')
  assert.ok(source.includes("import { foldingLevelChords } from '../foldingKeymap.ts'"),
    'chordKeys 的键位来源必须是 foldingKeymap.ts')
})
