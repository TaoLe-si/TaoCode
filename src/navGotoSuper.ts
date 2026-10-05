// Ctrl+U「转到父方法 / 父类或接口」（`lp/navigation` 判词里那条 `GotoSuperAction`）。
//
// 上游依据（逐条）：
//   · 动作与键位：`platform/lang-impl/src/com/intellij/codeInsight/navigation/actions/GotoSuperAction.java:24-83`
//     —— 动作本体只是按语言取 `CodeInsightActions.GOTO_SUPER`（`:61`，EP 声明在
//     `platform/lang-api/resources/intellij.platform.lang.xml:82`），Java 那份是
//     `java/java-backend/resources/META-INF/JavaPlugin.xml:782` 注册的
//     `com.intellij.codeInsight.navigation.JavaGotoSuperHandler`。
//   · 键位：`platform/platform-resources/src/keymaps/$default.xml:251-253` ——
//     `<action id="GotoSuperMethod"><keyboard-shortcut first-keystroke="control U"/></action>`。
//     **注意动作 id 是 `GotoSuperMethod`**（不是判词里写的 `GotoSuperClass`；标题才分两档，见下）。
//   · 取"当前元素"：`JavaGotoSuperHandler.java:68` —— `PsiTreeUtil.getNonStrictParentOfType(element,
//     PsiMethod.class, PsiClass.class)`：**非严格**，即光标正落在方法/类自己的名字上也算，
//     而且是「方法或类里最内层的那一个」。
//   · 两档分支：`:56-74` —— 拿到元素后统一交给 `FindSuperElementsHelper.findSuperElements`；
//     `:44-51` 决定弹层标题：结果是方法 → `goto.super.method.chooser.title`
//     （`platform/lang-api/resources/messages/CodeInsightBundle.properties:118` = "Choose super method"），
//     否则 → `goto.super.class.chooser.title`
//     （`java/openapi/resources/messages/JavaBundle.properties:317` = "Choose super class or interface"）。
//   · 动作标题**随光标下的元素变**：`:91-103` —— 类 → `action.GotoSuperClass.text`
//     （`JavaBundle.properties:29` "Go to S_uper Class or Interface"，主菜单短形式 `:30`），
//     方法 → `action.GotoSuperMethod.text`（`platform/platform-resources-en/src/messages/ActionsBundle.properties:698`
//     "Go to Super Method"，主菜单短形式 `:699` "S_uper Method"）。
//   · 一行一个目标、多个目标开选择弹层：`:41-53` 的 `PsiTargetNavigator`（与 `src/chooseTarget.ts`
//     承接的 `GotoTargetHandler` 同一族）；`:45` `allMethodsHaveSameSignature` 决定弹层要不要显示方法名。
//   · 「找不到」的文案口径参照同族的 `GotoTestOrCodeHandler.getNotFoundMessage`
//     （`platform/lang-impl/src/com/intellij/testIntegration/GotoTestOrCodeHandler.java:132-134`）——
//     上游 `JavaGotoSuperHandler` 自己没目标时是**静默**的（`PsiTargetNavigator` 空表什么都不做），
//     本仓按同族口径给一条提示，差异如实记在这里。
//
// 架构不等价处（负责人 2026-10-05 指示按本仓架构还原用户可见功能）：
//   · LSP **没有**「父方法」请求（`textDocument/typeHierarchy` 只有 supertypes/subtypes 两层，
//     不回答"这个方法覆写了谁的"）。本仓的等价链路是：
//       类 → `prepareTypeHierarchy` + `typeHierarchySupertypes`（协议里真有，`src/hierarchyView.ts` 同一批请求）；
//       方法 → 先取**宿主类**的父类型集合，再到每个父类型的 `documentSymbol` 里找
//             **同名 + 同参数个数**的成员。这就是上游 `findSuperElements` 的
//             `MethodSignatureUtil.isSuperMethod`（按名字+签名匹配）在"只有符号表"条件下的最近似。
//     已知差异：签名只比参数**个数**（LSP 的 `detail` 在 JDT 里是可选的、类型串比对不可靠），
//     所以"同名不同参的重载"在极端情况下会被当成父方法 —— 弹层里仍然显示全部候选，用户看得见。
//   · 库类型（`*-sources.jar` 里没有 documentSymbol 的那些）拿不到成员 → 该父类型跳过
//     （同 `src/hierarchyView.ts:68-74` 的 `mapNotNull` 口径：解析不出就不画一行点不动的假节点）。
//
// 消费链路：`src/menus/navigateMenu.ts` 的两行菜单（标题随光标变，同上游 `update`）；
// 动作本体由宿主（`src/App.vue`，冻结文件）装配 —— 接线见 `docs/wiring-requests-2026-10-06-bucket4.md`。
// 判据：`tests/nav-goto-super.test.mjs`。
import type { LspDocumentSymbol } from './bridge.ts'
import { CLASS_LIKE_SYMBOL_KINDS } from './lspSymbolBridge.ts'
import type { TargetLocation } from './chooseTarget.ts'

/** 方法/函数/构造器（LSP `SymbolKind` 的 6/9/12；上游对应 `PsiMethod`，构造器也算）。 */
export const SUPER_METHOD_KINDS: ReadonlySet<number> = new Set([6, 9, 12])

/** 类那一档 = 上游 `PsiClass` 的四类（Class/Enum/Interface/Struct），与 Ctrl+N 同源（`src/lspSymbolBridge.ts:58`）。 */
export const SUPER_CLASS_KINDS: ReadonlySet<number> = CLASS_LIKE_SYMBOL_KINDS

export type SuperRole = 'class' | 'method'

export interface EnclosingSuperTarget {
  role: SuperRole
  /** 光标所在的那个符号（类或方法）。 */
  element: LspDocumentSymbol
  /** 方法所在的类；`role === 'class'` 时为 null。 */
  owner: LspDocumentSymbol | null
}

/**
 * 取"当前元素"：`JavaGotoSuperHandler.java:68` 的 `getNonStrictParentOfType(element, PsiMethod, PsiClass)` ——
 * 在所有**包含光标行**的符号里取最内层的那一个，且只认方法/类两档（字段、变量、参数一律不算，
 * 上游那两个 class 参数就是白名单）。区间判定含端点（`startLine <= line <= endLine`，
 * 这正是"非严格"的意思：光标停在方法签名行上，父元素就是该方法）。
 */
export function enclosingSuperTarget(symbols: readonly LspDocumentSymbol[], line: number): EnclosingSuperTarget | null {
  if (!Number.isInteger(line)) return null
  const enclosing = symbols
    .filter(symbol => symbol.startLine <= line && line <= symbol.endLine)
    .filter(symbol => SUPER_METHOD_KINDS.has(symbol.kind) || SUPER_CLASS_KINDS.has(symbol.kind))
    // 最内层 = 起点最大；起点相同时取**区间最小**的那一个（同一行上「外层类 + 内层方法」时方法胜出，
    // 这正是 `getNonStrictParentOfType` 的语义）。旧写法这里把方向写反了（区间大的排前面），
    // 由 `tests/nav-goto-super.test.mjs` 的同行用例抓到并改正。
    .sort((left, right) => right.startLine - left.startLine || (left.endLine - left.startLine) - (right.endLine - right.startLine))
  const element = enclosing[0]
  if (!element) return null
  if (SUPER_METHOD_KINDS.has(element.kind)) {
    const owner = enclosing.find(symbol => symbol !== element && SUPER_CLASS_KINDS.has(symbol.kind)) ?? null
    return { role: 'method', element, owner }
  }
  return { role: 'class', element, owner: null }
}

/**
 * 参数个数：LSP 的 `DocumentSymbol.name` 在 JDT 下常写成 `Foo.bar(String a, int b)`，
 * `detail` 有时是 `(String)`、有时是空。两处都试，取能解析出括号的那一份。
 * 括号内按**顶层逗号**计数（`Map<String, Integer>` 里的逗号不算），空括号 = 0。
 * 解析不出括号返回 `null`（= 未知，比对时降级为"只比名字"）。
 */
export function parameterCount(symbol: { name?: string; detail?: string }): number | null {
  for (const text of [symbol.name ?? '', symbol.detail ?? '']) {
    const open = text.lastIndexOf('(')
    const close = text.lastIndexOf(')')
    if (open < 0 || close < open) continue
    const inside = text.slice(open + 1, close).trim()
    if (!inside) return 0
    let depth = 0
    let count = 1
    for (const char of inside) {
      if (char === '(' || char === '<' || char === '[') depth += 1
      else if (char === ')' || char === '>' || char === ']') depth -= 1
      else if (char === ',' && depth === 0) count += 1
    }
    return count
  }
  return null
}

/** 名字（去掉 JDT 那份 `Foo.bar(...)` 的前缀与括号尾巴）。 */
export function symbolBaseName(name: string): string {
  const head = (name ?? '').split('(')[0].trim()
  const dot = head.lastIndexOf('.')
  return dot >= 0 ? head.slice(dot + 1) : head
}

/**
 * 在某个父类型的符号表里找该方法的父方法：
 * 同名（`symbolBaseName` 相等）+ 参数个数能对上（任一方未知时只比名字，见文件头的差异说明）。
 * 顺序保持父类型表里的原序（上游 `findSuperElements` 也不重排）。
 */
export function superMethodsIn(symbols: readonly LspDocumentSymbol[], method: LspDocumentSymbol): LspDocumentSymbol[] {
  const wanted = symbolBaseName(method.name)
  if (!wanted) return []
  const mine = parameterCount(method)
  return symbols.filter(symbol => {
    if (!SUPER_METHOD_KINDS.has(symbol.kind)) return false
    if (symbolBaseName(symbol.name) !== wanted) return false
    const theirs = parameterCount(symbol)
    return mine === null || theirs === null || mine === theirs
  })
}

/**
 * 弹层标题（两档，`JavaGotoSuperHandler.java:47/:50`）。
 * 上游方法那一档还按 `allMethodsHaveSameSignature`（`:45`）决定要不要在标题之外显示方法名 ——
 * 本仓的弹层（`src/chooseTarget.ts`）每行本来就带名字，所以这一段没有可省的：
 * 谓词照样导出，供调用方决定"全部同签名时不额外标注签名"。
 */
export function gotoSuperChooserTitle(role: SuperRole): string {
  return role === 'method' ? '选择父方法' : '选择父类或接口'
}

/** 动作标题（`update` 的两档 + 主菜单短形式；上游助记符下划线在中文里没有对应物，去掉）。 */
export function gotoSuperActionLabel(role: SuperRole, mainMenu = false): string {
  if (role === 'class') return mainMenu ? '父类或接口' : '转到父类或接口'
  return mainMenu ? '父方法' : '转到父方法'
}

/** 找不到时的提示（同族口径见文件头；上游这一条是静默的）。 */
export function gotoSuperNotFoundMessage(role: SuperRole): string {
  return role === 'method' ? '没有找到父方法。' : '没有找到父类或接口。'
}

/** 全部候选同签名（上游 `PsiUtil.allMethodsHaveSameSignature`，`JavaGotoSuperHandler.java:45`）。 */
export function allSameSignature(targets: readonly { name?: string; detail?: string }[]): boolean {
  if (targets.length <= 1) return true
  const signature = (item: { name?: string; detail?: string }) => {
    const text = item.detail && item.detail.trim() ? item.detail : item.name ?? ''
    const open = text.indexOf('(')
    return open < 0 ? symbolBaseName(text) : text.slice(open).replace(/\s+/g, '')
  }
  const first = signature(targets[0]!)
  return targets.every(item => signature(item) === first)
}

export interface GotoSuperDeps {
  /** 语言服务的请求通道（与 `src/hierarchyView.ts` 同一批 `lsp.request` kind）。 */
  request: <T>(method: 'lsp.request', params: Record<string, unknown>) => Promise<T>
  /** 当前文件与光标（0 基行列，与 LSP 同口径）。 */
  path: () => string
  line: () => number
  character: () => number
  /** 当前文件的 `documentSymbol` 结果（结构视图那份）。 */
  outline: () => readonly LspDocumentSymbol[]
  /** 单个目标时的跳转（`column` 是 1 基，同 `src/declarationNavigation.ts` 的口径）。 */
  reveal: (target: { path: string; line: number; column?: number }) => void
  /** 多个目标时的选择弹层（`src/chooseTargetHost.ts` 的那个）。 */
  openChooser: (targets: readonly TargetLocation[], title: string) => void
  notify: (message: string, error?: boolean) => void
}

/** 层级条目的字段口径同 `src/bridge.ts` 的 `LspHierarchyItem`。 */
interface HierarchyItem { name: string; kind: number; path: string; detail?: string; line?: number; character?: number }
/** `lsp.request` 的层级回包：`typeHierarchy*` 走 `items`，`callHierarchy*` 走 `calls`（见 `src/hierarchyView.ts:117`）。 */
interface HierarchyReply { available?: boolean; items?: HierarchyItem[]; calls?: HierarchyItem[] }
interface SymbolsReply { available?: boolean; symbols?: LspDocumentSymbol[] }

/**
 * 跑一次 Ctrl+U。返回用到的目标数（0 = 没找到，判据与宿主提示都用它）。
 */
export async function runGotoSuper(deps: GotoSuperDeps): Promise<number> {
  const path = deps.path()
  if (!path) { deps.notify(gotoSuperNotFoundMessage('class'), true); return 0 }
  const target = enclosingSuperTarget(deps.outline() ?? [], deps.line())
  if (!target) { deps.notify(gotoSuperNotFoundMessage('method'), true); return 0 }
  // 宿主类：方法那一档要拿**类**去问父类型（上游 `findSuperElements(PsiMethod)` 内部也是走类的继承链）。
  const classSymbol = target.role === 'class' ? target.element : target.owner
  if (!classSymbol) { deps.notify(gotoSuperNotFoundMessage(target.role), true); return 0 }

  let supertypes: HierarchyItem[] = []
  try {
    const prepared = await deps.request<HierarchyReply>('lsp.request', {
      kind: 'prepareTypeHierarchy', path, line: classSymbol.startLine,
      // 类名的行内位置：`startChar` 是 documentSymbol 给的起点（比 characterOfLine 更准）。
      character: classSymbol.startChar ?? 0,
    })
    const root = prepared.items?.[0]
    if (!root) { deps.notify(gotoSuperNotFoundMessage(target.role), true); return 0 }
    const replied = await deps.request<HierarchyReply>('lsp.request', { kind: 'typeHierarchySupertypes', path, item: root })
    supertypes = replied.items ?? replied.calls ?? []
  } catch {
    deps.notify(gotoSuperNotFoundMessage(target.role), true)
    return 0
  }
  if (!supertypes.length) { deps.notify(gotoSuperNotFoundMessage(target.role), true); return 0 }

  const found: TargetLocation[] = []
  if (target.role === 'class') {
    // 类 → 父类型本身就是目标（`typeHierarchySupertypes` 的顺序 = 父类在前、接口在后，照抄不重排）。
    for (const item of supertypes) if (item.path) found.push({ path: item.path, line: item.line ?? 0, character: item.character ?? 0 })
  }
  else {
    for (const item of supertypes) {
      if (!item.path) continue
      let symbols: LspDocumentSymbol[] = []
      try {
        const replied = await deps.request<SymbolsReply>('lsp.request', { kind: 'documentSymbol', path: item.path })
        symbols = replied.symbols ?? []
      } catch { /* 库类型/未打开的文件没有符号表：跳过这一档（不画假节点） */ }
      for (const symbol of superMethodsIn(symbols, target.element))
        found.push({ path: item.path, line: symbol.startLine, character: symbol.startChar ?? 0 })
    }
  }
  if (!found.length) { deps.notify(gotoSuperNotFoundMessage(target.role), true); return 0 }
  const title = gotoSuperChooserTitle(target.role)
  if (found.length === 1) { const only = found[0]!; deps.reveal({ path: only.path, line: only.line, column: only.character + 1 }) }
  else deps.openChooser(found, title)
  return found.length
}

/** 供 `src/hierarchyView.ts` 与菜单复用：这一档的父类型目标（纯映射，不发请求）。 */
export function supertypeTargets(items: readonly { path: string; line?: number; character?: number }[]): TargetLocation[] {
  return items.filter(item => !!item.path).map(item => ({ path: item.path, line: item.line ?? 0, character: item.character ?? 0 }))
}
