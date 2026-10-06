// 本仓**唯一**的「打开外部链接」出口（上游那一个 `BrowserLauncher.browse` 的等价物）。
//
// 为什么要有这个文件：上游所有「在浏览器/关联程序里打开 URL」的动作都汇到同一个入口
// （`platform/platform-api/src/com/intellij/ide/browsers/BrowserLauncherAppless.kt:88-112` 的
// `browse()`：`:96` 先 trim、`:99` 才 `canBrowse`、过了才真的开），**判定就长在它里面**。
// 本仓的 URL 出口本来有五条（`src/App.vue` 两条、`src/components/TerminalPanel.vue`、
// `src/components/RunConsole.vue`、`src/quickDocHost.ts`），上一轮之前的形状是每一处各自
// `request('shell.openUrl', …)` ⇒ 一句都没问（接线请求 welcome2 的 R2 记的就是这个）。
// 逐处各判一次必漏，所以这里收成一条出口：判定复用 `src/trustedProjects.ts` 的
// `browseWithTrustCheck`（`BrowserLauncherImpl.kt:59-87` 的 `canBrowse` 等价物，判据
// `tests/welcome-trust-dialog.test.mjs`），调用方只负责「把 URL 交出来 + 接住自己的错误文案」。
//
// 门禁由宿主**装配时安装**（`src/workspaceLifecycle.ts` 建那一域时就 `installExternalLinkGate`：
// 它手里有工作区根、信任清单、落库那条 `settings.general.update`，以及那个 `mode="link"` 的弹框）。
// 本仓先例：会话级信任的真源是模块级数组（`src/trustedProjects.ts:343`）、Code Vision 的运行时表
// 由读盘那一处灌（`restoreCodeVisionSettings`）、hover 缓存注册成共享的一张（`registerSharedDocHover`）
// —— 都是「装配处灌模块级状态」，不是新发明。
//
// **没装门禁时的行为 = 接线前的行为**（直接把 URL 交给宿主的 `shell.openUrl`，不开口判、也不静默吞掉）：
// 这样本模块被接上之前不会把功能打死，接上之后判定立刻生效；宿主那一条安装调用在
// `createWorkspaceLifecycle` 里，桌面端启动路径必然经过。

import { request } from './bridge.ts'
import { EXTERNAL_LINK_LABELS, browseWithTrustCheck, type ExternalLinkChoice, type TrustedPathEntry } from './trustedProjects.ts'

/** 那一句问话（`externalLinkPrompt` 的产物 + 被问的那条 URL）：宿主用它渲染 `mode="link"` 的弹框。 */
export type ExternalLinkPromptRequest = {
  url: string
  message: string
  labels: typeof EXTERNAL_LINK_LABELS
  focused: ExternalLinkChoice
}

/** 宿主安装的那一组依赖（与 `browseWithTrustCheck` 的 deps 同形，只是 `open` 可省）。 */
export interface ExternalLinkGate {
  /** 当前项目根：`null`/空 = 没开项目 ⇒ 上游 `canBrowse` 的 `project == null` 那一档，直接放行（`BrowserLauncherImpl.kt:60-62`）。 */
  root: () => string | undefined | null
  /** 现在这份信任清单（持久 + 会话）。 */
  entries: () => readonly TrustedPathEntry[]
  /** 弹那三颗按钮（Open / Trust Project and Open / Cancel），拿回答。 */
  ask: (prompt: ExternalLinkPromptRequest) => Promise<ExternalLinkChoice>
  /** 清单变了才写回（答「信任项目并打开」那一路，`BrowserLauncherImpl.kt:84`）。 */
  save: (entries: TrustedPathEntry[]) => unknown
  /** 真的开那一步。省掉 = 宿主的系统默认出口 `shell.openUrl`；指定浏览器那条通道到位后由宿主换成它（接线请求 R5）。 */
  open?: (url: string) => unknown
}

let gate: ExternalLinkGate | null = null

/** 装配处安装/卸下门禁（重复安装以最后一次为准：宿主只有一个 `createWorkspaceLifecycle`）。 */
export function installExternalLinkGate(next: ExternalLinkGate | null): void {
  gate = next
}

/** 判定到底装没装（判据用它证明「接上了」而不是「恒为真」）。 */
export function externalLinkGateInstalled(): boolean {
  return gate !== null
}

/** 宿主那条系统默认出口（`native/file_queries.cpp:236-239` → `native/workspace.cpp` 的 `open_external`）。 */
async function openViaHost(url: string): Promise<void> {
  await request('shell.openUrl', { url })
}

/**
 * 打开一条外部链接：装了门禁就先过 `browseWithTrustCheck`（已信任不问、未信任问那一句、
 * 答「信任项目并打开」才写清单），没装就保持接线前的行为。
 * `open` 只换**最后那一步的运输**（`src/quickDocHost.ts` 用它保住注入的 `request` 替身；
 * 宿主以后换成 `shell.openUrlWithBrowser` 也是这一格）—— 判定永远只有门禁那一条，
 * 调用方换不掉它。返回 `'canceled'` = 用户答了取消，调用方不必再报错（上游 `:85` 也是安静不开）。
 */
export async function openExternalUrl(url: string, open?: (url: string) => unknown): Promise<'opened' | 'canceled'> {
  const transport = open ?? gate?.open ?? openViaHost
  const current = gate
  if (!current) { await transport(url); return 'opened' }
  return browseWithTrustCheck(url, {
    root: current.root, entries: current.entries, ask: current.ask, save: current.save, open: transport,
  })
}
