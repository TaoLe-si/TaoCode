// 低层项目打开链 —— 上游 `platform/ide-core-impl/src/com/intellij/openapi/project/ex/`
// 的 `LowLevelProjectOpenProcessor` 与 `IntelliJProjectUtil`/`ProjectUtil` 的可移植一半。
//
// 上游是什么（逐条核过）：
//   · `LowLevelProjectOpenProcessor.kt:12-26`：`shouldOpenInNewProcess(projectPath)`（这条路径
//     该不该在新进程里开）与 `beforeProjectOpened(projectPath): PrepareProjectResult`
//     —— 后者返回 `CONTINUE`（继续开）或 `CANCEL`（不开），是"打开之前先判一条路径"的闸门。
//   · `ProjectUtil.kt` 的 `guessProjectDir()`（`:108-129`）：项目目录不是硬定义 —— 先看基础目录、
//     再看模块目录、最后才 `findFileByPath(basePath)`；注释自己写明"结果不该被当成真实动作直接用，
//     用户应该能复核并改它"，典型用途是文件选择器的默认选中项。
//
// 本仓的等价交换：打开/新建走 `src/workspaceLifecycle.ts` 的 `openWorkspace` + 宿主
// `workspace.open`（`native/workspace.cpp`），前端**没有**「先判一条路径能不能开」的判定面 ——
// 一条不可打开的路径（文件、不存在的目录、非绝对路径）会被宿主拒绝，用户看到的是一句宿主错误。
// 本模块把上游那个闸门落成纯规则：`projectOpenDecision(path, exists)` 给出
// `continue`/`cancel` 两档 + 给用户看的话，`shouldOpenInNewProcess` 的等价物
// （本仓单窗口 ⇒ 恒 false，如实登记）。
//
// 消费链路：`src/workspaceLifecycle.ts` 的 `openWorkspace` 在发 `workspace.open` 之前问一次
// （`cancel` 就不发请求、把话说给用户），`beginProject` 选父目录时用 `guessProjectDir` 的
// 等价物算默认选中项。
//
// 判据：`tests/project-open-check.test.mjs`。

import { normalizeProjectPath, projectDirectoryName } from './projectDirectories.ts'

/** `LowLevelProjectOpenProcessor.PrepareProjectResult`（`:20-22`）。 */
export type PrepareProjectResult = 'continue' | 'cancel'

/** 一条路径的可打开性输入。`exists` 缺省 `true` —— 前端对工作区之外的路径没有存在性探测通道
 *  （宿主 `workspace.list` 只列工作区之内），这时只跑能跑的那几条（空路径/绝对路径），
 *  存在性与目录性交给宿主 `workspace.open` 自己拒。调用方能探测时就把 `exists`/`isDirectory` 填上。 */
export interface ProjectPathFacts {
  /** 归一后的路径（调用方给原样，本模块自己归一）。 */
  path: string
  /** 路径存在吗（宿主 `workspace.list` 的目录枚举 / `file.read` 能不能读到）。缺省 true。 */
  exists?: boolean
  /** 存在时它是一个目录吗（不存在时为 undefined）。 */
  isDirectory?: boolean
}

export interface ProjectOpenDecision {
  result: PrepareProjectResult
  /** `cancel` 时给用户看的话；`continue` 时为 null。 */
  message: string | null
}

/** 本仓不移植上游的"在新进程里开"（单窗口单进程，没有第二实例通道）—— 恒 false，与上游默认实现一致。 */
export function shouldOpenInNewProcess(): boolean {
  return false
}

/** 路径是不是绝对的（盘符 `C:/`、UNC `//host`、或前导 `/`）。 */
export function isAbsoluteProjectPath(path: string): boolean {
  const normalized = normalizeProjectPath(path)
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')
}

/**
 * `LowLevelProjectOpenProcessor.beforeProjectOpened` 的等价物：打开一条路径之前的判定。
 * 判据顺序（越靠前越先报）：
 *   1. 空路径 → cancel（上游把空 basePath 当"没有项目"）；
 *   2. 非绝对路径 → cancel（上游 `findFileByPath(basePath!!)` 要的是可定位的路径）；
 *   3. 路径不存在 → cancel（上游 `takeIf { it.isValid }` 那一档）；
 *   4. 存在但不是目录 → cancel（项目根必须是一个目录）；
 *   5. 其余 → continue。
 * `cancel` 的文案是本仓界面语言的直白说法（上游这两条没有 bundle 文案，`PrepareProjectResult`
 * 只是个枚举 —— 那句"为什么不能开"由调用方给，见 `ProjectUtil.guessProjectDir` 的注释）。
 */
export function projectOpenDecision(facts: ProjectPathFacts): ProjectOpenDecision {
  const path = normalizeProjectPath(facts.path ?? '')
  if (!path) return { result: 'cancel', message: '没有指定项目目录。' }
  if (!isAbsoluteProjectPath(path)) return { result: 'cancel', message: `请给出项目目录的完整路径：${facts.path}` }
  if (facts.exists === false) return { result: 'cancel', message: `目录不存在：${path}` }
  if (facts.isDirectory === false) return { result: 'cancel', message: `项目根必须是一个目录：${path}` }
  return { result: 'continue', message: null }
}

/**
 * `ProjectUtil.guessProjectDir()`（`:108-129`）的等价物：给一条候选路径（用户输入的父目录、
 * 或工作区根），猜一个"最可能想打开的项目目录"。
 * 上游的启发链是「基础目录 → 模块目录 → basePath」；本仓单根工作区没有模块目录，
 * 所以是「候选路径本身（是目录就用它）→ 候选路径的父目录 → null」。
 * **刻意不做**上游那种"沿目录往上找 `.idea`" —— 本仓打开目录即工作区（族判词已登记）。
 */
export function guessProjectDir(candidate: string, isDirectory: (path: string) => boolean): string | null {
  const path = normalizeProjectPath(candidate ?? '')
  if (!path) return null
  if (isDirectory(path)) return path
  const parent = path.replace(/\/[^/]*$/, '')
  if (parent && parent !== path && isDirectory(parent)) return parent
  return null
}

/** 默认选中项：候选路径猜不出时退回它的父目录名（上游 `guessProjectDir` 的空结果由调用方兜）。 */
export function suggestedProjectName(candidate: string, isDirectory: (path: string) => boolean): string {
  const guessed = guessProjectDir(candidate, isDirectory) ?? normalizeProjectPath(candidate ?? '')
  return projectDirectoryName(guessed) || guessed
}