# 接线请求 · 2026-10-06 · 桶 15j（`file.archiveEntries` 的桥类型）

> 本桶**没有新建 native 源文件**，所以 **CMakeLists.txt 一条都不用登记**：
> 实现落在已有的 `native/file_queries.cpp`（编在 `taocode_workspace`，`CMakeLists.txt:30`），
> 判据落在已注册的 `library_sources_test`（`CMakeLists.txt:256-258`）。
>
> 为什么不放在任务书建议的 `native/library_sources.cpp`：那条文件编在 **`taocode_lsp`**（`:38-41`），
> 而 `taocode_lsp` 依赖 `taocode_workspace`（`:41`）—— 方向是反的。`main.cpp` 有 2000 行硬上限不能加 case，
> 唯一不需要动 main.cpp 的 `file.*` 入口是 `dispatch_file_query`（`main.cpp:851`），它在
> `taocode_workspace` 里；从那里调 `taocode_lsp` 的函数会让只链 `taocode_workspace` 的
> `workspace_test`（`:111`）链接失败。CMakeLists 是保留文件，所以实现落在 `file_queries.cpp`。

## 1. `src/bridge.ts`：把新方法名放进 `Method` 联合（保留文件，只此一行）

- 目标文件与落点：`src/bridge.ts:109`，`Method` 联合里 `'file.librarySource'` 的**后面**
- 要接什么（整段可照抄，只在 `'file.librarySource'` 之后插入 `| 'file.archiveEntries'`）：

```ts
export type Method = 'app.state' | /* …原有若干… */ 'file.usages' | 'file.librarySource' | 'file.archiveEntries' | 'session.save' | /* …其余原样… */
```

- 可选（想要类型面而不是让调用方带 cast）：同一文件加一个结果形状，放在
  `ProjectFileList`（`src/bridge.ts:83` 附近）那一组接口旁边：

```ts
/** `file.archiveEntries` 的回答：宿主 `bsdtar -tf` 的一份档案内条目清单（路径恒用 `/`）。 */
export interface ArchiveListingResult {
  available: boolean
  /** 回显的归档绝对路径（正斜杠）。 */
  archive?: string
  /** 档案内条目路径；`available === false` 时**没有这个字段**（不是空数组）。 */
  lines?: string[]
  /** 宿主按条目上限截断过。 */
  truncated?: boolean
  /** 拿不到时的一句话，不猜。 */
  reason?: string
}
```

- 登记完成后 `src/jarEntriesSource.ts:31` 那个 `as string as Method` 就能去掉（同一行注释里写了原因）：
  `bridge.ts` 不许本桶改，所以先用字面量的窄化绕开；不改调用点。
- 上游依据：`platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:10-12`（协议与 `!/` 分隔符），
  `platform/util/src/com/intellij/util/io/URLUtil.java:39`（`JAR_SEPARATOR = "!/"`）。

## 2. `src/bridgePreview.ts`：建议**不要**给这条通道做内存桩

- 目标文件：`src/bridgePreview.ts:56`（`previewRequest`）
- 现状：不登记 = 浏览器预览里 `loadJarListing` 抛错 ⇒ `jarChannelStatus()` 变 `absent` ⇒
  `ProjectStructurePane.vue:486` 那整段（含「档案条目」按钮）**不渲染**。这正是「没有数据通道就不放假控件」要的行为。
- 若要桩，就得在预览里塞一份**编造的 jar 条目清单**——那是假数据，与上一条冲突。本桶按「不桩」处理，
  列在这里只是免得日后被当成漏接。

## 3. 后续（不在本桶范围，登记给下一轮）

- 「点档案内某一行 → 看内容」：`file.librarySource` 只吃**全限定名**且只搜 `*-sources.jar`
  （`native/library_sources.cpp:133`），所以只有 `.java` 条目能跳到编辑器，且要把
  `open path` 的出口从项目结构面板接到标签页（那是 `src/App.vue`，2724/2737 行，只剩 13 行余量）。
  上游的等价物是 `JarFileSystemImpl.java:69` `findFileByPath` —— 本仓还没有「读任意档案内条目」的通道。
- `native/zipstore.cpp:42` 有原生 zip 读法（`read_archive`，只支持 store 条目）。将来要脱离 bsdtar
  就在它上面补 inflate；现在这条路依赖系统 `System32\tar.exe`（Win10 1803 起自带），
  拿不到时 `file_queries.cpp:160` 那条会答 `available:false` 并说清原因。

## 处理结果（wiring-backlog lane，2026-10-06）

- **1 已接线**：`src/bridge.ts:109` 的 `Method` 联合已含 `'file.archiveEntries'`（`src/jarEntriesSource.ts:37` 也记明「2026-10-06 主代理接线」）。
- **2 不做** —— 请求原文自己判定「不桩」（预览里编造 jar 清单 = 假数据）。维持。
- **3 后续（档案内条目跳编辑器）** —— 目标含 `src/App.vue`，但依赖「读任意档案内条目」的通道（`file.librarySource` 只吃全限定名）。无通道前接上就是假跳转。维持不做。

结论：零待接，未改任何文件。
