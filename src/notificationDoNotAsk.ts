// 「不再显示」与「明天提醒我」—— 上游 `DoNotAskManager`（`platform/ide-core/src/
// com/intellij/notification/DoNotAskManager.kt:10-18`）与 `RemindLaterManager`
// （`platform/platform-impl/src/com/intellij/notification/impl/RemindLaterManager.kt`）
// 的等价物。这两条都是通知中心里那个 ⋮ 菜单的真实条目
// （`NotificationsPanel.kt:1106-1143`：设置… / 明天提醒我 / 不再为此项目显示 / 不再显示）。
//
// 上游的分工：
//   · 不再显示分**应用级**（`DoNotAskAppManager`，project == null）与**项目级**
//     （`DoNotAskProjectManager`，project != null）两张表，判定是"项目级 或 应用级"
//     —— `Notification.isDoNotAskFor:465-467`；命中后 `canShowFor:193-202` 返回 false，
//     通知根本不会被发出（不是发了再藏起来）。
//   · 明天提醒我只对 **suggestion 类型**、且**没有动作/监听/contextHelp** 的通知提供
//     （`RemindLaterManager.kt:37-40` 直接返回 null），延迟固定 1 天
//     （`NotificationsPanel.kt:1119` 的 `1.days`），到点把同一条通知重新 notify 一次。
//
// 存储沿用应用级用户数据的既有口径（`src/todoFilters.ts` / `src/analysisIgnore.ts` 同族）：
// `localStorage`；项目级按工作区根分键。本仓没有 notification.remind.later.xml 那种
// roaming 存储，也没有应用级设置页去改它 —— 存哪、上限多少，逐条写在下面的常数里。

import { configureDoNotAskOption, noticeGroupId } from './notificationGroups.ts'
import type { NoticeEntry } from './notices.ts'

/** localStorage 的最小面（node --test 与隐私模式下传 null / 假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

const APP_KEY = 'taocode.doNotAsk'
/** 项目级那张表按工作区根分键，与 `src/analysisScope.ts` 同一族做法。 */
const projectKey = (root: string) => `${APP_KEY}:${root}`
const REMIND_LATER_KEY = 'taocode.remindLater'

/** 上限：够记住自己按掉的几条通知，又不至于把 localStorage 塞爆（同 `src/debugWatches.ts`）。 */
export const MAX_DO_NOT_ASK = 100
export const MAX_REMIND_LATER = 50

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function readMap(target: Store, key: string): Record<string, string> {
  try {
    const raw = target?.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    // 存坏了一半（手改过、别的标签页写坏）就只认字符串值的那几条，不整份丢掉。
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name !== 'string') continue
      if (Object.keys(out).length >= MAX_DO_NOT_ASK) break
      out[id] = name
    }
    return out
  } catch { return {} }
}

function writeMap(target: Store, key: string, value: Record<string, string>) {
  try { target?.setItem(key, JSON.stringify(value)) } catch { /* 存不下只影响跨会话的抑制 */ }
}

/**
 * 上游 `getDoNotAskNotifications(): Map<String, String>`（`DoNotAskManager.kt:17`）：
 * id → 显示名。项目级与应用级合成一张（项目级的条目排在前面，同名以项目级为准）。
 */
export function doNotAskNotifications(root = '', store?: Store): Map<string, string> {
  const target = storage(store)
  const merged = new Map<string, string>()
  for (const [id, name] of Object.entries(readMap(target, APP_KEY))) merged.set(id, name)
  if (root) for (const [id, name] of Object.entries(readMap(target, projectKey(root)))) merged.set(id, name)
  return merged
}

/**
 * 那张表**分层**的样子 —— 上游设置页读的就是这个形状
 * （`platform/platform-impl/src/com/intellij/notification/impl/ui/DoNotAskConfigurableUi.kt`）：
 *   · `:33-51` 先应用级（`forProject = false`）再项目级（`forProject = true`），然后 **按 id 排序**；
 *   · `:28` 项目级那条在显示名后面追加 `「 (<notifications.configurable.do.not.ask.project.title>)」`
 *     （中文包该 key = `本项目`，`IdeBundle.properties:1351` 的英文取值是 `This Project`）；
 *   · `:67` 工具条只有**移除**一个动作（`:100-113` 按层调 `clearDoNotAsk(id)`），没有新增、没有上下移动。
 */
export interface DoNotAskInfo { id: string; name: string; forProject: boolean }

export function doNotAskInfos(root = '', store?: Store): DoNotAskInfo[] {
  const target = storage(store)
  const rows: DoNotAskInfo[] = []
  for (const [id, name] of Object.entries(readMap(target, APP_KEY))) rows.push({ id, name, forProject: false })
  if (root) for (const [id, name] of Object.entries(readMap(target, projectKey(root)))) rows.push({ id, name, forProject: true })
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 列表右侧那句后缀（`DoNotAskConfigurableUi.kt:28` 的 `it.name + " (${projectTitle})"`）。 */
export function doNotAskDisplayName(info: DoNotAskInfo, projectTitle = DO_NOT_ASK_PROJECT_TITLE): string {
  return info.forProject ? `${info.name} (${projectTitle})` : info.name
}

/** `IdeBundle.properties`（中文包取值）：`notifications.configurable.do.not.ask.title` =1349、
 *  `.list.accessible.name` =1350、`.project.title` =1351、`…no.notifications.configured` =1342。 */
export const DO_NOT_ASK_LIST_TITLE = '不再询问通知:'
export const DO_NOT_ASK_LIST_ACCESSIBLE_NAME = '不再询问通知'
export const DO_NOT_ASK_PROJECT_TITLE = '此项目'
export const DO_NOT_ASK_EMPTY = '未配置通知'

/**
 * 清单里移除一条 = **解除抑制**（上游 `apply()`：按那条来自哪一层调那一层的
 * `clearDoNotAsk(id)`，`:103-110`）。存下这条的名字给调用方回显用。
 */
export function clearDoNotAskInfo(info: DoNotAskInfo, root = '', store?: Store): void {
  const target = storage(store)
  if (info.forProject && root) {
    const map = readMap(target, projectKey(root))
    if (map[info.id] !== undefined) { delete map[info.id]; writeMap(target, projectKey(root), map); return }
  }
  const appMap = readMap(target, APP_KEY)
  if (appMap[info.id] === undefined) return
  delete appMap[info.id]
  writeMap(target, APP_KEY, appMap)
}

/** `Notification.isDoNotAskFor:465-467`：项目级命中或应用级命中都算。 */
export function isDoNotAskFor(id: string, root = '', store?: Store): boolean {
  if (!id) return false
  const target = storage(store)
  return (root ? readMap(target, projectKey(root)) : {} )[id] !== undefined || readMap(target, APP_KEY)[id] !== undefined
}

/**
 * `Notification.setDoNotAskFor(project)`（`Notification.java:453-461`）：
 * `forProject` 传 true 写项目级那张表，传 false / 不传写应用级。显示名随表一起存
 * （上游 `markDoNotAsk(id, displayName)` 的第二个参数）。
 */
export function markDoNotAsk(id: string, displayName: string, forProject = false, root = '', store?: Store): void {
  if (!id) return
  const target = storage(store)
  const key = forProject && root ? projectKey(root) : APP_KEY
  const map = { ...readMap(target, key), [id]: displayName || id }
  // 上限之外丢最旧的（Map 的插入序 = 写入序）。
  while (Object.keys(map).length > MAX_DO_NOT_ASK) delete map[Object.keys(map)[0] as string]
  writeMap(target, key, map)
}

/** `clearDoNotAsk(id)`：两张表里都清掉（上游没有"只清一层"这个操作）。 */
export function clearDoNotAsk(id: string, root = '', store?: Store): void {
  const target = storage(store)
  for (const key of [APP_KEY, ...(root ? [projectKey(root)] : [])]) {
    const map = readMap(target, key)
    if (map[id] === undefined) continue
    delete map[id]
    writeMap(target, key, map)
  }
}

/** 清空这个项目（与应用级）的全部抑制项。 */
export function clearAllDoNotAsk(root = '', store?: Store): void {
  const target = storage(store)
  try { target?.removeItem(APP_KEY); if (root) target?.removeItem(projectKey(root)) } catch { /* 同上 */ }
}

/**
 * 一条通知该被抑制吗（`Notification.canShowFor:193-202`，它才是"根本不发出"的判定点）。
 * 抑制表里没有这一条 ⇒ 照旧。
 */
export function canShowNotice(entry: Pick<NoticeEntry, 'displayId' | 'message'>, root = '', store?: Store): boolean {
  const option = configureDoNotAskOption(entry, noticeGroupId(entry))
  return option ? !isDoNotAskFor(option.id, root, store) : true
}

// --- 「明天提醒我」（RemindLaterManager）------------------------------------------------------

/** `NotificationsPanel.kt:1119` 的 `1.days`。 */
export const REMIND_LATER_DELAY_MS = 24 * 60 * 60 * 1000

/** 存下来的一条"明天再提醒我"（字段照 `RemindLaterManager.createElement:78-113` 的属性）。 */
export interface RemindLaterRecord {
  /** 到点时间（epoch 毫秒，`element.getAttribute("time")`）。 */
  time: number
  message: string
  error: boolean
  detail?: string[]
  displayId?: string
  /** `isSuggestionType` —— 只有这一类通知才会拿到「明天提醒我」这个条目。 */
  suggestion: boolean
}

/**
 * 这条通知能不能"明天提醒我"（`RemindLaterManager.kt:35-41`）：suggestion 类型，
 * 且没有动作按钮 —— 带动作的提醒点下去会丢状态，上游干脆不给这个条目。
 */
export function canRemindLater(entry: Pick<NoticeEntry, 'message' | 'error' | 'detail' | 'displayId' | 'actions'>, suggestion = false): boolean {
  return suggestion && !entry.actions?.length
}

function readRemindLater(store?: Store): RemindLaterRecord[] {
  const target = storage(store)
  try {
    const raw = target?.getItem(REMIND_LATER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && typeof item === 'object' && typeof item.message === 'string' && Number.isFinite(item.time))
      .slice(0, MAX_REMIND_LATER) as RemindLaterRecord[]
  } catch { return [] }
}

function writeRemindLater(records: readonly RemindLaterRecord[], store?: Store) {
  const target = storage(store)
  try { target?.setItem(REMIND_LATER_KEY, JSON.stringify(records.slice(0, MAX_REMIND_LATER))) }
  catch { /* 存不下就只剩本次会话 */ }
}

/**
 * 排一条"明天提醒我"。`now` 注入是为了让判据能在 node 里跑。
 * 返回存下来的那一条（同 displayId 的旧排期被替换，与通知本身的顶替规则同源）。
 */
export function scheduleRemindLater(
  entry: Pick<NoticeEntry, 'message' | 'error' | 'detail' | 'displayId'>, now: number, store?: Store,
): RemindLaterRecord {
  const record: RemindLaterRecord = {
    time: now + REMIND_LATER_DELAY_MS,
    message: entry.message,
    error: entry.error,
    detail: entry.detail ? [...entry.detail] : undefined,
    displayId: entry.displayId,
    suggestion: true,
  }
  const kept = readRemindLater(store).filter(item => item.displayId !== record.displayId || !record.displayId)
  writeRemindLater([...kept, record], store)
  // 上游 `addSimpleNotification:66` 那句 `schedule(element, delay)`：排完立刻重算定时器，
  // 不是等下次启动。
  reschedule()
  return record
}

/** 到点的记录（`initializeComponent:177-212` 启动时那一支：delay > 0 继续等，否则立刻 execute）。 */
export function dueRemindLater(now: number, store?: Store): RemindLaterRecord[] {
  return readRemindLater(store).filter(record => record.time <= now)
}

/** 还没到点的记录（面板上标"明天提醒"用）。 */
export function pendingRemindLater(now: number, store?: Store): RemindLaterRecord[] {
  return readRemindLater(store).filter(record => record.time > now)
}

/**
 * 到点的取走并从存储里删掉（`execute:120` 的 `rootElement.removeContent(element)`）。
 *
 * 只读一次：`readRemindLater` 每次 `JSON.parse` 都造**新对象**，所以"哪些要删"必须拿同一次读
 * 出来的那批引用来比 —— 原先这里读了两遍（一遍判到点、一遍写回），`includes` 恒为 false，
 * 记录永远删不掉：每次启动都把同一批"明天提醒我"重播一遍，接上运行中的到点调度之后
 * 更是变成死循环（本仓的判据 `tests/notification-remind-later.test.mjs` 第一条就是钉这个）。
 */
export function takeDueRemindLater(now: number, store?: Store): RemindLaterRecord[] {
  const all = readRemindLater(store)
  const due = all.filter(record => record.time <= now)
  if (!due.length) return []
  writeRemindLater(all.filter(record => !due.includes(record)), store)
  return due
}

// ── 运行中的到点调度（`RemindLaterManager.schedule`）─────────────────────────────────────
//
// 上游不是"重启时才补"：点下「明天提醒我」那一句就走 `addSimpleNotification:59-67`
// → `schedule(element, delay)`（`:115-117`，`AppExecutorUtil.getAppScheduledExecutorService()`），
// 应用一直开着的话到点照样弹；启动时 `initializeComponent:177-212` 再把存着的每条走一遍
// —— `delay > 0` 继续等，`delay <= 0` 立刻 `execute`。
// 本仓之前只有后一半（`notifications.ts` 启动时 `takeDueRemindLater`），
// 于是"明天提醒我"在本次运行里永远不会响 —— 这一节补的就是那半条链。

/** 宿主注册的"重排"回调（上游 service 自己持有 executor；本仓由 `notifications.ts` 注册进来）。 */
let rearm: (() => void) | null = null

/** `notifications.ts` 用它把重排动作交回本模块；返回的取消函数由宿主卸载时调用。 */
export function registerRemindLaterRearm(run: (() => void) | null): void {
  rearm = run
}

/** 新排一条之后重算定时器（`addSimpleNotification:66` 的那一句 `schedule(element, delay)`）。 */
function reschedule(): void { rearm?.() }

export interface RemindLaterAlarm {
  /** 到点的那几条要干什么（上游 `execute:119-171`：把同一条通知重新 notify 一遍）。 */
  onDue: (records: RemindLaterRecord[]) => void
  /** 时钟与定时器（判据注入替身）；默认 `Date.now` + `setTimeout`。 */
  now?: () => number
  schedule?: (run: () => void, delayMs: number) => (() => void) | null
  store?: Store
}

/**
 * 装上到点调度：先补到点的（启动那一拍），再把最早一条未到的定时排上；
 * 每次触发后重算（一次到点可能有好几条）。宿主注册进来的"重排"回调会在
 * 新排一条时被叫到（`scheduleRemindLater` 那一句）。返回撤掉定时 + 注销回调的函数。
 */
export function armRemindLater(alarm: RemindLaterAlarm): () => void {
  const now = alarm.now ?? (() => Date.now())
  const schedule = alarm.schedule ?? ((run, delayMs) => {
    const timer = setTimeout(run, delayMs)
    return () => clearTimeout(timer)
  })
  let cancelPending: (() => void) | null = null
  function step(): void {
    if (cancelPending !== null) { cancelPending(); cancelPending = null }
    const at = now()
    const due = takeDueRemindLater(at, alarm.store)
    // 一次到点可能有好几条：`takeDueRemindLater` 把发掉的直接从存储摘走，
    // 所以这一拍之后就只剩未到点的（上游 `execute` 也是一条一次，但它是遍历存的记录）。
    if (due.length) alarm.onDue(due)
    const pending = pendingRemindLater(now(), alarm.store)
    if (!pending.length) return
    const earliest = pending.reduce((best, record) => Math.min(best, record.time), Number.POSITIVE_INFINITY)
    cancelPending = schedule(step, Math.max(0, earliest - now())) ?? null
  }
  step()
  registerRemindLaterRearm(step)
  return () => {
    registerRemindLaterRearm(null)
    if (cancelPending !== null) { cancelPending(); cancelPending = null }
  }
}
