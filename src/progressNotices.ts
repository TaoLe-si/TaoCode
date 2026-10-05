// 把**正在跑的后台进度**写进右下角的「通知」列表（语言服务的 `$/progress` 与 Gradle 同步）。
//
// 为什么单开一个模块：这两条通道的状态各自在 `lspProgress.ts` / `gradleEvents.ts` 里，
// 而"要不要在消息窗口留一行、什么时候把它从进度收成结论"是第三个决定 —— 挂在任何一边都会
// 让那一层依赖另一层。这里只做"状态 → 通知行"的映射，不碰组件。
// 分工：**一个 displayId 只有一个主人**。Gradle 那一行由 `gradleHost.ts` 写（同步的起止都在它手里），
// 语言服务那些行由本模块的 watcher 写（进度表是 bridge 喂的，宿主那边没有别的时机）。
//
// 对照源码：
//   · 语言服务：`LspServerNotificationsHandlerImpl.kt:257-328` 把 `$/progress` 变成一条**带 fraction
//     的后台任务**（任务名 = `LspBundle.properties:32` `progress.title.progress={0}: progress`），
//     `end` 那拍整条任务消失。
//   · 外部系统：`ExternalSystemTaskProgressIndicatorUpdater.kt` —— `total <= 0` 时
//     `setIndeterminate(true)`，文字是 description + `(progress / total)`。我们这条是 CLI 通道，
//     拿不到 Tooling API 的 progress/total，所以**如实只写"进行中"+ 最新一行输出**，不编百分比。
//   · 消息窗口：IDEA 里一条通知是**同一个对象被反复刷新**（不是每拍重发一条），
//     所以这里走 `upsertNotice`（见 src/notices.ts 里它与 `pushNotice` 的分工）。
import { watch } from 'vue'
import { gradleOutputTail } from './gradle.ts'
import { elapsedLabel } from './progressPanel.ts'
import { lspProgressInterrupted, lspProgressTasks, lspServerMessages, runningLspTasks } from './lspProgress.ts'
import {
  exportLspLogText, logLspProgress, logLspServerMessage, logLspServerStopped, lspLogEntries,
  lspLogSummary, lspLogTail,
} from './lspServerLog.ts'
import { copyToClipboard } from './clipboard.ts'
import type { NoticeEntry } from './notices'

/** 通知列表的写入端口（`notifications.ts` 的 `notifyProgress`）。 */
export type NotifyProgress = (entry: Omit<NoticeEntry, 'id' | 'at'>) => void

/** Gradle 那一行的稳定 displayId（进度与结论共用，跑完是**原地**从进度变成结论）。 */
export const GRADLE_NOTICE_ID = 'gradle:sync'
export function lspNoticeId(language: string, token: string): string { return `lsp:progress:${language}:${token}` }

/** 一条语言服务进度 → 通知行（percent < 0 = 服务器没给百分比 ⇒ 只标"进行中"）。 */
export function lspNoticeOf(task: { language: string; token: string; title: string; details: string; percent: number }): Omit<NoticeEntry, 'id' | 'at'> {
  return {
    message: task.title,
    error: false,
    detail: [task.details].filter(Boolean),
    displayId: lspNoticeId(task.language, task.token),
    percent: task.percent >= 0 ? task.percent : null,
  }
}

/** `end` 那一拍的结论行（沿用同一个 displayId，位置不动）。 */
export function lspFinishedNoticeOf(task: { language: string; token: string; title: string }): Omit<NoticeEntry, 'id' | 'at'> {
  return { message: `${task.title} 已完成`, error: false, displayId: lspNoticeId(task.language, task.token), percent: 100 }
}

/**
 * 服务器停了导致的那条结束行：它**没有**收到 `end`，所以不能写成"已完成"。
 * 上游对这种情形是直接 `cancelAllProgress()` 把行收掉（:331-339），我们把"停止"这件事留在记录里，
 * 但不谎报完成度（percent 不给数字）。
 */
export function lspInterruptedNoticeOf(task: { language: string; token: string; title: string }): Omit<NoticeEntry, 'id' | 'at'> {
  return { message: `${task.title}：语言服务已停止`, error: false, displayId: lspNoticeId(task.language, task.token), percent: null }
}

/**
 * 语言服务**日志**那一行（一个语言一条，`displayId` 稳定 ⇒ 原地刷新；动作「复制日志」）。
 * 它不是进度：`percent` 缺省（不发进度条），`detail` 是日志尾部。
 * 这是「语言服务输出」在本仓的呈现面（上游是 Services 里的 `LspClientConsole`）。
 */
export function lspLogNoticeOf(language: string): Omit<NoticeEntry, 'id' | 'at'> {
  const entries = lspLogEntries.value
  return {
    message: lspLogSummary(entries, language),
    error: entries.some(entry => entry.language === language && entry.level === 1),
    detail: lspLogTail(entries, language, 8),
    displayId: `lsp:log:${language}`,
    actions: [{ label: '复制日志', run: () => { void copyToClipboard(exportLspLogText(entries, { language })) } }],
  }
}

/** Gradle 同步进行中那一行。 */
export function gradleRunningNoticeOf(startedAt: number, output: string, command: string, now: number): Omit<NoticeEntry, 'id' | 'at'> {
  const tail = gradleOutputTail(output, 1)[0] ?? ''
  return {
    message: '正在同步 Gradle 项目',
    error: false,
    detail: [elapsedLabel(startedAt, now), tail || command].filter(Boolean),
    displayId: GRADLE_NOTICE_ID,
    percent: null,
  }
}

/** Gradle 同步结束那一行：进度收成结论（失败时没有百分比可显示，只留错误标记）。 */
export function gradleFinishedNoticeOf(error: string, seconds: number, label = 'Gradle 同步'): Omit<NoticeEntry, 'id' | 'at'> {
  return {
    message: error ? `${label}失败：${error}` : `${label}完成（用时 ${seconds} 秒）`,
    error: Boolean(error),
    displayId: GRADLE_NOTICE_ID,
    percent: error ? null : 100,
  }
}

/**
 * 语言服务进度 → 消息窗口。表里有的行就地刷新；上一拍见过、这一拍消失的那个 token
 * 补一条"已完成"的结论（`end` 那拍任务会被删掉，所以要自己留着上一次的形状）。
 *
 * 同一批事件也写进 `src/lspServerLog.ts` 的日志（上游 `LanguageServiceLogger` 的等价物）：
 * 服务器消息/进度起止/停机各记一行；服务停止或报错时在消息窗口再挂一行**该语言的日志通知**
 * （detail = 日志尾部、动作 = 复制日志）—— 这就是本仓的「语言服务输出」呈现面
 * （IDEA 的 Services 输出窗口要改 App.vue 的工具窗口装配，本批冻结）。
 */
export function wireLspProgressNotices(notifyProgress: NotifyProgress) {
  // 服务器自己发的消息（`window/showMessage`）：一条一行，错误/警告标成错误样式。
  watch(() => lspServerMessages.length, () => {
    for (const message of lspServerMessages.splice(0, lspServerMessages.length)) {
      logLspServerMessage(message)
      notifyProgress({
        message: message.message,
        error: message.severity <= 2,
        detail: [`来自 ${message.language || '语言服务'}`],
        displayId: `lsp:message:${message.language}`,
      })
      // 错误/警告把日志行一并留在消息窗口（`LspServerNotificationsHandlerImpl` 的 showMessage
      // 只给消息本身；日志尾部让用户能看见这条消息之前服务器都说了什么）。
      if (message.severity <= 2) notifyProgress(lspLogNoticeOf(message.language))
    }
  })
  let previous = new Map(Object.entries(lspProgressTasks).map(entry => [entry[0], entry[1]]))
  watch(() => `${Object.keys(lspProgressTasks).join('|')}#${lspProgressInterrupted.length}`, () => {
    const current = new Map(runningLspTasks(lspProgressTasks).map(task => [task.key, task]))
    for (const task of current.values()) {
      if (!previous.has(task.key)) logLspProgress('begin', task)
      notifyProgress(lspNoticeOf(task))
    }
    // 停机的那批由 bridge 放进中断列表（它才知道"不会再有 end 了"），这里读走并给出对的措辞。
    const interrupted = new Map(lspProgressInterrupted.splice(0, lspProgressInterrupted.length).map(task => [task.key, task]))
    for (const task of interrupted.values()) {
      logLspServerStopped(task)
      notifyProgress(lspInterruptedNoticeOf(task))
      notifyProgress(lspLogNoticeOf(task.language))
    }
    for (const [key, task] of previous) {
      if (current.has(key) || interrupted.has(key)) continue
      logLspProgress('end', task)
      notifyProgress(lspFinishedNoticeOf(task))
    }
    previous = current
  })
}
