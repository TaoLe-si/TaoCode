// 导航菜单（IDEA NavigateMenu 的 TaoCode 对应物）。一组一文件（桃 2026-09-26：模块化）。
// 成员先用 any（参数逆变 + 内部类型未提取），随批次收紧。
import type { MenuRow } from './types'
// 「按类型过滤」= 上游 goto-by-name 弹层右上角那条过滤条（`ChooseByNameFilter.java:74-117`）。
// 菜单是它在本仓的**生产入口**（本仓的符号弹层不是 Swing 弹层，没有 tool area 可挂），
// 规则与排除态在 `src/navChooseByNameFilter.ts`，生效的地方是
// `src/lspNavigation.ts` 的 `fileSymbolEntries` / `globalSymbolEntries`。
import { filterActionActive, hiddenAfterAll, hiddenAfterNone, hiddenSymbolGroups, invertHidden,
         isDegenerateHidden, symbolFilterRows, toggleHiddenGroup } from '../navChooseByNameFilter.ts'
// 菜单标题的「测试 / 被测对象」两档要用规则层的方向判定（同一份规则，不在菜单里另写一遍）。
import { gotoTestActionLabel, gotoTestDirection } from '../navGotoTest.ts'
// 「相关符号…」的菜单文案取规则层的那一份常量（上游 `ActionsBundle.properties:712-713`），
// 不在菜单里另写一遍标题。
import { GOTO_RELATED_ACTION_LABEL } from '../navGotoRelated.ts'

/** 过滤条的标题：没排除任何类别时是灭的（上游 `isActive()`，`ChooseByNameFilter.java:80-85`）。 */
export function gotoFilterTitle(): string {
  if (!filterActionActive(hiddenSymbolGroups.value)) return '按类型过滤'
  if (isDegenerateHidden(hiddenSymbolGroups.value)) return '按类型过滤（已排除全部类别）'
  const hidden = symbolFilterRows().filter(row => !row.visible).map(row => row.label)
  return `按类型过滤（已排除 ${hidden.join('、')}）`
}

export interface NavigateContext {
  active: any
  cycleBookmark: any
  cycleBookmarkInEditor: any
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
  bookmarkMnemonicLabel: () => string
  openPalette: any
  openRecentFiles: any
  openRecentPlaces: any
  openSymbol: any
  runEditor: any
  /** IDEA 的 `SelectIn`（Alt+F1）：打开目标列表弹窗。 */
  openSelectIn: any
  /**
   * Ctrl+U `GotoSuperMethod`（`$default.xml:251-253`）—— 动作本体是 `src/lspNavigation.ts`
   * 新返回的 `gotoSuper`（规则层 `src/navGotoSuper.ts`）。**可选**：宿主（冻结的 `src/App.vue`）
   * 还没把它并进 ctx 时这一行不渲染，见上面那段的注释与桶 4b 的接线请求。
   */
  gotoSuper?: () => unknown
  /** 上游 `GotoSuperAction.update`（`JavaGotoSuperHandler` 的标题两档）需要宿主给光标下的档位。 */
  gotoSuperLabel?: string
  /** Ctrl+Shift+T `GotoTest`（`$default.xml:254-256`）—— 同上，本体是 `createLspNavigation` 的 `gotoTest`。 */
  gotoTest?: () => unknown
  /** Ctrl+Alt+Home `GotoRelated`（`$default.xml:257-259`）—— 本体是 `createLspNavigation` 的 `gotoRelated`。 */
  gotoRelated?: () => unknown
  /** IDEA 的 `ShowNavBar`（Alt+HOME）。 */
  showNavBar: any
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
    // 「按类型过滤」子菜单（上游那条过滤条的两半：多选清单 + All/None/Invert 三钮，
    // `ChooseByNameFilter.java:101-117`；按钮文案 `LangBundle.properties:372-374` 的 All/None/Invert）。
    // 勾选直接改 `hiddenSymbolGroups`，`src/lspNavigation.ts` 里那条 watch 当场重算列表；
    // 排除态由那份模块写进 localStorage（上游写 `filter.xml`，`ChooseByNameFilterConfiguration`）。
    // 「转到类」的口径不受影响 —— 上游 `LspGoToClassContributor.kt:7-12` 的四类过滤在合并层
    // （`src/lspSymbolBridge.ts`），这一档过滤的是弹层**展示**的类别。
    { id: 'navigate.filterByType', title: gotoFilterTitle, keywords: 'filter symbol kind class method field 过滤 类型 类别', childrenOf: () => [
      ...symbolFilterRows().map(row => ({
        id: `navigate.filter.${row.id}`,
        title: row.label,
        checked: () => !hiddenSymbolGroups.value.includes(row.id),
        run: () => { hiddenSymbolGroups.value = toggleHiddenGroup(hiddenSymbolGroups.value, row.id) },
      })),
      { id: 'navigate.filter.rule', rule: true },
      { id: 'navigate.filter.all', title: '全部', keywords: 'all 全部 都显示', run: () => { hiddenSymbolGroups.value = hiddenAfterAll() } },
      { id: 'navigate.filter.none', title: '无', keywords: 'none 全不选 都排除', run: () => { hiddenSymbolGroups.value = hiddenAfterNone() } },
      { id: 'navigate.filter.invert', title: '反选', keywords: 'invert 反选 互换', run: () => { hiddenSymbolGroups.value = invertHidden(hiddenSymbolGroups.value) } },
    ] },
    // IDEA GoToMenu › `NavigateInFileGroup`（`PlatformActions.xml:620-629`）——
    // 上游是 `<group id="NavigateInFileGroup" popup="true">`，标题取
    // `ActionsBundle.properties:1992` `group.NavigateInFileGroup.text=Navigate in File`。
    // 成员：`MethodDown`(:621) / `MethodUp`(:622) / `<separator/>`(:623) /
    //       `TemplateParametersNavigation`(:624-627) / `GotoCustomRegion`(:628)。
    // 本仓接得住的只有前两条，后三条（模板参数导航 / GotoCustomRegion）需要 LSP 的
    // 签名与折叠区能力，仍 `[ ]`（`docs/class-parity-todo.md` §9 第 9 项），按
    // 「不放假控件」不放。两条 ≥ 已收拢的各组（最少的 `ResizeToolWindowGroup` 是四条），
    // 与两个有意例外（`BackgroundTasks` 单项、`HelpDiagnosticTools` 父菜单不存在）都不同。
    // **子菜单内不画分隔线**：上游那一条隔的是后三簇，本仓都没有落点。
    // **没有 keys**：IDEA 的 `$MethodDown`/`$MethodUp` 本身就没有默认快捷键
    // （在 `platform/platform-resources/src/keymaps/$default.xml` 里搜不到），
    // 只有菜单项。原先写 `Alt Down`/`Alt Up` 属于自造，已去掉。
    { id: 'navigate.inFile', title: '在文件中导航', keywords: 'navigate in file next previous method 方法 跳转', children: [
      { id: 'navigate.methodDown', title: '下一个方法', keywords: 'next method down 下一个方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.jumpMethod(1) },
      { id: 'navigate.methodUp', title: '上一个方法', keywords: 'previous method up 上一个方法', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.jumpMethod(-1) },
    ] },
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
    // IDEA 的 GoToCodeGroup **开头**两项（actionGroupStructure.txt:2243-2247：`<sep>` → SelectIn →
    // ShowNavBar → `<sep>` → GotoDeclaration…）。标题按 ActionsBundle.properties:524
    // `action.SelectIn.text=Se_lect In…`（带助记符的那条），ShowNavBar 的键是 $default.xml:14-15 的 Alt HOME。
    { id: 'navigate.ruleBefore', rule: true },
    { id: 'navigate.selectIn', title: '在…中选择…', keys: 'Alt F1', keywords: 'select in project view structure commit explorer 定位 选择位置', enabled: () => Boolean(ctx.active.value), run: ctx.openSelectIn },
    { id: 'navigate.showNavBar', title: '显示导航栏', keys: 'Alt Home', keywords: 'show nav bar breadcrumb 导航栏 面包屑', enabled: () => Boolean(ctx.active.value), run: ctx.showNavBar },
    { id: 'navigate.rule0', rule: true },
    { id: 'navigate.declaration', title: '转到声明/定义', keys: 'Ctrl B', keywords: 'go to declaration definition 转到声明', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('definition') },
    // IDEA Navigate: 类型声明 (GotoTypeDeclaration, Ctrl+Shift+B).
    // $default.xml:162-164 `QuickImplementations` = control shift I（IDEA 的「快速定义」）——
    // 在原地看一眼定义（库类型走 hover 的全限定名 + 工程里的 *-sources.jar）。
    { id: 'navigate.quickDefinition', title: '快速定义', keys: 'Ctrl Shift I', keywords: 'quick definition quick implementations 快速定义', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('quickDefinition') },
    { id: 'navigate.typeDeclaration', title: '转到类型声明', keys: 'Ctrl Shift B', keywords: 'goto type declaration 类型声明', enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => ctx.runEditor('typeDeclaration') },
    // 上游 `GoToCodeGroup` 在 `GotoTypeDeclaration` 之后紧接 `GotoSuperMethod`、`GotoTest`
    // （`platform/platform-impl/resources/idea/LangActions.xml:194-195`；展平顺序
    // `tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2251-2252`）。
    // 键位是 `platform/platform-resources/src/keymaps/$default.xml:251-253`（Ctrl+U）与
    // `:254-256`（Ctrl+Shift+T）。
    // **只有宿主真的把动作传进来才渲染这两行**：`src/App.vue` 是冻结文件，还没把
    // `createLspNavigation` 新返回的 `gotoSuper`/`gotoTest` 并进 `navigateMenuContext`
    // ⇒ 现在这里不出现菜单项（不放一个点不动的假控件）；接线请求见
    // `docs/wiring-requests-2026-10-06-bucket4b.md`。
    ...(ctx.gotoSuper ? [{
      id: 'navigate.super', title: ctx.gotoSuperLabel ?? '转到父方法 / 父类或接口', keys: 'Ctrl U',
      keywords: 'goto super method class interface parent 父方法 父类 接口 上溯',
      enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value, run: () => void ctx.gotoSuper?.(),
    } satisfies MenuRow] : []),
    ...(ctx.gotoTest ? [{
      // 标题两档（`ActionsBundle.properties:701`/`:705`：Go to Test / Go to Test Subject）：
      // 当前文件是测试就找被测对象，否则找测试 —— 方向判定复用规则层 `gotoTestDirection`。
      id: 'navigate.test', title: () => gotoTestActionLabel(gotoTestDirection(String(ctx.active.value?.path ?? ''))),
      keys: 'Ctrl Shift T', keywords: 'goto test subject implementation 测试 被测对象',
      enabled: () => Boolean(ctx.active.value) && Boolean(ctx.workspace.value), run: () => void ctx.gotoTest?.(),
    } satisfies MenuRow] : []),
    // 同一条 `GoToCodeGroup` 里紧跟其后的 `GotoRelated`（`LangActions.xml:196` /
    // `actionGroupStructure.txt:2253`），键位 Ctrl+Alt+Home（`$default.xml:257-259`）。
    // 出现条件与上面两条一样：宿主把 `createLspNavigation` 的 `gotoRelated` 并进 ctx 才有这一行。
    ...(ctx.gotoRelated ? [{
      id: 'navigate.related', title: GOTO_RELATED_ACTION_LABEL, keys: 'Ctrl Alt Home',
      keywords: 'goto related symbol test subject header source 相关符号 相关',
      enabled: () => Boolean(ctx.active.value) && Boolean(ctx.workspace.value), run: () => void ctx.gotoRelated?.(),
    } satisfies MenuRow] : []),
    { id: 'navigate.rule1', rule: true },
    // IDEA's "Jump to Line/Character" (Ctrl+L) opens the same line prompt as Go to
    // Line:Column. Select Changed Text has no keymap entry in \$default.xml, so only
    // the jump row appears here.
    { id: 'navigate.rule2', rule: true },
    { id: 'navigate.bookmark', title: '切换书签', keys: 'F11', keywords: 'bookmark toggle 书签', enabled: ctx.hasEditor, run: () => ctx.toggleBookmark() },
    // 标题随状态变：没有书签=添加助记书签… / 有书签没助记键=指定助记符… / 有助记键=更改助记符…
    // （上游 `ChooseBookmarkTypeAction.update:33-41`；文案取中文包的 BookmarkBundle。）
    { id: 'navigate.bookmarkMnemonic', title: () => ctx.bookmarkMnemonicLabel(), keys: 'Ctrl F11', keywords: 'bookmark mnemonic digit 书签编号', enabled: ctx.hasEditor, run: ctx.openMnemonicPrompt },
    { id: 'navigate.bookmarkNext', title: '下一个书签', keywords: 'next bookmark project wide 下一个书签', run: () => ctx.cycleBookmark(false) },
    { id: 'navigate.bookmarkPrevious', title: '上一个书签', keywords: 'previous bookmark project wide 上一个书签', run: () => ctx.cycleBookmark(true) },
    // 上游 GotoNext/PreviousBookmarkInEditor（intellij.platform.bookmarks.xml:74-79）：只在这个文件里走、默认不回绕。
    { id: 'navigate.bookmarkNextInEditor', title: '编辑器内下一个行书签', keywords: 'next bookmark in editor line 编辑器内下一个书签', enabled: ctx.hasEditor, run: () => ctx.cycleBookmarkInEditor(false) },
    { id: 'navigate.bookmarkPreviousInEditor', title: '编辑器内上一个行书签', keywords: 'previous bookmark in editor line 编辑器内上一个书签', enabled: ctx.hasEditor, run: () => ctx.cycleBookmarkInEditor(true) },
    { id: 'view.bookmarks', title: '书签窗口', keys: 'Shift F11', keywords: 'bookmarks tool window list 书签窗口', enabled: () => Boolean(ctx.workspace.value), run: () => ctx.showView('bookmarks') },
  ]
  return rows
}
