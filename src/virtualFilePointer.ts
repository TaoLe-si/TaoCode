// **虚拟文件指针**（上游 `com.intellij.openapi.vfs.pointers.VirtualFilePointer` 一族）——
// 纯函数 + 一个可订阅的注册表，零 Vue、零 DOM、零 bridge。
//
// 上游是什么：一个「指向某个文件的**稳定句柄**」，文件被改名/移动/删除/重建时它自己跟着变，
// 调用方（书签、运行配置、标签、断点…）持的是指针而**不是路径字符串**：
//   · `VirtualFilePointer`（`platform/core-api/src/com/intellij/openapi/vfs/pointers/
//     VirtualFilePointer.java:14-34`）：`getFileName()`、`getFile()`、`getUrl()`、
//     `getPresentableUrl()`、`isValid()` —— 五个方法，核心是 `isValid()`（"文件还在吗"）
//     与 `getUrl()`（"现在指向哪"）；
//   · `VirtualFilePointerManager`（同目录 `VirtualFilePointerManager.java:16-38`）：
//     `create(url, parent, listener)` / `create(file, …)` / `duplicate(pointer, …)` /
//     `createContainer(parent)`；`VirtualFilePointerListener`（`VirtualFilePointerListener.java:8-15`）
//     有 `beforeValidityChanged(pointers)` 与 `validityChanged(pointers)` 两个回调；
//   · 实现 `VirtualFilePointerImpl`（`platform/platform-impl/src/com/intellij/openapi/vfs/impl/
//     VirtualFilePointerImpl.java`）持一个 trie 节点，`isValid()`（`:78-81`）就是
//     `fileOrNull(node.fileOrUrl) != null`；有效性变化由 `VirtualFilePointerManagerImpl`
//     在 `BulkFileListener` 的 VFileMove/Delete/Create 事件里广播。
//
// 本仓现状（2026-10-06 实读）：**没有独立指针对象** —— 标签/书签/断点都用**路径字符串**当键，
// 改名后靠各模块各自的"重锚"逻辑补：
//   · 书签：`src/bookmarks.ts` 的 `reconcileBookmarks`（编辑后按行文本对账）；
//   · 标签：`src/treeActions.ts` 的改名走 `file.rename`，打开的标签由调用方按新路径重开。
// 路径字符串的问题是**每一处都要自己记得在改名时更新**，漏一处就是"指向一个不存在的文件"
// 且没有任何东西会告诉你（上游正是靠指针的 `isValid()` 把这件事变成可查询的）。
//
// 本文件补上这一层**在本仓架构下可做的部分**：一个纯路径指针 + 按 `file.rename` 的
// `(from → to)` 对账（含目录前缀改名）、有效性判定（由调用方注入"这个路径在不在"），
// 以及 `beforeValidityChanged`/`validityChanged` 两档回调。**不**建影子 VFS/FileId：
// 本仓以操作系统为真源（`native/workspace.cpp`），没有 `FSRecords` 那种 id 表，
// 所以指针的身份是**路径**而不是 id —— 这一点与上游不同，已写进报告。
//
// 判据：`tests/virtual-file-pointer.test.mjs`。

/** 指针指向的**种类**（上游没有这一层；本仓的标签/书签两类消费者需要区分）。 */
export type PointerKind = 'file' | 'directory'

/** 一个虚拟文件指针（`VirtualFilePointer` 的等价物）。 */
export interface VirtualFilePointer {
  /** 创建时的路径（`create` 那一刻的 key，用于去重与排错；改名后**不**跟着变）。 */
  readonly key: string
  /** 当前指向的路径（改名对账后会变）—— 上游 `getUrl()` 的等价物。 */
  path: () => string
  /** 末段名字（上游 `getFileName()`）。 */
  fileName: () => string
  /** 这个路径现在还在吗（上游 `isValid()`）。判定由调用方注入的存在性函数给。 */
  isValid: () => boolean
  kind: PointerKind
}

/** 一次改名（`file.rename` 的 `(from, to)`；两端都是工作区相对路径、正斜杠）。 */
export interface PointerRename {
  from: string
  to: string
}

/** 有效性判定：给一个路径，说它现在在不在（宿主 `workspace.list`/`workspace.files` 的缓存口径）。 */
export type ExistsFn = (path: string) => boolean

/** 名字取末段（与 `src/rootsJarEntries.ts` 的 basename 同一口径）。 */
export function pointerFileName(path: string): string {
  const trimmed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

/**
 * 路径改名对账：`path` 落在 `from` 这一棵（含它自己）下时换成 `to` 下的对应路径。
 *   · 目录改名要**带上整棵子树**：`src/a/b.ts` 在 `src` → `lib` 之后是 `lib/a/b.ts`；
 *   · 只按**段边界**匹配：`src2/x.ts` 不该被 `src` → `lib` 带走（上游 trie 按目录节点分层，
 *     同一件事）；
 *   · 与 `from` 无关时原样返回。
 */
export function remapPointerPath(path: string, rename: PointerRename): string {
  const from = rename.from.replace(/\\/g, '/').replace(/\/+$/, '')
  const to = rename.to.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized = path.replace(/\\/g, '/')
  if (!from) return normalized
  if (normalized === from) return to
  if (normalized.startsWith(`${from}/`)) return `${to}${normalized.slice(from.length)}`
  return normalized
}

/** 一次改名对一批路径的对账（顺序执行，便于连续改名）。 */
export function remapPointerPaths(paths: readonly string[], renames: readonly PointerRename[]): string[] {
  let current = paths.map(path => path.replace(/\\/g, '/'))
  for (const rename of renames) current = current.map(path => remapPointerPath(path, rename))
  return current
}

export interface PointerListener {
  /** 有效性**将要**变化（上游 `beforeValidityChanged`）。 */
  beforeValidityChanged?: (pointers: readonly VirtualFilePointer[]) => void
  /** 有效性**已经**变化（上游 `validityChanged`）。 */
  validityChanged?: (pointers: readonly VirtualFilePointer[]) => void
}

export interface VirtualFilePointerManager {
  /** 建一个指针（上游 `create(url, parent, listener)`）。同路径同 kind 重复创建返回同一对象。 */
  create: (path: string, kind?: PointerKind, listener?: PointerListener) => VirtualFilePointer
  /** 复制一个指针（上游 `duplicate`）—— 新对象，同一起点路径。 */
  duplicate: (pointer: VirtualFilePointer, listener?: PointerListener) => VirtualFilePointer
  /** 当前活着的指针（排查与断言用）。 */
  pointers: () => readonly VirtualFilePointer[]
  /** 解绑一个指针（上游 `Disposable` 的 dispose）：返回是否真的删掉了。 */
  dispose: (pointer: VirtualFilePointer) => boolean
  /**
   * 改名对账（上游 `VirtualFilePointerManagerImpl` 在 VFileMove 事件里做的事）：
   * 把落在 `from` 下的指针改指到 `to`，然后**广播有效性变化**（改名前后 `exists` 结论变了的那批）。
   */
  rename: (rename: PointerRename, exists: ExistsFn) => readonly VirtualFilePointer[]
  /**
   * 重新判定一批指针的有效性（上游 `BulkFileListener` 在 Create/Delete 事件里做的事）。
   * 返回**有效性真的变了**的那批，并依次触发两档回调。
   */
  refresh: (exists: ExistsFn, candidates?: readonly VirtualFilePointer[]) => readonly VirtualFilePointer[]
}

/**
 * 建一个指针管理器。`exists` 缺省恒为 true —— 上游没有"存在性未知"这一档（`isValid()` 是布尔），
 * 所以本仓也保持两态：调用方不注入就表示"不判定有效性"（构造期与未接盘时都当有效）。
 */
export function createVirtualFilePointerManager(initialExists?: ExistsFn): VirtualFilePointerManager {
  let exists: ExistsFn = initialExists ?? (() => true)
  const table = new Map<string, { pointer: MutablePointer; listeners: Set<PointerListener> }>()

  interface MutablePointer {
    key: string
    path: string
    kind: PointerKind
    valid: boolean
  }

  const snapshot = (entry: { pointer: MutablePointer }): VirtualFilePointer => {
    const { pointer } = entry
    return {
      key: pointer.key,
      path: () => pointer.path,
      fileName: () => pointerFileName(pointer.path),
      isValid: () => pointer.valid,
      kind: pointer.kind,
    }
  }

  /** 所有监听这个 key 的订阅者（上游一个指针可以挂多个 listener）。 */
  function listenersFor(key: string): Set<PointerListener> {
    return table.get(key)?.listeners ?? new Set()
  }

  function broadcast(keys: readonly string[], pointers: readonly VirtualFilePointer[], phase: 'before' | 'after') {
    for (const key of keys) {
      for (const listener of listenersFor(key)) {
        if (phase === 'before') listener.beforeValidityChanged?.(pointers)
        else listener.validityChanged?.(pointers)
      }
    }
  }

  function keyOf(path: string, kind: PointerKind): string {
    return `${kind}:${path.replace(/\\/g, '/')}`
  }

  const manager: VirtualFilePointerManager = {
    create: (path, kind = 'file', listener) => {
      const normalized = path.replace(/\\/g, '/')
      const key = keyOf(normalized, kind)
      let entry = table.get(key)
      if (!entry) {
        entry = { pointer: { key: normalized, path: normalized, kind, valid: exists(normalized) }, listeners: new Set() }
        table.set(key, entry)
      }
      if (listener) entry.listeners.add(listener)
      return snapshot(entry)
    },
    duplicate: (pointer, listener) => manager.create(pointer.path(), pointer.kind, listener),
    pointers: () => [...table.values()].map(snapshot),
    dispose: pointer => {
      const key = keyOf(pointer.path(), pointer.kind)
      const entry = table.get(key)
      if (!entry) return false
      table.delete(key)
      return true
    },
    rename: (rename, nextExists) => {
      exists = nextExists
      // 找出所有落在 `from` 这一棵下的指针（key 是旧路径；改名后 key 也更新，避免留下重复项）。
      const moved: Array<{ key: string; beforeValid: boolean; pointer: VirtualFilePointer }> = []
      for (const [key, entry] of [...table.entries()]) {
        const next = remapPointerPath(entry.pointer.path, rename)
        if (next === entry.pointer.path) continue
        const beforeValid = entry.pointer.valid
        entry.pointer.path = next
        entry.pointer.valid = exists(next)
        const nextKey = keyOf(next, entry.pointer.kind)
        table.delete(key)
        table.set(nextKey, entry)
        moved.push({ key: nextKey, beforeValid, pointer: snapshot(entry) })
      }
      // 改名前后 `isValid` 结论变了的那批：先 `beforeValidityChanged`，再 `validityChanged`
      // （上游两档回调的顺序，见 `VirtualFilePointerManagerImpl` 的 `fireBefore`/`fire`）。
      const changed = moved.filter(item => item.beforeValid !== item.pointer.isValid())
      broadcast(changed.map(item => item.key), changed.map(item => item.pointer), 'before')
      broadcast(changed.map(item => item.key), changed.map(item => item.pointer), 'after')
      return moved.map(item => item.pointer)
    },
    refresh: (nextExists, candidates) => {
      exists = nextExists
      const changed: VirtualFilePointer[] = []
      const keys: string[] = []
      for (const [key, entry] of table.entries()) {
        const view = snapshot(entry)
        if (candidates && !candidates.some(item => item.path() === entry.pointer.path && item.kind === entry.pointer.kind)) continue
        const next = exists(entry.pointer.path)
        if (next === entry.pointer.valid) continue
        entry.pointer.valid = next
        changed.push(view)
        keys.push(key)
      }
      broadcast(keys, changed, 'before')
      broadcast(keys, changed, 'after')
      return changed
    },
  }
  return manager
}
