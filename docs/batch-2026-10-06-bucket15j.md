# 批次报告 · 2026-10-06 · 桶 15j：`src/rootsJarEntries.ts` 接上真宿主通道

## 0. 判决：**这条通道本仓确实缺**，不是重复实现

任务书要求先查「是否早已有等价实现」。逐处核过：

| 已存在的近邻 | 它给什么 | 为什么不等于「列归档条目」 |
| --- | --- | --- |
| `native/library_sources.cpp:133` `find_library_source` | 全限定名 → 从 `*-sources.jar` 里**解出一个 `.java`** | 只按名字取一个文件，列不出「这个 jar 里有什么」；输入是名字不是归档 |
| `src/externalLibraries.ts:67` `externalLibraryEntries` | glob 命中的 jar → `Library` 根 → 树里的**叶子行** | 到 jar 这一层就停：`FileTree.vue:115`/`:122` 对 `\0` 前缀路径直接 return，jar 点不开 |
| `src/libraryModel.ts` / `libraryRootDetection.ts` | 库实体、根类型识别 | 只管根，不管根**里面**的条目 |
| `native/zipstore.cpp:42` `read_archive` | 读 zip 的 (名字, 内容) | 只支持 store 条目（真 jar 是 deflate），且没人把它当清单通道用 |
| 提交 `5cad205`（外部库真内容） | 把 glob 摊成 jar 行 + SDK 行 | 那一轮做的是「jar 列表」，不是「jar 内容」；同一轮的 `rootsJarEntries.ts` 至今未进那次提交（`git status` 里它是 `??` 未跟踪） |

桶 15c 那个被切断的代理只写了模型层，**文件头声明的 `file.archiveEntries` / `list_archive_entries` 全仓零命中**
（`grep -rn "archiveEntries|list_archive_entries" native/ src/ tests/` 只命中它自己那两行注释），
也没有任何 `tests/roots-jar-entries*.test.mjs`。所以：缺「宿主通道 + 行模型 → 画面」这一段，按实现处理，不删。

## 1. 做了什么（端到端，四段都落地）

1. **宿主通道**：`file.archiveEntries`（`native/file_queries.cpp`）
   `archive_entries()`（`:160`）跑 `bsdtar -tf <archive>`，`-tf` 走 `CreateProcessW` + 匿名管道取 stdout
   （`run_tar_listing` `:73`），**不拼 shell**、参数一段一引号（`quote_arg`），带空格的 `D:\…` 路径原样进 argv；
   清单归一（反斜杠→`/`、去 `./` 前缀、去空行、条目数封顶，`split_listing` `:131`）。
   答复 `{available, archive, lines[], truncated}`；拿不到时**只有** `{available:false, archive, reason}`（不给 `lines`）。
   守卫：必须绝对路径 + 归档扩展名（jar/zip/war/ear/apk）+ 普通文件 + 大小封顶 512 MiB + 30 秒超时。
   分派落点：`native/file_queries.cpp:230`（`dispatch_file_query` 由 `main.cpp:851` 在 switch 之前调用，
   所以 **`main.cpp` 一行没动**）。
2. **落点为什么不是 `library_sources.cpp`**：那是 `taocode_lsp`（`CMakeLists.txt:38-41`），依赖方向是
   `taocode_lsp → taocode_workspace`（`:41`）。唯一不用改 `main.cpp` 的 `file.*` 入口在 `taocode_workspace` 里，
   从那儿调 lsp 的符号会让只链 `taocode_workspace` 的 `workspace_test`（`:111`）链接失败；
   `CMakeLists.txt` 是保留文件 ⇒ 实现留在 `file_queries.cpp`，理由写进了 `native/file_queries.hpp` 头注释。
   **没有新建 native 文件 ⇒ CMakeLists 无需登记**（接线请求文档第 0 段）。
3. **桥类型**：`src/bridge.ts` 是保留文件 ⇒ 方法名 + `ArchiveListingResult` 形状 + 落点行号写在
   `docs/wiring-requests-2026-10-06-bucket15j.md`。登记前 `src/jarEntriesSource.ts:31` 用
   `as string as Method` 绕开联合类型（注释里写明登记后删掉），其余调用点不动。
4. **前端取数面**：`src/jarEntriesSource.ts`（110 行，新）——`loadJarListing()`（`:88`）把清单交给
   `rootsJarEntries.jarRowsFromListing()`，带缓存（同一归档只问宿主一次）与**通道判定**
   （`jarChannelStatus()` `:61`：桥抛错 = `absent`；`available:false` = 通道在、这条归档读不出）。
   **拿不到返回 `null`，绝不返回空数组**——这是「不放假控件」的根据。
5. **画面**：`src/components/JarEntriesPane.vue`（66 行，新）画 `JarRow[]`（目录在前、`depth` 决定缩进、
   `.class` 行右侧给全限定名、tooltip 是 `jarUrl(archive, path)`）。零行 ⇒ `v-if="rows.length"` 整块不渲染；
   模板里没有「（空）/暂无/加载中」这类占位，条目行**没有点击语义**（本仓还读不了任意档案内条目）。
   挂进 `src/components/ProjectStructurePane.vue` 的「依赖库」一节：`:23-24` import、`:118` 命中 jar 列表、
   `:486` 起「命中的 JAR + 档案条目」那一段、`:492` 渲染组件；`jarChannel === 'live'` 才画按钮（先探一次宿主）。
6. **订正模型文件头的假引用**：`src/rootsJarEntries.ts:1-29` 原来指向不存在的
   `native/library_sources.cpp: list_archive_entries`，现改为真实落点；
   并订正一处上游事实：`JAR_SEPARATOR` 不是 `!` 而是 **`!/`**（`URLUtil.java:39`）。

## 2. 上游基准（本地已解压，逐条实读；相对 `intellij-community-master/`）

| 坐标 | 实测内容 | 判定 |
| --- | --- | --- |
| `platform/ide-core/src/com/intellij/openapi/vfs/JarFileSystem.java:9` | `public abstract class JarFileSystem extends ArchiveFileSystem implements VirtualFilePointerCapableFileSystem` | 相符 |
| 同文件 `:10` `:11` `:12` | `PROTOCOL` / `PROTOCOL_PREFIX` / `JAR_SEPARATOR = URLUtil.JAR_SEPARATOR` | 相符 |
| `platform/util/src/com/intellij/util/io/URLUtil.java:37`、`:39` | `JAR_PROTOCOL = "jar"`；**`JAR_SEPARATOR = "!/"`** | **前一轮记成 `!`，已订正** |
| `platform/analysis-api/src/com/intellij/openapi/vfs/newvfs/ArchiveFileSystem.java:34` | 类声明行；「Common interface of archive-based file systems」那句 javadoc 实际在 **`:32`** | 差 2 行，已按实测写 |
| 同文件 `:50`（`getRootPathByLocal` → `:51` `composeRootPath`）、`:68`（`getLocalByEntry`）、`:86`（`extractLocalPath`）、`:92`（`composeRootPath`） | 与任务书给的行号一致 | 相符 |
| 同文件 `:99-100`（`copyFile`）、`:114-115`（`deleteFile`） | 一律 `throw IOException("jar.modification.not.supported.error")` | 新增证据：这一面只读 ⇒ UI 不给写入口 |
| `platform/platform-impl/src/com/intellij/openapi/vfs/impl/jar/JarFileSystemImpl.java:23`、`:25`、`:30`、`:69` | 类、`getProtocol`、`extractPresentableUrl`、`findFileByPath` | 相符；另 `:53` 是 `localPath + JAR_SEPARATOR`（根路径以 `!/` 收尾） |

## 3. 本仓落点（文件:行）

- `native/file_queries.cpp:35` `archive_extension_ok` / `:73` `run_tar_listing` / `:131` `split_listing` /
  `:160` `archive_entries` / `:230` 分派
- `native/file_queries.hpp:1-16`（落点理由）、`:27-31`（答复形状）
- `native/library_sources_test.cpp:55` `install_listing_jar` 夹具、`:69` `ask_archive_entries`、
  用例 `:148`、`:171`、`:183`
- `src/jarEntriesSource.ts`（新，110 行）：`:31` 方法名、`:61` 通道状态、`:76` 绝对路径拼接、`:88` `loadJarListing`
- `src/components/JarEntriesPane.vue`（新，66 行）：`:27` rows、`:34` `v-if="rows.length"`
- `src/components/ProjectStructurePane.vue`：`:23-24` import、`:112-131` 状态与探测、`:486-493` 模板
- `src/rootsJarEntries.ts:1-29` 头注释订正（模型逻辑一行未改）
- `tests/ext-jar-entries-channel.test.mjs`（新，148 行，10 条用例）

## 4. 验证数字

| 判据 | 结果 |
| --- | --- |
| native：`library_sources_test.exe` | **9 passed / 0 failed**（原有 6 + 新增 3） |
| native：`workspace_test.exe`（同库，验证没把 `taocode_workspace` 链坏） | **25 passed / 0 failed** |
| native 全量 `ctest`（`npm run test:native`） | **跑不了**：`ninja` 在 `native/lsp_fake_server_requests.cpp:575` 语法错误中断（C3329/C2143）。那是**别人的在途文件**（`git status` = ` M`，本桶没碰），不是本桶造成的 |
| 前端本域：`tests/ext-jar-entries-channel.test.mjs` | **tests 10 / pass 10 / fail 0** |
| 前端邻居：`external-libraries` + `library-model` + `roots-attach-scan` | **tests 26 / pass 26 / fail 0** |
| `npx vue-tsc -b` | **0 错** |
| `node .tools/find-orphan-modules.mjs --gate` | 接前：`✘ 新增零生产消费方模块：src/rootsJarEntries.ts`、`新增 1`、门禁红 → 接后：`已登记孤儿 9 / 基线 21 · 新增 0 · 本轮清掉 12`、**门禁绿** |
| `find-param-props` / `find-ts-in-mjs` / `find-missing-ext` | 0 处参数属性 / 干净（纯 JS） / 干净（1200 文件扫描） |
| 模块上限 | `file_queries.cpp` 243≤1100、`library_sources_test.cpp` 192≤1300、`jarEntriesSource.ts` 110≤900、`JarEntriesPane.vue` 66≤900、`ProjectStructurePane.vue` 563≤900、`rootsJarEntries.ts` 159≤900；`module-size.test.mjs` 里唯一红项是 `src/components/CodeEditor.vue 1156 > 1147`（保留文件、本桶没碰、他人 329+/320− 在途改动造成的既有红） |
| 真机 bsdtar | `tar -tf 'D:\…\ch.qos.logback.classic_1.5.0.jar'` 退出码 0、230 条、目录条目带尾斜杠（盘符 + 反斜杠路径实测可用；代码里仍走 argv 引号，不过 shell） |

## 5. 反向验证记录（注入 → 变红 → 撤掉 → 复绿）

基线：`tests 10 / pass 10 / fail 0`，孤儿门禁 `新增 0`（绿）。三次注入都先 `cp` 到 `/tmp/b15j` 备份、
事后 `md5sum -c` 逐字节还原（3 个文件全 `OK`），**没有用 git checkout/reset/stash**。

| 注入 | 改了什么 | 期望 | 实测 |
| --- | --- | --- | --- |
| A | `jarEntriesSource.ts`：把「宿主答 `available:false` ⇒ null」改成永远给清单（即拿空清单当真数据） | 语义用例红 | `tests 10 / pass 9 / **fail 1**`（`✖ 通道不存在 ⇒ null 而不是空数组`） |
| B | `ProjectStructurePane.vue`：删掉模板里 `<JarEntriesPane … />` 那一行（只 import 不画） | 接线用例红 | `tests 10 / pass 9 / **fail 1**`（`✖ 接线②：行模型在真生产链路上`） |
| C | 同时断开 `rootsJarEntries.ts` 的两个消费方（删 import + 换调用点） | 本域测试红 **且** 孤儿门禁红 | `tests 10 / pass 8 / **fail 2**`，孤儿门禁 `✘ 新增零生产消费方模块：src/rootsJarEntries.ts` → `门禁红：1 个新增零生产消费方模块` |
| D（native） | `file_queries.cpp:160`：在失败分支上也塞一个空 `lines` 数组（即"拒了还给清单"） | 新用例红 | `library_sources_test.exe`：**8 passed / 1 failed**（`FAIL 拿不到就如实说拿不到：不给 lines 字段`），其余 8 条照绿 |
| 撤掉 A/B/C/D | 还原备份并 `md5sum -c`（4 个文件全 `OK`）+ `ninja` 重链 | 复绿 | 前端 `tests 10 / pass 10 / fail 0`、邻居 26/26、`门禁：… 新增 0`（绿）；native `library_sources_test 9 passed / 0 failed`、`workspace_test 25 passed / 0 failed` |

## 6. 做不到 / 无法核实

1. **点某一行看档案内条目内容**：没有通道。`file.librarySource` 只吃全限定名、只搜 `*-sources.jar`；
   上游的等价物 `JarFileSystemImpl.java:69`（`findFileByPath`）本仓没有对应实现 ⇒ 条目行**不给点击**，
   已登记进接线请求第 3 段。
2. **`src/bridge.ts` 的 `Method` 登记**：保留文件，改不了。前端现在靠一处窄化 cast 过类型检查（`:31`，
   带注释），登记后删掉即可；`npx vue-tsc -b` 0 错，但**这条通道在真机上要等登记才点得亮**。
3. **浏览器预览（`bridgePreview.ts`）**：不桩。要桩就得编一份假 jar 清单，与「不放假控件」冲突；
   现在的行为是预览里整段不渲染（`absent`）。
4. **嵌套 jar（`jar://a.jar!/nested.jar!/x.class`）**：上游 `JarFileSystemImpl.java:36/:42` 按 `!/` 反复切，
   本仓 `parseJarUrl` 只切第一个 `!`，即**不支持套娃归档**。没做，也没在 UI 上假装支持。
5. **`ArchiveRootWindow.java:24`**（`rootsJarEntries.ts` 旧注释里引的一条，说「档案内路径恒用 `/`」）：
   在这个上游快照里**指不到该文件**，无法核实；该论断已由能核实的
   `ArchiveFileSystem.java:68` javadoc 例子（`!/resource.xml`）承接，注释里的引用换成了它。
6. **`ctest` 全量数字**：被他人 `lsp_fake_server_requests.cpp:575` 的语法错误挡住，本桶只交了自己两个
   可执行用例的数字（9/9、25/25）。
