// 代码菜单（CodeMenu，PlatformActions.xml 的 Code 组 + ActionsBundle 的意图/用法组）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
// 成员先用 any（参数逆变 + 内部类型未提取），随批次收紧。
import type { MenuRow } from './types'
import { createInspectCodeInCodeMenuRows, type AnalyzeGroupContext } from './analyzeMenu'

export interface CodeMenuContext extends AnalyzeGroupContext {
  hasEditor: () => boolean
  active: any
  lspReady: any
  isDesktop: boolean
  editable: (name: any, title: any, keys?: any, keywords?: any) => MenuRow
  semantic: (kind: any, title: any, keys: any, keywords: any) => MenuRow
  openTemplateChooser: () => void
  openSurround: () => void
  openGeneratePopup: () => void
  showQuickDoc: () => any
  copyReference: () => any
  runOrganizeImports: () => any
  showBlame: () => any
  /** 「追溯」是否开着 —— `AnnotateToggleAction` 是 `ToggleAction`（`:67`），菜单行带勾选态。 */
  blameEnabled: () => boolean
  compareWithClipboard: () => any
  copyFilePath: () => any
}

export function createCodeMenuRows(ctx: CodeMenuContext): MenuRow[] {
  return [
    ctx.editable('completion', '代码补全', 'Ctrl Space', 'completion autocomplete suggest 补全'),
    // 检查这一族在主菜单里的落点：`InspectCodeInCodeMenuGroup`，上游位置就是紧跟
    // `CodeCompletionGroup`、在 `InsertLiveTemplate` 之前（`LangActions.xml:238-259` 与
    // `actionGroupStructure.txt` 的 CodeMenu 段）。
    ...createInspectCodeInCodeMenuRows(ctx),
    ctx.editable('template.expand', '展开实时模板', 'Ctrl Alt J', 'live template postfix expand 模板'),
    { id: 'code.templateChooser', title: '实时模板列表…', keys: 'Ctrl J', keywords: 'live template list chooser insert 模板列表', enabled: ctx.hasEditor, run: ctx.openTemplateChooser },
    { id: 'code.surround', title: '用模板包裹选中代码', keys: 'Ctrl Alt T', keywords: 'surround wrap try if block 包裹 模板', enabled: ctx.hasEditor, run: ctx.openSurround },
    { id: 'code.generate', title: '生成…', keys: 'Alt Insert', keywords: 'generate constructor getter setter toString override 生成 构造器', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: ctx.openGeneratePopup },
    // ActionsBundle: ShowIntentionActions is "Show Context Actions" (Alt+Enter).
    ctx.semantic('codeAction', '显示上下文操作', 'Alt Enter', 'intent quick fix refactor code action 意图 上下文操作'),
    { id: 'code.rule1', rule: true },
    ctx.semantic('definition', '跳转到定义', 'Ctrl B', 'goto definition 定义'),
    ctx.semantic('implementation', '跳转到实现', 'Ctrl Alt B', 'goto implementation 实现'),
    ctx.semantic('references', '查找用法', 'Alt F7', 'find usages references 用法'),
    ctx.semantic('callHierarchy', '调用层次', 'Ctrl Alt H', 'call hierarchy incoming outgoing 调用层次'),
    ctx.semantic('typeHierarchy', '类型层次', 'Ctrl H', 'type hierarchy supertypes subtypes 类型层次'),
    ctx.semantic('rename', '重命名', 'Shift F6', 'rename refactor symbol 重命名'),
    ctx.semantic('signature', '参数信息', 'Ctrl P', 'signature parameter info 参数信息'),
    { id: 'code.quickDoc', title: '快速文档', keys: 'Ctrl Q', keywords: 'quick documentation hover 快速文档 文档', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.showQuickDoc() },
    { id: 'code.copyRef', title: '复制引用', keys: 'Ctrl Alt Shift C', keywords: 'copy reference qualified name 复制引用 复制路径', enabled: () => Boolean(ctx.active.value), run: () => void ctx.copyReference() },
    { id: 'code.rule2', rule: true },
    ctx.semantic('selection.grow', '扩展到上一级语法单元', 'Ctrl W', 'extend selection syntax 扩展选区'),
    ctx.semantic('selection.shrink', '缩小语法选区', 'Ctrl Shift W', 'shrink selection syntax 缩小选区'),
    ctx.semantic('format', '重新格式化', 'Ctrl Alt L', 'format code reformat 格式化'),
    // IDEA Code menu: 自动缩进 (Auto-Indent, Ctrl+Alt+I) and 优化导入 (Optimize
    // Imports, Ctrl+Alt+O — a source.organizeImports code action).
    ctx.editable('indent.selection', '自动缩进', 'Ctrl Alt I', 'auto indent selection 自动缩进'),
    { id: 'code.optimizeImports', title: '优化导入', keys: 'Ctrl Alt O', keywords: 'optimize imports organize 优化导入', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.runOrganizeImports() },
    { id: 'code.rule3', rule: true },
    { id: 'code.blame', title: 'Git 追溯（Annotate）', keywords: 'blame annotate git history 追溯', checked: () => ctx.blameEnabled(), enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.showBlame() },
    { id: 'code.compareClipboard', title: '与剪贴板比较', keywords: 'compare clipboard diff 与剪贴板比较', enabled: () => Boolean(ctx.active.value), run: () => void ctx.compareWithClipboard() },
    { id: 'code.copyPath', title: '复制文件路径', keywords: 'copy file path absolute 复制文件路径', enabled: () => Boolean(ctx.active.value), run: () => void ctx.copyFilePath() },
    // ActionsBundle: "Toggle Read-Only Attribute" (synonyms Make File Writable /
    // Read-Only); no default shortcut in $default.xml.
  ]
}
