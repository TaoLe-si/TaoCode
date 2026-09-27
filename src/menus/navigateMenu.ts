// 导航菜单（IDEA NavigateMenu 的 TaoCode 对应物）。一组一文件（桃 2026-09-26：模块化）。
// 成员先用 any（参数逆变 + 内部类型未提取），随批次收紧。
import type { MenuRow } from './types'

export interface NavigateContext {
  active: any
  cycleBookmark: any
  goBack: any
  goForward: any
  hasEditor: any
  jumpLastEditLocation: any
  jumpMethod: any
  lspReady: any
  navBack: any
  navForward: any
  openActionSearch: any
  openSearchEverywhere: any
  openGoLine: any
  openMnemonicPrompt: any
  openPalette: any
  openRecentFiles: any
  openRecentPlaces: any
  openSymbol: any
  runEditor: any
  selectInTree: any
  showView: any
  toggleBookmark: any
  workspace: any
}

export function createNavigateMenuRows(ctx: NavigateContext): MenuRow[] {
  const rows: MenuRow[] = [
    // GoToMenu opens with Back/Forward (PlatformActions.xml:600-604).
    { id: 'navigate.back', title: '上一步', keys: 'Ctrl Alt ←', keywords: 'back navigate history 后退', enabled: () => Boolean(ctx.navBack.value.length), run: () => void ctx.goBack() },
    { id: 'navigate.forward', title: '下一步', keys: 'Ctrl Alt →', keywords: 'forward navigate history 前进', enabled: () => Boolean(ctx.navForward.value.length), run: () => void ctx.goForward() },
    { id: 'navigate.rule0', rule: true },
    { id: 'navigate.actions', title: '查找操作…', keys: 'Ctrl Shift A', keywords: 'find action commands shortcuts keymap all actions 查找操作 命令', run: ctx.openActionSearch },
    { id: 'navigate.file', title: '转到文件…', keys: 'Ctrl Shift N', keywords: 'goto file search everywhere 转到文件', enabled: () => Boolean(ctx.workspace.value), run: ctx.openPalette },
    // IDEA's default keymap: Go to Class = Ctrl+N, Go to Symbol = Ctrl+Shift+Alt+N.
    { id: 'navigate.class', title: '转到类…', keys: 'Ctrl N', keywords: 'goto class type 转到类', enabled: () => Boolean(ctx.workspace.value) && ctx.lspReady.value, run: () => ctx.openSymbol('class') },
    { id: 'navigate.symbol', title: '转到符号…', keys: 'Ctrl Shift Alt N', keywords: 'goto symbol global 转到符号', enabled: () => Boolean(ctx.workspace.value) && ctx.lspReady.value, run: () => ctx.openSymbol('global') },
    { id: 'navigate.fileSymbol', title: '转到当前文件符号', keys: 'Ctrl F12', keywords: 'symbol outline structure file 文件符号', enabled: () => Boolean(ctx.workspace.value) && ctx.lspReady.value, run: () => ctx.openSymbol('file') },
    // GoToMenu › NavigateInFileGroup 的 MethodDown / MethodUp（`PlatformActions.xml:621-623`）。
    // **没有 keys**：IDEA 的 `$MethodDown`/`$MethodUp` 本身就没有默认快捷键
    // （`grep -rn 'actionId="$MethodDown"' --include=*.xml` 零命中），只有菜单项。
    // 早先这里写了 `Alt Down`/`Alt Up` 属于自造 —— 那会让用户以为是 IDEA 的键位。
    { id: 'navigate.methodDown', title: '下一个方法', keywords: 'next method down 下一个方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.jumpMethod(1) },
    { id: 'navigate.methodUp', title: '上一个方法', keywords: 'previous method up 上一个方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.jumpMethod(-1) },
    { id: 'navigate.line', title: '转到行/列…', keys: 'Ctrl G', keywords: 'goto line number 转到行', enabled: ctx.hasEditor, run: () => ctx.openGoLine() },
    // IDEA's Navigate menu puts `<group id="GoToErrorGroup">` between Go to Line and Jump to
    // Last Change (PlatformActions.xml:609-617), with F2 / Shift+F2 ($default.xml:658-660,
    // :679-681) and the ActionsBundle.properties:708-711 titles. Like every IDEA editor
    // action in that family it needs a file whose highlighting is available
    // (BaseGotoNextErrorAction.isValidForFile:52-54) — here, a live language server.
    { id: 'navigate.nextError', title: '下一个高亮错误', keys: 'F2', keywords: 'next highlighted error next error problem 下一个错误 下一个问题', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('error.next') },
    { id: 'navigate.previousError', title: '上一个高亮错误', keys: 'Shift F2', keywords: 'previous highlighted error previous error problem 上一个错误 上一个问题', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('error.previous') },
    { id: 'navigate.lastEdit', title: '回到上次编辑位置', keys: 'Ctrl Shift Bksp', keywords: 'last edit location navigation 上次编辑', enabled: ctx.hasEditor, run: ctx.jumpLastEditLocation },
    { id: 'navigate.recent', title: '最近文件', keys: 'Ctrl E', keywords: 'recent files switcher history 最近文件', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.openRecentFiles() },
    // IDEA's RecentLocations is Ctrl+Shift+E in $default.xml; inside the popup the
    // same Ctrl+E toggles "Show edited only" (SwitcherRecentEditedChangedToggleCheckBox).
    { id: 'navigate.places', title: '最近位置', keys: 'Ctrl Shift E', keywords: 'recent places locations 最近位置', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.openRecentPlaces() },
    // IDEA Navigate menu (real 2026.2 UI): 随处搜索 (Shift+Shift) opens Search
    // Everywhere. 改造前这里调的是 `openActionSearch` —— 打开的是「查找操作」面板，
    // 与 GoToMenu 里的 `SearchEverywhere`（PlatformActions.xml:604）不是一回事。
    { id: 'navigate.everywhere', title: '随处搜索', keys: 'Shift Shift', keywords: 'search everywhere 随处搜索 搜索', run: () => ctx.openSearchEverywhere() },
    { id: 'navigate.declaration', title: '转到声明/定义', keys: 'Ctrl B', keywords: 'go to declaration definition 转到声明', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('definition') },
    // IDEA Navigate: 类型声明 (GotoTypeDeclaration, Ctrl+Shift+B).
    { id: 'navigate.typeDeclaration', title: '转到类型声明', keys: 'Ctrl Shift B', keywords: 'goto type declaration 类型声明', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('typeDeclaration') },
    { id: 'navigate.rule1', rule: true },
    // IDEA's "Jump to Line/Character" (Ctrl+L) opens the same line prompt as Go to
    // Line:Column. Select Changed Text has no keymap entry in \$default.xml, so only
    // the jump row appears here.
    { id: 'navigate.rule2', rule: true },
    { id: 'navigate.bookmark', title: '切换书签', keys: 'F11', keywords: 'bookmark toggle 书签', enabled: ctx.hasEditor, run: () => ctx.toggleBookmark() },
    { id: 'navigate.bookmarkMnemonic', title: '为书签编号…', keys: 'Ctrl F11', keywords: 'bookmark mnemonic digit 书签编号', enabled: ctx.hasEditor, run: ctx.openMnemonicPrompt },
    { id: 'navigate.bookmarkNext', title: '下一个书签', keywords: 'next bookmark project wide 下一个书签', run: () => ctx.cycleBookmark(false) },
    { id: 'navigate.bookmarkPrevious', title: '上一个书签', keywords: 'previous bookmark project wide 上一个书签', run: () => ctx.cycleBookmark(true) },
    { id: 'navigate.selectInProject', title: '在项目中选中', keys: 'Alt F1 1', keywords: 'select in project view tree reveal 在项目中选中 定位文件', enabled: () => Boolean(ctx.active.value), run: ctx.selectInTree },
    { id: 'view.bookmarks', title: '书签窗口', keys: 'Shift F11', keywords: 'bookmarks tool window list 书签窗口', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showView('bookmarks') },
  ]
  return rows
}
