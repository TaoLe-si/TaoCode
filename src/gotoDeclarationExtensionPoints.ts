// **「转到声明」与目标呈现的扩展点**（上游 `com.intellij.codeInsight.navigation` 一族在本仓的等价物）。
//
// 上游是什么：两条 EP ——
//   · `com.intellij.gotoDeclarationHandler`（`GotoDeclarationHandler.java:21` 的 `EP_NAME`，
//     声明在 `platform/analysis-api/resources/intellij.platform.analysis.xml:79-80`，
//     `interface="…GotoDeclarationHandler"` `dynamic="true"`）：每个语言插件挂自己的处理器，
//     平台把它们的结果汇起来交给「转到声明」动作 —— 接口方法面 `getGotoDeclarationTargets(sourceElement,
//     offset, editor)`（`GotoDeclarationHandler.java:27`）与 `getActionText(context)`（`:35`，default 返回 null）。
//   · `com.intellij.gotoTargetPresentationProvider`（`GotoTargetPresentationProvider.java:16` 的 `EP_NAME`，
//     声明在 `platform/lang-impl/resources/intellij.platform.lang.impl.xml:270`）：多目标弹层里
//     每个目标怎么呈现 —— `getTargetPresentation(element, differentNames)`（`:26`）。
//     该参的口径以上游**实现**为准：`GotoTargetHandler.java:386` 的 `hasDifferentNames = myNames.size() > 1`
//     （弹层里名字不止一种时为真）；`GotoTargetPresentationProvider.java:21` 的 javadoc 把它写反了，
//     本仓按实现口径（`differentNames = 名字不全相同`）。
//
// 本仓此前：Ctrl+B 的解析链写死在 `src/declarationNavigation.ts`（一条 `lsp.request kind:'definition'`），
// 弹层行模型写死在 `src/chooseTarget.ts` 的 `targetRow` —— 两侧都**没有插件 EP 宿主**：
// 第三方（或测试）无法按 id 挂一个声明处理器，也无法改多目标弹层里某个目标的名字/容器。
// 本文件补上那一层，形状照 `src/gotoByNameContributors.ts`（同族的 ChooseByName 三个 EP 已在盘上）：
//   · 两条 EP 用 `src/extensionPoints.ts` 的 `EXTENSIONS.declareExtensionPoint()` 声明，id 逐字取自上游；
//   · 处理器的可移植子集：`accepts`（本仓没有 PSI，用 (路径, 行列) 代替 `sourceElement`）、
//     `getGotoDeclarationTargets`（返回本仓的目标形状 `TargetLocation`，允许同步或异步 ——
//     本仓的声明来源是语言服务，天生异步）、`getActionText`（`:35`）；
//   · 呈现提供者的可移植子集：`getTargetPresentation(target, differentNames)` 返回
//     `name`/`container`/`position` 三段里要覆盖的那几段（缺省字段不动，等价于上游返回 null）。
//
// 消费链：`src/declarationNavigation.ts` 的 `revealDefinition` 改为先收**全部 EP 处理器**的结果、
// 再并上宿主的 LSP 通道（`builtin`），合并去重后走原来的单目标直跳/多目标弹层；
// `src/chooseTarget.ts` 的 `chooseTargetRows` 在折完行模型后按 `createTargetPresentationProvider`
// 那一族覆盖三段（`differentNames` = 全表同名，照上游 :21-24 的语义）。
//
// 与上游的如实差异：① 没有 PSI，`sourceElement`/`PsiElement` 收成 `DeclarationRequest`（路径 + 0 基行列）；
// ② 上游处理器是同步的（读 PSI），本仓允许返回 Promise（语言服务请求）；③ `getActionText` 保留形状但
// 本仓的动作标题是 `src/editorKeymap.ts` 的静态表，没有第二处消费点，故不假装接上。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。
//
// 判据：`tests/goto-declaration-extension-points.test.mjs`。

import { APPLICATION_SCOPE, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'
import type { ChooseTargetRow, TargetLocation } from './chooseTarget.ts'

/** 转到声明处理器 EP（逐字取自上游 `GotoDeclarationHandler.java:21` 的 `ExtensionPointName.create`）。 */
export const GOTO_DECLARATION_HANDLER_EP = 'com.intellij.gotoDeclarationHandler'
/** 目标呈现提供者 EP（逐字取自上游 `GotoTargetPresentationProvider.java:16`）。 */
export const GOTO_TARGET_PRESENTATION_PROVIDER_EP = 'com.intellij.gotoTargetPresentationProvider'

/** 一次「转到声明」请求：本仓没有 PSI 元素，用位置代替（`line`/`character` 是 LSP 的 0 基坐标）。 */
export interface DeclarationRequest {
  path: string
  line: number
  character: number
}

/** 一条处理器贡献（上游 `GotoDeclarationHandler` 的可移植子集）。 */
export interface GotoDeclarationHandler {
  id: string
  /**
   * 这条处理器管不管这个请求（缺省全收，照上游处理器自己在 `getGotoDeclarationTargets` 里判断 PSI 元素类型）。
   * 上游没有这个方法 —— 它的等价物是处理器内部对 `sourceElement` 的类型检查。
   */
  accepts?: (request: DeclarationRequest) => boolean
  /** 上游 `getGotoDeclarationTargets(sourceElement, offset, editor)`（`:27`）；空表 = 这条不产目标。 */
  getGotoDeclarationTargets: (request: DeclarationRequest) => readonly TargetLocation[] | Promise<readonly TargetLocation[]>
  /** 上游 `getActionText(context)` 的只读形态（`:35`）；本仓动作标题是静态表，故只保留形状。 */
  getActionText?: () => string | null
}

/** 两条 EP 的声明（幂等：重复调用只覆盖同名声明）。 */
export function declareGotoDeclarationExtensionPoints(): void {
  EXTENSIONS.declareExtensionPoint({
    id: GOTO_DECLARATION_HANDLER_EP, name: '转到声明处理器', scope: APPLICATION_SCOPE, dynamic: true,
  })
  EXTENSIONS.declareExtensionPoint({
    id: GOTO_TARGET_PRESENTATION_PROVIDER_EP, name: '导航目标呈现提供方', scope: APPLICATION_SCOPE, dynamic: true,
  })
}

declareGotoDeclarationExtensionPoints()

/** 按 id 注册一条处理器（同 id 覆盖，与 `ExtensionPointHost.registerExtension` 同口径）。 */
export function registerGotoDeclarationHandler(
  handler: GotoDeclarationHandler,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(GOTO_DECLARATION_HANDLER_EP, handler.id, handler, options)
}

/** 注销一条处理器（返回是否真的删掉了）。 */
export function unregisterGotoDeclarationHandler(id: string): boolean {
  return EXTENSIONS.unregisterExtension(GOTO_DECLARATION_HANDLER_EP, id)
}

/** 当前作用域下的全部处理器（已按 `LoadingOrder` 排好）。 */
export function gotoDeclarationHandlers(scope: string = APPLICATION_SCOPE): GotoDeclarationHandler[] {
  return EXTENSIONS.extensionsOf<GotoDeclarationHandler>(GOTO_DECLARATION_HANDLER_EP, scope)
}

/**
 * 同一个位置只留一条（`Location[]` 允许重复；上游的目标是元素集合、天然不重复）。
 * 与 `src/chooseTarget.ts` 的 `chooseTargetRows` 用同一把身份钥匙（路径 + 0 基行列）。
 */
export function dedupeDeclarationTargets(targets: readonly TargetLocation[]): TargetLocation[] {
  const seen = new Set<string>()
  const out: TargetLocation[] = []
  for (const target of targets) {
    const key = `${target.path}:${target.line}:${target.character}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

/**
 * 收全部 EP 处理器的目标，并上宿主自己的通道（`builtin` = LSP `textDocument/definition`）。
 *
 * 顺序：先按 EP 顺序逐条，再并 `builtin` —— 上游把 LSP 也做成一条贡献排在插件表里，
 * 本仓的 LSP 请求依赖编辑器实例（闭包不稳），所以由宿主每次调用时作为 `builtin` 传进来，
 * 位置等价于「排在最后的一条内置贡献」。
 *
 * 单条处理器抛错只丢这条（上游 `ExtensionPoint` 的异常隔离同口径），不影响其余处理器与宿主通道。
 */
export async function collectDeclarationTargets(
  request: DeclarationRequest,
  builtin: readonly TargetLocation[] | Promise<readonly TargetLocation[]> = [],
  scope: string = APPLICATION_SCOPE,
): Promise<TargetLocation[]> {
  const collected: TargetLocation[] = []
  for (const handler of gotoDeclarationHandlers(scope)) {
    if (handler.accepts && !handler.accepts(request)) continue
    try {
      collected.push(...await handler.getGotoDeclarationTargets(request))
    } catch { /* 单条处理器失败不拖垮整条链 */ }
  }
  try {
    collected.push(...await builtin)
  } catch { /* 宿主通道失败时其余处理器的结果照常返回 */ }
  return dedupeDeclarationTargets(collected)
}

/** 三段里要覆盖的那几段（缺省字段不动；与上游返回 null 等价的是整条 `null`）。 */
export interface GotoTargetPresentation {
  name?: string
  container?: string
  position?: string
}

/** 一条呈现贡献（上游 `GotoTargetPresentationProvider` 的可移植子集）。 */
export interface GotoTargetPresentationProvider {
  id: string
  /** 只管哪些目标（缺省全收）。 */
  accepts?: (target: TargetLocation) => boolean
  /** 上游 `getTargetPresentation(element, differentNames)`（`:26`）；返回 null = 不覆盖。 */
  getTargetPresentation: (target: TargetLocation, differentNames: boolean) => GotoTargetPresentation | null
}

/** 按 id 注册一条呈现贡献。 */
export function registerGotoTargetPresentationProvider(
  provider: GotoTargetPresentationProvider,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  return EXTENSIONS.registerExtension(GOTO_TARGET_PRESENTATION_PROVIDER_EP, provider.id, provider, options)
}

/** 注销一条呈现贡献（返回是否真的删掉了）。 */
export function unregisterGotoTargetPresentationProvider(id: string): boolean {
  return EXTENSIONS.unregisterExtension(GOTO_TARGET_PRESENTATION_PROVIDER_EP, id)
}

/** 当前作用域下的全部呈现贡献（已按 `LoadingOrder` 排好）。 */
export function gotoTargetPresentationProviders(scope: string = APPLICATION_SCOPE): GotoTargetPresentationProvider[] {
  return EXTENSIONS.extensionsOf<GotoTargetPresentationProvider>(GOTO_TARGET_PRESENTATION_PROVIDER_EP, scope)
}

/**
 * 取第一条非空呈现（上游 `GotoTargetPresentationProvider.getTargetPresentationFromProviders` 的
 * for 循环 + 首个非 null 返回，`:33-41`）。
 */
export function gotoTargetPresentation(
  target: TargetLocation,
  differentNames: boolean,
  scope: string = APPLICATION_SCOPE,
): GotoTargetPresentation | null {
  for (const provider of gotoTargetPresentationProviders(scope)) {
    if (provider.accepts && !provider.accepts(target)) continue
    const presentation = provider.getTargetPresentation(target, differentNames)
    if (presentation) return presentation
  }
  return null
}

/**
 * 把呈现覆盖套到一行上（`chooseTargetRows` 的消费点）：
 * 只替换提供了的段，其余保持 `targetRow` 算出的默认值；没有任何覆盖时原样返回同一个对象。
 */
export function applyTargetPresentation(
  row: ChooseTargetRow,
  target: TargetLocation,
  differentNames: boolean,
  scope: string = APPLICATION_SCOPE,
): ChooseTargetRow {
  const presentation = gotoTargetPresentation(target, differentNames, scope)
  if (!presentation) return row
  return {
    ...row,
    ...(presentation.name === undefined ? {} : { name: presentation.name }),
    ...(presentation.container === undefined ? {} : { container: presentation.container }),
    ...(presentation.position === undefined ? {} : { position: presentation.position }),
  }
}

/** 全表是否同名（上游 `GotoTargetHandler.java:386` 的 `myNames.size() > 1` 取反；< 2 行按「不同名」）。 */
export function allTargetNamesEqual(rows: readonly ChooseTargetRow[]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]?.name ?? ''
  return rows.every(row => row.name === first)
}
