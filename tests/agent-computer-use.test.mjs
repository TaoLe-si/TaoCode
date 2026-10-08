// 「浏览器控制」+「电脑控制」判定层判据 —— 对照 ZCode `.tools/ZCode`。
//
// 这一份是**纯判定层**的判据，所以覆盖面按「每个平台 × 每个授权状态」铺开：
//   · 8 种 kind 各判一次（`computerUseAvailability.ts:4-12, 28-59`），含**远端优先**的次序；
//   · 权限四值 `granted / stale / denied / unknown` 各判一次，其中 `unknown` **不算**缺权限
//     （`cuaPermissionPreparation.ts:4-6, 12-24`）；
//   · 重启复查的三条终局各判一次（`cuaPermissionRestartVerify.ts:25-56`）；
//   · Chrome 导入摘要的错误码映射与「部分成功」分支（`browserImportSummary.ts:9-56`）。
// 每条「不许出现 X」都配一条阳性对照。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_BROWSER_CONTROL_TITLE,
  AGENT_COMPUTER_USE_STORAGE_KEY,
  AGENT_COMPUTER_USE_TITLE,
  CUA_RESTART_VERIFY_INTERVAL_MS,
  CUA_RESTART_VERIFY_TIMEOUT_MS,
  ZCODE_BROWSER_USE_PLUGIN_ID,
  browserControlAvailability,
  browserImportSummary,
  computerUseAvailability,
  cuaPermissionPreparation,
  cuaRestartVerification,
  defaultAgentComputerUseState,
  isRemoteWorkspaceIdentity,
  loadAgentComputerUseState,
  saveAgentComputerUseState,
} from '../src/agentComputerUse.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

test('节标题与常量逐字对齐 ZCode', () => {
  assert.equal(AGENT_COMPUTER_USE_TITLE, '电脑控制', 'ZCode zh-CN.ts:6474 settings.computerUse.title')
  assert.equal(AGENT_BROWSER_CONTROL_TITLE, '浏览器控制', 'ZCode zh-CN.ts:2267 settings.browser.title')
  assert.equal(ZCODE_BROWSER_USE_PLUGIN_ID, 'browser-use@zcode-plugins-official', 'ZCode BrowserSettingsSection.tsx:30')
  assert.equal(CUA_RESTART_VERIFY_TIMEOUT_MS, 6000, 'ZCode cuaPermissionRestartVerify.ts:20')
  assert.equal(CUA_RESTART_VERIFY_INTERVAL_MS, 500, 'ZCode cuaPermissionRestartVerify.ts:21')
})

test('电脑控制：8 种 kind 逐个判对，判定顺序与 ZCode 一致', () => {
  // 远端优先于「是不是桌面」：ZCode computerUseAvailability.ts:41-54 在 :55 之前就 return 了。
  const desktop = { isDesktop: true, isMacDesktop: false, isWindowsDesktop: false }
  const cases = [
    [{ isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }, {}, 'local-macos', true],
    [{ isDesktop: true, isMacDesktop: false, isWindowsDesktop: true }, {}, 'local-windows', true],
    [desktop, {}, 'local-linux', false],
    [{ isDesktop: false, isMacDesktop: false, isWindowsDesktop: false }, {}, 'web', false],
    // 下面四条：即使传了 macOS 桌面，远端信号也必须先把结果改掉（次序判据）。
    [{ isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }, { remoteTarget: { kind: 'ssh' } }, 'remote-ssh', false],
    [{ isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }, { remoteTarget: { kind: 'wsl' } }, 'remote-wsl', false],
    [{ isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }, { remoteTarget: { kind: 'docker' } }, 'remote-docker', false],
    [{ isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }, { remoteTarget: { kind: 'sftp' } }, 'remote-server', false],
  ]
  for (const [platform, state, kind, supported] of cases) {
    const availability = computerUseAvailability(platform, state)
    assert.equal(availability.kind, kind, `kind 应为 ${kind}（ZCode computerUseAvailability.ts:42-58）`)
    assert.equal(availability.supported, supported, `${kind} 的 supported 应为 ${supported}`)
  }
  assert.equal(computerUseAvailability({ isDesktop: true, isMacDesktop: true }, { remoteSessionId: 's1' }).kind, 'remote-server',
    'ZCode :42-49：只有 remoteSessionId 时兜底 remote-server')
})

test('电脑控制：远端信号三种入口都成立（ZCode :36-40）', () => {
  const mac = { isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }
  for (const state of [
    { remoteSessionId: 'abc' },
    { remoteTarget: { kind: 'ssh' } },
    { workspaceIdentity: 'remote:ssh:host:22:root:/srv/app' },
    { workspaceIdentity: '  remote:docker:box:/srv/app  ' },
    { workspaceIdentity: 'remote:wsl:Ubuntu:root:/srv/app' },
  ]) {
    assert.equal(computerUseAvailability(mac, state).supported, false, `远端信号 ${JSON.stringify(state)} 必须判不可用`)
  }
  // 阳性对照：本地路径不构成远端信号。
  assert.equal(computerUseAvailability(mac, { workspaceIdentity: 'D:\\work\\app' }).kind, 'local-macos',
    '本地路径不是 remote identity')
  assert.equal(computerUseAvailability(mac, { workspaceIdentity: '' }).kind, 'local-macos', '空 identity 不是远端')
})

test('远程 identity 解析逐字对齐 ZCode（含 WSL 可选 user 段）', () => {
  assert.equal(isRemoteWorkspaceIdentity('remote:ssh:host:22:root:/srv/app'), true, 'ZCode remote-workspace-identity.ts:46-51')
  assert.equal(isRemoteWorkspaceIdentity('remote:wsl:Ubuntu:/srv/app'), true, 'ZCode :52-57 无 user 的 legacy 格式')
  assert.equal(isRemoteWorkspaceIdentity('remote:wsl:Ubuntu:root:/srv/app'), true, 'ZCode :56-58 显式 user 段')
  assert.equal(isRemoteWorkspaceIdentity('remote:docker:box:/srv/app'), true, 'ZCode :57')
  // path 段含 ":" 也算远端（ZCode :83-84 的注释：不能整体 split）。
  assert.equal(isRemoteWorkspaceIdentity('remote:ssh:host:22:root:/srv/a:b'), true, 'ZCode :83-84')
  assert.equal(isRemoteWorkspaceIdentity('D:\\work'), false, '本地路径')
  assert.equal(isRemoteWorkspaceIdentity('remote:ftp:host:/x'), false, 'ZCode :32-34 只认 ssh/wsl/docker')
  assert.equal(isRemoteWorkspaceIdentity('remote:ssh:host:22:root:srv/app'), false, 'ZCode :103-106：path 必须以 / 开头')
  assert.equal(isRemoteWorkspaceIdentity('remote:ssh:host:22'), false, 'ZCode :86-90：authority 段数不足')
})

test('电脑控制：不可用时必须说清缺什么，且文案分支选对', () => {
  const linux = computerUseAvailability({ isDesktop: true, isMacDesktop: false, isWindowsDesktop: false })
  assert.equal(linux.unsupportedMessageId, 'settings.computerUse.unsupported.linuxDescription',
    'ZCode zh-CN.ts:6486-6487 + ComputerUseSection.tsx:694-696')
  assert.ok(linux.missing.length > 0, '不可用必须给出有序缺口清单')
  assert.ok(linux.missing.some((m) => m.includes('Linux')), '缺口要指名 Linux')
  const remote = computerUseAvailability({ isDesktop: true, isMacDesktop: true }, { remoteTarget: { kind: 'ssh' } })
  assert.equal(remote.unsupportedMessageId, 'settings.computerUse.unsupported.remoteDescription',
    'ZCode zh-CN.ts:6484-6485 + ComputerUseSection.tsx:692-698')
  assert.ok(remote.missing.some((m) => m.includes('SSH')), '缺口要指名是哪一种远端')
  // 阳性对照：完全可用时 missing 为空、不给 unsupported 文案、ready 为真。
  const ok = computerUseAvailability({ isDesktop: true, isMacDesktop: true }, { pluginEnabled: true })
  assert.deepEqual(ok.missing, [], '可用时不该报缺口')
  assert.equal(ok.unsupportedMessageId, null, '可用时不挂不可用文案')
  assert.equal(ok.supported, true, 'supported 只承载 ZCode 的平台判定')
  assert.equal(ok.ready, true, '平台可用 + 无缺口 = ready')
})

test('电脑控制：macOS 桌面额外两道缺口（版本地板 + 插件总开关）进 missing/ready，不动 supported', () => {
  const mac = { isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }
  const noPlugin = computerUseAvailability(mac)
  assert.equal(noPlugin.supported, true, 'supported 逐字等于 ZCode 的平台判定：macOS 桌面为真（computerUseAvailability.ts:56）')
  assert.equal(noPlugin.ready, false, '插件总开关没开 → 真能开=false')
  assert.ok(noPlugin.missing.some((m) => m.includes('插件未启用')), '要指名缺插件总开关（ComputerUseSection.tsx:125-128）')
  const belowFloor = computerUseAvailability(mac, {
    pluginEnabled: true,
    osSupport: { kind: 'macos-below-minimum', minimumMacOs: '12.0', currentMacOs: '11.7' },
  })
  assert.equal(belowFloor.supported, true, '版本地板在 ZCode 是另判的（ComputerUseSection.tsx:123），不进 supported')
  assert.equal(belowFloor.ready, false, '低于地板 → 真能开=false')
  assert.ok(belowFloor.missing.some((m) => m.includes('12.0') && m.includes('11.7')), '要把地板与当前版本都写出来')
  // 查询失败按无门槛处理（ZCode ComputerUseSection.tsx:105）。
  const unknownOs = computerUseAvailability(mac, { pluginEnabled: true, osSupport: null })
  assert.equal(unknownOs.ready, true, 'osSupport 查不到不阻塞（ZCode :105）')
  // 阳性对照：not-applicable（Windows 侧不会走 macOS 门槛）不算缺口。
  assert.equal(computerUseAvailability(mac, { pluginEnabled: true, osSupport: { kind: 'not-applicable' } }).ready, true,
    '阳性对照：不是 macOS 就不查 macOS 门槛')
  // Windows 桌面只复用插件总开关，不查 TCC（ZCode :81 注释）。
  const win = computerUseAvailability({ isDesktop: true, isMacDesktop: false, isWindowsDesktop: true }, { pluginEnabled: true })
  assert.equal(win.ready, true, 'ZCode :81：Windows 只复用插件总开关')
  assert.equal(win.missing.length, 0, '阳性对照：Windows + 插件启用 → 零缺口')
  assert.equal(computerUseAvailability({ isDesktop: true, isMacDesktop: false, isWindowsDesktop: true }).ready, false,
    '反面：插件没启用就 ready=false')
})

test('权限准备：只有 denied / stale 算缺权限，unknown 不算', () => {
  const all = cuaPermissionPreparation({ available: true, accessibility: 'denied', screenRecording: 'stale' })
  assert.deepEqual(all.required, ['accessibility', 'screen_recording'],
    'ZCode cuaPermissionPreparation.ts:16-23：顺序固定 accessibility → screen_recording')
  assert.equal(all.ready, false)
  assert.equal(all.steps.length, 5, '准备步骤共 5 步（两项授权 + 重启 Helper + 复查 + 重启应用兜底）')
  assert.equal(all.steps[0].satisfied, false)
  assert.equal(all.steps[1].satisfied, false)

  // unknown **不是**权限缺口 —— ZCode :8-11 的注释：功能探针失败与 unknown 只能进验证/重试。
  const unknown = cuaPermissionPreparation({ available: true, accessibility: 'unknown', screenRecording: 'unknown' })
  assert.deepEqual(unknown.required, [], 'ZCode cuaPermissionPreparation.ts:4-6：只有 denied/stale 可操作')
  assert.equal(unknown.ready, true, 'unknown 不许把用户赶去系统设置里找一个不存在的授权项')

  const onlyStale = cuaPermissionPreparation({ available: true, accessibility: 'granted', screenRecording: 'stale' })
  assert.deepEqual(onlyStale.required, ['screen_recording'], 'granted 那项划掉')
  assert.equal(onlyStale.steps[0].satisfied, true, 'granted → 第一步不用做')
  assert.equal(onlyStale.steps[1].satisfied, false)

  assert.deepEqual(cuaPermissionPreparation(null).required, [], 'ZCode :15：没有新鲜快照时返回空')
  assert.equal(cuaPermissionPreparation(null).ready, true, '阳性对照：没有快照不等于缺权限')
  assert.equal(cuaPermissionPreparation({ available: true, accessibility: 'granted', screenRecording: 'granted' }).ready, true,
    '全 granted → 可以进下一步')
})

test('重启复查：granted / denied / unknown 都算解决，只有持续 stale 才升级', () => {
  for (const value of ['granted', 'denied', 'unknown']) {
    const result = cuaRestartVerification({ result: { available: true, accessibility: value, screenRecording: 'granted' }, elapsedMs: 100 })
    assert.equal(result.outcome, 'resolved', `accessibility=${value} 应判已解决（ZCode cuaPermissionRestartVerify.ts:32-33）`)
    assert.equal(result.shouldEscalate, false, `${value} 是真实权限缺口，不是重启失败，不升级`)
    assert.equal(result.continuePolling, false)
    assert.equal(result.resolved, true)
  }
  assert.ok(cuaRestartVerification({ result: { available: true, accessibility: 'granted', screenRecording: 'granted' }, elapsedMs: 100 })
    .detail.includes('granted'), '文案要带上实际读到的状态')
})

test('重启复查：stale 持续到超时才升级，期内继续轮询', () => {
  const stale = { available: true, accessibility: 'stale', screenRecording: 'stale' }
  const early = cuaRestartVerification({ result: stale, elapsedMs: 500 })
  assert.equal(early.outcome, 'pending', 'ZCode :44-55：stale 期内继续轮询')
  assert.equal(early.continuePolling, true, '继续轮询')
  assert.equal(early.shouldEscalate, false, '未到超时不许升级')
  assert.equal(early.intervalMs, 500, 'ZCode :21 默认轮询间隔')
  assert.equal(early.detail.includes('500ms'), true, '文案要报已过时长')

  const expired = cuaRestartVerification({ result: stale, elapsedMs: 6000 })
  assert.equal(expired.outcome, 'escalate', 'ZCode :29-30：直到超时仍 stale → 升级到「重启 ZCode」')
  assert.equal(expired.shouldEscalate, true, '升级到重启应用兜底')
  assert.equal(expired.continuePolling, false, '升级后不再轮询')
  assert.equal(expired.timeoutMs, 6000, 'ZCode :20 默认总超时')
})

test('重启复查：unavailable / 抛错按瞬时态处理，超时才升级', () => {
  const pending = cuaRestartVerification({ result: null, elapsedMs: 1000 })
  assert.equal(pending.outcome, 'pending', 'ZCode :35：unavailable 视为重启中途瞬时态，继续轮询')
  assert.equal(pending.continuePolling, true)
  assert.equal(pending.shouldEscalate, false)
  const expired = cuaRestartVerification({ result: null, elapsedMs: 6000 })
  assert.equal(expired.outcome, 'escalate', 'ZCode :35：超时仍未恢复 → 升级')
  assert.equal(expired.shouldEscalate, true)
  assert.ok(expired.detail.includes('可用'), '要说清是「拿不到可用的权限状态」而不是「权限被拒」')
  // 自定义超时（ZCode :41-42 的 options.timeoutMs / intervalMs）。
  const custom = cuaRestartVerification({ result: null, elapsedMs: 2000, timeoutMs: 1000, intervalMs: 250 })
  assert.equal(custom.outcome, 'escalate', '自定义 1000ms 超时在 2000ms 处已到')
  assert.equal(custom.intervalMs, 250, '自定义轮询间隔要透出给宿主排下一次')
})

test('Chrome 导入摘要：错误码逐个映射到 ZCode 的文案 key', () => {
  const cases = [
    ['chrome_profile_not_found', 'settings.browser.import.notFound'],
    ['chrome_default_profile_not_found', 'settings.browser.import.notFound'],
    ['chrome_profile_ambiguous', 'settings.browser.import.ambiguous'],
    ['chrome_executable_not_found', 'settings.browser.import.executableNotFound'],
    ['chrome_cookie_access_denied', 'settings.browser.import.accessDenied'],
    ['chrome_cookie_elevation_required', 'settings.browser.import.elevationRequired'],
    ['chrome_cookie_elevation_cancelled', 'settings.browser.import.elevationCancelled'],
    ['chrome_cookie_helper_verification_failed', 'settings.browser.import.helperVerificationFailed'],
    ['chrome_cookie_app_bound_decryption_failed', 'settings.browser.import.appBoundFailed'],
    ['chrome_cookie_protection_unsupported', 'settings.browser.import.cookieProtected'],
    ['chrome_profile_locked', 'settings.browser.import.profileLocked'],
    ['chrome_local_storage_import_failed', 'settings.browser.import.localStorageFailed'],
  ]
  for (const [error, id] of cases) {
    const summary = browserImportSummary({ success: false, error })
    assert.equal(summary.id, id, `错误码 ${error} 的文案 key（ZCode browserImportSummary.ts:9-33）`)
    assert.equal(summary.success, false)
    assert.equal(summary.partial, false, '失败态不标部分成功')
    assert.deepEqual(summary.values, {}, '失败态不带插值')
  }
  assert.equal(browserImportSummary({ success: false, error: 'some_future_code' }).id, 'settings.browser.import.failed',
    '未知错误码走兜底（ZCode :33），不许留空 key')
  assert.equal(browserImportSummary(null).id, 'settings.browser.import.failed', 'null 也走兜底，不许崩')
})

test('Chrome 导入摘要：成功态取值 + App-Bound 部分成功分支', () => {
  const ok = browserImportSummary({
    success: true,
    cookies: { imported: 12, skipped: 3 },
    localStorage: { originsImported: 4, entriesImported: 40 },
    issues: ['chrome_profile_locked'],
  })
  assert.equal(ok.id, 'settings.browser.import.success', 'ZCode :56：普通 issue 不影响成功态文案')
  assert.deepEqual(ok.values, { cookies: '12', origins: '4', entries: '40', skipped: '3' }, 'ZCode :36-41 的四个插值')
  assert.equal(ok.partial, false)
  for (const issue of [
    'chrome_cookie_elevation_required',
    'chrome_cookie_elevation_cancelled',
    'chrome_cookie_helper_verification_failed',
    'chrome_cookie_app_bound_decryption_failed',
  ]) {
    const partial = browserImportSummary({
      success: true, cookies: { imported: 0, skipped: 9 }, localStorage: { originsImported: 2, entriesImported: 5 }, issues: [issue],
    })
    assert.equal(partial.id, 'settings.browser.import.partialAppBound', `issue ${issue} 触发部分成功（ZCode :42-53）`)
    assert.equal(partial.partial, true, 'ZCode :54-56：部分成功要保留提示，避免误以为 Cookie 已导入')
  }
  const bare = browserImportSummary({ success: true })
  assert.deepEqual(bare.values, { cookies: '0', origins: '0', entries: '0', skipped: '0' }, '缺格补 0，不许出 undefined')
})

test('浏览器控制：比电脑控制多一条硬依赖（官方插件 + 内置浏览器通道）', () => {
  const mac = { isDesktop: true, isMacDesktop: true, isWindowsDesktop: false }
  const nothing = browserControlAvailability(mac)
  assert.equal(nothing.supported, true, 'supported 仍只承载 ZCode 的平台判定（macOS 桌面为真）')
  assert.equal(nothing.ready, false, 'ZCode BrowserSettingsSection.tsx:30：开关 = 那个官方插件的启用态，本仓装不了')
  assert.ok(nothing.missing.some((m) => m.includes(ZCODE_BROWSER_USE_PLUGIN_ID)), '缺口要指名是哪个插件')
  assert.equal(nothing.nativeActionsAvailable, true, 'ZCode :107-110：macOS 桌面有原生通道，所以这一条不报')
  assert.ok(!nothing.missing.some((m) => m.includes('内置浏览器')), '阴性对照：桌面端原生通道在，不该报这条')
  // 阳性对照：插件启用 + 桌面 → 零缺口，ready 为真 —— 证明上面不是恒真。
  const withPlugin = browserControlAvailability(mac, { pluginEnabled: true })
  assert.equal(withPlugin.nativeActionsAvailable, true)
  assert.equal(withPlugin.pluginEnabled, true)
  assert.deepEqual(withPlugin.missing, [], '阳性对照：桌面 + 插件启用 → 零缺口')
  assert.equal(withPlugin.ready, true)
  // 非桌面端：原生通道整块没有，报 ZCode 那句「只能在桌面端管理」对应的那条缺口。
  const web = browserControlAvailability({ isDesktop: false, isMacDesktop: false, isWindowsDesktop: false }, { pluginEnabled: true })
  assert.equal(web.nativeActionsAvailable, false, 'ZCode :302 + :335-339：非桌面端整块换成「只能在桌面端管理」')
  assert.equal(web.kind, 'web')
  assert.ok(web.missing.some((m) => m.includes('内置浏览器')), '非桌面端要报内置浏览器通道这条缺口')
  assert.equal(web.ready, false)
})

test('状态快照：往返 + 无存储/抛异常/坏 JSON 静默降级 + 非法 kind 退 web', () => {
  const storage = createMemoryStorage()
  const state = { kind: 'local-linux', supported: false, missing: ['缺一条', '  ', 7, '缺两条'], pluginEnabled: false }
  assert.equal(saveAgentComputerUseState(state, storage), true)
  assert.ok(storage.dump()[AGENT_COMPUTER_USE_STORAGE_KEY], `存档必须落在 ${AGENT_COMPUTER_USE_STORAGE_KEY} 上`)
  const back = loadAgentComputerUseState(storage)
  assert.deepEqual(back, { kind: 'local-linux', supported: false, missing: ['缺一条', '缺两条'], pluginEnabled: false })
  assert.deepEqual(loadAgentComputerUseState(null), defaultAgentComputerUseState(), '无存储 = 出厂默认')
  assert.deepEqual(loadAgentComputerUseState(createThrowingStorage()), defaultAgentComputerUseState(), 'getItem 抛异常 = 静默降级')
  assert.deepEqual(
    loadAgentComputerUseState(createMemoryStorage({ [AGENT_COMPUTER_USE_STORAGE_KEY]: '不是 json' })),
    defaultAgentComputerUseState(),
    '坏 JSON 退回默认',
  )
  assert.equal(saveAgentComputerUseState(state, null), false, '存不下只丢持久化')
  assert.equal(saveAgentComputerUseState(state, createThrowingStorage()), false, 'setItem 抛异常也只丢持久化')
  const bad = loadAgentComputerUseState(createMemoryStorage({
    [AGENT_COMPUTER_USE_STORAGE_KEY]: JSON.stringify({ kind: '火星', supported: 'yes', missing: 'x', pluginEnabled: 1 }),
  }))
  assert.equal(bad.kind, 'web', '未知 kind 退回 web')
  assert.equal(bad.supported, false, '非 true 的 supported 一律按 false')
  assert.deepEqual(bad.missing, [], '非数组的 missing 退回空')
  assert.equal(bad.pluginEnabled, false, '非 true 的 pluginEnabled 按 false')
  // 阳性对照：正常存档读得到。
  const good = createMemoryStorage()
  saveAgentComputerUseState({ kind: 'local-macos', supported: true, missing: [], pluginEnabled: true }, good)
  assert.equal(loadAgentComputerUseState(good).kind, 'local-macos', '阳性对照：存储可用时往返成立')
})
