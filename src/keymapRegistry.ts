// 键位注册表 + 冲突检测 —— 上游 `Keymap` / `KeymapImpl` 的「动作 → 键位」表与冲突判定在本仓的
// 纯逻辑落点（零 Vue、零依赖，可被 Node 直跑单测）。
//
// 为什么要有它（HANDOFF 点名的缺口）：本仓键位原先只写在 `src/keymap.ts` 的 if 链里，
// 没有一张**可查冲突**的共享注册表。`src/keymapBindings.ts` 的 `keymapConflicts` 是「同 scope +
// 同键位」的保守近似（其文件头自述），而 scope 是本仓概念、上游没有这一维。本模块照**上游真实语义**
// 重做，三件事：
//   · 一条绑定 = `$default.xml` 里 `<action>` 的一个 `<keyboard-shortcut|keyboard-gesture-shortcut|
//     mouse-shortcut>` 子元素（真实属性集见下）；表数据由 `parseKeymapXml` **从 XML 解析**，不硬编码；
//   · 冲突判定 = `KeymapImpl.getConflicts`（`platform/platform-impl/src/com/intellij/openapi/keymap/
//     impl/KeymapImpl.kt:778-810`）+ 三条排除口径 `KeymapPanel.isShortcutConflictAction`
//     （同目录 `impl/ui/KeymapPanel.java:565-574`）；
//   · 提示文案逐字抄 `messages/KeyMapBundle.properties`（见文件末常量）。
//
// 上游**没有** `context` 属性（任务书的「同 keystroke + 同上下文」前提不成立）：
// 把 `platform/platform-resources/src/keymaps/*.xml` 与 `plugins/keymaps/*/resources/keymaps/*.xml`
// 的属性名全量枚举后只有 id / first-keystroke / second-keystroke / keystroke / modifier / name /
// version / parent / disable-mnemonics / replace-all —— 没有 context / place。
// 上下文只参与**分派**（`impl/IdeKeyEventDispatcher.kt:710` 的 `isModalContext`），不参与冲突判定。
//
// 判据：`tests/keymap-registry.test.mjs`。

// ── 键位（KeyStroke）解析 ───────────────────────────────────────────────────
//
// 上游 `platform/platform-impl/src/com/intellij/ui/KeyStrokeAdapter.java`：
//   · `:137-195` `getKeyStroke(String)` —— 空格分词；`typed` 后跟一个单字符；`pressed`/`released`
//     状态词；其余 token 先当修饰键查 `LazyModifiers.mapNameToMask`（`:257-272`），
//     最后一个 token 当键码查 `LazyVirtualKeys.myNameToCode`（`:274-294`，即 `KeyEvent.VK_*` 全表），
//     查不到再 `Integer.decode`（`:166-175`）。
//   · `:160` token 一律 `toLowerCase` 后查表 ⇒ 修饰键与键名都**大小写不敏感**（`ENTER` 与 `Enter` 同）。
//   · `:262-263` `ctrl` 与 `control` 写入同一个 mask ⇒ 二者等价。
//   · `:266-267` `altgr` 与 `altgraph` 等价。
// 本仓只需支持 `$default.xml` 真正用到的词表（枚举自该文件：修饰键 shift/ctrl/control/alt，
// 键名 0-9 A-Z 单字母、F1-F12、ADD/SUBTRACT/MULTIPLY/DIVIDE、方向键、TAB/ENTER/ESCAPE/SPACE 等）。

/** 解析后的键位：比较用（上游比的是 `KeyStroke` 的键码 + 修饰位）。 */
export interface ParsedStroke {
  /** 规范化键名（单字符大写；命名键按 `$default.xml` 的写法大写，等价于 VK 表查表结果）。 */
  key: string
  /** 规范化修饰键（升序去重；`control` 已折叠成 `ctrl`）。 */
  modifiers: string[]
  /** 原始串（`control shift T`），用于报告与回写。 */
  raw: string
}

/** 修饰键名 → 规范名（上游 `LazyModifiers.mapNameToMask` 的等价物，`:261-271`）。 */
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  shift: 'shift',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  alt: 'alt',
  altgr: 'altgraph',
  altgraph: 'altgraph',
}

/** 键盘修饰键的规范集合（`button1..3` 是鼠标 mask，单列，见 `:268-270`）。 */
const KEYBOARD_MODIFIERS = new Set(['shift', 'ctrl', 'meta', 'alt', 'altgraph'])
const MOUSE_MODIFIERS = new Set(['button1', 'button2', 'button3'])

/** 状态词（上游 `:178-181`：`typed` / `pressed` / `released`）。 */
const STATE_WORDS = new Set(['typed', 'pressed', 'released'])

/**
 * 解析一组合法的键盘键位串；认不出返回 null（上游 `:167-174` 认不出就 `LOG.error` 后返回 null）。
 * 与上游的差异只有一处：键名**不做 VK 表全表映射**，只按 `$default.xml` 的写法规范化 ——
 * 单字符大写、命名键大写。对 `$default.xml` 用到的词表这是等价的（字母经 VK_A..VK_Z 查表、
 * 命名键经 VK_<名> 查表，两边都是大小写不敏感且一一对应）。
 */
export function parseKeystroke(text: string): ParsedStroke | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const tokens = raw.split(/\s+/).filter(Boolean)
  const modifiers: string[] = []
  let typed = false
  let key: string | null = null
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!.toLowerCase()
    // `typed` 之后的那个 token 是**字符**而不是键名（上游 `:149-159`）。
    if (typed) {
      if (tokens[i]!.length !== 1) return null
      key = tokens[i]!.toUpperCase()
      typed = false
      continue
    }
    if (token === 'typed') { typed = true; continue }
    if (STATE_WORDS.has(token)) continue
    const modifier = MODIFIER_ALIASES[token]
    if (modifier !== undefined && key === null) { modifiers.push(modifier); continue }
    // 最后一个非修饰 token 是键名；再有后续 token 就是坏串（上游 `:150-157`/`:162-165` 同理）。
    if (key !== null) return null
    key = canonicalKey(tokens[i]!)
  }
  if (key === null) return null
  return { key, modifiers: [...new Set(modifiers)].sort(), raw }
}

/** 键名规范化：单字符大写；命名键大写（`$default.xml` 写 `control alt S`，键名按 `S` 存）。 */
function canonicalKey(token: string): string {
  return token.toUpperCase()
}

/** 键位同一性串（修饰键集合 + 键名）—— 冲突分组与相等判定的唯一口径。 */
export function strokeIdentity(stroke: ParsedStroke): string {
  return `${stroke.modifiers.join('+')}|${stroke.key}`
}

/** 两组键位是否同一（上游 `KeyStroke.equals`：键码 + 修饰位全等）。 */
export function sameStroke(a: ParsedStroke | undefined, b: ParsedStroke | undefined): boolean {
  if (!a || !b) return false
  return strokeIdentity(a) === strokeIdentity(b)
}

/** 显示串（上游 `KeymapTextContext.getModifiersText`，`platform-api/.../KeymapTextContext.java:201-222`
 *  的 Windows/Linux 口径：修饰键顺序 Ctrl → Alt → Shift → Meta，与键名之间无分隔符）。 */
export function keystrokeText(stroke: ParsedStroke): string {
  const order = ['ctrl', 'alt', 'shift', 'meta'] as const
  const label: Readonly<Record<string, string>> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' }
  const prefix = order.filter(mod => stroke.modifiers.includes(mod)).map(mod => label[mod]).join('')
  return `${prefix}${stroke.key}`
}

/** 鼠标键位解析（上游 `KeymapUtil.parseMouseShortcut` 的子集：修饰键 + `buttonN` + click 词）。 */
export function parseMouseKeystroke(text: string): { modifiers: string[]; button: string; clicks: string; raw: string } | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean)
  const modifiers: string[] = []
  let button: string | null = null
  let clicks = 'click'
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token]
    if (modifier !== undefined) { modifiers.push(modifier); continue }
    if (MOUSE_MODIFIERS.has(token)) { button = token; continue }
    if (token === 'click' || token === 'doubleclick' || token === 'wheelup' || token === 'wheeldown') { clicks = token; continue }
    return null
  }
  if (button === null) return null
  return { modifiers: [...new Set(modifiers)].sort(), button, clicks, raw }
}

// ── 注册表条目与 XML 解析 ───────────────────────────────────────────────────
//
// 上游解析入口 `KeymapImpl.readExternal`（`impl/KeymapImpl.kt:580-696`），元素/属性常量 `:62-75`：
//   `<keymap name version parent disable-mnemonics>`，子元素只允许 `<action id>`（`:616-622`，
//   其它元素抛 `InvalidDataException`）；每个 `<action>` 的子元素三选一（`:625-681`）：
//     · `<keyboard-shortcut first-keystroke [second-keystroke]/>`（`:627-645`）；
//     · `<keyboard-gesture-shortcut keystroke modifier/>`（`:646-665`，modifier 只认 dblClick/hold）；
//     · `<mouse-shortcut keystroke/>`（`:666-677`）。
//   **空 `<action id="X"/>` 是合法的**：`:683-685` 明确说「空元素表示这个动作覆盖父方案并清空键位」——
//   `$default.xml` 有 14 条这样的（如 `:266 GotoChangedFile`），解析器不能把它们当坏数据丢掉。

export type KeymapKind = 'keyboard' | 'gesture' | 'mouse'

/** 一条绑定（= 一个快捷键子元素）。 */
export interface KeymapEntry {
  /** 所属动作 id（上游 `<action id>`；`$Foo` 形态与 `EditorFoo` 都原样保留）。 */
  actionId: string
  kind: KeymapKind
  /** 原始键位串：keyboard 取 `first-keystroke`，gesture/mouse 取 `keystroke`。 */
  keystroke: string
  /** keyboard 两段式的第二段（`second-keystroke`，`$default.xml` 有 22 条）。 */
  secondKeystroke?: string
  /** gesture 的手势类型（`modifier`：dblClick / hold）。 */
  modifier?: string
  /** 解析后的键位（坏串为 undefined，不参与冲突判定，与上游 `?: continue` 同口径）。 */
  stroke?: ParsedStroke
  /** 两段式的第二段解析结果。 */
  second?: ParsedStroke
  /** `<action>` 起始行（1 基，供报告与逐行核对）。 */
  actionLine: number
  /** 快捷键元素所在行（1 基）。 */
  line: number
  /** 来源串（`$default.xml:255`）。 */
  source: string
}

/** 解析出的整张键位方案。 */
export interface KeymapDocument {
  name: string
  version: string
  parent: string | null
  disableMnemonics: boolean
  /** 全部绑定（文档顺序 = `$default.xml` 的条目顺序）。 */
  entries: KeymapEntry[]
  /** 出现过的动作 id（含空 `<action id="X"/>`，它们没有绑定但覆盖父方案）。 */
  actionIds: string[]
  /** 解析告警（缺 id / 缺 first-keystroke / 未知子元素）——不静默吞，与上游抛错同精神。 */
  problems: string[]
}

const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g
const TAG_RE = /<(\/?)([A-Za-z][\w.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g

function attributesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(text)) !== null) out[match[1]!] = match[2]!
  return out
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/**
 * `$default.xml` → 注册表（上游 `KeymapImpl.readExternal` 的等价物，`:580-696`）。
 * 逐条语义对位：只认 `<action>`（`:616-618` 别的元素抛错，这里记进 `problems`）；`id` 缺了就报
 * （`:621-622`）；三种快捷键子元素按 `:625-681` 分派；空 `<action/>` 保留 id 但不产绑定（`:683-685`）。
 * 坏键位串**跳过该子元素**（上游 `KeyStrokeAdapter.getKeyStroke(...) ?: continue`，`:636`/`:642`）。
 */
export function parseKeymapXml(xml: string, options: { source?: string } = {}): KeymapDocument {
  const text = String(xml ?? '')
  const source = options.source ?? '$default.xml'
  const document: KeymapDocument = {
    name: '', version: '', parent: null, disableMnemonics: false,
    entries: [], actionIds: [], problems: [],
  }
  const seen = new Set<string>()
  let currentAction: string | null = null
  let actionLine = 0

  TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG_RE.exec(text)) !== null) {
    const closing = match[1] === '/'
    const name = match[2]!
    const attrs = attributesOf(match[3] ?? '')
    const selfClosing = match[4] === '/'
    const line = lineAt(text, match.index)
    if (closing) {
      if (name === 'action') currentAction = null
      continue
    }
    if (name === 'keymap') {
      document.name = attrs.name ?? ''
      document.version = attrs.version ?? ''
      document.parent = attrs.parent ?? null
      document.disableMnemonics = attrs['disable-mnemonics'] === 'true'
      continue
    }
    if (name === 'action') {
      const id = attrs.id
      if (!id) { document.problems.push(`${source}:${line} <action> 缺 id（上游 :621-622 抛 InvalidDataException）`); currentAction = null; continue }
      if (!seen.has(id)) { seen.add(id); document.actionIds.push(id) }
      currentAction = selfClosing ? null : id
      actionLine = line
      continue
    }
    if (name === 'keyboard-shortcut' || name === 'keyboard-gesture-shortcut' || name === 'mouse-shortcut') {
      if (currentAction === null) { document.problems.push(`${source}:${line} <${name}> 不在任何 <action> 里（上游 :617-618 抛错）`); continue }
      const entry = buildEntry(name, attrs, currentAction, actionLine, line, source, document.problems)
      if (entry) document.entries.push(entry)
      continue
    }
    document.problems.push(`${source}:${line} 未知元素 <${name}>（上游 :678-680 抛 InvalidDataException）`)
  }
  return document
}

function buildEntry(
  elementName: string, attrs: Record<string, string>, actionId: string,
  actionLine: number, line: number, source: string, problems: string[],
): KeymapEntry | null {
  const base = { actionId, actionLine, line, source: `${source}:${line}` }
  if (elementName === 'keyboard-shortcut') {
    const first = attrs['first-keystroke']
    if (!first) { problems.push(`${source}:${line} ${actionId} 的 keyboard-shortcut 缺 first-keystroke（上游 :629-631 抛错）`); return null }
    const secondText = attrs['second-keystroke']
    const stroke = parseKeystroke(first)
    const second = secondText ? parseKeystroke(secondText) : undefined
    if (!stroke) { problems.push(`${source}:${line} ${actionId} 的键位串「${first}」解析不了（上游 :636 跳过）`); return null }
    if (secondText && !second) { problems.push(`${source}:${line} ${actionId} 的第二段「${secondText}」解析不了（上游 :642 跳过）`); return null }
    return { ...base, kind: 'keyboard', keystroke: first, ...(secondText ? { secondKeystroke: secondText } : {}), stroke, ...(second ? { second } : {}) }
  }
  if (elementName === 'keyboard-gesture-shortcut') {
    const strokeText = attrs.keystroke
    if (!strokeText) { problems.push(`${source}:${line} ${actionId} 的 gesture 缺 keystroke（上游 :647-648 抛错）`); return null }
    const modifier = attrs.modifier
    if (modifier === undefined) { problems.push(`${source}:${line} ${actionId} 的 gesture 缺 modifier（上游 :660-662 抛错）`); return null }
    const stroke = parseKeystroke(strokeText)
    return { ...base, kind: 'gesture', keystroke: strokeText, modifier, ...(stroke ? { stroke } : {}) }
  }
  const mouseText = attrs.keystroke
  if (!mouseText) { problems.push(`${source}:${line} ${actionId} 的 mouse-shortcut 缺 keystroke（上游 :667-669 抛错）`); return null }
  return { ...base, kind: 'mouse', keystroke: mouseText }
}

// ── 冲突判定 ───────────────────────────────────────────────────────────────
//
// 上游 `KeymapImpl.getConflicts(actionId, keyboardShortcut)`（`impl/KeymapImpl.kt:778-810`）逐条规则：
//   ① `:781` 候选集 = `getActionIds(keyboardShortcut.firstKeyStroke)` —— **按第一段键位取候选**，
//      第二段只在下面做过滤，不参与取候选；
//   ② `:782-784` 排除同一个动作（`id == actionId`）与「`EditorFoo` vs `$Foo`」（编辑器动作与它的
//      全局孪生是同一个动作）；
//   ③ `:786-790` 排除 `getActionBinding(id) == actionId` 的（`use-shortcut-of` 别名指向本动作时，
//      冲突的其实是同一个动作）；
//   ④ `:795-797` 候选那条键位必须也是 `KeyboardShortcut` 且第一段相等；
//   ⑤ `:799-803` **两段式过滤**：本键位与候选键位**都**有第二段且不相等才排除 ——
//      只要有一方第二段为 null，就**算冲突**（单段键位会与同第一段的两段键位相撞）。
// 与 `KeymapPanel.isShortcutConflictAction`（`impl/ui/KeymapPanel.java:565-574`）的三条排除逐字一致：
//   `:566-568` 同 id、`:569-571` `Editor` + `$` 孪生、`:572-573` `use-shortcut-of` 别名。

/** `actionBinding` = 上游 `ActionManagerEx.getActionBinding`（`actionSystem/ex/ActionManagerEx.kt:110`，
 *  实现读 `use-shortcut-of` 建的反向表 `ActionManagerRegistration.kt:253-266`）。
 *  `$default.xml` 里没有 `use-shortcut-of`（它在插件 `plugin.xml` 的 `<actions>` 里），所以默认恒为 undefined。 */
export interface ConflictOptions {
  actionBinding?: (actionId: string) => string | undefined
}

/** `KeymapPanel.isShortcutConflictAction` 的等价物（`impl/ui/KeymapPanel.java:565-574`）。 */
export function isShortcutConflictAction(
  actionId: string, conflictActionId: string, options: ConflictOptions = {},
): boolean {
  if (conflictActionId === actionId) return false
  if (actionId.startsWith('Editor') && conflictActionId === `$${actionId.slice(6)}`) return false
  const useShortcutOf = options.actionBinding?.(conflictActionId)
  return useShortcutOf !== actionId
}

/**
 * `KeymapImpl.getConflicts` 的等价物（`:778-810`）：给一个动作 id 与一组合法键盘键位，
 * 返回「同一第一段键位、且不满足三条排除、且两段式过滤放行」的**其它**动作 → 它们撞上的那条键位。
 * 返回 Map 的键是冲突动作 id，值是该动作上撞车的键位条目（上游值是 `KeyboardShortcut` 列表）。
 */
export function getKeymapConflicts(
  entries: readonly KeymapEntry[], actionId: string, stroke: ParsedStroke,
  second: ParsedStroke | undefined = undefined, options: ConflictOptions = {},
): Map<string, KeymapEntry[]> {
  const result = new Map<string, KeymapEntry[]>()
  for (const entry of entries) {
    if (entry.kind !== 'keyboard' || !entry.stroke) continue
    // ① 第一段键位相等才是候选（上游 :781）。
    if (!sameStroke(entry.stroke, stroke)) continue
    // ②③ 三条排除（上游 :782-790 / KeymapPanel :566-573）。
    if (!isShortcutConflictAction(actionId, entry.actionId, options)) continue
    // ④⑤ 候选那条必须也是键盘键位（上面已判）且第一段相等（上面已判）；
    //     两段式过滤（上游 :799-803）：两边都有第二段且不等才排除，任一方缺第二段都算冲突。
    if (entry.second && second && !sameStroke(entry.second, second)) continue
    const list = result.get(entry.actionId)
    if (list) list.push(entry)
    else result.set(entry.actionId, [entry])
  }
  return result
}

/** 冲突分组（一条 = 一个第一段键位上的冲突集合）。 */
export interface ConflictGroup {
  /** 第一段键位的显示串。 */
  keystroke: string
  /** 撞在同一键位上的动作 id（按注册表顺序，去重）。 */
  actionIds: string[]
  /** 相关条目（按注册表顺序）。 */
  entries: KeymapEntry[]
  /** 分派时最先生效的那个 id —— 见下方 winner 的口径说明。 */
  winner: string
}

/**
 * 整张注册表的冲突清单（**本仓拼装**，上游没有这个聚合函数）：
 * 上游只在「改一个键位」时按 `Keymap.getConflicts` 逐个问（`impl/ui/ShortcutDialog.java:79`），
 * 系统级冲突另走 `SystemShortcuts.getUnmutedKeymapConflicts`（`impl/SystemShortcuts.java:127`）。
 * 本仓需要一个「一键查全表」的入口，所以对每个第一段键位调用同一份判定，不另写判据。
 *
 * `winner` 口径：**注册表顺序靠前者**。这是本仓既有约定（`src/keymapBindings.ts:8-9`
 * 「数组顺序 = 分派优先级」），**不是**上游事实 —— 上游的分派顺序是
 * `ActionManagerEx.registrationOrderComparator`（`actionSystem/impl/ActionManagerImpl.kt:462-469`），
 * 它是运行期注册序，**从 XML 单表推不出来**，故不冒充。
 */
export function keymapConflictGroups(
  entries: readonly KeymapEntry[], options: ConflictOptions = {},
): ConflictGroup[] {
  const byStroke = new Map<string, KeymapEntry[]>()
  for (const entry of entries) {
    if (entry.kind !== 'keyboard' || !entry.stroke) continue
    const key = strokeIdentity(entry.stroke)
    const list = byStroke.get(key)
    if (list) list.push(entry)
    else byStroke.set(key, [entry])
  }
  const groups: ConflictGroup[] = []
  for (const list of byStroke.values()) {
    const ids: string[] = []
    for (const entry of list) if (!ids.includes(entry.actionId)) ids.push(entry.actionId)
    if (ids.length < 2) continue
    // 组内两两判：只要有一对**互相**都算冲突，整组就是冲突组（方向性排除取交集，避免误报）。
    const conflicting = list.some((a, i) => list.some((b, j) => i < j
      && isShortcutConflictAction(a.actionId, b.actionId, options)
      && isShortcutConflictAction(b.actionId, a.actionId, options)
      && secondStrokeCompatible(a, b)))
    if (!conflicting) continue
    groups.push({
      keystroke: keystrokeText(list[0]!.stroke!),
      actionIds: ids,
      entries: list,
      winner: ids[0]!,
    })
  }
  return groups
}

/** 两段式兼容（上游 `:799-803`）：两边都有第二段且不等 ⇒ 不冲突；任一方缺第二段 ⇒ 冲突。 */
function secondStrokeCompatible(a: KeymapEntry, b: KeymapEntry): boolean {
  if (a.second && b.second) return sameStroke(a.second, b.second)
  return true
}

// ── 报告文案（逐字抄上游 `KeyMapBundle.properties`）────────────────────────
//
// 上游 `messages/KeyMapBundle.properties`：
//   · `:34-35` `conflict.shortcut.dialog.message`（改键撞车时的三选一正文）
//   · `:36`    `conflict.shortcut.dialog.title` = Warning
//   · `:37-39` `conflict.shortcut.dialog.remove.button` / `.keep.button` / `.cancel.button`
//   · `:63`    `dialog.conflicts.text` = Already assigned to:
// 三选一的落点在 `impl/ui/KeymapPanel.java:790-799`（`showConfirmationDialog`）与
// `:529-537`（YES ⇒ `removeConflictingShortcuts`，`:576-584`）。

export const CONFLICT_DIALOG_MESSAGE =
  'This shortcut is already assigned to other actions. Do you want to remove the other assignments?'
export const CONFLICT_DIALOG_TITLE = 'Warning'
export const CONFLICT_DIALOG_BUTTONS = { remove: 'Remove', keep: 'Keep', cancel: 'Cancel' } as const
export const CONFLICTS_LABEL = 'Already assigned to:'

/**
 * 冲突清单 → 可读报告。上游只给数据结构（`Keymap.getConflicts` 返回 Map），文本由各 UI 自己拼；
 * 本仓没有键位设置页，所以由这个纯函数拼一份供工具入口复制。没有冲突时**不返回空串**
 * （否则用户分不清「查过没问题」和「按钮坏了」）。
 */
export function keymapConflictReport(
  entries: readonly KeymapEntry[], describe?: (entry: KeymapEntry) => string, options: ConflictOptions = {},
): string {
  const groups = keymapConflictGroups(entries, options)
  const header = `键位冲突检查：${entries.length} 条绑定，${groups.length} 处冲突。`
  if (!groups.length) return `${header}\n同一第一段键位内没有重复绑定。`
  const lines = groups.map((group) => {
    const detail = group.entries
      .map(entry => describe ? describe(entry) : `${entry.actionId}（${entry.source}）`)
      .join('、')
    return `${group.keystroke} —— ${CONFLICTS_LABEL} ${detail}`
  })
  return [header, ...lines].join('\n')
}

/** 上游键位表在本基准树里的位置（相对上游根；解析时由调用方读文件后喂 `parseKeymapXml`）。 */
export const DEFAULT_KEYMAP_XML = 'platform/platform-resources/src/keymaps/$default.xml'