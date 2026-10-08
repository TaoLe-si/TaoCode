// Agent 右侧对话的会话库：多份对话的列表、当前选中、改名、转写落盘。
//
// 为什么单独一个模块：`src/agentSession.ts` 只管「这一场对话现在在哪一步」
// （消息、计划、审批门），不管「用户昨天那几场还在不在」。面板要能在两场之间切换，
// 切换时还得把当前这场的转写写回去 —— 这两件事如果散进组件，列表顺序、上限淘汰、
// 坏存档就会各写一份。这里只认 `src/agent.ts` 的 `AgentTranscriptEntry`，
// 导出用它的 `exportTranscript`，不另造一份转写形状。
//
// 存档口径跟 `src/agentSettings.ts` 同一族：窄的 storage 接口、缺省 localStorage、
// 取不到就内存模式、坏存档永不抛。能救的留下，救不了的丢这一条，不整库作废。
//
// 模型选择按最小对象存（`AgentSessionModelSelection`）：历史存档里是模型字符串，
// 读成 `{ model }`；档位只在真有选择时出现。换模型的清档规则收在 `setSessionModelSelection`
// 一处，面板只搬值 —— 这一层不碰 vue / DOM，纯函数在 Node 里也要能单独跑。
import { exportTranscript, type AgentTranscriptEntry } from './agent.ts'

/** 存储键。与 `taocode.agent.settings` 同一族，不跟别的历史表抢键。 */
export const AGENT_SESSIONS_STORAGE_KEY = 'taocode.agent.sessions'

/**
 * 库里最多留多少场。满了先淘汰 `updatedAt` 最旧的再写入 ——
 * 一场被打开过的旧对话比一场很久没碰的更新，所以按更新时间而不是创建时间淘汰。
 */
export const AGENT_SESSION_LIMIT = 50

/** 会话名上限。超长截断而不是拒绝：用户从标题粘贴进来时，能留下前半句比整次改名失败有用。 */
const NAME_LIMIT = 60

/**
 * Composer 的会话级模型选择（ZCode `composerDraftStore.ts` 的 `modelSelection`），最小形状。
 * `options` 只在真有档位时出现 —— 没有档位就不带这一层，不设隐式默认；
 * 档位只对选它的那个模型有意义，所以换模型时必须清掉（规则见 `setSessionModelSelection`）。
 */
export interface AgentSessionModelSelection {
  /** 模型值：与设置页、工具条同一个字符串（provider 编码在值里，见 `agentModelSelection.ts`）。 */
  model: string
  /** 推理档位。档位有没有效由模型自己的 reasoning 目录判，这里只存形状。 */
  options?: { reasoningLevel: string }
}

/** 写入口收的形状：最小对象，或历史版本的模型字符串（按 `{ model }` 读，不炸不丢）。 */
export type AgentSessionModelSelectionInput = AgentSessionModelSelection | string

/** 档位归一：只认非空字符串，两端去空白；其余（缺省、空串、非字符串）给 null。 */
function normalizeReasoningLevel(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * 合并规则只有这一处。`explicit === undefined` 表示调用方没提档位 ——
 * 模型没换就沿用旧档位（那是既有选择，不是隐式默认），换了模型就丢；
 * 给字符串是明确档位，给 null 是明确清掉。
 */
function mergeSelection(
  current: AgentSessionModelSelection | null | undefined,
  model: string,
  explicit: string | null | undefined,
): AgentSessionModelSelection {
  const carried = current && current.model === model ? normalizeReasoningLevel(current.options?.reasoningLevel) : null
  const level = explicit === undefined ? carried : explicit
  return { model, ...(level ? { options: { reasoningLevel: level } } : {}) }
}

/**
 * 从**调用方原始输入**里取"显式档位"：
 *   · `undefined` = 这一格压根没提（沿用既有档位；换模型时由 `mergeSelection` 丢掉）；
 *   · `null` = 明确清掉（`options.reasoningLevel` 存在但是空串 —— composer 里"没选档位"就是这个形状）；
 *   · 字符串 = 明确档位。
 * 读原始输入而不是归一化后的 `next.options`：归一化把"空串"与"没提"都变成 undefined，
 * 两者含义不同（前者要清、后者要沿用），`tests/agent-sessions.test.mjs` 的「切模型清旧档位」钉着这条。
 */
function explicitReasoningLevel(selection: unknown): string | null | undefined {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return undefined
  const options = (selection as { options?: unknown }).options
  if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
  if (!Object.prototype.hasOwnProperty.call(options, "reasoningLevel")) return undefined
  return normalizeReasoningLevel((options as { reasoningLevel?: unknown }).reasoningLevel)
}

/**
 * 把存档里那一格读成最小选择。历史版本按模型字符串存过（`modelSelection: "glm-5.3"`），
 * 读成 `{ model }`，不炸不丢；对象形状按字段救：`model` 不是非空字符串就整格丢掉，
 * 档位坏掉只丢档位、模型保住。什么都读不出给 null（调用方删掉这一格，不写空壳）。
 * 只认形状，不判档位有效性 —— 那要模型自己的目录，不是这一层的事。
 */
export function sessionModelSelection(value: unknown): AgentSessionModelSelection | null {
  if (typeof value === 'string') {
    const model = value.trim()
    return model ? { model } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!model) return null
  const options = raw.options
  const level = options && typeof options === 'object' && !Array.isArray(options)
    ? normalizeReasoningLevel((options as Record<string, unknown>).reasoningLevel)
    : null
  return { model, ...(level ? { options: { reasoningLevel: level } } : {}) }
}

/**
 * 用户选完模型/档位之后的下一次选择 —— 面板的纯状态机，无 vue / DOM 依赖。
 * `next.model` 空或空白（next 为 null 同理）：没有选择，给 null，由调用方回落全局模型；
 * 模型没换且没提 `reasoningLevel`：沿用旧档位；换了模型：旧档位丢掉，档位只可能来自 `next`；
 * `next.reasoningLevel` 空串或 null：明确清掉档位，只留模型。
 */
export function setSessionModelSelection(
  current: AgentSessionModelSelection | null | undefined,
  next: { model: string; reasoningLevel?: string | null } | null | undefined,
): AgentSessionModelSelection | null {
  if (!next || typeof next.model !== 'string') return null
  const model = next.model.trim()
  if (!model) return null
  const explicit = next.reasoningLevel === undefined ? undefined : normalizeReasoningLevel(next.reasoningLevel)
  return mergeSelection(current, model, explicit)
}

/** 一场对话在库里的形状。`entries` 是当时落盘的转写，不是活的会话对象。 */
export interface AgentSessionRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  entries: AgentTranscriptEntry[]
  /**
   * Composer 的会话级模型选择草稿（ZCode `composerDraftStore.ts` 的 `modelSelection`）。
   * 历史存档里存的是模型字符串，读进来已归一成最小对象；写出去一律是新对象形状。
   */
  modelSelection?: AgentSessionModelSelection
}

/** 存储的窄接口（测试传内存实现；真页面不给就用 localStorage）。 */
export interface AgentSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface AgentSessionStore {
  /** 全部会话，`updatedAt` 倒序（最近动过的在前）。 */
  list(): AgentSessionRecord[]
  /** 当前打开的会话；库空或刚删光时为 null。 */
  activeId(): string | null
  /**
   * 新建一场并把它设为当前。超上限先淘汰 `updatedAt` 最旧的。
   * 缺省名按已有「会话 N」取下一个空号（「会话 1」「会话 2」），不跟用户改过的名字抢号。
   */
  create(name?: string): AgentSessionRecord
  get(id: string): AgentSessionRecord | undefined
  /** 切到这一场。不存在返回 false，当前不变。 */
  open(id: string): boolean
  /** 改名。空白名返回 false；超长截到 60。 */
  rename(id: string, name: string): boolean
  /** 删一场。删掉的是当前，就切到 `updatedAt` 最新的那一场；没有则为 null。 */
  remove(id: string): boolean
  /**
   * 把一场的转写写回去。拷贝语义：之后改入参数组，库里那份不动。
   * 成功时把 `updatedAt` 推到最新（这次写入就是「最近动过」）。
   */
  saveTranscript(id: string, entries: AgentTranscriptEntry[]): boolean
  /**
   * 保存 composer 的模型选择。收最小选择对象，也收历史版本的模型字符串（按 `{ model }` 读）；
   * null 清除会话覆盖，回落全局模型。换模型会连带清掉旧档位（`setSessionModelSelection` 的规则）。
   */
  saveModelSelection(id: string, selection: AgentSessionModelSelectionInput | null): boolean
  /** 读取该会话选择的模型字符串；没有选择给 null。档位走 `sessionModelSelection`。 */
  modelSelection(id: string): string | null
  /** 读取该会话的完整选择（含推理档位）副本；没有选择给 null。 */
  sessionModelSelection(id: string): AgentSessionModelSelection | null
  /** 保存尚未绑定会话的 composer 模型选择（形状与换模型清档规则同 `saveModelSelection`）。 */
  saveDraftModelSelection(selection: AgentSessionModelSelectionInput | null): boolean
  /** 读取草稿选择的模型字符串；没有选择给 null。 */
  draftModelSelection(): string | null
  /** 读取草稿的完整选择副本；没有选择给 null。 */
  draftSessionModelSelection(): AgentSessionModelSelection | null
  /** 当前这场的转写副本；没有当前则为空数组。 */
  activeEntries(): AgentTranscriptEntry[]
  /** 把当前这场导出成 `taocode-agent-transcript/1`；没有当前则为 null。 */
  exportActive(): string | null
  /** 侧栏摘要。`entries` 是条数，不是转写数组，侧栏不用把整份对话拿回去。 */
  summaries(): Array<{ id: string; name: string; createdAt: string; updatedAt: string; entries: number }>
}

interface PersistedLibrary {
  activeId: string | null
  sessions: AgentSessionRecord[]
  /**
   * ZCode `V4_DRAFT_SCOPE_ROOT` 对应的 composer selection，尚未绑定会话时使用。
   * 历史存档里也是模型字符串，读进来归一成最小对象。
   */
  draftModelSelection?: AgentSessionModelSelection
}

const EMPTY: PersistedLibrary = { activeId: null, sessions: [] }

function defaultStorage(): AgentSessionStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式 / 沙箱里读 localStorage 本身就会抛，退回内存模式。
    return null
  }
}

function storageKeyForProject(projectRoot?: string): string {
  const root = projectRoot?.trim().replace(/\\/g, '/') ?? ''
  const normalized = root.replace(/\/+$/u, '') || (root.startsWith('/') ? '/' : '')
  if (!normalized) return AGENT_SESSIONS_STORAGE_KEY
  return `${AGENT_SESSIONS_STORAGE_KEY}.project.${encodeURIComponent(normalized)}`
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

/** 转写里一条能不能留下。缺字段、kind 不认、text 不是字符串，整条丢掉。 */
function normalizeEntry(value: unknown): AgentTranscriptEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const kind = raw.kind
  if (kind !== 'user' && kind !== 'assistant' && kind !== 'tool' && kind !== 'approval' && kind !== 'error' && kind !== 'note') return null
  if (typeof raw.text !== 'string' || !isIso(raw.at)) return null
  const entry: AgentTranscriptEntry = { at: raw.at, kind, text: raw.text }
  if (raw.tool === 'read_file' || raw.tool === 'write_file' || raw.tool === 'run_command' || raw.tool === 'fetch_network') entry.tool = raw.tool
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) entry.params = { ...(raw.params as Record<string, unknown>) }
  if (typeof raw.result === 'string') entry.result = raw.result
  if (typeof raw.approved === 'boolean') entry.approved = raw.approved
  if (raw.modelToolCall && typeof raw.modelToolCall === 'object' && !Array.isArray(raw.modelToolCall)) {
    const modelCall = raw.modelToolCall as Record<string, unknown>
    if (
      typeof modelCall.providerCallId === 'string' && typeof modelCall.name === 'string' &&
      typeof modelCall.agentCallId === 'number' && Number.isSafeInteger(modelCall.agentCallId) &&
      modelCall.input && typeof modelCall.input === 'object' && !Array.isArray(modelCall.input)
    ) {
      entry.modelToolCall = {
        providerCallId: modelCall.providerCallId,
        name: modelCall.name,
        input: { ...(modelCall.input as Record<string, unknown>) },
        agentCallId: modelCall.agentCallId,
        ...(typeof modelCall.result === 'string' ? { result: modelCall.result } : {}),
        ...(typeof modelCall.isError === 'boolean' ? { isError: modelCall.isError } : {}),
      }
    }
  }
  return entry
}

function normalizeRecord(value: unknown): AgentSessionRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.name !== 'string') return null
  if (!isIso(raw.createdAt) || !isIso(raw.updatedAt)) return null
  // entries 不是数组：这一场救不回来，丢掉它，别把整库判废。
  if (!Array.isArray(raw.entries)) return null
  const name = clipName(raw.name)
  if (!name) return null
  const entries: AgentTranscriptEntry[] = []
  for (const item of raw.entries) {
    const entry = normalizeEntry(item)
    if (entry) entries.push(entry)
  }
  const modelSelection = sessionModelSelection(raw.modelSelection)
  return { id: raw.id, name, createdAt: raw.createdAt, updatedAt: raw.updatedAt, entries, ...(modelSelection ? { modelSelection } : {}) }
}

/**
 * 读存档。非 JSON、非对象、sessions 不是数组：整库当空。
 * 单条坏记录丢掉；id 重复只留先出现的那条；activeId 指向不存在的会话则清空。
 */
function parseLibrary(raw: string | null): PersistedLibrary {
  if (!raw) return { activeId: null, sessions: [] }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { activeId: null, sessions: [] }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { activeId: null, sessions: [] }
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.sessions)) return { activeId: null, sessions: [] }
  const sessions: AgentSessionRecord[] = []
  const seen = new Set<string>()
  for (const item of body.sessions) {
    const record = normalizeRecord(item)
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    sessions.push(record)
  }
  // 存档里如果已经超过上限（旧版本写多了），按更新时间丢掉最旧的，读进来就是合法形状。
  const kept = sessions.length > AGENT_SESSION_LIMIT ? newest(sessions, AGENT_SESSION_LIMIT) : sessions
  const ids = new Set(kept.map(record => record.id))
  const activeId = typeof body.activeId === 'string' && ids.has(body.activeId) ? body.activeId : null
  const draftModelSelection = sessionModelSelection(body.draftModelSelection)
  return { activeId, sessions: kept, ...(draftModelSelection ? { draftModelSelection } : {}) }
}

function newest(sessions: readonly AgentSessionRecord[], count: number): AgentSessionRecord[] {
  return [...sessions].sort(byUpdatedDesc).slice(0, count)
}

function byUpdatedDesc(a: AgentSessionRecord, b: AgentSessionRecord): number {
  if (a.updatedAt === b.updatedAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  return a.updatedAt < b.updatedAt ? 1 : -1
}

function clipName(name: string): string {
  const trimmed = name.trim()
  // 按码点截，避免把一个汉字切成半个（JS 的 slice 按 UTF-16 码元）。
  return [...trimmed].slice(0, NAME_LIMIT).join('')
}

/** 已有「会话 N」里最大的号 + 1。用户改过名的不算，免得「会话 2」被改成「草稿」之后又冒出第二个「会话 2」。 */
function nextDefaultName(sessions: readonly AgentSessionRecord[]): string {
  let max = 0
  for (const record of sessions) {
    const match = /^会话 (\d+)$/.exec(record.name)
    if (!match) continue
    const n = Number(match[1])
    if (Number.isInteger(n) && n > max) max = n
  }
  return `会话 ${max + 1}`
}

function copyEntry(entry: AgentTranscriptEntry): AgentTranscriptEntry {
  const copy: AgentTranscriptEntry = { at: entry.at, kind: entry.kind, text: entry.text }
  if (entry.tool !== undefined) copy.tool = entry.tool
  if (entry.params !== undefined) copy.params = { ...entry.params }
  if (entry.result !== undefined) copy.result = entry.result
  if (entry.approved !== undefined) copy.approved = entry.approved
  if (entry.modelToolCall !== undefined) {
    copy.modelToolCall = {
      ...entry.modelToolCall,
      input: { ...entry.modelToolCall.input },
    }
  }
  return copy
}

function copyEntries(entries: readonly AgentTranscriptEntry[]): AgentTranscriptEntry[] {
  return entries.map(copyEntry)
}

/** 选择也是拷贝：面板改返回值不动库里那份（`options` 嵌一层，浅拷贝不够）。 */
function copyModelSelection(selection: AgentSessionModelSelection): AgentSessionModelSelection {
  return { model: selection.model, ...(selection.options ? { options: { ...selection.options } } : {}) }
}

function copyRecord(record: AgentSessionRecord): AgentSessionRecord {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    entries: copyEntries(record.entries),
    ...(record.modelSelection ? { modelSelection: copyModelSelection(record.modelSelection) } : {}),
  }
}

/**
 * 建会话库。
 *
 * `storage` 不传：尝试 localStorage，取不到（Node、隐私模式）就只活在内存里。
 * 传 null：明确要内存模式。传了对象：读写都走它，测试用这个钉住落盘形状。
 * `now` 注入时钟，让 id 与时间戳在测试里可断言。
 */
export function createAgentSessionStore(storage?: AgentSessionStorage | null, now?: () => Date, projectRoot?: string): AgentSessionStore {
  const clock = now ?? (() => new Date())
  const backing = storage === undefined ? defaultStorage() : storage
  const storageKey = storageKeyForProject(projectRoot)
  let library: PersistedLibrary = { ...EMPTY }
  let seq = 0

  if (backing) {
    try {
      library = parseLibrary(backing.getItem(storageKey))
    } catch {
      library = { activeId: null, sessions: [] }
    }
  }

  const persist = (): void => {
    if (!backing) return
    try {
      backing.setItem(storageKey, JSON.stringify({
        activeId: library.activeId,
        sessions: library.sessions,
        ...(library.draftModelSelection ? { draftModelSelection: library.draftModelSelection } : {}),
      }))
    } catch {
      // 配额满 / 隐私模式：这一次没写上，内存里的库仍然是真的。下次能写再写。
    }
  }

  const stamp = (): string => clock().toISOString()

  const find = (id: string): AgentSessionRecord | undefined => library.sessions.find(record => record.id === id)

  return {
    list() {
      return [...library.sessions].sort(byUpdatedDesc).map(copyRecord)
    },
    activeId() {
      return library.activeId
    },
    create(name) {
      const createdAt = stamp()
      // 先淘汰再起名：被丢掉的「会话 N」腾出的号可以复用，没被丢掉的不重复。
      if (library.sessions.length >= AGENT_SESSION_LIMIT) {
        const ranked = [...library.sessions].sort(byUpdatedDesc)
        const drop = new Set(ranked.slice(AGENT_SESSION_LIMIT - 1).map(record => record.id))
        library = {
          activeId: library.activeId && drop.has(library.activeId) ? null : library.activeId,
          sessions: library.sessions.filter(record => !drop.has(record.id)),
        }
      }
      const explicit = name === undefined ? '' : clipName(name)
      // 时钟停住时（测试注入的 now、或同一毫秒连建）单靠时间戳会和库存里的 id 撞车，序号一直加到空号为止。
      let id = `s${createdAt}-${seq++}`
      while (library.sessions.some(item => item.id === id)) id = `s${createdAt}-${seq++}`
      const record: AgentSessionRecord = {
        id,
        name: explicit || nextDefaultName(library.sessions),
        createdAt,
        updatedAt: createdAt,
        entries: [],
      }
      library = { activeId: record.id, sessions: [...library.sessions, record] }
      persist()
      return copyRecord(record)
    },
    get(id) {
      const record = find(id)
      return record ? copyRecord(record) : undefined
    },
    open(id) {
      if (!find(id)) return false
      if (library.activeId !== id) {
        library = { ...library, activeId: id }
        persist()
      }
      return true
    },
    rename(id, name) {
      const record = find(id)
      if (!record) return false
      const next = clipName(name)
      if (!next) return false
      record.name = next
      record.updatedAt = stamp()
      persist()
      return true
    },
    remove(id) {
      const record = find(id)
      if (!record) return false
      const sessions = library.sessions.filter(item => item.id !== id)
      let activeId = library.activeId
      if (activeId === id) {
        const latest = [...sessions].sort(byUpdatedDesc)[0]
        activeId = latest ? latest.id : null
      }
      library = { activeId, sessions }
      persist()
      return true
    },
    saveTranscript(id, entries) {
      const record = find(id)
      if (!record) return false
      if (!Array.isArray(entries)) return false
      record.entries = copyEntries(entries)
      record.updatedAt = stamp()
      persist()
      return true
    },
    saveModelSelection(id, selection) {
      const record = find(id)
      if (!record) return false
      if (selection === null) {
        delete record.modelSelection
        persist()
        return true
      }
      const next = sessionModelSelection(selection)
      if (!next) return false
      record.modelSelection = mergeSelection(record.modelSelection, next.model, explicitReasoningLevel(selection))
      persist()
      return true
    },
    modelSelection(id) {
      return find(id)?.modelSelection?.model ?? null
    },
    sessionModelSelection(id) {
      const record = find(id)
      return record?.modelSelection ? copyModelSelection(record.modelSelection) : null
    },
    saveDraftModelSelection(selection) {
      if (selection === null) {
        delete library.draftModelSelection
        persist()
        return true
      }
      const next = sessionModelSelection(selection)
      if (!next) return false
      library.draftModelSelection = mergeSelection(library.draftModelSelection, next.model, explicitReasoningLevel(selection))
      persist()
      return true
    },
    draftModelSelection() {
      return library.draftModelSelection?.model ?? null
    },
    draftSessionModelSelection() {
      return library.draftModelSelection ? copyModelSelection(library.draftModelSelection) : null
    },
    activeEntries() {
      const record = library.activeId ? find(library.activeId) : undefined
      return record ? copyEntries(record.entries) : []
    },
    exportActive() {
      const record = library.activeId ? find(library.activeId) : undefined
      if (!record) return null
      return exportTranscript(record.entries, { model: record.name, started: record.createdAt })
    },
    summaries() {
      return [...library.sessions].sort(byUpdatedDesc).map(record => ({
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        entries: record.entries.length,
      }))
    },
  }
}

