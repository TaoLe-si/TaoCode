// 视图菜单（ViewMenu，PlatformActions.xml:519-636 的 TaoCode 对应物）：外观 / 工具窗口 /
// 编辑器开关 / 布局。一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
// 成员先用 any（参数逆变 + 内部类型），随第三批提取 Tab/Pane/SettingsSectionHint 命名类型后收紧。
import type { MenuRow } from './types'
import { BIDI_DIRECTIONS, bidiDirectionActionId, bidiDirectionLabel } from '../bidiTextDirection.ts'
import { TOOL_MNEMONIC_ORDER, toolTitles, toolWindowOrder, type ToolWindowId } from '../toolWindowMeta.ts'

/**
 * `ToolWindowsGroup` 子项的排序 —— 照 `ToolWindowsGroup.java:78-87` 的 `getActionComparator`：
 * **先按助记符**（`ActivateToolWindowAction.Manager.getMnemonicForToolWindow`，没有助记符的排最后），
 * 助记符相同的再按工具窗口 id（不区分大小写）。
 * 本仓的助记符顺序就是 `TOOL_MNEMONIC_ORDER`（Alt+0…9 的注册顺序），其余按 id 排。
 */
function toolWindowGroupOrder(): ToolWindowId[] {
  const withMnemonic: readonly ToolWindowId[] = TOOL_MNEMONIC_ORDER
  const rest = toolWindowOrder.filter(id => !withMnemonic.includes(id)).slice().sort()
  return [...withMnemonic, ...rest]
}
import { defaultEditorSettings } from '../settingsModel.ts'
import { stepEditorFontSize } from '../editorFontSize.ts'

export interface ViewMenuContext {
  changeSplitOrientation: any
  isDesktop: any
  active: any
  activity: any
  bottom: any
  changeTheme: any
  chooseBackgroundImage: any
  editable: any
  editorSettings: any
  explorer: any
  fileTreeRef: any
  hasEditor: any
  saveSettingsPatch: any
  showOutput: any
  splitOrientation: any
  splitTabOut: any
  theme: any
  togglePowerSave: any
  toggleZenMode: any
  toolWindow: any
  /** 本地历史是 IDEA 的 ShowHistoryAction **对话框**（不是工具窗口）。 */
  localHistoryDialog: MenuRow
  unsplit: any
  unsplitAll: any
  workspace: any
  zenMode: any
  fullScreen: any
  toggleFullScreen: any
  distractionFreeMode: any
  toggleDistractionFreeMode: any
  /** `ToolWindowsGroup` 的子项要用它（宿主已有的 `activateToolWindow`）。 */
  activateToolWindow: (id: any) => void
  /**
   * 工具窗口此刻可不可用（`src/toolWindowStripes.ts` 的 `toolDisabled`）。`ActivateToolWindowAction
   * .update`（`:130-137`）用 `toolWindow.isAvailable` 决定整行**消失**（弹层里）还是**灰着**
   * （主菜单 / 查找操作），本仓的 View 菜单那一组是弹层，所以要它。
   */
  toolDisabled: (id: any) => boolean
}

  export function createViewMenuRows(ctx: ViewMenuContext): MenuRow[] {
  const rows: MenuRow[] = [
    // ViewMenu 的**第一项**：`<reference ref="ToolWindowsGroup"/>`（PlatformActions.xml:522），
    // 定义在 `intellij.platform.ide.impl.actions.xml:367`
    // —— `<group id="ToolWindowsGroup" class="com.intellij.ide.actions.ToolWindowsGroup" popup="true"/>`。
    // 它的子项**就是一批 `ActivateToolWindowAction`**（`ToolWindowsGroup.java:39-44` 的 `getChildren`
    // 逐个返回 activate 动作），**不是**"每个窗口一个子菜单" —— 所以这里是平铺的窗口行，
    // 点一行 = 激活那个窗口；顺序照 `:78-87` 的 `getActionComparator`（助记符优先，再按 id）。
    // 与「窗口」菜单里那批 `ActivateToolWindowActions`（PlatformActions.xml:1310，**不带 popup**）
    // 不是重复：IDEA 里两处都列同一批动作 —— View 菜单一个入口、Window 菜单一个内联组。
    { id: 'view.toolWindowsGroup', title: '工具窗口', keywords: 'tool windows activate show 工具窗口 显示 激活', children: toolWindowGroupOrder().map(id => ({
      id: `view.toolWindow.${id}`, title: `激活 ${toolTitles[id]}`,
      // 上游 `ActivateToolWindowAction.update`（`ActivateToolWindowAction.kt:130-137`）的可用性 =
      // `toolWindow.isAvailable || hasEmptyState(project)`，且按**动作出现的位置**分派：
      // `ActionPlaces.POPUP` 时 `isVisible = available`（整行不见），**其它位置**（含主菜单）
      // `isEnabled = available`（灰着）。
      // 本仓这一组是 View 菜单里的 `ToolWindowsGroup`（`ToolWindowsGroup.java:39-44`），而主菜单是
      // `place = ActionPlaces.MAIN_MENU`（`JMenuBasedIdeMenuBarHelper.kt:69`），且 place 会**原样
      // 传进子菜单**（`Utils.kt:708` 的 `ActionMenu(context, place, …)`）—— 所以这里走的是
      // **灰着**那一支，不是隐藏。
      // 原先 `enabled` 只看 `workspace`：未就绪的「结构」等行看着可点，点下去被
      // `activateToolWindow` 的 `if (toolDisabled(id)) return` 静默吃掉（"看得见但点了没反应"）。
      keywords: `tool window ${id} activate 工具窗口 激活`,
      enabled: () => Boolean(ctx.workspace.value) && !ctx.toolDisabled(id), run: () => ctx.activateToolWindow(id),
    })) },
    { id: 'view.explorer', title: () => `${ctx.explorer.value ? '隐藏' : '显示'}文件面板`, keywords: 'project view files tool window 文件面板', run: () => { ctx.explorer.value = !ctx.explorer.value } },
    { id: 'view.trace', title: () => `${ctx.activity.value ? '隐藏' : '显示'}处理记录`, keywords: 'ctx.activity trace bridge 处理记录', run: () => { ctx.activity.value = !ctx.activity.value } },
    { id: 'view.output', title: () => `${ctx.bottom.value ? '隐藏' : '显示'}输出面板`, keywords: 'output ctx.bottom tool window 输出面板', run: () => { ctx.bottom.value = !ctx.bottom.value } },
    { id: 'view.rule0', rule: true },
    { id: 'view.splitH', title: '向右拆分并移动', keywords: 'split right move tab opposite group 分屏 右拆', enabled: () => Boolean(ctx.active.value), run: () => ctx.splitTabOut(ctx.active.value!, 'horizontal') },
    { id: 'view.splitV', title: '向下拆分并移动', keywords: 'split down move tab opposite group 分屏 下拆', enabled: () => Boolean(ctx.active.value), run: () => ctx.splitTabOut(ctx.active.value!, 'vertical') },
    { id: 'view.unsplit', title: '取消拆分', keywords: 'ctx.unsplit close split 取消拆分', enabled: () => ctx.splitOrientation.value !== 'none', run: () => ctx.unsplit() },
    { id: 'view.unsplitAll', title: '取消所有拆分', keywords: 'ctx.unsplit all 取消所有拆分', enabled: () => ctx.splitOrientation.value !== 'none', run: () => ctx.unsplitAll() },
    { id: 'view.changeOrientation', title: '更改拆分方向', keywords: 'change orientation rotate split 切换拆分方向', enabled: () => ctx.splitOrientation.value !== 'none', run: ctx.changeSplitOrientation },
    // ViewMenu (`PlatformActions.xml:521-597`) lists no maximize/hide-all action at all — the only
    // entry point is `HideAllWindows` in the Window menu (`:656`), so the duplicate that used to
    // sit here (same title prefix, same Ctrl+Shift+F12) is gone rather than kept as a second face
    // of one action.
    { id: 'view.rule1', rule: true },
    { id: 'view.sectionWindows', section: '工具窗口' },
    ctx.toolWindow('files', '项目文件', 'project files tree ctx.explorer 项目文件'),
    ctx.toolWindow('git', '源代码管理', 'vcs git changes commit 源代码管理'),
    ctx.toolWindow('vcslog', 'VCS 日志', 'vcs log commit graph history 提交图 日志'),
    ctx.toolWindow('search', '全局搜索', 'search in files find 全局搜索'),
    ctx.toolWindow('todo', '待办事项', 'todo tasks markers 待办'),
    ctx.toolWindow('outline', '文件结构', 'structure file outline symbols 结构'),
    ctx.toolWindow('bookmarks', '书签', 'bookmark mnemonic list 书签', false),
    ctx.toolWindow('debug', '调试面板', 'debug debugger breakpoints run 调试', true),
    ctx.localHistoryDialog,
    { id: 'view.terminal', title: '终端', keywords: 'terminal console shell prompt 终端', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showOutput('terminal') },
    { id: 'view.collapseAll', title: '全部折叠项目树', keywords: 'collapse tree folders 全部折叠', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.fileTreeRef.value?.collapseAll() },
    { id: 'view.expandAll', title: '全部展开项目树', keywords: 'expand tree folders 全部展开', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.fileTreeRef.value?.expandAll() },
    { id: 'view.rule2', rule: true },
    // ViewMenu › ViewAppearanceGroup —— IDEA 里是**子菜单**（`<group id="ViewAppearanceGroup" popup="true">`，
    // PlatformActions.xml:523-546）。它内部还有两个**不带 popup 的内联组**：`ToggleFullScreenGroup`
    // （TogglePresentationMode / ToggleDistractionFreeMode / ToggleFullScreen / ToggleZenMode /
    // ToggleCompactMode）与 `UIToggleActions`（主菜单模式、工具栏、状态栏…）。
    // TaoCode 有真实落点的是：演示模式（TogglePresentationMode）、Zen Mode（ToggleZenMode）、
    // 紧凑模式（ToggleCompactMode → editorSettings.compactMode）。内联组用分隔线表达同一层。
    { id: 'view.appearanceGroup', title: '外观', keywords: 'appearance presentation zen compact 外观 演示 禅模式 紧凑', children: [
      { id: 'view.presentation', title: '演示模式', keywords: 'presentation mode 演示 投屏', checked: () => ctx.editorSettings.value.presentationMode, run: () => void ctx.saveSettingsPatch({ presentationMode: !ctx.editorSettings.value.presentationMode }) },
      // IDEA 的 **专注模式**（ToggleDistractionFreeMode）：把一批编辑器/UI 设置批量换成专注值，
      // 退出时恢复用户进之前的值（双向 before/after，见 src/distractionFreeMode.ts）。
      { id: 'view.distractionFree', title: () => (ctx.distractionFreeMode.value ? '退出专注模式' : '进入专注模式'), keywords: 'distraction free mode focus 专注 免打扰 沉浸', checked: () => ctx.distractionFreeMode.value, run: () => void ctx.toggleDistractionFreeMode() },
      // IDEA 的 ToggleFullScreenGroup 顺序（PlatformActions.xml:524-528）是：
      // TogglePresentationMode → ToggleDistractionFreeMode → ToggleFullScreen → ToggleZenMode。
      // 本批先补**完全缺失的全屏**；专注模式与 Zen 目前还被合并在 zenMode 里（见 class-parity-todo 的第 1 项）。
      { id: 'view.fullScreen', title: () => `${ctx.fullScreen.value ? '退出全屏' : '进入全屏'}`, keywords: 'full screen toggle 全屏 最大化 无边框', checked: () => ctx.fullScreen.value, run: () => void ctx.toggleFullScreen() },
      // IDEA 的 Zen = **专注模式 + 全屏**（`ToggleZenModeAction.kt:64-80` 幂等地把两者设成同一个 state），
      // 不是"再叠一层隐藏"。所以它的关键词不再包含 distraction free（那是上面那个独立开关）。
      { id: 'view.zenMode', title: () => `${ctx.zenMode.value ? '退出' : '进入'} Zen Mode`, keywords: 'zen fullscreen immersive 禅模式 一切隐藏', checked: () => ctx.zenMode.value, run: () => ctx.toggleZenMode() },
      { id: 'view.compactMode', title: '紧凑模式', keywords: 'compact mode density 紧凑 密度', checked: () => ctx.editorSettings.value.compactMode, run: () => void ctx.saveSettingsPatch({ compactMode: !ctx.editorSettings.value.compactMode }) },
      { id: 'view.ruleAppearance', rule: true },
      // 分隔线下面是 IDEA 的第二个内联组 `UIToggleActions`（PlatformActions.xml:536-546）。
      // 本仓有真实消费者的两条：`ViewStatusBar`（`ViewStatusBarAction.java`：勾选态 =
      // `UISettings.showStatusBar`，消费者是状态栏 footer）与 `ViewToolButtons`（显示/隐藏
      // 工具窗口条，落点 `editorSettings.showToolWindowBars`，消费方 `src/toolWindowStripes.ts`）。
      { id: 'view.statusBar', title: '状态栏', keywords: 'status bar toggle hide show 状态栏', checked: () => ctx.editorSettings.value.showStatusBar, run: () => void ctx.saveSettingsPatch({ showStatusBar: !ctx.editorSettings.value.showStatusBar }) },
      { id: 'view.toolButtons', title: '工具窗口条', keywords: 'tool window bars buttons stripe 工具窗口条 侧栏按钮', checked: () => ctx.editorSettings.value.showToolWindowBars, run: () => void ctx.saveSettingsPatch({ showToolWindowBars: !ctx.editorSettings.value.showToolWindowBars }) },
      // IDEA 的 ToggleFullScreenGroup 里还有 ToggleDistractionFreeMode 与 ToggleFullScreen：
      // 前者与 ToggleZenMode 在 TaoCode 里是同一件事（Zen 就是免打扰），不重复放两行；
      // 后者要先给宿主加全屏通道（Win32 窗口态 / Fullscreen API），本轮不做，登记在审计文档里。
      { id: 'view.background', title: '设置背景图像…', keywords: 'background image 背景图', enabled: () => ctx.isDesktop, run: () => void ctx.chooseBackgroundImage() },
    ] },
    { id: 'view.powerSave', title: '省电模式', keywords: 'power save mode 省电 节能', checked: () => ctx.editorSettings.value.powerSaveMode, run: () => void ctx.togglePowerSave() },
    // ViewMenu › EditorToggleActions —— IDEA 里是**子菜单**（`<group id="EditorToggleActions"
    // popup="true">`，PlatformActions.xml:572-586）。子项顺序照源码：UseSoftWraps · (分隔) ·
    // ShowWhitespaces · ShowLineNumbers · ShowGutterIcons · ShowIndentLines · (分隔) ·
    // IncreaseFontSize · DecreaseFontSize。这些都是 ToggleAction，落点是同一份编辑器设置
    // （与 编辑器 › 常规 › 外观 页共用状态，改一处两边都变）。
    // `EditorToggleShowGutterIcons` = **已落地**（不再是待办）：`showGutterIcons` 的消费方是
    // `src/gutterIconHost.ts`（IDEA `areGutterIconsShown()` 的对应物），图标层的三个生产者是
    // LSP 诊断 / DAP 断点 / 书签（见 tests/gutter-icons.test.mjs）。仍待办的是 gutter 图标上的
    // 右键弹层与部分对齐档，登记在 docs/class-parity-todo.md §9 #2。
    { id: 'view.editorToggleActions', title: '编辑器开关', keywords: 'editor toggle soft wrap whitespaces line numbers indent guides font size 编辑器开关 软换行 空白 行号 缩进 字号', children: [
      { id: 'view.toggleSoftWraps', title: '软换行', keywords: 'soft wrap word wrap 软换行 自动换行', checked: () => ctx.editorSettings.value.wordWrap, run: () => void ctx.saveSettingsPatch({ wordWrap: !ctx.editorSettings.value.wordWrap }) },
      { id: 'view.ruleEditorToggles1', rule: true },
      { id: 'view.toggleWhitespaces', title: '显示空白符号', keywords: 'show whitespaces 空白符号', checked: () => ctx.editorSettings.value.showWhitespaces, run: () => void ctx.saveSettingsPatch({ showWhitespaces: !ctx.editorSettings.value.showWhitespaces }) },
      { id: 'view.toggleLineNumbers', title: '显示行号', keywords: 'show line numbers 行号', checked: () => ctx.editorSettings.value.lineNumbers, run: () => void ctx.saveSettingsPatch({ lineNumbers: !ctx.editorSettings.value.lineNumbers }) },
      // `EditorToggleShowGutterIcons`（`intellij.platform.ide.impl.actions.xml:415` = `ToggleShowGutterIconsAction`，
      // 菜单位置 `PlatformActions.xml:577`：紧跟 ShowLineNumbers 之后）。默认开
      // （`EditorSettingsExternalizable.java:87`）。关掉后 gutter 不再画行内图标（诊断/断点/书签标记仍在数据里）。
      { id: 'view.toggleGutterIcons', title: '显示装订线图标', keywords: 'show gutter icons line markers 装订线 图标 行标记', checked: () => ctx.editorSettings.value.showGutterIcons, run: () => void ctx.saveSettingsPatch({ showGutterIcons: !ctx.editorSettings.value.showGutterIcons }) },
      { id: 'view.toggleIndentGuides', title: '显示缩进参考线', keywords: 'show indent guides 缩进参考线', checked: () => ctx.editorSettings.value.showIndentGuides, run: () => void ctx.saveSettingsPatch({ showIndentGuides: !ctx.editorSettings.value.showIndentGuides }) },
      { id: 'view.ruleEditorToggles2', rule: true },
      // 字号动作：步长 1，上下限与设置页同源。上游 `ChangeEditorFontSizeAction.java:48` 只在
      // **目标值**落在 `[8, getMaxEditorFontSize()]` 时才应用；上限 = `ide.editor.max.font.size`
      // （`EditorFontsConstants.java:16`，默认 **40**）。规则在 `src/editorFontSize.ts`。
      { id: 'view.increaseEditorFont', title: '增大编辑器字号', keywords: 'increase editor font size bigger 增大 字号', enabled: () => stepEditorFontSize(ctx.editorSettings.value.fontSize, 1) !== null, run: () => { const next = stepEditorFontSize(ctx.editorSettings.value.fontSize, 1); if (next !== null) void ctx.saveSettingsPatch({ fontSize: next }) } },
      { id: 'view.decreaseEditorFont', title: '减小编辑器字号', keywords: 'decrease editor font size smaller 减小 字号', enabled: () => stepEditorFontSize(ctx.editorSettings.value.fontSize, -1) !== null, run: () => { const next = stepEditorFontSize(ctx.editorSettings.value.fontSize, -1); if (next !== null) void ctx.saveSettingsPatch({ fontSize: next }) } },
    ] },
    // ViewMenu **直接层**的 `EditorResetFontSizeGlobal`（PlatformActions.xml:586，在 EditorToggleActions
    // 组之后、ToggleFocusMode 之前）。同一层还有 `EditorIncreaseFontSizeGlobal` / `DecreaseGlobal`
    // （:584-585）—— 那两条**不重复放**：IDEA 有"当前编辑器的临时字号"（`EditorIncreaseFontSize`）
    // 与"全局字号"（`...Global`）两套，TaoCode 只有一套（`editorSettings.fontSize`），
    // 所以上面组里那两行已经是全局语义，再放一遍就是同一个动作出现两次。
    { id: 'view.resetEditorFont', title: '重置编辑器字号', keywords: 'reset editor font size default 重置 字号 默认', enabled: () => ctx.editorSettings.value.fontSize !== defaultEditorSettings.fontSize, run: () => void ctx.saveSettingsPatch({ fontSize: defaultEditorSettings.fontSize }) },
    // ViewMenu 末尾的「文本方向」子菜单（`<group id="EditorBidiTextDirection" popup="true">`，
    // PlatformActions.xml:591-595；位置在 ToggleFocusMode 之后、菜单收尾）。三项是 ToggleAction，
    // `isSelected` = 设置值等于本档 ⇒ 三选一互斥（SetEditorBidiTextDirectionAction.java:20-32）。
    // 该设置在 IDEA 里**没有设置页行**，只由这个子菜单读写（`grep BIDI_TEXT_DIRECTION` 只命中
    // EditorSettingsExternalizable 与三个动作），所以 TaoCode 也不造设置页行。
    // 改档位后 IDEA 会 `EditorFactory.refreshAllEditors()`；TaoCode 等价物 = 写设置后重挂编辑器（bufferEpoch）。
    { id: 'view.bidiTextDirection', title: '文本方向', keywords: 'bidi text direction rtl ltr content based 文本方向 双向 阿拉伯 希伯来', children: BIDI_DIRECTIONS.map(direction => ({
      id: bidiDirectionActionId(direction), title: bidiDirectionLabel(direction),
      checked: () => ctx.editorSettings.value.bidiTextDirection === direction,
      run: () => void ctx.saveSettingsPatch({ bidiTextDirection: direction }),
    })) },
    { id: 'ctx.theme.light', title: '亮色主题', keywords: 'light ctx.theme bright 亮色', checked: () => ctx.theme.value === 'light', run: () => ctx.changeTheme('light') },
    { id: 'ctx.theme.dark', title: '暗色主题', keywords: 'dark ctx.theme 暗色', checked: () => ctx.theme.value === 'dark', run: () => ctx.changeTheme('dark') },
  ]
  return rows
}
