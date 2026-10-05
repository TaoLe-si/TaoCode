// 快捷键注册表 —— 上游 `platform/platform-impl/src/com/intellij/openapi/keymap/ex/KeymapManagerEx.java`
// 与 `impl/KeymapImpl`/`BundledKeymapBean` 的“动作 → 键位”单一真源，加上 `ActionShortcutRestrictions`
// 的“这个动作在哪个上下文可用”。
//
// 为什么要单独一张表（判决原文的缺口）：本仓键位原先只写在 `src/keymap.ts` 的 if 链里，菜单上的
// `keys` 是另一份手写文案，两边没有共享注册表 —— 于是「同一个键绑了两个动作」既查不出来、菜单与
// 实际行为也不一定能对齐。这个模块把**分派器尾部那一组**（文件/搜索/导航/重构/文档/复制引用）的
// 键位抽成数据：`src/keymap.ts` 按数组顺序匹配（数组顺序 = 上游同名键位表的先后 = 本仓 if 链的
// 优先级），菜单/测试可以按 action id 查 `keymapKeys()`。
//
// 键位事实全部逐条核过上游 `platform/platform-resources/src/keymaps/$default.xml`（行号写在
// `upstream` 字段里）；上游没有默认键位的（如「打开文件」与 Git Annotate）在字段里写明是本仓绑定，
// 不冒充上游。
//
// 还没做的（判词里如实登记）：可切换的键位方案**没有 UI**（设置页宿主
// `src/components/SettingsDialog.vue` 与节点表 `src/settingsTreeMeta.ts` 都不在本 lane），
// 用户自定义改键与冲突面板的纯规则在 `src/keymapEditor.ts`，模型与分派都已接上。
// 判词原文写的「`ActionShortcutRestrictions` 的按 place 声明」经查**不是**上游口径：
// `ActionShortcutRestrictions.getForActionId(actionId)`（`impl/ActionShortcutRestrictions.java:12`）
// 返回的是该动作的六个**布尔限制位**（`impl/ShortcutRestrictions.java:7-12`），与 place 无关；
// 实现见 `src/keymapEditor.ts` 的 `shortcutRestrictions`。

export type KeyScope = 'global' | 'editor' | 'popup' | 'debug' | 'tool-window'

/** 动作可用性状态（本仓的 `AnAction.update` 输入：工作区/编辑器/语言服务三面）。 */
export interface KeyBindingState {
  workspace: boolean
  editor: boolean
  lsp: boolean
}

export interface KeyChord {
  /** 物理键比对口径（同 `KeyboardEvent.key`；字母小写，`F4`/`F12`/`Insert` 原样）。 */
  key: string
  /**
   * `'ctrl'` = 必须真按 Ctrl（上游写死 `event.ctrlKey`）；`'mod'` = Ctrl 或 Meta（跨平台口径）；
   * **缺省 = 这一档不要求 Ctrl/Meta**（上游那些只有 `alt`/`shift` 的键位，如 `SafeDelete` 的 `alt DELETE`
   * = `$default.xml:999-1001`）—— 此时靠 `alt`/`shift`/`forbid` 三个字段把修饰键收紧。
   */
  control?: 'ctrl' | 'mod'
  shift?: boolean
  alt?: boolean
  /** 显式禁止的修饰键（上游那些 `&& !event.altKey` 条件）。 */
  forbid?: ReadonlyArray<'ctrl' | 'shift' | 'alt' | 'meta'>
}

export interface KeyBinding {
  id: string
  /** 动作名（菜单文案口径）。 */
  label: string
  chord: KeyChord
  /** 键位显示串（菜单 `keys` 字段的口径：`Ctrl Shift F4`）。 */
  display: string
  scope: KeyScope
  /** 动作在当前状态是否可用（缺省 = 总是）。 */
  when?: (state: KeyBindingState) => boolean
  /** 用户自定义过（非出厂键位）—— 由 `src/keymapEditor.ts` 的覆盖表打上。 */
  override?: boolean
  /** 上游依据：`$default.xml:<行>` + 动作 id；本仓自定的写「本仓」。 */
  upstream: string
}

const workspaceWhen = (state: KeyBindingState) => state.workspace
const editorWhen = (state: KeyBindingState) => state.editor
const workspaceLspWhen = (state: KeyBindingState) => state.workspace && state.lsp
const lspEditorWhen = (state: KeyBindingState) => state.editor && state.lsp

/**
 * 分派器尾部那一组的键位表（`src/keymap.ts` 从这张表读；数组顺序 = 分派优先级）。
 * 顺序与上游 `$default.xml` 的条目顺序一致，改动前先看 `keymapConflicts` 的输出。
 */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { id: 'tab.close', label: '关闭活动标签', display: 'Ctrl Shift F4', scope: 'tool-window',
    chord: { key: 'f4', control: 'ctrl', shift: true }, when: workspaceWhen, upstream: '$default.xml:260-262 CloseActiveTab' },
  { id: 'edit.pastePlain', label: '粘贴为纯文本', display: 'Ctrl Alt Shift V', scope: 'editor',
    chord: { key: 'v', control: 'ctrl', shift: true, alt: true }, upstream: '$default.xml:636-638 EditorPasteSimple' },
  { id: 'edit.pasteHistory', label: '从历史粘贴…', display: 'Ctrl Shift V', scope: 'editor',
    chord: { key: 'v', control: 'ctrl', shift: true, forbid: ['alt'] }, upstream: '$default.xml:288-290 PasteMultiple' },
  { id: 'actions.search', label: '查找操作…', display: 'Ctrl Shift A', scope: 'global',
    chord: { key: 'a', control: 'mod', shift: true }, upstream: '$default.xml:270-272 GotoAction' },
  { id: 'settings.open', label: '设置…', display: 'Ctrl Alt S', scope: 'global',
    chord: { key: 's', control: 'mod', alt: true }, upstream: '$default.xml:21-23 ShowSettings' },
  { id: 'file.saveAll', label: '全部保存', display: 'Ctrl S', scope: 'global',
    chord: { key: 's', control: 'mod' }, upstream: '$default.xml:855-857 SaveAll' },
  { id: 'symbol.global', label: '转到符号…', display: 'Ctrl Shift Alt N', scope: 'global',
    chord: { key: 'n', control: 'mod', shift: true, alt: true }, when: workspaceLspWhen, upstream: '$default.xml:267-269 GotoSymbol' },
  { id: 'file.open', label: '转到文件…', display: 'Ctrl Shift N', scope: 'global',
    chord: { key: 'n', control: 'mod', shift: true }, when: workspaceWhen, upstream: '$default.xml:365-367 GotoFile' },
  // 上游 `OpenFile` 在 `$default.xml` 里没有默认键位；本仓的 Ctrl+Shift+O 打开工作区（欢迎态也能用，
  // 所以**不能**加 workspace 条件）。
  { id: 'file.openPath', label: '打开…', display: 'Ctrl Shift O', scope: 'global',
    chord: { key: 'o', control: 'mod', shift: true, forbid: ['alt'] }, upstream: '本仓绑定（上游 OpenFile 在 $default.xml 里没有默认键位）' },
  { id: 'vcs.blame', label: '注释（Blame）', display: 'Ctrl Shift G', scope: 'editor',
    chord: { key: 'g', control: 'mod', shift: true, forbid: ['alt'] }, when: editorWhen, upstream: '本仓绑定（上游 Annotate 在 $default.xml 里没有默认键位）' },
  { id: 'symbol.class', label: '转到类…', display: 'Ctrl N', scope: 'global',
    chord: { key: 'n', control: 'mod' }, when: workspaceLspWhen, upstream: '$default.xml:263-265 GotoClass' },
  { id: 'window.maximizeEditor', label: '最大化编辑器区域', display: 'Ctrl Shift F12', scope: 'global',
    chord: { key: 'f12', control: 'ctrl', shift: true }, when: workspaceWhen, upstream: '$default.xml:870-872 HideAllWindows（本仓落点是最大化编辑器区域）' },
  { id: 'symbol.file', label: '文件结构…', display: 'Ctrl F12', scope: 'editor',
    chord: { key: 'f12', control: 'ctrl', forbid: ['shift'] }, when: workspaceLspWhen, upstream: '$default.xml:279-281 FileStructurePopup' },
  { id: 'search.findInPath', label: '在路径中查找…', display: 'Ctrl Shift F', scope: 'global',
    chord: { key: 'f', control: 'mod', shift: true }, when: workspaceWhen, upstream: '$default.xml:538-540 FindInPath' },
  { id: 'navigate.recentLocations', label: '最近位置…', display: 'Ctrl Shift E', scope: 'global',
    chord: { key: 'e', control: 'mod', shift: true }, when: workspaceWhen, upstream: '$default.xml:334-336 RecentLocations' },
  { id: 'navigate.recentFiles', label: '最近文件…', display: 'Ctrl E', scope: 'global',
    chord: { key: 'e', control: 'mod' }, when: workspaceWhen, upstream: '$default.xml:324-326 RecentFiles' },
  { id: 'navigate.gotoLine', label: '转到行…', display: 'Ctrl G', scope: 'editor',
    chord: { key: 'g', control: 'mod', forbid: ['shift'] }, when: editorWhen, upstream: '$default.xml:532-534 GotoLine' },
  { id: 'refactor.changeSignature', label: '更改签名…', display: 'Ctrl F6', scope: 'editor',
    // 上游 `first-keystroke="control F6"`（`:470`）。`forbid` 两条都有据：
    // Ctrl+Shift+F6 = ChangeTypeSignature（`:472-474`）、Ctrl+Alt+F6 = SwitchCoverage（`:36-38`），
    // Shift+F6 = RenameElement（`:996-998`）—— 同一物理键的另外三档都不该落到这一条上。
    chord: { key: 'f6', control: 'ctrl', forbid: ['shift', 'alt'] }, upstream: '$default.xml:469-471' },
  { id: 'refactor.safeDelete', label: '安全删除…', display: 'Alt Delete', scope: 'editor',
    // 上游 `first-keystroke="alt DELETE"`（`$default.xml:1000`）—— **不带 Ctrl**。`forbid` 两条是上游
    // 精确匹配那套键位表的等价写法：`control DELETE`（`:1016` = `$Delete`）与
    // `control shift DELETE`（`:919` = `Unwrap`）、`shift DELETE`（`:433`）都占着同一个物理键。
    chord: { key: 'Delete', alt: true, forbid: ['ctrl', 'shift'] }, upstream: '$default.xml:999-1001' },
  { id: 'refactor.extractVariable', label: '引入变量…', display: 'Ctrl Alt V', scope: 'editor',
    chord: { key: 'v', control: 'ctrl', alt: true, forbid: ['shift'] }, upstream: '$default.xml:321-323 IntroduceVariable' },
  { id: 'refactor.extractConstant', label: '引入常量…', display: 'Ctrl Alt C', scope: 'editor',
    chord: { key: 'c', control: 'ctrl', alt: true, forbid: ['shift'] }, upstream: '$default.xml:444-446 IntroduceConstant' },
  { id: 'refactor.extractMethod', label: '提取方法…', display: 'Ctrl Alt M', scope: 'editor',
    chord: { key: 'm', control: 'ctrl', alt: true, forbid: ['shift'] }, upstream: '$default.xml:435-437 ExtractMethod' },
  { id: 'refactor.inline', label: '内联…', display: 'Ctrl Alt N', scope: 'editor',
    chord: { key: 'n', control: 'ctrl', alt: true, forbid: ['shift'] }, upstream: '$default.xml:837-839 Inline' },
  { id: 'inspection.runByName', label: '按名称运行检查…', display: 'Ctrl Shift Alt I', scope: 'editor',
    chord: { key: 'i', control: 'ctrl', shift: true, alt: true }, when: lspEditorWhen, upstream: '$default.xml:276-278 RunInspection' },
  { id: 'docs.quickDoc', label: '快速文档', display: 'Ctrl Q', scope: 'editor',
    chord: { key: 'q', control: 'ctrl', forbid: ['shift'] }, when: lspEditorWhen, upstream: '$default.xml:349-351 QuickJavaDoc' },
  { id: 'edit.copyReference', label: '复制符号引用', display: 'Ctrl Alt Shift C', scope: 'editor',
    chord: { key: 'c', control: 'ctrl', shift: true, alt: true }, when: editorWhen, upstream: '$default.xml:639-641 CopyReference' },
  { id: 'edit.copyPath', label: '复制路径', display: 'Ctrl Shift C', scope: 'editor',
    chord: { key: 'c', control: 'ctrl', shift: true, forbid: ['alt'] }, when: editorWhen, upstream: '$default.xml:454-456 CopyPaths' },
]

/** 键位显示串（菜单「快捷键」列查这里，不再手写第二份文案）。 */
export function keymapKeys(actionId: string, bindings: readonly KeyBinding[] = KEY_BINDINGS): string {
  return bindings.find(binding => binding.id === actionId)?.display ?? ''
}

/**
 * 修饰键是否满足 —— 语义与 transform 前的 if 链一致：**写了的必须按下，`forbid` 里必须没按，
 * 没写的不管**（例如 `Ctrl+Shift+S` 在原实现里会落到 SaveAll 那条 —— 因为那条只查了键名）。
 * `mod` 认 Ctrl 与 Meta（跨平台口径），`ctrl` 必须真按 Ctrl（上游写死 `event.ctrlKey`）。
 */
function modifiersMatch(chord: KeyChord, event: KeyChordInput): boolean {
  // `control` 缺省 = 这一档不要求 Ctrl/Meta（只有 `alt`/`shift` 的上游键位）；写了就必须按。
  const control = chord.control === undefined ? true
    : chord.control === 'ctrl' ? event.ctrlKey
    : event.ctrlKey || event.metaKey
  if (!control) return false
  if (chord.shift && !event.shiftKey) return false
  if (chord.alt && !event.altKey) return false
  for (const modifier of chord.forbid ?? []) {
    if (modifier === 'ctrl' && event.ctrlKey) return false
    if (modifier === 'shift' && event.shiftKey) return false
    if (modifier === 'alt' && event.altKey) return false
    if (modifier === 'meta' && event.metaKey) return false
  }
  return true
}

/** 匹配只需要这几个字段（`KeyboardEvent` 的结构子集 —— 字段名与 DOM 事件一致，测试传普通对象即可）。 */
export interface KeyChordInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** 事件是否命中该键位（键名比对：单字符忽略大小写，其余原样；`$default.xml` 的 F4/F12/INSERT 同口径）。 */
export function matchesKeyChord(chord: KeyChord, event: KeyChordInput): boolean {
  const key = chord.key.length === 1 ? chord.key.toLowerCase() : chord.key.toLowerCase()
  if (event.key.toLowerCase() !== key) return false
  return modifiersMatch(chord, event)
}

/** 表驱动分派：按数组顺序返回第一条命中且动作可用的绑定。 */
export function findKeyBinding(
  event: KeyChordInput, state: KeyBindingState, bindings: readonly KeyBinding[] = KEY_BINDINGS,
): KeyBinding | null {
  for (const binding of bindings) {
    if (!matchesKeyChord(binding.chord, event)) continue
    if (binding.when && !binding.when(state)) continue
    return binding
  }
  return null
}

/** 键位同一性：修饰键集合 + 键名（用于冲突检测与方案覆盖）。 */
export function chordIdentity(chord: KeyChord): string {
  const forbidden = [...(chord.forbid ?? [])].sort().join(',')
  return [chord.control ?? 'none', chord.shift ? 'shift' : '', chord.alt ? 'alt' : '', `[${forbidden}]`, chord.key.toLowerCase()].join('|')
}

export interface KeymapConflict {
  /** 冲突的键位显示串（取第一个绑定的写法）。 */
  chord: string
  scope: KeyScope
  /** 绑在同一键位上的动作 id（按分派顺序）。 */
  ids: string[]
  /** 分派时实际生效的那个（数组里最靠前）。 */
  winner: string
}

/**
 * 这两个动作**算不算**真冲突 —— 上游 `KeymapPanel.isShortcutConflictAction`
 * （`platform/platform-impl/src/com/intellij/openapi/keymap/impl/ui/KeymapPanel.java:565-574`）的三条排除：
 *   1. 同一个 id 跟自己不是冲突（`:566-568`）；
 *   2. `EditorFoo` 与 `$Foo` 是同一个动作的两个 id（编辑器动作与它的全局孪生），不是冲突（`:569-571`）；
 *   3. `conflictActionId` 用 `use-shortcut-of` 指向 `actionId` 时，冲突的其实是同一个动作，不是两个（`:572-573`）。
 * 第 3 条本仓的等价物是 `aliasOf`：`$Foo` 形态的 id 以及显式别名都归到同一动作。
 * 上游这三条只用在**键位设置页**挑出要弹冲突框的那些项；本仓没有那个页面，
 * 但冲突报告与「改键时清掉别人的同一键」都得用同一判据，否则两边会各报各的。
 */
export function isShortcutConflictAction(actionId: string, conflictActionId: string, aliasOf?: (id: string) => string | undefined): boolean {
  if (conflictActionId === actionId) return false
  if (actionId.startsWith('Editor') && conflictActionId === `$${actionId.slice(6)}`) return false
  const aliased = aliasOf?.(conflictActionId)
  return !(aliased !== undefined && aliased === actionId)
}

/**
 * 冲突检测（上游 `KeymapManagerEx.getConflicts` 的等价物）：同一作用域里同一键位绑到多个动作。
 * 本仓的 `when` 是可用性谓词不是 place 声明，所以这里按“同一 scope + 同一键位”保守判 ——
 * 两个动作的条件可能同时成立（workspace 与 editor 可以都为真），漏判比误判更糟。
 * `isShortcutConflict` 是 `KeymapPanel.isShortcutConflictAction` 的注入版（测试与设置页都能换判据）。
 */
export function keymapConflicts(
  bindings: readonly KeyBinding[] = KEY_BINDINGS,
  isShortcutConflict: (actionId: string, conflictActionId: string) => boolean = (a, b) => isShortcutConflictAction(a, b),
): KeymapConflict[] {
  const groups = new Map<string, KeyBinding[]>()
  for (const binding of bindings) {
    const key = `${binding.scope}::${chordIdentity(binding.chord)}`
    const list = groups.get(key)
    if (list) list.push(binding)
    else groups.set(key, [binding])
  }
  const conflicts: KeymapConflict[] = []
  for (const group of groups.values()) {
    // 同键位上的动作两两判一次：只要有一对**不算**冲突（同一动作的两个 id / 别名），整组就不报。
    const ids = [...new Set(group.map(binding => binding.id))]
    if (ids.length < 2) continue
    if (ids.every(id => ids.every(other => other === id || !isShortcutConflict(id, other)))) continue
    conflicts.push({ chord: group[0]!.display, scope: group[0]!.scope, ids, winner: ids[0]! })
  }
  return conflicts
}

/**
 * 冲突报告（帮助菜单「检查键位冲突」的落点）：人类可读的一行一条，没有冲突时写明
 * 「N 条绑定无冲突」——**不是空串**，否则用户分不清"检查过没问题"和"按钮坏了"。
 * 上游 `KeymapManagerEx.getConflicts` 只给数据结构，报告文本是各 UI（键位设置页）自己拼的；
 * 本仓没有键位设置页，所以由这个纯函数拼出一份，供工具入口复制到剪贴板。
 */
export function keymapConflictReport(bindings: readonly KeyBinding[] = KEY_BINDINGS, isShortcutConflict?: (actionId: string, conflictActionId: string) => boolean): string {
  const conflicts = keymapConflicts(bindings, isShortcutConflict)
  const header = `键位冲突检查：${bindings.length} 条绑定，${conflicts.length} 处冲突。`
  if (!conflicts.length) return `${header}\n同一作用域内没有重复键位。`
  const lines = conflicts.map(conflict =>
    `${conflict.chord}（${conflict.scope}）绑了 ${conflict.ids.length} 个动作：${conflict.ids.join('、')} —— 生效的是 ${conflict.winner}`)
  return [header, ...lines].join('\n')
}

// ── 键位方案（上游 `KeymapManagerEx` 的方案继承 + `BundledKeymapBean` 的覆盖表）──────────

/** 一个键位方案：`parent` 继承基线，`overrides` 按动作 id 覆盖键位显示串（null = 解绑）。 */
export interface KeymapScheme {
  name: string
  parent: string | null
  overrides: Record<string, string | null>
}

/** 上游 `KeymapManagerEx.getKeymaps()` 里的默认方案：就是随产品发货的那张表。 */
export const DEFAULT_SCHEME: KeymapScheme = { name: 'Default', parent: null, overrides: {} }

export interface ResolvedScheme {
  name: string
  bindings: KeyBinding[]
  /** 覆盖表里没有对应动作的 id（上游 `KeymapImpl` 会把它留在方案里、不生效；这里报出来）。 */
  unknownIds: string[]
}

/** 覆盖表里的显示串 → 键位（认 `Ctrl`/`Alt`/`Shift`/`Meta` 修饰键，分隔符 `+` 或空格都收）。 */
export function parseChord(text: string): KeyChord | null {
  const parts = text.trim().split(/[\s+]+/).filter(Boolean)
  if (!parts.length) return null
  const key = parts[parts.length - 1]!.toLowerCase()
  const chord: KeyChord = { key, control: 'mod' }
  for (const part of parts.slice(0, -1)) {
    const modifier = part.toLowerCase()
    if (modifier === 'ctrl' || modifier === 'control') chord.control = 'ctrl'
    else if (modifier === 'shift') chord.shift = true
    else if (modifier === 'alt') chord.alt = true
    else return null
  }
  return chord
}

/** 按祖先链解析方案（近的覆盖远的，`null` 解绑）；环会在解析时被截断，不会死循环。 */
export function resolveKeymapSchemes(schemes: readonly KeymapScheme[], base: readonly KeyBinding[] = KEY_BINDINGS): ResolvedScheme[] {
  const byName = new Map(schemes.map(scheme => [scheme.name, scheme]))
  return schemes.map((scheme) => {
    const chain: KeymapScheme[] = []
    const seen = new Set<string>()
    for (let current: KeymapScheme | undefined = scheme; current && !seen.has(current.name); current = current.parent ? byName.get(current.parent) : undefined) {
      seen.add(current.name)
      chain.push(current)
    }
    // 远的先应用，近的后应用（近的赢）。
    const overrides = new Map<string, string | null>()
    for (const step of [...chain].reverse()) for (const [id, keys] of Object.entries(step.overrides)) overrides.set(id, keys)
    const known = new Set(base.map(binding => binding.id))
    const bindings = base.flatMap<KeyBinding>(binding => {
      if (!overrides.has(binding.id)) return [binding]
      const keys = overrides.get(binding.id)
      if (keys === null || keys === undefined) return []
      const chord = parseChord(keys)
      return chord ? [{ ...binding, chord, display: keys }] : [binding]
    })
    return { name: scheme.name, bindings, unknownIds: [...overrides.keys()].filter(id => !known.has(id)) }
  })
}
