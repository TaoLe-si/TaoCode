// Run Anything 的**执行上下文**（工作目录）—— 上游
// `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingExecutingContext.kt:16-33`
// （`sealed class RunAnythingContext` 的四个子类）
// `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextUtils.kt:14-21`（`getPath()`）
// `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingChooseContextAction.kt`
//   · `:62-78`  `update()`：没有可用上下文就**整个按钮隐藏**；选中的不在表里就作废；
//                 还没选就取**第一个**；按钮文字 = 选中项的 label。
//   · `:109-117` `createItems()`：四类各一个行渲染器。
//   · `:218-226` 分组分隔线：第一个「浏览目录」行上方是 Directories，第一个 Module 行上方是 Modules。
//   · `:235-240` `allContexts(project)`：Project +（模块 >1 才列）+ 浏览目录 + 最近目录。
//   · `:242-249` `projectAndModulesContexts`：**模块只有一个时整组不列**（`.let { if (it.size > 1) it else emptyList() }`）。
//   · `:139-147` 最近目录入栈：满了先 `removeAt(0)` 再 `add`；条数取注册表
//                 `run.anything.context.recent.directory.number`。
//   · `:214` 弹层标题 `run.anything.context.title.working.directory`。
// `platform/lang-impl/src/com/intellij/ide/actions/runAnything/RunAnythingContextRecentDirectoryCache.kt:26-29`
//   （`State.paths`，存 `.idea/workspace.xml`）。
// 注册表默认值 5：`platform/ide-core-impl/resources/intellij.platform.ide.core.impl.xml:170-171`。
//
// 文案：中文是本仓口径；英文原文与 bundle key 记在常量注释里，全部出自
// `platform/platform-api/resources/messages/IdeBundle.properties:1183-1189`。
//
// **没有宿主（具体卡点）**：`run.start` 本身吃 `cwd`（`src/runActions.ts:417` 就传了
// `cwd: workspace.value.root`），但那条函数把 cwd **写死成工作区根**、签名里没有 cwd 形参
// （`src/runActions.ts:396`），改它要动执行域的 `src/runActions.ts`（本 lane 未获授权）。
// 对话框的 emit 也只透传 command（`src/components/RunAnythingDialog.vue:43`）。
// ⇒ 这里只落规则与表，**上下文选择器不渲染**（playbook §3：没有消费链路就不画控件）。

/** `IdeBundle` L1184 `run.anything.context.project` = `Project`。 */
export const CONTEXT_LABEL_PROJECT = '项目'
/** L1183 `run.anything.context.browse.directory` = `Browse Directory…`。 */
export const CONTEXT_LABEL_BROWSE = '浏览目录…'
/** L1185 `run.anything.context.project.undefined` = `undefined`（模块算不出相对路径时的描述）。 */
export const CONTEXT_DESCRIPTION_UNDEFINED = '未定义'
/** L1186 `run.anything.context.title.working.directory` = `Execution Context`。 */
export const CONTEXT_POPUP_TITLE = '执行上下文'
/** L1187 `run.anything.context.separator.directories` = `Directories`。 */
export const CONTEXT_SEPARATOR_DIRECTORIES = '目录'
/** L1188 `run.anything.context.separator.modules` = `Modules`。 */
export const CONTEXT_SEPARATOR_MODULES = '模块'
/** L1189 `run.anything.context.tooltip` = `Choose context the current command will be executed in`。 */
export const CONTEXT_TOOLTIP = '选择命令在哪个上下文里执行'

/**
 * 注册表 `run.anything.context.recent.directory.number` 的默认值 5
 * （`intellij.platform.ide.core.impl.xml:170-171`，`defaultValue="5"`）。
 */
export const RUN_ANYTHING_RECENT_DIRECTORY_LIMIT = 5

/**
 * 四个子类（`RunAnythingExecutingContext.kt:17-33`）。本仓**没有模块模型**，
 * 所以 `module` 这一档的可用性由 `availableContexts` 的组装方决定（本仓通常不给）。
 */
export type RunAnythingContextKind = 'project' | 'module' | 'browse' | 'recentDirectory'

export interface RunAnythingContext {
  kind: RunAnythingContextKind
  /** `@ActionText label`（`RunAnythingExecutingContext.kt:16`）。 */
  label: string
  /** `@ActionDescription description`（`:16`，默认空串）。 */
  description: string
  /**
   * 上游的 `icon: Icon?`（`:16`）四个取值：`ProjectContext` 是 `EmptyIcon.ICON_16`
   * （`RunAnythingChooseContextAction.kt:124`）、`ModuleContext` 是 `AllIcons.Nodes.Module`
   * （`:26`）、两个目录类是 `AllIcons.Nodes.Folder`（`:29`、`:32`）。
   * 本仓存 lucide 图标名（`src/uiIcons.ts` 那套），null = 空图标。
   */
  icon: string | null
  /** `ModuleContext` 的模块名 / `RecentDirectoryContext` 的原始绝对路径。 */
  value: string
}

/**
 * `RunAnythingContextUtils.getPath()`（`:14-21`）—— **本仓的路径都是工作区相对**，
 * 所以 `guessProjectDir()/guessModuleDir()` 对应「工作区根」与「模块的内容根」：
 *   · project → 工作区根（上游 `project.guessProjectDir()?.path ?: project.basePath`，`:15-17`）；
 *   · module → 模块内容根（本仓由调用方给 `moduleRoot`）；
 *   · recentDirectory → 目录本身；
 *   · browse → **null**（`:20`）—— 「浏览…」是个动作不是一处目录。
 */
export function contextPath(context: RunAnythingContext, moduleRoots: Readonly<Record<string, string>> = {}): string | null {
  if (context.kind === 'project') return ''
  if (context.kind === 'module') return moduleRoots[context.value] ?? null
  if (context.kind === 'recentDirectory') return context.value
  return null
}

/**
 * `ModuleContext` 的描述（`RunAnythingExecutingContext.kt:21-26`）：
 * 模块内容根**相对项目根**的路径（`FileUtil.getRelativePath(..., '/')`，`:23-24`）：
 * `contentRoots` 恰好一个时用那一个，否则退回 `getModuleDirPath`。
 * 只有**项目根拿不到**（上游 `guessProjectDir()` 为 null，`:22`）才落到
 * `run.anything.context.project.undefined`；相对路径为空串就是空串（内容根 == 项目根），
 * 那是合法结果，不是「未定义」。
 */
export function moduleDescription(projectRootKnown: boolean, relativeRoot: string | null): string {
  if (!projectRootKnown) return CONTEXT_DESCRIPTION_UNDEFINED
  return relativeRoot ?? ''
}

export interface AllContextsInput {
  /** 项目上下文（`ProjectContext(project)`，`:18`）：描述是 `project.basePath`（`:18`）。 */
  project: { label?: string; basePath: string }
  /** 模块上下文（`ModuleContext(it)`，`:21-26`）。 */
  modules: readonly { name: string; description: string; icon?: string }[]
  /** 最近目录缓存（`RunAnythingContextRecentDirectoryCache.state.paths`，`:27-28`）。 */
  recentDirectories: readonly string[]
  /**
   * 「浏览目录…」行（`BrowseRecentDirectoryContext`，`:28-29`）—— 上游是**单例**
   * `object`，永远在表里（`:237`）；本仓给一个开关是为了让浏览器预览（无宿主文件选择器）
   * 能把这一行藏掉，其余语义不变。
   */
  canBrowse?: boolean
}

/**
 * `allContexts(project)`（`:235-240`）= `projectAndModulesContexts` + 浏览目录 + 最近目录。
 * 顺序逐条照抄，且**模块只有一个就整组不列**（`projectAndModulesContexts`，`:242-249`）。
 */
export function allRunAnythingContexts(input: AllContextsInput): RunAnythingContext[] {
  const out: RunAnythingContext[] = [{
    kind: 'project',
    label: input.project.label ?? CONTEXT_LABEL_PROJECT,
    description: input.project.basePath,
    icon: null,
    value: '',
  }]
  if (input.modules.length > 1) {
    for (const module of input.modules) {
      out.push({ kind: 'module', label: module.name, description: module.description, icon: module.icon ?? 'Box', value: module.name })
    }
  }
  if (input.canBrowse !== false) out.push({ kind: 'browse', label: CONTEXT_LABEL_BROWSE, description: '', icon: 'Folder', value: '' })
  for (const path of input.recentDirectories) {
    out.push({ kind: 'recentDirectory', label: recentDirectoryLabel(path), description: '', icon: 'Folder', value: path })
  }
  return out
}

/**
 * `RecentDirectoryContext` 的 label = `FileUtil.getLocationRelativeToUserHome(path)`（`:32`）。
 * 那个方法（`platform/util/src/com/intellij/openapi/util/io/FileUtil.java:1265-1282`）在
 * **非 Unix 上原样返回**（`:1273` 的 `isUnix || !unixOnly`，单参版传 `unixOnly = true`），
 * Windows 宿主上永远拿不到 `~` 缩写 —— 这里照抄这个平台差异，不在 Windows 上造 `~`。
 */
export function recentDirectoryLabel(path: string, isUnix = false, userHome?: string): string {
  if (!isUnix || !userHome) return path
  const normalized = path.replace(/\\/g, '/')
  const home = userHome.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized === home) return '~'
  return normalized.startsWith(`${home}/`) ? `~/${normalized.slice(home.length + 1)}` : path
}

/**
 * `update()`（`:62-78`）的选择规则，三条逐字照抄：
 *   1. 表空 ⇒ `isEnabledAndVisible = false`（整个按钮隐藏，`:65-68`）；
 *   2. 选中的不在表里 ⇒ 作废（`:70-72`）；
 *   3. 还没选 ⇒ 取**第一个**（`:73`）。
 * 返回值就是按钮该显示的文字（`selectedContext.label`，`:76`）与图标（`:77`）。
 */
export function resolveSelectedContext(
  available: readonly RunAnythingContext[],
  selected: RunAnythingContext | null,
): { hidden: boolean; selected: RunAnythingContext | null; label: string; icon: string | null } {
  if (available.length === 0) return { hidden: true, selected: null, label: '', icon: null }
  const kept = selected && available.some(context => contextKey(context) === contextKey(selected)) ? selected : null
  const current = kept ?? available[0]
  return { hidden: false, selected: current, label: current.label, icon: current.icon }
}

const contextKey = (context: RunAnythingContext): string => `${context.kind}:${context.value}:${context.label}`

/**
 * 弹层里的分隔线（`ChooseContextPopupStep.getSeparatorAbove`，`:218-226`）：
 *   · 「浏览目录」行上方 ⇒ Directories（`:221`）；
 *   · **第一个** Module 行上方 ⇒ Modules（`:222-223`）；
 *   · 其余 ⇒ 无。
 * 返回分隔线要插在**哪一行之下**（-1 = 插在最上面），没有就是 null。
 */
export function separatorAbove(contexts: readonly RunAnythingContext[], index: number): string | null {
  const context = contexts[index]
  if (!context) return null
  if (context.kind === 'browse') return CONTEXT_SEPARATOR_DIRECTORIES
  if (context.kind === 'module') {
    const firstModule = contexts.findIndex(entry => entry.kind === 'module')
    if (index === firstModule) return CONTEXT_SEPARATOR_MODULES
  }
  return null
}

/**
 * 最近目录入栈（`BrowseDirectoryItem.actionPerformed`，`:139-147`）：
 * 满了先 `removeAt(0)` **再** `add(path)`（`:141-144`），条数取注册表。
 * 与 `src/runAnything.ts` 的 `HISTORY_LIMIT = 12` 无关 —— 那是**命令历史**的条数，
 * 这里是**最近目录**的条数，两者不是一张表。
 */
export function pushRecentDirectory(
  paths: readonly string[],
  path: string,
  limit = RUN_ANYTHING_RECENT_DIRECTORY_LIMIT,
): string[] {
  const next = [...paths]
  if (next.length >= limit) next.splice(0, next.length - limit + 1)
  next.push(path)
  return next
}
