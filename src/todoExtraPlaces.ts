// **TODO 的「额外位置」**（上游 `com.intellij.todoExtraPlaces`）—— 决定一份文件要不要建 TODO 索引。
//
// 上游 `TodoIndexers.needsTodoIndex(IndexedFile)`（`platform/indexing-impl/src/com/intellij/psi/impl/cache/
// impl/todo/TodoIndexers.java:31-56`）的判定是三段：
//   · 非本地文件系统 ⇒ false（`:37-39`）；
//   · 在内容根里（`ProjectFileIndex.isInContent`）⇒ true（`:48-50`）；
//   · 否则逐条问 `EP_NAME`（`com.intellij.todoExtraPlaces`，`:23` 声明、`:52-54` 收集）——
//     **任一** checker `accept(project, file)` 为真即真。
// `belongsToProject`（`:58-66`）是同一张表加一次 isInContent 兜底。
//
// 出厂的实现只有一支：`ScratchTodoExtraPlaces`
// （`platform/lang-impl/resources/intellij.platform.lang.impl.xml:918` 登记，
// `platform/lang-impl/src/com/intellij/ide/scratch/ScratchTodoExtraPlaces.java:13-16`
// `accept = ScratchUtil.isScratch(file)`）—— 即**临时文件（scratch）也是 TODO 的位置**，
// 即使它不在任何内容根里。
//
// 本仓此前：`todoExtraPlaceAccepts` 这条消费函数写好了但**没有任何调用点**（EP 是死的），
// 也没有 bundled checker。本模块补两头：
//   ① 把上游那支 scratch checker 按同名类名登记进来（`ScratchTodoExtraPlaces`）；
//   ② 给出 `needsTodoIndex(path, root)` 这条**入口判据**，供 `src/components/TodoPanel.vue`
//      在扫描结果上过滤（不在内容根、又没被任何 checker 认领的路径不进 TODO 视图）。
//
// 与上游的如实差异：本仓没有 `ProjectFileIndex`，`isInContent` 收成「工作区相对路径」（不以上级
// `../` 开头、不是绝对路径）；`accept` 的输入是 `{ path, root }` 字符串而非 `VirtualFile`。
//
// 判据：`tests/todo-extra-places.test.mjs`。

import { todoExtraPlaceAccepts, registerTodoExtraPlaceChecker } from './ideViewExtensionPoints.ts'

/** 上游 bundled checker 的类名（`ScratchTodoExtraPlaces`，`lang.impl.xml:918`）。 */
export const SCRATCH_EXTRA_PLACE_ID = 'ScratchTodoExtraPlaces'

/** 本仓两个 scratch 根（`src/workspaceLifecycle.ts` 的 `scratch` 合成根与上游 `ScratchUtil` 的两档）。 */
const SCRATCH_PREFIXES = ['scratch/', 'scratches/']

/** 归一化到 `/` 分隔、去掉前导 `./`（`..` 不折叠 —— 那是"跑出内容根"的信号，不该被吃掉）。 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

/**
 * `ScratchUtil.isScratch(file)` 的等价物：路径落在某个 scratch 根下。
 * 上游认的是 scratch 根（`ScratchFileService` 那两个 roots）；本仓 scratch 目录是工作区下的
 * `scratch/`（`src/workspaceLifecycle.ts` 取 `workspace.list { path: 'scratch' }`）。
 * 相对写法（`scratch/…`）与绝对写法（`…/scratch/…`）都要认，所以按 `/scratch/` 段匹配。
 */
export function isScratchPath(path: string): boolean {
  const normalized = normalizePath(path).replace(/\/+$/, '')
  return SCRATCH_PREFIXES.some(prefix => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))
    || normalized.includes('/scratch/') || normalized.includes('/scratches/')
}

/** 上游那支 bundled checker（`ScratchTodoExtraPlaces.accept`）。 */
export function scratchTodoExtraPlaces(): { id: string; accept: (input: { path: string; root: string }) => boolean } {
  return { id: SCRATCH_EXTRA_PLACE_ID, accept: input => isScratchPath(input.path) }
}

let registered = false

/** 登记 bundled 的 scratch checker（幂等）。与 `src/extensionPoints.ts` 末尾同一纪律。 */
export function registerBundledTodoExtraPlaces(): void {
  if (registered) return
  registered = true
  registerTodoExtraPlaceChecker(scratchTodoExtraPlaces(), { source: 'bundled' })
}

// 模块加载即登记（EP 的 bundled 贡献者必须真在表里，消费端才拿得到）。
registerBundledTodoExtraPlaces()

/** 路径在不在工作区内容里（上游 `ProjectFileIndex.isInContent`）：相对路径且没往上跑出根。 */
export function isInWorkspaceContent(path: string, root: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized) return false
  // 绝对路径（Windows 盘符 / UNC / POSIX）：只有真的落在工作区根下才算内容。
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')) {
    if (!root) return false
    const normalizedRoot = normalizePath(root).replace(/\/+$/, '')
    return normalizedRoot !== '' && (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`))
  }
  // 相对路径往上跑出根（`../x`）不在内容里 —— 这正是"额外位置"要裁决的那一类。
  if (normalized === '..' || normalized.startsWith('../')) return false
  return true
}

/**
 * 上游 `TodoIndexers.needsTodoIndex` 的入口判据：在内容根里 ⇒ true；否则逐条问
 * `com.intellij.todoExtraPlaces`（任一 accept 即 true）。`src/components/TodoPanel.vue`
 * 用它过滤扫描结果 —— 这正是不做就"EP 是死的"的那一步。
 */
export function needsTodoIndex(path: string, root: string): boolean {
  if (isInWorkspaceContent(path, root)) return true
  return todoExtraPlaceAccepts(path, root)
}

/** 诊断：一次过滤里被「不在内容根且没被认领」挡掉了几条（面板状态行用得上）。 */
export function droppedByTodoExtraPlaces(paths: readonly string[], root: string): number {
  let dropped = 0
  for (const path of paths) if (!needsTodoIndex(path, root)) ++dropped
  return dropped
}
