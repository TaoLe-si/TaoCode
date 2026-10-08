// Agent 聊天窗口模型选择的判据（2026-10-07）。
//
// 为什么单独一份：这些规则是「当前模型值怎么显示 / 下拉哪些项可选 / 管理模型入口何时出现」，
// 全部来自 ZCode 真源码（见 src/agentModelSelection.ts 顶部出处）。规则一旦漂移，
// 界面上表现为「模型名显示错」「点不动」「入口消失」，所以每条分支都钉一个用例。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUSTOM_MODEL_VALUE_PREFIX,
  MANAGE_MODELS_LABEL,
  MODEL_SWITCH_LOCKED_MESSAGE,
  MODEL_SWITCH_LOCKED_SHORT_LABEL,
  MODEL_TRIGGER_FALLBACK_LABEL,
  MODEL_TRIGGER_TOOLTIP,
  decodeCustomModelValue,
  encodeCustomModelValue,
  flattenModelSelectOptions,
  isModelItemLocked,
  isModelOptionLocked,
  resolveModelSelectTriggerDisplay,
  resolveModelValueDisplayLabel,
  shouldShowManageModelsAction,
} from '../src/agentModelSelection.ts'

function groupWithItems(key, label, items) {
  return { key, label, items }
}

const GROUPS = [
  groupWithItems('family:glm', 'GLM', [
    { key: 'glm:glm-4.6', value: encodeCustomModelValue('glm', 'glm-4.6'), name: 'glm-4.6' },
    {
      key: 'glm:glm-4.5-air',
      value: encodeCustomModelValue('glm', 'glm-4.5-air'),
      name: 'glm-4.5-air',
      supportsVisionInput: true,
    },
  ]),
  groupWithItems('family:anthropic', 'Anthropic', [
    {
      key: 'anthropic:claude-sonnet-4',
      value: 'anthropic/claude-sonnet-4',
      name: 'claude-sonnet-4',
      badgeLabel: 'Plan',
    },
  ]),
]

// —— 编解码（shared/src/custom-model-value.ts） ——

test('custom 值前缀是 ZCode 的 custom:', () => {
  assert.equal(CUSTOM_MODEL_VALUE_PREFIX, 'custom:')
})

test('encodeCustomModelValue：无 modelName 只编码 providerId，有则冒号拼接', () => {
  assert.equal(encodeCustomModelValue('glm'), 'custom:glm')
  assert.equal(encodeCustomModelValue('glm', 'glm-4.6'), 'custom:glm:glm-4.6')
})

test('encodeCustomModelValue：providerId 与 modelName 都走 encodeURIComponent', () => {
  assert.equal(encodeCustomModelValue('a/b', 'c:d'), 'custom:a%2Fb:c%3Ad')
})

test('decodeCustomModelValue：非 custom: 前缀回 null', () => {
  assert.equal(decodeCustomModelValue('glm-4.6'), null)
  assert.equal(decodeCustomModelValue('anthropic/claude-sonnet-4'), null)
  assert.equal(decodeCustomModelValue(''), null)
})

test('decodeCustomModelValue：无冒号 = 只有 providerId', () => {
  assert.deepEqual(decodeCustomModelValue('custom:glm'), { providerId: 'glm' })
})

test('decodeCustomModelValue：providerId:modelName 常规形态', () => {
  assert.deepEqual(decodeCustomModelValue('custom:glm:glm-4.6'), {
    providerId: 'glm',
    modelName: 'glm-4.6',
  })
})

test('decodeCustomModelValue：modelName 里的冒号原样保留', () => {
  assert.deepEqual(decodeCustomModelValue('custom:glm:a:b'), {
    providerId: 'glm',
    modelName: 'a:b',
  })
})

test('decodeCustomModelValue：builtin: 两段 legacy 形态拼回 providerId', () => {
  assert.deepEqual(decodeCustomModelValue('custom:builtin:zai:glm-4.6'), {
    providerId: 'builtin:zai',
    modelName: 'glm-4.6',
  })
})

test('decodeCustomModelValue：百分号编码解回原文', () => {
  assert.deepEqual(decodeCustomModelValue('custom:a%2Fb:c%3Ad'), {
    providerId: 'a/b',
    modelName: 'c:d',
  })
})

test('decodeCustomModelValue：解码失败回原串，不抛错', () => {
  assert.deepEqual(decodeCustomModelValue('custom:%'), { providerId: '%' })
  assert.deepEqual(decodeCustomModelValue('custom:p:%'), { providerId: 'p', modelName: '%' })
})

test('encode → decode 往返一致', () => {
  const value = encodeCustomModelValue('anthropic', 'claude-sonnet-4')
  assert.deepEqual(decodeCustomModelValue(value), {
    providerId: 'anthropic',
    modelName: 'claude-sonnet-4',
  })
})

// —— resolveModelValueDisplayLabel（modelSelection.ts:8-21） ——

test('显示名：custom 值取解码出的 modelName', () => {
  assert.equal(resolveModelValueDisplayLabel('custom:glm:glm-4.6'), 'glm-4.6')
})

test('显示名：custom 值 modelName 为空时不取 providerId，原样返回', () => {
  assert.equal(resolveModelValueDisplayLabel('custom:glm'), 'custom:glm')
})

test('显示名：按第一个 / 切、取后半段', () => {
  assert.equal(resolveModelValueDisplayLabel('anthropic/claude-sonnet-4'), 'claude-sonnet-4')
  assert.equal(resolveModelValueDisplayLabel('a/b/c'), 'b/c')
})

test('显示名：/ 在首尾或不存在时原样返回', () => {
  assert.equal(resolveModelValueDisplayLabel('glm-4.6'), 'glm-4.6')
  assert.equal(resolveModelValueDisplayLabel('/leading'), '/leading')
  assert.equal(resolveModelValueDisplayLabel('trailing/'), 'trailing/')
})

test('显示名：两侧空白被裁掉', () => {
  assert.equal(resolveModelValueDisplayLabel('  glm-4.6  '), 'glm-4.6')
  assert.equal(resolveModelValueDisplayLabel(' provider / model '), 'model')
})

// —— shouldShowManageModelsAction（modelSelection.ts:4-6） ——

test('管理模型入口：只有函数才算可用', () => {
  assert.equal(shouldShowManageModelsAction(() => {}), true)
  assert.equal(shouldShowManageModelsAction(undefined), false)
})

test('管理模型入口：非函数一律 false', () => {
  assert.equal(shouldShowManageModelsAction(null), false)
  assert.equal(shouldShowManageModelsAction('manage'), false)
  assert.equal(shouldShowManageModelsAction({}), false)
})

// —— resolveModelSelectTriggerDisplay（modelSelection.ts:23-54） ——

test('触发器：<synthetic>（任意大小写/空白）→ 值占位全 undefined', () => {
  assert.deepEqual(resolveModelSelectTriggerDisplay('<synthetic>', GROUPS, true, '管理模型'), {
    value: undefined,
    placeholder: undefined,
  })
  // 用「空分组 + 有管理入口」做反例：若 synthetic 分支漏判（未裁空白/未折大小写），
  // 会落到「无分组 + 有管理入口」分支给出「管理模型」占位，这里必须仍是 undefined。
  assert.deepEqual(resolveModelSelectTriggerDisplay('  <SYNTHETIC>  ', [], true, MANAGE_MODELS_LABEL), {
    value: undefined,
    placeholder: undefined,
  })
})

test('触发器：命中组内 item → 回原值、无占位', () => {
  const value = encodeCustomModelValue('glm', 'glm-4.6')
  assert.deepEqual(resolveModelSelectTriggerDisplay(value, GROUPS, false), {
    value,
    placeholder: undefined,
  })
})

test('触发器：命中第二个分组的 item 也算命中', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('anthropic/claude-sonnet-4', GROUPS, false),
    { value: 'anthropic/claude-sonnet-4', placeholder: undefined },
  )
})

test('触发器：未命中且两档占位都关 → 全 undefined', () => {
  assert.deepEqual(resolveModelSelectTriggerDisplay('custom:gone:dead-model', GROUPS, false), {
    value: undefined,
    placeholder: undefined,
  })
})

test('触发器：allowUnavailableCustomModelPlaceholder 用解码 modelName 占位', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('custom:gone:dead-model', GROUPS, false, undefined, {
      allowUnavailableCustomModelPlaceholder: true,
    }),
    { value: undefined, placeholder: 'dead-model' },
  )
})

test('触发器：custom 档只认能解出 modelName 的值', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('custom:gone', GROUPS, false, undefined, {
      allowUnavailableCustomModelPlaceholder: true,
    }),
    { value: undefined, placeholder: undefined },
  )
})

test('触发器：allowUnavailableModelPlaceholder 用显示名占位', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('anthropic/claude-sonnet-4-x', GROUPS, false, undefined, {
      allowUnavailableModelPlaceholder: true,
    }),
    { value: undefined, placeholder: 'claude-sonnet-4-x' },
  )
})

test('触发器：可用模型档对空值不占位', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('   ', GROUPS, false, undefined, {
      allowUnavailableModelPlaceholder: true,
    }),
    { value: undefined, placeholder: undefined },
  )
})

test('触发器：两档同开时 custom 档优先', () => {
  assert.deepEqual(
    resolveModelSelectTriggerDisplay('custom:gone:dead-model', GROUPS, false, undefined, {
      allowUnavailableCustomModelPlaceholder: true,
      allowUnavailableModelPlaceholder: true,
    }),
    { value: undefined, placeholder: 'dead-model' },
  )
})

test('触发器：无分组 + 有管理入口 → placeholder = 管理模型文案', () => {
  assert.deepEqual(resolveModelSelectTriggerDisplay('', [], true, MANAGE_MODELS_LABEL), {
    value: undefined,
    placeholder: MANAGE_MODELS_LABEL,
  })
})

test('触发器：无分组但无管理入口 → 全 undefined', () => {
  assert.deepEqual(resolveModelSelectTriggerDisplay('', [], false, MANAGE_MODELS_LABEL), {
    value: undefined,
    placeholder: undefined,
  })
})

test('触发器：有分组时即便有管理入口也不吃管理文案', () => {
  assert.deepEqual(resolveModelSelectTriggerDisplay('', GROUPS, true, MANAGE_MODELS_LABEL), {
    value: undefined,
    placeholder: undefined,
  })
})

// —— flattenModelSelectOptions ——

test('摊平：按分组顺序 → 组内顺序，带分组键与标签', () => {
  const flat = flattenModelSelectOptions(GROUPS)
  assert.equal(flat.length, 3)
  assert.deepEqual(
    flat.map((row) => [row.groupKey, row.groupLabel, row.name]),
    [
      ['family:glm', 'GLM', 'glm-4.6'],
      ['family:glm', 'GLM', 'glm-4.5-air'],
      ['family:anthropic', 'Anthropic', 'claude-sonnet-4'],
    ],
  )
})

test('摊平：item 自带字段（badgeLabel / supportsVisionInput）保留', () => {
  const flat = flattenModelSelectOptions(GROUPS)
  assert.equal(flat[1].supportsVisionInput, true)
  assert.equal(flat[2].badgeLabel, 'Plan')
})

test('摊平：空分组输入得空数组', () => {
  assert.deepEqual(flattenModelSelectOptions([]), [])
})

// —— isModelOptionLocked（workspaceBusyTaskLock.ts:30-66） ——

test('锁：没有选中供应商时永不锁', () => {
  const input = {
    activeTaskId: 't1',
    taskRuntimeByTaskId: { t1: { status: 'streaming', provider: 'glm' } },
  }
  assert.equal(isModelOptionLocked(null, input), false)
  assert.equal(isModelOptionLocked('', input), false)
})

test('锁：streaming 且同供应商 → 锁', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      taskRuntimeByTaskId: { t1: { status: 'streaming', provider: 'glm' } },
    }),
    true,
  )
})

test('锁：creating / restoring 也算忙', () => {
  for (const status of ['creating', 'restoring']) {
    assert.equal(
      isModelOptionLocked('glm', { taskRuntimeByTaskId: { t1: { status, provider: 'glm' } } }),
      true,
    )
  }
})

test('锁：非忙状态（idle/completed/failed）不锁', () => {
  for (const status of ['idle', 'completed', 'failed', 'cancelled']) {
    assert.equal(
      isModelOptionLocked('glm', { taskRuntimeByTaskId: { t1: { status, provider: 'glm' } } }),
      false,
    )
  }
})

test('锁：忙任务属于别的供应商 → 不锁', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      taskRuntimeByTaskId: { t1: { status: 'streaming', provider: 'anthropic' } },
    }),
    false,
  )
})

test('锁：runtime 缺 provider 时回退 taskListCache', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      taskRuntimeByTaskId: { t1: { status: 'streaming' } },
      taskListCache: [{ taskId: 't1', provider: 'glm' }],
    }),
    true,
  )
})

test('锁：optimistic 元覆盖 taskListCache 的 provider', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      taskRuntimeByTaskId: { t1: { status: 'streaming' } },
      taskListCache: [{ taskId: 't1', provider: 'anthropic' }],
      optimisticTaskMetaByTaskId: { t1: { provider: 'glm' } },
    }),
    true,
  )
})

test('锁：runtime.provider 优先于缓存', () => {
  assert.equal(
    isModelOptionLocked('anthropic', {
      taskRuntimeByTaskId: { t1: { status: 'streaming', provider: 'anthropic' } },
      taskListCache: [{ taskId: 't1', provider: 'glm' }],
    }),
    true,
  )
})

test('锁：provider 全缺失时只兜底锁 activeTask', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      activeTaskId: 't1',
      taskRuntimeByTaskId: { t1: { status: 'streaming' } },
    }),
    true,
  )
  assert.equal(
    isModelOptionLocked('glm', {
      activeTaskId: 't9',
      taskRuntimeByTaskId: { t1: { status: 'streaming' } },
    }),
    false,
  )
})

test('锁：activeTaskId 两侧空白被规范化', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      activeTaskId: '  t1  ',
      taskRuntimeByTaskId: { t1: { status: 'streaming' } },
    }),
    true,
  )
})

test('锁：provider 缺失且无 activeTaskId → 不锁（不误判）', () => {
  assert.equal(
    isModelOptionLocked('glm', { taskRuntimeByTaskId: { t1: { status: 'streaming' } } }),
    false,
  )
})

test('锁：空输入 / 无 input 不锁', () => {
  assert.equal(isModelOptionLocked('glm'), false)
  assert.equal(isModelOptionLocked('glm', {}), false)
})

test('锁：多个忙任务任一命中即锁', () => {
  assert.equal(
    isModelOptionLocked('glm', {
      taskRuntimeByTaskId: {
        t1: { status: 'streaming', provider: 'anthropic' },
        t2: { status: 'creating', provider: 'glm' },
      },
    }),
    true,
  )
})

test('isModelItemLocked 与 isModelOptionLocked 同判据（候选值不参与判定）', () => {
  const input = {
    taskRuntimeByTaskId: { t1: { status: 'streaming', provider: 'glm' } },
  }
  assert.equal(isModelItemLocked('custom:glm:glm-4.6', 'glm', input), true)
  assert.equal(isModelItemLocked('anthropic/claude-sonnet-4', 'glm', input), true)
  assert.equal(isModelItemLocked('anything', 'anthropic', input), false)
})

// —— 文案常量：逐字取自 zh-CN.ts ——

test('锁文案逐字等于 chat.toolbar.modelSwitch.lockedByRunningTask', () => {
  assert.equal(MODEL_SWITCH_LOCKED_MESSAGE, '当前有任务运行中，完成后可切换模型供应商。')
})

test('锁短标签逐字等于 chat.toolbar.modelSwitch.lockedByRunningTask.short', () => {
  assert.equal(MODEL_SWITCH_LOCKED_SHORT_LABEL, '任务运行中')
})

test('管理模型文案逐字等于 chat.toolbar.model.manageModels', () => {
  assert.equal(MANAGE_MODELS_LABEL, '管理模型')
})

test('触发器兜底文案逐字等于 chat.toolbar.model.label', () => {
  assert.equal(MODEL_TRIGGER_FALLBACK_LABEL, '选择模型')
})

test('触发器提示逐字等于 chat.toolbar.model.description', () => {
  assert.equal(MODEL_TRIGGER_TOOLTIP, '选择当前任务使用的模型。快捷键只打开模型菜单。')
})