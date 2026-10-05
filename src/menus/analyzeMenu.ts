// 检查/分析这一族 —— IDEA 的 `AnalyzeMenu` 与 `InspectCodeInCodeMenuGroup`。
// 一组一文件（桃 2026-09-26：模块化）；依赖经 ctx 注入。
//
// **它不是主菜单的一档**。IDEA master 解析后的主菜单只有 12 个顶层组
// （`tests/main/testData/actionSystem/groupStructure/actionGroupStructure.txt:2444-2456`：
// File / Edit / View / GoTo / Code / Refactoring / Build / Run / Tools / VcsGroups / Window / Help，
// **没有 Analyze**）。`AnalyzeMenu` 本身是一个 `popup="true"` 的**上下文菜单组**：
//   · `java/java-backend/resources/META-INF/JavaActions.xml:61-66` 把它挂到
//     `ProjectViewPopupMenu` 与 `NavbarPopupMenu`（锚在 `ReplaceInPath` 之后）；
//   · `:120-124` 的 `EditorPopupMenuAnalyze` 再把它挂到编辑器右键菜单（`EditorPopupMenu1`，锚在 `FindUsages` 之后）；
//   · 成员 = `InspectCodeGroup` + 分隔线 + `AnalyzeActions`。
// 而**主菜单里**的检查入口住在代码菜单：`platform/platform-impl/resources/idea/LangActions.xml:238-259`
// 的 `InspectCodeInCodeMenuGroup`（位置在 `CodeCompletionGroup` 之后），内容是
// `InspectCodeGroup{InspectCode, CodeCleanup}` + `AnalyzeActionsPopup{AnalyzeActions{…RunInspection…}}`
// + `AnalyzePlatformMenu{Unscramble}`。
//
// 文案取自上游资源：
//   · `group.AnalyzeMenu.text=Analy_ze`（ActionsBundle.properties:794）
//   · `action.InspectCode.text=_Inspect Code…`（:799）、`action.CodeCleanup.text=_Code Cleanup…`（:795）
//   · `group.AnalyzeActionsPopup.text=Analyze Code`（:1765）
//   · RunInspection 的显示名 = `&Run Inspection by Name…`（IdeBundle.properties:1041 `goto.inspection.action.text`），
//     快捷键 Ctrl+Shift+Alt+I 见 `platform/platform-resources/src/keymaps/$default.xml:276-278`；
//     `InspectCode` 在该 keymap 里**没有**默认快捷键，所以那一条不写 keys。
//
// 没有对应实现的上游条目一律**不放**（不放假控件）：CodeCleanup、SilentCodeCleanup、PopupHector、
// ViewOfflineInspection、SliceBackward/Forward、Unscramble —— 已登记在 docs/class-parity-todo.md。
import type { MenuRow } from './types'
// 检查配置档（上游 `InspectionProfileManager.setRootProfile` 的选择面，见 src/inspectionProfile.ts：
// 逐检查器启用/级别覆盖那份配置的模型；`InspectionProfileSchemesModel.getSortedProfiles:196-200` 给出清单顺序）。
// 状态栏那个切换器（`InspectionProfileWidgetFactory`，`platform/lang-impl/.../InspectionProfileWidgetFactory.java:12-17`）
// 本仓不建（那是 StatusBarWidget 宿主），切换面落在这里的子菜单 —— 同 `setRootProfile` 的用户可见行为。
import { currentProfileName, profileNames, selectProfile } from '../inspectionProfile.ts'

export interface AnalyzeGroupContext {
  active: any
  lspReady: any
  workspace: any
  caretPayload: (arg?: any) => any
  openCodeActions: (arg?: any, flag?: any) => any
  runWorkspaceInspection: () => any
  /** 打开「包依赖分析」（上游 Analyze 菜单里的 `AnalyzeDependencies`，Java 侧的功能）。 */
  openPackageDeps?: () => void
}

/** `InspectCodeGroup` 里本仓真能跑的那一条：整工程检查（`workspace/diagnostic`）。 */
export function inspectCodeRow(ctx: AnalyzeGroupContext): MenuRow {
  return {
    id: 'analyze.inspectCode', title: '检查代码…',
    keywords: 'inspect code whole project workspace diagnostic 检查 整工程',
    enabled: () => Boolean(ctx.workspace.value) && ctx.lspReady.value,
    run: () => void ctx.runWorkspaceInspection(),
  }
}

/**
 * 检查配置档的切换面：一份 profile 一行，当前档带勾选（上游 `setRootProfile` 的用户可见面）。
 * `childrenOf` 是动态的 —— 复制/改名/导入之后档数会变，菜单每次打开都重新读清单
 * （与 `MenuRow.childrenOf` 的用法一致，不拍平成静态行表）。
 */
export function profileRows(): MenuRow[] {
  return profileNames().map(name => ({
    id: `analyze.profile.${name}`,
    title: name,
    keywords: `inspection profile 配置档 ${name}`,
    checked: () => currentProfileName() === name,
    run: () => void selectProfile(name),
  }))
}

/** `AnalyzeActions` 里本仓真能跑的那一条：按名称运行单条检查（服务器的 intent 代码操作）。 */
export function runInspectionRow(ctx: AnalyzeGroupContext): MenuRow {
  return {
    id: 'analyze.runInspection', title: '按名称运行检查…', keys: 'Ctrl Shift Alt I',
    keywords: 'run inspection by name single intent analysis 运行检查 按名称',
    enabled: () => Boolean(ctx.active.value) && ctx.lspReady.value,
    run: () => void ctx.openCodeActions(ctx.caretPayload(), true),
  }
}

/**
 * 「分析依赖」（上游 Java 的 `AnalyzeDependencies`：在 PSI 引用图上建包图、找循环）。
 * 本仓的落点是 src/packageDeps.ts 的文本子集 + PackageDepsDialog —— 目录级依赖图与循环，
 * 不做 PSI 引用、不做「忽略依赖」的设置面。
 */
export function packageDepsRow(ctx: AnalyzeGroupContext): MenuRow {
  return {
    id: 'analyze.packageDeps', title: '分析依赖…',
    keywords: 'analyze dependencies package dependencies cycles 依赖 循环 包',
    enabled: () => Boolean(ctx.workspace.value),
    run: () => ctx.openPackageDeps?.(),
  }
}

/**
 * 「检查配置档」子菜单：切到哪一份 profile 就跑哪一份（`setRootProfile`）。
 * 用 `childrenOf` 动态生成 —— 档数会变（复制/导入/删除），静态 children 表达不了。
 */
function profileMenuRow(): MenuRow {
  return {
    id: 'analyze.profiles', title: '检查配置档',
    keywords: 'inspection profile root profile switch 配置档 检查配置 切换',
    childrenOf: () => profileRows(),
  }
}

/**
 * `InspectCodeInCodeMenuGroup` —— 代码菜单里的那一段（前置一条分隔线，
 * 因为上游那个组的第一项就是 `<separator/>`，`LangActions.xml:239`）。
 * `AnalyzeActionsPopup` 是个 popup 子菜单，所以这里同样用 `children` 表达，不拍平。
 */
export function createInspectCodeInCodeMenuRows(ctx: AnalyzeGroupContext): MenuRow[] {
  return [
    { id: 'analyze.codeMenuRule', rule: true },
    inspectCodeRow(ctx),
    {
      id: 'analyze.actionsPopup', title: 'Analyze Code',
      keywords: 'analyze code actions intent profile 分析代码',
      children: [runInspectionRow(ctx), profileMenuRow(), packageDepsRow(ctx)],
    },
  ]
}

/**
 * `AnalyzeMenu` —— 右键菜单里那个「分析」子菜单（上游挂在项目树右键与编辑器右键）。
 * 成员顺序照 `JavaActions.xml:61-66`：`InspectCodeGroup` → 分隔线 → `AnalyzeActions`。
 * 与上面代码菜单那一段用的是**同一批行工厂**，不是抄第二份。
 */
export function createAnalyzeMenuRows(ctx: AnalyzeGroupContext): MenuRow[] {
  return [
    inspectCodeRow(ctx),
    { id: 'analyze.popupRule', rule: true },
    runInspectionRow(ctx),
    profileMenuRow(),
    packageDepsRow(ctx),
  ]
}
