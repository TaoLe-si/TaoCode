# 一次性脚本：把 App.vue 的「通知 + 状态栏键盘导航」域搬到 src/notifications.ts
# 区间 A = 925..997（通知日志/notify/状态栏遍历），B = 1098..1111（状态栏组件菜单/通知清空）。
# 中间夹着「状态栏工具窗口组件」（toolWindowsPopup 等），属于另一个域，原地留下。
import io

APP = r'D:\TaoCode\src\App.vue'
MOD = r'D:\TaoCode\src\notifications.ts'

text = io.open(APP, encoding='utf-8').read()
lines = text.split('\n')

a1 = next(i for i, l in enumerate(lines) if l.startswith('// IDEA keeps every notification in a log the status-bar widgets'))
b1 = next(i for i, l in enumerate(lines) if l.startswith("// --- IDEA's ToolWindowsWidget (status/ToolWindowsWidget.java:62-299)")) - 1
a2 = next(i for i, l in enumerate(lines) if l.startswith('const statusMenu = ref<{ x: number; y: number } | null>(null)'))
b2 = next(i for i, l in enumerate(lines) if l.startswith("// IDEA's \"Recent Places\" collects every place")) - 1

assert (a1 + 1, b1 + 1, a2 + 1, b2 + 1) == (926, 997, 1098, 1111), (a1 + 1, b1 + 1, a2 + 1, b2 + 1)
r1 = lines[a1:b1 + 1]
r2 = lines[a2:b2 + 1]
assert len(r1) == 72 and len(r2) == 14, (len(r1), len(r2))
assert 'function onStatusBarKeydown(' in '\n'.join(r1) and 'function closeFirstNotification()' in '\n'.join(r2)

ASSEMBLY = '''// 通知与状态栏键盘导航是一个域（IDEA 的通知中心 + IdeStatusBarImpl 的焦点遍历）。
const {
  noticeLog, noticeOpen, notify, notifyFromPanel, statusBarRef, statusWidgets, focusStatusBar,
  restoreFocusFromStatusBar, onStatusBarKeydown, statusMenu, openStatusMenu, clearNotices, closeFirstNotification,
} = createNotifications({ notice, noticeError, noticeAction })'''

HEADER = '''// 通知与状态栏键盘导航 —— 从 App.vue 搬出的一域（87 行，3 个依赖）。
//
// 判据：IDEA 把「消息」分成两半 —— 一闪而过的 balloon（TaoCode 的 `notice`）和常驻的
// **通知中心日志**（`Notifications` widget / 欢迎页通知工具条共用同一份历史），后者的规则
// （`expirePreviousAndNotify`、按 displayId 顶替、前插）在 src/notices.ts，本模块是它的宿主。
// 同一片代码里还有**状态栏的键盘遍历**：IDEA 把状态栏做成 focus cycle root
// （`IdeStatusBarImpl.kt:313-323,863-872,952-962`），左右键在可见且启用的组件间走并两端环绕，
// Escape 回到进入前的组件；规则在 src/statusBarNav.ts，本模块只做 DOM 与注册。
// 两者同处是因为「通知中心」本身就是状态栏里的一个组件，它们的开关状态（`noticeOpen` / `statusMenu`）互相牵制。
import { computed, ref } from 'vue'
import { pushNotice, type NoticeEntry } from './notices'
import { focusableWidgets, navigateWidget, resolveRestoreTarget, shouldFocusFirstWidget, type NavDirection } from './statusBarNav'

export interface NotificationsDeps {
  /** 一闪而过的消息（宿主自持的可写 computed，模板直接绑定）。 */
  notice: { value: string }
  noticeError: { value: boolean }
  noticeAction: { value: (() => void) | null }
}

export function createNotifications(deps: NotificationsDeps) {
  const { notice, noticeError, noticeAction } = deps
'''

FOOTER = '''
  return {
    noticeLog, noticeOpen, notify, notifyFromPanel, statusBarRef, statusWidgets, focusStatusBar,
    restoreFocusFromStatusBar, onStatusBarKeydown, statusMenu, openStatusMenu, clearNotices, closeFirstNotification,
  }
}
'''

io.open(MOD, 'w', encoding='utf-8', newline='\n').write(HEADER + '\n'.join(r1) + '\n' + '\n'.join(r2) + FOOTER)

new_lines = lines[:a1] + ASSEMBLY.split('\n') + lines[b1 + 1:a2] + lines[b2 + 1:]
io.open(APP, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_lines))
print('r1/r2:', len(r1), len(r2))
print('App.vue:', len(lines), '->', len(new_lines))
