// 欢迎页行文本的纯规则（`src/welcomeRowText.ts`）：时间格式、头像缩写、两个确认框的措辞、状态行。
// 2026-10-06 桶 14c 从 `src/components/WelcomePage.vue` 搬出来时才有的判据；
// 上游坐标（RemoveSelectedProjectsAction 的单/复数两条标题、ReopenProjectAction.kt:84-94 的两条路）
// 写在新模块的文件头与函数注释里。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  avatarInitials, copiedPathNote, forgetDialogText, listStatusText, openedDate, revealedNote, reopenDialogText,
} from '../src/welcomeRowText.ts'

test('最近打开时间：能解析就出「年/月/日 时:分」，解析不出来就说「时间未知」', () => {
  assert.equal(openedDate('2026-10-06T21:07:00').replace(/[^0-9]/g, '').slice(0, 8), '20261006')
  assert.match(openedDate('2026-10-06T21:07:00'), /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/, '两位补月/日，24 小时制')
  assert.doesNotMatch(openedDate('2026-10-06T09:07:00'), /上午|下午/, 'hour12: false')
  for (const bad of ['', '昨天', 'not-a-date', '2026-13-45']) {
    assert.equal(openedDate(bad), '时间未知', `坏时间戳不能画出 Invalid Date（${bad}）`)
  }
})

test('头像缩写：逗号切两段、每段取首个非空白字符，全空退到首字符，再退到「项」', () => {
  assert.equal(avatarInitials('桃, IDE'), '桃I')
  assert.equal(avatarInitials('hello, world, again'), 'HW', '第三段及之后不看')
  assert.equal(avatarInitials('Tao Code'), 'T', '一段只取一个字母')
  assert.equal(avatarInitials('   spaced'), 'S', '段首的空白跳过')
  assert.equal(avatarInitials(''), '项', '空名字也不能画出一个空白头像')
  assert.equal(avatarInitials('   '), '项')
  assert.equal(avatarInitials('日本語'), '日')
})

test('移除确认框：一项点名、多项说「所选项目」并报个数；空列表没什么可确认', () => {
  assert.equal(forgetDialogText([]), null)
  const one = forgetDialogText([{ name: '甲' }])
  assert.equal(one.title, '从最近项目列表移除「甲」？')
  assert.equal(one.body, '磁盘上的文件不会被删除。')
  assert.equal(one.message, `${one.title}\n${one.body}`, '两条拼法就是组件里 window.confirm 的那一句')
  const many = forgetDialogText([{ name: '甲' }, { name: '乙' }])
  assert.equal(many.title, '从最近项目列表移除所选项目？', '复数不点名')
  assert.equal(many.body, '共 2 项，磁盘上的文件不会被删除。')
  assert.ok(!many.message.includes('甲'), '复数那句里不该出现某一项的名字')
})

test('路径没了的那一句：两条路都写清楚（确定 = 留着，取消 = 只删记录）', () => {
  const text = reopenDialogText('D:/code/甲')
  assert.match(text, /路径「D:\/code\/甲」不存在或不可访问/)
  assert.match(text, /点击「确定」继续/)
  assert.match(text, /点击「取消」从最近项目列表移除（磁盘文件不会被删除）。/)
})

test('状态行优先级：回声 > 忙 > 搜索命中数 > 总数（空格查询按没在搜索算）', () => {
  const base = { note: '', busy: false, query: '', visibleCount: 3, totalCount: 5 }
  assert.equal(listStatusText(base), '5 个项目', '没搜索时报的是**全部**条数')
  assert.equal(listStatusText({ ...base, query: ' 桃 ' }), '找到 3 个项目', '搜索时报的是**过滤后**条数')
  assert.equal(listStatusText({ ...base, query: '   ' }), '5 个项目', '纯空白 = 没在搜索')
  assert.equal(listStatusText({ ...base, busy: true }), '正在处理项目操作…')
  assert.equal(listStatusText({ ...base, busy: true, note: '已复制：D:/x' }), '已复制：D:/x', '回声压过忙，否则刚复制完看不到结果')
})

test('两条回声的措辞', () => {
  assert.equal(copiedPathNote('D:\\code\\甲'), '已复制：D:\\code\\甲', '复制的是系统分隔符那一份，回声也得是同一串')
  assert.equal(revealedNote('D:/code/甲'), '已在资源管理器中显示：D:/code/甲')
})
