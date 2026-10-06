// 项目视图的**文件嵌套**（`pv/project-view-nodes` 族）—— 上游 `File Nesting` 那一套
// （`NestingTreeStructureProvider` / `FileNestingBuilder` / `ProjectViewFileNestingService`，
// "File Nesting" 设置页与 `ProjectViewFileNestingService.getRules()`）。
//
// 上游坐标（本轮 ptree3 逐条打开核对）：
//   · 规则本体 = **一对**父子后缀：`platform/lang-impl/src/com/intellij/ide/projectView/impl/ProjectViewFileNestingService.java:110-159`
//     （`NestingRule` 只有 `myParentFileSuffix` / `myChildFileSuffix` 两个字段，`:120-123`；
//     `equals` 比的也是这一对，`:149-153`）；本仓的 `{parent, children[]}` 是同一张表的折叠形态，
//     展开成对的那一半在 `nestingRulePairs`。
//   · 匹配 = **后缀**且**不分大小写**：`FileNestingBuilder.java:91`、`:163-164` 用的都是
//     `StringUtil.endsWithIgnoreCase`；父文件名由 `trimEnd(fileName, childSuffix) + parentSuffix`
//     拼出后交给 `parentDir.findChild()`（`:92-93`），那是按名精确查找 ⇒ **基名那一半分大小写**
//     （`:137`/`:144` 的边表也以 `baseName` 原样为键，同一个结论）。
//   · 传递规则：`FileNestingBuilder.java:43-81` —— 注释原话
//     "for all cases like A -> B -> C we also add a rule A -> C"（`:65`），两条补规则的 for 在
//     `:66-70` 与 `:72-76`；不能用的对（空后缀、父子相等）在这一趟里被丢掉（`:58-59`）。
//     「只嵌一层」就是这么来的：`mapParentToChildren` 里已经当过子的节点不再当父（`:196-198`），
//     而孙因为那条补出来的规则**仍然挂在祖先行下面**，不会掉回顶层 —— 见 `:98-105` 的图论说明与
//     `NestingTreeStructureProvider.java:90`（`NestingTreeNode` 一个父行带一串子行）。
//   · 一个名字同时命中父与子时，**模式长的那一侧赢**：`FileNestingBuilder.java:166-173`。
//   · 只在同一目录内：`NestingTreeStructureProvider.java:50-58` 取的是父目录那一份 children，
//     `FileNestingBuilder.isNestedFile` 也先要 `file.getParent()`（`:86-87`）；本仓由
//     `src/projectTreeModel.ts` 的 `listingFor()` 保证（只有同级列表进来）。
//   · 开关关掉 ⇒ 整条不套：`NestingTreeStructureProvider.java:48`（`isUseFileNestingRules()`），
//     本仓的消费点在 `src/components/FileTree.vue:50`（关掉就喂一张空规则表）。
//
// 本仓的默认表：上游出厂表由 `com.intellij.projectViewNestingRulesProvider` 的各插件贡献
// （`ProjectViewFileNestingService.java:34-35`、`:44-58` 逐个 provider 收集），而**本地基准树里
// 没有任何 provider 实现**（`grep -rln addFileNestingRules` 只命中接口与这个服务两处，实测），
// 所以这里保留 JetBrains 帮助页给出的那个例子（`file.ts` 下面放 `file.js` 与 `file.js.map`）
// 与几条同形状的常见关系，不冒充上游出厂表。规则表是纯数据，设置页整表替换
// （`src/projectTreeNestingDialog.ts`）。
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

/** 一条 (父模式, 子模式) 对，= 上游的一条 `NestingRule`。 */
export interface NestingPair {
  parent: string
  child: string
}

/**
 * 默认规则表（帮助页例子 + 同形状的常见关系；不是上游出厂表的逐条拷贝，理由见模块头）。
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
 * 字面段不分大小写（上游是 `endsWithIgnoreCase`，`FileNestingBuilder.java:91`、`:163-164`），
 * 捕获到的基名从**原名**里切（基名那一半分大小写，见模块头）。
 * 少数 Unicode 字符小写后长度会变（如 `İ`），那样下标会错位 ⇒ 那一趟退回按原样比。
 */
export function matchNamePattern(pattern: string, name: string): string[] | null {
  const foldable = name.toLowerCase().length === name.length
  const haystack = foldable ? name.toLowerCase() : name
  const segments = (foldable ? pattern.toLowerCase() : pattern).split('*')
  if (segments.length === 1) return segments[0] === haystack ? [] : null
  const captures: string[] = []
  let cursor = 0
  for (let index = 0; index < segments.length; index++) {
    const part = segments[index]!
    if (index === 0) {
      if (!haystack.startsWith(part)) return null
      cursor = part.length
      continue
    }
    if (index === segments.length - 1) {
      if (part === '') { captures.push(name.slice(cursor)); cursor = haystack.length; continue }
      const at = haystack.indexOf(part, cursor)
      if (at < 0) return null
      captures.push(name.slice(cursor, at))
      cursor = at + part.length
      continue
    }
    const at = haystack.indexOf(part, cursor)
    if (at < 0) return null
    captures.push(name.slice(cursor, at))
    cursor = at + part.length
  }
  if (cursor !== haystack.length) return null
  if (captures.some(capture => capture === '')) return null
  return captures
}

/**
 * 一个名字在这条 (父模式, 子模式) 规则里能当什么 —— 上游
 * `FileNestingBuilder.checkMatchingAsParentOrChild`（`:158-176`）：两侧都命中时
 * **模式更长的那一侧保留**、另一侧关掉（`:166-173`）。
 * 上游比的是后缀长度，本仓比的是整条模式长度：两边带同样数目的 `*` 时差值相等、判定同序；
 * 「父模式有多个 `*`、子模式没有」这类混合形状可能与上游差一格，本仓规则表里没有这种条目。
 */
export function nestingRoleOf(name: string, parent: string, child: string): { parent: boolean; child: boolean } {
  const matchesParent = matchNamePattern(parent, name) !== null
  const matchesChild = matchNamePattern(child, name) !== null
  if (matchesParent && matchesChild) {
    return parent.length > child.length ? { parent: true, child: false } : { parent: false, child: true }
  }
  return { parent: matchesParent, child: matchesChild }
}

/**
 * 规则表 → (父, 子) 对，含上游那两条传递补规则（`FileNestingBuilder.java:58-77`）。
 * 一趟循环、边走边补（与上游同：上游也**不是**求不动点，两张边表是随循环长大的），所以
 * 补出来的对排在后面；空后缀与父子相等的对不进表（`:58-59`）。
 */
export function nestingRulePairs(rules: readonly NestingRule[]): NestingPair[] {
  const pairs: NestingPair[] = []
  const seen = new Set<string>()
  const parentToChildren = new Map<string, string[]>()
  const childToParents = new Map<string, string[]>()
  const register = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  const add = (parent: string, child: string) => {
    if (!parent || !child || parent === child) return
    const key = `${parent}\u0000${child}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ parent, child })
  }
  for (const rule of rules) {
    for (const child of rule.children ?? []) {
      const parent = rule.parent
      add(parent, child)
      // `:66-70`：我这个父模式已经收过的那些子，归到当前这个子模式下（A←C 的另一半）。
      for (const grandchild of parentToChildren.get(child) ?? []) add(parent, grandchild)
      // `:72-76`：当前这个父模式自己又是别人的子 ⇒ 它的子同时归那个祖先。
      for (const grandparent of childToParents.get(parent) ?? []) add(grandparent, child)
      register(parentToChildren, parent, child)
      register(childToParents, child, parent)
    }
  }
  return pairs
}

/** 配对表折回规则表（一个父一条，子按首次出现次序）—— 设置页与存档用这个形状。 */
export function nestingRulesFromPairs(pairs: readonly NestingPair[]): NestingRule[] {
  const grouped = new Map<string, string[]>()
  for (const { parent, child } of pairs) {
    const list = grouped.get(parent)
    if (list) list.push(child)
    else grouped.set(parent, [child])
  }
  return [...grouped.entries()].map(([parent, children]) => ({ parent, children }))
}

/** 找出一个子文件应该嵌到哪个父文件下（没有就 null）；同基名优先、具体（长）名优先。 */
export function nestingParentOf<T extends NestableEntry>(child: T, siblings: readonly T[], rules: readonly NestingRule[]): T | null {
  return parentCandidates(child, siblings, nestingRulePairs(rules))[0] ?? null
}

/** 一个子文件的全部候选父：按「名字更具体（更长）的优先」，同长按配对次序（`nestingRulePairs` 的次序）。 */
function parentCandidates<T extends NestableEntry>(child: T, siblings: readonly T[], pairs: readonly NestingPair[]): T[] {
  const found: Array<{ entry: T; length: number }> = []
  const taken = new Set<string>()
  for (const { parent, child: childPattern } of pairs) {
    // 子角色：`nestingRoleOf` 已经处理「父子同现时长的赢」（上游 `:166-173`）。
    const childRole = nestingRoleOf(child.name, parent, childPattern)
    if (!childRole.child) continue
    const childCaptures = matchNamePattern(childPattern, child.name)
    if (!childCaptures) continue
    for (const candidate of siblings) {
      if (candidate === child || candidate.path === child.path || candidate.kind === 'directory') continue
      if (taken.has(candidate.path)) continue
      if (!nestingRoleOf(candidate.name, parent, childPattern).parent) continue
      const parentCaptures = matchNamePattern(parent, candidate.name)
      if (!parentCaptures) continue
      // 同名约束：两边都带捕获时首个捕获必须**原样**相等（`a.b.ts` 不认领 `c.b.js`；
      // 上游那一步是 `parentDir.findChild(拼出来的父文件名)`，按名精确）。
      if (parentCaptures.length && childCaptures.length && parentCaptures[0] !== childCaptures[0]) continue
      taken.add(candidate.path)
      found.push({ entry: candidate, length: candidate.name.length })
    }
  }
  return found.sort((a, b) => b.length - a.length).map(item => item.entry)
}

/**
 * 把同一目录的列表拆成「顶层可见 + 父行下的子项」。只嵌一层（上游 `mapParentToChildren` 的
 * `:196-198`：`if (!allChildNodes.contains(edge.from))` —— 已经当过子的节点不再当父）——
 * 但孙**不会**掉回顶层：它靠 `nestingRulePairs` 补出来的那条传递规则直接挂到祖先行下面。
 * 上游那张「谁是子」的表随节点遍历长大，本仓不依赖行序：改在**整张候选表**上判
 * （谁有得嵌 ⇒ 谁不再当父），所以 `[a.ts, a.d.ts, a.js]` 与 `[a.ts, a.js, a.d.ts]` 同一棵树；
 * 互相认领（A←B 与 B←A）时两条边一起作废（同 `:102-103`「环里的边全去掉」）。
 */
export function nestSiblings<T extends NestableEntry>(entries: readonly T[], rules: readonly NestingRule[] = DEFAULT_NESTING_RULES): NestedSiblings<T> {
  const files = entries.filter(entry => entry.kind !== 'directory')
  const pairs = nestingRulePairs(rules)
  const choices = new Map<string, T[]>()    // 子路径 → 候选父（非空才进来 ⇒ 「这一行会被嵌走」）
  for (const child of files) {
    const list = parentCandidates(child, files, pairs)
    if (list.length) choices.set(child.path, list)
  }
  const parents = new Map<string, T>()       // 子路径 → 真正认领它的那个父
  for (const [childPath, list] of choices) {
    const parent = list.find(candidate => !choices.has(candidate.path))
    if (parent) parents.set(childPath, parent)
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
