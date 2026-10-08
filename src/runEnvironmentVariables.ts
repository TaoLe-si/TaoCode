// 运行配置的「环境变量」编辑模型 —— 上游 `EnvironmentVariablesData`（数据）+ 环境变量对话框里的
// 用户变量表（编辑面）在本仓架构下的等价物。
//
// 上游出处（本机上游树，逐条读过）：
//   platform/execution-impl/src/com/intellij/execution/configuration/EnvironmentVariablesData.java:21-56/129-158
//       模型 = `Map<String, String> envs`（**保留用户书写顺序**，:36-38 的 LinkedHashMap）+ `passParentEnvs`
//       （:54 `isPassParentEnvs`）+ `environmentFile`；`DEFAULT` = 空表 + 继承（:24）。
//       读档缺 `PASS_PARENT_ENVS` 键 = **true**（:88-89）。
//   platform/execution-impl/src/com/intellij/execution/configuration/EnvironmentVariablesDialog.java:176-198
//       用户表逐行验收：名字非法 → `run.configuration.invalid.env.name`（:180-181）、
//       值非法 → `run.configuration.invalid.env.value`（:183-184）；
//       **名字与值都空的行跳过**（:195-196 `if (isEmpty(name) && isEmpty(value)) continue`）。
//   platform/util/src/com/intellij/util/EnvironmentUtil.java:118-120/128-130
//       `isValidName` = 非空 && 无 NUL && 不含 `=`（Windows 从下标 1 起才允许 `=`）；
//       `isValidValue` = 无 NUL。
//   文案原文（本地树**没有 zh 本地化包** ⇒ 直译，与 `src/runConfigTree.ts:238` 同一口径）：
//       platform/platform-util-io/resources/messages/IdeUtilIoBundle.properties:9-10。
//
// 本仓形状（**持久格式不变**）：`RunConfig.env` 仍是 `KEY=VALUE` 行数组（`src/settingsModel.ts:41`），
// 宿主按同一形状收（`native/run_host.cpp:424-434` 的 KEY=VALUE 校验、`native/runner.cpp:42-56` 的
// 覆盖合并：同名**后写的赢**、`=` 在下标 0 的行直接丢弃）。所以这里的行 ⇄ 行对换是**双射**，
// 编辑面能逐格改而不用动 schema / 宿主 / 落盘白名单。
//
// 如实登记的差异：
//   · 上游允许 Windows 上名字以 `=` 开头（`isValidName` 的 `OS.CURRENT == OS.Windows ? 1 : 0`）——
//     本仓的行格式 `NAME=VALUE` 表达不了这种名字（宿主 `runner.cpp:43-44` 也把它们当不可用丢掉）
//     ⇒ 名字里含 `=` 一律按非法报，不做平台分支。
//   · 上游的「包含系统环境变量」勾选（`EnvironmentVariablesDialog.java:79` 的
//     `env.vars.system.include.title`，勾上会把系统环境**写进**配置）与「环境变量文件」
//     （`EnvFilesOptions`/`EnvFilesDialog`）都不渲染：本仓的运行通道**永远在继承来的环境之上叠**
//     （`native/runner.hpp:30`），取消继承这一档没有承载（与 `src/externalTaskSettings.ts:34`、
//     `src/components/GradlePanel.vue:436` 对同一勾选的判决一致 —— 画了就是假控件）。
//   · 上游的行编辑器能贴一整段（`EnvVariablesTable` 的粘贴近路）与列出系统变量表；本仓的编辑面是
//     逐行表 + 文本框两处入口（`src/components/EnvironmentVariablesEditor.vue` 与
//     `src/App.vue:2302` 的内联框），系统变量表缺（前端读不到进程环境，宿主也没有枚举路由）。
// 判据 tests/run-environment-variables.test.mjs。

/** 一行环境变量（上游用户变量表里的一行）。 */
export interface EnvVarRow {
  name: string
  value: string
}

/** 名字非法时的那一句（上游 `run.configuration.invalid.env.name` 的直译）。 */
export function envVarNameProblem(name: string): string | null {
  // 上游 `EnvironmentUtil.isValidName`（:118-120）：空 / 含 NUL / 含 `=` 都非法。
  if (!name) return '环境变量名非法：名字不能为空。'
  if (name.includes('\u0000')) return `环境变量名非法：'${name}'。`
  if (name.includes('=')) return `环境变量名非法：'${name}'。`
  return null
}

/** 值非法时的那一句（上游 `run.configuration.invalid.env.value` 的直译；上游只禁 NUL）。 */
export function envVarValueProblem(value: string): string | null {
  return value.includes('\u0000') ? `环境变量值非法：'${value}'。` : null
}

/**
 * 一行的形状判据（**宿主契约** + 上游那两条）：
 * 先按 `KEY=VALUE` 行形状查（`native/run_host.cpp:424-434`：没有 `=` 或 `=` 在下标 0 都是
 * `INVALID_REQUEST`），再查名字/值。行的切分口径 = 上游 `EnvironmentVariablesComponent.splitVars`
 * 的 `indexOf('=')`（`EnvironmentVariablesComponent.java:135-145`，只按**第一个** `=` 切）。
 */
export function envLineProblem(line: string): string | null {
  const at = line.indexOf('=')
  if (at < 0) return `环境变量要写成 KEY=VALUE：「${line}」不合法。`
  const row = { name: line.slice(0, at), value: line.slice(at + 1) }
  return envRowProblem(row)
}

/** 行对的问题（名字 + 值；两个都空的行是合法的空行，上游在 apply 时跳过）。 */
export function envRowProblem(row: EnvVarRow): string | null {
  if (!row.name && !row.value) return null
  return envVarNameProblem(row.name) ?? envVarValueProblem(row.value)
}

/** 整个清单的第一条问题（顺序即用户书写顺序，与上游逐行 `return` 第一个 `ValidationInfo` 一致）。 */
export function envVarsProblem(lines: readonly string[]): string | null {
  for (const line of lines) {
    const problem = envLineProblem(line)
    if (problem) return problem
  }
  return null
}

/**
 * 行 → 行对。按**第一个** `=` 切（上游 `splitVars` 口径）；没有 `=` 的行整串当名字、值留空
 * （它是本仓才有的畸形行 —— 上游的模型是 map，不会有这种输入 ⇒ 交给 `envLineProblem` 报出来，
 * 不静默丢）。
 */
export function envRowsFromLines(lines: readonly string[]): EnvVarRow[] {
  return lines.map(line => {
    const at = line.indexOf('=')
    return at < 0 ? { name: line, value: '' } : { name: line.slice(0, at), value: line.slice(at + 1) }
  })
}

/**
 * 行对 → 行。**两个都空的行不写**（上游 `EnvironmentVariablesDialog.java:195-196` 的跳过那条）；
 * 名字为空而值非空时写成 `=VALUE` —— 校验会把它报成名字非法（不静默丢用户输入）。
 * 顺序原样保留（上游 `EnvironmentVariablesData.java:36-38` 的插入序）。
 */
export function envLinesFromRows(rows: readonly EnvVarRow[]): string[] {
  return rows.filter(row => row.name || row.value).map(row => `${row.name}=${row.value}`)
}
