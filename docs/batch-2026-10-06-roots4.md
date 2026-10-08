# 批次报告 · 2026-10-06 · roots4（链接构建工程的内容根与排除根）

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`。
上一条同域 lane（roots3）的落点在 `docs/batch-2026-10-06-roots3.md`。
本报告补写 roots4 的归属——roots4 撞 150 轮上限被切断，代码已落盘但没有报告；本收尾 lane 复核、修正、登记。

## 1. 落地面归属

roots4 落的是**一整份纯模块**（"链接进来的 build project 的 content/exclude roots"），非"只落了一半"。
四个文件构成完整链路：模块 → 接线 → 消费方 → 判据。

| 文件 | 性质 | 行数 | 归属 lane |
|---|---|---:|---|
| `src/buildContentRoots.ts` | **新建**（纯模块） | 14+133 = 147 有效行（文件 164 行） | roots4 落 |
| `src/rootsModel.ts` | 改（接线）：+85/-8 | 486（改前 409） | roots4 落 + 收尾 lane 修 TS |
| `src/components/ProjectStructurePane.vue` | 改（消费方）：+10 | 573（改前 563） | roots4 落 |
| `tests/roots-content-roots.test.mjs` | **新建**（判据 8 条） | 105 | roots4 落 + 收尾 lane 修断言 |

## 2. 模块职责与上游依据（逐条复核）

`src/buildContentRoots.ts` 实现的是"链接进来的构建工程目录 → 模块的内容根与排除根"，对应上游：

| 本仓函数/导出 | 行号 | 上游依据（相对路径:行号） | 复核结果 |
|---|---|---|---|
| `MAVEN_POM_FILE` | `:40` | `plugins/maven-server-api/src/main/java/org/jetbrains/idea/maven/model/MavenConstants.java:21`（`POM_XML = "pom.xml"`） | **一致** |
| `isAncestorPath` | `:52` | `MavenRootModelAdapterLegacyImpl.java:106-109`（`VfsUtilCore.isEqualOrAncestor`） | **一致**（语义等价：祖先或自身） |
| `mergeContentRoots` | `:66` | `MavenRootModelAdapterLegacyImpl.java:100-103`（`getContentRootFor(url) != null` → return）+ `:108`（`isEqualOrAncestor`） | **一致**（先来者赢 + 祖先规则） |
| `mavenProjectDirs` | `:78` | `MavenConstants.java:21`（只认 `pom.xml`）| **一致** |
| `buildContentRoots` | `:105` | `CommonGradleProjectResolverExtension.java:296`（`populateModuleContentRoots`）、`:310`（`getContentRoots()`）、`:315`（`getRootDirectory()`） | **一致**（Gradle 链接表 + Maven pom 合并） |
| `outputExcludeRoots` | `:129` | `CommonGradleProjectResolverExtension.java:396-408`（build 目录 `storePath(EXCLUDED, buildDirPath)`）+ `MavenRootModelAdapterLegacyImpl.java:96,274,278`（`setExcludeOutput(true)`） | **一致** |
| `excludedBy` | `:145` | 语义：排除优先（内容根之下但在排除根里 ⇒ 不算内容），沿用 `platform/projectModel-impl/src/com/intellij/workspaceModel/core/fileIndex/impl/ExcludedRootFileIndexContributor.kt:11-18` | **一致** |
| `isInModuleContent` | `:160` | 同上（`ExcludedRootFileIndexContributor` 的 `registerExcludedRoot` ⇒ `isInContent` 为假） | **一致** |

上游默认值依据：

| 本仓字段 | 行号 | 上游出处 | 复核结果 |
|---|---|---|---|
| `excludeOutput` 默认 true | `buildContentRoots.ts:118` | `platform/workspace/jps/src/com/intellij/platform/workspace/jps/bridge/impl/java/JpsJavaModuleExtensionBridge.kt:43`（`isExcludeOutput(): Boolean = javaSettingsEntity?.excludeOutput ?: true`） | **一致** |

## 3. 接线归属（rootsModel.ts 改动）

roots4 在 `src/rootsModel.ts` 的改动（+85/-8）：

| 改动位置 | 内容 | 依据 |
|---|---|---|
| `:49` | `import { excludedBy, isAncestorPath, mergeContentRoots, outputExcludeRoots } from './buildContentRoots.ts'` | 消费链路 |
| `:67-81` | `RootExcludeFolder` 增 `rule` 字段（`'name' | 'output'`），标注排除根来源 | 面板区分两类排除 |
| `:128-137` | `RootModelInput` 增 `buildProjectDirs`、`excludeOutput` | 链接工程目录入口 |
| `:200-202` | 新私有函数 `countUnder` | 排除根行计数 |
| `:214-227` | 新私有函数 `excludeRootsForEntry` | 合并两类排除根、去重 |
| `:230` | `buildContentEntry` 签名增第三参 `ownerUrls` | 最长匹配归属 |
| `:239,249` | `buildContentEntry` 内调用 `excludeRootsForEntry` + 排除优先 | 接线 |
| `:255-260` | 新私有函数 `longestOwnerUrl`、`outputExcludedName` | 辅助 |
| `:342-344` | `buildRootModel` 用 `mergeContentRoots` 合并 `contentRoots` + `buildProjectDirs` | 核心接线 |
| `:350-351` | `buildRootModel` 传 `ownerUrls` 给 `buildContentEntry` | 配合 ownerUrls |
| `:441-448` | `rootModelRows` 的排除根行：key 带内容根前缀 + comment 区分两类来源 | 面板呈现 |

## 4. 消费方归属（ProjectStructurePane.vue）

roots4 在 `src/components/ProjectStructurePane.vue` 的改动（+10）：

| 行号 | 内容 |
|---|---|
| `:18-19` | import `buildContentRoots` from `'../buildContentRoots.ts'` |
| `:143-147` | `buildProjectDirs` 计算属性：从 `props.settings?.buildTools?.gradle.linkedProjects` + `workspaceFiles` 调用 `buildContentRoots()` |

消费链路确认：`ProjectStructurePane.vue` → `buildRootModel()` → `buildContentEntry()` → `rootModelRows()` → 面板渲染。

## 5. 判据（tests/roots-content-roots.test.mjs）

8 条测试覆盖：

| 序号 | 测试名 | 覆盖对象 |
|---|---|---|
| 1 | `mavenProjectDirs：只认真实的 pom.xml` | `mavenProjectDirs`、`MAVEN_POM_FILE` |
| 2 | `mergeContentRoots：去重 + 祖先规则` | `mergeContentRoots`、`isAncestorPath` |
| 3 | `buildContentRoots：Gradle 链接表 + Maven 的 pom 目录` | `buildContentRoots`、`maven: false` 开关 |
| 4 | `outputExcludeRoots：配置的编译输出才是排除根` | `outputExcludeRoots`、`excludeOutput: false` |
| 5 | `isInModuleContent / excludedBy：排除优先` | `isInModuleContent`、`excludedBy`、嵌套取最深 |
| 6 | `根模型：链接的工程目录进内容根` | `buildRootModel` + `buildProjectDirs` 接线 |
| 7 | `排除优先落在树上` | `buildContentEntry` + `rootModelRows` 完整链路 |
| 8 | `目录名表与输出目录命中同一条路径时不重复挂` | `excludeRootsForEntry` 去重逻辑 |

全部 8 条实测通过。

## 6. 收尾 lane 修正（本 lane 做的）

| 修正 | 文件:行号 | 原因 |
|---|---|---|
| `RootExcludeFolder.rule` 从可选改为必填 | `src/rootsModel.ts:81` | 修复 TS2345（`readonly RootExcludeFolder[]` 不能赋给 `readonly ExcludeRootEntry[]`，因 `undefined` 不兼容） |
| `excludeFoldersFromFiles` 输出加 `rule: 'name'` | `src/rootsModel.ts:192` | 配合上条改动 |
| 断言更新 `undefined` → `'name'` | `tests/roots-content-roots.test.mjs:104` | 配合 rule 必填 |
| 非等价第 2 条更新措辞 | `src/rootsModel.ts:33-37` | 原文写"恒为 ['']"已过时；落点已到 |
| **订正留痕**：`settingsModel.ts:66` → `:108` | `src/rootsModel.ts:33` | 原引用行号指向 `BeforeRunStepsPanel` 注释段，`JavaProjectSettings` 接口实际在 `:108` |
| **订正留痕**：`JpsJavaModuleExtensionBridge.kt` 路径缺 `java/` | `src/buildContentRoots.ts:25` | 原写 `bridge/impl/` 实为 `bridge/impl/java/`（本轮 `find` 命中确认） |
| **订正留痕**：`src/gradle.ts:776` → `:787` | `src/buildContentRoots.ts:32` | `linkedProjects: string[]` 声明在 `:787`，`:776` 是 `delegatedBuild` 注释段 |

## 7. 实测数字

| 命令 | 结果 |
|---|---|
| `node --test tests/roots*.test.mjs tests/gradle*.test.mjs tests/module-size.test.mjs` | **112 tests: 112 pass, 0 fail** |
| `npx vue-tsc -b --force` | **5 error TS, exit code 1**（0 条来自 roots4 域；5 条分布：codelens 3、gradleHost 1、semanticActions 1，均为其他 lane 的中间态） |
| `node .tools/find-orphan-modules.mjs --gate` | 门禁红：`src/intentionList.ts`（其他 lane 新增孤儿，**本 lane 文件不在列表里**——`buildContentRoots.ts` 有 `rootsModel.ts` 和 `ProjectStructurePane.vue` 两个真实消费方） |
| `node --test tests/source-citations.test.mjs` | **3 tests: 3 pass, 0 fail** |

## 8. 反向验证

注入点：`src/buildContentRoots.ts:55`，将 `if (!a) return true` 改为 `if (!a) return false`（标记 `ROOTS4C-PROBE`）。

结果：`tests/roots-content-roots.test.mjs` 中 4 条测试红（#2/#3/#5/#6），证明祖先规则判据有实际捕获力。

收工确认：`grep -rn "ROOTS4C-PROBE" src/ tests/ docs/` 命中 0。

## 9. 保留文件

本轮一行没改 `src/App.vue`、`src/bridge.ts`、`src/components/CodeEditor.vue`、`native/main.cpp`、`scripts/verdict_table.py`。

## 10. 并发黑名单文件

本轮未读写 `src/commitChecksResult.ts`、`src/documentRevisions.ts`、`src/gradleHost.ts`、`src/backgroundTasks.ts`、`src/progressPanel.ts`、`src/editorFolding.ts`、`src/terminalScrolling.ts`、`src/lsp*`、`tests/gradle-host.test.mjs`。

## 11. `tests/gradle-host.test.mjs` 现状

15 tests, 15 pass, 0 fail。本 lane 未触碰该文件（并发黑名单）。

## 12. 尺寸合规

| 文件 | 行数 | 上限 | 合规 |
|---|---:|---:|---|
| `src/buildContentRoots.ts` | 164 | 900 | OK |
| `src/rootsModel.ts` | 486 | 900 | OK |
| `src/components/ProjectStructurePane.vue` | 573 | 900 | OK |
| `tests/roots-content-roots.test.mjs` | 105 | 无限制 | OK |

## 13. 持久化键

本模块**不新增持久化键**——`buildProjectDirs` 和 `excludeOutput` 都是运行时派生/输入参数，不落 localStorage。
