// 正则替换模板的展开（上游 `RegExReplacementBuilder.java`，
// `platform/lang-impl/src/com/intellij/find/impl/RegExReplacementBuilder.java`，全文件 275 行）。
//
// 上游替换走 `FindManagerBase.getStringToReplace`（`platform/lang-impl/src/com/intellij/find/impl/FindManagerBase.java:284-298`）：
// 正则档先用匹配器展开替换串里的 `$n` / `${name}`（`$0` 是整段命中），再按需套
// 「保留大小写」（`FindManagerBase.java:292-296`，`PreserveCaseUtil` 吃的是**展开之后**的文本；
// 保留大小写在 `src/preserveCase.ts`）。展开器本身支持：
//   · 组引用 `$1`、`${name}`（组号取**最长的合法编号**，`:164-176`）；
//   · 转义 `\n` `\r` `\b` `\t` `\f` `\xNNNN`（`:113-128`）—— 后四个在 JS 字符串里没有现成写法；
//   · 大小写转换 `\l`（下一字符小写）、`\u`（下一字符大写）、`\L`…`\E`（区间小写）、
//     `\U`…`\E`（区间大写），区域状态机照抄 `startConversionForCharacter:206-212` /
//     `startConversionForRegion:214-233` / `resetConversionState:235-247`，产物裁剪照 `generateResult:183-204`。
//
// 原写「`:288-299`」「`:112-231`」「`:193-203`」「`:103-110`」四处上游行号是**数错的旧引证**：
// 这一批自己把那份文件从头到尾行数核了一遍，按上表的真实行号改了（原写 X、实际 Y 留在这里）。
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
 * `Integer.parseInt(text, 16)` 的形状（上游 `:122` 用的就是它）：可以带一个 `+`/`-`，
 * 带符号之后**必须全是**十六进制数字，否则抛。
 * 不能直接拿 `Number.parseInt` 用：它会跳过前导空白、认 `0x` 前缀，Java 两种都抛
 * （`\x0x12` 在上游是「解析失败 ⇒ 那 4 位按普通字符走」）。
 */
function parseIntRadix16(text: string): number | null {
  let at = 0
  let sign = 1
  if (text[at] === '+' || text[at] === '-') { if (text[at] === '-') sign = -1; ++at }
  if (at >= text.length) return null
  let value = 0
  for (; at < text.length; ++at) {
    const digit = Number.parseInt(text[at]!, 16)
    if (Number.isNaN(digit)) return null
    value = value * 16 + digit
  }
  return sign * value
}

/**
 * 展开替换模板。
 *
 * @param template 用户输入的替换串（上游 `FindModel.getStringToReplace()`）。
 * @param groups   `0` 号是整段命中，`1..n` 是捕获组；缺的组按空串算（上游 `group == null` 时不追加）。
 * @param named    可选：命名组表（`{name: text}`）；不传时 `${name}` 展开成空串。
 * @param strict   可选：越界的组号（`$9` 而模式只有 2 个组）像上游那样**报错**而不是当空串。
 *                 上游两条入口都在这里：替换那侧 `Matcher.group(n)` 越界即抛（`:176`，
 *                 被 `FindManagerBase:311-313` 包成 `MalformedReplacementStringException`）；
 *                 校验那侧 `:56-61` 抛的文案是 `No group N`。默认关 —— 本仓既有的
 *                 "缺组按空串"口径由 `tests/editor-find-options.test.mjs:114` 钉着。
 * @returns 展开后的替换文本。
 */
export function createReplacement(template: string, groups: readonly string[], named?: NamedGroups, strict = false): string {
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
        // 上游只在**后面还有 4 位且 `Integer.parseInt(s,16)` 认它**时才吃掉那 4 位
        // （`:103-110` 的 catch 里 cursor 不前进，那 4 位随后按普通字符走）。
        // Java 的那次解析允许一个前导符号（`+123` / `-1a2`），`(char)code` 取低 16 位。
        if (cursor + 4 <= template.length) {
          const code = parseIntRadix16(template.slice(cursor, cursor + 4))
          if (code !== null) {
            cursor += 4
            out += String.fromCharCode(code & 0xffff)
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
    // 组号取最长的**合法**编号：多读一位后若超过组数就退回（上游 `:167-175` 的同一条规则）。
    for (;;) {
      if (cursor >= template.length) break
      const digit = template[cursor]
      if (!isDigit(digit)) break
      const candidate = ref * 10 + Number(digit)
      if (candidate > groupCount) break
      ref = candidate
      cursor++
    }
    // 越界的组号：上游 `:176` 的 `myMatcher.group(refNum)` 直接抛，`FindManagerBase:311-313`
    // 把它包成 `MalformedReplacementStringException`；`validate` 那侧是 `:56-61` 的 `No group N`。
    // 默认（替换那侧的既有口径）按空串走，`strict` 只给校验入口用，见 `validateReplacement`。
    if (strict && ref > groupCount) throw new Error(`No group ${ref}`)
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

/**
 * 上游 `RegExReplacementBuilder.validate`（`:76-78`）：只拿模式的**组数**跑一遍展开器，
 * 组值全是空串。它查这些：`$` 后面不是数字（`:165`）、`$` 收尾（`:140`）、`\` 收尾（`:111`）、
 * `${}` 空名 / 缺 `}` / 名字以数字开头（`:154-159`）、越界组号（`:58-59`）。
 * 按 `:71` 那句注释，它**不**查组名是否真的存在。
 *
 * @returns null = 模板合法；否则是上游那条 `IllegalArgumentException` 的消息，
 *   面板按 `FindBundle.properties:96`「Malformed replacement string: {0}」把它拼成一行。
 */
export function validateReplacement(template: string, groupCount: number): string | null {
  try {
    createReplacement(template, new Array(groupCount + 1).fill(''), undefined, true)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * 一个正则源串里的捕获组数 —— `validate` 的入参，对应上游的
 * `pattern.matcher("").groupCount()`（`:63-66`）。JS 的 `RegExp` 不直接交出这个数，
 * 所以探一次：`(?:(?:SRC)|)()` 末尾那个空分组是**已知**的 1 个，数组长度减 2 就是 SRC 自己的组数
 * （没参与匹配的组也在数组里占一个 `undefined` 位，所以长度按总数算）。
 * SRC 自己编不出来时返回 0 —— 那条路径上搜索早就报错了，这里不重复报错。
 */
export function captureGroupCount(source: string): number {
  try {
    const hit = new RegExp(`(?:(?:${source})|)()`).exec('')
    return hit ? hit.length - 2 : 0
  } catch {
    return 0
  }
}
