// 文件级可撤动作（`pv/command` 族里 `FileUndoProvider` 那一半）。
//
// 上游形状：`platform/lvcs-impl/src/com/intellij/openapi/command/impl/FileUndoProvider.java`
// 是个 VFS 监听器 —— 命令执行期间发生的文件事件（`:100-114` after：create / move / rename /
// copy / delete）逐个变成 `GlobalUndoableAction` 塞进当前命令组（`:116-124`），
// 撤销时靠本地历史的 `ChangeRange.revert`（`:206-236`）把那次变更反着放回去；
// 归不了本地历史的文件走 `registerNonUndoableAction`（`:185-187`），之后撤销碰到它就整条拒绝。
//
// 本仓没有 VFS 事件总线（文件操作都是前端**主动**调宿主），所以这一层做成**显式登记**：
// 谁做了文件操作，谁把「反着做一遍」的那一步交进来。可撤性判定照上游那两条：
//   · 内容拿得回来才谈得上撤 —— 文本文件用 `file.read` 抓快照（`native/workspace.cpp:753-755`
//     带 content/encoding/bom，回写时原样送回），二进制或超限就是不可撤
//     （对应 `:185-187` 的 `registerNonUndoableAction`）；
//   · 撤销前先核对磁盘还是不是当时的样子（`:216-224` 的 `revert` 抛
//     `UnexpectedUndoException`）—— 本仓做成 `stillMatches`，父目录清单里名字对不上就报冲突。
//
// 上限：一次删除最多带 200 个文件 / 2 MiB 文本进快照（`MAX_DELETE_SNAPSHOT_FILES` /
// `MAX_DELETE_SNAPSHOT_BYTES`），超了如实标不可撤，不假装能恢复半个目录。
//
// 磁盘读写全部走注入的 `FileIo`：桌面端传 `hostFileIo`（真宿主），判据测试传内存实现，
// 于是「删掉再撤销」这条链能被真的跑一遍（见 `tests/pv-file-undo.test.mjs`）。
import { request, type Entry } from './bridge.ts'
import type { CommandInput, CommandProcessor, CommandStep } from './pvCommandProcessor.ts'

/** 一个文件的恢复快照（`file.read` 的那几个键，回写时逐个送回）。 */
export interface FileSnapshot {
  path: string
  content: string
  encoding: string
  bom: boolean
}

export interface CaptureResult {
  files: FileSnapshot[]
  /** false = 上游的「这个文件不受本地历史控制」，只能登记成不可撤。 */
  undoable: boolean
  reason: string
}

/** 本模块需要的宿主能力，逐个对应 `src/bridge.ts` 的 `Method`。 */
export interface FileIo {
  list(path: string): Promise<readonly { name: string; kind: 'directory' | 'file' }[]>
  read(path: string): Promise<{ content: string; version: string; encoding?: string; bom?: boolean }>
  create(path: string, directory?: boolean): Promise<unknown>
  write(path: string, content: string, expectedVersion: string, encoding: string, bom: boolean): Promise<unknown>
  remove(path: string): Promise<unknown>
  copy(from: string, to: string): Promise<unknown>
  rename(from: string, to: string): Promise<unknown>
}

/** 桌面端的默认实现：全部经宿主桥。 */
export const hostFileIo: FileIo = {
  list: async path => (await request<Entry[]>('workspace.list', { path })) ?? [],
  read: path => request<{ content: string; version: string; encoding?: string; bom?: boolean }>('file.read', { path }),
  create: (path, directory = false) => request('file.create', { path, directory }),
  write: (path, content, expectedVersion, encoding, bom) => request('file.write', { path, content, expectedVersion, encoding, bom }),
  remove: path => request('file.delete', { path }),
  copy: (from, to) => request('file.copy', { from, to }),
  rename: (from, to) => request('file.rename', { from, to }),
}

export const MAX_DELETE_SNAPSHOT_FILES = 200
export const MAX_DELETE_SNAPSHOT_BYTES = 2 * 1024 * 1024

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') ) : '')
const baseName = (path: string) => (path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path)
const byteLength = (text: string) => new TextEncoder().encode(text).length

export interface FileUndoProvider {
  existsOnDisk(path: string): Promise<boolean>
  captureForDelete(path: string, isDirectory: boolean, limits?: { files?: number; bytes?: number }): Promise<CaptureResult>
  deleteStep(path: string, snapshot: readonly FileSnapshot[], isDirectory: boolean): CommandStep
  createStep(path: string, isDirectory: boolean): CommandStep
  copyStep(from: string, to: string): CommandStep
  moveStep(from: string, to: string): CommandStep
}

export function createFileUndoProvider(io: FileIo): FileUndoProvider {
  async function listing(path: string) {
    try { return await io.list(path) } catch { return [] }
  }
  async function existsOnDisk(path: string): Promise<boolean> {
    if (!path) return false
    const entries = await listing(parentOf(path))
    return entries.some(entry => entry.name === baseName(path))
  }
  async function makeFile(snapshot: FileSnapshot, directory: boolean): Promise<void> {
    if (directory) { await io.create(snapshot.path, true); return }
    await io.create(snapshot.path)
    // 新建的空白文件也要走正常写盘链路（版本、编码、BOM 都按删除前那份）。
    const created = await io.read(snapshot.path)
    await io.write(snapshot.path, snapshot.content, created.version, snapshot.encoding, snapshot.bom)
  }
  return {
    existsOnDisk,
    /**
     * 删除前抓快照：文件 = 一次 `file.read`；目录 = 递归列（带层数与总量上限）。
     * 读不动（二进制、超限、权限）不抛错，而是回 `undoable: false` + 原因，
     * 由调用方按上游那样登记成不可撤动作。
     */
    async captureForDelete(path, isDirectory, limits = {}) {
      const maxFiles = limits.files ?? MAX_DELETE_SNAPSHOT_FILES
      const maxBytes = limits.bytes ?? MAX_DELETE_SNAPSHOT_BYTES
      if (!isDirectory) {
        try {
          const read = await io.read(path)
          if (byteLength(read.content) > maxBytes) return { files: [], undoable: false, reason: '文件超出可恢复的文本上限。' }
          return { files: [{ path, content: read.content, encoding: read.encoding ?? 'utf-8', bom: read.bom === true }], undoable: true, reason: '' }
        } catch (error) {
          return { files: [], undoable: false, reason: error instanceof Error ? error.message : '读不出内容，删除后无法恢复。' }
        }
      }
      const files: FileSnapshot[] = []
      let total = 0
      const walk = async (relative: string, depth: number): Promise<boolean> => {
        if (depth > 8) return false
        for (const entry of await listing(relative)) {
          const child = relative ? `${relative}/${entry.name}` : entry.name
          if (entry.kind === 'directory') { if (!await walk(child, depth + 1)) return false; continue }
          if (files.length >= maxFiles) return false
          try {
            const read = await io.read(child)
            total += byteLength(read.content)
            if (total > maxBytes) return false
            files.push({ path: child, content: read.content, encoding: read.encoding ?? 'utf-8', bom: read.bom === true })
          } catch { return false }
        }
        return true
      }
      if (!await walk(path, 0)) return { files: [], undoable: false, reason: '目录过大或有读不出的文件，删除后无法整体恢复。' }
      return { files, undoable: true, reason: '' }
    },
    /** 删除一步：`undo` 按快照重建，`redo` 再删一次（上游 `MyUndoableAction.undo/redo` 的对称形状）。 */
    deleteStep(path, snapshot, isDirectory) {
      const targets = snapshot.map(item => item.path)
      return {
        paths: targets.length ? targets : [path],
        checkPaths: [path],
        // 撤：那份东西得已经不在了（被别人重建过就不能再建一遍）；做：它得还在原处。
        stillMatches: async kind => (kind === 'undo' ? !await existsOnDisk(path) : await existsOnDisk(path)),
        undo: async () => {
          if (isDirectory && !snapshot.some(item => item.path === path)) await makeFile({ path, content: '', encoding: 'utf-8', bom: false }, true)
          for (const item of snapshot) await makeFile(item, false)
        },
        redo: async () => { await io.remove(path) },
      }
    },
    /** 新建一步：撤销就是删掉它。 */
    createStep(path, isDirectory) {
      return {
        paths: [path],
        stillMatches: async kind => (kind === 'undo' ? await existsOnDisk(path) : !await existsOnDisk(path)),
        undo: async () => { await io.remove(path) },
        redo: async () => { await makeFile({ path, content: '', encoding: 'utf-8', bom: false }, isDirectory) },
      }
    },
    /** 复制/粘贴副本一步：撤销删副本，重做再复制。 */
    copyStep(from, to) {
      return {
        paths: [to],
        checkPaths: [from],
        // 撤：副本与原件都还在；做：副本已经被撤掉了、原件还在。
        stillMatches: async kind => (kind === 'undo'
          ? await existsOnDisk(to) && await existsOnDisk(from)
          : !await existsOnDisk(to) && await existsOnDisk(from)),
        undo: async () => { await io.remove(to) },
        redo: async () => { await io.copy(from, to) },
      }
    },
    /** 移动/剪切粘贴/重命名一步：撤销是反着 rename 回去（上游 move 的 revert 同义）。 */
    moveStep(from, to) {
      return {
        paths: [to, from],
        stillMatches: async kind => (kind === 'undo'
          ? await existsOnDisk(to) && !await existsOnDisk(from)
          : !await existsOnDisk(to) && await existsOnDisk(from)),
        undo: async () => { await io.rename(to, from) },
        redo: async () => { await io.rename(from, to) },
      }
    },
  }
}

/**
 * 登记一条文件命令（`CommandProcessor.executeCommand` + `FileUndoProvider` 的组合）：
 * 命令名就是菜单里「撤消{0}」的那个 0。
 */
export function recordFileCommand(
  processor: CommandProcessor, input: { name: string; groupId?: string; steps: CommandStep[] },
): void {
  const command: CommandInput = { name: input.name, groupId: input.groupId ?? input.name, steps: input.steps }
  processor.record(command)
  processor.flush()
}

/**
 * 撤销/重做菜单行（`$Undo` / `$Redo`，`PlatformActions.xml:447-448`，
 * 键位 `Ctrl+Z` / `Ctrl+Shift+Z`，`$default.xml:232-235` / `:685-688`）。
 * 归属菜单（编辑菜单）不在本 lane，所以这里只出行模型，由持有 `editMenu.ts` 的一侧装配。
 */
export function commandMenuRows(processor: CommandProcessor, scope: () => readonly string[]) {
  return [
    {
      id: '$Undo', title: () => processor.menuText('undo', scope()), keys: 'Ctrl+Z',
      enabled: () => processor.canUndo(scope()), run: () => processor.undo(scope()),
    },
    {
      id: '$Redo', title: () => processor.menuText('redo', scope()), keys: 'Ctrl+Shift+Z',
      enabled: () => processor.canRedo(scope()), run: () => processor.redo(scope()),
    },
  ]
}

/** 被拒绝时的可见文案（上游是 `CannotUndoReportDialog`，本仓交给画它的一方）。 */
export function reportText(report: { title: string; problem: string; files: readonly string[] }): string {
  return `${report.title}\n${report.problem}${report.files.length ? `\n${report.files.join('\n')}` : ''}`
}
