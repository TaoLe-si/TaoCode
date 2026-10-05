# 接线请求 · 2026-10-06 · 桶 8c（工具窗口 / 标签条 / 弹层 / 拖放）

> 只有「消费点在保留文件 `src/App.vue` 里」的才写在这里。**本桶名下一律自己改完了**，
> 没有把能做的事派给别人。格式照 `docs/agent-playbook-parity.md` §「保留文件」。
> 上一任（桶 8b）的文件头引用的 `docs/wiring-requests-2026-10-06-bucket8b.md` **从未落盘**，
> 它想要的那一条（把 `popupStack.ts` 的 `closeAll()` 接给 `HideAllToolWindows`）在本批查证后
> **撤回**：上游 `StackingPopupDispatcher.close()`
> （`platform/platform-api/src/com/intellij/openapi/ui/popup/StackingPopupDispatcher.java:38`）
> 在整个参考树里零调用点，触发方无法核实 ⇒ 不派活、不自加行为。详见
> `docs/batch-2026-10-06-bucket8c.md` §1.4。

## 接线请求 B1（给桶 8 的统一接线轮 · 优先级最高）—— 项目树右键菜单压进弹层栈

- **目标文件**：`src/App.vue` 第 **2451–2452** 行（`<div v-if="treeMenu" class="tree-menu-backdrop" @pointerdown="treeMenu = null; treeSubmenu = null" …>`
  与它包着的那句 `<AnchoredMenu :x="treeMenu.x" :y="treeMenu.y" @pointerdown.stop>`），
  脚本侧插点在第 **394** 行 `const hiddenTabsOpen = ref(false)` 旁边（同一组弹层状态都住在那一段）。
- **要接什么**：`src/popupStack.ts` 的 `usePopupLayer`（值 import 必须写全扩展名：
  `import { usePopupLayer } from './popupStack.ts'`）接到这一层的开合：

  ```ts
  // 项目树右键菜单：交进全局弹层栈（上游 PopupDispatcher.java:36-37 那条挂在 AWT 事件队列上的全局链）。
  // 现在它靠 2451 行那层 backdrop 自己 @pointerdown 收，栈看不见这一层 ⇒
  //   ① 与齿轮/锚点菜单互抢同一次点击（两层各按各的选择器判"外面"，一次点外面两层一起收）；
  //   ② auto-hide 的窗口问「焦点进了弹层没有」（ToolWindowManagerLifecycle.kt:131，
  //      本仓 popupHasFocusWithin）时答"没进" ⇒ 开着树菜单时面板当场收掉。
  const treeMenuBox = ref<HTMLElement | null>(null)
  const treeMenuShown = computed(() => treeMenu.value !== null)
  usePopupLayer(treeMenuBox, treeMenuShown, () => { treeMenu.value = null; treeSubmenu.value = null })
  ```

  模板侧只需给 `AnchoredMenu` 那一句加一个 `ref="treeMenuBox"`（`AnchoredMenu.vue` 的根节点
  已经是 `<div ref="box" class="tree-menu">`，但父组件拿不到它；若更想少改，
  可把 `ref` 加在 2451 那句 backdrop 的**内层**包装 div 上 —— 栈要的是这一层的 DOM 根节点，
  用它量矩形（`measure`）与判 `node.contains(focus)`）。
- **为什么需要**：`popupStack.ts` 已经改了"处理过 Esc 就吃掉按键"（`consume()`）。
  栈上没注册的层不受这条保护：树菜单开着时按 Esc，栈把**它自己那层**收掉并吞键，
  树菜单靠 backdrop 活着；下一次点击才由栈一次性裁决 —— 用户看到的是"Esc 对树菜单无效"。
  注册之后才是"一条链、一个所有者、一段一段收"。

## 接线请求 B2（给桶 8 的统一接线轮）—— 底部标签溢出菜单（「…」）压进同一条栈

- **目标文件**：`src/App.vue` 第 **2190** 行那一整块 `.output-tabs-more`
  （`<div v-if="hiddenTabsOpen" class="output-tabs-more-menu" role="listbox" …>` 加它的
  `<div v-if="hiddenTabsOpen" class="output-tabs-more-backdrop" @click="hiddenTabsOpen = false" …>`），
  状态声明在第 **394** 行 `const hiddenTabsOpen = ref(false)`。
- **要接什么**：同上，`usePopupLayer` 接 `hiddenTabsOpen`：

  ```ts
  const moreMenuBox = ref<HTMLElement | null>(null)
  usePopupLayer(moreMenuBox, hiddenTabsOpen, () => { hiddenTabsOpen.value = false })
  ```

  模板侧在 `<div v-if="hiddenTabsOpen" class="output-tabs-more-menu" …>` 上加 `ref="moreMenuBox"`。
  它现在与 **COMBO 形态的内容下拉**（`src/components/ContentComboLabel.vue`，已注册、已带速度搜索）
  是同一排标签上的两个入口，`v-else` 互斥但**同一档**：两层都注册后，
  `StackingPopupDispatcherImpl.java:116-164` 那条"自顶向下、落点在某层内就停"才真按上游走。
- **为什么需要**：这条菜单原先只有 backdrop 的 `@click`（点外面收）而**没有 Esc**：
  按 Esc 时栈把上面那层收掉并吃掉按键（本批新加的 `consume()`），溢出菜单留在那儿 ——
  注册之后它才进入同一条键盘链（`:181-193`），两段式 Esc 一层一层收到底。

## 接线请求 B3（低优先 · 顺手）—— `TabContextMenu` 的 ref

- **目标文件**：`src/App.vue` 第 **2501** 行
  `<TabContextMenu v-if="tabMenu" … @close="tabMenu = null" />`。
- **要接什么**：**不需要改 App.vue** —— `src/components/TabContextMenu.vue` 在本桶名下、
  `close()` 现成（`src/components/TabContextMenu.vue:26`），只差它模板根节点的一个 `ref`
  与一句 `usePopupLayer`。本批把它**记为未完成**而没有做，是调用上限（见报告 §7.4）。
  下一批在 `src/components/TabContextMenu.vue` 内自行完成即可，不需要这里动手；
  列在此处只为别让"标签右键菜单不在栈上"这件事丢档。
- **为什么需要**：同 B1 —— 它是 DOM 局部收层（`ctx.close()`），栈看不见它。

---

## 2026-10-06 收口轮的更新

### B3 —— **已做完，不需要再接线**（`App.vue` 一行没改）

`src/App.vue:2501` 那句 `<TabContextMenu v-if="tabMenu" … @close="tabMenu = null" />` 保持原样：
注册点整个落在本桶名下的两个文件里。

- `src/components/AnchoredMenu.vue:23` 新增 `defineExpose({ box })` —— 外壳把浮层根节点露给宿主
  （栈量矩形用 `StackingPopupDispatcherImpl.java:116-164`，判焦点用
  `platform/platform-impl/src/com/intellij/openapi/wm/impl/ToolWindowManagerLifecycle.kt:129-131`）。
- `src/components/TabContextMenu.vue:32-36`：`<AnchoredMenu ref="menu" …>` + `usePopupLayer(box, shown, close, { cancelOnClickOutside: true })`。
  判据 `tests/popup-layer-wiring.test.mjs`「标签右键菜单也压进同一条栈」——真挂载取栈的差集，
  再调那一层的 `cancel()` 验它回给宿主的是 `close` 事件。反向验证（删掉那句 ⇒ 红）见报告 §8.6。

用户可见：标签右键菜单现在**吃 Esc**，并且开着它时 auto-hide 的面板不再当场收掉。

### B1 / B2 —— 仍然待接，但**外壳已经备好**（且不要往外壳里塞注册）

两条请求本身不变（`src/App.vue:2451-2452` 树右键、`src/App.vue:2190` 底部标签溢出菜单，
状态都在 `src/App.vue:394` 那一段；`App.vue` 现在 2708 行、上限 2737）。
收口轮顺手把可照抄的部分往前挪了一步：`AnchoredMenu.vue` 已 `defineExpose({ box })`，
所以接线侧**只需要**下面这三行，不必再包 div、也不必改 `AnchoredMenu`：

```ts
// src/App.vue（脚本段，紧挨 `const hiddenTabsOpen = ref(false)`）
import { usePopupLayer } from './popupStack.ts'          // 值 import，扩展名必须写全
const treeMenuBox = ref<HTMLElement | null>(null)
const treeMenuShown = computed(() => treeMenu.value !== null)
usePopupLayer(treeMenuBox, treeMenuShown, () => { treeMenu.value = null; treeSubmenu.value = null })
```

```html
<!-- 模板：2451-2452 那句 AnchoredMenu 上加一个 ref；backdrop 留着不影响（栈先收，backdrop 的赋值是幂等的） -->
<AnchoredMenu ref="treeMenuBox" :x="treeMenu.x" :y="treeMenu.y" @pointerdown.stop>
```

> **别把注册挪进 `AnchoredMenu.vue` 内部**（收口轮想过、否掉了）：`usePopupLayer` 的第三个参数
> 必须能真的收层 —— 栈按 `StackingPopupDispatcherImpl.java:181-193` 把关闭请求交给栈顶之后就
> `consume()` 掉这次按键。外壳自己注册却拿不到 `cancel` 句柄（`treeMenu` 状态在宿主手里）时，
> 表现会退化成"按 Esc 什么都不动、但页面里别的 Esc 链也被吃掉"，比现在更坏。
> `src/components/TabContextMenu.vue` 之所以能自己注册，是因为它的 `close()` 是一条 `emit`，
> 宿主那句 `@close="tabMenu = null"` 现成（`App.vue:2501`，无需改动）。

### 本轮新增的一条"非接线"待办（给桶 14 / TODO 面板那一族）

`src/components/TodoPanel.vue`（`ToolWindowView.vue:7` import 它）当前解析不过：
`@vue/compiler-sfc` 报 `Element is missing end tag.`（位置 349:38，文件 mtime 00:52:32，工作区里 +185/−35 的在途改动）。
它今天正让 `tests/sfc-single-root.test.mjs`、`tests/ui-icons.test.mjs` 两个文件**整文件**红。
本桶不碰别人的在途文件，请属主补那一个闭合标签。证据与复现见 `docs/batch-2026-10-06-bucket8c.md` §8.1 第 5 条。

