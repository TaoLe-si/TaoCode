// **撤销提供者宿主**（上游 `com.intellij.undoProvider` 的真实消费点）—— 把
// `src/ideViewExtensionPoints.ts` 的 `notifyUndoProviders` 接进文件级撤销/重做那条链
// （`src/components/FileTree.vue` 的 Ctrl+Z / Ctrl+Shift+Z）。
//
// 上游是什么：
//   · EP 声明 `com.intellij.undoProvider`（`platform/platform-impl/resources/intellij.platform.ide.impl.xml:197`，
//     `interface="com.intellij.openapi.command.impl.UndoProvider"` dynamic="true"）；出厂那一支是
//     `FileUndoProvider`（`platform/lvcs-impl/resources/intellij.platform.lvcs.impl.xml:124`，
//     类 `platform/lvcs-impl/src/com/intellij/openapi/command/impl/FileUndoProvider.java:37`
//     `implements UndoProvider, BulkFileListener`）。
//   · 方法面只有两个通知：`commandStarted(Project)`（`UndoProvider.java:25`）与
//     `commandFinished(Project)`（`:26`）；消费点是 `UndoManagerImpl.onCommandStarted/onCommandFinished`
//     （`platform/platform-impl/src/com/intellij/openapi/command/impl/UndoManagerImpl.java:278-290`）
//     —— 每条命令起止时逐个 provider 回调。`FileUndoProvider` 拿它维护 `myIsInsideCommand`
//     （`:75-84`），据此决定哪些 VFS 事件算"命令内的、可撤的"。
//
// 本仓此前：`UNDO_PROVIDER_EP` 声明了、`undoProvidersFor()` 也在，但**没有任何调用点**，也没有
// bundled 贡献 —— 第三方按 id 挂的撤销提供者永远收不到命令起止。本模块补两头：
//   ① 把上游那支 `FileUndoProvider` 按同名类名作为 bundled 贡献登记进来（`commandStarted/Finished`
//      维护一个"命令内"标志，就是上游 `myIsInsideCommand` 的等价物）；
//   ② 给出 `runFileUndoRedo()` —— 围绕一次文件级撤销/重做通知全部 provider 的那条链，
//      供 `src/components/FileTree.vue` 在 Ctrl+Z / Ctrl+Shift+Z 上调用。
//
// 与上游的如实差异：上游的 `Project` 收成工作区根字符串；上游靠 VFS 事件总线把命令内的文件事件
// 变成可撤动作，本仓是显式登记（`src/pvFileUndoProvider.ts` 的文件头写明），所以这里只承担
// "命令起止的通知面"，不承担事件收集。
//
// 判据：`tests/undo-provider-host.test.mjs`。

import {
  allUndoProviders, notifyUndoProviders, registerUndoProvider,
  type UndoProviderContribution,
} from './ideViewExtensionPoints.ts'
import type { CommandProcessor, UndoResult } from './pvCommandProcessor.ts'

/** 上游出厂那支的类名（`FileUndoProvider`，`intellij.platform.lvcs.impl.xml:124`）。 */
export const FILE_UNDO_PROVIDER_ID = 'FileUndoProvider'

/** 「命令是否在进行中」——上游 `FileUndoProvider.myIsInsideCommand`（`:41`）的等价物，按工作区根分桶。 */
const insideCommand = new Set<string>()

/** 这个工作区根现在是否在一条命令里（上游 `myIsInsideCommand` 的可读面）。 */
export function isInsideCommand(root: string): boolean {
  return insideCommand.has(root)
}

/** 上游 bundled 那支（`FileUndoProvider.commandStarted/commandFinished`，`:76-84`）。 */
export function fileUndoProvider(): UndoProviderContribution {
  return {
    id: FILE_UNDO_PROVIDER_ID,
    commandStarted: root => { insideCommand.add(root) },
    commandFinished: root => { insideCommand.delete(root) },
  }
}

let registered = false

/** 登记 bundled 的撤销提供者（幂等，与 `src/extensionPoints.ts` 末尾同一纪律）。 */
export function registerBundledFileUndoProvider(): void {
  if (registered) return
  registered = true
  registerUndoProvider(fileUndoProvider(), { source: 'bundled' })
}

// 模块加载即登记（bundled 贡献必须真的在表里，消费端才拿得到）。
registerBundledFileUndoProvider()

/**
 * 围绕一次文件级撤销/重做，按上游 `onCommandStarted` / `onCommandFinished`（`:278-290`）的次序
 * 通知全部撤销提供者：
 *   · 先 `commandStarted`（上游在命令体之前）；
 *   · 跑 `processor[kind](scope)`；
 *   · 最后**无论成败**都 `commandFinished`（上游在 `finally` 里，`:284-286` 的 `finally` 段同形）。
 * 没有提供者时这条链就是一次普通调用（既有行为零改动）。
 */
export async function runFileUndoRedo(
  processor: CommandProcessor, root: string, kind: 'undo' | 'redo', scope: readonly string[] = [],
): Promise<UndoResult> {
  notifyUndoProviders(root, 'started')
  try {
    return await processor[kind](scope)
  } finally {
    notifyUndoProviders(root, 'finished')
  }
}

/** 诊断：当前挂了哪些撤销提供者、各自有没有实现上游那两个 hook。 */
export function undoProviderCatalog(): { id: string; hasCommandHooks: boolean }[] {
  return allUndoProviders().map(provider => ({
    id: provider.id,
    hasCommandHooks: typeof provider.commandStarted === 'function' || typeof provider.commandFinished === 'function',
  }))
}
