// 崩溃恢复（IDEA workspace.xml 的编辑器状态 + 未保存草稿）——从 App.vue 拆出（桃 2026-09-26：模块化）。
// 快照覆盖：分栏布局、每个分组的标签与选中、**仅脏缓冲**的草稿文本。
// 任何布局/脏标记变化后防抖保存；正常关闭项目时清除，所以恢复提示只在崩溃或异常退出后出现。
//
// 模式：`restorePrompt` 由模块**自持**（模板直接 import 使用）；其余依赖经 ctx 注入，
// 且全部用箭头包装/getter 惰性解析 —— 工厂在顶层立即求值，不依赖 App 里的声明顺序。
import { nextTick, ref, watch } from 'vue'
import { request } from './bridge'
import type { DocumentData } from './bridge'

export interface SessionState {
  tabs: Array<{ path: string; line: number; column: number; pane: number; draft?: string }>
  active: [string, string]
  orientation: 'none' | 'horizontal' | 'vertical'
  focused: 0 | 1
}

export interface SessionSnapshotContext {
  isDesktop: boolean
  workspace: () => { value: unknown }
  workspaceEpoch: () => number
  splitModel: () => { orientation: 'none' | 'horizontal' | 'vertical'; focused: 0 | 1 }
  groups: () => Array<{ tabs: any[]; activePath: string }>
  reveal: () => { value: { path: string; line: number } | null }
  editorFor: (path: string) => { text(): string; setDraft(text: string): void } | undefined
  findTab: (path: string) => any
  notify: (message: string, error?: boolean) => void
  touchHistory: (path: string) => void
  rememberRecent: (path: string) => void
  startLsp: (tab: any) => unknown
}

export const restorePrompt = ref<{ state: SessionState; drafts: number } | null>(null)

export function createSessionSnapshot(ctx: SessionSnapshotContext) {
  let sessionTimer: number | undefined

  function sessionKey() {
    const split = ctx.splitModel()
    return JSON.stringify([split.orientation, split.focused,
      ctx.groups().map(group => [group.activePath, group.tabs.map(tab => `${tab.path}${tab.dirty ? '*' : ''}`)])])
  }

  function snapshotSession(): SessionState {
    const groups = ctx.groups()
    const tabs: SessionState['tabs'] = []
    for (const pane of [0, 1] as const)
      for (const tab of groups[pane].tabs) {
        if (pane === 1 && groups[0].tabs.includes(tab)) continue  // shared buffer, already listed
        const draft = tab.dirty ? ctx.editorFor(tab.path)?.text() ?? tab.content : undefined
        tabs.push({ path: tab.path, line: tab.line, column: tab.column, pane, ...(draft !== undefined ? { draft } : {}) })
      }
    const split = ctx.splitModel()
    return { tabs, active: [groups[0].activePath, groups[1].activePath], orientation: split.orientation, focused: split.focused }
  }

  function flushSessionSave() {
    if (!ctx.isDesktop || !ctx.workspace().value) return
    if (sessionTimer) { window.clearTimeout(sessionTimer); sessionTimer = undefined }
    void request('session.save', { state: snapshotSession() }).catch(() => undefined)
  }

  function scheduleSessionSave() {
    if (!ctx.isDesktop || !ctx.workspace().value) return
    if (sessionTimer) window.clearTimeout(sessionTimer)
    sessionTimer = window.setTimeout(() => {
      sessionTimer = undefined
      if (!ctx.workspace().value) return
      void request('session.save', { state: snapshotSession() }).catch(() => undefined)
    }, 1500)
  }

  watch(sessionKey, () => scheduleSessionSave())
  // IDEA rewrites workspace.xml the moment an editor is removed instead of waiting for
  // the 1.5 s debounce: a crash inside that window would otherwise restore a tab the
  // user has just closed, still carrying the draft it had while it was open. Closing a
  // dirty tab goes through confirmLeave first, so the draft was either written to disk
  // or deliberately discarded by then — which is why this only has to flush the layout.
  watch(() => ctx.groups()[0].tabs.length + ctx.groups()[1].tabs.length, (next, previous) => {
    if (next >= previous) return
    flushSessionSave()
  })

  async function offerSessionRestore() {
    if (!ctx.isDesktop) return
    try {
      const saved = await request<{ found: boolean; corrupt?: boolean; state?: SessionState }>('session.load')
      if (!saved.found) return
      if (saved.corrupt || !saved.state) {
        ctx.notify('上次会话的恢复数据已损坏，无法恢复未保存内容。', true)
        void request('session.clear').catch(() => undefined)
        return
      }
      const tabs = saved.state.tabs ?? []
      if (!tabs.length) { void request('session.clear').catch(() => undefined); return }
      // IDEA reopens a project's editors from workspace.xml silently; unsaved drafts
      // only exist after a crash, and those are what deserve the prompt.
      const drafts = tabs.filter(tab => tab.draft !== undefined).length
      if (!drafts) { await restoreSession({ state: saved.state, drafts: 0 }); return }
      restorePrompt.value = { state: saved.state, drafts }
    } catch { /* sessions are best-effort */ }
  }

  async function restoreSession(prompt: { state: SessionState; drafts: number }) {
    restorePrompt.value = null
    const epoch = ctx.workspaceEpoch()
    const groups = ctx.groups()
    const restored: any[] = []
    for (const entry of prompt.state.tabs) {
      try {
        const doc = await request<DocumentData>('file.read', { path: entry.path })
        if (epoch !== ctx.workspaceEpoch()) return
        const tab = { ...doc, saving: false, dirty: false, line: Math.max(1, entry.line), column: Math.max(1, entry.column) }
        if (entry.draft !== undefined && entry.draft !== doc.content) { tab.content = entry.draft; tab.dirty = true }
        const pane = entry.pane === 1 ? 1 : 0
        if (!groups[pane].tabs.some(item => item.path === tab.path)) groups[pane].tabs.push(tab)
        restored.push(tab)
      } catch { /* the file vanished since the crash; skip it */ }
    }
    if (epoch !== ctx.workspaceEpoch()) return
    const split = ctx.splitModel()
    split.orientation = prompt.state.orientation
    split.focused = prompt.state.focused
    groups[0].activePath = groups[0].tabs.some(tab => tab.path === prompt.state.active[0]) ? prompt.state.active[0] : groups[0].tabs[0]?.path ?? ''
    groups[1].activePath = groups[1].tabs.some(tab => tab.path === prompt.state.active[1]) ? prompt.state.active[1] : groups[1].tabs[0]?.path ?? ''
    for (const tab of restored) {
      ctx.touchHistory(tab.path)
      ctx.rememberRecent(tab.path)
      if (tab.dirty) await nextTick(), ctx.editorFor(tab.path)?.setDraft(tab.content)
      if (ctx.isDesktop) void ctx.startLsp(tab)
    }
    const first = ctx.findTab(groups[split.focused].activePath) ?? restored[0]
    if (first) ctx.reveal().value = { path: first.path, line: Math.max(0, first.line - 1) }
    ctx.notify(`已恢复 ${restored.length} 个文件${prompt.drafts ? `（含 ${prompt.drafts} 个未保存草稿）` : ''}`)
  }

  function discardSession() {
    restorePrompt.value = null
    void request<{ cleared: boolean }>('session.clear')
      .then(reply => { if (reply && reply.cleared === false) ctx.notify('恢复草稿未能从磁盘清除，下次启动仍会提示。', true) })
      .catch(() => undefined)
  }

  /** 卸载/关项目时取消挂起的防抖保存（对应原先 App 里的 sessionTimer 清理）。 */
  function cancelSessionSave() { if (sessionTimer) { window.clearTimeout(sessionTimer); sessionTimer = undefined } }

  return { snapshotSession, scheduleSessionSave, flushSessionSave, cancelSessionSave, offerSessionRestore, restoreSession, discardSession }
}
