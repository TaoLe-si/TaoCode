// 会话里**开着哪些文档、各自什么版本** —— 上游
// `platform/lsp-impl/src/impl/documentSync/LspOpenedFilesService.kt` 与
// `platform/lsp-impl/src/impl/LspDocumentMapping.kt` 在本仓前端的等价物
// （判决 `docs/inventory/verdict-platform_rest.md` 的 `ls/session` / `ls/platform`：
// 「`LspOpenedFilesService` 的按文件打开集合（宿主自持，前端没有查询面）」）。
//
// 本仓的事实：宿主**已经**自持这张表（`native/lsp_session.hpp:143-149` 的
// `struct Document { language, uri, text, version, opened }`），并且
// `open`/`change`/`close` 三条都把版本与 opened 记对了
// （`native/lsp_session.cpp:84-92` 建文档并 version=1、握手好了才 opened=true；
// `:100-107` 每次 change `++version`；`:110-128` close 先 did_close 再 erase）。
// 缺的是**前端的这一份账**：调用方要知道"哪几个文件正在被服务器看着、
// 我要发的那条通知对不对得上服务器记的版本"，否则一个通知发出去没人知道服务器收没收到。
// 本模块就是那份账，并与宿主逐条对齐（宿主那份是权威，这里是可核对的镜像）。
//
// 上游逐条：
//   · `LspOpenedFilesService.kt:36` 待处理集合是 **LinkedHashMap<VirtualFile, Long>**：
//     插入序保证一批文件按**可预测的顺序**被处理；值是"最近一次上报的 start request stamp"。
//   · `:51` stamp 在任何调度**之前**取；注释写明"a stop that comes after this report must win
//     over the starts it requests" —— 停机请求排在后面，所以它要压过这一批要起的服务器。
//   · `:57` `if (openedFilesToHandle.put(it, requestStamp) != requestStamp) changed = true` ——
//     同一个 stamp 下重复上报**不**重新调度（一批里每个文件只处理一次）。
//   · `:115` `openedFilesToHandle.remove(file, requestStamp)`：**按值删**，批次算的期间
//     被更新的一批重新盖了 stamp 的条目不会被这一批删掉。
//   · `:94-98` 只有 `state == Running` 且**还没** opened 且 descriptor 支持，才排 didOpen。
//   · `:137-165` 收尾那一半：对每台**在跑**的服务器取 `getFilesToClose()` 排 didClose。
//   · `LspDocumentMapping.kt:62-64` `getDocumentsInFileSync` + `LspDocumentAdapter.kt:20`
//     "Default implementation works with regular text documents"：普通文件是 **1:1** 映射
//     （一个文件 = 一个 LSP 文档）。notebook 的多文档适配器本仓没有，也不需要
//     （本仓只处理本机文本文件）。
//   · `LspDocumentMapping.kt:132-135` `aggregatePerDocumentResults`：全部是 null 才返回 null
//     （= 没有任何文档回包，缓存保持原状）。
import { rootCoversFile, type LspServerState } from './lsSessionState.ts'

/** 一条待处理的上报：文件 + 那一批的 start request stamp（上游那个 Long）。 */
export interface OpenedFileEntry {
  path: string
  /** 起始请求代号；停机/重配会把它推进，所以"更晚的一批"数值更大。 */
  requestStamp: number
}

/** 一次上报的结论：`files` 是这一批要处理的（按上报顺序），`scheduled` = 要不要真的排一批。 */
export interface OpenedFilesBatch {
  files: OpenedFileEntry[]
  scheduled: boolean
  requestStamp: number
}

/** 宿主那台服务器对某个文件的状态（上游 `LspClientImpl.isFileOpened` / `state` / `isSupportedFile`）。 */
export interface ServerFileFacts {
  state: LspServerState
  /** 该文件当前是否已经发过 didOpen（宿主那份表的 `opened`）。 */
  isFileOpened: (path: string) => boolean
  supportsFile: (path: string) => boolean
  roots: readonly string[]
}

/**
 * 待处理集合（上游 `openedFilesToHandle`）。构造时给 `startRequestStamp()`：
 * 本仓的等价物是"这一代语言服务配置的代号"，`lsp.stop` / 切工程 / 重配都会让它推进
 * （上游是 `LspClientManagerImpl.startRequestStamp`，`LspOpenedFilesService.kt:35` 的注释点名了它）。
 */
export class OpenedFilesTracker {
  private readonly entries = new Map<string, number>()
  private readonly startRequestStamp: () => number

  constructor(startRequestStamp: () => number) {
    this.startRequestStamp = startRequestStamp
  }

  /**
   * `processOpenedFiles`（`:46-59`）的前半段：取 stamp、逐个 `put`、只有**真的有变化**才调度。
   * stamp 在函数第一行取，所以调用方返回后发生的停机一定压过这一批。
   */
  reportOpened(paths: readonly string[]): OpenedFilesBatch {
    const requestStamp = this.startRequestStamp()
    let changed = false
    const seen = new Set<string>()
    for (const path of paths) {
      if (seen.has(path)) continue
      seen.add(path)
      // `put` 返回旧值：只有"这一条原本不是这个 stamp"才算变化（`:57`）。
      if (this.entries.get(path) !== requestStamp) { this.entries.set(path, requestStamp); changed = true }
    }
    return { files: this.pending(), scheduled: changed, requestStamp }
  }

  /** 插入序的待处理列表（`Collections.synchronizedMap(LinkedHashMap)` 的顺序语义）。 */
  pending(): OpenedFileEntry[] {
    return [...this.entries].map(([path, requestStamp]) => ({ path, requestStamp }))
  }

  /**
   * 批次算完之后收尾（`:115`）：**按值删** —— 算批期间被更新的一批重新盖过 stamp 的条目
   * 要留着（那一条属于更晚的一批）。返回真正收掉的路径。
   */
  commit(batch: OpenedFilesBatch): string[] {
    const committed: string[] = []
    for (const entry of batch.files) {
      if (this.entries.get(entry.path) === batch.requestStamp) { this.entries.delete(entry.path); committed.push(entry.path) }
    }
    return committed
  }

  /** 还有没有排着没处理的上报。 */
  get size(): number { return this.entries.size }

  /** 停机：整张表作废（上游换了一代客户端，旧 stamp 全部作废）。 */
  clear(): void { this.entries.clear() }
}

/** 一台服务器对某文件的认领判定（`:90` 的 `roots.any { isAncestor } && isSupportedFile`）。 */
export function serverHandlesFile(facts: ServerFileFacts, path: string): boolean {
  // `roots` 为空 = 工作区根（`native/lsp_session.hpp:38` 的 `workspace_folders` 语义），
  // 与 `isExpectedToHandleFile` 同一处修正：`.some` 在空数组上恒 false，空表必须先放行。
  const covered = facts.roots.length === 0 || facts.roots.some(root => rootCoversFile(root, path))
  return covered && facts.supportsFile(path)
}

/**
 * 这一批里**要发 didOpen** 的（`scheduleOpenedFilesProcessing` 的 `:94-98`）：
 * 状态是 Running、这个文件还没 opened、且这台服务器认领它。
 * 没认领的文件会走 provider 的 `fileOpened` 去起一台新服务器（`:101-105`）——
 * 本仓按语言选唯一一台，起不起由 `native/lsp_config.cpp` 的合成表决定，所以这里只返回前者。
 */
export function filesNeedingDidOpen(batch: OpenedFilesBatch, facts: ServerFileFacts): string[] {
  if (facts.state !== 'running') return []
  return batch.files
    .map(entry => entry.path)
    .filter(path => !facts.isFileOpened(path) && serverHandlesFile(facts, path))
}

/**
 * 该发 didClose 的（`scheduleClosingFilesThatAreNotOfInterest` `:137-165`）：
 * 只对**在跑**的服务器算；`isOpenNow` 是调用方给的"编辑器现在还开着吗"。
 */
export function filesNeedingDidClose(opened: readonly string[], facts: ServerFileFacts, isOpenNow: (path: string) => boolean): string[] {
  if (facts.state !== 'running') return []
  return opened.filter(path => !isOpenNow(path) && serverHandlesFile(facts, path))
}

/**
 * 前端这一份**文档账**（`LspDocumentMapping` 的 1:1 映射 + `LspDocumentAdapter` 的默认实现）。
 * 字段与宿主的 `struct Document`（`native/lsp_session.hpp:143-149`）逐个对齐，
 * 但只记前端能核对的那些：语言、版本、是否已 didOpen。uri 与正文由宿主持有，不复制一份。
 */
export interface TrackedDocument {
  path: string
  language: string
  /** 与宿主一致的文档版本：open 时 1，每次 change +1（`lsp_session.cpp:87` / `:104`）。 */
  version: number
  /** 已经发过 didOpen（宿主只在握手 ready 之后才置位，`lsp_session.cpp:92`）。 */
  opened: boolean
}

/** 宿主同步维护的这份账。`languageOf` 由调用方给（上游 `descriptor.isSupportedFile` 那一族）。 */
export class DocumentLedger {
  private readonly docs = new Map<string, TrackedDocument>()
  private readonly languageOf: (path: string) => string

  constructor(languageOf: (path: string) => string) {
    this.languageOf = languageOf
  }

  /** `Session::open`：`version = 1`、先 `opened = false`，握手 ready 之后才 `openDocumentSynced`。 */
  open(path: string, serverReady: boolean): TrackedDocument {
    const doc: TrackedDocument = { path, language: this.languageOf(path), version: 1, opened: serverReady }
    this.docs.set(path, doc)
    return doc
  }

  /** `flush_opens` / `open` 握手回包之后把补发的 didOpen 记上（`lsp_session.cpp:92`、`:353`）。 */
  markSynced(path: string): void {
    const doc = this.docs.get(path)
    if (doc) doc.opened = true
  }

  /** `Session::change`：`++version`（`lsp_session.cpp:104`）。没登记过的路径不凭空建条目。 */
  change(path: string): TrackedDocument | null {
    const doc = this.docs.get(path)
    if (!doc) return null
    doc.version += 1
    return doc
  }

  /** `Session::close`：从账上除掉（`lsp_session.cpp:128`）。 */
  close(path: string): void {
    this.docs.delete(path)
  }

  /**
   * `getDocumentsInFileSync`（`LspDocumentMapping.kt:62-64`）：普通文件是 1:1，
   * 所以结果要么一个要么没有 —— 保留 List 形状是为了调用方不必为 notebook 形态写分支。
   */
  documentsInFile(path: string): TrackedDocument[] {
    const doc = this.docs.get(path)
    return doc ? [doc] : []
  }

  /** 某台语言（= 某个 descriptor）当前被打开的文档，按打开先后（`LinkedHashMap` 语义）。 */
  openedByLanguage(language: string): TrackedDocument[] {
    return [...this.docs.values()].filter(doc => doc.language === language)
  }

  /**
   * 通知前的版本闸门：宿主回包带版本（`apply_document_edits` 的版本核对，
   * `native/lsp_session.hpp:158`）时用得上。版本对不上说明这条通知是给旧版本的，返回 false。
   */
  acceptsVersion(path: string, version: number): boolean {
    const doc = this.docs.get(path)
    if (!doc) return false
    return doc.version === version
  }

  get size(): number { return this.docs.size }

  clear(): void { this.docs.clear() }
}
