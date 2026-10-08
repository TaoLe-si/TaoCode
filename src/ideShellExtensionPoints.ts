// **IDE 外壳（第二批）的扩展点宿主接线** —— 项目视图的 Select In 目标来源 / 转到文件的自定义器 /
// 转到动作的别名匹配器（外加两条**本仓没有消费点、故未声明**的，见文件末）。
//
// 与 `src/selectInTargets.ts`（`com.intellij.selectInTarget` 本体）、`src/gotoByNameContributors.ts`
// （三个 goto 贡献者 EP）同一形状：这里补的是**围绕它们的那几条外围 EP**。
//
// 上游依据（qualifiedName / `ExtensionPointName.create` 的串**逐字**取自上游；本文件不发明 id）：
//   · `com.intellij.projectViewSelectInTargetProvider` ——
//     `platform/lang-impl/resources/intellij.platform.lang.impl.xml:320-322`
//     （`<extensionPoint name="projectViewSelectInTargetProvider" interface="com.intellij.ide.impl.ProjectViewSelectInTargetProvider" dynamic="true"/>`；
//     XML 写的是**相对名**，插件锚的是限定名 —— 限定名见
//     `platform/lang-impl/src/com/intellij/ide/impl/ProjectViewSelectInTargetProvider.kt:20` 的
//     `ExtensionPointName.create("com.intellij.projectViewSelectInTargetProvider")`）；
//     接口体同文件 `:12-14`，方法面 `getSelectInTargets(project): Collection<SelectInTarget>`（`:13`）。
//     消费点（上游）：同文件 `:24-35` 的 `getProjectViewSelectInTargets(project)` —— 逐个 provider
//     取 targets，**抛错的那条只记日志、不打断其余**（`:31-33` 的 `rethrowControlFlowException` +
//     `LOG.error`）。内建那条是 `LegacyProjectViewSelectInTargetProvider`（`:37-50`，`:40-41` 在
//     `isProjectViewSplit()` 时给空表）。
//   · `com.intellij.gotoFileCustomizer` —— 同文件 `:335`
//     （`interface="com.intellij.ide.util.gotoByName.GotoFileCustomizer"`）；接口
//     `platform/lang-impl/src/com/intellij/ide/util/gotoByName/GotoFileCustomizer.java:30`
//     （`EP_NAME` 在 `:32`）；方法面 `createItemProvider(project, context, model)`（`:37`，造一个
//     「转到文件」的条目来源）与 `isAccepted(project, item)`（`:40`，`ApiStatus.Internal`，
//     缺省 true —— **筛掉**不该出现在「转到文件」里的条目）。
//     消费点（上游）：`GotoFileModel` 取条目时按 `isAccepted` 过滤。
//   · `com.intellij.gotoActionAliasMatcher` —— 同文件 `:236`
//     （`interface="com.intellij.ide.util.gotoByName.GotoActionAliasMatcher"`）；接口
//     `…/GotoActionAliasMatcher.java:28`（`EP_NAME` 在 `:29`）；方法面
//     `matchAction(action, pattern): MatchMode`（`:30`，缺省 `MatchMode.NONE`）；
//     `MatchMode` 六个值在 `…/MatchMode.java:4`：`NONE, INTENTION, NAME, DESCRIPTION, GROUP, NON_MENU, SYNONYM`。
//     消费点（上游）：`GotoActionModel.actionMatches`（`:523-540`）—— 名字/描述/分组都没命中时才问
//     这一族别名匹配器。平台内建那条是 `LocalizedActionAliasMatcher`（`:675`，本地化别名）。
//   · `com.intellij.moduleRendererFactory` —— 同文件 `:329`
//     （`interface="com.intellij.ide.util.ModuleRendererFactory"`）；类
//     `platform/lang-impl/src/com/intellij/ide/util/ModuleRendererFactory.java:20`（`EP_NAME` 在 `:22`）；
//     方法面 `handles(element)`（`:36`，protected）、`rendersLocationString()`（`:32`）、
//     `getModuleTextWithIcon(element)`（`:55`，缺省走渲染器）；静态入口 `findInstance(element)`（`:24-30`）
//     —— **第一个** `handles` 为真的工厂说了算。**本仓无消费点 ⇒ 未声明**（见文件末）。
//   · `com.intellij.directoryProjectGenerator` —— `platform/platform-impl/resources/intellij.platform.ide.impl.xml:210`
//     的 `<extensionPoint qualifiedName="com.intellij.directoryProjectGenerator" …>`；消费方按限定名取
//     （`platform/lang-impl/src/com/intellij/ide/util/projectWizard/AbstractNewProjectStep.java:65`
//     的 `new ExtensionPointName<>("com.intellij.directoryProjectGenerator")`）。**本仓无消费点 ⇒ 未声明**。
//   · `com.intellij.projectTemplateFileProcessor` —— `platform/lang-impl/resources/intellij.platform.lang.impl.xml:309`
//     （`interface="com.intellij.ide.util.projectWizard.ProjectTemplateFileProcessor"`）；类
//     `…/projectWizard/ProjectTemplateFileProcessor.java:16`（`EP_NAME` 在 `:18`）；方法面
//     `encodeFileText(content, file, project)`（`:22`，返回 null = 不管）+ 静态入口
//     `encodeFile(content, file, project)`（`:24-31`）—— **第一个**返回非 null 的说了算，都不管就返回原样。
//     **与本仓既有链重复 ⇒ 未声明**（见文件末）。
//
// 本仓此前：Select In 已由 `src/selectInTargets.ts` 接成 `com.intellij.selectInTarget` 的 EP
// （第三方能挂目标本体），但**目标来源**那条外围 EP 没有；转到文件的条目全来自
// `src/gotoByNameContributors.ts` 的三张表，没有筛选面；转到动作（`src/commandSearch.ts`）只有
// 名字/关键字打分，没有别名档；新工程与模板文件的处理器一族本仓没有落点。本文件补上前四条，
// 并把消费点接在真实调用链上（每条写在 consume 函数注释里）。后两条（`directoryProjectGenerator` /
// `projectTemplateFileProcessor`）见文件末「未声明」段。
//
// 与上游的如实差异：① 本仓没有 `Project`/`AnAction`/`PsiFileSystemItem`/`VirtualFile` 载具，
// 一律收成可判定的输入形状（路径 / 动作 id + 文案 + 分组 / 候选条目的路径 + 名字）；
// ② `ModuleRendererFactory` 的「模块」在本仓是**工程视图里的一个节点**（本仓没有 Java 模块概念），
// 所以 `handles` 收成「这个节点归不归你渲染」、`getModuleTextWithIcon` 收成「给这个节点一段文本
// + 一个图标键」；③ `createItemProvider` 那一格本仓不落（见 `GotoFileCustomizerInput` 的注释）。
//
// 纯数据层：只 import `src/extensionPoints.ts`，不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/ide-shell-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** 三条 EP 的 id（逐字取自上游，见文件头逐条出处）。 */
export const PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP = 'com.intellij.projectViewSelectInTargetProvider'
export const GOTO_FILE_CUSTOMIZER_EP = 'com.intellij.gotoFileCustomizer'
export const GOTO_ACTION_ALIAS_MATCHER_EP = 'com.intellij.gotoActionAliasMatcher'

function acceptsLanguage(contribution: { languages?: readonly string[] }, language: string): boolean {
  const list = contribution.languages
  if (!list || list.length === 0) return true
  if (!language || language === 'other') return true
  return list.includes(language)
}

// ── ① 项目视图的 Select In 目标来源（`com.intellij.projectViewSelectInTargetProvider`） ─────────

/**
 * 一条来源（`ProjectViewSelectInTargetProvider.getSelectInTargets(project)` 的同名方法面）。
 * 返回的目标形状与 `src/selectInTargets.ts` 的 `SelectInTarget` **同一形状**（本仓的
 * Select In 目标只有一个形状，免得两条 EP 各给一种目标在弹层里打架）。
 */
export interface ProjectViewSelectInTargetProviderContribution {
  id: string
  languages?: readonly string[]
  /** `getSelectInTargets(project)`。 */
  getSelectInTargets: (input: ProjectViewSelectInTargetInput) => readonly ProjectViewSelectInTargetLike[]
}

/** 问「项目视图里有哪些 Select In 目标」的输入（上游 `Project` 的可移植替代）。 */
export interface ProjectViewSelectInTargetInput {
  /** 工作区根（0 个 = 没有工程）。 */
  workspaceRoot: string
  /** 项目视图当前是不是分屏的（上游 `isProjectViewSplit()`，`:40-41` 那一条的输入）。 */
  splitView: boolean
}

/** 目标的最小形状（与 `src/selectInTargets.ts` 的 `SelectInTarget` 结构兼容）。 */
export interface ProjectViewSelectInTargetLike {
  id: string
  label: string
  weight: number
  canSelect: (context: unknown) => boolean
  selectIn: (context: unknown, requestFocus?: boolean) => void | Promise<void>
  toolWindowId?: string | null
  minorViewId?: string | null
}

/** `ProjectViewSelectInTargetProviderEP.extensionList` 的等价物。 */
export function projectViewSelectInTargetProviders(
  scope: string = APPLICATION_SCOPE,
): ProjectViewSelectInTargetProviderContribution[] {
  return EXTENSIONS.extensionsOf<ProjectViewSelectInTargetProviderContribution>(PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP, scope)
}

/**
 * `getProjectViewSelectInTargets(project)`（`ProjectViewSelectInTargetProvider.kt:24-35`）的等价物：
 * 逐个 provider 取 targets 合并；**抛错的那条只跳过、不打断其余**（上游 `:31-33` 记日志后继续）。
 * 消费点：`src/selectInTargets.ts` 的 `availableSelectInTargets`（弹层行 = EP 目标 + 来源给的目标）。
 */
export function projectViewSelectInTargets(
  input: ProjectViewSelectInTargetInput, scope: string = APPLICATION_SCOPE,
): ProjectViewSelectInTargetLike[] {
  const out: ProjectViewSelectInTargetLike[] = []
  for (const provider of projectViewSelectInTargetProviders(scope)) {
    try { for (const target of provider.getSelectInTargets(input)) if (target?.id) out.push(target) } catch { /* 坏来源跳过。 */ }
  }
  return out
}

// ── ② 转到文件的自定义器（`com.intellij.gotoFileCustomizer`） ──────────────────────────────────

/** 「转到文件」里的一条候选（上游 `PsiFileSystemItem` 的可移植替代）。 */
export interface GotoFileItemLike {
  /** 工作区相对路径。 */
  path: string
  /** 名字（上游 `getName()`）。 */
  name: string
  /** 是不是目录（上游 `isDirectory()`）。 */
  directory: boolean
}

/** 一条自定义器（方法名与上游逐字相同）。 */
export interface GotoFileCustomizerContribution {
  id: string
  languages?: readonly string[]
  /**
   * `createItemProvider(project, context, model)`。
   * **本仓不落这一格**：上游它返回一个 `GotoFileItemProvider`（换掉整个条目来源），
   * 本仓的条目来源是 `src/gotoByNameContributors.ts` 的三张 EP 表（按 id 挂贡献者即是换来源），
   * 再造一层 provider 载体只会让两条来源重叠 ⇒ 如实登记为「差异」，见报告。
   */
  createItemProvider?: (input: GotoFileCustomizerInput) => unknown
  /** `isAccepted(project, item)`（缺省 true）：false = 这个条目不进「转到文件」。 */
  isAccepted?: (item: GotoFileItemLike) => boolean
}

/** 问自定义器的输入（上游 `(Project, PsiElement context, GotoFileModel model)` 的可移植替代）。 */
export interface GotoFileCustomizerInput {
  path: string
  language: string
  /** 已登记的候选条目（模型里当前那一批）。 */
  items: readonly GotoFileItemLike[]
}

/** `GotoFileCustomizer.EP_NAME.getExtensionList()` 的等价物（按语言过滤）。 */
export function gotoFileCustomizers(language: string, scope: string = APPLICATION_SCOPE): GotoFileCustomizerContribution[] {
  return EXTENSIONS.extensionsOf<GotoFileCustomizerContribution>(GOTO_FILE_CUSTOMIZER_EP, scope)
    .filter(contribution => acceptsLanguage(contribution, language))
}

/**
 * `isAccepted` 的合并版：**每一个**自定义器都接受才留下（上游 `GotoFileModel` 取条目时逐个问）。
 * 没有贡献时全过（既有行为不变）。
 * 消费点：`src/gotoByNameContributors.ts` 的 `gotoByNameContributions`（`model === 'file'` 那一档）。
 */
export function gotoFileAccepted(
  input: GotoFileCustomizerInput, item: GotoFileItemLike, scope: string = APPLICATION_SCOPE,
): boolean {
  for (const customizer of gotoFileCustomizers(input.language, scope)) {
    if (typeof customizer.isAccepted !== 'function') continue
    try {
      if (customizer.isAccepted(item) !== true) return false
    } catch { /* 坏自定义器跳过。 */ }
  }
  return true
}

/** 筛一遍整批候选（上游 `GotoFileModel` 的过滤那一拍）。 */
export function filterGotoFileItems(
  input: GotoFileCustomizerInput, scope: string = APPLICATION_SCOPE,
): GotoFileItemLike[] {
  return input.items.filter(item => gotoFileAccepted(input, item, scope))
}

// ── ③ 转到动作的别名匹配器（`com.intellij.gotoActionAliasMatcher`） ───────────────────────────

/**
 * `MatchMode`（`MatchMode.java:4`）六个值**逐字**；外加本仓的 `NONE` 即「不命中」。
 * 消费方按档给分：`NAME` > `SYNONYM` > `DESCRIPTION` > `GROUP` > 其余（与上游
 * `GotoActionModel.actionMatches` 的判定顺序一致：名字先、别名最后）。
 */
export type GotoActionMatchMode = 'NONE' | 'INTENTION' | 'NAME' | 'DESCRIPTION' | 'GROUP' | 'NON_MENU' | 'SYNONYM'

/** 被匹配的一个动作（上游 `AnAction` 的可移植替代）。 */
export interface GotoActionTargetLike {
  /** 动作 id（上游 `AnAction` 的身份）。 */
  id: string
  /** 文案（上游 `getTemplatePresentation().getText()`）。 */
  text: string
  /** 分组路径（上游 `getTemplatePresentation().getGroupingText()` / `ActionGroup` 链）。 */
  group?: string
  /** 描述（上游 `getTemplatePresentation().getDescription()`）。 */
  description?: string
}

/** 一条别名匹配器（方法名与上游逐字相同）。 */
export interface GotoActionAliasMatcherContribution {
  id: string
  /** `matchAction(action, pattern): MatchMode`（缺省 `NONE`）。 */
  matchAction?: (action: GotoActionTargetLike, pattern: string) => GotoActionMatchMode
}

/** `GotoActionAliasMatcher.EP_NAME.getExtensionList()` 的等价物。 */
export function gotoActionAliasMatchers(scope: string = APPLICATION_SCOPE): GotoActionAliasMatcherContribution[] {
  return EXTENSIONS.extensionsOf<GotoActionAliasMatcherContribution>(GOTO_ACTION_ALIAS_MATCHER_EP, scope)
}

/**
 * `GotoActionModel.actionMatches` 的**别名那一档**（`:523-540`：名字/描述/分组都没命中时问这一族）：
 * 返回第一个非 `NONE` 的档（上游那条循环就是"有一条认了就算命中"）。
 * 没有贡献或都不认返回 `NONE`。
 * 消费点：`src/commandSearch.ts` 的 `scoreCommand`（别名命中给分，与名字命中的档位分开）。
 */
export function actionAliasMatch(
  action: GotoActionTargetLike, pattern: string, scope: string = APPLICATION_SCOPE,
): GotoActionMatchMode {
  if (!pattern) return 'NONE'
  for (const matcher of gotoActionAliasMatchers(scope)) {
    if (typeof matcher.matchAction !== 'function') continue
    try {
      const mode = matcher.matchAction(action, pattern)
      if (mode && mode !== 'NONE') return mode
    } catch { /* 坏匹配器跳过。 */ }
  }
  return 'NONE'
}

/** 别名档 → 打分（本仓 `scoreCommand` 的口径：档越高分越高，`NONE` 不加分）。 */
export function aliasMatchScore(mode: GotoActionMatchMode): number {
  switch (mode) {
    case 'NAME': return 4
    case 'SYNONYM': return 3
    case 'DESCRIPTION': return 2
    case 'GROUP': return 1
    case 'INTENTION': return 1
    case 'NON_MENU': return 1
    default: return 0
  }
}

// ── EP 声明 / 注册 / 注销 ─────────────────────────────────────────────────────────────────

/** 三条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareIdeShellExtensionPoints(): void {
  for (const [id, name] of [
    [PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP, '项目视图 Select In 目标来源'],
    [GOTO_FILE_CUSTOMIZER_EP, '转到文件自定义器'],
    [GOTO_ACTION_ALIAS_MATCHER_EP, '转到动作别名匹配器'],
  ] as const) {
    EXTENSIONS.declareExtensionPoint({ id, name, scope: APPLICATION_SCOPE, dynamic: true })
  }
}

declareIdeShellExtensionPoints()

/** 按 id 注册一条贡献（同 id 覆盖，与宿主同口径）。 */
export function registerIdeShellExtension<T>(
  extensionPoint: string, id: string, value: T, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(extensionPoint, id, value, options)
}

/** 注销一条贡献（返回是否真的删掉了）。 */
export function unregisterIdeShellExtension(extensionPoint: string, id: string): boolean {
  return EXTENSIONS.unregisterExtension(extensionPoint, id)
}

/** 注册一条 Select In 目标来源（缺省 bundled）。 */
export function registerProjectViewSelectInTargetProvider(
  contribution: ProjectViewSelectInTargetProviderContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeShellExtension(PROJECT_VIEW_SELECT_IN_TARGET_PROVIDER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条转到文件自定义器（缺省 bundled）。 */
export function registerGotoFileCustomizer(
  contribution: GotoFileCustomizerContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeShellExtension(GOTO_FILE_CUSTOMIZER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

/** 注册一条转到动作别名匹配器（缺省 bundled）。 */
export function registerGotoActionAliasMatcher(
  contribution: GotoActionAliasMatcherContribution, options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return registerIdeShellExtension(GOTO_ACTION_ALIAS_MATCHER_EP, contribution.id, contribution, { source: 'bundled', ...options })
}

// ── bundled：本仓内建的四支 ────────────────────────────────────────────────────────────────

/** 内建 Select In 目标来源 id（上游 `LegacyProjectViewSelectInTargetProvider` 的等价物）。 */
export const LEGACY_PROJECT_VIEW_TARGET_PROVIDER_ID = 'taocode.projectViewSelectInTargetProvider.legacy'
/** 内建转到文件自定义器 id（passthrough：恒接受）。 */
export const BUNDLED_GOTO_FILE_CUSTOMIZER_ID = 'taocode.gotoFileCustomizer.bundled'
/** 内建别名匹配器 id（上游平台那条是 `LocalizedActionAliasMatcher`；本仓的别名档空着）。 */
export const BUILTIN_ACTION_ALIAS_MATCHER_ID = 'taocode.gotoActionAliasMatcher.bundled'

/**
 * 内建 Select In 目标来源 —— 上游 `LegacyProjectViewSelectInTargetProvider`（`:37-50`）的等价物：
 * 项目视图分屏时给空表（`:40-41`），否则给 `src/selectInTargets.ts` 那六个内建目标里
 * 「项目视图」那一个（上游给的是 ProjectView 自己的那几个 target，本仓的那一档就是 `project`）。
 */
export function legacyProjectViewSelectInTargetProvider(
  targets: (input: ProjectViewSelectInTargetInput) => readonly ProjectViewSelectInTargetLike[],
): ProjectViewSelectInTargetProviderContribution {
  return {
    id: LEGACY_PROJECT_VIEW_TARGET_PROVIDER_ID,
    getSelectInTargets: input => (input.splitView ? [] : targets(input)),
  }
}

/** 内建转到文件自定义器 —— 恒接受（没有第三方挂进来时条目一条不少）。 */
export function builtinGotoFileCustomizer(): GotoFileCustomizerContribution {
  return { id: BUNDLED_GOTO_FILE_CUSTOMIZER_ID, isAccepted: () => true }
}

/** 内建别名匹配器 —— 一个都不认（`matchAction` 恒 `NONE`；本仓的「转到动作」按名字打分）。 */
export function builtinGotoActionAliasMatcher(): GotoActionAliasMatcherContribution {
  return { id: BUILTIN_ACTION_ALIAS_MATCHER_ID, matchAction: () => 'NONE' }
}

/**
 * 登记本仓内建的三支默认贡献（幂等：同 id 覆盖）。
 * `legacyProvider` 需要宿主把「内建那六个目标」递进来（本模块不 import `selectInTargets.ts`，
 * 免得两条 EP 的注册面互相 import）；不给就只登记其余两条。
 */
export function registerBundledIdeShellDefaults(
  legacyProvider?: ProjectViewSelectInTargetProviderContribution,
): void {
  if (legacyProvider) registerProjectViewSelectInTargetProvider(legacyProvider)
  registerGotoFileCustomizer(builtinGotoFileCustomizer())
  registerGotoActionAliasMatcher(builtinGotoActionAliasMatcher())
}

registerBundledIdeShellDefaults()

// ── 未声明（没有真实消费点，如实登记而不是只挂一张空 EP） ────────────────────────────────────
//
// · `com.intellij.moduleRendererFactory`（`platform/lang-impl/resources/intellij.platform.lang.impl.xml:329`
//   的 `<extensionPoint qualifiedName="com.intellij.moduleRendererFactory"
//   interface="com.intellij.ide.util.ModuleRendererFactory" dynamic="true"/>`，`:1817` 挂着平台那条
//   `id="platform"`）—— 「给一个节点算文案 + 图标」的工厂。本仓**没有模块概念**，工程树节点的
//   文案由 `src/projectTreeModel.ts` 的 `Entry.name` 直接给、装饰由 `src/projectTreeDecorations.ts`
//   走另一条 EP（`ProjectViewNodeDecorator`，装饰面 ≠ 渲染面），没有任何「向工厂问节点文案」的
//   调用链 ⇒ 无消费点，不声明。
// · `com.intellij.directoryProjectGenerator`（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:210`）
//   —— 新工程向导的生成器族。本仓**没有新工程向导**：`src/wizard.ts` 是通用的分步向导骨架
//   （步进/提交/回退），`src/welcomeProjects.ts` 只列最近工程，没有任何「工程生成器」调用链 ⇒
//   没有消费点。要落它得先有「新建工程」那条流程（跨 lane，见报告的剩余未做）。
// · `com.intellij.projectTemplateFileProcessor`（`…lang.impl.xml:309`）—— 模板文件正文的编码器
//   （`encodeFile(content, file, project)`，第一个返回非 null 的说了算）。看上去 `src/fileTemplateCreate.ts`
//   的 `planFileTemplateCreate` 是天然落点，但那一格上游是给 **工程模板**（`ProjectTemplateFileProcessor`，
//   包 `ide.util.projectWizard`）用的，而本仓文件模板的正文展开已经由
//   `renderFileTemplate`（`src/fileTemplateParser.ts`）+ 变量表全权处理，再插一层「编码器」
//   会与既有展开链**重复消费**同一段正文（同一份 `$VAR$` 被两处改写）⇒ 本轮不声明，
//   登记进报告。若后续要做，落点应是 `renderFileTemplate` 之后的最后一拍。
