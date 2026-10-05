// 正则替换模板的展开（上游 `RegExReplacementBuilder.java`，
// `platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java`）。
//
// 上游替换走 `FindManagerBase.getStringToReplace`：正则档先用匹配器展开替换串里的
// `$n` / `${name}`（`$0` 是整段命中），再按需套「保留大小写」（`:288-299`；
// 保留大小写在 `src/preserveCase.ts`）。展开器本身支持：
//   · 组引用 `$1`、`${name}`（组号取**最长的合法编号**，`Matcher.appendReplacement` 的规则）；
//   · 转义 `\n` `\r` `\b` `\t` `\f` `\xNNNN` —— 后四个在 JS 字符串里没有现成写法；
//   · 大小写转换 `\l`（下一字符小写）、`\u`（下一字符大写）、`\L`…`\E`（区间小写）、
//     `\U`…`\E`（区间大写），区域状态机照抄 `:112-231` 的 `startConversionForCharacter` /
//     `startConversionForRegion` / `resetConversionState`。
//
// 本仓把它做成**纯函数**：`createReplacement(template, groups)`，`groups[0]` 是整段命中，
// `groups[n]` 是第 n 个捕获组（取不到按空串算），这样它不依赖 CodeMirror、可直接单测。
//
// 为什么不能直接把模板塞进 `String.prototype.replace`：JS 的替换串只认 `$&`/`$1`，不认
// `\n`/`\xNNNN`/`\L…\E`，也不做"最长合法组号"回退（`$12` 在只有 1 个组时会整体丢掉，
// 上游是退成 `$1` + 字面 `2`）。这四处差异都会让替换走样，所以逐条移植。

/** 字符是不是拉丁字母（上游 `isLatinLetter`）。 */
function isLatinLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

/** 字符是不是 0-9（上游 `isDigit`）。 */
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

/** 大小写转换区域：`end < 0` 表示开到模板末尾（相当于 `\E` 未出现）。 */
interface CaseRegion { start: number; end: number; upper: boolean }

/** 建一个转换区域（`end < 0` = 开到模板末尾）。 */
function makeRegion(start: number, end: number, upper: boolean): CaseRegion {
  return { start, end, upper }
}

/** 命名组表：`${name}` 的取值来源（`RegExpExecArray.groups`）。 */
type NamedGroups = Record<string, string | undefined>

/**
 * 展开替换模板。
 *
 * @param template 用户输入的替换串（上游 `FindModel.getStringToReplace()`）。
 * @param groups   `0` 号是整段命中，`1..n` 是捕获组；缺的组按空串算（上游 `group == null` 时不追加）。
 * @param named    可选：命名组表（`{name: text}`）；不传时 `${name}` 展开成空串。
 * @returns 展开后的替换文本。
 */
export function createReplacement(template: string, groups: readonly string[], named?: NamedGroups): string {
  const list = groups || []
  const groupCount = Math.max(0, list.length - 1)
  // 模板里的游标与产物分离：转换区域记的是产物下标，和上游的 StringBuilder 同一个口径。
  let cursor = 0
  let out = ''
  const regions: CaseRegion[] = []

  const regionFor = (start: number, end: number, upper: boolean): void => {
    const last = regions.length ? regions[regions.length - 1] : null
    if (last === null) { regions.push(makeRegion(start, end, upper)); return }
    if (last.start === start) { last.end = -1; last.upper = upper; return }
    if (last.end === -1) {
      if (last.upper === upper) return
      last.end = start
    }
    regions.push(makeRegion(start, end, upper))
  }

  const startCharacter = (upper: boolean): void => {
    const at = out.length
    const last = regions.length ? regions[regions.length - 1] : null
    if (last === null || (last.end !== -1 && last.end <= at)) regions.push(makeRegion(at, at + 1, upper))
  }

  const resetRegion = (): void => {
    if (!regions.length) return
    const at = out.length
    const last = regions[regions.length - 1]
    if (last.start >= at) regions.pop()
    else if (last.end === -1) last.end = at
  }

  const appendGroup = (group: string | undefined): void => {
    if (group !== undefined && group !== null) out += group
  }

  while (cursor < template.length) {
    const ch = template[cursor++]
    if (ch === '\\') {
      if (cursor === template.length) throw new Error('character to be escaped is missing')
      const next = template[cursor++]
      if (next === 'n') out += '\n'
      else if (next === 'r') out += '\r'
      else if (next === 'b') out += '\b'
      else if (next === 't') out += '\t'
      else if (next === 'f') out += '\f'
      else if (next === 'x') {
        // 上游只在**后面还有 4 位且能解析**时才吃掉它们；解析失败时静默什么都不追加
        // （`:103-110` 的 catch 里 cursor 不前进，那 4 位随后按普通字符走）。
        if (cursor + 4 <= template.length) {
          const hex = template.slice(cursor, cursor + 4)
          const code = Number.parseInt(hex, 16)
          if (/^[0-9a-fA-F]{4}$/.test(hex) && Number.isFinite(code)) {
            cursor += 4
            out += String.fromCharCode(code)
          }
        }
      }
      else if (next === 'l') startCharacter(false)
      else if (next === 'u') startCharacter(true)
      else if (next === 'L') regionFor(out.length, -1, false)
      else if (next === 'U') regionFor(out.length, -1, true)
      else if (next === 'E') resetRegion()
      else out += next
      continue
    }
    if (ch !== '$') { out += ch; continue }
    if (cursor === template.length) throw new Error('Illegal group reference: group index is missing')
    const next = template[cursor++]
    if (next === '{') {
      // 命名组：`${name}`（名字不能以数字开头）。
      let name = ''
      while (cursor < template.length && (isLatinLetter(template[cursor]) || isDigit(template[cursor]))) { name += template[cursor]; cursor++ }
      if (!name) throw new Error('named capturing group has 0 length name')
      if (template[cursor] !== '}') throw new Error("named capturing group is missing trailing '}'")
      if (isDigit(name[0])) throw new Error(`capturing group name {${name}} starts with digit character`)
      cursor++
      appendGroup(named ? named[name] : undefined)
      continue
    }
    if (!isDigit(next)) throw new Error('Illegal group reference')
    let ref = Number(next)
    // 组号取最长的**合法**编号：多读一位后若超过组数就退回（上游 `:193-203` 的同一条规则）。
    for (;;) {
      if (cursor >= template.length) break
      const digit = template[cursor]
      if (!isDigit(digit)) break
      const candidate = ref * 10 + Number(digit)
      if (candidate > groupCount) break
      ref = candidate
      cursor++
    }
    appendGroup(list[ref])
  }

  if (!regions.length) return out
  // 未闭合的区域收到模板末尾（上游 `generateResult` 的同一处夹取）。
  const last = regions[regions.length - 1]
  const length = out.length
  if (last.end < 0 || last.end > length) last.end = length
  let result = ''
  let at = 0
  for (const region of regions) {
    result += out.slice(at, region.start)
    const text = out.slice(region.start, region.end)
    result += region.upper ? text.toUpperCase() : text.toLowerCase()
    at = region.end
  }
  result += out.slice(at)
  return result
}

/**
 * 便捷包装：`match` 是一个 `RegExpExecArray`（`0` 号整段、`n` 号捕获组），
 * `named` 是 `match.groups`（命名组表）。没有匹配时原样返回模板。
 */
export function replacementFromMatch(template: string, match: RegExpExecArray | null, named?: NamedGroups): string {
  if (!match) return template
  return createReplacement(template, match, named)
}
