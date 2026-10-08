// Composer **正文**草稿的持久化：一个工作区一份文件，按 scope 存一格正文。
//
// 为什么不并进 `agentSessions.ts`（会话库）：
//   · 上游本来就是两份东西 —— `composerDraftStore.ts` 自己有键空间
//     （`zcode-v4-composer-drafts:v1:<workspace>`，见 `:37/:61-64`），本模块的键与 scope 口径逐条照它；
//   · 正文**每次输入**都要落盘（上游 `handleEditorChange` → `updateComposerContent` → `:228`
//     立即 `persistV4ComposerDraft`，防抖那 350ms 只用来补 Lexical 的 editorStateJson，本仓没有它），
//     而会话库那个键里装着最多 50 场的完整转写：每敲一个字序列化全库是不必要的重活。
//     两份键各写各的 —— 会话库在发消息/改选择时写，正文只写自己这一小份。
//
// scope 口径照上游：`scopeId = sessionId`；还没绑定会话时 `__draft__`（`V4_DRAFT_SCOPE_ROOT`）。
// 空正文不写空壳（`persistV4ComposerDraft:185-196` 的清扫分支：`!draft.text.trim()` 且没有别的内容
// ⇒ 删掉这一格）；本模块只管正文，模型选择那一格仍归会话库。
//
// 存档口径与 `agentSessions.ts` 同一族：窄的 storage 接口、缺省 localStorage、取不到就内存模式、
// 坏存档永不抛；能救的留下，救不了的丢这一格，不整库作废。

import { storageKeyForProject } from './agentSessions.ts'

/** 存储键族：与 `taocode.agent.sessions` 并列，工作区后缀口径相同（上游 v4 前缀独立同一意图）。 */
export const AGENT_COMPOSER_DRAFTS_STORAGE_KEY = 'taocode.agent.composerDrafts'

/** 还没绑定会话时正文草稿的 scope 键（ZCode `V4_DRAFT_SCOPE_ROOT`）。 */
export const AGENT_DRAFT_SCOPE_ROOT = '__draft__'

/** 存档文件形状（照 `V4DraftFile`）：版本号 + scope → 正文。 */
interface DraftFile {
  version: 1
  scopes: Record<string, string>
}

/** 存储的窄接口（测试传内存实现；真页面不给就用 localStorage）。`removeItem` 可选：没有就写空文件。 */
export interface AgentComposerDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface AgentComposerDraftStore {
  /** 读某 scope 的正文；没有这一格给空串。 */
  read(scopeId: string): string
  /**
   * 写某 scope 的正文。空、或 trim 后为空 ⇒ 这一格删掉（等于"没有草稿"，不写空壳）；
   * scope 是空串返回 false（没有可写的落点）。
   */
  write(scopeId: string, text: string): boolean
}

function defaultStorage(): AgentComposerDraftStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 读存档。非 JSON、非对象、版本不是 1、scopes 不是对象：当空。坏的格子只丢自己。 */
function parseDrafts(raw: string | null): DraftFile {
  const empty: DraftFile = { version: 1, scopes: {} }
  if (!raw) return empty
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return empty
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const body = value as Record<string, unknown>
  if (body.version !== 1 || !body.scopes || typeof body.scopes !== 'object' || Array.isArray(body.scopes)) return empty
  const scopes: Record<string, string> = {}
  for (const [scope, text] of Object.entries(body.scopes as Record<string, unknown>)) {
    // 正文必须是字符串且 trim 后非空，其余（数字、空白、空串）整格丢掉。
    if (!scope.trim() || typeof text !== 'string' || !text.trim()) continue
    scopes[scope] = text
  }
  return { version: 1, scopes }
}

/**
 * 建草稿库。
 * `storage` 不传：尝试 localStorage，取不到（Node、隐私模式）就只活在内存里；传 null：明确内存模式。
 * `projectRoot` 决定工作区后缀：换工作区就是另一份草稿（与 `createAgentSessionStore` 同口径）。
 */
export function createAgentComposerDraftStore(storage?: AgentComposerDraftStorage | null, projectRoot?: string): AgentComposerDraftStore {
  const backing = storage === undefined ? defaultStorage() : storage
  const storageKey = storageKeyForProject(AGENT_COMPOSER_DRAFTS_STORAGE_KEY, projectRoot)
  let file: DraftFile = { version: 1, scopes: {} }
  if (backing) {
    try {
      file = parseDrafts(backing.getItem(storageKey))
    } catch {
      file = { version: 1, scopes: {} }
    }
  }

  const persist = (): void => {
    if (!backing) return
    try {
      // 一格不剩就把键删掉（上游 `writeDraftFile:150-153` 的 removeItem 分支）；没有 removeItem 的
      // 存储实现退回写空文件 —— 读回来同样是"没有草稿"。
      if (Object.keys(file.scopes).length === 0 && typeof backing.removeItem === 'function') {
        backing.removeItem(storageKey)
        return
      }
      backing.setItem(storageKey, JSON.stringify(file))
    } catch {
      // 配额满 / 隐私模式：这一次没写上，内存里的草稿仍然是真的。下次能写再写。
    }
  }

  return {
    read(scopeId) {
      const scope = typeof scopeId === 'string' ? scopeId.trim() : ''
      return (scope && file.scopes[scope]) || ''
    },
    write(scopeId, text) {
      const scope = typeof scopeId === 'string' ? scopeId.trim() : ''
      if (!scope) return false
      const next = typeof text === 'string' && text.trim() ? text : ''
      if (next) file.scopes = { ...file.scopes, [scope]: next }
      else if (file.scopes[scope] !== undefined) {
        const rest = { ...file.scopes }
        delete rest[scope]
        file.scopes = rest
      } else return true
      persist()
      return true
    },
  }
}
