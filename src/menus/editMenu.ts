// 编辑菜单（EditMenu，PlatformActions.xml:446-518 的 TaoCode 对应物）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
import type { MenuRow } from './types'
import { createMacrosMenuRows } from './macrosMenu.ts'

export interface EditMenuContext {
  // 参数统一 any：参数逆变下 App 的窄签名函数才能赋进来（后续批次可收紧）。
  runEditor: (name: any, arg?: any) => any
  convertIndents: (mode: any) => void
  hasEditor: () => boolean
  editable: (name: any, title: any, keys?: any, keywords?: any) => MenuRow
  toolWindow: (view: any, title: any, keywords: any, needsDesktop?: any) => MenuRow
  copyReference: () => any
  /** 「复制路径/引用…」那一组的四行（实现在 src/copyPathActions.ts，只在菜单里出现）。 */
  copyPathRows: () => MenuRow[]
  /** 粘贴通道（三个动作的实现在 src/pasteActions.ts）。 */
  pasteFromSystemClipboard: () => any
  pasteAsPlainText: () => any
  openPasteHistory: () => any
  /** 宏菜单的 ctx（IDEA EditMenu 里的 `Macros` 子菜单，PlatformActions.xml:506-510）。 */
  macros: any
}

  export function createEditMenuRows(ctx: EditMenuContext): MenuRow[] {
  const rows: MenuRow[] = [
    // IDEA EditMenu order (PlatformActions.xml:446-518): Undo/Redo first, then the
    // find group, selection, and the smart group ending ToggleCase -> JoinLines ->
    // Duplicate. MoveLineUp/Down use Alt+Shift ($default.xml keeps Ctrl+Shift for
    // MoveStatement, which TaoCode does not ship).
    ctx.editable('undo', '撤销', 'Ctrl Z', 'undo revert 撤销'),

    // IDEA 的 Copy Reference（$CopyReference，Ctrl+Alt+Shift+C）：复制当前位置的符号引用。
    // 引用串来自 LSP `textDocument/moniker`（见 src/moniker.ts 的模块注释）。
    { id: 'edit.copyReference', title: '复制符号引用', keys: 'Ctrl Alt Shift C', keywords: 'copy reference moniker 复制 引用 符号', enabled: () => ctx.hasEditor(), run: () => void ctx.copyReference() },
    ctx.editable('redo', '重做', 'Ctrl Shift Z', 'redo 重做'),
    // IDEA EditMenu（PlatformActions.xml:450-458）CutCopyPasteGroup 的前两项。
    // 键位取自 $default.xml：$Cut = Ctrl+X（:431-434）、$Copy = Ctrl+C（:450-453）。
    // 编辑器侧对应 `EditorCut` / `EditorCopy`（intellij.platform.ide.impl.actions.xml:169-170，
    // `use-shortcut-of` 继承这两个键）：有选区复制选区，**没有选区时先把整行（含行尾换行）选中**
    // 再复制/剪切，复制后整行保持选中（`CopyAction.prepareSelectionToCopy` + `EditorActionUtil.selectEntireLines:135-140`）。
    ctx.editable('cut', '剪切', 'Ctrl X', 'cut 剪切'),
    ctx.editable('copy', '复制', 'Ctrl C', 'copy 复制'),
    // `CopyReferencePopupGroup`（`PlatformActions.xml:1266-1281`）由 `:1279` 的 add-to-group
    // 插在 `CutCopyPasteGroup` 的 `CopyPaths` **之后** —— 本仓的 CopyPaths 按源码不渲染菜单行
    // （见上面那段说明），所以这一组紧跟在「复制」后面。四行由 `src/copyPathActions.ts` 提供
    // （只在菜单里出现的动作，经 `popupExtras` 进 `findMenuRow` 的索引）。
    { id: 'edit.copyPathGroup', title: '复制路径/引用…', keywords: 'copy path reference absolute file name with line number 复制 路径 引用 绝对 文件名 行号', children: ctx.copyPathRows() },
    // 第三条 `CopyPaths`（Ctrl+Shift+C，$default.xml:454-456）**故意不渲染菜单行**：
    // `CopyPathsAction.java:44-48` 的 `update` 里 `enabled = KEYBOARD_SHORTCUT.equals(e.getPlace()) && isEnabled(files)`
    // 且紧接着 `setEnabledAndVisible(enabled)` —— 也就是说它**只在键盘触发时可见**，
    // EditMenu 里那一行在 IDEA 上也是看不到的。TaoCode 照此只绑键位（见 src/keymap.ts 的 Ctrl+Shift+C）。
    // IDEA EditMenu（PlatformActions.xml:450-458）里的 CutCopyPasteGroup 含一个**子菜单**
    // PasteGroup：$Paste / PasteMultiple / EditorPasteSimple。键位取自 $default.xml：
    // $Paste = Ctrl+V（:632-634）、PasteMultiple = Ctrl+Shift+V（:288-290）、
    // EditorPasteSimple = Ctrl+Alt+Shift+V（:637-638）。
    // 说明：CutCopyPasteGroup 里的 $Cut / $Copy / CopyPaths 尚未成行 —— 编辑器已用原生键位实现
    // 前两者（菜单行需要 `cut`/`copy` 两个编辑器命令），CopyPaths 的落点是文件树/标签右键菜单。
    { id: 'edit.pasteGroup', title: '粘贴', keywords: 'paste from history plain text 粘贴 历史 纯文本', children: [
      { id: 'edit.paste', title: '粘贴', keys: 'Ctrl V', keywords: 'paste from clipboard 粘贴', enabled: () => ctx.hasEditor(), run: () => void ctx.pasteFromSystemClipboard() },
      // `action.PasteMultiple.text=Past_e from History…`、`:description=Paste from recent clipboards`
      { id: 'edit.pasteMultiple', title: '从历史粘贴…', keys: 'Ctrl Shift V', keywords: 'paste from history recent clipboards 历史 剪贴板', enabled: () => ctx.hasEditor(), run: () => void ctx.openPasteHistory() },
      // `action.EditorPasteSimple.text=Paste as P_lain Text`、`:description=Paste without formatting, auto-import, literal escaping, etc.`
      { id: 'edit.pasteSimple', title: '粘贴为纯文本', keys: 'Ctrl Alt Shift V', keywords: 'paste as plain text without formatting 纯文本 不格式化', enabled: () => ctx.hasEditor(), run: () => void ctx.pasteAsPlainText() },
    ] },
    { id: 'edit.rule1', rule: true },
    // IDEA EditMenu › FindMenuGroup（`<group id="FindMenuGroup" popup="true">`，
    // PlatformActions.xml:465-486）。子项顺序**逐条**照源码：
    //   Find · Replace · FindNext · FindPrevious · SelectAllOccurrences · SelectNextOccurrence ·
    //   UnselectPreviousOccurrence · ToggleFindInSelection · ToggleScrollToResultsDuringTyping
    //   · (分隔) · FindWordAtCaret · FindPrevWordAtCaret · (分隔) · FindInPath · ReplaceInPath
    // 键位同样取 `$default.xml`：Find = Ctrl+F、Replace = Ctrl+R、FindNext = F3、
    // FindPrevious = Shift+F3、SelectAllOccurrences = Ctrl+Alt+Shift+J、SelectNextOccurrence = Alt+J、
    // UnselectPreviousOccurrence = Alt+Shift+J、ToggleFindInSelection = Ctrl+Alt+E、
    // FindWordAtCaret = Ctrl+F3、FindPrevWordAtCaret = Ctrl+Shift+F3、FindInPath = Ctrl+Shift+F、
    // ReplaceInPath = Ctrl+Shift+R。
    // `ToggleScrollToResultsDuringTypingAction` **不渲染**：它管的是「边打字边把命中滚进视野」，
    // 本仓的查找栏本来就边输边定位，没有第二个状态可切（不放假开关）。
    // 「Find/Replace」现在打开的是**编辑器内查找栏**（上游 `SearchReplaceComponent`，
    // 见 src/editorFindController.ts），不是工程内那个对话框。
    { id: 'edit.findMenu', title: '查找', keywords: 'find replace search 查找 替换', children: [
      ctx.editable('find', '查找…', 'Ctrl F', 'find replace search 查找'),
      ctx.editable('replace', '替换…', 'Ctrl R', 'replace 替换'),
      ctx.editable('find.next', '查找下一个/移至下一个匹配项', 'F3', 'find next 下一个匹配项'),
      ctx.editable('find.previous', '查找上一个/移至上一个匹配项', 'Shift F3', 'find previous 上一个匹配项'),
      ctx.editable('occurrence.select', '选择所有匹配项', 'Ctrl Shift Alt J', 'all occurrences select all 所有匹配项'),
      ctx.editable('occurrence.next', '添加下一个匹配', 'Alt J', 'next occurrence 下一个匹配'),
      ctx.editable('occurrence.unselect', '取消选择匹配项', 'Alt Shift J', 'unselect occurrence 取消选择匹配项'),
      ctx.editable('find.toggleInSelection', '仅在选区内搜索', 'Ctrl Alt E', 'find in selection 选区'),
      { id: 'edit.ruleFind1', rule: true },
      ctx.editable('find.wordAtCaret', '查找文本光标处的字', 'Ctrl F3', 'find word at caret 光标处的字'),
      ctx.editable('find.prevWordAtCaret', '查找文本光标处的前一个匹配项', 'Ctrl Shift F3', 'find previous word at caret 光标处的字'),
      { id: 'edit.ruleFind2', rule: true },
      // FindInPath = Ctrl+Shift+F、ReplaceInPath = Ctrl+Shift+R（`$default.xml:538-540` / 同名块）。
      // 两者的落点都是**工程内查找**（本仓 `src/components/SearchPanel.vue`，上游 `FindPopupPanel`）——
      // 上游 ReplaceInPath 是同一个对话框带替换区展开，本仓的搜索面板本来就同时有查找与替换。
      { ...ctx.toolWindow('search', '在文件中查找', 'find in path find in files 在文件中查找'), id: 'edit.findInPath', keys: 'Ctrl Shift F' },
      { ...ctx.toolWindow('search', '在文件中替换', 'replace in path replace in files 在文件中替换'), id: 'edit.replaceInPath', keys: 'Ctrl Shift R' },
    ] },
    // EditMenu › FindUsagesMenuGroup：`LangActions.xml:112-114` 把它 add-to-group 到 EditMenu
    // 的 FindMenuGroup **之后**；成员顺序照 `intellij.platform.usageView.impl.actions.xml:33-41`
    // （FindUsages · ShowSettingsAndFindUsages · ShowUsages · 分隔 · FindUsagesInFile ·
    // HighlightUsagesInFile · GotoNext/PrevElementUnderCaretUsage · ShowRecentFindUsages）。
    // 本仓只有本行（`usage.highlight`，实现在 src/usageHighlightExtension.ts）+ Code 菜单里的
    // 「查找用法」（id `references`，同一组的第一项）；其余成员没有动作，不渲染假行。
    { id: 'edit.findUsagesGroup', title: '查找用法', keywords: 'find usages highlight usages in file 查找用法 高亮用法', children: [
      ctx.editable('usage.highlight', '高亮用法', 'Ctrl Shift F7', 'highlight usages in file 高亮用法 临时高亮 $default.xml:362'),
    ] },
    { id: 'edit.rule2', rule: true },
    ctx.editable('selectAll', '全选', 'Ctrl A', 'select all 全选'),
    // 在所选各行行尾加光标（上游 `EditorAddCaretPerSelectedLine`：注册
    // `platform/platform-impl/resources/intellij.platform.ide.impl.actions.xml:358`，菜单
    // `platform/platform-impl/resources/idea/PlatformActions.xml:485-487` 的 `EditSelectGroup` 里紧跟
    // `$SelectAll` ⇒ 本仓也放在「全选」之后一行）。文案
    // `platform/platform-resources-en/src/messages/ActionsBundle.properties:130`
    // = `Add Carets to Ends of Selected Lines`（中文包不在本地树 ⇒ 标签是英文原文直译；
    // 该 id **没有** `.description` 条目 ⇒ 不编描述）。
    // 键位栏**留空**：上游有键（`platform/platform-resources/src/keymaps/$default.xml:155-157` = `shift alt G`），
    // 但本仓的键位面（`src/keymap.ts` / `src/keymapBindings.ts` / `src/components/CodeEditor.vue`）都是保留文件
    // ⇒ 摘到键之前不写一个按下去没反应的加速键（判据 `tests/editor-line-ops.test.mjs` 的门禁同款），
    // 接线请求见 `docs/wiring-requests-2026-10-06-caretops.md` 的 R3。
    ctx.editable('caret.perLine', '在所选各行末尾添加光标', '', 'add carets to ends of selected lines 多光标 行尾 EditorAddCaretPerSelectedLine'),
    { id: 'edit.rule3', rule: true },
    ctx.editable('case.toggle', '切换大小写', 'Ctrl Shift U', 'case upper lower 大小写'),
    ctx.editable('line.join', '合并行', 'Ctrl Shift J', 'join lines 合并行'),
    ctx.editable('line.duplicate', '复制行', 'Ctrl D', 'duplicate copy line 复制行'),
    // 填充段落（上游 `FillParagraphAction`，`PlatformActions.xml:494` 就在 EditorDuplicate 之后：
    // EditSmartGroup 的次序是 ToggleCase(:491) → JoinLines(:492) → Duplicate(:493) → FillParagraph(:494)）。
    // 文案取 zh 包 `plugins/localization-zh/lib/localization-zh.jar` 的
    // `messages/ActionsBundle.properties:873`（英文原文
    // `platform/platform-resources-en/src/messages/ActionsBundle.properties:1946`）。
    // `$default.xml` 里没有它的键位 ⇒ 只给菜单行，不编快捷键。
    ctx.editable('paragraph.fill', '填充段落', '', 'fill paragraph 填充段落 折行'),
    // 排序行 / 反串行（上游 `EditorSortLines`/`EditorReverseLines`，`PlatformActions.xml:495-496`
    // 就在 `FillParagraph`(:494) 之后；`EditorTranspose`(:497) 本仓没有 ⇒ 不渲染假行）。
    // 文案是 `platform/platform-resources-en/src/messages/ActionsBundle.properties:173-174`
    // （`Sort Lines` / `Reverse Lines`）的直译：本地参考树里没有随 IDE 发货的中文包
    // （`plugins/localization-zh` 不在 community 源里），所以不引用中文行号、也不假称取自中文包。
    // 键位留空：`$default.xml` 里查不到这三条的绑定（全树只有 `keymaps/Sublime Text.xml:105` 给
    // `EditorSortLines` 绑过键），等 `$default.xml` 那一族真的进了本仓键位表再填。
    ctx.editable('line.sort', '排序行', '', 'sort lines 排序行 排序'),
    ctx.editable('line.reverse', '反串行', '', 'reverse lines 反串行 倒序'),
    // 删除重复行（上游 `EditorUniqueLines`，`ActionsBundle.properties:175` = `Delete Duplicate Lines`）。
    // **本仓菜单落点与上游不同**：上游只把它挂在编辑器动作组（`PlatformActions.xml:240`），
    // EditMenu 里没有这一行，用户在 IDEA 里靠 Find Action（Ctrl+Shift+A）够到它 ——
    // 而本仓的动作注册表 `src/actionRegistry.ts` 是保留文件（接线见 docs/wiring-requests-2026-10-06-caretops.md），
    // 不给菜单行的话这条命令就没有任何消费点 ⇒ 先按 EditSmartGroup 的尾巴给一行，差异如实记。
    ctx.editable('line.unique', '删除重复行', '', 'delete duplicate lines unique 删除重复行 去重'),
    // 代码块首尾移动（上游 `EditorCodeBlockStart`/`End` 与 ±`WithSelection`，
    // 键位 `$default.xml:569-571`/`:315-317`/`:318-320`/`:824-826`；
    // 文案 `messages/ActionsBundle.properties:568-571`（zh 包），英文原文
    // `platform/platform-resources-en/src/messages/ActionsBundle.properties:157-160`）。
    // **本仓菜单落点与上游不同**：上游这四条只有键位、没有菜单行，而本仓的键位面
    // （`src/keymapBindings.ts` / `CodeEditor.vue` 的 keymap）是冻结文件 ⇒ 先给菜单行让人够得着，
    // 键盘接线见 docs/wiring-requests-2026-10-06-bucket5b.md。
    ctx.editable('block.start', '将文本光标移至代码块开始', 'Ctrl [', 'code block start 代码块开始'),
    ctx.editable('block.end', '将文本光标移至代码块结束', 'Ctrl ]', 'code block end 代码块结束'),
    ctx.editable('block.startSelect', '在保持选区的情况下将文本光标移至代码块开始', 'Ctrl Shift [', 'code block start selection 代码块开始 选区'),
    ctx.editable('block.endSelect', '在保持选区的情况下将文本光标移至代码块结束', 'Ctrl Shift ]', 'code block end selection 代码块结束 选区'),
    // 用自定义折叠标记包围选区（上游是 Ctrl+Alt+T「环绕方式(_S)…」列表里的一族，
    // `CustomFoldingSurroundDescriptor.java:217-227` 每个 provider 一行）。本仓那个列表在
    // `src/surroundTemplates.ts`（别的桶名下）⇒ 先给一条走默认标记（`//<region>`）的菜单行，
    // 列表侧接线见交接请求。
    ctx.editable('fold.surroundRegion', '用折叠区域标记包围', '', 'surround region folding 折叠区域 包围'),
    ctx.editable('line.delete', '删除行', 'Ctrl Y', 'delete line 删除行'),
    ctx.editable('line.moveUp', '上移行', 'Alt Shift ↑', 'move line up 上移行'),
    ctx.editable('line.moveDown', '下移行', 'Alt Shift ↓', 'move line down 下移行'),
    // IDEA Edit menu: 缩进选区 (Tab) / 反缩进或缩进选区 (Shift+Tab).
    ctx.editable('indent.selection', '缩进选区', 'Tab', 'indent selection 缩进'),
    ctx.editable('indent.selection.less', '反缩进选区', 'Shift Tab', 'outdent selection 反缩进'),
    // EditMenu › ConvertIndentsGroup —— IDEA 里是**子菜单**（:500-505），两项：To Spaces / To Tabs。
    // 作用于全文件，宽度跟随「编辑器 › 代码风格 › 制表符与缩进」的 tabSize。
    { id: 'edit.convertIndents', title: '转换缩进', keywords: 'convert indents spaces tabs 转换缩进 空格 制表符', children: [
      { id: 'edit.indentsToSpaces', title: '转换为空格缩进', keywords: 'convert indents to spaces 空格', run: () => ctx.convertIndents('spaces') },
      { id: 'edit.indentsToTabs', title: '转换为制表符缩进', keywords: 'convert indents to tabs 制表符', run: () => ctx.convertIndents('tabs') },
    ] },
    { id: 'edit.rule4', rule: true },
    ctx.editable('comment.line', '行注释', 'Ctrl /', 'comment line 行注释'),
    ctx.editable('comment.block', '块注释', 'Ctrl Shift /', 'comment block 块注释'),
    { id: 'edit.rule4', rule: true },
    // 扩展选区（上游 Extend Selection 一族 + `BlockCommentSelectioner` 那个块注释选择器）。
    // **快捷键一栏留空**：$default.xml 里查不到 ExtendSelection 的绑定（全树也没有
    // EditorExtendSelectionHandler），按「无上游依据不编键位」的规矩不编，见 src/editorExtendSelection.ts 头第 5 条。
    ctx.editable('selection.extend', '扩展选区（向右）', '', 'extend selection 扩展选区 块注释 smart select'),
    ctx.editable('selection.extendLeft', '扩展选区（向左）', '', 'extend selection left 扩展选区 向左'),
    // 移动到配对的括号（上游 `EditorMatchBrace`，`intellij.platform.lang.impl.actions.xml:23`）。
    // 键位 Ctrl+Shift+M 有上游依据（`$default.xml:1146-1148`），但 keymap 是保留文件 ⇒ 已提接线请求，
    // 这一行的键位栏先留空，等键位真的注册了再填（不编一个按下去没反应的加速键）。
    ctx.editable('brace.match', '移动到配对的括号', 'Ctrl Shift M', 'match brace 配对括号 匹配括号'),
    { id: 'edit.rule4', rule: true },
    ctx.editable('cursor.above', '在上行添加光标', 'Ctrl Alt Shift ↑', 'multiple cursors column 多光标'),
    ctx.editable('cursor.below', '在下行添加光标', 'Ctrl Alt Shift ↓', 'multiple cursors column 多光标'),
    ctx.editable('occurrence.next', '添加下一个匹配', 'Alt J', 'next occurrence multiple cursors 下一个匹配'),
    ctx.editable('occurrence.select', '选中所有相同内容', 'Ctrl Shift Alt J', 'all occurrences 所有匹配'),
    // 折叠这一族**不在编辑菜单里**：上游是 Code 菜单的 `FoldingGroup` 子菜单
    // （`LangActions.xml:270-303`），已挪到 `src/menus/codeMenu.ts`。
    // `PlatformActions.xml:241-242`：`EditorToggleInsertState` 紧跟 `EditorToggleColumnMode` **之前**。
    // 文案 `action.EditorToggleInsertState.text` =「切换插入/覆盖」，键位 INSERT（`$default.xml:457-459`）。
    { id: 'edit.toggleInsertState', title: '切换插入/覆盖', keys: 'Insert', keywords: 'insert overwrite 插入 覆盖 改写', enabled: ctx.hasEditor, run: () => ctx.runEditor('editor.overwrite') },
    { id: 'edit.columnSelect', title: '列选择模式', keys: 'Alt Shift Insert', keywords: 'column selection block selection rectangular 列选择 块选择', enabled: ctx.hasEditor, run: () => ctx.runEditor('column.select') },
    // EditMenu › Macros（`PlatformActions.xml:506-510`）：紧跟 `ConvertIndentsGroup` 之后；
    // 这里的顺序里「转换缩进」在中段，宏组按源码放在菜单收尾前（IDEA 的编辑菜单末尾就是 ConvertIndents + Macros）。
    ...createMacrosMenuRows(ctx.macros),
  ]
  return rows
}
