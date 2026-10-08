// 编辑器动作**处理器**的注册与分派 —— 上游 `EditorActionHandler` 挂在
// `com.intellij.editorActionHandler` EP 上的那一层。
//
// 上游形状（逐条核过）：
//   · EP 声明在 `platform/platform-api/resources/intellij.platform.ide.xml:69`：
//     `<extensionPoint qualifiedName="com.intellij.editorActionHandler"
//      beanClass="com.intellij.openapi.editor.actionSystem.EditorActionHandlerBean" dynamic="true">`；
//   · `EditorActionHandlerBean`（`platform/platform-api/src/com/intellij/openapi/editor/actionSystem/EditorActionHandlerBean.java`）
//     的两个属性是 `action`（要接管的动作 id）与 `implementation`（handler 类）；
//   · `EditorActionManagerImpl`（`platform/platform-impl/src/com/intellij/openapi/editor/actionSystem/EditorActionManagerImpl.java`）
//     启动时把 EP 里每条按 `action` 覆盖到对应 `EditorAction` 的 handler；
//   · `EditorActionHandler.execute(Editor, Caret, DataContext)` 约定：**返回 false = 不处理**
//     （`EditorActionHandler.java:59-63`），由调用方回退到下一个 handler / 默认行为。
//
// 本仓此前只有"动作注册表"（`src/actionRegistry.ts` 的 `com.intellij.action`），**没有**按动作 id
// 接管执行的那一层：插件能在菜单/键位里挂一个新动作，却没法给一个**既有**编辑器动作换实现。
// 本文件补上这一层，并把 `ActionRegistry.run` 接过来 —— 于是"按同一 id 挂一个 handler"能真的
// 改掉该动作的执行结果。
//
// 纯数据层：不 import vue/DOM/bridge，便于单测。

import { EDITOR_ACTION_HANDLER_EP, EXTENSIONS, type ExtensionHandle, type RegisterExtensionOptions } from './extensionPoints.ts'

/** `EditorActionHandler.execute` 能看到的编辑器面（本仓的最小集：文件与光标位置）。 */
export interface EditorActionContext {
  /** 当前文件的工作区相对路径；没有打开的编辑器时是空串。 */
  path: string
  /** 0 基行号。 */
  line: number
  /** 0 基列号。 */
  column: number
}

/** 一条处理器（上游 `EditorActionHandlerBean` 的属性面 + `EditorActionHandler.execute` 的行为面）。 */
export interface EditorActionHandlerLike {
  /** 要接管的动作 id（上游 bean 的 `action` 属性）。 */
  action: string
  /**
   * 上游 `EditorActionHandler.execute(...)`：返回 false = 不处理（交回默认）。
   * 与本仓其它 EP 一致，`void` 也当"处理了"。
   */
  handler: (context: EditorActionContext) => boolean | void
}

const HANDLERS = new Map<string, EditorActionHandlerLike>()

/** 宿主注入"当前编辑器状态"的取数函数（本模块不持有编辑器）。 */
let contextProvider: (() => EditorActionContext) | null = null

/** 宿主调用：告诉本模块当前编辑器在哪儿。传 null 撤销（上下文退回空串/0/0）。 */
export function setEditorActionContextProvider(provider: (() => EditorActionContext) | null): void {
  contextProvider = provider
}

function currentContext(): EditorActionContext {
  if (!contextProvider) return { path: '', line: 0, column: 0 }
  try {
    return contextProvider()
  } catch {
    // 取数抛错不该让动作执行半途而废 —— 退回空上下文，handler 自己决定处不处理。
    return { path: '', line: 0, column: 0 }
  }
}

/** 把 EP（`com.intellij.editorActionHandler`）里的处理器收编进本表，返回新收编的条数。 */
function adoptFromExtensions(): number {
  let added = 0
  for (const handler of EXTENSIONS.extensionsOf<EditorActionHandlerLike>(EDITOR_ACTION_HANDLER_EP)) {
    if (!handler || typeof handler.action !== 'string' || !handler.action) continue
    if (typeof handler.handler !== 'function') continue
    if (HANDLERS.has(handler.action)) continue
    HANDLERS.set(handler.action, handler)
    added += 1
  }
  return added
}

/**
 * 按上游同名的 EP id 挂一个编辑器动作处理器。同 id 覆盖（上游 `registerHandler` 的"最后写入赢"）。
 * 注册后立刻收编，于是 `runEditorActionHandler(action)` 当次生效。
 */
export function registerEditorActionHandler(
  handler: EditorActionHandlerLike,
  options: RegisterExtensionOptions = {},
): ExtensionHandle {
  if (!handler || !handler.action) throw new Error('编辑器动作处理器必须有 action。')
  const handle = EXTENSIONS.registerExtension(EDITOR_ACTION_HANDLER_EP, handler.action, handler, options)
  HANDLERS.set(handler.action, handler)
  return handle
}

/** 取消一条处理器（注销 EP 贡献 + 从表里删）。返回是否真的删掉了。 */
export function unregisterEditorActionHandler(action: string): boolean {
  const removed = HANDLERS.delete(action)
  if (removed) EXTENSIONS.unregisterExtension(EDITOR_ACTION_HANDLER_EP, action)
  return removed
}

/** 此刻有处理器的动作 id（诊断/断言用）。 */
export function editorActionHandlerIds(): string[] {
  return [...HANDLERS.keys()]
}

/** 按动作 id 取处理器（上游 `getHandler(actionId)`）。 */
export function editorActionHandlerFor(action: string): EditorActionHandlerLike | undefined {
  return HANDLERS.get(action)
}

/**
 * 分派：有处理器就调它，返回它是否处理了（false = 交回默认）。
 * 没有处理器返回 false —— 调用方照常走自己的默认路径（本仓就是 `ActionRegistry.run` 里的 `descriptor.run()`）。
 */
export function runEditorActionHandler(action: string): boolean {
  const handler = HANDLERS.get(action)
  if (!handler) return false
  return handler.handler(currentContext()) !== false
}

// EP 内容变化时立刻收编（上游 `ExtensionPointListener` 同口径）。
EXTENSIONS.addListener(extensionPoint => {
  if (extensionPoint === EDITOR_ACTION_HANDLER_EP) adoptFromExtensions()
})
adoptFromExtensions()
