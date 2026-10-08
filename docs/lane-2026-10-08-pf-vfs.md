# Lane `pf-vfs`（platform_rest：`pf/vfs`(148) + `pf/inline-completion`(99)）· 2026-10-08

## 做了什么

1. **`pf/vfs` 判词「缺」逐句核实 + 订正**（写回族键，不删历史段）：①「本仓只有本机盘 + 库源码」「http/wsl 没有通道」**过期** —— http 取数通道已落：宿主 `native/http_client.cpp`（WinHTTP；路由 `native/main.cpp:1437-1442`）+ 前端 `src/remoteFiles.ts`（URL 白名单/文档身份/会话缓存判定/只读）+ `src/remoteFileHost.ts`（取数宿主 `createRemoteFileHost`/`fetchRemoteRaw`），消费方 `src/pluginMarketRemote.ts`、`src/pluginServices.ts`（复跑 `tests/remote-files.test.mjs`+`tests/remote-file-host.test.mjs` 13/13 绿）；② jar 叶子那一半**仍成立**（`src/externalLibraries.ts:17,95-100` 命中 jar 作叶子；浏览走 `file.archiveEntries`+`src/components/JarEntriesPane.vue` 另一条通道）；③ 符号链接订正：不是「没有显式环检测」而是**明确的拒绝策略**（列举滤掉重解析点/设备 `native/workspace.cpp:291`/`:629`、访问 `:178-180` 抛 `REPARSE_POINT`、复制/删除 `native/workspace_tree_ops.cpp:42-43`/`:70-71`、导出写入 `native/export_file.cpp:56`）⇒ 环不可能出现，也没有上游「支持符号链接 + 规范化映射」；④ `VirtualFileInfoAction`：通道确实没有 size/mtime（`Entry` 只有 name/path/kind，`src/bridge.ts:65`）；⑤ wsl 仍无通道（`src/debugAttach.ts:8,64`）。
2. **`pf/inline-completion` 判词「缺」逐条核实**：已落项复跑绿（`tests/inline-completion*.test.mjs` 8 文件 48/48）。**渲染/交互仍差**逐条写回：① 多行建议渲染 —— 上游 `render/*` 十类 + `elements/*` 折逐行文本块；本仓只有一个行内 span `GhostTextWidget`（`src/inlineCompletionExtension.ts:59-84`），换行被 HTML 折成空格 ⇒ 显示与 Tab 插入不一致，`inlineGhostLines`（`src/inlineCompletion.ts:72`）零消费者；② 设置页/按 provider 开关（`com.intellij.inlineCompletionConfigurable`；设置树 `src/settingsTreeMeta.ts` 零命中）⇒ 用户关不掉这条通道；③ `logs/`（18 项）+`statistics` 遥测不收集（有意）；④ inline edit 四类（`LspRequestKind`（`src/bridge.ts:189`）里没有对应 kind，且要模型后端）；⑤ `editorLineStripeHint/`（3 类）**划掉**——上游引用者是别的特性（`CommandCompletionService.kt:9`、`SuggestedRefactoringAvailabilityIndicator.kt:5-7`），codeinsight-inline 包内零引用；⑥ 5 个类未逐条核，留 `[~]` 待核。
3. **`src/virtualFilePointer.ts` 孤儿处置（任务点名）= 接不了的那半，按先例留痕**：核实**不是半成品**（实现/判据/上游行号齐），缺的是**持有者**；**不撤**（撤要删判据，且 `ic/vfs` 判词已把它算作已落的一半）⇒ 文件头写死卡点（NOT WIRED YET 段，点名三个持有者面）+ 登记 `.tools/orphan-baseline.txt`。同批补齐**实例语义**：`holder` 持有者身份 + 引用计数（上游 `VirtualFilePointerManagerImpl.java:316`/`:448` 的 `incrementUsageCount(1)`、`:808-818` 的 `decrementUsageCount` 只在计数到 0 摘节点）、listener 随持有者解绑、广播按 listener 分组（上游 `groupPointersToFire:715-730`）。
4. **`presence=='真实代码'` 5 行逐条核（5/5 成立）**：`ChangeFileEncodingAction` → `src/editorFileOps.ts:217`（`reloadWithEncoding`）+`:233`（`applyEncodingChoice`）；`VfsPresentationUtil` → presentableName 链 `src/tabTitle.ts:103` + presentableUrl 口径 `src/copyPathActions.ts:24` + `src/filenameWidget.ts` 的 `baseName`/`uniqueFileName`；`InlineCompletionProvider`/`InlineCompletionSuggestion`×2 → `src/inlineCompletionExtensionPoints.ts`（EP + LSP bundled 贡献）。
5. **判决回填**：`scripts/verdict_table.py` 只改两族键（各追加 `2026-10-08 lane pf-vfs：…` 段），`python scripts/verdict_table.py platform_rest` 重生成，`node --test tests/verdict-generated.test.mjs` 5/5 绿。

## 落点文件

改：`src/virtualFilePointer.ts`（224→284 行）、`tests/virtual-file-pointer.test.mjs`（128→187 行）、`scripts/verdict_table.py`（两族键）；登记 `.tools/orphan-baseline.txt`（gitignored）；生成物重建 `docs/inventory/platform_rest_verdict_table.json`、`docs/inventory/verdict-platform_rest.md`；**未碰**任何禁改文件。

## 判据与条数

| 判据文件 | 条数 | 内容 |
|---|---|---|
| `tests/virtual-file-pointer.test.mjs` | 15（本轮 +4） | `dispose` 按持有者解绑（还有持有者时条目不摘）、listener 随持有者生命周期、一批改名里 listener 只收自己那几个指针、文件头 NOT WIRED YET 留痕 |
| `tests/remote-files.test.mjs`+`tests/remote-file-host.test.mjs` | 13 | http 通道规则/取数宿主（只复跑） |
| `tests/inline-completion*.test.mjs`（8 文件） | 48 | 幽灵文本/接受/打字/变体/导航/部分接受/浮条/EP（只复跑） |

**反向验证**：① `dispose` 不看持有者（按 key 直接摘条目）⇒ 新增 2 条红；② 广播不分组（整批塞给每个 listener）⇒ 4 条红；恢复后 15/15 绿，`grep REVERSE-CHECK` 零残留。

## 门禁读数（实测）

- `node --test tests/virtual-file-pointer.test.mjs` → `tests 15 / pass 15 / fail 0`
- 相关批（指针 15 + 远程 13 + 行内补全 48）→ `tests 76 / pass 76 / fail 0`
- `node --test tests/module-size.test.mjs` → `tests 5 / pass 5 / fail 0`
- `node --test tests/verdict-generated.test.mjs` → `tests 5 / pass 5 / fail 0`
- `python scripts/verdict_table.py platform_rest` → `total=20574 [x]=167 [~]=5305 [ ]=0 [-]=15102`
- `node .tools/find-orphan-modules.mjs --gate` → `已登记孤儿 5 / 基线 9 · 新增 42 · 本轮清掉 4`；红名单里**已无** `src/virtualFilePointer.ts`（其余 42 个是别的 lane 在途文件）
- `npx vue-tsc --noEmit` → **0 错（exit 0）**（中途曾读到 `src/pluginMarketRemote.ts(132,42) TS2345` 一条 —— 该文件 mtime 与我跑门禁同一秒，是别的 lane 的在途编辑；它落盘后复跑为 0）

## 族档位变化

**无（两族都留 `~`）**：缺口都是架构级/别的族面（远程标签挂载、持久 VFS、符号链接支持、多行渲染、设置页、遥测、inline edit），本 lane 在禁改文件面内闭不上。

## 仍缺什么（如实）

- `pf/vfs`：远程文档 → 编辑器只读标签（唯一开标签处在冻结的 `src/App.vue:921` 的 `openFile`）；wsl 通道；持久化 VFS（架构不同）；符号链接**支持**（本仓是拒绝策略）；size/mtime 通道；指针的持有者面。
- `pf/inline-completion`：多行建议渲染、设置页与开关、遥测、inline edit 四类；`InlineCompletionEapSupport`/`InstallListener`/`OnboardingComponent`/`FontUtils`/`DebouncedInlineCompletionProvider` 未逐条核（留 `[~]`）。

## 接线清单（要协调代理接，我不动冻结/别人文件）

1. **远程只读标签**：`src/App.vue:921` 的 `openFile` 加一条「URL ⇒ `createRemoteFileHost().open(url)` ⇒ 按 `remoteStatusText(document)`（`src/remoteFiles.ts:160`）开只读标签」分支；挂载点自述在 `src/remoteFileHost.ts:18-19`。
2. **指针持有者面**（接上后删 `src/virtualFilePointer.ts` 的 NOT WIRED YET 段 + `.tools/orphan-baseline.txt` 那行，并把 `tests/virtual-file-pointer.test.mjs` 的「留痕」那条改成「已接上」断言）：a) `src/App.vue` 的 `groups`/`retitleTab`（`:1751`）把标签路径键换成指针（改名一把 `rename(from,to)` 对账）；b) `src/bookmarks.ts` 的 `path` 键（`ic/bookmarks` 族）；c) 断点 / `pv/recent` 的 `path+line` 表。
