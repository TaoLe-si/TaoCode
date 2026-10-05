// 调试侧「集合/内存」的纯逻辑：事件列表与按需快照的合并规则、内存字节的十六进制/ASCII 布局、
// 能力位的说明文案。全部是纯函数（不 import bridge 的 reactive），`tests/dap-*.test.mjs` 直接测。
//
// 为什么单独成文件：这三件事都有"口径"要定（谁覆盖谁、地址不认识时不造地址、能力不支持时
// 写清原因），而 DebugPanel.vue 是渲染层且贴着机检上限（900 行）—— 规则不该埋在模板旁边。

import { fromBase64 } from './base64.ts'
import type { DapLoadedSource, DapLoadedSourceItem, DapModule, DapModuleItem } from './bridge'

/** 与 bridge 的 `loadedSource` 事件同一条身份规则：reference → path → name，先有者胜。
 *  三者都没有的条目没有身份，调用方应当丢弃它（`null`）。 */
export function loadedSourceKey(name: string, path: string, sourceReference: number): string | null {
  if (sourceReference > 0) return `ref:${sourceReference}`
  if (path) return `path:${path}`
  if (name) return `name:${name}`
  return null
}

/** `loadedSources` 响应 → 事件列表的行。没有身份的条目丢弃（显示不了也定位不了）。 */
export function loadedSourceRows(snapshot: DapLoadedSourceItem[] | undefined): DapLoadedSource[] {
  const rows: DapLoadedSource[] = []
  for (const item of snapshot ?? []) {
    if (!item || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name : ''
    const path = typeof item.path === 'string' ? item.path : ''
    const reference = typeof item.sourceReference === 'number' && Number.isFinite(item.sourceReference) ? Math.trunc(item.sourceReference) : 0
    const key = loadedSourceKey(name, path, reference)
    if (!key) continue
    const row: DapLoadedSource = { key, name }
    if (reference > 0) row.sourceReference = reference
    if (path) row.path = path
    rows.push(row)
  }
  return rows
}

/** 快照合并：按身份覆盖已有行、追加新行；**不在快照里的旧行保留**（事件可能刚推过一条，
 *  它不在这一次响应里不代表它没了 —— 删除只由 `removed` 事件表达）。
 *  匹配不能只看 key：事件可能只带了 path，而快照同时给了 sourceReference（key 变了）——
 *  逐个字段比对（reference / path / name 任一相同即同一行），否则同一份源会出现两行。 */
export function mergeLoadedSourceSnapshot(existing: DapLoadedSource[], snapshot: DapLoadedSourceItem[] | undefined): DapLoadedSource[] {
  const merged = existing.map(row => ({ ...row }))
  for (const row of loadedSourceRows(snapshot)) {
    const found = merged.find(entry =>
      (entry.sourceReference !== undefined && row.sourceReference !== undefined && entry.sourceReference === row.sourceReference) ||
      (entry.path !== undefined && row.path !== undefined && entry.path === row.path) ||
      (entry.path === undefined && row.path === undefined && entry.name === row.name))
    if (found) Object.assign(found, row)
    else merged.push(row)
  }
  return merged
}

/** `modules` 响应 → 事件列表的行。`id`/`name` 是规范必填：缺一个的条目丢弃。 */
export function moduleRows(snapshot: DapModuleItem[] | undefined): DapModule[] {
  const rows: DapModule[] = []
  for (const item of snapshot ?? []) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'number' && Number.isFinite(item.id) ? String(Math.trunc(item.id))
      : typeof item.id === 'string' ? item.id : ''
    const name = typeof item.name === 'string' ? item.name : ''
    if (!id || !name) continue
    const row: DapModule = { id, name }
    for (const key of ['type', 'path', 'version', 'symbolStatus', 'addressRange', 'symbolFilePath', 'dateTimeStamp'] as const) {
      const value = item[key]
      if (typeof value === 'string' && value) row[key] = value
    }
    for (const key of ['isOptimized', 'isUserCode'] as const) {
      if (typeof item[key] === 'boolean') row[key] = item[key]
    }
    rows.push(row)
  }
  return rows
}

/** 与 loadedSources 同一条合并口径。 */
export function mergeModuleSnapshot(existing: DapModule[], snapshot: DapModuleItem[] | undefined): DapModule[] {
  const merged = existing.map(row => ({ ...row }))
  for (const row of moduleRows(snapshot)) {
    const found = merged.find(entry => entry.id === row.id)
    if (found) Object.assign(found, row)
    else merged.push(row)
  }
  return merged
}

/** 把重取到的快照原地合进响应式列表（`splice` 保持同一个 reactive 数组，渲染不用重挂）。 */
export function applyLoadedSourceSnapshot(existing: DapLoadedSource[], snapshot: DapLoadedSourceItem[] | undefined) {
  existing.splice(0, existing.length, ...mergeLoadedSourceSnapshot(existing, snapshot))
}

export function applyModuleSnapshot(existing: DapModule[], snapshot: DapModuleItem[] | undefined) {
  existing.splice(0, existing.length, ...mergeModuleSnapshot(existing, snapshot))
}

/** 内存行的基地址：认识 "0x…"（十六进制）与纯十进制；符号化的 reference（`&var`、`rbp-8`）
 *  返回 null —— 地址算不出来时行里不写地址，**不造一个假的**。 */
export function parseMemoryAddress(address: string | undefined): number | null {
  const text = typeof address === 'string' ? address.trim() : ''
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text.slice(2), 16)
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10)
  return null
}

export interface MemoryRow {
  /** 形如 `0x1000`；基地址不认识时是空串（不造地址）。 */
  address: string
  /** 每字节两位十六进制，空格分隔；不足一行时用空格补齐以便 ASCII 列对齐。 */
  hex: string
  /** 可打印 ASCII（0x20–0x7E）原样，其余为 `.`。 */
  ascii: string
}

/** base64 字节 → 16 字节一行的 hex+ASCII 表。空/坏数据返回空数组（调用方显示"没有数据"）。 */
export function memoryRows(dataB64: string | undefined, address?: string, perRow = 16): MemoryRow[] {
  if (!dataB64) return []
  let bytes: Uint8Array
  try { bytes = fromBase64(dataB64) } catch { return [] }
  const width = Number.isInteger(perRow) && perRow > 0 && perRow <= 64 ? perRow : 16
  const base = parseMemoryAddress(address)
  const rows: MemoryRow[] = []
  for (let offset = 0; offset < bytes.length; offset += width) {
    const slice = bytes.subarray(offset, offset + width)
    const hex: string[] = []
    let ascii = ''
    for (const byte of slice) {
      hex.push(byte.toString(16).padStart(2, '0'))
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
    }
    while (hex.length < width) hex.push('  ')
    rows.push({ address: base === null ? '' : `0x${(base + offset).toString(16)}`, hex: hex.join(' '), ascii })
  }
  return rows
}

/** 内存/反汇编/反向调试入口的能力位与"为什么不可用"的说明（面板禁用控件时显示它）。 */
export const DEBUG_CAPABILITY_LABELS: Record<string, string> = {
  supportsStepBack: '反向调试',
  supportsReadMemoryRequest: '内存查看',
  supportsDisassembleRequest: '反汇编查看',
  supportsLoadedSourcesRequest: '已加载源文件重取',
  supportsModulesRequest: '模块重取',
}

export function capabilityReason(capability: string): string {
  const what = DEBUG_CAPABILITY_LABELS[capability] ?? capability
  return `当前调试适配器未声明 ${capability}，${what}不可用。`
}
