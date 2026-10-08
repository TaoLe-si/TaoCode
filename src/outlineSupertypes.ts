// 「父类型 → 其成员」的三跳取数 —— 结构视图「继承成员」的数据来源（宿主侧那一半）。
//
// 上游坐标（判据全套在 `src/outlineInheritedMembers.ts` 文件头；这里只记取数那一半）：
//   · 上游这一跳由 PSI 直接给（`JavaInheritedMembersNodeProvider.java:36` 的 processDeclarations
//     沿父类型链 collect members）。本仓没有 PSI，唯一已核实的通道是 LSP 类型层级三跳：
//     `textDocument/prepareTypeHierarchy` → `typeHierarchy/supertypes` → 逐父 `documentSymbol`。
//   · 宿主转发已全通（native 真文件核过）：`native/lsp_session_kinds.cpp:196-206`（prepare，
//     回包走 `hier_items`）、`:210-240`（supertypes/subtypes，接受 shaped 条目或裸 item 读 `.raw`）；
//     条目形状见 `native/lsp_support.hpp:139-155`：`name`/`kind`/`path?`/`detail?`/`line?`/`character?`/`raw`。
//   · 同链路的现成参考实现：`src/navGotoSuper.ts` 的 `runGotoSuper`（prepare→supertypes→逐父 documentSymbol）。
//   · 父类型成员从它**所在文件的 documentSymbol** 里取：`typeHierarchy/supertypes` 给的是类型本身，
//     不是成员；对未打开的文件发 documentSymbol 是既有做法（`src/App.vue` 的 usage symbol 表同法）。
//
// 纯取数：不 import vue/DOM；`request` 由调用方注入（宿主传的是 `bridge.request`）。
// 任一跳失败/空 ⇒ **跳过该父类型**，不编数据；全空 ⇒ 返回空表（面板据此不画继承行）。

import type { DocumentData, LspDocumentSymbol, Method } from './bridge'
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'
import type { InheritedMember, SuperTypeMembers } from './outlineInheritedMembers.ts'
import { treeOf, type OutlineNode } from './outlineView.ts'
import { symbolContains } from './structureFollow.ts'

/** 注入的请求函数（宿主直接传 `bridge.request`；签名对齐它 —— `Method` 联合比 `string` 窄）。 */
export interface SuperTypeHierarchyRequest {
  <T = unknown>(method: Method, params: Record<string, unknown>): Promise<T>
}

/** `hier_items`（`native/lsp_support.hpp:157`）产出的条目形状。 */
export interface HierarchyItemShape {
  name: string
  kind?: number
  path?: string
  detail?: string
  line?: number
  character?: number
  raw?: unknown
}

interface HierarchyReply { available?: boolean; items?: HierarchyItemShape[] }
interface SymbolsReply { available?: boolean; symbols?: LspDocumentSymbol[] }

/** 该符号有没有画一行所需的完整区间（documentSymbol 可以只给名字与 kind）。 */
function hasFullRange(symbol: Partial<LspDocumentSymbol>): symbol is LspDocumentSymbol {
  return typeof symbol.startLine === 'number' && typeof symbol.startChar === 'number' &&
    typeof symbol.endLine === 'number' && typeof symbol.endChar === 'number'
}

/**
 * `LspDocumentSymbol[]` → `InheritedMember[]`（`outlineInheritedMembers.ts:72` 的形状）。
 * `detail` 为空串时不给该字段（模块里 `signatureKey`/`visibilityAccessLevel` 都以「取不到」为缺省）。
 */
export function toInheritedMembers(symbols: readonly LspDocumentSymbol[], path: string): InheritedMember[] {
  const out: InheritedMember[] = []
  for (const raw of symbols as readonly Partial<LspDocumentSymbol>[]) {
    if (!hasFullRange(raw)) continue
    const member: InheritedMember = {
      name: raw.name, kind: raw.kind, path,
      startLine: raw.startLine, startChar: raw.startChar, endLine: raw.endLine, endChar: raw.endChar,
    }
    if (raw.detail) member.detail = raw.detail
    out.push(member)
  }
  return out
}

function flattenNodes(nodes: readonly OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = []
  const walk = (list: readonly OutlineNode[]) => { for (const node of list) { out.push(node); walk(node.children) } }
  walk(nodes)
  return out
}

/**
 * 在父类型所在文件的符号表里找「那条层级条目说的是哪个类型」：
 * 先按名字精确匹配类符号（`CLASS_LIKE_SYMBOL_KINDS`，`src/lspSymbolBridge.ts:58`），
 * 名字对不上时退回「区间包含条目给的 selectionRange 起点」（`symbolContains`，`structureFollow.ts:75`）。
 */
function ownerSymbolIn(symbols: readonly LspDocumentSymbol[], parent: HierarchyItemShape): LspDocumentSymbol | null {
  const flat = flattenNodes(treeOf(symbols)).map(node => node.symbol)
  const named = flat.find(symbol => symbol.name === parent.name && CLASS_LIKE_SYMBOL_KINDS.has(symbol.kind))
  if (named) return named
  if (parent.line === undefined) return null
  return flat.find(symbol => symbolContains(symbol, parent.line!, parent.character ?? 0)) ?? null
}

/** 一个父类型的成员：它自己那一档的**直接子节点**（与「自己的成员」同一层级口径）。
 *
 *  **按需打开**（2026-10-07 真机取证 root cause）：语言服务对**没 open 过的文件**的
 *  `documentSymbol` 回 `available:false`（Base.java 打开前 `sup=[]`，打开后成员齐全）。
 *  所以第一次问不到时按编辑器的打开流程补一次：`file.read` 取文本 → `lsp.open` 登记 →
 *  重问一次。**不**在问完 `lsp.close`：编辑器读过符号的文档留着是常态（find usages 的
 *  结果文件同样如此），关了会和别的消费者抢同一份 didOpen 账。
 */
async function membersOfParent(request: SuperTypeHierarchyRequest, parent: HierarchyItemShape,
                               path: string): Promise<InheritedMember[] | null> {
  const symbols = await documentSymbolsOf(request, path)
  if (symbols === null) return null
  const owner = ownerSymbolIn(symbols, parent)
  if (!owner) return null
  const node = flattenNodes(treeOf(symbols)).find(candidate => candidate.symbol === owner)
  if (!node) return null
  return toInheritedMembers(node.children.map(child => child.symbol), path)
}

/** 问一个文件的符号表；答不到就按需打开（`file.read` + `lsp.open`）后再问一次。 */
async function documentSymbolsOf(request: SuperTypeHierarchyRequest, path: string): Promise<LspDocumentSymbol[] | null> {
  const first = await askDocumentSymbol(request, path)
  if (first !== null) return first
  try {
    const document = await request<DocumentData>('file.read', { path })
    await request('lsp.open', { path, text: document.content })
  } catch { return null }
  return askDocumentSymbol(request, path)
}

/** 单次 documentSymbol：`available:false`/抛错/全空都给 `null`（调用方决定要不要补开）。 */
async function askDocumentSymbol(request: SuperTypeHierarchyRequest, path: string): Promise<LspDocumentSymbol[] | null> {
  try {
    const replied = await request<SymbolsReply>('lsp.request', { kind: 'documentSymbol', path })
    if (replied.available === false) return null
    const symbols = (replied.symbols ?? []).filter(hasFullRange)
    return symbols.length ? symbols : null
  } catch { return null }
}

/**
 * 三跳取回「父类型 → 其成员」表（顺序 = 服务器给 supertypes 的顺序：父类在前、接口在后，
 * **照抄不重排** —— `outlineInheritedMembers.ts:244` 的 `superTypes` 约定「由近到远」依赖它）。
 *
 * 逐跳的失败语义（都不抛给调用方）：
 *   · prepare 失败/无条目 ⇒ `[]`（`runGotoSuper` 同款：拿不到根条目就无处可问）；
 *   · supertypes 失败/空 ⇒ `[]`；
 *   · 某父类型没有 `path`（库里的类型没有工作区文件）⇒ 只跳过它；
 *   · 父类型文件没被 open 过（`documentSymbol` 回 `available:false`）⇒ 按需 `file.read`+`lsp.open`
 *     补一次再问（见 `membersOfParent`）；补不上才跳过。
 */
export async function fetchSuperTypeMembers(request: SuperTypeHierarchyRequest, path: string,
                                            classSymbol: LspDocumentSymbol): Promise<SuperTypeMembers[]> {
  let root: HierarchyItemShape | undefined
  try {
    const prepared = await request<HierarchyReply>('lsp.request', {
      kind: 'prepareTypeHierarchy', path, line: classSymbol.startLine, character: classSymbol.startChar ?? 0,
    })
    root = prepared.items?.[0]
  } catch { return [] }
  if (!root) return []

  let parents: HierarchyItemShape[] = []
  try {
    const replied = await request<HierarchyReply>('lsp.request', { kind: 'typeHierarchySupertypes', path, item: root })
    parents = replied.items ?? []
  } catch { return [] }

  const out: SuperTypeMembers[] = []
  for (const parent of parents) {
    if (!parent.path) continue
    const members = await membersOfParent(request, parent, parent.path)
    if (members === null) continue
    const entry: SuperTypeMembers = { name: parent.name, members }
    if (parent.detail) entry.detail = parent.detail
    out.push(entry)
  }
  return out
}
