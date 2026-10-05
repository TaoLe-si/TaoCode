// 文件选择器的**大小写冲突检测**（`pf/file-chooser` 判词里「大小写敏感冲突检测」那一项）。
//
// 上游依据（`platform/util/src/com/intellij/openapi/util/io/FileSystemUtil.java`）：
//   · `:226-230` `readDirectoryCaseSensitivityByNativeAPI` —— 目录的大小写敏感性由宿主原生 API 读；
//   · `:249-259` `findCaseToggleableChild` —— 找一个「换个大小写就找不到」的孩子：
//     判据是 `!name.toLowerCase().equals(name.toUpperCase())`（`:254`），
//     即 `isCaseToggleable`（`:243-245`）那条；
//   · `:232-236` `toggleCase` —— 先试大写、大写等于原名就改试小写；
//   · `:201-203` 换大小写后**找不到** ⇒ 判 `SENSITIVE`；
//   · `:207-215` 找到了，且换过大小写的名字与原名（或它的 real path 文件名）相同
//     ⇒ 其实是同一个文件 ⇒ 判 `INSENSITIVE`；
//   · `:222-223` 找到了且确实是另一个文件 ⇒ `SENSITIVE`（两个不同大小写的文件并存）。
//   · `CaseSensitivity` 三档（`UNKNOWN` / `SENSITIVE` / `INSENSITIVE`）在
//     `platform/util/src/com/intellij/openapi/util/io/FileAttributes.java` 的
//     `FileAttributes.CaseSensitivity` 枚举里。
//
// 本仓的等价物：`FileAttributes.CaseSensitivity` 落成三字面量；探测用**已有的目录清单**
// （宿主 `workspace.list` 的返回，本仓唯一的目录枚举通道）做同样的三段判定，
// 不引入新的宿主方法 —— 这是本文件唯一的输入。
//
// 为什么它对文件选择器有意义：在一个大小写不敏感的卷上选 `README.md` 而盘上已有
// `readme.md`，宿主会静默覆盖（Windows 的 `CreateFile` 就是这样）。上游在选择器这一层
// 提前把这件事说出来（`FileChooserDialog` 的同名冲突提示），本仓把它做成
// `caseConflictFor` 返回的一句结论，由调用方在**确认覆盖之前**弹给用户。

/** `FileAttributes.CaseSensitivity`（`FileAttributes.java` 的 `CaseSensitivity` 枚举）。 */
export type CaseSensitivity = 'unknown' | 'sensitive' | 'insensitive'

/** `isCaseToggleable`（`:243-245`）：名字里有可切换大小写的字符（`122.45` 就不是）。 */
export function isCaseToggleable(name: string): boolean {
  return name.toLowerCase() !== name.toUpperCase()
}

/** `toggleCase`（`:232-236`）：先试大写，一样就改小写。 */
export function toggleCase(name: string): string {
  const upper = name.toUpperCase()
  return upper === name ? name.toLowerCase() : upper
}

/** 目录下的一个条目（宿主 `workspace.list` 的 `Entry` 形状，只需要名字与种类）。 */
export interface CaseEntry {
  readonly name: string
  readonly kind: 'directory' | 'file'
}

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/**
 * `findCaseToggleableChild`（`:249-259`）的清单版：在目录清单里找第一个可切换大小写的名字。
 * 找不到返回 null（对应上游 `:248` 的「there's only one child "123.456"」）。
 */
export function findCaseToggleableChild(entries: readonly CaseEntry[]): CaseEntry | null {
  return entries.find(entry => isCaseToggleable(entry.name)) ?? null
}

/**
 * 目录的大小写敏感性（`readParentCaseSensitivityByJavaIO` + `readDirectoryCaseSensitivityByNativeAPI`
 * 的可移植子集，`:171-230`）。判定顺序照上游：
 *   1. 目录里没有可切换大小写的名字 ⇒ 无法判定 → `unknown`；
 *   2. **清单里同时有两条只差大小写的同名项** ⇒ 盘上真有两个文件（不敏感卷上不可能并存）
 *     ⇒ `sensitive`（上游 `:222-223`）；
 *   3. 给 `existsAt` 探针（上游 `:201` 那一段「换个大小写去 stat 一下」）：
 *      换大小写后**查不到** ⇒ `sensitive`（`:201-203`）；
 *      查得到 ⇒ 是同一个文件 ⇒ `insensitive`（`:207-215`）。
 *
 * **第 3 步为什么必须要探针**：上游是去 `stat` 那个换过大小写的路径，本仓拿到的
 * 「目录清单」在大小写不敏感的卷上**已经是折叠过的**（宿主 `workspace.list` 只会给出
 * 磁盘上真实存的那一种拼写），所以「清单里有没有换过大小写的那个名字」这件事，
 * 在不敏感卷上与敏感卷上**看起来一模一样**。没有探针就返回 `unknown` ——
 * 上游在 UNKNOWN 分支（`:217-220`）也是不猜的，本仓照它。
 */
export function readDirectoryCaseSensitivity(
  entries: readonly CaseEntry[],
  existsAt?: (name: string) => boolean,
): CaseSensitivity {
  const probe = findCaseToggleableChild(entries)
  if (!probe) return 'unknown'
  const alternates = entries.filter(entry => sameName(entry.name, probe.name))
  if (alternates.length > 1) {
    // 真的有两条不同大小写的同名条目 —— 上游 `:207-215` 判「是同一个文件」的前提
    // （real path 文件名相同）在这里不成立，所以照 `:222-223` 判 sensitive。
    return 'sensitive'
  }
  if (!existsAt) return 'unknown'
  return existsAt(toggleCase(probe.name)) ? 'insensitive' : 'sensitive'
}

/** 一条大小写冲突的判定结果。 */
export interface CaseConflict {
  /** 清单里已经存在的那个名字（真实拼写）。 */
  readonly existing: string
  /** 用户想写/选的那个名字。 */
  readonly requested: string
  /** 该目录的判定结果（判定为 `unknown` 时不算冲突）。 */
  readonly sensitivity: CaseSensitivity
  /** 给用户看的一句话。 */
  readonly message: string
}

/**
 * 选中的名字与目录里已有的名字**只在大小写上不同**时的冲突判定。
 *
 * 上游那一侧是 `FileChooserDialog` 在覆盖前问一句「同名（忽略大小写）的文件已存在，是否替换」；
 * 本仓把它做成纯函数：目录清单 + 想选的名字 → 有冲突给结论，没冲突回 null。
 * **不代替**宿主去做写入 —— 是否覆盖由调用方拿这个结论去问用户
 * （playbook §3：没有消费链路的不渲染）。
 *
 * 判定分三种，取决于 `readDirectoryCaseSensitivity` 的结论（`existsAt` 探针可省）：
 *   · `sensitive` 且清单里确有只差大小写的同名项 ⇒ **两个不同的文件**（`:222-223`），
 *     这是最该报的一种：用户以为在覆盖，其实会多出一个文件。
 *   · `insensitive` ⇒ 同一个文件，保存会覆盖（`:207-215`）。
 *   · `unknown`（判不出敏感性）⇒ **不报冲突也不假装安全**，返回一条
 *     「判不了、请自行核对」的提醒：`needsConfirmation` 仍为 true，让调用方问一句。
 */
export function caseConflictFor(
  directoryEntries: readonly CaseEntry[],
  requested: string,
  existsAt?: (name: string) => boolean,
): CaseConflict | null {
  const name = requested.replace(/^.*[\\/]/, '')
  if (!name || !isCaseToggleable(name)) return null
  const sameSpelling = directoryEntries.find(entry => sameName(entry.name, name))
  if (!sameSpelling) return null
  if (sameSpelling.name === name) return null   // 完全同名 —— 那是普通的「已存在」，不归这一问
  const sensitivity = readDirectoryCaseSensitivity(directoryEntries, existsAt)
  if (sensitivity === 'unknown')
    return {
      existing: sameSpelling.name, requested: name, sensitivity,
      message: `该目录已有 ${sameSpelling.name}，与 ${name} 只差大小写；本仓判不出这个卷是否区分大小写，覆盖前请自行核对。`,
    }
  if (sensitivity === 'sensitive')
    return {
      existing: sameSpelling.name, requested: name, sensitivity,
      message: `该目录区分大小写：已存在 ${sameSpelling.name}，与 ${name} 是两个不同的文件。`,
    }
  return {
    existing: sameSpelling.name, requested: name, sensitivity,
    message: `该目录不区分大小写：${name} 与已存在的 ${sameSpelling.name} 是同一个文件，保存会覆盖它。`,
  }
}
