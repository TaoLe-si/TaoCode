// Agent 聊天工具条「思考档 / 模式切换」纯逻辑判据。
//
// 只测表与纯函数本身；AgentPanel.vue 的接线不在这里重复。
// 上游出处见 src/agentComposerControls.ts 的逐行注释（.tools/ZCode 文件:行号）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_THOUGHT_LEVEL_VALUES,
  THOUGHT_LEVEL_LABEL_IDS,
  ZCODE_AGENT_PROVIDER,
  ZCODE_AGENT_MODE_OPTIONS,
  ZCODE_MODE_OPTION_LABEL_IDS,
  ZCODE_MODE_OPTION_DESCRIPTION_IDS,
  AGENT_THOUGHT_LEVEL_TEXT,
  AGENT_MODE_TEXT,
  AGENT_COMPOSER_TOOLBAR_TEXT,
  DEFAULT_AGENT_COMPOSER_DRAFT_MODE,
  normalizeThoughtLevelText,
  thoughtLevelLabelId,
  isNoThoughtLevel,
  getNextThoughtLevelValue,
  getThoughtLevelLabelText,
  getZCodeAgentAvailableModes,
  getZCodeAgentPermissionModes,
  getZCodeAgentPlanMode,
  resolveSelectedPermissionMode,
  buildPermissionModeOption,
  getNextPermissionModeValue,
  applyAgentComposerModeSelection,
  getModeOptionLabelMessageId,
  getModeOptionDescriptionMessageId,
  getModeOptionDisplayLabel,
  resolveModeOptionIconName,
  getNextConfigSelectValue,
  getChatToolbarShortcutKey,
  agentComposerText,
} from '../src/agentComposerControls.ts'

// ── 思考档表（thoughtLevelOptions.ts）────────────────────────────────────

test('NO_THOUGHT_LEVEL_VALUES 逐字等于源码的 8 个关闭值', () => {
  assert.deepEqual(
    [...NO_THOUGHT_LEVEL_VALUES],
    ['disabled', 'false', 'no', 'none', 'nothink', 'no-think', 'no_think', 'off'],
  )
})

test('THOUGHT_LEVEL_LABEL_IDS 的键与词条 id 逐字等于源码', () => {
  assert.equal(Object.keys(THOUGHT_LEVEL_LABEL_IDS).length, 21)
  // 关闭组（8 个）→ off
  for (const value of ['disabled', 'false', 'no', 'none', 'nothink', 'no-think', 'no_think', 'off']) {
    assert.equal(THOUGHT_LEVEL_LABEL_IDS[value], 'chat.toolbar.thoughtLevel.value.off', value)
  }
  // 开启组（4 个）→ on
  for (const value of ['enable', 'enabled', 'on', 'true']) {
    assert.equal(THOUGHT_LEVEL_LABEL_IDS[value], 'chat.toolbar.thoughtLevel.value.on', value)
  }
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.low, 'chat.toolbar.thoughtLevel.value.low')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.minimal, 'chat.toolbar.thoughtLevel.value.minimal')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.medium, 'chat.toolbar.thoughtLevel.value.medium')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.high, 'chat.toolbar.thoughtLevel.value.high')
  // xhigh 的三个别名
  assert.equal(THOUGHT_LEVEL_LABEL_IDS['extra-high'], 'chat.toolbar.thoughtLevel.value.xhigh')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.extra_high, 'chat.toolbar.thoughtLevel.value.xhigh')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.xhigh, 'chat.toolbar.thoughtLevel.value.xhigh')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.max, 'chat.toolbar.thoughtLevel.value.max')
  assert.equal(THOUGHT_LEVEL_LABEL_IDS.ultra, 'chat.toolbar.thoughtLevel.value.ultra')
})

test('normalizeThoughtLevelText = trim + 小写；查表忽略大小写与空白', () => {
  assert.equal(normalizeThoughtLevelText('  HIGH '), 'high')
  assert.equal(thoughtLevelLabelId('  ULTRA '), 'chat.toolbar.thoughtLevel.value.ultra')
  assert.equal(thoughtLevelLabelId('Extra-High'), 'chat.toolbar.thoughtLevel.value.xhigh')
})

test('thoughtLevelLabelId：表里没有的档位名返回 undefined', () => {
  assert.equal(thoughtLevelLabelId('mystery'), undefined)
  assert.equal(thoughtLevelLabelId(''), undefined)
})

test('isNoThoughtLevel 只看 value，且大小写/空白不敏感', () => {
  assert.equal(isNoThoughtLevel({ value: 'OFF' }), true)
  assert.equal(isNoThoughtLevel({ value: ' no_think ' }), true)
  assert.equal(isNoThoughtLevel({ value: 'high' }), false)
  assert.equal(isNoThoughtLevel({ value: 'ultra' }), false)
})

test('getThoughtLevelLabelText：命中词条用中文原文，否则回落 entry.name', () => {
  assert.equal(getThoughtLevelLabelText('ultra', 'Ultra'), '极致')
  assert.equal(getThoughtLevelLabelText('MINIMAL', 'Minimal'), '极低')
  assert.equal(getThoughtLevelLabelText('mystery', 'Mystery Level'), 'Mystery Level')
})

test('getThoughtLevelLabelText：原型键不是词条（Object.hasOwn 守卫，thoughtLevelOptions.ts:81）', () => {
  assert.equal(getThoughtLevelLabelText('constructor', 'Constructor'), 'Constructor')
  assert.equal(getThoughtLevelLabelText('toString', 'ToString'), 'ToString')
})

test('getNextThoughtLevelValue：按声明顺序循环，末尾回到首档', () => {
  const option = {
    type: 'select',
    currentValue: 'low',
    options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
  }
  assert.equal(getNextThoughtLevelValue(option), 'medium')
  assert.equal(getNextThoughtLevelValue({ ...option, currentValue: 'high' }), 'low')
})

test('getNextThoughtLevelValue：未选中/失效值 → 第一档', () => {
  const option = { type: 'select', currentValue: 'ghost', options: [{ value: 'low' }, { value: 'high' }] }
  assert.equal(getNextThoughtLevelValue(option), 'low')
})

test('getNextThoughtLevelValue：非 select、无 options、只有一档 → null', () => {
  assert.equal(getNextThoughtLevelValue({ type: 'text', currentValue: 'low', options: [{ value: 'low' }, { value: 'high' }] }), null)
  assert.equal(getNextThoughtLevelValue({ type: 'select', currentValue: 'low' }), null)
  assert.equal(getNextThoughtLevelValue({ type: 'select', currentValue: 'low', options: [] }), null)
  assert.equal(getNextThoughtLevelValue({ type: 'select', currentValue: 'low', options: [{ value: 'low' }] }), null)
})

// ── 模式目录（shared）+ 词条表（display-help.ts）────────────────────────

test('provider 常量与 shared 的 ZCODE_AGENT_PROVIDER 一致', () => {
  assert.equal(ZCODE_AGENT_PROVIDER, 'glm')
})

test('模式目录四条、顺序与 id/name/description 逐字等于 shared 源', () => {
  assert.deepEqual(ZCODE_AGENT_MODE_OPTIONS.map(mode => mode.id), ['build', 'edit', 'plan', 'yolo'])
  assert.deepEqual(ZCODE_AGENT_MODE_OPTIONS[0], {
    id: 'build', name: 'Ask before changes', description: 'Ask before each file changes.',
  })
  assert.deepEqual(ZCODE_AGENT_MODE_OPTIONS[1], {
    id: 'edit', name: 'Edit automatically',
    description: 'Edit selected files or relevant workspace files automatically.',
  })
  assert.deepEqual(ZCODE_AGENT_MODE_OPTIONS[2], {
    id: 'plan', name: 'Plan mode', description: 'Inspect the code and present a plan before editing.',
  })
  assert.deepEqual(ZCODE_AGENT_MODE_OPTIONS[3], {
    id: 'yolo', name: 'Full access', description: 'Edit and run commands with fewer confirmations.',
  })
})

test('getZCodeAgentAvailableModes 返回拷贝，改它不动目录', () => {
  const modes = getZCodeAgentAvailableModes()
  modes[0].id = 'mutated'
  assert.equal(ZCODE_AGENT_MODE_OPTIONS[0].id, 'build')
  assert.deepEqual(getZCodeAgentAvailableModes().map(mode => mode.id), ['build', 'edit', 'plan', 'yolo'])
})

test('ZCODE_MODE_OPTION_LABEL_IDS / DESCRIPTION_IDS 逐字等于 display-help.ts', () => {
  assert.deepEqual(ZCODE_MODE_OPTION_LABEL_IDS, {
    glm: {
      build: 'mode.label.glm.build', edit: 'mode.label.glm.edit',
      plan: 'mode.label.glm.plan', yolo: 'mode.label.glm.yolo',
    },
  })
  assert.deepEqual(ZCODE_MODE_OPTION_DESCRIPTION_IDS, {
    glm: {
      build: 'mode.description.glm.build', edit: 'mode.description.glm.edit',
      plan: 'mode.description.glm.plan', yolo: 'mode.description.glm.yolo',
    },
  })
})

test('getModeOptionLabelMessageId：provider 缺席或 value 无词条 → null', () => {
  assert.equal(getModeOptionLabelMessageId('glm', 'build'), 'mode.label.glm.build')
  assert.equal(getModeOptionLabelMessageId(undefined, 'build'), null)
  assert.equal(getModeOptionLabelMessageId('glm', 'ghost'), null)
})

test('getModeOptionDescriptionMessageId：同上口径', () => {
  assert.equal(getModeOptionDescriptionMessageId('glm', 'plan'), 'mode.description.glm.plan')
  assert.equal(getModeOptionDescriptionMessageId(undefined, 'plan'), null)
  assert.equal(getModeOptionDescriptionMessageId('glm', 'ghost'), null)
})

test('getModeOptionDisplayLabel：命中词条用中文，否则回落 entry.name', () => {
  assert.equal(getModeOptionDisplayLabel('glm', { value: 'yolo', name: 'Full access' }), '完全访问')
  assert.equal(getModeOptionDisplayLabel('glm', { value: 'build', name: 'Ask before changes' }), '变更前确认')
  assert.equal(getModeOptionDisplayLabel('glm', { value: 'ghost', name: 'Ghost Mode' }), 'Ghost Mode')
  assert.equal(getModeOptionDisplayLabel(undefined, { value: 'build', name: 'Ask before changes' }), 'Ask before changes')
})

// ── 模式图标（display.tsx:206-220）──────────────────────────────────────

test('resolveModeOptionIconName：判定顺序 yolo → build → plan → 编辑族 → Hand', () => {
  assert.equal(resolveModeOptionIconName('yolo'), 'ShieldAlert')
  assert.equal(resolveModeOptionIconName('build'), 'Hand')
  assert.equal(resolveModeOptionIconName('BUILD'), 'Hand')
  assert.equal(resolveModeOptionIconName('plan'), 'NotepadText')
  assert.equal(resolveModeOptionIconName('edit'), 'ShieldCheck')
  assert.equal(resolveModeOptionIconName('auto'), 'ShieldCheck')
  assert.equal(resolveModeOptionIconName('agent'), 'ShieldCheck')
  assert.equal(resolveModeOptionIconName('autoEdit'), 'ShieldCheck')
  assert.equal(resolveModeOptionIconName('EDIT'), 'ShieldCheck')
  assert.equal(resolveModeOptionIconName('unknown'), 'Hand')
  assert.equal(resolveModeOptionIconName(undefined), 'Hand')
  assert.equal(resolveModeOptionIconName(42), 'Hand')
})

// ── 权限单选 + Plan 独立勾选（V4ComposerModeControls.tsx）────────────────

test('权限项 = 目录去掉 plan；plan 单独取出', () => {
  assert.deepEqual(getZCodeAgentPermissionModes().map(mode => mode.id), ['build', 'edit', 'yolo'])
  assert.equal(getZCodeAgentPlanMode().id, 'plan')
  assert.equal(getZCodeAgentPlanMode().name, 'Plan mode')
})

test('resolveSelectedPermissionMode：命中权限项，plan/未知值 → undefined', () => {
  assert.equal(resolveSelectedPermissionMode('edit').id, 'edit')
  assert.equal(resolveSelectedPermissionMode('plan'), undefined)
  assert.equal(resolveSelectedPermissionMode('ghost'), undefined)
})

test('buildPermissionModeOption：currentValue = 草稿 mode，options 不含 plan', () => {
  const option = buildPermissionModeOption({ mode: 'yolo', planEnabled: false })
  assert.equal(option.type, 'select')
  assert.equal(option.currentValue, 'yolo')
  assert.deepEqual(option.options.map(entry => entry.value), ['build', 'edit', 'yolo'])
  assert.equal(option.options.some(entry => entry.value === 'plan'), false)
})

test('buildPermissionModeOption：草稿 mode 缺席回落 build', () => {
  assert.equal(buildPermissionModeOption({ mode: undefined, planEnabled: false }).currentValue, DEFAULT_AGENT_COMPOSER_DRAFT_MODE)
  assert.equal(DEFAULT_AGENT_COMPOSER_DRAFT_MODE, 'build')
})

test('getNextPermissionModeValue：在权限三项里循环，跳过 plan', () => {
  assert.equal(getNextPermissionModeValue({ mode: 'build', planEnabled: false }), 'edit')
  assert.equal(getNextPermissionModeValue({ mode: 'edit', planEnabled: false }), 'yolo')
  assert.equal(getNextPermissionModeValue({ mode: 'yolo', planEnabled: false }), 'build')
  assert.equal(getNextPermissionModeValue({ mode: 'ghost', planEnabled: false }), 'build')
})

test('applyAgentComposerModeSelection：plan/plan-off 只改勾选，权限值只改单选', () => {
  const base = { mode: 'build', planEnabled: false }
  // Plan 勾选 / 取消：权限单选不动
  assert.deepEqual(applyAgentComposerModeSelection(base, 'plan'), { mode: 'build', planEnabled: true })
  assert.deepEqual(applyAgentComposerModeSelection({ mode: 'yolo', planEnabled: true }, 'plan-off'), { mode: 'yolo', planEnabled: false })
  // 权限单选：勾选态不动
  assert.deepEqual(applyAgentComposerModeSelection({ mode: 'build', planEnabled: true }, 'yolo'), { mode: 'yolo', planEnabled: true })
})

test('Plan 勾选与权限单选正交：勾上 plan 后仍可换权限，权限换了 plan 仍开着', () => {
  let draft = { mode: 'build', planEnabled: false }
  draft = applyAgentComposerModeSelection(draft, 'plan')
  draft = applyAgentComposerModeSelection(draft, 'edit')
  assert.deepEqual(draft, { mode: 'edit', planEnabled: true })
  draft = applyAgentComposerModeSelection(draft, 'plan-off')
  assert.deepEqual(draft, { mode: 'edit', planEnabled: false })
})

test('applyAgentComposerModeSelection 不就地改入参（只编辑草稿的拷贝）', () => {
  const base = { mode: 'build', planEnabled: false }
  applyAgentComposerModeSelection(base, 'yolo')
  assert.deepEqual(base, { mode: 'build', planEnabled: false })
})

// ── 循环 + 快捷键槽（toolbarShortcuts.ts）────────────────────────────────

test('getNextConfigSelectValue：按 options 顺序循环；空 options 或非 select → null', () => {
  const option = { type: 'select', currentValue: 'a', options: [{ value: 'a' }, { value: 'b' }] }
  assert.equal(getNextConfigSelectValue(option), 'b')
  assert.equal(getNextConfigSelectValue({ ...option, currentValue: 'b' }), 'a')
  assert.equal(getNextConfigSelectValue({ ...option, currentValue: 'ghost' }), 'a')
  assert.equal(getNextConfigSelectValue({ type: 'select', currentValue: 'a', options: [] }), null)
  assert.equal(getNextConfigSelectValue({ type: 'text', currentValue: 'a', options: [{ value: 'a' }, { value: 'b' }] }), null)
})

test('getNextConfigSelectValue 与 getNextThoughtLevelValue 的守卫差异（0 档 vs <2 档）', () => {
  const single = { type: 'select', currentValue: 'low', options: [{ value: 'low' }] }
  assert.equal(getNextConfigSelectValue(single), 'low') // 一档也算「有 options」，循环回自身
  assert.equal(getNextThoughtLevelValue(single), null) // 思考档要求 ≥2
})

test('getChatToolbarShortcutKey：category → 热键槽位，其它 → null', () => {
  assert.equal(getChatToolbarShortcutKey('model'), 'm')
  assert.equal(getChatToolbarShortcutKey('mode'), 'ctrlShiftM')
  assert.equal(getChatToolbarShortcutKey('thought_level'), 't')
  assert.equal(getChatToolbarShortcutKey('other'), null)
})

// ── 中文原文（zh-CN.ts）────────────────────────────────────────────────

test('AGENT_THOUGHT_LEVEL_TEXT 的 9 条中文原文逐字等于 zh-CN.ts', () => {
  assert.deepEqual(AGENT_THOUGHT_LEVEL_TEXT, {
    'chat.toolbar.thoughtLevel.value.off': '关闭',
    'chat.toolbar.thoughtLevel.value.on': '开启',
    'chat.toolbar.thoughtLevel.value.minimal': '极低',
    'chat.toolbar.thoughtLevel.value.low': '低',
    'chat.toolbar.thoughtLevel.value.medium': '中',
    'chat.toolbar.thoughtLevel.value.high': '高',
    'chat.toolbar.thoughtLevel.value.xhigh': '极高',
    'chat.toolbar.thoughtLevel.value.max': '最高',
    'chat.toolbar.thoughtLevel.value.ultra': '极致',
  })
})

test('AGENT_MODE_TEXT 的标签/描述中文原文逐字等于 zh-CN.ts', () => {
  assert.deepEqual(AGENT_MODE_TEXT, {
    'mode.plan': '计划',
    'mode.label.glm.build': '变更前确认',
    'mode.label.glm.edit': '自动编辑',
    'mode.label.glm.plan': '计划模式',
    'mode.label.glm.yolo': '完全访问',
    'mode.description.glm.build': '改文件前先问我。',
    'mode.description.glm.edit': '自动编辑文件。',
    'mode.description.glm.plan': '编辑前先出计划。',
    'mode.description.glm.yolo': '减少确认次数。',
  })
})

test('工具条标签/提示中文原文逐字等于 zh-CN.ts', () => {
  assert.deepEqual(AGENT_COMPOSER_TOOLBAR_TEXT, {
    'chat.toolbar.mode.label': '切换模式',
    'chat.plan.removeMarker': '关闭计划模式',
    'chat.toolbar.thoughtLevel.label': '推理强度',
    'chat.toolbar.thoughtLevel.tooltip': '思考级别',
    'chat.toolbar.thoughtLevel.placeholder': '选择思考档位',
  })
})

test('agentComposerText：三张表都能查到，未知 id → undefined', () => {
  assert.equal(agentComposerText('chat.toolbar.mode.label'), '切换模式')
  assert.equal(agentComposerText('chat.toolbar.thoughtLevel.value.ultra'), '极致')
  assert.equal(agentComposerText('mode.label.glm.yolo'), '完全访问')
  assert.equal(agentComposerText('no.such.key'), undefined)
})

test('词条 id 与中文原文一一对应（映射表每个 id 都能取到原文）', () => {
  for (const labelId of Object.values(THOUGHT_LEVEL_LABEL_IDS)) {
    assert.ok(AGENT_THOUGHT_LEVEL_TEXT[labelId], labelId)
  }
  for (const labelId of Object.values(ZCODE_MODE_OPTION_LABEL_IDS.glm)) {
    assert.ok(AGENT_MODE_TEXT[labelId], labelId)
  }
  for (const descriptionId of Object.values(ZCODE_MODE_OPTION_DESCRIPTION_IDS.glm)) {
    assert.ok(AGENT_MODE_TEXT[descriptionId], descriptionId)
  }
})