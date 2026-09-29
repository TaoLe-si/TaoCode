// 状态栏**中间那段文字**（IDEA `StatusBar.Info` 通道）与进程结束播报的判据。
//
// 上游逐条核过的出处：
//   · `ide-core/.../StatusBar.kt:34-49` `StatusBar.Info.set(text, project, requestor)` → `StatusBarInfo.TOPIC`。
//   · `ide-core/.../StatusBarInfo.java:12-20` 接口三个方法（`setInfo(s)` / `setInfo(s, requestor)` / `getInfo()`）。
//   · `InfoAndProgressPanel.kt:439-451` `setText`：空文字只有来自当前说话人或通知通道才被接受；
//     返回值 = 是否由通知托管，`currentRequestor` 据此更新（`:448`）。
//   · `StatusPanel.java:168-213` `updateText`：托管时显示通知文字，`myDirty || >= 60_000` 追加时间后缀，
//     每 30_000ms 重算（`:190-201`）；否则显示通道文字并把 `myDirty` 置 true（`:203-209`）。
//   · `ProcessTerminatedListener.java:45-49/59-66/75-93`：文案 `IdeCoreBundle.properties:131`，
//     前后各一个换行，控制台一行 + `StatusBar.Info.set` 一条；`stringifyExitCode` 的 Windows
//     失败码区间与 Unix 信号反查。
//   · `platform/eel/src/com/intellij/platform/eel/UnixSignal.kt:18-45/55`：信号表与 `EXIT_CODE_OFFSET = 128`。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acceptStatusText, noticeStatusText, relativeStamp, statusBarDisplay, EVENT_REQUESTOR,
  IDLE_TEXT, TIME_SUFFIX_AFTER,
} from '../src/statusBarText.ts'
import {
  EXIT_CODE_OFFSET, PROCESS_FINISHED_TEMPLATE, processFinishedConsoleText, processFinishedText,
  STATUS_CONTROL_C_EXIT, stringifyExitCode, WINDOWS_ERROR_CODE_MAX, WINDOWS_ERROR_CODE_MIN,
} from '../src/processTerminated.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')
const notice = (message, stamp) => ({ message, stamp })

test('空文字只有来自当前说话人或通知通道才被接受（InfoAndProgressPanel.setText :439-451）', () => {
  // 别的来源发空串 → 忽略（undefined = 文字与说话人都不动）
  assert.equal(acceptStatusText('', 'someone', null), undefined)
  assert.equal(acceptStatusText(null, 'someone', 'other'), undefined)
  // 当前说话人自己清场 → 接受
  assert.equal(acceptStatusText('', 'me', 'me'), 'me')
  // 通知通道随时可以清场（它托管着这段文字）
  assert.equal(acceptStatusText('', EVENT_REQUESTOR, 'me'), EVENT_REQUESTOR)
  // 非空文字一律接受，并夺走"说话人"身份
  assert.equal(acceptStatusText('构建中', 'me', null), 'me')
})

test('通知托管时才带时间后缀，且首次出现必带（StatusPanel.java:190）', () => {
  const now = 1_700_000_600_000
  // 刚出现的通知（stamp 就在此刻）：needsStamp=true → 带后缀
  assert.equal(noticeStatusText(notice('已提交', now), now, true), '已提交 (刚刚)')
  // 已过 60 秒：即使不是首次也带
  assert.equal(noticeStatusText(notice('已提交', now - TIME_SUFFIX_AFTER), now, false), '已提交 (1 分钟前)')
  // 60 秒内且不是首次：不带后缀
  assert.equal(noticeStatusText(notice('已提交', now - 1000), now, false), '已提交')
})

test('时间后缀的粒度（formatPrettyDateTime 的对应物）', () => {
  const now = 10_000_000_000
  assert.equal(relativeStamp(now - 5_000, now), '刚刚')
  assert.equal(relativeStamp(now - 60_000, now), '1 分钟前')
  assert.equal(relativeStamp(now - 3 * 3600_000, now), '3 小时前')
  assert.equal(relativeStamp(now - 2 * 86_400_000, now), '2 天前')
})

test('通道有话说时显示通道文字；通道静默且有通知时由通知托管（StatusPanel.updateText）', () => {
  const now = 5_000_000
  // 通道说话 → 显示通道文字，不是托管
  const talking = statusBarDisplay({ text: '正在索引…', notice: notice('通知', now), now, dirty: true })
  assert.deepEqual(talking, { text: '正在索引…', managed: false, timeText: null })
  // 通道静默 + 有通知 → 托管，时间后缀单独拿出来（上游 myTimeText）
  const managed = statusBarDisplay({ text: '', notice: notice('已提交', now), now, dirty: true })
  assert.equal(managed.managed, true)
  assert.equal(managed.text, '已提交 (刚刚)')
  assert.equal(managed.timeText, ' (刚刚)')
  // 通道静默 + 没通知 → 空（调用方退回"就绪"）
  const quiet = statusBarDisplay({ text: null, notice: null, now, dirty: true })
  assert.deepEqual(quiet, { text: '', managed: false, timeText: null })
})

test('stringifyExitCode：Windows 失败码区间与 Ctrl+C（ProcessTerminatedListener.java:75-93）', () => {
  // 0xC000013A 是 STATUS_CONTROL_C_EXIT，追加十六进制与 Ctrl+C 说明
  assert.equal(stringifyExitCode(STATUS_CONTROL_C_EXIT, 'windows'), '3221225786 (0xC000013A): interrupted by Ctrl+C')
  // 区间内其它码：只加十六进制
  assert.equal(stringifyExitCode(0xC0000005, 'windows'), '3221225477 (0xC0000005)')
  // 正常退出码原样
  assert.equal(stringifyExitCode(0, 'windows'), '0')
  assert.equal(stringifyExitCode(1, 'windows'), '1')
  // 区间边界：上界不算（`< 0xD0000000`）
  assert.equal(stringifyExitCode(WINDOWS_ERROR_CODE_MIN, 'windows'), '3221225472 (0xC0000000)')
  assert.equal(stringifyExitCode(WINDOWS_ERROR_CODE_MAX, 'windows'), String(WINDOWS_ERROR_CODE_MAX))
})

test('stringifyExitCode：Unix 按信号表反查（128 + 信号号）', () => {
  // shell 用 128 + 信号号：143 = SIGTERM(15)
  assert.equal(stringifyExitCode(EXIT_CODE_OFFSET + 15, 'unix'), '143 (interrupted by signal 15:SIGTERM)')
  // 137 = SIGKILL(9)
  assert.equal(stringifyExitCode(EXIT_CODE_OFFSET + 9, 'unix'), '137 (interrupted by signal 9:SIGKILL)')
  // BSD 的号不同：SIGBUS = BSD 10 / Linux 7
  assert.equal(stringifyExitCode(EXIT_CODE_OFFSET + 10, 'unix', true), '138 (interrupted by signal 10:SIGBUS)')
  assert.equal(stringifyExitCode(EXIT_CODE_OFFSET + 7, 'unix', false), '135 (interrupted by signal 7:SIGBUS)')
  // 反查不到就原样（不是所有退出码都是信号）
  assert.equal(stringifyExitCode(2, 'unix'), '2')
})

test('进程结束文案：模板与前后换行（IdeCoreBundle.properties:131 + :45-49）', () => {
  assert.equal(PROCESS_FINISHED_TEMPLATE, '进程已结束，退出码 {0}')
  assert.equal(processFinishedText(0, 'windows'), '进程已结束，退出码 0')
  // 控制台那一行前后各一个换行
  assert.equal(processFinishedConsoleText(0, 'windows'), '\n进程已结束，退出码 0\n')
})

test('接线：文字通道接进状态栏、运行结束播报、通知托管与清场', () => {
  const app = read('src/App.vue')
  // 此前是硬编码的 working ? '正在处理…' : '就绪'，现在走通道
  assert.match(app, /<span>\{\{ statusLabel\(working\) \}\}<\/span>/, '状态栏中段没走通道')
  assert.match(app, /import \{ statusLabel \} from '\.\/statusBarText'/, '没引入通道')

  // 播报落在 handleRunExit 里（桥接只转发，不塞业务）：整条链结束时才写，aborted 不写。
  const runs = read('src/runInstances.ts')
  assert.match(runs, /import \{ runExitAnnouncement \} from '\.\/processTerminated\.ts'/, '运行结束没接播报')
  assert.match(runs, /runExitAnnouncement\(\{ code: data\.code, remaining, aborted: data\.aborted \}\)/,
    '播报没带 remaining/aborted')
  // 控制台那条是**独立**的一条文字（上游 `notifyTextAvailable` 一次调用），不并进解码残留里
  assert.match(runs, /if \(tail\) push\(tail\)[\s\S]{0,40}if \(finished !== null\) push\(finished\)/,
    '控制台那半边没写')

  const notifications = read('src/notifications.ts')
  assert.match(notifications, /setNoticeStatus\(\{ message, stamp: Date\.now\(\) \}\)/, '通知没进状态栏')
  assert.match(notifications, /if \(!noticeLog\.value\.length\) \{ noticeOpen\.value = false; clearNoticeStatus\(\) \}/,
    '通知清空后没把状态栏交回通道')
})

test('上游 idleness：通道文字不会把忙态吞掉（IDLE_TEXT 是唯一哨兵）', () => {
  // 这条判据锁住 App.vue 那个 computed 的前提：通道的"没有话说"必须是 IDLE_TEXT 这一个值，
  // 否则 statusBarLabel 无法区分"通道静默"与"通道说了和兜底一样的话"。
  assert.equal(IDLE_TEXT, '就绪')
  assert.match(read('src/statusBarText.ts'), /export const IDLE_TEXT = '就绪'/)
})
