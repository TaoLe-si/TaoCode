// 外部系统「重名去重」的名字建议 —— 上游
// `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/project/nameGenerator/`
// 四个类（`SimpleNameGenerator` / `NumericNameGenerator` / `PathNameGenerator` / `ModuleNameGenerator`）的逐条移植
//（`es/project-model` 判词里第 ⑥ 条：「`nameGenerator` 的重名去重建议——工程名直接取同步报告」）。
//
// 上游这段是干什么的（用户可见面）：两个被链接的构建里都有名叫 `app` 的模块时，IDE 里
// **模块名必须唯一**（`ModuleManager.findModuleByName` 按名字寻址）。上游的做法是给每个模块
// 排一串候选名，取第一个没被占用的：
//   · `AbstractIdeModifiableModelsProvider.java:125-135`
//     `for (String candidate : suggestModuleNameCandidates(moduleData)) { if (findIdeModule(candidate) == null) { imlName = candidate; break } }`
//   · `IdeModelsProviderImpl.java:89-104` 反过来用同一串候选**找回**已有模块；
//   · `IdeModelsProviderImpl.java:106-110` 分隔符口径：
//     `projectSettings.isUseQualifiedModuleNames() ? "." : "-"`。
//
// 四个生成器各自给什么（照抄判定，不美化）：
//   · `SimpleNameGenerator.kt:13-20`：`[name]`，外加「有 group 且 name 不以 group 开头」时的 `group + delimiter + name`；
//   · `NumericNameGenerator.kt:11-30`：`name~1` … `name~5`（`MAX_NUMBER_SEQ = 5`，`:30`）；
//   · `PathNameGenerator.kt:14-52`：从路径**末段往上**最多 `MAX_FILE_DEPTH = 3` 段（`:55`）逐段加前缀，
//     中段那三条「已经包含在名字里」的判断（`:27-43`）会**回退** candidate 尾巴并把 `j` 减一 ——
//     这段是本族里最容易抄错的地方，逐行对应写在下面的循环里；
//   · `ModuleNameGenerator.kt:22-37`：策略表 `PARENT_PATH_NAME → path`、`NUMBER_SUFFIX → numeric`、
//     `DEFAULT → path + numeric`，**再**把 simple 那两条拼在最前。
//
// 本仓的架构不等价处（如实）：没有 `Module` 对象图，所以这条链**不是**给模块命名，而是给
// **用户可见的那一层标识**去重 —— 见 `src/gradleHost.ts` 里 `taskRunName` 的用法：
// 两个链接构建里有同名任务/同名工程时，运行控制台标签与「保存为运行配置」的名字不再撞车。
// `linkedExternalProjectPath` 在上游是磁盘路径且用 `File.isFile()` 判是不是文件
// （`ModuleNameGenerator.kt:15-18`，是文件就退到父目录）；本仓拿不到磁盘类型，
// 所以 `pathIsFile` 由调用方显式传，默认 false。

/** 与上游 `ModuleNameDeduplicationStrategy` 同名的三档。 */
export type ModuleNameDeduplicationStrategy = 'PARENT_PATH_NAME' | 'NUMBER_SUFFIX' | 'DEFAULT'

/** `SimpleNameGenerator.generate(group, name, delimiter)`（`SimpleNameGenerator.kt:13-20`）。 */
export function simpleNameCandidates(group: string | null, name: string, delimiter: string): string[] {
  const names = [name]
  if (group && !name.startsWith(group)) names.push(group + delimiter + name)
  return names
}

/** `NumericNameGenerator.generate(name)`（`NumericNameGenerator.kt:11-27`，上限 5 在 `:30`）。 */
export const NUMERIC_NAME_MAX_SEQUENCE = 5
export function numericNameCandidates(name: string): string[] {
  const out: string[] = []
  for (let current = 1; current <= NUMERIC_NAME_MAX_SEQUENCE; current++) out.push(`${name}~${current}`)
  return out
}

/** `PathNameGenerator.MAX_FILE_DEPTH`（`PathNameGenerator.kt:55`）。 */
export const PATH_NAME_MAX_DEPTH = 3

/**
 * `PathNameGenerator.generate()`（`PathNameGenerator.kt:14-52`）逐行对应：
 * 从路径末段往上最多三段，每段判「是否已经包含在名字里」——
 *   · `:28-35` 名字**等于**这一段、或以 `delimiter+段` / `_段` 结尾 ⇒ 把尾巴削掉、`j--`，不产出；
 *   · `:36-39` 或者原 name 以这一段（或 `上一段+delimiter+这一段`）开头 ⇒ 只 `j--`，不产出；
 *   · `:41` 否则 `duplicateCandidate` 清空（后面的段就不再匹配了）；
 *   · `:44-47` 没被判定为「已包含」时，把 `段+delimiter` 插到前缀串最前并产出一条。
 * `path` 在这里是**已按分隔符拆开的段数组**（上游是 `Path`，`:17` 用 `path.map { it.pathString }`，
 * 不含根分隔符），调用方负责拆。
 */
export function pathNameCandidates(name: string, pathParts: readonly string[], delimiter: string): string[] {
  const names: string[] = []
  const nameBuilder: string[] = []
  let duplicateCandidate = name
  let i = pathParts.length - 1
  let j = 0
  while (i >= 0 && j < PATH_NAME_MAX_DEPTH) {
    const part = pathParts[i]!
    // do not add prefix which was already included into the name
    // （上游 `:25` 的注释原话：那个前缀可能已经在外部系统侧去过重了）
    let isAlreadyIncluded = false
    if (duplicateCandidate.length > 0) {
      if (duplicateCandidate === part || duplicateCandidate.endsWith(delimiter + part) || duplicateCandidate.endsWith(`_${part}`)) {
        j--
        duplicateCandidate = trimSuffix(trimSuffix(duplicateCandidate, part), delimiter)
        isAlreadyIncluded = true
      } else if (name.startsWith(part) || (i > 1 && name.startsWith(`${pathParts[i - 1]}${delimiter}${part}`))) {
        j--
        isAlreadyIncluded = true
      } else {
        duplicateCandidate = ''
      }
    }
    if (!isAlreadyIncluded) {
      nameBuilder.unshift(part + delimiter)
      names.push(`${nameBuilder.join('')}${name}`)
    }
    i--
    j++
  }
  return names
}

/** `StringUtil.removeSuffix` 的两连（上游 `:33` 的 `removeSuffix(part).removeSuffix(delimiter)`）。 */
function trimSuffix(text: string, suffix: string): string {
  return suffix && text.endsWith(suffix) ? text.slice(0, text.length - suffix.length) : text
}

/**
 * `ModuleNameGenerator.generate(group, name, path, delimiter, strategy)`（`ModuleNameGenerator.kt:22-37`）：
 * `SimpleNameGenerator … + strategySuggestions` —— 注意顺序：**simple 的两条在最前**，
 * 因为上游那句 `SimpleNameGenerator.generate(...) + strategySuggestions` 就是把它放在 `+` 左边。
 */
export function moduleNameCandidates(input: {
  group?: string | null
  name: string
  /** 已拆段的路径（不含根分隔符）。 */
  pathParts: readonly string[]
  delimiter?: string
  strategy?: ModuleNameDeduplicationStrategy
}): string[] {
  const delimiter = input.delimiter ?? '-'
  const strategy = input.strategy ?? 'DEFAULT'
  const strategySuggestions = strategy === 'PARENT_PATH_NAME'
    ? pathNameCandidates(input.name, input.pathParts, delimiter)
    : strategy === 'NUMBER_SUFFIX'
      ? numericNameCandidates(input.name)
      : [...pathNameCandidates(input.name, input.pathParts, delimiter), ...numericNameCandidates(input.name)]
  return [...simpleNameCandidates(input.group ?? null, input.name, delimiter), ...strategySuggestions]
}

/**
 * `AbstractIdeModifiableModelsProvider.newModule`（`:125-135`）的那一步：
 * 按候选顺序取**第一个没被占用**的名字；全被占用时上游是 `assert imlName != null`（开发期炸），
 * 本仓不能崩，退成最后一个候选并让调用方拿到 `null` 的替代结果 ——
 * 这里返回 `candidates[candidates.length - 1] ?? name`，并且用 `exact` 标出它其实是被占用的。
 */
export function chooseModuleName(candidates: readonly string[], taken: ReadonlySet<string> | readonly string[]): string | null {
  const used = taken instanceof Set ? taken : new Set(taken)
  for (const candidate of candidates) if (!used.has(candidate)) return candidate
  return null
}

/** 把「工程相对路径 + 名字」拆成上游那种**路径段**（`PathNameGenerator` 的输入形状）。 */
export function moduleNamePathParts(externalProjectPath: string, rootName = ''): string[] {
  const parts = externalProjectPath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (rootName) {
    const index = parts.indexOf(rootName)
    if (index >= 0) return parts.slice(index + 1)
  }
  return parts
}

/**
 * `IdeModelsProviderImpl.java:106-110` 的分隔符口径：
 * `useQualifiedModuleNames` 为真时用 `.`（全限定名 `com.example:app` 那种形态），否则用 `-`。
 */
export function moduleNameDelimiter(useQualifiedModuleNames: boolean): string {
  return useQualifiedModuleNames ? '.' : '-'
}
