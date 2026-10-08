// **提交域的三条插件扩展点** —— 上游 `vcs/commit` 在本仓的宿主面。
//
// 上游是什么（逐字开过参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`）：
//   · `com.intellij.vcs.commitMessageInspection` —— `platform/vcs-impl/resources/META-INF/
//     VcsExtensionPoints.xml:241-247`（`beanClass="…CommitMessageInspectionEP"`，
//     `<with attribute="implementation" implements="…BaseCommitMessageInspection"/>`）。
//     `CommitMessageInspectionEP.kt:22` 的 `EP_NAME`；bundled 贡献三条在 `VcsExtensions.xml:147-149`
//     （`SubjectBodySeparationInspection` / `SubjectLimitInspection` / `BodyLimitInspection`）。
//     `BaseCommitMessageInspection.kt:44-60` 的 `checkFile(file, document, …)` 就是"跑这条检查、
//     给出问题范围"。上游把这些检查当 `LocalInspectionTool` 挂在提交信息编辑器上。
//   · `com.intellij.vcs.commitSuccessNotificationActionProvider` —— 同 `VcsExtensionPoints.xml:61-63`
//     （`interface="com.intellij.vcs.commit.CommitSuccessNotificationActionProvider" dynamic="true"`）。
//     接口 `CommitSuccessNotificationActionProvider.kt:14-24`：
//     `getActions(committer: VcsCommitter, notification: CommitNotification): List<NotificationAction>`
//     —— 提交成功后，插件往那条通知上补自己的动作（例如"推送"/"创建 MR"）。
//   · `com.intellij.vcs.pathsToRefreshProvider` —— 同 `VcsExtensionPoints.xml:103`
//     （`ProjectExtensionPointName`）。接口 `VcsPathsToRefreshProvider.kt:24-41`：
//     `getVcsName()` + `collectPathsToRefresh(project): Collection<FilePath>`，
//     聚合问法 `collectPathsToRefreshForVcs(project, vcs)` = `filter { getVcsName() == vcs.name }`
//     `.flatMap { collectPathsToRefresh(project) }` —— 提交后要额外刷新的那些路径。
//
// 本仓此前这三条都判 `[-]`（理由都是"本仓没有插件运行时"）。按 2026-10-06 的规约
// （**缺失能力要暴露成与 IDEA 相同的方法给第三方插件使用**）补上声明面 + 注册面 + 同名聚合问法：
//   · 提交信息检查：**真实消费点已接** —— `src/commitMessageInspection.ts` 的
//     `inspectCommitMessage` 改成遍历 EP 上的贡献（三条内建检查作为 bundled 贡献注册，
//     顺序与上游 `VcsExtensions.xml:147-149` 一致），第三方按同一 id 挂一条即可加自己的检查；
//   · 提交成功通知动作：聚合问法 `commitSuccessActions(notification)` 落在本文件，
//     内建贡献由 `src/commitNotification.ts` 注册；面板把它渲染成通知动作那一步在保留文件
//     `src/components/SourceControl.vue`（登记在 `docs/wiring-requests-2026-10-06-b1b7verdict.md`）；
//   · 提交后刷新路径：聚合问法 `collectPathsToRefreshForVcs(vcsName)` 落在本文件，
//     本仓一种 VCS（git）⇒ `vcsName` 就是 `git`；无 provider 时返回空表（行为不变）。
//
// 与上游的如实差异：① `BaseCommitMessageInspection` 的 PSI/`LocalInspectionTool` 外壳在本仓换成
// `CommitMessageInspectionLike`（纯文本行 + 设置 ⇒ 问题表）；② `NotificationAction` 换成
// `CommitNotificationActionLike`（标题 + 可选的执行入口）；③ `FilePath` 换成路径字符串；
// ④ provider 的 id 由贡献者给（上游从 EP 描述取）。
//
// 纯数据层：只 import `src/extensionPoints.ts` 与 `src/commitMessageInspection.ts` 的**类型**，
// 不 import vue/DOM/bridge，便于 `node --test` 直测。
//
// 判据：`tests/commit-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { CommitMessageInspectionSettings, CommitMessageProblem } from './commitMessageInspection.ts'

/** 三条 EP 的 id（逐字取自上游 xml / `EP_NAME`，见文件头逐行出处）。 */
export const COMMIT_MESSAGE_INSPECTION_EP = 'com.intellij.vcs.commitMessageInspection'
export const COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP = 'com.intellij.vcs.commitSuccessNotificationActionProvider'
export const VCS_PATHS_TO_REFRESH_PROVIDER_EP = 'com.intellij.vcs.pathsToRefreshProvider'

/**
 * 一条提交信息检查（上游 `BaseCommitMessageInspection` 的可移植子集）。
 * `enabled` 读本仓那份设置（上游每条检查有自己的 `InspectionProfile` 开关）。
 */
export interface CommitMessageInspectionLike {
  /** 贡献 id（本仓给；上游是 `implementation` 的全限定类名，bundled 三条逐字取自 `VcsExtensions.xml:147-149`）。 */
  id: string
  /** 这条检查此刻开不开（上游是检查配置档里的启用态；本仓读 `CommitMessageInspectionSettings`）。 */
  enabled?: (settings: CommitMessageInspectionSettings) => boolean
  /**
   * 上游 `checkFile(file, document, manager, isOnTheFly)`：对提交信息跑一次，
   * 返回它发现的问题（本仓给行文本与设置，返回 `CommitMessageProblem[]`）。
   */
  run: (lines: readonly string[], settings: CommitMessageInspectionSettings) => readonly CommitMessageProblem[]
}

/** 一条提交成功通知动作（上游 `NotificationAction` 的可移植子集）。 */
export interface CommitNotificationActionLike {
  /** 动作标题（上游 `NotificationAction.getTemplatePresentation().getText()`）。 */
  title: string
  /** 点了之后做什么（上游 `NotificationAction.actionPerformed`）。 */
  run?: () => void
}

/**
 * 一条提交成功通知动作提供者（上游 `CommitSuccessNotificationActionProvider` 的方法面，名字逐字相同）。
 */
export interface CommitSuccessNotificationActionProvider {
  id: string
  /** 上游 `getActions(committer, notification)`（本仓给通知的标题与正文，没有 Swing 通知对象）。 */
  getActions: (notification: CommitNotificationLike) => readonly CommitNotificationActionLike[]
}

/** 一条提交结果通知（上游 `CommitNotification` 的可移植子集）。 */
export interface CommitNotificationLike {
  /** 通知标题（`src/commitNotification.ts` 的 `commitNotificationTitle`）。 */
  title: string
  /** 通知正文各行（`src/commitNotification.ts` 的 `commitNotificationRows`）。 */
  rows: readonly string[]
}

/** 一条提交后刷新路径提供者（上游 `VcsPathsToRefreshProvider` 的方法面，名字逐字相同）。 */
export interface VcsPathsToRefreshProvider {
  id: string
  /** 上游 `getVcsName()`。 */
  getVcsName: () => string
  /** 上游 `collectPathsToRefresh(project)`（本仓给工作区根）。 */
  collectPathsToRefresh: (root: string) => readonly string[]
}

declareBundledExtensionPoints()

/** 三条 EP 的声明（模块加载即声明，第三方按同一 id 挂贡献）。 */
function declareBundledExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: COMMIT_MESSAGE_INSPECTION_EP, name: '提交信息检查',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, name: '提交成功通知动作提供者',
    scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: VCS_PATHS_TO_REFRESH_PROVIDER_EP, name: '提交后刷新路径提供者',
    scope: 'project', dynamic: true,
  })
}

/** 声明三条 EP（幂等；独立使用本模块时先声明）。 */
export function declareCommitExtensionPoints(): void {
  if (!EXTENSIONS.hasExtensionPoint(COMMIT_MESSAGE_INSPECTION_EP)) declareBundledExtensionPoints()
}

/** 插件贡献一条提交信息检查。 */
export function registerCommitMessageInspection(
  inspection: CommitMessageInspectionLike,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  declareCommitExtensionPoints()
  return EXTENSIONS.registerExtension(COMMIT_MESSAGE_INSPECTION_EP, inspection.id, inspection, options)
}

/** 注销一条提交信息检查。 */
export function unregisterCommitMessageInspection(id: string): boolean {
  return EXTENSIONS.unregisterExtension(COMMIT_MESSAGE_INSPECTION_EP, id)
}

/** 当前 EP 上的全部提交信息检查（bundled + 第三方；顺序 = 注册顺序，即上游的 EP 顺序）。 */
export function commitMessageInspections(scope: string = APPLICATION_SCOPE): CommitMessageInspectionLike[] {
  return EXTENSIONS.extensionsOf<CommitMessageInspectionLike>(COMMIT_MESSAGE_INSPECTION_EP, scope)
}

/**
 * 上游 `BaseCommitMessageInspection.checkFile` 的聚合问法：逐条跑（顺序即注册顺序），
 * 把各自的问题按**行号、再按注册顺序**拼起来。没有贡献时返回空表（`inspectCommitMessage` 会
 * 先注册三条内建贡献，所以生产路径上不会是空）。
 */
export function runCommitMessageInspections(
  lines: readonly string[],
  settings: CommitMessageInspectionSettings,
  scope: string = APPLICATION_SCOPE,
): CommitMessageProblem[] {
  const out: CommitMessageProblem[] = []
  for (const inspection of commitMessageInspections(scope)) {
    if (inspection.enabled && !inspection.enabled(settings)) continue
    out.push(...inspection.run(lines, settings))
  }
  return out
}

/** 插件贡献一条提交成功通知动作提供者。 */
export function registerCommitSuccessNotificationActionProvider(
  provider: CommitSuccessNotificationActionProvider,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  declareCommitExtensionPoints()
  return EXTENSIONS.registerExtension(COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条提交成功通知动作提供者。 */
export function unregisterCommitSuccessNotificationActionProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, id)
}

/** 当前 EP 上的全部通知动作提供者。 */
export function commitSuccessNotificationActionProviders(
  scope: string = APPLICATION_SCOPE,
): CommitSuccessNotificationActionProvider[] {
  return EXTENSIONS.extensionsOf<CommitSuccessNotificationActionProvider>(COMMIT_SUCCESS_NOTIFICATION_ACTION_PROVIDER_EP, scope)
}

/**
 * 上游 `CommitSuccessNotificationActionProvider.getActions` 的聚合问法：
 * 逐个取动作、首尾相接（上游 `ShowNotificationCommitResultHandler` 也是逐条 `addAction`）。
 * 没有 provider 时返回空表。
 */
export function commitSuccessActions(
  notification: CommitNotificationLike,
  scope: string = APPLICATION_SCOPE,
): CommitNotificationActionLike[] {
  const out: CommitNotificationActionLike[] = []
  for (const provider of commitSuccessNotificationActionProviders(scope)) {
    out.push(...provider.getActions(notification))
  }
  return out
}

/** 插件贡献一条提交后刷新路径提供者（项目级 EP：默认挂到 `root` 那个作用域）。 */
export function registerVcsPathsToRefreshProvider(
  provider: VcsPathsToRefreshProvider,
  root: string,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  declareCommitExtensionPoints()
  return EXTENSIONS.registerExtension(VCS_PATHS_TO_REFRESH_PROVIDER_EP, provider.id, provider, { scope: root, ...options })
}

/** 注销一条提交后刷新路径提供者。 */
export function unregisterVcsPathsToRefreshProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(VCS_PATHS_TO_REFRESH_PROVIDER_EP, id)
}

/** 当前 EP 上的全部刷新路径提供者（上游 `ProjectExtensionPointName.getExtensions(project)`：
 * 项目级 EP ⇒ 按工作区根作用域查，`root` 就是作用域名）。 */
export function vcsPathsToRefreshProviders(root: string): VcsPathsToRefreshProvider[] {
  return EXTENSIONS.extensionsOf<VcsPathsToRefreshProvider>(VCS_PATHS_TO_REFRESH_PROVIDER_EP, root)
}

/**
 * 上游 `VcsPathsToRefreshProvider.collectPathsToRefreshForVcs(project, vcs)` 的聚合问法：
 * 只问 `getVcsName()` 与本次 VCS 名相符的那些，逐个 `flatMap`（上游 `:30-35` 逐字如此）。
 * 本仓一种 VCS（git）⇒ 调用方传 `'git'`；没有 provider 时返回空表。
 */
export function collectPathsToRefreshForVcs(
  vcsName: string,
  root: string,
): string[] {
  const out: string[] = []
  for (const provider of vcsPathsToRefreshProviders(root)) {
    if (provider.getVcsName() !== vcsName) continue
    out.push(...provider.collectPathsToRefresh(root))
  }
  return out
}
