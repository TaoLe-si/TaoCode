// Agent 改文件的**待决改动台账**：内存快照 + Do / Undo / Do All 三档语义。
//
// 为什么要有它（用户原话）：agent 改完文件，用户要能「既在对话窗口里看到，也在左侧写代码的
// 窗口看到红绿 diff」，然后逐条决定保留还是撤回。所以：
//   · 改动在被「保留」之前**不写盘**（`before`/`after` 都在内存里，这就是回退的依据）；
//   · 每条改动同时供左边（`DiffView.vue` 的红绿行）与对话窗口（摘要行）读**同一份**数据 ——
//     两个地方读同一份是硬要求，否则"对话里说改了 A、左边显示 B"这类不一致没人能查；
//   · Do = 保留（把 after 写盘）；Undo = 撤回（丢掉落盘资格，或把已落盘的写回 before）；
//     Do All = 把所有待决的都保留。
//
// **回滚不覆盖用户独立修改**（ROADMAP S5 验收口径）：撤回一条**已落盘**的改动之前，
// 先看盘上内容是否还等于我们当初写下的 `after`。若用户在这中间自己改过这个文件，
// 撤回会覆盖他的改动 —— 这时**拒绝撤回**并如实报告，而不是静默把用户的活干掉。
//
// 本模块**纯逻辑、不碰磁盘也不碰 Vue**：文件读写由宿主注入的 `files` 完成，
// 所以「Do 到底写了什么」「Undo 在什么情况下拒绝」都能被精确断言。
//
// 与 `src/agent.ts` 的分工：那边出的是**一次**改动的预览形状（`renderEditPreview`），
// 这边管的是**多次**改动的生命周期（编号、待决/已决状态、批量保留、撤回前的安全检查）。
import { renderEditPreview, type AgentEdit } from './agent.ts'
import type { DiffRow } from './bridge.ts'

/** 一条改动的状态。`pending` = 已暂存未落盘；`applied` = 已落盘；`reverted` = 已撤回。 */
export type AgentEditState = 'pending' | 'applied' | 'reverted'

/**
 * 台账里的一条。`id` 单调递增，是 UI 上 Do/Undo 按钮的键（路径不能当键：
 * 同一个文件在一次会话里可以被改多次，两条改动各自独立决定）。
 */
export interface AgentPendingEdit {
  id: number
  path: string
  before: string
  after: string
  state: AgentEditState
  /** 产生这条改动的对话回合（UI 用来把改动挂回它那一轮）。 */
  turn: number
  added: number
  removed: number
}

export interface AgentEditSummary {
  id: number
  path: string
  state: AgentEditState
  added: number
  removed: number
  turn: number
}

/**
 * 台账需要的文件能力（宿主注入；不直接碰磁盘）。
 * 两个都是异步的：宿主的文件桥（`request('file.read'/'file.write')`）天生是 Promise，
 * 台账若假装同步就只能在写完成前给出结论 —— 那等于谎报。
 */
export interface AgentEditFiles {
  /** 读当前内容；读不到返回 null。 */
  read(path: string): Promise<string | null>
  /** 写内容；返回是否成功（false = 写失败，状态保持不变）。 */
  write(path: string, content: string): Promise<boolean>
}

/** 一次决定的结果。`conflict` 专门表示"盘上已被外部改过，撤回会覆盖它"。 */
export type AgentEditOutcome = { ok: true } | { ok: false; reason: 'missing' | 'writeFailed' | 'wrongState' | 'conflict' }

export interface AgentEditLedger {
  /** 暂存一条新改动（**不写盘**）。返回它的 id。 */
  record(edit: AgentEdit & { turn: number }): number
  /** 全部条目（含已决的，按登记顺序）。 */
  all(): AgentPendingEdit[]
  /** 还没决定的条目。 */
  pending(): AgentPendingEdit[]
  /** 单条。找不到返回 undefined。 */
  get(id: number): AgentPendingEdit | undefined
  /** Do：保留这一条 —— 把 after 写盘并转 applied。 */
  do(id: number): Promise<AgentEditOutcome>
  /** Undo：撤回这一条 —— 待决的直接丢弃；已落盘的写回 before（盘上有外部改动时拒绝）。 */
  undo(id: number): Promise<AgentEditOutcome>
  /** Do All：把所有待决的逐条保留。返回成功条数与失败明细。 */
  doAll(): Promise<{ applied: number; failed: Array<{ id: number; reason: string }> }>
  /** 一条改动的红绿行（喂给 `DiffView.vue`），与左侧编辑器用的是同一份。 */
  rows(id: number): DiffRow[]
  /** 台账摘要（喂给对话窗口里的改动列表）。 */
  summarize(): AgentEditSummary[]
  /** 清空（换项目/新会话时用）。 */
  clear(): void
}

/** 有没有还没决定的改动 —— 关窗口/切项目前的拦截条件。 */
export function hasPendingEdits(ledger: AgentEditLedger): boolean {
  return ledger.pending().length > 0
}

/**
 * 把一次改动的 before/after 折成 `DiffView.vue` 要的红绿行。
 *
 * 用 `src/agent.ts` 的 `renderEditPreview` 作行级 LCS —— 与对话里那份"预计 +N −M"
 * 出自同一个函数，所以左侧红绿与对话里的计数**不可能对不上**。
 */
export function editDiffRows(edit: Pick<AgentPendingEdit, 'before' | 'after'>): DiffRow[] {
  const preview = renderEditPreview({ path: '', before: edit.before, after: edit.after })
  const rows: DiffRow[] = []
  let leftNo = 1
  let rightNo = 1
  for (const hunk of preview.hunks) {
    for (const line of hunk.before) rows.push({ kind: 'delete', left: { no: leftNo++, text: line } })
    for (const line of hunk.after) rows.push({ kind: 'insert', right: { no: rightNo++, text: line } })
  }
  return rows
}

/**
 * 建一本台账。`files` 必须由宿主注入（本模块不知道文件在哪、也不该知道）。
 */
export function createAgentEditLedger(files: AgentEditFiles): AgentEditLedger {
  const entries = new Map<number, AgentPendingEdit>()
  let nextId = 1

  const tryWrite = async (path: string, content: string): Promise<boolean> => {
    try {
      return await files.write(path, content)
    } catch {
      return false
    }
  }

  return {
    record(edit) {
      const preview = renderEditPreview({ path: edit.path, before: edit.before, after: edit.after })
      const id = nextId++
      entries.set(id, {
        id,
        path: edit.path,
        before: edit.before,
        after: edit.after,
        state: 'pending',
        turn: edit.turn,
        added: preview.added,
        removed: preview.removed,
      })
      return id
    },
    all: () => [...entries.values()],
    pending: () => [...entries.values()].filter(entry => entry.state === 'pending'),
    get: id => entries.get(id),
    async do(id) {
      const entry = entries.get(id)
      if (!entry) return { ok: false, reason: 'missing' }
      if (entry.state !== 'pending') return { ok: false, reason: 'wrongState' }
      if (!(await tryWrite(entry.path, entry.after))) return { ok: false, reason: 'writeFailed' }
      entry.state = 'applied'
      return { ok: true }
    },
    async undo(id) {
      const entry = entries.get(id)
      if (!entry) return { ok: false, reason: 'missing' }
      if (entry.state === 'reverted') return { ok: false, reason: 'wrongState' }
      if (entry.state === 'pending') {
        // 从没落盘过 ⇒ 没有任何东西要还原。**不写盘**：写一次 before 会覆盖用户
        // 这期间自己做的编辑，而我们本来就不需要动这个文件。
        entry.state = 'reverted'
        return { ok: true }
      }
      // 已落盘：还原前先确认盘上还是我们写下的那份，否则撤回会覆盖用户的独立修改。
      let current: string | null = null
      try {
        current = await files.read(entry.path)
      } catch {
        current = null
      }
      if (current === null) return { ok: false, reason: 'missing' }
      if (current !== entry.after) return { ok: false, reason: 'conflict' }
      if (!(await tryWrite(entry.path, entry.before))) return { ok: false, reason: 'writeFailed' }
      entry.state = 'reverted'
      return { ok: true }
    },
    async doAll() {
      let applied = 0
      const failed: Array<{ id: number; reason: string }> = []
      // 逐条串行：两条改动若指向同一个文件，并发的"写 after"会互相踩（后写的把先写的盖掉）。
      for (const entry of entries.values()) {
        if (entry.state !== 'pending') continue
        if (!(await tryWrite(entry.path, entry.after))) {
          failed.push({ id: entry.id, reason: 'writeFailed' })
          continue
        }
        entry.state = 'applied'
        applied += 1
      }
      return { applied, failed }
    },
    rows(id) {
      const entry = entries.get(id)
      return entry ? editDiffRows(entry) : []
    },
    summarize: () => [...entries.values()].map(entry => ({
      id: entry.id,
      path: entry.path,
      state: entry.state,
      added: entry.added,
      removed: entry.removed,
      turn: entry.turn,
    })),
    clear() {
      entries.clear()
      nextId = 1
    },
  }
}
