// 编辑器右键菜单（IDEA 的 `EditorPopupMenu`）的**引用清单**与整形规则。
//
// 为什么不重写一遍标题/快捷键：IDEA 的这个组里几乎每一行都是 `<reference ref="某个已存在的 action"/>`
// —— 组本身只规定"引用谁、按什么顺序、哪里加分隔线"，文案与键位归各 action 自己。
// TaoCode 同构：菜单行已经分散在 `src/menus/*.ts` 里（并进了 `menuUi` 的动作索引），
// 这里只登记引用顺序，运行时按 id 取行。于是改一处不会两处漂移。
//
// 上游坐标（`platform/platform-impl/resources/idea/PlatformActions.xml:857-878`）：
//   `EditorPopupMenu` = $Cut, $Copy, $Paste, `Copy.Paste.Special`(popup) , EditorToggleColumnMode,
//     `<sep>`, `EditorPopupMenu1`, `<sep>`, `EditorPopupMenu2`, `<sep>`, `EditorPopupMenu3`,
//     `<sep>`, $SearchWeb, `<sep>`, CompareClipboardWithSelection
//   再按各处 `add-to-group` 补齐：
//   · ShowIntentionActions + `<sep>`，`anchor="first"`（`LangActions.xml:26-30`）；
//   · CopyAsRichText，`after $Copy`（`LangActions.xml:100-102`）；
//   · `EditorPopupMenu1.FindRefactor`（**compact**，成员摊平进父菜单）= FindUsages +
//     `EditorPopupMenu.GoTo`(popup, `LangActions.xml:567`) + `<sep>` + FoldingGroup，
//     进 `EditorPopupMenu1`（`LangActions.xml:566-578`）；
//   · ExternalToolsGroup，`before CompareClipboardWithSelection`（`LangActions.xml:595-597`）；
//   · Git.Stage.Index.File.Menu，无锚点 ⇒ 追加在末尾（`intellij.vcs.git.backend.xml:532-545`）；
//   · Gradle.ImportExternalProject，`anchor="last"`（`intellij.gradle.xml:408-411`）。
//   `compact="true"` 的形状有源码依据：解析器把它换成 `DefaultCompactActionGroup`
//   （`XmlReader.kt:302`），该类只额外打开 `HIDE_DISABLED_CHILDREN`（`DefaultCompactActionGroup.java:24-28`）
//   —— 组本身不是 popup（没写 `popup="true"`），所以成员直接摊平，空组不留空行。
import type { MenuRow } from './types'

/** 一行引用，或一个分隔线（`{ popup }` 形态留给以后真的需要就地拼子菜单时用）。 */
export type EditorPopupRef = { action: string } | { popup: string; title: string; members: string[] } | { rule: true }

/**
 * 上游引用顺序。注释给的是它替代的 **IDEA action / group id**；`action`/`members` 是 TaoCode 的 id。
 * 上游有、本仓没有对应动作的条目**不写进来**（不渲染假控件），逐条登记在 docs/class-parity-todo.md：
 * CopyAsRichText · FindSelectionInPath · GotoSuperMethod · GotoRelated · GotoTest · $SearchWeb ·
 * Git.Stage.Index.File.Menu · ChangeTemplateDataLanguage · LightEditModePopup · ExpandToLevel。
 */
export const EDITOR_POPUP_SPEC: readonly EditorPopupRef[] = [
  { action: 'codeAction' },                        // ShowIntentionActions（anchor=first，后面跟分隔线）
  { rule: true },
  { action: 'cut' },                               // $Cut
  { action: 'copy' },                              // $Copy
  { action: 'edit.paste' },                        // $Paste
  // `Copy.Paste.Special`（popup）：文案 `group.Copy.Paste.Special.text=Copy / Paste Special`
  // （ActionsBundle.properties:452）。上游成员顺序 EditorPasteSimple(:97 first) → PasteMultiple，
  // 本仓两行都在 `edit.pasteGroup` 里，按 bundle 里各自的动词顺序引用。
  { popup: 'Copy.Paste.Special', title: '复制 / 特殊粘贴', members: ['edit.pasteSimple', 'edit.pasteMultiple'] },
  { action: 'edit.columnSelect' },                 // EditorToggleColumnMode
  { rule: true },
  // `EditorPopupMenu1`（compact 组摊平）：FindUsages → Go To → 分隔 → Folding
  { action: 'references' },                        // FindUsages
  // `EditorPopupMenu.GoTo`（popup）：`group.EditorPopupMenu.GoTo.text=Go To`（:1359）→「转到」。
  // 上游六项里本仓有三项（GotoSuperMethod / GotoRelated / GotoTest 没有对应动作）。
  { popup: 'EditorPopupMenu.GoTo', title: '转到', members: ['definition', 'implementation', 'navigate.typeDeclaration'] },
  { rule: true },
  // `FoldingGroup`（popup）：`group.FoldingGroup.text=Folding`（:621）→「折叠」。
  // 上游顺序 Expand → ExpandRecursively → ExpandAll → sep → Collapse → …；本仓只有四个（无递归档）。
  { popup: 'FoldingGroup', title: '折叠', members: ['unfold', 'unfoldAll', 'fold', 'foldAll'] },
  { rule: true },
  { action: 'tools.externalTools' },               // ExternalToolsGroup（本仓这行自带子项）
  { action: 'code.compareClipboard' },             // CompareClipboardWithSelection
  { action: 'gradle.link' },                       // Gradle.ImportExternalProject（anchor=last）
]

/**
 * 按引用顺序取行：
 *  · 取不到的 id 直接**丢掉** —— 该动作在本仓不存在就不该出现一行假的；
 *  · popup 组成员全丢时整组不出现（上游 compact 的"空组不留空行"同理）；
 *  · 连续分隔线合并成一条，首尾分隔线去掉。
 */
export function editorPopupRows(find: (id: string) => MenuRow | undefined,
                               spec: readonly EditorPopupRef[] = EDITOR_POPUP_SPEC): MenuRow[] {
  const rows: MenuRow[] = []
  const push = (row: MenuRow) => {
    if (row.rule && (!rows.length || rows[rows.length - 1]?.rule)) return
    rows.push(row)
  }
  for (const entry of spec) {
    if ('rule' in entry) { push({ id: `editor.popup.rule.${rows.length}`, rule: true }); continue }
    if ('popup' in entry) {
      const members = entry.members.map(id => find(id)).filter((row): row is MenuRow => Boolean(row))
      if (members.length) push({ id: `editor.${entry.popup}`, title: entry.title, children: members })
      continue
    }
    const row = find(entry.action)
    if (row) push(row)
  }
  while (rows.length && rows[rows.length - 1]?.rule) rows.pop()
  return rows
}
