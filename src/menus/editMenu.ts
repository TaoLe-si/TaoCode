// 编辑菜单（EditMenu，PlatformActions.xml:446-518 的 TaoCode 对应物）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
import type { MenuRow } from './types'
import { createMacrosMenuRows } from './macrosMenu'

export interface EditMenuContext {
  // 参数统一 any：参数逆变下 App 的窄签名函数才能赋进来（后续批次可收紧）。
  runEditor: (name: any, arg?: any) => any
  convertIndents: (mode: any) => void
  hasEditor: () => boolean
  editable: (name: any, title: any, keys?: any, keywords?: any) => MenuRow
  toolWindow: (view: any, title: any, keywords: any, needsDesktop?: any) => MenuRow
  copyReference: () => any
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
    // IDEA EditMenu › FindMenuGroup —— 也是**子菜单**（`<group id="FindMenuGroup" popup="true">`，
    // PlatformActions.xml:465-486）。子项顺序按源码：Find · Replace · FindNext · FindPrevious ·
    // 多光标选择 · (分隔) · 光标处查找 · (分隔) · FindInPath · ReplaceInPath。
    // 说明：TaoCode 没有 IDEA 的编辑器内“替换条”，它的「替换下一个 / 替换全部」是那条替换条上的
    // 两个按钮在这里的落点，所以随这一组一起放进子菜单，而不是发明两个新动作。
    { id: 'edit.findMenu', title: '查找', keywords: 'find replace search 查找 替换', children: [
      ctx.editable('find', '在文件中查找与替换', 'Ctrl F', 'find replace search 查找'),
      ctx.editable('find.next', '查找下一个', 'F3', 'find next 下一个'),
      ctx.editable('find.previous', '查找上一个', 'Shift F3', 'find previous 上一个'),
      { id: 'edit.ruleFind1', rule: true },
      ctx.editable('replace.next', '替换下一个', undefined, 'replace next 替换'),
      ctx.editable('replace.all', '替换全部', undefined, 'replace all 全部替换'),
      { id: 'edit.ruleFind2', rule: true },
      ctx.toolWindow('search', '全局搜索与替换', 'search in files find in files global 全局搜索'),
    ] },
    { id: 'edit.rule2', rule: true },
    ctx.editable('selectAll', '全选', 'Ctrl A', 'select all 全选'),
    { id: 'edit.rule3', rule: true },
    ctx.editable('case.toggle', '切换大小写', 'Ctrl Shift U', 'case upper lower 大小写'),
    ctx.editable('line.join', '合并行', 'Ctrl Shift J', 'join lines 合并行'),
    ctx.editable('line.duplicate', '复制行', 'Ctrl D', 'duplicate copy line 复制行'),
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
    ctx.editable('cursor.above', '在上行添加光标', 'Ctrl Alt Shift ↑', 'multiple cursors column 多光标'),
    ctx.editable('cursor.below', '在下行添加光标', 'Ctrl Alt Shift ↓', 'multiple cursors column 多光标'),
    ctx.editable('occurrence.next', '添加下一个匹配', 'Alt J', 'next occurrence multiple cursors 下一个匹配'),
    ctx.editable('occurrence.select', '选中所有相同内容', 'Ctrl Shift Alt J', 'all occurrences 所有匹配'),
    // 折叠这一族**不在编辑菜单里**：上游是 Code 菜单的 `FoldingGroup` 子菜单
    // （`LangActions.xml:270-303`），已挪到 `src/menus/codeMenu.ts`。
    { id: 'edit.columnSelect', title: '列选择模式', keys: 'Alt Shift Insert', keywords: 'column selection block selection rectangular 列选择 块选择', enabled: ctx.hasEditor, run: () => ctx.runEditor('column.select') },
    // EditMenu › Macros（`PlatformActions.xml:506-510`）：紧跟 `ConvertIndentsGroup` 之后；
    // 这里的顺序里「转换缩进」在中段，宏组按源码放在菜单收尾前（IDEA 的编辑菜单末尾就是 ConvertIndents + Macros）。
    ...createMacrosMenuRows(ctx.macros),
  ]
  return rows
}
