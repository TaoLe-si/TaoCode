// 欢迎页最近项目**那一行的文字**：日期格式化、头像缩写、两个确认框的措辞、状态行。
//
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 搬出，组件里只留接线；
// 原注释里的上游坐标一起搬过来：
//   · `platform/platform-impl/src/com/intellij/openapi/wm/impl/welcomeScreen/recentProjects/RecentProjectFilteringTree.kt`
//     那一族渲染的是「名字 + 路径 + 最近打开时间」的一元格；
//   · RemoveSelectedProjectsAction.kt mirrors the IDE's recent-project delete UX: the
//     action always confirms before it drops a record; the path itself is never touched.
//     The IDE bundle ships two dialog strings — `dialog.title.remove.recent.project`
//     (singular) and `dialog.title.remove.recent.project.plural` — and two messages,
//     one of which names the project, while the plural form says "selected projects".
//     We mirror the same branching so the wording matches across one and many items.
//   · ReopenProjectAction.showReopenDialog (ReopenProjectAction.kt:84-94): when the path
//     disappeared, the IDE offers two buttons — OK (closes the dialog, project stays on
//     the list) and "Remove from list" (calls removePath). We mirror the same choice.
//
// 头像缩写是本仓自己的规则（上游那一份是 `ProjectIcon` 生成的渐变图，不是字母），
// 所以这里**不挂**上游坐标，只在测试里钉住边界。

/** 上游一元格的"最近打开"那一行用 IDE 的相对时间；本仓渲染绝对时间（读不到时明确说不知道）。 */
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** 时间戳格式化；解析不出来（空串 / 坏格式）就是「时间未知」，不画一个 `Invalid Date`。 */
export function openedDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : dateFormat.format(date)
}

/**
 * 头像上的两个字母：名字按逗号切成最多两段，每段取**第一个非空白字符**
 * （所以「桃, IDE」出「桃I」、「hello world」出「hw」）；全空退到名字的首字符，
 * 连首字符都没有（纯空白）就用「项」——头像永远不该是空的。
 * 结果统一大写（CJK 不受影响）。
 */
export function avatarInitials(name: string): string {
  const segments = name.split(',').slice(0, 2)
  const letters: string[] = []
  for (const segment of segments) {
    for (const ch of segment) {
      if (!/\s/.test(ch)) { letters.push(ch); break }
    }
  }
  return (letters.join('') || name.trim()[0] || '项').toLocaleUpperCase()
}

/** 移除确认框的两条文案（单数点名、复数说「所选项目」）。 */
export interface ForgetDialogText { title: string; body: string; message: string }

/**
 * `RemoveSelectedProjectsAction` 的两个标题 + 两条消息：一项点名报出项目名，
 * 多项只说「所选项目」并报个数；两句都保证不碰磁盘。空列表返回 null（没什么可确认的）。
 */
export function forgetDialogText(projects: readonly { name: string }[]): ForgetDialogText | null {
  if (projects.length === 0) return null
  const title = projects.length === 1
    ? `从最近项目列表移除「${projects[0]!.name}」？`
    : '从最近项目列表移除所选项目？'
  const body = projects.length === 1
    ? `磁盘上的文件不会被删除。`
    : `共 ${projects.length} 项，磁盘上的文件不会被删除。`
  return { title, body, message: `${title}\n${body}` }
}

/** 路径没了那一句：「确定」= 继续（记录留着），「取消」= 从列表移除。 */
export function reopenDialogText(path: string): string {
  return `路径「${path}」不存在或不可访问。\n` +
    '点击「确定」继续，点击「取消」从最近项目列表移除（磁盘文件不会被删除）。'
}

/** 状态行（`list-status`，role=status）：复制/显示的结果优先，其次是忙、搜索命中数、总数。 */
export function listStatusText(state: {
  note: string; busy: boolean; query: string; visibleCount: number; totalCount: number
}): string {
  if (state.note) return state.note
  if (state.busy) return '正在处理项目操作…'
  if (state.query.trim()) return `找到 ${state.visibleCount} 个项目`
  return `${state.totalCount} 个项目`
}

/** 「复制路径」那条提示（`CopyProjectPathAction` 复制完什么都不弹，本仓多给一句回声）。 */
export function copiedPathNote(text: string): string {
  return `已复制：${text}`
}

/** 「在资源管理器中显示」那条回声（失败时这里放的是原生侧给出的原因）。 */
export function revealedNote(path: string): string {
  return `已在资源管理器中显示：${path}`
}
