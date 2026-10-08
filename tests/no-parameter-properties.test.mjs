// 全仓禁止 TS **参数属性**（`constructor(private readonly x: T)`）。
//
// 为什么这是一条门禁而不是一条注释：`node --test` 直接加载本仓的 `.ts`（Node 的
// strip-only 类型擦除，不做类型扩展语法转换），参数属性属于**类型扩展语法**，
// 会在**模块求值期**抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` —— 于是**所有 import 到
// 这个文件的测试文件整片变红**（不是一条断言红，是 file-level 加载失败）。
//
// 这个坑已经踩过两次，第二次一次带红 96+ 个测试文件；两次都是靠人肉定位的。
// 仓里十几个文件都留了「不能写参数属性」的注释，但注释拦不住新写的代码 —— 所以加这道闸。
//
// 判据口径：扫 `src/**/*.ts`（测试文件与脚本不在产品路径上，且它们本来就允许用 TS 全语法），
// 找 `constructor(` 的参数列表里带可见性/只读修饰符的参数。注释里的示例不算（先剥注释）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归列出 `src/` 下的全部 `.ts`（不含 `.d.ts`）。 */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/**
 * 剥掉注释与字符串字面量，避免把注释里的示例代码当成真代码。
 * 只需要够用：行注释、块注释、单/双/反引号字符串。
 */
function stripCommentsAndStrings(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 取出 `constructor(` 的整段参数列表（按括号配平）。 */
function constructorParams(text) {
  const found = []
  const needle = 'constructor'
  let at = text.indexOf(needle)
  while (at !== -1) {
    let i = at + needle.length
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] !== '(') { at = text.indexOf(needle, at + 1); continue }
    let depth = 0
    const start = i
    while (i < text.length) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') { depth--; if (depth === 0) break }
      i++
    }
    found.push({ params: text.slice(start + 1, i), index: at })
    at = text.indexOf(needle, i)
  }
  return found
}

const MODIFIER = /(?:^|[(,])\s*(?:public|private|protected|readonly|override)\s+[\w$]/

test('全仓不写 TS 参数属性（node --test 直载 .ts 会在求值期整片失败）', () => {
  const offenders = []
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = stripCommentsAndStrings(readFileSync(file, 'utf8'))
    for (const { params } of constructorParams(text)) {
      if (MODIFIER.test(params)) {
        offenders.push(`${file.slice(root.length + 1).replace(/\\/g, '/')}: constructor(${params.trim().slice(0, 80)})`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `这些构造器用了参数属性（改成显式字段 + 赋值）：\n${offenders.join('\n')}`,
  )
})

test('这道闸真的抓得到参数属性（不是空跑的假绿）', () => {
  // 自检：拿一段含参数属性的源码跑同一条判定，必须命中。
  const sample = stripCommentsAndStrings('class A { constructor(private readonly x: number) {} }')
  const hit = constructorParams(sample).some(({ params }) => MODIFIER.test(params))
  assert.ok(hit, '判定函数必须能认出参数属性；认不出说明正则写坏了，门禁是假的')
  // 反向：注释里的示例不算。
  const commented = stripCommentsAndStrings('// constructor(private readonly x: number)\nclass A {}')
  assert.equal(constructorParams(commented).length, 0, '注释里的示例不该被当成真代码')
})
