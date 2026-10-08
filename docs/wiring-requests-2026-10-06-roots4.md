# 接线请求 · 2026-10-06 · roots4（链接构建工程的内容根与排除根）

## 结论：本域无接线请求

roots4 落的是**完整闭环**：

1. **模块本体** `src/buildContentRoots.ts` 被 `src/rootsModel.ts`（import 4 个函数）和
   `src/components/ProjectStructurePane.vue`（import 1 个函数）真实消费；
2. **消费链路**：`ProjectStructurePane.vue` 的 `rootModel` computed → `buildRootModel()` →
   `buildContentEntry()` → `rootModelRows()` → 面板渲染；
3. **判据**：`tests/roots-content-roots.test.mjs` 8 条覆盖完整。

没有需要其他文件配合的待接事项。

## 未来可选扩展（非请求，仅登记备忘）

| 项 | 条件 | 影响 | 当前状态 |
|---|---|---|---|
| Maven 同步后端接入真实模块列表 | 需要宿主 native 通道（`es/maven` 判词已 `[-]`，见 `docs/batch-2026-10-06-bucket15.md`） | `mavenProjectDirs` 可被 Maven 解析器替代 | 当前走磁盘清单（够用，不猜 `<modules>`） |
| `excludeOutput` 用户可配 | 需要 `JavaProjectSettings` 加字段 + 面板 UI + 持久化 | 允许关闭"编译输出当排除根" | 上游默认 true（`JpsJavaModuleExtensionBridge.kt:43`），本仓也默认 true；无 UI ⇒ 无消费链路 ⇒ 不加控件 |
| 跨工作区绝对路径链接 | 需要 `gradle.ts:787` 的 `linkedProjects` 从相对路径改为可含绝对 | 链接其他磁盘位置的工程 | 当前不等价第 1 条已写明（本仓存储是工作区相对路径），表达不了跨区链接 |

以上三条都**不需要其他 lane 配合**，且当前没有可执行判据，故不落成接线请求。

## 订正留痕汇总（已在本轮直接修好）

| 文件:行号 | 原写 | 实为 | 修法 |
|---|---|---|---|
| `src/buildContentRoots.ts:25` | `bridge/impl/JpsJavaModuleExtensionBridge.kt` | `bridge/impl/java/JpsJavaModuleExtensionBridge.kt` | 已改 |
| `src/buildContentRoots.ts:32` | `src/gradle.ts:776` | `src/gradle.ts:787` | 已改 |
| `src/rootsModel.ts:33` | `src/settingsModel.ts:66` | `src/settingsModel.ts:108` | 已改 |

三处都是**行号/路径**级别的坐标错，不影响逻辑。

## 处理结果（wiring-backlog lane，2026-10-06）

- 请求原文自述「本域无接线请求」。零接线。

结论：零接线（原文自述无请求）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（原文自述无请求）。」。
本 lane 本轮接线：无 —— 本份请求的挂载点目标均落在禁改/非本 lane 面（`src/components/CodeEditor.vue`、`src/bridge.ts`、`native/**`、`src/settingsModel.ts`、`src/keymapBindings.ts`、`src/*.ts` 等），或为上一条记录里的「登记待办 / 判定项」。
