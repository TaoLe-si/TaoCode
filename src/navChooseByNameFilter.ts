// 「转到符号 / 转到类」弹层的**按类型过滤**（`lp/navigation` 判词里那条 `ChooseByNameFilter`）。
//
// 上游依据（逐条）：
//   · `platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilter.java:82-95` ——
//     过滤条挂在弹层右上角（`:95` `popup.setToolArea(myToolbar.getComponent())`，工具条在 `:87` 建），
//     它的开关动作 `isActive()`（`:82-84`）=
//     `!filterConfiguration.getState().getFilteredOutFileTypeNames().isEmpty()`：
//     **只要有被排除的类别，按钮就点亮**；一个都没排除时按钮是灭的。
//   · 同文件 `:101-117` —— 过滤面板 = 一个多选清单 + 三个按钮：
//     All（`setAllElementsMarked(true)`，`:107`）/ None（`setAllElementsMarked(false)`，`:110`）/
//     Invert（`invertSelection()`，`:113`）；按钮文案在
//     `platform/lang-api/resources/messages/LangBundle.properties:372-374`
//     （`label.all=All` / `label.none=None` / `label.invert=Invert`）。
//   · `platform/lang-impl/src/com/intellij/ide/util/gotoByName/FilteringGotoByModel.java:45-52` ——
//     条目接受规则：`filterValueFor(item)`（`:54`）取不到值就**一律接受**；取得到值时，
//     只有"没有设过过滤集合"或"该值在集合里"才接受。
//   · `platform/lang-impl/src/com/intellij/ide/util/gotoByName/ChooseByNameFilterConfiguration.java` ——
//     过滤状态是**持久化**的（存 `getFilteredOutFileTypeNames()`，下次打开同一个弹层还在）。
//   · `platform/lsp-impl/src/impl/features/workspaceSymbol/LspWorkspaceSymbolContributor.kt:69`
//     `shouldAcceptSymbolKind(symbolKind)` —— LSP 这一族本来就是**按 SymbolKind 决定收不收**，
//     所以本仓的过滤维度取 SymbolKind 分组（`:86` 那一条 `!shouldAcceptSymbolKind(symbol.kind)` 就丢弃）。
//
// 架构不等价处（如实记）：上游的过滤值是 `FileType`/`LanguageRef`/`SymbolKind` 三种 provider 各给一套
// （`ChooseByNameLanguageFilter.java:28-30` 给的是语言），并按扩展点装配；本仓没有 EP 宿主，
// 符号的唯一来源是 LSP `workspace/symbol`，所以**只有 SymbolKind 这一档**，分组表见
// `SYMBOL_FILTER_GROUPS`。分组的具体切法（哪些 kind 归"类"、哪些归"方法"）是**本仓自定**，
// 但「类」那一档直接复用上游 `LspGoToClassContributor` 的四类（见 `src/lspSymbolBridge.ts`，
// 与 Ctrl+N 的口径一致）；「全部类型都算一项」「排除态持久化」「All/None/Invert 三钮」
// 这三条形状是上游给的。
//
// 消费链路（不是死模块）：
//   · 规则 → `src/lspNavigation.ts` 的 `globalSymbolEntries` / `fileSymbolEntries`（结果按隐藏类别过滤）；
//   · 开关 UI → `src/menus/navigateMenu.ts` 的「按类型过滤」子菜单（真能勾、真改结果）；
//   · 判据 → `tests/nav-choose-by-name-filter.test.mjs`。
import { ref, watch } from 'vue'
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'

/** 一个过滤类别：id 用于持久化，kinds 是它覆盖的 LSP `SymbolKind` 编号。 */
export interface SymbolFilterGroup {
  id: string
  /** 菜单文案（本仓界面是中文）。 */
  label: string
  /** 覆盖的 kind；`null` = 兜底档（其余全部），与上游 `acceptItem` 的"取不到值就接受"同效。 */
  kinds: readonly number[] | null
}

/** 「类」那一档 = 上游 `LspGoToClassContributor` 的四类（Class 5 / Enum 10 / Interface 11 / Struct 23），
 *  与 Ctrl+N 走同一份常量（`src/lspSymbolBridge.ts:58`），不再各写一份。 */
export const CLASS_GROUP_KINDS: readonly number[] = [...CLASS_LIKE_SYMBOL_KINDS].sort((left, right) => left - right)

/**
 * 分组表（顺序 = 菜单里的顺序）。kind 编号取 LSP `SymbolKind`（本仓的名字表在
 * `src/lspSymbolBridge.ts:50-55`）：1 File、2 Module、3 Namespace、4 Package、5 Class、6 Method、
 * 7 Property、8 Field、9 Constructor、10 Enum、11 Interface、12 Function、13 Variable、14 Constant、
 * 15 String、16 Number、17 Boolean、18 Array、19 Object、20 Key、21 Null、22 EnumMember、23 Struct、
 * 24 Event、25 Operator、26 TypeParameter。
 * 「其它」是 `kinds: null` 的兜底档（上游 `FilteringGotoByModel.acceptItem:48-51`：
 * 取不到过滤值的条目一律接受，所以剩下的 kind 全归这一档，不会出现"哪一档都不收"的黑洞）。
 */
export const SYMBOL_FILTER_GROUPS: readonly SymbolFilterGroup[] = [
  { id: 'class', label: '类 / 接口 / 枚举', kinds: CLASS_GROUP_KINDS },
  { id: 'method', label: '方法 / 函数', kinds: [6, 9, 12] },
  { id: 'field', label: '字段 / 变量 / 常量', kinds: [7, 8, 13, 14, 22, 24] },
  { id: 'other', label: '其它（文件 / 模块 / 包）', kinds: null },
]

/** 分组 id 的清单（All/None/Invert 要在完整集合上做补集）。 */
export const SYMBOL_FILTER_GROUP_IDS: readonly string[] = SYMBOL_FILTER_GROUPS.map(group => group.id)

/** `filterValueFor(item)`（上游 `FilteringGotoByModel` 抽象方法）：kind → 分组 id。 */
export function filterGroupOfKind(kind: number | undefined): string {
  const numeric = typeof kind === 'number' && Number.isFinite(kind) ? kind : Number.NaN
  const matched = SYMBOL_FILTER_GROUPS.find(group => (group.kinds ?? []).includes(numeric))
  return matched ? matched.id : 'other'
}

/**
 * `FilteringGotoByModel.acceptItem:44-52` 的形态：`visible` 为 `null`（没设过过滤）时全收；
 * 否则只收在集合里的分组。本仓的界面状态存的是**被排除**的类别（与上游
 * `getFilteredOutFileTypeNames()` 同构），`visibleGroupsOf` 负责换算。
 */
export function visibleGroupsOf(hidden: readonly string[]): readonly string[] {
  return SYMBOL_FILTER_GROUP_IDS.filter(id => !hidden.includes(id))
}

/** `acceptItem`：某条 kind 在当前排除集合下要不要留下。 */
export function acceptSymbolKind(kind: number | undefined, hidden: readonly string[]): boolean {
  return !hidden.includes(filterGroupOfKind(kind))
}

/** 按当前排除集合过滤一批条目（保持原顺序；不认识的 kind 落 'other' 档）。 */
export function filterSymbols<T extends { kind?: number }>(items: readonly T[], hidden: readonly string[]): T[] {
  if (!hidden.length) return [...items]
  return items.filter(item => acceptSymbolKind(item.kind, hidden))
}

/** `ChooseByNameFilter.java:80-85`：过滤按钮的点亮条件 = 存在被排除的类别。 */
export function filterActionActive(hidden: readonly string[]): boolean {
  return hidden.length > 0
}

/** All（`:107` `setAllElementsMarked(true)`）：全入选中 = 没有任何类别被排除。 */
export function hiddenAfterAll(): string[] {
  return []
}

/** None（`:110` `setAllElementsMarked(false)`）：全不选中 = 所有类别都被排除。 */
export function hiddenAfterNone(): string[] {
  return [...SYMBOL_FILTER_GROUP_IDS]
}

/** Invert（`:113` `invertSelection()`）：排除集合取**补集** —— 原先勾着的变成被排除，反之亦然。 */
export function invertHidden(hidden: readonly string[]): string[] {
  return SYMBOL_FILTER_GROUP_IDS.filter(id => !hidden.includes(id))
}

/** 单条勾选（清单里的一行）。 */
export function toggleHiddenGroup(hidden: readonly string[], id: string): string[] {
  if (!SYMBOL_FILTER_GROUP_IDS.includes(id)) return [...hidden]
  return hidden.includes(id) ? hidden.filter(one => one !== id) : [...hidden, id]
}

/**
 * 「全部类别都被排除」= 弹层一定是空的。上游的 None 钮（`ChooseByNameFilter.java:110`
 * `setAllElementsMarked(false)`）确实能把清单清成空，所以这不是要拦的写坏状态；
 * 本仓用它做**菜单标题的措辞**（`src/menus/navigateMenu.ts` 的 `gotoFilterTitle`：
 * 「按类型过滤（已排除全部类别）」比列出一串类别名更直白）。
 */
export function isDegenerateHidden(hidden: readonly string[]): boolean {
  return hidden.length >= SYMBOL_FILTER_GROUP_IDS.length
}

/** 持久化键（上游那份存在 `filter.xml`，本仓存 localStorage，与引用视图那两个开关同一条纪律）。 */
export const SYMBOL_FILTER_STORAGE_KEY = 'taocode.gotoSymbolFilter'

/**
 * 读回排除集合：只认字符串数组里的已知 id，重复去掉；整体不是数组就当"没过滤"。
 * 与 `referenceContents.ts` 的读法同一条：**坏数据退回默认，不判成损坏**。
 */
export function readHiddenGroups(raw: string | null | undefined): string[] {
  let parsed: unknown
  try { parsed = raw ? JSON.parse(raw) : null } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string' || !SYMBOL_FILTER_GROUP_IDS.includes(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

function readStoredGroups(): string[] {
  try { return readHiddenGroups(localStorage.getItem(SYMBOL_FILTER_STORAGE_KEY)) } catch { return [] }
}
function persistGroups(hidden: readonly string[]) {
  try { localStorage.setItem(SYMBOL_FILTER_STORAGE_KEY, JSON.stringify([...hidden])) } catch { /* 存储不可用：本次会话内仍然生效 */ }
}

/** 界面态（菜单与 `lspNavigation` 读同一份；判据里直接改 `.value`）。 */
export const hiddenSymbolGroups = ref<string[]>(readStoredGroups())
watch(hiddenSymbolGroups, value => persistGroups(value))

/** 菜单/弹层用的呈现：每个分组的 { id, label, visible }。 */
export function symbolFilterRows(hidden: readonly string[] = hiddenSymbolGroups.value) {
  return SYMBOL_FILTER_GROUPS.map(group => ({ id: group.id, label: group.label, visible: !hidden.includes(group.id) }))
}
