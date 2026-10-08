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
//   · 服务器**主动发起**的那六条**请求**（要客户端回包）—— 回包全在 `native/lsp.cpp` 的服务器请求分派里，
//     判据是 `native/lsp_test.cpp` 的「服务器主动发起的六条请求逐条有回包」那几族；上游对应
//     `LspServerNotificationsHandlerImpl.kt:119-123`（registerCapability，另存进
//     `LspDynamicCapabilities.kt:117` 再 `:130-182` 让受影响的结果重取）、`:125-128`（unregisterCapability）、
//     `:241-247`（workspaceFolders）、`:249-253`（configuration）、`:84-117`（applyEdit）、`:255`（createProgress）。
//     本文件测的是其中**转出来给界面记账**的那三条（register/unregister/create）：
//     记账、按注册作废缓存、停机清账，以及「一条都不弹」这一半。
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
  LSP_DYNAMIC_REQUEST_METHODS, droppedLspServerMessages, expireLspMessageRequest, handleLspServerMessageEvent,
  lspActionTitles, lspDynamicRegistrationCount, lspDynamicRegistrations, lspMessageDisplayIdOf,
  lspMessageGroupIdOf, lspMessageGroupForDisplayId,
  lspMessageGroupRegistered, lspMessageRequestKey, lspPendingMessageRequests, lspServerMessageDrops,
  lspServerMessageHandlerMethods, registerDefaultLspServerMessageHandlers, registerLspServerMessageHandler,
  resetLspServerMessageDrops, resolveLspMessageRequestAnswer, setLspMessageActionsClickable,
  pendingLspMessageRequestCount, chooseLspMessageAction, lspMessageActionsClickable,
  expireLspMessageRequestsOnStop, lspRegistrationEntries, lspMessageRouteOf,
  lspServerMessages as queueFromNewModule,
} from '../src/lspServerMessages.ts'
import { handleLspProgressEvent, lspProgressTasks, lspServerMessages } from '../src/lspProgress.ts'
import { wireLspProgressNotices } from '../src/progressNotices.ts'
import { clearLspLog, lspLogEntries } from '../src/lspServerLog.ts'
import { registerLspCache } from '../src/lspPerFileCache.ts'
import { nextTick } from 'vue'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/**
 * 一条探针缓存：`clearAllLspCaches()` 有没有真的被某条处置叫到，只有挂一个能数次数的假缓存量得到
 * （`lspCacheCount()` 数的是登记着几份，不是"被清了几次"）。
 * `registeredCaches` 那张 Set 没有反登记口 ⇒ 探针活到进程结束，计数按"这一条用例之后涨了几次"来算。
 */
let cacheClears = 0
registerLspCache({ clearCache: () => { cacheClears++ } })

/** 每条用例前后都把几个单例倒空，并确认内置处理器都在。 */
function resetSurface() {
  lspServerMessages.splice(0, lspServerMessages.length)
  clearLspLog()
  resetLspServerMessageDrops()
  for (const key of Object.keys(lspPendingMessageRequests)) delete lspPendingMessageRequests[key]
  for (const id of Object.keys(lspDynamicRegistrations)) delete lspDynamicRegistrations[id]
  setLspMessageActionsClickable(false)
  registerDefaultLspServerMessageHandlers()
}

/** 取「服务器请求」那一档（kind = `request`）的日志行。 */
function requestLines() {
  return lspLogEntries.value.filter(entry => entry.kind === 'request')
}

test('响应面默认认得这十一条：三条消息 + 五条 refresh + 三条服务器主动请求', () => {
  resetSurface()
  assert.deepEqual(
    lspServerMessageHandlerMethods().sort(),
    [
      'client/registerCapability', 'client/unregisterCapability', 'window/logMessage',
      'window/showMessage', 'window/showMessageRequest', 'window/workDoneProgress/create',
      'workspace/codeLens/refresh', 'workspace/diagnostic/refresh', 'workspace/inlineValue/refresh',
      'workspace/inlayHint/refresh', 'workspace/semanticTokens/refresh',
    ].sort(),
  )
  // 幂等：重复注册不会把表撑大（接线方可能不止调一次）。
  assert.equal(registerDefaultLspServerMessageHandlers(), 11)
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

// ── 服务器**主动发起的请求**：回包在 native（判据在 `native/lsp_test.cpp`），这三条的内容转出来之后归本表记账 ──

/** 一条注册事件（宿主转出来的形状就是这样的字段袋：`{language, severity, message, method}` + registrations/token）。 */
function registrationEvent(language, registrations, method = 'client/registerCapability') {
  return { language, severity: 3, message: '', method, [method === 'client/registerCapability' ? 'registrations' : 'unregisterations']: registrations }
}

test('client/registerCapability：登记 id→method、按注册的方法作废那一族缓存，但一条都不弹', () => {
  resetSurface()
  const before = cacheClears
  assert.equal(handleLspProgressEvent('lsp.message',
    registrationEvent('java', [{ id: 'r1', method: 'textDocument/inlayHint', registerOptions: { x: 1 } },
                               { id: 'r2', method: 'workspace/didChangeConfiguration' }])), true)
  assert.deepEqual(Object.keys(lspDynamicRegistrations).sort(), ['r1', 'r2'], '两条都登记了')
  assert.deepEqual([lspDynamicRegistrations.r1.method, lspDynamicRegistrations.r1.language],
    ['textDocument/inlayHint', 'java'], '登记的是服务器给的那个方法与这台服务器')
  assert.equal(lspDynamicRegistrationCount(), 2)
  assert.equal(cacheClears > before, true, '注册了 inlayHint ⇒ 作废那一族缓存（上游 restartHighlightingIfNeeded :130-182 的同一判据）')
  assert.deepEqual(lspServerMessages, [], 'record 这一档不弹任何通知（本仓没有「动态注册表」那个窗口，画它就是放假控件）')
  assert.equal(droppedLspServerMessages(), 0, '有人接，不算丢弃')
  const line = requestLines()[0]
  assert.equal(line.level, 3, '登记这件事是信息，不是错误')
  assert.match(line.text, /textDocument\/inlayHint#r1/, '日志里说得出注册了哪一项')
  assert.match(line.text, /已作废 \d+ 份缓存/)
  resetSurface()
})

test('注册里没有缓存相关的方法 ⇒ 不作废缓存；空批次也照样登记并留一行', () => {
  resetSurface()
  const before = cacheClears
  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'r3', method: 'textDocument/hover' }]))
  assert.equal(cacheClears, before, 'hover 不在本仓那一族缓存的账上，清一次就是白白让结构视图重问一遍')
  assert.equal(lspDynamicRegistrationCount('java'), 1)

  // 键整个缺省 = 服务器发了一条空批次：合法的空（宿主那头的 `collect_registrations` 也按「0 条」回 null），
  // 前端不许凭空登记任何一项。
  handleLspProgressEvent('lsp.message', { language: 'java', severity: 3, message: '', method: 'client/registerCapability' })
  assert.equal(lspDynamicRegistrationCount(), 1, '没有 registrations 就一条都不登记')
  assert.match(requestLines()[requestLines().length - 1].text, /服务器没给可登记的条目/)
  resetSurface()
})

test('形状不对的条目不登记（宁可少记，也不替服务器造一个它没给过的把手），日志如实写少了几条', () => {
  resetSurface()
  assert.deepEqual(lspRegistrationEntries([{ id: 'a', method: 'm' }, { id: 1, method: 'm' }, { method: 'm' }, null, 'x']),
    [{ id: 'a', method: 'm' }], '只认 id 与 method 都是字符串的那些')
  assert.deepEqual(lspRegistrationEntries(undefined), [], '整个缺省 = 空表')
  assert.deepEqual(lspRegistrationEntries({ 0: { id: 'a', method: 'm' } }), [], '不是数组就不算批次')

  handleLspProgressEvent('lsp.message', registrationEvent('java',
    [{ id: 'ok', method: 'textDocument/hover' }, { method: 'textDocument/hover' }]))
  assert.deepEqual(Object.keys(lspDynamicRegistrations), ['ok'], '缺 id 的那条没登记')
  assert.match(requestLines()[0].text, /另有 1 条形状不对（缺 id 或 method），没登记/)
  resetSurface()
})

test('重注册同一个 id 是覆盖（服务器的把手只有一个），注销摘得掉；摘不到的那条按警告留痕', () => {
  resetSurface()
  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'r1', method: 'textDocument/hover' }]))
  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'r1', method: 'textDocument/codeLens' }]))
  assert.equal(lspDynamicRegistrationCount(), 1, '同一个 id 再来一次不翻倍')
  assert.equal(lspDynamicRegistrations.r1.method, 'textDocument/codeLens', '后到的那一条赢')

  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'r1', method: 'textDocument/codeLens' }], 'client/unregisterCapability'))
  assert.deepEqual(Object.keys(lspDynamicRegistrations), [], '摘掉了')
  assert.equal(requestLines()[requestLines().length - 1].level, 3, '正常注销是信息')

  // 撤一个本端没有的 id：回包宿主那侧已经给了 null（协议要求"必须回"），这里只把这件事写下来。
  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'ghost', method: 'textDocument/hover' }], 'client/unregisterCapability'))
  assert.equal(lspDynamicRegistrationCount(), 0)
  const unknown = requestLines()[requestLines().length - 1]
  assert.equal(unknown.level, 2, '「服务器撤了一条我们没登记过的」是要留意的事，不是信息级')
  assert.match(unknown.text, /另有 1 项本端没有登记过/)
  resetSurface()
})

test('window/workDoneProgress/create：只留一行日志，不造进度行也不弹（上游 :255 就一句 completedFuture(null)）', () => {
  resetSurface()
  for (const key of Object.keys(lspProgressTasks)) delete lspProgressTasks[key]
  assert.equal(handleLspProgressEvent('lsp.message',
    { language: 'java', severity: 3, message: '', method: 'window/workDoneProgress/create', token: 'import-1' }), true)
  assert.deepEqual(lspServerMessages, [], '申请 token 不是给用户看的气球')
  assert.deepEqual(Object.keys(lspProgressTasks), [], '进度行要等 $/progress 的 begin 才建，这里凭空造一条就是假控件')
  assert.equal(requestLines()[0].level, 4, '这一行是 log 级（与 $/progress 的 begin 同档）')
  assert.match(requestLines()[0].text, /token=import-1/)

  // 整数 token 也要认（协议的 ProgressToken 是 string | number 的联合类型）。
  handleLspProgressEvent('lsp.message',
    { language: 'java', severity: 3, message: '', method: 'window/workDoneProgress/create', token: 42 })
  assert.match(requestLines()[1].text, /token=42/)

  // 宿主明着拒了的那一条（没有 token）⇒ 这里是警告级，说得出"那条进度不会有下文"。
  handleLspProgressEvent('lsp.message',
    { language: 'java', severity: 3, message: '', method: 'window/workDoneProgress/create' })
  const rejected = requestLines()[requestLines().length - 1]
  assert.equal(rejected.level, 2)
  assert.match(rejected.text, /InvalidParams/)
  resetSurface()
})

test('record 那一档不落通知组也不算丢弃；把处理器摘掉就立刻变成丢弃（这一族"该失败"的形状）', () => {
  resetSurface()
  assert.deepEqual(LSP_DYNAMIC_REQUEST_METHODS, ['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create'])
  for (const method of LSP_DYNAMIC_REQUEST_METHODS) {
    assert.equal(lspMessageRouteOf(method), 'record', `${method} 归 record`)
    assert.equal(lspMessageGroupIdOf('record', 1), '', 'record 不属于任何通知组（上游那三条都不 doNotify）')
    assert.equal(lspMessageDisplayIdOf('java', ''), '', '没有组就没有 displayId：给了一个就是替协议记账预约一个气球')
  }
  // 反向验证的左半边：把这三条的处置**摘掉**（先覆盖成 no-op，再用它自己的反登记口删掉）⇒
  // 同类事件不再被记账，而是落进丢弃计数（= 这类缺陷第一次有了可观察的痕迹）。
  for (const method of LSP_DYNAMIC_REQUEST_METHODS) registerLspServerMessageHandler(method, () => {})()
  for (const method of LSP_DYNAMIC_REQUEST_METHODS) {
    assert.ok(!lspServerMessageHandlerMethods().includes(method), `${method} 现在确实没人接`)
    assert.equal(handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'x', method: 'm' }], method)), true)
    assert.equal(droppedLspServerMessages(method), 1, `${method} 没人接 ⇒ 必须计一次丢弃`)
    assert.deepEqual(lspServerMessages, [], `${method} 即便没人接也不许冒充别的方法弹出去`)
  }
  registerDefaultLspServerMessageHandlers()
  assert.equal(handleLspServerMessageEvent({ language: 'java', severity: 3, message: '', method: 'client/registerCapability', registrations: [{ id: 'back', method: 'textDocument/hover' }] }), true)
  assert.equal(lspDynamicRegistrations.back.method, 'textDocument/hover', '处理器注册回去 ⇒ 同一条事件重新被记账')
  resetSurface()
})

test('服务器停了就作废它那一台登记的动态能力（上游那张表是挂在客户端实例上的）', () => {
  resetSurface()
  handleLspProgressEvent('lsp.message', registrationEvent('java', [{ id: 'j1', method: 'textDocument/hover' }]))
  handleLspProgressEvent('lsp.message', registrationEvent('kotlin', [{ id: 'k1', method: 'textDocument/hover' }]))
  assert.deepEqual(Object.keys(lspDynamicRegistrations).sort(), ['j1', 'k1'])
  assert.equal(handleLspProgressEvent('lsp.progressReset', { language: 'java' }), true)
  assert.deepEqual(Object.keys(lspDynamicRegistrations), ['k1'], '只清这一台的，别的服务器那份注册表不动')
  assert.equal(expireLspMessageRequestsOnStop('kotlin'), 0, '停机这条不牵连别的语言的在途问句')
  resetSurface()
})

test('接线：宿主那六条服务器请求都有回包，转出来的正是这三条', () => {
  resetSurface()
  const client = read('native/lsp.cpp')
  for (const method of ['window/workDoneProgress/create', 'client/registerCapability', 'client/unregisterCapability',
                        'workspace/workspaceFolders', 'workspace/configuration', 'workspace/applyEdit']) {
    assert.ok(client.includes(`"${method}"`), `分派表里有 ${method} 这一支（没有就是掉进 -32601 的那类缺陷）`)
  }
  // 回包在转出**之前**：转出那头的回调万一抛，不能把回包一起带走（服务器会一直等这一条）。
  const registerBody = client.slice(client.indexOf('void Client::answer_register_capability'))
  const respondAt = registerBody.indexOf('respond(id, Json(nullptr), Json(nullptr));')
  const forwardAt = registerBody.indexOf('forward_server_request(params, "client/registerCapability")')
  assert.ok(respondAt > 0 && forwardAt > respondAt, '先回包再转出（顺序反了 = 一次异常就能把这条请求变成永不回复）')
  assert.match(client, /respond\(id, Json\(nullptr\), Json\{\{"code", -32601\}, \{"message", "Method not found"\}\}\)/,
    '认不得的方法回 MethodNotFound，而不是不回')
  const bootstrap = read('native/lsp_host_bootstrap.cpp')
  assert.match(bootstrap, /for \(const char\* key : \{"registrations", "unregisterations", "token"\}\)/,
    '宿主把这三条的参数原样透传出来（内容丢了就又回到"收下不记账"）')
  // 前端这一头：三条都登记了处置，且只登记这三条。
  assert.ok(LSP_DYNAMIC_REQUEST_METHODS.every(method => lspServerMessageHandlerMethods().includes(method)),
    '转出来的三条都有处置器（少一条就落进丢弃计数）')
  resetSurface()
})

test('不带 method 的旧宿主事件保持改动之前的行为（一律按 showMessage 显示，不计丢弃）', () => {
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

  const rows = written.map(entry => [entry.message, entry.error, entry.displayId])
  assert.deepEqual(rows, [
    ['导入失败', true, 'lsp:message:java'],
    ['java：1 行（错误 1）', true, 'lsp:log:java'],
    ['构建脚本有问题', true, 'lsp:log:message:java'],
    ['java：2 行（错误 1）', true, 'lsp:log:java'],
  ],
  '两条服务器消息各自变成一行通知、Error/Warning 都标错误样式（progressNotices 的 severity<=2），'
  + '外加该语言的日志摘要那一行（`lsp:log:<语言>` = `lspLogNoticeOf`）⇒ 一共四行、顺序固定。'
  + '分级按条目自带的 displayId 分开：showMessage 落「LSP window/showMessage」、'
  + 'logMessage 的 Error/Warning 落「LSP window/logMessage: errors, warnings」'
  + '（上游 LspServerNotificationsHandlerImpl.kt:385-390 与 :393-404，组 id 字面值 :464/:470）')
  assert.deepEqual(lspServerMessages, [], '消费方把这批读走了（watcher 真醒了 = 通道是活的）')
  assert.deepEqual(lspLogEntries.value.filter(entry => entry.kind === 'message').map(entry => entry.text),
    ['导入失败', '构建脚本有问题'], '通知面那一拍同时把消息写进「语言服务」日志（Error/Warning 不再只停在队列里）')
  resetSurface()
})

/** 取一条日志行的级别（判据里两处要用，写成函数免得复制断言）。 */
function lspLogLevel(entry) {
  return entry.level
}
