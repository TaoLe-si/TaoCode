// `agent/hooks` 判据：ZCode「钩子」节的配置面 —— 出厂默认、坏存档逐字段救、保存前校验、
// 存储往返与降级、命令解析边界、信任门控、触发判定。
//
// 出处速查（ZCode，只读参照 `.tools/ZCode`）：
//   · 事件七值     packages/shared/src/hooks.ts:4-11
//   · HookType     packages/shared/src/hooks.ts:13
//   · 信任七态     packages/shared/src/zcode-protocol-v4/workspace-hook-review.ts:9-17
//   · reasonCode   packages/ui/src/settings/workspaceHookTrustState.ts:25-37
//   · 表单默认     packages/ui/src/settings/HookForm.tsx:96-105（event/type/timeout 60）
//   · 信任门控     packages/ui/src/settings/WorkspaceHookTrustNotice.tsx:7-9
//   · 开关置灰     packages/ui/src/settings/HooksList.tsx:299-302
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_HOOKS_STORAGE_KEY, AGENT_HOOK_EVENTS, AGENT_HOOK_TYPES, AGENT_HOOK_TRUST_STATES,
  AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS, AGENT_HOOK_REVIEW_FALLBACK_MESSAGE,
  AGENT_HOOK_TIMEOUT_MAX_SECONDS, AGENT_HOOK_TIMEOUT_MIN_SECONDS,
  defaultAgentHooks, hookEventOf, hookProgramProblem, hookReviewReasonMessage,
  loadAgentHooks, normalizeAgentHooks, parseHookCommand, requiresWorkspaceHookTrust,
  saveAgentHooks, shouldSilenceStaleHookRejection, validateAgentHooks,
} from '../src/agentHooks.ts'
import { createMemoryStorage, createThrowingStorage } from '../src/agentSettingsStore.ts'

/** 造一条合法 hook，只覆盖要测的字段。 */
function hook(overrides = {}) {
  return {
    id: 'hook-1', event: 'PreToolUse', type: 'process', matcher: '', command: 'echo hi',
    args: [], async: false, shell: '', statusMessage: '', timeoutSeconds: 60, enabled: true,
    scope: 'user', trust: 'not_applicable', readOnly: false, ...overrides,
  }
}

const withHooks = (hooks) => ({ hooks })

test('ZCode 事件七值与运行方式逐字对齐（hooks.ts:4-11 / :13，顺序照 HookForm.tsx:35-43）', () => {
  assert.deepEqual([...AGENT_HOOK_EVENTS], [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'PostToolUseFailure', 'Stop',
  ], 'ZCode HookEvent 的七值与顺序（HookForm.tsx:35-43 的 HOOK_EVENTS 同序）')
  assert.deepEqual([...AGENT_HOOK_TYPES], ['process', 'command'], 'HookForm.tsx:212 的下拉顺序')
  assert.deepEqual([...AGENT_HOOK_TRUST_STATES], [
    'not_applicable', 'pending_trust', 'trusted_persistent', 'blocked_untrusted',
    'blocked_policy', 'revoked', 'stale_digest',
  ], 'workspace-hook-review.ts:9-17 的七态')
})

test('出厂默认：空列表 + 超时 60 秒（HookForm.tsx:104 的 `hook?.timeout ?? 60`）', () => {
  const defaults = defaultAgentHooks()
  assert.deepEqual(defaults.hooks, [], 'ZCode 不预置任何钩子（HooksSection 无 seed）')
  assert.equal(AGENT_HOOK_DEFAULT_TIMEOUT_SECONDS, 60, 'HookForm.tsx:104 的默认值 60（单位秒）')
  const saved = normalizeAgentHooks({ hooks: [{}] })
  assert.equal(saved.hooks[0].timeoutSeconds, 60, '缺 timeoutSeconds 的条目退 60')
  assert.equal(saved.hooks[0].event, 'PreToolUse', '非法事件退 HookForm.tsx:96 的初值 PreToolUse')
  assert.equal(saved.hooks[0].enabled, true, 'HookForm.tsx:155 新建即开（enabled ?? true）')
  assert.equal(saved.hooks[0].trust, 'not_applicable', '非工作区 hook 不需要审核')
})

test('坏存档逐字段救：非法事件/类型/信任态退默认，超时越界夹回区间，字符串截长', () => {
  const saved = normalizeAgentHooks({ hooks: [{
    event: 'NotAnEvent', type: 'shell', trust: '随便写的态',
    timeoutSeconds: 999_999, matcher: 'x'.repeat(500), statusMessage: 'y'.repeat(500),
    command: 'c'.repeat(900), enabled: 'true', scope: '别的作用域',
  }] })
  const one = saved.hooks[0]
  assert.equal(one.event, 'PreToolUse', '非法事件退 PreToolUse')
  assert.equal(one.type, 'process', '非法运行方式退 process')
  assert.equal(one.trust, 'not_applicable', '非法信任态退 not_applicable')
  assert.equal(one.timeoutSeconds, AGENT_HOOK_TIMEOUT_MAX_SECONDS, '越界超时夹到上限')
  assert.equal(one.matcher.length, 200, '超长匹配器截断')
  assert.equal(one.statusMessage.length, 200, '超长状态消息截断')
  assert.equal(one.command.length, 512, '超长命令截断')
  assert.equal(one.enabled, true, '非布尔退默认（不把 "true" 当真）')
  assert.equal(one.scope, 'user', '非法作用域退 user')
})

test('垃圾条目只丢自己，不按字段数量判损坏（本仓铁律）', () => {
  const saved = normalizeAgentHooks({ hooks: [
    null, '不是对象', 42, [],
    hook({ id: 'good-1' }),
    hook({ id: 'good-2', type: 'command', args: ['不该留', ''], async: true }),
  ] })
  assert.equal(saved.hooks.length, 2, '前四个垃圾条目各丢自己，两条合法条目都在')
  // type=process 的 async/args 无意义（HookForm.tsx:142 的互斥分支），不留脏值。
  const first = saved.hooks[0]
  assert.equal(first.id, 'good-1')
  assert.deepEqual(first.args, [], '缺 args 补空数组')
  assert.equal(first.async, false)
  const second = saved.hooks[1]
  assert.equal(second.async, true, 'command 型保留 async')
  assert.deepEqual(second.args, [], 'command 型的 args 归零（HookForm.tsx:142 互斥）')
  // 缺 id 的条目补一个生成 id，不丢整表。
  const generated = normalizeAgentHooks({ hooks: [{ command: 'echo' }] })
  assert.ok(generated.hooks[0].id.startsWith('hook-'), '缺 id 补生成 id')
})

test('argv 只收字符串项：数字/对象被丢弃、空行被丢（HookForm.tsx:145-147）', () => {
  const saved = normalizeAgentHooks({ hooks: [hook({ args: ['  --flag  ', '', 42, { a: 1 }, 'ok'] })] })
  assert.deepEqual(saved.hooks[0].args, ['--flag', 'ok'], 'trim + 丢空 + 丢非字符串')
})

test('保存前校验拦下：空命令 / 超长命令 / 引号未闭合 / 不可执行程序', () => {
  const empty = validateAgentHooks(withHooks([hook({ command: '   ' })]))
  assert.ok(empty.some(p => p.includes('命令不能为空')), `空命令必须被拦下，实际：${JSON.stringify(empty)}`)

  const tooLong = validateAgentHooks(withHooks([hook({ command: 'c'.repeat(513) })]))
  assert.ok(tooLong.some(p => p.includes('最长 512')), '超长命令被拦下')

  const unclosed = validateAgentHooks(withHooks([hook({ command: 'echo "没闭合' })]))
  assert.ok(unclosed.some(p => p.includes('引号没有闭合')), `引号未闭合被拦下，实际：${JSON.stringify(unclosed)}`)

  // 「不可执行」是本仓自定的保守检查（ZCode 只判 command 非空），配阳性对照。
  const badProgram = validateAgentHooks(withHooks([hook({ command: 'a<b' })]))
  assert.ok(badProgram.some(p => p.includes('不能包含')), '含 < 的程序名被拦下')
  const goodProgram = validateAgentHooks(withHooks([hook({ command: 'a<b' .replace('<', '') })]))
  assert.deepEqual(goodProgram, [], `去掉 < 之后就该通过（阳性对照），实际：${JSON.stringify(goodProgram)}`)
})

test('`hookProgramProblem` 的每条「不许出现」都有阳性对照（防止永不命中的空判据）', () => {
  // 负向：三种「不是程序名」都要被拒。
  assert.match(hookProgramProblem(['.']) ?? '', /\.|\.\./, '「.」被拒')
  assert.match(hookProgramProblem(['..']) ?? '', /\.|\.\./, '「..」被拒')
  assert.match(hookProgramProblem(['a|b']) ?? '', /\|/, '含 | 被拒')
  assert.match(hookProgramProblem(['a\u0001b']) ?? '', /控制字符/, '含控制字符被拒')
  // 阳性对照：上面每条正则都必须真能命中合法程序名之外的东西，否则是空判据。
  // 用一个**必然应当通过**的输入证明判据不是恒真。
  assert.equal(hookProgramProblem(['node']), null, '正常程序名通过（证明上面几条不是恒真）')
  assert.equal(hookProgramProblem(['C:\\tools\\run.exe']), null, '带路径的程序名通过')
  // 阳性对照 2：直接验证被拒的三条确实是因为各自的原因，不是同一个兜底。
  assert.notEqual(hookProgramProblem(['.']), hookProgramProblem(['a|b']), '不同原因给出不同理由')
})

test('超时越界与非法枚举被校验拦下，整数要求先于区间', () => {
  const over = validateAgentHooks(withHooks([hook({ timeoutSeconds: AGENT_HOOK_TIMEOUT_MAX_SECONDS + 1 })]))
  assert.ok(over.some(p => p.includes('超时时间必须在')), '超上限被拦下')
  const under = validateAgentHooks(withHooks([hook({ timeoutSeconds: 0 })]))
  assert.ok(under.some(p => p.includes('超时时间必须在')), '低于下限被拦下')
  // 边界值本身合法 —— 阳性对照。
  assert.deepEqual(validateAgentHooks(withHooks([hook({ timeoutSeconds: AGENT_HOOK_TIMEOUT_MIN_SECONDS })])), [], '下界合法')
  assert.deepEqual(validateAgentHooks(withHooks([hook({ timeoutSeconds: AGENT_HOOK_TIMEOUT_MAX_SECONDS })])), [], '上界合法')
})

test('只读（工作区来源）且已启用的条目被拦下（HooksList.tsx:302 的 disabled 口径）', () => {
  const problems = validateAgentHooks(withHooks([hook({ readOnly: true, enabled: true, trust: 'pending_trust' })]))
  assert.ok(problems.some(p => p.includes('需先完成信任审核')), `只读行不许直接启用，实际：${JSON.stringify(problems)}`)
  // 阳性对照：已信任的只读行不算问题。
  const trusted = validateAgentHooks(withHooks([hook({ readOnly: true, enabled: false, trust: 'trusted_persistent' })]))
  assert.deepEqual(trusted, [], 'trusted_persistent 的只读行无问题（阳性对照）')
})

test('id 重复被拦下', () => {
  const problems = validateAgentHooks(withHooks([hook({ id: 'dup' }), hook({ id: 'dup' })]))
  assert.ok(problems.some(p => p.includes('重复')), '重复 id 被拦下')
  const unique = validateAgentHooks(withHooks([hook({ id: 'a' }), hook({ id: 'b' })]))
  assert.deepEqual(unique, [], '不同 id 无问题（阳性对照）')
})

test('存储往返：写入的 JSON 读回是同一份', () => {
  const storage = createMemoryStorage()
  const settings = withHooks([
    hook({ id: 'h1', command: 'git status', args: ['--short'], matcher: 'Bash' }),
    hook({ id: 'h2', type: 'command', event: 'Stop', async: true, shell: 'bash' }),
  ])
  assert.equal(saveAgentHooks(settings, storage), true, '写成功')
  assert.ok(storage.dump()[AGENT_HOOKS_STORAGE_KEY], `存档落在 ${AGENT_HOOKS_STORAGE_KEY}`)
  const back = loadAgentHooks(storage)
  assert.equal(back.hooks.length, 2)
  assert.deepEqual(back.hooks[0].args, ['--short'])
  assert.equal(back.hooks[0].matcher, 'Bash')
  assert.equal(back.hooks[1].type, 'command')
  assert.equal(back.hooks[1].shell, 'bash')
  assert.equal(back.hooks[1].async, true)
})

test('无存储 / 抛异常存储 / 非 JSON 存档：一律静默降级到默认，永不抛', () => {
  assert.deepEqual(loadAgentHooks(null), defaultAgentHooks(), '无存储退默认')
  assert.deepEqual(loadAgentHooks(createThrowingStorage()), defaultAgentHooks(), 'getItem 抛异常退默认')
  const broken = createMemoryStorage({ [AGENT_HOOKS_STORAGE_KEY]: '{不是 JSON' })
  assert.deepEqual(loadAgentHooks(broken), defaultAgentHooks(), '坏 JSON 退默认')
  // 写路径同样降级：抛异常只丢持久化，返回 false 而不是抛。
  assert.equal(saveAgentHooks(withHooks([hook()]), createThrowingStorage()), false, '写不进去返回 false')
  assert.equal(saveAgentHooks(withHooks([hook()]), null), false, '无存储返回 false')
})

test('命令解析边界：引号 / 空串 / 只有空白 / 未闭合 / 反斜杠转义', () => {
  assert.deepEqual(parseHookCommand('echo "a b" c').argv, ['echo', 'a b', 'c'], '双引号内的空格不切')
  assert.deepEqual(parseHookCommand('echo "a b" c').reason, null, '成功时 reason 为 null')
  assert.deepEqual(parseHookCommand('  ').argv, [], '只有空白 → 空 argv')
  assert.equal(parseHookCommand('  ').reason, '命令不能为空。', '只有空白的失败原因')
  assert.equal(parseHookCommand('').reason, '命令不能为空。', '空串的失败原因')
  assert.equal(parseHookCommand('echo "没闭合').reason, '命令里的引号没有闭合。', '未闭合被拦下')
  // 反斜杠转义：与 runConfigTree 的 CRT 规则一致（parseRunArguments:64）。
  assert.deepEqual(parseHookCommand('echo a\\"b').argv, ['echo', 'a"b'], '反斜杠转义引号')
  // 阳性对照：闭合引号必须不报错（证明上面的未闭合判据不是恒真）。
  assert.equal(parseHookCommand('echo "闭合了"').reason, null, '闭合引号通过（阳性对照）')
  assert.deepEqual(parseHookCommand('echo ""').argv, ['echo', ''], '空引号是一个空 token，不是没给')
})

test('命令解析复用本仓既有拆分：结果与 parseRunArguments 逐字一致', async () => {
  const { parseRunArguments } = await import('../src/runConfigTree.ts')
  for (const command of ['a b c', 'a "b c" d', 'x\\"y z', '  spaced   out  ']) {
    assert.deepEqual(parseHookCommand(command).argv, parseRunArguments(command.trim()),
      `"${command}" 的 argv 必须与 parseRunArguments 一致（不许另造一套拆分）`)
  }
})

test('信任门控：需要审核的工作区 hook 一律不触发（WorkspaceHookTrustNotice.tsx:7-9）', () => {
  const pending = hook({ readOnly: true, trust: 'pending_trust' })
  assert.equal(requiresWorkspaceHookTrust(pending), true, 'pending_trust 需要审核')
  assert.equal(hookEventOf(pending, { event: 'PreToolUse', toolName: 'Bash' }), false,
    '未过审的 hook 不触发，且开关被强制显示为关（HooksList.tsx:299-302）')
  const trusted = hook({ readOnly: true, trust: 'trusted_persistent' })
  assert.equal(requiresWorkspaceHookTrust(trusted), false, 'trusted_persistent 不需要审核')
  assert.equal(hookEventOf(trusted, { event: 'PreToolUse', toolName: 'Bash' }), true,
    '已信任的只读 hook 照常触发（阳性对照）')
  // 非工作区 hook（readOnly=false）永不要求审核。
  assert.equal(requiresWorkspaceHookTrust(hook()), false, '用户自建的 hook 不需要审核')
})

test('触发判定：停用的不触发、事件不匹配不触发、matcher 空则全匹配', () => {
  assert.equal(hookEventOf(hook({ enabled: false }), { event: 'PreToolUse' }), false, '停用的不触发')
  assert.equal(hookEventOf(hook(), { event: 'Stop' }), false, '事件不匹配不触发')
  assert.equal(hookEventOf(hook(), { event: 'PreToolUse' }), true, 'matcher 空 → 匹配全部输入（matcherHint）')
  assert.equal(hookEventOf(hook({ matcher: 'Bash, Edit' }), { event: 'PreToolUse', toolName: 'bash' }), true,
    'matcher 大小写不敏感地命中')
  assert.equal(hookEventOf(hook({ matcher: 'Bash, Edit' }), { event: 'PreToolUse', toolName: 'Write' }), false,
    '不命中则不触发')
  // 阳性对照：matcher 非空但现场没有工具名时**不**匹配（否则等于放行一切）。
  assert.equal(hookEventOf(hook({ matcher: 'Bash' }), { event: 'PreToolUse' }), false, '有 matcher 但无工具名 → 不触发')
})

test('reasonCode 文案：11 个码逐字命中，未知码回退「操作被拒绝」而不是原始 id', () => {
  // 逐个码验证映射表真的非空（防止表被清空后判据仍然"通过"）。
  for (const code of [
    'workspace_hooks_review_superseded', 'workspace_hooks_snapshot_mismatch',
    'workspace_hooks_bundle_changed', 'workspace_hooks_config_unreadable',
    'workspace_hooks_config_write_failed', 'workspace_hooks_config_rebuild_failed',
    'workspace_hooks_trust_store_corrupt', 'workspace_hooks_blocked_by_policy',
    'workspace_hooks_policy_requires_pretrust', 'workspace_hooks_interaction_timeout',
    'workspace_hooks_require_trust_capable_host',
  ]) {
    const message = hookReviewReasonMessage(code)
    assert.notEqual(message, AGENT_HOOK_REVIEW_FALLBACK_MESSAGE, `码 ${code} 必须有专属文案（workspaceHookTrustState.ts:25-37）`)
    assert.ok(!message.includes(code), `文案里不许漏出原始枚举 id（${code}）`)
  }
  assert.equal(hookReviewReasonMessage('workspace_hooks_unknown_future_code'), AGENT_HOOK_REVIEW_FALLBACK_MESSAGE,
    '未知码回退通用文案')
  assert.equal(hookReviewReasonMessage(undefined), AGENT_HOOK_REVIEW_FALLBACK_MESSAGE, '缺码也回退')
})

test('superseded 静默规则照 workspaceHookTrustState.ts:65-71', () => {
  assert.equal(shouldSilenceStaleHookRejection({
    reasonCode: 'workspace_hooks_review_superseded', hasLivePendingBinding: false,
  }), true, '审核已终结 → 静默')
  assert.equal(shouldSilenceStaleHookRejection({
    reasonCode: 'workspace_hooks_review_superseded', hasLivePendingBinding: true,
  }), false, '仍有 live binding → 必须展示')
  assert.equal(shouldSilenceStaleHookRejection({
    reasonCode: 'workspace_hooks_blocked_by_policy', hasLivePendingBinding: false,
  }), false, '非 superseded 类一律展示')
})