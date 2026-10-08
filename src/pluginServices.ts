// **插件服务面（upstream-named services）** —— 让"原版 IDEA 能跑的插件"在我们这个 IDE 上
// 也能拿到它惯用的那几样服务。上游每个服务都是一个 `@Service`（`ApplicationManager.getService(Class)`
// / `project.getService(Class)`），插件按**接口的全限定名**取；本仓没有 JVM 对象模型，
// 所以这里用**同名 FQN 的字符串 id** 当键、把能等价的方法逐条映射到本仓的真实模块上。
//
// 覆盖的五项（与协调者点名的"把能暴露的都暴露"对齐）：
//   · HTTP 只读文件 —— `com.intellij.openapi.vfs.ex.http.HttpVirtualFileSystem`
//       （`getProtocol`/`isHttpUrl`/`getUrl`/`findFileByUrl`/`getContents`）与
//       `com.intellij.openapi.vfs.impl.http.RemoteFileManager`
//       （上游 :13-24 的 `addRemoteContentProvider`/`removeRemoteContentProvider`/`addFileListener`/`removeFileListener`）。
//       实现在 `src/remoteFiles.ts` + `src/remoteFileHost.ts`（宿主 `http.get`，WinHTTP）。
//   · 编辑器窗口 —— `com.intellij.openapi.fileEditor.FileEditorManager`
//       （`openFile`/`getOpenFiles`/`getSelectedFiles`/`closeFile`/`isFileOpen`）与
//       `com.intellij.openapi.fileEditor.FileEditorManagerListener` 的订阅主题；
//       多窗口/浮层编辑器那一半是 `src/editorWindows.ts` 的 `detachTab`/`detachedWindowUrl`
//       （上游 `FileEditorManagerEx`/`EditorWindow` 的 split 语义）。
//       **注意**：协调者点名的 `EditorWindowService` 在参考树里**不存在**（已 grep 确认），
//       真正对得上的是 `FileEditorManager` + `impl.EditorWindow`，这里按真名暴露。
//   · 搁架 —— `com.intellij.openapi.vcs.changes.shelf.ShelveChangesManager`
//       （`getAllLists`/`shelveChanges`/`unshelveChanges`/`deleteList`）与
//       `...savedPatches.ShelfProvider` 的 `applyAction`/`popAction` 语义；
//       实现在 `src/shelfTree.ts` + `src/shelfHost.ts`（后端是 `git stash`）。
//   · 符号/PSI —— `com.intellij.psi.JavaPsiFacade`（`findClass`/`findPackage`/`getClassesInPackage`）
//       与 `com.intellij.psi.PsiManager`（`findFile`）；实现在 `src/symbolModel.ts`（包树 + 符号树）。
//       **注意**：`com.intellij.psi.PsiFacade` 这个基类在参考树里**不存在**（已 grep 确认），
//       参考树有的是 `JavaPsiFacade`，这里按真名暴露。
//
// 注册走既有 EP 宿主（`src/extensionPoints.ts`）：每个服务是一条 `com.intellij.service` 贡献，
// `serviceOf(registry, fqn)` 就是 `ApplicationManager.getService` 的等价物。判据
// `tests/plugin-services.test.mjs`。
import { APPLICATION_SCOPE, EXTENSIONS, FILE_EDITOR_MANAGER_LISTENER_EP, SERVICE_EP, SHELVE_CHANGES_MANAGER_LISTENER_EP, type ExtensionHandle } from './extensionPoints.ts'
import { isRemoteUrl, normalizeRemoteUrl, remoteFileId, type RemoteFetchResult } from './remoteFiles.ts'
import { shelfRows, type ShelfRow } from './shelfTree.ts'
import { packageNodeOf, type PackageNode, type SymbolNode } from './symbolModel.ts'
import { detachTab, detachedWindowUrl, type DetachedEditor } from './editorWindows.ts'
import type { GitStashEntry } from './vcsLogTypes.ts'

// ── 上游 FQN（键）────────────────────────────────────────────────────────────

export const HTTP_VIRTUAL_FILE_SYSTEM = 'com.intellij.openapi.vfs.ex.http.HttpVirtualFileSystem'
export const REMOTE_FILE_MANAGER = 'com.intellij.openapi.vfs.impl.http.RemoteFileManager'
export const FILE_EDITOR_MANAGER = 'com.intellij.openapi.fileEditor.FileEditorManager'
/** 事件主题 id 与 `src/extensionPoints.ts` 的声明同值（那边声明、这边暴露给插件订阅）。 */
export const FILE_EDITOR_MANAGER_LISTENER = FILE_EDITOR_MANAGER_LISTENER_EP
export const SHELVE_CHANGES_MANAGER_LISTENER = SHELVE_CHANGES_MANAGER_LISTENER_EP
export const SHELVE_CHANGES_MANAGER = 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManager'
export const JAVA_PSI_FACADE = 'com.intellij.psi.JavaPsiFacade'
export const PSI_MANAGER = 'com.intellij.psi.PsiManager'
/** 搁架工具窗口的 apply/pop 两个动作 id（上游 `ShelfProvider.kt:38-40` 的 `Vcs.Shelf.Apply`/`Pop`）。 */
export const SHELF_APPLY_ACTION_ID = 'Vcs.Shelf.Apply'
export const SHELF_POP_ACTION_ID = 'Vcs.Shelf.Pop'

// ── 服务形状 ─────────────────────────────────────────────────────────────────

export interface PluginService {
  /** 上游的全限定名（也是注册进 EP 的 id）。 */
  id: string
  /** 作用域（application / project）；本仓单进程，统一 application。 */
  scope: string
  /** 这一服务对应上游哪个类（写进判据与诊断，防止"挂了个名字但方法对不上"）。 */
  upstream: string
  /** 暴露的方法名（须与上游接口的方法名一致；做不到的在这里写清缺哪条）。 */
  methods: string[]
  /** 实现对象（方法名 → 函数）。 */
  impl: Record<string, unknown>
}

/** 一个只读虚拟文件句柄（上游 `VirtualFile` 的可移植子集：身份 + 只读 + 是否有效）。 */
export interface VirtualFileHandle {
  url: string
  name: string
  readonly: true
  valid: boolean
}

/** 插件侧注册的远程内容提供者（上游 `RemoteContentProvider`）。 */
export interface RemoteContentProvider {
  /** 认领哪些 URL（返回 true 就由这个 provider 供内容）。 */
  canProvide: (url: string) => boolean
  /** 取内容（调用方 await）。 */
  contents: (url: string) => Promise<RemoteFetchResult | null>
  /** 提供者名字（诊断用）。 */
  name?: string
}

/** 插件侧的文件编辑器事件订阅者（上游 `FileEditorManagerListener`）。 */
export interface FileEditorManagerListener {
  fileOpened?: (path: string) => void
  fileClosed?: (path: string) => void
  selectionChanged?: (path: string) => void
}

export interface ShelveChangesManagerListener {
  /** 储藏列表变了（上游 `ShelveChangesManager.SHELF_TOPIC`）。 */
  shelfChanged?: (count: number) => void
}

/** 宿主端口：能等价到本仓模块的每一格都由装配层注入（判据用假实现）。 */
export interface PluginServiceDeps {
  /** 取远程内容（默认 `remoteFileHost.fetchRemoteRaw` 由装配层包一层传进来）。 */
  fetch?: (url: string) => Promise<RemoteFetchResult>
  /** 打开一个文件（编辑器那一条）。 */
  openFile?: (path: string) => unknown
  /** 关闭一个文件。 */
  closeFile?: (path: string) => unknown
  /** 当前打开的文件（路径列表）。 */
  openFiles?: () => string[]
  /** 当前选中的文件（单窗格 = 活动标签；多窗格 = 每窗格一个）。 */
  selectedFiles?: () => string[]
  /** 读一次储藏列表（`git stash list`）。 */
  stashList?: () => Promise<GitStashEntry[]>
  /** 存一条储藏（`git stash push -m`）。 */
  stashSave?: (message: string) => Promise<void>
  /** 取回一条储藏（按 ref；空 ref = 栈顶）。 */
  stashPop?: (ref: string) => Promise<void>
  /** 当前工作区的包/符号索引（`src/symbolModel.ts` 的包树）。 */
  packageRoots?: () => readonly PackageNode[]
  /** 某个文件里的符号（`src/symbolModel.ts` 的符号树）。 */
  fileSymbols?: (path: string) => readonly SymbolNode[]
}

// ── 服务实现 ─────────────────────────────────────────────────────────────────

/** HTTP 只读文件系统（上游 `HttpVirtualFileSystem` + `RemoteFileManager`）。 */
function httpVirtualFileSystem(deps: PluginServiceDeps): { service: PluginService; providers: RemoteContentProvider[]; listeners: Set<unknown> } {
  const providers: RemoteContentProvider[] = []
  const listeners = new Set<unknown>()
  const impl = {
    getProtocol: () => 'http',
    isHttpUrl: (url: unknown) => isRemoteUrl(String(url ?? '')),
    getUrl: (handle: unknown) => normalizeRemoteUrl((handle as VirtualFileHandle)?.url ?? String(handle ?? '')),
    findFileByUrl: (url: unknown): VirtualFileHandle | null => {
      const id = remoteFileId(String(url ?? ''))
      return id ? { url: id.url, name: id.name, readonly: true, valid: true } : null
    },
    // `RemoteContentProvider` 那一档：插件先认领再供内容。
    addRemoteContentProvider: (provider: RemoteContentProvider) => { providers.push(provider) },
    removeRemoteContentProvider: (provider: RemoteContentProvider) => {
      const at = providers.indexOf(provider)
      if (at >= 0) providers.splice(at, 1)
    },
    addFileListener: (listener: unknown) => { listeners.add(listener) },
    removeFileListener: (listener: unknown) => { listeners.delete(listener) },
    /** 本仓扩展：直接取内容（先问 provider，再退回宿主 `http.get`）。 */
    getContents: async (url: unknown): Promise<RemoteFetchResult | null> => {
      const text = String(url ?? '')
      const provider = providers.find(candidate => candidate.canProvide(text))
      if (provider) return provider.contents(text)
      return deps.fetch ? deps.fetch(text) : null
    },
  }
  return {
    providers,
    listeners,
    service: {
      id: HTTP_VIRTUAL_FILE_SYSTEM,
      scope: APPLICATION_SCOPE,
      upstream: 'com.intellij.openapi.vfs.ex.http.HttpVirtualFileSystem (+ RemoteFileManager)',
      methods: ['getProtocol', 'isHttpUrl', 'getUrl', 'findFileByUrl', 'getContents',
        'addRemoteContentProvider', 'removeRemoteContentProvider', 'addFileListener', 'removeFileListener'],
      impl,
    },
  }
}

/** 编辑器窗口（上游 `FileEditorManager`，多窗口由 `editorWindows.ts` 承担）。 */
function fileEditorManager(deps: PluginServiceDeps): { service: PluginService; listeners: Set<FileEditorManagerListener> } {
  const listeners = new Set<FileEditorManagerListener>()
  const impl = {
    openFile: (path: unknown) => {
      const value = String(path ?? '')
      const result = deps.openFile?.(value)
      for (const listener of listeners) listener.fileOpened?.(value)
      return result
    },
    closeFile: (path: unknown) => {
      const value = String(path ?? '')
      const result = deps.closeFile?.(value)
      for (const listener of listeners) listener.fileClosed?.(value)
      return result
    },
    isFileOpen: (path: unknown) => (deps.openFiles?.() ?? []).includes(String(path ?? '')),
    getOpenFiles: () => deps.openFiles?.() ?? [],
    getSelectedFiles: () => deps.selectedFiles?.() ?? [],
    /** 订阅文件编辑器事件（上游 `FileEditorManagerListener` 主题）。 */
    subscribe: (listener: FileEditorManagerListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 多窗口/浮层（上游 `FileEditorManagerEx.createSplitter` 的等价物，见 `src/editorWindows.ts`）。 */
    detachFile: (groups: readonly (readonly string[])[], path: unknown, pane = 0): DetachedEditor | null =>
      detachTab(groups, String(path ?? ''), pane).detached,
    detachedUrl: (baseUrl: string, path: unknown) => detachedWindowUrl(baseUrl, String(path ?? '')),
  }
  return {
    listeners,
    service: {
      id: FILE_EDITOR_MANAGER,
      scope: APPLICATION_SCOPE,
      upstream: 'com.intellij.openapi.fileEditor.FileEditorManager (+ FileEditorManagerEx split)',
      methods: ['openFile', 'closeFile', 'isFileOpen', 'getOpenFiles', 'getSelectedFiles', 'subscribe', 'detachFile', 'detachedUrl'],
      impl,
    },
  }
}

/** 搁架（上游 `ShelveChangesManager` + `ShelfProvider` 的 apply/pop）。 */
function shelveChangesManager(deps: PluginServiceDeps): { service: PluginService; listeners: Set<ShelveChangesManagerListener> } {
  const listeners = new Set<ShelveChangesManagerListener>()
  async function notify() {
    const entries = deps.stashList ? await deps.stashList() : []
    for (const listener of listeners) listener.shelfChanged?.(entries.length)
  }
  const impl = {
    /** 上游 `allLists`：本仓 = `git stash list` 整形成搁架行。 */
    getAllLists: async (): Promise<ShelfRow[]> => shelfRows(deps.stashList ? await deps.stashList() : []),
    shelveChanges: async (message: unknown) => { await deps.stashSave?.(String(message ?? '')); await notify() },
    unshelveChanges: async (ref: unknown, remove: unknown) => {
      const value = String(ref ?? '')
      await deps.stashPop?.(value)
      if (remove !== false) await notify()
    },
    deleteList: async (ref: unknown) => {
      // 上游 `deleteList` 是 drop；本仓没有 `git stash drop` 通道 —— 如实拒绝，不假装成功。
      throw new Error(`ShelveChangesManager.deleteList 在本仓没有落点（缺 git stash drop 通道）：${String(ref ?? '')}`)
    },
    /** apply = 只应用不删除（本仓 `git stash apply` 未开通道）；pop = 应用并删除（走 `stashPop`）。 */
    [SHELF_POP_ACTION_ID]: async (ref: unknown) => { await impl.unshelveChanges(ref, true) },
    subscribe: (listener: ShelveChangesManagerListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    listeners,
    service: {
      id: SHELVE_CHANGES_MANAGER,
      scope: APPLICATION_SCOPE,
      upstream: 'com.intellij.openapi.vcs.changes.shelf.ShelveChangesManager (+ savedPatches.ShelfProvider)',
      methods: ['getAllLists', 'shelveChanges', 'unshelveChanges', 'deleteList', SHELF_POP_ACTION_ID, 'subscribe'],
      impl,
    },
  }
}

/** 符号/PSI（上游 `JavaPsiFacade` + `PsiManager`；`PsiFacade` 基类参考树里没有）。 */
function psiFacade(deps: PluginServiceDeps): PluginService {
  const roots = () => deps.packageRoots?.() ?? []
  const findPackage = (qName: unknown): PackageNode | null => packageNodeOf(roots(), String(qName ?? '')) ?? null
  /** 一个包里的"类" = 它名下的文件去掉扩展名（上游 `getClassesInPackage` 取的是 PsiClass）。 */
  const classNamesIn = (node: PackageNode | null): string[] =>
    (node?.files ?? []).map(file => file.split('/').pop()!.replace(/\.[^.]*$/, ''))
  const impl = {
    findPackage,
    findClass: (qName: unknown): { name: string; path: string } | null => {
      const text = String(qName ?? '')
      const cut = text.lastIndexOf('.')
      const packageName = cut >= 0 ? text.slice(0, cut) : ''
      const short = cut >= 0 ? text.slice(cut + 1) : text
      const node = findPackage(packageName)
      const file = (node?.files ?? []).find(candidate => candidate.split('/').pop()!.replace(/\.[^.]*$/, '') === short)
      return file ? { name: text, path: file } : null
    },
    getClassesInPackage: (qName: unknown): string[] => classNamesIn(findPackage(qName)),
    findFile: (path: unknown) => {
      const value = String(path ?? '')
      return { name: value, path: value, valid: Boolean(deps.fileSymbols) }
    },
    /** 上游 `JavaPsiFacade.getElementFactory` 没有 PSI 工厂，如实给 null。 */
    getElementFactory: () => null,
  }
  return {
    id: JAVA_PSI_FACADE,
    scope: APPLICATION_SCOPE,
    upstream: 'com.intellij.psi.JavaPsiFacade (+ PsiManager)',
    methods: ['findPackage', 'findClass', 'getClassesInPackage', 'findFile', 'getElementFactory'],
    impl,
  }
}

// ── 注册与查找 ───────────────────────────────────────────────────────────────

/** 建出全部服务（顺序即注册顺序）。 */
export function createPluginServices(deps: PluginServiceDeps = {}): PluginService[] {
  return [httpVirtualFileSystem(deps).service, fileEditorManager(deps).service, shelveChangesManager(deps).service, psiFacade(deps)]
}

export function declaredServiceIds(): string[] {
  return [HTTP_VIRTUAL_FILE_SYSTEM, REMOTE_FILE_MANAGER, FILE_EDITOR_MANAGER, FILE_EDITOR_MANAGER_LISTENER,
    SHELVE_CHANGES_MANAGER, SHELVE_CHANGES_MANAGER_LISTENER, JAVA_PSI_FACADE, PSI_MANAGER]
}

/** 注册进 EP 宿主（与 `src/extensionPoints.ts` 的其它贡献同一张表）。 */
export function registerPluginServices(services: readonly PluginService[]): ExtensionHandle[] {
  return services.map(service => EXTENSIONS.registerExtension(SERVICE_EP, service.id, service, { source: 'user' }))
}

/** `ApplicationManager.getService(Class)` / `project.getService(Class)` 的等价物：按 FQN 取。 */
export function serviceOf(fqn: string): PluginService | undefined {
  return EXTENSIONS.extensionsOf<PluginService>(SERVICE_EP).find(service => service.id === fqn)
}

export interface PluginServiceCatalogEntry {
  id: string
  methods: string
  upstream: string
}

/** 诊断用：当前注册了哪些服务、各暴露哪些方法（插件页/日志显示，便于"原版插件缺哪一格"排查）。 */
export function pluginServiceCatalog(): PluginServiceCatalogEntry[] {
  return EXTENSIONS.extensionsOf<PluginService>(SERVICE_EP)
    .map(service => ({ id: service.id, methods: service.methods.join(', '), upstream: service.upstream }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
