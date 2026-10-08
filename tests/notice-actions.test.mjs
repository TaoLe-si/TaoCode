// 通知上的动作按钮（上游 `Notification.addAction`）。
//
// 起因：Gradle 同步失败以前只是消息窗口里的一行灰字 —— 用户看完还得自己去工具条上点「同步」。
// IDEA 的那批通知是带按钮的：
//   · Gradle 通知组本身就是 `displayType="STICKY_BALLOON"`（`plugins/gradle/plugin-resources/intellij.gradle.xml:309`，
//     组名 = `GradleBundle.properties:320` `notification.group.gradle=Gradle`）；
//   · 动作的形状见 `GradleBundle.properties:343-345`（Migrate / Ignore / Learn more）；
//   · 点击顺序由 `LspServerNotificationsHandlerImpl.kt:443-454` 给出：addAction 的回调里先
//     `notification.expire()` 再做事 —— 点完还挂在列表里的通知就是没收起的弹窗。
//   · 本仓这些按钮都是"点完就完"的，用的正是上游推荐的那个形状：`Notification.java:52` 写着
//     「别在 HTML 里放链接，用 addAction / NotificationAction.createSimpleExpiring」——
//     **Expiring** 就是点完把这条通知收掉，所以气球与列表两处都得收，不能只藏气球。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as vue from 'vue'
import * as gradle from '../src/gradle.ts'
import { noticeLevel, noticeTitle, pushNotice } from '../src/notices.ts'
import { createNotifications } from '../src/notifications.ts'
// 未链接工程（UPN）那一支的三方：通知本体与它的 displayId、自动链接开关的存储面、构建系统可读名。
import { UNLINKED_PROJECT_DISPLAY_ID } from '../src/externalSystemAutoImport.ts'
import { GRADLE_SYSTEM } from '../src/externalSystemModel.ts'
import { isUnlinkedNoticeSkipped, setAutoLinkEnabled } from '../src/externalSystemAutoLink.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

const entry = (over = {}) => ({ id: 1, message: 'm', error: false, at: '00:00:00', ...over })

/** 通知宿主：三个气球字段由宿主自持，所以这里给一对可写的壳。 */
function host() {
  const notice = { value: '' }
  const noticeError = { value: false }
  const noticeAction = { value: null }
  return { api: createNotifications({ notice, noticeError, noticeAction }), notice }
}

test('动作与进度行共用同一份通知条目模型', () => {
  const withActions = pushNotice([], entry({ displayId: 'gradle:fail', actions: [{ label: '重新同步', run: () => {} }] }))
  assert.equal(withActions[0].actions.length, 1)
  assert.equal(pushNotice([], entry()).actions, undefined, '没有动作的通知不该占一行按钮位')
})

test('notify 把动作带上气球与列表；气球那条点完把通知本身收掉', () => {
  const ran = []
  const { api, notice } = host()
  api.notify('Gradle 同步失败：拉不到 manifest', true, undefined, undefined, undefined, [{ label: '重新同步', run: () => ran.push(1) }])
  assert.equal(notice.value, 'Gradle 同步失败：拉不到 manifest')
  assert.equal(api.noticeLog.value[0].actions[0].label, '重新同步', '列表里也要带着同一组按钮')
  assert.equal(api.noticeActions.value.length, 1, '气球要能画出同一组按钮')
  api.runBalloonAction(api.noticeActions.value[0])
  assert.deepEqual(ran, [1], '动作确实跑了')
  assert.equal(notice.value, '', '执行时气球一起收掉')
  assert.equal(api.noticeActions.value, null)
  assert.equal(api.noticeLog.value.length, 0, '上游用的是 createSimpleExpiring：点完这条通知就没了，不是只收气球')
})

test('列表里点旧那条的按钮，不会把最新那条（还挂在气球上）一起收掉', () => {
  const ran = []
  const { api } = host()
  api.notify('第一条：依赖加载失败', true, undefined, undefined, undefined, [{ label: '重新同步', run: () => ran.push(1) }])
  api.notify('第二条', true)
  const older = api.noticeLog.value[1]
  api.expireNotice(older.id)   // NoticeList.vue 的按钮先 expire 再 run，顺序在两处一致
  api.runNoticeAction(older.actions[0])
  assert.deepEqual(ran, [1])
  assert.deepEqual(api.noticeLog.value.map(item => item.message), ['第二条'], '只收点那一条')
  // 反证：气球若还显示着「第二条」，runBalloonAction 不能拿上一条的 id 去收它。
  api.runBalloonAction({ label: 'noop', run: () => ran.push(2) })
  assert.deepEqual(ran, [1, 2])
  assert.equal(api.noticeLog.value.length, 0)
})

test('expire 只收那一条；收光了通知中心自己关', () => {
  const { api } = host()
  api.notify('第一条')
  api.notify('第二条', true)
  assert.equal(api.noticeOpen.value, false)
  // 前插 = 最新在头一条（`pushNotice` 的形状）；先收掉那条**没错误**的，看芯片颜色跟不跟着剩下那条走。
  const [newest, older] = api.noticeLog.value
  assert.deepEqual([newest.message, older.message], ['第二条', '第一条'])
  api.expireNotice(older.id)
  assert.deepEqual(api.noticeLog.value.map(item => item.message), ['第二条'])
  assert.equal(noticeLevel(api.noticeLog.value), 'error', '芯片的变色跟着剩下那条，不能被收掉的那条带跑')
  // 提示文字是上游那两句（`IdeNotificationArea.java:105-107`，中文包「N 通知挂起」），
  // 这里要钉的是"**条数跟着剩下那条走**"，形状随 2026-10-06 的文案订正一起换成仍精确的整句匹配。
  assert.match(noticeTitle(api.noticeLog.value), /^1 通知挂起$/, '收掉一条后提示里的条数要跟着变')
  api.noticeOpen.value = true
  api.expireNotice(newest.id)
  assert.equal(api.noticeOpen.value, false, '最后一条被收走时弹层没有内容可展示，要自己关')
})

// ---------------------------------------------------------------------------
// 接线：三处渲染点都得真的接上（少一处就是"按钮在但点了没反应"）
// ---------------------------------------------------------------------------

test('状态栏弹层、通知工具窗口、气球都接上了同一组动作', () => {
  const list = read('src/components/NoticeList.vue')
  assert.match(list, /emit\('expire', entry\.id\); emit\('run', action\)/, '列表按钮要先 expire 再执行（上游那个顺序）')
  assert.match(list, /entry\.actions\?\.length/, '没有动作的通知不占按钮位')
  const app = read('src/App.vue')
  assert.match(app, /@expire="expireNotice" @run="runNoticeAction"/, '状态栏那个弹层要接住事件')
  assert.match(app, /class="subtle-button notice-action" @click\.stop="runBalloonAction\(action\)"/, '气球上也要有同一组按钮')
  const view = read('src/components/ToolWindowView.vue')
  assert.match(view, /@expire="ctx\.onExpireNotice\?\.\(\$event\)" @run="ctx\.onRunNoticeAction\?\.\(\$event\)"/,
    '通知工具窗口是第二份列表，按钮不能只在一处生效')
  assert.match(read('src/toolViewContext.ts'), /onRunNoticeAction: runNoticeAction, onExpireNotice: expireNotice/)
  assert.match(read('src/style.css'), /\.notice-action \{/, '按钮要有自己的字号，不与正文抢')
})

test('Gradle 失败那条通知自带「重新同步 / 打开构建脚本 / 构建工具设置」', () => {
  const gradleHost = read('src/gradleHost.ts')
  // 2026-10-06 gradlehostfix 订正（只换钉的形状，意图一字未动）：本仓一条无署名 lane（progflow §3 记为 G6）
  // 给 `notifyFailure` 加了第 4 形参 `issueActions?`，JDK 解析失败时把**最后一条**动作换成「打开 Gradle 设置」。
  // 本 lane 判它是**自洽的真行为**、不是半截，依据是自己开文件核过的两点：
  //   · 上游 —— `plugins/gradle/src/org/jetbrains/plugins/gradle/service/execution/LocalGradleExecutionAware.kt:193-198`
  //     的 `jdkConfigurationException` 把 `GradleBundle.message("gradle.open.gradle.settings")`
  //     （`plugins/gradle/resources/messages/GradleBundle.properties:85` = `Open Gradle Settings`）拼进那条 JDK 失败信息，
  //     ⇒ "失败种类决定最后一条动作" 在上游成立。
  //   · 实现侧三处齐全：形参（`src/gradleHost.ts:438`）、替换并兜回默认档（`:442`）、唯一调用点带 `jvmIssue`（`:553-554`）；
  //     `gradleJavaHomeIssue` / `GRADLE_JVM_OPEN_SETTINGS_ACTION` / `GRADLE_CONFIGURABLE_ID` 都有定义，`vue-tsc` 对这三条零错。
  // ⇒ 按「有意改动 + 判据过时」收口：钉成仍精确的整句匹配，不放松成 includes、不删断言。
  assert.match(gradleHost,
    /function notifyFailure\(directory: string, label: string, error: string, issueActions\?: \{ label: string; run: \(\) => void \}\[\]\): void/,
    '失败要发一条带按钮的通知，不只是灰字')
  for (const label of ['重新同步', '打开构建脚本', '构建工具设置']) {
    assert.ok(gradleHost.includes(`label: '${label}'`), `失败通知少了「${label}」这个动作`)
  }
  // 2026-10-06 复核订正（与 `tests/progress-notices.test.mjs` 同一处）：桶 15 给 `kind === 'task'`
  // 也补了结论，磁盘上是一条**三档**的三元链（写这条时指 `src/gradleHost.ts:519-521`；gradlehostfix 复核时
  // 同一条链在 `:555-556` —— 被上面 JDK 那一段顶下去了，只更新坐标，不改它的结论）。这两条断言原来钉的是
  // 两档那一版 ⇒ 钉的形状过时了，不是意图变了：意图仍然是「每一条命令的失败都经过 notifyFailure
  // 这个出口、都带自己的中文标签」。改成仍精确的整句匹配，不放松成 includes。
  assert.match(gradleHost,
    /notifyFailure\(job\.directory, job\.kind === 'sync' \? 'Gradle 同步' : job\.kind === 'dependencies' \? '依赖加载' : '任务运行', error,\s+jvmIssue \? \[\{ label: GRADLE_JVM_OPEN_SETTINGS_ACTION, run: \(\) => \{ void deps\.openSettings\(GRADLE_CONFIGURABLE_ID\) \} \}\] : undefined\)/,
    '同步/依赖/任务运行三条命令的失败都要发出去，且各带自己的标签；JDK 解析失败时最后一条动作换成「打开 Gradle 设置」')
  assert.match(gradleHost, /\.\.\.\(issueActions\?\.length \? issueActions : \[/,
    '换档是**替换**最后一条并兜回默认档，不能给空按钮组')
  assert.match(gradleHost,
    /job\.kind === 'dependencies' \? '依赖加载' : job\.kind === 'task' \? '任务运行' : undefined/,
    '进度行的结论也要按同一条链给标签')
  // 本仓没有本地文档，就不放「Learn more」那类按钮：凭空发明的链接比没有按钮更糟。
  assert.equal(/了解更多|help\.jetbrains|https?:\/\/[a-z]/i.test(gradleHost), false, '不许出现凭空造的帮助链接')
})

// ---------------------------------------------------------------------------
// 接线：未链接工程（UPN）那一支也得真的弹出来，且两个按钮各走各的出口
// （`UnlinkedProjectStartupActivity.kt:141-197` 的扫描器 → `UnlinkedProjectNotificationAware.kt:42-66`）
//
// gradlehostfix 的来由：`src/gradleHost.ts` 那条 UPN 通知以前把 displayId 写成一个**全仓不存在**的标识符，
// 这一支整块以 unhandled rejection 结束 ⇒ 通知一次都没弹出来（类型红只是它的表层症状）。
// 下面这条判据在补常量之前必须是红的：它跑的是真实例化后的宿主，不是 grep 文本。
// 落点选本文件：这里钉的正是"通知上的按钮点得动"，UPN 那条就是两个按钮（加载 / 跳过）的通知。
// ---------------------------------------------------------------------------

const tick = async () => { for (let i = 0; i < 12; i++) await vue.nextTick() }

/**
 * 实例化 `src/gradleHost.ts`（与 `tests/gradle-host.test.mjs` 同一手法：`ts.transpileModule` + 注入 require）。
 * 只有 `./bridge.ts`（原生通道）是假的，其余依赖**逐个喂真实模块** —— 喂假实现会让"跳过之后不再弹"
 * 这条判据形同虚设。依赖清单从转译结果里现取：gradleHost 以后加 import 时这里会当场抛未知模块名，不会静默少喂。
 */
async function withGradleHost({ dirs = [] }) {
  const state = vue.reactive({ running: false, command: '', startedAt: 0, at: 0, output: '', exit: null, cancelled: false })
  const calls = [], notices = [], saved = []
  let clock = 10
  const deps = {
    isDesktop: true, workspace: vue.ref({ root: 'D:/workspace', name: 'demo' }),
    projectSettings: vue.ref({ buildTools: { ...gradle.DEFAULT_BUILD_TOOLS, gradle: { ...gradle.GRADLE_RUN_DEFAULTS, linkedProjects: dirs } } }),
    notify: (...args) => notices.push(args), notifyProgress: () => {},
    runInConsole: (...args) => calls.push(['console', ...args]),
    addRunConfiguration: (...args) => calls.push(['config', ...args]),
    isOpenInEditor: () => false, openSettings: () => {}, openFile: path => calls.push(['open', path]),
    async saveGradleSettings(patch) { saved.push(patch); deps.projectSettings.value.buildTools.gradle = patch },
  }
  const send = async (method, params) => {
    calls.push([method, params])
    if (method === 'workspace.list') {
      const prefix = params.path ? `${params.path}/` : ''
      return [{ path: `${prefix}build.gradle` }, { path: `${prefix}gradlew.bat` }]
    }
    if (method === 'file.read') return { content: 'distributionUrl=https\://x/gradle-8.7-bin.zip' }
    if (method === 'gradle.sync') {
      state.running = true; state.command = params.command; state.output = ''; state.exit = null; state.cancelled = false
      state.at = state.startedAt = ++clock
    }
    return {}
  }
  const js = ts.transpileModule(readFileSync(join(root, 'src/gradleHost.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const names = [...new Set([...js.matchAll(/require\("\.\/([^"]+\.ts)"\)/g)].map(match => match[1]))]
  const mods = {}
  for (const name of names) if (name !== 'bridge.ts') mods[name] = await import(`../src/${name}`)
  const exports = {}
  new Function('require', 'exports', js)(name => name === 'vue'
    ? vue : name === './bridge.ts' ? { request: send, gradleSync: state } : mods[name.slice(2)] ?? mods[name], exports)
  const scope = vue.effectScope()
  const api = scope.run(() => exports.createGradleHost(deps))
  return {
    api, calls, notices, saved, stop: () => scope.stop(),
    finish(output = "Root project 'demo'\nBuild tasks\n-----------\nbuild - build it") {
      state.output = output; state.running = false; state.exit = 0; state.at = ++clock
    },
  }
}

test('未链接 Gradle 工程：那条通知真的弹（displayId 用上游字面量），点「跳过」后不再弹，点「加载」走 linkProject', async () => {
  const data = new Map()
  const store = { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
  globalThis.localStorage = store
  const hosts = []
  try {
    // 走到通知那一支的条件：`isEnabledAutoLink` 关掉。上游默认 true（`UnlinkedProjectSettings.kt:9-23`），
    // 而那个开关只门控**自动链接**（`UnlinkedProjectStartupActivity.kt:51-54`），不门控通知 ⇒ 关掉后必须还能弹。
    assert.equal(setAutoLinkEnabled(store, 'D:/workspace', false), true, '存储面要写得进（否则下面三条用例都是空跑）')
    const first = await withGradleHost({ dirs: [] })
    hosts.push(first)
    await tick()
    const notice = first.notices.find(args => args[4] === UNLINKED_PROJECT_DISPLAY_ID)
    assert.ok(notice, `UPN 那一支必须真发出一条通知；实际 notify 收到的：${JSON.stringify(first.notices.map(args => args.slice(0, 2)))}`)
    const [message, error, onClick, detail, displayId, actions] = notice
    // displayId 的字面值钉的是**上游原文**，不是本仓自取：`UnlinkedProjectNotificationAware.kt:61` 的
    // `.setDisplayId(UNLINKED_NOTIFICATION_ID)` + `:143` 的常量；同一个字符串还登记在该通知组的
    // `notificationIds=` 白名单（`platform/external-system-impl/resources/META-INF/ExternalSystemExtensions.xml:51-53`）。
    assert.equal(displayId, 'external.system.autolink.unlinked.project.notification')
    assert.match(message, /^找到 Gradle 工程「demo」的构建脚本$/, '标题 = unlinked.project.notification.title 的中文取值')
    assert.equal(error, false, '上游是 NotificationType.INFORMATION（`:60`），不是错误档')
    assert.equal(onClick, undefined, '这条通知正文没有点击跳转（上游 help 走详情行，不是链接）')
    assert.equal(detail.length, 1)
    assert.match(detail[0], /可以从 Gradle 构建脚本导入项目信息/, '`:63` setNotificationHelp 那一长句进详情行')
    assert.deepEqual(actions.map(action => action.label), ['加载 Gradle 工程', '跳过'],
      '动作顺序照上游：`:64` link 在前、`:65` skip 在后')

    // 一档：点「加载」= 上游那个 callback()（`UnlinkedProjectStartupActivity.kt` 把链接动作传进来）
    actions[0].run()
    await tick()
    assert.deepEqual(first.saved.at(-1)?.linkedProjects, [''], '点「加载」把工程根链进来')
    assert.ok(first.calls.some(([method]) => method === 'gradle.sync'), '链接后立刻排一次同步')
    first.finish()
    await tick()
    assert.equal(first.api.linkedProjects.value.includes(''), true)

    // 二档：点「跳过」= 上游的 disableNotification(projectId)（`:65` → `:113-116`），当场落项目级记账
    const second = await withGradleHost({ dirs: [] })
    hosts.push(second)
    await tick()
    const skippable = second.notices.find(args => args[4] === UNLINKED_PROJECT_DISPLAY_ID)
    assert.ok(skippable, '第二个宿主（同一存储、还没跳过过）仍要弹')
    skippable[5][1].run()
    assert.equal(isUnlinkedNoticeSkipped(store, 'D:/workspace'), true, '「跳过」要写进项目级存储（上游 :33-38 的 @State）')
    second.stop()

    // 三档（反证）：跳过过 ⇒ 再开同一个工程**不再弹**（`UnlinkedProjectNotificationAware.kt:42-46`）
    const third = await withGradleHost({ dirs: [] })
    hosts.push(third)
    await tick()
    assert.equal(third.notices.some(args => args[4] === UNLINKED_PROJECT_DISPLAY_ID), false,
      '跳过之后再开这个工程不该再有那条通知')
    assert.ok(third.notices.every(args => args[4] === undefined), '这条支路整块不该发出任何带 displayId 的通知')
  } finally {
    for (const h of hosts) h.stop()
    delete globalThis.localStorage
  }
})

test('未链接工程通知的 displayId 不许再写成没定义的标识符（gradleHost 必须从通知本体那个模块导入它）', () => {
  const gradleHost = read('src/gradleHost.ts')
  const source = read('src/externalSystemAutoImport.ts')
  assert.match(source, /export const UNLINKED_PROJECT_DISPLAY_ID = 'external\.system\.autolink\.unlinked\.project\.notification'/,
    '定义必须在通知本体旁边，且值就是上游那个字面量')
  assert.match(gradleHost,
    /projectIdOf, unlinkedProjectNotice, UNLINKED_PROJECT_DISPLAY_ID,\n {2}type AutoImportModificationType, type ExternalRefreshStatus,\n\} from '\.\/externalSystemAutoImport\.ts'/,
    '宿主走**同一条**已有的 import 拿它（不许再出现全仓不存在的裸标识符）')
  assert.match(gradleHost, /\[notice\.helpText\], UNLINKED_PROJECT_DISPLAY_ID, \[/, '弹的那一条要把它当第 5 参递出去')
})
