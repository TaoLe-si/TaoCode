// 意图开关设置 —— 上游 `IntentionManagerImpl`/`IntentionActionMetaData` 的「按意图启用/停用」
// 用户面（Settings ▸ Editor ▸ Intentions 的清单）。
//
// 本仓的清单只有**本地意图**这一族（`src/suppressIntention.ts` 生成的抑制条目，经
// `src/localIntentions.ts` 进 Alt+Enter 列表）：语言服务返回的 quickfix 由服务器决定，
// 宿主没有开关面。于是这里给每个抑制形态一条开关 + 一个总开关，供两处共用：
//   · Alt+Enter 列表（`src/semanticActions.ts` 的 openCodeActions）；
//   · 问题面板逐行的抑制菜单（`src/components/ProblemsPanel.vue`）。
// 停用的意图不进列表（上游 `IntentionManager.getActiveIntentions` 过滤停用项同义）。
//
// 设置入口：问题面板工具栏的「意图…」弹层（Settings 面板由别的模块持有，本轮不新开设置页 ——
// 本仓设置树的页面注册在冻结文件里，这条差异写进判决词）。
import { ref } from 'vue'

export interface LocalIntentionEntry {
  id: string
  title: string
  /** 设置清单里的分组名（按语言，与 suppressIntention 的 switch 分档一致）。 */
  group: string
}

/** 本地抑制形态清单（id 与 `suppressOptionsFor` 返回的 `SuppressOption.id` 一一对应）。 */
export const LOCAL_INTENTIONS: readonly LocalIntentionEntry[] = [
  { id: 'noinspection', group: 'Java', title: '//noinspection <Id> 抑制' },
  { id: 'suppress-warnings', group: 'Java', title: '@SuppressWarnings("all")' },
  { id: 'eslint-disable-next-line', group: 'JavaScript/TypeScript', title: '// eslint-disable-next-line' },
  { id: 'ts-ignore', group: 'JavaScript/TypeScript', title: '// @ts-ignore' },
  { id: 'noqa', group: 'Python', title: '# noqa' },
  { id: 'type-ignore', group: 'Python', title: '# type: ignore' },
  { id: 'nolint', group: 'C/C++ 与 Go', title: '// NOLINT / //nolint' },
  { id: 'pragma-diagnostic', group: 'C/C++ 与 Go', title: '#pragma clang diagnostic ignored' },
  { id: 'generic', group: '其他语言', title: '通用注释抑制' },
]

export interface IntentionSettings {
  /** 总开关：关掉后 Alt+Enter 与面板都不出本地抑制条目（服务端 quickfix 不受影响）。 */
  enabled: boolean
  /** 停用的意图 id。 */
  disabled: string[]
}

const STORAGE_KEY = 'taocode.intentionSettings'

export const intentionSettings = ref<IntentionSettings>(readStored())

function readStored(): IntentionSettings {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return { enabled: true, disabled: [] }
    const disabled = Array.isArray(parsed.disabled)
      ? parsed.disabled.filter((id: unknown): id is string => typeof id === 'string')
      : []
    return { enabled: parsed.enabled !== false, disabled }
  } catch {
    return { enabled: true, disabled: [] }
  }
}

function writeStored(value: IntentionSettings) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时只影响持久化，当前会话内的开关照常生效。
  }
}

/** 这条意图现在是否可用（总开关 + 单条开关；未知 id 只受总开关管）。 */
export function isIntentionEnabled(id: string): boolean {
  return intentionSettings.value.enabled && !intentionSettings.value.disabled.includes(id)
}

export function setIntentionEnabled(id: string, enabled: boolean): void {
  const disabled = intentionSettings.value.disabled.filter(item => item !== id)
  if (!enabled) disabled.push(id)
  intentionSettings.value = { ...intentionSettings.value, disabled }
  writeStored(intentionSettings.value)
}

export function setAllIntentionsEnabled(enabled: boolean): void {
  intentionSettings.value = { ...intentionSettings.value, enabled }
  writeStored(intentionSettings.value)
}

export function resetIntentionSettings(): void {
  intentionSettings.value = { enabled: true, disabled: [] }
  writeStored(intentionSettings.value)
}

/** 设置清单里的一行（分组 + 标题 + 开关值），面板直接渲染。 */
export function intentionEntries(): Array<LocalIntentionEntry & { enabled: boolean }> {
  return LOCAL_INTENTIONS.map(entry => ({ ...entry, enabled: isIntentionEnabled(entry.id) }))
}
