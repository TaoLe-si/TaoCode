// 语言服务「服务器主动」消息/请求的响应面（`src/lspServerMessages.ts`）的判据。
//
// 上游坐标（本机 intellij-community 树，逐条打开核过；lsp4j 的 `LanguageClient` 接口本体不在树里，
// 只有 jar 声明 `libraries/lsp4j/resources/intellij.libraries.eclipse.lsp4j.xml`，
// 所以坐标取上游那个唯一实现它的类）：
//   · `platform/lsp/src/api/Lsp4jClient.kt:59-60` showMessage、`:62-63` showMessageRequest
//     （返回 `CompletableFuture<MessageActionItem>`）、`:68-69` logMessage、`:86-99` 五条 refresh。
//   · `platform/lsp-impl/src/impl/LspServerNotificationsHandlerImpl.kt:377-382`（showMessageRequest，
//     客户端答不出时 `completedFuture(null)`）、`:385-390`（showMessage）、`:393-404`（logMessage 分级）、
//     `:341-368`（refresh 一族全部答 null；同文件 `:369-374` 是第六条 `refreshTextDocumentContent`，
//     IntelliJ 扩展，本仓不做）、`:424-456`（doNotify：只有按钮被点才 complete(actionItem)，`:454` 才 `.notify(project)`）、
//     `:464`/`:470`/`:476`（三个通知组 id）。
//   · `platform/lsp/src/api/LspClientCapabilities.kt:246-249`（window 能力：showMessage/showDocument/workDoneProgress）。
//
// 这一族的**判据形状**是「没注册处理器 ⇒ 丢弃计数；注册了 ⇒ 进通知通道且严重级映射对」，
// 因为本仓出过的原罪就是「声明了 capability 却没有处置」：消息被无声丢掉，界面上什么都看不见。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LSP_SHOW_MESSAGE_GROUP, LSP_LOG_ERRORS_GROUP, LSP_LOG_INFO_TRACE_GROUP,
  droppedLspServerMessages, expireLspMessageRequest, handleLspServerMessageEvent,
  lspActionTitles, lspMessageDisplayIdOf, lspMessageGroupIdOf, lspMessageGroupForDisplayId,
  lspMessageGroupRegistered, lspMessageRequestKey, lspPendingMessageRequests, lspServerMessageDrops,
  lspServerMessageHandlerMethods, registerDefaultLspServerMessageHandlers, registerLspServerMessageHandler,
  resetLspServerMessageDrops, resolveLspMessageRequestAnswer, setLspMessageActionsClickable,
  pendingLspMessageRequestCount, chooseLspMessageAction, lspMessageActionsClickable,
  expireLspMessageRequestsOnStop,
  lspServerMessages as queueFromNewModule,
} from '../src/lspServerMessages.ts'
import { handleLspProgressEvent, lspServerMessages } from '../src/lspProgress.ts'
import { wireLspProgressNotices } from '../src/progressNotices.ts'
import { clearLspLog, lspLogEntries } from '../src/lspServerLog.ts'
import { nextTick } from 'vue'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 每条用例前后都把三个单例倒空，并确认内置处理器都在。 */
function resetSurface() {
  lspServerMessages.splice(0, lspServerMessages.length)
  clearLspLog()
  resetLspServerMessageDrops()
  for (const key of Object.keys(lspPendingMessageRequests)) delete lspPendingMessageRequests[key]
  setLspMessageActionsClickable(false)
  registerDefaultLspServerMessageHandlers()
}

test('响应面默认认得这八条：三条消息 + 五条 refresh（与上游八个方法一一对应）', () => {
  resetSurface()
  assert.deepEqual(
    lspServerMessageHandlerMethods().sort(),
    [
      'window/logMessage', 'window/showMessage', 'window/showMessageRequest',
      'workspace/codeLens/refresh', 'workspace/diagnostic/refresh', 'workspace/inlineValue/refresh',
      'workspace/inlayHint/refresh', 'workspace/semanticTokens/refresh',
    ].sort(),
  )
  // 幂等：重复注册不会把表撑大（接线方可能不止调一次）。
  assert.equal(registerDefaultLspServerMessageHandlers(), 8)
})

test('没注册处理器 ⇒ 落进丢弃计数（可观察），注册之后同一条消息才进通知通道', () => {
  resetSurface()
  const unregister = registerLspServerMessageHandler('window/showMessage', () => {})
  unregister()
  assert.ok(!lspServerMessageHandlerMethods().includes('window/showMessage'), '先确认这条真的没人接了')

  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 1, message: '导入失败', method: 'window/showMessage',
  }), true, '丢弃也算「这条归本通道」，不能让桥接着往下的分支走')
  assert.deepEqual(lspServerMessages, [], '没有处理器时**绝不**冒充别的方法弹出去')
  assert.equal(droppedLspServerMessages(), 1, '总数可观察')
  assert.equal(droppedLspServerMessages('window/showMessage'), 1, '按方法也可观察')

  // 第二条同一方法：计数继续加，但日志只留第一行（一次索引能让同一条没接的方法刷几百条）。
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '还是失败', method: 'window/showMessage' })
  assert.equal(droppedLspServerMessages('window/showMessage'), 2)
  assert.deepEqual(lspLogEntries.value.filter(entry => entry.kind === 'dropped').length, 1,
    '丢弃只在**第一次**见到这个方法时写一行日志')
  assert.match(lspLogEntries.value.filter(entry => entry.kind === 'dropped')[0].text, /window\/showMessage/)

  // 反向验证的右半边：注册回去 ⇒ 同类消息走通知通道，严重级原样带出去。
  registerDefaultLspServerMessageHandlers()
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '导入失败', method: 'window/showMessage' })
  assert.deepEqual(lspServerMessages.map(item => [item.language, item.severity, item.message]), [['java', 1, '导入失败']])
  assert.equal(lspServerMessages[0].requestKey, '', '不是 showMessageRequest 就没有回选的键（别拿空串当一条待决请求）')
  assert.equal(droppedLspServerMessages('window/showMessage'), 2, '已注册的这一条不该再算丢弃')
  resetSurface()
})

test('宿主转出来但我们没有处置的方法（$/logTrace、jdt.ls 的 language/status）不再被当 showMessage 弹', () => {
  resetSurface()
  // 边界用例：改动之前 `lspMessageRouteOf` 把这些归 'notify'，于是每条都会变成一个用户可见的气球。
  for (const method of ['$/logTrace', 'language/status', 'window/showDocument']) {
    assert.equal(handleLspProgressEvent('lsp.message', { language: 'java', severity: 3, message: `${method} 的正文`, method }), true)
    assert.deepEqual(lspServerMessages, [], `${method} 不该弹成通知`)
    assert.equal(droppedLspServerMessages(method), 1, `${method} 要计一次丢弃`)
  }
  assert.equal(droppedLspServerMessages(), 3)
  resetSurface()
})

test('严重级映射：showMessage 每一级都弹；logMessage 只有 Error/Warning 弹，Info/Log 只进日志', () => {
  resetSurface()
  for (const severity of [1, 2, 3, 4]) {
    handleLspProgressEvent('lsp.message', { language: 'java', severity, message: `show ${severity}`, method: 'window/showMessage' })
  }
  assert.deepEqual(lspServerMessages.map(item => item.severity), [1, 2, 3, 4],
    '上游 showMessage（:385-390）不看级别，一律 doNotify')
  assert.deepEqual(lspServerMessages.map(item => item.group), [1, 2, 3, 4].map(() => LSP_SHOW_MESSAGE_GROUP),
    '四条都归 SHOW_MESSAGE 组')
  lspServerMessages.splice(0, lspServerMessages.length)

  for (const severity of [1, 2, 3, 4]) {
    handleLspProgressEvent('lsp.message', { language: 'java', severity, message: `log ${severity}`, method: 'window/logMessage' })
  }
  assert.deepEqual(lspServerMessages.map(item => [item.severity, item.message]), [[1, 'log 1'], [2, 'log 2']],
    'Error/Warning 才弹（上游 :398-399），Info/Log 落进静默组（:402-403，本仓等价于只写日志）')
  assert.deepEqual(lspLogEntries.value.filter(entry => entry.kind === 'message').map(entry => [entry.level, entry.text]),
    [[3, 'log 3'], [4, 'log 4']], '后两级必须留在「语言服务」日志里，不然就真丢了')
  assert.deepEqual(lspServerMessages.map(item => item.group), [LSP_LOG_ERRORS_GROUP, LSP_LOG_ERRORS_GROUP])
  resetSurface()
})

test('分级映射到的是本仓**已有**的通知组注册表，不是另造的一套名字', () => {
  resetSurface()
  for (const group of [LSP_SHOW_MESSAGE_GROUP, LSP_LOG_ERRORS_GROUP, LSP_LOG_INFO_TRACE_GROUP]) {
    assert.ok(lspMessageGroupRegistered(group), `${group} 必须在 src/notificationGroups.ts 里登记过`)
  }
  assert.equal(lspMessageGroupIdOf('log', 1), LSP_LOG_ERRORS_GROUP)
  assert.equal(lspMessageGroupIdOf('log', 3), LSP_LOG_INFO_TRACE_GROUP)
  assert.equal(lspMessageGroupIdOf('notify', 1), LSP_SHOW_MESSAGE_GROUP)
  assert.equal(lspMessageGroupIdOf('ask', 2), LSP_SHOW_MESSAGE_GROUP, 'showMessageRequest 与 showMessage 同组（:382 vs :390）')
  // displayId 与本仓的「前缀 → 组」表闭环（notificationGroups.ts 那张表就是归组的唯一途径）。
  assert.equal(lspMessageGroupForDisplayId(lspMessageDisplayIdOf('java', LSP_SHOW_MESSAGE_GROUP)), LSP_SHOW_MESSAGE_GROUP)
  resetSurface()
})

test('window/showMessageRequest：点不到动作时答 null（协议允许 MessageActionItem | null）', () => {
  resetSurface()
  assert.equal(lspMessageActionsClickable(), false, '本批通知面还没有那一排按钮')
  assert.equal(handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 2, message: '要把这个文件夹当成工程导入吗', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }, { title: '不导入' }], id: 77,
  }), true)
  assert.deepEqual(lspServerMessages.map(item => [item.severity, item.message]), [[2, '要把这个文件夹当成工程导入吗']],
    '消息本身照 showMessage 显示（上游 :382 同一条 doNotify）')
  assert.equal(pendingLspMessageRequestCount(), 0, '点不到 ⇒ 当场按 null 答复，不在表里挂着')
  const line = lspLogEntries.value.filter(entry => entry.kind === 'message')[0]
  assert.match(line.text, /导入 \/ 不导入/, '上游把选项标题一起写进日志（:380）')
  assert.match(line.text, /本端答复：null（通知面上点不到动作）/)
  assert.equal(lspLogLevel(line), 2, '这一行的级别跟着服务器的 type 走，不是我们自定的')
  resetSurface()
})

test('服务器没给选项时也是 null，且日志如实写「服务器没给」', () => {
  resetSurface()
  handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 1, message: '只有话，没有按钮', method: 'window/showMessageRequest', actions: undefined,
  })
  assert.deepEqual(lspActionTitles(undefined), [])
  assert.match(lspLogEntries.value.filter(entry => entry.kind === 'message')[0].text, /选项：（服务器没给） —— 本端答复：null/)
  assert.equal(pendingLspMessageRequestCount(), 0)
  resetSurface()
})

test('接上按钮之后：只认服务器给过的那些标题，认不到就返回 null（绝不替用户编一项）', () => {
  resetSurface()
  setLspMessageActionsClickable(true)
  const message = {
    language: 'java', severity: 2, message: '要不要导入', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }, { title: '不导入', kind: 'extra' }], id: 5,
  }
  handleLspProgressEvent('lsp.message', message)
  const key = lspMessageRequestKey('java', 5, '要不要导入')
  assert.equal(key, 'java#5', '带 id 的按 id 归并（同一条请求只能答一次）')
  assert.equal(lspServerMessages[0].requestKey, key, '队列里那条带的键 = 待决表里的键（通知面靠它回选）')
  assert.equal(pendingLspMessageRequestCount(), 1, '可点 ⇒ 这条留在表里等用户')
  const chosen = chooseLspMessageAction(key, '不导入')
  assert.deepEqual(chosen, { title: '不导入', kind: 'extra' }, '回的是服务器那一项本体，不是我们造的对象')
  assert.deepEqual(resolveLspMessageRequestAnswer(lspPendingMessageRequests[key]), chosen)
  assert.equal(chooseLspMessageAction(key, '全都导入'), null, '服务器没给过的标题不能凭空回选')
  assert.equal(chooseLspMessageAction('不存在的键', '导入'), null)
  resetSurface()
})

test('关掉气球（expire）与服务器停机都把在途的问句按 null 收掉', () => {
  resetSurface()
  setLspMessageActionsClickable(true)
  handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 2, message: '要不要导入', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }], id: 8,
  })
  assert.deepEqual(Object.keys(lspPendingMessageRequests), ['java#8'])
  assert.equal(expireLspMessageRequest('java#8'), null, '没点过就关 ⇒ null（上游 doNotify 只有点击才 complete）')
  assert.deepEqual(Object.keys(lspPendingMessageRequests), [], '关掉之后不能再挂着')

  handleLspProgressEvent('lsp.message', {
    language: 'java', severity: 2, message: '再问一次', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }], id: 9,
  })
  handleLspProgressEvent('lsp.message', {
    language: 'kotlin', severity: 2, message: '别的服务器也在问', method: 'window/showMessageRequest',
    actions: [{ title: '导入' }], id: 9,
  })
  assert.equal(pendingLspMessageRequestCount(), 2)
  // 停机那拍由 bridge 的 lsp.progressReset 触发（同一台服务器不会再有 end）。
  assert.equal(handleLspProgressEvent('lsp.progressReset', { language: 'java' }), true)
  assert.deepEqual(Object.keys(lspPendingMessageRequests), ['kotlin#9'], '只收这一台服务器的，别的语言还在问')
  assert.equal(expireLspMessageRequestsOnStop('kotlin'), 1)
  assert.equal(pendingLspMessageRequestCount(), 0)
  resetSurface()
})

test('不带 method 的旧宿主事件保持改动之前的行为（一律按 showMessage 显示，不计丢弃）', () => {
  resetSurface()
  assert.equal(handleLspProgressEvent('lsp.message', { language: 'java', severity: 3, message: '老形状' }), true)
  assert.deepEqual(lspServerMessages.map(item => [item.severity, item.message]), [[3, '老形状']])
  assert.equal(droppedLspServerMessages(), 0, '没有 method 不等于有人没接')
  assert.equal(lspServerMessages[0].group, LSP_SHOW_MESSAGE_GROUP)
  resetSurface()
})

test('空正文的 notify/log 两支都不弹空气球；refresh 例外（它本来就没有正文）', () => {
  resetSurface()
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '', method: 'window/showMessage' })
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '', method: 'window/logMessage' })
  assert.deepEqual(lspServerMessages, [], '正文是空的就别占一条通知')
  assert.equal(droppedLspServerMessages(), 0, '但它有人接，不算丢弃')
  assert.equal(handleLspProgressEvent('lsp.message', { language: 'java', severity: 3, message: '', method: 'workspace/inlayHint/refresh' }), true)
  const refreshed = lspLogEntries.value.filter(entry => entry.kind === 'refresh')
  assert.equal(refreshed.length, 1, 'refresh 没有正文也必须走完处置并留痕')
  assert.match(refreshed[0].text, /workspace\/inlayHint\/refresh/)
  assert.deepEqual(lspServerMessages, [], 'refresh 不是给用户看的气球')
  resetSurface()
})

test('接线：桥那一行没动、进度模块把整条交出来、注册表在生产路径上就装好了', () => {
  resetSurface()
  const bridge = read('src/bridge.ts')
  assert.match(bridge, /case 'lsp\.progress': case 'lsp\.progressReset': case 'lsp\.message':/,
    '这三条仍走同一行转发（桥不改，字段袋原样交给本模块）')
  assert.match(bridge, /return handleLspProgressEvent\(data\.event, data\)/)
  assert.match(read('src/lspProgress.ts'), /if \(event === 'lsp\.message'\) return handleLspServerMessageEvent\(data\)/,
    '消息那一支整条交出去，不在进度模块里再认一遍方法名')
  assert.match(read('src/lspProgress.ts'), /expireLspMessageRequestsOnStop\(/, '停机要把在途的问句一起收掉')
  assert.match(read('src/lspServerMessages.ts'), /^registerDefaultLspServerMessageHandlers\(\)$/m,
    '模块加载即注册：没有这一步的话八条处置全靠调用方记得注册，就是又一次「声明了没人接」')
  assert.match(read('src/lspServerMessages.ts'), /import \{ noticeGroupId, notificationGroup \} from '\.\/notificationGroups\.ts'/,
    '通知组复用既有注册表，不另造一套')
  assert.match(read('src/lspServerMessages.ts'), /import \{ clearAllLspCaches \} from '\.\/lspPerFileCache\.ts'/)
  const notices = read('src/progressNotices.ts')
  assert.match(notices, /lspServerMessages\.splice/, '消费方还在读同一条队列（拆模块没改消费方）')
  resetSurface()
})

/**
 * 队列只有一份：新模块那份与进度模块转出的那条必须是同一个对象。
 * 拆模块时最容易留下的两种「旧通道」是：①进度模块自己还留一份数组，②消费方读的是别名而不是同一份。
 * ①由 push 的 grep 钉住，②由对象同一性钉住 —— 两条都成立时「收敛成一份」才是可验证的事实，不是口号。
 */
test('消息队列只有一份：两条 import 路径拿到的是同一个数组，进度模块不再自己产出第二条队列', () => {
  resetSurface()
  assert.equal(queueFromNewModule, lspServerMessages, '新模块与 `lspProgress` 转出的是同一个对象（没有第二份数据要收敛）')
  const progressSource = read('src/lspProgress.ts')
  assert.match(progressSource, /export \{[\s\S]*?lspServerMessages,[\s\S]*?\} from '\.\/lspServerMessages\.ts'/,
    '进度模块只做转出（兼容既有 import 路径），不是另一条通道')
  assert.ok(!/lspServerMessages\.push/.test(progressSource), '进度模块不再往队列里放东西（两个主人 = 一条消息两份状态）')
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '同一份队列', method: 'window/showMessage' })
  assert.equal(queueFromNewModule.length, 1, '新模块那一头看得见这一条')
  assert.equal(lspServerMessages.length, 1, '消费方用的那一头也看得见同一条')
  resetSurface()
})

/**
 * 队列的**响应式**是通道的一部分：消费方挂的是 `watch(() => lspServerMessages.length, …)`，
 * 普通数组的 push 不登记任何依赖 ⇒ watcher 一次都不醒 ⇒ 消息堆在队列里静默消失，
 * 且这一类丢弃发生在队列这一头，`lspServerMessageDrops` 抓不到（它只抓「方法没人接」）。
 * 上一批只做到了「有人接」，这一条钉住「接上之后真送得出去」。
 */
test('队列声明成 reactive 数组：否则消费方那个 watch 永远不醒（静默丢弃的第二种形状）', () => {
  resetSurface()
  const source = read('src/lspServerMessages.ts')
  assert.match(source, /export const lspServerMessages = reactive<LspServerMessage\[\]>\(\[\]\)/,
    '队列必须是 reactive 的数组')
  assert.ok(!/export const lspServerMessages: LspServerMessage\[\] = \[\]/.test(source),
    '不许退回普通数组（退回了通知面就一行都收不到）')
  assert.match(read('src/progressNotices.ts'), /watch\(\(\) => lspServerMessages\.length/,
    '消费方确实是按 length 挂 watcher（这条锚点跟着那一侧一起改）')
  resetSurface()
})

/**
 * 端到端：真调 `wireLspProgressNotices`（`src/notifications.ts:114` 在生产上就是这一行），
 * 端口换成记录用的假函数，量「一条服务器消息 → 一个通知行」这件事到底发生没有。
 * 上一批的判据全部停在「队列里有没有这一条」，而这一批的缺陷正好在「队列有人读吗」那一侧 ——
 * 只测前半截的话，普通数组那个 bug 会一路绿到线上。
 */
test('端到端：服务器消息真的走通到通知面（watcher 醒、通知行写出来、日志留痕、队列被读空）', async () => {
  resetSurface()
  const written = []
  wireLspProgressNotices(entry => written.push(entry))
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 1, message: '导入失败', method: 'window/showMessage' })
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 2, message: '构建脚本有问题', method: 'window/logMessage' })
  assert.equal(written.length, 0, 'watch 是 pre flush：这一拍还没轮到消费方')
  assert.equal(lspServerMessages.length, 2, '两条都还在队列里等着被读')
  await nextTick()

  const rows = written.filter(entry => entry.displayId === 'lsp:message:java')
  assert.deepEqual(rows.map(entry => [entry.message, entry.error]), [['导入失败', true], ['构建脚本有问题', true]],
    '两条都变成通知行，Error/Warning 标成错误样式（progressNotices 的 severity<=2 规则）')
  assert.deepEqual(lspServerMessages, [], '消费方把这批读走了（watcher 真醒了 = 通道是活的）')
  assert.deepEqual(lspLogEntries.value.filter(entry => entry.kind === 'message').map(entry => entry.text),
    ['导入失败', '构建脚本有问题'], '通知面那一拍同时把消息写进「语言服务」日志（Error/Warning 不再只停在队列里）')
  resetSurface()
})

/** 取一条日志行的级别（判据里两处要用，写成函数免得复制断言）。 */
function lspLogLevel(entry) {
  return entry.level
}
