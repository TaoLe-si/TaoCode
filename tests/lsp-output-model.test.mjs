// 判据：语言服务**输出窗口**的呈现模型（`src/lspOutputModel.ts`）——
// 控制台行的形状（标签/内容类型/时间戳）、五个打印出口的分类、生命周期文案、
// 多客户端结果合并的四档策略与调用点、补全 resolve 缓存与并发闸、流量预览与过滤导出。
//
// 上游坐标（本机参考树 `D:/Backup/Downloads/intellij-community-master/intellij-community-master`，
// 逐行 `sed -n` 数过；没有编造行号）：
//   · `platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt`（157 行）
//   · `platform/lsp-impl/src/impl/serviceView/LspServiceViewSupport.kt`（128 行）
//   · `platform/lsp-impl/src/impl/serviceView/LspClientServiceViewDescriptor.kt`（83 行）
//   · `platform/lsp-impl/src/impl/serviceView/LspServiceViewContributor.kt`（25 行）
//   · `platform/lsp/resources/messages/LspBundle.properties`（61 行）
//   · `platform/ide-core/src/com/intellij/execution/ui/ConsoleViewContentType.java`
//   · `platform/lsp-impl/src/impl/LspClientManagerImpl.kt`（461 行）
//   · `platform/lsp-impl/src/impl/features/completion/LspCompletionObject.kt`（98 行）
//   · `platform/lsp-impl/src/impl/features/completion/LspCompletionContributor.kt`（120 行）
// 本文件只跑纯逻辑；"上游锚点逐行核内容"那一条读参考树自证，树不在就跳过。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIFECYCLE_STOPPED, LIFECYCLE_TERMINATED, LSP_CONSOLE_TAG_WIDTH, LSP_FILE_REQUEST_ORDER,
  LSP_MERGE_RULES, LSP_RESOLVE_MAX_CONCURRENT, LSP_SERVICES_ROOT_NODE, MAX_LSP_CLIENTS,
  MAX_STORED_PAYLOAD_LENGTH, MAX_TRAFFIC_PAYLOAD_LENGTH, TRAFFIC_PAYLOAD_TRUNCATED,
  collapseWhiteSpace, createLspResolveCache, createLspResolveSemaphore, exportLspConsoleText,
  filterLspConsoleEntries, formatLspConsoleLine, formatLspConsoleTime, groupLspConsoleEntries,
  lspClientForFileRequests, lspConsoleCategoryOfMethod, lspConsoleClientId, lspConsoleContentType,
  lspConsoleEntryLevel, lspConsoleEntryOf, lspConsoleGrouping, lspConsoleLevelTag, lspConsoleRootPostfix,
  lspConsoleTag, lspLifecycleInitialized, lspLifecycleLineFor, lspLifecycleNameAndVersion,
  lspLifecycleStarting, lspMergeRuleFor, lspShowMessageText, lspTrafficArrow, lspTrafficHeader,
  lspTrafficPayloadPreview, lspTrafficStoredPayload, mergeLspClientResults,
} from '../src/lspOutputModel.ts'

const here = dirname(fileURLToPath(import.meta.url))
const REF = 'D:/Backup/Downloads/intellij-community-master/intellij-community-master'
const at = Date.parse('2026-10-07T09:08:07')

// ── 一、标签与内容类型 ─────────────────────────────────────────────────────────────────

test('级别标签五档照 `MessageType.levelTag()`（LspClientConsole.kt:144-150）', () => {
  assert.equal(lspConsoleLevelTag(1), 'ERROR')
  assert.equal(lspConsoleLevelTag(2), 'WARN')
  assert.equal(lspConsoleLevelTag(3), 'INFO')
  assert.equal(lspConsoleLevelTag(4), 'LOG')
  assert.equal(lspConsoleLevelTag(5), 'DEBUG')
  // 认不出的值不凭空造一档（空串 = 这一行没有标签列）
  assert.equal(lspConsoleLevelTag(undefined), '')
  assert.equal(lspConsoleLevelTag(9), '')
})

test('标签列宽是 5（`tag.padEnd(5)`，LspClientConsole.kt:72/92）', () => {
  assert.equal(LSP_CONSOLE_TAG_WIDTH, 5)
  // 五个出口各自的标签（`:48`、`:51`、`:54`、`:57` 第一个实参是 null、`:69`）
  assert.equal(lspConsoleTag('logMessage', { type: 2 }), 'WARN')
  assert.equal(lspConsoleTag('showMessage', { type: 3 }), 'INFO')
  assert.equal(lspConsoleTag('trace'), 'TRACE')
  assert.equal(lspConsoleTag('lifecycle'), '')
  assert.equal(lspConsoleTag('traffic', { outbound: true }), 'OUT')
  assert.equal(lspConsoleTag('traffic', { outbound: false }), 'IN')
})

test('内容类型照 `MessageType.contentType()`（LspClientConsole.kt:152-157）与四个出口', () => {
  assert.equal(lspConsoleContentType('logMessage', { type: 1 }), 'LOG_ERROR_OUTPUT')
  assert.equal(lspConsoleContentType('logMessage', { type: 2 }), 'LOG_WARNING_OUTPUT')
  assert.equal(lspConsoleContentType('logMessage', { type: 3 }), 'LOG_INFO_OUTPUT')
  // `:156` Log 与 Debug **同色**
  assert.equal(lspConsoleContentType('logMessage', { type: 4 }), 'LOG_DEBUG_OUTPUT')
  assert.equal(lspConsoleContentType('logMessage', { type: 5 }), 'LOG_DEBUG_OUTPUT')
  assert.equal(lspConsoleContentType('showMessage', { type: 2 }), 'LOG_WARNING_OUTPUT')
  assert.equal(lspConsoleContentType('trace'), 'LOG_VERBOSE_OUTPUT')            // :54
  assert.equal(lspConsoleContentType('lifecycle', { error: true }), 'LOG_ERROR_OUTPUT')   // :57
  assert.equal(lspConsoleContentType('lifecycle'), 'SYSTEM_OUTPUT')            // :57
  assert.equal(lspConsoleContentType('traffic', { outbound: true }), 'LOG_DEBUG_OUTPUT')  // :68
  assert.equal(lspConsoleContentType('traffic', { outbound: false }), 'LOG_VERBOSE_OUTPUT') // :68
  // 认不出的 MessageType 落 Info 档，不升级成错误色
  assert.equal(lspConsoleContentType('logMessage', { type: 99 }), 'LOG_INFO_OUTPUT')
})

test('方法 → 类别：只有上游真打印的那几个方法有类别，refresh/register 都不打印', () => {
  assert.equal(lspConsoleCategoryOfMethod('window/logMessage'), 'logMessage')
  assert.equal(lspConsoleCategoryOfMethod('window/showMessage'), 'showMessage')
  assert.equal(lspConsoleCategoryOfMethod('window/showMessageRequest'), 'showMessage')
  assert.equal(lspConsoleCategoryOfMethod('$/logTrace'), 'trace')
  // `workspace/…/refresh` 与 `client/registerCapability` 在 LspServerNotificationsHandlerImpl 里只改缓存/记账
  assert.equal(lspConsoleCategoryOfMethod('workspace/semanticTokens/refresh'), 'lifecycle')
  assert.equal(lspConsoleCategoryOfMethod('client/registerCapability'), 'lifecycle')
  assert.equal(lspConsoleCategoryOfMethod(undefined), 'lifecycle')
})

// ── 二、行形状 ─────────────────────────────────────────────────────────────────────────

test('一行 = 时间戳 + 标签列（5 宽 + 空格）+ 正文（LspClientConsole.kt:90-95）', () => {
  assert.equal(formatLspConsoleTime(at), '09:08:07')  // `:30` HH:mm:ss
  assert.equal(formatLspConsoleLine({ at, tag: 'WARN', message: 'x' }), '09:08:07 WARN  x')
  assert.equal(formatLspConsoleLine({ at, tag: 'TRACE', message: 'y' }), '09:08:07 TRACE y')
  // 标签为空（生命周期那一档）时**整列都不在**，不是补空格（`:92` 的 `if (tag != null)`）
  assert.equal(formatLspConsoleLine({ at, tag: '', message: 'Server stopped' }), '09:08:07 Server stopped')
  assert.equal(formatLspConsoleLine({ at, message: 'Server stopped' }), '09:08:07 Server stopped')
  // 正文尾空白被 trimEnd（`:93`）
  assert.equal(formatLspConsoleLine({ at, tag: 'INFO', message: 'z   ' }), '09:08:07 INFO  z')
})

test('showMessage 的正文带 `window/showMessage: ` 前缀（LspClientConsole.kt:51）', () => {
  assert.equal(lspShowMessageText('hello'), 'window/showMessage: hello')
  const entry = lspConsoleEntryOf({ at, language: 'java', method: 'window/showMessage', type: 3, message: 'hello' })
  assert.equal(entry.category, 'showMessage')
  assert.equal(entry.tag, 'INFO')
  assert.equal(entry.contentType, 'LOG_INFO_OUTPUT')
  assert.equal(entry.text, 'window/showMessage: hello')
  // logMessage 那一档**不加**前缀（`:48` 只有 tag 与 message）
  const log = lspConsoleEntryOf({ at, language: 'java', method: 'window/logMessage', type: 2, message: 'careful' })
  assert.equal(log.text, 'careful')
  assert.equal(log.tag, 'WARN')
})

// ── 三、生命周期 ───────────────────────────────────────────────────────────────────────

test('生命周期文案逐条取 LspBundle.properties:18-21', () => {
  assert.equal(lspLifecycleStarting('jdt.ls'), 'Starting jdt.ls…')
  assert.equal(lspLifecycleInitialized('jdt.ls 1.40.0'), 'Server initialized: jdt.ls 1.40.0')
  assert.equal(LIFECYCLE_STOPPED, 'Server stopped')
  assert.equal(LIFECYCLE_TERMINATED, 'Server terminated unexpectedly')
})

test('nameAndVersion 照 LspServiceViewSupport.kt:60-61（serverInfo?.name ?: presentableName + version）', () => {
  assert.equal(lspLifecycleNameAndVersion({ name: 'Eclipse JDT', version: '1.40.0' }, 'jdt.ls'), 'Eclipse JDT 1.40.0')
  // 服务器没报 name 就用 presentableName
  assert.equal(lspLifecycleNameAndVersion({ version: '1.40.0' }, 'jdt.ls'), 'jdt.ls 1.40.0')
  // 没报 version 就只有名字（`:61` 的 listOfNotNull 去掉 null 项）
  assert.equal(lspLifecycleNameAndVersion({ name: 'Eclipse JDT' }, 'jdt.ls'), 'Eclipse JDT')
  assert.equal(lspLifecycleNameAndVersion(undefined, 'jdt.ls'), 'jdt.ls')
})

test('状态 → 生命周期行：Initializing 什么都不打，异常停机才带 error（LspServiceViewSupport.kt:56-68）', () => {
  const facts = { presentableName: 'jdt.ls', serverInfo: { name: 'Eclipse JDT', version: '1.40.0' } }
  // `:57` 空分支 —— 起服务器那一行已由 clientAdded（`:49`）打过
  assert.equal(lspLifecycleLineFor('initializing', facts), null)
  assert.deepEqual(lspLifecycleLineFor('running', facts), { text: 'Server initialized: Eclipse JDT 1.40.0', error: false })
  assert.deepEqual(lspLifecycleLineFor('shutdownUnexpectedly', facts), { text: LIFECYCLE_TERMINATED, error: true })
  // 本仓多出来的一格：没有客户端对象 ⇒ 连控制台都没有，不打行
  assert.equal(lspLifecycleLineFor('unconfigured', facts), null)
})

// ── 四、身份与分组 ─────────────────────────────────────────────────────────────────────

test('客户端 id 照 LspClientServiceViewDescriptor.kt:32-35', () => {
  assert.equal(lspConsoleClientId({ providerClass: 'com.example.JavaLsp', presentableName: 'jdt.ls' }), 'com.example.JavaLsp/jdt.ls/')
  assert.equal(lspConsoleClientId({ providerClass: 'P', presentableName: 'N', roots: ['/a', '/b'] }), 'P/N//a,/b')
})

test('root 后缀只在多客户端且单根时出现（LspClientServiceViewDescriptor.kt:78-82）', () => {
  assert.equal(lspConsoleRootPostfix(['/a'], 2), '…//a')
  assert.equal(lspConsoleRootPostfix(['/a'], 1), '')
  assert.equal(lspConsoleRootPostfix(['/a', '/b'], 3), '')
  assert.equal(lspConsoleRootPostfix([], 5), '')
})

test('控制台按客户端身份分组去重（LspServiceViewContributor.kt:16-17 的 getAllClients）', () => {
  const clients = [
    { providerClass: 'P', presentableName: 'N', language: 'java' },
    { providerClass: 'P', presentableName: 'N', language: 'java' },   // 同一台重复上报
    { providerClass: 'P', presentableName: 'T', language: 'typescript' },
  ]
  const groups = lspConsoleGrouping(clients)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].id, 'P/N/')
  assert.equal(groups[0].language, 'java')
  assert.equal(groups[1].language, 'typescript')
})

test('根节点文案与上限常数', () => {
  assert.equal(LSP_SERVICES_ROOT_NODE, 'Language Servers (LSP)')  // LspBundle.properties:13
  assert.equal(MAX_LSP_CLIENTS, 10)                                // LspClientManagerImpl.kt:50
})

// ── 五、多服务合并 ─────────────────────────────────────────────────────────────────────

test('四档合并策略：first/earlyStop 只取第一台，concat/collect 全收且不去重', () => {
  const perClient = [['a1', 'a2'], null, ['c1']]
  assert.deepEqual(mergeLspClientResults('first', perClient), [['a1', 'a2']])
  assert.deepEqual(mergeLspClientResults('earlyStop', perClient), [['a1', 'a2']])
  assert.deepEqual(mergeLspClientResults('concat', perClient), [['a1', 'a2'], ['c1']])
  assert.deepEqual(mergeLspClientResults('collect', perClient), [['a1', 'a2'], ['c1']])
  // 一台都没有 ⇒ 空表（不凭空造结果）
  assert.deepEqual(mergeLspClientResults('concat', [null, undefined]), [])
  assert.deepEqual(mergeLspClientResults('first', [null, undefined]), [])
  // 跨客户端**不去重**：两条一模一样的答案仍各留一份（上游 flatMap 就是这个形状）
  assert.deepEqual(mergeLspClientResults('concat', [['dup'], ['dup']]), [['dup'], ['dup']])
})

test('合并规则表：四档都有条目，每个调用点都在参考树里指得到', (t) => {
  const policies = new Set(LSP_MERGE_RULES.map(rule => rule.policy))
  assert.deepEqual([...policies].sort(), ['collect', 'concat', 'earlyStop', 'first'])
  // 每个 feature 名唯一（重复登记会让 lspMergeRuleFor 看运气）
  const features = LSP_MERGE_RULES.map(rule => rule.feature)
  assert.equal(new Set(features).size, features.length)
  if (!existsSync(REF)) { t.skip('参考树不在本机'); return }
  const bad = []
  for (const rule of LSP_MERGE_RULES) {
    const match = rule.callSite.match(/^([^:]+):(\d+)-(\d+)$/)
    if (!match) { bad.push(`${rule.feature} 的调用点形状不对：${rule.callSite}`); continue }
    const file = join(REF, match[1])
    if (!existsSync(file)) { bad.push(`${rule.feature} 指的文件不存在：${match[1]}`); continue }
    const lines = readFileSync(file, 'utf8').split('\n').length
    if (Number(match[3]) > lines) bad.push(`${rule.feature} 行号越界：${match[3]} > ${lines}`)
  }
  assert.deepEqual(bad, [], `合并规则表的调用点必须条条指得到：\n${bad.join('\n')}`)
})

test('查合并规则：登记过的按档返回，没登记返回 null（不凭空造一档）', () => {
  assert.equal(lspMergeRuleFor('foldingRange').policy, 'concat')
  assert.equal(lspMergeRuleFor('rename').policy, 'first')
  assert.equal(lspMergeRuleFor('gotoImplementation').policy, 'earlyStop')
  assert.equal(lspMergeRuleFor('documentationTargets').policy, 'collect')
  assert.equal(lspMergeRuleFor('neverHeardOfIt'), null)
})

test('getClientsForFileRequests 的三步顺序照 LspClientManagerImpl.kt:113-120', () => {
  assert.deepEqual([...LSP_FILE_REQUEST_ORDER], ['fileOpen', 'producingClient', 'adopt'])
  assert.equal(lspClientForFileRequests('fileOpen', { fileOpened: true }), true)
  assert.equal(lspClientForFileRequests('fileOpen', { fileOpened: false }), false)
  assert.equal(lspClientForFileRequests('producingClient', { fileOpened: false, producedFile: true }), true)
  assert.equal(lspClientForFileRequests('adopt', { fileOpened: false, adopted: true }), true)
  assert.equal(lspClientForFileRequests('adopt', { fileOpened: false }), false)
})

// ── 六、补全 resolve 缓存 ──────────────────────────────────────────────────────────────

test('resolve 并发闸是 2（LspCompletionContributor.kt:87 的 Semaphore(2)）', () => {
  assert.equal(LSP_RESOLVE_MAX_CONCURRENT, 2)
})

test('信号量：同时最多 2 个在跑，跑完释放', async () => {
  const semaphore = createLspResolveSemaphore(2)
  let peak = 0
  let running = 0
  const task = () => semaphore.run(async () => {
    running++; peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, 5))
    running--
  })
  await Promise.all([task(), task(), task(), task(), task()])
  assert.equal(peak, 2, '同时在跑的不该超过 2')
  assert.equal(semaphore.active(), 0, '跑完必须全部释放')
  assert.equal(semaphore.waiting(), 0)
})

test('resolve 缓存：命中回同一个 promise，不重复发请求（LspCompletionObject.kt:49）', async () => {
  const cache = createLspResolveCache({ resolveProvider: true })
  const item = { label: 'List' }
  let calls = 0
  const compute = async () => { calls++; return { label: 'List', documentation: 'doc' } }
  const first = cache.resolve(item, compute)
  const second = cache.resolve(item, compute)
  assert.equal(first, second, '同一候选第二次必须拿到同一个 promise')
  assert.equal(await first, await second)
  assert.equal(calls, 1, '只该向服务器发一次 resolve')
  assert.equal(cache.has(item), true)
  assert.equal(cache.size(), 1)
  cache.clear()
  assert.equal(cache.has(item), false)
})

test('服务器没声明 resolveProvider 就不发请求，把这条自己当答案（LspCompletionObject.kt:51-53）', async () => {
  const cache = createLspResolveCache({ resolveProvider: false })
  const item = { label: 'val' }
  let calls = 0
  const value = await cache.resolve(item, async () => { calls++; return null })
  assert.equal(value, item, '没有 resolveProvider 时答案就是初始条目自己')
  assert.equal(calls, 0, '这一档一个请求都不该发')
})

test('resolve 回包为 null 时退回初始条目（上游 `?: initialCompletionItem`，:64）', async () => {
  const cache = createLspResolveCache({ resolveProvider: true })
  const item = { label: 'x' }
  assert.equal(await cache.resolve(item, async () => null), item)
})

// ── 七、流量预览（无生产写入方，只测纯函数）──────────────────────────────────────────────

test('collapseWhiteSpace 照 StringUtil.java:2749（含 \\r 先归一，见 LspClientConsole.kt:136）', () => {
  assert.equal(collapseWhiteSpace('a   b'), 'a b')
  assert.equal(collapseWhiteSpace('  a  '), 'a')
  assert.equal(collapseWhiteSpace('a\r\nb'), 'a b')
  assert.equal(collapseWhiteSpace('a\rb'), 'a b')
  assert.equal(collapseWhiteSpace('a\n\n  b'), 'a b')
  assert.equal(collapseWhiteSpace(''), '')
  // 不把 \u00a0 当空白（Java `Character.isWhitespace` 的口径）
  assert.equal(collapseWhiteSpace('a\u00a0b'), 'a\u00a0b')
})

test('流量预览超长截断并附剩余字符数（LspClientConsole.kt:135-142）', () => {
  assert.equal(lspTrafficPayloadPreview('{\n  "a": 1\n}'), '{ "a": 1 }')
  const short = 'x'.repeat(MAX_TRAFFIC_PAYLOAD_LENGTH)
  assert.equal(lspTrafficPayloadPreview(short), short)
  const long = 'x'.repeat(MAX_TRAFFIC_PAYLOAD_LENGTH + 5)
  const preview = lspTrafficPayloadPreview(long)
  assert.ok(preview.endsWith('… (5 more characters)'), preview.slice(-30))
  assert.equal(preview.length, MAX_TRAFFIC_PAYLOAD_LENGTH + '… (5 more characters)'.length)
})

test('存给弹窗的那一份是 100k 上限 + truncated 标记（LspClientConsole.kt:75-76）', () => {
  assert.equal(MAX_STORED_PAYLOAD_LENGTH, 100_000)
  assert.deepEqual(lspTrafficStoredPayload('{}'), { json: '{}', truncated: false })
  const big = 'y'.repeat(MAX_STORED_PAYLOAD_LENGTH + 1)
  const stored = lspTrafficStoredPayload(big)
  assert.equal(stored.json.length, MAX_STORED_PAYLOAD_LENGTH)
  assert.equal(stored.truncated, true)
  assert.equal(TRAFFIC_PAYLOAD_TRUNCATED, '[payload truncated]')  // LspBundle.properties:22
})

test('流量头部四分支与箭头（LspClientConsole.kt:61-66、:70）', () => {
  assert.equal(lspTrafficHeader({ kind: 'request', method: 'initialize', id: 1 }), "request 'initialize' (id=1)")
  assert.equal(lspTrafficHeader({ kind: 'response', id: 1 }), 'response (id=1)')
  assert.equal(lspTrafficHeader({ kind: 'notification', method: 'window/logMessage' }), "notification 'window/logMessage'")
  assert.equal(lspTrafficHeader({ kind: 'other' }), 'message')
  assert.equal(lspTrafficArrow(true), '→')
  assert.equal(lspTrafficArrow(false), '←')
})

// ── 八、过滤 / 分组 / 导出 ──────────────────────────────────────────────────────────────

const sample = [
  lspConsoleEntryOf({ at, language: 'java', method: 'window/logMessage', type: 1, message: '导入失败' }),
  lspConsoleEntryOf({ at, language: 'java', method: 'window/showMessage', type: 3, message: '索引中' }),
  lspConsoleEntryOf({ at, language: 'typescript', method: 'window/logMessage', type: 2, message: 'tsconfig 警告' }),
]

test('一行能反查出 MessageType 级；非消息行没有级', () => {
  assert.equal(lspConsoleEntryLevel(sample[0]), 1)
  assert.equal(lspConsoleEntryLevel(sample[1]), 3)
  assert.equal(lspConsoleEntryLevel(sample[2]), 2)
  const lifecycle = lspConsoleEntryOf({ at, language: 'java', message: LIFECYCLE_STOPPED })
  assert.equal(lspConsoleEntryLevel(lifecycle), undefined)
})

test('过滤：按语言 / 类别 / 最低级（minLevel 越小越严）', () => {
  assert.equal(filterLspConsoleEntries(sample, { language: 'java' }).length, 2)
  assert.equal(filterLspConsoleEntries(sample, { language: 'typescript' }).length, 1)
  assert.deepEqual(filterLspConsoleEntries(sample, { minLevel: 1 }).map(e => e.text), ['导入失败'])
  assert.deepEqual(filterLspConsoleEntries(sample, { minLevel: 2 }).map(e => e.text), ['导入失败', 'tsconfig 警告'])
  assert.equal(filterLspConsoleEntries(sample, { category: 'showMessage' }).length, 1)
  // `language: ''` 是有效条件，不是"不过滤"
  assert.equal(filterLspConsoleEntries(sample, { language: '' }).length, 0)
})

test('按语言分组（稳定顺序 = 首次出现）', () => {
  const groups = groupLspConsoleEntries(sample)
  assert.deepEqual(groups.map(g => g.language), ['java', 'typescript'])
  assert.equal(groups[0].entries.length, 2)
  assert.equal(groups[1].entries.length, 1)
})

test('导出文本：一行一条，带标签列', () => {
  const text = exportLspConsoleText(sample, { language: 'java' })
  assert.equal(text.split('\n').length, 2)
  assert.equal(text.split('\n')[0], '09:08:07 ERROR 导入失败')
  assert.match(text.split('\n')[1], /^09:08:07 INFO  window\/showMessage: 索引中$/)
})

// ── 九、上游锚点逐行核内容 ─────────────────────────────────────────────────────────────

test('上游锚点逐行核内容：那几处打印出口/标签/文案确实长在这些行上', (t) => {
  const consolePath = 'platform/lsp-impl/src/impl/serviceView/LspClientConsole.kt'
  const supportPath = 'platform/lsp-impl/src/impl/serviceView/LspServiceViewSupport.kt'
  const descriptorPath = 'platform/lsp-impl/src/impl/serviceView/LspClientServiceViewDescriptor.kt'
  const bundlePath = 'platform/lsp/resources/messages/LspBundle.properties'
  const completionPath = 'platform/lsp-impl/src/impl/features/completion/LspCompletionObject.kt'
  const contributorPath = 'platform/lsp-impl/src/impl/features/completion/LspCompletionContributor.kt'
  const managerPath = 'platform/lsp-impl/src/impl/LspClientManagerImpl.kt'
  const contentTypePath = 'platform/ide-core/src/com/intellij/execution/ui/ConsoleViewContentType.java'
  if (!existsSync(join(REF, consolePath))) { t.skip('参考树不在本机'); return }
  const read = rel => readFileSync(join(REF, rel), 'utf8').split('\n')

  const console = read(consolePath)
  assert.match(console[29], /TIMESTAMP_FORMAT = DateTimeFormatter\.ofPattern\("HH:mm:ss"\)/, 'LspClientConsole :30')
  assert.match(console[30], /MAX_TRAFFIC_PAYLOAD_LENGTH = 10_000/, ':31')
  assert.match(console[31], /MAX_STORED_PAYLOAD_LENGTH = 100_000/, ':32')
  assert.match(console[46], /fun printLogMessage\(type: MessageType, message: String\)/, ':47')
  assert.match(console[47], /print\(type\.levelTag\(\), message, type\.contentType\(\)\)/, ':48')
  assert.match(console[49], /fun printShowMessage\(type: MessageType, message: String\)/, ':50')
  assert.match(console[50], /print\(type\.levelTag\(\), "window\/showMessage: \$message", type\.contentType\(\)\)/, ':51')
  assert.match(console[52], /fun printTrace\(message: String\)/, ':53')
  assert.match(console[53], /print\("TRACE", message, ConsoleViewContentType\.LOG_VERBOSE_OUTPUT\)/, ':54')
  assert.match(console[55], /fun printLifecycle\(message: @NlsSafe String, error: Boolean = false\)/, ':56')
  assert.match(console[56], /if \(error\) ConsoleViewContentType\.LOG_ERROR_OUTPUT else ConsoleViewContentType\.SYSTEM_OUTPUT/, ':57')
  assert.match(console[59], /fun printTraffic\(outbound: Boolean, message: Message, json: String\)/, ':60')
  assert.match(console[61], /is RequestMessage -> "request '\$\{message\.method\}' \(id=\$\{message\.id\}\)"/, ':62')
  assert.match(console[62], /is ResponseMessage -> "response \(id=\$\{message\.id\}\)"/, ':63')
  assert.match(console[63], /is NotificationMessage -> "notification '\$\{message\.method\}'"/, ':64')
  assert.match(console[64], /else -> "message"/, ':65')
  assert.match(console[67], /if \(outbound\) ConsoleViewContentType\.LOG_DEBUG_OUTPUT else ConsoleViewContentType\.LOG_VERBOSE_OUTPUT/, ':68')
  assert.match(console[68], /val tag = if \(outbound\) "OUT" else "IN"/, ':69')
  assert.match(console[69], /val arrow = if \(outbound\) "→" else "←"/, ':70')
  assert.match(console[71], /tag\.padEnd\(5\)/, ':72')
  assert.match(console[91], /if \(tag != null\) append\(tag\.padEnd\(5\)\)\.append\(' '\)/, ':92')
  assert.match(console[92], /append\(cleanedMessage\.trimEnd\(\)\)/, ':93')
  assert.match(console[134], /internal fun trafficPayloadPreview\(json: String\)/, ':135')
  assert.match(console[136], /collapseWhiteSpace\(StringUtil\.convertLineSeparators\(json\)\)/, ':137')
  assert.match(console[138], /more characters\)"$/, ':139')
  assert.match(console[143], /private fun MessageType\.levelTag\(\)/, ':144')
  assert.match(console[144], /MessageType\.Error -> "ERROR"/, ':145')
  assert.match(console[145], /MessageType\.Warning -> "WARN"/, ':146')
  assert.match(console[146], /MessageType\.Info -> "INFO"/, ':147')
  assert.match(console[147], /MessageType\.Log -> "LOG"/, ':148')
  assert.match(console[148], /MessageType\.Debug -> "DEBUG"/, ':149')
  assert.match(console[151], /private fun MessageType\.contentType\(\)/, ':152')
  assert.match(console[155], /MessageType\.Log, MessageType\.Debug -> ConsoleViewContentType\.LOG_DEBUG_OUTPUT/, ':156')

  const support = read(supportPath)
  assert.match(support[41], /private val consoles = ConcurrentHashMap<LspClient, LspClientConsole>\(\)/, 'LspServiceViewSupport :42')
  assert.match(support[48], /printLifecycle\(LspBundle\.message\("services\.lsp\.console\.server\.starting"/, ':49')
  assert.match(support[59], /val nameAndVersion = listOfNotNull\(serverInfo\?\.name \?: lspClient\.descriptor\.presentableName, serverInfo\?\.version\)/, ':60')
  assert.match(support[60], /joinToString\(" "\)/, ':61')
  assert.match(support[61], /printLifecycle\(LspBundle\.message\("services\.lsp\.console\.server\.initialized", nameAndVersion\)\)/, ':62')
  assert.match(support[64], /printLifecycle\(LspBundle\.message\("services\.lsp\.console\.server\.stopped"\)\)/, ':65')
  assert.match(support[66], /printLifecycle\(LspBundle\.message\("services\.lsp\.console\.server\.terminated"\), error = true\)/, ':67')

  const descriptor = read(descriptorPath)
  assert.match(descriptor[31], /override fun getId\(\): String =/, ':32')
  assert.match(descriptor[32], /lspClient\.providerClass\.name/, ':33')
  assert.match(descriptor[33], /lspClient\.descriptor\.presentableName/, ':34')
  assert.match(descriptor[34], /lspClient\.descriptor\.roots\.joinToString\(","\) \{ it\.path \}/, ':35')
  assert.match(descriptor[80], /return if \(lspClients\.size >= 2 && roots\.size == 1\) "…\/\$\{roots\[0\]\.name\}" else null/, ':81')

  const bundle = read(bundlePath)
  assert.match(bundle[12], /services\.lsp\.root\.node=Language Servers \(LSP\)/, 'LspBundle.properties :13')
  assert.match(bundle[17], /services\.lsp\.console\.server\.starting=Starting \{0\}\\u2026/, ':18')
  assert.match(bundle[18], /services\.lsp\.console\.server\.initialized=Server initialized: \{0\}/, ':19')
  assert.match(bundle[19], /services\.lsp\.console\.server\.stopped=Server stopped/, ':20')
  assert.match(bundle[20], /services\.lsp\.console\.server\.terminated=Server terminated unexpectedly/, ':21')
  assert.match(bundle[21], /services\.lsp\.traffic\.popup\.payload\.truncated=\[payload truncated\]/, ':22')

  const contentType = read(contentTypePath)
  assert.match(contentType[41], /LOG_DEBUG_OUTPUT = new ConsoleViewContentType\("LOG_DEBUG_OUTPUT"/, 'ConsoleViewContentType :42')
  assert.match(contentType[45], /LOG_ERROR_OUTPUT = new ConsoleViewContentType\("LOG_ERROR_OUTPUT"/, ':46')
  assert.match(contentType[48], /SYSTEM_OUTPUT = new ConsoleViewContentType\("SYSTEM_OUTPUT"/, ':49')

  const completion = read(completionPath)
  assert.match(completion[37], /private var resolvedCompletionItem: CompletionItem\? = null/, 'LspCompletionObject :38')
  assert.match(completion[48], /if \(resolvedCompletionItem != null\) return/, ':49')
  assert.match(completion[50], /resolveProvider != true/, ':51')
  assert.match(completion[51], /resolvedCompletionItem = initialCompletionItem/, ':52')
  assert.match(completion[63], /resolvedCompletionItem = rawResolvedCompletionItem \?: initialCompletionItem/, ':64')

  const contributor = read(contributorPath)
  assert.match(contributor[36], /for \(client in LspClientManagerImpl\.getInstanceImpl\(project\)\.getClientsWithThisFileOpen\(file\)\)/, 'LspCompletionContributor :37')
  assert.match(contributor[86], /val requestSemaphore = Semaphore\(2\)/, ':87')

  const manager = read(managerPath)
  assert.match(manager[49], /private const val MAX_LSP_CLIENTS = 10/, 'LspClientManagerImpl :50')
  assert.match(manager[99], /internal fun getClientsWithThisFileOpen\(file: VirtualFile\)/, ':100')
  assert.match(manager[100], /lspClients\.filter \{ it\.isFileOpened\(file\) \}/, ':101')
  assert.match(manager[112], /internal fun getClientsForFileRequests\(file: VirtualFile\): Collection<LspClientImpl> \{/, ':113')
  assert.match(manager[113], /val clientsWithFileOpen = getClientsWithThisFileOpen\(file\)/, ':114')
  assert.match(manager[114], /if \(clientsWithFileOpen\.isNotEmpty\(\)\) return clientsWithFileOpen/, ':115')
})

test('上游锚点：那两处合并调用点确实是 flatMap / firstOrNull 的形状', (t) => {
  if (!existsSync(REF)) { t.skip('参考树不在本机'); return }
  const read = rel => readFileSync(join(REF, rel), 'utf8').split('\n')
  const folding = read('platform/lsp-impl/src/impl/features/folding/LspFoldingBuilder.kt')
  assert.match(folding[26], /\.getClientsWithThisFileOpen\(file\)/, 'LspFoldingBuilder :27')
  assert.match(folding[27], /\.flatMap \{ it\.getFoldingRangeInfos\(file\) \}/, ':28')
  const structure = read('platform/lsp-impl/src/impl/features/documentSymbol/LspStructureViewSupport.kt')
  assert.match(structure[29], /getClientsWithThisFileOpen\(file\)\.firstOrNull \{/, 'LspStructureViewSupport :30')
  const inlay = read('platform/lsp-impl/src/impl/features/inlayHint/LspInlayHintRendering.kt')
  assert.match(inlay[35], /return clients\.flatMap \{ client ->/, 'LspInlayHintRendering :36')
  const highlighting = read('platform/lsp-impl/src/impl/features/highlighting/LspHighlightingApplier.kt')
  assert.match(highlighting[156], /for \(client in clients\) \{/, 'LspHighlightingApplier :157')
})