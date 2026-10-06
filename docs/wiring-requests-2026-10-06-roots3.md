# 接线请求 · 2026-10-06 · roots3（项目模型 / 外部系统 / 根与 SDK 域收尾）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（下列每条行号本轮亲手打开数过）。
本文件两条请求的目标都是**保留文件**（`src/App.vue`、`src/bridge.ts`、`native/*`），我这侧不能改。
行号是 2026-10-06 现树实测（工作区并发变动中，落地前请重读目标区域）。
本轮**没有**新建 native 源文件 ⇒ CMakeLists.txt 一条都不用登记（见 A2 的落点说明）。

---

## A1 · `src/App.vue:1839` 收下 `addRunConfiguration` 的第三参（沿用 roots/roots2 的 R1/N1，仍是唯一没闭的那寸）

- **判定**：**仍缺**（ roots2 写的是 `:1817`，现树实测已经漂到 `:1839`；内容一字没变，所以这条不是「前提变了」）。
- **目标文件 / 行号**：`src/App.vue:1839`（保留文件，派单禁改）。
- **现状（本轮逐条重核，除这一行外全通）**：
  · 生产者：`src/gradleHost.ts:72` 的 `GradleHostDeps.addRunConfiguration` 已是
    `(name: string, command: string, env?: string[]) => unknown`；`:675-676`（`saveTaskAsRunConfig`）在任务被
    「编辑任务…」存过 VM 选项或 env 时交出 `taskRunEnvironment(settings, [])` = `['GRADLE_OPTS=<VM 选项>', '<env 行>'…]`；
  · 存储：`src/runConfigurationSchema.ts:61` 的键白名单含 `env`，`:85` 校验它是列表，`:115` 原样保留；
  · 执行：`src/runActions.ts:98` 的 `if (config.env?.length) params.env = config.env` 已经在把它交给宿主；
  · 宿主：`native/run_host.cpp:207` 的 `step.environment = string_list(value.at("env"))`、
    `native/runner.hpp:30-32` 写明是「applied on top of the inherited」= **叠加**，不是替换掉 PATH。
  ⇒ 断的只有 App.vue 这一行：回调只声明两个参数，第三参在 JS 层被丢掉。- **可粘贴的 old / new**（`old` 是 `src/App.vue:1839` 的当前逐字原文，含缩进两格）：

  ```ts
  // old
    addRunConfiguration: (name, command) => { void persistRunConfigs([...runConfigs.value, { name, command }], `已把 Gradle 任务保存为运行配置「${name}」`) },
  // new
    addRunConfiguration: (name, command, env?: string[]) => {
      const config: Record<string, unknown> = { name, command }
      if (env?.length) config.env = env
      void persistRunConfigs([...runConfigs.value, config], `已把 Gradle 任务保存为运行配置「${name}」`)
    },
  ```

- **形状提醒**：`env` 存 **`string[]`（`KEY=VALUE` 行）**，不要折成对象 —— `runConfigurationSchema.ts:85` 按列表校验、
  `native/run_host.cpp:207` 按 `string_list` 收，折成对象会被判坏。（`src/runActions.ts:287` 的 `envArrayToObject`
  只在 DAP 那条通道用（调用点在 `:270`），运行实例这条通道直接传数组。）
- **旧存档兼容**：`env` 是可选键，缺键时 `normalizeRunConfigurations` 既不补也不判损坏（`schema:115` 的
  `...(config.env ? { env: [...config.env] } : {})` 已经是这个语义），**不要**改成按键数判坏。
- **上游依据**：`platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/execution/ExternalSystemBeforeRunTask.java:38-45`
  （把 `tasks`/`externalProjectPath`/**`vmOptions`**/`scriptParameters` 写进运行配置 XML 的属性）；
  bean `platform/external-system-api/src/com/intellij/openapi/externalSystem/model/execution/ExternalSystemTaskExecutionSettings.java:39-44`
  （`myExternalProjectPath`/`myVmOptions`/`myScriptParameters`/`myEnv`/`myPassParentEnvs` 五个字段）与同文件 `:94,102,134`（三个 getter）；
  执行侧消费 `platform/external-system-impl/src/com/intellij/openapi/externalSystem/service/internal/ExternalSystemExecuteTaskTask.java:43,80-82`
  （`withVmOptions`/`withArguments`/`withEnvironmentVariables`/`passParentEnvs`）。
  ⇒ 上游这些字段**随运行配置持久**；本仓现在只有「直接运行」那条生效，「保存为运行配置」这一半差这一行。
- **落完后请一并跑**：`node --test tests/ext-task-settings.test.mjs tests/gradle-host.test.mjs tests/run-configurations.test.mjs`
  —— 生产者侧判据已在（`tests/gradle-host.test.mjs`「存过的 VM 选项/env 随『创建运行配置』交出」）。
- **App.vue 余量**：现 2673 行 / 上限 2737（`tests/module-size.test.mjs`），这一处净 +4 行。

---

## A2 · VFS 那一寸：给 `dispatch_file_query` 加 `file.stat`（根/库/SDK 的「在不在磁盘上」到现在为止无解）

> 这是任务 3 点名的「VFS/文件索引那条若确实需要 native 通道」。结论：**确实需要**，而且缺口只有一个自由函数。

- **为什么现在必须开这条口子**（本仓自己写在注释里的，不是我推测的）：
  · `src/rootsModel.ts:246-248`（`buildOrderEntries` 的库条目注释）：「库根通常是**绝对路径**（工程外的 jar），
    清单里只有工程内路径，所以清单查不到不等于无效 ⇒ 只有当库里一个根都没有时才报无效」；
  · `src/rootsModel.ts:233`：SDK 条目的 `valid` 只能判「家目录字符串配没配」，判不了「那个目录还在不在」；
  · `src/projectFileIndex.ts:180-187`：`isInProject` 的地板就是 `workspace.files` 的全量**工作区相对**清单 ——
    项目外（库根、SDK 根、被移到工作区外的文件）在这一面上永远查不到。
  上游这三个查询都在 VFS 上：`platform/core-api/src/com/intellij/openapi/vfs/VirtualFile.java:672`（`exists()`）、
  `:274`（`isValid()`）、`:233`（`isDirectory()`）、`:610`（`getLength()`）、`:605`（`getTimeStamp()`）、`:224`（`isWritable()`）。
  本仓已有 `file.archiveEntries`（绝对路径、只读、自由函数）开了同一类先例 —— `file.stat` 就是它的邻居。
- **建议落点（不动 `native/main.cpp`、不动 `CMakeLists.txt`）**：
  1. `native/file_queries.cpp` 的匿名 namespace（现 `:21-192`）里加一个自由函数 `Json file_stat(const Json& params)`，
     紧挨 `archive_entries`（`:160`）——那里已经有 `#include <filesystem>`（`:13`）与绝对路径的守法（`:167`）；
  2. `native/file_queries.cpp:194` 的 `dispatch_file_query` 里加一条 case（照 `:230` 的 `file.archiveEntries` 那两条的写法）：
     ```cpp
     if (method == "file.stat") { result = file_stat(params); return true; }
     ```
  3. 判据落 `native/library_sources_test.cpp`（已注册为 `library_sources`，`:73` 那条已经在直接调
     `dispatch_file_query`）—— 同一文件补 3~4 个 check 即可，**不需要**新的 CMake 目标。
  4. `src/bridge.ts:109` 的 `Method` 联合里在 `'file.archiveEntries'` 之后插 `| 'file.stat'`（保留文件，只这一行）；
     可选：同文件加形状（放 `ArchiveListingResult` 那一组旁边）
     ```ts
     /** `file.stat` 的回答：宿主 `std::filesystem` 对**绝对路径**的一次只读探测（VFS 的最小等价物）。 */
     export interface PathStatResult {
       exists: boolean
       /** 只在 exists 时给：目录 / 普通文件 / 其他（symlink 按解析后的目标算）。 */
       kind?: 'directory' | 'file' | 'other'
       /** 普通文件的字节数；目录与取不到时没有这个字段。 */
       length?: number
       /** 最后写入时间的毫秒时间戳；取不到时没有这个字段（不猜 0）。 */
       modifiedAt?: number
       /** 路径非法（空串、相对路径）或宿主异常时的一句话。 */
       reason?: string
     }
     ```
- **答复口径（照上游，别做多）**：入参 `path` 必须是**绝对路径**（与 `file.archiveEntries` 的 `:167`
  「要给归档的绝对路径」同一档）；不给相对路径、不进 `Workspace` 的沙箱、不写盘、不 `refresh`。
  取不到就是 `{exists:false}`（或带 `reason`），**不许**回 `exists:true + length:0` 这种「假装在」。
- **前端消费点（A2 落完后我自己这侧接着做，不在本请求范围内先做）**：
  · `src/rootsModel.ts` 的 `buildOrderEntries` 收一份 `presence?: Readonly<Record<string, boolean>>`，
    库/SDK 条目的 `valid` 从「有没有根」升级成 `OrderEntry.java:55-60` 的原义（条目指向的东西在不在）；
  · `src/rootsSdkTable.ts:217` 的 SDK 行、`src/moduleScopes.ts` 的库根同理。
  现在这三处都只能在注释里写「查不到 ≠ 无效」，因为**没有通道**。
- **顺带答一条悬案**（`docs/wiring-requests-2026-10-06-filetypes.md` 的 **F4**，roots2 §顺带 说它「需要主代理先给 Method 名」）：
  建议就用这一条 `file.stat`（入参 `{path}`；F4 要的 `{bytes, modifiedAt, readOnly, encodingHint}` 里
  `bytes`/`modifiedAt` 由 A2 覆盖，`readOnly` 已有 `file.readOnly` 的写侧、读侧可以在这同一个 case 里顺带给
  `writable: boolean`，`encodingHint` 建议**不放**进这条 —— 那是内容探测，属于 `file.readBinary` 那一族，
  混进来会让这条自由函数变成两件事）。名与形状定了，`native/file_queries.cpp` 那一半在 20 行以内。
- **仍缺、且这条也解决不了的**（登记，别当已闭）：bucket15j §3 的「点档案内某一行 → 看内容」要的是
  读归档**内条目**（上游 `JarFileSystemImpl.findFileByPath` 那一档），`file.stat` 只答「归档本身在不在」；
  `native/zipstore.cpp:42` 的 `read_archive` 目前只支持 store 条目（要 inflate 才能读 zip 内正文）。

---

## A3 · 不需要接线、只登记状态的两条（免得下一轮再查）

- `docs/wiring-requests-2026-10-06-bucket15j.md` §1（`file.archiveEntries` 进 `Method` 联合）：**已闭**
  —— `src/bridge.ts:109` 现有 `'file.archiveEntries'`，`src/jarEntriesSource.ts:45` 已经是
  `request<ArchiveListingReply>('file.archiveEntries', …)`，那个 `as string as Method` 的窄化已经不需要了
  （文件头 `:37` 也写明了「2026-10-06 主代理接线」）。§2（预览里不桩）实测成立：`src/bridgePreview.ts` 里
  grep 不到 `archiveEntries` ⇒ 浏览器预览里那块按钮整段不渲染，符合「没有数据通道就不放假控件」。
- `docs/wiring-requests-2026-10-06-bucket15.md` 的 W1（新建文件对话框接用户自定义模板）：**已闭**
  —— `src/App.vue:152-153` 已 import `HOST_FILE_TEMPLATE_KINDS`/`fileTemplatesState`/`createFileFromTemplate`，
  `:246` 是 `nameDialogTemplates` 计算属性，`:2489` 是 `v-for` 的那一条 option，`:1721` 走 `createFileFromTemplate`。
  W2/W3 的复核结论沿用 roots2（`native/settings_schema.cpp:261-263` 的白名单已放开；`src/main.ts:6,30` 已灌忽略清单）。
