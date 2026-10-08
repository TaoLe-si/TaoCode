// exec/console：**控制台执行动作**的判定（上游 `ConsoleExecuteAction` +
// `ConsoleExecuteActionHandler` + `BaseConsoleExecuteActionHandler` 的可移植子集）。
//
// 上游坐标（`platform/lang-impl/src/com/intellij/execution/console/`）：
//   · `ConsoleExecuteAction.java:30` —— 动作 id `Console.Execute`；
//     `:72-85` `update()`：`!editor.isRendererMode() && isEnabled()` 且
//     （允许空命令执行 **或** 文档里不是纯空白）才启用；补全下拉正在选东西时也不启用
//     （`:82-84` 的三道 `lookup` 判定）。
//   · `:97-99` `isEnabled()` = `myEnabledCondition.value(consoleView)`；`ProcessBackedConsoleExecuteActionHandler`
//     的 `value(console)` = `!isProcessTerminated()`（同文件 `:55-57`）——
//     **进程结束了这条动作就不可用**。
//   · `:101-114` `execute(range, text, editor)`：`range == null` 时先补一行提示 + 回显输入
//     （`USER_INPUT`），再 `addToCommandHistoryAndExecute`；有 range 时把那段文本加进历史。
//   · `:118-152` `ConsoleExecuteActionHandler.runExecuteAction`：`myUseProcessStdIn` 分两档 ——
//     **真**（本仓已有）把输入行以 `USER_INPUT` 打进控制台、送进运行中进程的 stdin；
//     **假**（本轮补的判定）`addToCommandHistoryAndExecute` → `doExecute` 交给
//     `BaseConsoleExecuteActionHandler.execute`（`:26-31`），由子类起一个**解释器子进程**
//     并把输出回填（`ProcessBackedConsoleExecuteActionHandler.processLine:32-48` 就是
//     「拼 `line + "\n"`、按控制台编码取字节、写进进程 stdin」）。
//   · `:121` `myUseProcessStdIn` 字段与 `setAddCurrentToHistory`（`:130-132`）。
//
// 本仓的等价物：
//   · stdin 那一档（`useProcessStdIn = true`）已有：`src/runActions.ts` 的 `sendRunInput`
//     → `run.write` → `native/run_host.hpp` 的 `write_line`。
//   · **解释器那一档**（`useProcessStdIn = false`）本轮补齐：判定「这条命令该走哪一档、
//     空命令能不能执行、进程结束/补全打开时可不可用、命令怎么拼字节」——**纯函数**，
//     消费点 `src/components/RunConsole.vue`（当前实例结束后的「解释器」输入行）。
//     与上游的如实差异：上游起的是配置里那个语言解释器（`GeneralCommandLine` 从
//     `RunConfiguration` 拿），本仓没有"每条运行配置一个解释器"的模型，所以解释器命令
//     由**当前运行配置的命令本身**（`interpreterCommand`）给出；没给就不显示这一档。
//
// 判据 `tests/console-execute.test.mjs`。

/** 上游 `ConsoleExecuteAction.java:30`。 */
export const CONSOLE_EXECUTE_ACTION_ID = 'Console.Execute'

/** 空命令执行那一条文案（上游 `ConsoleExecuteAction` 的 `isEmptyCommandExecutionAllowed`）。 */
export interface ConsoleExecuteInput {
  /** 控制台文档里的文本（`editor.getDocument().getCharsSequence()`，`:75-76`）。 */
  text: string
  /** 编辑器是不是 renderer 模式（`:75` 的 `!editor.isRendererMode()`）。 */
  rendererMode: boolean
  /** 允许执行空命令（`isEmptyCommandExecutionAllowed()`，`:76`）。 */
  emptyCommandAllowed: boolean
  /** 补全下拉正在选中某项（`:82-84` 那三道判定的合并结果）。 */
  lookupActive: boolean
  /** 会话条件（上游 `myEnabledCondition` + `ProcessBackedConsoleExecuteActionHandler.value`）。 */
  enabled: boolean
}

/** 上游 `ConsoleExecuteAction.java:72-85` 的 `update()`：这条动作此刻可不可用。 */
export function consoleExecuteEnabled(input: ConsoleExecuteInput): boolean {
  if (input.rendererMode) return false
  if (!input.enabled) return false
  // 允许空命令执行，或文档里确实有非空白内容。
  if (!input.emptyCommandAllowed && input.text.trim() === '') return false
  // 补全下拉正在选东西时按回车是"选补全"而不是"执行命令"。
  if (input.lookupActive) return false
  return true
}

/** 一档执行方式：`stdin` = 写进运行中进程（本仓已有），`interpreter` = 起解释器子进程（本轮补）。 */
export type ConsoleExecuteMode = 'stdin' | 'interpreter'

/** 按 `myUseProcessStdIn` 选执行档（`ConsoleExecuteActionHandler.runExecuteAction`，`:142-152`）。 */
export function consoleExecuteMode(useProcessStdIn: boolean): ConsoleExecuteMode {
  return useProcessStdIn ? 'stdin' : 'interpreter'
}

/** 执行前要往控制台回显的内容（`:103-108`：`USER_INPUT` 的文本 + 一个换行；末尾已有换行就不补）。 */
export function consoleExecuteEcho(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * 解释器那一档的命令行（`ProcessBackedConsoleExecuteActionHandler.processLine:32-34`
 * 的「`line + "\n"` 写进 stdin」在本仓落成一次性执行：`<解释器> -c "<命令>"`）。
 * `quote` 由调用方给（不同解释器引号规则不同；本仓用单引号包住、内部单引号转义）。
 * 命令为空或没有解释器 ⇒ 返回空串（调用方据此不执行、不显示）。
 */
export function interpreterCommand(interpreter: string, line: string): string {
  const program = interpreter.trim()
  const text = line.trim()
  if (!program || !text) return ''
  return `${program} -c '${text.replace(/'/g, `'\\''`)}'`
}

/**
 * 解释器那一档可不可用（`:55-57` 的 `!isProcessTerminated()` 反过来 —— 上游"进程结束就不能执行"，
 * 本仓解释器档**正是**给"运行已结束"时继续试命令用的，所以这一档的可用性与进程存活**无关**，
 * 只要求有解释器命令）。差异写在这里：上游的解释器在运行配置里，本仓没有那层，只能这样还原。
 */
export function interpreterAvailable(interpreter: string): boolean {
  return interpreter.trim().length > 0
}