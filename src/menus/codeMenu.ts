// 代码菜单（CodeMenu，PlatformActions.xml 的 Code 组 + ActionsBundle 的意图/用法组）。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
// 成员先用 any（参数逆变 + 内部类型未提取），随批次收紧。
import type { MenuRow } from './types'
import { createInspectCodeInCodeMenuRows, type AnalyzeGroupContext } from './analyzeMenu.ts'
import { createSaveAsTemplateHost, type SaveAsTemplateHostDeps } from '../saveAsTemplateHost.ts'
// 「比较对象…」的标题常量（上游 `action.compare.with.text`，中文包取值）。
import { COMPARE_WITH_TEXT } from '../compareFiles.ts'
// 键位显示的两个现成真源：`foldingLevelChords` 是「展开到级别」那五条 chord 的**权威表**
// （键名 + 命令名），`windowsKeystroke` 是本仓既有的显示串格式化函数（`Ctrl Shift V` → `Ctrl+Shift+V`，
// 上游 `WinKeyStrokePresentation` 口径）。菜单这一侧只查、不手抄第二份键位文案。
import { foldingLevelChords } from '../foldingKeymap.ts'
import { windowsKeystroke } from '../presentationAssistant.ts'

export interface CodeMenuContext extends AnalyzeGroupContext {
  hasEditor: () => boolean
  foldSelectionEnabled: () => boolean
  active: any
  lspReady: any
  isDesktop: boolean
  editable: (name: any, title: any, keys?: any, keywords?: any) => MenuRow
  semantic: (kind: any, title: any, keys: any, keywords: any) => MenuRow
  openTemplateChooser: () => void
  saveAsTemplateDeps: SaveAsTemplateHostDeps
  openSurround: () => void
  openGeneratePopup: () => void
  showQuickDoc: () => any
  copyReference: () => any
  runOrganizeImports: () => any
  showBlame: () => any
  /** 「追溯」是否开着 —— `AnnotateToggleAction` 是 `ToggleAction`（`:67`），菜单行带勾选态。 */
  blameEnabled: () => boolean
  compareWithClipboard: () => any
  /** 「比较对象…」（上游 `CompareFilesAction` 的单文件分支）。 */
  compareWithFile: () => any
  copyFilePath: () => any
}

/**
 * 一条 chord 键名（`src/foldingKeymap.ts` 的 CodeMirror 写法，如 `Ctrl-* 1`）→ 菜单上的显示串。
 *
 * 逐段（空格分段 = CodeMirror 的 `buildKeyList` 口径，`@codemirror/view/dist/index.js:9164`）交给既有的
 * `windowsKeystroke()`，段与段之间用上游的分隔写法 `", "` —— 依据
 * `platform/platform-api/src/com/intellij/openapi/keymap/KeymapTextContext.java:43-73`
 * （`getShortcutText(Shortcut)`：先第一键、再 `s += ", " + 第二键文本`）。
 * 菜单右栏就是这一串（`platform/platform-impl/src/com/intellij/ui/plaf/beg/BegMenuItemUI.java:259-262`
 * 画 `ActionMenuItem.getFirstShortcutText()`，而 `platform/platform-impl/src/com/intellij/openapi/actionSystem/impl/ActionMenuItem.kt:190-194`
 * 那个串正是 `KeymapUtil.getShortcutText(getShortcutSetForDisplay(action))` ⇒ **两段式 chord 在菜单里是印出来的**）。
 */
function chordKeys(command: string): string {
  const binding = foldingLevelChords.find(item => item.command === command)
  return binding ? binding.key.split(' ').map(stroke => windowsKeystroke(stroke.replace(/-/g, ' '))).join(', ') : ''
}

export function createCodeMenuRows(ctx: CodeMenuContext): MenuRow[] {
  const saveAsTemplate = createSaveAsTemplateHost(ctx.saveAsTemplateDeps)
  return [
    ctx.editable('completion', '代码补全', 'Ctrl Space', 'completion autocomplete suggest 补全'),
    // CodeCompletionGroup（`intellij.platform.lang.impl.actions.xml:133-147`）：补全 → 智能类型补全 →
    // EditorCompleteStatement → …。本仓有补全与「完成当前语句」；键位（Ctrl+Shift+Enter）在
    // CodeEditor.vue 的 keymap 里，那一处本批冻结，所以这里不公布键位（菜单可达、键位未接）。
    ctx.editable('statement.complete', '完成当前语句', '', 'complete current statement smart enter 完成语句'),
    // 检查这一族在主菜单里的落点：`InspectCodeInCodeMenuGroup`，上游位置就是紧跟
    // `CodeCompletionGroup`、在 `InsertLiveTemplate` 之前（`LangActions.xml:238-259` 与
    // `actionGroupStructure.txt` 的 CodeMenu 段）。
    ...createInspectCodeInCodeMenuRows(ctx),
    ctx.editable('template.expand', '展开实时模板', 'Ctrl Alt J', 'live template postfix expand 模板'),
    { id: 'code.templateChooser', title: '实时模板列表…', keys: 'Ctrl J', keywords: 'live template list chooser insert 模板列表', enabled: ctx.hasEditor, run: ctx.openTemplateChooser },
    { id: 'code.saveAsTemplate', title: '另存为实时模板…', keywords: 'Save as Live Template save selected text 保存 实时模板', enabled: saveAsTemplate.available, run: () => { void saveAsTemplate.run() } },
    { id: 'code.ruleTemplate', rule: true },
    { id: 'code.surround', title: '用模板包裹选中代码', keys: 'Ctrl Alt T', keywords: 'surround wrap try if block 包裹 模板', enabled: ctx.hasEditor, run: ctx.openSurround },
    // `Unwrap`（上游 `UnwrapAction`，$default.xml:917-920 = Ctrl+Shift+Delete）：去掉最内层
    // 可拆的 if/for/while/… 包裹；PSI 版本在 lang-impl/codeInsight/unwrap，本仓是文本子集
    // （src/unwrap.ts，正文回缩一层；try/catch、do/while 这类拆了会破坏语法的直接拒绝）。
    ctx.editable('unwrap', 'Unwrap/Remove', 'Ctrl Shift Delete', 'unwrap remove braces 拆开 包裹 去括号'),
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
        // 键位栏：caret 族（`$default.xml:385-404`，`control MULTIPLY` + `1`..`5`）在本仓**真的能按到**
        // （`src/foldingKeymap.ts:49-55` → `src/editorCommands.ts:291-295` → `src/components/CodeEditor.vue:882`），
        // 所以显示串从那张权威表推导（`chordKeys()`），不在菜单里手抄。
        // `ExpandAllToLevel1..5`（`$default.xml:405-424`，`control shift MULTIPLY` + 1..5）**不给键位**：
        // 乘号是字符键，`w3c-keyname` 让 `Ctrl-Shift-*` 与 `Ctrl-*` 在浏览器里分不开
        // （`@codemirror/view/dist/index.js:9106-9116` 的 `modifiers(..., !isChar)` 首查就把 Shift 摘掉），
        // 那一族绑定永不可命中、真按会得到 caret 族的动作 ⇒ 给它印快捷键就是假加速键（规约 §3）。
        // 判据：`tests/menukeys-probe.test.mjs`。
        {
          id: 'code.folding.caretLevels', title: '展开到级别(_E)', children: [
            ctx.editable('unfold.level1', '1', chordKeys('unfold.level1'), 'expand to level 1 展开到级别'),
            ctx.editable('unfold.level2', '2', chordKeys('unfold.level2'), 'expand to level 2 展开到级别'),
            ctx.editable('unfold.level3', '3', chordKeys('unfold.level3'), 'expand to level 3 展开到级别'),
            ctx.editable('unfold.level4', '4', chordKeys('unfold.level4'), 'expand to level 4 展开到级别'),
            ctx.editable('unfold.level5', '5', chordKeys('unfold.level5'), 'expand to level 5 展开到级别'),
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
        { ...ctx.editable('fold.selection', '折叠选区/移除区域(_S)', 'Ctrl .', 'fold selection custom region 折叠选区 移除区域'), enabled: ctx.foldSelectionEnabled },
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
    // 「自动缩进」= 上游 `AutoIndentLinesHandler`（**重算**行首空白，不是加一级）：
    // 命令 `indent.auto` 的规则在 src/autoIndentLines.ts。旧行错接成 `indent.selection`（= indentMore）。
    ctx.editable('indent.auto', '自动缩进', 'Ctrl Alt I', 'auto indent selection 自动缩进'),
    { id: 'code.optimizeImports', title: '优化导入', keys: 'Ctrl Alt O', keywords: 'optimize imports organize 优化导入', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.runOrganizeImports() },
    { id: 'code.rule3', rule: true },
    { id: 'code.blame', title: 'Git 追溯（Annotate）', keywords: 'blame annotate git history 追溯', checked: () => ctx.blameEnabled(), enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.showBlame() },
    // `PlatformActions.xml:562-568` 的 `CompareActions` 组：`PairFileActions`（比较文件 / 与编辑器比较）
    // 在前，`CompareClipboardWithSelection` 在后。本仓原先只有最后那一条。
    { id: 'code.compareWith', title: COMPARE_WITH_TEXT, keywords: 'compare with file two files diff 比较对象 比较文件', enabled: () => Boolean(ctx.active.value) && ctx.isDesktop, run: () => void ctx.compareWithFile() },
    { id: 'code.compareClipboard', title: '与剪贴板比较', keywords: 'compare clipboard diff 与剪贴板比较', enabled: () => Boolean(ctx.active.value), run: () => void ctx.compareWithClipboard() },
    { id: 'code.copyPath', title: '复制文件路径', keywords: 'copy file path absolute 复制文件路径', enabled: () => Boolean(ctx.active.value), run: () => void ctx.copyFilePath() },
    // ActionsBundle: "Toggle Read-Only Attribute" (synonyms Make File Writable /
    // Read-Only); no default shortcut in $default.xml.
  ]
}
