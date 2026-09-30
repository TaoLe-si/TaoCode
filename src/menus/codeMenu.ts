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
    // FoldingGroup（`LangActions.xml:270-303`，Code 菜单里的「折叠」子菜单；组名 = `group.FoldingGroup.text`）。
    // 成员顺序与分组照源码：展开三项 → 收起三项 → 展开到级别 ▸ → 全部展开到级别 ▸ → 语言侧（文档注释）
    // → 切换折叠 → 折叠选区/移除区域 · 折叠代码块。文案逐条取 ActionsBundle（见 docs/inventory/verdict-folding.md §A）。
    {
      id: 'code.folding', title: '折叠', children: [
        ctx.editable('unfold', '展开', 'Ctrl =', 'expand unfold region 展开'),
        ctx.editable('unfold.recursively', '递归展开', 'Ctrl Alt =', 'expand recursively 递归展开'),
        ctx.editable('unfoldAll', '全部展开', 'Ctrl Shift =', 'expand all 全部展开'),
        { id: 'code.folding.rule1', rule: true },
        ctx.editable('fold', '收起', 'Ctrl -', 'collapse fold region 收起'),
        ctx.editable('fold.recursively', '递归收起', 'Ctrl Alt -', 'collapse recursively 递归收起'),
        ctx.editable('foldAll', '全部收起', 'Ctrl Shift -', 'collapse all 全部收起'),
        { id: 'code.folding.rule2', rule: true },
        // `ExpandToLevel` / `ExpandAllToLevel` 是两个 popup 组（`:284-297`），行文案就是 `_1`.._5（`action.ExpandToLevel1.text`）。
        {
          id: 'code.folding.caretLevels', title: '展开到级别(_E)', children: [
            ctx.editable('unfold.level1', '1', '', 'expand to level 1 展开到级别'),
            ctx.editable('unfold.level2', '2', '', 'expand to level 2 展开到级别'),
            ctx.editable('unfold.level3', '3', '', 'expand to level 3 展开到级别'),
            ctx.editable('unfold.level4', '4', '', 'expand to level 4 展开到级别'),
            ctx.editable('unfold.level5', '5', '', 'expand to level 5 展开到级别'),
          ],
        },
        {
          id: 'code.folding.allLevels', title: '全部展开到级别(_L)', children: [
            ctx.editable('unfold.all.level1', '1', '', 'expand all to level 1 全部展开到级别'),
            ctx.editable('unfold.all.level2', '2', '', 'expand all to level 2 全部展开到级别'),
            ctx.editable('unfold.all.level3', '3', '', 'expand all to level 3 全部展开到级别'),
            ctx.editable('unfold.all.level4', '4', '', 'expand all to level 4 全部展开到级别'),
            ctx.editable('unfold.all.level5', '5', '', 'expand all to level 5 全部展开到级别'),
          ],
        },
        { id: 'code.folding.rule3', rule: true },
        // `LanguageSpecificFoldingGroup` 是个**不带 popup 的组**（`:278-282`）⇒ 两行直接内联在这里。
        ctx.editable('unfold.docs', '展开文档注释(_D)', '', 'expand doc comments 展开文档注释'),
        ctx.editable('fold.docs', '收起文档注释(_O)', '', 'collapse doc comments 收起文档注释'),
        { id: 'code.folding.rule4', rule: true },
        ctx.editable('fold.toggle', '切换折叠', '', 'toggle fold expand collapse 切换折叠'),
        { id: 'code.folding.rule5', rule: true },
        ctx.editable('fold.selection', '折叠选区/移除区域(_S)', 'Ctrl .', 'fold selection custom region 折叠选区 移除区域'),
        ctx.editable('fold.block', '折叠代码块(_B)', 'Ctrl Shift .', 'collapse block braces 折叠代码块'),
      ],
    },
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
