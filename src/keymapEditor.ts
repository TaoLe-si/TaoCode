// 键位编辑层 —— 判词 `pf/keymap` 的主体缺口（「用户自定义改键（没有把按键录进注册表的通道）」
// 与 `pf/actions` 的一半（「给动作改键位的 UI」，`SetShortcutAction`）在本仓的**规则侧**落点。
//
// 上游对应物（`platform/platform-impl/src/com/intellij/openapi/keymap/impl/`）：
//   · `ui/KeymapPanel.java:565-574` `isShortcutConflictAction` / `:576-582` `removeConflictingShortcuts`
//       —— 改一个键位时挑出真冲突、并把同一个键从别的动作上摘掉；三条排除口径在
//         `src/keymapBindings.ts` 的 `isShortcutConflictAction`（同一 id、`EditorFoo` vs `$Foo`、`use-shortcut-of`）。
//   · `ActionShortcutRestrictions.java:12` `getForActionId(actionId)` → `ShortcutRestrictions`
//     （`ShortcutRestrictions.java:7-12` 的六个布尔位）+ `ActionShortcutRestrictionsImpl.java:10-30`
//     —— 本模块的 `shortcutRestrictions`。
//   · `platform-api/src/com/intellij/openapi/keymap/KeymapTextContext.java:155-169` `getKeystrokeText`
//     与 `:201-222` `getModifiersText` —— 快捷键的**显示串**（Ctrl / Alt / Shift / Meta 顺序，修饰键与
//     键名之间无分隔符），本模块的 `keystrokeText`；`:76-89` `getModifierDoubleClickText`
//     —— 双击修饰键手势的串（「Shift+Shift」），本模块的 `doubleClickModifierText`。
//   · `ui/KeyboardShortcutPanel.java` / `ui/ShortcutTextField.java` —— 按下即录的那条通道，
//     本模块的 `strokeFromKeyEvent` + `assignShortcut`。
//   · `ex/KeymapManagerEx.java` 的活动方案 —— 本模块的覆盖表 `KEYMAP_OVERRIDES`。
//
// 分工：这里是**纯规则 + 一个模块级覆盖表**（Vue-free，便于单测）；活状态在 `src/keymapHost.ts`，
// 分派与菜单显示由 `effectiveKeyBindings()` 提供的同一份数据承接（`src/keymap.ts` 的分派尾部、
// `src/actionRegistry.ts` 的 `actionRow` 查键位）。UI 是 `src/components/KeymapDialog.vue`
// （入口在帮助菜单的「键盘映射…」，`src/menus/helpMenu.ts`）—— 挂载那一行要接线批在
// `src/App.vue` 加（见报告的接线请求一节），设置页形态（`SettingsDialog` 顶在行数上限、
// 节点表 `src/settingsTreeMeta.ts` 归接线批）留到那一轮。
import {
  KEYMAP_EDITABLE_BINDINGS, chordIdentity, isShortcutConflictAction, keymapConflicts, parseChord,
  type KeyBinding, type KeymapConflict, type KeyChord, type KeyChordInput, type KeyScope,
} from './keymapBindings.ts'

// ── 显示串（上游 `KeymapTextContext`）──────────────────────────────────────

/**
 * 修饰键 → 显示名，顺序 = AWT `KeyEvent.getKeyModifiersText`（Windows/Linux 口径）：
 * Ctrl → Alt → Shift → Meta（`KeymapTextContext.java:218-221` 调的就是它）。
 * 简化 Mac 口径是 Cmd → Ctrl → Alt → Shift（`KeymapTextContext.java:227-231`）——
 * 本仓只做前者，`macModifiers` 那套没有落点，不假装有。
 */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

const MODIFIER_LABEL: Record<(typeof MODIFIER_ORDER)[number], string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Cmd',
}

/** 键名显示（`KeymapTextContext.getKeystrokeText`，`:155-169` = 修饰键串 + 键名）。 */
export function keyText(key: string): string {
  if (key.length !== 1) return key
  // 单字符原样（上游 `getKeyText` 对可打印字符返回它本身，`:171-188`）。
  return key.toUpperCase()
}

/** 快捷键显示串：修饰键按固定顺序、无分隔符（上游不带 `+`，菜单里那串是本仓自己的助记格式）。 */
export function keystrokeText(chord: KeyChordInput & { key: string }): string {
  const mods = MODIFIER_ORDER.filter(mod => (mod === 'ctrl' ? chord.ctrlKey : mod === 'alt' ? chord.altKey : mod === 'shift' ? chord.shiftKey : chord.metaKey))
  const prefix = mods.map(mod => MODIFIER_LABEL[mod]).join('')
  return `${prefix}${keyText(chord.key)}`
}

/** `control: 'ctrl'` 写死真 Ctrl、`'mod'` 认 Ctrl 与 Meta —— `KeyChord` → `KeyChordInput` 的形状。 */
function asChordInput(event: KeyChordInput): KeyChordInput & { key: string } {
  return { key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey }
}

/** `KeyBinding.chord` → 显示串（上游 `KeymapUtil.getKeystrokeText(KeymapUtil.getFirstKeyboardShortcutText(actionId))`）。 */
export function bindingKeystrokeText(binding: KeyBinding): string {
  const chord = binding.chord
  const input = {
    key: chord.key,
    ctrlKey: chord.control === 'ctrl' ? true : false,
    shiftKey: Boolean(chord.shift),
    altKey: Boolean(chord.alt),
    metaKey: chord.control === 'mod',
  }
  // `mod` 同时可能来自 Ctrl 或 Meta，两边都点亮会让显示串多出一个修饰键；按 `mod` 归到 Ctrl 那一格。
  if (chord.control === 'mod') input.ctrlKey = true
  return keystrokeText(input)
}

/**
 * 双击修饰键手势的显示串（`KeymapTextContext.getModifierDoubleClickText`，`:76-89`）：
 * `<其余修饰键>+<键名> <键名>`。上游的手势键在 `$default.xml` 里是
 * `keyboard-gesture-shortcut`（Search Everywhere 双击 Shift、Run Anything 双击 Ctrl），
 * 手势**不是键位对**，所以不在 `KEY_BINDINGS` 里 —— 本仓的全局分派器已经实现了这两个手势，
 * 这里只把它们的串按上游口径给出来（设置页/帮助里显示用）。
 */
export function doubleClickModifierText(modifier: 'Shift' | 'Control' | 'Alt' | 'Cmd', withOthers: KeyChordInput = {
  key: modifier, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
}): string {
  const others = MODIFIER_ORDER.filter(mod => (mod === 'ctrl' ? withOthers.ctrlKey : mod === 'alt' ? withOthers.altKey : mod === 'shift' ? withOthers.shiftKey : withOthers.metaKey))
    .filter(mod => mod !== modifierKeyOf(modifier))
  const prefix = others.map(mod => `${MODIFIER_LABEL[mod]}+`).join('')
  return `${prefix}${modifier} ${modifier}`
}

function modifierKeyOf(modifier: 'Shift' | 'Control' | 'Alt' | 'Cmd'): (typeof MODIFIER_ORDER)[number] {
  return modifier === 'Shift' ? 'shift' : modifier === 'Control' ? 'ctrl' : modifier === 'Alt' ? 'alt' : 'meta'
}

// ── 按键录制通道（上游 `KeyboardShortcutPanel` / `ShortcutTextField`）────────

/** 录制结果：要么一组键位，要么「这一下不该录」。 */
export type RecordedStroke = { chord: KeyChord; text: string } | null

/**
 * 把一次按键事件录成键位（上游 `ui/KeyboardShortcutPanel.java` 的按下即录）。
 * 只有**主键**才成键位：纯修饰键（Ctrl/Alt/Shift/Meta 本身）、无主键的功能性按键都返回 `null`，
 * 与上游「要先有一个非修饰键才谈得上快捷键」一致。
 * `control` 口径：按了 Ctrl 就是 `'ctrl'`（写死真 Ctrl，上游同），只按了 Meta 也是 `'ctrl'` 语义外的
 * 单独一档 —— 本仓的 `KeyChord.control` 只有 `'ctrl' | 'mod'` 两档，Meta 归 `'mod'`；
 * **缺省（不写 `control`）= 只有 `alt`/`shift` 的键位**（`SafeDelete` 的 `alt DELETE`），
 * 那种键位这里就只拼 Alt/Shift + 键名，不会多出假前缀。
 */
export function strokeFromKeyEvent(event: KeyChordInput): RecordedStroke {
  if (isModifierKeyName(event.key)) return null
  const chord: KeyChord = {
    key: event.key.toLowerCase(),
    control: event.ctrlKey ? 'ctrl' : 'mod',
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
  }
  return { chord, text: keystrokeText(asChordInput(event)) }
}

function isModifierKeyName(key: string): boolean {
  return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'OS'
}

/** 录到的键位转回本仓的覆盖表格式（`parseChord` 认 `Ctrl+Alt+K`；显示串用上游的无分隔写法，解析同样能吃）。 */
export function chordToOverrideText(chord: KeyChord): string {
  const parts: string[] = []
  if (chord.control) parts.push(chord.control === 'ctrl' ? 'Ctrl' : 'Meta')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : chord.key)
  return parts.join('+')
}

// ── 快捷键限制（上游 `ShortcutRestrictions` + `ActionShortcutRestrictionsImpl`）────

/**
 * `ShortcutRestrictions`（`impl/ShortcutRestrictions.java:7-12`）的六个布尔位。
 * 本仓只有键盘快捷键这一种，所以 `allowMouseShortcut` / `allowMouseDoubleClick` 恒为 true
 * （上游 `NO_RESTRICTIONS` 也是 true），没有对应物的位保留在这里是为了口径可核对。
 */
export interface ShortcutRestrictions {
  allowChanging: boolean
  allowMouseShortcut: boolean
  allowMouseDoubleClick: boolean
  allowKeyboardShortcut: boolean
  allowKeyboardSecondStroke: boolean
  allowAbbreviation: boolean
}

/** `ShortcutRestrictions.NO_RESTRICTIONS`（`ShortcutRestrictions.java:5`，六个位全 true）。 */
export const NO_RESTRICTIONS: ShortcutRestrictions = {
  allowChanging: true, allowMouseShortcut: true, allowMouseDoubleClick: true,
  allowKeyboardShortcut: true, allowKeyboardSecondStroke: true, allowAbbreviation: true,
}

/** `MOUSE_SINGLE_CLICK_ONLY`（`ActionShortcutRestrictionsImpl.java:11`：只允许改、只允许鼠标单击）。 */
const MOUSE_SINGLE_CLICK_ONLY: ShortcutRestrictions = {
  allowChanging: true, allowMouseShortcut: true, allowMouseDoubleClick: false,
  allowKeyboardShortcut: false, allowKeyboardSecondStroke: false, allowAbbreviation: false,
}

/** `SWING_SHORTCUT`（`ActionShortcutRestrictionsImpl.java:13`：只能键盘、不许双段、不能用助记）。 */
const SWING_SHORTCUT: ShortcutRestrictions = {
  allowChanging: true, allowMouseShortcut: false, allowMouseDoubleClick: false,
  allowKeyboardShortcut: true, allowKeyboardSecondStroke: false, allowAbbreviation: false,
}

/** `FIXED_SHORTCUT`（`ActionShortcutRestrictionsImpl.java:12`：一个位都不许，只读）。 */
export const FIXED_SHORTCUT: ShortcutRestrictions = {
  allowChanging: false, allowMouseShortcut: false, allowMouseDoubleClick: false,
  allowKeyboardShortcut: false, allowKeyboardSecondStroke: false, allowAbbreviation: false,
}

/** `ActionShortcutRestrictionsImpl.getForActionId` 点名的四个多光标/矩形选区动作（`:20-25`）。 */
const MOUSE_ONLY_ACTION_IDS = [
  'EditorAddOrRemoveCaret',
  'EditorCreateRectangularSelection',
  'EditorAddRectangularSelectionOnMouseDrag',
  'EditorCreateRectangularSelectionOnMouseDrag',
]

/**
 * 一个动作能不能改键位 —— 上游 `ActionShortcutRestrictions.getForActionId(actionId)`
 * （`ActionShortcutRestrictions.java:12`，实现 `ActionShortcutRestrictionsImpl.java:16-30`）：
 *   · id 为 null → `NO_RESTRICTIONS`（`:17`）；
 *   · id 以 `Swing-` 开头 → `SWING_SHORTCUT`（`:18`）；
 *   · 四个多光标/矩形选区动作 → `MOUSE_SINGLE_CLICK_ONLY`（`:20-25`）；
 *   · `ACTION_EXPAND_LIVE_TEMPLATE_BY_TAB` → `FIXED_SHORTCUT`（`:26-28`），该动作的 id 常量值见
 *     `IdeActions.ACTION_EXPAND_LIVE_TEMPLATE_BY_TAB`，本仓按 id 字符串匹配；
 *   · 其它 → `NO_RESTRICTIONS`（`:29`）。
 * 注意上游**没有**「按 place 声明」这回事（判词原文写错了），限制是按动作 id 的六个布尔位。
 */
export function shortcutRestrictions(actionId: string | null | undefined): ShortcutRestrictions {
  if (!actionId) return NO_RESTRICTIONS
  if (actionId.startsWith('Swing-')) return SWING_SHORTCUT
  if (MOUSE_ONLY_ACTION_IDS.includes(actionId)) return MOUSE_SINGLE_CLICK_ONLY
  if (actionId === 'ExpandLiveTemplateByTab') return FIXED_SHORTCUT
  return NO_RESTRICTIONS
}

/** 改键位面板里那句「这个动作不能改键」的说明（限制位 → 一句话；不限时返回 null）。 */
export function restrictionReason(actionId: string | null | undefined): string | null {
  const restrictions = shortcutRestrictions(actionId)
  if (restrictions.allowChanging) return null
  return `「${actionId}」的键位是固定的（上游 ActionShortcutRestrictions 判为不可改）。`
}

// ── 用户自定义键位（上游 `KeymapManagerEx` 的活动方案 + `KeymapScheme`）────────

/** 覆盖表：动作 id → 键位显示串（`null` = 解绑该动作）。上游 `KeymapImpl` 的用户覆盖层。 */
export type KeymapOverrides = Readonly<Record<string, string | null>>

export const KEYMAP_OVERRIDE_STORAGE_KEY = 'taocode.keymap.overrides'

/** 覆盖表解析：坏数据退回空表（键位是用户数据，宁可丢也不要让 IDE 起不来，同 `parseMacros`）。 */
export function parseOverrides(raw: string | null): KeymapOverrides {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string | null> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!id) continue
      if (value === null) { out[id] = null; continue }
      if (typeof value === 'string' && parseChord(value)) out[id] = value
    }
    return out
  } catch { return {} }
}

export function serializeOverrides(overrides: KeymapOverrides): string {
  return JSON.stringify(overrides)
}

/**
 * 出厂表之外、**运行期才有**的动作（上游 `KeymapManagerEx` 里第三方 keymap 贡献的那层）：
 * 它们没有 `$default.xml` 里的默认键位，但**可以被用户绑键**。本仓当前唯一的一族是宏
 * （`ActionMacroManager.kt:395-423 registerActions` 把命名宏注册成 `Macro.<名字>` 动作）。
 * 没有这一层的话 `assignShortcut` 会以「没有这个动作」拒掉宏，而拒绝发生在
 * `effectiveKeyBindings` 之后 —— 键位表里看不到它，也就没有绑键的入口。
 */
export interface DynamicKeyBinding {
  id: string
  label: string
  scope?: KeyScope
}

const dynamicBindings = new Map<string, DynamicKeyBinding>()

/** 动态动作表（整表替换，不做增量 —— 上游的 `handleKeymapAdded`/`handleKeymapRemoved` 也是整表重建）。 */
export function setDynamicKeyBindings(list: readonly DynamicKeyBinding[]): void {
  const next = new Map<string, DynamicKeyBinding>()
  for (const item of list) if (item.id) next.set(item.id, item)
  if (next.size === dynamicBindings.size
    && [...next].every(([id, item]) => dynamicBindings.get(id)?.label === item.label && dynamicBindings.get(id)?.scope === item.scope)) return
  dynamicBindings.clear()
  for (const [id, item] of next) dynamicBindings.set(id, item)
  // 动态表变了 = 生效表变了，订阅者（键位面板、菜单键位文案）要重画。
  for (const listener of [...listeners]) listener()
}

/** 出厂表 + 动态动作的 id 全集 —— `assignShortcut`/`unassignShortcut` 的「这个动作存在吗」判据。 */
function knownActionIds(base: readonly KeyBinding[]): ReadonlySet<string> {
  const ids = new Set<string>(base.map(binding => binding.id))
  for (const id of dynamicBindings.keys()) ids.add(id)
  return ids
}

/** 动态动作按覆盖表落成键位行；没被用户绑过 / 被解绑 ⇒ 没有这一行（上游同理：没键位就没有条目）。 */
function dynamicBindingsOf(overrides: KeymapOverrides): KeyBinding[] {
  const rows: KeyBinding[] = []
  for (const item of dynamicBindings.values()) {
    if (!Object.prototype.hasOwnProperty.call(overrides, item.id)) continue
    const keys = overrides[item.id]
    if (keys === null || keys === undefined) continue
    const chord = parseChord(keys)
    if (!chord) continue
    const binding: KeyBinding = {
      id: item.id,
      label: item.label,
      chord,
      display: bindingKeystrokeText({ id: item.id, label: item.label, chord, display: '', scope: item.scope ?? 'global', upstream: '' }),
      scope: item.scope ?? 'global',
      override: true,
      upstream: '本仓（运行期注册的动作，无出厂默认键位）',
    }
    rows.push(binding)
  }
  return rows
}

/**
 * 覆盖表叠到出厂表上（上游 `KeymapManagerEx.getActiveKeymap()` 的语义：
 * 用户方案覆盖出厂方案，**解绑的条目从表里删掉**而不是留一条空绑定）。
 * 解析不了的覆盖串按出厂那条走（`KeymapSchemeManager` 里非法条目不会破坏整张表）。
 * 末尾接上动态动作（宏）绑出来的那几条 —— 它们同样参与 `findKeyBinding` 的匹配与冲突检测。
 */
export function effectiveKeyBindings(
  overrides: KeymapOverrides = currentOverrides(),
  base: readonly KeyBinding[] = KEYMAP_EDITABLE_BINDINGS,
): KeyBinding[] {
  if (!Object.keys(overrides).length) return [...base, ...dynamicBindingsOf(overrides)]
  return [
    ...base.flatMap<KeyBinding>(binding => {
      if (!Object.prototype.hasOwnProperty.call(overrides, binding.id)) return [binding]
      const keys = overrides[binding.id]
      if (keys === null || keys === undefined) return []
      const chord = parseChord(keys)
      if (!chord) return [binding]
      return [{ ...binding, chord, display: bindingKeystrokeText({ ...binding, chord }), override: true }]
    }),
    ...dynamicBindingsOf(overrides),
  ]
}

/** 模块级覆盖表。变更即 bump `presentationVersion`（上游 `ActionManagerImpl` 的 presentation 失效）。 */
const overrides = { current: parseOverrides(readStorage()) as KeymapOverrides }

function readStorage(): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEYMAP_OVERRIDE_STORAGE_KEY) }
  catch { return null }
}

function writeStorage(next: KeymapOverrides): void {
  try { localStorage.setItem(KEYMAP_OVERRIDE_STORAGE_KEY, serializeOverrides(next)) } catch { /* 存不了就只在内存里 */ }
}

export function currentOverrides(): KeymapOverrides { return overrides.current }

/** 覆盖表变更时调用的订阅者（键位设置页 / 菜单据此重画）。 */
const listeners = new Set<() => void>()

export function onOverridesChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function commit(next: KeymapOverrides): void {
  overrides.current = next
  writeStorage(next)
  for (const listener of [...listeners]) listener()
}

/**
 * 给一个动作改键位（上游 `KeymapPanel` 的 `EditShortcutAction` → `keymap.setShortcut`）。
 * 返回一条**可见**的拒绝理由或 null：
 *   · 动作 id 不在表里 → 「没有这个动作」，不静默写一条无处生效的覆盖；
 *   · `shortcutRestrictions` 说不可改 → `restrictionReason`；
 *   · 与别的动作撞同一键位 → 上游 `KeymapPanel.java:791-798` 弹三选一
 *     （移走冲突 / 保留 / 取消），本仓把选择权交给调用方：这里**不**自动移走，只返回冲突清单。
 */
export function assignShortcut(actionId: string, chord: KeyChord | string): { conflicts: KeymapConflict[] } | { error: string } {
  if (!knownActionIds(KEYMAP_EDITABLE_BINDINGS).has(actionId)) return { error: `没有名为「${actionId}」的键位动作。` }
  const restriction = restrictionReason(actionId)
  if (restriction) return { error: restriction }
  const text = typeof chord === 'string' ? chord : chordToOverrideText(chord)
  if (!parseChord(text)) return { error: `「${text}」不是一组合法的键位。` }
  const next = { ...overrides.current, [actionId]: text }
  const conflicts = keymapConflicts(effectiveKeyBindings(next)).filter(conflict => conflict.ids.includes(actionId))
  commit(next)
  return { conflicts }
}

/** 解绑一个动作（上游「清除快捷键」；`null` 在覆盖表里就是解绑，见 `parseOverrides`）。 */
export function unassignShortcut(actionId: string): boolean {
  if (!knownActionIds(KEYMAP_EDITABLE_BINDINGS).has(actionId)) return false
  if (!Object.prototype.hasOwnProperty.call(overrides.current, actionId)) return false
  const next = { ...overrides.current, [actionId]: null }
  commit(next)
  return true
}

/**
 * 覆盖表整体替换（上游 `KeymapSchemeManager.apply`，`:203-223`：一批改动一次落盘 + 通知）。
 * 给「一批动作 id 的键位同时变动」的宿主用 —— 宏重命名/删除要把 `Macro.*` 的绑定一并迁移
 * （`ActionMacroConfigurationPanel.apply`，`:69-104`），那不是「改一个键位」能表达的。
 * 返回是否真的变了；没变就不落盘、不广播。
 */
export function applyOverrides(next: KeymapOverrides): boolean {
  if (serializeOverrides(next) === serializeOverrides(overrides.current)) return false
  commit(next)
  return true
}

/** 恢复出厂键位（上游 `KeymapSchemeManager` 的「重置」；默认方案没有覆盖）。 */
export function resetScheme(): void { commit({}) }

/** 这个动作当前的键位显示串（出厂 + 覆盖；解绑了返回空串）。 */
export function effectiveKeysOf(actionId: string, bindings = effectiveKeyBindings()): string {
  const found = bindings.find(binding => binding.id === actionId)
  return found ? bindingKeystrokeText(found) : ''
}

// ── 面板用的查询（上游 `ui/ShortcutFilteringPanel` / `ui/ActionsTree`）───────

/** 键位设置页的一行（上游 `KeymapPanel` 的动作树 + 快捷键列）。 */
export interface KeymapRow {
  id: string
  label: string
  keys: string
  scope: KeyScope
  /** 出厂键位（改过之后仍显示，便于对比）。 */
  factoryKeys: string
  overridden: boolean
  conflictsWith: string[]
}

/**
 * 键位表 → 面板行；`query` 是 `ShortcutFilteringPanel` 的搜索框（按动作名、动作 id、快捷键串
 * 过滤，上游是三个独立的检索字段，这里合成一条大小写不敏感的子串匹配）。
 * 冲突列按 `isShortcutConflictAction` 收口 —— 与 `keymapConflicts` 用同一判据，不各报各的。
 *
 * **没绑键的动态动作也要列出来**（宏就是这样进来的）：上游 `KeymapPanel` 的动作树列的是全部
 * 动作，快捷键列可以为空 —— 不列出来用户就没有「给宏绑键」的入口。
 * `factoryKeys` 对没有出厂默认键位的动作是空串（宏本来就没有 `$default.xml` 条目）。
 */
export function keymapRows(
  bindings: readonly KeyBinding[] = effectiveKeyBindings(),
  query = '',
  base: readonly KeyBinding[] = KEYMAP_EDITABLE_BINDINGS,
  overrides: KeymapOverrides = currentOverrides(),
): KeymapRow[] {
  const needle = query.trim().toLowerCase()
  const conflicts = keymapConflicts(bindings)
  const listed = bindings.filter((binding) => {
    if (!needle) return true
    const factory = base.find(item => item.id === binding.id)
    return [binding.label, binding.id, bindingKeystrokeText(binding), factory ? bindingKeystrokeText(factory) : '']
      .some(text => text.toLowerCase().includes(needle))
  })
  const rows: KeymapRow[] = listed.map(binding => {
    const factory = base.find(item => item.id === binding.id)
    return {
      id: binding.id,
      label: binding.label,
      keys: bindingKeystrokeText(binding),
      scope: binding.scope,
      factoryKeys: factory ? bindingKeystrokeText(factory) : '',
      overridden: Boolean(binding.override),
      conflictsWith: conflicts.filter(conflict => conflict.ids.includes(binding.id))
        .flatMap(conflict => conflict.ids.filter(id => id !== binding.id && isShortcutConflictAction(binding.id, id))),
    }
  })
  for (const item of dynamicBindings.values()) {
    if (listed.some(row => row.id === item.id)) continue
    if (needle && !`${item.label} ${item.id}`.toLowerCase().includes(needle)) continue
    rows.push({
      id: item.id, label: item.label, keys: '', scope: item.scope ?? 'global',
      factoryKeys: '', overridden: false, conflictsWith: [],
    })
  }
  // 出厂有键位、但被用户**显式解绑**（覆盖表里是 `null`）的动作也要列出来，键位列为空。
  // `effectiveKeyBindings` 按上游语义把解绑条目从生效表里删掉，所以它不会出现在上面那批里；
  // 可要是面板也跟着消失，用户就再也绑不回去了 —— 上游 `ActionsTree` 列的是全部动作。
  for (const factory of base) {
    if (listed.some(row => row.id === factory.id)) continue
    if (overrides[factory.id] !== null) continue
    if (needle && !`${factory.label} ${factory.id}`.toLowerCase().includes(needle)) continue
    rows.push({
      id: factory.id, label: factory.label, keys: '', scope: factory.scope,
      factoryKeys: bindingKeystrokeText(factory), overridden: true, conflictsWith: [],
    })
  }
  return rows
}

/**
 * 把「移走冲突」落成新的覆盖表（上游 `KeymapPanel.removeConflictingShortcuts`，`:576-582`：
 * 给 `actionId` 加上 `shortcut` 的同时，把同一键位从所有冲突动作上摘掉）。
 * 冲突判据同 `isShortcutConflictAction`（同 id / `EditorFoo` vs `$Foo` / 别名都不算）。
 * 遍历的是**生效表**（含宏这类动态动作），不是出厂表 —— 上游 `keymap.getConflicts(actionId, shortcut)`
 * 同样是在整张键位上算，不是只看 bundled 那层。
 */
export function removeConflictingShortcuts(actionId: string, chord: KeyChord, bindings: readonly KeyBinding[] = effectiveKeyBindings()): KeymapOverrides {
  const next: Record<string, string | null> = { ...overrides.current }
  next[actionId] = chordToOverrideText(chord)
  const identity = chordIdentity(chord)
  for (const binding of bindings) {
    if (binding.id === actionId) continue
    if (chordIdentity(binding.chord) !== identity) continue
    if (!isShortcutConflictAction(actionId, binding.id)) continue
    // 无条件解绑冲突方（上游 `:576-583` 的 `keymap.removeShortcut(id, s)` 不看这条绑定
    // 是出厂的还是用户自己写的）。遍历的是**生效表**，所以被用户改到别的键的冲突方
    // 键位 identity 对不上，天然不会被摘。
    next[binding.id] = null
  }
  return next
}
