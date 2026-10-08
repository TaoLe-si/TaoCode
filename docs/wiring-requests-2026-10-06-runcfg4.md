# wiring-requests-2026-10-06-runcfg4 — 运行配置 UI 族（第四批）留给宿主/别人的线

本批（`docs/batch-2026-10-06-runcfg4.md`）只动了 `src/runConfigTree.ts`、`src/runConfigurations.ts`、
`src/runConfigEditors.ts`、`src/components/RunConfigurationsDialog.vue` + 两个测试文件；下面三条都要动保留文件，
**本批一条都没做**，按上游坐标如实登记，等接线。

---

## W1 「Sort Configurations」需要**整份清单**的写入口（不改 `src/App.vue` 也能做，但要新增一个事件）

上游：`platform/execution-impl/src/com/intellij/execution/impl/RunConfigurable.kt:1289-1341`
（文案 `platform/execution/resources/messages/ExecutionBundle.properties:79` = `Sort Configurations`，
描述键 `run.configuration.sort.folder.description`）。

规则（实读）：
- 可用档 `:1331-1341`：选中的节点里有 **CONFIGURATION_TYPE 或 FOLDER** 才启用；选中配置本身 ⇒ 不可点。
- 作用范围 `:1309-1330`：对**每个**选中的类型/文件夹节点，把它的直接子节点按比较器重排后 `nodeStructureChanged`。
- 比较器 `:1292-1307`：文件夹永远在前（且**保持原有相对次序**：`node1.parent.getIndex(node1) - node2.parent.getIndex(node2)`）；
  普通配置按名；`TEMPORARY_CONFIGURATION` 在后（同为临时时按名）。
- 描述文案 `platform/execution/resources/messages/ExecutionBundle.properties:80` = `Sort configurations alphabetically`。

本仓缺的那一环：对话框只有 `emit('save', config, origin)` 这一条**单条**写口
（`src/components/RunConfigurationsDialog.vue` 的 `defineEmits`），而排序是一次改整份数组顺序，
逐条 save 会变成 N 次 `project.settings.update` + N 条通知（且每次都重新 `selectRunConfig`）。
域模块里已经有现成的批量口 `persistRunConfigs(configs, message)`（`src/runConfigurations.ts:180-195`），
但它是 `createRunConfigurations` 的返回值、被 `src/App.vue:1317` 解构出来却没有传给对话框。

可照抄的最小接法（改 `src/App.vue` 一处，对话框侧本批已经把纯函数准备好了）：

```vue
<!-- src/App.vue:2563 那一行加一个 :persist 与 @sort（保留文件，由 appvue 那一路动） -->
<RunConfigurationsDialog v-if="runConfigsOpen" :configs="runConfigs" :draft="runConfigDraft" :busy="working"
  :persist="persistRunConfigs"
  @save="saveRunConfigFromDialog" @remove="removeRunConfigFromDialog" @select="loadRunConfigDraft" @close="runConfigsOpen = false" />
```

对话框侧需要的只是把选中节点对应的子树按上游比较器重排后调 `props.persist(nextConfigs, '…')`。
比较器本批**没有**落地成模块（没有消费链路 ⇒ 按规约 §3 不写、不放假控件）；接线时把它加进
`src/runConfigTree.ts`（上游形状见上），并补判据「文件夹在前且保序 / 临时在后 / 其余按名」。

---

## W2 「Show this page」（`settings.isEditBeforeRun`）需要新的持久化键 + 宿主白名单

上游：`platform/execution-impl/src/com/intellij/execution/impl/BeforeRunStepsPanel.java:166`（建勾）、
`:209`（reset 读 `settings.isEditBeforeRun()`）、`:234`（`needEditBeforeRun()`）；
写回在 `platform/execution-impl/src/com/intellij/execution/impl/ConfigurationSettingsEditorWrapper.java:143`
（`settingsToApply.setEditBeforeRun(...)`，与 activate/focus 那两格同一批、同一位置）。
文案 `platform/execution/resources/messages/ExecutionBundle.properties:346` = `Show this page`；
**同一文件里 grep `configuration.edit.before.run` 只有这一条命中 ⇒ 没有配套的 `.description` 键，
这一格的悬浮提示「无法核实」**（原写「提示语键紧随其后」是没核过的猜测，已订正）。

语义：**起跑前先把这个对话框弹出来**（用户可以在弹出来的页面上改参数再跑）。
本仓现在完全没有这一档，`src/runConfigurations.ts:102-114` 的草稿里只有 activate/focus 两个开关。

为什么要别人动：这是**每条配置一个布尔** ⇒ 要同时动
① `src/settingsModel.ts` 的 `RunConfig`（保留）加 `editBeforeRun?: boolean`、
② `native/settings_schema.cpp` 的 runConfigs known_keys + 布尔校验（保留）、
③ 读侧补默认（缺键 ⇒ 上游默认 false；**不许按字段数判损坏**）、
④ 消费链路在 `src/runActions.ts` 的 `startRun`（保留）：起跑前打开对话框。
⇒ 本批没有渲染那一格（规约 §3：没有消费链路就不出现）。

---

## W3 「Store as project file」= 三档存储模型，要 native + 桥接 + 设计断言三处一起动

上游：`platform/execution-impl/src/com/intellij/execution/impl/RunConfigurationStorageUi.java`
（`:107` 复选框、`:530` `enum RCStorageType {Workspace, DotIdeaFolder, ArbitraryFileInProject}`、
`:281-346` 默认档位决策、`:415-432` apply 三档、`:227-229` 文件名 `<converter(名)>.run.xml`、
`:232-269` 路径校验六条、`:391/:403/:406` 只对 `type.isManaged` 的配置启用）。

本仓状态：**语义已核（见批次文档 §2 第 2 条），控件不补**。
阻塞点三处，全在保留文件/别人名下：
1. 往用户项目写文件与既有设计断言冲突：`native/projects_test.cpp:281`
   （`check(fs::is_empty(project), "Configuration may not be stored in the user project")`）。
2. 需要新的 native 方法（写/删/迁移 `*.run.xml`）与 `native/main.cpp` 分派表登记（保留）。
3. `src/bridge.ts` 的 Method 联合要加新通道（保留）。

补充：**上游默认的 `Workspace` 档本仓其实已经有了** —— 配置随应用状态文件走、不落进用户项目，
正是 `storeInLocalWorkspace()` 那一档的行为；缺的只是「升级到可共享的项目文件」这条出路（`:415-432` 的
后两档）。⇒ 判词该写成「第一档已等价、后两档缺」，不是笼统一句「没做」。

## 处理结果（wiring-backlog lane，2026-10-06）

- **W1（Sort Configurations 清单写入口）** —— 目标 `src/components/RunConfigurationsDialog.vue`（本 lane）。登记为待办。
- **W2（Show this page 持久化键）** —— `src/settingsModel.ts`（保留），需 settings owner。
- **W3（Store as project file 三档存储）** —— native + bridge，非本 lane。

结论：零接线（W1 登记，W2/W3 转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（W1 登记，W2/W3 转 owner）。」。
W1 复核仍未接：`src/components/RunConfigurationsDialog.vue` 无排序入口，且比较器未落进 `src/runConfigTree.ts`（非本 lane），需先补「文件夹在前且保序 / 临时在后 / 其余按名」纯函数与判据，登记待办。W2/W3 需 settingsModel/native。

## 处理结果（EP 化收口 lane，2026-10-07）

**W1 已落（模块侧）**：`src/runConfigTree.ts` 新增 `compareRunConfigSiblings` / `sortRunConfigSiblings` /
`runConfigSortSiblingOf` / `canSortRunConfigNodes`（上游 `RunConfigurable.kt:1292-1307` 的比较器与 `:1331-1341` 的可用档），
判据 `tests/run-config-sort.test.mjs`。**对话框挂载点**（App.vue 把 `persistRunConfigs` 传给
`RunConfigurationsDialog`，对话框用 `sortRunConfigSiblings` 重排选中子树后整份回写）写在
`docs/wiring-requests-2026-10-07-epclose.md` W-3。W2/W3 结论不变。
