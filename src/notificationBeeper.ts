// 通知提示音 —— `pv/notification` 族里 `NotificationsBeeper` 那一条的等价物。
//
// 上游那一拍全文只有三行（`platform/platform-impl/src/com/intellij/notification/impl/
// NotificationsBeeper.kt:12-16`）：
//
//     override fun notify(notification: Notification) {
//       if (isSoundEnabled() && NotificationsConfigurationImpl.getSettings(
//             notification.groupId).isPlaySound) {
//         Toolkit.getDefaultToolkit().beep()
//       }
//     }
//
// 读出来的三件事在本仓各有落点，别混成一条：
//
//   · `isSoundEnabled()`（`NotificationSettings.kt:75`）在上游是个恒为 true 的内部函数，
//     本仓没有"静音整个应用"这一层，于是照旧恒为真 —— 但它**不是**开关本身，真正的
//     开关是下面那个按组的。
//   · `isPlaySound` 是**按通知组**的设置，**默认 false**（`NotificationSettings.kt:30`
//     的 `var isPlaySound: Boolean = false`），序列化时只在打开的情况下落一个
//     `playSound="true"` 属性（`:46`）—— 也就是说"关"是不写、不是写 false。
//     存储口径见下面 `writeFlags`。
//   · 未在设置里注册过的组拿不到 settings（`NotificationsPanel.kt:1109` 的
//     `isRegistered(notification.groupId)` 就是在判这件事），所以**未分组**的通知
//     一律不响；`shouldPlaySound` 里那道 `notificationGroup(id)` 就是这个门。
//
// 声音本身：上游 `Toolkit.getDefaultToolkit().beep()` 走的是 AWT 的系统提示音，浏览器与
// WebView2 都没有对应 API，所以本仓用 Web Audio 合成一声等价的短音（见 `defaultTone`）。
// 合成不出来（没有 Web Audio / 自动播放策略把 context 挡在 suspended）时**安静跳过**，
// 绝不抛错 —— 一条通知不该因为响不出声而把通知链打断。

import { notificationGroup, noticeGroupId } from './notificationGroups.ts'
import type { NoticeEntry } from './notices.ts'

/** localStorage 的最小面（node --test 与隐私模式下传 null / 假对象即可）。 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null

const PLAY_SOUND_KEY = 'taocode.notificationPlaySound'

/** 上限：注册项就那么几个（`src/notificationGroups.ts` 的表），留一档余量给将来新增的组。 */
export const MAX_SOUND_GROUPS = 64

// --- 存储（按组，默认关）-----------------------------------------------------------------

function storage(store?: Store): Store {
  if (store !== undefined) return store
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/**
 * 读出来的是「哪些组开着声音」那张表（`NotificationSettings.kt:46` 的语义：只有 true 被写下）。
 * 存坏了一半就只认布尔为 true 的那几条，不整份丢掉 —— 与 `src/notificationDoNotAsk.ts`
 * 的 `readMap` 同一族做法。
 */
function readFlags(target: Store): Record<string, true> {
  try {
    const raw = target?.getItem(PLAY_SOUND_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, true> = {}
    for (const [id, on] of Object.entries(parsed as Record<string, unknown>)) {
      if (on !== true) continue
      if (Object.keys(out).length >= MAX_SOUND_GROUPS) break
      out[id] = true
    }
    return out
  } catch { return {} }
}

function writeFlags(target: Store, flags: Record<string, true>) {
  // 关掉的组直接删键（`NotificationSettings.kt:44-46` 只在打开时写属性），
  // 不是留一条 false —— 这样那张表永远只回答"现在谁在响"。
  const kept = Object.keys(flags).slice(-MAX_SOUND_GROUPS)
  const out: Record<string, true> = {}
  for (const id of kept) if (flags[id] === true) out[id] = true
  try { target?.setItem(PLAY_SOUND_KEY, JSON.stringify(out)) } catch { /* 存不下就只剩本次会话 */ }
}

/**
 * `NotificationsConfigurationImpl.getSettings(groupId).isPlaySound`
 * （`NotificationsBeeper.kt:13` 的右半边）。**未注册的组返回 false**，与上游
 * `getSettings` 取不到 settings 时不能给声音同一形状。
 */
export function groupPlaysSound(groupId: string, store?: Store): boolean {
  if (!groupId || !notificationGroup(groupId)) return false
  return readFlags(storage(store))[groupId] === true
}

/** 设置页里那个「播放声音」复选框（`NotificationSettingsUi.kt:56-65`）点了之后写什么。 */
export function setGroupPlaysSound(groupId: string, on: boolean, store?: Store): void {
  if (!groupId || !notificationGroup(groupId)) return
  const target = storage(store)
  const flags = readFlags(target)
  if (on) flags[groupId] = true
  else delete flags[groupId]
  writeFlags(target, flags)
}

/** 开着声音的组（设置页列出复选框、面板上标出当前状态时用）。 */
export function soundEnabledGroups(store?: Store): string[] {
  return Object.keys(readFlags(storage(store)))
}

/**
 * 通知中心那一行 ⋮ 里的条目（`NotificationsPanel.kt:1109-1116` 那个「设置…」的位置：
 * 条件是**这个组注册过**，且它在提醒/不再显示那几条**之前**，中间还隔一条分隔线）。
 *
 * 上游那个条目开的是一个对话框；本仓没有通知设置页（`src/settingsTreeMeta.ts` 里没有
 * 这一节），所以这里直接把对话框里唯一与本模块相关的那一项 —— 播放声音 ——
 * 提到菜单里做成一个真开关。**不是假控件**：点完立刻落存储，`shouldPlaySound` 下一条
 * 就按新的判定响或不响。未分组的行不给这个条目（同上游 `isRegistered` 那道门）。
 */
export const GROUP_SOUND_ON_LABEL = '播放声音（本组）'
export const GROUP_SOUND_OFF_LABEL = '静音（本组）'

/** 那一行能不能拿到声音开关（= 这个组在设置里注册过）。 */
export function groupSoundToggleLabel(entry: Pick<NoticeEntry, 'displayId'>, store?: Store): string | undefined {
  const groupId = noticeGroupId(entry)
  if (!groupId || !notificationGroup(groupId)) return undefined
  return groupPlaysSound(groupId, store) ? GROUP_SOUND_OFF_LABEL : GROUP_SOUND_ON_LABEL
}

// --- 发声 -------------------------------------------------------------------------------

/** 一声的频率（Hz）。`Toolkit.beep()` 的音高由系统决定，跨不过来就取一个中值听感清楚的。 */
export const TONE_FREQUENCY_HZ = 880
/** 一声多长（毫秒）。两声之间留 `TONE_GAP_MS`。 */
export const TONE_BEEP_MS = 90
export const TONE_GAP_MS = 110
/** 两声 —— 系统提示音的惯例（同一个错误响两下比一下更醒目）。 */
export const TONE_BEEP_COUNT = 2
/** 包络的起振/落下各留这么多毫秒；满音量 `TONE_GAIN`。 */
export const TONE_ATTACK_MS = 8
export const TONE_GAIN = 0.18

/** 合成一段声音要用的最小 AudioContext 面（不依赖 DOM lib 的音频类型，node 里也能编过）。 */
interface ToneOscillator {
  frequency: { value: number }
  type: string
  connect(node: unknown): void
  start(at?: number): void
  stop(at?: number): void
}
interface ToneParam {
  value: number
  setValueAtTime(value: number, at: number): void
  linearRampToValueAtTime(value: number, at: number): void
}
interface ToneGain {
  gain: ToneParam
  connect(node: unknown): void
}
export interface ToneContext {
  readonly state: string
  readonly currentTime: number
  createOscillator(): ToneOscillator
  createGain(): ToneGain
  close(): unknown
}
type ToneContextCtor = new () => ToneContext

function audioContextCtor(): ToneContextCtor | undefined {
  const scope = globalThis as unknown as Record<string, unknown>
  const ctor = scope.AudioContext ?? scope.webkitAudioContext
  return typeof ctor === 'function' ? (ctor as ToneContextCtor) : undefined
}

/**
 * 默认发声：两声 880Hz 的短正弦，音量走一条 8ms 起 / 90ms 落的包络（直角波会很刺耳）。
 * 拿不到 AudioContext（node、隐私模式）或被自动播放策略挡着 ⇒ 安静返回。
 */
function defaultTone(): void {
  const Ctor = audioContextCtor()
  if (!Ctor) return
  let context: ToneContext | null = null
  try {
    context = new Ctor()
    const start = context.currentTime
    for (let index = 0; index < TONE_BEEP_COUNT; index += 1) {
      const at = start + index * (TONE_BEEP_MS + TONE_GAP_MS) / 1000
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = TONE_FREQUENCY_HZ
      // 包络：8ms 起到 TONE_GAIN，结束前 8ms 落回 0（直角波在起止处会「咔」一下）。
      gain.gain.value = 0
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(TONE_GAIN, at + TONE_ATTACK_MS / 1000)
      gain.gain.setValueAtTime(TONE_GAIN, at + (TONE_BEEP_MS - TONE_ATTACK_MS) / 1000)
      gain.gain.linearRampToValueAtTime(0, at + TONE_BEEP_MS / 1000)
      oscillator.connect(gain)
      gain.connect(context as unknown)
      oscillator.start(at)
      oscillator.stop(at + TONE_BEEP_MS / 1000)
    }
  } catch {
    // 没有 Web Audio / context 不可用 —— 通知照发，声音这一拍跳过。
  } finally {
    // 立即关掉省资源：两声总共不到 400ms，之后不再需要这个 context。
    try { context?.close() } catch { /* 关不掉就等 GC */ }
  }
}

/** 注入发声实现（node 判据与「静音这一组」的试听都走它）。传 null 回到默认合成。 */
let tone: (() => void) | null = null
export function setNotificationTone(factory: (() => void) | null): void { tone = factory }

/** 发一声（不带任何判定 —— 判定在 `playNotificationSound` 里）。 */
export function beep(): void {
  const factory = tone ?? defaultTone
  try { factory() } catch { /* 响不出声不该把通知链打断 */ }
}

/**
 * 这条通知该不该响（`NotificationsBeeper.kt:12-16` 整条判定）：组注册过 **且** 该组开着声音。
 * 返回 true 表示已经响过了，调用方不必再看返回值。
 */
export function playNotificationSound(
  entry: Pick<NoticeEntry, 'displayId'>, store?: Store,
): boolean {
  const groupId = noticeGroupId(entry)
  if (!groupId || !groupPlaysSound(groupId, store)) return false
  beep()
  return true
}
