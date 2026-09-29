import { reactive, readonly } from 'vue'
import type { ProjectTreeSortSettings } from './projectTreeSort'

// ProjectViewSettings.getSortKey(): BY_NAME; ViewSettings.Immutable(null):
// foldersAlwaysOnTop=true. This is local browser persistence, not workspace.xml.
export const DEFAULT_PROJECT_TREE_SETTINGS: Readonly<ProjectTreeSortSettings> = Object.freeze({
  sortKey: 'BY_NAME', foldersAlwaysOnTop: true,
  // IDEA `ProjectViewSharedSettings.kt:32-34` 三条默认值都是 false。
  autoscrollToSource: false, autoscrollFromSource: false, openInPreviewTab: false,
})
const BOOLEAN_KEYS = ['foldersAlwaysOnTop', 'autoscrollToSource', 'autoscrollFromSource', 'openInPreviewTab'] as const
const hosts = new Map<string, ReturnType<typeof createHost>>()
const prefix = 'taocode.projectView.v1:'
function createHost(root: string) {
  const state = reactive<ProjectTreeSortSettings>({ ...DEFAULT_PROJECT_TREE_SETTINGS })
  const status = reactive({ persistenceError: '' })
  const key = prefix + encodeURIComponent(root)
  try {
    const raw: unknown = root ? JSON.parse(localStorage.getItem(key) ?? 'null') : null
    if (raw && typeof raw === 'object') {
      const value = raw as Record<string, unknown>
      if (value.sortKey === 'BY_NAME' || value.sortKey === 'BY_TYPE') state.sortKey = value.sortKey
      // 缺键就取默认：旧存档里没有这三条不该被判成损坏（与项目其它设置同一条纪律）。
      for (const key of BOOLEAN_KEYS) if (typeof value[key] === 'boolean') state[key] = value[key]
    }
  } catch { status.persistenceError = '项目视图设置无法读取，当前使用默认值。' }
  function update(patch: Partial<ProjectTreeSortSettings>) {
    if (patch.sortKey === 'BY_NAME' || patch.sortKey === 'BY_TYPE') state.sortKey = patch.sortKey
    for (const key of BOOLEAN_KEYS) if (typeof patch[key] === 'boolean') state[key] = patch[key]
    if (!root) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
      status.persistenceError = ''
    } catch { status.persistenceError = '项目视图设置无法保存；本次会话仍有效。' }
  }
  return { state: readonly(state), status: readonly(status), update }
}

/** Both project trees must use this registry, never construct private hosts.
 * The exact native workspace root is the identity; no guessed path case folding.
 * No event listeners/watchers are installed, and inactive hosts issue no work.
 */
export function getProjectTreeState(root: string) {
  let host = hosts.get(root)
  if (!host) { host = createHost(root); hosts.set(root, host) }
  return host
}
