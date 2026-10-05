// 实例**进程树**（`run.instances` 的 `tree` 字段）→ 控制台渲染用的行。
//
// 上游对照：IDEA 的 Stop 结束的是整棵进程树（`OSProcessHandler.destroyProcess()` →
// Windows `ProcessTreeKiller`），本仓 Runner 用 Job Object 做同一件事
// （native/runner.cpp 的 `TerminateJobObject`）。宿主把每个实例根进程的后代清单
// （`{pid, parent, name}`，见 native/run_host.cpp）回传；这里只做纯逻辑：
// 解析校验 + 前序拍平成带 `depth` 的行，供 `RunConsole.vue` 缩进渲染。
//
// 为什么拍平而不是在组件里递归：树的顺序（先父后子、兄弟按 pid）与“认领不了的行丢掉”
// 都是可测规则，放纯函数里，判据见 tests/process-tree.test.mjs。
export interface RunProcessEntry {
  pid: number
  parent: number
  name: string
}

export interface RunProcessRow {
  pid: number
  parent: number
  name: string
  /** 相对实例根进程的层数：直接子进程是 1，再往下 +1。 */
  depth: number
}

/** 校验宿主回传的树项；形状不对的行丢掉（宿主版本不同也不该让控制台报错）。 */
export function parseProcessTree(value: unknown): RunProcessEntry[] {
  if (!Array.isArray(value)) return []
  const out: RunProcessEntry[] = []
  const seen = new Set<number>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as { pid?: unknown; parent?: unknown; name?: unknown }
    if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0 || seen.has(row.pid)) continue
    seen.add(row.pid)
    out.push({
      pid: row.pid,
      parent: typeof row.parent === 'number' && Number.isInteger(row.parent) ? row.parent : 0,
      name: typeof row.name === 'string' ? row.name : '',
    })
  }
  return out
}

/**
 * 前序拍平：从实例根进程出发，先父后子，兄弟按 pid 升序；`depth` 从 1 起。
 * 与根断开的行（父进程已退出且被系统重挂到别的祖先、或快照不完整）不渲染 ——
 * 把它们挂到根下会伪造出一棵错误的树。名字为空时退化成 PID（不显示空白行）。
 */
export function flattenProcessTree(rootPid: number, entries: readonly RunProcessEntry[]): RunProcessRow[] {
  if (!rootPid || !entries.length) return []
  const children = new Map<number, RunProcessEntry[]>()
  for (const entry of entries) {
    if (entry.pid === rootPid) continue
    const list = children.get(entry.parent)
    if (list) list.push(entry)
    else children.set(entry.parent, [entry])
  }
  for (const list of children.values()) list.sort((left, right) => left.pid - right.pid)
  const rows: RunProcessRow[] = []
  const visited = new Set<number>([rootPid])
  const walk = (parent: number, depth: number) => {
    for (const entry of children.get(parent) ?? []) {
      if (visited.has(entry.pid)) continue
      visited.add(entry.pid)
      rows.push({ pid: entry.pid, parent: entry.parent, name: entry.name || `PID ${entry.pid}`, depth })
      walk(entry.pid, depth + 1)
    }
  }
  walk(rootPid, 1)
  return rows
}
