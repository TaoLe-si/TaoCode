// 项目视图的**文件嵌套**（`pv/project-view-nodes` 族）—— 上游 `File Nesting` 那一套
// （`NestingTreeStructureProvider` / `FileNestingBuilder` / `ProjectViewFileNestingService`，
// "File Nesting" 设置页与 `ProjectViewFileNestingService.getRules()`）。
//
// 上游语义（JetBrains 帮助 "File nesting" 与 `FileNestingBuilder` 一致）：
//   · 规则 = 父模式 → 子模式列表；命中的子文件收进父文件下，父行带展开箭头；
//   · **只在同一目录内**、且**同名**才嵌套（帮助页原话："Nesting rules apply only to the
//     files with the same names within the same directory"；例子是 `file.ts` 下面放
//     `file.js` 与 `file.js.map`）；
//   · **只嵌一层**（"Multilevel nesting is not supported"）：已经嵌到父行下的文件不再当别人的父。
//
// 本仓的默认表：上游出厂表只存在于 IDE 的 File Nesting 对话框里，帮助页不列；这里保留
// 帮助页给出的那个例子（`*.ts ← *.js / *.js.map`）与几条同形状的常见关系。规则表是纯数据，
// 以后接项目设置时整表替换即可。
//
// 纯逻辑、无 DOM：模型（`src/projectTreeModel.ts`）只拿 `nestSiblings` 的结果决定哪些行
// 可见、哪些是父行的子行；树结构与选择语义不动。
export interface NestingRule {
  /** 父文件模式（`*` 捕获一段，必须与子模式的同名捕获相等）。 */
  parent: string
  /** 可以收到父文件下的子模式。规则表是纯数据，只读消费（本仓不原地改它）。 */
  readonly children: readonly string[]
}

export interface NestableEntry {
  name: string
  path: string
  /** 只有文件参与嵌套；目录恒不参与（上游也只对 PsiFile 生效）。 */
  kind?: string
}

export interface NestedSiblings<T extends NestableEntry> {
  /** 顶层可见项（顺序保持原列表顺序）。 */
  visible: T[]
  /** 父路径 → 收进它下面的子项（同样是原顺序）。 */
  nested: Map<string, T[]>
}

/**
 * 默认规则表（帮助页例子 + 同形状的常见关系；不是上游出厂表的逐条拷贝）。
 * `tsconfig.*.json` 这类"父无捕获、子有捕获"的规则表示任意前缀都收。
 */
export const DEFAULT_NESTING_RULES: readonly NestingRule[] = [
  { parent: '*.ts', children: ['*.js', '*.js.map'] },
  { parent: '*.tsx', children: ['*.js', '*.js.map'] },
  { parent: '*.js', children: ['*.js.map', '*.d.ts'] },
  { parent: 'package.json', children: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'] },
  { parent: 'tsconfig.json', children: ['tsconfig.*.json'] },
  { parent: 'docker-compose.yml', children: ['docker-compose.*.yml'] },
]

/**
 * 段内 glob（只用 `*`）：`*` 捕获任意一段（非空）。命中返回捕获列表，未命中 null。
 * 其余字符按字面处理（含 `.`），与上游"通配符不受欢迎、规则基本是文件名"的口径一致。
 */
export function matchNamePattern(pattern: string, name: string): string[] | null {
  const parts = pattern.split('*')
  if (parts.length === 1) return pattern === name ? [] : null
  const captures: string[] = []
  let cursor = 0
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    if (index === 0) {
      if (!name.startsWith(part)) return null
      cursor = part.length
      continue
    }
    if (index === parts.length - 1) {
      if (part === '') { captures.push(name.slice(cursor)); cursor = name.length; continue }
      const at = name.indexOf(part, cursor)
      if (at < 0) return null
      captures.push(name.slice(cursor, at))
      cursor = at + part.length
      continue
    }
    const at = name.indexOf(part, cursor)
    if (at < 0) return null
    captures.push(name.slice(cursor, at))
    cursor = at + part.length
  }
  if (cursor !== name.length) return null
  if (captures.some(capture => capture === '')) return null
  return captures
}

/** 找出一个子文件应该嵌到哪个父文件下（没有就 null）；同基名优先、具体（长）名优先。 */
export function nestingParentOf<T extends NestableEntry>(child: T, siblings: readonly T[], rules: readonly NestingRule[]): T | null {
  let best: T | null = null
  let bestLength = -1
  for (const rule of rules) {
    for (const childPattern of rule.children) {
      const childCaptures = matchNamePattern(childPattern, child.name)
      if (!childCaptures) continue
      for (const candidate of siblings) {
        if (candidate === child || candidate.path === child.path || candidate.kind === 'directory') continue
        const parentCaptures = matchNamePattern(rule.parent, candidate.name)
        if (!parentCaptures) continue
        // 同名约束：两边都带捕获时首个捕获必须相等（`a.b.ts` 不认领 `c.b.js`）。
        if (parentCaptures.length && childCaptures.length && parentCaptures[0] !== childCaptures[0]) continue
        if (candidate.name.length > bestLength) { best = candidate; bestLength = candidate.name.length }
      }
    }
  }
  return best
}

/**
 * 把同一目录的列表拆成「顶层可见 + 父行下的子项」。只嵌一层（上游 "Multilevel nesting is
 * not supported"）：某个子项自己又当了别人的父时，这条边不成立 —— 迭代到不再变化为止。
 */
export function nestSiblings<T extends NestableEntry>(entries: readonly T[], rules: readonly NestingRule[] = DEFAULT_NESTING_RULES): NestedSiblings<T> {
  const files = entries.filter(entry => entry.kind !== 'directory')
  const parents = new Map<string, T>()          // 子路径 → 父对象
  for (const child of files) {
    const parent = nestingParentOf(child, files, rules)
    if (parent) parents.set(child.path, parent)
  }
  // 单层约束：父本身也被嵌走时，这条边去掉（并可能连锁）。
  for (let changed = true; changed;) {
    changed = false
    for (const [childPath, parent] of [...parents.entries()]) {
      if (parents.has(parent.path) && parents.get(parent.path)?.path !== childPath) { parents.delete(childPath); changed = true }
    }
  }
  const nested = new Map<string, T[]>()
  const hidden = new Set<string>()
  for (const entry of entries) {
    const parent = parents.get(entry.path)
    if (!parent) continue
    hidden.add(entry.path)
    const list = nested.get(parent.path)
    if (list) list.push(entry)
    else nested.set(parent.path, [entry])
  }
  return { visible: entries.filter(entry => !hidden.has(entry.path)), nested }
}

/** 一个父行当前收着几个子项（模型/组件判断"这行有没有展开箭头"）。 */
export function nestedChildrenOf<T extends NestableEntry>(parentPath: string, siblings: readonly T[], rules: readonly NestingRule[] = DEFAULT_NESTING_RULES): T[] {
  return nestSiblings(siblings, rules).nested.get(parentPath) ?? []
}
