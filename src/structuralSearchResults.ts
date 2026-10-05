// 结构化搜索的**匹配结果模型**（上游 `MatchResult` 那一族在本仓的文本等价物）。
//
// 上游一条命中是一个语法树节点：`MatchResult.java:11-32` 的抽象类给出
// `getMatchImage()`（那一整段文本，`:15`）、`getStart()/getEnd()`（`:19-20`）、
// `getName()`（`:22`）、`getChildren()/hasChildren()`（子模板的命中，`:24-25`）、
// `isMultipleMatch()`（`:29`）与 `isTarget()`（`:32`，即 `_$x$` 那种目标变量）。
// 面板与预览读的是"这一次命中里，每个变量各自匹配到了什么"——
// `SubstitutionShortInfoHandler.java:48` 就是把这个信息以编辑器内嵌提示（inlay）画回
// 模板上，`:96-107` 再区分「搜索变量」与「替换变量」：名字带
// `ReplaceConfiguration.REPLACEMENT_VARIABLE_SUFFIX`（`replace/ui/ReplaceConfiguration.java:18`
// 的 `"$replacement"`）的那一支走替换侧定义 ——
// `StructuralSearchDialog.java:1465-1473` 就是那个分叉点。
//
// 本仓的命中是宿主扫描返回的「文件 + 行 + 列 + 行长 + 该行文本」，**没有语法树**，
// 所以这里用**同一个编译产物**（`compileStructuralPattern` 出来的正则与变量表）在命中
// 所在的那一行上重跑一次，取回每个捕获组的文本 —— 这就是「每个变量的命中值」在文本层
// 的等价物：不引入第二套匹配语义，值与宿主真正替换掉的那一段必然一致（同一份正则、
// 同一段文本、同一个起始列）。
//
// 去重那一档照 `plugin/util/DuplicateFilteringResultSink.java:18-46`：
//   · `newMatch` 里 `if (!duplicates.add(result.getMatchRef())) return;`（`:28-31`）——
//     同一个匹配对象第二次上报就丢掉，**第一条赢**；
//   · `matchingFinished()` 清空这张集合（`:43-46`）—— 所以去重是**一次搜索**范围内的，
//     不跨搜索累积。
// 本仓的「匹配对象标识」是 `路径:行:列`（宿主给的就是这三个字段），流式分块与
// 「块 + 最终全量」两条路都会把同一处送上来两次，正该由这一层收敛。

/** 一条命中在文本层的全部信息（上游 `MatchResult` 那几个 getter 的可移植子集）。 */
export interface StructuralMatch {
  path: string
  line: number
  column: number
  /** `getMatchImage()`：整段命中的文本（本仓 = 宿主给的那一行预览）。 */
  image: string
  /** 变量名 → 这一次命中里它匹配到的文本；未参与匹配的组是 null。 */
  variables: Record<string, string | null>
}

/**
 * 在 `text` 上从 `from` 开始找一个匹配，取回每个变量的命中值。
 *
 * `pattern` 是 `compileStructuralPattern().regex`（已经带捕获组），`flags` 要与宿主那次
 * 扫描**同一套**（大小写位来自面板的「区分大小写」；不加 `g`，因为只找第一处）。
 * 变量按**首次出现顺序**对应组号（`structuralSearch.ts` 的 `variables` 就是这个顺序），
 * 所以这里不需要额外传组表。
 *
 * 找不到匹配时返回 null —— 不猜值。宿主按 `std::regex` 匹配、这里按 JS 正则匹配，
 * 两边对同一行的判定偶发不一致（比如宿主截断过的超长行）时，宁可不显示也不给一个
 * 看起来对、其实是编出来的变量值。
 */
export function variableValues(
  pattern: string,
  variables: readonly string[],
  text: string,
  flags = '',
): Record<string, string | null> | null {
  let regex: RegExp
  try { regex = new RegExp(pattern, flags) } catch { return null }
  const found = regex.exec(text)
  if (!found) return null
  const out: Record<string, string | null> = {}
  variables.forEach((name, index) => { out[name] = found[index + 1] ?? null })
  return out
}

/**
 * 变量值的人话一行（上游 inlay 上那个「变量 → 它匹配到的文本」）。
 *
 * 只列**真的参与匹配**的变量（值为 null 的跳过），并且按模板里变量的出现顺序输出 ——
 * 与替换串里 `$1`、`$2` 的编号顺序一致，用户拿这个顺序去核对替换结果才对得上。
 */
export function variableValueLines(values: Readonly<Record<string, string | null>>): string[] {
  return Object.entries(values)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `$${name}$ → ${value}`)
}

/**
 * 上游 `MatchOptions.java:60` 的 `looseMatching` 恒为真（`setLooseMatching` 全树无调用者），
 * 所以模板里的空白不参与比对。那一半在编译期就处理了（`compileStructuralPattern`），
 * 本模块只负责**读结果**，不再做宽松化，免得出现两套匹配语义。
 */
export function structuralMatch(
  path: string,
  line: number,
  column: number,
  image: string,
  pattern: string,
  variables: readonly string[],
  flags = '',
): StructuralMatch {
  return { path, line, column, image, variables: variableValues(pattern, variables, image, flags) ?? {} }
}

/**
 * 一次搜索范围内的去重（`DuplicateFilteringResultSink` 的等价物）。
 *
 * 判等键 = 上游的 `getMatchRef()`：本仓是「文件 + 行 + 列」，同一处只留第一条。
 * `reset()` 对应 `matchingFinished()`（`:43-46`）—— 新的一次搜索从空集开始，
 * 不会把上一次看过的命中当成重复而吞掉。
 */
export function createDuplicateFilter(): {
  accept: (item: { path: string; line: number; column: number }) => boolean
  reset: () => void
  seen: () => number
} {
  const duplicates = new Set<string>()
  return {
    // `Set.add` 返回的是**集合本身**（永远真值），直接当布尔用会让"第二条及以后"也被当成新命中，
    // 去重就整条失效了 —— 所以必须先 has 再 add，把"是不是新的"翻成真正的布尔。
    accept: item => {
      const key = `${item.path}:${item.line}:${item.column}`
      if (duplicates.has(key)) return false
      duplicates.add(key)
      return true
    },
    reset: () => duplicates.clear(),
    seen: () => duplicates.size,
  }
}

/** 纯函数版本：给一批命中做同一份去重（顺序敏感，第一条赢）。 */
export function dedupeMatches<T extends { path: string; line: number; column: number }>(items: readonly T[]): T[] {
  const filter = createDuplicateFilter()
  return items.filter(item => filter.accept(item))
}
