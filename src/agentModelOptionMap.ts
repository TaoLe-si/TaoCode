// Restricted model-option CEL and ordered JSON merge-patch port.
// Source: .tools/ZCode/packages/model-option-map/src/{types,tokenizer,parser,evaluator,compiler,merge-patch,option-maps}.ts

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type RestrictedCelValue = string | number
export type ModelOptionName = 'reasoningLevel' | 'maxOutputTokens'

export interface RestrictedCelProgram {
  readonly source: string
  evaluate(input: RestrictedCelValue): JsonValue
}

export interface ModelOptionMapProgram {
  readonly source: string
  evaluate(input: RestrictedCelValue): JsonObject
}

export class RestrictedCelError extends Error {
  readonly offset: number

  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'RestrictedCelError'
    this.offset = offset
  }
}

export class ModelOptionMapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelOptionMapError'
  }
}

export type RestrictedCelTokenKind = 'identifier' | 'string' | 'number' | 'operator' | 'punctuation' | 'eof'

export interface RestrictedCelToken {
  readonly kind: RestrictedCelTokenKind
  readonly value: string
  readonly offset: number
  readonly end: number
}

type RestrictedCelExpression =
  | { readonly type: 'literal'; readonly value: string | number | boolean | null; readonly offset: number }
  | { readonly type: 'input'; readonly offset: number }
  | { readonly type: 'array'; readonly elements: readonly RestrictedCelExpression[]; readonly offset: number }
  | {
      readonly type: 'object'
      readonly entries: readonly {
        readonly key: string
        readonly value: RestrictedCelExpression
        readonly offset: number
      }[]
      readonly offset: number
    }
  | {
      readonly type: 'unary'
      readonly operator: '!' | '-' | '+'
      readonly operand: RestrictedCelExpression
      readonly offset: number
    }
  | {
      readonly type: 'binary'
      readonly operator: string
      readonly left: RestrictedCelExpression
      readonly right: RestrictedCelExpression
      readonly offset: number
    }
  | {
      readonly type: 'conditional'
      readonly condition: RestrictedCelExpression
      readonly whenTrue: RestrictedCelExpression
      readonly whenFalse: RestrictedCelExpression
      readonly offset: number
    }

const DOUBLE_OPERATORS = new Set(['&&', '||', '==', '!=', '<=', '>='])
const SINGLE_OPERATORS = new Set(['+', '-', '*', '/', '%', '!', '<', '>'])
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ',', ':', '?', '.'])

/** Tokenizer parity with tokenizer.ts: only the restricted CEL token set is accepted. */
export function tokenizeRestrictedCel(source: string): readonly RestrictedCelToken[] {
  const tokens: RestrictedCelToken[] = []
  let offset = 0
  while (offset < source.length) {
    const character = source[offset]!
    if (/\s/u.test(character)) {
      offset += 1
      continue
    }

    if (character === "'" || character === '"') {
      const token = readString(source, offset, character)
      tokens.push(token)
      offset = token.end
      continue
    }

    if (/[0-9]/u.test(character)) {
      const token = readNumber(source, offset)
      tokens.push(token)
      offset = token.end
      continue
    }

    if (/[A-Za-z_]/u.test(character)) {
      const end = readWhile(source, offset + 1, /[A-Za-z0-9_]/u)
      tokens.push({ kind: 'identifier', value: source.slice(offset, end), offset, end })
      offset = end
      continue
    }

    const pair = source.slice(offset, offset + 2)
    if (DOUBLE_OPERATORS.has(pair)) {
      tokens.push({ kind: 'operator', value: pair, offset, end: offset + 2 })
      offset += 2
      continue
    }
    if (SINGLE_OPERATORS.has(character)) {
      tokens.push({ kind: 'operator', value: character, offset, end: offset + 1 })
      offset += 1
      continue
    }
    if (PUNCTUATION.has(character)) {
      tokens.push({ kind: 'punctuation', value: character, offset, end: offset + 1 })
      offset += 1
      continue
    }
    throw new RestrictedCelError(`unsupported token ${JSON.stringify(character)}`, offset)
  }
  tokens.push({ kind: 'eof', value: '', offset: source.length, end: source.length })
  return Object.freeze(tokens)
}

function readNumber(source: string, offset: number): RestrictedCelToken {
  const match = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(offset))
  if (!match) throw new RestrictedCelError('invalid number literal', offset)
  const value = match[0]
  const end = offset + value.length
  return { kind: 'number', value, offset, end }
}

function readString(source: string, offset: number, quote: "'" | '"'): RestrictedCelToken {
  let cursor = offset + 1
  let value = ''
  while (cursor < source.length) {
    const character = source[cursor]!
    if (character === quote) return { kind: 'string', value, offset, end: cursor + 1 }
    if (character === '\n' || character === '\r') {
      throw new RestrictedCelError('unterminated string literal', offset)
    }
    if (character !== '\\') {
      value += character
      cursor += 1
      continue
    }

    const escapeOffset = cursor
    cursor += 1
    const escaped = source[cursor]
    if (escaped === undefined) throw new RestrictedCelError('unterminated string escape', escapeOffset)
    const simpleEscape = SIMPLE_ESCAPES[escaped]
    if (simpleEscape !== undefined) {
      value += simpleEscape
      cursor += 1
      continue
    }
    if (escaped === 'u') {
      const digits = source.slice(cursor + 1, cursor + 5)
      if (!/^[0-9A-Fa-f]{4}$/u.test(digits)) {
        throw new RestrictedCelError('invalid unicode escape', escapeOffset)
      }
      value += String.fromCharCode(Number.parseInt(digits, 16))
      cursor += 5
      continue
    }
    throw new RestrictedCelError(`unsupported string escape \\${escaped}`, escapeOffset)
  }
  throw new RestrictedCelError('unterminated string literal', offset)
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "'": "'",
  '"': '"',
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
})

function readWhile(source: string, offset: number, pattern: RegExp): number {
  let cursor = offset
  while (cursor < source.length && pattern.test(source[cursor]!)) cursor += 1
  return cursor
}

function parseRestrictedCel(
  tokens: readonly RestrictedCelToken[],
  variableName: ModelOptionName,
): RestrictedCelExpression {
  return new RestrictedCelParser(tokens, variableName).parse()
}

class RestrictedCelParser {
  #index = 0

  // 显式字段，不写参数属性（`constructor(private readonly ...)`）—— `node --test` 直接加载
  // `.ts` 走 strip-only 类型擦除，参数属性会让整个文件加载失败（HANDOFF.md:20 的同一条坑；
  // 同类备注见 `src/completionCamelHump.ts:228`、`src/mergeResolve.ts:207`）。
  private readonly tokens: readonly RestrictedCelToken[]
  private readonly variableName: ModelOptionName

  constructor(tokens: readonly RestrictedCelToken[], variableName: ModelOptionName) {
    this.tokens = tokens
    this.variableName = variableName
  }

  parse(): RestrictedCelExpression {
    const expression = this.parseConditional()
    const trailing = this.current()
    if (trailing.kind !== 'eof') {
      if (trailing.value === '.') throw new RestrictedCelError('member access is not supported', trailing.offset)
      if (trailing.value === '(') throw new RestrictedCelError('function calls are not supported', trailing.offset)
      throw new RestrictedCelError(`unexpected token ${JSON.stringify(trailing.value)}`, trailing.offset)
    }
    return expression
  }

  private parseConditional(): RestrictedCelExpression {
    const condition = this.parseLogicalOr()
    if (!this.consume('?')) return condition
    const whenTrue = this.parseConditional()
    this.expect(':')
    const whenFalse = this.parseConditional()
    return { type: 'conditional', condition, whenTrue, whenFalse, offset: condition.offset }
  }

  private parseLogicalOr(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseLogicalAnd(), new Set(['||']))
  }

  private parseLogicalAnd(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseEquality(), new Set(['&&']))
  }

  private parseEquality(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseRelational(), new Set(['==', '!=']))
  }

  private parseRelational(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseAdditive(), new Set(['<', '<=', '>', '>=']))
  }

  private parseAdditive(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseMultiplicative(), new Set(['+', '-']))
  }

  private parseMultiplicative(): RestrictedCelExpression {
    return this.parseBinary(() => this.parseUnary(), new Set(['*', '/', '%']))
  }

  private parseBinary(
    parseOperand: () => RestrictedCelExpression,
    operators: ReadonlySet<string>,
  ): RestrictedCelExpression {
    let expression = parseOperand()
    while (this.current().kind === 'operator' && operators.has(this.current().value)) {
      const operator = this.advance()
      expression = {
        type: 'binary',
        operator: operator.value,
        left: expression,
        right: parseOperand(),
        offset: operator.offset,
      }
    }
    return expression
  }

  private parseUnary(): RestrictedCelExpression {
    const token = this.current()
    if (token.kind === 'operator' && (token.value === '!' || token.value === '-' || token.value === '+')) {
      this.advance()
      return { type: 'unary', operator: token.value, operand: this.parseUnary(), offset: token.offset }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): RestrictedCelExpression {
    const token = this.advance()
    if (token.kind === 'number') {
      const value = Number(token.value)
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw new RestrictedCelError('number literal is not JSON-safe', token.offset)
      }
      return { type: 'literal', value, offset: token.offset }
    }
    if (token.kind === 'string') return { type: 'literal', value: token.value, offset: token.offset }
    if (token.kind === 'identifier') {
      if (this.current().value === '(') {
        throw new RestrictedCelError('function calls are not supported', this.current().offset)
      }
      if (token.value === this.variableName) return { type: 'input', offset: token.offset }
      if (token.value === 'true' || token.value === 'false') {
        return { type: 'literal', value: token.value === 'true', offset: token.offset }
      }
      if (token.value === 'null') return { type: 'literal', value: null, offset: token.offset }
      throw new RestrictedCelError(`unknown identifier ${JSON.stringify(token.value)}`, token.offset)
    }
    if (token.value === '(') {
      const expression = this.parseConditional()
      this.expect(')')
      return expression
    }
    if (token.value === '[') return this.parseArray(token.offset)
    if (token.value === '{') return this.parseObject(token.offset)
    throw new RestrictedCelError(`unexpected token ${JSON.stringify(token.value)}`, token.offset)
  }

  private parseArray(offset: number): RestrictedCelExpression {
    const elements: RestrictedCelExpression[] = []
    if (!this.consume(']')) {
      do elements.push(this.parseConditional())
      while (this.consume(','))
      this.expect(']')
    }
    return { type: 'array', elements: Object.freeze(elements), offset }
  }

  private parseObject(offset: number): RestrictedCelExpression {
    const entries: { key: string; value: RestrictedCelExpression; offset: number }[] = []
    const keys = new Set<string>()
    if (!this.consume('}')) {
      do {
        const key = this.advance()
        if (key.kind !== 'string') throw new RestrictedCelError('object keys must be string literals', key.offset)
        if (keys.has(key.value)) {
          throw new RestrictedCelError(`duplicate object key ${JSON.stringify(key.value)}`, key.offset)
        }
        keys.add(key.value)
        this.expect(':')
        entries.push({ key: key.value, value: this.parseConditional(), offset: key.offset })
      } while (this.consume(','))
      this.expect('}')
    }
    return { type: 'object', entries: Object.freeze(entries), offset }
  }

  private consume(value: string): boolean {
    if (this.current().value !== value) return false
    this.#index += 1
    return true
  }

  private expect(value: string): RestrictedCelToken {
    const token = this.current()
    if (token.value !== value) throw new RestrictedCelError(`expected ${JSON.stringify(value)}`, token.offset)
    this.#index += 1
    return token
  }

  private advance(): RestrictedCelToken {
    const token = this.current()
    if (token.kind !== 'eof') this.#index += 1
    return token
  }

  private current(): RestrictedCelToken {
    return this.tokens[this.#index] ?? this.tokens[this.tokens.length - 1]!
  }
}

function evaluateRestrictedCel(
  expression: RestrictedCelExpression,
  input: RestrictedCelValue,
): JsonValue {
  assertRestrictedCelValue(input, expression.offset)
  return freezeJson(evaluate(expression, input))
}

function evaluate(expression: RestrictedCelExpression, input: RestrictedCelValue): JsonValue {
  switch (expression.type) {
    case 'literal':
      return expression.value
    case 'input':
      return input
    case 'array':
      return expression.elements.map(element => evaluate(element, input))
    case 'object': {
      const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
      for (const entry of expression.entries) {
        Object.defineProperty(result, entry.key, {
          configurable: true,
          enumerable: true,
          value: evaluate(entry.value, input),
          writable: true,
        })
      }
      return result
    }
    case 'unary':
      return evaluateUnary(expression.operator, evaluate(expression.operand, input), expression.offset)
    case 'binary':
      return evaluateBinary(expression, input)
    case 'conditional':
      return requireBoolean(evaluate(expression.condition, input), expression.condition.offset)
        ? evaluate(expression.whenTrue, input)
        : evaluate(expression.whenFalse, input)
  }
}

function evaluateUnary(operator: string, operand: JsonValue, offset: number): JsonValue {
  if (operator === '!') return !requireBoolean(operand, offset)
  const number = requireNumber(operand, offset)
  return assertNumber(operator === '-' ? -number : number, offset)
}

function evaluateBinary(
  expression: Extract<RestrictedCelExpression, { type: 'binary' }>,
  input: RestrictedCelValue,
): JsonValue {
  const left = evaluate(expression.left, input)
  if (expression.operator === '&&') {
    return requireBoolean(left, expression.left.offset)
      ? requireBoolean(evaluate(expression.right, input), expression.right.offset)
      : false
  }
  if (expression.operator === '||') {
    return requireBoolean(left, expression.left.offset)
      ? true
      : requireBoolean(evaluate(expression.right, input), expression.right.offset)
  }

  const right = evaluate(expression.right, input)
  switch (expression.operator) {
    case '==':
      return jsonEquals(left, right)
    case '!=':
      return !jsonEquals(left, right)
    case '+':
      if (typeof left === 'string' && typeof right === 'string') return left + right
      return assertNumber(
        requireNumber(left, expression.left.offset) + requireNumber(right, expression.right.offset),
        expression.offset,
      )
    case '-':
      return numericBinary(left, right, expression, (a, b) => a - b)
    case '*':
      return numericBinary(left, right, expression, (a, b) => a * b)
    case '/':
      return numericBinary(left, right, expression, (a, b) => a / b)
    case '%':
      return numericBinary(left, right, expression, (a, b) => a % b)
    case '<':
    case '<=':
    case '>':
    case '>=':
      return compare(left, right, expression.operator, expression.offset)
    default:
      throw new RestrictedCelError(`unsupported operator ${expression.operator}`, expression.offset)
  }
}

function numericBinary(
  left: JsonValue,
  right: JsonValue,
  expression: Extract<RestrictedCelExpression, { type: 'binary' }>,
  operation: (left: number, right: number) => number,
): number {
  return assertNumber(
    operation(requireNumber(left, expression.left.offset), requireNumber(right, expression.right.offset)),
    expression.offset,
  )
}

function compare(left: JsonValue, right: JsonValue, operator: string, offset: number): boolean {
  if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) {
    throw new RestrictedCelError('comparison operands must have the same numeric or string type', offset)
  }
  const comparison = typeof left === 'number' && typeof right === 'number'
    ? left < right ? -1 : left > right ? 1 : 0
    : String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
  if (operator === '<') return comparison < 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  return comparison >= 0
}

function requireBoolean(value: JsonValue, offset: number): boolean {
  if (typeof value !== 'boolean') throw new RestrictedCelError('boolean operand required', offset)
  return value
}

function requireNumber(value: JsonValue, offset: number): number {
  if (typeof value !== 'number') throw new RestrictedCelError('numeric operand required', offset)
  return value
}

function assertNumber(value: number, offset: number): number {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new RestrictedCelError('numeric result is not JSON-safe', offset)
  }
  return value
}

function assertRestrictedCelValue(value: unknown, offset: number): asserts value is RestrictedCelValue {
  if (typeof value === 'string') return
  if (typeof value === 'number') {
    assertNumber(value, offset)
    return
  }
  throw new RestrictedCelError('input value must be a string or number', offset)
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => jsonEquals(entry, right[index]!))
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length &&
      leftKeys.every(key => Object.hasOwn(right, key) && jsonEquals(left[key]!, right[key]!))
  }
  return false
}

function freezeJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJson(entry)
  } else if (isJsonObject(value)) {
    for (const entry of Object.values(value)) freezeJson(entry)
  } else {
    return value
  }
  return Object.freeze(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const restrictedCelProgramCache = new Map<string, RestrictedCelProgram>()
const modelOptionMapCache = new Map<string, ModelOptionMapProgram>()
const expressionCache = new Map<string, RestrictedCelExpression>()

export function compileRestrictedCel(source: string, variableName: ModelOptionName): RestrictedCelProgram {
  const normalizedSource = normalizeSource(source)
  const cacheKey = createCacheKey(normalizedSource, variableName)
  const cached = restrictedCelProgramCache.get(cacheKey)
  if (cached) return cached

  const expression = parseExpression(normalizedSource, variableName)
  const program: RestrictedCelProgram = Object.freeze({
    source: normalizedSource,
    evaluate: (input: RestrictedCelValue) => evaluateRestrictedCel(expression, input),
  })
  restrictedCelProgramCache.set(cacheKey, program)
  return program
}

export function compileModelOptionMap(source: string, variableName: ModelOptionName): ModelOptionMapProgram {
  const normalizedSource = normalizeSource(source)
  const cacheKey = createCacheKey(normalizedSource, variableName)
  const cached = modelOptionMapCache.get(cacheKey)
  if (cached) return cached
  const expression = parseExpression(normalizedSource, variableName)
  assertObjectResultExpression(expression)
  const program: ModelOptionMapProgram = Object.freeze({
    source: normalizedSource,
    evaluate(input: RestrictedCelValue): JsonObject {
      const result = evaluateRestrictedCel(expression, input)
      if (!isJsonObject(result)) throw new RestrictedCelError('model option map must return a JSON object', 0)
      return result
    },
  })
  modelOptionMapCache.set(cacheKey, program)
  return program
}

function normalizeSource(source: string): string {
  const normalizedSource = source.trim()
  if (normalizedSource.length === 0) throw new RestrictedCelError('expression must not be empty', 0)
  return normalizedSource
}

function parseExpression(source: string, variableName: ModelOptionName): RestrictedCelExpression {
  const cacheKey = createCacheKey(source, variableName)
  const cached = expressionCache.get(cacheKey)
  if (cached) return cached
  const expression = parseRestrictedCel(tokenizeRestrictedCel(source), variableName)
  expressionCache.set(cacheKey, expression)
  return expression
}

function createCacheKey(source: string, variableName: ModelOptionName): string {
  return `${variableName}\0${source}`
}

function assertObjectResultExpression(expression: RestrictedCelExpression): void {
  if (expression.type === 'object') return
  if (expression.type === 'conditional') {
    assertObjectResultExpression(expression.whenTrue)
    assertObjectResultExpression(expression.whenFalse)
    return
  }
  throw new RestrictedCelError('model option map must return a JSON object', expression.offset)
}

export interface NamedJsonMergePatch {
  readonly option: string
  readonly patch: JsonObject
}

interface OwnedPath {
  readonly option: string
  readonly path: readonly string[]
}

export function applyOrderedJsonMergePatches(
  body: JsonObject,
  patches: readonly NamedJsonMergePatch[],
): JsonObject {
  const ownedPaths: OwnedPath[] = []
  let result = cloneJson(body) as JsonObject
  for (const namedPatch of patches) {
    const paths = collectWrittenPaths(namedPatch.patch)
    for (const path of paths) {
      const conflict = ownedPaths.find(owned => pathsOverlap(owned.path, path))
      if (conflict) {
        throw new ModelOptionMapError(
          `Model option maps write conflicting JSON path ${formatPath(path)}: ${conflict.option} and ${namedPatch.option}`,
        )
      }
      ownedPaths.push({ option: namedPatch.option, path })
    }
    result = mergeObject(result, namedPatch.patch)
  }
  return result
}

function collectWrittenPaths(patch: JsonObject, prefix: readonly string[] = []): readonly string[][] {
  const paths: string[][] = []
  for (const [key, value] of Object.entries(patch)) {
    const path = [...prefix, key]
    if (isJsonObject(value) && Object.keys(value).length > 0) paths.push(...collectWrittenPaths(value, path))
    else paths.push(path)
  }
  return paths
}

function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const sharedLength = Math.min(left.length, right.length)
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function formatPath(path: readonly string[]): string {
  return path.length === 0 ? '$' : `$.${path.join('.')}`
}

function mergeObject(target: JsonObject, patch: JsonObject): JsonObject {
  const result = cloneJson(target) as Record<string, JsonValue>
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete result[key]
      continue
    }
    if (isJsonObject(patchValue)) {
      const targetValue = result[key]
      result[key] = mergeObject(isJsonObject(targetValue) ? targetValue : {}, patchValue)
      continue
    }
    result[key] = cloneJson(patchValue)
  }
  return result
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (!isJsonObject(value)) return value
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJson(entry),
      writable: true,
    })
  }
  return result
}

export interface ModelOptionMapSpecs {
  readonly reasoningLevel: { readonly map: string }
  readonly maxOutputTokens: { readonly map: string }
}

export interface ModelOptionValues {
  readonly reasoningLevel: string
  readonly maxOutputTokens: number
}

export interface CompiledModelOptionMaps {
  apply(body: JsonObject, values: ModelOptionValues): JsonObject
}

/** Compile both option maps once; each request supplies the option values frozen for that turn. */
export function compileModelOptionMaps(specs: ModelOptionMapSpecs): CompiledModelOptionMaps {
  const reasoningLevel = compileModelOptionMap(specs.reasoningLevel.map, 'reasoningLevel')
  const maxOutputTokens = compileModelOptionMap(specs.maxOutputTokens.map, 'maxOutputTokens')
  return Object.freeze({
    apply(body: JsonObject, values: ModelOptionValues): JsonObject {
      const patches: NamedJsonMergePatch[] = []
      if (values.reasoningLevel === undefined) throw new ModelOptionMapError('reasoningLevel requires an effective value')
      patches.push(optionPatch('reasoningLevel', reasoningLevel, values.reasoningLevel))
      patches.push(optionPatch('maxOutputTokens', maxOutputTokens, values.maxOutputTokens))
      return applyOrderedJsonMergePatches(body, patches)
    },
  })
}

function optionPatch(
  option: string,
  program: ModelOptionMapProgram,
  value: string | number,
): NamedJsonMergePatch {
  return { option, patch: program.evaluate(value) }
}
