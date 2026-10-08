// Agent 装配层的**宿主接线**（App.vue 搬出的一域，2026-10-07）。
//
// 为什么单独一个文件：`src/App.vue` 顶着机检上限（`tests/module-size.test.mjs`），而把 Agent
// 接进 IDE 要一整块 glue —— 文件桥（读/写要走 `file.read`/`file.write`）、左侧跳转、
// 红绿差异的三态状态、随工作区开关重建装配层。塞进宿主既挤占余量，也让
// "Agent 到底用了宿主的哪些能力"看不出来。
//
// 写盘口径**逐行对齐**宿主 `revertHistory`（App.vue 的本地历史回滚）：带 `expectedVersion`/
// `encoding`/`bom` 写入；文件开着标签页就同步缓冲（`setDraft` + 修订号 + `lsp.change`），
// 否则编辑器里显示的还是旧内容，"在左侧看到红绿差异"就成了谎话。
import { ref, shallowRef, watch } from 'vue'
import { isDesktop, request, requestStream, type DocumentData, type Entry, type SaveResult } from './bridge.ts'
import { buildDiffRows, generateUnifiedDiff } from './diffText.ts'
import type { DiffRow } from './bridge.ts'
import { createAgentHost, type AgentHost, type AgentModelHttpResponse } from './agentHost.ts'
import { withBridgeTimeout } from './agentBridgeTimeout.ts'
import { loadAgentSettings, saveAgentSettings, type AgentSettingsState } from './agentSettings.ts'
import { buildAgentSkillPromptContext } from './agentSkills.ts'
import { loadAgentMcpSettings, type AgentMcpRuntimeSnapshot, type AgentMcpToolCallResult } from './agentMcpServers.ts'

/** 编辑器区那条 Agent 差异的形状（与 `clipboardDiff` 同一形状，DiffView 直接吃）。 */
export interface AgentDiffState {
  path: string
  editId: number
  rows: DiffRow[]
  unified: string
  leftText: string
  rightText: string
}

/** 宿主要注入的能力面（每项都是 App.vue 里同名变量的引用）。 */
export interface AgentWireDeps {
  workspace: () => { name: string; root: string; entries: Entry[] } | null
  notify: (message: string, error?: boolean) => void
  /** 跳转口径与 `revealLocation` 一致（0 基行）。 */
  revealLocation: (target: { path: string; line: number }) => unknown
  refreshTree: () => unknown
  /** 打开着的标签页里找一条（写盘后同步缓冲用）；找不到 = 文件没开。 */
  findTab: (path: string) => { path: string; content: string; version?: string; encoding?: string; bom?: boolean; dirty?: boolean } | undefined
  /** 编辑器扩展实例（同步草稿用）。 */
  editorFor: (path: string) => { setDraft(content: string): unknown } | undefined
  bumpDocumentRevision: (path: string) => void
  generalSettings: () => { isUseSafeWrite?: boolean }
}

/** 接线的产出：装配层、编辑器区的差异状态、设置页的保存通道。 */
export interface AgentWire {
  agentHost: ReturnType<typeof shallowRef<AgentHost | null>>
  agentDiff: ReturnType<typeof ref<AgentDiffState | null>>
  /** 设置页保存后的落点：持久化 + 让当前装配层立刻用上新的权限档。 */
  persistAgentSettings(next: AgentSettingsState): boolean
}

/**
 * 建好并随工作区换根重建 Agent 装配层。
 * 返回：`agentHost`（给面板的装配层；没开项目 = null）与 `agentDiff`（编辑器区那条差异）。
 */
export function wireAgentHost(deps: AgentWireDeps): AgentWire {
  const agentDiff = ref<AgentDiffState | null>(null)
  const agentHost = shallowRef<AgentHost | null>(null)
  // 设置读一次、写回走同一条通路：权限档改了要立刻通知装配层（面板的齿轮在设置页里改）。
  const settings: AgentSettingsState = loadAgentSettings()

  /** 把一条台账改动折成编辑器区那条差异（与对话面板读的是台账里的同一份 before/after）。 */
  function showEditDiff(editId: number): void {
    const host = agentHost.value
    const edit = host?.ledger().get(editId)
    if (!edit) return
    const beforeLines = edit.before.split('\n')
    const afterLines = edit.after.split('\n')
    agentDiff.value = {
      path: edit.path,
      editId,
      rows: buildDiffRows(beforeLines, afterLines),
      unified: generateUnifiedDiff(beforeLines, afterLines),
      leftText: edit.before,
      rightText: edit.after,
    }
  }

  function build(): AgentHost | null {
    if (!deps.workspace()) return null
    const mcpSetup = isDesktop
      ? request<AgentMcpRuntimeSnapshot>('agent.mcp.configure', {
        settings: loadAgentMcpSettings(), workspacePath: deps.workspace()?.root ?? '',
      }).catch(() => undefined)
      : Promise.resolve(undefined)
    return createAgentHost({
      settings,
      bridge: {
        workspaceRoot: () => deps.workspace()?.root ?? '',
        listFiles: () => flattenFiles(deps.workspace()?.entries ?? []),
        readFile: async path => {
          try {
            const doc = await withBridgeTimeout(
              request<DocumentData>('file.read', { path }),
              // 挂起 = 真机上见过的那种「面板卡死、`messages` 停在 0」（见
              // `src/agentBridgeTimeout.ts` 的来由）。按「读不到」收场，工具结果里如实写着，
              // 面板继续往下走 —— 宁可这一次失败，也不把对话窗口永久锁住。
              () => { console.warn(`[agent] file.read 超时，按「读不到」收场：${path}`); return null },
            )
            return doc?.content ?? null
          } catch {
            return null
          }
        },
        writeFile: async (path, content) => {
          try {
            const open = deps.findTab(path)
            let version = open?.version
            let encoding = open?.encoding ?? 'utf-8'
            let bom = open?.bom ?? false
            if (version === undefined) {
              // 同样加时限：这一步挂起的话，「保留」那颗钮会一直转 —— 用户看不出是失败了还是没反应。
              let doc: DocumentData | null = null
              try {
                doc = await withBridgeTimeout(
                  request<DocumentData>('file.read', { path }),
                  () => { console.warn(`[agent] file.read（取 version）超时，写入放弃：${path}`); return null },
                )
              } catch {
                doc = null
              }
              if (!doc) {
                const knownFile = (deps.workspace()?.entries ?? []).some(entry => entry.kind === 'file' && entry.path.replace(/\\/gu, '/') === path.replace(/\\/gu, '/'))
                if (knownFile) return false
                try { await request('file.create', { path }) } catch { return false }
                try {
                  doc = await withBridgeTimeout(
                    request<DocumentData>('file.read', { path }),
                    () => { console.warn(`[agent] file.read（新建后取 version）超时，写入放弃：${path}`); return null },
                  )
                } catch {
                  return false
                }
              }
              if (!doc) return false
              version = doc.version
              encoding = doc.encoding
              bom = doc.bom
            }
            const saved = await withBridgeTimeout(
              request<SaveResult>('file.write', {
                path, content, expectedVersion: version, encoding, bom, safeWrite: deps.generalSettings().isUseSafeWrite !== false,
              }),
              () => { console.warn(`[agent] file.write 超时，本次不写盘：${path}`); return null },
            )
            if (!saved) return false
            // 与 revertHistory 同一口径：开着的标签页把缓冲也换掉，不然左侧看到的还是旧文。
            if (open) {
              open.content = content
              open.version = saved.version
              open.dirty = false
              deps.editorFor(path)?.setDraft(content)
              deps.bumpDocumentRevision(path)
            }
            if (isDesktop) void request('lsp.change', { path, text: content }).catch(() => undefined)
            void deps.refreshTree()
            return true
          } catch {
            return false
          }
        },
        modelRequest: (requestBody, onChunk, signal) => requestStream<AgentModelHttpResponse>({ ...requestBody }, onChunk, signal),
        ...(isDesktop ? {
          mcpRuntimeSnapshot: async () => {
            await mcpSetup
            return request<AgentMcpRuntimeSnapshot>('agent.mcp.status', {})
          },
          callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) =>
            request<AgentMcpToolCallResult>('agent.mcp.call', { serverId, toolName, arguments: args }),
        } : {}),
        buildSkillPromptContext: async prompt => {
          const context = await buildAgentSkillPromptContext(deps.workspace()?.root ?? '', prompt)
          return context.prompt
        },
        notify: deps.notify,
        // 对话里的文件/改动 → 左侧编辑器打开并定位（`revealLocation` 的口径；无行号落到顶部）。
        openFile: (path, line) => { void deps.revealLocation({ path, line: line ?? 0 }) },
        showDiff: (_path, editId) => showEditDiff(editId),
      },
    })
  }

  watch(() => deps.workspace()?.root ?? '', root => {
    agentHost.value = root ? build() : null
    agentDiff.value = null
  }, { immediate: true })

  return {
    agentHost,
    agentDiff,
    /** 设置页保存后的落点：持久化 + 让当前装配层立刻用上新的权限档。 */
    persistAgentSettings(next: AgentSettingsState): boolean {
      Object.assign(settings, next)
      agentHost.value?.updateSettings(settings)
      return saveAgentSettings(settings)
    },
  }
}

/** 把工作区条目表折成文件路径清单（`workspace.entries` 是平表：`kind` 分文件与目录）。 */
export function flattenFiles(entries: readonly Entry[]): string[] {
  return entries.filter(entry => entry.kind === 'file').map(entry => entry.path)
}
