# 接线请求 · 2026-10-07 · pluginapi（平台行为还原收口 lane）

本 lane 的模块**本体 + 判据已落**（见下「已实现的模块」）。这一份是给能改 `src/components/**` 与
`src/App.vue` / `src/main.ts` 的人（UI lane / 主代理）的剩余挂载点：**组件里的一行**。
组件由别的 lane 独占，本 lane 一律不碰 —— 所以每件都写成"哪一行加什么"。

格式：`W-N：模块已实现，需要在 <文件>:<行> 加 <这一行>`。
行号是本轮（2026-10-07 00:5x）`grep -n` 实测的；**落之前自己再 grep 一次**（App.vue /
组件都在被别的 lane 改，行号会漂）。

---

## 已实现的模块（都有 `.mjs` 判据，绿）

| 模块 | 件 | 判据 |
| --- | --- | --- |
| `src/pluginApi.ts` | 插件 API 面：上游同名服务（`FileSwitcherApi` / `EditorWindow` / `SavedPatchesProvider` / `ProjectView`）+ EP 出处表 + `installPluginApi` | `tests/plugin-api.test.mjs`（8） |
| `src/fileEditorProviders.ts` | `com.intellij.fileEditorProvider` EP 宿主 + 消费端（`editorProviderFor`） | `tests/file-editor-providers.test.mjs`（5） |
| `src/projectViewPanes.ts` | 多窗格项目视图：bundled 项目/包/范围 + 窗格选择宿主 | `tests/project-view-panes.test.mjs`（6） |
| `src/largeFileViewer.ts` | 大文件查看器（`LargeFileEditorProvider`，按字节判定的 `fileEditorProvider` 贡献） | `tests/large-file-viewer.test.mjs`（5） |
| `src/pluginMarketRemote.ts` | 远程插件市场清单取数（走宿主 `http.get`） | `tests/plugin-market-remote.test.mjs`（6） |
| `src/extensionPoints.ts` | 新增 EP 声明 `com.intellij.fileEditorProvider`(+Suppressor) | 同上 |
| `index.html` | CSP `connect-src` 追加 `https://plugins.jetbrains.com`（市场那一个主机） | 同上 |
| `src/main.ts` | 启动时 `installPluginApi()` + `import './largeFileViewer.ts'`（插件 API 的真实消费链路） | `tests/plugin-api.test.mjs` |

`src/compareWithLocal.ts` + `src/revisionContent.ts` 由**并行的 CompareWithLocal lane** 落地，
判据 `tests/revision-content.test.mjs`；本 lane 只在 `src/pluginApi.ts` 的 `SavedPatchesProvider`
服务里按上游方法名 `createDiffWithLocalRequestProducer` 暴露（装配层用 `savedPatchCompare` 注入取数）。

---

## W-1：多窗格项目视图的切换入口

`src/projectViewPanes.ts` 已把「项目 / 包 / 范围」三支注册进 `com.intellij.projectViewPane`，
并有 `createProjectViewPaneHost({ root, persist, load })` 的选中状态机 —— 缺的是**画出来的那一个入口**。

**W-1：模块已实现，需要在 `src/components/ToolWindowView.vue:244` 的齿轮下拉里（`行为` 组
`:248` 之后）加一段「窗格」单选列表**，数据源是 `projectViewPaneChoices(root)`，点击走
`host.select(id)`。上游坐标：项目视图自己的 `additionalGearActions`（`ProjectViewImpl.java:1169`
把 `actionGroup` 交给 `toolWindow.setAdditionalGearActions`），本仓这一组现在就住在
`ToolWindowView.vue` 的齿轮里（`行为` 那三条的邻居）。

- 装配：`const paneHost = createProjectViewPaneHost({ root: () => workspaceRoot.value, persist: id => storePane(id), load: () => storedPane() })`；
- 渲染行 `paneHost.choices.value`（weight 降序），选中项加 `aria-checked`；
- `root` 为空（没工作区）时 `choices` 是空表 ⇒ 整段不渲染（`projectViewPaneChoices('')` 给 []）。
- **不要**在这里画"包视图的树"：三个窗格当前共用 `src/projectTreeModel.ts` 的同一张树，
  切窗格只换折叠口径（包口径已由 `src/symbolModel.ts` 的包树承担）；范围口径未落，见「剩余未做」。

## W-2：大文件查看器在打开文件时生效

`src/largeFileViewer.ts` 已实现 `largeFileEditorViewFor(input)`（超 5 MiB 给只读降级视图描述）。

**W-2：模块已实现，需要在 `src/App.vue:922` 的 `async function openFile(path, internal, options)`
里、读盘拿到文本之后，加一行 `const large = largeFileEditorViewFor({ path, root: workspace.value, text })`**，
`large` 非空时按 `large.readOnly` / `large.features` 打开（等价于现有 heavy 档，但判定改成**按字节**、
且由 EP 的 provider 决定 —— 第三方挂一个自己的 provider 即可替换）。

- 这**不**新增 UI：`src/components/CodeEditor.vue` 已有大文件降级与"解除只读"提示条
  （`src/largeFileNotice.ts`），这里只是把"谁决定用降级档"从写死的字符数判断换成 EP 的
  `editorProviderFor`。App.vue 只剩 6 行余量（2674/2680），这一处**净 +1~2 行**。

## W-3：插件 API 的启动装配（**本 lane 已接**）

`src/pluginApi.ts` 的 `installPluginApi(deps)` 会声明全部 bundled EP 并注册
基础四服务 + `FileSwitcherApi` / `EditorWindow` / `SavedPatchesProvider` / `ProjectView`。

**已接**：`src/main.ts` 在 `loadIgnoredPatterns()` 之后、`createApp(App)` 之前调了
`installPluginApi()`，并 `import './largeFileViewer.ts'` 让 bundled 大文件查看器在启动时进 EP。
所以「插件按 FQN `getService(Class)` 拿得到服务」这条链路在真机启动路径上已经通了
（`src/main.ts` 35→约 44 行，远未贴上限）。

**剩下需要 App.vue / 装配层补的一行**：把**实时数据源**注入进去（当前是空实现 ⇒
`getOpenFiles()` 等返回空表，但服务本身可解析）——
**W-3b：模块已实现，需要在 `src/App.vue` 的装配段（`createProjectExtras(...)` 那一带，本轮实测
`:983` 附近）加一行 `installPluginApi({ openFile, closeFile, openFiles: () => tabs.map(t => t.path), recentFiles: kind => recentFilesOf(kind), stashList: () => request('git.stash').then(r => r.entries), workspaceRoot: () => workspace.value })`**
（同 id 覆盖，重复调用安全）。不给也不影响插件解析到服务，只是数据源为空。

## W-4：远程插件市场的界面入口

`src/pluginMarketRemote.ts` 已实现 `loadRemoteMarketplace(repositoryUrl, { fetch })`（取
`repository.json` → 与本地同一份解析器整形，`file` 解析成绝对 URL）。`index.html` 的
`connect-src` 已追加 `https://plugins.jetbrains.com`，桌面端也可走宿主 `http.get`。

**W-4：模块已实现，需要在 `src/components/PluginMarketPanel.vue:304` 的 `refresh()` 里
（`loadMarketplace(...)` 之后）加一档 `if (remoteRepo.value) { const remote = await loadRemoteMarketplace(remoteRepo.value); ... }`**，
把远程条目并入现有列表；`:371` 的仓库输入框旁加一个「远程仓库 URL」输入。

- 远程条目 `installable` 是 **false**（见 `REMOTE_INSTALL_AVAILABLE`）：本仓没有"下载到工作区 +
  验签"的通道（`plugin.install` 只收工作区相对路径），所以远程那一档**只列不装**，
  安装按钮对远程条目置灰并写清原因，**不要**画一个点了没反应的按钮。
- `:380` 那句"远程插件仓库需要网络通道"的提示要更新（现在清单取数有落点了）。

## W-5：CodeActionPopup 挂载（另一 lane 已开单，本 lane 只登记）

**W-5：`src/components/CodeActionPopup.vue` + `src/codeActionPopupModel.ts` 已实现
（codeactionpopup lane），挂载点见 `docs/wiring-requests-2026-10-06-codeactionpopup.md`**：
需要在 `src/App.vue` 的 `v-if="actionPrompt"` 外壳与弹层那一行把现有的 `v-for="action in codeActions"`
换成 `<CodeActionPopup :actions="codeActions" :path="actionPrompt.path" @apply="applyCodeAction" />`。
本 lane 不重复开单，只把它列进收口清单（该 doc 的 W1-1/W1-2 就是那一行）。

## W-6：CompareWithLocal（并行 lane 已落地）

`src/compareWithLocal.ts`（规则）+ `src/revisionContent.ts`（`git.showCommit` 的 `<rev>:<path>`
取内容）+ `compareWithLocalSides()` 已由并行 lane 落地，判据 `tests/revision-content.test.mjs`。
它需要的组件挂点（变更视图/搁架行的「与本地比较」一行）归 UI lane，见该 lane 的报告；
本 lane 在 `src/pluginApi.ts` 的 `SavedPatchesProvider.createDiffWithLocalRequestProducer` 上
按上游方法名暴露，装配时需要 `installPluginApi({ savedPatchCompare: (i) => ... })` 注入取数
（取到内容后调 `compareWithLocalSides`）。

---

## 明确没做的（如实，不写成做了）

1. **远程插件安装**：缺"下载远程包到工作区"的通道 + `PluginSignatureVerifier` 的密码学验签
   （本仓只有判定层 `src/pluginSignature.ts`）。远程市场只做**清单取数 + 展示**。
2. **范围窗格的树**：`Scope` 窗格已注册、可选，但"按范围（Scratches/Project Files/…）折叠"的
   树口径没有落点 —— 三个窗格当前共用同一张 `src/projectTreeModel.ts` 的树，差别只在标题与选中态。
3. **编辑器提供者的 `Project`/`VirtualFile` 面**：`accept/createEditor` 的输入是本仓的
   `{ path, root, text?, bytes? }`，不是上游的 JVM 对象；第三方插件若直接 `instanceof VirtualFile`
   仍然不适用（本仓没有 JVM 对象模型，见 `src/pluginServices.ts` 文件头同一条边界）。
4. **新建 native 通道**：`src/bridge.ts`（904/905 行）与 `native/main.cpp`（禁改）本 lane 一行未动 ——
   远程取数走既有 `http.get`，CompareWithLocal 走既有 `git.showCommit`，大文件/窗格是纯前端。
   native 侧无改动 ⇒ 不触发 native 构建门禁的额外风险。
