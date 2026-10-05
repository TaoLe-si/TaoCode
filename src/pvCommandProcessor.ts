// 应用级命令栈与撤销/重做（`pv/command` 族：`UndoManagerImpl` / `CommandProcessor` /
// `CommandMerger` / `UndoableGroup` 在本仓的等价物）。
//
// 上游那一套是「命令（groupId/name/global）→ 命令组（UndoableGroup）→ 栈（UndoRedoStacksHolder）」，
// 每一层挂在 Swing 文档引用（`DocumentReference`）上。本仓没有跨文件的文档模型 —— 编辑器的文本撤销
// 归 CodeMirror 自己（每个实例一份历史），**跨文件/跨标签的那一层栈本仓一直缺**，文件级操作
// （新建/删除/重命名/移动/复制）落盘就不可撤。这个模块补的就是那一层，逐条对齐上游：
//
//   · 合并规则：相邻两条命令 `groupId` 相同才并进同一组（`CommandMerger.canMergeGroup` `:31-33`），
//     否则按 `shouldFlush`（`:71-102`）给出的原因先把当前组封口。本仓实现三种原因，都是上游那几个字符串：
//     `INCOMPATIBLE_COMMAND`（`:77`，本仓按「命令名不同」判）、`GLOBAL`（`:97-99`，两组里任意为全局
//     且不允许并全局）、`CHANGED_GROUP`（`:100-101`，groupId 变了）。
//   · 可用性判定：`CommandMerger.isUndoAvailable(refs)` `:56-69` —— 「有不可撤的动作就整体不可撤」；
//     范围为空时只有**全局组**算可用；否则要求组里某个动作碰到范围内的文件。
//   · 执行次序：撤销把组内动作**倒序**跑，重做原序（`UndoableGroup.doUndoOrRedo` `:264`
//     `isUndo ? ContainerUtil.reverse(actions) : actions`）。
//   · 名字：菜单文本来自 `UndoManagerImpl.getUndoOrRedoActionNameAndDescription` `:354-372`
//     （短名截到 30 个字符，`:362`），空名回落 `action.undo.description.empty`，
//     最终按 `undo.command` = 「撤消{0}」拼（`Undo.java:40-44`）。中文文案取自
//     `plugins/localization-zh/lib/localization-zh.jar` 的 `messages/ActionsBundle.properties:2522-2524`
//     与 `messages/IdeBundle.properties:2731-2734`。
//   · 栈深：全局 10 组、单文件 100 组（`platform/util/resources/misc/registry.properties:20` 与 `:22`，
//     `UndoManagerImpl.getGlobalUndoLimit()` `:54-56` / `getDocumentUndoLimit()` `:58-60`）。
//   · 不可撤的登记：`UndoManagerImpl.nonundoableActionPerformed` `:128-134` 往当前组里塞一个
//     `NonUndoableAction`；之后撤销碰到它就整条拒绝（`CommandMerger.isUndoAvailable` `:57-59`）。
//   · 拒绝时给的不是 toast 而是一个**报告**：标题 `cannot.undo.title`，正文
//     `cannot.undo.error.contains.nonundoable.changes.message` /
//     `cannot.undo.error.other.affected.files_changed`（`IdeBundle.properties` 中文 :484-488），
//     底下列受影响的文件 —— 上游是 `CannotUndoReportDialog`（`UndoableGroup` 抛
//     `UnexpectedUndoException` 后由 `DefaultUndoReportHandler` 弹）。本仓把这份报告作为数据交回调用方，
//     由它决定画在哪（文件树的提示条），不假造一个弹层。
//   · 失效：外部改动使组不再可信时按文件把它标成 invalid（`UndoableGroup.invalidateActionsFor` `:195-199`，
//     由 `FileUndoProvider.invalidateActionsFor` `:189-193` 触发）。
//
// 与上游的**不等价处**（如实写明）：
//   · 上游的「当前编辑器」决定撤销范围（`UndoManagerImpl.undo(editor)` `:104-115`）；本仓没有 FileEditor
//     对象，范围由调用方传一组相对路径（`scope`）—— 空数组 = 全局，等价于上游的「refs 为空只看全局组」。
//   · 文本撤销不在这里：本仓的文档撤销仍由 CodeMirror 承担，两个栈不互通，这与上游
//     `DocumentUndoProvider` 与本模块并行的形状一致（各撤各的层）。
import { reactive, readonly } from 'vue'

/** 栈深上限（`registry.properties:20` / `:22`，两个数字分别是全局与单文档）。 */
export const GLOBAL_UNDO_LIMIT = 10
export const DOCUMENT_UNDO_LIMIT = 100

/** 菜单短名的截断长度（`UndoManagerImpl:362` 的 `StringUtil.first(desc, 30, true)`）。 */
export const COMMAND_NAME_MAX = 30

/** 封口原因（`CommandMerger.createFlushReason` 的 `:77`/`:98`/`:101` 三个字符串）。 */
export type FlushReason = 'INCOMPATIBLE_COMMAND' | 'GLOBAL' | 'CHANGED_GROUP' | 'NEW_COMMAND' | 'NOTHING_TO_FLUSH'

/** 中文文案（zh 语言包，键与英文包一一对应，见模块头）。 */
export const UNDO_TEXTS = Object.freeze({
  /** `ActionsBundle.properties:2524` `action.undo.text=撤消{0}(_U)`（菜单里的下划线助记符不进纯文本）。 */
  undoTemplate: '撤消{0}',
  /** `:2518` `action.redo.text=重做{0}(_R)`。 */
  redoTemplate: '重做{0}(_R)'.replace('(_R)', ''),
  /** `:2523` `action.undo.description.empty=最后操作`。 */
  undoEmptyName: '最后操作',
  /** `:2517` `action.redo.description.empty=最后的撤消操作`。 */
  redoEmptyName: '最后的撤消操作',
  /** `IdeBundle.properties:2732` `undo.command.local.name=本地`（命令名为 null 时的上游回落）。 */
  localName: '本地',
  /** `:488` `cannot.undo.title=无法撤消`。 */
  cannotUndoTitle: '无法撤消',
  /** `:483` `cannot.redo.title=无法重做`。 */
  cannotRedoTitle: '无法重做',
  /** `:484` `cannot.undo.error.contains.nonundoable.changes.message`（去掉 html 标签）。 */
  nonUndoableProblem: '无法执行 {0}\n以下文件包含无法撤消的更改：',
  /** `:485` `cannot.undo.error.other.affected.files.changed.message`。 */
  changedProblem: '受此操作影响的以下文件已更改：',
  /** `:2733` `undo.conflicting.change.confirmation`。 */
  conflictingConfirmation: '受此操作影响的其他文件已更改。',
})

const redoTemplate = '重做{0}'

/** 组里的一个动作（上游 `UndoableAction` 的最小可用面：影响的文件 + undo/redo）。 */
export interface CommandStep {
  /** 受影响的相对路径（`DocumentReference` 的等价物）。空数组 = 全局动作（`GlobalUndoableAction`）。 */
  readonly paths: readonly string[]
  undo: () => Promise<void> | void
  redo: () => Promise<void> | void
  /** false = 上游的 `NonUndoableAction`（这一组从此不可撤）。 */
  readonly undoable?: boolean
  /**
   * 撤销/重做前的**冲突自检**（上游 `FileUndoProvider.MyUndoableAction.undo` 抛
   * `UnexpectedUndoException` 的那一步：磁盘已经不是当时的样子就不能撤）。
   * 形参是方向 —— 撤与做的「当时的样子」正好相反。返回 false 表示冲突。
   */
  readonly stillMatches?: (kind: 'undo' | 'redo') => Promise<boolean> | boolean
  /** 自检涉及的额外文件（除了 `paths`）：冲突报告里列的就是它们。 */
  readonly checkPaths?: readonly string[]
}

/** 一条命令（上游 `CommandProcessor.executeCommand` 的一次调用）。 */
export interface CommandInput {
  /** 命令名；null/空 = 上游的「本地」组（`undo.command.local.name`）。 */
  name?: string | null
  /** 合并键（`CommandMerger.canMergeGroup`）：同键的相邻命令并成一组。 */
  groupId?: string | null
  /** 强制全局（`markCurrentCommandAsGlobal`）；碰多个文件时本仓自动视为全局。 */
  global?: boolean
  steps: readonly CommandStep[]
}

/** 封好口的一组 = 一次撤销/重做的单位。 */
export interface CommandGroup {
  name: string | null
  global: boolean
  /** 组里只要有不可撤的动作就整体不可撤（`CommandMerger.hasNonUndoableActions` `:380-387`）。 */
  undoable: boolean
  /** 组碰到过的全部路径（`UndoableGroup.getAffectedDocuments` `:201-210`）。 */
  paths: readonly string[]
  steps: readonly CommandStep[]
  /** 是否仍然可信（外部改动会让它失效，`:195-199`）。 */
  valid: boolean
  at: number
}

export interface UndoReport {
  title: string
  problem: string
  files: readonly string[]
}

export interface UndoResult {
  ok: boolean
  /** 撤掉的那组的命令名（提示语用；没有名字时是「本地」）。 */
  name?: string
  report?: UndoReport
}

function sameGroup(current: string | null | undefined, next: string | null | undefined): boolean {
  // `CommandMerger.canMergeGroup` `:31-33`：两边都必须非空且相等。null ≠ null 也算不同组
  // （上游 `Comparing.equal(null, null)` 是 true，但 `groupId != null` 那道闸门先挡住）。
  if (current == null || next == null) return false
  return current === next
}

function isGlobalGroup(steps: readonly CommandStep[], forced: boolean | undefined): boolean {
  if (forced) return true
  const touched = new Set<string>()
  for (const step of steps) for (const path of step.paths) touched.add(path)
  // `CommandMerger.isGlobal()` `:197-199`：`affectsMultiplePhysical()` —— 碰到多个文件就是全局组。
  return touched.size > 1
}

function groupPaths(steps: readonly CommandStep[]): string[] {
  const out: string[] = []
  for (const step of steps) for (const path of step.paths) if (!out.includes(path)) out.push(path)
  return out
}

function affects(steps: readonly CommandStep[], scope: readonly string[]): boolean {
  for (const step of steps) {
    // `refs == null` 的动作对所有范围都算命中（上游 `CommandMerger.hasChangesOf` `:269-277`
    // 的 `ArrayUtil.contains(ref, refs)` 对空 refs 恒真）。
    if (step.paths.length === 0) return true
    for (const path of scope) if (step.paths.includes(path)) return true
  }
  return false
}

/** 菜单文本（`Undo.java:40-44` + `UndoManagerImpl:354-372`）。 */
export function commandMenuText(kind: 'undo' | 'redo', name: string | null): string {
  const template = kind === 'undo' ? UNDO_TEXTS.undoTemplate : redoTemplate
  const short = name ? name.slice(0, COMMAND_NAME_MAX) : ''
  const filled = short.replace(/&/g, '')
  return (template.replace('{0}', filled || (kind === 'undo' ? UNDO_TEXTS.undoEmptyName : UNDO_TEXTS.redoEmptyName))).trim()
}

export interface CommandProcessor {
  /** 记一条命令（可能并进当前组，也可能先封口再开新组）；返回封口原因（没封口是 `NOTHING_TO_FLUSH`）。 */
  record(command: CommandInput): FlushReason
  /** 登记「这些文件有过不可撤的改动」（`nonundoableActionPerformed`）：之后的撤销会拒绝。 */
  markNonUndoable(paths: readonly string[]): void
  /** 外部改动使某文件的命令失效（`invalidateActionsFor`）。 */
  invalidate(path: string): void
  canUndo(scope?: readonly string[]): boolean
  canRedo(scope?: readonly string[]): boolean
  /** 下一笔撤销/重做的名字（画菜单用；不可用时是 null）。 */
  nextName(kind: 'undo' | 'redo', scope?: readonly string[]): string | null
  /** 菜单文本（没有可撤的时给的是「撤消最后操作」那类空名形态）。 */
  menuText(kind: 'undo' | 'redo', scope?: readonly string[]): string
  undo(scope?: readonly string[]): Promise<UndoResult>
  redo(scope?: readonly string[]): Promise<UndoResult>
  /** 组数（测试与「清空历史」用）。 */
  size(): { undo: number; redo: number }
  /** 可见状态（菜单/快捷键绑定用）。 */
  readonly state: CommandViewState
  /** 把当前未封口的组封口（`flushCurrentCommandMerger` `:325-327`）。 */
  flush(): void
  clear(): void
}

interface StackPair { undo: CommandGroup[]; redo: CommandGroup[] }

/** 面板/菜单绑的那份可见状态（`UndoManagerImpl.isUndoAvailable` 的等价物）。 */
export interface CommandViewState {
  canUndo: boolean
  canRedo: boolean
  /** 下一笔撤销的命令名（null = 没有名字，菜单回落「撤消最后操作」）。 */
  undoName: string | null
  redoName: string | null
}

function createCommandProcessor(): CommandProcessor {
  let pending: { name: string | null; groupId: string | null; global: boolean; steps: CommandStep[] } | null = null
  const stacks: StackPair = { undo: [], redo: [] }
  const nonUndoableFiles = new Set<string>()
  /** 被外部改动作废的路径（`invalidateActionsFor` 的落点）：含这些路径的组不再可撤。 */
  const invalidated = new Set<string>()
  const view = reactive<CommandViewState>({ canUndo: false, canRedo: false, undoName: null, redoName: null })

  function snapshot(group: { name: string | null; global: boolean; steps: CommandStep[] }, at: number, valid: boolean): CommandGroup {
    const paths = groupPaths(group.steps)
    return {
      name: group.name, global: group.global,
      undoable: group.steps.every(step => step.undoable !== false) && !touchesNonUndoable(group.steps),
      paths, steps: [...group.steps], valid: valid && !paths.some(path => invalidated.has(path)), at,
    }
  }
  function touchesNonUndoable(steps: readonly CommandStep[]): boolean {
    for (const step of steps) {
      for (const path of step.paths) if (nonUndoableFiles.has(path)) return true
      for (const path of step.checkPaths ?? []) if (nonUndoableFiles.has(path)) return true
    }
    return false
  }
  /** 封口当前组并压进撤销栈（`CommandMerger.formGroup` `:104-108`：空组不产生）。 */
  function closePending(): void {
    if (!pending || pending.steps.length === 0) { pending = null; return }
    stacks.undo.push(snapshot(pending, Date.now(), true))
    while (stacks.undo.length > GLOBAL_UNDO_LIMIT) stacks.undo.shift()
    pending = null
  }
  function flushReasonFor(command: CommandInput): FlushReason | null {
    if (!pending) return null
    if (pending.name !== (command.name ?? null)) return 'INCOMPATIBLE_COMMAND'
    if ((pending.global || command.global) && !sameGroup(pending.groupId, command.groupId)) return 'CHANGED_GROUP'
    if (!sameGroup(pending.groupId, command.groupId)) return 'CHANGED_GROUP'
    return null
  }
  /**
   * 还没封口的当前组（`CommandMerger` 里那份 `undoableActions`）。
   * 上游要等到某个 flush 点才把它压进栈；本仓的调用方是「一次用户操作 = 一条命令」，
   * 等不到下一个 flush 点，所以这里让未封口的组**直接当作栈顶参与判定与执行**
   * （用户可见行为：做完一步立刻能撤）。
   */
  function pendingGroup(): CommandGroup | null {
    if (!pending || pending.steps.length === 0) return null
    return snapshot(pending, Date.now(), true)
  }
  function stackOf(kind: 'undo' | 'redo'): CommandGroup[] {
    return kind === 'undo' ? [...stacks.undo, ...(pendingGroup() ? [pendingGroup()!] : [])] : stacks.redo
  }
  /** 栈顶那一组（不管可不可撤）—— 上游按它决定「按下撤销后弹不弹那份报告」。 */
  function newest(kind: 'undo' | 'redo', scope: readonly string[]): CommandGroup | null {
    const stack = stackOf(kind)
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const group = stack[index]!
      if (!group.valid) return null
      // `CommandMerger.isUndoAvailable` `:56-69`：范围空 ⇒ 只有全局组算；否则要求命中。
      if (scope.length === 0 ? group.global : affects(group.steps, scope)) return group
    }
    return null
  }
  function top(kind: 'undo' | 'redo', scope: readonly string[]): CommandGroup | null {
    const group = newest(kind, scope)
    // 组里有不可撤的动作 ⇒ 整组不可撤（`CommandMerger.isUndoAvailable` `:57-59`）。
    return group && group.undoable ? group : null
  }
  function reportFor(group: CommandGroup, kind: 'undo' | 'redo'): UndoReport {
    const name = group.name ?? UNDO_TEXTS.localName
    const label = kind === 'undo' ? UNDO_TEXTS.undoTemplate.replace('{0}', name) : redoTemplate.replace('{0}', name)
    // 报告底下列的是「哪些文件撤不回去」—— 组里全部路径，含自检涉及的（`CannotUndoReportDialog`
    // 的 problemFilesList 装的就是 DocumentReference 清单）。
    const files = groupFiles(group)
    return {
      title: kind === 'undo' ? UNDO_TEXTS.cannotUndoTitle : UNDO_TEXTS.cannotRedoTitle,
      problem: UNDO_TEXTS.nonUndoableProblem.replace('{0}', label),
      files,
    }
  }
  function changedReport(group: CommandGroup, kind: 'undo' | 'redo', conflicted: readonly string[]): UndoReport {
    return {
      title: kind === 'undo' ? UNDO_TEXTS.cannotUndoTitle : UNDO_TEXTS.cannotRedoTitle,
      problem: `${UNDO_TEXTS.changedProblem}\n${conflicted.join('\n')}`,
      files: conflicted,
    }
  }
  function groupFiles(group: CommandGroup): string[] {
    return [...new Set(group.steps.flatMap(step => [...step.paths, ...(step.checkPaths ?? [])]))].sort()
  }
  function perform(kind: 'undo' | 'redo', scope: readonly string[]): Promise<UndoResult> {
    const group = newest(kind, scope)
    if (!group) return Promise.resolve({ ok: false, report: undefined })
    if (!group.undoable) {
      return Promise.resolve({ ok: false, name: group.name ?? undefined, report: reportFor(group, kind) })
    }
    // 倒序撤、正序做（`UndoableGroup.doUndoOrRedo` `:264`）。
    const ordered = kind === 'undo' ? [...group.steps].reverse() : [...group.steps]
    return (async () => {
      const done: CommandStep[] = []
      try {
        for (const step of ordered) {
          if (step.stillMatches && !await step.stillMatches(kind)) {
            // 已经撤了一半不能装作无事：把做过的补回去，再按上游的「其它文件已更改」报。
            for (const back of done.reverse()) {
              try { if (kind === 'undo') await back.redo(); else await back.undo() } catch { /* 尽力恢复 */ }
            }
            return { ok: false, name: group.name ?? undefined, report: changedReport(group, kind, groupFiles(group)) }
          }
          if (kind === 'undo') await step.undo(); else await step.redo()
          done.push(step)
        }
      } catch (error) {
        return { ok: false, name: group.name ?? undefined, report: { ...reportFor(group, kind), problem: `${reportFor(group, kind).problem}\n${error instanceof Error ? error.message : String(error)}` } }
      }
      const from = kind === 'undo' ? stacks.undo : stacks.redo
      const to = kind === 'undo' ? stacks.redo : stacks.undo
      const at = from.lastIndexOf(group)
      if (at >= 0) from.splice(at, 1)
      else if (pending) pending = null // 撤的是还没封口的那一组
      to.push(group)
      while (to.length > GLOBAL_UNDO_LIMIT) to.shift()
      refreshView()
      return { ok: true, name: group.name ?? UNDO_TEXTS.localName }
    })()
  }
  function refreshView(): void {
    const undoGroup = top('undo', []) ?? stackOf('undo').at(-1) ?? null
    const redoGroup = top('redo', []) ?? stacks.redo.at(-1) ?? null
    view.canUndo = stackOf('undo').some(group => group.valid && group.undoable)
    view.canRedo = stacks.redo.some(group => group.valid && group.undoable)
    view.undoName = undoGroup?.name ?? null
    view.redoName = redoGroup?.name ?? null
  }
  return {
    record(command) {
      const name = command.name ?? null
      const reason = flushReasonFor(command)
      if (reason) closePending()
      // 只有「并进当前组」才保留重做栈；新命令作废重做栈（上游 `UndoRedoStacksHolder` 加动作时清对面那一栈）。
      if (!(reason === null && pending !== null)) stacks.redo.length = 0
      const steps = [...command.steps]
      const merged = pending !== null && reason === null
      if (!pending) pending = { name, groupId: command.groupId ?? null, global: isGlobalGroup(steps, command.global), steps }
      else {
        pending.steps.push(...steps)
        // 一旦并进了别的文件，整组升级为全局组（`CommandMerger.isGlobal` 的同一判据）。
        pending.global = isGlobalGroup(pending.steps, pending.global)
      }
      // 全局栈只留最近 10 组（`registry.properties:20`），未封口的那一组也算在内。
      while (stacks.undo.length + (pending ? 1 : 0) > GLOBAL_UNDO_LIMIT && stacks.undo.length > 0) stacks.undo.shift()
      refreshView()
      if (reason) return reason
      return merged ? 'NOTHING_TO_FLUSH' : 'NEW_COMMAND'
    },
    markNonUndoable(paths) {
      for (const path of paths) nonUndoableFiles.add(path)
      // 已经封口的组里碰到这些文件的，整体标成不可撤（`CommandMerger.invalidateActionsFor` `:124-128`）。
      for (const group of [...stacks.undo, ...stacks.redo]) if (touchesNonUndoable(group.steps)) group.undoable = false
      refreshView()
    },
    invalidate(path) {
      invalidated.add(path)
      for (const group of [...stacks.undo, ...stacks.redo]) if (group.paths.includes(path)) group.valid = false
      refreshView()
    },
    canUndo(scope = []) { return top('undo', scope) !== null },
    canRedo(scope = []) { return top('redo', scope) !== null },
    nextName(kind, scope = []) { return top(kind, scope)?.name ?? null },
    menuText(kind, scope = []) { return commandMenuText(kind, top(kind, scope)?.name ?? null) },
    undo: (scope = []) => perform('undo', scope),
    redo: (scope = []) => perform('redo', scope),
    size: () => ({ undo: stackOf('undo').length, redo: stacks.redo.length }),
    state: readonly(view),
    flush() { closePending(); refreshView() },
    clear() { stacks.undo.length = 0; stacks.redo.length = 0; pending = null; nonUndoableFiles.clear(); invalidated.clear(); refreshView() },
  }
}

/** 按项目根分桶的命令栈注册表（与 `getProjectTreeState` 同一形状：宿主只认这一个入口）。 */
const registry = new Map<string, CommandProcessor>()
export function getCommandProcessor(root: string): CommandProcessor {
  let host = registry.get(root)
  if (!host) { host = createCommandProcessor(); registry.set(root, host) }
  return host
}

/** 测试用：丢掉某个项目的栈，避免用例之间互相污染。 */
export function resetCommandProcessor(root: string): void { registry.delete(root) }
