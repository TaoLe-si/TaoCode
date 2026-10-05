// 保留大小写（上游 `PreserveCaseUtil`，`platform/lang-impl/src/com/intellij/find/impl/PreserveCaseUtil.java`）。
//
// 替换时把**命中文本的大小写形态**套到替换文本上，而不是原样插入：
//   `replaceWithCaseRespect(replacement, found)` 只看首字符与整段形态（`Report` + `display preferences` → `Report`）；
//   `applyCase(found, replacement)` 先把命中按词切开，再逐词套形态（`Project_Lead_Id` → `Program_Lead_Id`）。
// 上游默认走前者：注册表项 `ide.find.word.based.preserve.case` 默认**关**（`FindManagerBase.java:292-296`），
// 本模块两个都移植，调用方选档；用过的用例逐条来自上游 `PreserveCaseUtilTest.java`（见 `tests/preserve-case.test.mjs`）。
//
// 与上游的字符判定逐条对应：`Character.isUpperCase` → `\p{Lu}`、`isLowerCase` → `\p{Ll}`、
// `isLetter` → `\p{L}`、`isLetterOrDigit` → `[\p{L}\p{Nd}]}`（Java 的 digit 就是 Unicode Nd）。

const LETTER = /\p{L}/u
const UPPER = /\p{Lu}/u
const LOWER = /\p{Ll}/u
const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u
const DIGIT = /\p{Nd}/u

function isLetter(value: string): boolean { return LETTER.test(value) }

/**
 * 上游 `replaceWithCaseRespect(toReplace, foundString)`：按命中文本的整体形态改写替换文本。
 * 注意参数顺序与上游一致 —— 第一个参数是**替换文本**，第二个是**命中文本**。
 */
export function replaceWithCaseRespect(toReplace: string, foundString: string): string {
  if (!foundString || !toReplace) return toReplace
  const parts: string[] = []
  const firstChar = foundString[0]!
  parts.push(UPPER.test(firstChar) ? toReplace[0]!.toUpperCase() : toReplace[0]!.toLowerCase())
  if (toReplace.length === 1) return parts.join('')
  if (foundString.length === 1) { parts.push(toReplace.slice(1)); return parts.join('') }

  let replacementLowercase = true
  let replacementUppercase = true
  for (let i = 1; i < toReplace.length; i++) {
    const c = toReplace[i]!
    if (!isLetter(c)) continue
    replacementLowercase = replacementLowercase && LOWER.test(c)
    replacementUppercase = replacementUppercase && UPPER.test(c)
    if (!replacementLowercase && !replacementUppercase) break
  }

  let tailUpper = true
  let tailLower = true
  let tailChecked = false
  for (let i = 1; i < foundString.length; i++) {
    const c = foundString[i]!
    if (!isLetter(c)) continue
    tailUpper = tailUpper && UPPER.test(c)
    tailLower = tailLower && LOWER.test(c)
    tailChecked = true
    if (!tailUpper && !tailLower) break
  }
  if (!tailChecked) {
    tailUpper = isLetter(firstChar) && UPPER.test(firstChar)
    tailLower = isLetter(firstChar) && LOWER.test(firstChar)
  }

  if (tailUpper && (replacementLowercase || !replacementUppercase)) parts.push(toReplace.slice(1).toUpperCase())
  else if (tailLower && (replacementLowercase || replacementUppercase)) parts.push(toReplace.slice(1).toLowerCase())
  else parts.push(toReplace.slice(1))
  return parts.join('')
}

interface WordCase { upperCase: boolean; lowerCase: boolean; capitalized: boolean }

/** 上游 `analyze`：一个词的形态（全大写 / 全小写 / 首字母大写）。 */
function analyze(word: string): WordCase {
  let upperCase = true
  let lowerCase = true
  let capitalized = true
  for (const c of word) {
    if (!isLetter(c)) continue
    const u = UPPER.test(c)
    const l = LOWER.test(c)
    if (upperCase && lowerCase) capitalized = u
    upperCase = upperCase && u
    lowerCase = lowerCase && l
  }
  return { upperCase, lowerCase, capitalized }
}

/** 上游 `collectWords`：按「字母或数字」的连续段切词，其余字符是分隔符。 */
function collectWords(text: string): string[] {
  const result: string[] = []
  let prevIsWordChar = false
  let word = ''
  for (const c of text) {
    if (LETTER_OR_DIGIT.test(c)) { prevIsWordChar = true; word += c }
    else if (prevIsWordChar) { result.push(word); word = ''; prevIsWordChar = false }
  }
  if (word) result.push(word)
  return result
}

/** 上游 `buildWord`：把一个替换词按命中词的形态改写。 */
function buildWord(word: string, foundCase: WordCase): string {
  // 命中词里没有字母（例如 `111`）：不动替换词。
  if (foundCase.upperCase && foundCase.lowerCase) return word
  const replacementCase = analyze(word)
  if (foundCase.upperCase) return replacementCase.upperCase ? word : word.toUpperCase()
  const result: string[] = []
  let prevIsWordChar = false
  for (const c of word) {
    if (isLetter(c)) {
      if (!prevIsWordChar) {
        result.push(foundCase.lowerCase || !foundCase.capitalized ? c.toLowerCase() : c.toUpperCase())
        prevIsWordChar = true
      } else {
        result.push(replacementCase.upperCase ? c.toLowerCase() : c)
      }
    } else {
      prevIsWordChar = DIGIT.test(c)
      result.push(c)
    }
  }
  return result.join('')
}

/**
 * 上游 `applyCase(found, replacement)`：逐词套用命中文本的形态，
 * 支持 `REPORT` / `report` / `Report` 三种，且替换词与命中词可以不等长。
 */
export function applyCase(found: string, replacement: string): string {
  if (!found || !replacement) return replacement
  const words = collectWords(found)
  if (!words.length) return replacement
  const result: string[] = []
  let index = 0
  let start = -1
  for (let i = 0; i < replacement.length; i++) {
    const c = replacement[i]!
    if (LETTER_OR_DIGIT.test(c)) {
      if (start < 0) start = i
    } else {
      if (start >= 0) {
        result.push(buildWord(replacement.slice(start, i), analyze(words[index]!)))
        start = -1
        if (index < words.length - 1) index++
      }
      result.push(c)
    }
  }
  if (start >= 0) result.push(buildWord(replacement.slice(start), analyze(words[index]!)))
  return result.join('')
}
