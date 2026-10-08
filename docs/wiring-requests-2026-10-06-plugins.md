# 接线请求 · 插件域（`pf/plugins` / `ic/plugins`，2026-10-06）

> **本轮（代号 `plugins3`）核对结论（原始文件是上一轮 `plugins` 写的，下面逐条订正）**
>
> | 请求 | 状态 | 核对证据（本轮亲手打开） |
> |---|---|---|
> | P-1 外部「打开插件页并定位到某个插件」的宿主入口 | **未闭环** | `src/projectExtras.ts` 里没有 `pluginFocusId` / `openPluginsAndSelect`（全文件 grep `focusPlugin|pluginFocusId|openPluginsAndSelect` **0 命中**）；`src/App.vue` 的 `<PluginDialog …>` 挂载行（本轮抓在 `:2532-2533`）也没有 `:focus-plugin` 绑定 |
> | P-2 市场页仓库目录成为持久设置键 | **未闭环**（并按本轮复核**改了形状**，见下） | `pluginMarketRoot` 在全仓 **0 命中**（`src/settingsModel.ts` / `native/settings_schema.cpp` / `src/App.vue` / `PluginMarketPanel.vue` 都搜不到）；面板仍是 `src/components/PluginMarketPanel.vue` 里的一次性状态 |
> | P-3 内置插件层（`/bundled`、`/updatedBundled`） | **未闭环** | `native/main.cpp:1416-1417` 仍是 `case "plugin.list"_h … { const fs::path directory = profile / L"plugins";`，四个 `plugin.*` 方法仍钉一个目录；`native/plugins.hpp` / `native/plugins.cpp` / `src/plugin*` 里 `bundled` 只出现在注释与「本仓没有这一层」的说明行（`src/pluginGroups.ts:119`），JSON 没有 `bundled` 字段 |
> | P-4 远程插件仓库 | **未闭环，维持「要主代理拍板」** | `index.html:6` 的 CSP 仍是 `connect-src 'self' ws://127.0.0.1:5173`；`src/bridge.ts:109` 的 `Method` union 里与网络有关的仍只有 `'shell.openUrl'`，没有任何取数方法 |
>
> **两条订正（留痕，原写 X / 实际 Y）**
> 1. 原文写「P-2 的第 4 步面板侧改动要等 1-3 落地后**我同批改**」——本轮已把面板侧那半的**确切 old/new** 写在 P-2 里，并**去掉了原文新造一条 `refresh` 事件**的写法：`src/components/PluginMarketPanel.vue:68` 早就有 `(event: 'changed'): void`、`:272` 装完就 `emit('changed')`，而父组件 `src/components/PluginDialog.vue:540` 已经把它接到 `@changed="emit('refresh')"` ⇒ 宿主重取列表的通道**已经存在**，再挂一条新事件就是重复造轮子。P-2 现在让「改仓库根」复用 `changed`。
> 2. 原文 P-1「第一个真实调用方」写 `src/pluginCommands.ts` 在动作 id 找不到时「只是丢掉那一行」——**不成立**：该文件 `:75-77` 的注释与 `:94` 的 `enabled: () => hooks.hasAction!(entry.command.action)` 说明这一行是**置灰**而不是丢掉。P-1 的宿主入口不因此作废（上游那条入口就是通知/错误面在用），但理由要按本节写的重新取。
>
> **派单里提到的第二份请求文件不存在**：`docs/wiring-requests-2026-10-06-pluginsearch.md` 在 `docs/` 下没有同名文件（`ls docs/ | grep -i plugin` 只有本文件与 `batch-2026-10-06-plugins.md`；全仓 `grep -ril pluginsearch docs/` 命中的是 `PluginSearchResult.kt` 这类上游类名与 `src/pluginMarket.ts`，不是请求文档）。⇒ **无法核对它的条目**；本轮把「插件搜索」域里**模块侧还能做的**那一条（搜索框的属性词建议浮层）直接做掉了，落点见 `src/pluginSearchSuggest.ts` 与 `docs/batch-2026-10-06-plugins3.md`，需要主代理接的只剩宿主侧的 P-1…P-4。
>
> 行号是本轮（2026-10-06）亲手打开抓的原文位置；工作区是 12 路并行在改，`src/App.vue` 这类文件的行号会漂 ⇒ **粘贴时以下面每段的「原文」逐字匹配为准，行号只作定位提示**。

派单代号：`plugins`（本轮收尾 `plugins3`）。可改面：`src/plugin*.ts`、`src/marketplace*.ts`、
`src/components/{PluginDialog,PluginMarketPanel}.vue`、`native/plugins*.cpp`、`tests/plugin-*`。
下面 4 条都卡在**保留文件**（`src/App.vue`、`src/projectExtras.ts`、`src/settingsModel.ts`、`src/bridge.ts`、
`native/main.cpp`、`native/settings_schema.cpp`、`index.html`）上，模块侧已就绪或按请求可照抄。

上游基准树：`D:\Backup\Downloads\intellij-community-master\intellij-community-master`（行号本轮实数）。

---

## P-1 外部「打开插件页并定位到某个插件」的入口（接收侧已做完，宿主入口仍未接）

**上游依据**
`platform/ide-core/plugins/src/com/intellij/ide/plugins/PluginManagerConfigurableService.java:14-15`
声明 `showPluginConfigurableAndEnable(project, plugins…)`；实现链：
`platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurableServiceImpl.java:15-27`
→ `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurable.kt:397-401`
→ `platform/platform-impl/src/com/intellij/ide/plugins/PluginManagerConfigurablePanel.kt:490-514`
（`selectAndEnable` = 先 `model.enable(descriptors)` 再 `select(...)`；`select` 第一件事是 `updateSelectionTab(INSTALLED_TAB)`）。
真实调用方是通知/错误面，例如 `platform/execution/src/com/intellij/execution/configurations/UnknownRunConfiguration.java:123`
与 `platform/platform-impl/src/com/intellij/openapi/updateSettings/impl/pluginsAdvertisement/PluginAdvertiserEditorNotificationProvider.kt:196`
（本轮订正：原文写的是 `.../com/intellij/ide/plugins/newui/PluginAdvertiserEditorNotificationProvider.kt`，
参考树里**没有**那个路径，`find` 只出 `updateSettings/impl/pluginsAdvertisement/` 下面这一个，`:196` 逐字是
`PluginManagerConfigurable.showPluginConfigurableAndEnable(project, setOf(installedPlugin))`）。

**本仓接收侧现状（本轮复核，行号已随搜索建议浮层改动而移动）**：
`src/components/PluginDialog.vue:67`（`focusPlugin?: string` prop）、`:292`（`focusInstalledPlugin`）、
`:304`（`watch(() => props.focusPlugin, …)`）；市场页徽章是本页内已有调用方
（`src/components/PluginMarketPanel.vue:77` 的 `focusPlugin` 事件 → `src/components/PluginDialog.vue:540` 的 `@focus-plugin="focusInstalledPlugin"`）。
缺的只有宿主侧入口，下面三段是**可照抄的 old/new**。

**1）`src/projectExtras.ts` 加状态与入口**（原文在 `:35` 上方，紧接 `installingPlugins` 那段注释之后）

原文（`src/projectExtras.ts:34-35`）：
```ts
  const installingPlugins = ref<string[]>([])
  async function openPlugins() {
```
改为：
```ts
  const installingPlugins = ref<string[]>([])
  // 「打开插件页并定位到这个插件」（上游 PluginManagerConfigurableService.java:14-15 的等价入口）。
  // 定位动作本身在 PluginDialog 里（它的 focusPlugin prop），这里只负责把 id 递进去。
  const pluginFocusId = ref('')
  async function openPluginsAndSelect(id: string) {
    pluginFocusId.value = id
    await openPlugins()
  }
  async function openPlugins() {
```

**2）`src/projectExtras.ts` 的返回对象带出这两个键**

原文（`src/projectExtras.ts:185-187`）：
```ts
  return {
    pluginOpen, pluginBusy, pluginList, installingPlugins, openPlugins, togglePluginById, installPlugin, installPluginDirectory,
    setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
```
改为：
```ts
  return {
    pluginOpen, pluginBusy, pluginList, installingPlugins, pluginFocusId, openPlugins, openPluginsAndSelect,
    togglePluginById, installPlugin, installPluginDirectory,
    setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
```

**3）`src/App.vue` 解构那一行补两个键**

原文（`src/App.vue:940`）：
```ts
  pluginOpen, pluginBusy, pluginList, installingPlugins, openPlugins, togglePluginById, installPlugin, installPluginDirectory, setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
```
改为：
```ts
  pluginOpen, pluginBusy, pluginList, installingPlugins, pluginFocusId, openPlugins, openPluginsAndSelect, togglePluginById, installPlugin, installPluginDirectory, setPluginsEnabled, uninstallPlugin, refreshPlugins, togglePlugin,
```

**4）`src/App.vue` 的 `<PluginDialog …>` 挂载行**：加一个绑定、关闭时清掉，避免下次打开又选中同一个。

原文（`src/App.vue:2532-2533`）：
```html
    <PluginDialog v-if="pluginOpen" :plugins="pluginList" :installing="installingPlugins" :busy="pluginBusy" :is-desktop="isDesktop"
      @toggle="togglePluginById" @set-enabled="setPluginsEnabled" @install="installPlugin" @install-directory="installPluginDirectory" @uninstall="uninstallPlugin" @refresh="refreshPlugins" @close="pluginOpen = false" />
```
改为：
```html
    <PluginDialog v-if="pluginOpen" :plugins="pluginList" :installing="installingPlugins" :busy="pluginBusy" :is-desktop="isDesktop" :focus-plugin="pluginFocusId"
      @toggle="togglePluginById" @set-enabled="setPluginsEnabled" @install="installPlugin" @install-directory="installPluginDirectory" @uninstall="uninstallPlugin" @refresh="refreshPlugins" @close="pluginOpen = false; pluginFocusId = ''" />
```

**第一个真实调用方**（不需要新通道）：上游那条入口的调用场景是通知/错误面。本仓里已经存在同一形状的
「点进去看某个插件」需求：`PluginDialog.vue:292` 的 `focusInstalledPlugin(id)` 就是「跳过去 + 清过滤 + 选中」，
但**外部（通知、错误详情、动作注册表）现在没有办法触发它**。
注意原文那句「插件声明的命令指向的动作 id 找不到时 `src/pluginCommands.ts` 只是丢掉那一行」**不成立**：
该文件 `:75-77` 的注释与 `:94` 的 `enabled: () => hooks.hasAction!(...)` 说明这一行是**置灰**不是丢掉。
所以这一条的取舍交给主代理：只接 1-4 段（把通道打通）也可以，界面不会出现任何点不动的入口。

---

## P-2 市场页的仓库目录要成为持久设置键（`pluginMarketRoot`）

**用户可见差别**：市场页的仓库根仍是组件内的一次性状态
（`src/components/PluginMarketPanel.vue:80` 的 `const root = ref(DEFAULT_REPOSITORY_ROOT)`；缺省
`.taocode/plugins` 在 `src/pluginMarket.ts:72`）。关掉对话框再打开就回到缺省值。
上游把自定义仓库地址持久化在应用级服务里（`platform/platform-impl/src/com/intellij/ide/plugins/CustomPluginRepositoryService.java:20-37`，
`@Service` + 读仓库列表；地址本身来自 `PluginManagerSettings` 那一层），本仓的等价物就是设置键。

**1）`src/settingsModel.ts` 的接口加键**

原文（`src/settingsModel.ts:111-113`）：
```ts
export interface GeneralSettingsState {
  defaultProjectDirectory: string
  reopenLastProject: boolean
```
改为：
```ts
export interface GeneralSettingsState {
  defaultProjectDirectory: string
  /** 插件市场页读的仓库根（工作区相对路径）。上游等价物：`CustomPluginRepositoryService.java:20-37`。 */
  pluginMarketRoot: string
  reopenLastProject: boolean
```

**2）`src/settingsModel.ts` 的缺省值**

原文（`src/settingsModel.ts:182-184`）：
```ts
export const defaultGeneralSettings: GeneralSettingsState = {
  defaultProjectDirectory: '',
  reopenLastProject: true,
```
改为：
```ts
export const defaultGeneralSettings: GeneralSettingsState = {
  defaultProjectDirectory: '',
  pluginMarketRoot: '.taocode/plugins',
  reopenLastProject: true,
```

**3）`native/settings_schema.cpp` 的缺省 JSON**

原文（`native/settings_schema.cpp:140-141`）：
```cpp
    return Json{{"defaultProjectDirectory", Json("")},
                {"reopenLastProject", true}, {"deleteToBin", true},
```
改为：
```cpp
    return Json{{"defaultProjectDirectory", Json("")},
                {"pluginMarketRoot", ".taocode/plugins"},
                {"reopenLastProject", true}, {"deleteToBin", true},
```
校验那一支按现有 `defaultProjectDirectory` 的写法加一条**同类文本键**的检查即可；
**旧存档缺这个键必须补默认，不许判损坏**（规约 §3 的那条事故）。

原文（`native/settings_schema.cpp:190-193`）：
```cpp
        if (it.key() == "defaultProjectDirectory") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 512)
                fail("INVALID_SETTINGS", "defaultProjectDirectory must be a string of at most 512 bytes.");
        } else if (it.key() == "confirmOpenNewProject2") {
```
改为（未知键仍走 `:190` 那条未知键拒绝，旧存档的**缺键**由上面的缺省 JSON 补齐 ⇒ 加载时不报损坏）：
```cpp
        if (it.key() == "defaultProjectDirectory" || it.key() == "pluginMarketRoot") {
            if (!value.is_string() || value.get_ref<const std::string&>().size() > 512)
                fail("INVALID_SETTINGS", (std::string(it.key()) + " must be a string of at most 512 bytes.").c_str());
        } else if (it.key() == "confirmOpenNewProject2") {
```

**4）`src/App.vue`：把值给对话框、改值走既有的 `settings.general.update` 那条链**

`src/App.vue:483` 已经有 `const generalSettings = ref<GeneralSettingsState>({ ...defaultGeneralSettings })`；
写回的现成形状是同文件 `:603-613` 的 `deleteToBin`（`computed({ get, set })` +
`request<GeneralSettingsState>('settings.general.update', { general })`，失败回滚到 `previous`）。照那个形状加一个：

```ts
// 插件市场页的仓库根（工作区相对）。上游的等价物是应用级服务存的自定义仓库地址
// （`CustomPluginRepositoryService.java:20-37`），本仓把它落在通用设置键上。
const pluginMarketRoot = computed({
  get: () => generalSettings.value.pluginMarketRoot,
  set: value => {
    const previous = generalSettings.value
    generalSettings.value = { ...previous, pluginMarketRoot: value }
    void (async () => {
      try { generalSettings.value = await request<GeneralSettingsState>('settings.general.update', { general: generalSettings.value }) }
      catch (error) { generalSettings.value = previous; notify(errorMessage(error), true) }
    })()
  },
})
```

`src/App.vue:2532` 那一行在 P-1 的形状之上再加一个绑定与一个事件（两段合并后长这样）：
```html
    <PluginDialog v-if="pluginOpen" :plugins="pluginList" :installing="installingPlugins" :busy="pluginBusy" :is-desktop="isDesktop" :focus-plugin="pluginFocusId" :market-root="pluginMarketRoot"
      @toggle="togglePluginById" @set-enabled="setPluginsEnabled" @install="installPlugin" @install-directory="installPluginDirectory" @uninstall="uninstallPlugin" @refresh="refreshPlugins" @market-root="pluginMarketRoot = $event" @close="pluginOpen = false; pluginFocusId = ''" />
```
（原文写的「`generalSettings` 与 `setGeneralSetting` 都是现成的」不成立 —— `src/App.vue` 里没有
`setGeneralSetting` 这个函数，本轮按 `:603-613` 的真实形状重写。同理原文 P-2 提的 `saveSettingsPatch`
在本仓也不存在，宿主侧的通用设置写回就是上面那条 `settings.general.update`。）

**5）面板侧（我的面，主代理点头我就同批改）**
`src/components/PluginMarketPanel.vue:80` 的 `const root = ref(DEFAULT_REPOSITORY_ROOT)` 改成取 prop：
props 加 `marketRoot?: string`，初值 `props.marketRoot ?? DEFAULT_REPOSITORY_ROOT`；
仓库根的两个提交点 —— 输入框的 `@keydown.enter="refresh"`（`:309-310`）与「刷新」按钮的
`@click="refresh"`（`:312`）—— 各改成 `@keydown.enter="commitRoot(); void refresh()"` /
`@click="commitRoot(); void refresh()"`，新增 `function commitRoot() { emit('marketRoot', root.value) }`
与事件 `(event: 'marketRoot', value: string)`；`PluginDialog.vue:540` 再把它往上转一条
`@market-root="emit('marketRoot', $event)"`（`PluginDialog` 的 `defineEmits` 里加同名事件、props 加 `marketRoot?: string`）。
**不再新造 `refresh` 事件** —— 该面板的变更上报早就有：`PluginMarketPanel.vue:68` 的 `(event: 'changed')`、
`:272` 的 `emit('changed')`、`PluginDialog.vue:540` 的 `@changed="emit('refresh')"`。
（原文写的「`:427` 那条『保存这次修改』按钮」在当前文件里**不存在**，是上一轮的笔误：
仓库根只有输入框回车与「刷新」两个提交点，本轮按真实行号重写。）

---

## P-3 「内置插件（/bundled、/updatedBundled）」要宿主给出第二个插件目录（维持未闭环）

**判词订正（留痕）**：`pf/plugins` 判词把 bundled 这一层挂在 `BundledPluginsLister.kt` 上，
原写「JetBrains 自带插件层（bundled 分组/`BundledPluginsLister`）没有」。
实际 `platform/platform-impl/src/com/intellij/ide/plugins/BundledPluginsLister.kt:30-46` 是个
`ModernApplicationStarter` 命令行工具，产出 product-info 的 layout JSON，**不是插件页的 bundled 层**。
界面侧真正的 bundled 判定是 `platform/platform-impl/src/com/intellij/ide/plugins/newui/PluginUiModel.kt:34`
的 `isBundled` 与 `:146` 的 `isBundledUpdate`，消费点在
`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTabSearchResultPanel.kt:133-145`
（`/bundled` 收 bundled 或 bundledUpdate，`/userInstalled` 反过来把它们剔掉）。

**卡在哪一环**：本仓的插件只有一个目录 —— `native/main.cpp:1416-1417` 把四个 `plugin.*` 方法都钉在
`profile / L"plugins"` 上（本轮复看，行号未变），宿主没有「随应用一起发布的那一层」，所以 `isBundled` 恒假、
`/bundled` 与 `/updatedBundled` 无论怎么画都是点不出东西的假筛选（规约 §3 的不放假控件）。
前端已经把档位留着：`src/pluginGroups.ts:431`（`INSTALLED_SEARCH_OPTIONS` 有这两档）、
`:448`（`SUPPORTED_SEARCH_OPTIONS` 故意不含它们 ⇒ 筛选按钮不渲染）、
`:402`（`groupPluginsByCategory()` 已导出备用）。
**本轮新增的同一类档位**：搜索建议浮层的词表也按同一理由去掉这两档
（`src/pluginSearchSuggest.ts` 的 `INSTALLED_SUGGEST_WORDS`；上游词表面板自己就是按数据条件加项的 ——
`platform/platform-impl/src/com/intellij/ide/plugins/InstalledPluginsTab.kt:415-417` 与
`platform/platform-impl/src/com/intellij/ide/plugins/MarketplacePluginsTab.kt:383-390`。
宿主给出 bundled 层后，请把这两档补回那张词表，界面上才会出现可点的 `/bundled`）。

**要主代理接的线（二选一）**
- 方案 A（推荐，改动小）：`native/main.cpp` 的 `plugin.list` 分派里多扫一个目录
  （例如 `<app 根>/plugins`，路径来自宿主已有的应用根概念），`native/plugins.cpp` 的 `list()`
  在 JSON 每条上多给一个 `"bundled": true/false`（我的文件，宿主给路径后我立刻补解析与测试）。
- 方案 B：`plugin.list` 支持 `params.at("directory")`（多目录调用），前端把两处结果合并并打标记。
  注意这条路要把 `directory` 参数的校验放进 native（现在只有 `id` 做过目录名校验）。

---

## P-4 远程插件仓库（在线搜索/下载/评分）需要三条配套通道，属于安全决策（维持未闭环）

**卡在哪一环**（本轮逐条复核，成立）：
1. `index.html:6` 的 CSP 是 `connect-src 'self' ws://127.0.0.1:5173` —— WebView2 里跨源 `fetch` 直接被拦。
2. 宿主方法清单没有任何网络通道：`src/bridge.ts:109` 的 `Method` union 里与外部有关的只有 `'shell.openUrl'`
   （那是「用外部浏览器打开」，不是取数据），`native/main.cpp` 的 switch 也没有 HTTP 分支。
3. 远程清单还要配签名校验：`platform/platform-impl/src/com/intellij/ide/plugins/marketplace/PluginSignatureVerifier.kt:19-25`
   （`verify(descriptor, pluginFile, showAcceptDialog)` / `verifyIfRequired(..., isMarketplace, ...)`），
   以及自定义仓库的鉴权头 `platform/platform-impl/src/com/intellij/ide/plugins/auth/PluginRepositoryAuthService.kt:17-26`。
   「放宽 CSP」+「装一个不验签的包」两件事叠在一起就是安全事故，不该由本批自己决定。

**如果要做**，顺序建议：native 侧一个受限的 `http.get`（只允许 GET、只回文本/字节、有大小上限与超时）
→ `src/bridge.ts` 的 `Method` union 加键 → `PluginSignatureVerifier` 的等价校验（本地安装路径现在不验签）
→ 才轮到 `src/pluginMarket.ts` 把 `loadMarketplace` 的源换成「远端清单优先、本地仓库兜底」。
在此之前，市场页面上不会有「在线搜索」这种点不动的假入口（`PluginMarketPanel.vue` 的
`market-source` 那行已经把原因写在界面上）。

---

## P-5（本轮起草后**撤销**，留痕以免后人重犯）

本轮一度要加一条「在资源管理器里打开已装插件目录」的请求，并给它写了上游坐标
（`PluginsConfigurableWrapper.kt` 的 `doOpenPluginDirectory()` 与 `PluginModelActions.kt` 的
`OpenPluginDirectoryAction`）。**亲手回查后不成立**：
`find` 整棵参考树里既没有 `PluginsConfigurableWrapper*` 也没有 `PluginModelActions*` 这两个文件，
`grep -rln "OpenPluginDirectory|openPluginDirectory|getPluginDirectory" platform/` 三种拼法各 **0 命中**，
`grep -rn "openDir(" platform/platform-impl/src/com/intellij/ide/plugins/` 也 0 命中。
⇒ **上游指不到 ⇒ 不写这条请求**（规约 §1「指不到就写无法核实」、§3「不放假控件」）。
本仓那句「插件目录：用户配置目录下的 `plugins`」（`src/components/PluginDialog.vue:391`）**保持不可点**，
直到有人在上游树里真找到那条动作。

## 处理结果（wiring-backlog lane，2026-10-06）

- **P-1（打开插件页并定位到某插件）** —— 目标 `src/App.vue`（本 lane）+ `PluginDialog.vue` / `PluginMarketPanel.vue`（本 lane）。登记为待办（接收侧已做完，宿主入口未接）。
- **P-2（`pluginMarketRoot` 持久键）** —— `src/settingsModel.ts`（保留）+ native，需 settings owner。
- **P-3 / P-4** —— 维持未闭环（需宿主目录/安全决策）。
- **P-5** —— 已撤销。

结论：零接线（P-1 登记，P-2 转 owner）。

## 处理结果（接线 lane，2026-10-06）

复核（对当前工作区代码逐条核对）：上一条 `wiring-backlog lane` 的分解已逐项复核，其结论为「零接线（P-1 登记，P-2 转 owner）。」。
P-1 复核仍未闭环：`grep pluginFocusId|openPluginsAndSelect src/` 0 命中，`App.vue` 的 `<PluginDialog>` 无 `:focus-plugin`。宿主入口需 `src/projectExtras.ts` 的模块侧（`pluginFocusId` ref + `openPluginsAndSelect`）—— 该文件不在本 lane 可改面，转 projectExtras owner。P-2 需 `src/settingsModel.ts` + native；P-3/P-4 native/安全决策。

## 处理结果（EP 化收口 lane，2026-10-07）

**P-1 已落（模块侧）**：`src/projectExtras.ts` 新增 `pluginFocusId`（ref）与 `openPluginsAndSelect(id)`，
并已从返回对象带出。**宿主挂载点**（App.vue 解构两个键 + `<PluginDialog :focus-plugin="pluginFocusId">`、
关闭清空）写在 `docs/wiring-requests-2026-10-07-epclose.md` W-1。P-2/P-3/P-4 结论不变。
